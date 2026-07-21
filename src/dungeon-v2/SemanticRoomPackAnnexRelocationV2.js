import {
  clonePlanData,
  deepFreezePlan,
  isSerializablePlanValue,
} from './DungeonPlanV2Contract.js';
import {
  createPlanDiagnostic,
  hashPlanDiagnostics,
  sortPlanDiagnostics,
} from './DungeonPlanDiagnostics.js';
import {
  compileSemanticRoomPackPlacementV2,
  validateSemanticRoomPackPlacementV2,
} from './SemanticRoomPackPlanAdapterV2.js';

export const SEMANTIC_ROOM_PACK_ANNEX_RELOCATION_V2_REVISION = 1;

export const SEMANTIC_ROOM_PACK_ANNEX_TARGETS_V2 = deepFreezePlan({
  rdx_factory_corkscrew_exchange: {
    placementId: 'placement.semantic-room-pack.factory-corkscrew',
    translation: { x: 150, y: 3, z: -75 },
  },
  rdx_waterworks_freight_sump: {
    placementId: 'placement.semantic-room-pack.waterworks-freight-sump',
    translation: { x: -70, y: -4, z: -75 },
  },
  rdx_magma_foundry_undercroft: {
    placementId: 'placement.semantic-room-pack.undercroft',
    translation: { x: 0, y: -25, z: -290 },
  },
  rdx_electric_transformer_undercroft: {
    placementId: 'placement.semantic-room-pack.undercroft',
    translation: { x: 0, y: -25, z: -290 },
  },
});

const BASE_PHYSICAL_ARRAY_KEYS = Object.freeze([
  'structuralBoundaries',
  'walkableSurfaces',
  'structuralFixtures',
]);

const GLOBAL_RECORD_COLLECTIONS = Object.freeze([
  'modulePlacements',
  'spatialCells',
  'structuralBoundaries',
  'walkableSurfaces',
  'structuralFixtures',
  'traversalLinks',
  'falls',
  'anchors',
  'safeAnchors',
  'mechanisms',
  'environmentStates',
  'basins',
  'hazards',
  'discoveries',
  'rewards',
  'encounters',
  'actions',
]);

const SKIPPED_LOCAL_PATH_PARTS = Object.freeze([
  'local',
  'authoredroottransform',
  'sourceintegrity',
  'sourcemanifest',
]);

const WORLD_VECTOR_KEYS = new Set([
  'anchor',
  'bottomExit',
  'center',
  'end',
  'from',
  'landingPosition',
  'max',
  'min',
  'position',
  'safePosition',
  'start',
  'targetPosition',
  'to',
  'topExit',
  'translation',
  'worldAnchor',
  'worldCenter',
  'worldPosition',
]);

const WORLD_VECTOR_COLLECTION_KEYS = new Set([
  'path',
  'planePath',
  'points',
  'rootPath',
  'samples',
  'trajectory',
  'waypoints',
]);

const WORLD_Y_KEYS = new Set([
  'absoluteWorldY',
  'basinBottomWorldY',
  'bottomY',
  'destinationWorldY',
  'elevation',
  'minimumWalkableY',
  'planeY',
  'sillElevation',
  'topY',
  'worldElevation',
]);

function round(value) {
  const result = Math.round(Number(value) * 1e9) / 1e9;
  return Object.is(result, -0) ? 0 : result;
}

function vector(value, label) {
  if (!value || !['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]))) {
    throw new TypeError(`${label} must contain finite x, y, and z values.`);
  }
  return { x: round(value.x), y: round(value.y), z: round(value.z) };
}

function addVector(value, delta) {
  return {
    x: round(value.x + delta.x),
    y: round(value.y + delta.y),
    z: round(value.z + delta.z),
  };
}

function subtractVector(left, right) {
  return {
    x: round(left.x - right.x),
    y: round(left.y - right.y),
    z: round(left.z - right.z),
  };
}

function isVector(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]));
}

function cloneBounds(bounds) {
  return { min: vector(bounds?.min, 'bounds.min'), max: vector(bounds?.max, 'bounds.max') };
}

function boundsOverlap(left, right, epsilon = 1e-6) {
  return left.min.x < right.max.x - epsilon && left.max.x > right.min.x + epsilon
    && left.min.y < right.max.y - epsilon && left.max.y > right.min.y + epsilon
    && left.min.z < right.max.z - epsilon && left.max.z > right.min.z + epsilon;
}

function pathIsLocal(path) {
  return path.some((part) => {
    const lower = String(part).toLowerCase();
    return SKIPPED_LOCAL_PATH_PARTS.some((token) => lower.includes(token));
  });
}

function lastNamedPathPart(path) {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (!Number.isInteger(path[index])) return path[index];
  }
  return '';
}

function isWorldVectorPath(path) {
  if (pathIsLocal(path)) return false;
  const key = lastNamedPathPart(path);
  if (WORLD_VECTOR_KEYS.has(key)) return true;
  return path.some((part) => WORLD_VECTOR_COLLECTION_KEYS.has(part));
}

function isWorldYPath(path) {
  if (pathIsLocal(path)) return false;
  const key = String(lastNamedPathPart(path));
  // `worldHeight` is overloaded by the room-pack contract. On mechanism
  // stable states it is an absolute world-space stop height, while on
  // cylinders it is a dimension consumed by the assembler. Never translate
  // the dimensional form.
  if (key === 'worldHeight') {
    return path.some((part) => String(part).toLowerCase() === 'stablestates');
  }
  return WORLD_Y_KEYS.has(key) || key.endsWith('WorldY');
}

/**
 * Translate integration-only world data. Manifest-owned placement data is
 * recompiled instead; this helper intentionally ignores local vectors,
 * authored transforms, sizes, scale, facing, axes, and dimensions.
 */
function translateWorldData(value, delta, path = []) {
  if (Number.isFinite(value)) {
    return isWorldYPath(path) ? round(value + delta.y) : value;
  }
  if (value == null || typeof value !== 'object') return value;
  if (isVector(value)) {
    return isWorldVectorPath(path) ? addVector(value, delta) : { ...value };
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => translateWorldData(entry, delta, [...path, index]));
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = translateWorldData(entry, delta, [...path, key]);
  }
  return result;
}

function containsString(value, target) {
  if (value === target) return true;
  if (value == null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => containsString(entry, target));
  return Object.values(value).some((entry) => containsString(entry, target));
}

function collectStrings(value, target) {
  if (typeof value === 'string') {
    target.add(value);
    return;
  }
  if (value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, target);
    return;
  }
  for (const entry of Object.values(value)) collectStrings(entry, target);
}

function physicalRecordIds(placement) {
  const ids = new Set([placement.placementId, placement.id]);
  for (const key of [
    'placedRecordIds',
    'integratedPlanRecordIds',
    'structuralKitBoundaryIds',
    'auxiliaryRuntimeSurfaceIds',
    'socketCapBoundaryIds',
  ]) collectStrings(placement[key], ids);
  for (const key of BASE_PHYSICAL_ARRAY_KEYS) {
    for (const record of placement[key] ?? []) if (record?.id) ids.add(record.id);
  }
  return ids;
}

function isRetiredConnectorRouteRecord(record) {
  if (!record || typeof record !== 'object') return false;
  if (record.connector === true || record.connectorRoute === true) return true;
  const id = String(record.id ?? '');
  return id.includes('.connector.') || id.startsWith('connector.');
}

function recordOwnedByPlacement(record, placementId, ownedIds) {
  if (!record || typeof record !== 'object') return false;
  // The canonical connection coordinator removes and rebuilds every old
  // Golden connector route after annex relocation. Moving those retired
  // records would make them look current and can leave duplicate corridors.
  if (isRetiredConnectorRouteRecord(record)) return false;
  if (ownedIds.has(record.id) || ownedIds.has(record.placementId)) return true;
  if (record.semanticRoomPackPlacementId === placementId
    || record.presentationOwnerId === placementId
    || record.nativePlacementId === placementId) return true;
  return containsString(record, placementId);
}

function mergeRelocatedPhysicalRecords(oldRecords, newRecords, delta) {
  const oldById = new Map((oldRecords ?? []).map((record) => [record.id, record]));
  const merged = newRecords.map((record) => ({
    ...translateWorldData(oldById.get(record.id) ?? {}, delta),
    ...clonePlanData(record),
  }));
  const newIds = new Set(newRecords.map(({ id }) => id));
  for (const record of oldRecords ?? []) {
    if (!newIds.has(record.id)) merged.push(translateWorldData(record, delta));
  }
  return merged;
}

function recompileAtTarget(oldPlacement, targetTranslation) {
  const oldTranslation = vector(
    oldPlacement.placementTransform?.translation,
    `${oldPlacement.placementId}.placementTransform.translation`,
  );
  const delta = subtractVector(targetTranslation, oldTranslation);
  const oldEntry = oldPlacement.entrySocketWorld;
  if (!oldEntry?.position || !oldEntry?.forward) {
    throw new Error(`${oldPlacement.placementId} has no compiled entry socket world transform.`);
  }
  const sourcePlacement = {
    ...clonePlanData(oldPlacement.sourcePlacement),
    roomId: oldPlacement.roomId,
    placementId: oldPlacement.placementId,
    entrySocketNodeName: oldPlacement.entrySocketNodeName,
    yawQuarterTurns: oldPlacement.placementTransform.yawQuarterTurns,
    targetPortal: {
      ...clonePlanData(oldPlacement.sourcePlacement?.targetPortal ?? {}),
      position: addVector(oldEntry.position, delta),
      forward: { ...oldEntry.forward },
    },
  };
  const base = compileSemanticRoomPackPlacementV2(sourcePlacement);
  const relocated = {
    ...clonePlanData(oldPlacement),
    ...clonePlanData(base),
  };
  for (const key of BASE_PHYSICAL_ARRAY_KEYS) {
    relocated[key] = mergeRelocatedPhysicalRecords(oldPlacement[key], base[key], delta);
  }
  const baseKeys = new Set(Object.keys(base));
  for (const key of Object.keys(oldPlacement)) {
    if (!baseKeys.has(key)) relocated[key] = translateWorldData(oldPlacement[key], delta, [key]);
  }
  return {
    placement: deepFreezePlan(relocated),
    oldTranslation,
    newTranslation: { ...targetTranslation },
    delta,
    oldWorldBounds: cloneBounds(oldPlacement.worldBounds),
    newWorldBounds: cloneBounds(base.worldBounds),
  };
}

function relocateGlobalRecords(plan, oldPlacement, relocatedPlacement, delta) {
  const ownedIds = physicalRecordIds(oldPlacement);
  const byCollection = {};
  for (const collectionName of GLOBAL_RECORD_COLLECTIONS) {
    const records = plan[collectionName];
    if (!Array.isArray(records)) continue;
    const relocatedIds = [];
    plan[collectionName] = records.map((record) => {
      if (!recordOwnedByPlacement(record, oldPlacement.placementId, ownedIds)) return record;
      relocatedIds.push(record.id ?? record.placementId ?? `${collectionName}:${relocatedIds.length}`);
      return translateWorldData(record, delta, [collectionName]);
    });
    if (relocatedIds.length > 0) byCollection[collectionName] = relocatedIds.sort();
  }

  // Manifest-owned physical records are authoritative. Replace their global
  // geometry with the freshly recompiled records while retaining Golden-only
  // region, support, and presentation metadata.
  for (const collectionName of BASE_PHYSICAL_ARRAY_KEYS) {
    const newById = new Map((relocatedPlacement[collectionName] ?? []).map((record) => [record.id, record]));
    plan[collectionName] = (plan[collectionName] ?? []).map((record) => {
      const authoritative = newById.get(record.id);
      return authoritative ? { ...record, ...clonePlanData(authoritative) } : record;
    });
  }
  return byCollection;
}

function resolvePlacedRecords(plan, placement) {
  const collectionByKey = {
    structuralBoundaryIds: plan.structuralBoundaries ?? [],
    walkableSurfaceIds: plan.walkableSurfaces ?? [],
    structuralFixtureIds: plan.structuralFixtures ?? [],
    colliderIds: placement.transformedCollisionVolumes ?? [],
  };
  const missing = [];
  for (const [key, ids] of Object.entries(placement.placedRecordIds ?? {})) {
    const available = new Set((collectionByKey[key] ?? []).map(({ id }) => id));
    for (const id of ids) if (!available.has(id)) missing.push(id);
  }
  return missing;
}

function addDiagnostic(target, code, message, details = {}) {
  target.push(createPlanDiagnostic(code, message, details));
}

function buildCandidate(sourcePlan) {
  if (!sourcePlan || sourcePlan.fixtureKind !== 'golden-complex') {
    throw new TypeError('Semantic room-pack annex relocation requires a Golden complex plan.');
  }
  const sourcePlacements = sourcePlan.semanticRoomPackPlacements ?? [];
  if (sourcePlacements.length !== 3) {
    throw new Error(`Annex relocation requires exactly three compiled room-pack placements; received ${sourcePlacements.length}.`);
  }
  const plan = clonePlanData(sourcePlan);
  const ledgerPlacements = [];
  const relocatedPlacements = [];
  for (const oldPlacement of sourcePlacements) {
    const target = SEMANTIC_ROOM_PACK_ANNEX_TARGETS_V2[oldPlacement.roomId];
    if (!target || target.placementId !== oldPlacement.placementId) {
      throw new Error(`No audited annex target exists for ${oldPlacement.roomId}/${oldPlacement.placementId}.`);
    }
    const relocation = recompileAtTarget(oldPlacement, target.translation);
    const relocatedRecordIds = relocateGlobalRecords(
      plan,
      oldPlacement,
      relocation.placement,
      relocation.delta,
    );
    relocatedPlacements.push(relocation.placement);
    ledgerPlacements.push({
      placementId: oldPlacement.placementId,
      roomId: oldPlacement.roomId,
      yawQuarterTurns: relocation.placement.placementTransform.yawQuarterTurns,
      oldTranslation: relocation.oldTranslation,
      newTranslation: relocation.newTranslation,
      delta: relocation.delta,
      oldWorldBounds: relocation.oldWorldBounds,
      newWorldBounds: relocation.newWorldBounds,
      relocatedRecordIds,
      placedRecordIds: clonePlanData(relocation.placement.placedRecordIds),
    });
  }
  plan.semanticRoomPackPlacements = relocatedPlacements;
  const minimumWalkableY = Math.min(
    ...(plan.walkableSurfaces ?? [])
      .map((surface) => surface?.bounds?.min?.y)
      .filter(Number.isFinite),
  );
  if (!Number.isFinite(minimumWalkableY)) {
    throw new Error('Annex relocation cannot resolve a finite minimum walkable elevation.');
  }
  const recoverySafeguardPlaneY = round(minimumWalkableY - 8);
  plan.recoverySafeguard = {
    ...plan.recoverySafeguard,
    minimumWalkableY: round(minimumWalkableY),
    planeY: recoverySafeguardPlaneY,
  };
  plan.semanticRoomPackAnnexRelocation = {
    revision: SEMANTIC_ROOM_PACK_ANNEX_RELOCATION_V2_REVISION,
    status: 'relocated-awaiting-canonical-route-rebuild',
    authoredScalePreserved: true,
    yawPreserved: true,
    planPortalsRelocated: false,
    oldConnectorRoutesRelocated: false,
    canonicalRouteRebuildRequired: true,
    minimumWalkableY: round(minimumWalkableY),
    recoverySafeguardPlaneY,
    placements: ledgerPlacements,
  };
  return plan;
}

function validateCandidate(plan) {
  const errors = [];
  const placements = plan.semanticRoomPackPlacements ?? [];
  for (const placement of placements) {
    const target = SEMANTIC_ROOM_PACK_ANNEX_TARGETS_V2[placement.roomId];
    if (!target) continue;
    if (JSON.stringify(placement.placementTransform.translation) !== JSON.stringify(target.translation)) {
      addDiagnostic(errors, 'semantic-room-pack-annex-target-drift', `${placement.placementId} missed its audited annex translation.`, {
        placementId: placement.placementId,
        expected: target.translation,
        actual: placement.placementTransform.translation,
      });
    }
    const placementValidation = validateSemanticRoomPackPlacementV2(placement);
    errors.push(...placementValidation.errors);
    const missing = resolvePlacedRecords(plan, placement);
    if (missing.length > 0) {
      addDiagnostic(errors, 'semantic-room-pack-annex-record-missing', `${placement.placementId} lost physical records during relocation.`, {
        placementId: placement.placementId,
        missingRecordIds: missing,
      });
    }
    for (const binding of placement.socketBindings ?? []) {
      const socket = placement.sockets.find(({ id }) => id === binding.socketId);
      const boundary = binding.boundaryId
        ? plan.structuralBoundaries.find(({ id }) => id === binding.boundaryId)
        : true;
      const surface = binding.surfaceId
        ? plan.walkableSurfaces.find(({ id }) => id === binding.surfaceId)
        : true;
      if (!socket || !boundary || !surface) {
        addDiagnostic(errors, 'semantic-room-pack-annex-socket-binding-missing', `${placement.placementId}:${binding.socketId} lost its physical binding.`, {
          placementId: placement.placementId,
          socketId: binding.socketId,
          boundaryId: binding.boundaryId ?? null,
          surfaceId: binding.surfaceId ?? null,
        });
      }
    }
  }

  for (let leftIndex = 0; leftIndex < placements.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < placements.length; rightIndex += 1) {
      if (boundsOverlap(placements[leftIndex].worldBounds, placements[rightIndex].worldBounds)) {
        addDiagnostic(errors, 'semantic-room-pack-annex-overlap', 'Audited semantic annex bounds overlap.', {
          leftPlacementId: placements[leftIndex].placementId,
          rightPlacementId: placements[rightIndex].placementId,
        });
      }
    }
  }
  const nativePlacements = (plan.modulePlacements ?? []).filter(({ descriptorId }) => (
    typeof descriptorId === 'string' && descriptorId.startsWith('v1-room.')
  ));
  for (const authored of placements) {
    for (const native of nativePlacements) {
      const nativeBounds = native.worldBounds ?? native.bounds;
      if (nativeBounds && boundsOverlap(authored.worldBounds, nativeBounds)) {
        addDiagnostic(errors, 'semantic-room-pack-native-body-overlap', `${authored.placementId} overlaps ${native.id}.`, {
          placementId: authored.placementId,
          nativePlacementId: native.id,
        });
      }
    }
  }
  const minimumWalkableY = Math.min(
    ...(plan.walkableSurfaces ?? [])
      .map((surface) => surface?.bounds?.min?.y)
      .filter(Number.isFinite),
  );
  const expectedSafeguardPlaneY = round(minimumWalkableY - 8);
  if (!Number.isFinite(minimumWalkableY)
    || plan.recoverySafeguard?.minimumWalkableY !== round(minimumWalkableY)
    || plan.recoverySafeguard?.planeY !== expectedSafeguardPlaneY
    || plan.semanticRoomPackAnnexRelocation?.minimumWalkableY !== round(minimumWalkableY)
    || plan.semanticRoomPackAnnexRelocation?.recoverySafeguardPlaneY !== expectedSafeguardPlaneY) {
    addDiagnostic(errors, 'semantic-room-pack-annex-safeguard-drift', 'Recovery safeguard does not remain eight metres beneath the relocated minimum walkable floor.', {
      minimumWalkableY: Number.isFinite(minimumWalkableY) ? round(minimumWalkableY) : null,
      expectedPlaneY: Number.isFinite(expectedSafeguardPlaneY) ? expectedSafeguardPlaneY : null,
      recoverySafeguard: plan.recoverySafeguard ?? null,
    });
  }
  if (!isSerializablePlanValue(plan)) {
    addDiagnostic(errors, 'semantic-room-pack-annex-not-serializable', 'Annex relocation produced non-serializable plan data.');
  }
  return sortPlanDiagnostics(errors);
}

function resultFor(plan, errors) {
  return deepFreezePlan({
    accepted: errors.length === 0,
    plan,
    errors,
    diagnosticHash: hashPlanDiagnostics(errors),
    relocation: plan?.semanticRoomPackAnnexRelocation ?? null,
  });
}

export function prepareSemanticRoomPackAnnexRelocationV2(sourcePlan) {
  let candidate = null;
  try {
    candidate = buildCandidate(sourcePlan);
  } catch (cause) {
    const errors = sortPlanDiagnostics([createPlanDiagnostic(
      'semantic-room-pack-annex-relocation-failed',
      cause?.message ?? 'Semantic room-pack annex relocation failed.',
      { name: cause?.name ?? 'Error' },
    )]);
    return resultFor(null, errors);
  }
  return resultFor(candidate, validateCandidate(candidate));
}

export class SemanticRoomPackAnnexRelocationErrorV2 extends Error {
  constructor(result) {
    const first = result.errors?.[0];
    super(first
      ? `Semantic room-pack annex relocation rejected: ${first.code}: ${first.message}`
      : 'Semantic room-pack annex relocation rejected.');
    this.name = 'SemanticRoomPackAnnexRelocationErrorV2';
    this.code = 'SEMANTIC_ROOM_PACK_ANNEX_RELOCATION_INVALID';
    this.result = result;
  }
}

export function relocateSemanticRoomPackAnnexesV2(plan) {
  const result = prepareSemanticRoomPackAnnexRelocationV2(plan);
  if (!result.accepted) throw new SemanticRoomPackAnnexRelocationErrorV2(result);
  const relocated = clonePlanData(result.plan);
  relocated.semanticRoomPackPlacements = relocated.semanticRoomPackPlacements.map((placement) => (
    deepFreezePlan(placement)
  ));
  for (const key of Object.keys(plan)) delete plan[key];
  Object.assign(plan, relocated);
  return plan;
}

export default relocateSemanticRoomPackAnnexesV2;
