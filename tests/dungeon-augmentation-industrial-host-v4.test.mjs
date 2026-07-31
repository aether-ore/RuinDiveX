import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIndustrialExtensionHost,
} from '../src/dungeon-augmentation/IndustrialExtensionHost.js';
import {
  validateDungeonRouteNetworkEndpointPlanningWitness,
  validateDungeonExtensionHost,
} from '../src/dungeon-augmentation/contracts.js';

const TILE_SIZE = 2.8;

function room(id, x, z, width = 15, depth = 13) {
  return { id, x, z, width, depth, baseElevation: 0 };
}

function horizontalPath(fromX, toX, z) {
  const direction = Math.sign(toX - fromX) || 1;
  return Array.from({ length: Math.abs(toX - fromX) + 1 }, (_, index) => ({
    x: fromX + index * direction,
    z,
  }));
}

function createHost({
  rooms,
  connectionPlans = [],
  basePlanHash = 'industrial-host-v4-focused-base',
}) {
  return createIndustrialExtensionHost({
    baseDraft: {
      basePlanHash,
      rooms,
      connectionPlans,
    },
    basePlanHash,
    rooms,
    connectionPlans,
    tileSize: TILE_SIZE,
  });
}

function grantsOfKind(host, kind) {
  return host.extensionRegions[0].routeNetworkGrants.filter((grant) => grant.kind === kind);
}

test('Industrial V4 publishes one deterministic same-band micro progression through exact unused walls', () => {
  const rooms = [
    room('alphaRoom', -60, 0),
    room('betaRoom', 60, 0),
    room('bossRoom', 0, 500, 23, 23),
    room('shrineRoom', 0, -500, 23, 23),
  ];
  const connectionPlans = [{
    id: 'alpha_beta_authored',
    logicalConnectionId: 'alpha_beta_authored',
    fromRoomId: 'alphaRoom',
    toRoomId: 'betaRoom',
    level: 0,
    elevation: 0,
    fromSocket: { x: -53, z: 0, elevation: 0, facingX: 1, facingZ: 0 },
    toSocket: { x: 53, z: 0, elevation: 0, facingX: -1, facingZ: 0 },
    fullPath: horizontalPath(-53, 53, 0),
  }];

  const firstHost = createHost({ rooms, connectionPlans });
  const repeatedHost = createHost({ rooms: structuredClone(rooms), connectionPlans: structuredClone(connectionPlans) });
  const [grant] = grantsOfKind(firstHost, 'same-band-micro-progression');
  const [repeatedGrant] = grantsOfKind(repeatedHost, 'same-band-micro-progression');

  assert.ok(grant);
  assert.deepEqual(grant, repeatedGrant);
  assert.equal(grant.required, false);
  assert.equal(grant.endpointSockets.length, 2);
  assert.equal(new Set(grant.endpointSockets.map(({ roomId }) => roomId)).size, 2);
  assert.equal(grant.endpointSockets.every(({ widthMeters }) => widthMeters === 8.4), true);
  assert.equal(grant.endpointSockets.every(({ routeNetworkSocketKind }) => (
    routeNetworkSocketKind === 'parent-room-wall'
  )), true);
  const roomById = new Map(rooms.map((entry) => [entry.id, entry]));
  assert.equal(grant.endpointSockets.every((socket) => {
    const owner = roomById.get(socket.roomId);
    const expectedX = Number(owner.x) * TILE_SIZE
      + Number(socket.facing.x) * Number(owner.width) * TILE_SIZE * 0.5;
    const expectedZ = Number(owner.z) * TILE_SIZE
      + Number(socket.facing.z) * Number(owner.depth) * TILE_SIZE * 0.5;
    return Math.abs(socket.position.x - expectedX) <= 1e-9
      && Math.abs(socket.position.z - expectedZ) <= 1e-9;
  }), true);
  assert.equal(grant.endpointSockets.every(({ roomId }) => (
    roomId !== 'bossRoom' && roomId !== 'shrineRoom'
  )), true);
  assert.equal(grant.endpointSockets.some(({ roomId, wallSide }) => (
    (roomId === 'alphaRoom' && wallSide === 'east')
      || (roomId === 'betaRoom' && wallSide === 'west')
  )), false);
  assert.equal(new Set(grant.endpointSockets.map(({ progressionBandId }) => progressionBandId)).size, 1);
  assert.equal(new Set(grant.endpointSockets.map(({ accessDomainId }) => accessDomainId)).size, 1);
  assert.deepEqual(grant.crossedBoundaryIds, []);
  assert.deepEqual(grant.requiredCredentialIds, []);
  assert.equal(grant.sourceGate, null);
  assert.equal(grant.minimumModules, 3);
  assert.equal(grant.maximumModules, 6);
  assert.equal('minimumTrueRoomCount' in grant, false);
  assert.deepEqual(grant.requiredSemanticRoomRoles, [
    'challenge', 'elevation-or-mechanism', 'reward',
  ]);
  assert.deepEqual(grant.localProgressionArc, [
    'enter', 'challenge', 'elevation-or-mechanism', 'reward', 'reconnect',
  ]);
  assert.ok(grant.planningRoomReservationRectangles.length <= grant.maximumModules);
  assert.ok(grant.planningRouteReservationRectangles.length >= 3);
});

test('Industrial V4 omits the optional micro grant when its reserved module route is blocked', () => {
  const rooms = [
    room('alphaRoom', -60, 0),
    room('betaRoom', 60, 0),
    // Boss and shrine are never endpoint candidates, but their authored
    // footprints remain protected obstacles for supplement planning.
    room('bossRoom', 0, 0, 240, 240),
    room('shrineRoom', 0, 400, 23, 23),
  ];
  const host = createHost({ rooms });

  assert.deepEqual(grantsOfKind(host, 'same-band-micro-progression'), []);
  assert.equal(host.extensionRegions[0].routeNetworkGrants.some((grant) => (
    grant.endpointSockets?.some(({ roomId }) => roomId === 'bossRoom' || roomId === 'shrineRoom')
  )), false);
});

test('Industrial V4 deterministically grants an exact gated shortcut across adjacent safe bands', () => {
  const rooms = [
    room('alienServerRoom', -60, 0),
    room('coolantRelayRoom', 60, 0),
    room('bossRoom', 0, 500, 23, 23),
    room('shrineRoom', 0, -500, 23, 23),
  ];
  const host = createHost({ rooms, basePlanHash: 'cross-band-odd' });
  const repeatedHost = createHost({
    rooms: structuredClone(rooms),
    basePlanHash: 'cross-band-odd',
  });
  const [grant] = grantsOfKind(host, 'cross-band-shortcut');

  assert.ok(grant);
  assert.deepEqual(grant, grantsOfKind(repeatedHost, 'cross-band-shortcut')[0]);
  assert.equal(grantsOfKind(host, 'same-band-micro-progression').length, 0);
  assert.equal(host.extensionRegions[0].routeNetworkGrants.filter(({ required }) => (
    required !== true
  )).length, 1);
  assert.equal(grant.required, false);
  assert.equal(grant.endpointSockets.length, 2);
  assert.deepEqual(
    grant.endpointSockets.map(({ progressionBandId }) => progressionBandId),
    [0, 1],
  );
  assert.equal(grant.endpointSockets.some(({ roomId }) => (
    roomId === 'bossRoom' || roomId === 'shrineRoom'
  )), false);
  const [shallowSocket] = grant.endpointSockets.filter(({ progressionBandId }) => (
    progressionBandId === 0
  ));
  assert.deepEqual(grant.shallowEndpointSocketIds, [shallowSocket.id]);
  assert.equal(grant.shallowProgressionBandId, 0);
  assert.equal(grant.deepProgressionBandId, 1);
  assert.deepEqual(grant.crossedBoundaryIds, ['Door_Alpha']);
  assert.deepEqual(grant.requiredCredentialIds, ['Keycard_Alpha']);
  assert.notEqual(grant.sourceGate.gateId, 'Door_Alpha');
  assert.equal(grant.sourceGate.supplementalIdentity, true);
  assert.equal(grant.sourceGate.gatePlacementSide, 'source');
  assert.equal(grant.sourceGate.sourceGateSocketId, shallowSocket.id);
  assert.deepEqual(grant.sourceGate.shallowEndpointSocketIds, [shallowSocket.id]);
  assert.deepEqual(grant.sourceGate.crossedBoundaryIds, ['Door_Alpha']);
  assert.deepEqual(grant.sourceGate.requiredCredentialIds, ['Keycard_Alpha']);
  assert.equal(grant.sourceGate.requiredKeycardId, 'Keycard_Alpha');
  assert.equal(grant.shortcutActivationSide, 'far-side');
  assert.deepEqual(grant.allowedElevationModes, ['shortcut-lift', 'drop-ladder']);
  assert.equal(validateDungeonExtensionHost(host).accepted, true);

  const bossMutation = structuredClone(host);
  grantsOfKind(bossMutation, 'cross-band-shortcut')[0].endpointSockets[0].roomId = 'bossRoom';
  assert.equal(validateDungeonExtensionHost(bossMutation).errors.some((error) => (
    error.endsWith('cross-band-shortcut-domain-invalid')
  )), true);

  const wrongCredential = structuredClone(host);
  const wrongCredentialGrant = grantsOfKind(wrongCredential, 'cross-band-shortcut')[0];
  wrongCredentialGrant.requiredCredentialIds = ['Keycard_Beta'];
  assert.equal(validateDungeonExtensionHost(wrongCredential).errors.some((error) => (
    error.endsWith('cross-band-shortcut-boundary-contract-invalid')
  )), true);

  const authoredGateIdentity = structuredClone(host);
  grantsOfKind(authoredGateIdentity, 'cross-band-shortcut')[0].sourceGate.gateId = 'Door_Alpha';
  assert.equal(validateDungeonExtensionHost(authoredGateIdentity).errors.some((error) => (
    error.endsWith('cross-band-shortcut-source-gate-invalid')
  )), true);
});

test('Industrial V4 host budgets direct-aperture pyramid and coverage routes by substantive modules', () => {
  const rooms = [
    room('enemyNest', -30, 0, 7, 7),
    room('keycardRoom', 0, 0, 23, 21),
    room('trapRoom', 0, 50, 7, 7),
  ];
  const connectionPlans = [{
    id: 'enemyNest_keycardRoom_ground',
    logicalConnectionId: 'enemyNest_keycardRoom',
    fromRoomId: 'enemyNest',
    toRoomId: 'keycardRoom',
    level: 0,
    elevation: 0,
    doorId: 'enemyNestGate',
    fullPath: horizontalPath(-27, -11, 0),
    fromSocket: { x: -27, z: 0, elevation: 0, facingX: 1, facingZ: 0 },
    toSocket: { x: -11, z: 0, elevation: 0, facingX: -1, facingZ: 0 },
  }, {
    id: 'keycardRoom_trapRoom_ground',
    logicalConnectionId: 'keycardRoom_trapRoom',
    fromRoomId: 'keycardRoom',
    toRoomId: 'trapRoom',
    level: 0,
    elevation: 0,
    doorId: 'Door_Alpha',
    fullPath: Array.from({ length: 38 }, (_, index) => ({ x: 0, z: index + 10 })),
    fromSocket: { x: 0, z: 10, elevation: 0, facingX: 0, facingZ: 1 },
    toSocket: { x: 0, z: 47, elevation: 0, facingX: 0, facingZ: -1 },
  }];
  const host = createHost({ rooms, connectionPlans });
  const [pyramid] = grantsOfKind(host, 'landmark-perimeter-loop');
  const coverage = grantsOfKind(host, 'objective-route-coverage');

  assert.ok(pyramid);
  assert.equal(pyramid.endpointSockets.length, 2);
  assert.equal(pyramid.minimumModules, 3);
  assert.equal(pyramid.maximumModules, 5);
  assert.equal('minimumTrueRoomCount' in pyramid, false);
  assert.ok(coverage.length >= 1);
  assert.equal(coverage.every((grant) => (
    grant.minimumModules === 3
      && grant.maximumModules === 6
      && !('minimumTrueRoomCount' in grant)
      && grant.endpointSockets.length >= 2
  )), true);

  assert.equal(validateDungeonExtensionHost(host).accepted, true);
  assert.equal(pyramid.endpointSockets.some(({ endpointModuleOverlapRequired }) => (
    endpointModuleOverlapRequired === true
  )), false);
  assert.equal('socketModuleOverlapGrants' in pyramid, false);
  for (const grant of coverage) {
    assert.equal(grant.endpointSockets.every(({ endpointModuleOverlapRequired }) => (
      endpointModuleOverlapRequired === true
    )), true);
    assert.equal(grant.socketModuleOverlapGrants.length, grant.endpointSockets.length * 2);
    for (const socket of grant.endpointSockets) {
      const socketOverlaps = grant.socketModuleOverlapGrants.filter((overlap) => (
        overlap.socketId === socket.id
      ));
      assert.deepEqual(
        socketOverlaps.map(({ moduleTemplateId, footprintTiles }) => ({
          moduleTemplateId,
          footprintTiles,
        })),
        [{
          moduleTemplateId: 'supplement-route-connector-through-t-v1',
          footprintTiles: { width: 5, depth: 7 },
        }, {
          moduleTemplateId: 'supplement-route-connector-through-t-branch-entry-v1',
          footprintTiles: { width: 7, depth: 5 },
        }],
      );
      const overlap = socketOverlaps[0];
      const horizontal = Math.abs(Number(socket.facing.x)) > 0;
      assert.deepEqual({
        ...overlap,
        center: undefined,
        size: undefined,
      }, {
        id: `${socket.id}:endpoint-module-overlap`,
        socketId: socket.id,
        center: undefined,
        size: undefined,
        purpose: 'route-network-endpoint-module-parent-merge',
        moduleKind: 'connector-module',
        moduleTemplateId: 'supplement-route-connector-through-t-v1',
        footprintTiles: { width: 5, depth: 7 },
        leadTiles: 1,
        parentOwnerId: socket.logicalEdgeId,
      });
      const expectedCenter = {
        x: socket.position.x + socket.facing.x * TILE_SIZE * 4.5,
        y: socket.position.y + TILE_SIZE * 1.5,
        z: socket.position.z + socket.facing.z * TILE_SIZE * 4.5,
      };
      const expectedSize = {
        x: horizontal ? TILE_SIZE * 7 : TILE_SIZE * 5,
        y: TILE_SIZE * 3,
        z: horizontal ? TILE_SIZE * 5 : TILE_SIZE * 7,
      };
      assert.equal(['x', 'y', 'z'].every((axis) => (
        Math.abs(overlap.center[axis] - expectedCenter[axis]) <= 1e-9
          && Math.abs(overlap.size[axis] - expectedSize[axis]) <= 1e-9
      )), true);
      const witness = validateDungeonRouteNetworkEndpointPlanningWitness(socket, {
        moduleOverlapGrant: overlap,
        maximumRouteLengthMeters: grant.coverage.maximumFeaturelessSpanMeters,
      });
      assert.equal(witness.present, true);
      assert.equal(witness.accepted, true, witness.errors.join(', '));
      assert.ok(witness.routeLengthMeters > 0 && witness.routeLengthMeters <= 33.6);
      assert.equal(
        Math.hypot(
          socket.planningModuleCenter.x - overlap.center.x,
          socket.planningModuleCenter.z - overlap.center.z,
        ) <= 1e-9,
        true,
      );
      assert.equal(socket.planningContinuationRoute.slice(1).every((point, index) => {
        const previous = socket.planningContinuationRoute[index];
        const deltaX = Math.abs(Number(point.x) - Number(previous.x));
        const deltaZ = Math.abs(Number(point.z) - Number(previous.z));
        return (deltaX > 1e-9) !== (deltaZ > 1e-9);
      }), true);
    }
  }

  const missing = structuredClone(host);
  delete grantsOfKind(missing, 'objective-route-coverage')[0].socketModuleOverlapGrants;
  assert.equal(validateDungeonExtensionHost(missing).accepted, false);
  assert.equal(validateDungeonExtensionHost(missing).errors.some((error) => (
    error.endsWith('missing-route-network-endpoint-module-overlap-grants')
  )), true);

  const wrongOwner = structuredClone(host);
  grantsOfKind(wrongOwner, 'objective-route-coverage')[0]
    .socketModuleOverlapGrants[0].parentOwnerId = 'another-authored-route';
  assert.equal(validateDungeonExtensionHost(wrongOwner).errors.some((error) => (
    error.endsWith('invalid-route-network-endpoint-module-overlap-grant')
  )), true);

  const unexpected = structuredClone(host);
  const unexpectedPyramid = grantsOfKind(unexpected, 'landmark-perimeter-loop')[0];
  unexpectedPyramid.socketModuleOverlapGrants = [{
    ...structuredClone(coverage[0].socketModuleOverlapGrants[0]),
    socketId: unexpectedPyramid.endpointSockets[0].id,
  }];
  assert.equal(validateDungeonExtensionHost(unexpected).errors.some((error) => (
    error.endsWith('unexpected-route-network-endpoint-module-overlap-grants')
  )), true);

  const witnessMutations = [{
    label: 'partial witness bundle',
    mutate: (socket) => { delete socket.planningContinuationCenter; },
    expected: 'route-network-endpoint-planning-witness-incomplete',
  }, {
    label: 'module center detached from exact overlap',
    mutate: (socket) => { socket.planningModuleCenter.x += TILE_SIZE; },
    expected: 'route-network-endpoint-planning-module-center-mismatch',
  }, {
    label: 'diagonal continuation leg',
    mutate: (socket) => { socket.planningContinuationRoute[1].x += TILE_SIZE; },
    expected: 'route-network-endpoint-planning-continuation-route-not-orthogonal',
  }, {
    label: 'continuation center detached from route aperture',
    mutate: (socket) => { socket.planningContinuationCenter.x += TILE_SIZE; },
    expected: 'route-network-endpoint-planning-continuation-route-endpoint-mismatch',
  }, {
    label: 'overlong continuation route',
    mutate: (socket) => {
      const route = socket.planningContinuationRoute;
      const start = route[0];
      const end = route.at(-1);
      const facing = socket.facing;
      const tangent = { x: -facing.z, z: facing.x };
      socket.planningContinuationRoute = [
        start,
        { x: start.x + facing.x * TILE_SIZE, z: start.z + facing.z * TILE_SIZE },
        {
          x: start.x + facing.x * TILE_SIZE + tangent.x * 50,
          z: start.z + facing.z * TILE_SIZE + tangent.z * 50,
        },
        {
          x: end.x - facing.x * TILE_SIZE + tangent.x * 50,
          z: end.z - facing.z * TILE_SIZE + tangent.z * 50,
        },
        { x: end.x - facing.x * TILE_SIZE, z: end.z - facing.z * TILE_SIZE },
        end,
      ];
    },
    expected: 'route-network-endpoint-planning-continuation-route-too-long',
  }];
  for (const { label, mutate, expected } of witnessMutations) {
    const corrupted = structuredClone(host);
    const corruptedSocket = grantsOfKind(corrupted, 'objective-route-coverage')[0]
      .endpointSockets[0];
    mutate(corruptedSocket);
    const result = validateDungeonExtensionHost(corrupted);
    assert.equal(result.accepted, false, label);
    assert.ok(result.errors.some((error) => error.endsWith(expected)), label);
  }
});
