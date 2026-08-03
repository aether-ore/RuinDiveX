import { assertJsonSafe, cloneJsonValue, deepFreezeJsonValue } from './canonical.js';

export const LEVEL_EDITOR_PROJECT_SCHEMA = 'ruindivex-level-editor-project/v1';
export const ROOM_MODULE_SCHEMA = 'ruindivex-room-module/v1';
export const AUTHORED_DUNGEON_SCHEMA = 'ruindivex-authored-dungeon/v1';
export const ROOM_REGISTRY_SCHEMA = 'ruindivex-room-registry/v1';

// Explicit aliases make the string constants discoverable to callers that use
// either SCHEMA or SCHEMA_ID naming conventions.
export const LEVEL_EDITOR_PROJECT_SCHEMA_ID = LEVEL_EDITOR_PROJECT_SCHEMA;
export const ROOM_MODULE_SCHEMA_ID = ROOM_MODULE_SCHEMA;
export const AUTHORED_DUNGEON_SCHEMA_ID = AUTHORED_DUNGEON_SCHEMA;
export const ROOM_REGISTRY_SCHEMA_ID = ROOM_REGISTRY_SCHEMA;
export const PROJECT_SCHEMA = LEVEL_EDITOR_PROJECT_SCHEMA;
export const MODULE_SCHEMA = ROOM_MODULE_SCHEMA;
export const DUNGEON_SCHEMA = AUTHORED_DUNGEON_SCHEMA;
export const REGISTRY_SCHEMA = ROOM_REGISTRY_SCHEMA;

export const LEVEL_EDITOR_SCHEMA_REVISION = 1;
export const DEFAULT_TILE_SIZE_METERS = 2.8;

export const LEVEL_EDITOR_PROJECT_DRAFT_SCHEMAS = Object.freeze([
  'ruindivex-level-editor-project/draft',
  'ruindivex-level-editor-project/draft-0',
  'ruindivex-level-editor-project/draft-1',
  'ruindivex-level-editor-project/v0',
]);

const vector3Schema = {
  type: 'object',
  required: ['x', 'y', 'z'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number' },
  },
  additionalProperties: false,
};

const transformSchema = {
  type: 'object',
  required: ['position', 'rotationY', 'scale'],
  properties: {
    position: vector3Schema,
    rotationY: { type: 'number' },
    scale: vector3Schema,
  },
};

export const LEVEL_EDITOR_PROJECT_JSON_SCHEMA = deepFreezeJsonValue({
  $id: LEVEL_EDITOR_PROJECT_SCHEMA,
  type: 'object',
  required: ['schema', 'projectId', 'name', 'revision', 'rooms', 'connections', 'entities', 'assets'],
  properties: {
    schema: { const: LEVEL_EDITOR_PROJECT_SCHEMA },
    projectId: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    revision: { type: 'integer', minimum: 1 },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    settings: { type: 'object' },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'moduleId', 'transform'],
        properties: {
          id: { type: 'string', minLength: 1 },
          moduleId: { type: 'string', minLength: 1 },
          transform: transformSchema,
        },
      },
    },
    connections: { type: 'array' },
    entities: { type: 'array' },
    assets: { type: 'array' },
    roomModules: { type: 'array' },
    metadata: { type: 'object' },
  },
});

export const ROOM_MODULE_JSON_SCHEMA = deepFreezeJsonValue({
  $id: ROOM_MODULE_SCHEMA,
  type: 'object',
  required: ['schema', 'moduleId', 'topologyRevision', 'room', 'sockets'],
  properties: {
    schema: { const: ROOM_MODULE_SCHEMA },
    moduleId: { type: 'string', minLength: 1 },
    topologyRevision: { type: 'integer', minimum: 1 },
    themePackId: { type: 'string' },
    tileSize: { type: 'number', exclusiveMinimum: 0 },
    dimensions: { type: 'object' },
    room: { type: 'object' },
    sockets: { type: 'array' },
    anchors: { type: 'array' },
    entities: { type: 'array' },
    metadata: { type: 'object' },
  },
});

export const AUTHORED_DUNGEON_JSON_SCHEMA = deepFreezeJsonValue({
  $id: AUTHORED_DUNGEON_SCHEMA,
  type: 'object',
  required: ['schema', 'dungeonId', 'revision', 'rooms', 'connections', 'entities', 'contentHash'],
  properties: {
    schema: { const: AUTHORED_DUNGEON_SCHEMA },
    dungeonId: { type: 'string', minLength: 1 },
    revision: { type: 'integer', minimum: 1 },
    rooms: { type: 'array' },
    connections: { type: 'array' },
    entities: { type: 'array' },
    spawnId: { type: ['string', 'null'] },
    metadata: { type: 'object' },
    contentHash: { type: 'string', minLength: 1 },
  },
});

export const ROOM_REGISTRY_JSON_SCHEMA = deepFreezeJsonValue({
  $id: ROOM_REGISTRY_SCHEMA,
  type: 'object',
  required: ['schema', 'registryId', 'revision', 'modules'],
  properties: {
    schema: { const: ROOM_REGISTRY_SCHEMA },
    registryId: { type: 'string', minLength: 1 },
    revision: { type: 'integer', minimum: 1 },
    modules: { type: 'array' },
    contentHash: { type: 'string' },
    metadata: { type: 'object' },
  },
});

export const LEVEL_EDITOR_JSON_SCHEMAS = deepFreezeJsonValue({
  [LEVEL_EDITOR_PROJECT_SCHEMA]: LEVEL_EDITOR_PROJECT_JSON_SCHEMA,
  [ROOM_MODULE_SCHEMA]: ROOM_MODULE_JSON_SCHEMA,
  [AUTHORED_DUNGEON_SCHEMA]: AUTHORED_DUNGEON_JSON_SCHEMA,
  [ROOM_REGISTRY_SCHEMA]: ROOM_REGISTRY_JSON_SCHEMA,
});

export const LEVEL_DATA_SCHEMAS = LEVEL_EDITOR_JSON_SCHEMAS;

function nowIso(clock) {
  const value = typeof clock === 'function' ? clock() : new Date().toISOString();
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  throw new TypeError('clock must return an ISO string or Date.');
}

function slug(value, fallback = 'level') {
  const normalized = String(value ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function generatedProjectId(name) {
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8)
    ?? Math.random().toString(36).slice(2, 10);
  return `${slug(name)}-${suffix}`;
}

export function createDefaultTransform(overrides = {}) {
  const position = overrides.position ?? {};
  const scale = overrides.scale ?? {};
  const rotationObject = overrides.rotation && typeof overrides.rotation === 'object'
    ? overrides.rotation
    : null;
  const rotationY = Number(
    overrides.rotationY
      ?? rotationObject?.y
      ?? (typeof overrides.rotation === 'number' ? overrides.rotation : 0),
  );
  const transform = {
    position: {
      x: Number(position.x ?? overrides.x ?? 0),
      y: Number(position.y ?? overrides.y ?? 0),
      z: Number(position.z ?? overrides.z ?? 0),
    },
    rotationY,
    scale: {
      x: Number(scale.x ?? 1),
      y: Number(scale.y ?? 1),
      z: Number(scale.z ?? 1),
    },
  };
  if (rotationObject) {
    transform.rotation = {
      x: Number(rotationObject.x ?? 0),
      y: rotationY,
      z: Number(rotationObject.z ?? 0),
    };
  }
  return transform;
}

export function createDefaultLevelEditorProject(options = {}) {
  const {
    projectId = generatedProjectId(options.name ?? 'Untitled Dungeon'),
    name = 'Untitled Dungeon',
    clock,
    createdAt = nowIso(clock),
    updatedAt = createdAt,
    revision = 1,
    tileSize = DEFAULT_TILE_SIZE_METERS,
    themePackId = 'industrial-v1',
    settings = {},
    metadata = {},
  } = options;
  const project = {
    schema: LEVEL_EDITOR_PROJECT_SCHEMA,
    projectId: String(projectId),
    name: String(name),
    revision: Number(revision),
    createdAt: String(createdAt),
    updatedAt: String(updatedAt),
    settings: {
      tileSize: Number(tileSize),
      unitScale: 1,
      themePackId: String(themePackId),
      spawnId: null,
      ...cloneJsonValue(settings),
    },
    rooms: [],
    connections: [],
    entities: [],
    assets: [],
    roomModules: [],
    metadata: cloneJsonValue(metadata),
  };
  assertJsonSafe(project);
  return project;
}

export const createDefaultProject = createDefaultLevelEditorProject;
export const createLevelEditorProject = createDefaultLevelEditorProject;

function compactObject(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

export function normalizeRoomInstance(room, index = 0) {
  const source = cloneJsonValue(room ?? {});
  const id = String(source.id ?? source.roomId ?? `room-${index + 1}`);
  const moduleId = String(source.moduleId ?? source.templateId ?? source.archetype ?? source.type ?? 'unknown-room');
  return compactObject([
    ['id', id],
    ['moduleId', moduleId],
    ['name', source.name === undefined ? undefined : String(source.name)],
    ['transform', createDefaultTransform(source.transform ?? source)],
    ['dimensions', source.dimensions],
    ['sockets', source.sockets],
    ['properties', source.properties ?? source.data],
    ['inlineModule', source.inlineModule ?? source.definition],
    ['metadata', source.metadata],
  ]);
}

function normalizeEndpoint(endpoint, connection, prefix) {
  const source = endpoint ?? {};
  return {
    roomId: String(source.roomId ?? source.room ?? connection?.[`${prefix}RoomId`] ?? ''),
    socketId: String(source.socketId ?? source.socket ?? connection?.[`${prefix}SocketId`] ?? ''),
  };
}

export function normalizeConnection(connection, index = 0) {
  const source = cloneJsonValue(connection ?? {});
  return compactObject([
    ['id', String(source.id ?? source.connectionId ?? `connection-${index + 1}`)],
    ['from', normalizeEndpoint(source.from ?? source.a ?? source.source, source, 'from')],
    ['to', normalizeEndpoint(source.to ?? source.b ?? source.target, source, 'to')],
    ['kind', source.kind ?? source.type],
    ['bidirectional', source.bidirectional === undefined ? true : Boolean(source.bidirectional)],
    ['properties', source.properties ?? source.data],
    ['metadata', source.metadata],
  ]);
}

export function normalizeEditorEntity(entity, index = 0) {
  const source = cloneJsonValue(entity ?? {});
  return compactObject([
    ['id', String(source.id ?? source.entityId ?? `entity-${index + 1}`)],
    ['kind', String(source.kind ?? source.category ?? source.type ?? 'prop')],
    ['type', String(source.type ?? source.prefabId ?? source.kind ?? 'prop')],
    ['name', source.name === undefined ? undefined : String(source.name)],
    ['roomId', source.roomId === undefined && source.room === undefined
      ? undefined
      : String(source.roomId ?? source.room)],
    ['transform', createDefaultTransform(source.transform ?? source)],
    ['properties', source.properties ?? source.data ?? {}],
    ['assetHash', source.assetHash],
    ['metadata', source.metadata],
  ]);
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

function migrateSocketThresholds(sockets, module) {
  const migratedSockets = new Map();
  if (!Array.isArray(sockets)) return migratedSockets;
  for (const socket of sockets) {
    if (!isLegacyGeneratedDoorSocket(socket, module)) continue;
    const previousY = Number(socket.position?.y ?? socket.transform?.position?.y ?? socket.y ?? socket.elevation);
    socket.position = { ...(socket.position ?? socket.transform?.position ?? {}), y: 0 };
    socket.transform = {
      ...(socket.transform ?? {}),
      position: { ...(socket.transform?.position ?? socket.position), y: 0 },
    };
    if (Object.prototype.hasOwnProperty.call(socket, 'y')) socket.y = 0;
    if (Object.prototype.hasOwnProperty.call(socket, 'elevation')) socket.elevation = 0;
    socket.properties = { ...(socket.properties ?? {}), positionAnchor: 'threshold-floor' };
    migratedSockets.set(String(socket.id ?? ''), { previousY, nextY: 0 });
  }
  return migratedSockets;
}

function normalizeRoomModuleSocketThresholds(input) {
  const roomModules = cloneJsonValue(input ?? []);
  const migratedByModule = new Map();
  for (const module of roomModules) {
    const migratedSockets = migrateSocketThresholds(module?.sockets, module);
    if (!migratedSockets.size) continue;
    module.topologyRevision = Math.max(1, Number(module.topologyRevision) || 1) + 1;
    migratedByModule.set(String(module.moduleId ?? module.id ?? ''), migratedSockets);
  }
  return { roomModules, migratedByModule };
}

function migrateLegacyConnectionRoute(connection, fromMigration, toMigration) {
  if (connection.properties?.authoredWith !== 'connection-interface') return;
  const route = connection.properties?.route;
  if (!Array.isArray(route?.waypoints)) return;
  const fromDelta = Number(fromMigration?.deltaY) || 0;
  const toDelta = Number(toMigration?.deltaY) || 0;
  const denominator = Math.max(1, route.waypoints.length - 1);
  for (let index = 0; index < route.waypoints.length; index += 1) {
    const waypoint = route.waypoints[index];
    if (!waypoint || typeof waypoint !== 'object' || !Number.isFinite(Number(waypoint.y))) continue;
    const progress = route.waypoints.length === 1 ? 0.5 : index / denominator;
    waypoint.y = Number((Number(waypoint.y) + fromDelta + (toDelta - fromDelta) * progress).toFixed(6));
  }
}

function containsLegacyGeneratedDoorSockets(input) {
  const modules = cloneJsonValue(input?.roomModules ?? input?.modules ?? []);
  const modulesById = new Map(modules.map((module) => [String(module.moduleId ?? module.id ?? ''), module]));
  if (modules.some((module) => module?.sockets?.some((socket) => isLegacyGeneratedDoorSocket(socket, module)))) return true;
  const rooms = input?.rooms ?? input?.roomInstances ?? input?.nodes ?? [];
  return rooms.some((room) => {
    const module = modulesById.get(String(room.moduleId ?? room.templateId ?? room.archetype ?? room.type ?? ''));
    return room?.sockets?.some((socket) => isLegacyGeneratedDoorSocket(socket, module));
  });
}

export function normalizeLevelEditorProject(input, options = {}) {
  assertJsonSafe(input);
  const source = cloneJsonValue(input);
  const base = createDefaultLevelEditorProject({
    projectId: source.projectId ?? source.id ?? options.projectId,
    name: source.name ?? source.title ?? options.name ?? 'Untitled Dungeon',
    revision: source.revision ?? source.version ?? 1,
    createdAt: source.createdAt ?? options.createdAt,
    updatedAt: source.updatedAt ?? options.updatedAt,
    clock: options.clock,
    tileSize: source.settings?.tileSize ?? source.tileSize ?? options.tileSize,
    themePackId: source.settings?.themePackId ?? source.themePackId ?? options.themePackId,
    settings: source.settings ?? {},
    metadata: source.metadata ?? {},
  });
  const rooms = source.rooms ?? source.roomInstances ?? source.nodes ?? [];
  const connections = source.connections ?? source.links ?? source.edges ?? [];
  const entities = source.entities ?? source.objects ?? source.markers ?? [];
  base.rooms = rooms.map(normalizeRoomInstance);
  base.connections = connections.map(normalizeConnection);
  base.entities = entities.map(normalizeEditorEntity);
  base.assets = cloneJsonValue(source.assets ?? source.assetManifest ?? []);
  const socketMigration = normalizeRoomModuleSocketThresholds(source.roomModules ?? source.modules ?? []);
  base.roomModules = socketMigration.roomModules;
  const modulesById = new Map(base.roomModules.map((module) => [String(module.moduleId ?? module.id ?? ''), module]));
  const migratedEndpoints = new Map();
  for (const room of base.rooms) {
    const module = modulesById.get(String(room.moduleId ?? ''));
    const hasInstanceSockets = Array.isArray(room.sockets);
    const instanceSockets = migrateSocketThresholds(room.sockets, module);
    const moduleSockets = socketMigration.migratedByModule.get(String(room.moduleId ?? '')) ?? new Map();
    const effectiveSockets = hasInstanceSockets ? instanceSockets : moduleSockets;
    const scaleY = Number(room.transform?.scale?.y) || 1;
    for (const [socketId, migration] of effectiveSockets) {
      if (!socketId) continue;
      migratedEndpoints.set(`${room.id}:${socketId}`, {
        deltaY: (migration.nextY - migration.previousY) * scaleY,
      });
    }
  }
  for (const connection of base.connections) {
    const fromKey = `${connection.from?.roomId ?? ''}:${connection.from?.socketId ?? ''}`;
    const toKey = `${connection.to?.roomId ?? ''}:${connection.to?.socketId ?? ''}`;
    const fromMigration = migratedEndpoints.get(fromKey);
    const toMigration = migratedEndpoints.get(toKey);
    if (fromMigration || toMigration) migrateLegacyConnectionRoute(connection, fromMigration, toMigration);
  }
  if (source.spawnId !== undefined && base.settings.spawnId == null) {
    base.settings.spawnId = source.spawnId === null ? null : String(source.spawnId);
  }
  assertJsonSafe(base);
  return base;
}

export function migrateLevelEditorProject(input, options = {}) {
  const schema = input?.schema ?? input?.schemaId ?? null;
  if (schema !== null
    && schema !== LEVEL_EDITOR_PROJECT_SCHEMA
    && !LEVEL_EDITOR_PROJECT_DRAFT_SCHEMAS.includes(schema)) {
    throw new RangeError(`Unsupported level editor project schema: ${schema}`);
  }
  return normalizeLevelEditorProject(input, options);
}

export function migrateLevelEditorProjectWithReport(input, options = {}) {
  const fromSchema = input?.schema ?? input?.schemaId ?? 'unversioned-draft';
  const socketThresholdsMigrated = containsLegacyGeneratedDoorSockets(input);
  const project = migrateLevelEditorProject(input, options);
  const schemaMigrated = fromSchema !== LEVEL_EDITOR_PROJECT_SCHEMA;
  const migrated = schemaMigrated || socketThresholdsMigrated;
  const diagnostics = [];
  if (schemaMigrated) diagnostics.push({
      severity: 'info',
      code: 'project-draft-migrated',
      path: '$.schema',
      message: `Migrated ${fromSchema} to ${LEVEL_EDITOR_PROJECT_SCHEMA}.`,
      details: { fromSchema, toSchema: LEVEL_EDITOR_PROJECT_SCHEMA },
    });
  if (socketThresholdsMigrated) diagnostics.push({
    severity: 'info',
    code: 'legacy-door-thresholds-migrated',
    path: '$.roomModules',
    message: 'Migrated generated door sockets and editor-authored routes from the legacy 1.2 m center height to floor-level thresholds.',
  });
  return {
    ok: true,
    migrated,
    fromSchema,
    toSchema: LEVEL_EDITOR_PROJECT_SCHEMA,
    value: project,
    project,
    diagnostics,
  };
}

export const migrateDraftProject = migrateLevelEditorProjectWithReport;
export const normalizeProject = normalizeLevelEditorProject;
