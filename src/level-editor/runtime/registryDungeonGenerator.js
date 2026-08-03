import { AuthoredRoomRegistry } from './AuthoredRoomRegistry.js';
import { asArray, cloneData, finiteNumber, normalizeId, readSize3, readVector3 } from './utils.js';

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value ?? 'authored-registry')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function definitionRoles(definition) {
  return [...new Set([
    definition.role,
    definition.roomRole,
    definition.category,
    ...asArray(definition.roles).map((entry) => entry.value ?? entry.id ?? entry),
    ...asArray(definition.metadata?.roles).map((entry) => entry.value ?? entry.id ?? entry),
    ...asArray(definition.tags).map((entry) => entry.value ?? entry.id ?? entry),
  ].map((value) => normalizeId(value).toLowerCase()).filter(Boolean))];
}

function normalizeRoleRequests(roles, catalog) {
  const source = asArray(roles);
  if (source.length === 0) {
    const available = [...new Set(catalog.flatMap(({ roles: values }) => values))];
    const defaults = ['entrance', 'combat', 'exit'].filter((role) => available.includes(role));
    return (defaults.length > 0 ? defaults : available.slice(0, Math.min(3, available.length)))
      .map((role) => ({ role, count: 1, required: true }));
  }
  return source.flatMap((entry) => {
    const record = typeof entry === 'string' ? { role: entry } : entry;
    const count = Math.max(1, Math.floor(finiteNumber(record.count, 1)));
    return Array.from({ length: count }, (_, index) => ({
      ...cloneData(record),
      role: normalizeId(record.role ?? record.id ?? record.value).toLowerCase(),
      occurrence: index,
      count,
      required: record.required !== false,
    }));
  });
}

function weightedPick(candidates, random) {
  if (candidates.length === 0) return null;
  const weighted = candidates.map((candidate) => ({
    candidate,
    weight: Math.max(0, finiteNumber(
      candidate.definition.selectionWeight
        ?? candidate.definition.weight
        ?? candidate.definition.metadata?.selectionWeight,
      1,
    )),
  }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return candidates[Math.floor(random() * candidates.length)];
  let cursor = random() * total;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.candidate;
  }
  return weighted.at(-1).candidate;
}

function socketPosition(socket) {
  return readVector3(socket.position ?? socket.transform?.position ?? {
    x: socket.x,
    y: socket.y ?? socket.elevation,
    z: socket.z,
  });
}

function socketFacing(socket) {
  const facing = readVector3(socket.facing ?? socket.transform?.facing ?? {
    x: socket.facingX,
    y: socket.facingY,
    z: socket.facingZ,
  }, { x: 0, y: 0, z: 1 });
  facing.y = 0;
  return facing.lengthSq() > 0.0001 ? facing.normalize() : facing.set(0, 0, 1);
}

function socketFamilies(socket) {
  return [...new Set([
    ...asArray(socket?.compatibleConnectorFamilies),
    ...asArray(socket?.compatibleFamilies),
    ...asArray(socket?.connectorFamilies),
    ...asArray(socket?.families),
    socket?.family,
  ].map((value) => normalizeId(value).toLowerCase()).filter(Boolean))];
}

function socketsCompatible(outputSocket, inputSocket) {
  const outputFamilies = socketFamilies(outputSocket);
  const inputFamilies = socketFamilies(inputSocket);
  const familyAccepted = outputFamilies.length === 0
    || inputFamilies.length === 0
    || outputFamilies.some((family) => inputFamilies.includes(family));
  const outputActor = normalizeId(outputSocket?.actorKind ?? outputSocket?.actor).toLowerCase();
  const inputActor = normalizeId(inputSocket?.actorKind ?? inputSocket?.actor).toLowerCase();
  const actorAccepted = !outputActor || !inputActor
    || outputActor === 'any' || inputActor === 'any'
    || outputActor === inputActor;
  return familyAccepted && actorAccepted;
}

function allowedQuarterTurns(definition) {
  const configured = asArray(
    definition?.selection?.allowedQuarterTurns
      ?? definition?.allowedQuarterTurns
      ?? definition?.selection?.rotations,
  );
  const values = configured.map((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.abs(numeric) > 3 ? Math.round(numeric / 90) : Math.round(numeric);
  }).filter((value) => value !== null).map((value) => ((value % 4) + 4) % 4);
  return values.length > 0 ? [...new Set(values)] : [0, 1, 2, 3];
}

function rotateQuarter(vector, quarterTurns) {
  const quarter = ((quarterTurns % 4) + 4) % 4;
  if (quarter === 1) return vector.set(vector.z, vector.y, -vector.x);
  if (quarter === 2) return vector.set(-vector.x, vector.y, -vector.z);
  if (quarter === 3) return vector.set(-vector.z, vector.y, vector.x);
  return vector;
}

function definitionDimensions(definition, tileSize) {
  return readSize3(definition.dimensions ?? {
    x: definition.widthMeters ?? finiteNumber(definition.width, 3) * tileSize,
    y: definition.heightMeters ?? finiteNumber(definition.height, 3) * tileSize,
    z: definition.depthMeters ?? finiteNumber(definition.depth, 3) * tileSize,
  });
}

function rotatedFootprint(dimensions, quarterTurns) {
  return quarterTurns % 2 === 0
    ? { width: dimensions.x, depth: dimensions.z }
    : { width: dimensions.z, depth: dimensions.x };
}

function boundsFor(position, dimensions, quarterTurns, padding = 0) {
  const footprint = rotatedFootprint(dimensions, quarterTurns);
  return {
    minX: position.x - footprint.width * 0.5 - padding,
    maxX: position.x + footprint.width * 0.5 + padding,
    minZ: position.z - footprint.depth * 0.5 - padding,
    maxZ: position.z + footprint.depth * 0.5 + padding,
  };
}

function overlaps(bounds, placedBounds) {
  return placedBounds.some((other) => !(
    bounds.maxX <= other.minX
      || bounds.minX >= other.maxX
      || bounds.maxZ <= other.minZ
      || bounds.minZ >= other.maxZ
  ));
}

function worldSockets(definition, placement) {
  return asArray(definition.sockets ?? definition.socketFrames).map((socket, index) => {
    const localPosition = rotateQuarter(socketPosition(socket), placement.quarterTurns);
    const facing = rotateQuarter(socketFacing(socket), placement.quarterTurns);
    return {
      ...cloneData(socket),
      id: normalizeId(socket.id, `socket-${index + 1}`),
      position: localPosition.add(readVector3(placement.position)),
      facing,
      used: false,
    };
  });
}

function chooseSocketPair(previous, candidateDefinition, random) {
  const previousSockets = previous.sockets.filter((socket) => !socket.used);
  const candidateSockets = asArray(candidateDefinition.sockets ?? candidateDefinition.socketFrames);
  if (previousSockets.length === 0 || candidateSockets.length === 0) return null;
  const compatiblePairs = previousSockets.flatMap((outputSocket) => candidateSockets
    .filter((inputSocket) => socketsCompatible(outputSocket, inputSocket))
    .map((inputSocket) => ({ outputSocket, inputSocket })));
  if (compatiblePairs.length === 0) return null;
  const { outputSocket, inputSocket } = compatiblePairs[Math.floor(random() * compatiblePairs.length)];
  let bestQuarter = 0;
  let bestDot = Infinity;
  for (const quarter of allowedQuarterTurns(candidateDefinition)) {
    const facing = rotateQuarter(socketFacing(inputSocket), quarter);
    const dot = facing.dot(outputSocket.facing);
    if (dot < bestDot) {
      bestDot = dot;
      bestQuarter = quarter;
    }
  }
  return { outputSocket, inputSocket, quarterTurns: bestQuarter, facingDot: bestDot };
}

function canConnectToPrevious(previous, definition) {
  const previousSockets = previous?.sockets?.filter((socket) => !socket.used) ?? [];
  const candidateSockets = asArray(definition?.sockets ?? definition?.socketFrames);
  return previousSockets.some((output) => candidateSockets.some((input) => socketsCompatible(output, input)));
}

async function buildCatalog(registry) {
  const catalog = [];
  for (const id of registry.ids()) {
    try {
      const definition = await registry.resolve({ id: `${id}-catalog`, moduleId: id }, { catalog: true });
      catalog.push({ id, definition, roles: definitionRoles(definition) });
    } catch {
      // Factories that require instance-only context remain available to direct
      // authored compilation but cannot participate in weighted generation.
    }
  }
  return catalog;
}

/**
 * Deterministically selects registry modules by role and places them using
 * quarter turns. It favors socket-to-socket placement, then records any
 * fallback rather than silently producing a different topology.
 */
export async function generateRegistryDungeon(registryInput, {
  seed = 'registry-dungeon',
  roles = null,
  maxAttempts = 64,
  tileSize = 2.8,
  corridorLength = tileSize * 3,
  allowRepeat = false,
  dungeonId = null,
  createSpawn = true,
} = {}) {
  const registry = AuthoredRoomRegistry.from(registryInput);
  const random = createRandom(seed);
  const catalog = await buildCatalog(registry);
  const requests = normalizeRoleRequests(roles, catalog);
  const diagnostics = {
    schema: 'ruindivex-registry-generation-diagnostics/v1',
    seed: String(seed),
    maxAttempts,
    attempts: 0,
    accepted: true,
    selections: [],
    placements: [],
    fallbacks: [],
    errors: [],
    warnings: [],
  };
  if (catalog.length === 0) diagnostics.errors.push('The authored room registry has no materializable modules.');
  if (requests.length === 0) diagnostics.errors.push('No generation roles were requested or discoverable.');
  const rooms = [];
  const connections = [];
  const placed = [];
  const placedBounds = [];
  const usedModuleIds = new Set();

  for (let requestIndex = 0; requestIndex < requests.length; requestIndex += 1) {
    const request = requests[requestIndex];
    let candidates = catalog.filter((entry) => entry.roles.includes(request.role));
    if (!allowRepeat) candidates = candidates.filter((entry) => !usedModuleIds.has(entry.id));
    if (candidates.length === 0) {
      const fallbackCandidates = allowRepeat ? catalog : catalog.filter((entry) => !usedModuleIds.has(entry.id));
      if (fallbackCandidates.length === 0) {
        const message = `No registry module can satisfy role ${request.role}.`;
        if (request.required) diagnostics.errors.push(message);
        else diagnostics.warnings.push(message);
        continue;
      }
      candidates = fallbackCandidates;
      diagnostics.fallbacks.push({
        role: request.role,
        reason: 'no-role-match',
        candidateIds: candidates.map((entry) => entry.id),
      });
    }
    if (placed.length > 0) {
      const connectable = candidates.filter((entry) => canConnectToPrevious(placed.at(-1), entry.definition));
      if (connectable.length === 0) {
        const alternateCandidates = catalog.filter((entry) => (
          (allowRepeat || !usedModuleIds.has(entry.id))
          && canConnectToPrevious(placed.at(-1), entry.definition)
        ));
        if (alternateCandidates.length === 0) {
          diagnostics.errors.push(`No registry module with compatible sockets can satisfy role ${request.role}.`);
          continue;
        }
        diagnostics.fallbacks.push({
          role: request.role,
          reason: 'no-compatible-role-socket',
          candidateIds: alternateCandidates.map((entry) => entry.id),
        });
        candidates = alternateCandidates;
      } else {
        candidates = connectable;
      }
    }
    const selected = weightedPick(candidates, random);
    const instanceId = normalizeId(request.instanceId, `${request.role || 'room'}-${rooms.length + 1}`);
    const dimensions = definitionDimensions(selected.definition, tileSize);
    let placement = null;
    let socketPair = null;
    if (placed.length === 0) {
      placement = { position: { x: 0, y: 0, z: 0 }, quarterTurns: Math.floor(random() * 4), fallback: false };
    } else {
      const previous = placed.at(-1);
      for (let attempt = 0; attempt < maxAttempts && !placement; attempt += 1) {
        diagnostics.attempts += 1;
        socketPair = chooseSocketPair(previous, selected.definition, random);
        if (!socketPair) break;
        const inputLocal = rotateQuarter(socketPosition(socketPair.inputSocket), socketPair.quarterTurns);
        const gapMultiplier = 1 + Math.floor(attempt / 4);
        const targetSocketPosition = socketPair.outputSocket.position.clone()
          .addScaledVector(socketPair.outputSocket.facing, corridorLength * gapMultiplier);
        const candidatePosition = targetSocketPosition.sub(inputLocal);
        const candidateBounds = boundsFor(candidatePosition, dimensions, socketPair.quarterTurns, tileSize * 0.1);
        if (!overlaps(candidateBounds, placedBounds)) {
          placement = {
            position: { x: candidatePosition.x, y: candidatePosition.y, z: candidatePosition.z },
            quarterTurns: socketPair.quarterTurns,
            fallback: false,
          };
        }
      }
      if (!placement) {
        const spacing = corridorLength + dimensions.x + dimensions.z;
        const column = rooms.length % 4;
        const row = Math.floor(rooms.length / 4);
        placement = {
          position: { x: column * spacing, y: 0, z: row * spacing },
          quarterTurns: Math.floor(random() * 4),
          fallback: true,
        };
        diagnostics.fallbacks.push({
          role: request.role,
          moduleId: selected.id,
          reason: socketPair ? 'placement-attempts-exhausted' : 'missing-compatible-sockets',
          position: cloneData(placement.position),
        });
      }
    }

    const room = {
      id: instanceId,
      roomId: instanceId,
      moduleId: selected.id,
      dimensions: { x: dimensions.x, y: dimensions.y, z: dimensions.z },
      transform: {
        position: cloneData(placement.position),
        rotationDegrees: { x: 0, y: placement.quarterTurns * 90, z: 0 },
      },
      properties: { generatedRole: request.role, generationSeed: String(seed) },
    };
    const worldSocketRecords = worldSockets(selected.definition, placement);
    const placementRecord = {
      room,
      moduleId: selected.id,
      definition: selected.definition,
      dimensions,
      quarterTurns: placement.quarterTurns,
      position: cloneData(placement.position),
      sockets: worldSocketRecords,
    };
    rooms.push(room);
    placed.push(placementRecord);
    placedBounds.push(boundsFor(placement.position, dimensions, placement.quarterTurns, tileSize * 0.1));
    usedModuleIds.add(selected.id);
    diagnostics.selections.push({ role: request.role, moduleId: selected.id, instanceId });
    diagnostics.placements.push({ instanceId, moduleId: selected.id, ...cloneData(placement) });

    if (placed.length > 1) {
      const previous = placed.at(-2);
      let fromSocket = socketPair?.outputSocket;
      let toSocket = worldSocketRecords.find((socket) => socket.id === socketPair?.inputSocket?.id);
      if (!fromSocket) fromSocket = previous.sockets.find((socket) => !socket.used) ?? previous.sockets[0];
      if (!toSocket) toSocket = worldSocketRecords[0];
      if (fromSocket && toSocket) {
        fromSocket.used = true;
        toSocket.used = true;
        const elevationDelta = toSocket.position.y - fromSocket.position.y;
        connections.push({
          id: `${previous.room.id}-to-${instanceId}`,
          from: { roomId: previous.room.id, socketId: fromSocket.id },
          to: { roomId: instanceId, socketId: toSocket.id },
          kind: Math.abs(elevationDelta) > 0.05 ? 'slope' : 'service-gallery',
          bidirectional: true,
          properties: { generated: true, widthMeters: tileSize * 3 },
        });
      } else {
        diagnostics.warnings.push(`Generated rooms ${previous.room.id} and ${instanceId} have no sockets to connect.`);
      }
    }
  }

  diagnostics.accepted = diagnostics.errors.length === 0;
  const generatedId = dungeonId ?? `registry-${hashSeed(`${seed}:${rooms.map((room) => room.moduleId).join(',')}`).toString(16)}`;
  const entities = createSpawn && rooms[0]
    ? [{
        id: 'generated-player-start',
        kind: 'gameplay',
        type: 'playerStart',
        roomId: rooms[0].id,
        transform: { position: { x: 0, y: 0, z: 0 } },
        properties: { primary: true },
      }]
    : [];
  const dungeon = {
    schema: 'ruindivex-authored-dungeon/v1',
    dungeonId: generatedId,
    revision: 1,
    rooms,
    connections,
    entities,
    spawnId: entities[0]?.id ?? null,
    tileSize,
    metadata: {
      generatedFromRegistry: true,
      generationSeed: String(seed),
      requestedRoles: requests.map((request) => request.role),
    },
    contentHash: `generated:${hashSeed(JSON.stringify({ seed, rooms, connections })).toString(16).padStart(8, '0')}`,
  };
  return {
    ...dungeon,
    ok: diagnostics.accepted,
    dungeon,
    compiled: dungeon,
    diagnostics,
    registry,
  };
}

export const createRegistryDungeonPlan = generateRegistryDungeon;
export const generateAuthoredDungeonFromRegistry = generateRegistryDungeon;
