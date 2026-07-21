import test from 'node:test';
import assert from 'node:assert/strict';
import { createTraversalLabPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { DungeonGeneratorV2 } from '../../../src/dungeon-v2/DungeonGeneratorV2.js';

function invalidPreviewPlan() {
  const validation = validateDungeonPlanV2(createTraversalLabPlanV2({
    seed: 'invalid-preview-assembly-unit',
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const plan = structuredClone(validation.plan);
  plan.accepted = false;
  plan.validation = {
    accepted: false,
    diagnosticHash: 'invalid-preview-assembly-unit',
  };
  plan.traversalLinks[0].fromSurfaceId = 'surface.missing.invalid-preview-unit';
  return plan;
}

test('strict assembly still rejects a plan that failed validation', () => {
  assert.throws(
    () => assembleDungeonPlanV2(invalidPreviewPlan()),
    /not validated\/accepted/u,
  );
});

test('V2 gameplay opts into invalid preview by default while retaining a strict mode', () => {
  assert.equal(new DungeonGeneratorV2().allowInvalidPreview, true);
  assert.equal(new DungeonGeneratorV2({ allowInvalidPreview: false }).allowInvalidPreview, false);
});

test('explicit invalid preview assembly remains playable without changing acceptance', () => {
  const plan = invalidPreviewPlan();
  const facade = assembleDungeonPlanV2(plan, { allowInvalidPreview: true });
  try {
    assert.ok(facade.group);
    assert.equal(plan.accepted, false);
    assert.equal(plan.validation.accepted, false);
    assert.equal(facade.internalTraversalProof.accepted, false);
    assert.equal(facade.internalTraversalProof.previewOnly, true);
  } finally {
    facade.dispose?.();
  }
});
