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
  REAVERBOT_DEFENSES,
  REAVERBOT_EYE_COLOR,
  REAVERBOT_WEAK_POINTS,
  REAVERBOT_WEAPONS,
} from '../src/reaverbots/ReaverbotCatalog.js';
import {
  createReaverbotSalvageProfile,
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
    assert.equal(genome.modules.eye.color, REAVERBOT_EYE_COLOR);
    assert.ok(genome.modules.weapon.id);
    assert.ok(genome.modules.defense.id);
    assert.ok(genome.modules.weakPoint.id);
    assert.ok(
      (LINKED_WEAK_POINT_WEIGHTS[genome.modules.defense.id] ?? [])
        .some(([weakPointId]) => weakPointId === genome.modules.weakPoint.id),
      `seed ${seed}: defense ${genome.modules.defense.id} must protect ${genome.modules.weakPoint.id}`,
    );
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
    defenses.add(genome.modules.defense.id);
    weakPoints.add(genome.modules.weakPoint.id);
  }

  const catalog = getReaverbotCatalogSummary();
  assert.deepEqual([...archetypes].sort(), [...catalog.archetypes].sort());
  assert.deepEqual([...bodyPlans].sort(), [...catalog.bodyPlans].sort());
  assert.ok(weapons.size >= 10);
  assert.ok(defenses.size >= 9);
  assert.ok(weakPoints.size >= 7);
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
  assert.ok(forcedSoloHunter.behavior.rearApproachDistance > 1);
  assert.ok(forcedSoloHunter.behavior.rearAttackDot < 0);
  assert.ok(weightedSoloPackHunters > 0, 'pack hunters should be selectable in one-enemy encounters');
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

  const pouncer = findGenome('pouncer', (genome) => genome.modules.weapon.attackKind === 'pounce');
  const charger = findGenome('pursuer', (genome) => genome.modules.weapon.attackKind === 'charge');
  const melee = findGenome('pursuer', (genome) => genome.modules.weapon.attackKind === 'clawCombo');

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

test('revamped melee modules are armored, deterministic, and body-plan compatible', () => {
  const clawOrientations = new Set();
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
        assert.ok(weapon.shockwaveRadius >= 1.8);
        assert.ok(genome.behavior.telegraphDuration >= 1);
        assert.ok(genome.stats.moveSpeed > REAVERBOT_ARCHETYPES[archetypeId].baseStats.speed);
        const repeated = generateReaverbotGenome(options);
        assert.equal(repeated.body.planId, genome.body.planId);
        assert.deepEqual(repeated.modules.weapon, weapon);
      }

      if (weapon.id === 'clawArm') {
        clawOrientations.add(weapon.comboOrientation);
        assert.equal(weapon.attackKind, 'clawCombo');
        assert.equal(weapon.comboCount, 3);
        assert.ok([-1, 1].includes(weapon.mountSide));
        assert.ok([-1, 1].includes(weapon.initialSweepDirection));
        const repeatedWeapon = generateReaverbotGenome(options).modules.weapon;
        assert.equal(repeatedWeapon.comboOrientation, weapon.comboOrientation);
        assert.equal(repeatedWeapon.mountSide, weapon.mountSide);
        assert.equal(repeatedWeapon.initialSweepDirection, weapon.initialSweepDirection);
      }
    }
  }

  assert.ok(meleeCount > 0);
  assert.ok(jawCount > 0);
  assert.deepEqual([...clawOrientations].sort(), ['horizontal', 'vertical']);
});

test('articulated claw extends into the target lane without hiding the red eye in live frames', () => {
  const bodyPlans = new Set();
  const orientations = new Set();
  const mountSides = new Set();
  const initialDirections = new Set();
  let checked = 0;
  let minimumReachGain = Infinity;
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
      orientations.add(weapon.comboOrientation);
      mountSides.add(weapon.mountSide);
      initialDirections.add(weapon.initialSweepDirection);
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
        minimumReachGain = Math.min(minimumReachGain, extendedReach - foldedReach);
        minimumExtendedReach = Math.min(minimumExtendedReach, extendedReach);
        animateReaverbotVisual(visual, {
          dt: 1,
          state: 'position',
          attackKind: weapon.attackKind,
        });

        for (const state of ['telegraph', 'commit']) {
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
              comboOrientation: weapon.comboOrientation,
              comboMountSide: weapon.mountSide,
              comboInitialDirection: weapon.initialSweepDirection,
              defenseActive: false,
              weakPointExposed: false,
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
  assert.deepEqual([...orientations].sort(), ['horizontal', 'vertical']);
  assert.deepEqual([...mountSides].sort(), [-1, 1]);
  assert.deepEqual([...initialDirections].sort(), [-1, 1]);
  assert.ok(minimumReachGain > 0.25, `folding hinge should add meaningful reach (minimum gain ${minimumReachGain})`);
  assert.ok(minimumExtendedReach > 4, `constructor claw should reach the target lane (minimum reach ${minimumExtendedReach})`);
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
        if (object.userData?.reaverbotEye) eyes.push(object);
      });
      assert.equal(eyes.length, 1, `${archetypeId}/${genome.body.planId}`);
      assert.equal(eyes[0].material.color.getHex(), REAVERBOT_EYE_COLOR);
      assert.equal(eyes[0].userData.dominantFocalPoint, true);
      const eyePosition = eyes[0].getWorldPosition(new THREE.Vector3());
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
    const defenseId = genome.modules.defense.id;
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

    const actual = visual.defense.group.position;
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
  const genome = generateReaverbotGenome({
    seed: 'paired:pursuer:0',
    archetypeId: 'pursuer',
    threatTier: 2,
    encounterSize: 3,
  });
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

test('every procedural Reaverbot aspect has a specific crafting material source', () => {
  assert.deepEqual(Object.keys(REAVERBOT_SALVAGE_SOURCE_MAPS.behavior).sort(), Object.keys(REAVERBOT_ARCHETYPES).sort());
  assert.deepEqual(Object.keys(REAVERBOT_SALVAGE_SOURCE_MAPS.body).sort(), Object.keys(REAVERBOT_BODY_PLANS).sort());
  assert.deepEqual(Object.keys(REAVERBOT_SALVAGE_SOURCE_MAPS.eye), ['singleRubyLens']);
  assert.deepEqual(Object.keys(REAVERBOT_SALVAGE_SOURCE_MAPS.weapon).sort(), Object.keys(REAVERBOT_WEAPONS).sort());
  assert.deepEqual(Object.keys(REAVERBOT_SALVAGE_SOURCE_MAPS.defense).sort(), Object.keys(REAVERBOT_DEFENSES).sort());
  assert.deepEqual(Object.keys(REAVERBOT_SALVAGE_SOURCE_MAPS.weakPoint).sort(), Object.keys(REAVERBOT_WEAK_POINTS).sort());
  assert.equal(Object.keys(REAVERBOT_SALVAGE_MATERIALS).length, 55);

  for (let seed = 0; seed < 250; seed += 1) {
    const genome = generateReaverbotGenome({
      seed: `salvage-profile:${seed}`,
      threatTier: 1 + seed % 5,
      encounterSize: 4,
    });
    const profile = createReaverbotSalvageProfile(genome);
    assert.deepEqual(profile.map((candidate) => candidate.aspect), [
      'behavior', 'body', 'eye', 'weapon', 'defense', 'weakPoint',
    ]);
    assert.equal(new Set(profile.map((candidate) => candidate.materialId)).size, 6);
    assert.ok(profile.every((candidate) => candidate.material.craftingTags.length > 0));
    assert.ok(profile.every((candidate) => candidate.material.exampleUses.length > 0));
  }
});

test('module salvage is guaranteed, elites yield more variety, and breaking a weak point improves its recovery chance', () => {
  const genome = generateReaverbotGenome({
    seed: 'salvage-roll:pouncer',
    archetypeId: 'pouncer',
    threatTier: 3,
    encounterSize: 3,
  });
  const noLuckyRolls = rollReaverbotSalvageDrops(genome, { random: () => 0.999 });
  assert.equal(noLuckyRolls.length, 1);
  assert.ok(['body', 'weapon', 'defense'].includes(noLuckyRolls[0].source.aspect));

  const eliteRolls = rollReaverbotSalvageDrops(genome, {
    random: () => 0.999,
    isElite: true,
  });
  assert.equal(eliteRolls.length, 2);
  assert.equal(new Set(eliteRolls.map((drop) => drop.id)).size, 2);

  const intactRolls = rollReaverbotSalvageDrops(genome, { random: () => 0.5 });
  const brokenRolls = rollReaverbotSalvageDrops(genome, {
    random: () => 0.5,
    weakPointBroken: true,
  });
  assert.equal(intactRolls.some((drop) => drop.source.aspect === 'weakPoint'), false);
  assert.equal(brokenRolls.some((drop) => drop.source.aspect === 'weakPoint'), true);
});

test('specific Reaverbot materials stack and can be consumed atomically by future recipes', () => {
  const inventory = new Inventory(4);
  const spring = REAVERBOT_SALVAGE_MATERIALS.temperedJumpSpring;
  const chip = REAVERBOT_SALVAGE_MATERIALS.behaviorChipHunter;
  inventory.addMaterial(spring, 2, { moduleId: 'hopper', moduleLabel: 'Spring Hopper' });
  inventory.addMaterial(spring, 1, { moduleId: 'hopper', moduleLabel: 'Spring Hopper' });
  inventory.addMaterial(chip, 1, { moduleId: 'pouncer', moduleLabel: 'Pouncer' });

  assert.equal(inventory.getMaterialCount('temperedJumpSpring'), 3);
  assert.equal(inventory.getMaterials().length, 2);
  assert.equal(inventory.hasMaterials({ temperedJumpSpring: 2, behaviorChipHunter: 1 }), true);
  assert.equal(inventory.consumeMaterials({ temperedJumpSpring: 2, behaviorChipHunter: 1 }), true);
  assert.equal(inventory.getMaterialCount('temperedJumpSpring'), 1);
  assert.equal(inventory.getMaterialCount('behaviorChipHunter'), 0);
  assert.equal(inventory.consumeMaterials({ temperedJumpSpring: 2 }), false);
  assert.equal(inventory.getMaterialCount('temperedJumpSpring'), 1);
});
