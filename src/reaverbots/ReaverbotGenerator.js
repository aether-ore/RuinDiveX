import {
  INTENT_ARCHETYPE_WEIGHTS,
  LINKED_WEAK_POINT_WEIGHTS,
  REAVERBOT_ARCHETYPES,
  REAVERBOT_BODY_PLANS,
  REAVERBOT_DEFENSES,
  REAVERBOT_EYE_COLOR,
  REAVERBOT_PALETTES,
  REAVERBOT_WEAK_POINTS,
  REAVERBOT_WEAPONS,
} from './ReaverbotCatalog.js';
import { hashSeed, SeededRandom } from './SeededRandom.js';

const SCHEMA_VERSION = 2;
const CANDIDATE_COUNT = 8;
const GLOBAL_REAVERBOT_MOVE_SPEED_SCALE = 1.22;
const NAME_PREFIXES = ['AR', 'BA', 'DA', 'GA', 'KA', 'KO', 'MU', 'NA', 'OM', 'RA', 'SA', 'TO', 'UR', 'VA', 'ZA'];
const NAME_SUFFIXES = ['EN', 'GAR', 'KIR', 'MOL', 'ORA', 'RAK', 'TUM', 'VAN', 'XEL', 'ZUN'];
const WEAPON_WEAK_POINT_WEIGHTS = Object.freeze({
  ramHorn: [['legJoint', 4], ['rearBattery', 3]],
  crusherJaw: [['rearBattery', 3], ['legJoint', 3], ['eyeLens', 1]],
  clawArm: [['clawPalm', 10]],
  pounceActuator: [['bellyCore', 7], ['legJoint', 2]],
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

function pickBodyPlan(rng, archetype) {
  const compatible = archetype.bodyPlans
    .map((id) => REAVERBOT_BODY_PLANS[id])
    .filter(Boolean);
  return rng.pick(compatible) ?? REAVERBOT_BODY_PLANS.biped;
}

function pickWeapon(rng, archetype, body) {
  const compatible = archetype.weapons
    .map((id) => REAVERBOT_WEAPONS[id])
    .filter((weapon) => weapon && hasBodyRequirements(weapon, body));
  return rng.pick(compatible) ?? REAVERBOT_WEAPONS.pulseCannon;
}

function createWeaponVariant(weapon, rng) {
  if (weapon.id !== 'clawArm') return weapon;
  return {
    ...weapon,
    mountSide: rng.chance(0.5) ? -1 : 1,
  };
}

function pickDefense(rng, archetype, body) {
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

function pickWeakPoint(rng, archetype, defense, weapon) {
  if (weapon.id === 'clawArm') return REAVERBOT_WEAK_POINTS.clawPalm;
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

function createStats(archetype, body, weapon, threatTier, proportions, context) {
  const tier = clamp(Math.trunc(threatTier) || 1, 1, 8);
  const tierHealth = 1 + (tier - 1) * 0.2;
  const tierDamage = 1 + (tier - 1) * 0.105;
  const roomHealth = clamp(context.healthMultiplier ?? 1, 0.72, 1.6);
  const bodyScale = body.radiusScale * proportions.overallScale;
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
      * (1 + Math.min(0.16, (tier - 1) * 0.025))
    ).toFixed(3)),
    attackRange: Number(attackRange.toFixed(3)),
    attackCooldown: Number(clamp(
      (telegraphDuration + commitDuration + recoveryDuration) * 0.9 * (weapon.cooldownScale ?? 1),
      0.75,
      3.25,
    ).toFixed(3)),
    armor: Number(((base.armor + meleeArmorBonus) * (1 + (tier - 1) * 0.12)).toFixed(3)),
    experience: Math.round((4 + archetype.threatCost * 1.4) * (1 + (tier - 1) * 0.22)),
    radius: Number((base.radius * bodyScale).toFixed(3)),
    collisionHeight: Number((body.height * proportions.overallScale + (body.hoverHeight ?? 0)).toFixed(3)),
  };
}

function createBehavior(archetype, weapon, weakPoint, rng) {
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
    turnRate: base.turnRate,
    orbitDirection: rng.chance(0.5) ? -1 : 1,
    aggression: Number(rng.float(0.88, 1.12).toFixed(3)),
    minimumPackSize: base.minimumPackSize ?? 1,
    ...(archetype.id === 'packHunter' ? {
      rearApproachDistance: base.rearApproachDistance,
      rearLaneOffset: base.rearLaneOffset,
      rearAttackDot: base.rearAttackDot,
      rearPursuitSpeedScale: base.rearPursuitSpeedScale,
    } : {}),
  };
}

function buildCandidate(seed, threatTier, context, candidateIndex) {
  const rng = new SeededRandom(`${seed}:candidate:${candidateIndex}`);
  const archetype = pickArchetype(rng.fork('archetype'), context);
  const body = pickBodyPlan(rng.fork('body'), archetype);
  const weaponDefinition = pickWeapon(rng.fork('weapon'), archetype, body);
  const weapon = createWeaponVariant(weaponDefinition, rng.fork('weaponVariant'));
  const defense = weapon.id === 'clawArm'
    ? null
    : pickDefense(rng.fork('defense'), archetype, body);
  const weakPoint = pickWeakPoint(rng.fork('weakPoint'), archetype, defense, weapon);
  const proportions = createProportions(rng.fork('proportions'), body);
  const behavior = createBehavior(archetype, weapon, weakPoint, rng.fork('behavior'));
  const stats = createStats(archetype, body, weapon, threatTier, proportions, context);
  const tier = clamp(Math.trunc(threatTier) || 1, 1, 8);
  const spent = archetype.threatCost + weapon.threatCost + (defense?.threatCost ?? 0) + Math.max(1, tier - 1);
  const budget = 13 + tier * 3 + (context.elite ? 5 : 0);
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
      tags: [...body.tags],
      proportions,
    },
    modules: {
      eye: {
        id: 'singleRubyLens',
        color: REAVERBOT_EYE_COLOR,
        dominant: true,
      },
      weapon: { ...weapon, tags: [...weapon.tags] },
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
    },
    tags: [...new Set([
      archetype.id,
      archetype.role,
      ...body.tags,
      ...weapon.tags,
      ...(defense?.tags ?? []),
    ])],
  };

  const validation = validateReaverbotGenome(genome);
  // The claw's articulated guard is integrated into its weapon rather than a
  // separate defense module, but it still contributes a distinct gameplay
  // idea when scoring candidate variety.
  const defenseNoveltyId = defense?.id ?? (weapon.id === 'clawArm' ? 'integratedClawGuard' : null);
  const novelty = new Set([body.id, weapon.id, defenseNoveltyId, weakPoint.id].filter(Boolean)).size;
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

export function validateReaverbotGenome(genome) {
  const errors = [];
  const warnings = [];
  const body = REAVERBOT_BODY_PLANS[genome?.body?.planId];
  const weapon = REAVERBOT_WEAPONS[genome?.modules?.weapon?.id];
  const defense = REAVERBOT_DEFENSES[genome?.modules?.defense?.id];
  const weakPoint = REAVERBOT_WEAK_POINTS[genome?.modules?.weakPoint?.id];
  const archetype = REAVERBOT_ARCHETYPES[genome?.archetypeId];
  const defensePayload = genome?.modules?.defense;
  const isClaw = weapon?.id === 'clawArm';

  if (genome?.schemaVersion !== SCHEMA_VERSION) errors.push('unsupported-schema-version');
  if (!archetype) errors.push('unknown-archetype');
  if (!body) errors.push('unknown-body-plan');
  if (!weapon) errors.push('missing-weapon');
  if (isClaw && defensePayload !== null) errors.push('claw-defense-must-be-null');
  if (!isClaw && defensePayload === null) errors.push('defense-null-non-claw');
  if (!isClaw && defensePayload !== null && !defense) errors.push('missing-defense');
  if (!weakPoint) errors.push('missing-weak-point');
  if (isClaw && weakPoint?.id !== 'clawPalm') errors.push('claw-palm-weak-point-required');
  if (!isClaw && weakPoint?.id === 'clawPalm') errors.push('claw-palm-non-claw');
  if (genome?.modules?.eye?.color !== REAVERBOT_EYE_COLOR) errors.push('red-eye-contract');
  if (body && weapon && !hasBodyRequirements(weapon, body)) errors.push('weapon-body-incompatible');
  if (body && defense && !hasBodyRequirements(defense, body)) errors.push('defense-body-incompatible');
  if (archetype && weapon && !archetype.weapons.includes(weapon.id)) errors.push('weapon-archetype-incompatible');
  if (archetype && defense && !archetype.defenses.includes(defense.id)) errors.push('defense-archetype-incompatible');
  if (archetype && weakPoint && !archetype.weakPoints.includes(weakPoint.id)) errors.push('weak-point-archetype-incompatible');
  if (!isClaw && defense && weakPoint
    && !(LINKED_WEAK_POINT_WEIGHTS[defense.id] ?? []).some(([id]) => id === weakPoint.id)) {
    errors.push('defense-weak-point-unpaired');
  }
  if ((genome?.behavior?.exposureDuration ?? 0) < 0.6) errors.push('weak-point-window-too-short');
  if ((defense?.uptime ?? 0) > 0.7) errors.push('defense-uptime-too-high');
  if ((genome?.threat?.spent ?? Infinity) > (genome?.threat?.budget ?? -Infinity)) errors.push('threat-budget-exceeded');
  if (genome?.archetypeId === 'tractorController' && (genome?.context?.encounterSize ?? 1) < 2) errors.push('tractor-controller-alone');
  if (genome?.archetypeId === 'aerialBomber' && (genome?.context?.isBoss || genome?.context?.keycardCarrier)) errors.push('critical-self-destruct');
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

  return best.genome;
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
    defenses: Object.keys(REAVERBOT_DEFENSES),
    weakPoints: Object.keys(REAVERBOT_WEAK_POINTS),
    palettes: Object.keys(REAVERBOT_PALETTES),
    eyeColor: REAVERBOT_EYE_COLOR,
  };
}
