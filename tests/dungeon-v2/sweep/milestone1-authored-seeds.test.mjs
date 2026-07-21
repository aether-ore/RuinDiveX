import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { stablePlanStringify } from '../../../src/dungeon-v2/DungeonPlanDiagnostics.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assertAcceptedDungeonFixture } from '../helpers/accepted-fixture.mjs';

const authoredSeeds = Array.from({ length: 8 }, (_, index) => `m1-authored-sweep-${index}`);

test('Milestone 1 authored golden seeds are deterministic and acceptance-gated', () => {
  for (const seed of authoredSeeds) {
    for (const undercroftType of ['magma', 'electrical']) {
      const first = createGoldenDungeonPlanV2({ seed, undercroftType });
      const second = createGoldenDungeonPlanV2({ seed, undercroftType });
      assert.equal(first.accepted, undefined);
      const firstValidation = validateDungeonPlanV2(first);
      const secondValidation = validateDungeonPlanV2(second);
      assert.equal(firstValidation.accepted, true, JSON.stringify(firstValidation.errors, null, 2));
      assert.equal(secondValidation.accepted, true, JSON.stringify(secondValidation.errors, null, 2));
      assertAcceptedDungeonFixture(firstValidation.plan, { stage: 'plan', profile: 'golden' });
      assert.equal(firstValidation.diagnosticHash, secondValidation.diagnosticHash);
      assert.equal(stablePlanStringify(first), stablePlanStringify(second));
    }
  }
});
