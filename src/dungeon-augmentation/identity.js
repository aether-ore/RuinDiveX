import {
  DUNGEON_AUGMENTATION_OVERLAY_SCHEMA,
  DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA,
  DUNGEON_AUGMENTATION_SAVE_IDENTITY_SCHEMA,
} from './contracts.js';
import {
  canonicalStringify,
  deepFreezeDungeonAugmentationValue,
} from './canonical.js';
import { computeEffectiveDungeonPlanHash } from './validation.js';
import { normalizeRouteNetworkConflictExclusions } from './routeNetworkModulePruning.js';

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeThemeRevision(entry = {}) {
  const themeRef = entry.themeRef ?? entry;
  return {
    parentRegionId: stringValue(entry.parentRegionId),
    themeId: stringValue(entry.themeId ?? themeRef.id),
    revision: stringValue(entry.revision ?? themeRef.revision),
    contentHash: stringValue(entry.contentHash ?? themeRef.contentHash),
  };
}

function normalizeThemeRevisions(values = []) {
  const byIdentity = new Map();
  for (const raw of Array.isArray(values) ? values : []) {
    const entry = normalizeThemeRevision(raw);
    if (!entry.parentRegionId || !entry.themeId || !entry.revision || !entry.contentHash) continue;
    byIdentity.set(`${entry.parentRegionId}\u0000${entry.themeId}`, entry);
  }
  return [...byIdentity.values()].sort((a, b) => (
    a.parentRegionId.localeCompare(b.parentRegionId) || a.themeId.localeCompare(b.themeId)
  ));
}

function normalizeProgressionStateIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(stringValue)
    .filter(Boolean))]
    .sort();
}

function normalizeRouteNetworkPruningOverrides(values = []) {
  const byGrantId = new Map();
  for (const raw of Array.isArray(values) ? values : []) {
    const grantId = stringValue(raw?.grantId);
    const reason = stringValue(raw?.reason).slice(0, 128);
    if (!grantId || !reason) continue;
    const candidate = { grantId, reason };
    const current = byGrantId.get(grantId);
    if (!current || reason.localeCompare(current.reason) < 0) {
      byGrantId.set(grantId, candidate);
    }
  }
  return [...byGrantId.values()].sort((left, right) => (
    left.grantId.localeCompare(right.grantId)
      || left.reason.localeCompare(right.reason)
  ));
}

function appendStateIdValues(target, value) {
  if (typeof value === 'string') {
    const id = stringValue(value);
    if (id) target.add(id);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) appendStateIdValues(target, entry);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const entry of Object.values(value)) appendStateIdValues(target, entry);
}

const STATEFUL_ANCHOR_KINDS = new Set([
  'encounter', 'reward', 'chest', 'mechanism', 'control', 'terminal',
  'door', 'gate', 'keycard', 'progression', 'progressionKey', 'trap', 'hazard',
]);

function appendRecordStateIds(target, record) {
  if (!record || typeof record !== 'object') return;
  for (const field of [
    'runtimeStateIds',
    'shortcutStateIds',
    'stableRuntimeStateIds',
    'progressionStateIds',
  ]) {
    appendStateIdValues(target, record[field]);
  }
  for (const field of [
    'runtimeStateId',
    'stableRuntimeStateId',
    'shortcutStateId',
    'localProgressionStateId',
    'stateId',
  ]) {
    appendStateIdValues(target, record[field]);
  }
  appendStateIdValues(target, record.shortcut?.stateId);
  appendStateIdValues(target, record.traversal?.stateId);
  appendStateIdValues(target, record.mechanism?.stateId);
  appendStateIdValues(target, record.reward?.stateId);
  for (const anchor of Array.isArray(record.anchors) ? record.anchors : []) {
    appendRecordStateIds(target, anchor);
    if (STATEFUL_ANCHOR_KINDS.has(anchor?.kind)) appendStateIdValues(target, anchor.id);
  }
}

/**
 * Collects the stable mutable-state namespace advertised by an overlay/effective
 * plan. V4 may publish these IDs as arrays, role maps, or on materialized
 * segments/connections, so the collector intentionally accepts all three.
 */
export function collectDungeonAugmentationStableStateIds(source = {}) {
  const stateIds = new Set();
  for (const collection of [
    source.operations,
    source.nodes,
    source.segments,
    source.connections,
    source.connectionPlans,
    source.progressionAssignments,
    source.stateBindings,
  ]) {
    for (const record of Array.isArray(collection) ? collection : []) {
      appendRecordStateIds(stateIds, record);
    }
  }
  for (const operation of Array.isArray(source.operations) ? source.operations : []) {
    for (const collection of [
      operation.nodes,
      operation.rooms,
      operation.modules,
      operation.segments,
      operation.connections,
    ]) {
      for (const record of Array.isArray(collection) ? collection : []) {
        appendRecordStateIds(stateIds, record);
      }
    }
  }
  for (const assignment of Array.isArray(source.progressionAssignments)
    ? source.progressionAssignments
    : []) {
    appendStateIdValues(stateIds, assignment?.id);
  }
  appendRecordStateIds(stateIds, source);
  return [...stateIds].sort();
}

function normalizeMutableStateValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 128);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

function normalizeMutableState(value, allowedStateIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = new Set(allowedStateIds);
  const normalized = {};
  for (const stateId of [...allowed].sort()) {
    if (!Object.prototype.hasOwnProperty.call(value, stateId)) continue;
    const stateValue = normalizeMutableStateValue(value[stateId]);
    if (stateValue !== undefined) normalized[stateId] = stateValue;
  }
  return normalized;
}

function identityInputFromOverlay(plan, options = {}) {
  return {
    profileId: plan.profileId,
    seed: options.seed ?? plan.augmentationSeed ?? plan.layoutSeed,
    basePlanHash: plan.basePlanHash,
    augmentationPlanHash: plan.augmentationPlanHash,
    effectivePlanHash: plan.effectivePlanHash,
    themeRevisions: plan.themeBindings?.map(({ binding }) => ({
      parentRegionId: binding.parentRegionId,
      themeRef: binding.themeRef,
    })) ?? [],
    progressionStateIds: options.progressionStateIds
      ?? collectDungeonAugmentationStableStateIds(plan),
    routeNetworkPruningOverrides: options.routeNetworkPruningOverrides
      ?? plan.routeNetworkPruningOverrides,
    routeNetworkConflictExclusions: options.routeNetworkConflictExclusions
      ?? plan.routeNetworkConflictExclusions,
    mutableState: options.mutableState ?? plan.mutableState,
  };
}

export function createDungeonAugmentationSaveIdentity(input = {}) {
  const source = [
    DUNGEON_AUGMENTATION_OVERLAY_SCHEMA,
    DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA,
  ].includes(input?.schema)
    ? identityInputFromOverlay(input)
    : input;
  const progressionStateIds = normalizeProgressionStateIds(source.progressionStateIds);
  const routeNetworkPruningOverrides = normalizeRouteNetworkPruningOverrides(
    source.routeNetworkPruningOverrides,
  );
  const routeNetworkConflictExclusions = normalizeRouteNetworkConflictExclusions(
    source.routeNetworkConflictExclusions,
  );
  const mutableState = normalizeMutableState(source.mutableState, progressionStateIds);
  const identity = {
    schema: DUNGEON_AUGMENTATION_SAVE_IDENTITY_SCHEMA,
    profileId: stringValue(source.profileId),
    seed: stringValue(source.seed),
    basePlanHash: stringValue(source.basePlanHash),
    augmentationPlanHash: stringValue(source.augmentationPlanHash),
    effectivePlanHash: stringValue(source.effectivePlanHash),
    themeRevisions: normalizeThemeRevisions(source.themeRevisions),
    progressionStateIds,
  };
  if (routeNetworkPruningOverrides.length > 0) {
    identity.routeNetworkPruningOverrides = routeNetworkPruningOverrides;
  }
  if (routeNetworkConflictExclusions.length > 0) {
    identity.routeNetworkConflictExclusions = routeNetworkConflictExclusions;
  }
  if (Object.keys(mutableState).length > 0) identity.mutableState = mutableState;
  const missing = ['profileId', 'seed', 'basePlanHash', 'augmentationPlanHash', 'effectivePlanHash']
    .filter((key) => !identity[key]);
  if (missing.length > 0) {
    throw new TypeError(`Dungeon augmentation save identity is missing: ${missing.join(', ')}.`);
  }
  const expectedEffectiveHash = computeEffectiveDungeonPlanHash(
    identity.basePlanHash,
    identity.augmentationPlanHash,
  );
  if (identity.effectivePlanHash !== expectedEffectiveHash) {
    throw new TypeError('Dungeon augmentation save identity has an inconsistent effective plan hash.');
  }
  return deepFreezeDungeonAugmentationValue(identity);
}

/** Returns a committed identity carrying only allow-listed stable state values. */
export function withDungeonAugmentationMutableState(value, mutableState = {}, {
  merge = true,
} = {}) {
  const identity = toIdentity(value);
  if (!identity) return null;
  return createDungeonAugmentationSaveIdentity({
    ...identity,
    mutableState: merge
      ? { ...(identity.mutableState ?? {}), ...(mutableState ?? {}) }
      : mutableState,
  });
}

/** Returns a canonical frozen identity or null for untrusted/legacy input. */
export function sanitizeDungeonAugmentationSaveIdentity(value) {
  if (!value || value.schema !== DUNGEON_AUGMENTATION_SAVE_IDENTITY_SCHEMA) return null;
  try {
    return createDungeonAugmentationSaveIdentity(value);
  } catch {
    return null;
  }
}

function toIdentity(value) {
  if (!value) return null;
  if ([
    DUNGEON_AUGMENTATION_OVERLAY_SCHEMA,
    DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA,
  ].includes(value.schema)) {
    try {
      return createDungeonAugmentationSaveIdentity(value);
    } catch {
      return null;
    }
  }
  return sanitizeDungeonAugmentationSaveIdentity(value);
}

/**
 * Checks whether a committed augmented expedition can safely resume. Any
 * missing or changed augmented content is an explicit incompatibility so a
 * caller can offer reset/abandon instead of silently removing generated rooms.
 */
export function validateCommittedDungeonAugmentationIdentity(savedValue, currentValue) {
  const savedIdentity = toIdentity(savedValue);
  const currentIdentity = toIdentity(currentValue);
  const errors = [];
  if (!savedValue && !currentValue) {
    return deepFreezeDungeonAugmentationValue({
      compatible: true,
      status: 'legacy-unaugmented',
      resetOrAbandonRequired: false,
      errors,
      savedIdentity: null,
      currentIdentity: null,
    });
  }
  if (savedValue && !savedIdentity) {
    errors.push({ code: 'saved-augmentation-identity-invalid', message: 'The committed augmentation identity is invalid.' });
  }
  if (currentValue && !currentIdentity) {
    errors.push({ code: 'current-augmentation-identity-invalid', message: 'The available augmentation identity is invalid.' });
  }
  if (!savedValue && currentIdentity) {
    errors.push({ code: 'legacy-save-cannot-gain-augmentation', message: 'An unaugmented committed run cannot gain generated rooms during resume.' });
  }
  if (savedIdentity && !currentValue) {
    errors.push({ code: 'committed-augmentation-content-unavailable', message: 'The generated content required by this committed run is unavailable.' });
  }
  if (savedIdentity && currentIdentity) {
    for (const key of ['profileId', 'seed', 'basePlanHash', 'augmentationPlanHash', 'effectivePlanHash']) {
      if (savedIdentity[key] !== currentIdentity[key]) {
        errors.push({
          code: `augmentation-${key}-mismatch`,
          message: `Committed augmentation ${key} does not match available content.`,
          expected: savedIdentity[key],
          actual: currentIdentity[key],
        });
      }
    }
    if (canonicalStringify(savedIdentity.themeRevisions) !== canonicalStringify(currentIdentity.themeRevisions)) {
      errors.push({ code: 'augmentation-theme-revisions-mismatch', message: 'One or more parent theme revisions changed.' });
    }
    if (canonicalStringify(savedIdentity.progressionStateIds)
      !== canonicalStringify(currentIdentity.progressionStateIds)) {
      errors.push({ code: 'augmentation-progression-state-ids-mismatch', message: 'Generated progression identities changed.' });
    }
    if (canonicalStringify(savedIdentity.routeNetworkPruningOverrides ?? [])
      !== canonicalStringify(currentIdentity.routeNetworkPruningOverrides ?? [])) {
      errors.push({
        code: 'augmentation-route-network-pruning-overrides-mismatch',
        message: 'Committed route-network pruning overrides do not match available content.',
      });
    }
    if (canonicalStringify(savedIdentity.routeNetworkConflictExclusions ?? [])
      !== canonicalStringify(currentIdentity.routeNetworkConflictExclusions ?? [])) {
      errors.push({
        code: 'augmentation-route-network-conflict-exclusions-mismatch',
        message: 'Committed route-network conflict exclusions do not match available content.',
      });
    }
  }
  return deepFreezeDungeonAugmentationValue({
    compatible: errors.length === 0,
    status: errors.length === 0 ? 'compatible' : 'incompatible-content',
    resetOrAbandonRequired: errors.length > 0,
    errors,
    savedIdentity,
    currentIdentity,
  });
}
