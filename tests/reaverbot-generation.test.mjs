import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createEncounterSlotSeed,
  generateReaverbotGenome,
  getReaverbotCatalogSummary,
  validateReaverbotGenome,
} from '../src/reaverbots/ReaverbotGenerator.js';
import {
  LINKED_WEAK_POINT_WEIGHTS,
  REAVERBOT_ARCHETYPES,
  REAVERBOT_BODY_PLANS,
  REAVERBOT_CHARGE_MODULES,
  REAVERBOT_DEFENSES,
  REAVERBOT_EYE_COLOR,
  REAVERBOT_WEAK_POINTS,
  REAVERBOT_WEAPONS,
} from '../src/reaverbots/ReaverbotCatalog.js';
import {
  AUTHORED_RUIN_SALVAGE,
  createReaverbotSalvageProfile,
  REAVERBOT_BOSS_SALVAGE,
  REAVERBOT_SALVAGE_MATERIALS,
  REAVERBOT_SALVAGE_SOURCE_MAPS,
  rollReaverbotSalvageDrops,
} from '../src/reaverbots/ReaverbotSalvageCatalog.js';
import {
  animateReaverbotVisual,
  createReaverbotVisual,
  setReaverbotDefenseVisualActive,
} from '../src/reaverbots/ReaverbotVisualFactory.js';
import { Inventory } from '../src/Inventory.js';
import { RollSalvageStorage } from '../src/RollSalvageStorage.js';

test('the same seed and context reproduce the same Reaverbot genome', () => {
  const options = {
    seed: 'nest:slot:2',
    threatTier: 3,
    intent: 'fast',
    encounterSize: 4,
    roomArchetypeId: 'mechanicalNest',
    behaviorModifiers: ['aggressive pack'],
  };
  assert.deepEqual(generateReaverbotGenome(options), generateReaverbotGenome(options));
});

test('body defense normalization preserves legacy candidate silhouettes and validates in two stages', () => {
  const snapshots = [
    {
      options: { seed: 'aerial-hardening:captive', archetypeId: 'pursuer' },
      expected: {
        candidateIndex: 1,
        bodyPlan: 'quadruped',
        weaponId: 'rocketLance',
        mountSide: null,
        proportions: {
          overallScale: 1.0761,
          torsoWidth: 0.997,
          torsoLength: 0.9827,
          limbLength: 1.0835,
          headScale: 0.9206,
          spikeCount: 4,
          panelRhythm: 3,
          asymmetry: 0.1603,
        },
        radius: 0.699,
        collisionHeight: 1.668,
      },
    },
    {
      options: { seed: 'legacy-nonquad-ram:6', archetypeId: 'pursuer' },
      expected: {
        candidateIndex: 5,
        bodyPlan: 'lowBiped',
        weaponId: 'rocketLance',
        mountSide: null,
        proportions: {
          overallScale: 0.9796,
          torsoWidth: 1.1115,
          torsoLength: 0.966,
          limbLength: 1.1009,
          headScale: 0.9131,
          spikeCount: 1,
          panelRhythm: 2,
          asymmetry: 0.0891,
        },
        radius: 0.5,
        collisionHeight: 2.106,
      },
    },
  ];

  for (const { options, expected } of snapshots) {
    const genome = generateReaverbotGenome(options);
    assert.deepEqual({
      candidateIndex: genome.candidateIndex,
      bodyPlan: genome.body.planId,
      weaponId: genome.modules.weapon.id,
      mountSide: genome.modules.weapon.mountSide ?? null,
      proportions: genome.body.proportions,
      radius: genome.stats.radius,
      collisionHeight: genome.stats.collisionHeight,
    }, expected);
  }

  const normalized = generateReaverbotGenome(snapshots[0].options);
  const pending = structuredClone(normalized);
  pending.modules.defense = structuredClone(REAVERBOT_DEFENSES.armoredSkull);
  pending.modules.weakPoint = structuredClone(REAVERBOT_WEAK_POINTS.rearBattery);
  pending.behavior.exposureDuration = Number(Math.max(
    0.7,
    pending.behavior.recoveryDuration * 0.78,
  ).toFixed(3));
  pending.threat.spent -= REAVERBOT_DEFENSES.armorShutters.threatCost
    - REAVERBOT_DEFENSES.armoredSkull.threatCost;
  pending.tags = [
    'pursuer',
    'chaser',
    ...pending.body.tags,
    ...pending.modules.weapon.tags,
    ...pending.modules.defense.tags,
  ].filter((tag, index, tags) => tags.indexOf(tag) === index);

  const strictPending = validateReaverbotGenome(pending);
  assert.ok(strictPending.errors.includes('quadruped-eyelid-defense-required'));
  assert.ok(strictPending.errors.includes('quadruped-eye-weak-point-required'));
  assert.equal(
    validateReaverbotGenome(pending, { allowPendingBodyDefenseOverride: true }).valid,
    true,
  );
  assert.equal(validateReaverbotGenome(normalized).valid, true);
  assert.equal(normalized.modules.defense.id, 'armorShutters');
  assert.equal(normalized.modules.weakPoint.id, 'eyeLens');
  assert.equal(normalized.threat.spent, pending.threat.spent + 1);
  assert.ok(normalized.tags.includes('shutters'));
  assert.equal(normalized.tags.includes('frontArmor'), false);
  assert.equal(
    normalized.behavior.exposureDuration,
    Number(Math.max(
      0.65,
      normalized.behavior.telegraphDuration + normalized.behavior.commitDuration * 0.45,
    ).toFixed(3)),
  );
});

test('a broad seed sweep always satisfies the gameplay contract', () => {
  const archetypes = new Set();
  const bodyPlans = new Set();
  const weapons = new Set();
  const defenses = new Set();
  const weakPoints = new Set();

  for (let seed = 0; seed < 1000; seed += 1) {
    const genome = generateReaverbotGenome({
      seed,
      threatTier: 1 + (seed % 5),
      intent: 'any',
      encounterSize: 4,
    });
    const validation = validateReaverbotGenome(genome);
    assert.equal(validation.valid, true, `seed ${seed}: ${validation.errors.join(', ')}`);
    assert.equal(genome.schemaVersion, 3);
    assert.equal(genome.modules.eye.color, REAVERBOT_EYE_COLOR);
    assert.ok(genome.modules.weapon.id);
    assert.ok(genome.modules.weakPoint.id);
    if (genome.modules.weapon.id === 'clawArm') {
      assert.equal(genome.modules.defense, null);
      assert.equal(genome.modules.weakPoint.id, 'clawPalm');
    } else {
      assert.ok(genome.modules.defense?.id);
      assert.ok(
        (LINKED_WEAK_POINT_WEIGHTS[genome.modules.defense.id] ?? [])
          .some(([weakPointId]) => weakPointId === genome.modules.weakPoint.id),
        `seed ${seed}: defense ${genome.modules.defense.id} must protect ${genome.modules.weakPoint.id}`,
      );
      defenses.add(genome.modules.defense.id);
    }
    if (genome.body.planId === 'quadruped' && genome.modules.weapon.id !== 'clawArm') {
      assert.equal(genome.modules.defense.id, 'armorShutters');
      assert.equal(genome.modules.weakPoint.id, 'eyeLens');
    }
    if (genome.modules.weakPoint.id === 'legJoint') {
      assert.equal(genome.modules.defense.id, 'sidePlates');
      assert.ok(genome.modules.weakPoint.radius >= 0.24);
      assert.equal(genome.modules.weakPoint.exposure, 'recovery');
    }
    assert.ok(genome.behavior.exposureDuration >= 0.6);
    assert.ok(genome.threat.spent <= genome.threat.budget);
    archetypes.add(genome.archetypeId);
    bodyPlans.add(genome.body.planId);
    weapons.add(genome.modules.weapon.id);
    weakPoints.add(genome.modules.weakPoint.id);
  }

  const catalog = getReaverbotCatalogSummary();
  assert.equal(catalog.schemaVersion, 3);
  assert.deepEqual([...archetypes].sort(), [...catalog.archetypes].sort());
  assert.deepEqual([...bodyPlans].sort(), [...catalog.bodyPlans].sort());
  assert.ok(weapons.size >= 10);
  assert.ok(defenses.size >= 9);
  assert.ok(weakPoints.size >= 8);
});

test('charge genomes mount morphology-specific rocket rigs and never expose the removed ram part', () => {
  assert.equal(REAVERBOT_WEAPONS.ramHorn, undefined);
  assert.equal(REAVERBOT_SALVAGE_MATERIALS.impactHorn, undefined);
  const samples = new Map();
  for (const archetypeId of ['pursuer', 'rotorHunter']) {
    for (let variant = 0; variant < 600; variant += 1) {
      const genome = generateReaverbotGenome({
        seed: `rocket-rig:${archetypeId}:${variant}`,
        archetypeId,
        encounterSize: 4,
      });
      if (genome.modules.weapon.attackKind !== 'charge') continue;
      samples.set(genome.body.planId, genome);
      if (['quadruped', 'lowBiped', 'tripod', 'hoverBell'].every((id) => samples.has(id))) break;
    }
  }

  for (const planId of ['quadruped', 'lowBiped', 'tripod', 'hoverBell']) {
    assert.ok(samples.has(planId), `missing charge sample for ${planId}`);
  }

  for (const [planId, genome] of samples) {
    const expectedModule = planId === 'quadruped'
      ? 'spineJet'
      : planId === 'hoverBell'
        ? 'vectorRocket'
        : 'twinRocketPack';
    assert.equal(genome.modules.charge.id, expectedModule);
    assert.ok(genome.modules.charge.tags.includes('rocket'));
    assert.equal(validateReaverbotGenome(genome).valid, true);

    const visual = createReaverbotVisual(genome);
    assert.equal(visual.chargeModule.id, expectedModule);
    assert.equal(visual.chargeModule.nozzles.length, expectedModule === 'twinRocketPack' ? 2 : 1);
    assert.equal(visual.root.getObjectByName('generatedRamHornArmorFace'), undefined);
    animateReaverbotVisual(visual, {
      time: 1,
      dt: 0.1,
      state: 'commit',
      stateProgress: 0.45,
      attackKind: 'charge',
      chargeDirection: new THREE.Vector3(0, 0.35, 1).normalize(),
    });
    assert.ok(visual.chargeModule.flames.every((flame) => flame.visible));
    if (expectedModule === 'vectorRocket') {
      assert.ok(Math.abs(visual.chargeModule.gimbal.rotation.x) > 0.02, 'aerial rocket must gimbal into vertical travel');
    }
    if (expectedModule === 'twinRocketPack' && planId !== 'tripod') {
      const podOffsets = visual.chargeModule.group.children
        .filter((child) => child.name.includes('Jetpack') && child.name.endsWith('Assembly'))
        .map((child) => Math.abs(child.position.x));
      assert.equal(podOffsets.length, 2);
      assert.ok(podOffsets.every((offset) => offset >= 0.45), 'jetpack must leave the rear battery sightline clear');
    }
    animateReaverbotVisual(visual, {
      time: 1.1,
      dt: 0.1,
      state: 'recovery',
      stateProgress: 0.2,
      attackKind: 'charge',
    });
    assert.ok(visual.chargeModule.flames.every((flame) => !flame.visible));

    const missingCharge = structuredClone(genome);
    missingCharge.modules.charge = null;
    assert.ok(validateReaverbotGenome(missingCharge).errors.includes('charge-module-required'));

    const mismatchedCharge = structuredClone(genome);
    mismatchedCharge.modules.charge = structuredClone(
      expectedModule === 'spineJet'
        ? REAVERBOT_CHARGE_MODULES.twinRocketPack
        : REAVERBOT_CHARGE_MODULES.spineJet,
    );
    const expectedError = expectedModule === 'spineJet'
      ? 'quadruped-spine-jet-required'
      : expectedModule === 'vectorRocket'
        ? 'aerial-vector-rocket-required'
        : 'back-rocket-pack-required';
    assert.ok(validateReaverbotGenome(mismatchedCharge).errors.includes(expectedError));
  }

  const nonCharge = generateReaverbotGenome({
    seed: 'rocket-rig:non-charge-contract',
    archetypeId: 'pouncer',
    encounterSize: 4,
  });
  nonCharge.modules.charge = structuredClone(REAVERBOT_CHARGE_MODULES.twinRocketPack);
  assert.ok(validateReaverbotGenome(nonCharge).errors.includes('charge-module-on-non-charge'));
});

test('rocket chargers can rarely recover either visible boost assembly without yielding multiple parts', () => {
  let charger = null;
  for (let variant = 0; variant < 300 && !charger; variant += 1) {
    const candidate = generateReaverbotGenome({
      seed: `rocket-salvage:${variant}`,
      archetypeId: 'pursuer',
      encounterSize: 4,
    });
    if (candidate.modules.weapon.attackKind === 'charge') charger = candidate;
  }
  assert.ok(charger);

  const sequenceRandom = (values) => {
    let index = 0;
    return () => values[index++] ?? values.at(-1);
  };
  const weaponDrop = rollReaverbotSalvageDrops(charger, {
    random: sequenceRandom([0, 0.4]),
  });
  assert.equal(weaponDrop.length, 1);
  assert.equal(weaponDrop[0].id, 'rocketBoostCoupler');
  assert.equal(weaponDrop[0].source.aspect, 'weapon');

  const chargeDrop = rollReaverbotSalvageDrops(charger, {
    random: sequenceRandom([0, 0.55]),
  });
  assert.equal(chargeDrop.length, 1);
  assert.equal(chargeDrop[0].source.aspect, 'charge');
  assert.equal(chargeDrop[0].source.moduleId, charger.modules.charge.id);

  assert.deepEqual(rollReaverbotSalvageDrops(charger, { random: () => 0.999 }), []);
});

test('solo pack hunters remain valid while dependent controllers and self-destructors protect progression', () => {
  let weightedSoloPackHunters = 0;
  for (let seed = 0; seed < 250; seed += 1) {
    const solo = generateReaverbotGenome({ seed, intent: 'any', encounterSize: 1 });
    if (solo.archetypeId === 'packHunter') weightedSoloPackHunters += 1;

    const carrier = generateReaverbotGenome({
      seed,
      intent: 'any',
      encounterSize: 4,
      keycardCarrier: true,
    });
    assert.notEqual(carrier.archetypeId, 'aerialBomber');

    const boss = generateReaverbotGenome({
      seed,
      intent: 'tank',
      encounterSize: 3,
      isBoss: true,
    });
    assert.notEqual(boss.archetypeId, 'aerialBomber');
  }

  const forcedSoloHunter = generateReaverbotGenome({
    seed: 'solo-pack-hunter-contract',
    archetypeId: 'packHunter',
    encounterSize: 1,
  });
  const validation = validateReaverbotGenome(forcedSoloHunter);
  assert.equal(validation.valid, true, validation.errors.join(', '));
  assert.equal(forcedSoloHunter.behavior.minimumPackSize, 1);
  assert.ok(forcedSoloHunter.behavior.flankApproachDistance > 1);
  assert.ok(forcedSoloHunter.behavior.flankAttackDot >= 0);
  assert.equal(forcedSoloHunter.behavior.attackCooldownScale, 0.22);
  assert.equal(forcedSoloHunter.behavior.attackCooldownFloor, 0.32);
  assert.equal(forcedSoloHunter.behavior.forcedAttackSeconds, 15);

  const packWeapons = new Map();
  for (let variant = 0; variant < 500 && packWeapons.size < 3; variant += 1) {
    const genome = generateReaverbotGenome({
      seed: `pack-cooldown:${variant}`,
      archetypeId: 'packHunter',
      encounterSize: 4,
    });
    packWeapons.set(genome.modules.weapon.id, genome);
  }
  assert.deepEqual([...packWeapons.keys()].sort(), ['clawArm', 'crusherJaw', 'rocketLance']);
  for (const genome of packWeapons.values()) {
    const weapon = genome.modules.weapon;
    const unscaledCooldown = Math.max(0.75, Math.min(
      3.25,
      (genome.behavior.telegraphDuration
        + genome.behavior.commitDuration
        + genome.behavior.recoveryDuration)
        * 0.9
        * (weapon.cooldownScale ?? 1),
    ));
    assert.ok(genome.stats.attackCooldown < unscaledCooldown, `${weapon.id} should attack more frequently`);
    if (weapon.attackKind === 'charge') {
      assert.ok(genome.behavior.commitDuration >= 0.9, 'rocket charges must travel over a readable interval');
      assert.ok(genome.behavior.recoveryDuration >= 1.1, 'rocket charges must include a retreat window');
      assert.ok(genome.modules.charge?.tags.includes('rocket'));
    }
  }
  assert.ok(weightedSoloPackHunters > 0, 'pack hunters should be selectable in one-enemy encounters');
});

test('non-claw quadrupeds use opening eyelid armor instead of offhand plates', () => {
  for (const archetypeId of ['pursuer', 'pouncer', 'packHunter']) {
    let genome = null;
    for (let variant = 0; variant < 400; variant += 1) {
      const candidate = generateReaverbotGenome({
        seed: `quadruped-eyelids:${archetypeId}:${variant}`,
        archetypeId,
        encounterSize: 4,
      });
      if (candidate.body.planId === 'quadruped' && candidate.modules.weapon.id !== 'clawArm') {
        genome = candidate;
        break;
      }
    }

    assert.ok(genome, `expected a non-claw quadruped ${archetypeId}`);
    assert.equal(genome.modules.defense.id, 'armorShutters');
    assert.equal(genome.modules.weakPoint.id, 'eyeLens');
    assert.equal(validateReaverbotGenome(genome).valid, true);

    const visual = createReaverbotVisual(genome);
    assert.equal(visual.defense.group.userData.quadrupedEyelids, true);
    assert.equal(visual.defense.group.parent, visual.eye.group);
    assert.equal(visual.defense.shutters.length, 2);
    assert.equal(visual.defense.plates.length, 0);
    assert.ok(visual.defense.shutters.every((shutter) => (
      shutter.name === 'generatedQuadrupedEyeArmorEyelid'
      && Number.isFinite(shutter.userData.openY)
      && Number.isFinite(shutter.userData.closedY)
    )));

    setReaverbotDefenseVisualActive(visual, true, 0);
    const closedGap = Math.abs(
      visual.defense.shutters[1].position.y - visual.defense.shutters[0].position.y,
    );
    setReaverbotDefenseVisualActive(visual, false, 1);
    const openGap = Math.abs(
      visual.defense.shutters[1].position.y - visual.defense.shutters[0].position.y,
    );
    assert.ok(openGap > closedGap + 0.5);
    animateReaverbotVisual(visual, {
      dt: 1,
      state: 'telegraph',
      stateProgress: 0,
      defenseActive: false,
      defenseDisabled: true,
      weakPointExposed: true,
    });
    const brokenTelegraphGap = Math.abs(
      visual.defense.shutters[1].position.y - visual.defense.shutters[0].position.y,
    );
    assert.ok(brokenTelegraphGap > closedGap + 0.5);
  }
});

test('encounter slot seeds are stable and independent', () => {
  const first = createEncounterSlotSeed('run-42', 'enemyNest', 0);
  const repeated = createEncounterSlotSeed('run-42', 'enemyNest', 0);
  const nextSlot = createEncounterSlotSeed('run-42', 'enemyNest', 1);
  const otherEncounter = createEncounterSlotSeed('run-42', 'bossEncounter', 0);
  assert.equal(first, repeated);
  assert.notEqual(first, nextSlot);
  assert.notEqual(first, otherEncounter);
});

test('close-range Reaverbots use the harder long-tracking combat profile', () => {
  const findGenome = (archetypeId, predicate) => {
    for (let variant = 0; variant < 200; variant += 1) {
      const genome = generateReaverbotGenome({
        seed: `combat-profile:${archetypeId}:${variant}`,
        archetypeId,
        threatTier: 1,
        encounterSize: 4,
      });
      if (predicate(genome)) return genome;
    }
    return null;
  };

  const pouncer = findGenome('pouncer', (genome) => genome.modules.weapon.id === 'pounceActuator');
  const charger = findGenome('pursuer', (genome) => genome.modules.weapon.attackKind === 'charge');
  const melee = findGenome('pursuer', (genome) => genome.modules.weapon.attackKind === 'clawMoveset');

  assert.ok(pouncer);
  assert.ok(charger);
  assert.ok(melee);
  assert.equal(pouncer.stats.attackRange, 8.6);
  assert.ok(pouncer.behavior.aggroRange >= 24);
  assert.ok(charger.behavior.aggroRange >= 26);
  assert.ok(melee.behavior.aggroRange >= 22);
  assert.ok(pouncer.stats.maxHealth > 29);
  assert.ok(pouncer.stats.damage > 10);
  assert.ok(pouncer.stats.attackCooldown < 2.5);
});

test('pouncers couple their attack module to generated spring locomotion', () => {
  const mobilityIds = new Set();
  const weaponIds = new Set();
  for (let variant = 0; variant < 320; variant += 1) {
    const genome = generateReaverbotGenome({
      seed: `spring-contract:${variant}`,
      archetypeId: 'pouncer',
      threatTier: 2,
      encounterSize: 3,
    });
    mobilityIds.add(genome.body.mobilityId);
    weaponIds.add(genome.modules.weapon.id);
    assert.equal(genome.body.movementModel, 'springBounce');
    assert.ok(genome.body.tags.includes('springLoaded'));
    assert.ok(genome.body.tags.includes('bouncing'));
    assert.equal(genome.modules.weapon.attackKind, 'pounce');
    assert.equal(genome.modules.weapon.mountRole, 'locomotion');
    assert.equal(genome.modules.weapon.integratedIntoMobility, true);
    assert.equal(genome.stats.attackRange, genome.modules.weapon.id === 'launchLeg' ? 9.8 : 8.6);
    assert.equal(validateReaverbotGenome(genome).valid, true);
    if (genome.modules.weapon.id === 'launchLeg') {
      assert.equal(genome.body.planId, 'hopper');
      assert.equal(genome.body.mobilityId, 'launchLeg');
      assert.equal(genome.body.mobilityLabel, 'Launch Leg');
      assert.equal(genome.body.mobilityLegCount, 1);
      assert.ok([-1, 1].includes(genome.modules.weapon.mountSide));
      assert.equal(genome.modules.weapon.pounceJumpHeight, 4.4);
      assert.equal(genome.modules.weapon.landingRadius, 3.15);
    } else if (genome.body.planId === 'quadruped') {
      assert.equal(genome.body.mobilityId, 'springQuadruped');
      assert.equal(genome.body.mobilityLegCount, 4);
    } else {
      assert.ok(['pairedSprings', 'monoPogo'].includes(genome.body.mobilityId));
      assert.equal(genome.body.mobilityLegCount, genome.body.mobilityId === 'monoPogo' ? 1 : 2);
    }
  }
  assert.deepEqual([...mobilityIds].sort(), ['launchLeg', 'monoPogo', 'pairedSprings', 'springQuadruped']);
  assert.deepEqual([...weaponIds].sort(), ['launchLeg', 'pounceActuator', 'shockPiston']);

  const fixtures = [
    ['spring-audit:1', 'springQuadruped', 4],
    ['spring-audit:3', 'monoPogo', 1],
    ['spring-audit:16', 'pairedSprings', 2],
    ['spring-launch:4', 'launchLeg', 1],
  ];
  for (const [seed, mobilityId, legCount] of fixtures) {
    const genome = generateReaverbotGenome({ seed, archetypeId: 'pouncer', threatTier: 2, encounterSize: 2 });
    const visual = createReaverbotVisual(genome);
    assert.equal(genome.body.mobilityId, mobilityId);
    assert.equal(visual.frame.springMobility.id, mobilityId);
    assert.equal(visual.frame.springLimbs.length, legCount);
    assert.ok(visual.frame.springLimbs.every((limb) => limb.springLoaded && limb.springCoils.length >= 4));
    const facialWeaponMeshes = [];
    visual.weapon.group.traverse((object) => {
      if (object.isMesh) facialWeaponMeshes.push(object.name);
    });
    if (mobilityId === 'launchLeg') {
      assert.ok(facialWeaponMeshes.length > 20);
      assert.ok(visual.weapon.launchLegAssembly);
      assert.equal(visual.weapon.group.userData.launchLegRig.authoredLength, 4.35);
    } else {
      assert.deepEqual(facialWeaponMeshes, []);
    }
    const names = [];
    let integratedWeaponSurfaces = 0;
    visual.root.traverse((object) => {
      names.push(object.name);
      if (object.userData?.integratedMobilityWeapon) integratedWeaponSurfaces += 1;
    });
    assert.ok(integratedWeaponSurfaces >= legCount * 2);
    assert.equal(names.some((name) => name === 'generatedPounceActuatorArmorFace'), false);
    if (mobilityId === 'springQuadruped') {
      assert.equal(names.some((name) => /CanineLower(Link|Armor)/.test(name)), false);
    } else if (mobilityId === 'monoPogo') {
      assert.ok(names.includes('generatedHopperMonoPogoLeg'));
      assert.equal(names.some((name) => /generatedHopper(Left|Right)SpringLeg/.test(name)), false);
    } else if (mobilityId === 'launchLeg') {
      assert.ok(names.some((name) => /LaunchLegAssembly/.test(name)));
      assert.equal(visual.weapon.launchLegClaws.length, 3);
      assert.equal(visual.weapon.launchLegBoosters.length, 2);
    }
  }

  const invalid = generateReaverbotGenome({
    seed: 'spring-invalid-proof',
    archetypeId: 'pouncer',
    encounterSize: 2,
  });
  invalid.body.mobilityId = 'standard';
  invalid.body.movementModel = 'groundStep';
  invalid.body.tags = invalid.body.tags.filter((tag) => !['springLoaded', 'bouncing', 'singleLegged'].includes(tag));
  const validation = validateReaverbotGenome(invalid);
  assert.ok(validation.errors.includes('pouncer-spring-mobility-required'));
  assert.ok(validation.errors.includes('pounce-spring-mobility-required'));

  const invalidMount = generateReaverbotGenome({
    seed: 'spring-invalid-mount-proof',
    archetypeId: 'pouncer',
    encounterSize: 2,
  });
  invalidMount.modules.weapon.integratedIntoMobility = false;
  invalidMount.modules.weapon.mountRole = 'forward';
  assert.ok(validateReaverbotGenome(invalidMount).errors.includes('pouncer-mobility-weapon-required'));

  const springQuadruped = generateReaverbotGenome({
    seed: 'spring-audit:1',
    archetypeId: 'pouncer',
    threatTier: 2,
    encounterSize: 2,
  });
  const bodyDrop = createReaverbotSalvageProfile(springQuadruped)
    .find((candidate) => candidate.aspect === 'body');
  assert.equal(bodyDrop?.materialId, 'temperedJumpSpring');
  assert.equal(bodyDrop?.moduleLabel, 'Spring-Loaded Quadruped');
});

test('crawler artillery use compound silhouettes with articulated legs or driven wheel bogies', () => {
  let articulated = null;
  let wheeled = null;
  let wheeledSeed = null;
  for (let variant = 0; variant < 512 && (!articulated || !wheeled); variant += 1) {
    const seed = `crawler-mobility-contract:${variant}`;
    const genome = generateReaverbotGenome({
      seed,
      archetypeId: 'artillery',
      threatTier: 2,
      encounterSize: 3,
    });
    if (genome.body.planId !== 'crawler') continue;
    if (genome.body.mobilityId === 'articulatedCrawler') articulated ??= genome;
    if (genome.body.mobilityId === 'wheelBogies' && !wheeled) {
      wheeled = genome;
      wheeledSeed = seed;
    }
  }
  assert.ok(articulated, 'seed sweep should produce an articulated crawler');
  assert.ok(wheeled, 'seed sweep should produce a wheeled crawler');

  const summarizeAssembly = (object) => {
    const meshes = [];
    object.traverse((entry) => {
      if (entry.isMesh) meshes.push(entry);
    });
    return {
      meshCount: meshes.length,
      geometryFamilies: new Set(meshes.map((mesh) => mesh.geometry.type)),
    };
  };
  const inspect = (genome) => {
    const visual = createReaverbotVisual(genome);
    const names = [];
    visual.root.traverse((object) => names.push(object.name));
    return { visual, names };
  };
  const articulatedVisual = inspect(articulated);
  const wheeledVisual = inspect(wheeled);

  for (const { visual, names } of [articulatedVisual, wheeledVisual]) {
    assert.equal(validateReaverbotGenome(visual.genome ?? (visual === articulatedVisual.visual ? articulated : wheeled)).valid, true);
    assert.equal(visual.frame.body.isGroup, true);
    assert.equal(visual.frame.head.isGroup, true);
    assert.ok(summarizeAssembly(visual.frame.body).meshCount >= 8);
    assert.ok(summarizeAssembly(visual.frame.body).geometryFamilies.size >= 3);
    assert.ok(summarizeAssembly(visual.frame.head).meshCount >= 6);
    assert.ok(summarizeAssembly(visual.frame.head).geometryFamilies.size >= 3);
    assert.equal(names.includes('generatedReaverbotAnimalTorso'), false);
    assert.equal(names.includes('generatedReaverbotAnimalHead'), false);
    assert.equal(names.some((name) => /generatedCrawler(UpperLeg|LowerLeg|WedgeFoot)/.test(name)), false);
  }

  assert.equal(articulated.body.movementModel, 'groundStep');
  assert.equal(articulated.body.mobilityLegCount, 6);
  assert.equal(articulated.body.mobilityWheelCount, 0);
  assert.equal(articulatedVisual.visual.frame.limbs.length, 6);
  assert.equal(articulatedVisual.visual.frame.wheels.length, 0);
  assert.ok(articulatedVisual.visual.frame.limbs.every((limb) => (
    limb.crawlerArticulated
    && limb.kneePivot.parent === limb.hipPivot
    && limb.footPivot.parent === limb.kneePivot
  )));

  assert.equal(wheeled.body.movementModel, 'wheelDrive');
  assert.equal(wheeled.body.mobilityLegCount, 0);
  assert.equal(wheeled.body.mobilityWheelCount, 4);
  assert.ok(wheeled.body.tags.includes('wheeled'));
  assert.ok(wheeled.body.tags.includes('rolling'));
  assert.ok(wheeled.stats.moveSpeed > articulated.stats.moveSpeed);
  assert.ok(wheeled.behavior.turnRate < articulated.behavior.turnRate);
  assert.equal(wheeledVisual.visual.frame.limbs.length, 0);
  assert.equal(wheeledVisual.visual.frame.wheels.length, 4);
  assert.ok(wheeledVisual.visual.frame.wheels.every((wheel) => (
    wheel.spinPivot && wheel.steerPivot && wheel.tire.userData.reaverbotWorkingEnd
  )));
  assert.deepEqual(
    generateReaverbotGenome({
      seed: wheeledSeed,
      archetypeId: 'artillery',
      threatTier: 2,
      encounterSize: 3,
    }).body.mobilityId,
    wheeled.body.mobilityId,
  );
  const wheelDrop = createReaverbotSalvageProfile(wheeled)
    .find((candidate) => candidate.aspect === 'body');
  assert.equal(wheelDrop?.materialId, 'ancientWheelGearset');

  const invalidBody = structuredClone(wheeled);
  invalidBody.body.planId = 'tripod';
  assert.ok(validateReaverbotGenome(invalidBody).errors.includes('crawler-mobility-body-incompatible'));
  const invalidDrive = structuredClone(wheeled);
  invalidDrive.body.movementModel = 'groundStep';
  assert.ok(validateReaverbotGenome(invalidDrive).errors.includes('wheel-bogy-contract'));

  let suppressedCrawlerCount = 0;
  for (let variant = 0; variant < 180; variant += 1) {
    const genome = generateReaverbotGenome({
      seed: `crawler-wheel-suppression:${variant}`,
      archetypeId: 'artillery',
      encounterSize: 3,
      suppressedTags: ['rolling_reaverbot'],
    });
    if (genome.body.planId !== 'crawler') continue;
    suppressedCrawlerCount += 1;
    assert.equal(genome.body.mobilityId, 'articulatedCrawler');
  }
  assert.ok(suppressedCrawlerCount > 0);
});

test('revamped melee modules are armored, deterministic, and body-plan compatible', () => {
  const clawMountSides = new Set();
  let jawCount = 0;
  let meleeCount = 0;

  for (const archetypeId of ['pursuer', 'packHunter', 'duelist', 'pouncer', 'rotorHunter']) {
    for (let variant = 0; variant < 180; variant += 1) {
      const options = {
        seed: `melee-contract:${archetypeId}:${variant}`,
        archetypeId,
        threatTier: 1,
        encounterSize: 4,
      };
      const genome = generateReaverbotGenome(options);
      const weapon = genome.modules.weapon;
      if (!weapon.tags.includes('melee')) continue;

      meleeCount += 1;
      assert.ok(genome.stats.armor >= 20, `${weapon.id} must retain meaningful armor after ordinary armor pierce`);
      assert.ok(genome.stats.maxHealth > REAVERBOT_ARCHETYPES[archetypeId].baseStats.health);

      if (weapon.id === 'crusherJaw') {
        jawCount += 1;
        assert.equal(genome.body.planId, 'quadruped');
        assert.deepEqual(weapon.bodyPlans, ['quadruped']);
        assert.equal(weapon.attackKind, 'jawCombo');
        assert.equal(weapon.comboCount, 3);
        assert.ok(weapon.mouthContactRadius >= 0.65);
        assert.ok(weapon.mouthContactDamageScale > 0);
        assert.ok(weapon.shockwaveRadius >= 1.8);
        assert.ok(weapon.shockwaveDamageScale > 0);
        assert.ok(genome.behavior.telegraphDuration >= 1);
        assert.ok(genome.stats.moveSpeed > REAVERBOT_ARCHETYPES[archetypeId].baseStats.speed);
        const repeated = generateReaverbotGenome(options);
        assert.equal(repeated.body.planId, genome.body.planId);
        assert.deepEqual(repeated.modules.weapon, weapon);
      }

      if (weapon.id === 'clawArm') {
        clawMountSides.add(weapon.mountSide);
        assert.equal(weapon.attackKind, 'clawMoveset');
        assert.equal(weapon.threatCost, 7);
        assert.equal(genome.modules.defense, null);
        assert.equal(genome.modules.weakPoint.id, 'clawPalm');
        assert.equal(genome.modules.weakPoint.location, 'clawPalm');
        assert.equal(genome.modules.weakPoint.exposure, 'telegraph');
        assert.equal(genome.modules.weakPoint.multiplier, 2.25);
        assert.equal(genome.modules.weakPoint.radius, 0.3);
        assert.equal(genome.modules.weakPoint.lockable, true);
        assert.ok([-1, 1].includes(weapon.mountSide));
        assert.equal('comboOrientation' in weapon, false);
        assert.equal('initialSweepDirection' in weapon, false);
        assert.equal('comboCount' in weapon, false);
        assert.equal(weapon.telegraphDuration, 1.65);
        assert.equal(weapon.horizontalCommitDuration, 0.52);
        assert.equal(weapon.slamCommitDuration, 0.58);
        assert.equal(weapon.recoveryDuration, 0.78);
        assert.equal(weapon.guardDuration, 0.62);
        assert.equal(weapon.guardDirectMultiplier, 0);
        assert.equal(weapon.recoilDuration, 0.85);
        assert.equal(weapon.palmBreakHitCount, 3);
        assert.equal(weapon.clawBreakDamageMaxHealthScale, 0.35);
        assert.equal(weapon.horizontalSweepRadius, 4.55);
        assert.equal(weapon.horizontalSweepDamageScale, 1);
        assert.equal(weapon.trailDuration, 0.65);
        assert.equal(weapon.trailDamageScale, 0.42);
        assert.equal(weapon.slamRadius, 2.65);
        assert.equal(weapon.slamDamageScale, 1.15);
        const repeatedWeapon = generateReaverbotGenome(options).modules.weapon;
        assert.equal(repeatedWeapon.mountSide, weapon.mountSide);
      }
    }
  }

  assert.ok(meleeCount > 0);
  assert.ok(jawCount > 0);
  assert.deepEqual([...clawMountSides].sort(), [-1, 1]);
});

test('schema-v3 validation reserves null defense and the palm weak point for claw carriers', () => {
  let clawGenome = null;
  let ordinaryGenome = null;
  for (let variant = 0; variant < 240 && (!clawGenome || !ordinaryGenome); variant += 1) {
    const genome = generateReaverbotGenome({
      seed: `schema-v3-claw-contract:${variant}`,
      archetypeId: 'pursuer',
      threatTier: 2,
      encounterSize: 4,
    });
    if (genome.modules.weapon.id === 'clawArm') clawGenome = genome;
    else ordinaryGenome = genome;
  }

  assert.ok(clawGenome);
  assert.ok(ordinaryGenome);
  assert.equal(validateReaverbotGenome(clawGenome).valid, true);
  assert.equal(validateReaverbotGenome(ordinaryGenome).valid, true);

  const withSeparateDefense = structuredClone(clawGenome);
  withSeparateDefense.modules.defense = structuredClone(REAVERBOT_DEFENSES.reactivePlate);
  assert.ok(validateReaverbotGenome(withSeparateDefense).errors.includes('claw-defense-must-be-null'));

  const withoutPalm = structuredClone(clawGenome);
  withoutPalm.modules.weakPoint = structuredClone(REAVERBOT_WEAK_POINTS.rearBattery);
  assert.ok(validateReaverbotGenome(withoutPalm).errors.includes('claw-palm-weak-point-required'));

  const ordinaryWithoutDefense = structuredClone(ordinaryGenome);
  ordinaryWithoutDefense.modules.defense = null;
  assert.ok(validateReaverbotGenome(ordinaryWithoutDefense).errors.includes('defense-null-non-claw'));

  const ordinaryWithPalm = structuredClone(ordinaryGenome);
  ordinaryWithPalm.modules.weakPoint = structuredClone(REAVERBOT_WEAK_POINTS.clawPalm);
  assert.ok(validateReaverbotGenome(ordinaryWithPalm).errors.includes('claw-palm-non-claw'));

  const oldSchema = structuredClone(clawGenome);
  oldSchema.schemaVersion = 1;
  assert.ok(validateReaverbotGenome(oldSchema).errors.includes('unsupported-schema-version'));
});

test('melee visual grammar adds substantial spikes and cosmetic flank armor without replacing authored defense', () => {
  const expectedWeapons = new Set(
    Object.values(REAVERBOT_WEAPONS)
      .filter((weapon) => weapon.tags.includes('melee'))
      .map((weapon) => weapon.id),
  );
  const samples = new Map();

  for (const archetypeId of ['pursuer', 'packHunter', 'duelist', 'pouncer', 'rotorHunter']) {
    for (let variant = 0; variant < 260 && samples.size < expectedWeapons.size; variant += 1) {
      const genome = generateReaverbotGenome({
        seed: `melee-silhouette:${archetypeId}:${variant}`,
        archetypeId,
        threatTier: 2,
        encounterSize: 4,
      });
      if (genome.modules.weapon.tags.includes('melee')) {
        samples.set(genome.modules.weapon.id, genome);
      }
    }
  }

  assert.deepEqual([...samples.keys()].sort(), [...expectedWeapons].sort());

  for (const [weaponId, genome] of samples) {
    const visual = createReaverbotVisual(genome);
    try {
      const armor = visual.meleeArmor;
      const authoredDefensePlates = visual.defense?.plates ?? [];
      assert.equal(armor.enabled, true, weaponId);
      assert.equal(visual.root.userData.meleeSilhouetteArmored, true, weaponId);
      assert.equal(armor.group.parent, visual.root, weaponId);
      assert.equal(armor.group.userData.decorativeArmor, true, weaponId);
      assert.equal(armor.group.userData.gameplayDefense, false, weaponId);
      assert.equal(armor.group.userData.authoredDefenseId, null, weaponId);
      assert.equal(armor.plates.length, 4, weaponId);
      assert.equal(armor.sidePlates.length, 2, weaponId);
      assert.equal(armor.topPlates.length, 2, weaponId);
      assert.ok(armor.spikes.length >= 4, weaponId);
      assert.ok(armor.sidePlates[0].position.x * armor.sidePlates[1].position.x < 0, weaponId);
      assert.ok(
        armor.sidePlates.every((plate) => plate.geometry.parameters.height >= 0.5
          && plate.geometry.parameters.depth >= 0.6),
        `${weaponId} cosmetic side plating should be visually substantial`,
      );
      assert.ok(
        [...armor.plates, ...armor.spikes].every((part) => (
          part.userData.decorativeArmor === true
          && part.userData.gameplayDefense === false
          && !authoredDefensePlates.includes(part)
        )),
        `${weaponId} silhouette armor must remain independent of gameplay defense`,
      );
      if (weaponId === 'clawArm') {
        assert.equal(genome.modules.defense, null);
        assert.equal(visual.defense.group.userData.defenseId, null);
        assert.equal(visual.defense.primaryPlate, null);
        assert.equal(visual.defense.plates.length, 0);
      } else {
        assert.equal(visual.defense.group.userData.defenseId, genome.modules.defense.id, weaponId);
      }

      visual.root.updateMatrixWorld(true);
      const eyePosition = visual.eye.lens.getWorldPosition(new THREE.Vector3());
      const firstVisibleHit = new THREE.Raycaster(
        eyePosition.clone().add(new THREE.Vector3(0, 0, 5)),
        new THREE.Vector3(0, 0, -1),
        0,
        8,
      ).intersectObject(visual.root, true)
        .find((hit) => hit.object.visible !== false
          && !(hit.object.material?.transparent && hit.object.material.opacity < 0.5));
      assert.equal(
        firstVisibleHit?.object.userData?.reaverbotEye,
        true,
        `${weaponId}/${genome.body.planId} armor must preserve the ruby-eye sightline (hit ${firstVisibleHit?.object.name ?? 'nothing'})`,
      );
    } finally {
      const geometries = new Set();
      const materials = new Set();
      visual.root.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) {
          if (material) materials.add(material);
        }
      });
      for (const geometry of geometries) geometry.dispose?.();
      for (const material of materials) material.dispose?.();
    }
  }

  let rangedGenome = null;
  for (let variant = 0; variant < 80 && !rangedGenome; variant += 1) {
    const candidate = generateReaverbotGenome({
      seed: `ranged-silhouette-control:${variant}`,
      archetypeId: 'shieldSentinel',
      threatTier: 2,
      encounterSize: 4,
    });
    if (!candidate.modules.weapon.tags.includes('melee')) rangedGenome = candidate;
  }
  assert.ok(rangedGenome);
  const rangedVisual = createReaverbotVisual(rangedGenome);
  assert.equal(rangedVisual.meleeArmor.enabled, false);
  assert.equal(rangedVisual.meleeArmor.group, null);
  assert.equal(rangedVisual.meleeArmor.plates.length, 0);
  assert.equal(rangedVisual.root.userData.meleeSilhouetteArmored, false);
});

test('articulated claw extends into the target lane without hiding the red eye in live frames', () => {
  const bodyPlans = new Set();
  const mountSides = new Set();
  let checked = 0;
  let minimumExtendedReach = Infinity;

  const firstOpaqueHitTowardEye = (visual) => {
    visual.root.updateMatrixWorld(true);
    const eyePosition = visual.eye.lens.getWorldPosition(new THREE.Vector3());
    return new THREE.Raycaster(
      eyePosition.clone().add(new THREE.Vector3(0, 0, 5)),
      new THREE.Vector3(0, 0, -1),
      0,
      8,
    ).intersectObject(visual.root, true)
      .find((hit) => hit.object.visible !== false
        && !(hit.object.material?.transparent && hit.object.material.opacity < 0.5));
  };

  const disposeVisual = (visual) => {
    const geometries = new Set();
    const materials = new Set();
    visual.root.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) {
        if (material) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose?.();
    for (const material of materials) material.dispose?.();
  };

  for (const archetypeId of ['pursuer', 'packHunter', 'duelist']) {
    let archetypeSamples = 0;
    for (let variant = 0; variant < 220 && archetypeSamples < 8; variant += 1) {
      const genome = generateReaverbotGenome({
        seed: `claw-eye:${archetypeId}:${variant}`,
        archetypeId,
        threatTier: 2,
        encounterSize: 4,
      });
      const weapon = genome.modules.weapon;
      if (weapon.id !== 'clawArm') continue;

      archetypeSamples += 1;
      checked += 1;
      bodyPlans.add(genome.body.planId);
      mountSides.add(weapon.mountSide);
      const visual = createReaverbotVisual(genome);
      let animationTime = 0;

      try {
        assert.equal(visual.weapon.group.userData.clawRig?.articulated, true);
        assert.equal(visual.weapon.group.userData.clawRig?.segmentCount, 2);
        assert.ok(visual.weapon.clawUpperBoom);
        assert.ok(visual.weapon.clawElbowPivot);
        assert.ok(visual.weapon.clawForearm);
        assert.ok(visual.weapon.clawPalm);
        assert.equal(visual.weapon.clawTalonPivots.length, 3);
        assert.equal(visual.weapon.muzzle.parent, visual.weapon.clawReachSocket);
        assert.equal(visual.weapon.clawBaseReach, weapon.baseReach);
        assert.equal(visual.weapon.clawMaxReach, weapon.extendedReach);
        assert.equal(visual.weakPoint.core.userData.weakPointId, 'clawPalm');
        assert.equal(visual.weakPoint.core.userData.clawPalmEye, true);
        assert.equal(visual.weakPoint.core.userData.dominantFocalPoint, false);
        assert.equal(visual.weakPoint.group.parent, visual.weapon.clawPalmAnchor);
        assert.equal(visual.defense.group.userData.defenseId, null);
        assert.equal(visual.defense.plates.length, 0);

        const shoulderPosition = new THREE.Vector3();
        const muzzlePosition = new THREE.Vector3();
        animateReaverbotVisual(visual, {
          dt: 1,
          state: 'position',
          attackKind: weapon.attackKind,
          clawExtension: 0,
        });
        visual.weapon.clawSwingPivot.getWorldPosition(shoulderPosition);
        visual.weapon.muzzle.getWorldPosition(muzzlePosition);
        const foldedReach = shoulderPosition.distanceTo(muzzlePosition);
        animateReaverbotVisual(visual, {
          dt: 1,
          state: 'commit',
          stateProgress: 0.48,
          attackKind: weapon.attackKind,
          clawExtension: 1,
        });
        visual.weapon.clawSwingPivot.getWorldPosition(shoulderPosition);
        visual.weapon.muzzle.getWorldPosition(muzzlePosition);
        const extendedReach = shoulderPosition.distanceTo(muzzlePosition);
        minimumExtendedReach = Math.min(minimumExtendedReach, extendedReach);
        assert.ok(extendedReach > foldedReach - 0.6, 'hinge pose must not collapse the oversized claw');
        assert.equal(visual.weapon.clawReachSocket.userData.extension, 1);
        animateReaverbotVisual(visual, {
          dt: 1,
          state: 'position',
          attackKind: weapon.attackKind,
        });

        // The horizontal commit deliberately turns the whole chassis through a
        // complete revolution, so the face eye cannot remain front-facing for
        // every commit frame. Its sightline must stay clear throughout the
        // deliberate counter window before that spin begins.
        for (const state of ['telegraph']) {
          const duration = state === 'telegraph'
            ? genome.behavior.telegraphDuration
            : genome.behavior.commitDuration;
          for (let elapsed = 0; elapsed < duration; elapsed += 0.05) {
            animationTime += 0.05;
            animateReaverbotVisual(visual, {
              time: animationTime,
              dt: 0.05,
              moving: state === 'commit',
              speedRatio: state === 'commit' ? 1 : 0,
              state,
              stateProgress: elapsed / duration,
              attackKind: weapon.attackKind,
              clawAttackVariant: 'horizontalSwipe',
              clawMountSide: weapon.mountSide,
              defenseActive: false,
              weakPointExposed: state === 'telegraph',
              weakPointLocation: genome.modules.weakPoint.location,
            });
            const firstHit = firstOpaqueHitTowardEye(visual);
            assert.equal(
              firstHit?.object.userData?.reaverbotEye,
              true,
              `${genome.seedLabel} ${genome.body.planId} ${state} ${elapsed.toFixed(2)}s must keep the red eye visible (hit ${firstHit?.object.name ?? 'nothing'})`,
            );
          }
        }
      } finally {
        disposeVisual(visual);
      }
    }
  }

  assert.ok(checked >= 18, 'expected representative articulated-claw samples');
  assert.deepEqual([...bodyPlans].sort(), ['biped', 'lowBiped', 'quadruped']);
  assert.deepEqual([...mountSides].sort(), [-1, 1]);
  // The reach socket sits at the palm; the talons extend the visible weapon
  // beyond it to the configured 4.55 m sweep envelope.
  assert.ok(minimumExtendedReach > 3.75, `constructor claw palm should reach the target lane (minimum reach ${minimumExtendedReach})`);
});

test('tractor controllers are dependent flying support units with one-cargo tractor hardware', () => {
  for (let variant = 0; variant < 40; variant += 1) {
    const genome = generateReaverbotGenome({
      seed: `tractor-controller:${variant}`,
      archetypeId: 'tractorController',
      threatTier: 2,
      encounterSize: 4,
    });
    assert.equal(genome.body.navigationMode, 'air');
    assert.ok(['flyer', 'hoverBell'].includes(genome.body.planId));
    assert.equal(genome.modules.weapon.id, 'tractorMagnet');
    assert.equal(genome.modules.weapon.attackKind, 'tractorBeam');
    assert.equal(genome.modules.weapon.maxCargo, 1);
    assert.ok(genome.modules.weapon.acquireRange >= genome.behavior.preferredRange);
    assert.equal(genome.behavior.minimumPackSize, 2);
    assert.ok(genome.modules.weapon.liftDuration > 0);
    assert.ok(genome.modules.weapon.carryDuration > 0);
    assert.ok(genome.modules.weapon.throwDuration > 0);
  }

  for (let variant = 0; variant < 120; variant += 1) {
    const solo = generateReaverbotGenome({
      seed: `solo-controller-guard:${variant}`,
      intent: 'any',
      encounterSize: 1,
    });
    assert.notEqual(solo.archetypeId, 'tractorController');
  }
});

test('every body plan builds one and only one dominant red eye', () => {
  const archetypes = getReaverbotCatalogSummary().archetypes;

  for (const archetypeId of archetypes) {
    for (let variant = 0; variant < 12; variant += 1) {
      const genome = generateReaverbotGenome({
        seed: `${archetypeId}:${variant}`,
        archetypeId,
        threatTier: 2,
        encounterSize: 3,
      });
      const visual = createReaverbotVisual(genome);
      const eyes = [];
      visual.root.traverse((object) => {
        if (object.userData?.reaverbotEye || object.userData?.clawPalmEye) eyes.push(object);
      });
      const dominantEyes = eyes.filter((eye) => eye.userData.dominantFocalPoint === true);
      assert.equal(dominantEyes.length, 1, `${archetypeId}/${genome.body.planId}`);
      assert.ok(eyes.every((eye) => eye.material.color.getHex() === REAVERBOT_EYE_COLOR));
      if (genome.modules.weapon.id === 'clawArm') {
        assert.equal(eyes.filter((eye) => eye.userData.clawPalmEye === true).length, 1);
      } else {
        assert.equal(eyes.length, 1, `${archetypeId}/${genome.body.planId}`);
      }
      const eyePosition = dominantEyes[0].getWorldPosition(new THREE.Vector3());
      const eyeRay = new THREE.Raycaster(
        eyePosition.clone().add(new THREE.Vector3(0, 0, 5)),
        new THREE.Vector3(0, 0, -1),
        0,
        8,
      );
      const firstVisibleHit = eyeRay.intersectObject(visual.root, true)
        .find((hit) => hit.object.visible !== false
          && !(hit.object.material?.transparent && hit.object.material.opacity < 0.5));
      assert.equal(
        firstVisibleHit?.object.userData?.reaverbotEye,
        true,
        `${archetypeId}/${genome.body.planId} must keep the red eye unobstructed from the front (hit ${firstVisibleHit?.object.name ?? 'nothing'})`,
      );
      assert.ok(visual.weapon.group);
      assert.ok(visual.defense.group);
      assert.ok(visual.weakPoint.core);
    }
  }
});

test('defensive modules use readable body-family anchors', () => {
  const expectedDefenseIds = new Set(getReaverbotCatalogSummary().defenses);
  const found = new Map();

  for (let seed = 0; seed < 4000 && found.size < expectedDefenseIds.size; seed += 1) {
    const genome = generateReaverbotGenome({
      seed: `defense-anchor:${seed}`,
      threatTier: 3,
      encounterSize: 4,
    });
    const defenseId = genome.modules.defense?.id;
    if (!defenseId) continue;
    if (found.has(defenseId)) continue;

    const visual = createReaverbotVisual(genome);
    const anchors = visual.frame.anchors;
    let expected = anchors.defense;
    if (defenseId === 'armorShutters' || defenseId === 'armoredSkull') {
      expected = anchors.eye;
    } else if (defenseId === 'directionalShield' || defenseId === 'reactivePlate') {
      expected = [
        Math.sign(anchors.frontSide[0] || -1) * (defenseId === 'directionalShield' ? 0.82 : 0.58),
        anchors.frontSide[1] + 0.08,
        anchors.frontSide[2] + (defenseId === 'directionalShield' ? 0.5 : 0.44),
      ];
    } else if (defenseId === 'guardArms') {
      expected = [anchors.center[0], anchors.center[1], anchors.center[2] + 0.6];
    } else if (defenseId === 'sidePlates') {
      expected = [anchors.center[0], anchors.center[1] - 0.14, anchors.frontSide[2] + 0.18];
    } else if (['rotatingPlates', 'energyMembrane', 'phaseShell'].includes(defenseId)) {
      expected = anchors.center;
    } else if (defenseId === 'armoredBack' || defenseId === 'armoredCarapace') {
      expected = anchors.rearHigh;
    }

    const actual = visual.root.worldToLocal(
      visual.defense.group.getWorldPosition(new THREE.Vector3()),
    );
    assert.ok(
      Math.abs(actual.x - expected[0]) < 0.0001
        && Math.abs(actual.y - expected[1]) < 0.0001
        && Math.abs(actual.z - expected[2]) < 0.0001,
      `${defenseId} should attach at its readable defensive anchor`,
    );
    assert.ok(
      visual.defense.plates.every((plate) => plate.material !== visual.materials.primary),
      `${defenseId} defense cues must not mutate the shared body material`,
    );
    if (defenseId === 'sidePlates') {
      for (const plate of visual.defense.plates) {
        assert.ok(plate.geometry.parameters.width > plate.geometry.parameters.depth * 2);
        assert.ok(plate.geometry.parameters.height >= 1);
      }
      assert.ok(actual.z > anchors.frontSide[2]);
    }
    if (defenseId === 'directionalShield') {
      assert.ok(visual.defense.primaryPlate.geometry.parameters.radiusTop >= 0.8);
      assert.ok(actual.z >= anchors.frontSide[2] + 0.49);
    }
    if (defenseId === 'reactivePlate') {
      assert.ok(visual.defense.primaryPlate.geometry.parameters.width >= 0.75);
      assert.ok(visual.defense.primaryPlate.geometry.parameters.height >= 1);
      assert.ok(actual.z >= anchors.frontSide[2] + 0.43);
    }
    if (defenseId === 'rotatingPlates') {
      const shieldDirection = visual.defense.primaryPlate.position.clone().normalize();
      const weakDirection = visual.weakPoint.group.position.clone().normalize();
      assert.ok(shieldDirection.dot(weakDirection) < -0.9);
      if (genome.modules.weapon.id === 'rotorBlade') {
        assert.equal(visual.weapon.group.parent, visual.defense.group);
      }
    }
    found.set(defenseId, true);
  }

  assert.deepEqual([...found.keys()].sort(), [...expectedDefenseIds].sort());
});

test('leg armor physically covers its paired joint until the plates retract', () => {
  let genome = null;
  for (let variant = 0; variant < 240 && !genome; variant += 1) {
    const candidate = generateReaverbotGenome({
      seed: `paired:pursuer:${variant}`,
      archetypeId: 'pursuer',
      threatTier: 2,
      encounterSize: 3,
    });
    if (candidate.modules.defense?.id === 'sidePlates'
      && candidate.modules.weakPoint.id === 'legJoint') genome = candidate;
  }
  assert.ok(genome);
  assert.equal(genome.modules.defense.id, 'sidePlates');
  assert.equal(genome.modules.weakPoint.id, 'legJoint');

  const visual = createReaverbotVisual(genome);
  const weakPosition = visual.weakPoint.core.getWorldPosition(new THREE.Vector3());
  const castTowardJoint = () => new THREE.Raycaster(
    weakPosition.clone().add(new THREE.Vector3(0, 0, 4)),
    new THREE.Vector3(0, 0, -1),
    0,
    8,
  ).intersectObject(visual.root, true)
    .find((hit) => hit.object.visible !== false
      && !(hit.object.material?.transparent && hit.object.material.opacity < 0.5));

  setReaverbotDefenseVisualActive(visual, true, 0);
  visual.root.updateMatrixWorld(true);
  assert.equal(castTowardJoint()?.object.name, 'generatedSideArmorPlate');

  setReaverbotDefenseVisualActive(visual, false, 1);
  visual.root.updateMatrixWorld(true);
  assert.equal(castTowardJoint()?.object.userData?.weakPoint, true);
});

test('every procedural Reaverbot aspect has a specific source while boss keystones stay excluded', () => {
  assert.deepEqual(Object.keys(REAVERBOT_SALVAGE_SOURCE_MAPS.behavior).sort(), Object.keys(REAVERBOT_ARCHETYPES).sort());
  assert.deepEqual(
    Object.keys(REAVERBOT_SALVAGE_SOURCE_MAPS.body).sort(),
    [...Object.keys(REAVERBOT_BODY_PLANS), 'articulatedCrawler', 'wheelBogies'].sort(),
  );
  assert.deepEqual(Object.keys(REAVERBOT_SALVAGE_SOURCE_MAPS.eye), ['singleRubyLens']);
  assert.deepEqual(Object.keys(REAVERBOT_SALVAGE_SOURCE_MAPS.weapon).sort(), Object.keys(REAVERBOT_WEAPONS).sort());
  assert.deepEqual(Object.keys(REAVERBOT_SALVAGE_SOURCE_MAPS.charge).sort(), Object.keys(REAVERBOT_CHARGE_MODULES).sort());
  assert.deepEqual(Object.keys(REAVERBOT_SALVAGE_SOURCE_MAPS.defense).sort(), Object.keys(REAVERBOT_DEFENSES).sort());
  assert.deepEqual(Object.keys(REAVERBOT_SALVAGE_SOURCE_MAPS.weakPoint).sort(), Object.keys(REAVERBOT_WEAK_POINTS).sort());
  const proceduralMaterialIds = Object.values(REAVERBOT_SALVAGE_SOURCE_MAPS)
    .flatMap((sourceMap) => Object.values(sourceMap))
    .map((entry) => entry.id);
  const bossMaterialIds = Object.values(REAVERBOT_BOSS_SALVAGE).map((entry) => entry.id);
  const authoredRuinMaterialIds = Object.values(AUTHORED_RUIN_SALVAGE).map((entry) => entry.id);
  assert.equal(new Set(proceduralMaterialIds).size, 62);
  assert.deepEqual(bossMaterialIds, ['perfectedCrucibleNozzle', 'perfectedCompressionGreave']);
  assert.deepEqual(authoredRuinMaterialIds, ['oldDrill']);
  assert.equal(
    Object.keys(REAVERBOT_SALVAGE_MATERIALS).length,
    new Set([...proceduralMaterialIds, ...bossMaterialIds, ...authoredRuinMaterialIds]).size,
  );
  assert.equal(proceduralMaterialIds.includes('perfectedCompressionGreave'), false);
  assert.equal(proceduralMaterialIds.includes('oldDrill'), false);
  assert.equal(REAVERBOT_SALVAGE_MATERIALS.perfectedCompressionGreave.tier, 'keystone');
  assert.ok(REAVERBOT_SALVAGE_MATERIALS.perfectedCompressionGreave.craftingTags.includes('boss'));
  assert.equal(REAVERBOT_SALVAGE_MATERIALS.impactHorn, undefined);

  let foundClawProfile = false;
  for (let seed = 0; seed < 250; seed += 1) {
    const genome = generateReaverbotGenome({
      seed: `salvage-profile:${seed}`,
      threatTier: 1 + seed % 5,
      encounterSize: 4,
    });
    const profile = createReaverbotSalvageProfile(genome);
    const isClaw = genome.modules.weapon.id === 'clawArm';
    const isCharge = genome.modules.weapon.attackKind === 'charge';
    const expectedAspects = isClaw
      ? ['behavior', 'body', 'eye', 'weapon', 'weakPoint']
      : isCharge
        ? ['behavior', 'body', 'eye', 'weapon', 'charge', 'defense', 'weakPoint']
        : ['behavior', 'body', 'eye', 'weapon', 'defense', 'weakPoint'];
    assert.deepEqual(profile.map((candidate) => candidate.aspect), expectedAspects);
    assert.equal(new Set(profile.map((candidate) => candidate.materialId)).size, isClaw ? 5 : isCharge ? 7 : 6);
    if (isClaw) {
      foundClawProfile = true;
      assert.equal(profile.find((candidate) => candidate.aspect === 'weakPoint')?.materialId, 'clawPalmRecoilServo');
    }
    assert.ok(profile.every((candidate) => candidate.material.craftingTags.length > 0));
    assert.ok(profile.every((candidate) => candidate.material.exampleUses.length > 0));
  }
  assert.equal(foundClawProfile, true);
});

test('recoverable parts use a deterministic low-chance roll and never yield more than one part', () => {
  const genome = generateReaverbotGenome({
    seed: 'salvage-roll:pouncer',
    archetypeId: 'pouncer',
    threatTier: 1,
    encounterSize: 3,
  });

  const sequenceRandom = (values) => {
    let index = 0;
    return () => values[index++] ?? values.at(-1);
  };
  assert.deepEqual(rollReaverbotSalvageDrops(genome, { random: () => 0.07 }), []);

  const luckyDrop = rollReaverbotSalvageDrops(genome, {
    random: sequenceRandom([0.069999, 0]),
  });
  assert.equal(luckyDrop.length, 1);
  assert.equal(luckyDrop[0].source.aspect, 'behavior');

  assert.deepEqual(rollReaverbotSalvageDrops(genome, { random: () => 0.1 }), []);
  const eliteDrop = rollReaverbotSalvageDrops(genome, {
    random: sequenceRandom([0.1, 0.999]),
    isElite: true,
  });
  assert.equal(eliteDrop.length, 1);
  assert.equal(eliteDrop[0].source.aspect, 'weakPoint');
});

test('breaking a weak point or weapon deterministically increases that part family weight', () => {
  let genome = null;
  for (let variant = 0; variant < 240 && !genome; variant += 1) {
    const candidate = generateReaverbotGenome({
      seed: `claw-salvage-break:${variant}`,
      archetypeId: 'pursuer',
      threatTier: 1,
      encounterSize: 4,
    });
    if (candidate.modules.weapon.id === 'clawArm') genome = candidate;
  }
  assert.ok(genome);

  const sequenceRandom = (values) => {
    let index = 0;
    return () => values[index++] ?? values.at(-1);
  };

  const countAspect = (aspect, options = {}) => {
    let count = 0;
    for (let index = 0; index < 1000; index += 1) {
      const drops = rollReaverbotSalvageDrops(genome, {
        ...options,
        random: sequenceRandom([0, (index + 0.5) / 1000]),
      });
      assert.ok(drops.length <= 1);
      if (drops[0]?.source.aspect === aspect) count += 1;
    }
    return count;
  };

  const intactWeakPointCount = countAspect('weakPoint');
  const brokenWeakPointCount = countAspect('weakPoint', { weakPointBroken: true });
  assert.ok(brokenWeakPointCount > intactWeakPointCount + 200);

  const intactWeaponCount = countAspect('weapon');
  const brokenWeaponCount = countAspect('weapon', { brokenWeaponModuleId: 'clawArm' });
  assert.ok(brokenWeaponCount > intactWeaponCount + 150);
});

test('unidentified scrap and its hidden recovery metadata transfer out of inventory atomically', () => {
  const inventory = new Inventory(4);
  const spring = REAVERBOT_SALVAGE_MATERIALS.temperedJumpSpring;
  inventory.addUnidentifiedScrap(3, {
    source: { enemyId: 'hopper-1' },
    recoverableParts: [{
      ...spring,
      quantity: 1,
      source: { aspect: 'body', moduleId: 'hopper' },
    }],
  });
  inventory.addUnidentifiedScrap(2, { source: { enemyId: 'crawler-1' } });

  assert.equal(inventory.unidentifiedScrap, 5);
  assert.equal(inventory.unidentifiedRecoveries.length, 2);

  const transfer = inventory.takeAllUnidentifiedScrap();
  assert.equal(transfer.total, 5);
  assert.equal(transfer.recoveries.length, 2);
  assert.equal(transfer.recoveries[0].recoverableParts[0].id, 'temperedJumpSpring');
  assert.equal(inventory.unidentifiedScrap, 0);
  assert.deepEqual(inventory.unidentifiedRecoveries, []);
  assert.deepEqual(inventory.takeAllUnidentifiedScrap(), { total: 0, recoveries: [] });
});

test('Roll identifies recoveries into stockpiled scrap and owns atomic part storage for future recipes', () => {
  const inventory = new Inventory(4);
  const storage = new RollSalvageStorage();
  const spring = REAVERBOT_SALVAGE_MATERIALS.temperedJumpSpring;
  const chip = REAVERBOT_SALVAGE_MATERIALS.behaviorChipHunter;

  inventory.addUnidentifiedScrap(3, {
    source: { enemyId: 'hopper-1' },
    recoverableParts: [{
      ...spring,
      quantity: 1,
      source: { aspect: 'body', moduleId: 'hopper' },
    }],
  });
  inventory.addUnidentifiedScrap(2, { source: { enemyId: 'crawler-1' } });

  const identification = storage.identifyRecoveries(inventory.takeAllUnidentifiedScrap());
  assert.deepEqual({
    processed: identification.processed,
    scrapStored: identification.scrapStored,
    partCount: identification.partCount,
  }, {
    processed: 5,
    scrapStored: 4,
    partCount: 1,
  });
  assert.equal(storage.identifiedScrap, 4);
  assert.equal(storage.getPartCount('temperedJumpSpring'), 1);
  assert.deepEqual(identification.recoveredParts.map(({ id, quantity }) => ({ id, quantity })), [
    { id: 'temperedJumpSpring', quantity: 1 },
  ]);

  storage.addPart(spring, 2, { moduleId: 'hopper' });
  storage.addPart(chip, 1, { moduleId: 'pouncer' });
  assert.equal(storage.getPartCount('temperedJumpSpring'), 3);
  assert.equal(storage.getParts().length, 2);
  assert.equal(storage.hasParts({ temperedJumpSpring: 2, behaviorChipHunter: 1 }), true);

  assert.equal(storage.consumeParts({ temperedJumpSpring: 4, behaviorChipHunter: 1 }), false);
  assert.equal(storage.getPartCount('temperedJumpSpring'), 3);
  assert.equal(storage.getPartCount('behaviorChipHunter'), 1);

  assert.equal(storage.consumeParts({ temperedJumpSpring: 2, behaviorChipHunter: 1 }), true);
  assert.equal(storage.getPartCount('temperedJumpSpring'), 1);
  assert.equal(storage.getPartCount('behaviorChipHunter'), 0);
});
