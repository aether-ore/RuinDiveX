export const REAVERBOT_EYE_COLOR = 0xff254f;

export const REAVERBOT_ARCHETYPES = Object.freeze({
  pursuer: {
    id: 'pursuer',
    label: 'Pursuer',
    role: 'chaser',
    bodyPlans: ['quadruped', 'lowBiped'],
    weapons: ['ramHorn', 'crusherJaw', 'clawArm'],
    defenses: ['armoredSkull', 'sidePlates', 'reactivePlate'],
    weakPoints: ['rearBattery', 'legJoint'],
    paletteId: 'pursuerOchre',
    baseStats: { health: 22, damage: 6, speed: 3.35, armor: 4, radius: 0.58 },
    behavior: {
      preferredRange: 0.95,
      aggroRange: 18,
      telegraph: 0.48,
      commit: 0.42,
      recovery: 0.72,
      turnRate: 5.4,
    },
    threatCost: 4,
  },
  shieldSentinel: {
    id: 'shieldSentinel',
    label: 'Shield Sentinel',
    role: 'anchor',
    bodyPlans: ['biped', 'tripod'],
    weapons: ['pulseCannon', 'flameNozzle', 'beamPrism'],
    defenses: ['directionalShield', 'guardArms', 'armorShutters'],
    weakPoints: ['shieldHinge', 'eyeLens', 'rearBattery', 'coolingVents'],
    paletteId: 'sentinelBlueGray',
    baseStats: { health: 46, damage: 8, speed: 1.25, armor: 13, radius: 0.68 },
    behavior: {
      preferredRange: 4.1,
      aggroRange: 13,
      telegraph: 0.76,
      commit: 0.7,
      recovery: 1.05,
      turnRate: 1.65,
    },
    threatCost: 7,
  },
  pouncer: {
    id: 'pouncer',
    label: 'Pouncer',
    role: 'disruptor',
    bodyPlans: ['quadruped', 'hopper'],
    weapons: ['pounceActuator', 'shockPiston'],
    defenses: ['armoredBack', 'sidePlates'],
    weakPoints: ['bellyCore', 'legJoint'],
    paletteId: 'pouncerOlive',
    baseStats: { health: 29, damage: 9, speed: 2.25, armor: 7, radius: 0.62 },
    behavior: {
      preferredRange: 4.5,
      aggroRange: 16,
      telegraph: 0.92,
      commit: 0.5,
      recovery: 1.08,
      turnRate: 3.6,
    },
    threatCost: 6,
  },
  artillery: {
    id: 'artillery',
    label: 'Artillery Walker',
    role: 'artillery',
    bodyPlans: ['tripod', 'crawler'],
    weapons: ['mortarPod', 'clusterMortar', 'pulseCannon'],
    defenses: ['directionalShield', 'armoredCarapace', 'armorShutters'],
    weakPoints: ['ammoDrum', 'rearBattery', 'eyeLens'],
    paletteId: 'artilleryViolet',
    baseStats: { health: 37, damage: 8, speed: 1.4, armor: 10, radius: 0.72 },
    behavior: {
      preferredRange: 6.2,
      aggroRange: 18,
      telegraph: 0.82,
      commit: 0.35,
      recovery: 1.25,
      turnRate: 1.8,
    },
    threatCost: 7,
  },
  zoneController: {
    id: 'zoneController',
    label: 'Zone Controller',
    role: 'controller',
    bodyPlans: ['hoverBell', 'tripod'],
    weapons: ['arcEmitter', 'flameNozzle', 'mineDispenser'],
    defenses: ['rotatingPlates', 'energyMembrane', 'armorShutters', 'sidePlates'],
    weakPoints: ['emitterCore', 'coolingVents', 'eyeLens', 'counterweightCore'],
    paletteId: 'controllerTeal',
    baseStats: { health: 31, damage: 5, speed: 1.55, armor: 6, radius: 0.66 },
    behavior: {
      preferredRange: 4.8,
      aggroRange: 15,
      telegraph: 0.68,
      commit: 0.4,
      recovery: 1.15,
      turnRate: 2.2,
    },
    threatCost: 7,
  },
  tractorController: {
    id: 'tractorController',
    label: 'Tractor Controller',
    role: 'supportController',
    bodyPlans: ['hoverBell', 'flyer'],
    weapons: ['tractorMagnet'],
    defenses: ['energyMembrane', 'phaseShell', 'armorShutters'],
    weakPoints: ['emitterCore', 'eyeLens'],
    paletteId: 'tractorLavender',
    baseStats: { health: 36, damage: 6, speed: 1.85, armor: 9, radius: 0.68 },
    behavior: {
      preferredRange: 6.2,
      aggroRange: 20,
      telegraph: 0.85,
      commit: 2.7,
      recovery: 1.1,
      turnRate: 2.8,
      minimumPackSize: 2,
    },
    threatCost: 7,
  },
  rotorHunter: {
    id: 'rotorHunter',
    label: 'Rotor Hunter',
    role: 'spinner',
    bodyPlans: ['tripod', 'hoverBell'],
    weapons: ['rotorBlade'],
    defenses: ['rotatingPlates'],
    weakPoints: ['counterweightCore'],
    paletteId: 'rotorCopper',
    baseStats: { health: 34, damage: 7, speed: 2.05, armor: 8, radius: 0.7 },
    behavior: {
      preferredRange: 1.45,
      aggroRange: 16,
      telegraph: 0.72,
      commit: 0.9,
      recovery: 0.82,
      turnRate: 3.1,
    },
    threatCost: 7,
  },
  aerialBomber: {
    id: 'aerialBomber',
    label: 'Aerial Bomber',
    role: 'detonator',
    bodyPlans: ['flyer', 'hoverBell'],
    weapons: ['overloadCore'],
    defenses: ['phaseShell', 'energyMembrane'],
    weakPoints: ['eyeLens', 'overloadCore'],
    paletteId: 'bomberIvory',
    baseStats: { health: 19, damage: 14, speed: 1.55, armor: 2, radius: 0.58 },
    behavior: {
      preferredRange: 1.8,
      aggroRange: 18,
      telegraph: 1.55,
      commit: 0.12,
      recovery: 0,
      turnRate: 2.4,
    },
    threatCost: 6,
  },
  packHunter: {
    id: 'packHunter',
    label: 'Pack Hunter',
    role: 'flanker',
    bodyPlans: ['quadruped', 'lowBiped'],
    weapons: ['crusherJaw', 'ramHorn', 'clawArm'],
    defenses: ['sidePlates', 'reactivePlate'],
    weakPoints: ['legJoint', 'rearBattery'],
    paletteId: 'packSand',
    baseStats: { health: 17, damage: 5, speed: 3.05, armor: 3, radius: 0.5 },
    behavior: {
      preferredRange: 2.6,
      aggroRange: 16,
      telegraph: 0.5,
      commit: 0.38,
      recovery: 0.68,
      turnRate: 4.8,
      rearApproachDistance: 1.8,
      rearLaneOffset: 0.62,
      rearAttackDot: -0.34,
      rearPursuitSpeedScale: 1.22,
    },
    threatCost: 4,
  },
  duelist: {
    id: 'duelist',
    label: 'Ruin Duelist',
    role: 'elite',
    bodyPlans: ['biped', 'lowBiped'],
    weapons: ['clawArm', 'beamPrism', 'shockPiston'],
    defenses: ['guardArms', 'reactivePlate', 'directionalShield'],
    weakPoints: ['eyeLens', 'shieldHinge', 'rearBattery'],
    paletteId: 'duelistBurgundy',
    baseStats: { health: 43, damage: 9, speed: 2.15, armor: 9, radius: 0.62 },
    behavior: {
      preferredRange: 2.2,
      aggroRange: 15,
      telegraph: 0.62,
      commit: 0.48,
      recovery: 0.88,
      turnRate: 3.35,
    },
    threatCost: 8,
  },
});

export const REAVERBOT_BODY_PLANS = Object.freeze({
  biped: {
    id: 'biped',
    label: 'Broad Biped',
    tags: ['grounded', 'stablePose', 'forwardMount', 'armMount', 'jumpCapable'],
    height: 2.55,
    radiusScale: 1,
  },
  lowBiped: {
    id: 'lowBiped',
    label: 'Needle Biped',
    tags: ['grounded', 'forwardMount', 'armMount', 'jumpCapable', 'agile'],
    height: 2.15,
    radiusScale: 0.88,
  },
  quadruped: {
    id: 'quadruped',
    label: 'Mechanical Quadruped',
    tags: ['grounded', 'forwardMount', 'jumpCapable', 'animal', 'agile'],
    height: 1.55,
    radiusScale: 1.12,
  },
  tripod: {
    id: 'tripod',
    label: 'Tripod Idol',
    tags: ['grounded', 'stablePose', 'forwardMount', 'topMount'],
    height: 2.35,
    radiusScale: 1.12,
  },
  crawler: {
    id: 'crawler',
    label: 'Armored Crawler',
    tags: ['grounded', 'stablePose', 'forwardMount', 'topMount', 'animal'],
    height: 1.38,
    radiusScale: 1.24,
  },
  hopper: {
    id: 'hopper',
    label: 'Spring Hopper',
    tags: ['grounded', 'forwardMount', 'jumpCapable', 'agile'],
    height: 1.88,
    radiusScale: 0.94,
  },
  hoverBell: {
    id: 'hoverBell',
    label: 'Hovering Bell',
    tags: ['aerial', 'stablePose', 'forwardMount', 'topMount', 'hovering'],
    height: 1.72,
    radiusScale: 1.02,
    hoverHeight: 1.15,
  },
  flyer: {
    id: 'flyer',
    label: 'Winged Relic',
    tags: ['aerial', 'forwardMount', 'hovering', 'agile'],
    height: 1.3,
    radiusScale: 0.92,
    hoverHeight: 1.65,
  },
});

export const REAVERBOT_WEAPONS = Object.freeze({
  ramHorn: {
    id: 'ramHorn', label: 'Ram Horn', tags: ['melee', 'charge'], requires: ['forwardMount'],
    attackKind: 'charge', range: 1.15, damageScale: 1.08, meleeArmorBonus: 22, healthScale: 1.18, threatCost: 2,
  },
  crusherJaw: {
    id: 'crusherJaw', label: 'Crushing Jaw', tags: ['melee', 'bite', 'combo', 'shockwave'], requires: ['forwardMount'], bodyPlans: ['quadruped'],
    attackKind: 'jawCombo', range: 3.6, preferredRange: 3.05, damageScale: 1.12, threatCost: 3,
    comboCount: 3, strikeProgress: 0.72, strikeDamageScale: 0.78,
    shockwaveRadius: 1.9, shockwaveDamageScale: 0.72, hopDistance: 1.25, minimumHopSeparation: 0.82,
    telegraphDuration: 1.05, commitDuration: 2.1, recoveryDuration: 0.95, cooldownScale: 0.48,
    meleeArmorBonus: 28, healthScale: 1.24, moveSpeedScale: 1.18,
  },
  clawArm: {
    id: 'clawArm', label: 'Constructor Claw', tags: ['melee', 'sweep', 'combo', 'articulated', 'vault'], requiresAny: ['armMount', 'forwardMount'],
    attackKind: 'clawCombo', range: 4.55, preferredRange: 3.45, damageScale: 1.14, threatCost: 4,
    comboCount: 3, strikeProgress: 0.6, strikeDamageScale: 0.74,
    horizontalHalfAngle: 1.02, verticalHalfAngle: 0.42,
    telegraphDuration: 0.72, commitDuration: 1.38, recoveryDuration: 0.82, cooldownScale: 0.58,
    // Runtime uses the articulated reach for lane alignment and the vault
    // envelope when the heavy claw drags its chassis over low cover.
    baseReach: 2.95, extendedReach: 4.55, extensionDistance: 1.6,
    dragSpeedScale: 1.38, dragAccelerationScale: 1.5,
    vaultForwardDistance: 3.1, vaultHeight: 2.15, obstacleVaultHeight: 1.85,
    meleeArmorBonus: 30, healthScale: 1.24,
  },
  pounceActuator: {
    id: 'pounceActuator', label: 'Pounce Actuator', tags: ['melee', 'pounce'], requires: ['jumpCapable'],
    attackKind: 'pounce', range: 8.6, damageScale: 1.12, meleeArmorBonus: 20, healthScale: 1.18, threatCost: 3,
  },
  shockPiston: {
    id: 'shockPiston', label: 'Shock Piston', tags: ['melee', 'shockwave'], requires: ['jumpCapable'],
    attackKind: 'shockwave', range: 2.15, damageScale: 0.92, meleeArmorBonus: 22, healthScale: 1.18, threatCost: 3,
  },
  pulseCannon: {
    id: 'pulseCannon', label: 'Pulse Cannon', tags: ['ranged', 'direct'], requires: ['forwardMount'],
    attackKind: 'projectile', range: 7.2, damageScale: 0.95, projectileSpeed: 7.2, threatCost: 3,
  },
  mortarPod: {
    id: 'mortarPod', label: 'Mortar Pod', tags: ['ranged', 'ballistic', 'explosive'], requiresAny: ['topMount', 'stablePose'],
    attackKind: 'mortar', range: 8.4, damageScale: 1.08, projectileSpeed: 5.1, explosiveRadius: 1.25, threatCost: 4,
  },
  clusterMortar: {
    id: 'clusterMortar', label: 'Cluster Mortar', tags: ['ranged', 'ballistic', 'explosive', 'cluster'], requires: ['stablePose'],
    attackKind: 'mortar', range: 7.8, damageScale: 0.82, projectileSpeed: 4.8, explosiveRadius: 1.05, clusterCount: 4, threatCost: 5,
  },
  arcEmitter: {
    id: 'arcEmitter', label: 'Arc Emitter', tags: ['ranged', 'zone', 'electric'], requires: ['forwardMount'],
    attackKind: 'electricOrb', range: 6.4, damageScale: 0.32, projectileSpeed: 1.25, threatCost: 5,
  },
  flameNozzle: {
    id: 'flameNozzle', label: 'Flame Nozzle', tags: ['ranged', 'cone', 'fire'], requires: ['stablePose', 'forwardMount'],
    attackKind: 'flamethrower', range: 4.5, damageScale: 0.24, threatCost: 4,
  },
  beamPrism: {
    id: 'beamPrism', label: 'Beam Prism', tags: ['ranged', 'beam'], requires: ['forwardMount'],
    attackKind: 'beam', range: 8.2, damageScale: 1.16, threatCost: 5,
  },
  mineDispenser: {
    id: 'mineDispenser', label: 'Mine Dispenser', tags: ['ranged', 'zone', 'explosive'], requires: ['stablePose'],
    attackKind: 'mine', range: 5.4, damageScale: 0.78, threatCost: 4,
  },
  rotorBlade: {
    id: 'rotorBlade', label: 'Rotor Blade', tags: ['melee', 'spin', 'area'], requires: ['stablePose'],
    attackKind: 'charge', range: 1.75, damageScale: 0.72, threatCost: 4,
    meleeArmorBonus: 26, healthScale: 1.22,
    continuousContactDamage: true, contactDamageScale: 0.72, contactRadius: 1.65, contactHitInterval: 0.6,
  },
  tractorMagnet: {
    id: 'tractorMagnet', label: 'Horseshoe Tractor Magnet', tags: ['support', 'control', 'tractor', 'magnetic'], requires: ['aerial'],
    attackKind: 'tractorBeam', range: 8.5, preferredRange: 6.2, damageScale: 1, threatCost: 4,
    acquireRange: 8.5, maxCargo: 1, telegraphDuration: 0.85, commitDuration: 2.7, recoveryDuration: 1.1,
    liftDuration: 1, carryDuration: 1.25, throwDuration: 0.45,
    cargoHoverOffset: 1.35, cargoSpinRate: 2.8,
    throwLeadDistance: 1.4, throwSpeed: 8.2, throwArcHeight: 1.15, impactRadius: 1.35,
    flipWindupDuration: 0.38, zigzagSpeedScale: 5.35,
    playerCaptureRadius: 0.95, playerThrowDistance: 4.4,
    playerImpactDamageScale: 1.6, playerImpactRadius: 1.8,
  },
  overloadCore: {
    id: 'overloadCore', label: 'Overload Core', tags: ['selfDestruct', 'area'], requiresAny: ['aerial', 'hovering'],
    attackKind: 'selfDestruct', range: 2.2, damageScale: 1.55, explosiveRadius: 3, threatCost: 5,
  },
});

export const REAVERBOT_DEFENSES = Object.freeze({
  directionalShield: {
    id: 'directionalShield', label: 'Directional Shield', tags: ['directional', 'guard'], requires: ['stablePose'],
    directMultiplier: 0, flankMultiplier: 1, uptime: 0.58, threatCost: 4,
  },
  armoredSkull: {
    id: 'armoredSkull', label: 'Armored Skull', tags: ['frontArmor'],
    directMultiplier: 0.28, flankMultiplier: 1, uptime: 0.64, threatCost: 2,
  },
  sidePlates: {
    id: 'sidePlates', label: 'Side Plates', tags: ['sideArmor'],
    directMultiplier: 0.2, flankMultiplier: 1, uptime: 0.62, threatCost: 3,
  },
  armoredBack: {
    id: 'armoredBack', label: 'Armored Back', tags: ['carapace'],
    directMultiplier: 0.38, flankMultiplier: 0.7, uptime: 0.55, threatCost: 3,
  },
  armoredCarapace: {
    id: 'armoredCarapace', label: 'Armored Carapace', tags: ['carapace'], requiresAny: ['stablePose', 'animal'],
    directMultiplier: 0.36, flankMultiplier: 0.62, uptime: 0.62, threatCost: 3,
  },
  guardArms: {
    id: 'guardArms', label: 'Guard Arms', tags: ['directional', 'guard'], requires: ['armMount'],
    directMultiplier: 0.12, flankMultiplier: 1, uptime: 0.52, threatCost: 3,
  },
  armorShutters: {
    id: 'armorShutters', label: 'Armor Shutters', tags: ['shutters'], requires: ['forwardMount'],
    directMultiplier: 0.3, flankMultiplier: 0.72, uptime: 0.56, threatCost: 3,
  },
  rotatingPlates: {
    id: 'rotatingPlates', label: 'Rotating Plates', tags: ['rotating', 'guard'],
    directMultiplier: 0.08, flankMultiplier: 1, uptime: 0.62, threatCost: 4,
  },
  energyMembrane: {
    id: 'energyMembrane', label: 'Energy Membrane', tags: ['energy', 'guard'],
    directMultiplier: 0.18, flankMultiplier: 0.42, uptime: 0.46, threatCost: 4,
  },
  phaseShell: {
    id: 'phaseShell', label: 'Phase Shell', tags: ['phase', 'guard'], requiresAny: ['aerial', 'hovering'],
    directMultiplier: 0, flankMultiplier: 0, uptime: 0.5, threatCost: 4,
  },
  reactivePlate: {
    id: 'reactivePlate', label: 'Reactive Plate', tags: ['reactive'],
    directMultiplier: 0.26, flankMultiplier: 1, uptime: 0.48, threatCost: 3,
  },
});

export const REAVERBOT_WEAK_POINTS = Object.freeze({
  rearBattery: {
    id: 'rearBattery', label: 'Rear Battery', location: 'rear', multiplier: 2.25, lockable: true, exposure: 'recovery', radius: 0.24,
  },
  bellyCore: {
    id: 'bellyCore', label: 'Belly Core', location: 'belly', multiplier: 2.6, lockable: true, exposure: 'recovery', radius: 0.26,
  },
  eyeLens: {
    id: 'eyeLens', label: 'Ruby Eye', location: 'eye', multiplier: 2.1, lockable: true, exposure: 'attack', radius: 0.18,
  },
  shieldHinge: {
    id: 'shieldHinge', label: 'Shield Hinge', location: 'frontSide', multiplier: 2.35, lockable: true, exposure: 'attack', radius: 0.2,
  },
  ammoDrum: {
    id: 'ammoDrum', label: 'Ammunition Drum', location: 'rearHigh', multiplier: 2.45, lockable: true, exposure: 'recovery', radius: 0.25,
  },
  coolingVents: {
    id: 'coolingVents', label: 'Cooling Vents', location: 'side', multiplier: 2.25, lockable: true, exposure: 'recovery', radius: 0.22,
  },
  emitterCore: {
    id: 'emitterCore', label: 'Emitter Core', location: 'frontLow', multiplier: 2.4, lockable: true, exposure: 'recovery', radius: 0.24,
  },
  overloadCore: {
    id: 'overloadCore', label: 'Overload Core', location: 'center', multiplier: 3, lockable: true, exposure: 'telegraph', radius: 0.28,
  },
  legJoint: {
    id: 'legJoint', label: 'Drive Joint', location: 'leg', multiplier: 2.15, lockable: true, exposure: 'recovery', radius: 0.25,
  },
  counterweightCore: {
    id: 'counterweightCore', label: 'Counterweight Core', location: 'rotorOpposite', multiplier: 2.55, lockable: true, exposure: 'always', radius: 0.27,
  },
});

export const REAVERBOT_PALETTES = Object.freeze({
  pursuerOchre: { primary: 0x9b7a3d, secondary: 0x4a5b4b, trim: 0xd2b56a, dark: 0x242a25, emissive: 0xffa34e },
  sentinelBlueGray: { primary: 0x526f7d, secondary: 0x273f4c, trim: 0x9bb0ad, dark: 0x18252b, emissive: 0x71d8ff },
  pouncerOlive: { primary: 0x6f7d3d, secondary: 0x38452c, trim: 0xb3b86a, dark: 0x20271b, emissive: 0xffc65b },
  artilleryViolet: { primary: 0x65546e, secondary: 0x343344, trim: 0xa694a8, dark: 0x211e29, emissive: 0xc39bff },
  controllerTeal: { primary: 0x3f7771, secondary: 0x244844, trim: 0xa0b99d, dark: 0x172b2b, emissive: 0x6fffe1 },
  tractorLavender: { primary: 0x68647f, secondary: 0x343348, trim: 0xc0b5d5, dark: 0x1d1d29, emissive: 0x9fffe8 },
  rotorCopper: { primary: 0x8c6648, secondary: 0x3d4b4d, trim: 0xd1b178, dark: 0x242829, emissive: 0x67e6ff },
  bomberIvory: { primary: 0xb8aa82, secondary: 0x50483e, trim: 0xe1d5a7, dark: 0x292521, emissive: 0xff9c47 },
  packSand: { primary: 0x8e8560, secondary: 0x48523d, trim: 0xc7b988, dark: 0x292d23, emissive: 0xaeea6d },
  duelistBurgundy: { primary: 0x71434d, secondary: 0x3c2730, trim: 0xa78b84, dark: 0x24191e, emissive: 0xffa75c },
});

export const INTENT_ARCHETYPE_WEIGHTS = Object.freeze({
  basic: [
    ['pursuer', 3], ['packHunter', 3], ['duelist', 1.5], ['shieldSentinel', 1], ['pouncer', 1], ['rotorHunter', 1.2], ['tractorController', 0.8],
  ],
  fast: [
    ['pursuer', 4], ['pouncer', 3], ['packHunter', 4], ['rotorHunter', 2], ['aerialBomber', 1], ['tractorController', 0.6],
  ],
  tank: [
    ['shieldSentinel', 4], ['artillery', 2], ['duelist', 2], ['rotorHunter', 1.4], ['zoneController', 1],
  ],
  ranged: [
    ['artillery', 4], ['zoneController', 4], ['shieldSentinel', 2], ['aerialBomber', 1.5], ['tractorController', 2],
  ],
  horokko: [
    ['artillery', 4], ['zoneController', 2], ['pouncer', 1],
  ],
  gorubesshu: [
    ['shieldSentinel', 5], ['duelist', 2], ['artillery', 1],
  ],
  any: Object.keys(REAVERBOT_ARCHETYPES).map((id) => [id, 1]),
});

export const LINKED_WEAK_POINT_WEIGHTS = Object.freeze({
  directionalShield: [['rearBattery', 5], ['shieldHinge', 4], ['eyeLens', 2]],
  guardArms: [['eyeLens', 5], ['shieldHinge', 3], ['rearBattery', 2]],
  armorShutters: [['eyeLens', 8]],
  armoredBack: [['bellyCore', 8]],
  armoredCarapace: [['ammoDrum', 6], ['rearBattery', 5], ['bellyCore', 2]],
  rotatingPlates: [['counterweightCore', 10]],
  energyMembrane: [['emitterCore', 5], ['overloadCore', 5], ['eyeLens', 3]],
  phaseShell: [['eyeLens', 5], ['overloadCore', 6]],
  armoredSkull: [['rearBattery', 8]],
  sidePlates: [['legJoint', 8], ['coolingVents', 6]],
  reactivePlate: [['rearBattery', 6], ['eyeLens', 4], ['shieldHinge', 3]],
});
