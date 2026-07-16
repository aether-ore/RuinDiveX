import { getFixedArmDefinition } from './ArmCatalog.js';
import { getGearDefinition } from './GearCatalog.js';
import { REAVERBOT_SALVAGE_MATERIALS } from '../reaverbots/ReaverbotSalvageCatalog.js';

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function recipeDefinition({
  id,
  outputKind,
  outputId = id,
  scrapCost,
  partIds,
  requiresDefenseUnlock = false,
}) {
  const outputDefinition = outputKind === 'arm'
    ? getFixedArmDefinition(outputId)
    : outputKind === 'gear'
      ? getGearDefinition(outputId)
      : null;
  if (!outputDefinition) {
    throw new Error(`Equipment recipe "${id}" has unknown ${outputKind} output "${outputId}".`);
  }

  for (const partId of partIds) {
    if (!REAVERBOT_SALVAGE_MATERIALS[partId]) {
      throw new Error(`Equipment recipe "${id}" has unknown salvage part "${partId}".`);
    }
  }

  const parts = Object.fromEntries(partIds.map((partId) => [partId, 1]));
  const requirements = {
    identifiedScrap: scrapCost,
    scrap: scrapCost,
    parts: { ...parts },
  };

  return deepFreeze({
    id,
    recipeId: id,
    label: outputDefinition.label,
    output: { kind: outputKind, id: outputId },
    outputKind,
    outputId,
    scrapCost,
    parts,
    requirements,
    requiredPartIds: [...partIds],
    requiresDefenseUnlock: Boolean(requiresDefenseUnlock),
  });
}

/**
 * Deterministic Roll fabrication recipes. Object insertion order is the
 * authored display order; each named component has an exact quantity of one.
 */
export const ARM_GEAR_RECIPE_CATALOG = deepFreeze({
  jumpSprings: recipeDefinition({
    id: 'jumpSprings',
    outputKind: 'gear',
    scrapCost: 12,
    partIds: ['temperedJumpSpring', 'stabilizedBellyCore'],
  }),
  machineGunArm: recipeDefinition({
    id: 'machineGunArm',
    outputKind: 'arm',
    scrapCost: 12,
    partIds: ['revolvingPulseBarrel', 'ammunitionFeedDrum'],
  }),
  cannonArm: recipeDefinition({
    id: 'cannonArm',
    outputKind: 'arm',
    scrapCost: 14,
    partIds: ['heavyServoFrame', 'threeAxisGyro', 'ancientBatteryPack'],
  }),
  grenadeArm: recipeDefinition({
    id: 'grenadeArm',
    outputKind: 'arm',
    scrapCost: 16,
    partIds: ['highAngleLaunchTube', 'ballisticsLogicChip', 'clusterBurstSequencer'],
  }),
  missileArm: recipeDefinition({
    id: 'missileArm',
    outputKind: 'arm',
    scrapCost: 18,
    partIds: ['behaviorChipPursuit', 'rubyOpticLens', 'vectoringRocketNozzle'],
  }),
  shiningLaser: recipeDefinition({
    id: 'shiningLaser',
    outputKind: 'arm',
    scrapCost: 18,
    partIds: ['ancientFocusPrism', 'coolingFinArray', 'ancientBatteryPack'],
  }),
  drillArm: recipeDefinition({
    id: 'drillArm',
    outputKind: 'arm',
    scrapCost: 14,
    partIds: ['torqueJawGear', 'heavyServoFrame', 'serratedClawGear'],
  }),
  guardProjector: recipeDefinition({
    id: 'guardProjector',
    outputKind: 'gear',
    scrapCost: 14,
    partIds: ['metalShieldPlating', 'shieldPivotJoint', 'behaviorChipSentry'],
    requiresDefenseUnlock: true,
  }),
  heatResistChip: recipeDefinition({
    id: 'heatResistChip',
    outputKind: 'gear',
    scrapCost: 10,
    partIds: ['ceramicFlameNozzle', 'coolingFinArray'],
  }),
  jetSkates: recipeDefinition({
    id: 'jetSkates',
    outputKind: 'gear',
    scrapCost: 14,
    partIds: ['ancientWheelGearset', 'vectoringRocketNozzle'],
  }),
  targetScanner: recipeDefinition({
    id: 'targetScanner',
    outputKind: 'gear',
    scrapCost: 10,
    partIds: ['rubyOpticLens'],
  }),
  fastSwapAdapter: recipeDefinition({
    id: 'fastSwapAdapter',
    outputKind: 'gear',
    scrapCost: 8,
    partIds: ['lightweightServoRod', 'aerofoilServo'],
  }),
});

export const EQUIPMENT_RECIPE_CATALOG = ARM_GEAR_RECIPE_CATALOG;
export const ARM_GEAR_RECIPES = ARM_GEAR_RECIPE_CATALOG;
export const ARM_GEAR_RECIPE_LIST = Object.freeze(Object.values(ARM_GEAR_RECIPE_CATALOG));
export const EQUIPMENT_RECIPE_LIST = ARM_GEAR_RECIPE_LIST;
export const ARM_GEAR_RECIPE_IDS = Object.freeze(ARM_GEAR_RECIPE_LIST.map((recipe) => recipe.id));

export function getEquipmentRecipeDefinition(recipeId) {
  return typeof recipeId === 'string' ? ARM_GEAR_RECIPE_CATALOG[recipeId] ?? null : null;
}

export const getArmGearRecipeDefinition = getEquipmentRecipeDefinition;

export function getEquipmentRecipesForPart(partId) {
  if (typeof partId !== 'string') return [];
  return ARM_GEAR_RECIPE_LIST.filter((recipe) => recipe.requiredPartIds.includes(partId));
}
