export const SHRINE_KEY_ID = 'Shrine_Key';

export function isDungeonGraphOnlyConnection(connection = null) {
  if (!connection) return false;
  const recordIsGraphOnly = (record) => Boolean(
    record?.isSupplementGraphConnection === true
    || record?.graphOnly === true
    || record?.connectorVariantConstraints?.graphOnly === true
  );
  if (recordIsGraphOnly(connection)) return true;
  const routes = Array.isArray(connection.routes) ? connection.routes : [];
  return routes.length > 0 && routes.every(recordIsGraphOnly);
}

export function isDungeonRuntimeRoom(room = null) {
  return Boolean(
    room
    && room.suppressRoomGeometry !== true
    && room.isRouteStationProxy !== true
    && room.isConnectorJunctionProxy !== true
  );
}

export const PROGRESSION_ROOM_BANDS = {
  hubTown: 0,
  expeditionCamp: 0,
  entrance: 0,
  enemyNest: 0,
  alienServerRoom: 0,
  keycardRoom: 0,
  trapRoom: 1,
  coolantRelayRoom: 1,
  conveyorRoom: 2,
  machineFactoryRoom: 2,
  bonusVault: 2,
  bossRoom: 3,
  shrineRoom: 4,
};

export const PROGRESSION_KEYCARDS = [
  {
    keycardId: 'Keycard_Alpha',
    displayName: 'Keycard Alpha',
    pairedDoorId: 'Door_Alpha',
    progressionTier: 1,
    spawnRoomId: 'keycardRoom',
    spawnMode: 'Pedestal',
    isRequiredForMainProgression: true,
  },
  {
    keycardId: 'Keycard_Beta',
    displayName: 'Keycard Beta',
    pairedDoorId: 'Door_Beta',
    progressionTier: 2,
    spawnRoomId: 'coolantRelayRoom',
    spawnMode: 'Chest',
    isRequiredForMainProgression: true,
  },
  {
    keycardId: 'Keycard_Gamma',
    displayName: 'Keycard Gamma',
    pairedDoorId: 'Door_Gamma',
    progressionTier: 3,
    spawnRoomId: 'conveyorRoom',
    spawnMode: 'EliteEnemyDrop',
    isRequiredForMainProgression: true,
  },
];

export const PROGRESSION_DOORS = [
  {
    doorId: 'Door_Alpha',
    displayName: 'Security Door Alpha',
    requiredKeycardId: 'Keycard_Alpha',
    progressionTier: 1,
    leadsToDepthBand: 1,
    isCriticalPathDoor: true,
    isShrineDoor: false,
  },
  {
    doorId: 'Door_Beta',
    displayName: 'Security Door Beta',
    requiredKeycardId: 'Keycard_Beta',
    progressionTier: 2,
    leadsToDepthBand: 2,
    isCriticalPathDoor: true,
    isShrineDoor: false,
  },
  {
    doorId: 'Door_Gamma',
    displayName: 'Security Door Gamma',
    requiredKeycardId: 'Keycard_Gamma',
    progressionTier: 3,
    leadsToDepthBand: 3,
    isCriticalPathDoor: true,
    isShrineDoor: false,
  },
  {
    doorId: 'Door_Shrine',
    displayName: 'Refractor Shrine Door',
    requiredKeycardId: SHRINE_KEY_ID,
    progressionTier: 'Final',
    leadsToDepthBand: 4,
    isCriticalPathDoor: true,
    isShrineDoor: true,
  },
];

export const PROGRESSION_BANDS = [
  {
    bandId: 0,
    label: 'Initial unlocked area',
    roomIds: ['hubTown', 'expeditionCamp', 'entrance', 'enemyNest', 'alienServerRoom', 'keycardRoom'],
    exitDoorId: 'Door_Alpha',
    requiredKeycardIdForExit: 'Keycard_Alpha',
  },
  {
    bandId: 1,
    label: 'First deeper area',
    roomIds: ['trapRoom', 'coolantRelayRoom'],
    entryDoorId: 'Door_Alpha',
    exitDoorId: 'Door_Beta',
    requiredKeycardIdForExit: 'Keycard_Beta',
  },
  {
    bandId: 2,
    label: 'Deep dungeon area',
    roomIds: ['conveyorRoom', 'machineFactoryRoom', 'bonusVault'],
    entryDoorId: 'Door_Beta',
    exitDoorId: 'Door_Gamma',
    requiredKeycardIdForExit: 'Keycard_Gamma',
  },
  {
    bandId: 3,
    label: 'Boss access',
    roomIds: ['bossRoom'],
    entryDoorId: 'Door_Gamma',
    exitDoorId: 'Door_Shrine',
    requiredKeycardIdForExit: SHRINE_KEY_ID,
  },
  {
    bandId: 4,
    label: 'Large Refractor shrine',
    roomIds: ['shrineRoom'],
    entryDoorId: 'Door_Shrine',
  },
];

export const PROGRESSION_CONNECTIONS = [
  ['hubTown', 'expeditionCamp', null],
  ['expeditionCamp', 'entrance', 'entranceDoor'],
  ['entrance', 'enemyNest', null],
  ['enemyNest', 'keycardRoom', 'enemyNestGate'],
  ['enemyNest', 'alienServerRoom', null],
  ['keycardRoom', 'trapRoom', 'Door_Alpha'],
  ['trapRoom', 'coolantRelayRoom', null],
  ['trapRoom', 'conveyorRoom', 'Door_Beta'],
  ['conveyorRoom', 'machineFactoryRoom', null],
  ['conveyorRoom', 'bonusVault', 'bonusVaultDoor'],
  ['conveyorRoom', 'bossRoom', 'Door_Gamma'],
  ['bossRoom', 'shrineRoom', 'Door_Shrine'],
];

function clonePosition(position = null) {
  if (!position) {
    return null;
  }

  return {
    x: Number(position.x ?? 0),
    y: Number(position.y ?? 0),
    z: Number(position.z ?? 0),
  };
}

function roomBounds2D(room) {
  const halfWidth = Math.floor((room?.width ?? 1) / 2);
  const halfDepth = Math.floor((room?.depth ?? 1) / 2);

  return {
    x: (room?.x ?? 0) - halfWidth,
    z: (room?.z ?? 0) - halfDepth,
    width: Math.max(1, (halfWidth * 2) + 1),
    depth: Math.max(1, (halfDepth * 2) + 1),
  };
}

function roomCenter2D(room) {
  return {
    x: Number(room?.x ?? 0),
    z: Number(room?.z ?? 0),
  };
}

function resolveRoomProgressionBand(room = {}) {
  if (!room.isDungeonSupplement) {
    return PROGRESSION_ROOM_BANDS[room.id] ?? 0;
  }

  const supplementBand = Number(
    room.augmentationProgressionBandId
      ?? room.augmentationProgressionBand
      ?? room.augmentationAccessBand
      ?? room.progressionBand
      ?? 0,
  );
  return Number.isFinite(supplementBand) ? supplementBand : 0;
}

function normalizeRequirementId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readRequirementIds(source, pluralKey, singularKey = null) {
  if (!source || typeof source !== 'object') {
    return { ids: [], malformed: false };
  }

  const ids = [];
  let malformed = false;
  if (Object.hasOwn(source, pluralKey)) {
    if (!Array.isArray(source[pluralKey])) {
      malformed = true;
    } else {
      for (const raw of source[pluralKey]) {
        const id = normalizeRequirementId(raw);
        if (!id) malformed = true;
        else ids.push(id);
      }
    }
  }
  if (singularKey && Object.hasOwn(source, singularKey)) {
    const id = normalizeRequirementId(source[singularKey]);
    if (!id) malformed = true;
    else ids.push(id);
  }
  return { ids, malformed };
}

function normalizeActiveStateIds(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) {
    return new Set(value.map(normalizeRequirementId).filter(Boolean));
  }
  if (value && typeof value === 'object') {
    return new Set(Object.entries(value)
      .filter(([, active]) => active === true)
      .map(([id]) => normalizeRequirementId(id))
      .filter(Boolean));
  }
  return new Set();
}

function createActiveProgressionState(rawState = {}) {
  const source = rawState && typeof rawState === 'object' ? rawState : {};
  const generic = normalizeActiveStateIds(
    source.activeStateIds
      ?? source.progressionStateIds
      ?? source.satisfiedStateIds,
  );
  const merge = (...values) => new Set(values.flatMap((value) => (
    [...normalizeActiveStateIds(value)]
  )));
  return {
    generic,
    encounter: merge(
      source.completedEncounterIds,
      source.clearedEncounterIds,
      source.encounterStateIds,
    ),
    mechanism: merge(
      source.activatedMechanismIds,
      source.mechanismStateIds,
    ),
    shortcut: merge(
      source.unlockedShortcutIds,
      source.enabledShortcutIds,
      source.shortcutStateIds,
    ),
    pressurePlate: merge(
      source.activatedPressurePlateIds,
      source.poweredPressurePlateIds,
      source.pressurePlateStateIds,
    ),
  };
}

function collectSupplementalConnectionRequirements(connection = {}, door = null) {
  const sources = [connection, connection.gateRequirement, door, door?.gateRequirement]
    .filter(Boolean);
  const requirements = {
    credentials: new Set(),
    encounter: new Set(),
    mechanism: new Set(),
    shortcut: new Set(),
    generic: new Set(),
    pressurePlate: new Set(),
    malformed: false,
  };
  let requiresEncounterState = false;
  let requiresMechanismState = false;
  let requiresShortcutState = false;
  let requiresState = false;
  let requiresPressurePlate = false;
  const fields = [
    ['credentials', 'requiredCredentialIds', 'requiredCredentialId'],
    ['encounter', 'requiredEncounterStateIds', 'requiredEncounterStateId'],
    ['mechanism', 'requiredMechanismStateIds', 'requiredMechanismStateId'],
    ['shortcut', 'requiredShortcutStateIds', 'requiredShortcutStateId'],
    ['generic', 'requiredStateIds', 'requiredStateId'],
    ['pressurePlate', 'requiredPressurePlateIds', 'requiredPressurePlateId'],
  ];
  for (const source of sources) {
    requirements.malformed ||= source.requirementsMalformed === true;
    for (const [kind, pluralKey, singularKey] of fields) {
      const result = readRequirementIds(source, pluralKey, singularKey);
      result.ids.forEach((id) => requirements[kind].add(id));
      requirements.malformed ||= result.malformed;
    }
    const requiredKeycardId = normalizeRequirementId(source.requiredKeycardId);
    if (requiredKeycardId) requirements.credentials.add(requiredKeycardId);
    if (Object.hasOwn(source, 'pressurePlateId')) {
      const pressurePlateId = normalizeRequirementId(source.pressurePlateId);
      if (pressurePlateId) requirements.pressurePlate.add(pressurePlateId);
      else if (source.pressurePlateId != null && source.pressurePlateId !== '') {
        requirements.malformed = true;
      }
    }
    requiresEncounterState ||= source.requiresEncounterState === true;
    requiresMechanismState ||= source.requiresMechanismState === true;
    requiresShortcutState ||= source.requiresShortcutState === true;
    requiresState ||= source.requiresState === true;
    requiresPressurePlate ||= source.requiresPressurePlate === true;
  }
  requirements.malformed ||= requiresEncounterState && requirements.encounter.size === 0;
  requirements.malformed ||= requiresMechanismState && requirements.mechanism.size === 0;
  requirements.malformed ||= requiresShortcutState && requirements.shortcut.size === 0;
  requirements.malformed ||= requiresState && requirements.generic.size === 0;
  requirements.malformed ||= requiresPressurePlate && requirements.pressurePlate.size === 0;
  requirements.malformed ||= Boolean(connection.doorId)
    && [
      requirements.credentials,
      requirements.encounter,
      requirements.mechanism,
      requirements.shortcut,
      requirements.generic,
      requirements.pressurePlate,
    ].every((ids) => ids.size === 0);
  return requirements;
}

function findSourcePosition({ keycardId, spawnMode, landmarks, chests, encounters }) {
  if (spawnMode === 'Pedestal') {
    return clonePosition(landmarks.keycards.find((keycard) => keycard.keycardId === keycardId)?.position);
  }

  if (spawnMode === 'Chest') {
    return clonePosition(chests.find((chest) => chest.guaranteedKeycardId === keycardId)?.position);
  }

  if (spawnMode === 'EliteEnemyDrop') {
    return clonePosition(encounters.find((encounter) => encounter.keycardDropId === keycardId)?.zone?.position);
  }

  return null;
}

function createRoomConnections(roomById, connectionPlans = []) {
  return PROGRESSION_CONNECTIONS
    .filter(([fromRoomId, toRoomId]) => roomById.has(fromRoomId) && roomById.has(toRoomId))
    .map(([fromRoomId, toRoomId, doorId]) => {
      const id = `${fromRoomId}_${toRoomId}`;
      const routes = connectionPlans
        .filter((plan) => (
          plan.logicalConnectionId === id
          && !isDungeonGraphOnlyConnection(plan)
        ))
        .map((plan) => ({
          id: plan.id,
          connectorType: plan.connectorType,
          level: plan.level,
          elevation: plan.elevation,
          sourceElevation: plan.sourceElevation ?? plan.fromSocket?.elevation ?? plan.elevation,
          destinationElevation: plan.destinationElevation ?? plan.toSocket?.elevation ?? plan.elevation,
          elevationDelta: plan.elevationDelta ?? 0,
          direction: plan.direction ?? 'level',
          connectorVariantId: plan.connectorVariantId ?? null,
          purpose: plan.purpose,
          routeClassification: plan.routeClassification
            ?? (plan.purpose === 'optional_branch' ? 'optional_branch' : 'main_route'),
          requiredForProgression: plan.requiredForProgression,
          explorationBeats: (plan.explorationBeats ?? []).map((beat) => ({ ...beat })),
          fromSocket: { ...plan.fromSocket },
          toSocket: { ...plan.toSocket },
        }));
      return {
        id,
        fromRoomId,
        toRoomId,
        doorId,
        routes,
      };
    });
}

function createMinimapData({ rooms, roomConnections, doors, keycards, chests, keySeeker, shrine, bossEncounter }) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  for (const room of rooms) {
    const bounds = roomBounds2D(room);
    minX = Math.min(minX, bounds.x);
    minZ = Math.min(minZ, bounds.z);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxZ = Math.max(maxZ, bounds.z + bounds.depth);
  }

  const padding = 6;
  const safeMinX = Number.isFinite(minX) ? minX - padding : -24;
  const safeMinZ = Number.isFinite(minZ) ? minZ - padding : -24;
  const safeMaxX = Number.isFinite(maxX) ? maxX + padding : 24;
  const safeMaxZ = Number.isFinite(maxZ) ? maxZ + padding : 24;

  return {
    bounds: {
      minX: safeMinX,
      minZ: safeMinZ,
      width: Math.max(1, safeMaxX - safeMinX),
      depth: Math.max(1, safeMaxZ - safeMinZ),
    },
    rooms: rooms.map((room) => ({
      roomId: room.id,
      roomType: room.type,
      baseElevation: Number(room.baseElevation ?? 0),
      minY: Number(room.minY ?? room.baseElevation ?? 0),
      maxY: Number(room.maxY ?? room.baseElevation ?? 0),
      ceilingY: Number.isFinite(room.ceilingY) ? room.ceilingY : null,
      roomBounds2D: roomBounds2D(room),
      roomCenter2D: roomCenter2D(room),
      connectedRoomIds: roomConnections
        .filter((connection) => connection.fromRoomId === room.id || connection.toRoomId === room.id)
        .map((connection) => connection.fromRoomId === room.id ? connection.toRoomId : connection.fromRoomId),
      progressionBand: resolveRoomProgressionBand(room),
      isInitialUnlockedArea: resolveRoomProgressionBand(room) === 0,
      containsKeycard: keycards.some((keycard) => keycard.spawnRoomId === room.id),
      containsChest: chests.some((chest) => chest.roomId === room.id),
      containsBoss: bossEncounter?.roomId === room.id,
      containsShrine: shrine?.roomId === room.id || room.id === 'shrineRoom',
      ceilingHeight: room.ceilingHeight ?? null,
      verticalTierCount: room.numberOfVerticalTiers ?? 1,
      elevations: (room.localTierMap ?? []).map((tier) => tier.elevation),
      localElevations: (room.localTierMap ?? []).map((tier) => (
        Number(tier.elevation ?? room.baseElevation ?? 0) - Number(room.baseElevation ?? 0)
      )),
      archetype: room.archetype ?? room.type,
      purpose: room.purpose ?? null,
    })),
    hallways: roomConnections.map((connection) => ({
      hallwayId: connection.id,
      fromRoomId: connection.fromRoomId,
      toRoomId: connection.toRoomId,
      doorId: connection.doorId,
      routes: connection.routes,
      elevationTransfers: connection.routes.map((route) => ({
        routeId: route.id,
        sourceElevation: route.sourceElevation,
        destinationElevation: route.destinationElevation,
        elevationDelta: route.elevationDelta,
        direction: route.direction,
      })),
    })),
    markers: [
      ...doors.map((door) => ({
        markerId: `${door.doorId}_marker`,
        markerType: door.isShrineDoor ? 'ShrineDoor' : 'LockedDoor',
        associatedEntityId: door.doorId,
        associatedRoomId: door.toRoomId,
        worldPosition: door.position,
        minimapPosition: door.position ? { x: door.position.x, z: door.position.z } : null,
        revealCondition: 'AdjacentRoomDiscovered',
        priority: door.isShrineDoor ? 90 : 70,
      })),
      ...keycards.map((keycard) => ({
        markerId: `${keycard.keycardId}_source`,
        markerType: keycard.spawnMode === 'EliteEnemyDrop' ? 'KeyHoldingElite' : 'Keycard',
        associatedEntityId: keycard.keycardId,
        associatedRoomId: keycard.spawnRoomId,
        worldPosition: keycard.sourcePosition,
        minimapPosition: keycard.sourcePosition ? { x: keycard.sourcePosition.x, z: keycard.sourcePosition.z } : null,
        revealCondition: keycard.spawnMode === 'Pedestal' ? 'RoomDiscovered' : 'KeySeeker',
        priority: 80 - keycard.progressionTier,
      })),
      keySeeker ? {
        markerId: 'KeySeeker_marker',
        markerType: 'KeySeeker',
        associatedEntityId: keySeeker.id,
        associatedRoomId: keySeeker.roomId,
        worldPosition: keySeeker.position,
        minimapPosition: keySeeker.position ? { x: keySeeker.position.x, z: keySeeker.position.z } : null,
        revealCondition: 'RoomDiscovered',
        priority: 60,
      } : null,
    ].filter(Boolean),
  };
}

export function createDungeonProgressionData({
  rooms = [],
  doors = [],
  landmarks = {},
  chests = [],
  encounters = [],
  connectionPlans = [],
} = {}) {
  const runtimeRooms = rooms.filter(isDungeonRuntimeRoom);
  const roomById = new Map(runtimeRooms.map((room) => [room.id, room]));
  const doorById = new Map(doors.map((door) => [door.id, door]));
  const roomConnections = createRoomConnections(roomById, connectionPlans);
  const keycards = PROGRESSION_KEYCARDS.map((keycard) => ({
    ...keycard,
    spawnRoomId: keycard.spawnRoomId,
    sourcePosition: findSourcePosition({
      keycardId: keycard.keycardId,
      spawnMode: keycard.spawnMode,
      landmarks,
      chests,
      encounters,
    }),
    isCollected: false,
  }));
  const progressionDoors = PROGRESSION_DOORS.map((door) => {
    const generatedDoor = doorById.get(door.doorId);

    return {
      ...door,
      doorId: door.doorId,
      fromRoomId: generatedDoor?.fromRoomId ?? null,
      toRoomId: generatedDoor?.toRoomId ?? null,
      position: clonePosition(generatedDoor?.position),
      isUnlocked: !generatedDoor?.closed,
    };
  });
  const bossEncounter = encounters.find((encounter) => encounter.isBoss) ?? null;
  const keySeeker = landmarks.keySeeker
    ? {
      id: landmarks.keySeeker.id,
      displayName: landmarks.keySeeker.label ?? 'Key Seeker',
      roomId: landmarks.keySeeker.roomId,
      position: clonePosition(landmarks.keySeeker.position),
      isActivated: false,
    }
    : null;
  const shrine = landmarks.shrine
    ? {
      id: landmarks.shrine.id,
      roomId: 'shrineRoom',
      position: clonePosition(landmarks.shrine.position),
    }
    : null;

  for (const room of runtimeRooms) {
    room.progressionBand = resolveRoomProgressionBand(room);
  }

  const progression = {
    entranceRoomId: 'hubTown',
    ruinEntranceRoomId: 'entrance',
    bossRoomId: bossEncounter?.roomId ?? 'bossRoom',
    shrineRoomId: 'shrineRoom',
    keycards,
    doors: progressionDoors,
    bands: PROGRESSION_BANDS,
    roomConnections,
    keySeeker,
    shrineKey: {
      keycardId: SHRINE_KEY_ID,
      displayName: 'Shrine Key',
      pairedDoorId: 'Door_Shrine',
      progressionTier: 'Final',
      spawnRoomId: bossEncounter?.roomId ?? 'bossRoom',
      spawnMode: 'BossReward',
      isCollected: false,
      isRequiredForMainProgression: true,
      isShrineKey: true,
    },
    boss: {
      encounterId: bossEncounter?.id ?? 'bossEncounter',
      roomId: bossEncounter?.roomId ?? 'bossRoom',
      rewardKeycardId: SHRINE_KEY_ID,
      mustDropShrineKey: true,
    },
  };

  progression.minimap = createMinimapData({
    rooms: runtimeRooms,
    roomConnections,
    doors: progressionDoors,
    keycards,
    chests,
    keySeeker,
    shrine,
    bossEncounter,
  });
  progression.validation = new DungeonValidator(progression).validate();

  return progression;
}

export class DungeonProgressionManager {
  constructor(progression = null) {
    this.progression = progression ?? {
      keycards: [],
      doors: [],
      shrineKey: null,
      roomConnections: [],
    };
    this.collectedKeycardIds = new Set();

    for (const keycard of this.progression.keycards ?? []) {
      if (keycard.isCollected) {
        this.collectedKeycardIds.add(keycard.keycardId);
      }
    }

    if (this.progression.shrineKey?.isCollected) {
      this.collectedKeycardIds.add(SHRINE_KEY_ID);
    }
  }

  getKeycard(keycardId) {
    if (keycardId === SHRINE_KEY_ID) {
      return this.progression.shrineKey ?? null;
    }

    return this.progression.keycards?.find((keycard) => keycard.keycardId === keycardId) ?? null;
  }

  getDoor(doorId) {
    return this.progression.doors?.find((door) => door.doorId === doorId) ?? null;
  }

  getKeycardDisplayName(keycardId) {
    return this.getKeycard(keycardId)?.displayName ?? keycardId ?? 'Keycard';
  }

  hasKeycard(keycardId) {
    return this.collectedKeycardIds.has(keycardId);
  }

  collectKeycard(keycardId) {
    if (!keycardId || this.hasKeycard(keycardId)) {
      return false;
    }

    this.collectedKeycardIds.add(keycardId);
    const keycard = this.getKeycard(keycardId);
    if (keycard) {
      keycard.isCollected = true;
    }

    return true;
  }

  getNormalKeycardCount() {
    return [...this.collectedKeycardIds].filter((keycardId) => keycardId !== SHRINE_KEY_ID).length;
  }

  getRequiredNormalKeycardCount() {
    return this.progression.keycards?.filter((keycard) => keycard.isRequiredForMainProgression).length ?? 0;
  }

  getHudLabel() {
    return `${this.getNormalKeycardCount()}/${this.getRequiredNormalKeycardCount()}`;
  }

  getCurrentTrackedDoor(runtimeDoors = []) {
    const runtimeDoorById = new Map(runtimeDoors.map((door) => [door.id, door]));
    const candidates = [
      ...(this.progression.keycards ?? []),
      this.progression.shrineKey,
    ]
      .filter(Boolean)
      .filter((keycard) => this.hasKeycard(keycard.keycardId))
      .map((keycard) => ({
        keycard,
        progressionDoor: this.getDoor(keycard.pairedDoorId),
        runtimeDoor: runtimeDoorById.get(keycard.pairedDoorId),
      }))
      .filter(({ runtimeDoor }) => runtimeDoor?.closed);

    candidates.sort((a, b) => {
      if (a.keycard.keycardId === SHRINE_KEY_ID) {
        return -1;
      }
      if (b.keycard.keycardId === SHRINE_KEY_ID) {
        return 1;
      }

      return (a.keycard.progressionTier ?? 99) - (b.keycard.progressionTier ?? 99);
    });

    return candidates[0] ?? null;
  }
}

export class DungeonValidator {
  constructor(progression = {}) {
    this.progression = progression;
    this.roomsById = new Map();
    this.doorsById = new Map((progression.doors ?? []).map((door) => [door.doorId, door]));
    this.keycardsById = new Map((progression.keycards ?? []).map((keycard) => [keycard.keycardId, keycard]));
    this.connections = (progression.roomConnections ?? [])
      .filter((connection) => !isDungeonGraphOnlyConnection(connection));

    for (const band of progression.bands ?? []) {
      for (const roomId of band.roomIds ?? []) {
        this.roomsById.set(roomId, {
          roomId,
          bandId: band.bandId,
        });
      }
    }
  }

  validate() {
    const errors = [];
    const warnings = [];
    const entranceRoomId = this.progression.entranceRoomId ?? 'hubTown';

    if (!this.roomsById.has(entranceRoomId)) {
      errors.push(`Entrance room ${entranceRoomId} is missing from the progression graph.`);
    }

    for (const connection of this.connections) {
      const routes = connection.routes ?? [];
      if (connection.isDungeonSupplement) {
        const door = connection.doorId ? this.doorsById.get(connection.doorId) : null;
        const requirements = collectSupplementalConnectionRequirements(connection, door);
        if (connection.doorId && !door) {
          errors.push(`${connection.id} references unknown supplemental gate ${connection.doorId}.`);
        }
        if (requirements.malformed) {
          errors.push(`${connection.id} has an incomplete supplemental gate requirement.`);
        }
      }
      if (!connection.isDungeonSupplement
        && !routes.some((route) => route.requiredForProgression)) {
        errors.push(`${connection.id} has no required physical traversal route.`);
      }
      for (const route of routes) {
        const socketDelta = Number(route.toSocket?.elevation ?? 0)
          - Number(route.fromSocket?.elevation ?? 0);
        if (Math.abs(socketDelta - Number(route.elevationDelta ?? 0)) > 0.001) {
          errors.push(`${route.id} socket elevations do not match its signed connector contract.`);
        }
        const verticalFamily = ['crested_slope_v1', 'ladder_gallery_v1', 'automatic_lift_gallery_v1']
          .includes(route.connectorVariantId);
        if (!verticalFamily && Math.abs(socketDelta) > 0.001) {
          errors.push(`${route.id} changes elevation without a vertical connector family.`);
        }
        if (route.fromSocket?.roomId !== connection.fromRoomId
          || route.toSocket?.roomId !== connection.toRoomId) {
          errors.push(`${route.id} portal ownership does not match its room connection.`);
        }
        if (route.fromSocket?.matchingSocketId !== route.toSocket?.id
          || route.toSocket?.matchingSocketId !== route.fromSocket?.id) {
          errors.push(`${route.id} portal sockets are not paired bidirectionally.`);
        }
      }
    }

    const initialReachable = this.getReachableRooms(new Set());
    if (this.progression.keySeeker && !initialReachable.has(this.progression.keySeeker.roomId)) {
      errors.push('Key Seeker is not reachable without keycards.');
    }

    const alpha = this.keycardsById.get('Keycard_Alpha');
    if (alpha && !initialReachable.has(alpha.spawnRoomId)) {
      errors.push('Keycard Alpha is not reachable without keycards.');
    }

    for (const keycard of this.progression.keycards ?? []) {
      const previousKeys = new Set(
        (this.progression.keycards ?? [])
          .filter((candidate) => (candidate.progressionTier ?? 0) < (keycard.progressionTier ?? 0))
          .map((candidate) => candidate.keycardId),
      );
      const reachableBeforeDoor = this.getReachableRooms(previousKeys);

      if (!reachableBeforeDoor.has(keycard.spawnRoomId)) {
        errors.push(`${keycard.displayName} is not reachable before ${keycard.pairedDoorId}.`);
      }

      const pairedDoor = this.doorsById.get(keycard.pairedDoorId);
      if (!pairedDoor) {
        errors.push(`${keycard.displayName} is paired to missing door ${keycard.pairedDoorId}.`);
      } else if (pairedDoor.requiredKeycardId !== keycard.keycardId) {
        errors.push(`${pairedDoor.displayName} does not require its paired ${keycard.displayName}.`);
      }
    }

    for (const door of this.progression.doors ?? []) {
      if (!door.isCriticalPathDoor) {
        continue;
      }

      const previousKeys = new Set(
        (this.progression.keycards ?? [])
          .filter((keycard) => (
            typeof door.progressionTier === 'number'
            && (keycard.progressionTier ?? 0) < door.progressionTier
          ))
          .map((keycard) => keycard.keycardId),
      );
      const reachableWithDoorClosed = this.getReachableRooms(previousKeys, new Set([door.doorId]));
      const bypassed = [...reachableWithDoorClosed].some((roomId) => {
        const band = this.roomsById.get(roomId)?.bandId ?? 0;
        return typeof band === 'number' && band >= door.leadsToDepthBand;
      });

      if (bypassed) {
        errors.push(`${door.displayName} can be bypassed without ${door.requiredKeycardId}.`);
      }
    }

    const solver = this.solve();
    if (!solver.completed) {
      errors.push('Validation solver could not reach the Large Refractor shrine room.');
    }

    if (!solver.inventory.includes(SHRINE_KEY_ID)) {
      errors.push('Boss traversal did not award the Shrine Key.');
    }

    if (!this.doorsById.get('Door_Shrine')?.isShrineDoor) {
      errors.push('Final shrine door is not marked as a shrine door.');
    }

    if (errors.length === 0 && warnings.length === 0) {
      warnings.push('Dungeon progression graph validated successfully.');
    }

    return {
      accepted: errors.length === 0,
      errors,
      warnings,
      solver,
    };
  }

  solve() {
    const inventory = new Set();
    let reachableRooms = this.getReachableRooms(inventory);
    const shrineRoomId = this.progression.shrineRoomId ?? 'shrineRoom';
    const maxIterations = Math.max(8, (this.progression.keycards?.length ?? 0) + 6);

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const previousReachableKey = [...reachableRooms].sort().join('|');
      let collectedSomething = false;

      for (const keycard of this.progression.keycards ?? []) {
        if (!inventory.has(keycard.keycardId) && reachableRooms.has(keycard.spawnRoomId)) {
          inventory.add(keycard.keycardId);
          collectedSomething = true;
        }
      }

      if (
        !inventory.has(SHRINE_KEY_ID)
        && reachableRooms.has(this.progression.boss?.roomId ?? 'bossRoom')
      ) {
        inventory.add(SHRINE_KEY_ID);
        collectedSomething = true;
      }

      reachableRooms = this.getReachableRooms(inventory);
      if (reachableRooms.has(shrineRoomId)) {
        return {
          completed: true,
          inventory: [...inventory],
          reachableRooms: [...reachableRooms],
          iterations: iteration + 1,
        };
      }

      const nextReachableKey = [...reachableRooms].sort().join('|');
      if (!collectedSomething && nextReachableKey === previousReachableKey) {
        break;
      }
    }

    return {
      completed: false,
      inventory: [...inventory],
      reachableRooms: [...reachableRooms],
      iterations: maxIterations,
    };
  }

  getReachableRooms(inventory = new Set(), forceClosedDoorIds = new Set(), activeState = {}) {
    const startRoomId = this.progression.entranceRoomId ?? 'hubTown';
    const reachable = new Set([startRoomId]);
    const queue = [startRoomId];

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const roomId = queue[cursor];

      for (const connection of this.connections) {
        const nextRoomId = connection.fromRoomId === roomId
          ? connection.toRoomId
          : connection.toRoomId === roomId
            ? connection.fromRoomId
            : null;

        if (!nextRoomId || reachable.has(nextRoomId)) {
          continue;
        }

        if (!this.canPassConnection(connection, inventory, forceClosedDoorIds, activeState)) {
          continue;
        }

        reachable.add(nextRoomId);
        queue.push(nextRoomId);
      }
    }

    return reachable;
  }

  canPassConnection(connection, inventory, forceClosedDoorIds, activeState = {}) {
    const supplemental = connection.isDungeonSupplement === true;
    const door = connection.doorId ? this.doorsById.get(connection.doorId) : null;
    const requirements = supplemental
      ? collectSupplementalConnectionRequirements(connection, door)
      : null;

    if (supplemental && requirements.malformed) return false;

    if (!connection.doorId || connection.doorId === 'entranceDoor') {
      if (!supplemental) return true;
    } else {
      if (forceClosedDoorIds.has(connection.doorId)) {
        return false;
      }

      if (!door) {
        // Preserve legacy encounter/pressure gates while ensuring a malformed
        // supplemental cross-band edge cannot silently fail open.
        return !supplemental;
      }
    }

    if (!supplemental) {
      if (!door.requiredKeycardId) return true;
      return inventory.has(door.requiredKeycardId);
    }

    for (const credentialId of requirements.credentials) {
      if (!inventory.has(credentialId)) return false;
    }
    const state = createActiveProgressionState(activeState);
    for (const [kind, ids] of [
      ['encounter', requirements.encounter],
      ['mechanism', requirements.mechanism],
      ['shortcut', requirements.shortcut],
      ['generic', requirements.generic],
      ['pressurePlate', requirements.pressurePlate],
    ]) {
      for (const stateId of ids) {
        if (!state.generic.has(stateId) && !state[kind].has(stateId)) return false;
      }
    }
    return true;
  }
}
