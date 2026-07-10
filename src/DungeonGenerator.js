import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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
const COOLANT_RELAY_ROOM_MODEL = `${RUIN_ROOM_MODEL_BASE_PATH}industrial_coolant_relay_puzzle_room.glb`;
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
const RUIN_WALL_TILE_ROWS = 3;
const RUIN_CEILING_THICKNESS = 0.12;
const RUIN_DOOR_HEIGHT = 4.8;
const RUIN_DOOR_OPEN_Y = -5.3;
const RUIN_FACTORY_ELEVATION = 1.05;
const RUIN_OVERHEAD_GANTRY_HEIGHT = 4.35;
const RUIN_BASEMENT_ELEVATION = -3.2;
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

    for (let attempt = 0; attempt < 8; attempt += 1) {
      lastDungeon = this._generateOnce();
      if (lastDungeon.progression?.validation?.accepted) {
        lastDungeon.generationAttempts = attempt + 1;
        return lastDungeon;
      }
    }

    const errors = lastDungeon?.progression?.validation?.errors ?? ['Unknown dungeon validation failure.'];
    throw new Error(`Unable to generate a solvable vertical dungeon after 8 attempts: ${errors.join(' | ')}`);
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
      { id: 'keycardRoom', type: 'keycard', x: keycardX, z: keycardZ, width: this._choose([15, 17]), depth: 13 },
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
      x: conveyorX + bonusSide * this._randomInt(15, 19),
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
    setTile(tiles, bonusVault.x, bonusVault.z, 'chest', { forceType: true });

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
      const elevation = tile.elevation ?? 0;
      const mesh = this._createFloorTileMesh(tile, materials);
      mesh.name = `dungeonTile_${tile.type}_level${tile.level ?? 0}`;
      mesh.userData.floorTile = {
        x: tile.x,
        z: tile.z,
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
        isPlatformingSurface: Boolean(tile.isPlatformingSurface),
        isLedgeSurface: Boolean(tile.isLedgeSurface),
        platformPurpose: tile.platformPurpose,
        requiredTraversalAction: tile.requiredTraversalAction,
      };
      mesh.receiveShadow = true;
      group.add(mesh);

      this._addTileDetail(group, tile, materials);
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
    this._addWalls(group, tiles, materials, openAirTileKeys);
    this._addInvisibleOpenAirBounds(group, tiles, materials, openAirTileKeys);
    const doors = this._addDoors(group, rooms, materials, tiles, connectionPlans);
    const criticalDoorValidation = this._validateCriticalDoorChokepoints({
      floorTiles,
      rooms,
      solidZones,
      doors,
    });
    const verticalPortals = this._addVerticalConnectionPortals(group, connectionPlans, materials);
    const landmarks = this._addRoomLandmarks(group, rooms, materials, tiles, floorTiles, solidZones);
    landmarks.platforms.push(...this._createGeneratedPlatformSurfaces(floorTiles));
    const encounters = this._createEncounterDefinitions(rooms, floorTiles);
    const trapVisualsByRoom = new Map(landmarks.trapVisuals.map((entry) => [entry.roomId, entry.object]));

    const enemySpawnPoints = rooms
      .filter((room) => !['hub', 'camp', 'entrance', 'bonus'].includes(room.type))
      .flatMap((room) => this._roomSpawnPoints(room, floorTiles));
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
      safeInteractables: landmarks.safeInteractables,
      safeZones: this._createRoomZones(rooms, 'hub').concat(this._createRoomZones(rooms, 'camp')),
      solidZones,
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
    };
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
        const isDoorPinch = Boolean(plan.doorId) && Math.abs(index - midpoint) <= 2;
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
    const progressionAccessTileKeys = this._createProgressionAccessTileKeys(tiles, rooms);
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
        (progressionAccessTileKeys.has(columnKey) || coolantFixtureTileKeys.has(columnKey))
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
          pushExtra(x, z, {
            type,
            elevation,
            level,
            surface,
            roomId: room.id,
            directionX: dx,
            directionZ: dz,
            speed: conveyorSpeed,
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
    const addRampLandingPath = (room, fromPoint, elevation, level) => {
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

      for (let i = 0; i < rampPoints.length; i += 1) {
        const point = rampPoints[i];
        const previous = rampPoints[i - 1] ?? point;
        const next = rampPoints[i + 1] ?? point;
        const directionX = Math.sign((next.x - point.x) || (point.x - previous.x));
        const directionZ = Math.sign((next.z - point.z) || (point.z - previous.z));
        const t = i / span;
        const startT = Math.max(0, (i - 0.5) / span);
        const endT = Math.min(1, (i + 0.5) / span);
        const elevation = THREE.MathUtils.lerp(fromElevation, toElevation, t);
        const options = {
          type: 'floor',
          elevation,
          level: Math.round((fromLevel + (toLevel - fromLevel) * t) * 100) / 100,
          surface: 'industrialRamp',
          roomId: room?.id,
          rampStartElevation: THREE.MathUtils.lerp(fromElevation, toElevation, startT),
          rampEndElevation: THREE.MathUtils.lerp(fromElevation, toElevation, endT),
          rampDirectionX: directionX,
          rampDirectionZ: directionZ,
        };
        const tile = useBaseFloor
          ? markBase(point.x, point.z, options)
          : pushExtra(point.x, point.z, options);

        if (tile && risePerTile > RUIN_RAMP_MAX_STEP) {
          tile.steepRamp = true;
        }
      }

      addRampLandingPath(room, rampPoints[0], fromElevation, fromLevel);
      addRampLandingPath(room, rampPoints[rampPoints.length - 1], toElevation, toLevel);
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
      if (coolantFixtureTileKeys.has(tileKey(chainTile.x, chainTile.z))) {
        return null;
      }

      for (let distance = 1; distance <= rampLength; distance += 1) {
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
        x: chainTile.x + direction[0] * rampLength,
        z: chainTile.z + direction[1] * rampLength,
      };

      return {
        room,
        chainTile,
        points: [start, { x: chainTile.x, z: chainTile.z }],
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
      addRampRun(serverRoom, [
        { x: serverRoom.x + halfW - 1, z: serverRoom.z + halfD - 1 },
        { x: serverRoom.x + halfW - 1, z: serverRoom.z - halfD + 3 },
      ], 0, RUIN_SECOND_FLOOR_ELEVATION, 0, 1);
    }

    const keycardRoom = roomById.get('keycardRoom');
    if (keycardRoom) {
      const halfW = Math.floor(keycardRoom.width / 2);
      const halfD = Math.floor(keycardRoom.depth / 2);
      addDeck(keycardRoom, {
        level: 1,
        elevation: RUIN_SECOND_FLOOR_ELEVATION,
        surface: 'secondFloor',
        minX: keycardRoom.x - 2,
        maxX: keycardRoom.x + 3,
        minZ: keycardRoom.z + halfD - 4,
        maxZ: keycardRoom.z + halfD,
      });
      addRampRun(keycardRoom, [
        { x: keycardRoom.x - halfW + 1, z: keycardRoom.z - halfD + 1 },
        { x: keycardRoom.x - halfW + 1, z: keycardRoom.z + halfD - 4 },
        { x: keycardRoom.x - 2, z: keycardRoom.z + halfD - 4 },
      ], 0, RUIN_SECOND_FLOOR_ELEVATION, 0, 1);

      const pyramidCenters = [
        { x: keycardRoom.x + halfW - 3, z: keycardRoom.z },
        { x: keycardRoom.x - halfW + 3, z: keycardRoom.z },
        { x: keycardRoom.x, z: keycardRoom.z + halfD - 3 },
        { x: keycardRoom.x, z: keycardRoom.z - halfD + 3 },
      ];
      const pyramidCenter = pyramidCenters.find((center) => {
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            const x = center.x + dx;
            const z = center.z + dz;
            if (!tiles.has(tileKey(x, z)) || progressionAccessTileKeys.has(tileKey(x, z))) {
              return false;
            }
          }
        }
        return true;
      });

      if (pyramidCenter) {
        const platformGroupId = `${keycardRoom.id}_mechanicalPyramidTerrace`;
        const apexPlatformGroupId = `${keycardRoom.id}_mechanicalPyramidApex`;
        keycardRoom.mechanicalPyramidCenter = {
          ...pyramidCenter,
          elevation: RUIN_JUMP_PLATFORM_ELEVATION * 2,
          platformGroupId,
          apexPlatformGroupId,
        };
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            pushExtra(pyramidCenter.x + dx, pyramidCenter.z + dz, {
              type: 'floor',
              elevation: RUIN_JUMP_PLATFORM_ELEVATION,
              level: 0.5,
              surface: 'mechanicalPyramidSummit',
              roomId: keycardRoom.id,
              isPlatformingSurface: true,
              platformGroupId,
              platformPurpose: 'required_keycard_pyramid_processional_terrace',
              requiredTraversalAction: 'jump',
            });
          }
        }
        pushExtra(pyramidCenter.x, pyramidCenter.z, {
          type: 'floor',
          elevation: RUIN_JUMP_PLATFORM_ELEVATION * 2,
          level: 0.75,
          surface: 'mechanicalPyramidApex',
          roomId: keycardRoom.id,
          isPlatformingSurface: true,
          platformGroupId: apexPlatformGroupId,
          platformPurpose: 'required_keycard_pyramid_apex',
          requiredTraversalAction: 'jump',
        });
      }
    }

    const trapRoom = roomById.get('trapRoom');
    if (trapRoom) {
      const halfW = Math.floor(trapRoom.width / 2);
      const halfD = Math.floor(trapRoom.depth / 2);
      markBaseRect(trapRoom, {
        level: -1,
        elevation: RUIN_BASEMENT_ELEVATION,
        surface: 'basementFloor',
        minX: trapRoom.x - 2,
        maxX: trapRoom.x + 2,
        minZ: trapRoom.z - 2,
        maxZ: trapRoom.z + 2,
      });
      addRampRun(trapRoom, [
        { x: trapRoom.x + halfW - 1, z: trapRoom.z - halfD + 1 },
        { x: trapRoom.x + halfW - 1, z: trapRoom.z },
        { x: trapRoom.x + 2, z: trapRoom.z },
      ], 0, RUIN_BASEMENT_ELEVATION, 0, -1);
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
        level: -1,
        elevation: RUIN_BASEMENT_ELEVATION,
        surface: 'refractorWell',
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
      });
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
      const halfW = Math.floor(bonusRoom.width / 2);
      const halfD = Math.floor(bonusRoom.depth / 2);
      markBaseRect(bonusRoom, {
        elevation: RUIN_BASEMENT_ELEVATION,
        level: -1,
        surface: 'basementFloor',
        minX: bonusRoom.x - 2,
        maxX: bonusRoom.x + 2,
        minZ: bonusRoom.z - 2,
        maxZ: bonusRoom.z + 2,
      });
      addRampRun(bonusRoom, [
        { x: bonusRoom.x - halfW + 1, z: bonusRoom.z + halfD - 1 },
        { x: bonusRoom.x + 2, z: bonusRoom.z + halfD - 1 },
        { x: bonusRoom.x + 2, z: bonusRoom.z + 2 },
      ], 0, RUIN_BASEMENT_ELEVATION, 0, -1);
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

    return extraTiles;
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

    if (rise > 0 && rise <= PLAYER_TRAVERSAL_ENVELOPE.maximumNormalJumpRise + 0.02) {
      return 'jump';
    }
    if (
      rise > 0
      && rise <= PLAYER_TRAVERSAL_ENVELOPE.maximumLedgeClimbRise + 0.02
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
    const roomTiles = this._getRoomFloorTiles(room, floorTiles);
    const startTile = this._findRoomFloorTile(room, roomTiles, []);
    const reachable = this._createReachableFloorTileKeySet(startTile, floorTiles);

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
        if (tile && ['hallway', 'entrance', 'hub', 'camp'].includes(tile.type)) {
          addClearance(point.x, point.z);
        }
      }

      const doorX = Math.round((fromRoom.x + toRoom.x) * 0.5);
      const doorZ = Math.round((fromRoom.z + toRoom.z) * 0.5);
      addClearance(doorX, doorZ);
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
      if (tile) {
        this._resetProgressionAccessTile(tile);
      }
    }

    for (let index = extraTiles.length - 1; index >= 0; index -= 1) {
      const tile = extraTiles[index];
      const isClearOverpass = this._isClearProgressionOverpass(tile);
      if (progressionAccessTileKeys.has(tileKey(tile.x, tile.z)) && !isClearOverpass) {
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
    for (const tile of floorTiles.filter((candidate) => candidate.isPlatformingSurface)) {
      const key = tileKey(tile.x, tile.z);
      blockingTops.set(key, Math.max(blockingTops.get(key) ?? -Infinity, tile.elevation ?? 0));
    }
    return blockingTops;
  }

  _isFloorTileBlockedByGeneratedPlatform(tile, blockingTops = new Map()) {
    if (!tile || tile.isPlatformingSurface) {
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
    const playerRadius = PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
    const halfWidth = (door.collisionHalfWidth ?? (door.alongX ? 0.16 : this.tileSize * 0.48)) + playerRadius;
    const halfDepth = (door.collisionHalfDepth ?? (door.alongX ? this.tileSize * 0.48 : 0.16)) + playerRadius;
    const baseY = door.baseY ?? door.position.y ?? 0;
    const height = door.collisionHeight ?? RUIN_DOOR_HEIGHT;

    return Math.abs(position.x - door.position.x) <= halfWidth
      && Math.abs(position.z - door.position.z) <= halfDepth
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
    const criticalDoors = doors.filter((door) => door.requiresKeycard && !door.optional);
    const blockingPlatformTops = this._createBlockingPlatformColumnMap(floorTiles);

    for (const door of criticalDoors) {
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
      const elevatedBlocker = column.find((tile) => (
        (tile.surface === 'industrialRamp'
          || tile.surface === 'rampLanding'
          || Math.abs(tile.level ?? 0) > 0.05)
        && !(
          this._isClearProgressionOverpass(tile)
        )
      ));

      if (!baseTile) {
        errors.push(`Progression access tile ${x},${z} has no clear base-floor footing.`);
      }
      if (elevatedBlocker) {
        errors.push(`Progression access tile ${x},${z} is obstructed by ${elevatedBlocker.surface ?? elevatedBlocker.type}.`);
      }
    }

    const startRoom = roomById.get('hubTown') ?? roomById.get('expeditionCamp') ?? rooms[0];
    const startTile = this._findRoomWalkabilityStartTile(startRoom, floorTiles);
    const reachable = this._createReachableFloorTileKeySet(startTile, floorTiles);
    const progressionRoomIds = new Set(PROGRESSION_CONNECTIONS.flatMap(([fromRoomId, toRoomId]) => [
      fromRoomId,
      toRoomId,
    ]));

    for (const roomId of progressionRoomIds) {
      const room = roomById.get(roomId);
      if (!room) {
        continue;
      }

      const roomStartTile = this._findRoomWalkabilityStartTile(room, floorTiles);
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

  _createGeneratedPlatformSurfaces(floorTiles = []) {
    const surfaces = floorTiles
      .filter((tile) => tile.isLedgeSurface || (tile.isPlatformingSurface && !tile.platformGroupId))
      .map((tile) => ({
        id: `${tile.isLedgeSurface ? 'generatedLedge' : 'generatedPlatform'}_${tile.x}_${tile.z}_${tile.level}`,
        roomId: tile.roomId,
        floorKey: this._getFloorTileGraphKey(tile),
        center: new THREE.Vector3(tile.x * this.tileSize, tile.elevation ?? 0, tile.z * this.tileSize),
        halfWidth: this.tileSize * 0.46,
        halfDepth: this.tileSize * 0.46,
        topY: tile.elevation ?? 0,
        baseY: 0,
        blocksBelow: !tile.isLedgeSurface,
        generated: true,
        purpose: tile.platformPurpose ?? (tile.isLedgeSurface ? 'matched_elevation_portal_landing' : null),
        requiredTraversalAction: tile.requiredTraversalAction ?? (tile.isLedgeSurface ? 'ledge_climb' : null),
      }));
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
        const pyramidSummitTiles = this._getRoomFloorTiles(room, navigableTiles)
          .filter((tile) => tile.surface === 'mechanicalPyramidSummit');
        const pyramidApexTiles = this._getRoomFloorTiles(room, navigableTiles)
          .filter((tile) => tile.surface === 'mechanicalPyramidApex');
        if (!room.mechanicalPyramidCenter
          || pyramidSummitTiles.length !== 9
          || pyramidApexTiles.length !== 1) {
          errors.push(`${room.id} does not contain the required mechanical pyramid terrace and apex.`);
        }
      }

      const highestElevation = Math.max(0, ...reachableRoomTiles.map((tile) => tile.elevation ?? 0));
      if (Number.isFinite(room.ceilingHeight)
        && highestElevation + PLAYER_TRAVERSAL_ENVELOPE.headClearance > room.ceilingHeight) {
        errors.push(`${room.id} lacks ceiling clearance above its highest reachable tier.`);
      }
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
        platformNodeCount: rooms.reduce((count, room) => count + (room.platformNodes?.length ?? 0), 0),
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
          ? 'Basement maintenance ramp'
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
          ? (room.type === 'trap' || room.type === 'bonus' || room.type === 'coolant' ? [-1, 0] : [0])
          : room.type === 'trap' || room.type === 'bonus'
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

    return materials.floorByType[tile.type] ?? materials.floor;
  }

  _addTileDetail(group, tile, materials) {
    const position = this._tileToWorld(tile.x, tile.z);
    const elevation = tile.elevation ?? 0;

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

  _addSolidTraversalVolumes(group, floorTiles = [], rooms = [], materials) {
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
        new THREE.BoxGeometry(
          (maxX - minX + 1) * this.tileSize * 0.96,
          height,
          (maxZ - minZ + 1) * this.tileSize * 0.96,
        ),
        materials.raisedDeckFloor,
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
      if (!Number.isFinite(startY) || !Number.isFinite(endY) || Math.max(startY, endY) <= 0.18) {
        return null;
      }
      const bottomY = Math.min(0, startY, endY) - 0.08;
      const halfWidth = this.tileSize * 0.48;
      const halfLength = this.tileSize * run.length * 0.5;
      const topStart = startY - 0.1;
      const topEnd = endY - 0.1;
      const vertices = new Float32Array([
        -halfWidth, bottomY, -halfLength,
        halfWidth, bottomY, -halfLength,
        halfWidth, bottomY, halfLength,
        -halfWidth, bottomY, halfLength,
        -halfWidth, topStart, -halfLength,
        halfWidth, topStart, -halfLength,
        halfWidth, topEnd, halfLength,
        -halfWidth, topEnd, halfLength,
      ]);
      const indices = [
        0, 2, 1, 0, 3, 2,
        4, 5, 6, 4, 6, 7,
        0, 1, 5, 0, 5, 4,
        1, 2, 6, 1, 6, 5,
        2, 3, 7, 2, 7, 6,
        3, 0, 4, 3, 4, 7,
      ];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
        0, 0, 1, 0, 1, run.length, 0, run.length,
        0, 0, 1, 0, 1, run.length, 0, run.length,
      ]), 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const wedge = new THREE.Mesh(geometry, materials.industrialRamp);
      wedge.name = run.length > 1
        ? 'largeTexturedIndustrialSlopeVolume'
        : 'solidIndustrialSlopeVolume';
      wedge.position.set(
        (first.x + last.x) * this.tileSize * 0.5,
        0,
        (first.z + last.z) * this.tileSize * 0.5,
      );
      const directionX = Math.sign(first.rampDirectionX ?? 0);
      const directionZ = Math.sign(first.rampDirectionZ ?? 0);
      wedge.rotation.y = directionX > 0
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
      return wedge;
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

      this._addFactoryTileSupports(group, tile, materials);

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
    const elevation = tile.elevation ?? 0;
    const wallHeight = Math.abs(elevation);
    const y = elevation + wallHeight * 0.5;
    const baseX = tile.x * this.tileSize;
    const baseZ = tile.z * this.tileSize;

    for (const [dx, dz] of DIRECTIONS) {
      if (this._findSameFloorNeighbor(floorTileLookup, tile, dx, dz)) {
        continue;
      }

      const horizontal = dz !== 0;
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(
          horizontal ? this.tileSize : RUIN_WALL_THICKNESS,
          wallHeight,
          horizontal ? RUIN_WALL_THICKNESS : this.tileSize,
        ),
        materials.supportMetal,
      );
      wall.name = 'factoryBasementRetainingWall';
      wall.position.set(
        baseX + dx * this.tileSize * 0.5,
        y,
        baseZ + dz * this.tileSize * 0.5,
      );
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
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
      if (tile.surface === 'industrialRamp' || tile.surface === 'jumpPlatform') {
        continue;
      }
      if (openAirTileKeys.has(tileKey(tile.x, tile.z))) {
        continue;
      }
      if (!RAIL_ELIGIBLE_FACTORY_SURFACES.has(tile.surface)) {
        continue;
      }

      for (const [dx, dz] of DIRECTIONS) {
        const sameFloorNeighbor = this._findSameFloorNeighbor(floorTileLookup, tile, dx, dz);
        if (sameFloorNeighbor) {
          continue;
        }

        const adjacentColumn = floorTileLookup.get(tileKey(tile.x + dx, tile.z + dz)) ?? [];
        const hasRampOrAccessNeighbor = adjacentColumn.some((candidate) => (
          candidate.surface === 'industrialRamp'
          || candidate.type === 'hallway'
          || candidate.type === 'entrance'
        ));

        if (hasRampOrAccessNeighbor) {
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

    for (const bucket of buckets.values()) {
      bucket.axes.sort((a, b) => a - b);

      let start = bucket.axes[0];
      let previous = start;

      const flush = () => {
        const lengthTiles = previous - start + 1;
        const lengthWorld = lengthTiles * this.tileSize * 0.96;
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
        group.add(rail);

        const postGeometry = new THREE.BoxGeometry(
          RUIN_RAIL_THICKNESS,
          RUIN_RAIL_HEIGHT,
          RUIN_RAIL_THICKNESS,
        );
        const postAxes = [];
        for (let axis = start; axis <= previous; axis += 2) {
          postAxes.push(axis);
        }
        if (postAxes.at(-1) !== previous) {
          postAxes.push(previous);
        }
        for (const axis of postAxes) {
          const post = new THREE.Mesh(postGeometry, materials.factoryRail);
          post.name = 'factoryCatwalkRailPost';
          post.position.set(
            bucket.horizontal ? axis * this.tileSize : bucket.line * this.tileSize,
            bucket.elevation + RUIN_RAIL_HEIGHT * 0.5,
            bucket.horizontal ? bucket.line * this.tileSize : axis * this.tileSize,
          );
          post.castShadow = true;
          post.receiveShadow = true;
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
      keycard: ['keycard', 'secondFloor'],
      trap: ['basementFloor', 'industrialRamp'],
      conveyor: ['conveyor', 'conveyorPuzzleBelt', 'conveyorBridge', 'secondFloorConveyor', 'thirdFloorGantry'],
      boss: ['boss', 'raisedDeck', 'catwalk', 'thirdFloorGantry'],
      shrine: ['shrine', 'reveredMezzanine', 'refractorDais'],
      bonus: ['basementFloor'],
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
        if (ENABLE_PROCEDURAL_RAISED_ROOM_LEVELS) {
          addBox(fallback, 'coolantBalconyInnerRail', 0, -halfD * 0.7, halfW * 1.16, 0.08, 0.1, materials.factoryRail, RUIN_SECOND_FLOOR_ELEVATION + 0.76);
          addBox(fallback, 'coolantBalconyOuterRail', 0, -halfD * 0.94, halfW * 1.16, 0.08, 0.1, materials.factoryRail, RUIN_SECOND_FLOOR_ELEVATION + 0.76);
        }
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
          addBox(fallback, 'machinePressLeftLeg', -1.15, z, 0.18, 1.45, 0.32, materials.supportMetal, 0.72);
          addBox(fallback, 'machinePressRightLeg', 1.15, z, 0.18, 1.45, 0.32, materials.supportMetal, 0.72);
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
        if (ENABLE_PROCEDURAL_RAISED_ROOM_LEVELS) {
          addBox(fallback, 'machineLeftCatwalkRail', -halfW * 0.72, 0, 0.1, 0.08, halfD * 1.3, materials.factoryRail, RUIN_SECOND_FLOOR_ELEVATION + 0.78);
          addBox(fallback, 'machineRightCatwalkRail', halfW * 0.72, 0, 0.1, 0.08, halfD * 1.3, materials.factoryRail, RUIN_SECOND_FLOOR_ELEVATION + 0.78);
        }

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
        if (ENABLE_PROCEDURAL_RAISED_ROOM_LEVELS) {
          addBox(fallback, 'alienServerNorthCatwalkRail', 0, -halfD * 0.7, halfW * 1.32, 0.08, 0.1, materials.factoryRail, RUIN_SECOND_FLOOR_ELEVATION + 0.78);
          addBox(fallback, 'alienServerEastCatwalkRail', halfW * 0.7, 0, 0.1, 0.08, halfD * 1.18, materials.factoryRail, RUIN_SECOND_FLOOR_ELEVATION + 0.78);
        }

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
      const layers = [
        { bottom: this.tileSize * 2.06, top: this.tileSize * 1.82, height: 0.45, y: 0.225, material: materials.wallTrim },
        { bottom: this.tileSize * 1.8, top: this.tileSize * 1.62, height: 0.45, y: 0.675, material: materials.supportMetal },
        { bottom: this.tileSize * 1.6, top: this.tileSize * 1.43, height: 0.45, y: 1.125, material: materials.raisedDeckFloor },
        { bottom: this.tileSize * 1.42, top: this.tileSize * 1.18, height: 0.45, y: 1.575, material: materials.wallTrim },
        { bottom: this.tileSize * 1.16, top: this.tileSize * 0.9, height: 0.45, y: 2.025, material: materials.supportMetal },
        { bottom: this.tileSize * 0.88, top: this.tileSize * 0.7, height: 0.45, y: 2.475, material: materials.raisedDeckFloor },
      ];
      for (const [index, layer] of layers.entries()) {
        const mesh = addMesh(
          prefab,
          `reverentMechanicalPyramidLayer${index + 1}`,
          new THREE.CylinderGeometry(layer.top, layer.bottom, layer.height, 4, 1),
          layer.material,
          0,
          layer.y,
          0,
        );
        mesh.rotation.y = Math.PI / 4;
      }
      for (const [x, z] of [[-3.35, -3.35], [3.35, -3.35], [-3.35, 3.35], [3.35, 3.35]]) {
        addCylinder(prefab, 'pyramidHydraulicColumn', 0.18, 0.3, 2.72, materials.factoryRail, x, 1.36, z, 14);
        addMesh(prefab, 'pyramidRefractorNode', new THREE.OctahedronGeometry(0.2, 0), materials.glowYellow, x, 2.84, z);
      }
      const summit = addMesh(prefab, 'pyramidKeycardSummitGlyph', new THREE.TorusGeometry(1.15, 0.08, 10, 4), materials.glowBlue, 0, 2.74, 0);
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
        const key = `${horizontal ? 'h' : 'v'}:${dx}:${dz}:${line}`;
        let bucket = buckets.get(key);

        if (!bucket) {
          bucket = {
            horizontal,
            dx,
            dz,
            line,
            axes: new Set(),
          };
          buckets.set(key, bucket);
        }

        bucket.axes.add(axis);
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
        runs.push({
          horizontal: bucket.horizontal,
          dx: bucket.dx,
          dz: bucket.dz,
          line: bucket.line,
          start,
          end: previous,
          lengthTiles: previous - start + 1,
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
    const geometry = new THREE.BoxGeometry(
      run.horizontal ? lengthWorld : RUIN_WALL_THICKNESS,
      RUIN_WALL_HEIGHT,
      run.horizontal ? RUIN_WALL_THICKNESS : lengthWorld,
    );
    const wall = new THREE.Mesh(geometry, materials.wall);
    const axisCenter = ((run.start + run.end) * 0.5) * this.tileSize;

    wall.name = 'dungeonBoundaryWall';
    wall.position.set(
      run.horizontal ? axisCenter : run.line * this.tileSize,
      RUIN_WALL_HEIGHT * 0.5,
      run.horizontal ? run.line * this.tileSize : axisCenter,
    );
    wall.userData.wallRun = {
      horizontal: run.horizontal,
      dx: run.dx,
      dz: run.dz,
      line: run.line,
      start: run.start,
      end: run.end,
      lengthTiles: run.lengthTiles,
    };
    wall.castShadow = true;
    wall.receiveShadow = true;

    this._addMacroWallFace(wall, run, lengthWorld, materials);
    group.add(wall);
  }

  _addMacroWallFace(wall, run, lengthWorld, materials) {
    const faceOffset = RUIN_WALL_THICKNESS * 0.5 + RUIN_WALL_FACE_OFFSET;
    const addFace = (normalX, normalZ) => {
      this._addMacroWallTileGrid(wall, run, lengthWorld, materials, normalX, normalZ, faceOffset);
    };

    if (run.horizontal) {
      addFace(0, -run.dz);
      addFace(0, run.dz);
    } else {
      addFace(-run.dx, 0);
      addFace(run.dx, 0);
    }
  }

  _addMacroWallTileGrid(wall, run, lengthWorld, materials, normalX, normalZ, faceOffset) {
    const columns = Math.max(
      3,
      Math.round(lengthWorld / (RUIN_WALL_HEIGHT / RUIN_WALL_TILE_ROWS)),
    );
    const rows = RUIN_WALL_TILE_ROWS;
    const tileWidth = lengthWorld / columns;
    const tileHeight = RUIN_WALL_HEIGHT / rows;
    const geometry = new THREE.PlaneGeometry(
      tileWidth + RUIN_WALL_TILE_OVERLAP,
      tileHeight + RUIN_WALL_TILE_OVERLAP,
    );

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const tileName = this._getWallMacroTileName(column, row, columns, rows);
        const tile = new THREE.Mesh(
          geometry,
          this._pickWallMacroTileMaterial(materials, tileName),
        );
        const along = -lengthWorld * 0.5 + tileWidth * (column + 0.5);

        tile.name = 'dungeonBoundaryWallMacroTile';
        tile.receiveShadow = true;
        tile.position.y = RUIN_WALL_HEIGHT * 0.5 - tileHeight * (row + 0.5);

        if (run.horizontal) {
          tile.position.x = along;
          tile.position.z = normalZ * faceOffset;
          tile.rotation.y = normalZ >= 0 ? 0 : Math.PI;
        } else {
          tile.position.x = normalX * faceOffset;
          tile.position.z = along;
          tile.rotation.y = normalX >= 0 ? Math.PI / 2 : -Math.PI / 2;
        }

        wall.add(tile);
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

  _addDoors(group, rooms, materials, tiles = null, connectionPlans = []) {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const descriptors = [
      { id: 'entranceDoor', from: roomById.get('expeditionCamp'), to: roomById.get('entrance'), locked: false, closed: false, label: 'Ruin Entrance' },
      { id: 'enemyNestGate', from: roomById.get('enemyNest'), to: roomById.get('keycardRoom'), locked: true, closed: true, encounterId: 'enemyNest', label: 'Security Gate' },
      { id: 'Door_Alpha', from: roomById.get('keycardRoom'), to: roomById.get('trapRoom'), locked: true, closed: true, requiresKeycard: true, requiredKeycardId: 'Keycard_Alpha', progressionTier: 1, label: 'Security Door Alpha' },
      { id: 'Door_Beta', from: roomById.get('trapRoom'), to: roomById.get('conveyorRoom'), locked: true, closed: true, requiresKeycard: true, requiredKeycardId: 'Keycard_Beta', progressionTier: 2, label: 'Security Door Beta' },
      { id: 'Door_Gamma', from: roomById.get('conveyorRoom'), to: roomById.get('bossRoom'), locked: true, closed: true, requiresKeycard: true, requiredKeycardId: 'Keycard_Gamma', progressionTier: 3, label: 'Security Door Gamma' },
      { id: 'bonusVaultDoor', from: roomById.get('conveyorRoom'), to: roomById.get('bonusVault'), locked: true, closed: true, pressurePlateId: 'conveyorVaultPlate', optional: true, label: 'Bonus Vault' },
      { id: 'Door_Shrine', from: roomById.get('bossRoom'), to: roomById.get('shrineRoom'), locked: true, closed: true, requiresKeycard: true, requiredKeycardId: 'Shrine_Key', progressionTier: 'Final', isShrineDoor: true, label: 'Refractor Shrine Door' },
    ];
    const doors = [];

    for (const descriptor of descriptors) {
      const connectionPlan = connectionPlans.find((plan) => (
        plan.level === 0
        && plan.fromRoomId === descriptor.from.id
        && plan.toRoomId === descriptor.to.id
      ));
      const plannedPath = connectionPlan?.bridgePath ?? [];
      const midpointIndex = Math.floor((plannedPath.length - 1) * 0.5);
      const straightDoorIndices = plannedPath
        .map((point, index) => ({ point, index }))
        .filter(({ index }) => {
          const previous = plannedPath[index - 1];
          const next = plannedPath[index + 1];
          return previous && next
            && (previous.x === next.x || previous.z === next.z);
        })
        .sort((a, b) => Math.abs(a.index - midpointIndex) - Math.abs(b.index - midpointIndex));
      const plannedDoorIndex = straightDoorIndices[0]?.index ?? midpointIndex;
      const plannedDoorPoint = plannedPath[plannedDoorIndex];
      const doorX = plannedDoorPoint?.x ?? Math.round((descriptor.from.x + descriptor.to.x) * 0.5);
      const doorZ = plannedDoorPoint?.z ?? Math.round((descriptor.from.z + descriptor.to.z) * 0.5);
      const position = this._tileToWorld(
        doorX,
        doorZ,
        tiles,
      );
      const baseY = position.y;
      const previousDoorPoint = plannedPath[Math.max(0, plannedDoorIndex - 1)];
      const nextDoorPoint = plannedPath[Math.min(plannedPath.length - 1, plannedDoorIndex + 1)];
      const alongX = plannedDoorPoint && previousDoorPoint && nextDoorPoint
        ? Math.abs(nextDoorPoint.x - previousDoorPoint.x) >= Math.abs(nextDoorPoint.z - previousDoorPoint.z)
        : Math.abs(descriptor.from.x - descriptor.to.x) > Math.abs(descriptor.from.z - descriptor.to.z);
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
        landmarks.safeInteractables.push(...this._addExpeditionCamp(group, position, materials));
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
        const keycardTile = this._findReachableRoomFloorTile(room, floorTiles, ['mechanicalPyramidApex', 'mechanicalPyramidSummit', 'solidPurposePlatform', 'jumpPlatform', 'secondFloor', 'keycard'])
          ?? this._findReachableRoomFloorTile(room, floorTiles, []);
        const keycardPosition = keycardTile
          ? this._floorTileToWorld(keycardTile)
          : roomPosition(room);
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

        for (const console of puzzleDefinition.consoles) {
          const consolePosition = this._tileToWorld(console.x, console.z, tiles);
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
        const shrinePosition = roomPosition(room, ['shrine', 'refractorWell', 'reveredMezzanine', 'refractorDais']);
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
    ];
    for (const request of chestRequests) {
      const room = roomById.get(request.roomId);
      if (!room) {
        continue;
      }

      const tile = this._findReachableRoomFloorTile(room, floorTiles, request.surfaces, {
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
    const mechanicOffset = new THREE.Vector3(5.2, 0, -2.2);

    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.44), materials.glowBlue);
    sign.name = 'hubTownGarageSign';
    sign.position.copy(garageOffset).add(new THREE.Vector3(0, 0.96, -0.25));

    const garage = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.86, 0.72), materials.wallTrim);
    garage.name = 'hubTownGarageWorkbench';
    garage.position.copy(garageOffset).setY(0.43);
    garage.castShadow = true;
    garage.receiveShadow = true;

    const npcMaterial = new THREE.MeshStandardMaterial({
      color: 0x68d8ff,
      emissive: 0x0b3140,
      emissiveIntensity: 0.22,
      roughness: 0.68,
      metalness: 0.1,
    });
    const mechanic = this._createNpcMarker('hubMechanicNpc', npcMaterial);
    mechanic.position.copy(mechanicOffset);

    plaza.add(sign, garage, mechanic);
    group.add(plaza);

    interactables.push({
      id: 'garageWorkbench',
      label: 'Garage Workbench',
      action: 'garage',
      position: position.clone().add(garageOffset),
      object: plaza,
      color: 0x6bdcff,
    });
    interactables.push({
      id: 'hubMechanic',
      label: 'Mechanic',
      action: 'mechanic',
      position: position.clone().add(mechanicOffset),
      object: mechanic,
      color: 0x6bdcff,
    });

    return interactables;
  }

  _addExpeditionCamp(group, position, materials) {
    const interactables = [];
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

    const leaderMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd66b,
      emissive: 0x3b2604,
      emissiveIntensity: 0.22,
      roughness: 0.68,
      metalness: 0.08,
    });
    const leader = this._createNpcMarker('expeditionLeaderNpc', leaderMaterial);
    leader.position.set(0, 0, -0.6);

    const researcherMaterial = new THREE.MeshStandardMaterial({
      color: 0x7df8ff,
      emissive: 0x06363c,
      emissiveIntensity: 0.24,
      roughness: 0.66,
      metalness: 0.08,
    });
    const researcher = this._createNpcMarker('expeditionResearcherNpc', researcherMaterial);
    researcher.position.set(-1.05, 0, -1.2);

    const researchStation = new THREE.Group();
    researchStation.name = 'expeditionResearchStation';
    researchStation.position.set(-0.42, 0, -1.25);
    const researchBench = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.42, 0.54), materials.wallTrim);
    researchBench.name = 'expeditionResearchBench';
    researchBench.position.y = 0.21;
    researchBench.castShadow = true;
    researchBench.receiveShadow = true;
    const researchCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), materials.glowBlue);
    researchCore.name = 'expeditionResearchScannerCore';
    researchCore.position.set(0, 0.55, 0);
    const researchScreen = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.24, 0.05), materials.glowBlue);
    researchScreen.name = 'expeditionResearchScannerScreen';
    researchScreen.position.set(0, 0.48, -0.27);
    researchScreen.rotation.x = -0.28;
    researchStation.add(researchBench, researchCore, researchScreen);

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

    camp.add(tent, board, leader, researcher, researchStation, resetConsole, ruinLift);
    group.add(camp);

    interactables.push({
      id: 'expeditionLeader',
      label: 'Expedition Leader',
      action: 'expedition',
      position: position.clone().add(new THREE.Vector3(0, 0, -0.6)),
      object: leader,
      color: 0xffd66b,
    });
    interactables.push({
      id: 'questBoard',
      label: 'Quest Board',
      action: 'quest',
      position: position.clone().add(new THREE.Vector3(1.45, 0, 0.2)),
      object: board,
      color: 0xffd66b,
    });
    interactables.push({
      id: 'researchStation',
      label: 'Research Station',
      action: 'research',
      position: position.clone().add(new THREE.Vector3(-0.42, 0, -1.25)),
      object: researchStation,
      color: 0x7df8ff,
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

    return interactables;
  }

  _createNpcMarker(name, material) {
    const npc = new THREE.Group();
    npc.name = name;

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.78, 14), material);
    body.name = `${name}Body`;
    body.position.y = 0.39;
    body.castShadow = true;
    body.receiveShadow = true;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), material);
    head.name = `${name}Head`;
    head.position.y = 0.92;
    head.castShadow = true;

    npc.add(body, head);
    return npc;
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

  _roomSpawnPoints(room, floorSource = null) {
    if (Array.isArray(floorSource)) {
      const surfacePreferences = {
        server: ['serverCoreFloor', 'serverUpperCatwalk', 'catwalk'],
        machine: ['machinePressZone', 'machineAssemblyConveyor', 'machineCrossBridge', 'machineUpperCatwalk'],
        coolant: ['coolantValveDeck', 'coolantServicePit', 'coolantControlBalcony', 'coolantPipeBridge'],
        enemy: ['enemy', 'secondFloor', 'catwalk', 'raisedDeck'],
        keycard: ['keycard', 'secondFloor'],
        trap: ['basementFloor', 'industrialRamp'],
        conveyor: ['conveyor', 'conveyorPuzzleBelt', 'conveyorBridge', 'secondFloorConveyor', 'thirdFloorGantry'],
        boss: ['boss', 'raisedDeck', 'catwalk', 'thirdFloorGantry'],
        shrine: ['shrine', 'refractorWell', 'reveredMezzanine', 'refractorDais'],
        bonus: ['basementFloor'],
      }[room.type] ?? [];
      const allRoomTiles = this._getRoomFloorTiles(room, floorSource)
        .filter((tile) => !['hub', 'camp', 'entrance'].includes(tile.type));
      const startTile = this._findRoomWalkabilityStartTile(room, allRoomTiles);
      const reachable = this._createReachableFloorTileKeySet(startTile, floorSource);
      const candidates = allRoomTiles
        .filter((tile) => reachable.has(this._getFloorTileGraphKey(tile)))
        .filter((tile) => tile.surface !== 'industrialRamp' && tile.surface !== 'jumpPlatform');
      const surfaceRank = new Map(surfacePreferences.map((surface, index) => [surface, index]));
      const chosen = [];
      const used = new Set();

      candidates.sort((a, b) => {
        const rankA = surfaceRank.has(a.surface) ? surfaceRank.get(a.surface) : surfacePreferences.length;
        const rankB = surfaceRank.has(b.surface) ? surfaceRank.get(b.surface) : surfacePreferences.length;
        if (rankA !== rankB) {
          return rankA - rankB;
        }

        const distanceA = Math.abs(a.x - room.x) + Math.abs(a.z - room.z);
        const distanceB = Math.abs(b.x - room.x) + Math.abs(b.z - room.z);
        return distanceB - distanceA;
      });

      const chooseFrom = (pool, limit) => {
        for (const tile of pool) {
          if (chosen.length >= limit) {
            break;
          }
          const key = floorTileKey(tile.x, tile.z, tile.level ?? 0);
          if (used.has(key)) {
            continue;
          }

          used.add(key);
          chosen.push(this._floorTileToWorld(tile));
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
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
      [0, 0],
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
          addZone(room, `machinePress_${z.toFixed(2)}`, 0, z, 1.72, 0.62, {
            label: 'Machine press',
            verticalHalfHeight: 2.6,
          });
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

  _createEncounterDefinitions(rooms, tiles = null) {
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
        roster.sort((left, right) => Number(left === 'ranged') - Number(right === 'ranged'));

        return {
          ...definition,
          roster,
          roomArchetypeId: room.archetypeId,
          roomFlavorId: room.flavorId,
          enemyBehaviorModifiers: enemyEffects?.behaviorModifiers ?? [],
          zone: {
            id: `${definition.id}Zone`,
            roomId: room.id,
            position: this._tileToWorld(room.x, room.z),
            halfWidth: (Math.floor(room.width / 2) + 0.5) * this.tileSize,
            halfDepth: (Math.floor(room.depth / 2) + 0.5) * this.tileSize,
            active: true,
          },
          spawnPoints: this._roomSpawnPoints(room, tiles),
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
        ['fast', 'fast', 'ranged', 'basic'],
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
        ['fast', 'basic', 'horokko'],
        ['horokko', 'horokko'],
        ['fast', 'ranged', 'basic'],
      ],
      conveyor: [
        ['gorubesshu', 'ranged'],
        ['gorubesshu', 'basic', 'fast'],
        ['ranged', 'ranged', 'horokko'],
      ],
      boss: [
        ['tank', 'gorubesshu', 'ranged'],
        ['tank', 'horokko', 'ranged'],
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
