import { GEAR_SLOTS, getGearDefinition } from './GearCatalog.js';

export const DEFAULT_ARM_SWAP_TRANSITION_TIME = 0.34;

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function getUnlockedGearIds(loadout) {
  if (!Array.isArray(loadout?.records)) return null;
  return new Set(loadout.records
    .filter((record) => record?.unlocked)
    .map((record) => record.gearId));
}

function getUnlockedSlots(loadout) {
  if (!Array.isArray(loadout?.unlockedSlots)) return null;
  return new Set(loadout.unlockedSlots);
}

function getSlots(loadout) {
  if (loadout && typeof loadout.getId === 'function') {
    return Object.fromEntries(GEAR_SLOTS.map((slot) => [slot, loadout.getId(slot)]));
  }
  return loadout?.slots && typeof loadout.slots === 'object' ? loadout.slots : loadout ?? {};
}

export class GearEffectResolutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GearEffectResolutionError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/**
 * Resolves only the explicit typed domains consumed by gameplay. Unknown
 * effect IDs fail visibly rather than flowing into the player's stat sheet.
 */
export function resolveGearEffects(loadout = {}) {
  const slots = getSlots(loadout);
  const unlockedGearIds = getUnlockedGearIds(loadout);
  const unlockedSlots = getUnlockedSlots(loadout);
  const equippedGearIds = [];
  const effectIds = [];
  const utilityEffects = [];
  const hazardImmunities = [];

  let healthDamageMultiplier = 1;
  let reactionTierReduction = 0;
  let jumpReachMultiplier = 1;
  let defense = null;
  let jetSkates = null;
  let targetScanner = null;
  let armSwapTransitionTime = DEFAULT_ARM_SWAP_TRANSITION_TIME;

  for (const slot of GEAR_SLOTS) {
    if (unlockedSlots && !unlockedSlots.has(slot)) continue;
    const gearId = slots?.[slot];
    if (!gearId) continue;
    if (unlockedGearIds && !unlockedGearIds.has(gearId)) continue;

    const gear = getGearDefinition(gearId);
    if (!gear) {
      throw new GearEffectResolutionError(
        'unknown-gear',
        `Cannot resolve unknown gear id "${gearId}".`,
        { slot, gearId },
      );
    }
    if (!gear.allowedSlots.includes(slot)) {
      throw new GearEffectResolutionError(
        'incompatible-slot',
        `${gear.label} cannot resolve from ${slot}.`,
        { slot, gearId },
      );
    }

    const effect = gear.effect;
    equippedGearIds.push(gear.id);
    effectIds.push(effect.id);

    switch (effect.id) {
      case 'healthDamageMultiplier':
        healthDamageMultiplier = effect.multiplier;
        break;
      case 'reactionTierReduction':
        reactionTierReduction = effect.tiers;
        break;
      case 'jumpReachMultiplier':
        jumpReachMultiplier = effect.multiplier;
        break;
      case 'rechargingBarrier':
      case 'guardProjector':
        defense = effect;
        break;
      case 'hazardImmunity':
        hazardImmunities.push(effect);
        utilityEffects.push(effect);
        break;
      case 'jetSkates':
        jetSkates = effect;
        utilityEffects.push(effect);
        break;
      case 'targetScanner':
        targetScanner = effect;
        utilityEffects.push(effect);
        break;
      case 'armSwapTransition':
        armSwapTransitionTime = effect.transitionTime;
        utilityEffects.push(effect);
        break;
      default:
        throw new GearEffectResolutionError(
          'unknown-effect',
          `Cannot resolve unknown gear effect "${effect.id}".`,
          { slot, gearId, effectId: effect.id },
        );
    }
  }

  return deepFreeze({
    healthDamageMultiplier,
    reactionTierReduction,
    jumpReachMultiplier,
    defense,
    barrier: defense?.id === 'rechargingBarrier' ? defense : null,
    guard: defense?.id === 'guardProjector' ? defense : null,
    hazardImmunities,
    jetSkates,
    targetScanner,
    armSwapTransitionTime,
    utilityEffects,
    equippedGearIds,
    effectIds,
  });
}

export function hasGearEffect(resolvedEffects, effectId) {
  return Boolean(resolvedEffects?.effectIds?.includes(effectId));
}

export function isHazardImmune(resolvedEffects, hazardTag, hazardDomain = 'environment') {
  if (typeof hazardTag !== 'string' || typeof hazardDomain !== 'string') return false;
  return Boolean(resolvedEffects?.hazardImmunities?.some((immunity) => (
    immunity.hazardDomain === hazardDomain && immunity.hazardTags.includes(hazardTag)
  )));
}
