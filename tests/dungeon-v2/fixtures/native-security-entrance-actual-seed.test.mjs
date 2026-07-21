import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import {
  getLegacyFixedRoomModuleV2,
  LEGACY_FIXED_ROOM_MODULE_CATALOG_V2,
} from '../../../src/dungeon-v2/LegacyFixedRoomModuleCatalogV2.js';
import { recompileAcceptedLegacyFixedRoomPlacementV2 } from '../../../src/dungeon-v2/LegacyFixedRoomRuntimeAdapterV2.js';
import { transformPointQuarterTurns } from '../../../src/dungeon-v2/DungeonSpatialMathV2.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../../src/TraversalCapabilities.js';
import { assertContinuousPortalRoutes } from '../helpers/accepted-fixture.mjs';
import { buildIndependentPortalRouteProofs } from '../helpers/assembly-proofs.mjs';

const PLACEMENT_ID = 'placement.security';
const DESCRIPTOR_ID = 'v1-room.security-entrance';
const CELL_ID = 'cell.security.main';
const POSITION_TOLERANCE = 0.051;
const PLAYER_SIZED_STACK_OVERLAP = 1.26;
const SPAWN_SURFACE_LOCAL_ID = 'surface.v1-room.security-entrance.0.-1.0';
const EXPECTED_DESCRIPTOR_IDS = LEGACY_FIXED_ROOM_MODULE_CATALOG_V2
  .map(({ id }) => id)
  .sort();

const SOCKETS = Object.freeze({
  assembly: 'socket.v1-room.security-entrance.ground.south-center',
  sorting: 'socket.v1-room.security-entrance.ground.north-center',
  freight: 'socket.v1-room.security-entrance.ground.east-south-bucket',
  cappedLift: 'socket.v1-room.security-entrance.lift.west-south-bucket',
});

const BINDINGS = Object.freeze([
  Object.freeze({ portalId: 'portal.security-assembly', endpointName: 'from', localSocketId: SOCKETS.assembly }),
  Object.freeze({ portalId: 'portal.security-sorting-alpha', endpointName: 'from', localSocketId: SOCKETS.sorting }),
  Object.freeze({ portalId: 'portal.freight-security-shortcut', endpointName: 'to', localSocketId: SOCKETS.freight }),
]);

function close(actual, expected, label, tolerance = POSITION_TOLERANCE) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`);
}

function pointInsideBounds(point, bounds, epsilon = 1e-6) {
  return ['x', 'y', 'z'].every((axis) => (
    point[axis] >= bounds.min[axis] - epsilon
    && point[axis] <= bounds.max[axis] + epsilon
  ));
}

function boundsOverlap(left, right, epsilon = 1e-6) {
  return ['x', 'y', 'z'].every((axis) => (
    left.max[axis] > right.min[axis] + epsilon
    && left.min[axis] < right.max[axis] - epsilon
  ));
}

function clearanceBounds(position, horizontalRadius, height) {
  return {
    min: {
      x: position.x - horizontalRadius,
      y: position.y + POSITION_TOLERANCE,
      z: position.z - horizontalRadius,
    },
    max: {
      x: position.x + horizontalRadius,
      y: position.y + height,
      z: position.z + horizontalRadius,
    },
  };
}

function sphereBounds(position, radius) {
  return {
    min: {
      x: position.x - radius,
      y: position.y - radius,
      z: position.z - radius,
    },
    max: {
      x: position.x + radius,
      y: position.y + radius,
      z: position.z + radius,
    },
  };
}

function supported(point, surface, tolerance = POSITION_TOLERANCE) {
  return point.x >= surface.bounds.min.x - tolerance
    && point.x <= surface.bounds.max.x + tolerance
    && point.z >= surface.bounds.min.z - tolerance
    && point.z <= surface.bounds.max.z + tolerance
    && Math.abs(point.y - surface.bounds.max.y) <= tolerance;
}

function reachableSurfaceIds(plan, startSurfaceId) {
  const adjacency = new Map();
  const add = (from, to) => {
    const targets = adjacency.get(from) ?? new Set();
    targets.add(to);
    adjacency.set(from, targets);
  };
  for (const link of plan.traversalLinks) {
    add(link.fromSurfaceId, link.toSurfaceId);
    if (link.bidirectional === true) add(link.toSurfaceId, link.fromSurfaceId);
  }
  const visited = new Set([startSurfaceId]);
  const queue = [startSurfaceId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const target of adjacency.get(queue[cursor]) ?? []) {
      if (visited.has(target)) continue;
      visited.add(target);
      queue.push(target);
    }
  }
  return visited;
}

function assertSocketContracts(plan, placement, descriptor, compiled) {
  const expectedOpen = [SOCKETS.assembly, SOCKETS.sorting, SOCKETS.freight].sort();
  assert.deepEqual(placement.localOpenSocketIds, expectedOpen);
  assert.deepEqual(placement.cappedSocketIds, [SOCKETS.cappedLift]);
  assert.deepEqual(placement.socketStateContracts, [
    { socketId: SOCKETS.sorting, state: 'portal-bound' },
    { socketId: SOCKETS.assembly, state: 'portal-bound' },
    { socketId: SOCKETS.freight, state: 'portal-bound' },
    { socketId: SOCKETS.cappedLift, state: 'opaque-capped' },
  ]);

  const socketByLocalId = new Map(compiled.portals.map((socket) => [socket.localId, socket]));
  for (const socketId of expectedOpen) {
    assert.equal(socketByLocalId.get(socketId)?.state, 'paired-open', `${socketId} is open`);
  }
  assert.equal(socketByLocalId.get(SOCKETS.cappedLift)?.state, 'opaque-capped');

  for (const { portalId, endpointName, localSocketId } of BINDINGS) {
    const portal = plan.portals.find(({ id }) => id === portalId);
    const endpoint = portal?.[endpointName];
    const socket = socketByLocalId.get(localSocketId);
    assert.ok(portal && endpoint && socket);
    assert.equal(endpoint.nativeFixedRoomSocketId, socket.id);
    assert.equal(endpoint.boundaryId.startsWith(`${PLACEMENT_ID}:boundary.`), true);
    assert.equal(socket.approachSurfaceIds.includes(
      portal.physicalRoute.endpointSurfaceIds[endpointName],
    ), true, `${portalId} terminates on its descriptor approach surface`);
    close(endpoint.center.x, socket.anchor.x, `${portalId}.x`);
    close(endpoint.center.z, socket.anchor.z, `${portalId}.z`);
    close(endpoint.elevation, socket.anchor.y, `${portalId}.elevation`);
    assert.equal(endpoint.dimensions.width, 3.2);
    assert.equal(portal.traversal.minimumWidth, 3.2,
      `${portalId} uses the narrowest real endpoint, not the retired 4.8m generic width`);
    assert.ok(portal.physicalRoute.cellIds.length > 0);
    assert.ok(portal.physicalRoute.surfaceIds.length > 0);
  }

  const nativeBoundaries = plan.structuralBoundaries.filter(({ cellId, presentationOwnerId }) => (
    cellId === CELL_ID && presentationOwnerId === PLACEMENT_ID
  ));
  const transform = placement.transform ?? placement;
  const wallProbe = (socketId) => {
    const socket = descriptor.extensionSockets.find(({ id }) => id === socketId);
    return transformPointQuarterTurns({
      x: socket.anchor.x,
      y: socket.anchor.y + socket.opening.height * 0.5,
      z: socket.anchor.z,
    }, transform);
  };
  for (const socketId of expectedOpen) {
    assert.equal(nativeBoundaries.some(({ bounds }) => pointInsideBounds(wallProbe(socketId), bounds)), false,
      `${socketId} has a physical player/camera-clear wall aperture`);
  }
  assert.equal(nativeBoundaries.some(({ bounds }) => pointInsideBounds(
    wallProbe(SOCKETS.cappedLift), bounds,
  )), true, 'unused west cargo-lift socket is visibly and physically capped');
}

function assertNativeRoomAndRamp(plan, descriptor) {
  const surfaceById = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
  const alphaPortal = plan.portals.find(({ id }) => id === 'portal.security-sorting-alpha');
  const allBoundaries = plan.structuralBoundaries.filter(({ cellId }) => cellId === CELL_ID);
  const boundaries = allBoundaries.filter(({ presentationOwnerId }) => (
    presentationOwnerId === PLACEMENT_ID
  ));
  const surfaces = plan.walkableSurfaces.filter(({ cellId }) => cellId === CELL_ID);
  const fixtures = plan.structuralFixtures.filter(({ cellId }) => cellId === CELL_ID);
  assert.equal(boundaries.length, 339);
  assert.deepEqual(allBoundaries
    .filter(({ presentationOwnerId }) => presentationOwnerId !== PLACEMENT_ID)
    .map(({ id }) => id), ['Door_Alpha'],
  'the plan-owned closed Alpha gate is the only non-descriptor Security boundary');
  assert.equal(surfaces.length, descriptor.floorTopology.walkableSurfaces.length);
  assert.equal(boundaries.every(({ presentationOwnerId }) => presentationOwnerId === PLACEMENT_ID), true);
  assert.equal(surfaces.every(({ presentationOwnerId }) => presentationOwnerId === PLACEMENT_ID), true);
  assert.equal(allBoundaries.some(({ id }) => id.startsWith('boundary.security.')), false,
    'retired generic Security shell is absent');
  assert.equal(surfaces.some(({ id }) => id.startsWith('surface.security.')), false,
    'retired generic Security floor/landing slabs are absent');
  for (const fixture of descriptor.fixtures) {
    assert.ok(fixtures.some(({ id }) => id === `${PLACEMENT_ID}:${fixture.id}`),
      `${fixture.id} remains a genuine V1 fixture`);
  }

  const rampSurfaces = surfaces
    .filter(({ traversalRoute }) => (
      traversalRoute?.routeId === 'ramp.security-entrance.west-catwalk-access'
    ))
    .sort((left, right) => left.traversalRoute.sequenceIndex - right.traversalRoute.sequenceIndex);
  assert.equal(rampSurfaces.length, 3, 'Security uses exactly the three authored V1 ramp tiles');
  assert.deepEqual(rampSurfaces.map(({ localId }) => localId), [
    'surface.v1-room.security-entrance.-3.3.0',
    'surface.v1-room.security-entrance.-2.3.0',
    'surface.v1-room.security-entrance.-1.3.0',
  ]);
  const stair = rampSurfaces[0].stairs;
  assert.deepEqual(stair.nativeRampSurfaceIds, rampSurfaces.map(({ id }) => id));
  assert.deepEqual(stair.endpointSurfaceIds, {
    start: `${PLACEMENT_ID}:surface.v1-room.security-entrance.0.3.0`,
    end: `${PLACEMENT_ID}:surface.v1-room.security-entrance.-4.3.0`,
  });
  assert.deepEqual(stair.path, [
    { x: -48.4, y: 0, z: 48.4 },
    { x: -56.8, y: 1.05, z: 48.4 },
  ]);
  assert.equal(stair.width, 2.8);
  assert.equal(stair.ledgeClimbDisabled, true);

  const stairLink = plan.traversalLinks.find(({ id }) => (
    id === 'traversal.security.security-sorting-alpha'
  ));
  assert.equal(stairLink?.viaSurfaceId, rampSurfaces[0].id);
  assert.deepEqual(stairLink.nativeRampSurfaceIds, stair.nativeRampSurfaceIds);
  assert.equal(stairLink.toSurfaceId, alphaPortal.physicalRoute.endpointSurfaceIds.from);
  assert.equal(stairLink.approachContract?.jumpAllowed, false);
  assert.equal(stairLink.approachContract?.ledgeClimbAllowed, false);
  assert.equal(stairLink.destinationHorizontalTolerance, 0.55);
  assert.equal(stairLink.destinationVerticalTolerance, 0.2);
  assert.deepEqual(stairLink.stairWaypoints[0], stair.path[0]);
  assert.deepEqual(stairLink.stairWaypoints.at(-1), stair.path.at(-1));
  const alphaSocket = descriptor.extensionSockets.find(({ id }) => id === SOCKETS.sorting);
  const expectedGateRouteSurfaceIds = [...alphaSocket.approachSurfaceIds]
    .reverse()
    .map((localSurfaceId) => `${PLACEMENT_ID}:${localSurfaceId}`);
  assert.deepEqual(stairLink.nativeGateRouteSurfaceIds, expectedGateRouteSurfaceIds,
    'the Alpha route must retain every V1 ramp, west-catwalk, and north-catwalk surface');
  const flatGateRouteSurfaces = expectedGateRouteSurfaceIds
    .map((surfaceId) => surfaceById.get(surfaceId))
    .filter((surface) => surface
      && surface.id !== stair.endpointSurfaceIds.start
      && !stair.nativeRampSurfaceIds.includes(surface.id));
  assert.deepEqual(
    stairLink.waypoints.slice(stairLink.stairWaypoints.length),
    flatGateRouteSurfaces.map((surface) => ({
      x: surface.center.x,
      y: surface.bounds.max.y,
      z: surface.center.z,
    })),
    'the public Alpha path must continue from the ramp across the native catwalk to the gate',
  );
  for (let index = 1; index < stairLink.waypoints.length; index += 1) {
    const previous = stairLink.waypoints[index - 1];
    const current = stairLink.waypoints[index];
    assert.ok(Math.hypot(current.x - previous.x, current.z - previous.z) <= 2.8 + 1e-9,
      `Alpha route segment ${index - 1}-${index} skips a native support tile`);
  }
  const alphaInlet = surfaceById.get(alphaPortal.physicalRoute.endpointSurfaceIds.from);
  assert.deepEqual(stairLink.waypoints.at(-1), {
    x: alphaInlet.center.x,
    y: alphaInlet.bounds.max.y,
    z: alphaInlet.center.z,
  });
  assert.deepEqual(stairLink.nativeGateRouteSurfaceIds.at(-1), alphaInlet.id);

  const nativeSupports = fixtures.filter(({ nativeFixedRoomPlacementId }) => (
    nativeFixedRoomPlacementId === PLACEMENT_ID
  ));
  assert.equal(nativeSupports.filter(({ type }) => type === 'native-v1-solid-deck-mass').length, 0,
    'the working V1 Security catwalk is a thin deck, never a broad floor-to-deck wall');
  const catwalkFrames = nativeSupports.filter(({ type }) => type === 'native-v1-catwalk-frame');
  assert.equal(catwalkFrames.length, 1);
  assert.equal(catwalkFrames[0].sourceArchitecture,
    'DungeonGenerator._addFactoryTileSupports+_addFactoryRailRuns');
  assert.ok(catwalkFrames[0].catwalkProfile.railOpenings.some(({ reason }) => (
    reason === 'paired-horizontal-portal'
  )), 'the Alpha gate approach is an intentional full-width break in the catwalk rail');
  assert.equal(nativeSupports.filter(({ type }) => type === 'native-v1-ramp-support').length, 1);
  assert.equal(rampSurfaces.every(({ supportFixtureIds }) => supportFixtureIds.length === 1), true);
  return { boundaries, surfaces, fixtures, rampSurfaces };
}

function assertAnchorsGateAndConnectivity(plan, descriptor) {
  const surfaceById = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
  const placement = plan.modulePlacements.find(({ id }) => id === PLACEMENT_ID);
  for (const [anchorId, descriptorAnchorId] of [
    ['anchor.player-start', 'anchor.ruin-entry'],
    ['anchor.key-seeker', 'anchor.key-seeker'],
  ]) {
    const anchor = plan.anchors.find(({ id }) => id === anchorId);
    const descriptorAnchor = descriptor.landmarkAnchors.find(({ id }) => id === descriptorAnchorId);
    const transformed = transformPointQuarterTurns(descriptorAnchor.localPosition, placement.transform);
    const surface = surfaceById.get(anchor.surfaceId);
    assert.equal(anchor.nativeFixedRoomPlacementId, PLACEMENT_ID);
    assert.equal(anchor.nativeDescriptorAnchorId, descriptorAnchorId);
    close(anchor.position.x, transformed.x, `${anchorId}.x`);
    close(anchor.position.z, transformed.z, `${anchorId}.z`);
    assert.equal(supported(anchor.position, surface), true);
  }
  const player = plan.anchors.find(({ id }) => id === 'anchor.player-start');
  const safe = plan.safeAnchors.find(({ id }) => id === 'safe.security-start');
  assert.equal(player.surfaceId, `${PLACEMENT_ID}:${SPAWN_SURFACE_LOCAL_ID}`);
  assert.deepEqual(player.position, { x: -47, y: 0, z: 37.2 });
  assert.deepEqual(player.forward, { x: 0, y: 0, z: 1 });
  assert.ok(player.spawnClearance.capsuleRadius >= PLAYER_TRAVERSAL_ENVELOPE.collisionRadius);
  assert.ok(player.spawnClearance.capsuleHeight >= 3.2);
  assert.equal(player.spawnClearance.nonCollidingVisualOverlapAllowed, false);
  assert.deepEqual(safe.position, player.position);
  assert.equal(safe.surfaceId, player.surfaceId);
  assert.equal(safe.nativeFixedRoomPlacementId, PLACEMENT_ID);
  assert.deepEqual(safe.spawnClearance, player.spawnClearance);

  const alphaPortal = plan.portals.find(({ id }) => id === 'portal.security-sorting-alpha');
  const alphaGate = plan.progression.gateContracts.find(({ id }) => id === 'Door_Alpha');
  const alphaBarrier = plan.structuralBoundaries.find(({ id }) => id === 'Door_Alpha');
  const alphaAnchor = plan.anchors.find(({ id }) => id === 'anchor.gate.alpha');
  const alphaPad = surfaceById.get(alphaAnchor.surfaceId);
  const alphaAction = plan.actions.find(({ id }) => id === 'action.open.door-alpha');
  const alphaFixture = plan.structuralFixtures.find(({ id }) => (
    id === 'fixture.interaction.open.door-alpha'
  ));
  assert.equal(alphaGate.classification, 'non-bypassable-progression');
  assert.equal(alphaBarrier.blocksPortalId, alphaPortal.id);
  assert.equal(alphaBarrier.collider, true);
  assert.equal(alphaBarrier.opaque, true);
  assert.equal(alphaBarrier.collision, 'dynamic');
  assert.equal(alphaPad.interactionSurfaceRole, 'side-control-pad');
  assert.equal(alphaPad.collision, 'static');
  assert.equal(alphaPad.createsLedgeCandidates, false);
  assert.deepEqual(alphaAnchor.forward, { x: -1, y: 0, z: 0 });
  assert.equal(alphaAction.interaction.activationSide, 'either');
  assert.equal(alphaAction.interaction.requiresLineOfSight, false);
  assert.equal(alphaAction.barrierIds.includes(alphaBarrier.id), true);
  assert.equal(alphaFixture.nativeSupportSurfaceId, alphaPad.id);
  assert.equal(alphaFixture.colliderBounds.length, 1);
  assert.equal(supported(alphaAnchor.position, alphaPad), true);
  for (const surfaceId of new Set([
    alphaPortal.physicalRoute.endpointSurfaceIds.from,
    alphaPortal.physicalRoute.endpointSurfaceIds.to,
    ...alphaPortal.physicalRoute.surfaceIds,
  ])) {
    assert.equal(surfaceById.get(surfaceId)?.closedGatePortalIds?.includes(alphaPortal.id), true,
      `${surfaceId} cannot offer a ledge bypass around Door_Alpha`);
  }

  const keyFixture = plan.structuralFixtures.find(({ id }) => (
    id === 'fixture.interaction.activate.key-seeker'
  ));
  const keyAnchor = plan.anchors.find(({ id }) => id === 'anchor.key-seeker');
  assert.equal(keyFixture.nativeSupportSurfaceId, keyAnchor.surfaceId);
  assert.equal(keyFixture.colliderBounds.length, 1);

  const start = player.surfaceId;
  const reachable = reachableSurfaceIds(plan, start);
  for (const surfaceId of [
    keyAnchor.surfaceId,
    alphaAnchor.surfaceId,
    ...BINDINGS.map(({ portalId, endpointName }) => (
      plan.portals.find(({ id }) => id === portalId).physicalRoute.endpointSurfaceIds[endpointName]
    )),
  ]) {
    assert.equal(reachable.has(surfaceId), true, `${surfaceId} is connected through native Security`);
  }

  const clearance = plan.connectorClearanceProofs.find(({ id }) => (
    id === 'connector-clearance.security-assembly.freight-security-shortcut'
  ));
  assert.equal(clearance?.accepted, true);
  assert.ok(clearance.maximumStackOverlap < PLAYER_SIZED_STACK_OVERLAP,
    'upper Assembly route cannot drop a player into the lower freight shortcut');
}

function assertNativeRuntime(plan, contracts, descriptor) {
  const assembly = assembleDungeonPlanV2(plan);
  try {
    assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.active, true);
    assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.placementCount, 11);
    assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.genericFallbackGeometry, false);
    assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.instanced, true);
    assertContinuousPortalRoutes(plan, assembly, buildIndependentPortalRouteProofs(plan, assembly));

    const mappings = assembly.legacyFixedRoomVisualMappings.filter(({ placementId }) => (
      placementId === PLACEMENT_ID
    ));
    assert.equal(mappings.length, 496);
    const mappedPlanIds = new Set(mappings.map(({ planId }) => planId));
    for (const contract of [...contracts.boundaries, ...contracts.surfaces]) {
      assert.equal(mappedPlanIds.has(contract.id), true, `${contract.id} has an exact V1 visual mapping`);
      assert.ok(assembly.structuralRegistry.getCollider(contract.id), `${contract.id} has plan collision`);
    }
    const mappedLocalIds = new Set(mappings.map(({ localContractId }) => localContractId));
    for (const fixture of descriptor.fixtures) {
      assert.equal(mappedLocalIds.has(fixture.id), true, `${fixture.id} renders from its V1 recipe`);
    }
    for (const support of contracts.fixtures.filter(({ nativeFixedRoomPlacementId }) => (
      nativeFixedRoomPlacementId === PLACEMENT_ID
    ))) {
      assert.ok(assembly.structuralRegistry.getVisual(support.id), `${support.id} is visibly assembled`);
      for (const colliderId of support.colliderIds) {
        assert.ok(assembly.structuralRegistry.getColliderById(colliderId), `${colliderId} is registered`);
      }
    }

    const playerStart = plan.anchors.find(({ id }) => id === 'anchor.player-start');
    const clearance = playerStart.spawnClearance;
    const structuralAudit = assembly.structuralRegistry.auditSnapshot();
    const bodyEnvelope = clearanceBounds(
      playerStart.position,
      clearance.capsuleRadius,
      clearance.capsuleHeight,
    );
    const fixtureVisualOverlaps = structuralAudit.visualEntries.filter((entry) => (
      entry.visible
      && entry.regionId === 'security'
      && entry.role?.startsWith('structural-fixture:')
      && entry.bounds
      && boundsOverlap(bodyEnvelope, entry.bounds)
    ));
    assert.deepEqual(fixtureVisualOverlaps.map(({ visualId }) => visualId), [],
      'the accepted player-start body envelope cannot overlap any reachable V1 prop presentation');

    const activeColliderOverlaps = structuralAudit.colliderEntries.filter((entry) => (
      entry.active
      && entry.regionId === 'security'
      && entry.bounds
      && boundsOverlap(bodyEnvelope, entry.bounds)
    ));
    assert.deepEqual(activeColliderOverlaps.map(({ colliderId }) => colliderId), [],
      'the accepted player-start body envelope must begin outside every active blocker');

    const cameraPosition = {
      x: playerStart.position.x - playerStart.forward.x * clearance.cameraFollowDistance,
      y: playerStart.position.y + clearance.cameraHeight,
      z: playerStart.position.z - playerStart.forward.z * clearance.cameraFollowDistance,
    };
    const cameraEnvelope = sphereBounds(cameraPosition, clearance.cameraRadius);
    const cameraVisualOverlaps = structuralAudit.visualEntries.filter((entry) => (
      entry.visible
      && entry.regionId === 'security'
      && entry.role?.startsWith('structural-fixture:')
      && entry.bounds
      && boundsOverlap(cameraEnvelope, entry.bounds)
    ));
    const cameraColliderOverlaps = structuralAudit.colliderEntries.filter((entry) => (
      entry.active
      && entry.regionId === 'security'
      && entry.bounds
      && boundsOverlap(cameraEnvelope, entry.bounds)
    ));
    assert.deepEqual(cameraVisualOverlaps.map(({ visualId }) => visualId), [],
      'the default follow camera cannot begin inside visible Security fixtures');
    assert.deepEqual(cameraColliderOverlaps.map(({ colliderId }) => colliderId), [],
      'the default follow camera cannot begin inside Security collision');

    const scannerFixtureId = `${PLACEMENT_ID}:fixture.${DESCRIPTOR_ID}.scanner-arch`;
    const scannerVisuals = structuralAudit.visualEntries.filter(({ planId }) => planId === scannerFixtureId);
    const scannerColliders = structuralAudit.colliderEntries.filter(({ planId }) => planId === scannerFixtureId);
    assert.equal(scannerVisuals.length, 3, 'native scanner keeps two posts and its cyan V1 header');
    assert.deepEqual(scannerVisuals.map(({ instanceId }) => instanceId).sort(), [
      `${PLACEMENT_ID}:fixture.${DESCRIPTOR_ID}.scanner-arch.east-scanner-post`,
      `${PLACEMENT_ID}:fixture.${DESCRIPTOR_ID}.scanner-arch.scanner-header`,
      `${PLACEMENT_ID}:fixture.${DESCRIPTOR_ID}.scanner-arch.west-scanner-post`,
    ]);
    assert.equal(scannerColliders.length, 2, 'scanner collision remains the two visible side posts');
    assert.equal(scannerVisuals.some(({ bounds }) => boundsOverlap(bodyEnvelope, bounds)), false,
      'the cyan scanner header no longer intersects Volnutt at spawn');
  } finally {
    assembly.dispose();
  }
}

const descriptor = getLegacyFixedRoomModuleV2(DESCRIPTOR_ID);
assert.ok(descriptor);

for (const undercroftType of ['magma', 'electrical']) {
  test(`actual ${undercroftType} seed integrates native V1 Security with a scanner-clear player/camera spawn`, () => {
    const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
      seed: `native-security-entrance-${undercroftType}-actual-seed`,
      undercroftType,
    }), { throwOnError: false });
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    const plan = validation.plan;
    const placement = plan.modulePlacements.find(({ id }) => id === PLACEMENT_ID);
    assert.equal(placement?.descriptorId, DESCRIPTOR_ID);
    assert.equal(placement.presentationProfileId, 'legacy-fixed-room-native-v2');
    assert.equal(placement.nativeIntegrationStatus, 'playable-plan-owned');
    assert.equal(plan.nativeFixedRoomIntegration.activePlacementIds.length, 11);
    assert.equal(new Set(plan.nativeFixedRoomIntegration.activePlacementIds).size, 11);
    assert.deepEqual([...plan.nativeFixedRoomIntegration.activeDescriptorIds].sort(),
      EXPECTED_DESCRIPTOR_IDS);
    assert.deepEqual(plan.nativeFixedRoomIntegration.incompleteDescriptorIds, []);
    assert.equal(plan.nativeFixedRoomIntegration.genericFallbackGeometry, false);

    const rebuilt = recompileAcceptedLegacyFixedRoomPlacementV2(placement);
    assert.strictEqual(rebuilt.module, descriptor);
    assertSocketContracts(plan, placement, descriptor, rebuilt.expectedPlacement);
    const contracts = assertNativeRoomAndRamp(plan, descriptor);
    assertAnchorsGateAndConnectivity(plan, descriptor);
    assertNativeRuntime(plan, contracts, descriptor);
  });
}
