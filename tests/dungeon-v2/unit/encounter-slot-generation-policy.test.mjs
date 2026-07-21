import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import {
  createEncounterSlotSeed,
  generateReaverbotGenome,
  validateReaverbotGenomeAgainstGenerationPolicy,
} from '../../../src/reaverbots/ReaverbotGenerator.js';
import { createReaverbotSalvageProfile } from '../../../src/reaverbots/ReaverbotSalvageCatalog.js';

function acceptedGolden() {
  const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
    seed: 'm1-golden-magma',
    undercroftType: 'magma',
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  return validation.plan;
}

test('Assembly raised slot owns an immutable serializable policy verified against its actual seeded genome', () => {
  const plan = acceptedGolden();
  const encounter = plan.encounters.find(({ id }) => id === 'encounter.assembly');
  const policy = encounter.slotGenerationPolicies.find(({ slotIndex }) => slotIndex === 1);
  assert.ok(policy);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(policy.elitePolicy, 'forbid');
  assert.doesNotThrow(() => JSON.stringify(policy));

  const genome = generateReaverbotGenome({
    seed: createEncounterSlotSeed(encounter.seed, encounter.id, policy.slotIndex),
    threatTier: 1,
    intent: encounter.roster[policy.slotIndex],
    encounterSize: encounter.roster.length,
    ...policy.generationContext,
  });
  const result = validateReaverbotGenomeAgainstGenerationPolicy(genome, policy);

  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(genome.archetypeId, 'shieldSentinel');
  assert.equal(genome.body.planId, 'tripod');
  assert.equal(genome.modules.weapon.id, 'flameNozzle');
  assert.equal(genome.modules.weapon.attackKind, 'flamethrower');
  assert.equal(genome.modules.defense.id, 'directionalShield');
  assert.equal(genome.modules.weakPoint.id, 'eyeLens');
  assert.deepEqual(result.capabilities, {
    attackKind: 'flamethrower',
    maximumReactionTier: 0,
    powerfulKnockback: false,
    externalPlayerControl: false,
    routeEjecting: false,
    verified: true,
  });
  assert.ok(createReaverbotSalvageProfile(genome).length > 0,
    'forcing traversal-safe modules bypassed the existing generated salvage profile');
});

test('slot capability validation fails closed for an attack without verified zero-displacement semantics', () => {
  const plan = acceptedGolden();
  const encounter = plan.encounters.find(({ id }) => id === 'encounter.assembly');
  const policy = structuredClone(encounter.slotGenerationPolicies[0]);
  policy.generationContext.weaponId = 'pulseCannon';
  policy.capabilityContract.permittedAttackKinds = ['projectile'];
  policy.capabilityContract.maximumPlayerReactionTier = 1;
  const genome = generateReaverbotGenome({
    seed: createEncounterSlotSeed(encounter.seed, encounter.id, policy.slotIndex),
    threatTier: 1,
    intent: encounter.roster[policy.slotIndex],
    encounterSize: encounter.roster.length,
    ...policy.generationContext,
  });

  const result = validateReaverbotGenomeAgainstGenerationPolicy(genome, policy);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('attack-displacement-capability-unverified'));
  assert.equal(result.capabilities.routeEjecting, true);
});
