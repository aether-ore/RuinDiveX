function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function armDefinition({
  id,
  label,
  runtimeType,
  weaponKind,
  role,
  combatInputs = {},
  mechanics = {},
  tags = [],
  modes = [],
  telemetry = {},
  acquisition,
  description,
}) {
  const allowedSlots = role === 'invariant'
    ? ['megaBuster']
    : role === 'utility'
      ? ['utility']
      : ['special1', 'special2'];

  return deepFreeze({
    id,
    label,
    slotKind: role === 'utility' ? 'utility' : 'special',
    runtimeType,
    profileId: runtimeType,
    weaponKind,
    role,
    allowedSlots,
    localStats: combatInputs,
    combatInputs,
    mechanics,
    resolvedTelemetry: {
      damage: telemetry.damage ?? null,
      energyCapacity: telemetry.energyCapacity ?? combatInputs.eng ?? null,
      effectiveRange: telemetry.effectiveRange ?? null,
      cadence: telemetry.cadence ?? null,
      modes: telemetry.modes ?? modes,
      resourceUse: telemetry.resourceUse
        ?? (weaponKind === 'utility' ? 'Continuous Output' : 'Arm Energy / Output'),
    },
    tags,
    acquisition,
    description,
  });
}

/**
 * Fixed arm source data.
 *
 * `combatInputs` are authored PWR / ENG / RNG / RPD inputs consumed only by
 * the arm's local resolver. Player-facing UI uses `resolvedTelemetry` (and the
 * live combat resolver) so profile multipliers and delivery mechanics are not
 * mistaken for a scalar power score.
 */
export const FIXED_ARM_CATALOG = deepFreeze({
  megaBuster: armDefinition({
    id: 'megaBuster',
    label: 'Mega Buster',
    runtimeType: 'busterArm',
    weaponKind: 'projectile',
    role: 'invariant',
    combatInputs: { pwr: 8, eng: 6, rng: 6.9, rpd: 4.2 },
    tags: ['buster', 'projectile-arm'],
    modes: ['Pulse fire', 'Mega calibrations'],
    telemetry: {
      damage: 8,
      effectiveRange: 6.9,
      cadence: 4.2,
      resourceUse: '6 Energy capacity; Mega calibrations remain arm-local',
    },
    acquisition: 'invariant',
    description: 'Balanced refractor pulse fire calibrated in the Buster Lab.',
  }),

  laserBeamBlade: armDefinition({
    id: 'laserBeamBlade',
    label: 'Laser Beam Blade',
    runtimeType: 'swordArm',
    weaponKind: 'melee',
    role: 'special',
    combatInputs: { pwr: 23, eng: 12, rng: 8.58, rpd: 1.337 },
    mechanics: { areaOutput: 0.18 },
    tags: ['beam-blade', 'melee-arm'],
    modes: ['Ground combo', 'Jump slash'],
    telemetry: {
      damage: 29.9,
      effectiveRange: 2.82,
      cadence: 1.16,
      resourceUse: '1 Energy and 56.1% Servo Output per slash',
    },
    acquisition: 'starter',
    description: 'A broad energy blade with its existing slash, combo, and aerial profiles.',
  }),

  machineGunArm: armDefinition({
    id: 'machineGunArm',
    label: 'Machine Gun Arm',
    runtimeType: 'machineGunArm',
    weaponKind: 'projectile',
    role: 'special',
    combatInputs: { pwr: 15, eng: 24, rng: 12.17, rpd: 1.648 },
    tags: ['projectile-arm', 'rapid'],
    modes: ['Sustained fire'],
    telemetry: {
      damage: 10.2,
      effectiveRange: 12.17,
      cadence: 2.94,
      resourceUse: '0.55 Energy and 3.9% Output per shot',
    },
    acquisition: 'fabrication',
    description: 'Sustained rapid pulse fire with a large energy reserve.',
  }),

  cannonArm: armDefinition({
    id: 'cannonArm',
    label: 'Cannon Arm',
    runtimeType: 'cannonArm',
    weaponKind: 'projectile',
    role: 'special',
    combatInputs: { pwr: 28, eng: 10, rng: 11.83, rpd: 1.294 },
    mechanics: { areaOutput: 0.26 },
    tags: ['projectile-arm', 'explosive', 'stagger'],
    modes: ['Heavy shell'],
    telemetry: {
      damage: 51.2,
      effectiveRange: 11.83,
      cadence: 0.78,
      resourceUse: '2 Energy and 98.3% Chamber Output per shell',
    },
    acquisition: 'fabrication',
    description: 'A committed heavy shell with strong impact and splash output.',
  }),

  grenadeArm: armDefinition({
    id: 'grenadeArm',
    label: 'Grenade Arm',
    runtimeType: 'grenadeArm',
    weaponKind: 'projectile',
    role: 'special',
    combatInputs: { pwr: 26, eng: 12, rng: 11.79, rpd: 1.319 },
    mechanics: { areaOutput: 0.25 },
    tags: ['projectile-arm', 'explosive', 'zone-control'],
    modes: ['Impact', 'Cluster'],
    telemetry: {
      damage: 38.4,
      effectiveRange: 12.59,
      cadence: 0.91,
      resourceUse: '1.75 Energy and 56.5% Throw Output per impact grenade',
    },
    acquisition: 'fabrication',
    description: 'Arcing explosives with impact and cluster firing modes.',
  }),

  missileArm: armDefinition({
    id: 'missileArm',
    label: 'Missile Arm',
    runtimeType: 'missileArm',
    weaponKind: 'projectile',
    role: 'special',
    combatInputs: { pwr: 25, eng: 13, rng: 13.59, rpd: 1.334 },
    tags: ['projectile-arm', 'explosive', 'lock-on'],
    modes: ['Guided shot', 'Full-lock salvo'],
    telemetry: {
      damage: 30.5,
      effectiveRange: 15.39,
      cadence: 1.04,
      resourceUse: '1.5 Energy and 36.8% Lock Stability per missile',
    },
    acquisition: 'fabrication',
    description: 'Guided missiles with a full-lock salvo option.',
  }),

  shiningLaser: armDefinition({
    id: 'shiningLaser',
    label: 'Shining Laser',
    runtimeType: 'laserArm',
    weaponKind: 'projectile',
    role: 'special',
    combatInputs: { pwr: 23, eng: 14, rng: 15.7, rpd: 1.35 },
    tags: ['projectile-arm', 'beam', 'range'],
    modes: ['Held beam', 'Overload pulse'],
    telemetry: {
      damage: '11-29.3 per tick',
      effectiveRange: 19.2,
      cadence: '10 ticks/s',
      resourceUse: '3.8 Energy/s and 107.8% Beam Stability/s',
    },
    acquisition: 'fabrication',
    description: 'A held beam that builds heat and vents an overload pulse.',
  }),

  liftArm: armDefinition({
    id: 'liftArm',
    label: 'Lift Arm',
    runtimeType: 'liftArm',
    weaponKind: 'utility',
    role: 'utility',
    combatInputs: { rng: 1.55 },
    mechanics: { outputEfficiency: 1.029 },
    tags: ['utility-arm', 'lift'],
    modes: ['Continuous lift'],
    telemetry: {
      damage: 'Utility',
      effectiveRange: 1.55,
      cadence: 'Continuous',
      resourceUse: 'Junk free; holding enemies drains 46.6% Lift Output/s',
    },
    acquisition: 'starter',
    description: 'Lifts ruin objects, salvage, and small Reaverbots.',
  }),

  drillArm: armDefinition({
    id: 'drillArm',
    label: 'Drill Arm',
    runtimeType: 'drillArm',
    weaponKind: 'melee',
    role: 'utility',
    combatInputs: { pwr: 19 },
    mechanics: {
      contactRange: 1.05,
      launchRange: 7.04,
      outputEfficiency: 1.097,
      armorBreak: 0.39,
    },
    tags: ['utility-arm', 'melee-arm', 'armor-break'],
    modes: ['Contact drill', 'Launched drill'],
    telemetry: {
      damage: '1 per contact tick / 1.6 launch',
      effectiveRange: '1.05 contact / 7.04 launch',
      cadence: '8.33 ticks/s / 2 launches/s',
      resourceUse: '104.8% Torque Output/s contact; 65.6% per launch',
    },
    acquisition: 'fabrication',
    description: 'A contact drill for machinery, armor, and a launched utility strike.',
  }),
});

export const ARM_CATALOG = FIXED_ARM_CATALOG;
export const FIXED_ARM_LIST = Object.freeze(Object.values(FIXED_ARM_CATALOG));
export const ARM_LIST = FIXED_ARM_LIST;
export const FIXED_ARM_IDS = Object.freeze(FIXED_ARM_LIST.map((arm) => arm.id));

export function getFixedArmDefinition(armId) {
  return typeof armId === 'string' ? FIXED_ARM_CATALOG[armId] ?? null : null;
}

export const getArmDefinition = getFixedArmDefinition;

export function isFixedArmId(armId) {
  return getFixedArmDefinition(armId) !== null;
}

export function canEquipFixedArmInSlot(armId, slot) {
  return Boolean(getFixedArmDefinition(armId)?.allowedSlots.includes(slot));
}

function toLegacyLocalStats(definition) {
  const { combatInputs, mechanics } = definition;
  const stats = {};
  if (Number.isFinite(combatInputs.pwr)) stats.attackDamage = combatInputs.pwr;
  if (Number.isFinite(combatInputs.eng)) stats.maxEnergy = combatInputs.eng;
  if (Number.isFinite(combatInputs.rng)) stats.attackRange = combatInputs.rng;
  if (Number.isFinite(combatInputs.rpd)) stats.attackSpeed = combatInputs.rpd;
  if (Number.isFinite(mechanics.areaOutput)) stats.areaDamage = mechanics.areaOutput;
  if (Number.isFinite(mechanics.armorBreak)) stats.armorBreakChance = mechanics.armorBreak;
  return Object.freeze(stats);
}

/**
 * Produces the narrow Item-compatible bridge used while combat still selects
 * behavior from legacy runtime type IDs. It deliberately has no rarity,
 * level, affixes, random seed, value, or power-score API.
 */
export function createFixedArmDescriptor(armId) {
  const definition = getFixedArmDefinition(armId);
  if (!definition) return null;

  const combatStats = definition.combatInputs;
  const localStats = toLegacyLocalStats(definition);
  return Object.freeze({
    id: definition.id,
    fixedArmId: definition.id,
    type: definition.runtimeType,
    runtimeType: definition.runtimeType,
    profileId: definition.profileId,
    name: definition.label,
    typeLabel: definition.label,
    slot: 'weapon',
    category: 'Arm Weapon',
    weaponKind: definition.weaponKind,
    tags: definition.tags,
    fixed: true,
    combatStats,
    localStats,
    mechanics: definition.mechanics,
    resolvedTelemetry: definition.resolvedTelemetry,
    getStatTotals: () => ({ ...localStats }),
  });
}
