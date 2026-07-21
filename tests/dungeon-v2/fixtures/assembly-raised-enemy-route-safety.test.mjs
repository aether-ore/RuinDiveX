import test from 'node:test';
import assert from 'node:assert/strict';

// Three's TextureLoader only needs an image-like event target while these
// Node fixtures construct the real generated Reaverbot. No texture has to
// finish loading for genome, combat-capability, or salvage assertions.
globalThis.document ??= {
  createElementNS() {
    return {
      addEventListener() {},
      removeEventListener() {},
      set src(value) { this.source = value; },
      get src() { return this.source; },
    };
  },
};

const THREE = await import('three');
const { EnemySpawner } = await import('../../../src/EnemySpawner.js');
const { createGoldenDungeonPlanV2 } = await import('../../../src/dungeon-v2/GoldenDungeonPlansV2.js');
const { validateDungeonPlanV2 } = await import('../../../src/dungeon-v2/DungeonPlanV2Validator.js');
const { assembleDungeonPlanV2 } = await import('../../../src/dungeon-v2/DungeonSceneAssemblerV2.js');

function acceptedGoldenCandidate() {
  const candidate = createGoldenDungeonPlanV2({
    seed: 'm1-golden-magma',
    undercroftType: 'magma',
  });
  const validation = validateDungeonPlanV2(candidate);
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  return validation.plan;
}

function createActualSpawner() {
  const added = [];
  const marked = [];
  const spawner = Object.create(EnemySpawner.prototype);
  spawner.runSeed = 'unrelated-ambient-seed';
  spawner.spawnSerial = 0;
  spawner.getDifficulty = () => 1;
  spawner.game = {
    player: { root: new THREE.Group() },
    setBusterCombatDepthLevel() {},
    addEnemy(enemy) { added.push(enemy); },
    dungeonController: {
      markEncounterSpawned(id, enemies) { marked.push({ id, enemies }); },
    },
  };
  return { spawner, added, marked };
}

test('assembled m1-golden-magma spawns the raised Assembly enemy with its actual route-safe genome and salvage', () => {
  const plan = acceptedGoldenCandidate();
  const facade = assembleDungeonPlanV2(plan, { difficulty: 1 });
  try {
    const planned = plan.encounters.find(({ id }) => id === 'encounter.assembly');
    const runtime = facade.encounters.find(({ id }) => id === planned.id);
    assert.deepEqual(runtime.slotGenerationPolicies, planned.slotGenerationPolicies,
      'assembler discarded or invented the plan-owned slot policy');

    const { spawner, added, marked } = createActualSpawner();
    const enemies = spawner.spawnEncounter(runtime);
    const raised = enemies[1];

    assert.equal(enemies.length, 2);
    assert.equal(added.length, 2);
    assert.equal(marked.length, 1);
    assert.equal(enemies[0].planOwnedGenerationPolicy, undefined,
      'the unprotected ground slot was unexpectedly rewritten');
    assert.equal(raised.genome.archetypeId, 'shieldSentinel');
    assert.equal(raised.genome.body.planId, 'tripod');
    assert.equal(raised.genome.modules.weapon.id, 'flameNozzle');
    assert.equal(raised.genome.modules.weapon.attackKind, 'flamethrower');
    assert.equal(raised.genome.modules.defense.id, 'directionalShield');
    assert.equal(raised.genome.modules.weakPoint.id, 'eyeLens');
    assert.equal(raised.affix, null,
      'random elite promotion reintroduced an unverified combat capability');
    assert.equal(raised.planOwnedGenerationPolicy.id,
      'generation-policy.assembly.elevated-route-safe-v1');
    assert.equal(raised.planOwnedGenerationPolicy.elitePolicy, 'forbid');
    assert.deepEqual(raised.planOwnedGenerationPolicy.protectedTraversalLinkIds,
      ['traversal.assembly.landmark-stairs']);
    assert.equal(raised.planOwnedGenerationPolicy.verified, true);
    assert.equal(raised.planOwnedGenerationPolicy.capabilities.maximumReactionTier, 0);
    assert.equal(raised.planOwnedGenerationPolicy.capabilities.powerfulKnockback, false);
    assert.equal(raised.planOwnedGenerationPolicy.capabilities.externalPlayerControl, false);
    assert.equal(raised.planOwnedGenerationPolicy.capabilities.routeEjecting, false);
    assert.ok(raised.salvageProfile.length > 0,
      'real generated Reaverbot no longer uses its existing salvage profile');

    const incomingHits = [];
    const attackDirection = new THREE.Vector3(1, 0, 0);
    raised.root.updateMatrixWorld(true);
    const muzzlePosition = new THREE.Vector3();
    raised.visual.weapon.muzzle.getWorldPosition(muzzlePosition);
    raised.brain.attackDirection.copy(attackDirection);
    raised.brain.tickTimer = -1;
    const targetPosition = muzzlePosition.clone().addScaledVector(attackDirection, 2);
    targetPosition.y = muzzlePosition.y - 1;
    raised._updateFlamethrower(1, {
      player: {
        root: { position: targetPosition },
        radius: 0.42,
        takeIncomingHit(hit) {
          incomingHits.push(hit);
          return { contacted: true, dodged: false, immune: false, healthDamage: 0 };
        },
      },
      updateFlamethrowerEffect() {},
      addHitEffect() {},
    });
    assert.equal(incomingHits.length, 1,
      'the actual raised enemy did not exercise its declared flamethrower hit path');
    assert.equal(incomingHits[0].reactionTier, 0);
    assert.equal(Object.hasOwn(incomingHits[0], 'knockbackDirection'), false);
    assert.equal(Object.hasOwn(incomingHits[0], 'knockbackStrength'), false);
  } finally {
    facade.dispose();
  }
});

test('golden validation rejects a missing or route-ejecting Assembly raised-slot policy', () => {
  const missing = structuredClone(acceptedGoldenCandidate());
  missing.encounters.find(({ id }) => id === 'encounter.assembly').slotGenerationPolicies = [];
  const missingValidation = validateDungeonPlanV2(missing);
  assert.equal(missingValidation.accepted, false);
  assert.ok(missingValidation.errors.some(({ code }) => (
    code === 'assembly-elevated-route-generation-policy-missing'
  )));

  const unsafe = structuredClone(acceptedGoldenCandidate());
  const policy = unsafe.encounters.find(({ id }) => id === 'encounter.assembly')
    .slotGenerationPolicies[0];
  policy.generationContext.weaponId = 'pulseCannon';
  policy.capabilityContract.permittedAttackKinds = ['projectile'];
  policy.capabilityContract.maximumPlayerReactionTier = 1;
  const unsafeValidation = validateDungeonPlanV2(unsafe);
  assert.equal(unsafeValidation.accepted, false);
  assert.ok(unsafeValidation.errors.some(({ code }) => (
    code === 'encounter-slot-generation-policy-capability-invalid'
  )));
});
