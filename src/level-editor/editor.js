import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CORE_URL = './core/index.js';
const RUNTIME_URL = './runtime/index.js';
const BRIDGE_CHANNEL = 'ruindivex-level-editor';
const BRIDGE_VERSION = 1;
const STORAGE_PREFIX = 'ruindivex.level-forge.project.';
const RECENTS_KEY = 'ruindivex.level-forge.recents.v1';
const SNAP_PREFERENCES_KEY = 'ruindivex.level-forge.snap.v1';
const FORGE_CONTROL_PREFIX = '/__level-forge/v1';
const FORGE_CONTROL_SIGNATURE = 'ruindivex-level-forge-control/v1';
const FORGE_BROWSER_SIGNATURE = 'ruindivex-level-forge-browser/v1';
const FORGE_POLL_INTERVAL_MS = 350;
const FORGE_MAX_ASSET_BYTES = 32 * 1024 * 1024;
const FORGE_MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const MAX_HISTORY = 80;
const SNAP_TARGETS = new Set(['grid', 'surface', 'object', 'socket', 'free']);
const SNAP_INCREMENTS = [0.05, 0.1, 0.25, 0.5, 1, 2.8, 5.6];
const PLACEMENT_PRECISION = 0.05;
const CONNECTOR_GRID_SIZE = 2.8;
const CONNECTION_ALIGNMENT_EPSILON = 0.00001;
const SOCKET_ENDPOINT_BUFFER = 5.6;
const CONNECTION_KINDS = new Set(['door', 'corridor', 'lift']);
const CONNECTION_FACING_DOT_MAX = -0.95;
const CONNECTION_ELEVATION_TOLERANCE = 0.05;

const [$, $$] = [
  (selector, root = document) => root.querySelector(selector),
  (selector, root = document) => [...root.querySelectorAll(selector)],
];

const [Core, Runtime] = await Promise.all([
  import(CORE_URL).catch((error) => ({ __loadError: error })),
  import(RUNTIME_URL).catch((error) => ({ __loadError: error })),
]);

const ICONS = {
  floor: '<svg viewBox="0 0 24 24"><path d="m3 14 9 5 9-5-9-5zM3 14v3l9 5 9-5v-3"/></svg>',
  wall: '<svg viewBox="0 0 24 24"><path d="M3 5h18v14H3zM3 10h18M8 5v5m8-5v5m-5 0v9"/></svg>',
  pillar: '<svg viewBox="0 0 24 24"><path d="M8 4h8l1 3H7zM8 7h8v10H8zm-1 10h10l1 3H6z"/></svg>',
  ramp: '<svg viewBox="0 0 24 24"><path d="M3 18h18L21 7zM7 15h11"/></svg>',
  platform: '<svg viewBox="0 0 24 24"><path d="m4 10 8-4 8 4-8 4zM4 10v4l8 4 8-4v-4M8 16v3m8-3v3"/></svg>',
  doorway: '<svg viewBox="0 0 24 24"><path d="M5 20V4h14v16M9 20V8h6v12"/></svg>',
  spawn: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"/><path d="M6 20c.5-5 2.5-7 6-7s5.5 2 6 7M12 3v2"/></svg>',
  enemy: '<svg viewBox="0 0 24 24"><path d="m7 7 2 3h6l2-3 2 4-2 8H7l-2-8zM9 14h.01M15 14h.01M10 17h4"/></svg>',
  pickup: '<svg viewBox="0 0 24 24"><path d="m12 3 7 4v10l-7 4-7-4V7zM5 7l7 4 7-4m-7 4v10"/></svg>',
  checkpoint: '<svg viewBox="0 0 24 24"><path d="M6 21V3m1 2h11l-3 4 3 4H7"/></svg>',
  trigger: '<svg viewBox="0 0 24 24"><path d="M4 8h16v9H4zM7 5h10M8 12h8"/></svg>',
  light: '<svg viewBox="0 0 24 24"><path d="M9 18h6m-5 3h4m4-10a6 6 0 1 0-10 4.5c.7.6 1 1.2 1 2.5h6c0-1.3.3-1.9 1-2.5A6 6 0 0 0 18 11M12 2V0"/></svg>',
  exit: '<svg viewBox="0 0 24 24"><path d="M10 4H5v16h5m2-4 5-4-5-4m-5 4h10"/></svg>',
  socket: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M8 12h8M12 8v8m7-4h3M2 12h3"/></svg>',
  lift: '<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM9 8l3-3 3 3m0 8-3 3-3-3"/></svg>',
  tunnel: '<svg viewBox="0 0 24 24"><path d="M3 20V10a9 9 0 0 1 18 0v10M8 20V10a4 4 0 0 1 8 0v10"/></svg>',
  room: '<svg viewBox="0 0 24 24"><path d="m3 8 9-5 9 5v10l-9 3-9-3zM3 8l9 4 9-4m-9 4v9"/></svg>',
  arena: '<svg viewBox="0 0 24 24"><path d="m4 7 8-4 8 4v10l-8 4-8-4zM8 9h8v6H8z"/></svg>',
  corridor: '<svg viewBox="0 0 24 24"><path d="M3 7h18v10H3zm5 0v10m8-10v10"/></svg>',
  objective: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3"/></svg>',
  safe: '<svg viewBox="0 0 24 24"><path d="m12 3 8 3v6c0 5-3 8-8 10-5-2-8-5-8-10V6zM8 12l3 3 5-6"/></svg>',
  boss: '<svg viewBox="0 0 24 24"><path d="m4 8 4 3 4-7 4 7 4-3-2 11H6zM8 15h8"/></svg>',
  connection: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M9 12h6"/></svg>',
  model: '<svg viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/></svg>',
};

const ROOM_PALETTE = [
  { category: 'structure', kind: 'structural', type: 'floor', name: 'Floor slab', detail: '4 × 4 m', size: [4, 0.24, 4], icon: 'floor', color: '#7e8a91' },
  { category: 'structure', kind: 'structural', type: 'wall', name: 'Wall panel', detail: '4 × 2.8 m', size: [4, 2.8, 0.24], icon: 'wall', color: '#87949c' },
  { category: 'structure', kind: 'structural', type: 'pillar', name: 'Support', detail: '0.6 × 3 m', size: [0.6, 3, 0.6], icon: 'pillar', color: '#909ca3' },
  { category: 'structure', kind: 'structural', type: 'ramp', name: 'Ramp', detail: '4 × 2 m', size: [4, 0.35, 2], icon: 'ramp', color: '#8d999f' },
  { category: 'structure', kind: 'structural', type: 'platform', name: 'Platform', detail: '3 × 2 m', size: [3, 0.3, 2], icon: 'platform', color: '#849198' },
  { category: 'structure', kind: 'structural', type: 'door-frame', name: 'Door frame', detail: '2.2 × 2.8 m', size: [2.2, 2.8, 0.3], icon: 'doorway', color: '#96a2a9' },
  { category: 'structure', kind: 'structural', type: 'ceiling', name: 'Ceiling slab', detail: '4 × 4 m', size: [4, 0.2, 4], shape: 'box', icon: 'floor', color: '#7e8a91' },
  { category: 'structure', kind: 'structural', type: 'box', name: 'Box primitive', detail: '1 × 1 × 1 m', size: [1, 1, 1], shape: 'box', icon: 'pickup', color: '#8d999f' },
  { category: 'structure', kind: 'structural', type: 'cylinder', name: 'Cylinder', detail: '1 × 2 m', size: [1, 2, 1], shape: 'cylinder', icon: 'pillar', color: '#8d999f' },
  { category: 'structure', kind: 'structural', type: 'sphere', name: 'Sphere', detail: '1 m diameter', size: [1, 1, 1], shape: 'sphere', icon: 'objective', color: '#8d999f' },
  { category: 'structure', kind: 'structural', type: 'plane', name: 'Plane', detail: '2 × 2 m', size: [2, 0.05, 2], shape: 'plane', icon: 'floor', color: '#8d999f' },
  { category: 'structure', kind: 'structural', type: 'collision-box', name: 'Collision box', detail: 'Invisible runtime', size: [2, 2, 2], shape: 'box', icon: 'trigger', color: '#76a9ff', defaults: { visual: false } },
  { category: 'gameplay', kind: 'marker', type: 'player-spawn', name: 'Player spawn', detail: 'Required', icon: 'spawn', color: '#d5ff44' },
  { category: 'gameplay', kind: 'marker', type: 'enemy-spawn', name: 'Enemy spawn', detail: 'Encounter', icon: 'enemy', color: '#ff6374' },
  { category: 'gameplay', kind: 'marker', type: 'pickup', name: 'Pickup', detail: 'Loot / keycard', icon: 'pickup', color: '#ffbf57' },
  { category: 'gameplay', kind: 'marker', type: 'checkpoint', name: 'Checkpoint', detail: 'Progress save', icon: 'checkpoint', color: '#65e19b' },
  { category: 'gameplay', kind: 'volume', type: 'trigger', name: 'Trigger volume', detail: 'Event region', icon: 'trigger', color: '#76a9ff' },
  { category: 'gameplay', kind: 'light', type: 'point-light', name: 'Point light', detail: 'Dynamic', icon: 'light', color: '#ffe3a3' },
  { category: 'gameplay', kind: 'marker', type: 'room-exit', name: 'Room exit', detail: 'Progression', icon: 'exit', color: '#6fe3e8' },
  { category: 'gameplay', kind: 'gameplay', type: 'door', name: 'Gameplay door', detail: 'Lockable', icon: 'doorway', color: '#6fe3e8', defaults: { locked: false, keyId: null } },
  { category: 'gameplay', kind: 'gameplay', type: 'keycard', name: 'Keycard', detail: 'Door credential', icon: 'pickup', color: '#ffbf57', defaults: { keyId: 'key-a' } },
  { category: 'gameplay', kind: 'gameplay', type: 'chest', name: 'Treasure chest', detail: 'Loot container', icon: 'pickup', color: '#ffbf57', defaults: { lootTableId: 'default' } },
  { category: 'gameplay', kind: 'gameplay', type: 'trap', name: 'Trap', detail: 'Damage hazard', icon: 'enemy', color: '#ff6374', defaults: { damage: 10, cooldown: 1 } },
  { category: 'gameplay', kind: 'gameplay', type: 'conveyor', name: 'Conveyor', detail: 'Traversal motion', icon: 'corridor', color: '#76a9ff', defaults: { speed: 2, direction: { x: 1, y: 0, z: 0 } } },
  { category: 'gameplay', kind: 'gameplay', type: 'ladder', name: 'Ladder', detail: 'Vertical traversal', icon: 'lift', color: '#65e19b', defaults: { height: 4 } },
  { category: 'gameplay', kind: 'gameplay', type: 'lift', name: 'Platform lift', detail: 'Vertical transit', icon: 'lift', color: '#65e19b', defaults: { travelHeight: 5.6, speed: 1.5 } },
  { category: 'gameplay', kind: 'gameplay', type: 'mechanism', name: 'Mechanism', detail: 'Targetable control', icon: 'objective', color: '#6fe3e8', defaults: { mechanismId: '', targetId: null } },
  { category: 'gameplay', kind: 'gameplay', type: 'puzzle-block', name: 'Puzzle block', detail: 'Movable mass', icon: 'pickup', color: '#76a9ff', defaults: { mass: 1 } },
  { category: 'gameplay', kind: 'gameplay', type: 'pressure-plate', name: 'Pressure plate', detail: 'Puzzle input', icon: 'floor', color: '#ffbf57', defaults: { targetId: null, threshold: 1 } },
  { category: 'gameplay', kind: 'gameplay', type: 'shrine', name: 'Shrine', detail: 'Rest interaction', icon: 'safe', color: '#65e19b', defaults: { shrineId: '', oneShot: false } },
  { category: 'gameplay', kind: 'volume', type: 'safe-zone', name: 'Safe zone', detail: 'Recovery region', icon: 'safe', color: '#65e19b', defaults: { radius: 3 } },
  { category: 'gameplay', kind: 'marker', type: 'extraction', name: 'Extraction', detail: 'Level completion', icon: 'exit', color: '#6fe3e8', defaults: { required: true } },
  { category: 'gameplay', kind: 'gameplay', type: 'interactable', name: 'Interactable', detail: 'Generic action', icon: 'objective', color: '#6fe3e8', defaults: { interactionId: '', prompt: 'Interact' } },
  { category: 'socket', kind: 'socket', type: 'door', name: 'Door socket', detail: 'Horizontal', icon: 'socket', color: '#6fe3e8' },
  { category: 'socket', kind: 'socket', type: 'lift', name: 'Lift socket', detail: 'Vertical', icon: 'lift', color: '#6fe3e8' },
  { category: 'socket', kind: 'socket', type: 'tunnel', name: 'Tunnel socket', detail: 'Traversal', icon: 'tunnel', color: '#6fe3e8' },
];

const DUNGEON_PALETTE = [
  { category: 'structure', kind: 'room', type: 'small-room', name: 'Small room', detail: '8 × 8 m', size: [8, 4, 8], icon: 'room', color: '#76a9ff' },
  { category: 'structure', kind: 'room', type: 'chamber', name: 'Chamber', detail: '12 × 10 m', size: [12, 5, 10], icon: 'room', color: '#76a9ff' },
  { category: 'structure', kind: 'room', type: 'hall', name: 'Grand hall', detail: '16 × 10 m', size: [16, 6, 10], icon: 'arena', color: '#76a9ff' },
  { category: 'structure', kind: 'room', type: 'arena', name: 'Arena', detail: '18 × 18 m', size: [18, 7, 18], icon: 'arena', color: '#76a9ff' },
  { category: 'structure', kind: 'room', type: 'shaft', name: 'Vertical shaft', detail: '8 × 12 m', size: [8, 12, 8], icon: 'lift', color: '#76a9ff' },
  { category: 'structure', kind: 'room', type: 'corridor-room', name: 'Passage', detail: '12 × 4 m', size: [12, 3.5, 4], icon: 'corridor', color: '#76a9ff' },
  { category: 'gameplay', kind: 'marker', type: 'dungeon-start', name: 'Dungeon start', detail: 'Required', icon: 'spawn', color: '#d5ff44' },
  { category: 'gameplay', kind: 'marker', type: 'objective', name: 'Objective', detail: 'Progression', icon: 'objective', color: '#ffbf57' },
  { category: 'gameplay', kind: 'marker', type: 'encounter', name: 'Encounter', detail: 'Enemy wave', icon: 'enemy', color: '#ff6374' },
  { category: 'gameplay', kind: 'marker', type: 'loot-cache', name: 'Loot cache', detail: 'Reward', icon: 'pickup', color: '#ffbf57' },
  { category: 'gameplay', kind: 'marker', type: 'safe-zone', name: 'Safe zone', detail: 'Recovery', icon: 'safe', color: '#65e19b' },
  { category: 'gameplay', kind: 'marker', type: 'boss-arena', name: 'Boss encounter', detail: 'Milestone', icon: 'boss', color: '#ff6374' },
  { category: 'gameplay', kind: 'marker', type: 'extraction', name: 'Extraction', detail: 'Dungeon exit', icon: 'exit', color: '#6fe3e8' },
  { category: 'socket', kind: 'connection-tool', type: 'door', name: 'Door link', detail: 'Socket to socket', icon: 'connection', color: '#6fe3e8' },
  { category: 'socket', kind: 'connection-tool', type: 'corridor', name: 'Corridor link', detail: 'Socket to socket', icon: 'corridor', color: '#6fe3e8' },
  { category: 'socket', kind: 'connection-tool', type: 'lift', name: 'Lift link', detail: 'Vertical', icon: 'lift', color: '#6fe3e8' },
];

function makeRoomModule({ moduleId, name = 'Room', size = [10, 4, 10], sockets = null } = {}) {
  const width = Number(size[0]) || 10;
  const height = Number(size[1]) || 4;
  const depth = Number(size[2]) || 10;
  const dimensions = { width, height, depth, widthMeters: width, heightMeters: height, depthMeters: depth };
  return {
    schema: 'ruindivex-room-module/v1',
    moduleId,
    topologyRevision: 1,
    themePackId: 'industrial-v1',
    tileSize: 2.8,
    dimensions,
    room: { id: moduleId, name, type: 'authored-room', archetype: 'industrial-ruins', baseElevation: 0, width, depth, ceilingHeight: height, dimensions: clone(dimensions) },
    primitives: [],
    models: [],
    materials: [],
    sockets: sockets || defaultSockets(size),
    anchors: [],
    entities: [],
    metadata: { authoredBy: 'RuinDiver Level Forge' },
  };
}

const FALLBACK_PROJECT = () => {
  const now = new Date().toISOString();
  const roomId = makeId('room');
  const moduleId = 'start-chamber';
  const size = [16.8, 5.6, 16.8];
  const roomModule = makeRoomModule({ moduleId, name: 'Start Chamber', size });
  roomModule.primitives.push(
    { id: makeId('primitive'), kind: 'primitive', type: 'floor', shape: 'box', surfaceRole: 'floor', name: 'Floor', size: { x: 16.8, y: 0.2, z: 16.8 }, transform: { position: { x: 0, y: -0.1, z: 0 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } }, materialId: 'default', collision: true, walkable: true, enabled: true, properties: {} },
    { id: makeId('primitive'), kind: 'primitive', type: 'wall', shape: 'box', name: 'North Wall', size: { x: 16.8, y: 5.6, z: 0.2 }, transform: { position: { x: 0, y: 2.8, z: -8.4 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } }, materialId: 'default', collision: true, enabled: true, properties: {} },
    { id: makeId('primitive'), kind: 'primitive', type: 'wall', shape: 'box', name: 'South Wall', size: { x: 16.8, y: 5.6, z: 0.2 }, transform: { position: { x: 0, y: 2.8, z: 8.4 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } }, materialId: 'default', collision: true, enabled: true, properties: {} },
    { id: makeId('primitive'), kind: 'primitive', type: 'wall', shape: 'box', name: 'East Wall', size: { x: 0.2, y: 5.6, z: 16.8 }, transform: { position: { x: 8.4, y: 2.8, z: 0 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } }, materialId: 'default', collision: true, enabled: true, properties: {} },
    { id: makeId('primitive'), kind: 'primitive', type: 'wall', shape: 'box', name: 'West Wall', size: { x: 0.2, y: 5.6, z: 16.8 }, transform: { position: { x: -8.4, y: 2.8, z: 0 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } }, materialId: 'default', collision: true, enabled: true, properties: {} },
  );
  const spawnId = makeId('entity');
  const extractionId = makeId('entity');
  return {
    schema: 'ruindivex-level-editor-project/v1',
    projectId: makeId('project'),
    name: 'Untitled Expedition',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    settings: { tileSize: 2.8, unitScale: 1, themePackId: 'industrial-v1', spawnId },
    rooms: [{ id: roomId, moduleId, name: 'Start Chamber', transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } }, dimensions: { width: 16.8, height: 5.6, depth: 16.8 }, properties: {} }],
    connections: [],
    entities: [
      { id: spawnId, kind: 'player-spawn', type: 'player-spawn', name: 'Player Spawn', roomId, transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } }, properties: { enabled: true, editorCategory: 'marker' } },
      { id: extractionId, kind: 'extraction', type: 'extraction', name: 'Extraction', roomId, transform: { position: { x: 5.6, y: 0, z: 5.6 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } }, properties: { enabled: true, required: true, editorCategory: 'marker' } },
    ],
    assets: [],
    roomModules: [roomModule],
    metadata: { editorMode: 'room' },
  };
};

function makeId(prefix = 'item') {
  const coreFactory = Core.createLevelEditorId || Core.createProjectId || Core.createId;
  if (typeof coreFactory === 'function') {
    try { return coreFactory(prefix); } catch { /* fall through */ }
  }
  return `${prefix}_${crypto.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;
}

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function unwrapProject(result) {
  if (!result) return result;
  if (result.project && typeof result.project === 'object') return result.project;
  if (result.value && typeof result.value === 'object') return result.value;
  return result;
}

function normalizeProject(project) {
  const normalizer = Core.normalizeLevelEditorProject || Core.normalizeProject || Core.migrateLevelEditorProject;
  let value = project;
  if (typeof normalizer === 'function') {
    try { value = unwrapProject(normalizer(project)); } catch (error) { console.warn('Core normalization failed; using editor fallback.', error); }
  }
  const fallback = FALLBACK_PROJECT();
  value = value && typeof value === 'object' ? value : fallback;
  value.schema ||= fallback.schema;
  value.projectId ||= makeId('project');
  value.name ||= 'Untitled Expedition';
  value.settings = { ...fallback.settings, ...(value.settings || {}) };
  value.rooms = Array.isArray(value.rooms) ? value.rooms : [];
  value.connections = Array.isArray(value.connections) ? value.connections : [];
  value.entities = Array.isArray(value.entities) ? value.entities : [];
  value.assets = Array.isArray(value.assets) ? value.assets : [];
  value.roomModules = Array.isArray(value.roomModules) ? value.roomModules : [];
  value.metadata = value.metadata && typeof value.metadata === 'object' ? value.metadata : {};
  value.createdAt ||= new Date().toISOString();
  value.updatedAt ||= value.createdAt;
  value.revision = Number.isFinite(value.revision) ? value.revision : 0;
  if (!value.rooms.length) {
    value.rooms.push(fallback.rooms[0]);
    if (!value.roomModules.length) value.roomModules.push(fallback.roomModules[0]);
    if (!value.entities.length) value.entities.push(...fallback.entities);
    if (!value.settings.spawnId) value.settings.spawnId = fallback.settings.spawnId;
  }
  for (const room of value.rooms) {
    let module = value.roomModules.find((candidate) => candidate.moduleId === room.moduleId);
    if (!module && room.inlineModule) {
      module = { ...clone(room.inlineModule), moduleId: room.moduleId };
      value.roomModules.push(module);
    }
    if (!module) {
      const dimensions = room.dimensions || { width: 10, height: 4, depth: 10 };
      module = makeRoomModule({ moduleId: room.moduleId, name: room.name, size: [dimensions.width, dimensions.height, dimensions.depth], sockets: room.sockets || null });
      value.roomModules.push(module);
    }
    module.schema ||= 'ruindivex-room-module/v1';
    module.moduleId = room.moduleId;
    module.topologyRevision = Math.max(1, Number(module.topologyRevision) || 1);
    module.room ||= { id: room.moduleId, name: room.name || room.moduleId };
    module.room.id = room.moduleId;
    module.primitives = Array.isArray(module.primitives) ? module.primitives : [];
    module.models = Array.isArray(module.models) ? module.models : [];
    module.materials = Array.isArray(module.materials) || (module.materials && typeof module.materials === 'object') ? module.materials : [];
    module.sockets = Array.isArray(module.sockets) ? module.sockets : [];
    module.entities = Array.isArray(module.entities) ? module.entities : [];
  }
  const migratedByModule = new Map();
  for (const module of value.roomModules) {
    const migratedSocketIds = migrateLegacyGeneratedDoorSockets(module.sockets, module);
    if (!migratedSocketIds.size) continue;
    module.topologyRevision = Math.max(1, Number(module.topologyRevision) || 1) + 1;
    migratedByModule.set(module.moduleId, migratedSocketIds);
  }
  const migratedEndpoints = new Map();
  for (const room of value.rooms) {
    const module = value.roomModules.find((candidate) => candidate.moduleId === room.moduleId);
    const hasInstanceSockets = Array.isArray(room.sockets);
    const instanceSockets = migrateLegacyGeneratedDoorSockets(room.sockets, module);
    const moduleSockets = migratedByModule.get(room.moduleId) ?? new Map();
    const effectiveSockets = hasInstanceSockets ? instanceSockets : moduleSockets;
    const scaleY = Number(room.transform?.scale?.y) || 1;
    for (const [socketId, migration] of effectiveSockets) {
      if (!socketId) continue;
      migratedEndpoints.set(`${room.id}:${socketId}`, {
        deltaY: (migration.nextY - migration.previousY) * scaleY,
      });
    }
  }
  for (const connection of value.connections) {
    const fromKey = `${connection.from?.roomId ?? ''}:${connection.from?.socketId ?? ''}`;
    const toKey = `${connection.to?.roomId ?? ''}:${connection.to?.socketId ?? ''}`;
    const fromMigration = migratedEndpoints.get(fromKey);
    const toMigration = migratedEndpoints.get(toKey);
    if (!fromMigration && !toMigration) continue;
    if (connection.properties?.authoredWith !== 'connection-interface') continue;
    const waypoints = connection.properties?.route?.waypoints;
    if (!Array.isArray(waypoints)) continue;
    const fromDelta = Number(fromMigration?.deltaY) || 0;
    const toDelta = Number(toMigration?.deltaY) || 0;
    const denominator = Math.max(1, waypoints.length - 1);
    for (let index = 0; index < waypoints.length; index += 1) {
      const waypoint = waypoints[index];
      if (!waypoint || typeof waypoint !== 'object' || !Number.isFinite(Number(waypoint.y))) continue;
      const progress = waypoints.length === 1 ? 0.5 : index / denominator;
      waypoint.y = Number((Number(waypoint.y) + fromDelta + (toDelta - fromDelta) * progress).toFixed(6));
    }
  }
  return value;
}

function createProject() {
  const factory = Core.createDefaultLevelEditorProject || Core.createDefaultProject;
  if (typeof factory === 'function') {
    try { return normalizeProject(unwrapProject(factory({ name: 'Untitled Expedition' }))); } catch (error) { console.warn('Core project factory failed.', error); }
  }
  return normalizeProject(FALLBACK_PROJECT());
}

function readSnapPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(SNAP_PREFERENCES_KEY) || '{}');
    const target = SNAP_TARGETS.has(value.target) ? value.target : 'grid';
    const increment = SNAP_INCREMENTS.includes(Number(value.increment)) ? Number(value.increment) : 2.8;
    return { target, enabled: value.enabled !== false && target !== 'free', increment };
  } catch {
    return { target: 'grid', enabled: true, increment: 2.8 };
  }
}

const initialSnapPreferences = readSnapPreferences();

const state = {
  project: createProject(),
  mode: 'room',
  activeRoomId: null,
  selectedId: null,
  selectedIds: [],
  clipboard: [],
  paletteTab: 'all',
  tool: 'select',
  snap: initialSnapPreferences.enabled,
  snapTarget: initialSnapPreferences.target,
  lastSnapTarget: initialSnapPreferences.target === 'free' ? 'grid' : initialSnapPreferences.target,
  snapValue: initialSnapPreferences.increment,
  gridVisible: true,
  lightingEnabled: true,
  connectionFrom: null,
  connectionTool: null,
  connectionDraft: null,
  undo: [],
  redo: [],
  dirty: false,
  saveTimer: 0,
  validationTimer: 0,
  validation: { valid: true, issues: [] },
  coreStore: null,
  bridgeReady: false,
  pendingPlaytest: null,
  playing: false,
  transformSnapshot: null,
  multiTransformStart: null,
  transformSpace: 'local',
  objectURLs: new Set(),
  assetPreviewUrls: new Map(),
  forgeControl: {
    active: false,
    applying: false,
    paused: false,
    sessionId: null,
    status: 'idle',
    pollTimer: 0,
    polling: false,
    manualTimer: 0,
    manualBaseRevision: null,
    commandResponses: new Map(),
  },
};
state.activeRoomId = state.project.rooms[0]?.id || null;

const sceneState = {
  scene: null,
  renderer: null,
  camera: null,
  controls: null,
  transform: null,
  content: null,
  grid: null,
  lights: null,
  selectionBox: null,
  selectionPivot: null,
  visuals: new Map(),
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  pointerDown: null,
  frame: 0,
  fpsFrames: 0,
  fpsStarted: performance.now(),
  gltfLoader: new GLTFLoader(),
};

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function prettyType(value) {
  return String(value || 'Object').replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function vector(value, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: Number.isFinite(Number(value?.x)) ? Number(value.x) : fallback.x,
    y: Number.isFinite(Number(value?.y)) ? Number(value.y) : fallback.y,
    z: Number.isFinite(Number(value?.z)) ? Number(value.z) : fallback.z,
  };
}

function ensureTransform(record) {
  record.transform ||= {};
  record.transform.position = vector(record.transform.position);
  record.transform.rotationY = Number(record.transform.rotationY ?? record.transform.rotation?.y) || 0;
  delete record.transform.rotation;
  record.transform.scale = vector(record.transform.scale, { x: 1, y: 1, z: 1 });
  return record.transform;
}

function getActiveRoom() {
  let room = state.project.rooms.find((candidate) => candidate.id === state.activeRoomId);
  if (!room) room = state.project.rooms[0];
  state.activeRoomId = room?.id || null;
  return room;
}

function getRoomModule(room = getActiveRoom(), { create = true } = {}) {
  if (!room) return null;
  let module = state.project.roomModules.find((candidate) => candidate.moduleId === room.moduleId);
  if (!module && room.inlineModule) module = room.inlineModule;
  if (!module && create) {
    const dimensions = room.dimensions || { width: 10, height: 4, depth: 10 };
    module = makeRoomModule({ moduleId: room.moduleId, name: room.name, size: [dimensions.width, dimensions.height, dimensions.depth] });
    state.project.roomModules.push(module);
  }
  return module;
}

function roomPrimitives(room = getActiveRoom()) {
  const module = getRoomModule(room, { create: false });
  return [...(module?.primitives || []), ...(module?.models || [])];
}

function roomSockets(room = getActiveRoom()) {
  if (Array.isArray(room?.sockets)) return room.sockets;
  return getRoomModule(room, { create: false })?.sockets || [];
}

function findRecord(id) {
  if (!id) return null;
  const room = state.project.rooms.find((candidate) => candidate.id === id);
  if (room) return { category: 'room', record: room };
  const entity = state.project.entities.find((candidate) => candidate.id === id);
  if (entity) return { category: 'entity', record: entity };
  for (const owner of state.project.rooms) {
    const module = getRoomModule(owner, { create: false });
    const primitive = [...(module?.primitives || []), ...(module?.models || [])].find((candidate) => candidate.id === id);
    if (primitive) return { category: 'primitive', record: primitive, owner, module };
    const socket = (module?.sockets || []).find((candidate) => candidate.id === id);
    if (socket) return { category: 'socket', record: socket, owner, module };
  }
  const connection = state.project.connections.find((candidate) => candidate.id === id);
  if (connection) return { category: 'connection', record: connection };
  const asset = state.project.assets.find((candidate) => candidate.id === id || candidate.hash === id);
  if (asset) return { category: 'asset', record: asset };
  return null;
}

function validSelectedIds() {
  const unique = [...new Set(state.selectedIds || [])].filter((id) => Boolean(findRecord(id)));
  if (state.selectedId && findRecord(state.selectedId) && !unique.includes(state.selectedId)) unique.push(state.selectedId);
  state.selectedIds = unique;
  state.selectedId = unique.includes(state.selectedId) ? state.selectedId : unique.at(-1) || null;
  return unique;
}

function clearSelection() {
  state.selectedId = null;
  state.selectedIds = [];
}

function snapshot() {
  return JSON.stringify(state.project);
}

function markDirty(label = 'Changed', { source = 'manual' } = {}) {
  const baseRevision = Number(state.project.revision) || 0;
  state.project.revision = baseRevision + 1;
  state.project.updatedAt = new Date().toISOString();
  state.dirty = true;
  const saveState = $('#save-state');
  saveState.classList.add('dirty');
  $('span', saveState).textContent = label;
  scheduleSave();
  scheduleValidation();
  if (source === 'manual') noteManualForgeEdit(baseRevision);
}

function pushUndo(serialized) {
  if (!serialized) return;
  if (state.undo.at(-1) === serialized) return;
  state.undo.push(serialized);
  if (state.undo.length > MAX_HISTORY) state.undo.shift();
}

function commit(label, mutation, { rebuild = true, select = state.selectedId, selection = null, source = 'manual' } = {}) {
  const before = snapshot();
  mutation();
  const after = snapshot();
  if (before === after) return false;
  pushUndo(before);
  state.redo.length = 0;
  markDirty(label, { source });
  if (Array.isArray(selection)) {
    state.selectedIds = [...new Set(selection)].filter((id) => Boolean(findRecord(id)));
    state.selectedId = select && state.selectedIds.includes(select) ? select : state.selectedIds.at(-1) || null;
  } else {
    state.selectedId = select;
    state.selectedIds = select && findRecord(select) ? [select] : [];
  }
  if (rebuild) rebuildEditor(); else refreshUI();
  return true;
}

function restore(serialized, destination) {
  if (!serialized) return;
  const baseRevision = Number(state.project.revision) || 0;
  destination.push(snapshot());
  resetConnectionWorkflow();
  state.project = normalizeProject(JSON.parse(serialized));
  state.project.revision = baseRevision + 1;
  state.project.updatedAt = new Date().toISOString();
  state.activeRoomId = state.project.rooms.some((room) => room.id === state.activeRoomId) ? state.activeRoomId : state.project.rooms[0]?.id;
  validSelectedIds();
  state.dirty = true;
  rebuildEditor();
  scheduleSave();
  scheduleValidation();
  noteManualForgeEdit(baseRevision);
}

function undo() { restore(state.undo.pop(), state.redo); }
function redo() { restore(state.redo.pop(), state.undo); }

function setSaveState(text, className = '') {
  const element = $('#save-state');
  element.className = `save-state ${className}`.trim();
  $('span', element).textContent = text;
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  setSaveState('Unsaved changes', 'dirty');
  state.saveTimer = setTimeout(() => saveProject({ silent: true }), 850);
}

function scheduleValidation() {
  clearTimeout(state.validationTimer);
  state.validationTimer = setTimeout(() => validateProject({ notify: false }), 260);
}

function toast(title, detail = '', type = 'success', duration = 3200) {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.innerHTML = `<span class="toast-icon">${type === 'error' ? ICONS.exit : type === 'warning' ? ICONS.objective : '<svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9"/></svg>'}</span><span><strong>${escapeHTML(title)}</strong><small>${escapeHTML(detail)}</small></span><button class="toast-close" aria-label="Dismiss">×</button>`;
  $('#toast-stack').append(element);
  const remove = () => element.remove();
  $('.toast-close', element).addEventListener('click', remove);
  setTimeout(remove, duration);
}

function paletteForMode() { return state.mode === 'room' ? ROOM_PALETTE : DUNGEON_PALETTE; }

function renderPalette() {
  const search = $('#palette-search').value.trim().toLowerCase();
  const items = paletteForMode().filter((item) => (
    (state.paletteTab === 'all' || state.paletteTab === item.category)
    && (!search || `${item.name} ${item.detail} ${item.type}`.toLowerCase().includes(search))
  ));
  for (const category of ['structure', 'gameplay', 'socket']) {
    const section = $(`.palette-section[data-section="${category}"]`);
    const target = $(`#${category === 'structure' ? 'structural' : category}-palette`);
    const categoryItems = items.filter((item) => item.category === category);
    section.hidden = (state.paletteTab !== 'all' && state.paletteTab !== category) || (!categoryItems.length && Boolean(search));
    target.replaceChildren(...categoryItems.map(createPaletteCard));
    $(`#${category}-count`).textContent = paletteForMode().filter((item) => item.category === category).length;
  }
  $('#empty-search').hidden = Boolean(items.length);
  $('#palette-title').textContent = state.mode === 'room' ? 'Room palette' : 'Dungeon palette';
}

function createPaletteCard(item) {
  const button = document.createElement('button');
  button.type = 'button';
  const connectionTool = item.kind === 'connection-tool';
  button.className = `palette-item ${item.category === 'socket' ? 'socket' : item.category === 'gameplay' ? 'gameplay' : state.mode === 'dungeon' ? 'room-piece' : ''}${connectionTool ? ' connection-tool' : ''}${connectionTool && state.connectionTool === item.type ? ' active' : ''}`;
  button.draggable = !connectionTool;
  button.dataset.paletteType = item.type;
  if (connectionTool) {
    button.dataset.connectionTool = item.type;
    button.setAttribute('aria-pressed', String(state.connectionTool === item.type));
  }
  button.style.setProperty('--piece-color', item.color);
  button.innerHTML = `<span class="palette-thumb">${ICONS[item.icon] || ICONS.model}</span><span class="palette-copy"><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(item.detail)}</small></span>`;
  button.addEventListener('dragstart', (event) => {
    if (connectionTool) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-ruindiver-piece', JSON.stringify({ type: item.type, mode: state.mode }));
    event.dataTransfer.setData('text/plain', item.name);
    button.classList.add('dragging');
  });
  button.addEventListener('dragend', () => button.classList.remove('dragging'));
  if (connectionTool) button.addEventListener('click', () => activateConnectionTool(item.type));
  else button.addEventListener('dblclick', () => addPaletteItem(item, viewportCenterPlacement(item)));
  return button;
}

function templateByType(type, mode = state.mode) {
  return (mode === 'room' ? ROOM_PALETTE : DUNGEON_PALETTE).find((item) => item.type === type);
}

function defaultSockets(size) {
  const [width, , depth] = size;
  const socket = (name, position, facing, type = 'door') => ({
    id: makeId('socket'),
    name,
    type,
    kind: type,
    actorKind: 'player',
    position,
    facing,
    transform: { position: clone(position), rotationY: Math.atan2(facing.x, facing.z), scale: { x: 1, y: 1, z: 1 } },
    widthMeters: 8.4,
    heightMeters: 5.6,
    landingRequirements: { minWidthMeters: 8.4, minDepthMeters: 8.4, maxStepMeters: 0.05 },
    clearanceRequirements: { widthMeters: 8.4, heightMeters: 3.6, depthMeters: 5.6 },
    compatibleFamilies: type === 'lift' ? ['lift', 'shaft'] : type === 'tunnel' ? ['tunnel', 'corridor'] : ['door', 'corridor'],
    required: false,
    optional: true,
    capPreset: type === 'lift' ? 'lift-shaft-cap' : 'sealed-wall',
    properties: { positionAnchor: 'threshold-floor' },
  });
  return [
    socket('North Door', { x: 0, y: 0, z: -depth / 2 }, { x: 0, y: 0, z: -1 }),
    socket('South Door', { x: 0, y: 0, z: depth / 2 }, { x: 0, y: 0, z: 1 }),
    socket('East Door', { x: width / 2, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
    socket('West Door', { x: -width / 2, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }),
  ];
}

function isLegacyGeneratedDoorSocket(socket, module) {
  if (!socket || !['North Door', 'South Door', 'East Door', 'West Door'].includes(socket.name)) return false;
  if (module?.metadata?.authoredBy !== 'RuinDiver Level Forge') return false;
  if (String(socket.type ?? socket.kind ?? '').toLowerCase() !== 'door') return false;
  if ((socket.properties?.positionAnchor ?? socket.positionAnchor) != null) return false;
  if (String(socket.actorKind ?? '').toLowerCase() !== 'player') return false;
  if (socket.capPreset !== 'sealed-wall') return false;
  const families = Array.isArray(socket.compatibleFamilies) ? socket.compatibleFamilies : [];
  if (!families.includes('door') || !families.includes('corridor')) return false;
  const width = Number(socket.widthMeters ?? socket.width);
  const height = Number(socket.heightMeters ?? socket.height);
  if (!Number.isFinite(width) || Math.abs(width - 8.4) > 0.001) return false;
  if (!Number.isFinite(height) || Math.abs(height - 5.6) > 0.001) return false;
  const directY = Number(socket.position?.y ?? socket.transform?.position?.y ?? socket.y ?? socket.elevation);
  const transformY = Number(socket.transform?.position?.y ?? directY);
  return Math.abs(directY - 1.2) <= 0.001 && Math.abs(transformY - 1.2) <= 0.001;
}

function migrateLegacyGeneratedDoorSockets(sockets, module) {
  const migratedSockets = new Map();
  if (!Array.isArray(sockets)) return migratedSockets;
  for (const socket of sockets) {
    if (!isLegacyGeneratedDoorSocket(socket, module)) continue;
    const previousY = Number(socket.position?.y ?? socket.transform?.position?.y ?? socket.y ?? socket.elevation);
    socket.position = { ...(socket.position || socket.transform?.position || {}), y: 0 };
    socket.transform = {
      ...(socket.transform || {}),
      position: { ...(socket.transform?.position || socket.position), y: 0 },
    };
    if (Object.prototype.hasOwnProperty.call(socket, 'y')) socket.y = 0;
    if (Object.prototype.hasOwnProperty.call(socket, 'elevation')) socket.elevation = 0;
    socket.properties = { ...(socket.properties || {}), positionAnchor: 'threshold-floor' };
    migratedSockets.set(String(socket.id ?? ''), { previousY, nextY: 0 });
  }
  return migratedSockets;
}

function projectHasLegacyGeneratedDoorSockets(project) {
  const modules = Array.isArray(project?.roomModules) ? project.roomModules : [];
  const modulesById = new Map(modules.map((module) => [module.moduleId, module]));
  if (modules.some((module) => module.sockets?.some((socket) => isLegacyGeneratedDoorSocket(socket, module)))) return true;
  return (project?.rooms ?? []).some((room) => (
    room.sockets?.some((socket) => isLegacyGeneratedDoorSocket(socket, modulesById.get(room.moduleId)))
  ));
}

function addPaletteItem(item, placement = { x: 0, y: 0, z: 0 }) {
  if (!item) return;
  if (item.kind === 'connection-tool') {
    activateConnectionTool(item.type);
    return;
  }
  const resolved = normalizePlacementInput(item, placement);
  const position = vector(resolved.position);
  const rotationY = Number(resolved.rotationY) || 0;
  let createdId = null;
  commit(`Added ${item.name}`, () => {
    if (item.kind === 'room') {
      createdId = makeId('room');
      const size = item.size || [10, 4, 10];
      const moduleId = `${item.type}-${createdId.slice(-6)}`;
      const roomModule = makeRoomModule({ moduleId, name: item.name, size });
      state.project.rooms.push({
        id: createdId,
        moduleId,
        name: item.name,
        transform: { position: vector(position), rotationY, scale: { x: 1, y: 1, z: 1 } },
        dimensions: { width: size[0], height: size[1], depth: size[2] },
        properties: { archetype: item.type },
      });
      state.project.roomModules.push(roomModule);
      return;
    }
    if (item.kind === 'socket') {
      const room = getActiveRoom();
      const module = getRoomModule(room);
      if (!room || !module) return;
      module.sockets ||= [];
      createdId = makeId('socket');
      const socketPosition = vector(position);
      const facing = { x: Math.sin(rotationY), y: 0, z: Math.cos(rotationY) };
      module.sockets.push({ id: createdId, name: item.name, type: item.type, kind: item.type, actorKind: 'player', position: socketPosition, facing, transform: { position: clone(socketPosition), rotationY, scale: { x: 1, y: 1, z: 1 } }, widthMeters: 8.4, heightMeters: 5.6, landingRequirements: { minWidthMeters: 8.4, minDepthMeters: 8.4, maxStepMeters: 0.05 }, clearanceRequirements: { widthMeters: 8.4, heightMeters: 3.6, depthMeters: 5.6 }, compatibleFamilies: item.type === 'lift' ? ['lift', 'shaft'] : item.type === 'tunnel' ? ['tunnel', 'corridor'] : ['door', 'corridor'], required: false, optional: true, capPreset: item.type === 'lift' ? 'lift-shaft-cap' : 'sealed-wall', properties: { compatibleWith: item.type, positionAnchor: 'threshold-floor' } });
      module.topologyRevision += 1;
      return;
    }
    createdId = makeId('entity');
    const size = item.size || (item.type === 'trigger' ? [3, 2, 3] : [1, 1, 1]);
    if (item.kind === 'structural') {
      const module = getRoomModule();
      const primitivePosition = vector(position);
      const primitive = {
        id: createdId,
        kind: 'primitive',
        type: item.type,
        shape: item.shape || (item.type === 'ramp' ? 'ramp' : 'box'),
        name: item.name,
        size: { x: size[0], y: size[1], z: size[2] },
        transform: { position: primitivePosition, rotationY, scale: { x: 1, y: 1, z: 1 } },
        materialId: 'default',
        collision: true,
        enabled: true,
        properties: clone(item.defaults || {}),
      };
      if (['floor', 'ramp', 'platform', 'walkway', 'catwalk'].includes(item.type)) {
        primitive.surfaceRole = item.type;
        primitive.walkable = true;
      }
      module.primitives.push(primitive);
      module.topologyRevision += 1;
      return;
    }
    const entity = {
      id: createdId,
      kind: item.type,
      type: item.type,
      name: item.name,
      roomId: state.mode === 'room' ? getActiveRoom()?.id : undefined,
      transform: { position: vector(position), rotationY, scale: { x: 1, y: 1, z: 1 } },
      properties: { size, collision: false, enabled: true, editorCategory: item.kind, ...clone(item.defaults || {}) },
    };
    if (item.type === 'player-spawn' || item.type === 'dungeon-start') state.project.settings.spawnId = createdId;
    if (item.kind === 'light') Object.assign(entity.properties, { color: '#ffe4a8', intensity: 4, range: 10 });
    state.project.entities.push(entity);
  }, { select: createdId });
  selectItem(createdId);
  if (resolved.fallbackFrom) toast('Snap target not found', `Placed on the grid because no ${resolved.fallbackFrom} target was close enough.`, 'warning');
  return createdId;
}

function quickRoom() {
  const room = getActiveRoom();
  const module = getRoomModule(room);
  if (!room || !module) return;
  let firstId;
  commit('Created starter room', () => {
    const pieces = [
      ['floor', [0, -0.12, 0], [10, 0.24, 10]],
      ['wall', [0, 1.4, -5], [10, 2.8, 0.24]],
      ['wall', [0, 1.4, 5], [10, 2.8, 0.24]],
      ['wall', [-5, 1.4, 0], [0.24, 2.8, 10]],
      ['wall', [5, 1.4, 0], [0.24, 2.8, 10]],
    ];
    for (const [type, values, size] of pieces) {
      const id = makeId('entity');
      firstId ||= id;
      module.primitives.push({ id, kind: 'primitive', type, shape: 'box', ...(type === 'floor' ? { surfaceRole: 'floor', walkable: true } : {}), name: prettyType(type), size: { x: size[0], y: size[1], z: size[2] }, transform: { position: { x: values[0], y: values[1], z: values[2] }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } }, materialId: 'default', collision: true, enabled: true, properties: {} });
    }
    module.sockets = module.sockets?.length ? module.sockets : defaultSockets([10, 4, 10]);
    module.topologyRevision += 1;
    if (!state.project.entities.some((entity) => entity.type === 'player-spawn' && entity.roomId === room.id)) {
      const spawnId = makeId('entity');
      state.project.settings.spawnId = spawnId;
      state.project.entities.push({ id: spawnId, kind: 'player-spawn', type: 'player-spawn', name: 'Player Spawn', roomId: room.id, transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } }, properties: { enabled: true } });
    }
  }, { select: firstId });
}

function setMode(mode) {
  if (!['room', 'dungeon'].includes(mode) || state.mode === mode) return;
  state.mode = mode;
  clearSelection();
  resetConnectionWorkflow();
  $$('.mode-option').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#status-scope').textContent = mode === 'room' ? 'Room authoring' : 'Dungeon assembly';
  $('#scope-breadcrumb').textContent = mode === 'room' ? `ROOM / ${(getActiveRoom()?.name || 'ROOM').toUpperCase()}` : 'DUNGEON / OVERVIEW';
  renderPalette();
  rebuildEditor();
  frameAll();
}

function baseMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.12, ...options });
}

function meshWithEdges(geometry, material, edgeColor = 0x38434b) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.68 }));
  group.add(edges);
  return group;
}

function markSelectable(object, id) {
  object.userData.editorId = id;
  object.traverse((child) => { child.userData.editorId = id; });
  return object;
}

function applyTransform(object, transform) {
  const normalized = ensureTransform({ transform });
  object.position.set(normalized.position.x, normalized.position.y, normalized.position.z);
  object.rotation.set(0, normalized.rotationY, 0);
  object.scale.set(normalized.scale.x, normalized.scale.y, normalized.scale.z);
}

function createRoomVisual(room) {
  const dimensions = room.dimensions || {};
  const width = Number(dimensions.width) || 10;
  const height = Number(dimensions.height) || 4;
  const depth = Number(dimensions.depth) || 10;
  const group = new THREE.Group();
  const floor = meshWithEdges(new THREE.BoxGeometry(width, 0.18, depth), baseMaterial(0x26313a, { transparent: true, opacity: 0.9 }), 0x52708a);
  floor.position.y = 0.09;
  group.add(floor);
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)), new THREE.LineDashedMaterial({ color: 0x5d7890, dashSize: 0.3, gapSize: 0.18, transparent: true, opacity: 0.55 }));
  outline.position.y = height / 2;
  outline.computeLineDistances();
  group.add(outline);
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.2, 6), baseMaterial(0x76a9ff, { emissive: 0x19345e, emissiveIntensity: 0.7 }));
  marker.position.set(0, 0.7, 0);
  group.add(marker);
  applyTransform(group, room.transform);
  return markSelectable(group, room.id);
}

function createDoorFrame(size, material) {
  const [width, height, depth] = size;
  const group = new THREE.Group();
  const postWidth = Math.max(0.22, width * 0.16);
  for (const x of [-width / 2 + postWidth / 2, width / 2 - postWidth / 2]) {
    const post = meshWithEdges(new THREE.BoxGeometry(postWidth, height, depth), material.clone());
    post.position.set(x, 0, 0);
    group.add(post);
  }
  const lintel = meshWithEdges(new THREE.BoxGeometry(width, postWidth, depth), material.clone());
  lintel.position.y = height / 2 - postWidth / 2;
  group.add(lintel);
  return group;
}

function createMarkerVisual(entity) {
  const colorMap = { 'player-spawn': 0xd5ff44, 'dungeon-start': 0xd5ff44, 'enemy-spawn': 0xff6374, encounter: 0xff6374, 'boss-arena': 0xff6374, pickup: 0xffbf57, 'loot-cache': 0xffbf57, checkpoint: 0x65e19b, 'safe-zone': 0x65e19b, objective: 0xffbf57, extraction: 0x6fe3e8, 'room-exit': 0x6fe3e8 };
  const color = colorMap[entity.type] || 0x76a9ff;
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 8, 36), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 6), baseMaterial(color, { emissive: color, emissiveIntensity: 0.25 }));
  cone.position.y = 0.95;
  cone.rotation.x = Math.PI;
  group.add(cone);
  const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.12, 0), new THREE.Vector3(0, 0.7, 0)]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.65 }));
  group.add(stem);
  return group;
}

function createEntityVisual(entity) {
  const properties = entity.properties || {};
  const authoredSize = entity.size || properties.size;
  const size = Array.isArray(authoredSize)
    ? authoredSize.map(Number)
    : authoredSize && typeof authoredSize === 'object'
      ? [Number(authoredSize.x ?? authoredSize.width) || 1, Number(authoredSize.y ?? authoredSize.height) || 1, Number(authoredSize.z ?? authoredSize.depth) || 1]
      : [1, 1, 1];
  const editorCategory = entity.kind === 'primitive' || entity.shape ? 'structural' : properties.editorCategory || (['point-light'].includes(entity.type) ? 'light' : ['trigger'].includes(entity.type) ? 'volume' : 'marker');
  let object;
  if (editorCategory === 'marker') {
    object = createMarkerVisual(entity);
  } else if (editorCategory === 'light') {
    object = createMarkerVisual({ ...entity, type: 'light' });
    const color = new THREE.Color(properties.color || '#ffe4a8');
    const light = new THREE.PointLight(color, Number(properties.intensity) || 4, Number(properties.range) || 10, 2);
    light.position.y = 0.8;
    light.castShadow = false;
    object.add(light);
  } else if (editorCategory === 'volume') {
    const geometry = new THREE.BoxGeometry(...size);
    object = meshWithEdges(geometry, baseMaterial(0x76a9ff, { transparent: true, opacity: 0.12, depthWrite: false }), 0x76a9ff);
  } else if (entity.kind === 'model' || entity.type === 'gltf-model') {
    object = meshWithEdges(new THREE.BoxGeometry(...size), baseMaterial(0x33404a, { transparent: true, opacity: 0.45 }), 0x6fe3e8);
    queueModelLoad(entity, object);
  } else {
    const material = baseMaterial(entity.type === 'platform' ? 0x3a454c : 0x303a40);
    if (entity.type === 'door-frame') object = createDoorFrame(size, material);
    else object = meshWithEdges(new THREE.BoxGeometry(...size), material);
    if (entity.type === 'ramp') object.rotation.x = -Math.atan2(1.25, Math.max(1, size[2]));
  }
  applyTransform(object, entity.transform);
  object.userData.baseOffsetY = 0;
  return markSelectable(object, entity.id);
}

async function queueModelLoad(entity, placeholder) {
  const asset = state.project.assets.find((candidate) => candidate.id === entity.properties?.assetId || candidate.hash === entity.assetHash);
  const uri = asset ? await resolveAssetUrl(asset) : null;
  if (!uri) return;
  try {
    const gltf = await sceneState.gltfLoader.loadAsync(uri);
    if (!placeholder.parent) return;
    while (placeholder.children.length) placeholder.remove(placeholder.children[0]);
    const model = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const extent = box.getSize(new THREE.Vector3());
    const scale = 2 / Math.max(extent.x, extent.y, extent.z, 0.01);
    model.scale.setScalar(scale);
    model.position.y = -box.min.y * scale;
    model.traverse((child) => { child.userData.editorId = entity.id; if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
    placeholder.add(model);
  } catch (error) {
    console.warn(`Unable to preview ${asset?.name || 'model'}.`, error);
  }
}

function socketWorldPosition(owner, socket) {
  const local = vector(socket.position || socket.transform?.position || {
    x: socket.x,
    y: socket.y ?? socket.elevation,
    z: socket.z,
  });
  if (state.mode === 'room') return new THREE.Vector3(local.x, local.y, local.z);
  const roomPosition = vector(owner.transform?.position);
  const rotationY = Number(owner.transform?.rotationY) || 0;
  const roomScale = vector(owner.transform?.scale, { x: 1, y: 1, z: 1 });
  const rotated = new THREE.Vector3(local.x * roomScale.x, local.y * roomScale.y, local.z * roomScale.z)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
  return rotated.add(new THREE.Vector3(roomPosition.x, roomPosition.y, roomPosition.z));
}

function socketWorldFacing(owner, socket) {
  const rotationY = Number(socket.transform?.rotationY ?? socket.rotationY);
  const facing = vector(socket.facing || socket.transform?.facing || (
    Number.isFinite(rotationY)
      ? { x: Math.sin(rotationY), y: 0, z: Math.cos(rotationY) }
      : { x: socket.facingX, y: socket.facingY, z: socket.facingZ }
  ), { x: 0, y: 0, z: 1 });
  const ownerRotationY = state.mode === 'dungeon' ? Number(owner.transform?.rotationY) || 0 : 0;
  const world = new THREE.Vector3(facing.x, facing.y, facing.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), ownerRotationY);
  if (world.lengthSq() < 0.0001) world.set(0, 0, 1);
  return world.normalize();
}

function createSocketVisual(owner, socket) {
  const group = new THREE.Group();
  const priority = connectionSocketPriority(owner, socket);
  const connectionActive = Boolean(state.connectionTool || state.connectionFrom || selectedConnectionRooms().length === 2);
  const source = priority === 5;
  const eligible = priority >= 2;
  const color = source ? 0xd5ff44 : eligible ? 0x6fe3e8 : connectionActive ? 0x465159 : 0x6fe3e8;
  const opacity = connectionActive && priority < 0 ? 0.18 : source ? 1 : eligible ? 0.98 : 0.92;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(eligible || source ? 0.55 : 0.48, eligible || source ? 0.07 : 0.055, 8, 30), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
  ring.renderOrder = 8;
  group.add(ring);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(eligible || source ? 0.16 : 0.13, eligible || source ? 0.38 : 0.32, 5), new THREE.MeshBasicMaterial({ color, transparent: true, opacity }));
  arrow.rotation.x = Math.PI / 2;
  arrow.position.z = 0.52;
  group.add(arrow);
  if (eligible || source) {
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.64, 0.72, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: source ? 0.24 : 0.14, depthTest: false, side: THREE.DoubleSide }));
    halo.renderOrder = 7;
    group.add(halo);
  }
  const pickTarget = new THREE.Mesh(new THREE.SphereGeometry(0.72, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  pickTarget.name = 'ConnectionSocketPickTarget';
  group.add(pickTarget);
  const world = socketWorldPosition(owner, socket);
  group.position.copy(world);
  const facing = socketWorldFacing(owner, socket);
  group.rotation.set(0, Math.atan2(facing.x, facing.z), 0);
  group.userData.connectionPriority = priority;
  group.userData.connectionEligible = eligible;
  group.userData.connectionSource = source;
  return markSelectable(group, socket.id);
}

function findSocketEndpoint(endpoint) {
  if (!endpoint) return null;
  const room = state.project.rooms.find((candidate) => candidate.id === endpoint.roomId);
  const socket = room ? roomSockets(room).find((candidate) => candidate.id === endpoint.socketId) : null;
  return room && socket ? { room, socket } : null;
}

function createConnectionVisual(connection) {
  const from = findSocketEndpoint(connection.from);
  const to = findSocketEndpoint(connection.to);
  if (!from || !to) return null;
  const start = socketWorldPosition(from.room, from.socket);
  const end = socketWorldPosition(to.room, to.socket);
  const midpoint = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, Math.max(0.7, start.distanceTo(end) * 0.08), 0));
  const curve = new THREE.QuadraticBezierCurve3(start, midpoint, end);
  const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x6fe3e8, transparent: true, opacity: 0.72 }));
  return markSelectable(line, connection.id);
}

function clearContent() {
  if (!sceneState.content) return;
  sceneState.transform?.detach();
  sceneState.selectionBox.visible = false;
  sceneState.content.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
    else object.material?.dispose?.();
  });
  sceneState.content.clear();
  sceneState.visuals.clear();
}

function addVisual(id, object) {
  if (!object) return;
  sceneState.content.add(object);
  sceneState.visuals.set(id, object);
}

function rebuildScene() {
  if (!sceneState.scene) return;
  clearContent();
  if (state.mode === 'room') {
    const room = getActiveRoom();
    roomPrimitives(room).forEach((primitive) => addVisual(primitive.id, createEntityVisual(primitive)));
    state.project.entities.filter((entity) => entity.roomId === room?.id || (!entity.roomId && state.project.rooms.length === 1)).forEach((entity) => addVisual(entity.id, createEntityVisual(entity)));
    roomSockets(room).forEach((socket) => addVisual(socket.id, createSocketVisual(room, socket)));
  } else {
    state.project.rooms.forEach((room) => addVisual(room.id, createRoomVisual(room)));
    state.project.entities.filter((entity) => !entity.roomId).forEach((entity) => addVisual(entity.id, createEntityVisual(entity)));
    state.project.rooms.forEach((room) => roomSockets(room).forEach((socket) => addVisual(socket.id, createSocketVisual(room, socket))));
    state.project.connections.forEach((connection) => addVisual(connection.id, createConnectionVisual(connection)));
  }
  updateSelectionVisual();
}

function initScene() {
  const viewport = $('#viewport');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d0f);
  scene.fog = new THREE.FogExp2(0x0a0d0f, 0.014);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.08, 600);
  camera.position.set(10, 8, 10);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (error) {
    $('#viewport-empty').hidden = false;
    $('h2', $('#viewport-empty')).textContent = 'WebGL is unavailable';
    $('p', $('#viewport-empty')).textContent = 'The editor data tools still work, but this browser cannot create the 3D viewport.';
    toast('3D viewport unavailable', error.message, 'error', 7000);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  viewport.prepend(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.minDistance = 2;
  controls.maxDistance = 120;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.set(0, 0, 0);
  controls.mouseButtons.LEFT = null;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;

  const grid = new THREE.GridHelper(160, 160, 0x4b5b43, 0x222a2f);
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);
  const content = new THREE.Group();
  content.name = 'EditorContent';
  scene.add(content);
  const lights = new THREE.Group();
  const hemisphere = new THREE.HemisphereLight(0xa7c7d6, 0x1a1712, 1.35);
  const key = new THREE.DirectionalLight(0xfff1d0, 2.4);
  key.position.set(8, 14, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -24; key.shadow.camera.right = 24; key.shadow.camera.top = 24; key.shadow.camera.bottom = -24;
  const fill = new THREE.DirectionalLight(0x6b92b3, 0.75);
  fill.position.set(-10, 6, -8);
  lights.add(hemisphere, key, fill);
  scene.add(lights);

  const transform = new TransformControls(camera, renderer.domElement);
  transform.setTranslationSnap(state.snap && state.snapTarget === 'grid' ? state.snapValue : null);
  transform.setRotationSnap(Math.PI / 2);
  transform.setScaleSnap(0.1);
  transform.visible = false;
  scene.add(transform);
  const selectionBox = new THREE.Box3Helper(new THREE.Box3(), 0xd5ff44);
  selectionBox.material.depthTest = false;
  selectionBox.material.transparent = true;
  selectionBox.material.opacity = 0.9;
  selectionBox.renderOrder = 20;
  selectionBox.visible = false;
  scene.add(selectionBox);
  const selectionPivot = new THREE.Object3D();
  selectionPivot.name = 'MultiSelectionPivot';
  scene.add(selectionPivot);

  Object.assign(sceneState, { scene, camera, renderer, controls, transform, content, grid, lights, selectionBox, selectionPivot });
  transform.addEventListener('dragging-changed', (event) => { controls.enabled = !event.value; });
  transform.addEventListener('mouseDown', beginTransformChange);
  transform.addEventListener('objectChange', syncSelectionTransformFromVisuals);
  transform.addEventListener('mouseUp', finishTransformChange);

  const resize = () => {
    const rect = viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height, false);
  };
  new ResizeObserver(resize).observe(viewport);
  resize();
  renderer.setAnimationLoop(renderFrame);
  renderer.domElement.addEventListener('pointerdown', onViewportPointerDown);
  renderer.domElement.addEventListener('pointerup', onViewportPointerUp);
  renderer.domElement.addEventListener('dblclick', () => frameSelection());
  renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
}

function renderFrame(now) {
  sceneState.controls?.update();
  if (sceneState.selectionBox?.visible) sceneState.selectionBox.updateMatrixWorld(true);
  updateSelectionLabel();
  sceneState.renderer?.render(sceneState.scene, sceneState.camera);
  sceneState.fpsFrames += 1;
  if (now - sceneState.fpsStarted > 900) {
    const fps = Math.round((sceneState.fpsFrames * 1000) / (now - sceneState.fpsStarted));
    $('#renderer-status').textContent = `WebGL · ${fps} fps`;
    sceneState.fpsFrames = 0;
    sceneState.fpsStarted = now;
  }
}

function onViewportPointerDown(event) {
  sceneState.pointerDown = { x: event.clientX, y: event.clientY, button: event.button };
}

function onViewportPointerUp(event) {
  if (!sceneState.pointerDown || sceneState.pointerDown.button !== 0 || state.playing) return;
  const distance = Math.hypot(event.clientX - sceneState.pointerDown.x, event.clientY - sceneState.pointerDown.y);
  sceneState.pointerDown = null;
  if (distance > 4 || sceneState.transform?.dragging) return;
  const rect = sceneState.renderer.domElement.getBoundingClientRect();
  sceneState.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  sceneState.raycaster.setFromCamera(sceneState.pointer, sceneState.camera);
  const intersections = sceneState.raycaster.intersectObjects([...sceneState.visuals.values()], true);
  const nearbyConnectionSocket = (state.connectionTool || state.connectionFrom)
    ? availableSocketTargets()
      .map(({ room, socket, position }) => {
        const priority = connectionSocketPriority(room, socket);
        const screen = priority >= 2 ? projectedViewportPoint(position, rect) : null;
        return screen ? { id: socket.id, priority, distance: Math.hypot(screen.x - event.clientX, screen.y - event.clientY) } : null;
      })
      .filter((candidate) => candidate?.distance <= 44)
      .sort((left, right) => left.distance - right.distance || right.priority - left.priority)[0]
    : null;
  const connectionSocketHit = intersections
    .map((hit, index) => {
      const id = hit.object.userData.editorId;
      const descriptor = findRecord(id);
      if (descriptor?.category !== 'socket') return null;
      return { id, index, priority: connectionSocketPriority(descriptor.owner, descriptor.record) };
    })
    .filter((candidate) => candidate?.priority >= 2)
    .sort((left, right) => right.priority - left.priority || left.index - right.index)[0];
  const id = nearbyConnectionSocket?.id
    || connectionSocketHit?.id
    || intersections.find((hit) => hit.object.userData.editorId)?.object.userData.editorId
    || null;
  selectItem(id, { additive: event.shiftKey || event.ctrlKey || event.metaKey });
}

function roundTo(value, increment) {
  return Math.round(Number(value) / increment) * increment;
}

function placementSize(source) {
  const raw = source?.size || source?.properties?.size;
  if (Array.isArray(raw)) return raw.map((value) => Math.max(0, Number(value) || 0));
  if (raw && typeof raw === 'object') return [
    Math.max(0, Number(raw.x ?? raw.width) || 0),
    Math.max(0, Number(raw.y ?? raw.height) || 0),
    Math.max(0, Number(raw.z ?? raw.depth) || 0),
  ];
  if (source?.dimensions) return [
    Math.max(0, Number(source.dimensions.width) || 0),
    Math.max(0, Number(source.dimensions.height) || 0),
    Math.max(0, Number(source.dimensions.depth) || 0),
  ];
  return [1, 1, 1];
}

function placementDescriptor(source = {}) {
  const size = placementSize(source);
  const structural = source.kind === 'structural' || source.kind === 'primitive';
  const legacyRaised = structural && ['wall', 'pillar', 'door-frame', 'box', 'cylinder', 'sphere', 'collision-box', 'ramp'].includes(source.type);
  const room = source.kind === 'room';
  return {
    source,
    kind: source.kind || 'marker',
    type: source.type || 'object',
    size,
    legacyOffset: new THREE.Vector3(0, legacyRaised ? size[1] / 2 : 0, 0),
    contactHalf: new THREE.Vector3(
      structural || room ? size[0] / 2 : 0,
      structural ? size[1] / 2 : 0,
      structural || room ? size[2] / 2 : 0,
    ),
  };
}

function viewportRay(clientX, clientY) {
  if (!sceneState.camera || !sceneState.renderer) return null;
  const rect = sceneState.renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  sceneState.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  sceneState.raycaster.setFromCamera(sceneState.pointer, sceneState.camera);
  return { ray: sceneState.raycaster.ray.clone(), rect };
}

function groundPoint(ray) {
  const point = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  if (ray?.intersectPlane(plane, point)) return point;
  const fallback = sceneState.controls?.target || new THREE.Vector3();
  return new THREE.Vector3(fallback.x, 0, fallback.z);
}

function resolvedPlacement(position, details = {}) {
  return {
    __resolvedPlacement: true,
    position: vector(position),
    rotationY: Number(details.rotationY) || 0,
    snappedTo: details.snappedTo || 'free',
    snappedToId: details.snappedToId || null,
    fallbackFrom: details.fallbackFrom || null,
    normal: details.normal ? vector(details.normal) : null,
  };
}

function gridPlacement(basePoint, descriptor, details = {}) {
  const point = basePoint.clone().add(descriptor.legacyOffset);
  point.x = roundTo(point.x, state.snapValue);
  point.z = roundTo(point.z, state.snapValue);
  return resolvedPlacement(point, { snappedTo: 'grid', ...details });
}

function freePlacement(basePoint, descriptor) {
  return resolvedPlacement(basePoint.clone().add(descriptor.legacyOffset), { snappedTo: 'free' });
}

function isPlacementGeometry(id) {
  const target = findRecord(id);
  if (!target) return false;
  if (target.category === 'room') return true;
  if (target.category === 'primitive') {
    return target.record.enabled !== false
      && target.record.properties?.visual !== false
      && target.record.type !== 'collision-box';
  }
  if (target.category !== 'entity') return false;
  return target.record.type === 'gltf-model'
    || target.record.kind === 'model'
    || target.record.kind === 'primitive'
    || target.record.properties?.editorCategory === 'structural';
}

function surfacePlacement(rayInfo, descriptor) {
  if (!rayInfo) return null;
  sceneState.raycaster.ray.copy(rayInfo.ray);
  const hits = sceneState.raycaster.intersectObjects([...sceneState.visuals.values()], true);
  const hit = hits.find((candidate) => candidate.object?.isMesh
    && candidate.face
    && isPlacementGeometry(candidate.object.userData.editorId));
  if (!hit) return null;
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
  const offset = Math.abs(normal.x) * descriptor.contactHalf.x
    + Math.abs(normal.y) * descriptor.contactHalf.y
    + Math.abs(normal.z) * descriptor.contactHalf.z;
  const point = hit.point.clone().addScaledVector(normal, offset);
  const dominant = ['x', 'y', 'z'].sort((left, right) => Math.abs(normal[right]) - Math.abs(normal[left]))[0];
  for (const axis of ['x', 'y', 'z']) {
    if (axis !== dominant) point[axis] = roundTo(point[axis], PLACEMENT_PRECISION);
  }
  return resolvedPlacement(point, {
    snappedTo: 'surface',
    snappedToId: hit.object.userData.editorId,
    normal,
  });
}

function projectedViewportPoint(point, rect) {
  const projected = point.clone().project(sceneState.camera);
  if (projected.z < -1 || projected.z > 1) return null;
  return {
    x: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
  };
}

function objectPlacement(clientX, clientY, rayInfo, descriptor) {
  if (!rayInfo) return null;
  let nearest = null;
  for (const [id, visual] of sceneState.visuals) {
    if (!visual?.visible || !isPlacementGeometry(id)) continue;
    const box = new THREE.Box3().setFromObject(visual);
    if (box.isEmpty()) continue;
    const center = box.getCenter(new THREE.Vector3());
    const anchors = [
      { point: new THREE.Vector3(box.min.x, center.y, center.z), normal: new THREE.Vector3(-1, 0, 0) },
      { point: new THREE.Vector3(box.max.x, center.y, center.z), normal: new THREE.Vector3(1, 0, 0) },
      { point: new THREE.Vector3(center.x, box.min.y, center.z), normal: new THREE.Vector3(0, -1, 0) },
      { point: new THREE.Vector3(center.x, box.max.y, center.z), normal: new THREE.Vector3(0, 1, 0) },
      { point: new THREE.Vector3(center.x, center.y, box.min.z), normal: new THREE.Vector3(0, 0, -1) },
      { point: new THREE.Vector3(center.x, center.y, box.max.z), normal: new THREE.Vector3(0, 0, 1) },
    ];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      anchors.push({
        point: new THREE.Vector3(x < 0 ? box.min.x : box.max.x, y < 0 ? box.min.y : box.max.y, z < 0 ? box.min.z : box.max.z),
        normal: new THREE.Vector3(x, y, z),
        corner: true,
      });
    }
    for (const anchor of anchors) {
      const toCamera = sceneState.camera.position.clone().sub(anchor.point).normalize();
      if (anchor.normal.clone().normalize().dot(toCamera) <= 0.02) continue;
      const screen = projectedViewportPoint(anchor.point, rayInfo.rect);
      if (!screen) continue;
      const distance = Math.hypot(screen.x - clientX, screen.y - clientY);
      if (!nearest || distance < nearest.distance) nearest = { ...anchor, id, distance };
    }
  }
  if (!nearest || nearest.distance > 72) return null;
  const point = nearest.point.clone();
  if (nearest.corner) {
    point.x += Math.sign(nearest.normal.x) * descriptor.contactHalf.x;
    point.y += Math.sign(nearest.normal.y) * descriptor.contactHalf.y;
    point.z += Math.sign(nearest.normal.z) * descriptor.contactHalf.z;
  } else {
    const normal = nearest.normal.clone().normalize();
    const offset = Math.abs(normal.x) * descriptor.contactHalf.x
      + Math.abs(normal.y) * descriptor.contactHalf.y
      + Math.abs(normal.z) * descriptor.contactHalf.z;
    point.addScaledVector(normal, offset);
  }
  point.set(roundTo(point.x, PLACEMENT_PRECISION), roundTo(point.y, PLACEMENT_PRECISION), roundTo(point.z, PLACEMENT_PRECISION));
  return resolvedPlacement(point, { snappedTo: 'object', snappedToId: nearest.id, normal: nearest.normal });
}

function socketFamilies(socket) {
  return new Set([
    socket.type,
    socket.kind,
    ...(socket.compatibleFamilies || []),
    ...(socket.compatibleConnectorFamilies || []),
    ...(socket.connectorFamilies || []),
    ...(socket.families || []),
    socket.family,
    socket.connectorFamily,
  ].filter(Boolean).map((value) => String(value?.id ?? value?.value ?? value).toLowerCase()));
}

function advertisedSocketFamilies(socket) {
  return new Set([
    ...(socket.compatibleFamilies || []),
    ...(socket.compatibleConnectorFamilies || []),
    ...(socket.connectorFamilies || []),
    ...(socket.families || []),
    socket.family,
    socket.connectorFamily,
  ].filter(Boolean).map((value) => String(value?.id ?? value?.value ?? value).toLowerCase()));
}

function socketsAreCompatible(left, right) {
  const leftActor = left.actorKind || 'player';
  const rightActor = right.actorKind || 'player';
  if (leftActor !== rightActor && leftActor !== 'any' && rightActor !== 'any') return false;
  const leftFamilies = advertisedSocketFamilies(left);
  const rightFamilies = advertisedSocketFamilies(right);
  return leftFamilies.size === 0
    || rightFamilies.size === 0
    || [...leftFamilies].some((family) => rightFamilies.has(family));
}

function normalizeConnectionKind(value, fallback = 'corridor') {
  const kind = String(value || '').toLowerCase();
  return CONNECTION_KINDS.has(kind) ? kind : fallback;
}

function socketSupportsConnectionKind(socket, kind) {
  if (!socket || socket.enabled === false) return false;
  const normalized = normalizeConnectionKind(kind);
  const type = String(socket.type ?? socket.kind ?? '').toLowerCase();
  const families = socketFamilies(socket);
  if (normalized === 'door') return type === 'door' || families.has('door');
  if (normalized === 'lift') return type === 'lift' || families.has('lift') || families.has('shaft');
  return type === 'corridor'
    || type === 'door'
    || type === 'tunnel'
    || families.has('corridor')
    || families.has('service-gallery');
}

function socketConnection(roomId, socketId, ignoreConnectionId = null) {
  return state.project.connections.find((connection) => (
    connection.id !== ignoreConnectionId && (
      (connection.from?.roomId === roomId && connection.from?.socketId === socketId)
      || (connection.to?.roomId === roomId && connection.to?.socketId === socketId)
    )
  )) ?? null;
}

function endpointForSocket(room, socket) {
  return room && socket ? { roomId: room.id, socketId: socket.id } : null;
}

function endpointKey(endpoint) {
  return endpoint ? `${endpoint.roomId}:${endpoint.socketId}` : '';
}

function sameEndpoint(left, right) {
  return Boolean(left && right && left.roomId === right.roomId && left.socketId === right.socketId);
}

function connectionAlreadyExists(from, to, ignoreConnectionId = null) {
  return state.project.connections.some((connection) => (
    connection.id !== ignoreConnectionId && (
      (sameEndpoint(connection.from, from) && sameEndpoint(connection.to, to))
      || (connection.bidirectional !== false && sameEndpoint(connection.from, to) && sameEndpoint(connection.to, from))
    )
  ));
}

function resolveSocketEndpoint(endpoint) {
  const room = state.project.rooms.find((candidate) => candidate.id === endpoint?.roomId);
  const socket = room ? roomSockets(room).find((candidate) => candidate.id === endpoint?.socketId) : null;
  if (!room || !socket) return null;
  return { room, socket, descriptor: { category: 'socket', owner: room, record: socket, module: getRoomModule(room, { create: false }) } };
}

function socketPairEligibility(fromRoom, fromSocket, toRoom, toSocket, kind, { ignoreConnectionId = null } = {}) {
  const normalizedKind = normalizeConnectionKind(kind);
  if (!fromRoom || !toRoom || !fromSocket || !toSocket) return { eligible: false, reason: 'Choose two valid room sockets.' };
  if (fromRoom.id === toRoom.id) return { eligible: false, reason: 'Connections must join different rooms.' };
  if (fromSocket.id === toSocket.id) return { eligible: false, reason: 'Choose two different sockets.' };
  if (fromSocket.enabled === false || toSocket.enabled === false) return { eligible: false, reason: 'One of these sockets is disabled.' };
  if (socketConnection(fromRoom.id, fromSocket.id, ignoreConnectionId) || socketConnection(toRoom.id, toSocket.id, ignoreConnectionId)) return { eligible: false, reason: 'One of these sockets is already connected.' };
  if (!socketSupportsConnectionKind(fromSocket, normalizedKind) || !socketSupportsConnectionKind(toSocket, normalizedKind)) {
    return { eligible: false, reason: `Both sockets must support ${normalizedKind} links.` };
  }
  if (!socketsAreCompatible(fromSocket, toSocket)) return { eligible: false, reason: 'The socket families or actor types are incompatible.' };

  const fromWidth = Number(fromSocket.widthMeters ?? fromSocket.width ?? 8.4);
  const toWidth = Number(toSocket.widthMeters ?? toSocket.width ?? 8.4);
  const fromHeight = Number(fromSocket.heightMeters ?? fromSocket.height ?? 5.6);
  const toHeight = Number(toSocket.heightMeters ?? toSocket.height ?? 5.6);
  if (Math.min(fromWidth, toWidth) < 8.4 - CONNECTION_ELEVATION_TOLERANCE) {
    return { eligible: false, reason: 'The connector requires two 8.4 m-wide sockets.' };
  }
  if (Math.min(fromHeight, toHeight) < 3.6 - CONNECTION_ELEVATION_TOLERANCE) {
    return { eligible: false, reason: 'The connector requires at least 3.6 m of headroom.' };
  }

  const fromPosition = socketWorldPosition(fromRoom, fromSocket);
  const toPosition = socketWorldPosition(toRoom, toSocket);
  const positionAligned = [fromPosition, toPosition].every((position) => ['x', 'y', 'z'].every((axis) => (
    Math.abs(position[axis] / PLACEMENT_PRECISION - Math.round(position[axis] / PLACEMENT_PRECISION)) <= 0.001
  )));
  if (!positionAligned) return { eligible: false, reason: 'Socket positions must align to the 0.05 m connection grid.' };
  const elevationDelta = toPosition.y - fromPosition.y;
  const elevationAccepted = normalizedKind === 'lift'
    ? Math.abs(Math.abs(elevationDelta) - 14) <= CONNECTION_ELEVATION_TOLERANCE
    : Math.abs(elevationDelta) <= CONNECTION_ELEVATION_TOLERANCE;
  if (!elevationAccepted) {
    return {
      eligible: false,
      reason: normalizedKind === 'lift'
        ? 'Lift sockets must be separated by exactly 14 m.'
        : `${prettyType(normalizedKind)} sockets must be level.`,
    };
  }
  const horizontalDistance = Math.hypot(
    toPosition.x - fromPosition.x,
    toPosition.z - fromPosition.z,
  );
  if (normalizedKind === 'lift' && horizontalDistance > CONNECTION_ELEVATION_TOLERANCE) {
    return { eligible: false, reason: 'Lift sockets must share the same horizontal shaft position.' };
  }

  const fromFacing = socketWorldFacing(fromRoom, fromSocket);
  const toFacing = socketWorldFacing(toRoom, toSocket);
  const axisAlignedFacing = [fromFacing, toFacing].every((facing) => (
    Math.abs(facing.y) <= 0.05 && (
      (Math.abs(Math.abs(facing.x) - 1) <= 0.05 && Math.abs(facing.z) <= 0.05)
      || (Math.abs(Math.abs(facing.z) - 1) <= 0.05 && Math.abs(facing.x) <= 0.05)
    )
  ));
  if (!axisAlignedFacing) return { eligible: false, reason: 'Connector sockets must face along a grid axis.' };
  const facingDot = fromFacing.dot(toFacing);
  if (facingDot > CONNECTION_FACING_DOT_MAX) {
    return { eligible: false, reason: 'Socket facings must point in opposite directions.' };
  }

  const from = endpointForSocket(fromRoom, fromSocket);
  const to = endpointForSocket(toRoom, toSocket);
  if (connectionAlreadyExists(from, to, ignoreConnectionId)) return { eligible: false, reason: 'These sockets are already linked.' };

  const distance = fromPosition.distanceTo(toPosition);
  return {
    eligible: true,
    reason: '',
    kind: normalizedKind,
    from,
    to,
    fromRoom,
    toRoom,
    fromSocket,
    toSocket,
    fromPosition,
    toPosition,
    fromFacing,
    toFacing,
    distance,
    elevationDelta,
    facingDot,
    score: distance + Math.abs(elevationDelta) * 4 + (facingDot + 1) * 20,
  };
}

function eligibleConnectionPairs(fromRoom, toRoom, kind) {
  if (!fromRoom || !toRoom || fromRoom.id === toRoom.id) return [];
  const pairs = [];
  for (const fromSocket of roomSockets(fromRoom)) {
    for (const toSocket of roomSockets(toRoom)) {
      const candidate = socketPairEligibility(fromRoom, fromSocket, toRoom, toSocket, kind);
      if (candidate.eligible) pairs.push(candidate);
    }
  }
  return pairs.sort((left, right) => (
    left.score - right.score
    || left.fromSocket.id.localeCompare(right.fromSocket.id)
    || left.toSocket.id.localeCompare(right.toSocket.id)
  ));
}

function relaxedConnectionPair(fromRoom, fromSocket, toRoom, toSocket, kind) {
  const normalizedKind = normalizeConnectionKind(kind);
  if (!fromRoom || !toRoom || !fromSocket || !toSocket || fromRoom.id === toRoom.id) return null;
  if (fromSocket.enabled === false || toSocket.enabled === false) return null;
  if (socketConnection(fromRoom.id, fromSocket.id) || socketConnection(toRoom.id, toSocket.id)) return null;
  if (!socketSupportsConnectionKind(fromSocket, normalizedKind) || !socketSupportsConnectionKind(toSocket, normalizedKind)) return null;
  if (!socketsAreCompatible(fromSocket, toSocket)) return null;
  const widthMeters = Math.min(
    Number(fromSocket.widthMeters ?? fromSocket.width ?? 8.4),
    Number(toSocket.widthMeters ?? toSocket.width ?? 8.4),
  );
  const clearHeightMeters = Math.min(
    Number(fromSocket.heightMeters ?? fromSocket.height ?? 5.6),
    Number(toSocket.heightMeters ?? toSocket.height ?? 5.6),
  );
  if (widthMeters < 8.4 - CONNECTION_ELEVATION_TOLERANCE || clearHeightMeters < 3.6 - CONNECTION_ELEVATION_TOLERANCE) return null;
  return {
    kind: normalizedKind,
    from: endpointForSocket(fromRoom, fromSocket),
    to: endpointForSocket(toRoom, toSocket),
    fromRoom,
    toRoom,
    fromSocket,
    toSocket,
    widthMeters,
    clearHeightMeters,
  };
}

function socketLocalFacing(socket) {
  const rotationY = Number(socket.transform?.rotationY ?? socket.rotationY);
  const facing = vector(socket.facing || socket.transform?.facing || (
    Number.isFinite(rotationY)
      ? { x: Math.sin(rotationY), y: 0, z: Math.cos(rotationY) }
      : { x: socket.facingX, y: socket.facingY, z: socket.facingZ }
  ), { x: 0, y: 0, z: 1 });
  const result = new THREE.Vector3(facing.x, facing.y, facing.z);
  return result.lengthSq() < 0.0001 ? new THREE.Vector3(0, 0, 1) : result.normalize();
}

function isGridAxisFacing(facing) {
  return Math.abs(facing.y) <= 0.05 && (
    (Math.abs(Math.abs(facing.x) - 1) <= 0.05 && Math.abs(facing.z) <= 0.05)
    || (Math.abs(Math.abs(facing.z) - 1) <= 0.05 && Math.abs(facing.x) <= 0.05)
  );
}

function connectorAlignmentProposal(candidate) {
  if (!candidate) return null;
  const canonicalCoordinate = (value) => Math.abs(value) < 0.0000001 ? 0 : value;
  const wrappedAngle = (value) => Math.atan2(Math.sin(value), Math.cos(value));
  const readRoomTransform = (room) => ({
    position: vector(room.transform?.position),
    rotationY: Number(room.transform?.rotationY ?? room.transform?.rotation?.y) || 0,
    scale: vector(room.transform?.scale, { x: 1, y: 1, z: 1 }),
  });
  const readSocketPosition = (socket) => vector(socket.transform?.position || socket.position || {
    x: socket.x,
    y: socket.y ?? socket.elevation,
    z: socket.z,
  });

  const sourceTransform = readRoomTransform(candidate.fromRoom);
  const destinationTransform = readRoomTransform(candidate.toRoom);
  const localFromFacing = socketLocalFacing(candidate.fromSocket);
  const localToFacing = socketLocalFacing(candidate.toSocket);
  if (Math.abs(localFromFacing.y) > 0.05 || Math.abs(localToFacing.y) > 0.05) {
    return { ...candidate, canAlign: false, reason: 'These socket definitions are tilted vertically and cannot be aligned by room transforms.' };
  }
  if (!isGridAxisFacing(localFromFacing) || !isGridAxisFacing(localToFacing)) {
    return { ...candidate, canAlign: false, reason: 'Socket definitions must face along a local grid axis before their rooms can be aligned.' };
  }

  const currentFromPosition = socketWorldPosition(candidate.fromRoom, candidate.fromSocket);
  const currentToPosition = socketWorldPosition(candidate.toRoom, candidate.toSocket);
  const localFromFacingAngle = Math.atan2(localFromFacing.x, localFromFacing.z);
  const currentFromFacingAngle = localFromFacingAngle + sourceTransform.rotationY;
  const sourceWorldFacingAngle = roundTo(currentFromFacingAngle, Math.PI / 2);
  const sourceRotationY = wrappedAngle(sourceWorldFacingAngle - localFromFacingAngle);
  const fromFacing = new THREE.Vector3(Math.sin(sourceWorldFacingAngle), 0, Math.cos(sourceWorldFacingAngle)).normalize();
  const connectorGrid = CONNECTOR_GRID_SIZE;
  const snappedFromPosition = new THREE.Vector3(
    roundTo(currentFromPosition.x, connectorGrid),
    roundTo(currentFromPosition.y, PLACEMENT_PRECISION),
    roundTo(currentFromPosition.z, connectorGrid),
  );
  const localFromPosition = readSocketPosition(candidate.fromSocket);
  const rotatedLocalFromPosition = new THREE.Vector3(
    localFromPosition.x * sourceTransform.scale.x,
    localFromPosition.y * sourceTransform.scale.y,
    localFromPosition.z * sourceTransform.scale.z,
  ).applyAxisAngle(new THREE.Vector3(0, 1, 0), sourceRotationY);
  const sourceRoomPosition = snappedFromPosition.clone().sub(rotatedLocalFromPosition);
  const sourceTargetPosition = {
    x: canonicalCoordinate(sourceRoomPosition.x),
    y: canonicalCoordinate(sourceRoomPosition.y),
    z: canonicalCoordinate(sourceRoomPosition.z),
  };
  const sourceRotationDelta = wrappedAngle(sourceRotationY - sourceTransform.rotationY);
  const sourceMoveDistance = Math.hypot(
    sourceTargetPosition.x - sourceTransform.position.x,
    sourceTargetPosition.y - sourceTransform.position.y,
    sourceTargetPosition.z - sourceTransform.position.z,
  );
  const sourceChanged = sourceMoveDistance > CONNECTION_ALIGNMENT_EPSILON
    || Math.abs(sourceRotationDelta) > CONNECTION_ALIGNMENT_EPSILON;
  if (sourceChanged && (candidate.fromRoom.locked === true || candidate.fromRoom.properties?.locked === true)) {
    return { ...candidate, canAlign: false, reason: `Alignment needs to move ${candidate.fromRoom.name || 'the source room'}, but its transform is locked.` };
  }
  const sourceHasConnections = state.project.connections.some((connection) => (
    connection.from?.roomId === candidate.fromRoom.id || connection.to?.roomId === candidate.fromRoom.id
  ));
  if (sourceChanged && sourceHasConnections) {
    return { ...candidate, canAlign: false, reason: `Alignment would move ${candidate.fromRoom.name || 'the source room'}, which already has a connection. Disconnect it or choose another room.` };
  }

  const desiredFacing = fromFacing.clone().multiplyScalar(-1);
  const desiredFacingAngle = Math.atan2(desiredFacing.x, desiredFacing.z);
  const localFacingAngle = Math.atan2(localToFacing.x, localToFacing.z);
  const rotationY = wrappedAngle(roundTo(desiredFacingAngle - localFacingAngle, Math.PI / 2));
  const currentForward = currentToPosition.clone().sub(snappedFromPosition).dot(fromFacing);
  const minimumDistance = SOCKET_ENDPOINT_BUFFER * 2;
  const forwardDistance = candidate.kind === 'lift'
    ? 0
    : Math.max(minimumDistance, roundTo(Math.max(minimumDistance, currentForward), connectorGrid));
  const currentElevationDirection = currentToPosition.y >= snappedFromPosition.y ? 1 : -1;
  const allowedElevations = candidate.kind === 'lift'
    ? [14 * currentElevationDirection, -14 * currentElevationDirection]
    : [0];
  const elevationDelta = allowedElevations.sort((left, right) => (
    Math.abs(snappedFromPosition.y + left - currentToPosition.y) - Math.abs(snappedFromPosition.y + right - currentToPosition.y)
  ))[0];
  const desiredSocketPosition = snappedFromPosition.clone().addScaledVector(fromFacing, forwardDistance);
  desiredSocketPosition.y = snappedFromPosition.y + elevationDelta;

  const localPosition = readSocketPosition(candidate.toSocket);
  const rotatedLocalPosition = new THREE.Vector3(
    localPosition.x * destinationTransform.scale.x,
    localPosition.y * destinationTransform.scale.y,
    localPosition.z * destinationTransform.scale.z,
  )
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
  const roomPosition = desiredSocketPosition.clone().sub(rotatedLocalPosition);
  const targetPosition = {
    x: canonicalCoordinate(roomPosition.x),
    y: canonicalCoordinate(roomPosition.y),
    z: canonicalCoordinate(roomPosition.z),
  };
  const rotationDelta = wrappedAngle(rotationY - destinationTransform.rotationY);
  const moveDistance = Math.hypot(
    targetPosition.x - destinationTransform.position.x,
    targetPosition.y - destinationTransform.position.y,
    targetPosition.z - destinationTransform.position.z,
  );
  const destinationChanged = moveDistance > CONNECTION_ALIGNMENT_EPSILON
    || Math.abs(rotationDelta) > CONNECTION_ALIGNMENT_EPSILON;
  if (destinationChanged && (candidate.toRoom.locked === true || candidate.toRoom.properties?.locked === true)) {
    return { ...candidate, canAlign: false, reason: `Alignment needs to move ${candidate.toRoom.name || 'the destination room'}, but its transform is locked.` };
  }
  const destinationHasConnections = state.project.connections.some((connection) => (
    connection.from?.roomId === candidate.toRoom.id || connection.to?.roomId === candidate.toRoom.id
  ));
  if (destinationChanged && destinationHasConnections) {
    return { ...candidate, canAlign: false, reason: `Alignment would move ${candidate.toRoom.name || 'the destination room'}, which already has a connection. Disconnect it or choose another room.` };
  }

  const changed = sourceChanged || destinationChanged;
  const originalSourceTransform = candidate.fromRoom.transform;
  const originalDestinationTransform = candidate.toRoom.transform;
  let postAlignment;
  try {
    candidate.fromRoom.transform = {
      ...clone(sourceTransform),
      position: clone(sourceTargetPosition),
      rotationY: sourceRotationY,
    };
    candidate.toRoom.transform = {
      ...clone(destinationTransform),
      position: clone(targetPosition),
      rotationY,
    };
    postAlignment = socketPairEligibility(candidate.fromRoom, candidate.fromSocket, candidate.toRoom, candidate.toSocket, candidate.kind);
  } finally {
    candidate.fromRoom.transform = originalSourceTransform;
    candidate.toRoom.transform = originalDestinationTransform;
  }
  if (!postAlignment.eligible) {
    return { ...candidate, canAlign: false, reason: `Automatic room alignment could not satisfy this socket pair: ${postAlignment.reason}` };
  }
  return {
    ...candidate,
    canAlign: changed,
    reason: changed ? '' : 'Both rooms already satisfy the connector grid, facing, elevation, and buffer requirements.',
    sourceChanged,
    sourceTargetPosition,
    sourceTargetRotationY: sourceRotationY,
    destinationChanged,
    targetPosition,
    targetRotationY: rotationY,
    forwardDistance,
    elevationDelta,
    score: sourceMoveDistance + Math.abs(sourceRotationDelta) * 2 + moveDistance + Math.abs(rotationDelta) * 2,
  };
}

function connectionAlignmentForModel(model) {
  if (!model?.fromRoom || !model?.toRoom || model.fromRoom.id === model.toRoom.id) {
    return { canAlign: false, reason: 'Shift-select a destination room to enable alignment.' };
  }
  if (model.selectedPair) {
    return connectorAlignmentProposal(relaxedConnectionPair(
      model.selectedPair.fromRoom,
      model.selectedPair.fromSocket,
      model.selectedPair.toRoom,
      model.selectedPair.toSocket,
      model.kind,
    ));
  }
  const fromSockets = model.source?.socket ? [model.source.socket] : roomSockets(model.fromRoom);
  const relaxed = fromSockets.flatMap((fromSocket) => roomSockets(model.toRoom)
    .map((toSocket) => relaxedConnectionPair(model.fromRoom, fromSocket, model.toRoom, toSocket, model.kind)))
    .filter(Boolean);
  const unique = [...new Map(relaxed.map((candidate) => [`${endpointKey(candidate.from)}>${endpointKey(candidate.to)}`, candidate])).values()];
  if (!unique.length) return { canAlign: false, reason: 'These rooms do not have an unused compatible socket pair.' };
  const proposals = unique.map(connectorAlignmentProposal).filter(Boolean).sort((left, right) => (
    Number(right.canAlign) - Number(left.canAlign)
    || (left.score ?? Number.POSITIVE_INFINITY) - (right.score ?? Number.POSITIVE_INFINITY)
    || left.fromSocket.id.localeCompare(right.fromSocket.id)
    || left.toSocket.id.localeCompare(right.toSocket.id)
  ));
  return proposals[0] ?? { canAlign: false, reason: 'These sockets cannot be aligned automatically.' };
}

function roomForSelectionDescriptor(descriptor) {
  if (descriptor?.category === 'room') return descriptor.record;
  if (descriptor?.owner) return descriptor.owner;
  const roomId = descriptor?.record?.roomId ?? descriptor?.record?.properties?.roomId;
  return roomId ? state.project.rooms.find((room) => room.id === roomId) ?? null : null;
}

function selectedConnectionRooms() {
  if (state.mode !== 'dungeon') return [];
  const rooms = [];
  for (const id of validSelectedIds()) {
    const room = roomForSelectionDescriptor(findRecord(id));
    if (room && !rooms.some((candidate) => candidate.id === room.id)) rooms.push(room);
  }
  return rooms.length === 2 ? rooms : [];
}

function inferredConnectionKind(socket = null) {
  const type = String(socket?.type ?? socket?.kind ?? '').toLowerCase();
  if (type === 'lift') return 'lift';
  if (type === 'door') return 'door';
  return 'corridor';
}

function connectionIntentKind() {
  if (state.connectionDraft?.kind) return normalizeConnectionKind(state.connectionDraft.kind);
  if (state.connectionTool) return normalizeConnectionKind(state.connectionTool);
  return inferredConnectionKind(resolveSocketEndpoint(state.connectionFrom)?.socket);
}

function allEligibleTargetsForSource(sourceEndpoint, kind, roomFilter = null) {
  const source = resolveSocketEndpoint(sourceEndpoint);
  if (!source) return [];
  const rooms = roomFilter?.length
    ? roomFilter.filter((room) => room.id !== source.room.id)
    : state.project.rooms.filter((room) => room.id !== source.room.id);
  return rooms.flatMap((room) => eligibleConnectionPairs(source.room, room, kind)
    .filter((candidate) => candidate.fromSocket.id === source.socket.id));
}

function connectionSocketPriority(room, socket) {
  const source = state.connectionFrom;
  if (sameEndpoint(source, endpointForSocket(room, socket))) return 5;
  const kind = connectionIntentKind();
  const pairRooms = selectedConnectionRooms();
  const active = Boolean(state.connectionTool || source || pairRooms.length === 2);
  if (!active) return 0;
  if (socketConnection(room.id, socket.id) || !socketSupportsConnectionKind(socket, kind)) return -1;
  if (source) {
    const resolvedSource = resolveSocketEndpoint(source);
    if (!resolvedSource) return -1;
    const candidate = socketPairEligibility(resolvedSource.room, resolvedSource.socket, room, socket, kind);
    return candidate.eligible ? (String(socket.type).toLowerCase() === kind ? 4 : 3) : -1;
  }
  if (pairRooms.length === 2) {
    if (!pairRooms.some((candidate) => candidate.id === room.id)) return -1;
    const [left, right] = pairRooms;
    const counterpart = room.id === left.id ? right : left;
    const participates = roomSockets(counterpart).some((otherSocket) => (
      room.id === left.id
        ? socketPairEligibility(room, socket, counterpart, otherSocket, kind).eligible
        : socketPairEligibility(counterpart, otherSocket, room, socket, kind).eligible
    ));
    return participates ? (String(socket.type).toLowerCase() === kind ? 4 : 3) : -1;
  }
  return String(socket.type).toLowerCase() === kind ? 4 : 2;
}

function resetConnectionWorkflow({ tool = true, draft = true } = {}) {
  state.connectionFrom = null;
  if (tool) state.connectionTool = null;
  if (draft) state.connectionDraft = null;
}

function activateConnectionTool(kind) {
  const normalizedKind = normalizeConnectionKind(kind);
  if (state.mode !== 'dungeon') setMode('dungeon');
  const togglingOff = state.connectionTool === normalizedKind && !state.connectionFrom;
  if (togglingOff) {
    resetConnectionWorkflow();
    toast('Connection tool closed', 'Select two rooms with Shift to open it again.', 'warning');
  } else {
    state.connectionTool = normalizedKind;
    state.connectionFrom = null;
    state.connectionDraft = {
      kind: normalizedKind,
      bidirectional: state.connectionDraft?.bidirectional !== false,
    };
    toast(`${prettyType(normalizedKind)} link active`, `Highlighted ${normalizedKind} sockets are ready to select.`, 'success');
  }
  renderPalette();
  rebuildEditor();
}

function beginConnectionFromSocket(descriptor) {
  if (descriptor?.category !== 'socket') return false;
  const kind = connectionIntentKind() || inferredConnectionKind(descriptor.record);
  if (socketConnection(descriptor.owner.id, descriptor.record.id)) {
    toast('Socket unavailable', 'This socket already belongs to a connection.', 'warning');
    return false;
  }
  if (!socketSupportsConnectionKind(descriptor.record, kind)) {
    toast('Socket is not eligible', `Choose a socket that supports ${kind} links.`, 'warning');
    return false;
  }
  state.connectionTool ||= kind;
  state.connectionFrom = endpointForSocket(descriptor.owner, descriptor.record);
  state.connectionDraft = {
    ...(state.connectionDraft ?? {}),
    kind,
    bidirectional: state.connectionDraft?.bidirectional !== false,
    fromRoomId: descriptor.owner.id,
    fromSocketId: descriptor.record.id,
  };
  state.selectedId = descriptor.record.id;
  state.selectedIds = [descriptor.record.id];
  renderPalette();
  rebuildEditor();
  toast('Source socket selected', 'Choose a highlighted destination socket, or use the connection interface.');
  return true;
}

function connectionRouteWaypoints(candidate) {
  if (!candidate?.eligible || candidate.kind === 'lift') return [];
  const alignment = (value) => roundTo(value, PLACEMENT_PRECISION);
  const start = candidate.fromPosition.clone();
  const end = candidate.toPosition.clone();
  const startBuffer = start.clone().addScaledVector(candidate.fromFacing, SOCKET_ENDPOINT_BUFFER);
  const endBuffer = end.clone().addScaledVector(candidate.toFacing, SOCKET_ENDPOINT_BUFFER);
  const horizontalDistance = (left, right) => Math.hypot(right.x - left.x, right.z - left.z);
  const middleDistance = horizontalDistance(startBuffer, endBuffer);
  const points = [startBuffer];
  if (Math.abs(startBuffer.x - endBuffer.x) > 0.001 && Math.abs(startBuffer.z - endBuffer.z) > 0.001) {
    const xFirst = new THREE.Vector3(endBuffer.x, startBuffer.y, startBuffer.z);
    const zFirst = new THREE.Vector3(startBuffer.x, startBuffer.y, endBuffer.z);
    const xFirstLength = horizontalDistance(startBuffer, xFirst) + horizontalDistance(xFirst, endBuffer);
    const zFirstLength = horizontalDistance(startBuffer, zFirst) + horizontalDistance(zFirst, endBuffer);
    const corner = xFirstLength <= zFirstLength ? xFirst : zFirst;
    const progress = horizontalDistance(startBuffer, corner) / Math.max(0.0001, middleDistance);
    corner.y = THREE.MathUtils.lerp(start.y, end.y, progress);
    points.push(corner);
  }
  points.push(endBuffer);
  return points
    .map((point) => ({ x: alignment(point.x), y: alignment(point.y), z: alignment(point.z) }))
    .filter((point, index, list) => index === 0 || Math.hypot(
      point.x - list[index - 1].x,
      point.y - list[index - 1].y,
      point.z - list[index - 1].z,
    ) > 0.001);
}

function availableSocketTargets() {
  const connected = new Set(state.project.connections.flatMap((connection) => [
    endpointKey(connection.from),
    endpointKey(connection.to),
  ]).filter(Boolean));
  const rooms = state.mode === 'room' ? [getActiveRoom()].filter(Boolean) : state.project.rooms;
  return rooms.flatMap((room) => roomSockets(room)
    .filter((socket) => socket.enabled !== false && !connected.has(endpointKey(endpointForSocket(room, socket))))
    .map((socket) => ({ room, socket, position: socketWorldPosition(room, socket), facing: socketWorldFacing(room, socket) })));
}

function nearestSocketTarget(clientX, clientY, rayInfo) {
  if (!rayInfo) return null;
  let nearest = null;
  for (const candidate of availableSocketTargets()) {
    const screen = projectedViewportPoint(candidate.position, rayInfo.rect);
    if (!screen) continue;
    const distance = Math.hypot(screen.x - clientX, screen.y - clientY);
    if (!nearest || distance < nearest.distance) nearest = { ...candidate, distance };
  }
  return nearest?.distance <= 52 ? nearest : null;
}

function socketRoomPlacement(target, descriptor, pointerBase) {
  const sourceSockets = defaultSockets(descriptor.size).filter((socket) => socketsAreCompatible(socket, target.socket));
  if (!sourceSockets.length) return null;
  const desiredFacing = target.facing.clone().multiplyScalar(-1);
  const desiredFacingAngle = Math.atan2(desiredFacing.x, desiredFacing.z);
  const desiredSocketPosition = target.position.clone().addScaledVector(target.facing, SOCKET_ENDPOINT_BUFFER);
  let best = null;
  for (const source of sourceSockets) {
    const sourceFacing = vector(source.facing, { x: 0, y: 0, z: 1 });
    const sourceAngle = Math.atan2(sourceFacing.x, sourceFacing.z);
    const rotationY = roundTo(desiredFacingAngle - sourceAngle, Math.PI / 2);
    const sourcePosition = vector(source.position);
    const rotatedSource = new THREE.Vector3(sourcePosition.x, sourcePosition.y, sourcePosition.z)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    const roomPosition = desiredSocketPosition.clone().sub(rotatedSource);
    roomPosition.set(
      roundTo(roomPosition.x, PLACEMENT_PRECISION),
      roundTo(roomPosition.y, PLACEMENT_PRECISION),
      roundTo(roomPosition.z, PLACEMENT_PRECISION),
    );
    const score = roomPosition.distanceToSquared(pointerBase);
    if (!best || score < best.score) best = { roomPosition, rotationY, source, score };
  }
  return resolvedPlacement(best.roomPosition, {
    snappedTo: 'socket',
    snappedToId: target.socket.id,
    normal: target.facing,
    rotationY: best.rotationY,
  });
}

function socketPlacement(clientX, clientY, rayInfo, descriptor, pointerBase) {
  const target = nearestSocketTarget(clientX, clientY, rayInfo);
  if (!target) return null;
  if (descriptor.kind === 'room') return socketRoomPlacement(target, descriptor, pointerBase);
  const point = target.position.clone();
  point.set(roundTo(point.x, PLACEMENT_PRECISION), roundTo(point.y, PLACEMENT_PRECISION), roundTo(point.z, PLACEMENT_PRECISION));
  return resolvedPlacement(point, {
    snappedTo: 'socket',
    snappedToId: target.socket.id,
    normal: target.facing,
    rotationY: Math.atan2(target.facing.x, target.facing.z),
  });
}

function resolvePlacement(clientX, clientY, source = {}, options = {}) {
  const descriptor = placementDescriptor(source);
  const rayInfo = viewportRay(clientX, clientY);
  const base = groundPoint(rayInfo?.ray);
  const target = SNAP_TARGETS.has(options.target) ? options.target : state.snapTarget;
  const enabled = options.enabled ?? state.snap;
  if (!enabled || target === 'free') return freePlacement(base, descriptor);
  if (target === 'surface') {
    return surfacePlacement(rayInfo, descriptor) || gridPlacement(base, descriptor, { fallbackFrom: 'surface' });
  }
  if (target === 'object') {
    return objectPlacement(clientX, clientY, rayInfo, descriptor) || gridPlacement(base, descriptor, { fallbackFrom: 'object' });
  }
  if (target === 'socket') {
    return socketPlacement(clientX, clientY, rayInfo, descriptor, base) || gridPlacement(base, descriptor, { fallbackFrom: 'socket' });
  }
  return gridPlacement(base, descriptor);
}

function normalizePlacementInput(source, input) {
  if (input?.__resolvedPlacement) return input;
  const descriptor = placementDescriptor(source);
  const value = vector(input);
  const point = new THREE.Vector3(value.x, value.y, value.z);
  return resolvedPlacement(point.add(descriptor.legacyOffset), { snappedTo: 'direct' });
}

function viewportPoint(clientX, clientY) {
  return resolvePlacement(clientX, clientY).position;
}

function viewportCenterPlacement(source) {
  const rect = $('#viewport').getBoundingClientRect();
  return resolvePlacement(rect.left + rect.width / 2, rect.top + rect.height / 2, source);
}

function selectItem(id, { additive = false } = {}) {
  const target = findRecord(id);
  if (target?.category === 'socket' && (state.connectionTool || state.connectionFrom)) {
    if (!state.connectionFrom) {
      beginConnectionFromSocket(target);
      return;
    }
    if (sameEndpoint(state.connectionFrom, endpointForSocket(target.owner, target.record))) {
      state.connectionFrom = null;
      state.connectionDraft = { kind: connectionIntentKind(), bidirectional: state.connectionDraft?.bidirectional !== false };
      toast('Choose a new source', 'The connection tool remains active.', 'warning');
      rebuildEditor();
      return;
    }
    finishConnection(target.owner.id, id, {
      kind: connectionIntentKind(),
      bidirectional: state.connectionDraft?.bidirectional !== false,
    });
    return;
  }
  const validId = id && findRecord(id) ? id : null;
  if (!additive) {
    state.selectedIds = validId ? [validId] : [];
  } else if (validId) {
    const selected = new Set(validSelectedIds());
    if (selected.has(validId)) selected.delete(validId);
    else selected.add(validId);
    state.selectedIds = [...selected];
  }
  state.selectedId = validId && state.selectedIds.includes(validId)
    ? validId
    : state.selectedIds.at(-1) || null;
  renderOutliner();
  renderInspector();
  if (state.mode === 'dungeon' && (state.connectionTool || state.connectionFrom || selectedConnectionRooms().length === 2)) rebuildScene();
  else updateSelectionVisual();
  refreshStatus();
}

function updateSelectionVisual() {
  if (!sceneState.selectionBox) return;
  const ids = validSelectedIds();
  const visuals = ids.map((id) => sceneState.visuals.get(id)).filter(Boolean);
  const descriptor = findRecord(state.selectedId);
  if (!visuals.length) {
    sceneState.selectionBox.visible = false;
    sceneState.transform.detach();
    $('#selection-label').hidden = true;
    return;
  }
  sceneState.selectionBox.box.makeEmpty();
  visuals.forEach((visual) => sceneState.selectionBox.box.expandByObject(visual));
  sceneState.selectionBox.updateMatrixWorld(true);
  sceneState.selectionBox.visible = true;
  const transformable = ids.every((id) => ['room', 'entity', 'primitive', 'socket'].includes(findRecord(id)?.category));
  if (transformable && state.tool !== 'select') {
    if (visuals.length === 1) {
      sceneState.transform.attach(visuals[0]);
    } else {
      const center = sceneState.selectionBox.box.getCenter(new THREE.Vector3());
      sceneState.selectionPivot.position.copy(center);
      sceneState.selectionPivot.rotation.set(0, state.transformSpace === 'local' ? visuals.at(-1).rotation.y : 0, 0);
      sceneState.selectionPivot.scale.set(1, 1, 1);
      sceneState.selectionPivot.updateMatrixWorld(true);
      sceneState.transform.attach(sceneState.selectionPivot);
    }
    sceneState.transform.setSpace(state.transformSpace);
    sceneState.transform.visible = true;
  } else {
    sceneState.transform.detach();
    sceneState.transform.visible = false;
  }
}

function syncRecordTransformFromVisual(id) {
  const descriptor = findRecord(id);
  const object = sceneState.visuals.get(id);
  if (!descriptor || !object || !['room', 'entity', 'primitive', 'socket'].includes(descriptor.category)) return;
  if (descriptor.category === 'room') {
    const transform = ensureTransform(descriptor.record);
    transform.position = { x: object.position.x, y: object.position.y, z: object.position.z };
    transform.rotationY = object.rotation.y;
    transform.scale = { x: object.scale.x, y: object.scale.y, z: object.scale.z };
  } else if (descriptor.category === 'socket') {
    let localPosition;
    let localRotationY;
    if (state.mode === 'dungeon') {
      const ownerPosition = vector(descriptor.owner.transform?.position);
      const roomRotation = Number(descriptor.owner.transform?.rotationY) || 0;
      const local = object.position.clone().sub(new THREE.Vector3(ownerPosition.x, ownerPosition.y, ownerPosition.z)).applyAxisAngle(new THREE.Vector3(0, 1, 0), -roomRotation);
      localPosition = { x: local.x, y: local.y, z: local.z };
      localRotationY = object.rotation.y - roomRotation;
    } else {
      localPosition = { x: object.position.x, y: object.position.y, z: object.position.z };
      localRotationY = object.rotation.y;
    }
    descriptor.record.position = localPosition;
    descriptor.record.facing = { x: Math.sin(localRotationY), y: 0, z: Math.cos(localRotationY) };
    descriptor.record.transform = { position: clone(localPosition), rotationY: localRotationY, scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z } };
  } else {
    const transform = ensureTransform(descriptor.record);
    transform.position = { x: object.position.x, y: object.position.y, z: object.position.z };
    transform.rotationY = object.rotation.y;
    transform.scale = { x: object.scale.x, y: object.scale.y, z: object.scale.z };
  }
  state.dirty = true;
}

function beginTransformChange() {
  state.transformSnapshot = snapshot();
  const ids = validSelectedIds();
  if (ids.length < 2 || sceneState.transform.object !== sceneState.selectionPivot) {
    state.multiTransformStart = null;
    return;
  }
  sceneState.selectionPivot.updateMatrixWorld(true);
  state.multiTransformStart = {
    pivot: sceneState.selectionPivot.matrixWorld.clone(),
    objects: ids.map((id) => {
      const object = sceneState.visuals.get(id);
      object?.updateMatrixWorld(true);
      return object ? { id, matrix: object.matrixWorld.clone() } : null;
    }).filter(Boolean),
  };
}

function syncSelectionTransformFromVisuals() {
  const multi = state.multiTransformStart;
  if (!multi) {
    syncRecordTransformFromVisual(state.selectedId);
    return;
  }
  sceneState.selectionPivot.updateMatrixWorld(true);
  const delta = sceneState.selectionPivot.matrixWorld.clone().multiply(multi.pivot.clone().invert());
  for (const entry of multi.objects) {
    const object = sceneState.visuals.get(entry.id);
    if (!object) continue;
    const world = delta.clone().multiply(entry.matrix);
    const local = object.parent
      ? object.parent.matrixWorld.clone().invert().multiply(world)
      : world;
    local.decompose(object.position, object.quaternion, object.scale);
    object.updateMatrixWorld(true);
    syncRecordTransformFromVisual(entry.id);
  }
}

function finishTransformChange() {
  if (!state.transformSnapshot || state.transformSnapshot === snapshot()) {
    state.transformSnapshot = null;
    state.multiTransformStart = null;
    return;
  }
  pushUndo(state.transformSnapshot);
  state.redo.length = 0;
  state.transformSnapshot = null;
  state.multiTransformStart = null;
  markDirty('Transform changed');
  renderInspector();
  renderOutliner();
  if (state.mode === 'dungeon' || validSelectedIds().length > 1) rebuildScene();
}

function updateSelectionLabel() {
  const label = $('#selection-label');
  const ids = validSelectedIds();
  const visual = sceneState.visuals.get(state.selectedId);
  const descriptor = findRecord(state.selectedId);
  if (!visual || !descriptor || state.playing) { label.hidden = true; return; }
  const box = new THREE.Box3();
  ids.map((id) => sceneState.visuals.get(id)).filter(Boolean).forEach((object) => box.expandByObject(object));
  const point = box.getCenter(new THREE.Vector3());
  point.y = box.max.y + 0.25;
  point.project(sceneState.camera);
  const rect = $('#viewport').getBoundingClientRect();
  label.style.left = `${(point.x * 0.5 + 0.5) * rect.width}px`;
  label.style.top = `${(-point.y * 0.5 + 0.5) * rect.height}px`;
  label.textContent = ids.length > 1
    ? `${ids.length} objects selected`
    : descriptor.record.name || prettyType(descriptor.record.type || descriptor.category);
  label.hidden = point.z > 1;
}

function setTool(tool) {
  if (!['select', 'translate', 'rotate', 'scale'].includes(tool)) return;
  state.tool = tool;
  $$('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
  if (tool !== 'select') sceneState.transform?.setMode(tool);
  updateSelectionVisual();
}

function toggleTransformSpace() {
  state.transformSpace = state.transformSpace === 'local' ? 'world' : 'local';
  $('#transform-space').textContent = prettyType(state.transformSpace);
  sceneState.transform?.setSpace(state.transformSpace);
  updateSelectionVisual();
}

function saveSnapPreferences() {
  try {
    localStorage.setItem(SNAP_PREFERENCES_KEY, JSON.stringify({
      enabled: state.snap,
      target: state.snapTarget,
      increment: state.snapValue,
    }));
  } catch { /* device-local preference only */ }
}

function updateSnapControls() {
  const toggle = $('[data-action="toggle-snap"]');
  const selector = $('#placement-snap-target');
  const increment = $('[data-action="snap-menu"]');
  const activeTarget = state.snap ? state.snapTarget : 'free';
  if (selector) selector.value = activeTarget;
  toggle?.classList.toggle('active', state.snap);
  toggle?.setAttribute('aria-pressed', String(state.snap));
  if (toggle) {
    toggle.title = state.snap ? `Placement snapping: ${prettyType(state.snapTarget)}` : 'Placement snapping is off';
    toggle.setAttribute('aria-label', state.snap ? `Disable ${state.snapTarget} placement snapping` : 'Enable placement snapping');
  }
  selector?.closest('.snap-to-control')?.classList.toggle('disabled', !state.snap);
  if (increment) increment.disabled = !state.snap || state.snapTarget !== 'grid';
  $('#snap-value').textContent = state.snapValue;
  const label = state.snap ? prettyType(state.snapTarget) : 'Free';
  $('#drop-target-title').textContent = state.snap ? `Snap to ${label.toLowerCase()}` : 'Place freely';
  $('#drop-target-detail').textContent = state.snap && state.snapTarget === 'grid'
    ? `Release to create · ${state.snapValue} m`
    : state.snap && state.snapTarget === 'socket'
      ? 'Release near an available socket'
      : state.snap && state.snapTarget === 'object'
        ? 'Release near a face or corner'
        : state.snap && state.snapTarget === 'surface'
          ? 'Release over authored geometry'
          : 'Release to create without rounding';
  sceneState.transform?.setTranslationSnap(state.snap && state.snapTarget === 'grid' ? state.snapValue : null);
}

function setSnapTarget(target, { notify = false } = {}) {
  if (!SNAP_TARGETS.has(target)) return false;
  if (target === 'free') {
    state.snap = false;
  } else {
    state.snap = true;
    state.snapTarget = target;
    state.lastSnapTarget = target;
  }
  if (target === 'free') state.snapTarget = 'free';
  updateSnapControls();
  saveSnapPreferences();
  if (notify) toast('Placement snapping changed', target === 'free' ? 'New pieces will be placed freely.' : `New pieces will snap to ${target}.`);
  return true;
}

function toggleSnap() {
  if (state.snap) {
    state.lastSnapTarget = state.snapTarget === 'free' ? state.lastSnapTarget : state.snapTarget;
    state.snap = false;
  } else {
    state.snapTarget = state.snapTarget === 'free' ? state.lastSnapTarget || 'grid' : state.snapTarget;
    state.snap = true;
  }
  updateSnapControls();
  saveSnapPreferences();
}

function cycleSnapIncrement() {
  const index = SNAP_INCREMENTS.indexOf(state.snapValue);
  state.snapValue = SNAP_INCREMENTS[(index + 1) % SNAP_INCREMENTS.length];
  updateSnapControls();
  saveSnapPreferences();
}

function frameObject(object, padding = 1.7) {
  if (!object || !sceneState.camera) return;
  frameBox(new THREE.Box3().setFromObject(object), padding);
}

function frameBox(box, padding = 1.7) {
  if (!sceneState.camera) return;
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() * 0.5, 1);
  const direction = sceneState.camera.position.clone().sub(sceneState.controls.target).normalize();
  sceneState.controls.target.copy(center);
  sceneState.camera.position.copy(center).add(direction.multiplyScalar(radius * padding + 2));
  sceneState.controls.update();
}

function frameSelection() {
  const box = new THREE.Box3();
  validSelectedIds().map((id) => sceneState.visuals.get(id)).filter(Boolean).forEach((visual) => box.expandByObject(visual));
  if (!box.isEmpty()) frameBox(box, 2.1);
  else frameAll();
}

function frameAll() {
  if (sceneState.content?.children.length) frameObject(sceneState.content, 1.55);
  else {
    sceneState.camera?.position.set(10, 8, 10);
    sceneState.controls?.target.set(0, 0, 0);
  }
}

function treeRow(id, name, icon, meta = '', group = false, className = '') {
  return `<div class="tree-row${validSelectedIds().includes(id) ? ' selected' : ''}${group ? ' group-label' : ''}${className ? ` ${className}` : ''}" role="treeitem" data-tree-id="${escapeHTML(id)}"><span></span><span class="tree-icon">${ICONS[icon] || ICONS.model}</span><span class="tree-name">${escapeHTML(name)}</span><span class="tree-meta">${escapeHTML(meta)}</span></div>`;
}

function treeGroup(label, icon, entries, groupId) {
  return `<div class="tree-group" data-tree-group="${groupId}"><div class="tree-row group-label"><button class="tree-chevron" aria-label="Collapse ${escapeHTML(label)}"><svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg></button><span class="tree-icon">${ICONS[icon] || ICONS.room}</span><span class="tree-name">${escapeHTML(label)}</span><span class="tree-meta">${entries.length}</span></div><div class="tree-children">${entries.join('')}</div></div>`;
}

function renderOutliner() {
  const target = $('#outliner-tree');
  const search = $('#outliner-search').value.trim().toLowerCase();
  const matches = (record) => !search || `${record.name || ''} ${record.type || ''} ${record.id || ''}`.toLowerCase().includes(search);
  let groups;
  if (state.mode === 'room') {
    const room = getActiveRoom();
    const entities = state.project.entities.filter((entity) => (entity.roomId === room?.id || (!entity.roomId && state.project.rooms.length === 1)) && matches(entity));
    const structure = roomPrimitives(room).filter(matches).map((primitive) => treeRow(primitive.id, primitive.name || prettyType(primitive.type), primitive.type === 'gltf-model' ? 'model' : primitive.type, 'Primitive'));
    const gameplay = entities.map((entity) => treeRow(entity.id, entity.name || prettyType(entity.type), entity.type === 'point-light' ? 'light' : entity.type, prettyType(entity.kind)));
    const sockets = roomSockets(room).filter(matches).map((socket) => treeRow(socket.id, socket.name || prettyType(socket.type), socket.type === 'lift' ? 'lift' : socket.type === 'tunnel' ? 'tunnel' : 'socket', prettyType(socket.type)));
    groups = [treeGroup('Structure', 'room', structure, 'structure'), treeGroup('Gameplay', 'objective', gameplay, 'gameplay'), treeGroup('Sockets', 'connection', sockets, 'sockets')];
  } else {
    const rooms = state.project.rooms.filter(matches).map((room) => treeRow(room.id, room.name || room.moduleId || 'Room', 'room', `${roomSockets(room).length} sockets`));
    const connections = state.project.connections.filter(matches).map((connection) => treeRow(connection.id, connection.name || prettyType(connection.kind || 'connection'), 'connection', connection.bidirectional === false ? '1-way' : '2-way'));
    const markers = state.project.entities.filter((entity) => !entity.roomId && matches(entity)).map((entity) => treeRow(entity.id, entity.name || prettyType(entity.type), entity.type, prettyType(entity.kind)));
    groups = [treeGroup('Rooms', 'room', rooms, 'rooms'), treeGroup('Connections', 'connection', connections, 'connections'), treeGroup('Dungeon markers', 'objective', markers, 'markers')];
    if (state.connectionTool || state.connectionFrom) {
      const eligibleSockets = state.project.rooms.flatMap((room) => roomSockets(room)
        .filter((socket) => connectionSocketPriority(room, socket) >= 2)
        .map((socket) => treeRow(socket.id, `${room.name || room.id} / ${socket.name || prettyType(socket.type)}`, socket.type === 'lift' ? 'lift' : socket.type === 'tunnel' ? 'tunnel' : 'socket', prettyType(socket.type), false, 'connection-target')));
      groups.push(treeGroup('Eligible sockets', 'connection', eligibleSockets, 'eligible-sockets'));
    }
  }
  target.innerHTML = groups.join('');
  target.querySelectorAll('[data-tree-id]').forEach((row) => {
    row.addEventListener('click', (event) => selectItem(row.dataset.treeId, { additive: event.shiftKey || event.ctrlKey || event.metaKey }));
    row.addEventListener('dblclick', () => frameSelection());
  });
  target.querySelectorAll('.tree-chevron').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    button.closest('.tree-group').classList.toggle('collapsed');
  }));
}

function vectorInputs(path, value, step = 0.1) {
  const normalized = vector(value);
  return `<div class="vector-input">${['x', 'y', 'z'].map((axis) => `<label class="axis-input"><span>${axis.toUpperCase()}</span><input class="property-input" type="number" step="${step}" value="${Number(normalized[axis].toFixed(3))}" data-vector="${path}" data-axis="${axis}" /></label>`).join('')}</div>`;
}

function propertySection(title, body, id) {
  return `<section class="property-section" data-property-section="${id}"><button type="button"><span>${escapeHTML(title)}</span><svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg></button><div class="property-body">${body}</div></section>`;
}

function materialDefinitions(module) {
  if (!module) return [];
  if (Array.isArray(module.materials)) return module.materials;
  if (module.materials && typeof module.materials === 'object') {
    module.materials = Object.entries(module.materials).map(([id, definition]) => ({ id, ...definition }));
    return module.materials;
  }
  module.materials = [];
  return module.materials;
}

function ensurePrimitiveMaterial(descriptor, asset = null) {
  if (descriptor?.category !== 'primitive') return null;
  const definitions = materialDefinitions(descriptor.module);
  const materialId = descriptor.record.materialId && descriptor.record.materialId !== 'default'
    ? descriptor.record.materialId
    : `material-${descriptor.record.id}`;
  let definition = definitions.find((candidate) => candidate.id === materialId);
  if (!definition) {
    definition = { id: materialId, name: `${descriptor.record.name || prettyType(descriptor.record.type)} Material`, color: '#ffffff', roughness: 0.82, metalness: 0.08, emissive: '#000000', emissiveIntensity: 0 };
    definitions.push(definition);
  }
  descriptor.record.materialId = materialId;
  if (asset) {
    definition.baseColorMap = { id: asset.hash, repeat: definition.baseColorMap?.repeat || { x: 1, y: 1 }, wrap: 'repeat' };
    descriptor.record.properties ||= {};
    descriptor.record.properties.textureAssetId = asset.id;
  }
  return definition;
}

function applyTextureAsset(descriptor, assetId) {
  descriptor.record.properties ||= {};
  descriptor.record.properties.textureAssetId = assetId || '';
  if (descriptor.category === 'primitive') {
    const asset = state.project.assets.find((candidate) => candidate.id === assetId);
    const material = ensurePrimitiveMaterial(descriptor, asset || null);
    if (!asset && material) delete material.baseColorMap;
    touchTopology(descriptor);
  }
}

function connectionFailureReason(fromRoom, toRoom, kind, sourceSocket = null) {
  if (!fromRoom || !toRoom) return 'Select two different rooms to see eligible socket pairs.';
  const reasons = new Map();
  const fromSockets = sourceSocket ? [sourceSocket] : roomSockets(fromRoom);
  if (!fromSockets.length || !roomSockets(toRoom).length) return 'Both selected rooms need at least one socket.';
  for (const fromSocket of fromSockets) {
    for (const toSocket of roomSockets(toRoom)) {
      const reason = socketPairEligibility(fromRoom, fromSocket, toRoom, toSocket, kind).reason;
      if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }
  return [...reasons.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0]
    ?? 'No unused compatible socket pair is currently available.';
}

function connectionPanelModel() {
  const selectedRooms = selectedConnectionRooms();
  const source = resolveSocketEndpoint(state.connectionFrom);
  const active = Boolean(state.connectionTool || source || selectedRooms.length === 2);
  if (!active) return { active: false };

  const kind = normalizeConnectionKind(
    state.connectionDraft?.kind
      ?? state.connectionTool
      ?? (source ? inferredConnectionKind(source.socket) : 'door'),
    'door',
  );
  let fromRoom = source?.room ?? selectedRooms[0] ?? null;
  let toRoom = null;
  let pairs = [];
  let contextKey = source ? `source:${endpointKey(state.connectionFrom)}` : '';
  let canSwap = false;

  if (source) {
    const selectedDestination = selectedRooms.find((room) => room.id !== source.room.id);
    const destinationRooms = selectedDestination ? [selectedDestination] : null;
    pairs = allEligibleTargetsForSource(state.connectionFrom, kind, destinationRooms);
    toRoom = pairs.find((candidate) => (
      candidate.toRoom.id === state.connectionDraft?.toRoomId
      && candidate.toSocket.id === state.connectionDraft?.toSocketId
    ))?.toRoom ?? pairs[0]?.toRoom ?? selectedDestination ?? null;
    contextKey += selectedDestination ? `:${selectedDestination.id}` : ':any';
  } else if (selectedRooms.length === 2) {
    const unorderedKey = selectedRooms.map((room) => room.id).sort().join('|');
    contextKey = `rooms:${unorderedKey}`;
    if (state.connectionDraft?.contextKey === contextKey && state.connectionDraft.fromRoomId === selectedRooms[1].id) {
      [fromRoom, toRoom] = [selectedRooms[1], selectedRooms[0]];
    } else {
      [fromRoom, toRoom] = selectedRooms;
    }
    pairs = eligibleConnectionPairs(fromRoom, toRoom, kind);
    canSwap = true;
  }

  const previousPair = pairs.find((candidate) => (
    candidate.fromRoom.id === state.connectionDraft?.fromRoomId
    && candidate.fromSocket.id === state.connectionDraft?.fromSocketId
    && candidate.toRoom.id === state.connectionDraft?.toRoomId
    && candidate.toSocket.id === state.connectionDraft?.toSocketId
  ));
  const selectedPair = previousPair ?? pairs[0] ?? null;
  if (selectedPair) {
    fromRoom = selectedPair.fromRoom;
    toRoom = selectedPair.toRoom;
  }
  state.connectionDraft = {
    ...(state.connectionDraft ?? {}),
    contextKey,
    kind,
    bidirectional: state.connectionDraft?.bidirectional !== false,
    fromRoomId: selectedPair?.fromRoom.id ?? fromRoom?.id ?? null,
    fromSocketId: selectedPair?.fromSocket.id ?? source?.socket.id ?? null,
    toRoomId: selectedPair?.toRoom.id ?? toRoom?.id ?? null,
    toSocketId: selectedPair?.toSocket.id ?? null,
  };

  const model = {
    active: true,
    kind,
    source,
    selectedRooms,
    fromRoom,
    toRoom,
    pairs,
    selectedPair,
    canSwap,
    contextKey,
    reason: state.connectionDraft?.notice || (pairs.length
      ? `${pairs.length} eligible socket pair${pairs.length === 1 ? '' : 's'} · closest route ${pairs[0].distance.toFixed(1)} m`
      : source && !toRoom
        ? 'Click a highlighted destination socket or Shift-select its room.'
        : connectionFailureReason(fromRoom, toRoom, kind, source?.socket)),
  };
  model.alignment = connectionAlignmentForModel(model);
  if (!state.connectionDraft?.notice && !model.pairs.length && model.alignment?.canAlign) {
    model.reason = 'Alignment needed. Both room transforms will be adjusted automatically.';
  }
  return model;
}

function alignConnectionToConnectorGrid(proposal) {
  if (!proposal?.canAlign) return false;
  const selectedIds = [...validSelectedIds()];
  const selectedId = state.selectedId;
  state.connectionDraft = {
    ...(state.connectionDraft ?? {}),
    kind: proposal.kind,
    fromRoomId: proposal.fromRoom.id,
    fromSocketId: proposal.fromSocket.id,
    toRoomId: proposal.toRoom.id,
    toSocketId: proposal.toSocket.id,
    notice: 'Both rooms aligned. Review the socket pair, then create the connection.',
  };
  const changed = commit('Aligned rooms to connector grid', () => {
    const sourceTransform = ensureTransform(proposal.fromRoom);
    sourceTransform.position = clone(proposal.sourceTargetPosition);
    sourceTransform.rotationY = proposal.sourceTargetRotationY;
    const destinationTransform = ensureTransform(proposal.toRoom);
    destinationTransform.position = clone(proposal.targetPosition);
    destinationTransform.rotationY = proposal.targetRotationY;
  }, { select: selectedId, selection: selectedIds });
  if (!changed) {
    delete state.connectionDraft.notice;
    renderConnectionInterface();
    return false;
  }
  toast('Rooms aligned', `${proposal.fromRoom.name || 'Source room'} and ${proposal.toRoom.name || 'destination room'} now share a valid ${proposal.kind} connector axis and buffer.`);
  setTimeout(() => {
    const interfaceElement = $('#connection-interface');
    const createButton = $('[data-connection-action="create"]', interfaceElement);
    if (createButton && !createButton.disabled) createButton.focus();
    else {
      const status = $('.connection-status', interfaceElement);
      status?.setAttribute('tabindex', '-1');
      status?.focus();
    }
  }, 0);
  return true;
}

function renderConnectionInterface() {
  const target = $('#connection-interface');
  if (!target) return;
  const model = connectionPanelModel();
  target.hidden = !model.active;
  if (!model.active) {
    target.replaceChildren();
    return;
  }

  const pairIndex = Math.max(0, model.pairs.indexOf(model.selectedPair));
  const pairOptions = model.pairs.map((candidate, index) => (
    `<option value="${index}" ${index === pairIndex ? 'selected' : ''}>${escapeHTML(candidate.fromSocket.name || prettyType(candidate.fromSocket.type))} → ${escapeHTML(candidate.toRoom.name || candidate.toRoom.id)} / ${escapeHTML(candidate.toSocket.name || prettyType(candidate.toSocket.type))} · ${candidate.distance.toFixed(1)} m</option>`
  )).join('');
  const fromName = model.fromRoom?.name || model.fromRoom?.id || 'Choose source';
  const toName = model.toRoom?.name || model.toRoom?.id || 'Choose destination';
  const fromSocketName = model.selectedPair?.fromSocket.name || model.source?.socket.name || 'Click highlighted socket';
  const toSocketName = model.selectedPair?.toSocket.name || 'No eligible socket selected';
  const contextLabel = model.selectedRooms.length === 2 ? 'Two areas selected' : model.source ? 'Source socket selected' : `${prettyType(model.kind)} link tool`;

  target.innerHTML = `
    <div class="connection-interface__header">
      <div class="connection-interface__title"><strong>Connection setup</strong><small>${escapeHTML(contextLabel)}</small></div>
      <button type="button" class="connection-interface__close" data-connection-action="close" aria-label="Close connection setup">×</button>
    </div>
    <div class="connection-nodes">
      <div class="connection-node from"><span class="connection-node__name">${escapeHTML(fromName)}</span><span class="connection-node__socket">${escapeHTML(fromSocketName)}</span></div>
      <button type="button" class="connection-swap" data-connection-action="swap" title="Swap direction" aria-label="Swap connection direction" ${model.canSwap ? '' : 'disabled'}>⇄</button>
      <div class="connection-node to"><span class="connection-node__name">${escapeHTML(toName)}</span><span class="connection-node__socket">${escapeHTML(toSocketName)}</span></div>
    </div>
    <div class="connection-form">
      <div class="connection-form-row"><label for="connection-kind">Link type</label><select id="connection-kind"><option value="door" ${model.kind === 'door' ? 'selected' : ''}>Door</option><option value="corridor" ${model.kind === 'corridor' ? 'selected' : ''}>Corridor</option><option value="lift" ${model.kind === 'lift' ? 'selected' : ''}>Lift</option></select></div>
      <div class="connection-form-row"><label for="connection-pair-select">Socket pair</label><select id="connection-pair-select" ${model.pairs.length ? '' : 'disabled'}>${pairOptions || '<option>No eligible pairs</option>'}</select></div>
      <label class="check-control"><span>Bidirectional</span><input id="connection-bidirectional" type="checkbox" ${state.connectionDraft.bidirectional !== false ? 'checked' : ''}/></label>
    </div>
    <div class="connection-status ${model.pairs.length ? 'ok' : 'warning'}" role="status" aria-live="polite" aria-atomic="true">${escapeHTML(model.reason)}</div>
    <div class="connection-align-block"><button type="button" class="connection-cancel connection-align" data-connection-action="align" aria-controls="viewport" aria-describedby="connection-align-help" ${model.alignment?.canAlign ? '' : 'disabled'}>Align both rooms to Connection Grid</button><p id="connection-align-help" class="connection-align-help">${escapeHTML(model.alignment?.canAlign ? 'Snaps and quarter-turns both room transforms as needed, then places the sockets on a valid connector axis, elevation, and endpoint buffer. One undo restores both rooms.' : model.alignment?.reason || 'Shift-select a second room to align both endpoints.')}</p></div>
    <div class="connection-actions"><button type="button" class="connection-primary" data-connection-action="create" ${model.selectedPair ? '' : 'disabled'}>Create connection</button><button type="button" class="connection-cancel" data-connection-action="cancel">Cancel</button></div>
  `;

  $('#connection-kind', target)?.addEventListener('change', (event) => {
    const kind = normalizeConnectionKind(event.target.value);
    state.connectionDraft = { ...(state.connectionDraft ?? {}), kind, fromSocketId: null, toSocketId: null, notice: null };
    if (state.connectionTool) state.connectionTool = kind;
    const resolvedSource = resolveSocketEndpoint(state.connectionFrom);
    if (resolvedSource && !socketSupportsConnectionKind(resolvedSource.socket, kind)) state.connectionFrom = null;
    renderPalette();
    rebuildScene();
    renderConnectionInterface();
  });
  $('#connection-pair-select', target)?.addEventListener('change', (event) => {
    const candidate = model.pairs[Number(event.target.value)];
    if (!candidate) return;
    Object.assign(state.connectionDraft, {
      fromRoomId: candidate.fromRoom.id,
      fromSocketId: candidate.fromSocket.id,
      toRoomId: candidate.toRoom.id,
      toSocketId: candidate.toSocket.id,
      notice: null,
    });
    rebuildScene();
    renderConnectionInterface();
  });
  $('#connection-bidirectional', target)?.addEventListener('change', (event) => {
    state.connectionDraft.bidirectional = event.target.checked;
  });
  $('[data-connection-action="swap"]', target)?.addEventListener('click', () => {
    if (!model.canSwap || !model.fromRoom || !model.toRoom) return;
    Object.assign(state.connectionDraft, {
      fromRoomId: model.toRoom.id,
      fromSocketId: null,
      toRoomId: model.fromRoom.id,
      toSocketId: null,
      notice: null,
    });
    rebuildScene();
    renderConnectionInterface();
  });
  $('[data-connection-action="align"]', target)?.addEventListener('click', () => {
    const current = connectionPanelModel();
    alignConnectionToConnectorGrid(current.alignment);
  });
  $('[data-connection-action="create"]', target)?.addEventListener('click', () => {
    const current = connectionPanelModel();
    if (current.selectedPair) createSocketConnection(current.selectedPair, { bidirectional: state.connectionDraft?.bidirectional !== false });
  });
  $$('[data-connection-action="close"], [data-connection-action="cancel"]', target).forEach((button) => button.addEventListener('click', () => {
    resetConnectionWorkflow();
    renderPalette();
    rebuildEditor();
  }));
}

function renderInspector() {
  const target = $('#inspector-content');
  const selectedIds = validSelectedIds();
  const descriptor = findRecord(state.selectedId);
  renderConnectionInterface();
  $('#selection-actions').hidden = !descriptor || descriptor.category === 'asset';
  if (!descriptor) {
    target.innerHTML = '<div class="inspector-empty"><div class="inspector-empty-icon">' + ICONS.spawn + '</div><strong>Nothing selected</strong><p>Select an object in the viewport or outliner to edit its properties.</p></div>';
    return;
  }
  if (selectedIds.length > 1) {
    const connectionRooms = selectedConnectionRooms();
    const transformableCount = selectedIds.filter((id) => ['room', 'entity', 'primitive', 'socket'].includes(findRecord(id)?.category)).length;
    target.innerHTML = `<div class="inspector-empty"><div class="inspector-empty-icon">${connectionRooms.length === 2 ? ICONS.connection : ICONS.model}</div><strong>${connectionRooms.length === 2 ? '2 connectable areas selected' : `${selectedIds.length} objects selected`}</strong><p>${connectionRooms.length === 2 ? 'Choose an eligible socket pair in Connection setup below.' : transformableCount === selectedIds.length ? 'Use the move, rotate, or scale gizmo to transform the selection as a group.' : 'The selection contains non-transformable records. Duplicate or delete them as a batch.'}</p><p><kbd>Shift</kbd> + click toggles objects in the selection.</p></div>`;
    return;
  }
  const { record, category } = descriptor;
  if (category === 'socket' && !record.transform) {
    const facing = vector(record.facing, { x: 0, y: 0, z: 1 });
    record.transform = { position: vector(record.position), rotationY: Math.atan2(facing.x, facing.z), scale: { x: 1, y: 1, z: 1 } };
  }
  const transform = category === 'connection' ? null : ensureTransform(record);
  const name = record.name || record.moduleId || prettyType(record.type || category);
  const icon = category === 'room' ? 'room' : category === 'socket' ? (record.type === 'lift' ? 'lift' : record.type === 'tunnel' ? 'tunnel' : 'socket') : category === 'connection' ? 'connection' : record.type;
  let html = `<div class="selection-header"><span class="selection-kind-icon">${ICONS[icon] || ICONS.model}</span><label class="selection-title"><input id="selection-name" value="${escapeHTML(name)}" maxlength="80"/><span>${escapeHTML(category)} · ${escapeHTML(record.type || record.kind || record.moduleId || 'object')}</span></label></div>`;
  if (transform) {
    const rotationDegrees = THREE.MathUtils.radToDeg(transform.rotationY);
    html += propertySection('TRANSFORM', `<div class="property-row"><label>Position</label>${vectorInputs('transform.position', transform.position)}</div><div class="property-row"><label>Rotation Y</label><input class="property-input" type="number" step="1" value="${Number(rotationDegrees.toFixed(2))}" data-rotation-y /></div><div class="property-row"><label>Scale</label>${vectorInputs('transform.scale', transform.scale)}</div>`, 'transform');
  }
  if (category === 'room') {
    const dimensions = record.dimensions || { width: 10, height: 4, depth: 10 };
    html += propertySection('ROOM MODULE', `<div class="property-row"><label>Module ID</label><input class="property-input" data-prop="moduleId" value="${escapeHTML(record.moduleId || '')}"/></div><div class="property-row"><label>Width</label><input class="property-input" type="number" min="1" step="0.5" data-prop="dimensions.width" value="${Number(dimensions.width) || 10}"/></div><div class="property-row"><label>Height</label><input class="property-input" type="number" min="1" step="0.5" data-prop="dimensions.height" value="${Number(dimensions.height) || 4}"/></div><div class="property-row"><label>Depth</label><input class="property-input" type="number" min="1" step="0.5" data-prop="dimensions.depth" value="${Number(dimensions.depth) || 10}"/></div><label class="check-control"><span>Runtime enabled</span><input type="checkbox" data-check="properties.enabled" ${record.properties?.enabled !== false ? 'checked' : ''}/></label>`, 'room');
  } else if (category === 'entity' || category === 'primitive') {
    const isImportedModel = record.kind === 'model' || record.type === 'gltf-model';
    const textureOptions = state.project.assets.filter((asset) => asset.kind === 'texture' || asset.type === 'texture').map((asset) => `<option value="${escapeHTML(asset.id)}" ${record.properties?.textureAssetId === asset.id ? 'selected' : ''}>${escapeHTML(asset.name)}</option>`).join('');
    const authoredSize = record.size && typeof record.size === 'object' ? record.size : Array.isArray(record.properties?.size) ? { x: record.properties.size[0], y: record.properties.size[1], z: record.properties.size[2] } : null;
    const textureControl = isImportedModel ? '' : `<div class="property-row"><label>Texture</label><select class="property-select" data-prop="properties.textureAssetId"><option value="">Default material</option>${textureOptions}</select></div>`;
    html += propertySection('COMPONENT', `<div class="property-row"><label>Kind</label><input class="property-input" data-prop="kind" value="${escapeHTML(record.kind || '')}" /></div><div class="property-row"><label>Type</label><input class="property-input" data-prop="type" value="${escapeHTML(record.type || '')}" /></div>${authoredSize ? `<div class="property-row"><label>Base size</label>${vectorInputs(record.size ? 'size' : 'properties.size', authoredSize)}</div>` : ''}${textureControl}<label class="check-control"><span>Enabled</span><input type="checkbox" data-check="${category === 'primitive' ? 'enabled' : 'properties.enabled'}" ${(category === 'primitive' ? record.enabled : record.properties?.enabled) !== false ? 'checked' : ''}/></label><label class="check-control"><span>Collision</span><input type="checkbox" data-check="${category === 'primitive' ? 'collision' : 'properties.collision'}" ${(category === 'primitive' ? record.collision : record.properties?.collision) ? 'checked' : ''}/></label>`, 'component');
    if (category === 'primitive' && !isImportedModel) {
      const pbr = ensurePrimitiveMaterial(descriptor);
      const repeat = pbr.baseColorMap?.repeat || { x: 1, y: 1 };
      const offset = pbr.baseColorMap?.offset || { x: 0, y: 0 };
      const textureAssets = state.project.assets.filter((asset) => asset.kind === 'texture' || asset.type === 'texture');
      const mapSelect = (label, field) => `<div class="property-row"><label>${label}</label><select class="property-select" data-material-map="${field}"><option value="">None</option>${textureAssets.map((asset) => `<option value="${escapeHTML(asset.id)}" ${pbr[field]?.id === asset.hash ? 'selected' : ''}>${escapeHTML(asset.name)}</option>`).join('')}</select></div>`;
      html += propertySection('PBR MATERIAL', `<div class="property-row"><label>Tint</label><input class="property-input" type="color" data-material-prop="color" value="${escapeHTML(pbr.color || '#ffffff')}" /></div><div class="property-row"><label>Roughness</label><input class="property-input" type="number" min="0" max="1" step="0.05" data-material-prop="roughness" value="${Number(pbr.roughness ?? 0.82)}" /></div><div class="property-row"><label>Metalness</label><input class="property-input" type="number" min="0" max="1" step="0.05" data-material-prop="metalness" value="${Number(pbr.metalness ?? 0.08)}" /></div><div class="property-row"><label>Emissive</label><input class="property-input" type="color" data-material-prop="emissive" value="${escapeHTML(pbr.emissive || '#000000')}" /></div><div class="property-row"><label>Emissive power</label><input class="property-input" type="number" min="0" step="0.1" data-material-prop="emissiveIntensity" value="${Number(pbr.emissiveIntensity ?? 0)}" /></div>${mapSelect('Normal map', 'normalMap')}${mapSelect('Roughness map', 'roughnessMap')}${mapSelect('Metalness map', 'metalnessMap')}${mapSelect('Emissive map', 'emissiveMap')}<div class="property-row"><label>Repeat U</label><input class="property-input" type="number" min="0.01" step="0.25" data-material-repeat="x" value="${Number(repeat.x ?? 1)}" /></div><div class="property-row"><label>Repeat V</label><input class="property-input" type="number" min="0.01" step="0.25" data-material-repeat="y" value="${Number(repeat.y ?? 1)}" /></div><div class="property-row"><label>Offset U</label><input class="property-input" type="number" step="0.05" data-material-offset="x" value="${Number(offset.x ?? 0)}" /></div><div class="property-row"><label>Offset V</label><input class="property-input" type="number" step="0.05" data-material-offset="y" value="${Number(offset.y ?? 0)}" /></div><div class="property-row"><label>Rotation</label><input class="property-input" type="number" step="1" data-material-rotation value="${Number(THREE.MathUtils.radToDeg(pbr.baseColorMap?.rotation ?? 0).toFixed(2))}" /></div>`, 'material');
    }
    if (isImportedModel) {
      const overrides = category === 'primitive' ? record.materialOverrides : record.properties?.materialOverrides;
      html += propertySection('IMPORTED MODEL', `<p class="property-help">Embedded materials are preserved unless a slot override is listed. Keys may be material names, mesh names, slot indexes, or <code>default</code>.</p><textarea class="property-textarea" data-model-overrides spellcheck="false" placeholder='{"Metal": "trim"}'>${escapeHTML(JSON.stringify(overrides || {}, null, 2))}</textarea><button type="button" class="text-button ghost" data-action="generate-model-collider">Generate bounding-box collider</button>`, 'model');
    }
    if (['enemy-spawn', 'encounter', 'boss-arena'].includes(record.type)) {
      html += propertySection('ENCOUNTER', `<div class="property-row"><label>Archetype</label><input class="property-input" data-prop="properties.archetypeId" value="${escapeHTML(record.properties?.archetypeId || 'any')}" /></div><div class="property-row"><label>Count</label><input class="property-input" type="number" min="1" max="64" data-prop="properties.count" value="${Number(record.properties?.count) || 1}" /></div>`, 'encounter');
    }
  } else if (category === 'socket') {
    const connected = state.project.connections.filter((connection) => connection.from?.socketId === record.id || connection.to?.socketId === record.id).length;
    html += propertySection('SOCKET', `<div class="property-row"><label>Type</label><select class="property-select" data-prop="type"><option ${record.type === 'door' ? 'selected' : ''}>door</option><option ${record.type === 'lift' ? 'selected' : ''}>lift</option><option ${record.type === 'tunnel' ? 'selected' : ''}>tunnel</option></select></div><div class="property-row"><label>Connections</label><span>${connected}</span></div><div class="socket-workflow ${state.connectionFrom?.socketId === record.id ? 'connecting' : ''}"><p>${state.connectionFrom?.socketId === record.id ? 'Now select a compatible socket in another room.' : 'Create a directed, validated link from this socket to another room socket.'}</p><button type="button" class="text-button" data-action="connect-socket">${state.connectionFrom?.socketId === record.id ? 'Cancel connection' : 'Start connection'}</button></div>`, 'socket');
  } else if (category === 'connection') {
    const from = findSocketEndpoint(record.from);
    const to = findSocketEndpoint(record.to);
    html += propertySection('CONNECTION', `<div class="property-row"><label>From</label><span>${escapeHTML(from?.room.name || record.from?.roomId || 'Missing')}</span></div><div class="property-row"><label>To</label><span>${escapeHTML(to?.room.name || record.to?.roomId || 'Missing')}</span></div><div class="property-row"><label>Kind</label><select class="property-select" data-prop="kind"><option ${record.kind === 'door' ? 'selected' : ''}>door</option><option ${record.kind === 'corridor' ? 'selected' : ''}>corridor</option><option ${record.kind === 'lift' ? 'selected' : ''}>lift</option></select></div><label class="check-control"><span>Bidirectional</span><input type="checkbox" data-check="bidirectional" ${record.bidirectional !== false ? 'checked' : ''}/></label>`, 'connection');
  }
  html += propertySection('METADATA', `<div class="property-row"><label>Stable ID</label><input class="property-input" value="${escapeHTML(record.id)}" readonly /></div><div class="property-row"><label>Notes</label><textarea class="property-textarea" data-prop="properties.notes" placeholder="Authoring notes…">${escapeHTML(record.properties?.notes || '')}</textarea></div>`, 'metadata');
  target.innerHTML = html;
  bindInspectorEvents(descriptor);
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
  const keys = path.split('.');
  let target = object;
  for (const key of keys.slice(0, -1)) target = target[key] ||= {};
  target[keys.at(-1)] = value;
}

function parseFieldValue(input) {
  if (input.type === 'number') return Number(input.value);
  return input.value;
}

function touchTopology(descriptor) {
  if (descriptor?.module) descriptor.module.topologyRevision = Math.max(1, Number(descriptor.module.topologyRevision) || 1) + 1;
}

function bindInspectorEvents(descriptor) {
  $('#selection-name')?.addEventListener('change', (event) => commit('Renamed object', () => { descriptor.record.name = event.target.value.trim() || prettyType(descriptor.record.type || descriptor.category); }));
  $$('.property-section > button', $('#inspector-content')).forEach((button) => button.addEventListener('click', () => button.closest('.property-section').classList.toggle('collapsed')));
  $$('[data-prop]', $('#inspector-content')).forEach((input) => input.addEventListener('change', () => {
    let value = parseFieldValue(input);
    if (descriptor.category === 'connection' && input.dataset.prop === 'kind') {
      value = normalizeConnectionKind(value);
      const from = resolveSocketEndpoint(descriptor.record.from);
      const to = resolveSocketEndpoint(descriptor.record.to);
      const eligibility = from && to
        ? socketPairEligibility(from.room, from.socket, to.room, to.socket, value, {
          ignoreConnectionId: descriptor.record.id,
        })
        : { eligible: false, reason: 'This connection has a missing room or socket endpoint.' };
      if (!eligibility.eligible) {
        input.value = descriptor.record.kind;
        toast('Connection kind unchanged', eligibility.reason, 'warning');
        return;
      }
    }
    commit(`Changed ${input.dataset.prop}`, () => {
      if (input.dataset.prop === 'properties.textureAssetId') applyTextureAsset(descriptor, value);
      else setPath(descriptor.record, input.dataset.prop, value);
      if (descriptor.category === 'room' && input.dataset.prop.startsWith('dimensions.')) {
        const module = getRoomModule(descriptor.record);
        const field = input.dataset.prop.split('.').at(-1);
        const metersField = `${field}Meters`;
        module.dimensions[field] = value;
        module.dimensions[metersField] = value;
        if (field === 'width') module.room.width = value;
        if (field === 'depth') module.room.depth = value;
        if (field === 'height') module.room.ceilingHeight = value;
        module.topologyRevision += 1;
      }
      touchTopology(descriptor);
    });
  }));
  $$('[data-check]', $('#inspector-content')).forEach((input) => input.addEventListener('change', () => commit(`Changed ${input.dataset.check}`, () => { setPath(descriptor.record, input.dataset.check, input.checked); touchTopology(descriptor); })));
  $$('[data-material-prop]', $('#inspector-content')).forEach((input) => input.addEventListener('change', () => commit(`Changed material ${input.dataset.materialProp}`, () => {
    const material = ensurePrimitiveMaterial(descriptor);
    material[input.dataset.materialProp] = input.type === 'number' ? Number(input.value) : input.value;
    touchTopology(descriptor);
  })));
  $$('[data-material-repeat]', $('#inspector-content')).forEach((input) => input.addEventListener('change', () => commit('Changed texture repeat', () => {
    const material = ensurePrimitiveMaterial(descriptor);
    material.baseColorMap ||= { id: state.project.assets.find((asset) => asset.id === descriptor.record.properties?.textureAssetId)?.hash || '', wrap: 'repeat' };
    material.baseColorMap.repeat ||= { x: 1, y: 1 };
    material.baseColorMap.repeat[input.dataset.materialRepeat] = Math.max(0.01, Number(input.value) || 1);
    touchTopology(descriptor);
  })));
  $$('[data-material-map]', $('#inspector-content')).forEach((input) => input.addEventListener('change', () => commit(`Changed ${input.dataset.materialMap}`, () => {
    const material = ensurePrimitiveMaterial(descriptor);
    const asset = state.project.assets.find((candidate) => candidate.id === input.value);
    if (asset) material[input.dataset.materialMap] = { ...(material[input.dataset.materialMap] || {}), id: asset.hash, wrap: 'repeat' };
    else delete material[input.dataset.materialMap];
    touchTopology(descriptor);
  })));
  $$('[data-material-offset]', $('#inspector-content')).forEach((input) => input.addEventListener('change', () => commit('Changed texture offset', () => {
    const material = ensurePrimitiveMaterial(descriptor);
    material.baseColorMap ||= { id: '', wrap: 'repeat' };
    material.baseColorMap.offset ||= { x: 0, y: 0 };
    material.baseColorMap.offset[input.dataset.materialOffset] = Number(input.value) || 0;
    touchTopology(descriptor);
  })));
  $('[data-material-rotation]', $('#inspector-content'))?.addEventListener('change', (event) => commit('Changed texture rotation', () => {
    const material = ensurePrimitiveMaterial(descriptor);
    material.baseColorMap ||= { id: '', wrap: 'repeat' };
    material.baseColorMap.rotation = THREE.MathUtils.degToRad(Number(event.target.value) || 0);
    material.baseColorMap.center ||= { x: 0.5, y: 0.5 };
    touchTopology(descriptor);
  }));
  $('[data-model-overrides]', $('#inspector-content'))?.addEventListener('change', (event) => {
    try {
      const overrides = JSON.parse(event.target.value || '{}');
      if (!overrides || Array.isArray(overrides) || typeof overrides !== 'object') throw new Error('Use a JSON object.');
      commit('Changed model material overrides', () => {
        if (descriptor.category === 'primitive') descriptor.record.materialOverrides = overrides;
        else {
          descriptor.record.properties ||= {};
          descriptor.record.properties.materialOverrides = overrides;
        }
        touchTopology(descriptor);
      });
    } catch (error) {
      toast('Invalid material overrides', error.message, 'error');
      renderInspector();
    }
  });
  $('[data-rotation-y]', $('#inspector-content'))?.addEventListener('change', (event) => {
    const radians = THREE.MathUtils.degToRad(Number(event.target.value) || 0);
    commit('Changed rotation', () => {
      descriptor.record.transform.rotationY = radians;
      if (descriptor.category === 'socket') descriptor.record.facing = { x: Math.sin(radians), y: 0, z: Math.cos(radians) };
      touchTopology(descriptor);
    });
  });
  $$('[data-vector]', $('#inspector-content')).forEach((input) => input.addEventListener('change', () => {
    const axis = input.dataset.axis;
    const value = Number(input.value) || 0;
    const path = input.dataset.vector;
    commit('Changed transform', () => {
      if (path === 'properties.size') {
        const index = { x: 0, y: 1, z: 2 }[axis];
        descriptor.record.properties.size[index] = Math.max(0.01, value);
      } else {
        const current = getPath(descriptor.record, path) || {};
        current[axis] = path.endsWith('scale') ? Math.max(0.01, value) : value;
        setPath(descriptor.record, path, current);
        if (descriptor.category === 'socket' && path === 'transform.position') descriptor.record.position = clone(current);
      }
      touchTopology(descriptor);
    });
  }));
  $('[data-action="connect-socket"]', $('#inspector-content'))?.addEventListener('click', () => toggleSocketConnection(descriptor));
}

function toggleSocketConnection(descriptor) {
  if (descriptor.category !== 'socket') return;
  if (state.connectionFrom?.socketId === descriptor.record.id) {
    resetConnectionWorkflow();
    toast('Connection cancelled', 'No project data changed.', 'warning');
  } else {
    if (state.mode !== 'dungeon') setMode('dungeon');
    state.connectionTool = inferredConnectionKind(descriptor.record);
    beginConnectionFromSocket(descriptor);
    return;
  }
  renderPalette();
  rebuildEditor();
}

function createSocketConnection(candidate, { bidirectional = true } = {}) {
  if (!candidate?.eligible) return false;
  const current = socketPairEligibility(candidate.fromRoom, candidate.fromSocket, candidate.toRoom, candidate.toSocket, candidate.kind);
  if (!current.eligible) {
    toast('Connection is no longer eligible', current.reason, 'warning');
    rebuildEditor();
    return false;
  }
  const waypoints = connectionRouteWaypoints(current);
  const widthMeters = Math.min(
    Number(current.fromSocket.widthMeters ?? current.fromSocket.width ?? 8.4),
    Number(current.toSocket.widthMeters ?? current.toSocket.width ?? 8.4),
  );
  const clearHeightMeters = Math.min(
    Number(current.fromSocket.heightMeters ?? current.fromSocket.height ?? 5.6),
    Number(current.toSocket.heightMeters ?? current.toSocket.height ?? 5.6),
  );
  let createdId;
  commit('Connected sockets', () => {
    createdId = makeId('connection');
    state.project.connections.push({
      id: createdId,
      name: `${current.fromRoom.name || 'Room'} → ${current.toRoom.name || 'Room'}`,
      from: clone(current.from),
      to: clone(current.to),
      kind: current.kind,
      bidirectional: bidirectional !== false,
      properties: {
        widthMeters,
        clearHeightMeters,
        route: { waypoints },
        authoredWith: 'connection-interface',
      },
    });
    resetConnectionWorkflow();
  }, { select: createdId });
  renderPalette();
  toast('Rooms connected', `${prettyType(current.kind)} link created with a validated socket pair.`);
  return true;
}

function finishConnection(roomId, socketId, { kind = connectionIntentKind(), bidirectional = true } = {}) {
  const from = state.connectionFrom;
  if (!from || (from.roomId === roomId && from.socketId === socketId)) return false;
  const source = resolveSocketEndpoint(from);
  const destination = resolveSocketEndpoint({ roomId, socketId });
  const candidate = source && destination
    ? socketPairEligibility(source.room, source.socket, destination.room, destination.socket, kind)
    : { eligible: false, reason: 'The selected endpoint could not be resolved.' };
  if (!candidate.eligible) {
    toast('Socket is not eligible', candidate.reason, 'warning');
    rebuildEditor();
    return false;
  }
  return createSocketConnection(candidate, { bidirectional });
}

function selectionEntries() {
  return validSelectedIds().map((id) => {
    const descriptor = findRecord(id);
    if (!descriptor || descriptor.category === 'asset' || descriptor.category === 'connection') return null;
    return {
      category: descriptor.category,
      record: clone(descriptor.record),
      ownerId: descriptor.owner?.id ?? null,
      collection: descriptor.category === 'primitive' && descriptor.module?.models?.includes(descriptor.record) ? 'models' : 'primitives',
      module: descriptor.category === 'room' ? clone(getRoomModule(descriptor.record, { create: false })) : null,
    };
  }).filter(Boolean);
}

function copySelection({ notify = true } = {}) {
  state.clipboard = selectionEntries();
  if (notify) {
    toast(
      state.clipboard.length ? 'Copied selection' : 'Nothing to copy',
      state.clipboard.length ? `${state.clipboard.length} object${state.clipboard.length === 1 ? '' : 's'} ready to paste.` : 'Select an editable object first.',
      state.clipboard.length ? 'success' : 'warning',
    );
  }
  return state.clipboard;
}

function materializeCopy(entry) {
  const copy = clone(entry.record);
  const copyId = makeId(entry.category);
  copy.id = copyId;
  copy.name = `${copy.name || prettyType(copy.type)} Copy`;
  if (entry.category === 'room') {
    ensureTransform(copy);
    copy.transform.position.x += state.snapValue;
    copy.transform.position.z += state.snapValue;
    copy.moduleId = `${copy.moduleId || 'room'}-copy-${copyId.slice(-4)}`;
    if (entry.module) {
      const copiedModule = clone(entry.module);
      copiedModule.moduleId = copy.moduleId;
      copiedModule.room ||= {};
      copiedModule.room.id = copy.moduleId;
      copiedModule.room.name = copy.name;
      copiedModule.topologyRevision = 1;
      copiedModule.sockets = (copiedModule.sockets || []).map((socket) => ({ ...socket, id: makeId('socket') }));
      state.project.roomModules.push(copiedModule);
    }
    state.project.rooms.push(copy);
  } else if (entry.category === 'entity') {
    ensureTransform(copy);
    copy.transform.position.x += state.snapValue;
    copy.transform.position.z += state.snapValue;
    if (copy.roomId && !state.project.rooms.some((room) => room.id === copy.roomId)) copy.roomId = getActiveRoom()?.id;
    state.project.entities.push(copy);
  } else if (entry.category === 'primitive') {
    ensureTransform(copy);
    copy.transform.position.x += state.snapValue;
    copy.transform.position.z += state.snapValue;
    const owner = state.project.rooms.find((room) => room.id === entry.ownerId) ?? getActiveRoom();
    const module = getRoomModule(owner);
    module[entry.collection === 'models' ? 'models' : 'primitives'].push(copy);
    module.topologyRevision += 1;
  } else if (entry.category === 'socket') {
    copy.position = vector(copy.position || copy.transform?.position);
    copy.position.x += state.snapValue;
    copy.position.z += state.snapValue;
    copy.transform = { ...(copy.transform || {}), position: clone(copy.position), rotationY: Number(copy.transform?.rotationY) || 0, scale: vector(copy.transform?.scale, { x: 1, y: 1, z: 1 }) };
    const owner = state.project.rooms.find((room) => room.id === entry.ownerId) ?? getActiveRoom();
    const module = getRoomModule(owner);
    module.sockets.push(copy);
    module.topologyRevision += 1;
  }
  return copyId;
}

function duplicateEntries(entries, label) {
  if (!entries.length) return;
  const copyIds = [];
  const changed = commit(label, () => entries.forEach((entry) => copyIds.push(materializeCopy(entry))), { rebuild: false, select: null });
  if (!changed) return;
  state.selectedIds = copyIds;
  state.selectedId = copyIds.at(-1) || null;
  rebuildEditor();
}

function duplicateSelection() {
  duplicateEntries(selectionEntries(), 'Duplicated selection');
}

function pasteSelection() {
  if (!state.clipboard.length) return toast('Clipboard is empty', 'Copy one or more editor objects first.', 'warning');
  duplicateEntries(state.clipboard.map(clone), 'Pasted selection');
}

function deleteSelection() {
  const ids = validSelectedIds();
  if (!ids.length) return;
  const descriptors = ids.map(findRecord).filter(Boolean);
  const roomIds = new Set(descriptors.filter(({ category }) => category === 'room').map(({ record }) => record.id));
  const entityIds = new Set(descriptors.filter(({ category }) => category === 'entity').map(({ record }) => record.id));
  const primitiveIds = new Set(descriptors.filter(({ category }) => category === 'primitive').map(({ record }) => record.id));
  const socketIds = new Set(descriptors.filter(({ category }) => category === 'socket').map(({ record }) => record.id));
  const connectionIds = new Set(descriptors.filter(({ category }) => category === 'connection').map(({ record }) => record.id));
  commit(`Deleted ${ids.length} object${ids.length === 1 ? '' : 's'}`, () => {
    state.project.rooms = state.project.rooms.filter((room) => !roomIds.has(room.id));
    state.project.entities = state.project.entities.filter((entity) => !entityIds.has(entity.id) && !roomIds.has(entity.roomId));
    for (const module of state.project.roomModules) {
      const primitiveCount = module.primitives?.length ?? 0;
      const modelCount = module.models?.length ?? 0;
      const socketCount = module.sockets?.length ?? 0;
      module.primitives = (module.primitives || []).filter((primitive) => !primitiveIds.has(primitive.id));
      module.models = (module.models || []).filter((model) => !primitiveIds.has(model.id));
      module.sockets = (module.sockets || []).filter((socket) => !socketIds.has(socket.id));
      if (primitiveCount !== module.primitives.length || modelCount !== module.models.length || socketCount !== module.sockets.length) module.topologyRevision += 1;
    }
    state.project.connections = state.project.connections.filter((connection) => (
      !connectionIds.has(connection.id)
      && !roomIds.has(connection.from?.roomId)
      && !roomIds.has(connection.to?.roomId)
      && !socketIds.has(connection.from?.socketId)
      && !socketIds.has(connection.to?.socketId)
    ));
    const referencedModules = new Set(state.project.rooms.map((room) => room.moduleId));
    state.project.roomModules = state.project.roomModules.filter((module) => referencedModules.has(module.moduleId));
    if (!state.project.entities.some((entity) => entity.id === state.project.settings.spawnId)) {
      state.project.settings.spawnId = state.project.entities.find((entity) => ['player-spawn', 'dungeon-start'].includes(entity.type))?.id ?? null;
    }
    state.activeRoomId = state.project.rooms.some((room) => room.id === state.activeRoomId) ? state.activeRoomId : state.project.rooms[0]?.id || null;
    clearSelection();
  }, { select: null });
}

function refreshStatus() {
  const selectedIds = validSelectedIds();
  const descriptor = findRecord(state.selectedId);
  $('#status-selection').textContent = selectedIds.length > 1
    ? `${selectedIds.length} objects selected`
    : descriptor ? descriptor.record.name || prettyType(descriptor.record.type || descriptor.category) : 'No selection';
  const visibleCount = state.mode === 'room'
    ? roomPrimitives(getActiveRoom()).length + state.project.entities.filter((entity) => entity.roomId === getActiveRoom()?.id).length + roomSockets(getActiveRoom()).length
    : state.project.rooms.length + state.project.connections.length + state.project.entities.filter((entity) => !entity.roomId).length;
  $('#object-count').textContent = `${visibleCount} object${visibleCount === 1 ? '' : 's'}`;
  $('#viewport-empty').hidden = visibleCount > 0;
  $('[data-action="undo"]').disabled = !state.undo.length;
  $('[data-action="redo"]').disabled = !state.redo.length;
}

function refreshUI() {
  $('#project-name').value = state.project.name;
  renderOutliner();
  renderInspector();
  renderAssets();
  refreshStatus();
}

function rebuildEditor() {
  rebuildScene();
  refreshUI();
}

function normalizeIssues(report) {
  if (!report) return [];
  const list = Array.isArray(report) ? report : report.diagnostics || report.issues || [...(report.errors || []), ...(report.warnings || [])];
  return list.map((issue) => typeof issue === 'string' ? { severity: 'error', message: issue } : {
    severity: String(issue.severity || issue.level || (issue.error ? 'error' : 'warning')).toLowerCase(),
    message: issue.message || issue.reason || issue.code || 'Validation issue',
    path: issue.path || issue.pointer || issue.entityId || '',
    id: issue.entityId || issue.roomId || issue.id,
  });
}

async function validateProject({ notify = false } = {}) {
  let issues = [];
  const validator = Core.validateLevelEditorProject || Core.validateProject;
  if (typeof validator === 'function') {
    try { issues = normalizeIssues(await validator(state.project)); }
    catch (error) { issues.push({ severity: 'error', message: `Core validation failed: ${error.message}` }); }
  }
  if (!state.project.rooms.length) issues.push({ severity: 'error', message: 'At least one room is required.', path: 'rooms' });
  const hasSpawn = state.project.entities.some((entity) => ['player-spawn', 'dungeon-start'].includes(entity.type));
  if (!hasSpawn) issues.push({ severity: 'warning', message: 'Add a player or dungeon start marker before playtesting.', path: 'entities' });
  if (state.project.rooms.length > 1 && !state.project.connections.length) issues.push({ severity: 'warning', message: 'Multiple rooms exist but none are connected.', path: 'connections' });
  const connectedSocketIds = new Set(state.project.connections.flatMap((connection) => [connection.from?.socketId, connection.to?.socketId]));
  const orphanCount = state.project.rooms.flatMap((room) => roomSockets(room)).filter((socket) => !connectedSocketIds.has(socket.id)).length;
  if (state.mode === 'dungeon' && orphanCount) issues.push({ severity: 'info', message: `${orphanCount} socket${orphanCount === 1 ? '' : 's'} remain available for connections.`, path: 'rooms.sockets' });
  const errors = issues.filter((issue) => ['error', 'fatal'].includes(issue.severity));
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  state.validation = { valid: !errors.length, issues, errors, warnings };
  renderValidation();
  if (notify) toast(errors.length ? 'Validation found blockers' : warnings.length ? 'Validation complete with warnings' : 'Project is ready', errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'} must be fixed.` : warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'} to review.` : 'No issues found.', errors.length ? 'error' : warnings.length ? 'warning' : 'success');
  return state.validation;
}

function renderValidation() {
  const { issues, errors = [], warnings = [] } = state.validation;
  const icon = $('#validation-icon');
  const dot = $('#validation-dot');
  icon.className = `validation-icon ${errors.length ? 'error' : warnings.length ? 'warning' : 'ok'}`;
  dot.className = `validation-dot ${errors.length ? 'error' : warnings.length ? 'warning' : ''}`;
  $('#validation-title').textContent = errors.length ? `${errors.length} blocking issue${errors.length === 1 ? '' : 's'}` : warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : 'Ready to playtest';
  $('#validation-subtitle').textContent = errors.length ? 'Resolve before runtime compile' : warnings.length ? 'Project can still be previewed' : 'No blocking issues';
  $('#validation-list').innerHTML = issues.slice(0, 8).map((issue) => `<div class="validation-item ${issue.severity === 'error' || issue.severity === 'fatal' ? 'error' : ''}"><i></i><span>${escapeHTML(issue.message)}${issue.path ? `<button data-validation-path="${escapeHTML(issue.path)}">${escapeHTML(issue.path)}</button>` : ''}</span></div>`).join('');
  $$('[data-validation-path]').forEach((button) => button.addEventListener('click', () => {
    const issue = issues.find((candidate) => candidate.path === button.dataset.validationPath);
    if (issue?.id) selectItem(issue.id);
  }));
}

function initializeStore() {
  if (typeof Core.LevelProjectStore !== 'function') return null;
  try { return new Core.LevelProjectStore(); } catch { return null; }
}

async function callStore(methods, ...args) {
  for (const method of methods) {
    if (typeof state.coreStore?.[method] !== 'function') continue;
    try { return await state.coreStore[method](...args); }
    catch (error) { console.warn(`LevelProjectStore.${method} failed.`, error); }
  }
  return undefined;
}

function rememberRecent(project) {
  try {
    const recents = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]').filter((entry) => entry.projectId !== project.projectId);
    recents.unshift({ projectId: project.projectId, name: project.name, updatedAt: project.updatedAt, rooms: project.rooms.length });
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, 18)));
  } catch { /* recents are non-critical */ }
}

async function saveProject({ silent = false } = {}) {
  clearTimeout(state.saveTimer);
  state.project.name = $('#project-name').value.trim() || state.project.name || 'Untitled Expedition';
  state.project.updatedAt = new Date().toISOString();
  setSaveState('Saving…', 'saving');
  let saved = false;
  try {
    const coreResult = await callStore(['saveProject', 'save', 'put'], state.project, { allowInvalid: true, requireSpawn: false });
    saved ||= coreResult !== undefined;
    localStorage.setItem(`${STORAGE_PREFIX}${state.project.projectId}`, JSON.stringify(state.project));
    rememberRecent(state.project);
    saved = true;
  } catch (error) {
    setSaveState('Save failed', 'dirty');
    if (!silent) toast('Could not save project', error.message, 'error', 6000);
    return false;
  }
  if (saved) {
    state.dirty = false;
    setSaveState('Saved locally');
    if (!silent) toast('Project saved', state.project.name);
  }
  return saved;
}

async function listSavedProjects() {
  let projects = await callStore(['listProjects', 'list', 'getAll'], { includeDocuments: true });
  if (projects?.projects) projects = projects.projects;
  if (!Array.isArray(projects)) projects = [];
  const byId = new Map();
  for (const project of projects) {
    const normalized = project.project || project.value || project;
    if (normalized?.projectId) byId.set(normalized.projectId, normalized);
  }
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      const project = JSON.parse(localStorage.getItem(key));
      if (project?.projectId) byId.set(project.projectId, project);
    }
  } catch { /* ignore malformed local entries */ }
  return [...byId.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function showProjectDialog() {
  const dialog = $('#project-dialog');
  const projects = await listSavedProjects();
  const list = $('#project-list');
  list.innerHTML = projects.length ? projects.map((project) => `<button type="button" class="project-card" data-open-id="${escapeHTML(project.projectId)}"><span class="project-card-icon">${ICONS.room}</span><span><strong>${escapeHTML(project.name || 'Untitled')}</strong><small>${project.rooms?.length || 0} rooms · revision ${project.revision || 0}</small></span><time>${new Date(project.updatedAt || 0).toLocaleDateString()}</time></button>`).join('') : '<div class="project-list-empty">No locally saved projects yet.<br/>Import a JSON project to get started.</div>';
  $$('[data-open-id]', list).forEach((button) => button.addEventListener('click', async () => {
    await loadSavedProject(button.dataset.openId);
    dialog.close();
  }));
  dialog.showModal();
}

async function loadSavedProject(projectId, { source = 'manual', notify = true, resetHistory = true } = {}) {
  let loaded = await callStore(['getProject', 'loadProject', 'load', 'get'], projectId);
  loaded = unwrapProject(loaded);
  if (!loaded) {
    try { loaded = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${projectId}`)); } catch { /* handled below */ }
  }
  if (!loaded) {
    if (notify) toast('Project not found', 'The local record may have been removed.', 'error');
    return null;
  }
  const previousRevision = Number(state.project.revision) || 0;
  const previousProjectId = state.project.projectId;
  const upgradedLegacySockets = projectHasLegacyGeneratedDoorSockets(loaded);
  resetConnectionWorkflow();
  state.project = normalizeProject(loaded);
  state.activeRoomId = state.project.rooms[0]?.id;
  clearSelection();
  if (resetHistory) {
    state.undo.length = 0;
    state.redo.length = 0;
  }
  state.dirty = upgradedLegacySockets;
  $('#project-name').value = state.project.name;
  rebuildEditor();
  frameAll();
  validateProject();
  if (upgradedLegacySockets) {
    scheduleSave();
    if (notify) toast('Project upgraded', 'Legacy doorway thresholds and their connector routes were moved to floor level and saved locally.');
  } else {
    setSaveState('Saved locally');
    if (notify) toast('Project opened', state.project.name);
  }
  if (source === 'manual' && state.forgeControl.active) noteManualForgeEdit(previousRevision, { previousProjectId });
  return clone(state.project);
}

async function serializeProject() {
  const serializer = Core.exportLevelEditorProject || Core.serializeLevelEditorProject || Core.serializeProject;
  if (typeof serializer === 'function') {
    const result = await serializer(state.project, { pretty: true, includeAssets: true });
    if (result instanceof Blob) return result;
    if (typeof result === 'string') return new Blob([result], { type: 'application/json' });
    if (result?.blob instanceof Blob) return result.blob;
    if (typeof result?.text === 'string') return new Blob([result.text], { type: 'application/json' });
    return new Blob([JSON.stringify(result?.value || result?.project || state.project, null, 2)], { type: 'application/json' });
  }
  return new Blob([JSON.stringify(state.project, null, 2)], { type: 'application/json' });
}

function projectSlug(suffix = '') {
  const base = state.project.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'level-project';
  return suffix ? `${base}-${suffix}` : base;
}

function downloadValue(value, filename, type = 'application/octet-stream') {
  const blob = value instanceof Blob ? value : new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

let fflatePromise = null;
function loadFflate() {
  fflatePromise ||= import('../../node_modules/fflate/esm/browser.js');
  return fflatePromise;
}

async function exportProject() {
  try {
    const blob = await serializeProject();
    const filename = downloadValue(blob, `${projectSlug()}.json`, 'application/json');
    toast('Project exported', filename);
  } catch (error) { toast('Export failed', error.message, 'error', 6000); }
}

async function exportRoomJson() {
  try {
    const compiler = Core.compileEditorRoom || Core.compileRoomModule;
    if (typeof compiler !== 'function') throw new Error('Room compilation is unavailable.');
    const compiled = await compiler(state.project, getActiveRoom()?.id, { allowInvalid: false });
    if (!compiled?.value) throw new Error(compiled?.errors?.[0]?.message || 'The active room did not compile.');
    const serializer = Core.serializeLevelDocument || ((value) => JSON.stringify(value, null, 2));
    const text = await serializer(compiled.value, { pretty: true });
    const filename = downloadValue(text, `${projectSlug(compiled.value.moduleId)}.room.json`, 'application/json');
    toast('Room module exported', filename);
  } catch (error) { toast('Room export failed', error.message, 'error', 6000); }
}

async function exportDungeonJson() {
  try {
    const compiled = await compileForPlaytest();
    const dungeon = compiled.value || compiled.dungeon || compiled;
    const serializer = Core.serializeLevelDocument || ((value) => JSON.stringify(value, null, 2));
    const text = await serializer(dungeon, { pretty: true });
    const filename = downloadValue(text, `${projectSlug('dungeon')}.json`, 'application/json');
    toast('Compiled dungeon exported', filename);
  } catch (error) { toast('Dungeon export failed', error.message, 'error', 7000); }
}

async function exportProjectModule() {
  try {
    const serializer = Core.serializePureDataModule;
    if (typeof serializer !== 'function') throw new Error('Pure-data module export is unavailable.');
    let value;
    let exportName;
    let suffix;
    if (state.mode === 'room') {
      const compiler = Core.compileEditorRoom || Core.compileRoomModule;
      const compiled = await compiler?.(state.project, getActiveRoom()?.id, { allowInvalid: false });
      if (!compiled?.value) throw new Error(compiled?.errors?.[0]?.message || 'The active room did not compile.');
      value = compiled.value;
      exportName = 'roomModule';
      suffix = 'room';
    } else {
      const compiled = await compileForPlaytest();
      value = compiled.value || compiled.dungeon;
      exportName = 'authoredDungeon';
      suffix = 'dungeon';
    }
    const text = await serializer(value, { exportName, pretty: true });
    const filename = downloadValue(text, `${projectSlug(suffix)}.mjs`, 'text/javascript');
    toast('Runtime data module exported', filename);
  } catch (error) { toast('Module export failed', error.message, 'error', 6000); }
}

async function exportProjectZip() {
  try {
    const exporter = Core.exportProjectZip || Core.exportProjectBundle;
    if (typeof exporter !== 'function') throw new Error('Portable ZIP export is unavailable.');
    const fflate = await loadFflate();
    let document;
    let documentKind;
    if (state.mode === 'room') {
      const compiler = Core.compileEditorRoom || Core.compileRoomModule;
      const compiled = await compiler?.(state.project, getActiveRoom()?.id, { allowInvalid: false });
      if (!compiled?.value) throw new Error(compiled?.errors?.[0]?.message || 'The active room did not compile.');
      document = compiled.value;
      documentKind = 'room';
    } else {
      const compiled = await compileForPlaytest();
      document = compiled.value || compiled.dungeon;
      documentKind = 'dungeon';
    }
    const assets = [];
    for (const asset of state.project.assets) {
      const blob = typeof state.coreStore?.getAsset === 'function' ? await state.coreStore.getAsset(asset.hash) : null;
      if (blob) assets.push({ hash: asset.hash, blob, name: asset.name, mimeType: asset.mimeType, metadata: { relativePath: asset.relativePath || asset.name } });
    }
    const bytes = await exporter(state.project, { fflate, assets, document, documentKind, pretty: true });
    const filename = downloadValue(bytes, `${projectSlug(documentKind)}.zip`, 'application/zip');
    toast('Portable project exported', `${filename} · ${assets.length} embedded asset${assets.length === 1 ? '' : 's'}`);
  } catch (error) { toast('ZIP export failed', error.message, 'error', 7000); }
}

async function parseProjectFile(file) {
  if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
    const importer = Core.importProjectZip || Core.importProjectBundle;
    if (typeof importer !== 'function') throw new Error('Portable ZIP import is unavailable.');
    const report = await importer(file, { fflate: await loadFflate() });
    if (report?.ok === false) throw new Error(report.errors?.[0]?.message || 'The project bundle is invalid.');
    const bundleFiles = (report.assets || []).map((asset) => new File(
      [asset.blob],
      asset.metadata?.relativePath || asset.name || asset.path,
      { type: asset.mimeType || asset.blob?.type || 'application/octet-stream' },
    ));
    await validateAssetBatch(bundleFiles);
    for (const asset of report.assets || []) {
      if (typeof state.coreStore?.putAsset !== 'function' || !asset.blob) continue;
      await state.coreStore.putAsset(asset.blob, { hash: asset.hash, name: asset.name, mimeType: asset.mimeType, metadata: asset.metadata || { relativePath: asset.name } });
    }
    return normalizeProject(unwrapProject(report));
  }
  const text = await file.text();
  if (/\.mjs$/i.test(file.name) || /javascript/.test(file.type)) {
    const moduleParser = Core.parsePureDataModule || Core.parseProjectDataModule || Core.importProjectModule;
    if (typeof moduleParser !== 'function') throw new Error('Pure-data module import is unavailable.');
    const value = unwrapProject(await moduleParser(text));
    if (value?.schema === 'ruindivex-room-module/v1') {
      const project = createProject();
      const room = project.rooms[0];
      room.moduleId = value.moduleId;
      room.name = value.room?.name || value.moduleId;
      room.dimensions = { width: value.dimensions?.width ?? value.dimensions?.widthMeters ?? value.room?.width ?? 10, height: value.dimensions?.height ?? value.dimensions?.heightMeters ?? value.room?.ceilingHeight ?? 4, depth: value.dimensions?.depth ?? value.dimensions?.depthMeters ?? value.room?.depth ?? 10 };
      project.roomModules = [{ ...clone(value), entities: [] }];
      project.entities = (value.entities || []).map((entity) => ({ ...clone(entity), id: entity.id || makeId('entity'), roomId: room.id }));
      project.settings.spawnId = project.entities.find((entity) => ['spawn', 'player-spawn', 'player_spawn'].includes(entity.kind) || ['spawn', 'player-spawn', 'player_spawn'].includes(entity.type))?.id || null;
      return normalizeProject(project);
    }
    if (value?.schema === 'ruindivex-authored-dungeon/v1') {
      const project = createProject();
      project.projectId = value.dungeonId || project.projectId;
      project.name = value.name || file.name.replace(/\.mjs$/i, '');
      project.revision = Math.max(1, Number(value.revision) || 1);
      project.rooms = clone(value.rooms || []);
      project.connections = clone(value.connections || []);
      project.entities = clone(value.entities || []);
      project.settings.spawnId = value.spawnId || null;
      project.roomModules = (value.rooms || []).flatMap((roomDefinition) => roomDefinition.definition ? [{ ...clone(roomDefinition.definition), moduleId: roomDefinition.moduleId }] : []);
      return normalizeProject(project);
    }
    return normalizeProject(value);
  }
  const importer = Core.importLevelEditorProject || Core.parseLevelEditorProject || Core.deserializeLevelEditorProject || Core.parseProject;
  if (typeof importer === 'function') return normalizeProject(unwrapProject(await importer(text, { sourceName: file.name })));
  return normalizeProject(JSON.parse(text));
}

async function importProjectFile(file) {
  if (!file) return;
  try {
    const project = await parseProjectFile(file);
    const before = snapshot();
    resetConnectionWorkflow();
    state.project = project;
    state.activeRoomId = project.rooms[0]?.id;
    clearSelection();
    pushUndo(before);
    state.redo.length = 0;
    markDirty('Imported project');
    $('#project-name').value = project.name;
    rebuildEditor();
    frameAll();
    await validateProject();
    toast('Project imported', file.name);
  } catch (error) { toast('Import failed', error.message, 'error', 7000); }
}

async function hashFile(file) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  } catch { return makeId('asset'); }
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const UNSUPPORTED_GLTF_EXTENSIONS = new Set(['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression']);

function selectedFilePath(file) {
  return String(file.webkitRelativePath || file.name || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function resolveSelectedAssetPath(basePath, uri) {
  let decoded;
  try { decoded = decodeURIComponent(String(uri).split(/[?#]/, 1)[0]); }
  catch { throw new Error(`Invalid encoded glTF URI: ${uri}`); }
  if (!decoded || decoded.startsWith('data:')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('//') || decoded.startsWith('/')) {
    throw new Error(`Remote or absolute glTF URI is not allowed: ${uri}`);
  }
  const parts = basePath.split('/').slice(0, -1);
  for (const part of decoded.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error(`glTF URI escapes the selected asset set: ${uri}`);
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

async function decodeImageFile(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    const valid = bitmap.width > 0 && bitmap.height > 0;
    bitmap.close();
    if (!valid) throw new Error(`${file.name} did not decode to a valid image.`);
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => image.naturalWidth && image.naturalHeight ? resolve() : reject(new Error('Empty image.'));
      image.onerror = () => reject(new Error('Image decode failed.'));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

function validateGltfDocument(document, sourceName) {
  const version = String(document?.asset?.version ?? '');
  if (!version.startsWith('2.')) throw new Error(`${sourceName} must use glTF 2.x.`);
  const unsupported = [...new Set([...(document.extensionsRequired || []), ...(document.extensionsUsed || [])])]
    .filter((extension) => UNSUPPORTED_GLTF_EXTENSIONS.has(extension));
  if (unsupported.length) throw new Error(`${sourceName} uses unsupported compressed glTF extensions: ${unsupported.join(', ')}.`);
  return document;
}

async function readGlbDocument(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength < 20) throw new Error(`${file.name} is not a complete GLB file.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error(`${file.name} has an invalid GLB header.`);
  if (view.getUint32(4, true) !== 2) throw new Error(`${file.name} must use GLB version 2.`);
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error(`${file.name} has an invalid declared byte length.`);
  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== 0x4e4f534a || 20 + chunkLength > bytes.byteLength) throw new Error(`${file.name} is missing its JSON chunk.`);
  const json = new TextDecoder().decode(bytes.subarray(20, 20 + chunkLength)).replace(/[\u0000\s]+$/g, '');
  return validateGltfDocument(JSON.parse(json), file.name);
}

async function validateAssetBatch(files) {
  const selected = [...files];
  const pathMap = new Map(selected.map((file) => [selectedFilePath(file), file]));
  const basenameMap = new Map();
  for (const file of selected) {
    const basename = selectedFilePath(file).split('/').pop();
    if (!basenameMap.has(basename)) basenameMap.set(basename, []);
    basenameMap.get(basename).push(file);
  }
  const decodedImages = new Set();
  const dependencies = new Map();
  const decodeOnce = async (file) => {
    if (decodedImages.has(file)) return;
    await decodeImageFile(file);
    decodedImages.add(file);
  };
  for (const file of selected) {
    if (file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)) await decodeOnce(file);
    if (/\.glb$/i.test(file.name) || file.type === 'model/gltf-binary') {
      await readGlbDocument(file);
      dependencies.set(selectedFilePath(file), []);
      continue;
    }
    if (!/\.gltf$/i.test(file.name) && file.type !== 'model/gltf+json') continue;
    let document;
    try { document = validateGltfDocument(JSON.parse(await file.text()), file.name); }
    catch (error) { throw new Error(`Invalid glTF ${file.name}: ${error.message}`); }
    const dependencyPaths = [];
    for (const spec of [...(document.buffers || []), ...(document.images || [])]) {
      if (!spec?.uri || String(spec.uri).startsWith('data:')) continue;
      const resolvedPath = resolveSelectedAssetPath(selectedFilePath(file), spec.uri);
      let companion = pathMap.get(resolvedPath);
      if (!companion) {
        const basenameMatches = basenameMap.get(resolvedPath.split('/').pop()) || [];
        if (basenameMatches.length === 1) companion = basenameMatches[0];
      }
      if (!companion) throw new Error(`${file.name} is missing selected companion ${spec.uri}.`);
      dependencyPaths.push(selectedFilePath(companion));
      if ((document.images || []).includes(spec)) await decodeOnce(companion);
    }
    dependencies.set(selectedFilePath(file), [...new Set(dependencyPaths)]);
  }
  return dependencies;
}

async function importAssets(files) {
  const accepted = [...files].filter((file) => /^(image\/(png|jpeg|webp)|model\/gltf|application\/octet-stream)/.test(file.type) || /\.(glb|gltf|bin)$/i.test(file.name));
  if (!accepted.length) return toast('No supported assets', 'Use PNG, JPG, WEBP, GLB, or GLTF files.', 'warning');
  let dependencies;
  try { dependencies = await validateAssetBatch(accepted); }
  catch (error) { return toast('Asset validation failed', error.message, 'error', 8000); }
  const records = [];
  for (const file of accepted) {
    try {
      let stored = null;
      if (typeof state.coreStore?.putAsset === 'function') {
        stored = await state.coreStore.putAsset(file, {
          name: file.name,
          mimeType: file.type || undefined,
          metadata: { relativePath: file.webkitRelativePath || file.name },
        });
      }
      const hash = stored?.hash || await hashFile(file);
      if (state.project.assets.some((asset) => asset.hash === hash)) continue;
      const id = makeId('asset');
      const previewUrl = URL.createObjectURL(file);
      state.objectURLs.add(previewUrl);
      state.assetPreviewUrls.set(hash, previewUrl);
      const image = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);
      const model = /\.(glb|gltf)$/i.test(file.name) || file.type.startsWith('model/gltf');
      const kind = image ? 'texture' : model ? 'model' : 'companion';
      records.push({ id, hash, name: stored?.name || file.name, kind, type: kind, mimeType: stored?.mimeType || file.type || (file.name.endsWith('.glb') ? 'model/gltf-binary' : file.name.endsWith('.gltf') ? 'model/gltf+json' : 'application/octet-stream'), size: stored?.size ?? file.size, relativePath: file.webkitRelativePath || file.name, importedAt: new Date().toISOString(), dependencies: dependencies.get(selectedFilePath(file)) || [], properties: {} });
    } catch (error) { toast(`Could not import ${file.name}`, error.message, 'error'); }
  }
  if (!records.length) return toast('Assets already imported', 'Matching content hashes were found in this project.', 'warning');
  commit(`Imported ${records.length} asset${records.length === 1 ? '' : 's'}`, () => state.project.assets.push(...records));
  toast('Assets imported', records.map((record) => record.name).join(', '));
}

function renderAssets() {
  const target = $('#asset-list');
  if (!state.project.assets.length) {
    target.innerHTML = `<button class="asset-empty" data-action="upload-assets">${ICONS.model}<span>Drop or import assets</span><small>PNG, JPG, WEBP, GLB, GLTF</small></button>`;
    $('[data-action="upload-assets"]', target).addEventListener('click', () => $('#asset-file-input').click());
    return;
  }
  target.innerHTML = state.project.assets.map((asset) => {
    const preview = state.assetPreviewUrls.get(asset.hash) || asset.dataUrl;
    return `<div class="asset-row" draggable="true" data-asset-id="${escapeHTML(asset.id)}"><span class="asset-preview" ${asset.kind === 'texture' && preview ? `style="background-image:url('${preview.replace(/'/g, '%27')}')"` : ''}>${asset.kind === 'model' ? ICONS.model : ''}</span><span class="asset-meta"><strong>${escapeHTML(asset.name)}</strong><small>${asset.kind.toUpperCase()} · ${formatBytes(asset.size)}</small></span><button class="asset-remove" data-remove-asset="${escapeHTML(asset.id)}" aria-label="Remove ${escapeHTML(asset.name)}">×</button></div>`;
  }).join('');
  $$('[data-asset-id]', target).forEach((row) => row.addEventListener('dragstart', (event) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-ruindiver-asset', row.dataset.assetId);
  }));
  $$('[data-remove-asset]', target).forEach((button) => button.addEventListener('click', async () => {
    const asset = state.project.assets.find((candidate) => candidate.id === button.dataset.removeAsset);
    if (!asset) return;
    const ids = new Set([asset.id, asset.hash].filter(Boolean));
    const entityUsesAsset = state.project.entities.some((entity) => ids.has(entity.assetHash)
      || ids.has(entity.asset)
      || ids.has(entity.properties?.assetId)
      || ids.has(entity.properties?.textureAssetId));
    const moduleUsesAsset = (state.project.roomModules || []).some((module) => {
      const modelUse = (module.models || []).some((model) => ids.has(model.asset)
        || ids.has(model.assetHash)
        || ids.has(model.assetId)
        || ids.has(model.properties?.assetId));
      const primitiveUse = (module.geometry?.primitives || module.primitives || []).some((primitive) => ids.has(primitive.asset)
        || ids.has(primitive.assetHash)
        || ids.has(primitive.properties?.assetId)
        || ids.has(primitive.properties?.textureAssetId));
      const materials = Array.isArray(module.materials) ? module.materials : Object.entries(module.materials || {}).map(([id, definition]) => ({ id, ...definition }));
      const materialUse = materials.some((material) => ['baseColorMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']
        .some((field) => ids.has(material[field]?.id) || ids.has(material[field]?.assetId) || ids.has(material[field]?.hash)));
      return modelUse || primitiveUse || materialUse;
    });
    if (entityUsesAsset || moduleUsesAsset) return toast('Asset is in use', 'Remove it from scene objects and materials before deleting.', 'warning');

    const previewUrl = state.assetPreviewUrls.get(asset.hash);
    commit('Removed asset', () => { state.project.assets = state.project.assets.filter((candidate) => candidate.id !== asset.id); });
    state.assetPreviewUrls.delete(asset.hash);
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    try {
      if (asset.hash && !state.project.assets.some((candidate) => candidate.hash === asset.hash)) await state.coreStore?.deleteAsset?.(asset.hash);
    } catch (error) {
      toast('Asset data cleanup deferred', error.message, 'warning');
    }
  }));
}

async function resolveAssetUrl(asset) {
  if (!asset) return null;
  if (asset.dataUrl || asset.uri) return asset.dataUrl || asset.uri;
  const cached = state.assetPreviewUrls.get(asset.hash);
  if (cached) return cached;
  if (typeof state.coreStore?.getAsset !== 'function' || !asset.hash) return null;
  try {
    const blob = await state.coreStore.getAsset(asset.hash);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    state.objectURLs.add(url);
    state.assetPreviewUrls.set(asset.hash, url);
    renderAssets();
    return url;
  } catch { return null; }
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function placeAsset(assetId, placement) {
  const asset = state.project.assets.find((candidate) => candidate.id === assetId);
  if (!asset) return;
  if (asset.kind === 'companion') {
    return toast('Companion asset', `${asset.name} is resolved automatically by its glTF model.`, 'warning');
  }
  if (asset.kind === 'texture') {
    const selected = findRecord(state.selectedId);
    if (selected?.category === 'entity' || selected?.category === 'primitive') {
      commit('Applied texture', () => applyTextureAsset(selected, asset.id));
      toast('Texture assigned', selected.record.name || prettyType(selected.record.type));
    } else toast('Select a scene object first', 'Textures can be dropped onto the selected structural object.', 'warning');
    return;
  }
  const resolved = normalizePlacementInput({ kind: 'model', type: 'gltf-model', size: [2, 2, 2] }, placement);
  const position = vector(resolved.position);
  const rotationY = Number(resolved.rotationY) || 0;
  let entityId;
  commit(`Placed ${asset.name}`, () => {
    entityId = makeId('entity');
    if (state.mode === 'room') {
      const module = getRoomModule();
      module.models ||= [];
      module.models.push({ id: entityId, kind: 'model', type: 'gltf-model', name: asset.name.replace(/\.(glb|gltf)$/i, ''), asset: asset.hash, assetHash: asset.hash, transform: { position: vector(position), rotationY, scale: { x: 1, y: 1, z: 1 } }, size: { x: 2, y: 2, z: 2 }, collision: false, enabled: true, materialOverrides: {}, properties: { assetId: asset.id } });
      module.topologyRevision += 1;
    } else {
      state.project.entities.push({ id: entityId, kind: 'prop', type: 'gltf-model', name: asset.name.replace(/\.(glb|gltf)$/i, ''), assetHash: asset.hash, transform: { position: vector(position), rotationY, scale: { x: 1, y: 1, z: 1 } }, properties: { assetId: asset.id, size: [2, 2, 2], collision: false, enabled: true, editorCategory: 'model', materialOverrides: {} } });
    }
  }, { select: entityId });
  selectItem(entityId);
  if (resolved.fallbackFrom) toast('Snap target not found', `Placed on the grid because no ${resolved.fallbackFrom} target was close enough.`, 'warning');
  return entityId;
}

function generateSelectedModelCollider() {
  const descriptor = findRecord(state.selectedId);
  if (!descriptor || !['model', 'gltf-model'].includes(descriptor.record.kind) && descriptor.record.type !== 'gltf-model') {
    return toast('Select an imported model', 'Bounding-box generation applies to glTF model instances.', 'warning');
  }
  commit('Generated model collider', () => {
    if (descriptor.category === 'primitive') {
      descriptor.record.collision = true;
      descriptor.record.colliderSize = clone(descriptor.record.size || { x: 2, y: 2, z: 2 });
    } else {
      descriptor.record.properties ||= {};
      descriptor.record.properties.collision = true;
      const size = descriptor.record.properties.size || [2, 2, 2];
      descriptor.record.properties.colliderSize = Array.isArray(size)
        ? { x: Number(size[0]) || 2, y: Number(size[1]) || 2, z: Number(size[2]) || 2 }
        : clone(size);
    }
    touchTopology(descriptor);
  });
  toast('Collider generated', 'The editable box remains authoritative during playtests and export.');
}

async function compileForPlaytest() {
  const compiler = Core.compileEditorProject || Core.compileLevelEditorProject || Core.compileAuthoredDungeon || Core.compileProject || Core.compileDungeonProject;
  if (typeof compiler === 'function') {
    const result = await compiler(state.project, { requireSpawn: true, allowInvalid: false, inlineDefinitions: false });
    if (result?.ok === false || (!result?.value && result?.errors?.length)) throw new Error(result.errors?.[0]?.message || 'The authored dungeon did not compile.');
    return result;
  }
  const value = { schema: 'ruindivex-authored-dungeon/v1', dungeonId: state.project.projectId, revision: state.project.revision, rooms: clone(state.project.rooms), connections: clone(state.project.connections), entities: clone(state.project.entities), spawnId: state.project.settings.spawnId, metadata: { sourceProjectId: state.project.projectId } };
  return { ok: true, value, dungeon: value, registry: null, hash: null, diagnostics: [] };
}

async function startPlaytest({ restart = false } = {}) {
  const validation = await validateProject({ notify: false });
  if (validation.errors?.length) {
    toast('Playtest blocked', 'Resolve validation errors before compiling.', 'error', 6000);
    $('#validation-panel').scrollIntoView({ block: 'nearest' });
    return;
  }
  try {
    const compiled = await compileForPlaytest();
    const requestId = makeId('playtest');
    if (typeof state.coreStore?.writePlaytestSnapshot !== 'function') throw new Error('IndexedDB playtest snapshots are unavailable in this browser.');
    const snapshotPayloadFactory = Core.createPlaytestSnapshotPayload;
    const snapshotPayload = typeof snapshotPayloadFactory === 'function'
      ? snapshotPayloadFactory({ project: state.project, compiled, roomRegistry: compiled.registry, metadata: { requestId, restart, editorRevision: state.project.revision } })
      : { schema: 'ruindivex-playtest-snapshot/v1', projectId: state.project.projectId, project: clone(state.project), dungeon: clone(compiled.value || compiled.dungeon), roomRegistry: clone(compiled.registry), metadata: { requestId, restart } };
    const snapshotId = await state.coreStore.writePlaytestSnapshot(snapshotPayload, { projectId: state.project.projectId, saveProject: true, ttlMs: 60 * 60 * 1000 });
    state.pendingPlaytest = { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, type: 'playtest:start', requestId, snapshotId };
    state.playing = true;
    $('#editor-shell').classList.add('playtesting');
    $('#playtest-chrome').hidden = false;
    $('#playtest-status').textContent = 'Waiting for runtime…';
    if (state.bridgeReady) postPlaytestMessage();
    else setTimeout(() => { if (state.playing && state.pendingPlaytest && !state.pendingPlaytest.sent) postPlaytestMessage(); }, 650);
  } catch (error) {
    state.playing = false;
    $('#editor-shell').classList.remove('playtesting');
    $('#playtest-chrome').hidden = true;
    toast('Playtest compile failed', error.message, 'error', 7000);
  }
}

function postPlaytestMessage() {
  if (!state.pendingPlaytest || state.pendingPlaytest.sent) return;
  $('#playtest-frame').contentWindow?.postMessage(state.pendingPlaytest, location.origin);
  state.pendingPlaytest.sent = true;
  $('#playtest-status').textContent = 'Loading authored dungeon…';
}

function stopPlaytest(fromFrame = false) {
  if (!state.playing) return;
  if (!fromFrame) $('#playtest-frame').contentWindow?.postMessage({ channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, type: 'playtest:stop', requestId: makeId('stop'), reason: 'editorStop' }, location.origin);
  state.playing = false;
  state.pendingPlaytest = null;
  $('#editor-shell').classList.remove('playtesting');
  $('#playtest-chrome').hidden = true;
  $('#viewport').focus();
}

function onBridgeMessage(event) {
  if (event.source !== $('#playtest-frame').contentWindow || event.origin !== location.origin || event.data?.channel !== BRIDGE_CHANNEL || event.data?.version !== BRIDGE_VERSION) return;
  const message = event.data;
  if (message.type === 'playtest:ready') {
    state.bridgeReady = true;
    if (state.pendingPlaytest && !state.pendingPlaytest.sent) postPlaytestMessage();
  } else if (message.type === 'playtest:started') {
    state.pendingPlaytest = null;
    $('#playtest-status').textContent = message.planHash ? `Runtime active · ${String(message.planHash).slice(0, 12)}` : 'Runtime active';
    $('#playtest-frame').focus();
  } else if (message.type === 'playtest:error') {
    $('#playtest-status').textContent = 'Runtime error';
    toast('Playtest runtime error', message.message || 'Unknown runtime error', 'error', 8000);
  } else if (message.type === 'playtest:ended') stopPlaytest(true);
}

class ForgeApiError extends Error {
  constructor(message, { code = -32602, kind = 'INVALID_PARAMS', data = {} } = {}) {
    super(message);
    this.name = 'ForgeApiError';
    this.rpcCode = code;
    this.kind = kind;
    this.data = data;
  }
}

const FORGE_TYPED_OPERATIONS = Object.freeze([
  'room.add', 'room.update', 'room.remove',
  'primitive.add', 'primitive.update', 'primitive.remove',
  'socket.add', 'socket.update', 'socket.remove',
  'connection.add', 'connection.update', 'connection.remove',
  'entity.add', 'entity.update', 'entity.remove',
  'material.add', 'material.update', 'material.remove',
  'asset.add', 'asset.remove',
]);
const FORGE_TYPED_OPERATION_SET = new Set(FORGE_TYPED_OPERATIONS);
const FORGE_FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const FORGE_IMMUTABLE_KEYS = Object.freeze({
  room: new Set(['id', 'moduleId']),
  primitive: new Set(['id']),
  socket: new Set(['id']),
  connection: new Set(['id']),
  entity: new Set(['id']),
  material: new Set(['id']),
  asset: new Set(['id', 'hash']),
});

function forgeApiError(message, options) { return new ForgeApiError(message, options); }

function assertForgeJson(value, path = '$', seen = new WeakSet()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw forgeApiError(`${path} must contain only finite JSON numbers.`);
    return;
  }
  if (typeof value !== 'object' || value instanceof Blob || value instanceof Date) {
    throw forgeApiError(`${path} must contain plain JSON data only.`);
  }
  if (seen.has(value)) throw forgeApiError(`${path} must not contain cycles.`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((entry, index) => assertForgeJson(entry, `${path}[${index}]`, seen));
  else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw forgeApiError(`${path} must contain plain objects only.`);
    for (const [key, entry] of Object.entries(value)) {
      if (FORGE_FORBIDDEN_KEYS.has(key)) throw forgeApiError(`${path}.${key} is not allowed.`);
      assertForgeJson(entry, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function requireStableId(record, label) {
  const id = typeof record?.id === 'string' ? record.id.trim() : '';
  if (!id) throw forgeApiError(`${label} requires a caller-provided stable id.`, { kind: 'STABLE_ID_REQUIRED' });
  record.id = id;
  return id;
}

function mergeForgeChanges(target, changes, immutable, path) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw forgeApiError(`${path}.changes must be an object.`);
  assertForgeJson(changes, `${path}.changes`);
  for (const [key, value] of Object.entries(changes)) {
    if (immutable.has(key) && value !== target[key]) {
      throw forgeApiError(`${path}.${key} is immutable; remove and add with a new stable id instead.`, { kind: 'IMMUTABLE_ID' });
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      mergeForgeChanges(target[key], value, new Set(), `${path}.${key}`);
    } else target[key] = clone(value);
  }
  return target;
}

function forgeOperationRecord(operation, kind) {
  const record = operation[kind] ?? operation.record ?? operation.value ?? operation.data;
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw forgeApiError(`${operation.type} requires a ${kind} record.`);
  assertForgeJson(record, `${operation.type}.${kind}`);
  return clone(record);
}

function forgeOperationChanges(operation) {
  const changes = operation.changes ?? operation.update ?? operation.value ?? operation.data;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw forgeApiError(`${operation.type} requires a changes object.`);
  return changes;
}

function projectModule(project, operation, { required = true } = {}) {
  const roomId = operation.roomId ?? operation.ownerId ?? operation.room?.id;
  const room = roomId ? project.rooms.find((candidate) => candidate.id === roomId) : null;
  const moduleId = operation.moduleId ?? room?.moduleId;
  const module = moduleId ? project.roomModules.find((candidate) => candidate.moduleId === moduleId) : null;
  if (!module && required) throw forgeApiError(`${operation.type} requires an existing roomId or moduleId.`, { kind: 'TARGET_NOT_FOUND' });
  return { room, module };
}

function findForgeRecord(project, kind, id) {
  if (!id) return null;
  if (kind === 'room') {
    const record = project.rooms.find((candidate) => candidate.id === id);
    return record ? { record } : null;
  }
  if (kind === 'connection' || kind === 'entity' || kind === 'asset') {
    const collection = kind === 'connection' ? project.connections : kind === 'entity' ? project.entities : project.assets;
    const record = collection.find((candidate) => candidate.id === id);
    return record ? { record, collection } : null;
  }
  if (kind === 'socket') {
    for (const room of project.rooms) {
      const record = room.sockets?.find((candidate) => candidate.id === id);
      if (record) return { record, room, collection: room.sockets };
    }
  }
  for (const module of project.roomModules) {
    const collections = kind === 'primitive'
      ? [module.primitives || [], module.models || []]
      : kind === 'socket'
        ? [module.sockets || []]
        : [Array.isArray(module.materials) ? module.materials : Object.values(module.materials || {})];
    for (const collection of collections) {
      const record = collection.find((candidate) => candidate.id === id);
      if (record) return { record, module, collection };
    }
  }
  return null;
}

function assertForgeIdAvailable(project, kind, id) {
  if (findForgeRecord(project, kind, id)) throw forgeApiError(`${kind} id "${id}" already exists.`, { code: -32010, kind: 'ID_CONFLICT', data: { kind, id } });
}

function touchForgeModule(module) {
  if (module) module.topologyRevision = Math.max(1, Number(module.topologyRevision) || 1) + 1;
}

function deleteFromCollection(collection, record) {
  const index = collection.indexOf(record);
  if (index >= 0) collection.splice(index, 1);
}

function decodeForgeAsset(record) {
  const encoded = record.contentBase64 ?? record.base64 ?? (typeof record.data === 'string' ? record.data : null);
  if (!encoded) return null;
  const match = String(encoded).match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s);
  const mimeType = match?.[1] || record.mimeType || 'application/octet-stream';
  const raw = match ? match[2] : String(encoded);
  let bytes;
  try {
    const binary = atob(raw.replace(/\s+/g, ''));
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw forgeApiError('asset.add contains invalid base64 data.', { kind: 'INVALID_ASSET_DATA' });
  }
  return new Blob([bytes], { type: mimeType });
}

function validateForgeProjectIds(project) {
  const groups = new Map([
    ['room', project.rooms],
    ['connection', project.connections],
    ['entity', project.entities],
    ['asset', project.assets],
    ['primitive', project.roomModules.flatMap((module) => [...(module.primitives || []), ...(module.models || [])])],
    ['socket', [...project.roomModules.flatMap((module) => module.sockets || []), ...project.rooms.flatMap((room) => room.sockets || [])]],
  ]);
  for (const [kind, records] of groups) {
    const ids = new Set();
    for (const record of records) {
      const id = requireStableId(record, kind);
      if (ids.has(id)) throw forgeApiError(`Duplicate ${kind} id "${id}".`, { code: -32010, kind: 'ID_CONFLICT', data: { kind, id } });
      ids.add(id);
    }
  }
  const moduleIds = new Set();
  for (const module of project.roomModules) {
    if (!module.moduleId || typeof module.moduleId !== 'string') throw forgeApiError('Every room module requires a stable moduleId.', { kind: 'STABLE_ID_REQUIRED' });
    if (moduleIds.has(module.moduleId)) throw forgeApiError(`Duplicate moduleId "${module.moduleId}".`, { code: -32010, kind: 'ID_CONFLICT' });
    moduleIds.add(module.moduleId);
    const materialIds = new Set();
    for (const material of Array.isArray(module.materials) ? module.materials : Object.values(module.materials || {})) {
      const id = requireStableId(material, 'material');
      if (materialIds.has(id)) throw forgeApiError(`Duplicate material id "${id}" in ${module.moduleId}.`, { code: -32010, kind: 'ID_CONFLICT' });
      materialIds.add(id);
    }
  }
  for (const room of project.rooms) {
    if (!moduleIds.has(room.moduleId)) throw forgeApiError(`Room "${room.id}" references missing module "${room.moduleId}".`, { kind: 'BROKEN_REFERENCE' });
  }
  const roomIds = new Set(project.rooms.map(({ id }) => id));
  for (const entity of project.entities) {
    if (entity.roomId && !roomIds.has(entity.roomId)) throw forgeApiError(`Entity "${entity.id}" references missing room "${entity.roomId}".`, { kind: 'BROKEN_REFERENCE' });
  }
  for (const connection of project.connections) {
    for (const endpoint of [connection.from, connection.to]) {
      if (!endpoint?.roomId || !endpoint?.socketId || !roomIds.has(endpoint.roomId)) throw forgeApiError(`Connection "${connection.id}" has an invalid endpoint.`, { kind: 'BROKEN_REFERENCE' });
      const room = project.rooms.find(({ id }) => id === endpoint.roomId);
      const module = project.roomModules.find(({ moduleId }) => moduleId === room?.moduleId);
      if (![...(room?.sockets || []), ...(module?.sockets || [])].some(({ id }) => id === endpoint.socketId)) {
        throw forgeApiError(`Connection "${connection.id}" references missing socket "${endpoint.socketId}".`, { kind: 'BROKEN_REFERENCE' });
      }
    }
  }
}

function applyForgeTypedOperation(project, rawOperation, stagedAssets) {
  if (!rawOperation || typeof rawOperation !== 'object' || Array.isArray(rawOperation)) throw forgeApiError('Every operation must be an object.');
  const operation = clone(rawOperation);
  operation.type = operation.type ?? operation.op ?? operation.method;
  if (!FORGE_TYPED_OPERATION_SET.has(operation.type)) throw forgeApiError(`Unsupported typed operation "${operation.type || ''}".`, { code: -32601, kind: 'METHOD_NOT_FOUND' });
  if ('patch' in operation || 'script' in operation || 'eval' in operation || 'code' in operation) {
    throw forgeApiError(`${operation.type} accepts typed records and changes only; executable code and arbitrary patches are forbidden.`, { kind: 'UNSAFE_OPERATION' });
  }
  assertForgeJson(operation, `operations.${operation.type}`);
  const [kind, action] = operation.type.split('.');

  if (action === 'add') {
    const record = forgeOperationRecord(operation, kind);
    const id = requireStableId(record, kind);
    assertForgeIdAvailable(project, kind, id);
    if (kind === 'room') {
      if (!record.moduleId || typeof record.moduleId !== 'string') throw forgeApiError('room.add requires room.moduleId.', { kind: 'STABLE_ID_REQUIRED' });
      let module = project.roomModules.find((candidate) => candidate.moduleId === record.moduleId);
      const suppliedModule = operation.module;
      if (!module && !suppliedModule) throw forgeApiError('room.add requires a module record when moduleId is not already present.', { kind: 'TARGET_NOT_FOUND' });
      if (!module) {
        assertForgeJson(suppliedModule, 'room.add.module');
        module = clone(suppliedModule);
        if (module.moduleId !== record.moduleId) throw forgeApiError('room.add module.moduleId must match room.moduleId.');
        project.roomModules.push(module);
      }
      project.rooms.push(record);
    } else if (kind === 'primitive') {
      const { module } = projectModule(project, operation);
      const collection = operation.collection === 'models' || ['model', 'gltf-model'].includes(record.kind) || record.type === 'gltf-model' ? (module.models ||= []) : (module.primitives ||= []);
      collection.push(record);
      touchForgeModule(module);
    } else if (kind === 'socket') {
      const { module } = projectModule(project, operation);
      (module.sockets ||= []).push(record);
      touchForgeModule(module);
    } else if (kind === 'connection') project.connections.push(record);
    else if (kind === 'entity') project.entities.push(record);
    else if (kind === 'material') {
      const { module } = projectModule(project, operation);
      if (!Array.isArray(module.materials)) module.materials = Object.values(module.materials || {});
      if (module.materials.some((candidate) => candidate.id === id)) throw forgeApiError(`material id "${id}" already exists in ${module.moduleId}.`, { code: -32010, kind: 'ID_CONFLICT' });
      module.materials.push(record);
    } else if (kind === 'asset') {
      const blob = decodeForgeAsset(record);
      delete record.contentBase64; delete record.base64; delete record.data;
      if (!record.hash || typeof record.hash !== 'string') throw forgeApiError('asset.add requires a content hash.', { kind: 'STABLE_ID_REQUIRED' });
      project.assets.push(record);
      if (blob) stagedAssets.push({ blob, record });
    }
    return;
  }

  const id = typeof operation.id === 'string' ? operation.id : operation[`${kind}Id`];
  if (!id) throw forgeApiError(`${operation.type} requires id.`);
  const descriptor = findForgeRecord(project, kind, id);
  if (!descriptor) throw forgeApiError(`${kind} "${id}" was not found.`, { kind: 'TARGET_NOT_FOUND', data: { kind, id } });
  if (action === 'update') {
    mergeForgeChanges(descriptor.record, forgeOperationChanges(operation), FORGE_IMMUTABLE_KEYS[kind], `${operation.type}.${id}`);
    if (['primitive', 'socket'].includes(kind)) touchForgeModule(descriptor.module);
    return;
  }
  if (kind === 'room') {
    project.rooms = project.rooms.filter((candidate) => candidate !== descriptor.record);
    project.entities = project.entities.filter((entity) => entity.roomId !== id);
    project.connections = project.connections.filter((connection) => connection.from?.roomId !== id && connection.to?.roomId !== id);
    if (!project.rooms.some((room) => room.moduleId === descriptor.record.moduleId)) project.roomModules = project.roomModules.filter((module) => module.moduleId !== descriptor.record.moduleId);
  } else if (kind === 'connection') project.connections = project.connections.filter((candidate) => candidate !== descriptor.record);
  else if (kind === 'entity') {
    project.entities = project.entities.filter((candidate) => candidate !== descriptor.record);
    if (project.settings?.spawnId === id) project.settings.spawnId = null;
  } else if (kind === 'asset') project.assets = project.assets.filter((candidate) => candidate !== descriptor.record);
  else {
    deleteFromCollection(descriptor.collection, descriptor.record);
    if (kind === 'socket') project.connections = project.connections.filter((connection) => connection.from?.socketId !== id && connection.to?.socketId !== id);
    if (['primitive', 'socket'].includes(kind)) touchForgeModule(descriptor.module);
  }
}

function assertForgeBaseRevision(baseRevision) {
  if (!Number.isInteger(Number(baseRevision))) throw forgeApiError('A numeric baseRevision is required for mutations.', { kind: 'BASE_REVISION_REQUIRED' });
  const expected = Number(baseRevision);
  const actual = Number(state.project.revision) || 0;
  if (expected !== actual) {
    throw forgeApiError(`Revision conflict: expected ${expected}, editor is at ${actual}.`, {
      code: -32009,
      kind: 'REVISION_CONFLICT',
      data: { projectId: state.project.projectId, baseRevision: expected, currentRevision: actual },
    });
  }
  return actual;
}

async function persistForgeAssets(stagedAssets) {
  if (!stagedAssets.length) return;
  if (typeof state.coreStore?.putAsset !== 'function') throw forgeApiError('IndexedDB asset persistence is unavailable.', { code: -32012, kind: 'PERSISTENCE_UNAVAILABLE' });
  const validationFiles = stagedAssets.map(({ blob, record }) => {
    const relativePath = String(record.relativePath || record.name || record.id || 'asset.bin').replace(/\\/g, '/');
    const name = relativePath.split('/').pop() || 'asset.bin';
    const file = new File([blob], name, { type: record.mimeType || blob.type || 'application/octet-stream' });
    if (relativePath !== name) Object.defineProperty(file, 'webkitRelativePath', { configurable: true, value: relativePath });
    return file;
  });
  for (let index = 0; index < stagedAssets.length; index += 1) {
    const expected = String(stagedAssets[index].record.hash ?? '').replace(/^sha256:/i, '').toLowerCase();
    const actual = String(await hashFile(validationFiles[index])).replace(/^sha256:/i, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected) || actual !== expected) {
      throw forgeApiError(`Generated asset hash mismatch for ${stagedAssets[index].record.name || stagedAssets[index].record.id || 'asset'}.`, { code: -32012, kind: 'ASSET_INVALID' });
    }
  }
  try { await validateAssetBatch(validationFiles); }
  catch (error) { throw forgeApiError(`Generated asset validation failed: ${error.message}`, { code: -32012, kind: 'ASSET_INVALID' }); }
  for (const { blob, record } of stagedAssets) {
    await state.coreStore.putAsset(blob, { hash: record.hash, name: record.name, mimeType: record.mimeType, metadata: { relativePath: record.relativePath || record.name } });
  }
}

function setForgeApplying(applying) {
  state.forgeControl.applying = Boolean(applying);
  const shell = $('#editor-shell');
  shell.classList.toggle('codex-applying', state.forgeControl.applying);
  shell.setAttribute('aria-busy', String(state.forgeControl.applying));
  renderForgeSession();
}

async function executeForgeOperations(operations, { baseRevision, label = 'Codex edit' } = {}) {
  if (!Array.isArray(operations) || !operations.length) throw forgeApiError('params.operations must be a non-empty array.');
  const revision = assertForgeBaseRevision(baseRevision);
  const before = snapshot();
  const working = clone(state.project);
  const stagedAssets = [];
  setForgeApplying(true);
  try {
    for (const operation of operations) applyForgeTypedOperation(working, operation, stagedAssets);
    validateForgeProjectIds(working);
    await persistForgeAssets(stagedAssets);
    assertForgeBaseRevision(revision);
    resetConnectionWorkflow();
    state.project = working;
    state.activeRoomId = state.project.rooms.some(({ id }) => id === state.activeRoomId) ? state.activeRoomId : state.project.rooms[0]?.id || null;
    validSelectedIds();
    pushUndo(before);
    state.redo.length = 0;
    markDirty(label, { source: 'codex' });
    rebuildEditor();
    await saveProject({ silent: true });
    return { ok: true, projectId: state.project.projectId, baseRevision: revision, revision: state.project.revision, operationCount: operations.length, project: clone(state.project) };
  } finally {
    setForgeApplying(false);
  }
}

function forgeBundleAssetBlob(asset) {
  if (asset instanceof Blob) return asset;
  if (asset?.blob instanceof Blob) return asset.blob;
  if (asset?.bytes instanceof Uint8Array || Array.isArray(asset?.bytes)) return new Blob([new Uint8Array(asset.bytes)], { type: asset.mimeType || 'application/octet-stream' });
  return decodeForgeAsset(asset || {});
}

async function replaceForgeProject(projectOrBundle, options = {}) {
  const baseRevision = assertForgeBaseRevision(options.baseRevision ?? options.expectedRevision);
  let incoming;
  let assets = [];
  if (projectOrBundle instanceof Blob) {
    const file = projectOrBundle instanceof File ? projectOrBundle : new File([projectOrBundle], options.name || 'codex-project.json', { type: projectOrBundle.type });
    incoming = await parseProjectFile(file);
  } else {
    const bundle = projectOrBundle?.project && typeof projectOrBundle.project === 'object' ? projectOrBundle : null;
    incoming = bundle?.project ?? projectOrBundle;
    assets = Array.isArray(bundle?.assets) ? bundle.assets : [];
  }
  assertForgeJson(incoming, 'project');
  const normalized = normalizeProject(clone(incoming));
  validateForgeProjectIds(normalized);
  const stagedAssets = [];
  for (const asset of assets) {
    const blob = forgeBundleAssetBlob(asset);
    if (!blob) continue;
    const record = asset.record || asset;
    if (!record.hash) throw forgeApiError('Bundled assets require a content hash.', { kind: 'STABLE_ID_REQUIRED' });
    stagedAssets.push({ blob, record });
  }
  setForgeApplying(true);
  try {
    await persistForgeAssets(stagedAssets);
    assertForgeBaseRevision(baseRevision);
    const before = snapshot();
    resetConnectionWorkflow();
    normalized.revision = baseRevision;
    state.project = normalized;
    state.activeRoomId = normalized.rooms[0]?.id || null;
    clearSelection();
    pushUndo(before);
    state.redo.length = 0;
    markDirty(options.label || 'Codex replaced project', { source: 'codex' });
    $('#project-name').value = state.project.name;
    renderPalette();
    rebuildEditor();
    frameAll();
    await saveProject({ silent: true });
    return clone(state.project);
  } finally {
    setForgeApplying(false);
  }
}

async function forgePreflight() {
  const validation = await validateProject({ notify: false });
  return {
    signature: FORGE_BROWSER_SIGNATURE,
    ok: validation.valid,
    projectId: state.project.projectId,
    revision: state.project.revision,
    project: clone(state.project),
    assets: clone(state.project.assets),
    selection: { activeRoomId: state.activeRoomId, selectedIds: [...validSelectedIds()] },
    validation: clone(validation),
    session: { active: state.forgeControl.active, paused: state.forgeControl.paused, status: state.forgeControl.status, sessionId: state.forgeControl.sessionId },
    probes: {
      core: !Core.__loadError,
      runtime: !Runtime.__loadError,
      indexedDB: Boolean(state.coreStore && globalThis.indexedDB),
      webgl: Boolean(sceneState.renderer),
      sameOriginControl: location.protocol === 'http:' || location.protocol === 'https:',
    },
    capabilities: { typedOperations: [...FORGE_TYPED_OPERATIONS], arbitraryPatch: false, script: false, eval: false, atomicUndo: true, indexedDB: Boolean(state.coreStore) },
  };
}

async function forgeLoadProject(projectId) {
  if (!projectId || typeof projectId !== 'string') throw forgeApiError('loadProject requires projectId.');
  const loaded = await loadSavedProject(projectId, { source: 'codex', notify: false });
  if (!loaded) throw forgeApiError(`Project "${projectId}" was not found.`, { kind: 'TARGET_NOT_FOUND' });
  return loaded;
}

function forgeFocus(id = null) {
  if (id != null) {
    if (!findRecord(id)) throw forgeApiError(`Object "${id}" was not found.`, { kind: 'TARGET_NOT_FOUND' });
    selectItem(id);
  }
  if (state.selectedId) frameSelection(); else frameAll();
  $('#viewport').focus();
  return { focused: state.selectedId || null };
}

async function forgeCapturePreview({ view = 'perspective' } = {}) {
  if (!sceneState.renderer || !sceneState.camera || !sceneState.scene) throw forgeApiError('The WebGL preview renderer is unavailable.', { code: -32030, kind: 'PREVIEW_UNAVAILABLE' });
  if (!['perspective', 'top-down', 'top'].includes(view)) throw forgeApiError('preview.capture view must be "perspective" or "top-down".');
  const camera = sceneState.camera;
  const renderer = sceneState.renderer;
  const scene = sceneState.scene;
  const topDown = view === 'top-down' || view === 'top';
  const saved = {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    up: camera.up.clone(),
    target: sceneState.controls.target.clone(),
    near: camera.near,
    far: camera.far,
    fog: scene.fog,
    background: scene.background,
    exposure: renderer.toneMappingExposure,
  };
  let captureLight = null;
  let framing = null;
  try {
    if (topDown) {
      const box = new THREE.Box3().setFromObject(sceneState.content);
      const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
      const size = box.isEmpty() ? new THREE.Vector3(10, 4, 10) : box.getSize(new THREE.Vector3());
      const padding = 1.18;
      const verticalTangent = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const horizontalTangent = verticalTangent * Math.max(camera.aspect, 0.01);
      const distanceForWidth = (Math.max(size.x, 1) * 0.5 * padding) / horizontalTangent;
      const distanceForDepth = (Math.max(size.z, 1) * 0.5 * padding) / verticalTangent;
      const distance = Math.max(12, distanceForWidth, distanceForDepth) + Math.max(2, size.y * 0.6);
      camera.up.set(0, 0, -1);
      camera.position.set(center.x, center.y + distance, center.z + 0.001);
      camera.far = Math.max(saved.far, distance + size.y + 100);
      camera.updateProjectionMatrix();
      camera.lookAt(center);
      // Long framing distances otherwise drive FogExp2 almost completely to
      // the editor's black fog color. Capture lighting is isolated and removed
      // below so visibility never depends on the user's lighting toggle.
      scene.fog = null;
      scene.background = new THREE.Color(0x11171b);
      renderer.toneMappingExposure = Math.max(saved.exposure, 1.15);
      captureLight = new THREE.HemisphereLight(0xf4fbff, 0x53616b, 1.8);
      scene.add(captureLight);
      framing = { center: vector(center), size: vector(size), padding, distance };
    } else frameAll();
    camera.updateMatrixWorld(true);
    renderer.render(scene, camera);
    const canvas = renderer.domElement;
    return { ok: true, view: view === 'top' ? 'top-down' : view, revision: state.project.revision, mimeType: 'image/png', width: canvas.width, height: canvas.height, framing, dataUrl: canvas.toDataURL('image/png') };
  } finally {
    if (captureLight) scene.remove(captureLight);
    scene.fog = saved.fog;
    scene.background = saved.background;
    renderer.toneMappingExposure = saved.exposure;
    camera.position.copy(saved.position);
    camera.quaternion.copy(saved.quaternion);
    camera.up.copy(saved.up);
    camera.near = saved.near;
    camera.far = saved.far;
    camera.updateProjectionMatrix();
    sceneState.controls.target.copy(saved.target);
    camera.updateMatrixWorld(true);
    renderer.render(scene, camera);
  }
}

async function forgeFinalize({ baseRevision, playtest = true, timeoutMs = 30_000 } = {}) {
  if (baseRevision !== undefined) assertForgeBaseRevision(baseRevision);
  const preflight = await forgePreflight();
  if (!preflight.ok || !preflight.probes.core || !preflight.probes.runtime || !preflight.probes.indexedDB || !preflight.probes.webgl) {
    throw forgeApiError('Project finalization gates did not pass.', { code: -32031, kind: 'FINALIZE_GATE_FAILED', data: { validation: preflight.validation, probes: preflight.probes } });
  }
  if (!await saveProject({ silent: true })) throw forgeApiError('The final project could not be persisted.', { code: -32012, kind: 'PERSISTENCE_FAILED' });
  if (!playtest) return { ok: true, revision: state.project.revision, persisted: true, playtest: { skipped: true } };
  await startPlaytest();
  const deadline = performance.now() + Math.min(60_000, Math.max(1_000, Number(timeoutMs) || 30_000));
  while (performance.now() < deadline) {
    const status = $('#playtest-status').textContent;
    if (state.playing && !state.pendingPlaytest && status.startsWith('Runtime active')) {
      const result = { ok: true, revision: state.project.revision, persisted: true, playtest: { ok: true, status } };
      stopPlaytest();
      return result;
    }
    if (/runtime error|compile failed/i.test(status) || !state.playing) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (state.playing) stopPlaytest();
  throw forgeApiError('The real playtest iframe did not acknowledge a successful smoke test.', { code: -32031, kind: 'PLAYTEST_GATE_FAILED', data: { status: $('#playtest-status').textContent } });
}

async function forgeOpenProject({ projectId, id } = {}) {
  if (projectId && projectId !== state.project.projectId) await forgeLoadProject(projectId);
  if (id !== undefined) forgeFocus(id);
  return forgePreflight();
}

function rpcResult(id, result) { return id === undefined ? null : { jsonrpc: '2.0', id, result }; }
function rpcFailure(id, error) {
  return id === undefined ? null : {
    jsonrpc: '2.0',
    id,
    error: { code: error.rpcCode ?? -32603, message: error.message || 'Internal editor error.', data: { kind: error.kind || 'INTERNAL_ERROR', ...(error.data || {}) } },
  };
}

async function executeForgeRpc(request, { control = false } = {}) {
  const id = request?.id;
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      throw forgeApiError('Invalid JSON-RPC 2.0 request.', { code: -32600, kind: 'INVALID_REQUEST' });
    }
    if (control && state.forgeControl.paused) throw forgeApiError('Codex control is paused because the project was edited manually.', { code: -32011, kind: 'SESSION_PAUSED', data: { revision: state.project.revision } });
    const params = request.params ?? {};
    assertForgeJson(params, 'params');
    const method = request.method.replace(/^levelForge\./, '');
    let result;
    if (FORGE_TYPED_OPERATION_SET.has(method)) {
      const operation = { ...clone(params.operation || params), type: method };
      delete operation.baseRevision; delete operation.label;
      result = await executeForgeOperations([operation], { baseRevision: params.baseRevision ?? request.baseRevision, label: params.label || `Codex ${method}` });
    } else if (['batch', 'execute', 'applyOperations', 'project.applyOperations', 'operations.apply'].includes(method)) {
      result = await executeForgeOperations(params.operations ?? params.batch, { baseRevision: params.baseRevision ?? request.baseRevision, label: params.label });
    } else if (['preflight', 'project.get'].includes(method)) result = await forgePreflight();
    else if (['replaceProject', 'project.replace'].includes(method)) result = await replaceForgeProject(params.projectOrBundle ?? params.bundle ?? params.project, params.options ? { ...params.options, baseRevision: params.options.baseRevision ?? params.baseRevision } : params);
    else if (['loadProject', 'project.load'].includes(method)) result = await forgeLoadProject(params.projectId ?? params.id);
    else if (method === 'project.open') result = await forgeOpenProject(params);
    else if (['focus', 'project.focus'].includes(method)) result = forgeFocus(params.id ?? null);
    else if (method === 'preview.capture') result = await forgeCapturePreview(params);
    else if (method === 'project.finalize') result = await forgeFinalize(params);
    else throw forgeApiError(`Method "${request.method}" is not allowed.`, { code: -32601, kind: 'METHOD_NOT_FOUND' });
    return rpcResult(id, result);
  } catch (error) {
    console.warn('Level Forge RPC rejected.', error);
    return rpcFailure(id, error);
  }
}

async function forgeControlFetch(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${FORGE_CONTROL_PREFIX}${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  if (response.status !== 204) {
    const text = await response.text();
    if (text) {
      try { payload = JSON.parse(text); }
      catch { throw forgeApiError('The Level Forge control service returned malformed JSON.', { code: -32020, kind: 'CONTROL_PROTOCOL_ERROR' }); }
    }
  }
  if (!response.ok || payload?.ok === false) {
    const error = forgeApiError(payload?.error?.message || payload?.message || `Level Forge control request failed (${response.status}).`, { code: -32020, kind: payload?.error?.kind || 'CONTROL_REQUEST_FAILED', data: { status: response.status } });
    error.httpStatus = response.status;
    throw error;
  }
  return payload || { ok: true };
}

async function requireForgeControlService() {
  const health = await forgeControlFetch('/health');
  const signature = health.signature ?? health.service?.signature ?? health.schema;
  if (signature !== FORGE_CONTROL_SIGNATURE) throw forgeApiError('The same-origin service is not a trusted Level Forge control endpoint.', { code: -32020, kind: 'CONTROL_SIGNATURE_MISMATCH' });
  return health;
}

function renderForgeSession() {
  const bar = $('#codex-session-bar');
  if (!bar) return;
  bar.hidden = !state.forgeControl.active;
  const status = $('#codex-session-status');
  const detail = $('#codex-session-detail');
  const resume = $('[data-action="resume-codex"]', bar);
  bar.classList.toggle('paused', state.forgeControl.paused);
  bar.classList.toggle('applying', state.forgeControl.applying);
  if (state.forgeControl.applying) {
    status.textContent = 'Codex is applying an atomic edit';
    detail.textContent = `Project revision ${state.project.revision}`;
  } else if (state.forgeControl.paused) {
    status.textContent = 'Codex paused after your edit';
    detail.textContent = `Manual revision ${state.project.revision} is protected from stale commands.`;
  } else {
    status.textContent = 'Shared with Codex';
    detail.textContent = `Project revision ${state.project.revision} · changes save locally`;
  }
  resume.hidden = !state.forgeControl.paused;
}

function beginForgeControlSession(session = {}) {
  clearTimeout(state.forgeControl.pollTimer);
  state.forgeControl.active = true;
  state.forgeControl.sessionId = session.sessionId ?? session.id ?? state.forgeControl.sessionId;
  state.forgeControl.status = session.status || 'active';
  state.forgeControl.paused = ['paused', 'manual'].includes(state.forgeControl.status);
  state.forgeControl.commandResponses.clear();
  renderForgeSession();
  scheduleForgePoll(0);
}

async function finishForgeControlSession(status = 'complete') {
  clearTimeout(state.forgeControl.pollTimer);
  state.forgeControl.pollTimer = 0;
  state.forgeControl.polling = false;
  state.forgeControl.status = status;
  state.forgeControl.active = false;
  state.forgeControl.paused = false;
  state.forgeControl.sessionId = null;
  state.forgeControl.commandResponses.clear();
  setForgeApplying(false);
  renderForgeSession();
  await saveProject({ silent: true });
}

function scheduleForgePoll(delay = FORGE_POLL_INTERVAL_MS) {
  clearTimeout(state.forgeControl.pollTimer);
  if (!state.forgeControl.active) return;
  state.forgeControl.pollTimer = setTimeout(pollForgeControl, delay);
}

function forgePendingCommands(payload) {
  const values = payload?.commands ?? payload?.pendingCommands ?? payload?.pendingCommand ?? payload?.command ?? payload?.request ?? payload?.rpc;
  if (!values) return [];
  return Array.isArray(values) ? values : [values];
}

function forgeCommandRequest(command) {
  return command?.request ?? command?.rpc ?? command?.jsonRpcRequest ?? command?.command ?? (command?.method ? command : null);
}

async function acknowledgeForgeCommand(commandId, response) {
  const payload = { commandId, response, revision: state.project.revision };
  try { return await forgeControlFetch('/browser/ack', { method: 'POST', body: payload }); }
  catch (error) {
    if (error.httpStatus !== 404 && error.httpStatus !== 405) throw error;
    return forgeControlFetch('/rpc', { method: 'POST', body: { type: 'browser.ack', ...payload } });
  }
}

async function handleForgeCommand(command) {
  const request = forgeCommandRequest(command);
  const commandId = String(command?.commandId ?? command?.id ?? request?.id ?? '');
  if (!commandId || !request) return;
  let response = state.forgeControl.commandResponses.get(commandId);
  if (!response) {
    response = await executeForgeRpc(request, { control: true });
    state.forgeControl.commandResponses.set(commandId, response);
    if (state.forgeControl.commandResponses.size > 100) state.forgeControl.commandResponses.delete(state.forgeControl.commandResponses.keys().next().value);
  }
  await acknowledgeForgeCommand(commandId, response);
}

async function pollForgeControl() {
  if (!state.forgeControl.active || state.forgeControl.polling) return;
  state.forgeControl.polling = true;
  try {
    const payload = await forgeControlFetch('/session');
    const session = payload.session || {};
    state.forgeControl.sessionId = session.sessionId ?? session.id ?? state.forgeControl.sessionId;
    state.forgeControl.status = session.status ?? payload.status ?? state.forgeControl.status;
    if (['paused', 'manual'].includes(state.forgeControl.status)) state.forgeControl.paused = true;
    renderForgeSession();
    for (const command of forgePendingCommands(payload)) await handleForgeCommand(command);
    if (['complete', 'completed', 'closed', 'cancelled', 'failed'].includes(state.forgeControl.status)) {
      await finishForgeControlSession(state.forgeControl.status);
      return;
    }
  } catch (error) {
    console.warn('Level Forge control poll failed; retrying.', error);
  } finally {
    state.forgeControl.polling = false;
  }
  scheduleForgePoll();
}

async function sendManualForgeRevision() {
  state.forgeControl.manualTimer = 0;
  if (!state.forgeControl.active) return;
  const baseRevision = state.forgeControl.manualBaseRevision;
  state.forgeControl.manualBaseRevision = null;
  try {
    await forgeControlFetch('/browser/manual', {
      method: 'POST',
      body: { project: clone(state.project), assets: clone(state.project.assets), baseRevision, revision: state.project.revision },
    });
  } catch (error) { console.warn('Could not report the protected manual revision to Codex.', error); }
}

function noteManualForgeEdit(baseRevision, { previousProjectId = state.project.projectId } = {}) {
  if (!state.forgeControl?.active) return;
  state.forgeControl.paused = true;
  state.forgeControl.status = 'manual';
  state.forgeControl.manualBaseRevision ??= baseRevision;
  clearTimeout(state.forgeControl.manualTimer);
  state.forgeControl.manualTimer = setTimeout(sendManualForgeRevision, 0);
  renderForgeSession();
  if (previousProjectId !== state.project.projectId) toast('Codex paused', 'You opened another project; sharing will not overwrite it.', 'warning');
}

async function resumeForgeControl() {
  if (!state.forgeControl.active) return;
  try {
    await forgeControlFetch('/browser/manual', {
      method: 'POST',
      body: { project: clone(state.project), assets: clone(state.project.assets), baseRevision: state.project.revision, revision: state.project.revision, resume: true },
    });
    state.forgeControl.paused = false;
    state.forgeControl.status = 'active';
    renderForgeSession();
    scheduleForgePoll(0);
  } catch (error) { toast('Could not resume Codex', error.message, 'error', 6000); }
}

function readForgeTicketFromFragment() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const ticket = params.get('levelForgeTicket') || params.get('forgeSession');
  return ticket || null;
}

async function claimForgeTicket(ticket) {
  try {
    await requireForgeControlService();
    const payload = await forgeControlFetch('/session/claim', { method: 'POST', body: { ticket } });
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    beginForgeControlSession(payload.session || payload);
  } catch (error) {
    toast('Could not connect Codex', error.message, 'error', 7000);
  }
}

async function showCodexShareDialog() {
  await saveProject({ silent: true });
  const projects = await listSavedProjects();
  if (!projects.some(({ projectId }) => projectId === state.project.projectId)) projects.unshift(clone(state.project));
  const picker = $('#codex-project-list');
  picker.innerHTML = projects.map((project) => `<label class="project-card codex-project-card"><input type="radio" name="codex-project" value="${escapeHTML(project.projectId)}" ${project.projectId === state.project.projectId ? 'checked' : ''}/><span class="project-card-icon">${ICONS.room}</span><span><strong>${escapeHTML(project.name || 'Untitled')}</strong><small>${project.rooms?.length || 0} rooms · revision ${project.revision || 0}</small></span><time>${new Date(project.updatedAt || 0).toLocaleDateString()}</time></label>`).join('');
  $('#codex-consent').checked = false;
  $('#codex-share-confirm').disabled = true;
  $('#codex-share-dialog').showModal();
}

function forgeBytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function hydrateForgeAssetsForConsent() {
  const hydrated = [];
  let totalBytes = 0;
  for (const asset of state.project.assets) {
    const blob = typeof state.coreStore?.getAsset === 'function' ? await state.coreStore.getAsset(asset.hash) : null;
    if (!blob) throw forgeApiError(`Local asset bytes are missing for "${asset.name || asset.id}".`, { code: -32012, kind: 'ASSET_BYTES_MISSING' });
    if (blob.size > FORGE_MAX_ASSET_BYTES || totalBytes + blob.size > FORGE_MAX_BUNDLE_BYTES) {
      throw forgeApiError('The selected project assets exceed the 32 MiB per-file or 64 MiB consent bundle limit.', { code: -32012, kind: 'ASSET_BUNDLE_TOO_LARGE' });
    }
    totalBytes += blob.size;
    hydrated.push({ ...clone(asset), size: blob.size, mimeType: asset.mimeType || blob.type, contentBase64: forgeBytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
  }
  return hydrated;
}

async function shareProjectWithCodex() {
  const consent = $('#codex-consent');
  const projectId = $('input[name="codex-project"]:checked', $('#codex-project-list'))?.value;
  if (!consent.checked || !projectId) return;
  const confirm = $('#codex-share-confirm');
  confirm.disabled = true;
  confirm.textContent = 'Connecting…';
  try {
    if (projectId !== state.project.projectId) await forgeLoadProject(projectId);
    await saveProject({ silent: true });
    await requireForgeControlService();
    const assets = await hydrateForgeAssetsForConsent();
    const payload = await forgeControlFetch('/session/share', {
      method: 'POST',
      body: { project: clone(state.project), assets, consent: true },
    });
    beginForgeControlSession(payload.session || payload);
    $('#codex-share-dialog').close();
    toast('Project shared with Codex', 'Manual edits remain authoritative and pause the session automatically.');
  } catch (error) {
    toast('Could not share with Codex', error.message, 'error', 7000);
  } finally {
    confirm.textContent = 'Share project';
    confirm.disabled = !consent.checked;
  }
}

async function initializeForgeBrowserIntegration() {
  const requestedProjectId = new URLSearchParams(location.search).get('project');
  if (requestedProjectId) await loadSavedProject(requestedProjectId, { source: 'codex', notify: false });
  const ticket = readForgeTicketFromFragment();
  if (ticket) await claimForgeTicket(ticket);
  return { signature: FORGE_BROWSER_SIGNATURE, projectId: state.project.projectId, revision: state.project.revision };
}

function wireEvents() {
  $$('.mode-option').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $$('.palette-tabs button').forEach((button) => button.addEventListener('click', () => {
    state.paletteTab = button.dataset.paletteTab;
    $$('.palette-tabs button').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
    renderPalette();
  }));
  $('#palette-search').addEventListener('input', renderPalette);
  $('#outliner-search').addEventListener('input', renderOutliner);
  $('#project-name').addEventListener('change', (event) => commit('Renamed project', () => { state.project.name = event.target.value.trim() || 'Untitled Expedition'; }, { rebuild: false }));
  $('#project-name').addEventListener('keydown', (event) => { if (event.key === 'Enter') event.target.blur(); });
  $('#placement-snap-target').addEventListener('change', (event) => setSnapTarget(event.target.value, { notify: true }));

  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) {
      if (!event.target.closest('.menu-wrap')) $('#file-menu').hidden = true;
      return;
    }
    const handlers = {
      undo,
      redo,
      'new-project': () => {
        resetConnectionWorkflow(); state.project = createProject(); state.activeRoomId = state.project.rooms[0]?.id; clearSelection(); state.undo.length = 0; state.redo.length = 0; state.mode = 'room'; markDirty('New project'); renderPalette(); rebuildEditor(); frameAll(); $('#file-menu').hidden = true;
      },
      'open-project': showProjectDialog,
      'save-project': () => saveProject(),
      'share-codex': showCodexShareDialog,
      'confirm-share-codex': shareProjectWithCodex,
      'resume-codex': resumeForgeControl,
      'stop-sharing-codex': () => finishForgeControlSession('closed'),
      'file-menu': () => { $('#file-menu').hidden = !$('#file-menu').hidden; },
      'import-project': () => { $('#project-file-input').click(); $('#file-menu').hidden = true; },
      'export-project': () => { exportProject(); $('#file-menu').hidden = true; },
      'export-room-json': () => { exportRoomJson(); $('#file-menu').hidden = true; },
      'export-dungeon-json': () => { exportDungeonJson(); $('#file-menu').hidden = true; },
      'export-project-module': () => { exportProjectModule(); $('#file-menu').hidden = true; },
      'export-project-zip': () => { exportProjectZip(); $('#file-menu').hidden = true; },
      validate: () => validateProject({ notify: true }),
      playtest: () => startPlaytest(),
      'reload-playtest': () => startPlaytest({ restart: true }),
      'stop-playtest': () => stopPlaytest(),
      duplicate: duplicateSelection,
      delete: deleteSelection,
      'generate-model-collider': generateSelectedModelCollider,
      'toggle-transform-space': toggleTransformSpace,
      'frame-selection': frameSelection,
      'clear-search': () => { $('#palette-search').value = ''; renderPalette(); },
      'quick-room': quickRoom,
      'upload-texture': () => $('#texture-file-input').click(),
      'upload-model': () => $('#model-file-input').click(),
      'upload-assets': () => $('#asset-file-input').click(),
      'toggle-snap': toggleSnap,
      'snap-menu': cycleSnapIncrement,
      'toggle-grid': () => {
        state.gridVisible = !state.gridVisible; if (sceneState.grid) sceneState.grid.visible = state.gridVisible; event.target.closest('button').querySelector('.status-toggle').classList.toggle('on', state.gridVisible);
      },
      'toggle-lighting': () => {
        state.lightingEnabled = !state.lightingEnabled; if (sceneState.lights) sceneState.lights.visible = state.lightingEnabled; event.target.closest('button').querySelector('.status-toggle').classList.toggle('on', state.lightingEnabled);
      },
      'toggle-validation': () => {
        const summary = $('.validation-summary'); const expanded = summary.getAttribute('aria-expanded') === 'true'; summary.setAttribute('aria-expanded', String(!expanded)); $('#validation-list').hidden = expanded;
      },
      shortcuts: () => $('#shortcuts-dialog').showModal(),
      'collapse-palette': () => toast('Compact palette', 'Use the library search and category tabs to narrow pieces.', 'success'),
      home: () => showProjectDialog(),
    };
    handlers[action]?.();
  });

  $$('[data-tool]').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool)));
  $('#project-file-input').addEventListener('change', (event) => { importProjectFile(event.target.files[0]); event.target.value = ''; });
  $('#texture-file-input').addEventListener('change', (event) => { importAssets(event.target.files); event.target.value = ''; });
  $('#model-file-input').addEventListener('change', (event) => { importAssets(event.target.files); event.target.value = ''; });
  $('#asset-file-input').addEventListener('change', (event) => { importAssets(event.target.files); event.target.value = ''; });
  $('#codex-consent').addEventListener('change', (event) => { $('#codex-share-confirm').disabled = !event.target.checked || !$('input[name="codex-project"]:checked', $('#codex-project-list')); });
  $('#codex-project-list').addEventListener('change', () => { $('#codex-share-confirm').disabled = !$('#codex-consent').checked || !$('input[name="codex-project"]:checked', $('#codex-project-list')); });

  const viewport = $('#viewport');
  viewport.addEventListener('dragenter', (event) => { event.preventDefault(); viewport.classList.add('drag-active'); });
  viewport.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; viewport.classList.add('drag-active'); });
  viewport.addEventListener('dragleave', (event) => { if (!viewport.contains(event.relatedTarget)) viewport.classList.remove('drag-active'); });
  viewport.addEventListener('drop', (event) => {
    event.preventDefault(); viewport.classList.remove('drag-active');
    if (event.dataTransfer.files?.length) { importAssets(event.dataTransfer.files); return; }
    const assetId = event.dataTransfer.getData('application/x-ruindiver-asset');
    if (assetId) {
      const asset = state.project.assets.find((candidate) => candidate.id === assetId);
      const source = asset?.kind === 'model' ? { kind: 'model', type: 'gltf-model', size: [2, 2, 2] } : {};
      return placeAsset(assetId, resolvePlacement(event.clientX, event.clientY, source));
    }
    try {
      const payload = JSON.parse(event.dataTransfer.getData('application/x-ruindiver-piece'));
      if (payload.mode !== state.mode) setMode(payload.mode);
      const item = templateByType(payload.type, payload.mode);
      addPaletteItem(item, resolvePlacement(event.clientX, event.clientY, item));
    } catch { /* ignore unrelated drags */ }
  });
  $('.asset-dock').addEventListener('dragover', (event) => event.preventDefault());
  $('.asset-dock').addEventListener('drop', (event) => { event.preventDefault(); if (event.dataTransfer.files?.length) importAssets(event.dataTransfer.files); });
  window.addEventListener('message', onBridgeMessage);
  window.addEventListener('beforeunload', () => {
    clearTimeout(state.forgeControl.pollTimer);
    clearTimeout(state.forgeControl.manualTimer);
    if (state.dirty) {
      try { localStorage.setItem(`${STORAGE_PREFIX}${state.project.projectId}`, JSON.stringify(state.project)); } catch { /* best effort */ }
    }
    state.objectURLs.forEach((url) => URL.revokeObjectURL(url));
  });
  window.addEventListener('keydown', onKeyDown);
}

function onKeyDown(event) {
  if (state.playing) {
    if (event.key === 'Escape') { event.preventDefault(); stopPlaytest(); }
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;
  if (typing) {
    if (event.key === 'Escape') event.target.blur();
    return;
  }
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  else if ((event.ctrlKey || event.metaKey) && key === 'y') { event.preventDefault(); redo(); }
  else if ((event.ctrlKey || event.metaKey) && key === 'c') { event.preventDefault(); copySelection(); }
  else if ((event.ctrlKey || event.metaKey) && key === 'v') { event.preventDefault(); pasteSelection(); }
  else if ((event.ctrlKey || event.metaKey) && key === 's') { event.preventDefault(); saveProject(); }
  else if ((event.ctrlKey || event.metaKey) && key === 'd') { event.preventDefault(); duplicateSelection(); }
  else if ((event.ctrlKey || event.metaKey) && key === 'e') { event.preventDefault(); exportProject(); }
  else if ((event.ctrlKey || event.metaKey) && key === 'o') { event.preventDefault(); $('#project-file-input').click(); }
  else if ((event.ctrlKey || event.metaKey) && key === 'n') { event.preventDefault(); $('[data-action="new-project"]').click(); }
  else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); }
  else if (event.key === 'F6') { event.preventDefault(); startPlaytest(); }
  else if (key === 'q') setTool('select');
  else if (key === 'w') setTool('translate');
  else if (key === 'e') setTool('rotate');
  else if (key === 'r') setTool('scale');
  else if (key === 'f') frameSelection();
  else if (key === 'x') toggleTransformSpace();
  else if (key === '/') { event.preventDefault(); $('#palette-search').focus(); }
  else if (key === '?') $('#shortcuts-dialog').showModal();
  else if (event.key === 'Escape') { resetConnectionWorkflow(); renderPalette(); selectItem(null); rebuildScene(); }
}

function updateModuleStatus() {
  const status = $('#core-status');
  const coreReady = !Core.__loadError;
  const runtimeReady = !Runtime.__loadError;
  status.className = `core-status ${coreReady ? 'ready' : 'degraded'}`;
  status.innerHTML = `<i></i>${coreReady ? 'Core connected' : 'Editor fallback'}`;
  status.title = `${coreReady ? 'Core API loaded' : Core.__loadError?.message || 'Core unavailable'} · ${runtimeReady ? 'Runtime preview available' : Runtime.__loadError?.message || 'Runtime unavailable'}`;
  if (!coreReady) console.warn('Level editor core was not loaded. Local authoring fallback is active.', Core.__loadError);
  if (!runtimeReady) console.warn('Level editor runtime was not loaded. Iframe playtest may report an unavailable runtime.', Runtime.__loadError);
}

state.coreStore = initializeStore();
wireEvents();
initScene();
updateSnapControls();
renderPalette();
renderAssets();
rebuildEditor();
updateModuleStatus();
validateProject();
setSaveState('Saved locally');
setTimeout(frameAll, 50);

let resolveForgeReady;
const forgeReady = new Promise((resolve) => { resolveForgeReady = resolve; });
const levelForgeApi = {
  ready: forgeReady,
  get project() { return clone(state.project); },
  get placementSnap() { return Object.freeze({ enabled: state.snap, target: state.snap ? state.snapTarget : 'free', increment: state.snapValue }); },
  get core() { return Core; },
  get runtime() { return Runtime; },
  validate: () => validateProject({ notify: true }),
  save: () => saveProject(),
  export: () => exportProject(),
  exportRoomJson,
  exportDungeonJson,
  exportProjectModule,
  exportProjectZip,
  playtest: () => startPlaytest(),
  select: selectItem,
  execute: async (jsonRpcRequest) => { await forgeReady; return executeForgeRpc(jsonRpcRequest); },
  replaceProject: async (projectOrBundle, options) => { await forgeReady; return replaceForgeProject(projectOrBundle, options); },
  preflight: async () => { await forgeReady; return forgePreflight(); },
  loadProject: async (projectId) => { await forgeReady; return forgeLoadProject(projectId); },
  focus: async (id = null) => { await forgeReady; return forgeFocus(id); },
  getConnectionState: () => {
    const model = connectionPanelModel();
    return clone({
      active: model.active,
      tool: state.connectionTool,
      from: state.connectionFrom,
      draft: state.connectionDraft,
      highlightedSocketIds: state.project.rooms.flatMap((room) => roomSockets(room)
        .filter((socket) => connectionSocketPriority(room, socket) >= 2)
        .map((socket) => ({ roomId: room.id, socketId: socket.id, type: socket.type }))),
      candidates: (model.pairs || []).map((candidate) => ({
        kind: candidate.kind,
        from: candidate.from,
        to: candidate.to,
        distance: candidate.distance,
      })),
    });
  },
  setSnapTarget: (target) => setSnapTarget(target),
  getPlacementTargets: () => {
    const rect = sceneState.renderer?.domElement.getBoundingClientRect();
    if (!rect) return { sockets: [] };
    return {
      sockets: availableSocketTargets().map((target) => ({
        id: target.socket.id,
        roomId: target.room.id,
        position: vector(target.position),
        facing: vector(target.facing),
        connectionPriority: connectionSocketPriority(target.room, target.socket),
        screen: projectedViewportPoint(target.position, rect),
      })).filter((target) => target.screen),
    };
  },
  resolvePlacement: ({ clientX, clientY, type = null, mode = state.mode, target = state.snapTarget, enabled = state.snap } = {}) => {
    const source = type ? templateByType(type, mode) || { type } : {};
    return clone(resolvePlacement(Number(clientX), Number(clientY), source, { target, enabled }));
  },
};
window.levelForge = Object.freeze(levelForgeApi);

initializeForgeBrowserIntegration()
  .then(resolveForgeReady)
  .catch((error) => {
    console.warn('Level Forge browser integration initialized in degraded mode.', error);
    resolveForgeReady({ signature: FORGE_BROWSER_SIGNATURE, ok: false, projectId: state.project.projectId, revision: state.project.revision, error: error.message });
  });
