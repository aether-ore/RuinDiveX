// RETIRED: rotated whole generic plans instead of assembling native fixed rooms independently.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOLDEN_MODULE_DESCRIPTORS_V2,
  TRAVERSAL_LAB_MODULE_DESCRIPTORS_V2,
  createGoldenDungeonPlanV2,
  createTraversalLabPlanV2,
} from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { transformBoundsQuarterTurns } from '../../../src/dungeon-v2/DungeonSpatialMathV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { assertAcceptedDungeonFixture } from '../helpers/accepted-fixture.mjs';
import {
  ASSEMBLED_MODULE_YAW_COVERAGE,
  rotateAuthoredDungeonFixturePlan,
} from '../helpers/rotated-authored-fixtures.mjs';
import {
  buildIndependentPortalRouteProofs,
  buildMechanismStateProofs,
  buildOffscreenStructuralRenderProof,
  buildStructuralAssemblyProof,
} from '../helpers/assembly-proofs.mjs';

const FAMILIES = [
  {
    id: 'golden',
    descriptors: GOLDEN_MODULE_DESCRIPTORS_V2,
    create: () => createGoldenDungeonPlanV2({
      seed: 'm1-module-yaw-golden',
      undercroftType: 'magma',
    }),
  },
  {
    id: 'traversal-lab',
    descriptors: TRAVERSAL_LAB_MODULE_DESCRIPTORS_V2,
    create: () => createTraversalLabPlanV2({ seed: 'm1-module-yaw-lab' }),
  },
];

function maximumBoundsDelta(left, right) {
  return Math.max(...['x', 'y', 'z'].flatMap((axis) => [
    Math.abs(left.min[axis] - right.min[axis]),
    Math.abs(left.max[axis] - right.max[axis]),
  ]));
}

function assertAssembledModuleYawFixture(family, yawQuarterTurns) {
  const basePlan = family.create();
  const rawRotatedPlan = rotateAuthoredDungeonFixturePlan(basePlan, yawQuarterTurns);
  const validation = validateDungeonPlanV2(rawRotatedPlan);
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const plan = validation.plan;
  const expectedDescriptorIds = family.descriptors.map((descriptor) => descriptor.id).sort();
  assert.deepEqual(plan.modulePlacements.map((placement) => placement.descriptorId).sort(), expectedDescriptorIds);
  assert.equal(plan.modulePlacements.every((placement) => placement.yawQuarterTurns === yawQuarterTurns), true);

  const basePlacementById = new Map(basePlan.modulePlacements.map((placement) => [placement.id, placement]));
  for (const placement of plan.modulePlacements) {
    const basePlacement = basePlacementById.get(placement.id);
    assert.ok(basePlacement, placement.id);
    const expectedBounds = transformBoundsQuarterTurns(basePlacement.bounds, { yawQuarterTurns });
    assert.ok(maximumBoundsDelta(placement.bounds, expectedBounds) <= 1e-8,
      `${placement.descriptorId} yaw ${yawQuarterTurns} placement bounds are not its physical D4 transform`);
  }

  const facade = assembleDungeonPlanV2(plan);
  try {
    assertAcceptedDungeonFixture({
      stage: 'assembly',
      plan,
      facade,
      proofs: {
        visualCollider: buildStructuralAssemblyProof(plan, facade),
        portalRoutes: buildIndependentPortalRouteProofs(plan, facade),
        mechanismStates: buildMechanismStateProofs(plan, facade),
        offscreenStructuralRender: buildOffscreenStructuralRenderProof(plan, facade),
      },
    });
    const registeredPlanIds = facade.structuralRegistry.byPlanId;
    for (const placement of plan.modulePlacements) {
      const regionId = placement.regionIds[0];
      assert.ok(plan.structuralBoundaries.some((boundary) => (
        boundary.regionId === regionId && registeredPlanIds.has(boundary.id)
      )), `${placement.descriptorId} yaw ${yawQuarterTurns} has no assembled registered shell`);
      assert.ok(plan.walkableSurfaces.some((surface) => (
        surface.regionId === regionId && registeredPlanIds.has(surface.id)
      )), `${placement.descriptorId} yaw ${yawQuarterTurns} has no assembled registered walkable surface`);
      assert.ok(plan.structuralFixtures.some((fixture) => (
        fixture.regionId === regionId && registeredPlanIds.has(fixture.id)
      )), `${placement.descriptorId} yaw ${yawQuarterTurns} has no assembled registered functional fixture`);
    }
  } finally {
    facade.dispose();
  }
}

test('authored module yaw matrix names every complete descriptor and all four supported yaws', () => {
  assert.deepEqual(ASSEMBLED_MODULE_YAW_COVERAGE, [0, 1, 2, 3]);
  assert.equal(GOLDEN_MODULE_DESCRIPTORS_V2.length, 17);
  assert.equal(TRAVERSAL_LAB_MODULE_DESCRIPTORS_V2.length, 9);
  assert.equal(new Set(FAMILIES.flatMap((family) => family.descriptors.map(({ id }) => id))).size, 26);
});

for (const family of FAMILIES) {
  for (const yawQuarterTurns of ASSEMBLED_MODULE_YAW_COVERAGE) {
    test(`${family.id} complete modules pass real assembled acceptance at yaw ${yawQuarterTurns}`, () => {
      assertAssembledModuleYawFixture(family, yawQuarterTurns);
    });
  }
}
