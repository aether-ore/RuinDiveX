import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLAYER_TARGET_MODEL_HEIGHT } from './CharacterDimensions.js';
import { RollNpcAnimator } from './RollNpcAnimator.js';
import {
  createDungeonProgressionData,
  PROGRESSION_CONNECTIONS,
  PROGRESSION_ROOM_BANDS,
} from './DungeonProgression.js';
import { resolveIndustrialRoomMetadata } from './IndustrialRoomArchetypes.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from './TraversalCapabilities.js';

const DEFAULT_TILE_SIZE = 2.8;
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
const RUIN_DOOR_HEIGHT = 4.8;
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
const RUIN_JUMP_PLATFORM_ELEVATION = 1.35;
const RUIN_VERTICAL_OVERPASS_CLEARANCE = PLAYER_TRAVERSAL_ENVELOPE.headClearance + 0.35;
const ROOM_CEILING_HEIGHT_BY_SIZE = Object.freeze({
  small: 8.4,
  medium: 12.8,
  large: 15.2,
  'mini-dungeon': RUIN_WALL_HEIGHT,
});
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

function resolveConnectionDoorPlacement(connectionPlan, fromRoom, toRoom) {
  const path = connectionPlan?.bridgePath ?? [];
  const destinationThreshold = connectionPlan?.doorId && connectionPlan?.toSocket
    ? connectionPlan.toSocket
    : null;
  const thresholdIndex = destinationThreshold
    ? path.findIndex((point) => (
        point.x === destinationThreshold.x
        && point.z === destinationThreshold.z
      ))
    : -1;
  const index = thresholdIndex >= 0
    ? thresholdIndex
    : findConnectionDoorPathIndex(path);
  const pathPoint = path[index] ?? null;
  const point = destinationThreshold
    ? { x: destinationThreshold.x, z: destinationThreshold.z }
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
  const alongX = destinationThreshold
    ? Math.abs(destinationThreshold.facingX ?? 0)
      > Math.abs(destinationThreshold.facingZ ?? 0)
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
    thresholdAnchored: Boolean(destinationThreshold),
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
    openRetainingWallEdges: Array.isArray(openRetainingWallEdges)
      ? [...openRetainingWallEdges]
      : null,
  };

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

  tile.floorKey = floorTileKey(x, z, level);
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
  const halfW = Math.floor(room.width / 2);
  const halfD = Math.floor(room.depth / 2);

  for (let x = room.x - halfW; x <= room.x + halfW; x += 1) {
    for (let z = room.z - halfD; z <= room.z + halfD; z += 1) {
      setTile(tiles, x, z, room.tileType ?? 'floor', { roomId: room.id });
    }
  }

  setTile(tiles, room.x, room.z, room.type, { roomId: room.id, forceType: true });
}

function addHallway(tiles, from, to) {
  for (const x of rangeBetween(from.x, to.x)) {
    setTile(tiles, x, from.z, 'hallway');
  }

  for (const z of rangeBetween(from.z, to.z)) {
    setTile(tiles, to.x, z, 'hallway');
  }
}

export class DungeonGenerator {
  constructor({ tileSize = DEFAULT_TILE_SIZE, random = Math.random, difficulty = 1 } = {}) {
    this.tileSize = tileSize;
    this.random = random;
    this.difficulty = Math.max(1, Math.trunc(difficulty) || 1);
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

  generate() {
    let lastDungeon = null;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      lastDungeon = this._generateOnce();
      if (lastDungeon.progression?.validation?.accepted) {
        lastDungeon.generationAttempts = attempt + 1;
        const rollAnchor = lastDungeon.group.getObjectByName('rollCaskettNpc');
        const supportCarAnchor = lastDungeon.group.getObjectByName('expeditionSupportCar');
        const workbench = lastDungeon.group.getObjectByName('rollWorkshopWorkbench');
        lastDungeon.activateNpcAssets = () => {
          if (
            rollAnchor
            && !rollAnchor.userData.modelLoading
            && !rollAnchor.userData.modelLoaded
            && !rollAnchor.userData.modelLoadError
          ) {
            this._loadRollNpc(
              rollAnchor,
              lastDungeon.npcAnimationMixers,
              lastDungeon.npcAnimators,
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
        return lastDungeon;
      }
    }

    const errors = lastDungeon?.progression?.validation?.errors ?? ['Unknown dungeon validation failure.'];
    throw new Error(`Unable to generate a solvable vertical dungeon after 12 attempts: ${errors.join(' | ')}`);
  }

  _generateOnce() {
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
    const keycardX = side * this._randomInt(8, 11);
    const trapX = secondarySide * this._randomInt(9, 12);
    const conveyorX = this._choose([0, side * 6, secondarySide * 6]);
    const bossX = conveyorX + this._choose([0, side * 4, secondarySide * 4]);
    const shrineX = bossX + this._choose([0, side * 5, secondarySide * 5]);
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
      { id: 'bossRoom', type: 'boss', x: bossX, z: bossZ, width: 21, depth: 19 },
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
    const rooms = [...mainRooms, serverRoom, machineFactoryRoom, coolantRelayRoom, bonusVault];
    this._assignRoomArchetypes(rooms);
    const connectionPlans = this._createElevationConnectionPlans(rooms);

    for (const room of rooms) {
      addRectRoom(tiles, room);
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

    for (let i = 1; i < mainRooms.length; i += 1) {
      addHallway(tiles, mainRooms[i - 1], mainRooms[i]);
    }
    addHallway(tiles, mainRooms.find((room) => room.id === 'enemyNest'), serverRoom);
    addHallway(tiles, trapRoom, coolantRelayRoom);
    if (conveyorRoom) {
      addHallway(tiles, conveyorRoom, machineFactoryRoom);
      addHallway(tiles, conveyorRoom, bonusVault);
    }
    this._addConnectorExplorationSpaces(tiles, rooms, connectionPlans);

    this._applyIndustrialFactoryLayout(tiles, rooms, layoutVariant);
    const conveyorPuzzleValidation = this._applyConveyorPuzzleTemplates(tiles, rooms);
    const solidZones = this._createSolidCollisionZones(rooms);
    let floorTiles = [
      ...tiles.values(),
      ...this._createFactoryLevelTiles(tiles, rooms, connectionPlans, solidZones),
    ];
    floorTiles = this._enforceGeneratedWalkability(floorTiles, rooms);
    this._finalizeRoomVerticalPlans(rooms, floorTiles, connectionPlans);
    const progressionAccessValidation = this._validateProgressionAccess(floorTiles, tiles, rooms, connectionPlans);
    const coolantWalkabilityValidation = this._validateCoolantRoomWalkability(floorTiles, tiles, rooms, solidZones);
    const floorTileLookup = this._createFloorTileLookup(floorTiles);

    const group = new THREE.Group();
    group.name = 'randomizedRuinLayout';
    const materials = this._createMaterials();

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

    const openAirTileKeys = this._createOpenAirTileKeys(rooms);
    this._addIndustrialFactoryFeatures(group, floorTiles, materials, openAirTileKeys, floorTileLookup);
    this._addIndustrialRoomSetpieces(group, rooms, floorTiles, materials, solidZones);
    this._addVolumetricIndustrialPrefabs(
      group,
      rooms,
      floorTiles,
      connectionPlans,
      materials,
      solidZones,
    );
    this._addCeilings(group, tiles, materials, openAirTileKeys, rooms);
    const aerialBoundaryZones = this._addWalls(group, tiles, materials, openAirTileKeys);
    this._addInvisibleOpenAirBounds(group, tiles, materials, openAirTileKeys);
    const doors = this._addDoors(
      group,
      rooms,
      materials,
      tiles,
      connectionPlans,
      solidZones,
      aerialBoundaryZones,
    );
    const criticalDoorValidation = this._validateCriticalDoorChokepoints({
      floorTiles,
      rooms,
      solidZones,
      doors,
    });
    const verticalPortals = this._addVerticalConnectionPortals(group, connectionPlans, materials);
    const landmarks = this._addRoomLandmarks(group, rooms, materials, tiles, floorTiles, solidZones);
    landmarks.platforms.push(...this._createGeneratedPlatformSurfaces(floorTiles));
    const encounters = this._createEncounterDefinitions(rooms, floorTiles, solidZones);
    const trapVisualsByRoom = new Map(landmarks.trapVisuals.map((entry) => [entry.roomId, entry.object]));

    const enemySpawnPoints = rooms
      .filter((room) => !['hub', 'camp', 'entrance', 'bonus'].includes(room.type))
      .flatMap((room) => this._roomSpawnPoints(room, floorTiles, solidZones));
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
      connectionPlans,
    });
    const platformabilityValidation = this._validatePlatformability({
      floorTiles,
      rooms,
      solidZones,
      connectionPlans,
      doors,
      landmarks,
      encounters,
    });
    progression.validation = {
      ...progression.validation,
      platformability: platformabilityValidation.details,
      physicalProgression: criticalDoorValidation.details,
      accepted: Boolean(
        progression.validation?.accepted
        && progressionAccessValidation.accepted
        && coolantWalkabilityValidation.accepted
        && conveyorPuzzleValidation.accepted
        && criticalDoorValidation.accepted
        && platformabilityValidation.accepted
      ),
      errors: [
        ...(progression.validation?.errors ?? []),
        ...progressionAccessValidation.errors,
        ...coolantWalkabilityValidation.errors,
        ...conveyorPuzzleValidation.errors,
        ...criticalDoorValidation.errors,
        ...platformabilityValidation.errors,
      ],
      warnings: [
        ...(progression.validation?.warnings ?? []),
        ...progressionAccessValidation.warnings,
        ...coolantWalkabilityValidation.warnings,
        ...conveyorPuzzleValidation.warnings,
        ...criticalDoorValidation.warnings,
        ...platformabilityValidation.warnings,
      ],
    };
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
    ]);

    return {
      group,
      rooms,
      tiles,
      floorTiles,
      verticalConnectors: this._createVerticalConnectors(rooms, connectionPlans),
      connectionPlans,
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
        ceilingHeight: room.ceilingHeight ?? null,
        verticalPlan: room.verticalPlan ?? null,
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
      traps: this._createTrapZones(rooms, floorTiles, trapVisualsByRoom),
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
    };
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
        room.floorElevation = 0;
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
      room.floorElevation = 0;
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
      room.exitSockets = [];
    }
  }

  _createElevationConnectionPlans(rooms) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const plans = [];
    const isInside = (point, room) => {
      const halfW = Math.floor(room.width / 2);
      const halfD = Math.floor(room.depth / 2);
      return Math.abs(point.x - room.x) <= halfW && Math.abs(point.z - room.z) <= halfD;
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
    }) => {
      const fromRoom = roomById.get(fromRoomId);
      const toRoom = roomById.get(toRoomId);
      if (!fromRoom || !toRoom) {
        return null;
      }

      const fullPath = this._buildOrthogonalPath(fromRoom, toRoom);
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
        landingWidth: this.tileSize,
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
        fullPath,
        bridgePath: fullPath.slice(fromSocketIndex, toSocketIndex + 1),
        fromSocket: createSocket(fromRoom, 'exit', fromPoint, fromOutside),
        toSocket: createSocket(toRoom, 'entrance', toPoint, toOutside),
      };

      fromRoom.exitSockets.push({ ...plan.fromSocket, connectionId: id, purpose });
      toRoom.exitSockets.push({ ...plan.toSocket, connectionId: id, purpose });
      return plan;
    };

    for (const [fromRoomId, toRoomId, doorId] of PROGRESSION_CONNECTIONS) {
      const plan = createPlan({
        id: `${fromRoomId}_${toRoomId}_ground`,
        fromRoomId,
        toRoomId,
        doorId,
        requiredForProgression: true,
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
      const plan = createPlan({
        ...spec,
        level: 1,
        elevation: RUIN_SECOND_FLOOR_ELEVATION,
        connectorType: 'upper_catwalk_bridge',
      });
      if (plan) {
        plans.push(plan);
      }
    }

    return plans;
  }

  _addConnectorExplorationSpaces(tiles, rooms, connectionPlans = []) {
    const isInsideAnyRoom = (point) => rooms.some((room) => this._isTileInsideRoom(point, room));
    const addConnectorTile = (x, z, plan, zone) => {
      const point = { x, z };
      if (isInsideAnyRoom(point)) {
        return;
      }
      const tile = setTile(tiles, x, z, 'hallway', {
        surface: 'connectorGalleryFloor',
        connectorId: plan.id,
        connectorZone: zone,
      });
      tile.connectorId = plan.id;
      tile.connectorZone = zone;
    };

    for (const plan of connectionPlans.filter((candidate) => candidate.level === 0)) {
      const path = plan.bridgePath ?? [];
      if (path.length < 5) {
        continue;
      }
      const midpoint = Math.floor((path.length - 1) * 0.5);
      const galleryCenters = new Set([
        Math.max(2, Math.floor(path.length * 0.28)),
        Math.min(path.length - 3, Math.floor(path.length * 0.72)),
      ]);

      for (let index = 1; index < path.length - 1; index += 1) {
        const point = path[index];
        const previous = path[index - 1] ?? point;
        const next = path[index + 1] ?? point;
        const directionX = Math.sign(next.x - previous.x);
        const directionZ = Math.sign(next.z - previous.z);
        if (directionX === 0 && directionZ === 0) {
          continue;
        }
        const perpendicularX = -directionZ;
        const perpendicularZ = directionX;
        const isDoorPinch = Boolean(plan.doorId) && (
          Math.abs(index - midpoint) <= 2
          || index <= 3
          || index >= path.length - 4
        );
        const sideWidth = isDoorPinch ? 0 : galleryCenters.has(index) ? 2 : 1;

        const centerTile = tiles.get(tileKey(point.x, point.z));
        if (centerTile) {
          centerTile.connectorId = plan.id;
          centerTile.connectorZone = isDoorPinch ? 'door_chokepoint' : 'main_gallery';
          if (centerTile.type === 'hallway') {
            centerTile.surface = 'connectorGalleryFloor';
          }
        }

        for (let offset = 1; offset <= sideWidth; offset += 1) {
          for (const side of [-1, 1]) {
            addConnectorTile(
              point.x + perpendicularX * offset * side,
              point.z + perpendicularZ * offset * side,
              plan,
              galleryCenters.has(index) ? 'exploration_alcove' : 'service_lane',
            );
          }
        }
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

  _applyIndustrialFactoryLayout(tiles, rooms) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const conveyorRoom = roomById.get('conveyorRoom');
    const bossRoom = roomById.get('bossRoom');
    const shrineRoom = roomById.get('shrineRoom');
    const trapRoom = roomById.get('trapRoom');

    for (const room of rooms) {
      this._markRoomCatwalks(tiles, room);
    }

    this._markConveyorBridge(tiles, trapRoom, conveyorRoom, {
      speed: 1.45,
      surface: 'conveyorBridge',
    });
    this._markConveyorBridge(tiles, conveyorRoom, bossRoom, {
      speed: 1.72,
      surface: 'conveyorBridge',
    });
    this._markConveyorBridge(tiles, bossRoom, shrineRoom, {
      speed: 1.38,
      surface: 'conveyorBridge',
    });
  }

  _createFactoryLevelTiles(tiles, rooms, connectionPlans = [], solidZones = []) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const extraTiles = [];
    const seen = new Set();
    let rampRouteSequence = 0;
    const progressionAccessTileKeys = this._createProgressionAccessTileKeys(tiles, rooms);
    const structuralVoidTileKeys = new Set(progressionAccessTileKeys);
    const fullHeightDoorVoidTileKeys = new Set();
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
    for (const connection of connectionPlans.filter((plan) => plan.level === 0 && plan.doorId)) {
      const fromRoom = roomById.get(connection.fromRoomId);
      const toRoom = roomById.get(connection.toRoomId);
      const { point, alongX } = resolveConnectionDoorPlacement(connection, fromRoom, toRoom);
      if (!point) {
        continue;
      }
      const clearanceOffsets = alongX
        ? [[0, -1], [0, 0], [0, 1]]
        : [[-1, 0], [0, 0], [1, 0]];
      for (const [dx, dz] of clearanceOffsets) {
        const key = tileKey(point.x + dx, point.z + dz);
        if (tiles.has(key)) {
          fullHeightDoorVoidTileKeys.add(key);
          structuralVoidTileKeys.add(key);
        }
      }
    }
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

      const target = getAllFloorTiles()
        .filter((tile) => this._isTileInsideRoom(tile, room))
        .filter((tile) => tile.x !== socket.x || tile.z !== socket.z)
        .filter((tile) => Math.abs((tile.elevation ?? 0) - socket.elevation) <= 0.12)
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
          elevation: socket.elevation,
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
        entryLipFloorKeys: selected.entryLipPoints.map((point) => floorTileKey(point.x, point.z, 0)),
        lowerFloorKeys,
        bridgeFloorKeys,
        returnShelfFloorKeys,
        exitFloorKeys: selected.exitRimPoints.map((point) => floorTileKey(point.x, point.z, 0)),
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
      for (const point of connection.fullPath) {
        const isPortalLanding = [connection.fromSocket, connection.toSocket].some((socket) => (
          socket.x === point.x && socket.z === point.z
        ));
        const bridgeTile = pushExtra(point.x, point.z, {
          type: 'floor',
          elevation: connection.elevation,
          level: connection.level,
          surface: 'upperConnectionBridge',
          roomId: rooms.find((room) => this._isTileInsideRoom(point, room))?.id ?? null,
          connectionId: connection.id,
          isLedgeSurface: isPortalLanding,
          allowProgressionAccess: true,
          preserveProgressionOverpass: true,
        });
        if (isPortalLanding && !bridgeTile) {
          const existingLanding = getAllFloorTiles().find((tile) => (
            tile.x === point.x
            && tile.z === point.z
            && Math.abs((tile.elevation ?? 0) - connection.elevation) <= 0.05
          ));
          if (existingLanding) {
            existingLanding.isLedgeSurface = true;
            existingLanding.connectionId = connection.id;
          }
        }
      }

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
        const rampLength = Math.ceil(connection.elevation / RUIN_RAMP_MAX_STEP);
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
            elevation: connection.elevation,
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
          connection.elevation,
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
    for (const room of rooms.filter((candidate) => !RUIN_OPEN_AIR_ROOM_TYPES.has(candidate.type))) {
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

  _isGroundedPropTile(tile) {
    if (!tile) {
      return false;
    }

    if (tile.surface === 'industrialRamp' || tile.surface === 'rampLanding') {
      return false;
    }

    return (tile.elevation ?? 0) <= 0.05;
  }

  _findRoomFloorTile(room, floorTiles = [], preferredSurfaces = [], {
    avoidKeys = new Set(),
    preferFarthest = false,
    groundedOnly = false,
  } = {}) {
    const surfaceRank = new Map(preferredSurfaces.map((surface, index) => [surface, index]));
    const candidates = this._getRoomFloorTiles(room, floorTiles)
      .filter((tile) => !avoidKeys.has(floorTileKey(tile.x, tile.z, tile.level ?? 0)))
      .filter((tile) => !groundedOnly || this._isGroundedPropTile(tile));

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
    return floorTileKey(tile.x, tile.z, tile.level ?? 0);
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

  _createReachableFloorTileKeySet(startTile, floorTiles = []) {
    if (!startTile) {
      return new Set();
    }

    const columns = this._createFloorTileLookup(floorTiles);
    const startKey = this._getFloorTileGraphKey(startTile);
    const reachable = new Set([startKey]);
    const queue = [startTile];

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
          if (!this._getTraversalActionBetweenFloorTiles(current, candidate)) {
            continue;
          }

          reachable.add(candidateKey);
          queue.push(candidate);
        }
      }
    }

    return reachable;
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
      .filter((tile) => !groundedOnly || this._isGroundedPropTile(tile));

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
      const elevationA = Math.abs(a.elevation ?? 0);
      const elevationB = Math.abs(b.elevation ?? 0);
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
      if (!room || RUIN_OPEN_AIR_ROOM_TYPES.has(room.type)) {
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

  _createProgressionAccessTileKeys(tiles, rooms) {
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

    for (const [fromRoomId, toRoomId] of PROGRESSION_CONNECTIONS) {
      const fromRoom = roomById.get(fromRoomId);
      const toRoom = roomById.get(toRoomId);
      if (!fromRoom || !toRoom) {
        continue;
      }

      for (const point of this._buildOrthogonalPath(fromRoom, toRoom)) {
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
    const surfaceElevations = [
      tile.elevation ?? 0,
      tile.rampStartElevation,
      tile.rampEndElevation,
    ].filter(Number.isFinite);
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
    return elevation >= -0.08 && elevation < topY - 0.06;
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

  _validateCriticalDoorChokepoints({
    floorTiles = [],
    rooms = [],
    solidZones = [],
    doors = [],
  } = {}) {
    const errors = [];
    const checks = [];
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const startRoom = roomById.get('hubTown') ?? roomById.get('expeditionCamp') ?? rooms[0];
    const criticalDoors = doors.filter((door) => door.closed && door.locked);
    const blockingPlatformTops = this._createBlockingPlatformColumnMap(floorTiles);

    for (const door of criticalDoors) {
      if (!door.thresholdAnchored) {
        errors.push(`${door.id} is not anchored to its destination-room threshold.`);
      }
      if ((door.thresholdWallZones?.length ?? 0) !== 2) {
        errors.push(`${door.id} does not have two continuous threshold wall wings.`);
      }
      const traversableTiles = floorTiles.filter((tile) => (
        !this._isFloorTileBlockedBySolidZone(tile, solidZones)
        && !this._isFloorTileBlockedByGeneratedPlatform(tile, blockingPlatformTops)
        && !this._isFloorTileBlockedByDoor(tile, door)
      ));
      const startTile = this._findRoomWalkabilityStartTile(startRoom, traversableTiles);
      const reachable = this._createReachableFloorTileKeySet(startTile, traversableTiles);
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
        sourceBand: PROGRESSION_ROOM_BANDS[door.fromRoomId] ?? null,
        destinationBand: PROGRESSION_ROOM_BANDS[door.toRoomId] ?? null,
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
    const progressionAccessTileKeys = this._createProgressionAccessTileKeys(tiles, rooms);
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
      const baseTile = column.find((tile) => (
        Math.abs(tile.elevation ?? 0) <= 0.05
        && Math.abs(tile.level ?? 0) <= 0.05
        && tile.surface !== 'industrialRamp'
        && tile.surface !== 'rampLanding'
      ));
      const hasPreservedFooting = column.some((candidate) => (
        candidate.preserveProgressionFooting
        && Math.abs(candidate.elevation ?? 0) <= 0.05
      ));
      const elevatedBlocker = column.find((tile) => (
        (tile.surface === 'industrialRamp'
          || tile.surface === 'rampLanding'
          || Math.abs(tile.level ?? 0) > 0.05)
        && !(
          this._isClearProgressionOverpass(tile)
        )
        && !(hasPreservedFooting && tile.dropSpaceId && (tile.elevation ?? 0) < -0.05)
      ));

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
    const fixtureTileKeys = this._createCoolantFixtureTileKeys(tiles, rooms);
    const roomTiles = this._getRoomFloorTiles(room, floorTiles);
    const blockingPlatformTops = this._createBlockingPlatformColumnMap(floorTiles);
    const navigableTiles = roomTiles.filter((tile) => (
      !fixtureTileKeys.has(tileKey(tile.x, tile.z))
      && !this._isFloorTileBlockedBySolidZone(tile, solidZones)
      && !this._isFloorTileBlockedByGeneratedPlatform(tile, blockingPlatformTops)
    ));

    const startTile = [...navigableTiles].sort((a, b) => {
      const elevationA = Math.abs(a.elevation ?? 0);
      const elevationB = Math.abs(b.elevation ?? 0);
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
        errors.push(`Coolant room tile ${key} is not reachable from the room floor.`);
      }
      if (tile.surface === 'industrialRamp' && tile.steepRamp) {
        errors.push(`Coolant room ramp tile ${key} is too steep to use reliably.`);
      }
    }

    for (const tile of roomTiles) {
      const elevated = Math.abs(tile.elevation ?? 0) > 0.05 || Math.abs(tile.level ?? 0) > 0.05;
      if (elevated && fixtureTileKeys.has(tileKey(tile.x, tile.z))) {
        errors.push(`Coolant room elevated tile ${this._getFloorTileGraphKey(tile)} overlaps a tank or pressure core footprint.`);
      }
    }

    return {
      accepted: errors.length === 0,
      errors,
      warnings: errors.length ? [] : ['Coolant room walkability validated successfully.'],
    };
  }

  _finalizeRoomVerticalPlans(rooms, floorTiles, connectionPlans = []) {
    for (const room of rooms) {
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
      ramp.baseElevation = 0;
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
          : RUIN_MINOR_DROP_ELEVATION,
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
        baseY: Number.isFinite(tile.supportBaseElevation) ? tile.supportBaseElevation : 0,
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
    const groupedTiles = new Map();
    for (const tile of floorTiles.filter((candidate) => candidate.isPlatformingSurface && candidate.platformGroupId)) {
      const tiles = groupedTiles.get(tile.platformGroupId) ?? [];
      tiles.push(tile);
      groupedTiles.set(tile.platformGroupId, tiles);
    }
    for (const [platformGroupId, tiles] of groupedTiles) {
      const minX = Math.min(...tiles.map((tile) => tile.x));
      const maxX = Math.max(...tiles.map((tile) => tile.x));
      const minZ = Math.min(...tiles.map((tile) => tile.z));
      const maxZ = Math.max(...tiles.map((tile) => tile.z));
      const representative = tiles
        .slice()
        .sort((a, b) => (
          Math.abs(a.x - (minX + maxX) * 0.5) + Math.abs(a.z - (minZ + maxZ) * 0.5)
        ) - (
          Math.abs(b.x - (minX + maxX) * 0.5) + Math.abs(b.z - (minZ + maxZ) * 0.5)
        ))[0];
      surfaces.push({
        id: `generatedSolidPlatform_${platformGroupId}`,
        roomId: representative.roomId,
        floorKey: this._getFloorTileGraphKey(representative),
        center: new THREE.Vector3(
          (minX + maxX) * this.tileSize * 0.5,
          representative.elevation ?? 0,
          (minZ + maxZ) * this.tileSize * 0.5,
        ),
        halfWidth: (maxX - minX + 1) * this.tileSize * 0.48,
        halfDepth: (maxZ - minZ + 1) * this.tileSize * 0.48,
        topY: representative.elevation ?? 0,
        baseY: 0,
        blocksBelow: true,
        generated: true,
        solidVolume: true,
        platformGroupId,
        purpose: representative.platformPurpose,
        requiredTraversalAction: representative.requiredTraversalAction ?? 'jump',
      });
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
          baseY: 0,
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

  _validatePlatformability({
    floorTiles = [],
    rooms = [],
    solidZones = [],
    connectionPlans = [],
    doors = [],
    landmarks = {},
    encounters = [],
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
    const dropSpaceChecks = [];
    const startRoom = rooms.find((room) => room.id === 'hubTown') ?? rooms[0];
    const startTile = this._findRoomWalkabilityStartTile(startRoom, navigableTiles);
    const reachable = new Set();
    const queue = [];

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
          if (!action) {
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
    }

    const tileForPoint = (point) => {
      if (!point) {
        return null;
      }
      const x = Math.round(point.x / this.tileSize);
      const z = Math.round(point.z / this.tileSize);
      return [...(columns.get(tileKey(x, z)) ?? [])]
        .sort((a, b) => Math.abs((a.elevation ?? 0) - (point.y ?? 0)) - Math.abs((b.elevation ?? 0) - (point.y ?? 0)))[0] ?? null;
    };
    const requirePoint = (label, point) => {
      const blockingZone = point
        ? solidZones.find((zone) => this._isPositionInsideZone(point, zone))
        : null;
      if (blockingZone) {
        errors.push(`${label} overlaps solid zone ${blockingZone.id}.`);
        return;
      }

      const tile = tileForPoint(point);
      const directlyReachable = tile && reachable.has(this._getFloorTileGraphKey(tile));
      const hasReachableApproach = !directlyReachable && tile && DIRECTIONS.some(([dx, dz]) => (
        (columns.get(tileKey(tile.x + dx, tile.z + dz)) ?? []).some((candidate) => (
          reachable.has(this._getFloorTileGraphKey(candidate))
          && Math.abs((candidate.elevation ?? 0) - (point.y ?? 0)) <= PLAYER_TRAVERSAL_ENVELOPE.maximumNormalJumpRise
        ))
      ));
      if (!directlyReachable && !hasReachableApproach) {
        errors.push(`${label} is not reachable by the player traversal envelope.`);
      }
    };

    for (const room of rooms.filter((candidate) => !RUIN_OPEN_AIR_ROOM_TYPES.has(candidate.type))) {
      const reachableRoomTiles = this._getRoomFloorTiles(room, navigableTiles)
        .filter((tile) => reachable.has(this._getFloorTileGraphKey(tile)));
      const reachableElevations = new Set(reachableRoomTiles.map((tile) => (tile.elevation ?? 0).toFixed(2)));
      const elevatedTiles = reachableRoomTiles.filter((tile) => Math.abs(tile.elevation ?? 0) > 0.05);
      const platformTiles = room.platformNodes ?? [];
      const disconnectedTraversalTiles = this._getRoomFloorTiles(room, navigableTiles)
        .filter((tile) => (
          (tile.surface === 'industrialRamp'
            || ((tile.elevation ?? 0) > 0.05 && SCAFFOLD_RAMP_ACCESS_SURFACES.has(tile.surface)))
          && !reachable.has(this._getFloorTileGraphKey(tile))
        ));

      if (!reachableRoomTiles.length) {
        errors.push(`${room.id} has no platformably reachable floor.`);
      }
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
      let hasRequiredPlatformAction = false;
      for (const platform of platformTiles) {
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
      if (platformTiles.length && !hasRequiredPlatformAction) {
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

      const highestElevation = Math.max(0, ...reachableRoomTiles.map((tile) => tile.elevation ?? 0));
      if (Number.isFinite(room.ceilingHeight)
        && highestElevation + PLAYER_TRAVERSAL_ENVELOPE.headClearance > room.ceilingHeight) {
        errors.push(`${room.id} lacks ceiling clearance above its highest reachable tier.`);
      }
    }

    for (const room of rooms.filter((candidate) => candidate.dropSpace)) {
      const spec = room.dropSpace;
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
      const egressReachable = this._createReachableFloorTileKeySet(lowerStart, navigableTiles);
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
          && Math.abs((tile.supportBaseElevation ?? Infinity) - spec.lowerElevation) <= 0.01
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
        (tile.elevation ?? 0) - spec.lowerElevation
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

    for (const plan of connectionPlans) {
      if (Math.abs(plan.fromSocket.elevation - plan.toSocket.elevation) > 0.001) {
        errors.push(`${plan.id} has mismatched portal elevations.`);
      }
      if (plan.fromSocket.connectorType !== plan.toSocket.connectorType) {
        errors.push(`${plan.id} uses incompatible exit and entrance connector types.`);
      }
      for (const socket of [plan.fromSocket, plan.toSocket]) {
        if (!reachable.has(socket.floorKey)) {
          errors.push(`${socket.id} is not reachable from its room approach.`);
        }
        const ownerRoom = roomById.get(socket.roomId);
        const localTiles = ownerRoom
          ? navigableTiles.filter((tile) => this._isTileInsideRoom(tile, ownerRoom))
          : [];
        const localStart = this._findRoomWalkabilityStartTile(ownerRoom, localTiles);
        const locallyReachable = this._createReachableFloorTileKeySet(localStart, localTiles);
        const accessibleFromOwnerRoom = locallyReachable.has(socket.floorKey);
        if (!accessibleFromOwnerRoom) {
          errors.push(`${socket.id} cannot be reached locally from ${socket.roomId} without crossing its connection first.`);
        }
        localSocketChecks.push({
          socketId: socket.id,
          roomId: socket.roomId,
          accessibleFromOwnerRoom,
          reachableLocalNodeCount: locallyReachable.size,
          totalLocalNodeCount: localTiles.length,
        });
      }
      if (plan.level > 0) {
        for (const point of plan.bridgePath) {
          const key = floorTileKey(point.x, point.z, plan.level);
          if (!reachable.has(key)) {
            errors.push(`${plan.id} bridge tile ${key} is disconnected.`);
            break;
          }
        }
      }
      if (
        plan.level === 0
        && (plan.bridgePath?.length ?? 0) >= 5
        && !RUIN_OPEN_AIR_ROOM_TYPES.has(roomById.get(plan.fromRoomId)?.type)
        && !RUIN_OPEN_AIR_ROOM_TYPES.has(roomById.get(plan.toRoomId)?.type)
        && (plan.explorationBeats?.length ?? 0) < 2
      ) {
        errors.push(`${plan.id} lacks authored connector exploration beats.`);
      }
    }

    for (const door of doors) {
      requirePoint(`Door ${door.id}`, door.position);
    }
    for (const keycard of landmarks.keycards ?? []) {
      requirePoint(`Keycard ${keycard.id}`, keycard.position);
    }
    for (const mechanism of landmarks.mechanisms ?? []) {
      requirePoint(`Mechanism ${mechanism.id}`, mechanism.position);
    }
    for (const chest of landmarks.chests ?? []) {
      requirePoint(`Chest ${chest.id}`, chest.position);
    }
    if (landmarks.shrine) {
      requirePoint('Large Refractor shrine', landmarks.shrine.position);
    }
    for (const encounter of encounters) {
      for (const [index, spawnPoint] of (encounter.spawnPoints ?? []).entries()) {
        requirePoint(`${encounter.id} spawn ${index + 1}`, spawnPoint);
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
        position: new THREE.Vector3(room.x * this.tileSize, 0, room.z * this.tileSize),
        connections: connectionPlans
          .filter((plan) => plan.fromRoomId === room.id || plan.toRoomId === room.id)
          .map((plan) => ({
            id: plan.id,
            connectorType: plan.connectorType,
            elevation: plan.elevation,
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
    if (!room || RUIN_OPEN_AIR_ROOM_TYPES.has(room.type)) {
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
  } = {}) {
    if (!fromRoom || !toRoom) {
      return;
    }

    const path = this._buildOrthogonalPath(fromRoom, toRoom);

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
      const warning = new THREE.Mesh(
        new THREE.RingGeometry(0.44, 0.54, 28),
        new THREE.MeshBasicMaterial({
          color: 0xff5f5f,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
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
        const baseY = 0;
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

    const platformGroups = new Map();
    for (const tile of floorTiles.filter((candidate) => candidate.isPlatformingSurface)) {
      const groupId = tile.platformGroupId ?? `${tile.roomId ?? 'room'}_${tile.x}_${tile.z}`;
      const tiles = platformGroups.get(groupId) ?? [];
      tiles.push(tile);
      platformGroups.set(groupId, tiles);
    }

    for (const [groupId, tiles] of platformGroups) {
      if (
        !tiles.length
        || tiles[0].surface === 'mechanicalPyramidSummit'
        || tiles[0].surface === 'mechanicalPyramidApex'
      ) {
        continue;
      }
      const minX = Math.min(...tiles.map((tile) => tile.x));
      const maxX = Math.max(...tiles.map((tile) => tile.x));
      const minZ = Math.min(...tiles.map((tile) => tile.z));
      const maxZ = Math.max(...tiles.map((tile) => tile.z));
      const topY = Math.max(...tiles.map((tile) => tile.elevation ?? 0));
      const baseY = Math.min(0, ...tiles.map((tile) => tile.baseElevation ?? 0));
      const height = Math.max(0.18, topY - baseY - 0.1);
      const mass = new THREE.Mesh(
        this._createTiledBoxGeometry(
          (maxX - minX + 1) * this.tileSize * 0.96,
          height,
          (maxZ - minZ + 1) * this.tileSize * 0.96,
        ),
        [
          materials.wallMacroTiles.mm,
          materials.wallMacroTiles.mm,
          materials.raisedDeckFloor,
          materials.supportMetal,
          materials.wallMacroTiles.mm,
          materials.wallMacroTiles.mm,
        ],
      );
      mass.name = `solidPurposePlatformMass_${groupId}`;
      mass.position.set(
        (minX + maxX) * this.tileSize * 0.5,
        baseY + height * 0.5 - 0.04,
        (minZ + maxZ) * this.tileSize * 0.5,
      );
      mass.castShadow = true;
      mass.receiveShadow = true;
      mass.userData.solidPlatformVolume = true;
      mass.userData.cameraOcclusionSurface = true;
      mass.userData.cameraOcclusionOwner = true;
      group.add(mass);

      const bandHeight = 0.16;
      for (const y of [baseY + height * 0.28, baseY + height * 0.72]) {
        const band = new THREE.Mesh(
          new THREE.BoxGeometry(
            (maxX - minX + 1) * this.tileSize * 0.985,
            bandHeight,
            (maxZ - minZ + 1) * this.tileSize * 0.985,
          ),
          materials.supportMetal,
        );
        band.name = 'solidPurposePlatformReinforcementBand';
        band.position.copy(mass.position);
        band.position.y = y;
        band.castShadow = true;
        band.userData.cameraOcclusionSurface = true;
        band.userData.cameraOcclusionOwner = true;
        group.add(band);
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
      const bottomY = Math.min(0, startY, endY) - 0.12;
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
      const key = tileKey(tile.x, tile.z);

      if (openAirTileKeys.has(key)) {
        continue;
      }

      if (elevation < -0.05) {
        this._addBasementRetainingWalls(group, tile, floorTileLookup, materials);
        continue;
      }

      if (elevation <= 0.05) {
        continue;
      }

      if (!rampColumnKeys.has(key)) {
        this._addFactoryTileSupports(group, tile, materials);
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
      const wallHeight = Math.abs(elevation);
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
        -0.18,
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
    const wallHeight = Math.abs(elevation);
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

  _addFactoryTileSupports(group, tile, materials) {
    const elevation = tile.elevation ?? 0;
    if (elevation <= 0.05) {
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

    const supportHeight = Math.max(0.12, elevation - 0.1);
    const supportGeometry = new THREE.BoxGeometry(0.12, supportHeight, 0.12);
    const beamGeometryX = new THREE.BoxGeometry(this.tileSize * 0.86, 0.08, 0.12);
    const beamGeometryZ = new THREE.BoxGeometry(0.12, 0.08, this.tileSize * 0.86);
    const baseX = tile.x * this.tileSize;
    const baseZ = tile.z * this.tileSize;
    const cornerOffset = this.tileSize * 0.36;

    for (const offsetX of [-cornerOffset, cornerOffset]) {
      for (const offsetZ of [-cornerOffset, cornerOffset]) {
        const support = new THREE.Mesh(supportGeometry, materials.supportMetal);
        support.name = 'factoryCatwalkSupport';
        support.position.set(baseX + offsetX, supportHeight * 0.5, baseZ + offsetZ);
        support.castShadow = true;
        support.receiveShadow = true;
        group.add(support);
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
      if (elevation <= 0.05) {
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
      ) {
        continue;
      }

      for (const [dx, dz] of DIRECTIONS) {
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

      const roomGroup = createRoomGroup(room);
      const halfW = Math.max(1.1, Math.floor(room.width / 2) * this.tileSize - 0.7);
      const halfD = Math.max(1.1, Math.floor(room.depth / 2) * this.tileSize - 0.7);
      const archetype = room.archetype ?? room.type;

      if (room.id === 'coolantRelayRoom') {
        roomGroup.name = 'coolantRelayRoomSetpiece';
        roomGroup.position.set(room.x * this.tileSize, 0, room.z * this.tileSize);
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
      prefab.position.set(x, y, z);
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
      solidZones.push({
        id,
        roomId,
        label,
        position: new THREE.Vector3(x, elevation + height * 0.5, z),
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
          || (tile.elevation ?? 0) > 0.05
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
          && (tile.elevation ?? 0) <= height + PLAYER_TRAVERSAL_ENVELOPE.headClearance
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
    const createArch = (width = 5.2, height = 4.7, accent = materials.glowBlue) => {
      const prefab = new THREE.Group();
      const columnHeight = height - width * 0.5;
      for (const x of [-width * 0.5, width * 0.5]) {
        addCylinder(prefab, 'industrialArchColumn', 0.28, 0.42, columnHeight, materials.wallTrim, x, columnHeight * 0.5, 0, 14);
        addBox(prefab, 'industrialArchColumnFoot', 0.92, 0.24, 0.92, materials.supportMetal, x, 0.12, 0);
      }
      const arch = addMesh(prefab, 'industrialCylinderArch', new THREE.TorusGeometry(width * 0.5, 0.28, 10, 32, Math.PI), materials.wallTrim, 0, columnHeight, 0);
      const innerArch = addMesh(prefab, 'industrialArchGlowChannel', new THREE.TorusGeometry(width * 0.5 - 0.38, 0.06, 8, 28, Math.PI), accent, 0, columnHeight, 0);
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

    for (const room of rooms.filter((candidate) => !RUIN_OPEN_AIR_ROOM_TYPES.has(candidate.type))) {
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

    const roomById = new Map(rooms.map((room) => [room.id, room]));
    for (const plan of connectionPlans.filter((candidate) => candidate.level === 0)) {
      const fromRoom = roomById.get(plan.fromRoomId);
      const toRoom = roomById.get(plan.toRoomId);
      if (!fromRoom || !toRoom || RUIN_OPEN_AIR_ROOM_TYPES.has(fromRoom.type) || RUIN_OPEN_AIR_ROOM_TYPES.has(toRoom.type)) {
        continue;
      }
      const path = plan.bridgePath ?? [];
      if (path.length < 5) {
        continue;
      }
      const indices = [Math.floor(path.length * 0.28), Math.floor(path.length * 0.72)]
        .map((index) => THREE.MathUtils.clamp(index, 1, path.length - 2));
      plan.explorationBeats = [];
      for (const [beatIndex, index] of indices.entries()) {
        const point = path[index];
        const previous = path[index - 1] ?? point;
        const next = path[index + 1] ?? point;
        const directionX = Math.sign(next.x - previous.x);
        const directionZ = Math.sign(next.z - previous.z);
        const rotationY = directionX !== 0 ? Math.PI / 2 : 0;
        const worldX = point.x * this.tileSize;
        const worldZ = point.z * this.tileSize;
        const archWidth = this.tileSize * 2.45;
        place(createArch(archWidth, 5.5, beatIndex === 0 ? materials.glowBlue : materials.glowYellow), `connectorIndustrialArch_${plan.id}_${beatIndex}`, worldX, worldZ, rotationY);
        registerFrameColumns({
          id: `connectorIndustrialArch_${plan.id}_${beatIndex}`,
          label: 'Connector cylinder arch',
          x: worldX,
          z: worldZ,
          width: archWidth,
          height: 5.5,
          rotationY,
          columnHalfSize: 0.5,
        });

        if (beatIndex === 0) {
          const perpendicularX = -directionZ || 0;
          const perpendicularZ = directionX || 0;
          const side = (plan.id.length % 2 === 0) ? 1 : -1;
          const propX = worldX + perpendicularX * side * this.tileSize * 1.62;
          const propZ = worldZ + perpendicularZ * side * this.tileSize * 1.62;
          const servicePrefab = plan.id.length % 3 === 0
            ? createPump(0.72, materials.glowGreen)
            : createWaterTank(0.72, materials.glowBlue);
          place(servicePrefab, `connectorServiceMachine_${plan.id}`, propX, propZ, rotationY);
          registerSolid({
            id: `connectorServiceMachine_${plan.id}`,
            label: 'Connector service machinery',
            x: propX,
            z: propZ,
            halfWidth: 1.1,
            halfDepth: 1.1,
            height: 3.1,
            rotationY,
          });
          const fence = createFence(this.tileSize * 1.72, 2.65);
          const fenceX = worldX + perpendicularX * side * this.tileSize * 0.72;
          const fenceZ = worldZ + perpendicularZ * side * this.tileSize * 0.72;
          const fenceRotation = directionZ !== 0 ? Math.PI / 2 : 0;
          place(fence, `connectorChainLinkServiceFence_${plan.id}`, fenceX, fenceZ, fenceRotation);
          registerFence({
            id: `connectorChainLinkServiceFence_${plan.id}`,
            label: 'Connector chain-link service fence',
            x: fenceX,
            z: fenceZ,
            width: this.tileSize * 1.72,
            height: 2.65,
            rotationY: fenceRotation,
          });
          plan.explorationBeats.push({
            type: 'fenced_service_machinery',
            x: point.x,
            z: point.z,
          });
        } else {
          const frameWidth = this.tileSize * 2.25;
          place(createGirderFrame(frameWidth, 5.8), `connectorGirderPortal_${plan.id}`, worldX, worldZ, rotationY);
          registerFrameColumns({
            id: `connectorGirderPortal_${plan.id}`,
            label: 'Connector girder portal',
            x: worldX,
            z: worldZ,
            width: frameWidth,
            height: 5.8,
            rotationY,
          });
          plan.explorationBeats.push({
            type: 'girder_arch_transition',
            x: point.x,
            z: point.z,
          });
        }
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

  _addCeilings(group, tiles, materials, openAirTileKeys = new Set(), rooms = []) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const ceilingGeometry = new THREE.BoxGeometry(this.tileSize, RUIN_CEILING_THICKNESS, this.tileSize);

    for (const tile of tiles.values()) {
      if (openAirTileKeys.has(tileKey(tile.x, tile.z))) {
        continue;
      }

      const ceiling = new THREE.Mesh(ceilingGeometry, materials.ceiling);
      const room = roomById.get(tile.roomId);
      const ceilingHeight = room?.ceilingHeight ?? 8.4;
      ceiling.name = 'dungeonRoomCeiling';
      ceiling.position.set(
        tile.x * this.tileSize,
        ceilingHeight + RUIN_CEILING_THICKNESS * 0.5,
        tile.z * this.tileSize,
      );
      ceiling.userData.ceilingHeight = ceilingHeight;
      ceiling.castShadow = true;
      ceiling.receiveShadow = true;
      group.add(ceiling);
    }
  }

  _addWalls(group, tiles, materials, openAirTileKeys = new Set()) {
    const runs = this._collectBoundaryWallRuns(tiles, openAirTileKeys);

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
          RUIN_WALL_HEIGHT * 0.5,
          run.horizontal ? run.line * this.tileSize : ((run.start + run.end) * 0.5) * this.tileSize,
        ),
        halfWidth: run.horizontal ? lengthWorld * 0.5 : RUIN_WALL_THICKNESS * 0.5,
        halfDepth: run.horizontal ? RUIN_WALL_THICKNESS * 0.5 : lengthWorld * 0.5,
        verticalHalfHeight: RUIN_WALL_HEIGHT * 0.5,
        allowFlyOver: false,
        wallFacadeId: run.facadeId,
      };
    });
  }

  _collectBoundaryWallRuns(tiles, openAirTileKeys) {
    const buckets = new Map();

    for (const tile of tiles.values()) {
      if (openAirTileKeys.has(tileKey(tile.x, tile.z))) {
        continue;
      }

      for (const [dx, dz] of DIRECTIONS) {
        if (tiles.has(tileKey(tile.x + dx, tile.z + dz))) {
          continue;
        }

        const horizontal = dz !== 0;
        const line = horizontal ? tile.z + dz * 0.5 : tile.x + dx * 0.5;
        const axis = horizontal ? tile.x : tile.z;
        const ownerId = tile.roomId ?? tile.connectorId ?? tile.type ?? 'spatial';
        // Ownership changes do not create a physical corner. Build the facade
        // from the continuous silhouette, then retain per-axis ownership for
        // culling metadata and objective-biased accent placement.
        const key = `${horizontal ? 'h' : 'v'}:${dx}:${dz}:${line}`;
        let bucket = buckets.get(key);

        if (!bucket) {
          bucket = {
            horizontal,
            dx,
            dz,
            line,
            axes: new Set(),
            ownerByAxis: new Map(),
          };
          buckets.set(key, bucket);
        }

        bucket.axes.add(axis);
        bucket.ownerByAxis.set(axis, ownerId);
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
          facadeId: `${bucket.horizontal ? 'h' : 'v'}:${bucket.dx}:${bucket.dz}:${bucket.line}:${start}:${previous}`,
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
      RUIN_WALL_HEIGHT * 0.5,
      run.horizontal ? run.line * this.tileSize : ((run.start + run.end) * 0.5) * this.tileSize,
    );
    visualOwner.userData.cameraOcclusionOwner = true;
    visualOwner.userData.roomId = run.ownerId ?? null;
    visualOwner.userData.wallOwnerIds = [...(run.ownerIds ?? [])];
    visualOwner.userData.wallFacadeId = run.facadeId;
    const geometry = new THREE.BoxGeometry(
      run.horizontal ? lengthWorld : RUIN_WALL_THICKNESS,
      RUIN_WALL_HEIGHT,
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
    const rows = RUIN_WALL_TILE_ROWS;
    const tileHeight = RUIN_WALL_HEIGHT / rows;
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
        const localY = RUIN_WALL_HEIGHT * 0.5 - tileHeight * (row + 0.5);
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
        const material = this._pickWallMacroTileMaterial(materials, tileName);
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

  _pickWallMacroTileMaterial(materials, tileName) {
    const tiles = materials.wallMacroTiles;

    if (tileName === 'mm' && tiles?.mmAlt && this.random() < 0.72) {
      return tiles.mmAlt;
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

  _addVerticalConnectionPortals(group, connectionPlans = [], materials) {
    const portals = [];

    for (const plan of connectionPlans.filter((candidate) => candidate.level !== 0)) {
      for (const socket of [plan.fromSocket, plan.toSocket]) {
        const portal = new THREE.Group();
        const facesX = Math.abs(socket.facingX) > 0;
        const postGeometry = new THREE.BoxGeometry(
          facesX ? 0.16 : 0.18,
          2.8,
          facesX ? 0.18 : 0.16,
        );
        const headerGeometry = new THREE.BoxGeometry(
          facesX ? 0.18 : this.tileSize * 0.88,
          0.18,
          facesX ? this.tileSize * 0.88 : 0.18,
        );
        const sideOffsetX = facesX ? 0 : this.tileSize * 0.39;
        const sideOffsetZ = facesX ? this.tileSize * 0.39 : 0;

        portal.name = `verticalPortal_${socket.id}`;
        portal.position.set(socket.x * this.tileSize, socket.elevation, socket.z * this.tileSize);
        portal.userData.verticalPortal = {
          ...socket,
          connectionId: plan.id,
          purpose: plan.purpose,
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
  }) {
    if (!descriptor?.to || !placement?.point) {
      return null;
    }

    const room = descriptor.to;
    const alongX = placement.alongX;
    const halfW = Math.floor(room.width / 2);
    const halfD = Math.floor(room.depth / 2);
    const transverseMin = alongX
      ? (room.z - halfD - 0.5) * this.tileSize
      : (room.x - halfW - 0.5) * this.tileSize;
    const transverseMax = alongX
      ? (room.z + halfD + 0.5) * this.tileSize
      : (room.x + halfW + 0.5) * this.tileSize;
    const transverseCenter = alongX ? position.z : position.x;
    const portalSpan = this.tileSize * 0.94;
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
    const segmentDefinitions = [
      { side: 'left', min: transverseMin, max: openingMin },
      { side: 'right', min: openingMax, max: transverseMax },
    ];

    for (const segment of segmentDefinitions) {
      const span = segment.max - segment.min;
      if (span <= 0.05) {
        continue;
      }

      const segmentCenter = (segment.min + segment.max) * 0.5;
      const width = alongX ? RUIN_WALL_THICKNESS : span;
      const depth = alongX ? span : RUIN_WALL_THICKNESS;
      const wall = new THREE.Mesh(
        this._createTiledBoxGeometry(width, RUIN_WALL_HEIGHT, depth),
        [
          materials.wallMacroTiles.mm,
          materials.wallMacroTiles.mm,
          materials.wallTrim,
          materials.wallTrim,
          materials.wallMacroTiles.mm,
          materials.wallMacroTiles.mm,
        ],
      );
      wall.name = `doorThresholdWallWing_${segment.side}`;
      wall.position.set(
        alongX ? sealPlaneX : segmentCenter,
        position.y + RUIN_WALL_HEIGHT * 0.5,
        alongX ? segmentCenter : sealPlaneZ,
      );
      wall.castShadow = true;
      wall.receiveShadow = true;
      wall.userData.doorId = descriptor.id;
      wall.userData.roomId = room.id;
      wall.userData.thresholdSide = segment.side;
      // Threshold wings visually replace the boundary shell around a doorway,
      // so they must participate in the same camera-to-player occlusion test.
      // Own each wing independently: hiding one obstructing side must not make
      // the opposite, non-obstructing side of the doorway disappear.
      wall.userData.cameraOcclusionSurface = true;
      wall.userData.cameraOcclusionOwner = true;
      seal.add(wall);

      const zone = {
        id: `${descriptor.id}_thresholdWall_${segment.side}`,
        roomId: room.id,
        doorId: descriptor.id,
        label: 'Door threshold wall wing',
        obstacleKind: 'doorThresholdWall',
        position: wall.position.clone(),
        halfWidth: width * 0.5,
        halfDepth: depth * 0.5,
        verticalHalfHeight: RUIN_WALL_HEIGHT * 0.5,
        allowFlyOver: false,
        blocksPowerKnockback: true,
        thresholdSide: segment.side,
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
    const doors = [];

    for (const descriptor of descriptors) {
      const connectionPlan = connectionPlans.find((plan) => (
        plan.level === 0
        && plan.fromRoomId === descriptor.from.id
        && plan.toRoomId === descriptor.to.id
      ));
      const placement = resolveConnectionDoorPlacement(connectionPlan, descriptor.from, descriptor.to);
      const doorX = placement.point.x;
      const doorZ = placement.point.z;
      const thresholdTilePosition = this._tileToWorld(
        doorX,
        doorZ,
        tiles,
      );
      const position = thresholdTilePosition.clone();
      if (placement.thresholdAnchored && connectionPlan?.toSocket) {
        position.x += (connectionPlan.toSocket.facingX ?? 0) * this.tileSize * 0.5;
        position.z += (connectionPlan.toSocket.facingZ ?? 0) * this.tileSize * 0.5;
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
      });
      const door = new THREE.Group();
      door.name = descriptor.id;
      door.position.copy(position);

      const panelMaterial = descriptor.locked ? materials.lockedDoor : materials.door;
      const frame = new THREE.Group();
      frame.name = 'dungeonDoorFrame';
      const portalSpan = this.tileSize * 0.94;
      const panelSpan = portalSpan * 0.5;
      const slidingAxis = alongX ? 'z' : 'x';
      const leftPanelClosedOffset = -portalSpan * 0.25;
      const rightPanelClosedOffset = portalSpan * 0.25;
      const slidingOpenOffset = this.tileSize * 0.42;
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
        progressionTier: descriptor.progressionTier ?? null,
        fromRoomId: descriptor.from.id,
        toRoomId: descriptor.to.id,
        optional: Boolean(descriptor.optional),
        isShrineDoor: Boolean(descriptor.isShrineDoor),
        mechanismId: descriptor.mechanismId ?? null,
        pressurePlateId: descriptor.pressurePlateId ?? null,
        encounterId: descriptor.encounterId ?? null,
        opened: !descriptor.closed,
        alongX,
        slidingAxis,
        leftPanelClosedOffset,
        rightPanelClosedOffset,
        slidingOpenOffset,
        collisionHalfWidth: alongX ? 0.16 : this.tileSize * 0.48,
        collisionHalfDepth: alongX ? this.tileSize * 0.48 : 0.16,
        collisionHeight: RUIN_DOOR_HEIGHT,
        connectionPlanId: connectionPlan?.id ?? null,
        thresholdAnchored: Boolean(placement.thresholdAnchored),
        thresholdSeal: thresholdSeal?.object ?? null,
        thresholdWallZones: thresholdSeal?.wallZones ?? [],
        thresholdPortalSpan: thresholdSeal?.portalSpan ?? null,
        exitElevation: connectionPlan?.fromSocket.elevation ?? baseY,
        entranceElevation: connectionPlan?.toSocket.elevation ?? baseY,
        fromPortal: connectionPlan ? { ...connectionPlan.fromSocket } : null,
        toPortal: connectionPlan ? { ...connectionPlan.toSocket } : null,
      };
      door.userData.dungeonDoor = data;
      doors.push(data);
    }

    return doors;
  }

  _resolveConveyorConsoleTile(console, room, floorTiles = [], solidZones = [], reservedKeys = new Set()) {
    const halfW = Math.floor(room.width / 2);
    const halfD = Math.floor(room.depth / 2);
    const structuralColumns = new Set(
      floorTiles
        .filter((tile) => tile.roomId === room.id && tile.supportStyle === 'solid_mass')
        .map((tile) => tileKey(tile.x, tile.z)),
    );
    const unsafeElevatedColumns = new Set(
      floorTiles
        .filter((tile) => (
          tile.roomId === room.id
          && (tile.elevation ?? 0) > 0.2
          && tile.surface !== 'mechanicalPyramidSidePlatform'
        ))
        .map((tile) => tileKey(tile.x, tile.z)),
    );
    const candidates = floorTiles
      .filter((tile) => (
        tile.roomId === room.id
        && Math.abs(tile.elevation ?? 0) <= 0.05
        && Math.abs(tile.level ?? 0) <= 0.05
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
            focalPoint.elevation,
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
      const chest = {
        id: `ruinChest_${chestIndex + 1}`,
        object,
        position: position.clone(),
        opened: false,
        keycardChance,
        guaranteedKeycardId,
        containsKeycard: Boolean(guaranteedKeycardId),
        rareBoost: rareBoost || flavorRareChance >= 0.1,
        flavorRareChance,
        rewardTags: room?.rewardTags ?? [],
        roomId,
        floorKey: key,
      };
      landmarks.chests.push(chest);
      chestIndex += 1;
      return chest;
    };

    for (const tile of tiles.values()) {
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
    pad.position.set(position.x, 0.04, position.z);
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
      const allRoomTiles = this._getRoomFloorTiles(room, navigableFloorTiles)
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
      const candidates = reachableCandidates.filter((tile) => {
        const xEdgeInset = halfRoomWidth - Math.abs(tile.x - room.x);
        const zEdgeInset = halfRoomDepth - Math.abs(tile.z - room.z);
        return !(xEdgeInset <= 1 && zEdgeInset <= 1);
      });
      if (room.type === 'keycard') {
        const summitY = room.mechanicalPyramidCenter?.elevation ?? 4;
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
      const groundCandidates = candidates.filter((tile) => Math.abs(tile.elevation ?? 0) <= 0.6);
      const elevatedCandidates = candidates.filter((tile) => (tile.elevation ?? 0) > 0.6);
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
      points.push(this._tileToWorld(room.x + dx, room.z + dz, tiles));
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
        position: this._tileToWorld(room.x, room.z),
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

  _roomLocalToWorld(room, localX, localZ, elevation = 0) {
    const rotationY = room.prefabYaw ?? 0;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    return new THREE.Vector3(
      room.x * this.tileSize + localX * cos - localZ * sin,
      elevation,
      room.z * this.tileSize + localX * sin + localZ * cos,
    );
  }

  _createTrapZones(rooms, floorTiles, trapVisualsByRoom = new Map()) {
    return rooms
      .filter((room) => room.type === 'trap')
      .map((room) => {
        const trapTile = this._findRoomFloorTile(room, floorTiles, ['basementFloor'])
          ?? { x: room.x, z: room.z, elevation: 0 };
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
        roster: this._createEncounterRoster('boss'),
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
        if ((enemyEffects?.countMultiplier ?? 1) >= 1.05) {
          const tags = enemyEffects?.favoredTags ?? [];
          const extraType = tags.some((tag) => tag.includes('turret') || tag.includes('sensor'))
            ? 'ranged'
            : tags.some((tag) => tag.includes('crawler') || tag.includes('swarm'))
              ? 'fast'
              : 'basic';
          roster.push(extraType);
        } else if ((enemyEffects?.countMultiplier ?? 1) < 0.95 && roster.length > 2) {
          roster.pop();
        }
        const reinforcement = definition.isBoss
          ? 'fast'
          : roster.find((type) => type === 'fast' || type === 'basic' || type === 'horokko') ?? 'basic';
        roster.push(reinforcement);
        roster.sort((left, right) => Number(left === 'ranged') - Number(right === 'ranged'));
        const pyramid = definition.id === 'keycardGuard'
          ? room.mechanicalPyramidCenter
          : null;
        const triggerZone = pyramid ? {
          id: `${definition.id}SummitTrigger`,
          roomId: room.id,
          position: new THREE.Vector3(
            pyramid.x * this.tileSize,
            pyramid.elevation,
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
          enemyTags: enemyEffects?.favoredTags ?? [],
          enemySuppressedTags: enemyEffects?.suppressedTags ?? [],
          enemyHealthMultiplier: enemyEffects?.healthMultiplier ?? 1,
          enemyBehaviorModifiers: enemyEffects?.behaviorModifiers ?? [],
          zone: {
            id: `${definition.id}Zone`,
            roomId: room.id,
            position: this._tileToWorld(room.x, room.z),
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
