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
  REAVERBOT_EYE_COLOR,
} from '../src/reaverbots/ReaverbotCatalog.js';
import {
  createReaverbotVisual,
  setReaverbotDefenseVisualActive,
} from '../src/reaverbots/ReaverbotVisualFactory.js';

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

test('group-only and self-destruct constraints protect encounter progression', () => {
  for (let seed = 0; seed < 250; seed += 1) {
    const solo = generateReaverbotGenome({ seed, intent: 'any', encounterSize: 1 });
    assert.notEqual(solo.archetypeId, 'packHunter');

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
        anchors.frontSide[2] + 0.3,
      ];
    } else if (defenseId === 'guardArms') {
      expected = [anchors.center[0], anchors.center[1], anchors.center[2] + 0.42];
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
      assert.ok(actual.z >= anchors.frontSide[2] + 0.29);
    }
    if (defenseId === 'reactivePlate') {
      assert.ok(visual.defense.primaryPlate.geometry.parameters.width >= 0.75);
      assert.ok(visual.defense.primaryPlate.geometry.parameters.height >= 1);
      assert.ok(actual.z >= anchors.frontSide[2] + 0.29);
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
