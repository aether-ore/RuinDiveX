import {
  cloneDungeonAugmentationValue,
  deepFreezeDungeonAugmentationValue,
  hashCanonicalValue,
} from './canonical.js';

export const DUNGEON_EXTENSION_HOST_SCHEMA = 'ruindivex-dungeon-extension-host/v1';
export const DUNGEON_REGION_THEME_SCHEMA = 'ruindivex-dungeon-region-theme/v1';
export const DUNGEON_THEME_CAPABILITIES_SCHEMA = 'ruindivex-dungeon-theme-capabilities/v1';
export const DUNGEON_SUPPLEMENT_GRAMMAR_SCHEMA = 'ruindivex-dungeon-supplement-grammar/v1';
export const DUNGEON_AUGMENTATION_PROFILE_SCHEMA = 'ruindivex-dungeon-augmentation-profile/v1';
export const DUNGEON_AUGMENTATION_OVERLAY_SCHEMA = 'ruindivex-dungeon-augmentation-overlay/v1';
export const DUNGEON_AUGMENTATION_OPERATION_SCHEMA = 'ruindivex-dungeon-augmentation-operation/v1';
export const DUNGEON_TRANSITION_BAY_SCHEMA = 'ruindivex-dungeon-transition-bay/v1';
export const DUNGEON_AUGMENTATION_RESULT_SCHEMA = 'ruindivex-dungeon-augmentation-result/v1';
export const DUNGEON_AUGMENTATION_DIAGNOSTICS_SCHEMA = 'ruindivex-dungeon-augmentation-diagnostics/v1';
export const DUNGEON_AUGMENTATION_EFFECTIVE_DRAFT_SCHEMA = 'ruindivex-dungeon-effective-draft-augmentation/v1';
export const DUNGEON_AUGMENTATION_SAVE_IDENTITY_SCHEMA = 'ruindivex-dungeon-augmentation-save-identity/v1';
export const DUNGEON_AUGMENTATION_SCHEMA_REVISION = 1;

export const DUNGEON_AUGMENTATION_OPERATION_TYPES = Object.freeze([
  'optionalBranch',
  'edgePadding',
  'delegatedProgression',
]);

export const DUNGEON_AUGMENTATION_UNCHANGED_REASONS = Object.freeze([
  'augmentation-disabled',
  'invalid-input',
  'profile-not-found',
  'profile-not-allowed',
  'no-eligible-regions',
  'no-eligible-operations',
  'theme-capabilities-missing',
  'planning-failed',
  'validation-failed',
  'base-draft-mutated',
]);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeStringArray(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter(nonEmptyString)
    .map((entry) => entry.trim()))]
    .sort();
}

export function createDungeonRegionThemeBinding(input = {}) {
  const themeRef = input.themeRef ?? {};
  const binding = {
    schema: DUNGEON_REGION_THEME_SCHEMA,
    parentMapId: String(input.parentMapId ?? ''),
    parentMapRevision: String(input.parentMapRevision ?? ''),
    parentRegionId: String(input.parentRegionId ?? ''),
    themeRef: {
      id: String(themeRef.id ?? ''),
      revision: String(themeRef.revision ?? ''),
      contentHash: String(themeRef.contentHash ?? ''),
    },
    presentationVariantId: String(input.presentationVariantId ?? ''),
    localLightingProfileId: String(input.localLightingProfileId ?? ''),
    soundscapeProfileId: String(input.soundscapeProfileId ?? ''),
  };
  return deepFreezeDungeonAugmentationValue(binding);
}

export function createDungeonThemeCapabilities(input = {}) {
  return deepFreezeDungeonAugmentationValue({
    schema: DUNGEON_THEME_CAPABILITIES_SCHEMA,
    materials: normalizeStringArray(input.materials),
    assets: normalizeStringArray(input.assets),
    connectors: normalizeStringArray(input.connectors),
    transitions: normalizeStringArray(input.transitions),
  });
}

export function validateDungeonRegionThemeBinding(binding) {
  const errors = [];
  if (binding?.schema !== DUNGEON_REGION_THEME_SCHEMA) errors.push('invalid-theme-binding-schema');
  for (const key of ['parentMapId', 'parentMapRevision', 'parentRegionId']) {
    if (!nonEmptyString(binding?.[key])) errors.push(`missing-theme-binding-${key}`);
  }
  for (const key of ['id', 'revision', 'contentHash']) {
    if (!nonEmptyString(binding?.themeRef?.[key])) errors.push(`missing-theme-ref-${key}`);
  }
  return deepFreezeDungeonAugmentationValue({
    accepted: errors.length === 0,
    errors,
    bindingHash: errors.length === 0
      ? hashCanonicalValue(binding, { namespace: 'ruindivex-dungeon-region-theme/v1' })
      : null,
  });
}

export function validateDungeonExtensionHost(host) {
  const errors = [];
  const warnings = [];
  if (host?.schema !== DUNGEON_EXTENSION_HOST_SCHEMA) errors.push('invalid-extension-host-schema');
  if (!nonEmptyString(host?.basePlanHash)) errors.push('missing-base-plan-hash');
  if (!Array.isArray(host?.extensionRegions)) errors.push('missing-extension-regions');
  const ids = new Set();
  for (const [index, region] of (host?.extensionRegions ?? []).entries()) {
    if (!nonEmptyString(region?.id)) errors.push(`missing-extension-region-id:${index}`);
    else if (ids.has(region.id)) errors.push(`duplicate-extension-region-id:${region.id}`);
    else ids.add(region.id);
    const binding = validateDungeonRegionThemeBinding(region?.themeBinding);
    errors.push(...binding.errors.map((error) => `${region?.id ?? index}:${error}`));
    if (!Array.isArray(region?.attachmentSockets)) errors.push(`${region?.id ?? index}:missing-attachment-sockets`);
    if (!Array.isArray(region?.spliceEdges)) errors.push(`${region?.id ?? index}:missing-splice-edges`);
    if (!Array.isArray(region?.allowedProfileIds)) warnings.push(`${region?.id ?? index}:no-allowed-profile-ids`);
    if (!Array.isArray(region?.delegatedProgressionBeats)) {
      warnings.push(`${region?.id ?? index}:no-delegated-progression-beats`);
    }
  }
  return deepFreezeDungeonAugmentationValue({
    accepted: errors.length === 0,
    errors,
    warnings,
  });
}

export function cloneDungeonExtensionRegions(regions = []) {
  return cloneDungeonAugmentationValue(Array.isArray(regions) ? regions : []);
}

