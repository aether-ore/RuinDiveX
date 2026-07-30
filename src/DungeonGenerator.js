import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLAYER_TARGET_MODEL_HEIGHT } from './CharacterDimensions.js';
import { RollNpcAnimator } from './RollNpcAnimator.js';
import {
  createDungeonProgressionData,
  DungeonValidator,
  isDungeonGraphOnlyConnection,
  PROGRESSION_CONNECTIONS,
  PROGRESSION_ROOM_BANDS,
} from './DungeonProgression.js';
import { resolveIndustrialRoomMetadata } from './IndustrialRoomArchetypes.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from './TraversalCapabilities.js';
import {
  DUNGEON_CONNECTOR_VARIANT_IDS,
  planDungeonConnectorVariantAssignments,
  reserveDungeonConnectorFamilyFootprints,
  validateDungeonConnectorVariantAssignments,
} from './DungeonConnectorVariants.js';
import {
  createDungeonConnectorTrackTrapGlobalExclusions,
  planDungeonConnectorTrackTraps,
} from './DungeonConnectorTrackTrapPlanning.js';
import {
  ASCENSION_ENGINE_PROFILE_ID,
  ASCENSION_RELIQUARY_SCALE,
  ASCENSION_RELIQUARY_SEGMENTS,
} from './reaverbots/bosses/AscensionEngineContract.js';
import { createVerticalTransitReliquary } from './reaverbots/bosses/VerticalTransitReliquary.js';
import { INDUSTRIAL_DUNGEON_FAMILY_ID } from './DungeonFamilies.js';
import {
  DUNGEON_GENERATION_REQUIREMENTS,
  INDUSTRIAL_DUNGEON_GENERATION_CONTRACT_ID,
  validateDungeonGenerationSpatialContract,
} from './DungeonGenerationRequirements.js';
import {
  MAGMA_REFINERY_OPENING_MODULE_ID,
} from './magma/MagmaRefineryOpeningRoom.js';
import {
  generateMagmaRefineryOpeningSequence,
  MAGMA_REFINERY_OPENING_SEQUENCE_ID,
} from './magma/MagmaRefineryOpeningSequence.js';
import {
  generateMagmaLinearDiggerExcavationRoom,
  MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
} from './magma/MagmaLinearDiggerExcavationRoom.js';
import {
  generateMagmaRefractorAssayLabRoom,
  MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
} from './magma/MagmaRefractorAssayLabRoom.js';
import { augmentDungeonDraft } from './dungeon-augmentation/planner.js';
import { DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA } from './dungeon-augmentation/contracts.js';
import {
  createDungeonAugmentationSaveIdentity,
  validateCommittedDungeonAugmentationIdentity,
} from './dungeon-augmentation/identity.js';
import {
  createIndustrialAugmentationHost,
  createIndustrialBaseDraft,
} from './dungeon-augmentation/IndustrialDraftAdapter.js';
import {
  createIndustrialSupplementRewardTiles,
  materializeIndustrialOverlay,
} from './dungeon-augmentation/IndustrialOverlayMaterializer.js';
import { createIndustrialThemeAdapter } from './dungeon-augmentation/ThemeAdapters.js';
import { assembleDungeonSupplement } from './dungeon-augmentation/DungeonSupplementAssembler.js';
import { mergeDungeonFacade } from './dungeon-augmentation/DungeonFacadeOverlay.js';
import { resolveIndustrialSupplementEncounterRecipe } from './dungeon-augmentation/IndustrialSupplementContent.js';

function collectDungeonSupplementRequirementIds(
  plan,
  pluralKey,
  singularKey,
  legacyKeys = [],
) {
  const ids = new Set();
  let malformed = false;
  const addValue = (raw) => {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id) malformed = true;
    else ids.add(id);
  };
  const addSource = (source) => {
    if (!source || typeof source !== 'object') return;
    if (Object.hasOwn(source, pluralKey)) {
      if (!Array.isArray(source[pluralKey])) malformed = true;
      else source[pluralKey].forEach(addValue);
    }
    if (singularKey && Object.hasOwn(source, singularKey)) {
      const raw = source[singularKey];
      if (raw != null && raw !== '') addValue(raw);
    }
    for (const key of legacyKeys) {
      if (!Object.hasOwn(source, key)) continue;
      const raw = source[key];
      if (Array.isArray(raw)) raw.forEach(addValue);
      else if (raw != null && raw !== '') addValue(raw);
    }
  };
  addSource(plan);
  addSource(plan?.gateRequirement);
  return { ids: [...ids], malformed };
}

/**
 * Produces the exact runtime/effective-graph gate contract used by supplemental
 * connection plans. Keeping this normalization shared prevents the rendered
 * door and the progression graph from silently dropping a requirement.
 */
export function createDungeonSupplementProgressionRequirements(plan = {}, {
  includeStateContracts = true,
} = {}) {
  const credentials = collectDungeonSupplementRequirementIds(
    plan,
    'requiredCredentialIds',
    'requiredCredentialId',
    ['requiredKeycardId'],
  );
  const encounters = includeStateContracts
    ? collectDungeonSupplementRequirementIds(
        plan,
        'requiredEncounterStateIds',
        'requiredEncounterStateId',
        ['requiresEncounterId'],
      )
    : { ids: [], malformed: false };
  const mechanisms = includeStateContracts
    ? collectDungeonSupplementRequirementIds(
        plan,
        'requiredMechanismStateIds',
        'requiredMechanismStateId',
        ['requiresMechanismId'],
      )
    : { ids: [], malformed: false };
  const shortcuts = includeStateContracts
    ? collectDungeonSupplementRequirementIds(
        plan,
        'requiredShortcutStateIds',
        'requiredShortcutStateId',
        plan.oneSideActivatedShortcut || plan.shortcutMode ? ['shortcutStateId'] : [],
      )
    : { ids: [], malformed: false };
  const generic = includeStateContracts
    ? collectDungeonSupplementRequirementIds(
        plan,
        'requiredStateIds',
        'requiredStateId',
      )
    : { ids: [], malformed: false };
  const pressurePlates = includeStateContracts
    ? collectDungeonSupplementRequirementIds(
        plan,
        'requiredPressurePlateIds',
        'requiredPressurePlateId',
        ['pressurePlateId'],
      )
    : { ids: [], malformed: false };
  const sources = [plan, plan?.gateRequirement].filter(Boolean);
  const explicitlyRequires = (key) => sources.some((source) => source?.[key] === true);
  return {
    requiredKeycardId: credentials.ids[0] ?? null,
    requiredCredentialIds: credentials.ids,
    requiredEncounterStateIds: encounters.ids,
    requiredMechanismStateIds: mechanisms.ids,
    requiredShortcutStateIds: shortcuts.ids,
    requiredStateIds: generic.ids,
    requiredPressurePlateIds: pressurePlates.ids,
    requiresEncounterState: encounters.ids.length > 0
      || explicitlyRequires('requiresEncounterState'),
    requiresMechanismState: mechanisms.ids.length > 0
      || explicitlyRequires('requiresMechanismState'),
    requiresShortcutState: shortcuts.ids.length > 0
      || explicitlyRequires('requiresShortcutState'),
    requiresState: generic.ids.length > 0 || explicitlyRequires('requiresState'),
    requiresPressurePlate: pressurePlates.ids.length > 0
      || explicitlyRequires('requiresPressurePlate'),
    requirementsMalformed: [
      credentials,
      encounters,
      mechanisms,
      shortcuts,
      generic,
      pressurePlates,
    ].some(({ malformed }) => malformed),
  };
}

export function createDungeonSupplementProgressionConnection(plan = {}) {
  if (!plan.isDungeonSupplement || isDungeonGraphOnlyConnection(plan)) return null;
  const fromRoomId = plan.progressionFromRoomId
    ?? plan.fromSocket?.progressionRoomId
    ?? plan.fromRoomId;
  const toRoomId = plan.progressionToRoomId
    ?? plan.toSocket?.progressionRoomId
    ?? plan.toRoomId;
  if (!fromRoomId || !toRoomId) return null;
  // Physical connector-junction modules are deliberately absent from the
  // progression room graph. Collapsing a junction onto its deterministic
  // substantive-room anchor can turn one physical arm into a self-edge;
  // retain that arm for assembly/walkability but omit the meaningless graph
  // record from progression and minimap consumers.
  if (String(fromRoomId) === String(toRoomId)) return null;
  const usesV4StateContracts = Boolean(
    plan.augmentationOperationType === 'routeNetwork'
    || plan.isRouteNetworkConnection
    || plan.routeNetworkGrantId
  );
  const requirements = createDungeonSupplementProgressionRequirements(plan, {
    includeStateContracts: usesV4StateContracts,
  });
  return {
    id: plan.id,
    connectorId: plan.id,
    logicalConnectionId: plan.logicalConnectionId,
    fromRoomId,
    toRoomId,
    doorId: plan.doorId ?? null,
    ...requirements,
    routeClassification: plan.routeClassification ?? 'optional_branch',
    requiredForProgression: Boolean(plan.requiredForProgression),
    gateId: plan.logicalGateId ?? null,
    operationId: plan.augmentationOperationId ?? null,
    isDungeonSupplement: true,
    routes: [{
      id: plan.id,
      connectorType: plan.connectorType,
      level: plan.level,
      elevation: plan.elevation,
      sourceElevation: plan.sourceElevation ?? plan.fromSocket?.elevation ?? plan.elevation,
      destinationElevation: plan.destinationElevation ?? plan.toSocket?.elevation ?? plan.elevation,
      elevationDelta: plan.elevationDelta ?? 0,
      direction: plan.direction ?? 'level',
      connectorVariantId: plan.connectorVariantId ?? null,
      purpose: plan.purpose,
      routeClassification: plan.routeClassification ?? 'optional_branch',
      requiredForProgression: Boolean(plan.requiredForProgression),
      explorationBeats: (plan.explorationBeats ?? []).map((beat) => ({ ...beat })),
      fromSocket: { ...plan.fromSocket, roomId: fromRoomId },
      toSocket: { ...plan.toSocket, roomId: toRoomId },
      isDungeonSupplement: true,
      ...requirements,
    }],
  };
}

const DEFAULT_TILE_SIZE = DUNGEON_GENERATION_REQUIREMENTS.tileSizeMeters;
const RUIN_TEXTURE_BASE_PATH = '/assets/textures/ruins/';
const RUIN_ROOM_MODEL_BASE_PATH = '/assets/models/rooms/';
const ALIEN_SERVER_ROOM_MODEL = `${RUIN_ROOM_MODEL_BASE_PATH}alien_server_room_example.glb`;
const ALIEN_SERVER_ROOM_FOOTPRINT = { width: 24, depth: 18 };
const MACHINE_FACTORY_ROOM_MODEL = `${RUIN_ROOM_MODEL_BASE_PATH}industrial_machine_factory_room.glb`;
const MACHINE_FACTORY_ROOM_FOOTPRINT = { width: 30, depth: 22 };
const MACHINE_PRESS_LEG_OFFSET_X = 1.15;
const MACHINE_PRESS_LEG_WIDTH = 0.18;
const MACHINE_PRESS_LEG_HEIGHT = 1.45;
const MACHINE_PRESS_LEG_DEPTH = 0.32;
const MACHINE_PRESS_LEG_VISUAL_CENTER_Y = 0.72;
const MACHINE_PRESS_LEG_COLLISION_PADDING = 0.05;
const COOLANT_RELAY_ROOM_MODEL = `${RUIN_ROOM_MODEL_BASE_PATH}industrial_coolant_relay_puzzle_room.glb`;
const ROLL_MODEL_PATH = '/assets/models/npcs/roll/roll-x-dive.fbx';
const ROLL_TEXTURE_PATH = '/assets/models/npcs/roll/roll-x-dive.png';
const ROLL_ANIMATION_BASE_PATH = '/assets/models/npcs/roll/animations/';
const ROLL_ANIMATION_FILES = Object.freeze({
  idle: 'idle.fbx',
  explaining: 'explaining.fbx',
  thinking: 'thinking.fbx',
  bashful: 'bashful.fbx',
  talking: 'talking.fbx',
  thankful: 'thankful.fbx',
  waving: 'waving.fbx',
  happy: 'happy.fbx',
});
const ROLL_ANIMATION_LOAD_CONCURRENCY = 2;
const ROLL_ANIMATION_CLIP_PROMISES = new Map();
const ROLL_HEIGHT = PLAYER_TARGET_MODEL_HEIGHT;
const SUPPORT_CAR_BASE_PATH = '/assets/models/props/support-car/';
const SUPPORT_CAR_MODEL_PATH = `${SUPPORT_CAR_BASE_PATH}support-car.obj`;
const SUPPORT_CAR_TEXTURE_PATH = `${SUPPORT_CAR_BASE_PATH}support-car.png`;
const SUPPORT_CAR_HEIGHT = 3.6;
const SUPPORT_CAR_SOURCE_HEIGHT = 143.5;
const SUPPORT_CAR_HALF_WIDTH = (56.2 / SUPPORT_CAR_SOURCE_HEIGHT) * SUPPORT_CAR_HEIGHT;
const SUPPORT_CAR_HALF_DEPTH = (90.2 / SUPPORT_CAR_SOURCE_HEIGHT) * SUPPORT_CAR_HEIGHT;
const SUPPORT_CAR_YAW = -Math.PI * 0.25;
const SUPPORT_CAR_CAMP_POSITION = Object.freeze({ x: -10, y: 0, z: -5.7 });
const SUPPORT_CAR_FRONT_DOOR_LOCAL = Object.freeze({ x: SUPPORT_CAR_HALF_WIDTH, y: 1.45, z: -1.32 });
const ROLL_WORKSHOP_LOCAL_POSITION = Object.freeze({ x: 2.15, y: 0, z: -1.32 });
const WORKBENCH_LOCAL_POSITION = Object.freeze({ x: 3.55, y: 0, z: -1.32 });
const WORKBENCH_WIDTH = 2.2;
const WORKBENCH_DEPTH = 0.82;
const WORKBENCH_HEIGHT = 1.1;
const ROLL_WORKBENCH_INTERACTION_RADIUS = 2.4;
const WORKBENCH_SURFACE_TEXTURE_PATH = '/assets/textures/camp/roll-workbench-albedo.png';
const WORKBENCH_BLUEPRINT_TEXTURE_PATH = '/assets/textures/camp/roll-workbench-blueprint.png';
const COOLANT_RELAY_ROOM_FOOTPRINT = { width: 30, depth: 24 };
const ENABLE_IMPORTED_GLB_ROOMS = false;
const ENABLE_PROCEDURAL_FLOATING_DECOR = false;
const ENABLE_PROCEDURAL_GLOW_LINES = false;
const ENABLE_PROCEDURAL_OVERHEAD_DECOR = false;
const ENABLE_PROCEDURAL_RAISED_ROOM_LEVELS = true;
const RUIN_WALL_HEIGHT = 15.6;
const RUIN_WALL_THICKNESS = 0.22;
const RUIN_WALL_FACE_OFFSET = 0.006;
const RUIN_WALL_TILE_OVERLAP = 0.014;
const RUIN_WALL_TILE_ROWS = 6;
const RUIN_CEILING_THICKNESS = 0.12;
const RUIN_DOOR_HEIGHT = DUNGEON_GENERATION_REQUIREMENTS.minimumDoorHeightMeters;
const RUIN_DOOR_OPEN_Y = -5.3;
const RUIN_FACTORY_ELEVATION = 1.05;
const RUIN_OVERHEAD_GANTRY_HEIGHT = 4.35;
const RUIN_BASEMENT_ELEVATION = -3.2;
// The optional trap/vault chambers need enough vertical room for the full
// character silhouette, overhead bridges, and the authored ledge animation.
// Keep their floor separate from the shallower coolant/shrine service pits.
const RUIN_MINOR_DROP_ELEVATION = -4.8;
const RUIN_MINOR_DROP_SHELF_ELEVATION = -1.5;
const RUIN_SECOND_FLOOR_ELEVATION = 4.05;
const RUIN_THIRD_FLOOR_ELEVATION = 7.25;
const RUIN_RAIL_HEIGHT = 0.68;
const RUIN_RAIL_THICKNESS = 0.07;
const RUIN_RAMP_MAX_STEP = 0.55;
const CONNECTOR_GALLERY_MIN_WIDTH_TILES = DUNGEON_GENERATION_REQUIREMENTS.minimumConnectorWidthTiles;
const CONNECTOR_GALLERY_SIDE_TILES = Math.floor(CONNECTOR_GALLERY_MIN_WIDTH_TILES / 2);
const CONNECTOR_GALLERY_ALCOVE_SIDE_TILES = 2;
const CONNECTOR_DECORATIVE_ARCH_INTERVAL_TILES = 3;
const CONNECTOR_DECORATIVE_ARCH_WIDTH_TILES = 2.45;
const CONNECTOR_GALLERY_PORTAL_WIDTH_TILES = 2.45;
const CONNECTOR_DECORATIVE_ARCH_COLUMN_HALF_SIZE = 0.5;
const CONNECTOR_MINIMUM_CLEAR_WIDTH_METERS = 5.6;
const CONNECTOR_DECORATIVE_ARCH_HEADROOM_MARGIN = 0.25;
const CONNECTOR_APERTURE_VERTICAL_MARGIN = 0.08;
// New runs may try several independently forked overlay plans without consuming
// another value from Industrial V1's accepted RNG tape. More attempts make an
// explicit preview opt-in reliably visible while retaining exact-base fallback
// for layouts whose complete physical envelope cannot host a safe supplement.
const DUNGEON_AUGMENTATION_MAX_REALIZATION_ATTEMPTS = 8;
const INDUSTRIAL_SUPPLEMENT_PLAYABLE_ALPHA_PROFILE_ID =
  'industrial-supplement-preview-v4';
const NON_RETRYABLE_DUNGEON_THEME_ASSEMBLY_CODES = new Set([
  'MISSING_PARENT_THEME_SESSION',
  'INVALID_PARENT_THEME_SESSION',
  'MISSING_THEME_CAPABILITY',
  'MISSING_THEME_MATERIAL',
  'MISSING_THEME_ASSET',
  'MISSING_THEME_CONNECTOR',
  'MISSING_THEME_TRANSITION',
  'INVALID_THEME_MATERIAL',
  'THEME_MATERIAL_RESOLUTION_FAILED',
  'THEME_ASSET_CREATION_FAILED',
  'THEME_CONNECTOR_CREATION_FAILED',
  'THEME_TRANSITION_CREATION_FAILED',
  'THEME_ENVIRONMENT_CREATION_FAILED',
  'ASYNC_THEME_FACTORY_UNSUPPORTED',
  'FACADE_ONLY_FACTORY_TOPOLOGY_FORBIDDEN',
  'THEME_FACTORY_TOPOLOGY_FORBIDDEN',
  'missing-theme-capability',
  'invalid-theme-binding',
  'dungeon-theme-session-rejected',
  'theme-material-source-missing',
  'missing-magma-material-source',
]);

function classifyDungeonAugmentationRealizationFailure(error, diagnostics = null) {
  const codes = new Set();
  const visited = new Set();
  const inspect = (value) => {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return;
    if (visited.has(value)) return;
    visited.add(value);
    if (typeof value.code === 'string' && value.code) codes.add(value.code);
    for (const diagnostic of value.validation?.diagnostics ?? []) inspect(diagnostic);
    for (const entry of value.errors ?? []) inspect(entry);
    inspect(value.cause);
  };
  inspect(error);
  inspect(diagnostics);
  const missingBindingCode = [...codes].some((code) => (
    code === 'invalid-theme-binding-schema'
    || code.startsWith('missing-theme-binding-')
    || code.startsWith('missing-theme-ref-')
  ));
  const nonRetryable = diagnostics?.nonRetryable === true
    || missingBindingCode
    || [...codes].some((code) => NON_RETRYABLE_DUNGEON_THEME_ASSEMBLY_CODES.has(code));
  return Object.freeze({
    nonRetryable,
    category: nonRetryable ? 'theme-capability-or-binding' : null,
    codes: Object.freeze([...codes].sort()),
  });
}
const CONNECTOR_CLASSIC_SERVICE_OFFSET_TILES = 2;
const CONNECTOR_CLASSIC_FENCE_OFFSET_TILES = 2.46;
const OPTIONAL_V1_BRANCH_CONNECTION_IDS = new Set([
  'enemyNest_alienServerRoom',
  'conveyorRoom_machineFactoryRoom',
  'conveyorRoom_bonusVault',
]);
const RUIN_JUMP_PLATFORM_ELEVATION = 1.35;
const RUIN_VERTICAL_OVERPASS_CLEARANCE = PLAYER_TRAVERSAL_ENVELOPE.headClearance + 0.35;
const ROOM_CEILING_HEIGHT_BY_SIZE = Object.freeze({
  small: 8.4,
  medium: 12.8,
  large: 15.2,
  'mini-dungeon': RUIN_WALL_HEIGHT,
});

function resolveConnectorDecorativeArchProfile(width, height, laneCenterOffset) {
  const radius = Math.max(0.01, width * 0.5);
  const requiredHeadroom = PLAYER_TRAVERSAL_ENVELOPE.headClearance
    + CONNECTOR_DECORATIVE_ARCH_HEADROOM_MARGIN;
  const availableRise = Math.max(0.35, height - requiredHeadroom - 0.2);
  const rise = Math.min(radius, 1, availableRise);
  const columnHeight = Math.max(0.1, height - rise);
  const normalizedOffset = Math.min(0.995, Math.abs(laneCenterOffset) / radius);
  const torusVerticalScale = rise / radius;
  const tubeVerticalRadius = 0.28 * torusVerticalScale;
  const laneCenterlineHeight = columnHeight
    + rise * Math.sqrt(Math.max(0, 1 - normalizedOffset * normalizedOffset));
  return {
    rise,
    columnHeight,
    torusVerticalScale,
    minimumLaneHeadroomMeters: laneCenterlineHeight - tubeVerticalRadius,
    requiredHeadroomMeters: requiredHeadroom,
  };
}

function finalizeConnectorDecorativeArchBeat(beat, floorElevation) {
  const ceilingY = Number(beat?.ceilingY ?? (floorElevation + 8.4));
  const clearHeightMeters = ceilingY - floorElevation;
  const archHeightMeters = Math.min(5.5, Math.max(3.8, clearHeightMeters - 0.2));
  const profile = resolveConnectorDecorativeArchProfile(
    beat.widthMeters,
    archHeightMeters,
    beat.laneCenterOffsetMeters ?? DEFAULT_TILE_SIZE,
  );
  beat.floorElevation = floorElevation;
  beat.ceilingY = ceilingY;
  beat.clearHeightMeters = clearHeightMeters;
  beat.archHeightMeters = archHeightMeters;
  beat.archRiseMeters = profile.rise;
  beat.archColumnHeightMeters = profile.columnHeight;
  beat.archTorusVerticalScale = profile.torusVerticalScale;
  beat.minimumLaneHeadroomMeters = profile.minimumLaneHeadroomMeters;
  beat.requiredLaneHeadroomMeters = profile.requiredHeadroomMeters;
  return beat;
}
const RUIN_OPEN_AIR_ROOM_TYPES = new Set(['hub', 'camp']);
const WALL_MACRO_VARIANTS = ['industrial'];
const WALL_MACRO_TILE_KEYS = ['tl', 'tm', 'tr', 'ml', 'mm', 'mr', 'bl', 'bm', 'br'];
const WALL_MACRO_ACCENT_KEYS = [
  'conduit',
  'glyph',
  'hatch',
  'recessed',
  'sensor',
  'slate',
  'symbol',
  'vent',
  'wiring',
];
const RESERVED_FACTORY_SURFACE_TYPES = new Set([
  'hub',
  'camp',
  'entrance',
  'hallway',
  'keycard',
  'boss',
  'shrine',
  'chest',
]);
const CONVEYOR_BRIDGE_RESERVED_TYPES = new Set([
  ...RESERVED_FACTORY_SURFACE_TYPES,
  'hallway',
  'chest',
  'trap',
]);
const RAIL_ELIGIBLE_FACTORY_SURFACES = new Set([
  'catwalk',
  'serverUpperCatwalk',
  'machineUpperCatwalk',
  'machineCrossBridge',
  'coolantControlBalcony',
  'coolantPipeBridge',
  'thirdFloorGantry',
  'secondFloorConveyor',
  'conveyorCrossBridge',
  'reveredMezzanine',
  'upperConnectionBridge',
  'upperConnectionApproach',
  'jumpPlatform',
]);
const SCAFFOLD_RAMP_ACCESS_SURFACES = new Set([
  ...RAIL_ELIGIBLE_FACTORY_SURFACES,
  'conveyorBridge',
  'raisedDeck',
  'secondFloor',
  'refractorDais',
  'upperConnectionBridge',
  'jumpPlatform',
]);
const isArchitecturalDeckTile = (tile) => Boolean(tile?.massGroupId);
const isSolidArchitecturalDeckTile = (tile) => tile?.supportStyle === 'solid_mass';
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function tileKey(x, z) {
  return `${x},${z}`;
}

function isDoorOrHallwayClearance(tiles, x, z) {
  const tile = tiles.get(tileKey(x, z));
  if (!tile) {
    return true;
  }

  if (
    tile.type === 'hallway'
    || tile.type === 'entrance'
    || tile.type === 'hub'
    || tile.type === 'camp'
  ) {
    return true;
  }

  return DIRECTIONS.some(([dx, dz]) => {
    const neighbor = tiles.get(tileKey(x + dx, z + dz));
    return neighbor?.type === 'hallway' || neighbor?.type === 'entrance';
  });
}

function wouldObstructProgressionAccess(options = {}) {
  return options.surface === 'industrialRamp'
    || options.surface === 'rampLanding'
    || (Number.isFinite(options.elevation) && Math.abs(options.elevation) > 0.05)
    || (Number.isFinite(options.level) && Math.abs(options.level) > 0.05)
    || Number.isFinite(options.rampStartElevation)
    || Number.isFinite(options.rampEndElevation);
}

function floorTileKey(x, z, level = 0) {
  return `${x},${z}@${level}`;
}

function absoluteFloorTileKey(x, z, elevation = 0) {
  return `${x},${z}@y${Number(elevation ?? 0).toFixed(3)}`;
}

function physicalFloorOwnerIds(floor = {}) {
  return [...new Set([
    floor.roomId,
    floor.connectorJunctionOwnerId,
    floor.signedConnectorFloorOwnerId,
    floor.connectorId,
    floor.connectionId,
    ...(floor.sharedConnectorFloorOwnerIds ?? []),
  ].filter(Boolean).map(String))];
}

function isFloorOwnedByLogicalPaddedOperation(plan, floor) {
  if (
    !plan?.isLogicalPaddedConnectionRecord
    || !plan?.isPaddedByDungeonSupplement
    || !plan?.augmentationOperationId
    || !floor?.roomId
  ) return false;
  const operationId = String(plan.augmentationOperationId);
  if (String(floor.augmentationOperationId ?? '') === operationId) return true;
  const operationIdentity = operationId.match(/^(.*):operation:[^:]+:(.+)$/);
  const roomIdentity = String(floor.roomId).match(/^(.*):node:[^:]+:(.+)$/);
  return Boolean(
    operationIdentity
    && roomIdentity
    && operationIdentity[1] === roomIdentity[1]
    && operationIdentity[2] === roomIdentity[2]
  );
}

function isPointInsideExactConnectorThreshold(plan, point, roomId = null) {
  if (!plan || !point) return false;
  return [plan.fromSocket, plan.toSocket].some((socket) => {
    if (!socket) return false;
    if (roomId != null && String(socket.roomId ?? '') !== String(roomId)) return false;
    const facingX = Math.sign(Number(socket.facingX ?? 0));
    const facingZ = Math.sign(Number(socket.facingZ ?? 0));
    const deltaX = Number(point.x) - Number(socket.x);
    const deltaZ = Number(point.z) - Number(socket.z);
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaZ)) return false;
    const widthTiles = Math.max(
      3,
      Math.round(Number(
        socket.widthTiles
          ?? socket.landingWidthTiles
          ?? (Number(socket.landingWidth ?? 0) / DEFAULT_TILE_SIZE)
          ?? 3,
      )),
    );
    const halfWidthTiles = Math.floor(widthTiles / 2);
    if (facingX === 0 && facingZ === 0) {
      return deltaX === 0 && deltaZ === 0;
    }
    const longitudinal = deltaX * facingX + deltaZ * facingZ;
    const lateral = -deltaX * facingZ + deltaZ * facingX;
    // A threshold grant is deliberately much smaller than a room or gallery:
    // one boundary tile inward and outward across the exact three-tile door.
    return Math.abs(longitudinal) <= 1 && Math.abs(lateral) <= halfWidthTiles;
  });
}

function throwSupplementFloorOwnershipConflict({
  planId,
  roomId,
  point,
  elevation = 0,
  existingOwnerIds = [],
  details = null,
}) {
  const owner = [...new Set(existingOwnerIds.map(String))].join(', ') || 'unknown';
  const error = new Error(
    `${planId ?? roomId ?? 'Dungeon supplement'} cannot claim unrelated floor owner ${owner} at ${point.x},${point.z}@${Number(elevation).toFixed(3)}.`,
  );
  error.code = 'DUNGEON_AUGMENTATION_FOREIGN_FLOOR_OWNERSHIP';
  error.augmentationDiagnostics = {
    status: 'unchanged',
    reason: 'foreign-floor-ownership',
    planId: planId ?? null,
    roomId: roomId ?? null,
    point: {
      x: Number(point.x),
      z: Number(point.z),
      elevation: Number(elevation),
    },
    existingOwnerIds: [...new Set(existingOwnerIds.map(String))].sort(),
    ...(details ? { details } : {}),
  };
  throw error;
}

function canonicalizeAbsoluteFloorTiles(floorTiles = [], {
  trackOwnerProvenance = false,
} = {}) {
  const floorByKey = new Map();
  const mergedIdentities = [];
  const surfacePriority = (tile) => {
    if (tile?.surface === 'industrialRamp') return 4;
    if (tile?.surface === 'rampLanding') return 3;
    if (tile?.requiredTraversalAction) return 2;
    return 1;
  };
  const mergeArrays = (first, second, keyForValue) => {
    const values = [...(first ?? []), ...(second ?? [])];
    return [...new Map(values.map((value) => [keyForValue(value), value])).values()];
  };

  for (const floor of floorTiles) {
    if (trackOwnerProvenance) {
      const directOwnerIds = physicalFloorOwnerIds(floor);
      floor.mergedFloorOwnerIds = [...new Set([
        ...(floor.mergedFloorOwnerIds ?? []).map(String),
        ...directOwnerIds,
      ])].sort();
      floor.mergedFloorSourceCount = Math.max(
        1,
        Number(floor.mergedFloorSourceCount ?? 1),
      );
      floor.mergedUnownedFloorSourceCount = Math.max(
        0,
        Number(
          floor.mergedUnownedFloorSourceCount
            ?? (directOwnerIds.length === 0 ? 1 : 0),
        ),
      );
    }
    const floorKey = absoluteFloorTileKey(floor.x, floor.z, floor.elevation);
    floor.floorKey = floorKey;
    const existing = floorByKey.get(floorKey);
    if (!existing) {
      floorByKey.set(floorKey, floor);
      continue;
    }

    const existingSourceCount = trackOwnerProvenance
      ? Number(existing.mergedFloorSourceCount ?? 1)
      : 0;
    const floorSourceCount = trackOwnerProvenance
      ? Number(floor.mergedFloorSourceCount ?? 1)
      : 0;
    const existingUnownedSourceCount = trackOwnerProvenance
      ? Number(existing.mergedUnownedFloorSourceCount ?? 0)
      : 0;
    const floorUnownedSourceCount = trackOwnerProvenance
      ? Number(floor.mergedUnownedFloorSourceCount ?? 0)
      : 0;
    const mergedOwnerIds = trackOwnerProvenance ? [...new Set([
      ...(existing.mergedFloorOwnerIds ?? physicalFloorOwnerIds(existing)),
      ...(floor.mergedFloorOwnerIds ?? physicalFloorOwnerIds(floor)),
    ].map(String))].sort() : [];
    const preferred = surfacePriority(floor) > surfacePriority(existing) ? floor : existing;
    const discarded = preferred === floor ? existing : floor;
    for (const [key, value] of Object.entries(discarded)) {
      if (preferred[key] === undefined || preferred[key] === null) {
        preferred[key] = value;
      }
    }
    preferred.isPlatformingSurface = Boolean(
      preferred.isPlatformingSurface || discarded.isPlatformingSurface,
    );
    preferred.isLedgeSurface = Boolean(preferred.isLedgeSurface || discarded.isLedgeSurface);
    preferred.noEnemySpawn = Boolean(preferred.noEnemySpawn || discarded.noEnemySpawn);
    if (trackOwnerProvenance) {
      preferred.mergedFloorOwnerIds = mergedOwnerIds;
      preferred.mergedFloorSourceCount = existingSourceCount + floorSourceCount;
      preferred.mergedUnownedFloorSourceCount = existingUnownedSourceCount
        + floorUnownedSourceCount;
    }
    preferred.traversalLinks = mergeArrays(
      preferred.traversalLinks,
      discarded.traversalLinks,
      (link) => link.id ?? `${link.action}:${link.toFloorKey}`,
    );
    if (preferred.ledgeEdges || discarded.ledgeEdges) {
      preferred.ledgeEdges = mergeArrays(
        preferred.ledgeEdges,
        discarded.ledgeEdges,
        (edge) => edge,
      );
    }
    if (preferred.openRetainingWallEdges || discarded.openRetainingWallEdges) {
      preferred.openRetainingWallEdges = mergeArrays(
        preferred.openRetainingWallEdges,
        discarded.openRetainingWallEdges,
        (edge) => edge,
      );
    }
    floorByKey.set(floorKey, preferred);
    mergedIdentities.push({
      floorKey,
      keptSurface: preferred.surface ?? null,
      discardedSurface: discarded.surface ?? null,
    });
  }

  return {
    floorTiles: [...floorByKey.values()],
    diagnostics: {
      canonicalIdentityFormat: 'x,z@y<absolute-elevation-to-three-decimals>',
      inputCount: floorTiles.length,
      outputCount: floorByKey.size,
      mergedIdentities,
    },
  };
}

function getSerializableVolumeBounds(volume) {
  const center = volume?.center;
  const size = volume?.size;
  if (!center || !size) return null;
  const halfX = Math.max(0, Number(size.x ?? 0)) * 0.5;
  const halfY = Math.max(0, Number(size.y ?? 0)) * 0.5;
  const halfZ = Math.max(0, Number(size.z ?? 0)) * 0.5;
  if (![center.x, center.y, center.z, halfX, halfY, halfZ].every(Number.isFinite)) {
    return null;
  }
  return {
    minX: center.x - halfX,
    maxX: center.x + halfX,
    minY: center.y - halfY,
    maxY: center.y + halfY,
    minZ: center.z - halfZ,
    maxZ: center.z + halfZ,
  };
}

function serializableVolumesOverlap(first, second, epsilon = 0.001) {
  const a = getSerializableVolumeBounds(first);
  const b = getSerializableVolumeBounds(second);
  if (!a || !b) return false;
  return Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > epsilon
    && Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > epsilon
    && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > epsilon;
}

function rangeBetween(a, b) {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  const values = [];

  for (let value = min; value <= max; value += 1) {
    values.push(value);
  }

  return values;
}

function rangeBetweenOrdered(a, b) {
  const values = [];
  const step = a <= b ? 1 : -1;

  for (let value = a; step > 0 ? value <= b : value >= b; value += step) {
    values.push(value);
  }

  return values;
}

function stableRenderHash(value = '') {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function findConnectionDoorPathIndex(path = []) {
  const midpointIndex = Math.floor((path.length - 1) * 0.5);
  return path
    .map((point, index) => ({ point, index }))
    .filter(({ index }) => {
      const previous = path[index - 1];
      const next = path[index + 1];
      return previous && next && (previous.x === next.x || previous.z === next.z);
    })
    .sort((a, b) => Math.abs(a.index - midpointIndex) - Math.abs(b.index - midpointIndex))[0]?.index
    ?? midpointIndex;
}

function resolveConnectionDoorPlacement(
  connectionPlan,
  fromRoom,
  toRoom,
  { gatePlacementSide = 'destination' } = {},
) {
  const path = connectionPlan?.bridgePath ?? [];
  const normalizedGatePlacementSide = gatePlacementSide === 'source'
    ? 'source'
    : 'destination';
  const thresholdSocket = connectionPlan?.doorId
    ? normalizedGatePlacementSide === 'source'
      ? connectionPlan?.fromSocket
      : connectionPlan?.toSocket
    : null;
  const thresholdRoom = normalizedGatePlacementSide === 'source' ? fromRoom : toRoom;
  const thresholdIndex = thresholdSocket
    ? path.findIndex((point) => (
        point.x === thresholdSocket.x
        && point.z === thresholdSocket.z
      ))
    : -1;
  const index = thresholdIndex >= 0
    ? thresholdIndex
    : findConnectionDoorPathIndex(path);
  const pathPoint = path[index] ?? null;
  const point = thresholdSocket
    ? { x: thresholdSocket.x, z: thresholdSocket.z }
    : pathPoint ?? (
    fromRoom && toRoom
      ? {
          x: Math.round((fromRoom.x + toRoom.x) * 0.5),
          z: Math.round((fromRoom.z + toRoom.z) * 0.5),
        }
      : null
  );
  const previous = path[Math.max(0, index - 1)] ?? null;
  const next = path[Math.min(path.length - 1, index + 1)] ?? null;
  const alongX = thresholdSocket
    ? Math.abs(thresholdSocket.facingX ?? 0)
      > Math.abs(thresholdSocket.facingZ ?? 0)
    : pathPoint && previous && next
    ? Math.abs(next.x - previous.x) >= Math.abs(next.z - previous.z)
    : Math.abs((fromRoom?.x ?? 0) - (toRoom?.x ?? 0))
      > Math.abs((fromRoom?.z ?? 0) - (toRoom?.z ?? 0));

  return {
    path,
    index,
    pathPoint,
    point,
    previous,
    next,
    alongX,
    thresholdAnchored: Boolean(thresholdSocket),
    thresholdSocket,
    thresholdRoom,
    gatePlacementSide: normalizedGatePlacementSide,
  };
}

function applyTileOptions(tile, options = {}) {
  if (!tile || !options) {
    return tile;
  }

  if (Number.isFinite(options.elevation)) {
    tile.elevation = options.elevation;
  }
  if (Number.isFinite(options.level)) {
    tile.level = options.level;
  }
  if (options.roomId) {
    tile.roomId = options.roomId;
  }
  if (options.surface) {
    tile.surface = options.surface;
  }
  if (Number.isFinite(options.rampStartElevation)) {
    tile.rampStartElevation = options.rampStartElevation;
  }
  if (Number.isFinite(options.rampEndElevation)) {
    tile.rampEndElevation = options.rampEndElevation;
  }
  if (Number.isFinite(options.rampDirectionX)) {
    tile.rampDirectionX = options.rampDirectionX;
  }
  if (Number.isFinite(options.rampDirectionZ)) {
    tile.rampDirectionZ = options.rampDirectionZ;
  }
  if (options.connectorId) {
    tile.connectorId = options.connectorId;
  }
  if (options.connectionId) {
    tile.connectionId = options.connectionId;
  }
  if (options.connectorZone) {
    tile.connectorZone = options.connectorZone;
  }
  if (options.platformGroupId) {
    tile.platformGroupId = options.platformGroupId;
  }
  for (const key of [
    'isPlatformingSurface',
    'isLedgeSurface',
    'platformPurpose',
    'requiredTraversalAction',
    'preserveProgressionOverpass',
    'supportStyle',
    'massGroupId',
    'allowsGroundedDropLanding',
    'groundedStepTransitionHeight',
    'dropSpaceId',
    'preserveProgressionFooting',
    'supportBaseElevation',
    'blockedBySolidLedgeSupport',
    'rampRouteId',
    'rampRunId',
    'rampScaffoldPriority',
    'rampPointIndex',
    'rampPointCount',
    'noEnemySpawn',
    'augmentationOwnerId',
    'augmentationBlueprintId',
    'augmentationModuleTemplateId',
    'augmentationModuleKind',
    'augmentationFloorTierId',
    'augmentationFloorTierRuntimeId',
    'augmentationFloorCellId',
    'augmentationTransferId',
    'augmentationTransferForm',
    'augmentationTransferKind',
    'augmentationTransferCellId',
    'augmentationCollisionId',
    'connectorJunctionOwnerId',
    'isDungeonSupplementConnectorFloor',
    'dungeonSupplementRewardId',
    'dungeonSupplementRewardStateId',
    'dungeonSupplementRewardProfileId',
    'dungeonSupplementRewardRecipe',
    'dungeonSupplementTrapId',
    'dungeonSupplementTrapStateId',
    'dungeonSupplementTrapProfileId',
    'dungeonSupplementTrapRecipe',
  ]) {
    if (options[key] !== undefined) {
      tile[key] = options[key];
    }
  }
  if (Array.isArray(options.ledgeEdges)) {
    tile.ledgeEdges = [...options.ledgeEdges];
  }
  if (Array.isArray(options.openRetainingWallEdges)) {
    tile.openRetainingWallEdges = [...options.openRetainingWallEdges];
  }
  if (Array.isArray(options.forcedRetainingWallEdges)) {
    tile.forcedRetainingWallEdges = [...options.forcedRetainingWallEdges];
  }
  if (Array.isArray(options.traversalLinks)) {
    tile.traversalLinks = options.traversalLinks.map((link) => ({ ...link }));
  }

  return tile;
}

function setTile(tiles, x, z, type = 'floor', options = {}) {
  const key = tileKey(x, z);
  const existing = tiles.get(key);

  if (existing) {
    if (options.forceType || existing.type === 'floor' || existing.type === 'hallway') {
      existing.type = type;
    }
    return applyTileOptions(existing, options);
  }

  const tile = applyTileOptions({ x, z, type, elevation: 0, level: 0 }, options);
  tiles.set(key, tile);
  return tile;
}

function createFloorTile(x, z, {
  type = 'floor',
  elevation = 0,
  level = 0,
  surface = type,
  roomId = null,
  directionX = 0,
  directionZ = 1,
  speed = 0,
  active = true,
  rampStartElevation = null,
  rampEndElevation = null,
  rampDirectionX = 0,
  rampDirectionZ = 0,
  connectionId = null,
  isPlatformingSurface = false,
  isLedgeSurface = false,
  platformPurpose = null,
  requiredTraversalAction = null,
  preserveProgressionOverpass = false,
  connectorId = null,
  connectorZone = null,
  platformGroupId = null,
  supportStyle = null,
  massGroupId = null,
  ledgeEdges = null,
  allowsGroundedDropLanding = false,
  groundedStepTransitionHeight = null,
  dropSpaceId = null,
  openRetainingWallEdges = null,
  preserveProgressionFooting = false,
  supportBaseElevation = null,
  blockedBySolidLedgeSupport = false,
  rampRouteId = null,
  rampRunId = null,
  rampScaffoldPriority = null,
  rampPointIndex = null,
  rampPointCount = null,
  noEnemySpawn = false,
  augmentationOwnerId = null,
  augmentationBlueprintId = null,
  augmentationModuleTemplateId = null,
  augmentationModuleKind = null,
  augmentationFloorTierId = null,
  augmentationFloorTierRuntimeId = null,
  augmentationFloorCellId = null,
  augmentationTransferId = null,
  augmentationTransferForm = null,
  augmentationTransferKind = null,
  augmentationTransferCellId = null,
  augmentationCollisionId = null,
  connectorJunctionOwnerId = null,
  isDungeonSupplementConnectorFloor = false,
  traversalLinks = null,
} = {}) {
  const tile = {
    x,
    z,
    type,
    elevation,
    level,
    surface,
    roomId,
    connectionId,
    isPlatformingSurface,
    isLedgeSurface,
    platformPurpose,
    requiredTraversalAction,
    preserveProgressionOverpass,
    connectorId,
    connectorZone,
    platformGroupId,
    supportStyle,
    massGroupId,
    ledgeEdges: Array.isArray(ledgeEdges) ? [...ledgeEdges] : null,
    allowsGroundedDropLanding,
    groundedStepTransitionHeight,
    dropSpaceId,
    preserveProgressionFooting,
    supportBaseElevation,
    blockedBySolidLedgeSupport,
    rampRouteId,
    rampRunId,
    rampScaffoldPriority,
    rampPointIndex,
    rampPointCount,
    noEnemySpawn: Boolean(noEnemySpawn),
    traversalLinks: Array.isArray(traversalLinks)
      ? traversalLinks.map((link) => ({ ...link }))
      : [],
    openRetainingWallEdges: Array.isArray(openRetainingWallEdges)
      ? [...openRetainingWallEdges]
      : null,
  };

  if (augmentationOwnerId != null) tile.augmentationOwnerId = augmentationOwnerId;
  if (augmentationBlueprintId != null) tile.augmentationBlueprintId = augmentationBlueprintId;
  if (augmentationModuleTemplateId != null) {
    tile.augmentationModuleTemplateId = augmentationModuleTemplateId;
  }
  if (augmentationModuleKind != null) tile.augmentationModuleKind = augmentationModuleKind;
  if (augmentationFloorTierId != null) tile.augmentationFloorTierId = augmentationFloorTierId;
  if (augmentationFloorTierRuntimeId != null) {
    tile.augmentationFloorTierRuntimeId = augmentationFloorTierRuntimeId;
  }
  if (augmentationFloorCellId != null) tile.augmentationFloorCellId = augmentationFloorCellId;
  if (augmentationTransferId != null) tile.augmentationTransferId = augmentationTransferId;
  if (augmentationTransferForm != null) tile.augmentationTransferForm = augmentationTransferForm;
  if (augmentationTransferKind != null) tile.augmentationTransferKind = augmentationTransferKind;
  if (augmentationTransferCellId != null) {
    tile.augmentationTransferCellId = augmentationTransferCellId;
  }
  if (augmentationCollisionId != null) tile.augmentationCollisionId = augmentationCollisionId;
  if (connectorJunctionOwnerId != null) {
    tile.connectorJunctionOwnerId = connectorJunctionOwnerId;
  }
  if (isDungeonSupplementConnectorFloor) tile.isDungeonSupplementConnectorFloor = true;

  if (type === 'conveyor') {
    tile.conveyorDirectionX = directionX;
    tile.conveyorDirectionZ = directionZ;
    tile.conveyorSpeed = speed || 2.4;
    tile.conveyorActive = active;
  }

  if (
    surface === 'industrialRamp'
    && Number.isFinite(rampStartElevation)
    && Number.isFinite(rampEndElevation)
  ) {
    tile.rampStartElevation = rampStartElevation;
    tile.rampEndElevation = rampEndElevation;
    tile.rampDirectionX = rampDirectionX;
    tile.rampDirectionZ = rampDirectionZ;
  }

  tile.floorKey = absoluteFloorTileKey(x, z, elevation);
  return tile;
}

function markTileSurface(tiles, x, z, options = {}) {
  return applyTileOptions(tiles.get(tileKey(x, z)), options);
}

function setConveyorTile(tiles, x, z, {
  directionX = 0,
  directionZ = 1,
  speed = 2.4,
  active = true,
  elevation,
  surface = 'conveyor',
} = {}) {
  const tile = setTile(tiles, x, z, 'conveyor');

  if (tile.type === 'conveyor') {
    applyTileOptions(tile, { elevation, surface });
    tile.conveyorDirectionX = directionX;
    tile.conveyorDirectionZ = directionZ;
    tile.conveyorSpeed = speed;
    tile.conveyorActive = active;
  }

  return tile;
}

function addRectRoom(tiles, room) {
  if (room?.suppressRoomGeometry) return;
  const halfW = Math.floor(room.width / 2);
  const halfD = Math.floor(room.depth / 2);
  const roomElevation = Number(room.plannedBaseElevation ?? room.baseElevation ?? 0);

  if (room.isDungeonSupplement) {
    for (let x = room.x - halfW; x <= room.x + halfW; x += 1) {
      for (let z = room.z - halfD; z <= room.z + halfD; z += 1) {
        const existing = tiles.get(tileKey(x, z));
        if (!existing) continue;
        const existingElevation = Number(
          existing.declaredFloorOwnerElevation ?? existing.elevation ?? 0,
        );
        if (
          Math.abs(existingElevation - roomElevation) <= 0.05
          && existing.roomId
          && String(existing.roomId) !== String(room.id)
        ) {
          throwSupplementFloorOwnershipConflict({
            roomId: room.id,
            point: { x, z },
            elevation: roomElevation,
            existingOwnerIds: physicalFloorOwnerIds(existing),
          });
        }
      }
    }
  }

  for (let x = room.x - halfW; x <= room.x + halfW; x += 1) {
    for (let z = room.z - halfD; z <= room.z + halfD; z += 1) {
      const floor = setTile(tiles, x, z, room.tileType ?? 'floor', { roomId: room.id });
      Object.defineProperty(floor, 'declaredFloorOwnerElevation', {
        value: roomElevation,
        writable: true,
        configurable: true,
        enumerable: Boolean(room.isDungeonSupplement),
      });
    }
  }

  const centerFloor = setTile(
    tiles,
    room.x,
    room.z,
    room.type,
    { roomId: room.id, forceType: true },
  );
  Object.defineProperty(centerFloor, 'declaredFloorOwnerElevation', {
    value: roomElevation,
    writable: true,
    configurable: true,
    enumerable: Boolean(room.isDungeonSupplement),
  });
}

function stampDungeonSupplementConnectorJunctionCores(
  tiles,
  connectorJunctionProxies = [],
  connectionPlans = [],
) {
  const elevatedFloors = [];
  const elevatedFloorByKey = new Map();
  const isPhysicalSupplementPlan = (plan) => Boolean(
    (plan?.isDungeonSupplement || plan?.isPaddedByDungeonSupplement)
      && !plan?.isSupplementGraphConnection
      && plan?.graphOnly !== true
      && plan?.connectorVariantConstraints?.graphOnly !== true
  );

  for (const junction of connectorJunctionProxies.filter((candidate) => (
    candidate?.stampConnectorJunctionFloor === true
  ))) {
    const attachedPlans = connectionPlans.filter((plan) => (
      isPhysicalSupplementPlan(plan)
        && (plan.fromRoomId === junction.id || plan.toRoomId === junction.id)
    ));
    const minimumPhysicalConnectorArms = Math.max(2, Number(
      junction.minimumPhysicalConnectorArms
        ?? junction.minimumPhysicalArmCount
        ?? (junction.countsAsMeaningfulStation === true ? 3 : 2),
    ));
    if (new Set(attachedPlans.map((plan) => String(plan.id))).size
      < minimumPhysicalConnectorArms) {
      const error = new Error(
        `Supplement connector module ${junction.id} has fewer than ${minimumPhysicalConnectorArms} physical connector arms.`,
      );
      error.code = 'DUNGEON_AUGMENTATION_CONNECTOR_JUNCTION_UNREALIZABLE';
      throw error;
    }
    const attachedPlanIds = new Set(attachedPlans.map((plan) => String(plan.id)));

    const baseElevation = Number(
      junction.baseElevation ?? junction.plannedBaseElevation ?? 0,
    );
    const authoritativeFloorTiers = (junction.augmentationFloorTiers ?? []).filter((tier) => (
      tier?.authoritative === true
      && Array.isArray(tier.worldCells)
      && tier.worldCells.length > 0
    ));
    const stampCell = ({
      x,
      z,
      elevation,
      level,
      tier = null,
      isBaseTier = true,
      forceStructuralMap = false,
      authoritativeFloorCellId = null,
      collisionId = null,
    }) => {
      if (!Number.isInteger(x) || !Number.isInteger(z) || !Number.isFinite(elevation)) {
        throw new DungeonAugmentationIncompatibleContentError(
          `Supplement connector module ${junction.id} has a malformed authoritative floor cell.`,
          {
            compatible: false,
            status: 'incompatible-content',
            resetOrAbandonRequired: true,
            roomId: junction.id,
            floorTierRuntimeId: tier?.runtimeId ?? null,
          },
        );
      }
      const options = {
        elevation,
        level: Number.isFinite(level)
          ? level
          : Number(((elevation - baseElevation) / DEFAULT_TILE_SIZE).toFixed(3)),
        surface: tier?.surface ?? 'supplementConnectorJunctionCore',
        roomId: junction.id,
        connectorJunctionOwnerId: junction.id,
        augmentationOwnerId: junction.augmentationOperationId ?? junction.id,
        augmentationBlueprintId: junction.augmentationBlueprintId ?? null,
        augmentationModuleTemplateId: junction.augmentationModuleTemplateId ?? null,
        augmentationModuleKind: junction.augmentationModuleKind ?? null,
        augmentationFloorTierId: tier?.localTierId ?? tier?.id ?? null,
        augmentationFloorTierRuntimeId: tier?.runtimeId ?? null,
        augmentationFloorCellId: authoritativeFloorCellId,
        augmentationCollisionId: collisionId,
        isDungeonSupplementConnectorFloor: true,
        noEnemySpawn: true,
      };

      const existing = tiles.get(tileKey(x, z));
      const existingElevation = Number(
        existing?.declaredFloorOwnerElevation ?? existing?.elevation ?? 0,
      );
      const canUseStructuralMap = forceStructuralMap || (
        isBaseTier
        && (!existing || Math.abs(existingElevation - elevation) <= 0.05)
      );
      if (canUseStructuralMap) {
        if (existing?.roomId && String(existing.roomId) !== String(junction.id)) {
          const error = new Error(
            `Supplement connector junction ${junction.id} overlaps room-owned floor ${existing.roomId} at ${x},${z}.`,
          );
          error.code = 'DUNGEON_AUGMENTATION_CONNECTOR_JUNCTION_OVERLAP';
          throw error;
        }
        if (existing?.type === 'hallway'
          && !attachedPlanIds.has(String(
            existing.connectorId ?? existing.connectionId ?? '',
          ))
          && existing.connectorJunctionOwnerId !== junction.id) {
          const error = new Error(
            `Supplement connector junction ${junction.id} overlaps an unrelated authored hallway at ${x},${z}.`,
          );
          error.code = 'DUNGEON_AUGMENTATION_CONNECTOR_JUNCTION_OVERLAP';
          throw error;
        }
        const floor = setTile(tiles, x, z, 'hallway', options);
        applyTileOptions(floor, options);
        floor.declaredFloorOwnerElevation = elevation;
        floor.dungeonSupplement = true;
        return floor;
      }

      const key = absoluteFloorTileKey(x, z, elevation);
      const existingElevated = elevatedFloorByKey.get(key);
      if (existingElevated && String(existingElevated.roomId) !== String(junction.id)) {
        const error = new Error(
          `Supplement connector junction ${junction.id} overlaps elevated floor ${existingElevated.roomId} at ${key}.`,
        );
        error.code = 'DUNGEON_AUGMENTATION_CONNECTOR_JUNCTION_OVERLAP';
        throw error;
      }
      if (existingElevated) {
        applyTileOptions(existingElevated, options);
        return existingElevated;
      }
      const floor = createFloorTile(x, z, {
        type: 'hallway',
        ...options,
      });
      floor.declaredFloorOwnerElevation = elevation;
      floor.dungeonSupplement = true;
      elevatedFloorByKey.set(key, floor);
      elevatedFloors.push(floor);
      return floor;
    };

    if (authoritativeFloorTiers.length > 0) {
      for (const tier of authoritativeFloorTiers) {
        const expectedElevation = Number(
          tier.worldElevation
            ?? (baseElevation + Number(tier.localElevation ?? tier.elevation ?? 0)),
        );
        for (const cell of tier.worldCells) {
          const elevation = Number(cell?.elevation ?? cell?.worldElevation ?? expectedElevation);
          if (Math.abs(elevation - expectedElevation) > 0.05) {
            throw new DungeonAugmentationIncompatibleContentError(
              `Supplement connector module ${junction.id} floor tier ${tier.id ?? tier.runtimeId} has an off-tier cell.`,
              {
                compatible: false,
                status: 'incompatible-content',
                resetOrAbandonRequired: true,
                roomId: junction.id,
                floorTierRuntimeId: tier.runtimeId ?? null,
              },
            );
          }
          stampCell({
            x: Number(cell?.grid?.x),
            z: Number(cell?.grid?.z),
            elevation,
            level: Number(tier.level),
            tier,
            isBaseTier: Math.abs(Number(
              tier.localElevation ?? tier.elevation ?? 0,
            )) <= 0.05,
            authoritativeFloorCellId: cell?.id ?? null,
            collisionId: cell?.collisionId ?? null,
          });
        }
      }
      continue;
    }

    // Legacy V1-V3 connector proxies deliberately retain their rectangular
    // core. Only a V4 proxy with authoritative tier cells takes the exact-mask
    // path above, so old replay fingerprints and 14 m connector contracts are
    // untouched.
    const width = Math.max(3, Math.round(Number(junction.width ?? 0)));
    const depth = Math.max(3, Math.round(Number(junction.depth ?? 0)));
    const halfWidth = Math.floor(width / 2);
    const halfDepth = Math.floor(depth / 2);
    for (let x = junction.x - halfWidth; x <= junction.x + halfWidth; x += 1) {
      for (let z = junction.z - halfDepth; z <= junction.z + halfDepth; z += 1) {
        stampCell({
          x,
          z,
          elevation: baseElevation,
          level: Number(junction.level ?? (baseElevation / 14)),
          forceStructuralMap: true,
        });
      }
    }
  }

  return elevatedFloors;
}

function addHallway(tiles, from, to) {
  for (const x of rangeBetween(from.x, to.x)) {
    setTile(tiles, x, from.z, 'hallway');
  }

  for (const z of rangeBetween(from.z, to.z)) {
    setTile(tiles, to.x, z, 'hallway');
  }
}

export class DungeonAugmentationIncompatibleContentError extends Error {
  constructor(message, compatibility = null) {
    super(message);
    this.name = 'DungeonAugmentationIncompatibleContentError';
    this.code = 'DUNGEON_AUGMENTATION_INCOMPATIBLE_CONTENT';
    this.compatibility = compatibility;
    this.resetOrAbandonRequired = true;
  }
}

function supplementRoomFloorMaskCells(room) {
  const authoritativeBaseTier = (room?.augmentationFloorTiers ?? []).find((tier) => (
    tier?.authoritative === true
    && Array.isArray(tier.worldCells)
    && tier.worldCells.length > 0
    && Math.abs(Number(tier.localElevation ?? tier.elevation ?? 0)) <= 0.05
  ));
  if (authoritativeBaseTier) {
    const cells = authoritativeBaseTier.worldCells.map((cell) => ({
      x: Number(cell?.grid?.x),
      z: Number(cell?.grid?.z),
      elevation: Number(cell?.elevation ?? authoritativeBaseTier.worldElevation),
      authoritativeFloorCellId: cell?.id ?? null,
      floorTierId: authoritativeBaseTier.localTierId ?? authoritativeBaseTier.id ?? null,
      floorTierRuntimeId: authoritativeBaseTier.runtimeId ?? null,
    }));
    if (cells.every(({ x, z, elevation }) => (
      Number.isInteger(x)
      && Number.isInteger(z)
      && Number.isFinite(elevation)
    ))) {
      return cells;
    }
    throw new DungeonAugmentationIncompatibleContentError(
      `Supplement room ${room?.id ?? '(unnamed)'} has malformed authoritative base-floor cells.`,
      {
        compatible: false,
        status: 'incompatible-content',
        resetOrAbandonRequired: true,
        roomId: room?.id ?? null,
        floorTierRuntimeId: authoritativeBaseTier.runtimeId ?? null,
      },
    );
  }
  const mask = room?.augmentationFloorMask;
  if (!room?.isDungeonSupplement || !Array.isArray(mask) || mask.length === 0) return null;
  const width = Math.max(...mask.map((row) => String(row ?? '').length));
  const depth = mask.length;
  if (width <= 0 || depth <= 0) return null;
  const turns = ((Math.trunc(Number(room.augmentationRotationQuarterTurns ?? 0)) % 4) + 4) % 4;
  const cells = [];
  for (let row = 0; row < depth; row += 1) {
    const values = String(mask[row] ?? '');
    for (let column = 0; column < width; column += 1) {
      if (values[column] !== '#') continue;
      const localX = column - Math.floor(width / 2);
      const localZ = row - Math.floor(depth / 2);
      let rotatedX = localX;
      let rotatedZ = localZ;
      if (turns === 1) {
        rotatedX = localZ;
        rotatedZ = -localX;
      } else if (turns === 2) {
        rotatedX = -localX;
        rotatedZ = -localZ;
      } else if (turns === 3) {
        rotatedX = -localZ;
        rotatedZ = localX;
      }
      cells.push({ x: room.x + rotatedX, z: room.z + rotatedZ });
    }
  }
  return cells;
}

function addAuthoredRoomFloor(tiles, room) {
  const floorMaskCells = supplementRoomFloorMaskCells(room);
  if (!floorMaskCells) {
    addRectRoom(tiles, room);
    return;
  }
  const roomElevation = Number(room.plannedBaseElevation ?? room.baseElevation ?? 0);
  for (const { x, z } of floorMaskCells) {
    const existing = tiles.get(tileKey(x, z));
    if (!existing) continue;
    const existingElevation = Number(
      existing.declaredFloorOwnerElevation ?? existing.elevation ?? 0,
    );
    if (Math.abs(existingElevation - roomElevation) <= 0.05
      && existing.roomId
      && String(existing.roomId) !== String(room.id)) {
      throwSupplementFloorOwnershipConflict({
        roomId: room.id,
        point: { x, z },
        elevation: roomElevation,
        existingOwnerIds: physicalFloorOwnerIds(existing),
      });
    }
  }
  for (const {
    x,
    z,
    elevation,
    authoritativeFloorCellId,
    floorTierId,
    floorTierRuntimeId,
  } of floorMaskCells) {
    if (Number.isFinite(elevation) && Math.abs(elevation - roomElevation) > 0.05) {
      throw new DungeonAugmentationIncompatibleContentError(
        `Supplement room ${room.id} base-floor record ${authoritativeFloorCellId ?? '(unnamed)'} is not on the room base elevation.`,
        {
          compatible: false,
          status: 'incompatible-content',
          resetOrAbandonRequired: true,
          roomId: room.id,
          floorTierRuntimeId: floorTierRuntimeId ?? null,
        },
      );
    }
    const floor = setTile(tiles, x, z, room.tileType ?? 'floor', {
      roomId: room.id,
      elevation: roomElevation,
      augmentationOwnerId: room.augmentationOperationId ?? room.id,
      augmentationBlueprintId: room.augmentationBlueprintId ?? null,
      augmentationFloorTierId: floorTierId ?? null,
      augmentationFloorTierRuntimeId: floorTierRuntimeId ?? null,
      augmentationFloorCellId: authoritativeFloorCellId ?? null,
    });
    floor.declaredFloorOwnerElevation = roomElevation;
    floor.augmentationModuleTemplateId = room.augmentationModuleTemplateId ?? null;
    floor.augmentationModuleKind = room.augmentationModuleKind ?? null;
    if (authoritativeFloorCellId) {
      floor.augmentationFloorCellId = authoritativeFloorCellId;
      floor.augmentationFloorTierId = floorTierId ?? null;
      floor.augmentationFloorTierRuntimeId = floorTierRuntimeId;
    }
  }
}

function normalizeDungeonSupplementBlueprintTransferForm(transfer = {}) {
  const value = String(
    transfer.form
      ?? transfer.traversalKind
      ?? transfer.kind
      ?? transfer.type
      ?? '',
  ).trim().toLowerCase().replaceAll('_', '-');
  if (value.includes('ladder')) return 'ladder';
  if (value.includes('lift')) return 'lift';
  if (value.includes('stair') || value.includes('step')) return 'stairs';
  if (value.includes('ramp') || value.includes('slope') || value.includes('incline')) {
    return 'ramp';
  }
  if (value.includes('landing')) return 'landing';
  return value || 'transfer';
}

function dungeonSupplementBlueprintEndpointElevation(transfer, endpoint) {
  const range = transfer?.worldElevationRange ?? {};
  const direct = endpoint === 'from'
    ? transfer?.fromElevation
    : transfer?.toElevation;
  const ranged = endpoint === 'from' ? range.from : range.to;
  const realized = transfer?.worldEndpoints?.[endpoint]?.elevation;
  return Number(realized ?? ranged ?? direct);
}

function dungeonSupplementBlueprintSectionPoint(point = {}) {
  if (Array.isArray(point)) {
    return {
      progress: Number(point[0]),
      elevation: Number(point[1]),
    };
  }
  return {
    progress: Number(point.progress),
    elevation: Number(point.worldElevation ?? point.elevation),
  };
}

function dungeonSupplementBlueprintLocalGridPoint(owner, localX, localZ) {
  const turns = ((Math.trunc(Number(owner?.augmentationRotationQuarterTurns ?? 0)) % 4) + 4) % 4;
  if (turns === 1) return { x: owner.x + localZ, z: owner.z - localX };
  if (turns === 2) return { x: owner.x - localX, z: owner.z - localZ };
  if (turns === 3) return { x: owner.x - localZ, z: owner.z + localX };
  return { x: owner.x + localX, z: owner.z + localZ };
}

function interpolateDungeonSupplementBlueprintSection(sectionRoute, progress, fromElevation, toElevation) {
  const points = (sectionRoute ?? [])
    .map(dungeonSupplementBlueprintSectionPoint)
    .filter((point) => Number.isFinite(point.progress) && Number.isFinite(point.elevation))
    .sort((left, right) => left.progress - right.progress);
  if (points.length < 2) {
    return THREE.MathUtils.lerp(fromElevation, toElevation, progress);
  }
  if (progress <= points[0].progress) return points[0].elevation;
  if (progress >= points[points.length - 1].progress) return points[points.length - 1].elevation;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    if (progress > next.progress) continue;
    const span = Math.max(0.000001, next.progress - previous.progress);
    return THREE.MathUtils.lerp(
      previous.elevation,
      next.elevation,
      (progress - previous.progress) / span,
    );
  }
  return toElevation;
}

function dungeonSupplementBlueprintTransferCells(owner, transfer) {
  if (Array.isArray(transfer?.worldCells) && transfer.worldCells.length > 0) {
    return transfer.worldCells.map((cell) => ({
      ...cell,
      grid: {
        x: Number(cell?.grid?.x),
        z: Number(cell?.grid?.z),
      },
      elevation: Number(cell?.elevation ?? cell?.worldElevation),
    }));
  }

  // Compatibility for early development blueprints that still carry the
  // source feature rectangle. Released records are expected to arrive with
  // authoritative worldCells from the materializer.
  const footprint = transfer?.localFootprint ?? {};
  const center = footprint.center ?? transfer;
  const widthTiles = Math.max(1, Math.round(Number(
    footprint.widthTiles ?? transfer?.widthTiles ?? transfer?.w ?? 1,
  )));
  const depthTiles = Math.max(1, Math.round(Number(
    footprint.depthTiles ?? transfer?.depthTiles ?? transfer?.d ?? 1,
  )));
  const minimumLocalX = Number(center.x ?? transfer?.x ?? 0) - (widthTiles - 1) * 0.5;
  const minimumLocalZ = Number(center.z ?? transfer?.z ?? 0) - (depthTiles - 1) * 0.5;
  const fromElevation = dungeonSupplementBlueprintEndpointElevation(transfer, 'from');
  const toElevation = dungeonSupplementBlueprintEndpointElevation(transfer, 'to');
  const endpointFrom = transfer?.worldEndpoints?.from?.grid;
  const endpointTo = transfer?.worldEndpoints?.to?.grid;
  const cells = [];
  for (let depthIndex = 0; depthIndex < depthTiles; depthIndex += 1) {
    for (let widthIndex = 0; widthIndex < widthTiles; widthIndex += 1) {
      const localX = minimumLocalX + widthIndex;
      const localZ = minimumLocalZ + depthIndex;
      const grid = dungeonSupplementBlueprintLocalGridPoint(owner, localX, localZ);
      if (!Number.isInteger(grid.x) || !Number.isInteger(grid.z)) continue;
      let progress;
      if (endpointFrom && endpointTo) {
        const deltaX = Number(endpointTo.x) - Number(endpointFrom.x);
        const deltaZ = Number(endpointTo.z) - Number(endpointFrom.z);
        const spanSquared = deltaX * deltaX + deltaZ * deltaZ;
        progress = spanSquared > 0
          ? THREE.MathUtils.clamp(
              ((grid.x - Number(endpointFrom.x)) * deltaX
                + (grid.z - Number(endpointFrom.z)) * deltaZ) / spanSquared,
              0,
              1,
            )
          : 0.5;
      } else if (depthTiles >= widthTiles) {
        progress = depthTiles === 1 ? 0.5 : 1 - depthIndex / (depthTiles - 1);
      } else {
        progress = widthTiles === 1 ? 0.5 : widthIndex / (widthTiles - 1);
      }
      cells.push({
        id: `${transfer.id}:fallback-cell:${widthIndex}:${depthIndex}`,
        grid,
        localTile: { x: localX, z: localZ },
        elevation: interpolateDungeonSupplementBlueprintSection(
          transfer.sectionRoute,
          progress,
          fromElevation,
          toElevation,
        ),
        progress,
      });
    }
  }
  return cells;
}

function stampDungeonSupplementBlueprintTransfers(
  tiles,
  physicalOwners = [],
  inputFloorTiles = [],
  tileSize = DEFAULT_TILE_SIZE,
) {
  const floorTiles = [...inputFloorTiles];
  const floorByKey = new Map(floorTiles.map((floor) => [
    absoluteFloorTileKey(floor.x, floor.z, floor.elevation ?? 0),
    floor,
  ]));
  const floorByAuthoritativeCellId = new Map(floorTiles
    .filter((floor) => floor.augmentationFloorCellId)
    .map((floor) => [String(floor.augmentationFloorCellId), floor]));
  const ownerMatchesFloor = (owner, floor) => Boolean(
    String(floor?.roomId ?? '') === String(owner?.id ?? '')
      || String(floor?.connectorJunctionOwnerId ?? '') === String(owner?.id ?? '')
      || (
        !floor?.roomId
        && String(floor?.augmentationOwnerId ?? '') === String(
          owner?.augmentationOperationId ?? owner?.id ?? '',
        )
      )
  );
  const addTraversalLink = (fromFloor, toFloor, action, id, transfer) => {
    if (!fromFloor || !toFloor) return;
    fromFloor.traversalLinks = [
      ...(fromFloor.traversalLinks ?? []).filter((link) => link.id !== id),
      {
        id,
        action,
        toFloorKey: absoluteFloorTileKey(toFloor.x, toFloor.z, toFloor.elevation ?? 0),
        augmentationTransferId: transfer.id,
        augmentationBlueprintId: transfer.blueprintId ?? null,
        stateIds: [...(transfer.stateIds ?? [])],
      },
    ];
  };
  const addTransferLinks = (fromFloor, toFloor, action, transfer) => {
    addTraversalLink(fromFloor, toFloor, action, `${transfer.id}:forward`, transfer);
    if (transfer.bidirectional !== false) {
      addTraversalLink(toFloor, fromFloor, action, `${transfer.id}:reverse`, transfer);
    }
  };
  const resolveEndpointFloor = (owner, transfer, endpoint) => {
    const record = transfer?.worldEndpoints?.[endpoint] ?? null;
    if (record?.floorCellId) {
      const exactCell = floorByAuthoritativeCellId.get(String(record.floorCellId));
      if (exactCell) return exactCell;
    }
    const elevation = Number(
      record?.elevation ?? dungeonSupplementBlueprintEndpointElevation(transfer, endpoint),
    );
    if (record?.grid && Number.isFinite(elevation)) {
      const exact = floorByKey.get(absoluteFloorTileKey(
        Number(record.grid.x),
        Number(record.grid.z),
        elevation,
      ));
      if (exact) return exact;
    }
    const center = transfer?.localFootprint?.center ?? transfer;
    const fallbackCenter = dungeonSupplementBlueprintLocalGridPoint(
      owner,
      Number(center?.x ?? 0),
      Number(center?.z ?? 0),
    );
    return floorTiles
      .filter((floor) => ownerMatchesFloor(owner, floor))
      .filter((floor) => Math.abs(Number(floor.elevation ?? 0) - elevation) <= 0.05)
      .sort((left, right) => {
        const leftDistance = Math.abs(left.x - fallbackCenter.x) + Math.abs(left.z - fallbackCenter.z);
        const rightDistance = Math.abs(right.x - fallbackCenter.x) + Math.abs(right.z - fallbackCenter.z);
        return leftDistance - rightDistance || left.x - right.x || left.z - right.z;
      })[0] ?? null;
  };
  const serializeLandingTiles = (owner, endpointFloor, widthTiles, depthTiles) => floorTiles
    .filter((floor) => ownerMatchesFloor(owner, floor))
    .filter((floor) => Math.abs(
      Number(floor.elevation ?? 0) - Number(endpointFloor.elevation ?? 0),
    ) <= 0.05)
    .filter((floor) => (
      Math.abs(floor.x - endpointFloor.x) <= Math.floor(widthTiles / 2)
      && Math.abs(floor.z - endpointFloor.z) <= Math.floor(depthTiles / 2)
    ))
    .sort((left, right) => (
      Math.abs(left.x - endpointFloor.x) + Math.abs(left.z - endpointFloor.z)
    ) - (
      Math.abs(right.x - endpointFloor.x) + Math.abs(right.z - endpointFloor.z)
    ))
    .map((floor) => ({
      x: floor.x,
      z: floor.z,
      elevation: Number(floor.elevation ?? 0),
      floorKey: absoluteFloorTileKey(floor.x, floor.z, floor.elevation ?? 0),
    }));
  const transferCenterGrid = (owner, transfer, transferCells) => {
    const validCells = transferCells.filter((cell) => (
      Number.isFinite(cell?.grid?.x) && Number.isFinite(cell?.grid?.z)
    ));
    if (validCells.length > 0) {
      return {
        x: validCells.reduce((sum, cell) => sum + cell.grid.x, 0) / validCells.length,
        z: validCells.reduce((sum, cell) => sum + cell.grid.z, 0) / validCells.length,
      };
    }
    const center = transfer?.localFootprint?.center ?? transfer;
    return dungeonSupplementBlueprintLocalGridPoint(
      owner,
      Number(center?.x ?? 0),
      Number(center?.z ?? 0),
    );
  };

  for (const owner of physicalOwners) {
    const transfers = (owner?.augmentationTransfers ?? []).filter((transfer) => (
      transfer?.authoritative !== false
    ));
    if (transfers.length === 0) continue;
    owner.augmentationLadderContracts = [];
    owner.augmentationLiftContracts = [];
    owner.supplementTransferIds = [];

    for (const transfer of transfers) {
      const form = normalizeDungeonSupplementBlueprintTransferForm(transfer);
      const transferCells = dungeonSupplementBlueprintTransferCells(owner, transfer);
      const transferCellByColumn = new Map(transferCells.map((cell) => [
        tileKey(cell.grid.x, cell.grid.z),
        cell,
      ]));
      const fromElevation = dungeonSupplementBlueprintEndpointElevation(transfer, 'from');
      const toElevation = dungeonSupplementBlueprintEndpointElevation(transfer, 'to');
      if (!transfer.id
        || !Number.isFinite(fromElevation)
        || !Number.isFinite(toElevation)
        || transferCells.some((cell) => (
          !Number.isInteger(cell?.grid?.x)
          || !Number.isInteger(cell?.grid?.z)
          || !Number.isFinite(cell?.elevation)
        ))) {
        throw new DungeonAugmentationIncompatibleContentError(
          `Supplement blueprint transfer ${transfer?.id ?? '(unnamed)'} in ${owner.id} is malformed.`,
          {
            compatible: false,
            status: 'incompatible-content',
            resetOrAbandonRequired: true,
            roomId: owner.id,
            transferId: transfer?.id ?? null,
          },
        );
      }

      if (['ramp', 'stairs', 'landing'].includes(form)) {
        for (const cell of transferCells) {
          const neighbors = DIRECTIONS.map(([dx, dz]) => transferCellByColumn.get(
            tileKey(cell.grid.x + dx, cell.grid.z + dz),
          )).filter(Boolean);
          const higher = neighbors
            .filter((neighbor) => neighbor.elevation > cell.elevation + 0.001)
            .sort((left, right) => right.elevation - left.elevation)[0] ?? null;
          const lower = neighbors
            .filter((neighbor) => neighbor.elevation < cell.elevation - 0.001)
            .sort((left, right) => left.elevation - right.elevation)[0] ?? null;
          const direction = higher
            ? {
                x: Math.sign(higher.grid.x - cell.grid.x),
                z: Math.sign(higher.grid.z - cell.grid.z),
              }
            : lower
              ? {
                  x: Math.sign(cell.grid.x - lower.grid.x),
                  z: Math.sign(cell.grid.z - lower.grid.z),
                }
              : { x: 0, z: 0 };
          const behind = direction.x || direction.z
            ? transferCellByColumn.get(tileKey(
                cell.grid.x - direction.x,
                cell.grid.z - direction.z,
              ))
            : null;
          const ahead = direction.x || direction.z
            ? transferCellByColumn.get(tileKey(
                cell.grid.x + direction.x,
                cell.grid.z + direction.z,
              ))
            : null;
          const minimumEndpoint = Math.min(fromElevation, toElevation);
          const maximumEndpoint = Math.max(fromElevation, toElevation);
          const rampStartElevation = behind
            ? (behind.elevation + cell.elevation) * 0.5
            : minimumEndpoint;
          const rampEndElevation = ahead
            ? (cell.elevation + ahead.elevation) * 0.5
            : maximumEndpoint;
          const key = absoluteFloorTileKey(cell.grid.x, cell.grid.z, cell.elevation);
          let floor = floorByKey.get(key) ?? null;
          if (floor && floor.roomId && !ownerMatchesFloor(owner, floor)) {
            throwSupplementFloorOwnershipConflict({
              roomId: owner.id,
              point: cell.grid,
              elevation: cell.elevation,
              existingOwnerIds: physicalFloorOwnerIds(floor),
            });
          }
          const surface = form === 'landing' ? 'rampLanding' : 'industrialRamp';
          const options = {
            elevation: cell.elevation,
            level: Number(((cell.elevation - Number(owner.baseElevation ?? 0)) / DEFAULT_TILE_SIZE).toFixed(3)),
            surface,
            roomId: owner.id,
            noEnemySpawn: true,
            augmentationOwnerId: owner.augmentationOperationId ?? owner.id,
            augmentationBlueprintId: transfer.blueprintId
              ?? owner.augmentationBlueprintId
              ?? null,
            augmentationModuleTemplateId: owner.augmentationModuleTemplateId ?? null,
            augmentationModuleKind: owner.augmentationModuleKind ?? null,
            augmentationTransferId: transfer.id,
            augmentationTransferForm: form,
            augmentationTransferKind: transfer.kind ?? transfer.traversalKind ?? form,
            augmentationTransferCellId: cell.id ?? null,
            augmentationCollisionId: cell.collisionId ?? null,
            connectorJunctionOwnerId: owner.isConnectorJunctionProxy ? owner.id : null,
            isDungeonSupplementConnectorFloor: Boolean(owner.isConnectorJunctionProxy),
            isPlatformingSurface: surface !== 'industrialRamp'
              && cell.elevation > Number(owner.baseElevation ?? 0) + 0.05,
            platformGroupId: transfer.id,
            platformPurpose: 'supplement_blueprint_physical_transfer',
            requiredTraversalAction: form,
            supportBaseElevation: Number(owner.baseElevation ?? 0),
            ...(surface === 'industrialRamp' ? {
              rampStartElevation,
              rampEndElevation,
              rampDirectionX: direction.x,
              rampDirectionZ: direction.z,
              rampRouteId: `${transfer.id}:route`,
              rampRunId: `${transfer.id}:physical-footprint`,
            } : {}),
          };
          const preserveExistingLanding = floor?.augmentationTransferForm === 'landing'
            && form !== 'landing';
          if (floor) {
            if (!preserveExistingLanding) applyTileOptions(floor, options);
          } else if (
            Math.abs(
              cell.elevation - Number(owner.baseElevation ?? owner.plannedBaseElevation ?? 0),
            ) <= 0.05
            && (
              !tiles.has(tileKey(cell.grid.x, cell.grid.z))
              || Math.abs(Number(
                tiles.get(tileKey(cell.grid.x, cell.grid.z))?.elevation ?? 0,
              ) - cell.elevation) <= 0.05
            )
          ) {
            floor = setTile(tiles, cell.grid.x, cell.grid.z, 'floor', options);
            applyTileOptions(floor, options);
            if (!floorTiles.includes(floor)) floorTiles.push(floor);
          } else {
            floor = createFloorTile(cell.grid.x, cell.grid.z, options);
            floorTiles.push(floor);
          }
          floor.dungeonSupplement = true;
          floor.surfaceRole = floor.surface === 'industrialRamp' ? 'ramp' : 'landing';
          if (form === 'ramp'
            && floor.surface === 'industrialRamp'
            && Math.abs(Number(floor.rampEndElevation) - Number(floor.rampStartElevation))
              > PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile) {
            floor.steepRamp = true;
          }
          floor.augmentationTransferBidirectional = transfer.bidirectional !== false;
          floor.augmentationTransferStateIds = [...(transfer.stateIds ?? [])];
          floor.augmentationTransferIds = [...new Set([
            ...(floor.augmentationTransferIds ?? []),
            transfer.id,
          ])];
          floor.floorKey = key;
          floorByKey.set(key, floor);
          if (cell.id) floorByAuthoritativeCellId.set(String(cell.id), floor);
        }
      }

      if (!['ladder', 'lift'].includes(form)) {
        owner.supplementTransferIds.push(transfer.id);
        continue;
      }

      const fromFloor = resolveEndpointFloor(owner, transfer, 'from');
      const toFloor = resolveEndpointFloor(owner, transfer, 'to');
      if (!fromFloor || !toFloor) {
        throw new DungeonAugmentationIncompatibleContentError(
          `Supplement blueprint transfer ${transfer.id} in ${owner.id} has no exact floor-backed endpoints.`,
          {
            compatible: false,
            status: 'incompatible-content',
            resetOrAbandonRequired: true,
            roomId: owner.id,
            transferId: transfer.id,
          },
        );
      }

      const footprint = transfer.localFootprint ?? {};
      const widthTiles = Math.max(1, Math.round(Number(
        footprint.widthTiles ?? transfer.widthTiles ?? transfer.w ?? 1,
      )));
      const depthTiles = Math.max(1, Math.round(Number(
        footprint.depthTiles ?? transfer.depthTiles ?? transfer.d ?? 1,
      )));
      const centerGrid = transferCenterGrid(owner, transfer, transferCells);
      const horizontalDelta = {
        x: Math.sign(toFloor.x - fromFloor.x),
        z: Math.sign(toFloor.z - fromFloor.z),
      };
      const horizontalLength = Math.hypot(horizontalDelta.x, horizontalDelta.z);
      const facing = horizontalLength > 0
        ? new THREE.Vector3(
            horizontalDelta.x / horizontalLength,
            0,
            horizontalDelta.z / horizontalLength,
          )
        : new THREE.Vector3(0, 0, 1);
      const bottomFloor = Number(fromFloor.elevation ?? 0) <= Number(toFloor.elevation ?? 0)
        ? fromFloor
        : toFloor;
      const topFloor = bottomFloor === fromFloor ? toFloor : fromFloor;
      const bottomElevation = Number(bottomFloor.elevation ?? 0);
      const topElevation = Number(topFloor.elevation ?? 0);
      const bottomLandingTiles = serializeLandingTiles(
        owner,
        bottomFloor,
        Math.max(3, widthTiles),
        Math.max(3, depthTiles),
      );
      const topLandingTiles = serializeLandingTiles(
        owner,
        topFloor,
        Math.max(3, widthTiles),
        Math.max(3, depthTiles),
      );

      if (form === 'ladder') {
        addTransferLinks(fromFloor, toFloor, 'ladder', transfer);
        const planeNormal = facing.clone();
        const planeCenter = new THREE.Vector3(
          centerGrid.x * tileSize,
          0,
          centerGrid.z * tileSize,
        );
        const bottomExit = new THREE.Vector3(
          bottomFloor.x * tileSize,
          bottomElevation,
          bottomFloor.z * tileSize,
        );
        const topExit = new THREE.Vector3(
          topFloor.x * tileSize,
          topElevation,
          topFloor.z * tileSize,
        );
        owner.augmentationLadderContracts.push({
          id: transfer.id,
          label: 'Supplement Maintenance Ladder',
          connectionId: owner.id,
          center: planeCenter.clone().addScaledVector(planeNormal, 0.4),
          planeCenter,
          planeNormal,
          facing: planeNormal.clone().negate(),
          bottomY: bottomElevation,
          topY: topElevation,
          bottomMountPosition: bottomExit.clone(),
          topMountPosition: topExit.clone(),
          bottomExit,
          topExit,
          bottomExitFacing: planeNormal.clone(),
          topExitFacing: planeNormal.clone().negate(),
          mountRadius: 1.8,
          bodyClearance: 0.4,
          width: Math.min(1.7, Math.max(0.9, widthTiles * tileSize - 0.5)),
          caged: true,
          apertureGridPoint: { x: Math.round(centerGrid.x), z: Math.round(centerGrid.z) },
          landingWidthTiles: Math.max(3, widthTiles),
          landingDepthTiles: Math.max(3, depthTiles),
          landingWidthMeters: Math.max(3, widthTiles) * tileSize,
          landingDepthMeters: Math.max(3, depthTiles) * tileSize,
          bottomLandingTiles,
          topLandingTiles,
          runtimeStateIds: [...(transfer.stateIds ?? [])],
          localStateIds: [...(transfer.localStateIds ?? [])],
          stateRecords: (transfer.stateRecords ?? []).map((record) => ({ ...record })),
          operationId: owner.augmentationOperationId ?? transfer.operationId ?? null,
          augmentationBlueprintId: transfer.blueprintId ?? owner.augmentationBlueprintId ?? null,
          augmentationTransfer: true,
        });
      } else if (form === 'lift') {
        addTransferLinks(fromFloor, toFloor, 'automatic_lift', transfer);
        const platformWidthMeters = widthTiles * tileSize;
        const platformDepthMeters = depthTiles * tileSize;
        const liftCenter = new THREE.Vector3(
          centerGrid.x * tileSize,
          bottomElevation,
          centerGrid.z * tileSize,
        );
        owner.augmentationLiftContracts.push({
          id: transfer.id,
          label: 'Supplement Freight Lift',
          connectionId: owner.id,
          center: liftCenter,
          facing,
          bottomElevation,
          topElevation,
          initialElevation: Number(fromFloor.elevation ?? bottomElevation),
          initialDirection: Number(fromFloor.elevation ?? 0) <= Number(toFloor.elevation ?? 0)
            ? 'up'
            : 'down',
          bottomFloorKey: absoluteFloorTileKey(
            bottomFloor.x,
            bottomFloor.z,
            bottomFloor.elevation,
          ),
          topFloorKey: absoluteFloorTileKey(topFloor.x, topFloor.z, topFloor.elevation),
          platformWidthMeters,
          platformDepthMeters,
          platformThicknessMeters: 0.28,
          shaftWidthMeters: platformWidthMeters + 0.52,
          shaftDepthMeters: platformDepthMeters + 0.52,
          shaftCeilingY: topElevation + 3.6,
          shaftHeadroomMeters: 3.6,
          riderClearanceMeters: 3.6,
          landingWidthTiles: Math.max(3, widthTiles),
          landingDepthTiles: Math.max(3, depthTiles),
          bottomLandingTiles,
          topLandingTiles,
          landingSills: [],
          controlAnchors: null,
          dwellSeconds: 1.25,
          speedMetersPerSecond: 1.8,
          runtimeStateIds: [...(transfer.stateIds ?? [])],
          localStateIds: [...(transfer.localStateIds ?? [])],
          stateRecords: (transfer.stateRecords ?? []).map((record) => ({ ...record })),
          operationId: owner.augmentationOperationId ?? transfer.operationId ?? null,
          augmentationBlueprintId: transfer.blueprintId ?? owner.augmentationBlueprintId ?? null,
          augmentationTransfer: true,
        });
      }

      owner.supplementTransferIds.push(transfer.id);
    }
  }

  return floorTiles;
}

export class DungeonGenerator {
  constructor({
    tileSize = DEFAULT_TILE_SIZE,
    random = Math.random,
    difficulty = 1,
    bossProfileId = null,
    dungeonFamilyId = INDUSTRIAL_DUNGEON_FAMILY_ID,
    roomPreviewId = null,
    augmentationProfileId = null,
    augmentationSeed = null,
    basePlanHash = null,
    committedAugmentationIdentity = null,
  } = {}) {
    this.tileSize = tileSize;
    this.random = random;
    this.difficulty = Math.max(1, Math.trunc(difficulty) || 1);
    this.bossProfileId = typeof bossProfileId === 'string' ? bossProfileId : null;
    this.roomPreviewId = typeof roomPreviewId === 'string' ? roomPreviewId : null;
    this.augmentationProfileId = typeof augmentationProfileId === 'string'
      ? augmentationProfileId
      : null;
    this.augmentationSeed = augmentationSeed == null ? null : String(augmentationSeed);
    this.basePlanHash = typeof basePlanHash === 'string' && basePlanHash
      ? basePlanHash
      : null;
    this.committedAugmentationIdentity = committedAugmentationIdentity
      && typeof committedAugmentationIdentity === 'object'
      ? committedAugmentationIdentity
      : null;
    this.dungeonFamilyId = INDUSTRIAL_DUNGEON_FAMILY_ID;
    this.textureLoader = new THREE.TextureLoader();
    this.fbxLoader = new FBXLoader();
    this.objLoader = new OBJLoader();
    this.gltfLoader = ENABLE_IMPORTED_GLB_ROOMS ? new GLTFLoader() : null;
    this.textureCache = new Map();
  }

  _randomInt(min, max) {
    return min + Math.floor(this.random() * (max - min + 1));
  }

  _choose(values) {
    return values[Math.floor(this.random() * values.length)];
  }

  _planIndustrialDungeonAugmentation({ rooms, connectionPlans }) {
    const committedIdentity = this.committedAugmentationIdentity;
    const profileId = committedIdentity?.profileId ?? this.augmentationProfileId;
    // This branch is deliberately before snapshotting, hashing, or seed
    // derivation. The default Industrial path makes no sidecar calls at all.
    if (!profileId && !committedIdentity) return null;
    const planningStartedAt = globalThis.performance?.now?.() ?? Date.now();
    const withPlanningTime = (diagnostics) => ({
      ...diagnostics,
      planningTimeMs: Math.max(
        0,
        (globalThis.performance?.now?.() ?? Date.now()) - planningStartedAt,
      ),
    });

    const baseDraft = createIndustrialBaseDraft({
      rooms,
      connectionPlans,
      basePlanHash: this.basePlanHash,
      tileSize: this.tileSize,
      difficulty: this.difficulty,
    });
    const host = createIndustrialAugmentationHost({
      basePlanHash: baseDraft.basePlanHash,
      baseDraft,
      rooms,
      connectionPlans,
      tileSize: this.tileSize,
    });
    const result = augmentDungeonDraft({
      baseDraft,
      extensionRegions: host.extensionRegions,
      profileId,
      layoutSeed: this.augmentationSeed ?? baseDraft.basePlanHash,
      augmentationSeed: committedIdentity?.seed
        ?? this.augmentationPlanSeedOverride
        ?? null,
      difficulty: this.difficulty,
    });

    if (result.status !== 'applied') {
      if (committedIdentity) {
        const compatibility = validateCommittedDungeonAugmentationIdentity(
          committedIdentity,
          null,
        );
        throw new DungeonAugmentationIncompatibleContentError(
          'This saved expedition requires generated dungeon content that is no longer available. Reset or abandon the expedition to continue.',
          compatibility,
        );
      }
      return {
        status: 'unchanged',
        baseDraft,
        host,
        result,
        diagnostics: withPlanningTime(result.diagnostics),
      };
    }

    const identity = createDungeonAugmentationSaveIdentity(result.overlayPlan);
    const compatibility = committedIdentity
      ? validateCommittedDungeonAugmentationIdentity(committedIdentity, identity)
      : {
          compatible: true,
          status: 'new-augmentation',
          resetOrAbandonRequired: false,
          errors: [],
        };
    if (committedIdentity && !compatibility.compatible) {
      throw new DungeonAugmentationIncompatibleContentError(
        'The saved dungeon augmentation does not match the installed theme revision or generated plan. Reset or abandon the expedition to continue.',
        compatibility,
      );
    }

    const materialized = materializeIndustrialOverlay({
      rooms,
      connectionPlans,
      overlayPlan: result.overlayPlan,
      extensionRegions: host.extensionRegions,
      tileSize: this.tileSize,
    });
    if (!materialized.diagnostics.accepted) {
      if (committedIdentity) {
        throw new DungeonAugmentationIncompatibleContentError(
          'The saved dungeon augmentation could not be reconstructed. Reset or abandon the expedition to continue.',
          {
            compatible: false,
            status: 'incompatible-content',
            resetOrAbandonRequired: true,
            errors: materialized.diagnostics.errors,
          },
        );
      }
      return {
        status: 'unchanged',
        baseDraft,
        host,
        result,
        diagnostics: withPlanningTime({
          ...result.diagnostics,
          accepted: false,
          reason: 'industrial-materialization-failed',
          errors: materialized.diagnostics.errors,
        }),
      };
    }

    return {
      status: 'applied',
      baseDraft,
      host,
      result,
      identity,
      compatibility,
      materialized,
      diagnostics: withPlanningTime({
        ...result.diagnostics,
        industrialMaterialization: materialized.diagnostics,
      }),
    };
  }

  _connectorDecorativeArchWidthTiles(plan = null) {
    // V1 keeps its exact authored arch footprint for immutable replay. V4
    // galleries are three physical travel lanes and run collision-derived
    // validation, so their inherited columns need a small exterior margin
    // beyond the outer lane's player envelope.
    return Boolean(
      (
        plan?.isDungeonSupplement
          || plan?.isPaddedByDungeonSupplement
          || plan?.hasDungeonSupplementRouteStation
      )
        && !isDungeonGraphOnlyConnection(plan)
        && (
          plan?.hasDungeonSupplementRouteStation
            || plan?.augmentationOperationType === 'routeNetwork'
            || plan?.isRouteNetworkConnection
            || plan?.routeNetworkGrantId
        )
    )
      ? Math.max(CONNECTOR_DECORATIVE_ARCH_WIDTH_TILES, 4)
      : CONNECTOR_DECORATIVE_ARCH_WIDTH_TILES;
  }

  _connectorMinimumClearWidthMeters() {
    return CONNECTOR_MINIMUM_CLEAR_WIDTH_METERS;
  }

  generate() {
    if (this.roomPreviewId === MAGMA_REFINERY_OPENING_MODULE_ID
      || this.roomPreviewId === MAGMA_REFINERY_OPENING_SEQUENCE_ID) {
      return generateMagmaRefineryOpeningSequence({
        random: this.random,
        tileSize: this.tileSize,
        textureLoader: this.textureLoader,
      });
    }

    if (this.roomPreviewId === MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID) {
      return generateMagmaLinearDiggerExcavationRoom({
        random: this.random,
        tileSize: this.tileSize,
        textureLoader: this.textureLoader,
      });
    }

    if (this.roomPreviewId === MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID) {
      return generateMagmaRefractorAssayLabRoom({
        random: this.random,
        tileSize: this.tileSize,
        textureLoader: this.textureLoader,
      });
    }

    if (this.bossProfileId === ASCENSION_ENGINE_PROFILE_ID) {
      return this._generateAscensionEngineDungeon();
    }

    if (this.augmentationProfileId || this.committedAugmentationIdentity) {
      return this._generateIndustrialDungeonWithAugmentationReplay();
    }
    return this._generateAcceptedIndustrialDungeon();
  }

  _finalizeAcceptedIndustrialDungeon(dungeon, generationAttempts) {
    dungeon.generationAttempts = generationAttempts;
    const rollAnchor = dungeon.group.getObjectByName('rollCaskettNpc');
    const supportCarAnchor = dungeon.group.getObjectByName('expeditionSupportCar');
    const workbench = dungeon.group.getObjectByName('rollWorkshopWorkbench');
    dungeon.activateNpcAssets = () => {
      if (
        rollAnchor
        && !rollAnchor.userData.modelLoading
        && !rollAnchor.userData.modelLoaded
        && !rollAnchor.userData.modelLoadError
      ) {
        this._loadRollNpc(
          rollAnchor,
          dungeon.npcAnimationMixers,
          dungeon.npcAnimators,
        );
      }
      if (
        supportCarAnchor
        && !supportCarAnchor.userData.modelLoading
        && !supportCarAnchor.userData.modelLoaded
        && !supportCarAnchor.userData.modelLoadError
      ) {
        this._loadSupportCar(supportCarAnchor);
      }
      if (
        workbench
        && !workbench.userData.textureLoading
        && !workbench.userData.textureAssetsSettled
      ) {
        this._loadRollWorkbenchTextures(workbench);
      }
    };
    dungeon.dungeonFamilyId = INDUSTRIAL_DUNGEON_FAMILY_ID;
    dungeon.roomModuleIds = dungeon.rooms.map((room) => room.id);
    dungeon.spatialGenerationDiagnostics = validateDungeonGenerationSpatialContract(dungeon, {
      contractId: INDUSTRIAL_DUNGEON_GENERATION_CONTRACT_ID,
      requireSignedElevationComposition: false,
    });
    return dungeon;
  }

  _generateAcceptedIndustrialDungeon({ captureAcceptedRandomTape = false } = {}) {
    const sourceRandom = this.random;
    let lastErrors = ['Unknown dungeon validation failure.'];

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const randomTape = [];
      if (captureAcceptedRandomTape) {
        this.random = () => {
          const value = sourceRandom();
          randomTape.push(value);
          return value;
        };
      }
      let dungeon;
      try {
        dungeon = this._generateOnce();
      } finally {
        this.random = sourceRandom;
      }
      if (dungeon.progression?.validation?.accepted) {
        const acceptedDungeon = this._finalizeAcceptedIndustrialDungeon(dungeon, attempt + 1);
        return captureAcceptedRandomTape
          ? { dungeon: acceptedDungeon, randomTape }
          : acceptedDungeon;
      }
      lastErrors = dungeon.progression?.validation?.errors ?? lastErrors;
      this._disposeGeneratedDungeonCandidate(dungeon);
    }

    throw new Error(
      `Unable to generate a solvable vertical dungeon after 12 attempts: ${lastErrors.join(' | ')}`,
    );
  }

  _collectGeneratedDungeonResources(dungeon) {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    const collectMaterial = (material) => {
      if (!material) return;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    };
    dungeon?.group?.traverse?.((object) => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of (Array.isArray(object.material)
        ? object.material
        : [object.material])) {
        collectMaterial(material);
      }
      if (object.skeleton?.boneTexture?.isTexture) textures.add(object.skeleton.boneTexture);
    });
    // A failed generation attempt can throw after the material library is
    // created but before every material has been attached to a mesh. Walk the
    // explicit library too so those attempt-owned resources are not leaked.
    const visitedMaterialSources = new Set();
    const collectMaterialSource = (value) => {
      if (!value || (typeof value !== 'object' && typeof value !== 'function')) return;
      if (value.isTexture) {
        textures.add(value);
        return;
      }
      if (value.isMaterial) {
        collectMaterial(value);
        return;
      }
      if (visitedMaterialSources.has(value)) return;
      visitedMaterialSources.add(value);
      if (Array.isArray(value)) {
        value.forEach(collectMaterialSource);
        return;
      }
      if (value instanceof Map || value instanceof Set) {
        value.forEach(collectMaterialSource);
        return;
      }
      Object.values(value).forEach(collectMaterialSource);
    };
    collectMaterialSource(dungeon?.materials);
    return { geometries, materials, textures };
  }

  _disposeGeneratedDungeonCandidate(dungeon, preservedDungeon = null) {
    if (!dungeon || dungeon === preservedDungeon) return;
    if (dungeon.group?.userData) dungeon.group.userData.generationCandidateDisposed = true;
    const preserved = this._collectGeneratedDungeonResources(preservedDungeon);
    // The generator-level cache owns these textures across attempts. Rejected
    // candidates may dispose their materials and geometry, but disposing a
    // cached texture here would make the next attempt reuse an invalid GPU
    // resource without reloading it.
    for (const texture of this.textureCache.values()) preserved.textures.add(texture);
    for (const animator of dungeon.npcAnimators ?? []) animator.dispose?.();
    dungeon.specialEnvironment?.dispose?.();
    // Fragment disposal owns its detached supplement subtree. Collect the
    // remaining parent-assembled resources only after those roots are gone so
    // the outer cleanup never disposes the same geometry twice.
    for (const resource of dungeon.disposableResources ?? []) resource?.dispose?.();
    const owned = this._collectGeneratedDungeonResources(dungeon);
    dungeon.group?.removeFromParent?.();
    for (const geometry of owned.geometries) {
      if (!preserved.geometries.has(geometry)) geometry.dispose?.();
    }
    for (const material of owned.materials) {
      if (!preserved.materials.has(material)) material.dispose?.();
    }
    for (const texture of owned.textures) {
      if (!preserved.textures.has(texture)) texture.dispose?.();
    }
  }

  _isDisposedGenerationCandidateObject(object) {
    for (let current = object; current; current = current.parent) {
      if (current.userData?.generationCandidateDisposed === true) return true;
    }
    return false;
  }

  _disposeDetachedObjectResources(root) {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    root?.traverse?.((object) => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of (Array.isArray(object.material)
        ? object.material
        : [object.material])) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) textures.add(value);
        }
      }
    });
    for (const geometry of geometries) geometry.dispose?.();
    for (const material of materials) material.dispose?.();
    for (const texture of textures) texture.dispose?.();
    root?.clear?.();
  }

  _generateIndustrialDungeonWithAugmentationReplay() {
    const requestedProfileId = this.augmentationProfileId;
    const committedIdentity = this.committedAugmentationIdentity;
    const sourceRandom = this.random;
    let baseResult;

    this.augmentationProfileId = null;
    this.committedAugmentationIdentity = null;
    try {
      baseResult = this._generateAcceptedIndustrialDungeon({
        captureAcceptedRandomTape: true,
      });
    } finally {
      this.augmentationProfileId = requestedProfileId;
      this.committedAugmentationIdentity = committedIdentity;
      this.random = sourceRandom;
    }

    const { dungeon: baseDungeon, randomTape } = baseResult;
    const originalPlanSeedOverride = this.augmentationPlanSeedOverride;
    const rejectionRecords = [];
    const maximumRealizationAttempts = committedIdentity
      ? 1
      : DUNGEON_AUGMENTATION_MAX_REALIZATION_ATTEMPTS;
    for (let realizationAttempt = 0;
      realizationAttempt < maximumRealizationAttempts;
      realizationAttempt += 1) {
      this.augmentationPlanSeedOverride = committedIdentity?.seed
        ?? (realizationAttempt === 0
          ? null
          : `realization:${this.augmentationSeed ?? this.basePlanHash}:${requestedProfileId}:${realizationAttempt}`);
      let replayCursor = 0;
      let augmentedDungeon = null;
      let replayFailure = null;
      this.random = () => {
        if (replayCursor >= randomTape.length) {
          throw new Error(
            `Dungeon augmentation replay exceeded the accepted parent RNG tape (${randomTape.length} calls).`,
          );
        }
        const value = randomTape[replayCursor];
        replayCursor += 1;
        return value;
      };
      try {
        augmentedDungeon = this._generateOnce();
      } catch (error) {
        replayFailure = error;
      } finally {
        this.random = sourceRandom;
      }

      const replayConsumedExactly = replayCursor === randomTape.length;
      const expectedEarlyAugmentationRejection = new Set([
        'DUNGEON_AUGMENTATION_PLANNING_UNCHANGED',
        'DUNGEON_AUGMENTATION_CONNECTOR_PREFLIGHT_FAILED',
      ]).has(replayFailure?.code);
      const releaseValidationAccepted = Boolean(
        augmentedDungeon?.progression?.validation?.accepted,
      );
      const playableAlphaRequested = (
        requestedProfileId === INDUSTRIAL_SUPPLEMENT_PLAYABLE_ALPHA_PROFILE_ID
      );
      const augmentationPhysicallyRealized = Boolean(
        !replayFailure
        && replayConsumedExactly
        && augmentedDungeon?.augmentationStatus === 'applied'
      );
      // V4 is still an explicit, disabled-by-default preview. Retain a fully
      // materialized first realization for hands-on alpha playtests even while
      // its stricter release validators continue reporting failures. Earlier
      // immutable profiles and the default non-augmentation path retain their
      // exact acceptance/fallback behavior.
      const augmentationAccepted = Boolean(
        augmentationPhysicallyRealized
        && (releaseValidationAccepted || playableAlphaRequested)
      );
      if (augmentationAccepted) {
        const acceptedAsPlayableAlpha = playableAlphaRequested
          && !releaseValidationAccepted;
        this.augmentationPlanSeedOverride = originalPlanSeedOverride;
        this._finalizeAcceptedIndustrialDungeon(
          augmentedDungeon,
          baseDungeon.generationAttempts,
        );
        if (acceptedAsPlayableAlpha) {
          augmentedDungeon.augmentationPlayableAlpha = {
            schema: 'ruindivex-dungeon-augmentation-playable-alpha/v1',
            accepted: true,
            profileId: requestedProfileId,
            releaseValidationAccepted: false,
            releaseValidationErrorCount:
              augmentedDungeon.progression?.validation?.errors?.length ?? 0,
          };
          augmentedDungeon.augmentationDiagnostics = {
            ...augmentedDungeon.augmentationDiagnostics,
            warnings: [
              ...(augmentedDungeon.augmentationDiagnostics?.warnings ?? []),
              'The opt-in V4 playable alpha retained its applied geometry; release-authoritative progression gates remain diagnostic.',
            ],
          };
        }
        augmentedDungeon.augmentationReplayDiagnostics = {
          accepted: true,
          acceptedAsPlayableAlpha,
          releaseValidationAccepted,
          realizationAttempts: realizationAttempt + 1,
          randomCallCount: randomTape.length,
          consumedRandomCallCount: replayCursor,
          parentGenerationAttempts: baseDungeon.generationAttempts,
        };
        this._disposeGeneratedDungeonCandidate(baseDungeon, augmentedDungeon);
        return augmentedDungeon;
      }

      const rejectionDiagnostics = augmentedDungeon?.augmentationDiagnostics
        ?? replayFailure?.augmentationDiagnostics
        ?? null;
      const realizationFailure = classifyDungeonAugmentationRealizationFailure(
        replayFailure,
        rejectionDiagnostics,
      );
      const rejectedErrors = [
        ...(
          augmentedDungeon?.augmentationDiagnostics?.errors
          ?? replayFailure?.augmentationDiagnostics?.errors
          ?? []
        ).map((entry) => (
          typeof entry === 'string'
            ? entry
            : entry?.message ?? JSON.stringify(entry)
        )),
        ...(augmentedDungeon?.progression?.validation?.errors ?? []),
        ...(replayFailure ? [replayFailure.message ?? String(replayFailure)] : []),
        ...(!replayConsumedExactly && !expectedEarlyAugmentationRejection ? [
          `Dungeon augmentation replay consumed ${replayCursor} of ${randomTape.length} parent RNG values.`,
        ] : []),
      ];
      rejectionRecords.push({
        realizationAttempt: realizationAttempt + 1,
        augmentationPlanHash: augmentedDungeon?.augmentationPlanHash ?? null,
        status: augmentedDungeon?.augmentationStatus
          ?? replayFailure?.augmentationDiagnostics?.status
          ?? 'unchanged',
        reason: augmentedDungeon?.augmentationDiagnostics?.reason
          ?? replayFailure?.augmentationDiagnostics?.reason
          ?? (realizationFailure.nonRetryable
            ? 'theme-capability-or-binding-unavailable'
            : null),
        nonRetryable: realizationFailure.nonRetryable,
        failureCategory: realizationFailure.category,
        failureCodes: realizationFailure.codes,
        failureCode: replayFailure?.code ?? null,
        diagnostics: augmentedDungeon?.augmentationDiagnostics
          ?? replayFailure?.augmentationDiagnostics
          ?? null,
        consumedRandomCallCount: replayCursor,
        expectedEarlyAugmentationRejection,
        errors: rejectedErrors,
      });
      this._disposeGeneratedDungeonCandidate(augmentedDungeon, baseDungeon);
      if (committedIdentity) {
        this.augmentationPlanSeedOverride = originalPlanSeedOverride;
        this._disposeGeneratedDungeonCandidate(baseDungeon);
        if (replayFailure instanceof DungeonAugmentationIncompatibleContentError) {
          throw replayFailure;
        }
        throw new DungeonAugmentationIncompatibleContentError(
          'The saved dungeon augmentation failed physical walkability validation. Reset or abandon the expedition to continue.',
          {
            compatible: false,
            status: 'incompatible-content',
            resetOrAbandonRequired: true,
            errors: rejectedErrors,
          },
        );
      }
      const nonRetryablePlanningReasons = new Set([
        'augmentation-disabled',
        'profile-not-found',
        'profile-not-allowed',
        'no-eligible-regions',
        'invalid-input',
        'base-draft-mutated',
      ]);
      if ((!replayConsumedExactly && !expectedEarlyAugmentationRejection)
        || realizationFailure.nonRetryable
        || nonRetryablePlanningReasons.has(rejectionRecords.at(-1)?.reason)) break;
    }
    this.augmentationPlanSeedOverride = originalPlanSeedOverride;
    const finalRejection = rejectionRecords.at(-1) ?? null;

    baseDungeon.augmentationStatus = 'unchanged';
    baseDungeon.augmentationDiagnostics = {
      schema: 'ruindivex-dungeon-augmentation-diagnostics/v1',
      accepted: true,
      requested: true,
      reason: finalRejection?.nonRetryable
        ? finalRejection.reason
        : 'physical-validation-fallback',
      nonRetryable: finalRejection?.nonRetryable === true,
      failureCategory: finalRejection?.failureCategory ?? null,
      failureCodes: finalRejection?.failureCodes ?? [],
      profileId: requestedProfileId,
      basePlanHash: baseDungeon.basePlanHash ?? this.basePlanHash,
      augmentationPlanHash: null,
      effectivePlanHash: baseDungeon.basePlanHash ?? this.basePlanHash,
      errors: [],
      warnings: [
        finalRejection?.nonRetryable
          ? 'The supplemental overlay requires a parent theme capability or binding that is unavailable; the accepted authored parent dungeon was retained unchanged without retrying another seed.'
          : 'The supplemental overlay was rejected; the accepted authored parent dungeon was retained unchanged.',
      ],
      rejectedOverlay: {
        augmentationPlanHash: rejectionRecords.at(-1)?.augmentationPlanHash ?? null,
        randomCallCount: randomTape.length,
        consumedRandomCallCount:
          rejectionRecords.at(-1)?.consumedRandomCallCount ?? 0,
        realizationAttempts: rejectionRecords.length,
        errors: rejectionRecords.at(-1)?.errors ?? [],
        attempts: rejectionRecords,
      },
    };
    baseDungeon.augmentationReplayDiagnostics = {
      accepted: false,
      fallbackToAcceptedBase: true,
      randomCallCount: randomTape.length,
      consumedRandomCallCount:
        rejectionRecords.at(-1)?.consumedRandomCallCount ?? 0,
      parentGenerationAttempts: baseDungeon.generationAttempts,
      realizationAttempts: rejectionRecords.length,
      errors: rejectionRecords.at(-1)?.errors ?? [],
    };
    return baseDungeon;
  }

  _generateAscensionEngineDungeon() {
    const group = new THREE.Group();
    group.name = 'ascensionEngineDedicatedDungeon';
    group.userData.dedicatedBossWorld = true;
    group.userData.bossProfileId = ASCENSION_ENGINE_PROFILE_ID;

    const prepRoot = new THREE.Group();
    prepRoot.name = 'ascensionReliquaryPreparationCamp';
    group.add(prepRoot);

    const prepMaterials = {
      floor: new THREE.MeshStandardMaterial({
        name: 'material_ascensionPrepFloor',
        color: 0x27332f,
        roughness: 0.88,
        metalness: 0.18,
        flatShading: true,
      }),
      trim: new THREE.MeshStandardMaterial({
        name: 'material_ascensionPrepTrim',
        color: 0xb28c45,
        roughness: 0.46,
        metalness: 0.76,
        flatShading: true,
      }),
      dark: new THREE.MeshStandardMaterial({
        name: 'material_ascensionPrepDark',
        color: 0x151a1b,
        roughness: 0.72,
        metalness: 0.64,
        flatShading: true,
      }),
      signal: new THREE.MeshStandardMaterial({
        name: 'material_ascensionPrepSignal',
        color: 0x5ee8ff,
        emissive: 0x126579,
        emissiveIntensity: 1.15,
        roughness: 0.3,
        metalness: 0.28,
        flatShading: true,
      }),
    };
    prepRoot.userData.authoredOwnedMaterials = new Set(Object.values(prepMaterials));

    const addPrepBox = (name, size, position, materialRef = prepMaterials.dark) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), materialRef);
      mesh.name = name;
      mesh.position.set(...position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      prepRoot.add(mesh);
      return mesh;
    };
    const addPrepFrame = (name, width, depth, topY, centerZ) => {
      const railWidth = 0.18;
      const railHeight = 0.08;
      const y = topY + railHeight * 0.5 + 0.002;
      const halfX = width * 0.5 - railWidth * 0.5;
      const halfZ = depth * 0.5 - railWidth * 0.5;
      addPrepBox(`${name}North`, [width, railHeight, railWidth], [0, y, centerZ - halfZ], prepMaterials.trim);
      addPrepBox(`${name}South`, [width, railHeight, railWidth], [0, y, centerZ + halfZ], prepMaterials.trim);
      addPrepBox(`${name}West`, [railWidth, railHeight, depth - railWidth * 2], [-halfX, y, centerZ], prepMaterials.trim);
      addPrepBox(`${name}East`, [railWidth, railHeight, depth - railWidth * 2], [halfX, y, centerZ], prepMaterials.trim);
    };

    const prepCenter = new THREE.Vector3(...ASCENSION_RELIQUARY_SCALE.preparationCampCenter);
    const [prepWidth, prepThickness, prepDepth] = ASCENSION_RELIQUARY_SCALE.preparationCampSize;
    addPrepBox(
      'ascensionPreparationPad',
      [prepWidth, prepThickness, prepDepth],
      [prepCenter.x, prepCenter.y - prepThickness * 0.5, prepCenter.z],
      prepMaterials.floor,
    );
    addPrepFrame('ascensionPreparationPadTrim', prepWidth, prepDepth, prepCenter.y, prepCenter.z);
    for (const side of [-1, 1]) {
      addPrepBox(
        `ascensionPreparationRail_${side < 0 ? 'left' : 'right'}`,
        [0.22, 1.05, prepDepth],
        [side * (prepWidth * 0.5 - 0.11), 0.525, prepCenter.z],
        prepMaterials.dark,
      );
    }
    addPrepBox(
      'ascensionPreparationRearRail',
      [prepWidth, 1.05, 0.22],
      [prepCenter.x, 0.525, prepCenter.z + prepDepth * 0.5 - 0.11],
      prepMaterials.dark,
    );

    // This broken bridge frames the authored shaft entrance but deliberately
    // stops short of it. The only valid transition out of the safe camp is the
    // enterRuin interaction, which locks the selected Boss Hunt before moving
    // the player to the Reliquary checkpoint.
    addPrepBox(
      'ascensionPreparationBrokenBridge',
      [5.2, 0.32, 3.2],
      [0, -0.16, prepCenter.z - prepDepth * 0.5 - 1.6],
      prepMaterials.floor,
    );
    addPrepFrame(
      'ascensionPreparationBrokenBridgeTrim',
      5.2,
      3.2,
      0,
      prepCenter.z - prepDepth * 0.5 - 1.6,
    );

    const entryGate = new THREE.Group();
    entryGate.name = 'ascensionReliquaryEntryGate';
    entryGate.position.set(0, 0, prepCenter.z - prepDepth * 0.5 + 1.2);
    const gateBase = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.32, 0.24, 12),
      prepMaterials.dark,
    );
    gateBase.name = 'ascensionReliquaryEntryGateBase';
    gateBase.position.y = 0.12;
    gateBase.receiveShadow = true;
    const gateRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.82, 0.1, 7, 24),
      prepMaterials.signal,
    );
    gateRing.name = 'ascensionReliquaryEntryGateSignal';
    gateRing.rotation.x = -Math.PI * 0.5;
    gateRing.position.y = 0.27;
    entryGate.add(gateBase, gateRing);
    prepRoot.add(entryGate);

    const createStaticPlatform = ({ id, center, width, depth, object }) => {
      const descriptor = {
        id,
        environmentId: 'verticalTransitReliquary',
        role: 'preparationCamp',
        center: center.clone(),
        halfWidth: width * 0.5,
        halfDepth: depth * 0.5,
        topY: center.y,
        baseY: center.y - 0.5,
        enabled: true,
        active: true,
        oneWay: true,
        dynamic: false,
        blocksBelow: false,
        createsLedgeCandidates: false,
        object,
      };
      descriptor.containsTop = (position, inset = 0) => (
        Math.abs(position.x - descriptor.center.x)
          <= Math.max(0, descriptor.halfWidth - Math.max(0, Number(inset) || 0))
        && Math.abs(position.z - descriptor.center.z)
          <= Math.max(0, descriptor.halfDepth - Math.max(0, Number(inset) || 0))
      );
      descriptor.getTopY = (position) => descriptor.containsTop(position) ? descriptor.topY : null;
      return descriptor;
    };

    const prepPlatform = createStaticPlatform({
      id: 'ascensionPreparationCampFloor',
      center: prepCenter,
      width: prepWidth,
      depth: prepDepth,
      object: prepRoot.getObjectByName('ascensionPreparationPad'),
    });
    const platforms = [prepPlatform];
    const solidZones = [
      {
        id: 'ascensionPreparationRailCollision:left',
        roomId: 'expeditionCamp',
        position: new THREE.Vector3(-prepWidth * 0.5 + 0.11, 0.525, prepCenter.z),
        halfWidth: 0.11,
        halfDepth: prepDepth * 0.5,
        verticalHalfHeight: 0.525,
        obstacleKind: 'authoredReliquarySolid',
      },
      {
        id: 'ascensionPreparationRailCollision:right',
        roomId: 'expeditionCamp',
        position: new THREE.Vector3(prepWidth * 0.5 - 0.11, 0.525, prepCenter.z),
        halfWidth: 0.11,
        halfDepth: prepDepth * 0.5,
        verticalHalfHeight: 0.525,
        obstacleKind: 'authoredReliquarySolid',
      },
      {
        id: 'ascensionPreparationRailCollision:rear',
        roomId: 'expeditionCamp',
        position: new THREE.Vector3(prepCenter.x, 0.525, prepCenter.z + prepDepth * 0.5 - 0.11),
        halfWidth: prepWidth * 0.5,
        halfDepth: 0.11,
        verticalHalfHeight: 0.525,
        obstacleKind: 'authoredReliquarySolid',
      },
    ];

    // The Ascension Engine replaces the ruin interior, never the established
    // expedition exterior. Reuse the same authored hub/camp/entrance builders
    // as a normal generated dungeon so Roll, the Support Car, garage,
    // workbench, reset console, Key Seeker, practice platforms, and Ruin Lift
    // remain exactly where players expect them.
    prepRoot.visible = false;
    prepRoot.removeFromParent();
    platforms.length = 0;
    solidZones.length = 0;
    const exteriorRooms = [
      { id: 'hubTown', type: 'hub', x: 0, z: -20, width: 11, depth: 7 },
      { id: 'expeditionCamp', type: 'camp', x: 0, z: -11, width: 11, depth: 7 },
      { id: 'entrance', type: 'entrance', x: 0, z: 0, width: 9, depth: 9 },
    ];
    this._assignRoomArchetypes(exteriorRooms);
    const exteriorTiles = new Map();
    for (const room of exteriorRooms) addRectRoom(exteriorTiles, room);
    addHallway(exteriorTiles, exteriorRooms[0], exteriorRooms[1]);
    addHallway(exteriorTiles, exteriorRooms[1], exteriorRooms[2]);
    const exteriorFloorTiles = [...exteriorTiles.values()];
    const exteriorMaterials = this._createMaterials();
    for (const tile of exteriorFloorTiles) {
      const visualOwner = new THREE.Group();
      visualOwner.name = 'dungeonFloorTileVisual';
      visualOwner.userData.cameraOcclusionOwner = true;
      visualOwner.userData.roomId = tile.roomId ?? null;
      const mesh = this._createFloorTileMesh(tile, exteriorMaterials);
      mesh.name = `dungeonTile_${tile.type}_level${tile.level ?? 0}`;
      mesh.userData.cameraOcclusionSurface = true;
      mesh.userData.floorTile = {
        x: tile.x,
        z: tile.z,
        roomId: tile.roomId ?? null,
        level: tile.level ?? 0,
        elevation: tile.elevation ?? 0,
        surface: tile.surface ?? tile.type,
      };
      mesh.receiveShadow = true;
      visualOwner.add(mesh);
      this._addTileDetail(visualOwner, tile, exteriorMaterials);
      group.add(visualOwner);
    }
    this._addSolidTraversalVolumes(group, exteriorFloorTiles, exteriorRooms, exteriorMaterials);
    const exteriorOpenAirTileKeys = this._createOpenAirTileKeys(exteriorRooms);
    const exteriorFloorTileLookup = this._createFloorTileLookup(exteriorFloorTiles);
    this._addIndustrialFactoryFeatures(
      group,
      exteriorFloorTiles,
      exteriorMaterials,
      exteriorOpenAirTileKeys,
      exteriorFloorTileLookup,
    );
    this._addIndustrialRoomSetpieces(
      group,
      exteriorRooms,
      exteriorFloorTiles,
      exteriorMaterials,
      solidZones,
    );
    this._addVolumetricIndustrialPrefabs(
      group,
      exteriorRooms,
      exteriorFloorTiles,
      [],
      exteriorMaterials,
      solidZones,
    );
    this._addCeilings(
      group,
      exteriorTiles,
      exteriorMaterials,
      exteriorOpenAirTileKeys,
      exteriorRooms,
    );
    const exteriorAerialBoundaryZones = this._addWalls(
      group,
      exteriorTiles,
      exteriorMaterials,
      exteriorOpenAirTileKeys,
      exteriorRooms,
    );
    this._addInvisibleOpenAirBounds(
      group,
      exteriorTiles,
      exteriorMaterials,
      exteriorOpenAirTileKeys,
    );
    const exteriorDoors = this._addDoors(
      group,
      exteriorRooms,
      exteriorMaterials,
      exteriorTiles,
      [],
      solidZones,
      exteriorAerialBoundaryZones,
    );
    const exteriorLandmarks = this._addRoomLandmarks(
      group,
      exteriorRooms,
      exteriorMaterials,
      exteriorTiles,
      exteriorFloorTiles,
      solidZones,
    );
    platforms.push(
      ...exteriorLandmarks.platforms,
      ...this._createGeneratedPlatformSurfaces(exteriorFloorTiles),
    );

    const stageRoomTiles = Math.ceil(ASCENSION_RELIQUARY_SCALE.chamberDiameter / this.tileSize);
    const stageCenterZ = 25;
    const stageRooms = ASCENSION_RELIQUARY_SEGMENTS.map((segment) => ({
      id: segment.id,
      type: 'bossStage',
      x: 0,
      z: stageCenterZ,
      width: stageRoomTiles,
      depth: stageRoomTiles,
      minY: segment.index === 0 ? ASCENSION_RELIQUARY_SCALE.floorDepth : segment.startHeight,
      maxY: segment.index === ASCENSION_RELIQUARY_SEGMENTS.length - 1
        ? ASCENSION_RELIQUARY_SCALE.shellHeight
        : segment.checkpointHeight,
      centerY: (segment.startHeight + segment.checkpointHeight) * 0.5,
      verticalIndex: segment.index,
      title: segment.title,
      archetypeId: 'vertical_transit_reliquary',
      archetype: segment.title,
      specialEnvironmentId: 'verticalTransitReliquary',
      ceilingHeight: null,
      heightCategory: 'open-shaft',
      purpose: 'A dungeon-scale Ascension Engine traversal and combat segment.',
      mood: 'Open vertical transit ruins surrounding the Ascension Engine.',
      environmentalStory: 'The transit machinery and guardian share one compression system.',
    }));
    const rooms = [...exteriorRooms, ...stageRooms];

    const stage = createVerticalTransitReliquary({
      room: stageRooms[0],
      tileSize: this.tileSize,
      seed: `${this.bossProfileId}:${this.difficulty}:dedicated-world`,
    });
    const dungeonAttachment = { group, platforms, solidZones };
    stage.attachToDungeon(dungeonAttachment);

    const initialCheckpoint = stage.getCheckpoint(0);
    const ruinEntryPosition = initialCheckpoint.position.clone().setY(0);
    const playerStart = this._tileToWorld(
      exteriorRooms[0].x,
      exteriorRooms[0].z,
      exteriorTiles,
    );
    const campReturnPosition = this._tileToWorld(
      exteriorRooms[1].x,
      exteriorRooms[1].z,
      exteriorTiles,
    );
    const summitPosition = stage.getSealStation(3)?.platform?.center?.clone?.()
      ?? stage.center.clone().setY(ASCENSION_RELIQUARY_SEGMENTS[3].checkpointHeight);
    const bossZonePosition = stage.center.clone().setY(0);
    const bossEncounter = {
      id: 'bossEncounter',
      roomId: 'compressionFoundry',
      label: 'VA-RUK 09 · The Ascension Engine',
      roster: ['proceduralBoss'],
      isBoss: true,
      bossProfileId: ASCENSION_ENGINE_PROFILE_ID,
      expeditionSpec: null,
      specialEnvironmentId: 'verticalTransitReliquary',
      roomArchetypeId: 'vertical_transit_reliquary',
      roomFlavorId: null,
      enemyTags: [],
      enemySuppressedTags: [],
      enemyBehaviorModifiers: [],
      enemyHealthMultiplier: 1,
      zone: {
        id: 'bossEncounterZone',
        roomId: 'compressionFoundry',
        position: bossZonePosition,
        halfWidth: ASCENSION_RELIQUARY_SCALE.playableRadius,
        halfDepth: ASCENSION_RELIQUARY_SCALE.playableRadius,
        active: true,
      },
      triggerZone: {
        id: 'ascensionEngineEntryTrigger',
        roomId: 'compressionFoundry',
        position: ruinEntryPosition.clone().setY(0.8),
        halfWidth: 3.8,
        halfDepth: 2.4,
        verticalHalfHeight: 2.2,
        active: true,
      },
      spawnPoints: [stage.center.clone().setY(0)],
      spawned: false,
      cleared: false,
      enemyIds: [],
    };
    const encounters = [bossEncounter];

    const roomConnections = [
      ['hubTown', 'expeditionCamp'],
      ['expeditionCamp', 'entrance'],
      ['entrance', 'compressionFoundry'],
      ['compressionFoundry', 'brokenElevatorSpine'],
      ['brokenElevatorSpine', 'suspendedMachinerySea'],
      ['suspendedMachinerySea', 'summitTrial'],
    ].map(([fromRoomId, toRoomId], index) => {
      const exteriorLink = ['hubTown', 'expeditionCamp', 'entrance'].includes(fromRoomId)
        && ['hubTown', 'expeditionCamp', 'entrance'].includes(toRoomId);
      const entryLift = fromRoomId === 'entrance' && toRoomId === 'compressionFoundry';
      const destinationSegment = ASCENSION_RELIQUARY_SEGMENTS.find((segment) => segment.id === toRoomId);
      return {
        id: `${fromRoomId}_${toRoomId}`,
        fromRoomId,
        toRoomId,
        doorId: null,
        routes: [{
          id: `ascensionAuthoredRoute:${index}`,
          connectorType: exteriorLink
            ? 'groundCorridor'
            : entryLift
              ? 'bossHuntLift'
              : 'authoredVerticalTransit',
          level: exteriorLink || entryLift ? 0 : destinationSegment?.index ?? 0,
          elevation: exteriorLink || entryLift ? 0 : destinationSegment?.startHeight ?? 0,
          purpose: exteriorLink
            ? 'expeditionExterior'
            : entryLift
              ? 'bossHuntEntry'
              : 'checkpointAscent',
          requiredForProgression: true,
        }],
      };
    });
    const mapCenters = new Map([
      ['hubTown', { x: 0, z: 0 }],
      ['expeditionCamp', { x: 0, z: 10 }],
      ['entrance', { x: 0, z: 20 }],
      ['compressionFoundry', { x: 0, z: 34 }],
      ['brokenElevatorSpine', { x: 0, z: 48 }],
      ['suspendedMachinerySea', { x: 0, z: 62 }],
      ['summitTrial', { x: 0, z: 76 }],
    ]);
    const minimapRooms = rooms.map((room) => {
      const center = mapCenters.get(room.id) ?? { x: 0, z: 0 };
      const exterior = ['hub', 'camp', 'entrance'].includes(room.type);
      const width = exterior ? room.width : 12;
      const depth = exterior ? Math.min(7, room.depth) : 10;
      return {
        roomId: room.id,
        roomType: room.type,
        roomBounds2D: {
          x: center.x - width * 0.5,
          z: center.z - depth * 0.5,
          width,
          depth,
        },
        roomCenter2D: { ...center },
        connectedRoomIds: roomConnections
          .filter((connection) => connection.fromRoomId === room.id || connection.toRoomId === room.id)
          .map((connection) => connection.fromRoomId === room.id
            ? connection.toRoomId
            : connection.fromRoomId),
        progressionBand: Math.max(0, (room.verticalIndex ?? -1) + 1),
        isInitialUnlockedArea: exterior,
        containsKeycard: false,
        containsChest: false,
        containsBoss: room.id === 'compressionFoundry',
        containsShrine: false,
        ceilingHeight: null,
        verticalTierCount: 1,
        elevations: Number.isFinite(room.minY) && Number.isFinite(room.maxY)
          ? [room.minY, room.maxY]
          : [0],
        minY: room.minY,
        maxY: room.maxY,
        verticalIndex: room.verticalIndex,
        archetype: room.archetype,
        purpose: room.purpose,
      };
    });
    const minimap = {
      projection: 'ascensionElevation',
      bounds: { minX: -10, minZ: -6, width: 20, depth: 90 },
      rooms: minimapRooms,
      hallways: roomConnections.map((connection) => ({
        hallwayId: connection.id,
        fromRoomId: connection.fromRoomId,
        toRoomId: connection.toRoomId,
        doorId: null,
        routes: connection.routes,
      })),
      markers: [],
    };
    const progression = {
      kind: 'authoredBossWorld',
      profileId: ASCENSION_ENGINE_PROFILE_ID,
      entranceRoomId: 'hubTown',
      ruinEntranceRoomId: 'compressionFoundry',
      bossRoomId: 'compressionFoundry',
      shrineRoomId: null,
      keycards: [],
      doors: [],
      bands: rooms.map((room, index) => ({
        bandId: index,
        roomIds: [room.id],
      })),
      roomConnections,
      keySeeker: exteriorLandmarks.keySeeker,
      shrineKey: null,
      boss: {
        encounterId: bossEncounter.id,
        roomId: bossEncounter.roomId,
        rewardKeycardId: null,
        mustDropShrineKey: false,
      },
      minimap,
      validation: {
        accepted: true,
        authored: true,
        errors: [],
        warnings: ['Dedicated Ascension Engine world uses authored checkpoint progression.'],
      },
    };

    const extractionRoot = new THREE.Group();
    extractionRoot.name = 'ascensionReliquaryReturnLift';
    extractionRoot.position.copy(summitPosition).add(new THREE.Vector3(0, 0.08, 18));
    extractionRoot.visible = false;
    const extractionRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.14, 7, 40),
      prepMaterials.signal,
    );
    extractionRing.name = 'ascensionReliquaryReturnLiftRing';
    extractionRing.rotation.x = -Math.PI * 0.5;
    const extractionBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.26, 7, 8),
      prepMaterials.signal,
    );
    extractionBeam.name = 'ascensionReliquaryReturnLiftBeam';
    extractionBeam.position.y = 3.5;
    extractionRoot.add(extractionRing, extractionBeam);
    group.add(extractionRoot);

    const safeInteractables = [
      ...exteriorLandmarks.safeInteractables,
      {
        id: 'ascensionReliquaryReturnLift',
        label: 'Reliquary Return Lift',
        action: 'extractRuin',
        position: extractionRoot.position.clone(),
        object: extractionRoot,
        color: 0x7df8ff,
        interactionRadius: 3.2,
        requiresRuinComplete: true,
      },
    ];
    const safeZones = this._createRoomZones(exteriorRooms, 'hub')
      .concat(this._createRoomZones(exteriorRooms, 'camp'));

    const rollAnchor = group.getObjectByName('rollCaskettNpc');
    const supportCarAnchor = group.getObjectByName('expeditionSupportCar');
    const workbenchAnchor = group.getObjectByName('rollWorkshopWorkbench');
    const activateNpcAssets = () => {
      if (rollAnchor
        && !rollAnchor.userData.modelLoading
        && !rollAnchor.userData.modelLoaded
        && !rollAnchor.userData.modelLoadError) {
        this._loadRollNpc(
          rollAnchor,
          exteriorLandmarks.npcAnimationMixers,
          exteriorLandmarks.npcAnimators,
        );
      }
      if (supportCarAnchor
        && !supportCarAnchor.userData.modelLoading
        && !supportCarAnchor.userData.modelLoaded
        && !supportCarAnchor.userData.modelLoadError) {
        this._loadSupportCar(supportCarAnchor);
      }
      if (workbenchAnchor
        && !workbenchAnchor.userData.textureLoading
        && !workbenchAnchor.userData.textureAssetsSettled) {
        this._loadRollWorkbenchTextures(workbenchAnchor);
      }
    };

    return {
      dungeonKind: 'ascensionReliquary',
      replacesStandardDungeon: true,
      group,
      rooms,
      tiles: exteriorTiles,
      floorTiles: exteriorFloorTiles,
      verticalConnectors: roomConnections
        .filter((connection) => connection.routes[0]?.connectorType === 'authoredVerticalTransit')
        .map((connection, index) => ({
        id: `ascensionVerticalConnector:${index}`,
        fromRoomId: connection.fromRoomId,
        toRoomId: connection.toRoomId,
        connectorType: 'authoredVerticalTransit',
        })),
      connectionPlans: [],
      verticalPortals: [],
      roomArchetypes: rooms.map((room) => ({
        id: room.id,
        type: room.type,
        archetype: room.archetype,
        archetypeId: room.archetypeId,
        flavor: null,
        flavorId: null,
        layoutVariant: room.specialEnvironmentId
          ? 'dedicatedAscensionWorld'
          : room.layoutVariant ?? room.type,
        purpose: room.purpose,
        mood: room.mood,
        environmentalStory: room.environmentalStory,
        ceilingHeight: null,
        verticalPlan: {
          minY: room.minY,
          maxY: room.maxY,
          centerY: room.centerY,
          verticalIndex: room.verticalIndex,
        },
        specialEnvironmentId: room.specialEnvironmentId,
        progressionBand: Math.max(0, (room.verticalIndex ?? -1) + 1),
      })),
      layoutVariant: {
        id: 'dedicatedAscensionWorld',
        profileId: ASCENSION_ENGINE_PROFILE_ID,
        authored: true,
      },
      progression,
      minimap,
      doors: exteriorDoors,
      keycards: [],
      keySeeker: exteriorLandmarks.keySeeker,
      chests: [],
      mechanisms: [],
      puzzleBlocks: [],
      pressurePlates: [],
      conveyorPuzzles: [],
      platforms,
      npcAnimationMixers: exteriorLandmarks.npcAnimationMixers,
      npcAnimators: exteriorLandmarks.npcAnimators,
      safeInteractables,
      safeZones,
      solidZones,
      aerialBoundaryZones: exteriorAerialBoundaryZones,
      encounters,
      traps: [],
      conveyors: [],
      shrine: null,
      tileSize: this.tileSize,
      playerStart,
      playerStartFacing: new THREE.Vector3(0, 0, 1),
      campReturnPosition,
      campReturnFacing: new THREE.Vector3(0, 0, 1),
      ruinEntryPosition,
      ruinEntryFacing: new THREE.Vector3(0, 0, -1),
      ruinExitPosition: summitPosition.clone(),
      extractionPosition: summitPosition.clone(),
      enemySpawnPoints: [],
      shrinePosition: summitPosition,
      boundsRadius: 120,
      renderCullGroups: [],
      specialEnvironment: stage,
      specialEnvironmentId: stage.id,
      generationAttempts: 1,
      activateNpcAssets,
    };
  }

  _generateOnce() {
    let generationCandidateGroup = null;
    let materials = null;
    let dungeonSupplementFragment = null;
    let dungeonSupplementThemeSession = null;
    let generationCandidateNpcAnimators = [];
    let generationCandidateSpecialEnvironment = null;
    try {
    const tiles = new Map();
    const side = this.random() < 0.5 ? -1 : 1;
    const secondarySide = this.random() < 0.65 ? -side : side;
    const enemyNestZ = this._randomInt(14, 17);
    const keycardZ = enemyNestZ + this._randomInt(18, 22);
    const trapZ = keycardZ + this._randomInt(20, 24);
    // Keep progression bands physically separated. Side-room footprints and
    // their corridors must not overlap the next locked band, otherwise a
    // player can walk around a closed critical door through the floor union.
    const conveyorZ = trapZ + this._randomInt(28, 32);
    const bossZ = conveyorZ + this._randomInt(24, 28);
    const shrineZ = bossZ + this._randomInt(24, 28);
    const enemyNestX = this._choose([0, side * 2, -side * 2]);
    // Reserve real exterior machinery bays between the unchanged V1 rooms.
    // Alternating the authored room footprints across the dungeon axis gives
    // slope, ladder, and lift connectors enough collision-free length without
    // stretching every remaining service corridor into one long straight.
    const keycardX = side * this._randomInt(18, 21);
    const trapX = -side * this._randomInt(18, 21);
    const conveyorX = side * this._randomInt(14, 17);
    const bossX = -side * this._randomInt(15, 18);
    const shrineX = side * this._randomInt(13, 16);
    const serverSide = this.random() < 0.5 ? side : -side;
    const bonusSide = this.random() < 0.5 ? side : -side;
    const machineSide = -bonusSide;
    const coolantSide = secondarySide;
    const layoutVariant = {
      side,
      enemyNestZ,
      serverSide,
      machineSide,
      coolantSide,
      keycardZ,
      trapZ,
      conveyorZ,
      bossZ,
      shrineZ,
    };
    const mainRooms = [
      { id: 'hubTown', type: 'hub', x: 0, z: -20, width: 11, depth: 7 },
      { id: 'expeditionCamp', type: 'camp', x: 0, z: -11, width: 11, depth: 7 },
      { id: 'entrance', type: 'entrance', x: 0, z: 0, width: 9, depth: 9 },
      { id: 'enemyNest', type: 'enemy', x: enemyNestX, z: enemyNestZ, width: 15, depth: 13 },
      // The keycard chamber is deliberately oversized so the pyramid is the
      // room, rather than a small prop competing with unrelated scaffolding.
      { id: 'keycardRoom', type: 'keycard', x: keycardX, z: keycardZ, width: 23, depth: 21 },
      { id: 'trapRoom', type: 'trap', x: trapX, z: trapZ, width: 17, depth: this._choose([15, 17]) },
      { id: 'conveyorRoom', type: 'conveyor', x: conveyorX, z: conveyorZ, width: 21, depth: 17 },
      {
        id: 'bossRoom',
        type: 'boss',
        x: bossX,
        z: bossZ,
        width: 21,
        depth: 19,
        specialEnvironmentId: this.bossProfileId === ASCENSION_ENGINE_PROFILE_ID
          ? 'verticalTransitReliquary'
          : null,
      },
      { id: 'shrineRoom', type: 'shrine', x: shrineX, z: shrineZ, width: 25, depth: 23 },
    ];
    const serverRoom = {
      id: 'alienServerRoom',
      type: 'server',
      x: enemyNestX + serverSide * this._randomInt(16, 19),
      z: enemyNestZ + this._randomInt(-3, 3),
      width: 15,
      depth: 13,
      prefabYaw: serverSide > 0 ? -Math.PI / 2 : Math.PI / 2,
    };
    const machineFactoryRoom = {
      id: 'machineFactoryRoom',
      type: 'machine',
      x: conveyorX + machineSide * this._randomInt(21, 25),
      z: conveyorZ + this._randomInt(-3, 3),
      width: 19,
      depth: 15,
      prefabYaw: machineSide > 0 ? -Math.PI / 2 : Math.PI / 2,
    };
    const coolantRelayRoom = {
      id: 'coolantRelayRoom',
      type: 'coolant',
      x: trapX + coolantSide * this._randomInt(18, 22),
      z: trapZ + this._randomInt(-4, 5),
      width: 19,
      depth: 17,
      prefabYaw: coolantSide > 0 ? -Math.PI / 2 : Math.PI / 2,
      puzzle: {
        type: 'coolantRelay',
        valves: ['teal', 'amber', 'violet'],
        masterConsoleId: 'coolantRelayMasterConsole',
        failureEncounterId: 'coolantRelayDefense',
      },
    };
    const bonusVault = {
      id: 'bonusVault',
      type: 'bonus',
      // Keep a real corridor gap between the factory and vault footprints.
      // The old 15-19 tile offset could overlap their floors, making the
      // pressure-plate door trivial to walk around.
      x: conveyorX + bonusSide * this._randomInt(22, 25),
      z: conveyorZ + this._randomInt(-4, 5),
      width: this._choose([13, 15]),
      depth: 13,
    };
    let rooms = [...mainRooms, serverRoom, machineFactoryRoom, coolantRelayRoom, bonusVault];
    this._assignRoomArchetypes(rooms);
    const unvariedConnectionPlans = this._createElevationConnectionPlans(rooms);
    const maximumConnectorAssignmentAttempts = 48;
    const connectorAssignmentRejections = [];
    let connectorPlanning = null;
    let connectorFootprintReservation = null;
    for (let assignmentAttempt = 0;
      assignmentAttempt < maximumConnectorAssignmentAttempts;
      assignmentAttempt += 1) {
      const candidatePlanning = planDungeonConnectorVariantAssignments(unvariedConnectionPlans, {
        tileSize: this.tileSize,
        assignmentAttempt,
      });
      const candidateReservation = reserveDungeonConnectorFamilyFootprints(
        candidatePlanning.connectionPlans,
      );
      if (!connectorPlanning) {
        connectorPlanning = candidatePlanning;
        connectorFootprintReservation = candidateReservation;
      }
      if (candidatePlanning.diagnostics.accepted && candidateReservation.diagnostics.accepted) {
        connectorPlanning = candidatePlanning;
        connectorFootprintReservation = candidateReservation;
        break;
      }
      connectorAssignmentRejections.push({
        assignmentAttempt,
        planningErrors: [...candidatePlanning.diagnostics.errors],
        reservationErrors: [...candidateReservation.diagnostics.errors],
      });
    }
    const connectorAssignmentSearchDiagnostics = {
      accepted: Boolean(
        connectorPlanning?.diagnostics?.accepted
        && connectorFootprintReservation?.diagnostics?.accepted
      ),
      maximumAttempts: maximumConnectorAssignmentAttempts,
      evaluatedAttemptCount: connectorAssignmentRejections.length
        + Number(Boolean(
          connectorPlanning?.diagnostics?.accepted
          && connectorFootprintReservation?.diagnostics?.accepted
        )),
      selectedAssignmentAttempt: connectorPlanning?.diagnostics?.assignmentAttempt ?? null,
      rejections: connectorAssignmentRejections,
      errors: [],
    };
    if (!connectorAssignmentSearchDiagnostics.accepted) {
      connectorAssignmentSearchDiagnostics.errors.push(
        `No collision-free connector family assignment was found in ${maximumConnectorAssignmentAttempts} deterministic attempts.`,
      );
    }
    let connectionPlans = connectorFootprintReservation.connectionPlans;
    for (const room of rooms) {
      room.plannedBaseElevation = Number(connectorPlanning.roomElevations[room.id] ?? 0);
    }
    const connectorVariantValidation = validateDungeonConnectorVariantAssignments(
      unvariedConnectionPlans,
      connectionPlans,
    );
    if (this.augmentationProfileId || this.committedAugmentationIdentity) {
      // The sidecar must reserve the exact authored gallery footprint that
      // Industrial will realize later, including widened turns and the lower
      // aprons of slopes/ladders/lifts. A centerline-only proxy can otherwise
      // approve a supplemental room above or below a real traversal lane.
      // Stamp into a throwaway renderer-free tile map: this makes no RNG calls
      // and leaves the disabled Industrial path completely untouched.
      const augmentationPlanningTiles = new Map();
      for (const room of rooms) addRectRoom(augmentationPlanningTiles, room);
      this._stampConnectionPlans(augmentationPlanningTiles, connectionPlans);
      this._addConnectorExplorationSpaces(
        augmentationPlanningTiles,
        rooms,
        connectionPlans,
      );
    }
    let dungeonAugmentation = this._planIndustrialDungeonAugmentation({
      rooms,
      connectionPlans,
    });
    if (dungeonAugmentation?.status === 'unchanged') {
      // A rejected renderer-free plan does not need a complete duplicate base
      // scene. The replay wrapper retains the already accepted parent dungeon
      // and either tries another isolated augmentation seed or falls back.
      const planningError = new Error(
        `Dungeon augmentation planning returned unchanged (${dungeonAugmentation.diagnostics?.reason ?? 'unknown'}).`,
      );
      planningError.code = 'DUNGEON_AUGMENTATION_PLANNING_UNCHANGED';
      planningError.augmentationDiagnostics = dungeonAugmentation.diagnostics;
      throw planningError;
    }
    let supplementAssemblyStartedAt = null;
    let connectorJunctionProxies = [];
    let supplementAssemblyValidation = {
      accepted: true,
      errors: [],
      warnings: [],
      details: { requested: dungeonAugmentation?.status === 'applied' },
    };
    let authoritativeConnectorWallOpenings = null;
    let authoritativeBoundaryWallRuns = null;
    const augmentationApplied = dungeonAugmentation?.status === 'applied';
    const augmentationOverlayPlan = dungeonAugmentation?.result?.overlayPlan ?? null;
    const usesAuthoritativeV4Geometry = Boolean(
      augmentationApplied
      && augmentationOverlayPlan?.schema === DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA
      && augmentationOverlayPlan?.profileId === 'industrial-supplement-preview-v4'
      && Number(augmentationOverlayPlan?.profileRevision ?? 0) >= 5,
    );
    if (augmentationApplied) {
      rooms = dungeonAugmentation.materialized.rooms;
      connectorJunctionProxies = dungeonAugmentation.materialized.connectorJunctionProxies ?? [];
      connectionPlans = dungeonAugmentation.materialized.connectionPlans;
    }
    const connectorAssemblyRooms = [...rooms, ...connectorJunctionProxies];
    const tileConnectionPlans = connectionPlans.filter((plan) => (
      !isDungeonGraphOnlyConnection(plan)
    ));
    const legacyConnectionPlans = connectionPlans.filter((plan) => (
      !plan.isDungeonSupplement
    ));

    for (const room of rooms) {
      addAuthoredRoomFloor(tiles, room);
    }
    let elevatedConnectorJunctionCoreFloors = [];
    let supplementalRewardTiles = [];
    let supplementalTrapTiles = [];
    if (dungeonAugmentation?.status === 'applied') {
      supplementalRewardTiles = createIndustrialSupplementRewardTiles(
        rooms.filter((room) => room.isDungeonSupplement),
        this.tileSize,
      );
      supplementalTrapTiles = this._createDungeonSupplementTrapTiles(
        rooms.filter((room) => room.isDungeonSupplement),
      );
    }

    const keycardRoom = rooms.find((room) => room.id === 'keycardRoom');
    const trapRoom = rooms.find((room) => room.id === 'trapRoom');
    const conveyorRoom = rooms.find((room) => room.id === 'conveyorRoom');
    if (keycardRoom) {
      setTile(tiles, keycardRoom.x - side, keycardRoom.z - 1, 'chest');
    }
    if (conveyorRoom) {
      setTile(tiles, conveyorRoom.x, conveyorRoom.z, 'floor', {
        roomId: conveyorRoom.id,
        forceType: true,
      });
      setTile(tiles, conveyorRoom.x + side, conveyorRoom.z + 1, 'chest');
    }
    if (machineFactoryRoom) {
      const halfW = Math.floor(machineFactoryRoom.width / 2);
      const halfD = Math.floor(machineFactoryRoom.depth / 2);
      for (let z = machineFactoryRoom.z - halfD + 2; z <= machineFactoryRoom.z + halfD - 2; z += 1) {
        setConveyorTile(tiles, machineFactoryRoom.x, z, {
          directionZ: 1,
          speed: 1.55,
          surface: 'machineAssemblyConveyor',
        });
      }
      for (const x of [machineFactoryRoom.x - halfW + 3, machineFactoryRoom.x + halfW - 3]) {
        for (let z = machineFactoryRoom.z - halfD + 3; z <= machineFactoryRoom.z + halfD - 3; z += 1) {
          setConveyorTile(tiles, x, z, {
            directionZ: x < machineFactoryRoom.x ? -1 : 1,
            speed: 1.25,
            surface: 'machineSideConveyor',
          });
        }
      }
    }
    setTile(tiles, serverRoom.x - serverSide * 2, serverRoom.z, 'chest');
    setTile(tiles, machineFactoryRoom.x - machineSide * 3, machineFactoryRoom.z + 1, 'chest');
    setTile(tiles, coolantRelayRoom.x - coolantSide * 4, coolantRelayRoom.z + 2, 'chest');
    setTile(tiles, bonusVault.x, bonusVault.z, 'floor', {
      roomId: bonusVault.id,
      surface: 'vaultSanctumFloor',
      forceType: true,
    });

    this._stampConnectionPlans(tiles, tileConnectionPlans);
    if (dungeonAugmentation?.status === 'applied') {
      elevatedConnectorJunctionCoreFloors = stampDungeonSupplementConnectorJunctionCores(
        tiles,
        connectorJunctionProxies,
        tileConnectionPlans,
      );
    }
    // Physical supplement branches are real Industrial galleries. They must
    // receive the same three-lane footprint, elevation surfaces, and envelope
    // validation as authored connections; graph-only padding records remain
    // excluded because their parent logical connection owns that shell.
    this._addConnectorExplorationSpaces(tiles, connectorAssemblyRooms, tileConnectionPlans);

    this._applyIndustrialFactoryLayout(tiles, rooms, legacyConnectionPlans);
    const conveyorPuzzleValidation = this._applyConveyorPuzzleTemplates(tiles, rooms);
    const solidZones = [
      ...this._createSolidCollisionZones(rooms),
      ...this._createDungeonSupplementManifestSolidZones(connectorAssemblyRooms),
    ];
    const factoryLevelTiles = this._createFactoryLevelTiles(
      tiles,
      rooms,
      tileConnectionPlans,
      solidZones,
    );
    let floorTiles = [
      ...tiles.values(),
      ...factoryLevelTiles,
      ...elevatedConnectorJunctionCoreFloors,
    ];
    if (dungeonAugmentation?.status === 'applied') {
      floorTiles = stampDungeonSupplementBlueprintTransfers(
        tiles,
        connectorAssemblyRooms,
        floorTiles,
        this.tileSize,
      );
      // Industrial materialization emits V4 room tiers and transfer cells in
      // absolute world Y. The legacy room kit below is local-Y and must still
      // receive its graph offset, so mark only materialized supplement owners
      // as already committed before the shared elevation pass.
      const absoluteSupplementRoomIds = new Set(rooms
        .filter((room) => room.isDungeonSupplement)
        .map((room) => String(room.id)));
      const supplementRoomById = new Map(rooms
        .filter((room) => absoluteSupplementRoomIds.has(String(room.id)))
        .map((room) => [String(room.id), room]));
      for (const floor of floorTiles) {
        const room = supplementRoomById.get(String(floor?.roomId ?? ''));
        if (!room) continue;
        const baseElevation = Number(room.baseElevation ?? room.plannedBaseElevation ?? 0);
        floor.roomBaseElevation = baseElevation;
        floor.localElevation = Number(floor.elevation ?? 0) - baseElevation;
        floor.floorKey = absoluteFloorTileKey(floor.x, floor.z, floor.elevation ?? 0);
        floor.absoluteRoomElevationCommitted = true;
      }
    }
    const roomElevationCommit = this._commitResolvedRoomElevations({
      rooms,
      tiles,
      floorTiles,
      connectionPlans: legacyConnectionPlans,
      solidZones,
    });
    floorTiles = this._applyConnectorTraversalSurfaces(tiles, tileConnectionPlans, floorTiles);
    // Structural connector envelopes reserve wall/ceiling columns only. They
    // are never player footing and must not leak into rendering, navigation,
    // room coverage, or connector-width validation as disconnected floor
    // strips beneath an elevated route.
    const structuralEnvelopeFloorRecordCount = floorTiles.filter((tile) => (
      tile?.structuralEnvelopeOnly === true
        || tile?.surface === 'connectorStructuralEnvelope'
        || tile?.type === 'connectorEnvelope'
    )).length;
    floorTiles = floorTiles.filter((tile) => (
      tile?.structuralEnvelopeOnly !== true
        && tile?.surface !== 'connectorStructuralEnvelope'
        && tile?.type !== 'connectorEnvelope'
    ));
    const floorIdentityNormalization = canonicalizeAbsoluteFloorTiles(floorTiles, {
      trackOwnerProvenance: dungeonAugmentation?.status === 'applied',
    });
    floorTiles = floorIdentityNormalization.floorTiles;
    if (dungeonAugmentation?.status === 'applied') {
      const resolveAuthoredAnchorFloor = (record, kind) => {
        const candidates = floorTiles.filter((floor) => (
          String(floor.roomId ?? '') === String(record.roomId)
            && floor.x === record.x
            && floor.z === record.z
        )).sort((left, right) => (
          Math.abs(Number(left.elevation ?? 0) - Number(record.elevation ?? 0))
            - Math.abs(Number(right.elevation ?? 0) - Number(record.elevation ?? 0))
        ));
        const floor = candidates[0] ?? null;
        if (!floor || Math.abs(
          Number(floor.elevation ?? 0) - Number(record.elevation ?? 0)
        ) > 0.1) {
          throw new DungeonAugmentationIncompatibleContentError(
            `Supplement ${kind} ${record.id} has no exact authored supporting floor.`,
            {
              compatible: false,
              status: 'incompatible-content',
              resetOrAbandonRequired: true,
              roomId: record.roomId,
              anchorId: record.id,
              requestedElevation: record.elevation,
            },
          );
        }
        return floor;
      };
      for (const reward of supplementalRewardTiles) {
        const floor = resolveAuthoredAnchorFloor(reward, 'reward');
        floor.type = 'chest';
        applyTileOptions(floor, {
          roomId: reward.roomId,
          dungeonSupplementRewardId: reward.id,
          dungeonSupplementRewardStateId: reward.runtimeStateId,
          dungeonSupplementRewardProfileId: reward.rewardProfileId,
          dungeonSupplementRewardRecipe: reward.rewardRecipe,
        });
      }
      for (const trap of supplementalTrapTiles) {
        const floor = resolveAuthoredAnchorFloor(trap, 'hazard');
        floor.type = 'trap';
        applyTileOptions(floor, {
          roomId: trap.roomId,
          dungeonSupplementTrapId: trap.id,
          dungeonSupplementTrapStateId: trap.runtimeStateId,
          dungeonSupplementTrapProfileId: trap.hazardProfileId,
          dungeonSupplementTrapRecipe: trap.hazardRecipe,
          augmentationOwnerId: trap.operationId,
        });
      }
    }
    const connectorTrackTrapEligiblePlans = connectionPlans.filter((plan) => (
      !plan.isPaddedByDungeonSupplement
      && (
        !plan.isDungeonSupplement
        || Boolean(plan.connectorVariant)
      )
    ));
    const connectorTrapSeed = connectorTrackTrapEligiblePlans.map((plan) => [
      plan.id,
      plan.connectorVariantId ?? 'level',
      plan.sourceElevation,
      plan.destinationElevation,
      plan.fromSocket?.x,
      plan.fromSocket?.z,
      plan.toSocket?.x,
      plan.toSocket?.z,
    ].join(':')).join('|');
    const connectorTrackTrapGlobalExclusions = createDungeonConnectorTrackTrapGlobalExclusions(
      connectorTrackTrapEligiblePlans,
      connectorAssemblyRooms,
      { tileSizeMeters: this.tileSize },
    );
    const connectorTrackTrapPlanning = planDungeonConnectorTrackTraps(
      connectorTrackTrapEligiblePlans,
      {
      seed: connectorTrapSeed,
      tileSizeMeters: this.tileSize,
      bayCandidatesByConnectionId: new Map(connectorTrackTrapEligiblePlans.map((plan) => [
        plan.id,
        plan.flatBayCandidates ?? [],
      ])),
      extraExclusionVolumesByConnectionId: connectorTrackTrapGlobalExclusions,
      },
    );
    const connectorAssemblyValidation = this._validateConnectorTraversalAssembly({
      floorTiles,
      tiles,
      rooms: connectorAssemblyRooms,
      connectionPlans: tileConnectionPlans,
    });
    floorTiles = this._enforceGeneratedWalkability(floorTiles, rooms);
    this._finalizeRoomVerticalPlans(rooms, floorTiles, legacyConnectionPlans);
    const progressionAccessValidation = this._validateProgressionAccess(
      floorTiles,
      tiles,
      rooms,
      legacyConnectionPlans,
    );
    const coolantWalkabilityValidation = this._validateCoolantRoomWalkability(floorTiles, tiles, rooms, solidZones);
    const floorTileLookup = this._createFloorTileLookup(floorTiles);

    if (dungeonAugmentation?.status === 'applied') {
      // Prove every supplemental threshold has a floor, a bidirectional
      // approach, global reachability, and a carved wall aperture before any
      // Three.js object or material is created. A second validation later also
      // includes solid zones contributed by assembled authored setpieces.
      const preflightOpenAirTileKeys = this._createOpenAirTileKeys(rooms);
      const preflightConnectorWallOpenings = this._createConnectorWallOpeningMap(
        connectionPlans,
      );
      const preflightBoundaryWallRuns = this._collectBoundaryWallRuns(
        tiles,
        preflightOpenAirTileKeys,
        usesAuthoritativeV4Geometry ? connectorAssemblyRooms : rooms,
        preflightConnectorWallOpenings,
        usesAuthoritativeV4Geometry ? floorTiles : null,
      );
      // These immutable pre-render records are the authoritative supplemental
      // shell realization. Rendering, collision, aperture diagnostics, and
      // the final platformability pass all consume these same runs instead of
      // independently reconstructing a second wall silhouette later.
      if (usesAuthoritativeV4Geometry) {
        authoritativeConnectorWallOpenings = preflightConnectorWallOpenings;
        authoritativeBoundaryWallRuns = preflightBoundaryWallRuns;
      }
      const connectorEntrancePreflight = this._validateConnectorEntranceWalkability({
        floorTiles,
        rooms: connectorAssemblyRooms,
        solidZones,
        // Structural wall runs are checked explicitly below. Pre-assembly
        // room solids include connector dressing footprints that must not be
        // mistaken for wall planes between adjacent floor centers.
        segmentBarrierZones: [],
        connectionPlans,
        wallRuns: preflightBoundaryWallRuns,
        useSegmentBarriers: true,
      });
      if (!connectorEntrancePreflight.accepted) {
        const preflightError = new Error(
          `Dungeon augmentation failed connector entrance preflight: ${connectorEntrancePreflight.errors.join(' | ')}`,
        );
        preflightError.code = 'DUNGEON_AUGMENTATION_CONNECTOR_PREFLIGHT_FAILED';
        preflightError.augmentationDiagnostics = {
          status: 'unchanged',
          reason: 'connector-entrance-preflight-failed',
          errors: connectorEntrancePreflight.errors,
          connectorEntrances: connectorEntrancePreflight.details,
        };
        throw preflightError;
      }
    }

    generationCandidateGroup = new THREE.Group();
    const group = generationCandidateGroup;
    group.name = 'randomizedRuinLayout';
    materials = this._createMaterials();
    if (dungeonAugmentation?.status === 'applied') {
      const extensionRegion = dungeonAugmentation.host.extensionRegions[0];
      supplementAssemblyStartedAt = globalThis.performance?.now?.() ?? Date.now();
      try {
        dungeonSupplementThemeSession = this._createIndustrialDungeonThemeSession(
          materials,
          extensionRegion.themeBinding,
        );
        dungeonSupplementFragment = assembleDungeonSupplement({
          // The hashed planner overlay remains immutable identity. Assembly
          // consumes the materializer's deep-cloned authoritative physical
          // realization so manifest masks, tiers, collisions, anchors, and
          // recipes—not generic grammar proxies—drive the Three.js facade.
          overlayPlan: dungeonAugmentation.materialized.assemblyOverlayPlan
            ?? dungeonAugmentation.result.overlayPlan,
          themeSessions: new Map([[extensionRegion.id, dungeonSupplementThemeSession]]),
          themeSession: dungeonSupplementThemeSession,
          tileSize: this.tileSize,
          structuralMode: 'facadeOnly',
          rootName: 'DungeonSupplementRuntimeFacade',
        });
      } catch (error) {
        dungeonSupplementThemeSession?.resources?.disposeOwned?.();
        dungeonSupplementThemeSession = null;
        const assemblyFailure = {
          code: error?.code ?? 'DUNGEON_SUPPLEMENT_ASSEMBLY_FAILED',
          message: error?.message ?? String(error),
        };
        const realizationFailure = classifyDungeonAugmentationRealizationFailure(error, {
          errors: [assemblyFailure],
        });
        if (this.committedAugmentationIdentity) {
          throw new DungeonAugmentationIncompatibleContentError(
            'The saved dungeon augmentation cannot be assembled by the installed parent theme. Reset or abandon the expedition to continue.',
            {
              compatible: false,
              status: 'incompatible-content',
              resetOrAbandonRequired: true,
              errors: [assemblyFailure],
            },
          );
        }
        if (realizationFailure.nonRetryable) {
          const nonRetryableError = error instanceof Error
            ? error
            : new Error(assemblyFailure.message);
          nonRetryableError.augmentationDiagnostics = {
            status: 'unchanged',
            reason: 'theme-capability-or-binding-unavailable',
            nonRetryable: true,
            failureCategory: realizationFailure.category,
            failureCodes: realizationFailure.codes,
            errors: [assemblyFailure],
          };
          throw nonRetryableError;
        }
        supplementAssemblyValidation = {
          accepted: false,
          errors: [assemblyFailure],
          warnings: [],
          details: { requested: true, reason: 'theme-assembly-failed' },
        };
      }
    }

    for (const tile of floorTiles) {
      if (tile.surface === 'industrialRamp') {
        continue;
      }
      const elevation = tile.elevation ?? 0;
      const visualOwner = new THREE.Group();
      visualOwner.name = 'dungeonFloorTileVisual';
      visualOwner.userData.cameraOcclusionOwner = true;
      visualOwner.userData.roomId = tile.roomId ?? null;
      visualOwner.userData.connectorId = tile.connectorId ?? null;
      if (tile.augmentationOwnerId) {
        visualOwner.userData.augmentationOwnerId = tile.augmentationOwnerId;
      }
      if (tile.connectorJunctionOwnerId) {
        visualOwner.userData.connectorJunctionOwnerId = tile.connectorJunctionOwnerId;
        visualOwner.userData.isDungeonSupplementConnectorFloor = true;
      }
      const mesh = this._createFloorTileMesh(tile, materials);
      mesh.name = `dungeonTile_${tile.type}_level${tile.level ?? 0}`;
      mesh.userData.cameraOcclusionSurface = true;
      mesh.userData.floorTile = {
        x: tile.x,
        z: tile.z,
        roomId: tile.roomId ?? null,
        level: tile.level ?? 0,
        elevation,
        surface: tile.surface ?? tile.type,
        rampStartElevation: tile.rampStartElevation,
        rampEndElevation: tile.rampEndElevation,
        rampDirectionX: tile.rampDirectionX,
        rampDirectionZ: tile.rampDirectionZ,
        connectionId: tile.connectionId,
        connectorId: tile.connectorId,
        ...(tile.augmentationOwnerId ? { augmentationOwnerId: tile.augmentationOwnerId } : {}),
        ...(tile.augmentationBlueprintId ? {
          augmentationBlueprintId: tile.augmentationBlueprintId,
        } : {}),
        ...(tile.augmentationFloorTierId ? {
          augmentationFloorTierId: tile.augmentationFloorTierId,
          augmentationFloorTierRuntimeId: tile.augmentationFloorTierRuntimeId ?? null,
          augmentationFloorCellId: tile.augmentationFloorCellId ?? null,
        } : {}),
        ...(tile.augmentationTransferId ? {
          augmentationTransferId: tile.augmentationTransferId,
          augmentationTransferForm: tile.augmentationTransferForm ?? null,
          augmentationTransferKind: tile.augmentationTransferKind ?? null,
          augmentationTransferCellId: tile.augmentationTransferCellId ?? null,
        } : {}),
        ...(tile.augmentationCollisionId ? {
          augmentationCollisionId: tile.augmentationCollisionId,
        } : {}),
        ...(tile.connectorJunctionOwnerId ? {
          connectorJunctionOwnerId: tile.connectorJunctionOwnerId,
          isDungeonSupplementConnectorFloor: true,
        } : {}),
        connectorZone: tile.connectorZone,
        platformGroupId: tile.platformGroupId,
        supportStyle: tile.supportStyle,
        massGroupId: tile.massGroupId,
        isPlatformingSurface: Boolean(tile.isPlatformingSurface),
        isLedgeSurface: Boolean(tile.isLedgeSurface),
        platformPurpose: tile.platformPurpose,
        requiredTraversalAction: tile.requiredTraversalAction,
        ledgeEdges: tile.ledgeEdges ?? null,
        allowsGroundedDropLanding: Boolean(tile.allowsGroundedDropLanding),
        dropSpaceId: tile.dropSpaceId ?? null,
        preserveProgressionFooting: Boolean(tile.preserveProgressionFooting),
      };
      mesh.receiveShadow = true;
      visualOwner.add(mesh);

      this._addTileDetail(visualOwner, tile, materials);
      group.add(visualOwner);
    }
    this._addSolidTraversalVolumes(group, floorTiles, rooms, materials);
    const blueprintTransferFixturePlans = dungeonAugmentation?.status === 'applied'
      ? connectorAssemblyRooms
        .filter((owner) => (
          (owner.augmentationLadderContracts?.length ?? 0) > 0
          || (owner.augmentationLiftContracts?.length ?? 0) > 0
        ))
        .map((owner) => ({
          id: `${owner.id}:blueprint-transfers`,
          ladderContracts: owner.augmentationLadderContracts ?? [],
          liftContracts: owner.augmentationLiftContracts ?? [],
          isDungeonSupplementBlueprintTransferFixture: true,
        }))
      : [];
    const connectorFixtures = this._addConnectorTraversalPrefabs(
      group,
      [
        ...(dungeonAugmentation?.status === 'applied'
          ? tileConnectionPlans
          : legacyConnectionPlans),
        ...blueprintTransferFixturePlans,
      ],
      materials,
      solidZones,
    );
    const connectorTrackTrapInfrastructure = this._addConnectorTrackTrapInfrastructure(
      group,
      connectorTrackTrapPlanning.connectorTrackTraps,
      materials,
    );

    const openAirTileKeys = this._createOpenAirTileKeys(rooms);
    this._addIndustrialFactoryFeatures(group, floorTiles, materials, openAirTileKeys, floorTileLookup);
    this._addIndustrialRoomSetpieces(group, rooms, floorTiles, materials, solidZones);
    this._addVolumetricIndustrialPrefabs(
      group,
      rooms,
      floorTiles,
      tileConnectionPlans,
      materials,
      solidZones,
    );
    this._addCeilings(
      group,
      tiles,
      materials,
      openAirTileKeys,
      usesAuthoritativeV4Geometry ? connectorAssemblyRooms : rooms,
      usesAuthoritativeV4Geometry ? floorTiles : null,
    );
    // The sidecar owns these apertures. Keeping the legacy shell call exactly
    // unchanged while augmentation is off preserves Industrial V1 output/RNG.
    const connectorWallOpenings = augmentationApplied
      ? authoritativeConnectorWallOpenings
        ?? this._createConnectorWallOpeningMap(connectionPlans)
      : new Map();
    const boundaryWallRuns = usesAuthoritativeV4Geometry
      ? authoritativeBoundaryWallRuns
        ?? this._collectBoundaryWallRuns(
          tiles,
          openAirTileKeys,
          connectorAssemblyRooms,
          connectorWallOpenings,
          floorTiles,
        )
      : null;
    const aerialBoundaryZones = this._addWalls(
      group,
      tiles,
      materials,
      openAirTileKeys,
      usesAuthoritativeV4Geometry ? connectorAssemblyRooms : rooms,
      connectorWallOpenings,
      boundaryWallRuns,
    );
    const realizedBoundaryWallRuns = boundaryWallRuns ?? this._collectBoundaryWallRuns(
      tiles,
      openAirTileKeys,
      usesAuthoritativeV4Geometry ? connectorAssemblyRooms : rooms,
      connectorWallOpenings,
      usesAuthoritativeV4Geometry ? floorTiles : null,
    );
    this._addInvisibleOpenAirBounds(group, tiles, materials, openAirTileKeys);
    const doors = this._addDoors(
      group,
      rooms,
      materials,
      tiles,
      augmentationApplied ? tileConnectionPlans : legacyConnectionPlans,
      solidZones,
      aerialBoundaryZones,
      {
        preserveAdjacentConnectorEntrances: augmentationApplied,
        connectorWallOpenings,
        // Progression gates always belong at the source threshold so a
        // rejected objective cannot send the player down a dead-end corridor.
        // This is an Industrial V1 rule, not an augmentation-only behavior.
        lockedGatesAtCorridorEntrances: true,
      },
    );
    let validationSolidZones = this._createDungeonAugmentationValidationSolidZones(
      solidZones,
      dungeonSupplementFragment,
      augmentationApplied,
    );
    const validationSegmentBarrierZones = augmentationApplied
      ? [
          ...aerialBoundaryZones,
          ...(dungeonSupplementFragment?.solidZones ?? []),
        ]
      : null;
    let criticalDoorValidation = this._validateCriticalDoorChokepoints({
      floorTiles,
      rooms,
      solidZones: validationSolidZones,
      doors,
      // Preserve the exact legacy validation path when augmentation is off.
      // Supplemental padding can route through threshold wings between tile
      // centers, so its effective graph also needs segment-vs-wall collision.
      useSegmentBarriers: augmentationApplied,
    });
    let connectorEntranceValidation = augmentationApplied
      ? this._validateConnectorEntranceWalkability({
          floorTiles,
          rooms: connectorAssemblyRooms,
          solidZones: validationSolidZones,
          segmentBarrierZones: validationSegmentBarrierZones,
          // Padded-edge physical records are graph-only for shell assembly,
          // but their internal room thresholds are still real player entrances
          // and must pass the same aperture/reachability proof as stamped galleries.
          connectionPlans,
          wallRuns: realizedBoundaryWallRuns,
          useSegmentBarriers: true,
        })
      : {
          accepted: true,
          errors: [],
          warnings: [],
          details: {
            checkedSocketCount: 0,
            acceptedSocketCount: 0,
            reachableNodeCount: 0,
            checks: [],
            skipped: true,
            reason: 'augmentation-disabled',
          },
        };
    const verticalPortals = this._addVerticalConnectionPortals(
      group,
      legacyConnectionPlans,
      materials,
    );
    const v4SupplementalRewardFloorTiles = usesAuthoritativeV4Geometry
      ? floorTiles.filter((tile) => Boolean(
          tile.dungeonSupplementRewardId
            || tile.dungeonSupplementRewardStateId
            || tile.dungeonSupplementRewardProfileId,
        ))
      : [];
    const landmarks = this._addRoomLandmarks(
      group,
      rooms,
      materials,
      tiles,
      floorTiles,
      solidZones,
      v4SupplementalRewardFloorTiles,
    );
    if (augmentationApplied) {
      // Shortcut controls are connection-scoped rather than room-content
      // anchors, so the Industrial adapter must materialize them explicitly.
      // Keep the generic sidecar record authoritative for identity/state while
      // presenting it through Industrial's existing terminal factory.
      for (const plan of tileConnectionPlans.filter((candidate) => (
        candidate.oneSideActivatedShortcut
        || ['shortcut-lift', 'drop-ladder'].includes(String(candidate.shortcutMode ?? ''))
      ))) {
        const destinationSocket = plan.toSocket;
        if (!destinationSocket || !plan.shortcutMechanismId) continue;
        const position = new THREE.Vector3(
          Number(destinationSocket.x ?? 0) * this.tileSize,
          Number(destinationSocket.elevation ?? plan.destinationElevation ?? 0),
          Number(destinationSocket.z ?? 0) * this.tileSize,
        );
        const terminal = this._addMechanismTerminal(group, position, materials);
        terminal.name = `${plan.shortcutMechanismId}Interactable`;
        landmarks.mechanisms.push({
          id: String(plan.shortcutMechanismId),
          mechanismId: String(plan.shortcutMechanismId),
          stateId: plan.shortcutStateId == null ? null : String(plan.shortcutStateId),
          shortcutStateId: plan.shortcutStateId == null ? null : String(plan.shortcutStateId),
          runtimeStateIds: plan.shortcutStateId == null ? [] : [String(plan.shortcutStateId)],
          type: 'dungeonSupplementShortcut',
          label: plan.shortcutMode === 'drop-ladder'
            ? 'Deploy shortcut ladder'
            : 'Enable shortcut route',
          shortcutMode: plan.shortcutMode,
          shortcutAction: plan.shortcutMode === 'drop-ladder'
            ? 'deploy-ladder'
            : 'unlock-lift',
          scopedAction: 'unlockShortcut',
          connectionId: plan.id,
          targetConnectionId: plan.id,
          roomId: plan.toRoomId,
          position: position.clone(),
          object: terminal,
          initialState: plan.shortcutInitialState,
          activatedState: plan.shortcutActivatedState,
          activationSide: 'far-side',
          oneSideActivated: true,
          permanentOnActivation: plan.shortcutPersistent !== false,
          operationId: plan.augmentationOperationId ?? null,
          activated: false,
          isDungeonSupplement: true,
          dungeonSupplement: true,
        });
      }
      for (const room of rooms.filter(({ isDungeonSupplement }) => isDungeonSupplement)) {
        for (const anchor of (room.augmentationAnchors ?? []).filter((anchor) => (
          anchor.kind === 'progression'
            && Boolean(anchor.mechanismProfileId || anchor.mechanismRecipe)
        ))) {
          const position = new THREE.Vector3(
            Number(anchor.position?.x ?? room.x * this.tileSize),
            Number(anchor.position?.y ?? room.baseElevation ?? 0),
            Number(anchor.position?.z ?? room.z * this.tileSize),
          );
          const terminal = this._addMechanismTerminal(group, position, materials);
          const mechanismId = String(anchor.id ?? `${room.id}:local-control`);
          terminal.name = `${mechanismId}Interactable`;
          const controlledHazardProfileIds = (anchor.mechanismRecipe?.effects ?? [])
            .filter(({ kind }) => kind === 'disable-local-hazard')
            .flatMap(({ targetProfileIds }) => targetProfileIds ?? [])
            .map(String);
          landmarks.mechanisms.push({
            id: mechanismId,
            mechanismId,
            stateId: anchor.runtimeStateId == null ? null : String(anchor.runtimeStateId),
            runtimeStateIds: anchor.runtimeStateId == null ? [] : [String(anchor.runtimeStateId)],
            type: 'dungeonSupplementLocalControl',
            label: anchor.label ?? 'Isolate local hazard grid',
            scopedAction: 'controlLocalHazards',
            roomId: room.id,
            targetRoomId: room.id,
            targetOperationId: room.augmentationOperationId ?? null,
            controlledHazardProfileIds,
            mechanismProfileId: anchor.mechanismProfileId ?? null,
            mechanismRecipe: anchor.mechanismRecipe ?? null,
            position: position.clone(),
            object: terminal,
            activated: false,
            initialState: anchor.mechanismRecipe?.stateMachine?.initialState ?? 'armed',
            activatedState: anchor.mechanismRecipe?.stateMachine?.transition?.to ?? 'isolated',
            operationId: room.augmentationOperationId ?? null,
            isDungeonSupplement: true,
            dungeonSupplement: true,
          });
        }
      }
    }
    generationCandidateNpcAnimators = landmarks.npcAnimators ?? [];
    landmarks.platforms.push(...this._createGeneratedPlatformSurfaces(floorTiles));
    landmarks.platforms.push(...connectorFixtures.platforms);
    const specialEnvironmentRoom = rooms.find((room) => room.specialEnvironmentId === 'verticalTransitReliquary');
    const specialEnvironment = specialEnvironmentRoom
      ? createVerticalTransitReliquary({
        room: specialEnvironmentRoom,
        tileSize: this.tileSize,
        seed: `${this.bossProfileId}:${this.difficulty}:${specialEnvironmentRoom.x}:${specialEnvironmentRoom.z}`,
      })
      : null;
    generationCandidateSpecialEnvironment = specialEnvironment;
    if (specialEnvironment) {
      specialEnvironment.attachToDungeon({ group, platforms: landmarks.platforms, solidZones });
    }
    validationSolidZones = this._createDungeonAugmentationValidationSolidZones(
      solidZones,
      dungeonSupplementFragment,
      augmentationApplied,
    );
    if (augmentationApplied) {
      // Theme products and authored landmarks may contribute collision after
      // the renderer-free preflight. Re-run both barrier-aware proofs against
      // the exact final collision candidate before accepting the overlay.
      criticalDoorValidation = this._validateCriticalDoorChokepoints({
        floorTiles,
        rooms,
        solidZones: validationSolidZones,
        doors,
        useSegmentBarriers: true,
      });
      connectorEntranceValidation = this._validateConnectorEntranceWalkability({
        floorTiles,
        rooms: connectorAssemblyRooms,
        solidZones: validationSolidZones,
        segmentBarrierZones: validationSegmentBarrierZones,
        connectionPlans,
        wallRuns: realizedBoundaryWallRuns,
        useSegmentBarriers: true,
      });
    }
    const encounters = this._createEncounterDefinitions(
      rooms,
      floorTiles,
      validationSolidZones,
    );
    if (dungeonAugmentation?.status === 'applied') {
      encounters.push(...this._createDungeonSupplementEncounterDefinitions(
        rooms.filter((room) => room.isDungeonSupplement),
        floorTiles,
        validationSolidZones,
      ));
    }
    const trapVisualsByRoom = new Map(landmarks.trapVisuals.map((entry) => [entry.roomId, entry.object]));
    const supplementalTraps = dungeonAugmentation?.status === 'applied'
      ? this._createDungeonSupplementTrapZones(
          rooms.filter((room) => room.isDungeonSupplement),
          floorTiles,
        )
      : [];

    const enemySpawnPoints = rooms
      .filter((room) => !['hub', 'camp', 'entrance', 'bonus'].includes(room.type))
      .flatMap((room) => this._roomSpawnPoints(room, floorTiles, validationSolidZones));
    const hubRoom = rooms.find((room) => room.id === 'hubTown') ?? rooms[0];
    const campRoom = rooms.find((room) => room.id === 'expeditionCamp') ?? hubRoom;
    const entranceRoom = rooms.find((room) => room.id === 'entrance') ?? campRoom;
    const shrineRoom = rooms.find((room) => room.id === 'shrineRoom') ?? rooms.at(-1);
    const progression = createDungeonProgressionData({
      rooms,
      doors,
      landmarks,
      chests: landmarks.chests,
      encounters,
      connectionPlans: legacyConnectionPlans,
    });
    if (dungeonAugmentation?.status === 'applied') {
      const supplementalRoomConnections = connectionPlans
        .map(createDungeonSupplementProgressionConnection)
        .filter(Boolean);
      const paddedLogicalConnectionIds = new Set(
        connectionPlans
          .filter((plan) => (
            plan.isDungeonSupplement
            && plan.isPaddedByDungeonSupplement
            && !isDungeonGraphOnlyConnection(plan)
          ))
          .map((plan) => String(plan.logicalConnectionId ?? plan.id)),
      );
      progression.supplementalRoomConnections = supplementalRoomConnections;
      // DungeonController uses roomConnections for reachability and discovery.
      // Replace padded logical edges only after the authored validator has
      // accepted the unchanged parent graph. The immutable base snapshot still
      // retains those records for diagnostics and fallback.
      progression.roomConnections = [
        ...progression.roomConnections.filter((connection) => (
          !paddedLogicalConnectionIds.has(String(connection.id))
        )),
        ...supplementalRoomConnections,
      ];
      const supplementalRoomsByBand = new Map();
      for (const room of rooms.filter((candidate) => candidate.isDungeonSupplement)) {
        const rawBandId = Number(
          room.progressionBand
            ?? room.augmentationProgressionBandId
            ?? room.augmentationProgressionBand
            ?? room.augmentationAccessBand
            ?? 0,
        );
        const bandId = Number.isFinite(rawBandId) ? rawBandId : 0;
        if (!supplementalRoomsByBand.has(bandId)) supplementalRoomsByBand.set(bandId, []);
        supplementalRoomsByBand.get(bandId).push(room.id);
      }
      progression.bands = progression.bands.map((band) => ({
        ...band,
        roomIds: [
          ...(band.roomIds ?? []),
          ...(supplementalRoomsByBand.get(Number(band.bandId)) ?? []),
        ],
      }));
      for (const [bandId, roomIds] of supplementalRoomsByBand) {
        if (progression.bands.some((band) => Number(band.bandId) === bandId)) continue;
        progression.bands.push({
          bandId,
          label: `Supplement access band ${bandId}`,
          roomIds: [...roomIds],
        });
      }
      const supplementalDoorIds = new Set(supplementalRoomConnections
        .map((connection) => connection.doorId)
        .filter(Boolean));
      for (const runtimeDoor of doors.filter((door) => (
        door.isDungeonSupplement || supplementalDoorIds.has(door.id)
      ))) {
        if (progression.doors.some((door) => door.doorId === runtimeDoor.id)) continue;
        progression.doors.push({
          doorId: runtimeDoor.id,
          displayName: runtimeDoor.label ?? 'Supplement Security Gate',
          requiredKeycardId: runtimeDoor.requiredKeycardId ?? null,
          requiredCredentialIds: [...(runtimeDoor.requiredCredentialIds ?? [])],
          requiredEncounterStateIds: [...(runtimeDoor.requiredEncounterStateIds ?? [])],
          requiredMechanismStateIds: [...(runtimeDoor.requiredMechanismStateIds ?? [])],
          requiredShortcutStateIds: [...(runtimeDoor.requiredShortcutStateIds ?? [])],
          requiredStateIds: [...(runtimeDoor.requiredStateIds ?? [])],
          requiredPressurePlateIds: [...(runtimeDoor.requiredPressurePlateIds ?? [])],
          requiresEncounterState: (runtimeDoor.requiredEncounterStateIds?.length ?? 0) > 0,
          requiresMechanismState: (runtimeDoor.requiredMechanismStateIds?.length ?? 0) > 0,
          requiresShortcutState: (runtimeDoor.requiredShortcutStateIds?.length ?? 0) > 0,
          requiresState: Boolean(
            runtimeDoor.requiresState
            || (runtimeDoor.requiredStateIds?.length ?? 0) > 0
          ),
          requiresPressurePlate: Boolean(
            runtimeDoor.requiresPressurePlate
            || (runtimeDoor.requiredPressurePlateIds?.length ?? 0) > 0
          ),
          requirementsMalformed: runtimeDoor.requirementsMalformed === true,
          progressionTier: runtimeDoor.progressionTier ?? null,
          leadsToDepthBand: Number(runtimeDoor.leadsToDepthBand ?? 0),
          isCriticalPathDoor: false,
          isShrineDoor: false,
          isDungeonSupplement: true,
          fromRoomId: runtimeDoor.fromRoomId,
          toRoomId: runtimeDoor.toRoomId,
          position: runtimeDoor.position?.clone?.() ?? runtimeDoor.position ?? null,
        });
      }
      const effectiveAdjacency = new Map();
      const connectRooms = (fromRoomId, toRoomId) => {
        if (!fromRoomId || !toRoomId) return;
        if (!effectiveAdjacency.has(fromRoomId)) effectiveAdjacency.set(fromRoomId, new Set());
        effectiveAdjacency.get(fromRoomId).add(toRoomId);
      };
      for (const connection of progression.roomConnections) {
        connectRooms(connection.fromRoomId, connection.toRoomId);
        connectRooms(connection.toRoomId, connection.fromRoomId);
      }
      progression.minimap = {
        ...progression.minimap,
        rooms: (progression.minimap?.rooms ?? []).map((room) => ({
          ...room,
          connectedRoomIds: [...(effectiveAdjacency.get(room.roomId) ?? [])],
        })),
        hallways: (progression.minimap?.hallways ?? []).filter((hallway) => (
          !paddedLogicalConnectionIds.has(String(hallway.hallwayId ?? hallway.id))
          && !isDungeonGraphOnlyConnection(hallway)
        )),
      };
      const parentProgressionValidation = progression.validation;
      const effectiveProgressionValidation = new DungeonValidator(progression).validate();
      progression.validation = {
        ...parentProgressionValidation,
        effectiveGraph: effectiveProgressionValidation,
        accepted: Boolean(
          parentProgressionValidation?.accepted
          && effectiveProgressionValidation.accepted
        ),
        errors: [
          ...(parentProgressionValidation?.errors ?? []),
          ...effectiveProgressionValidation.errors,
        ],
        warnings: [
          ...(parentProgressionValidation?.warnings ?? []),
          ...effectiveProgressionValidation.warnings,
        ],
      };
    }
    const platformabilityValidation = this._validatePlatformability({
      floorTiles,
      rooms: connectorAssemblyRooms,
      solidZones: validationSolidZones,
      segmentBarrierZones: validationSegmentBarrierZones,
      connectionPlans: tileConnectionPlans,
      doors,
      landmarks,
      encounters,
      useSegmentBarriers: augmentationApplied,
    });
    progression.validation = {
      ...progression.validation,
      platformability: platformabilityValidation.details,
      physicalProgression: criticalDoorValidation.details,
      ...(dungeonAugmentation ? {
        connectorEntrances: connectorEntranceValidation.details,
        supplementAssembly: supplementAssemblyValidation.details,
      } : {}),
      connectorAssembly: connectorAssemblyValidation.details,
      connectorPlanning: connectorPlanning.diagnostics,
      connectorAssignmentSearch: connectorAssignmentSearchDiagnostics,
      connectorFootprintReservation: connectorFootprintReservation.diagnostics,
      connectorTrackTraps: connectorTrackTrapPlanning.diagnostics,
      roomElevationCommit,
      accepted: Boolean(
        progression.validation?.accepted
        && progressionAccessValidation.accepted
        && coolantWalkabilityValidation.accepted
        && conveyorPuzzleValidation.accepted
        && connectorPlanning.diagnostics.accepted
        && connectorAssignmentSearchDiagnostics.accepted
        && connectorFootprintReservation.diagnostics.accepted
        && connectorVariantValidation.ok
        && connectorTrackTrapPlanning.diagnostics.accepted
        && connectorAssemblyValidation.accepted
        && connectorEntranceValidation.accepted
        && supplementAssemblyValidation.accepted
        && criticalDoorValidation.accepted
        && platformabilityValidation.accepted
      ),
      errors: [
        ...(progression.validation?.errors ?? []),
        ...progressionAccessValidation.errors,
        ...coolantWalkabilityValidation.errors,
        ...conveyorPuzzleValidation.errors,
        ...connectorPlanning.diagnostics.errors,
        ...connectorAssignmentSearchDiagnostics.errors,
        ...connectorFootprintReservation.diagnostics.errors,
        ...connectorVariantValidation.errors,
        ...connectorTrackTrapPlanning.diagnostics.errors,
        ...connectorAssemblyValidation.errors,
        ...connectorEntranceValidation.errors,
        ...supplementAssemblyValidation.errors,
        ...criticalDoorValidation.errors,
        ...platformabilityValidation.errors,
      ],
      warnings: [
        ...(progression.validation?.warnings ?? []),
        ...progressionAccessValidation.warnings,
        ...coolantWalkabilityValidation.warnings,
        ...conveyorPuzzleValidation.warnings,
        ...connectorAssemblyValidation.warnings,
        ...connectorEntranceValidation.warnings,
        ...supplementAssemblyValidation.warnings,
        ...criticalDoorValidation.warnings,
        ...platformabilityValidation.warnings,
      ],
    };
    let dungeonSupplementRoot = null;
    let augmentationAssemblyMetrics = null;
    if (dungeonAugmentation?.status === 'applied' && dungeonSupplementFragment) {
      // Industrial's host-stamped rooms already own their encounter and chest
      // runtime records. Keep the generic assembler's normalized graph,
      // minimap, lights, resources, and future audio records without creating
      // duplicate interactables.
      dungeonSupplementFragment.encounters = [];
      dungeonSupplementFragment.enemySpawnPoints = [];
      dungeonSupplementFragment.chests = [];
      dungeonSupplementFragment.traps = [];
      dungeonSupplementFragment.platforms = [];
      dungeonSupplementRoot = this._createDungeonSupplementRoot(group, {
        roomIds: dungeonAugmentation.materialized.supplementalRoomIds,
        connectorIds: dungeonAugmentation.materialized.supplementalPhysicalConnectionIds
          ?? dungeonAugmentation.materialized.supplementalConnectionIds,
      });
      const runtimeFacadeRoot = dungeonSupplementFragment.root;
      const disposeRuntimeFacade = dungeonSupplementFragment.dispose;
      const runtimeFacadeObjects = new Set();
      runtimeFacadeRoot?.traverse?.((object) => runtimeFacadeObjects.add(object));
      dungeonSupplementRoot.add(runtimeFacadeRoot);
      dungeonSupplementFragment.runtimeFacadeRoot = runtimeFacadeRoot;
      dungeonSupplementFragment.root = dungeonSupplementRoot;
      dungeonSupplementFragment.group = dungeonSupplementRoot;
      dungeonSupplementFragment.supplementRoot = dungeonSupplementRoot;
      let supplementDisposed = false;
      dungeonSupplementFragment.dispose = () => {
        if (supplementDisposed) return;
        supplementDisposed = true;
        const supplementObjects = new Set();
        dungeonSupplementRoot.traverse((object) => supplementObjects.add(object));
        const externallyReferencedGeometries = new Set();
        group.traverse((object) => {
          if (!supplementObjects.has(object) && object.geometry) {
            externallyReferencedGeometries.add(object.geometry);
          }
        });
        disposeRuntimeFacade?.();
        const disposedGeometries = new Set();
        dungeonSupplementRoot.traverse((object) => {
          if (
            object.geometry
            && !runtimeFacadeObjects.has(object)
            && !externallyReferencedGeometries.has(object.geometry)
            && !disposedGeometries.has(object.geometry)
          ) {
            object.geometry.dispose?.();
            disposedGeometries.add(object.geometry);
          }
        });
        dungeonSupplementRoot.removeFromParent();
      };
      const materialReferences = new Set();
      const geometryReferences = new Set();
      let objectCount = 0;
      let meshCount = 0;
      let lightCount = 0;
      let triangleCount = 0;
      dungeonSupplementRoot.traverse((object) => {
        objectCount += 1;
        if (object.isLight) lightCount += 1;
        if (!object.isMesh) return;
        meshCount += 1;
        if (object.geometry) {
          geometryReferences.add(object.geometry);
          triangleCount += Math.floor(
            (object.geometry.index?.count ?? object.geometry.attributes?.position?.count ?? 0) / 3,
          ) * Math.max(1, Number(object.count ?? 1));
        }
        for (const material of (Array.isArray(object.material)
          ? object.material
          : [object.material])) {
          if (material) materialReferences.add(material);
        }
      });
      const supplementalRoomIds = new Set(
        dungeonAugmentation.materialized.supplementalRoomIds,
      );
      augmentationAssemblyMetrics = {
        planningTimeMs: dungeonAugmentation.diagnostics.planningTimeMs ?? null,
        assemblyTimeMs: Math.max(
          0,
          (globalThis.performance?.now?.() ?? Date.now())
            - (supplementAssemblyStartedAt ?? (globalThis.performance?.now?.() ?? Date.now())),
        ),
        operationCount: dungeonAugmentation.result.overlayPlan.operations?.length ?? 0,
        roomCount: supplementalRoomIds.size,
        physicalConnectionCount: tileConnectionPlans.filter((plan) => (
          plan.isDungeonSupplement || plan.isPaddedByDungeonSupplement
        )).length,
        graphOnlyConnectionCount: connectionPlans.filter((plan) => (
          plan.isSupplementGraphConnection
          || plan.connectorVariantConstraints?.graphOnly === true
        )).length,
        tileCount: floorTiles.filter((tile) => (
          supplementalRoomIds.has(tile.roomId)
          || String(tile.augmentationOwnerId ?? '').startsWith('supplement:')
        )).length,
        objectCount,
        meshCount,
        lightCount,
        drawCallUpperBound: meshCount,
        triangleCount,
        geometryReferenceCount: geometryReferences.size,
        materialReferenceCount: materialReferences.size,
        localLightRecordCount: dungeonSupplementFragment.localLights?.length ?? 0,
      };
    }
    const renderCullGroups = this._createStaticRenderCullGroups(group, [
      doors,
      verticalPortals,
      landmarks.keycards,
      landmarks.keySeeker,
      landmarks.chests,
      landmarks.mechanisms,
      landmarks.puzzleBlocks,
      landmarks.pressurePlates,
      landmarks.safeInteractables,
      landmarks.trapVisuals,
      landmarks.shrine,
      connectorFixtures.ladders,
      connectorFixtures.lifts,
      connectorTrackTrapInfrastructure,
    ]);

    const augmentationPhysicalShell = augmentationApplied ? {
      schema: 'ruindivex-industrial-supplement-physical-shell/v1',
      authoritative: true,
      preRender: true,
      boundaryWallRuns: realizedBoundaryWallRuns.map((run) => ({
        ...run,
        ownerIds: [...(run.ownerIds ?? [])],
      })),
      connectorApertures: [...connectorWallOpenings.entries()].flatMap(
        ([edgeKey, openings]) => openings.map((opening) => ({
          ...opening,
          edgeKey,
        })),
      ),
    } : null;

    const baseFacade = {
      group,
      rooms,
      connectorJunctionProxies,
      tiles,
      floorTiles,
      verticalConnectors: this._createVerticalConnectors(rooms, legacyConnectionPlans),
      connectionPlans,
      connectorPlanningDiagnostics: connectorPlanning.diagnostics,
      connectorAssignmentSearchDiagnostics,
      connectorFootprintReservationDiagnostics: connectorFootprintReservation.diagnostics,
      connectorTrackTrapPlanningDiagnostics: connectorTrackTrapPlanning.diagnostics,
      connectorTrackTraps: connectorTrackTrapPlanning.connectorTrackTraps,
      trappedConnectorAlternates: connectorTrackTrapPlanning.trappedAlternates,
      connectorTrackTrapInfrastructure,
      roomElevationDiagnostics: roomElevationCommit,
      floorIdentityDiagnostics: augmentationApplied
        ? {
            ...floorIdentityNormalization.diagnostics,
            structuralEnvelopeFloorRecordCount,
          }
        : floorIdentityNormalization.diagnostics,
      verticalPortals,
      roomArchetypes: rooms.map((room) => ({
        id: room.id,
        type: room.type,
        archetype: room.archetype ?? room.type,
        archetypeId: room.archetypeId ?? null,
        flavor: room.flavor ?? null,
        flavorId: room.flavorId ?? null,
        layoutVariant: room.layoutVariant ?? null,
        purpose: room.purpose ?? null,
        mood: room.mood ?? null,
        environmentalStory: room.environmentalStory ?? null,
        baseElevation: Number(room.baseElevation ?? 0),
        minY: Number(room.minY ?? room.baseElevation ?? 0),
        maxY: Number(room.maxY ?? room.baseElevation ?? 0),
        ceilingY: Number.isFinite(room.ceilingY) ? room.ceilingY : null,
        ceilingHeight: room.ceilingHeight ?? null,
        verticalPlan: room.verticalPlan ?? null,
        specialEnvironmentId: room.specialEnvironmentId ?? null,
        progressionBand: PROGRESSION_ROOM_BANDS[room.id] ?? 0,
      })),
      layoutVariant,
      progression,
      minimap: progression.minimap,
      doors,
      keycards: landmarks.keycards,
      keySeeker: landmarks.keySeeker,
      chests: landmarks.chests,
      mechanisms: landmarks.mechanisms,
      ladders: connectorFixtures.ladders,
      connectorLifts: connectorFixtures.lifts,
      puzzleBlocks: landmarks.puzzleBlocks,
      pressurePlates: landmarks.pressurePlates,
      conveyorPuzzles: landmarks.conveyorPuzzles,
      platforms: landmarks.platforms,
      npcAnimationMixers: landmarks.npcAnimationMixers,
      npcAnimators: landmarks.npcAnimators,
      safeInteractables: landmarks.safeInteractables,
      safeZones: this._createRoomZones(rooms, 'hub').concat(this._createRoomZones(rooms, 'camp')),
      solidZones,
      aerialBoundaryZones,
      encounters,
      traps: [
        ...this._createTrapZones(rooms, floorTiles, trapVisualsByRoom),
        ...supplementalTraps,
      ],
      conveyors: this._createConveyorTileZones(floorTiles),
      shrine: landmarks.shrine,
      tileSize: this.tileSize,
      playerStart: this._tileToWorld(hubRoom.x, hubRoom.z, tiles),
      campReturnPosition: this._tileToWorld(campRoom.x, campRoom.z, tiles),
      ruinEntryPosition: this._tileToWorld(entranceRoom.x, entranceRoom.z, tiles),
      enemySpawnPoints,
      shrinePosition: landmarks.shrine?.position?.clone?.() ?? this._tileToWorld(shrineRoom.x, shrineRoom.z, tiles),
      boundsRadius: this._calculateBoundsRadius(tiles),
      renderCullGroups,
      specialEnvironment,
      specialEnvironmentId: specialEnvironment?.id ?? null,
      ...(this.basePlanHash || dungeonAugmentation ? {
        basePlanHash: dungeonAugmentation?.baseDraft?.basePlanHash ?? this.basePlanHash,
        augmentationPlanHash: dungeonAugmentation?.result?.overlayPlan?.augmentationPlanHash ?? null,
        effectivePlanHash: dungeonAugmentation?.result?.overlayPlan?.effectivePlanHash
          ?? dungeonAugmentation?.baseDraft?.basePlanHash
          ?? this.basePlanHash,
      } : {}),
      ...(dungeonAugmentation ? {
        augmentationStatus: dungeonAugmentation.status,
        augmentationDiagnostics: dungeonAugmentation.diagnostics,
      } : {}),
      ...(dungeonAugmentation?.status === 'applied' && dungeonSupplementFragment ? {
        extensionHost: dungeonAugmentation.host,
        augmentationOverlayPlan: dungeonAugmentation.result.overlayPlan,
        augmentationIdentity: dungeonAugmentation.identity,
        augmentationPhysicalShell,
        dungeonSupplementRoot,
        augmentationMetrics: augmentationAssemblyMetrics,
        disposableResources: [dungeonSupplementFragment],
      } : {}),
    };
    if (!dungeonSupplementFragment) return baseFacade;
    const effectiveFacade = mergeDungeonFacade(baseFacade, dungeonSupplementFragment, {
      conflictPolicy: 'base',
      attachRoot: false,
    });
    effectiveFacade.supplementRoot = dungeonSupplementRoot;
    effectiveFacade.dungeonSupplementRoot = dungeonSupplementRoot;
    effectiveFacade.augmentationIdentity = dungeonAugmentation.identity;
    effectiveFacade.augmentationOverlayPlan = dungeonAugmentation.result.overlayPlan;
    effectiveFacade.augmentationDiagnostics = dungeonAugmentation.diagnostics;
    effectiveFacade.augmentationMetrics = augmentationAssemblyMetrics;
    effectiveFacade.extensionHost = dungeonAugmentation.host;
    effectiveFacade.disposableResources = [dungeonSupplementFragment];
    return effectiveFacade;
    } catch (error) {
      let cleanupError = null;
      const fragmentOwnsThemeProducts = Boolean(dungeonSupplementFragment);
      try {
        this._disposeGeneratedDungeonCandidate({
          group: generationCandidateGroup,
          materials,
          npcAnimators: generationCandidateNpcAnimators,
          specialEnvironment: generationCandidateSpecialEnvironment,
          disposableResources: dungeonSupplementFragment ? [dungeonSupplementFragment] : [],
        });
      } catch (candidateCleanupError) {
        cleanupError = candidateCleanupError;
      }
      // A completed fragment ledger disposes every session-managed factory
      // product and removes it from the session ledger. Running the session's
      // broad fallback afterward would traverse those products a second time.
      // The session fallback is reserved for throws before a fragment exists.
      if (!fragmentOwnsThemeProducts) {
        try {
          dungeonSupplementThemeSession?.resources?.disposeOwned?.();
        } catch (sessionCleanupError) {
          cleanupError ??= sessionCleanupError;
        }
      }
      if (cleanupError && error && typeof error === 'object') {
        error.generationCandidateCleanupError = cleanupError;
      }
      throw error;
    }
  }

  _createStaticRenderCullGroups(root, criticalSources = []) {
    if (!root) {
      return [];
    }
    const criticalObjects = new Set();
    const collectCritical = (value) => {
      if (!value) {
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(collectCritical);
        return;
      }
      if (value.isObject3D) {
        criticalObjects.add(value);
        return;
      }
      for (const key of ['object', 'barrierObject', 'group', 'root', 'leftPanel', 'rightPanel']) {
        if (value[key]?.isObject3D) {
          criticalObjects.add(value[key]);
        }
      }
    };
    criticalSources.forEach(collectCritical);
    const criticalRoots = new Set();
    for (const object of criticalObjects) {
      let current = object;
      while (current?.parent && current.parent !== root) {
        current = current.parent;
      }
      if (current?.parent === root) {
        criticalRoots.add(current);
      }
    }

    root.updateMatrixWorld(true);
    const chunkWorldSize = this.tileSize * 8;
    const maxBucketSpan = chunkWorldSize * 1.5;
    const maxBucketDrawObjects = 64;
    const buckets = [];
    const center = new THREE.Vector3();
    let parentSequence = 0;

    const isDrawObject = (object) => Boolean(
      object?.isMesh
      || object?.isLine
      || object?.isPoints
      || object?.isSprite
    );
    const countDrawObjects = (object) => {
      let count = 0;
      object.traverse((descendant) => {
        if (isDrawObject(descendant)) {
          count += 1;
        }
      });
      return count;
    };
    const resolveOwnerId = (object) => {
      for (let current = object; current && current !== root; current = current.parent) {
        if (current.userData?.connectorId) {
          return `connector:${current.userData.connectorId}`;
        }
        if (current.userData?.roomId) {
          return `room:${current.userData.roomId}`;
        }
        if (current.userData?.dropSpaceId) {
          return `drop:${current.userData.dropSpaceId}`;
        }
      }
      return 'spatial';
    };
    const canAddToBucket = (bucket, bounds, drawObjectCount) => {
      if (bucket.drawObjectCount + drawObjectCount > maxBucketDrawObjects) {
        return false;
      }
      const combined = bucket.bounds.clone().union(bounds);
      return combined.max.x - combined.min.x <= maxBucketSpan + 0.001
        && combined.max.z - combined.min.z <= maxBucketSpan + 0.001;
    };

    // Keep identity cull groups under each object's existing parent. This lets
    // large room/prefab subtrees split across chunks without flattening their
    // coordinate space or changing any member's local transform/visibility.
    const partitionChildren = (parent, depth = 0) => {
      const parentId = parentSequence;
      parentSequence += 1;
      const candidates = [];

      for (const object of [...parent.children]) {
        if (object.userData?.renderCullGroup) {
          continue;
        }
        const isRootChild = parent === root;
        if (
          object.userData?.alwaysRendered
          || (isRootChild && criticalRoots.has(object))
        ) {
          continue;
        }

        const bounds = new THREE.Box3().setFromObject(object);
        if (bounds.isEmpty()) {
          continue;
        }
        const drawObjectCount = countDrawObjects(object);
        if (drawObjectCount <= 0) {
          continue;
        }
        const spanX = bounds.max.x - bounds.min.x;
        const spanZ = bounds.max.z - bounds.min.z;
        const canPartitionSubtree = !isDrawObject(object) && object.children.length > 0;
        if (
          canPartitionSubtree
          && (
            spanX > chunkWorldSize
            || spanZ > chunkWorldSize
            || drawObjectCount > maxBucketDrawObjects
          )
        ) {
          partitionChildren(object, depth + 1);
          continue;
        }

        bounds.getCenter(center);
        candidates.push({
          object,
          bounds,
          drawObjectCount,
          ownerId: resolveOwnerId(object),
          chunkX: Math.floor(center.x / chunkWorldSize),
          chunkZ: Math.floor(center.z / chunkWorldSize),
          span: Math.max(spanX, spanZ),
        });
      }

      const shardsByKey = new Map();
      for (const candidate of candidates) {
        const baseKey = `${candidate.ownerId}:${candidate.chunkX}:${candidate.chunkZ}`;
        const shards = shardsByKey.get(baseKey) ?? [];
        let bucket = shards.find((entry) => canAddToBucket(
          entry,
          candidate.bounds,
          candidate.drawObjectCount,
        ));
        if (!bucket) {
          const shardIndex = shards.length;
          const id = `${baseKey}:p${parentId}:s${shardIndex}`;
          const bucketGroup = new THREE.Group();
          bucketGroup.name = 'dungeonStaticRenderCullGroup';
          bucketGroup.userData.renderCullGroup = true;
          bucketGroup.userData.renderCullGroupId = id;
          bucketGroup.userData.ownerId = candidate.ownerId;
          parent.add(bucketGroup);
          bucket = {
            id,
            ownerId: candidate.ownerId,
            chunkX: candidate.chunkX,
            chunkZ: candidate.chunkZ,
            group: bucketGroup,
            bounds: new THREE.Box3(),
            memberCount: 0,
            drawObjectCount: 0,
            maxMemberSpan: 0,
            hierarchyDepth: depth,
            parentName: parent.name || parent.type || 'Object3D',
          };
          shards.push(bucket);
          shardsByKey.set(baseKey, shards);
          buckets.push(bucket);
        }
        bucket.bounds.union(candidate.bounds);
        bucket.memberCount += 1;
        bucket.drawObjectCount += candidate.drawObjectCount;
        bucket.maxMemberSpan = Math.max(bucket.maxMemberSpan, candidate.span);
        bucket.group.add(candidate.object);
      }
    };

    partitionChildren(root);
    root.updateMatrixWorld(true);

    return buckets.map((bucket) => ({
      id: bucket.id,
      ownerId: bucket.ownerId,
      chunkX: bucket.chunkX,
      chunkZ: bucket.chunkZ,
      group: bucket.group,
      minX: bucket.bounds.min.x,
      maxX: bucket.bounds.max.x,
      minZ: bucket.bounds.min.z,
      maxZ: bucket.bounds.max.z,
      // objectCount remains as a compatibility alias, but now reflects actual
      // descendant draw objects rather than only immediate scene roots.
      objectCount: bucket.drawObjectCount,
      drawObjectCount: bucket.drawObjectCount,
      memberCount: bucket.memberCount,
      maxMemberSpan: bucket.maxMemberSpan,
      hierarchyDepth: bucket.hierarchyDepth,
      parentName: bucket.parentName,
      chunkWorldSize,
      maxBucketSpan,
      maxBucketDrawObjects,
    }));
  }

  _createDungeonSupplementRoot(group, {
    roomIds = [],
    connectorIds = [],
  } = {}) {
    const supplementalRoomIds = new Set(roomIds);
    const supplementalConnectorIds = new Set(connectorIds);
    const root = new THREE.Group();
    root.name = 'DungeonSupplementRoot';
    root.userData.dungeonSupplementRoot = true;
    root.userData.supplementalRoomIds = [...supplementalRoomIds];
    root.userData.supplementalConnectorIds = [...supplementalConnectorIds];

    const isSupplementOwner = (value) => value != null && (
      supplementalRoomIds.has(value)
      || supplementalConnectorIds.has(value)
      || String(value).startsWith('supplement:')
    );
    const belongsOnlyToSupplement = (object) => {
      const primaryOwnerId = object.userData?.augmentationOwnerId
        ?? object.userData?.roomId
        ?? object.userData?.connectorId
        ?? null;
      if (primaryOwnerId != null) return isSupplementOwner(primaryOwnerId);
      const owners = [];
      object.traverse((descendant) => {
        const roomId = descendant.userData?.roomId;
        const connectorId = descendant.userData?.connectorId;
        const augmentationOwnerId = descendant.userData?.augmentationOwnerId;
        if (augmentationOwnerId) {
          owners.push(isSupplementOwner(augmentationOwnerId));
        } else if (roomId) {
          owners.push(isSupplementOwner(roomId));
        } else if (connectorId) {
          owners.push(isSupplementOwner(connectorId));
        }
        for (const wallOwnerId of descendant.userData?.wallOwnerIds ?? []) {
          owners.push(isSupplementOwner(wallOwnerId));
        }
      });
      return owners.length > 0 && owners.every(Boolean);
    };

    const supplementChildren = [...group.children].filter((child) => (
      child !== root && belongsOnlyToSupplement(child)
    ));
    for (const child of supplementChildren) root.add(child);
    group.add(root);
    return root;
  }

  _createDungeonSupplementTrapTiles(rooms = []) {
    return rooms.flatMap((room) => (room.augmentationAnchors ?? [])
      .filter((anchor) => ['trap', 'hazard', 'environmentalHazard'].includes(anchor.kind))
      .map((anchor, index) => ({
        id: anchor.id ?? `${room.id}:trap:${index}`,
        roomId: room.id,
        operationId: room.augmentationOperationId,
        runtimeStateId: anchor.runtimeStateId ?? null,
        hazardProfileId: anchor.hazardProfileId ?? anchor.hazardRecipe?.hazardProfileId ?? null,
        hazardRecipe: anchor.hazardRecipe ?? null,
        x: Math.round(Number(anchor.position?.x ?? room.x * this.tileSize) / this.tileSize),
        elevation: Number(anchor.position?.y ?? room.baseElevation ?? 0),
        z: Math.round(Number(anchor.position?.z ?? room.z * this.tileSize) / this.tileSize),
      })));
  }

  _createDungeonSupplementTrapZones(rooms = [], floorTiles = []) {
    const floorByRoom = new Map();
    for (const floor of floorTiles) {
      if (!floor?.roomId) continue;
      const roomFloors = floorByRoom.get(floor.roomId) ?? [];
      roomFloors.push(floor);
      floorByRoom.set(floor.roomId, roomFloors);
    }
    return rooms.flatMap((room) => (room.augmentationAnchors ?? [])
      .filter((anchor) => ['trap', 'hazard', 'environmentalHazard'].includes(anchor.kind))
      .map((anchor, index) => {
        const targetX = Math.round(
          Number(anchor.position?.x ?? room.x * this.tileSize) / this.tileSize,
        );
        const targetZ = Math.round(
          Number(anchor.position?.z ?? room.z * this.tileSize) / this.tileSize,
        );
        const targetElevation = Number(anchor.position?.y ?? room.baseElevation ?? 0);
        const roomFloors = floorByRoom.get(room.id) ?? [];
        const exactColumnFloors = roomFloors.filter((floor) => (
          floor.x === targetX && floor.z === targetZ
        ));
        const trapFloor = (exactColumnFloors.length > 0 ? exactColumnFloors : roomFloors)
          .sort((left, right) => (
            Math.abs(Number(left.elevation ?? 0) - targetElevation)
              - Math.abs(Number(right.elevation ?? 0) - targetElevation)
            || Math.abs(left.x - targetX) + Math.abs(left.z - targetZ)
              - Math.abs(right.x - targetX) - Math.abs(right.z - targetZ)
          ))[0] ?? {
            x: targetX,
            z: targetZ,
            elevation: targetElevation,
          };
        const position = this._floorTileToWorld(trapFloor);
        const damagePerPulse = Math.max(1, Number(anchor.damagePerPulse ?? 6));
        return {
          id: anchor.id ?? `${room.id}:trap:${index}`,
          roomId: room.id,
          operationId: room.augmentationOperationId,
          hazardProfileId: anchor.hazardProfileId ?? anchor.hazardRecipe?.hazardProfileId ?? null,
          runtimeStateId: anchor.runtimeStateId ?? null,
          position,
          halfWidth: Math.max(0.8, Number(anchor.halfWidth ?? this.tileSize * 0.72)),
          halfDepth: Math.max(0.8, Number(anchor.halfDepth ?? this.tileSize * 0.72)),
          verticalHalfHeight: Math.max(0.6, Number(anchor.verticalHalfHeight ?? 1.35)),
          active: true,
          label: anchor.label ?? 'Supplemental Hazard Grid',
          object: null,
          damagePerPulse,
          damagePerSecond: Math.max(damagePerPulse, Number(anchor.damagePerSecond ?? 16)),
          pulseInterval: Math.max(0.5, Number(anchor.pulseInterval ?? 1.55)),
          activeDuration: Math.max(0.1, Number(anchor.activeDuration ?? 0.36)),
          telegraphDuration: Math.max(0.1, Number(anchor.telegraphDuration ?? 0.46)),
          phaseOffset: Number(anchor.phaseOffset ?? ((index + 1) * 0.19) % 0.8),
          isDungeonSupplement: true,
        };
      }));
  }

  _createDungeonSupplementEncounterDefinitions(rooms, floorTiles, solidZones) {
    return rooms.flatMap((room, roomIndex) => {
      const encounterAnchors = (room.augmentationAnchors ?? [])
        .filter((anchor) => ['encounter', 'enemyEncounter'].includes(anchor.kind));
      return encounterAnchors.map((anchor, index) => {
      const encounterRecipe = anchor.encounterRecipe
        ?? resolveIndustrialSupplementEncounterRecipe(
          anchor.encounterProfileId ?? 'supplement-route-network-defense',
          {
            grammarId: room.archetypeId,
            moduleKind: 'room',
            contentRole: room.augmentationContentRole ?? 'challenge',
            topology: room.augmentationTopologyTemplateId ?? 'through',
          },
        );
      const position = new THREE.Vector3(
        Number(anchor.position?.x ?? room.x * this.tileSize),
        Number(anchor.position?.y ?? room.baseElevation ?? 0),
        Number(anchor.position?.z ?? room.z * this.tileSize),
      );
      const roster = Array.isArray(encounterRecipe?.roster) && encounterRecipe.roster.length
        ? [...encounterRecipe.roster]
        : Array.isArray(anchor.roster) && anchor.roster.length
        ? [...anchor.roster]
        : roomIndex % 2 === 0
          ? ['basic', 'fast']
          : ['ranged', 'basic'];
      const resolvedAuthoredRoster = Array.isArray(encounterRecipe?.roster)
        && encounterRecipe.roster.length > 0;
      // Curated recipes own their exact roster-to-spatial-role mapping.
      // Difficulty is already represented by the recipe's health, damage,
      // and threat scaling, so legacy membership changes would desynchronize
      // the authored spawn slots and clear-state contract.
      if (!resolvedAuthoredRoster) {
        if (this.difficulty <= 1 && roster.length > 2) roster.splice(2);
        if (this.difficulty >= 3 && !roster.includes('horokko')) roster.push('horokko');
      }
      const authoredDifficultyScaling = encounterRecipe?.difficultyScaling ?? null;
      const fallbackSpawnPoints = this._roomSpawnPoints(room, floorTiles, solidZones);
      const spatialAnchorById = new Map((room.augmentationAnchors ?? [])
        .filter(({ kind }) => kind === 'spatial-role')
        .map((spatialAnchor) => [String(spatialAnchor.localAnchorId ?? spatialAnchor.id), spatialAnchor]));
      const spawnSpatialRoles = (encounterRecipe?.spatialRoles ?? []).map((role, roleIndex) => {
        const spatialAnchor = (role.anchorIds ?? [])
          .map((anchorId) => spatialAnchorById.get(String(anchorId)))
          .find(Boolean);
        const spawnPosition = spatialAnchor?.position
          ? new THREE.Vector3(
            Number(spatialAnchor.position.x),
            Number(spatialAnchor.position.y ?? room.baseElevation ?? 0),
            Number(spatialAnchor.position.z),
          )
          : fallbackSpawnPoints[roleIndex % Math.max(1, fallbackSpawnPoints.length)]?.clone?.()
            ?? fallbackSpawnPoints[roleIndex % Math.max(1, fallbackSpawnPoints.length)];
        return {
          ...role,
          spawnPosition,
        };
      });
      const recipeSpawnPoints = spawnSpatialRoles
        .map(({ spawnPosition }) => spawnPosition)
        .filter(Boolean);
      const encounterStateId = anchor.runtimeStateId == null
        ? null
        : String(anchor.runtimeStateId);
      return {
        id: anchor.encounterId ?? `${room.id}:encounter`,
        roomId: room.id,
        label: anchor.label ?? 'Supplemental Exploration Defense',
        roster,
        encounterProfileId: encounterRecipe?.encounterProfileId
          ?? anchor.encounterProfileId
          ?? null,
        encounterRecipe,
        threat: encounterRecipe?.threat ?? null,
        difficultyScaling: authoredDifficultyScaling,
        enemyHealthMultiplier: Number.isFinite(Number(
          authoredDifficultyScaling?.healthMultiplier,
        )) ? Number(authoredDifficultyScaling.healthMultiplier) : 1,
        enemyDamageMultiplier: Number.isFinite(Number(
          authoredDifficultyScaling?.damageMultiplier,
        )) ? Number(authoredDifficultyScaling.damageMultiplier) : 1,
        hazardInteraction: encounterRecipe?.hazardInteraction ?? null,
        clearState: encounterRecipe?.clearState ?? {
          stateId: anchor.runtimeStateId ?? null,
          clearWhen: 'all-enemies-defeated',
        },
        spatialRoles: spawnSpatialRoles,
        zone: {
          id: `${room.id}:encounter-zone`,
          roomId: room.id,
          position,
          halfWidth: Math.max(this.tileSize, (Math.floor(room.width / 2) - 0.25) * this.tileSize),
          halfDepth: Math.max(this.tileSize, (Math.floor(room.depth / 2) - 0.25) * this.tileSize),
          active: true,
        },
        triggerZone: null,
        spawnPoints: recipeSpawnPoints.length > 0 ? recipeSpawnPoints : fallbackSpawnPoints,
        spawned: false,
        cleared: false,
        enemyIds: [],
        isDungeonSupplement: true,
        operationId: room.augmentationOperationId,
        stateId: encounterStateId,
        encounterStateId,
        runtimeStateId: encounterStateId,
        runtimeStateIds: encounterStateId ? [encounterStateId] : [],
      };
      });
    });
  }

  _createIndustrialDungeonThemeSession(materials, themeBinding) {
    const assetFactory = (role, specification = {}, context = {}) => {
      const root = new THREE.Group();
      root.name = `industrialSupplementAsset_${role}`;
      root.userData.dungeonSupplementAssetRole = role;
      root.userData.themeBinding = themeBinding;
      root.userData.parentAssetCatalogId = `industrial-v1:${role}`;
      const position = specification.position ?? specification.center;
      if (position?.isVector3) root.position.copy(position);
      else if (position) root.position.set(
        Number(position.x ?? 0),
        Number(position.y ?? 0),
        Number(position.z ?? 0),
      );
      const facing = specification.facing;
      if (facing && (Number(facing.x) || Number(facing.z))) {
        root.rotation.y = Math.atan2(Number(facing.x ?? 0), Number(facing.z ?? 0));
      }

      const borrow = (material, label) => {
        context.resources?.borrow?.(material, { label });
        return material;
      };
      const addBox = (name, size, material, localPosition = [0, 0, 0]) => {
        borrow(material, `industrial:${role}:${name}:parent-material`);
        const geometry = this._createTiledBoxGeometry(...size);
        context.resources?.own?.(geometry, { label: `industrial:${role}:${name}:geometry` });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.position.set(...localPosition);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        root.add(mesh);
        return mesh;
      };
      const addIndustrialFrame = ({ warning = false, transition = false } = {}) => {
        const width = Math.max(2.8, Number(specification.width ?? 4.2));
        const height = Math.max(2.8, Number(specification.height ?? 3.6));
        const columnMaterial = materials.supportMetal;
        const beamMaterial = warning ? materials.hazardStripe : materials.wallTrim;
        addBox('industrialFrameLeftColumn', [0.28, height, 0.32], columnMaterial, [-width * 0.5, height * 0.5, 0]);
        addBox('industrialFrameRightColumn', [0.28, height, 0.32], columnMaterial, [width * 0.5, height * 0.5, 0]);
        addBox(
          transition ? 'industrialTransitionHeader' : 'industrialFrameHeader',
          [width + 0.56, 0.34, 0.38],
          beamMaterial,
          [0, height - 0.17, 0],
        );
      };

      switch (role) {
        case 'support':
          addBox('industrialIBeamWeb', [0.22, 3.2, 0.28], materials.supportMetal, [0, 1.6, 0]);
          addBox('industrialIBeamTopFlange', [0.62, 0.16, 0.5], materials.factoryRail, [0, 3.12, 0]);
          addBox('industrialIBeamBaseFlange', [0.62, 0.16, 0.5], materials.factoryRail, [0, 0.08, 0]);
          break;
        case 'arch':
          addIndustrialFrame();
          break;
        case 'frame':
          addIndustrialFrame({ warning: true });
          break;
        case 'transitionFrame':
          addIndustrialFrame({ warning: true, transition: true });
          break;
        case 'cap': {
          const width = Math.max(2.8, Number(specification.width ?? 2.8));
          const height = Math.max(2.8, Number(specification.height ?? 3.2));
          addBox('industrialSocketCapPanel', [width, height, 0.2], materials.wall, [0, height * 0.5, 0]);
          addBox('industrialSocketCapWarningBar', [width * 0.72, 0.18, 0.24], materials.hazardStripe, [0, 1.05, -0.03]);
          addBox('industrialSocketCapHeader', [width, 0.22, 0.28], materials.wallTrim, [0, height - 0.12, 0]);
          break;
        }
        case 'control':
          addBox('industrialControlPedestal', [0.78, 0.72, 0.48], materials.terminal, [0, 0.36, 0]);
          addBox('industrialControlScreen', [0.62, 0.08, 0.3], materials.glowBlue, [0, 0.78, -0.18]);
          break;
        case 'prop':
          addBox('industrialCargoBody', [0.9, 0.72, 0.9], materials.wallTrim, [0, 0.36, 0]);
          addBox('industrialCargoStripe', [0.94, 0.09, 0.2], materials.hazardStripe, [0, 0.56, -0.46]);
          break;
        case 'decal':
        case 'hazard':
          addBox('industrialWarningSurface', [1.4, 0.035, 0.34], materials.hazardStripe, [0, 0.02, 0]);
          break;
        case 'lightFixture':
          addBox('industrialLightHousing', [0.72, 0.18, 0.48], materials.supportMetal, [0, 0, 0]);
          addBox('industrialLightLens', [0.54, 0.06, 0.34], materials.glowBlue, [0, -0.1, 0]);
          break;
        default:
          throw new Error(`Industrial V1 has no registered supplement asset role ${role}.`);
      }

      if (role === 'lightFixture') {
        const authoredIntensity = Number(specification.intensity);
        const authoredRangeMeters = Number(
          specification.rangeMeters ?? specification.range,
        );
        const authoredRangeTiles = Number(specification.rangeTiles);
        const lightIntensity = Number.isFinite(authoredIntensity)
          ? Math.max(0, authoredIntensity)
          : 1.25;
        const lightRange = Number.isFinite(authoredRangeMeters) && authoredRangeMeters > 0
          ? authoredRangeMeters
          : Number.isFinite(authoredRangeTiles) && authoredRangeTiles > 0
            ? authoredRangeTiles * this.tileSize
            : 10;
        const light = new THREE.PointLight(
          specification.color ?? 0x6bdcff,
          lightIntensity,
          lightRange,
          2,
        );
        light.name = 'industrialSupplementLocalLight';
        light.position.y = -0.2;
        light.castShadow = Boolean(
          specification.castsShadow ?? specification.castShadow ?? false,
        );
        root.add(light);
      }
      return root;
    };
    const metadataFactory = (kind) => (contract = {}) => {
      const root = new THREE.Group();
      root.name = `industrialSupplement${kind}`;
      root.userData.dungeonSupplementPresentation = kind;
      root.userData.contract = contract;
      root.userData.themeBinding = themeBinding;
      return root;
    };
    return createIndustrialThemeAdapter({
      themeBinding,
      materials,
      assetFactory,
      assetRoles: [
        'support', 'arch', 'frame', 'prop', 'decal', 'control',
        'lightFixture', 'hazard', 'cap', 'transitionFrame',
      ],
      connectorSkinFactory: (_family, contract) => metadataFactory('ConnectorSkin')(contract),
      connectorFamilies: [
        'serviceGallery', 'slope', 'ladder', 'lift', 'trackTrap', 'transitionBay',
      ],
      transitionFactory: (_type, contract) => metadataFactory('TransitionFrame')(contract),
      transitionTypes: ['levelTransitionBay'],
      environment: {
        localLightingProfileId: themeBinding.localLightingProfileId,
        soundscapeProfileId: themeBinding.soundscapeProfileId,
        createLocalLights: (specification) => assetFactory('lightFixture', specification),
        createAudioEmitters: (specification) => ({
          ...specification,
          themeBinding,
          parentOwnedDescriptor: true,
        }),
      },
    });
  }

  _assignRoomArchetypes(rooms) {
    const fixedById = {
      entrance: { archetypeId: 'security_checkpoint', flavorId: 'locked_down' },
      enemyNest: { archetypeId: 'reaverbot_nest' },
      keycardRoom: { archetypeId: 'surveillance_control_theater' },
      alienServerRoom: { archetypeId: 'ancient_server_crypt', layoutVariantId: 'vertical_server_shaft' },
      machineFactoryRoom: { archetypeId: 'assembly_line_hall', layoutVariantId: 'overhead_gantry_hall' },
      coolantRelayRoom: { archetypeId: 'pump_and_coolant_works', layoutVariantId: 'coolant_lower_level' },
      shrineRoom: { archetypeId: 'data_shrine_machine_chapel', flavorId: 'refractor_rich', layoutVariantId: 'elevated_shrine' },
      conveyorRoom: { archetypeId: 'assembly_line_hall', layoutVariantId: 'overhead_gantry_hall' },
      trapRoom: { archetypeId: 'hazard_processing_room', layoutVariantId: 'multi_level_hazard_room' },
      bossRoom: { archetypeId: 'large_mini_dungeon_room' },
      bonusVault: { archetypeId: 'storage_vault_parts_warehouse', layoutVariantId: 'cargo_lift_room' },
    };

    for (const room of rooms) {
      if (room.type === 'hub' || room.type === 'camp') {
        room.archetype = room.type === 'hub' ? 'Open Expedition Staging Area' : 'Open Expedition Camp';
        room.archetypeId = room.type === 'hub' ? 'expedition_staging_area' : 'expedition_camp';
        room.flavor = 'safe';
        room.flavorId = 'safe';
        room.layoutVariant = 'Open-air staging route';
        room.purpose = room.type === 'hub'
          ? 'A safe salvage town where expeditions are prepared.'
          : 'A forward camp that teaches movement and frames the sealed ruin entrance.';
        room.mood = 'Sheltered, practical, and visibly separate from the buried factory.';
        room.environmentalStory = 'Fresh expedition gear is arranged around machinery far older than the camp.';
        room.sizeCategory = 'small';
        room.heightCategory = 'open-air';
        room.ceilingHeight = null;
        room.baseElevation = 0;
        room.floorElevation = 0;
        room.minY = 0;
        room.maxY = null;
        room.ceilingY = null;
        room.exitSockets = [];
        continue;
      }

      const fixed = fixedById[room.id];
      const metadata = resolveIndustrialRoomMetadata({
        roomType: room.type,
        archetypeId: fixed?.archetypeId,
        flavorId: fixed?.flavorId,
        layoutVariantId: fixed?.layoutVariantId,
        random: this.random,
      });
      const tierElevation = (tier) => (
        tier < 0
          ? RUIN_BASEMENT_ELEVATION
          : tier === 1
            ? RUIN_SECOND_FLOOR_ELEVATION
            : tier >= 2
              ? RUIN_THIRD_FLOOR_ELEVATION
              : 0
      );

      room.archetypeId = metadata.archetypeId;
      room.archetype = metadata.archetype.displayName;
      room.flavorId = metadata.flavorId;
      room.flavor = metadata.flavorId;
      room.flavorDisplayName = metadata.flavor.displayName;
      room.layoutVariantId = metadata.layoutVariant?.id ?? null;
      room.layoutVariant = metadata.layoutVariant?.displayName ?? metadata.layoutVariant?.topology ?? 'Layered industrial chamber';
      room.purpose = metadata.archetype.purpose;
      room.mood = metadata.archetype.mood;
      room.environmentalStory = metadata.environmentalStory;
      room.sizeCategory = metadata.archetype.sizeCategory;
      room.heightCategory = metadata.archetype.heightCategory;
      room.ceilingHeight = Math.min(
        RUIN_WALL_HEIGHT,
        ROOM_CEILING_HEIGHT_BY_SIZE[room.sizeCategory] ?? 12.8,
      );
      room.baseElevation = 0;
      room.floorElevation = 0;
      room.minY = 0;
      room.maxY = room.ceilingHeight;
      room.ceilingY = room.ceilingHeight;
      room.layoutTags = metadata.archetype.layoutTags;
      room.requiredFeatures = metadata.archetype.requiredFeatures;
      room.optionalFeatures = metadata.archetype.optionalFeatures;
      room.enemyTags = metadata.archetype.enemyTags;
      room.puzzleTags = metadata.archetype.puzzleTags;
      room.rewardTags = metadata.archetype.rewardTags;
      room.exitRules = metadata.exitRules;
      room.flavorEffects = metadata.flavor;
      room.verticalPlan = {
        archetype: metadata.verticalityOption?.id ?? 'raised_service_platform',
        intent: metadata.verticalityOption?.purpose ?? 'A useful upper route links combat, lore, or reward space.',
        requestedTiers: (metadata.verticalityOption?.tiers ?? [0, 1]).map((level) => ({
          level,
          elevation: tierElevation(level),
        })),
        tierMap: [],
        platformNodes: [],
        catwalkNodes: [],
        stairConnectors: [],
        rampConnectors: [],
        traversalRoutes: [],
      };
      room.hazardZones = metadata.flavor.hazards.map((hazard) => hazard.id);
      room.machineryZones = metadata.archetype.requiredFeatures.filter((feature) => (
        feature.includes('machine') || feature.includes('tank') || feature.includes('reactor') || feature.includes('pump')
      ));
      if (room.specialEnvironmentId === 'verticalTransitReliquary') {
        room.archetypeId = 'vertical_transit_reliquary';
        room.archetype = 'Vertical Transit Reliquary';
        room.layoutVariantId = 'ascension_engine_launch_shaft';
        room.layoutVariant = 'Four-chamber authored vertical pursuit shaft';
        room.purpose = 'A dedicated traversal boss stage whose impact machinery constructs the ascent route.';
        room.mood = 'A dark launch foundry opening upward through elevator ruins and suspended machinery.';
        room.environmentalStory = 'Ancient transit machinery was built around the same compression technology as the guardian leg.';
        room.heightCategory = 'open-shaft';
        room.ceilingHeight = 26;
        room.verticalPlan = {
          archetype: 'authored_vertical_boss_stage',
          intent: 'Four deterministic seal checkpoints climb to a dedicated summit.',
          requestedTiers: [{ level: 0, elevation: 0 }],
          tierMap: [],
          platformNodes: [],
          catwalkNodes: [],
          stairConnectors: [],
          rampConnectors: [],
          traversalRoutes: [],
        };
      }
      room.exitSockets = [];
    }
  }

  _createElevationConnectionPlans(rooms) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    // Connector variants may only reshape the exterior hallway between authored
    // V1 rooms. Keep an exact, serializable snapshot of every room footprint on
    // each connection plan so the renderer-independent selector can exclude
    // all room tiles (including unrelated side rooms) and reserve flat socket
    // thresholds before choosing a transfer span.
    const connectorVariantRoomFootprints = rooms.map((room) => {
      const halfWidth = Math.floor(room.width / 2);
      const halfDepth = Math.floor(room.depth / 2);
      return {
        roomId: room.id,
        minX: room.x - halfWidth,
        maxX: room.x + halfWidth,
        minZ: room.z - halfDepth,
        maxZ: room.z + halfDepth,
      };
    });
    const plans = [];
    // Reserve the complete three-lane V1 gallery plus one exterior support
    // lane during graph routing. Family-specific slope/lift envelopes are
    // validated again from their realized structural and clearance volumes.
    const connectorReservationHalfWidthTiles = 2;
    const reservedConnectorFootprintKeysByLevel = new Map();
    const isInside = (point, room) => {
      const halfW = Math.floor(room.width / 2);
      const halfD = Math.floor(room.depth / 2);
      return Math.abs(point.x - room.x) <= halfW && Math.abs(point.z - room.z) <= halfD;
    };
    const makeElbowPath = (fromRoom, toRoom, horizontalFirst) => {
      const points = [];
      const append = (point) => {
        const previous = points[points.length - 1];
        if (!previous || previous.x !== point.x || previous.z !== point.z) points.push(point);
      };
      if (horizontalFirst) {
        for (const x of rangeBetweenOrdered(fromRoom.x, toRoom.x)) append({ x, z: fromRoom.z });
        for (const z of rangeBetweenOrdered(fromRoom.z, toRoom.z)) append({ x: toRoom.x, z });
      } else {
        for (const z of rangeBetweenOrdered(fromRoom.z, toRoom.z)) append({ x: fromRoom.x, z });
        for (const x of rangeBetweenOrdered(fromRoom.x, toRoom.x)) append({ x, z: toRoom.z });
      }
      return points;
    };
    const makeWaypointPath = (waypoints) => {
      const points = [];
      const append = (point) => {
        const previous = points[points.length - 1];
        if (!previous || previous.x !== point.x || previous.z !== point.z) points.push(point);
      };
      for (let index = 0; index < waypoints.length - 1; index += 1) {
        const from = waypoints[index];
        const to = waypoints[index + 1];
        if (from.x === to.x) {
          for (const z of rangeBetweenOrdered(from.z, to.z)) append({ x: from.x, z });
        } else {
          for (const x of rangeBetweenOrdered(from.x, to.x)) append({ x, z: from.z });
        }
      }
      return points;
    };
    const chooseCollisionFreeElbowPath = (
      fromRoom,
      toRoom,
      preferredDestinationAxis = null,
      level = 0,
    ) => {
      const fromHalfW = Math.floor(fromRoom.width / 2);
      const fromHalfD = Math.floor(fromRoom.depth / 2);
      const toHalfW = Math.floor(toRoom.width / 2);
      const toHalfD = Math.floor(toRoom.depth / 2);
      const detourMargin = connectorReservationHalfWidthTiles + 3;
      const northZ = Math.min(fromRoom.z - fromHalfD, toRoom.z - toHalfD) - detourMargin;
      const southZ = Math.max(fromRoom.z + fromHalfD, toRoom.z + toHalfD) + detourMargin;
      const westX = Math.min(fromRoom.x - fromHalfW, toRoom.x - toHalfW) - detourMargin;
      const eastX = Math.max(fromRoom.x + fromHalfW, toRoom.x + toHalfW) + detourMargin;
      const candidates = [
        makeElbowPath(fromRoom, toRoom, true),
        makeElbowPath(fromRoom, toRoom, false),
        makeWaypointPath([
          { x: fromRoom.x, z: fromRoom.z },
          { x: fromRoom.x, z: northZ },
          { x: toRoom.x, z: northZ },
          { x: toRoom.x, z: toRoom.z },
        ]),
        makeWaypointPath([
          { x: fromRoom.x, z: fromRoom.z },
          { x: fromRoom.x, z: southZ },
          { x: toRoom.x, z: southZ },
          { x: toRoom.x, z: toRoom.z },
        ]),
        makeWaypointPath([
          { x: fromRoom.x, z: fromRoom.z },
          { x: westX, z: fromRoom.z },
          { x: westX, z: toRoom.z },
          { x: toRoom.x, z: toRoom.z },
        ]),
        makeWaypointPath([
          { x: fromRoom.x, z: fromRoom.z },
          { x: eastX, z: fromRoom.z },
          { x: eastX, z: toRoom.z },
          { x: toRoom.x, z: toRoom.z },
        ]),
      ];
      const unrelatedRooms = rooms.filter((room) => room !== fromRoom && room !== toRoom);
      const destinationAxisForPath = (path) => {
        let destinationEntryIndex = path.length - 1;
        while (
          destinationEntryIndex > 0
          && isInside(path[destinationEntryIndex - 1], toRoom)
        ) {
          destinationEntryIndex -= 1;
        }
        const destinationPoint = path[destinationEntryIndex];
        const destinationOutside = path[Math.max(0, destinationEntryIndex - 1)];
        const destinationStep = destinationPoint && destinationOutside
          ? {
              x: Math.sign(destinationPoint.x - destinationOutside.x),
              z: Math.sign(destinationPoint.z - destinationOutside.z),
            }
          : { x: 0, z: 0 };
        return destinationStep.x !== 0 ? 'x' : destinationStep.z !== 0 ? 'z' : null;
      };
      const axisCompatibleCandidates = preferredDestinationAxis
        ? candidates.filter((path) => destinationAxisForPath(path) === preferredDestinationAxis)
        : candidates;
      const footprintKeysForPath = (path) => {
        const keys = new Set();
        for (let index = 0; index < path.length; index += 1) {
          const point = path[index];
          if (isInside(point, fromRoom) || isInside(point, toRoom)) continue;
          const previous = path[Math.max(0, index - 1)] ?? point;
          const next = path[Math.min(path.length - 1, index + 1)] ?? point;
          const direction = {
            x: Math.sign((next.x - point.x) || (point.x - previous.x)),
            z: Math.sign((next.z - point.z) || (point.z - previous.z)),
          };
          for (let lateral = -connectorReservationHalfWidthTiles;
            lateral <= connectorReservationHalfWidthTiles;
            lateral += 1) {
            keys.add(tileKey(
              point.x - direction.z * lateral,
              point.z + direction.x * lateral,
            ));
          }
        }
        return keys;
      };
      const reservedKeys = reservedConnectorFootprintKeysByLevel.get(level) ?? new Set();
      const score = (path) => {
        const footprintKeys = footprintKeysForPath(path);
        const roomCollisionCount = [...footprintKeys].reduce((total, key) => {
          const [x, z] = key.split(',').map(Number);
          return total + unrelatedRooms.reduce((roomTotal, room) => (
            roomTotal + Number(isInside({ x, z }, room))
          ), 0);
        }, 0);
        const connectorCollisionCount = [...footprintKeys].reduce((total, key) => (
          total + Number(reservedKeys.has(key))
        ), 0);
        return {
          value: path.length + roomCollisionCount * 1_000_000 + connectorCollisionCount * 10_000,
          roomCollisionCount,
          connectorCollisionCount,
          footprintKeys,
        };
      };
      const rankedCandidates = (axisCompatibleCandidates.length ? axisCompatibleCandidates : candidates)
        .map((path, index) => ({ path, index, score: score(path) }))
        .sort((a, b) => a.score.value - b.score.value || a.index - b.index);
      if (rankedCandidates[0].score.roomCollisionCount === 0
        && rankedCandidates[0].score.connectorCollisionCount === 0) {
        return rankedCandidates[0];
      }

      const allMinX = Math.min(...connectorVariantRoomFootprints.map((footprint) => footprint.minX)) - 90;
      const allMaxX = Math.max(...connectorVariantRoomFootprints.map((footprint) => footprint.maxX)) + 90;
      const allMinZ = Math.min(...connectorVariantRoomFootprints.map((footprint) => footprint.minZ)) - 90;
      const allMaxZ = Math.max(...connectorVariantRoomFootprints.map((footprint) => footprint.maxZ)) + 90;
      const unrelatedFootprints = connectorVariantRoomFootprints.filter((footprint) => (
        footprint.roomId !== fromRoom.id && footprint.roomId !== toRoom.id
      ));
      const insideEndpointRoom = (point) => isInside(point, fromRoom) || isInside(point, toRoom);
      const blockedForReservedGallery = (point) => {
        if (insideEndpointRoom(point)) return false;
        if (unrelatedFootprints.some((footprint) => (
          point.x >= footprint.minX - connectorReservationHalfWidthTiles
          && point.x <= footprint.maxX + connectorReservationHalfWidthTiles
          && point.z >= footprint.minZ - connectorReservationHalfWidthTiles
          && point.z <= footprint.maxZ + connectorReservationHalfWidthTiles
        ))) return true;
        for (let dx = -connectorReservationHalfWidthTiles;
          dx <= connectorReservationHalfWidthTiles;
          dx += 1) {
          for (let dz = -connectorReservationHalfWidthTiles;
            dz <= connectorReservationHalfWidthTiles;
            dz += 1) {
            if (reservedKeys.has(tileKey(point.x + dx, point.z + dz))) return true;
          }
        }
        return false;
      };
      const findGridPath = (goal) => {
        const start = { x: fromRoom.x, z: fromRoom.z };
        const startKey = tileKey(start.x, start.z);
        const goalKey = tileKey(goal.x, goal.z);
        const queue = [start];
        let queueIndex = 0;
        const parents = new Map([[startKey, null]]);
        while (queueIndex < queue.length) {
          const current = queue[queueIndex];
          queueIndex += 1;
          const currentKey = tileKey(current.x, current.z);
          if (currentKey === goalKey) {
            const reversed = [];
            let cursorKey = currentKey;
            while (cursorKey) {
              const [x, z] = cursorKey.split(',').map(Number);
              reversed.push({ x, z });
              cursorKey = parents.get(cursorKey);
            }
            return reversed.reverse();
          }
          const directions = DIRECTIONS
            .map(([dx, dz]) => ({ dx, dz }))
            .sort((first, second) => (
              Math.abs(current.x + first.dx - goal.x) + Math.abs(current.z + first.dz - goal.z)
              - (Math.abs(current.x + second.dx - goal.x) + Math.abs(current.z + second.dz - goal.z))
              || first.dx - second.dx
              || first.dz - second.dz
            ));
          for (const { dx, dz } of directions) {
            const next = { x: current.x + dx, z: current.z + dz };
            if (next.x < allMinX || next.x > allMaxX || next.z < allMinZ || next.z > allMaxZ) {
              continue;
            }
            const nextKey = tileKey(next.x, next.z);
            if (parents.has(nextKey) || blockedForReservedGallery(next)) continue;
            parents.set(nextKey, currentKey);
            queue.push(next);
          }
        }
        return null;
      };
      const targetCandidates = preferredDestinationAxis === 'z'
        ? [
            { x: toRoom.x, z: toRoom.z - toHalfD - 1 },
            { x: toRoom.x, z: toRoom.z + toHalfD + 1 },
          ]
        : preferredDestinationAxis === 'x'
          ? [
              { x: toRoom.x - toHalfW - 1, z: toRoom.z },
              { x: toRoom.x + toHalfW + 1, z: toRoom.z },
            ]
          : [{ x: toRoom.x, z: toRoom.z }];
      const gridCandidates = targetCandidates.flatMap((target, index) => {
        const route = findGridPath(target);
        if (!route) return [];
        const destinationTail = makeWaypointPath([target, { x: toRoom.x, z: toRoom.z }]);
        const path = [...route];
        for (const point of destinationTail.slice(1)) {
          const previous = path[path.length - 1];
          if (!previous || previous.x !== point.x || previous.z !== point.z) path.push(point);
        }
        return [{ path, index: rankedCandidates.length + index, score: score(path) }];
      }).filter((candidate) => (
        candidate.score.roomCollisionCount === 0
        && candidate.score.connectorCollisionCount === 0
      )).sort((first, second) => (
        first.score.value - second.score.value || first.index - second.index
      ));
      return gridCandidates[0] ?? rankedCandidates[0];
    };
    const createPlan = ({
      id,
      fromRoomId,
      toRoomId,
      doorId = null,
      level = 0,
      elevation = 0,
      connectorType = 'ground_corridor',
      requiredForProgression = false,
      purpose = 'critical_route',
      routeClassification = requiredForProgression ? 'main_route' : 'optional_branch',
      reusePathFromConnectionId = null,
    }) => {
      const fromRoom = roomById.get(fromRoomId);
      const toRoom = roomById.get(toRoomId);
      if (!fromRoom || !toRoom) {
        return null;
      }

      const reusedPathPlan = reusePathFromConnectionId
        ? plans.find((candidate) => candidate.id === reusePathFromConnectionId)
        : null;
      const selectedPath = reusedPathPlan ? (() => {
        const path = reusedPathPlan.fullPath.map((point) => ({ ...point }));
        const footprintKeys = new Set();
        for (let index = 0; index < path.length; index += 1) {
          const point = path[index];
          if (isInside(point, fromRoom) || isInside(point, toRoom)) continue;
          const previous = path[Math.max(0, index - 1)] ?? point;
          const next = path[Math.min(path.length - 1, index + 1)] ?? point;
          const direction = {
            x: Math.sign((next.x - point.x) || (point.x - previous.x)),
            z: Math.sign((next.z - point.z) || (point.z - previous.z)),
          };
          for (let lateral = -connectorReservationHalfWidthTiles;
            lateral <= connectorReservationHalfWidthTiles;
            lateral += 1) {
            footprintKeys.add(tileKey(
              point.x - direction.z * lateral,
              point.z + direction.x * lateral,
            ));
          }
        }
        const unrelatedRooms = rooms.filter((room) => room !== fromRoom && room !== toRoom);
        const reservedKeys = reservedConnectorFootprintKeysByLevel.get(level) ?? new Set();
        const roomCollisionCount = [...footprintKeys].reduce((total, key) => {
          const [x, z] = key.split(',').map(Number);
          return total + unrelatedRooms.reduce((roomTotal, room) => (
            roomTotal + Number(isInside({ x, z }, room))
          ), 0);
        }, 0);
        const connectorCollisionCount = [...footprintKeys].reduce((total, key) => (
          total + Number(reservedKeys.has(key))
        ), 0);
        return {
          path,
          index: -1,
          score: {
            value: path.length + roomCollisionCount * 1_000_000
              + connectorCollisionCount * 10_000,
            roomCollisionCount,
            connectorCollisionCount,
            footprintKeys,
          },
        };
      })() : chooseCollisionFreeElbowPath(
        fromRoom,
        toRoom,
        toRoom.id === 'machineFactoryRoom' ? 'z' : null,
        level,
      );
      const fullPath = selectedPath.path;
      let fromSocketIndex = 0;
      while (fromSocketIndex + 1 < fullPath.length && isInside(fullPath[fromSocketIndex + 1], fromRoom)) {
        fromSocketIndex += 1;
      }
      let toSocketIndex = fullPath.length - 1;
      while (toSocketIndex - 1 >= 0 && isInside(fullPath[toSocketIndex - 1], toRoom)) {
        toSocketIndex -= 1;
      }

      const fromPoint = fullPath[fromSocketIndex];
      const fromOutside = fullPath[Math.min(fullPath.length - 1, fromSocketIndex + 1)] ?? fromPoint;
      const toPoint = fullPath[toSocketIndex];
      const toOutside = fullPath[Math.max(0, toSocketIndex - 1)] ?? toPoint;
      const createSocket = (room, role, point, outside) => ({
        id: `${id}_${role}`,
        roomId: room.id,
        role,
        x: point.x,
        z: point.z,
        level,
        elevation,
        facingX: Math.sign(outside.x - point.x),
        facingZ: Math.sign(outside.z - point.z),
        connectorType,
        landingWidth: this.tileSize * CONNECTOR_GALLERY_MIN_WIDTH_TILES,
        clearanceHeight: PLAYER_TRAVERSAL_ENVELOPE.headClearance,
        floorKey: floorTileKey(point.x, point.z, level),
        matchingSocketId: `${id}_${role === 'exit' ? 'entrance' : 'exit'}`,
      });
      const plan = {
        id,
        logicalConnectionId: `${fromRoomId}_${toRoomId}`,
        fromRoomId,
        toRoomId,
        doorId,
        level,
        elevation,
        connectorType,
        requiredForProgression,
        purpose,
        routeClassification,
        fullPath,
        bridgePath: fullPath.slice(fromSocketIndex, toSocketIndex + 1),
        connectorVariantConstraints: {
          roomFootprints: connectorVariantRoomFootprints.map((footprint) => ({ ...footprint })),
          endpointFlatBufferTiles: 2,
          reservedFootprintHalfWidthTiles: connectorReservationHalfWidthTiles,
          reservedFootprintColumnCount: selectedPath.score.footprintKeys.size,
          footprintRoomCollisionCount: selectedPath.score.roomCollisionCount,
          footprintConnectorCollisionCount: selectedPath.score.connectorCollisionCount,
        },
        fromSocket: createSocket(fromRoom, 'exit', fromPoint, fromOutside),
        toSocket: createSocket(toRoom, 'entrance', toPoint, toOutside),
      };

      const reservedKeys = reservedConnectorFootprintKeysByLevel.get(level) ?? new Set();
      for (const key of selectedPath.score.footprintKeys) reservedKeys.add(key);
      reservedConnectorFootprintKeysByLevel.set(level, reservedKeys);

      fromRoom.exitSockets.push({ ...plan.fromSocket, connectionId: id, purpose });
      toRoom.exitSockets.push({ ...plan.toSocket, connectionId: id, purpose });
      return plan;
    };

    for (const [fromRoomId, toRoomId, doorId] of PROGRESSION_CONNECTIONS) {
      const logicalConnectionId = `${fromRoomId}_${toRoomId}`;
      const optionalBranch = OPTIONAL_V1_BRANCH_CONNECTION_IDS.has(logicalConnectionId);
      const plan = createPlan({
        id: `${logicalConnectionId}_ground`,
        fromRoomId,
        toRoomId,
        doorId,
        // `requiredForProgression` is the legacy physical-route invariant:
        // every authored V1 room connection must remain traversable. The new
        // route classification separately tells elevation planning which
        // edges belong to the mandatory progression route.
        requiredForProgression: true,
        purpose: optionalBranch ? 'optional_branch' : 'critical_route',
        routeClassification: optionalBranch ? 'optional_branch' : 'main_route',
      });
      if (plan) {
        plans.push(plan);
      }
    }

    const verticalAlternates = [
      {
        id: 'enemyNest_alienServerRoom_upper',
        fromRoomId: 'enemyNest',
        toRoomId: 'alienServerRoom',
        purpose: 'upper_lore_and_flanking_route',
      },
      {
        id: 'conveyorRoom_machineFactoryRoom_upper',
        fromRoomId: 'conveyorRoom',
        toRoomId: 'machineFactoryRoom',
        purpose: 'upper_control_and_reward_route',
      },
    ];

    for (const spec of verticalAlternates) {
      const pairedGroundConnectionId = `${spec.fromRoomId}_${spec.toRoomId}_ground`;
      const plan = createPlan({
        ...spec,
        level: 1,
        elevation: RUIN_SECOND_FLOOR_ELEVATION,
        connectorType: 'upper_catwalk_bridge',
        reusePathFromConnectionId: pairedGroundConnectionId,
      });
      if (plan) {
        plans.push(plan);
      }
    }

    const groundConnectionPoints = connectionPlans => connectionPlans
      .filter((plan) => plan.level === 0)
      .flatMap((plan) => (plan.bridgePath ?? []).map((point) => ({
        connectionId: plan.id,
        x: point.x,
        z: point.z,
      })));
    const allGroundConnectionPoints = groundConnectionPoints(plans);
    for (const plan of plans.filter((candidate) => candidate.level === 0)) {
      plan.connectorVariantConstraints.blockedLanePoints = allGroundConnectionPoints
        .filter((point) => point.connectionId !== plan.id)
        .map(({ x, z }) => ({ x, z }));
    }

    return plans;
  }

  _commitResolvedRoomElevations({
    rooms = [],
    tiles = new Map(),
    floorTiles = [],
    connectionPlans = [],
    solidZones = [],
  } = {}) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const planById = new Map(connectionPlans.map((plan) => [plan.id, plan]));
    const baseByRoomId = new Map();
    const floorKeyRewritesByRoomId = new Map();

    for (const room of rooms) {
      const resolvedBase = Number(
        room.plannedBaseElevation
        ?? room.resolvedBaseElevation
        ?? room.baseElevation
        ?? 0,
      );
      const baseElevation = Number.isFinite(resolvedBase) ? resolvedBase : 0;
      room.localFloorElevation = 0;
      room.baseElevation = baseElevation;
      room.floorElevation = baseElevation;
      room.ceilingY = Number.isFinite(room.ceilingHeight)
        ? baseElevation + room.ceilingHeight
        : null;
      baseByRoomId.set(room.id, baseElevation);
    }

    // The V1 authored room kit is deliberately constructed in room-local Y.
    // Apply the graph solution once, after that kit has finished, so every
    // floor layer (including pits, ramps, catwalks, and shrine tiers) moves as
    // one immutable room composition instead of being regenerated.
    const uniqueFloors = new Set([...tiles.values(), ...floorTiles]);
    for (const floor of uniqueFloors) {
      if (!floor || floor.absoluteRoomElevationCommitted) continue;
      const previousFloorKey = String(
        floor.floorKey
          ?? absoluteFloorTileKey(floor.x, floor.z, floor.elevation ?? 0),
      );
      let baseElevation = floor.roomId ? baseByRoomId.get(floor.roomId) : null;
      const owningConnectionPlan = floor.connectionId
        ? planById.get(floor.connectionId)
        : null;
      // The upper bridge builder runs after signed planning and therefore
      // receives an absolute socket elevation. Do not add the room base a
      // second time to those bridge-owned surfaces (including the two socket
      // tiles that lie just inside their authored rooms).
      if ((owningConnectionPlan?.level ?? 0) > 0
        && Math.abs(
          Number(floor.elevation ?? 0)
          - Number(owningConnectionPlan.sourceElevation ?? owningConnectionPlan.elevation ?? 0),
        ) <= 0.05) {
        baseElevation = 0;
      }
      if (!Number.isFinite(baseElevation) && floor.connectionId) {
        const plan = owningConnectionPlan;
        // The two pre-existing V1 upper-catwalk alternatives stay parallel to
        // their level ground connection and inherit that connection's room
        // base. Signed elevation connectors are rebuilt separately below.
        if ((plan?.level ?? 0) > 0) {
          baseElevation = baseByRoomId.get(plan.fromRoomId) ?? 0;
        }
      }
      if (Number.isFinite(baseElevation)) floor.roomBaseElevation = baseElevation;
      if (!Number.isFinite(baseElevation) || Math.abs(baseElevation) <= 1e-9) {
        floor.floorKey = absoluteFloorTileKey(floor.x, floor.z, floor.elevation);
        if (floor.roomId) {
          const rewrites = floorKeyRewritesByRoomId.get(floor.roomId) ?? new Map();
          rewrites.set(previousFloorKey, floor.floorKey);
          floorKeyRewritesByRoomId.set(floor.roomId, rewrites);
        }
        floor.absoluteRoomElevationCommitted = true;
        continue;
      }

      floor.localElevation = Number(floor.elevation ?? 0);
      floor.elevation = floor.localElevation + baseElevation;
      for (const key of ['rampStartElevation', 'rampEndElevation', 'supportBaseElevation']) {
        if (Number.isFinite(floor[key])) {
          floor[`local${key[0].toUpperCase()}${key.slice(1)}`] = floor[key];
          floor[key] += baseElevation;
        }
      }
      floor.floorKey = absoluteFloorTileKey(floor.x, floor.z, floor.elevation);
      if (floor.roomId) {
        const rewrites = floorKeyRewritesByRoomId.get(floor.roomId) ?? new Map();
        rewrites.set(previousFloorKey, floor.floorKey);
        floorKeyRewritesByRoomId.set(floor.roomId, rewrites);
      }
      floor.absoluteRoomElevationCommitted = true;
    }

    // Several authored V1 sub-zones are declared before the graph assigns a
    // room's absolute elevation. Rekey those serializable references together
    // with their owning floor objects so validation and public journeys cannot
    // alias a vertically stacked support layer.
    for (const room of rooms) {
      const rewrites = floorKeyRewritesByRoomId.get(room.id);
      const dropSpace = room.dropSpace;
      if (!rewrites || !dropSpace) continue;
      for (const field of [
        'entryFloorKeys',
        'entryLipFloorKeys',
        'lowerFloorKeys',
        'bridgeFloorKeys',
        'returnShelfFloorKeys',
        'exitFloorKeys',
      ]) {
        if (!Array.isArray(dropSpace[field])) continue;
        dropSpace[field] = dropSpace[field].map((key) => rewrites.get(key) ?? key);
      }
    }

    for (const zone of solidZones) {
      if (!zone?.position || zone.absoluteRoomElevationCommitted) continue;
      const baseElevation = baseByRoomId.get(zone.roomId);
      if (Number.isFinite(baseElevation)) zone.position.y += baseElevation;
      zone.absoluteRoomElevationCommitted = true;
    }

    // Upper V1 alternates are authored at a local 4.05 m tier. They remain
    // level connections; only their absolute placement follows the rooms.
    for (const plan of connectionPlans) {
      if ((plan.level ?? 0) > 0) {
        const sourceBase = baseByRoomId.get(plan.fromRoomId) ?? 0;
        const destinationBase = baseByRoomId.get(plan.toRoomId) ?? sourceBase;
        const localElevation = Number(
          plan.localElevation
          ?? (Number.isFinite(plan.sourceElevation)
            ? plan.sourceElevation - sourceBase
            : plan.elevation)
          ?? 0,
        );
        plan.localElevation = localElevation;
        plan.sourceElevation = sourceBase + localElevation;
        plan.destinationElevation = destinationBase + localElevation;
        plan.elevationDelta = plan.destinationElevation - plan.sourceElevation;
        plan.elevation = plan.sourceElevation;
        if (plan.fromSocket) plan.fromSocket.elevation = plan.sourceElevation;
        if (plan.toSocket) plan.toSocket.elevation = plan.destinationElevation;
      }

      for (const socket of [plan.fromSocket, plan.toSocket]) {
        if (!socket?.roomId) continue;
        const room = roomById.get(socket.roomId);
        const existing = room?.exitSockets?.find((entry) => entry.id === socket.id);
        if (existing) Object.assign(existing, socket);
      }
    }

    for (const room of rooms) {
      const ownedFloors = [...uniqueFloors].filter((floor) => floor?.roomId === room.id);
      const lowestFloor = ownedFloors.length
        ? Math.min(...ownedFloors.map((floor) => Number(floor.elevation ?? room.baseElevation)))
        : room.baseElevation;
      const highestFloor = ownedFloors.length
        ? Math.max(...ownedFloors.map((floor) => Number(floor.elevation ?? room.baseElevation)))
        : room.baseElevation;
      room.minY = lowestFloor;
      room.maximumWalkableY = highestFloor;
      room.maxY = Number.isFinite(room.ceilingY)
        ? room.ceilingY
        : highestFloor + PLAYER_TRAVERSAL_ENVELOPE.headClearance;
    }

    return {
      roomElevations: Object.fromEntries(baseByRoomId),
      minimumRoomElevation: Math.min(0, ...baseByRoomId.values()),
      maximumRoomElevation: Math.max(0, ...baseByRoomId.values()),
    };
  }

  _stampConnectionPlans(tiles, connectionPlans = []) {
    // A typed shared threshold owns no corridor body. Its two adjacent
    // boundary cells are stamped by the owning junction cores after all
    // accepted socket openings have been reserved.
    for (const plan of connectionPlans.filter((candidate) => (
      candidate.level === 0 && candidate.isSharedThresholdConnection !== true
    ))) {
      const usesSignedSurfaces = (
        Math.abs(Number(plan.elevationDelta ?? 0)) > 0.001
        || Math.abs(Number(plan.sourceElevation ?? plan.elevation ?? 0)) > 0.001
        || Math.abs(Number(plan.destinationElevation ?? plan.elevation ?? 0)) > 0.001
      );
      // Signed traversal assembly owns these floors. Stamping a temporary Y=0
      // tile first can overwrite an authored route in the same X/Z column
      // even when the two connectors are safely separated vertically.
      const isSupplemental = Boolean(
        plan.isDungeonSupplement || plan.isPaddedByDungeonSupplement,
      );
      if (usesSignedSurfaces && isSupplemental) {
        continue;
      }
      if (isSupplemental) {
        // Preflight the whole footprint before changing any structural tile.
        // A rejected sidecar therefore cannot partially repaint an authored
        // room or another connector before the generation candidate aborts.
        for (const point of plan.fullPath ?? []) {
          const existing = tiles.get(tileKey(point.x, point.z));
          if (!existing) continue;
          const exactThreshold = isPointInsideExactConnectorThreshold(
            plan,
            point,
            existing.roomId ?? null,
          );
          const relatedEndpointRoom = Boolean(
            existing.roomId
            && [plan.fromRoomId, plan.toRoomId].some((roomId) => (
              String(roomId ?? '') === String(existing.roomId)
            ))
            && exactThreshold
          );
          const relatedPaddedOperationRoom = isFloorOwnedByLogicalPaddedOperation(
            plan,
            existing,
          );
          const existingConnectorOwnerIds = physicalFloorOwnerIds(existing)
            .filter((ownerId) => String(ownerId) !== String(existing.roomId ?? ''));
          const hasForeignConnectorOwner = existingConnectorOwnerIds.some((ownerId) => (
            String(ownerId) !== String(plan.id)
          ));
          if (
            (existing.roomId && !relatedEndpointRoom && !relatedPaddedOperationRoom)
            || (hasForeignConnectorOwner && !exactThreshold)
          ) {
            throwSupplementFloorOwnershipConflict({
              planId: plan.id,
              point,
              elevation: Number(plan.elevation ?? 0),
              existingOwnerIds: physicalFloorOwnerIds(existing),
            });
          }
        }
      }
      for (const point of plan.fullPath ?? []) {
        const existing = tiles.get(tileKey(point.x, point.z));
        const existingConnectorOwnerIds = physicalFloorOwnerIds(existing)
          .filter((ownerId) => String(ownerId) !== String(existing?.roomId ?? ''));
        const sharesExactThreshold = Boolean(
          isSupplemental
          && existingConnectorOwnerIds.some((ownerId) => String(ownerId) !== String(plan.id))
          && isPointInsideExactConnectorThreshold(plan, point, existing?.roomId ?? null)
        );
        if (sharesExactThreshold) {
          existing.sharedConnectorFloorOwnerIds = [...new Set([
            ...(existing.sharedConnectorFloorOwnerIds ?? []),
            plan.id,
          ])];
          continue;
        }
        setTile(tiles, point.x, point.z, 'hallway', isSupplemental ? {
          connectorId: plan.id,
          augmentationOwnerId: plan.augmentationOperationId ?? plan.id,
        } : {});
      }
    }
  }

  _applySignedConnectorTraversalSurfaces(tiles, connectionPlans = [], inputFloorTiles = []) {
    let floorTiles = [...inputFloorTiles];
    const roomFootprints = connectionPlans[0]?.connectorVariantConstraints?.roomFootprints ?? [];
    const roomContains = (point) => roomFootprints.some((footprint) => (
      point.x >= footprint.minX
      && point.x <= footprint.maxX
      && point.z >= footprint.minZ
      && point.z <= footprint.maxZ
    ));
    const pointKey = (point) => tileKey(point.x, point.z);
    const pointAt = (point, direction, longitudinal = 0, lateral = 0) => ({
      x: point.x + direction.x * longitudinal - direction.z * lateral,
      z: point.z + direction.z * longitudinal + direction.x * lateral,
    });
    const directionAt = (path, index) => {
      const point = path[index];
      const next = path[index + 1];
      const previous = path[index - 1];
      const forward = next
        ? { x: next.x - point.x, z: next.z - point.z }
        : null;
      if (forward && (forward.x !== 0 || forward.z !== 0)) {
        return { x: Math.sign(forward.x), z: Math.sign(forward.z) };
      }
      return {
        x: Math.sign(point.x - (previous?.x ?? point.x)),
        z: Math.sign(point.z - (previous?.z ?? point.z)),
      };
    };
    const levelForElevation = (elevation) => Number((Number(elevation) / 14).toFixed(3));
    const getFloorAt = (point, elevation) => floorTiles.find((floor) => (
      floor.x === point.x
      && floor.z === point.z
      && Math.abs(Number(floor.elevation ?? 0) - Number(elevation)) <= 0.05
    )) ?? null;
    const addTraversalLink = (fromFloor, toFloor, action, id) => {
      if (!fromFloor || !toFloor) return;
      const toFloorKey = this._getFloorTileGraphKey(toFloor);
      fromFloor.traversalLinks = [
        ...(fromFloor.traversalLinks ?? []).filter((link) => link.id !== id),
        { id, action, toFloorKey },
      ];
    };
    const addBidirectionalTraversalLink = (a, b, action, id) => {
      addTraversalLink(a, b, action, `${id}:forward`);
      addTraversalLink(b, a, action, `${id}:reverse`);
    };
    // Keep the accepted connector graph limited to surfaces authored by this
    // pass. V1's room kit may leave tagged helper floors in the same columns;
    // those are decorative/legacy construction aids and must not become
    // phantom traversal requirements simply because they share a connection
    // id.
    const signedFloorsByPlanId = new Map();
    const registerSignedFloor = (plan, floor) => {
      if (!plan || !floor) return floor;
      const floors = signedFloorsByPlanId.get(plan.id) ?? new Set();
      floors.add(floor);
      signedFloorsByPlanId.set(plan.id, floors);
      return floor;
    };

    const isSupplementalPlan = (plan) => Boolean(
      plan.isDungeonSupplement || plan.isPaddedByDungeonSupplement,
    );
    const elevationPlans = connectionPlans.filter((plan) => (
      plan.level === 0
      && (
        Math.abs(Number(plan.elevationDelta ?? 0)) > 0.001
        || (isSupplementalPlan(plan) && (
          Math.abs(Number(plan.sourceElevation ?? plan.elevation ?? 0)) > 0.001
          || Math.abs(Number(plan.destinationElevation ?? plan.elevation ?? 0)) > 0.001
        ))
      )
    ));
    for (const plan of elevationPlans) {
      const isSupplemental = isSupplementalPlan(plan);
      const ownedColumns = new Set([
        ...(plan.bridgePath ?? []).map(pointKey),
        ...(plan.galleryFootprintTiles ?? []).map(pointKey),
      ]);
      floorTiles = floorTiles.filter((floor) => {
        if (floor?.roomId || !ownedColumns.has(tileKey(floor.x, floor.z))) return true;
        if (!isSupplemental && (
          floor === tiles.get(tileKey(floor.x, floor.z))
          || floor.connectorId === plan.id
          || floor.connectionId === plan.id
        )) {
          return false;
        }
        return true;
      });
      for (const columnKey of ownedColumns) {
        const base = tiles.get(columnKey);
        if (!base || base.roomId) continue;
        if (isSupplemental) continue;
        base.type = 'connectorEnvelope';
        base.surface = 'connectorStructuralEnvelope';
        base.connectorId = plan.id;
        base.connectionId = plan.id;
        base.structuralEnvelopeOnly = true;
      }
    }

    const ensureEnvelope = (point, plan, floorY, ceilingY = floorY + 8.4) => {
      const existing = tiles.get(pointKey(point));
      if (existing?.roomId) return existing;
      const envelope = existing ?? setTile(tiles, point.x, point.z, 'connectorEnvelope', {
        connectorId: plan.id,
        connectionId: plan.id,
        noEnemySpawn: true,
      });
      if (!isSupplementalPlan(plan)) {
        // Preserve Industrial V1's exact last-authored-plan ownership when the
        // sidecar is absent. Multi-owner envelopes exist only to prevent a
        // supplemental elevated route from stealing an authored column.
        envelope.connectorId = plan.id;
        envelope.connectionId = plan.id;
      } else {
        const ownsColumn = !existing
          || existing.connectorId === plan.id
          || existing.connectionId === plan.id
          || existing.structuralEnvelopeOnly;
        if (ownsColumn) {
          envelope.connectorId = plan.id;
          envelope.connectionId = plan.id;
        } else {
          envelope.connectorEnvelopeOwnerIds = [...new Set([
            ...(envelope.connectorEnvelopeOwnerIds ?? []),
            plan.id,
          ])];
        }
      }
      envelope.connectorMinY = Math.min(
        Number(envelope.connectorMinY ?? floorY),
        Number(floorY),
      );
      envelope.connectorCeilingY = Math.max(
        Number(envelope.connectorCeilingY ?? ceilingY),
        Number(ceilingY),
      );
      envelope.structuralEnvelopeOnly = !floorTiles.includes(envelope);
      return envelope;
    };
    const ensureFloor = (point, plan, elevation, options = {}) => {
      const isSupplemental = isSupplementalPlan(plan);
      const column = tiles.get(pointKey(point));
      const matching = getFloorAt(point, elevation);
      if (matching) {
        const exactThreshold = isPointInsideExactConnectorThreshold(
          plan,
          point,
          matching.roomId ?? null,
        );
        const relatedEndpointRoom = Boolean(
          matching.roomId
          && [plan.fromRoomId, plan.toRoomId].some((roomId) => (
            String(roomId ?? '') === String(matching.roomId)
          ))
          && exactThreshold
        );
        const relatedPaddedOperationRoom = isFloorOwnedByLogicalPaddedOperation(plan, matching);
        const belongsToPhysicalEndpointRoom = Boolean(
          matching.roomId
            && [plan.fromRoomId, plan.toRoomId].some((roomId) => (
              String(roomId ?? '') === String(matching.roomId)
            )),
        );
        const foreignOwnerIds = physicalFloorOwnerIds(matching).filter((ownerId) => (
          String(ownerId) !== String(plan.id)
          && String(ownerId) !== String(matching.roomId ?? '')
        ));
        if (isSupplemental
          && belongsToPhysicalEndpointRoom
          && !exactThreshold) {
          // Adjoining supplemental modules can contribute their existing
          // authored floor cells to the connector traversal. Reuse those
          // cells without repainting ownership or connector metadata; every
          // foreign-room overlap and mismatched elevation still rejects.
          return registerSignedFloor(plan, matching);
        }
        if (
          isSupplemental
          && (
            (matching.roomId && !relatedEndpointRoom && !relatedPaddedOperationRoom)
            || (foreignOwnerIds.length > 0 && !exactThreshold)
          )
        ) {
          throwSupplementFloorOwnershipConflict({
            planId: plan.id,
            point,
            elevation,
            existingOwnerIds: physicalFloorOwnerIds(matching),
            details: {
              callsite: 'signed-connector-existing-floor',
              fromRoomId: plan.fromRoomId ?? null,
              toRoomId: plan.toRoomId ?? null,
              matchingRoomId: matching.roomId ?? null,
              exactThreshold,
              relatedEndpointRoom,
              relatedPaddedOperationRoom,
              foreignOwnerIds,
              fromSocket: plan.fromSocket ?? null,
              toSocket: plan.toSocket ?? null,
            },
          });
        }
        const existingOwnerId = matching.signedConnectorFloorOwnerId;
        if (existingOwnerId && existingOwnerId !== plan.id) {
          if (isSupplemental && exactThreshold) {
            matching.sharedConnectorFloorOwnerIds = [...new Set([
              ...(matching.sharedConnectorFloorOwnerIds ?? []),
              plan.id,
            ])];
            ensureEnvelope(
              point,
              plan,
              elevation,
              options.connectorCeilingY ?? elevation + 8.4,
            );
            return registerSignedFloor(plan, matching);
          }
          if (!isSupplemental) {
            const overlapPrefix = `${plan.id} overlaps ${existingOwnerId}`;
            if (!plan.connectorAssemblyErrors.some((error) => error.startsWith(overlapPrefix))) {
              plan.connectorAssemblyErrors.push(
                `${overlapPrefix} at ${point.x},${point.z}@${Number(elevation).toFixed(3)}.`,
              );
            }
            return null;
          }
          throwSupplementFloorOwnershipConflict({
            planId: plan.id,
            point,
            elevation,
            existingOwnerIds: physicalFloorOwnerIds(matching),
            details: {
              callsite: 'signed-connector-existing-signed-owner',
              fromRoomId: plan.fromRoomId ?? null,
              toRoomId: plan.toRoomId ?? null,
              matchingRoomId: matching.roomId ?? null,
              exactThreshold,
              existingOwnerId,
              fromSocket: plan.fromSocket ?? null,
              toSocket: plan.toSocket ?? null,
            },
          });
        }
        if (isSupplemental && foreignOwnerIds.length > 0 && exactThreshold) {
          matching.sharedConnectorFloorOwnerIds = [...new Set([
            ...(matching.sharedConnectorFloorOwnerIds ?? []),
            plan.id,
          ])];
          ensureEnvelope(
            point,
            plan,
            elevation,
            options.connectorCeilingY ?? elevation + 8.4,
          );
          return registerSignedFloor(plan, matching);
        }
        applyTileOptions(matching, {
          connectorId: plan.id,
          connectionId: plan.id,
          noEnemySpawn: true,
          ...options,
        });
        ensureEnvelope(point, plan, elevation, options.connectorCeilingY ?? elevation + 8.4);
        return registerSignedFloor(plan, matching);
      }
      if (
        column?.roomId
        && column.roomId !== plan.fromRoomId
        && column.roomId !== plan.toRoomId
      ) {
        if (isFloorOwnedByLogicalPaddedOperation(plan, column)) return null;
        if (!isSupplemental) return null;
        throwSupplementFloorOwnershipConflict({
          planId: plan.id,
          point,
          elevation,
          existingOwnerIds: physicalFloorOwnerIds(column),
          details: {
            callsite: 'signed-connector-foreign-column',
            fromRoomId: plan.fromRoomId ?? null,
            toRoomId: plan.toRoomId ?? null,
            columnRoomId: column.roomId ?? null,
            fromSocket: plan.fromSocket ?? null,
            toSocket: plan.toSocket ?? null,
          },
        });
      }

      const canReuseColumn = column
        && !floorTiles.includes(column)
        && !column.signedConnectorFloorOwnerId;
      const floor = canReuseColumn
        ? column
        : createFloorTile(point.x, point.z, {
          type: 'hallway',
          elevation,
          level: levelForElevation(elevation),
          surface: options.surface ?? 'connectorGalleryFloor',
        });
      floor.type = options.type ?? 'hallway';
      floor.elevation = elevation;
      floor.level = options.level ?? levelForElevation(elevation);
      floor.surface = options.surface ?? 'connectorGalleryFloor';
      floor.structuralEnvelopeOnly = false;
      floor.signedConnectorFloorOwnerId = plan.id;
      applyTileOptions(floor, {
        elevation,
        level: floor.level,
        connectorId: plan.id,
        connectionId: plan.id,
        connectorZone: options.connectorZone ?? 'main_gallery',
        supportStyle: options.supportStyle ?? 'connector_girder_posts',
        supportBaseElevation: Number.isFinite(options.supportBaseElevation)
          ? options.supportBaseElevation
          : Math.min(plan.sourceElevation, plan.destinationElevation),
        noEnemySpawn: true,
        ...(column?.roomId ? { roomId: column.roomId } : {}),
        ...options,
      });
      floor.floorKey = absoluteFloorTileKey(floor.x, floor.z, floor.elevation);
      if (!floorTiles.includes(floor)) floorTiles.push(floor);
      ensureEnvelope(point, plan, elevation, options.connectorCeilingY ?? elevation + 8.4);
      return registerSignedFloor(plan, floor);
    };
    const planSections = new Map();
    const recordSection = (
      plan,
      center,
      direction,
      elevation,
      zone,
      pathIndex = null,
      ceilingY = elevation + 8.4,
    ) => {
      const sections = planSections.get(plan.id) ?? [];
      const resolvedPathIndex = Number.isFinite(pathIndex) ? pathIndex : sections.length;
      sections.push({
        pathIndex: resolvedPathIndex,
        sections: [{
          direction: { ...direction },
          center: { ...center },
          galleryCenter: { ...center },
          laneOffsets: [-1, 0, 1],
          lateralPoints: [-1, 1].map((offset) => pointAt(center, direction, 0, offset)),
          elevation,
          ceilingY,
          pathIndex: resolvedPathIndex,
          connectorZone: zone,
        }],
      });
      planSections.set(plan.id, sections);
    };
    const addWideFloor = (center, direction, plan, elevation, options = {}) => {
      let centerFloor = null;
      for (const lateral of [-1, 0, 1]) {
        const point = pointAt(center, direction, 0, lateral);
        const floor = ensureFloor(point, plan, elevation, options);
        if (lateral === 0) centerFloor = floor;
      }
      if (!roomContains(center)) {
        recordSection(
          plan,
          center,
          direction,
          elevation,
          options.connectorZone ?? 'main_gallery',
          options.pathIndex,
          options.connectorCeilingY ?? elevation + 8.4,
        );
      }
      return centerFloor;
    };
    const addLandingRect = (
      origin,
      direction,
      plan,
      elevation,
      longitudinalValues,
      lateralValues,
      options = {},
    ) => {
      const result = [];
      for (const longitudinal of longitudinalValues) {
        for (const lateral of lateralValues) {
          const point = pointAt(origin, direction, longitudinal, lateral);
          const floor = ensureFloor(point, plan, elevation, options);
          if (floor) result.push(floor);
        }
      }
      return result;
    };
    const addPathRange = (plan, startIndex, endIndex, elevation, options = {}) => {
      const path = plan.bridgePath ?? [];
      if (!path.length || endIndex < startIndex) return [];
      const floors = [];
      for (let index = Math.max(0, startIndex); index <= Math.min(path.length - 1, endIndex); index += 1) {
        const point = path[index];
        const direction = directionAt(path, index);
        const floor = addWideFloor(point, direction, plan, elevation, {
          surface: 'connectorGalleryFloor',
          connectorZone: options.connectorZone ?? 'main_gallery',
          pathIndex: index,
          ...options,
        });
        if (floor) floors.push(floor);
        const previousDirection = index > startIndex ? directionAt(path, index - 1) : direction;
        if (!roomContains(point)
          && (previousDirection.x !== direction.x || previousDirection.z !== direction.z)) {
          floors.push(...addLandingRect(
            point,
            direction,
            plan,
            elevation,
            [-1, 0, 1],
            [-1, 0, 1],
            {
              surface: 'connectorGalleryFloor',
              connectorZone: 'gallery_turn_landing',
              ...options,
            },
          ));
        }
      }
      return floors;
    };
    const addRampFlight = ({
      plan,
      start,
      direction,
      startElevation,
      endElevation,
      id,
      segmentCount = 13,
    }) => {
      const floors = [];
      for (let segment = 0; segment < segmentCount; segment += 1) {
        const center = pointAt(start, direction, segment, 0);
        const segmentStart = THREE.MathUtils.lerp(startElevation, endElevation, segment / segmentCount);
        const segmentEnd = THREE.MathUtils.lerp(startElevation, endElevation, (segment + 1) / segmentCount);
        const elevation = (segmentStart + segmentEnd) * 0.5;
        for (const lateral of [-1, 0, 1]) {
          const point = pointAt(center, direction, 0, lateral);
          const floor = ensureFloor(point, plan, elevation, {
            surface: 'industrialRamp',
            connectorZone: 'switchback_slope_flight',
            rampStartElevation: segmentStart,
            rampEndElevation: segmentEnd,
            rampDirectionX: direction.x,
            rampDirectionZ: direction.z,
            rampRouteId: `${plan.id}:switchback`,
            rampRunId: `${id}:lane:${lateral}`,
            rampPointIndex: segment,
            rampPointCount: segmentCount,
            supportStyle: 'connector_girder_posts',
            connectorCeilingY: Math.max(startElevation, endElevation) + 5.2,
          });
          if (floor) floors.push(floor);
        }
        recordSection(plan, center, direction, elevation, 'switchback_slope_flight');
      }
      return floors;
    };
    const serializeLanding = (floors) => floors.map((floor) => ({
      x: floor.x,
      z: floor.z,
      elevation: floor.elevation,
      level: floor.level,
      floorKey: this._getFloorTileGraphKey(floor),
    }));
    const appendFloorEdge = (floor, property, dx, dz) => {
      if (!floor) return;
      const edge = `${Math.sign(dx)},${Math.sign(dz)}`;
      floor[property] = [...new Set([...(floor[property] ?? []), edge])];
    };
    const markLandingAccess = ({
      floors,
      openingColumns,
      guardFlanks = false,
    }) => {
      if (!floors?.length || !openingColumns?.size) return;
      const directAccess = [];
      for (const floor of floors) {
        for (const [dx, dz] of DIRECTIONS) {
          if (!openingColumns.has(pointKey({ x: floor.x + dx, z: floor.z + dz }))) continue;
          appendFloorEdge(floor, 'openRetainingWallEdges', dx, dz);
          directAccess.push({ floor, dx, dz });
        }
      }
      if (!guardFlanks || directAccess.length === 0) return;
      const { dx, dz } = directAccess[0];
      const frontProjection = Math.max(...floors.map((floor) => floor.x * dx + floor.z * dz));
      const frontRow = floors.filter((floor) => (
        floor.x * dx + floor.z * dz === frontProjection
      ));
      for (const floor of frontRow) {
        if (directAccess.some((entry) => entry.floor === floor)) continue;
        appendFloorEdge(floor, 'forcedRetainingWallEdges', dx, dz);
      }
    };
    const clearStaticFloorColumns = (points, plan, minY, ceilingY) => {
      const keys = new Set(points.map(pointKey));
      floorTiles = floorTiles.filter((floor) => {
        if (floor.roomId || !keys.has(tileKey(floor.x, floor.z))) return true;
        return floor.connectionId !== plan.id && floor.connectorId !== plan.id;
      });
      for (const point of points) {
        const envelope = ensureEnvelope(point, plan, minY, ceilingY);
        if (!envelope?.roomId) {
          envelope.type = 'connectorEnvelope';
          envelope.surface = 'connectorStructuralEnvelope';
          envelope.structuralEnvelopeOnly = true;
        }
      }
    };

    for (const plan of connectionPlans) {
      const path = plan.bridgePath ?? [];
      if (!path.length) continue;
      const sourceElevation = Number(plan.sourceElevation ?? plan.elevation ?? 0);
      const destinationElevation = Number(plan.destinationElevation ?? sourceElevation);
      const contract = plan.connectorVariant;
      plan.ladderContracts = [];
      plan.liftContracts = [];
      plan.connectorAssemblyErrors = [];
      plan.flatBayCandidates = [];
      plan.occupiedStructuralVolumes = [];
      plan.clearanceVolumes = [];

      if (plan.isSharedThresholdConnection === true) {
        const sourceFloor = getFloorAt(plan.fromSocket, sourceElevation);
        const destinationFloor = getFloorAt(plan.toSocket, destinationElevation);
        if (sourceFloor) plan.fromSocket.floorKey = this._getFloorTileGraphKey(sourceFloor);
        if (destinationFloor) plan.toSocket.floorKey = this._getFloorTileGraphKey(destinationFloor);
        plan.galleryCrossSections = [];
        plan.galleryFootprintTiles = [];
        plan.traversalFloorKeys = [...new Set([
          sourceFloor && this._getFloorTileGraphKey(sourceFloor),
          destinationFloor && this._getFloorTileGraphKey(destinationFloor),
        ].filter(Boolean))];
        if (!sourceFloor || !destinationFloor) {
          plan.connectorAssemblyErrors.push(
            `${plan.id} shared threshold is missing one of its owning junction-core floors.`,
          );
        }
        continue;
      }

      if (!contract || contract.traversalKind === 'walk') {
        addPathRange(plan, 0, path.length - 1, sourceElevation, {
          connectorZone: contract ? 'classic_service_gallery' : 'classic_v1_corridor',
          supportBaseElevation: sourceElevation,
        });
      } else if (contract.traversalKind === 'slope') {
        const run = contract.pathContract.selectedStraightRun;
        const slopeConstruction = contract.construction;
        const [firstFlightContract, secondFlightContract] = slopeConstruction.flights ?? [];
        const segmentCount = Number(slopeConstruction.segmentsPerFlight);
        if ((run.endIndex - run.startIndex) < segmentCount - 1) {
          plan.connectorAssemblyErrors.push(`${plan.id} lacks ${segmentCount} exterior tiles for its first switchback flight.`);
          continue;
        }
        const direction = directionAt(path, run.startIndex);
        const start = { ...firstFlightContract?.startGridPoint };
        const intermediateElevation = sourceElevation + (destinationElevation - sourceElevation) * 0.5;
        const sideSign = Number(slopeConstruction.switchbackSideSign);
        const sideIsClear = [1, -1].includes(sideSign) && (() => {
          const testPoints = [];
          for (let longitudinal = -1; longitudinal <= run.endIndex - run.startIndex; longitudinal += 1) {
            for (let lateral = -1; lateral <= 7; lateral += 1) {
              testPoints.push(pointAt(start, direction, longitudinal, lateral * sideSign));
            }
          }
          return testPoints.every((point) => !roomContains(point));
        })();
        if (!firstFlightContract
          || !secondFlightContract
          || !Number.isInteger(segmentCount)
          || segmentCount !== 13
          || direction.x !== slopeConstruction.sourceFlightDirection?.x
          || direction.z !== slopeConstruction.sourceFlightDirection?.z
          || !sideIsClear) {
          plan.connectorAssemblyErrors.push(
            `${plan.id} has no valid immutable switchback footprint clear of authored rooms.`,
          );
          continue;
        }
        const lateralSign = sideSign;
        addPathRange(plan, 0, run.startIndex - 1, sourceElevation, {
          connectorZone: 'slope_source_approach',
          supportBaseElevation: sourceElevation,
        });
        const firstRamp = addRampFlight({
          plan,
          start,
          direction,
          startElevation: sourceElevation,
          endElevation: intermediateElevation,
          id: firstFlightContract.id,
          segmentCount,
        });
        const farOrigin = { ...slopeConstruction.switchbackLandingOriginGridPoint };
        const switchbackLanding = addLandingRect(
          farOrigin,
          direction,
          plan,
          intermediateElevation,
          [-1, 0, 1],
          [0, lateralSign, lateralSign * 2, lateralSign * 3],
          {
            surface: 'rampLanding',
            connectorZone: 'slope_switchback_landing',
            connectorCeilingY: intermediateElevation + 5.2,
          },
        );
        const secondStart = { ...secondFlightContract.startGridPoint };
        const reverseDirection = { ...slopeConstruction.returnFlightDirection };
        const secondRamp = addRampFlight({
          plan,
          start: secondStart,
          direction: reverseDirection,
          startElevation: intermediateElevation,
          endElevation: destinationElevation,
          id: secondFlightContract.id,
          segmentCount,
        });
        const arrivalOrigin = { ...slopeConstruction.destinationLandingOriginGridPoint };
        const arrivalLanding = addLandingRect(
          arrivalOrigin,
          direction,
          plan,
          destinationElevation,
          [-1, 0, 1],
          [0, lateralSign, lateralSign * 2, lateralSign * 3],
          {
            surface: 'rampLanding',
            connectorZone: 'slope_destination_landing',
            connectorCeilingY: destinationElevation + 5.2,
          },
        );
        const destinationLaneOffset = Number(slopeConstruction.destinationLaneOffsetTiles);
        for (let longitudinal = -1; longitudinal <= run.endIndex - run.startIndex; longitudinal += 1) {
          addWideFloor(
            pointAt(start, direction, longitudinal, destinationLaneOffset),
            direction,
            plan,
            destinationElevation,
            {
              surface: 'upperConnectionBridge',
              connectorZone: 'slope_destination_approach',
              supportStyle: 'connector_girder_posts',
              connectorCeilingY: destinationElevation + 8.4,
            },
          );
        }
        const farDestinationOrigin = { ...slopeConstruction.destinationCrossoverOriginGridPoint };
        addLandingRect(
          farDestinationOrigin,
          direction,
          plan,
          destinationElevation,
          [-1, 0, 1],
          rangeBetween(0, Math.abs(destinationLaneOffset)).map((value) => value * lateralSign),
          {
            surface: 'upperConnectionBridge',
            connectorZone: 'slope_destination_crossover',
            connectorCeilingY: destinationElevation + 5.2,
          },
        );
        addPathRange(plan, run.endIndex, path.length - 1, destinationElevation, {
          connectorZone: 'slope_destination_approach',
          connectorCeilingY: destinationElevation + 8.4,
        });
        const sourceFloor = firstRamp[1] ?? firstRamp[0];
        const destinationFloor = arrivalLanding.find((floor) => (
          floor.x === arrivalOrigin.x && floor.z === arrivalOrigin.z
        )) ?? arrivalLanding[0];
        if (sourceFloor && destinationFloor) {
          // The physical ramp remains authoritative; this link records the
          // accepted bidirectional mechanism route for validation/minimap use.
          plan.slopeTraversalContract = {
            id: `${plan.id}:switchback`,
            direction: plan.direction,
            sourceElevation,
            intermediateElevation,
            destinationElevation,
            segmentCountPerFlight: segmentCount,
            switchbackSideSign: lateralSign,
            firstFlightContractId: firstFlightContract.id,
            secondFlightContractId: secondFlightContract.id,
            firstFlightStartGridPoint: { ...firstFlightContract.startGridPoint },
            firstFlightEndGridPoint: { ...firstFlightContract.endGridPoint },
            secondFlightStartGridPoint: { ...secondFlightContract.startGridPoint },
            secondFlightEndGridPoint: { ...secondFlightContract.endGridPoint },
            firstFlightFloorCount: firstRamp.length,
            secondFlightFloorCount: secondRamp.length,
            switchbackLandingTiles: serializeLanding(switchbackLanding),
            destinationLandingTiles: serializeLanding(arrivalLanding),
          };
        }
      } else if (contract.traversalKind === 'ladder') {
        const run = contract.pathContract.selectedStraightRun;
        const apertureIndex = Math.max(
          run.startIndex + 3,
          Math.min(run.endIndex - 3, contract.mechanisms[0]?.pathIndex ?? Math.floor((run.startIndex + run.endIndex) * 0.5)),
        );
        const direction = directionAt(path, apertureIndex);
        const aperturePoint = path[apertureIndex];
        const sourceExitPoint = path[apertureIndex - 1];
        const destinationExitPoint = path[apertureIndex + 1];
        if (!aperturePoint || !sourceExitPoint || !destinationExitPoint) {
          plan.connectorAssemblyErrors.push(`${plan.id} has no clear single-shaft ladder bay.`);
          continue;
        }
        addPathRange(plan, 0, apertureIndex - 1, sourceElevation, {
          connectorZone: 'ladder_source_approach',
          connectorCeilingY: sourceElevation + 8.4,
        });
        addPathRange(plan, apertureIndex + 1, path.length - 1, destinationElevation, {
          connectorZone: 'ladder_destination_approach',
          connectorCeilingY: destinationElevation + 8.4,
        });
        const sourceLanding = addLandingRect(
          sourceExitPoint,
          direction,
          plan,
          sourceElevation,
          [-2, -1, 0],
          [-1, 0, 1],
          {
            surface: 'connectorGalleryFloor',
            connectorZone: 'ladder_source_landing',
            connectorCeilingY: Math.max(sourceElevation, destinationElevation) + 4.2,
          },
        );
        const destinationLanding = addLandingRect(
          destinationExitPoint,
          direction,
          plan,
          destinationElevation,
          [0, 1, 2],
          [-1, 0, 1],
          {
            surface: 'upperConnectionBridge',
            connectorZone: 'ladder_destination_landing',
            connectorCeilingY: Math.max(sourceElevation, destinationElevation) + 4.2,
          },
        );
        if (plan.shortcutMode === 'drop-ladder') {
          // A one-side-deployed ladder starts retracted. Keep the accepted
          // gallery deck across its aperture so the unavailable shortcut is
          // not an unguarded drop; climbing uses the adjacent exact landing
          // floors after the far-side control deploys the ladder.
          plan.shortcutHatchRetained = true;
        } else {
          clearStaticFloorColumns(
            [aperturePoint],
            plan,
            Math.min(sourceElevation, destinationElevation),
            Math.max(sourceElevation, destinationElevation) + 4.2,
          );
        }
        const sourceIsLower = sourceElevation < destinationElevation;
        const bottomExitPoint = sourceIsLower ? sourceExitPoint : destinationExitPoint;
        const topExitPoint = sourceIsLower ? destinationExitPoint : sourceExitPoint;
        const bottomLanding = sourceIsLower ? sourceLanding : destinationLanding;
        const topLanding = sourceIsLower ? destinationLanding : sourceLanding;
        const apertureColumns = new Set([pointKey(aperturePoint)]);
        markLandingAccess({
          floors: bottomLanding,
          openingColumns: apertureColumns,
        });
        markLandingAccess({
          floors: topLanding,
          openingColumns: apertureColumns,
          guardFlanks: true,
        });
        const bottomY = Math.min(sourceElevation, destinationElevation);
        const topY = Math.max(sourceElevation, destinationElevation);
        const planeCenter = new THREE.Vector3(
          aperturePoint.x * this.tileSize,
          0,
          aperturePoint.z * this.tileSize,
        );
        const planeNormal = new THREE.Vector3(
          bottomExitPoint.x - aperturePoint.x,
          0,
          bottomExitPoint.z - aperturePoint.z,
        ).normalize();
        const bottomExit = new THREE.Vector3(
          bottomExitPoint.x * this.tileSize,
          bottomY,
          bottomExitPoint.z * this.tileSize,
        );
        const topExit = new THREE.Vector3(
          topExitPoint.x * this.tileSize,
          topY,
          topExitPoint.z * this.tileSize,
        );
        const ladder = {
          ...contract.mechanisms[0],
          id: contract.mechanisms[0]?.id ?? `${plan.id}:ladder`,
          label: 'Maintenance Ladder',
          connectionId: plan.id,
          direction: plan.direction,
          center: planeCenter.clone().addScaledVector(planeNormal, 0.4),
          planeCenter,
          planeNormal,
          facing: planeNormal.clone().negate(),
          bottomY,
          topY,
          bottomMountPosition: bottomExit.clone(),
          topMountPosition: topExit.clone(),
          bottomExit,
          topExit,
          bottomExitFacing: planeNormal.clone(),
          topExitFacing: planeNormal.clone().negate(),
          mountRadius: 2.25,
          bodyClearance: 0.4,
          width: 1.7,
          caged: true,
          apertureGridPoint: { ...aperturePoint },
          landingWidthTiles: 3,
          landingDepthTiles: 3,
          landingWidthMeters: this.tileSize * 3,
          landingDepthMeters: this.tileSize * 3,
          bottomLandingTiles: serializeLanding(bottomLanding),
          topLandingTiles: serializeLanding(topLanding),
        };
        const sourceFloor = getFloorAt(sourceExitPoint, sourceElevation);
        const destinationFloor = getFloorAt(destinationExitPoint, destinationElevation);
        addBidirectionalTraversalLink(sourceFloor, destinationFloor, 'ladder', ladder.id);
        plan.ladderContracts = [ladder];
      } else if (contract.traversalKind === 'automatic_lift') {
        const run = contract.pathContract.selectedStraightRun;
        const direction = directionAt(path, run.startIndex);
        const shaftContract = contract.liftShaft;
        const shaftStartIndex = Number(shaftContract?.startPathIndex);
        const shaftEndIndex = Number(shaftContract?.endPathIndex);
        if (!Number.isInteger(shaftStartIndex)
          || !Number.isInteger(shaftEndIndex)
          || shaftEndIndex - shaftStartIndex !== 3) {
          plan.connectorAssemblyErrors.push(`${plan.id} has no immutable 4x4 lift shaft contract.`);
          continue;
        }
        if (shaftStartIndex - 3 < run.startIndex || shaftEndIndex + 3 > run.endIndex) {
          plan.connectorAssemblyErrors.push(`${plan.id} has no clear 11.2m lift shaft plus two 3x3 landings.`);
          continue;
        }
        const sourceLandingCenter = path[shaftContract.sourceLandingPathIndex];
        const destinationLandingCenter = path[shaftContract.destinationLandingPathIndex];
        if (!sourceLandingCenter || !destinationLandingCenter) {
          plan.connectorAssemblyErrors.push(`${plan.id} lift contract references an invalid landing path index.`);
          continue;
        }
        addPathRange(plan, 0, shaftStartIndex - 1, sourceElevation, {
          connectorZone: 'lift_source_approach',
          connectorCeilingY: sourceElevation + 8.4,
        });
        addPathRange(plan, shaftEndIndex + 1, path.length - 1, destinationElevation, {
          connectorZone: 'lift_destination_approach',
          connectorCeilingY: destinationElevation + 8.4,
        });
        const sourceLanding = addLandingRect(
          sourceLandingCenter,
          direction,
          plan,
          sourceElevation,
          [-2, -1, 0],
          [-1, 0, 1],
          {
            surface: 'connectorGalleryFloor',
            connectorZone: 'lift_source_landing',
            connectorCeilingY: Math.max(sourceElevation, destinationElevation) + 4.2,
          },
        );
        const destinationLanding = addLandingRect(
          destinationLandingCenter,
          direction,
          plan,
          destinationElevation,
          [0, 1, 2],
          [-1, 0, 1],
          {
            surface: 'upperConnectionBridge',
            connectorZone: 'lift_destination_landing',
            connectorCeilingY: Math.max(sourceElevation, destinationElevation) + 4.2,
          },
        );
        const shaftColumns = (shaftContract.gridColumns ?? []).map((point) => ({ ...point }));
        if (shaftColumns.length !== 16) {
          plan.connectorAssemblyErrors.push(`${plan.id} lift contract does not reserve all sixteen shaft columns.`);
          continue;
        }
        clearStaticFloorColumns(
          shaftColumns,
          plan,
          Math.min(sourceElevation, destinationElevation),
          Math.max(sourceElevation, destinationElevation) + 4.2,
        );
        const shaftColumnKeys = new Set(shaftColumns.map(pointKey));
        markLandingAccess({
          floors: sourceLanding,
          openingColumns: shaftColumnKeys,
        });
        markLandingAccess({
          floors: destinationLanding,
          openingColumns: shaftColumnKeys,
        });
        const platformCenter = new THREE.Vector3(
          shaftContract.center.x,
          sourceElevation,
          shaftContract.center.z,
        );
        const sourceControlPoint = pointAt(sourceLandingCenter, direction, -1, 2);
        const destinationControlPoint = pointAt(destinationLandingCenter, direction, 1, 2);
        const sourceControlTile = ensureFloor(sourceControlPoint, plan, sourceElevation, {
          surface: 'connectorGalleryFloor',
          connectorZone: 'lift_source_control_alcove',
          connectorCeilingY: Math.max(sourceElevation, destinationElevation) + 4.2,
        });
        const destinationControlTile = ensureFloor(destinationControlPoint, plan, destinationElevation, {
          surface: 'upperConnectionBridge',
          connectorZone: 'lift_destination_control_alcove',
          connectorCeilingY: Math.max(sourceElevation, destinationElevation) + 4.2,
        });
        if (!sourceControlTile || !destinationControlTile) {
          plan.connectorAssemblyErrors.push(
            `${plan.id} cannot place both side-mounted lift recall controls outside the shaft.`,
          );
          continue;
        }
        const mechanism = contract.mechanisms[0];
        const controlOutward = new THREE.Vector3(-direction.z, 0, direction.x)
          .multiplyScalar(this.tileSize * 0.34);
        const sourceControlPosition = this._floorTileToWorld(sourceControlTile)
          .add(controlOutward);
        const destinationControlPosition = this._floorTileToWorld(destinationControlTile)
          .add(controlOutward);
        const bottomElevation = Math.min(sourceElevation, destinationElevation);
        const topElevation = Math.max(sourceElevation, destinationElevation);
        const sourceIsBottom = sourceElevation === bottomElevation;
        const platformWidthMeters = Number(mechanism?.platformWidthMeters);
        const platformDepthMeters = Number(mechanism?.platformDepthMeters);
        const shaftWidthMeters = Number(shaftContract.widthMeters);
        const shaftDepthMeters = Number(shaftContract.depthMeters);
        const landingSills = (contract.landingSills ?? []).map((sill) => ({
          ...sill,
          center: new THREE.Vector3(sill.center.x, sill.center.y, sill.center.z),
          carEdgeCenter: new THREE.Vector3(
            sill.carEdgeCenter.x,
            sill.carEdgeCenter.y,
            sill.carEdgeCenter.z,
          ),
          landingEdgeCenter: new THREE.Vector3(
            sill.landingEdgeCenter.x,
            sill.landingEdgeCenter.y,
            sill.landingEdgeCenter.z,
          ),
          supportPosts: (sill.supportPosts ?? []).map((post) => ({
            ...post,
            center: { ...post.center },
            size: { ...post.size },
          })),
          sourceContractSillId: sill.id,
        }));
        if (landingSills.length !== 2) {
          plan.connectorAssemblyErrors.push(`${plan.id} lift contract does not own both landing sills.`);
          continue;
        }
        const lift = {
          ...mechanism,
          id: mechanism?.id ?? `${plan.id}:lift`,
          connectionId: plan.id,
          direction: plan.direction,
          center: platformCenter,
          facing: new THREE.Vector3(direction.x, 0, direction.z),
          bottomElevation,
          topElevation,
          initialElevation: sourceElevation,
          initialDirection: sourceIsBottom ? 'up' : 'down',
          bottomFloorKey: this._getFloorTileGraphKey(
            sourceIsBottom ? sourceLanding[0] : destinationLanding[0],
          ),
          topFloorKey: this._getFloorTileGraphKey(
            sourceIsBottom ? destinationLanding[0] : sourceLanding[0],
          ),
          platformWidthMeters,
          platformDepthMeters,
          shaftWidthMeters,
          shaftDepthMeters,
          shaftCeilingY: shaftContract.ceilingY,
          shaftHeadroomMeters: shaftContract.headroomMeters,
          liftShaft: shaftContract,
          riderClearanceMeters: Number(mechanism?.riderClearanceMeters),
          landingWidthTiles: 3,
          landingDepthTiles: 3,
          bottomLandingTiles: serializeLanding(sourceIsBottom ? sourceLanding : destinationLanding),
          topLandingTiles: serializeLanding(sourceIsBottom ? destinationLanding : sourceLanding),
          landingSills,
          controlAnchors: {
            bottom: sourceIsBottom
              ? { floorKey: this._getFloorTileGraphKey(sourceControlTile), position: sourceControlPosition }
              : { floorKey: this._getFloorTileGraphKey(destinationControlTile), position: destinationControlPosition },
            top: sourceIsBottom
              ? { floorKey: this._getFloorTileGraphKey(destinationControlTile), position: destinationControlPosition }
              : { floorKey: this._getFloorTileGraphKey(sourceControlTile), position: sourceControlPosition },
          },
        };
        const sourceFloor = getFloorAt(sourceLandingCenter, sourceElevation);
        const destinationFloor = getFloorAt(destinationLandingCenter, destinationElevation);
        addBidirectionalTraversalLink(sourceFloor, destinationFloor, 'automatic_lift', lift.id);
        plan.liftContracts = [lift];
      }

      const sourceFloor = getFloorAt(plan.fromSocket, sourceElevation);
      const destinationFloor = getFloorAt(plan.toSocket, destinationElevation);
      if (sourceFloor) plan.fromSocket.floorKey = this._getFloorTileGraphKey(sourceFloor);
      if (destinationFloor) plan.toSocket.floorKey = this._getFloorTileGraphKey(destinationFloor);
      plan.galleryCrossSections = planSections.get(plan.id) ?? [];
      const ownedFloors = [...(signedFloorsByPlanId.get(plan.id) ?? [])]
        .filter((floor) => floorTiles.includes(floor));
      const exteriorOwnedFloors = ownedFloors.filter((floor) => !floor.roomId);
      plan.galleryFootprintTiles = [...new Map(ownedFloors.map((floor) => [
        `${floor.x},${floor.z},${Number(floor.elevation).toFixed(3)}`,
        { x: floor.x, z: floor.z, elevation: floor.elevation },
      ])).values()];
      plan.occupiedStructuralVolumes = [
        ...exteriorOwnedFloors.map((floor, index) => ({
          id: `${plan.id}:structural-floor:${index}`,
          connectorId: plan.id,
          purpose: 'walkable_connector_floor_slab',
          center: {
            x: floor.x * this.tileSize,
            y: Number(floor.elevation ?? 0) - 0.08,
            z: floor.z * this.tileSize,
          },
          size: {
            x: this.tileSize,
            y: 0.2,
            z: this.tileSize,
          },
        })),
        ...(plan.connectorVariant?.structuralVolumes ?? []).map((volume) => ({
          ...volume,
          center: { ...volume.center },
          size: { ...volume.size },
          connectorId: plan.id,
          sourceContractVolumeId: volume.id,
        })),
      ];
      plan.clearanceVolumes = [
        ...exteriorOwnedFloors.map((floor, index) => ({
          id: `${plan.id}:player-clearance:${index}`,
          connectorId: plan.id,
          purpose: 'walkable_connector_player_clearance',
          center: {
            x: floor.x * this.tileSize,
            y: Number(floor.elevation ?? 0) + 1.8,
            z: floor.z * this.tileSize,
          },
          size: {
            x: this.tileSize,
            y: 3.6,
            z: this.tileSize,
          },
        })),
        ...(plan.connectorVariant?.sweptVolumes ?? []).map((volume) => ({
          ...volume,
          center: { ...volume.center },
          size: { ...volume.size },
          connectorId: plan.id,
          sourceContractVolumeId: volume.id,
        })),
        ...(plan.liftContracts ?? []).flatMap((lift) => (
          (lift.landingSills ?? []).map((sill) => ({
            id: `${sill.id}:player-clearance`,
            connectorId: plan.id,
            purpose: 'lift_landing_sill_player_clearance',
            center: {
              x: sill.center.x,
              y: sill.topY + lift.riderClearanceMeters * 0.5,
              z: sill.center.z,
            },
            size: {
              x: sill.halfWidth * 2,
              y: lift.riderClearanceMeters,
              z: sill.halfDepth * 2,
            },
          }))
        )),
      ];
      plan.traversalFloorKeys = [...new Set(ownedFloors.map((floor) => (
        this._getFloorTileGraphKey(floor)
      )))];
      const allGalleryCenters = (plan.galleryCrossSections ?? [])
        .flatMap((crossSection) => crossSection.sections ?? [])
        .filter((section, index, array) => index === array.findIndex((candidate) => (
          candidate.center.x === section.center.x
          && candidate.center.z === section.center.z
          && Math.abs(candidate.elevation - section.elevation) <= 0.05
        )))
        .sort((left, right) => (
          Number(left.pathIndex ?? 0) - Number(right.pathIndex ?? 0)
          || Number(left.elevation ?? 0) - Number(right.elevation ?? 0)
          || left.center.z - right.center.z
          || left.center.x - right.center.x
        ));
      const flatCenters = allGalleryCenters
        .filter((section) => !/(?:flight|turn|landing|control|shaft|aperture)/i.test(
          section.connectorZone ?? '',
        ));
      const isClearOfSocket = (section, socket) => (
        Math.abs(section.center.x - socket.x) + Math.abs(section.center.z - socket.z) >= 3
      );
      const machineryIndices = (plan.connectorVariant?.mechanisms ?? [])
        .map((mechanism) => Number(mechanism.pathIndex))
        .filter(Number.isFinite);
      const clearanceCenters = flatCenters.filter((section) => (
        isClearOfSocket(section, plan.fromSocket)
        && isClearOfSocket(section, plan.toSocket)
        && machineryIndices.every((pathIndex) => (
          Math.abs(Number(section.pathIndex) - pathIndex) >= 5
        ))
      ));
      // Preserve the dense V1 decorative-arch rhythm on every classic
      // gallery. Trap clearance is stricter and is computed independently.
      // Decorative V1 arches continue across turns and signed slope flights;
      // only the exact mechanism/control bays are clear. Restricting arches to
      // perfectly flat approach cells left entire short branch connectors and
      // both 13-segment flights visually bare.
      const usesV4RouteNetworkArchClearance = (
        this._connectorDecorativeArchWidthTiles(plan)
          > CONNECTOR_DECORATIVE_ARCH_WIDTH_TILES + 0.001
      );
      const v4TurnBufferIndexes = new Set();
      if (usesV4RouteNetworkArchClearance) {
        const routePath = plan.bridgePath ?? plan.fullPath ?? [];
        for (let pathIndex = 1; pathIndex < routePath.length - 1; pathIndex += 1) {
          const previous = routePath[pathIndex - 1];
          const current = routePath[pathIndex];
          const next = routePath[pathIndex + 1];
          const incoming = {
            x: Math.sign(current.x - previous.x),
            z: Math.sign(current.z - previous.z),
          };
          const outgoing = {
            x: Math.sign(next.x - current.x),
            z: Math.sign(next.z - current.z),
          };
          if (incoming.x === outgoing.x && incoming.z === outgoing.z) continue;
          for (const offset of [-1, 0, 1]) v4TurnBufferIndexes.add(pathIndex + offset);
        }
      }
      const archEligibleCenters = allGalleryCenters.filter((section) => (
        !/(?:control|shaft|aperture)/i.test(section.connectorZone ?? '')
        && (
          !usesV4RouteNetworkArchClearance
            || (
              !/(?:turn|elbow|bend)/i.test(section.connectorZone ?? '')
              && !v4TurnBufferIndexes.has(Number(section.pathIndex))
            )
        )
      ));
      const archCandidates = archEligibleCenters.filter((_, index) => index % 3 === 0);
      const archCoordinates = new Set(archCandidates.map((section) => (
        `${section.center.x},${section.center.z},${Number(section.elevation).toFixed(2)}`
      )));
      const trapCenters = clearanceCenters.filter((section) => (
        Number(section.ceilingY ?? section.elevation + 8.4) - section.elevation >= 7.3
        && !archCoordinates.has(
          `${section.center.x},${section.center.z},${Number(section.elevation).toFixed(2)}`,
        )
      ));
      plan.flatBayCandidates = trapCenters.map((section, index) => ({
        id: `${plan.id}:flat-bay:${index}`,
        flat: true,
        clearanceVerified: true,
        center: {
          x: section.center.x * this.tileSize,
          y: section.elevation,
          z: section.center.z * this.tileSize,
        },
        floorElevation: section.elevation,
        ceilingY: Number(section.ceilingY ?? section.elevation + 8.4),
        longitudinalIndex: Number(section.pathIndex ?? index),
        pathIndex: Number(section.pathIndex ?? index),
        longitudinalDirection: { ...section.direction },
        galleryWidthMeters: this.tileSize * 3,
        destinationSide: index >= Math.floor(trapCenters.length * 0.5),
        connectorZone: section.connectorZone,
      }));
      plan.decorativeArchBeats = archCandidates.map((section, index) => {
        const widthMeters = this.tileSize * this._connectorDecorativeArchWidthTiles(plan);
        return finalizeConnectorDecorativeArchBeat({
          id: `${plan.id}:decorative-arch:${index}`,
          pathIndex: section.pathIndex ?? index * 3,
          gridPoint: { ...section.center },
          direction: { ...section.direction },
          widthMeters,
          internalClearWidthMeters: widthMeters - CONNECTOR_DECORATIVE_ARCH_COLUMN_HALF_SIZE * 2,
          laneCenterOffsetMeters: this.tileSize,
          visualFamily: 'v1_industrial_cylinder_arch',
          ceilingY: Number(section.ceilingY ?? section.elevation + 8.4),
        }, section.elevation);
      });
    }

    return floorTiles;
  }

  _applyConnectorTraversalSurfaces(tiles, connectionPlans = [], floorTiles = []) {
    if (connectionPlans.some((plan) => (
      Number.isFinite(plan.sourceElevation)
      && Number.isFinite(plan.destinationElevation)
    ))) {
      return this._applySignedConnectorTraversalSurfaces(tiles, connectionPlans, floorTiles);
    }
    const findPathIndex = (path, point) => path.findIndex((candidate) => (
      candidate.x === point?.x && candidate.z === point?.z
    ));
    const floorKeyForTile = (tile) => absoluteFloorTileKey(
      tile.x,
      tile.z,
      tile.elevation ?? 0,
    );
    const reservedGalleryTravelKeys = new Set(connectionPlans.flatMap((plan) => [
      ...(plan.bridgePath ?? []).map((point) => tileKey(point.x, point.z)),
      ...(plan.galleryCrossSections ?? []).flatMap((crossSection) => (
        (crossSection.sections ?? []).flatMap((section) => (
          [section.center, ...(section.lateralPoints ?? [])]
            .map((point) => tileKey(point.x, point.z))
        ))
      )),
    ]));
    const prepareTile = (point, plan, options = {}) => {
      const tile = tiles.get(tileKey(point.x, point.z));
      if (!tile) return null;
      for (const key of [
        'rampStartElevation',
        'rampEndElevation',
        'rampDirectionX',
        'rampDirectionZ',
        'rampRunId',
        'rampRouteId',
        'supportStyle',
        'massGroupId',
      ]) {
        delete tile[key];
      }
      applyTileOptions(tile, {
        connectorId: plan.id,
        connectionId: plan.id,
        noEnemySpawn: true,
        ...options,
      });
      return tile;
    };
    const addTraversalLink = (fromTile, toTile, action, id) => {
      if (!fromTile || !toTile) return;
      fromTile.traversalLinks = [
        ...(fromTile.traversalLinks ?? []).filter((link) => link.id !== id),
        { id, action, toFloorKey: floorKeyForTile(toTile) },
      ];
    };
    const addBidirectionalTraversalLink = (a, b, action, id) => {
      addTraversalLink(a, b, action, `${id}:forward`);
      addTraversalLink(b, a, action, `${id}:reverse`);
    };
    const markRamp = (plan, points, fromElevation, toElevation, runId) => {
      const marked = [];
      const count = Math.max(1, points.length);
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        const nextPoint = points[index + 1] ?? point;
        const previousPoint = points[index - 1] ?? point;
        const directionX = Math.sign((nextPoint.x - point.x) || (point.x - previousPoint.x));
        const directionZ = Math.sign((nextPoint.z - point.z) || (point.z - previousPoint.z));
        const startElevation = THREE.MathUtils.lerp(fromElevation, toElevation, index / count);
        const endElevation = THREE.MathUtils.lerp(fromElevation, toElevation, (index + 1) / count);
        const elevation = (startElevation + endElevation) * 0.5;
        const level = Math.round((elevation / Math.max(0.001, RUIN_SECOND_FLOOR_ELEVATION)) * 100) / 100;
        if (tiles.get(tileKey(point.x, point.z))?.roomId) continue;
        const tile = prepareTile(point, plan, {
          elevation,
          level,
          surface: 'industrialRamp',
          connectorZone: 'sloped_transfer',
          rampStartElevation: startElevation,
          rampEndElevation: endElevation,
          rampDirectionX: directionX,
          rampDirectionZ: directionZ,
          rampRouteId: `${plan.id}:connector-ramp`,
          rampRunId: runId,
          rampPointIndex: index,
          rampPointCount: points.length,
        });
        if (tile) marked.push(tile);
      }
      return marked;
    };
    const lateralDirectionForRun = (run) => (
      run.axis === 'x' ? { x: 0, z: 1 } : { x: 1, z: 0 }
    );
    const offsetPoint = (point, lateral, offset) => ({
      x: point.x + lateral.x * offset,
      z: point.z + lateral.z * offset,
    });
    const laneOffsetsForPlan = (plan) => (
      Array.isArray(plan.connectorRunLaneOffsets) && plan.connectorRunLaneOffsets.length >= 3
        ? plan.connectorRunLaneOffsets
        : [-CONNECTOR_GALLERY_SIDE_TILES, 0, CONNECTOR_GALLERY_SIDE_TILES]
    );
    const prepareWideCrossSection = (point, plan, run, options) => {
      const lateral = lateralDirectionForRun(run);
      const prepared = [];
      for (const offset of laneOffsetsForPlan(plan)) {
        const lanePoint = offsetPoint(point, lateral, offset);
        const existing = tiles.get(tileKey(lanePoint.x, lanePoint.z));
        if (existing?.roomId) continue;
        const tile = prepareTile(lanePoint, plan, options);
        if (tile) prepared.push(tile);
      }
      return prepared;
    };
    const markWideRamp = (plan, points, fromElevation, toElevation, runId, run) => {
      const lateral = lateralDirectionForRun(run);
      const marked = [];
      for (const offset of laneOffsetsForPlan(plan)) {
        const lane = points.map((point) => offsetPoint(point, lateral, offset));
        marked.push(...markRamp(
          plan,
          lane,
          fromElevation,
          toElevation,
          `${runId}:lane:${offset}`,
        ));
      }
      return marked;
    };
    const findFloorTileAt = (point, elevation) => floorTiles.find((candidate) => (
      candidate.x === point.x
      && candidate.z === point.z
      && Math.abs((candidate.elevation ?? 0) - elevation) <= 0.05
    )) ?? null;
    const prepareConnectorLandingTile = (point, plan, {
      elevation,
      level,
      surface,
      connectorZone,
      supportStyle = null,
      massGroupId = null,
      preserveProgressionOverpass = false,
    }) => {
      const baseColumn = tiles.get(tileKey(point.x, point.z));
      // Connector widening is allowed only in exterior corridor space. Never
      // mutate an authored room floor just to satisfy a ladder footprint.
      if (baseColumn?.roomId) return null;

      let tile = findFloorTileAt(point, elevation);
      if (!tile && Math.abs(elevation) <= 0.05) {
        tile = baseColumn ?? setTile(tiles, point.x, point.z, 'hallway');
        if (!floorTiles.includes(tile)) floorTiles.push(tile);
      } else if (!tile) {
        // Boundary and ceiling assembly read the horizontal structural-cell
        // map, while walkability reads floorTiles. Add an envelope-only cell
        // for an elevated landing without inventing a walkable lower floor.
        // This prevents a corridor wall from bisecting the upper landing and
        // keeps the new footprint fully enclosed.
        if (!baseColumn) {
          setTile(tiles, point.x, point.z, 'connectorEnvelope', {
            connectorId: plan.id,
            connectionId: plan.id,
            connectorZone: `${connectorZone}_structural_envelope`,
            noEnemySpawn: true,
          });
        }
        tile = createFloorTile(point.x, point.z, {
          type: 'hallway',
          elevation,
          level,
          surface,
        });
        floorTiles.push(tile);
      }
      applyTileOptions(tile, {
        elevation,
        level,
        surface,
        connectorId: plan.id,
        connectionId: plan.id,
        connectorZone,
        supportStyle,
        massGroupId,
        preserveProgressionOverpass,
        noEnemySpawn: true,
      });
      return tile;
    };

    for (const plan of connectionPlans.filter((candidate) => candidate.level === 0)) {
      const contract = plan.connectorVariant;
      const path = plan.bridgePath ?? [];
      if (!contract || !path.length) {
        plan.traversalFloorKeys = path
          .map((point) => tiles.get(tileKey(point.x, point.z)))
          .filter(Boolean)
          .map(floorKeyForTile);
        continue;
      }

      const run = contract.pathContract.selectedStraightRun;
      const baseElevation = plan.elevation ?? 0;
      plan.ladderContracts = [];
      plan.liftContracts = [];

      if (contract.variantId === DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE) {
        const start = run.startIndex;
        const end = run.endIndex;
        const midpoint = Math.floor((start + end) * 0.5);
        const crestElevation = contract.landings.find((landing) => landing.role === 'slope_crest')?.elevation
          ?? baseElevation;
        markWideRamp(
          plan,
          path.slice(start, midpoint),
          baseElevation,
          crestElevation,
          `${plan.id}:ascent`,
          run,
        );
        const crestTiles = prepareWideCrossSection(path[midpoint], plan, run, {
          elevation: crestElevation,
          level: 1,
          surface: 'upperConnectionBridge',
          connectorZone: 'slope_crest',
          supportStyle: 'solid_mass',
          massGroupId: `${plan.id}:slope-crest-support`,
          preserveProgressionOverpass: true,
        });
        for (const crestTile of crestTiles) {
          // The three-lane crest remains open only toward its ascent and
          // descent. The outer gallery edges retain V1 safety rails.
          crestTile.openRetainingWallEdges = run.axis === 'x'
            ? ['-1,0', '1,0']
            : ['0,-1', '0,1'];
        }
        markWideRamp(
          plan,
          path.slice(midpoint + 1, end + 1),
          crestElevation,
          baseElevation,
          `${plan.id}:descent`,
          run,
        );
      } else if (contract.variantId === DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY) {
        const mechanisms = contract.mechanisms
          .map((mechanism) => ({ mechanism, index: Number.isFinite(mechanism.pathIndex)
            ? mechanism.pathIndex
            : findPathIndex(path, mechanism.gridPoint) }))
          .filter((entry) => entry.index >= 0)
          .sort((a, b) => a.index - b.index);
        if (mechanisms.length >= 2) {
          const first = mechanisms[0];
          const second = mechanisms.at(-1);
          const upperElevation = first.mechanism.topElevation;
          const deckTiles = [];
          for (let index = first.index + 1; index < second.index; index += 1) {
            const prepared = prepareWideCrossSection(path[index], plan, run, {
              elevation: upperElevation,
              level: 1,
              surface: 'upperConnectionBridge',
              connectorZone: 'ladder_gantry',
              supportStyle: 'solid_mass',
              massGroupId: `${plan.id}:ladder-gantry-support`,
              preserveProgressionOverpass: true,
            });
            deckTiles.push(...prepared);
          }
          const apertureKeys = new Set(mechanisms.map(({ index }) => (
            tileKey(path[index].x, path[index].z)
          )));
          const createLandingFootprint = ({
            origin,
            depthDirection,
            facing,
            elevation,
            level,
            connectorZone,
            prohibitApertureCover = false,
          }) => {
            const tangent = { x: -facing.z, z: facing.x };
            for (const sideSign of [1, -1]) {
              const points = [];
              for (let depthIndex = 0; depthIndex < 2; depthIndex += 1) {
                for (let widthIndex = 0; widthIndex < 2; widthIndex += 1) {
                  points.push({
                    x: origin.x + depthDirection.x * depthIndex
                      + tangent.x * widthIndex * sideSign,
                    z: origin.z + depthDirection.z * depthIndex
                      + tangent.z * widthIndex * sideSign,
                  });
                }
              }
              const footprintIsClear = points.every((point) => {
                if (tiles.get(tileKey(point.x, point.z))?.roomId) return false;
                return !prohibitApertureCover || !apertureKeys.has(tileKey(point.x, point.z));
              });
              if (!footprintIsClear) continue;

              const prepared = points.map((point) => prepareConnectorLandingTile(point, plan, {
                elevation,
                level,
                surface: elevation > baseElevation + 0.05
                  ? 'upperConnectionBridge'
                  : 'connectorGalleryFloor',
                connectorZone,
                supportStyle: elevation > baseElevation + 0.05 ? 'solid_mass' : null,
                massGroupId: elevation > baseElevation + 0.05
                  ? `${plan.id}:ladder-gantry-support`
                  : null,
                preserveProgressionOverpass: elevation > baseElevation + 0.05,
              }));
              if (prepared.every(Boolean)) {
                return prepared;
              }
            }
            return [];
          };
          const serializeLandingTiles = (landingTiles) => landingTiles.map((tile) => ({
            x: tile.x,
            z: tile.z,
            level: tile.level ?? 0,
            elevation: tile.elevation ?? 0,
            floorKey: floorKeyForTile(tile),
          }));
          const createLadder = (entry, facing) => {
            const aperturePoint = path[entry.index];
            const bottomLandingTiles = createLandingFootprint({
              origin: aperturePoint,
              depthDirection: { x: -facing.x, z: -facing.z },
              facing,
              elevation: baseElevation,
              level: 0,
              connectorZone: 'ladder_bottom_landing',
            });
            const topLandingOrigin = {
              x: aperturePoint.x + facing.x,
              z: aperturePoint.z + facing.z,
            };
            const topLandingTiles = createLandingFootprint({
              origin: topLandingOrigin,
              depthDirection: facing,
              facing,
              elevation: upperElevation,
              level: 1,
              connectorZone: 'ladder_top_landing',
              prohibitApertureCover: true,
            });
            if (bottomLandingTiles.length !== 4 || topLandingTiles.length !== 4) return null;
            const bottomTile = bottomLandingTiles[0];
            const topTile = topLandingTiles[0];
            const planeCenter = new THREE.Vector3(
              (bottomTile.x + facing.x * 0.5) * this.tileSize,
              0,
              (bottomTile.z + facing.z * 0.5) * this.tileSize,
            );
            const planeNormal = new THREE.Vector3(-facing.x, 0, -facing.z);
            const bodyClearance = 0.4;
            const center = planeCenter.clone().addScaledVector(planeNormal, bodyClearance);
            const bottomExit = new THREE.Vector3(
              bottomTile.x * this.tileSize,
              baseElevation,
              bottomTile.z * this.tileSize,
            );
            const topExit = new THREE.Vector3(
              topTile.x * this.tileSize,
              upperElevation,
              topTile.z * this.tileSize,
            );
            const ladder = {
              id: entry.mechanism.id,
              label: 'Maintenance Ladder',
              connectionId: plan.id,
              center,
              planeCenter,
              planeNormal,
              facing: new THREE.Vector3(facing.x, 0, facing.z),
              bottomY: baseElevation,
              topY: upperElevation,
              // Interaction anchors live on the safe landing centers. Mounting
              // still snaps to the exact ladder plane inside Player.mountLadder.
              bottomMountPosition: bottomExit.clone(),
              topMountPosition: topExit.clone(),
              bottomExit,
              topExit,
              bottomExitFacing: planeNormal.clone(),
              topExitFacing: new THREE.Vector3(facing.x, 0, facing.z),
              mountRadius: 1.65,
              bodyClearance,
              width: 1.7,
              caged: true,
              bottomLandingId: entry.mechanism.bottomLandingId,
              topLandingId: entry.mechanism.topLandingId,
              apertureGridPoint: { ...aperturePoint },
              landingWidthTiles: 2,
              landingDepthTiles: 2,
              landingWidthMeters: this.tileSize * 2,
              landingDepthMeters: this.tileSize * 2,
              bottomLandingTiles: serializeLandingTiles(bottomLandingTiles),
              topLandingTiles: serializeLandingTiles(topLandingTiles),
            };
            addBidirectionalTraversalLink(bottomTile, topTile, 'ladder', ladder.id);
            const openingDirection = `${-facing.x},${-facing.z}`;
            topTile.openRetainingWallEdges = [
              ...new Set([...(topTile.openRetainingWallEdges ?? []), openingDirection]),
            ];
            return ladder;
          };
          const forward = contract.mechanisms[0].facing;
          const firstLadder = createLadder(first, forward);
          const secondFacing = second.mechanism.facing;
          const secondLadder = createLadder(second, secondFacing);
          plan.ladderContracts = [firstLadder, secondLadder].filter(Boolean);
        }
      } else if (contract.variantId === DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT) {
        const liftSpec = contract.mechanisms.find((mechanism) => mechanism.type === 'automatic_cargo_lift');
        const liftIndex = Number.isFinite(liftSpec?.pathIndex)
          ? liftSpec.pathIndex
          : findPathIndex(path, liftSpec?.gridPoint);
        const returnSpec = contract.construction.slopedReturn;
        if (liftSpec && liftIndex >= 0 && returnSpec) {
          const liftFacing = liftSpec.facing ?? (run.axis === 'x'
            ? { x: run.direction, z: 0 }
            : { x: 0, z: run.direction });
          const side = { x: -liftFacing.z, z: liftFacing.x };
          const galleryLateral = lateralDirectionForRun(run);
          const pointAtIndex = (index) => path[Math.max(0, Math.min(path.length - 1, index))];
          const pointOffset = (point, direction, amount = 1) => ({
            x: point.x + direction.x * amount,
            z: point.z + direction.z * amount,
          });
          const footprintSideIsClear = (indexes, sideSign) => indexes.every((index) => {
            const point = pointAtIndex(index);
            const sidePoint = pointOffset(point, side, sideSign);
            return !tiles.get(tileKey(sidePoint.x, sidePoint.z))?.roomId;
          });
          const topIndexes = [
            contract.construction.topLandingStartPathIndex,
            contract.construction.topLandingEndPathIndex,
          ];
          const bottomIndexes = [liftIndex - 1, liftIndex];
          const topSideSign = [1, -1].find((sign) => footprintSideIsClear(topIndexes, sign));
          const bottomSideSign = [-1, 1].find((sign) => footprintSideIsClear(bottomIndexes, sign));
          if (!topSideSign || !bottomSideSign) {
            plan.connectorAssemblyErrors = [
              `${plan.id} has no exterior side for its 2x2 lift landings.`,
            ];
            plan.traversalFloorKeys = path
              .map((point) => tiles.get(tileKey(point.x, point.z)))
              .filter(Boolean)
              .map(floorKeyForTile);
            continue;
          }

          const bottomTile = prepareTile(path[liftIndex], plan, {
            elevation: liftSpec.bottomElevation,
            level: 0,
            surface: 'connectorGalleryFloor',
            connectorZone: 'lift_bottom_landing',
          });
          const bottomLandingTiles = [];
          for (const index of bottomIndexes) {
            const centerPoint = pointAtIndex(index);
            const centerTile = prepareTile(centerPoint, plan, {
              elevation: liftSpec.bottomElevation,
              level: 0,
              surface: 'connectorGalleryFloor',
              connectorZone: 'lift_bottom_landing',
            });
            const sidePoint = pointOffset(centerPoint, side, bottomSideSign);
            const sideTile = prepareConnectorLandingTile(sidePoint, plan, {
              elevation: liftSpec.bottomElevation,
              level: 0,
              surface: 'connectorGalleryFloor',
              connectorZone: 'lift_bottom_landing',
            });
            if (centerTile) bottomLandingTiles.push(centerTile);
            if (sideTile) bottomLandingTiles.push(sideTile);
          }
          for (const index of bottomIndexes) {
            const centerPoint = pointAtIndex(index);
            for (const laneOffset of laneOffsetsForPlan(plan).filter((offset) => offset !== 0)) {
              prepareConnectorLandingTile(pointOffset(centerPoint, galleryLateral, laneOffset), plan, {
                elevation: liftSpec.bottomElevation,
                level: 0,
                surface: 'connectorGalleryFloor',
                connectorZone: 'lift_bottom_gallery',
              });
            }
          }

          const topLandingTiles = [];
          for (const index of topIndexes) {
            const centerPoint = pointAtIndex(index);
            const common = {
              elevation: liftSpec.topElevation,
              level: 1,
              surface: 'upperConnectionBridge',
              connectorZone: 'lift_top_landing',
              supportStyle: 'solid_mass',
              massGroupId: `${plan.id}:lift-top-landing-support`,
              preserveProgressionOverpass: true,
            };
            const centerTile = prepareTile(centerPoint, plan, common);
            const sidePoint = pointOffset(centerPoint, side, topSideSign);
            const sideTile = prepareConnectorLandingTile(sidePoint, plan, common);
            if (centerTile) topLandingTiles.push(centerTile);
            if (sideTile) topLandingTiles.push(sideTile);
          }
          for (const index of topIndexes) {
            const centerPoint = pointAtIndex(index);
            for (const laneOffset of laneOffsetsForPlan(plan).filter((offset) => offset !== 0)) {
              prepareConnectorLandingTile(pointOffset(centerPoint, galleryLateral, laneOffset), plan, {
                elevation: liftSpec.topElevation,
                level: 1,
                surface: 'upperConnectionBridge',
                connectorZone: 'lift_top_gallery',
                supportStyle: 'solid_mass',
                massGroupId: `${plan.id}:lift-top-landing-support`,
                preserveProgressionOverpass: true,
              });
            }
          }

          const rampTiles = markWideRamp(
            plan,
            path.slice(returnSpec.startPathIndex, returnSpec.endPathIndex + 1),
            liftSpec.topElevation,
            liftSpec.bottomElevation,
            `${plan.id}:lift-return-slope`,
            run,
          );
          const topTile = topLandingTiles[0] ?? null;
          if (bottomTile
            && topTile
            && bottomLandingTiles.length === 4
            && topLandingTiles.length === 4
            && rampTiles.length > 0) {
            const topLandingEndTile = topLandingTiles.find((tile) => (
              tile.x === pointAtIndex(topIndexes[1]).x
              && tile.z === pointAtIndex(topIndexes[1]).z
            ));
            const shaftOpeningDirection = `${-liftFacing.x},${-liftFacing.z}`;
            topTile.openRetainingWallEdges = [
              ...new Set([...(topTile.openRetainingWallEdges ?? []), shaftOpeningDirection]),
            ];
            if (topLandingEndTile) {
              const rampOpeningDirection = `${liftFacing.x},${liftFacing.z}`;
              topLandingEndTile.openRetainingWallEdges = [
                ...new Set([
                  ...(topLandingEndTile.openRetainingWallEdges ?? []),
                  rampOpeningDirection,
                ]),
              ];
            }
            addBidirectionalTraversalLink(bottomTile, topTile, 'automatic_lift', liftSpec.id);
            const sideDotGalleryLateral = side.x * galleryLateral.x + side.z * galleryLateral.z;
            const laneOffsetsInSideCoordinates = laneOffsetsForPlan(plan)
              .map((offset) => offset * sideDotGalleryLateral);
            const controlOffsetBeyondGallery = (preferredSign) => (
              preferredSign > 0
                ? Math.max(...laneOffsetsInSideCoordinates) + 1
                : Math.min(...laneOffsetsInSideCoordinates) - 1
            );
            const createControlAlcove = (
              referenceIndex,
              preferredSign,
              elevation,
              level,
              connectorZone,
              supportStyle = null,
              massGroupId = null,
            ) => {
              const referencePoint = pointAtIndex(referenceIndex);
              for (const sign of [preferredSign, -preferredSign]) {
                const sideOffset = controlOffsetBeyondGallery(sign);
                for (const longitudinalOffset of [0, -1, 1]) {
                  const controlPoint = pointOffset(
                    pointOffset(referencePoint, side, sideOffset),
                    liftFacing,
                    longitudinalOffset,
                  );
                  if (reservedGalleryTravelKeys.has(tileKey(controlPoint.x, controlPoint.z))) {
                    continue;
                  }
                  const controlTile = prepareConnectorLandingTile(controlPoint, plan, {
                    elevation,
                    level,
                    surface: level > 0 ? 'upperConnectionBridge' : 'connectorGalleryFloor',
                    connectorZone,
                    supportStyle,
                    massGroupId,
                    preserveProgressionOverpass: level > 0,
                  });
                  if (controlTile) return controlTile;
                }
              }
              return null;
            };
            const bottomControlTile = createControlAlcove(
              bottomIndexes[0],
              bottomSideSign,
              liftSpec.bottomElevation,
              0,
              'lift_bottom_control_alcove',
            );
            const topControlTile = createControlAlcove(
              topIndexes[0],
              topSideSign,
              liftSpec.topElevation,
              1,
              'lift_top_control_alcove',
              'solid_mass',
              `${plan.id}:lift-top-control-support`,
            );
            const serializeLandingTiles = (landingTiles) => landingTiles.map((tile) => ({
              x: tile.x,
              z: tile.z,
              level: tile.level ?? 0,
              elevation: tile.elevation ?? 0,
              floorKey: floorKeyForTile(tile),
            }));
            plan.liftContracts = [{
              ...liftSpec,
              connectionId: plan.id,
              center: new THREE.Vector3(
                bottomTile.x * this.tileSize,
                liftSpec.bottomElevation,
                bottomTile.z * this.tileSize,
              ),
              facing: new THREE.Vector3(liftFacing.x, 0, liftFacing.z),
              bottomFloorKey: floorKeyForTile(bottomTile),
              topFloorKey: floorKeyForTile(topTile),
              shaftWidthMeters: this.tileSize,
              shaftDepthMeters: this.tileSize,
              shaftCeilingY: 8.4,
              shaftHeadroomMeters: 8.4 - liftSpec.topElevation,
              landingWidthTiles: 2,
              landingDepthTiles: 2,
              bottomLandingTiles: serializeLandingTiles(bottomLandingTiles),
              topLandingTiles: serializeLandingTiles(topLandingTiles),
              controlAnchors: {
                bottom: bottomControlTile ? {
                  floorKey: floorKeyForTile(bottomControlTile),
                  position: new THREE.Vector3(
                    bottomControlTile.x * this.tileSize,
                    liftSpec.bottomElevation,
                    bottomControlTile.z * this.tileSize,
                  ),
                } : null,
                top: topControlTile ? {
                  floorKey: floorKeyForTile(topControlTile),
                  position: new THREE.Vector3(
                    topControlTile.x * this.tileSize,
                    liftSpec.topElevation,
                    topControlTile.z * this.tileSize,
                  ),
                } : null,
              },
            }];
          } else {
            plan.connectorAssemblyErrors = [
              `${plan.id} could not realize both 2x2 lift landings and its continuous return slope.`,
            ];
          }
        }
      }

      for (const beat of plan.decorativeArchBeats ?? []) {
        const candidates = floorTiles
          .filter((tile) => tile.x === beat.gridPoint.x && tile.z === beat.gridPoint.z)
          .sort((a, b) => (b.elevation ?? 0) - (a.elevation ?? 0));
        const floor = candidates[0] ?? null;
        finalizeConnectorDecorativeArchBeat(beat, floor?.elevation ?? baseElevation);
      }

      plan.traversalFloorKeys = path
        .map((point) => tiles.get(tileKey(point.x, point.z)))
        .filter(Boolean)
        .map(floorKeyForTile);
    }

    // Room kits and crossing elevation features are stamped before connector
    // assembly. Mirror each centerline surface across its accepted gallery
    // lanes as a final parity pass so a three-wide corridor never collapses to
    // one walkable strip when the center crosses a ramp or raised transfer.
    const connectorCenterlineKeys = new Set(connectionPlans
      .filter((candidate) => candidate.level === 0)
      .flatMap((candidate) => (candidate.bridgePath ?? []).map((point) => tileKey(point.x, point.z))));
    for (const plan of connectionPlans.filter((candidate) => candidate.level === 0)) {
      for (const crossSection of plan.galleryCrossSections ?? []) {
        for (const section of crossSection.sections ?? []) {
          const centerFloors = floorTiles
            .filter((tile) => tile.x === section.center.x && tile.z === section.center.z)
            .sort((a, b) => (b.elevation ?? 0) - (a.elevation ?? 0));
          const centerFloor = centerFloors[0];
          if (!centerFloor) continue;
          for (const lanePoint of section.lateralPoints ?? []) {
            if (connectorCenterlineKeys.has(tileKey(lanePoint.x, lanePoint.z))) continue;
            const alreadyMatched = floorTiles.some((tile) => (
              tile.x === lanePoint.x
              && tile.z === lanePoint.z
              && Math.abs((tile.elevation ?? 0) - (centerFloor.elevation ?? 0)) <= 0.05
            ));
            if (alreadyMatched || tiles.get(tileKey(lanePoint.x, lanePoint.z))?.roomId) continue;
            prepareTile(lanePoint, plan, {
              elevation: centerFloor.elevation ?? 0,
              level: centerFloor.level ?? 0,
              surface: centerFloor.surface ?? 'connectorGalleryFloor',
              connectorZone: `${centerFloor.connectorZone ?? 'main_gallery'}_wide_lane`,
              rampStartElevation: centerFloor.rampStartElevation,
              rampEndElevation: centerFloor.rampEndElevation,
              rampDirectionX: centerFloor.rampDirectionX,
              rampDirectionZ: centerFloor.rampDirectionZ,
              rampRouteId: centerFloor.rampRouteId,
              rampRunId: centerFloor.rampRunId
                ? `${centerFloor.rampRunId}:wide-parity`
                : undefined,
              rampPointIndex: centerFloor.rampPointIndex,
              rampPointCount: centerFloor.rampPointCount,
              supportStyle: centerFloor.supportStyle,
              massGroupId: centerFloor.massGroupId,
              preserveProgressionOverpass: centerFloor.preserveProgressionOverpass,
              noEnemySpawn: true,
            });
          }
        }
      }
      for (const beat of plan.decorativeArchBeats ?? []) {
        const candidates = floorTiles
          .filter((tile) => tile.x === beat.gridPoint.x && tile.z === beat.gridPoint.z)
          .sort((a, b) => (b.elevation ?? 0) - (a.elevation ?? 0));
        const floor = candidates[0] ?? null;
        finalizeConnectorDecorativeArchBeat(beat, floor?.elevation ?? plan.elevation ?? 0);
      }
      plan.traversalFloorKeys = (plan.bridgePath ?? [])
        .map((point) => tiles.get(tileKey(point.x, point.z)))
        .filter(Boolean)
        .map(floorKeyForTile);
    }

    return floorTiles;
  }

  _validateConnectorTraversalAssembly({
    floorTiles = [],
    tiles = new Map(),
    rooms = [],
    connectionPlans = [],
  } = {}) {
    if (connectionPlans.some((plan) => (
      Number.isFinite(plan.sourceElevation)
      && Number.isFinite(plan.destinationElevation)
    ))) {
      const errors = [];
      const checks = [];
      const roomById = new Map(rooms.map((room) => [room.id, room]));
      const floorsAt = (point, elevation) => floorTiles.filter((floor) => (
        floor.x === point?.x
        && floor.z === point?.z
        && Math.abs(Number(floor.elevation ?? 0) - Number(elevation)) <= 0.05
      ));
      for (const plan of connectionPlans) {
        const sourceElevation = Number(plan.sourceElevation ?? plan.elevation ?? 0);
        const destinationElevation = Number(plan.destinationElevation ?? sourceElevation);
        const elevationDelta = destinationElevation - sourceElevation;
        const contract = plan.connectorVariant;
        const sourceFloorCount = floorsAt(plan.fromSocket, sourceElevation).length;
        const destinationFloorCount = floorsAt(plan.toSocket, destinationElevation).length;
        for (const assemblyError of plan.connectorAssemblyErrors ?? []) {
          errors.push(assemblyError);
        }
        if (!sourceFloorCount) errors.push(`${plan.id} has no floor aligned to its source socket.`);
        if (!destinationFloorCount) errors.push(`${plan.id} has no floor aligned to its destination socket.`);
        if ((!contract || contract.traversalKind === 'walk') && Math.abs(elevationDelta) > 0.001) {
          errors.push(`${plan.id} changes elevation without a slope, ladder, or lift contract.`);
        }

        let minimumWidthTiles = Infinity;
        let galleryCrossSectionCount = 0;
        const measurableGallerySections = [];
        for (const crossSection of plan.galleryCrossSections ?? []) {
          for (const section of crossSection.sections ?? []) {
            galleryCrossSectionCount += 1;
            measurableGallerySections.push(section);
            const points = [section.center, ...(section.lateralPoints ?? [])];
            const sectionElevation = Number(
              section.elevation
              ?? plan.sourceElevation
              ?? plan.elevation
              ?? 0,
            );
            const width = points.filter((point) => floorsAt(point, sectionElevation).length > 0).length;
            minimumWidthTiles = Math.min(minimumWidthTiles, width);
            if (width < CONNECTOR_GALLERY_MIN_WIDTH_TILES) {
              errors.push(`${plan.id} narrows below three walkable tiles at ${section.center.x},${section.center.z}.`);
            }
          }
        }
        if (!Number.isFinite(minimumWidthTiles)) minimumWidthTiles = 0;
        if (galleryCrossSectionCount === 0) {
          errors.push(`${plan.id} has no measurable exterior gallery cross-sections.`);
        }

        const fromRoom = roomById.get(plan.fromRoomId);
        const toRoom = roomById.get(plan.toRoomId);
        const requiresArches = fromRoom
          && toRoom
          && !RUIN_OPEN_AIR_ROOM_TYPES.has(fromRoom.type)
          && !RUIN_OPEN_AIR_ROOM_TYPES.has(toRoom.type);
        const decorativeArchBeats = [...(plan.decorativeArchBeats ?? [])]
          .sort((left, right) => left.pathIndex - right.pathIndex);
        const archEligibleSections = measurableGallerySections.filter((section) => (
          !/(?:control|shaft|aperture)/i.test(section.connectorZone ?? '')
        ));
        const requiredArchCount = requiresArches
          ? Math.max(1, Math.ceil(archEligibleSections.length / 3))
          : 0;
        if (decorativeArchBeats.length < requiredArchCount) {
          errors.push(`${plan.id} does not provide decorative V1 arches across its complete gallery.`);
        }
        for (let index = 0; index < decorativeArchBeats.length; index += 1) {
          const beat = decorativeArchBeats[index];
          const minimumClearWidth = this._connectorMinimumClearWidthMeters();
          if (beat.internalClearWidthMeters + 1e-6 < minimumClearWidth) {
            errors.push(`${beat.id} narrows the gallery below ${minimumClearWidth}m.`);
          }
          if (beat.clearHeightMeters + 1e-6 < PLAYER_TRAVERSAL_ENVELOPE.headClearance
            || beat.minimumLaneHeadroomMeters + 1e-6
              < PLAYER_TRAVERSAL_ENVELOPE.headClearance) {
            errors.push(`${beat.id} lacks player headroom across its three travel lanes.`);
          }
          if (!floorsAt(beat.gridPoint, beat.floorElevation).length) {
            errors.push(`${beat.id} is not anchored to a physical connector floor.`);
          }
        }

        if (contract?.traversalKind === 'slope') {
          const rampFloors = floorTiles.filter((floor) => (
            floor.connectionId === plan.id && floor.surface === 'industrialRamp'
          ));
          const runIds = new Set(rampFloors.map((floor) => (
            String(floor.rampRunId ?? '').split(':lane:')[0]
          )));
          const contractFlights = contract.construction?.flights ?? [];
          const maximumStep = Math.max(0, ...rampFloors.map((floor) => (
            Math.abs(Number(floor.rampEndElevation) - Number(floor.rampStartElevation))
          )));
          if (rampFloors.length !== 2 * 13 * 3
            || runIds.size !== 2
            || contractFlights.some((flight) => !runIds.has(flight.id))) {
            errors.push(`${plan.id} must realize two separate three-wide 13-segment slope flights.`);
          }
          if (maximumStep > (7 / 13) + 0.001) {
            errors.push(`${plan.id} exceeds the signed 7/13 metre slope grade.`);
          }
          if ((plan.slopeTraversalContract?.switchbackLandingTiles?.length ?? 0) < 9
            || (plan.slopeTraversalContract?.destinationLandingTiles?.length ?? 0) < 9) {
            errors.push(`${plan.id} does not provide full 3x3 slope landings.`);
          }
          for (const flight of contractFlights) {
            const centerLane = rampFloors
              .filter((floor) => floor.rampRunId === `${flight.id}:lane:0`)
              .sort((first, second) => first.rampPointIndex - second.rampPointIndex);
            const realizedStart = centerLane[0];
            const realizedEnd = centerLane.at(-1);
            if (centerLane.length !== flight.segmentCount
              || realizedStart?.x !== flight.startGridPoint.x
              || realizedStart?.z !== flight.startGridPoint.z
              || realizedEnd?.x !== flight.endGridPoint.x
              || realizedEnd?.z !== flight.endGridPoint.z
              || Math.abs(Number(realizedStart?.rampStartElevation) - flight.startElevation) > 0.001
              || Math.abs(Number(realizedEnd?.rampEndElevation) - flight.endElevation) > 0.001) {
              errors.push(`${plan.id} realized slope flight ${flight.id} diverges from its immutable footprint.`);
            }
          }
        } else if (contract?.traversalKind === 'ladder') {
          const ladders = plan.ladderContracts ?? [];
          if (ladders.length !== 1) errors.push(`${plan.id} must realize exactly one ladder shaft.`);
          for (const ladder of ladders) {
            if (Math.abs((ladder.topY - ladder.bottomY) - 14) > 0.001) {
              errors.push(`${ladder.id} does not span exactly 14 metres.`);
            }
            if ((ladder.bottomLandingTiles?.length ?? 0) < 9
              || (ladder.topLandingTiles?.length ?? 0) < 9) {
              errors.push(`${ladder.id} lacks clear 3x3 top and bottom landings.`);
            }
            const covered = floorTiles.some((floor) => (
              floor.x === ladder.apertureGridPoint?.x
              && floor.z === ladder.apertureGridPoint?.z
              && floor.connectionId === plan.id
            ));
            if (covered) errors.push(`${ladder.id} has a tile covering its visible descent aperture.`);
          }
        } else if (contract?.traversalKind === 'automatic_lift') {
          const lifts = plan.liftContracts ?? [];
          if (lifts.length !== 1) errors.push(`${plan.id} must realize exactly one automatic lift.`);
          for (const lift of lifts) {
            if (Math.abs((lift.topElevation - lift.bottomElevation) - 14) > 0.001
              || Math.abs(lift.platformWidthMeters - 8.4) > 0.001
              || Math.abs(lift.platformDepthMeters - 8.4) > 0.001
              || Math.abs(lift.shaftWidthMeters - 11.2) > 0.001
              || Math.abs(lift.shaftDepthMeters - 11.2) > 0.001) {
              errors.push(`${lift.id} violates the 14m / 8.4m platform / 11.2m shaft contract.`);
            }
            if (Math.abs(lift.initialElevation - sourceElevation) > 0.001) {
              errors.push(`${lift.id} does not initialize at its progression-source landing.`);
            }
            if ((lift.bottomLandingTiles?.length ?? 0) < 9
              || (lift.topLandingTiles?.length ?? 0) < 9) {
              errors.push(`${lift.id} lacks clear 3x3 arrival landings.`);
            }
            if (lift.shaftHeadroomMeters < 3.6) errors.push(`${lift.id} lacks rider clearance.`);
            const facingLength = Math.hypot(lift.facing?.x ?? 0, lift.facing?.z ?? 0);
            if (facingLength < 0.999) {
              errors.push(`${lift.id} has no usable longitudinal facing for its landing sills.`);
              continue;
            }
            const facingX = lift.facing.x / facingLength;
            const facingZ = lift.facing.z / facingLength;
            const projectAlong = (position) => position.x * facingX + position.z * facingZ;
            const carProjection = projectAlong(lift.center);
            const carHalfAlong = Math.abs(facingX) * lift.platformWidthMeters * 0.5
              + Math.abs(facingZ) * lift.platformDepthMeters * 0.5;
            const expectedBridgeDepth = (
              (Math.abs(facingX) * lift.shaftWidthMeters
                + Math.abs(facingZ) * lift.shaftDepthMeters)
              - (Math.abs(facingX) * lift.platformWidthMeters
                + Math.abs(facingZ) * lift.platformDepthMeters)
            ) * 0.5;
            for (const endpoint of ['bottom', 'top']) {
              const expectedY = endpoint === 'bottom' ? lift.bottomElevation : lift.topElevation;
              const landingTiles = endpoint === 'bottom'
                ? lift.bottomLandingTiles
                : lift.topLandingTiles;
              const sill = (lift.landingSills ?? []).find((candidate) => candidate.endpoint === endpoint);
              if (!sill) {
                errors.push(`${lift.id} has no supported flush sill at its ${endpoint} landing.`);
                continue;
              }
              const sillProjection = projectAlong(sill.center);
              const sillHalfAlong = Math.abs(facingX) * sill.halfWidth
                + Math.abs(facingZ) * sill.halfDepth;
              const landingProjections = landingTiles.map((tile) => (
                (tile.x * this.tileSize) * facingX + (tile.z * this.tileSize) * facingZ
              ));
              const sillIsBeforeCar = sillProjection < carProjection;
              const landingEdge = sillIsBeforeCar
                ? Math.max(...landingProjections) + this.tileSize * 0.5
                : Math.min(...landingProjections) - this.tileSize * 0.5;
              const carEdge = carProjection + (sillIsBeforeCar ? -carHalfAlong : carHalfAlong);
              const sillLandingEdge = sillProjection
                + (sillIsBeforeCar ? -sillHalfAlong : sillHalfAlong);
              const sillCarEdge = sillProjection
                + (sillIsBeforeCar ? sillHalfAlong : -sillHalfAlong);
              if (Math.abs(sill.topY - expectedY) > 0.05
                || Math.abs(sillLandingEdge - landingEdge) > 0.05
                || Math.abs(sillCarEdge - carEdge) > 0.05
                || Math.abs(sill.bridgeDepthMeters - expectedBridgeDepth) > 0.05
                || Math.abs(sill.spanMeters - lift.platformWidthMeters) > 0.05) {
                errors.push(
                  `${lift.id} ${endpoint} landing does not meet the lift car with a supported, flush 8.4m sill.`,
                );
              }
            }
            const shaftColumnKeys = new Set((lift.liftShaft?.gridColumns ?? []).map((point) => (
              `${point.x},${point.z}`
            )));
            if (shaftColumnKeys.size !== 16) {
              errors.push(`${lift.id} does not expose its complete 4x4 shaft aperture.`);
            } else if (floorTiles.some((tile) => (
              shaftColumnKeys.has(`${tile.x},${tile.z}`)
              && (tile.elevation ?? 0) > lift.bottomElevation + 0.05
            ))) {
              errors.push(`${lift.id} has a floor tile across its swept shaft aperture.`);
            }
          }
        }

        checks.push({
          connectionId: plan.id,
          level: plan.level ?? 0,
          variantId: plan.connectorVariantId ?? null,
          direction: plan.direction ?? 'level',
          sourceElevation,
          destinationElevation,
          elevationDelta,
          galleryCrossSectionCount,
          minimumGalleryWidthTiles: minimumWidthTiles,
          decorativeArchCount: decorativeArchBeats.length,
          ladderCount: plan.ladderContracts?.length ?? 0,
          liftCount: plan.liftContracts?.length ?? 0,
          occupiedStructuralVolumeCount: plan.occupiedStructuralVolumes?.length ?? 0,
          clearanceVolumeCount: plan.clearanceVolumes?.length ?? 0,
        });
      }

      const findFirstOverlap = (firstVolumes, secondVolumes) => {
        for (const first of firstVolumes ?? []) {
          for (const second of secondVolumes ?? []) {
            if (serializableVolumesOverlap(first, second)) return { first, second };
          }
        }
        return null;
      };
      const isExactGrantedParentAttachmentPair = (firstPlan, secondPlan) => (
        [firstPlan?.fromSocket, firstPlan?.toSocket].some((socket) => (
          socket?.exactSocketBinding === true
            && String(socket.parentRouteId ?? '') === String(secondPlan?.id ?? '')
        ))
          || [secondPlan?.fromSocket, secondPlan?.toSocket].some((socket) => (
            socket?.exactSocketBinding === true
              && String(socket.parentRouteId ?? '') === String(firstPlan?.id ?? '')
          ))
      );
      for (let firstIndex = 0; firstIndex < connectionPlans.length; firstIndex += 1) {
        const firstPlan = connectionPlans[firstIndex];
        for (let secondIndex = firstIndex + 1; secondIndex < connectionPlans.length; secondIndex += 1) {
          const secondPlan = connectionPlans[secondIndex];
          if (isExactGrantedParentAttachmentPair(firstPlan, secondPlan)) {
            // An authored-corridor station deliberately shares its three-wide
            // threshold shell with the exact supplemental attachment it
            // granted. Global reservation has already rejected every other
            // parent/overlay overlap, so this typed pair is not a collision.
            continue;
          }
          const conflict = findFirstOverlap(
            firstPlan.occupiedStructuralVolumes,
            secondPlan.occupiedStructuralVolumes,
          ) ?? findFirstOverlap(
            firstPlan.occupiedStructuralVolumes,
            secondPlan.clearanceVolumes,
          ) ?? findFirstOverlap(
            firstPlan.clearanceVolumes,
            secondPlan.occupiedStructuralVolumes,
          ) ?? findFirstOverlap(
            firstPlan.clearanceVolumes,
            secondPlan.clearanceVolumes,
          );
          if (conflict) {
            errors.push(
              `${firstPlan.id} and ${secondPlan.id} have overlapping connector volumes (${conflict.first.id} / ${conflict.second.id}).`,
            );
          }
        }
      }
      return {
        accepted: errors.length === 0,
        errors,
        warnings: errors.length ? [] : [
          `Validated ${checks.length} signed V1 connector assemblies.`,
        ],
        details: {
          signedElevationContracts: true,
          checkedConnectorCount: checks.filter((check) => check.variantId).length,
          checkedGalleryCount: checks.length,
          checks,
          minimumGalleryWidthTiles: Math.min(...checks.map((check) => check.minimumGalleryWidthTiles)),
        },
      };
    }
    const errors = [];
    const checks = [];
    const floorByKey = new Map(floorTiles.map((tile) => [
      this._getFloorTileGraphKey(tile),
      tile,
    ]));
    const floorsByColumn = new Map();
    for (const floor of floorTiles) {
      const key = tileKey(floor.x, floor.z);
      const column = floorsByColumn.get(key) ?? [];
      column.push(floor);
      floorsByColumn.set(key, column);
    }
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const isRoomPoint = (point) => rooms.some((room) => this._isTileInsideRoom(point, room));
    const validateLanding = (plan, label, landingTiles, expectedElevation) => {
      if ((landingTiles?.length ?? 0) !== 4) {
        errors.push(`${plan.id} ${label} is not a physical 2x2 landing.`);
        return false;
      }
      const uniqueColumns = new Set();
      let accepted = true;
      for (const descriptor of landingTiles) {
        const floor = floorByKey.get(descriptor.floorKey);
        const columnKey = tileKey(descriptor.x, descriptor.z);
        uniqueColumns.add(columnKey);
        if (!floor
          || Math.abs((floor.elevation ?? 0) - expectedElevation) > 0.05
          || !tiles.has(columnKey)
          || isRoomPoint(descriptor)) {
          accepted = false;
        }
      }
      if (uniqueColumns.size !== 4 || !accepted) {
        errors.push(`${plan.id} ${label} lacks floor/collider/envelope parity outside V1 rooms.`);
        return false;
      }
      return true;
    };
    const validateGalleryWidth = (plan) => {
      let checkedSectionCount = 0;
      let minimumWidthTiles = Infinity;
      for (const crossSection of plan.galleryCrossSections ?? []) {
        for (const section of crossSection.sections ?? []) {
          checkedSectionCount += 1;
          const points = [section.center, ...(section.lateralPoints ?? [])];
          const centerFloors = floorsByColumn.get(tileKey(section.center.x, section.center.z)) ?? [];
          const sharedFloor = centerFloors
            .filter((centerFloor) => centerFloor.signedConnectorFloorOwnerId === plan.id)
            .find((centerFloor) => points.every((point) => (
            (floorsByColumn.get(tileKey(point.x, point.z)) ?? []).some((floor) => (
              Math.abs((floor.elevation ?? 0) - (centerFloor.elevation ?? 0)) <= 0.05
                && floor.signedConnectorFloorOwnerId === plan.id
            ))
            )));
          const widthTiles = sharedFloor ? points.length : 0;
          minimumWidthTiles = Math.min(minimumWidthTiles, widthTiles);
          if (!sharedFloor || widthTiles < CONNECTOR_GALLERY_MIN_WIDTH_TILES) {
            const pointDiagnostics = points.map((point) => {
              const elevations = (floorsByColumn.get(tileKey(point.x, point.z)) ?? [])
                .map((floor) => Number(floor.elevation ?? 0).toFixed(2));
              return `${point.x},${point.z}=[${elevations.join(',') || 'missing'}]`;
            }).join(';');
            errors.push(
              `${plan.id} has a one-tile connector choke at path index ${crossSection.pathIndex} (${pointDiagnostics}).`,
            );
          }
        }
      }
      if (checkedSectionCount === 0) {
        errors.push(`${plan.id} has no measurable exterior gallery cross-sections.`);
        minimumWidthTiles = 0;
      }
      return { checkedSectionCount, minimumWidthTiles };
    };
    const validateDecorativeArches = (plan) => {
      const fromRoom = roomById.get(plan.fromRoomId);
      const toRoom = roomById.get(plan.toRoomId);
      const requiresArches = fromRoom
        && toRoom
        && !RUIN_OPEN_AIR_ROOM_TYPES.has(fromRoom.type)
        && !RUIN_OPEN_AIR_ROOM_TYPES.has(toRoom.type);
      if (!requiresArches) return 0;
      const beats = [...(plan.decorativeArchBeats ?? [])]
        .sort((a, b) => a.pathIndex - b.pathIndex);
      const requiredArchCount = Math.min(2, plan.galleryCrossSections?.length ?? 0);
      if (beats.length < requiredArchCount) {
        errors.push(`${plan.id} does not provide decorative V1 arches across its complete gallery.`);
      }
      const maximumSpacing = plan.connectorVariant?.decoration?.archSpacingTiles
        ?? CONNECTOR_DECORATIVE_ARCH_INTERVAL_TILES;
      for (let index = 0; index < beats.length; index += 1) {
        const beat = beats[index];
        const previous = beats[index - 1];
        if (previous && beat.pathIndex - previous.pathIndex > maximumSpacing) {
          errors.push(`${plan.id} leaves more than ${maximumSpacing} tiles between decorative arches.`);
        }
        const minimumClearWidth = this._connectorMinimumClearWidthMeters();
        if (beat.internalClearWidthMeters + 1e-6 < minimumClearWidth) {
          errors.push(`${beat.id} narrows the gallery below ${minimumClearWidth}m.`);
        }
        if (beat.clearHeightMeters + 1e-6 < PLAYER_TRAVERSAL_ENVELOPE.headClearance) {
          errors.push(`${beat.id} lacks player headroom at elevation ${beat.floorElevation}.`);
        }
        if (beat.minimumLaneHeadroomMeters + 1e-6
          < PLAYER_TRAVERSAL_ENVELOPE.headClearance) {
          errors.push(
            `${beat.id} decorative arc intrudes into an outer travel lane (${beat.minimumLaneHeadroomMeters.toFixed(2)}m).`,
          );
        }
        const matchingFloor = (floorsByColumn.get(tileKey(beat.gridPoint.x, beat.gridPoint.z)) ?? [])
          .some((floor) => Math.abs((floor.elevation ?? 0) - beat.floorElevation) <= 0.05);
        if (!matchingFloor) errors.push(`${beat.id} is not anchored to a physical connector floor.`);
      }
      return beats.length;
    };

    for (const plan of connectionPlans) {
      const galleryCheck = validateGalleryWidth(plan);
      const decorativeArchCount = validateDecorativeArches(plan);
      const contract = plan.connectorVariant;
      if (!contract) {
        checks.push({
          connectionId: plan.id,
          level: plan.level ?? 0,
          variantId: null,
          galleryCrossSectionCount: galleryCheck.checkedSectionCount,
          minimumGalleryWidthTiles: galleryCheck.minimumWidthTiles,
          decorativeArchCount,
          ladderCount: 0,
          liftCount: 0,
        });
        continue;
      }
      errors.push(...(plan.connectorAssemblyErrors ?? []));

      for (const point of [
        ...(contract.pathContract.sourceFlatBufferPath ?? []),
        ...(contract.pathContract.destinationFlatBufferPath ?? []),
      ]) {
        const tile = tiles.get(tileKey(point.x, point.z));
        if (!tile
          || Math.abs(tile.elevation ?? 0) > 0.05
          || tile.surface === 'industrialRamp'
          || tile.surface === 'upperConnectionBridge') {
          errors.push(`${plan.id} altered a required flat room-threshold buffer.`);
          break;
        }
      }

      if (contract.traversalKind === 'slope') {
        const crest = floorTiles.find((tile) => (
          tile.connectionId === plan.id && tile.connectorZone === 'slope_crest'
        ));
        const run = contract.pathContract.selectedStraightRun;
        const expectedOpenings = new Set(run.axis === 'x'
          ? ['-1,0', '1,0']
          : ['0,-1', '0,1']);
        const actualOpenings = new Set(crest?.openRetainingWallEdges ?? []);
        if (!crest
          || actualOpenings.size !== 2
          || [...expectedOpenings].some((edge) => !actualOpenings.has(edge))) {
          errors.push(`${plan.id} slope crest does not retain both lateral safety rails.`);
        }
      }

      if (contract.traversalKind === 'ladder') {
        const ladders = plan.ladderContracts ?? [];
        if (ladders.length !== 2) {
          errors.push(`${plan.id} did not realize both authored ladder transfers.`);
        }
        for (const ladder of ladders) {
          validateLanding(plan, `${ladder.id} bottom landing`, ladder.bottomLandingTiles, ladder.bottomY);
          validateLanding(plan, `${ladder.id} top landing`, ladder.topLandingTiles, ladder.topY);
          const aperture = ladder.apertureGridPoint;
          const covered = floorTiles.some((tile) => (
            tile.x === aperture?.x
            && tile.z === aperture?.z
            && (tile.elevation ?? 0) > ladder.bottomY + 0.05
          ));
          if (covered) errors.push(`${ladder.id} has a floor tile covering its descent aperture.`);
          if (8.4 - ladder.topY < contract.clearance.minimumHeadroomMeters) {
            errors.push(`${ladder.id} lacks enclosed headroom above its top landing.`);
          }
        }
      }

      if (contract.traversalKind === 'automatic_lift') {
        const lifts = plan.liftContracts ?? [];
        if (lifts.length !== 1) {
          errors.push(`${plan.id} did not realize its automatic lift.`);
        }
        for (const lift of lifts) {
          validateLanding(plan, `${lift.id} bottom landing`, lift.bottomLandingTiles, lift.bottomElevation);
          validateLanding(plan, `${lift.id} top landing`, lift.topLandingTiles, lift.topElevation);
          const guideExtent = Math.max(lift.platformWidthMeters, lift.platformDepthMeters) * 0.5 + 0.13;
          if (guideExtent > Math.min(lift.shaftWidthMeters, lift.shaftDepthMeters) * 0.5 - 0.01) {
            errors.push(`${lift.id} platform guides intersect the shaft boundary.`);
          }
          if (lift.shaftHeadroomMeters < lift.riderClearanceMeters
            || lift.shaftCeilingY < lift.topElevation + lift.riderClearanceMeters) {
            errors.push(`${lift.id} lacks an enclosed ceiling above its full rider swept volume.`);
          }
          for (const endpoint of ['bottom', 'top']) {
            const anchor = lift.controlAnchors?.[endpoint];
            if (!anchor?.position || !floorByKey.has(anchor.floorKey)) {
              errors.push(`${lift.id} ${endpoint} recall control is not anchored to a physical side landing.`);
            }
          }
          const opening = lift.gridPoint;
          const covered = floorTiles.some((tile) => (
            tile.x === opening?.x
            && tile.z === opening?.z
            && (tile.elevation ?? 0) > lift.bottomElevation + 0.05
          ));
          if (covered) errors.push(`${lift.id} has a floor tile across its swept shaft aperture.`);
        }
      }

      checks.push({
        connectionId: plan.id,
        level: plan.level ?? 0,
        variantId: contract.variantId,
        galleryCrossSectionCount: galleryCheck.checkedSectionCount,
        minimumGalleryWidthTiles: galleryCheck.minimumWidthTiles,
        decorativeArchCount,
        ladderCount: plan.ladderContracts?.length ?? 0,
        liftCount: plan.liftContracts?.length ?? 0,
      });
    }

    return {
      accepted: errors.length === 0,
      errors,
      warnings: errors.length ? [] : [
        `Validated ${checks.length} assembled connector galleries against physical floors, envelopes, and clearances.`,
      ],
      details: {
        checkedConnectorCount: checks.filter((check) => check.variantId).length,
        checkedGalleryCount: checks.length,
        checks,
      },
    };
  }

  _addConnectorExplorationSpaces(tiles, rooms, connectionPlans = []) {
    const authoritativeConnectorBlueprintCells = new Set(rooms
      .filter((room) => room?.isConnectorJunctionProxy)
      .flatMap((room) => (room.augmentationFloorTiers ?? [])
        .filter((tier) => tier?.authoritative === true && Array.isArray(tier.worldCells))
        .flatMap((tier) => tier.worldCells
          .filter((cell) => Number.isInteger(cell?.grid?.x) && Number.isInteger(cell?.grid?.z))
          .map((cell) => tileKey(cell.grid.x, cell.grid.z)))));
    const isInsideAnyRoom = (point) => rooms.some((room) => (
      !room.suppressRoomGeometry
        && !room.isConnectorJunctionProxy
        && this._isTileInsideRoom(point, room)
    )) || authoritativeConnectorBlueprintCells.has(tileKey(point.x, point.z));
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const requiresSignedSurfaces = (plan) => (
      Math.abs(Number(plan.elevationDelta ?? 0)) > 0.001
      || Math.abs(Number(plan.sourceElevation ?? plan.elevation ?? 0)) > 0.001
      || Math.abs(Number(plan.destinationElevation ?? plan.elevation ?? 0)) > 0.001
    );
    const usesVirtualSignedFootprint = (plan) => (
      requiresSignedSurfaces(plan)
      && (plan.isDungeonSupplement || plan.isPaddedByDungeonSupplement)
    );
    const createVirtualFootprintTile = (x, z, plan, zone) => ({
      x,
      z,
      type: 'hallway',
      surface: 'connectorGalleryFloor',
      connectorId: plan.id,
      connectorZone: zone,
      noEnemySpawn: true,
      virtualSignedConnectorFootprint: true,
    });
    const centerlineOwners = new Map();
    for (const plan of connectionPlans.filter((candidate) => (
      candidate.level === 0 && candidate.isSharedThresholdConnection !== true
    ))) {
      for (const point of plan.bridgePath ?? []) {
        const key = tileKey(point.x, point.z);
        const owners = centerlineOwners.get(key) ?? new Set();
        owners.add(plan.id);
        centerlineOwners.set(key, owners);
      }
    }
    const isAvailableLanePoint = (plan, point, offset) => {
      if (isInsideAnyRoom(point)) return false;
      // Broad connector intersections are valid V1 junctions. Treat another
      // connector's centerline as shared gallery floor instead of forcing this
      // route back to a one-tile strip beside a room footprint.
      return true;
    };
    const addConnectorTile = (x, z, plan, zone) => {
      const point = { x, z };
      if (isInsideAnyRoom(point)) {
        return null;
      }
      if (usesVirtualSignedFootprint(plan)) {
        return createVirtualFootprintTile(x, z, plan, zone);
      }
      const owners = centerlineOwners.get(tileKey(x, z));
      const existing = tiles.get(tileKey(x, z));
      if (existing && owners && [...owners].some((owner) => owner !== plan.id)) {
        return existing;
      }
      const tile = setTile(tiles, x, z, 'hallway', {
        surface: 'connectorGalleryFloor',
        connectorId: plan.id,
        connectorZone: zone,
        noEnemySpawn: true,
      });
      tile.connectorId = plan.id;
      tile.connectorZone = zone;
      return tile;
    };
    const getCardinalDirections = (path, index) => {
      const point = path[index];
      const directions = [];
      for (const neighbor of [path[index - 1], path[index + 1]]) {
        if (!neighbor) continue;
        const direction = {
          x: Math.sign(neighbor.x - point.x),
          z: Math.sign(neighbor.z - point.z),
        };
        if (Math.abs(direction.x) + Math.abs(direction.z) !== 1) continue;
        if (!directions.some((candidate) => (
          (candidate.x !== 0) === (direction.x !== 0)
        ))) {
          directions.push(direction);
        }
      }
      return directions;
    };

    for (const plan of connectionPlans.filter((candidate) => candidate.level === 0)) {
      const path = plan.bridgePath ?? [];
      if (plan.isSharedThresholdConnection === true) {
        plan.connectorRunLaneOffsets = [];
        plan.galleryFootprintTiles = [];
        plan.galleryCrossSections = [];
        plan.minimumGalleryWidthTiles = CONNECTOR_GALLERY_MIN_WIDTH_TILES;
        plan.preferredGalleryWidthTiles = CONNECTOR_GALLERY_MIN_WIDTH_TILES;
        plan.connectorPresentation = {
          baseFamily: 'junction_core_threshold',
          overlayFamily: 'shared_junction_threshold',
          preservesV1Corridor: true,
        };
        plan.classicV1ServiceBeats = [];
        plan.decorativeArchBeats = [];
        continue;
      }
      if (path.length < 2) {
        continue;
      }
      const exteriorIndexes = path
        .map((point, index) => ({ point, index }))
        .filter(({ point }) => !isInsideAnyRoom(point))
        .map(({ index }) => index);
      const galleryCenterTargets = [
        Math.floor((path.length - 1) * 0.28),
        Math.ceil((path.length - 1) * 0.72),
      ];
      const usesSupplementExteriorCenters = Boolean(
        plan.isDungeonSupplement || plan.isPaddedByDungeonSupplement
      );
      const galleryCenters = usesSupplementExteriorCenters
        ? new Set(galleryCenterTargets
            .map((target) => exteriorIndexes.reduce((closest, index) => (
              closest == null || Math.abs(index - target) < Math.abs(closest - target)
                ? index
                : closest
            ), null))
            .filter(Number.isFinite))
        : new Set([
            Math.max(2, Math.floor(path.length * 0.28)),
            Math.min(path.length - 3, Math.floor(path.length * 0.72)),
          ]);
      const specialRun = plan.connectorVariant?.traversalKind !== 'walk'
        ? plan.connectorVariant?.pathContract?.selectedStraightRun
        : null;
      const laneOffsetOptions = [
        [-1, 0, 1],
        [0, 1, 2],
        [-2, -1, 0],
      ];
      const runLateral = specialRun
        ? (specialRun.axis === 'x' ? { x: 0, z: 1 } : { x: 1, z: 0 })
        : null;
      const contractedLaneOffsets = plan.connectorVariant?.pathContract?.selectedLaneOffsets;
      const specialRunLaneOffsets = specialRun
        ? ([contractedLaneOffsets, ...laneOffsetOptions]
          .filter((offsets, index, candidates) => (
            Array.isArray(offsets)
            && candidates.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(offsets)) === index
          ))
          .find((offsets) => (
            path.slice(specialRun.startIndex, specialRun.endIndex + 1).every((point) => (
              offsets.every((offset) => isAvailableLanePoint(plan, {
                x: point.x + runLateral.x * offset,
                z: point.z + runLateral.z * offset,
              }, offset))
            ))
          )) ?? [-1, 0, 1])
        : [-1, 0, 1];
      plan.connectorRunLaneOffsets = [...specialRunLaneOffsets];
      const footprintByKey = new Map();
      const crossSections = [];

      const recordFootprintTile = (tile, index, role) => {
        if (!tile) return;
        const key = tileKey(tile.x, tile.z);
        const existing = footprintByKey.get(key);
        footprintByKey.set(key, {
          x: tile.x,
          z: tile.z,
          pathIndexes: [...new Set([...(existing?.pathIndexes ?? []), index])].sort((a, b) => a - b),
          roles: [...new Set([...(existing?.roles ?? []), role])].sort(),
        });
      };

      for (let index = 0; index < path.length; index += 1) {
        const point = path[index];
        if (isInsideAnyRoom(point)) continue;
        const directions = getCardinalDirections(path, index);
        if (!directions.length) continue;
        const insideSpecialTransfer = specialRun
          && index >= specialRun.startIndex
          && index <= specialRun.endIndex;
        const sideWidth = !insideSpecialTransfer && galleryCenters.has(index)
          ? CONNECTOR_GALLERY_ALCOVE_SIDE_TILES
          : CONNECTOR_GALLERY_SIDE_TILES;

        const centerTile = usesVirtualSignedFootprint(plan)
          ? createVirtualFootprintTile(
              point.x,
              point.z,
              plan,
              insideSpecialTransfer
                ? `${plan.connectorVariant.traversalKind}_gallery`
                : 'main_gallery',
            )
          : tiles.get(tileKey(point.x, point.z));
        if (centerTile) {
          centerTile.connectorId = plan.id;
          centerTile.connectorZone = insideSpecialTransfer
            ? `${plan.connectorVariant.traversalKind}_gallery`
            : 'main_gallery';
          centerTile.noEnemySpawn = true;
          if (centerTile.type === 'hallway') {
            centerTile.surface = 'connectorGalleryFloor';
          }
          recordFootprintTile(centerTile, index, 'centerline');
        }

        const sectionDirections = [];
        for (const direction of directions) {
          const directionMatchesSpecialRun = insideSpecialTransfer && (
            (runLateral.x !== 0) === (direction.z !== 0)
          );
          const perpendicular = directionMatchesSpecialRun
            ? runLateral
            : { x: -direction.z, z: direction.x };
          const laneOffsets = directionMatchesSpecialRun
            ? specialRunLaneOffsets
            : laneOffsetOptions.find((offsets) => offsets.every((offset) => isAvailableLanePoint(plan, {
                x: point.x + perpendicular.x * offset,
                z: point.z + perpendicular.z * offset,
              }, offset))) ?? [-1, 0, 1];
          const galleryCenterOffset = laneOffsets.reduce((sum, offset) => sum + offset, 0)
            / laneOffsets.length;
          const section = {
            direction: { ...direction },
            center: { ...point },
            galleryCenter: {
              x: point.x + perpendicular.x * galleryCenterOffset,
              z: point.z + perpendicular.z * galleryCenterOffset,
            },
            laneOffsets: [...laneOffsets],
            lateralPoints: [],
          };
          for (const offset of laneOffsets) {
            const lanePoint = {
              x: point.x + perpendicular.x * offset,
              z: point.z + perpendicular.z * offset,
            };
            const tile = offset === 0
              ? centerTile
              : addConnectorTile(lanePoint.x, lanePoint.z, plan, 'service_lane');
            recordFootprintTile(tile, index, offset === 0 ? 'centerline' : 'minimum_width_lane');
            if (offset !== 0) section.lateralPoints.push(lanePoint);
          }
          if (sideWidth > CONNECTOR_GALLERY_SIDE_TILES) {
            for (const offset of [-2, 2]) {
              if (laneOffsets.includes(offset)) continue;
              const alcovePoint = {
                x: point.x + perpendicular.x * offset,
                z: point.z + perpendicular.z * offset,
              };
              const tile = addConnectorTile(alcovePoint.x, alcovePoint.z, plan, 'exploration_alcove');
              recordFootprintTile(tile, index, 'alcove_lane');
            }
          }
          sectionDirections.push(section);
        }

        // An orthogonal corner needs cardinal shoulder cells, not the diagonal
        // pseudo-perpendicular produced by subtracting previous from next. Fill
        // the complete 3x3 elbow so neither inner nor outer turn becomes a
        // one-tile choke point.
        if (directions.length > 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            for (let dz = -1; dz <= 1; dz += 1) {
              if (dx === 0 && dz === 0) continue;
              const tile = addConnectorTile(point.x + dx, point.z + dz, plan, 'wide_gallery_turn');
              recordFootprintTile(tile, index, 'turn_clearance');
            }
          }
        }
        crossSections.push({ pathIndex: index, sections: sectionDirections });
      }

      plan.galleryFootprintTiles = [...footprintByKey.values()]
        .sort((a, b) => a.x - b.x || a.z - b.z);
      plan.galleryCrossSections = crossSections;
      plan.minimumGalleryWidthTiles = CONNECTOR_GALLERY_MIN_WIDTH_TILES;
      plan.preferredGalleryWidthTiles = CONNECTOR_GALLERY_ALCOVE_SIDE_TILES * 2 + 1;

      const fromRoom = roomById.get(plan.fromRoomId);
      const toRoom = roomById.get(plan.toRoomId);
      const isInteriorConnector = fromRoom
        && toRoom
        && !RUIN_OPEN_AIR_ROOM_TYPES.has(fromRoom.type)
        && !RUIN_OPEN_AIR_ROOM_TYPES.has(toRoom.type);
      const hasNewTraversal = Boolean(
        plan.connectorVariant
        && plan.connectorVariant.traversalKind !== 'walk'
      );
      plan.connectorPresentation = {
        baseFamily: 'v1_arch_corridor',
        overlayFamily: hasNewTraversal
          ? plan.connectorVariant.visualFamily
          : 'v1_service_bay',
        preservesV1Corridor: true,
      };
      plan.classicV1ServiceBeats = [];
      const unsafeArchIndexes = new Set(
        (plan.connectorVariant?.mechanisms ?? [])
          .map((mechanism) => mechanism.pathIndex)
          .filter(Number.isFinite),
      );
      const archCandidates = isInteriorConnector
        ? exteriorIndexes.filter((index) => !unsafeArchIndexes.has(index))
        : [];
      const selectedArchIndexes = [];
      if (archCandidates.length) {
        selectedArchIndexes.push(archCandidates[0]);
        const finalCandidate = archCandidates.at(-1);
        while (selectedArchIndexes.at(-1) < finalCandidate) {
          const previous = selectedArchIndexes.at(-1);
          const withinInterval = archCandidates.filter((index) => (
            index > previous
            && index <= previous + CONNECTOR_DECORATIVE_ARCH_INTERVAL_TILES
          ));
          const nextIndex = withinInterval.at(-1)
            ?? archCandidates.find((index) => index > previous);
          if (!Number.isFinite(nextIndex)) break;
          selectedArchIndexes.push(nextIndex);
        }
      }
      plan.decorativeArchBeats = [...new Set(selectedArchIndexes)].map((pathIndex, beatIndex) => {
        const section = crossSections.find((crossSection) => crossSection.pathIndex === pathIndex)
          ?.sections?.[0];
        const direction = section?.direction ?? getCardinalDirections(path, pathIndex)[0] ?? { x: 0, z: 1 };
        const widthMeters = this.tileSize * this._connectorDecorativeArchWidthTiles(plan);
        return {
          id: `${plan.id}:decorative-arch:${beatIndex}`,
          pathIndex,
          gridPoint: { ...(section?.galleryCenter ?? path[pathIndex]) },
          direction,
          widthMeters,
          internalClearWidthMeters: widthMeters - CONNECTOR_DECORATIVE_ARCH_COLUMN_HALF_SIZE * 2,
          laneCenterOffsetMeters: this.tileSize,
          floorElevation: plan.elevation ?? 0,
          visualFamily: 'v1_industrial_cylinder_arch',
        };
      });

      if (isInteriorConnector && !hasNewTraversal) {
        const classicSection = crossSections
          .filter((crossSection) => galleryCenters.has(crossSection.pathIndex))
          .flatMap((crossSection) => (
            (crossSection.sections ?? []).map((section) => ({ crossSection, section }))
          ))
          .map(({ crossSection, section }) => {
            if (JSON.stringify(section.laneOffsets) !== JSON.stringify([-1, 0, 1])) {
              return { crossSection, section, safeSides: [] };
            }
            const perpendicular = { x: -section.direction.z, z: section.direction.x };
            const safeSides = [-1, 1].filter((side) => {
              const point = {
                x: section.galleryCenter.x
                  + perpendicular.x * side * CONNECTOR_CLASSIC_SERVICE_OFFSET_TILES,
                z: section.galleryCenter.z
                  + perpendicular.z * side * CONNECTOR_CLASSIC_SERVICE_OFFSET_TILES,
              };
              const owners = centerlineOwners.get(tileKey(point.x, point.z));
              return tiles.has(tileKey(point.x, point.z))
                && !isInsideAnyRoom(point)
                && (!owners || [...owners].every((owner) => owner === plan.id));
            });
            return { crossSection, section, safeSides };
          })
          .find(({ safeSides }) => safeSides.length > 0);
        if (classicSection) {
          const { crossSection, section, safeSides } = classicSection;
          const perpendicular = { x: -section.direction.z, z: section.direction.x };
          const preferredSide = [...plan.id]
            .reduce((sum, character) => sum + character.charCodeAt(0), 0) % 2
            ? 1
            : -1;
          const side = safeSides.includes(preferredSide) ? preferredSide : safeSides[0];
          const servicePoint = {
            x: section.galleryCenter.x
              + perpendicular.x * side * CONNECTOR_CLASSIC_SERVICE_OFFSET_TILES,
            z: section.galleryCenter.z
              + perpendicular.z * side * CONNECTOR_CLASSIC_SERVICE_OFFSET_TILES,
          };
          const fencePoint = {
            x: section.galleryCenter.x
              + perpendicular.x * side * CONNECTOR_CLASSIC_FENCE_OFFSET_TILES,
            z: section.galleryCenter.z
              + perpendicular.z * side * CONNECTOR_CLASSIC_FENCE_OFFSET_TILES,
          };
          const girderArch = plan.decorativeArchBeats.at(-1) ?? plan.decorativeArchBeats[0];
          plan.classicV1ServiceBeats.push({
            id: `${plan.id}:classic-v1-service:0`,
            pathIndex: crossSection.pathIndex,
            direction: { ...section.direction },
            galleryCenter: { ...section.galleryCenter },
            servicePoint,
            fencePoint,
            serviceKind: plan.id.length % 3 === 0 ? 'pump' : 'water_tank',
            serviceHalfExtentMeters: 0.95,
            travelEnvelopeHalfWidthMeters: this.tileSize + PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
            minimumTravelClearanceMeters: (
              CONNECTOR_CLASSIC_SERVICE_OFFSET_TILES * this.tileSize
              - 0.95
              - this.tileSize
              - PLAYER_TRAVERSAL_ENVELOPE.collisionRadius
            ),
            fenceOffsetMeters: CONNECTOR_CLASSIC_FENCE_OFFSET_TILES * this.tileSize,
            girderPoint: girderArch ? {
              x: girderArch.gridPoint.x + section.direction.x * 0.72,
              z: girderArch.gridPoint.z + section.direction.z * 0.72,
            } : { ...section.galleryCenter },
            girderPathIndex: girderArch?.pathIndex ?? crossSection.pathIndex,
            girderWidthMeters: this.tileSize * this._connectorDecorativeArchWidthTiles(),
            keepsTravelEnvelopeClear: true,
          });
        }
      }
      if (!hasNewTraversal && plan.classicV1ServiceBeats.length === 0) {
        plan.connectorPresentation.overlayFamily = 'v1_arch_only_corridor';
      }
    }
  }

  _applyConveyorPuzzleTemplates(tiles, rooms) {
    const errors = [];
    const warnings = [];
    const conveyorRoom = rooms.find((room) => room.id === 'conveyorRoom');

    if (!conveyorRoom) {
      return {
        accepted: true,
        errors,
        warnings: ['No conveyor puzzle room was generated.'],
      };
    }

    const templateFactories = this.difficulty <= 1
      ? [
        this._createSimpleRedirectConveyorPuzzleDefinition,
        this._createTwoRouteConveyorPuzzleDefinition,
      ]
      : this.difficulty === 2
        ? [
          this._createTwoRouteConveyorPuzzleDefinition,
          this._createReturnLoopConveyorPuzzleDefinition,
          this._createSimpleRedirectConveyorPuzzleDefinition,
        ]
        : [
          this._createMultiStageConveyorPuzzleDefinition,
          this._createReturnLoopConveyorPuzzleDefinition,
          this._createTwoRouteConveyorPuzzleDefinition,
          this._createSimpleRedirectConveyorPuzzleDefinition,
        ];
    const startIndex = Math.floor((this.random?.() ?? 0.35) * templateFactories.length) % templateFactories.length;
    const orderedFactories = [
      ...templateFactories.slice(startIndex),
      ...templateFactories.slice(0, startIndex),
    ];
    const rejectedTemplates = [];

    for (const factory of orderedFactories) {
      const puzzle = factory.call(this, conveyorRoom);
      const stagedTiles = new Map([...tiles.entries()].map(([key, tile]) => [key, { ...tile }]));
      this._stampConveyorPuzzleDefinition(stagedTiles, puzzle);
      const validation = this._validateConveyorPuzzleDefinition(puzzle, stagedTiles, rooms);
      if (!validation.accepted) {
        rejectedTemplates.push(...validation.errors);
        continue;
      }

      this._stampConveyorPuzzleDefinition(tiles, puzzle);
      conveyorRoom.conveyorPuzzleDefinition = puzzle;
      return {
        ...validation,
        warnings: [
          ...validation.warnings,
          `${puzzle.archetype} conveyor puzzle template selected.`,
        ],
      };
    }

    return {
      accepted: false,
      errors: rejectedTemplates.length
        ? rejectedTemplates
        : ['No conveyor puzzle template could be placed.'],
      warnings,
    };
  }

  _stampConveyorPuzzleDefinition(tiles, puzzle) {
    for (const belt of puzzle.belts) {
      const tile = setConveyorTile(tiles, belt.x, belt.z, {
        directionX: belt.defaultDirection.x,
        directionZ: belt.defaultDirection.z,
        speed: puzzle.objectSpeed,
        elevation: 0,
        surface: 'conveyorPuzzleBelt',
      });
      if (tile) {
        tile.conveyorPuzzleId = puzzle.id;
        tile.conveyorGroupId = belt.groupId;
        tile.conveyorNodeId = belt.id;
        tile.conveyorTileType = belt.tileType;
      }
    }
  }

  _createSimpleRedirectConveyorPuzzleDefinition(room) {
    const at = (dx, dz) => ({
      x: room.x + dx,
      z: room.z + dz,
      key: tileKey(room.x + dx, room.z + dz),
    });
    const direction = (x, z) => ({ x, z });
    const belts = [
      { id: 'feedA', ...at(-5, 2), defaultDirection: direction(1, 0), groupId: 'feed', tileType: 'straight' },
      {
        id: 'redirectA',
        ...at(-4, 2),
        defaultDirection: direction(0, 1),
        groupId: 'redirectA',
        tileType: 'rotator',
        switchable: true,
        stateIndex: 0,
        states: [
          { label: 'Stopper', direction: direction(0, 1) },
          { label: 'Receiver', direction: direction(1, 0) },
        ],
      },
      { id: 'stopperA', ...at(-4, 3), defaultDirection: direction(0, 0), groupId: 'stopper', tileType: 'stopper' },
      { id: 'targetRunA', ...at(-3, 2), defaultDirection: direction(1, 0), groupId: 'targetRun', tileType: 'straight' },
      { id: 'targetRunB', ...at(-2, 2), defaultDirection: direction(1, 0), groupId: 'targetRun', tileType: 'straight' },
    ];
    const spawner = {
      id: 'conveyorCargoSpawner',
      ...at(-6, 2),
      launchDirection: direction(1, 0),
    };
    const target = {
      id: 'conveyorVaultPlate',
      ...at(-1, 2),
    };

    return {
      id: 'conveyorVaultRoutingPuzzle',
      archetype: 'SimpleRedirect',
      difficulty: 1,
      roomId: room.id,
      targetDoorId: 'bonusVaultDoor',
      targetPressurePlateId: target.id,
      objectId: 'conveyorCargoObject',
      objectType: 'Refractor Battery',
      objectSpeed: 2.35,
      state: 'ObjectReady',
      spawner,
      target,
      belts,
      consoles: [
        {
          id: 'conveyorRouteConsole',
          label: 'Redirect Console',
          action: 'cycleJunction',
          controls: ['redirectA'],
          ...at(-5, 6),
        },
        {
          id: 'conveyorLaunchConsole',
          label: 'Cargo Launcher',
          action: 'launchOrReset',
          ...at(1, 6),
        },
      ],
      junctions: [{
        id: 'redirectA',
        beltId: 'redirectA',
        tileKey: at(-4, 2).key,
        stateIndex: 0,
        states: belts.find((belt) => belt.id === 'redirectA').states,
        solutionStateIndex: 1,
      }],
      solutionState: {
        redirectA: 1,
      },
      maxSimulationSteps: 48,
      canReset: true,
      optional: true,
      rewardTier: 'Basic',
    };
  }

  _createTwoRouteConveyorPuzzleDefinition(room) {
    const at = (dx, dz) => ({
      x: room.x + dx,
      z: room.z + dz,
      key: tileKey(room.x + dx, room.z + dz),
    });
    const direction = (x, z) => ({ x, z });
    const belts = [
      { id: 'feedA', ...at(-6, -2), defaultDirection: direction(1, 0), groupId: 'feed', tileType: 'straight' },
      { id: 'feedB', ...at(-5, -2), defaultDirection: direction(1, 0), groupId: 'feed', tileType: 'straight' },
      { id: 'feedC', ...at(-4, -2), defaultDirection: direction(1, 0), groupId: 'feed', tileType: 'straight' },
      { id: 'feedD', ...at(-3, -2), defaultDirection: direction(1, 0), groupId: 'feed', tileType: 'straight' },
      {
        id: 'junctionA',
        ...at(-2, -2),
        defaultDirection: direction(0, 1),
        groupId: 'junctionA',
        tileType: 'junction',
        switchable: true,
        stateIndex: 0,
        states: [
          { label: 'Return Loop', direction: direction(0, 1) },
          { label: 'Receiver', direction: direction(1, 0) },
        ],
      },
      { id: 'targetRunA', ...at(-1, -2), defaultDirection: direction(1, 0), groupId: 'targetRun', tileType: 'straight' },
      { id: 'targetRunB', ...at(0, -2), defaultDirection: direction(1, 0), groupId: 'targetRun', tileType: 'straight' },
      { id: 'targetRunC', ...at(1, -2), defaultDirection: direction(1, 0), groupId: 'targetRun', tileType: 'straight' },
      { id: 'targetRunD', ...at(2, -2), defaultDirection: direction(1, 0), groupId: 'targetRun', tileType: 'straight' },
      { id: 'targetRunE', ...at(3, -2), defaultDirection: direction(1, 0), groupId: 'targetRun', tileType: 'straight' },
      { id: 'returnA', ...at(-2, -1), defaultDirection: direction(0, 1), groupId: 'returnLoop', tileType: 'return' },
      { id: 'returnB', ...at(-2, 0), defaultDirection: direction(0, 1), groupId: 'returnLoop', tileType: 'return' },
      { id: 'returnC', ...at(-2, 1), defaultDirection: direction(-1, 0), groupId: 'returnLoop', tileType: 'return' },
      { id: 'returnD', ...at(-3, 1), defaultDirection: direction(-1, 0), groupId: 'returnLoop', tileType: 'return' },
      { id: 'returnE', ...at(-4, 1), defaultDirection: direction(-1, 0), groupId: 'returnLoop', tileType: 'return' },
      { id: 'returnF', ...at(-5, 1), defaultDirection: direction(-1, 0), groupId: 'returnLoop', tileType: 'return' },
      { id: 'returnG', ...at(-6, 1), defaultDirection: direction(0, -1), groupId: 'returnLoop', tileType: 'return' },
      { id: 'returnH', ...at(-6, 0), defaultDirection: direction(0, -1), groupId: 'returnLoop', tileType: 'return' },
      { id: 'returnI', ...at(-6, -1), defaultDirection: direction(0, -1), groupId: 'returnLoop', tileType: 'return' },
    ];
    const spawner = {
      id: 'conveyorCargoSpawner',
      ...at(-7, -2),
      launchDirection: direction(1, 0),
    };
    const target = {
      id: 'conveyorVaultPlate',
      ...at(4, -2),
    };
    const routeConsole = {
      id: 'conveyorRouteConsole',
      label: 'Conveyor Console',
      action: 'cycleJunction',
      controls: ['junctionA'],
      ...at(-5, -6),
    };
    const launchConsole = {
      id: 'conveyorLaunchConsole',
      label: 'Cargo Launcher',
      action: 'launchOrReset',
      ...at(3, -6),
    };

    return {
      id: 'conveyorVaultRoutingPuzzle',
      archetype: 'TwoRouteJunction',
      difficulty: 1,
      roomId: room.id,
      targetDoorId: 'bonusVaultDoor',
      targetPressurePlateId: target.id,
      objectId: 'conveyorCargoObject',
      objectType: 'Refractor Battery',
      objectSpeed: 2.4,
      state: 'ObjectReady',
      spawner,
      target,
      belts,
      consoles: [routeConsole, launchConsole],
      junctions: [{
        id: 'junctionA',
        beltId: 'junctionA',
        tileKey: at(-2, -2).key,
        stateIndex: 0,
        states: belts.find((belt) => belt.id === 'junctionA').states,
        solutionStateIndex: 1,
      }],
      solutionState: {
        junctionA: 1,
      },
      maxSimulationSteps: 96,
      canReset: true,
      optional: true,
      rewardTier: 'Basic',
    };
  }

  _createReturnLoopConveyorPuzzleDefinition(room) {
    const at = (dx, dz) => ({
      x: room.x + dx,
      z: room.z + dz,
      key: tileKey(room.x + dx, room.z + dz),
    });
    const direction = (x, z) => ({ x, z });
    const belts = [
      { id: 'loopA', ...at(-6, 0), defaultDirection: direction(1, 0), groupId: 'returnLoop', tileType: 'return' },
      { id: 'loopB', ...at(-5, 0), defaultDirection: direction(1, 0), groupId: 'returnLoop', tileType: 'return' },
      {
        id: 'loopExit',
        ...at(-4, 0),
        defaultDirection: direction(0, 1),
        groupId: 'loopExit',
        tileType: 'junction',
        switchable: true,
        stateIndex: 0,
        states: [
          { label: 'Hold Loop', direction: direction(0, 1) },
          { label: 'Receiver Exit', direction: direction(1, 0) },
        ],
      },
      { id: 'loopC', ...at(-4, 1), defaultDirection: direction(-1, 0), groupId: 'returnLoop', tileType: 'return' },
      { id: 'loopD', ...at(-5, 1), defaultDirection: direction(-1, 0), groupId: 'returnLoop', tileType: 'return' },
      { id: 'loopE', ...at(-6, 1), defaultDirection: direction(0, -1), groupId: 'returnLoop', tileType: 'return' },
      { id: 'targetRunA', ...at(-3, 0), defaultDirection: direction(1, 0), groupId: 'targetRun', tileType: 'straight' },
      { id: 'targetRunB', ...at(-2, 0), defaultDirection: direction(1, 0), groupId: 'targetRun', tileType: 'straight' },
    ];
    const spawner = {
      id: 'conveyorCargoSpawner',
      ...at(-7, 0),
      launchDirection: direction(1, 0),
    };
    const target = {
      id: 'conveyorVaultPlate',
      ...at(-1, 0),
    };

    return {
      id: 'conveyorVaultRoutingPuzzle',
      archetype: 'ReturnLoop',
      difficulty: 2,
      roomId: room.id,
      targetDoorId: 'bonusVaultDoor',
      targetPressurePlateId: target.id,
      objectId: 'conveyorCargoObject',
      objectType: 'Refractor Battery',
      objectSpeed: 2.35,
      state: 'ObjectReady',
      spawner,
      target,
      belts,
      consoles: [
        {
          id: 'conveyorRouteConsole',
          label: 'Loop Exit Console',
          action: 'cycleJunction',
          controls: ['loopExit'],
          ...at(-5, -5),
        },
        {
          id: 'conveyorLaunchConsole',
          label: 'Cargo Launcher',
          action: 'launchOrReset',
          ...at(1, -5),
        },
      ],
      junctions: [{
        id: 'loopExit',
        beltId: 'loopExit',
        tileKey: at(-4, 0).key,
        stateIndex: 0,
        states: belts.find((belt) => belt.id === 'loopExit').states,
        solutionStateIndex: 1,
      }],
      solutionState: {
        loopExit: 1,
      },
      maxSimulationSteps: 72,
      canReset: true,
      optional: true,
      rewardTier: 'Basic',
    };
  }

  _createMultiStageConveyorPuzzleDefinition(room) {
    const at = (dx, dz) => ({
      x: room.x + dx,
      z: room.z + dz,
      key: tileKey(room.x + dx, room.z + dz),
    });
    const direction = (x, z) => ({ x, z });
    const belts = [
      { id: 'feedA', ...at(-7, -3), defaultDirection: direction(1, 0), groupId: 'feed', tileType: 'straight' },
      { id: 'feedB', ...at(-6, -3), defaultDirection: direction(1, 0), groupId: 'feed', tileType: 'straight' },
      {
        id: 'junctionA',
        ...at(-5, -3),
        defaultDirection: direction(0, 1),
        groupId: 'junctionA',
        tileType: 'junction',
        switchable: true,
        stateIndex: 0,
        states: [
          { label: 'Return Loop A', direction: direction(0, 1) },
          { label: 'Junction B Feed', direction: direction(1, 0) },
        ],
      },
      { id: 'middleA', ...at(-4, -3), defaultDirection: direction(1, 0), groupId: 'middle', tileType: 'straight' },
      { id: 'middleB', ...at(-3, -3), defaultDirection: direction(1, 0), groupId: 'middle', tileType: 'straight' },
      {
        id: 'junctionB',
        ...at(-2, -3),
        defaultDirection: direction(0, -1),
        groupId: 'junctionB',
        tileType: 'junction',
        switchable: true,
        stateIndex: 0,
        states: [
          { label: 'Return Loop B', direction: direction(0, -1) },
          { label: 'Receiver Run', direction: direction(1, 0) },
        ],
      },
      { id: 'targetRunA', ...at(-1, -3), defaultDirection: direction(1, 0), groupId: 'targetRun', tileType: 'straight' },
      { id: 'targetRunB', ...at(0, -3), defaultDirection: direction(1, 0), groupId: 'targetRun', tileType: 'straight' },
      { id: 'targetRunC', ...at(1, -3), defaultDirection: direction(1, 0), groupId: 'targetRun', tileType: 'straight' },
      { id: 'targetRunD', ...at(2, -3), defaultDirection: direction(1, 0), groupId: 'targetRun', tileType: 'straight' },
      { id: 'returnA1', ...at(-5, -2), defaultDirection: direction(0, 1), groupId: 'returnLoopA', tileType: 'return' },
      { id: 'returnA2', ...at(-5, -1), defaultDirection: direction(-1, 0), groupId: 'returnLoopA', tileType: 'return' },
      { id: 'returnA3', ...at(-6, -1), defaultDirection: direction(-1, 0), groupId: 'returnLoopA', tileType: 'return' },
      { id: 'returnA4', ...at(-7, -1), defaultDirection: direction(0, -1), groupId: 'returnLoopA', tileType: 'return' },
      { id: 'returnA5', ...at(-7, -2), defaultDirection: direction(0, -1), groupId: 'returnLoopA', tileType: 'return' },
      { id: 'returnB1', ...at(-2, -4), defaultDirection: direction(-1, 0), groupId: 'returnLoopB', tileType: 'return' },
      { id: 'returnB2', ...at(-3, -4), defaultDirection: direction(-1, 0), groupId: 'returnLoopB', tileType: 'return' },
      { id: 'returnB3', ...at(-4, -4), defaultDirection: direction(0, 1), groupId: 'returnLoopB', tileType: 'return' },
    ];
    const spawner = {
      id: 'conveyorCargoSpawner',
      ...at(-8, -3),
      launchDirection: direction(1, 0),
    };
    const target = {
      id: 'conveyorVaultPlate',
      ...at(3, -3),
    };

    return {
      id: 'conveyorVaultRoutingPuzzle',
      archetype: 'MultiStageRouting',
      difficulty: 3,
      roomId: room.id,
      targetDoorId: 'bonusVaultDoor',
      targetPressurePlateId: target.id,
      objectId: 'conveyorCargoObject',
      objectType: 'Refractor Battery',
      objectSpeed: 2.25,
      state: 'ObjectReady',
      spawner,
      target,
      belts,
      consoles: [
        {
          id: 'conveyorRouteConsole',
          label: 'Junction A Console',
          action: 'cycleJunction',
          controls: ['junctionA'],
          ...at(-7, -7),
        },
        {
          id: 'conveyorRouteConsoleB',
          label: 'Junction B Console',
          action: 'cycleJunction',
          controls: ['junctionB'],
          ...at(0, -7),
        },
        {
          id: 'conveyorLaunchConsole',
          label: 'Cargo Launcher',
          action: 'launchOrReset',
          ...at(5, -7),
        },
      ],
      junctions: [
        {
          id: 'junctionA',
          beltId: 'junctionA',
          tileKey: at(-5, -3).key,
          stateIndex: 0,
          states: belts.find((belt) => belt.id === 'junctionA').states,
          solutionStateIndex: 1,
        },
        {
          id: 'junctionB',
          beltId: 'junctionB',
          tileKey: at(-2, -3).key,
          stateIndex: 0,
          states: belts.find((belt) => belt.id === 'junctionB').states,
          solutionStateIndex: 1,
        },
      ],
      solutionState: {
        junctionA: 1,
        junctionB: 1,
      },
      maxSimulationSteps: 120,
      canReset: true,
      optional: true,
      rewardTier: 'Rare',
    };
  }

  _validateConveyorPuzzleDefinition(puzzle, tiles, rooms) {
    const errors = [];
    const warnings = [];
    const room = rooms.find((candidate) => candidate.id === puzzle.roomId);
    const beltKeys = new Set(puzzle.belts.map((belt) => belt.key));

    if (!room) {
      errors.push(`${puzzle.id} is missing its room.`);
    }

    for (const belt of puzzle.belts) {
      const tile = tiles.get(belt.key);
      if (!tile) {
        errors.push(`${puzzle.id} belt ${belt.id} is not on a valid floor tile.`);
        continue;
      }
      if (tile.type !== 'conveyor') {
        errors.push(`${puzzle.id} belt ${belt.id} could not be stamped as a conveyor tile.`);
      }
    }

    for (const console of puzzle.consoles) {
      const tile = tiles.get(console.key);
      if (!tile) {
        errors.push(`${console.label} is not on a valid floor tile.`);
        continue;
      }
      if (tile.type === 'conveyor' || beltKeys.has(console.key)) {
        errors.push(`${console.label} overlaps a conveyor belt.`);
      }
      if (Math.abs(console.x - room.x) > Math.floor(room.width / 2) - 1
        || Math.abs(console.z - room.z) > Math.floor(room.depth / 2) - 1) {
        errors.push(`${console.label} is too close to the conveyor room wall.`);
      }
      const nearestBeltDistance = Math.min(...puzzle.belts.map((belt) => (
        Math.abs(belt.x - console.x) + Math.abs(belt.z - console.z)
      )));
      if (nearestBeltDistance <= 1) {
        errors.push(`${console.label} is too close to the conveyor path.`);
      }
      if (!this._isConveyorPuzzleConsoleReachable(puzzle, console, tiles, room, beltKeys)) {
        errors.push(`${console.label} is not reachable from the conveyor room floor without crossing belts.`);
      }
    }

    const spawnerTile = tiles.get(puzzle.spawner.key);
    if (!spawnerTile || beltKeys.has(puzzle.spawner.key)) {
      errors.push(`${puzzle.id} spawner is invalid.`);
    }

    const targetTile = tiles.get(puzzle.target.key);
    if (!targetTile || beltKeys.has(puzzle.target.key)) {
      errors.push(`${puzzle.id} pressure plate is invalid.`);
    }

    const stateCombos = this._getConveyorPuzzleStateCombinations(puzzle);
    let hasSolution = false;
    let hasOnlySafeFailures = true;

    for (const states of stateCombos) {
      const result = this._simulateConveyorPuzzleDefinition(puzzle, states);
      if (result.status === 'ReachedTarget') {
        hasSolution = true;
      } else if (result.status !== 'LoopDetected' && result.status !== 'Blocked') {
        hasOnlySafeFailures = false;
      }
    }

    const solutionResult = this._simulateConveyorPuzzleDefinition(puzzle, puzzle.solutionState);
    if (solutionResult.status !== 'ReachedTarget') {
      errors.push(`${puzzle.id} stored solution state does not reach the pressure plate.`);
    }
    if (!hasSolution) {
      errors.push(`${puzzle.id} has no static solution.`);
    }
    if (!hasOnlySafeFailures) {
      errors.push(`${puzzle.id} has a console state that can lose the cargo object.`);
    }

    return {
      accepted: errors.length === 0,
      errors,
      warnings: errors.length ? warnings : [`${puzzle.id} conveyor routing puzzle validated successfully.`],
    };
  }

  _isConveyorPuzzleConsoleReachable(puzzle, console, tiles, room, beltKeys) {
    if (!room || !console) {
      return false;
    }

    const halfW = Math.floor(room.width / 2);
    const halfD = Math.floor(room.depth / 2);
    const targetKey = console.key;
    const isInsideRoom = (x, z) => (
      x >= room.x - halfW
      && x <= room.x + halfW
      && z >= room.z - halfD
      && z <= room.z + halfD
    );
    const isTraversable = (x, z) => {
      if (!isInsideRoom(x, z)) {
        return false;
      }

      const key = tileKey(x, z);
      const tile = tiles.get(key);
      return Boolean(
        tile
        && !beltKeys.has(key)
        && key !== puzzle.spawner.key
        && key !== puzzle.target.key
        && tile.type !== 'conveyor'
        && tile.type !== 'chest'
      );
    };

    if (!isTraversable(console.x, console.z)) {
      return false;
    }

    const startCandidates = [
      [room.x, room.z],
      [room.x - halfW + 2, room.z],
      [room.x + halfW - 2, room.z],
      [room.x, room.z - halfD + 2],
      [room.x, room.z + halfD - 2],
      [console.x, room.z],
    ];
    const start = startCandidates.find(([x, z]) => isTraversable(x, z));
    if (!start) {
      return false;
    }

    const queue = [start];
    const visited = new Set([tileKey(start[0], start[1])]);

    for (let index = 0; index < queue.length; index += 1) {
      const [x, z] = queue[index];
      const key = tileKey(x, z);
      if (key === targetKey) {
        return true;
      }

      for (const [dx, dz] of DIRECTIONS) {
        const nextX = x + dx;
        const nextZ = z + dz;
        const nextKey = tileKey(nextX, nextZ);
        if (visited.has(nextKey) || !isTraversable(nextX, nextZ)) {
          continue;
        }

        visited.add(nextKey);
        queue.push([nextX, nextZ]);
      }
    }

    return false;
  }

  _getConveyorPuzzleStateCombinations(puzzle) {
    const junctions = puzzle.junctions ?? [];
    const combinations = [];
    const visit = (index, state) => {
      if (index >= junctions.length) {
        combinations.push({ ...state });
        return;
      }

      const junction = junctions[index];
      for (let stateIndex = 0; stateIndex < (junction.states?.length ?? 1); stateIndex += 1) {
        visit(index + 1, {
          ...state,
          [junction.id]: stateIndex,
        });
      }
    };

    visit(0, {});
    return combinations;
  }

  _simulateConveyorPuzzleDefinition(puzzle, junctionStates = {}) {
    const beltByKey = new Map(puzzle.belts.map((belt) => [belt.key, belt]));
    const junctionByBeltId = new Map((puzzle.junctions ?? []).map((junction) => [junction.beltId, junction]));
    let currentKey = puzzle.spawner.key;
    const visited = new Set();

    for (let step = 0; step < (puzzle.maxSimulationSteps ?? 120); step += 1) {
      if (currentKey === puzzle.target.key) {
        return { status: 'ReachedTarget', steps: step };
      }

      const belt = beltByKey.get(currentKey);
      const direction = currentKey === puzzle.spawner.key
        ? puzzle.spawner.launchDirection
        : this._getConveyorPuzzleBeltDirection(belt, junctionByBeltId.get(belt?.id), junctionStates);

      if (!direction || (direction.x === 0 && direction.z === 0)) {
        return { status: 'Blocked', steps: step };
      }

      const [xText, zText] = currentKey.split(',');
      const nextKey = tileKey(Number(xText) + direction.x, Number(zText) + direction.z);
      const configurationKey = `${currentKey}|${Object.entries(junctionStates).map(([id, value]) => `${id}:${value}`).join('|')}`;
      if (visited.has(configurationKey)) {
        return { status: 'LoopDetected', steps: step };
      }
      visited.add(configurationKey);

      if (nextKey === puzzle.target.key || beltByKey.has(nextKey)) {
        currentKey = nextKey;
        continue;
      }

      return { status: 'InvalidPath', steps: step, nextKey };
    }

    return { status: 'MaxStepsExceeded', steps: puzzle.maxSimulationSteps ?? 120 };
  }

  _getConveyorPuzzleBeltDirection(belt, junction = null, junctionStates = {}) {
    if (!belt) {
      return null;
    }

    if (junction?.states?.length) {
      const stateIndex = THREE.MathUtils.clamp(
        junctionStates[junction.id] ?? junction.stateIndex ?? 0,
        0,
        junction.states.length - 1,
      );
      return junction.states[stateIndex]?.direction ?? belt.defaultDirection;
    }

    return belt.defaultDirection;
  }

  _calculateBoundsRadius(tiles) {
    let maxAbsTile = 0;

    for (const tile of tiles.values()) {
      maxAbsTile = Math.max(maxAbsTile, Math.abs(tile.x), Math.abs(tile.z));
    }

    return Math.max(82, (maxAbsTile + 2.5) * this.tileSize);
  }

  _applyIndustrialFactoryLayout(tiles, rooms, connectionPlans = []) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const conveyorRoom = roomById.get('conveyorRoom');
    const bossRoom = roomById.get('bossRoom');
    const shrineRoom = roomById.get('shrineRoom');
    const trapRoom = roomById.get('trapRoom');

    for (const room of rooms.filter((candidate) => (
      !candidate.isDungeonSupplement && !candidate.suppressRoomGeometry
    ))) {
      this._markRoomCatwalks(tiles, room);
    }

    this._markConveyorBridge(tiles, trapRoom, conveyorRoom, {
      speed: 1.45,
      surface: 'conveyorBridge',
      path: connectionPlans.find((plan) => (
        plan.level === 0
        && plan.fromRoomId === trapRoom?.id
        && plan.toRoomId === conveyorRoom?.id
      ))?.fullPath,
    });
    this._markConveyorBridge(tiles, conveyorRoom, bossRoom, {
      speed: 1.72,
      surface: 'conveyorBridge',
      path: connectionPlans.find((plan) => (
        plan.level === 0
        && plan.fromRoomId === conveyorRoom?.id
        && plan.toRoomId === bossRoom?.id
      ))?.fullPath,
    });
    this._markConveyorBridge(tiles, bossRoom, shrineRoom, {
      speed: 1.38,
      surface: 'conveyorBridge',
    });
  }

  _createFullHeightDoorVoidTileKeys(tiles, rooms, connectionPlans = []) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const fullHeightDoorVoidTileKeys = new Set();
    for (const connection of connectionPlans.filter((plan) => plan.level === 0 && plan.doorId)) {
      const fromRoom = roomById.get(connection.fromRoomId);
      const toRoom = roomById.get(connection.toRoomId);
      const { point, alongX } = resolveConnectionDoorPlacement(
        connection,
        fromRoom,
        toRoom,
        { gatePlacementSide: 'source' },
      );
      if (!point) continue;
      const clearanceOffsets = alongX
        ? [[0, -1], [0, 0], [0, 1]]
        : [[-1, 0], [0, 0], [1, 0]];
      for (const [dx, dz] of clearanceOffsets) {
        const key = tileKey(point.x + dx, point.z + dz);
        if (tiles.has(key)) fullHeightDoorVoidTileKeys.add(key);
      }
    }
    return fullHeightDoorVoidTileKeys;
  }

  _createFactoryLevelTiles(tiles, rooms, connectionPlans = [], solidZones = []) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const extraTiles = [];
    const seen = new Set();
    const authoritativeSupplementFloorByKey = new Map();
    let rampRouteSequence = 0;
    const progressionAccessTileKeys = this._createProgressionAccessTileKeys(tiles, rooms, connectionPlans);
    const structuralVoidTileKeys = new Set(progressionAccessTileKeys);
    const fullHeightDoorVoidTileKeys = this._createFullHeightDoorVoidTileKeys(
      tiles,
      rooms,
      connectionPlans,
    );
    const reserveStructuralVoid = (x, z, radius = 1) => {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (Math.abs(dx) + Math.abs(dz) <= radius && tiles.has(tileKey(x + dx, z + dz))) {
            structuralVoidTileKeys.add(tileKey(x + dx, z + dz));
          }
        }
      }
    };
    for (const connection of connectionPlans.filter((plan) => plan.level === 0)) {
      for (const point of connection.fullPath ?? []) {
        reserveStructuralVoid(point.x, point.z);
      }
    }
    for (const key of fullHeightDoorVoidTileKeys) structuralVoidTileKeys.add(key);
    const coolantFixtureTileKeys = this._createCoolantFixtureTileKeys(tiles, rooms);
    const pushExtra = (x, z, options = {}) => {
      if (!ENABLE_PROCEDURAL_RAISED_ROOM_LEVELS && (options.elevation ?? 0) > 0.05) {
        return null;
      }

      const columnKey = tileKey(x, z);
      if (!tiles.has(columnKey)) {
        return null;
      }
      const isClearProgressionOverpass = this._isClearProgressionOverpass(options);
      if (
        (!options.allowProgressionAccess
          && !isClearProgressionOverpass
          && progressionAccessTileKeys.has(columnKey))
        || coolantFixtureTileKeys.has(columnKey)
      ) {
        return null;
      }

      const level = options.level ?? 0;
      const key = floorTileKey(x, z, level);
      if (seen.has(key)) {
        return null;
      }

      const tile = createFloorTile(x, z, options);
      delete tile.allowProgressionAccess;
      extraTiles.push(tile);
      seen.add(key);
      return tile;
    };
    const pushAuthoritativeSupplementExtra = (room, x, z, options = {}) => {
      const elevation = Number(options.elevation);
      if (!Number.isInteger(x) || !Number.isInteger(z) || !Number.isFinite(elevation)) {
        throw new DungeonAugmentationIncompatibleContentError(
          `Supplement room ${room?.id ?? '(unnamed)'} has a malformed authoritative raised-floor cell.`,
          {
            compatible: false,
            status: 'incompatible-content',
            resetOrAbandonRequired: true,
            roomId: room?.id ?? null,
            floorCellId: options.augmentationFloorCellId ?? null,
          },
        );
      }
      const absoluteKey = absoluteFloorTileKey(x, z, elevation);
      const baseFloor = tiles.get(tileKey(x, z));
      const existing = authoritativeSupplementFloorByKey.get(absoluteKey)
        ?? extraTiles.find((floor) => (
          absoluteFloorTileKey(floor.x, floor.z, floor.elevation ?? 0) === absoluteKey
        ))
        ?? (baseFloor
          && Math.abs(Number(baseFloor.elevation ?? 0) - elevation) <= 0.05
          ? baseFloor
          : null);
      if (existing) {
        const existingOwners = physicalFloorOwnerIds(existing).map(String);
        if (existingOwners.length > 0 && !existingOwners.includes(String(room.id))) {
          throw new DungeonAugmentationIncompatibleContentError(
            `Supplement room ${room.id} raised-floor cell ${absoluteKey} overlaps another physical owner.`,
            {
              compatible: false,
              status: 'incompatible-content',
              resetOrAbandonRequired: true,
              roomId: room.id,
              floorCellId: options.augmentationFloorCellId ?? null,
              existingOwnerIds: existingOwners,
            },
          );
        }
        applyTileOptions(existing, options);
        existing.dungeonSupplement = true;
        authoritativeSupplementFloorByKey.set(absoluteKey, existing);
        return existing;
      }

      // Curated V4 tier masks are allowed to introduce an upper-only column.
      // Legacy `pushExtra` intentionally requires a base 2D tile and therefore
      // cannot be used here. Collision, headroom, returnability, and shell
      // proofs still run against this exact floor record before acceptance.
      const tile = createFloorTile(x, z, options);
      delete tile.allowProgressionAccess;
      tile.dungeonSupplement = true;
      extraTiles.push(tile);
      authoritativeSupplementFloorByKey.set(absoluteKey, tile);
      seen.add(floorTileKey(x, z, options.level ?? 0));
      return tile;
    };
    const markBase = (x, z, options = {}) => {
      const tile = tiles.get(tileKey(x, z));
      if (!tile) {
        return null;
      }
      const columnKey = tileKey(x, z);
      if (
        !options.allowProgressionAccess
        && (progressionAccessTileKeys.has(columnKey) || coolantFixtureTileKeys.has(columnKey))
        && wouldObstructProgressionAccess(options)
      ) {
        return tile;
      }

      return applyTileOptions(tile, options);
    };
    const addDeck = (room, {
      level,
      elevation,
      surface,
      type = 'floor',
      minX,
      maxX,
      minZ,
      maxZ,
      ring = false,
      conveyorAxis = null,
      conveyorSpeed = 1.4,
      supportStyle = null,
      massGroupId = null,
    }) => {
      if (!room) {
        return;
      }
      if (!ENABLE_PROCEDURAL_RAISED_ROOM_LEVELS && elevation > 0.05) {
        return;
      }

      for (let x = minX; x <= maxX; x += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          if (ring && x > minX && x < maxX && z > minZ && z < maxZ) {
            continue;
          }

          const dx = conveyorAxis === 'x' ? Math.sign((room.x - x) || 1) : 0;
          const dz = conveyorAxis === 'z' ? Math.sign((room.z - z) || 1) : 0;
          const baseTile = tiles.get(tileKey(x, z));
          if (supportStyle === 'solid_mass' && fullHeightDoorVoidTileKeys.has(tileKey(x, z))) {
            continue;
          }
          const keepUnderpassOpen = supportStyle === 'solid_mass' && (
            structuralVoidTileKeys.has(tileKey(x, z))
            || ['hallway', 'entrance'].includes(baseTile?.type)
          );
          pushExtra(x, z, {
            type,
            elevation,
            level,
            surface,
            roomId: room.id,
            directionX: dx,
            directionZ: dz,
            speed: conveyorSpeed,
            supportStyle: keepUnderpassOpen ? 'open_underpass' : supportStyle,
            massGroupId,
          });
        }
      }
    };
    const markBaseRect = (room, {
      elevation,
      level,
      surface,
      minX,
      maxX,
      minZ,
      maxZ,
      supportStyle = null,
      massGroupId = null,
    }) => {
      if (!room) {
        return;
      }

      for (let x = minX; x <= maxX; x += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          markBase(x, z, {
            elevation,
            level,
            surface,
            roomId: room.id,
            supportStyle,
            massGroupId,
          });
        }
      }
    };
    const expandRampPath = (points) => {
      const expanded = [];
      const append = (point) => {
        const last = expanded[expanded.length - 1];
        if (last && last.x === point.x && last.z === point.z) {
          return;
        }
        expanded.push(point);
      };

      for (let i = 0; i < points.length - 1; i += 1) {
        const from = points[i];
        const to = points[i + 1];

        if (from.x !== to.x) {
          for (const x of rangeBetweenOrdered(from.x, to.x)) {
            append({ x, z: from.z });
          }
        } else {
          append(from);
        }

        if (from.z !== to.z) {
          const zValues = rangeBetweenOrdered(from.z, to.z);
          for (const z of zValues.slice(from.x !== to.x ? 1 : 0)) {
            append({ x: to.x, z });
          }
        }
      }

      append(points[points.length - 1]);
      return expanded.filter((point) => tiles.has(tileKey(point.x, point.z)));
    };
    const addRampLandingPath = (room, fromPoint, elevation, level, rampRouteId) => {
      if (!room || level === 0 || !fromPoint) {
        return;
      }

      const levelValue = Math.round(level * 100) / 100;
      const roomTiles = [...tiles.values(), ...extraTiles]
        .filter((tile) => this._isTileInsideRoom(tile, room))
        .filter((tile) => tile.surface !== 'industrialRamp')
        .filter((tile) => Math.abs((tile.elevation ?? 0) - elevation) <= 0.12)
        .filter((tile) => Math.abs(((tile.level ?? 0) - levelValue)) <= 0.12);

      const target = roomTiles
        .filter((tile) => tile.x !== fromPoint.x || tile.z !== fromPoint.z)
        .sort((a, b) => (
          Math.abs(a.x - fromPoint.x) + Math.abs(a.z - fromPoint.z)
        ) - (
          Math.abs(b.x - fromPoint.x) + Math.abs(b.z - fromPoint.z)
        ))[0];

      if (!target) {
        return;
      }

      const distance = Math.abs(target.x - fromPoint.x) + Math.abs(target.z - fromPoint.z);
      if (distance <= 1 || distance > 8) {
        return;
      }

      const landingPoints = [];
      for (const x of rangeBetweenOrdered(fromPoint.x, target.x)) {
        landingPoints.push({ x, z: fromPoint.z });
      }
      for (const z of rangeBetweenOrdered(fromPoint.z, target.z).slice(1)) {
        landingPoints.push({ x: target.x, z });
      }

      for (const point of landingPoints.slice(1)) {
        pushExtra(point.x, point.z, {
          type: 'floor',
          elevation,
          level: levelValue,
          surface: 'rampLanding',
          roomId: room.id,
          rampRouteId,
        });
      }
    };
    const connectSocketToLocalTier = (room, socket, connectionId) => {
      if (!room || !socket || socket.level <= 0) {
        return;
      }

      const socketLocalElevation = Number(socket.elevation ?? 0)
        - Number(room.plannedBaseElevation ?? room.baseElevation ?? 0);
      const target = getAllFloorTiles()
        .filter((tile) => this._isTileInsideRoom(tile, room))
        .filter((tile) => tile.x !== socket.x || tile.z !== socket.z)
        .filter((tile) => Math.abs((tile.elevation ?? 0) - socketLocalElevation) <= 0.12)
        .filter((tile) => Math.abs((tile.level ?? 0) - socket.level) <= 0.12)
        .filter((tile) => tile.connectionId !== connectionId)
        .filter((tile) => tile.surface !== 'upperConnectionBridge' && tile.surface !== 'rampLanding')
        .sort((a, b) => (
          Math.abs(a.x - socket.x) + Math.abs(a.z - socket.z)
        ) - (
          Math.abs(b.x - socket.x) + Math.abs(b.z - socket.z)
        ))[0];

      if (!target) {
        return;
      }

      for (const point of expandRampPath([socket, target])) {
        if (!this._isTileInsideRoom(point, room)) {
          continue;
        }
        pushExtra(point.x, point.z, {
          type: 'floor',
          elevation: socketLocalElevation,
          level: socket.level,
          surface: 'upperConnectionApproach',
          roomId: room.id,
          connectionId,
          allowProgressionAccess: true,
          preserveProgressionOverpass: true,
        });
      }
    };
    const addRampRun = (room, points, fromElevation, toElevation, fromLevel, toLevel) => {
      if (
        !ENABLE_PROCEDURAL_RAISED_ROOM_LEVELS
        && (fromElevation > 0.05 || toElevation > 0.05 || fromLevel > 0 || toLevel > 0)
      ) {
        return;
      }

      const rampPoints = expandRampPath(points);
      if (rampPoints.length < 2) {
        return;
      }

      const useBaseFloor = fromLevel === 0 || toLevel === 0;
      const span = rampPoints.length - 1;
      const risePerTile = Math.abs(toElevation - fromElevation) / span;
      const rampRouteId = `rampRoute_${room?.id ?? 'unowned'}_${rampRouteSequence += 1}`;
      const stepDirection = (from, to) => ({
        x: Math.sign((to?.x ?? from.x) - from.x),
        z: Math.sign((to?.z ?? from.z) - from.z),
      });
      const isTurnIndex = (index) => {
        if (index <= 0 || index >= rampPoints.length - 1) {
          return false;
        }
        const incoming = stepDirection(rampPoints[index - 1], rampPoints[index]);
        const outgoing = stepDirection(rampPoints[index], rampPoints[index + 1]);
        return incoming.x !== outgoing.x || incoming.z !== outgoing.z;
      };
      let straightRunIndex = 0;
      const markBaseRampTile = (point, options) => {
        const base = tiles.get(tileKey(point.x, point.z));
        const original = base && !base.rampRouteId ? { ...base } : null;
        const marked = markBase(point.x, point.z, options);
        if (marked && original && !marked.rampBaseOriginal) {
          marked.rampBaseOriginal = original;
        }
        return marked;
      };

      for (let i = 0; i < rampPoints.length; i += 1) {
        const point = rampPoints[i];
        const t = i / span;
        const elevation = THREE.MathUtils.lerp(fromElevation, toElevation, t);
        const level = Math.round((fromLevel + (toLevel - fromLevel) * t) * 100) / 100;

        if (isTurnIndex(i)) {
          const landingOptions = {
            type: 'floor',
            elevation,
            level,
            surface: 'rampLanding',
            roomId: room?.id,
            rampRouteId,
          };
          const landing = useBaseFloor
            ? markBaseRampTile(point, landingOptions)
            : pushExtra(point.x, point.z, landingOptions);
          if (landing?.surface === 'rampLanding') {
            delete landing.rampStartElevation;
            delete landing.rampEndElevation;
            delete landing.rampDirectionX;
            delete landing.rampDirectionZ;
            delete landing.rampRunId;
            delete landing.steepRamp;
          }
          straightRunIndex += 1;
          continue;
        }

        const previous = rampPoints[i - 1] ?? null;
        const next = rampPoints[i + 1] ?? null;
        const direction = next
          ? stepDirection(point, next)
          : stepDirection(previous, point);
        const startT = Math.max(0, (i - 0.5) / span);
        const endT = Math.min(1, (i + 0.5) / span);
          const options = {
          type: 'floor',
          elevation,
          level,
          surface: 'industrialRamp',
          roomId: room?.id,
          rampStartElevation: THREE.MathUtils.lerp(fromElevation, toElevation, startT),
          rampEndElevation: THREE.MathUtils.lerp(fromElevation, toElevation, endT),
          rampDirectionX: direction.x,
          rampDirectionZ: direction.z,
            rampRouteId,
            rampRunId: `${rampRouteId}_run_${straightRunIndex + 1}`,
            rampScaffoldPriority: room?.type === 'conveyor' ? 'scaffold' : 'ramp',
            rampPointIndex: i,
            rampPointCount: rampPoints.length,
          };
        const tile = useBaseFloor
          ? markBaseRampTile(point, options)
          : pushExtra(point.x, point.z, options);

        if (tile && risePerTile > RUIN_RAMP_MAX_STEP) {
          tile.steepRamp = true;
        }
      }

      addRampLandingPath(room, rampPoints[0], fromElevation, fromLevel, rampRouteId);
      addRampLandingPath(
        room,
        rampPoints[rampPoints.length - 1],
        toElevation,
        toLevel,
        rampRouteId,
      );
    };
    const addMinorDropSpace = (room, {
      id,
      width = 9,
      depth = 9,
      purpose = 'optional_lower_exploration_space',
    } = {}) => {
      if (!room || !id) {
        return null;
      }

      const roomHalfW = Math.floor(room.width / 2);
      const roomHalfD = Math.floor(room.depth / 2);
      const halfW = Math.floor(width / 2);
      const halfD = Math.floor(depth / 2);
      const minCenterX = room.x - roomHalfW + halfW + 2;
      const maxCenterX = room.x + roomHalfW - halfW - 2;
      const minCenterZ = room.z - roomHalfD + halfD + 2;
      const maxCenterZ = room.z + roomHalfD - halfD - 2;
      const directions = [
        { dx: 1, dz: 0, ledgeEdge: 'left' },
        { dx: -1, dz: 0, ledgeEdge: 'right' },
        { dx: 0, dz: 1, ledgeEdge: 'front' },
        { dx: 0, dz: -1, ledgeEdge: 'back' },
      ];
      const candidates = [];

      for (let centerX = minCenterX; centerX <= maxCenterX; centerX += 1) {
        for (let centerZ = minCenterZ; centerZ <= maxCenterZ; centerZ += 1) {
          const bounds = {
            minX: centerX - halfW,
            maxX: centerX + halfW,
            minZ: centerZ - halfD,
            maxZ: centerZ + halfD,
          };
          if (
            room.x < bounds.minX
            || room.x > bounds.maxX
            || room.z < bounds.minZ
            || room.z > bounds.maxZ
          ) {
            continue;
          }

          for (const direction of directions) {
            const alongOffsets = [-1, 0];
            const returnShelfPoints = alongOffsets.map((offset) => ({
              x: direction.dx
                ? (direction.dx > 0 ? bounds.maxX : bounds.minX)
                : centerX + offset,
              z: direction.dz
                ? (direction.dz > 0 ? bounds.maxZ : bounds.minZ)
                : centerZ + offset,
            }));
            const entryDirection = { dx: -direction.dx, dz: -direction.dz };
            const entryFloorPoints = alongOffsets.map((offset) => ({
              x: entryDirection.dx
                ? (entryDirection.dx > 0 ? bounds.maxX : bounds.minX)
                : centerX + offset,
              z: entryDirection.dz
                ? (entryDirection.dz > 0 ? bounds.maxZ : bounds.minZ)
                : centerZ + offset,
            }));
            const entryLipPoints = entryFloorPoints.map((point) => ({
              x: point.x + entryDirection.dx,
              z: point.z + entryDirection.dz,
            }));
            const exitRimPoints = returnShelfPoints.map((point) => ({
              x: point.x + direction.dx,
              z: point.z + direction.dz,
            }));
            const criticalPoints = [
              ...returnShelfPoints,
              ...entryFloorPoints,
              ...entryLipPoints,
              ...exitRimPoints,
            ];
            if (criticalPoints.some((point) => !tiles.has(tileKey(point.x, point.z)))) {
              continue;
            }

            let reservedCount = 0;
            for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
              for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
                const baseTile = tiles.get(tileKey(x, z));
                if (
                  progressionAccessTileKeys.has(tileKey(x, z))
                  || ['hallway', 'entrance'].includes(baseTile?.type)
                ) {
                  reservedCount += 1;
                }
              }
            }
            const criticalReserved = criticalPoints.filter((point) => (
              progressionAccessTileKeys.has(tileKey(point.x, point.z))
            )).length;
            candidates.push({
              bounds,
              direction,
              entryDirection,
              entryFloorPoints,
              entryLipPoints,
              returnShelfPoints,
              exitRimPoints,
              score: criticalReserved * 1000
                + reservedCount * 20
                + Math.abs(centerX - room.x)
                + Math.abs(centerZ - room.z),
            });
          }
        }
      }

      const selected = candidates.sort((a, b) => a.score - b.score)[0];
      if (!selected) {
        return null;
      }

      const lowerElevation = RUIN_MINOR_DROP_ELEVATION;
      const lowerFloorKeys = [];
      const bridgeFloorKeys = [];
      for (let x = selected.bounds.minX; x <= selected.bounds.maxX; x += 1) {
        for (let z = selected.bounds.minZ; z <= selected.bounds.maxZ; z += 1) {
          const baseTile = tiles.get(tileKey(x, z));
          const preserveGroundBridge = progressionAccessTileKeys.has(tileKey(x, z))
            || ['hallway', 'entrance'].includes(baseTile?.type);
          const lowered = preserveGroundBridge
            ? applyTileOptions(baseTile, {
                level: -1,
                elevation: lowerElevation,
                surface: 'basementFloor',
                roomId: room.id,
                dropSpaceId: id,
              })
            : markBase(x, z, {
            level: -1,
            elevation: lowerElevation,
            surface: 'basementFloor',
            roomId: room.id,
            dropSpaceId: id,
              });
          if (lowered && Math.abs((lowered.elevation ?? 0) - lowerElevation) <= 0.05) {
            lowerFloorKeys.push(this._getFloorTileGraphKey(lowered));
          }
          if (preserveGroundBridge) {
            const bridge = pushExtra(x, z, {
              type: 'floor',
              elevation: 0,
              level: 0,
              surface: 'dropSpaceOverpass',
              roomId: room.id,
              dropSpaceId: id,
              preserveProgressionFooting: true,
              allowProgressionAccess: true,
            });
            if (bridge) {
              bridgeFloorKeys.push(this._getFloorTileGraphKey(bridge));
            }
          }
        }
      }

      const entryFloorKeys = [];
      for (const point of selected.entryFloorPoints) {
        const tile = tiles.get(tileKey(point.x, point.z));
        if (!tile || Math.abs((tile.elevation ?? 0) - lowerElevation) > 0.05) {
          continue;
        }
        tile.allowsGroundedDropLanding = true;
        tile.dropSpaceId = id;
        const edgeKey = `${selected.entryDirection.dx},${selected.entryDirection.dz}`;
        tile.openRetainingWallEdges = [...new Set([...(tile.openRetainingWallEdges ?? []), edgeKey])];
        entryFloorKeys.push(this._getFloorTileGraphKey(tile));
      }

      const returnShelfFloorKeys = [];
      const returnShelfColumnKeys = new Set();
      for (const point of selected.returnShelfPoints) {
        const lowerTile = tiles.get(tileKey(point.x, point.z));
        if (lowerTile) {
          const outwardEdge = `${selected.direction.dx},${selected.direction.dz}`;
          lowerTile.blockedBySolidLedgeSupport = true;
          lowerTile.openRetainingWallEdges = [
            ...new Set([...(lowerTile.openRetainingWallEdges ?? []), outwardEdge]),
          ];
        }
        const shelf = pushExtra(point.x, point.z, {
          type: 'floor',
          elevation: RUIN_MINOR_DROP_SHELF_ELEVATION,
          level: -0.5,
          surface: 'basementReturnShelf',
          roomId: room.id,
          isLedgeSurface: true,
          ledgeEdges: [selected.direction.ledgeEdge],
          platformPurpose: `${id}_return_climb_shelf`,
          requiredTraversalAction: 'ledge_climb',
          dropSpaceId: id,
          supportBaseElevation: lowerElevation,
          allowProgressionAccess: true,
        });
        if (shelf) {
          returnShelfColumnKeys.add(tileKey(point.x, point.z));
          returnShelfFloorKeys.push(this._getFloorTileGraphKey(shelf));
        }
      }

      // These two columns are occupied by solid ledge plinths. They remain
      // visually floored beneath the mass, but are deliberately excluded from
      // the walkable lower-floor contract so the player can never stand inside
      // or jump through a floating shelf.
      for (let index = lowerFloorKeys.length - 1; index >= 0; index -= 1) {
        const [coordinates] = lowerFloorKeys[index].split('@');
        if (returnShelfColumnKeys.has(coordinates)) {
          lowerFloorKeys.splice(index, 1);
        }
      }

      const dropSpace = {
        id,
        roomId: room.id,
        purpose,
        lowerBounds: { ...selected.bounds },
        lowerElevation,
        shelfElevation: RUIN_MINOR_DROP_SHELF_ELEVATION,
        entryFloorKeys,
        entryLipFloorKeys: selected.entryLipPoints.map((point) => (
          this._getFloorTileGraphKey(tiles.get(tileKey(point.x, point.z)))
        )),
        lowerFloorKeys,
        bridgeFloorKeys,
        returnShelfFloorKeys,
        exitFloorKeys: selected.exitRimPoints.map((point) => (
          this._getFloorTileGraphKey(tiles.get(tileKey(point.x, point.z)))
        )),
        requiredActions: ['drop', 'ledge_climb', 'jump'],
        returnDirectionX: selected.direction.dx,
        returnDirectionZ: selected.direction.dz,
      };
      room.dropSpace = dropSpace;
      return dropSpace;
    };
    const getAllFloorTiles = () => [...tiles.values(), ...extraTiles];
    const isScaffoldAccessTile = (tile) => (
      tile
      && tile.surface !== 'industrialRamp'
      && (tile.elevation ?? 0) > 0.05
      && SCAFFOLD_RAMP_ACCESS_SURFACES.has(tile.surface)
    );
    const getRoomForTile = (tile) => rooms.find((room) => (
      room.id === tile.roomId || this._isTileInsideRoom(tile, room)
    ));
    const usesAuthoritativeSupplementGeometry = (room) => Boolean(
      room?.isDungeonSupplement
        && room?.augmentationBlueprintId
        && (room.augmentationFloorTiers ?? []).some((tier) => (
          tier?.authoritative === true
            && Array.isArray(tier.worldCells)
            && tier.worldCells.length > 0
        ))
    );
    const getScaffoldChains = () => {
      const candidates = getAllFloorTiles().filter(isScaffoldAccessTile);
      const columns = new Map();
      const byKey = new Map();

      for (const tile of candidates) {
        const columnKey = tileKey(tile.x, tile.z);
        const column = columns.get(columnKey) ?? [];
        column.push(tile);
        columns.set(columnKey, column);
        byKey.set(this._getFloorTileGraphKey(tile), tile);
      }

      const unvisited = new Set(byKey.keys());
      const chains = [];

      for (const startKey of byKey.keys()) {
        if (!unvisited.has(startKey)) {
          continue;
        }

        const startTile = byKey.get(startKey);
        const queue = [startTile];
        const chain = [];
        unvisited.delete(startKey);

        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          const current = queue[cursor];
          chain.push(current);

          for (const [dx, dz] of DIRECTIONS) {
            const neighborColumn = columns.get(tileKey(current.x + dx, current.z + dz)) ?? [];
            for (const neighbor of neighborColumn) {
              const neighborKey = this._getFloorTileGraphKey(neighbor);
              if (!unvisited.has(neighborKey)) {
                continue;
              }
              if (Math.abs((neighbor.elevation ?? 0) - (current.elevation ?? 0)) > 0.18) {
                continue;
              }

              unvisited.delete(neighborKey);
              queue.push(neighbor);
            }
          }
        }

        chains.push(chain);
      }

      return chains;
    };
    const countChainNeighbors = (chainKeys, tile) => DIRECTIONS.reduce((count, [dx, dz]) => {
      const neighborKey = tileKey(tile.x + dx, tile.z + dz);
      return count + (chainKeys.has(neighborKey) ? 1 : 0);
    }, 0);
    const findExistingAccessRamps = (chain) => {
      const chainKeys = new Set(chain.map((tile) => this._getFloorTileGraphKey(tile)));
      const allTiles = getAllFloorTiles();
      const rampTiles = allTiles.filter((tile) => tile.surface === 'industrialRamp');
      const connectedRamps = new Set();
      const columns = new Map();

      for (const tile of allTiles) {
        const key = tileKey(tile.x, tile.z);
        const column = columns.get(key) ?? [];
        column.push(tile);
        columns.set(key, column);
      }

      for (const rampTile of rampTiles) {
        for (const [dx, dz] of DIRECTIONS) {
          const neighborColumn = columns.get(tileKey(rampTile.x + dx, rampTile.z + dz)) ?? [];
          const connectsToChain = neighborColumn.some((neighbor) => (
            chainKeys.has(this._getFloorTileGraphKey(neighbor))
            && this._canTraverseBetweenFloorTiles(rampTile, neighbor)
          ));

          if (connectsToChain) {
            connectedRamps.add(this._getFloorTileGraphKey(rampTile));
          }
        }
      }

      const room = getRoomForTile(chain[0]);
      const blockingPlatforms = this._createBlockingPlatformColumnMap(allTiles);
      const navigableTiles = allTiles.filter((tile) => (
        !this._isFloorTileBlockedBySolidZone(tile, solidZones)
        && !this._isFloorTileBlockedByGeneratedPlatform(tile, blockingPlatforms)
      ));
      const groundedStart = room
        ? this._findRoomWalkabilityStartTile(room, navigableTiles)
        : navigableTiles.find((tile) => Math.abs(tile.elevation ?? 0) <= 0.05 && tile.surface !== 'industrialRamp');
      const runtimeReachable = this._createReachableFloorTileKeySet(groundedStart, navigableTiles);
      return [...connectedRamps]
        .map((key) => rampTiles.find((tile) => this._getFloorTileGraphKey(tile) === key))
        .filter((tile) => tile && runtimeReachable.has(this._getFloorTileGraphKey(tile)));
    };
    const createScaffoldRampCandidate = (chainTile, direction, occupiedRampKeys) => {
      const targetElevation = chainTile.elevation ?? 0;
      const targetLevel = Number.isFinite(chainTile.level) ? chainTile.level : 1;
      const rampLength = Math.max(2, Math.ceil(Math.abs(targetElevation) / RUIN_RAMP_MAX_STEP));
      const allTiles = getAllFloorTiles();
      const room = getRoomForTile(chainTile);
      if (usesAuthoritativeSupplementGeometry(room)) {
        // V4 modules carry exact transfer cells/devices that are stamped by
        // stampDungeonSupplementBlueprintTransfers. The legacy factory-room
        // repair pass runs earlier and must not invent a generic ramp through
        // an authored ladder, lift, stair, or curated landing footprint.
        return null;
      }
      if (room?.id === 'alienServerRoom') {
        // This room has one authored outer-wall ramp. Automatic straight-line
        // repairs through its center would intersect the monolith field.
        return null;
      }
      if (coolantFixtureTileKeys.has(tileKey(chainTile.x, chainTile.z))) {
        return null;
      }

      for (let distance = 1; distance <= rampLength + 1; distance += 1) {
        const x = chainTile.x + direction[0] * distance;
        const z = chainTile.z + direction[1] * distance;
        const columnKey = tileKey(x, z);
        const base = tiles.get(tileKey(x, z));

        if (
          !base
          || RESERVED_FACTORY_SURFACE_TYPES.has(base.type)
          || base.type === 'conveyor'
          || base.type === 'trap'
          || this._isFloorTileBlockedBySolidZone(base, solidZones)
        ) {
          return null;
        }
        if (base.surface === 'industrialRamp' || Math.abs(base.elevation ?? 0) > 0.05) {
          return null;
        }
        if (
          occupiedRampKeys.has(columnKey)
          || coolantFixtureTileKeys.has(columnKey)
          || progressionAccessTileKeys.has(columnKey)
        ) {
          return null;
        }

        const hasRaisedOverlap = allTiles.some((tile) => (
          tile.x === x
          && tile.z === z
          && tile.surface !== 'industrialRamp'
          && Math.abs(tile.elevation ?? 0) > 0.05
        ));

        if (hasRaisedOverlap) {
          return null;
        }
      }

      const start = {
        x: chainTile.x + direction[0] * (rampLength + 1),
        z: chainTile.z + direction[1] * (rampLength + 1),
      };
      const end = {
        x: chainTile.x + direction[0],
        z: chainTile.z + direction[1],
      };

      return {
        room,
        chainTile,
        points: [start, end],
        targetElevation,
        targetLevel,
        rampLength,
      };
    };
    const addScaffoldAccessRamps = () => {
      const occupiedRampKeys = new Set(
        getAllFloorTiles()
          .filter((tile) => tile.surface === 'industrialRamp')
          .map((tile) => tileKey(tile.x, tile.z)),
      );

      for (const chain of getScaffoldChains()) {
        if (!chain.length) {
          continue;
        }

        const connectionIds = new Set(chain.map((tile) => tile.connectionId).filter(Boolean));
        const requiredEndpointRoomIds = new Set(
          connectionPlans
            .filter((plan) => connectionIds.has(plan.id) && plan.level > 0)
            .flatMap((plan) => [plan.fromRoomId, plan.toRoomId]),
        );
        const existingAccessRamps = findExistingAccessRamps(chain);
        const desiredRampCount = Math.max(1, requiredEndpointRoomIds.size);
        const missingRampCount = desiredRampCount - existingAccessRamps.length;

        if (missingRampCount <= 0) {
          continue;
        }

        const chainColumnKeys = new Set(chain.map((tile) => tileKey(tile.x, tile.z)));
        const candidates = [];

        for (const chainTile of chain) {
          for (const direction of DIRECTIONS) {
            const candidate = createScaffoldRampCandidate(chainTile, direction, occupiedRampKeys);
            if (!candidate) {
              continue;
            }

            candidates.push({
              ...candidate,
              endpointRank: countChainNeighbors(chainColumnKeys, chainTile) <= 1 ? 0 : 1,
              separationFromExisting: existingAccessRamps.length
                ? Math.min(...existingAccessRamps.map((ramp) => (
                  Math.abs(ramp.x - chainTile.x) + Math.abs(ramp.z - chainTile.z)
                )))
                : 0,
            });
          }
        }

        candidates.sort((a, b) => {
          if (Math.abs(a.separationFromExisting - b.separationFromExisting) > 0.001) {
            return b.separationFromExisting - a.separationFromExisting;
          }
          if (a.endpointRank !== b.endpointRank) {
            return a.endpointRank - b.endpointRank;
          }
          return b.rampLength - a.rampLength;
        });

        const selected = [];
        for (const candidate of candidates) {
          if (selected.length >= missingRampCount) {
            break;
          }

          const tooClose = selected.some((placed) => (
            Math.abs(placed.chainTile.x - candidate.chainTile.x)
            + Math.abs(placed.chainTile.z - candidate.chainTile.z)
          ) < Math.max(4, candidate.rampLength));

          if (tooClose) {
            continue;
          }

          addRampRun(
            candidate.room,
            candidate.points,
            0,
            candidate.targetElevation,
            0,
            candidate.targetLevel,
          );

          for (let distance = 0; distance <= candidate.rampLength; distance += 1) {
            const start = candidate.points[0];
            const end = candidate.points[candidate.points.length - 1];
            const dx = Math.sign(end.x - start.x);
            const dz = Math.sign(end.z - start.z);
            occupiedRampKeys.add(tileKey(start.x + dx * distance, start.z + dz * distance));
          }

          selected.push(candidate);
        }
      }
    };
    const ensureUpperSocketOwnerAccess = () => {
      const occupiedRampKeys = new Set(
        getAllFloorTiles()
          .filter((tile) => tile.surface === 'industrialRamp')
          .map((tile) => tileKey(tile.x, tile.z)),
      );

      for (const plan of connectionPlans.filter((candidate) => candidate.level > 0)) {
        for (const socket of [plan.fromSocket, plan.toSocket]) {
          const room = roomById.get(socket.roomId);
          if (!room) {
            continue;
          }

          for (let repairAttempt = 0; repairAttempt < 3; repairAttempt += 1) {
            const allTiles = getAllFloorTiles();
            const blockingPlatforms = this._createBlockingPlatformColumnMap(allTiles);
            const localTiles = allTiles.filter((tile) => (
              this._isTileInsideRoom(tile, room)
              && !this._isFloorTileBlockedBySolidZone(tile, solidZones)
              && !this._isFloorTileBlockedByGeneratedPlatform(tile, blockingPlatforms)
            ));
            const start = this._findRoomWalkabilityStartTile(room, localTiles);
            const reachable = this._createReachableFloorTileKeySet(start, localTiles);
            if (reachable.has(socket.floorKey)) {
              break;
            }

            const seed = localTiles.find((tile) => this._getFloorTileGraphKey(tile) === socket.floorKey);
            if (!seed) {
              break;
            }
            const localColumns = this._createFloorTileLookup(localTiles);
            const component = [];
            const componentKeys = new Set([socket.floorKey]);
            const queue = [seed];
            for (let cursor = 0; cursor < queue.length; cursor += 1) {
              const current = queue[cursor];
              component.push(current);
              for (const [dx, dz] of DIRECTIONS) {
                for (const candidate of localColumns.get(tileKey(current.x + dx, current.z + dz)) ?? []) {
                  const candidateKey = this._getFloorTileGraphKey(candidate);
                  if (componentKeys.has(candidateKey)
                    || !this._canTraverseBetweenFloorTiles(current, candidate)) {
                    continue;
                  }
                  componentKeys.add(candidateKey);
                  queue.push(candidate);
                }
              }
            }

            const candidates = [];
            for (const chainTile of component.filter((tile) => (
              (tile.elevation ?? 0) > 0.05 && tile.surface !== 'industrialRamp'
            ))) {
              for (const direction of DIRECTIONS) {
                const candidate = createScaffoldRampCandidate(chainTile, direction, occupiedRampKeys);
                if (candidate) {
                  candidates.push(candidate);
                }
              }
            }
            candidates.sort((a, b) => (
              Math.abs(a.chainTile.x - socket.x) + Math.abs(a.chainTile.z - socket.z)
            ) - (
              Math.abs(b.chainTile.x - socket.x) + Math.abs(b.chainTile.z - socket.z)
            ));
            const selected = candidates[0];
            if (!selected) {
              break;
            }
            addRampRun(
              room,
              selected.points,
              0,
              selected.targetElevation,
              0,
              selected.targetLevel,
            );
            const startPoint = selected.points[0];
            const endPoint = selected.points[selected.points.length - 1];
            const dx = Math.sign(endPoint.x - startPoint.x);
            const dz = Math.sign(endPoint.z - startPoint.z);
            for (let distance = 0; distance <= selected.rampLength; distance += 1) {
              occupiedRampKeys.add(tileKey(startPoint.x + dx * distance, startPoint.z + dz * distance));
            }
          }
        }
      }
    };
    const ensureRoomScaffoldAccess = () => {
      const occupiedRampKeys = new Set(
        getAllFloorTiles()
          .filter((tile) => tile.surface === 'industrialRamp')
          .map((tile) => tileKey(tile.x, tile.z)),
      );

      for (const room of rooms.filter((candidate) => !RUIN_OPEN_AIR_ROOM_TYPES.has(candidate.type))) {
        for (let repairAttempt = 0; repairAttempt < 6; repairAttempt += 1) {
          const allTiles = getAllFloorTiles();
          const blockingPlatforms = this._createBlockingPlatformColumnMap(allTiles);
          const localTiles = allTiles.filter((tile) => (
            this._isTileInsideRoom(tile, room)
            && !this._isFloorTileBlockedBySolidZone(tile, solidZones)
            && !this._isFloorTileBlockedByGeneratedPlatform(tile, blockingPlatforms)
          ));
          const start = this._findRoomWalkabilityStartTile(room, localTiles);
          const reachable = this._createReachableFloorTileKeySet(start, localTiles);
          const seed = localTiles
            .filter((tile) => (
              isScaffoldAccessTile(tile)
              && !tile.isPlatformingSurface
              && !reachable.has(this._getFloorTileGraphKey(tile))
            ))
            .sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0))[0];
          if (!seed) {
            break;
          }

          const localColumns = this._createFloorTileLookup(localTiles);
          const seedKey = this._getFloorTileGraphKey(seed);
          const componentKeys = new Set([seedKey]);
          const component = [];
          const queue = [seed];
          for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const current = queue[cursor];
            component.push(current);
            for (const [dx, dz] of DIRECTIONS) {
              for (const candidate of localColumns.get(tileKey(current.x + dx, current.z + dz)) ?? []) {
                const candidateKey = this._getFloorTileGraphKey(candidate);
                if (componentKeys.has(candidateKey)
                  || reachable.has(candidateKey)
                  || !this._canTraverseBetweenFloorTiles(current, candidate)) {
                  continue;
                }
                componentKeys.add(candidateKey);
                queue.push(candidate);
              }
            }
          }

          const candidates = [];
          for (const chainTile of component.filter((tile) => isScaffoldAccessTile(tile))) {
            for (const direction of DIRECTIONS) {
              const candidate = createScaffoldRampCandidate(chainTile, direction, occupiedRampKeys);
              if (candidate) {
                candidates.push(candidate);
              }
            }
          }
          candidates.sort((a, b) => (
            a.targetElevation - b.targetElevation
            || a.rampLength - b.rampLength
          ));
          const selected = candidates[0];
          if (!selected) {
            break;
          }
          addRampRun(room, selected.points, 0, selected.targetElevation, 0, selected.targetLevel);
          const startPoint = selected.points[0];
          const endPoint = selected.points[selected.points.length - 1];
          const dx = Math.sign(endPoint.x - startPoint.x);
          const dz = Math.sign(endPoint.z - startPoint.z);
          for (let distance = 0; distance <= selected.rampLength; distance += 1) {
            occupiedRampKeys.add(tileKey(startPoint.x + dx * distance, startPoint.z + dz * distance));
          }
        }
      }
    };

    const enemyRoom = roomById.get('enemyNest');
    if (enemyRoom) {
      const halfW = Math.floor(enemyRoom.width / 2);
      const halfD = Math.floor(enemyRoom.depth / 2);
      addDeck(enemyRoom, {
        level: 1,
        elevation: RUIN_SECOND_FLOOR_ELEVATION,
        surface: 'secondFloor',
        minX: enemyRoom.x - halfW + 2,
        maxX: enemyRoom.x + halfW,
        minZ: enemyRoom.z + halfD - 2,
        maxZ: enemyRoom.z + halfD,
        supportStyle: 'solid_mass',
        massGroupId: `${enemyRoom.id}_rearStructuralMass`,
      });
      addRampRun(enemyRoom, [
        { x: enemyRoom.x - halfW + 1, z: enemyRoom.z - halfD + 1 },
        { x: enemyRoom.x - halfW + 1, z: enemyRoom.z + halfD - 3 },
      ], 0, RUIN_SECOND_FLOOR_ELEVATION, 0, 1);
    }

    const serverRoom = roomById.get('alienServerRoom');
    if (serverRoom) {
      const halfW = Math.floor(serverRoom.width / 2);
      const halfD = Math.floor(serverRoom.depth / 2);
      markBaseRect(serverRoom, {
        elevation: 0,
        level: 0,
        surface: 'serverCoreFloor',
        minX: serverRoom.x - 1,
        maxX: serverRoom.x + 1,
        minZ: serverRoom.z - 1,
        maxZ: serverRoom.z + 1,
      });
      addDeck(serverRoom, {
        level: 1,
        elevation: RUIN_SECOND_FLOOR_ELEVATION,
        surface: 'serverUpperCatwalk',
        minX: serverRoom.x - halfW + 2,
        maxX: serverRoom.x + halfW - 2,
        minZ: serverRoom.z - halfD + 1,
        maxZ: serverRoom.z - halfD + 2,
      });
      addDeck(serverRoom, {
        level: 1,
        elevation: RUIN_SECOND_FLOOR_ELEVATION,
        surface: 'serverUpperCatwalk',
        minX: serverRoom.x + halfW - 2,
        maxX: serverRoom.x + halfW - 2,
        minZ: serverRoom.z - halfD + 2,
        maxZ: serverRoom.z + halfD - 2,
      });
      const outerRampSide = (serverRoom.prefabYaw ?? 0) > 0 ? -1 : 1;
      const outerRampX = serverRoom.x + outerRampSide * (halfW - 1);
      addRampRun(serverRoom, [
        { x: outerRampX, z: serverRoom.z + halfD - 1 },
        { x: outerRampX, z: serverRoom.z - halfD + 2 },
      ], 0, RUIN_SECOND_FLOOR_ELEVATION, 0, 1);
    }

    const keycardRoom = roomById.get('keycardRoom');
    if (keycardRoom) {
      const halfW = Math.floor(keycardRoom.width / 2);
      const halfD = Math.floor(keycardRoom.depth / 2);
      const baseHalfExtent = Math.min(8, halfW - 3, halfD - 2);
      const stepRise = 0.5;
      const terraceCount = baseHalfExtent;
      const summitElevation = terraceCount * stepRise;
      const center = { x: keycardRoom.x, z: keycardRoom.z };
      const pyramidGroupId = `${keycardRoom.id}_grandMechanicalPyramid`;

      keycardRoom.mechanicalPyramidCenter = {
        ...center,
        elevation: summitElevation,
        baseHalfExtent,
        stepRise,
        terraceCount,
        summitHalfExtent: 1,
        platformGroupId: pyramidGroupId,
      };

      // A 17x17 stepped solid dominates the room. Each adjacent terrace rises
      // only 0.5m, so the processional face is genuinely walkable instead of
      // being a decorative mesh with a disconnected collision cap.
      for (let dx = -baseHalfExtent; dx <= baseHalfExtent; dx += 1) {
        for (let dz = -baseHalfExtent; dz <= baseHalfExtent; dz += 1) {
          const inset = Math.min(baseHalfExtent - Math.abs(dx), baseHalfExtent - Math.abs(dz));
          const terraceIndex = Math.min(terraceCount - 1, inset);
          const elevation = (terraceIndex + 1) * stepRise;
          const onSummit = Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
          const onProcessionalStair = Math.abs(dx) <= 1 && dz <= -1;
          markBase(center.x + dx, center.z + dz, {
            type: 'floor',
            elevation,
            level: Math.round((elevation / RUIN_SECOND_FLOOR_ELEVATION) * 100) / 100,
            surface: onSummit
              ? 'mechanicalPyramidSummit'
              : onProcessionalStair
                ? 'mechanicalPyramidProcessionalStep'
                : 'mechanicalPyramidTerrace',
            roomId: keycardRoom.id,
            supportStyle: 'solid_mass',
            massGroupId: `${pyramidGroupId}_terrace_${terraceIndex + 1}`,
            platformPurpose: onSummit
              ? 'keycard_pyramid_summit'
              : onProcessionalStair
                ? 'enemy_lined_processional_stair'
                : 'walkable_mayan_terrace',
            requiredTraversalAction: 'step',
            // Pyramid tiers remain below the camp's 1.1m smallest test ledge.
            // Player and ground enemies may traverse these 0.5m blocky steps
            // without entering a jump or falling state.
            groundedStepTransitionHeight: stepRise + 0.05,
            allowProgressionAccess: true,
          });
        }
      }

      // Faster optional side routes use chunky blocks with jump-height rises.
      // They deliberately flank, rather than replace, the central stair climb.
      for (const sign of [-1, 1]) {
        const sideRoute = [
          { x: center.x + sign * (baseHalfExtent + 1), z: center.z + 2, elevation: RUIN_JUMP_PLATFORM_ELEVATION },
          { x: center.x + sign * baseHalfExtent, z: center.z + 1, elevation: RUIN_JUMP_PLATFORM_ELEVATION * 2 },
          { x: center.x + sign * (baseHalfExtent - 1), z: center.z, elevation: summitElevation },
        ];
        for (const [index, point] of sideRoute.entries()) {
          markBase(point.x, point.z, {
            type: 'floor',
            elevation: point.elevation,
            level: 0.5 + index * 0.25,
            surface: 'mechanicalPyramidSidePlatform',
            roomId: keycardRoom.id,
            isPlatformingSurface: true,
            platformGroupId: `${pyramidGroupId}_side_${sign}_${index + 1}`,
            supportStyle: 'solid_mass',
            massGroupId: `${pyramidGroupId}_side_${sign}_${index + 1}`,
            platformPurpose: 'optional_side_platforming_ascent',
            requiredTraversalAction: 'jump',
            allowProgressionAccess: true,
          });
        }
      }
    }

    const trapRoom = roomById.get('trapRoom');
    if (trapRoom) {
      addMinorDropSpace(trapRoom, {
        id: `${trapRoom.id}_hazardDropSpace`,
        width: 9,
        depth: 9,
        purpose: 'descend_to_disable_hazard_processing_and_recover_by_climb_shelf',
      });
    }

    const coolantRoom = roomById.get('coolantRelayRoom');
    if (coolantRoom) {
      const halfW = Math.floor(coolantRoom.width / 2);
      const halfD = Math.floor(coolantRoom.depth / 2);
      markBaseRect(coolantRoom, {
        elevation: 0,
        level: 0,
        surface: 'coolantValveDeck',
        minX: coolantRoom.x - 4,
        maxX: coolantRoom.x + 4,
        minZ: coolantRoom.z - 3,
        maxZ: coolantRoom.z + 3,
      });
      markBaseRect(coolantRoom, {
        level: -1,
        elevation: -1.35,
        surface: 'coolantServicePit',
        minX: coolantRoom.x - 2,
        maxX: coolantRoom.x + 2,
        minZ: coolantRoom.z - 2,
        maxZ: coolantRoom.z + 2,
      });
      addDeck(coolantRoom, {
        level: 1,
        elevation: RUIN_SECOND_FLOOR_ELEVATION,
        surface: 'coolantControlBalcony',
        minX: coolantRoom.x - halfW + 5,
        maxX: coolantRoom.x + halfW - 5,
        minZ: coolantRoom.z - halfD + 1,
        maxZ: coolantRoom.z - halfD + 2,
      });
      // Keep this control deck inside the fixture-safe center span. The coolant
      // setpiece rotates with the room, so a fixed edge ramp can be severed by
      // a source tank after rotation. The obstacle-aware scaffold repair below
      // selects and commits one complete ground-to-balcony slope instead.
    }

    const conveyorRoom = roomById.get('conveyorRoom');
    if (conveyorRoom) {
      const halfW = Math.floor(conveyorRoom.width / 2);
      const halfD = Math.floor(conveyorRoom.depth / 2);
      for (let z = conveyorRoom.z - halfD; z <= conveyorRoom.z + halfD; z += 1) {
        pushExtra(conveyorRoom.x, z, {
          type: 'conveyor',
          elevation: RUIN_SECOND_FLOOR_ELEVATION,
          level: 1,
          surface: 'secondFloorConveyor',
          roomId: conveyorRoom.id,
          directionZ: Math.sign((conveyorRoom.z - z) || 1),
          speed: 1.65,
        });
      }
      addDeck(conveyorRoom, {
        level: 1,
        elevation: RUIN_SECOND_FLOOR_ELEVATION,
        surface: 'secondFloor',
        minX: conveyorRoom.x - halfW,
        maxX: conveyorRoom.x - halfW + 3,
        minZ: conveyorRoom.z - halfD,
        maxZ: conveyorRoom.z + halfD,
        supportStyle: 'solid_mass',
        massGroupId: `${conveyorRoom.id}_sideStructuralMass`,
      });
      addDeck(conveyorRoom, {
        level: 1,
        elevation: RUIN_SECOND_FLOOR_ELEVATION,
        surface: 'conveyorCrossBridge',
        minX: conveyorRoom.x - halfW + 2,
        maxX: conveyorRoom.x - 1,
        minZ: conveyorRoom.z,
        maxZ: conveyorRoom.z,
      });
      addDeck(conveyorRoom, {
        level: 2,
        elevation: RUIN_THIRD_FLOOR_ELEVATION,
        surface: 'thirdFloorGantry',
        minX: conveyorRoom.x - 4,
        maxX: conveyorRoom.x + 4,
        minZ: conveyorRoom.z + 2,
        maxZ: conveyorRoom.z + 3,
      });
      addRampRun(conveyorRoom, [
        { x: conveyorRoom.x + halfW - 1, z: conveyorRoom.z - halfD + 1 },
        { x: conveyorRoom.x + halfW - 1, z: conveyorRoom.z + halfD - 1 },
        { x: conveyorRoom.x + 2, z: conveyorRoom.z + halfD - 1 },
      ], 0, RUIN_SECOND_FLOOR_ELEVATION, 0, 1);
      addRampRun(conveyorRoom, [
        { x: conveyorRoom.x - halfW + 1, z: conveyorRoom.z + halfD - 2 },
        { x: conveyorRoom.x + 4, z: conveyorRoom.z + halfD - 2 },
        { x: conveyorRoom.x + 4, z: conveyorRoom.z + 3 },
      ], RUIN_SECOND_FLOOR_ELEVATION, RUIN_THIRD_FLOOR_ELEVATION, 1, 2);
    }

    const machineRoom = roomById.get('machineFactoryRoom');
    if (machineRoom) {
      const halfW = Math.floor(machineRoom.width / 2);
      const halfD = Math.floor(machineRoom.depth / 2);
      markBaseRect(machineRoom, {
        elevation: 0,
        level: 0,
        surface: 'machinePressZone',
        minX: machineRoom.x - 1,
        maxX: machineRoom.x + 1,
        minZ: machineRoom.z - 3,
        maxZ: machineRoom.z + 3,
      });
      addDeck(machineRoom, {
        level: 1,
        elevation: RUIN_SECOND_FLOOR_ELEVATION,
        surface: 'machineUpperCatwalk',
        minX: machineRoom.x - halfW + 1,
        maxX: machineRoom.x + halfW - 1,
        minZ: machineRoom.z - halfD + 1,
        maxZ: machineRoom.z - halfD + 2,
      });
      addDeck(machineRoom, {
        level: 1,
        elevation: RUIN_SECOND_FLOOR_ELEVATION,
        surface: 'machineCrossBridge',
        minX: machineRoom.x - halfW + 1,
        maxX: machineRoom.x + halfW - 1,
        minZ: machineRoom.z,
        maxZ: machineRoom.z,
      });
      addDeck(machineRoom, {
        level: 1,
        elevation: RUIN_SECOND_FLOOR_ELEVATION,
        surface: 'machineUpperCatwalk',
        minX: machineRoom.x - halfW + 1,
        maxX: machineRoom.x - halfW + 2,
        minZ: machineRoom.z - halfD + 2,
        maxZ: machineRoom.z + halfD - 2,
      });
      addDeck(machineRoom, {
        level: 1,
        elevation: RUIN_SECOND_FLOOR_ELEVATION,
        surface: 'machineUpperCatwalk',
        minX: machineRoom.x + halfW - 2,
        maxX: machineRoom.x + halfW - 1,
        minZ: machineRoom.z - halfD + 2,
        maxZ: machineRoom.z + halfD - 2,
      });
      addRampRun(machineRoom, [
        { x: machineRoom.x - halfW + 1, z: machineRoom.z + halfD - 1 },
        { x: machineRoom.x - halfW + 1, z: machineRoom.z - halfD + 3 },
      ], 0, RUIN_SECOND_FLOOR_ELEVATION, 0, 1);
    }

    const shrineRoom = roomById.get('shrineRoom');
    if (shrineRoom) {
      const halfW = Math.floor(shrineRoom.width / 2);
      const halfD = Math.floor(shrineRoom.depth / 2);
      addDeck(shrineRoom, {
        level: 1,
        elevation: RUIN_SECOND_FLOOR_ELEVATION,
        surface: 'reveredMezzanine',
        minX: shrineRoom.x - halfW,
        maxX: shrineRoom.x + halfW,
        minZ: shrineRoom.z - halfD,
        maxZ: shrineRoom.z + halfD,
        ring: true,
      });
      markBaseRect(shrineRoom, {
        level: 0,
        elevation: 0,
        surface: 'shrineSanctumFloor',
        minX: shrineRoom.x - 2,
        maxX: shrineRoom.x + 2,
        minZ: shrineRoom.z - 2,
        maxZ: shrineRoom.z + 2,
      });
      addDeck(shrineRoom, {
        level: 2,
        elevation: RUIN_THIRD_FLOOR_ELEVATION,
        surface: 'refractorDais',
        minX: shrineRoom.x - 2,
        maxX: shrineRoom.x + 2,
        minZ: shrineRoom.z - 2,
        maxZ: shrineRoom.z + 2,
        supportStyle: 'solid_mass',
        massGroupId: `${shrineRoom.id}_refractorSanctumMass`,
      });
      shrineRoom.refractorFocalPoint = {
        x: shrineRoom.x,
        z: shrineRoom.z,
        elevation: RUIN_THIRD_FLOOR_ELEVATION,
      };
      addRampRun(shrineRoom, [
        { x: shrineRoom.x - halfW + 1, z: shrineRoom.z - halfD + 1 },
        { x: shrineRoom.x - halfW + 1, z: shrineRoom.z + halfD - 1 },
      ], 0, RUIN_SECOND_FLOOR_ELEVATION, 0, 1);
      addRampRun(shrineRoom, [
        { x: shrineRoom.x + halfW - 1, z: shrineRoom.z + halfD - 1 },
        { x: shrineRoom.x + halfW - 1, z: shrineRoom.z - 2 },
        { x: shrineRoom.x + 2, z: shrineRoom.z - 2 },
      ], RUIN_SECOND_FLOOR_ELEVATION, RUIN_THIRD_FLOOR_ELEVATION, 1, 2);
    }

    const bonusRoom = roomById.get('bonusVault');
    if (bonusRoom) {
      markBaseRect(bonusRoom, {
        level: 0.1,
        elevation: 0.42,
        surface: 'vaultRewardDais',
        minX: bonusRoom.x - 1,
        maxX: bonusRoom.x + 1,
        minZ: bonusRoom.z - 1,
        maxZ: bonusRoom.z + 1,
        supportStyle: 'solid_mass',
        massGroupId: `${bonusRoom.id}_rewardDaisMass`,
      });
      bonusRoom.rewardFocalPoint = {
        x: bonusRoom.x,
        z: bonusRoom.z,
        elevation: 0.42,
      };
    }

    for (const connection of connectionPlans.filter((plan) => plan.level > 0)) {
      const path = connection.fullPath ?? [];
      const sourceRoomBaseElevation = Number(
        roomById.get(connection.fromRoomId)?.plannedBaseElevation
        ?? roomById.get(connection.fromRoomId)?.baseElevation
        ?? 0,
      );
      const connectionLocalElevation = Number(connection.sourceElevation ?? connection.elevation ?? 0)
        - sourceRoomBaseElevation;
      const crossSections = [];
      const footprintByKey = new Map();
      const exteriorIndexes = [];
      const getDirections = (index) => {
        const point = path[index];
        const directions = [];
        for (const neighbor of [path[index - 1], path[index + 1]]) {
          if (!neighbor) continue;
          const direction = {
            x: Math.sign(neighbor.x - point.x),
            z: Math.sign(neighbor.z - point.z),
          };
          if (Math.abs(direction.x) + Math.abs(direction.z) !== 1) continue;
          if (!directions.some((candidate) => (
            (candidate.x !== 0) === (direction.x !== 0)
          ))) directions.push(direction);
        }
        return directions;
      };
      const findUpperTile = (point) => getAllFloorTiles().find((tile) => (
        tile.x === point.x
        && tile.z === point.z
        && Math.abs((tile.elevation ?? 0) - connectionLocalElevation) <= 0.05
      )) ?? null;
      const ensureUpperTile = (point, isPortalLanding = false) => {
        const existing = findUpperTile(point);
        if (existing) return existing;
        const room = rooms.find((candidate) => this._isTileInsideRoom(point, candidate));
        return pushExtra(point.x, point.z, {
          type: 'floor',
          elevation: connectionLocalElevation,
          level: connection.level,
          surface: 'upperConnectionBridge',
          roomId: room?.id ?? null,
          connectionId: connection.id,
          isLedgeSurface: isPortalLanding,
          allowProgressionAccess: true,
          preserveProgressionOverpass: true,
          supportStyle: 'open_underpass',
          noEnemySpawn: true,
        });
      };
      const recordFootprint = (tile, pathIndex, role) => {
        if (!tile) return;
        const key = tileKey(tile.x, tile.z);
        const existing = footprintByKey.get(key);
        footprintByKey.set(key, {
          x: tile.x,
          z: tile.z,
          pathIndexes: [...new Set([...(existing?.pathIndexes ?? []), pathIndex])]
            .sort((a, b) => a - b),
          roles: [...new Set([...(existing?.roles ?? []), role])].sort(),
        });
      };

      for (let pathIndex = 0; pathIndex < path.length; pathIndex += 1) {
        const point = path[pathIndex];
        const isPortalLanding = [connection.fromSocket, connection.toSocket].some((socket) => (
          socket.x === point.x && socket.z === point.z
        ));
        const bridgeTile = ensureUpperTile(point, isPortalLanding);
        if (isPortalLanding && !bridgeTile) {
          const existingLanding = getAllFloorTiles().find((tile) => (
            tile.x === point.x
            && tile.z === point.z
            && Math.abs((tile.elevation ?? 0) - connectionLocalElevation) <= 0.05
          ));
          if (existingLanding) {
            existingLanding.isLedgeSurface = true;
            existingLanding.connectionId = connection.id;
          }
        }
        recordFootprint(bridgeTile, pathIndex, 'centerline');

        const insideAuthoredRoom = rooms.some((room) => this._isTileInsideRoom(point, room));
        if (insideAuthoredRoom) {
          continue;
        }

        const directions = getDirections(pathIndex);
        const sections = [];
        for (const direction of directions) {
          const perpendicular = { x: -direction.z, z: direction.x };
          const section = {
            direction: { ...direction },
            center: { ...point },
            galleryCenter: { ...point },
            laneOffsets: [-1, 0, 1],
            lateralPoints: [],
          };
          for (const offset of [-1, 1]) {
            const lanePoint = {
              x: point.x + perpendicular.x * offset,
              z: point.z + perpendicular.z * offset,
            };
            const laneTile = ensureUpperTile(lanePoint, isPortalLanding);
            recordFootprint(laneTile, pathIndex, 'minimum_width_lane');
            section.lateralPoints.push(lanePoint);
          }
          sections.push(section);
        }
        if (directions.length > 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            for (let dz = -1; dz <= 1; dz += 1) {
              if (dx === 0 && dz === 0) continue;
              const turnTile = ensureUpperTile({ x: point.x + dx, z: point.z + dz });
              recordFootprint(turnTile, pathIndex, 'turn_clearance');
            }
          }
        }
        crossSections.push({ pathIndex, sections });
        exteriorIndexes.push(pathIndex);
      }

      connection.galleryFootprintTiles = [...footprintByKey.values()]
        .sort((a, b) => a.x - b.x || a.z - b.z);
      connection.galleryCrossSections = crossSections;
      connection.minimumGalleryWidthTiles = CONNECTOR_GALLERY_MIN_WIDTH_TILES;
      connection.preferredGalleryWidthTiles = CONNECTOR_GALLERY_MIN_WIDTH_TILES;
      connection.connectorPresentation = {
        baseFamily: 'v1_arch_corridor',
        overlayFamily: 'v1_elevated_catwalk_bridge',
        preservesV1Corridor: true,
      };
      connection.classicV1ServiceBeats = [];
      const upperArchCandidates = exteriorIndexes.length >= 2
        ? exteriorIndexes
        : path.map((_, index) => index).filter((index) => (
            crossSections.find((section) => section.pathIndex === index)?.sections?.length
            && (path.length <= 3 || (index > 0 && index < path.length - 1))
          ));
      const selectedArchIndexes = [];
      if (upperArchCandidates.length) {
        selectedArchIndexes.push(upperArchCandidates[0]);
        const finalIndex = upperArchCandidates.at(-1);
        while (selectedArchIndexes.at(-1) < finalIndex) {
          const previous = selectedArchIndexes.at(-1);
          const next = upperArchCandidates.filter((index) => (
            index > previous && index <= previous + CONNECTOR_DECORATIVE_ARCH_INTERVAL_TILES
          )).at(-1) ?? upperArchCandidates.find((index) => index > previous);
          if (!Number.isFinite(next)) break;
          selectedArchIndexes.push(next);
        }
      }
      connection.decorativeArchBeats = [...new Set(selectedArchIndexes)].map((pathIndex, index) => {
        const section = crossSections.find((candidate) => candidate.pathIndex === pathIndex)
          ?.sections?.[0];
        const widthMeters = this.tileSize * this._connectorDecorativeArchWidthTiles(connection);
        const beat = {
          id: `${connection.id}:decorative-arch:${index}`,
          pathIndex,
          gridPoint: { ...(section?.galleryCenter ?? path[pathIndex]) },
          direction: { ...(section?.direction ?? { x: 0, z: 1 }) },
          widthMeters,
          internalClearWidthMeters: widthMeters - CONNECTOR_DECORATIVE_ARCH_COLUMN_HALF_SIZE * 2,
          laneCenterOffsetMeters: this.tileSize,
          visualFamily: 'v1_industrial_cylinder_arch',
        };
        return finalizeConnectorDecorativeArchBeat(beat, connectionLocalElevation);
      });
      connection.traversalFloorKeys = connection.galleryFootprintTiles
        .map((point) => findUpperTile(point))
        .filter(Boolean)
        .map((tile) => floorTileKey(tile.x, tile.z, tile.level ?? connection.level));

      for (const socket of [connection.fromSocket, connection.toSocket]) {
        const room = roomById.get(socket.roomId);
        if (!room) {
          continue;
        }
        connectSocketToLocalTier(room, socket, connection.id);
        if (room.id === 'alienServerRoom') {
          // The server crypt uses one deliberate outer-wall ramp. Do not stamp
          // a second socket-aligned slope across its monolith field. The later
          // collision-aware owner-access pass remains the fallback validator.
          continue;
        }
        const rampLength = Math.ceil(connectionLocalElevation / RUIN_RAMP_MAX_STEP);
        const perpendiculars = socket.facingX !== 0
          ? [{ x: 0, z: 1 }, { x: 0, z: -1 }]
          : [{ x: 1, z: 0 }, { x: -1, z: 0 }];
        let access = null;

        for (const perpendicular of perpendiculars) {
          for (const sideOffset of [3, 2]) {
            const top = {
              x: socket.x - socket.facingX + perpendicular.x * sideOffset,
              z: socket.z - socket.facingZ + perpendicular.z * sideOffset,
            };
            const bottom = {
              x: top.x - socket.facingX * rampLength,
              z: top.z - socket.facingZ * rampLength,
            };
            const rampPoints = expandRampPath([bottom, top]);
            const clear = rampPoints.length >= rampLength + 1 && rampPoints.every((point) => (
              this._isTileInsideRoom(point, room)
              && !progressionAccessTileKeys.has(tileKey(point.x, point.z))
              && !coolantFixtureTileKeys.has(tileKey(point.x, point.z))
            ));
            if (clear) {
              access = { top, bottom, perpendicular, sideOffset };
              break;
            }
          }
          if (access) {
            break;
          }
        }

        if (!access) {
          continue;
        }

        const inward = {
          x: socket.x - socket.facingX,
          z: socket.z - socket.facingZ,
        };
        const approach = [socket, inward];
        for (let offset = 1; offset < access.sideOffset; offset += 1) {
          approach.push({
            x: inward.x + access.perpendicular.x * offset,
            z: inward.z + access.perpendicular.z * offset,
          });
        }
        for (const point of approach) {
          pushExtra(point.x, point.z, {
            type: 'floor',
            elevation: connectionLocalElevation,
            level: connection.level,
            surface: 'rampLanding',
            roomId: room.id,
            connectionId: connection.id,
            allowProgressionAccess: true,
            preserveProgressionOverpass: true,
          });
        }
        addRampRun(
          room,
          [access.bottom, access.top],
          0,
          connectionLocalElevation,
          0,
          connection.level,
        );
      }
    }

    const platformPurposeByType = {
      entrance: 'route_readability_overlook',
      enemy: 'combat_flank_and_scrap_cache',
      keycard: 'required_keycard_pedestal',
      trap: 'safe_hazard_bypass',
      conveyor: 'routing_control_and_reward',
      boss: 'tactical_relocation',
      shrine: 'refractor_view_and_lore',
      server: 'lore_terminal_and_archive_cache',
      machine: 'maintenance_control_and_weapon_part',
      coolant: 'valve_control_and_keycard_cache',
      bonus: 'rare_salvage_cache',
    };
    for (const room of rooms.filter((candidate) => (
      !candidate.isDungeonSupplement
      && !candidate.suppressRoomGeometry
      && !RUIN_OPEN_AIR_ROOM_TYPES.has(candidate.type)
    ))) {
      if (getAllFloorTiles().some((tile) => tile.roomId === room.id && tile.isPlatformingSurface)) {
        continue;
      }
      const halfW = Math.floor(room.width / 2);
      const halfD = Math.floor(room.depth / 2);
      const cornerCandidates = [
        { x: room.x + halfW - 2, z: room.z + halfD - 2 },
        { x: room.x - halfW + 2, z: room.z + halfD - 2 },
        { x: room.x + halfW - 2, z: room.z - halfD + 2 },
        { x: room.x - halfW + 2, z: room.z - halfD + 2 },
      ];
      const interiorCandidates = [...tiles.values()]
        .filter((tile) => this._isTileInsideRoom(tile, room))
        .filter((tile) => Math.abs(tile.elevation ?? 0) <= 0.05)
        .filter((tile) => !RESERVED_FACTORY_SURFACE_TYPES.has(tile.type))
        .sort((a, b) => (
          Math.abs(b.x - room.x) + Math.abs(b.z - room.z)
        ) - (
          Math.abs(a.x - room.x) + Math.abs(a.z - room.z)
        ))
        .map((tile) => ({ x: tile.x, z: tile.z }));
      const candidates = [...new Map(
        [...cornerCandidates, ...interiorCandidates]
          .map((point) => [tileKey(point.x, point.z), point]),
      ).values()];

      for (const point of candidates) {
        const columnKey = tileKey(point.x, point.z);
        const adjacentBaseCount = DIRECTIONS.filter(([dx, dz]) => {
          const neighbor = tiles.get(tileKey(point.x + dx, point.z + dz));
          return neighbor && Math.abs(neighbor.elevation ?? 0) <= 0.05;
        }).length;
        if (
          adjacentBaseCount < 2
          || progressionAccessTileKeys.has(columnKey)
          || coolantFixtureTileKeys.has(columnKey)
        ) {
          continue;
        }

        const inwardX = point.x >= room.x ? -1 : 1;
        const inwardZ = point.z >= room.z ? -1 : 1;
        const footprint = [
          point,
          { x: point.x + inwardX, z: point.z },
          { x: point.x, z: point.z + inwardZ },
          { x: point.x + inwardX, z: point.z + inwardZ },
        ];
        const canPlaceFootprint = footprint.every((candidate) => (
          tiles.has(tileKey(candidate.x, candidate.z))
          && !progressionAccessTileKeys.has(tileKey(candidate.x, candidate.z))
          && !coolantFixtureTileKeys.has(tileKey(candidate.x, candidate.z))
          && !this._isFloorTileBlockedBySolidZone(
            tiles.get(tileKey(candidate.x, candidate.z)),
            solidZones,
          )
          && !getAllFloorTiles().some((tile) => (
            tile.x === candidate.x
            && tile.z === candidate.z
            && (Math.abs(tile.elevation ?? 0) > 0.05 || tile.surface === 'industrialRamp')
          ))
        ));
        if (!canPlaceFootprint) {
          continue;
        }
        const platformGroupId = `${room.id}_purposePlatform`;
        const placed = footprint.map((candidate) => pushExtra(candidate.x, candidate.z, {
          type: 'floor',
          elevation: RUIN_JUMP_PLATFORM_ELEVATION,
          level: 0.5,
          surface: 'solidPurposePlatform',
          roomId: room.id,
          isPlatformingSurface: true,
          platformGroupId,
          platformPurpose: platformPurposeByType[room.type] ?? 'optional_exploration_route',
          requiredTraversalAction: 'jump',
        })).filter(Boolean);
        if (placed.length === footprint.length) {
          break;
        }
      }
      if (!getAllFloorTiles().some((tile) => tile.roomId === room.id && tile.isPlatformingSurface)) {
        for (const point of candidates) {
          const columnKey = tileKey(point.x, point.z);
          if (progressionAccessTileKeys.has(columnKey) || coolantFixtureTileKeys.has(columnKey)) {
            continue;
          }
          if (this._isFloorTileBlockedBySolidZone(tiles.get(columnKey), solidZones)) {
            continue;
          }
          const hasRaisedOverlap = getAllFloorTiles().some((tile) => (
            tile.x === point.x
            && tile.z === point.z
            && (Math.abs(tile.elevation ?? 0) > 0.05 || tile.surface === 'industrialRamp')
          ));
          if (hasRaisedOverlap) {
            continue;
          }
          const platform = pushExtra(point.x, point.z, {
            type: 'floor',
            elevation: RUIN_JUMP_PLATFORM_ELEVATION,
            level: 0.5,
            surface: 'solidPurposePlatform',
            roomId: room.id,
            isPlatformingSurface: true,
            platformGroupId: `${room.id}_compactPurposePlatform`,
            platformPurpose: platformPurposeByType[room.type] ?? 'optional_exploration_route',
            requiredTraversalAction: 'jump',
          });
          if (platform) {
            break;
          }
        }
      }
    }

    const supplementLocalGridPoint = (room, localPoint = {}) => {
      const localX = Math.round(Number(localPoint.x ?? 0));
      const localZ = Math.round(Number(localPoint.z ?? 0));
      const turns = ((Math.trunc(Number(room.augmentationRotationQuarterTurns ?? 0)) % 4) + 4) % 4;
      if (turns === 1) return { x: room.x + localZ, z: room.z - localX };
      if (turns === 2) return { x: room.x - localX, z: room.z - localZ };
      if (turns === 3) return { x: room.x - localZ, z: room.z + localX };
      return { x: room.x + localX, z: room.z + localZ };
    };
    for (const room of rooms.filter((candidate) => candidate.isDungeonSupplement)) {
      const structure = room.augmentationStructure ?? {};
      const roomBaseElevation = Number(room.baseElevation ?? 0);
      const authoredRaisedFloorTiers = (room.augmentationFloorTiers ?? [])
        .filter((tier) => (
          Array.isArray(tier?.floorMask)
          && tier.floorMask.length > 0
          && Math.abs(Number(tier.elevation ?? 0)) > 0.05
        ));
      const authoredPlatformIds = new Set(authoredRaisedFloorTiers
        .map((tier) => tier.platformId)
        .filter(Boolean)
        .map(String));

      // V4 tier masks are physical records, not decoration metadata. Stamp
      // their exact occupied cells before presentation is assembled and let
      // the ordinary floor graph/collision validation prove every cell and
      // transfer. This deliberately replaces the grammar's coarse rectangular
      // platform proxy whenever both records name the same platform.
      for (const [tierIndex, tier] of authoredRaisedFloorTiers.entries()) {
        const rows = tier.floorMask.map((row) => String(row ?? ''));
        const origin = tier.maskOriginTile ?? {
          x: -Math.floor(Math.max(...rows.map((row) => row.length)) / 2),
          z: -Math.floor(rows.length / 2),
        };
        const tierElevation = roomBaseElevation + Number(tier.elevation ?? 0);
        const platformGroupId = String(
          tier.platformId ?? tier.id ?? `${room.id}:authored-tier:${tierIndex}`,
        );
        const tierRoute = (room.augmentationClearRoutes ?? []).find((route) => (
          (route.floorTierIds ?? []).map(String).includes(String(tier.id))
          && route.traversal !== 'walk'
        ));
        const authoritativeCells = tier.authoritative === true
          && Array.isArray(tier.worldCells)
          && tier.worldCells.length > 0
          ? tier.worldCells.map((cell) => ({
              point: {
                x: Number(cell?.grid?.x),
                z: Number(cell?.grid?.z),
              },
              elevation: Number(cell?.elevation ?? tier.worldElevation),
              id: cell?.id ?? null,
            }))
          : null;
        const fallbackCells = [];
        if (!authoritativeCells) {
          for (let row = 0; row < rows.length; row += 1) {
            for (let column = 0; column < rows[row].length; column += 1) {
              if (rows[row][column] !== '#') continue;
              fallbackCells.push({
                point: supplementLocalGridPoint(room, {
                  x: Number(origin.x ?? 0) + column,
                  z: Number(origin.z ?? 0) + row,
                }),
                elevation: tierElevation,
                id: null,
              });
            }
          }
        }
        const physicalTierCells = authoritativeCells ?? fallbackCells;
        if (physicalTierCells.some(({ point, elevation }) => (
          !Number.isInteger(point.x)
          || !Number.isInteger(point.z)
          || !Number.isFinite(elevation)
          || Math.abs(elevation - tierElevation) > 0.05
        ))) {
          throw new DungeonAugmentationIncompatibleContentError(
            `Supplement room ${room.id} has malformed authoritative raised-floor cells for tier ${tier.id ?? tierIndex}.`,
            {
              compatible: false,
              status: 'incompatible-content',
              resetOrAbandonRequired: true,
              roomId: room.id,
              floorTierRuntimeId: tier.runtimeId ?? null,
            },
          );
        }
        for (const { point, elevation, id: authoritativeFloorCellId } of physicalTierCells) {
            const tile = pushAuthoritativeSupplementExtra(room, point.x, point.z, {
              type: 'floor',
              elevation,
              level: Number(tier.level ?? (Number(tier.elevation ?? 0) > 1.5 ? 1 : 0.5)),
              surface: tier.surface ?? 'industrialSupplementTier',
              roomId: room.id,
              isPlatformingSurface: true,
              platformGroupId,
              platformPurpose: tier.platformPurpose ?? 'supplement_authored_floor_tier',
              requiredTraversalAction: tier.requiredTraversalAction
                ?? tierRoute?.traversal
                ?? 'step',
              supportBaseElevation: roomBaseElevation,
              augmentationFloorTierId: tier.id ?? null,
              augmentationFloorTierRuntimeId: tier.runtimeId ?? null,
              augmentationModuleTemplateId: room.augmentationModuleTemplateId ?? null,
              augmentationModuleKind: room.augmentationModuleKind ?? null,
              augmentationOwnerId: room.augmentationOperationId ?? room.id,
              augmentationBlueprintId: room.augmentationBlueprintId ?? null,
            });
            if (tile) {
              tile.dungeonSupplement = true;
              if (authoritativeFloorCellId) {
                tile.augmentationFloorCellId = authoritativeFloorCellId;
                tile.augmentationFloorTierRuntimeId = tier.runtimeId ?? null;
              }
            }
        }
      }
      const legacyStructureRamps = usesAuthoritativeSupplementGeometry(room)
        ? []
        : (structure.ramps ?? []);
      for (const [index, ramp] of legacyStructureRamps.entries()) {
        const from = supplementLocalGridPoint(
          room,
          ramp.localStartGrid ?? ramp.localStart ?? ramp.start,
        );
        const to = supplementLocalGridPoint(
          room,
          ramp.localEndGrid ?? ramp.localEnd ?? ramp.end,
        );
        const fromElevation = roomBaseElevation + Number(ramp.fromElevation ?? 0);
        const toElevation = roomBaseElevation + Number(ramp.toElevation ?? 2.8);
        addRampRun(
          room,
          [from, to],
          fromElevation,
          toElevation,
          Number(ramp.fromLevel ?? 0),
          Number(ramp.toLevel ?? 1),
        );
        room.supplementRampIds = [
          ...(room.supplementRampIds ?? []),
          ramp.id ?? `${room.id}:ramp:${index}`,
        ];
      }
      const legacyStructurePlatforms = usesAuthoritativeSupplementGeometry(room)
        ? []
        : (structure.platforms ?? []);
      for (const [index, platform] of legacyStructurePlatforms.entries()) {
        if (authoredPlatformIds.has(String(platform.id ?? ''))) continue;
        const center = supplementLocalGridPoint(
          room,
          platform.localCenterGrid ?? platform.localCenter ?? platform.center,
        );
        const widthTiles = Math.max(1, Math.trunc(Number(platform.widthTiles ?? 3)));
        const depthTiles = Math.max(1, Math.trunc(Number(platform.depthTiles ?? 3)));
        const minX = -Math.floor(widthTiles / 2);
        const maxX = minX + widthTiles - 1;
        const minZ = -Math.floor(depthTiles / 2);
        const maxZ = minZ + depthTiles - 1;
        const elevation = roomBaseElevation
          + Number(platform.elevation ?? RUIN_JUMP_PLATFORM_ELEVATION);
        const platformGroupId = platform.id ?? `${room.id}:supplement-platform:${index}`;
        for (let dx = minX; dx <= maxX; dx += 1) {
          for (let dz = minZ; dz <= maxZ; dz += 1) {
            const tile = pushExtra(center.x + dx, center.z + dz, {
              type: 'floor',
              elevation,
              level: Number(platform.level ?? (elevation > 1.5 ? 1 : 0.5)),
              surface: platform.surface ?? 'solidPurposePlatform',
              roomId: room.id,
              isPlatformingSurface: true,
              platformGroupId,
              platformPurpose: platform.platformPurpose ?? 'supplement_vertical_exploration',
              requiredTraversalAction: platform.requiredTraversalAction
                ?? (elevation <= RUIN_JUMP_PLATFORM_ELEVATION + 0.1 ? 'jump' : 'ramp'),
              supportBaseElevation: roomBaseElevation
                + Number(platform.supportBaseElevation ?? 0),
            });
            if (tile) tile.dungeonSupplement = true;
          }
        }
      }
    }

    this._clearProgressionAccessObstructions(tiles, extraTiles, progressionAccessTileKeys);
    addScaffoldAccessRamps();
    ensureRoomScaffoldAccess();
    ensureUpperSocketOwnerAccess();
    const scaffoldPriorityRoomIds = new Set(
      rooms.filter((room) => room.type === 'conveyor').map((room) => room.id),
    );
    this._clearRampScaffoldHeadroom(tiles, extraTiles, rooms, {
      preferScaffoldRoomIds: scaffoldPriorityRoomIds,
      seen,
    });

    return extraTiles;
  }

  _createTiledBoxGeometry(width, height, depth, tileWorldSize = this.tileSize) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const uv = geometry.getAttribute('uv');
    const safeTileSize = Math.max(0.1, tileWorldSize);
    const faceRepeats = [
      [depth / safeTileSize, height / safeTileSize],
      [depth / safeTileSize, height / safeTileSize],
      [width / safeTileSize, depth / safeTileSize],
      [width / safeTileSize, depth / safeTileSize],
      [width / safeTileSize, height / safeTileSize],
      [width / safeTileSize, height / safeTileSize],
    ];

    for (let face = 0; face < faceRepeats.length; face += 1) {
      const [repeatU, repeatV] = faceRepeats[face];
      for (let vertex = face * 4; vertex < face * 4 + 4; vertex += 1) {
        uv.setXY(vertex, uv.getX(vertex) * repeatU, uv.getY(vertex) * repeatV);
      }
    }
    uv.needsUpdate = true;
    geometry.userData.tiledTexture = true;
    geometry.userData.tileWorldSize = safeTileSize;
    geometry.userData.dimensions = { width, height, depth };
    return geometry;
  }

  _createFloorTileMesh(tile, materials) {
    const material = this._getFloorMaterialForTile(tile, materials);
    const elevation = tile.elevation ?? 0;
    const isRamp = tile.surface === 'industrialRamp'
      && Number.isFinite(tile.rampStartElevation)
      && Number.isFinite(tile.rampEndElevation);
    const geometry = new THREE.BoxGeometry(
      this.tileSize,
      0.12,
      this.tileSize,
    );
    const mesh = new THREE.Mesh(geometry, material);

    mesh.position.set(tile.x * this.tileSize, elevation - 0.06, tile.z * this.tileSize);

    if (isRamp) {
      const rise = tile.rampEndElevation - tile.rampStartElevation;
      const directionX = Math.sign(tile.rampDirectionX ?? 0);
      const directionZ = Math.sign(tile.rampDirectionZ ?? 0);
      const angle = Math.atan2(rise, this.tileSize);

      if (directionX !== 0) {
        mesh.rotation.z = directionX * angle;
      } else if (directionZ !== 0) {
        mesh.rotation.x = -directionZ * angle;
      }
    }

    return mesh;
  }

  _createFloorTileLookup(floorTiles) {
    const lookup = new Map();

    for (const tile of floorTiles) {
      const key = tileKey(tile.x, tile.z);
      const column = lookup.get(key) ?? [];
      column.push(tile);
      lookup.set(key, column);
    }

    for (const column of lookup.values()) {
      column.sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
    }

    return lookup;
  }

  _isTileInsideRoom(tile, room) {
    if (!tile || !room) {
      return false;
    }

    const halfW = Math.floor(room.width / 2);
    const halfD = Math.floor(room.depth / 2);
    return tile.x >= room.x - halfW
      && tile.x <= room.x + halfW
      && tile.z >= room.z - halfD
      && tile.z <= room.z + halfD;
  }

  _getRoomFloorTiles(room, floorTiles = []) {
    return floorTiles.filter((tile) => (
      tile.roomId === room.id
      || this._isTileInsideRoom(tile, room)
    ));
  }

  _floorTileToWorld(tile) {
    return new THREE.Vector3(
      tile.x * this.tileSize,
      tile.elevation ?? 0,
      tile.z * this.tileSize,
    );
  }

  _isGroundedPropTile(tile, room = null) {
    if (!tile) {
      return false;
    }

    if (tile.surface === 'industrialRamp' || tile.surface === 'rampLanding') {
      return false;
    }

    const roomBaseElevation = Number(
      room?.baseElevation
      ?? tile.roomBaseElevation
      ?? 0,
    );
    return Math.abs((tile.elevation ?? 0) - roomBaseElevation) <= 0.05;
  }

  _findRoomFloorTile(room, floorTiles = [], preferredSurfaces = [], {
    avoidKeys = new Set(),
    preferFarthest = false,
    groundedOnly = false,
  } = {}) {
    const surfaceRank = new Map(preferredSurfaces.map((surface, index) => [surface, index]));
    const candidates = this._getRoomFloorTiles(room, floorTiles)
      .filter((tile) => !avoidKeys.has(floorTileKey(tile.x, tile.z, tile.level ?? 0)))
      .filter((tile) => !groundedOnly || this._isGroundedPropTile(tile, room));

    if (!candidates.length) {
      return null;
    }

    candidates.sort((a, b) => {
      const rankA = surfaceRank.has(a.surface) ? surfaceRank.get(a.surface) : preferredSurfaces.length;
      const rankB = surfaceRank.has(b.surface) ? surfaceRank.get(b.surface) : preferredSurfaces.length;
      if (rankA !== rankB) {
        return rankA - rankB;
      }

      const distanceA = Math.abs(a.x - room.x) + Math.abs(a.z - room.z);
      const distanceB = Math.abs(b.x - room.x) + Math.abs(b.z - room.z);
      return preferFarthest ? distanceB - distanceA : distanceA - distanceB;
    });

    return candidates[0];
  }

  _getFloorTileGraphKey(tile) {
    return absoluteFloorTileKey(tile.x, tile.z, tile.elevation ?? 0);
  }

  _getFloorTileConnectionElevation(tile, dx, dz) {
    if (
      tile?.surface !== 'industrialRamp'
      || !Number.isFinite(tile.rampStartElevation)
      || !Number.isFinite(tile.rampEndElevation)
    ) {
      return tile?.elevation ?? 0;
    }

    const directionX = Math.sign(tile.rampDirectionX ?? 0);
    const directionZ = Math.sign(tile.rampDirectionZ ?? 0);
    const alongRamp = dx * directionX + dz * directionZ;

    if (alongRamp > 0) {
      return tile.rampEndElevation;
    }
    if (alongRamp < 0) {
      return tile.rampStartElevation;
    }

    return tile.elevation ?? 0;
  }

  _canTraverseBetweenFloorTiles(fromTile, toTile) {
    if (!fromTile || !toTile) {
      return false;
    }

    const dx = Math.abs(fromTile.x - toTile.x);
    const dz = Math.abs(fromTile.z - toTile.z);
    if ((dx + dz) !== 1) {
      return false;
    }

    const directionX = Math.sign(toTile.x - fromTile.x);
    const directionZ = Math.sign(toTile.z - fromTile.z);
    const fromElevation = this._getFloorTileConnectionElevation(fromTile, directionX, directionZ);
    const toElevation = this._getFloorTileConnectionElevation(toTile, -directionX, -directionZ);
    const elevationGap = Math.abs(fromElevation - toElevation);
    const usesRamp = fromTile.surface === 'industrialRamp' || toTile.surface === 'industrialRamp';
    return elevationGap <= (
      usesRamp
        ? PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile + 0.12
        : PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile
    );
  }

  _getTraversalActionBetweenFloorTiles(fromTile, toTile) {
    if (!fromTile || !toTile) {
      return null;
    }
    if (this._canTraverseBetweenFloorTiles(fromTile, toTile)) {
      return fromTile.surface === 'industrialRamp' || toTile.surface === 'industrialRamp'
        ? 'ramp'
        : 'walk';
    }

    const dx = Math.abs(fromTile.x - toTile.x);
    const dz = Math.abs(fromTile.z - toTile.z);
    if ((dx + dz) !== 1) {
      return null;
    }

    const directionX = Math.sign(toTile.x - fromTile.x);
    const directionZ = Math.sign(toTile.z - fromTile.z);
    const fromElevation = this._getFloorTileConnectionElevation(fromTile, directionX, directionZ);
    const toElevation = this._getFloorTileConnectionElevation(toTile, -directionX, -directionZ);
    const rise = toElevation - fromElevation;

    if (rise > 0 && rise <= PLAYER_TRAVERSAL_ENVELOPE.maximumNormalJumpRise) {
      return 'jump';
    }
    if (
      rise > 0
      && rise <= PLAYER_TRAVERSAL_ENVELOPE.maximumLedgeClimbRise
      && (toTile.isPlatformingSurface || toTile.isLedgeSurface)
    ) {
      return 'ledge_climb';
    }
    if (rise < 0 && Math.abs(rise) <= PLAYER_TRAVERSAL_ENVELOPE.safeDropHeight) {
      return 'drop';
    }

    return null;
  }

  _createReachableFloorTileKeySet(startTile, floorTiles = [], {
    canTraverseEdge = null,
  } = {}) {
    if (!startTile) {
      return new Set();
    }

    const columns = this._createFloorTileLookup(floorTiles);
    const tilesByGraphKey = new Map(
      floorTiles.map((tile) => [this._getFloorTileGraphKey(tile), tile]),
    );
    const startKey = this._getFloorTileGraphKey(startTile);
    // A local proof may only start from a tile that belongs to the exact tile
    // set being proved. Seeding with an unrelated overpass/underpass floor can
    // otherwise make the first key look reachable even though it is outside
    // the room or connector component under test.
    const ownedStartTile = tilesByGraphKey.get(startKey);
    if (!ownedStartTile) {
      return new Set();
    }
    const reachable = new Set([startKey]);
    const queue = [ownedStartTile];

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const neighborColumns = [
        ...DIRECTIONS.map(([dx, dz]) => [current.x + dx, current.z + dz]),
      ];

      for (const [x, z] of neighborColumns) {
        const candidates = columns.get(tileKey(x, z)) ?? [];
        for (const candidate of candidates) {
          const candidateKey = this._getFloorTileGraphKey(candidate);
          if (reachable.has(candidateKey)) {
            continue;
          }
          const traversalAction = this._getTraversalActionBetweenFloorTiles(
            current,
            candidate,
          );
          if (!traversalAction
            || (canTraverseEdge && !canTraverseEdge(current, candidate, traversalAction))) {
            continue;
          }

          reachable.add(candidateKey);
          queue.push(candidate);
        }
      }

      for (const link of current.traversalLinks ?? []) {
        const candidate = tilesByGraphKey.get(link.toFloorKey);
        if (!candidate) {
          continue;
        }
        const candidateKey = this._getFloorTileGraphKey(candidate);
        if (reachable.has(candidateKey)) {
          continue;
        }
        if (canTraverseEdge && !canTraverseEdge(
          current,
          candidate,
          link.action ?? 'link',
          link,
        )) {
          continue;
        }
        reachable.add(candidateKey);
        queue.push(candidate);
      }
    }

    return reachable;
  }

  _createFloorTileKeySetThatCanReach(targetTile, floorTiles = [], {
    canTraverseEdge = null,
  } = {}) {
    if (!targetTile) {
      return new Set();
    }

    const columns = this._createFloorTileLookup(floorTiles);
    const tilesByGraphKey = new Map(
      floorTiles.map((tile) => [this._getFloorTileGraphKey(tile), tile]),
    );
    const targetKey = this._getFloorTileGraphKey(targetTile);
    if (!tilesByGraphKey.has(targetKey)) {
      return new Set();
    }

    // Build the transpose of the directed traversal graph once. This proves
    // that every floor can return to an exact approach without repeatedly
    // flooding from each floor (and without treating a safe drop as a
    // bidirectional connection).
    const predecessors = new Map();
    const addPredecessor = (toKey, fromKey) => {
      const entries = predecessors.get(toKey) ?? new Set();
      entries.add(fromKey);
      predecessors.set(toKey, entries);
    };

    for (const current of tilesByGraphKey.values()) {
      const currentKey = this._getFloorTileGraphKey(current);
      for (const [dx, dz] of DIRECTIONS) {
        for (const candidate of columns.get(tileKey(current.x + dx, current.z + dz)) ?? []) {
          const candidateKey = this._getFloorTileGraphKey(candidate);
          if (!tilesByGraphKey.has(candidateKey)) {
            continue;
          }
          const traversalAction = this._getTraversalActionBetweenFloorTiles(current, candidate);
          if (!traversalAction
            || (canTraverseEdge && !canTraverseEdge(current, candidate, traversalAction))) {
            continue;
          }
          addPredecessor(candidateKey, currentKey);
        }
      }

      for (const link of current.traversalLinks ?? []) {
        const candidate = tilesByGraphKey.get(link.toFloorKey);
        if (!candidate) {
          continue;
        }
        if (canTraverseEdge && !canTraverseEdge(
          current,
          candidate,
          link.action ?? 'link',
          link,
        )) {
          continue;
        }
        addPredecessor(this._getFloorTileGraphKey(candidate), currentKey);
      }
    }

    const canReachTarget = new Set([targetKey]);
    const queue = [targetKey];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const predecessorKey of predecessors.get(queue[cursor]) ?? []) {
        if (canReachTarget.has(predecessorKey)) {
          continue;
        }
        canReachTarget.add(predecessorKey);
        queue.push(predecessorKey);
      }
    }
    return canReachTarget;
  }

  _findReachableRoomFloorTile(room, floorTiles = [], preferredSurfaces = [], {
    avoidKeys = new Set(),
    preferFarthest = false,
    groundedOnly = false,
  } = {}) {
    const blockingPlatforms = this._createBlockingPlatformColumnMap(floorTiles);
    const navigableFloorTiles = floorTiles.filter((tile) => (
      !this._isFloorTileBlockedByGeneratedPlatform(tile, blockingPlatforms)
    ));
    const roomTiles = this._getRoomFloorTiles(room, navigableFloorTiles);
    const startTile = this._findRoomFloorTile(room, roomTiles, []);
    const reachable = this._createReachableFloorTileKeySet(startTile, navigableFloorTiles);

    if (!reachable.size) {
      return null;
    }

    const surfaceRank = new Map(preferredSurfaces.map((surface, index) => [surface, index]));
    const candidates = roomTiles
      .filter((tile) => reachable.has(this._getFloorTileGraphKey(tile)))
      .filter((tile) => !avoidKeys.has(this._getFloorTileGraphKey(tile)))
      .filter((tile) => !groundedOnly || this._isGroundedPropTile(tile, room));

    if (!candidates.length) {
      return null;
    }

    candidates.sort((a, b) => {
      const rankA = surfaceRank.has(a.surface) ? surfaceRank.get(a.surface) : preferredSurfaces.length;
      const rankB = surfaceRank.has(b.surface) ? surfaceRank.get(b.surface) : preferredSurfaces.length;
      if (rankA !== rankB) {
        return rankA - rankB;
      }

      const distanceA = Math.abs(a.x - room.x) + Math.abs(a.z - room.z);
      const distanceB = Math.abs(b.x - room.x) + Math.abs(b.z - room.z);
      return preferFarthest ? distanceB - distanceA : distanceA - distanceB;
    });

    return candidates[0];
  }

  _findRoomWalkabilityStartTile(room, floorTiles = []) {
    const candidates = this._getRoomFloorTiles(room, floorTiles);
    if (!candidates.length) {
      return null;
    }

    candidates.sort((a, b) => {
      const roomBaseElevation = Number(room?.baseElevation ?? 0);
      const elevationA = Math.abs((a.elevation ?? 0) - roomBaseElevation);
      const elevationB = Math.abs((b.elevation ?? 0) - roomBaseElevation);
      if (Math.abs(elevationA - elevationB) > 0.001) {
        return elevationA - elevationB;
      }

      const distanceA = Math.abs(a.x - room.x) + Math.abs(a.z - room.z);
      const distanceB = Math.abs(b.x - room.x) + Math.abs(b.z - room.z);
      return distanceA - distanceB;
    });

    return candidates[0];
  }

  _enforceGeneratedWalkability(floorTiles = [], rooms = []) {
    for (const room of rooms) {
      if (!room || room.suppressRoomGeometry || RUIN_OPEN_AIR_ROOM_TYPES.has(room.type)) {
        continue;
      }

      const startTile = this._findRoomWalkabilityStartTile(room, floorTiles);
      if (!startTile) {
        continue;
      }

      const reachable = this._createReachableFloorTileKeySet(startTile, floorTiles);
      const roomTiles = this._getRoomFloorTiles(room, floorTiles);
      room.generatedTraversalCoverage = roomTiles.length
        ? roomTiles.filter((tile) => reachable.has(this._getFloorTileGraphKey(tile))).length / roomTiles.length
        : 0;
    }

    return floorTiles;
  }

  _createProgressionAccessTileKeys(tiles, rooms, connectionPlans = []) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const accessKeys = new Set();
    const addIfPresent = (x, z) => {
      const key = tileKey(x, z);
      if (tiles.has(key)) {
        accessKeys.add(key);
      }
    };
    const addClearance = (x, z, radius = 1) => {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (Math.abs(dx) + Math.abs(dz) > radius) {
            continue;
          }
          addIfPresent(x + dx, z + dz);
        }
      }
    };

    const groundPlanByPair = new Map(connectionPlans
      .filter((plan) => plan.level === 0)
      .map((plan) => [`${plan.fromRoomId}:${plan.toRoomId}`, plan]));
    for (const [fromRoomId, toRoomId] of PROGRESSION_CONNECTIONS) {
      const fromRoom = roomById.get(fromRoomId);
      const toRoom = roomById.get(toRoomId);
      if (!fromRoom || !toRoom) {
        continue;
      }

      const acceptedPlan = groundPlanByPair.get(`${fromRoomId}:${toRoomId}`);
      for (const point of acceptedPlan?.fullPath ?? this._buildOrthogonalPath(fromRoom, toRoom)) {
        const tile = tiles.get(tileKey(point.x, point.z));
        if (
          tile
          && !['keycardRoom', 'bonusVault'].includes(tile.roomId)
          && ['hallway', 'entrance', 'hub', 'camp'].includes(tile.type)
        ) {
          addClearance(point.x, point.z);
        }
      }

      const doorX = Math.round((fromRoom.x + toRoom.x) * 0.5);
      const doorZ = Math.round((fromRoom.z + toRoom.z) * 0.5);
      const midpointTile = tiles.get(tileKey(doorX, doorZ));
      if (!['keycardRoom', 'bonusVault'].includes(midpointTile?.roomId)) {
        addClearance(doorX, doorZ);
      }
    }

    return accessKeys;
  }

  _resetProgressionAccessTile(tile) {
    const wasRaised = Math.abs(tile.elevation ?? 0) > 0.05
      || Math.abs(tile.level ?? 0) > 0.05
      || tile.surface === 'industrialRamp'
      || tile.surface === 'rampLanding';

    tile.elevation = 0;
    tile.level = 0;
    if (wasRaised) {
      tile.surface = tile.type;
    }
    delete tile.rampStartElevation;
    delete tile.rampEndElevation;
    delete tile.rampDirectionX;
    delete tile.rampDirectionZ;
    delete tile.steepRamp;
    delete tile.supportStyle;
    delete tile.massGroupId;
    delete tile.isPlatformingSurface;
    delete tile.platformGroupId;
    delete tile.platformPurpose;
    delete tile.requiredTraversalAction;
  }

  _isClearProgressionOverpass(tile = {}) {
    const baseElevation = Number(tile.roomBaseElevation ?? 0);
    const surfaceElevations = [
      tile.elevation ?? 0,
      tile.rampStartElevation,
      tile.rampEndElevation,
    ].filter(Number.isFinite).map((elevation) => elevation - baseElevation);
    return Math.min(...surfaceElevations) >= RUIN_VERTICAL_OVERPASS_CLEARANCE;
  }

  _clearProgressionAccessObstructions(tiles, extraTiles, progressionAccessTileKeys) {
    if (!progressionAccessTileKeys?.size) {
      return;
    }

    for (const key of progressionAccessTileKeys) {
      const tile = tiles.get(key);
      const hasPreservedFooting = extraTiles.some((candidate) => (
        tileKey(candidate.x, candidate.z) === key
        && candidate.preserveProgressionFooting
      ));
      if (tile && !hasPreservedFooting) {
        this._resetProgressionAccessTile(tile);
      }
    }

    for (let index = extraTiles.length - 1; index >= 0; index -= 1) {
      const tile = extraTiles[index];
      const isClearOverpass = this._isClearProgressionOverpass(tile);
      if (
        progressionAccessTileKeys.has(tileKey(tile.x, tile.z))
        && !isClearOverpass
        && !tile.preserveProgressionFooting
      ) {
        extraTiles.splice(index, 1);
      }

    }
  }

  _getCoolantFixtureSpecs(room) {
    if (!room) {
      return [];
    }

    const halfW = Math.max(1.1, Math.floor(room.width / 2) * this.tileSize - 0.7);
    const halfD = Math.max(1.1, Math.floor(room.depth / 2) * this.tileSize - 0.7);
    return [
      {
        id: 'coolantCentralMachineBase',
        label: 'Central coolant machinery base',
        localX: 0,
        localZ: 0,
        halfWidth: 2.85,
        halfDepth: 2.25,
        verticalHalfHeight: 1.45,
      },
      {
        id: 'coolantPressureCore',
        label: 'Coolant pressure core',
        localX: 0,
        localZ: 0,
        halfWidth: 1.75,
        halfDepth: 1.75,
        verticalHalfHeight: 3.25,
      },
      {
        id: 'coolantSourceTankA',
        label: 'Coolant source tank',
        localX: -halfW * 0.74,
        localZ: -halfD * 0.68,
        halfWidth: 1.18,
        halfDepth: 1.18,
        verticalHalfHeight: 2.25,
      },
      {
        id: 'coolantSourceTankB',
        label: 'Coolant source tank',
        localX: halfW * 0.74,
        localZ: -halfD * 0.68,
        halfWidth: 1.18,
        halfDepth: 1.18,
        verticalHalfHeight: 2.25,
      },
      {
        id: 'coolantSourceTankC',
        label: 'Coolant source tank',
        localX: -halfW * 0.74,
        localZ: halfD * 0.68,
        halfWidth: 1.18,
        halfDepth: 1.18,
        verticalHalfHeight: 2.25,
      },
      {
        id: 'coolantOverflowTank',
        label: 'Coolant overflow tank',
        localX: halfW * 0.74,
        localZ: halfD * 0.68,
        halfWidth: 1.12,
        halfDepth: 1.12,
        verticalHalfHeight: 2.05,
      },
      {
        id: 'coolantValvePylonA',
        label: 'Coolant valve pylon',
        localX: -halfW * 0.34,
        localZ: -halfD * 0.08,
        halfWidth: 0.74,
        halfDepth: 0.74,
        verticalHalfHeight: 1.7,
      },
      {
        id: 'coolantValvePylonB',
        label: 'Coolant valve pylon',
        localX: halfW * 0.34,
        localZ: -halfD * 0.08,
        halfWidth: 0.74,
        halfDepth: 0.74,
        verticalHalfHeight: 1.7,
      },
      {
        id: 'coolantValvePylonC',
        label: 'Coolant valve pylon',
        localX: 0,
        localZ: halfD * 0.44,
        halfWidth: 0.74,
        halfDepth: 0.74,
        verticalHalfHeight: 1.7,
      },
      {
        id: 'coolantTerminalA',
        label: 'Coolant valve terminal',
        localX: -halfW * 0.44,
        localZ: halfD * 0.08,
        halfWidth: 0.86,
        halfDepth: 0.58,
        verticalHalfHeight: 1.1,
      },
      {
        id: 'coolantTerminalB',
        label: 'Coolant valve terminal',
        localX: halfW * 0.44,
        localZ: halfD * 0.08,
        halfWidth: 0.86,
        halfDepth: 0.58,
        verticalHalfHeight: 1.1,
      },
      {
        id: 'coolantTerminalC',
        label: 'Coolant valve terminal',
        localX: 0,
        localZ: halfD * 0.66,
        halfWidth: 0.86,
        halfDepth: 0.58,
        verticalHalfHeight: 1.1,
      },
      {
        id: 'coolantMasterConsole',
        label: 'Master pressure console',
        localX: 0,
        localZ: -halfD * 0.82,
        halfWidth: 0.95,
        halfDepth: 0.52,
        verticalHalfHeight: 1.0,
        elevation: ENABLE_PROCEDURAL_RAISED_ROOM_LEVELS ? RUIN_SECOND_FLOOR_ELEVATION : 0,
        blocksScaffold: false,
      },
    ];
  }

  _worldToRoomLocal(room, worldX, worldZ) {
    const dx = worldX - room.x * this.tileSize;
    const dz = worldZ - room.z * this.tileSize;
    const rotationY = room.prefabYaw ?? 0;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);

    return {
      x: dx * cos + dz * sin,
      z: -dx * sin + dz * cos,
    };
  }

  _isTileInsideRoomLocalRect(tile, room, spec, padding = 0) {
    const local = this._worldToRoomLocal(
      room,
      tile.x * this.tileSize,
      tile.z * this.tileSize,
    );

    return Math.abs(local.x - spec.localX) <= spec.halfWidth + padding
      && Math.abs(local.z - spec.localZ) <= spec.halfDepth + padding;
  }

  _createCoolantFixtureTileKeys(tiles, rooms, padding = this.tileSize * 0.24) {
    const room = rooms.find((candidate) => candidate.id === 'coolantRelayRoom');
    if (!room) {
      return new Set();
    }

    const fixtureSpecs = this._getCoolantFixtureSpecs(room)
      .filter((spec) => spec.blocksScaffold !== false);
    const keys = new Set();

    for (const tile of tiles.values()) {
      if (!this._isTileInsideRoom(tile, room)) {
        continue;
      }
      if (fixtureSpecs.some((spec) => this._isTileInsideRoomLocalRect(tile, room, spec, padding))) {
        keys.add(tileKey(tile.x, tile.z));
      }
    }

    return keys;
  }

  _isPositionInsideZone(position, zone, { ignoreVertical = false } = {}) {
    let localX = position.x - zone.position.x;
    let localZ = position.z - zone.position.z;

    if (Number.isFinite(zone.rotationY) && Math.abs(zone.rotationY) > 0.0001) {
      const cos = Math.cos(zone.rotationY);
      const sin = Math.sin(zone.rotationY);
      const rotatedX = localX * cos + localZ * sin;
      const rotatedZ = -localX * sin + localZ * cos;
      localX = rotatedX;
      localZ = rotatedZ;
    }

    if (Math.abs(localX) > zone.halfWidth || Math.abs(localZ) > zone.halfDepth) {
      return false;
    }

    if (!ignoreVertical && Number.isFinite(zone.verticalHalfHeight)) {
      return Math.abs((position.y ?? 0) - (zone.position.y ?? 0)) <= zone.verticalHalfHeight;
    }

    return true;
  }

  _isFloorTileBlockedBySolidZone(tile, solidZones = []) {
    const position = this._floorTileToWorld(tile);
    return solidZones.some((zone) => this._isPositionInsideZone(position, zone));
  }

  _createBlockingPlatformColumnMap(floorTiles = []) {
    const blockingTops = new Map();
    for (const tile of floorTiles.filter((candidate) => (
      candidate.isPlatformingSurface
      || candidate.surface === 'basementReturnShelf'
      || isSolidArchitecturalDeckTile(candidate)
    ))) {
      const key = tileKey(tile.x, tile.z);
      blockingTops.set(key, Math.max(blockingTops.get(key) ?? -Infinity, tile.elevation ?? 0));
    }
    return blockingTops;
  }

  _isFloorTileBlockedByGeneratedPlatform(tile, blockingTops = new Map()) {
    if (tile?.blockedBySolidLedgeSupport) {
      return true;
    }
    if (
      !tile
      || tile.isPlatformingSurface
      || tile.surface === 'basementReturnShelf'
      || isSolidArchitecturalDeckTile(tile)
    ) {
      return false;
    }
    const topY = blockingTops.get(tileKey(tile.x, tile.z));
    if (!Number.isFinite(topY)) {
      return false;
    }
    const elevation = tile.elevation ?? 0;
    const verticalGap = topY - elevation;
    return verticalGap > 0.06
      && verticalGap < PLAYER_TRAVERSAL_ENVELOPE.headClearance + 0.12;
  }

  _isFloorTileBlockedByDoor(tile, door) {
    if (!tile || !door?.position) {
      return false;
    }

    const position = this._floorTileToWorld(tile);
    const blockingPosition = door.graphBlockingPosition ?? door.position;
    const playerRadius = PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
    const halfWidth = (door.collisionHalfWidth ?? (door.alongX ? 0.16 : this.tileSize * 0.48)) + playerRadius;
    const halfDepth = (door.collisionHalfDepth ?? (door.alongX ? this.tileSize * 0.48 : 0.16)) + playerRadius;
    const baseY = door.baseY ?? door.position.y ?? 0;
    const height = door.collisionHeight ?? RUIN_DOOR_HEIGHT;

    return Math.abs(position.x - blockingPosition.x) <= halfWidth
      && Math.abs(position.z - blockingPosition.z) <= halfDepth
      && position.y >= baseY - PLAYER_TRAVERSAL_ENVELOPE.groundedStepDownHeight
      && position.y <= baseY + height;
  }

  _doesFloorTraversalSegmentIntersectZone(fromTile, toTile, zone, padding = 0) {
    if (!fromTile || !toTile || !zone?.position) return false;
    const from = this._floorTileToWorld(fromTile);
    const to = this._floorTileToWorld(toTile);
    const toLocal = (point) => {
      const dx = point.x - Number(zone.position.x ?? 0);
      const dz = point.z - Number(zone.position.z ?? 0);
      const rotationY = Number(zone.rotationY ?? 0);
      if (Math.abs(rotationY) <= 0.0001) return { x: dx, y: point.y, z: dz };
      const cos = Math.cos(rotationY);
      const sin = Math.sin(rotationY);
      return {
        x: dx * cos + dz * sin,
        y: point.y,
        z: -dx * sin + dz * cos,
      };
    };
    const halfWidth = Number(zone.halfWidth ?? 0) + Math.max(0, padding);
    const halfDepth = Number(zone.halfDepth ?? 0) + Math.max(0, padding);
    const intersectsSegment = (worldStart, worldEnd) => {
      const start = toLocal(worldStart);
      const end = toLocal(worldEnd);
      const slabs = [
        { start: start.x, end: end.x, minimum: -halfWidth, maximum: halfWidth },
        { start: start.z, end: end.z, minimum: -halfDepth, maximum: halfDepth },
      ];
      if (Number.isFinite(zone.verticalHalfHeight)) {
        const zoneCenterY = Number(zone.position.y ?? 0);
        const verticalHalfHeight = Number(zone.verticalHalfHeight);
        slabs.push({
          start: Number(start.y ?? 0),
          end: Number(end.y ?? 0),
          // Floor elevations represent the player's feet. A solid intersects
          // the standing envelope when its top is above the feet and its base
          // is below the head. The small margin permits exact floor/fascia and
          // ceiling contacts without treating them as walls.
          minimum: zoneCenterY
            - verticalHalfHeight
            - PLAYER_TRAVERSAL_ENVELOPE.headClearance
            + CONNECTOR_APERTURE_VERTICAL_MARGIN,
          maximum: zoneCenterY
            + verticalHalfHeight
            - CONNECTOR_APERTURE_VERTICAL_MARGIN,
        });
      }
      let minimumT = 0;
      let maximumT = 1;
      for (const slab of slabs) {
        const origin = slab.start;
        const delta = slab.end - origin;
        if (Math.abs(delta) <= 1e-8) {
          if (origin < slab.minimum || origin > slab.maximum) return false;
          continue;
        }
        const firstT = (slab.minimum - origin) / delta;
        const secondT = (slab.maximum - origin) / delta;
        const entryT = Math.min(firstT, secondT);
        const exitT = Math.max(firstT, secondT);
        minimumT = Math.max(minimumT, entryT);
        maximumT = Math.min(maximumT, exitT);
        if (minimumT > maximumT) return false;
      }
      return maximumT >= 0 && minimumT <= 1;
    };

    const tileDeltaX = Math.sign(Number(toTile.x) - Number(fromTile.x));
    const tileDeltaZ = Math.sign(Number(toTile.z) - Number(fromTile.z));
    const adjacent = Math.abs(Number(toTile.x) - Number(fromTile.x))
      + Math.abs(Number(toTile.z) - Number(fromTile.z)) === 1;
    if (adjacent && (fromTile.surface === 'industrialRamp' || toTile.surface === 'industrialRamp')) {
      // Ramp tile elevations are measured at tile centers. Test the two halves
      // against their authored shared-edge elevation so a fascia beneath a
      // descending ramp cannot masquerade as a full-height blocking wall.
      const seam = new THREE.Vector3(
        (from.x + to.x) * 0.5,
        (
          Number(this._getFloorTileConnectionElevation(fromTile, tileDeltaX, tileDeltaZ))
          + Number(this._getFloorTileConnectionElevation(toTile, -tileDeltaX, -tileDeltaZ))
        ) * 0.5,
        (from.z + to.z) * 0.5,
      );
      const zoneTopY = Number(zone.position.y ?? 0)
        + Number(zone.verticalHalfHeight ?? 0);
      const zoneHeight = Number(zone.verticalHalfHeight ?? 0) * 2;
      if (
        zone.obstacleKind === 'boundaryWall'
        && Number.isFinite(zone.verticalHalfHeight)
        && (
          zoneTopY <= seam.y + CONNECTOR_APERTURE_VERTICAL_MARGIN
          || zoneHeight <= (
            PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile
            + CONNECTOR_APERTURE_VERTICAL_MARGIN
          )
        )
      ) {
        return false;
      }
      return intersectsSegment(from, seam) || intersectsSegment(seam, to);
    }
    return intersectsSegment(from, to);
  }

  _validateCriticalDoorChokepoints({
    floorTiles = [],
    rooms = [],
    solidZones = [],
    doors = [],
    useSegmentBarriers = false,
  } = {}) {
    const errors = [];
    const checks = [];
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const startRoom = roomById.get('hubTown') ?? roomById.get('expeditionCamp') ?? rooms[0];
    const criticalDoors = doors.filter((door) => door.closed && door.locked);
    const blockingPlatformTops = this._createBlockingPlatformColumnMap(floorTiles);

    for (const door of criticalDoors) {
      if (!door.thresholdAnchored) {
        errors.push(`${door.id} is not anchored to its source-room corridor threshold.`);
      }
      const thresholdSides = new Set(
        (door.thresholdWallZones ?? []).map((zone) => zone.thresholdSide),
      );
      if (!thresholdSides.has('left') || !thresholdSides.has('right')) {
        errors.push(`${door.id} does not retain threshold wall coverage on both sides.`);
      }
      const traversableTiles = floorTiles.filter((tile) => (
        !this._isFloorTileBlockedBySolidZone(tile, solidZones)
        && !this._isFloorTileBlockedByGeneratedPlatform(tile, blockingPlatformTops)
        && !this._isFloorTileBlockedByDoor(tile, door)
      ));
      const startTile = this._findRoomWalkabilityStartTile(startRoom, traversableTiles);
      const doorBarrierZones = useSegmentBarriers
        ? [
            ...(door.thresholdWallZones ?? []),
            {
              position: door.graphBlockingPosition ?? door.position,
              halfWidth: door.collisionHalfWidth
                ?? (door.alongX ? 0.16 : this.tileSize * 0.48),
              halfDepth: door.collisionHalfDepth
                ?? (door.alongX ? this.tileSize * 0.48 : 0.16),
              verticalHalfHeight: (door.collisionHeight ?? RUIN_DOOR_HEIGHT) * 0.5,
              baseY: door.baseY ?? door.position.y ?? 0,
            },
          ].map((zone) => (
            Object.hasOwn(zone, 'baseY')
              ? {
                  ...zone,
                  position: new THREE.Vector3(
                    Number(zone.position.x ?? 0),
                    Number(zone.baseY) + Number(zone.verticalHalfHeight ?? 0),
                    Number(zone.position.z ?? 0),
                  ),
                }
              : zone
          ))
        : [];
      const reachable = this._createReachableFloorTileKeySet(
        startTile,
        traversableTiles,
        useSegmentBarriers ? {
          canTraverseEdge: (fromTile, toTile) => !doorBarrierZones.some((zone) => (
            this._doesFloorTraversalSegmentIntersectZone(
              fromTile,
              toTile,
              zone,
              PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
            )
          )),
        } : {},
      );
      const fromRoom = roomById.get(door.fromRoomId);
      const toRoom = roomById.get(door.toRoomId);
      const fromTile = this._findRoomWalkabilityStartTile(fromRoom, traversableTiles);
      const toTile = this._findRoomWalkabilityStartTile(toRoom, traversableTiles);
      const sourceReachable = Boolean(fromTile && reachable.has(this._getFloorTileGraphKey(fromTile)));
      const destinationReachable = Boolean(toTile && reachable.has(this._getFloorTileGraphKey(toTile)));

      if (!sourceReachable) {
        errors.push(`${door.id} is placed before its own reachable source side.`);
      }
      if (destinationReachable) {
        errors.push(`${door.id} can be bypassed through alternate floor or platform routes.`);
      }

      checks.push({
        doorId: door.id,
        fromRoomId: door.fromRoomId,
        toRoomId: door.toRoomId,
        sourceBand: roomById.get(door.fromRoomId)?.progressionBand
          ?? PROGRESSION_ROOM_BANDS[door.fromRoomId]
          ?? null,
        destinationBand: roomById.get(door.toRoomId)?.progressionBand
          ?? PROGRESSION_ROOM_BANDS[door.toRoomId]
          ?? null,
        sourceReachable,
        destinationReachableWhileClosed: destinationReachable,
        thresholdAnchored: Boolean(door.thresholdAnchored),
        thresholdWallWingCount: door.thresholdWallZones?.length ?? 0,
        blockedTraversalNodeCount: floorTiles.length - traversableTiles.length,
      });
    }

    return {
      accepted: errors.length === 0,
      errors,
      warnings: errors.length ? [] : [
        `Validated ${checks.length} critical doors as physical progression chokepoints.`,
      ],
      details: {
        checkedDoorCount: checks.length,
        checks,
      },
    };
  }

  _validateProgressionAccess(floorTiles = [], tiles = new Map(), rooms = [], connectionPlans = []) {
    const progressionAccessTileKeys = this._createProgressionAccessTileKeys(tiles, rooms, connectionPlans);
    const variedConnectionIds = new Set(connectionPlans
      .filter((plan) => plan.connectorVariant?.traversalKind !== 'walk')
      .map((plan) => plan.id));
    const floorTilesByColumn = this._createFloorTileLookup(floorTiles);
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const errors = [];
    const blockingPlatforms = this._createBlockingPlatformColumnMap(floorTiles);
    const navigableFloorTiles = floorTiles.filter((tile) => (
      !this._isFloorTileBlockedByGeneratedPlatform(tile, blockingPlatforms)
    ));

    for (const key of progressionAccessTileKeys) {
      const [xText, zText] = key.split(',');
      const x = Number(xText);
      const z = Number(zText);
      const column = floorTilesByColumn.get(key) ?? [];
      const structuralColumn = tiles.get(key);
      if (!column.length
        && structuralColumn?.structuralEnvelopeOnly
        && structuralColumn.connectionId) {
        // Lift/ladder apertures and the gap between switchback flights are
        // deliberately floorless. They remain enclosed structural columns,
        // but are not progression footing in their own right.
        continue;
      }
      const declaredConnectorFloor = column.find((candidate) => (
        candidate.connectionId
        && connectionPlans.some((plan) => plan.id === candidate.connectionId)
        && candidate.surface !== 'connectorStructuralEnvelope'
      ));
      if (declaredConnectorFloor) {
        continue;
      }
      const ownerRoom = roomById.get(tiles.get(key)?.roomId);
      const expectedBaseElevation = Number(ownerRoom?.baseElevation ?? 0);
      const baseTile = column.find((tile) => (
        Math.abs((tile.elevation ?? 0) - expectedBaseElevation) <= 0.05
        && tile.surface !== 'industrialRamp'
        && tile.surface !== 'rampLanding'
      ));
      const hasPreservedFooting = column.some((candidate) => (
        candidate.preserveProgressionFooting
        && Math.abs((candidate.elevation ?? 0) - expectedBaseElevation) <= 0.05
      ));
      // The legacy clearance audit predates authored connector traversal and
      // requires every critical corridor column to remain flat at y=0. A
      // varied connector intentionally replaces only its transfer-run columns
      // with a continuous slope or a validated ladder/lift link. Keep the old
      // rule at sockets and door thresholds, while letting the combined graph
      // and platformability passes prove these explicitly owned transfers.
      const isVariedConnectorTransfer = column.some((candidate) => (
        variedConnectionIds.has(candidate.connectionId)
        && (
          candidate.surface === 'industrialRamp'
          || candidate.surface === 'upperConnectionBridge'
        )
      ));
      if (isVariedConnectorTransfer) {
        continue;
      }
      const elevatedBlocker = column.find((tile) => {
        const candidateLowestElevation = Math.min(
          Number(tile.elevation ?? expectedBaseElevation),
          Number(tile.rampStartElevation ?? tile.elevation ?? expectedBaseElevation),
          Number(tile.rampEndElevation ?? tile.elevation ?? expectedBaseElevation),
        );
        return (
        (tile.surface === 'industrialRamp'
          || tile.surface === 'rampLanding'
          || candidateLowestElevation > expectedBaseElevation + 0.05)
        && !(
          this._isClearProgressionOverpass(tile)
        )
        && !(hasPreservedFooting && tile.dropSpaceId && (tile.elevation ?? 0) < expectedBaseElevation - 0.05)
      );
      });

      if (!baseTile) {
        errors.push(`Progression access tile ${x},${z} has no clear base-floor footing.`);
      }
      if (elevatedBlocker) {
        errors.push(`Progression access tile ${x},${z} is obstructed by ${elevatedBlocker.surface ?? elevatedBlocker.type}.`);
      }
    }

    const startRoom = roomById.get('hubTown') ?? roomById.get('expeditionCamp') ?? rooms[0];
    const startTile = this._findRoomWalkabilityStartTile(startRoom, navigableFloorTiles);
    const reachable = this._createReachableFloorTileKeySet(startTile, navigableFloorTiles);
    const progressionRoomIds = new Set(PROGRESSION_CONNECTIONS.flatMap(([fromRoomId, toRoomId]) => [
      fromRoomId,
      toRoomId,
    ]));

    for (const roomId of progressionRoomIds) {
      const room = roomById.get(roomId);
      if (!room) {
        continue;
      }

      const roomStartTile = this._findRoomWalkabilityStartTile(room, navigableFloorTiles);
      if (!roomStartTile) {
        errors.push(`Progression room ${roomId} has no walkable floor tile.`);
        continue;
      }
      if (!reachable.has(this._getFloorTileGraphKey(roomStartTile))) {
        errors.push(`Progression room ${roomId} is not reachable from the dungeon start.`);
      }
    }

    return {
      accepted: errors.length === 0,
      errors,
      warnings: errors.length ? [] : ['Progression access geometry validated successfully.'],
    };
  }

  _validateCoolantRoomWalkability(floorTiles = [], tiles = new Map(), rooms = [], solidZones = []) {
    const room = rooms.find((candidate) => candidate.id === 'coolantRelayRoom');
    if (!room) {
      return { accepted: true, errors: [], warnings: [] };
    }

    const errors = [];
    const warnings = [];
    const fixtureTileKeys = this._createCoolantFixtureTileKeys(tiles, rooms);
    const roomTiles = this._getRoomFloorTiles(room, floorTiles);
    const blockingPlatformTops = this._createBlockingPlatformColumnMap(floorTiles);
    const navigableTiles = roomTiles.filter((tile) => (
      !fixtureTileKeys.has(tileKey(tile.x, tile.z))
      && !this._isFloorTileBlockedBySolidZone(tile, solidZones)
      && !this._isFloorTileBlockedByGeneratedPlatform(tile, blockingPlatformTops)
    ));

    const roomBaseElevation = Number(room.baseElevation ?? 0);
    const startTile = [...navigableTiles].sort((a, b) => {
      const elevationA = Math.abs((a.elevation ?? 0) - roomBaseElevation);
      const elevationB = Math.abs((b.elevation ?? 0) - roomBaseElevation);
      if (Math.abs(elevationA - elevationB) > 0.001) {
        return elevationA - elevationB;
      }

      const distanceA = Math.abs(a.x - room.x) + Math.abs(a.z - room.z);
      const distanceB = Math.abs(b.x - room.x) + Math.abs(b.z - room.z);
      return distanceA - distanceB;
    })[0] ?? null;

    if (!startTile) {
      errors.push('Coolant room has no unobstructed walkability start tile.');
    }

    const reachable = this._createReachableFloorTileKeySet(startTile, navigableTiles);
    for (const tile of navigableTiles) {
      const key = this._getFloorTileGraphKey(tile);
      if (!reachable.has(key)) {
        const requiredTraversalSurface = tile.surface === 'industrialRamp'
          || tile.allowProgressionAccess
          || tile.requiredForProgression
          || tile.requiredTraversalAction;
        (requiredTraversalSurface ? errors : warnings).push(
          `Coolant room ${requiredTraversalSurface ? 'required ' : 'optional '}tile ${key} is not reachable from the room floor.`,
        );
      }
      if (tile.surface === 'industrialRamp' && tile.steepRamp) {
        errors.push(`Coolant room ramp tile ${key} is too steep to use reliably.`);
      }
    }

    for (const tile of roomTiles) {
      // `level` now identifies the absolute dungeon elevation band. It is not
      // evidence that a room-local surface is raised above its own floor.
      const elevated = Math.abs((tile.elevation ?? 0) - roomBaseElevation) > 0.05;
      if (elevated && fixtureTileKeys.has(tileKey(tile.x, tile.z))) {
        errors.push(`Coolant room elevated tile ${this._getFloorTileGraphKey(tile)} overlaps a tank or pressure core footprint.`);
      }
    }

    return {
      accepted: errors.length === 0,
      errors,
      warnings: errors.length ? warnings : [
        'Coolant room required walkability validated successfully.',
        ...warnings,
      ],
    };
  }

  _finalizeRoomVerticalPlans(rooms, floorTiles, connectionPlans = []) {
    for (const room of rooms) {
      if (room.suppressRoomGeometry) continue;
      const roomTiles = this._getRoomFloorTiles(room, floorTiles);
      const tierMap = [...new Map(roomTiles.map((tile) => {
        const level = Number(tile.level ?? 0);
        const elevation = Number(tile.elevation ?? 0);
        return [`${level.toFixed(2)}:${elevation.toFixed(2)}`, { level, elevation }];
      })).values()].sort((a, b) => a.elevation - b.elevation);
      const rampTiles = roomTiles.filter((tile) => tile.surface === 'industrialRamp');
      const catwalkTiles = roomTiles.filter((tile) => RAIL_ELIGIBLE_FACTORY_SURFACES.has(tile.surface));
      const platformTiles = roomTiles.filter((tile) => tile.isPlatformingSurface);
      const roomConnections = connectionPlans.filter((plan) => (
        plan.fromRoomId === room.id || plan.toRoomId === room.id
      ));

      room.numberOfVerticalTiers = tierMap.length;
      room.localTierMap = tierMap;
      room.absoluteTierMap = tierMap.map((tier) => ({ ...tier }));
      room.relativeTierMap = tierMap.map((tier) => ({
        ...tier,
        elevation: tier.elevation - Number(room.baseElevation ?? 0),
      }));
      room.platformNodes = platformTiles.map((tile) => ({
        floorKey: this._getFloorTileGraphKey(tile),
        x: tile.x,
        z: tile.z,
        level: tile.level,
        elevation: tile.elevation,
        platformGroupId: tile.platformGroupId ?? null,
        purpose: tile.platformPurpose,
        requiredTraversalAction: tile.requiredTraversalAction,
      }));
      room.catwalkNodes = catwalkTiles.slice(0, 48).map((tile) => ({
        floorKey: this._getFloorTileGraphKey(tile),
        x: tile.x,
        z: tile.z,
        level: tile.level,
        elevation: tile.elevation,
        surface: tile.surface,
      }));
      room.rampConnectors = rampTiles.length ? [{
        id: `${room.id}RampNetwork`,
        tileCount: rampTiles.length,
        minimumElevation: Math.min(...rampTiles.map((tile) => tile.elevation ?? 0)),
        maximumElevation: Math.max(...rampTiles.map((tile) => tile.elevation ?? 0)),
        maximumRisePerTile: Math.max(...rampTiles.map((tile) => (
          Math.abs((tile.rampEndElevation ?? tile.elevation ?? 0) - (tile.rampStartElevation ?? tile.elevation ?? 0))
        ))),
      }] : [];
      room.stairConnectors = roomTiles.some((tile) => tile.surface === 'industrialStairs')
        ? [{ id: `${room.id}StairNetwork`, type: 'industrial_stairs' }]
        : [];
      room.traversalRoutes = roomConnections.map((plan) => ({
        connectionId: plan.id,
        connectorType: plan.connectorType,
        level: plan.level,
        elevation: plan.elevation,
        sourceElevation: plan.sourceElevation ?? plan.fromSocket?.elevation ?? plan.elevation,
        destinationElevation: plan.destinationElevation ?? plan.toSocket?.elevation ?? plan.elevation,
        elevationDelta: plan.elevationDelta ?? 0,
        direction: plan.direction ?? 'level',
        purpose: plan.purpose,
      }));
      room.doorPositionsByElevation = room.exitSockets.map((socket) => ({
        socketId: socket.id,
        connectionId: socket.connectionId,
        role: socket.role,
        x: socket.x,
        z: socket.z,
        level: socket.level,
        elevation: socket.elevation,
      }));
      room.verticalPlan = {
        ...(room.verticalPlan ?? {}),
        tierMap,
        platformNodes: room.platformNodes,
        catwalkNodes: room.catwalkNodes,
        stairConnectors: room.stairConnectors,
        rampConnectors: room.rampConnectors,
        traversalRoutes: room.traversalRoutes,
      };
    }
  }

  _findRampScaffoldHeadroomConflicts(floorTiles = []) {
    const columns = this._createFloorTileLookup(floorTiles);
    const conflicts = [];

    for (const ramp of floorTiles.filter((tile) => tile.surface === 'industrialRamp')) {
      const replacedBase = ramp.rampBaseOriginal;
      if (ramp.rampScaffoldPriority === 'scaffold'
        && (ramp.rampPointIndex ?? 0) > 0
        && (ramp.rampPointIndex ?? 0) < (ramp.rampPointCount ?? 1) - 1
        && SCAFFOLD_RAMP_ACCESS_SURFACES.has(replacedBase?.surface)) {
        conflicts.push({
          ramp,
          scaffold: replacedBase,
          clearance: 0,
          replacedBase: true,
        });
      }
      const rampTopY = Math.max(
        ramp.elevation ?? 0,
        ramp.rampStartElevation ?? -Infinity,
        ramp.rampEndElevation ?? -Infinity,
      );
      const rampBottomY = Math.min(
        ramp.elevation ?? 0,
        ramp.rampStartElevation ?? Infinity,
        ramp.rampEndElevation ?? Infinity,
      );
      for (const scaffold of columns.get(tileKey(ramp.x, ramp.z)) ?? []) {
        if (scaffold === ramp
          || scaffold.surface === 'industrialRamp'
          || !SCAFFOLD_RAMP_ACCESS_SURFACES.has(scaffold.surface)) {
          continue;
        }
        const rampReferenceY = ramp.rampScaffoldPriority === 'scaffold'
          ? rampBottomY
          : rampTopY;
        const clearance = (scaffold.elevation ?? 0) - rampReferenceY;
        const preservesConveyorDeck = ramp.rampScaffoldPriority === 'scaffold'
          && scaffold.type === 'conveyor'
          && (scaffold.elevation ?? 0) >= rampBottomY - 0.05;
        // Equal-height deck seams are normally intentional. Conveyor decks
        // are the exception: their full scaffold/support footprint wins over
        // a slope occupying the same column.
        if (clearance > 0.12 || preservesConveyorDeck) {
          conflicts.push({ ramp, scaffold, clearance });
        }
      }
      if (ramp.rampScaffoldPriority === 'scaffold') {
        const directionX = Math.sign(ramp.rampDirectionX ?? 0);
        const directionZ = Math.sign(ramp.rampDirectionZ ?? 0);
        const approachColumn = columns.get(tileKey(
          ramp.x + directionX,
          ramp.z + directionZ,
        )) ?? [];
        for (const scaffold of approachColumn) {
          if (scaffold.surface !== 'thirdFloorGantry'
            || (scaffold.elevation ?? 0) <= rampBottomY + 0.12) {
            continue;
          }
          conflicts.push({
            ramp,
            scaffold,
            clearance: (scaffold.elevation ?? 0) - rampBottomY,
            adjacentSupportFootprint: true,
          });
        }
      }
    }

    return conflicts;
  }

  _clearRampScaffoldHeadroom(tiles, extraTiles, rooms = [], {
    preferScaffoldRoomIds = new Set(),
    seen = null,
  } = {}) {
    const conflicts = this._findRampScaffoldHeadroomConflicts([
      ...tiles.values(),
      ...extraTiles,
    ]);
    if (!conflicts.length) {
      return { removedScaffolds: [], removedRampRouteIds: [] };
    }

    const scaffoldPriorityConflicts = conflicts.filter(({ ramp }) => (
      preferScaffoldRoomIds.has(ramp.roomId)
    ));
    const removedRampRouteIds = new Set(scaffoldPriorityConflicts
      .filter((conflict) => !conflict.adjacentSupportFootprint)
      .map(({ ramp }) => ramp.rampRouteId)
      .filter(Boolean));
    const convertedRampTiles = new Set(scaffoldPriorityConflicts
      .filter(({ ramp, adjacentSupportFootprint }) => (
        adjacentSupportFootprint
        && !removedRampRouteIds.has(ramp.rampRouteId)
      ))
      .map(({ ramp }) => ramp));
    const removedScaffolds = new Set(conflicts
      .filter(({ ramp }) => (
        !preferScaffoldRoomIds.has(ramp.roomId)
        && !removedRampRouteIds.has(ramp.rampRouteId)
      ))
      .map(({ scaffold }) => scaffold));

    for (const ramp of convertedRampTiles) {
      ramp.type = 'floor';
      ramp.surface = 'solidPurposePlatform';
      ramp.isPlatformingSurface = true;
      ramp.platformGroupId = `${ramp.roomId}_scaffoldPriorityTransition_${ramp.rampRouteId}`;
      ramp.platformPurpose = 'solid_transition_below_preserved_scaffold';
      ramp.requiredTraversalAction = 'jump';
      ramp.baseElevation = Number(ramp.roomBaseElevation ?? 0);
      delete ramp.rampStartElevation;
      delete ramp.rampEndElevation;
      delete ramp.rampDirectionX;
      delete ramp.rampDirectionZ;
      delete ramp.rampRunId;
      delete ramp.rampScaffoldPriority;
      delete ramp.rampPointIndex;
      delete ramp.rampPointCount;
      delete ramp.steepRamp;
    }

    for (const tile of tiles.values()) {
      if (!removedRampRouteIds.has(tile.rampRouteId)) {
        continue;
      }
      const original = tile.rampBaseOriginal;
      if (!original) {
        continue;
      }
      for (const key of Object.keys(tile)) {
        delete tile[key];
      }
      Object.assign(tile, original);
    }

    for (let index = extraTiles.length - 1; index >= 0; index -= 1) {
      const tile = extraTiles[index];
      if (removedScaffolds.has(tile) || removedRampRouteIds.has(tile.rampRouteId)) {
        seen?.delete?.(floorTileKey(tile.x, tile.z, tile.level ?? 0));
        extraTiles.splice(index, 1);
      }
    }

    for (const room of rooms) {
      const roomScaffoldRemovals = [...removedScaffolds].filter((tile) => tile.roomId === room.id);
      const roomRouteRemovals = [...removedRampRouteIds].filter((routeId) => (
        conflicts.some(({ ramp }) => ramp.roomId === room.id && ramp.rampRouteId === routeId)
      ));
      const roomConversions = [...convertedRampTiles].filter((tile) => tile.roomId === room.id);
      if (roomScaffoldRemovals.length) {
        const previousColumns = room.rampClearanceRemovedScaffoldColumns ?? [];
        room.rampClearanceRemovedScaffoldColumns = [
          ...previousColumns,
          ...roomScaffoldRemovals.map((tile) => ({
            x: tile.x,
            z: tile.z,
            elevation: tile.elevation ?? 0,
            surface: tile.surface,
          })),
        ];
        room.rampClearanceRemovedScaffoldTileCount =
          room.rampClearanceRemovedScaffoldColumns.length;
      }
      if (roomRouteRemovals.length) {
        room.rampClearanceRemovedRampRouteIds = [...new Set([
          ...(room.rampClearanceRemovedRampRouteIds ?? []),
          ...roomRouteRemovals,
        ])];
        room.rampClearancePreferredScaffold = true;
      }
      if (roomConversions.length) {
        room.rampClearanceConvertedToSolidTileCount =
          (room.rampClearanceConvertedToSolidTileCount ?? 0) + roomConversions.length;
        room.rampClearancePreferredScaffold = true;
      }
    }

    return {
      convertedRampTiles: [...convertedRampTiles],
      removedScaffolds: [...removedScaffolds],
      removedRampRouteIds: [...removedRampRouteIds],
    };
  }

  _createMinorDropReturnShelfAssemblies(floorTiles = []) {
    const grouped = new Map();
    for (const tile of floorTiles.filter((candidate) => candidate.surface === 'basementReturnShelf')) {
      const key = tile.dropSpaceId ?? `${tile.roomId ?? 'room'}_returnShelf`;
      const assembly = grouped.get(key) ?? {
        id: key,
        dropSpaceId: tile.dropSpaceId ?? null,
        roomId: tile.roomId ?? null,
        elevation: tile.elevation ?? 0,
        baseY: Number.isFinite(tile.supportBaseElevation)
          ? tile.supportBaseElevation
          : Number(tile.roomBaseElevation ?? 0) + RUIN_MINOR_DROP_ELEVATION,
        tiles: [],
      };
      assembly.tiles.push(tile);
      grouped.set(key, assembly);
    }

    return [...grouped.values()].map((assembly) => ({
      ...assembly,
      minX: Math.min(...assembly.tiles.map((tile) => tile.x)),
      maxX: Math.max(...assembly.tiles.map((tile) => tile.x)),
      minZ: Math.min(...assembly.tiles.map((tile) => tile.z)),
      maxZ: Math.max(...assembly.tiles.map((tile) => tile.z)),
      ledgeEdges: [...new Set(assembly.tiles.flatMap((tile) => tile.ledgeEdges ?? []))],
    }));
  }

  _createPurposePlatformAssemblies(floorTiles = [], { includeUngrouped = false } = {}) {
    const grouped = new Map();
    for (const tile of floorTiles.filter((candidate) => (
      candidate.isPlatformingSurface
      && (includeUngrouped || candidate.platformGroupId)
    ))) {
      const ownerId = tile.roomId
        ?? tile.connectionId
        ?? tile.connectorId
        ?? tile.augmentationOwnerId
        ?? 'spatial';
      const localGroupId = tile.platformGroupId
        ?? `tile_${tile.x}_${tile.z}_${tile.level ?? 0}`;
      const elevation = Number(tile.elevation ?? 0);
      const baseY = Number(
        tile.supportBaseElevation
        ?? tile.roomBaseElevation
        ?? 0
      );
      // Blueprint tier names such as "upper" are local to a module. Treating
      // them as dungeon-global merges distant rooms into one enormous box,
      // which presents as a one-sided wall across otherwise valid connectors.
      const key = [
        ownerId,
        localGroupId,
        tile.surface ?? 'platform',
        elevation.toFixed(3),
        baseY.toFixed(3),
      ].join(':');
      const assembly = grouped.get(key) ?? {
        id: key,
        ownerId,
        roomId: tile.roomId ?? null,
        localGroupId,
        surface: tile.surface ?? 'platform',
        elevation,
        baseY,
        tiles: [],
      };
      assembly.tiles.push(tile);
      grouped.set(key, assembly);
    }

    return [...grouped.values()].map((assembly) => {
      const rows = new Map();
      for (const tile of assembly.tiles) {
        const xs = rows.get(tile.z) ?? [];
        xs.push(tile.x);
        rows.set(tile.z, xs);
      }

      const rectangles = [];
      let active = new Map();
      for (const z of [...rows.keys()].sort((a, b) => a - b)) {
        const xs = [...new Set(rows.get(z))].sort((a, b) => a - b);
        const runs = [];
        let runStart = xs[0];
        let previous = runStart;
        for (let index = 1; index < xs.length; index += 1) {
          const x = xs[index];
          if (x === previous + 1) {
            previous = x;
          } else {
            runs.push({ minX: runStart, maxX: previous });
            runStart = x;
            previous = x;
          }
        }
        if (Number.isFinite(runStart)) {
          runs.push({ minX: runStart, maxX: previous });
        }

        const nextActive = new Map();
        for (const run of runs) {
          const runKey = `${run.minX},${run.maxX}`;
          const existing = active.get(runKey);
          const canExtend = existing && existing.maxZ === z - 1;
          if (existing && !canExtend) rectangles.push(existing);
          nextActive.set(runKey, canExtend
            ? { ...existing, maxZ: z }
            : { ...run, minZ: z, maxZ: z });
        }
        for (const [runKey, rectangle] of active) {
          if (!nextActive.has(runKey)) rectangles.push(rectangle);
        }
        active = nextActive;
      }
      rectangles.push(...active.values());

      return { ...assembly, rectangles };
    });
  }

  _createGeneratedPlatformSurfaces(floorTiles = []) {
    const surfaces = floorTiles
      .filter((tile) => (
        (tile.isLedgeSurface && tile.surface !== 'basementReturnShelf')
        || (tile.isPlatformingSurface && !tile.platformGroupId)
      ))
      .map((tile) => ({
        id: `${tile.isLedgeSurface ? 'generatedLedge' : 'generatedPlatform'}_${tile.x}_${tile.z}_${tile.level}`,
        roomId: tile.roomId,
        floorKey: this._getFloorTileGraphKey(tile),
        center: new THREE.Vector3(tile.x * this.tileSize, tile.elevation ?? 0, tile.z * this.tileSize),
        halfWidth: this.tileSize * 0.46,
        halfDepth: this.tileSize * 0.46,
        topY: tile.elevation ?? 0,
        baseY: Number.isFinite(tile.supportBaseElevation)
          ? tile.supportBaseElevation
          : Number(tile.roomBaseElevation ?? 0),
        blocksBelow: tile.surface === 'basementReturnShelf' || !tile.isLedgeSurface,
        generated: true,
        purpose: tile.platformPurpose ?? (tile.isLedgeSurface ? 'matched_elevation_portal_landing' : null),
        requiredTraversalAction: tile.requiredTraversalAction ?? (tile.isLedgeSurface ? 'ledge_climb' : null),
        ledgeEdges: Array.isArray(tile.ledgeEdges) ? [...tile.ledgeEdges] : null,
        dropSpaceId: tile.dropSpaceId ?? null,
        minimumHangRootY: Number.isFinite(tile.supportBaseElevation)
          ? tile.supportBaseElevation
          : null,
      }));
    for (const assembly of this._createMinorDropReturnShelfAssemblies(floorTiles)) {
      const representative = assembly.tiles[0];
      surfaces.push({
        id: `generatedBasementReturnShelf_${assembly.id}`,
        roomId: assembly.roomId,
        floorKey: this._getFloorTileGraphKey(representative),
        center: new THREE.Vector3(
          (assembly.minX + assembly.maxX) * this.tileSize * 0.5,
          assembly.elevation,
          (assembly.minZ + assembly.maxZ) * this.tileSize * 0.5,
        ),
        halfWidth: (assembly.maxX - assembly.minX + 1) * this.tileSize * 0.492,
        halfDepth: (assembly.maxZ - assembly.minZ + 1) * this.tileSize * 0.492,
        topY: assembly.elevation,
        baseY: assembly.baseY,
        blocksBelow: true,
        generated: true,
        solidVolume: true,
        mergedReturnShelf: true,
        purpose: representative.platformPurpose ?? 'basement_return_climb_shelf',
        requiredTraversalAction: representative.requiredTraversalAction ?? 'ledge_climb',
        ledgeEdges: assembly.ledgeEdges,
        dropSpaceId: assembly.dropSpaceId,
        minimumHangRootY: assembly.baseY,
      });
    }
    for (const assembly of this._createPurposePlatformAssemblies(floorTiles)) {
      for (const [segmentIndex, rectangle] of assembly.rectangles.entries()) {
        const representative = assembly.tiles.find((tile) => (
          tile.x >= rectangle.minX
          && tile.x <= rectangle.maxX
          && tile.z >= rectangle.minZ
          && tile.z <= rectangle.maxZ
        ));
        if (!representative) continue;
        surfaces.push({
          id: `generatedSolidPlatform_${assembly.id}_${segmentIndex + 1}`,
          roomId: assembly.roomId,
          floorKey: this._getFloorTileGraphKey(representative),
          center: new THREE.Vector3(
            (rectangle.minX + rectangle.maxX) * this.tileSize * 0.5,
            assembly.elevation,
            (rectangle.minZ + rectangle.maxZ) * this.tileSize * 0.5,
          ),
          halfWidth: (rectangle.maxX - rectangle.minX + 1) * this.tileSize * 0.48,
          halfDepth: (rectangle.maxZ - rectangle.minZ + 1) * this.tileSize * 0.48,
          topY: assembly.elevation,
          baseY: assembly.baseY,
          blocksBelow: true,
          generated: true,
          solidVolume: true,
          platformGroupId: assembly.localGroupId,
          platformAssemblyId: assembly.id,
          platformSegmentIndex: segmentIndex,
          purpose: representative.platformPurpose,
          requiredTraversalAction: representative.requiredTraversalAction ?? 'jump',
        });
      }
    }
    for (const assembly of this._createSolidArchitecturalDeckAssemblies(floorTiles)) {
      for (const [segmentIndex, rectangle] of assembly.rectangles.entries()) {
        const representative = assembly.solidTiles.find((tile) => (
          tile.x >= rectangle.minX
          && tile.x <= rectangle.maxX
          && tile.z >= rectangle.minZ
          && tile.z <= rectangle.maxZ
        ));
        if (!representative) {
          continue;
        }
        surfaces.push({
          id: `generatedArchitecturalMass_${assembly.id}_${segmentIndex + 1}`,
          roomId: assembly.roomId,
          floorKey: this._getFloorTileGraphKey(representative),
          center: new THREE.Vector3(
            (rectangle.minX + rectangle.maxX) * this.tileSize * 0.5,
            assembly.elevation,
            (rectangle.minZ + rectangle.maxZ) * this.tileSize * 0.5,
          ),
          halfWidth: (rectangle.maxX - rectangle.minX + 1) * this.tileSize * 0.492,
          halfDepth: (rectangle.maxZ - rectangle.minZ + 1) * this.tileSize * 0.492,
          topY: assembly.elevation,
          baseY: Number(representative.roomBaseElevation ?? 0),
          blocksBelow: true,
          generated: true,
          solidVolume: true,
          architecturalMass: true,
          createsLedgeCandidates: false,
          massGroupId: assembly.id,
          purpose: 'solid_architectural_deck_support',
          requiredTraversalAction: 'architectural_access',
        });
      }
    }
    return surfaces;
  }

  _createDungeonAugmentationValidationSolidZones(
    baseSolidZones = [],
    dungeonSupplementFragment = null,
    augmentationApplied = false,
  ) {
    if (!augmentationApplied || !dungeonSupplementFragment) return baseSolidZones;
    return [
      ...baseSolidZones,
      ...(dungeonSupplementFragment.solidZones ?? []),
    ];
  }

  _validatePlatformability({
    floorTiles = [],
    rooms = [],
    solidZones = [],
    segmentBarrierZones = null,
    connectionPlans = [],
    doors = [],
    landmarks = {},
    encounters = [],
    useSegmentBarriers = false,
  } = {}) {
    const errors = [];
    const rampScaffoldHeadroomConflicts = this._findRampScaffoldHeadroomConflicts(floorTiles);
    if (rampScaffoldHeadroomConflicts.length) {
      const first = rampScaffoldHeadroomConflicts[0];
      errors.push(
        `Ramp ${this._getFloorTileGraphKey(first.ramp)} has only ${first.clearance.toFixed(2)} clearance beneath scaffold ${this._getFloorTileGraphKey(first.scaffold)}.`,
      );
    }
    const columns = this._createFloorTileLookup(floorTiles);
    const blockingPlatformTops = this._createBlockingPlatformColumnMap(floorTiles);
    const navigableTiles = floorTiles.filter((tile) => (
      !this._isFloorTileBlockedBySolidZone(tile, solidZones)
      && !this._isFloorTileBlockedByGeneratedPlatform(tile, blockingPlatformTops)
    ));
    const navigableByKey = new Map(navigableTiles.map((tile) => [this._getFloorTileGraphKey(tile), tile]));
    const incomingActions = new Map();
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const localSocketChecks = [];
    const connectorSpineChecks = [];
    const supplementConnectivityChecks = [];
    const supplementRoomConnectivityChecks = [];
    const supplementJunctionConnectivityChecks = [];
    const supplementVerticalConnectivityChecks = [];
    const supplementShortcutConnectivityChecks = [];
    const dropSpaceChecks = [];
    const isPhysicalSupplementPlan = (plan) => Boolean(
      (plan.isDungeonSupplement || plan.isPaddedByDungeonSupplement)
      && !plan.isSupplementGraphConnection
      && plan.connectorVariantConstraints?.graphOnly !== true
      && (
        plan.augmentationOperationType === 'routeNetwork'
        || plan.isRouteNetworkConnection
        || plan.routeNetworkGrantId
      )
    );
    const physicalSupplementPlans = connectionPlans.filter(isPhysicalSupplementPlan);
    const physicalSupplementPlanIds = new Set(physicalSupplementPlans.map((plan) => plan.id));
    const shortcutSupplementPlans = physicalSupplementPlans.filter((plan) => (
      plan.oneSideActivatedShortcut
      || ['shortcut-lift', 'drop-ladder'].includes(String(plan.shortcutMode ?? ''))
    ));
    const lockedShortcutTraversalLinkIds = new Set(shortcutSupplementPlans.flatMap((plan) => (
      [
        ...(plan.ladderContracts ?? []),
        ...(plan.liftContracts ?? []),
      ].flatMap(({ id }) => [`${id}:forward`, `${id}:reverse`])
    )));
    const startRoom = rooms.find((room) => room.id === 'hubTown') ?? rooms[0];
    const startTile = this._findRoomWalkabilityStartTile(startRoom, navigableTiles);
    const reachable = new Set();
    const queue = [];
    const traversalSegmentBarrierZones = useSegmentBarriers
      ? (segmentBarrierZones ?? solidZones).filter((zone) => zone?.position)
      : [];
    const strictSupplementSegmentBarrierZones = useSegmentBarriers
      ? [...solidZones, ...traversalSegmentBarrierZones]
        .filter((zone) => zone?.position)
        .filter((zone, index, zones) => (
          zones.findIndex((candidate) => candidate?.id === zone?.id) === index
        ))
      : [];
    const canTraverseEdge = (fromTile, toTile, traversalAction = null) => (
      ['ladder', 'automatic_lift'].includes(traversalAction)
      || !traversalSegmentBarrierZones.some((zone) => (
        this._doesFloorTraversalSegmentIntersectZone(
          fromTile,
          toTile,
          zone,
          PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
        )
      ))
    );
    const canTraverseStrictSupplementEdge = (fromTile, toTile, traversalAction = null) => (
      ['ladder', 'automatic_lift'].includes(traversalAction)
      || !strictSupplementSegmentBarrierZones.some((zone) => (
        this._doesFloorTraversalSegmentIntersectZone(
          fromTile,
          toTile,
          zone,
          PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
        )
      ))
    );

    if (!startTile) {
      errors.push('Platformability solver has no valid dungeon start tile.');
    } else {
      reachable.add(this._getFloorTileGraphKey(startTile));
      queue.push(startTile);
    }

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      for (const [dx, dz] of DIRECTIONS) {
        for (const candidate of columns.get(tileKey(current.x + dx, current.z + dz)) ?? []) {
          const candidateKey = this._getFloorTileGraphKey(candidate);
          if (!navigableByKey.has(candidateKey)) {
            continue;
          }
          const action = this._getTraversalActionBetweenFloorTiles(current, candidate);
          if (!action || !canTraverseEdge(current, candidate, action)) {
            continue;
          }
          const actions = incomingActions.get(candidateKey) ?? new Set();
          actions.add(action);
          incomingActions.set(candidateKey, actions);
          if (!reachable.has(candidateKey)) {
            reachable.add(candidateKey);
            queue.push(candidate);
          }
        }
      }
      for (const link of current.traversalLinks ?? []) {
        const candidateKey = link.toFloorKey;
        const candidate = navigableByKey.get(candidateKey);
        if (!candidate || !canTraverseEdge(current, candidate, link.action ?? 'link')) {
          continue;
        }
        const actions = incomingActions.get(candidateKey) ?? new Set();
        actions.add(link.action ?? 'connector');
        incomingActions.set(candidateKey, actions);
        if (!reachable.has(candidateKey)) {
          reachable.add(candidateKey);
          queue.push(candidate);
        }
      }
    }
    const reachableWithoutInitialShortcuts = this._createReachableFloorTileKeySet(
      startTile,
      navigableTiles,
      useSegmentBarriers ? {
        canTraverseEdge: (fromTile, toTile, traversalAction, traversalLink = null) => (
          !lockedShortcutTraversalLinkIds.has(String(traversalLink?.id ?? ''))
          && canTraverseEdge(fromTile, toTile, traversalAction)
        ),
      } : {
        canTraverseEdge: (_fromTile, _toTile, _traversalAction, traversalLink = null) => (
          !lockedShortcutTraversalLinkIds.has(String(traversalLink?.id ?? ''))
        ),
      },
    );

    const tileForPoint = (point, {
      roomId = null,
      maximumVerticalDistance = Number.POSITIVE_INFINITY,
    } = {}) => {
      if (!point) {
        return null;
      }
      const x = Math.round(point.x / this.tileSize);
      const z = Math.round(point.z / this.tileSize);
      return [...(columns.get(tileKey(x, z)) ?? [])]
        .filter((tile) => roomId == null || String(tile.roomId ?? '') === String(roomId))
        .filter((tile) => (
          Math.abs((tile.elevation ?? 0) - (point.y ?? 0)) <= maximumVerticalDistance
        ))
        .sort((a, b) => Math.abs((a.elevation ?? 0) - (point.y ?? 0)) - Math.abs((b.elevation ?? 0) - (point.y ?? 0)))[0] ?? null;
    };
    const requirePoint = (label, point, {
      roomId = null,
      requireDirectOwnedFloor = false,
      maximumVerticalDistance = Number.POSITIVE_INFINITY,
    } = {}) => {
      const blockingZone = point
        ? solidZones.find((zone) => this._isPositionInsideZone(point, zone))
        : null;
      if (blockingZone) {
        errors.push(`${label} overlaps solid zone ${blockingZone.id}.`);
        return;
      }

      const tile = tileForPoint(point, { roomId, maximumVerticalDistance });
      const directlyReachable = tile && reachable.has(this._getFloorTileGraphKey(tile));
      if (requireDirectOwnedFloor && !directlyReachable) {
        errors.push(
          `${label} is not placed on a reachable floor owned by ${roomId ?? 'its supplemental room'} at the declared elevation.`,
        );
        return;
      }
      const hasReachableApproach = !directlyReachable && tile && DIRECTIONS.some(([dx, dz]) => (
        (columns.get(tileKey(tile.x + dx, tile.z + dz)) ?? []).some((candidate) => (
          reachable.has(this._getFloorTileGraphKey(candidate))
          && Math.abs((candidate.elevation ?? 0) - (point.y ?? 0)) <= PLAYER_TRAVERSAL_ENVELOPE.maximumNormalJumpRise
          && canTraverseEdge(candidate, tile)
        ))
      ));
      if (!directlyReachable && !hasReachableApproach) {
        errors.push(`${label} is not reachable by the player traversal envelope.`);
      }
    };

    for (const room of rooms.filter((candidate) => (
      !candidate.suppressRoomGeometry
        && !RUIN_OPEN_AIR_ROOM_TYPES.has(candidate.type)
    ))) {
      const roomBaseElevation = Number(room.baseElevation ?? 0);
      const reachableRoomTiles = this._getRoomFloorTiles(room, navigableTiles)
        .filter((tile) => reachable.has(this._getFloorTileGraphKey(tile)));
      const reachableElevations = new Set(reachableRoomTiles.map((tile) => (tile.elevation ?? 0).toFixed(2)));
      const elevatedTiles = reachableRoomTiles.filter((tile) => (
        Math.abs((tile.elevation ?? 0) - roomBaseElevation) > 0.05
      ));
      const platformTiles = room.platformNodes ?? [];
      const disconnectedTraversalTiles = this._getRoomFloorTiles(room, navigableTiles)
        .filter((tile) => (
          (tile.surface === 'industrialRamp'
            || (Math.abs((tile.elevation ?? 0) - roomBaseElevation) > 0.05
              && SCAFFOLD_RAMP_ACCESS_SURFACES.has(tile.surface)
              && tile.surface !== 'coolantControlBalcony'))
          && !reachable.has(this._getFloorTileGraphKey(tile))
        ));

      if (!reachableRoomTiles.length) {
        errors.push(`${room.id} has no platformably reachable floor.`);
      }
      const requiresIndustrialPlatforming = !room.isDungeonSupplement
        || (room.augmentationStructure?.platforms?.length ?? 0) > 0
        || (room.augmentationStructure?.ramps?.length ?? 0) > 0;
      if (requiresIndustrialPlatforming) {
        if (reachableElevations.size < 2 || !elevatedTiles.length) {
          errors.push(`${room.id} does not provide a reachable vertical traversal tier.`);
        }
        if (!platformTiles.length) {
          errors.push(`${room.id} has no purposeful platforming node.`);
        }
        if (disconnectedTraversalTiles.length) {
          errors.push(
            `${room.id} has ${disconnectedTraversalTiles.length} disconnected elevated traversal tile(s), including ${this._getFloorTileGraphKey(disconnectedTraversalTiles[0])}.`,
          );
        }
      }
      let hasRequiredPlatformAction = false;
      for (const platform of requiresIndustrialPlatforming ? platformTiles : []) {
        const actions = incomingActions.get(platform.floorKey) ?? new Set();
        if (!reachable.has(platform.floorKey)) {
          errors.push(`${room.id} platform ${platform.floorKey} is unreachable.`);
        } else if ([...actions].some((action) => action === 'jump' || action === 'ledge_climb')) {
          hasRequiredPlatformAction = true;
        }
        if (!platform.purpose) {
          errors.push(`${room.id} platform ${platform.floorKey} has no gameplay or story purpose.`);
        }
      }
      if (requiresIndustrialPlatforming && platformTiles.length && !hasRequiredPlatformAction) {
        errors.push(`${room.id} platform segment does not require a real jump or ledge action.`);
      }
      if (room.type === 'keycard') {
        const pyramidTiles = this._getRoomFloorTiles(room, navigableTiles);
        const pyramidSummitTiles = pyramidTiles
          .filter((tile) => tile.surface === 'mechanicalPyramidSummit');
        const processionalSteps = pyramidTiles
          .filter((tile) => tile.surface === 'mechanicalPyramidProcessionalStep');
        const terraces = pyramidTiles
          .filter((tile) => tile.surface === 'mechanicalPyramidTerrace');
        const sidePlatforms = pyramidTiles
          .filter((tile) => tile.surface === 'mechanicalPyramidSidePlatform');
        if (!room.mechanicalPyramidCenter
          || (room.mechanicalPyramidCenter.elevation ?? 0) < 3.5
          || pyramidSummitTiles.length !== 9
          || processionalSteps.length < 18
          || terraces.length < 180
          || sidePlatforms.length !== 6) {
          errors.push(`${room.id} does not contain the required tall stepped pyramid, stable summit, enemy stair, and paired side-platform routes (height=${room.mechanicalPyramidCenter?.elevation ?? 'missing'}, summit=${pyramidSummitTiles.length}, stairs=${processionalSteps.length}, terraces=${terraces.length}, sidePlatforms=${sidePlatforms.length}).`);
        }
      }

      const highestLocalElevation = Math.max(
        0,
        ...reachableRoomTiles.map((tile) => (tile.elevation ?? roomBaseElevation) - roomBaseElevation),
      );
      if (Number.isFinite(room.ceilingHeight)
        && highestLocalElevation + PLAYER_TRAVERSAL_ENVELOPE.headClearance > room.ceilingHeight) {
        errors.push(`${room.id} lacks ceiling clearance above its highest reachable tier.`);
      }
    }

    for (const room of rooms.filter((candidate) => candidate.dropSpace)) {
      const spec = room.dropSpace;
      const roomBaseElevation = Number(room.baseElevation ?? 0);
      const absoluteLowerElevation = roomBaseElevation + Number(spec.lowerElevation ?? 0);
      const lowerTiles = spec.lowerFloorKeys
        .map((key) => navigableByKey.get(key))
        .filter(Boolean);
      const entryTiles = spec.entryFloorKeys
        .map((key) => navigableByKey.get(key))
        .filter(Boolean);
      const entryLipTiles = spec.entryLipFloorKeys
        .map((key) => navigableByKey.get(key))
        .filter(Boolean);
      const shelfTiles = spec.returnShelfFloorKeys
        .map((key) => navigableByKey.get(key))
        .filter(Boolean);
      const exitTiles = spec.exitFloorKeys
        .map((key) => navigableByKey.get(key))
        .filter(Boolean);
      const hasAction = (fromTiles, toTiles, action) => fromTiles.some((fromTile) => (
        toTiles.some((toTile) => this._getTraversalActionBetweenFloorTiles(fromTile, toTile) === action)
      ));
      const lowerStart = lowerTiles.find((tile) => (
        Math.abs(tile.x - room.x) + Math.abs(tile.z - room.z)
        === Math.min(...lowerTiles.map((candidate) => (
          Math.abs(candidate.x - room.x) + Math.abs(candidate.z - room.z)
        )))
      )) ?? lowerTiles[0] ?? null;
      const egressReachable = this._createReachableFloorTileKeySet(
        lowerStart,
        navigableTiles,
        useSegmentBarriers ? { canTraverseEdge } : {},
      );
      const entryDropExists = hasAction(entryLipTiles, entryTiles, 'drop');
      const returnClimbExists = hasAction(lowerTiles, shelfTiles, 'ledge_climb');
      const exitJumpExists = hasAction(shelfTiles, exitTiles, 'jump');
      const entryFlagsValid = entryTiles.length === spec.entryFloorKeys.length
        && entryTiles.every((tile) => tile.allowsGroundedDropLanding && tile.dropSpaceId === spec.id);
      const entryLipsReachable = entryLipTiles.length === spec.entryLipFloorKeys.length
        && entryLipTiles.every((tile) => reachable.has(this._getFloorTileGraphKey(tile)));
      const expectedShelfEdge = spec.returnDirectionX > 0
        ? 'left'
        : spec.returnDirectionX < 0
          ? 'right'
          : spec.returnDirectionZ > 0
            ? 'front'
            : 'back';
      const shelfEdgesValid = shelfTiles.length === spec.returnShelfFloorKeys.length
        && shelfTiles.every((tile) => (
          tile.ledgeEdges?.length === 1
          && tile.ledgeEdges[0] === expectedShelfEdge
          && Math.abs((tile.supportBaseElevation ?? Infinity) - absoluteLowerElevation) <= 0.01
        ));
      const shelfSupportColumnsBlocked = shelfTiles.every((shelf) => (
        (columns.get(tileKey(shelf.x, shelf.z)) ?? []).some((candidate) => (
          candidate.surface === 'basementFloor'
          && this._isFloorTileBlockedByGeneratedPlatform(candidate, blockingPlatformTops)
        ))
      ));
      const bridgeTiles = spec.bridgeFloorKeys
        .map((key) => navigableByKey.get(key))
        .filter(Boolean);
      const lowerArea = (spec.lowerBounds.maxX - spec.lowerBounds.minX + 1)
        * (spec.lowerBounds.maxZ - spec.lowerBounds.minZ + 1);
      const bridgeCoverageRatio = bridgeTiles.length / Math.max(1, lowerArea);
      const overheadClearanceValid = bridgeTiles.every((tile) => (
        (tile.elevation ?? 0) - absoluteLowerElevation
        >= PLAYER_TRAVERSAL_ENVELOPE.headClearance + 0.3
      ));
      const lowerReachable = lowerTiles.length >= 36 && lowerTiles.every((tile) => (
        reachable.has(this._getFloorTileGraphKey(tile))
      ));
      const canExit = exitTiles.some((tile) => egressReachable.has(this._getFloorTileGraphKey(tile)));
      const reverseReachable = new Set(exitTiles.map((tile) => this._getFloorTileGraphKey(tile)));
      const reverseQueue = [...exitTiles];
      for (let cursor = 0; cursor < reverseQueue.length; cursor += 1) {
        const current = reverseQueue[cursor];
        for (const [dx, dz] of DIRECTIONS) {
          for (const candidate of columns.get(tileKey(current.x + dx, current.z + dz)) ?? []) {
            const candidateKey = this._getFloorTileGraphKey(candidate);
            if (
              reverseReachable.has(candidateKey)
              || !navigableByKey.has(candidateKey)
              || !this._getTraversalActionBetweenFloorTiles(candidate, current)
              || !canTraverseEdge(candidate, current)
            ) {
              continue;
            }
            reverseReachable.add(candidateKey);
            reverseQueue.push(candidate);
          }
        }
      }
      const everyLowerTileCanExit = lowerTiles.every((tile) => (
        reverseReachable.has(this._getFloorTileGraphKey(tile))
      ));

      if (!entryDropExists || !entryFlagsValid || !entryLipsReachable) {
        errors.push(`${spec.id} has no authored drop entry.`);
      }
      if (
        !returnClimbExists
        || !exitJumpExists
        || !shelfEdgesValid
        || !shelfSupportColumnsBlocked
      ) {
        errors.push(
          `${spec.id} lacks its climb-shelf and jump return sequence `
          + `(climb=${returnClimbExists}, jump=${exitJumpExists}, edges=${shelfEdgesValid}, support=${shelfSupportColumnsBlocked}).`,
        );
      }
      if (!lowerReachable || !canExit || !everyLowerTileCanExit) {
        errors.push(`${spec.id} lower exploration floor is not safely reachable and escapable.`);
      }
      if (!overheadClearanceValid || bridgeCoverageRatio > 0.5) {
        errors.push(
          `${spec.id} overpasses compromise lower-space clearance or exploration area `
          + `(clearance=${overheadClearanceValid}, coverage=${bridgeCoverageRatio.toFixed(2)}).`,
        );
      }
      dropSpaceChecks.push({
        id: spec.id,
        roomId: room.id,
        lowerTileCount: lowerTiles.length,
        entryDropExists,
        entryFlagsValid,
        entryLipsReachable,
        returnClimbExists,
        exitJumpExists,
        shelfEdgesValid,
        shelfSupportColumnsBlocked,
        lowerReachable,
        canExit,
        everyLowerTileCanExit,
        overheadClearanceValid,
        bridgeCoverageRatio,
      });
    }

    for (const tile of navigableTiles) {
      if (tile.surface === 'industrialRamp' && tile.steepRamp) {
        errors.push(`Ramp ${this._getFloorTileGraphKey(tile)} exceeds the shared movement envelope.`);
      }
    }

    const floorOwnedByConnection = (floor, connectionId) => Boolean(
      floor
      && connectionId
      && (
        floor.signedConnectorFloorOwnerId === connectionId
        || floor.connectorId === connectionId
        || floor.connectionId === connectionId
        || (floor.sharedConnectorFloorOwnerIds ?? []).includes(connectionId)
      )
    );
    const floorMatchesElevation = (floor, elevation, tolerance = 0.05) => Boolean(
      floor
      && Math.abs(Number(floor.elevation ?? 0) - Number(elevation ?? 0)) <= tolerance
    );

    for (const plan of connectionPlans) {
      if (
        plan.isSupplementGraphConnection
        || plan.connectorVariantConstraints?.graphOnly === true
      ) {
        continue;
      }
      const socketDelta = Number(plan.toSocket.elevation) - Number(plan.fromSocket.elevation);
      if (Math.abs(socketDelta - Number(plan.elevationDelta ?? socketDelta)) > 0.001) {
        errors.push(`${plan.id} socket elevations do not match its signed connector contract.`);
      }
      if (plan.fromSocket.connectorType !== plan.toSocket.connectorType) {
        errors.push(`${plan.id} uses incompatible exit and entrance connector types.`);
      }
      const isStrictSupplementConnector = isPhysicalSupplementPlan(plan);
      for (const socket of [plan.fromSocket, plan.toSocket]) {
        const socketFloor = navigableByKey.get(socket.floorKey);
        const socketFloorHasExactOwner = Boolean(
          socketFloor
          && (
            socketFloor.roomId === socket.roomId
            || floorOwnedByConnection(socketFloor, plan.id)
          )
        );
        const socketFloorHasExactElevation = floorMatchesElevation(
          socketFloor,
          socket.elevation,
        );
        if (!reachable.has(socket.floorKey)) {
          errors.push(`${socket.id} is not reachable from its room approach.`);
        }
        if (isStrictSupplementConnector && !socketFloorHasExactOwner) {
          errors.push(
            `${socket.id} is represented only by a floor owned by another room or connector.`,
          );
        }
        if (isStrictSupplementConnector && !socketFloorHasExactElevation) {
          errors.push(
            `${socket.id} has no realized floor at its contracted elevation ${Number(socket.elevation ?? 0).toFixed(2)}.`,
          );
        }
        const ownerRoom = roomById.get(socket.roomId);
        const localTiles = ownerRoom
          ? navigableTiles.filter((tile) => (
              this._isTileInsideRoom(tile, ownerRoom)
              && (!isStrictSupplementConnector || (
                tile.roomId === ownerRoom.id
                || floorOwnedByConnection(tile, plan.id)
              ))
            ))
          : [];
        const localStart = this._findRoomWalkabilityStartTile(ownerRoom, localTiles);
        const locallyReachable = this._createReachableFloorTileKeySet(
          localStart,
          localTiles,
          useSegmentBarriers ? { canTraverseEdge } : {},
        );
        // Parallel V1 upper-catwalk links are retained byte-for-byte as room
        // architecture and stay level. Some of those legacy catwalks are
        // reached through authored platform jumps that the tile-neighbor
        // solver cannot represent; they are not one of the new elevation
        // transfer mechanisms and do not gate progression.
        const accessibleFromOwnerRoom = locallyReachable.has(socket.floorKey)
          || (!isStrictSupplementConnector && (plan.level ?? 0) > 0);
        if (!accessibleFromOwnerRoom) {
          errors.push(`${socket.id} cannot be reached locally from ${socket.roomId} without crossing its connection first.`);
        }
        localSocketChecks.push({
          socketId: socket.id,
          roomId: socket.roomId,
          exactOwner: socketFloorHasExactOwner,
          exactElevation: socketFloorHasExactElevation,
          accessibleFromOwnerRoom,
          reachableLocalNodeCount: locallyReachable.size,
          totalLocalNodeCount: localTiles.length,
        });
      }
      const isSupplementConnector = Boolean(
        plan.isDungeonSupplement || plan.isPaddedByDungeonSupplement,
      );
      if (plan.requiredForProgression || plan.level > 0 || isSupplementConnector) {
        const traversalFloorKeys = plan.traversalFloorKeys?.length
          ? plan.traversalFloorKeys
          : isStrictSupplementConnector
            ? []
            : (plan.bridgePath ?? []).flatMap((point) => (
              columns.get(tileKey(point.x, point.z)) ?? []
            )).map((tile) => this._getFloorTileGraphKey(tile));
        const traversalFloorKeySet = new Set(traversalFloorKeys);
        const connectorFloorKeys = new Set([
          ...traversalFloorKeys,
          plan.fromSocket?.floorKey,
          plan.toSocket?.floorKey,
        ].filter(Boolean));
        const connectorFloors = [...connectorFloorKeys]
          .map((key) => navigableByKey.get(key))
          .filter(Boolean);
        const missingTraversalFloorKeys = [...connectorFloorKeys]
          .filter((key) => !navigableByKey.has(key));
        const connectorStart = navigableByKey.get(plan.fromSocket?.floorKey);
        const connectorCanTraverseEdge = isStrictSupplementConnector
          ? canTraverseStrictSupplementEdge
          : canTraverseEdge;
        const connectorReachable = this._createReachableFloorTileKeySet(
          connectorStart,
          connectorFloors,
          useSegmentBarriers ? {
            canTraverseEdge: connectorCanTraverseEdge,
          } : {},
        );
        const destinationFloorKey = plan.toSocket?.floorKey;
        const traversableOutward = connectorReachable.has(destinationFloorKey);
        const connectorFloorsThatCanReachSource = this._createFloorTileKeySetThatCanReach(
          connectorStart,
          connectorFloors,
          useSegmentBarriers ? {
            canTraverseEdge: connectorCanTraverseEdge,
          } : {},
        );
        const traversableReturn = connectorFloorsThatCanReachSource.has(destinationFloorKey);
        const locallyUnreachableTraversalFloorKeys = connectorFloors
          .map((floor) => this._getFloorTileGraphKey(floor))
          .filter((floorKey) => !connectorReachable.has(floorKey));
        const locallyNonReturnableTraversalFloorKeys = connectorFloors
          .map((floor) => this._getFloorTileGraphKey(floor))
          .filter((floorKey) => !connectorFloorsThatCanReachSource.has(floorKey));
        const strictLocalComponentAccepted = locallyUnreachableTraversalFloorKeys.length === 0
          && locallyNonReturnableTraversalFloorKeys.length === 0;
        connectorSpineChecks.push({
          connectionId: plan.id,
          level: plan.level ?? 0,
          variantId: plan.connectorVariantId ?? null,
          traversalKind: plan.connectorVariant?.traversalKind ?? 'walk',
          isDungeonSupplement: isSupplementConnector,
          traversableOutward,
          traversableReturn,
          missingTraversalFloorKeys,
          locallyReachableTraversalFloorCount: connectorReachable.size,
          locallyReturnableTraversalFloorCount: connectorFloorsThatCanReachSource.size,
          locallyUnreachableTraversalFloorKeys,
          locallyNonReturnableTraversalFloorKeys,
          strictLocalComponentAccepted,
          accepted: traversableOutward
            && traversableReturn
            && (!isStrictSupplementConnector || (
              missingTraversalFloorKeys.length === 0
              && strictLocalComponentAccepted
            )),
        });
        if (isStrictSupplementConnector && missingTraversalFloorKeys.length) {
          errors.push(
            `${plan.id} is missing ${missingTraversalFloorKeys.length} realized traversal floor(s), including ${missingTraversalFloorKeys[0]}.`,
          );
        }
        if (!traversableOutward) {
          errors.push(
            `${plan.id} ${plan.requiredForProgression ? 'required ' : ''}connector has no traversable spine between its sockets under the base movement envelope (variant=${plan.connectorVariantId ?? 'standard'}).`,
          );
        }
        if (!traversableReturn) {
          errors.push(
            `${plan.id} connector has no traversable return spine from destination to source under the base movement envelope (variant=${plan.connectorVariantId ?? 'standard'}).`,
          );
        }
        if (isStrictSupplementConnector && locallyUnreachableTraversalFloorKeys.length) {
          errors.push(
            `${plan.id} contains ${locallyUnreachableTraversalFloorKeys.length} realized traversal floor(s) outside its source-side connector component, including ${locallyUnreachableTraversalFloorKeys[0]}.`,
          );
        }
        if (isStrictSupplementConnector && locallyNonReturnableTraversalFloorKeys.length) {
          errors.push(
            `${plan.id} contains ${locallyNonReturnableTraversalFloorKeys.length} realized traversal floor(s) that cannot return to its source entrance, including ${locallyNonReturnableTraversalFloorKeys[0]}.`,
          );
        }

        if (isStrictSupplementConnector) {
          const connectorElevations = new Set(connectorFloors.map((floor) => (
            Number(floor.elevation ?? 0).toFixed(3)
          )));
          const connectorFloorKeySet = new Set(connectorFloors.map((floor) => (
            this._getFloorTileGraphKey(floor)
          )));
          const explicitVerticalLinks = connectorFloors.flatMap((floor) => (
            (floor.traversalLinks ?? []).filter((link) => (
              connectorFloorKeySet.has(link.toFloorKey)
              && ['ladder', 'automatic_lift'].includes(link.action)
            )).map((link) => ({
              id: link.id ?? null,
              fromFloorKey: this._getFloorTileGraphKey(floor),
              toFloorKey: link.toFloorKey,
              action: link.action,
            }))
          ));
          const contractLandingKeys = (contract, endpoint) => {
            const records = contract?.[`${endpoint}LandingTiles`] ?? [];
            const explicitKey = contract?.[`${endpoint}FloorKey`] ?? null;
            return [...new Set([
              ...records.map((record) => record?.floorKey).filter(Boolean),
              ...(explicitKey ? [explicitKey] : []),
            ])];
          };
          const createVerticalContractCheck = (kind, contract, aperturePoints) => {
            const expectedAction = kind === 'ladder' ? 'ladder' : 'automatic_lift';
            const bottomLandingFloorKeys = contractLandingKeys(contract, 'bottom');
            const topLandingFloorKeys = contractLandingKeys(contract, 'top');
            const landingFloorKeys = [...new Set([
              ...bottomLandingFloorKeys,
              ...topLandingFloorKeys,
            ])];
            const landingsRealized = bottomLandingFloorKeys.length > 0
              && topLandingFloorKeys.length > 0
              && landingFloorKeys.every((floorKey) => (
                navigableByKey.has(floorKey) && reachable.has(floorKey)
              ));
            const forwardLinkId = `${contract?.id}:forward`;
            const reverseLinkId = `${contract?.id}:reverse`;
            const matchingLinks = explicitVerticalLinks.filter(({ action, id }) => (
              action === expectedAction
              && (id === forwardLinkId || id === reverseLinkId)
            ));
            const forwardLink = matchingLinks.find(({ id }) => id === forwardLinkId) ?? null;
            const reverseLink = matchingLinks.find(({ id }) => id === reverseLinkId) ?? null;
            const bottomLandingFloorKeySet = new Set(bottomLandingFloorKeys);
            const topLandingFloorKeySet = new Set(topLandingFloorKeys);
            const linksJoinOppositeLandings = Boolean(
              forwardLink
              && reverseLink
              && forwardLink.fromFloorKey === reverseLink.toFloorKey
              && forwardLink.toFloorKey === reverseLink.fromFloorKey
              && (
                (
                  bottomLandingFloorKeySet.has(forwardLink.fromFloorKey)
                  && topLandingFloorKeySet.has(forwardLink.toFloorKey)
                )
                || (
                  topLandingFloorKeySet.has(forwardLink.fromFloorKey)
                  && bottomLandingFloorKeySet.has(forwardLink.toFloorKey)
                )
              )
            );
            const bidirectionalLinkRealized = Boolean(
              forwardLink && reverseLink && linksJoinOppositeLandings
            );
            const normalizedAperturePoints = (aperturePoints ?? [])
              .filter((point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.z)))
              .map((point) => ({ x: Number(point.x), z: Number(point.z) }));
            const createLandingApproachCheck = (endpoint, floorKeySet) => {
              const linkedFloorKey = [forwardLink, reverseLink]
                .flatMap((link) => link ? [link.fromFloorKey, link.toFloorKey] : [])
                .find((floorKey) => floorKeySet.has(floorKey)) ?? null;
              const floor = linkedFloorKey ? navigableByKey.get(linkedFloorKey) ?? null : null;
              const distances = floor
                ? normalizedAperturePoints.map((point) => ({
                    point,
                    distance: Math.abs(Number(floor.x) - point.x)
                      + Math.abs(Number(floor.z) - point.z),
                  }))
                : [];
              const minimumDistance = distances.length
                ? Math.min(...distances.map(({ distance }) => distance))
                : Number.POSITIVE_INFINITY;
              const nearestApertures = distances
                .filter(({ distance }) => Math.abs(distance - minimumDistance) <= 0.001)
                .map(({ point }) => point);
              const clearAperture = nearestApertures.find((point) => {
                const apertureThreshold = {
                  ...floor,
                  x: point.x,
                  z: point.z,
                  elevation: Number(floor.elevation ?? 0),
                };
                return !strictSupplementSegmentBarrierZones.some((zone) => (
                  this._doesFloorTraversalSegmentIntersectZone(
                    floor,
                    apertureThreshold,
                    zone,
                    PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
                  )
                ));
              }) ?? null;
              return {
                endpoint,
                linkedFloorKey,
                aperturePoint: clearAperture ?? nearestApertures[0] ?? null,
                approachDistanceTiles: Number.isFinite(minimumDistance) ? minimumDistance : null,
                accepted: Boolean(floor && clearAperture),
              };
            };
            const landingApproachChecks = [
              createLandingApproachCheck('bottom', bottomLandingFloorKeySet),
              createLandingApproachCheck('top', topLandingFloorKeySet),
            ];
            const landingApproachesClear = landingApproachChecks.every(({ accepted }) => accepted);
            return {
              id: contract?.id ?? null,
              kind,
              apertureKeys: new Set((aperturePoints ?? []).map((point) => (
                tileKey(Number(point.x), Number(point.z))
              ))),
              bottomLandingFloorKeys,
              topLandingFloorKeys,
              landingFloorKeys,
              landingsRealized,
              matchingLinks,
              linksJoinOppositeLandings,
              bidirectionalLinkRealized,
              landingApproachChecks,
              landingApproachesClear,
              accepted: Boolean(
                contract?.id
                && (aperturePoints?.length ?? 0) > 0
                && landingsRealized
                && bidirectionalLinkRealized
                && landingApproachesClear
              ),
            };
          };
          const fallbackLadderPoints = (plan.connectorVariant?.mechanisms ?? [])
            .filter(({ type }) => type === 'ladder')
            .map(({ gridPoint }) => gridPoint)
            .filter(Boolean);
          const ladderContractChecks = (plan.ladderContracts ?? []).map((contract) => (
            createVerticalContractCheck(
              'ladder',
              contract,
              contract.apertureGridPoint
                ? [contract.apertureGridPoint]
                : fallbackLadderPoints,
            )
          ));
          const fallbackLiftShaftPoints = plan.connectorVariant?.liftShaft?.gridColumns ?? [];
          const liftContractChecks = (plan.liftContracts ?? []).map((contract) => (
            createVerticalContractCheck(
              'lift',
              contract,
              contract.liftShaft?.gridColumns ?? fallbackLiftShaftPoints,
            )
          ));
          const verticalContractChecks = [
            ...ladderContractChecks,
            ...liftContractChecks,
          ];
          const centerlinePath = plan.bridgePath ?? [];
          const centerlineChecks = centerlinePath.map((point, pathIndex) => {
            const candidates = columns.get(tileKey(point.x, point.z)) ?? [];
            const indexedSectionElevations = (plan.galleryCrossSections ?? [])
              .filter((crossSection) => Number(crossSection?.pathIndex) === pathIndex)
              .flatMap((crossSection) => crossSection.sections ?? [])
              .map((section) => Number(section?.elevation))
              .filter(Number.isFinite);
            const explicitPointElevation = Number(point?.elevation ?? point?.y);
            const endpointElevation = pathIndex === 0
              ? Number(plan.fromSocket?.elevation ?? plan.sourceElevation ?? plan.elevation)
              : pathIndex === centerlinePath.length - 1
                ? Number(plan.toSocket?.elevation ?? plan.destinationElevation ?? plan.elevation)
                : Number.NaN;
            const levelConnectorElevation = Math.abs(Number(plan.elevationDelta ?? 0)) <= 0.05
              ? Number(plan.sourceElevation ?? plan.elevation)
              : Number.NaN;
            const expectedElevationCandidates = indexedSectionElevations.length
              ? indexedSectionElevations
              : Number.isFinite(explicitPointElevation)
                ? [explicitPointElevation]
                : Number.isFinite(endpointElevation)
                  ? [endpointElevation]
                  : Number.isFinite(levelConnectorElevation)
                    ? [levelConnectorElevation]
                    : [];
            const expectedElevations = [...new Set(expectedElevationCandidates
              .map((elevation) => elevation.toFixed(3)))]
              .map(Number);
            const ownedFloor = candidates.find((floor) => (
              traversalFloorKeySet.has(this._getFloorTileGraphKey(floor))
              && expectedElevations.some((expectedElevation) => (
                Math.abs(Number(floor.elevation ?? 0) - expectedElevation) <= 0.05
              ))
              && (
                floorOwnedByConnection(floor, plan.id)
                || (
                  floor.roomId
                  && [plan.fromRoomId, plan.toRoomId].includes(floor.roomId)
                )
              )
            ));
            const verticalContract = !ownedFloor
              ? verticalContractChecks.find((check) => (
                  check.accepted && check.apertureKeys.has(tileKey(point.x, point.z))
                )) ?? null
              : null;
            return {
              pathIndex,
              x: point.x,
              z: point.z,
              expectedElevation: expectedElevations.length === 1
                ? expectedElevations[0]
                : null,
              expectedElevations,
              elevation: ownedFloor ? Number(ownedFloor.elevation ?? 0) : null,
              elevationMatchesExpected: Boolean(ownedFloor),
              floorKey: ownedFloor ? this._getFloorTileGraphKey(ownedFloor) : null,
              ownerId: ownedFloor?.signedConnectorFloorOwnerId
                ?? ownedFloor?.connectorId
                ?? ownedFloor?.connectionId
                ?? null,
              realizationKind: ownedFloor
                ? 'owned-floor'
                : verticalContract
                  ? `${verticalContract.kind}-contract`
                  : 'missing',
              traversalContractId: verticalContract?.id ?? null,
              contractTraversal: Boolean(verticalContract),
              reachable: Boolean(
                verticalContract
                || (ownedFloor && reachable.has(this._getFloorTileGraphKey(ownedFloor)))
              ),
            };
          });
          const missingOwnedCenterlinePoints = centerlineChecks.filter((check) => (
            !check.floorKey && !check.contractTraversal
          ));
          const unreachableCenterlinePoints = centerlineChecks.filter((check) => (
            !check.reachable
          ));
          const hasRampTransfer = connectorFloors.some((floor) => (
            floor.surface === 'industrialRamp'
          )) && connectorElevations.size > 1;
          const needsVerticalTransfer = Math.abs(Number(plan.elevationDelta ?? 0)) > 0.05;
          const hasRealVerticalTransfer = !needsVerticalTransfer
            || verticalContractChecks.some(({ accepted: contractAccepted }) => contractAccepted)
            || hasRampTransfer;
          const accepted = traversableOutward
            && traversableReturn
            && missingTraversalFloorKeys.length === 0
            && strictLocalComponentAccepted
            && missingOwnedCenterlinePoints.length === 0
            && unreachableCenterlinePoints.length === 0
            && hasRealVerticalTransfer;
          supplementConnectivityChecks.push({
            connectionId: plan.id,
            operationId: plan.augmentationOperationId ?? null,
            topologyTemplateId: plan.topologyTemplateId ?? null,
            fromRoomId: plan.fromRoomId,
            toRoomId: plan.toRoomId,
            centerlinePointCount: centerlineChecks.length,
            centerlineChecks,
            missingOwnedCenterlinePointCount: missingOwnedCenterlinePoints.length,
            unreachableCenterlinePointCount: unreachableCenterlinePoints.length,
            locallyReachableTraversalFloorCount: connectorReachable.size,
            locallyReturnableTraversalFloorCount: connectorFloorsThatCanReachSource.size,
            locallyUnreachableTraversalFloorKeys,
            locallyNonReturnableTraversalFloorKeys,
            strictLocalComponentAccepted,
            connectorElevationCount: connectorElevations.size,
            explicitVerticalLinks,
            verticalContractChecks: verticalContractChecks.map((check) => ({
              ...check,
              apertureKeys: [...check.apertureKeys].sort(),
            })),
            hasRampTransfer,
            needsVerticalTransfer,
            hasRealVerticalTransfer,
            accepted,
          });
          if (missingOwnedCenterlinePoints.length) {
            const first = missingOwnedCenterlinePoints[0];
            errors.push(
              `${plan.id} has ${missingOwnedCenterlinePoints.length} centerline point(s) without a realized floor owned by that connector, including ${first.x},${first.z}.`,
            );
          }
          if (unreachableCenterlinePoints.length) {
            const first = unreachableCenterlinePoints[0];
            errors.push(
              `${plan.id} has ${unreachableCenterlinePoints.length} orphaned realized centerline floor(s), including ${first.floorKey}.`,
            );
          }
          for (const contractCheck of verticalContractChecks) {
            for (const approachCheck of contractCheck.landingApproachChecks
              .filter(({ accepted: approachAccepted }) => !approachAccepted)) {
              errors.push(
                `${plan.id} ${contractCheck.kind} ${approachCheck.endpoint} landing has no barrier-clear approach to its exact shaft aperture.`,
              );
            }
          }
          if (!hasRealVerticalTransfer) {
            errors.push(
              `${plan.id} changes elevation without an assembled ramp, ladder, or lift joining its levels.`,
            );
          }
        }
      }
      const authoredExteriorSectionCount = plan.galleryCrossSections?.length ?? 0;
      // Supplemental routes inherit their dressing from the parent theme
      // session. Require one visible inherited beat while retaining V1's
      // denser two-beat service-gallery rule for wholly authored connectors.
      const inheritsSupplementPresentation = Boolean(
        plan.isDungeonSupplement || plan.isPaddedByDungeonSupplement
      );
      const requiredExplorationBeatCount = Math.min(
        inheritsSupplementPresentation ? 1 : 2,
        authoredExteriorSectionCount,
      );
      if (
        plan.level === 0
        && !isStrictSupplementConnector
        && requiredExplorationBeatCount > 0
        && !RUIN_OPEN_AIR_ROOM_TYPES.has(roomById.get(plan.fromRoomId)?.type)
        && !RUIN_OPEN_AIR_ROOM_TYPES.has(roomById.get(plan.toRoomId)?.type)
        && (plan.explorationBeats?.length ?? 0) < requiredExplorationBeatCount
      ) {
        errors.push(`${plan.id} lacks authored connector exploration beats.`);
      }
    }

    const globallyReturnableToStart = this._createFloorTileKeySetThatCanReach(
      startTile,
      navigableTiles,
      useSegmentBarriers ? { canTraverseEdge } : {},
    );

    for (const room of rooms.filter((candidate) => (
      candidate.isDungeonSupplement
      && (
        candidate.augmentationOperationType === 'routeNetwork'
        || physicalSupplementPlans.length > 0
      )
    ))) {
      // X/Z footprint membership is insufficient for supplements: a route at
      // another elevation can occupy the same columns. Require the realized
      // room's own floor records so an overhead path cannot make an orphaned
      // underpass (or an overwritten room) appear accessible.
      const allRoomOwnedFloors = floorTiles.filter((tile) => tile.roomId === room.id);
      // Use the same full X/Y/Z collision realization as runtime navigation.
      // A single authored record may cover several floor columns (partitions,
      // machinery banks, guard runs), so its center grid key is not a complete
      // description of the floors it intentionally blocks.
      const authoredBlockingSolidZones =
        this._createDungeonSupplementManifestSolidZones([room]);
      const authoredBlockingRoomFloorKeys = allRoomOwnedFloors
        .filter((floor) => {
          const floorPosition = this._floorTileToWorld(floor);
          return authoredBlockingSolidZones.some((zone) => (
            this._isPositionInsideZone(floorPosition, zone)
          ));
        })
        .map((floor) => this._getFloorTileGraphKey(floor));
      const authoredBlockingRoomFloorKeySet = new Set(authoredBlockingRoomFloorKeys);
      const localFloors = allRoomOwnedFloors.filter((tile) => (
        navigableByKey.has(this._getFloorTileGraphKey(tile))
      ));
      const isTrueSupplementRoom = room.isConnectorJunctionProxy !== true
        && room.isRouteStationProxy !== true
        && room.suppressRoomGeometry !== true;
      const attachedPhysicalPlans = physicalSupplementPlans.filter((plan) => (
        plan.fromRoomId === room.id || plan.toRoomId === room.id
      ));
      const attachedPhysicalPlanIds = new Set(attachedPhysicalPlans.map((plan) => plan.id));
      const isExactRoomConnectorThresholdFloor = (floor) => attachedPhysicalPlans.some((plan) => (
        [plan.fromSocket, plan.toSocket].some((socket) => (
          socket?.roomId === room.id
          && Math.abs(Number(socket.elevation ?? 0) - Number(floor.elevation ?? 0)) <= 0.05
          && isPointInsideExactConnectorThreshold(plan, floor, room.id)
        ))
      ));
      // V4 rooms own an authored floor mask. Earlier supplement revisions own
      // the inclusive rectangular facade footprint instead. In both cases the
      // physical validator consumes the same definition that stamped the
      // floors, so a surviving strip, overpass, or unrelated floor cannot make
      // an incomplete module appear traversable.
      const roomBaseElevation = Number(room.baseElevation ?? 0);
      const facadeHalfWidthTiles = Math.floor(Number(room.width ?? 0) / 2);
      const facadeHalfDepthTiles = Math.floor(Number(room.depth ?? 0) / 2);
      const authoredFloorMaskCells = supplementRoomFloorMaskCells(room);
      const usesAuthoredFloorMask = Array.isArray(authoredFloorMaskCells)
        && authoredFloorMaskCells.length > 0;
      const authoritativeDeclaredRoomFloorKeys = new Set([
        ...(room.augmentationFloorTiers ?? [])
          .filter((tier) => tier?.authoritative === true && Array.isArray(tier.worldCells))
          .flatMap((tier) => tier.worldCells.map((cell) => ({
            x: Number(cell?.grid?.x),
            z: Number(cell?.grid?.z),
            elevation: Number(cell?.elevation ?? tier.worldElevation),
          }))),
        ...(room.augmentationTransfers ?? [])
          .filter((transfer) => (
            transfer?.authoritative !== false
              && ['ramp', 'stairs', 'landing'].includes(
                normalizeDungeonSupplementBlueprintTransferForm(transfer),
              )
              && Array.isArray(transfer.worldCells)
          ))
          .flatMap((transfer) => transfer.worldCells.map((cell) => ({
            x: Number(cell?.grid?.x),
            z: Number(cell?.grid?.z),
            elevation: Number(cell?.elevation ?? cell?.worldElevation),
          }))),
      ].filter(({ x, z, elevation }) => (
        Number.isInteger(x) && Number.isInteger(z) && Number.isFinite(elevation)
      )).map((cell) => this._getFloorTileGraphKey(cell)));
      const expectedBaseFootprintColumnKeys = usesAuthoredFloorMask
        ? [...new Set(authoredFloorMaskCells.map(({ x, z }) => tileKey(x, z)))]
        : [];
      if (isTrueSupplementRoom) {
        if (!usesAuthoredFloorMask) {
          for (
            let x = Number(room.x) - facadeHalfWidthTiles;
            x <= Number(room.x) + facadeHalfWidthTiles;
            x += 1
          ) {
            for (
              let z = Number(room.z) - facadeHalfDepthTiles;
              z <= Number(room.z) + facadeHalfDepthTiles;
              z += 1
            ) {
              expectedBaseFootprintColumnKeys.push(tileKey(x, z));
            }
          }
        }
      }
      const expectedBaseFootprintColumnKeySet = new Set(expectedBaseFootprintColumnKeys);
      const outsideDeclaredRoomFloorKeys = allRoomOwnedFloors
        .filter((floor) => (
          !(authoritativeDeclaredRoomFloorKeys.size > 0
            ? authoritativeDeclaredRoomFloorKeys.has(this._getFloorTileGraphKey(floor))
            : expectedBaseFootprintColumnKeySet.has(tileKey(floor.x, floor.z)))
          && !isExactRoomConnectorThresholdFloor(floor)
        ))
        .map((floor) => this._getFloorTileGraphKey(floor));
      const nonNavigableRoomFloorKeys = allRoomOwnedFloors
        .filter((floor) => !navigableByKey.has(this._getFloorTileGraphKey(floor)))
        .map((floor) => this._getFloorTileGraphKey(floor));
      const unexpectedNonNavigableRoomFloorKeys = nonNavigableRoomFloorKeys
        .filter((floorKey) => !authoredBlockingRoomFloorKeySet.has(floorKey));
      const permittedRoomFloorOwnerIds = new Set([
        String(room.id),
        ...[...attachedPhysicalPlanIds].map(String),
      ]);
      const foreignRoomFloorOwnership = allRoomOwnedFloors.flatMap((floor) => (
        (floor.mergedFloorOwnerIds ?? physicalFloorOwnerIds(floor))
          .map(String)
          .filter((ownerId) => (
            !permittedRoomFloorOwnerIds.has(ownerId)
            && !isExactRoomConnectorThresholdFloor(floor)
          ))
          .map((ownerId) => ({
            floorKey: this._getFloorTileGraphKey(floor),
            ownerId,
          }))
      ));
      const roomOwnedBaseFloorsByColumn = new Map();
      for (const floor of floorTiles.filter((tile) => (
        tile.roomId === room.id
        && (
          Math.abs(Number(tile.elevation ?? 0) - roomBaseElevation) <= 0.05
          || (
            tile.rampBaseOriginal?.roomId === room.id
            && Math.abs(
              Number(tile.rampBaseOriginal?.elevation ?? 0) - roomBaseElevation,
            ) <= 0.05
          )
        )
      ))) {
        const columnKey = tileKey(floor.x, floor.z);
        const previous = roomOwnedBaseFloorsByColumn.get(columnKey);
        const floorBaseDistance = floor.rampBaseOriginal?.roomId === room.id
          ? Math.min(
            Math.abs(Number(floor.elevation ?? 0) - roomBaseElevation),
            Math.abs(Number(floor.rampBaseOriginal?.elevation ?? 0) - roomBaseElevation),
          )
          : Math.abs(Number(floor.elevation ?? 0) - roomBaseElevation);
        const previousBaseDistance = previous?.rampBaseOriginal?.roomId === room.id
          ? Math.min(
            Math.abs(Number(previous.elevation ?? 0) - roomBaseElevation),
            Math.abs(Number(previous.rampBaseOriginal?.elevation ?? 0) - roomBaseElevation),
          )
          : Math.abs(Number(previous?.elevation ?? 0) - roomBaseElevation);
        if (
          !previous
          || floorBaseDistance < previousBaseDistance
        ) {
          roomOwnedBaseFloorsByColumn.set(columnKey, floor);
        }
      }
      const missingBaseFootprintColumnKeys = expectedBaseFootprintColumnKeys.filter((columnKey) => (
        !roomOwnedBaseFloorsByColumn.has(columnKey)
      ));
      const nonNavigableBaseFootprintFloorKeys = expectedBaseFootprintColumnKeys
        .map((columnKey) => roomOwnedBaseFloorsByColumn.get(columnKey))
        .filter(Boolean)
        .map((floor) => this._getFloorTileGraphKey(floor))
        .filter((floorKey) => (
          !navigableByKey.has(floorKey)
          && !authoredBlockingRoomFloorKeySet.has(floorKey)
        ));
      const reachableFloors = localFloors.filter((tile) => (
        reachable.has(this._getFloorTileGraphKey(tile))
      ));
      const orphanFloorKeys = localFloors
        .filter((tile) => !reachable.has(this._getFloorTileGraphKey(tile)))
        .map((tile) => this._getFloorTileGraphKey(tile));
      const traversablePhysicalPlanIds = new Set(supplementConnectivityChecks
        .filter(({ accepted: connectorAccepted }) => connectorAccepted)
        .map(({ connectionId }) => String(connectionId)));
      const traversablePhysicalConnectionIds = attachedPhysicalPlans
        .map(({ id }) => String(id))
        .filter((connectionId) => traversablePhysicalPlanIds.has(connectionId));
      const horizontalRoomSpans = [Number(room.width ?? 0), Number(room.depth ?? 0)]
        .sort((first, second) => first - second);
      const hasAuthoredV4Manifest = Boolean(room.augmentationModuleManifest);
      const meetsSubstantiveRoomFootprint = hasAuthoredV4Manifest
        ? (
          usesAuthoredFloorMask
          && expectedBaseFootprintColumnKeys.length > 0
          && room.augmentationModuleKind !== 'connector'
        )
        : (
          horizontalRoomSpans[0] >= 13
          && horizontalRoomSpans[1] >= 15
        );
      const connectedSocketIds = attachedPhysicalPlans.flatMap((plan) => (
        [plan.fromSocket, plan.toSocket]
          .filter((socket) => socket?.roomId === room.id)
          .map((socket) => socket.id)
      ));
      const socketApproaches = attachedPhysicalPlans.flatMap((plan) => (
        [plan.fromSocket, plan.toSocket]
          .filter((socket) => socket?.roomId === room.id)
          .map((socket) => ({
            socketId: socket.id,
            connectionId: plan.id,
            floor: navigableByKey.get(socket.floorKey) ?? null,
          }))
      ));
      const uniqueSocketApproaches = [...new Map(socketApproaches.map((approach) => [
        approach.floor ? this._getFloorTileGraphKey(approach.floor) : approach.socketId,
        approach,
      ])).values()];
      const localTraversalFloors = navigableTiles.filter((tile) => (
        (
          this._isTileInsideRoom(tile, room)
          || isExactRoomConnectorThresholdFloor(tile)
        )
        && (
          tile.roomId === room.id
          || [...attachedPhysicalPlanIds].some((planId) => (
            floorOwnedByConnection(tile, planId)
          ))
        )
      ));
      const firstApproachFloor = uniqueSocketApproaches.find(({ floor }) => floor)?.floor ?? null;
      const locallyReachableFromFirstApproach = this._createReachableFloorTileKeySet(
        firstApproachFloor,
        localTraversalFloors,
        useSegmentBarriers ? { canTraverseEdge: canTraverseStrictSupplementEdge } : {},
      );
      const locallyReturnableToFirstApproach = this._createFloorTileKeySetThatCanReach(
        firstApproachFloor,
        localTraversalFloors,
        useSegmentBarriers ? { canTraverseEdge: canTraverseStrictSupplementEdge } : {},
      );
      const localApproachChecks = uniqueSocketApproaches.map((approach) => {
        const floorKey = approach.floor
          ? this._getFloorTileGraphKey(approach.floor)
          : null;
        return {
          socketId: approach.socketId,
          connectionId: approach.connectionId,
          floorKey,
          reachableFromFirstApproach: Boolean(
            floorKey && locallyReachableFromFirstApproach.has(floorKey)
          ),
          returnReachable: Boolean(
            floorKey && locallyReturnableToFirstApproach.has(floorKey)
          ),
        };
      });
      const locallyUnreachableRoomFloorKeys = localFloors
        .map((tile) => this._getFloorTileGraphKey(tile))
        .filter((floorKey) => !locallyReachableFromFirstApproach.has(floorKey));
      const locallyNonReturnableRoomFloorKeys = localFloors
        .map((tile) => this._getFloorTileGraphKey(tile))
        .filter((floorKey) => !locallyReturnableToFirstApproach.has(floorKey));
      const globallyNonReturnableRoomFloorKeys = localFloors
        .map((tile) => this._getFloorTileGraphKey(tile))
        .filter((floorKey) => !globallyReturnableToStart.has(floorKey));
      const baseFootprintFloorKeys = expectedBaseFootprintColumnKeys
        .map((columnKey) => roomOwnedBaseFloorsByColumn.get(columnKey))
        .filter(Boolean)
        .map((floor) => this._getFloorTileGraphKey(floor));
      const traversableBaseFootprintFloorKeys = baseFootprintFloorKeys.filter((floorKey) => (
        !authoredBlockingRoomFloorKeySet.has(floorKey)
      ));
      const globallyUnreachableBaseFootprintFloorKeys = traversableBaseFootprintFloorKeys.filter((floorKey) => (
        !reachable.has(floorKey)
      ));
      const locallyUnreachableBaseFootprintFloorKeys = traversableBaseFootprintFloorKeys.filter((floorKey) => (
        !locallyReachableFromFirstApproach.has(floorKey)
      ));
      const locallyNonReturnableBaseFootprintFloorKeys = traversableBaseFootprintFloorKeys.filter((floorKey) => (
        !locallyReturnableToFirstApproach.has(floorKey)
      ));
      const baseFootprintCoverageAccepted = !isTrueSupplementRoom
        || (
          expectedBaseFootprintColumnKeys.length > 0
          && missingBaseFootprintColumnKeys.length === 0
          && nonNavigableBaseFootprintFloorKeys.length === 0
          && globallyUnreachableBaseFootprintFloorKeys.length === 0
          && locallyUnreachableBaseFootprintFloorKeys.length === 0
          && locallyNonReturnableBaseFootprintFloorKeys.length === 0
        );
      const localRoomConnectivityAccepted = uniqueSocketApproaches.length > 0
        && uniqueSocketApproaches.length === socketApproaches.length
        && localApproachChecks.every((check) => (
          check.floorKey
          && check.reachableFromFirstApproach
          && check.returnReachable
        ))
        && locallyUnreachableRoomFloorKeys.length === 0
        && locallyNonReturnableRoomFloorKeys.length === 0
        && globallyNonReturnableRoomFloorKeys.length === 0
        && unexpectedNonNavigableRoomFloorKeys.length === 0
        && outsideDeclaredRoomFloorKeys.length === 0
        && foreignRoomFloorOwnership.length === 0
        && baseFootprintCoverageAccepted;
      const accepted = attachedPhysicalPlans.length > 0
        && connectedSocketIds.length > 0
        && traversablePhysicalConnectionIds.length > 0
        && meetsSubstantiveRoomFootprint
        && baseFootprintCoverageAccepted
        && reachableFloors.length > 0
        && orphanFloorKeys.length === 0
        && globallyNonReturnableRoomFloorKeys.length === 0
        && unexpectedNonNavigableRoomFloorKeys.length === 0
        && outsideDeclaredRoomFloorKeys.length === 0
        && foreignRoomFloorOwnership.length === 0
        && localRoomConnectivityAccepted;
      supplementRoomConnectivityChecks.push({
        roomId: room.id,
        operationId: room.augmentationOperationId ?? null,
        routeStationProxy: room.isRouteStationProxy === true,
        attachedPhysicalConnectionIds: attachedPhysicalPlans.map((plan) => plan.id),
        traversablePhysicalConnectionIds,
        widthTiles: Number(room.width ?? 0),
        depthTiles: Number(room.depth ?? 0),
        rotationQuarterTurns: Number(room.augmentationRotationQuarterTurns ?? 0),
        usesAuthoredFloorMask,
        authoredModuleTemplateId: room.augmentationModuleTemplateId ?? null,
        authoredModuleKind: room.augmentationModuleKind ?? null,
        meetsSubstantiveRoomFootprint,
        expectedBaseFootprintFloorCount: expectedBaseFootprintColumnKeys.length,
        realizedBaseFootprintFloorCount: baseFootprintFloorKeys.length,
        missingBaseFootprintColumnKeys,
        nonNavigableBaseFootprintFloorKeys,
        globallyUnreachableBaseFootprintFloorKeys,
        locallyUnreachableBaseFootprintFloorKeys,
        locallyNonReturnableBaseFootprintFloorKeys,
        baseFootprintCoverageAccepted,
        connectedSocketIds,
        reachableFloorCount: reachableFloors.length,
        totalNavigableFloorCount: localFloors.length,
        realizedRoomOwnedFloorCount: allRoomOwnedFloors.length,
        authoredBlockingRoomFloorKeys,
        authoredBlockingRoomFloorCount: authoredBlockingRoomFloorKeys.length,
        nonNavigableRoomFloorKeys,
        unexpectedNonNavigableRoomFloorKeys,
        outsideDeclaredRoomFloorKeys,
        foreignRoomFloorOwnership,
        orphanFloorKeys,
        localApproachChecks,
        distinctLocalApproachCount: uniqueSocketApproaches.length,
        localTraversalFloorCount: localTraversalFloors.length,
        locallyReachableFloorCount: locallyReachableFromFirstApproach.size,
        locallyReturnableFloorCount: locallyReturnableToFirstApproach.size,
        locallyUnreachableRoomFloorKeys,
        locallyNonReturnableRoomFloorKeys,
        globallyNonReturnableRoomFloorKeys,
        localRoomConnectivityAccepted,
        accepted,
      });

      const junction = room.augmentationJunction ?? room.junction ?? null;
      if (junction || room.junctionKind) {
        const approachFloors = attachedPhysicalPlans.flatMap((plan) => (
          [plan.fromSocket, plan.toSocket]
            .filter((socket) => socket?.roomId === room.id)
            .map((socket) => ({
              id: socket.id,
              floor: navigableByKey.get(socket.floorKey) ?? null,
              kind: 'supplement-connector',
            }))
        ));
        if (room.isRouteStationProxy && room.parentRouteId) {
          const parentPlan = connectionPlans.find((plan) => plan.id === room.parentRouteId);
          const parentPath = parentPlan?.bridgePath ?? parentPlan?.fullPath ?? [];
          const stationIndex = parentPath.findIndex((point) => (
            point.x === room.x && point.z === room.z
          ));
          for (const [kind, point] of [
            ['parent-route-before', parentPath[stationIndex - 1]],
            ['parent-route-after', parentPath[stationIndex + 1]],
          ]) {
            if (!point) continue;
            const floor = (columns.get(tileKey(point.x, point.z)) ?? [])
              .filter((candidate) => navigableByKey.has(this._getFloorTileGraphKey(candidate)))
              .filter((candidate) => floorOwnedByConnection(candidate, parentPlan.id))
              .filter((candidate) => (
                Math.abs(
                  Number(candidate.elevation ?? 0) - Number(room.baseElevation ?? 0),
                ) <= 0.05
              ))
              .sort((left, right) => (
                Math.abs(Number(left.elevation ?? 0) - Number(room.baseElevation ?? 0))
                - Math.abs(Number(right.elevation ?? 0) - Number(room.baseElevation ?? 0))
              ))[0] ?? null;
            approachFloors.push({
              id: `${room.id}:${kind}`,
              floor,
              kind,
            });
          }
        }
        const uniqueApproaches = [...new Map(approachFloors.map((approach) => [
          approach.floor ? this._getFloorTileGraphKey(approach.floor) : approach.id,
          approach,
        ])).values()];
        const localJunctionTiles = navigableTiles.filter((tile) => (
          this._isTileInsideRoom(tile, room)
          && (
            tile.roomId === room.id
            || [...attachedPhysicalPlanIds].some((planId) => (
              floorOwnedByConnection(tile, planId)
            ))
            || (
              room.isRouteStationProxy
              && room.parentRouteId
              && floorOwnedByConnection(tile, room.parentRouteId)
            )
          )
        ));
        const localReachable = this._createReachableFloorTileKeySet(
          uniqueApproaches.find((approach) => approach.floor)?.floor ?? null,
          localJunctionTiles,
          useSegmentBarriers ? { canTraverseEdge: canTraverseStrictSupplementEdge } : {},
        );
        const localReturnable = this._createFloorTileKeySetThatCanReach(
          uniqueApproaches.find((approach) => approach.floor)?.floor ?? null,
          localJunctionTiles,
          useSegmentBarriers ? { canTraverseEdge: canTraverseStrictSupplementEdge } : {},
        );
        const approachChecks = uniqueApproaches.map((approach) => ({
          id: approach.id,
          kind: approach.kind,
          floorKey: approach.floor ? this._getFloorTileGraphKey(approach.floor) : null,
          locallyReachable: Boolean(
            approach.floor
            && localReachable.has(this._getFloorTileGraphKey(approach.floor))
          ),
          returnReachable: Boolean(
            approach.floor
            && localReturnable.has(this._getFloorTileGraphKey(approach.floor))
          ),
        }));
        const junctionAccepted = approachChecks.length >= 3
          && approachChecks.every((approach) => (
            approach.floorKey
            && approach.locallyReachable
            && approach.returnReachable
          ));
        supplementJunctionConnectivityChecks.push({
          roomId: room.id,
          operationId: room.augmentationOperationId ?? null,
          junctionKind: room.junctionKind ?? junction?.junctionKind ?? null,
          routeStationProxy: room.isRouteStationProxy === true,
          approachChecks,
          approachCount: approachChecks.length,
          locallyReachableFloorCount: localReachable.size,
          locallyReturnableFloorCount: localReturnable.size,
          accepted: junctionAccepted,
        });
        if (!junctionAccepted) {
          errors.push(
            `${room.id} junction does not provide a locally clear approach-to-approach route across at least three active apertures.`,
          );
        }
      }
      if (!attachedPhysicalPlans.length || !connectedSocketIds.length) {
        errors.push(`${room.id} has no exact, physically assembled supplemental connector.`);
      }
      if (!traversablePhysicalConnectionIds.length) {
        errors.push(`${room.id} has no bidirectionally traversable physical corridor connector.`);
      }
      if (!meetsSubstantiveRoomFootprint) {
        errors.push(hasAuthoredV4Manifest
          ? `${room.id} does not provide a non-empty authored V4 floor mask for a substantive module.`
          : `${room.id} is ${Number(room.width ?? 0)}x${Number(room.depth ?? 0)} tiles; this legacy supplemental room does not meet its replay footprint contract.`);
      }
      if (!reachableFloors.length) {
        errors.push(`${room.id} has no supplemental floor reachable through an assembled connector.`);
      }
      if (!baseFootprintCoverageAccepted) {
        const firstFailure = missingBaseFootprintColumnKeys[0]
          ?? nonNavigableBaseFootprintFloorKeys[0]
          ?? globallyUnreachableBaseFootprintFloorKeys[0]
          ?? locallyUnreachableBaseFootprintFloorKeys[0]
          ?? locallyNonReturnableBaseFootprintFloorKeys[0]
          ?? 'unknown';
        errors.push(
          `${room.id} does not physically realize its complete ${expectedBaseFootprintColumnKeys.length}-tile declared base-floor footprint with room-owned, reachable, returnable floors (realized=${baseFootprintFloorKeys.length}, missing=${missingBaseFootprintColumnKeys.length}, blocked=${nonNavigableBaseFootprintFloorKeys.length}, unreachable=${globallyUnreachableBaseFootprintFloorKeys.length}, local=${locallyUnreachableBaseFootprintFloorKeys.length}, nonreturnable=${locallyNonReturnableBaseFootprintFloorKeys.length}, first=${firstFailure}).`,
        );
      }
      if (orphanFloorKeys.length) {
        errors.push(
          `${room.id} contains ${orphanFloorKeys.length} orphaned walkable floor(s), including ${orphanFloorKeys[0]}.`,
        );
      }
      if (unexpectedNonNavigableRoomFloorKeys.length) {
        errors.push(
          `${room.id} contains ${unexpectedNonNavigableRoomFloorKeys.length} unexpectedly blocked room-owned floor(s), including ${unexpectedNonNavigableRoomFloorKeys[0]}.`,
        );
      }
      if (outsideDeclaredRoomFloorKeys.length) {
        errors.push(
          `${room.id} contains ${outsideDeclaredRoomFloorKeys.length} room-owned floor(s) outside its declared footprint and exact connector thresholds, including ${outsideDeclaredRoomFloorKeys[0]}.`,
        );
      }
      if (foreignRoomFloorOwnership.length) {
        const first = foreignRoomFloorOwnership[0];
        errors.push(
          `${room.id} merged with unrelated floor owner ${first.ownerId} at ${first.floorKey}.`,
        );
      }
      if (globallyNonReturnableRoomFloorKeys.length) {
        errors.push(
          `${room.id} contains ${globallyNonReturnableRoomFloorKeys.length} room-owned floor(s) that cannot return to the dungeon start, including ${globallyNonReturnableRoomFloorKeys[0]}.`,
        );
      }
      if (!localRoomConnectivityAccepted) {
        errors.push(
          `${room.id} does not provide one locally clear, bidirectional component from every exact connector approach through all of its realized floors.`,
        );
      }
    }

    for (const junction of rooms.filter((candidate) => (
      candidate.isConnectorJunctionProxy === true
    ))) {
      const attachedPhysicalPlans = physicalSupplementPlans.filter((plan) => (
        plan.fromRoomId === junction.id || plan.toRoomId === junction.id
      ));
      const attachedPhysicalPlanIds = new Set(attachedPhysicalPlans.map((plan) => String(plan.id)));
      const traversablePhysicalPlanIds = new Set(supplementConnectivityChecks
        .filter(({ accepted: connectorAccepted }) => connectorAccepted)
        .map(({ connectionId }) => String(connectionId)));
      const attachedConnectorsTraversable = attachedPhysicalPlans.length > 0
        && [...attachedPhysicalPlanIds].every((planId) => traversablePhysicalPlanIds.has(planId));
      const approachFloors = attachedPhysicalPlans.flatMap((plan) => (
        [plan.fromSocket, plan.toSocket]
          .filter((socket) => socket?.roomId === junction.id)
          .map((socket) => {
            const floor = navigableByKey.get(socket.floorKey) ?? null;
            return {
              id: socket.id,
              kind: 'supplement-connector',
              connectionId: plan.id,
              expectedElevation: Number(socket.elevation ?? junction.baseElevation ?? 0),
              floor,
            };
          })
      ));
      const parentPlan = junction.isRouteStationProxy && junction.parentRouteId
        ? connectionPlans.find((plan) => plan.id === junction.parentRouteId) ?? null
        : null;
      const parentPath = parentPlan?.bridgePath ?? parentPlan?.fullPath ?? [];
      const stationIndex = parentPath.findIndex((point) => (
        point.x === junction.x && point.z === junction.z
      ));
      if (parentPlan && stationIndex >= 0) {
        for (const [kind, point] of [
          ['parent-route-before', parentPath[stationIndex - 1]],
          ['parent-route-after', parentPath[stationIndex + 1]],
        ]) {
          if (!point) continue;
          const expectedElevation = Number(
            point.elevation
              ?? parentPlan.sourceElevation
              ?? parentPlan.elevation
              ?? junction.baseElevation
              ?? 0,
          );
          const floor = (columns.get(tileKey(point.x, point.z)) ?? [])
            .filter((candidate) => navigableByKey.has(this._getFloorTileGraphKey(candidate)))
            .filter((candidate) => floorMatchesElevation(candidate, expectedElevation))
            .sort((left, right) => (
              Number(floorOwnedByConnection(right, parentPlan.id))
                - Number(floorOwnedByConnection(left, parentPlan.id))
            ))[0] ?? null;
          approachFloors.push({
            id: `${junction.id}:${kind}`,
            kind,
            connectionId: parentPlan.id,
            expectedElevation,
            floor,
          });
        }
      }
      const uniqueApproaches = [...new Map(approachFloors.map((approach) => [
        approach.floor ? this._getFloorTileGraphKey(approach.floor) : approach.id,
        approach,
      ])).values()];
      const exactElevationApproaches = uniqueApproaches.every((approach) => (
        approach.floor && floorMatchesElevation(approach.floor, approach.expectedElevation)
      ));
      const allCoreFloors = floorTiles.filter((floor) => (
        floor.connectorJunctionOwnerId === junction.id
      ));
      const navigableCoreFloors = navigableTiles.filter((floor) => (
        floor.connectorJunctionOwnerId === junction.id
      ));
      const allowedCoreFloorOwnerIds = new Set([
        String(junction.id),
        ...attachedPhysicalPlans.flatMap((plan) => [
          plan.id,
          plan.fromRoomId,
          plan.toRoomId,
        ]).filter(Boolean).map(String),
      ]);
      const foreignCoreFloorOwnerIds = [...new Set(allCoreFloors.flatMap((floor) => (
        (floor.mergedFloorOwnerIds ?? physicalFloorOwnerIds(floor))
          .map(String)
          .filter((ownerId) => !allowedCoreFloorOwnerIds.has(ownerId))
      )))].sort();
      const unownedMergedCoreFloorSourceCount = allCoreFloors.reduce((count, floor) => (
        count + Number(floor.mergedUnownedFloorSourceCount ?? 0)
      ), 0);
      const junctionElevation = Number(junction.baseElevation ?? 0);
      const localJunctionTiles = navigableTiles.filter((tile) => (
        this._isTileInsideRoom(tile, junction)
          && Math.abs(Number(tile.elevation ?? 0) - junctionElevation) <= 0.05
          && (
            tile.connectorJunctionOwnerId === junction.id
            || attachedPhysicalPlans.some((plan) => floorOwnedByConnection(tile, plan.id))
            || (
              parentPlan
              && parentPath.some((point) => point.x === tile.x && point.z === tile.z)
            )
          )
      ));
      const firstApproachFloor = uniqueApproaches.find(({ floor }) => floor)?.floor ?? null;
      const locallyReachable = this._createReachableFloorTileKeySet(
        firstApproachFloor,
        localJunctionTiles,
        useSegmentBarriers ? { canTraverseEdge: canTraverseStrictSupplementEdge } : {},
      );
      const locallyReturnable = this._createFloorTileKeySetThatCanReach(
        firstApproachFloor,
        localJunctionTiles,
        useSegmentBarriers ? { canTraverseEdge: canTraverseStrictSupplementEdge } : {},
      );
      const approachChecks = uniqueApproaches.map((approach) => {
        const floorKey = approach.floor ? this._getFloorTileGraphKey(approach.floor) : null;
        return {
          id: approach.id,
          kind: approach.kind,
          connectionId: approach.connectionId,
          floorKey,
          expectedElevation: approach.expectedElevation,
          realizedElevation: approach.floor ? Number(approach.floor.elevation ?? 0) : null,
          exactElevation: Boolean(
            approach.floor
              && floorMatchesElevation(approach.floor, approach.expectedElevation)
          ),
          globallyReachable: Boolean(floorKey && reachable.has(floorKey)),
          locallyReachable: Boolean(floorKey && locallyReachable.has(floorKey)),
          returnReachable: Boolean(floorKey && locallyReturnable.has(floorKey)),
        };
      });
      const coreFloorKeys = allCoreFloors.map((floor) => this._getFloorTileGraphKey(floor));
      const expectedCoreFloorCount = junction.stampConnectorJunctionFloor === true
        ? (Math.floor(Number(junction.width ?? 0) / 2) * 2 + 1)
          * (Math.floor(Number(junction.depth ?? 0) / 2) * 2 + 1)
        : 0;
      const coreFloorCoverageAccepted = junction.stampConnectorJunctionFloor !== true
        || (
          allCoreFloors.length === expectedCoreFloorCount
          && navigableCoreFloors.length === allCoreFloors.length
          && foreignCoreFloorOwnerIds.length === 0
          && unownedMergedCoreFloorSourceCount === 0
          && coreFloorKeys.every((floorKey) => (
            reachable.has(floorKey)
              && locallyReachable.has(floorKey)
              && locallyReturnable.has(floorKey)
          ))
        );
      const exactParentStationComposite = junction.isExactParentStationComposite === true;
      const parentStationAttachment = exactParentStationComposite
        ? attachedPhysicalPlans.find((plan) => {
          if (plan.networkRole !== 'parent-station-attachment') return false;
          const otherRoomId = plan.fromRoomId === junction.id
            ? plan.toRoomId
            : plan.toRoomId === junction.id ? plan.fromRoomId : null;
          return roomById.get(otherRoomId)?.isRouteStationProxy === true;
        }) ?? null
        : null;
      const parentStationProxyId = parentStationAttachment
        ? (parentStationAttachment.fromRoomId === junction.id
          ? parentStationAttachment.toRoomId
          : parentStationAttachment.fromRoomId)
        : null;
      const parentStationProxy = parentStationProxyId
        ? roomById.get(parentStationProxyId) ?? null
        : null;
      const exactParentStationCompositeBound = !exactParentStationComposite || Boolean(
        parentStationAttachment
          && parentStationProxy
          && String(parentStationProxy.routeNetworkSocketId ?? '')
            === String(junction.parentEndpointSocketId ?? ''),
      );
      const requiredPhysicalArmCount = junction.isRouteStationProxy
        ? 1
        : Math.max(2, Number(
            junction.minimumPhysicalConnectorArms
              ?? junction.minimumPhysicalArmCount
              ?? (junction.countsAsMeaningfulStation === true ? 3 : 2),
          ));
      const requiredApproachCount = junction.isRouteStationProxy
        || (junction.countsAsMeaningfulStation === true && !exactParentStationComposite)
        ? 3
        : 2;
      const accepted = attachedPhysicalPlanIds.size >= requiredPhysicalArmCount
        && exactParentStationCompositeBound
        && attachedConnectorsTraversable
        && approachChecks.length >= requiredApproachCount
        && exactElevationApproaches
        && approachChecks.every((approach) => (
          approach.globallyReachable
            && approach.locallyReachable
            && approach.returnReachable
        ))
        && coreFloorCoverageAccepted
        && locallyReachable.size === localJunctionTiles.length
        && locallyReturnable.size === localJunctionTiles.length;
      supplementJunctionConnectivityChecks.push({
        roomId: junction.id,
        operationId: junction.augmentationOperationId ?? null,
        junctionKind: junction.junctionKind ?? junction.augmentationJunction?.junctionKind ?? null,
        routeStationProxy: junction.isRouteStationProxy === true,
        connectorModuleProxy: junction.stampConnectorJunctionFloor === true,
        attachedPhysicalConnectionIds: [...attachedPhysicalPlanIds],
        requiredPhysicalArmCount,
        requiredApproachCount,
        exactParentStationComposite,
        exactParentStationCompositeBound,
        parentStationAttachmentId: parentStationAttachment?.id ?? null,
        parentStationProxyId,
        attachedConnectorsTraversable,
        approachChecks,
        approachCount: approachChecks.length,
        coreFloorCount: allCoreFloors.length,
        navigableCoreFloorCount: navigableCoreFloors.length,
        expectedCoreFloorCount,
        coreFloorCoverageAccepted,
        allowedCoreFloorOwnerIds: [...allowedCoreFloorOwnerIds].sort(),
        foreignCoreFloorOwnerIds,
        unownedMergedCoreFloorSourceCount,
        locallyReachableFloorCount: locallyReachable.size,
        locallyReturnableFloorCount: locallyReturnable.size,
        accepted,
      });
      if (!accepted) {
        errors.push(
          `${junction.id} connector module is not one exact-elevation, bidirectionally walkable component across at least ${requiredApproachCount} physically assembled approaches.`,
        );
      }
    }

    const trueSupplementRoomIds = new Set(rooms
      .filter((room) => (
        room.isDungeonSupplement
        && room.isConnectorJunctionProxy !== true
        && room.isRouteStationProxy !== true
        && room.suppressRoomGeometry !== true
      ))
      .map((room) => String(room.id)));
    const supplementalOwnedFloors = floorTiles.filter((floor) => (
      trueSupplementRoomIds.has(String(floor.roomId ?? ''))
      || physicalSupplementPlanIds.has(floor.signedConnectorFloorOwnerId)
      || physicalSupplementPlanIds.has(floor.connectorId)
      || physicalSupplementPlanIds.has(floor.connectionId)
      || (floor.sharedConnectorFloorOwnerIds ?? []).some((ownerId) => (
        physicalSupplementPlanIds.has(ownerId)
      ))
      || floor.isDungeonSupplementConnectorFloor === true
    ));
    const blockedSupplementFloorKeys = supplementalOwnedFloors
      .filter((floor) => !navigableByKey.has(this._getFloorTileGraphKey(floor)))
      .map((floor) => this._getFloorTileGraphKey(floor));
    const orphanSupplementFloorKeys = supplementalOwnedFloors
      .filter((floor) => (
        navigableByKey.has(this._getFloorTileGraphKey(floor))
        && !reachable.has(this._getFloorTileGraphKey(floor))
      ))
      .map((floor) => this._getFloorTileGraphKey(floor));
    const nonReturnableSupplementFloorKeys = supplementalOwnedFloors
      .filter((floor) => (
        navigableByKey.has(this._getFloorTileGraphKey(floor))
        && !globallyReturnableToStart.has(this._getFloorTileGraphKey(floor))
      ))
      .map((floor) => this._getFloorTileGraphKey(floor));
    if (blockedSupplementFloorKeys.length) {
      errors.push(
        `Supplement assembly contains ${blockedSupplementFloorKeys.length} blocked owned floor(s), including ${blockedSupplementFloorKeys[0]}.`,
      );
    }
    if (orphanSupplementFloorKeys.length) {
      errors.push(
        `Supplement assembly contains ${orphanSupplementFloorKeys.length} orphaned corridor floor(s), including ${orphanSupplementFloorKeys[0]}.`,
      );
    }
    if (nonReturnableSupplementFloorKeys.length) {
      errors.push(
        `Supplement assembly contains ${nonReturnableSupplementFloorKeys.length} owned floor(s) without a return path to the dungeon start, including ${nonReturnableSupplementFloorKeys[0]}.`,
      );
    }

    const supplementMechanismById = new Map(
      (landmarks.mechanisms ?? [])
        .filter((mechanism) => mechanism.isDungeonSupplement || mechanism.dungeonSupplement)
        .map((mechanism) => [String(mechanism.id), mechanism]),
    );
    for (const plan of shortcutSupplementPlans) {
      const connectivityCheck = supplementConnectivityChecks.find((check) => (
        check.connectionId === plan.id
      ));
      const shortcutMode = String(plan.shortcutMode ?? '');
      const expectedContractKind = shortcutMode === 'drop-ladder' ? 'ladder' : 'lift';
      const matchingContractChecks = (connectivityCheck?.verticalContractChecks ?? [])
        .filter(({ kind }) => kind === expectedContractKind);
      const sourceFloorKey = plan.fromSocket?.floorKey ?? null;
      const farSideFloorKey = plan.toSocket?.floorKey ?? null;
      const sourceReachableBeforeActivation = Boolean(
        sourceFloorKey && reachableWithoutInitialShortcuts.has(sourceFloorKey)
      );
      const farSideReachableBeforeActivation = Boolean(
        farSideFloorKey && reachableWithoutInitialShortcuts.has(farSideFloorKey)
      );
      const initialState = plan.shortcutInitialState ?? null;
      const initiallyUnavailable = shortcutMode === 'drop-ladder'
        ? initialState === 'retracted'
        : initialState === 'unavailable';
      const matchingTraversalLinkIds = matchingContractChecks.flatMap((check) => (
        check.matchingLinks.map(({ id }) => id).filter(Boolean)
      ));
      const shortcutMechanism = plan.shortcutMechanismId == null
        ? null
        : supplementMechanismById.get(String(plan.shortcutMechanismId)) ?? null;
      const mechanismStateIds = new Set([
        shortcutMechanism?.stateId,
        shortcutMechanism?.shortcutStateId,
        ...(shortcutMechanism?.runtimeStateIds ?? []),
      ].filter(Boolean).map(String));
      const mechanismRecordAccepted = Boolean(
        shortcutMechanism
        && mechanismStateIds.has(String(plan.shortcutStateId ?? ''))
        && String(shortcutMechanism.connectionId ?? '') === String(plan.id)
        && String(shortcutMechanism.roomId ?? '') === String(plan.toRoomId ?? '')
        && shortcutMechanism.activationSide === 'far-side'
        && shortcutMechanism.position
      );
      const accepted = Boolean(
        plan.shortcutMechanismId
        && plan.shortcutStateId
        && mechanismRecordAccepted
        && plan.shortcutActivationSide === 'far-side'
        && initiallyUnavailable
        && sourceReachableBeforeActivation
        && farSideReachableBeforeActivation
        && matchingContractChecks.some((check) => check.accepted)
        && matchingTraversalLinkIds.length >= 2
        && connectivityCheck?.accepted
      );
      supplementShortcutConnectivityChecks.push({
        connectionId: plan.id,
        operationId: plan.augmentationOperationId ?? null,
        shortcutMode,
        shortcutMechanismId: plan.shortcutMechanismId ?? null,
        shortcutStateId: plan.shortcutStateId ?? null,
        activationSide: plan.shortcutActivationSide ?? null,
        initialState,
        initiallyUnavailable,
        sourceFloorKey,
        farSideFloorKey,
        sourceReachableBeforeActivation,
        farSideReachableBeforeActivation,
        matchingTraversalLinkIds,
        matchingContractChecks,
        mechanismRecordAccepted,
        mechanismRoomId: shortcutMechanism?.roomId ?? null,
        postActivationBidirectional: Boolean(connectivityCheck?.accepted),
        accepted,
      });
      if (!accepted) {
        errors.push(
          `${plan.id} shortcut is not a valid far-side activation: its control side must be reachable without the shortcut, while its exact ladder/lift contract must become bidirectionally traversable after activation.`,
        );
      }
    }

    const supplementPlansByOperation = new Map();
    for (const plan of physicalSupplementPlans) {
      const operationId = plan.augmentationOperationId ?? plan.id;
      const entries = supplementPlansByOperation.get(operationId) ?? [];
      entries.push(plan);
      supplementPlansByOperation.set(operationId, entries);
    }
    for (const [operationId, plans] of supplementPlansByOperation) {
      const topologyTemplateId = plans.find((plan) => plan.topologyTemplateId)?.topologyTemplateId
        ?? null;
      const elevationModes = [...new Set(plans.flatMap((plan) => (
        Array.isArray(plan.elevationModes) ? plan.elevationModes : []
      )))];
      const claimsSeparatedLevels = topologyTemplateId === 'over-under-loop'
        || elevationModes.some((mode) => /stack|over-under|ladder|lift|slope|split/i.test(mode));
      const operationChecks = supplementConnectivityChecks.filter((check) => (
        check.operationId === operationId
      ));
      const operationRooms = rooms.filter((room) => (
        room.isDungeonSupplement && room.augmentationOperationId === operationId
      ));
      const operationConnectorModules = rooms.filter((room) => (
        room.isConnectorJunctionProxy === true
          && room.augmentationOperationId === operationId
      ));
      const operationRoomIds = new Set(operationRooms.map(({ id }) => id));
      const operationNodes = [...operationRooms, ...operationConnectorModules];
      const operationNodeIds = new Set(operationNodes.map(({ id }) => id));
      const operationAdjacency = new Map(operationNodes.map(({ id }) => [id, new Set()]));
      for (const check of operationChecks.filter(({ accepted: checkAccepted }) => checkAccepted)) {
        if (!operationNodeIds.has(check.fromRoomId) || !operationNodeIds.has(check.toRoomId)) {
          continue;
        }
        operationAdjacency.get(check.fromRoomId).add(check.toRoomId);
        operationAdjacency.get(check.toRoomId).add(check.fromRoomId);
      }
      const connectedOperationNodeIds = new Set();
      const operationRoomQueue = operationRooms.length ? [operationRooms[0].id] : [];
      for (let cursor = 0; cursor < operationRoomQueue.length; cursor += 1) {
        const roomId = operationRoomQueue[cursor];
        if (connectedOperationNodeIds.has(roomId)) continue;
        connectedOperationNodeIds.add(roomId);
        for (const adjacentRoomId of operationAdjacency.get(roomId) ?? []) {
          if (!connectedOperationNodeIds.has(adjacentRoomId)) {
            operationRoomQueue.push(adjacentRoomId);
          }
        }
      }
      const connectedOperationRoomIds = new Set(
        [...connectedOperationNodeIds].filter((nodeId) => operationRoomIds.has(nodeId)),
      );
      const allOperationRoomsConnected = operationRooms.length > 0
        && connectedOperationRoomIds.size === operationRooms.length;
      const roomElevationLayers = [...new Set(operationRooms.map((room) => (
        Number(room.baseElevation ?? 0).toFixed(3)
      )))];
      const hasConnectorVerticalTransfer = operationChecks.some((check) => (
        check.needsVerticalTransfer && check.hasRealVerticalTransfer
      ));
      const internalVerticalRoomIds = operationRooms.filter((room) => {
        const roomFloors = navigableTiles.filter((floor) => floor.roomId === room.id);
        const elevations = new Set(roomFloors.map((floor) => (
          Number(floor.elevation ?? 0).toFixed(3)
        )));
        return elevations.size > 1 && roomFloors.some((floor) => (
          floor.surface === 'industrialRamp'
          || (floor.traversalLinks ?? []).some((link) => (
            ['ladder', 'automatic_lift'].includes(link.action)
          ))
        ));
      }).map(({ id }) => id);
      const hasInternalVerticalTraversal = internalVerticalRoomIds.length > 0;
      const hasRealVerticalTransfer = hasConnectorVerticalTransfer
        || hasInternalVerticalTraversal;
      const accepted = allOperationRoomsConnected
        && (!claimsSeparatedLevels || hasRealVerticalTransfer);
      supplementVerticalConnectivityChecks.push({
        operationId,
        topologyTemplateId,
        elevationModes,
        claimsSeparatedLevels,
        operationRoomIds: [...operationRoomIds].sort(),
        operationConnectorModuleIds: operationConnectorModules.map(({ id }) => id).sort(),
        connectedOperationNodeIds: [...connectedOperationNodeIds].sort(),
        connectedOperationRoomIds: [...connectedOperationRoomIds].sort(),
        allOperationRoomsConnected,
        roomElevationLayers,
        connectorVerticalTransferCount: operationChecks.filter((check) => (
          check.needsVerticalTransfer && check.hasRealVerticalTransfer
        )).length,
        internalVerticalRoomIds,
        hasInternalVerticalTraversal,
        hasRealVerticalTransfer,
        accepted,
      });
      if (!accepted) {
        errors.push(
          `${operationId} does not form one realized operation graph with every declared elevation layer joined by an assembled ramp, ladder, lift, or internal split-level route.`,
        );
      }
    }

    for (const door of doors) {
      requirePoint(`Door ${door.id}`, door.position);
    }
    for (const keycard of landmarks.keycards ?? []) {
      requirePoint(`Keycard ${keycard.id}`, keycard.position);
    }
    for (const mechanism of landmarks.mechanisms ?? []) {
      const supplementMechanism = Boolean(
        mechanism.isDungeonSupplement || mechanism.dungeonSupplement
      );
      requirePoint(`Mechanism ${mechanism.id}`, mechanism.position, supplementMechanism ? {
        roomId: mechanism.roomId,
        requireDirectOwnedFloor: true,
        maximumVerticalDistance: PLAYER_TRAVERSAL_ENVELOPE.maximumNormalJumpRise,
      } : undefined);
    }
    for (const chest of landmarks.chests ?? []) {
      const supplementRoom = roomById.get(chest.roomId);
      requirePoint(`Chest ${chest.id}`, chest.position, supplementRoom?.isDungeonSupplement ? {
        roomId: chest.roomId,
        requireDirectOwnedFloor: true,
        maximumVerticalDistance: PLAYER_TRAVERSAL_ENVELOPE.maximumNormalJumpRise,
      } : undefined);
    }
    if (landmarks.shrine) {
      requirePoint('Large Refractor shrine', landmarks.shrine.position);
    }
    for (const encounter of encounters) {
      for (const [index, spawnPoint] of (encounter.spawnPoints ?? []).entries()) {
        requirePoint(
          `${encounter.id} spawn ${index + 1}`,
          spawnPoint,
          encounter.isDungeonSupplement ? {
            roomId: encounter.roomId,
            requireDirectOwnedFloor: true,
            maximumVerticalDistance: PLAYER_TRAVERSAL_ENVELOPE.maximumNormalJumpRise,
          } : undefined,
        );
      }
    }

    return {
      accepted: errors.length === 0,
      errors,
      warnings: errors.length ? [] : [
        `Platformability validated ${reachable.size} traversal nodes, ${connectionPlans.length} matched portal routes, and ${rooms.filter((room) => room.platformNodes?.length).length} purposeful platform segments.`,
      ],
      details: {
        reachableNodeCount: reachable.size,
        totalNavigableNodeCount: navigableTiles.length,
        matchedConnectionCount: connectionPlans.length,
        locallyReachableSocketCount: localSocketChecks.filter((check) => check.accessibleFromOwnerRoom).length,
        localSocketChecks,
        connectorSpineChecks,
        supplementConnectivityChecks,
        supplementRoomConnectivityChecks,
        supplementJunctionConnectivityChecks,
        supplementVerticalConnectivityChecks,
        supplementShortcutConnectivityChecks,
        supplementalOwnedFloorCount: supplementalOwnedFloors.length,
        ...(useSegmentBarriers ? {
          blockedSupplementFloorCount: blockedSupplementFloorKeys.length,
          blockedSupplementFloorKeys,
        } : {}),
        orphanSupplementFloorCount: orphanSupplementFloorKeys.length,
        orphanSupplementFloorKeys,
        ...(useSegmentBarriers ? {
          nonReturnableSupplementFloorCount: nonReturnableSupplementFloorKeys.length,
          nonReturnableSupplementFloorKeys,
        } : {}),
        bidirectionallyTraversableConnectorCount: connectorSpineChecks
          .filter((check) => check.accepted).length,
        dropSpaceChecks,
        platformNodeCount: rooms.reduce((count, room) => count + (room.platformNodes?.length ?? 0), 0),
        rampScaffoldHeadroomConflictCount: rampScaffoldHeadroomConflicts.length,
        rampClearanceRemovedScaffoldTileCount: rooms.reduce((count, room) => (
          count + (room.rampClearanceRemovedScaffoldTileCount ?? 0)
        ), 0),
        rampClearanceConvertedToSolidTileCount: rooms.reduce((count, room) => (
          count + (room.rampClearanceConvertedToSolidTileCount ?? 0)
        ), 0),
        movementEnvelope: PLAYER_TRAVERSAL_ENVELOPE,
        segmentBarriersValidated: useSegmentBarriers,
      },
    };
  }

  _createVerticalConnectors(rooms, connectionPlans = []) {
    return rooms
      .filter((room) => ['server', 'machine', 'coolant', 'enemy', 'keycard', 'trap', 'conveyor', 'boss', 'shrine', 'bonus'].includes(room.type))
      .map((room) => ({
        id: `${room.id}VerticalConnector`,
        roomId: room.id,
        archetype: room.archetype ?? room.type,
        flavor: room.flavor ?? null,
        label: room.type === 'trap'
          ? 'Hazard drop and return ledges'
          : room.type === 'bonus'
            ? 'Sealed vault reward dais'
          : room.type === 'shrine'
            ? 'Refractor shrine ramp tower'
            : room.type === 'boss'
              ? 'Guardian arena access ramp'
            : room.type === 'conveyor'
              ? 'Factory gantry ramp'
              : room.type === 'server'
                ? 'Server catwalk access ramp'
                : room.type === 'machine'
                  ? 'Machine factory service ramp'
                  : room.type === 'coolant'
                    ? 'Coolant relay balcony ramp'
                    : 'Upper maintenance ramp',
        position: new THREE.Vector3(
          room.x * this.tileSize,
          Number(room.baseElevation ?? 0),
          room.z * this.tileSize,
        ),
        baseElevation: Number(room.baseElevation ?? 0),
        minY: Number(room.minY ?? room.baseElevation ?? 0),
        maxY: Number(room.maxY ?? room.baseElevation ?? 0),
        ceilingY: Number.isFinite(room.ceilingY) ? room.ceilingY : null,
        connections: connectionPlans
          .filter((plan) => plan.fromRoomId === room.id || plan.toRoomId === room.id)
          .map((plan) => ({
            id: plan.id,
            connectorType: plan.connectorType,
            elevation: plan.elevation,
            sourceElevation: plan.sourceElevation ?? plan.fromSocket?.elevation ?? plan.elevation,
            destinationElevation: plan.destinationElevation ?? plan.toSocket?.elevation ?? plan.elevation,
            elevationDelta: plan.elevationDelta ?? 0,
            direction: plan.direction ?? 'level',
            level: plan.level,
            socketId: plan.fromRoomId === room.id ? plan.fromSocket.id : plan.toSocket.id,
            matchingSocketId: plan.fromRoomId === room.id ? plan.toSocket.id : plan.fromSocket.id,
            purpose: plan.purpose,
          })),
        levels: !ENABLE_PROCEDURAL_RAISED_ROOM_LEVELS
          ? (room.type === 'trap' || room.type === 'coolant' ? [-1, 0] : [0])
          : room.type === 'trap'
            ? [-1, 0]
            : room.type === 'coolant'
              ? [-1, 0, 1]
            : room.type === 'conveyor' || room.type === 'boss' || room.type === 'shrine'
              ? [0, 1, 2]
              : [0, 1],
      }));
  }

  _markRoomCatwalks(tiles, room) {
    if (!room || room.specialEnvironmentId || RUIN_OPEN_AIR_ROOM_TYPES.has(room.type)) {
      return;
    }

    const halfW = Math.floor(room.width / 2);
    const halfD = Math.floor(room.depth / 2);
    const mark = (x, z, surface = 'catwalk') => {
      const tile = tiles.get(tileKey(x, z));
      if (!tile || RESERVED_FACTORY_SURFACE_TYPES.has(tile.type)) {
        return;
      }

      if (isDoorOrHallwayClearance(tiles, x, z)) {
        return;
      }

      markTileSurface(tiles, x, z, {
        elevation: ENABLE_PROCEDURAL_RAISED_ROOM_LEVELS ? RUIN_FACTORY_ELEVATION : 0,
        surface,
      });
    };

    if (room.type === 'conveyor') {
      for (let z = room.z - halfD; z <= room.z + halfD; z += 1) {
        mark(room.x, z, 'conveyorBridge');
      }
      for (let x = room.x - 1; x <= room.x + 1; x += 1) {
        mark(x, room.z - halfD, 'raisedDeck');
        mark(x, room.z + halfD, 'raisedDeck');
      }
      return;
    }

    if (room.type === 'bonus') {
      for (let x = room.x - halfW; x <= room.x + halfW; x += 1) {
        mark(x, room.z - halfD, 'raisedDeck');
      }
      return;
    }

    if (room.type === 'shrine') {
      for (let x = room.x - halfW; x <= room.x + halfW; x += 1) {
        mark(x, room.z - halfD, 'catwalk');
      }
      for (let z = room.z - halfD; z <= room.z + halfD; z += 1) {
        mark(room.x - halfW, z, 'catwalk');
        mark(room.x + halfW, z, 'catwalk');
      }
      return;
    }

    if (room.type === 'boss') {
      for (let x = room.x - halfW; x <= room.x + halfW; x += 1) {
        mark(x, room.z - halfD, 'raisedDeck');
        mark(x, room.z + halfD, 'raisedDeck');
      }
      for (let z = room.z - halfD; z <= room.z + halfD; z += 1) {
        mark(room.x - halfW, z, 'catwalk');
        mark(room.x + halfW, z, 'catwalk');
      }
      return;
    }

    const useLeftSide = this.random() < 0.5;
    const catwalkX = room.x + (useLeftSide ? -halfW : halfW);
    const catwalkZ = room.z - halfD;

    for (let z = room.z - halfD; z <= room.z + halfD; z += 1) {
      mark(catwalkX, z, 'catwalk');
    }
    for (let x = room.x - halfW; x <= room.x + halfW; x += 1) {
      mark(x, catwalkZ, 'catwalk');
    }
  }

  _markConveyorBridge(tiles, fromRoom, toRoom, {
    speed = 1.55,
    surface = 'conveyorBridge',
    path: authoredPath = null,
  } = {}) {
    if (!fromRoom || !toRoom) {
      return;
    }

    const path = authoredPath?.length
      ? authoredPath.map((point) => ({ ...point }))
      : this._buildOrthogonalPath(fromRoom, toRoom);

    for (let i = 0; i < path.length; i += 1) {
      const current = path[i];
      const tile = tiles.get(tileKey(current.x, current.z));

      if (!tile || CONVEYOR_BRIDGE_RESERVED_TYPES.has(tile.type)) {
        continue;
      }

      const next = path[i + 1] ?? path[i - 1] ?? current;
      const previous = path[i - 1] ?? next;
      const dx = Math.sign((next.x - current.x) || (current.x - previous.x));
      const dz = Math.sign((next.z - current.z) || (current.z - previous.z));

      setConveyorTile(tiles, current.x, current.z, {
        directionX: dx,
        directionZ: dz,
        speed,
        active: true,
        elevation: ENABLE_PROCEDURAL_RAISED_ROOM_LEVELS ? RUIN_FACTORY_ELEVATION : 0,
        surface,
      });
    }
  }

  _buildOrthogonalPath(fromRoom, toRoom) {
    const points = [];

    for (const x of rangeBetweenOrdered(fromRoom.x, toRoom.x)) {
      points.push({ x, z: fromRoom.z });
    }

    for (const z of rangeBetweenOrdered(fromRoom.z, toRoom.z)) {
      const point = { x: toRoom.x, z };
      const last = points[points.length - 1];
      if (last && last.x === point.x && last.z === point.z) {
        continue;
      }
      points.push(point);
    }

    return points;
  }

  _loadRuinTexture(name) {
    if (this.textureCache.has(name)) {
      return this.textureCache.get(name);
    }

    const texture = this.textureLoader.load(`${RUIN_TEXTURE_BASE_PATH}${name}.png`);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    this.textureCache.set(name, texture);
    return texture;
  }

  _createRuinMaterial(textureName, {
    color = 0xffffff,
    emissive = 0x000000,
    emissiveIntensity = 0,
    roughness = 0.78,
    metalness = 0.08,
    transparent = false,
    opacity = 1,
  } = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      map: this._loadRuinTexture(textureName),
      emissive,
      emissiveIntensity,
      roughness,
      metalness,
      transparent,
      opacity,
    });
  }

  _createWallMacroTileMaterials(variant) {
    const style = {
      sand: {
        color: 0xf2ead8,
        emissive: 0x031010,
        roughness: 0.76,
        metalness: 0.06,
      },
      overgrown: {
        color: 0xf0ecd7,
        emissive: 0x06140a,
        roughness: 0.84,
        metalness: 0.03,
      },
      industrial: {
        color: 0xd8d9e2,
        emissive: 0x030510,
        roughness: 0.72,
        metalness: 0.1,
      },
    }[variant] ?? {};
    const materials = {};

    for (const key of WALL_MACRO_TILE_KEYS) {
      materials[key] = this._createRuinMaterial(`wall_macro_${variant}_${key}`, {
        emissiveIntensity: 0.04,
        ...style,
      });
    }

    if (variant === 'overgrown') {
      materials.mmAlt = this._createRuinMaterial('wall_macro_overgrown_mm_alt', {
        emissiveIntensity: 0.04,
        ...style,
      });
    }

    return materials;
  }

  _createWallMacroAccentMaterials() {
    return Object.fromEntries(WALL_MACRO_ACCENT_KEYS.map((key) => [
      key,
      this._createRuinMaterial(`accent_${key}`, {
        color: key === 'sensor' ? 0xd6dde2 : 0xc7cbd0,
        emissive: key === 'sensor'
          ? 0x2a0505
          : ['conduit', 'wiring'].includes(key)
            ? 0x052c34
            : 0x030608,
        emissiveIntensity: ['sensor', 'conduit', 'wiring'].includes(key) ? 0.2 : 0.05,
        roughness: 0.68,
        metalness: 0.16,
      }),
    ]));
  }

  _createMaterials() {
    const floor = this._createRuinMaterial('floor_plain', {
      roughness: 0.86,
      metalness: 0.04,
    });
    const hallway = this._createRuinMaterial('floor_panel', {
      color: 0xf1ead8,
      roughness: 0.84,
      metalness: 0.06,
    });
    const entrance = this._createRuinMaterial('floor_cross_panel', {
      color: 0xf2ead6,
      emissive: 0x052f34,
      emissiveIntensity: 0.08,
      roughness: 0.78,
      metalness: 0.08,
    });
    const enemy = this._createRuinMaterial('floor_circuit', {
      color: 0xe8e0c9,
      emissive: 0x042f34,
      emissiveIntensity: 0.1,
      roughness: 0.78,
      metalness: 0.08,
    });
    const trap = this._createRuinMaterial('special_trap', {
      emissive: 0x2b0505,
      emissiveIntensity: 0.18,
      roughness: 0.74,
      metalness: 0.08,
    });
    const conveyor = this._createRuinMaterial('special_conveyor', {
      emissive: 0x052d32,
      emissiveIntensity: 0.16,
      roughness: 0.6,
      metalness: 0.22,
    });
    const bonus = this._createRuinMaterial('floor_octagon', {
      color: 0xf4ebd6,
      emissive: 0x052326,
      emissiveIntensity: 0.1,
      roughness: 0.7,
      metalness: 0.1,
    });
    const keycard = this._createRuinMaterial('door_keycard', {
      color: 0xf1ead9,
      emissive: 0x241500,
      emissiveIntensity: 0.12,
      roughness: 0.72,
      metalness: 0.08,
    });
    const chest = this._createRuinMaterial('accent_hatch', {
      color: 0xf1ead9,
      emissive: 0x07141d,
      emissiveIntensity: 0.08,
      roughness: 0.62,
      metalness: 0.12,
    });
    const shrine = this._createRuinMaterial('floor_shrine', {
      color: 0xf1ead9,
      emissive: 0x052326,
      emissiveIntensity: 0.14,
      roughness: 0.68,
      metalness: 0.12,
    });
    const hub = this._createRuinMaterial('floor_mossy', {
      color: 0xf0ead6,
      emissive: 0x07120a,
      emissiveIntensity: 0.08,
      roughness: 0.88,
      metalness: 0.03,
    });
    const camp = this._createRuinMaterial('floor_mossy', {
      color: 0xf3edd8,
      emissive: 0x07120a,
      emissiveIntensity: 0.08,
      roughness: 0.9,
      metalness: 0.03,
    });
    const catwalkFloor = this._createRuinMaterial('floor_panel', {
      color: 0xd9dde6,
      emissive: 0x051f28,
      emissiveIntensity: 0.12,
      roughness: 0.66,
      metalness: 0.18,
    });
    const raisedDeckFloor = this._createRuinMaterial('floor_cross_panel', {
      color: 0xd6dbe4,
      emissive: 0x062326,
      emissiveIntensity: 0.1,
      roughness: 0.68,
      metalness: 0.14,
    });
    const secondFloor = this._createRuinMaterial('floor_panel', {
      color: 0xc8d1dc,
      emissive: 0x06242f,
      emissiveIntensity: 0.16,
      roughness: 0.62,
      metalness: 0.22,
    });
    const thirdFloor = this._createRuinMaterial('floor_circuit', {
      color: 0xb9c5d1,
      emissive: 0x063544,
      emissiveIntensity: 0.2,
      roughness: 0.58,
      metalness: 0.26,
    });
    const serverFloor = this._createRuinMaterial('floor_circuit', {
      color: 0xbad2d7,
      emissive: 0x04464d,
      emissiveIntensity: 0.22,
      roughness: 0.58,
      metalness: 0.24,
    });
    const machineFloor = this._createRuinMaterial('floor_panel', {
      color: 0xc2c8d0,
      emissive: 0x05232c,
      emissiveIntensity: 0.16,
      roughness: 0.58,
      metalness: 0.28,
    });
    const coolantFloor = this._createRuinMaterial('floor_circuit', {
      color: 0xb9c8ce,
      emissive: 0x073440,
      emissiveIntensity: 0.22,
      roughness: 0.54,
      metalness: 0.24,
    });
    const basementFloor = this._createRuinMaterial('floor_cracked', {
      color: 0x7d838b,
      emissive: 0x05080c,
      emissiveIntensity: 0.08,
      roughness: 0.88,
      metalness: 0.06,
    });
    const industrialStairs = this._createRuinMaterial('floor_panel', {
      color: 0xb7c0ca,
      emissive: 0x061923,
      emissiveIntensity: 0.12,
      roughness: 0.56,
      metalness: 0.3,
    });
    const industrialRamp = this._createRuinMaterial('floor_cross_panel', {
      color: 0xc0c9d2,
      emissive: 0x071e27,
      emissiveIntensity: 0.16,
      roughness: 0.54,
      metalness: 0.34,
    });
    const wallMacroVariant = WALL_MACRO_VARIANTS[
      this._randomInt(0, WALL_MACRO_VARIANTS.length - 1)
    ];
    const wallMacroTiles = this._createWallMacroTileMaterials(wallMacroVariant);
    const wallMacroAccents = this._createWallMacroAccentMaterials();

    return {
      floor,
      hallway,
      wall: new THREE.MeshStandardMaterial({
        color: 0xa79d87,
        emissive: 0x030505,
        emissiveIntensity: 0.025,
        roughness: 0.78,
        metalness: 0.06,
      }),
      wallMacroTiles,
      wallMacroAccents,
      wallMacroVariant,
      ceiling: this._createRuinMaterial('ceiling_panel', {
        color: 0xe8dfcc,
        roughness: 0.84,
        metalness: 0.04,
      }),
      catwalkFloor,
      raisedDeckFloor,
      secondFloor,
      thirdFloor,
      serverFloor,
      machineFloor,
      coolantFloor,
      basementFloor,
      industrialStairs,
      industrialRamp,
      supportMetal: new THREE.MeshStandardMaterial({
        color: 0x33404a,
        emissive: 0x061016,
        emissiveIntensity: 0.16,
        roughness: 0.54,
        metalness: 0.32,
      }),
      factoryRail: new THREE.MeshStandardMaterial({
        color: 0x5a6872,
        emissive: 0x08212a,
        emissiveIntensity: 0.18,
        roughness: 0.48,
        metalness: 0.28,
      }),
      hazardStripe: new THREE.MeshStandardMaterial({
        color: 0xffc44f,
        emissive: 0x432000,
        emissiveIntensity: 0.28,
        roughness: 0.44,
        metalness: 0.14,
      }),
      wallTrim: this._createRuinMaterial('accent_slate', {
        color: 0xf0e8d5,
        emissive: 0x061010,
        emissiveIntensity: 0.06,
        roughness: 0.58,
        metalness: 0.14,
      }),
      door: this._createRuinMaterial('door_frame', {
        color: 0xf1ead8,
        emissive: 0x052326,
        emissiveIntensity: 0.14,
        roughness: 0.48,
        metalness: 0.22,
      }),
      lockedDoor: this._createRuinMaterial('door_sealed', {
        color: 0xf1ead8,
        emissive: 0x241500,
        emissiveIntensity: 0.28,
        roughness: 0.46,
        metalness: 0.2,
      }),
      terminal: this._createRuinMaterial('terminal_mechanism', {
        color: 0xf1ead8,
        emissive: 0x04282c,
        emissiveIntensity: 0.12,
        roughness: 0.5,
        metalness: 0.16,
      }),
      invisibleBoundary: new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
      glowBlue: new THREE.MeshStandardMaterial({
        color: 0x6bdcff,
        emissive: 0x2fbfff,
        emissiveIntensity: 1.1,
        roughness: 0.28,
        metalness: 0.08,
      }),
      glowYellow: new THREE.MeshStandardMaterial({
        color: 0xffd66b,
        emissive: 0xffa51f,
        emissiveIntensity: 0.85,
        roughness: 0.34,
        metalness: 0.08,
      }),
      glowRed: new THREE.MeshStandardMaterial({
        color: 0xff645d,
        emissive: 0xff1f1f,
        emissiveIntensity: 0.78,
        roughness: 0.36,
        metalness: 0.04,
      }),
      glowGreen: new THREE.MeshStandardMaterial({
        color: 0x5ee77b,
        emissive: 0x22d65a,
        emissiveIntensity: 0.92,
        roughness: 0.34,
        metalness: 0.06,
      }),
      glowViolet: new THREE.MeshStandardMaterial({
        color: 0xa06cff,
        emissive: 0x7d43ff,
        emissiveIntensity: 0.92,
        roughness: 0.34,
        metalness: 0.06,
      }),
      largeRefractor: new THREE.MeshStandardMaterial({
        color: 0x7df8ff,
        emissive: 0x28e8ff,
        emissiveIntensity: 1.35,
        roughness: 0.18,
        metalness: 0.04,
        transparent: true,
        opacity: 0.86,
      }),
      chestTrim: new THREE.MeshStandardMaterial({
        color: 0xffd66b,
        emissive: 0x5c3505,
        emissiveIntensity: 0.42,
        roughness: 0.36,
        metalness: 0.28,
      }),
      floorByType: {
        floor,
        hallway,
        server: serverFloor,
        machine: machineFloor,
        coolant: coolantFloor,
        entrance,
        enemy,
        boss: enemy,
        trap,
        conveyor,
        bonus,
        keycard,
        chest,
        shrine,
        hub,
        camp,
      },
    };
  }

  _getFloorMaterialForTile(tile, materials) {
    if (tile.type === 'trap' && tile.augmentationOwnerId) {
      // Supplemental hazards inherit the parent region's semantic warning
      // surface instead of creating a supplement-exclusive trap material.
      return materials.hazardStripe;
    }
    if (tile.surface === 'catwalk' || tile.surface === 'upperConnectionBridge') {
      return materials.catwalkFloor;
    }
    if (tile.surface === 'raisedDeck' || tile.surface === 'jumpPlatform') {
      return materials.raisedDeckFloor;
    }
    if (
      tile.surface === 'secondFloor'
      || tile.surface === 'conveyorCrossBridge'
      || tile.surface === 'reveredMezzanine'
    ) {
      return materials.secondFloor;
    }
    if (
      tile.surface === 'thirdFloorGantry'
      || tile.surface === 'refractorDais'
    ) {
      return materials.thirdFloor;
    }
    if (
      tile.surface === 'serverCoreFloor'
      || tile.surface === 'serverUpperCatwalk'
    ) {
      return materials.serverFloor;
    }
    if (
      tile.surface === 'machinePressZone'
      || tile.surface === 'machineUpperCatwalk'
      || tile.surface === 'machineCrossBridge'
    ) {
      return materials.machineFloor;
    }
    if (
      tile.surface === 'coolantValveDeck'
      || tile.surface === 'coolantControlBalcony'
      || tile.surface === 'coolantPipeBridge'
    ) {
      return materials.coolantFloor;
    }
    if (
      tile.surface === 'basementFloor'
      || tile.surface === 'coolantServicePit'
      || tile.surface === 'refractorWell'
    ) {
      return materials.basementFloor;
    }
    if (tile.surface === 'industrialStairs') {
      return materials.industrialStairs;
    }
    if (tile.surface === 'industrialRamp' || tile.surface === 'rampLanding') {
      return materials.industrialRamp;
    }
    if (tile.surface === 'basementReturnShelf') {
      return materials.raisedDeckFloor;
    }
    if (tile.surface === 'dropSpaceOverpass') {
      return materials.hallway;
    }

    return materials.floorByType[tile.type] ?? materials.floor;
  }

  _addTileDetail(group, tile, materials) {
    const position = this._tileToWorld(tile.x, tile.z);
    const elevation = tile.elevation ?? 0;

    if (tile.surface === 'dropSpaceOverpass') {
      for (const rotate of [false, true]) {
        const beam = new THREE.Mesh(
          new THREE.BoxGeometry(
            rotate ? 0.16 : this.tileSize * 0.9,
            0.18,
            rotate ? this.tileSize * 0.9 : 0.16,
          ),
          materials.supportMetal,
        );
        beam.name = 'minorDropOverpassUnderbeam';
        beam.position.set(position.x, elevation - 0.18, position.z);
        beam.castShadow = true;
        group.add(beam);
      }
    }

    if (tile.surface === 'industrialRamp') {
      const directionX = Math.sign(tile.rampDirectionX ?? 0);
      const directionZ = Math.sign(tile.rampDirectionZ ?? 0);
      const acrossX = directionZ !== 0;
      const stripeCount = tile.steepRamp ? 3 : 2;
      const stripeGeometry = new THREE.BoxGeometry(
        acrossX ? this.tileSize * 0.72 : 0.08,
        0.035,
        acrossX ? 0.08 : this.tileSize * 0.72,
      );
      const edgeGeometry = new THREE.BoxGeometry(
        acrossX ? 0.08 : this.tileSize * 0.9,
        0.05,
        acrossX ? this.tileSize * 0.88 : 0.08,
      );
      const rise = (tile.rampEndElevation ?? elevation) - (tile.rampStartElevation ?? elevation);
      const angle = Math.atan2(rise, this.tileSize);

      for (let i = 0; i < stripeCount; i += 1) {
        const progress = (i + 1) / (stripeCount + 1) - 0.5;
        const stripe = new THREE.Mesh(
          stripeGeometry,
          i % 2 === 0 ? materials.hazardStripe : materials.supportMetal,
        );
        stripe.name = 'industrialRampGripStripe';
        stripe.position.set(
          position.x + directionX * progress * this.tileSize * 0.78,
          elevation + 0.035,
          position.z + directionZ * progress * this.tileSize * 0.78,
        );
        if (directionX !== 0) {
          stripe.rotation.z = directionX * angle;
        } else if (directionZ !== 0) {
          stripe.rotation.x = -directionZ * angle;
        }
        group.add(stripe);
      }

      for (const side of [-1, 1]) {
        const edge = new THREE.Mesh(edgeGeometry, materials.factoryRail);
        edge.name = 'industrialRampRaisedEdge';
        edge.position.set(
          position.x + (acrossX ? side * this.tileSize * 0.42 : 0),
          elevation + 0.065,
          position.z + (acrossX ? 0 : side * this.tileSize * 0.42),
        );
        if (directionX !== 0) {
          edge.rotation.z = directionX * angle;
        } else if (directionZ !== 0) {
          edge.rotation.x = -directionZ * angle;
        }
        group.add(edge);
      }
    }

    if (tile.type === 'conveyor') {
      const directionX = tile.conveyorDirectionX ?? 0;
      const directionZ = tile.conveyorDirectionZ ?? 1;
      const arrowAngle = Math.PI + Math.atan2(directionX, directionZ);

      for (let i = -1; i <= 1; i += 1) {
        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(0.18, 0.72, 3),
          materials.glowBlue,
        );
        arrow.name = 'conveyorDirectionArrow';
        arrow.position.set(
          position.x + directionX * i * 0.52,
          elevation + 0.04,
          position.z + directionZ * i * 0.52,
        );
        arrow.rotation.x = -Math.PI / 2;
        arrow.rotation.z = arrowAngle;
        group.add(arrow);
      }
    } else if (tile.type === 'trap') {
      const warningMaterial = tile.augmentationOwnerId
        ? materials.glowRed
        : new THREE.MeshBasicMaterial({
            color: 0xff5f5f,
            transparent: true,
            opacity: 0.72,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
      const warning = new THREE.Mesh(
        new THREE.RingGeometry(0.44, 0.54, 28),
        warningMaterial,
      );
      warning.name = 'trapWarningRing';
      warning.position.set(position.x, elevation + 0.035, position.z);
      warning.rotation.x = -Math.PI / 2;
      group.add(warning);
    }
  }

  _createSolidArchitecturalDeckAssemblies(floorTiles = []) {
    const grouped = new Map();
    for (const tile of floorTiles.filter(isArchitecturalDeckTile)) {
      const key = [
        tile.massGroupId,
        tile.roomId ?? 'room',
        tile.surface ?? 'deck',
        Number(tile.elevation ?? 0).toFixed(2),
      ].join(':');
      const assembly = grouped.get(key) ?? {
        id: tile.massGroupId,
        roomId: tile.roomId ?? null,
        surface: tile.surface ?? 'deck',
        elevation: tile.elevation ?? 0,
        baseElevation: Number(tile.roomBaseElevation ?? 0),
        level: tile.level ?? 0,
        tiles: [],
      };
      assembly.tiles.push(tile);
      grouped.set(key, assembly);
    }

    return [...grouped.values()].map((assembly) => {
      const solidTiles = assembly.tiles.filter(isSolidArchitecturalDeckTile);
      const rows = new Map();
      for (const tile of solidTiles) {
        const xs = rows.get(tile.z) ?? [];
        xs.push(tile.x);
        rows.set(tile.z, xs);
      }

      const rectangles = [];
      let active = new Map();
      for (const z of [...rows.keys()].sort((a, b) => a - b)) {
        const xs = [...new Set(rows.get(z))].sort((a, b) => a - b);
        const runs = [];
        let runStart = xs[0];
        let previous = runStart;
        for (let index = 1; index < xs.length; index += 1) {
          const x = xs[index];
          if (x === previous + 1) {
            previous = x;
          } else {
            runs.push({ minX: runStart, maxX: previous });
            runStart = x;
            previous = x;
          }
        }
        if (Number.isFinite(runStart)) {
          runs.push({ minX: runStart, maxX: previous });
        }

        const nextActive = new Map();
        for (const run of runs) {
          const runKey = `${run.minX},${run.maxX}`;
          const existing = active.get(runKey);
          const canExtend = existing && existing.maxZ === z - 1;
          if (existing && !canExtend) {
            rectangles.push(existing);
          }
          const rectangle = canExtend
            ? { ...existing, maxZ: z }
            : { ...run, minZ: z, maxZ: z };
          nextActive.set(runKey, rectangle);
        }
        for (const [runKey, rectangle] of active) {
          if (!nextActive.has(runKey)) {
            rectangles.push(rectangle);
          }
        }
        active = nextActive;
      }
      rectangles.push(...active.values());

      return {
        ...assembly,
        solidTiles,
        underpassTileCount: assembly.tiles.length - solidTiles.length,
        rectangles,
      };
    });
  }

  _addSolidTraversalVolumes(group, floorTiles = [], rooms = [], materials) {
    for (const assembly of this._createMinorDropReturnShelfAssemblies(floorTiles)) {
      const width = (assembly.maxX - assembly.minX + 1) * this.tileSize * 0.985;
      const depth = (assembly.maxZ - assembly.minZ + 1) * this.tileSize * 0.985;
      const supportHeight = Math.max(0.46, assembly.elevation - assembly.baseY - 0.06);
      const shelf = new THREE.Mesh(
        this._createTiledBoxGeometry(width, supportHeight, depth),
        [
          materials.wallMacroTiles.mm,
          materials.wallMacroTiles.mm,
          materials.raisedDeckFloor,
          materials.supportMetal,
          materials.wallMacroTiles.mm,
          materials.wallMacroTiles.mm,
        ],
      );
      shelf.name = 'minorDropReturnShelfVolume';
      shelf.position.set(
        (assembly.minX + assembly.maxX) * this.tileSize * 0.5,
        assembly.baseY + supportHeight * 0.5,
        (assembly.minZ + assembly.maxZ) * this.tileSize * 0.5,
      );
      shelf.castShadow = true;
      shelf.receiveShadow = true;
      shelf.userData.dropSpaceId = assembly.dropSpaceId;
      shelf.userData.solidLedgeSupport = true;
      shelf.userData.supportBaseElevation = assembly.baseY;
      shelf.userData.mergedReturnShelf = true;
      shelf.userData.tileCount = assembly.tiles.length;
      group.add(shelf);

      for (const ratio of [0.28, 0.72]) {
        const band = new THREE.Mesh(
          new THREE.BoxGeometry(width * 1.01, 0.12, depth * 1.01),
          materials.supportMetal,
        );
        band.name = 'minorDropReturnShelfBand';
        band.position.set(
          shelf.position.x,
          assembly.baseY + supportHeight * ratio,
          shelf.position.z,
        );
        band.castShadow = true;
        band.userData.dropSpaceId = assembly.dropSpaceId;
        band.userData.mergedReturnShelf = true;
        group.add(band);
      }
    }

    for (const assembly of this._createSolidArchitecturalDeckAssemblies(floorTiles)) {
      const architecture = new THREE.Group();
      architecture.name = `solidArchitecturalDeckAssembly_${assembly.id}`;
      architecture.userData.solidArchitecturalMass = true;
      architecture.userData.roomId = assembly.roomId;
      architecture.userData.surface = assembly.surface;
      architecture.userData.solidTileCount = assembly.solidTiles.length;
      architecture.userData.underpassTileCount = assembly.underpassTileCount;
      architecture.userData.segmentCount = assembly.rectangles.length;
      architecture.userData.cameraOcclusionOwner = true;

      for (const [segmentIndex, rectangle] of assembly.rectangles.entries()) {
        const width = (rectangle.maxX - rectangle.minX + 1) * this.tileSize * 0.985;
        const depth = (rectangle.maxZ - rectangle.minZ + 1) * this.tileSize * 0.985;
        const baseY = Number(assembly.baseElevation ?? 0);
        const height = Math.max(0.18, assembly.elevation - baseY - 0.1);
        const mass = new THREE.Mesh(
          this._createTiledBoxGeometry(width, height, depth),
          [
            materials.wallMacroTiles.mm,
            materials.wallMacroTiles.mm,
            materials.secondFloor,
            materials.supportMetal,
            materials.wallMacroTiles.mm,
            materials.wallMacroTiles.mm,
          ],
        );
        mass.name = `solidArchitecturalDeckMass_${assembly.id}_${segmentIndex + 1}`;
        mass.position.set(
          (rectangle.minX + rectangle.maxX) * this.tileSize * 0.5,
          baseY + height * 0.5 - 0.04,
          (rectangle.minZ + rectangle.maxZ) * this.tileSize * 0.5,
        );
        mass.castShadow = true;
        mass.receiveShadow = true;
        mass.userData.solidArchitecturalMass = true;
        mass.userData.cameraOcclusionSurface = true;
        mass.userData.massGroupId = assembly.id;
        mass.userData.segmentIndex = segmentIndex;
        mass.userData.tileBounds = { ...rectangle };
        architecture.add(mass);

        for (const yRatio of [0.3, 0.72]) {
          const band = new THREE.Mesh(
            new THREE.BoxGeometry(width + 0.08, 0.14, depth + 0.08),
            materials.supportMetal,
          );
          band.name = 'solidArchitecturalDeckReinforcementBand';
          band.position.set(mass.position.x, baseY + height * yRatio, mass.position.z);
          band.castShadow = true;
          band.userData.cameraOcclusionSurface = true;
          architecture.add(band);
        }
      }

      group.add(architecture);
    }

    for (const assembly of this._createPurposePlatformAssemblies(
      floorTiles,
      { includeUngrouped: true },
    )) {
      if (
        !assembly.tiles.length
        || assembly.surface === 'mechanicalPyramidSummit'
        || assembly.surface === 'mechanicalPyramidApex'
      ) {
        continue;
      }
      const height = Math.max(0.18, assembly.elevation - assembly.baseY - 0.1);
      for (const [segmentIndex, rectangle] of assembly.rectangles.entries()) {
        const width = (rectangle.maxX - rectangle.minX + 1) * this.tileSize;
        const depth = (rectangle.maxZ - rectangle.minZ + 1) * this.tileSize;
        const mass = new THREE.Mesh(
          this._createTiledBoxGeometry(width * 0.96, height, depth * 0.96),
          [
            materials.wallMacroTiles.mm,
            materials.wallMacroTiles.mm,
            materials.raisedDeckFloor,
            materials.supportMetal,
            materials.wallMacroTiles.mm,
            materials.wallMacroTiles.mm,
          ],
        );
        mass.name = `solidPurposePlatformMass_${assembly.id}_${segmentIndex + 1}`;
        mass.position.set(
          (rectangle.minX + rectangle.maxX) * this.tileSize * 0.5,
          assembly.baseY + height * 0.5 - 0.04,
          (rectangle.minZ + rectangle.maxZ) * this.tileSize * 0.5,
        );
        mass.castShadow = true;
        mass.receiveShadow = true;
        mass.userData.solidPlatformVolume = true;
        mass.userData.cameraOcclusionSurface = true;
        mass.userData.cameraOcclusionOwner = true;
        mass.userData.platformAssemblyId = assembly.id;
        mass.userData.platformGroupId = assembly.localGroupId;
        mass.userData.platformOwnerId = assembly.ownerId;
        mass.userData.segmentIndex = segmentIndex;
        mass.userData.tileBounds = { ...rectangle };
        group.add(mass);

        const bandHeight = 0.16;
        for (const y of [
          assembly.baseY + height * 0.28,
          assembly.baseY + height * 0.72,
        ]) {
          const band = new THREE.Mesh(
            new THREE.BoxGeometry(width * 0.985, bandHeight, depth * 0.985),
            materials.supportMetal,
          );
          band.name = 'solidPurposePlatformReinforcementBand';
          band.position.copy(mass.position);
          band.position.y = y;
          band.castShadow = true;
          band.userData.cameraOcclusionSurface = true;
          band.userData.cameraOcclusionOwner = true;
          band.userData.platformAssemblyId = assembly.id;
          group.add(band);
        }
      }
    }

    const rampTiles = floorTiles.filter((candidate) => candidate.surface === 'industrialRamp');
    const isStraightRampTile = (tile) => (
      Math.abs(Math.sign(tile.rampDirectionX ?? 0))
      + Math.abs(Math.sign(tile.rampDirectionZ ?? 0))
    ) === 1;
    const findContinuousRampTile = (tile, offset = 1, exclude = new Set()) => {
      const directionX = Math.sign(tile.rampDirectionX ?? 0);
      const directionZ = Math.sign(tile.rampDirectionZ ?? 0);
      return rampTiles.find((candidate) => (
        !exclude.has(candidate)
        && candidate !== tile
        && isStraightRampTile(candidate)
        && candidate.roomId === tile.roomId
        && (candidate.connectionId ?? null) === (tile.connectionId ?? null)
        && (candidate.rampRunId ?? null) === (tile.rampRunId ?? null)
        && Math.sign(candidate.rampDirectionX ?? 0) === directionX
        && Math.sign(candidate.rampDirectionZ ?? 0) === directionZ
        && candidate.x === tile.x + directionX * offset
        && candidate.z === tile.z + directionZ * offset
        && Math.abs(
          (offset > 0 ? candidate.rampStartElevation : candidate.rampEndElevation)
          - (offset > 0 ? tile.rampEndElevation : tile.rampStartElevation)
        ) <= 0.3
      ));
    };
    const createRampWedge = (run) => {
      const first = run[0];
      const last = run[run.length - 1];
      const startY = first?.rampStartElevation;
      const endY = last?.rampEndElevation;
      if (!Number.isFinite(startY) || !Number.isFinite(endY)) {
        return null;
      }
      const supportBaseY = Number(
        first.supportBaseElevation
        ?? first.roomBaseElevation
        ?? Math.min(startY, endY)
      );
      const bottomY = Math.min(supportBaseY, startY, endY) - 0.12;
      const halfWidth = this.tileSize * 0.48;
      const lengthWorld = this.tileSize * run.length;
      const halfLength = lengthWorld * 0.5;
      const slopeLength = Math.hypot(lengthWorld, endY - startY);
      const slopeRepeats = slopeLength / this.tileSize;
      const vertices = [];
      const uvs = [];
      const groups = [];
      const addQuad = (a, b, c, d, uvA, uvB, uvC, uvD, materialIndex) => {
        const start = vertices.length / 3;
        for (const point of [a, b, c, a, c, d]) {
          vertices.push(...point);
        }
        for (const uv of [uvA, uvB, uvC, uvA, uvC, uvD]) {
          uvs.push(...uv);
        }
        groups.push({ start, count: 6, materialIndex });
      };
      const startHeightRepeat = Math.max(0.05, (startY - bottomY) / this.tileSize);
      const endHeightRepeat = Math.max(0.05, (endY - bottomY) / this.tileSize);
      const widthRepeat = (halfWidth * 2) / this.tileSize;
      addQuad(
        [-halfWidth, startY, -halfLength],
        [-halfWidth, endY, halfLength],
        [halfWidth, endY, halfLength],
        [halfWidth, startY, -halfLength],
        [0, 0], [0, slopeRepeats], [1, slopeRepeats], [1, 0],
        0,
      );
      addQuad(
        [-halfWidth, bottomY, halfLength],
        [-halfWidth, bottomY, -halfLength],
        [halfWidth, bottomY, -halfLength],
        [halfWidth, bottomY, halfLength],
        [0, 0], [0, run.length], [1, run.length], [1, 0],
        1,
      );
      addQuad(
        [-halfWidth, bottomY, -halfLength],
        [-halfWidth, bottomY, halfLength],
        [-halfWidth, endY, halfLength],
        [-halfWidth, startY, -halfLength],
        [0, 0], [run.length, 0], [run.length, endHeightRepeat], [0, startHeightRepeat],
        1,
      );
      addQuad(
        [halfWidth, bottomY, halfLength],
        [halfWidth, bottomY, -halfLength],
        [halfWidth, startY, -halfLength],
        [halfWidth, endY, halfLength],
        [0, 0], [run.length, 0], [run.length, startHeightRepeat], [0, endHeightRepeat],
        1,
      );
      addQuad(
        [halfWidth, bottomY, -halfLength],
        [-halfWidth, bottomY, -halfLength],
        [-halfWidth, startY, -halfLength],
        [halfWidth, startY, -halfLength],
        [0, 0], [widthRepeat, 0], [widthRepeat, startHeightRepeat], [0, startHeightRepeat],
        1,
      );
      addQuad(
        [-halfWidth, bottomY, halfLength],
        [halfWidth, bottomY, halfLength],
        [halfWidth, endY, halfLength],
        [-halfWidth, endY, halfLength],
        [0, 0], [widthRepeat, 0], [widthRepeat, endHeightRepeat], [0, endHeightRepeat],
        1,
      );
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      for (const geometryGroup of groups) {
        geometry.addGroup(geometryGroup.start, geometryGroup.count, geometryGroup.materialIndex);
      }
      geometry.computeVertexNormals();
      geometry.userData.contiguousRampUv = true;
      geometry.userData.slopeRepeats = slopeRepeats;
      const wedge = new THREE.Mesh(geometry, [materials.industrialRamp, materials.wallTrim]);
      wedge.name = run.length > 1
        ? 'largeTexturedIndustrialSlopeVolume'
        : 'solidIndustrialSlopeVolume';
      const rampVisual = new THREE.Group();
      rampVisual.name = 'contiguousIndustrialRampRun';
      rampVisual.position.set(
        (first.x + last.x) * this.tileSize * 0.5,
        0,
        (first.z + last.z) * this.tileSize * 0.5,
      );
      const directionX = Math.sign(first.rampDirectionX ?? 0);
      const directionZ = Math.sign(first.rampDirectionZ ?? 0);
      rampVisual.rotation.y = directionX > 0
        ? Math.PI / 2
        : directionX < 0
          ? -Math.PI / 2
          : directionZ < 0
            ? Math.PI
            : 0;
      wedge.castShadow = true;
      wedge.receiveShadow = true;
      wedge.userData.solidSlopeVolume = true;
      wedge.userData.rampTileCount = run.length;
      wedge.userData.texturedWallToFloor = true;
      wedge.userData.contiguousRampSurface = true;
      wedge.userData.tiledTextureRepeats = slopeRepeats;
      wedge.userData.rampRouteId = first.rampRouteId ?? null;
      wedge.userData.rampRunId = first.rampRunId ?? null;
      wedge.userData.cameraOcclusionSurface = true;
      rampVisual.userData.cameraOcclusionOwner = true;
      rampVisual.userData.rampTileCount = run.length;
      rampVisual.userData.roomId = first.roomId ?? null;
      rampVisual.userData.rampRouteId = first.rampRouteId ?? null;
      rampVisual.userData.rampRunId = first.rampRunId ?? null;
      rampVisual.add(wedge);

      const slopeAngle = Math.atan2(endY - startY, lengthWorld);
      const edgeGeometry = new THREE.BoxGeometry(0.09, 0.08, lengthWorld * 0.985);
      for (const side of [-1, 1]) {
        const edge = new THREE.Mesh(edgeGeometry, materials.factoryRail);
        edge.name = 'contiguousIndustrialRampRaisedEdge';
        edge.position.set(side * halfWidth * 0.91, (startY + endY) * 0.5 + 0.07, 0);
        edge.rotation.x = -slopeAngle;
        edge.castShadow = true;
        rampVisual.add(edge);
      }
      const stripeGeometry = new THREE.BoxGeometry(halfWidth * 1.58, 0.045, 0.075);
      for (let index = 0; index < run.length; index += 1) {
        const progress = (index + 0.5) / run.length;
        const stripe = new THREE.Mesh(
          stripeGeometry,
          index % 2 === 0 ? materials.hazardStripe : materials.supportMetal,
        );
        stripe.name = 'contiguousIndustrialRampGripStripe';
        stripe.position.set(
          0,
          THREE.MathUtils.lerp(startY, endY, progress) + 0.055,
          -halfLength + lengthWorld * progress,
        );
        stripe.rotation.x = -slopeAngle;
        rampVisual.add(stripe);
      }
      return rampVisual;
    };

    const usedRampTiles = new Set();
    const starts = rampTiles.filter((tile) => (
      !isStraightRampTile(tile) || !findContinuousRampTile(tile, -1)
    ));
    for (const start of [...starts, ...rampTiles]) {
      if (usedRampTiles.has(start)) {
        continue;
      }
      const run = [start];
      usedRampTiles.add(start);
      if (isStraightRampTile(start)) {
        let current = start;
        while (true) {
          const next = findContinuousRampTile(current, 1, usedRampTiles);
          if (!next) {
            break;
          }
          run.push(next);
          usedRampTiles.add(next);
          current = next;
        }
      }
      const wedge = createRampWedge(run);
      if (wedge) {
        group.add(wedge);
      }
    }
  }

  _addIndustrialFactoryFeatures(
    group,
    floorTiles,
    materials,
    openAirTileKeys = new Set(),
    floorTileLookup = this._createFloorTileLookup(floorTiles),
  ) {
    const stepPairs = new Set();
    const rampColumnKeys = new Set(
      floorTiles
        .filter((tile) => tile.surface === 'industrialRamp')
        .map((tile) => tileKey(tile.x, tile.z)),
    );

    for (const tile of floorTiles) {
      const elevation = tile.elevation ?? 0;
      const supportBaseElevation = Number(
        tile.supportBaseElevation
        ?? tile.roomBaseElevation
        ?? 0
      );
      const localElevation = elevation - supportBaseElevation;
      const key = tileKey(tile.x, tile.z);

      if (openAirTileKeys.has(key)) {
        continue;
      }

      if (localElevation < -0.05) {
        this._addBasementRetainingWalls(group, tile, floorTileLookup, materials);
        continue;
      }

      if (localElevation <= 0.05) {
        continue;
      }

      if (!rampColumnKeys.has(key)) {
        this._addFactoryTileSupports(group, tile, materials, floorTileLookup);
      }

      for (const [dx, dz] of DIRECTIONS) {
        const neighbor = this._findSameFloorNeighbor(floorTileLookup, tile, dx, dz);
        if (!neighbor || openAirTileKeys.has(tileKey(neighbor.x, neighbor.z))) {
          continue;
        }

        const neighborElevation = neighbor.elevation ?? 0;
        if (
          elevation - neighborElevation <= 0.2
          || tile.surface === 'industrialRamp'
          || neighbor.surface === 'industrialRamp'
        ) {
          continue;
        }

        const pairKey = `${neighbor.x},${neighbor.z}>${tile.x},${tile.z}`;
        if (stepPairs.has(pairKey)) {
          continue;
        }

        stepPairs.add(pairKey);
        this._addFactoryStepTransition(group, neighbor, tile, materials);
      }
    }

    const dropEntryGroups = new Map();
    for (const tile of floorTiles.filter((candidate) => candidate.allowsGroundedDropLanding)) {
      for (const edge of tile.openRetainingWallEdges ?? []) {
        const [dx, dz] = edge.split(',').map(Number);
        if (!Number.isFinite(dx) || !Number.isFinite(dz)) {
          continue;
        }
        const key = `${tile.dropSpaceId ?? tile.roomId ?? 'drop'}:${dx},${dz}`;
        const entryGroup = dropEntryGroups.get(key) ?? { dx, dz, tiles: [] };
        entryGroup.tiles.push(tile);
        dropEntryGroups.set(key, entryGroup);
      }
    }

    for (const { dx, dz, tiles: entryTiles } of dropEntryGroups.values()) {
      const elevation = Math.min(...entryTiles.map((tile) => (
        tile.elevation ?? RUIN_MINOR_DROP_ELEVATION
      )));
      const roomBaseElevation = Number(entryTiles[0]?.roomBaseElevation ?? 0);
      const wallHeight = Math.max(0.12, roomBaseElevation - elevation);
      const horizontal = dz !== 0;
      const minX = Math.min(...entryTiles.map((tile) => tile.x));
      const maxX = Math.max(...entryTiles.map((tile) => tile.x));
      const minZ = Math.min(...entryTiles.map((tile) => tile.z));
      const maxZ = Math.max(...entryTiles.map((tile) => tile.z));
      const centerX = (minX + maxX) * this.tileSize * 0.5;
      const centerZ = (minZ + maxZ) * this.tileSize * 0.5;
      const openingSpan = (horizontal ? maxX - minX + 1 : maxZ - minZ + 1) * this.tileSize;
      const roomId = entryTiles[0]?.roomId ?? null;
      const dropSpaceId = entryTiles[0]?.dropSpaceId ?? null;
      const alcove = new THREE.Group();
      alcove.name = 'factoryBasementEntryAlcoveVisual';
      alcove.userData.cameraOcclusionOwner = true;
      alcove.userData.roomId = roomId;
      alcove.userData.dropSpaceId = dropSpaceId;

      const backdrop = new THREE.Mesh(
        this._createTiledBoxGeometry(
          horizontal ? openingSpan : RUIN_WALL_THICKNESS,
          wallHeight,
          horizontal ? RUIN_WALL_THICKNESS : openingSpan,
        ),
        materials.wallMacroTiles.mm,
      );
      backdrop.name = 'factoryBasementEntryBackdrop';
      backdrop.position.set(
        centerX + dx * this.tileSize * 1.5,
        elevation + wallHeight * 0.5,
        centerZ + dz * this.tileSize * 1.5,
      );
      backdrop.castShadow = true;
      backdrop.receiveShadow = true;
      backdrop.userData.roomId = roomId;
      backdrop.userData.dropSpaceId = dropSpaceId;
      alcove.add(backdrop);

      const interiorNormalX = -dx;
      const interiorNormalZ = -dz;
      const accentSize = Math.min(this.tileSize * 0.72, wallHeight * 0.45);
      const accent = new THREE.Mesh(
        new THREE.PlaneGeometry(accentSize, accentSize),
        materials.wallMacroAccents?.hatch ?? materials.wallMacroTiles.mm,
      );
      accent.name = 'factoryBasementEntryAccent';
      accent.position.copy(backdrop.position);
      accent.position.x += interiorNormalX * (RUIN_WALL_THICKNESS * 0.5 + 0.014);
      accent.position.y = elevation + wallHeight * 0.55;
      accent.position.z += interiorNormalZ * (RUIN_WALL_THICKNESS * 0.5 + 0.014);
      accent.rotation.y = interiorNormalX !== 0
        ? (interiorNormalX > 0 ? Math.PI / 2 : -Math.PI / 2)
        : (interiorNormalZ >= 0 ? 0 : Math.PI);
      accent.userData.wallAccentType = 'hatch';
      accent.userData.baseWallGrammar = 'mm';
      accent.userData.integratedWallAccent = true;
      accent.userData.dropSpaceId = dropSpaceId;
      alcove.add(accent);

      const sill = new THREE.Mesh(
        new THREE.BoxGeometry(
          horizontal ? openingSpan + 0.08 : 0.3,
          0.2,
          horizontal ? 0.3 : openingSpan + 0.08,
        ),
        materials.supportMetal,
      );
      sill.name = 'factoryBasementEntrySill';
      sill.position.copy(backdrop.position);
      sill.position.y = elevation + 0.08;
      sill.castShadow = true;
      sill.userData.dropSpaceId = dropSpaceId;
      alcove.add(sill);

      for (const side of [-1, 1]) {
        const reveal = new THREE.Mesh(
          this._createTiledBoxGeometry(
            horizontal ? RUIN_WALL_THICKNESS : this.tileSize,
            wallHeight,
            horizontal ? this.tileSize : RUIN_WALL_THICKNESS,
          ),
          materials.wallMacroTiles.mm,
        );
        reveal.name = 'factoryBasementEntryRevealWall';
        reveal.position.set(
          horizontal
            ? (side < 0 ? minX - 0.5 : maxX + 0.5) * this.tileSize
            : centerX + dx * this.tileSize,
          elevation + wallHeight * 0.5,
          horizontal
            ? centerZ + dz * this.tileSize
            : (side < 0 ? minZ - 0.5 : maxZ + 0.5) * this.tileSize,
        );
        reveal.castShadow = true;
        reveal.receiveShadow = true;
        reveal.userData.roomId = roomId;
        reveal.userData.dropSpaceId = dropSpaceId;
        alcove.add(reveal);
      }

      const header = new THREE.Mesh(
        new THREE.BoxGeometry(
          horizontal ? openingSpan + RUIN_WALL_THICKNESS * 2 : this.tileSize,
          0.24,
          horizontal ? this.tileSize : openingSpan + RUIN_WALL_THICKNESS * 2,
        ),
        materials.supportMetal,
      );
      header.name = 'factoryBasementEntryHeaderBeam';
      header.position.set(
        centerX + dx * this.tileSize,
        roomBaseElevation - 0.18,
        centerZ + dz * this.tileSize,
      );
      header.castShadow = true;
      header.userData.dropSpaceId = dropSpaceId;
      alcove.add(header);
      group.add(alcove);
    }

    this._addFactoryRailRuns(group, floorTiles, floorTileLookup, materials, openAirTileKeys);
  }

  _findSameFloorNeighbor(floorTileLookup, tile, dx, dz) {
    const candidates = floorTileLookup.get(tileKey(tile.x + dx, tile.z + dz)) ?? [];
    const elevation = tile.elevation ?? 0;
    const tolerance = tile.surface === 'industrialRamp' ? 0.75 : 0.3;

    return candidates.find((candidate) => (
      Math.abs((candidate.elevation ?? 0) - elevation) <= Math.max(
        tolerance,
        candidate.surface === 'industrialRamp' ? 0.75 : 0.3,
      )
    )) ?? null;
  }

  _addBasementRetainingWalls(group, tile, floorTileLookup, materials) {
    if (tile.surface === 'basementReturnShelf') {
      return;
    }
    const elevation = tile.elevation ?? 0;
    const supportBaseElevation = Number(
      tile.supportBaseElevation
      ?? tile.roomBaseElevation
      ?? 0
    );
    const wallHeight = Math.max(0.12, supportBaseElevation - elevation);
    const y = elevation + wallHeight * 0.5;
    const baseX = tile.x * this.tileSize;
    const baseZ = tile.z * this.tileSize;

    for (const [dx, dz] of DIRECTIONS) {
      if ((tile.openRetainingWallEdges ?? []).includes(`${dx},${dz}`)) {
        continue;
      }
      if (this._findSameFloorNeighbor(floorTileLookup, tile, dx, dz)) {
        continue;
      }

      const horizontal = dz !== 0;
      const width = horizontal ? this.tileSize : RUIN_WALL_THICKNESS;
      const depth = horizontal ? RUIN_WALL_THICKNESS : this.tileSize;
      const visualOwner = new THREE.Group();
      visualOwner.name = 'factoryBasementRetainingWallVisual';
      visualOwner.userData.cameraOcclusionOwner = true;
      visualOwner.userData.roomId = tile.roomId ?? null;
      visualOwner.userData.dropSpaceId = tile.dropSpaceId ?? null;
      const wall = new THREE.Mesh(
        this._createTiledBoxGeometry(width, wallHeight, depth),
        materials.wallMacroTiles.mm,
      );
      wall.name = 'factoryBasementRetainingWall';
      wall.position.set(
        baseX + dx * this.tileSize * 0.5,
        y,
        baseZ + dz * this.tileSize * 0.5,
      );
      wall.castShadow = true;
      wall.receiveShadow = true;
      wall.userData.tiledRetainingWall = true;
      wall.userData.roomId = tile.roomId ?? null;
      wall.userData.dropSpaceId = tile.dropSpaceId ?? null;

      const band = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.035, 0.12, depth + 0.035),
        materials.supportMetal,
      );
      band.name = 'factoryBasementRetainingWallBand';
      band.position.copy(wall.position);
      band.position.y = elevation + wallHeight * 0.62;
      band.castShadow = true;
      band.userData.roomId = tile.roomId ?? null;
      band.userData.dropSpaceId = tile.dropSpaceId ?? null;
      visualOwner.add(wall, band);
      group.add(visualOwner);
    }
  }

  _factorySupportPostsIntersectTraversableColumn(tile, floorTileLookup = null) {
    if (!(floorTileLookup instanceof Map)) {
      return false;
    }

    const elevation = Number(tile?.elevation ?? 0);
    const supportBaseElevation = Number(
      tile?.supportBaseElevation
      ?? tile?.roomBaseElevation
      ?? 0
    );
    const supportTop = elevation - 0.1;
    if (supportTop <= supportBaseElevation + 0.01) {
      return false;
    }

    const columnFloors = floorTileLookup.get(tileKey(tile.x, tile.z)) ?? [];
    return columnFloors.some((candidate) => {
      if (!candidate || candidate === tile || candidate.blockedBySolidLedgeSupport) {
        return false;
      }

      const candidateElevations = [
        candidate.elevation,
        candidate.rampStartElevation,
        candidate.rampEndElevation,
      ].filter(Number.isFinite).map(Number);
      if (!candidateElevations.length) {
        return false;
      }

      const candidateFloorBottom = Math.min(...candidateElevations);
      const candidateFloorTop = Math.max(...candidateElevations);
      if (candidateFloorBottom >= elevation - 0.05) {
        return false;
      }

      const candidateOccupiedBottom = candidateFloorBottom - 0.1;
      const candidateHeadroomTop = candidateFloorTop
        + PLAYER_TRAVERSAL_ENVELOPE.headClearance;
      return supportTop > candidateOccupiedBottom + 0.01
        && supportBaseElevation < candidateHeadroomTop - 0.01;
    });
  }

  _addFactoryTileSupports(group, tile, materials, floorTileLookup = null) {
    const elevation = tile.elevation ?? 0;
    const supportBaseElevation = Number(
      tile.supportBaseElevation
      ?? tile.roomBaseElevation
      ?? 0
    );
    const localElevation = elevation - supportBaseElevation;
    if (localElevation <= 0.05) {
      return;
    }

    if (!RAIL_ELIGIBLE_FACTORY_SURFACES.has(tile.surface)) {
      return;
    }
    if (isArchitecturalDeckTile(tile)) {
      return;
    }

    if (Math.abs(tile.x + tile.z) % 2 !== 0) {
      return;
    }

    const supportHeight = Math.max(0.12, localElevation - 0.1);
    const beamGeometryX = new THREE.BoxGeometry(this.tileSize * 0.86, 0.08, 0.12);
    const beamGeometryZ = new THREE.BoxGeometry(0.12, 0.08, this.tileSize * 0.86);
    const baseX = tile.x * this.tileSize;
    const baseZ = tile.z * this.tileSize;
    const cornerOffset = this.tileSize * 0.36;

    if (!this._factorySupportPostsIntersectTraversableColumn(tile, floorTileLookup)) {
      const supportGeometry = new THREE.BoxGeometry(0.12, supportHeight, 0.12);
      for (const offsetX of [-cornerOffset, cornerOffset]) {
        for (const offsetZ of [-cornerOffset, cornerOffset]) {
          const support = new THREE.Mesh(supportGeometry, materials.supportMetal);
          support.name = 'factoryCatwalkSupport';
          support.position.set(
            baseX + offsetX,
            supportBaseElevation + supportHeight * 0.5,
            baseZ + offsetZ,
          );
          support.castShadow = true;
          support.receiveShadow = true;
          group.add(support);
        }
      }
    }

    for (const geometry of [beamGeometryX, beamGeometryZ]) {
      const beam = new THREE.Mesh(geometry, materials.supportMetal);
      beam.name = 'factoryCatwalkUnderBeam';
      beam.position.set(baseX, elevation - 0.16, baseZ);
      beam.castShadow = true;
      beam.receiveShadow = true;
      group.add(beam);
    }
  }

  _addFactoryRailRuns(group, floorTiles, floorTileLookup, materials, openAirTileKeys = new Set()) {
    const railEdges = [];

    for (const tile of floorTiles) {
      const elevation = tile.elevation ?? 0;
      const supportBaseElevation = Number(
        tile.supportBaseElevation
        ?? tile.roomBaseElevation
        ?? 0
      );
      const forcedEdges = new Set(tile.forcedRetainingWallEdges ?? []);
      const isAtOrBelowSupportBase = elevation <= supportBaseElevation + 0.05;
      if (isAtOrBelowSupportBase && forcedEdges.size === 0) {
        continue;
      }
      if (
        tile.surface === 'industrialRamp'
        || tile.surface === 'jumpPlatform'
        || String(tile.surface ?? '').startsWith('mechanicalPyramid')
      ) {
        continue;
      }
      if (openAirTileKeys.has(tileKey(tile.x, tile.z))) {
        continue;
      }
      if (
        !RAIL_ELIGIBLE_FACTORY_SURFACES.has(tile.surface)
        && !isArchitecturalDeckTile(tile)
        && forcedEdges.size === 0
      ) {
        continue;
      }

      for (const [dx, dz] of DIRECTIONS) {
        const edgeKey = `${dx},${dz}`;
        if ((tile.openRetainingWallEdges ?? []).includes(edgeKey)) {
          continue;
        }
        const forced = forcedEdges.has(edgeKey);
        if (isAtOrBelowSupportBase && !forced) continue;
        if (!forced
          && !RAIL_ELIGIBLE_FACTORY_SURFACES.has(tile.surface)
          && !isArchitecturalDeckTile(tile)) continue;
        const adjacentColumn = floorTileLookup.get(tileKey(tile.x + dx, tile.z + dz)) ?? [];
        const hasSameTierSurface = adjacentColumn.some((candidate) => (
          candidate.surface !== 'industrialRamp'
          && Math.abs((candidate.elevation ?? 0) - elevation) <= 0.3
          && !openAirTileKeys.has(tileKey(candidate.x, candidate.z))
        ));
        if (hasSameTierSurface) {
          continue;
        }
        const hasRealRampOpening = adjacentColumn.some((candidate) => {
          if (candidate.surface !== 'industrialRamp') {
            return false;
          }
          const rampDirectionX = Math.sign(candidate.rampDirectionX ?? 0);
          const rampDirectionZ = Math.sign(candidate.rampDirectionZ ?? 0);
          const crossesEdge = Math.abs(rampDirectionX * dx + rampDirectionZ * dz) === 1;
          return crossesEdge
            && this._getTraversalActionBetweenFloorTiles(tile, candidate) === 'ramp';
        });
        if (hasRealRampOpening) {
          continue;
        }

        railEdges.push({
          horizontal: dz !== 0,
          x: tile.x,
          z: tile.z,
          dx,
          dz,
          elevation,
        });
      }
    }

    const buckets = new Map();

    for (const edge of railEdges) {
      const line = edge.horizontal
        ? edge.z + edge.dz * 0.5
        : edge.x + edge.dx * 0.5;
      const axis = edge.horizontal ? edge.x : edge.z;
      const key = [
        edge.horizontal ? 'h' : 'v',
        edge.dx,
        edge.dz,
        line,
        edge.elevation.toFixed(2),
      ].join(':');

      const bucket = buckets.get(key) ?? {
        horizontal: edge.horizontal,
        dx: edge.dx,
        dz: edge.dz,
        line,
        elevation: edge.elevation,
        axes: [],
      };

      bucket.axes.push(axis);
      buckets.set(key, bucket);
    }

    const railPostKeys = new Set();
    for (const bucket of buckets.values()) {
      bucket.axes.sort((a, b) => a - b);

      let start = bucket.axes[0];
      let previous = start;

      const flush = () => {
        const lengthTiles = previous - start + 1;
        const startEndpoint = start - 0.5;
        const endEndpoint = previous + 0.5;
        const lengthWorld = lengthTiles * this.tileSize;
        const centerAxis = ((start + previous) * 0.5) * this.tileSize;

        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(
            bucket.horizontal ? lengthWorld : RUIN_RAIL_THICKNESS,
            RUIN_RAIL_THICKNESS,
            bucket.horizontal ? RUIN_RAIL_THICKNESS : lengthWorld,
          ),
          materials.factoryRail,
        );

        rail.name = 'factoryCatwalkRailRun';
        rail.position.set(
          bucket.horizontal ? centerAxis : bucket.line * this.tileSize,
          bucket.elevation + RUIN_RAIL_HEIGHT,
          bucket.horizontal ? bucket.line * this.tileSize : centerAxis,
        );
        rail.castShadow = true;
        rail.receiveShadow = true;
        rail.userData.factoryRailRun = true;
        rail.userData.startEndpoint = startEndpoint;
        rail.userData.endEndpoint = endEndpoint;
        rail.userData.horizontal = bucket.horizontal;
        rail.userData.line = bucket.line;
        rail.userData.elevation = bucket.elevation;
        group.add(rail);

        const postGeometry = new THREE.BoxGeometry(
          RUIN_RAIL_THICKNESS,
          RUIN_RAIL_HEIGHT,
          RUIN_RAIL_THICKNESS,
        );
        const postAxes = [];
        for (let axis = startEndpoint; axis <= endEndpoint; axis += 2) {
          postAxes.push(axis);
        }
        if (Math.abs((postAxes.at(-1) ?? startEndpoint) - endEndpoint) > 0.001) {
          postAxes.push(endEndpoint);
        }
        for (const axis of postAxes) {
          const postX = bucket.horizontal ? axis * this.tileSize : bucket.line * this.tileSize;
          const postZ = bucket.horizontal ? bucket.line * this.tileSize : axis * this.tileSize;
          const postKey = `${postX.toFixed(3)},${postZ.toFixed(3)},${bucket.elevation.toFixed(3)}`;
          if (railPostKeys.has(postKey)) {
            continue;
          }
          railPostKeys.add(postKey);
          const post = new THREE.Mesh(postGeometry, materials.factoryRail);
          post.name = 'factoryCatwalkRailPost';
          post.position.set(
            postX,
            bucket.elevation + RUIN_RAIL_HEIGHT * 0.5,
            postZ,
          );
          post.castShadow = true;
          post.receiveShadow = true;
          post.userData.factoryRailPost = true;
          post.userData.elevation = bucket.elevation;
          post.userData.runEndpoint = Math.abs(axis - startEndpoint) <= 0.001
            || Math.abs(axis - endEndpoint) <= 0.001;
          group.add(post);
        }
      };

      for (let i = 1; i < bucket.axes.length; i += 1) {
        const axis = bucket.axes[i];
        if (axis === previous + 1) {
          previous = axis;
        } else {
          flush();
          start = axis;
          previous = axis;
        }
      }

      flush();
    }
  }

  _addFactoryStepTransition(group, lowerTile, upperTile, materials) {
    const lowerElevation = lowerTile.elevation ?? 0;
    const upperElevation = upperTile.elevation ?? 0;
    const dx = Math.sign(upperTile.x - lowerTile.x);
    const dz = Math.sign(upperTile.z - lowerTile.z);
    const alongX = dx !== 0;
    const baseX = lowerTile.x * this.tileSize;
    const baseZ = lowerTile.z * this.tileSize;
    const stepWidth = alongX ? this.tileSize * 0.22 : this.tileSize * 0.72;
    const stepDepth = alongX ? this.tileSize * 0.72 : this.tileSize * 0.22;
    const geometry = new THREE.BoxGeometry(stepWidth, 0.07, stepDepth);

    for (let i = 1; i <= 3; i += 1) {
      const offset = this.tileSize * (0.4 + i * 0.18);
      const heightProgress = i / 4;
      const step = new THREE.Mesh(
        geometry,
        i === 2 ? materials.hazardStripe : materials.supportMetal,
      );
      step.name = 'factoryElevationStep';
      step.position.set(
        baseX + dx * offset,
        lowerElevation + (upperElevation - lowerElevation) * heightProgress,
        baseZ + dz * offset,
      );
      step.castShadow = true;
      step.receiveShadow = true;
      group.add(step);
    }
  }

  _addIndustrialRoomSetpieces(group, rooms, floorTiles, materials, solidZones = []) {
    const roomSurfacePreferences = {
      server: ['serverCoreFloor', 'serverUpperCatwalk', 'catwalk'],
      machine: ['machinePressZone', 'machineAssemblyConveyor', 'machineCrossBridge', 'machineUpperCatwalk'],
      coolant: ['coolantValveDeck', 'coolantServicePit', 'coolantControlBalcony', 'coolantPipeBridge'],
      enemy: ['enemy', 'secondFloor', 'catwalk', 'raisedDeck'],
      keycard: ['mechanicalPyramidSummit', 'mechanicalPyramidProcessionalStep', 'mechanicalPyramidTerrace'],
      trap: ['basementFloor', 'industrialRamp'],
      conveyor: ['conveyor', 'conveyorPuzzleBelt', 'conveyorBridge', 'secondFloorConveyor', 'thirdFloorGantry'],
      boss: ['boss', 'raisedDeck', 'catwalk', 'thirdFloorGantry'],
      shrine: ['shrine', 'reveredMezzanine', 'refractorDais'],
      bonus: ['vaultRewardDais', 'vaultSanctumFloor'],
      entrance: ['entrance'],
    };
    const createRoomGroup = (room, surfaces = roomSurfacePreferences[room.type] ?? []) => {
      const tile = this._findRoomFloorTile(room, floorTiles, surfaces, { groundedOnly: true })
        ?? this._findRoomFloorTile(room, floorTiles, surfaces)
        ?? {
          x: room.x,
          z: room.z,
          elevation: 0,
        };
      const roomGroup = new THREE.Group();
      roomGroup.name = `industrialRoomSetpiece_${room.id}`;
      roomGroup.position.copy(this._floorTileToWorld(tile));
      roomGroup.userData.roomArchetype = room.archetype ?? room.type;
      roomGroup.userData.roomFlavor = room.flavor ?? null;
      roomGroup.userData.roomPurpose = room.purpose ?? null;
      roomGroup.userData.roomMood = room.mood ?? null;
      roomGroup.userData.environmentalStory = room.environmentalStory ?? null;
      roomGroup.userData.verticalPlan = room.verticalPlan ?? null;

      const lighting = room.flavorEffects?.lighting;
      if (lighting?.palette?.length) {
        const flavorLight = new THREE.PointLight(
          new THREE.Color(lighting.palette[0]),
          0.42 * (lighting.intensityMultiplier ?? 1),
          Math.max(room.width, room.depth) * this.tileSize * 0.72,
          1.7,
        );
        flavorLight.name = `roomFlavorLight_${room.flavorId ?? 'ancient'}`;
        flavorLight.position.y = Math.min((room.ceilingHeight ?? 9) - 1.2, 5.6);
        flavorLight.castShadow = false;
        roomGroup.add(flavorLight);
      }
      return roomGroup;
    };
    const addBox = (parent, name, x, z, width, height, depth, material, y = height * 0.5) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.name = name;
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const addPost = (parent, name, x, z, radius, height, material) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.18, height, 16), material);
      mesh.name = name;
      mesh.position.set(x, height * 0.5, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const addGlowNode = (parent, name, x, z, material, y = 0.92, radius = 0.16) => {
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(radius, 0), material);
      mesh.name = name;
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const addMountedPanel = (parent, name, x, z, width, height, depth, material, y) => {
      const supportHeight = Math.max(0.12, y - height * 0.5);
      addBox(parent, `${name}BackPlate`, x, z - 0.035, width + 0.18, height + 0.14, Math.max(depth, 0.08), materials.wallTrim, y);
      addBox(parent, `${name}SupportPost`, x, z, 0.08, supportHeight, 0.08, materials.supportMetal, supportHeight * 0.5);
      addBox(parent, `${name}FloorFoot`, x, z, Math.min(Math.max(width * 0.42, 0.28), 0.56), 0.08, 0.28, materials.supportMetal, 0.04);
      return addBox(parent, name, x, z, width, height, depth, material, y);
    };
    const addMountedGlowNode = (parent, name, x, z, material, y = 0.92, radius = 0.16) => {
      const supportHeight = Math.max(0.12, y - radius * 1.2);
      addPost(parent, `${name}SupportPost`, x, z, Math.max(0.035, radius * 0.28), supportHeight, materials.supportMetal);
      addBox(parent, `${name}MountPlate`, x, z, Math.max(radius * 2.6, 0.18), 0.08, Math.max(radius * 1.5, 0.08), materials.wallTrim, Math.max(0.08, y - radius * 0.75));
      return addGlowNode(parent, name, x, z, material, y, radius);
    };
    const addConduitSegment = (parent, name, fromX, fromZ, toX, toZ, material, y = 0.1, thickness = 0.1) => {
      const dx = toX - fromX;
      const dz = toZ - fromZ;
      const length = Math.max(0.01, Math.hypot(dx, dz));
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, thickness), material);
      mesh.name = name;
      mesh.position.set((fromX + toX) * 0.5, y, (fromZ + toZ) * 0.5);
      mesh.rotation.y = -Math.atan2(dz, dx);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const addSharedIndustrialDetails = (parent, room, halfW, halfD) => {
      const northZ = -halfD + 0.34;
      const southZ = halfD - 0.38;
      const detailScale = room.type === 'entrance' ? 0.72 : 1;
      const conduitMaterial = room.type === 'trap'
        ? materials.glowRed
        : room.type === 'shrine'
          ? materials.largeRefractor
          : room.type === 'bonus'
            ? materials.glowYellow
            : materials.glowBlue;

      if (ENABLE_PROCEDURAL_OVERHEAD_DECOR) {
        addBox(parent, 'ruinIdentityOverheadPipe', 0, northZ, halfW * 1.28, 0.1, 0.12, materials.factoryRail, 2.7);
        addBox(parent, 'ruinIdentityPipeDropLeft', -halfW * 0.52, northZ + 0.34, 0.1, 1.1, 0.1, materials.factoryRail, 2.12);
        addBox(parent, 'ruinIdentityPipeDropRight', halfW * 0.52, northZ + 0.34, 0.1, 1.1, 0.1, materials.factoryRail, 2.12);
      }
      addMountedPanel(parent, 'ruinIdentityWallMonitor', -halfW * 0.34, northZ - 0.08, 1.0 * detailScale, 0.44 * detailScale, 0.06, materials.glowBlue, 1.62);
      addMountedGlowNode(parent, 'ruinIdentityRedEyeNode', halfW * 0.34, northZ - 0.1, materials.glowRed, 1.74, 0.1 * detailScale);

      if (room.type === 'enemy' || room.type === 'trap' || room.type === 'conveyor' || room.type === 'keycard' || room.type === 'boss') {
        addPost(parent, 'sharedCoolantSourceTank', -halfW * 0.44, southZ, 0.22 * detailScale, 1.08 * detailScale, conduitMaterial);
        addPost(parent, 'sharedValveRelayPylon', halfW * 0.32, southZ - 0.38, 0.14 * detailScale, 1.28 * detailScale, materials.wallTrim);
        addGlowNode(parent, 'sharedValveRelayCore', halfW * 0.32, southZ - 0.38, conduitMaterial, 1.42 * detailScale, 0.12 * detailScale);
        if (ENABLE_PROCEDURAL_GLOW_LINES) {
          addConduitSegment(parent, 'sharedFloorCoolantConduit', -halfW * 0.44, southZ, halfW * 0.32, southZ - 0.38, conduitMaterial, 0.12, 0.08);
        }
      } else if (room.type === 'shrine' || room.type === 'bonus') {
        addBox(parent, 'sharedIndustrialPartsRack', halfW * 0.38, southZ, 1.12 * detailScale, 1.24 * detailScale, 0.28, materials.supportMetal, 0.62 * detailScale);
        if (ENABLE_PROCEDURAL_GLOW_LINES) {
          addConduitSegment(parent, 'sharedRefractorServiceCable', -halfW * 0.34, southZ - 0.24, halfW * 0.36, southZ - 0.24, conduitMaterial, 0.12, 0.08);
        }
      }
    };

    for (const room of rooms) {
      if (room.type === 'hub' || room.type === 'camp') {
        continue;
      }
      if (room.suppressRoomGeometry) {
        continue;
      }
      if (room.specialEnvironmentId) {
        continue;
      }

      const roomGroup = createRoomGroup(room);
      const halfW = Math.max(1.1, Math.floor(room.width / 2) * this.tileSize - 0.7);
      const halfD = Math.max(1.1, Math.floor(room.depth / 2) * this.tileSize - 0.7);
      const archetype = room.archetype ?? room.type;

      if (room.id === 'coolantRelayRoom') {
        roomGroup.name = 'coolantRelayRoomSetpiece';
        roomGroup.position.set(
          room.x * this.tileSize,
          Number(room.baseElevation ?? 0),
          room.z * this.tileSize,
        );
        roomGroup.rotation.y = room.prefabYaw ?? 0;

        const fallback = new THREE.Group();
        fallback.name = 'coolantRelayRoomProceduralFallback';
        const coolantMaterials = {
          teal: materials.glowBlue,
          amber: materials.glowYellow,
          violet: materials.glowViolet,
          green: materials.glowGreen,
        };
        const valveSpecs = [
          {
            key: 'teal',
            label: 'A',
            tank: [-halfW * 0.74, -halfD * 0.68],
            valve: [-halfW * 0.34, -halfD * 0.08],
            terminal: [-halfW * 0.44, halfD * 0.08],
          },
          {
            key: 'amber',
            label: 'B',
            tank: [halfW * 0.74, -halfD * 0.68],
            valve: [halfW * 0.34, -halfD * 0.08],
            terminal: [halfW * 0.44, halfD * 0.08],
          },
          {
            key: 'violet',
            label: 'C',
            tank: [-halfW * 0.74, halfD * 0.68],
            valve: [0, halfD * 0.44],
            terminal: [0, halfD * 0.66],
          },
        ];

        addBox(fallback, 'coolantLoweredServicePitPlate', 0, 0, halfW * 0.72, 0.08, halfD * 0.48, materials.basementFloor, -0.62);
        for (const z of [-halfD * 0.26, halfD * 0.26]) {
          addBox(fallback, 'coolantPitHazardStripe', 0, z, halfW * 0.72, 0.05, 0.08, materials.hazardStripe, 0.08);
        }

        addPost(fallback, 'coolantPressureCoreBase', 0, 0, 0.62, 0.34, materials.supportMetal);
        addPost(fallback, 'coolantGlassPressureChamber', 0, 0, 0.42, 1.8, materials.largeRefractor);
        addGlowNode(fallback, 'coolantCentralRegulatorCrystal', 0, 0, materials.glowGreen, 2.08, 0.32);
        if (ENABLE_PROCEDURAL_FLOATING_DECOR) {
          for (const y of [0.6, 1.12, 1.64]) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.035, 8, 38), materials.glowBlue);
            ring.name = 'coolantPressureCoreRing';
            ring.position.y = y;
            ring.rotation.x = Math.PI / 2;
            fallback.add(ring);
          }
        }

        for (const spec of valveSpecs) {
          const material = coolantMaterials[spec.key];
          const [tankX, tankZ] = spec.tank;
          const [valveX, valveZ] = spec.valve;
          const [terminalX, terminalZ] = spec.terminal;

          addPost(fallback, `coolant${spec.label}SourceTankGlass`, tankX, tankZ, 0.34, 1.42, material);
          addBox(fallback, `coolant${spec.label}SourceTankTopCap`, tankX, tankZ, 0.82, 0.14, 0.82, materials.supportMetal, 1.5);
          addBox(fallback, `coolant${spec.label}SourceTankBottomCap`, tankX, tankZ, 0.78, 0.12, 0.78, materials.supportMetal, 0.08);
          addGlowNode(fallback, `coolant${spec.label}TankStatusLight`, tankX, tankZ - 0.38, material, 1.58, 0.08);

          addPost(fallback, `coolantValve${spec.label}PylonBase`, valveX, valveZ, 0.26, 0.72, materials.wallTrim);
          addPost(fallback, `coolantValve${spec.label}Tower`, valveX, valveZ, 0.16, 1.48, materials.supportMetal);
          if (ENABLE_PROCEDURAL_FLOATING_DECOR) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 8, 28), material);
            ring.name = `coolantValve${spec.label}RotatingRing`;
            ring.position.set(valveX, 1.5, valveZ);
            ring.rotation.x = Math.PI / 2;
            fallback.add(ring);
          }
          if (ENABLE_PROCEDURAL_GLOW_LINES) {
            addBox(fallback, `coolantValve${spec.label}DirectionBar`, valveX, valveZ, 0.76, 0.06, 0.08, material, 1.5);
          }

          addBox(fallback, `coolantTerminal${spec.label}Base`, terminalX, terminalZ, 0.76, 0.62, 0.44, materials.terminal, 0.31);
          addBox(fallback, `coolantTerminal${spec.label}Screen`, terminalX, terminalZ - 0.24, 0.54, 0.08, 0.08, material, 0.78);
          addGlowNode(fallback, `coolantTerminal${spec.label}Button`, terminalX + 0.28, terminalZ - 0.18, materials.glowRed, 0.88, 0.06);

          if (ENABLE_PROCEDURAL_GLOW_LINES) {
            addConduitSegment(fallback, `coolant${spec.label}FeedConduit`, tankX, tankZ, valveX, valveZ, material, 0.13, 0.11);
            addConduitSegment(fallback, `coolant${spec.label}CoreConduit`, valveX, valveZ, 0, 0, material, 0.16, 0.1);
          }
        }

        addPost(fallback, 'coolantOverflowWasteTank', halfW * 0.74, halfD * 0.68, 0.32, 1.28, materials.glowGreen);
        if (ENABLE_PROCEDURAL_GLOW_LINES) {
          addConduitSegment(fallback, 'coolantOverflowReturnLine', halfW * 0.74, halfD * 0.68, 0, 0, materials.glowGreen, 0.11, 0.09);
        }

        const coolantControlDeckY = ENABLE_PROCEDURAL_RAISED_ROOM_LEVELS ? RUIN_SECOND_FLOOR_ELEVATION : 0.08;
        addBox(fallback, 'coolantNorthControlBalcony', 0, -halfD * 0.82, halfW * 1.25, 0.12, 1.12, materials.coolantFloor, coolantControlDeckY);
        addBox(fallback, 'coolantMasterPressureConsole', 0, -halfD * 0.82, 1.18, 0.72, 0.52, materials.terminal, coolantControlDeckY + 0.28);
        addBox(fallback, 'coolantMasterPressureConsoleScreen', 0, -halfD * 0.58, 0.82, 0.08, 0.08, materials.glowGreen, coolantControlDeckY + 0.78);

        addMountedGlowNode(fallback, 'coolantNorthOpenGateStatusNode', 0, -halfD + 0.32, materials.glowGreen, 1.72, 0.1);
        addMountedGlowNode(fallback, 'coolantWestRewardAlcoveStatusNode', -halfW + 0.32, 0, materials.glowYellow, 1.56, 0.1);

        for (const [x, z] of [[-halfW * 0.58, -halfD * 0.42], [halfW * 0.58, -halfD * 0.42], [-halfW * 0.58, halfD * 0.42], [halfW * 0.58, halfD * 0.42]]) {
          addPost(fallback, 'coolantDormantReaverbotSocket', x, z, 0.22, 0.22, materials.supportMetal);
          addGlowNode(fallback, 'coolantDormantSocketEye', x, z, materials.glowRed, 0.34, 0.08);
        }

        for (const [x, label] of [[-halfW * 0.28, 'A'], [0, 'B'], [halfW * 0.28, 'C']]) {
          addMountedPanel(fallback, `coolantWallPuzzleMonitor${label}`, x, -halfD + 0.34, 1.0, 0.48, 0.06, materials.glowBlue, 2.32);
          addMountedGlowNode(fallback, `coolantWallPuzzleMonitor${label}Lock`, x + 0.42, -halfD + 0.28, materials.glowRed, 2.82, 0.08);
        }

        if (ENABLE_PROCEDURAL_OVERHEAD_DECOR) {
          for (const [x, material] of [[-halfW * 0.44, materials.glowBlue], [0, materials.glowViolet], [halfW * 0.44, materials.glowYellow]]) {
            addBox(fallback, 'coolantOverheadPipeSpine', x, -halfD * 0.16, 0.1, 0.1, halfD * 1.16, materials.factoryRail, 4.86);
            if (ENABLE_PROCEDURAL_GLOW_LINES) {
              addBox(fallback, 'coolantOverheadPipeGlowChannel', x, -halfD * 0.16, 0.055, 0.055, halfD * 1.02, material, 4.94);
            }
          }
        }

        roomGroup.add(fallback);
        this._loadCoolantRelayRoomModel(roomGroup, fallback, room, solidZones);
        group.add(roomGroup);
        continue;
      }

      if (room.id === 'machineFactoryRoom') {
        roomGroup.name = 'machineFactoryRoomSetpiece';
        roomGroup.rotation.y = room.prefabYaw ?? 0;

        const fallback = new THREE.Group();
        fallback.name = 'machineFactoryRoomProceduralFallback';
        const beltLength = halfD * 1.45;
        const sideBeltX = halfW * 0.68;
        const pressZs = [-halfD * 0.34, 0, halfD * 0.34];

        const addConveyor = (name, x, z, width, depth, direction = 1) => {
          addBox(fallback, `${name}Base`, x, z, width, 0.12, depth, materials.machineFloor, 0.08);
          addBox(fallback, `${name}LeftRail`, x - width * 0.52, z, 0.08, 0.22, depth, materials.factoryRail, 0.21);
          addBox(fallback, `${name}RightRail`, x + width * 0.52, z, 0.08, 0.22, depth, materials.factoryRail, 0.21);
          for (let i = -3; i <= 3; i += 1) {
            addBox(fallback, `${name}Roller`, x, z + i * depth * 0.13, width * 0.9, 0.06, 0.06, materials.supportMetal, 0.18);
          }
          for (let i = -2; i <= 2; i += 1) {
            const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.48, 3), materials.glowBlue);
            arrow.name = `${name}DirectionArrow`;
            arrow.position.set(x, 0.24, z + direction * i * depth * 0.16);
            arrow.rotation.x = direction > 0 ? Math.PI / 2 : -Math.PI / 2;
            fallback.add(arrow);
          }
        };

        addConveyor('machineCentralAssemblyConveyor', 0, 0, 2.25, beltLength, 1);
        addConveyor('machineLeftScrapReturnConveyor', -sideBeltX, 0, 1.55, halfD * 1.16, -1);
        addConveyor('machineRightPartsFeedConveyor', sideBeltX, 0, 1.55, halfD * 1.16, 1);

        for (const z of pressZs) {
          addBox(
            fallback,
            'machinePressLeftLeg',
            -MACHINE_PRESS_LEG_OFFSET_X,
            z,
            MACHINE_PRESS_LEG_WIDTH,
            MACHINE_PRESS_LEG_HEIGHT,
            MACHINE_PRESS_LEG_DEPTH,
            materials.supportMetal,
            MACHINE_PRESS_LEG_VISUAL_CENTER_Y,
          );
          addBox(
            fallback,
            'machinePressRightLeg',
            MACHINE_PRESS_LEG_OFFSET_X,
            z,
            MACHINE_PRESS_LEG_WIDTH,
            MACHINE_PRESS_LEG_HEIGHT,
            MACHINE_PRESS_LEG_DEPTH,
            materials.supportMetal,
            MACHINE_PRESS_LEG_VISUAL_CENTER_Y,
          );
          addBox(fallback, 'machinePressTopHousing', 0, z, 3.15, 0.5, 0.76, materials.wallTrim, 1.78);
          addBox(fallback, 'machinePressPlate', 0, z, 2.55, 0.16, 0.7, materials.hazardStripe, 1.1);
          addPost(fallback, 'machinePressHydraulicPiston', 0, z, 0.1, 0.78, materials.supportMetal);
          fallback.children[fallback.children.length - 1].position.y = 1.48;
          addGlowNode(fallback, 'machinePressRedStatusLeft', -1.04, z - 0.34, materials.glowRed, 2.1, 0.08);
          addGlowNode(fallback, 'machinePressRedStatusRight', 1.04, z - 0.34, materials.glowRed, 2.1, 0.08);
        }

        for (const x of [-sideBeltX - 1.5, -sideBeltX + 1.5, sideBeltX - 1.5, sideBeltX + 1.5]) {
          for (const z of [-halfD * 0.38, halfD * 0.38]) {
            addPost(fallback, 'machineRobotArmBaseColumn', x, z, 0.13, 0.82, materials.supportMetal);
            addGlowNode(fallback, 'machineRobotArmShoulderJoint', x, z, materials.glowBlue, 1.0, 0.1);
            const direction = x < 0 ? 1 : -1;
            const upper = addBox(fallback, 'machineRobotUpperArm', x + direction * 0.36, z, 0.78, 0.1, 0.12, materials.supportMetal, 1.12);
            upper.rotation.z = direction * 0.28;
            const lower = addBox(fallback, 'machineRobotLowerArm', x + direction * 0.84, z + Math.sign(z || 1) * 0.18, 0.7, 0.09, 0.1, materials.hazardStripe, 1.0);
            lower.rotation.z = -direction * 0.36;
            addGlowNode(fallback, 'machineRobotWristJoint', x + direction * 1.18, z + Math.sign(z || 1) * 0.28, materials.glowRed, 0.94, 0.08);
          }
        }

        if (ENABLE_PROCEDURAL_OVERHEAD_DECOR) {
          addBox(fallback, 'machineOverheadCraneRail', 0, -halfD * 0.74, halfW * 1.45, 0.14, 0.2, materials.supportMetal, 5.0);
          addBox(fallback, 'machineOverheadCraneTrolley', 0, -halfD * 0.74, 1.1, 0.34, 0.52, materials.hazardStripe, 4.68);
          addPost(fallback, 'machineOverheadCraneCable', 0, -halfD * 0.74, 0.035, 1.28, materials.supportMetal).position.y = 4.0;
          const hook = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 18, Math.PI * 1.3), materials.supportMetal);
          hook.name = 'machineOverheadCraneHook';
          hook.position.set(0, 3.28, -halfD * 0.74);
          hook.rotation.x = Math.PI / 2;
          fallback.add(hook);
        }

        const tankSpecs = [
          [-halfW * 0.72, -halfD * 0.66, materials.glowBlue],
          [-halfW * 0.52, -halfD * 0.66, materials.largeRefractor],
          [halfW * 0.52, -halfD * 0.66, materials.glowYellow],
          [halfW * 0.72, -halfD * 0.66, materials.glowBlue],
        ];
        for (const [x, z, material] of tankSpecs) {
          addPost(fallback, 'machineProcessTank', x, z, 0.34, 1.35, material);
          addBox(fallback, 'machineTankPipeRun', x, z + 0.62, 0.08, 0.08, 1.15, materials.factoryRail, 1.18);
        }

        if (ENABLE_PROCEDURAL_FLOATING_DECOR) {
          const chassis = new THREE.Group();
          chassis.name = 'machineSuspendedReaverbotChassis';
          chassis.position.set(0, 3.22, -halfD * 0.34);
          const chassisBody = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.46, 0.62), materials.supportMetal);
          const chassisEye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), materials.glowRed);
          chassisEye.position.set(0, 0.03, -0.34);
          chassis.add(chassisBody, chassisEye);
          fallback.add(chassis);
        }

        const machineDeckY = ENABLE_PROCEDURAL_RAISED_ROOM_LEVELS ? RUIN_SECOND_FLOOR_ELEVATION : 0.08;
        addBox(fallback, 'machineNorthUpperCatwalk', 0, -halfD * 0.86, halfW * 1.42, 0.1, 1.06, materials.machineFloor, machineDeckY);
        addBox(fallback, 'machineCrossCatwalkBridge', 0, 0, halfW * 1.56, 0.1, 1.0, materials.machineFloor, machineDeckY);

        for (const x of [-halfW * 0.42, 0, halfW * 0.42]) {
          addMountedPanel(fallback, 'machineWallMonitor', x, -halfD + 0.28, 1.18, 0.46, 0.06, materials.glowBlue, 2.72);
          addMountedGlowNode(fallback, 'machineWallRedEye', x + 0.48, -halfD + 0.24, materials.glowRed, 3.22, 0.09);
        }
        addBox(fallback, 'machineEntryControlConsole', 0, halfD * 0.78, 1.24, 0.7, 0.56, materials.terminal, 0.35);
        addBox(fallback, 'machineEntryConsoleScreen', 0, halfD * 0.48, 0.88, 0.08, 0.08, materials.glowBlue, 0.92);
        if (ENABLE_PROCEDURAL_GLOW_LINES) {
          for (const z of [-halfD * 0.54, -halfD * 0.12, halfD * 0.28]) {
            addBox(fallback, 'machineCableBundle', -halfW * 0.34, z, 0.08, 0.045, halfD * 0.32, materials.glowBlue, 0.08);
            addBox(fallback, 'machineCableBundle', halfW * 0.34, z, 0.08, 0.045, halfD * 0.32, materials.glowBlue, 0.08);
          }
        }
        for (const [x, z] of [[-halfW * 0.36, -halfD * 0.24], [halfW * 0.36, -halfD * 0.12], [-halfW * 0.36, halfD * 0.42], [halfW * 0.36, halfD * 0.42]]) {
          addGlowNode(fallback, 'machineRefractorPowerShard', x, z, materials.largeRefractor, 0.52, 0.12);
        }

        roomGroup.add(fallback);
        this._loadMachineFactoryRoomModel(roomGroup, fallback, room, solidZones);
        group.add(roomGroup);
        continue;
      }

      if (room.id === 'alienServerRoom') {
        roomGroup.name = 'alienServerRoomSetpiece';
        roomGroup.rotation.y = room.prefabYaw ?? 0;

        const fallback = new THREE.Group();
        fallback.name = 'alienServerRoomProceduralFallback';
        const serverXs = [-halfW * 0.42, -halfW * 0.24, halfW * 0.24, halfW * 0.42];
        const serverZs = [-halfD * 0.46, -halfD * 0.16, halfD * 0.16, halfD * 0.46];

        for (const x of serverXs) {
          for (const z of serverZs) {
            addBox(fallback, 'alienServerMonolithBase', x, z, 0.92, 0.18, 0.78, materials.supportMetal, 0.09);
            addBox(fallback, 'alienServerMonolithBody', x, z, 0.72, 1.9, 0.56, materials.wallTrim, 1.08);
            addBox(fallback, 'alienServerDataWindow', x, z + Math.sign(z || 1) * 0.31, 0.44, 0.34, 0.04, materials.glowBlue, 1.36);
            addGlowNode(fallback, 'alienServerRedSensorEye', x, z - Math.sign(z || 1) * 0.31, materials.glowRed, 1.04, 0.08);
          }
        }

        addBox(fallback, 'alienServerCentralOctagonBase', 0, 0, 2.15, 0.16, 2.15, materials.serverFloor, 0.08).rotation.y = Math.PI / 4;
        addPost(fallback, 'alienServerVerticalEnergyCore', 0, 0, 0.18, 2.6, materials.glowBlue);
        addGlowNode(fallback, 'alienServerMemoryCrystal', 0, 0, materials.largeRefractor, 2.85, 0.42);
        if (ENABLE_PROCEDURAL_FLOATING_DECOR) {
          for (const y of [1.08, 2.02, 2.78]) {
            const ring = new THREE.Mesh(
              new THREE.TorusGeometry(0.84, 0.035, 8, 36),
              materials.glowBlue,
            );
            ring.name = 'alienServerEnergyRing';
            ring.position.y = y;
            ring.rotation.x = Math.PI / 2;
            fallback.add(ring);
          }
        }

        if (ENABLE_PROCEDURAL_GLOW_LINES) {
          for (const z of serverZs) {
            addBox(fallback, 'alienServerFloorCableLeft', -halfW * 0.22, z * 0.5, halfW * 0.42, 0.04, 0.08, materials.glowBlue, 0.08);
            addBox(fallback, 'alienServerFloorCableRight', halfW * 0.22, z * 0.5, halfW * 0.42, 0.04, 0.08, materials.glowBlue, 0.08);
          }
          for (const x of [-halfW * 0.36, halfW * 0.36]) {
            addBox(fallback, 'alienServerFloorCableSpine', x, 0, 0.08, 0.04, halfD * 0.92, materials.glowBlue, 0.075);
          }
        }

        const serverDeckY = ENABLE_PROCEDURAL_RAISED_ROOM_LEVELS ? RUIN_SECOND_FLOOR_ELEVATION : 0.08;
        addBox(fallback, 'alienServerNorthUpperCatwalk', 0, -halfD * 0.78, halfW * 1.42, 0.1, 1.22, materials.serverFloor, serverDeckY);
        addBox(fallback, 'alienServerEastUpperCatwalk', halfW * 0.78, 0, 1.22, 0.1, halfD * 1.32, materials.serverFloor, serverDeckY);

        for (const x of [-halfW * 0.42, -halfW * 0.14, halfW * 0.14, halfW * 0.42]) {
          addMountedPanel(fallback, 'alienServerWallDataScreen', x, -halfD + 0.26, 1.04, 0.48, 0.06, materials.glowBlue, 2.36);
          addMountedGlowNode(fallback, 'alienServerWallRedEye', x + 0.44, -halfD + 0.22, materials.glowRed, 2.96, 0.1);
        }
        for (const [x, z] of [[-halfW * 0.78, -halfD * 0.74], [halfW * 0.78, -halfD * 0.74], [-halfW * 0.78, halfD * 0.74], [halfW * 0.78, halfD * 0.74]]) {
          addMountedGlowNode(fallback, 'alienServerRoomSurveillanceEye', x, z, materials.glowRed, 2.25, 0.14);
        }

        addBox(fallback, 'alienServerEntryConsoleBase', 0, halfD * 0.78, 1.12, 0.74, 0.5, materials.terminal, 0.37);
        addBox(fallback, 'alienServerEntryConsoleScreen', 0, halfD * 0.52, 0.82, 0.08, 0.08, materials.glowBlue, 0.92);
        addGlowNode(fallback, 'alienServerEntryConsoleButton', 0.38, halfD * 0.54, materials.glowRed, 0.94, 0.07);

        if (ENABLE_PROCEDURAL_FLOATING_DECOR) {
          for (let i = 0; i < 7; i += 1) {
            const mote = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055, 0), materials.glowBlue);
            mote.name = 'alienServerFloatingDataMote';
            const angle = i * 1.72;
            mote.position.set(Math.cos(angle) * 1.24, 1.46 + i * 0.18, Math.sin(angle) * 0.94);
            fallback.add(mote);
          }
        }

        roomGroup.add(fallback);
        this._loadAlienServerRoomModel(roomGroup, fallback, room, solidZones);
        group.add(roomGroup);
        continue;
      }

      if (room.type === 'entrance') {
        addPost(roomGroup, 'securityScannerArchLeft', -0.9, 0.15, 0.08, 2.1, materials.supportMetal);
        addPost(roomGroup, 'securityScannerArchRight', 0.9, 0.15, 0.08, 2.1, materials.supportMetal);
        addBox(roomGroup, 'securityScannerArchTop', 0, 0.15, 2.1, 0.12, 0.18, materials.glowBlue, 2.12);
      } else if (room.type === 'enemy') {
        const serverLike = archetype.includes('Server') || archetype.includes('Recharge');
        for (const x of [-1.05, 1.05]) {
          for (const z of [-0.95, 0.95]) {
            if (serverLike) {
              addBox(roomGroup, 'ancientDataMonolith', x, z, 0.42, 1.8, 0.38, materials.wallTrim);
              addGlowNode(roomGroup, 'dataMonolithCore', x, z, materials.glowBlue, 1.18, 0.1);
            } else {
              addBox(roomGroup, 'reaverbotNestScrapPile', x, z, 0.78, 0.38, 0.62, materials.supportMetal);
              addGlowNode(roomGroup, 'reaverbotNestEyeNode', x, z, materials.glowRed, 0.58, 0.12);
            }
          }
        }
        if (ENABLE_PROCEDURAL_GLOW_LINES) {
          addBox(roomGroup, 'roomFunctionFloorCable', 0, 0, halfW * 1.1, 0.045, 0.12, materials.glowBlue, 0.08);
        }
      } else if (room.type === 'keycard') {
        for (const z of [-0.72, 0.72]) {
          addBox(roomGroup, 'surveillanceConsoleBank', -0.78, z, 1.02, 0.62, 0.34, materials.terminal ?? materials.wallTrim);
          addBox(roomGroup, 'surveillanceConsoleScreen', -0.78, z - 0.16, 0.72, 0.08, 0.08, materials.glowBlue, 0.76);
        }
        addPost(roomGroup, 'redEyeSurveillancePillar', halfW * 0.34, -halfD * 0.34, 0.11, 1.65, materials.supportMetal);
        addGlowNode(roomGroup, 'redEyeSurveillanceNode', halfW * 0.34, -halfD * 0.34, materials.glowRed, 1.86, 0.14);
      } else if (room.type === 'trap') {
        addBox(roomGroup, 'hazardProcessorPressLeft', -0.78, 0, 0.38, 1.15, halfD * 1.16, materials.supportMetal);
        addBox(roomGroup, 'hazardProcessorPressRight', 0.78, 0, 0.38, 1.15, halfD * 1.16, materials.supportMetal);
        addBox(roomGroup, 'hazardEmergencyShutoffLine', 0, -halfD * 0.5, halfW * 0.86, 0.06, 0.12, materials.hazardStripe, 0.14);
      } else if (room.type === 'conveyor') {
        if (ENABLE_PROCEDURAL_OVERHEAD_DECOR) {
          addBox(roomGroup, 'assemblyOverheadRail', 0, 0, halfW * 1.35, 0.12, 0.16, materials.supportMetal, 1.92);
        }
        for (const x of [-halfW * 0.36, halfW * 0.36]) {
          addPost(roomGroup, 'assemblyLineRobotArmBase', x, 0.42, 0.1, 1.25, materials.supportMetal);
          const arm = addBox(roomGroup, 'assemblyLineRobotArm', x + Math.sign(x || 1) * 0.28, 0.18, 0.64, 0.1, 0.12, materials.hazardStripe, 1.38);
          arm.rotation.z = Math.sign(x || 1) * 0.45;
        }
        addGlowNode(roomGroup, 'assemblyLinePowerNode', 0, 0, materials.glowBlue, 0.8, 0.18);
      } else if (room.type === 'boss') {
        for (const [x, z] of [[-1.4, -1.0], [1.4, -1.0], [-1.4, 1.0], [1.4, 1.0]]) {
          addPost(roomGroup, 'bossArenaContainmentPylon', x, z, 0.16, 1.95, materials.supportMetal);
          addGlowNode(roomGroup, 'bossArenaWarningCore', x, z, materials.glowRed, 2.08, 0.13);
        }
        addBox(roomGroup, 'bossArenaSignalRail', 0, -halfD * 0.62, halfW * 1.2, 0.08, 0.14, materials.glowRed, 0.2);
        addGlowNode(roomGroup, 'bossArenaCentralBeacon', 0, 0, materials.glowViolet, 0.88, 0.28);
      } else if (room.type === 'shrine') {
        for (const [x, z] of [[-1.15, 0], [1.15, 0], [0, -1.15], [0, 1.15]]) {
          addPost(roomGroup, 'refractorRelayPylon', x, z, 0.13, 1.75, materials.wallTrim);
          addGlowNode(roomGroup, 'refractorRelayCore', x, z, materials.glowBlue, 1.88, 0.15);
        }
        if (ENABLE_PROCEDURAL_GLOW_LINES) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(1.58, 0.045, 10, 44),
            materials.glowBlue,
          );
          ring.name = 'machineChapelConduitRing';
          ring.position.y = 0.18;
          ring.rotation.x = Math.PI / 2;
          roomGroup.add(ring);
        }
      } else if (room.type === 'bonus') {
        for (const x of [-0.95, 0.95]) {
          addBox(roomGroup, 'storageVaultCrateStack', x, -0.82, 0.64, 0.82, 0.54, materials.wallTrim);
          addBox(roomGroup, 'storageVaultPartsRack', x, 0.92, 0.72, 1.2, 0.28, materials.supportMetal);
          addGlowNode(roomGroup, 'vaultLockerStatusLight', x, 0.92, materials.glowYellow, 1.34, 0.08);
        }
      }

      addSharedIndustrialDetails(roomGroup, room, halfW, halfD);

      if (roomGroup.children.length) {
        group.add(roomGroup);
      }
    }
  }

  _addVolumetricIndustrialPrefabs(
    group,
    rooms = [],
    floorTiles = [],
    connectionPlans = [],
    materials,
    solidZones = [],
  ) {
    const architecture = new THREE.Group();
    architecture.name = 'volumetricIndustrialPrefabArchitecture';
    const roomBaseById = new Map(rooms.map((room) => [
      room.id,
      Number(room.baseElevation ?? 0),
    ]));
    let activeRoomBaseElevation = 0;
    const chainLinkMaterial = new THREE.MeshBasicMaterial({
      color: 0x71838b,
      transparent: true,
      opacity: 0.68,
      wireframe: true,
      side: THREE.DoubleSide,
    });
    const addMesh = (parent, name, geometry, material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const addBox = (parent, name, width, height, depth, material, x = 0, y = height * 0.5, z = 0) => (
      addMesh(parent, name, new THREE.BoxGeometry(width, height, depth), material, x, y, z)
    );
    const addCylinder = (
      parent,
      name,
      radiusTop,
      radiusBottom,
      height,
      material,
      x = 0,
      y = height * 0.5,
      z = 0,
      radialSegments = 20,
    ) => addMesh(
      parent,
      name,
      new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments),
      material,
      x,
      y,
      z,
    );
    const place = (prefab, name, x, z, rotationY = 0, y = 0) => {
      prefab.name = name;
      prefab.position.set(x, y + activeRoomBaseElevation, z);
      prefab.rotation.y = rotationY;
      architecture.add(prefab);
      return prefab;
    };
    const registerSolid = ({
      id,
      roomId = null,
      label,
      x,
      z,
      elevation = 0,
      halfWidth,
      halfDepth,
      height,
      rotationY = 0,
    }) => {
      const roomBaseElevation = roomId ? (roomBaseById.get(roomId) ?? 0) : 0;
      solidZones.push({
        id,
        roomId,
        label,
        position: new THREE.Vector3(
          x,
          roomBaseElevation + elevation + height * 0.5,
          z,
        ),
        halfWidth,
        halfDepth,
        verticalHalfHeight: height * 0.5,
        rotationY,
        fromProceduralPrefab: true,
      });
    };
    const findSafeRoomPrefabCenter = (
      room,
      preferredX,
      preferredZ,
      halfWidth,
      halfDepth,
      height,
    ) => {
      const roomCenterX = room.x * this.tileSize;
      const roomCenterZ = room.z * this.tileSize;
      const roomHalfWidth = Math.floor(room.width / 2) * this.tileSize;
      const roomHalfDepth = Math.floor(room.depth / 2) * this.tileSize;
      const protectedTiles = floorTiles.filter((tile) => (
        this._isTileInsideRoom(tile, room)
        && (
          tile.isPlatformingSurface
          || tile.connectionId
          || tile.connectorId
          || tile.connectorZone
          || tile.surface === 'industrialRamp'
          || tile.surface === 'rampLanding'
          || tile.surface === 'upperConnectionApproach'
          || tile.surface === 'upperConnectionBridge'
          || (tile.elevation ?? 0) - Number(room.baseElevation ?? 0) > 0.05
          || ['hallway', 'entrance', 'hub', 'camp'].includes(tile.type)
        )
      ));
      const offsets = [{ x: 0, z: 0 }];
      for (let radius = 1; radius <= 5; radius += 1) {
        for (let x = -radius; x <= radius; x += 1) {
          for (let z = -radius; z <= radius; z += 1) {
            if (Math.max(Math.abs(x), Math.abs(z)) === radius) {
              offsets.push({ x, z });
            }
          }
        }
      }

      for (const offset of offsets) {
        const x = preferredX + offset.x * this.tileSize;
        const z = preferredZ + offset.z * this.tileSize;
        if (
          Math.abs(x - roomCenterX) + halfWidth > roomHalfWidth - 0.35
          || Math.abs(z - roomCenterZ) + halfDepth > roomHalfDepth - 0.35
        ) {
          continue;
        }
        const overlapsTraversal = protectedTiles.some((tile) => (
          Math.abs(tile.x * this.tileSize - x) <= halfWidth + this.tileSize * 0.46
          && Math.abs(tile.z * this.tileSize - z) <= halfDepth + this.tileSize * 0.46
          && (tile.elevation ?? 0) - Number(room.baseElevation ?? 0)
            <= height + PLAYER_TRAVERSAL_ENVELOPE.headClearance
        ));
        if (overlapsTraversal) {
          continue;
        }
        const overlapsSolid = solidZones.some((zone) => (
          zone.roomId === room.id
          && Math.abs(zone.position.x - x) <= (zone.halfWidth ?? 0) + halfWidth + 0.2
          && Math.abs(zone.position.z - z) <= (zone.halfDepth ?? 0) + halfDepth + 0.2
        ));
        if (!overlapsSolid) {
          return { x, z };
        }
      }

      return { x: preferredX, z: preferredZ };
    };
    const createWaterTank = (scale = 1, accent = materials.glowBlue) => {
      const prefab = new THREE.Group();
      const body = addCylinder(prefab, 'waterTankCylindricalBody', 1.05 * scale, 1.15 * scale, 3.25 * scale, materials.wallTrim, 0, 1.85 * scale, 0, 24);
      body.userData.prefabRole = 'tank_body';
      addCylinder(prefab, 'waterTankDomedTop', 0.2 * scale, 1.05 * scale, 0.72 * scale, materials.supportMetal, 0, 3.83 * scale, 0, 24);
      addCylinder(prefab, 'waterTankFoot', 1.22 * scale, 1.22 * scale, 0.24 * scale, materials.supportMetal, 0, 0.12 * scale, 0, 24);
      for (const y of [0.62, 1.72, 2.82].map((value) => value * scale)) {
        const band = addMesh(prefab, 'waterTankReinforcementBand', new THREE.TorusGeometry(1.13 * scale, 0.08 * scale, 8, 32), materials.factoryRail, 0, y, 0);
        band.rotation.x = Math.PI / 2;
      }
      const gauge = addCylinder(prefab, 'waterTankPressureGauge', 0.22 * scale, 0.22 * scale, 0.12 * scale, accent, 0, 2.15 * scale, 1.16 * scale, 18);
      gauge.rotation.x = Math.PI / 2;
      const outlet = addCylinder(prefab, 'waterTankOutletPipe', 0.16 * scale, 0.16 * scale, 1.05 * scale, materials.factoryRail, 1.45 * scale, 0.72 * scale, 0, 16);
      outlet.rotation.z = Math.PI / 2;
      return prefab;
    };
    const createPump = (scale = 1, accent = materials.glowGreen) => {
      const prefab = new THREE.Group();
      addBox(prefab, 'pumpSkidBase', 3.4 * scale, 0.34 * scale, 2.15 * scale, materials.supportMetal);
      const housing = addCylinder(prefab, 'pumpTurbineHousing', 0.72 * scale, 0.82 * scale, 2.25 * scale, materials.wallTrim, 0, 1.18 * scale, 0, 24);
      housing.rotation.z = Math.PI / 2;
      const axle = addCylinder(prefab, 'pumpDriveAxle', 0.13 * scale, 0.13 * scale, 3.0 * scale, materials.factoryRail, 0, 1.18 * scale, 0, 16);
      axle.rotation.z = Math.PI / 2;
      for (const x of [-1.18, 1.18].map((value) => value * scale)) {
        const wheel = addMesh(prefab, 'pumpFlywheel', new THREE.TorusGeometry(0.78 * scale, 0.1 * scale, 10, 30), materials.hazardStripe, x, 1.18 * scale, 0);
        wheel.rotation.y = Math.PI / 2;
      }
      addBox(prefab, 'pumpMotorBlock', 1.28 * scale, 1.02 * scale, 1.26 * scale, materials.machineFloor, -0.2 * scale, 0.68 * scale, -0.82 * scale);
      addMesh(prefab, 'pumpStatusCore', new THREE.OctahedronGeometry(0.2 * scale, 0), accent, 0.35 * scale, 1.82 * scale, -0.72 * scale);
      return prefab;
    };
    const createCrank = (scale = 1, accent = materials.glowYellow) => {
      const prefab = new THREE.Group();
      addCylinder(prefab, 'crankPedestal', 0.42 * scale, 0.58 * scale, 1.4 * scale, materials.supportMetal, 0, 0.7 * scale, 0, 16);
      const wheel = addMesh(prefab, 'crankHandwheel', new THREE.TorusGeometry(0.72 * scale, 0.09 * scale, 10, 32), materials.factoryRail, 0, 1.65 * scale, 0);
      wheel.rotation.y = Math.PI / 2;
      for (let index = 0; index < 4; index += 1) {
        const spoke = addBox(prefab, 'crankHandwheelSpoke', 0.08 * scale, 1.18 * scale, 0.08 * scale, accent, 0, 1.65 * scale, 0);
        spoke.rotation.z = index * Math.PI * 0.25;
      }
      const hub = addCylinder(prefab, 'crankHub', 0.18 * scale, 0.18 * scale, 0.26 * scale, accent, 0, 1.65 * scale, 0, 16);
      hub.rotation.z = Math.PI / 2;
      return prefab;
    };
    const createEngine = (scale = 1, accent = materials.glowRed) => {
      const prefab = new THREE.Group();
      addBox(prefab, 'engineFoundation', 5.6 * scale, 0.42 * scale, 3.4 * scale, materials.supportMetal);
      addBox(prefab, 'engineMainCrankcase', 4.7 * scale, 1.72 * scale, 2.65 * scale, materials.machineFloor, 0, 1.08 * scale, 0);
      for (const x of [-1.55, -0.52, 0.52, 1.55].map((value) => value * scale)) {
        addCylinder(prefab, 'engineCylinderBank', 0.38 * scale, 0.48 * scale, 1.62 * scale, materials.wallTrim, x, 2.48 * scale, 0, 18);
        addCylinder(prefab, 'engineExhaustStack', 0.16 * scale, 0.24 * scale, 1.2 * scale, materials.factoryRail, x, 3.82 * scale, -0.48 * scale, 16);
      }
      for (const x of [-2.42, 2.42].map((value) => value * scale)) {
        const wheel = addMesh(prefab, 'engineMassiveFlywheel', new THREE.TorusGeometry(1.05 * scale, 0.16 * scale, 10, 36), materials.hazardStripe, x, 1.42 * scale, 0);
        wheel.rotation.y = Math.PI / 2;
      }
      addBox(prefab, 'engineControlManifold', 2.1 * scale, 0.58 * scale, 0.42 * scale, materials.terminal, 0, 1.65 * scale, -1.55 * scale);
      addMesh(prefab, 'engineHeartbeatCore', new THREE.OctahedronGeometry(0.26 * scale, 0), accent, 0, 1.68 * scale, -1.82 * scale);
      return prefab;
    };
    const createVat = (scale = 1, liquidMaterial = materials.glowViolet) => {
      const prefab = new THREE.Group();
      addMesh(prefab, 'openProcessingVatWall', new THREE.CylinderGeometry(1.62 * scale, 1.78 * scale, 2.25 * scale, 28, 1, true), materials.wallTrim, 0, 1.12 * scale, 0);
      addCylinder(prefab, 'processingVatFoot', 1.85 * scale, 1.85 * scale, 0.26 * scale, materials.supportMetal, 0, 0.13 * scale, 0, 28);
      addCylinder(prefab, 'processingVatLiquid', 1.5 * scale, 1.5 * scale, 0.12 * scale, liquidMaterial, 0, 1.92 * scale, 0, 28);
      const rim = addMesh(prefab, 'processingVatRim', new THREE.TorusGeometry(1.66 * scale, 0.12 * scale, 10, 36), materials.factoryRail, 0, 2.22 * scale, 0);
      rim.rotation.x = Math.PI / 2;
      const ladder = addBox(prefab, 'processingVatServiceLadder', 0.48 * scale, 2.0 * scale, 0.12 * scale, materials.hazardStripe, -1.74 * scale, 1.12 * scale, 0);
      ladder.rotation.z = -0.08;
      return prefab;
    };
    const createMonolith = (scale = 1, accent = materials.glowBlue) => {
      const prefab = new THREE.Group();
      addCylinder(prefab, 'massiveAlienMonolith', 0.82 * scale, 1.34 * scale, 5.4 * scale, materials.wallTrim, 0, 2.7 * scale, 0, 4).rotation.y = Math.PI / 4;
      addBox(prefab, 'monolithDataRecess', 0.72 * scale, 1.55 * scale, 0.08 * scale, accent, 0, 2.8 * scale, 0.94 * scale);
      for (const y of [0.58, 4.65].map((value) => value * scale)) {
        const collar = addMesh(prefab, 'monolithMetalCollar', new THREE.TorusGeometry(1.04 * scale, 0.12 * scale, 8, 4), materials.supportMetal, 0, y, 0);
        collar.rotation.x = Math.PI / 2;
        collar.rotation.z = Math.PI / 4;
      }
      return prefab;
    };
    const addIBeam = (parent, name, length, material, x, y, z, vertical = true) => {
      const beam = new THREE.Group();
      beam.name = name;
      if (vertical) {
        addBox(beam, `${name}Web`, 0.18, length, 0.34, material, 0, 0, 0);
        addBox(beam, `${name}FlangeA`, 0.56, length, 0.12, material, 0, 0, -0.18);
        addBox(beam, `${name}FlangeB`, 0.56, length, 0.12, material, 0, 0, 0.18);
      } else {
        addBox(beam, `${name}Web`, length, 0.18, 0.34, material, 0, 0, 0);
        addBox(beam, `${name}FlangeA`, length, 0.56, 0.12, material, 0, -0.18, -0.18);
        addBox(beam, `${name}FlangeB`, length, 0.56, 0.12, material, 0, 0.18, 0.18);
      }
      beam.position.set(x, y, z);
      parent.add(beam);
      return beam;
    };
    const createGirderFrame = (width = 7, height = 5.4) => {
      const prefab = new THREE.Group();
      addIBeam(prefab, 'girderFrameLeftColumn', height, materials.supportMetal, -width * 0.5, height * 0.5, 0, true);
      addIBeam(prefab, 'girderFrameRightColumn', height, materials.supportMetal, width * 0.5, height * 0.5, 0, true);
      addIBeam(prefab, 'girderFrameHeader', width, materials.supportMetal, 0, height, 0, false);
      for (const sign of [-1, 1]) {
        const brace = addBox(prefab, 'girderFrameDiagonalBrace', width * 0.56, 0.12, 0.16, materials.hazardStripe, 0, height * 0.6, sign * 0.18);
        brace.rotation.z = sign * 0.58;
      }
      return prefab;
    };
    const createArch = (
      width = 5.2,
      height = 4.7,
      accent = materials.glowBlue,
      clearanceProfile = null,
    ) => {
      const prefab = new THREE.Group();
      const columnHeight = clearanceProfile?.columnHeight ?? (height - width * 0.5);
      for (const x of [-width * 0.5, width * 0.5]) {
        addCylinder(prefab, 'industrialArchColumn', 0.28, 0.42, columnHeight, materials.wallTrim, x, columnHeight * 0.5, 0, 14);
        addBox(prefab, 'industrialArchColumnFoot', 0.92, 0.24, 0.92, materials.supportMetal, x, 0.12, 0);
      }
      const arch = addMesh(prefab, 'industrialCylinderArch', new THREE.TorusGeometry(width * 0.5, 0.28, 10, 32, Math.PI), materials.wallTrim, 0, columnHeight, 0);
      const innerArch = addMesh(prefab, 'industrialArchGlowChannel', new THREE.TorusGeometry(width * 0.5 - 0.38, 0.06, 8, 28, Math.PI), accent, 0, columnHeight, 0);
      if (clearanceProfile) {
        arch.scale.y = clearanceProfile.torusVerticalScale;
        innerArch.scale.y = clearanceProfile.torusVerticalScale;
        prefab.userData.archClearanceProfile = { ...clearanceProfile };
      }
      arch.rotation.z = 0;
      innerArch.rotation.z = 0;
      return prefab;
    };
    const createFence = (width = 5.4, height = 2.7) => {
      const prefab = new THREE.Group();
      const mesh = addMesh(prefab, 'chainLinkFenceMesh', new THREE.PlaneGeometry(width, height, 14, 7), chainLinkMaterial, 0, height * 0.5, 0);
      mesh.castShadow = false;
      for (const x of [-width * 0.5, 0, width * 0.5]) {
        addCylinder(prefab, 'chainLinkFencePost', 0.08, 0.1, height + 0.28, materials.factoryRail, x, (height + 0.28) * 0.5, 0, 10);
      }
      addBox(prefab, 'chainLinkFenceTopRail', width, 0.1, 0.1, materials.factoryRail, 0, height, 0);
      return prefab;
    };
    const registerFrameColumns = ({
      id,
      roomId = null,
      label,
      x,
      z,
      width,
      height,
      rotationY = 0,
      columnHalfSize = 0.42,
      elevation = 0,
    }) => {
      for (const sign of [-1, 1]) {
        const localX = sign * width * 0.5;
        registerSolid({
          id: `${id}_column_${sign < 0 ? 'left' : 'right'}`,
          roomId,
          label,
          x: x + Math.cos(rotationY) * localX,
          z: z - Math.sin(rotationY) * localX,
          halfWidth: columnHalfSize,
          halfDepth: columnHalfSize,
          height,
          elevation,
        });
      }
    };
    const registerFence = ({ id, roomId = null, label, x, z, width, height, rotationY = 0 }) => {
      registerSolid({
        id,
        roomId,
        label,
        x,
        z,
        halfWidth: width * 0.5,
        halfDepth: 0.12,
        height,
        rotationY,
      });
    };
    const createMechanicalPyramid = (room) => {
      const center = room.mechanicalPyramidCenter;
      if (!center) {
        return;
      }
      const prefab = new THREE.Group();
      const baseHalfExtent = center.baseHalfExtent ?? 8;
      const stepRise = center.stepRise ?? 0.5;
      const terraceCount = center.terraceCount ?? baseHalfExtent;

      for (let index = 0; index < terraceCount; index += 1) {
        const halfExtent = baseHalfExtent - index;
        const span = (halfExtent * 2 + 1) * this.tileSize * 0.985;
        const topY = (index + 1) * stepRise;
        const cap = addMesh(
          prefab,
          `reverentMechanicalPyramidLayer${index + 1}`,
          this._createTiledBoxGeometry(span, 0.08, span),
          index % 3 === 0
            ? materials.wallTrim
            : index % 3 === 1
              ? materials.supportMetal
              : materials.raisedDeckFloor,
          0,
          topY - 0.035,
          0,
        );
        cap.userData.mechanicalPyramidTerrace = true;
        cap.userData.terraceIndex = index;

        // A luminous three-tile-wide stair spine makes the intended combat
        // ascent legible from the entrance side of the room.
        const stairZ = -(halfExtent * this.tileSize);
        addBox(
          prefab,
          `pyramidProcessionalCircuitTread_${index + 1}`,
          this.tileSize * 2.72,
          0.045,
          this.tileSize * 0.82,
          materials.keycard ?? materials.raisedDeckFloor,
          0,
          topY + 0.022,
          stairZ,
        );
        addBox(
          prefab,
          `pyramidProcessionalCircuitStep_${index + 1}`,
          this.tileSize * 2.55,
          0.055,
          0.24,
          index % 2 ? materials.glowBlue : materials.glowYellow,
          0,
          topY + 0.035,
          stairZ,
        );

        if (index % 2 === 0) {
          for (const sign of [-1, 1]) {
            const nodeX = sign * Math.max(this.tileSize * 1.15, (halfExtent - 0.55) * this.tileSize);
            const nodeZ = -(halfExtent - 0.55) * this.tileSize;
            addMesh(
              prefab,
              `pyramidTerraceRefractorNode_${index + 1}_${sign}`,
              new THREE.OctahedronGeometry(0.18 + index * 0.012, 0),
              materials.glowBlue,
              nodeX,
              topY + 0.28,
              nodeZ,
            );
          }
        }

        if (index === 2 || index === 5) {
          const guardianEye = addMesh(
            prefab,
            `pyramidReaverbotGuardianEyeDecal_${index + 1}`,
            new THREE.OctahedronGeometry(0.3, 0),
            materials.glowRed,
            0,
            topY - stepRise * 0.45,
            stairZ - this.tileSize * 0.5 + 0.04,
          );
          guardianEye.scale.set(1.35, 0.72, 0.28);
        }
      }

      const summit = addMesh(
        prefab,
        'pyramidKeycardSummitGlyph',
        new THREE.TorusGeometry(this.tileSize * 0.72, 0.1, 10, 4),
        materials.glowBlue,
        0,
        center.elevation + 0.08,
        0,
      );
      summit.rotation.x = Math.PI / 2;
      summit.rotation.z = Math.PI / 4;
      place(
        prefab,
        'reverentMechanicalPyramidKeycardLandmark',
        center.x * this.tileSize,
        center.z * this.tileSize,
      );
    };

    for (const room of rooms.filter((candidate) => (
      !candidate.specialEnvironmentId && !RUIN_OPEN_AIR_ROOM_TYPES.has(candidate.type)
    ))) {
      activeRoomBaseElevation = Number(room.baseElevation ?? 0);
      const centerX = room.x * this.tileSize;
      const centerZ = room.z * this.tileSize;
      const halfW = Math.floor(room.width / 2) * this.tileSize;
      const halfD = Math.floor(room.depth / 2) * this.tileSize;
      const registerRoomPrefab = (id, label, x, z, halfWidth, halfDepth, height, rotationY = 0) => registerSolid({
        id: `${room.id}_${id}`,
        roomId: room.id,
        label,
        x,
        z,
        halfWidth,
        halfDepth,
        height,
        rotationY,
      });

      if (room.type === 'keycard') {
        createMechanicalPyramid(room);
        for (const sign of [-1, 1]) {
          const { x, z } = findSafeRoomPrefabCenter(
            room,
            centerX + sign * halfW * 0.62,
            centerZ - halfD * 0.48,
            0.82,
            0.72,
            2.25,
          );
          place(createCrank(1.15, materials.glowRed), `keycardRoomOverrideCrank_${sign}`, x, z, sign < 0 ? Math.PI : 0);
          registerRoomPrefab(`overrideCrank_${sign}`, 'Security override crank', x, z, 0.82, 0.72, 2.25);
        }
        const archWidth = 6.2;
        const archHeight = 5.2;
        const archZ = centerZ - halfD * 0.62;
        place(createArch(archWidth, archHeight, materials.glowYellow), 'keycardPyramidProcessionalArch', centerX, archZ);
        registerFrameColumns({
          id: `${room.id}_processionalArch`,
          roomId: room.id,
          label: 'Mechanical pyramid processional arch',
          x: centerX,
          z: archZ,
          width: archWidth,
          height: archHeight,
          columnHalfSize: 0.5,
        });
      } else if (room.type === 'coolant') {
        const { x, z } = findSafeRoomPrefabCenter(
          room,
          centerX + halfW * 0.66,
          centerZ - halfD * 0.42,
          2.1,
          1.45,
          2.8,
        );
        place(createPump(1.18, materials.glowGreen), 'coolantMainCirculationPump', x, z, Math.PI / 2);
        registerRoomPrefab('mainPump', 'Main coolant circulation pump', x, z, 2.1, 1.45, 2.8, Math.PI / 2);
        const tankPosition = findSafeRoomPrefabCenter(
          room,
          centerX - halfW * 0.7,
          centerZ - halfD * 0.66,
          1.5,
          1.5,
          4.7,
        );
        place(createWaterTank(1.18, materials.glowBlue), 'coolantMassiveWaterTank', tankPosition.x, tankPosition.z);
        registerRoomPrefab('massiveWaterTank', 'Massive coolant water tank', tankPosition.x, tankPosition.z, 1.5, 1.5, 4.7);
      } else if (room.type === 'machine') {
        const { x, z } = findSafeRoomPrefabCenter(
          room,
          centerX - halfW * 0.58,
          centerZ + halfD * 0.62,
          3.35,
          2.15,
          4.7,
        );
        place(createEngine(1.12, materials.glowRed), 'machineFactoryPrimeMoverEngine', x, z, 0);
        registerRoomPrefab('primeMover', 'Factory prime mover engine', x, z, 3.35, 2.15, 4.7);
        const frameWidth = halfW * 1.36;
        const frameZ = centerZ - halfD * 0.68;
        place(createGirderFrame(frameWidth, 6.4), 'machineFactoryMassiveGirderFrame', centerX, frameZ);
        registerFrameColumns({ id: `${room.id}_massiveGirder`, roomId: room.id, label: 'Massive factory girder', x: centerX, z: frameZ, width: frameWidth, height: 6.4 });
      } else if (room.type === 'server') {
        const frameWidth = halfW * 1.35;
        const frameZ = centerZ + halfD * 0.66;
        place(createGirderFrame(frameWidth, 6.8), 'serverCryptMassiveGirderFrame', centerX, frameZ);
        registerFrameColumns({ id: `${room.id}_massiveGirder`, roomId: room.id, label: 'Server crypt girder', x: centerX, z: frameZ, width: frameWidth, height: 6.8 });
      } else if (room.type === 'enemy') {
        for (const sign of [-1, 1]) {
          const { x, z } = findSafeRoomPrefabCenter(
            room,
            centerX + sign * halfW * 0.62,
            centerZ - halfD * 0.42,
            1.55,
            1.55,
            6.1,
          );
          place(createMonolith(1.12, sign < 0 ? materials.glowRed : materials.glowBlue), `enemyNestMassiveMonolith_${sign}`, x, z);
          registerRoomPrefab(`massiveMonolith_${sign}`, 'Massive dormant monolith', x, z, 1.55, 1.55, 6.1);
        }
      } else if (room.type === 'trap') {
        for (const sign of [-1, 1]) {
          const { x, z } = findSafeRoomPrefabCenter(
            room,
            centerX + sign * halfW * 0.62,
            centerZ - halfD * 0.5,
            2.05,
            2.05,
            2.65,
          );
          place(createVat(1.08, sign < 0 ? materials.glowViolet : materials.glowGreen), `hazardProcessingVat_${sign}`, x, z);
          registerRoomPrefab(`processingVat_${sign}`, 'Hazard-processing vat', x, z, 2.05, 2.05, 2.65);
        }
      } else if (room.type === 'conveyor') {
        const { x, z } = findSafeRoomPrefabCenter(
          room,
          centerX + halfW * 0.64,
          centerZ - halfD * 0.46,
          2.2,
          3.0,
          4.15,
        );
        place(createEngine(0.96, materials.glowBlue), 'conveyorDriveEngine', x, z, Math.PI / 2);
        registerRoomPrefab('driveEngine', 'Conveyor drive engine', x, z, 2.2, 3.0, 4.15, Math.PI / 2);
      } else if (room.type === 'boss') {
        const { x, z } = findSafeRoomPrefabCenter(
          room,
          centerX - halfW * 0.64,
          centerZ,
          2.65,
          3.85,
          5.45,
        );
        place(createEngine(1.3, materials.glowViolet), 'bossRoomColossalEngine', x, z, Math.PI / 2);
        registerRoomPrefab('colossalEngine', 'Colossal dormant engine', x, z, 2.65, 3.85, 5.45, Math.PI / 2);
        const frameWidth = halfW * 1.28;
        const frameZ = centerZ + halfD * 0.58;
        place(createGirderFrame(frameWidth, 7.0), 'bossRoomLoadBearingGirder', centerX, frameZ);
        registerFrameColumns({ id: `${room.id}_loadBearingGirder`, roomId: room.id, label: 'Boss chamber load-bearing girder', x: centerX, z: frameZ, width: frameWidth, height: 7.0 });
      } else if (room.type === 'shrine') {
        const sanctumElevation = room.refractorFocalPoint?.elevation ?? RUIN_THIRD_FLOOR_ELEVATION;
        const sanctum = new THREE.Group();
        sanctum.name = 'shrineTriplePillarSanctum';
        const pillarOffsets = [
          [-3.15, 1.525],
          [3.15, 1.525],
          [0, -3.05],
        ];
        for (const [index, [offsetX, offsetZ]] of pillarOffsets.entries()) {
          const pillar = createMonolith(0.78, materials.largeRefractor);
          pillar.name = `shrineFocalPillar_${index + 1}`;
          pillar.position.set(offsetX, 0, offsetZ);
          pillar.rotation.y = index === 2 ? Math.PI : index === 0 ? Math.PI * 0.25 : -Math.PI * 0.25;
          sanctum.add(pillar);
          registerSolid({
            id: `${room.id}_focalPillar_${index + 1}`,
            roomId: room.id,
            label: 'Triple-pillar refractor sanctum',
            x: centerX + offsetX,
            z: centerZ + offsetZ,
            elevation: sanctumElevation,
            halfWidth: 0.86,
            halfDepth: 0.86,
            height: 4.25,
          });
        }
        const crown = addMesh(
          sanctum,
          'shrineTriplePillarRefractorCrown',
          new THREE.TorusGeometry(3.75, 0.13, 10, 48),
          materials.largeRefractor,
          0,
          4.48,
          0,
        );
        crown.rotation.x = Math.PI / 2;
        place(sanctum, 'shrineTriplePillarSanctum', centerX, centerZ, 0, sanctumElevation);
        for (const sign of [-1, 1]) {
          const { x, z } = findSafeRoomPrefabCenter(
            room,
            centerX + sign * halfW * 0.7,
            centerZ,
            1.82,
            1.82,
            7.2,
          );
          place(createMonolith(1.35, materials.largeRefractor), `shrineReverentMonolith_${sign}`, x, z);
          registerRoomPrefab(`reverentMonolith_${sign}`, 'Reverent machine-chapel monolith', x, z, 1.82, 1.82, 7.2);
        }
        const archWidth = 7.4;
        const archZ = centerZ - halfD * 0.62;
        place(createArch(archWidth, 6.2, materials.largeRefractor), 'shrineCylinderArch', centerX, archZ);
        registerFrameColumns({ id: `${room.id}_cylinderArch`, roomId: room.id, label: 'Shrine cylinder arch', x: centerX, z: archZ, width: archWidth, height: 6.2, columnHalfSize: 0.5 });
      } else if (room.type === 'bonus') {
        for (const sign of [-1, 1]) {
          const { x, z } = findSafeRoomPrefabCenter(
            room,
            centerX + sign * halfW * 0.58,
            centerZ - halfD * 0.45,
            1.25,
            1.25,
            3.8,
          );
          place(createWaterTank(0.92, materials.glowYellow), `vaultReserveTank_${sign}`, x, z);
          registerRoomPrefab(`reserveTank_${sign}`, 'Sealed reserve tank', x, z, 1.25, 1.25, 3.8);
        }
      } else if (room.type === 'entrance') {
        const archWidth = 6.4;
        const archZ = centerZ + halfD * 0.4;
        place(createArch(archWidth, 5.4, materials.glowBlue), 'entranceSecurityCylinderArch', centerX, archZ);
        registerFrameColumns({ id: `${room.id}_securityArch`, roomId: room.id, label: 'Entrance security arch', x: centerX, z: archZ, width: archWidth, height: 5.4, columnHalfSize: 0.5 });
        const fenceA = createFence(halfW * 0.72, 2.9);
        const fenceB = createFence(halfW * 0.72, 2.9);
        const fenceWidth = halfW * 0.72;
        const fenceZ = centerZ - halfD * 0.38;
        const leftFenceX = centerX - halfW * 0.58;
        const rightFenceX = centerX + halfW * 0.58;
        place(fenceA, 'entranceChainLinkSecurityFenceLeft', leftFenceX, fenceZ, Math.PI / 2);
        place(fenceB, 'entranceChainLinkSecurityFenceRight', rightFenceX, fenceZ, Math.PI / 2);
        registerFence({ id: `${room.id}_securityFenceLeft`, roomId: room.id, label: 'Entrance chain-link fence', x: leftFenceX, z: fenceZ, width: fenceWidth, height: 2.9, rotationY: Math.PI / 2 });
        registerFence({ id: `${room.id}_securityFenceRight`, roomId: room.id, label: 'Entrance chain-link fence', x: rightFenceX, z: fenceZ, width: fenceWidth, height: 2.9, rotationY: Math.PI / 2 });
      }
    }

    activeRoomBaseElevation = 0;
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    for (const plan of connectionPlans) {
      const fromRoom = roomById.get(plan.fromRoomId);
      const toRoom = roomById.get(plan.toRoomId);
      if (!fromRoom || !toRoom || RUIN_OPEN_AIR_ROOM_TYPES.has(fromRoom.type) || RUIN_OPEN_AIR_ROOM_TYPES.has(toRoom.type)) {
        continue;
      }
      const path = plan.bridgePath ?? [];
      if (path.length < 2) {
        continue;
      }
      const traversalBeats = plan.connectorVariant?.traversalKind === 'ladder'
        ? [
            { type: 'calibrated_ladder_transfer', connectorId: plan.id, endpoint: 'entry' },
            { type: 'supported_upper_gantry', connectorId: plan.id, endpoint: 'exit' },
          ]
        : plan.connectorVariant?.traversalKind === 'automatic_lift'
          ? [
              { type: 'automatic_freight_lift', connectorId: plan.id },
              { type: 'tiled_sloped_return', connectorId: plan.id },
            ]
          : plan.connectorVariant?.traversalKind === 'slope'
            ? [
                { type: 'tiled_supported_ascent', connectorId: plan.id },
                { type: 'elevated_slope_crest', connectorId: plan.id },
              ]
            : [];
      plan.explorationBeats = [...traversalBeats];

      for (const [beatIndex, beat] of (plan.decorativeArchBeats ?? []).entries()) {
        const point = beat.gridPoint;
        const direction = beat.direction ?? { x: 0, z: 1 };
        const rotationY = direction.x !== 0 ? Math.PI / 2 : 0;
        const worldX = point.x * this.tileSize;
        const worldZ = point.z * this.tileSize;
        const floorElevation = beat.floorElevation ?? 0;
        const archHeight = beat.archHeightMeters
          ?? Math.min(5.5, Math.max(3.8, (beat.clearHeightMeters ?? 8.4) - 0.2));
        const clearanceProfile = resolveConnectorDecorativeArchProfile(
          beat.widthMeters,
          archHeight,
          beat.laneCenterOffsetMeters ?? this.tileSize,
        );
        const name = `connectorIndustrialArch_${plan.id}_${beatIndex}`;
        const arch = place(
          createArch(
            beat.widthMeters,
            archHeight,
            beatIndex % 2 === 0 ? materials.glowBlue : materials.glowYellow,
            clearanceProfile,
          ),
          name,
          worldX,
          worldZ,
          rotationY,
          floorElevation,
        );
        arch.userData.connectorDecorativeArch = true;
        arch.userData.connectorId = plan.id;
        arch.userData.pathIndex = beat.pathIndex;
        arch.userData.internalClearWidthMeters = beat.internalClearWidthMeters;
        registerFrameColumns({
          id: name,
          label: 'Connector cylinder arch',
          x: worldX,
          z: worldZ,
          width: beat.widthMeters,
          height: archHeight,
          rotationY,
          columnHalfSize: CONNECTOR_DECORATIVE_ARCH_COLUMN_HALF_SIZE,
          elevation: floorElevation,
        });
        plan.explorationBeats.push({
          type: 'v1_decorative_cylinder_arch',
          connectorId: plan.id,
          x: point.x,
          z: point.z,
          elevation: floorElevation,
        });
      }

      for (const beat of plan.classicV1ServiceBeats ?? []) {
        const direction = beat.direction ?? { x: 0, z: 1 };
        const rotationY = direction.x !== 0 ? Math.PI / 2 : 0;
        const serviceX = beat.servicePoint.x * this.tileSize;
        const serviceZ = beat.servicePoint.z * this.tileSize;
        const fenceX = beat.fencePoint.x * this.tileSize;
        const fenceZ = beat.fencePoint.z * this.tileSize;
        const girderX = beat.girderPoint.x * this.tileSize;
        const girderZ = beat.girderPoint.z * this.tileSize;
        const furnishing = new THREE.Group();
        furnishing.name = `classicV1CorridorFurnishing_${plan.id}`;
        furnishing.userData.classicV1CorridorFurnishing = true;
        furnishing.userData.connectorId = plan.id;
        furnishing.userData.serviceBeatId = beat.id;
        furnishing.userData.keepsTravelEnvelopeClear = beat.keepsTravelEnvelopeClear === true;

        const service = beat.serviceKind === 'pump'
          ? createPump(0.72, materials.glowGreen)
          : createWaterTank(0.72, materials.glowBlue);
        service.name = beat.serviceKind === 'pump'
          ? 'classicV1ConnectorServicePump'
          : 'classicV1ConnectorServiceTank';
        service.position.set(serviceX, 0, serviceZ);
        service.rotation.y = rotationY;
        furnishing.add(service);
        registerSolid({
          id: `${beat.id}:service-collision`,
          label: 'Classic V1 connector service machinery',
          x: serviceX,
          z: serviceZ,
          halfWidth: beat.serviceHalfExtentMeters,
          halfDepth: beat.serviceHalfExtentMeters,
          height: 3.8,
          rotationY,
        });

        const fenceWidth = this.tileSize * 2.2;
        const fence = createFence(fenceWidth, 2.9);
        fence.name = 'classicV1ConnectorParallelServiceFence';
        fence.position.set(fenceX, 0, fenceZ);
        fence.rotation.y = rotationY;
        furnishing.add(fence);
        registerFence({
          id: `${beat.id}:fence-collision`,
          label: 'Classic V1 connector parallel service fence',
          x: fenceX,
          z: fenceZ,
          width: fenceWidth,
          height: 2.9,
          rotationY,
        });

        const girderHeight = 5.25;
        const girder = createGirderFrame(beat.girderWidthMeters, girderHeight);
        girder.name = 'classicV1ConnectorGirderPortal';
        girder.position.set(girderX, 0, girderZ);
        girder.rotation.y = rotationY;
        furnishing.add(girder);
        registerFrameColumns({
          id: `${beat.id}:girder`,
          label: 'Classic V1 connector girder portal',
          x: girderX,
          z: girderZ,
          width: beat.girderWidthMeters,
          height: girderHeight,
          rotationY,
          columnHalfSize: 0.42,
        });

        architecture.add(furnishing);
        plan.explorationBeats.push({
          type: 'v1_service_bay_and_girder',
          connectorId: plan.id,
          serviceBeatId: beat.id,
        });
      }
    }

    if (architecture.children.length) {
      group.add(architecture);
    }
  }

  _loadAlienServerRoomModel(roomGroup, fallback, room, solidZones = []) {
    if (!ENABLE_IMPORTED_GLB_ROOMS || !this.gltfLoader) {
      return;
    }

    this.gltfLoader.load(
      ALIEN_SERVER_ROOM_MODEL,
      (gltf) => {
        const model = gltf.scene;
        if (this._isDisposedGenerationCandidateObject(roomGroup)) {
          this._disposeDetachedObjectResources(model);
          return;
        }
        model.name = 'alienServerRoomImportedGLB';
        model.userData.roomId = room.id;
        this._stripImportedRoomShell(model);
        model.traverse((child) => {
          if (!child.isMesh) {
            return;
          }

          child.castShadow = true;
          child.receiveShadow = true;
          child.userData.alienServerRoomPrefab = true;
        });

        const targetWidth = Math.max(
          ALIEN_SERVER_ROOM_FOOTPRINT.width,
          (room.width - 2) * this.tileSize,
        );
        const targetDepth = Math.max(
          ALIEN_SERVER_ROOM_FOOTPRINT.depth,
          (room.depth - 2) * this.tileSize,
        );
        const bounds = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        bounds.getSize(size);
        const scale = Math.min(
          targetWidth / Math.max(0.001, size.x),
          targetDepth / Math.max(0.001, size.z),
        );
        model.scale.setScalar(scale);

        bounds.setFromObject(model);
        const center = new THREE.Vector3();
        bounds.getCenter(center);
        model.position.set(-center.x, -bounds.min.y + 0.02, -center.z);

        roomGroup.add(model);
        this._addImportedModelCollisionZones(model, roomGroup, room, solidZones);
        fallback.visible = false;
      },
      undefined,
      (error) => {
        console.warn('Failed to load alien server room prefab', error);
      },
    );
  }

  _loadMachineFactoryRoomModel(roomGroup, fallback, room, solidZones = []) {
    if (!ENABLE_IMPORTED_GLB_ROOMS || !this.gltfLoader) {
      return;
    }

    this.gltfLoader.load(
      MACHINE_FACTORY_ROOM_MODEL,
      (gltf) => {
        const model = gltf.scene;
        if (this._isDisposedGenerationCandidateObject(roomGroup)) {
          this._disposeDetachedObjectResources(model);
          return;
        }
        model.name = 'machineFactoryRoomImportedGLB';
        model.userData.roomId = room.id;
        this._stripImportedRoomShell(model);
        model.traverse((child) => {
          if (!child.isMesh) {
            return;
          }

          child.castShadow = true;
          child.receiveShadow = true;
          child.userData.machineFactoryRoomPrefab = true;
        });

        const targetWidth = Math.max(
          MACHINE_FACTORY_ROOM_FOOTPRINT.width,
          (room.width - 2) * this.tileSize,
        );
        const targetDepth = Math.max(
          MACHINE_FACTORY_ROOM_FOOTPRINT.depth,
          (room.depth - 2) * this.tileSize,
        );
        const bounds = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        bounds.getSize(size);
        const scale = Math.min(
          targetWidth / Math.max(0.001, size.x),
          targetDepth / Math.max(0.001, size.z),
        );
        model.scale.setScalar(scale);

        bounds.setFromObject(model);
        const center = new THREE.Vector3();
        bounds.getCenter(center);
        model.position.set(-center.x, -bounds.min.y + 0.02, -center.z);

        roomGroup.add(model);
        this._addImportedModelCollisionZones(model, roomGroup, room, solidZones);
        fallback.visible = false;
      },
      undefined,
      (error) => {
        console.warn('Failed to load machine factory room prefab', error);
      },
    );
  }

  _loadCoolantRelayRoomModel(roomGroup, fallback, room, solidZones = []) {
    if (!ENABLE_IMPORTED_GLB_ROOMS || !this.gltfLoader) {
      return;
    }

    this.gltfLoader.load(
      COOLANT_RELAY_ROOM_MODEL,
      (gltf) => {
        const model = gltf.scene;
        if (this._isDisposedGenerationCandidateObject(roomGroup)) {
          this._disposeDetachedObjectResources(model);
          return;
        }
        model.name = 'coolantRelayRoomImportedGLB';
        model.userData.roomId = room.id;
        this._stripImportedRoomShell(model);
        this._stripCoolantImportedLooseDecor(model);
        model.traverse((child) => {
          if (!child.isMesh) {
            return;
          }

          child.castShadow = true;
          child.receiveShadow = true;
          child.userData.coolantRelayRoomPrefab = true;
        });

        const targetWidth = Math.max(
          COOLANT_RELAY_ROOM_FOOTPRINT.width,
          (room.width - 2) * this.tileSize,
        );
        const targetDepth = Math.max(
          COOLANT_RELAY_ROOM_FOOTPRINT.depth,
          (room.depth - 2) * this.tileSize,
        );
        const bounds = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        bounds.getSize(size);
        const scale = Math.min(
          targetWidth / Math.max(0.001, size.x),
          targetDepth / Math.max(0.001, size.z),
        );
        model.scale.setScalar(scale);

        bounds.setFromObject(model);
        const center = new THREE.Vector3();
        bounds.getCenter(center);
        model.position.set(-center.x, -bounds.min.y + 0.02, -center.z);

        roomGroup.add(model);
        this._addImportedModelCollisionZones(model, roomGroup, room, solidZones);
        fallback.visible = false;
      },
      undefined,
      (error) => {
        console.warn('Failed to load coolant relay room prefab', error);
      },
    );
  }

  _stripImportedRoomShell(model) {
    model.traverse((object) => {
      if (!object?.name || !this._isImportedRoomShellNode(object.name)) {
        return;
      }

      object.visible = false;
      object.userData.importedRoomShellHidden = true;
    });
  }

  _stripCoolantImportedLooseDecor(model) {
    model.traverse((object) => {
      if (!object?.name) {
        return;
      }

      const normalized = object.name.toLowerCase();
      const isLooseImportedDetail = normalized.includes('cable')
        || normalized.includes('pipe')
        || normalized.includes('conduit')
        || normalized.includes('rail')
        || normalized.includes('grate')
        || normalized.includes('arrow')
        || normalized.includes('mote');

      if (!isLooseImportedDetail) {
        return;
      }

      object.visible = false;
      object.userData.coolantLooseImportedDetailHidden = true;
    });
  }

  _addImportedModelCollisionZones(model, roomGroup, room, solidZones) {
    if (!Array.isArray(solidZones)) {
      return;
    }

    roomGroup.updateWorldMatrix(true, true);
    model.updateWorldMatrix(true, true);

    model.traverse((object) => {
      if (!object.isMesh || !object.visible) {
        return;
      }

      if (this._isImportedRoomShellNode(object.name)) {
        return;
      }

      const name = object.name.toLowerCase();
      const isMajorFixture = name.includes('tank')
        || name.includes('core')
        || name.includes('chamber')
        || name.includes('pylon')
        || name.includes('valve')
        || name.includes('terminal')
        || name.includes('console')
        || name.includes('machine')
        || name.includes('press')
        || name.includes('rack')
        || name.includes('monolith')
        || name.includes('server')
        || name.includes('socket');

      if (
        name.includes('cable')
        || name.includes('pipe')
        || name.includes('conduit')
        || name.includes('monitor')
        || name.includes('screen')
        || name.includes('status_light')
        || name.includes('red_eye')
        || name.includes('rail')
        || name.includes('grate')
        || name.includes('arrow')
        || name.includes('mote')
      ) {
        return;
      }

      const box = new THREE.Box3().setFromObject(object);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      if (!isMajorFixture && size.x < 0.45 && size.z < 0.45) {
        return;
      }
      if (!isMajorFixture && size.y < 0.35) {
        return;
      }
      if (isMajorFixture && size.y < 0.12) {
        return;
      }

      const zonePosition = center.clone();
      zonePosition.y = box.min.y + Math.min(size.y * 0.5, isMajorFixture ? 0.85 : 0.65);

      solidZones.push({
        id: `imported_${room.id}_${object.name}`,
        roomId: room.id,
        label: object.name,
        position: zonePosition,
        halfWidth: Math.max(isMajorFixture ? 0.42 : 0.25, size.x * 0.5),
        halfDepth: Math.max(isMajorFixture ? 0.42 : 0.25, size.z * 0.5),
        verticalHalfHeight: Math.max(isMajorFixture ? 1.05 : 0.75, size.y * 0.5 + 0.45),
        fromImportedGLB: true,
      });
    });
  }

  _isImportedRoomShellNode(name) {
    const normalized = name.toLowerCase();

    if (
      normalized.includes('data_screen')
      || normalized.includes('puzzle_monitor')
      || normalized.includes('monitor')
      || normalized.includes('red_eye')
      || normalized.includes('red_status')
      || normalized.includes('status_light')
      || normalized.includes('console')
      || normalized.includes('cable')
      || normalized.includes('conduit')
      || normalized.includes('pipe')
      || normalized.includes('tank')
      || normalized.includes('valve')
      || normalized.includes('terminal')
    ) {
      return false;
    }

    return normalized.includes('floor_slab')
      || normalized.includes('factory_floor_slab')
      || normalized.includes('main_floor_slab')
      || normalized.includes('floor_panel_seam')
      || normalized.includes('floor_seam')
      || normalized.includes('_wall')
      || normalized.endsWith('wall')
      || normalized.includes('wall_trim')
      || normalized.endsWith('_trim')
      || normalized.includes('door_header')
      || normalized.includes('entry_header')
      || normalized.includes('exit_header')
      || normalized.includes('locked_exit_gate')
      || normalized.includes('optional_reward_gate')
      || normalized.includes('gate_frame')
      || normalized.includes('gate_energy_bar');
  }

  _addCeilings(
    group,
    tiles,
    materials,
    openAirTileKeys = new Set(),
    rooms = [],
    authoritativeFloorLayers = null,
  ) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const ceilingGeometry = new THREE.BoxGeometry(this.tileSize, RUIN_CEILING_THICKNESS, this.tileSize);
    const emittedCeilingKeys = new Set();
    const usesAuthoritativeFloorLayers = authoritativeFloorLayers != null;

    for (const tile of authoritativeFloorLayers ?? tiles.values()) {
      if (openAirTileKeys.has(tileKey(tile.x, tile.z))) {
        continue;
      }

      const room = roomById.get(tile.roomId);
      if (room?.specialEnvironmentId) {
        continue;
      }
      const ceiling = new THREE.Mesh(ceilingGeometry, materials.ceiling);
      const floorElevation = Number(
        usesAuthoritativeFloorLayers
          && (tile?.dungeonSupplement === true || tile?.augmentationOwnerId)
          ? tile.elevation
          : room?.baseElevation
        ?? tile.connectorMinY
        ?? tile.elevation
        ?? 0,
      );
      const roomBaseElevation = Number(
        room?.baseElevation
        ?? room?.plannedBaseElevation
        ?? tile.connectorMinY
        ?? floorElevation,
      );
      const roomCeilingY = room?.ceilingY != null
        && Number.isFinite(Number(room.ceilingY))
        ? Number(room.ceilingY)
        : usesAuthoritativeFloorLayers
          && room?.ceilingHeight != null
          && Number.isFinite(Number(room.ceilingHeight))
          ? roomBaseElevation + Number(room.ceilingHeight)
          : null;
      const ceilingHeight = Number(
        roomCeilingY
        ?? tile.connectorCeilingY
        ?? (floorElevation + 8.4),
      );
      const ceilingKey = `${tile.x}:${tile.z}:${ceilingHeight.toFixed(3)}`;
      if (emittedCeilingKeys.has(ceilingKey)) continue;
      emittedCeilingKeys.add(ceilingKey);
      ceiling.name = 'dungeonRoomCeiling';
      ceiling.position.set(
        tile.x * this.tileSize,
        ceilingHeight + RUIN_CEILING_THICKNESS * 0.5,
        tile.z * this.tileSize,
      );
      ceiling.userData.ceilingHeight = ceilingHeight;
      ceiling.userData.floorElevation = floorElevation;
      ceiling.userData.roomId = room?.id ?? null;
      ceiling.userData.connectorId = tile.connectorId ?? null;
      if (tile.augmentationOwnerId) {
        ceiling.userData.augmentationOwnerId = tile.augmentationOwnerId;
      }
      ceiling.castShadow = true;
      ceiling.receiveShadow = true;
      group.add(ceiling);
    }
  }

  _validateConnectorEntranceWalkability({
    floorTiles = [],
    rooms = [],
    solidZones = [],
    segmentBarrierZones = null,
    connectionPlans = [],
    wallRuns = [],
    useSegmentBarriers = false,
  } = {}) {
    const errors = [];
    const checks = [];
    const skippedGraphConnectionIds = [];
    const blockingPlatformTops = this._createBlockingPlatformColumnMap(floorTiles);
    const navigableTiles = floorTiles.filter((tile) => (
      !this._isFloorTileBlockedBySolidZone(tile, solidZones)
      && !this._isFloorTileBlockedByGeneratedPlatform(tile, blockingPlatformTops)
    ));
    const columns = this._createFloorTileLookup(navigableTiles);
    const startRoom = rooms.find((room) => room.id === 'hubTown') ?? rooms[0];
    const startTile = this._findRoomWalkabilityStartTile(startRoom, navigableTiles);
    const traversalSegmentBarrierZones = useSegmentBarriers
      ? (segmentBarrierZones ?? solidZones).filter((zone) => zone?.position)
      : [];
    const strictConnectorBarrierZones = useSegmentBarriers
      ? [...solidZones, ...traversalSegmentBarrierZones]
        .filter((zone) => zone?.position)
        .filter((zone, index, zones) => (
          zones.findIndex((candidate) => candidate?.id === zone?.id) === index
        ))
      : [];
    const canTraverseConnectorEdge = (fromTile, toTile, traversalAction = null) => (
      ['ladder', 'automatic_lift'].includes(traversalAction)
      || !traversalSegmentBarrierZones.some((zone) => (
        this._doesFloorTraversalSegmentIntersectZone(
          fromTile,
          toTile,
          zone,
          PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
        )
      ))
    );
    const canTraverseStrictConnectorEdge = (fromTile, toTile, traversalAction = null) => (
      ['ladder', 'automatic_lift'].includes(traversalAction)
      || !strictConnectorBarrierZones.some((zone) => (
        this._doesFloorTraversalSegmentIntersectZone(
          fromTile,
          toTile,
          zone,
          PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
        )
      ))
    );
    const reachable = this._createReachableFloorTileKeySet(
      startTile,
      navigableTiles,
      { canTraverseEdge: canTraverseConnectorEdge },
    );
    const findFloor = (x, z, elevation) => (columns.get(tileKey(x, z)) ?? [])
      .sort((first, second) => (
        Math.abs(Number(first.elevation ?? 0) - elevation)
        - Math.abs(Number(second.elevation ?? 0) - elevation)
      ))
      .find((tile) => Math.abs(Number(tile.elevation ?? 0) - elevation) <= 0.56)
      ?? null;
    const resolveFacing = (plan, socket, role) => {
      let x = Math.sign(Number(socket?.facingX ?? 0));
      let z = Math.sign(Number(socket?.facingZ ?? 0));
      if (Math.abs(x) + Math.abs(z) === 1) return { x, z };
      const path = plan.bridgePath ?? plan.fullPath ?? [];
      const index = path.findIndex((point) => point.x === socket?.x && point.z === socket?.z);
      const outside = role === 'from'
        ? path[Math.min(path.length - 1, Math.max(0, index) + 1)]
        : path[Math.max(0, (index < 0 ? path.length - 1 : index) - 1)];
      x = Math.sign(Number(outside?.x) - Number(socket?.x));
      z = Math.sign(Number(outside?.z) - Number(socket?.z));
      return Math.abs(x) + Math.abs(z) === 1 ? { x, z } : null;
    };
    const wallBlocks = (socket, facing, elevation, clearanceHeight) => {
      const horizontal = facing.z !== 0;
      const line = horizontal
        ? Number(socket.z) + facing.z * 0.5
        : Number(socket.x) + facing.x * 0.5;
      const minimumY = elevation;
      const maximumY = elevation + clearanceHeight;
      return wallRuns.find((run) => {
        if (run.horizontal !== horizontal || Math.abs(run.line - line) > 0.001) return false;
        if (run.wallTopY <= minimumY + 0.001 || run.wallBottomY >= maximumY - 0.001) return false;
        for (const lane of this._getConnectorEntranceLanes(socket, facing)) {
          const axis = horizontal ? lane.x : lane.z;
          if (run.start <= axis && run.end >= axis) return true;
        }
        return false;
      }) ?? null;
    };

    const seenSocketIds = new Set();
    for (const plan of connectionPlans) {
      if (
        plan.isSupplementGraphConnection
        || plan.connectorVariantConstraints?.graphOnly === true
      ) {
        skippedGraphConnectionIds.push(plan.id);
        continue;
      }
      for (const [role, socket] of [['from', plan.fromSocket], ['to', plan.toSocket]]) {
        if (!socket || seenSocketIds.has(socket.id)) continue;
        seenSocketIds.add(socket.id);
        const facing = resolveFacing(plan, socket, role);
        const elevation = Number(socket.elevation ?? plan.elevation ?? 0);
        const clearanceHeight = Math.max(
          PLAYER_TRAVERSAL_ENVELOPE.headClearance,
          Number(socket.clearanceHeight ?? 0),
        );
        if (!facing) {
          errors.push(`${socket.id} has no cardinal connector entrance facing.`);
          checks.push({ socketId: socket.id, connectionId: plan.id, accepted: false });
          continue;
        }
        const strictApproachContract = Boolean(
          plan.isDungeonSupplement
          && (
            plan.augmentationOperationType === 'routeNetwork'
            || plan.isRouteNetworkConnection
            || plan.routeNetworkGrantId
          )
        );
        const entranceLanes = strictApproachContract
          ? this._getConnectorEntranceLanes(socket, facing)
          : [{ x: Number(socket.x), z: Number(socket.z), offset: 0 }];
        const requiredApproachDepthTiles = strictApproachContract ? 2 : 1;
        const canTraverseApproachEdge = strictApproachContract
          ? canTraverseStrictConnectorEdge
          : canTraverseConnectorEdge;
        const laneChecks = entranceLanes.map((lane) => {
          const approachPoints = strictApproachContract
            ? [
                ...(lane.offset === 0 ? [{
                  ...lane,
                  approachSide: 'inside',
                  approachDepth: 2,
                  x: lane.x - facing.x * 2,
                  z: lane.z - facing.z * 2,
                }] : []),
                { ...lane, approachSide: 'inside', approachDepth: 1, x: lane.x - facing.x, z: lane.z - facing.z },
                { ...lane, approachSide: 'threshold', approachDepth: 0 },
                { ...lane, approachSide: 'outside', approachDepth: 1, x: lane.x + facing.x, z: lane.z + facing.z },
                { ...lane, approachSide: 'outside', approachDepth: 2, x: lane.x + facing.x * 2, z: lane.z + facing.z * 2 },
              ]
            : [
                { ...lane, approachSide: 'threshold', approachDepth: 0 },
                { ...lane, approachSide: 'outside', approachDepth: 1, x: lane.x + facing.x, z: lane.z + facing.z },
              ];
          const points = approachPoints.map((point) => {
            const floor = findFloor(point.x, point.z, elevation);
            const floorElevation = Number(floor?.elevation ?? elevation);
            const blockingPlatformElevation = Number(
              blockingPlatformTops.get(tileKey(point.x, point.z)),
            );
            const upperFloorElevation = Number.isFinite(blockingPlatformElevation)
              && blockingPlatformElevation > floorElevation + 0.05
              ? blockingPlatformElevation
              : null;
            const room = floor?.roomId ? rooms.find((candidate) => candidate.id === floor.roomId) : null;
            const ceilingCandidates = [
              Number(floor?.connectorCeilingY),
              Number(room?.ceilingY),
              Number(upperFloorElevation),
            ].filter((candidate) => Number.isFinite(candidate) && candidate > floorElevation + 0.05);
            const availableHeadroom = ceilingCandidates.length
              ? Math.min(...ceilingCandidates) - floorElevation
              : Infinity;
            const authoredTransferSurface = Boolean(
              floor?.augmentationTransferId
                || (floor?.augmentationTransferIds?.length ?? 0) > 0
            );
            const isFlat = !strictApproachContract || Boolean(
              floor
              && Math.abs(floorElevation - elevation) <= 0.05
              && (
                authoredTransferSurface
                  || (
                    floor.surface !== 'industrialRamp'
                      && !Number.isFinite(floor.rampStartElevation)
                      && !Number.isFinite(floor.rampEndElevation)
                  )
              )
            );
            const hasHazard = Boolean(
              floor
              && (
                floor.type === 'trap'
                || floor.dungeonSupplementTrapId
                || /(?:trap|hazard)/i.test(String(floor.surface ?? ''))
              )
            );
            return {
              ...point,
              floor,
              floorKey: floor ? this._getFloorTileGraphKey(floor) : null,
              reachable: Boolean(floor && reachable.has(this._getFloorTileGraphKey(floor))),
              availableHeadroom,
              hasHeadroom: !strictApproachContract
                || availableHeadroom + 0.001 >= clearanceHeight,
              isFlat,
              hasHazard,
            };
          });
          const edgeChecks = points.slice(0, -1).map((point, index) => {
            const next = points[index + 1];
            const outwardAction = this._getTraversalActionBetweenFloorTiles(point.floor, next.floor);
            const returnAction = this._getTraversalActionBetweenFloorTiles(next.floor, point.floor);
            const approachBarrierZones = strictApproachContract
              ? strictConnectorBarrierZones
              : traversalSegmentBarrierZones;
            const blockingZoneIds = ['ladder', 'automatic_lift'].includes(outwardAction)
              ? []
              : approachBarrierZones.filter((zone) => (
                  this._doesFloorTraversalSegmentIntersectZone(
                    point.floor,
                    next.floor,
                    zone,
                    PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
                  )
                )).map(({ id }) => String(id ?? '(unnamed-zone)'));
            return {
              fromFloorKey: point.floorKey,
              toFloorKey: next.floorKey,
              outwardAction,
              returnAction,
              blockingZoneIds,
              traversableOutward: Boolean(
                point.floor
                && next.floor
                && outwardAction
                && canTraverseApproachEdge(point.floor, next.floor, outwardAction)
              ),
              traversableReturn: Boolean(
                point.floor
                && next.floor
                && returnAction
                && canTraverseApproachEdge(next.floor, point.floor, returnAction)
              ),
            };
          });
          return {
            offset: lane.offset,
            points: points.map(({ floor, ...point }) => ({
              ...point,
              floorSummary: floor ? {
                roomId: floor.roomId ?? null,
                surface: floor.surface ?? null,
                connectorId: floor.connectorId ?? null,
                augmentationBlueprintId: floor.augmentationBlueprintId ?? null,
                augmentationTransferId: floor.augmentationTransferId ?? null,
                augmentationTransferIds: [...(floor.augmentationTransferIds ?? [])],
                rampStartElevation: Number.isFinite(Number(floor.rampStartElevation))
                  ? Number(floor.rampStartElevation)
                  : null,
                rampEndElevation: Number.isFinite(Number(floor.rampEndElevation))
                  ? Number(floor.rampEndElevation)
                  : null,
              } : null,
            })),
            edgeChecks,
            accepted: points.every((point) => (
              point.floor
              && point.reachable
              && point.hasHeadroom
              && point.isFlat
              && !point.hasHazard
            ))
              && edgeChecks.every((edge) => edge.traversableOutward && edge.traversableReturn),
          };
        });
        const centerLane = laneChecks.find((lane) => lane.offset === 0) ?? laneChecks[0];
        const socketFloor = findFloor(Number(socket.x), Number(socket.z), elevation);
        const outsideFloor = findFloor(
          Number(socket.x) + facing.x,
          Number(socket.z) + facing.z,
          elevation,
        );
        const socketReachable = Boolean(
          socketFloor && reachable.has(this._getFloorTileGraphKey(socketFloor)),
        );
        const outsideReachable = Boolean(
          outsideFloor && reachable.has(this._getFloorTileGraphKey(outsideFloor)),
        );
        const traversableOutward = Boolean(
          socketFloor
          && outsideFloor
          && this._getTraversalActionBetweenFloorTiles(socketFloor, outsideFloor)
          && canTraverseConnectorEdge(socketFloor, outsideFloor),
        );
        const traversableReturn = Boolean(
          socketFloor
          && outsideFloor
          && this._getTraversalActionBetweenFloorTiles(outsideFloor, socketFloor)
          && canTraverseConnectorEdge(outsideFloor, socketFloor),
        );
        const blockingWall = wallBlocks(socket, facing, elevation, clearanceHeight);
        if (!socketFloor) errors.push(`${socket.id} has no walkable floor at its room threshold.`);
        if (!outsideFloor) errors.push(`${socket.id} has no walkable connector approach outside its room.`);
        if (socketFloor && !socketReachable) errors.push(`${socket.id} room threshold is unreachable from the dungeon start.`);
        if (outsideFloor && !outsideReachable) errors.push(`${socket.id} connector approach is unreachable from the dungeon start.`);
        if (socketFloor && outsideFloor && (!traversableOutward || !traversableReturn)) {
          errors.push(`${socket.id} cannot be traversed in both directions across its entrance.`);
        }
        if (blockingWall) {
          errors.push(`${socket.id} is blocked by boundary wall ${blockingWall.facadeId}.`);
        }
        for (const laneCheck of laneChecks.filter((lane) => !lane.accepted)) {
          const missing = laneCheck.points.filter((point) => !point.floorKey)
            .map((point) => `${point.approachSide}:${point.approachDepth}`);
          const unreachable = laneCheck.points.filter((point) => point.floorKey && !point.reachable)
            .map((point) => point.floorKey);
          const lowHeadroom = laneCheck.points.filter((point) => !point.hasHeadroom)
            .map((point) => `${point.floorKey ?? `${point.x},${point.z}`} (${Number(point.availableHeadroom).toFixed(2)}m)`);
          const nonFlat = laneCheck.points.filter((point) => !point.isFlat)
            .map((point) => point.floorKey ?? `${point.x},${point.z}`);
          const hazards = laneCheck.points.filter((point) => point.hasHazard)
            .map((point) => point.floorKey ?? `${point.x},${point.z}`);
          const blockedEdges = laneCheck.edgeChecks.filter((edge) => (
            !edge.traversableOutward || !edge.traversableReturn
          )).map((edge) => (
            `${edge.fromFloorKey ?? 'missing'}->${edge.toFloorKey ?? 'missing'}`
              + `${edge.blockingZoneIds?.length ? `[zones=${edge.blockingZoneIds.join('+')}]` : ''}`
          ));
          errors.push(
            `${socket.id} lane ${laneCheck.offset} lacks its clear two-tile bidirectional approach `
            + `(missing=${missing.join(',') || 'none'}; unreachable=${unreachable.join(',') || 'none'}; `
            + `headroom=${lowHeadroom.join(',') || 'ok'}; nonFlat=${nonFlat.join(',') || 'none'}; `
            + `hazards=${hazards.join(',') || 'none'}; blockedEdges=${blockedEdges.join(',') || 'none'}).`,
          );
        }
        checks.push({
          socketId: socket.id,
          connectionId: plan.id,
          roomId: socket.roomId ?? null,
          elevation,
          facing,
          socketFloorKey: socketFloor ? this._getFloorTileGraphKey(socketFloor) : null,
          outsideFloorKey: outsideFloor ? this._getFloorTileGraphKey(outsideFloor) : null,
          socketReachable,
          outsideReachable,
          traversableOutward,
          traversableReturn,
          blockingWallFacadeId: blockingWall?.facadeId ?? null,
          strictApproachContract,
          requiredLaneCount: laneChecks.length,
          requiredApproachDepthTiles,
          acceptedLaneCount: laneChecks.filter((lane) => lane.accepted).length,
          laneChecks,
          centerLaneAccepted: centerLane?.accepted ?? false,
          accepted: Boolean(
            socketFloor
            && outsideFloor
            && socketReachable
            && outsideReachable
            && traversableOutward
            && traversableReturn
            && !blockingWall
            && (!strictApproachContract
              || laneChecks.length >= CONNECTOR_GALLERY_MIN_WIDTH_TILES)
            && laneChecks.every((lane) => lane.accepted)
          ),
        });
      }
    }

    return {
      accepted: errors.length === 0,
      errors,
      warnings: errors.length ? [] : [
        `Validated ${checks.length} connector entrances against floors, reachability, and boundary walls.`,
      ],
      details: {
        checkedSocketCount: checks.length,
        acceptedSocketCount: checks.filter((check) => check.accepted).length,
        skippedGraphConnectionCount: skippedGraphConnectionIds.length,
        skippedGraphConnectionIds,
        reachableNodeCount: reachable.size,
        checks,
      },
    };
  }

  _getConnectorEntranceLanes(socket = {}, facing = {}) {
    const laneCount = Math.max(
      CONNECTOR_GALLERY_MIN_WIDTH_TILES,
      Math.round(Number(socket.landingWidth ?? 0) / this.tileSize) || 1,
    );
    let lateralX = -Math.sign(Number(facing.z ?? 0));
    let lateralZ = Math.sign(Number(facing.x ?? 0));
    // Give even lane counts one deterministic world-space bias. Canonicalizing
    // the lateral vector keeps opposite-facing sockets on the same lane set.
    if (lateralX < 0 || (lateralX === 0 && lateralZ < 0)) {
      lateralX *= -1;
      lateralZ *= -1;
    }
    const firstOffset = -Math.floor(laneCount / 2);
    return Array.from({ length: laneCount }, (_, index) => {
      const offset = firstOffset + index;
      return {
        x: Number(socket.x) + lateralX * offset,
        z: Number(socket.z) + lateralZ * offset,
        offset,
      };
    });
  }

  _createConnectorWallOpeningMap(connectionPlans = []) {
    const openings = new Map();
    const addOpening = (key, opening) => {
      const entries = openings.get(key) ?? [];
      entries.push(opening);
      openings.set(key, entries);
    };
    const resolveFacing = (plan, socket, role) => {
      let facingX = Math.sign(Number(socket?.facingX ?? 0));
      let facingZ = Math.sign(Number(socket?.facingZ ?? 0));
      if (Math.abs(facingX) + Math.abs(facingZ) === 1) return { x: facingX, z: facingZ };
      const path = plan.bridgePath ?? plan.fullPath ?? [];
      const socketIndex = path.findIndex((point) => (
        point.x === socket?.x && point.z === socket?.z
      ));
      const outside = role === 'from'
        ? path[Math.min(path.length - 1, Math.max(0, socketIndex) + 1)]
        : path[Math.max(0, (socketIndex < 0 ? path.length - 1 : socketIndex) - 1)];
      facingX = Math.sign(Number(outside?.x) - Number(socket?.x));
      facingZ = Math.sign(Number(outside?.z) - Number(socket?.z));
      return Math.abs(facingX) + Math.abs(facingZ) === 1
        ? { x: facingX, z: facingZ }
        : null;
    };

    for (const plan of connectionPlans.filter((candidate) => (
      candidate?.isSupplementGraphConnection !== true
      && candidate?.connectorVariantConstraints?.graphOnly !== true
    ))) {
      for (const [role, socket] of [['from', plan.fromSocket], ['to', plan.toSocket]]) {
        if (!socket || !Number.isFinite(Number(socket.x)) || !Number.isFinite(Number(socket.z))) {
          continue;
        }
        const facing = resolveFacing(plan, socket, role);
        if (!facing) continue;
        const horizontal = facing.z !== 0;
        const line = horizontal
          ? Number(socket.z) + facing.z * 0.5
          : Number(socket.x) + facing.x * 0.5;
        const floorY = Number(socket.elevation ?? plan.elevation ?? 0);
        // Wall subtraction must include the same vertical movement envelope
        // used by connector traversal. Otherwise a retained sill ending
        // exactly at an elevated socket's floor can still collide with a
        // grounded step across the mouth.
        const bottomY = floorY
          - PLAYER_TRAVERSAL_ENVELOPE.groundedStepDownHeight
          - CONNECTOR_APERTURE_VERTICAL_MARGIN;
        const topY = floorY + Math.max(
          PLAYER_TRAVERSAL_ENVELOPE.headClearance,
          Number(socket.clearanceHeight ?? 0),
        ) + CONNECTOR_APERTURE_VERTICAL_MARGIN;
        for (const lane of this._getConnectorEntranceLanes(socket, facing)) {
          const axis = horizontal ? lane.x : lane.z;
          const key = `${horizontal ? 'h' : 'v'}:${line.toFixed(3)}:${axis}`;
          addOpening(key, {
            connectionId: plan.id,
            logicalConnectionId: plan.logicalConnectionId ?? plan.id,
            socketId: socket.id,
            horizontal,
            line,
            axis,
            bottomY,
            topY,
          });
        }
      }
    }
    return openings;
  }

  _addWalls(
    group,
    tiles,
    materials,
    openAirTileKeys = new Set(),
    rooms = [],
    connectorWallOpenings = new Map(),
    authoritativeRuns = null,
  ) {
    const runs = Array.isArray(authoritativeRuns)
      ? authoritativeRuns
      : this._collectBoundaryWallRuns(
        tiles,
        openAirTileKeys,
        rooms,
        connectorWallOpenings,
      );

    for (const run of runs) {
      this._addBoundaryWallRun(group, run, materials);
    }

    // Keep flight collision data separate from grounded solid zones. Aerial
    // navigation ignores floor gaps, ledges, and railings, but still needs the
    // exact boundary-wall silhouette so a direct pursuit cannot pass through
    // the dungeon shell.
    return runs.map((run) => {
      const lengthWorld = run.lengthTiles * this.tileSize;
      return {
        id: `aerialBoundary_${run.facadeId}`,
        label: 'Dungeon boundary wall',
        obstacleKind: 'boundaryWall',
        position: new THREE.Vector3(
          run.horizontal ? ((run.start + run.end) * 0.5) * this.tileSize : run.line * this.tileSize,
          run.wallBottomY + run.wallHeight * 0.5,
          run.horizontal ? run.line * this.tileSize : ((run.start + run.end) * 0.5) * this.tileSize,
        ),
        halfWidth: run.horizontal ? lengthWorld * 0.5 : RUIN_WALL_THICKNESS * 0.5,
        halfDepth: run.horizontal ? RUIN_WALL_THICKNESS * 0.5 : lengthWorld * 0.5,
        verticalHalfHeight: run.wallHeight * 0.5,
        allowFlyOver: false,
        wallFacadeId: run.facadeId,
      };
    });
  }

  _collectBoundaryWallRuns(
    tiles,
    openAirTileKeys,
    rooms = [],
    connectorWallOpenings = new Map(),
    authoritativeFloorLayers = null,
  ) {
    const buckets = new Map();
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const usesAuthoritativeFloorLayers = authoritativeFloorLayers != null;
    const getVerticalEnvelope = (tile) => {
      const room = roomById.get(tile.roomId);
      const wallBottomY = Number(
        usesAuthoritativeFloorLayers
          && (tile?.dungeonSupplement === true || tile?.augmentationOwnerId)
          ? tile.elevation
          : room?.baseElevation
        ?? tile.connectorMinY
        ?? tile.elevation
        ?? 0,
      );
      const roomBaseElevation = Number(
        room?.baseElevation
        ?? room?.plannedBaseElevation
        ?? tile.connectorMinY
        ?? wallBottomY,
      );
      const roomCeilingY = room?.ceilingY != null
        && Number.isFinite(Number(room.ceilingY))
        ? Number(room.ceilingY)
        : usesAuthoritativeFloorLayers
          && room?.ceilingHeight != null
          && Number.isFinite(Number(room.ceilingHeight))
          ? roomBaseElevation + Number(room.ceilingHeight)
          : null;
      const wallTopY = Number(
        roomCeilingY
        ?? tile.connectorCeilingY
        ?? (wallBottomY + RUIN_WALL_HEIGHT),
      );
      return {
        wallBottomY,
        wallTopY: Math.max(wallBottomY + PLAYER_TRAVERSAL_ENVELOPE.headClearance, wallTopY),
      };
    };
    const shellTiles = [...(authoritativeFloorLayers ?? tiles.values())];
    const shellTilesByColumn = new Map();
    for (const tile of shellTiles) {
      const key = tileKey(tile.x, tile.z);
      const column = shellTilesByColumn.get(key) ?? [];
      column.push(tile);
      shellTilesByColumn.set(key, column);
    }
    const transferIdsForFloor = (tile) => new Set([
      ...(tile?.augmentationTransferIds ?? []),
      ...(tile?.augmentationTransferId ? [tile.augmentationTransferId] : []),
    ].map(String));
    const floorsShareAuthoredTransfer = (first, second) => {
      const firstIds = transferIdsForFloor(first);
      return firstIds.size > 0 && [...transferIdsForFloor(second)].some((id) => (
        firstIds.has(id)
      ));
    };
    const subtractInterval = (intervals, subtractBottom, subtractTop) => intervals.flatMap(([
      intervalBottom,
      intervalTop,
    ]) => {
      if (subtractTop <= intervalBottom + 0.001
        || subtractBottom >= intervalTop - 0.001) {
        return [[intervalBottom, intervalTop]];
      }
      const remaining = [];
      if (subtractBottom > intervalBottom + 0.001) {
        remaining.push([intervalBottom, Math.min(subtractBottom, intervalTop)]);
      }
      if (subtractTop < intervalTop - 0.001) {
        remaining.push([Math.max(subtractTop, intervalBottom), intervalTop]);
      }
      return remaining;
    });

    for (const tile of shellTiles) {
      if (openAirTileKeys.has(tileKey(tile.x, tile.z))) {
        continue;
      }

      for (const [dx, dz] of DIRECTIONS) {
        const horizontal = dz !== 0;
        const line = horizontal ? tile.z + dz * 0.5 : tile.x + dx * 0.5;
        const axis = horizontal ? tile.x : tile.z;
        const ownerId = tile.roomId
          ?? tile.augmentationOwnerId
          ?? tile.connectorId
          ?? tile.type
          ?? 'spatial';
        const { wallBottomY, wallTopY } = getVerticalEnvelope(tile);
        const neighborKey = tileKey(tile.x + dx, tile.z + dz);
        const neighbors = openAirTileKeys.has(neighborKey)
          ? []
          : (shellTilesByColumn.get(neighborKey) ?? []);
        // An authored transfer owns the vertical connection across this edge;
        // emitting a retaining wall between its consecutive cells would turn
        // the exact ramp/stair witness into a collision barrier.
        const connectedByAuthoredTransfer = neighbors.some((neighbor) => (
          floorsShareAuthoredTransfer(tile, neighbor)
        ));
        let exposedIntervals = connectedByAuthoredTransfer
          ? []
          : [[wallBottomY, wallTopY]];
        if (!connectedByAuthoredTransfer) {
          for (const neighbor of neighbors) {
            const neighborEnvelope = getVerticalEnvelope(neighbor);
            exposedIntervals = subtractInterval(
              exposedIntervals,
              neighborEnvelope.wallBottomY,
              neighborEnvelope.wallTopY,
            );
          }
        }

        const edgeKey = `${horizontal ? 'h' : 'v'}:${line.toFixed(3)}:${axis}`;
        let carvedIntervals = exposedIntervals;
        for (const opening of connectorWallOpenings.get?.(edgeKey) ?? []) {
          carvedIntervals = carvedIntervals.flatMap(([intervalBottomY, intervalTopY]) => {
            if (opening.topY <= intervalBottomY + 0.001
              || opening.bottomY >= intervalTopY - 0.001) {
              return [[intervalBottomY, intervalTopY]];
            }
            const remaining = [];
            if (opening.bottomY > intervalBottomY + 0.001) {
              remaining.push([intervalBottomY, Math.min(opening.bottomY, intervalTopY)]);
            }
            if (opening.topY < intervalTopY - 0.001) {
              remaining.push([Math.max(opening.topY, intervalBottomY), intervalTopY]);
            }
            return remaining;
          });
        }

        for (const [exposedBottomY, exposedTopY] of carvedIntervals) {
          if (exposedTopY - exposedBottomY <= 0.001) continue;
          // Ownership changes do not create a physical corner. Build each
          // exposed facade interval from the continuous silhouette, then
          // retain ownership for culling and objective-biased accents.
          const key = `${horizontal ? 'h' : 'v'}:${dx}:${dz}:${line}:${exposedBottomY.toFixed(3)}:${exposedTopY.toFixed(3)}`;
          let bucket = buckets.get(key);

          if (!bucket) {
            bucket = {
              horizontal,
              dx,
              dz,
              line,
              wallBottomY: exposedBottomY,
              wallTopY: exposedTopY,
              axes: new Set(),
              ownerByAxis: new Map(),
            };
            buckets.set(key, bucket);
          }

          bucket.axes.add(axis);
          bucket.ownerByAxis.set(axis, ownerId);
        }
      }
    }

    const runs = [];
    for (const bucket of buckets.values()) {
      const axes = [...bucket.axes].sort((a, b) => a - b);

      if (!axes.length) {
        continue;
      }

      let start = axes[0];
      let previous = axes[0];
      const pushRun = () => {
        const ownerByAxis = {};
        const ownerIds = [];
        for (let axis = start; axis <= previous; axis += 1) {
          const ownerId = bucket.ownerByAxis.get(axis) ?? 'spatial';
          ownerByAxis[axis] = ownerId;
          if (!ownerIds.includes(ownerId)) {
            ownerIds.push(ownerId);
          }
        }
        runs.push({
          horizontal: bucket.horizontal,
          dx: bucket.dx,
          dz: bucket.dz,
          line: bucket.line,
          start,
          end: previous,
          lengthTiles: previous - start + 1,
          ownerId: ownerIds.length === 1 ? ownerIds[0] : null,
          ownerIds,
          ownerByAxis,
          facadeId: `${bucket.horizontal ? 'h' : 'v'}:${bucket.dx}:${bucket.dz}:${bucket.line}:${start}:${previous}:${bucket.wallBottomY.toFixed(2)}:${bucket.wallTopY.toFixed(2)}`,
          wallBottomY: bucket.wallBottomY,
          wallTopY: bucket.wallTopY,
          wallHeight: bucket.wallTopY - bucket.wallBottomY,
        });
      };

      for (let i = 1; i < axes.length; i += 1) {
        const axis = axes[i];
        if (axis === previous + 1) {
          previous = axis;
          continue;
        }

        pushRun();
        start = axis;
        previous = axis;
      }

      pushRun();
    }

    return runs;
  }

  _addBoundaryWallRun(group, run, materials) {
    const lengthWorld = run.lengthTiles * this.tileSize;
    const visualOwner = new THREE.Group();
    visualOwner.name = 'dungeonBoundaryWallVisual';
    visualOwner.position.set(
      run.horizontal ? ((run.start + run.end) * 0.5) * this.tileSize : run.line * this.tileSize,
      run.wallBottomY + run.wallHeight * 0.5,
      run.horizontal ? run.line * this.tileSize : ((run.start + run.end) * 0.5) * this.tileSize,
    );
    visualOwner.userData.cameraOcclusionOwner = true;
    visualOwner.userData.roomId = run.ownerId ?? null;
    visualOwner.userData.wallOwnerIds = [...(run.ownerIds ?? [])];
    visualOwner.userData.wallFacadeId = run.facadeId;
    const geometry = new THREE.BoxGeometry(
      run.horizontal ? lengthWorld : RUIN_WALL_THICKNESS,
      run.wallHeight,
      run.horizontal ? RUIN_WALL_THICKNESS : lengthWorld,
    );
    const wall = new THREE.Mesh(geometry, materials.wall);

    wall.name = 'dungeonBoundaryWall';
    wall.userData.wallRun = {
      horizontal: run.horizontal,
      dx: run.dx,
      dz: run.dz,
      line: run.line,
      start: run.start,
      end: run.end,
      lengthTiles: run.lengthTiles,
      ownerId: run.ownerId ?? null,
      ownerIds: [...(run.ownerIds ?? [])],
      ownerByAxis: { ...(run.ownerByAxis ?? {}) },
      facadeId: run.facadeId,
      wallBottomY: run.wallBottomY,
      wallTopY: run.wallTopY,
    };
    wall.userData.roomId = run.ownerId ?? null;
    wall.castShadow = true;
    wall.receiveShadow = true;

    visualOwner.add(wall);
    const batchState = {
      macroBatches: new Map(),
      accentBatches: new Map(),
      geometryCache: new Map(),
      chunkWorldSize: this.tileSize * 8,
    };
    this._addMacroWallFace(visualOwner, run, lengthWorld, materials, batchState);
    this._flushMacroWallInstanceBatches(visualOwner, run, batchState);
    group.add(visualOwner);
  }

  _addMacroWallFace(wall, run, lengthWorld, materials, batchState) {
    const faceOffset = RUIN_WALL_THICKNESS * 0.5 + RUIN_WALL_FACE_OFFSET;
    const addFace = (normalX, normalZ) => {
      const isInteriorFace = normalX === -run.dx && normalZ === -run.dz;
      this._addMacroWallTileGrid(
        wall,
        run,
        lengthWorld,
        materials,
        normalX,
        normalZ,
        faceOffset,
        isInteriorFace,
        batchState,
      );
    };

    if (run.horizontal) {
      addFace(0, -run.dz);
      addFace(0, run.dz);
    } else {
      addFace(-run.dx, 0);
      addFace(run.dx, 0);
    }
  }

  _addMacroWallTileGrid(
    wall,
    run,
    lengthWorld,
    materials,
    normalX,
    normalZ,
    faceOffset,
    isInteriorFace = false,
    batchState,
  ) {
    const nominalTileHeight = RUIN_WALL_HEIGHT / RUIN_WALL_TILE_ROWS;
    const rows = Math.max(1, Math.ceil(run.wallHeight / nominalTileHeight));
    const tileHeight = run.wallHeight / rows;
    const columns = Math.max(1, Math.ceil(lengthWorld / tileHeight));
    const edgeWidth = columns <= 2
      ? lengthWorld / columns
      : (lengthWorld - tileHeight * (columns - 2)) * 0.5;
    const columnWidths = Array.from({ length: columns }, (_, column) => (
      columns === 1
        ? lengthWorld
        : (column === 0 || column === columns - 1 ? edgeWidth : tileHeight)
    ));
    let alongCursor = -lengthWorld * 0.5;

    for (let row = 0; row < rows; row += 1) {
      alongCursor = -lengthWorld * 0.5;
      for (let column = 0; column < columns; column += 1) {
        const tileWidth = columnWidths[column];
        const tileName = this._getWallMacroTileName(column, row, columns, rows);
        const widthRatio = Math.min(1, tileWidth / tileHeight);
        const cropSide = column === columns - 1 ? 'right' : 'left';
        const geometryKey = `${tileWidth.toFixed(3)}:${cropSide}`;
        let geometry = batchState.geometryCache.get(geometryKey);
        if (!geometry) {
          geometry = new THREE.PlaneGeometry(
            tileWidth + RUIN_WALL_TILE_OVERLAP,
            tileHeight + RUIN_WALL_TILE_OVERLAP,
          );
          const uv = geometry.getAttribute('uv');
          if (widthRatio < 0.999) {
            const minU = cropSide === 'right' ? 1 - widthRatio : 0;
            for (let index = 0; index < uv.count; index += 1) {
              uv.setX(index, minU + uv.getX(index) * widthRatio);
            }
            uv.needsUpdate = true;
          }
          geometry.userData.wallMacroCell = true;
          geometry.userData.nominalCellSize = tileHeight;
          geometry.userData.uvWidthRatio = widthRatio;
          batchState.geometryCache.set(geometryKey, geometry);
        }
        const along = alongCursor + tileWidth * 0.5;
        alongCursor += tileWidth;
        const localY = run.wallHeight * 0.5 - tileHeight * (row + 0.5);
        let localX;
        let localZ;
        let rotationY;
        if (run.horizontal) {
          localX = along;
          localZ = normalZ * faceOffset;
          rotationY = normalZ >= 0 ? 0 : Math.PI;
        } else {
          localX = normalX * faceOffset;
          localZ = along;
          rotationY = normalX >= 0 ? Math.PI / 2 : -Math.PI / 2;
        }
        const worldX = wall.position.x + localX;
        const worldZ = wall.position.z + localZ;
        const chunkX = Math.floor(worldX / batchState.chunkWorldSize);
        const chunkZ = Math.floor(worldZ / batchState.chunkWorldSize);
        const worldAlong = run.horizontal ? worldX : worldZ;
        const ownerAxis = Math.max(
          run.start,
          Math.min(run.end, Math.round(worldAlong / this.tileSize)),
        );
        const ownerId = run.ownerByAxis?.[ownerAxis] ?? run.ownerId ?? 'spatial';
        const material = this._pickWallMacroTileMaterial(
          materials,
          tileName,
          ownerId,
          `${run.facadeId}:${normalX}:${normalZ}:${row}:${column}`,
        );
        const macroBatchKey = [
          chunkX,
          chunkZ,
          geometryKey,
          material.uuid,
        ].join(':');
        let macroBatch = batchState.macroBatches.get(macroBatchKey);
        if (!macroBatch) {
          macroBatch = {
            geometry,
            material,
            chunkX,
            chunkZ,
            entries: [],
            records: [],
          };
          batchState.macroBatches.set(macroBatchKey, macroBatch);
        }
        const matrix = new THREE.Matrix4().makeRotationY(rotationY);
        matrix.setPosition(localX, localY, localZ);
        macroBatch.entries.push(matrix);
        macroBatch.records.push({
          grammar: tileName,
          ownerId,
          row,
          column,
          columnCount: columns,
          width: tileWidth,
          height: tileHeight,
          uvWidthRatio: widthRatio,
          cropSide,
          normalX,
          normalZ,
          interiorFace: isInteriorFace,
          chunkX,
          chunkZ,
        });

        if (isInteriorFace && tileName === 'mm') {
          const accentHash = stableRenderHash([
            ownerId,
            run.horizontal ? 'h' : 'v',
            run.line,
            run.start,
            column,
            row,
            'wall-accent',
          ].join(':'));
          const objectiveWall = /keycard|trap|server|shrine|boss|coolant|machine/i.test(ownerId);
          const density = objectiveWall ? 0.16 : 0.075;
          if ((accentHash % 1000) < density * 1000) {
            const accentKey = WALL_MACRO_ACCENT_KEYS[
              Math.floor(accentHash / 1000) % WALL_MACRO_ACCENT_KEYS.length
            ];
            const accentSize = tileHeight * (0.64 + ((accentHash >>> 8) % 10) * 0.01);
            const accentMaterial = materials.wallMacroAccents?.[accentKey]
              ?? materials.wallMacroTiles.mm;
            const accentBatchKey = `${chunkX}:${chunkZ}:${accentMaterial.uuid}`;
            let accentBatch = batchState.accentBatches.get(accentBatchKey);
            if (!accentBatch) {
              accentBatch = {
                material: accentMaterial,
                chunkX,
                chunkZ,
                entries: [],
                records: [],
              };
              batchState.accentBatches.set(accentBatchKey, accentBatch);
            }
            const accentMatrix = new THREE.Matrix4().makeRotationY(rotationY);
            accentMatrix.scale(new THREE.Vector3(accentSize, accentSize, 1));
            accentMatrix.setPosition(
              localX + normalX * 0.012,
              localY,
              localZ + normalZ * 0.012,
            );
            accentBatch.entries.push(accentMatrix);
            accentBatch.records.push({
              type: accentKey,
              ownerId,
              row,
              column,
              size: accentSize,
              grammar: tileName,
              integrated: true,
              chunkX,
              chunkZ,
            });
          }
        }
      }
    }
  }

  _flushMacroWallInstanceBatches(wall, run, batchState) {
    const addInstances = ({
      geometry,
      material,
      entries,
      records,
      chunkX,
      chunkZ,
      accent = false,
    }) => {
      const instances = new THREE.InstancedMesh(geometry, material, entries.length);
      instances.name = accent
        ? 'dungeonBoundaryWallAccentBatch'
        : 'dungeonBoundaryWallMacroBatch';
      entries.forEach((matrix, index) => instances.setMatrixAt(index, matrix));
      instances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      instances.instanceMatrix.needsUpdate = true;
      instances.receiveShadow = !accent;
      instances.userData.roomId = run.ownerId ?? null;
      instances.userData.wallOwnerIds = [...new Set(records.map((record) => record.ownerId))];
      instances.userData.wallFacadeId = run.facadeId;
      instances.userData.wallChunkX = chunkX;
      instances.userData.wallChunkZ = chunkZ;
      if (accent) {
        instances.userData.wallAccentBatch = true;
        instances.userData.wallAccentCount = records.length;
        instances.userData.wallAccentRecords = records.map((record, instanceIndex) => ({
          ...record,
          instanceIndex,
        }));
      } else {
        instances.userData.wallMacroBatch = true;
        instances.userData.wallMacroCellCount = records.length;
        instances.userData.wallMacroCells = records.map((record, instanceIndex) => ({
          ...record,
          instanceIndex,
        }));
      }
      instances.computeBoundingBox();
      instances.computeBoundingSphere();
      wall.add(instances);
    };

    for (const batch of batchState.macroBatches.values()) {
      addInstances(batch);
    }
    if (batchState.accentBatches.size > 0) {
      const accentGeometry = new THREE.PlaneGeometry(1, 1);
      accentGeometry.userData.wallAccentUnitPlane = true;
      for (const batch of batchState.accentBatches.values()) {
        addInstances({ ...batch, geometry: accentGeometry, accent: true });
      }
    }
  }

  _pickWallMacroTileMaterial(materials, tileName, ownerId = null, sampleKey = '') {
    const tiles = materials.wallMacroTiles;

    if (tileName === 'mm' && tiles?.mmAlt) {
      const supplementalOwner = String(ownerId ?? '').startsWith('supplement:');
      const useAlternate = supplementalOwner
        ? (stableRenderHash(`${ownerId}:${sampleKey}:mm-alt`) % 1000) < 720
        : this.random() < 0.72;
      if (useAlternate) return tiles.mmAlt;
    }

    return tiles?.[tileName] ?? tiles?.mm ?? materials.wall;
  }

  _getWallMacroTileName(column, row, columns, rows) {
    const top = row === 0;
    const bottom = row === rows - 1;
    const left = column === 0;
    const right = column === columns - 1;

    if (columns === 1) {
      if (top) {
        return 'tm';
      }
      if (bottom) {
        return 'bm';
      }
      return 'mm';
    }

    if (top && left) {
      return 'tl';
    }
    if (top && right) {
      return 'tr';
    }
    if (bottom && left) {
      return 'bl';
    }
    if (bottom && right) {
      return 'br';
    }
    if (top) {
      return 'tm';
    }
    if (bottom) {
      return 'bm';
    }
    if (left) {
      return 'ml';
    }
    if (right) {
      return 'mr';
    }

    return 'mm';
  }

  _addInvisibleOpenAirBounds(group, tiles, materials, openAirTileKeys = new Set()) {
    if (!openAirTileKeys.size) {
      return;
    }

    const horizontalWallGeometry = new THREE.BoxGeometry(
      this.tileSize,
      RUIN_WALL_HEIGHT,
      RUIN_WALL_THICKNESS,
    );
    const verticalWallGeometry = new THREE.BoxGeometry(
      RUIN_WALL_THICKNESS,
      RUIN_WALL_HEIGHT,
      this.tileSize,
    );

    for (const key of openAirTileKeys) {
      const tile = tiles.get(key);
      if (!tile) {
        continue;
      }

      for (const [dx, dz] of DIRECTIONS) {
        if (tiles.has(tileKey(tile.x + dx, tile.z + dz))) {
          continue;
        }

        const horizontal = dz !== 0;
        const boundary = new THREE.Mesh(
          horizontal ? horizontalWallGeometry : verticalWallGeometry,
          materials.invisibleBoundary,
        );
        boundary.name = 'expeditionCampInvisibleBoundary';
        boundary.position.set(
          tile.x * this.tileSize + dx * this.tileSize * 0.5,
          RUIN_WALL_HEIGHT * 0.5,
          tile.z * this.tileSize + dz * this.tileSize * 0.5,
        );
        boundary.userData.invisibleWalkBoundary = true;
        boundary.castShadow = false;
        boundary.receiveShadow = false;
        group.add(boundary);
      }
    }
  }

  _addConnectorTrackTrapInfrastructure(group, descriptors = [], materials) {
    const fixtures = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (const descriptor of descriptors) {
      const start = new THREE.Vector3(
        descriptor.trackStart.x,
        descriptor.trackStart.y,
        descriptor.trackStart.z,
      );
      const end = new THREE.Vector3(
        descriptor.trackEnd.x,
        descriptor.trackEnd.y,
        descriptor.trackEnd.z,
      );
      const trackDelta = end.clone().sub(start);
      const trackLength = trackDelta.length();
      if (trackLength <= 0.01) continue;
      const trackDirection = trackDelta.clone().normalize();
      const connectorDirection = new THREE.Vector3(
        -trackDirection.z,
        0,
        trackDirection.x,
      ).normalize();
      const root = new THREE.Group();
      root.name = `connectorTrackTrapInfrastructure_${descriptor.id}`;
      root.userData.connectorId = descriptor.connectionId;
      root.userData.rotatingTrackTrapId = descriptor.id;
      root.userData.cameraOcclusionOwner = true;

      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(trackLength + 0.34, 0.18, 0.28),
        materials.supportMetal,
      );
      rail.name = 'rotatingTrackTrapCeilingRail';
      rail.position.copy(start).lerp(end, 0.5).addScaledVector(up, -0.11);
      rail.rotation.y = -Math.atan2(trackDirection.z, trackDirection.x);
      rail.castShadow = true;
      rail.receiveShadow = true;
      rail.userData.cameraOcclusionSurface = true;
      root.add(rail);

      const stopGeometry = new THREE.BoxGeometry(0.58, 0.62, 0.58);
      for (const [index, endpoint] of [start, end].entries()) {
        const stop = new THREE.Mesh(stopGeometry, materials.hazardStripe);
        stop.name = `rotatingTrackTrapPhysicalEndStop_${index}`;
        stop.position.copy(endpoint).addScaledVector(up, -0.24);
        stop.castShadow = true;
        stop.receiveShadow = true;
        stop.userData.cameraOcclusionSurface = true;
        root.add(stop);

        const support = new THREE.Mesh(
          new THREE.BoxGeometry(0.72, 0.42, 0.72),
          materials.wallTrim,
        );
        support.name = `rotatingTrackTrapCeilingSupport_${index}`;
        support.position.copy(endpoint).addScaledVector(up, 0.1);
        support.castShadow = true;
        support.receiveShadow = true;
        support.userData.cameraOcclusionSurface = true;
        root.add(support);
      }

      const warning = descriptor.warningVolume;
      const warningCenter = new THREE.Vector3(
        warning.center.x,
        descriptor.floorElevation + 0.024,
        warning.center.z,
      );
      const alongHalfLength = Math.max(
        0.7,
        Math.abs(connectorDirection.x) * warning.halfSize.x
          + Math.abs(connectorDirection.z) * warning.halfSize.z,
      );
      const bandLength = Math.max(
        trackLength + 0.6,
        Math.abs(trackDirection.x) * warning.halfSize.x * 2
          + Math.abs(trackDirection.z) * warning.halfSize.z * 2,
      );
      const bandGeometry = new THREE.BoxGeometry(bandLength, 0.035, 0.22);
      for (const offset of [-0.72, 0, 0.72]) {
        const band = new THREE.Mesh(bandGeometry, materials.hazardStripe);
        band.name = 'rotatingTrackTrapFloorWarningBand';
        band.position.copy(warningCenter)
          .addScaledVector(connectorDirection, alongHalfLength * offset);
        band.rotation.y = -Math.atan2(trackDirection.z, trackDirection.x);
        band.receiveShadow = true;
        root.add(band);
      }

      group.add(root);
      fixtures.push({
        id: `${descriptor.id}:infrastructure`,
        trapId: descriptor.id,
        connectionId: descriptor.connectionId,
        object: root,
        railObject: rail,
        floorWarningBandCount: 3,
        trackLength,
      });
    }
    return fixtures;
  }

  _addConnectorTraversalPrefabs(group, connectionPlans = [], materials, solidZones = []) {
    const ladders = [];
    const lifts = [];
    const platforms = [];
    const up = new THREE.Vector3(0, 1, 0);

    const addLadder = (descriptor) => {
      const ladderRoot = new THREE.Group();
      ladderRoot.name = `dungeonConnectorLadder_${descriptor.id}`;
      ladderRoot.userData.cameraOcclusionOwner = true;
      ladderRoot.userData.connectorId = descriptor.connectionId;
      ladderRoot.userData.ladderId = descriptor.id;
      const height = descriptor.topY - descriptor.bottomY;
      const tangent = new THREE.Vector3(
        -descriptor.planeNormal.z,
        0,
        descriptor.planeNormal.x,
      ).normalize();
      const railGeometry = new THREE.CylinderGeometry(0.075, 0.075, height + 0.35, 10);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(railGeometry, materials.supportMetal);
        rail.name = 'dungeonConnectorLadderRail';
        rail.position.copy(descriptor.planeCenter)
          .addScaledVector(tangent, side * descriptor.width * 0.5)
          .setY(descriptor.bottomY + height * 0.5);
        rail.castShadow = true;
        rail.receiveShadow = true;
        rail.userData.cameraOcclusionSurface = true;
        ladderRoot.add(rail);
      }

      const rungCount = Math.max(4, Math.floor(height / 0.36));
      const rungGeometry = new THREE.CylinderGeometry(0.055, 0.055, descriptor.width, 8);
      const rungQuaternion = new THREE.Quaternion().setFromUnitVectors(up, tangent);
      for (let index = 0; index <= rungCount; index += 1) {
        const rung = new THREE.Mesh(rungGeometry, materials.factoryRail);
        rung.name = 'dungeonConnectorLadderRung';
        rung.position.copy(descriptor.planeCenter).setY(
          THREE.MathUtils.lerp(descriptor.bottomY + 0.18, descriptor.topY - 0.18, index / rungCount),
        );
        rung.quaternion.copy(rungQuaternion);
        rung.castShadow = true;
        rung.receiveShadow = true;
        rung.userData.cameraOcclusionSurface = true;
        ladderRoot.add(rung);
      }

      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.18, 0.08),
        materials.glowBlue,
      );
      marker.name = 'dungeonConnectorLadderDirectionLight';
      marker.position.copy(descriptor.planeCenter)
        .addScaledVector(descriptor.planeNormal, 0.05)
        .setY(descriptor.topY + 0.24);
      ladderRoot.add(marker);
      ladderRoot.userData.ladderPlane = {
        center: { x: descriptor.planeCenter.x, z: descriptor.planeCenter.z },
        normal: { x: descriptor.planeNormal.x, z: descriptor.planeNormal.z },
        bodyClearance: descriptor.bodyClearance,
      };
      ladderRoot.visible = descriptor.disabled !== true;
      group.add(ladderRoot);
      descriptor.object = ladderRoot;
      ladders.push(descriptor);
    };

    const addLift = (spec) => {
      const liftRoot = new THREE.Group();
      liftRoot.name = `dungeonConnectorLift_${spec.id}`;
      liftRoot.userData.cameraOcclusionOwner = true;
      liftRoot.userData.connectorId = spec.connectionId;
      const width = spec.platformWidthMeters;
      const depth = spec.platformDepthMeters;
      const height = spec.topElevation - spec.bottomElevation;
      const platform = new THREE.Mesh(
        this._createTiledBoxGeometry(width, 0.28, depth),
        [
          materials.supportMetal,
          materials.supportMetal,
          materials.raisedDeckFloor,
          materials.supportMetal,
          materials.supportMetal,
          materials.supportMetal,
        ],
      );
      platform.name = 'automaticConnectorLiftPlatform';
      const initialElevation = Number.isFinite(spec.initialElevation)
        ? spec.initialElevation
        : spec.bottomElevation;
      platform.position.copy(spec.center).setY(initialElevation - 0.14);
      platform.castShadow = true;
      platform.receiveShadow = true;
      platform.userData.cameraOcclusionSurface = true;
      liftRoot.add(platform);

      const landingSillSurfaces = [];
      for (const sill of spec.landingSills ?? []) {
        const sillThickness = Number(sill.thicknessMeters ?? 0.28);
        const deck = new THREE.Mesh(
          this._createTiledBoxGeometry(
            sill.halfWidth * 2,
            sillThickness,
            sill.halfDepth * 2,
          ),
          [
            materials.supportMetal,
            materials.supportMetal,
            materials.raisedDeckFloor,
            materials.supportMetal,
            materials.supportMetal,
            materials.supportMetal,
          ],
        );
        deck.name = `automaticConnectorLiftLandingSill_${sill.endpoint}`;
        deck.position.set(sill.center.x, sill.topY - sillThickness * 0.5, sill.center.z);
        deck.castShadow = true;
        deck.receiveShadow = true;
        deck.userData.cameraOcclusionSurface = true;
        deck.userData.connectorId = spec.connectionId;
        deck.userData.liftId = spec.id;
        deck.userData.liftLandingEndpoint = sill.endpoint;
        liftRoot.add(deck);

        for (const supportSpec of sill.supportPosts ?? []) {
          const supportWidth = Number(supportSpec.size?.x ?? 0.24);
          const supportHeight = Number(supportSpec.size?.y ?? 0.6);
          const supportDepth = Number(supportSpec.size?.z ?? 0.24);
          const post = new THREE.Mesh(
            new THREE.BoxGeometry(supportWidth, supportHeight, supportDepth),
            materials.supportMetal,
          );
          post.name = 'automaticConnectorLiftLandingSillSupport';
          post.position.set(
            supportSpec.center.x,
            supportSpec.center.y,
            supportSpec.center.z,
          );
          post.castShadow = true;
          post.receiveShadow = true;
          post.userData.cameraOcclusionSurface = true;
          post.userData.connectorId = spec.connectionId;
          post.userData.liftId = spec.id;
          post.userData.sourceContractSupportId = supportSpec.id;
          liftRoot.add(post);
          solidZones.push({
            id: `${supportSpec.id}:collision`,
            label: 'Connector lift landing support',
            connectionId: spec.connectionId,
            liftId: spec.id,
            sourceContractSupportId: supportSpec.id,
            position: new THREE.Vector3(
              supportSpec.center.x,
              supportSpec.center.y,
              supportSpec.center.z,
            ),
            halfWidth: supportWidth * 0.5,
            halfDepth: supportDepth * 0.5,
            verticalHalfHeight: supportHeight * 0.5,
          });
        }

        const sillSurface = {
          id: `${sill.id}:surface`,
          connectionId: spec.connectionId,
          liftId: spec.id,
          endpoint: sill.endpoint,
          center: sill.center.clone().setY(sill.topY),
          halfWidth: sill.halfWidth,
          halfDepth: sill.halfDepth,
          topY: sill.topY,
          baseY: sill.topY - sillThickness,
          collisionThicknessMeters: sillThickness,
          blocksBelow: false,
          dynamic: false,
          createsLedgeCandidates: false,
          purpose: sill.purpose,
          requiredTraversalAction: sill.requiredTraversalAction,
          object: deck,
        };
        landingSillSurfaces.push(sillSurface);
        platforms.push(sillSurface);
      }

      const guideOffsetX = width * 0.5 + 0.13;
      const guideOffsetZ = depth * 0.5 + 0.13;
      const guideGeometry = new THREE.BoxGeometry(0.13, height + 1.15, 0.13);
      for (const xSign of [-1, 1]) {
        for (const zSign of [-1, 1]) {
          const guide = new THREE.Mesh(guideGeometry, materials.supportMetal);
          guide.name = 'automaticConnectorLiftGuide';
          guide.position.set(
            spec.center.x + xSign * guideOffsetX,
            spec.bottomElevation + height * 0.5,
            spec.center.z + zSign * guideOffsetZ,
          );
          guide.castShadow = true;
          guide.userData.cameraOcclusionSurface = true;
          liftRoot.add(guide);
        }
      }

      const side = new THREE.Vector3(-spec.facing.z, 0, spec.facing.x).normalize();
      const controls = [];
      for (const endpoint of ['bottom', 'top']) {
        const y = endpoint === 'top' ? spec.topElevation : spec.bottomElevation;
        const authoredPosition = spec.controlAnchors?.[endpoint]?.position;
        const controlPosition = authoredPosition?.isVector3
          ? authoredPosition.clone()
          : spec.center.clone()
            .addScaledVector(side, width * 0.5 + 0.78)
            .setY(y);
        const consoleRoot = new THREE.Group();
        consoleRoot.name = `automaticConnectorLiftCall_${endpoint}`;
        consoleRoot.position.copy(controlPosition);
        const consoleFacing = spec.center.clone().sub(controlPosition).setY(0);
        if (consoleFacing.lengthSq() > 0.0001) {
          consoleRoot.rotation.y = Math.atan2(consoleFacing.x, consoleFacing.z);
        }
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(0.34, 0.9, 0.24),
          materials.terminal,
        );
        body.name = 'automaticConnectorLiftCallBody';
        body.position.y = 0.45;
        body.castShadow = true;
        const light = new THREE.Mesh(
          new THREE.BoxGeometry(0.13, 0.13, 0.04),
          materials.glowBlue,
        );
        light.name = 'automaticConnectorLiftCallLight';
        light.position.set(0, 0.58, 0.14);
        consoleRoot.add(body, light);
        liftRoot.add(consoleRoot);
        controls.push({
          id: `${spec.id}:call:${endpoint}`,
          liftId: spec.id,
          endpoint,
          label: `Call lift to ${endpoint} landing`,
          position: controlPosition,
          object: consoleRoot,
          interactionRadius: 1.55,
        });
        solidZones.push({
          id: `${spec.id}:call:${endpoint}:collision`,
          label: 'Connector lift call panel',
          connectionId: spec.connectionId,
          position: controlPosition.clone().add(new THREE.Vector3(0, 0.45, 0)),
          halfWidth: 0.24,
          halfDepth: 0.2,
          verticalHalfHeight: 0.45,
        });
      }

      const surface = {
        id: `${spec.id}:surface`,
        center: spec.center.clone(),
        halfWidth: width * 0.5,
        halfDepth: depth * 0.5,
        topY: initialElevation,
        baseY: initialElevation - 0.28,
        blocksBelow: true,
        dynamic: true,
        createsLedgeCandidates: false,
        purpose: 'automatic_connector_lift',
        requiredTraversalAction: 'automatic_lift',
      };
      const lift = {
        ...spec,
        label: 'Automatic Freight Lift',
        object: liftRoot,
        platformObject: platform,
        surface,
        landingSillSurfaces,
        controls,
        phase: initialElevation === spec.topElevation ? 'dwelling-top' : 'dwelling-bottom',
        dwellRemaining: spec.dwellSeconds,
        requestedEndpoint: null,
        currentElevation: initialElevation,
      };
      liftRoot.userData.liftId = lift.id;
      liftRoot.userData.liftSweptRange = {
        bottomY: lift.bottomElevation,
        topY: lift.topElevation,
        riderClearance: lift.riderClearanceMeters,
      };
      group.add(liftRoot);
      lifts.push(lift);
      platforms.push(surface);
    };

    const applyShortcutMetadata = (descriptor, plan, fixtureKind) => {
      if (!descriptor || !plan?.oneSideActivatedShortcut) return descriptor;
      descriptor.shortcutMode = plan.shortcutMode ?? null;
      descriptor.shortcutMechanismId = plan.shortcutMechanismId ?? null;
      descriptor.shortcutStateId = plan.shortcutStateId ?? null;
      descriptor.runtimeStateIds = plan.shortcutStateId ? [plan.shortcutStateId] : [];
      descriptor.shortcutInitialState = plan.shortcutInitialState ?? null;
      descriptor.shortcutActivatedState = plan.shortcutActivatedState ?? null;
      descriptor.shortcutActivationSide = plan.shortcutActivationSide ?? null;
      if (fixtureKind === 'ladder' && plan.shortcutMode === 'drop-ladder') {
        descriptor.disabled = plan.shortcutInitialState !== 'deployed';
        descriptor.deployed = !descriptor.disabled;
      }
      if (fixtureKind === 'lift' && plan.shortcutMode === 'shortcut-lift') {
        descriptor.shortcutUnlocked = plan.shortcutInitialState === 'available';
      }
      return descriptor;
    };
    for (const plan of connectionPlans) {
      for (const ladder of plan.ladderContracts ?? []) {
        addLadder(applyShortcutMetadata(ladder, plan, 'ladder'));
      }
      for (const lift of plan.liftContracts ?? []) {
        addLift(applyShortcutMetadata(lift, plan, 'lift'));
      }
    }

    return { ladders, lifts, platforms };
  }

  _addVerticalConnectionPortals(group, connectionPlans = [], materials) {
    const portals = [];

    for (const plan of connectionPlans.filter((candidate) => candidate.level !== 0)) {
      for (const socket of [plan.fromSocket, plan.toSocket]) {
        const portal = new THREE.Group();
        const facesX = Math.abs(socket.facingX) > 0;
        const portalSpan = this.tileSize * CONNECTOR_GALLERY_PORTAL_WIDTH_TILES;
        const postGeometry = new THREE.BoxGeometry(
          facesX ? 0.16 : 0.18,
          2.8,
          facesX ? 0.18 : 0.16,
        );
        const headerGeometry = new THREE.BoxGeometry(
          facesX ? 0.18 : portalSpan,
          0.18,
          facesX ? portalSpan : 0.18,
        );
        const sideOffsetX = facesX ? 0 : portalSpan * 0.5;
        const sideOffsetZ = facesX ? portalSpan * 0.5 : 0;

        portal.name = `verticalPortal_${socket.id}`;
        portal.position.set(socket.x * this.tileSize, socket.elevation, socket.z * this.tileSize);
        portal.userData.verticalPortal = {
          ...socket,
          connectionId: plan.id,
          purpose: plan.purpose,
          portalSpan,
        };

        for (const sign of [-1, 1]) {
          const post = new THREE.Mesh(postGeometry, materials.supportMetal);
          post.name = 'verticalPortalSupport';
          post.position.set(sideOffsetX * sign, 1.4, sideOffsetZ * sign);
          post.castShadow = true;
          portal.add(post);
        }

        const header = new THREE.Mesh(headerGeometry, materials.factoryRail);
        header.name = 'verticalPortalElevationHeader';
        header.position.y = 2.78;
        header.castShadow = true;
        portal.add(header);

        const status = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.1), materials.glowBlue);
        status.name = 'verticalPortalMatchedElevationLight';
        status.position.set(0, 2.5, 0);
        portal.add(status);

        group.add(portal);
        portals.push({
          id: socket.id,
          connectionId: plan.id,
          roomId: socket.roomId,
          role: socket.role,
          connectorType: socket.connectorType,
          elevation: socket.elevation,
          level: socket.level,
          matchingSocketId: socket.matchingSocketId,
          portalSpan,
          position: portal.position.clone(),
          object: portal,
          purpose: plan.purpose,
        });
      }
    }

    return portals;
  }

  _addDoorThresholdSeal({
    group,
    descriptor,
    placement,
    position,
    materials,
    solidZones = [],
    aerialBoundaryZones = [],
    preserveAdjacentConnectorEntrances = false,
    connectorWallOpenings = new Map(),
    doorConnectionPlanId = null,
    doorLogicalConnectionId = null,
  }) {
    if (!descriptor?.to || !placement?.point) {
      return null;
    }

    const room = placement.thresholdRoom ?? descriptor.to;
    const alongX = placement.alongX;
    const halfW = Math.floor(room.width / 2);
    const halfD = Math.floor(room.depth / 2);
    const roomTransverseMin = alongX
      ? (room.z - halfD - 0.5) * this.tileSize
      : (room.x - halfW - 0.5) * this.tileSize;
    const roomTransverseMax = alongX
      ? (room.z + halfD + 0.5) * this.tileSize
      : (room.x + halfW + 0.5) * this.tileSize;
    const transverseCenter = alongX ? position.z : position.x;
    const portalSpan = this.tileSize * CONNECTOR_GALLERY_PORTAL_WIDTH_TILES;
    const transverseMin = roomTransverseMin;
    const transverseMax = roomTransverseMax;
    const openingMin = Math.max(transverseMin, transverseCenter - portalSpan * 0.5);
    const openingMax = Math.min(transverseMax, transverseCenter + portalSpan * 0.5);
    // The normal dungeon shell already occupies the exact exterior boundary.
    // Recess this reinforced seal slightly into the destination room so its
    // tiled faces cannot z-fight with the shell while remaining flush with the
    // automatic door frame from the player's perspective.
    const outwardX = alongX ? Math.sign(position.x - room.x * this.tileSize) : 0;
    const outwardZ = alongX ? 0 : Math.sign(position.z - room.z * this.tileSize);
    const sealPlaneX = position.x - outwardX * RUIN_WALL_THICKNESS * 0.62;
    const sealPlaneZ = position.z - outwardZ * RUIN_WALL_THICKNESS * 0.62;
    const seal = new THREE.Group();
    seal.name = `${descriptor.id}_thresholdSeal`;
    seal.userData.cameraOcclusionOwner = true;
    seal.userData.roomId = room.id;
    seal.userData.doorId = descriptor.id;
    seal.userData.doorThresholdSeal = true;
    const wallZones = [];
    const wallBottomY = position.y;
    const wallTopY = position.y + RUIN_WALL_HEIGHT;
    const reservedOpenings = [{
      id: `${descriptor.id}:door-opening`,
      min: openingMin,
      max: openingMax,
      bottomY: wallBottomY,
      topY: wallTopY,
    }];
    if (preserveAdjacentConnectorEntrances) {
      const sealLine = (alongX ? position.x : position.z) / this.tileSize;
      const expectsHorizontalWall = !alongX;
      const seenApertures = new Set();
      for (const entries of connectorWallOpenings.values()) {
        for (const opening of entries) {
          if (
            opening.connectionId === doorConnectionPlanId
            || (
              doorLogicalConnectionId
              && opening.logicalConnectionId === doorLogicalConnectionId
            )
            || opening.horizontal !== expectsHorizontalWall
            || Math.abs(Number(opening.line) - sealLine) > 0.001
          ) {
            continue;
          }
          const bottomY = Math.max(wallBottomY, Number(opening.bottomY));
          const topY = Math.min(wallTopY, Number(opening.topY));
          if (topY - bottomY <= 0.05) continue;
          const min = Math.max(
            transverseMin,
            (Number(opening.axis) - 0.5) * this.tileSize
              - PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
          );
          const max = Math.min(
            transverseMax,
            (Number(opening.axis) + 0.5) * this.tileSize
              + PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
          );
          if (max - min <= 0.05) continue;
          const apertureKey = [opening.socketId, min, max, bottomY, topY].join(':');
          if (seenApertures.has(apertureKey)) continue;
          seenApertures.add(apertureKey);
          reservedOpenings.push({
            id: `${opening.connectionId}:${opening.socketId}:${opening.axis}`,
            min,
            max,
            bottomY,
            topY,
          });
        }
      }
    }
    const subtractOpening = (rectangle, opening) => {
      const intersectionMin = Math.max(rectangle.min, opening.min);
      const intersectionMax = Math.min(rectangle.max, opening.max);
      const intersectionBottomY = Math.max(rectangle.bottomY, opening.bottomY);
      const intersectionTopY = Math.min(rectangle.topY, opening.topY);
      if (
        intersectionMax - intersectionMin <= 0.05
        || intersectionTopY - intersectionBottomY <= 0.05
      ) {
        return [rectangle];
      }
      const pieces = [];
      if (intersectionMin - rectangle.min > 0.05) {
        pieces.push({
          ...rectangle,
          max: intersectionMin,
        });
      }
      if (rectangle.max - intersectionMax > 0.05) {
        pieces.push({
          ...rectangle,
          min: intersectionMax,
        });
      }
      if (intersectionBottomY - rectangle.bottomY > 0.05) {
        pieces.push({
          ...rectangle,
          min: intersectionMin,
          max: intersectionMax,
          topY: intersectionBottomY,
        });
      }
      if (rectangle.topY - intersectionTopY > 0.05) {
        pieces.push({
          ...rectangle,
          min: intersectionMin,
          max: intersectionMax,
          bottomY: intersectionTopY,
        });
      }
      return pieces;
    };
    let segmentDefinitions = [{
      min: transverseMin,
      max: transverseMax,
      bottomY: wallBottomY,
      topY: wallTopY,
    }];
    for (const opening of reservedOpenings) {
      segmentDefinitions = segmentDefinitions.flatMap((rectangle) => (
        subtractOpening(rectangle, opening)
      ));
    }
    segmentDefinitions.sort((left, right) => (
      left.min - right.min
      || left.bottomY - right.bottomY
      || left.max - right.max
    ));
    const sideCounts = { left: 0, right: 0 };

    for (const segment of segmentDefinitions) {
      const span = segment.max - segment.min;
      const height = segment.topY - segment.bottomY;
      if (span <= 0.05 || height <= 0.05) {
        continue;
      }

      const segmentCenter = (segment.min + segment.max) * 0.5;
      const side = segmentCenter < transverseCenter ? 'left' : 'right';
      sideCounts[side] += 1;
      const sideSuffix = sideCounts[side] === 1 ? side : `${side}_${sideCounts[side]}`;
      const width = alongX ? RUIN_WALL_THICKNESS : span;
      const depth = alongX ? span : RUIN_WALL_THICKNESS;
      const wall = new THREE.Mesh(
        this._createTiledBoxGeometry(width, height, depth),
        [
          materials.wallMacroTiles.mm,
          materials.wallMacroTiles.mm,
          materials.wallTrim,
          materials.wallTrim,
          materials.wallMacroTiles.mm,
          materials.wallMacroTiles.mm,
        ],
      );
      wall.name = `doorThresholdWallWing_${sideSuffix}`;
      wall.position.set(
        alongX ? sealPlaneX : segmentCenter,
        segment.bottomY + height * 0.5,
        alongX ? segmentCenter : sealPlaneZ,
      );
      wall.castShadow = true;
      wall.receiveShadow = true;
      wall.userData.doorId = descriptor.id;
      wall.userData.roomId = room.id;
      wall.userData.thresholdSide = side;
      // Threshold wings visually replace the boundary shell around a doorway,
      // so they must participate in the same camera-to-player occlusion test.
      // Own each wing independently: hiding one obstructing side must not make
      // the opposite, non-obstructing side of the doorway disappear.
      wall.userData.cameraOcclusionSurface = true;
      wall.userData.cameraOcclusionOwner = true;
      seal.add(wall);

      const zone = {
        id: `${descriptor.id}_thresholdWall_${sideSuffix}`,
        roomId: room.id,
        doorId: descriptor.id,
        label: 'Door threshold wall wing',
        obstacleKind: 'doorThresholdWall',
        position: wall.position.clone(),
        halfWidth: width * 0.5,
        halfDepth: depth * 0.5,
        verticalHalfHeight: height * 0.5,
        allowFlyOver: false,
        blocksPowerKnockback: true,
        thresholdSide: side,
      };
      solidZones.push(zone);
      aerialBoundaryZones.push(zone);
      wallZones.push(zone);
    }

    group.add(seal);
    return {
      object: seal,
      roomId: room.id,
      doorId: descriptor.id,
      portalSpan,
      transverseMin,
      transverseMax,
      reservedConnectorApertureCount: reservedOpenings.length - 1,
      wallZones,
    };
  }

  _addDoors(
    group,
    rooms,
    materials,
    tiles = null,
    connectionPlans = [],
    solidZones = [],
    aerialBoundaryZones = [],
    {
      preserveAdjacentConnectorEntrances = false,
      connectorWallOpenings = new Map(),
      lockedGatesAtCorridorEntrances = true,
    } = {},
  ) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const descriptors = [
      { id: 'entranceDoor', from: roomById.get('expeditionCamp'), to: roomById.get('entrance'), locked: false, closed: false, label: 'Ruin Entrance' },
      { id: 'enemyNestGate', from: roomById.get('enemyNest'), to: roomById.get('keycardRoom'), locked: true, closed: true, encounterId: 'enemyNest', label: 'Security Gate' },
      { id: 'Door_Alpha', from: roomById.get('keycardRoom'), to: roomById.get('trapRoom'), locked: true, closed: true, requiresKeycard: true, requiredKeycardId: 'Keycard_Alpha', progressionTier: 1, label: 'Security Door Alpha' },
      { id: 'Door_Beta', from: roomById.get('trapRoom'), to: roomById.get('conveyorRoom'), locked: true, closed: true, requiresKeycard: true, requiredKeycardId: 'Keycard_Beta', progressionTier: 2, label: 'Security Door Beta' },
      { id: 'Door_Gamma', from: roomById.get('conveyorRoom'), to: roomById.get('bossRoom'), locked: true, closed: true, requiresKeycard: true, requiredKeycardId: 'Keycard_Gamma', progressionTier: 3, label: 'Security Door Gamma' },
      { id: 'bonusVaultDoor', from: roomById.get('conveyorRoom'), to: roomById.get('bonusVault'), locked: true, closed: true, pressurePlateId: 'conveyorVaultPlate', optional: true, sealedPortal: true, label: 'Bonus Vault' },
      { id: 'Door_Shrine', from: roomById.get('bossRoom'), to: roomById.get('shrineRoom'), locked: true, closed: true, requiresKeycard: true, requiredKeycardId: 'Shrine_Key', progressionTier: 'Final', isShrineDoor: true, label: 'Refractor Shrine Door' },
    ];
    const knownDoorIds = new Set(descriptors.map(({ id }) => id));
    for (const plan of connectionPlans.filter((candidate) => (
      candidate?.isDungeonSupplement && candidate?.doorId
    ))) {
      const id = String(plan.doorId);
      if (knownDoorIds.has(id)) continue;
      const requirements = createDungeonSupplementProgressionRequirements(plan);
      const progressionFromRoomId = plan.progressionFromRoomId
        ?? plan.fromSocket?.progressionRoomId
        ?? plan.fromRoomId;
      const progressionToRoomId = plan.progressionToRoomId
        ?? plan.toSocket?.progressionRoomId
        ?? plan.toRoomId;
      descriptors.push({
        id,
        connectionPlanId: plan.id,
        from: roomById.get(progressionFromRoomId),
        to: roomById.get(progressionToRoomId),
        locked: true,
        closed: true,
        requiresKeycard: Boolean(requirements.requiredKeycardId),
        ...requirements,
        progressionTier: plan.progressionTier ?? plan.augmentationProgressionBand ?? null,
        leadsToDepthBand: plan.leadsToDepthBand ?? plan.destinationProgressionBand ?? null,
        encounterId: plan.requiresEncounterId ?? plan.encounterId ?? null,
        mechanismId: plan.requiresMechanismId ?? plan.mechanismId ?? null,
        isDungeonSupplement: true,
        label: plan.gateLabel ?? 'Supplement Security Gate',
      });
      knownDoorIds.add(id);
    }
    const doors = [];

    for (const descriptor of descriptors) {
      if (!descriptor.from || !descriptor.to) {
        continue;
      }
      const connectionPlan = connectionPlans.find((plan) => (
        descriptor.connectionPlanId
          ? plan.id === descriptor.connectionPlanId
          : plan.level === 0
            && plan.fromRoomId === descriptor.from.id
            && plan.toRoomId === descriptor.to.id
      ));
      const gatePlacementSide = lockedGatesAtCorridorEntrances && descriptor.locked
        ? 'source'
        : 'destination';
      const placement = resolveConnectionDoorPlacement(
        connectionPlan,
        descriptor.from,
        descriptor.to,
        { gatePlacementSide },
      );
      const doorX = placement.point.x;
      const doorZ = placement.point.z;
      const thresholdTilePosition = this._tileToWorld(
        doorX,
        doorZ,
        tiles,
      );
      const position = thresholdTilePosition.clone();
      if (placement.thresholdAnchored && placement.thresholdSocket) {
        position.x += (placement.thresholdSocket.facingX ?? 0) * this.tileSize * 0.5;
        position.z += (placement.thresholdSocket.facingZ ?? 0) * this.tileSize * 0.5;
      }
      const baseY = thresholdTilePosition.y;
      const alongX = placement.alongX;
      const thresholdSeal = this._addDoorThresholdSeal({
        group,
        descriptor,
        placement,
        position,
        materials,
        solidZones,
        aerialBoundaryZones,
        preserveAdjacentConnectorEntrances,
        connectorWallOpenings,
        doorConnectionPlanId: connectionPlan?.id ?? null,
        doorLogicalConnectionId:
          connectionPlan?.logicalConnectionId ?? connectionPlan?.id ?? null,
      });
      const door = new THREE.Group();
      door.name = descriptor.id;
      door.position.copy(position);

      const panelMaterial = descriptor.locked ? materials.lockedDoor : materials.door;
      const frame = new THREE.Group();
      frame.name = 'dungeonDoorFrame';
      const portalSpan = this.tileSize * CONNECTOR_GALLERY_PORTAL_WIDTH_TILES;
      const panelSpan = portalSpan * 0.5;
      const slidingAxis = alongX ? 'z' : 'x';
      const leftPanelClosedOffset = -portalSpan * 0.25;
      const rightPanelClosedOffset = portalSpan * 0.25;
      const slidingOpenOffset = portalSpan * 0.51;
      const panelGeometry = new THREE.BoxGeometry(
        alongX ? 0.28 : panelSpan,
        RUIN_DOOR_HEIGHT,
        alongX ? panelSpan : 0.28,
      );
      const leftPanel = new THREE.Mesh(panelGeometry, panelMaterial);
      const rightPanel = new THREE.Mesh(panelGeometry, panelMaterial);
      leftPanel.name = 'automaticSlidingDoorPanelLeft';
      rightPanel.name = 'automaticSlidingDoorPanelRight';
      leftPanel.position.y = RUIN_DOOR_HEIGHT * 0.5;
      rightPanel.position.y = RUIN_DOOR_HEIGHT * 0.5;
      leftPanel.position[slidingAxis] = leftPanelClosedOffset - (descriptor.closed ? 0 : slidingOpenOffset);
      rightPanel.position[slidingAxis] = rightPanelClosedOffset + (descriptor.closed ? 0 : slidingOpenOffset);
      leftPanel.castShadow = true;
      rightPanel.castShadow = true;
      leftPanel.receiveShadow = true;
      rightPanel.receiveShadow = true;

      const addPanelRibs = (panel) => {
        for (const y of [-1.15, 0, 1.15]) {
          const rib = new THREE.Mesh(
            new THREE.BoxGeometry(
              alongX ? 0.31 : panelSpan * 0.82,
              0.11,
              alongX ? panelSpan * 0.82 : 0.31,
            ),
            materials.supportMetal,
          );
          rib.name = 'automaticDoorReinforcementRib';
          rib.position.y = y;
          rib.castShadow = true;
          panel.add(rib);
        }
      };
      addPanelRibs(leftPanel);
      addPanelRibs(rightPanel);

      const addFramePart = (name, width, height, depth, x, y, z, material = materials.supportMetal) => {
        const part = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
        part.name = name;
        part.position.set(x, y, z);
        part.castShadow = true;
        part.receiveShadow = true;
        frame.add(part);
        return part;
      };
      for (const sign of [-1, 1]) {
        addFramePart(
          'automaticDoorHydraulicColumn',
          alongX ? 0.52 : 0.38,
          RUIN_DOOR_HEIGHT + 0.72,
          alongX ? 0.38 : 0.52,
          alongX ? 0 : sign * portalSpan * 0.58,
          (RUIN_DOOR_HEIGHT + 0.72) * 0.5,
          alongX ? sign * portalSpan * 0.58 : 0,
        );
      }
      addFramePart(
        'automaticDoorMachineHeader',
        alongX ? 0.56 : portalSpan * 1.28,
        0.72,
        alongX ? portalSpan * 1.28 : 0.56,
        0,
        RUIN_DOOR_HEIGHT + 0.36,
        0,
        materials.wallTrim,
      );
      if (descriptor.sealedPortal) {
        const transomHeight = Math.max(0.8, RUIN_WALL_HEIGHT - RUIN_DOOR_HEIGHT);
        const transom = new THREE.Mesh(
          this._createTiledBoxGeometry(
            alongX ? RUIN_WALL_THICKNESS : portalSpan * 1.34,
            transomHeight,
            alongX ? portalSpan * 1.34 : RUIN_WALL_THICKNESS,
          ),
          [
            materials.wallMacroTiles.mm,
            materials.wallMacroTiles.mm,
            materials.wallTrim,
            materials.wallTrim,
            materials.wallMacroTiles.mm,
            materials.wallMacroTiles.mm,
          ],
        );
        transom.name = 'vaultSealedPortalTransom';
        transom.position.y = RUIN_DOOR_HEIGHT + transomHeight * 0.5;
        transom.castShadow = true;
        transom.receiveShadow = true;
        frame.add(transom);
      }

      const light = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? 0.26 : this.tileSize * 0.42, 0.08, alongX ? this.tileSize * 0.42 : 0.26),
        descriptor.locked ? materials.glowYellow : materials.glowBlue,
      );
      light.name = descriptor.locked ? 'lockedDoorStatusLight' : 'doorStatusLight';
      light.position.y = RUIN_DOOR_HEIGHT + 0.28;

      door.add(frame, leftPanel, rightPanel, light);
      group.add(door);

      const data = {
        id: descriptor.id,
        label: descriptor.label,
        object: door,
        frame,
        leftPanel,
        rightPanel,
        light,
        position: position.clone(),
        graphBlockingPosition: thresholdTilePosition.clone(),
        baseY,
        radius: 1.1,
        locked: descriptor.locked,
        closed: descriptor.closed,
        requiresKeycard: Boolean(descriptor.requiresKeycard),
        requiredKeycardId: descriptor.requiredKeycardId ?? null,
        requiredCredentialIds: [...new Set([
          ...(descriptor.requiredCredentialIds ?? []),
          ...(descriptor.requiredKeycardId ? [descriptor.requiredKeycardId] : []),
        ].filter(Boolean).map(String))],
        requiredEncounterStateIds: [...(descriptor.requiredEncounterStateIds ?? [])],
        requiredMechanismStateIds: [...(descriptor.requiredMechanismStateIds ?? [])],
        requiredShortcutStateIds: [...(descriptor.requiredShortcutStateIds ?? [])],
        requiredStateIds: [...(descriptor.requiredStateIds ?? [])],
        requiredPressurePlateIds: [...(descriptor.requiredPressurePlateIds ?? [])],
        requiresEncounterState: Boolean(descriptor.requiresEncounterState),
        requiresMechanismState: Boolean(descriptor.requiresMechanismState),
        requiresShortcutState: Boolean(descriptor.requiresShortcutState),
        requiresState: Boolean(descriptor.requiresState),
        requiresPressurePlate: Boolean(descriptor.requiresPressurePlate),
        requirementsMalformed: descriptor.requirementsMalformed === true,
        progressionTier: descriptor.progressionTier ?? null,
        fromRoomId: descriptor.from.id,
        toRoomId: descriptor.to.id,
        optional: Boolean(descriptor.optional),
        isShrineDoor: Boolean(descriptor.isShrineDoor),
        isDungeonSupplement: Boolean(descriptor.isDungeonSupplement),
        leadsToDepthBand: descriptor.leadsToDepthBand ?? null,
        mechanismId: descriptor.mechanismId ?? null,
        pressurePlateId: descriptor.pressurePlateId
          ?? descriptor.requiredPressurePlateIds?.[0]
          ?? null,
        encounterId: descriptor.encounterId ?? null,
        opened: !descriptor.closed,
        alongX,
        slidingAxis,
        leftPanelClosedOffset,
        rightPanelClosedOffset,
        slidingOpenOffset,
        collisionHalfWidth: alongX ? 0.16 : portalSpan * 0.5,
        collisionHalfDepth: alongX ? portalSpan * 0.5 : 0.16,
        collisionHeight: RUIN_DOOR_HEIGHT,
        connectionPlanId: connectionPlan?.id ?? null,
        thresholdAnchored: Boolean(placement.thresholdAnchored),
        ...(lockedGatesAtCorridorEntrances ? {
          gatePlacementSide: placement.gatePlacementSide,
          thresholdOwnerRoomId: placement.thresholdRoom?.id ?? descriptor.to.id,
        } : {}),
        thresholdSeal: thresholdSeal?.object ?? null,
        thresholdWallZones: thresholdSeal?.wallZones ?? [],
        thresholdPortalSpan: thresholdSeal?.portalSpan ?? null,
        thresholdReservedConnectorApertureCount:
          thresholdSeal?.reservedConnectorApertureCount ?? 0,
        exitElevation: connectionPlan?.fromSocket.elevation ?? baseY,
        entranceElevation: connectionPlan?.toSocket.elevation ?? baseY,
        fromPortal: connectionPlan ? {
          ...connectionPlan.fromSocket,
          roomId: descriptor.from.id,
        } : null,
        toPortal: connectionPlan ? {
          ...connectionPlan.toSocket,
          roomId: descriptor.to.id,
        } : null,
      };
      door.userData.dungeonDoor = data;
      doors.push(data);
    }

    return doors;
  }

  _resolveConveyorConsoleTile(console, room, floorTiles = [], solidZones = [], reservedKeys = new Set()) {
    const halfW = Math.floor(room.width / 2);
    const halfD = Math.floor(room.depth / 2);
    const roomBaseElevation = Number(room.baseElevation ?? 0);
    const structuralColumns = new Set(
      floorTiles
        .filter((tile) => tile.roomId === room.id && tile.supportStyle === 'solid_mass')
        .map((tile) => tileKey(tile.x, tile.z)),
    );
    const unsafeElevatedColumns = new Set(
      floorTiles
        .filter((tile) => (
          tile.roomId === room.id
          && (tile.elevation ?? roomBaseElevation) > roomBaseElevation + 0.2
          && tile.surface !== 'mechanicalPyramidSidePlatform'
        ))
        .map((tile) => tileKey(tile.x, tile.z)),
    );
    const candidates = floorTiles
      .filter((tile) => (
        tile.roomId === room.id
        && Math.abs((tile.elevation ?? roomBaseElevation) - roomBaseElevation) <= 0.05
        && tile.surface !== 'industrialRamp'
        && tile.type !== 'conveyor'
        && !String(tile.surface ?? '').toLowerCase().includes('conveyor')
        && tile.x >= room.x - halfW + 2
        && tile.x <= room.x + halfW - 2
        && tile.z >= room.z - halfD + 2
        && tile.z <= room.z + halfD - 2
        && !structuralColumns.has(tileKey(tile.x, tile.z))
        && !unsafeElevatedColumns.has(tileKey(tile.x, tile.z))
        && !reservedKeys.has(tileKey(tile.x, tile.z))
      ))
      .filter((tile) => {
        const position = this._floorTileToWorld(tile);
        return !solidZones.some((zone) => this._isPositionInsideZone(position, zone));
      })
      .sort((a, b) => (
        Math.abs(a.x - console.x) + Math.abs(a.z - console.z)
        - Math.abs(b.x - console.x) - Math.abs(b.z - console.z)
      ));

    return candidates[0] ?? null;
  }

  _addRoomLandmarks(
    group,
    rooms,
    materials,
    tiles,
    floorTiles = [...tiles.values()],
    solidZones = [],
    supplementalRewardFloorTiles = [],
  ) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const landmarks = {
      keycards: [],
      chests: [],
      mechanisms: [],
      puzzleBlocks: [],
      pressurePlates: [],
      conveyorPuzzles: [],
      platforms: [],
      npcAnimationMixers: [],
      npcAnimators: [],
      safeInteractables: [],
      trapVisuals: [],
      keySeeker: null,
      shrine: null,
    };
    const roomPosition = (room, surfaces = [], { avoidSolidZones = false } = {}) => {
      const avoidKeys = avoidSolidZones
        ? new Set(
          this._getRoomFloorTiles(room, floorTiles)
            .filter((tile) => this._isFloorTileBlockedBySolidZone(tile, solidZones))
            .map((tile) => this._getFloorTileGraphKey(tile)),
        )
        : new Set();
      const tile = this._findReachableRoomFloorTile(room, floorTiles, surfaces, { avoidKeys })
        ?? this._findRoomFloorTile(room, floorTiles, surfaces, { avoidKeys });
      return tile ? this._floorTileToWorld(tile) : this._tileToWorld(room.x, room.z, tiles);
    };

    for (const room of rooms) {
      const position = this._tileToWorld(room.x, room.z, tiles);

      if (room.type === 'hub') {
        landmarks.safeInteractables.push(...this._addHubTown(group, position, materials));
      } else if (room.type === 'camp') {
        const campLandmarks = this._addExpeditionCamp(group, position, materials);
        landmarks.safeInteractables.push(...campLandmarks.interactables);
        solidZones.push(...campLandmarks.solidZones);
        landmarks.platforms.push(...this._addCampPlatformingCourse(group, position, materials));
      } else if (room.type === 'entrance') {
        this._addExpeditionPad(group, position, materials);
        const keySeekerPosition = this._tileToWorld(room.x + 2, room.z + 2, tiles);
        landmarks.keySeeker = {
          id: 'KeySeeker',
          label: 'Key Seeker',
          roomId: room.id,
          object: this._addKeySeekerInteractable(group, keySeekerPosition, materials),
          position: keySeekerPosition.clone(),
          activated: false,
        };
      } else if (room.type === 'keycard') {
        const pyramidCenter = room.mechanicalPyramidCenter;
        const keycardTile = pyramidCenter
          ? floorTiles.find((tile) => (
            tile.roomId === room.id
            && tile.x === pyramidCenter.x
            && tile.z === pyramidCenter.z
            && tile.surface === 'mechanicalPyramidSummit'
          ))
          : this._findReachableRoomFloorTile(room, floorTiles, ['mechanicalPyramidSummit', 'mechanicalPyramidTerrace', 'keycard'])
            ?? this._findReachableRoomFloorTile(room, floorTiles, []);
        const keycardPosition = keycardTile
          ? this._floorTileToWorld(keycardTile)
          : roomPosition(room);
        const barrierObject = this._addKeycardProtectionBarrier(group, keycardPosition);
        landmarks.keycards.push({
          id: 'Keycard_Alpha',
          keycardId: 'Keycard_Alpha',
          displayName: 'Keycard Alpha',
          pairedDoorId: 'Door_Alpha',
          progressionTier: 1,
          spawnRoomId: room.id,
          spawnMode: 'Pedestal',
          isRequiredForMainProgression: true,
          object: this._addKeycardMarker(group, keycardPosition, materials),
          barrierObject,
          protectedByEncounterId: 'keycardGuard',
          position: keycardPosition.clone(),
          collected: false,
        });
      } else if (room.type === 'conveyor') {
        const puzzleDefinition = room.conveyorPuzzleDefinition;
        if (!puzzleDefinition) {
          continue;
        }

        const spawnerPosition = this._tileToWorld(puzzleDefinition.spawner.x, puzzleDefinition.spawner.z, tiles);
        const targetPosition = this._tileToWorld(puzzleDefinition.target.x, puzzleDefinition.target.z, tiles);
        const cargoObject = this._addConveyorCargoObject(group, spawnerPosition, materials);
        const spawnerObject = this._addConveyorCargoSpawner(group, spawnerPosition, materials);

        const reservedConsoleKeys = new Set();
        for (const console of puzzleDefinition.consoles) {
          const safeTile = this._resolveConveyorConsoleTile(
            console,
            room,
            floorTiles,
            solidZones,
            reservedConsoleKeys,
          );
          if (safeTile) {
            console.originalX ??= console.x;
            console.originalZ ??= console.z;
            console.x = safeTile.x;
            console.z = safeTile.z;
            console.key = tileKey(safeTile.x, safeTile.z);
            reservedConsoleKeys.add(console.key);
          }
          const consolePosition = safeTile
            ? this._floorTileToWorld(safeTile)
            : this._tileToWorld(console.x, console.z, tiles);
          const terminal = this._addMechanismTerminal(group, consolePosition, materials);
          terminal.name = `${console.id}Interactable`;
          landmarks.mechanisms.push({
            id: console.id,
            label: console.label,
            object: terminal,
            position: terminal.position.clone(),
            requiresEncounterId: 'conveyorGuard',
            activated: false,
            repeatable: true,
            conveyorPuzzleId: puzzleDefinition.id,
            conveyorPuzzleAction: console.action,
            controlledJunctionIds: console.controls ?? [],
          });
        }

        landmarks.pressurePlates.push({
          id: puzzleDefinition.targetPressurePlateId,
          label: 'Cargo Receiver Plate',
          object: this._addPressurePlate(group, targetPosition, materials),
          position: targetPosition.clone(),
          radius: 0.92,
          targetDoorId: puzzleDefinition.targetDoorId,
          requiredPuzzleObjectId: puzzleDefinition.objectId,
          active: false,
          activated: false,
        });

        landmarks.conveyorPuzzles.push({
          ...puzzleDefinition,
          belts: puzzleDefinition.belts.map((belt) => ({ ...belt, defaultDirection: { ...belt.defaultDirection } })),
          consoles: puzzleDefinition.consoles.map((console) => ({ ...console })),
          junctions: puzzleDefinition.junctions.map((junction) => ({
            ...junction,
            states: junction.states.map((state) => ({ ...state, direction: { ...state.direction } })),
          })),
          spawner: {
            ...puzzleDefinition.spawner,
            launchDirection: { ...puzzleDefinition.spawner.launchDirection },
            position: spawnerPosition.clone(),
            object: spawnerObject,
          },
          target: {
            ...puzzleDefinition.target,
            position: targetPosition.clone(),
          },
          cargo: {
            id: puzzleDefinition.objectId,
            object: cargoObject,
            position: spawnerPosition.clone(),
            currentTileKey: puzzleDefinition.spawner.key,
            spawnTileKey: puzzleDefinition.spawner.key,
            moving: false,
            accepted: false,
          },
          completed: false,
        });
      } else if (room.type === 'coolant') {
        const terminalPosition = roomPosition(
          room,
          ['coolantValveDeck', 'coolantServicePit', 'coolantControlBalcony', 'coolantPipeBridge'],
          { avoidSolidZones: true },
        );
        const terminal = this._addMechanismTerminal(group, terminalPosition, materials);
        terminal.name = 'coolantRelayMasterConsoleInteractable';
        landmarks.mechanisms.push({
          id: 'coolantRelayMasterConsole',
          label: 'Coolant Relay Console',
          object: terminal,
          position: terminal.position.clone(),
          requiresEncounterId: 'coolantRelayDefense',
          activated: false,
          puzzleType: 'coolantRelay',
        });
      } else if (room.type === 'shrine') {
        const focalPoint = room.refractorFocalPoint;
        const shrinePosition = focalPoint
          ? new THREE.Vector3(
            focalPoint.x * this.tileSize,
            Number(room.baseElevation ?? 0) + Number(focalPoint.elevation ?? 0),
            focalPoint.z * this.tileSize,
          )
          : roomPosition(room, ['refractorDais', 'shrineSanctumFloor', 'shrine']);
        landmarks.shrine = {
          id: 'largeRefractor',
          object: this._addLargeRefractorShrine(group, shrinePosition, materials),
          position: shrinePosition.clone(),
          collected: false,
        };
      } else if (room.type === 'trap') {
        const trapPosition = roomPosition(room, ['basementFloor']);
        landmarks.trapVisuals.push({
          roomId: room.id,
          object: this._addTrapEmitters(group, trapPosition, materials),
        });
      }
    }

    let chestIndex = 0;
    const placedChestKeys = new Set();
    const addChest = (tile, {
      keycardChance = 0,
      rareBoost = chestIndex > 0,
      roomId = tile.roomId ?? null,
      guaranteedKeycardId = null,
    } = {}) => {
      const key = floorTileKey(tile.x, tile.z, tile.level ?? 0);
      if (placedChestKeys.has(key)) {
        return null;
      }

      placedChestKeys.add(key);
      const position = this._floorTileToWorld(tile);
      const object = this._addTreasureChest(group, position, materials, chestIndex);
      const room = roomById.get(roomId);
      const flavorRareChance = room?.flavorEffects?.rewards?.rareChanceDelta ?? 0;
      const rewardStateId = tile.dungeonSupplementRewardStateId == null
        ? null
        : String(tile.dungeonSupplementRewardStateId);
      const rewardRecipe = tile.dungeonSupplementRewardRecipe ?? null;
      const isDungeonSupplementReward = Boolean(
        tile.dungeonSupplementRewardId
          || rewardStateId
          || tile.dungeonSupplementRewardProfileId,
      );
      const chest = {
        id: tile.dungeonSupplementRewardId == null
          ? `ruinChest_${chestIndex + 1}`
          : String(tile.dungeonSupplementRewardId),
        object,
        position: position.clone(),
        opened: false,
        rewardClaimed: false,
        keycardChance,
        guaranteedKeycardId,
        containsKeycard: Boolean(guaranteedKeycardId),
        rareBoost: rareBoost
          || flavorRareChance >= 0.1
          || rewardRecipe?.delivery?.rareBoost === true,
        flavorRareChance,
        rewardTags: rewardRecipe?.delivery?.rewardTags ?? room?.rewardTags ?? [],
        roomId,
        floorKey: key,
        stateId: rewardStateId,
        rewardStateId,
        runtimeStateIds: rewardStateId ? [rewardStateId] : [],
        rewardProfileId: tile.dungeonSupplementRewardProfileId ?? null,
        rewardRecipe,
        isProgressionCritical: rewardRecipe?.progressionCritical === true,
        isDungeonSupplement: isDungeonSupplementReward,
        dungeonSupplement: isDungeonSupplementReward,
      };
      landmarks.chests.push(chest);
      chestIndex += 1;
      return chest;
    };

    // Preserve the original authored/legacy chest source and iteration order.
    // V4 can place a reward on a raised authored floor that is intentionally
    // absent from the structural tile map, so append only those reward-bearing
    // layers. `addChest` keeps base-tier records deduplicated.
    for (const tile of tiles.values()) {
      if (tile.type !== 'chest') {
        continue;
      }

      addChest(tile);
    }
    for (const tile of supplementalRewardFloorTiles) {
      if (tile.type !== 'chest') {
        continue;
      }

      addChest(tile);
    }

    const chestRequests = [
      { roomId: 'alienServerRoom', surfaces: ['jumpPlatform', 'serverUpperCatwalk', 'serverCoreFloor'], keycardChance: 0, rareBoost: true },
      { roomId: 'machineFactoryRoom', surfaces: ['jumpPlatform', 'machineCrossBridge', 'machineUpperCatwalk', 'machinePressZone'], keycardChance: 0, rareBoost: true },
      { roomId: 'coolantRelayRoom', surfaces: ['jumpPlatform', 'coolantControlBalcony', 'coolantPipeBridge', 'coolantValveDeck'], keycardChance: 0, guaranteedKeycardId: 'Keycard_Beta', rareBoost: true },
      { roomId: 'enemyNest', surfaces: ['jumpPlatform', 'secondFloor', 'enemy'], keycardChance: 0, rareBoost: true },
      { roomId: 'trapRoom', surfaces: ['jumpPlatform', 'basementFloor'], keycardChance: 0, rareBoost: true },
      { roomId: 'conveyorRoom', surfaces: ['jumpPlatform', 'thirdFloorGantry', 'conveyorPuzzleBelt', 'conveyor'], keycardChance: 0, rareBoost: true },
      { roomId: 'bonusVault', surfaces: ['vaultRewardDais'], focalPoint: true, keycardChance: 0, rareBoost: true },
    ];
    for (const request of chestRequests) {
      const room = roomById.get(request.roomId);
      if (!room) {
        continue;
      }

      const focalPoint = request.focalPoint ? room.rewardFocalPoint : null;
      const tile = focalPoint
        ? floorTiles.find((candidate) => (
          candidate.roomId === room.id
          && candidate.x === focalPoint.x
          && candidate.z === focalPoint.z
          && request.surfaces.includes(candidate.surface)
        ))
        : this._findReachableRoomFloorTile(room, floorTiles, request.surfaces, {
          avoidKeys: placedChestKeys,
          preferFarthest: true,
        });
      if (tile) {
        addChest(tile, request);
      }
    }

    return landmarks;
  }

  _addExpeditionPad(group, position, materials) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.12, 32), materials.glowBlue);
    pad.name = 'expeditionCampEntrancePad';
    pad.position.set(position.x, position.y + 0.04, position.z);
    group.add(pad);
  }

  _addCampPlatformingCourse(group, position, materials) {
    const platformDefinitions = [
      { id: 'campLowJumpDeck', x: 5.6, z: 0.5, width: 3.8, depth: 3.8, height: 1.1 },
      { id: 'campHighClimbDeck', x: 5.6, z: 5.4, width: 3.8, depth: 3.8, height: 2.8 },
      { id: 'campHighGapDeck', x: 10.4, z: 5.4, width: 3.6, depth: 3.8, height: 2.8 },
      { id: 'campReturnDeck', x: 10.4, z: 0.4, width: 3.6, depth: 3.6, height: 1.5 },
    ];
    const platforms = [];

    for (const definition of platformDefinitions) {
      const center = position.clone().add(new THREE.Vector3(
        definition.x,
        definition.height * 0.5,
        definition.z,
      ));
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(definition.width, definition.height, definition.depth),
        materials.wallTrim,
      );
      body.name = `${definition.id}Body`;
      body.position.copy(center);
      body.castShadow = true;
      body.receiveShadow = true;

      const lip = new THREE.Mesh(
        new THREE.BoxGeometry(definition.width + 0.08, 0.08, definition.depth + 0.08),
        materials.glowBlue,
      );
      lip.name = `${definition.id}Lip`;
      lip.position.set(center.x, position.y + definition.height - 0.04, center.z);
      lip.castShadow = true;
      lip.receiveShadow = true;
      group.add(body, lip);

      platforms.push({
        id: definition.id,
        center,
        halfWidth: definition.width * 0.5,
        halfDepth: definition.depth * 0.5,
        topY: definition.height,
        baseY: position.y,
      });
    }

    return platforms;
  }

  _addHubTown(group, position, materials) {
    const interactables = [];
    const plaza = new THREE.Group();
    plaza.name = 'minimalHubTown';
    plaza.position.copy(position);

    // The hub center is the player spawn and the +Z axis is the main route to
    // camp. Keep all hub services on the perimeter instead of crowding either.
    const garageOffset = new THREE.Vector3(-5.2, 0, -2.2);

    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.44), materials.glowBlue);
    sign.name = 'hubTownGarageSign';
    sign.position.copy(garageOffset).add(new THREE.Vector3(0, 0.96, -0.25));

    const garage = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.86, 0.72), materials.wallTrim);
    garage.name = 'hubTownGarageWorkbench';
    garage.position.copy(garageOffset).setY(0.43);
    garage.castShadow = true;
    garage.receiveShadow = true;

    plaza.add(sign, garage);
    group.add(plaza);

    interactables.push({
      id: 'garageWorkbench',
      label: 'Garage Workbench',
      action: 'garage',
      position: position.clone().add(garageOffset),
      object: plaza,
      color: 0x6bdcff,
    });
    return interactables;
  }

  _addExpeditionCamp(group, position, materials) {
    const interactables = [];
    const solidZones = [];
    const camp = new THREE.Group();
    camp.name = 'minimalExpeditionCamp';
    camp.position.copy(position);

    const tentMaterial = new THREE.MeshStandardMaterial({
      color: 0x2f5c68,
      emissive: 0x061a20,
      emissiveIntensity: 0.12,
      roughness: 0.78,
      metalness: 0.05,
    });
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.1, 4), tentMaterial);
    tent.name = 'expeditionCampTent';
    tent.position.set(-1.65, 0.55, 0.4);
    tent.rotation.y = Math.PI / 4;
    tent.castShadow = true;
    tent.receiveShadow = true;

    const board = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.72, 0.12), materials.glowYellow);
    board.name = 'expeditionQuestBoard';
    board.position.set(1.45, 0.72, 0.2);
    board.castShadow = true;

    // Keep the complete workshop ensemble in the unused back-left corner.
    // The car's authored front faces local -Z; its +X flank carries the front
    // door, followed by Roll and then the workbench along the same line.
    const workshop = new THREE.Group();
    workshop.name = 'rollSupportCampWorkshop';
    workshop.position.set(
      SUPPORT_CAR_CAMP_POSITION.x,
      SUPPORT_CAR_CAMP_POSITION.y,
      SUPPORT_CAR_CAMP_POSITION.z,
    );
    workshop.rotation.y = SUPPORT_CAR_YAW;

    const supportCar = new THREE.Group();
    supportCar.name = 'expeditionSupportCar';
    supportCar.userData.targetModelHeight = SUPPORT_CAR_HEIGHT;
    supportCar.userData.frontAxis = '-Z';
    supportCar.userData.frontDoorSide = '+X';
    supportCar.userData.usingFallback = true;
    const supportCarFallback = this._createSupportCarFallback();
    const frontDoorMarker = new THREE.Object3D();
    frontDoorMarker.name = 'supportCarFrontDoorMarker';
    frontDoorMarker.position.set(
      SUPPORT_CAR_FRONT_DOOR_LOCAL.x,
      SUPPORT_CAR_FRONT_DOOR_LOCAL.y,
      SUPPORT_CAR_FRONT_DOOR_LOCAL.z,
    );
    supportCar.add(supportCarFallback, frontDoorMarker);

    const roll = new THREE.Group();
    roll.name = 'rollCaskettNpc';
    roll.position.set(
      ROLL_WORKSHOP_LOCAL_POSITION.x,
      ROLL_WORKSHOP_LOCAL_POSITION.y,
      ROLL_WORKSHOP_LOCAL_POSITION.z,
    );
    roll.rotation.y = Math.PI / 2;

    const workbench = this._createRollWorkshopWorkbench();
    workbench.position.set(
      WORKBENCH_LOCAL_POSITION.x,
      WORKBENCH_LOCAL_POSITION.y,
      WORKBENCH_LOCAL_POSITION.z,
    );
    workbench.rotation.y = Math.PI / 2;
    workshop.add(supportCar, roll, workbench);

    const resetConsole = new THREE.Group();
    resetConsole.name = 'expeditionRuinResetConsole';
    resetConsole.position.set(1.35, 0, -1.15);
    const resetBase = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.58, 0.46), materials.wallTrim);
    resetBase.name = 'ruinResetConsoleBase';
    resetBase.position.y = 0.29;
    resetBase.castShadow = true;
    resetBase.receiveShadow = true;
    const resetCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), materials.glowBlue);
    resetCore.name = 'ruinResetConsoleCore';
    resetCore.position.y = 0.75;
    resetConsole.add(resetBase, resetCore);

    const ruinLift = new THREE.Group();
    ruinLift.name = 'expeditionRuinLift';
    ruinLift.position.set(0, 0, 1.55);
    const liftPad = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.82, 0.12, 28), materials.entrance);
    liftPad.name = 'expeditionRuinLiftPad';
    liftPad.position.y = 0.06;
    liftPad.receiveShadow = true;
    const liftRing = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.035, 8, 28), materials.glowBlue);
    liftRing.name = 'expeditionRuinLiftRing';
    liftRing.position.y = 0.16;
    liftRing.rotation.x = Math.PI / 2;
    const liftMarker = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.34, 4), materials.glowYellow);
    liftMarker.name = 'expeditionRuinLiftMarker';
    liftMarker.position.y = 0.48;
    liftMarker.rotation.y = Math.PI / 4;
    ruinLift.add(liftPad, liftRing, liftMarker);

    camp.add(tent, board, workshop, resetConsole, ruinLift);
    group.add(camp);

    const upAxis = new THREE.Vector3(0, 1, 0);
    const resolveWorkshopOffset = (localPosition) => new THREE.Vector3(
      localPosition.x,
      localPosition.y,
      localPosition.z,
    ).applyAxisAngle(upAxis, SUPPORT_CAR_YAW).add(workshop.position);
    const rollOffset = resolveWorkshopOffset(ROLL_WORKSHOP_LOCAL_POSITION);
    const workbenchOffset = resolveWorkshopOffset(WORKBENCH_LOCAL_POSITION);

    interactables.push({
      id: 'rollCaskett',
      label: 'Roll',
      action: 'roll',
      position: position.clone().add(rollOffset),
      object: roll,
      color: 0xffd66b,
      interactionRadius: ROLL_WORKBENCH_INTERACTION_RADIUS,
    });
    interactables.push({
      id: 'ruinResetConsole',
      label: 'Reset Ruin',
      action: 'resetRuin',
      position: position.clone().add(new THREE.Vector3(1.35, 0, -1.15)),
      object: resetConsole,
      color: 0x6bdcff,
    });
    interactables.push({
      id: 'ruinLift',
      label: 'Ruin Lift',
      action: 'enterRuin',
      position: position.clone().add(new THREE.Vector3(0, 0, 1.55)),
      object: ruinLift,
      color: 0x7df8ff,
    });

    solidZones.push({
      id: 'expeditionSupportCarCollision',
      roomId: 'expeditionCamp',
      label: 'Support Car',
      position: position.clone().add(new THREE.Vector3(
        SUPPORT_CAR_CAMP_POSITION.x,
        SUPPORT_CAR_HEIGHT * 0.5,
        SUPPORT_CAR_CAMP_POSITION.z,
      )),
      halfWidth: SUPPORT_CAR_HALF_WIDTH + 0.12,
      halfDepth: SUPPORT_CAR_HALF_DEPTH + 0.12,
      verticalHalfHeight: SUPPORT_CAR_HEIGHT * 0.5,
      // Zone helpers store the inverse of Three.js's visual yaw.
      rotationY: -SUPPORT_CAR_YAW,
    });
    solidZones.push({
      id: 'rollWorkshopWorkbenchCollision',
      roomId: 'expeditionCamp',
      label: 'Roll workshop bench',
      position: position.clone().add(new THREE.Vector3(
        workbenchOffset.x,
        WORKBENCH_HEIGHT * 0.5,
        workbenchOffset.z,
      )),
      halfWidth: WORKBENCH_WIDTH * 0.5,
      halfDepth: WORKBENCH_DEPTH * 0.5,
      verticalHalfHeight: WORKBENCH_HEIGHT * 0.5,
      rotationY: -(SUPPORT_CAR_YAW + Math.PI / 2),
      playerCollisionPadding: PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
    });

    return { interactables, solidZones };
  }

  _createSupportCarFallback() {
    const fallback = new THREE.Group();
    fallback.name = 'supportCarFallback';
    const orange = new THREE.MeshStandardMaterial({
      color: 0xd85816,
      emissive: 0x2d0d02,
      emissiveIntensity: 0.12,
      roughness: 0.64,
      metalness: 0.18,
    });
    const trim = new THREE.MeshStandardMaterial({
      color: 0x555c61,
      roughness: 0.46,
      metalness: 0.48,
    });
    const rubber = new THREE.MeshStandardMaterial({
      color: 0x17191a,
      roughness: 0.86,
      metalness: 0.02,
    });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.82, 0.88, 4.35), orange);
    chassis.name = 'supportCarFallbackChassis';
    chassis.position.y = 1.05;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.68, 1.62, 2.05), orange);
    cabin.name = 'supportCarFallbackCabin';
    cabin.position.set(0, 2.18, -0.78);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.76, 0.16, 2.2), trim);
    roof.name = 'supportCarFallbackRoof';
    roof.position.set(0, 3.06, -0.72);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.94, 0.24, 0.2), trim);
    bumper.name = 'supportCarFallbackFrontBumper';
    bumper.position.set(0, 0.72, -2.25);

    const wheelGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.24, 16);
    for (const x of [-1.43, 1.43]) {
      for (const z of [-1.38, 1.36]) {
        const wheel = new THREE.Mesh(wheelGeometry, rubber);
        wheel.name = 'supportCarFallbackWheel';
        wheel.position.set(x, 0.55, z);
        wheel.rotation.z = Math.PI / 2;
        fallback.add(wheel);
      }
    }

    for (const mesh of [chassis, cabin, roof, bumper]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    fallback.add(chassis, cabin, roof, bumper);
    return fallback;
  }

  _createRollWorkshopWorkbench() {
    const workbench = new THREE.Group();
    workbench.name = 'rollWorkshopWorkbench';
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x4f5558,
      roughness: 0.5,
      metalness: 0.46,
    });
    const surfaceMaterial = new THREE.MeshStandardMaterial({
      name: 'rollWorkbenchGeneratedSurfaceMaterial',
      color: 0xd8611d,
      roughness: 0.66,
      metalness: 0.26,
    });
    const blueprintMaterial = new THREE.MeshStandardMaterial({
      name: 'rollWorkbenchGeneratedBlueprintMaterial',
      color: 0x176a91,
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    workbench.userData.surfaceMaterial = surfaceMaterial;
    workbench.userData.blueprintMaterial = blueprintMaterial;
    workbench.userData.textureLoadErrors = {};

    const topThickness = 0.14;
    const tabletop = new THREE.Mesh(
      new THREE.BoxGeometry(WORKBENCH_WIDTH, topThickness, WORKBENCH_DEPTH),
      [
        frameMaterial,
        frameMaterial,
        surfaceMaterial,
        frameMaterial,
        frameMaterial,
        frameMaterial,
      ],
    );
    tabletop.name = 'rollWorkbenchTop';
    tabletop.position.y = WORKBENCH_HEIGHT - topThickness * 0.5;
    tabletop.castShadow = true;
    tabletop.receiveShadow = true;

    const legHeight = WORKBENCH_HEIGHT - topThickness;
    const legGeometry = new THREE.BoxGeometry(0.12, legHeight, 0.12);
    for (const x of [-WORKBENCH_WIDTH * 0.5 + 0.12, WORKBENCH_WIDTH * 0.5 - 0.12]) {
      for (const z of [-WORKBENCH_DEPTH * 0.5 + 0.1, WORKBENCH_DEPTH * 0.5 - 0.1]) {
        const leg = new THREE.Mesh(legGeometry, frameMaterial);
        leg.name = 'rollWorkbenchLeg';
        leg.position.set(x, legHeight * 0.5, z);
        leg.castShadow = true;
        workbench.add(leg);
      }
    }

    const backRail = new THREE.Mesh(
      new THREE.BoxGeometry(WORKBENCH_WIDTH, 0.16, 0.07),
      frameMaterial,
    );
    backRail.name = 'rollWorkbenchBackRail';
    backRail.position.set(0, WORKBENCH_HEIGHT + 0.06, WORKBENCH_DEPTH * 0.5 - 0.035);
    backRail.castShadow = true;

    const blueprint = new THREE.Mesh(
      new THREE.PlaneGeometry(1.05, 0.62),
      blueprintMaterial,
    );
    blueprint.name = 'rollWorkbenchBlueprint';
    blueprint.position.set(-0.24, WORKBENCH_HEIGHT + 0.004, -0.04);
    blueprint.rotation.x = -Math.PI / 2;
    blueprint.rotation.z = -0.08;
    blueprint.castShadow = true;

    const tools = this._createRollWorkshopTools(frameMaterial);
    workbench.add(tabletop, backRail, blueprint, tools);
    return workbench;
  }

  _createRollWorkshopTools(frameMaterial) {
    const tools = new THREE.Group();
    tools.name = 'rollWorkshopTools';
    tools.position.y = WORKBENCH_HEIGHT + 0.025;
    const steel = new THREE.MeshStandardMaterial({
      color: 0xb7c2c5,
      roughness: 0.34,
      metalness: 0.72,
    });
    const handle = new THREE.MeshStandardMaterial({
      color: 0xe17620,
      roughness: 0.62,
      metalness: 0.08,
    });

    const wrench = new THREE.Group();
    wrench.name = 'rollWorkshopWrench';
    const wrenchBar = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.045, 0.075), steel);
    const wrenchRingGeometry = new THREE.TorusGeometry(0.085, 0.025, 6, 16);
    for (const x of [-0.31, 0.31]) {
      const ring = new THREE.Mesh(wrenchRingGeometry, steel);
      ring.position.x = x;
      ring.rotation.x = -Math.PI / 2;
      wrench.add(ring);
    }
    wrench.add(wrenchBar);
    wrench.position.set(0.54, 0, -0.16);
    wrench.rotation.y = -0.22;

    const screwdriver = new THREE.Group();
    screwdriver.name = 'rollWorkshopScrewdriver';
    const screwdriverHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 0.3, 10),
      handle,
    );
    screwdriverHandle.position.x = -0.17;
    screwdriverHandle.rotation.z = Math.PI / 2;
    const screwdriverShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.42, 8),
      steel,
    );
    screwdriverShaft.position.x = 0.18;
    screwdriverShaft.rotation.z = Math.PI / 2;
    screwdriver.add(screwdriverHandle, screwdriverShaft);
    screwdriver.position.set(0.55, 0.075, 0.16);
    screwdriver.rotation.y = 0.38;

    const hammer = new THREE.Group();
    hammer.name = 'rollWorkshopHammer';
    const hammerHandle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.045, 0.55), handle);
    const hammerHead = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.11, 0.14), frameMaterial);
    hammerHead.position.z = -0.29;
    hammer.add(hammerHandle, hammerHead);
    hammer.position.set(-0.78, 0.035, 0.13);
    hammer.rotation.y = -0.28;

    for (const tool of [wrench, screwdriver, hammer]) {
      tool.traverse((object) => {
        if (object.isMesh) object.castShadow = true;
      });
      tools.add(tool);
    }
    return tools;
  }

  _loadSupportCar(anchor) {
    anchor.userData.modelLoading = true;
    anchor.userData.textureLoading = true;
    anchor.userData.modelLoadAttempted = true;
    let cancelled = false;
    let modelAttached = false;

    const texture = this.textureLoader.load(
      SUPPORT_CAR_TEXTURE_PATH,
      () => {
        if (cancelled || !this._isAttachedToScene(anchor)) {
          texture.dispose();
          anchor.userData.textureLoading = false;
          anchor.userData.textureLoadCancelled = true;
          return;
        }
        anchor.userData.textureLoading = false;
        anchor.userData.textureLoaded = true;
        anchor.userData.textureWidth = texture.image?.width ?? null;
        anchor.userData.textureHeight = texture.image?.height ?? null;
      },
      undefined,
      (error) => {
        anchor.userData.textureLoading = false;
        if (cancelled || !this._isAttachedToScene(anchor)) {
          anchor.userData.textureLoadCancelled = true;
          return;
        }
        carMaterial.map = null;
        carMaterial.color.setHex(0xd85816);
        carMaterial.needsUpdate = true;
        texture.dispose();
        anchor.userData.textureLoadError = error?.message ?? String(error);
        console.error('Unable to load Support Car texture.', error);
      },
    );
    texture.name = 'texture_SupportCarDiffuse';
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapNearestFilter;
    texture.generateMipmaps = true;

    const carMaterial = new THREE.MeshStandardMaterial({
      name: 'material_SupportCarTextured',
      map: texture,
      color: 0xffffff,
      roughness: 0.58,
      metalness: 0.16,
      alphaTest: 0.5,
      transparent: false,
      depthWrite: true,
      side: THREE.FrontSide,
    });

    this.objLoader.load(
      SUPPORT_CAR_MODEL_PATH,
      (model) => {
        if (!this._isAttachedToScene(anchor)) {
          cancelled = true;
          this._disposeImportedModelResources(model);
          carMaterial.dispose();
          texture.dispose();
          anchor.userData.modelLoading = false;
          anchor.userData.modelLoadCancelled = true;
          return;
        }

        const sourceMaterials = new Set();
        model.name = 'supportCarModel';
        model.traverse((object) => {
          if (!object.isMesh) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (material) sourceMaterials.add(material);
          }
          object.name = object.name === 'Mesh' ? 'supportCarMesh' : object.name;
          object.material = carMaterial;
          object.castShadow = true;
          object.receiveShadow = true;
        });
        this._disposeMaterialResources(sourceMaterials);

        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const scale = size.y > 0.001 ? SUPPORT_CAR_HEIGHT / size.y : 1;
        model.scale.setScalar(scale);
        model.updateMatrixWorld(true);
        const scaledBounds = new THREE.Box3().setFromObject(model);
        const center = scaledBounds.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -scaledBounds.min.y, -center.z);
        anchor.add(model);
        modelAttached = true;

        const fallback = anchor.getObjectByName('supportCarFallback');
        if (fallback) {
          fallback.removeFromParent();
          this._disposeImportedModelResources(fallback);
        }
        anchor.userData.usingFallback = false;
        anchor.userData.modelLoading = false;
        anchor.userData.modelLoaded = true;
        anchor.userData.modelHeight = SUPPORT_CAR_HEIGHT;
        anchor.userData.modelScale = scale;
      },
      undefined,
      (error) => {
        cancelled = true;
        texture.dispose();
        if (!modelAttached) carMaterial.dispose();
        anchor.userData.modelLoading = false;
        anchor.userData.textureLoading = false;
        anchor.userData.textureLoaded = false;
        anchor.userData.textureLoadCancelled = true;
        anchor.userData.modelLoadError = error?.message ?? String(error);
        anchor.userData.usingFallback = true;
        console.warn('Unable to load Support Car model. Keeping the camp fallback.', error);
      },
    );
  }

  _loadRollWorkbenchTextures(workbench) {
    workbench.userData.textureLoading = true;
    workbench.userData.textureLoadErrors = {};
    const specs = [
      {
        key: 'surface',
        path: WORKBENCH_SURFACE_TEXTURE_PATH,
        material: workbench.userData.surfaceMaterial,
        configure: (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(2, 1);
        },
      },
      {
        key: 'blueprint',
        path: WORKBENCH_BLUEPRINT_TEXTURE_PATH,
        material: workbench.userData.blueprintMaterial,
        configure: () => {},
      },
    ];
    let remaining = specs.length;
    let cancelled = false;
    const settle = () => {
      remaining -= 1;
      if (remaining > 0) return;
      workbench.userData.textureLoading = false;
      workbench.userData.textureAssetsSettled = true;
      workbench.userData.textureLoaded = !cancelled
        && Object.keys(workbench.userData.textureLoadErrors).length === 0;
      if (cancelled) workbench.userData.textureLoadCancelled = true;
    };

    for (const spec of specs) {
      const texture = this.textureLoader.load(
        spec.path,
        () => {
          if (!this._isAttachedToScene(workbench)) {
            cancelled = true;
            texture.dispose();
            settle();
            return;
          }
          workbench.userData[`${spec.key}TextureLoaded`] = true;
          workbench.userData[`${spec.key}TextureWidth`] = texture.image?.width ?? null;
          workbench.userData[`${spec.key}TextureHeight`] = texture.image?.height ?? null;
          settle();
        },
        undefined,
        (error) => {
          if (!this._isAttachedToScene(workbench)) {
            cancelled = true;
          } else {
            workbench.userData.textureLoadErrors[spec.key] = error?.message ?? String(error);
            console.error(`Unable to load Roll workbench ${spec.key} texture.`, error);
          }
          if (spec.material?.map === texture) spec.material.map = null;
          spec.material.needsUpdate = true;
          texture.dispose();
          settle();
        },
      );
      texture.name = `texture_RollWorkbench_${spec.key}`;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      spec.configure(texture);
      spec.material.color.set(0xffffff);
      spec.material.map = texture;
      spec.material.needsUpdate = true;
    }
  }

  _loadRollNpc(anchor, npcAnimationMixers, npcAnimators) {
    anchor.userData.modelLoading = true;
    anchor.userData.textureLoading = true;
    let cancelled = false;
    const texture = this.textureLoader.load(
      ROLL_TEXTURE_PATH,
      () => {
        if (cancelled || !this._isAttachedToScene(anchor)) {
          texture.dispose();
          anchor.userData.textureLoading = false;
          anchor.userData.textureLoadCancelled = true;
          return;
        }
        anchor.userData.textureLoading = false;
        anchor.userData.textureLoaded = true;
      },
      undefined,
      (error) => {
        if (cancelled || !this._isAttachedToScene(anchor)) {
          anchor.userData.textureLoading = false;
          anchor.userData.textureLoadCancelled = true;
          return;
        }
        anchor.userData.textureLoading = false;
        anchor.userData.textureLoadError = error?.message ?? String(error);
        console.error('Unable to load Roll NPC texture.', error);
      },
    );
    texture.colorSpace = THREE.SRGBColorSpace;

    this.fbxLoader.load(
      ROLL_MODEL_PATH,
      (model) => {
        let root = anchor;
        while (root.parent) root = root.parent;
        if (!root.isScene) {
          cancelled = true;
          this._disposeImportedModelResources(model);
          texture.dispose();
          anchor.userData.modelLoading = false;
          anchor.userData.modelLoadCancelled = true;
          return;
        }

        model.name = 'rollCaskettModel';
        const displacedMaps = new Set();
        model.traverse((object) => {
          if (!object.isMesh && !object.isSkinnedMesh) return;

          const sourceMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          const materials = sourceMaterials.map((sourceMaterial) => {
            const material = sourceMaterial ?? new THREE.MeshStandardMaterial();
            if (material.map && material.map !== texture) displacedMaps.add(material.map);
            material.map = texture;
            material.transparent = false;
            material.opacity = 1;
            material.alphaTest = 0;
            material.needsUpdate = true;
            return material;
          });
          object.material = Array.isArray(object.material) ? materials : materials[0];
          object.castShadow = true;
          object.receiveShadow = true;
        });
        for (const displacedMap of displacedMaps) displacedMap.dispose?.();

        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const scale = size.y > 0.001 ? ROLL_HEIGHT / size.y : 0.01;
        model.scale.setScalar(scale);
        model.updateMatrixWorld(true);

        const scaledBounds = new THREE.Box3().setFromObject(model);
        const center = scaledBounds.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -scaledBounds.min.y, -center.z);
        anchor.userData.targetModelHeight = ROLL_HEIGHT;
        anchor.add(model);

        const animator = new RollNpcAnimator(model, anchor);
        anchor.userData.rollAnimator = animator;
        anchor.userData.animationMixer = animator.mixer;
        anchor.userData.animationLoadErrors = {};
        npcAnimationMixers.push(animator.mixer);
        npcAnimators.push(animator);
        if (anchor.userData.pendingInteractionAnimation) {
          anchor.userData.pendingInteractionAnimation = false;
          animator.noteInteraction();
        }
        this._loadRollAnimations(anchor, animator);
        anchor.userData.modelLoading = false;
        anchor.userData.modelLoaded = true;
      },
      undefined,
      (error) => {
        cancelled = true;
        texture.dispose();
        anchor.userData.modelLoading = false;
        anchor.userData.textureLoading = false;
        anchor.userData.textureLoaded = false;
        anchor.userData.textureLoadCancelled = true;
        anchor.userData.modelLoadError = error?.message ?? String(error);
        console.error('Unable to load Roll NPC model.', error);
      },
    );
  }

  _loadRollAnimations(anchor, animator) {
    const pendingEntries = Object.entries(ROLL_ANIMATION_FILES);
    let nextEntryIndex = 0;
    const loadNext = async () => {
      while (nextEntryIndex < pendingEntries.length) {
        const [name, filename] = pendingEntries[nextEntryIndex];
        nextEntryIndex += 1;
        try {
          const clip = await this._loadRollAnimationClip(
            name,
            `${ROLL_ANIMATION_BASE_PATH}${filename}`,
          );
          if (!this._isAttachedToScene(anchor) || animator.disposed) return false;
          animator.registerClip(name, clip);
        } catch (error) {
          if (!this._isAttachedToScene(anchor)) return false;
          anchor.userData.animationLoadErrors[name] = error?.message ?? String(error);
          console.error(`Unable to load Roll ${name} animation.`, error);
        }
      }
      return true;
    };
    const jobs = Array.from(
      { length: Math.min(ROLL_ANIMATION_LOAD_CONCURRENCY, pendingEntries.length) },
      () => loadNext(),
    );

    Promise.all(jobs).then(() => {
      if (!this._isAttachedToScene(anchor)) {
        animator.dispose();
        anchor.userData.animationLoadCancelled = true;
        return;
      }

      animator.settleAssets();
      const required = ['idle', 'explaining', 'thinking'];
      anchor.userData.animationLibraryReady = required.every((name) => animator.actions.has(name));
    });
  }

  _loadRollAnimationClip(name, path) {
    const cached = ROLL_ANIMATION_CLIP_PROMISES.get(path);
    if (cached) return cached;

    const promise = new Promise((resolve, reject) => {
      this.fbxLoader.load(
        path,
        (sourceModel) => {
          const sourceClip = sourceModel.animations.find((clip) => (
            clip.duration > 0 && clip.tracks.length > 0
          ));
          const clip = sourceClip?.clone?.() ?? null;
          this._disposeImportedModelResources(sourceModel);
          if (!clip) {
            reject(new Error(`${name} FBX did not contain a usable animation clip.`));
            return;
          }
          clip.name = `roll_${name}`;
          resolve(clip);
        },
        undefined,
        reject,
      );
    }).catch((error) => {
      if (ROLL_ANIMATION_CLIP_PROMISES.get(path) === promise) {
        ROLL_ANIMATION_CLIP_PROMISES.delete(path);
      }
      throw error;
    });
    ROLL_ANIMATION_CLIP_PROMISES.set(path, promise);
    return promise;
  }

  _isAttachedToScene(object) {
    let root = object;
    while (root?.parent) root = root.parent;
    return root?.isScene === true;
  }

  _disposeMaterialResources(materials) {
    const materialSet = new Set();
    const textures = new Set();
    for (const material of materials ?? []) {
      if (!material) continue;
      materialSet.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
    for (const material of materialSet) material.dispose?.();
    for (const texture of textures) texture.dispose?.();
  }

  _disposeImportedModelResources(model) {
    const geometries = new Set();
    const materials = new Set();
    const skeletonTextures = new Set();
    model?.traverse?.((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) {
        if (material) materials.add(material);
      }
      if (object.skeleton?.boneTexture?.isTexture) {
        skeletonTextures.add(object.skeleton.boneTexture);
      }
    });
    for (const geometry of geometries) geometry.dispose?.();
    this._disposeMaterialResources(materials);
    for (const texture of skeletonTextures) texture.dispose?.();
  }

  _addKeycardMarker(group, position, materials) {
    const marker = new THREE.Group();
    marker.name = 'keycardPickupPlaceholder';
    marker.position.set(position.x, position.y + 0.42, position.z);

    const card = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.62), materials.glowYellow);
    card.name = 'floatingKeycard';
    card.rotation.y = Math.PI * 0.18;

    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.68, 12), materials.wallTrim);
    post.name = 'keycardPedestal';
    post.position.y = -0.32;

    marker.add(post, card);
    group.add(marker);
    return marker;
  }

  _addKeycardProtectionBarrier(group, position) {
    const barrier = new THREE.Group();
    barrier.name = 'keycardEncounterProtectionBarrier';
    barrier.position.set(position.x, position.y, position.z);

    const shellMaterial = new THREE.MeshBasicMaterial({
      color: 0x46dfff,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.92, 0.92, 2.35, 36, 1, true),
      shellMaterial,
    );
    shell.name = 'keycardBarrierCyanCylinder';
    shell.position.y = 1.18;

    const ringMaterial = shellMaterial.clone();
    ringMaterial.opacity = 0.72;
    for (const y of [0.08, 2.28]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.045, 8, 36), ringMaterial.clone());
      ring.name = 'keycardBarrierEnergyRing';
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      barrier.add(ring);
    }

    barrier.userData.shellMaterial = shellMaterial;
    barrier.add(shell);
    group.add(barrier);
    return barrier;
  }

  _addKeySeekerInteractable(group, position, materials) {
    const seeker = new THREE.Group();
    seeker.name = 'keySeekerInteractable';
    seeker.position.copy(position);

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.48, 0.46, 18), materials.wallTrim);
    pedestal.name = 'keySeekerPedestal';
    pedestal.position.y = 0.23;
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;

    const scanner = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.14, 0.48), materials.terminal ?? materials.wallTrim);
    scanner.name = 'keySeekerScannerPlate';
    scanner.position.y = 0.58;
    scanner.rotation.x = -0.26;
    scanner.castShadow = true;

    const lens = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), materials.glowGreen);
    lens.name = 'keySeekerSignalLens';
    lens.position.y = 0.88;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.52, 28),
      new THREE.MeshBasicMaterial({
        color: 0x5ee77b,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.name = 'keySeekerSignalRing';
    ring.position.y = 0.08;
    ring.rotation.x = -Math.PI / 2;

    seeker.add(pedestal, scanner, lens, ring);
    group.add(seeker);
    return seeker;
  }

  _addMechanismTerminal(group, position, materials) {
    const terminal = new THREE.Group();
    terminal.name = 'ruinMechanismTerminal';
    terminal.position.set(position.x, position.y, position.z - 1.1);

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.72, 0.48), materials.terminal ?? materials.wallTrim);
    base.name = 'mechanismTerminalBase';
    base.position.y = 0.36;
    base.castShadow = true;
    base.receiveShadow = true;

    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.3), materials.glowBlue);
    screen.name = 'mechanismTerminalScreen';
    screen.position.set(0, 0.76, -0.18);
    screen.rotation.x = -0.42;

    const node = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), materials.glowYellow);
    node.name = 'mechanismTerminalCore';
    node.position.set(0, 1.08, 0);

    terminal.add(base, screen, node);
    group.add(terminal);
    return terminal;
  }

  _addPuzzleBlock(group, position, materials) {
    const block = new THREE.Group();
    block.name = 'conveyorRelayBlock';
    block.position.copy(position);

    const shellMaterial = materials.wallTrim.clone();
    shellMaterial.color.setHex(0x54646f);
    shellMaterial.emissive.setHex(0x07141d);
    shellMaterial.emissiveIntensity = 0.18;

    const coreMaterial = materials.glowBlue.clone();
    coreMaterial.emissiveIntensity = 0.9;

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.72, 0.92), shellMaterial);
    body.name = 'relayBlockBody';
    body.position.y = 0.36;
    body.castShadow = true;
    body.receiveShadow = true;

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), coreMaterial);
    core.name = 'relayBlockPowerCore';
    core.position.y = 0.82;
    core.castShadow = true;

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.08, 0.18), materials.glowYellow.clone());
    stripe.name = 'relayBlockDirectionStripe';
    stripe.position.set(0, 0.55, -0.47);

    block.add(body, core, stripe);
    group.add(block);
    return block;
  }

  _addConveyorCargoObject(group, position, materials) {
    const cargo = new THREE.Group();
    cargo.name = 'conveyorPuzzleCargoObject';
    cargo.position.copy(position);

    const shellMaterial = materials.wallTrim.clone();
    shellMaterial.color.setHex(0x405766);
    shellMaterial.emissive.setHex(0x081f2a);
    shellMaterial.emissiveIntensity = 0.22;

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.72, 0.88), shellMaterial);
    body.name = 'conveyorCargoBody';
    body.position.y = 0.42;
    body.castShadow = true;
    body.receiveShadow = true;

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), materials.glowBlue.clone());
    core.name = 'conveyorCargoRefractorCore';
    core.position.y = 0.92;
    core.castShadow = true;

    const routeStripe = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.08, 0.16), materials.glowYellow.clone());
    routeStripe.name = 'conveyorCargoRouteStripe';
    routeStripe.position.set(0, 0.64, -0.45);

    cargo.add(body, core, routeStripe);
    group.add(cargo);
    return cargo;
  }

  _addConveyorCargoSpawner(group, position, materials) {
    const spawner = new THREE.Group();
    spawner.name = 'conveyorCargoSpawner';
    spawner.position.copy(position);

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.9, 0.12, 32), materials.wallTrim.clone());
    pad.name = 'conveyorCargoSpawnerPad';
    pad.position.y = 0.06;
    pad.receiveShadow = true;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.68, 0.94, 40),
      new THREE.MeshBasicMaterial({
        color: 0x6bdcff,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.name = 'conveyorCargoSpawnerRing';
    ring.position.y = 0.14;
    ring.rotation.x = -Math.PI / 2;

    spawner.add(pad, ring);
    group.add(spawner);
    return spawner;
  }

  _addPressurePlate(group, position, materials) {
    const plate = new THREE.Group();
    plate.name = 'conveyorVaultPressurePlate';
    plate.position.copy(position);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.98, 0.1, 32), materials.wallTrim.clone());
    base.name = 'pressurePlateBase';
    base.position.y = 0.05;
    base.receiveShadow = true;

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x6bdcff,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.82, 40), ringMaterial);
    ring.name = 'pressurePlatePowerRing';
    ring.position.y = 0.12;
    ring.rotation.x = -Math.PI / 2;

    const glyph = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.72), materials.glowYellow.clone());
    glyph.name = 'pressurePlatePowerGlyph';
    glyph.position.y = 0.15;

    plate.add(base, ring, glyph);
    group.add(plate);
    return plate;
  }

  _addTreasureChest(group, position, materials, index = 0) {
    const chest = new THREE.Group();
    chest.name = `ruinTreasureChest_${index + 1}`;
    chest.position.set(position.x, position.y, position.z);

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.42, 0.64), materials.floorByType.chest);
    base.name = 'ruinChestBase';
    base.position.y = 0.24;
    base.castShadow = true;
    base.receiveShadow = true;

    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.22, 0.68), materials.floorByType.chest);
    lid.name = 'ruinChestLid';
    lid.position.set(0, 0.58, -0.02);
    lid.castShadow = true;
    lid.receiveShadow = true;

    const band = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.08, 0.72), materials.chestTrim);
    band.name = 'ruinChestTrim';
    band.position.y = 0.61;
    band.castShadow = true;

    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.08), materials.glowYellow);
    lock.name = 'ruinChestLock';
    lock.position.set(0, 0.49, -0.36);
    lock.castShadow = true;

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.82, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffd66b,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    glow.name = 'ruinChestGlow';
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;

    chest.add(base, lid, band, lock, glow);
    group.add(chest);
    return chest;
  }

  _addLargeRefractorShrine(group, position, materials) {
    const shrine = new THREE.Group();
    shrine.name = 'largeRefractorShrine';
    shrine.position.copy(position);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.55, 0.42, 36), materials.wallTrim);
    base.name = 'largeRefractorBase';
    base.position.y = 0.21;
    base.castShadow = true;
    base.receiveShadow = true;

    const refractor = new THREE.Mesh(new THREE.OctahedronGeometry(0.82, 0), materials.largeRefractor);
    refractor.name = 'largeRefractorObjective';
    refractor.position.y = 1.42;
    refractor.scale.y = 1.65;
    refractor.castShadow = true;

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.7, 48),
      new THREE.MeshBasicMaterial({
        color: 0x7df8ff,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    glow.name = 'largeRefractorShrineGlow';
    glow.position.y = 0.06;
    glow.rotation.x = -Math.PI / 2;

    const extractionPad = new THREE.Group();
    extractionPad.name = 'largeRefractorExtractionPad';
    extractionPad.visible = false;

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.22, 0.1, 32), materials.glowBlue.clone());
    pad.name = 'largeRefractorExtractionPadCore';
    pad.position.y = 0.08;
    pad.receiveShadow = true;

    const padRing = new THREE.Mesh(
      new THREE.RingGeometry(1.28, 1.62, 48),
      new THREE.MeshBasicMaterial({
        color: 0x6bdcff,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    padRing.name = 'largeRefractorExtractionPadRing';
    padRing.position.y = 0.16;
    padRing.rotation.x = -Math.PI / 2;

    extractionPad.add(pad, padRing);
    shrine.add(base, refractor, glow, extractionPad);
    group.add(shrine);
    return shrine;
  }

  _addTrapEmitters(group, position, materials) {
    const emitters = new THREE.Group();
    emitters.name = 'trapEmitterGroup';
    emitters.position.copy(position);
    const beamMaterial = materials.glowRed.clone();
    beamMaterial.transparent = true;
    beamMaterial.opacity = 0.72;

    for (const offset of [-1.15, 1.15]) {
      const emitter = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.58, 0.34), materials.glowRed.clone());
      emitter.name = 'trapLaserEmitter';
      emitter.position.set(offset, 0.29, 0);
      emitter.castShadow = true;
      emitters.add(emitter);
    }

    for (const y of [0.36, 0.62, 0.88]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.055, 0.08), beamMaterial.clone());
      beam.name = 'trapLaserBeam';
      beam.position.set(0, y, 0);
      beam.castShadow = false;
      emitters.add(beam);
    }

    group.add(emitters);
    return emitters;
  }

  _roomSpawnPoints(room, floorSource = null, solidZones = []) {
    if (Array.isArray(floorSource)) {
      const roomBaseElevation = Number(room.baseElevation ?? 0);
      const surfacePreferences = {
        server: ['serverCoreFloor', 'serverUpperCatwalk', 'catwalk'],
        machine: ['machinePressZone', 'machineAssemblyConveyor', 'machineCrossBridge', 'machineUpperCatwalk'],
        coolant: ['coolantValveDeck', 'coolantServicePit', 'coolantControlBalcony', 'coolantPipeBridge'],
        enemy: ['enemy', 'secondFloor', 'catwalk', 'raisedDeck'],
        keycard: ['mechanicalPyramidProcessionalStep', 'mechanicalPyramidTerrace', 'mechanicalPyramidSummit', 'keycard'],
        trap: ['basementFloor', 'industrialRamp'],
        conveyor: ['conveyor', 'conveyorPuzzleBelt', 'conveyorBridge', 'secondFloorConveyor', 'thirdFloorGantry'],
        boss: ['boss', 'raisedDeck', 'catwalk', 'thirdFloorGantry'],
        shrine: ['refractorDais', 'shrineSanctumFloor', 'reveredMezzanine', 'shrine'],
        bonus: ['vaultRewardDais', 'vaultSanctumFloor'],
      }[room.type] ?? [];
      const blockingPlatforms = this._createBlockingPlatformColumnMap(floorSource);
      const navigableFloorTiles = floorSource.filter((tile) => (
        !this._isFloorTileBlockedByGeneratedPlatform(tile, blockingPlatforms)
        && !this._isFloorTileBlockedBySolidZone(tile, solidZones)
      ));
      const allRoomTiles = (
        room.isDungeonSupplement
          ? navigableFloorTiles.filter((tile) => tile.roomId === room.id)
          : this._getRoomFloorTiles(room, navigableFloorTiles)
      )
        .filter((tile) => !['hub', 'camp', 'entrance'].includes(tile.type));
      const startTile = this._findRoomWalkabilityStartTile(room, allRoomTiles);
      const reachable = this._createReachableFloorTileKeySet(startTile, navigableFloorTiles);
      const reachableCandidates = allRoomTiles
        .filter((tile) => reachable.has(this._getFloorTileGraphKey(tile)))
        .filter((tile) => tile.surface !== 'industrialRamp' && tile.surface !== 'jumpPlatform');
      const halfRoomWidth = Math.max(1, Math.floor(room.width / 2));
      const halfRoomDepth = Math.max(1, Math.floor(room.depth / 2));
      // Do not use the outer two-tile corner wedges. The previous farthest-
      // first ordering made these exact corners the default encounter layout.
      const candidates = room.isDungeonSupplement ? reachableCandidates : reachableCandidates.filter((tile) => {
        const xEdgeInset = halfRoomWidth - Math.abs(tile.x - room.x);
        const zEdgeInset = halfRoomDepth - Math.abs(tile.z - room.z);
        return !(xEdgeInset <= 1 && zEdgeInset <= 1);
      });
      if (room.type === 'keycard') {
        const summitY = roomBaseElevation
          + Number(room.mechanicalPyramidCenter?.elevation ?? 4);
        const upperRing = candidates.filter((tile) => (
          ['mechanicalPyramidTerrace', 'mechanicalPyramidProcessionalStep'].includes(tile.surface)
          && (tile.elevation ?? 0) >= summitY - 1.5
          && (tile.elevation ?? 0) <= summitY - 0.45
          && Math.hypot(tile.x - room.x, tile.z - room.z) >= 2
        ));
        if (upperRing.length >= 6) {
          const chosenUpperTiles = [];
          const usedUpperTiles = new Set();
          for (let index = 0; index < 6; index += 1) {
            const targetAngle = -Math.PI * 0.5 + index * (Math.PI * 2 / 6);
            const score = (tile) => {
              const angle = Math.atan2(tile.z - room.z, tile.x - room.x);
              const angleDelta = Math.abs(Math.atan2(
                Math.sin(angle - targetAngle),
                Math.cos(angle - targetAngle),
              ));
              const radiusPenalty = Math.abs(
                Math.hypot(tile.x - room.x, tile.z - room.z) - 3,
              ) * 0.12;
              return angleDelta + radiusPenalty;
            };
            const candidate = upperRing
              .filter((tile) => !usedUpperTiles.has(`${tile.x},${tile.z}`))
              .sort((left, right) => score(left) - score(right))[0];
            if (candidate) {
              usedUpperTiles.add(`${candidate.x},${candidate.z}`);
              chosenUpperTiles.push(candidate);
            }
          }
          if (chosenUpperTiles.length === 6) {
            return chosenUpperTiles.map((tile) => this._floorTileToWorld(tile));
          }
        }
      }
      const surfaceRank = new Map(surfacePreferences.map((surface, index) => [surface, index]));
      const chosen = [];
      const chosenTiles = [];
      const used = new Set();

      candidates.sort((a, b) => {
        const rankA = surfaceRank.has(a.surface) ? surfaceRank.get(a.surface) : surfacePreferences.length;
        const rankB = surfaceRank.has(b.surface) ? surfaceRank.get(b.surface) : surfacePreferences.length;
        if (rankA !== rankB) {
          return rankA - rankB;
        }

        const normalizedRadiusA = Math.hypot(
          (a.x - room.x) / halfRoomWidth,
          (a.z - room.z) / halfRoomDepth,
        );
        const normalizedRadiusB = Math.hypot(
          (b.x - room.x) / halfRoomWidth,
          (b.z - room.z) / halfRoomDepth,
        );
        // Favor a readable interior ring instead of stacking every unit on the
        // exact center or pushing all of them against the room boundary.
        return Math.abs(normalizedRadiusA - 0.46) - Math.abs(normalizedRadiusB - 0.46);
      });

      const chooseFrom = (pool, limit) => {
        const tryChoose = (respectSpacing) => {
          for (const tile of pool) {
            if (chosen.length >= limit) {
              break;
            }
            const key = floorTileKey(tile.x, tile.z, tile.level ?? 0);
            if (used.has(key)) {
              continue;
            }
            if (respectSpacing && chosenTiles.some((entry) => (
              Math.abs((entry.elevation ?? 0) - (tile.elevation ?? 0)) < 0.8
              && Math.hypot(entry.x - tile.x, entry.z - tile.z) < 1.8
            ))) {
              continue;
            }

            used.add(key);
            chosenTiles.push(tile);
            chosen.push(this._floorTileToWorld(tile));
          }
        };

        tryChoose(true);
        if (chosen.length < limit) {
          tryChoose(false);
        }
      };
      const groundCandidates = candidates.filter((tile) => (
        Math.abs((tile.elevation ?? roomBaseElevation) - roomBaseElevation) <= 0.6
      ));
      const elevatedCandidates = candidates.filter((tile) => (
        (tile.elevation ?? roomBaseElevation) > roomBaseElevation + 0.6
      ));
      chooseFrom(groundCandidates, 3);
      chooseFrom(elevatedCandidates, Math.min(5, chosen.length + 2));
      chooseFrom(candidates, 6);

      if (chosen.length) {
        return chosen;
      }
    }

    const points = [];
    const tiles = floorSource;
    const offsets = [
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-2, 0],
      [2, 0],
    ];

    for (const [dx, dz] of offsets) {
      const point = this._tileToWorld(room.x + dx, room.z + dz, tiles);
      if (!tiles?.get?.(tileKey(room.x + dx, room.z + dz))) {
        point.y = Number(room.baseElevation ?? 0);
      }
      points.push(point);
    }

    return points;
  }

  _tileToWorld(x, z, tiles = null) {
    const tile = tiles?.get?.(tileKey(x, z));
    return new THREE.Vector3(x * this.tileSize, tile?.elevation ?? 0, z * this.tileSize);
  }

  _getWorldElevationAt(position, tiles = null) {
    const x = Math.round(position.x / this.tileSize);
    const z = Math.round(position.z / this.tileSize);
    return tiles?.get?.(tileKey(x, z))?.elevation ?? 0;
  }

  _createOpenAirTileKeys(rooms) {
    const openAirTileKeys = new Set();
    const openAirRooms = rooms.filter((room) => RUIN_OPEN_AIR_ROOM_TYPES.has(room.type));

    for (const room of openAirRooms) {
      const halfW = Math.floor(room.width / 2);
      const halfD = Math.floor(room.depth / 2);

      for (let x = room.x - halfW; x <= room.x + halfW; x += 1) {
        for (let z = room.z - halfD; z <= room.z + halfD; z += 1) {
          openAirTileKeys.add(tileKey(x, z));
        }
      }
    }

    for (let i = 1; i < openAirRooms.length; i += 1) {
      const from = openAirRooms[i - 1];
      const to = openAirRooms[i];

      for (const x of rangeBetween(from.x, to.x)) {
        openAirTileKeys.add(tileKey(x, from.z));
      }

      for (const z of rangeBetween(from.z, to.z)) {
        openAirTileKeys.add(tileKey(to.x, z));
      }
    }

    return openAirTileKeys;
  }

  _createRoomZones(rooms, type) {
    return rooms
      .filter((room) => room.type === type)
      .map((room) => ({
        id: `${room.id}Zone`,
        roomId: room.id,
        position: new THREE.Vector3(
          room.x * this.tileSize,
          Number(room.baseElevation ?? 0),
          room.z * this.tileSize,
        ),
        halfWidth: (Math.floor(room.width / 2) + 0.5) * this.tileSize,
        halfDepth: (Math.floor(room.depth / 2) + 0.5) * this.tileSize,
        active: true,
      }));
  }

  _createSolidCollisionZones(rooms) {
    const zones = [];
    const addZone = (room, id, localX, localZ, halfWidth, halfDepth, options = {}) => {
      const rotationY = room.prefabYaw ?? 0;
      const position = this._roomLocalToWorld(room, localX, localZ, options.elevation ?? 0);
      zones.push({
        id,
        roomId: room.id,
        label: options.label ?? 'Industrial obstacle',
        position,
        halfWidth,
        halfDepth,
        verticalHalfHeight: options.verticalHalfHeight ?? 2.2,
        rotationY,
      });
    };

    for (const room of rooms) {
      const halfW = Math.max(1.1, Math.floor(room.width / 2) * this.tileSize - 0.7);
      const halfD = Math.max(1.1, Math.floor(room.depth / 2) * this.tileSize - 0.7);

      if (room.id === 'alienServerRoom') {
        const serverXs = [-halfW * 0.42, -halfW * 0.24, halfW * 0.24, halfW * 0.42];
        const serverZs = [-halfD * 0.46, -halfD * 0.16, halfD * 0.16, halfD * 0.46];

        for (const x of serverXs) {
          for (const z of serverZs) {
            addZone(room, `alienServerRack_${x.toFixed(2)}_${z.toFixed(2)}`, x, z, 0.58, 0.52, {
              label: 'Server monolith',
            });
          }
        }
        addZone(room, 'alienServerCentralCore', 0, 0, 1.18, 1.18, {
          label: 'Server energy core',
          verticalHalfHeight: 3.0,
        });
        addZone(room, 'alienServerEntryConsole', 0, halfD * 0.72, 0.78, 0.42, {
          label: 'Server entry console',
        });
      } else if (room.id === 'machineFactoryRoom') {
        const sideBeltX = halfW * 0.68;
        const pressZs = [-halfD * 0.34, 0, halfD * 0.34];

        for (const z of pressZs) {
          // The press housing and plate are overhead decoration. Projecting
          // their full footprint down to the floor creates an invisible wall
          // through access ramps that legitimately pass beneath the press.
          // Only the two visible support legs should block grounded movement.
          for (const [side, localX] of [
            ['left', -MACHINE_PRESS_LEG_OFFSET_X],
            ['right', MACHINE_PRESS_LEG_OFFSET_X],
          ]) {
            addZone(
              room,
              `machinePress_${z.toFixed(2)}_${side}Leg`,
              localX,
              z,
              MACHINE_PRESS_LEG_WIDTH * 0.5 + MACHINE_PRESS_LEG_COLLISION_PADDING,
              MACHINE_PRESS_LEG_DEPTH * 0.5 + MACHINE_PRESS_LEG_COLLISION_PADDING,
              {
                label: 'Machine press support leg',
                elevation: MACHINE_PRESS_LEG_HEIGHT * 0.5,
                verticalHalfHeight: MACHINE_PRESS_LEG_HEIGHT * 0.5,
              },
            );
          }
        }

        for (const x of [-sideBeltX - 1.5, -sideBeltX + 1.5, sideBeltX - 1.5, sideBeltX + 1.5]) {
          for (const z of [-halfD * 0.38, halfD * 0.38]) {
            addZone(room, `machineRobotArm_${x.toFixed(2)}_${z.toFixed(2)}`, x, z, 0.74, 0.6, {
              label: 'Robot arm base',
            });
          }
        }

        for (const [x, z] of [
          [-halfW * 0.72, -halfD * 0.66],
          [-halfW * 0.52, -halfD * 0.66],
          [halfW * 0.52, -halfD * 0.66],
          [halfW * 0.72, -halfD * 0.66],
        ]) {
          addZone(room, `machineProcessTank_${x.toFixed(2)}`, x, z, 0.48, 0.48, {
            label: 'Process tank',
          });
        }
        addZone(room, 'machineEntryConsole', 0, halfD * 0.78, 0.78, 0.46, {
          label: 'Machine control console',
        });
      } else if (room.id === 'coolantRelayRoom') {
        for (const spec of this._getCoolantFixtureSpecs(room)) {
          addZone(room, spec.id, spec.localX, spec.localZ, spec.halfWidth, spec.halfDepth, {
            label: spec.label,
            elevation: spec.elevation,
            verticalHalfHeight: spec.verticalHalfHeight,
          });
        }
      }
    }

    return zones;
  }

  _createDungeonSupplementManifestSolidZones(rooms = []) {
    return rooms.flatMap((room) => (room.augmentationCollisionRecords ?? [])
      .filter((record) => (
        record?.blocking === true
        && record.center
        && Number(record.size?.x) > 0
        && Number(record.size?.y) > 0
        && Number(record.size?.z) > 0
      ))
      .map((record) => {
        const sizeY = Number(record.size.y);
        return {
          id: String(record.id),
          roomId: room.id,
          operationId: room.augmentationOperationId ?? record.operationId ?? null,
          label: record.label ?? 'Industrial supplement cover',
          obstacleKind: record.collisionKind ?? 'supplement-authored-cover',
          position: new THREE.Vector3(
            Number(record.center.x),
            Number(record.center.y) + sizeY * 0.5,
            Number(record.center.z),
          ),
          halfWidth: Number(record.size.x) * 0.5,
          halfDepth: Number(record.size.z) * 0.5,
          verticalHalfHeight: sizeY * 0.5,
          rotationY: Number(record.rotationY ?? 0),
          allowFlyOver: false,
          dungeonSupplement: true,
          isDungeonSupplement: true,
          manifestCollisionRecordId: String(record.id),
          moduleManifestId: record.moduleManifestId ?? null,
          absoluteRoomElevationCommitted: true,
        };
      }));
  }

  _roomLocalToWorld(room, localX, localZ, elevation = 0) {
    const rotationY = room.prefabYaw ?? 0;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const baseElevation = Number(room?.baseElevation ?? room?.floorElevation ?? 0);
    return new THREE.Vector3(
      room.x * this.tileSize + localX * cos - localZ * sin,
      baseElevation + elevation,
      room.z * this.tileSize + localX * sin + localZ * cos,
    );
  }

  _createTrapZones(rooms, floorTiles, trapVisualsByRoom = new Map()) {
    return rooms
      .filter((room) => room.type === 'trap')
      .map((room) => {
        const trapTile = this._findRoomFloorTile(room, floorTiles, ['basementFloor'])
          ?? { x: room.x, z: room.z, elevation: Number(room.baseElevation ?? 0) };
        const position = this._floorTileToWorld(trapTile);
        const flavorHazardCount = room.flavorEffects?.hazards?.length ?? 0;
        const hazardMultiplier = 1 + Math.min(0.35, flavorHazardCount * 0.08);

        return {
          id: `${room.id}Zone`,
          roomId: room.id,
          position,
          halfWidth: (Math.floor(room.width / 2) + 0.5) * this.tileSize,
          halfDepth: (Math.floor(room.depth / 2) + 0.5) * this.tileSize,
          active: true,
          label: 'Timed Laser Grid',
          verticalHalfHeight: 1.35,
          object: trapVisualsByRoom.get(room.id) ?? null,
          flavorId: room.flavorId,
          ambientHazardTags: room.hazardZones ?? [],
          damagePerPulse: 5 * hazardMultiplier,
          damagePerSecond: 18 * hazardMultiplier,
          pulseInterval: 1.45 + this.random() * 0.35,
          activeDuration: 0.34 + this.random() * 0.08,
          telegraphDuration: 0.42,
          phaseOffset: this.random() * 0.8,
        };
      });
  }

  _createConveyorTileZones(floorTiles) {
    return [...floorTiles.values()]
      .filter((tile) => tile.type === 'conveyor')
      .map((tile) => {
        const direction = new THREE.Vector3(
          tile.conveyorDirectionX ?? 0,
          0,
          tile.conveyorDirectionZ ?? 1,
        );

        if (direction.lengthSq() <= 0.0001) {
          direction.set(0, 0, 1);
        }

        return {
          id: `conveyorTile_${tile.x}_${tile.z}_${tile.level ?? 0}`,
          tileX: tile.x,
          tileZ: tile.z,
          position: new THREE.Vector3(
            tile.x * this.tileSize,
            tile.elevation ?? 0,
            tile.z * this.tileSize,
          ),
          halfWidth: this.tileSize * 0.5,
          halfDepth: this.tileSize * 0.5,
          verticalHalfHeight: 0.8,
          elevation: tile.elevation ?? 0,
          level: tile.level ?? 0,
          direction: direction.normalize(),
          speed: tile.conveyorSpeed ?? 2.4,
          active: tile.conveyorActive !== false,
          conveyorPuzzleId: tile.conveyorPuzzleId ?? null,
          conveyorGroupId: tile.conveyorGroupId ?? null,
          conveyorNodeId: tile.conveyorNodeId ?? null,
          conveyorTileType: tile.conveyorTileType ?? null,
          label: 'Conveyor Belt',
        };
      });
  }

  _createEncounterDefinitions(rooms, tiles = null, solidZones = []) {
    const encounterRooms = [
      {
        roomId: 'alienServerRoom',
        id: 'alienServerDefense',
        label: 'Server Room Defense',
        roster: this._createEncounterRoster('server'),
      },
      {
        roomId: 'machineFactoryRoom',
        id: 'machineFactoryDefense',
        label: 'Machine Factory Defense',
        roster: this._createEncounterRoster('machine'),
      },
      {
        roomId: 'coolantRelayRoom',
        id: 'coolantRelayDefense',
        label: 'Coolant Relay Defense',
        roster: this._createEncounterRoster('coolant'),
      },
      {
        roomId: 'enemyNest',
        id: 'enemyNest',
        label: 'Reaverbot Nest',
        roster: this._createEncounterRoster('nest'),
        gateDoorId: 'enemyNestGate',
      },
      {
        roomId: 'keycardRoom',
        id: 'keycardGuard',
        label: 'Keycard Guard',
        roster: this._createEncounterRoster('keycard'),
      },
      {
        roomId: 'trapRoom',
        id: 'trapAmbush',
        label: 'Trap Ambush',
        roster: this._createEncounterRoster('trap'),
      },
      {
        roomId: 'conveyorRoom',
        id: 'conveyorGuard',
        label: 'Conveyor Guard',
        roster: this._createEncounterRoster('conveyor'),
        keycardDropId: 'Keycard_Gamma',
      },
      {
        roomId: 'bossRoom',
        id: 'bossEncounter',
        label: 'Ruin Core Boss',
        roster: ['proceduralBoss'],
        isBoss: true,
        bossRewardKeycardId: 'Shrine_Key',
      },
    ];
    const roomById = new Map(rooms.map((room) => [room.id, room]));

    return encounterRooms
      .map((definition) => {
        const room = roomById.get(definition.roomId);
        if (!room) {
          return null;
        }
        const roster = [...definition.roster];
        const enemyEffects = room.flavorEffects?.enemies;
        if (!definition.isBoss && (enemyEffects?.countMultiplier ?? 1) >= 1.05) {
          const tags = enemyEffects?.favoredTags ?? [];
          const extraType = tags.some((tag) => tag.includes('turret') || tag.includes('sensor'))
            ? 'ranged'
            : tags.some((tag) => tag.includes('crawler') || tag.includes('swarm'))
              ? 'fast'
              : 'basic';
          roster.push(extraType);
        } else if (!definition.isBoss && (enemyEffects?.countMultiplier ?? 1) < 0.95 && roster.length > 2) {
          roster.pop();
        }
        if (!definition.isBoss) {
          const reinforcement = roster.find((type) => type === 'fast' || type === 'basic' || type === 'horokko') ?? 'basic';
          roster.push(reinforcement);
          roster.sort((left, right) => Number(left === 'ranged') - Number(right === 'ranged'));
        }
        const pyramid = definition.id === 'keycardGuard'
          ? room.mechanicalPyramidCenter
          : null;
        const triggerZone = pyramid ? {
          id: `${definition.id}SummitTrigger`,
          roomId: room.id,
          position: new THREE.Vector3(
            pyramid.x * this.tileSize,
            Number(room.baseElevation ?? 0) + Number(pyramid.elevation ?? 0),
            pyramid.z * this.tileSize,
          ),
          halfWidth: this.tileSize * 1.55,
          halfDepth: this.tileSize * 1.55,
          verticalHalfHeight: 1.1,
          active: true,
        } : null;

        return {
          ...definition,
          roster,
          roomArchetypeId: room.archetypeId,
          roomFlavorId: room.flavorId,
          specialEnvironmentId: room.specialEnvironmentId ?? null,
          enemyTags: enemyEffects?.favoredTags ?? [],
          enemySuppressedTags: enemyEffects?.suppressedTags ?? [],
          enemyHealthMultiplier: enemyEffects?.healthMultiplier ?? 1,
          enemyBehaviorModifiers: enemyEffects?.behaviorModifiers ?? [],
          zone: {
            id: `${definition.id}Zone`,
            roomId: room.id,
            position: new THREE.Vector3(
              room.x * this.tileSize,
              Number(room.baseElevation ?? 0),
              room.z * this.tileSize,
            ),
            halfWidth: (Math.floor(room.width / 2) + 0.5) * this.tileSize,
            halfDepth: (Math.floor(room.depth / 2) + 0.5) * this.tileSize,
            active: true,
          },
          triggerZone,
          spawnPoints: this._roomSpawnPoints(room, tiles, solidZones),
          spawned: false,
          cleared: false,
          enemyIds: [],
        };
      })
      .filter(Boolean);
  }

  _createEncounterRoster(kind) {
    const pools = {
      nest: [
        ['basic', 'fast', 'ranged', 'basic'],
        ['basic', 'basic', 'horokko'],
        ['fast', 'fast', 'ranged', 'basic'],
      ],
      server: [
        ['ranged', 'ranged', 'fast'],
        ['basic', 'ranged', 'horokko'],
        ['legacy:sharukurusu', 'fast', 'ranged', 'basic'],
      ],
      machine: [
        ['gorubesshu', 'basic', 'fast'],
        ['ranged', 'ranged', 'horokko'],
        ['gorubesshu', 'fast', 'basic', 'ranged'],
      ],
      coolant: [
        ['ranged', 'fast', 'basic'],
        ['horokko', 'ranged', 'basic'],
        ['fast', 'fast', 'ranged', 'basic'],
      ],
      keycard: [
        ['ranged', 'basic'],
        ['basic', 'horokko'],
        ['ranged', 'fast'],
      ],
      trap: [
        ['legacy:sharukurusu', 'basic', 'horokko'],
        ['horokko', 'horokko'],
        ['fast', 'ranged', 'basic'],
      ],
      conveyor: [
        ['gorubesshu', 'ranged'],
        ['gorubesshu', 'basic', 'fast'],
        ['ranged', 'legacy:sharukurusu', 'horokko'],
      ],
      boss: [
        ['tank', 'gorubesshu', 'ranged'],
        ['tank', 'legacy:sharukurusu', 'ranged'],
        ['gorubesshu', 'gorubesshu', 'fast'],
      ],
      shrine: [
        ['tank', 'horokko', 'ranged'],
        ['tank', 'gorubesshu', 'fast'],
        ['horokko', 'gorubesshu', 'ranged', 'basic'],
      ],
    };

    return [...this._choose(pools[kind] ?? [['basic', 'ranged']])];
  }
}

export default DungeonGenerator;
