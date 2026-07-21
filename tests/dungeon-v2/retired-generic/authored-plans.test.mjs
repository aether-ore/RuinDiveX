// RETIRED: plan declarations passed without proving native V1 fixed-room playability.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGoldenDungeonPlanV2,
  createTraversalLabPlanV2,
} from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assertAcceptedDungeonFixture } from '../helpers/accepted-fixture.mjs';

function acceptedPlan(rawPlan) {
  assert.equal(rawPlan.accepted, undefined, 'authored builders must return unaccepted plan data');
  const validation = validateDungeonPlanV2(rawPlan);
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  assert.equal(validation.plan.accepted, true);
  return validation.plan;
}

const goldenCases = [
  ['magma', 'm1-golden-magma'],
  ['electrical', 'm1-golden-electrical'],
];

for (const [undercroftType, seed] of goldenCases) {
  test(`${undercroftType} authored golden plan passes the universal plan gate`, () => {
    const plan = acceptedPlan(createGoldenDungeonPlanV2({ seed, undercroftType }));
    assertAcceptedDungeonFixture(plan, { stage: 'plan', profile: 'golden' });
    assert.equal(plan.regions.length, 17);
    assert.equal(plan.districts.length, 3);
    assert.equal(plan.districts.find(({ id }) => id === 'undercroft')?.undercroftType, undercroftType);
    assert.equal(
      plan.buildFingerprint,
      `dungeon-v2/restart-m1/schema-1/golden-complex/${undercroftType}/${seed}`,
    );
    assert.equal(plan.assemblyContract.noPrimitiveFallback, true);
    assert.equal(plan.assemblyContract.noExteriorVoid, true);
    assert.equal(plan.recoverySafeguard.planeY, Math.min(...plan.walkableSurfaces.map(({ bounds }) => bounds.min.y)) - 8);
  });
}

test('traversal lab authored plan passes the universal plan gate', () => {
  const plan = acceptedPlan(createTraversalLabPlanV2({ seed: 'm1-traversal-lab' }));
  assertAcceptedDungeonFixture(plan, { stage: 'plan', profile: 'traversal-lab' });
  assert.equal(
    plan.buildFingerprint,
    'dungeon-v2/restart-m1/schema-1/traversal-lab/mechanisms/m1-traversal-lab',
  );
  assert.equal(plan.districts.length, 1);
  assert.ok(plan.mechanisms.some(({ type, recallable }) => type === 'cargo-lift' && recallable));
  assert.ok(plan.mechanisms.some(({ type, automaticTravel }) => type === 'moving-cargo' && automaticTravel));
  assert.ok(plan.mechanisms.some(({ type, automaticReset }) => type === 'crumbling-floor' && automaticReset));
  assert.ok(plan.portals.some(({ approachType }) => approachType === 'intentional-drop'));
});
