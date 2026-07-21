import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createGoldenDungeonPlanV2,
  createTraversalLabPlanV2,
} from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';

const TOLERANCE = 0.05;

function accepted(rawPlan) {
  const validation = validateDungeonPlanV2(rawPlan);
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  return validation.plan;
}

function maximumBoundsDelta(actual, expected) {
  return Math.max(...['x', 'y', 'z'].flatMap((axis) => [
    Math.abs(actual.min[axis] - expected.min[axis]),
    Math.abs(actual.max[axis] - expected.max[axis]),
  ]));
}

function intersects(left, right) {
  return left.max.x > right.min.x && left.min.x < right.max.x
    && left.max.y > right.min.y && left.min.y < right.max.y
    && left.max.z > right.min.z && left.min.z < right.max.z;
}

function assertMechanismSupportAssembly(plan, facade) {
  facade.group.updateMatrixWorld(true);
  const fixtureById = new Map(plan.structuralFixtures.map((fixture) => [fixture.id, fixture]));
  const surfaceById = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
  for (const mechanism of plan.mechanisms.filter(({ runtimeProfile }) => runtimeProfile?.dynamicSurfaceId)) {
    const dynamicSurface = surfaceById.get(mechanism.runtimeProfile.dynamicSurfaceId);
    const halfX = (dynamicSurface.bounds.max.x - dynamicSurface.bounds.min.x) * 0.5;
    const halfZ = (dynamicSurface.bounds.max.z - dynamicSurface.bounds.min.z) * 0.5;
    for (const supportFixtureId of dynamicSurface.supportFixtureIds) {
      const fixture = fixtureById.get(supportFixtureId);
      const record = facade.structuralRegistry.byPlanId.get(supportFixtureId);
      assert.ok(fixture && record, `${mechanism.id} support lacks plan/registry parity`);
      assert.ok(record.visualIds.length > 0 && record.colliderIds.length > 0,
        `${mechanism.id} support must be both visible and colliding`);
      const visualBounds = record.visualIds.reduce((union, visualId) => (
        union.union(new THREE.Box3().setFromObject(facade.structuralRegistry.visuals.get(visualId)))
      ), new THREE.Box3());
      assert.ok(maximumBoundsDelta(visualBounds, fixture.bounds) <= TOLERANCE,
        `${mechanism.id} assembled support does not span its complete authored route frame`);
      const colliders = record.colliderIds.map((colliderId) => (
        facade.structuralRegistry.colliders.get(colliderId)
      ));
      assert.equal(colliders.every((collider) => collider?.active !== false && collider?.enabled !== false), true,
        `${mechanism.id} support contains an inactive stable-route collider`);

      for (const state of mechanism.states.filter((candidate) => candidate.stable !== false && candidate.position)) {
        assert.ok(fixture.supportedStateIds.includes(state.id),
          `${mechanism.id}:${state.id} is absent from its visible support contract`);
        const surfaceY = Number(state.surfaceY ?? state.elevation ?? state.position.y);
        const playerClearancePrism = {
          min: {
            x: state.position.x - halfX,
            y: surfaceY + 0.21,
            z: state.position.z - halfZ,
          },
          max: {
            x: state.position.x + halfX,
            y: surfaceY + 3.2,
            z: state.position.z + halfZ,
          },
        };
        assert.equal(colliders.some((collider) => intersects(collider.bounds, playerClearancePrism)), false,
          `${mechanism.id}:${state.id} support intrudes into the platform/player clearance volume`);
      }

      if (mechanism.type === 'moving-cargo') {
        const highestSurfaceY = Math.max(...mechanism.states
          .filter((state) => state.stable !== false)
          .map((state) => Number(state.surfaceY ?? state.elevation ?? state.position.y)));
        assert.ok(fixture.overheadRailY >= highestSurfaceY + 3.2,
          `${mechanism.id} overhead track is not above player headroom`);
        assert.ok(colliders.some(({ bounds }) => (
          Math.abs(bounds.max.y - fixture.overheadRailY) <= TOLERANCE
        )), `${mechanism.id} overhead rail is not assembled at its declared route height`);
      }
    }
  }
}

for (const [fixtureId, rawPlan] of [
  ['lab', createTraversalLabPlanV2({ seed: 'mechanism-support-lab' })],
  ['golden-magma', createGoldenDungeonPlanV2({ seed: 'mechanism-support-magma', undercroftType: 'magma' })],
  ['golden-electrical', createGoldenDungeonPlanV2({ seed: 'mechanism-support-electrical', undercroftType: 'electrical' })],
]) {
  test(`${fixtureId} assembles full-route support around every stable mechanism pose`, () => {
    const plan = accepted(rawPlan);
    const facade = assembleDungeonPlanV2(plan);
    try {
      assertMechanismSupportAssembly(plan, facade);
    } finally {
      facade.dispose();
    }
  });
}
