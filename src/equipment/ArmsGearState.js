import {
  createDefaultArmLoadout,
  sanitizeArmLoadout,
  unlockArm,
  validateArmLoadout,
} from './ArmLoadout.js';
import {
  createDefaultGearLoadout,
  sanitizeGearLoadout,
  unlockGear,
  validateGearLoadout,
} from './GearLoadout.js';
import {
  ARM_GEAR_RECIPE_IDS,
  getEquipmentRecipeDefinition,
} from './EquipmentRecipeCatalog.js';

export const ARMS_GEAR_SCHEMA_VERSION = 1;

function projectState(arms, gear, fabricatedRecipeIds) {
  return {
    version: ARMS_GEAR_SCHEMA_VERSION,
    schemaVersion: ARMS_GEAR_SCHEMA_VERSION,
    defenseUnlocked: gear.unlockedSlots.includes('defense'),
    unlockedFixedArmIds: [...arms.ownedArmIds],
    unlockedGearIds: gear.records
      .filter((record) => record.unlocked)
      .map((record) => record.gearId),
    armSlots: {
      special1: arms.slots.special1 ? { ...arms.slots.special1 } : null,
      special2: arms.slots.special2 ? { ...arms.slots.special2 } : null,
      utility: arms.slots.utility ? { ...arms.slots.utility } : null,
    },
    gearSlots: { ...gear.slots },
    arms,
    gear,
    fabricatedRecipeIds: [...fabricatedRecipeIds],
  };
}

function cloneState(state) {
  return sanitizeArmsGearState(state);
}

export function createDefaultArmsGearState() {
  return projectState(createDefaultArmLoadout(), createDefaultGearLoadout(), []);
}

export function sanitizeArmsGearState(rawState = null) {
  const defaults = createDefaultArmsGearState();
  const source = rawState && typeof rawState === 'object' ? rawState : defaults;
  const armSource = source.arms ?? {
    ownedArmIds: source.unlockedFixedArmIds,
    slots: {
      megaBuster: { kind: 'megaBuster' },
      ...(source.armSlots ?? {}),
    },
  };
  const rawUnlockedGearIds = Array.isArray(source.unlockedGearIds)
    ? new Set(source.unlockedGearIds)
    : null;
  const gearSource = source.gear ?? {
    records: rawUnlockedGearIds
      ? defaults.gear.records.map((record) => ({
        gearId: record.gearId,
        unlocked: rawUnlockedGearIds.has(record.gearId),
      }))
      : defaults.gear.records,
    unlockedSlots: source.defenseUnlocked
      ? [...defaults.gear.unlockedSlots, 'defense']
      : defaults.gear.unlockedSlots,
    slots: source.gearSlots ?? defaults.gear.slots,
  };
  const recipeSource = Array.isArray(source.fabricatedRecipeIds)
    ? source.fabricatedRecipeIds
    : defaults.fabricatedRecipeIds;
  const recipeSet = new Set(recipeSource.filter((recipeId) => getEquipmentRecipeDefinition(recipeId)));
  const fabricatedRecipeIds = ARM_GEAR_RECIPE_IDS.filter((recipeId) => recipeSet.has(recipeId));
  let arms = sanitizeArmLoadout(armSource);
  let gear = sanitizeGearLoadout(gearSource);

  // A durable fabrication marker proves that its deterministic cost already
  // committed. If a partial save lost the mirrored unlock record, repair the
  // entitlement instead of charging the player again or quarantining the save.
  for (const recipeId of fabricatedRecipeIds) {
    const recipe = getEquipmentRecipeDefinition(recipeId);
    if (recipe.output.kind === 'arm') {
      arms = unlockArm(arms, recipe.output.id).state;
    } else {
      gear = unlockGear(gear, recipe.output.id).state;
    }
  }
  return projectState(
    arms,
    gear,
    fabricatedRecipeIds,
  );
}

function ownsRecipeOutput(state, recipe) {
  if (recipe.output.kind === 'arm') {
    return state.arms.ownedArmIds.includes(recipe.output.id);
  }
  return Boolean(state.gear.records.find((record) => (
    record.gearId === recipe.output.id && record.unlocked
  )));
}

export function validateArmsGearState(rawState, options = {}) {
  const errors = [];
  const source = rawState && typeof rawState === 'object' ? rawState : null;
  if (!source) {
    errors.push({ code: 'invalid-state', path: 'armsGear', message: 'Arms/gear state must be an object.' });
    return { valid: false, errors, state: sanitizeArmsGearState(rawState) };
  }
  if ((source.schemaVersion ?? source.version) !== ARMS_GEAR_SCHEMA_VERSION) {
    errors.push({
      code: 'unsupported-schema',
      path: 'schemaVersion',
      value: source.schemaVersion ?? source.version,
      message: `Arms/gear schema must be ${ARMS_GEAR_SCHEMA_VERSION}.`,
    });
  }

  const normalizedSource = sanitizeArmsGearState(source);
  const arms = validateArmLoadout(source.arms ?? normalizedSource.arms, options);
  const gear = validateGearLoadout(source.gear ?? normalizedSource.gear);
  errors.push(...arms.errors.map((error) => ({ ...error, path: `arms.${error.path}` })));
  errors.push(...gear.errors.map((error) => ({ ...error, path: `gear.${error.path}` })));

  const normalized = sanitizeArmsGearState(source);
  const fabricated = Array.isArray(source.fabricatedRecipeIds) ? source.fabricatedRecipeIds : [];
  if (!Array.isArray(source.fabricatedRecipeIds)) {
    errors.push({ code: 'invalid-recipe-markers', path: 'fabricatedRecipeIds', message: 'fabricatedRecipeIds must be an array.' });
  }
  const seen = new Set();
  for (let index = 0; index < fabricated.length; index += 1) {
    const recipeId = fabricated[index];
    const recipe = getEquipmentRecipeDefinition(recipeId);
    if (!recipe) {
      errors.push({ code: 'unknown-recipe', path: `fabricatedRecipeIds.${index}`, recipeId, message: `Unknown equipment recipe "${recipeId}".` });
      continue;
    }
    if (seen.has(recipeId)) {
      errors.push({ code: 'duplicate-recipe-marker', path: `fabricatedRecipeIds.${index}`, recipeId, message: `Duplicate recipe marker "${recipeId}".` });
    }
    seen.add(recipeId);
    if (!ownsRecipeOutput(normalized, recipe)) {
      errors.push({
        code: 'recipe-output-not-owned',
        path: `fabricatedRecipeIds.${index}`,
        recipeId,
        output: { ...recipe.output },
        message: `Fabricated output "${recipe.output.id}" is not owned.`,
      });
    }
  }

  return { valid: errors.length === 0, errors, state: normalized };
}

/**
 * Pure ownership transition for a recipe already paid for by a surrounding
 * atomic salvage transaction. It deliberately does not equip the new output.
 */
export function applyFabricatedRecipe(rawState, recipeId) {
  const state = sanitizeArmsGearState(rawState);
  const recipe = getEquipmentRecipeDefinition(recipeId);
  if (!recipe) return { ok: false, changed: false, reason: 'unknown-recipe', recipeId, state };

  const unlock = recipe.output.kind === 'arm'
    ? unlockArm(state.arms, recipe.output.id)
    : unlockGear(state.gear, recipe.output.id);
  if (!unlock.ok) {
    return { ok: false, changed: false, reason: unlock.reason, recipeId, state };
  }
  if (recipe.output.kind === 'arm') state.arms = unlock.state;
  else state.gear = unlock.state;

  const alreadyMarked = state.fabricatedRecipeIds.includes(recipeId);
  const markers = new Set([...state.fabricatedRecipeIds, recipeId]);
  state.fabricatedRecipeIds = ARM_GEAR_RECIPE_IDS.filter((id) => markers.has(id));
  return {
    ok: true,
    changed: unlock.changed || !alreadyMarked,
    reason: !unlock.changed && alreadyMarked ? 'already-fabricated' : null,
    recipeId,
    output: { ...recipe.output },
    state: cloneState(state),
  };
}
