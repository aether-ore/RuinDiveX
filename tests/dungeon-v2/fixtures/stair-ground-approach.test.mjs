import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonController } from '../../../src/DungeonController.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { buildInternalTraversalAndActionProofs } from '../helpers/assembly-proofs.mjs';
import {
  buildPlanOwnedDoorwayEgressTargets,
  selectPlanOwnedPortalIngressSettleTarget,
  selectRaisedCombatTraversalLink,
} from '../helpers/journey-runtime.mjs';

const LINK_ID = 'traversal.assembly.landmark-stairs';

function candidate(undercroftType = 'magma') {
  return createGoldenDungeonPlanV2({
    seed: `m1-golden-${undercroftType}`,
    undercroftType,
  });
}

function acceptedPlan(undercroftType = 'magma') {
  const validation = validateDungeonPlanV2(candidate(undercroftType));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  return validation.plan;
}

function createGroundedHarness(facade, position) {
  const player = {
    root: new THREE.Group(),
    radius: 0.42,
    jumpState: 'Grounded',
    jetSkateState: { active: false },
    animation: { actionState: null, state: 'idle', isFullBodyActionActive: () => false },
    isPhysicalJumpActive: () => false,
    isDodgeRollAirborne: () => false,
    isPowerKnockbackAirborne: () => false,
    isPowerKnockbackActive: () => false,
    isLedgeClinging: () => false,
    isClimbingLadder: () => false,
    consumeLadderDismountConstraintHandoff: () => false,
    shouldIgnoreGroundConstraint: () => false,
  };
  player.root.position.set(position.x, position.y, position.z);
  const game = {
    player,
    enemies: [],
    elapsedTime: 0,
    ruinCompleted: false,
    platformingPlatforms: [...facade.platforms],
    dynamicPlatformingPlatforms: [],
    debugSpawnedPlatforms: [],
    bossStageRuntime: null,
    getPlatformFloorElevation: () => null,
    isPositionInsidePlatformBlock: () => false,
    _getPlatformingSurfaces: () => [],
    ui: { showToast: () => {} },
    scene: new THREE.Scene(),
  };
  return { player, controller: new DungeonController(game, facade) };
}

function samplesBetween(start, end, spacing = 0.12) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const count = Math.max(1, Math.ceil(distance / spacing));
  return Array.from({ length: count + 1 }, (_, index) => {
    const ratio = index / count;
    return {
      x: THREE.MathUtils.lerp(start.x, end.x, ratio),
      y: THREE.MathUtils.lerp(start.y, end.y, ratio),
      z: THREE.MathUtils.lerp(start.z, end.z, ratio),
    };
  });
}

function capsuleContainedBySurface(point, surface, radius = 0.46) {
  return point.x >= surface.bounds.min.x + radius
    && point.x <= surface.bounds.max.x - radius
    && point.z >= surface.bounds.min.z + radius
    && point.z <= surface.bounds.max.z - radius
    && Math.abs(point.y - surface.bounds.max.y) <= 0.051;
}

function capsuleSupportedBySurfaceUnion(point, surfaces, radius = 0.46) {
  return [
    { x: 0, z: 0 },
    ...Array.from({ length: 16 }, (_, index) => {
      const angle = index / 16 * Math.PI * 2;
      return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
    }),
  ].every((offset) => surfaces.some((surface) => (
    Math.abs(point.y - surface.bounds.max.y) <= 0.051
      && point.x + offset.x >= surface.bounds.min.x - 1e-6
      && point.x + offset.x <= surface.bounds.max.x + 1e-6
      && point.z + offset.z >= surface.bounds.min.z - 1e-6
      && point.z + offset.z <= surface.bounds.max.z + 1e-6
  )));
}

function capsuleIntersectsBounds(point, bounds, radius = 0.46, height = 3.2) {
  if (bounds.max.y <= point.y + 0.03 || bounds.min.y >= point.y + height - 0.005) {
    return false;
  }
  const dx = Math.max(bounds.min.x - point.x, 0, point.x - bounds.max.x);
  const dz = Math.max(bounds.min.z - point.z, 0, point.z - bounds.max.z);
  return dx * dx + dz * dz < radius * radius - 1e-8;
}

function expectedPostPortalIngress(plan, link) {
  const portal = plan.portals.find(({ id }) => id === link.approachContract.ingressPortalId);
  assert.ok(portal, `${link.id} ingress portal missing`);
  const destination = portal.to.center;
  const previous = [...portal.physicalRoute.routePoints].reverse().find((point) => (
    Math.hypot(point.x - destination.x, point.z - destination.z) > 0.05
  ));
  assert.ok(previous, `${portal.id} needs an interior approach direction`);
  const dx = destination.x - previous.x;
  const dz = destination.z - previous.z;
  const length = Math.hypot(dx, dz);
  const surfaceId = portal.physicalRoute.endpointSurfaceIds.to;
  const surface = plan.walkableSurfaces.find(({ id }) => id === surfaceId);
  assert.ok(surface, `${portal.id} native endpoint surface missing`);
  return {
    portal,
    surface,
    point: {
      x: destination.x + dx / length * portal.traversal.interiorIngressDepth,
      y: surface.bounds.max.y,
      z: destination.z + dz / length * portal.traversal.interiorIngressDepth,
    },
  };
}

function addBlockingFixture(plan, id, bounds) {
  plan.structuralFixtures.push({
    id,
    type: 'negative-route-blocker',
    subtype: 'acceptance-test-obstruction',
    regionId: 'assembly',
    cellId: 'cell.assembly.main',
    bounds: structuredClone(bounds),
    materialProfileId: 'legacy-machinery',
    visualProfile: 'negative-route-blocker',
    collision: 'blocking',
    supportBoundaryIds: [],
    gameplayPurpose: 'negative fixture proving a blocked native Machine Factory route is rejected',
    authoredDetailId: id,
    visualId: `visual.${id}`,
    visualIds: [`visual.${id}`],
    colliderIds: [`collider.${id}.0`],
    colliderBounds: [structuredClone(bounds)],
  });
}

function assemblyEngagement(plan) {
  const encounter = plan.encounters.find(({ id }) => id === 'encounter.assembly');
  const engagement = encounter.entryEngagementContracts.find((entry) => (
    entry.id === 'engagement.assembly.entry-ground'
  ));
  const traversalLink = plan.traversalLinks.find(({ id }) => (
    id === engagement.sourceTraversalLinkId
  ));
  const surface = plan.walkableSurfaces.find(({ id }) => id === engagement.surfaceId);
  const surfaces = engagement.surfaceIds.map((surfaceId) => (
    plan.walkableSurfaces.find(({ id }) => id === surfaceId)
  ));
  const source = traversalLink.approachContract.ingressPoint;
  const authoredSpawn = encounter.spawnPoints[engagement.spawnPointIndex];
  const spawn = { ...authoredSpawn, y: surface.bounds.max.y };
  return { encounter, engagement, traversalLink, surface, surfaces, source, authoredSpawn, spawn };
}

test('actual Assembly stair exposes a grounded plan-owned staging route in navigation diagnostics', () => {
  const plan = acceptedPlan();
  const link = plan.traversalLinks.find(({ id }) => id === LINK_ID);
  const stair = plan.walkableSurfaces.find(({ id }) => id === link.viaSurfaceId);
  const ingressPortal = plan.portals.find(({ id }) => id === link.approachContract.ingressPortalId);
  assert.equal(link.nativeFixedRoomPlacementId, 'placement.assembly');
  assert.equal(link.nativeRampSurfaceIds.length, 11,
    'the staging route must enter the complete genuine V1 Machine Factory ramp');
  assert.equal(link.viaSurfaceId, link.nativeRampSurfaceIds[0]);
  assert.ok(link.approachWaypoints.length >= 10,
    'the post-ingress route must own each native ground-tile crossing rather than shortcutting through machinery');
  assert.equal(link.approachSurfaceIds.length, link.approachWaypoints.length);
  assert.equal(link.approachSegments.length, link.approachWaypoints.length - 1);
  assert.equal(link.approachContract.ingressPortalId, 'portal.security-assembly');
  assert.equal(ingressPortal.traversal.interiorIngressDepth, 1.2);
  const expectedIngress = expectedPostPortalIngress(plan, link);
  assert.deepEqual(link.approachContract.ingressSurfaceIds, [
    ingressPortal.physicalRoute.endpointSurfaceIds.to,
  ]);
  assert.equal(link.approachContract.sourceSurfaceId.startsWith(
    'placement.assembly:surface.v1-room.machine-factory.',
  ), true);
  assert.equal(link.approachContract.stairSurfaceId.startsWith(
    'placement.assembly:surface.v1-room.machine-factory.',
  ), true);
  assert.deepEqual(link.approachContract.ingressPoint, link.approachWaypoints[0]);
  assert.deepEqual(link.approachContract.ingressPoint, expectedIngress.point);
  assert.deepEqual(link.approachContract.doorwayEgress, {
    id: 'doorway-egress.security-assembly.native-machine-factory',
    mode: 'lane-preserving-then-recenter',
    portalId: ingressPortal.id,
    exteriorStagingDepth: 0.8,
    straightClearanceDepth: 2,
    maximumLaneOffset: 0.7,
    recenterPoint: link.approachWaypoints[1],
    connectorSurfaceId: ingressPortal.physicalRoute.surfaceIds.at(-1),
    destinationSurfaceIds: link.approachSurfaceIds.slice(0, 2),
    capsuleRadius: 0.46,
    capsuleHeight: 3.2,
    sampleSpacing: 0.21,
  });
  const assemblyEncounter = plan.encounters.find(({ id }) => id === 'encounter.assembly');
  assert.ok(['x', 'y', 'z'].every((axis) => (
    link.approachContract.ingressPoint[axis] >= assemblyEncounter.triggerZoneBounds.min[axis]
    && link.approachContract.ingressPoint[axis] <= assemblyEncounter.triggerZoneBounds.max[axis]
  )), 'Assembly encounter must activate at the proven post-portal stair approach anchor');
  const {
    encounter: contractedEncounter,
    engagement,
    surface: eastFloor,
    surfaces: engagementSurfaces,
    source: engagementSource,
    authoredSpawn: groundSpawn,
    spawn: groundedSpawn,
  } = assemblyEngagement(plan);
  assert.equal(contractedEncounter, assemblyEncounter);
  assert.deepEqual(link.approachContract.combatRejoin, {
    id: 'combat-rejoin.assembly.entry-ground',
    encounterId: assemblyEncounter.id,
    engagementId: engagement.id,
    surfaceId: eastFloor.id,
    surfaceIds: engagement.surfaceIds,
    segmentStart: engagementSource,
    segmentEnd: groundedSpawn,
    waypoints: [
      engagementSource,
      link.approachWaypoints[1],
      groundedSpawn,
    ],
    nextWaypointIndex: 3,
    minimumProgress: 0,
    maximumProgress: 1,
    maximumLateralOffset: 0.25,
    capsuleRadius: engagement.capsuleRadius,
    capsuleHeight: engagement.capsuleHeight,
    sampleSpacing: engagement.sampleSpacing,
  });
  assert.equal(assemblyEncounter.spawnPlacementMode, 'exact-plan-owned');
  assert.equal(assemblyEncounter.spawnGroundingMode, 'plan-y');
  assert.equal(assemblyEncounter.spawnSurfaceIds[engagement.spawnPointIndex], eastFloor.id);
  assert.equal(engagement.sourcePointRole, 'post-portal-ingress');
  assert.equal(engagement.sameLevel, true);
  assert.equal(engagement.unobstructed, true);
  assert.equal(engagement.minimumPlayerSpawnSeparation, 1.8);
  assert.equal(engagement.minimumEnemyIngressClearance, 2);
  assert.deepEqual(engagement.surfaceIds, [
    link.approachSurfaceIds[0],
    link.approachSurfaceIds[1],
    link.approachSurfaceIds[2],
    link.approachSurfaceIds[3],
  ]);
  assert.deepEqual(engagementSource, link.approachContract.ingressPoint);
  assert.deepEqual(groundedSpawn, groundSpawn,
    'exact V2 spawn must already own its declared supporting-surface Y');
  assert.ok(capsuleContainedBySurface(groundSpawn, eastFloor, assemblyEncounter.spawnClearance.radius),
    'Assembly ground threat must spawn capsule-clear on the declared entry circulation floor');
  assert.ok(groundSpawn.x >= assemblyEncounter.zoneBounds.min.x + assemblyEncounter.spawnClearance.radius
    && groundSpawn.x <= assemblyEncounter.zoneBounds.max.x - assemblyEncounter.spawnClearance.radius
    && groundSpawn.z >= assemblyEncounter.zoneBounds.min.z + assemblyEncounter.spawnClearance.radius
    && groundSpawn.z <= assemblyEncounter.zoneBounds.max.z - assemblyEncounter.spawnClearance.radius,
  'Assembly exact spawn capsule must be contained by its authored encounter zone');
  assert.ok(Math.min(
    groundSpawn.x - assemblyEncounter.zoneBounds.min.x,
    assemblyEncounter.zoneBounds.max.x - groundSpawn.x,
    groundSpawn.z - assemblyEncounter.zoneBounds.min.z,
    assemblyEncounter.zoneBounds.max.z - groundSpawn.z,
  ) >= engagement.minimumArenaEdgeClearance,
  'Assembly entry threat must begin inside the enemy soft arena rather than immediately recovering away');
  assert.deepEqual(assemblyEncounter.spawnPattern.points[engagement.spawnPointIndex], groundSpawn,
    'runtime encounter spawn pattern must retain the plan-owned authored spawn');
  const engagementDistance = Math.hypot(
    groundedSpawn.x - engagementSource.x,
    groundedSpawn.z - engagementSource.z,
  );
  assert.ok(engagementDistance <= engagement.maximumEngagementRange,
    'Assembly ground threat must begin inside starter-Buster lock range');
  assert.ok(engagementDistance >= engagement.minimumPlayerSpawnSeparation,
    'Assembly ground threat must not body-block the accepted doorway ingress');
  const doorwayStraightZ = ingressPortal.to.center.z
    - link.approachContract.doorwayEgress.straightClearanceDepth;
  const conservativeEnemySoftMaxZ = assemblyEncounter.zoneBounds.max.z - 1.25;
  assert.ok(doorwayStraightZ - conservativeEnemySoftMaxZ
    >= engagement.minimumEnemyIngressClearance,
  'activated Assembly enemies must remain behind the complete doorway egress');
  assert.ok(assemblyEncounter.triggerZoneBounds.max.z > assemblyEncounter.zoneBounds.max.z,
    'Assembly must activate at ingress without extending its enemy arena into the doorway');
  const blockingBounds = [
    ...plan.structuralFixtures
      .filter((fixture) => fixture.regionId === 'assembly' && fixture.collision === 'blocking')
      .flatMap((fixture) => (fixture.colliderBounds ?? []).map((bounds) => ({
        ownerId: fixture.id,
        bounds,
      }))),
    ...plan.structuralBoundaries
      .filter((boundary) => boundary.regionId === 'assembly' && boundary.collider !== false)
      .map((boundary) => ({ ownerId: boundary.id, bounds: boundary.bounds })),
  ];
  for (let index = 1; index < link.approachContract.combatRejoin.waypoints.length; index += 1) {
    const start = link.approachContract.combatRejoin.waypoints[index - 1];
    const end = link.approachContract.combatRejoin.waypoints[index];
    for (const point of samplesBetween(start, end, engagement.sampleSpacing)) {
      assert.ok(capsuleSupportedBySurfaceUnion(
        point,
        engagementSurfaces,
        engagement.capsuleRadius,
      ), `Assembly engagement route left its declared native V1 tile union at ${JSON.stringify(point)}`);
      const blocker = blockingBounds.find(({ bounds }) => capsuleIntersectsBounds(
        point,
        bounds,
        engagement.capsuleRadius,
        engagement.capsuleHeight,
      ));
      assert.equal(blocker, undefined,
        `Assembly engagement route intersects ${blocker?.ownerId ?? 'an unknown blocker'}`);
    }
  }
  assert.equal(link.approachSurfaceIds.every((surfaceId) => (
    surfaceId.startsWith('placement.assembly:surface.v1-room.machine-factory.')
  )), true, 'the approach cannot retain any generic Assembly floor or repair surface');
  assert.equal(new Set(link.approachSurfaceIds).size >= 8, true,
    'the staging route must cross the authored native floor grid, not one oversized slab');
  assert.ok(Math.hypot(
    link.approachWaypoints.at(-2).x - link.approachWaypoints.at(-1).x,
    link.approachWaypoints.at(-2).z - link.approachWaypoints.at(-1).z,
  ) >= 1.2, 'Assembly staging route is too short to align before the first native V1 tread');
  assert.deepEqual(link.approachWaypoints.at(-1), (stair.stairs ?? stair.geometry).path[0]);
  for (const [index, point] of link.approachWaypoints.entries()) {
    const owner = plan.walkableSurfaces.find(({ id }) => id === link.approachSurfaceIds[index]);
    const isStairSeam = index === link.approachWaypoints.length - 1;
    if (isStairSeam) {
      assert.deepEqual(point, (stair.stairs ?? stair.geometry).path[0],
        'the final staging point must be the exact stair/deck seam');
      assert.ok(point.x >= owner.bounds.min.x - 1e-9
        && point.x <= owner.bounds.max.x + 1e-9
        && point.z >= owner.bounds.min.z - 1e-9
        && point.z <= owner.bounds.max.z + 1e-9,
      'the exact stair seam must still touch its declared source deck');
    } else {
      assert.ok(point.x >= owner.bounds.min.x + link.approachContract.capsuleRadius
        && point.x <= owner.bounds.max.x - link.approachContract.capsuleRadius
        && point.z >= owner.bounds.min.z + link.approachContract.capsuleRadius
        && point.z <= owner.bounds.max.z - link.approachContract.capsuleRadius);
    }
    assert.equal(point.y, owner.bounds.max.y);
  }
  assert.ok(link.approachSegments.filter(({ surfaceIds }) => surfaceIds.length > 1)
    .every(({ seamWidth }) => seamWidth >= 1.2));

  const facade = assembleDungeonPlanV2(plan);
  try {
    const navigation = facade.environmentRuntime.getDiagnostics('navigation').navigation;
    const navigationLink = navigation.traversalLinks.find(({ id }) => id === LINK_ID);
    assert.deepEqual(navigationLink.approachWaypoints, link.approachWaypoints);
    assert.deepEqual(navigationLink.approachSurfaceIds, link.approachSurfaceIds);
    assert.deepEqual(navigationLink.approachSegments, link.approachSegments);
    assert.deepEqual(navigationLink.approachContract, link.approachContract);
    const navigationPortal = navigation.portals.find(({ id }) => id === ingressPortal.id);
    assert.equal(navigationPortal.interiorIngressDepth, ingressPortal.traversal.interiorIngressDepth);
    const settle = selectPlanOwnedPortalIngressSettleTarget({
      navigation,
      portalId: ingressPortal.id,
      minimumIngressPoint: link.approachContract.ingressPoint,
      destinationSurfaceId: ingressPortal.physicalRoute.endpointSurfaceIds.to,
    });
    assert.ok(settle?.doorwayEgress,
      'runtime navigation must expose the accepted lane-preserving doorway contract');
    assert.deepEqual(settle.position, link.approachWaypoints[1]);
    const activeBlockers = [...facade.structuralRegistry.colliders.values()]
      .filter((collider) => collider?.active !== false
        && collider?.enabled !== false
        && collider?.obstacleKind !== 'floor'
        && collider?.bounds?.min && collider?.bounds?.max);
    for (const lateral of [-0.65, 0, 0.65]) {
      const currentPosition = {
        x: settle.doorwayEgress.exteriorStagingPoint.x
          + settle.doorwayEgress.tangent.x * lateral,
        y: settle.doorwayEgress.exteriorStagingPoint.y,
        z: settle.doorwayEgress.exteriorStagingPoint.z
          + settle.doorwayEgress.tangent.z * lateral,
      };
      const targets = buildPlanOwnedDoorwayEgressTargets(currentPosition, settle.doorwayEgress);
      assert.ok(targets, `doorway lane ${lateral} did not produce a supported public route`);
      assert.ok(targets.supportSamples.length > 10);
      for (const point of targets.supportSamples) {
        const blocker = activeBlockers.find(({ bounds }) => capsuleIntersectsBounds(
          point,
          bounds,
          settle.doorwayEgress.capsuleRadius,
          settle.doorwayEgress.capsuleHeight,
        ));
        assert.equal(blocker, undefined,
          `assembled doorway lane ${lateral} intersects ${blocker?.id ?? blocker?.planId}`);
      }
    }
  } finally {
    facade.dispose();
  }
});

for (const undercroftType of ['magma', 'electrical']) {
  test(`${undercroftType} actual seed exposes the exact native Assembly ramp to public elevated combat`, () => {
    const plan = acceptedPlan(undercroftType);
    const link = plan.traversalLinks.find(({ id }) => id === LINK_ID);
    const stair = plan.walkableSurfaces.find(({ id }) => id === link.viaSurfaceId);
    const geometry = stair.stairs ?? stair.geometry;
    const nativeRampSurfaces = link.nativeRampSurfaceIds.map((surfaceId) => (
      plan.walkableSurfaces.find(({ id }) => id === surfaceId)
    ));
    const expectedRoute = [
      geometry.path[0],
      ...nativeRampSurfaces.map(({ center }) => center),
      geometry.path.at(-1),
    ];

    assert.equal(nativeRampSurfaces.length, 11);
    assert.equal(nativeRampSurfaces.every(Boolean), true);
    assert.deepEqual(link.stairWaypoints, expectedRoute);
    assert.deepEqual(link.waypoints, expectedRoute,
      'public traversal must consume the exact V1 tile centerline, not graph reachability');
    assert.equal(link.waypoints.length, 13);
    assert.ok(link.waypoints.slice(1).every((point, index) => Math.hypot(
      point.x - link.waypoints[index].x,
      point.z - link.waypoints[index].z,
    ) <= 2.8 + 1e-9));
    const lowerDeck = plan.walkableSurfaces.find(({ id }) => id === link.fromSurfaceId);
    const egress = link.reverseEgressWaypoints[0];
    assert.equal(link.reverseEgressWaypoints.length, 1);
    assert.ok(capsuleContainedBySurface(egress, lowerDeck, link.approachContract.capsuleRadius));
    assert.ok(Math.hypot(
      egress.x - geometry.path[0].x,
      egress.z - geometry.path[0].z,
    ) >= 1.2);

    const facade = assembleDungeonPlanV2(plan);
    try {
      const navigation = facade.environmentRuntime.getDiagnostics('navigation').navigation;
      const runtimeLink = navigation.traversalLinks.find(({ id }) => id === LINK_ID);
      assert.deepEqual(runtimeLink.waypoints, expectedRoute,
        'runtime diagnostics discarded the public native-ramp route');
      assert.deepEqual(runtimeLink.reverseEgressWaypoints, link.reverseEgressWaypoints);
      const ingressPortal = plan.portals.find(({ id }) => (
        id === link.approachContract.ingressPortalId
      ));
      const doorwaySettle = selectPlanOwnedPortalIngressSettleTarget({
        navigation,
        portalId: ingressPortal.id,
        minimumIngressPoint: link.approachContract.ingressPoint,
        destinationSurfaceId: ingressPortal.physicalRoute.endpointSurfaceIds.to,
      });
      assert.ok(doorwaySettle?.doorwayEgress,
        `${undercroftType} actual seed lost the native Assembly doorway route`);
      assert.deepEqual(doorwaySettle.position, link.approachWaypoints[1]);

      const encounter = plan.encounters.find(({ id }) => id === 'encounter.assembly');
      const elevatedPosition = encounter.spawnPoints[1];
      const playerPosition = link.approachContract.ingressPoint;
      const target = {
        enemy: {
          id: 'actual-seed-elevated-assembly-enemy',
          encounterId: encounter.id,
          position: elevatedPosition,
          planOwnedSpawnPointIndex: 1,
        },
        horizontalDistance: Math.hypot(
          elevatedPosition.x - playerPosition.x,
          elevatedPosition.z - playerPosition.z,
        ),
        verticalDistance: elevatedPosition.y - playerPosition.y,
      };
      const selectedRaisedRoute = selectRaisedCombatTraversalLink({
        playerPosition,
        currentRegionId: 'assembly',
        navigation,
      }, target);
      assert.ok(selectedRaisedRoute, 'actual public combat found no physical elevated route');
      assert.deepEqual({
        linkId: selectedRaisedRoute.linkId,
        direction: selectedRaisedRoute.direction,
        returnDirection: selectedRaisedRoute.returnDirection,
        surfaceId: selectedRaisedRoute.surfaceId,
        surfaceY: selectedRaisedRoute.surfaceY,
        targetEnemyId: selectedRaisedRoute.targetEnemyId,
      }, {
        linkId: LINK_ID,
        direction: 'forward',
        returnDirection: 'reverse',
        surfaceId: link.toSurfaceId,
        surfaceY: geometry.path.at(-1).y,
        targetEnemyId: target.enemy.id,
      }, 'actual public-combat selection must choose the retained V1 ramp');
    } finally {
      facade.dispose();
    }
  });
}

test('validator rejects graph-only Assembly elevated combat without native ramp waypoints', () => {
  const broken = structuredClone(candidate());
  const link = broken.traversalLinks.find(({ id }) => id === LINK_ID);
  link.stairWaypoints = [];
  link.waypoints = [];
  const validation = validateDungeonPlanV2(broken);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, details }) => (
    code === 'assembly-stair-route-checkpoints-invalid' && details.linkId === LINK_ID
  )), JSON.stringify(validation.errors, null, 2));
});

test('actual assembled Assembly approach and stair remain continuously grounded through the runtime controller', () => {
  const plan = acceptedPlan();
  const link = plan.traversalLinks.find(({ id }) => id === LINK_ID);
  const stair = plan.walkableSurfaces.find(({ id }) => id === link.viaSurfaceId);
  const facade = assembleDungeonPlanV2(plan);
  try {
    const physicalProof = buildInternalTraversalAndActionProofs(plan, facade);
    const linkProof = physicalProof.linkProofs.find(({ linkId }) => linkId === LINK_ID);
    assert.equal(linkProof.accepted, true, JSON.stringify(linkProof, null, 2));
    assert.deepEqual(linkProof.blockedSamples, []);
    assert.deepEqual(linkProof.uncoveredSamples, []);

    const completeApproach = link.approachWaypoints;
    const { player, controller } = createGroundedHarness(facade, completeApproach[0]);
    for (let index = 1; index < completeApproach.length; index += 1) {
      for (const point of samplesBetween(completeApproach[index - 1], completeApproach[index])) {
        player.root.position.x = point.x;
        player.root.position.z = point.z;
        controller._constrainPlayerToWalkable();
        assert.ok(Math.abs(player.root.position.y - completeApproach[0].y) <= 1e-9,
          `ground approach changed elevation at ${JSON.stringify(point)}`);
        assert.equal(controller.isPositionWalkable(player.root.position), true,
          `ground approach became unwalkable at ${JSON.stringify(point)}`);
        assert.equal(player.jumpState, 'Grounded');
        assert.equal(player.isLedgeClinging(), false);
      }
    }

    const [start, end] = (stair.stairs ?? stair.geometry).path;
    let prior = { ...start };
    player.root.position.set(start.x, start.y, start.z);
    for (const point of samplesBetween(start, end)) {
      player.root.position.x = point.x;
      player.root.position.z = point.z;
      player.root.position.y = prior.y;
      controller._constrainPlayerToWalkable();
      assert.ok(Math.abs(player.root.position.y - point.y) <= 1e-9,
        `stair support diverged at ${JSON.stringify(point)}; actual y=${player.root.position.y}`);
      assert.equal(player.jumpState, 'Grounded');
      assert.equal(player.isLedgeClinging(), false);
      prior = point;
    }
  } finally {
    facade.dispose();
  }
});

test('validator rejects an Assembly staging route that leaves its source deck', () => {
  const broken = structuredClone(candidate());
  const link = broken.traversalLinks.find(({ id }) => id === LINK_ID);
  const owner = broken.walkableSurfaces.find(({ id }) => id === link.approachSurfaceIds[0]);
  link.approachWaypoints[0].x = owner.bounds.max.x + 1;
  const validation = validateDungeonPlanV2(broken);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, details }) => (
    code === 'stair-ground-approach-off-surface' && details.linkId === LINK_ID
  )), JSON.stringify(validation.errors, null, 2));
});

test('validator rejects an Assembly route that starts short of the public post-portal ingress anchor', () => {
  const broken = structuredClone(candidate());
  const link = broken.traversalLinks.find(({ id }) => id === LINK_ID);
  link.approachWaypoints[0].x += 0.5;
  link.approachContract.ingressPoint.x += 0.5;
  const validation = validateDungeonPlanV2(broken);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, details }) => (
    code === 'stair-ground-approach-ingress-mismatch' && details.linkId === LINK_ID
  )), JSON.stringify(validation.errors, null, 2));
});

test('validator rejects an Assembly encounter trigger that drives the player off the stair approach', () => {
  const broken = structuredClone(candidate());
  const encounter = broken.encounters.find(({ id }) => id === 'encounter.assembly');
  const ingress = broken.traversalLinks.find(({ id }) => id === LINK_ID)
    .approachContract.ingressPoint;
  encounter.triggerZoneBounds.max.x = ingress.x - 0.1;
  const validation = validateDungeonPlanV2(broken);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, details }) => (
    code === 'stair-ground-approach-trigger-gap' && details.linkId === LINK_ID
  )), JSON.stringify(validation.errors, null, 2));
});

test('validator rejects a native Assembly entry threat beyond its declared engagement range', () => {
  const broken = structuredClone(candidate());
  const encounter = broken.encounters.find(({ id }) => id === 'encounter.assembly');
  const engagement = encounter.entryEngagementContracts.find(({ id }) => (
    id === 'engagement.assembly.entry-ground'
  ));
  engagement.maximumEngagementRange = 0.1;
  const validation = validateDungeonPlanV2(broken);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, details }) => (
    code === 'encounter-entry-engagement-invalid'
      && details.engagementId === 'engagement.assembly.entry-ground'
      && details.distance > details.maximumRange
      && details.maximumRange === 0.1
  )), JSON.stringify(validation.errors, null, 2));
});

test('validator rejects an exact Assembly spawn whose capsule leaves its authored encounter zone', () => {
  const broken = structuredClone(candidate());
  const encounter = broken.encounters.find(({ id }) => id === 'encounter.assembly');
  const surface = broken.walkableSurfaces.find(({ id }) => id === encounter.spawnSurfaceIds[0]);
  const outOfZone = {
    x: surface.bounds.max.x - 0.1,
    y: surface.bounds.max.y,
    z: (surface.bounds.min.z + surface.bounds.max.z) * 0.5,
  };
  encounter.spawnPoints[0] = { ...outOfZone };
  encounter.spawnPattern.points[0] = { ...outOfZone };
  const validation = validateDungeonPlanV2(broken);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, details }) => (
    code === 'encounter-exact-spawn-clearance-invalid'
      && details.encounterId === 'encounter.assembly'
      && details.spawnIndex === 0
  )), JSON.stringify(validation.errors, null, 2));
});

test('validator rejects an Assembly entry threat inside the hard arena but inside its recovery edge', () => {
  const broken = structuredClone(candidate());
  const encounter = broken.encounters.find(({ id }) => id === 'encounter.assembly');
  const spawn = encounter.spawnPoints[0];
  encounter.zoneBounds.max.x = spawn.x + 0.5;
  const validation = validateDungeonPlanV2(broken);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, details }) => (
    code === 'encounter-entry-engagement-invalid'
      && details.engagementId === 'engagement.assembly.entry-ground'
      && details.arenaEdgeClearance < details.minimumArenaEdgeClearance
  )), JSON.stringify(validation.errors, null, 2));
});

test('validator rejects an Assembly combat arena that lets enemies pursue into the doorway egress', () => {
  const broken = structuredClone(candidate());
  const encounter = broken.encounters.find(({ id }) => id === 'encounter.assembly');
  encounter.zoneBounds.max.z += 0.5;
  const validation = validateDungeonPlanV2(broken);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, details }) => (
    code === 'portal-doorway-enemy-exclusion-invalid'
      && details.encounterId === encounter.id
      && details.enemyIngressClearance < details.minimumEnemyIngressClearance
  )), JSON.stringify(validation.errors, null, 2));
});

test('validator rejects a blocking fixture in the straight lane through the native Assembly doorway', () => {
  const broken = structuredClone(candidate());
  const link = broken.traversalLinks.find(({ id }) => id === LINK_ID);
  const portal = broken.portals.find(({ id }) => id === link.approachContract.ingressPortalId);
  const destination = portal.to.center;
  const previous = [...portal.physicalRoute.routePoints].reverse().find((point) => (
    Math.hypot(point.x - destination.x, point.z - destination.z) > 0.05
  ));
  const length = Math.hypot(destination.x - previous.x, destination.z - previous.z);
  const point = {
    x: destination.x + (destination.x - previous.x) / length,
    y: link.approachContract.ingressPoint.y,
    z: destination.z + (destination.z - previous.z) / length,
  };
  const blockerId = 'fixture.assembly.negative-straight-doorway-blocker';
  addBlockingFixture(broken, blockerId, {
    min: { x: point.x - 0.55, y: point.y + 0.05, z: point.z - 0.12 },
    max: { x: point.x + 0.55, y: point.y + 3.15, z: point.z + 0.12 },
  });
  const validation = validateDungeonPlanV2(broken);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, details }) => (
    code === 'portal-doorway-egress-invalid'
      && details.portalId === portal.id
      && details.failures.includes(blockerId)
  )), JSON.stringify(validation.errors, null, 2));
});

test('validator rejects a blocking fixture across the Assembly entry movement route', () => {
  const broken = structuredClone(candidate());
  const { traversalLink } = assemblyEngagement(broken);
  const route = traversalLink.approachContract.combatRejoin.waypoints;
  const blockerId = 'fixture.assembly.negative-entry-blocker';
  const midpoint = {
    x: (route[0].x + route[1].x) * 0.5,
    y: route[0].y,
    z: (route[0].z + route[1].z) * 0.5,
  };
  const blockerBounds = {
    min: { x: midpoint.x - 0.7, y: midpoint.y + 0.05, z: midpoint.z - 0.12 },
    max: { x: midpoint.x + 0.7, y: midpoint.y + 3.15, z: midpoint.z + 0.12 },
  };
  addBlockingFixture(broken, blockerId, blockerBounds);
  const validation = validateDungeonPlanV2(broken);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, details }) => (
    code === 'encounter-entry-engagement-invalid'
      && details.engagementId === 'engagement.assembly.entry-ground'
      && details.blockers.includes(blockerId)
  )), JSON.stringify(validation.errors, null, 2));
  assert.ok(validation.errors.some(({ code, details }) => (
    code === 'stair-combat-rejoin-invalid'
      && details.linkId === LINK_ID
      && details.blockers.includes(blockerId)
  )), JSON.stringify(validation.errors, null, 2));
  assert.ok(validation.errors.some(({ code, details }) => (
    code === 'portal-doorway-egress-invalid'
      && details.failures.includes(blockerId)
  )), JSON.stringify(validation.errors, null, 2));
});

test('validator rejects a blocker inserted across the plan-owned post-combat rejoin corridor', () => {
  const broken = structuredClone(candidate());
  const rejoin = broken.traversalLinks.find(({ id }) => id === LINK_ID)
    .approachContract.combatRejoin;
  const blockerId = 'fixture.assembly.negative-combat-rejoin-blocker';
  const [routeStart, routeEnd] = rejoin.waypoints.slice(-2);
  const midpoint = {
    x: (routeStart.x + routeEnd.x) * 0.5,
    y: routeStart.y,
    z: (routeStart.z + routeEnd.z) * 0.5,
  };
  const blockerBounds = {
    min: { x: midpoint.x - 0.7, y: midpoint.y + 0.05, z: midpoint.z - 0.12 },
    max: { x: midpoint.x + 0.7, y: midpoint.y + 3.15, z: midpoint.z + 0.12 },
  };
  addBlockingFixture(broken, blockerId, blockerBounds);
  const validation = validateDungeonPlanV2(broken);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, details }) => (
    code === 'stair-combat-rejoin-invalid'
      && details.linkId === LINK_ID
      && details.blockers.includes(blockerId)
  )), JSON.stringify(validation.errors, null, 2));
});
