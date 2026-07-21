import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import Game from '../../../src/Game.js';
import { createTraversalLabPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';

function distanceToBounds(position, descriptor) {
  const dx = position.x < descriptor.minX ? descriptor.minX - position.x
    : position.x > descriptor.maxX ? position.x - descriptor.maxX : 0;
  const dz = position.z < descriptor.minZ ? descriptor.minZ - position.z
    : position.z > descriptor.maxZ ? position.z - descriptor.maxZ : 0;
  return Math.hypot(dx, dz);
}

function updateAt(facade, position) {
  const context = {
    dungeon: facade,
    dungeonRenderCullGroups: facade.renderCullGroups,
    dungeonRenderCullAccumulator: 0,
    dungeonRenderCullStats: {},
    player: { root: { position } },
    camera: { position },
    _distanceToRenderCullBounds: Game.prototype._distanceToRenderCullBounds,
  };
  Game.prototype._updateDungeonRenderCulling.call(context, 1, { force: true });
  return context.dungeonRenderCullStats;
}

test('V2 static render groups cannot hide visible structure inside the real 120m camera range', () => {
  const validation = validateDungeonPlanV2(createTraversalLabPlanV2({ seed: 'render-cull-safety' }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const facade = assembleDungeonPlanV2(validation.plan);
  try {
    const workload = facade.assemblyPerformance;
    assert.ok(workload.visibleShadowCasterCount <= 80,
      `traversal lab retained ${workload.visibleShadowCasterCount} global shadow casters`);
    assert.ok(workload.visibleReceiverOnlyMeshCount > workload.visibleShadowCasterCount * 8);
    for (const boundary of validation.plan.structuralBoundaries) {
      const visuals = facade.structuralRegistry.byPlanId.get(boundary.id)?.visualIds
        ?.map((id) => facade.structuralRegistry.visuals.get(id)) ?? [];
      if (['gate-barrier', 'movable-gate-barrier'].includes(boundary.kind)) continue;
      assert.ok(visuals.length > 0);
      assert.equal(visuals.every((visual) => visual.castShadow === false), true,
        `${boundary.id} still submits enclosure panels to the shadow map`);
    }
    assert.ok(facade.renderCullGroups.length > 0);
    for (const descriptor of facade.renderCullGroups) {
      assert.ok(descriptor.hideDistance >= 128);
      assert.ok(descriptor.showDistance > 120 && descriptor.showDistance < descriptor.hideDistance);
      assert.equal(descriptor.maximumCameraRayDistance, 120);
      assert.ok(descriptor.safetyMargin >= 8);
      assert.equal(descriptor.staticOnly, true);
      assert.ok(descriptor.group.children.length > 0);
      assert.equal(descriptor.group.children.some((object) => (
        object.name?.startsWith('v2DynamicSurfaceRoot:')
        || object.name?.startsWith('v2GateMotionRoot:')
      )), false);

      descriptor.group.updateWorldMatrix(true, true);
      const actual = new THREE.Box3().setFromObject(descriptor.group);
      assert.ok(actual.min.x >= descriptor.minX - 0.001 && actual.max.x <= descriptor.maxX + 0.001);
      assert.ok(actual.min.z >= descriptor.minZ - 0.001 && actual.max.z <= descriptor.maxZ + 0.001);

      const proofPositions = [
        new THREE.Vector3(descriptor.minX - 120, 0, (descriptor.minZ + descriptor.maxZ) * 0.5),
        new THREE.Vector3(descriptor.maxX + 120, 0, (descriptor.minZ + descriptor.maxZ) * 0.5),
        new THREE.Vector3((descriptor.minX + descriptor.maxX) * 0.5, 0, descriptor.minZ - 120),
        new THREE.Vector3((descriptor.minX + descriptor.maxX) * 0.5, 0, descriptor.maxZ + 120),
      ];
      for (const position of proofPositions) {
        assert.ok(distanceToBounds(position, descriptor) <= 120 + 0.001);
        descriptor.group.visible = false;
        updateAt(facade, position);
        assert.equal(descriptor.group.visible, true,
          `${descriptor.id} stayed hidden from a valid 120m camera ray origin`);
      }
    }

    for (const anchor of [...validation.plan.anchors, ...validation.plan.safeAnchors]) {
      const position = new THREE.Vector3(anchor.position.x, anchor.position.y, anchor.position.z);
      for (const descriptor of facade.renderCullGroups) {
        descriptor.group.visible = false;
      }
      const stats = updateAt(facade, position);
      for (const descriptor of facade.renderCullGroups) {
        if (distanceToBounds(position, descriptor) <= 120) {
          assert.equal(descriptor.group.visible, true,
            `${descriptor.id} was hidden within 120m of ${anchor.id}`);
        }
      }
      assert.equal(stats.maximumCameraProofDistance, 120);
      assert.equal(stats.minimumV2HideDistance, 128);
    }
  } finally {
    facade.dispose();
  }
});
