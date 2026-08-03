import {
  AUTHORED_DUNGEON_SCHEMA,
  LEVEL_EDITOR_PROJECT_SCHEMA,
  canonicalHash,
  compileEditorProject,
  validateAuthoredDungeon,
  validateLevelEditorProject,
  validateRoomRegistry,
} from '../core/index.js';
import {
  assembleAuthoredDungeon,
  createAuthoredProgression,
  createAuthoredProgressionData,
} from '../runtime/index.js';
import {
  LEVEL_FORGE_GENERATOR_VERSION,
  LEVEL_FORGE_RECEIPT_SCHEMA,
  createForgeDiagnostic,
  forgeResult,
} from './contracts.js';

const PROGRESSION_RECEIPT_SCHEMA = 'ruindivex-level-forge-progression-receipt/v1';
const TRAVERSAL_RECEIPT_SCHEMA = 'ruindivex-level-forge-traversal-receipt/v1';
const VALIDATION_RECEIPT_SCHEMA = 'ruindivex-level-forge-validation-receipt/v1';

function id(value) {
  return String(value ?? '').trim();
}

function entityType(entity) {
  return String(entity?.type ?? entity?.kind ?? '')
    .replace(/[\s_-]/g, '')
    .toLowerCase();
}

function endpointRoom(connection, side) {
  const endpoint = connection?.[side]
    ?? connection?.[side === 'from' ? 'source' : 'destination']
    ?? connection?.[side === 'from' ? 'a' : 'b']
    ?? {};
  if (typeof endpoint === 'string') return endpoint.includes(':') ? endpoint.split(':')[0] : endpoint;
  return id(endpoint.roomId
    ?? endpoint.room
    ?? connection?.[`${side}RoomId`]
    ?? connection?.[side === 'from' ? 'sourceRoomId' : 'destinationRoomId']);
}

function finiteVector(value) {
  return Boolean(value
    && Number.isFinite(Number(value.x))
    && Number.isFinite(Number(value.y))
    && Number.isFinite(Number(value.z)));
}

function flattenConnection(connection) {
  return {
    ...(connection?.properties ?? {}),
    ...connection,
    from: connection?.from,
    to: connection?.to,
  };
}

function sourceDungeon(input) {
  return input?.dungeon
    ?? input?.compiled?.dungeon
    ?? input?.compiled?.value
    ?? (input?.schema === AUTHORED_DUNGEON_SCHEMA ? input : null)
    ?? input?.value?.dungeon
    ?? input?.value;
}

function uniqueDiagnostics(diagnostics) {
  const seen = new Set();
  return diagnostics.filter((entry) => {
    const key = [entry.severity, entry.code, entry.path, entry.message].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scopedDiagnostic(entry, scope) {
  return {
    ...entry,
    details: { ...(entry.details ?? {}), scope },
  };
}

function generatedProjectMetadata(project) {
  const metadata = project?.metadata ?? {};
  const moduleMetadata = (project?.roomModules ?? []).map((module) => module?.metadata ?? {});
  const generatedContent = metadata.authoredBy === 'RuinDiver Level Forge'
    || Boolean(metadata.generator ?? metadata.generatorVersion ?? metadata.sourceSpecHash ?? metadata.promptSpecHash)
    || moduleMetadata.some((entry) => entry.authoredBy === 'RuinDiver Level Forge'
      || Boolean(entry.generator ?? entry.generatorVersion ?? entry.sourceSpecHash ?? entry.promptSpecHash));
  return {
    generatedContent,
    promptSpecHash: id(
      metadata.promptSpecHash
        ?? metadata.sourceSpecHash
        ?? project?.settings?.levelForgeSpecHash,
    ) || null,
    generatorVersion: id(metadata.generatorVersion ?? metadata.generator) || null,
  };
}

function normalizedSpecHash(value) {
  const spec = value?.spec ?? value?.value ?? value;
  return id(spec?.specHash) || null;
}

function progressionSource(dungeon) {
  const entities = Array.isArray(dungeon?.entities) ? dungeon.entities : [];
  const spawn = entities.find((entity) => [
    'spawn', 'playerspawn', 'playerstart', 'dungeonstart',
  ].includes(entityType(entity)));
  return {
    ...dungeon,
    entranceRoomId: spawn?.roomId ?? dungeon?.entranceRoomId,
    connections: (dungeon?.connections ?? []).map(flattenConnection),
  };
}

function stateHash(manager, reachableRoomIds) {
  return canonicalHash({
    state: manager.snapshot(),
    reachableRoomIds: [...reachableRoomIds].sort(),
  }, { namespace: PROGRESSION_RECEIPT_SCHEMA });
}

/** Solve credentials and authored state gates without mutating the dungeon. */
export function solveAuthoredProgression(input, options = {}) {
  const diagnostics = [];
  let dungeon = sourceDungeon(input);
  let compiled = null;
  if (dungeon?.schema === LEVEL_EDITOR_PROJECT_SCHEMA || input?.schema === LEVEL_EDITOR_PROJECT_SCHEMA) {
    compiled = compileEditorProject(dungeon?.schema === LEVEL_EDITOR_PROJECT_SCHEMA ? dungeon : input, {
      requireSpawn: true,
      requireExtraction: true,
    });
    diagnostics.push(...compiled.diagnostics.map((entry) => scopedDiagnostic(entry, 'compile')));
    dungeon = compiled.dungeon ?? compiled.candidate;
  }
  if (!dungeon || dungeon.schema !== AUTHORED_DUNGEON_SCHEMA) {
    diagnostics.push(createForgeDiagnostic(
      'error',
      'PROGRESSION_SOURCE_INVALID',
      '$',
      'Progression solving requires an authored dungeon or editable level project.',
    ));
    return forgeResult(uniqueDiagnostics(diagnostics), { value: null, receipt: null });
  }

  const source = progressionSource(dungeon);
  const data = createAuthoredProgressionData(source);
  for (const message of data.validation?.errors ?? []) {
    diagnostics.push(createForgeDiagnostic('error', 'PROGRESSION_DATA_INVALID', '$.progression', message));
  }
  for (const message of data.validation?.warnings ?? []) {
    diagnostics.push(createForgeDiagnostic('warning', 'PROGRESSION_DATA_WARNING', '$.progression', message));
  }
  const manager = createAuthoredProgression(data, { initialState: options.initialState ?? null });
  const entities = Array.isArray(source.entities) ? source.entities : [];
  const extractionRoomIds = [...new Set(entities
    .filter((entity) => ['exit', 'extraction', 'levelexit', 'roomexit'].includes(entityType(entity)))
    .map((entity) => id(entity.roomId))
    .filter(Boolean))].sort();
  if (extractionRoomIds.length === 0 && options.requireExtraction !== false) {
    diagnostics.push(createForgeDiagnostic(
      'error',
      'PROGRESSION_EXTRACTION_MISSING',
      '$.entities',
      'The authored dungeon has no extraction target.',
    ));
  }

  const acquiredCredentialIds = new Set(manager.collectedKeycardIds);
  const completedEncounterIds = new Set(manager.completedEncounterIds);
  const activatedMechanismIds = new Set(manager.activatedMechanismIds);
  const activatedPressurePlateIds = new Set(manager.activatedPressurePlateIds);
  const visitedStateHashes = new Set();
  const traversalOrder = [];
  let reachable = manager.getReachableRooms();
  let repeatedStateGuardTriggered = false;
  let passes = 0;
  const maxPasses = Math.max(1, Math.min(64, Math.trunc(Number(options.maxPasses) || 32)));

  while (passes < maxPasses) {
    passes += 1;
    const hash = stateHash(manager, reachable);
    if (visitedStateHashes.has(hash)) {
      repeatedStateGuardTriggered = true;
      break;
    }
    visitedStateHashes.add(hash);
    for (const roomId of [...reachable].sort()) {
      if (!traversalOrder.includes(roomId)) traversalOrder.push(roomId);
    }
    let changed = false;
    for (const keycard of data.keycards) {
      if (!reachable.has(id(keycard.spawnRoomId))) continue;
      for (const credentialId of [...new Set([keycard.keycardId, keycard.credentialId].filter(Boolean))]) {
        if (manager.collectCredential(credentialId)) changed = true;
        acquiredCredentialIds.add(credentialId);
      }
    }
    for (const entity of entities) {
      if (entity.roomId && !reachable.has(id(entity.roomId))) continue;
      const type = entityType(entity);
      if (['encounter', 'combatencounter', 'boss', 'bossarena'].includes(type)) {
        if (manager.completeEncounter(entity.id)) changed = true;
        completedEncounterIds.add(entity.id);
      } else if (['mechanism', 'switch', 'console'].includes(type)) {
        if (manager.activateMechanism(entity.id)) changed = true;
        activatedMechanismIds.add(entity.id);
      } else if (['pressureplate', 'plate'].includes(type)) {
        if (manager.activatePressurePlate(entity.id)) changed = true;
        activatedPressurePlateIds.add(entity.id);
      }
    }
    for (const door of manager.doors) {
      if (!manager.canOpenDoor(door)) continue;
      if (manager.openDoor(door.doorId)) changed = true;
    }
    const nextReachable = manager.getReachableRooms();
    if (nextReachable.size !== reachable.size) changed = true;
    reachable = nextReachable;
    if (!changed) break;
  }

  const allRoomIds = [...new Set((dungeon.rooms ?? []).map((room) => id(room.id ?? room.roomId)).filter(Boolean))].sort();
  const unreachableRoomIds = allRoomIds.filter((roomId) => !reachable.has(roomId));
  const unreachableExtractionRoomIds = extractionRoomIds.filter((roomId) => !reachable.has(roomId));
  const blockedConnections = data.roomConnections
    .filter((connection) => {
      const fromReachable = reachable.has(connection.fromRoomId);
      const toReachable = reachable.has(connection.toRoomId);
      return (fromReachable !== toReachable) && !manager.canTraverse(connection, { reverse: toReachable });
    })
    .map((connection) => ({
      connectionId: connection.id,
      fromRoomId: connection.fromRoomId,
      toRoomId: connection.toRoomId,
      requirementStatus: manager.requirementStatus(connection),
    }));

  if (unreachableExtractionRoomIds.length > 0) {
    diagnostics.push(createForgeDiagnostic(
      'error',
      'PROGRESSION_UNSOLVABLE',
      '$.connections',
      `Extraction cannot be reached in room(s): ${unreachableExtractionRoomIds.join(', ')}.`,
      { unreachableExtractionRoomIds, blockedConnections },
    ));
  }
  if (options.requireAllRooms !== false && unreachableRoomIds.length > 0) {
    diagnostics.push(createForgeDiagnostic(
      'error',
      'PROGRESSION_ROOM_UNREACHABLE',
      '$.rooms',
      `Progression leaves room(s) unreachable: ${unreachableRoomIds.join(', ')}.`,
      { unreachableRoomIds, blockedConnections },
    ));
  }
  if (passes >= maxPasses && (unreachableExtractionRoomIds.length > 0 || unreachableRoomIds.length > 0)) {
    diagnostics.push(createForgeDiagnostic(
      'error',
      'PROGRESSION_PASS_LIMIT',
      '$.progression',
      `Progression solving reached its ${maxPasses}-pass limit.`,
    ));
  }

  const receipt = {
    schema: PROGRESSION_RECEIPT_SCHEMA,
    entranceRoomId: data.entranceRoomId,
    extractionRoomIds,
    reachableRoomIds: [...reachable].sort(),
    unreachableRoomIds,
    traversalOrder,
    acquiredCredentialIds: [...acquiredCredentialIds].sort(),
    completedEncounterIds: [...completedEncounterIds].sort(),
    activatedMechanismIds: [...activatedMechanismIds].sort(),
    activatedPressurePlateIds: [...activatedPressurePlateIds].sort(),
    blockedConnections,
    passes,
    repeatedStateGuardTriggered,
    finalState: manager.snapshot(),
  };
  receipt.receiptHash = canonicalHash(receipt, {
    namespace: PROGRESSION_RECEIPT_SCHEMA,
    omitKeys: ['receiptHash'],
  });
  return forgeResult(uniqueDiagnostics(diagnostics), {
    value: receipt,
    receipt,
    dungeon,
    compiled,
  });
}

function graphReachability(roomIds, connections, startRoomId) {
  const graph = new Map(roomIds.map((roomId) => [roomId, new Set()]));
  for (const connection of connections) {
    const from = id(connection.fromRoomId ?? endpointRoom(connection, 'from'));
    const to = id(connection.toRoomId ?? endpointRoom(connection, 'to'));
    if (!graph.has(from) || !graph.has(to)) continue;
    graph.get(from).add(to);
    if (connection.bidirectional !== false && connection.oneWay !== true) graph.get(to).add(from);
  }
  const reachable = new Set();
  const queue = startRoomId && graph.has(startRoomId) ? [startRoomId] : [];
  while (queue.length) {
    const roomId = queue.shift();
    if (reachable.has(roomId)) continue;
    reachable.add(roomId);
    for (const next of graph.get(roomId) ?? []) if (!reachable.has(next)) queue.push(next);
  }
  return reachable;
}

function unwrapSpec(spec) {
  return spec?.spec ?? spec?.value ?? spec ?? {};
}

/** Validate assembled traversal surfaces and topology without browser controls. */
export function validateFacadeTraversability(facade, rawSpec = {}) {
  const diagnostics = [];
  const spec = unwrapSpec(rawSpec);
  if (!facade || typeof facade !== 'object') {
    diagnostics.push(createForgeDiagnostic('error', 'FACADE_MISSING', '$', 'A dungeon facade is required.'));
    return forgeResult(diagnostics);
  }
  if (facade.diagnostics?.accepted === false) {
    diagnostics.push(createForgeDiagnostic(
      'error',
      'FACADE_ASSEMBLY_REJECTED',
      '$.diagnostics',
      'Strict authored assembly rejected the generated dungeon.',
      { errors: [...(facade.diagnostics.errors ?? [])] },
    ));
  }
  const roomIds = [...new Set((facade.rooms ?? []).map((room) => id(room.id ?? room.roomId)).filter(Boolean))];
  if (roomIds.length === 0) diagnostics.push(createForgeDiagnostic('error', 'FACADE_ROOMS_MISSING', '$.rooms', 'The facade has no rooms.'));
  const connections = facade.connections ?? [];
  const connectorDiagnostics = new Map((facade.connectorDiagnostics ?? [])
    .map((entry) => [id(entry.connectionId), entry]));
  for (const [index, connection] of connections.entries()) {
    const connectionId = id(connection.id ?? connection.connectionId);
    const fromRoomId = id(connection.fromRoomId ?? endpointRoom(connection, 'from'));
    const toRoomId = id(connection.toRoomId ?? endpointRoom(connection, 'to'));
    if (!roomIds.includes(fromRoomId) || !roomIds.includes(toRoomId)) {
      diagnostics.push(createForgeDiagnostic(
        'error',
        'FACADE_CONNECTION_ENDPOINT_INVALID',
        `$.connections[${index}]`,
        `Connection ${connectionId} has a missing facade room endpoint.`,
      ));
    }
    const connectorValidation = connectorDiagnostics.get(connectionId);
    if (!connectorValidation?.accepted) {
      diagnostics.push(createForgeDiagnostic(
        'error',
        'FACADE_CONNECTOR_REJECTED',
        `$.connectorDiagnostics[${index}]`,
        `Connection ${connectionId} failed strict connector validation.`,
        { connectorDiagnostic: connectorValidation ?? null },
      ));
    }
    const waypoints = connection.waypoints ?? connection.route?.waypoints ?? [];
    if (waypoints.length < 2 || !waypoints.every(finiteVector)) {
      diagnostics.push(createForgeDiagnostic(
        'error',
        'FACADE_ROUTE_INVALID',
        `$.connections[${index}].waypoints`,
        `Connection ${connectionId} does not expose a finite traversal route.`,
      ));
    }
    const kind = String(connection.kind ?? '').toLowerCase();
    if (['service-gallery', 'slope'].includes(kind)) {
      const floorSupport = (facade.floorTiles ?? []).some((tile) => id(tile.connectorId) === connectionId);
      const platformSupport = (facade.platforms ?? []).some((platform) => id(platform.connectorId) === connectionId);
      if (!floorSupport || !platformSupport) {
        diagnostics.push(createForgeDiagnostic(
          'error',
          'FACADE_CONNECTOR_SUPPORT_MISSING',
          `$.connections[${index}]`,
          `Connection ${connectionId} is missing continuous floor/platform support.`,
          { floorSupport, platformSupport },
        ));
      }
    } else if (kind === 'lift' && !(facade.connectorLifts ?? []).some((entry) => id(entry.id) === connectionId)) {
      diagnostics.push(createForgeDiagnostic('error', 'FACADE_LIFT_MISSING', `$.connections[${index}]`, `Connection ${connectionId} has no lift runtime record.`));
    } else if (kind === 'ladder' && !(facade.ladders ?? []).some((entry) => id(entry.id) === connectionId)) {
      diagnostics.push(createForgeDiagnostic('error', 'FACADE_LADDER_MISSING', `$.connections[${index}]`, `Connection ${connectionId} has no ladder runtime record.`));
    }
    if (spec.constraints?.grounded === true && ['lift', 'ladder', 'slope'].includes(kind)) {
      diagnostics.push(createForgeDiagnostic(
        'error',
        'FACADE_NOT_GROUNDED',
        `$.connections[${index}].kind`,
        `Grounded specification contains a ${kind} connection.`,
      ));
    }
  }

  for (const [index, room] of (facade.rooms ?? []).entries()) {
    const roomId = id(room.id ?? room.roomId);
    const floorSupport = (facade.floorTiles ?? []).some((tile) => id(tile.roomId) === roomId)
      || (facade.platforms ?? []).some((platform) => id(platform.roomId) === roomId);
    if (!floorSupport) {
      diagnostics.push(createForgeDiagnostic(
        'error',
        'FACADE_ROOM_FLOOR_MISSING',
        `$.rooms[${index}]`,
        `Room ${roomId} has no authored floor support.`,
      ));
    }
  }

  const entranceRoomId = id(facade.entranceRoomId ?? facade.progression?.entranceRoomId ?? roomIds[0]);
  const reachable = graphReachability(roomIds, connections, entranceRoomId);
  const unreachableRoomIds = roomIds.filter((roomId) => !reachable.has(roomId));
  if (unreachableRoomIds.length) {
    diagnostics.push(createForgeDiagnostic(
      'error',
      'FACADE_ROOM_UNREACHABLE',
      '$.rooms',
      `Facade topology leaves room(s) unreachable: ${unreachableRoomIds.join(', ')}.`,
      { entranceRoomId, unreachableRoomIds },
    ));
  }
  const extractionRoomIds = [...new Set((facade.exits ?? [])
    .map((exit) => id(exit.roomId))
    .filter(Boolean))];
  if (extractionRoomIds.length === 0) {
    diagnostics.push(createForgeDiagnostic('error', 'FACADE_EXTRACTION_MISSING', '$.exits', 'The facade has no extraction entity.'));
  } else {
    const unreachableExits = extractionRoomIds.filter((roomId) => !reachable.has(roomId));
    if (unreachableExits.length) diagnostics.push(createForgeDiagnostic(
      'error',
      'FACADE_EXTRACTION_UNREACHABLE',
      '$.exits',
      `Facade extraction is unreachable in room(s): ${unreachableExits.join(', ')}.`,
    ));
  }
  if (!finiteVector(facade.playerStart)) {
    diagnostics.push(createForgeDiagnostic('error', 'FACADE_PLAYER_START_INVALID', '$.playerStart', 'The facade player start is not finite.'));
  }
  if (spec.constraints?.grounded === true) {
    const elevations = (facade.rooms ?? []).map((room) => Number(room.baseElevation ?? room.position?.y));
    if (elevations.some((value) => !Number.isFinite(value))
      || elevations.some((value) => Math.abs(value - (elevations[0] ?? 0)) > 0.05)) {
      diagnostics.push(createForgeDiagnostic('error', 'FACADE_ELEVATION_CONFLICT', '$.rooms', 'A grounded facade must keep all room floors at one elevation.'));
    }
  }

  const receipt = {
    schema: TRAVERSAL_RECEIPT_SCHEMA,
    entranceRoomId,
    roomIds: [...roomIds].sort(),
    reachableRoomIds: [...reachable].sort(),
    unreachableRoomIds: [...unreachableRoomIds].sort(),
    extractionRoomIds: [...extractionRoomIds].sort(),
    connectionIds: connections.map((connection) => id(connection.id ?? connection.connectionId)).sort(),
    connectorDiagnosticsAccepted: (facade.connectorDiagnostics ?? []).every((entry) => entry.accepted === true),
    grounded: spec.constraints?.grounded === true,
  };
  receipt.receiptHash = canonicalHash(receipt, {
    namespace: TRAVERSAL_RECEIPT_SCHEMA,
    omitKeys: ['receiptHash'],
  });
  return forgeResult(uniqueDiagnostics(diagnostics), { value: receipt, receipt });
}

/** Compile, hash-check, solve, and strictly assemble an editable project. */
export async function validateGeneratedDungeon(input, options = {}) {
  const diagnostics = [];
  const project = input?.project
    ?? (input?.schema === LEVEL_EDITOR_PROJECT_SCHEMA ? input : null)
    ?? (input?.value?.schema === LEVEL_EDITOR_PROJECT_SCHEMA ? input.value : null);
  if (!project) {
    diagnostics.push(createForgeDiagnostic(
      'error',
      'GENERATED_PROJECT_MISSING',
      '$',
      'Generated dungeon validation requires an editable level project.',
    ));
    return forgeResult(diagnostics);
  }
  const forgeMetadata = generatedProjectMetadata(project);
  if (forgeMetadata.generatedContent && !forgeMetadata.promptSpecHash) {
    diagnostics.push(createForgeDiagnostic(
      'error',
      'FORGE_PROMPT_SPEC_HASH_MISSING',
      '$.metadata.promptSpecHash',
      'Generated Level Forge content must record its deterministic promptSpecHash in project metadata.',
      { legacyAliases: ['metadata.sourceSpecHash', 'settings.levelForgeSpecHash'] },
    ));
  } else if (forgeMetadata.promptSpecHash && !/^sha256:[0-9a-f]{64}$/i.test(forgeMetadata.promptSpecHash)) {
    diagnostics.push(createForgeDiagnostic(
      'error',
      'FORGE_PROMPT_SPEC_HASH_INVALID',
      '$.metadata.promptSpecHash',
      'Generated Level Forge promptSpecHash must be a canonical SHA-256 hash.',
      { promptSpecHash: forgeMetadata.promptSpecHash },
    ));
  }
  if (forgeMetadata.generatedContent && !forgeMetadata.generatorVersion) {
    diagnostics.push(createForgeDiagnostic(
      'error',
      'FORGE_GENERATOR_VERSION_MISSING',
      '$.metadata.generatorVersion',
      'Generated Level Forge content must record its generatorVersion in project metadata.',
      { expectedGeneratorVersion: LEVEL_FORGE_GENERATOR_VERSION, legacyAlias: 'metadata.generator' },
    ));
  }
  const expectedPromptSpecHash = normalizedSpecHash(options.spec ?? input?.spec);
  if (expectedPromptSpecHash
    && forgeMetadata.promptSpecHash
    && expectedPromptSpecHash !== forgeMetadata.promptSpecHash) {
    diagnostics.push(createForgeDiagnostic(
      'error',
      'FORGE_PROMPT_SPEC_HASH_MISMATCH',
      '$.metadata.promptSpecHash',
      'Generated project metadata does not match the prompt specification being validated.',
      { expected: expectedPromptSpecHash, actual: forgeMetadata.promptSpecHash },
    ));
  }
  const compiled = compileEditorProject(project, {
    requireSpawn: true,
    requireExtraction: true,
    verifyHash: true,
    warningsAsErrors: options.warningsAsErrors === true,
  });
  diagnostics.push(...compiled.diagnostics.map((entry) => scopedDiagnostic(entry, entry.details?.scope ?? 'compile')));
  const projectValidation = validateLevelEditorProject(compiled.project ?? project, {
    roomRegistry: compiled.registry,
    requireSpawn: true,
    requireExtraction: true,
  });
  diagnostics.push(...projectValidation.diagnostics.map((entry) => scopedDiagnostic(entry, 'project')));
  if (compiled.registry) {
    const registryValidation = validateRoomRegistry(compiled.registry, { verifyHash: true });
    diagnostics.push(...registryValidation.diagnostics.map((entry) => scopedDiagnostic(entry, 'roomRegistry')));
  }
  const dungeon = compiled.dungeon ?? compiled.candidate;
  if (dungeon && compiled.registry) {
    const dungeonValidation = validateAuthoredDungeon(dungeon, {
      roomRegistry: compiled.registry,
      requireSpawn: true,
      requireExtraction: true,
      verifyHash: true,
    });
    diagnostics.push(...dungeonValidation.diagnostics.map((entry) => scopedDiagnostic(entry, 'authoredDungeon')));
  }

  let progression = null;
  let traversal = null;
  if (compiled.ok && dungeon) {
    progression = solveAuthoredProgression(dungeon, {
      requireExtraction: true,
      requireAllRooms: true,
      ...(options.progression ?? {}),
    });
    diagnostics.push(...progression.diagnostics.map((entry) => scopedDiagnostic(entry, 'progression')));
  }
  if (compiled.ok && dungeon && options.strictAssembly !== false) {
    let facade = null;
    try {
      facade = await assembleAuthoredDungeon(compiled, {
        strict: true,
        roomRegistry: compiled.registry,
        createGameplayVisuals: options.createGameplayVisuals === true,
        createConnectorGeometry: options.createConnectorGeometry !== false,
        capUnusedSockets: true,
      });
      traversal = validateFacadeTraversability(facade, options.spec ?? input?.spec ?? {});
      diagnostics.push(...traversal.diagnostics.map((entry) => scopedDiagnostic(entry, 'facade')));
    } catch (caught) {
      const causes = caught instanceof AggregateError
        ? [...caught.errors].map((error) => error?.message ?? String(error))
        : [caught?.message ?? String(caught)];
      diagnostics.push(createForgeDiagnostic(
        'error',
        'STRICT_ASSEMBLY_FAILED',
        '$',
        'Generated dungeon failed strict authored assembly.',
        { causes },
      ));
    } finally {
      facade?.dispose?.();
    }
  }

  const finalDiagnostics = uniqueDiagnostics(diagnostics);
  const projectHash = canonicalHash(project, { namespace: LEVEL_EDITOR_PROJECT_SCHEMA });
  const receipt = {
    schema: VALIDATION_RECEIPT_SCHEMA,
    forgeReceiptSchema: LEVEL_FORGE_RECEIPT_SCHEMA,
    projectId: id(project.projectId),
    promptSpecHash: forgeMetadata.promptSpecHash,
    generatorVersion: forgeMetadata.generatorVersion,
    projectHash,
    dungeonHash: dungeon?.contentHash ?? null,
    registryHash: compiled.registry?.contentHash ?? null,
    roomCount: project.rooms?.length ?? 0,
    connectionCount: project.connections?.length ?? 0,
    entityCount: project.entities?.length ?? 0,
    strictAssembly: options.strictAssembly !== false,
    exactRegistry: true,
    registryFallback: false,
    progressionReceiptHash: progression?.receipt?.receiptHash ?? null,
    traversalReceiptHash: traversal?.receipt?.receiptHash ?? null,
  };
  receipt.receiptHash = canonicalHash(receipt, {
    namespace: VALIDATION_RECEIPT_SCHEMA,
    omitKeys: ['receiptHash'],
  });
  return forgeResult(finalDiagnostics, {
    value: receipt,
    project,
    dungeon,
    registry: compiled.registry,
    compiled,
    progression,
    traversal,
    receipt,
  });
}

export {
  PROGRESSION_RECEIPT_SCHEMA,
  TRAVERSAL_RECEIPT_SCHEMA,
  VALIDATION_RECEIPT_SCHEMA,
};
