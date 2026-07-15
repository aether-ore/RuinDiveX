import {
  INTENT_ARCHETYPE_WEIGHTS,
  LINKED_WEAK_POINT_WEIGHTS,
  REAVERBOT_ARCHETYPES,
  REAVERBOT_BODY_PLANS,
  REAVERBOT_CHARGE_MODULES,
  REAVERBOT_DEFENSES,
  REAVERBOT_EYE_COLOR,
  REAVERBOT_PALETTES,
  REAVERBOT_WEAK_POINTS,
  REAVERBOT_WEAPONS,
} from './ReaverbotCatalog.js';
import { hashSeed, SeededRandom } from './SeededRandom.js';

const SCHEMA_VERSION = 3;
const CANDIDATE_COUNT = 8;
const GLOBAL_REAVERBOT_MOVE_SPEED_SCALE = 1.22;
const NAME_PREFIXES = ['AR', 'BA', 'DA', 'GA', 'KA', 'KO', 'MU', 'NA', 'OM', 'RA', 'SA', 'TO', 'UR', 'VA', 'ZA'];
const NAME_SUFFIXES = ['EN', 'GAR', 'KIR', 'MOL', 'ORA', 'RAK', 'TUM', 'VAN', 'XEL', 'ZUN'];
const SPRING_MOBILITY_IDS = new Set(['springQuadruped', 'pairedSprings', 'monoPogo', 'launchLeg']);
const CRAWLER_MOBILITY_IDS = new Set(['articulatedCrawler', 'wheelBogies']);
const WEAPON_WEAK_POINT_WEIGHTS = Object.freeze({
  rocketLance: [['legJoint', 4], ['rearBattery', 3]],
  crusherJaw: [['rearBattery', 3], ['legJoint', 3], ['eyeLens', 1]],
  clawArm: [['clawPalm', 10]],
  pounceActuator: [['bellyCore', 7], ['legJoint', 2]],
  launchLeg: [['legJoint', 10]],
  shockPiston: [['bellyCore', 4], ['legJoint', 3]],
  pulseCannon: [['ammoDrum', 3], ['eyeLens', 2], ['rearBattery', 2]],
  mortarPod: [['ammoDrum', 7], ['rearBattery', 2]],
  clusterMortar: [['ammoDrum', 8], ['rearBattery', 2]],
  arcEmitter: [['emitterCore', 6], ['eyeLens', 2]],
  flameNozzle: [['coolingVents', 7], ['rearBattery', 2]],
  beamPrism: [['eyeLens', 4], ['emitterCore', 3]],
  mineDispenser: [['ammoDrum', 4], ['rearBattery', 3]],
  rotorBlade: [['counterweightCore', 10]],
  tractorMagnet: [['emitterCore', 8], ['eyeLens', 3]],
  overloadCore: [['overloadCore', 8], ['eyeLens', 4]],
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hasBodyRequirements(module, body) {
  const tags = new Set(body.tags ?? []);
  const required = module.requires ?? [];
  const requiredAny = module.requiresAny ?? [];
  const bodyPlans = module.bodyPlans ?? [];
  return required.every((tag) => tags.has(tag))
    && (requiredAny.length === 0 || requiredAny.some((tag) => tags.has(tag)))
    && (bodyPlans.length === 0 || bodyPlans.includes(body.id));
}

function getContextText(context) {
  return [
    context.biome,
    context.roomArchetypeId,
    context.roomFlavorId,
    ...(context.favoredTags ?? []),
    ...(context.behaviorModifiers ?? []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function getArchetypeWeights(intent, context) {
  const base = INTENT_ARCHETYPE_WEIGHTS[intent] ?? INTENT_ARCHETYPE_WEIGHTS.any;
  const weights = new Map(base.map(([id, weight]) => [id, weight]));
  const text = getContextText(context);
  const boost = (ids, multiplier) => {
    for (const id of ids) {
      if (weights.has(id)) {
        weights.set(id, weights.get(id) * multiplier);
      }
    }
  };

  if (/nest|swarm|crawler|pack/.test(text)) boost(['packHunter', 'pursuer'], 2.2);
  if (/server|sensor|turret|security/.test(text)) boost(['shieldSentinel', 'zoneController', 'tractorController', 'artillery'], 1.8);
  if (/machine|factory|assembly|heavy/.test(text)) boost(['artillery', 'shieldSentinel', 'duelist'], 1.65);
  if (/rolling|wheel|conveyor/.test(text)) boost(['artillery'], 2.1);
  if (/coolant|fluid|cryo|electric|energy/.test(text)) boost(['zoneController', 'aerialBomber', 'tractorController'], 1.9);
  if (/trap|ambush|hunting|aggressive/.test(text)) boost(['pouncer', 'pursuer'], 1.8);
  if (/flying|aerial|hover/.test(text)) boost(['aerialBomber', 'zoneController', 'tractorController'], 2.4);
  if (context.isBoss) boost(['duelist', 'shieldSentinel', 'artillery'], 2.6);

  const suppressed = (context.suppressedTags ?? []).join(' ').toLowerCase();
  if (/turret|sensor|security/.test(suppressed)) boost(['artillery', 'shieldSentinel'], 0.48);
  if (/crawler|swarm|wild/.test(suppressed)) boost(['packHunter', 'pursuer', 'pouncer'], 0.48);
  if (/flying|aerial|hover/.test(suppressed)) boost(['aerialBomber', 'zoneController', 'tractorController'], 0.42);
  if (/large|heavy|guardian/.test(suppressed)) boost(['shieldSentinel', 'artillery', 'duelist'], 0.55);

  if ((context.encounterSize ?? 1) < 2) {
    weights.delete('tractorController');
  }
  if (context.isBoss || context.keycardCarrier) {
    weights.delete('aerialBomber');
    weights.delete('tractorController');
  }
  for (const id of context.excludedArchetypes ?? []) {
    weights.delete(id);
  }

  return [...weights.entries()].map(([value, weight]) => ({ value, weight }));
}

function pickArchetype(rng, context) {
  if (context.archetypeId && REAVERBOT_ARCHETYPES[context.archetypeId]) {
    return REAVERBOT_ARCHETYPES[context.archetypeId];
  }

  const id = rng.weighted(getArchetypeWeights(context.intent ?? 'any', context), 'pursuer');
  return REAVERBOT_ARCHETYPES[id] ?? REAVERBOT_ARCHETYPES.pursuer;
}

function pickBodyPlan(rng, archetype, context = {}) {
  if (context.bodyPlanId) {
    const forced = REAVERBOT_BODY_PLANS[context.bodyPlanId];
    if (forced && archetype.bodyPlans.includes(forced.id)) return forced;
  }
  const compatible = archetype.bodyPlans
    .map((id) => REAVERBOT_BODY_PLANS[id])
    .filter(Boolean);
  return rng.pick(compatible) ?? REAVERBOT_BODY_PLANS.biped;
}

function createMobilityVariant(rng, archetype, body, context = {}, weapon = null) {
  if (archetype.id !== 'pouncer' && body.id === 'crawler') {
    const contextText = getContextText(context);
    const suppressedText = (context.suppressedTags ?? []).join(' ').toLowerCase();
    const wheelChance = /rolling|wheel/.test(suppressedText)
      ? 0
      : /rolling|wheel|conveyor/.test(contextText)
        ? 0.78
        : 0.46;
    const wheeled = rng.chance(wheelChance);
    return {
      id: wheeled ? 'wheelBogies' : 'articulatedCrawler',
      label: wheeled ? 'Four-Wheel Bogy Drive' : 'Six-Leg Crawler Linkage',
      movementModel: wheeled ? 'wheelDrive' : 'groundStep',
      legCount: wheeled ? 0 : 6,
      wheelCount: wheeled ? 4 : 0,
      salvageModuleId: wheeled ? 'wheelBogies' : 'articulatedCrawler',
      moveSpeedScale: wheeled ? 1.18 : 1,
      turnRateScale: wheeled ? 0.84 : 1,
      tags: wheeled
        ? ['wheeled', 'rolling', 'traction', 'wheelDrive', 'lowProfile']
        : ['articulated', 'sixLegged', 'terrainGrip'],
    };
  }

  if (archetype.id !== 'pouncer') {
    return {
      id: 'standard',
      label: body.label,
      movementModel: body.tags.includes('aerial') ? 'flight' : 'groundStep',
      legCount: null,
      wheelCount: 0,
      salvageModuleId: body.id,
      moveSpeedScale: 1,
      turnRateScale: 1,
      tags: [],
    };
  }

  if (weapon?.id === 'launchLeg') {
    return {
      id: 'launchLeg',
      label: 'Launch Leg',
      movementModel: 'springBounce',
      legCount: 1,
      wheelCount: 0,
      salvageModuleId: 'hopper',
      moveSpeedScale: 0.9,
      turnRateScale: 0.82,
      tags: ['springLoaded', 'bouncing', 'singleLegged', 'rocketAssisted', 'massiveArticulatedLeg'],
    };
  }

  if (body.id === 'quadruped') {
    return {
      id: 'springQuadruped',
      label: 'Spring-Loaded Quadruped',
      movementModel: 'springBounce',
      legCount: 4,
      wheelCount: 0,
      salvageModuleId: 'hopper',
      moveSpeedScale: 1,
      turnRateScale: 1,
      tags: ['springLoaded', 'bouncing'],
    };
  }

  const monoPogo = rng.chance(0.4);
  return {
    id: monoPogo ? 'monoPogo' : 'pairedSprings',
    label: monoPogo ? 'Mono-Pogo Chassis' : 'Paired Spring Legs',
    movementModel: 'springBounce',
    legCount: monoPogo ? 1 : 2,
    wheelCount: 0,
    salvageModuleId: 'hopper',
    moveSpeedScale: 1,
    turnRateScale: 1,
    tags: ['springLoaded', 'bouncing', ...(monoPogo ? ['singleLegged'] : [])],
  };
}

function pickWeapon(rng, archetype, body, context = {}) {
  if (context.weaponId) {
    const forced = REAVERBOT_WEAPONS[context.weaponId];
    if (forced && archetype.weapons.includes(forced.id) && hasBodyRequirements(forced, body)) {
      return forced;
    }
  }
  const compatible = archetype.weapons
    .map((id) => REAVERBOT_WEAPONS[id])
    .filter((weapon) => weapon && hasBodyRequirements(weapon, body));
  return rng.pick(compatible) ?? REAVERBOT_WEAPONS.pulseCannon;
}

function createWeaponVariant(weapon, rng, archetype, context = {}) {
  // The Overload Reliquary advertises and vents the same volatile core used by
  // ordinary bombers, but its authored encounter controller owns detonation.
  // Marking the generated payload here prevents the ordinary self-destruct
  // behavior from becoming the boss's terminal attack.
  if (weapon.id === 'overloadCore' && context.bossSafeOverload) {
    return {
      ...weapon,
      attackKind: 'bossOverload',
      bossSafe: true,
      tags: [...weapon.tags.filter((tag) => tag !== 'selfDestruct'), 'bossOverload'],
    };
  }
  if (archetype.id === 'pouncer') {
    const integratedMobility = {
      mountRole: 'locomotion',
      integratedIntoMobility: true,
    };
    if (weapon.id === 'shockPiston') {
      return {
        ...weapon,
        ...integratedMobility,
        tags: [...new Set([...weapon.tags, 'pounce', 'landingShockwave'])],
        attackKind: 'pounce',
        range: 8.6,
        preferredRange: 4.5,
        damageScale: 1.08,
        landingRadius: 2.35,
        landingDamageScale: 1.08,
      };
    }
    if (weapon.id === 'pounceActuator') {
      return {
        ...weapon,
        ...integratedMobility,
        tags: [...weapon.tags],
      };
    }
    if (weapon.id === 'launchLeg') {
      return {
        ...weapon,
        ...integratedMobility,
        mountSide: rng.chance(0.5) ? -1 : 1,
        tags: [...weapon.tags],
      };
    }
  }
  if (weapon.id === 'clawArm') {
    return {
      ...weapon,
      mountSide: rng.chance(0.5) ? -1 : 1,
    };
  }
  if (weapon.id === 'crusherJaw') {
    return {
      ...weapon,
      jawVariant: rng.chance(0.5) ? 'canineFangCage' : 'crusherTrap',
    };
  }
  return weapon;
}

function createChargeModule(body, weapon, rng) {
  if (weapon.attackKind !== 'charge') return null;
  const definition = body.tags.includes('aerial')
    ? REAVERBOT_CHARGE_MODULES.vectorRocket
    : body.id === 'quadruped' || body.id === 'crawler'
      ? REAVERBOT_CHARGE_MODULES.spineJet
      : REAVERBOT_CHARGE_MODULES.twinRocketPack;
  return {
    ...definition,
    thrustScale: Number(rng.float(0.94, 1.16).toFixed(3)),
  };
}

function pickDefense(rng, archetype, body, context = {}) {
  if (context.defenseId) {
    const forced = REAVERBOT_DEFENSES[context.defenseId];
    if (forced && archetype.defenses.includes(forced.id) && hasBodyRequirements(forced, body)) {
      return forced;
    }
  }
  const compatible = archetype.defenses
    .map((id) => REAVERBOT_DEFENSES[id])
    .filter((defense) => defense
      && hasBodyRequirements(defense, body)
      && (LINKED_WEAK_POINT_WEIGHTS[defense.id] ?? [])
        .some(([weakPointId]) => archetype.weakPoints.includes(weakPointId)));
  return rng.pick(compatible) ?? compatible[0] ?? REAVERBOT_DEFENSES.reactivePlate;
}

function mergeWeightedWeakPoints(archetype, defense, weapon) {
  const allowed = new Set(archetype.weakPoints);
  const combined = new Map();

  for (const [id, weight] of LINKED_WEAK_POINT_WEIGHTS[defense?.id] ?? []) {
    if (allowed.has(id)) combined.set(id, weight);
  }
  for (const [id, weight] of WEAPON_WEAK_POINT_WEIGHTS[weapon.id] ?? []) {
    if (combined.has(id)) combined.set(id, combined.get(id) + weight);
  }

  return [...combined.entries()].map(([value, weight]) => ({ value, weight }));
}

function pickWeakPoint(rng, archetype, defense, weapon, context = {}) {
  if (context.weakPointId) {
    const forced = REAVERBOT_WEAK_POINTS[context.weakPointId];
    if (forced && archetype.weakPoints.includes(forced.id)) return forced;
  }
  if (weapon.id === 'clawArm') return REAVERBOT_WEAK_POINTS.clawPalm;
  if (weapon.id === 'launchLeg') return REAVERBOT_WEAK_POINTS.legJoint;
  const options = mergeWeightedWeakPoints(archetype, defense, weapon);
  const id = rng.weighted(options, options[0]?.value ?? archetype.weakPoints[0]);
  return REAVERBOT_WEAK_POINTS[id] ?? REAVERBOT_WEAK_POINTS.eyeLens;
}

function createName(rng, archetype, threatTier) {
  const prefix = rng.pick(NAME_PREFIXES);
  const suffix = rng.pick(NAME_SUFFIXES);
  const serial = rng.int(1, 9 + threatTier * 7).toString().padStart(2, '0');
  return `${prefix}-${suffix} ${serial} · ${archetype.label}`;
}

function createProportions(rng, body) {
  const agile = body.tags.includes('agile');
  const stable = body.tags.includes('stablePose');
  return {
    overallScale: Number(rng.float(0.88, 1.12).toFixed(4)),
    torsoWidth: Number(rng.float(stable ? 1.02 : 0.82, stable ? 1.28 : 1.12).toFixed(4)),
    torsoLength: Number(rng.float(0.86, body.tags.includes('animal') ? 1.28 : 1.12).toFixed(4)),
    limbLength: Number(rng.float(agile ? 1 : 0.86, agile ? 1.24 : 1.1).toFixed(4)),
    headScale: Number(rng.float(0.84, 1.16).toFixed(4)),
    spikeCount: rng.int(1, 4),
    panelRhythm: rng.int(2, 5),
    asymmetry: Number(rng.float(0.04, 0.2).toFixed(4)),
  };
}

function createStats(archetype, body, mobility, weapon, threatTier, proportions, context) {
  const tier = clamp(Math.trunc(threatTier) || 1, 1, 8);
  const tierHealth = 1 + (tier - 1) * 0.2;
  const tierDamage = 1 + (tier - 1) * 0.105;
  const roomHealth = clamp(context.healthMultiplier ?? 1, 0.72, 1.6);
  const bodyScale = body.radiusScale * proportions.overallScale * (weapon.radiusScale ?? 1);
  const base = archetype.baseStats;
  const attackRange = weapon.range ?? archetype.behavior.preferredRange;
  const melee = weapon.tags.includes('melee');
  const healthScale = weapon.healthScale ?? (melee ? 1.15 : 1);
  const moveSpeedScale = weapon.moveSpeedScale ?? 1;
  const meleeArmorBonus = melee ? (weapon.meleeArmorBonus ?? 20) : 0;
  const telegraphDuration = weapon.telegraphDuration ?? archetype.behavior.telegraph;
  const commitDuration = weapon.commitDuration ?? archetype.behavior.commit;
  const recoveryDuration = weapon.recoveryDuration ?? archetype.behavior.recovery;

  return {
    maxHealth: Number((base.health * tierHealth * roomHealth * 1.12 * healthScale).toFixed(3)),
    damage: Number((base.damage * tierDamage * (weapon.damageScale ?? 1) * 1.1).toFixed(3)),
    moveSpeed: Number((
      base.speed
      * GLOBAL_REAVERBOT_MOVE_SPEED_SCALE
      * moveSpeedScale
      * (mobility.moveSpeedScale ?? 1)
      * (1 + Math.min(0.16, (tier - 1) * 0.025))
    ).toFixed(3)),
    attackRange: Number(attackRange.toFixed(3)),
    attackCooldown: Number(clamp(
      (telegraphDuration + commitDuration + recoveryDuration)
        * 0.9
        * (weapon.cooldownScale ?? 1)
        * (archetype.behavior.attackCooldownScale ?? 1),
      archetype.behavior.attackCooldownFloor ?? 0.75,
      3.25,
    ).toFixed(3)),
    armor: Number(((base.armor + meleeArmorBonus) * (1 + (tier - 1) * 0.12)).toFixed(3)),
    experience: Math.round((4 + archetype.threatCost * 1.4) * (1 + (tier - 1) * 0.22)),
    radius: Number((base.radius * bodyScale).toFixed(3)),
    collisionHeight: Number((
      body.height
      * proportions.overallScale
      * (weapon.collisionHeightScale ?? 1)
      + (body.hoverHeight ?? 0)
    ).toFixed(3)),
  };
}

function createBehavior(archetype, mobility, weapon, weakPoint, rng) {
  const base = archetype.behavior;
  const attackKind = weapon.attackKind;
  const telegraphDuration = weapon.telegraphDuration ?? base.telegraph;
  const commitDuration = weapon.commitDuration ?? base.commit;
  const recoveryDuration = weapon.recoveryDuration ?? base.recovery;
  // Close-range Reaverbots should remain a threat across a whole combat space,
  // with rush attacks acquiring from farther away than ordinary melee attacks.
  const aggroRange = attackKind === 'charge'
    ? Math.max(base.aggroRange, 26)
    : attackKind === 'pounce'
      ? Math.max(base.aggroRange, 24)
      : weapon.tags.includes('melee')
        ? Math.max(base.aggroRange, 22)
        : base.aggroRange;
  const exposureDuration = weakPoint.exposure === 'always'
    ? 99
    : weakPoint.exposure === 'telegraph'
      ? Math.max(0.65, telegraphDuration)
      : weakPoint.exposure === 'attack'
        ? Math.max(0.65, telegraphDuration + commitDuration * 0.45)
        : Math.max(0.7, recoveryDuration * 0.78);

  return {
    id: archetype.id,
    role: archetype.role,
    preferredRange: weapon.preferredRange
      ?? (weapon.tags.includes('ranged') ? Math.max(base.preferredRange, weapon.range * 0.66) : base.preferredRange),
    aggroRange,
    telegraphDuration,
    commitDuration,
    recoveryDuration,
    exposureDuration: Number(exposureDuration.toFixed(3)),
    turnRate: Number((base.turnRate * (mobility.turnRateScale ?? 1)).toFixed(3)),
    orbitDirection: rng.chance(0.5) ? -1 : 1,
    aggression: Number(rng.float(0.88, 1.12).toFixed(3)),
    minimumPackSize: base.minimumPackSize ?? 1,
    ...(archetype.id === 'packHunter' ? {
      flankApproachDistance: base.flankApproachDistance,
      flankRearBiasMin: base.flankRearBiasMin,
      flankRearBiasMax: base.flankRearBiasMax,
      flankAttackDot: base.flankAttackDot,
      flankPursuitSpeedScale: base.flankPursuitSpeedScale,
      attackCooldownScale: base.attackCooldownScale,
      attackCooldownFloor: base.attackCooldownFloor,
      forcedAttackSeconds: base.forcedAttackSeconds,
    } : {}),
  };
}

function buildCandidate(seed, threatTier, context, candidateIndex) {
  const rng = new SeededRandom(`${seed}:candidate:${candidateIndex}`);
  const archetype = pickArchetype(rng.fork('archetype'), context);
  const body = pickBodyPlan(rng.fork('body'), archetype, context);
  const weaponDefinition = pickWeapon(rng.fork('weapon'), archetype, body, context);
  const weapon = createWeaponVariant(weaponDefinition, rng.fork('weaponVariant'), archetype, context);
  const mobility = createMobilityVariant(rng.fork('mobility'), archetype, body, context, weapon);
  const charge = createChargeModule(body, weapon, rng.fork('chargeModule'));
  const defense = weapon.id === 'clawArm'
    ? null
    : weapon.id === 'launchLeg'
      ? REAVERBOT_DEFENSES.sidePlates
      : pickDefense(rng.fork('defense'), archetype, body, context);
  const weakPoint = pickWeakPoint(rng.fork('weakPoint'), archetype, defense, weapon, context);
  const proportions = createProportions(rng.fork('proportions'), body);
  const behavior = createBehavior(archetype, mobility, weapon, weakPoint, rng.fork('behavior'));
  const stats = createStats(archetype, body, mobility, weapon, threatTier, proportions, context);
  const tier = clamp(Math.trunc(threatTier) || 1, 1, 8);
  const spent = archetype.threatCost + weapon.threatCost + (defense?.threatCost ?? 0) + Math.max(1, tier - 1);
  const budget = 13
    + tier * 3
    + (context.elite ? 5 : 0)
    + clamp(Math.trunc(context.bossBudgetBonus ?? 0), 0, 16);
  const palette = REAVERBOT_PALETTES[archetype.paletteId];

  const genome = {
    schemaVersion: SCHEMA_VERSION,
    seed: hashSeed(seed),
    seedLabel: String(seed),
    candidateIndex,
    name: createName(rng.fork('name'), archetype, tier),
    threatTier: tier,
    threat: { budget, spent },
    archetypeId: archetype.id,
    archetypeLabel: archetype.label,
    squadRole: archetype.role,
    body: {
      planId: body.id,
      label: body.label,
      navigationMode: body.tags.includes('aerial') ? 'air' : 'ground',
      hoverHeight: body.hoverHeight ?? 0,
      tags: [...new Set([...body.tags, ...mobility.tags])],
      mobilityId: mobility.id,
      mobilityLabel: mobility.label,
      movementModel: mobility.movementModel,
      mobilityLegCount: mobility.legCount,
      mobilityWheelCount: mobility.wheelCount,
      mobilitySalvageId: mobility.salvageModuleId,
      proportions,
    },
    modules: {
      eye: {
        id: 'singleRubyLens',
        color: REAVERBOT_EYE_COLOR,
        dominant: true,
      },
      weapon: { ...weapon, tags: [...weapon.tags] },
      charge: charge ? { ...charge, tags: [...charge.tags] } : null,
      defense: defense ? { ...defense, tags: [...defense.tags] } : null,
      weakPoint: { ...weakPoint },
    },
    paletteId: archetype.paletteId,
    palette: { ...palette },
    behavior,
    stats,
    context: {
      intent: context.intent ?? 'any',
      roomArchetypeId: context.roomArchetypeId ?? null,
      roomFlavorId: context.roomFlavorId ?? null,
      encounterSize: context.encounterSize ?? 1,
      elite: Boolean(context.elite),
      isBoss: Boolean(context.isBoss),
      keycardCarrier: Boolean(context.keycardCarrier),
      ...(context.bossProfileId ? { bossProfileId: String(context.bossProfileId) } : {}),
      ...(context.bossSafeOverload ? { bossSafeOverload: true } : {}),
    },
    tags: [...new Set([
      archetype.id,
      archetype.role,
      ...body.tags,
      ...weapon.tags,
      ...(charge?.tags ?? []),
      ...(defense?.tags ?? []),
    ])],
  };

  const validation = validateReaverbotGenome(genome, { allowPendingBodyDefenseOverride: true });
  // The claw's articulated guard is integrated into its weapon rather than a
  // separate defense module, but it still contributes a distinct gameplay
  // idea when scoring candidate variety.
  const defenseNoveltyId = defense?.id ?? (weapon.id === 'clawArm' ? 'integratedClawGuard' : null);
  const novelty = new Set([body.id, mobility.id, weapon.id, defenseNoveltyId, weakPoint.id].filter(Boolean)).size
    // Launch Leg is both the weapon and the entire locomotion assembly. Count
    // those as two authored aspects even though they intentionally share the
    // same public module id.
    + (weapon.id === 'launchLeg' && mobility.id === 'launchLeg' ? 1 : 0);
  const coherence = weapon.id === 'clawArm' && weakPoint.id === 'clawPalm'
    ? 2
    : (LINKED_WEAK_POINT_WEIGHTS[defense?.id] ?? []).some(([id]) => id === weakPoint.id) ? 2 : 0;
  const weaponLink = (WEAPON_WEAK_POINT_WEIGHTS[weapon.id] ?? []).some(([id]) => id === weakPoint.id) ? 2 : 0;
  const score = (validation.valid ? 100 : -validation.errors.length * 20)
    + novelty * 1.5
    + coherence
    + weaponLink
    + (weakPoint.lockable ? 1 : 0)
    + rng.float(0, 0.25);

  return { genome, validation, score };
}

function applyBodyDefenseOverrides(genome) {
  if (genome.body.planId !== 'quadruped' || genome.modules.weapon.id === 'clawArm') {
    return genome;
  }

  const priorDefenseCost = genome.modules.defense?.threatCost ?? 0;
  const defense = REAVERBOT_DEFENSES.armorShutters;
  const weakPoint = REAVERBOT_WEAK_POINTS.eyeLens;
  genome.modules.defense = { ...defense, tags: [...defense.tags] };
  genome.modules.weakPoint = { ...weakPoint };
  genome.behavior.exposureDuration = Number(Math.max(
    0.65,
    genome.behavior.telegraphDuration + genome.behavior.commitDuration * 0.45,
  ).toFixed(3));
  genome.threat.spent += defense.threatCost - priorDefenseCost;

  const archetype = REAVERBOT_ARCHETYPES[genome.archetypeId];
  genome.tags = [...new Set([
    archetype.id,
    archetype.role,
    ...genome.body.tags,
    ...genome.modules.weapon.tags,
    ...(genome.modules.charge?.tags ?? []),
    ...defense.tags,
  ])];
  return genome;
}

export function validateReaverbotGenome(genome, { allowPendingBodyDefenseOverride = false } = {}) {
  const errors = [];
  const warnings = [];
  const body = REAVERBOT_BODY_PLANS[genome?.body?.planId];
  const weapon = REAVERBOT_WEAPONS[genome?.modules?.weapon?.id];
  const defense = REAVERBOT_DEFENSES[genome?.modules?.defense?.id];
  const weakPoint = REAVERBOT_WEAK_POINTS[genome?.modules?.weakPoint?.id];
  const archetype = REAVERBOT_ARCHETYPES[genome?.archetypeId];
  const defensePayload = genome?.modules?.defense;
  const weaponPayload = genome?.modules?.weapon;
  const chargePayload = genome?.modules?.charge;
  const chargeDefinition = REAVERBOT_CHARGE_MODULES[chargePayload?.id];
  const mobilityId = genome?.body?.mobilityId;
  const springMobility = genome?.body?.movementModel === 'springBounce'
    && SPRING_MOBILITY_IDS.has(mobilityId);
  const crawlerMobility = CRAWLER_MOBILITY_IDS.has(mobilityId);
  const wheelMobility = genome?.body?.movementModel === 'wheelDrive'
    && mobilityId === 'wheelBogies';
  const isClaw = weapon?.id === 'clawArm';
  const isLaunchLeg = weapon?.id === 'launchLeg';
  const usesQuadrupedEyelids = body?.id === 'quadruped'
    && defense?.id === 'armorShutters'
    && weakPoint?.id === 'eyeLens';

  if (genome?.schemaVersion !== SCHEMA_VERSION) errors.push('unsupported-schema-version');
  if (!archetype) errors.push('unknown-archetype');
  if (!body) errors.push('unknown-body-plan');
  if (!weapon) errors.push('missing-weapon');
  if (weapon?.attackKind === 'charge' && !chargeDefinition) errors.push('charge-module-required');
  if (weapon?.attackKind !== 'charge' && chargePayload != null) errors.push('charge-module-on-non-charge');
  if (chargeDefinition && body?.tags.includes('aerial') && chargeDefinition.id !== 'vectorRocket') {
    errors.push('aerial-vector-rocket-required');
  }
  if (chargeDefinition && (body?.id === 'quadruped' || body?.id === 'crawler') && chargeDefinition.id !== 'spineJet') {
    errors.push('quadruped-spine-jet-required');
  }
  if (chargeDefinition
    && !body?.tags.includes('aerial')
    && body?.id !== 'quadruped'
    && body?.id !== 'crawler'
    && chargeDefinition.id !== 'twinRocketPack') {
    errors.push('back-rocket-pack-required');
  }
  if (isClaw && defensePayload !== null) errors.push('claw-defense-must-be-null');
  if (!isClaw && defensePayload === null) errors.push('defense-null-non-claw');
  if (!isClaw && defensePayload !== null && !defense) errors.push('missing-defense');
  if (!weakPoint) errors.push('missing-weak-point');
  if (isClaw && weakPoint?.id !== 'clawPalm') errors.push('claw-palm-weak-point-required');
  if (!isClaw && weakPoint?.id === 'clawPalm') errors.push('claw-palm-non-claw');
  if (isLaunchLeg && weakPoint?.id !== 'legJoint') errors.push('launch-leg-joint-weak-point-required');
  if (isLaunchLeg && defense?.id !== 'sidePlates') errors.push('launch-leg-side-plates-required');
  if (!allowPendingBodyDefenseOverride
    && body?.id === 'quadruped'
    && !isClaw
    && defense?.id !== 'armorShutters') {
    errors.push('quadruped-eyelid-defense-required');
  }
  if (!allowPendingBodyDefenseOverride
    && body?.id === 'quadruped'
    && !isClaw
    && weakPoint?.id !== 'eyeLens') {
    errors.push('quadruped-eye-weak-point-required');
  }
  if (genome?.modules?.eye?.color !== REAVERBOT_EYE_COLOR) errors.push('red-eye-contract');
  if (genome?.archetypeId === 'pouncer' && !springMobility) errors.push('pouncer-spring-mobility-required');
  if (weaponPayload?.attackKind === 'pounce' && !springMobility) errors.push('pounce-spring-mobility-required');
  if (genome?.archetypeId === 'pouncer' && weaponPayload?.attackKind !== 'pounce') errors.push('pouncer-pounce-attack-required');
  if (genome?.archetypeId === 'pouncer'
    && (!weaponPayload?.integratedIntoMobility || weaponPayload?.mountRole !== 'locomotion')) {
    errors.push('pouncer-mobility-weapon-required');
  }
  if (mobilityId === 'springQuadruped' && body?.id !== 'quadruped') errors.push('spring-quadruped-body-incompatible');
  if ((mobilityId === 'pairedSprings' || mobilityId === 'monoPogo') && body?.id !== 'hopper') {
    errors.push('hopper-spring-body-incompatible');
  }
  if (mobilityId === 'launchLeg'
    && (body?.id !== 'hopper'
      || weapon?.id !== 'launchLeg'
      || genome?.body?.mobilityLegCount !== 1)) {
    errors.push('launch-leg-mobility-contract');
  }
  if (mobilityId === 'monoPogo' && genome?.body?.mobilityLegCount !== 1) errors.push('mono-pogo-single-leg-required');
  if (crawlerMobility && body?.id !== 'crawler') errors.push('crawler-mobility-body-incompatible');
  if (genome?.body?.movementModel === 'wheelDrive' && mobilityId !== 'wheelBogies') {
    errors.push('wheel-drive-mobility-mismatch');
  }
  if (mobilityId === 'articulatedCrawler'
    && (genome?.body?.movementModel !== 'groundStep' || genome?.body?.mobilityLegCount !== 6)) {
    errors.push('articulated-crawler-contract');
  }
  if (mobilityId === 'wheelBogies'
    && (!wheelMobility
      || genome?.body?.mobilityLegCount !== 0
      || genome?.body?.mobilityWheelCount !== 4
      || genome?.body?.navigationMode !== 'ground'
      || !genome?.body?.tags?.includes('wheeled')
      || !genome?.body?.tags?.includes('rolling'))) {
    errors.push('wheel-bogy-contract');
  }
  if (body && weapon && !hasBodyRequirements(weapon, body)) errors.push('weapon-body-incompatible');
  if (body && defense && !hasBodyRequirements(defense, body)) errors.push('defense-body-incompatible');
  if (archetype && weapon && !archetype.weapons.includes(weapon.id)) errors.push('weapon-archetype-incompatible');
  if (archetype && defense && !archetype.defenses.includes(defense.id) && !usesQuadrupedEyelids) {
    errors.push('defense-archetype-incompatible');
  }
  if (archetype && weakPoint && !archetype.weakPoints.includes(weakPoint.id) && !usesQuadrupedEyelids) {
    errors.push('weak-point-archetype-incompatible');
  }
  if (!isClaw && defense && weakPoint
    && !(LINKED_WEAK_POINT_WEIGHTS[defense.id] ?? []).some(([id]) => id === weakPoint.id)) {
    errors.push('defense-weak-point-unpaired');
  }
  if ((genome?.behavior?.exposureDuration ?? 0) < 0.6) errors.push('weak-point-window-too-short');
  if ((defense?.uptime ?? 0) > 0.7) errors.push('defense-uptime-too-high');
  if ((genome?.threat?.spent ?? Infinity) > (genome?.threat?.budget ?? -Infinity)) errors.push('threat-budget-exceeded');
  if (genome?.archetypeId === 'tractorController' && (genome?.context?.encounterSize ?? 1) < 2) errors.push('tractor-controller-alone');
  const bossSafeOverload = genome?.context?.bossSafeOverload
    && genome?.context?.bossProfileId === 'overloadReliquary'
    && weapon?.id === 'overloadCore'
    && weaponPayload?.attackKind === 'bossOverload'
    && weaponPayload?.bossSafe === true;
  if (genome?.archetypeId === 'aerialBomber'
    && (genome?.context?.isBoss || genome?.context?.keycardCarrier)
    && !bossSafeOverload) errors.push('critical-self-destruct');
  if (genome?.archetypeId === 'tractorController' && (genome?.context?.isBoss || genome?.context?.keycardCarrier)) errors.push('critical-dependent-controller');
  if (weakPoint?.location === 'eye' && defense?.id === 'armoredSkull') warnings.push('eye-near-front-armor');

  return { valid: errors.length === 0, errors, warnings };
}

export function generateReaverbotGenome({
  seed = 'reaverbot',
  threatTier = 1,
  intent = 'any',
  ...context
} = {}) {
  const normalizedSeed = hashSeed(seed);
  const generationContext = { ...context, intent };
  let best = null;

  for (let candidateIndex = 0; candidateIndex < CANDIDATE_COUNT; candidateIndex += 1) {
    const candidate = buildCandidate(normalizedSeed, threatTier, generationContext, candidateIndex);
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  if (!best?.validation.valid) {
    const error = new Error(`Unable to generate a valid Reaverbot: ${best?.validation.errors.join(', ')}`);
    error.validation = best?.validation;
    throw error;
  }

  const genome = applyBodyDefenseOverrides(best.genome);
  const finalValidation = validateReaverbotGenome(genome);
  if (!finalValidation.valid) {
    const error = new Error(`Unable to apply Reaverbot body defense contract: ${finalValidation.errors.join(', ')}`);
    error.validation = finalValidation;
    throw error;
  }

  return genome;
}

export function createEncounterSlotSeed(runSeed, encounterId, slotIndex) {
  return hashSeed(`${runSeed}:encounter:${encounterId}:slot:${slotIndex}`);
}

export function getReaverbotCatalogSummary() {
  return {
    schemaVersion: SCHEMA_VERSION,
    archetypes: Object.keys(REAVERBOT_ARCHETYPES),
    bodyPlans: Object.keys(REAVERBOT_BODY_PLANS),
    weapons: Object.keys(REAVERBOT_WEAPONS),
    chargeModules: Object.keys(REAVERBOT_CHARGE_MODULES),
    defenses: Object.keys(REAVERBOT_DEFENSES),
    weakPoints: Object.keys(REAVERBOT_WEAK_POINTS),
    palettes: Object.keys(REAVERBOT_PALETTES),
    eyeColor: REAVERBOT_EYE_COLOR,
  };
}
