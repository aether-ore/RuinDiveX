import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import { resolveDungeonFamilyId } from '../src/DungeonFamilies.js';
import { BUSTER_RECIPE_LIST } from '../src/buster/BusterRecipeCatalog.js';
import { getEquipmentRecipesForPart } from '../src/equipment/EquipmentRecipeCatalog.js';
import {
  BOSS_EXPEDITION_SCHEMA_VERSION,
  createBossDisplayName,
  createBossExpeditionSpec,
  DEFAULT_BOSS_PROFILE_ID,
  generateReaverbotBossGenome,
  getReaverbotBossFeaturedMaterial,
  getReaverbotBossProfile,
  getReaverbotBossRewardMaterial,
  normalizeBossProfileId,
  REAVERBOT_BOSS_PROFILES,
  REAVERBOT_BOSS_PROFILE_IDS,
} from '../src/reaverbots/ReaverbotBossCatalog.js';
import { generateReaverbotGenome, validateReaverbotGenome } from '../src/reaverbots/ReaverbotGenerator.js';
import { REAVERBOT_SALVAGE_SOURCE_MAPS } from '../src/reaverbots/ReaverbotSalvageCatalog.js';

const EXPECTED_PROFILE_IDS = [
  'crucibleWarden',
  'ascensionEngine',
  'pursuitRegent',
  'rubyOpticOracle',
  'ballisticsVizier',
  'revolvingFusillade',
  'highAngleBastion',
  'clusterSalvoReliquary',
  'feedDrumArsenal',
  'overloadReliquary',
];

test('the boss catalog covers every unique named material in active Custom Buster recipes', () => {
  assert.deepEqual(REAVERBOT_BOSS_PROFILE_IDS, EXPECTED_PROFILE_IDS);
  assert.equal(REAVERBOT_BOSS_PROFILES.length, 10);
  assert.equal(new Set(REAVERBOT_BOSS_PROFILE_IDS).size, 10);

  const recipePartIds = new Set(BUSTER_RECIPE_LIST.flatMap((recipe) => recipe.requiredPartIds));
  const bossPartIds = new Set();
  for (const bossProfile of REAVERBOT_BOSS_PROFILES) {
    const material = getReaverbotBossFeaturedMaterial(bossProfile);
    assert.ok(material, `${bossProfile.id} resolves its source material`);
    assert.equal(
      material,
      getReaverbotBossFeaturedMaterial(bossProfile.id),
      'resolved material views are stable and cached by their frozen source definition',
    );
    assert.equal(material.id, REAVERBOT_SALVAGE_SOURCE_MAPS[bossProfile.featured.aspect][bossProfile.featured.moduleId].id);
    assert.deepEqual(material.source, bossProfile.featured);
    bossPartIds.add(material.id);
  }
  for (const partId of recipePartIds) {
    assert.equal(bossPartIds.has(partId), true, `${partId} has a matching source boss`);
  }
  const ascensionReward = getReaverbotBossRewardMaterial('ascensionEngine');
  assert.equal(ascensionReward?.id, 'perfectedCompressionGreave');
  assert.deepEqual(getEquipmentRecipesForPart(ascensionReward.id).map((recipe) => recipe.id), ['jumpSprings']);
});

test('the retired Magma family falls back to Industrial while its Warden remains a normal hunt', () => {
  const resolved = resolveDungeonFamilyId('magma-refinery-v1');
  assert.equal(resolved.dungeonFamilyId, 'industrial-v1');
  assert.deepEqual(resolved.fallback, {
    requestedDungeonFamilyId: 'magma-refinery-v1',
    dungeonFamilyId: 'industrial-v1',
    reason: 'retired-dungeon-family',
  });

  const expedition = createBossExpeditionSpec({
    bossProfileId: 'crucibleWarden',
    dungeonFamilyId: 'magma-refinery-v1',
    seed: 'retired-family-compatibility',
  });
  assert.equal(expedition.dungeonFamilyId, 'industrial-v1');
  assert.equal(expedition.dungeonFamilyFallback?.reason, 'retired-dungeon-family');
  assert.equal(getReaverbotBossProfile('crucibleWarden')?.environmentId, null);
  assert.equal(getReaverbotBossProfile('crucibleWarden')?.encounterControllerId, null);
  assert.equal(getReaverbotBossRewardMaterial('crucibleWarden')?.id, 'perfectedCrucibleNozzle');

  assert.equal(existsSync(new URL('../src/magma', import.meta.url)), false);
  assert.equal(existsSync(new URL('../assets/models/magma-refinery/rooms', import.meta.url)), false);
  assert.equal(existsSync(new URL('../assets/models/magma-refinery/connectors', import.meta.url)), false);
  assert.equal(existsSync(new URL('../assets/models/magma-refinery/boss/crucible-warden.glb', import.meta.url)), true);
});

test('boss profile lookup and expedition descriptors are deterministic and quarantine unknown ids', () => {
  assert.equal(DEFAULT_BOSS_PROFILE_ID, 'revolvingFusillade');
  assert.equal(getReaverbotBossProfile(DEFAULT_BOSS_PROFILE_ID)?.title, 'Revolving Fusillade');
  assert.equal(getReaverbotBossProfile('not-a-boss'), null);
  assert.equal(normalizeBossProfileId('not-a-boss'), DEFAULT_BOSS_PROFILE_ID);

  const first = createBossExpeditionSpec({
    bossProfileId: 'rubyOpticOracle',
    seed: 'campaign:expedition:4',
    depth: 5,
  });
  const repeated = createBossExpeditionSpec({
    bossProfileId: 'rubyOpticOracle',
    seed: 'campaign:expedition:4',
    depth: 5,
  });
  assert.deepEqual(first, repeated);
  assert.equal(first.schemaVersion, BOSS_EXPEDITION_SCHEMA_VERSION);
  assert.equal(first.bossProfileId, 'rubyOpticOracle');
  assert.equal(first.depth, 5);
  assert.ok(Object.isFrozen(first));

  const fallback = createBossExpeditionSpec({ bossProfileId: 'removed-profile', seed: 99, depth: 40 });
  assert.equal(fallback.bossProfileId, DEFAULT_BOSS_PROFILE_ID);
  assert.equal(fallback.depth, 10);
});

test('all constrained boss genomes are deterministic, valid, and pin their advertised source aspect', () => {
  for (const bossProfile of REAVERBOT_BOSS_PROFILES) {
    for (const seed of ['boss-seed:a', 'boss-seed:b', 'boss-seed:c']) {
      const options = { bossProfileId: bossProfile.id, seed, threatTier: 4 };
      const genome = generateReaverbotBossGenome(options);
      assert.deepEqual(genome, generateReaverbotBossGenome(options));
      assert.equal(validateReaverbotGenome(genome).valid, true, bossProfile.id);
      assert.equal(genome.bossProfileId, bossProfile.id);
      assert.equal(genome.visualProfileId, bossProfile.visualProfileId);
      assert.equal(genome.context.isBoss, true);
      assert.equal(genome.context.elite, false);
      assert.equal(genome.boss.phase, 1);
      assert.equal(genome.boss.phaseThreshold, bossProfile.combat.phaseThreshold);
      assert.equal(genome.boss.phaseTransitionSeconds, 1.1);
      assert.equal(genome.boss.staggerScale, 0.35);
      assert.equal(genome.boss.limits.projectiles, 20);
      assert.equal(genome.boss.limits.telegraphs, 12);
      assert.equal(genome.boss.limits.persistentConstructs, 8);
      assert.equal(genome.modules.signaturePart.integrity, genome.modules.signaturePart.maxIntegrity);
      assert.equal(
        genome.modules.signaturePart.maxIntegrity,
        Math.round(genome.stats.maxHealth * 0.24 * 1000) / 1000,
      );
      assert.match(genome.name, new RegExp(` · ${bossProfile.title}$`));

      const pinnedModuleId = bossProfile.featured.moduleId;
      if (bossProfile.featured.aspect === 'behavior') assert.equal(genome.archetypeId, pinnedModuleId);
      if (bossProfile.featured.aspect === 'eye') assert.equal(genome.modules.eye.id, pinnedModuleId);
      if (bossProfile.featured.aspect === 'weapon') assert.equal(genome.modules.weapon.id, pinnedModuleId);
      if (bossProfile.featured.aspect === 'weakPoint') assert.equal(genome.modules.weakPoint.id, pinnedModuleId);
    }
  }
});

test('boss scaling is applied after constrained generation without installing an elite affix', () => {
  const seed = 'scale-contract';
  const boss = generateReaverbotBossGenome({ bossProfileId: 'highAngleBastion', seed, threatTier: 3 });
  const base = generateReaverbotGenome({
    seed: `${seed}:highAngleBastion:genome`,
    threatTier: 3,
    intent: 'ranged',
    archetypeId: boss.archetypeId,
    bodyPlanId: boss.body.planId,
    weaponId: boss.modules.weapon.id,
    defenseId: boss.modules.defense.id,
    weakPointId: boss.modules.weakPoint.id,
    bossBudgetBonus: 12,
    bossProfileId: 'highAngleBastion',
    isBoss: true,
    elite: false,
    encounterSize: 1,
  });
  const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 0.001, `${actual} ~= ${expected}`);
  closeTo(boss.stats.maxHealth, base.stats.maxHealth * 6.5);
  closeTo(boss.stats.damage, base.stats.damage * 1.35);
  closeTo(boss.stats.armor, base.stats.armor * 1.25);
  closeTo(boss.stats.radius, base.stats.radius * 1.28);
  closeTo(boss.stats.collisionHeight, base.stats.collisionHeight * 1.28);
  closeTo(boss.stats.attackCooldown, base.stats.attackCooldown * 0.9);
  assert.equal(boss.stats.experience, Math.round(base.stats.experience * 6));
  assert.equal(boss.context.elite, false);
});

test('the Overload Reliquary uses a nonterminal boss-safe core while ordinary Overload remains unchanged', () => {
  const boss = generateReaverbotBossGenome({
    bossProfileId: 'overloadReliquary',
    seed: 'safe-overload',
    threatTier: 5,
  });
  assert.equal(boss.archetypeId, 'aerialBomber');
  assert.equal(boss.modules.weapon.id, 'overloadCore');
  assert.equal(boss.modules.weapon.attackKind, 'bossOverload');
  assert.equal(boss.modules.weapon.bossSafe, true);
  assert.ok(!boss.modules.weapon.tags.includes('selfDestruct'));
  assert.equal(validateReaverbotGenome(boss).valid, true);

  const ordinary = generateReaverbotGenome({
    seed: 'ordinary-overload',
    threatTier: 3,
    archetypeId: 'aerialBomber',
    encounterSize: 2,
  });
  assert.equal(ordinary.modules.weapon.attackKind, 'selfDestruct');
  assert.ok(ordinary.modules.weapon.tags.includes('selfDestruct'));
  assert.equal(ordinary.bossProfileId, undefined);
  assert.equal(ordinary.boss, undefined);
});

test('seeded boss variation changes presentation while preserving each featured module', () => {
  const bodyVariants = new Set();
  const paletteVariants = new Set();
  const ornaments = new Set();
  for (let index = 0; index < 48; index += 1) {
    const genome = generateReaverbotBossGenome({
      bossProfileId: 'revolvingFusillade',
      seed: `variant:${index}`,
      threatTier: 4,
    });
    assert.equal(genome.modules.weapon.id, 'pulseCannon');
    bodyVariants.add(genome.body.planId);
    paletteVariants.add(genome.boss.paletteVariantId);
    ornaments.add(genome.boss.ornamentPlacement.join(':'));
  }
  assert.ok(bodyVariants.size >= 2);
  assert.ok(paletteVariants.size >= 2);
  assert.ok(ornaments.size >= 3);
});

test('display names keep a stable functional epithet and generation rejects unknown profiles', () => {
  const first = createBossDisplayName({ bossProfileId: 'pursuitRegent', seed: 'serial', threatTier: 6 });
  assert.equal(first, createBossDisplayName({ bossProfileId: 'pursuitRegent', seed: 'serial', threatTier: 6 }));
  assert.match(first, /^[A-Z]{2}-[A-Z]{3} \d{2} · Pursuit Regent$/);
  assert.equal(createBossDisplayName({ bossProfileId: 'missing', seed: 'serial' }), null);
  assert.throws(
    () => generateReaverbotBossGenome({ bossProfileId: 'missing', seed: 'serial' }),
    /Unknown Reaverbot boss profile/,
  );
});
