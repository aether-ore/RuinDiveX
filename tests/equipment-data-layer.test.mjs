import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  ARM_GEAR_RECIPE_LIST,
  FIXED_ARM_CATALOG,
  GEAR_CATALOG,
  GEAR_SLOTS,
  ArmLoadout,
  GearLoadout,
  applyFabricatedRecipe,
  createDefaultArmLoadout,
  createDefaultArmsGearState,
  createDefaultGearLoadout,
  createFixedArmDescriptor,
  equipArmSlot,
  equipGearSlot,
  getEquipmentRecipeDefinition,
  getFixedArmDefinition,
  isHazardImmune,
  resolveGearEffects,
  sanitizeGearLoadout,
  unlockArm,
  unlockGear,
  unlockGearSlot,
  validateArmLoadout,
  validateArmsGearState,
  validateGearLoadout,
} from '../src/equipment/index.js';
import { REAVERBOT_SALVAGE_MATERIALS } from '../src/reaverbots/ReaverbotSalvageCatalog.js';
import { createMegaCalibrationShadow } from '../src/buster/MegaCalibrationShadow.js';
import { LootSystem } from '../src/LootSystem.js';

test('fixed arm catalog publishes exact authored weapon-local inputs', () => {
  assert.deepEqual(FIXED_ARM_CATALOG.megaBuster.combatInputs, {
    pwr: 8, eng: 6, rng: 6.9, rpd: 4.2,
  });
  assert.deepEqual(FIXED_ARM_CATALOG.laserBeamBlade.combatInputs, {
    pwr: 23, eng: 12, rng: 8.58, rpd: 1.337,
  });
  assert.equal(FIXED_ARM_CATALOG.laserBeamBlade.mechanics.areaOutput, 0.18);
  assert.deepEqual(FIXED_ARM_CATALOG.machineGunArm.combatInputs, {
    pwr: 15, eng: 24, rng: 12.17, rpd: 1.648,
  });
  assert.deepEqual(FIXED_ARM_CATALOG.cannonArm.combatInputs, {
    pwr: 28, eng: 10, rng: 11.83, rpd: 1.294,
  });
  assert.equal(FIXED_ARM_CATALOG.cannonArm.mechanics.areaOutput, 0.26);
  assert.deepEqual(FIXED_ARM_CATALOG.grenadeArm.combatInputs, {
    pwr: 26, eng: 12, rng: 11.79, rpd: 1.319,
  });
  assert.equal(FIXED_ARM_CATALOG.grenadeArm.mechanics.areaOutput, 0.25);
  assert.deepEqual(FIXED_ARM_CATALOG.missileArm.combatInputs, {
    pwr: 25, eng: 13, rng: 13.59, rpd: 1.334,
  });
  assert.deepEqual(FIXED_ARM_CATALOG.shiningLaser.combatInputs, {
    pwr: 23, eng: 14, rng: 15.7, rpd: 1.35,
  });
  assert.deepEqual(FIXED_ARM_CATALOG.liftArm.combatInputs, { rng: 1.55 });
  assert.equal(FIXED_ARM_CATALOG.liftArm.mechanics.outputEfficiency, 1.029);
  assert.deepEqual(FIXED_ARM_CATALOG.drillArm.mechanics, {
    contactRange: 1.05,
    launchRange: 7.04,
    outputEfficiency: 1.097,
    armorBreak: 0.39,
  });
  assert.ok(Object.isFrozen(FIXED_ARM_CATALOG));
  assert.ok(Object.isFrozen(FIXED_ARM_CATALOG.laserBeamBlade.combatInputs));
  assert.deepEqual(FIXED_ARM_CATALOG.laserBeamBlade.resolvedTelemetry, {
    damage: 29.9,
    energyCapacity: 12,
    effectiveRange: 2.82,
    cadence: 1.16,
    modes: ['Ground combo', 'Jump slash'],
    resourceUse: '1 Energy and 56.1% Servo Output per slash',
  });
});

test('fixed arm descriptor preserves the sword profile without random Item fields', () => {
  const descriptor = createFixedArmDescriptor('laserBeamBlade');
  assert.equal(descriptor.id, 'laserBeamBlade');
  assert.equal(descriptor.fixedArmId, 'laserBeamBlade');
  assert.equal(descriptor.type, 'swordArm');
  assert.equal(descriptor.runtimeType, 'swordArm');
  assert.equal(descriptor.profileId, 'swordArm');
  assert.equal(descriptor.weaponKind, 'melee');
  assert.deepEqual(descriptor.getStatTotals(), {
    attackDamage: 23,
    maxEnergy: 12,
    attackRange: 8.58,
    attackSpeed: 1.337,
    areaDamage: 0.18,
  });
  for (const forbidden of ['rarity', 'level', 'affixes', 'baseStats', 'powerScore', 'randomSeed', 'value']) {
    assert.equal(Object.hasOwn(descriptor, forbidden), false, forbidden);
  }
  assert.equal(Object.hasOwn(descriptor, 'getPowerScore'), false);
});

test('legacy Mega calibration compatibility no longer instantiates randomized Item APIs', () => {
  const shadow = createMegaCalibrationShadow('powerRaiser', {
    id: 'legacy-power-1',
    rarity: 'rare',
    level: 4,
    baseStats: { attackDamage: 2 },
    affixes: [{ stat: 'attackDamage', value: 0.5 }],
  });
  assert.equal(shadow.id, 'legacy-power-1');
  assert.equal(shadow.category, 'Buster Part');
  assert.deepEqual(shadow.getStatTotals(), { attackDamage: 2.5 });
  for (const forbidden of ['rarity', 'level', 'affixes', 'baseStats', 'powerScore', 'randomSeed']) {
    assert.equal(Object.hasOwn(shadow, forbidden), false, forbidden);
  }
  assert.equal(Object.hasOwn(shadow, 'getPowerScore'), false);
  assert.equal(shadow.legacySnapshot.rarity, 'rare', 'Recovery metadata remains lossless but inert.');
});

test('retired arm ids cannot resolve or spawn and legacy random-drop calls become scrap', () => {
  for (const retiredId of [
    'mineArm',
    'railBusterArm',
    'scatterBusterArm',
    'homingSeekerArm',
    'flameArm',
    'iceSprayerArm',
    'shockCoilArm',
    'shieldArm',
  ]) {
    assert.equal(getFixedArmDefinition(retiredId), null, retiredId);
    assert.equal(createFixedArmDescriptor(retiredId), null, retiredId);
  }
  const loot = new LootSystem(new THREE.Scene());
  const retiredDrop = loot.generateItem(9, { type: 'shieldArm', rarity: 'legendary' });
  assert.equal(retiredDrop.pickupKind, 'unidentifiedScrap');
  assert.equal(retiredDrop.quantity, 1);
  for (const forbidden of ['rarity', 'level', 'baseStats', 'affixes', 'powerScore']) {
    assert.equal(Object.hasOwn(retiredDrop, forbidden), false, forbidden);
  }
});

test('default arm loadout has the invariant Mega Buster and approved owned arms', () => {
  const state = createDefaultArmLoadout();
  assert.deepEqual(state.ownedArmIds, ['laserBeamBlade', 'liftArm']);
  assert.deepEqual(state.slots, {
    megaBuster: { kind: 'megaBuster' },
    special1: { kind: 'fixedArm', armId: 'laserBeamBlade' },
    special2: { kind: 'customBuster', buildId: 'build-a' },
    utility: { kind: 'fixedArm', armId: 'liftArm' },
  });
  assert.equal(validateArmLoadout(state, { knownCustomBuildIds: ['build-a'] }).valid, true);
});

test('arm ownership and slot transitions are typed, deterministic, and exclusive', () => {
  const initial = createDefaultArmLoadout();
  assert.equal(equipArmSlot(initial, 'special2', 'machineGunArm').reason, 'arm-not-owned');

  const unlocked = unlockArm(initial, 'machineGunArm');
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.changed, true);
  assert.deepEqual(unlocked.state.ownedArmIds, ['laserBeamBlade', 'machineGunArm', 'liftArm']);

  const equipped = equipArmSlot(unlocked.state, 'special2', { kind: 'fixedArm', armId: 'machineGunArm' });
  assert.equal(equipped.ok, true);
  assert.deepEqual(equipped.state.slots.special2, { kind: 'fixedArm', armId: 'machineGunArm' });
  assert.equal(equipArmSlot(equipped.state, 'utility', 'laserBeamBlade').reason, 'incompatible-slot');
  assert.equal(equipArmSlot(equipped.state, 'megaBuster', 'machineGunArm').reason, 'invariant-slot');
  assert.equal(equipArmSlot(equipped.state, 'special2', 'laserBeamBlade').reason, 'duplicate-assignment');

  const drill = unlockArm(equipped.state, 'drillArm');
  const utility = equipArmSlot(drill.state, 'utility', 'drillArm');
  assert.equal(utility.ok, true);
  assert.equal(utility.state.slots.utility.armId, 'drillArm');

  const wrapper = new ArmLoadout(utility.state);
  assert.equal(wrapper.getDescriptor('utility').type, 'drillArm');
  assert.deepEqual(wrapper.snapshot(), utility.state);
});

test('gear catalog owns one explicit typed domain per first-release item', () => {
  assert.deepEqual(GEAR_SLOTS, ['armor', 'helmet', 'mobility', 'defense', 'utility1', 'utility2']);
  assert.deepEqual(GEAR_CATALOG.reinforcedArmorFrame.effect, {
    id: 'healthDamageMultiplier', multiplier: 0.82,
  });
  assert.deepEqual(GEAR_CATALOG.gyroStabilizerHelmet.effect, {
    id: 'reactionTierReduction', tiers: 1,
  });
  assert.equal(GEAR_CATALOG.gyroStabilizerHelmet.acquisition, 'future-recovery');
  assert.deepEqual(GEAR_CATALOG.jumpSprings.effect, {
    id: 'jumpReachMultiplier', multiplier: 1.3,
  });
  assert.deepEqual(GEAR_CATALOG.barrierGenerator.effect, {
    id: 'rechargingBarrier', capacity: 40, rechargeDelay: 4.5, brokenDelay: 6, rechargePerSecond: 10,
  });
  assert.deepEqual(GEAR_CATALOG.guardProjector.effect, {
    id: 'guardProjector',
    duration: 0.7,
    parryWindow: 0.18,
    cooldown: 0.82,
    guardReduction: 0.6,
    parryReduction: 0.9,
  });
  assert.equal(GEAR_CATALOG.jetSkates.exclusiveGroup, 'locomotion-mode');
  assert.deepEqual(GEAR_CATALOG.jetSkates.effect, {
    id: 'jetSkates', windup: 0.35, acceleration: 20, maxSpeed: 18, ledgeVerticalImpulse: 2.8,
  });
  assert.deepEqual(GEAR_CATALOG.targetScanner.effect, {
    id: 'targetScanner',
    range: 18,
    lineOfSight: true,
    targetKinds: ['exposedWeakpoint', 'intactBreakableModule'],
  });
  assert.deepEqual(GEAR_CATALOG.fastSwapAdapter.effect, {
    id: 'armSwapTransition', transitionTime: 0.14, baseTransitionTime: 0.34,
  });

  for (const gear of Object.values(GEAR_CATALOG)) {
    for (const forbidden of ['rarity', 'level', 'baseStats', 'affixes', 'powerScore', 'randomSeed', 'maxRank', 'upgradeRank']) {
      assert.equal(Object.hasOwn(gear, forbidden), false, `${gear.id}.${forbidden}`);
    }
  }
  assert.ok(Object.isFrozen(GEAR_CATALOG.barrierGenerator.effect));
});

test('default gear equips only Armor while future Helmet, Jump Springs, and Defense stay locked', () => {
  const state = createDefaultGearLoadout();
  assert.equal(state.starterHelmetRetirementMigrationVersion, 1);
  assert.deepEqual(state.unlockedSlots, ['armor', 'helmet', 'mobility', 'utility1', 'utility2']);
  assert.deepEqual(state.slots, {
    armor: 'reinforcedArmorFrame',
    helmet: null,
    mobility: null,
    defense: null,
    utility1: null,
    utility2: null,
  });
  assert.deepEqual(
    state.records.filter((record) => record.unlocked).map((record) => record.gearId),
    ['reinforcedArmorFrame'],
  );
  assert.deepEqual(
    state.records.find((record) => record.gearId === 'gyroStabilizerHelmet'),
    { gearId: 'gyroStabilizerHelmet', unlocked: false },
  );
  assert.deepEqual(
    state.records.find((record) => record.gearId === 'jumpSprings'),
    { gearId: 'jumpSprings', unlocked: false },
  );
  assert.equal(validateGearLoadout(state).valid, true);
});

test('legacy starter Helmet retirement is idempotent and a later explicit unlock survives sanitization', () => {
  const legacy = createDefaultGearLoadout();
  delete legacy.starterHelmetRetirementMigrationVersion;
  legacy.records.find((record) => record.gearId === 'gyroStabilizerHelmet').unlocked = true;
  legacy.slots.helmet = 'gyroStabilizerHelmet';

  const retired = sanitizeGearLoadout(legacy);
  assert.equal(retired.starterHelmetRetirementMigrationVersion, 1);
  assert.deepEqual(
    retired.records.find((record) => record.gearId === 'gyroStabilizerHelmet'),
    { gearId: 'gyroStabilizerHelmet', unlocked: false },
  );
  assert.equal(retired.slots.helmet, null);
  assert.deepEqual(sanitizeGearLoadout(retired), retired, 'retirement must not repeat or drift');

  const unlocked = unlockGear(retired, 'gyroStabilizerHelmet');
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.changed, true);
  const equipped = equipGearSlot(unlocked.state, 'helmet', 'gyroStabilizerHelmet');
  assert.equal(equipped.ok, true);
  assert.equal(equipped.state.slots.helmet, 'gyroStabilizerHelmet');
  assert.deepEqual(sanitizeGearLoadout(equipped.state), equipped.state);
});

test('gear unlock, slot unlock, and equip transitions do not auto-equip fabricated gear', () => {
  const initial = createDefaultGearLoadout();
  assert.equal(equipGearSlot(initial, 'mobility', 'jumpSprings').reason, 'gear-locked');
  const unlockedJump = unlockGear(initial, 'jumpSprings');
  assert.equal(unlockedJump.ok, true);
  assert.equal(unlockedJump.state.slots.mobility, null);
  const equippedJump = equipGearSlot(unlockedJump.state, 'mobility', 'jumpSprings');
  assert.equal(equippedJump.ok, true);
  assert.equal(equippedJump.state.slots.mobility, 'jumpSprings');

  const unlockedBarrier = unlockGear(equippedJump.state, 'barrierGenerator');
  assert.equal(equipGearSlot(unlockedBarrier.state, 'defense', 'barrierGenerator').reason, 'slot-locked');
  const defenseSlot = unlockGearSlot(unlockedBarrier.state, 'defense');
  const equippedBarrier = equipGearSlot(defenseSlot.state, 'defense', 'barrierGenerator');
  assert.equal(equippedBarrier.ok, true);

  const wrapper = new GearLoadout(equippedBarrier.state);
  assert.equal(wrapper.get('armor').id, 'reinforcedArmorFrame');
  assert.equal(wrapper.getId('defense'), 'barrierGenerator');
  assert.equal(wrapper.getEffects().barrier.capacity, 40);
});

test('effect resolution keeps Armor, reactions, jumping, barrier, and utility domains separate', () => {
  let state = createDefaultGearLoadout();
  let effects = resolveGearEffects(state);
  assert.equal(effects.healthDamageMultiplier, 0.82);
  assert.equal(effects.reactionTierReduction, 0);
  assert.equal(effects.jumpReachMultiplier, 1);
  assert.equal(effects.defense, null);
  assert.equal(effects.armSwapTransitionTime, 0.34);

  state = equipGearSlot(
    unlockGear(state, 'gyroStabilizerHelmet').state,
    'helmet',
    'gyroStabilizerHelmet',
  ).state;
  effects = resolveGearEffects(state);
  assert.equal(effects.reactionTierReduction, 1);

  state = equipGearSlot(unlockGear(state, 'jumpSprings').state, 'mobility', 'jumpSprings').state;
  state = unlockGearSlot(unlockGear(state, 'barrierGenerator').state, 'defense').state;
  state = equipGearSlot(state, 'defense', 'barrierGenerator').state;
  effects = resolveGearEffects(state);
  assert.equal(effects.jumpReachMultiplier, 1.3);
  assert.equal(effects.barrier.capacity, 40);
  assert.equal(effects.barrier.capacity * effects.healthDamageMultiplier, 32.8);
  assert.equal(effects.barrier.capacity, 40, 'Armor must not reduce barrier capacity');

  state = unlockGear(state, 'heatResistChip').state;
  state = equipGearSlot(state, 'utility1', 'heatResistChip').state;
  state = unlockGear(state, 'fastSwapAdapter').state;
  state = equipGearSlot(state, 'utility2', 'fastSwapAdapter').state;
  effects = resolveGearEffects(state);
  assert.equal(isHazardImmune(effects, 'fireFloor'), true);
  assert.equal(isHazardImmune(effects, 'fireFloor', 'combat'), false);
  assert.equal(isHazardImmune(effects, 'enemyFireball'), false);
  assert.equal(effects.armSwapTransitionTime, 0.14);
  assert.ok(Object.isFrozen(effects));
});

test('equipping an exclusive utility automatically displaces the older conflicting module', () => {
  let state = createDefaultGearLoadout();
  state = unlockGear(state, 'jetSkates').state;
  const first = equipGearSlot(state, 'utility1', 'jetSkates');
  assert.equal(first.ok, true);
  const moved = equipGearSlot(first.state, 'utility2', 'jetSkates');
  assert.equal(moved.ok, true);
  assert.equal(moved.reason, null);
  assert.equal(moved.state.slots.utility1, null);
  assert.equal(moved.state.slots.utility2, 'jetSkates');
  assert.deepEqual(moved.displacedConflicts, [{ slot: 'utility1', gearId: 'jetSkates' }]);
});

test('sanitization and validation reject malformed persisted gear and forbidden ranks', () => {
  let state = createDefaultGearLoadout();
  state = unlockGear(state, 'jetSkates').state;
  state.slots.utility1 = 'jetSkates';
  state.slots.utility2 = 'jetSkates';
  state.records.find((record) => record.gearId === 'jumpSprings').upgradeRank = 2;
  const validation = validateGearLoadout(state);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === 'duplicate-assignment'));
  assert.ok(validation.errors.some((error) => error.code === 'exclusive-group-conflict'));
  assert.ok(validation.errors.some((error) => error.code === 'forbidden-upgrade-rank'));
  assert.equal(sanitizeGearLoadout(state).slots.utility2, null);
  assert.equal(Object.hasOwn(
    sanitizeGearLoadout(state).records.find((record) => record.gearId === 'jumpSprings'),
    'upgradeRank',
  ), false);
});

test('recipe catalog contains the exact deterministic 12-row fabrication table', () => {
  const expected = [
    ['jumpSprings', 'gear', 12, ['perfectedCompressionGreave', 'temperedJumpSpring', 'stabilizedBellyCore']],
    ['machineGunArm', 'arm', 12, ['revolvingPulseBarrel', 'ammunitionFeedDrum']],
    ['cannonArm', 'arm', 14, ['heavyServoFrame', 'threeAxisGyro', 'ancientBatteryPack']],
    ['grenadeArm', 'arm', 16, ['highAngleLaunchTube', 'ballisticsLogicChip', 'clusterBurstSequencer']],
    ['missileArm', 'arm', 18, ['behaviorChipPursuit', 'rubyOpticLens', 'vectoringRocketNozzle']],
    ['shiningLaser', 'arm', 18, ['ancientFocusPrism', 'coolingFinArray', 'ancientBatteryPack']],
    ['drillArm', 'arm', 14, ['torqueJawGear', 'heavyServoFrame', 'serratedClawGear']],
    ['guardProjector', 'gear', 14, ['metalShieldPlating', 'shieldPivotJoint', 'behaviorChipSentry']],
    ['heatResistChip', 'gear', 10, ['ceramicFlameNozzle', 'coolingFinArray']],
    ['jetSkates', 'gear', 14, ['ancientWheelGearset', 'vectoringRocketNozzle']],
    ['targetScanner', 'gear', 10, ['rubyOpticLens']],
    ['fastSwapAdapter', 'gear', 8, ['lightweightServoRod', 'aerofoilServo']],
  ];
  assert.deepEqual(
    ARM_GEAR_RECIPE_LIST.map((recipe) => [
      recipe.id,
      recipe.output.kind,
      recipe.scrapCost,
      recipe.requiredPartIds,
    ]),
    expected,
  );

  for (const [recipeId, outputKind, scrapCost, partIds] of expected) {
    const recipe = getEquipmentRecipeDefinition(recipeId);
    assert.deepEqual(recipe.output, { kind: outputKind, id: recipeId });
    assert.deepEqual(recipe.parts, Object.fromEntries(partIds.map((partId) => [partId, 1])));
    assert.deepEqual(recipe.requirements, {
      identifiedScrap: scrapCost,
      scrap: scrapCost,
      parts: Object.fromEntries(partIds.map((partId) => [partId, 1])),
    });
    assert.ok(partIds.every((partId) => REAVERBOT_SALVAGE_MATERIALS[partId]));
    assert.ok(Object.isFrozen(recipe));
    assert.ok(Object.isFrozen(recipe.requirements.parts));
  }
});

test('combined arms/gear state applies fabrication idempotently without equipping Jump Springs', () => {
  const initial = createDefaultArmsGearState();
  assert.equal(validateArmsGearState(initial, { knownCustomBuildIds: ['build-a'] }).valid, true);

  const fabricated = applyFabricatedRecipe(initial, 'jumpSprings');
  assert.equal(fabricated.ok, true);
  assert.equal(fabricated.changed, true);
  assert.deepEqual(fabricated.state.fabricatedRecipeIds, ['jumpSprings']);
  assert.deepEqual(
    fabricated.state.gear.records.find((record) => record.gearId === 'jumpSprings'),
    { gearId: 'jumpSprings', unlocked: true },
  );
  assert.equal(fabricated.state.gear.slots.mobility, null);
  assert.equal(validateArmsGearState(fabricated.state, { knownCustomBuildIds: ['build-a'] }).valid, true);

  const repeated = applyFabricatedRecipe(fabricated.state, 'jumpSprings');
  assert.equal(repeated.ok, true);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.reason, 'already-fabricated');
  assert.deepEqual(repeated.state.fabricatedRecipeIds, ['jumpSprings']);
});
