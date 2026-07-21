import test from 'node:test';
import assert from 'node:assert/strict';
import { createTraversalLabPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';

function diagnosticCodes(result) {
  return (result.errors ?? []).map(({ code }) => code);
}

test('validator rejects a semantic room-pack integration that still owns blocking work', () => {
  const plan = structuredClone(createTraversalLabPlanV2({
    seed: 'semantic-room-pack-incomplete-rejection',
  }));
  plan.semanticRoomPackIntegration = {
    revision: 1,
    fullyIntegrated: false,
    acceptanceBlocking: true,
    diagnostics: [{
      code: 'semantic-room-pack-functional-socket-route-pending',
      acceptanceBlocking: true,
    }],
  };

  const result = validateDungeonPlanV2(plan);
  assert.equal(result.accepted, false);
  assert.ok(diagnosticCodes(result).includes('semantic-room-pack-integration-incomplete'));
});

test('fullyIntegrated false remains rejecting even if a caller clears acceptanceBlocking', () => {
  const plan = structuredClone(createTraversalLabPlanV2({
    seed: 'semantic-room-pack-false-flag-rejection',
  }));
  plan.semanticRoomPackIntegration = {
    revision: 1,
    fullyIntegrated: false,
    acceptanceBlocking: false,
    diagnostics: [],
  };

  const result = validateDungeonPlanV2(plan);
  assert.equal(result.accepted, false);
  assert.ok(diagnosticCodes(result).includes('semantic-room-pack-integration-incomplete'));
});
