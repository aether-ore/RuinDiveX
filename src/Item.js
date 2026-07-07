const ITEM_ID_PREFIX = 'part';
let nextItemId = 1;

export const RARITIES = {
  scrap: {
    label: 'Scrap',
    color: '#b8b0a2',
    glow: 0xb8b0a2,
    weight: 48,
    affixRange: [0, 1],
    statMultiplier: 0.92,
    valueMultiplier: 1,
    namePrefixes: ['Rusted', 'Patched', 'Rebuilt', 'Junker\'s'],
  },
  standard: {
    label: 'Standard',
    color: '#c9d3df',
    glow: 0xc9d3df,
    weight: 30,
    affixRange: [1, 1],
    statMultiplier: 1,
    valueMultiplier: 1.6,
    namePrefixes: ['Calibrated', 'Polished', 'Digger\'s', 'Surveyor\'s'],
  },
  tuned: {
    label: 'Tuned',
    color: '#65d5ff',
    glow: 0x65d5ff,
    weight: 14,
    affixRange: [2, 3],
    statMultiplier: 1.22,
    valueMultiplier: 3.2,
    namePrefixes: ['Tuned', 'Stabilized', 'Reinforced', 'Overclocked'],
  },
  prototype: {
    label: 'Prototype',
    color: '#c982ff',
    glow: 0xc982ff,
    weight: 6,
    affixRange: [3, 4],
    statMultiplier: 1.55,
    valueMultiplier: 7,
    namePrefixes: ['Prototype', 'Experimental', 'Military-Grade', 'Forbidden'],
  },
  ancient: {
    label: 'Ancient',
    color: '#ffcf66',
    glow: 0xffcf66,
    weight: 2,
    affixRange: [4, 5],
    statMultiplier: 1.9,
    valueMultiplier: 14,
    namePrefixes: ['Ancient', 'Refractor-Lined', 'Memory-Metal', 'Lost-Tech'],
  },
  legendary: {
    label: 'Legendary',
    color: '#ff8a3d',
    glow: 0xff8a3d,
    weight: 0.7,
    affixRange: [5, 6],
    statMultiplier: 2.25,
    valueMultiplier: 24,
    namePrefixes: ['Legendary', 'Ancient', 'Forbidden', 'Kattelox'],
  },
};

const ARM_WEAPON = 'Arm Weapon';
const BUSTER_PART = 'Buster Part';
const ARMOR = 'Armor';
const HELMET = 'Sensor Gear';
const BOOTS = 'Mobility Gear';
const MODULE = 'Utility Module';
const CORE = 'Refractor Core';
const CARTRIDGE = 'Cartridge';

export const ITEM_TYPES = {
  busterArm: {
    label: 'Buster Arm',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'projectile',
    tags: ['buster', 'projectile-arm', 'attack', 'range'],
    behavior: 'Balanced manual projectile fire.',
    baseStats: {
      attackDamage: [5, 9],
      maxEnergy: [6, 10],
      attackRange: [6.2, 7.4],
      attackSpeed: [0.08, 0.18],
    },
  },
  swordArm: {
    label: 'Laser Beam Blade',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'melee',
    tags: ['beam-blade', 'melee-arm', 'attack', 'range'],
    behavior: 'Manual horizontal energy slash with a wide beam-blade arc.',
    baseStats: {
      attackDamage: [8, 14],
      maxEnergy: [3, 6],
      attackRange: [2.1, 2.8],
      attackSpeed: [0.04, 0.14],
      areaDamage: [0.12, 0.24],
    },
  },
  drillArm: {
    label: 'Drill Arm',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'melee',
    tags: ['melee-arm', 'armor-break', 'utility'],
    behavior: 'Focused contact drill line that chews armor at very short range.',
    baseStats: {
      attackDamage: [5, 9],
      maxEnergy: [7, 12],
      attackRange: [1.45, 1.85],
      attackSpeed: [0.16, 0.32],
      armorBreakChance: [0.06, 0.14],
    },
  },
  machineGunArm: {
    label: 'Machine Gun Arm',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'projectile',
    tags: ['projectile-arm', 'rapid', 'energy'],
    behavior: 'Low Attack, high Rapid burst fire.',
    baseStats: {
      attackDamage: [2, 5],
      maxEnergy: [12, 20],
      attackRange: [5.5, 6.8],
      attackSpeed: [0.3, 0.52],
    },
  },
  cannonArm: {
    label: 'Cannon Arm',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'projectile',
    tags: ['projectile-arm', 'explosive', 'stagger'],
    behavior: 'Heavy manual shot with splash and commitment.',
    baseStats: {
      attackDamage: [12, 20],
      maxEnergy: [1, 3],
      attackRange: [5, 6.6],
      attackSpeed: [0.01, 0.08],
      areaDamage: [0.18, 0.36],
    },
  },
  mineArm: {
    label: 'Mine Layer Arm',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'projectile',
    tags: ['projectile-arm', 'explosive', 'zone-control', 'trap'],
    behavior: 'Places arming mines at the aimed ground point; right-click detonates active mines.',
    baseStats: {
      attackDamage: [10, 18],
      maxEnergy: [3, 6],
      attackRange: [4.8, 6.4],
      attackSpeed: [0.02, 0.08],
      areaDamage: [0.12, 0.28],
      armorBreakChance: [0.03, 0.08],
    },
  },
  missileArm: {
    label: 'Missile Arm',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'projectile',
    tags: ['projectile-arm', 'explosive', 'lock-on'],
    behavior: 'Lock-on missiles; full locks enable a costly right-click salvo.',
    baseStats: {
      attackDamage: [9, 16],
      maxEnergy: [3, 6],
      attackRange: [6, 8],
      attackSpeed: [0.04, 0.12],
      explodeOnKillChance: [0.04, 0.1],
    },
  },
  grenadeArm: {
    label: 'Grenade Arm',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'projectile',
    tags: ['projectile-arm', 'explosive', 'zone-control'],
    behavior: 'Arcing explosive shots that detonate on impact or landing.',
    baseStats: {
      attackDamage: [10, 17],
      maxEnergy: [2, 5],
      attackRange: [4.4, 6.2],
      attackSpeed: [0.03, 0.1],
      areaDamage: [0.16, 0.32],
    },
  },
  railBusterArm: {
    label: 'Rail Buster Arm',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'projectile',
    tags: ['projectile-arm', 'piercing', 'armor-break'],
    behavior: 'Instant piercing rail line that punches through several enemies.',
    baseStats: {
      attackDamage: [8, 14],
      maxEnergy: [3, 6],
      attackRange: [7.6, 9.5],
      attackSpeed: [0.02, 0.1],
      projectilePierce: [2, 4],
      armorBreakChance: [0.04, 0.1],
    },
  },
  scatterBusterArm: {
    label: 'Scatter Buster Arm',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'projectile',
    tags: ['projectile-arm', 'spread', 'rapid'],
    behavior: 'Close-range spread fire that rewards spacing.',
    baseStats: {
      attackDamage: [3, 7],
      maxEnergy: [6, 11],
      attackRange: [4.1, 5.6],
      attackSpeed: [0.12, 0.24],
      projectileCount: [1, 2],
    },
  },
  homingSeekerArm: {
    label: 'Homing Seeker Arm',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'projectile',
    tags: ['projectile-arm', 'lock-on', 'explosive'],
    behavior: 'Guided seeker rounds that curve toward nearby targets.',
    baseStats: {
      attackDamage: [6, 11],
      maxEnergy: [5, 9],
      attackRange: [6.5, 8.4],
      attackSpeed: [0.06, 0.16],
      lockOnSpeed: [0.08, 0.2],
    },
  },
  laserArm: {
    label: 'Shining Laser',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'projectile',
    tags: ['projectile-arm', 'beam', 'range'],
    behavior: 'Held beam ramps heat and damage; full Energy depletion vents an overheat shockwave.',
    baseStats: {
      attackDamage: [8, 13],
      maxEnergy: [4, 8],
      attackRange: [8, 10],
      attackSpeed: [0.05, 0.14],
      projectilePierce: [1, 2],
    },
  },
  flameArm: {
    label: 'Flame Arm',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'projectile',
    tags: ['projectile-arm', 'elemental', 'thermal'],
    behavior: 'Short thermal cone that scorches groups and leaves burning ground.',
    baseStats: {
      attackDamage: [4, 8],
      maxEnergy: [6, 10],
      attackRange: [3.4, 4.6],
      attackSpeed: [0.1, 0.2],
      fireDamage: [3, 8],
    },
  },
  iceSprayerArm: {
    label: 'Ice Sprayer Arm',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'projectile',
    tags: ['projectile-arm', 'elemental', 'cryo'],
    behavior: 'Chilling spray cone that slows and freezes enemies for setup.',
    baseStats: {
      attackDamage: [3, 7],
      maxEnergy: [7, 12],
      attackRange: [3.6, 5],
      attackSpeed: [0.1, 0.22],
      iceDamage: [3, 8],
    },
  },
  shockCoilArm: {
    label: 'Shock Coil Arm',
    category: ARM_WEAPON,
    slot: 'weapon',
    weaponKind: 'projectile',
    tags: ['projectile-arm', 'elemental', 'shock'],
    behavior: 'Manual chain arc that jumps between clustered mechanical targets.',
    baseStats: {
      attackDamage: [4, 8],
      maxEnergy: [6, 10],
      attackRange: [4.2, 5.8],
      attackSpeed: [0.1, 0.22],
      chainLightningChance: [0.06, 0.16],
    },
  },
  shieldArm: {
    label: 'Shield Arm',
    category: ARM_WEAPON,
    slot: 'offhand',
    weaponKind: 'defense',
    tags: ['shield-arm', 'armor', 'stagger'],
    behavior: 'Defensive arm part for timed guarding, parrying, and stagger control.',
    baseStats: {
      armor: [6, 13],
      maxHealth: [8, 18],
      staggerResistance: [0.05, 0.12],
    },
  },
  powerRaiser: {
    label: 'Power Raiser',
    category: BUSTER_PART,
    slot: 'hands',
    tags: ['buster', 'attack'],
    baseStats: {
      attackDamage: [2, 7],
    },
  },
  rangeBooster: {
    label: 'Range Booster',
    category: BUSTER_PART,
    slot: 'hands',
    tags: ['buster', 'range'],
    baseStats: {
      attackRange: [0.6, 1.8],
      projectileSpeed: [0.2, 0.5],
    },
  },
  rapidFireUnit: {
    label: 'Rapid Fire Unit',
    category: BUSTER_PART,
    slot: 'hands',
    tags: ['buster', 'rapid'],
    baseStats: {
      attackSpeed: [0.12, 0.34],
    },
  },
  energyBattery: {
    label: 'Energy Battery',
    category: BUSTER_PART,
    slot: 'hands',
    tags: ['buster', 'energy'],
    baseStats: {
      maxEnergy: [3, 8],
      energyRecharge: [0.05, 0.14],
    },
  },
  sniperScope: {
    label: 'Sniper Scope',
    category: BUSTER_PART,
    slot: 'hands',
    tags: ['buster', 'range', 'critical'],
    baseStats: {
      attackRange: [1, 2.4],
      criticalChance: [0.03, 0.08],
    },
  },
  heatSinkCore: {
    label: 'Heat Sink Core',
    category: BUSTER_PART,
    slot: 'hands',
    tags: ['buster', 'cooling', 'rapid'],
    baseStats: {
      cooldownReduction: [0.04, 0.12],
      energyRecharge: [0.06, 0.16],
    },
  },
  kevlarJacket: {
    label: 'Kevlar Jacket',
    category: ARMOR,
    slot: 'chest',
    tags: ['armor'],
    baseStats: {
      armor: [6, 13],
    },
  },
  alloyChestPlate: {
    label: 'Alloy Chest Plate',
    category: ARMOR,
    slot: 'chest',
    tags: ['armor', 'alloy'],
    baseStats: {
      armor: [9, 18],
      maxHealth: [8, 18],
    },
  },
  refractorArmor: {
    label: 'Refractor-Lined Armor',
    category: ARMOR,
    slot: 'chest',
    tags: ['armor', 'ruin-tech', 'energy'],
    baseStats: {
      armor: [8, 16],
      maxEnergy: [2, 5],
      energyRecharge: [0.03, 0.1],
    },
  },
  utilityHelmet: {
    label: 'Utility Helmet',
    category: HELMET,
    slot: 'head',
    tags: ['armor', 'utility'],
    baseStats: {
      armor: [3, 8],
      maxHealth: [4, 12],
    },
  },
  lockOnVisor: {
    label: 'Lock-On Visor',
    category: HELMET,
    slot: 'head',
    tags: ['sensor', 'lock-on', 'critical'],
    baseStats: {
      armor: [2, 6],
      lockOnSpeed: [0.08, 0.22],
      criticalChance: [0.02, 0.06],
    },
  },
  refractorScanner: {
    label: 'Refractor Scanner',
    category: HELMET,
    slot: 'head',
    tags: ['sensor', 'exploration'],
    baseStats: {
      armor: [2, 5],
      pickupRadius: [0.12, 0.35],
      eliteDetection: [0.1, 0.25],
    },
  },
  servoBoots: {
    label: 'Servo Boots',
    category: BOOTS,
    slot: 'feet',
    tags: ['mobility'],
    baseStats: {
      moveSpeed: [0.18, 0.45],
      knockbackResistance: [0.04, 0.12],
    },
  },
  jetSkates: {
    label: 'Jet Skates',
    category: BOOTS,
    slot: 'feet',
    tags: ['mobility', 'dash'],
    baseStats: {
      moveSpeed: [0.24, 0.55],
      dashRecovery: [0.06, 0.18],
    },
  },
  magneticSoles: {
    label: 'Magnetic Soles',
    category: BOOTS,
    slot: 'feet',
    tags: ['mobility', 'utility'],
    baseStats: {
      moveSpeed: [0.12, 0.32],
      pickupRadius: [0.15, 0.45],
    },
  },
  reactorChip: {
    label: 'Reactor Chip',
    category: MODULE,
    slot: 'module',
    tags: ['utility', 'energy'],
    baseStats: {
      maxEnergy: [2, 6],
      energyRecharge: [0.05, 0.15],
    },
  },
  capacitorModule: {
    label: 'Capacitor Module',
    category: MODULE,
    slot: 'module',
    tags: ['utility', 'rapid'],
    baseStats: {
      attackSpeed: [0.06, 0.18],
      maxEnergy: [1, 4],
    },
  },
  targetingChip: {
    label: 'Targeting Chip',
    category: MODULE,
    slot: 'module',
    tags: ['utility', 'critical', 'lock-on'],
    baseStats: {
      criticalChance: [0.02, 0.07],
      lockOnSpeed: [0.06, 0.18],
    },
  },
  energyCartridge: {
    label: 'Energy Cartridge',
    category: CARTRIDGE,
    slot: 'module',
    tags: ['cartridge', 'energy'],
    baseStats: {
      maxEnergy: [3, 7],
    },
  },
  refractorCore: {
    label: 'Refractor Core',
    category: CORE,
    slot: 'core',
    tags: ['ruin-tech', 'energy', 'utility'],
    baseStats: {
      maxEnergy: [3, 8],
      criticalDamage: [0.1, 0.24],
      pickupRadius: [0.1, 0.25],
    },
  },
  adapterPlug: {
    label: 'Adapter Plug',
    category: MODULE,
    slot: 'core',
    tags: ['utility', 'swap'],
    baseStats: {
      cooldownReduction: [0.04, 0.12],
      swapSpeed: [0.08, 0.22],
    },
  },
};

export const AFFIX_POOL = [
  {
    id: 'powerTuned',
    label: 'Power',
    stat: 'attackDamage',
    format: '+{value} Attack',
    range: [2, 9],
    slots: ['weapon', 'hands', 'module', 'core'],
    suffix: 'of Overdrive',
  },
  {
    id: 'energyCell',
    label: 'Energy',
    stat: 'maxEnergy',
    format: '+{value} Energy',
    range: [2, 8],
    slots: ['weapon', 'hands', 'chest', 'module', 'core'],
    integer: true,
    suffix: 'of Refractor Flow',
  },
  {
    id: 'rapidVenting',
    label: 'Rapid',
    stat: 'attackSpeed',
    format: '+{value}% Rapid',
    range: [0.08, 0.32],
    slots: ['weapon', 'hands', 'feet', 'module', 'core'],
    percent: true,
    suffix: 'of Rapid Venting',
  },
  {
    id: 'longshot',
    label: 'Range',
    stat: 'attackRange',
    format: '+{value} Range',
    range: [0.45, 1.8],
    slots: ['weapon', 'hands', 'head', 'module', 'core'],
    suffix: 'of Longshot',
  },
  {
    id: 'stableOutput',
    label: 'Stabilizer',
    stat: 'criticalChance',
    format: '+{value}% critical chance',
    range: [0.03, 0.13],
    slots: ['weapon', 'hands', 'head', 'module', 'core'],
    percent: true,
    suffix: 'of Stable Output',
  },
  {
    id: 'weakPointOptics',
    label: 'Weak-Point',
    stat: 'criticalDamage',
    format: '+{value}% weak-point damage',
    range: [0.12, 0.46],
    slots: ['weapon', 'head', 'module', 'core'],
    percent: true,
    suffix: 'of Perfect Timing',
  },
  {
    id: 'servoTuned',
    label: 'Servo',
    stat: 'moveSpeed',
    format: '+{value} movement speed',
    range: [0.15, 0.55],
    slots: ['feet', 'module', 'core'],
    suffix: 'of Repositioning',
  },
  {
    id: 'reinforcedSeal',
    label: 'Reinforced',
    stat: 'maxHealth',
    format: '+{value} max HP',
    range: [8, 35],
    slots: ['head', 'chest', 'offhand', 'feet', 'module', 'core'],
    integer: true,
    suffix: 'of Emergency Recharge',
  },
  {
    id: 'alloyPlating',
    label: 'Alloy',
    stat: 'armor',
    format: '+{value} Armor',
    range: [3, 18],
    slots: ['head', 'chest', 'hands', 'feet', 'offhand'],
    integer: true,
    suffix: 'of Impact Control',
  },
  {
    id: 'magneticCollector',
    label: 'Magnetic',
    stat: 'pickupRadius',
    format: '+{value} refractor pickup radius',
    range: [0.18, 0.75],
    slots: ['feet', 'head', 'module', 'core'],
    suffix: 'of Digger\'s Luck',
  },
  {
    id: 'burstRegulator',
    label: 'Burst',
    stat: 'projectileCount',
    format: '+{value} projectile',
    range: [1, 1],
    slots: ['weapon', 'hands', 'core'],
    integer: true,
    suffix: 'of Burst Fire',
  },
  {
    id: 'compressionBarrel',
    label: 'Piercing',
    stat: 'projectilePierce',
    format: '+{value} pierce count',
    range: [1, 2],
    slots: ['weapon', 'hands', 'module', 'core'],
    integer: true,
    suffix: 'of Armor Break',
  },
  {
    id: 'wideArcMotor',
    label: 'Wide Arc',
    stat: 'areaDamage',
    format: '+{value}% area output',
    range: [0.08, 0.28],
    slots: ['weapon', 'hands', 'module', 'core'],
    percent: true,
    suffix: 'of Wide Cleave',
  },
  {
    id: 'thermalCartridge',
    label: 'Thermal',
    stat: 'fireDamage',
    format: '+{value} thermal damage',
    range: [2, 10],
    slots: ['weapon', 'module', 'core'],
    suffix: 'of Thermal Bloom',
  },
  {
    id: 'cryoCartridge',
    label: 'Cryo',
    stat: 'iceDamage',
    format: '+{value} cryo damage',
    range: [2, 8],
    slots: ['weapon', 'module', 'core'],
    suffix: 'of Cryo Burst',
  },
  {
    id: 'recoveryTank',
    label: 'Recovery',
    stat: 'lifeSteal',
    format: '+{value}% recovery on hit',
    range: [0.02, 0.08],
    slots: ['weapon', 'chest', 'module', 'core'],
    percent: true,
    suffix: 'of Field Repair',
  },
  {
    id: 'explosivePayload',
    label: 'Explosive',
    stat: 'explodeOnKillChance',
    format: '+{value}% explosive finish chance',
    range: [0.04, 0.16],
    slots: ['weapon', 'module', 'core'],
    percent: true,
    suffix: 'of Delayed Detonation',
  },
  {
    id: 'arcCapacitor',
    label: 'Shock',
    stat: 'chainLightningChance',
    format: '+{value}% chain shock chance',
    range: [0.04, 0.14],
    slots: ['weapon', 'module', 'core'],
    percent: true,
    suffix: 'of Chain Shock',
  },
  {
    id: 'coolingFan',
    label: 'Cooling',
    stat: 'cooldownReduction',
    format: '+{value}% cooldown reduction',
    range: [0.04, 0.16],
    slots: ['weapon', 'hands', 'chest', 'feet', 'module', 'core'],
    percent: true,
    suffix: 'of Heat Control',
  },
  {
    id: 'rechargeLoop',
    label: 'Recharge',
    stat: 'energyRecharge',
    format: '+{value}% energy recharge',
    range: [0.05, 0.2],
    slots: ['weapon', 'hands', 'chest', 'module', 'core'],
    percent: true,
    suffix: 'of Emergency Recharge',
  },
  {
    id: 'lockOnCircuit',
    label: 'Lock-On',
    stat: 'lockOnSpeed',
    format: '+{value}% lock-on speed',
    range: [0.06, 0.22],
    slots: ['weapon', 'hands', 'head', 'module'],
    percent: true,
    suffix: 'of Elite Hunting',
  },
  {
    id: 'corrosiveGel',
    label: 'Corrosive',
    stat: 'corrosionDamage',
    format: '+{value} corrosion damage',
    range: [2, 8],
    slots: ['weapon', 'module', 'core'],
    suffix: 'of Corrosion',
  },
  {
    id: 'armorBreaker',
    label: 'Armor Break',
    stat: 'armorBreakChance',
    format: '+{value}% Armor Break chance',
    range: [0.05, 0.18],
    slots: ['weapon', 'hands', 'module', 'core'],
    percent: true,
    suffix: 'of Armor Break',
  },
  {
    id: 'dashRecovery',
    label: 'Dash',
    stat: 'dashRecovery',
    format: '+{value}% dash recovery',
    range: [0.06, 0.22],
    slots: ['feet', 'module', 'core'],
    percent: true,
    suffix: 'of Dash Recovery',
  },
  {
    id: 'burnResist',
    label: 'Burn-Resistant',
    stat: 'burnResistance',
    format: '+{value}% burn resistance',
    range: [0.08, 0.28],
    slots: ['head', 'chest', 'feet', 'module', 'core'],
    percent: true,
    suffix: 'of Burn Resistance',
  },
  {
    id: 'shockResist',
    label: 'Shock-Resistant',
    stat: 'shockResistance',
    format: '+{value}% shock resistance',
    range: [0.08, 0.28],
    slots: ['head', 'chest', 'feet', 'module', 'core'],
    percent: true,
    suffix: 'of Surge Control',
  },
];

export const LEGENDARY_ITEMS = [
  {
    type: 'busterArm',
    name: 'Ancient Omni Buster',
    uniqueEffect: 'First shot after a weapon swap inherits the previous arm weapon\'s element.',
    forcedAffixes: [
      { id: 'powerTuned', stat: 'attackDamage', label: 'Power', value: 9, format: '+{value} Attack' },
      { id: 'energyCell', stat: 'maxEnergy', label: 'Energy', value: 8, format: '+{value} Energy', integer: true },
      { id: 'rapidVenting', stat: 'attackSpeed', label: 'Rapid', value: 0.22, format: '+{value}% Rapid', percent: true },
    ],
  },
  {
    type: 'swordArm',
    name: 'Refractor Sword Arm',
    uniqueEffect: 'Perfectly timed swings release a short-range energy wave.',
    forcedAffixes: [
      { id: 'powerTuned', stat: 'attackDamage', label: 'Power', value: 12, format: '+{value} Attack' },
      { id: 'wideArcMotor', stat: 'areaDamage', label: 'Wide Arc', value: 0.24, format: '+{value}% area output', percent: true },
    ],
  },
  {
    type: 'drillArm',
    name: 'Kattelox Drill Arm',
    uniqueEffect: 'Sustained drilling applies Armor Break and reveals extra salvage from armored enemies.',
    forcedAffixes: [
      { id: 'armorBreaker', stat: 'armorBreakChance', label: 'Armor Break', value: 0.24, format: '+{value}% Armor Break chance', percent: true },
      { id: 'energyCell', stat: 'maxEnergy', label: 'Energy', value: 6, format: '+{value} Energy', integer: true },
    ],
  },
  {
    type: 'cannonArm',
    name: 'Bonne-Style Cannon Arm',
    uniqueEffect: 'Shells split into bomblets when they hit an elite enemy.',
    forcedAffixes: [
      { id: 'explosivePayload', stat: 'explodeOnKillChance', label: 'Explosive', value: 0.22, format: '+{value}% explosive finish chance', percent: true },
      { id: 'powerTuned', stat: 'attackDamage', label: 'Power', value: 14, format: '+{value} Attack' },
    ],
  },
  {
    type: 'laserArm',
    name: 'Shining Refractor Laser',
    uniqueEffect: 'Piercing beams deal bonus damage to enemies with broken armor.',
    forcedAffixes: [
      { id: 'compressionBarrel', stat: 'projectilePierce', label: 'Piercing', value: 3, format: '+{value} pierce count', integer: true },
      { id: 'longshot', stat: 'attackRange', label: 'Range', value: 2.2, format: '+{value} Range' },
    ],
  },
  {
    type: 'energyBattery',
    name: 'Junker\'s Auto Battery',
    uniqueEffect: 'Reloading after fully emptying Energy grants a brief Rapid boost.',
    forcedAffixes: [
      { id: 'energyCell', stat: 'maxEnergy', label: 'Energy', value: 10, format: '+{value} Energy', integer: true },
      { id: 'rechargeLoop', stat: 'energyRecharge', label: 'Recharge', value: 0.18, format: '+{value}% energy recharge', percent: true },
    ],
  },
  {
    type: 'kevlarJacket',
    name: 'Ancient Kevlar Frame',
    uniqueEffect: 'Lethal damage consumes all Energy to survive at 1 HP and trigger emergency venting.',
    forcedAffixes: [
      { id: 'alloyPlating', stat: 'armor', label: 'Alloy', value: 22, format: '+{value} Armor', integer: true },
      { id: 'reinforcedSeal', stat: 'maxHealth', label: 'Reinforced', value: 36, format: '+{value} max HP', integer: true },
    ],
  },
  {
    type: 'lockOnVisor',
    name: 'Prototype Lock-On Visor',
    uniqueEffect: 'Marked enemies take bonus damage from missiles, lasers, and sniper buster shots.',
    forcedAffixes: [
      { id: 'lockOnCircuit', stat: 'lockOnSpeed', label: 'Lock-On', value: 0.3, format: '+{value}% lock-on speed', percent: true },
      { id: 'stableOutput', stat: 'criticalChance', label: 'Stabilizer', value: 0.12, format: '+{value}% critical chance', percent: true },
    ],
  },
  {
    type: 'jetSkates',
    name: 'Jet Skates DX',
    uniqueEffect: 'Dashing after firing leaves a short energy trail that damages enemies.',
    forcedAffixes: [
      { id: 'servoTuned', stat: 'moveSpeed', label: 'Servo', value: 0.72, format: '+{value} movement speed' },
      { id: 'dashRecovery', stat: 'dashRecovery', label: 'Dash', value: 0.26, format: '+{value}% dash recovery', percent: true },
    ],
  },
  {
    type: 'flameArm',
    name: 'Thermal Bloom Flame Arm',
    uniqueEffect: 'Burning enemies explode in a small flame burst when defeated.',
    forcedAffixes: [
      { id: 'thermalCartridge', stat: 'fireDamage', label: 'Thermal', value: 12, format: '+{value} thermal damage' },
      { id: 'explosivePayload', stat: 'explodeOnKillChance', label: 'Explosive', value: 0.18, format: '+{value}% explosive finish chance', percent: true },
    ],
  },
];

export const STAT_LABELS = {
  maxHealth: 'Max HP',
  maxEnergy: 'Energy',
  energyRecharge: 'Energy Recharge',
  moveSpeed: 'Movement Speed',
  attackDamage: 'Attack',
  attackSpeed: 'Rapid',
  attackRange: 'Range',
  criticalChance: 'Critical Chance',
  criticalDamage: 'Weak-Point Damage',
  armor: 'Armor',
  pickupRadius: 'Refractor Pickup Radius',
  projectileCount: 'Projectiles',
  projectilePierce: 'Pierce Count',
  projectileSpeed: 'Projectile Speed',
  areaDamage: 'Area Output',
  fireDamage: 'Thermal Damage',
  iceDamage: 'Cryo Damage',
  lifeSteal: 'Recovery On Hit',
  explodeOnKillChance: 'Explosive Finish Chance',
  chainLightningChance: 'Chain Shock Chance',
  cooldownReduction: 'Cooldown Reduction',
  lockOnSpeed: 'Lock-On Speed',
  corrosionDamage: 'Corrosion Damage',
  armorBreakChance: 'Armor Break Chance',
  dashRecovery: 'Dash Recovery',
  swapSpeed: 'Swap Speed',
  staggerResistance: 'Stagger Resistance',
  knockbackResistance: 'Knockback Resistance',
  burnResistance: 'Burn Resistance',
  shockResistance: 'Shock Resistance',
  eliteDetection: 'Elite Detection',
};

export function formatStatValue(stat, value) {
  const percentStats = new Set([
    'attackSpeed',
    'criticalChance',
    'criticalDamage',
    'areaDamage',
    'lifeSteal',
    'explodeOnKillChance',
    'chainLightningChance',
    'cooldownReduction',
    'energyRecharge',
    'lockOnSpeed',
    'armorBreakChance',
    'dashRecovery',
    'swapSpeed',
    'staggerResistance',
    'knockbackResistance',
    'burnResistance',
    'shockResistance',
    'eliteDetection',
  ]);

  if (percentStats.has(stat)) {
    return `${Math.round(value * 100)}%`;
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(Math.abs(value) < 1 ? 2 : 1);
}

export function formatAffix(affix) {
  const rawValue = affix.percent ? Math.round(affix.value * 100) : affix.value;
  const value = affix.integer ? Math.round(rawValue) : Number(rawValue.toFixed(Math.abs(rawValue) < 2 ? 2 : 1));
  return affix.format.replace('{value}', value);
}

export class Item {
  constructor({
    id,
    name,
    type,
    slot,
    rarity,
    level,
    category,
    tags,
    behavior,
    uniqueEffect,
    baseStats = {},
    affixes = [],
    value = 0,
    weaponKind,
  }) {
    const typeData = ITEM_TYPES[type] ?? {};

    this.id = id ?? `${ITEM_ID_PREFIX}-${nextItemId++}`;
    this.type = type;
    this.typeLabel = typeData.label ?? type;
    this.category = category ?? typeData.category ?? 'Part';
    this.slot = slot ?? typeData.slot ?? 'weapon';
    this.rarity = rarity;
    this.level = level;
    this.baseStats = baseStats;
    this.affixes = affixes;
    this.value = value;
    this.tags = tags ?? [...(typeData.tags ?? [])];
    this.behavior = behavior ?? typeData.behavior ?? '';
    this.uniqueEffect = uniqueEffect ?? null;
    this.weaponKind = weaponKind ?? typeData.weaponKind ?? null;
    this.name = name ?? `${RARITIES[rarity]?.label ?? 'Unknown'} ${this.typeLabel}`;
  }

  get color() {
    return RARITIES[this.rarity]?.color ?? '#ffffff';
  }

  get glowColor() {
    return RARITIES[this.rarity]?.glow ?? 0xffffff;
  }

  getStatTotals() {
    const totals = { ...this.baseStats };

    for (const affix of this.affixes) {
      totals[affix.stat] = (totals[affix.stat] ?? 0) + affix.value;
    }

    return totals;
  }

  getPowerScore() {
    const weights = {
      maxHealth: 0.2,
      maxEnergy: 4,
      energyRecharge: 35,
      moveSpeed: 8,
      attackDamage: 2.5,
      attackSpeed: 25,
      attackRange: 1.5,
      criticalChance: 45,
      criticalDamage: 22,
      armor: 1.3,
      pickupRadius: 5,
      projectileCount: 18,
      projectilePierce: 14,
      projectileSpeed: 8,
      areaDamage: 16,
      fireDamage: 1.8,
      iceDamage: 1.5,
      lifeSteal: 55,
      explodeOnKillChance: 42,
      chainLightningChance: 40,
      cooldownReduction: 36,
      lockOnSpeed: 28,
      corrosionDamage: 1.7,
      armorBreakChance: 38,
      dashRecovery: 24,
      swapSpeed: 22,
      staggerResistance: 18,
      knockbackResistance: 16,
      burnResistance: 12,
      shockResistance: 12,
      eliteDetection: 10,
    };

    return Object.entries(this.getStatTotals()).reduce((score, [stat, value]) => {
      return score + value * (weights[stat] ?? 1);
    }, 0);
  }

  getDisplayLines() {
    const lines = [];

    for (const [stat, value] of Object.entries(this.baseStats)) {
      lines.push(`+${formatStatValue(stat, value)} ${STAT_LABELS[stat] ?? stat}`);
    }

    for (const affix of this.affixes) {
      lines.push(formatAffix(affix));
    }

    if (this.uniqueEffect) {
      lines.push(`Unique: ${this.uniqueEffect}`);
    }

    return lines;
  }
}
