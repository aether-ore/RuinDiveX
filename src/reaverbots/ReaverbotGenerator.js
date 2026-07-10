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

const SCHEMA_VERSION = 1;
const CANDIDATE_COUNT = 8;
const NAME_PREFIXES = ['AR', 'BA', 'DA', 'GA', 'KA', 'KO', 'MU', 'NA', 'OM', 'RA', 'SA', 'TO', 'UR', 'VA', 'ZA'];
const NAME_SUFFIXES = ['EN', 'GAR', 'KIR', 'MOL', 'ORA', 'RAK', 'TUM', 'VAN', 'XEL', 'ZUN'];
const WEAPON_WEAK_POINT_WEIGHTS = Object.freeze({
  ramHorn: [['legJoint', 4], ['rearBattery', 3]],
  crusherJaw: [['rearBattery', 3], ['legJoint', 3], ['eyeLens', 1]],
  clawArm: [['legJoint', 3], ['rearBattery', 2], ['eyeLens', 1]],
  pounceActuator: [['bellyCore', 7], ['legJoint', 2]],
  shockPiston: [['bellyCore', 4], ['legJoint', 3]],
  pulseCannon: [['ammoDrum', 3], ['eyeLens', 2], ['rearBattery', 2]],
  mortarPod: [['ammoDrum', 7], ['rearBattery', 2]],
  clusterMortar: [['ammoDrum', 8], ['rearBattery', 2]],
  arcEmitter: [['emitterCore', 6], ['eyeLens', 2]],
  flameNozzle: [['coolingVents', 7], ['rearBattery', 2]],
  beamPrism: [['eyeLens', 4], ['emitterCore', 3]],
  mineDispenser: [['ammoDrum', 4], ['rearBattery', 3]],
  overloadCore: [['overloadCore', 8], ['eyeLens', 4]],
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hasBodyRequirements(module, body) {
  const tags = new Set(body.tags ?? []);
  const required = module.requires ?? [];
  const requiredAny = module.requiresAny ?? [];
  return required.every((tag) => tags.has(tag))
    && (requiredAny.length === 0 || requiredAny.some((tag) => tags.has(tag)));
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
  if (/server|sensor|turret|security/.test(text)) boost(['shieldSentinel', 'zoneController', 'artillery'], 1.8);
  if (/machine|factory|assembly|heavy/.test(text)) boost(['artillery', 'shieldSentinel', 'duelist'], 1.65);
  if (/coolant|fluid|cryo|electric|energy/.test(text)) boost(['zoneController', 'aerialBomber'], 1.9);
  if (/trap|ambush|hunting|aggressive/.test(text)) boost(['pouncer', 'pursuer'], 1.8);
  if (/flying|aerial|hover/.test(text)) boost(['aerialBomber', 'zoneController'], 2.4);
  if (context.isBoss) boost(['duelist', 'shieldSentinel', 'artillery'], 2.6);

  const suppressed = (context.suppressedTags ?? []).join(' ').toLowerCase();
  if (/turret|sensor|security/.test(suppressed)) boost(['artillery', 'shieldSentinel'], 0.48);
  if (/crawler|swarm|wild/.test(suppressed)) boost(['packHunter', 'pursuer', 'pouncer'], 0.48);
  if (/flying|aerial|hover/.test(suppressed)) boost(['aerialBomber', 'zoneController'], 0.42);
  if (/large|heavy|guardian/.test(suppressed)) boost(['shieldSentinel', 'artillery', 'duelist'], 0.55);

  if ((context.encounterSize ?? 1) < 2) {
    weights.delete('packHunter');
  }
  if (context.isBoss || context.keycardCarrier) {
    weights.delete('aerialBomber');
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

function pickDefense(rng, archetype, body) {
  const compatible = archetype.defenses
    .map((id) => REAVERBOT_DEFENSES[id])
    .filter((defense) => defense && hasBodyRequirements(defense, body));
  return rng.pick(compatible) ?? REAVERBOT_DEFENSES.reactivePlate;
}

function mergeWeightedWeakPoints(archetype, defense, weapon) {
  const allowed = new Set(archetype.weakPoints);
  const combined = new Map(archetype.weakPoints.map((id) => [id, 1]));

  for (const [id, weight] of LINKED_WEAK_POINT_WEIGHTS[defense.id] ?? []) {
    if (allowed.has(id)) combined.set(id, (combined.get(id) ?? 0) + weight);
  }
  for (const [id, weight] of WEAPON_WEAK_POINT_WEIGHTS[weapon.id] ?? []) {
    if (allowed.has(id)) combined.set(id, (combined.get(id) ?? 0) + weight);
  }

  return [...combined.entries()].map(([value, weight]) => ({ value, weight }));
}

function pickWeakPoint(rng, archetype, defense, weapon) {
  const id = rng.weighted(mergeWeightedWeakPoints(archetype, defense, weapon), archetype.weakPoints[0]);
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

  return {
    maxHealth: Number((base.health * tierHealth * roomHealth).toFixed(3)),
    damage: Number((base.damage * tierDamage * (weapon.damageScale ?? 1)).toFixed(3)),
    moveSpeed: Number((base.speed * (1 + Math.min(0.16, (tier - 1) * 0.025))).toFixed(3)),
    attackRange: Number(attackRange.toFixed(3)),
    attackCooldown: Number(clamp(
      archetype.behavior.telegraph + archetype.behavior.commit + archetype.behavior.recovery,
      0.8,
      3.6,
    ).toFixed(3)),
    armor: Number((base.armor * (1 + (tier - 1) * 0.12)).toFixed(3)),
    experience: Math.round((4 + archetype.threatCost * 1.4) * (1 + (tier - 1) * 0.22)),
    radius: Number((base.radius * bodyScale).toFixed(3)),
    collisionHeight: Number((body.height * proportions.overallScale + (body.hoverHeight ?? 0)).toFixed(3)),
  };
}

function createBehavior(archetype, weapon, weakPoint, rng) {
  const base = archetype.behavior;
  const exposureDuration = weakPoint.exposure === 'always'
    ? 99
    : weakPoint.exposure === 'telegraph'
      ? Math.max(0.65, base.telegraph)
      : weakPoint.exposure === 'attack'
        ? Math.max(0.65, base.telegraph + base.commit * 0.45)
        : Math.max(0.7, base.recovery * 0.78);

  return {
    id: archetype.id,
    role: archetype.role,
    preferredRange: weapon.tags.includes('ranged') ? Math.max(base.preferredRange, weapon.range * 0.66) : base.preferredRange,
    aggroRange: base.aggroRange,
    telegraphDuration: base.telegraph,
    commitDuration: base.commit,
    recoveryDuration: base.recovery,
    exposureDuration: Number(exposureDuration.toFixed(3)),
    turnRate: base.turnRate,
    orbitDirection: rng.chance(0.5) ? -1 : 1,
    aggression: Number(rng.float(0.88, 1.12).toFixed(3)),
    minimumPackSize: base.minimumPackSize ?? 1,
  };
}

function buildCandidate(seed, threatTier, context, candidateIndex) {
  const rng = new SeededRandom(`${seed}:candidate:${candidateIndex}`);
  const archetype = pickArchetype(rng.fork('archetype'), context);
  const body = pickBodyPlan(rng.fork('body'), archetype);
  const weapon = pickWeapon(rng.fork('weapon'), archetype, body);
  const defense = pickDefense(rng.fork('defense'), archetype, body);
  const weakPoint = pickWeakPoint(rng.fork('weakPoint'), archetype, defense, weapon);
  const proportions = createProportions(rng.fork('proportions'), body);
  const behavior = createBehavior(archetype, weapon, weakPoint, rng.fork('behavior'));
  const stats = createStats(archetype, body, weapon, threatTier, proportions, context);
  const tier = clamp(Math.trunc(threatTier) || 1, 1, 8);
  const spent = archetype.threatCost + weapon.threatCost + defense.threatCost + Math.max(1, tier - 1);
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
      defense: { ...defense, tags: [...defense.tags] },
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
      ...defense.tags,
    ])],
  };

  const validation = validateReaverbotGenome(genome);
  const novelty = new Set([body.id, weapon.id, defense.id, weakPoint.id]).size;
  const coherence = (LINKED_WEAK_POINT_WEIGHTS[defense.id] ?? []).some(([id]) => id === weakPoint.id) ? 2 : 0;
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

  if (!archetype) errors.push('unknown-archetype');
  if (!body) errors.push('unknown-body-plan');
  if (!weapon) errors.push('missing-weapon');
  if (!defense) errors.push('missing-defense');
  if (!weakPoint) errors.push('missing-weak-point');
  if (genome?.modules?.eye?.color !== REAVERBOT_EYE_COLOR) errors.push('red-eye-contract');
  if (body && weapon && !hasBodyRequirements(weapon, body)) errors.push('weapon-body-incompatible');
  if (body && defense && !hasBodyRequirements(defense, body)) errors.push('defense-body-incompatible');
  if (archetype && weapon && !archetype.weapons.includes(weapon.id)) errors.push('weapon-archetype-incompatible');
  if (archetype && defense && !archetype.defenses.includes(defense.id)) errors.push('defense-archetype-incompatible');
  if (archetype && weakPoint && !archetype.weakPoints.includes(weakPoint.id)) errors.push('weak-point-archetype-incompatible');
  if ((genome?.behavior?.exposureDuration ?? 0) < 0.6) errors.push('weak-point-window-too-short');
  if ((defense?.uptime ?? 0) > 0.7) errors.push('defense-uptime-too-high');
  if ((genome?.threat?.spent ?? Infinity) > (genome?.threat?.budget ?? -Infinity)) errors.push('threat-budget-exceeded');
  if (genome?.archetypeId === 'packHunter' && (genome?.context?.encounterSize ?? 1) < 2) errors.push('pack-hunter-alone');
  if (genome?.archetypeId === 'aerialBomber' && (genome?.context?.isBoss || genome?.context?.keycardCarrier)) errors.push('critical-self-destruct');
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
