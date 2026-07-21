import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createGoldenDungeonPlanV2,
  createTraversalLabPlanV2,
} from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import {
  buildDownwardVisibilityProof,
  buildIndependentPortalRouteProofs,
  buildInternalTraversalAndActionProofs,
  buildMechanismStateProofs,
  buildOffscreenStructuralRenderProof,
} from '../helpers/assembly-proofs.mjs';

function accepted(rawPlan) {
  const validation = validateDungeonPlanV2(rawPlan);
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  return validation.plan;
}

function colliderFlags(collider) {
  return {
    hasActive: Object.hasOwn(collider, 'active'),
    active: collider.active,
    hasEnabled: Object.hasOwn(collider, 'enabled'),
    enabled: collider.enabled,
  };
}

function runtimeSnapshot(facade) {
  const runtime = facade.environmentRuntime;
  return {
    controllers: runtime.controllers.map((controller) => ({
      id: controller.id,
      stateId: controller.stateId,
      phase: controller.phase,
      phaseElapsed: controller.phaseElapsed,
      targetStateId: controller.targetStateId,
    })),
    water: runtime.water ? {
      configurationId: runtime.water.configurationId,
      levels: [...runtime.water.levels],
      transfer: runtime.water.transfer,
    } : null,
    dynamic: [...runtime.resources.dynamicSurfaceByController].map(([id, surface]) => ({
      id,
      center: surface.center.toArray(),
      baseY: surface.baseY,
      topY: surface.topY,
      bounds: structuredClone(surface.bounds),
      ...colliderFlags(surface),
      objectPosition: runtime.resources.mechanismObjects.get(id)?.position.toArray() ?? null,
      objectVisible: runtime.resources.mechanismObjects.get(id)?.visible ?? null,
    })),
  };
}

test('assembled stair incline front faces match smooth collision from above and below', () => {
  const plan = accepted(createTraversalLabPlanV2({ seed: 'stair-face-winding-proof' }));
  const facade = assembleDungeonPlanV2(plan);
  try {
    const deltas = [];
    for (const surface of plan.walkableSurfaces.filter((candidate) => (
      ['stairs', 'walkable-stairs'].includes(candidate.geometry?.type)
    ))) {
      const path = surface.geometry.path;
      const start = path[0];
      const end = path.at(-1);
      const expectedTopY = (start.y + end.y) * 0.5;
      const x = (start.x + end.x) * 0.5;
      const z = (start.z + end.z) * 0.5;
      const record = facade.structuralRegistry.byPlanId.get(surface.id);
      const visual = facade.structuralRegistry.visuals.get(record.visualIds[0]);
      visual.updateWorldMatrix(true, true);

      const downward = new THREE.Raycaster(
        new THREE.Vector3(x, Math.max(start.y, end.y) + 3, z),
        new THREE.Vector3(0, -1, 0),
        0.01,
        20,
      ).intersectObject(visual, true)[0];
      const upward = new THREE.Raycaster(
        new THREE.Vector3(x, Math.min(start.y, end.y) - 3, z),
        new THREE.Vector3(0, 1, 0),
        0.01,
        20,
      ).intersectObject(visual, true)[0];
      assert.ok(downward, `${surface.id} has no front-facing walkable hit from above`);
      assert.ok(upward, `${surface.id} has no front-facing underside hit from below`);
      const downwardNormal = downward.face.normal.clone().transformDirection(downward.object.matrixWorld);
      const upwardNormal = upward.face.normal.clone().transformDirection(upward.object.matrixWorld);
      assert.ok(downwardNormal.y > 0.5, `${surface.id} walkable face is wound downward`);
      assert.ok(upwardNormal.y < -0.5, `${surface.id} underside is wound upward`);
      deltas.push({ surfaceId: surface.id, delta: Math.abs(downward.point.y - expectedTopY) });
    }
    assert.ok(deltas.length > 0);
    assert.deepEqual(deltas.filter(({ delta }) => delta > 0.0001), [], JSON.stringify(deltas, null, 2));
    const downwardProof = buildDownwardVisibilityProof(plan, facade);
    assert.deepEqual(
      downwardProof.invalidLowerHits.filter((hit) => hit.violations.includes('render-collision-height-mismatch')),
      [],
      JSON.stringify(downwardProof.invalidLowerHits, null, 2),
    );
  } finally {
    facade.dispose();
  }
});

test('portal proof opens only its bound gate and restores the exact closed runtime state', () => {
  const plan = accepted(createGoldenDungeonPlanV2({ seed: 'portal-gate-proof', undercroftType: 'magma' }));
  const facade = assembleDungeonPlanV2(plan);
  try {
    const portalId = 'portal.freight-security-shortcut';
    const door = facade.doors.find((candidate) => candidate.portalId === portalId);
    assert.ok(door, `${portalId} requires a runtime door`);
    const before = {
      opened: door.opened,
      closed: door.closed,
      locked: door.locked,
      objectPosition: door.object.position.toArray(),
      colliders: door.barrierColliders.map(colliderFlags),
    };

    const proofs = buildIndependentPortalRouteProofs(plan, facade);
    const proof = proofs.find((candidate) => candidate.portalId === portalId);
    assert.equal(proof.proofState.gateOpen, true);
    assert.equal(proof.proofState.gateId, door.id);
    assert.equal(proof.traversable, true, JSON.stringify(proof.blockedSamples, null, 2));
    assert.deepEqual({
      opened: door.opened,
      closed: door.closed,
      locked: door.locked,
      objectPosition: door.object.position.toArray(),
      colliders: door.barrierColliders.map(colliderFlags),
    }, before);
    assert.equal(facade.doors.filter((candidate) => candidate.opened).length, 0,
      'proof must not leave any gate open');
  } finally {
    facade.dispose();
  }
});

test('intentional-drop proof uses the bound collapsed runtime state and restores floor/support state', () => {
  const plan = accepted(createGoldenDungeonPlanV2({ seed: 'portal-crumble-proof', undercroftType: 'magma' }));
  const facade = assembleDungeonPlanV2(plan);
  try {
    const portalId = 'portal.assembly-freight-drop';
    const surfaceId = plan.portals.find(({ id }) => id === portalId)
      .physicalRoute.endpointSurfaceIds.from;
    const surfaceRecord = facade.structuralRegistry.byPlanId.get(surfaceId);
    const mechanism = plan.mechanisms.find(({ id }) => id === 'mechanism.freight-crumble');
    const supportIds = plan.structuralFixtures
      .filter((fixture) => fixture.mechanismId === mechanism.id)
      .map((fixture) => fixture.id);
    const planIds = [surfaceId, ...supportIds];
    const before = planIds.map((planId) => {
      const record = facade.structuralRegistry.byPlanId.get(planId);
      return {
        planId,
        visuals: record.visualIds.map((id) => facade.structuralRegistry.visuals.get(id).visible),
        colliders: record.colliderIds.map((id) => colliderFlags(facade.structuralRegistry.colliders.get(id))),
      };
    });
    assert.ok(surfaceRecord && supportIds.length > 0);

    const proof = buildIndependentPortalRouteProofs(plan, facade)
      .find((candidate) => candidate.portalId === portalId);
    assert.deepEqual(proof.proofState, {
      gateOpen: false,
      mechanismId: mechanism.id,
      stateId: 'Collapsed',
    });
    assert.equal(proof.traversable, true, JSON.stringify(proof.blockedSamples, null, 2));
    assert.equal(facade.environmentRuntime.controllerById.get(mechanism.id).stateId, mechanism.initialStateId);
    const after = planIds.map((planId) => {
      const record = facade.structuralRegistry.byPlanId.get(planId);
      return {
        planId,
        visuals: record.visualIds.map((id) => facade.structuralRegistry.visuals.get(id).visible),
        colliders: record.colliderIds.map((id) => colliderFlags(facade.structuralRegistry.colliders.get(id))),
      };
    });
    assert.deepEqual(after, before);
  } finally {
    facade.dispose();
  }
});

test('portal proof keeps an unrelated active collider as a real blocker', () => {
  const plan = accepted(createTraversalLabPlanV2({ seed: 'portal-unrelated-blocker' }));
  const facade = assembleDungeonPlanV2(plan);
  const registry = facade.structuralRegistry;
  const portal = plan.portals.find((candidate) => candidate.id === 'portal.lab-entry-stairs');
  const routePoints = portal.physicalRoute.routePoints;
  const point = routePoints[Math.floor(routePoints.length / 2)];
  const colliderId = 'collider.test.unrelated-active-blocker';
  registry.colliders.set(colliderId, {
    id: colliderId,
    planId: 'fixture.test.unrelated-active-blocker',
    obstacleKind: 'structuralFixture',
    active: true,
    bounds: {
      min: { x: point.x - 0.25, y: point.y + 0.8, z: point.z - 0.25 },
      max: { x: point.x + 0.25, y: point.y + 1.6, z: point.z + 0.25 },
    },
  });
  try {
    const proof = buildIndependentPortalRouteProofs(plan, facade)
      .find((candidate) => candidate.portalId === portal.id);
    assert.equal(proof.traversable, false);
    assert.ok(proof.blockedSamples.some((sample) => sample.colliderId === colliderId));
    assert.equal(registry.colliders.get(colliderId).active, true);
  } finally {
    registry.colliders.delete(colliderId);
    facade.dispose();
  }
});

test('mechanism state proofs enumerate actual stable states and restore runtime exactly', () => {
  const plan = accepted(createTraversalLabPlanV2({ seed: 'mechanism-proof-restoration' }));
  const facade = assembleDungeonPlanV2(plan);
  try {
    const before = runtimeSnapshot(facade);
    const proofs = buildMechanismStateProofs(plan, facade);
    const required = plan.mechanisms.flatMap((mechanism) => mechanism.states
      .filter((state) => state.stable !== false)
      .map((state) => `${mechanism.id}:${state.id}`));
    assert.deepEqual(proofs.map((proof) => `${proof.mechanismId}:${proof.stateId}`), required);
    assert.equal(proofs.every((proof) => proof.accepted), true,
      JSON.stringify(proofs.filter((proof) => !proof.accepted), null, 2));
    assert.equal(proofs.every((proof) => proof.maxRayRange === 120), true);
    assert.deepEqual(runtimeSnapshot(facade), before);
  } finally {
    facade.dispose();
  }
});

test('mechanism proof detects missing dynamic visual registration', () => {
  const plan = accepted(createTraversalLabPlanV2({ seed: 'mechanism-proof-parity-negative' }));
  const facade = assembleDungeonPlanV2(plan);
  const record = facade.structuralRegistry.byPlanId.get('surface.lab-recovery.lift');
  const visualId = record.visualIds[0];
  const visual = facade.structuralRegistry.visuals.get(visualId);
  facade.structuralRegistry.visuals.delete(visualId);
  try {
    const proof = buildMechanismStateProofs(plan, facade)
      .find((candidate) => candidate.mechanismId === 'mechanism.lab-lift');
    assert.equal(proof.accepted, false);
    assert.ok(proof.visualColliderMismatches.some(({ kind }) => kind === 'dynamic-registration-missing'));
  } finally {
    facade.structuralRegistry.visuals.set(visualId, visual);
    facade.dispose();
  }
});

test('mechanism proof detects a real 120m ceiling ray leak', () => {
  const plan = accepted(createTraversalLabPlanV2({ seed: 'mechanism-proof-ray-negative' }));
  const facade = assembleDungeonPlanV2(plan);
  const ceiling = facade.structuralRegistry.getVisual('boundary.lab-water-reservoir.ceiling');
  ceiling.visible = false;
  try {
    const proof = buildMechanismStateProofs(plan, facade)
      .find((candidate) => candidate.mechanismId === 'mechanism.water-router');
    assert.equal(proof.accepted, false);
    assert.ok(proof.clearSpaceRays.some(({ face }) => face === 'ceiling'));
    assert.equal(proof.maxRayRange, 120);
  } finally {
    ceiling.visible = true;
    facade.dispose();
  }
});

test('mechanism proof detects controls with no active physical support', () => {
  const plan = accepted(createTraversalLabPlanV2({ seed: 'mechanism-proof-control-negative' }));
  const facade = assembleDungeonPlanV2(plan);
  const floorColliders = [...facade.structuralRegistry.colliders.values()]
    .filter((collider) => collider.obstacleKind === 'floor');
  const originalFlags = floorColliders.map(colliderFlags);
  for (const collider of floorColliders) {
    collider.enabled = false;
    collider.active = false;
  }
  try {
    const proof = buildMechanismStateProofs(plan, facade)
      .find((candidate) => candidate.mechanismId === 'mechanism.water-router');
    assert.equal(proof.accepted, false);
    assert.equal(proof.controlsReachable, false);
    assert.ok(proof.controlProofs.some(({ reachable }) => !reachable));
  } finally {
    floorColliders.forEach((collider, index) => {
      const flags = originalFlags[index];
      if (flags.hasEnabled) collider.enabled = flags.enabled;
      else delete collider.enabled;
      if (flags.hasActive) collider.active = flags.active;
      else delete collider.active;
    });
    facade.dispose();
  }
});

test('offscreen proof rasterizes actual enclosed traversal-lab geometry and camera envelopes', () => {
  const plan = accepted(createTraversalLabPlanV2({ seed: 'offscreen-real-geometry' }));
  const facade = assembleDungeonPlanV2(plan);
  try {
    const proof = buildOffscreenStructuralRenderProof(plan, facade);
    assert.equal(proof.accepted, true, JSON.stringify({
      clearFrames: proof.clearFrames,
      transparentStructuralIds: proof.transparentStructuralIds,
      unpairedBoundarySamples: proof.unpairedBoundarySamples,
    }, null, 2));
    assert.equal(proof.rendererId, 'deterministic-cpu-triangle-rasterizer-v1');
    assert.ok(proof.opaqueTriangleCount > 100);
    assert.ok(proof.frames.length > plan.regions.length * 6);
    assert.ok(proof.frames.every((frame) => frame.renderedPixelCount > 0
      && frame.backgroundPixelCount === 0
      && /^[0-9a-f]{8}$/.test(frame.rasterHash)));
    assert.ok(proof.frames.some((frame) => frame.kind === 'third-person-camera-envelope'
      && frame.containmentApplied));
    const ladderShaftLanding = proof.downwardVisibility.lowerHits.find((hit) => (
      hit.sourceSurfaceId === 'surface.lab-water-reservoir.main'
      && hit.targetSurfaceId === 'surface.connector.lab-reservoir-freight.2'
    ));
    assert.ok(ladderShaftLanding,
      'downward proof must ray past opaque ladder rungs and resolve the playable lower hallway');
    assert.deepEqual(ladderShaftLanding.violations, []);
  } finally {
    facade.dispose();
  }
});

test('offscreen proof rejects a transparent exterior ceiling using real assembled materials', () => {
  const plan = accepted(createTraversalLabPlanV2({ seed: 'offscreen-transparent-shell-negative' }));
  const facade = assembleDungeonPlanV2(plan);
  const boundaryId = 'boundary.lab-water-reservoir.ceiling';
  const ceiling = facade.structuralRegistry.getVisual(boundaryId);
  const originals = [];
  ceiling.traverse((object) => {
    const materials = Array.isArray(object.material) ? object.material : [object.material].filter(Boolean);
    for (const material of materials) {
      originals.push({ material, transparent: material.transparent, opacity: material.opacity });
      material.transparent = true;
      material.opacity = 0;
    }
  });
  try {
    const proof = buildOffscreenStructuralRenderProof(plan, facade);
    assert.equal(proof.accepted, false);
    assert.ok(proof.transparentStructuralIds.includes(boundaryId));
    assert.ok(proof.clearFrames.some(({ regionId }) => regionId === 'lab-water-reservoir'));
  } finally {
    for (const original of originals) {
      original.material.transparent = original.transparent;
      original.material.opacity = original.opacity;
    }
    facade.dispose();
  }
});

test('offscreen proof rejects a camera envelope that crosses an unpaired physical boundary', () => {
  const plan = accepted(createTraversalLabPlanV2({ seed: 'offscreen-camera-boundary-negative' }));
  const facade = assembleDungeonPlanV2(plan);
  const boundaryId = 'boundary.lab-recovery.east';
  const record = facade.structuralRegistry.byPlanId.get(boundaryId);
  const visual = facade.structuralRegistry.getVisual(boundaryId);
  const originalVisibility = visual.visible;
  const colliders = record.colliderIds.map((id) => facade.structuralRegistry.colliders.get(id));
  const originalFlags = colliders.map(colliderFlags);
  visual.visible = false;
  for (const collider of colliders) {
    collider.active = false;
    collider.enabled = false;
  }
  try {
    const proof = buildOffscreenStructuralRenderProof(plan, facade);
    assert.equal(proof.accepted, false);
    assert.ok(proof.unpairedBoundarySamples.some((sample) => (
      sample.anchorId === 'anchor.lab-lift.lower-console'
      && sample.facing === 'west'
      && sample.containmentPlanId === 'spatial-cell-union'
    )), JSON.stringify(proof.unpairedBoundarySamples, null, 2));
  } finally {
    visual.visible = originalVisibility;
    colliders.forEach((collider, index) => {
      const flags = originalFlags[index];
      if (flags.hasEnabled) collider.enabled = flags.enabled;
      else delete collider.enabled;
      if (flags.hasActive) collider.active = flags.active;
      else delete collider.active;
    });
    facade.dispose();
  }
});

test('downward ray proof rejects a real opaque lower backdrop with no playable surface owner', () => {
  const plan = accepted(createTraversalLabPlanV2({ seed: 'downward-inaccessible-backdrop-negative' }));
  const facade = assembleDungeonPlanV2(plan);
  const boundaryId = 'boundary.lab-entry.north';
  const boundaryVisual = facade.structuralRegistry.getVisual(boundaryId);
  const originalVisibility = boundaryVisual.visible;
  const source = plan.walkableSurfaces.find(({ id }) => id === 'surface.lab-entry.main');
  const sourceOriginY = source.bounds.max.y + 1.55;
  const horizontalDistance = 6;
  const backdropTopY = sourceOriginY - horizontalDistance * (0.57 / 0.82);
  const backdrop = new THREE.Mesh(
    new THREE.BoxGeometry(10, 0.2, 4),
    new THREE.MeshBasicMaterial({ color: 0x4a3024 }),
  );
  backdrop.position.set(
    (source.bounds.min.x + source.bounds.max.x) * 0.5,
    backdropTopY - 0.1,
    source.bounds.min.z + 0.14 - horizontalDistance,
  );
  facade.group.add(backdrop);
  const planId = 'negative.inaccessible-lower-backdrop';
  const record = facade.structuralRegistry.register(planId, {
    visual: backdrop,
    role: 'boundary:floor',
    regionId: null,
  });
  boundaryVisual.visible = false;
  try {
    const proof = buildDownwardVisibilityProof(plan, facade);
    assert.equal(proof.accepted, false);
    assert.ok(proof.unresolvedLowerHits.some((hit) => (
      hit.hitPlanId === planId
      && hit.sampleId === 'surface.lab-entry.main:north:0.5'
    )), JSON.stringify(proof.unresolvedLowerHits, null, 2));
  } finally {
    boundaryVisual.visible = originalVisibility;
    for (const visualId of record.visualIds) {
      facade.structuralRegistry.visuals.delete(visualId);
      facade.structuralRegistry.visualMetadata.delete(visualId);
    }
    facade.structuralRegistry.byPlanId.delete(planId);
    facade.group.remove(backdrop);
    backdrop.geometry.dispose();
    backdrop.material.dispose();
    facade.dispose();
  }
});

test('unregistered decorative geometry cannot mask a real structural shell leak', () => {
  const plan = accepted(createTraversalLabPlanV2({ seed: 'decorative-leak-mask-negative' }));
  const facade = assembleDungeonPlanV2(plan);
  const boundaryId = 'boundary.lab-water-reservoir.ceiling';
  const ceiling = facade.structuralRegistry.getVisual(boundaryId);
  const boundary = plan.structuralBoundaries.find(({ id }) => id === boundaryId);
  const size = new THREE.Vector3(
    boundary.bounds.max.x - boundary.bounds.min.x,
    Math.max(0.05, boundary.bounds.max.y - boundary.bounds.min.y),
    boundary.bounds.max.z - boundary.bounds.min.z,
  );
  const decorativeMask = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshBasicMaterial({ color: 0x202832 }),
  );
  decorativeMask.name = 'negativeDecorativeCeilingMask';
  decorativeMask.position.set(
    (boundary.bounds.min.x + boundary.bounds.max.x) * 0.5,
    (boundary.bounds.min.y + boundary.bounds.max.y) * 0.5,
    (boundary.bounds.min.z + boundary.bounds.max.z) * 0.5,
  );
  facade.group.add(decorativeMask);
  const originalVisibility = ceiling.visible;
  ceiling.visible = false;
  try {
    const proof = buildOffscreenStructuralRenderProof(plan, facade);
    assert.equal(proof.accepted, false);
    assert.ok(proof.clearFrames.some(({ regionId }) => regionId === 'lab-water-reservoir'),
      'an unregistered decorative mesh must not satisfy the structural renderer');
  } finally {
    ceiling.visible = originalVisibility;
    facade.group.remove(decorativeMask);
    decorativeMask.geometry.dispose();
    decorativeMask.material.dispose();
    facade.dispose();
  }
});

test('player-capsule proof rejects a real obstruction inserted into an internal route', () => {
  const plan = accepted(createTraversalLabPlanV2({ seed: 'internal-route-obstruction-negative' }));
  const facade = assembleDungeonPlanV2(plan);
  const registry = facade.structuralRegistry;
  const initial = buildInternalTraversalAndActionProofs(plan, facade);
  const route = initial.linkProofs.find((proof) => (
    proof.accepted && !proof.delegatedToStableStateProof && proof.samples.length >= 3
  ));
  assert.ok(route, 'fixture requires at least one initially clear internal physical route');
  const sample = route.samples[Math.floor(route.samples.length / 2)];
  const colliderId = 'collider.negative.internal-route-obstruction';
  registry.colliders.set(colliderId, {
    id: colliderId,
    planId: 'negative.internal-route-obstruction',
    obstacleKind: 'structuralFixture',
    active: true,
    bounds: {
      min: { x: sample.x - 0.2, y: sample.y + 0.05, z: sample.z - 0.2 },
      max: { x: sample.x + 0.2, y: sample.y + 2.4, z: sample.z + 0.2 },
    },
  });
  try {
    const proof = buildInternalTraversalAndActionProofs(plan, facade);
    const blocked = proof.linkProofs.find(({ linkId }) => linkId === route.linkId);
    assert.equal(blocked.accepted, false);
    assert.ok(blocked.blockedSamples.some(({ colliderId: id }) => id === colliderId));
  } finally {
    registry.colliders.delete(colliderId);
    facade.dispose();
  }
});

test('player-capsule proof rejects a real obstruction across an action approach', () => {
  const plan = accepted(createTraversalLabPlanV2({ seed: 'action-approach-obstruction-negative' }));
  const facade = assembleDungeonPlanV2(plan);
  const registry = facade.structuralRegistry;
  const initial = buildInternalTraversalAndActionProofs(plan, facade);
  const clearAction = initial.actionProofs.find((proof) => {
    const action = plan.actions.find(({ id }) => id === proof.actionId);
    return proof.accepted && action?.interaction?.activationSide === 'front';
  });
  assert.ok(clearAction, 'fixture requires at least one initially clear front-only action approach');
  const action = plan.actions.find(({ id }) => id === clearAction.actionId);
  const anchor = [...plan.anchors, ...plan.safeAnchors].find(({ id }) => id === action.anchorId);
  const forward = new THREE.Vector3(anchor.forward.x, 0, anchor.forward.z).normalize();
  const near = new THREE.Vector3(anchor.position.x, anchor.position.y, anchor.position.z)
    .addScaledVector(forward, 0.45);
  const far = new THREE.Vector3(anchor.position.x, anchor.position.y, anchor.position.z)
    .addScaledVector(forward, action.interaction.radius);
  const colliderId = 'collider.negative.action-approach-obstruction';
  registry.colliders.set(colliderId, {
    id: colliderId,
    planId: 'negative.action-approach-obstruction',
    obstacleKind: 'structuralFixture',
    active: true,
    bounds: {
      min: { x: Math.min(near.x, far.x) - 0.75, y: anchor.position.y + 0.02, z: Math.min(near.z, far.z) - 0.75 },
      max: { x: Math.max(near.x, far.x) + 0.75, y: anchor.position.y + 3.1, z: Math.max(near.z, far.z) + 0.75 },
    },
  });
  try {
    const proof = buildInternalTraversalAndActionProofs(plan, facade);
    const blocked = proof.actionProofs.find(({ actionId }) => actionId === action.id);
    assert.equal(blocked.accepted, false);
    assert.ok(blocked.blockedSamples.some(({ colliderId: id }) => id === colliderId));
  } finally {
    registry.colliders.delete(colliderId);
    facade.dispose();
  }
});
