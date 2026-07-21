import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { getLegacyFixedRoomModuleV2 } from '../../../src/dungeon-v2/LegacyFixedRoomModuleCatalogV2.js';
import { recompileAcceptedLegacyFixedRoomPlacementV2 } from '../../../src/dungeon-v2/LegacyFixedRoomRuntimeAdapterV2.js';
import { transformPointQuarterTurns } from '../../../src/dungeon-v2/DungeonSpatialMathV2.js';
import { assertContinuousPortalRoutes } from '../helpers/accepted-fixture.mjs';
import { buildIndependentPortalRouteProofs } from '../helpers/assembly-proofs.mjs';

const PLACEMENT_ID = 'placement.assembly';
const DESCRIPTOR_ID = 'v1-room.machine-factory';
const NATIVE_PROFILE = 'legacy-fixed-room-native-v2';
const FLOAT32_WORLD_BOUNDS_TOLERANCE = 1e-5;
const POSITION_TOLERANCE = 0.051;

const SOCKETS = Object.freeze({
  securityIngress: 'socket.v1-room.machine-factory.ground.south-east-bucket',
  serverEgress: 'socket.v1-room.machine-factory.catwalk.north-center',
  freightDrop: 'socket.v1-room.machine-factory.lower.freight-catchment',
  cappedWaterBreach: 'socket.v1-room.machine-factory.pipe.east-center',
});

const PORTAL_BINDINGS = Object.freeze([
  Object.freeze({ portalId: 'portal.security-assembly', endpointName: 'to', localSocketId: SOCKETS.securityIngress }),
  Object.freeze({ portalId: 'portal.assembly-server', endpointName: 'from', localSocketId: SOCKETS.serverEgress }),
  Object.freeze({ portalId: 'portal.assembly-freight-drop', endpointName: 'from', localSocketId: SOCKETS.freightDrop }),
]);

function assertClose(actual, expected, label, tolerance = POSITION_TOLERANCE) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`);
}

function assertBoundsEqual(actual, expected, label) {
  for (const axis of ['x', 'y', 'z']) {
    assertClose(actual.min[axis], expected.min[axis], `${label}.min.${axis}`, FLOAT32_WORLD_BOUNDS_TOLERANCE);
    assertClose(actual.max[axis], expected.max[axis], `${label}.max.${axis}`, FLOAT32_WORLD_BOUNDS_TOLERANCE);
  }
}

function instanceBounds(batch, index) {
  batch.geometry.computeBoundingBox();
  const matrix = new THREE.Matrix4();
  batch.getMatrixAt(index, matrix);
  assert.ok(matrix.elements.every(Number.isFinite), `${batch.name}[${index}] has a finite transform`);
  return batch.geometry.boundingBox.clone().applyMatrix4(matrix);
}

function pointInsideBounds(point, bounds, epsilon = 1e-6) {
  return ['x', 'y', 'z'].every((axis) => (
    point[axis] >= bounds.min[axis] - epsilon
    && point[axis] <= bounds.max[axis] + epsilon
  ));
}

function pointSupportedBySurface(point, surface, tolerance = POSITION_TOLERANCE) {
  return point.x >= surface.bounds.min.x - tolerance
    && point.x <= surface.bounds.max.x + tolerance
    && point.z >= surface.bounds.min.z - tolerance
    && point.z <= surface.bounds.max.z + tolerance
    && Math.abs(point.y - surface.bounds.max.y) <= tolerance;
}

function reachableSurfaceIds(plan, startSurfaceId) {
  const adjacency = new Map();
  const addEdge = (from, to) => {
    if (!from || !to) return;
    const targets = adjacency.get(from) ?? new Set();
    targets.add(to);
    adjacency.set(from, targets);
  };
  for (const link of plan.traversalLinks) {
    addEdge(link.fromSurfaceId, link.toSurfaceId);
    if (link.bidirectional === true) addEdge(link.toSurfaceId, link.fromSurfaceId);
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

function assertNativeAnchor(plan, descriptor, descriptorAnchorId, { exactPlanAnchorId = null } = {}) {
  const descriptorAnchor = descriptor.landmarkAnchors.find(({ id }) => id === descriptorAnchorId);
  assert.ok(descriptorAnchor, `${DESCRIPTOR_ID} declares ${descriptorAnchorId}`);
  const anchor = exactPlanAnchorId
    ? plan.anchors.find(({ id }) => id === exactPlanAnchorId)
    : plan.anchors.find(({ nativeDescriptorAnchorId }) => nativeDescriptorAnchorId === descriptorAnchorId);
  assert.ok(anchor, `${descriptorAnchorId} has a plan-owned anchor binding`);
  assert.equal(anchor.nativeDescriptorAnchorId, descriptorAnchorId);
  assert.equal(anchor.nativeFixedRoomPlacementId, PLACEMENT_ID);
  assert.equal(anchor.surfaceId.startsWith(`${PLACEMENT_ID}:surface.`), true,
    `${anchor.id} is grounded on a native Machine Factory surface`);
  const surface = plan.walkableSurfaces.find(({ id }) => id === anchor.surfaceId);
  assert.ok(surface, `${anchor.id} references an assembled walkable surface`);
  assert.equal(surface.presentationOwnerId, PLACEMENT_ID);
  assert.equal(pointSupportedBySurface(anchor.position, surface), true,
    `${anchor.id} is physically supported at the exact native surface height`);
  return { anchor, descriptorAnchor, surface };
}

function assertSocketBindings(plan, placement, compiledPlacement, descriptor) {
  const expectedLocalOpenSocketIds = [
    SOCKETS.securityIngress,
    SOCKETS.serverEgress,
    SOCKETS.freightDrop,
  ].sort();
  assert.deepEqual(placement.localOpenSocketIds, expectedLocalOpenSocketIds,
    'Assembly opens only its authored ingress, elevated egress, and intentional drop');
  assert.deepEqual(placement.openSocketIds, expectedLocalOpenSocketIds.map((id) => `${PLACEMENT_ID}:${id}`),
    'world socket IDs retain the placement-qualified descriptor identity');

  const compiledSocketByLocalId = new Map(compiledPlacement.portals.map((socket) => [socket.localId, socket]));
  for (const localSocketId of expectedLocalOpenSocketIds) {
    assert.equal(compiledSocketByLocalId.get(localSocketId)?.state, 'paired-open', `${localSocketId} is paired-open`);
  }
  assert.equal(compiledSocketByLocalId.get(SOCKETS.cappedWaterBreach)?.state, 'opaque-capped',
    'the unused east pipe-water socket stays physically capped');

  for (const binding of PORTAL_BINDINGS) {
    const portal = plan.portals.find(({ id }) => id === binding.portalId);
    const endpoint = portal?.[binding.endpointName];
    const socket = compiledSocketByLocalId.get(binding.localSocketId);
    const descriptorSocket = descriptor.extensionSockets.find(({ id }) => id === binding.localSocketId);
    assert.ok(portal && endpoint && socket && descriptorSocket, `${binding.portalId} resolves its native descriptor socket`);
    assert.equal(endpoint.nativeFixedRoomSocketId, socket.id,
      `${binding.portalId}:${binding.endpointName} names the exact placed socket`);
    assert.equal(endpoint.boundaryId.startsWith(`${PLACEMENT_ID}:boundary.`), true,
      `${binding.portalId}:${binding.endpointName} is cut through a native boundary`);
    const endpointSurfaceId = portal.physicalRoute.endpointSurfaceIds[binding.endpointName];
    if (binding.localSocketId === SOCKETS.freightDrop) {
      const crumbleSurface = plan.walkableSurfaces.find(({ id }) => id === endpointSurfaceId);
      assert.equal(crumbleSurface?.collision, 'dynamic',
        `${binding.portalId}:${binding.endpointName} terminates on the physical crumble panel`);
      assert.equal(crumbleSurface?.nativeFixedRoomSocketId, socket.id,
        'the automatic crumble panel occupies the exact native freight aperture');
      assert.equal(plan.traversalLinks.some((link) => (
        socket.approachSurfaceIds.includes(link.fromSurfaceId)
        && link.toSurfaceId === crumbleSurface.id
        && link.conditions?.some((condition) => (
          condition.op === 'stateEquals'
          && condition.variableId === 'mechanism.freight-crumble.state'
          && condition.value === 'Intact'
        ))
      )), true, 'a surviving descriptor approach surface physically reaches the intact crumble panel');
    } else {
      assert.equal(socket.approachSurfaceIds.includes(endpointSurfaceId), true,
        `${binding.portalId}:${binding.endpointName} terminates on a declared socket approach surface`);
    }
    assertClose(endpoint.center.x, socket.anchor.x, `${binding.portalId}:${binding.endpointName}.center.x`);
    assertClose(endpoint.center.z, socket.anchor.z, `${binding.portalId}:${binding.endpointName}.center.z`);
    assertClose(endpoint.elevation, socket.anchor.y, `${binding.portalId}:${binding.endpointName}.elevation`);
    assert.ok(Number(portal.traversal.minimumWidth) >= Number(descriptorSocket.opening.width) - POSITION_TOLERANCE,
      `${binding.portalId} preserves the descriptor opening width`);
  }

  const assemblyBoundaries = plan.structuralBoundaries.filter(({ presentationOwnerId }) => (
    presentationOwnerId === PLACEMENT_ID
  ));
  const transform = placement.transform ?? placement;
  const wallOpeningProbe = (localSocketId) => {
    const socket = descriptor.extensionSockets.find(({ id }) => id === localSocketId);
    return transformPointQuarterTurns({
      x: socket.anchor.x,
      y: socket.anchor.y + socket.opening.height * 0.5,
      z: socket.anchor.z,
    }, transform);
  };
  for (const localSocketId of [SOCKETS.securityIngress, SOCKETS.serverEgress]) {
    const probe = wallOpeningProbe(localSocketId);
    assert.equal(assemblyBoundaries.some(({ bounds }) => pointInsideBounds(probe, bounds)), false,
      `${localSocketId} has real player/camera-clear wall aperture, not a merely declared portal`);
  }
  const eastCapProbe = wallOpeningProbe(SOCKETS.cappedWaterBreach);
  assert.equal(assemblyBoundaries.some(({ bounds }) => pointInsideBounds(eastCapProbe, bounds)), true,
    'the unused east socket has an opaque blocking wall at its opening center');

  const localDropSocket = descriptor.extensionSockets.find(({ id }) => id === SOCKETS.freightDrop);
  const dropAnchor = transformPointQuarterTurns(localDropSocket.anchor, transform);
  const staticFloorProbe = { ...dropAnchor, y: dropAnchor.y - 0.1 };
  assert.equal(assemblyBoundaries.filter(({ side }) => side === 'floor')
    .some(({ bounds }) => pointInsideBounds(staticFloorProbe, bounds)), false,
  'the intentional drop is physically carved through the static native foundation');
}

function assertNativeRoomContent(plan, placement, descriptor) {
  const assemblyBoundaries = plan.structuralBoundaries.filter(({ cellId }) => cellId === 'cell.assembly.main');
  const assemblySurfaces = plan.walkableSurfaces.filter(({ cellId }) => cellId === 'cell.assembly.main');
  assert.ok(assemblyBoundaries.length > 0 && assemblySurfaces.length > 0);
  assert.equal(assemblyBoundaries.every(({ presentationOwnerId }) => presentationOwnerId === PLACEMENT_ID), true,
    'the generic Assembly shell is completely replaced by the native room enclosure');
  assert.equal(assemblySurfaces.every((surface) => (
    surface.presentationOwnerId === PLACEMENT_ID
    || surface.nativeFixedRoomPlacementId === PLACEMENT_ID
  )), true, 'Assembly traversal uses exact V1 topology plus declared native socket extensions');
  assert.equal(assemblyBoundaries.some(({ id }) => id.startsWith('boundary.assembly.')), false);
  assert.deepEqual(assemblySurfaces
    .filter(({ id }) => id.startsWith('surface.assembly.'))
    .map(({ id }) => id), ['surface.assembly.native-freight-crumble'],
  'the automatic panel over the removed native freight tile is the only plan-native Assembly surface');

  const removedByDrop = new Set(descriptor.extensionSockets
    .filter(({ id }) => id === SOCKETS.freightDrop)
    .flatMap(({ aperture }) => aperture?.surfaceIds ?? []));
  const expectedSurfaceIds = descriptor.floorTopology.walkableSurfaces
    .map(({ id }) => id)
    .filter((id) => !removedByDrop.has(id));
  const nativeLocalSurfaceIds = new Set(assemblySurfaces.map(({ localId }) => localId).filter(Boolean));
  for (const localSurfaceId of expectedSurfaceIds) {
    assert.equal(nativeLocalSurfaceIds.has(localSurfaceId), true,
      `${localSurfaceId} survives exact native topology compilation`);
  }
  for (const removedSurfaceId of removedByDrop) {
    assert.equal(nativeLocalSurfaceIds.has(removedSurfaceId), false,
      `${removedSurfaceId} is removed for the playable freight drop`);
  }

  const roomFixtures = plan.structuralFixtures.filter((fixture) => (
    fixture.cellId === 'cell.assembly.main'
    && !fixture.id.startsWith('fixture.interaction.')
    && !fixture.id.startsWith('fixture.connector.')
  ));
  assert.deepEqual(roomFixtures
    .filter(({ id }) => id.startsWith('fixture.assembly.'))
    .map(({ id }) => id), ['fixture.assembly.native-freight-crumble-brackets'],
  'generic stand-ins are absent; only the socket-owned breakaway support extends the V1 room');
  assert.equal(roomFixtures.every((fixture) => (
    fixture.presentationOwnerId === PLACEMENT_ID
    || fixture.nativeFixedRoomPlacementId === PLACEMENT_ID
  )), true, 'every Assembly room fixture is owned by the native placement');

  const nativeFixtureIds = new Set(roomFixtures.map(({ id }) => id));
  for (const fixture of descriptor.fixtures) {
    assert.equal(nativeFixtureIds.has(`${PLACEMENT_ID}:${fixture.id}`), true,
      `${fixture.id} remains a genuine visible V1 machine fixture`);
  }

  const encounterBinding = assertNativeAnchor(plan, descriptor, 'anchor.encounter.assembly', {
    exactPlanAnchorId: 'anchor.encounter.assembly',
  });
  const cacheBinding = assertNativeAnchor(plan, descriptor, 'anchor.cache.assembly');
  const returnBinding = assertNativeAnchor(plan, descriptor, 'anchor.freight-return');
  assert.equal(removedByDrop.has(returnBinding.surface.localId), false,
    'the return anchor is rebound to a surviving native rim surface, never the removed drop tile');

  const dropSocket = descriptor.extensionSockets.find(({ id }) => id === SOCKETS.freightDrop);
  const dropCenter = transformPointQuarterTurns(dropSocket.anchor, placement.transform ?? placement);
  assert.ok(Math.hypot(
    returnBinding.anchor.position.x - dropCenter.x,
    returnBinding.anchor.position.z - dropCenter.z,
  ) >= dropSocket.opening.width * 0.5 + 0.46 - POSITION_TOLERANCE,
  'the freight return anchor leaves a full player radius outside the open aperture');

  const cacheReward = plan.rewards.find(({ anchorId }) => anchorId === cacheBinding.anchor.id);
  assert.ok(cacheReward, 'the upper native inspection cache remains plan-owned');
  assert.equal(cacheReward.type, 'reaverbot-parts-cache');
  assert.equal(cacheReward.regionId, 'assembly');

  const encounter = plan.encounters.find(({ id }) => id === 'encounter.assembly');
  assert.ok(encounter, 'the required Assembly encounter remains plan-owned');
  assert.equal(encounter.anchorId, encounterBinding.anchor.id);
  assert.equal(encounter.required, true);
  assert.equal(encounter.blocksPermanentRoute, false);
  assert.equal(encounter.spawnPoints.length, encounter.spawnSurfaceIds.length);
  for (const [index, point] of encounter.spawnPoints.entries()) {
    const surfaceId = encounter.spawnSurfaceIds[index];
    assert.equal(surfaceId.startsWith(`${PLACEMENT_ID}:surface.`), true,
      `Assembly spawn ${index} uses a native surface`);
    const surface = plan.walkableSurfaces.find(({ id }) => id === surfaceId);
    assert.ok(surface && pointSupportedBySurface(point, surface),
      `Assembly spawn ${index} is exactly grounded on ${surfaceId}`);
  }

  const fallPortal = plan.portals.find(({ id }) => id === 'portal.assembly-freight-drop');
  const fall = plan.falls.find(({ id }) => id === 'fall.assembly-freight-drop');
  assert.ok(fallPortal && fall, 'the native floor aperture retains its authored fall contract');
  assert.equal(fall.sourcePortalId, fallPortal.id);
  assert.equal(fallPortal.direction, 'forward-only');
  const crumbleSurface = plan.walkableSurfaces.find(({ id }) => (
    id === fallPortal.physicalRoute.endpointSurfaceIds.from
  ));
  const crumbleMechanism = plan.mechanisms.find(({ id }) => id === crumbleSurface?.mechanismId);
  assert.ok(crumbleSurface && crumbleMechanism, 'the source aperture owns a real crumble surface/controller pair');
  assert.equal(crumbleSurface.geometry?.type, 'crumble');
  assert.equal(crumbleSurface.geometry?.noManualRearm, true);
  assert.equal(crumbleMechanism.automaticReset, true);
  assert.equal(crumbleMechanism.runtimeProfile?.noManualRearm, true);
  assert.equal(crumbleMechanism.states.some(({ id, collision }) => id === 'Intact' && collision === true), true);
  assert.equal(crumbleMechanism.states.some(({ id, collision }) => id === 'Collapsed' && collision === false), true);
  assert.equal(crumbleMechanism.transitions.some(({ trigger, automatic }) => (
    trigger === 'player-contact' && automatic === true
  )), true, 'the panel visibly collapses from player contact without a rearm interaction');
  assert.equal(fall.damageFree, true);
  assert.equal(fall.playableDestination, true);
  assert.ok(plan.walkableSurfaces.some(({ id }) => id === fall.catchmentSurfaceId),
    'the intentional drop terminates on a real playable catchment');
  const catchmentSafeAnchor = plan.safeAnchors.find(({ id }) => id === fall.safeAnchorId);
  assert.equal(catchmentSafeAnchor?.surfaceId, fall.catchmentSurfaceId);
  assert.ok(fall.returnPortalIds.length >= 1);
  for (const returnPortalId of fall.returnPortalIds) {
    assert.ok(plan.portals.some(({ id }) => id === returnPortalId), `${returnPortalId} provides a physical return`);
  }
  const directFallLink = plan.traversalLinks.find((link) => (
    link.portalId === fallPortal.id
    && link.fromSurfaceId === fallPortal.physicalRoute.endpointSurfaceIds.from
    && link.toSurfaceId === fall.catchmentSurfaceId
  ));
  assert.ok(directFallLink && directFallLink.bidirectional === false
    && directFallLink.damageFree === true && directFallLink.playableDestination === true,
  'the fall is a forward-only, damage-free transition into playable Freight');

  const connectedTargets = [
    plan.portals.find(({ id }) => id === 'portal.security-assembly').physicalRoute.endpointSurfaceIds.to,
    plan.portals.find(({ id }) => id === 'portal.assembly-server').physicalRoute.endpointSurfaceIds.from,
    fallPortal.physicalRoute.endpointSurfaceIds.from,
    encounterBinding.anchor.surfaceId,
    cacheBinding.anchor.surfaceId,
    returnBinding.anchor.surfaceId,
  ];
  const reachable = reachableSurfaceIds(plan, connectedTargets[0]);
  for (const surfaceId of connectedTargets) {
    assert.equal(reachable.has(surfaceId), true,
      `${surfaceId} is physically connected through the native Assembly surface graph`);
  }

  return { assemblyBoundaries, assemblySurfaces, roomFixtures };
}

function assertNativeAssemblyRuntime(plan, placement, descriptor, contracts) {
  const assembly = assembleDungeonPlanV2(plan);
  try {
    assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.active, true);
    assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.genericFallbackGeometry, false);
    assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.instanced, true);
    assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.placementCount, 11,
      'the accepted actual seed must assemble every native V1 room, including Assembly and Shrine');
    assertContinuousPortalRoutes(
      plan,
      assembly,
      buildIndependentPortalRouteProofs(plan, assembly),
    );

    const mappings = assembly.legacyFixedRoomVisualMappings.filter(({ placementId }) => (
      placementId === PLACEMENT_ID
    ));
    assert.ok(mappings.length > 0, 'Assembly receives exact native V1 visual mappings');
    const mappedPlanIds = new Set(mappings.map(({ planId }) => planId));
    for (const contract of [...contracts.assemblyBoundaries, ...contracts.assemblySurfaces]
      .filter(({ presentationOwnerId }) => presentationOwnerId === PLACEMENT_ID)) {
      assert.equal(mappedPlanIds.has(contract.id), true, `${contract.id} has an exact native visual mapping`);
      const collider = assembly.structuralRegistry.getCollider(contract.id);
      assert.ok(collider, `${contract.id} has registered plan collision`);
      assertBoundsEqual(collider.bounds, contract.bounds, `${contract.id} collider parity`);
    }
    const crumbleSurface = contracts.assemblySurfaces.find(({ id }) => (
      id === 'surface.assembly.native-freight-crumble'
    ));
    const crumbleVisual = assembly.structuralRegistry.getVisual(crumbleSurface.id);
    const crumbleCollider = assembly.structuralRegistry.getCollider(crumbleSurface.id);
    assert.ok(crumbleVisual, 'the plan-native automatic crumble panel has a registered visible object');
    assert.ok(crumbleCollider, 'the plan-native automatic crumble panel has registered collision');
    assertBoundsEqual(crumbleCollider.bounds, crumbleSurface.bounds, 'native aperture crumble collider parity');

    const mappedLocalIds = new Set(mappings.map(({ localContractId }) => localContractId));
    for (const fixture of descriptor.fixtures) {
      assert.equal(mappedLocalIds.has(fixture.id), true, `${fixture.id} renders through its genuine V1 recipe`);
      const planFixture = contracts.roomFixtures.find(({ id }) => id === `${PLACEMENT_ID}:${fixture.id}`);
      assert.ok(planFixture);
      assert.ok(planFixture.colliderIds.length > 0);
      assert.equal(planFixture.colliderIds.length, planFixture.colliderBounds.length);
      for (const [index, colliderId] of planFixture.colliderIds.entries()) {
        const collider = assembly.structuralRegistry.getColliderById(colliderId);
        assert.ok(collider, `${fixture.id} collider ${index} is registered`);
        assertBoundsEqual(collider.bounds, planFixture.colliderBounds[index], `${fixture.id} collider ${index}`);
      }
    }

    const nativeSupports = plan.structuralFixtures.filter(({ nativeFixedRoomPlacementId }) => (
      nativeFixedRoomPlacementId === PLACEMENT_ID
    ));
    assert.equal(nativeSupports.filter(({ type }) => type === 'native-v1-solid-deck-mass').length, 0,
      'ordinary V1 Machine Factory catwalks must remain thin decks over open framed underpasses');
    const catwalkFrames = nativeSupports.filter(({ type }) => type === 'native-v1-catwalk-frame');
    assert.equal(catwalkFrames.length, 2);
    assert.equal(catwalkFrames.every((fixture) => (
      fixture.sourceArchitecture === 'DungeonGenerator._addFactoryTileSupports+_addFactoryRailRuns'
      && fixture.colliderIds.length === fixture.partRoles.length
      && fixture.partRoles.includes('support-post')
      && fixture.partRoles.includes('underbeam-x')
      && fixture.partRoles.includes('underbeam-z')
      && fixture.partRoles.includes('rail-run')
      && fixture.partRoles.includes('rail-post')
    )), true, 'both native catwalk components preserve the exact V1 frame vocabulary');
    assert.equal(nativeSupports.filter(({ type }) => type === 'native-v1-ramp-support').length, 1);
    const raisedNativeSurfaces = contracts.assemblySurfaces.filter(({ bounds }) => (
      bounds.max.y > placement.worldBounds.min.y + 0.5
    ));
    assert.ok(raisedNativeSurfaces.length > 0);
    assert.equal(raisedNativeSurfaces.every(({ supportFixtureIds }) => supportFixtureIds?.length === 1), true,
      'every raised deck and ramp tile names one exact visible support contract');
    const supportById = new Map(nativeSupports.map((fixture) => [fixture.id, fixture]));
    for (const surface of raisedNativeSurfaces) {
      assert.ok(supportById.has(surface.supportFixtureIds[0]), `${surface.id} support exists in the accepted plan`);
    }
    for (const fixture of nativeSupports) {
      const supportVisual = assembly.structuralRegistry.getVisual(fixture.id);
      assert.ok(supportVisual, `${fixture.id} has visible structure`);
      assert.equal(fixture.colliderIds.length, fixture.colliderBounds.length);
      for (const [index, colliderId] of fixture.colliderIds.entries()) {
        const collider = assembly.structuralRegistry.getColliderById(colliderId);
        assert.ok(collider, `${fixture.id} collider ${index} is registered`);
        assertBoundsEqual(collider.bounds, fixture.colliderBounds[index], `${fixture.id} collider ${index}`);
      }
      if (fixture.type === 'native-v1-catwalk-frame') {
        const batches = supportVisual.children.filter(({ userData }) => (
          userData.v2InstancedNativeCatwalkFrame === true
        ));
        assert.equal(batches.length, 2,
          `${fixture.id} renders one support-metal batch and one V1 factory-rail batch`);
        assert.equal(batches.reduce((count, batch) => count + batch.count, 0),
          fixture.colliderBounds.length);
        assert.deepEqual(new Set(batches.map(({ userData }) => userData.v2FrameMaterialProfileId)),
          new Set(['legacy-support', 'legacy-rail']));
        for (const batch of batches) {
          assert.ok(batch.geometry.getAttribute('instanceV2TextureDimensions'),
            'every exact frame part carries its physical world dimensions');
          if (batch.userData.v2FrameMaterialProfileId === 'legacy-rail') {
            assert.match(batch.material.name, /legacy-rail/,
              'rail-run and rail-post parts retain the V1 factoryRail material');
            assert.equal(batch.userData.v2PartRoles.every((role) => role.startsWith('rail-')), true);
          } else {
            assert.match(batch.material.name, /legacy-support/,
              'posts and underbeams retain the V1 supportMetal material');
            assert.equal(batch.userData.v2PartRoles.every((role) => !role.startsWith('rail-')), true);
          }
        }
      }
    }

    const nativeLocalSurfaceIds = new Set(contracts.assemblySurfaces.map(({ localId }) => localId).filter(Boolean));
    const descriptorFixtureIds = new Set(descriptor.fixtures.map(({ id }) => id));
    const surfaceBatches = [];
    const fixtureBatches = [];
    assembly.group.traverse((object) => {
      if (!object.isInstancedMesh || !object.userData.v2LegacyFixedRoomPresentation) return;
      const localIds = object.userData.v2ContractIds ?? [];
      if (localIds.some((id) => nativeLocalSurfaceIds.has(id))) surfaceBatches.push(object);
      if (localIds.some((id) => descriptorFixtureIds.has(id))) fixtureBatches.push(object);
    });
    assert.ok(surfaceBatches.length >= 2, 'native floor, deck, and ramp surfaces are instanced in V1 batches');
    assert.equal(surfaceBatches.every((batch) => (
      batch.geometry.getAttribute('instanceV2TextureDimensions')
      && batch.material.map
      && batch.material.userData.v2WorldScaleTiling === true
      && batch.material.map.userData.v2WorldScaleTiling === true
    )), true, 'all native machine walkable surfaces use world-scale tiled V1 materials');
    assert.ok(fixtureBatches.length > 0, 'the V1 presses, robot arms, prime mover, and girder are rendered');
    const texturedFixtureBatches = fixtureBatches.filter(({ material }) => material.map);
    assert.ok(texturedFixtureBatches.length > 0);
    assert.equal(texturedFixtureBatches.every(({ material }) => (
      material.userData.v2WorldScaleTiling === true
      && material.map.userData.v2WorldScaleTiling === true
    )), true, 'textured V1 machine fixture materials retain world-scale tiling');

    const descriptorRampIds = new Set(descriptor.floorTopology.walkableSurfaces
      .filter(({ shape }) => shape === 'ramp-tile')
      .map(({ id }) => id));
    assert.equal(descriptorRampIds.size, 11, 'the authored west-catwalk ramp has all eleven V1 tiles');
    const rampBatches = surfaceBatches.filter((batch) => (
      batch.userData.v2ContractIds?.some((id) => descriptorRampIds.has(id))
    ));
    assert.ok(rampBatches.length >= 1);
    assert.equal(rampBatches.every((batch) => (
      batch.geometry.getAttribute('instanceV2TextureDimensions')
      && batch.material.map
      && batch.material.userData.v2WorldScaleTiling === true
    )), true, 'the genuine V1 ramp tiles use geometry-backed world-tiled materials');
    for (const surface of contracts.assemblySurfaces.filter(({ localId }) => descriptorRampIds.has(localId))) {
      const collider = assembly.structuralRegistry.getCollider(surface.id);
      assert.ok(collider);
      assertBoundsEqual(collider.bounds, surface.bounds, `${surface.id} exact ramp collision`);
    }

    const rampSupport = nativeSupports.find(({ type }) => type === 'native-v1-ramp-support');
    const rampSupportVisual = assembly.structuralRegistry.getVisual(rampSupport.id);
    const foundationBatches = [];
    const stringerBatches = [];
    rampSupportVisual.traverse((object) => {
      if (object.userData.v2InstancedNativeRampFoundations) foundationBatches.push(object);
      if (object.userData.v2InstancedNativeRampStringers) stringerBatches.push(object);
    });
    assert.equal(foundationBatches.length, 1);
    assert.equal(stringerBatches.length, 1);
    assert.equal(foundationBatches[0].count, rampSupport.colliderBounds.length);
    assert.equal(stringerBatches[0].count, rampSupport.stringers.length);
    assert.deepEqual(foundationBatches[0].userData.v2ColliderIds, rampSupport.colliderIds);
    for (const batch of [foundationBatches[0], stringerBatches[0]]) {
      assert.ok(batch.geometry.getAttribute('instanceV2TextureDimensions'));
      assert.equal(batch.material.userData.v2LegacyRuinMaterial, true);
    }
    assert.equal(foundationBatches[0].material.userData.v2WorldScaleTiling, true);
    for (const [index, expectedBounds] of rampSupport.colliderBounds.entries()) {
      const worldBox = instanceBounds(foundationBatches[0], index);
      assertBoundsEqual({
        min: { x: worldBox.min.x, y: worldBox.min.y, z: worldBox.min.z },
        max: { x: worldBox.max.x, y: worldBox.max.y, z: worldBox.max.z },
      }, expectedBounds, `${rampSupport.id} foundation instance ${index}`);
    }
  } finally {
    assembly.dispose();
  }
}

const descriptor = getLegacyFixedRoomModuleV2(DESCRIPTOR_ID);
assert.ok(descriptor, `fixture requires ${DESCRIPTOR_ID}`);

for (const undercroftType of ['magma', 'electrical']) {
  test(`actual ${undercroftType} seed integrates native V1 Machine Factory Assembly without generic fallback`, () => {
    const seed = `native-assembly-machine-factory-${undercroftType}-actual-seed`;
    const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({ seed, undercroftType }), {
      throwOnError: false,
    });
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    const plan = validation.plan;
    const placement = plan.modulePlacements.find(({ id }) => id === PLACEMENT_ID);
    assert.equal(placement?.descriptorId, DESCRIPTOR_ID,
      'generic Assembly remains forbidden: placement.assembly must be the authored V1 Machine Factory');
    assert.equal(placement.presentationProfileId, NATIVE_PROFILE);
    assert.equal(placement.nativeIntegrationStatus, 'playable-plan-owned');
    assert.equal(plan.nativeFixedRoomIntegration.activePlacementIds.includes(PLACEMENT_ID), true);
    assert.equal(plan.nativeFixedRoomIntegration.activeDescriptorIds.includes(DESCRIPTOR_ID), true);
    assert.equal(plan.nativeFixedRoomIntegration.incompleteDescriptorIds.includes(DESCRIPTOR_ID), false);
    assert.equal(plan.nativeFixedRoomIntegration.genericFallbackGeometry, false);

    const rebuilt = recompileAcceptedLegacyFixedRoomPlacementV2(placement);
    assert.strictEqual(rebuilt.module, descriptor,
      'the accepted lean placement recompiles from the immutable Machine Factory descriptor');
    assert.equal(rebuilt.expectedPlacement.structuralContractSignature, placement.structuralContractSignature);
    const compiledPlacement = rebuilt.expectedPlacement;
    assertSocketBindings(plan, placement, compiledPlacement, descriptor);
    const contracts = assertNativeRoomContent(plan, placement, descriptor);
    assertNativeAssemblyRuntime(plan, placement, descriptor, contracts);
  });
}
