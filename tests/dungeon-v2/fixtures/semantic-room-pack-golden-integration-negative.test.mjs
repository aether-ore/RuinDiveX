import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { integrateSemanticRoomPackGoldenPlanV2 } from '../../../src/dungeon-v2/SemanticRoomPackGoldenIntegrationV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';

function mutableGolden(undercroftType = 'magma') {
  return structuredClone(createGoldenDungeonPlanV2({
    seed: `semantic-room-pack-negative-${undercroftType}`,
    undercroftType,
  }));
}

test('diagnostic candidate fails the shared plan validator instead of becoming a false-positive accepted fixture', () => {
  for (const undercroftType of ['magma', 'electrical']) {
    const plan = mutableGolden(undercroftType);
    integrateSemanticRoomPackGoldenPlanV2(plan);
    const result = validateDungeonPlanV2(plan);
    const counts = Object.fromEntries([...new Set(result.errors.map(({ code }) => code))]
      .map((code) => [code, result.errors.filter((error) => error.code === code).length]));
    assert.equal(result.accepted, false);
    assert.equal(counts['semantic-room-pack-integration-incomplete'], 1);
    assert.equal(counts['occupied-volume-overlap'], 34);
    assert.equal(counts['stair-endpoint-overlap-short'], 1);
    assert.equal(counts['stair-endpoint-seam-gap'], 20);
  }
});

test('negative fixture rejects a missing route host rather than inventing fallback geometry', () => {
  const plan = mutableGolden();
  plan.spatialCells = plan.spatialCells.filter(({ id }) => id !== 'cell.parts.main');
  assert.throws(
    () => integrateSemanticRoomPackGoldenPlanV2(plan),
    /has no host cell cell\.parts\.main/u,
  );
});

test('negative fixture rejects missing global water ownership instead of creating a second water unit', () => {
  const plan = mutableGolden();
  plan.environmentStates = plan.environmentStates.filter(({ id }) => id !== 'environment.water-unit');
  assert.throws(
    () => integrateSemanticRoomPackGoldenPlanV2(plan),
    /cannot bind its conserved water geometry/u,
  );
});

test('negative fixture rejects an undercroft variant that differs from the seeded golden plan', () => {
  const plan = mutableGolden('magma');
  assert.throws(
    () => integrateSemanticRoomPackGoldenPlanV2(plan, { undercroftType: 'electrical' }),
    /does not match plan undercroft magma/u,
  );
});

test('negative fixture rejects duplicate integration rather than duplicating authored topology', () => {
  const plan = mutableGolden();
  integrateSemanticRoomPackGoldenPlanV2(plan);
  const counts = {
    modules: plan.modulePlacements.length,
    boundaries: plan.structuralBoundaries.length,
    surfaces: plan.walkableSurfaces.length,
  };
  assert.throws(() => integrateSemanticRoomPackGoldenPlanV2(plan), /already integrated/u);
  assert.equal(plan.modulePlacements.length, counts.modules);
  assert.equal(plan.structuralBoundaries.length, counts.boundaries);
  assert.equal(plan.walkableSurfaces.length, counts.surfaces);
});

test('negative fixture rejects frozen accepted plans and requires the raw mutable planning phase', () => {
  const plan = createGoldenDungeonPlanV2({ seed: 'semantic-room-pack-frozen', undercroftType: 'magma' });
  assert.equal(Object.isFrozen(plan.modulePlacements), true);
  assert.throws(
    () => integrateSemanticRoomPackGoldenPlanV2(plan),
    /requires mutable plan\.(?:regions|modulePlacements)/u,
  );
});
