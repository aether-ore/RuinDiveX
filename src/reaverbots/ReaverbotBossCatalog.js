import { generateReaverbotGenome, validateReaverbotGenome } from './ReaverbotGenerator.js';
import { REAVERBOT_SALVAGE_SOURCE_MAPS } from './ReaverbotSalvageCatalog.js';
import { hashSeed, SeededRandom } from './SeededRandom.js';

export const DEFAULT_BOSS_PROFILE_ID = 'revolvingFusillade';
export const BOSS_EXPEDITION_SCHEMA_VERSION = 1;

export const REAVERBOT_BOSS_STAT_SCALES = Object.freeze({
  health: 6.5,
  damage: 1.35,
  armor: 1.25,
  visual: 1.28,
  cooldown: 0.9,
  experience: 6,
});

export const REAVERBOT_BOSS_LIMITS = Object.freeze({
  projectiles: 20,
  telegraphs: 12,
  persistentConstructs: 8,
  maximumHazardSeconds: 6,
  arenaTelegraphSeconds: 0.75,
  pulseTelegraphSeconds: 0.55,
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function profile({
  id,
  title,
  roleClue,
  featured,
  generation,
  phaseOne,
  phaseTwo,
  overloadWeakening,
  arena,
  healthScale = REAVERBOT_BOSS_STAT_SCALES.health,
}) {
  return deepFreeze({
    id,
    title,
    roleClue,
    featured,
    generation,
    combat: {
      phaseThreshold: 0.5,
      phaseTransitionSeconds: 1.1,
      signatureIntegrityHealthScale: 0.24,
      signatureDirectDamageMultiplier: 1.5,
      signatureInterruptSeconds: 2,
      staggerScale: 0.35,
      healthScale,
      immuneToLift: true,
      immuneToOrdinaryKnockback: true,
      phaseOne,
      phaseTwo,
      overloadWeakening,
      limits: REAVERBOT_BOSS_LIMITS,
    },
    arena,
    visualProfileId: id,
  });
}

const ARTILLERY_VARIANTS = Object.freeze([
  Object.freeze({ bodyPlanId: 'tripod', defenseId: 'directionalShield', weakPointId: 'rearBattery' }),
  Object.freeze({ bodyPlanId: 'tripod', defenseId: 'armorShutters', weakPointId: 'eyeLens' }),
  Object.freeze({ bodyPlanId: 'crawler', defenseId: 'armoredCarapace', weakPointId: 'ammoDrum' }),
]);

export const REAVERBOT_BOSS_PROFILES = deepFreeze([
  profile({
    id: 'pursuitRegent',
    title: 'Pursuit Regent',
    roleClue: 'tracking logic',
    featured: { aspect: 'behavior', moduleId: 'pursuer' },
    generation: {
      archetypeId: 'pursuer',
      weaponId: 'rocketLance',
      variants: [
        { bodyPlanId: 'lowBiped', defenseId: 'sidePlates', weakPointId: 'legJoint' },
        { bodyPlanId: 'lowBiped', defenseId: 'reactivePlate', weakPointId: 'rearBattery' },
        { bodyPlanId: 'quadruped', defenseId: 'armorShutters', weakPointId: 'eyeLens' },
      ],
    },
    phaseOne: ['interceptLane', 'pylonPursuitTurn'],
    phaseTwo: ['chainedInterceptTurns', 'delayedPursuitEcho'],
    overloadWeakening: 'removesDelayedEchoTurn',
    arena: { mechanicId: 'energizedInterceptLanes', anchorKinds: ['pylon', 'lane'] },
  }),
  profile({
    id: 'rubyOpticOracle',
    title: 'Ruby Optic Oracle',
    roleClue: 'precision optic',
    featured: { aspect: 'eye', moduleId: 'singleRubyLens' },
    generation: {
      archetypeId: 'shieldSentinel',
      weaponId: 'beamPrism',
      variants: [
        { bodyPlanId: 'biped', defenseId: 'armorShutters', weakPointId: 'eyeLens' },
        { bodyPlanId: 'biped', defenseId: 'guardArms', weakPointId: 'shieldHinge' },
        { bodyPlanId: 'tripod', defenseId: 'directionalShield', weakPointId: 'rearBattery' },
      ],
    },
    phaseOne: ['previewReflectedBeam', 'singleMirrorRoute'],
    phaseTwo: ['synchronizedMirrorRoutes', 'crossingReflection'],
    overloadWeakening: 'disablesSecondReflectionRoute',
    arena: { mechanicId: 'mirrorPylonRoutes', anchorKinds: ['mirrorPylon', 'beamPath'] },
    healthScale: 5.5,
  }),
  profile({
    id: 'ballisticsVizier',
    title: 'Ballistics Vizier',
    roleClue: 'ballistic prediction logic',
    featured: { aspect: 'behavior', moduleId: 'artillery' },
    generation: {
      archetypeId: 'artillery',
      weaponId: 'mortarPod',
      variants: ARTILLERY_VARIANTS,
    },
    phaseOne: ['predictedImpactGrid', 'triangulationSalvo'],
    phaseTwo: ['delayedCorrectionSalvo', 'crossGridCorrection'],
    overloadWeakening: 'removesFinalCorrectionVolley',
    arena: { mechanicId: 'triangulationObelisks', anchorKinds: ['obelisk', 'impactGrid'] },
  }),
  profile({
    id: 'revolvingFusillade',
    title: 'Revolving Fusillade',
    roleClue: 'rapid pulse barrel',
    featured: { aspect: 'weapon', moduleId: 'pulseCannon' },
    generation: {
      archetypeId: 'artillery',
      weaponId: 'pulseCannon',
      variants: ARTILLERY_VARIANTS,
    },
    phaseOne: ['rotatingPylonCrossfire', 'pulseFanSafeWedge'],
    phaseTwo: ['mobileSustainedSweep', 'counterRotatingCrossfire'],
    overloadWeakening: 'widensSafeWedge',
    arena: { mechanicId: 'rotatingCrossfirePylons', anchorKinds: ['pylon', 'safeWedge'] },
  }),
  profile({
    id: 'highAngleBastion',
    title: 'High-Angle Bastion',
    roleClue: 'high-angle launch tube',
    featured: { aspect: 'weapon', moduleId: 'mortarPod' },
    generation: {
      archetypeId: 'artillery',
      weaponId: 'mortarPod',
      variants: ARTILLERY_VARIANTS,
    },
    phaseOne: ['markedHeavyShell', 'timedCraterHazard', 'embeddedShootableShell'],
    phaseTwo: ['nearFarDoubleSalvo', 'alternatingCraterLine'],
    overloadWeakening: 'removesFarFollowupShell',
    arena: { mechanicId: 'craterSalvoField', anchorKinds: ['impactMarker', 'embeddedShell', 'crater'] },
  }),
  profile({
    id: 'clusterSalvoReliquary',
    title: 'Cluster Salvo Reliquary',
    roleClue: 'submunition sequencer',
    featured: { aspect: 'weapon', moduleId: 'clusterMortar' },
    generation: {
      archetypeId: 'artillery',
      weaponId: 'clusterMortar',
      variants: ARTILLERY_VARIANTS,
    },
    phaseOne: ['shootableChildNodes', 'fivePointLandingLattice'],
    phaseTwo: ['complementaryRotatedLattices', 'staggeredChildNodes'],
    overloadWeakening: 'removesOneLatticeArm',
    arena: { mechanicId: 'clusterLandingLattice', anchorKinds: ['childNode', 'landingPoint'] },
  }),
  profile({
    id: 'feedDrumArsenal',
    title: 'Feed-Drum Arsenal',
    roleClue: 'ammunition feed mechanism',
    featured: { aspect: 'weakPoint', moduleId: 'ammoDrum' },
    generation: {
      archetypeId: 'artillery',
      weaponId: 'pulseCannon',
      variants: [
        { bodyPlanId: 'tripod', defenseId: 'armoredCarapace', weakPointId: 'ammoDrum' },
        { bodyPlanId: 'crawler', defenseId: 'armoredCarapace', weakPointId: 'ammoDrum' },
      ],
    },
    phaseOne: ['feedBeamPatternSwitch', 'pylonAmmunitionMode'],
    phaseTwo: ['dualOverfeedLinks', 'alternatingAmmunitionFan'],
    overloadWeakening: 'limitsOverfeedToOneLink',
    arena: { mechanicId: 'feedBeamPylons', anchorKinds: ['feedPylon', 'feedBeam'] },
  }),
  profile({
    id: 'overloadReliquary',
    title: 'Overload Reliquary',
    roleClue: 'volatile burst cell',
    featured: { aspect: 'weapon', moduleId: 'overloadCore' },
    generation: {
      archetypeId: 'aerialBomber',
      weaponId: 'overloadCore',
      bossSafeOverload: true,
      variants: [
        { bodyPlanId: 'hoverBell', defenseId: 'energyMembrane', weakPointId: 'overloadCore' },
        { bodyPlanId: 'hoverBell', defenseId: 'phaseShell', weakPointId: 'eyeLens' },
        { bodyPlanId: 'flyer', defenseId: 'phaseShell', weakPointId: 'overloadCore' },
      ],
    },
    phaseOne: ['advertisedSafeSectors', 'sphericalBurst', 'floorRingBlast'],
    phaseTwo: ['concentricPulses', 'rotatingSafeSector'],
    overloadWeakening: 'removesOuterConcentricPulse',
    arena: { mechanicId: 'chargedSafeSectorPylons', anchorKinds: ['chargedPylon', 'safeSector', 'floorRing'] },
    healthScale: 7.5,
  }),
]);

const PROFILE_BY_ID = new Map(REAVERBOT_BOSS_PROFILES.map((entry) => [entry.id, entry]));
export const REAVERBOT_BOSS_PROFILE_IDS = Object.freeze(REAVERBOT_BOSS_PROFILES.map((entry) => entry.id));
const FEATURED_MATERIAL_BY_PROFILE_ID = new Map(REAVERBOT_BOSS_PROFILES.map((bossProfile) => {
  const { aspect, moduleId } = bossProfile.featured;
  const material = REAVERBOT_SALVAGE_SOURCE_MAPS[aspect]?.[moduleId] ?? null;
  return [bossProfile.id, material ? deepFreeze({ ...material, source: { aspect, moduleId } }) : null];
}));

export function getReaverbotBossProfile(profileId) {
  return PROFILE_BY_ID.get(profileId) ?? null;
}

export function normalizeBossProfileId(profileId) {
  return PROFILE_BY_ID.has(profileId) ? profileId : DEFAULT_BOSS_PROFILE_ID;
}

export function getReaverbotBossFeaturedMaterial(profileOrId) {
  const bossProfile = typeof profileOrId === 'string'
    ? getReaverbotBossProfile(profileOrId)
    : profileOrId;
  if (!bossProfile) return null;
  return FEATURED_MATERIAL_BY_PROFILE_ID.get(bossProfile.id) ?? null;
}

export const resolveBossFeaturedMaterial = getReaverbotBossFeaturedMaterial;

export function createBossExpeditionSpec({
  bossProfileId = DEFAULT_BOSS_PROFILE_ID,
  seed = 'boss-hunt',
  depth = 1,
  id = null,
} = {}) {
  const resolvedBossProfileId = normalizeBossProfileId(bossProfileId);
  const resolvedSeed = hashSeed(seed);
  const resolvedDepth = Math.max(1, Math.min(10, Math.round(Number(depth) || 1)));
  return Object.freeze({
    schemaVersion: BOSS_EXPEDITION_SCHEMA_VERSION,
    id: id == null || id === ''
      ? `boss-hunt:${resolvedBossProfileId}:${resolvedSeed.toString(16)}:${resolvedDepth}`
      : String(id),
    seed: resolvedSeed,
    depth: resolvedDepth,
    bossProfileId: resolvedBossProfileId,
  });
}

export function createBossDisplayName({ bossProfileId, seed, threatTier = 1 } = {}) {
  const bossProfile = getReaverbotBossProfile(bossProfileId);
  if (!bossProfile) return null;
  const rng = new SeededRandom(`${seed}:${bossProfile.id}:display-name`);
  const prefixes = ['OM', 'RA', 'UR', 'VA', 'ZA', 'TO', 'KA', 'MU'];
  const suffixes = ['RAK', 'GAR', 'ORA', 'VAN', 'ZUN', 'KIR', 'XEL', 'TUM'];
  const serialLimit = 9 + Math.max(1, Math.round(Number(threatTier) || 1)) * 7;
  return `${rng.pick(prefixes)}-${rng.pick(suffixes)} ${rng.int(1, serialLimit).toString().padStart(2, '0')} · ${bossProfile.title}`;
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function blendColor(color, target, amount) {
  const mix = (shift) => Math.round(
    ((color >> shift) & 0xff) * (1 - amount) + ((target >> shift) & 0xff) * amount,
  );
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

function createBossPalette(basePalette, rng) {
  const variants = [
    { id: 'paleGold', primaryMix: 0.1, secondaryMix: 0.05, trim: 0xd7bd72 },
    { id: 'buriedIvory', primaryMix: 0.16, secondaryMix: 0.08, trim: 0xc9ad68 },
    { id: 'oxidizedGold', primaryMix: 0.05, secondaryMix: 0.14, trim: 0xb9954f },
  ];
  const variant = rng.pick(variants) ?? variants[0];
  return {
    id: variant.id,
    palette: {
      ...basePalette,
      primary: blendColor(basePalette.primary, 0xc8b58c, variant.primaryMix),
      secondary: blendColor(basePalette.secondary, 0x17191a, variant.secondaryMix),
      trim: variant.trim,
    },
  };
}

function createOrnamentPlacement(rng) {
  const slots = ['crown', 'weaponCollar', 'dorsalArch', 'flankShrine', 'baseSkirt', 'shoulderFin'];
  const result = [];
  while (result.length < 3 && slots.length > 0) {
    const slot = rng.pick(slots);
    result.push(slot);
    slots.splice(slots.indexOf(slot), 1);
  }
  return result;
}

function assertBossGenerationConstraints(genome, bossProfile, variant) {
  const mismatches = [];
  if (genome.archetypeId !== bossProfile.generation.archetypeId) mismatches.push('archetype');
  if (genome.body.planId !== variant.bodyPlanId) mismatches.push('body');
  if (genome.modules.weapon.id !== bossProfile.generation.weaponId) mismatches.push('weapon');
  if (genome.modules.defense?.id !== variant.defenseId) mismatches.push('defense');
  if (genome.modules.weakPoint.id !== variant.weakPointId) mismatches.push('weak-point');
  if (mismatches.length > 0) {
    throw new Error(`Boss profile ${bossProfile.id} has incompatible pinned generation constraints: ${mismatches.join(', ')}`);
  }
}

export function generateReaverbotBossGenome({
  bossProfileId = DEFAULT_BOSS_PROFILE_ID,
  seed = 'reaverbot-boss',
  threatTier = 1,
  context = {},
} = {}) {
  const bossProfile = getReaverbotBossProfile(bossProfileId);
  if (!bossProfile) throw new Error(`Unknown Reaverbot boss profile: ${bossProfileId}`);

  const bossRng = new SeededRandom(`${seed}:${bossProfile.id}:boss`);
  const variant = bossRng.pick(bossProfile.generation.variants);
  const featuredMaterial = getReaverbotBossFeaturedMaterial(bossProfile);
  if (!variant || !featuredMaterial) {
    throw new Error(`Incomplete Reaverbot boss profile: ${bossProfile.id}`);
  }

  const genome = generateReaverbotGenome({
    ...context,
    seed: `${seed}:${bossProfile.id}:genome`,
    threatTier,
    intent: 'ranged',
    archetypeId: bossProfile.generation.archetypeId,
    bodyPlanId: variant.bodyPlanId,
    weaponId: bossProfile.generation.weaponId,
    defenseId: variant.defenseId,
    weakPointId: variant.weakPointId,
    bossSafeOverload: Boolean(bossProfile.generation.bossSafeOverload),
    bossBudgetBonus: 12,
    bossProfileId: bossProfile.id,
    isBoss: true,
    elite: false,
    encounterSize: 1,
  });
  assertBossGenerationConstraints(genome, bossProfile, variant);

  const paletteVariant = createBossPalette(genome.palette, bossRng.fork('palette'));
  const maxHealth = round(genome.stats.maxHealth * bossProfile.combat.healthScale);
  genome.name = createBossDisplayName({ bossProfileId: bossProfile.id, seed, threatTier });
  genome.bossProfileId = bossProfile.id;
  genome.visualProfileId = bossProfile.visualProfileId;
  genome.paletteId = `${genome.paletteId}:boss:${paletteVariant.id}`;
  genome.palette = paletteVariant.palette;
  genome.stats = {
    ...genome.stats,
    maxHealth,
    damage: round(genome.stats.damage * REAVERBOT_BOSS_STAT_SCALES.damage),
    armor: round(genome.stats.armor * REAVERBOT_BOSS_STAT_SCALES.armor),
    radius: round(genome.stats.radius * REAVERBOT_BOSS_STAT_SCALES.visual),
    collisionHeight: round(genome.stats.collisionHeight * REAVERBOT_BOSS_STAT_SCALES.visual),
    attackCooldown: round(genome.stats.attackCooldown * REAVERBOT_BOSS_STAT_SCALES.cooldown),
    experience: Math.round(genome.stats.experience * REAVERBOT_BOSS_STAT_SCALES.experience),
  };
  genome.modules.signaturePart = {
    id: `${bossProfile.id}:signaturePart`,
    label: `${bossProfile.title} Signature Assembly`,
    lockable: true,
    source: { ...bossProfile.featured },
    materialId: featuredMaterial.id,
    integrity: round(maxHealth * bossProfile.combat.signatureIntegrityHealthScale),
    maxIntegrity: round(maxHealth * bossProfile.combat.signatureIntegrityHealthScale),
    damageMultiplier: bossProfile.combat.signatureDirectDamageMultiplier,
    directDamageOnly: true,
    overloaded: false,
  };
  genome.boss = {
    profileId: bossProfile.id,
    visualScale: REAVERBOT_BOSS_STAT_SCALES.visual,
    paletteVariantId: paletteVariant.id,
    ornamentSeed: bossRng.fork('ornaments').seed,
    ornamentPlacement: createOrnamentPlacement(bossRng.fork('ornament-placement')),
    phase: 1,
    phaseThreshold: bossProfile.combat.phaseThreshold,
    phaseTransitionSeconds: bossProfile.combat.phaseTransitionSeconds,
    staggerScale: bossProfile.combat.staggerScale,
    healthScale: bossProfile.combat.healthScale,
    immuneToLift: true,
    immuneToOrdinaryKnockback: true,
    phaseOneMoves: [...bossProfile.combat.phaseOne],
    phaseTwoMoves: [...bossProfile.combat.phaseTwo],
    overloadWeakening: bossProfile.combat.overloadWeakening,
    arena: { ...bossProfile.arena },
    limits: { ...bossProfile.combat.limits },
    bossSafeOverload: Boolean(bossProfile.generation.bossSafeOverload),
  };
  genome.tags = [...new Set([...genome.tags, 'proceduralBoss', bossProfile.id, bossProfile.featured.moduleId])];

  const validation = validateReaverbotGenome(genome);
  if (!validation.valid) {
    const error = new Error(`Generated invalid Reaverbot boss ${bossProfile.id}: ${validation.errors.join(', ')}`);
    error.validation = validation;
    throw error;
  }
  return genome;
}
