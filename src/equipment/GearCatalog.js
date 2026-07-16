function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export const GEAR_SLOTS = Object.freeze([
  'armor',
  'helmet',
  'mobility',
  'defense',
  'utility1',
  'utility2',
]);

export const GEAR_SLOT_CATALOG = deepFreeze({
  armor: {
    id: 'armor',
    label: 'Armor Frame',
    domain: 'health-damage-mitigation',
    catalogSlot: 'armor',
  },
  helmet: {
    id: 'helmet',
    label: 'Helmet',
    domain: 'reaction-resistance',
    catalogSlot: 'helmet',
  },
  mobility: {
    id: 'mobility',
    label: 'Mobility Gear',
    domain: 'jump-and-airborne-traversal',
    catalogSlot: 'mobility',
  },
  defense: {
    id: 'defense',
    label: 'Defense Gear',
    domain: 'special-defense',
    catalogSlot: 'defense',
  },
  utility1: {
    id: 'utility1',
    label: 'Utility Module 1',
    domain: 'rule-changing-utility',
    catalogSlot: 'utility',
  },
  utility2: {
    id: 'utility2',
    label: 'Utility Module 2',
    domain: 'rule-changing-utility',
    catalogSlot: 'utility',
  },
});

function gearDefinition({
  id,
  label,
  slot,
  effect,
  description,
  acquisition,
  unlockRequirement = null,
  exclusiveGroup = null,
}) {
  const allowedSlots = slot === 'utility' ? ['utility1', 'utility2'] : [slot];
  return deepFreeze({
    id,
    label,
    slot,
    allowedSlots,
    effect,
    description,
    acquisition,
    unlockRequirement,
    exclusiveGroup,
  });
}

/**
 * Authored fixed-function gear. These records intentionally contain no level,
 * rarity, affixes, random rolls, generic stat bag, value, or power score.
 */
export const GEAR_CATALOG = deepFreeze({
  reinforcedArmorFrame: gearDefinition({
    id: 'reinforcedArmorFrame',
    label: 'Reinforced Armor Frame',
    slot: 'armor',
    effect: { id: 'healthDamageMultiplier', multiplier: 0.82 },
    description: 'Health damage received: -18%.',
    acquisition: 'starter',
  }),

  gyroStabilizerHelmet: gearDefinition({
    id: 'gyroStabilizerHelmet',
    label: 'Gyro Stabilizer Helmet',
    slot: 'helmet',
    effect: { id: 'reactionTierReduction', tiers: 1 },
    description: 'Downgrades incoming reaction tier by one.',
    acquisition: 'starter',
  }),

  jumpSprings: gearDefinition({
    id: 'jumpSprings',
    label: 'Jump Springs',
    slot: 'mobility',
    effect: { id: 'jumpReachMultiplier', multiplier: 1.3 },
    description: 'Vertical jump reach: +30%.',
    acquisition: 'fabrication',
  }),

  barrierGenerator: gearDefinition({
    id: 'barrierGenerator',
    label: 'Barrier Generator',
    slot: 'defense',
    unlockRequirement: 'defenseGearUnlocked',
    effect: {
      id: 'rechargingBarrier',
      capacity: 40,
      rechargeDelay: 4.5,
      brokenDelay: 6,
      rechargePerSecond: 10,
    },
    description: 'A 40-point barrier recharges after damage and restores 10 points per second.',
    acquisition: 'story-milestone',
  }),

  guardProjector: gearDefinition({
    id: 'guardProjector',
    label: 'Guard Projector',
    slot: 'defense',
    unlockRequirement: 'defenseGearUnlocked',
    effect: {
      id: 'guardProjector',
      duration: 0.7,
      parryWindow: 0.18,
      cooldown: 0.82,
      guardReduction: 0.6,
      parryReduction: 0.9,
    },
    description: 'Projects a 0.70-second frontal guard with a 0.18-second perfect-parry opening.',
    acquisition: 'fabrication',
  }),

  heatResistChip: gearDefinition({
    id: 'heatResistChip',
    label: 'Heat Resist Chip',
    slot: 'utility',
    effect: {
      id: 'hazardImmunity',
      hazardDomain: 'environment',
      hazardTags: ['environmentalHeat', 'fireFloor', 'furnaceVent'],
    },
    description: 'Ignores damage and burn from tagged environmental heat hazards.',
    acquisition: 'fabrication',
  }),

  jetSkates: gearDefinition({
    id: 'jetSkates',
    label: 'Jet Skates',
    slot: 'utility',
    exclusiveGroup: 'locomotion-mode',
    effect: {
      id: 'jetSkates',
      windup: 0.35,
      acceleration: 20,
      maxSpeed: 18,
      ledgeVerticalImpulse: 2.8,
    },
    description: 'Hold Sprint on the ground to build to an 18-speed motorized boost and ledge leap.',
    acquisition: 'fabrication',
  }),

  targetScanner: gearDefinition({
    id: 'targetScanner',
    label: 'Target Scanner',
    slot: 'utility',
    effect: {
      id: 'targetScanner',
      range: 18,
      lineOfSight: true,
      targetKinds: ['exposedWeakpoint', 'intactBreakableModule'],
    },
    description: 'Reveals visible exposed weak points and intact breakable modules within 18 meters.',
    acquisition: 'fabrication',
  }),

  fastSwapAdapter: gearDefinition({
    id: 'fastSwapAdapter',
    label: 'Fast-Swap Adapter',
    slot: 'utility',
    effect: {
      id: 'armSwapTransition',
      transitionTime: 0.14,
      baseTransitionTime: 0.34,
    },
    description: 'Sets arm-swap transition time to 0.14 seconds.',
    acquisition: 'fabrication',
  }),
});

export const GEAR_LIST = Object.freeze(Object.values(GEAR_CATALOG));
export const GEAR_IDS = Object.freeze(GEAR_LIST.map((gear) => gear.id));

export function getGearDefinition(gearId) {
  return typeof gearId === 'string' ? GEAR_CATALOG[gearId] ?? null : null;
}

export function getGearSlotDefinition(slot) {
  return typeof slot === 'string' ? GEAR_SLOT_CATALOG[slot] ?? null : null;
}

export function canEquipGearInSlot(gearId, slot) {
  return Boolean(getGearDefinition(gearId)?.allowedSlots.includes(slot));
}
