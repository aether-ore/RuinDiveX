import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUSTER_BALANCE_SEARCH,
  BUSTER_MODULE_KINDS,
  BUSTER_MODULE_LIST,
  BUSTER_RULESET_VERSION,
  BUSTER_SCHEMA_VERSION,
  CUSTOM_BUSTER_RULESET,
  MEGA_BUSTER_BASE_PROFILE,
  MEGA_BUSTER_CALIBRATION_CATALOG,
} from '../src/buster/catalog.js';
import { BUSTER_RECIPE_LIST } from '../src/buster/BusterRecipeCatalog.js';
import { compileBusterBuild, compileMegaBusterPlan } from '../src/buster/compiler.js';
import { BusterRuntime } from '../src/buster/BusterRuntime.js';
import {
  BUSTER_PROJECTILE_EVENT_EPSILON,
  BUSTER_PROJECTILE_GUIDANCE_STEP,
  BUSTER_PROJECTILE_MAX_EVENTS_PER_FRAME,
  findStraightBusterCapsuleHitFraction,
} from '../src/buster/BusterProjectileKernel.js';
import {
  getBallisticApexProgress,
  getClusterDirections,
  getSpreadDirections,
  sampleBallisticPath,
} from '../src/buster/BusterTrajectory.js';
import { ARM_GEAR_RECIPE_LIST } from '../src/equipment/EquipmentRecipeCatalog.js';
import {
  GEAR_LIST,
  GEAR_SLOT_CATALOG,
} from '../src/equipment/GearCatalog.js';
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
} from '../src/reaverbots/ReaverbotCatalog.js';
import {
  createEncounterSlotSeed,
  generateReaverbotGenome,
  getReaverbotCatalogSummary,
} from '../src/reaverbots/ReaverbotGenerator.js';
import {
  createReaverbotSalvageProfile,
  REAVERBOT_BOSS_SALVAGE,
  REAVERBOT_SALVAGE_ASPECTS,
  REAVERBOT_SALVAGE_MATERIALS,
  REAVERBOT_SALVAGE_SOURCE_MAPS,
} from '../src/reaverbots/ReaverbotSalvageCatalog.js';
import {
  BOSS_EXPEDITION_SCHEMA_VERSION,
  DEFAULT_BOSS_PROFILE_ID,
  generateReaverbotBossGenome,
  REAVERBOT_BOSS_LIMITS,
  REAVERBOT_BOSS_PROFILES,
  REAVERBOT_BOSS_STAT_SCALES,
} from '../src/reaverbots/ReaverbotBossCatalog.js';

const CONTRACT_VERSION = 1;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = path.join(
  REPOSITORY_ROOT,
  'assets',
  'contracts',
  `ruin-crawler-contracts.v${CONTRACT_VERSION}.json`,
);

function entriesByKey(record) {
  return Object.entries(record ?? {}).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
}

function catalogEntries(record) {
  return entriesByKey(record).map(([id, definition]) => ({
    ...definition,
    id: definition?.id ?? id,
  }));
}

function keyedValues(record, keyName = 'id') {
  return entriesByKey(record).map(([key, value]) => ({
    [keyName]: key,
    ...(value && typeof value === 'object' && !Array.isArray(value) ? value : { value }),
  }));
}

function weightedEntries(record, groupName, valueName) {
  return entriesByKey(record).map(([groupId, values]) => ({
    [groupName]: groupId,
    weights: (values ?? []).map(([valueId, weight]) => ({ [valueName]: valueId, weight })),
  }));
}

function ingredientEntries(record) {
  return entriesByKey(record).map(([materialId, quantity]) => ({ materialId, quantity }));
}

function normalizeRecipe(recipe) {
  const normalized = {
    ...recipe,
    parts: ingredientEntries(recipe.parts),
  };
  if (recipe.partRequirements) {
    normalized.partRequirements = ingredientEntries(recipe.partRequirements);
  }
  if (recipe.requirements) {
    normalized.requirements = {
      ...recipe.requirements,
      parts: ingredientEntries(recipe.requirements.parts),
    };
  }
  return normalized;
}

function createBusterBuildFixture({ id, tuning, nodes, edges }) {
  return {
    schemaVersion: BUSTER_SCHEMA_VERSION,
    rulesetVersion: BUSTER_RULESET_VERSION,
    buildId: id,
    chassisId: `fixture:${id}:chassis`,
    tuning,
    program: {
      rootNodeId: nodes[0]?.nodeId ?? null,
      nodes: nodes.map((entry) => ({
        ...entry,
        moduleInstanceId: entry.moduleInstanceId ?? `fixture:${id}:${entry.nodeId}`,
      })),
      edges,
    },
  };
}

function summarizeFireResult(result) {
  if (!result?.ok) return { ok: false, reason: result?.reason ?? 'UNKNOWN' };
  return {
    ok: true,
    executionId: result.execution.executionId,
    reservationToken: result.execution.reservationToken,
    weaponKey: result.execution.weaponKey,
    buildId: result.execution.buildId,
    buildRevision: result.execution.buildRevision,
  };
}

function createBusterRuntimeTranscript(plan) {
  const runtime = new BusterRuntime({ executeShot: () => true });
  runtime.equip(plan);
  const transcript = [{ event: 'equip', hud: runtime.getHudState() }];

  for (let shotIndex = 1; shotIndex <= 3; shotIndex += 1) {
    const result = runtime.fire({ fixtureShot: shotIndex });
    transcript.push({
      event: 'fire',
      shotIndex,
      result: summarizeFireResult(result),
      hud: runtime.getHudState(),
    });
    if (result.ok) runtime.releaseReservation(result.execution.reservationToken);
    runtime.update(0.25, { activeWeaponKey: plan.weaponKey });
    transcript.push({ event: 'update', seconds: 0.25, hud: runtime.getHudState() });
  }

  transcript.push({
    event: 'fire-empty',
    result: summarizeFireResult(runtime.fire({ fixtureShot: 4 })),
    hud: runtime.getHudState(),
  });
  runtime.update(0.65, { activeWeaponKey: plan.weaponKey });
  transcript.push({ event: 'update', seconds: 0.65, hud: runtime.getHudState() });
  runtime.update(1.8, { activeWeaponKey: plan.weaponKey });
  transcript.push({ event: 'update', seconds: 1.8, hud: runtime.getHudState() });
  return transcript;
}

function createBusterFixtures() {
  const neutralPulseSource = createBusterBuildFixture({
    id: 'unity-neutral-pulse',
    tuning: { power: 4, energy: 4, range: 4, rapid: 4 },
    nodes: [{ nodeId: 'pulse', moduleId: 'pulseBolt' }],
    edges: [],
  });
  const apexClusterSource = createBusterBuildFixture({
    id: 'unity-apex-cluster',
    tuning: { power: 6, energy: 4, range: 3, rapid: 3 },
    nodes: [
      { nodeId: 'mortar', moduleId: 'mortarShell' },
      { nodeId: 'apex', moduleId: 'atApex' },
      { nodeId: 'cluster', moduleId: 'cluster5' },
      { nodeId: 'explosion', moduleId: 'explosion' },
    ],
    edges: [
      { from: 'mortar', port: 'next', to: 'apex' },
      { from: 'apex', port: 'child', to: 'cluster' },
      { from: 'cluster', port: 'next', to: 'explosion' },
    ],
  });
  const megaPlan = compileMegaBusterPlan({}, { revision: 0 });

  return {
    compiledPlans: [
      {
        id: 'neutral-pulse',
        source: neutralPulseSource,
        plan: compileBusterBuild(neutralPulseSource, { revision: 3 }),
      },
      {
        id: 'apex-cluster-explosion',
        source: apexClusterSource,
        plan: compileBusterBuild(apexClusterSource, { revision: 7 }),
      },
      { id: 'neutral-mega-buster', source: megaPlan.sourceBuild, plan: megaPlan },
    ],
    runtime: [{
      id: 'neutral-mega-battery',
      transcript: createBusterRuntimeTranscript(megaPlan),
    }],
    trajectory: [
      {
        id: 'spread-three-forward',
        samples: getSpreadDirections({ x: 0, y: 0, z: 1 }, [-0.14, 0, 0.14]),
      },
      {
        id: 'cluster-five-forward',
        samples: getClusterDirections({ x: 0, y: 0, z: 1 }, 5),
      },
      {
        id: 'ballistic-arc',
        apexProgress: getBallisticApexProgress({
          start: { x: -1.25, y: 1.4, z: 2.5 },
          end: { x: 4.75, y: 0.6, z: 9.25 },
          arcHeight: 3.2,
        }),
        samples: sampleBallisticPath({
          start: { x: -1.25, y: 1.4, z: 2.5 },
          end: { x: 4.75, y: 0.6, z: 9.25 },
          arcHeight: 3.2,
          segments: 8,
        }),
      },
    ],
    collision: [{
      id: 'asymmetric-straight-capsule-hit',
      start: { x: -4.25, y: 1.1, z: -2.5 },
      end: { x: 3.75, y: 1.1, z: 6.5 },
      target: { position: { x: 1.2, y: 0, z: 3.45 }, radius: 0.7, collisionHeight: 2.4 },
      projectileRadius: 0.18,
      hitFraction: findStraightBusterCapsuleHitFraction(
        { x: -4.25, y: 1.1, z: -2.5 },
        { x: 3.75, y: 1.1, z: 6.5 },
        { position: { x: 1.2, y: 0, z: 3.45 }, radius: 0.7, collisionHeight: 2.4 },
        0.18,
      ),
    }],
  };
}

function createReaverbotFixtures() {
  const cases = [
    {
      id: 'tier-one-balanced',
      options: { seed: 'unity-contract:balanced:0', threatTier: 1, intent: 'any' },
    },
    {
      id: 'tier-three-fast-pack',
      options: {
        seed: 'unity-contract:fast-pack:2',
        threatTier: 3,
        intent: 'fast',
        encounterSize: 4,
        roomArchetypeId: 'reaverbot_nest',
        behaviorModifiers: ['aggressive pack'],
      },
    },
    {
      id: 'tier-four-artillery',
      options: { seed: 'unity-contract:artillery:5', threatTier: 4, intent: 'ranged' },
    },
  ];

  return {
    encounterSlotSeeds: [{
      runSeed: 'unity-contract-run',
      encounterId: 'nest-alpha',
      slotIndex: 2,
      result: createEncounterSlotSeed('unity-contract-run', 'nest-alpha', 2),
    }],
    genomes: cases.map(({ id, options }) => {
      const genome = generateReaverbotGenome(options);
      return { id, options, genome, salvageProfile: createReaverbotSalvageProfile(genome) };
    }),
    bossGenomes: [{
      id: 'revolving-fusillade',
      options: {
        bossProfileId: DEFAULT_BOSS_PROFILE_ID,
        seed: 'unity-contract:boss:0',
        threatTier: 3,
      },
      genome: generateReaverbotBossGenome({
        bossProfileId: DEFAULT_BOSS_PROFILE_ID,
        seed: 'unity-contract:boss:0',
        threatTier: 3,
      }),
    }],
  };
}

export function buildUnityContractPack() {
  const reaverbotSummary = getReaverbotCatalogSummary();
  return {
    contractVersion: CONTRACT_VERSION,
    source: {
      project: 'ruin-digger-prototype',
      authority: 'live Three.js catalogs and deterministic pure kernels',
      coordinateConversion: {
        threeToUnityPosition: 'Unity=(-ThreeX, ThreeY, ThreeZ)',
        invertYaw: true,
      },
      omissions: [
        'Runtime functions, classes, callbacks, Three.js scene objects, materials, textures, and mutable caches are not contract data.',
        'Random salvage rolls are not golden fixtures because they accept caller-owned random functions; deterministic salvage profiles are included with generated genomes.',
      ],
    },
    buster: {
      schemaVersion: BUSTER_SCHEMA_VERSION,
      rulesetVersion: BUSTER_RULESET_VERSION,
      ruleset: {
        ...CUSTOM_BUSTER_RULESET,
        balanceSearch: keyedValues(BUSTER_BALANCE_SEARCH, 'parameter'),
      },
      modules: [...BUSTER_MODULE_LIST],
      moduleKinds: entriesByKey(BUSTER_MODULE_KINDS).map(([kind, modules]) => ({
        kind,
        moduleIds: modules.map((module) => module.id),
      })),
      megaBusterBaseProfile: MEGA_BUSTER_BASE_PROFILE,
      megaBusterCalibrations: catalogEntries(MEGA_BUSTER_CALIBRATION_CATALOG),
      projectileKernel: {
        eventEpsilon: BUSTER_PROJECTILE_EVENT_EPSILON,
        guidanceStep: BUSTER_PROJECTILE_GUIDANCE_STEP,
        maxEventsPerFrame: BUSTER_PROJECTILE_MAX_EVENTS_PER_FRAME,
      },
    },
    reaverbots: {
      schemaVersion: reaverbotSummary.schemaVersion,
      eyeColor: REAVERBOT_EYE_COLOR,
      archetypes: catalogEntries(REAVERBOT_ARCHETYPES),
      bodyPlans: catalogEntries(REAVERBOT_BODY_PLANS),
      chargeModules: catalogEntries(REAVERBOT_CHARGE_MODULES),
      weapons: catalogEntries(REAVERBOT_WEAPONS),
      defenses: catalogEntries(REAVERBOT_DEFENSES),
      weakPoints: catalogEntries(REAVERBOT_WEAK_POINTS),
      palettes: catalogEntries(REAVERBOT_PALETTES),
      intentArchetypeWeights: weightedEntries(
        INTENT_ARCHETYPE_WEIGHTS,
        'intent',
        'archetypeId',
      ),
      linkedWeakPointWeights: weightedEntries(
        LINKED_WEAK_POINT_WEIGHTS,
        'weaponId',
        'weakPointId',
      ),
    },
    salvage: {
      aspects: catalogEntries(REAVERBOT_SALVAGE_ASPECTS),
      sourceMaps: entriesByKey(REAVERBOT_SALVAGE_SOURCE_MAPS).map(([aspect, sourceMap]) => ({
        aspect,
        sources: entriesByKey(sourceMap).map(([moduleId, material]) => ({
          moduleId,
          materialId: material.id,
        })),
      })),
      materials: catalogEntries(REAVERBOT_SALVAGE_MATERIALS),
      bossOnlyMaterialIds: catalogEntries(REAVERBOT_BOSS_SALVAGE).map((material) => material.id),
    },
    recipes: {
      buster: BUSTER_RECIPE_LIST.map(normalizeRecipe),
      equipment: ARM_GEAR_RECIPE_LIST.map(normalizeRecipe),
    },
    equipment: {
      gearSlots: catalogEntries(GEAR_SLOT_CATALOG),
      fixedGearEffects: [...GEAR_LIST],
    },
    bosses: {
      expeditionSchemaVersion: BOSS_EXPEDITION_SCHEMA_VERSION,
      defaultProfileId: DEFAULT_BOSS_PROFILE_ID,
      statScales: REAVERBOT_BOSS_STAT_SCALES,
      limits: REAVERBOT_BOSS_LIMITS,
      profiles: [...REAVERBOT_BOSS_PROFILES],
    },
    fixtures: {
      buster: createBusterFixtures(),
      reaverbots: createReaverbotFixtures(),
    },
  };
}

function canonicalizeJson(value, location = '$', ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${location} contains a non-finite number.`);
    return value;
  }
  if (value === undefined) throw new TypeError(`${location} is undefined.`);
  if (typeof value !== 'object') {
    throw new TypeError(`${location} contains non-JSON value ${typeof value}.`);
  }
  if (ancestors.has(value)) throw new TypeError(`${location} contains a circular reference.`);

  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((entry, index) => {
      const normalized = canonicalizeJson(entry, `${location}[${index}]`, ancestors);
      if (normalized === undefined) throw new TypeError(`${location}[${index}] is undefined.`);
      return normalized;
    });
  } else {
    result = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = canonicalizeJson(value[key], `${location}.${key}`, ancestors);
      result[key] = normalized;
    }
  }
  ancestors.delete(value);
  return result;
}

export function serializeUnityContractPack(pack = buildUnityContractPack()) {
  return `${JSON.stringify(canonicalizeJson(pack), null, 2)}\n`;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const output = serializeUnityContractPack();

  if (checkOnly) {
    let current = null;
    try {
      current = await readFile(OUTPUT_PATH, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (current !== output) {
      console.error(`Unity contract pack is stale or missing: ${path.relative(REPOSITORY_ROOT, OUTPUT_PATH)}`);
      console.error('Run npm run export:unity-contracts and commit the generated JSON.');
      process.exitCode = 1;
      return;
    }
    console.log(`Unity contract pack is current: ${path.relative(REPOSITORY_ROOT, OUTPUT_PATH)}`);
    return;
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, output, 'utf8');
  console.log(`Wrote ${path.relative(REPOSITORY_ROOT, OUTPUT_PATH)}`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}
