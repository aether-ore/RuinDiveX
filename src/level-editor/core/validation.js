import {
  AUTHORED_DUNGEON_SCHEMA,
  LEVEL_EDITOR_PROJECT_SCHEMA,
  ROOM_MODULE_SCHEMA,
  ROOM_REGISTRY_SCHEMA,
} from './contracts.js';
import { assertJsonSafe, canonicalHash, canonicalStringify } from './canonical.js';

export const DIAGNOSTIC_SEVERITIES = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
});

export function createLevelDiagnostic(severity, code, path, message, details = {}) {
  return { severity, code, path, message, details };
}

function error(code, path, message, details) {
  return createLevelDiagnostic('error', code, path, message, details);
}

function warning(code, path, message, details) {
  return createLevelDiagnostic('warning', code, path, message, details);
}

function resultFor(diagnostics) {
  const errors = diagnostics.filter(({ severity }) => severity === 'error');
  const warnings = diagnostics.filter(({ severity }) => severity === 'warning');
  return { ok: errors.length === 0, diagnostics, errors, warnings };
}

function jsonSafetyDiagnostic(value) {
  try {
    assertJsonSafe(value);
    return null;
  } catch (caught) {
    return error(
      'document-not-json-safe',
      caught?.path ?? '$',
      caught?.message ?? 'Document is not JSON-safe.',
    );
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function positiveNumber(value) {
  return finiteNumber(value) && value > 0;
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkSchema(document, expected, diagnostics) {
  if (document?.schema !== expected) {
    diagnostics.push(error(
      'schema-mismatch',
      '$.schema',
      `Expected schema ${expected}.`,
      { expected, actual: document?.schema ?? null },
    ));
  }
}

function checkIdentifier(value, path, label, diagnostics) {
  if (!nonEmptyString(value)) {
    diagnostics.push(error(
      'identifier-missing',
      path,
      `${label} must be a non-empty string.`,
      { label },
    ));
    return false;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value)) {
    diagnostics.push(warning(
      'identifier-nonportable',
      path,
      `${label} contains characters that are awkward in URLs, filenames, or references.`,
      { value },
    ));
  }
  return true;
}

function checkUniqueIds(items, path, label, diagnostics, idSelector = (entry) => entry?.id) {
  const ids = new Map();
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const id = idSelector(item);
    if (!nonEmptyString(id)) {
      diagnostics.push(error('identifier-missing', `${path}[${index}].id`, `${label} requires an id.`));
      continue;
    }
    if (ids.has(id)) {
      diagnostics.push(error(
        'duplicate-id',
        `${path}[${index}].id`,
        `Duplicate ${label} id ${id}.`,
        { id, firstIndex: ids.get(id), duplicateIndex: index },
      ));
    } else {
      ids.set(id, index);
    }
  }
  return ids;
}

function checkVector3(value, path, diagnostics, { positive = false } = {}) {
  if (!object(value)) {
    diagnostics.push(error('vector-missing', path, 'Expected an {x, y, z} vector.'));
    return false;
  }
  let valid = true;
  for (const axis of ['x', 'y', 'z']) {
    if (!finiteNumber(value[axis]) || (positive && value[axis] <= 0)) {
      diagnostics.push(error(
        positive ? 'vector-component-not-positive' : 'vector-component-not-finite',
        `${path}.${axis}`,
        `Vector ${axis} must be ${positive ? 'positive' : 'finite'}.`,
      ));
      valid = false;
    }
  }
  return valid;
}

function checkTransform(transform, path, diagnostics) {
  if (!object(transform)) {
    diagnostics.push(error('transform-missing', path, 'A transform is required.'));
    return;
  }
  checkVector3(transform.position, `${path}.position`, diagnostics);
  checkVector3(transform.scale, `${path}.scale`, diagnostics, { positive: true });
  if (transform.rotation !== undefined && typeof transform.rotation === 'object') {
    checkVector3(transform.rotation, `${path}.rotation`, diagnostics);
  }
  const rotationY = transform.rotationY ?? transform.rotation?.y;
  if (!finiteNumber(rotationY)) {
    diagnostics.push(error(
      'rotation-not-finite',
      `${path}.${transform.rotation !== undefined ? 'rotation.y' : 'rotationY'}`,
      'Transform yaw must be finite.',
    ));
  }
}

function socketId(socket) {
  return socket?.id ?? socket?.socketId;
}

function validateSocket(socket, path, diagnostics) {
  checkIdentifier(socketId(socket), `${path}.id`, 'Socket id', diagnostics);
  const position = socket?.position ?? socket?.transform?.position ?? {
    x: socket?.x,
    y: socket?.elevation ?? socket?.y,
    z: socket?.z,
  };
  checkVector3(position, `${path}.position`, diagnostics);
  const rotationY = socket?.transform?.rotationY
    ?? socket?.transform?.rotation?.y
    ?? (finiteNumber(socket?.transform?.rotation) ? socket.transform.rotation : undefined);
  const facing = socket?.facing
    ?? socket?.transform?.facing
    ?? (finiteNumber(rotationY) ? {
      x: Math.sin(rotationY),
      y: 0,
      z: Math.cos(rotationY),
    } : {
      x: socket?.facingX,
      y: socket?.facingY ?? 0,
      z: socket?.facingZ,
    });
  if (checkVector3(facing, `${path}.facing`, diagnostics)) {
    const length = Math.hypot(facing.x, facing.y, facing.z);
    if (length < 1e-6) {
      diagnostics.push(error('socket-facing-zero', `${path}.facing`, 'Socket facing cannot be zero.'));
    } else if (Math.abs(length - 1) > 0.05) {
      diagnostics.push(warning(
        'socket-facing-not-normalized',
        `${path}.facing`,
        'Socket facing should be normalized.',
        { length },
      ));
    }
  }
  const width = socket?.widthMeters ?? socket?.width ?? socket?.dimensions?.width;
  const height = socket?.heightMeters ?? socket?.height ?? socket?.dimensions?.height;
  if (width !== undefined && !positiveNumber(width)) {
    diagnostics.push(error('socket-width-invalid', `${path}.widthMeters`, 'Socket width must be positive.'));
  }
  if (height !== undefined && !positiveNumber(height)) {
    diagnostics.push(error('socket-height-invalid', `${path}.heightMeters`, 'Socket height must be positive.'));
  }
}

function collectAnchorIds(module) {
  const ids = new Set();
  const visit = (entries) => {
    if (Array.isArray(entries)) {
      entries.forEach((entry) => {
        if (nonEmptyString(entry?.id)) ids.add(entry.id);
      });
    } else if (object(entries)) {
      Object.keys(entries).forEach((id) => ids.add(id));
    }
  };
  visit(module?.anchors);
  visit(module?.room?.anchors);
  visit(module?.room?.previewAnchors);
  for (const key of [
    'controlAnchors', 'rewardAnchors', 'discoveryAnchors', 'encounterAnchors',
    'safeAnchors', 'hazardAnchors', 'spawnAnchors', 'extractionAnchors',
  ]) visit(module?.[key]);
  return ids;
}

function collectRequiredAnchorIds(module) {
  const values = [
    ...(module?.requiredAnchorIds ?? []),
    ...(module?.room?.requiredAnchorIds ?? []),
    ...(module?.gameplay?.requiredAnchors ?? []),
  ];
  return values.map((entry) => typeof entry === 'string' ? entry : entry?.id).filter(nonEmptyString);
}

function dimensionsFromModule(module) {
  const tileSize = Number(module?.tileSize ?? 1);
  const dimensions = module?.dimensions ?? {};
  const firstFinite = (...values) => values.find((value) => Number.isFinite(value));
  return {
    width: firstFinite(
      Number(dimensions.widthMeters),
      Number(dimensions.width),
      Number(dimensions.authoredEnvelopeMeters?.width),
      Number(dimensions.widthTiles) * tileSize,
      Number(module?.room?.width) * tileSize,
    ),
    depth: firstFinite(
      Number(dimensions.depthMeters),
      Number(dimensions.depth),
      Number(dimensions.authoredEnvelopeMeters?.depth),
      Number(dimensions.depthTiles) * tileSize,
      Number(module?.room?.depth) * tileSize,
    ),
    height: firstFinite(
      Number(dimensions.heightMeters),
      Number(dimensions.height),
      Number(dimensions.maxY) - Number(dimensions.minY),
      Number(module?.room?.ceilingHeight),
    ),
  };
}

export function validateRoomModule(module, options = {}) {
  const diagnostics = [];
  const unsafe = jsonSafetyDiagnostic(module);
  if (unsafe) return resultFor([unsafe]);
  if (!object(module)) return resultFor([error('room-module-not-object', '$', 'Room module must be an object.')]);
  checkSchema(module, ROOM_MODULE_SCHEMA, diagnostics);
  checkIdentifier(module.moduleId, '$.moduleId', 'Module id', diagnostics);
  if (!Number.isInteger(module.topologyRevision) || module.topologyRevision < 1) {
    diagnostics.push(error(
      'topology-revision-invalid',
      '$.topologyRevision',
      'topologyRevision must be a positive integer.',
    ));
  }
  if (!object(module.room)) {
    diagnostics.push(error('room-definition-missing', '$.room', 'Room module requires a room definition.'));
  } else {
    if (nonEmptyString(module.room.id) && module.room.id !== module.moduleId) {
      diagnostics.push(error(
        'room-module-id-mismatch',
        '$.room.id',
        'room.id must match moduleId.',
        { moduleId: module.moduleId, roomId: module.room.id },
      ));
    }
    const baseElevation = module.room.baseElevation ?? module.baseElevation;
    if (baseElevation !== undefined && !finiteNumber(baseElevation)) {
      diagnostics.push(error('base-elevation-invalid', '$.room.baseElevation', 'baseElevation must be finite.'));
    }
  }
  if (module.tileSize !== undefined && !positiveNumber(module.tileSize)) {
    diagnostics.push(error('tile-size-invalid', '$.tileSize', 'tileSize must be positive.'));
  }
  const dimensions = dimensionsFromModule(module);
  if (!(positiveNumber(dimensions.width) && positiveNumber(dimensions.depth))) {
    diagnostics.push(error(
      'room-dimensions-invalid',
      '$.dimensions',
      'Room dimensions must resolve to positive width and depth in metres.',
      { resolved: dimensions },
    ));
  }
  if (!Array.isArray(module.sockets)) {
    diagnostics.push(error('sockets-not-array', '$.sockets', 'sockets must be an array.'));
  } else {
    if (module.sockets.length === 0 && options.allowIsolated !== true) {
      diagnostics.push(warning('room-has-no-sockets', '$.sockets', 'Room cannot connect to another room.'));
    }
    checkUniqueIds(module.sockets, '$.sockets', 'socket', diagnostics, socketId);
    module.sockets.forEach((socket, index) => validateSocket(socket, `$.sockets[${index}]`, diagnostics));
  }

  const sockets = new Set((module.sockets ?? []).map(socketId).filter(nonEmptyString));
  for (const [index, frame] of (module.socketFrames ?? []).entries()) {
    if (!sockets.has(frame?.socketId)) {
      diagnostics.push(error(
        'socket-frame-reference-missing',
        `$.socketFrames[${index}].socketId`,
        `Socket frame references unknown socket ${frame?.socketId}.`,
      ));
    }
  }
  const anchorIds = collectAnchorIds(module);
  for (const requiredId of collectRequiredAnchorIds(module)) {
    if (!anchorIds.has(requiredId)) {
      diagnostics.push(error(
        'required-anchor-missing',
        '$.requiredAnchorIds',
        `Required gameplay anchor ${requiredId} is not defined.`,
        { anchorId: requiredId },
      ));
    }
  }
  checkUniqueIds(module.entities ?? [], '$.entities', 'module entity', diagnostics);
  for (const [index, entity] of (module.entities ?? []).entries()) {
    const anchorId = entity?.anchorId ?? entity?.properties?.anchorId;
    if (anchorId && !anchorIds.has(anchorId)) {
      diagnostics.push(error(
        'entity-anchor-reference-missing',
        `$.entities[${index}].anchorId`,
        `Entity references unknown anchor ${anchorId}.`,
      ));
    }
  }
  return resultFor(diagnostics);
}

function registryModules(registry) {
  if (Array.isArray(registry?.modules)) return registry.modules;
  if (object(registry?.modules)) return Object.entries(registry.modules).map(([moduleId, value]) => (
    value?.schema ? value : { ...value, moduleId: value?.moduleId ?? moduleId }
  ));
  return [];
}

export function roomModuleFromRegistryEntry(entry) {
  return entry?.module ?? entry?.definition ?? entry;
}

export function createRoomModuleMap(registry) {
  const map = new Map();
  for (const entry of registryModules(registry)) {
    const module = roomModuleFromRegistryEntry(entry);
    const id = module?.moduleId ?? entry?.moduleId ?? entry?.id;
    if (nonEmptyString(id) && !map.has(id)) map.set(id, module);
  }
  return map;
}

export function validateRoomRegistry(registry, options = {}) {
  const diagnostics = [];
  const unsafe = jsonSafetyDiagnostic(registry);
  if (unsafe) return resultFor([unsafe]);
  if (!object(registry)) return resultFor([error('room-registry-not-object', '$', 'Room registry must be an object.')]);
  checkSchema(registry, ROOM_REGISTRY_SCHEMA, diagnostics);
  checkIdentifier(registry.registryId, '$.registryId', 'Registry id', diagnostics);
  if (!Number.isInteger(registry.revision) || registry.revision < 1) {
    diagnostics.push(error('registry-revision-invalid', '$.revision', 'Registry revision must be a positive integer.'));
  }
  if (!Array.isArray(registry.modules) && !object(registry.modules)) {
    diagnostics.push(error('registry-modules-invalid', '$.modules', 'Registry modules must be an array or id map.'));
    return resultFor(diagnostics);
  }
  const seen = new Map();
  for (const [index, entry] of registryModules(registry).entries()) {
    const module = roomModuleFromRegistryEntry(entry);
    const moduleId = module?.moduleId ?? entry?.moduleId ?? entry?.id;
    if (seen.has(moduleId)) {
      diagnostics.push(error(
        'duplicate-module-id',
        `$.modules[${index}]`,
        `Registry contains module ${moduleId} more than once.`,
        { moduleId, firstIndex: seen.get(moduleId), duplicateIndex: index },
      ));
    } else if (nonEmptyString(moduleId)) {
      seen.set(moduleId, index);
    }
    const validation = validateRoomModule(module, options);
    validation.diagnostics.forEach((entryDiagnostic) => diagnostics.push({
      ...entryDiagnostic,
      path: `$.modules[${index}]${entryDiagnostic.path === '$' ? '' : entryDiagnostic.path.slice(1)}`,
      details: { ...entryDiagnostic.details, moduleId: moduleId ?? null },
    }));
    if (entry?.moduleId && module?.moduleId && entry.moduleId !== module.moduleId) {
      diagnostics.push(error(
        'registry-entry-module-id-mismatch',
        `$.modules[${index}].moduleId`,
        'Registry entry moduleId does not match its definition.',
      ));
    }
  }
  if (registry.contentHash && options.verifyHash !== false) {
    const actual = canonicalHash(registry, {
      namespace: ROOM_REGISTRY_SCHEMA,
      omitKeys: ['contentHash'],
    });
    if (registry.contentHash !== actual) {
      diagnostics.push(error(
        'registry-content-hash-mismatch',
        '$.contentHash',
        'Registry contentHash does not match its canonical content.',
        { expected: actual, actual: registry.contentHash },
      ));
    }
  }
  return resultFor(diagnostics);
}

function endpoint(connection, side) {
  const value = connection?.[side] ?? (side === 'from' ? connection?.a : connection?.b) ?? {};
  return {
    roomId: value.roomId ?? value.room ?? connection?.[`${side}RoomId`],
    socketId: value.socketId ?? value.socket ?? connection?.[`${side}SocketId`],
  };
}

function roomInstanceId(room) {
  return room?.roomId ?? room?.id;
}

function roomInstanceModuleId(room) {
  return room?.moduleId ?? room?.templateId;
}

function moduleSocketsForRoom(room, moduleMap) {
  if (Array.isArray(room?.sockets)) return room.sockets;
  const module = room?.definition ?? room?.inlineModule ?? moduleMap.get(roomInstanceModuleId(room));
  return Array.isArray(module?.sockets) ? module.sockets : [];
}

function socketsKnownForRoom(room, moduleMap) {
  if (Array.isArray(room?.sockets)) return true;
  const module = room?.definition ?? room?.inlineModule ?? moduleMap.get(roomInstanceModuleId(room));
  return Array.isArray(module?.sockets);
}

function validateRoomsAndReferences(document, diagnostics, { roomRegistry } = {}) {
  if (!Array.isArray(document.rooms)) {
    diagnostics.push(error('rooms-not-array', '$.rooms', 'rooms must be an array.'));
    return {
      roomById: new Map(),
      moduleMap: new Map(),
      socketIdsByRoom: new Map(),
      roomsWithKnownSockets: new Set(),
    };
  }
  const roomIds = checkUniqueIds(document.rooms, '$.rooms', 'room', diagnostics, roomInstanceId);
  const roomById = new Map();
  document.rooms.forEach((room, index) => {
    const id = roomInstanceId(room);
    if (nonEmptyString(id) && !roomById.has(id)) roomById.set(id, room);
    checkIdentifier(roomInstanceModuleId(room), `$.rooms[${index}].moduleId`, 'Room module id', diagnostics);
    checkTransform(room?.transform, `$.rooms[${index}].transform`, diagnostics);
  });

  const registry = roomRegistry ?? document.roomRegistry ?? document.registry;
  const moduleMap = createRoomModuleMap(registry ?? { modules: document.roomModules ?? [] });
  const enforceRegistryReferences = registry !== undefined
    || (Array.isArray(document.roomModules) && document.roomModules.length > 0);
  const socketIdsByRoom = new Map();
  const roomsWithKnownSockets = new Set();
  document.rooms.forEach((room, index) => {
    const id = roomInstanceId(room);
    const moduleId = roomInstanceModuleId(room);
    if (enforceRegistryReferences && !moduleMap.has(moduleId) && !room?.definition && !room?.inlineModule) {
      diagnostics.push(error(
        'room-module-reference-missing',
        `$.rooms[${index}].moduleId`,
        `Room ${id} references unknown module ${moduleId}.`,
        { roomId: id, moduleId },
      ));
    }
    const sockets = moduleSocketsForRoom(room, moduleMap);
    if (socketsKnownForRoom(room, moduleMap)) roomsWithKnownSockets.add(id);
    const ids = new Set(sockets.map(socketId).filter(nonEmptyString));
    socketIdsByRoom.set(id, ids);
    checkUniqueIds(sockets, `$.rooms[${index}].sockets`, `socket on room ${id}`, diagnostics, socketId);
  });
  return { roomIds, roomById, moduleMap, socketIdsByRoom, roomsWithKnownSockets };
}

function validateConnections(document, diagnostics, context) {
  if (!Array.isArray(document.connections)) {
    diagnostics.push(error('connections-not-array', '$.connections', 'connections must be an array.'));
    return [];
  }
  checkUniqueIds(document.connections, '$.connections', 'connection', diagnostics);
  const endpointUsage = new Map();
  const validConnections = [];
  for (const [index, connection] of document.connections.entries()) {
    const from = endpoint(connection, 'from');
    const to = endpoint(connection, 'to');
    let valid = true;
    for (const [side, value] of [['from', from], ['to', to]]) {
      if (!context.roomById.has(value.roomId)) {
        diagnostics.push(error(
          'connection-room-reference-missing',
          `$.connections[${index}].${side}.roomId`,
          `Connection references unknown room ${value.roomId}.`,
          { connectionId: connection?.id, roomId: value.roomId },
        ));
        valid = false;
      } else {
        const knownSockets = context.socketIdsByRoom.get(value.roomId);
        if (nonEmptyString(value.socketId)
          && context.roomsWithKnownSockets?.has(value.roomId)
          && !knownSockets.has(value.socketId)) {
          diagnostics.push(error(
            'connection-socket-reference-missing',
            `$.connections[${index}].${side}.socketId`,
            `Connection references unknown socket ${value.socketId} on room ${value.roomId}.`,
            { connectionId: connection?.id, roomId: value.roomId, socketId: value.socketId },
          ));
          valid = false;
        }
      }
      if (!nonEmptyString(value.socketId)) {
        diagnostics.push(error(
          'connection-socket-id-missing',
          `$.connections[${index}].${side}.socketId`,
          'Connection endpoint requires a socket id.',
        ));
        valid = false;
      }
      const key = `${value.roomId}/${value.socketId}`;
      if (endpointUsage.has(key) && connection?.properties?.allowSharedSocket !== true) {
        diagnostics.push(error(
          'connection-socket-already-used',
          `$.connections[${index}].${side}`,
          `Socket endpoint ${key} is already used by connection ${endpointUsage.get(key)}.`,
          { endpoint: key, firstConnectionId: endpointUsage.get(key) },
        ));
      } else endpointUsage.set(key, connection?.id ?? index);
    }
    if (from.roomId === to.roomId && from.socketId === to.socketId) {
      diagnostics.push(error('connection-self-loop', `$.connections[${index}]`, 'Connection endpoints must differ.'));
      valid = false;
    }
    if (valid) validConnections.push({ connection, from, to });
  }
  return validConnections;
}

function entityKind(entity) {
  return String(entity?.kind ?? entity?.type ?? '').toLowerCase();
}

function entityHasType(entity, candidates) {
  const accepted = candidates instanceof Set ? candidates : new Set(candidates);
  return accepted.has(String(entity?.kind ?? '').toLowerCase())
    || accepted.has(String(entity?.type ?? '').toLowerCase());
}

function validateEntities(document, diagnostics, context) {
  if (!Array.isArray(document.entities)) {
    diagnostics.push(error('entities-not-array', '$.entities', 'entities must be an array.'));
    return new Map();
  }
  checkUniqueIds(document.entities, '$.entities', 'entity', diagnostics);
  const entityById = new Map();
  for (const [index, entity] of document.entities.entries()) {
    if (nonEmptyString(entity?.id) && !entityById.has(entity.id)) entityById.set(entity.id, entity);
    if (!nonEmptyString(entity?.kind ?? entity?.type)) {
      diagnostics.push(error('entity-kind-missing', `$.entities[${index}].kind`, 'Entity requires a kind or type.'));
    }
    if (entity?.roomId !== undefined && !context.roomById.has(entity.roomId)) {
      diagnostics.push(error(
        'entity-room-reference-missing',
        `$.entities[${index}].roomId`,
        `Entity references unknown room ${entity.roomId}.`,
        { entityId: entity?.id, roomId: entity.roomId },
      ));
    }
    if (entity?.transform !== undefined) checkTransform(entity.transform, `$.entities[${index}].transform`, diagnostics);
    for (const field of ['targetId', 'controlId', 'doorId', 'requiresEntityId']) {
      const target = entity?.properties?.[field];
      if (target !== undefined && !document.entities.some(({ id }) => id === target)) {
        diagnostics.push(error(
          'entity-reference-missing',
          `$.entities[${index}].properties.${field}`,
          `Entity references unknown entity ${target}.`,
          { entityId: entity?.id, targetId: target, field },
        ));
      }
    }
  }
  return entityById;
}

function gameplayChecks(document, diagnostics, context, validConnections, entityById, options) {
  const spawnId = document.spawnId ?? document.settings?.spawnId ?? null;
  const spawnTypes = new Set(['spawn', 'player-spawn', 'player_spawn', 'dungeon-start']);
  const spawnEntities = document.entities.filter((entity) => entityHasType(entity, spawnTypes));
  let spawn = spawnId ? entityById.get(spawnId) : spawnEntities[0];
  if (spawnId && !spawn) {
    diagnostics.push(error('spawn-reference-missing', '$.spawnId', `spawnId references unknown entity ${spawnId}.`));
  }
  if (!spawn && options.requireSpawn !== false && document.rooms.length > 0) {
    diagnostics.push(error('player-spawn-missing', '$.entities', 'Authored dungeon requires a player spawn entity.'));
  }
  if (spawnEntities.length > 1 && !spawnId) {
    diagnostics.push(warning(
      'multiple-player-spawns',
      '$.entities',
      'Multiple player spawns exist but no explicit spawnId selects one.',
      { spawnIds: spawnEntities.map(({ id }) => id) },
    ));
  }
  if (spawn && !spawn.roomId) {
    diagnostics.push(error('spawn-room-missing', '$.entities', 'Player spawn must belong to a room.', { spawnId: spawn.id }));
  }

  const graph = new Map([...context.roomById.keys()].map((id) => [id, new Set()]));
  validConnections.forEach(({ connection, from, to }) => {
    graph.get(from.roomId)?.add(to.roomId);
    if (connection.bidirectional !== false) graph.get(to.roomId)?.add(from.roomId);
  });
  if (spawn?.roomId && graph.has(spawn.roomId)) {
    const reachable = new Set([spawn.roomId]);
    const queue = [spawn.roomId];
    while (queue.length) {
      for (const next of graph.get(queue.shift()) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
    document.rooms.forEach((room, index) => {
      const id = roomInstanceId(room);
      if (!reachable.has(id)) {
        diagnostics.push(warning(
          'room-unreachable-from-spawn',
          `$.rooms[${index}]`,
          `Room ${id} is unreachable from the player spawn.`,
          { roomId: id, spawnRoomId: spawn.roomId },
        ));
      }
    });
    document.entities.forEach((entity, index) => {
      const required = entity?.properties?.required === true
        || entityHasType(entity, new Set(['extraction', 'objective', 'boss', 'boss-arena']));
      if (required && entity.roomId && !reachable.has(entity.roomId)) {
        diagnostics.push(error(
          'required-gameplay-unreachable',
          `$.entities[${index}]`,
          `Required ${entityKind(entity)} entity ${entity.id} is unreachable from spawn.`,
          { entityId: entity.id, roomId: entity.roomId },
        ));
      }
    });
  }
  const hasExtraction = document.entities.some((entity) => entityHasType(
    entity,
    new Set(['extraction', 'exit', 'level-exit', 'room-exit']),
  ));
  if (!hasExtraction && document.rooms.length > 0 && options.requireExtraction === true) {
    diagnostics.push(error('extraction-missing', '$.entities', 'Authored dungeon requires an extraction entity.'));
  }
}

function validateDungeonLike(document, options = {}) {
  const diagnostics = [];
  const unsafe = jsonSafetyDiagnostic(document);
  if (unsafe) return resultFor([unsafe]);
  if (!object(document)) return resultFor([error('document-not-object', '$', 'Document must be an object.')]);
  const context = validateRoomsAndReferences(document, diagnostics, options);
  const validConnections = validateConnections(document, diagnostics, context);
  const entityById = validateEntities(document, diagnostics, context);
  gameplayChecks(document, diagnostics, context, validConnections, entityById, options);
  return resultFor(diagnostics);
}

export function validateLevelEditorProject(project, options = {}) {
  const base = validateDungeonLike(project, { ...options, requireSpawn: options.requireSpawn ?? false });
  const diagnostics = [...base.diagnostics];
  if (object(project)) {
    checkSchema(project, LEVEL_EDITOR_PROJECT_SCHEMA, diagnostics);
    checkIdentifier(project.projectId, '$.projectId', 'Project id', diagnostics);
    if (!nonEmptyString(project.name)) diagnostics.push(error('project-name-missing', '$.name', 'Project name is required.'));
    if (!Number.isInteger(project.revision) || project.revision < 1) {
      diagnostics.push(error('project-revision-invalid', '$.revision', 'Project revision must be a positive integer.'));
    }
    if (!Array.isArray(project.assets)) diagnostics.push(error('assets-not-array', '$.assets', 'assets must be an array.'));
    else {
      checkUniqueIds(project.assets, '$.assets', 'asset', diagnostics, (asset) => asset?.hash ?? asset?.id);
      project.assets.forEach((asset, index) => {
        const hash = asset?.hash ?? asset?.id;
        if (hash && !/^sha256:[0-9a-f]{64}$/i.test(hash)) {
          diagnostics.push(warning(
            'asset-hash-nonstandard',
            `$.assets[${index}].hash`,
            'Asset hash should use sha256:<64 lowercase hex digits>.',
            { hash },
          ));
        }
      });
    }
    const assetHashes = new Set((project.assets ?? []).map((asset) => asset?.hash ?? asset?.id));
    (project.entities ?? []).forEach((entity, index) => {
      if (entity.assetHash && !assetHashes.has(entity.assetHash)) {
        diagnostics.push(error(
          'entity-asset-reference-missing',
          `$.entities[${index}].assetHash`,
          `Entity references unknown asset ${entity.assetHash}.`,
        ));
      }
    });
  }
  return resultFor(diagnostics);
}

export function validateAuthoredDungeon(dungeon, options = {}) {
  const base = validateDungeonLike(dungeon, { ...options, requireSpawn: options.requireSpawn ?? true });
  const diagnostics = [...base.diagnostics];
  if (object(dungeon)) {
    checkSchema(dungeon, AUTHORED_DUNGEON_SCHEMA, diagnostics);
    checkIdentifier(dungeon.dungeonId, '$.dungeonId', 'Dungeon id', diagnostics);
    if (!Number.isInteger(dungeon.revision) || dungeon.revision < 1) {
      diagnostics.push(error('dungeon-revision-invalid', '$.revision', 'Dungeon revision must be a positive integer.'));
    }
    if (!nonEmptyString(dungeon.contentHash)) {
      diagnostics.push(error('dungeon-content-hash-missing', '$.contentHash', 'Compiled dungeon requires contentHash.'));
    } else if (options.verifyHash !== false) {
      const actual = canonicalHash(dungeon, {
        namespace: AUTHORED_DUNGEON_SCHEMA,
        omitKeys: ['contentHash'],
      });
      if (actual !== dungeon.contentHash) {
        diagnostics.push(error(
          'dungeon-content-hash-mismatch',
          '$.contentHash',
          'contentHash does not match the canonical authored dungeon.',
          { expected: actual, actual: dungeon.contentHash },
        ));
      }
    }
  }
  return resultFor(diagnostics);
}

export function diagnosticsToText(validation) {
  return (validation?.diagnostics ?? []).map((entry) => (
    `[${entry.severity}] ${entry.code} ${entry.path}: ${entry.message}`
  )).join('\n');
}

export class LevelDataValidationError extends Error {
  constructor(message, validation) {
    super(message);
    this.name = 'LevelDataValidationError';
    this.validation = validation;
    this.diagnostics = validation?.diagnostics ?? [];
  }
}

export function throwForInvalidLevelData(validation, message = 'Invalid authored level data.') {
  if (!validation?.ok) throw new LevelDataValidationError(message, validation);
  return validation;
}

export function sameCanonicalValue(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}
