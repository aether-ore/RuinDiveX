import { asArray, cloneData, normalizeId, unwrapCompiledSource } from './utils.js';

function gameplayRecords(source, typeNames, directKey) {
  const direct = asArray(source?.[directKey] ?? source?.gameplay?.[directKey]);
  if (direct.length > 0) return direct;
  const accepted = new Set(typeNames.map((value) => value.replace(/[\s_-]/g, '').toLowerCase()));
  return asArray(source?.entities).filter((entity) => accepted.has(
    String(entity?.type ?? entity?.kind ?? '').replace(/[\s_-]/g, '').toLowerCase(),
  )).map((entity) => ({ ...(entity.properties ?? {}), ...entity }));
}

function uniqueIds(...values) {
  const flattened = [];
  const visit = (value) => {
    if (Array.isArray(value) || value instanceof Set) {
      for (const entry of value) visit(entry);
    } else if (typeof value === 'string') {
      flattened.push(value);
    }
  };
  values.forEach(visit);
  return [...new Set(flattened.map(normalizeId).filter(Boolean))];
}

function normalizeDoor(door, index) {
  const doorId = normalizeId(door.doorId ?? door.id, `door-${index + 1}`);
  const requiredCredentialIds = uniqueIds(
    door.requiredCredentialIds,
    door.requiredCredentials,
    door.requiredKeycardIds,
    door.requiredKeycardId,
    door.keycardId,
  );
  return {
    ...cloneData(door),
    id: doorId,
    doorId,
    displayName: door.displayName ?? door.label ?? door.name ?? doorId,
    requiredCredentialIds,
    requiredKeycardId: door.requiredKeycardId ?? requiredCredentialIds[0] ?? null,
    isUnlocked: door.isUnlocked === true || door.opened === true || door.closed === false,
    isOpen: door.opened === true || door.closed === false,
  };
}

function normalizeKeycard(keycard, index) {
  const keycardId = normalizeId(keycard.keycardId ?? keycard.credentialId ?? keycard.id, `keycard-${index + 1}`);
  return {
    ...cloneData(keycard),
    id: keycardId,
    keycardId,
    credentialId: keycard.credentialId ?? keycardId,
    displayName: keycard.displayName ?? keycard.label ?? keycard.name ?? keycardId,
    spawnRoomId: keycard.spawnRoomId ?? keycard.roomId ?? null,
    sourcePosition: cloneData(keycard.sourcePosition ?? keycard.position ?? null),
    isCollected: keycard.isCollected === true || keycard.collected === true,
  };
}

function endpointRoom(endpoint) {
  if (typeof endpoint === 'string') return endpoint.includes(':') ? endpoint.split(':')[0] : endpoint;
  return endpoint?.roomId ?? endpoint?.room ?? endpoint?.instanceId ?? null;
}

function normalizeConnection(connection, index) {
  const id = normalizeId(connection.id ?? connection.connectionId ?? connection.connectorId, `connection-${index + 1}`);
  const fromRoomId = normalizeId(
    connection.fromRoomId
      ?? connection.sourceRoomId
      ?? endpointRoom(connection.from ?? connection.source ?? connection.a),
  );
  const toRoomId = normalizeId(
    connection.toRoomId
      ?? connection.destinationRoomId
      ?? endpointRoom(connection.to ?? connection.destination ?? connection.b),
  );
  const requiredCredentialIds = uniqueIds(
    connection.requiredCredentialIds,
    connection.requiredCredentials,
    connection.requiredKeycardIds,
    connection.requiredKeycardId,
    connection.gateRequirement?.requiredCredentialIds,
    connection.gateRequirement?.requiredKeycardId,
  );
  return {
    ...cloneData(connection),
    id,
    connectionId: id,
    connectorId: connection.connectorId ?? id,
    fromRoomId,
    toRoomId,
    doorId: connection.doorId ?? connection.gateId ?? null,
    requiredCredentialIds,
    requiredEncounterStateIds: uniqueIds(connection.requiredEncounterStateIds, connection.requiredEncounterStateId),
    requiredMechanismStateIds: uniqueIds(connection.requiredMechanismStateIds, connection.requiredMechanismStateId),
    requiredPressurePlateIds: uniqueIds(connection.requiredPressurePlateIds, connection.requiredPressurePlateId, connection.pressurePlateId),
    requiredStateIds: uniqueIds(connection.requiredStateIds, connection.requiredStateId),
    oneWay: connection.oneWay === true || connection.bidirectional === false,
    disabled: connection.disabled === true || connection.active === false,
  };
}

function createBands(rooms, explicitBands) {
  if (asArray(explicitBands).length > 0) return cloneData(asArray(explicitBands));
  const byBand = new Map();
  for (const room of rooms) {
    const bandId = room.progressionBand ?? room.bandId ?? room.properties?.progressionBand ?? 0;
    if (!byBand.has(bandId)) byBand.set(bandId, []);
    byBand.get(bandId).push(room.id ?? room.roomId);
  }
  return [...byBand.entries()].map(([bandId, roomIds]) => ({ bandId, roomIds }));
}

function validateData(data) {
  const errors = [];
  const warnings = [];
  const roomIds = new Set(data.rooms.map((room) => normalizeId(room.id ?? room.roomId)).filter(Boolean));
  const doorIds = new Set(data.doors.map((door) => door.doorId));
  const credentialIds = new Set(data.keycards.flatMap((keycard) => [keycard.keycardId, keycard.credentialId]));
  if (data.entranceRoomId && !roomIds.has(data.entranceRoomId)) {
    errors.push(`Progression entrance room ${data.entranceRoomId} does not exist.`);
  }
  for (const connection of data.roomConnections) {
    if (!connection.fromRoomId || !connection.toRoomId) {
      errors.push(`Connection ${connection.id} is missing a room endpoint.`);
      continue;
    }
    if (!roomIds.has(connection.fromRoomId)) errors.push(`Connection ${connection.id} references unknown room ${connection.fromRoomId}.`);
    if (!roomIds.has(connection.toRoomId)) errors.push(`Connection ${connection.id} references unknown room ${connection.toRoomId}.`);
    if (connection.doorId && !doorIds.has(connection.doorId)) warnings.push(`Connection ${connection.id} references unknown door ${connection.doorId}.`);
  }
  for (const door of data.doors) {
    for (const credentialId of door.requiredCredentialIds) {
      if (!credentialIds.has(credentialId)) warnings.push(`Door ${door.doorId} requires unplaced credential ${credentialId}.`);
    }
  }
  for (const keycard of data.keycards) {
    if (keycard.spawnRoomId && !roomIds.has(keycard.spawnRoomId)) {
      errors.push(`Credential ${keycard.keycardId} is placed in unknown room ${keycard.spawnRoomId}.`);
    }
  }
  return { accepted: errors.length === 0, ok: errors.length === 0, errors, warnings };
}

export function createAuthoredProgressionData(rawSource = {}) {
  const source = unwrapCompiledSource(
    rawSource?.dungeon ?? rawSource?.compiled ?? rawSource?.value ?? rawSource,
  );
  const configured = source.progression ?? {};
  const rooms = cloneData(asArray(source.rooms));
  const doors = gameplayRecords(source, ['door', 'gate'], 'doors').map(normalizeDoor);
  const keycards = gameplayRecords(source, ['keycard', 'key', 'credential'], 'keycards').map(normalizeKeycard);
  const roomConnections = asArray(source.connections ?? source.roomConnections ?? configured.roomConnections)
    .map(normalizeConnection);
  const entranceRoomId = normalizeId(
    configured.entranceRoomId
      ?? source.entranceRoomId
      ?? source.spawnRoomId
      ?? rooms[0]?.id
      ?? rooms[0]?.roomId,
  );
  const bands = createBands(rooms, configured.bands ?? source.bands);
  const data = {
    ...cloneData(configured),
    schema: 'ruindivex-authored-progression/v1',
    entranceRoomId,
    ruinEntranceRoomId: configured.ruinEntranceRoomId ?? entranceRoomId,
    bossRoomId: configured.bossRoomId ?? rooms.find((room) => room.isBoss)?.id ?? null,
    shrineRoomId: configured.shrineRoomId ?? rooms.find((room) => room.isShrine)?.id ?? null,
    rooms,
    bands,
    roomConnections,
    connections: roomConnections,
    doors,
    keycards,
    shrineKey: cloneData(configured.shrineKey ?? null),
    keySeeker: cloneData(configured.keySeeker ?? null),
  };
  data.validation = validateData(data);
  return data;
}

function initialIds(value) {
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.keys(value).filter((id) => value[id] === true);
  return [];
}

export class AuthoredProgression {
  constructor(source = {}, { initialState = null } = {}) {
    this.data = source?.schema === 'ruindivex-authored-progression/v1'
      ? cloneData(source)
      : createAuthoredProgressionData(source);
    this.progression = this.data;
    this.keycards = this.data.keycards;
    this.doors = this.data.doors;
    this.roomConnections = this.data.roomConnections;
    this.listeners = new Set();
    this.reset(initialState ?? source.initialState ?? {});
  }

  reset(state = {}) {
    this.collectedKeycardIds = new Set(initialIds(
      state.collectedKeycardIds ?? state.credentials ?? state.keycards,
    ));
    this.completedEncounterIds = new Set(initialIds(state.completedEncounterIds ?? state.encounters));
    this.activatedMechanismIds = new Set(initialIds(state.activatedMechanismIds ?? state.mechanisms));
    this.activatedPressurePlateIds = new Set(initialIds(state.activatedPressurePlateIds ?? state.pressurePlates));
    this.activeStateIds = new Set(initialIds(state.activeStateIds ?? state.states));
    this.unlockedDoorIds = new Set(initialIds(state.unlockedDoorIds ?? state.doors));
    this.openDoorIds = new Set(initialIds(state.openDoorIds));
    for (const keycard of this.data.keycards) {
      if (keycard.isCollected) this.collectedKeycardIds.add(keycard.keycardId);
      keycard.isCollected = this.collectedKeycardIds.has(keycard.keycardId);
    }
    for (const door of this.data.doors) {
      if (door.isUnlocked) this.unlockedDoorIds.add(door.doorId);
      if (door.isOpen) this.openDoorIds.add(door.doorId);
      door.isUnlocked = this.unlockedDoorIds.has(door.doorId);
      door.isOpen = this.openDoorIds.has(door.doorId);
    }
    return this;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Progression listeners must be functions.');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, id, value = true) {
    const event = { type, id, value, state: this.snapshot() };
    for (const listener of this.listeners) listener(event, this);
    return event;
  }

  getKeycard(id) {
    return this.data.keycards.find((entry) => entry.keycardId === id || entry.credentialId === id) ?? null;
  }

  getDoor(id) {
    return this.data.doors.find((entry) => entry.doorId === id || entry.id === id) ?? null;
  }

  hasKeycard(id) {
    return this.collectedKeycardIds.has(id);
  }

  hasCredential(id) {
    return this.hasKeycard(id);
  }

  collectKeycard(id) {
    const normalized = normalizeId(id);
    if (!normalized || this.collectedKeycardIds.has(normalized)) return false;
    this.collectedKeycardIds.add(normalized);
    const keycard = this.getKeycard(normalized);
    if (keycard) keycard.isCollected = true;
    this.emit('keycard', normalized);
    return true;
  }

  collectCredential(id) {
    return this.collectKeycard(id);
  }

  completeEncounter(id) {
    return this.setState(this.completedEncounterIds, 'encounter', id, true);
  }

  activateMechanism(id, active = true) {
    return this.setState(this.activatedMechanismIds, 'mechanism', id, active);
  }

  activatePressurePlate(id, active = true) {
    return this.setState(this.activatedPressurePlateIds, 'pressurePlate', id, active);
  }

  setGenericState(id, active = true) {
    return this.setState(this.activeStateIds, 'state', id, active);
  }

  setState(set, type, id, active) {
    const normalized = normalizeId(id);
    if (!normalized) return false;
    const changed = active ? !set.has(normalized) : set.has(normalized);
    if (!changed) return false;
    if (active) set.add(normalized);
    else set.delete(normalized);
    this.emit(type, normalized, active);
    return true;
  }

  requirementsFor(record = {}) {
    const door = record.doorId ? this.getDoor(record.doorId) : null;
    const sources = [door, door?.gateRequirement, record, record.gateRequirement].filter(Boolean);
    return {
      credentials: uniqueIds(...sources.map((entry) => [
        entry.requiredCredentialIds,
        entry.requiredKeycardIds,
        entry.requiredCredentialId,
        entry.requiredKeycardId,
      ])),
      encounters: uniqueIds(...sources.map((entry) => [entry.requiredEncounterStateIds, entry.requiredEncounterStateId])),
      mechanisms: uniqueIds(...sources.map((entry) => [entry.requiredMechanismStateIds, entry.requiredMechanismStateId])),
      pressurePlates: uniqueIds(...sources.map((entry) => [entry.requiredPressurePlateIds, entry.requiredPressurePlateId, entry.pressurePlateId])),
      states: uniqueIds(...sources.map((entry) => [entry.requiredStateIds, entry.requiredStateId])),
    };
  }

  requirementStatus(record = {}) {
    const requirements = this.requirementsFor(record);
    const unmetCredentialIds = requirements.credentials.filter((id) => !this.collectedKeycardIds.has(id));
    const unmetEncounterIds = requirements.encounters.filter((id) => !this.completedEncounterIds.has(id));
    const unmetMechanismIds = requirements.mechanisms.filter((id) => !this.activatedMechanismIds.has(id));
    const unmetPressurePlateIds = requirements.pressurePlates.filter((id) => !this.activatedPressurePlateIds.has(id));
    const unmetStateIds = requirements.states.filter((id) => !this.activeStateIds.has(id));
    return {
      satisfied: [unmetCredentialIds, unmetEncounterIds, unmetMechanismIds, unmetPressurePlateIds, unmetStateIds]
        .every((ids) => ids.length === 0),
      requirements,
      unmetCredentialIds,
      unmetEncounterIds,
      unmetMechanismIds,
      unmetPressurePlateIds,
      unmetStateIds,
    };
  }

  canOpenDoor(doorOrId) {
    const door = typeof doorOrId === 'string' ? this.getDoor(doorOrId) : doorOrId;
    if (!door) return false;
    return this.unlockedDoorIds.has(door.doorId) || this.requirementStatus(door).satisfied;
  }

  unlockDoor(id, { open = false } = {}) {
    const door = this.getDoor(id);
    if (!door || !this.canOpenDoor(door)) return false;
    const changed = !this.unlockedDoorIds.has(door.doorId) || (open && !this.openDoorIds.has(door.doorId));
    this.unlockedDoorIds.add(door.doorId);
    door.isUnlocked = true;
    if (open) {
      this.openDoorIds.add(door.doorId);
      door.isOpen = true;
    }
    if (changed) this.emit(open ? 'doorOpened' : 'doorUnlocked', door.doorId);
    return changed;
  }

  openDoor(id) {
    return this.unlockDoor(id, { open: true });
  }

  canTraverse(connectionOrId, { reverse = false } = {}) {
    const connection = typeof connectionOrId === 'string'
      ? this.data.roomConnections.find((entry) => entry.id === connectionOrId)
      : connectionOrId;
    if (!connection || connection.disabled || (reverse && connection.oneWay)) return false;
    if (connection.doorId && this.openDoorIds.has(connection.doorId)) return true;
    return this.requirementStatus(connection).satisfied;
  }

  getReachableRooms(startRoomId = this.data.entranceRoomId) {
    const reachable = new Set();
    const queue = startRoomId ? [startRoomId] : [];
    while (queue.length > 0) {
      const roomId = queue.shift();
      if (reachable.has(roomId)) continue;
      reachable.add(roomId);
      for (const connection of this.data.roomConnections) {
        if (connection.fromRoomId === roomId && this.canTraverse(connection)) queue.push(connection.toRoomId);
        if (connection.toRoomId === roomId && this.canTraverse(connection, { reverse: true })) queue.push(connection.fromRoomId);
      }
    }
    return reachable;
  }

  getKeycardDisplayName(id) {
    return this.getKeycard(id)?.displayName ?? id ?? 'Keycard';
  }

  getNormalKeycardCount() {
    return this.collectedKeycardIds.size;
  }

  getRequiredNormalKeycardCount() {
    return this.data.keycards.filter((entry) => entry.isRequiredForMainProgression !== false).length;
  }

  getHudLabel() {
    return `${this.getNormalKeycardCount()}/${this.getRequiredNormalKeycardCount()}`;
  }

  snapshot() {
    return {
      schema: 'ruindivex-authored-progression-state/v1',
      collectedKeycardIds: [...this.collectedKeycardIds].sort(),
      completedEncounterIds: [...this.completedEncounterIds].sort(),
      activatedMechanismIds: [...this.activatedMechanismIds].sort(),
      activatedPressurePlateIds: [...this.activatedPressurePlateIds].sort(),
      activeStateIds: [...this.activeStateIds].sort(),
      unlockedDoorIds: [...this.unlockedDoorIds].sort(),
      openDoorIds: [...this.openDoorIds].sort(),
    };
  }
}

export function createAuthoredProgression(source = {}, options = {}) {
  return new AuthoredProgression(source, options);
}

export class AuthoredProgressionManager extends AuthoredProgression {}
export class GenericProgressionManager extends AuthoredProgression {}
export const createGenericProgression = createAuthoredProgression;
export const createProgression = createAuthoredProgression;
export const createProgressionData = createAuthoredProgressionData;
