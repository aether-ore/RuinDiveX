import {
  DUNGEON_AUGMENTATION_OVERLAY_SCHEMA,
  DUNGEON_AUGMENTATION_SAVE_IDENTITY_SCHEMA,
} from './contracts.js';
import {
  canonicalStringify,
  deepFreezeDungeonAugmentationValue,
} from './canonical.js';
import { computeEffectiveDungeonPlanHash } from './validation.js';

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

function identityInputFromOverlay(plan, options = {}) {
  const statefulAnchorKinds = new Set([
    'encounter', 'reward', 'chest', 'mechanism', 'control', 'terminal',
    'door', 'gate', 'keycard', 'progression', 'progressionKey', 'trap', 'hazard',
  ]);
  const anchorStateIds = (plan.nodes ?? []).flatMap((node) => (node.anchors ?? [])
    .filter((anchor) => statefulAnchorKinds.has(anchor.kind))
    .map((anchor) => anchor.id));
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
      ?? [
        ...anchorStateIds,
        ...(plan.progressionAssignments?.map(({ id }) => id) ?? []),
      ],
  };
}

export function createDungeonAugmentationSaveIdentity(input = {}) {
  const source = input?.schema === DUNGEON_AUGMENTATION_OVERLAY_SCHEMA
    ? identityInputFromOverlay(input)
    : input;
  const identity = {
    schema: DUNGEON_AUGMENTATION_SAVE_IDENTITY_SCHEMA,
    profileId: stringValue(source.profileId),
    seed: stringValue(source.seed),
    basePlanHash: stringValue(source.basePlanHash),
    augmentationPlanHash: stringValue(source.augmentationPlanHash),
    effectivePlanHash: stringValue(source.effectivePlanHash),
    themeRevisions: normalizeThemeRevisions(source.themeRevisions),
    progressionStateIds: normalizeProgressionStateIds(source.progressionStateIds),
  };
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
  if (value.schema === DUNGEON_AUGMENTATION_OVERLAY_SCHEMA) {
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
