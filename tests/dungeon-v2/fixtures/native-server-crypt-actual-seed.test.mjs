import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { getLegacyFixedRoomModuleV2 } from '../../../src/dungeon-v2/LegacyFixedRoomModuleCatalogV2.js';
import { recompileAcceptedLegacyFixedRoomPlacementV2 } from '../../../src/dungeon-v2/LegacyFixedRoomRuntimeAdapterV2.js';
import { transformPointQuarterTurns } from '../../../src/dungeon-v2/DungeonSpatialMathV2.js';
import { assertAcceptedDungeonFixture, assertContinuousPortalRoutes } from '../helpers/accepted-fixture.mjs';
import { buildIndependentPortalRouteProofs } from '../helpers/assembly-proofs.mjs';

const PLACEMENT_ID = 'placement.server';
const CELL_ID = 'cell.server.main';
const DESCRIPTOR_ID = 'v1-room.server-crypt';
const SOCKETS = Object.freeze({
  assembly: 'socket.v1-room.server-crypt.ground.south-east-bucket',
  freight: 'socket.v1-room.server-crypt.catwalk.north-center',
  cappedCeilingLadder: 'socket.v1-room.server-crypt.ladder.ceiling-east-catwalk',
});

function close(actual, expected, label, tolerance = 0.051) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`);
}

function assertBoundsEqual(actual, expected, label, tolerance = 1e-5) {
  for (const axis of ['x', 'y', 'z']) {
    close(actual.min[axis], expected.min[axis], `${label}.min.${axis}`, tolerance);
    close(actual.max[axis], expected.max[axis], `${label}.max.${axis}`, tolerance);
  }
}

function containsPoint(bounds, point, tolerance = 1e-6) {
  return ['x', 'y', 'z'].every((axis) => (
    point[axis] >= bounds.min[axis] - tolerance
    && point[axis] <= bounds.max[axis] + tolerance
  ));
}

function reachableSurfaceIds(plan, startSurfaceId) {
  const adjacency = new Map();
  const add = (from, to) => {
    if (!from || !to) return;
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

function assertNativePlanContracts(plan, descriptor, placement, compiledPlacement) {
  assert.deepEqual(placement.localOpenSocketIds, [SOCKETS.assembly, SOCKETS.freight].sort(),
    'only the two physically paired wall sockets are open');
  const socketByLocalId = new Map(compiledPlacement.portals.map((socket) => [socket.localId, socket]));
  assert.equal(socketByLocalId.get(SOCKETS.assembly)?.state, 'paired-open');
  assert.equal(socketByLocalId.get(SOCKETS.freight)?.state, 'paired-open');
  assert.equal(socketByLocalId.get(SOCKETS.cappedCeilingLadder)?.state, 'opaque-capped');

  const portalBindings = [
    { portalId: 'portal.assembly-server', endpointName: 'to', socketId: SOCKETS.assembly },
    { portalId: 'portal.server-freight', endpointName: 'from', socketId: SOCKETS.freight },
  ];
  for (const binding of portalBindings) {
    const portal = plan.portals.find(({ id }) => id === binding.portalId);
    const endpoint = portal?.[binding.endpointName];
    const socket = socketByLocalId.get(binding.socketId);
    assert.ok(portal && endpoint && socket, `${binding.portalId} resolves its native socket`);
    assert.equal(endpoint.nativeFixedRoomSocketId, socket.id);
    assert.equal(endpoint.boundaryId.startsWith(`${PLACEMENT_ID}:boundary.`), true);
    assert.equal(socket.approachSurfaceIds.includes(
      portal.physicalRoute.endpointSurfaceIds[binding.endpointName],
    ), true, `${binding.portalId} terminates on an exact descriptor approach tile`);
    close(endpoint.center.x, socket.anchor.x, `${binding.portalId}.x`);
    close(endpoint.center.z, socket.anchor.z, `${binding.portalId}.z`);
    close(endpoint.elevation, socket.anchor.y, `${binding.portalId}.y`);
    assert.equal(portal.physicalRoute.continuous, true);
    assert.equal(portal.physicalRoute.enclosed, true);
    assert.equal(portal.physicalRoute.supported, true);
  }

  const boundaries = plan.structuralBoundaries.filter(({ cellId }) => cellId === CELL_ID);
  const surfaces = plan.walkableSurfaces.filter(({ cellId }) => cellId === CELL_ID);
  assert.ok(boundaries.length > 500, 'the segmented V1 walls, ceiling, and foundation are plan-owned');
  assert.equal(boundaries.every(({ presentationOwnerId }) => presentationOwnerId === PLACEMENT_ID), true);
  assert.equal(boundaries.some(({ id }) => id.startsWith('boundary.server.')), false,
    'the generic Server shell has been removed');
  assert.equal(surfaces.length, descriptor.floorTopology.walkableSurfaces.length,
    'every exact V1 Server floor, ramp, landing, and catwalk tile survives composition');
  assert.equal(surfaces.every(({ presentationOwnerId }) => presentationOwnerId === PLACEMENT_ID), true);
  assert.equal(surfaces.some(({ id }) => id.startsWith('surface.server.')), false,
    'the generic Server traversal slabs have been removed');
  assert.deepEqual(
    new Set(surfaces.map(({ localId }) => localId)),
    new Set(descriptor.floorTopology.walkableSurfaces.map(({ id }) => id)),
  );

  const transform = placement.transform ?? placement;
  for (const socketId of [SOCKETS.assembly, SOCKETS.freight]) {
    const socket = descriptor.extensionSockets.find(({ id }) => id === socketId);
    const openingProbe = transformPointQuarterTurns({
      x: socket.anchor.x,
      y: socket.anchor.y + socket.opening.height * 0.5,
      z: socket.anchor.z,
    }, transform);
    assert.equal(boundaries.some(({ bounds }) => containsPoint(bounds, openingProbe)), false,
      `${socketId} is a real wall aperture rather than a declaration over solid collision`);
  }
  const cappedSocket = descriptor.extensionSockets.find(({ id }) => id === SOCKETS.cappedCeilingLadder);
  const capProbe = transformPointQuarterTurns(cappedSocket.anchor, transform);
  assert.equal(boundaries.some(({ side, bounds }) => side === 'ceiling' && containsPoint(bounds, capProbe)), true,
    'the unused ceiling ladder socket remains opaque, colliding, and invisible from below');

  const nativeFixtures = plan.structuralFixtures.filter(({ presentationOwnerId }) => (
    presentationOwnerId === PLACEMENT_ID
  ));
  const nativeFixtureIds = new Set(nativeFixtures.map(({ id }) => id));
  for (const fixture of descriptor.fixtures) {
    assert.equal(nativeFixtureIds.has(`${PLACEMENT_ID}:${fixture.id}`), true,
      `${fixture.id} is a real V1-authored visible/colliding fixture`);
  }
  assert.equal(plan.structuralFixtures.some(({ id }) => id.startsWith('fixture.server.authored-')), false,
    'no generic Server detail stand-in survives the native conversion');

  const alphaAnchor = plan.anchors.find(({ id }) => id === 'anchor.key.alpha');
  const alphaFixture = plan.structuralFixtures.find(({ id }) => (
    id === 'fixture.interaction.pickup.keycard-alpha'
  ));
  assert.equal(alphaAnchor?.nativeDescriptorAnchorId, 'anchor.key.alpha');
  assert.equal(alphaAnchor.nativeFixedRoomPlacementId, PLACEMENT_ID);
  assert.equal(alphaAnchor.surfaceId.startsWith(`${PLACEMENT_ID}:surface.`), true);
  const alphaSurface = surfaces.find(({ id }) => id === alphaAnchor.surfaceId);
  assert.ok(alphaSurface);
  close(alphaAnchor.position.y, alphaSurface.bounds.max.y, 'Alpha pedestal support height');
  assert.equal(alphaFixture?.cellId, CELL_ID);
  assert.equal(alphaFixture.nativeSupportSurfaceId, alphaSurface.id);
  assert.equal(plan.rewards.find(({ id }) => id === 'reward.keycard-alpha')?.anchorId, alphaAnchor.id);

  const rampSurfaces = surfaces.filter(({ traversalRoute }) => (
    traversalRoute?.routeId === 'ramp.server-crypt.outer-wall'
  ));
  const rampLink = plan.traversalLinks.find(({ id }) => id === 'traversal.server.landmark-stairs');
  assert.equal(rampSurfaces.length, 10, 'the complete V1 outer-wall ramp remains physical');
  assert.equal(rampLink?.mode, 'walkable-stairs');
  assert.equal(rampLink.nativeRampSurfaceIds.length, 10);
  assert.equal(rampLink.approachContract?.jumpAllowed, false);
  assert.equal(rampLink.approachContract?.ledgeClimbAllowed, false);
  assert.equal(rampSurfaces[0].stairs?.endpointSurfaceIds.end,
    `${PLACEMENT_ID}:surface.v1-room.server-crypt.-6.-5.1`,
  'the slope meets a full-width supported top landing without a ledge gap');

  const assemblyEndpoint = plan.portals.find(({ id }) => id === 'portal.assembly-server')
    .physicalRoute.endpointSurfaceIds.to;
  const freightEndpoint = plan.portals.find(({ id }) => id === 'portal.server-freight')
    .physicalRoute.endpointSurfaceIds.from;
  const reachable = reachableSurfaceIds(plan, assemblyEndpoint);
  assert.equal(reachable.has(alphaSurface.id), true,
    'the remote physical Alpha pedestal is reachable from the Assembly entrance');
  assert.equal(reachable.has(freightEndpoint), true,
    'the physical upper freight route is reachable through the authored V1 ramp/catwalk graph');

  return { boundaries, surfaces, nativeFixtures };
}

function assertNativeRuntime(plan, contracts, descriptor) {
  const assembly = assembleDungeonPlanV2(plan);
  try {
    assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.active, true);
    assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.genericFallbackGeometry, false);
    assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.placementCount, 11,
      'the accepted actual seed must assemble every native V1 room, not only the Server slice');
    assertContinuousPortalRoutes(plan, assembly, buildIndependentPortalRouteProofs(plan, assembly));

    const mappings = assembly.legacyFixedRoomVisualMappings.filter(({ placementId }) => (
      placementId === PLACEMENT_ID
    ));
    assert.ok(mappings.length > 800,
      'the Server shell, tiled surfaces, portal frames, and fixtures render through native batches');
    const mappedPlanIds = new Set(mappings.map(({ planId }) => planId));
    for (const contract of [...contracts.boundaries, ...contracts.surfaces]) {
      assert.equal(mappedPlanIds.has(contract.id), true, `${contract.id} has a native visual mapping`);
      const collider = assembly.structuralRegistry.getCollider(contract.id);
      assert.ok(collider, `${contract.id} has authoritative collision`);
      assertBoundsEqual(collider.bounds, contract.bounds, `${contract.id} collider parity`);
    }
    for (const fixture of contracts.nativeFixtures) {
      assert.equal(mappedPlanIds.has(fixture.id), true, `${fixture.id} renders through its V1 recipe`);
      for (const [index, colliderId] of fixture.colliderIds.entries()) {
        const collider = assembly.structuralRegistry.getColliderById(colliderId);
        assert.ok(collider, `${colliderId} is registered`);
        assertBoundsEqual(collider.bounds, fixture.colliderBounds[index], `${colliderId} parity`);
      }
    }

    const descriptorSurfaceIds = new Set(descriptor.floorTopology.walkableSurfaces.map(({ id }) => id));
    const mappedBatchNames = new Set(mappings
      .filter(({ localContractId }) => descriptorSurfaceIds.has(localContractId))
      .map(({ batchName }) => batchName));
    const structuralBatches = [];
    assembly.group.traverse((object) => {
      if (object.isInstancedMesh && mappedBatchNames.has(object.name)) structuralBatches.push(object);
    });
    assert.ok(structuralBatches.length > 0);
    assert.equal(structuralBatches.every((batch) => (
      batch.receiveShadow === true
      && batch.castShadow === false
      && batch.geometry.getAttribute('instanceV2TextureDimensions')
      && batch.material.map
      && batch.material.userData.v2WorldScaleTiling === true
      && batch.material.map.userData.v2WorldScaleTiling === true
    )), true, 'native Server structural batches remain receiver-only and world-scale tiled');
  } finally {
    assembly.dispose();
  }
}

const descriptor = getLegacyFixedRoomModuleV2(DESCRIPTOR_ID);
assert.ok(descriptor);

for (const undercroftType of ['magma', 'electrical']) {
  test(`actual ${undercroftType} seed integrates native V1 Server Crypt with exact enclosure and collision`, () => {
    const seed = `native-server-crypt-${undercroftType}-actual-seed`;
    const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({ seed, undercroftType }), {
      throwOnError: false,
    });
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    const plan = validation.plan;
    assertAcceptedDungeonFixture(plan);

    const placement = plan.modulePlacements.find(({ id }) => id === PLACEMENT_ID);
    assert.equal(placement?.descriptorId, DESCRIPTOR_ID,
      'placement.server must be the real V1 Server Crypt, never a generic room fallback');
    assert.equal(placement.presentationProfileId, 'legacy-fixed-room-native-v2');
    assert.equal(placement.nativeIntegrationStatus, 'playable-plan-owned');
    assert.equal(plan.nativeFixedRoomIntegration.activePlacementIds.includes(PLACEMENT_ID), true);
    assert.equal(plan.nativeFixedRoomIntegration.activeDescriptorIds.includes(DESCRIPTOR_ID), true);
    assert.equal(plan.nativeFixedRoomIntegration.incompleteDescriptorIds.includes(DESCRIPTOR_ID), false);
    assert.equal(plan.nativeFixedRoomIntegration.genericFallbackGeometry, false);

    const rebuilt = recompileAcceptedLegacyFixedRoomPlacementV2(placement);
    assert.strictEqual(rebuilt.module, descriptor);
    assert.equal(rebuilt.expectedPlacement.structuralContractSignature,
      placement.structuralContractSignature);
    const contracts = assertNativePlanContracts(
      plan,
      descriptor,
      placement,
      rebuilt.expectedPlacement,
    );
    assertNativeRuntime(plan, contracts, descriptor);
  });
}
