const RECORD_ID_FIELDS = Object.freeze({
  floorTier: ['localTierId'],
  clearRoute: ['localRouteId'],
  zone: ['localZoneId'],
  furnishing: ['localAnchorId', 'sourceRecordId'],
  cover: ['localCoverId', 'sourceRecordId'],
  landmark: ['localLandmarkId', 'sourceRecordId'],
  lighting: ['localLightingId', 'sourceRecordId'],
});

const OMITTED_KEYS = new Set([
  'anchorId',
  'authoritative',
  'collisionId',
  'floorKey',
  'fromSocketBindings',
  'grid',
  'nodeId',
  'operationId',
  'physicalRealizationId',
  'position',
  'preRender',
  'recipeInstanceId',
  'requiredRuntimeStateId',
  'roomId',
  'routeCollisionId',
  'runtimeId',
  'runtimeStateId',
  'spawnPosition',
  'stateId',
  'themeBinding',
  'worldPosition',
]);

const FURNISHING_RECIPE_KEYS = new Set([
  'catalogRecipeId',
  'discoveryRecipe',
  'encounterRecipe',
  'hazardRecipe',
  'mechanismRecipe',
  'recipeId',
  'recipeInstanceId',
  'recipeKind',
  'rewardRecipe',
]);

function normalizedNumber(value) {
  const rounded = Number(Number(value).toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function keyIsRuntimeProjection(key) {
  return OMITTED_KEYS.has(key)
    || /^world[A-Z]/.test(key)
    || /^runtime[A-Z]/.test(key)
    || /RuntimeId(?:s)?$/.test(key)
    || /^resolved[A-Z]/.test(key);
}

function normalizeStableValue(value, { furnishing = false } = {}) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? normalizedNumber(value) : null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeStableValue(entry, { furnishing }));
  }
  if (typeof value !== 'object') return String(value);

  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (keyIsRuntimeProjection(key) || (furnishing && FURNISHING_RECIPE_KEYS.has(key))) {
      continue;
    }
    const entry = normalizeStableValue(value[key], { furnishing });
    if (entry !== undefined) normalized[key] = entry;
  }
  return normalized;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalValue(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function compareCanonical(left, right) {
  const leftValue = canonicalValue(left);
  const rightValue = canonicalValue(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function normalizeRecord(record, kind, { furnishing = false } = {}) {
  if (!record || typeof record !== 'object') return null;
  const stableId = (RECORD_ID_FIELDS[kind] ?? [])
    .map((field) => record[field])
    .find((value) => value != null && String(value).trim());
  const source = { ...record };
  if (stableId != null) source.id = String(stableId);
  else delete source.id;
  for (const fields of Object.values(RECORD_ID_FIELDS)) {
    for (const field of fields) delete source[field];
  }
  return normalizeStableValue(source, { furnishing });
}

function normalizedSortedRecords(records, kind, options) {
  return (Array.isArray(records) ? records : [])
    .map((record) => normalizeRecord(record, kind, options))
    .filter(Boolean)
    .sort(compareCanonical);
}

function normalizeRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') return null;
  return normalizeStableValue(recipe);
}

function normalizedSortedRecipes(recipes) {
  return (Array.isArray(recipes) ? recipes : [])
    .map(normalizeRecipe)
    .filter(Boolean)
    .sort(compareCanonical);
}

function normalizeEncounterChoice(choice) {
  if (!choice || typeof choice !== 'object') return null;
  const recipe = normalizeRecipe(choice.encounterRecipe ?? choice.recipe);
  const selectedRoster = choice.roster ?? recipe?.roster;
  const roster = (Array.isArray(selectedRoster) ? selectedRoster : []).map(String);
  const selectedSpatialRoles = choice.spatialRoles ?? recipe?.spatialRoles;
  const spatialRoles = (Array.isArray(selectedSpatialRoles) ? selectedSpatialRoles : [])
    .map((role) => normalizeStableValue(role));
  return {
    encounterProfileId: String(
      choice.encounterProfileId ?? recipe?.encounterProfileId ?? '',
    ) || null,
    recipe,
    roster,
    spatialRoles,
  };
}

function normalizeRoom(room) {
  const geometry = room?.geometry ?? {};
  return {
    ordinal: Number.isFinite(Number(room?.ordinal)) ? Number(room.ordinal) : 0,
    contentRole: room?.contentRole == null ? null : String(room.contentRole),
    moduleManifestId: room?.moduleManifestId == null
      ? null
      : String(room.moduleManifestId),
    moduleTemplateId: room?.moduleTemplateId == null
      ? null
      : String(room.moduleTemplateId),
    moduleKind: room?.moduleKind == null ? null : String(room.moduleKind),
    physicalModuleKind: room?.physicalModuleKind == null
      ? null
      : String(room.physicalModuleKind),
    geometry: {
      dimensionsTiles: normalizeStableValue(geometry.dimensionsTiles ?? null),
      rotationQuarterTurns: ((Math.trunc(Number(
        geometry.rotationQuarterTurns ?? 0,
      )) % 4) + 4) % 4,
      layout: normalizeStableValue(geometry.layout ?? null),
      floorCellMeters: Number.isFinite(Number(geometry.floorCellMeters))
        ? normalizedNumber(geometry.floorCellMeters)
        : null,
      floorMask: (Array.isArray(geometry.floorMask) ? geometry.floorMask : [])
        .map((row) => String(row ?? '')),
      floorTiers: normalizedSortedRecords(geometry.floorTiers, 'floorTier'),
      clearRoutes: normalizedSortedRecords(geometry.clearRoutes, 'clearRoute'),
      zones: normalizedSortedRecords(geometry.zones, 'zone'),
    },
    furnishing: normalizedSortedRecords(room?.furnishing, 'furnishing', {
      furnishing: true,
    }),
    cover: normalizedSortedRecords(room?.cover, 'cover'),
    landmarks: normalizedSortedRecords(room?.landmarks, 'landmark'),
    lighting: normalizedSortedRecords(room?.lighting, 'lighting'),
    hazardRecipes: normalizedSortedRecipes(room?.hazardRecipes),
    encounterChoices: (Array.isArray(room?.encounterChoices) ? room.encounterChoices : [])
      .map(normalizeEncounterChoice)
      .filter(Boolean)
      .sort(compareCanonical),
    rewardRecipes: normalizedSortedRecipes(room?.rewardRecipes),
  };
}

/**
 * Creates the release/runtime variety signature from renderer-free topology
 * fields plus realized room-local content. World translation, projected
 * positions, and runtime state/instance IDs are intentionally discarded.
 */
export function createDungeonAugmentationCompleteLayoutSignature({
  legacyFields = {},
  rooms = [],
} = {}) {
  const normalizedRooms = (Array.isArray(rooms) ? rooms : [])
    .map(normalizeRoom)
    .sort((left, right) => (
      left.ordinal - right.ordinal
        || compareCanonical(left, right)
    ));
  return canonicalValue({
    ...normalizeStableValue(legacyFields),
    roomContent: normalizedRooms,
  });
}
