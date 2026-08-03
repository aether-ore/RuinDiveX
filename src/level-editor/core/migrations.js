import {
  AUTHORED_DUNGEON_SCHEMA,
  LEVEL_EDITOR_PROJECT_SCHEMA,
  ROOM_MODULE_SCHEMA,
  ROOM_REGISTRY_SCHEMA,
  migrateLevelEditorProject,
  normalizeConnection,
  normalizeEditorEntity,
  normalizeRoomInstance,
} from './contracts.js';
import { canonicalHash, cloneJsonValue } from './canonical.js';
import { createLevelDiagnostic, roomModuleFromRegistryEntry } from './validation.js';

export const ROOM_MODULE_DRAFT_SCHEMAS = Object.freeze([
  'ruindivex-room-module/draft',
  'ruindivex-room-module/draft-1',
  'ruindivex-room-module/v0',
]);
export const AUTHORED_DUNGEON_DRAFT_SCHEMAS = Object.freeze([
  'ruindivex-authored-dungeon/draft',
  'ruindivex-authored-dungeon/draft-1',
  'ruindivex-authored-dungeon/v0',
]);
export const ROOM_REGISTRY_DRAFT_SCHEMAS = Object.freeze([
  'ruindivex-room-registry/draft',
  'ruindivex-room-registry/draft-1',
  'ruindivex-room-registry/v0',
]);

function supported(schema, stable, drafts, kind) {
  if (schema === undefined || schema === null || schema === stable || drafts.includes(schema)) return;
  throw new RangeError(`Unsupported ${kind} schema: ${schema}`);
}

export function migrateRoomModuleDraft(input) {
  const source = cloneJsonValue(input);
  supported(source.schema ?? source.schemaId, ROOM_MODULE_SCHEMA, ROOM_MODULE_DRAFT_SCHEMAS, 'room module');
  const moduleId = String(source.moduleId ?? source.id ?? source.room?.id ?? 'room-module');
  const room = cloneJsonValue(source.room ?? source.definition ?? {});
  room.id = String(room.id ?? moduleId);
  const migrated = {
    ...source,
    schema: ROOM_MODULE_SCHEMA,
    moduleId,
    topologyRevision: Number(source.topologyRevision ?? source.topologyVersion ?? source.revision ?? 1),
    room,
    sockets: cloneJsonValue(source.sockets ?? source.ports ?? room.sockets ?? []),
  };
  delete migrated.schemaId;
  delete migrated.ports;
  delete migrated.definition;
  return migrated;
}

export const migrateRoomModule = migrateRoomModuleDraft;

function compiledRoomFromDraft(room, index) {
  const normalized = normalizeRoomInstance(room, index);
  const value = {
    ...normalized,
    roomId: normalized.id,
    templateId: normalized.moduleId,
  };
  if (normalized.inlineModule) {
    value.definition = normalized.inlineModule;
    delete value.inlineModule;
  }
  return value;
}

export function migrateAuthoredDungeonDraft(input) {
  const source = cloneJsonValue(input);
  supported(
    source.schema ?? source.schemaId,
    AUTHORED_DUNGEON_SCHEMA,
    AUTHORED_DUNGEON_DRAFT_SCHEMAS,
    'authored dungeon',
  );
  const dungeon = {
    ...source,
    schema: AUTHORED_DUNGEON_SCHEMA,
    dungeonId: String(source.dungeonId ?? source.id ?? source.projectId ?? 'authored-dungeon'),
    revision: Number(source.revision ?? source.version ?? 1),
    rooms: (source.rooms ?? source.roomInstances ?? source.nodes ?? []).map(compiledRoomFromDraft),
    connections: (source.connections ?? source.links ?? source.edges ?? []).map(normalizeConnection),
    entities: (source.entities ?? source.objects ?? source.markers ?? []).map(normalizeEditorEntity),
    spawnId: source.spawnId ?? source.settings?.spawnId ?? null,
    metadata: cloneJsonValue(source.metadata ?? {}),
  };
  delete dungeon.schemaId;
  delete dungeon.roomInstances;
  delete dungeon.nodes;
  delete dungeon.links;
  delete dungeon.edges;
  delete dungeon.objects;
  delete dungeon.markers;
  delete dungeon.version;
  dungeon.contentHash = canonicalHash(dungeon, {
    namespace: AUTHORED_DUNGEON_SCHEMA,
    omitKeys: ['contentHash'],
  });
  return dungeon;
}

export const migrateAuthoredDungeon = migrateAuthoredDungeonDraft;

function moduleEntryFromDraft(entry) {
  if (entry?.module || entry?.definition) {
    const definition = migrateRoomModuleDraft(roomModuleFromRegistryEntry(entry));
    return { ...cloneJsonValue(entry), moduleId: entry.moduleId ?? definition.moduleId, module: definition };
  }
  return migrateRoomModuleDraft(entry);
}

export function migrateRoomRegistryDraft(input) {
  const source = cloneJsonValue(input);
  supported(
    source.schema ?? source.schemaId,
    ROOM_REGISTRY_SCHEMA,
    ROOM_REGISTRY_DRAFT_SCHEMAS,
    'room registry',
  );
  let entries = source.modules ?? source.rooms ?? source.entries ?? [];
  if (!Array.isArray(entries) && entries && typeof entries === 'object') {
    entries = Object.entries(entries).map(([moduleId, entry]) => ({ moduleId, ...entry }));
  }
  const registry = {
    ...source,
    schema: ROOM_REGISTRY_SCHEMA,
    registryId: String(source.registryId ?? source.id ?? 'room-registry'),
    revision: Number(source.revision ?? source.version ?? 1),
    modules: entries.map(moduleEntryFromDraft),
    metadata: cloneJsonValue(source.metadata ?? {}),
  };
  delete registry.schemaId;
  delete registry.rooms;
  delete registry.entries;
  delete registry.version;
  registry.contentHash = canonicalHash(registry, {
    namespace: ROOM_REGISTRY_SCHEMA,
    omitKeys: ['contentHash'],
  });
  return registry;
}

export const migrateRoomRegistry = migrateRoomRegistryDraft;
export const migrateProjectDraft = migrateLevelEditorProject;

export function detectLevelDocumentKind(document) {
  const schema = String(document?.schema ?? document?.schemaId ?? '');
  if (schema.includes('level-editor-project')) return 'project';
  if (schema.includes('room-module')) return 'room-module';
  if (schema.includes('authored-dungeon')) return 'authored-dungeon';
  if (schema.includes('room-registry')) return 'room-registry';
  if (document?.projectId || document?.roomInstances || (document?.settings && document?.rooms)) return 'project';
  if (document?.moduleId || (document?.room && document?.sockets)) return 'room-module';
  if (document?.registryId || document?.entries) return 'room-registry';
  if (document?.dungeonId) return 'authored-dungeon';
  return null;
}

export function migrateDraftDocument(input, options = {}) {
  const kind = options.kind ?? detectLevelDocumentKind(input);
  const fromSchema = input?.schema ?? input?.schemaId ?? 'unversioned-draft';
  let value;
  let toSchema;
  switch (kind) {
    case 'project':
      value = migrateLevelEditorProject(input, options);
      toSchema = LEVEL_EDITOR_PROJECT_SCHEMA;
      break;
    case 'room-module':
      value = migrateRoomModuleDraft(input, options);
      toSchema = ROOM_MODULE_SCHEMA;
      break;
    case 'authored-dungeon':
      value = migrateAuthoredDungeonDraft(input, options);
      toSchema = AUTHORED_DUNGEON_SCHEMA;
      break;
    case 'room-registry':
      value = migrateRoomRegistryDraft(input, options);
      toSchema = ROOM_REGISTRY_SCHEMA;
      break;
    default:
      throw new TypeError('Could not detect level document kind; pass { kind }.');
  }
  const migrated = fromSchema !== toSchema;
  const diagnostics = migrated ? [createLevelDiagnostic(
    'info',
    'draft-document-migrated',
    '$.schema',
    `Migrated ${fromSchema} to ${toSchema}.`,
    { kind, fromSchema, toSchema },
  )] : [];
  return { ok: true, kind, migrated, fromSchema, toSchema, value, diagnostics };
}
