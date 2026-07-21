import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import Game from '../../../src/Game.js';
import { DungeonController } from '../../../src/DungeonController.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../../src/TraversalCapabilities.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';

const SAMPLE_DT = 1 / 60;
const EGRESS_SAMPLE_SPACING = 0.21;
const STRICT_OVERLAP = 0.025;
const GOLDEN_FIXTURES = Object.freeze([
  Object.freeze({
    label: 'm1-golden-magma',
    seed: 'm1-golden-magma',
    undercroftType: 'magma',
  }),
  Object.freeze({
    label: 'm1-golden-electrical',
    seed: 'm1-golden-electrical',
    undercroftType: 'electrical',
  }),
]);
const GOLDEN_LIFTS = Object.freeze([
  Object.freeze({
    label: 'Beta cargo lift',
    mechanismId: 'mechanism.cargo-lift',
    portalId: 'portal.salvage-sorting-shortcut',
    gateId: 'Gate_Shortcut_Beta',
  }),
  Object.freeze({
    label: 'Gamma return lift',
    mechanismId: 'mechanism.gamma-return-lift',
    portalId: 'portal.hazard-core-credential-return',
    gateId: 'Gate_Shortcut_Gamma',
  }),
]);
const BETA_LIFT = GOLDEN_LIFTS[0];
const acceptedGoldenPlanCache = new Map();

function acceptedGolden(goldenFixture) {
  if (acceptedGoldenPlanCache.has(goldenFixture.label)) {
    return acceptedGoldenPlanCache.get(goldenFixture.label);
  }
  const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
    seed: goldenFixture.seed,
    undercroftType: goldenFixture.undercroftType,
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  acceptedGoldenPlanCache.set(goldenFixture.label, validation.plan);
  return validation.plan;
}

function boundsFromCollider(collider) {
  if (collider?.bounds?.min && collider?.bounds?.max) {
    return new THREE.Box3(
      new THREE.Vector3(collider.bounds.min.x, collider.bounds.min.y, collider.bounds.min.z),
      new THREE.Vector3(collider.bounds.max.x, collider.bounds.max.y, collider.bounds.max.z),
    );
  }
  const center = collider?.position ?? collider?.center;
  const halfHeight = collider?.verticalHalfHeight
    ?? (Number.isFinite(collider?.height) ? collider.height * 0.5 : null);
  if (!center
    || !Number.isFinite(collider?.halfWidth)
    || !Number.isFinite(collider?.halfDepth)
    || !Number.isFinite(halfHeight)) return null;
  return new THREE.Box3(
    new THREE.Vector3(
      center.x - collider.halfWidth,
      Number.isFinite(collider.baseY) ? collider.baseY : center.y - halfHeight,
      center.z - collider.halfDepth,
    ),
    new THREE.Vector3(
      center.x + collider.halfWidth,
      Number.isFinite(collider.topY) ? collider.topY : center.y + halfHeight,
      center.z + collider.halfDepth,
    ),
  );
}

function strictIntersection(left, right, tolerance = STRICT_OVERLAP) {
  return Math.min(left.max.x, right.max.x) - Math.max(left.min.x, right.min.x) > tolerance
    && Math.min(left.max.y, right.max.y) - Math.max(left.min.y, right.min.y) > tolerance
    && Math.min(left.max.z, right.max.z) - Math.max(left.min.z, right.min.z) > tolerance;
}

function visibleInHierarchy(object) {
  for (let cursor = object; cursor; cursor = cursor.parent) {
    if (cursor.visible === false) return false;
  }
  return true;
}

function materiallyOpaque(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some((material) => material
    && material.visible !== false
    && (material.opacity ?? 1) >= 0.99);
}

function pointInsideStrictBounds(point, bounds, tolerance = STRICT_OVERLAP) {
  return point.x > bounds.min.x + tolerance && point.x < bounds.max.x - tolerance
    && point.y > bounds.min.y + tolerance && point.y < bounds.max.y - tolerance
    && point.z > bounds.min.z + tolerance && point.z < bounds.max.z - tolerance;
}

function colliderIntersectsSweep(collider, bounds, sweep) {
  if (!strictIntersection(bounds, sweep)) return false;
  if (collider.shape !== 'oriented-ramp-strip' || !Array.isArray(collider.collisionSamples)) {
    return true;
  }
  // The registry retains a conservative AABB for broad-phase lookup, while
  // collisionSamples are the authoritative oriented incline strip. Requiring
  // an inside sample prevents a diagonal stair's empty AABB corner from
  // becoming a false obstruction.
  return collider.collisionSamples.some((sample) => (
    sample.expectedInside === true && pointInsideStrictBounds(sample.position, sweep)
  ));
}

function meshIntersectsSweep(mesh, sweep) {
  const position = mesh.geometry?.attributes?.position;
  if (!position || position.count < 3) return false;
  const index = mesh.geometry.index;
  const triangle = new THREE.Triangle();
  const vertices = [triangle.a, triangle.b, triangle.c];
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertexIndex = index
        ? index.getX(triangleIndex * 3 + corner)
        : triangleIndex * 3 + corner;
      vertices[corner].fromBufferAttribute(position, vertexIndex).applyMatrix4(mesh.matrixWorld);
    }
    if (sweep.intersectsTriangle(triangle)) return true;
  }
  return false;
}

function liftFixture(plan, facade, contract = BETA_LIFT) {
  const mechanism = plan.mechanisms.find(({ id }) => id === contract.mechanismId);
  const portal = plan.portals.find(({ id }) => id === contract.portalId);
  const door = facade.doors.find(({ id }) => id === contract.gateId);
  const dynamicSurface = plan.walkableSurfaces.find(({ id }) => (
    id === mechanism?.runtimeProfile?.dynamicSurfaceId
  ));
  const lowerState = mechanism?.states.find(({ id }) => id === 'LowerLanding');
  const upperState = mechanism?.states.find(({ id }) => id === 'UpperLanding');
  assert.ok(mechanism && portal && door && dynamicSurface && lowerState && upperState,
    `seeded golden plan must own the complete ${contract.label} route`);
  return { contract, mechanism, portal, door, dynamicSurface, lowerState, upperState };
}

function settleDoorAtOpenPose(door) {
  door.setOpen(true);
  if (door.openPosition?.isVector3) {
    door.object.position.copy(door.openPosition);
  } else {
    door.object.position.y = door.openY;
  }
  assert.equal(door.closed, false);
  assert.ok(door.barrierColliders.every((collider) => collider.active === false),
    `${door.id} retained an active barrier collider after opening`);
}

function openingBounds(opening) {
  return {
    minX: opening.center.x - opening.dimensions.width * 0.5,
    maxX: opening.center.x + opening.dimensions.width * 0.5,
    minZ: opening.center.z - opening.dimensions.depth * 0.5,
    maxZ: opening.center.z + opening.dimensions.depth * 0.5,
  };
}

function assertPairedVerticalOpenings(plan, fixture) {
  const portalId = fixture.portal.id;
  const footprint = fixture.dynamicSurface.bounds;
  const endpointProofs = [fixture.portal.from, fixture.portal.to].map((endpoint) => {
    const boundary = plan.structuralBoundaries.find(({ id }) => id === endpoint.boundaryId);
    const openings = boundary?.openings?.filter((opening) => opening.portalId === portalId) ?? [];
    assert.equal(openings.length, 1,
      `${endpoint.boundaryId} must register exactly one opening paired to ${portalId}`);
    const opening = openings[0];
    const bounds = openingBounds(opening);
    assert.ok(
      bounds.minX <= footprint.min.x + STRICT_OVERLAP
        && bounds.maxX >= footprint.max.x - STRICT_OVERLAP
        && bounds.minZ <= footprint.min.z + STRICT_OVERLAP
        && bounds.maxZ >= footprint.max.z - STRICT_OVERLAP,
      `${endpoint.boundaryId} opening does not clear the complete moving-platform footprint`,
    );
    const capsuleMargin = PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
    assert.ok(
      bounds.minX <= footprint.min.x - capsuleMargin + STRICT_OVERLAP
        && bounds.maxX >= footprint.max.x + capsuleMargin - STRICT_OVERLAP
        && bounds.minZ <= footprint.min.z - capsuleMargin + STRICT_OVERLAP
        && bounds.maxZ >= footprint.max.z + capsuleMargin - STRICT_OVERLAP,
      `${endpoint.boundaryId} opening does not clear the moving platform plus the standing-player capsule radius`,
    );
    return {
      endpoint: endpoint.side,
      boundaryId: boundary.id,
      openingId: opening.id,
      portalId: opening.portalId,
      width: opening.dimensions.width,
      depth: opening.dimensions.depth,
    };
  });
  assert.deepEqual(endpointProofs.map(({ endpoint }) => endpoint), ['ceiling', 'floor']);
  assert.equal(endpointProofs[0].width, endpointProofs[1].width);
  assert.equal(endpointProofs[0].depth, endpointProofs[1].depth);
  return endpointProofs;
}

function sweptRiderBounds(fixture) {
  const lowerPlatformTop = fixture.lowerState.surfaceY
    + (fixture.dynamicSurface.bounds.max.y - fixture.dynamicSurface.bounds.min.y);
  const upperPlatformTop = fixture.upperState.surfaceY
    + (fixture.dynamicSurface.bounds.max.y - fixture.dynamicSurface.bounds.min.y);
  const riderHeadroom = Math.max(
    PLAYER_TRAVERSAL_ENVELOPE.standingHeight,
    PLAYER_TRAVERSAL_ENVELOPE.headClearance,
  );
  return new THREE.Box3(
    new THREE.Vector3(
      fixture.dynamicSurface.bounds.min.x - PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
      lowerPlatformTop + STRICT_OVERLAP,
      fixture.dynamicSurface.bounds.min.z - PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
    ),
    new THREE.Vector3(
      fixture.dynamicSurface.bounds.max.x + PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
      upperPlatformTop + riderHeadroom,
      fixture.dynamicSurface.bounds.max.z + PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
    ),
  );
}

function assertPlanOwnsFullRiderShaft(fixture, sweep) {
  const bounds = fixture.portal.physicalRoute?.fullHeightShaftBounds;
  const profile = fixture.portal.physicalRoute?.fullHeightShaftBoundsProfile;
  assert.equal(profile?.semantics, 'moving-deck-plus-standing-player-capsule-union');
  assert.equal(profile?.horizontalExpansion, PLAYER_TRAVERSAL_ENVELOPE.collisionRadius);
  assert.ok(profile?.minimumHeadroom >= PLAYER_TRAVERSAL_ENVELOPE.headClearance);
  assert.ok(bounds
    && bounds.min.x <= sweep.min.x + 1e-9
    && bounds.min.y <= sweep.min.y + 1e-9
    && bounds.min.z <= sweep.min.z + 1e-9
    && bounds.max.x >= sweep.max.x - 1e-9
    && bounds.max.y >= sweep.max.y - 1e-9
    && bounds.max.z >= sweep.max.z - 1e-9,
  `${fixture.portal.id} fullHeightShaftBounds does not contain the complete standing-rider capsule union`);
}

function activeSweptIntrusions(facade, fixture) {
  const sweep = sweptRiderBounds(fixture);
  // The expanded capsule union intentionally overlaps the edge of both
  // authored terminal pads at each stable pose. Those walkable floors are
  // valid egress support, not shaft obstructions.
  const ignoredPlanIds = new Set([
    fixture.dynamicSurface.id,
    ...fixture.mechanism.states.map(({ landingSurfaceId }) => landingSurfaceId).filter(Boolean),
  ]);
  const colliderIntrusions = [...facade.structuralRegistry.colliders.values()]
    .filter((collider) => collider?.active !== false && collider?.enabled !== false)
    .map((collider) => ({ collider, bounds: boundsFromCollider(collider) }))
    .filter(({ collider, bounds }) => bounds
      && !ignoredPlanIds.has(collider.planId)
      && colliderIntersectsSweep(collider, bounds, sweep))
    .map(({ collider, bounds }) => ({
      colliderId: collider.id,
      planId: collider.planId ?? null,
      obstacleKind: collider.obstacleKind ?? null,
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
    }));

  facade.group.updateWorldMatrix(true, true);
  const visualIntrusions = [];
  for (const [visualId, root] of facade.structuralRegistry.visuals) {
    if (ignoredPlanIds.has(root.userData?.v2PlanId)) continue;
    root.traverse((object) => {
      if (!object.isMesh || !object.geometry
        || !visibleInHierarchy(object) || !materiallyOpaque(object)) return;
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty()
        || !strictIntersection(bounds, sweep)
        || !meshIntersectsSweep(object, sweep)) return;
      visualIntrusions.push({
        visualId,
        meshName: object.name || null,
        planId: root.userData?.v2PlanId ?? null,
        structuralRole: root.userData?.v2StructuralRole ?? null,
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
      });
    });
  }
  return { sweep, colliderIntrusions, visualIntrusions };
}

function createRider(position) {
  const root = new THREE.Group();
  root.position.copy(position);
  return {
    root,
    radius: PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
    collisionHeight: PLAYER_TRAVERSAL_ENVELOPE.standingHeight,
    animation: {
      actionState: null,
      isFullBodyActionActive: () => false,
    },
    jetSkateState: { active: false },
    setEnvironmentalTraversalProfile() {},
    isLedgeClinging: () => false,
    isClimbingLadder: () => false,
    consumeLadderDismountConstraintHandoff: () => false,
    shouldIgnoreGroundConstraint: () => false,
    isPowerKnockbackActive: () => false,
    isPowerKnockbackAirborne: () => false,
    isDodgeRollAirborne: () => false,
    isPhysicalJumpActive: () => false,
    isJumpVerticalMotionActive: () => false,
    clearUnsafeTraversalMotion() {},
    clearExternalMotion() {},
  };
}

function createRideGame(facade, player) {
  const game = {
    player,
    dungeon: facade,
    bossStageRuntime: facade.environmentRuntime,
    elapsedTime: 0,
    frameHeartbeat: 0,
    ruinCompleted: false,
    enemies: [],
    platformingPlatforms: [...facade.platforms],
    dynamicPlatformingPlatforms: [],
    debugSpawnedPlatforms: [],
    debugLedgeCandidates: [],
    platformingLedgeCandidates: [],
    debugLedgePlatform: null,
    scene: new THREE.Scene(),
    ui: { showToast() {} },
  };
  for (const methodName of [
    'registerDynamicPlatformingSurface',
    'unregisterDynamicPlatformingSurface',
    '_getPlatformingSurfaces',
    '_getPlatformFloorElevation',
    'getPlatformFloorElevation',
    'getPlatformSupport',
    '_isPositionInsidePlatformBlock',
    'isPositionInsidePlatformBlock',
  ]) {
    game[methodName] = Game.prototype[methodName].bind(game);
  }
  return game;
}

function pointSupportedByExactLiftRoute(point, dynamicSurface, landingSurface) {
  const inside = (surface) => point.x >= surface.minX - 0.001
    && point.x <= surface.maxX + 0.001
    && point.z >= surface.minZ - 0.001
    && point.z <= surface.maxZ + 0.001
    && Math.abs(point.y - surface.topY) <= 0.055;
  if (inside(dynamicSurface)) return dynamicSurface.id;
  if (inside(landingSurface)) return landingSurface.id;
  return null;
}

function activeBodyBlockersAt(facade, position, ignoredPlanIds) {
  const radius = PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
  const bodyMinY = position.y + 0.21;
  const bodyMaxY = position.y + PLAYER_TRAVERSAL_ENVELOPE.standingHeight;
  return [...facade.structuralRegistry.colliders.values()]
    .filter((collider) => collider?.active !== false
      && collider?.enabled !== false
      && collider?.obstacleKind !== 'floor'
      && !ignoredPlanIds.has(collider?.planId))
    .map((collider) => ({ collider, bounds: boundsFromCollider(collider) }))
    .filter(({ bounds }) => bounds
      && bounds.max.x >= position.x - radius
      && bounds.min.x <= position.x + radius
      && bounds.max.z >= position.z - radius
      && bounds.min.z <= position.z + radius
      && bounds.max.y >= bodyMinY
      && bounds.min.y <= bodyMaxY)
    .map(({ collider }) => collider.id);
}

function assertGroundedLiftEgress(plan, facade, fixture, state) {
  const runtime = facade.environmentRuntime;
  const landingPlanSurface = plan.walkableSurfaces.find(({ id }) => id === state.landingSurfaceId);
  const landingRuntimeSurface = facade.platforms.find(({ id }) => id === state.landingSurfaceId);
  const boardingLink = plan.traversalLinks.find((link) => (
    link.mechanismId === fixture.mechanism.id
      && link.fromSurfaceId === state.landingSurfaceId
      && link.toSurfaceId === fixture.dynamicSurface.id
      && link.conditions?.some((condition) => (
        condition.op === 'stateEquals'
          && condition.variableId === `${fixture.mechanism.id}.state`
          && condition.value === state.id
      ))
  ));
  assert.ok(landingPlanSurface && landingRuntimeSurface && boardingLink,
    `${fixture.mechanism.id}:${state.id} lacks its plan-owned stable egress route`);
  assert.equal(boardingLink.egressRoute?.direction, 'dynamic-to-static');
  assert.equal(boardingLink.egressRoute?.jumpRequired, false);
  assert.equal(boardingLink.egressRoute?.consoleClear, true);
  assert.equal(boardingLink.egressRoute?.sampleSpacing, EGRESS_SAMPLE_SPACING);
  assert.equal(boardingLink.egressRoute?.sampleCount, 23);
  assert.equal(boardingLink.egressRoute?.points?.length, 2);

  const [startRecord, endRecord] = boardingLink.egressRoute.points;
  const start = new THREE.Vector3(startRecord.x, startRecord.y, startRecord.z);
  const end = new THREE.Vector3(endRecord.x, endRecord.y, endRecord.z);
  const routeDistance = start.distanceTo(end);
  const intervalCount = boardingLink.egressRoute.sampleCount - 1;
  const actualSpacing = routeDistance / intervalCount;
  assert.ok(actualSpacing <= boardingLink.egressRoute.sampleSpacing + 1e-9
      && actualSpacing <= 0.21,
    `${fixture.mechanism.id}:${state.id} egress spacing was ${actualSpacing}`);
  assert.equal(intervalCount + 1, 23,
    `${fixture.mechanism.id}:${state.id} must retain its 23-sample grounded egress proof`);

  const player = createRider(start);
  const game = createRideGame(facade, player);
  const controller = new DungeonController(game, facade);
  game.dungeonController = controller;
  runtime.mount(game);
  const applied = runtime.applyMechanismStableState(
    fixture.mechanism.id,
    state.id,
    { emitEvent: false, source: `lift-egress-proof:${state.id}` },
  );
  assert.equal(applied, true, `${fixture.mechanism.id}:${state.id} did not apply`);
  const dynamicSurface = runtime.resources.dynamicSurfaceByController.get(fixture.mechanism.id);
  assert.ok(dynamicSurface);
  assert.ok(start.distanceTo(new THREE.Vector3(
    dynamicSurface.center.x,
    dynamicSurface.topY,
    dynamicSurface.center.z,
  )) <= 0.001, `${fixture.mechanism.id}:${state.id} route does not start on its stable deck`);
  controller.lastSafePlayerPosition.copy(start);
  const exactDynamicSurface = {
    id: fixture.dynamicSurface.id,
    minX: dynamicSurface.center.x - dynamicSurface.halfWidth,
    maxX: dynamicSurface.center.x + dynamicSurface.halfWidth,
    minZ: dynamicSurface.center.z - dynamicSurface.halfDepth,
    maxZ: dynamicSurface.center.z + dynamicSurface.halfDepth,
    topY: dynamicSurface.topY,
  };
  const exactLandingSurface = {
    id: landingPlanSurface.id,
    minX: landingPlanSurface.bounds.min.x,
    maxX: landingPlanSurface.bounds.max.x,
    minZ: landingPlanSurface.bounds.min.z,
    maxZ: landingPlanSurface.bounds.max.z,
    topY: landingPlanSurface.bounds.max.y,
  };
  const ignoredPlanIds = new Set([exactDynamicSurface.id, exactLandingSurface.id]);
  const samples = [];
  for (let sampleIndex = 0; sampleIndex <= intervalCount; sampleIndex += 1) {
    const requested = start.clone().lerp(end, sampleIndex / intervalCount);
    player.root.position.copy(requested);
    controller._constrainPlayerToWalkable();
    const resolved = player.root.position.clone();
    const horizontalCorrection = Math.hypot(resolved.x - requested.x, resolved.z - requested.z);
    const supportSurfaceId = pointSupportedByExactLiftRoute(
      resolved,
      exactDynamicSurface,
      exactLandingSurface,
    );
    const blockerIds = activeBodyBlockersAt(facade, resolved, ignoredPlanIds);
    samples.push({
      sampleIndex,
      requested: requested.toArray(),
      resolved: resolved.toArray(),
      supportSurfaceId,
      horizontalCorrection,
      blockerIds,
    });
  }

  assert.equal(samples[0].supportSurfaceId, exactDynamicSurface.id);
  assert.equal(samples.at(-1).supportSurfaceId, exactLandingSurface.id);
  assert.ok(samples.every(({ supportSurfaceId }) => supportSurfaceId),
    JSON.stringify(samples.filter(({ supportSurfaceId }) => !supportSurfaceId), null, 2));
  assert.ok(samples.every(({ horizontalCorrection }) => horizontalCorrection <= 0.025),
    JSON.stringify(samples.filter(({ horizontalCorrection }) => horizontalCorrection > 0.025), null, 2));
  assert.ok(samples.every(({ blockerIds }) => blockerIds.length === 0),
    JSON.stringify(samples.filter(({ blockerIds }) => blockerIds.length), null, 2));
  assert.equal(runtime.safeguardActivations, 0);
  assert.deepEqual(runtime.errors.filter(({ code }) => (
    code === 'physics-recovery-safeguard-activated'
      || code === 'unauthorized-fall-correction'
  )), []);
  return samples;
}

for (const goldenFixture of GOLDEN_FIXTURES) {
  for (const contract of GOLDEN_LIFTS) {
    test(`${goldenFixture.label} ${contract.label} has paired apertures and a clear full rider sweep`, () => {
      const plan = acceptedGolden(goldenFixture);
      const facade = assembleDungeonPlanV2(plan);
      try {
        const fixture = liftFixture(plan, facade, contract);
        assertPairedVerticalOpenings(plan, fixture);

        // Test the legal shortcut state. A gate which has opened must retract
        // its visual as well as disabling its collider before the automatic
        // lift can enter the shaft.
        settleDoorAtOpenPose(fixture.door);
        const proof = activeSweptIntrusions(facade, fixture);
        assertPlanOwnsFullRiderShaft(fixture, proof.sweep);
        assert.deepEqual(proof.colliderIntrusions, [], JSON.stringify(proof, null, 2));
        assert.deepEqual(proof.visualIntrusions, [], JSON.stringify(proof, null, 2));
      } finally {
        facade.dispose();
      }
    });

    test(`${goldenFixture.label} ${contract.label} cannot automatically depart into its closed gate`, () => {
      const plan = acceptedGolden(goldenFixture);
      const facade = assembleDungeonPlanV2(plan);
      const fixture = liftFixture(plan, facade, contract);
      const runtime = facade.environmentRuntime;
      const surface = runtime.resources.dynamicSurfaceByController.get(contract.mechanismId);
      const player = createRider(new THREE.Vector3(surface.center.x, surface.topY, surface.center.z));
      const game = createRideGame(facade, player);
      try {
        const initialTopY = surface.topY;
        runtime.mount(game);
        assert.equal(fixture.door.closed, true);
        runtime.update(1.75);
        const controller = runtime.controllerById.get(contract.mechanismId);
        assert.equal(controller.targetStateId, null,
          `${contract.mechanismId} began ${controller.stateId} -> ${controller.targetStateId} while ${contract.gateId} was closed`);
        assert.ok(Math.abs(surface.topY - initialTopY) <= 1e-9,
          `${contract.mechanismId} entered the occupied gate shaft before its shortcut was opened`);
      } finally {
        facade.dispose();
      }
    });

    test(`${goldenFixture.label} ${contract.label} carries its rider continuously without floor snap or safeguard`, () => {
      const plan = acceptedGolden(goldenFixture);
      const facade = assembleDungeonPlanV2(plan);
      const fixture = liftFixture(plan, facade, contract);
      const runtime = facade.environmentRuntime;
      const surface = runtime.resources.dynamicSurfaceByController.get(contract.mechanismId);
      settleDoorAtOpenPose(fixture.door);
      runtime.applyMechanismStableState(contract.mechanismId, 'LowerLanding', { emitEvent: false });
      const player = createRider(new THREE.Vector3(surface.center.x, surface.topY, surface.center.z));
      const game = createRideGame(facade, player);
      const controller = new DungeonController(game, facade);
      game.dungeonController = controller;
      controller.lastSafePlayerPosition.copy(player.root.position);
      const corrections = [];
      const supportLosses = [];
      let maximumFrameDelta = 0;
      let previousY = player.root.position.y;
      try {
        runtime.mount(game);
        for (let frame = 0; frame < 840; frame += 1) {
          runtime.update(SAMPLE_DT);
          const carriedY = player.root.position.y;
          const platformTopY = surface.topY;
          controller._constrainPlayerToWalkable();
          const constrainedY = player.root.position.y;
          const correction = constrainedY - carriedY;
          const supportDelta = constrainedY - platformTopY;
          maximumFrameDelta = Math.max(maximumFrameDelta, Math.abs(constrainedY - previousY));
          if (Math.abs(correction) > 0.055) {
            corrections.push({ frame, carriedY, constrainedY, platformTopY, correction });
          }
          if (Math.abs(supportDelta) > 0.055) {
            supportLosses.push({ frame, constrainedY, platformTopY, supportDelta });
          }
          previousY = constrainedY;
          const liftController = runtime.controllerById.get(contract.mechanismId);
          if (liftController.stateId === 'UpperLanding' && liftController.targetStateId == null) break;
        }

        const liftController = runtime.controllerById.get(contract.mechanismId);
        assert.equal(liftController.stateId, 'UpperLanding');
        assert.equal(liftController.targetStateId, null);
        assert.deepEqual(corrections, [], JSON.stringify(corrections.slice(0, 12), null, 2));
        assert.deepEqual(supportLosses, [], JSON.stringify(supportLosses.slice(0, 12), null, 2));
        assert.ok(maximumFrameDelta <= 0.08,
          `${contract.label} rider moved ${maximumFrameDelta.toFixed(3)}m in one 60 Hz frame`);
        assert.ok(Math.abs(player.root.position.y - surface.topY) <= 0.055);
        assert.equal(runtime.safeguardActivations, 0);
        assert.deepEqual(
          runtime.errors.filter(({ code }) => (
            code === 'physics-recovery-safeguard-activated'
              || code === 'unauthorized-fall-correction'
          )),
          [],
        );
      } finally {
        facade.dispose();
      }
    });

    test(`${goldenFixture.label} ${contract.label} walks off every stable deck through 23 grounded samples`, () => {
      const plan = acceptedGolden(goldenFixture);
      const mechanism = plan.mechanisms.find(({ id }) => id === contract.mechanismId);
      assert.ok(mechanism);
      for (const state of mechanism.states.filter(({ stable }) => stable !== false)) {
        const facade = assembleDungeonPlanV2(plan);
        try {
          const fixture = liftFixture(plan, facade, contract);
          settleDoorAtOpenPose(fixture.door);
          const samples = assertGroundedLiftEgress(plan, facade, fixture, state);
          assert.equal(samples.length, 23);
        } finally {
          facade.dispose();
        }
      }
    });
  }
}
