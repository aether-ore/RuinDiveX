import * as THREE from 'three';
import {
  isDungeonGraphOnlyConnection,
  isDungeonRuntimeRoom,
} from '../DungeonProgression.js';
import {
  DUNGEON_SUPPLEMENT_FRAGMENT_SCHEMA,
  DungeonSupplementAssemblyError,
} from './DungeonSupplementAssembler.js';

export const DUNGEON_EFFECTIVE_FACADE_SCHEMA = 'ruindivex-dungeon-effective-facade/v1';

const MERGED_ARRAY_FIELDS = Object.freeze([
  'rooms',
  'connectorJunctionProxies',
  'floorTiles',
  'verticalConnectors',
  'connectionPlans',
  'doors',
  'keycards',
  'chests',
  'mechanisms',
  'ladders',
  'connectorLifts',
  'puzzleBlocks',
  'pressurePlates',
  'conveyorPuzzles',
  'platforms',
  'npcAnimationMixers',
  'npcAnimators',
  'safeInteractables',
  'safeZones',
  'solidZones',
  'aerialBoundaryZones',
  'encounters',
  'traps',
  'conveyors',
  'enemySpawnPoints',
  'renderCullGroups',
  'environmentalHazards',
  'localLights',
  'audioEmitters',
  'progressionAssignments',
  'progressionAnchors',
  'socketCaps',
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function recordId(record) {
  return record?.id
    ?? record?.roomId
    ?? record?.connectorId
    ?? record?.keycardId
    ?? record?.mechanismId
    ?? null;
}

function floorIdentity(tile) {
  return `${tile?.x},${tile?.z}@${finite(tile?.elevation ?? tile?.baseElevation).toFixed(3)}`;
}

function floorOwnerIds(tile = {}) {
  return [...new Set([
    tile.roomId,
    tile.connectorJunctionProxyId,
    tile.connectorJunctionOwnerId,
    tile.connectorId,
    tile.connectionId,
    ...(tile.mergedFloorOwnerIds ?? []),
    ...(tile.sharedThresholdOwnerIds ?? []),
  ].filter(Boolean).map(String))].sort();
}

function floorSourceCount(tile = {}) {
  return Math.max(1, Number(tile.mergedFloorSourceCount ?? 1));
}

function floorUnownedSourceCount(tile = {}) {
  if (Number.isFinite(Number(tile.mergedUnownedFloorSourceCount))) {
    return Math.max(0, Number(tile.mergedUnownedFloorSourceCount));
  }
  return floorOwnerIds(tile).length === 0 ? 1 : 0;
}

function mergeFloorProvenance(baseFloor, supplementFloor, identity, diagnostics, field) {
  const baseOwnerIds = floorOwnerIds(baseFloor);
  const supplementOwnerIds = floorOwnerIds(supplementFloor);
  const mergedOwnerIds = [...new Set([...baseOwnerIds, ...supplementOwnerIds])].sort();
  const sharedThresholdOwnerIds = new Set([
    ...(baseFloor.sharedThresholdOwnerIds ?? []),
    ...(baseFloor.sharedFloorOwnerIds ?? []),
    ...(supplementFloor.sharedThresholdOwnerIds ?? []),
    ...(supplementFloor.sharedFloorOwnerIds ?? []),
  ].filter(Boolean).map(String));
  const sameOwners = baseOwnerIds.length > 0
    && supplementOwnerIds.length > 0
    && baseOwnerIds.every((ownerId) => supplementOwnerIds.includes(ownerId))
    && supplementOwnerIds.every((ownerId) => baseOwnerIds.includes(ownerId));
  const explicitlySharedThreshold = sharedThresholdOwnerIds.size > 0
    && mergedOwnerIds.every((ownerId) => sharedThresholdOwnerIds.has(ownerId));
  const mergedUnownedSourceCount = floorUnownedSourceCount(baseFloor)
    + floorUnownedSourceCount(supplementFloor);
  diagnostics.conflicts.push({
    field,
    identity,
    source: 'supplement',
    baseOwnerIds,
    supplementOwnerIds,
    explicitlySharedThreshold,
  });
  if (
    mergedUnownedSourceCount > 0
    || (!sameOwners && !explicitlySharedThreshold)
  ) {
    throw new DungeonSupplementAssemblyError(
      `Dungeon facade overlay conflicts with floor provenance at ${identity}.`,
      {
        code: 'DUNGEON_FACADE_FLOOR_OWNERSHIP_CONFLICT',
        diagnostics: [{
          field,
          floorIdentity: identity,
          baseOwnerIds,
          supplementOwnerIds,
          sharedThresholdOwnerIds: [...sharedThresholdOwnerIds].sort(),
          mergedUnownedSourceCount,
        }],
      },
    );
  }
  return {
    ...baseFloor,
    mergedFloorOwnerIds: mergedOwnerIds,
    mergedFloorSourceCount: floorSourceCount(baseFloor) + floorSourceCount(supplementFloor),
    mergedUnownedFloorSourceCount: 0,
    ...(sharedThresholdOwnerIds.size > 0 ? {
      sharedThresholdOwnerIds: [...sharedThresholdOwnerIds].sort(),
      sharedThresholdContractIds: [...new Set([
        ...(baseFloor.sharedThresholdContractIds ?? []),
        ...(supplementFloor.sharedThresholdContractIds ?? []),
      ].filter(Boolean).map(String))].sort(),
    } : {}),
  };
}

function mergeFloorRecords(baseRecords, supplementRecords, diagnostics) {
  const merged = [];
  const indexByIdentity = new Map();
  for (const record of asArray(baseRecords)) {
    const identity = floorIdentity(record);
    indexByIdentity.set(identity, merged.length);
    merged.push(record);
  }
  for (const record of asArray(supplementRecords)) {
    const identity = floorIdentity(record);
    if (!indexByIdentity.has(identity)) {
      indexByIdentity.set(identity, merged.length);
      merged.push(record);
      continue;
    }
    const index = indexByIdentity.get(identity);
    merged[index] = mergeFloorProvenance(
      merged[index],
      record,
      identity,
      diagnostics,
      'floorTiles',
    );
  }
  return merged;
}

function mergeRecords(baseRecords, supplementRecords, {
  conflictPolicy = 'supplement',
  identity = recordId,
  diagnostics,
  field,
} = {}) {
  const merged = [];
  const indexByIdentity = new Map();
  const append = (record, source) => {
    const identityValue = identity(record);
    if (identityValue === null || identityValue === undefined) {
      merged.push(record);
      return;
    }
    const key = String(identityValue);
    if (!indexByIdentity.has(key)) {
      indexByIdentity.set(key, merged.length);
      merged.push(record);
      return;
    }
    diagnostics.conflicts.push({ field, identity: key, source });
    if (conflictPolicy === 'error') {
      throw new DungeonSupplementAssemblyError(
        `Dungeon facade overlay conflicts with an existing ${field} identity: ${key}.`,
        { code: 'DUNGEON_FACADE_OVERLAY_CONFLICT' },
      );
    }
    if (conflictPolicy === 'supplement' && source === 'supplement') {
      merged[indexByIdentity.get(key)] = record;
    }
  };
  for (const record of asArray(baseRecords)) append(record, 'base');
  for (const record of asArray(supplementRecords)) append(record, 'supplement');
  return merged;
}

function normalizeTiles(source) {
  if (source instanceof Map) return source;
  if (Array.isArray(source)) {
    return new Map(source.map((tile) => [`${tile.x},${tile.z}`, tile]));
  }
  if (source && typeof source === 'object') return new Map(Object.entries(source));
  return new Map();
}

function mergeTiles(baseTiles, supplementTiles, conflictPolicy, diagnostics) {
  const merged = new Map(normalizeTiles(baseTiles));
  for (const [key, tile] of normalizeTiles(supplementTiles)) {
    if (merged.has(key)) {
      const existing = merged.get(key);
      const sameElevation = Math.abs(
        finite(existing?.elevation ?? existing?.baseElevation)
          - finite(tile?.elevation ?? tile?.baseElevation),
      ) <= 0.0001;
      if (sameElevation) {
        merged.set(
          key,
          mergeFloorProvenance(existing, tile, floorIdentity(tile), diagnostics, 'tiles'),
        );
        continue;
      }
      diagnostics.conflicts.push({ field: 'tiles', identity: key, source: 'supplement' });
      if (conflictPolicy === 'error') {
        throw new DungeonSupplementAssemblyError(
          `Dungeon facade overlay conflicts with an existing tile identity: ${key}.`,
          { code: 'DUNGEON_FACADE_OVERLAY_CONFLICT' },
        );
      }
      if (conflictPolicy === 'base') continue;
    }
    merged.set(key, tile);
  }
  return merged;
}

function minimapRoomIdentity(room) {
  return room?.roomId ?? room?.id ?? null;
}

function minimapHallwayIdentity(hallway) {
  return hallway?.hallwayId
    ?? hallway?.connectionId
    ?? hallway?.connectorId
    ?? hallway?.id
    ?? null;
}

function endpointRoomId(endpoint) {
  if (typeof endpoint === 'string' || typeof endpoint === 'number') return String(endpoint);
  return endpoint?.roomId ?? endpoint?.nodeId ?? endpoint?.id ?? null;
}

function normalizeMinimapRoom(room) {
  if (!room || typeof room !== 'object') return room;
  const roomId = minimapRoomIdentity(room);
  const bounds2D = room.roomBounds2D ?? room.bounds2D ?? null;
  const boundsX = finiteOrNull(bounds2D?.x ?? bounds2D?.minX);
  const boundsZ = finiteOrNull(bounds2D?.z ?? bounds2D?.minZ);
  const width = finiteOrNull(bounds2D?.width ?? room.width);
  const depth = finiteOrNull(bounds2D?.depth ?? room.depth);
  const centerX = finiteOrNull(
    room.roomCenter2D?.x
      ?? room.center2D?.x
      ?? room.center?.x
      ?? room.x
      ?? (boundsX !== null && width !== null ? boundsX + width * 0.5 : null),
  );
  const centerZ = finiteOrNull(
    room.roomCenter2D?.z
      ?? room.center2D?.z
      ?? room.center?.z
      ?? room.z
      ?? (boundsZ !== null && depth !== null ? boundsZ + depth * 0.5 : null),
  );
  const normalizedBounds = centerX !== null && centerZ !== null && width !== null && depth !== null
    ? {
      ...(bounds2D ?? {}),
      x: boundsX ?? centerX - width * 0.5,
      z: boundsZ ?? centerZ - depth * 0.5,
      width,
      depth,
    }
    : bounds2D;
  return {
    ...room,
    ...(roomId === null ? {} : { id: room.id ?? roomId, roomId }),
    ...(centerX === null || centerZ === null ? {} : {
      x: finiteOrNull(room.x) ?? centerX,
      z: finiteOrNull(room.z) ?? centerZ,
      roomCenter2D: { ...(room.roomCenter2D ?? {}), x: centerX, z: centerZ },
    }),
    ...(width === null ? {} : { width }),
    ...(depth === null ? {} : { depth }),
    ...(normalizedBounds ? { roomBounds2D: normalizedBounds } : {}),
  };
}

function normalizeMinimapHallway(hallway) {
  if (!hallway || typeof hallway !== 'object') return hallway;
  const hallwayId = minimapHallwayIdentity(hallway);
  const fromRoomId = hallway.fromRoomId
    ?? hallway.fromNodeId
    ?? endpointRoomId(hallway.from);
  const toRoomId = hallway.toRoomId
    ?? hallway.toNodeId
    ?? endpointRoomId(hallway.to);
  return {
    ...hallway,
    ...(hallwayId === null ? {} : { id: hallway.id ?? hallwayId, hallwayId }),
    ...(fromRoomId === null || fromRoomId === undefined ? {} : { fromRoomId }),
    ...(toRoomId === null || toRoomId === undefined ? {} : { toRoomId }),
  };
}

function normalizeMinimapBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  let minX = finiteOrNull(bounds.minX ?? bounds.x);
  let minZ = finiteOrNull(bounds.minZ ?? bounds.z);
  let maxX = finiteOrNull(bounds.maxX);
  let maxZ = finiteOrNull(bounds.maxZ);
  let width = finiteOrNull(bounds.width);
  let depth = finiteOrNull(bounds.depth ?? bounds.height);
  if (minX === null && maxX !== null && width !== null) minX = maxX - width;
  if (minZ === null && maxZ !== null && depth !== null) minZ = maxZ - depth;
  if (maxX === null && minX !== null && width !== null) maxX = minX + width;
  if (maxZ === null && minZ !== null && depth !== null) maxZ = minZ + depth;
  if (width === null && minX !== null && maxX !== null) width = maxX - minX;
  if (depth === null && minZ !== null && maxZ !== null) depth = maxZ - minZ;
  if ([minX, minZ, maxX, maxZ, width, depth].some((value) => value === null)) return null;
  return { ...bounds, minX, minZ, maxX, maxZ, width, depth };
}

function boundsFromRooms(rooms) {
  const extents = rooms.map(normalizeMinimapRoom).flatMap((room) => {
    const bounds = room?.roomBounds2D;
    if (bounds) {
      const minX = finiteOrNull(bounds.x ?? bounds.minX);
      const minZ = finiteOrNull(bounds.z ?? bounds.minZ);
      const width = finiteOrNull(bounds.width);
      const depth = finiteOrNull(bounds.depth);
      if (minX !== null && minZ !== null && width !== null && depth !== null) {
        return [{ minX, minZ, maxX: minX + width, maxZ: minZ + depth }];
      }
    }
    const x = finiteOrNull(room?.roomCenter2D?.x ?? room?.x);
    const z = finiteOrNull(room?.roomCenter2D?.z ?? room?.z);
    if (x === null || z === null) return [];
    const width = finiteOrNull(room?.width) ?? 0;
    const depth = finiteOrNull(room?.depth) ?? 0;
    return [{ minX: x - width * 0.5, minZ: z - depth * 0.5, maxX: x + width * 0.5, maxZ: z + depth * 0.5 }];
  });
  if (extents.length === 0) return null;
  return normalizeMinimapBounds({
    minX: Math.min(...extents.map((bounds) => bounds.minX)),
    maxX: Math.max(...extents.map((bounds) => bounds.maxX)),
    minZ: Math.min(...extents.map((bounds) => bounds.minZ)),
    maxZ: Math.max(...extents.map((bounds) => bounds.maxZ)),
  });
}

function unionBounds(first, second) {
  const normalizedFirst = normalizeMinimapBounds(first);
  const normalizedSecond = normalizeMinimapBounds(second);
  if (!normalizedFirst) return normalizedSecond ? { ...normalizedSecond } : null;
  if (!normalizedSecond) return { ...normalizedFirst };
  return normalizeMinimapBounds({
    minX: Math.min(normalizedFirst.minX, normalizedSecond.minX),
    maxX: Math.max(normalizedFirst.maxX, normalizedSecond.maxX),
    minZ: Math.min(normalizedFirst.minZ, normalizedSecond.minZ),
    maxZ: Math.max(normalizedFirst.maxZ, normalizedSecond.maxZ),
  });
}

function mergeMinimap(baseMinimap, supplementMinimap, options, diagnostics) {
  if (!baseMinimap && !supplementMinimap) return null;
  const base = baseMinimap ?? {};
  const supplement = supplementMinimap ?? {};
  let rooms = mergeRecords(
    asArray(base.rooms).filter(isDungeonRuntimeRoom).map(normalizeMinimapRoom),
    asArray(supplement.rooms).filter(isDungeonRuntimeRoom).map(normalizeMinimapRoom),
    {
      ...options,
      diagnostics,
      field: 'minimap.rooms',
      identity: minimapRoomIdentity,
    },
  );
  const baseHallways = asArray(base.hallways ?? base.connections)
    .filter((hallway) => !isDungeonGraphOnlyConnection(hallway))
    .map(normalizeMinimapHallway);
  const supplementHallways = asArray(supplement.hallways ?? supplement.connections)
    .filter((hallway) => !isDungeonGraphOnlyConnection(hallway))
    .map(normalizeMinimapHallway);
  const hallways = mergeRecords(baseHallways, supplementHallways, {
    ...options,
    diagnostics,
    field: 'minimap.hallways',
    identity: minimapHallwayIdentity,
  });
  const connections = mergeRecords(
    asArray(base.connections ?? baseHallways)
      .filter((connection) => !isDungeonGraphOnlyConnection(connection))
      .map(normalizeMinimapHallway),
    asArray(supplement.connections ?? supplementHallways)
      .filter((connection) => !isDungeonGraphOnlyConnection(connection))
      .map(normalizeMinimapHallway),
    {
      ...options,
      diagnostics,
      field: 'minimap.connections',
      identity: minimapHallwayIdentity,
    },
  );
  const adjacentRoomIds = new Map();
  const connect = (fromRoomId, toRoomId) => {
    if (fromRoomId === null || fromRoomId === undefined || toRoomId === null || toRoomId === undefined) return;
    const from = String(fromRoomId);
    const to = String(toRoomId);
    if (!adjacentRoomIds.has(from)) adjacentRoomIds.set(from, new Set());
    adjacentRoomIds.get(from).add(to);
  };
  for (const hallway of hallways) {
    connect(hallway.fromRoomId, hallway.toRoomId);
    connect(hallway.toRoomId, hallway.fromRoomId);
  }
  rooms = rooms.map((room) => {
    const roomId = minimapRoomIdentity(room);
    const connected = new Set(asArray(room?.connectedRoomIds).map(String));
    for (const adjacentId of adjacentRoomIds.get(String(roomId)) ?? []) connected.add(adjacentId);
    return { ...room, connectedRoomIds: [...connected] };
  });
  return {
    ...base,
    ...supplement,
    rooms,
    hallways,
    connections,
    bounds: unionBounds(
      base.bounds ?? boundsFromRooms(asArray(base.rooms)),
      supplement.bounds ?? boundsFromRooms(asArray(supplement.rooms)),
    ),
  };
}

function mergeProgression(baseProgression, patch, options, diagnostics) {
  if (!baseProgression && !patch) return null;
  const base = baseProgression ?? {};
  const supplement = patch ?? {};
  const merged = { ...base, ...supplement };
  for (const field of ['rooms', 'roomConnections', 'doors', 'keycards', 'objectives', 'beats']) {
    if (base[field] || supplement[field]) {
      const filter = field === 'roomConnections'
        ? (record) => !isDungeonGraphOnlyConnection(record)
        : field === 'rooms' ? isDungeonRuntimeRoom : () => true;
      merged[field] = mergeRecords(
        asArray(base[field]).filter(filter),
        asArray(supplement[field]).filter(filter),
        {
          ...options,
          diagnostics,
          field: `progression.${field}`,
        },
      );
    }
  }
  if (base.validation || supplement.validation) {
    merged.validation = {
      ...(base.validation ?? {}),
      ...(supplement.validation ?? {}),
      errors: [
        ...asArray(base.validation?.errors),
        ...asArray(supplement.validation?.errors),
      ],
      warnings: [
        ...asArray(base.validation?.warnings),
        ...asArray(supplement.validation?.warnings),
      ],
    };
  }
  return merged;
}

function assertFragment(fragment) {
  if (!fragment || typeof fragment !== 'object') {
    throw new DungeonSupplementAssemblyError('A dungeon supplement fragment is required.', {
      code: 'MISSING_DUNGEON_SUPPLEMENT_FRAGMENT',
    });
  }
  if (fragment.schema && fragment.schema !== DUNGEON_SUPPLEMENT_FRAGMENT_SCHEMA) {
    throw new DungeonSupplementAssemblyError(
      `Unsupported dungeon supplement fragment schema: ${fragment.schema}.`,
      { code: 'UNSUPPORTED_DUNGEON_SUPPLEMENT_FRAGMENT' },
    );
  }
}

/**
 * Explicitly attach the already-accepted supplement root to a rendered parent.
 * This is separate from facade merging so validation/failure paths do not
 * mutate the parent scene graph.
 */
export function attachDungeonSupplementRoot(parentGroup, supplementRoot) {
  if (!parentGroup?.isObject3D || !supplementRoot?.isObject3D) {
    throw new DungeonSupplementAssemblyError(
      'A Three.js parent group and supplement root are required for attachment.',
      { code: 'INVALID_SUPPLEMENT_ROOT_ATTACHMENT' },
    );
  }
  if (supplementRoot === parentGroup || supplementRoot.parent === parentGroup) return supplementRoot;
  parentGroup.add(supplementRoot);
  return supplementRoot;
}

export function detachDungeonSupplementRoot(supplementRoot) {
  supplementRoot?.removeFromParent?.();
  return supplementRoot ?? null;
}

/**
 * Return a detached effective facade. Parent arrays, maps, progression records,
 * minimap records, hashes, and the parent scene graph remain unchanged.
 */
export function mergeDungeonFacade(baseFacade, supplementFragment, {
  conflictPolicy = 'supplement',
  attachRoot = false,
  replacePhysicalConnectionIds = [],
} = {}) {
  if (!baseFacade || typeof baseFacade !== 'object') {
    throw new DungeonSupplementAssemblyError('A base dungeon facade is required.', {
      code: 'MISSING_BASE_DUNGEON_FACADE',
    });
  }
  assertFragment(supplementFragment);
  if (!['supplement', 'base', 'error'].includes(conflictPolicy)) {
    throw new DungeonSupplementAssemblyError(`Unknown facade conflict policy: ${conflictPolicy}.`, {
      code: 'INVALID_FACADE_CONFLICT_POLICY',
    });
  }
  const diagnostics = {
    accepted: true,
    conflicts: [],
    replacedPhysicalConnectionIds: [...replacePhysicalConnectionIds],
  };
  const replaceSet = new Set(replacePhysicalConnectionIds);
  const effective = {
    ...baseFacade,
    schema: baseFacade.schema ?? DUNGEON_EFFECTIVE_FACADE_SCHEMA,
    baseGroup: baseFacade.group ?? null,
    supplementRoot: supplementFragment.root ?? supplementFragment.group ?? null,
    dungeonSupplement: supplementFragment,
  };

  for (const field of MERGED_ARRAY_FIELDS) {
    let baseRecords = asArray(baseFacade[field]);
    let supplementRecords = asArray(supplementFragment[field]);
    if (field === 'rooms') {
      baseRecords = baseRecords.filter(isDungeonRuntimeRoom);
      supplementRecords = supplementRecords.filter(isDungeonRuntimeRoom);
    }
    if (replaceSet.size > 0 && ['connectionPlans', 'verticalConnectors'].includes(field)) {
      baseRecords = baseRecords.filter((record) => !replaceSet.has(
        record?.id ?? record?.connectorId ?? record?.connectionId,
      ));
    }
    effective[field] = field === 'floorTiles'
      ? mergeFloorRecords(baseRecords, supplementRecords, diagnostics)
      : mergeRecords(baseRecords, supplementRecords, {
          conflictPolicy,
          diagnostics,
          field,
          identity: recordId,
        });
  }

  effective.tiles = mergeTiles(
    baseFacade.tiles,
    supplementFragment.tiles,
    conflictPolicy,
    diagnostics,
  );
  effective.minimap = mergeMinimap(
    baseFacade.minimap,
    supplementFragment.minimap,
    { conflictPolicy },
    diagnostics,
  );
  effective.progression = mergeProgression(
    baseFacade.progression,
    supplementFragment.progressionPatch,
    { conflictPolicy },
    diagnostics,
  );
  if (effective.progression?.minimap && effective.minimap) {
    effective.progression = { ...effective.progression, minimap: effective.minimap };
  }

  const basePlanHash = supplementFragment.basePlanHash
    ?? baseFacade.basePlanHash
    ?? baseFacade.planHash
    ?? null;
  const augmentationPlanHash = supplementFragment.augmentationPlanHash ?? null;
  const effectivePlanHash = supplementFragment.effectivePlanHash
    ?? (augmentationPlanHash ? `${basePlanHash ?? 'base'}+${augmentationPlanHash}` : basePlanHash);
  effective.basePlanHash = basePlanHash;
  effective.augmentationPlanHash = augmentationPlanHash;
  effective.effectivePlanHash = effectivePlanHash;
  effective.dungeonAugmentation = {
    schema: supplementFragment.overlaySchema ?? 'ruindivex-dungeon-augmentation-overlay/v1',
    profileId: supplementFragment.profileId ?? null,
    augmentationSeed: supplementFragment.augmentationSeed ?? null,
    basePlanHash,
    augmentationPlanHash,
    effectivePlanHash,
    structuralMode: supplementFragment.structuralMode ?? 'complete',
  };
  effective.supplementDiagnostics = diagnostics;
  effective.attachDungeonSupplement = () => attachDungeonSupplementRoot(
    baseFacade.group,
    effective.supplementRoot,
  );
  effective.detachDungeonSupplement = () => detachDungeonSupplementRoot(effective.supplementRoot);
  effective.disposeDungeonSupplement = () => supplementFragment.dispose?.();

  if (attachRoot && effective.supplementRoot) effective.attachDungeonSupplement();
  return effective;
}

export const mergeDungeonSupplementFacade = mergeDungeonFacade;

export function createDungeonSupplementCompositeRoot(baseGroup, supplementRoot) {
  if (!baseGroup?.isObject3D || !supplementRoot?.isObject3D) {
    throw new DungeonSupplementAssemblyError(
      'A Three.js base group and supplement root are required for a composite root.',
      { code: 'INVALID_DUNGEON_COMPOSITE_ROOT' },
    );
  }
  const composite = new THREE.Group();
  composite.name = 'DungeonEffectiveRoot';
  // Cloning avoids reparenting and therefore preserves the caller's scene
  // graph. Shared theme resources remain shared; callers own clone lifecycle.
  composite.add(baseGroup.clone(true));
  composite.add(supplementRoot.clone(true));
  composite.userData.dungeonCompositePreview = true;
  return composite;
}
