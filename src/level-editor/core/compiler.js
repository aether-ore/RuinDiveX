import {
  AUTHORED_DUNGEON_SCHEMA,
  ROOM_MODULE_SCHEMA,
  ROOM_REGISTRY_SCHEMA,
  createDefaultTransform,
  migrateLevelEditorProjectWithReport,
  normalizeConnection,
  normalizeEditorEntity,
  normalizeRoomInstance,
} from './contracts.js';
import { canonicalHash, cloneJsonValue } from './canonical.js';
import {
  LevelDataValidationError,
  createLevelDiagnostic,
  createRoomModuleMap,
  roomModuleFromRegistryEntry,
  validateAuthoredDungeon,
  validateLevelEditorProject,
  validateRoomModule,
  validateRoomRegistry,
} from './validation.js';

const EDITOR_ONLY_METADATA_KEYS = /^(?:editor|ui|undo|redo|viewport|selection|outliner|inspector)/i;

function runtimeMetadata(value) {
  if (Array.isArray(value)) return value.map(runtimeMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !EDITOR_ONLY_METADATA_KEYS.test(key))
    .map(([key, entry]) => [key, runtimeMetadata(entry)]));
}

function byId(left, right) {
  const leftId = String(left?.id ?? left?.roomId ?? left?.moduleId ?? '');
  const rightId = String(right?.id ?? right?.roomId ?? right?.moduleId ?? '');
  return leftId.localeCompare(rightId);
}

function entriesFromRegistry(registry) {
  if (Array.isArray(registry?.modules)) return registry.modules;
  if (registry?.modules && typeof registry.modules === 'object') {
    return Object.entries(registry.modules).map(([id, entry]) => (
      entry?.module ?? entry?.definition ?? entry?.schema
        ? entry
        : { moduleId: id, ...entry }
    ));
  }
  return [];
}

export function computeRoomRegistryHash(registry) {
  return canonicalHash(registry, {
    namespace: ROOM_REGISTRY_SCHEMA,
    omitKeys: ['contentHash'],
  });
}

export function computeRoomModuleHash(roomModule) {
  return canonicalHash(roomModule, {
    namespace: ROOM_MODULE_SCHEMA,
    omitKeys: ['planHash', 'contentHash', 'editorState', 'editorOnly'],
  });
}

export function computeAuthoredDungeonHash(dungeon) {
  return canonicalHash(dungeon, {
    namespace: AUTHORED_DUNGEON_SCHEMA,
    omitKeys: ['contentHash'],
  });
}

export function createRoomRegistry({
  registryId = 'editor-room-registry',
  revision = 1,
  modules = [],
  metadata = {},
} = {}) {
  const normalizedModules = modules.map((entry) => cloneJsonValue(entry)).sort((left, right) => {
    const leftId = roomModuleFromRegistryEntry(left)?.moduleId ?? left?.moduleId ?? '';
    const rightId = roomModuleFromRegistryEntry(right)?.moduleId ?? right?.moduleId ?? '';
    return String(leftId).localeCompare(String(rightId));
  });
  const registry = {
    schema: ROOM_REGISTRY_SCHEMA,
    registryId: String(registryId),
    revision: Number(revision),
    modules: normalizedModules,
    metadata: cloneJsonValue(metadata),
  };
  registry.contentHash = computeRoomRegistryHash(registry);
  return registry;
}

function selectionDefaults(module) {
  const roomType = module.room?.type ?? module.selection?.roomType ?? 'authored-room';
  return {
    family: module.selection?.family ?? module.themePackId ?? 'authored',
    roomType,
    archetype: module.selection?.archetype ?? module.room?.archetype ?? roomType,
    tags: [...(module.selection?.tags ?? [])],
    weight: Number(module.selection?.weight ?? 1),
    allowedQuarterTurns: [...(module.selection?.allowedQuarterTurns ?? [0, 1, 2, 3])],
    difficulty: {
      min: Number(module.selection?.difficulty?.min ?? module.selection?.difficultyMin ?? 1),
      max: Number(module.selection?.difficulty?.max ?? module.selection?.difficultyMax ?? 10),
    },
    maximumInstances: module.selection?.maximumInstances ?? null,
    ...cloneJsonValue(module.selection ?? {}),
  };
}

/** Compile one reusable room module without retaining its editor instance id. */
export function compileEditorRoom(input, roomId = null, options = {}) {
  const project = migrateLevelEditorProjectWithReport(input, options).project;
  const instance = project.rooms.find((room) => room.id === roomId || room.moduleId === roomId)
    ?? project.rooms[0];
  if (!instance) {
    const diagnostic = createLevelDiagnostic('error', 'room-missing', '$.rooms', 'The project has no room to compile.');
    return { ok: false, value: null, room: null, diagnostics: [diagnostic], errors: [diagnostic], warnings: [] };
  }
  const registry = mergeRoomRegistry(project, options.roomRegistry);
  const definition = instance.inlineModule
    ?? createRoomModuleMap(registry).get(instance.moduleId);
  if (!definition) {
    const diagnostic = createLevelDiagnostic(
      'error',
      'room-module-reference-missing',
      '$.rooms',
      `Room ${instance.id} references unknown module ${instance.moduleId}.`,
    );
    return { ok: false, value: null, room: null, diagnostics: [diagnostic], errors: [diagnostic], warnings: [] };
  }
  const localEntities = project.entities
    .filter((entity) => entity.roomId === instance.id)
    .map((entity) => {
      const local = cloneJsonValue(entity);
      delete local.roomId;
      return local;
    });
  const module = {
    ...cloneJsonValue(definition),
    schema: ROOM_MODULE_SCHEMA,
    moduleId: definition.moduleId ?? instance.moduleId,
    topologyRevision: Math.max(1, Math.trunc(Number(definition.topologyRevision) || 1)),
    sockets: cloneJsonValue(instance.sockets ?? definition.sockets ?? []),
    entities: [
      ...cloneJsonValue(definition.entities ?? []),
      ...localEntities,
    ],
    selection: selectionDefaults(definition),
    metadata: runtimeMetadata(definition.metadata ?? {}),
  };
  module.planHash = computeRoomModuleHash(module);
  const validation = validateRoomModule(module, options);
  const value = validation.ok || options.allowInvalid === true ? module : null;
  return {
    ...validation,
    value,
    room: value,
    candidate: module,
    hash: module.planHash,
    instanceId: instance.id,
  };
}

export const compileRoomModule = compileEditorRoom;

function mergeRoomRegistry(project, suppliedRegistry) {
  const modules = new Map();
  for (const entry of [
    ...entriesFromRegistry(suppliedRegistry),
    ...(project.roomModules ?? []),
  ]) {
    const module = roomModuleFromRegistryEntry(entry);
    const id = module?.moduleId ?? entry?.moduleId ?? entry?.id;
    if (id && !modules.has(id)) modules.set(id, cloneJsonValue(entry));
  }
  for (const room of project.rooms) {
    if (!room.inlineModule) continue;
    const id = room.inlineModule.moduleId ?? room.moduleId;
    const definition = {
      ...cloneJsonValue(room.inlineModule),
      moduleId: id,
    };
    if (!modules.has(id)) modules.set(id, definition);
  }
  return createRoomRegistry({
    registryId: suppliedRegistry?.registryId ?? `${project.projectId}-room-registry`,
    revision: suppliedRegistry?.revision ?? project.revision,
    modules: [...modules.values()],
    metadata: suppliedRegistry?.metadata ?? { sourceProjectId: project.projectId },
  });
}

function compileRoom(room, index, moduleMap, { inlineDefinitions = false } = {}) {
  const normalized = normalizeRoomInstance(room, index);
  const definition = normalized.inlineModule ?? moduleMap.get(normalized.moduleId);
  const compiled = {
    id: normalized.id,
    roomId: normalized.id,
    moduleId: normalized.moduleId,
    templateId: normalized.moduleId,
    transform: createDefaultTransform(normalized.transform),
  };
  const dimensions = normalized.dimensions ?? definition?.dimensions;
  const sockets = normalized.sockets ?? definition?.sockets;
  const properties = normalized.properties;
  if (dimensions !== undefined) compiled.dimensions = cloneJsonValue(dimensions);
  if (sockets !== undefined) compiled.sockets = cloneJsonValue(sockets);
  if (properties !== undefined) compiled.properties = cloneJsonValue(properties);
  if (normalized.name !== undefined) compiled.name = normalized.name;
  if (normalized.metadata !== undefined) compiled.metadata = cloneJsonValue(normalized.metadata);
  if (normalized.inlineModule || inlineDefinitions) {
    if (definition !== undefined) compiled.definition = cloneJsonValue(definition);
  }
  return compiled;
}

function normalizeSpawnId(project, entities) {
  const explicit = project.settings?.spawnId ?? project.spawnId;
  if (explicit !== undefined && explicit !== null && explicit !== '') return String(explicit);
  const spawn = entities.find((entity) => {
    const kind = String(entity.kind ?? '').toLowerCase();
    const type = String(entity.type ?? '').toLowerCase();
    return ['spawn', 'player-spawn', 'player_spawn', 'dungeon-start'].includes(kind)
      || ['spawn', 'player-spawn', 'player_spawn', 'dungeon-start'].includes(type);
  });
  return spawn?.id ?? null;
}

function scopedDiagnostics(validation, scope) {
  return validation.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    details: { ...diagnostic.details, scope },
  }));
}

/**
 * Compile an editable project into an immutable-data authored dungeon contract.
 * Compilation is synchronous and side-effect free; binary asset resolution is
 * intentionally deferred to LevelProjectStore/runtime assembly.
 */
export function compileEditorProject(input, options = {}) {
  let migration;
  try {
    migration = migrateLevelEditorProjectWithReport(input, options);
  } catch (caught) {
    const diagnostic = createLevelDiagnostic(
      'error',
      'project-migration-failed',
      '$',
      caught?.message ?? 'Project migration failed.',
    );
    return {
      ok: false,
      value: null,
      dungeon: null,
      compiled: null,
      registry: null,
      hash: null,
      diagnostics: [diagnostic],
      errors: [diagnostic],
      warnings: [],
    };
  }
  const project = migration.project;
  const registry = mergeRoomRegistry(project, options.roomRegistry);
  const moduleMap = createRoomModuleMap(registry);
  const rooms = project.rooms
    .map((room, index) => compileRoom(room, index, moduleMap, options))
    .sort(byId);
  const connections = project.connections
    .map(normalizeConnection)
    .sort(byId);
  const entities = project.entities
    .map(normalizeEditorEntity)
    .sort(byId);
  const dungeon = {
    schema: AUTHORED_DUNGEON_SCHEMA,
    dungeonId: String(options.dungeonId ?? project.projectId),
    revision: Number(options.revision ?? project.revision),
    name: String(options.name ?? project.name),
    roomRegistryId: registry.registryId,
    rooms,
    connections,
    entities,
    spawnId: normalizeSpawnId(project, entities),
    metadata: {
      ...runtimeMetadata(project.metadata ?? {}),
      sourceProjectId: project.projectId,
      sourceProjectSchema: project.schema,
      themePackId: project.settings?.themePackId ?? null,
      tileSize: project.settings?.tileSize ?? null,
    },
  };
  dungeon.contentHash = computeAuthoredDungeonHash(dungeon);

  const projectValidation = validateLevelEditorProject(project, {
    ...options,
    roomRegistry: registry,
    requireSpawn: options.requireSpawn ?? true,
  });
  const registryValidation = validateRoomRegistry(registry, options);
  const dungeonValidation = validateAuthoredDungeon(dungeon, {
    ...options,
    roomRegistry: registry,
    requireSpawn: options.requireSpawn ?? true,
  });
  const diagnostics = [
    ...migration.diagnostics,
    ...scopedDiagnostics(projectValidation, 'project'),
    ...scopedDiagnostics(registryValidation, 'roomRegistry'),
    ...scopedDiagnostics(dungeonValidation, 'authoredDungeon'),
  ];
  if (rooms.length === 0 && options.allowEmpty !== true) {
    diagnostics.push(createLevelDiagnostic(
      'error',
      'dungeon-has-no-rooms',
      '$.rooms',
      'A playable authored dungeon requires at least one room.',
      { scope: 'authoredDungeon' },
    ));
  }
  if (options.warningsAsErrors === true) {
    diagnostics.forEach((diagnostic) => {
      if (diagnostic.severity === 'warning') diagnostic.severity = 'error';
    });
  }
  const errors = diagnostics.filter(({ severity }) => severity === 'error');
  const warnings = diagnostics.filter(({ severity }) => severity === 'warning');
  const ok = errors.length === 0;
  const value = ok || options.allowInvalid === true ? dungeon : null;
  const output = {
    ok,
    value,
    dungeon: value,
    compiled: value,
    candidate: dungeon,
    registry,
    roomRegistry: registry,
    project,
    hash: dungeon.contentHash,
    diagnostics,
    errors,
    warnings,
  };
  if (!ok && options.throwOnError === true) {
    throw new LevelDataValidationError('Level editor project did not compile.', output);
  }
  return output;
}

export function compileEditorProjectValue(project, options = {}) {
  const compiled = compileEditorProject(project, { ...options, throwOnError: true });
  return compiled.value;
}

export const compileLevelEditorProject = compileEditorProject;
