import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createEncounterSlotSeed,
  generateReaverbotGenome,
  getReaverbotCatalogSummary,
  validateReaverbotGenome,
} from '../src/reaverbots/ReaverbotGenerator.js';
import { REAVERBOT_EYE_COLOR } from '../src/reaverbots/ReaverbotCatalog.js';
import { createReaverbotVisual } from '../src/reaverbots/ReaverbotVisualFactory.js';

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
    } else if (defenseId === 'guardArms' || defenseId === 'sidePlates') {
      expected = [anchors.center[0], anchors.center[1], anchors.center[2] + 0.42];
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
    found.set(defenseId, true);
  }

  assert.deepEqual([...found.keys()].sort(), [...expectedDefenseIds].sort());
});
