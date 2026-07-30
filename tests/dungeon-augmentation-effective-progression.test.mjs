import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDungeonProgressionData,
  DungeonValidator,
} from '../src/DungeonProgression.js';
import {
  createDungeonSupplementProgressionConnection,
  createDungeonSupplementProgressionRequirements,
} from '../src/DungeonGenerator.js';

test('graph-only connector records and junction proxies never enter progression or minimap facades', () => {
  const physicalPlan = {
    id: 'hub-camp-physical',
    logicalConnectionId: 'hubTown_expeditionCamp',
    requiredForProgression: true,
    fromSocket: {
      id: 'hub:out',
      matchingSocketId: 'camp:in',
      roomId: 'hubTown',
      elevation: 0,
    },
    toSocket: {
      id: 'camp:in',
      matchingSocketId: 'hub:out',
      roomId: 'expeditionCamp',
      elevation: 0,
    },
  };
  const graphOnlyPlan = {
    ...physicalPlan,
    id: 'hub-camp-graph-only-tail',
    requiredForProgression: false,
    isDungeonSupplement: true,
    isSupplementGraphConnection: true,
    connectorVariantConstraints: { graphOnly: true },
  };
  const progression = createDungeonProgressionData({
    rooms: [
      { id: 'hubTown', x: 0, z: 0, width: 3, depth: 3 },
      { id: 'expeditionCamp', x: 4, z: 0, width: 3, depth: 3 },
      {
        id: 'supplement:route-station-proxy',
        x: 2,
        z: 0,
        width: 5,
        depth: 7,
        isRouteStationProxy: true,
        isConnectorJunctionProxy: true,
        suppressRoomGeometry: true,
      },
    ],
    landmarks: { keycards: [] },
    connectionPlans: [physicalPlan, graphOnlyPlan],
  });

  const connection = progression.roomConnections.find((candidate) => (
    candidate.id === 'hubTown_expeditionCamp'
  ));
  assert.deepEqual(connection.routes.map(({ id }) => id), ['hub-camp-physical']);
  assert.equal(progression.minimap.rooms.some(({ roomId }) => (
    roomId === 'supplement:route-station-proxy'
  )), false);
  assert.equal(progression.minimap.hallways.some(({ routes }) => (
    routes.some(({ id }) => id === graphOnlyPlan.id)
  )), false);
  assert.equal(createDungeonSupplementProgressionConnection(graphOnlyPlan), null);

  const junctionPlan = {
    id: 'supplement:physical-junction-arm',
    isDungeonSupplement: true,
    isRouteNetworkConnection: true,
    fromRoomId: 'supplement:route-station-proxy',
    toRoomId: 'supplement:challenge-room',
    progressionFromRoomId: 'expeditionCamp',
    fromSocket: {
      id: 'junction:branch',
      roomId: 'supplement:route-station-proxy',
      progressionRoomId: 'expeditionCamp',
      elevation: 0,
    },
    toSocket: {
      id: 'challenge:entry',
      roomId: 'supplement:challenge-room',
      elevation: 0,
    },
  };
  const junctionConnection = createDungeonSupplementProgressionConnection(junctionPlan);
  assert.deepEqual(
    [junctionConnection.fromRoomId, junctionConnection.toRoomId],
    ['expeditionCamp', 'supplement:challenge-room'],
  );
  assert.deepEqual(
    [
      junctionConnection.routes[0].fromSocket.roomId,
      junctionConnection.routes[0].toSocket.roomId,
    ],
    ['expeditionCamp', 'supplement:challenge-room'],
  );
  assert.equal(createDungeonSupplementProgressionConnection({
    ...junctionPlan,
    id: 'supplement:collapsed-self-arm',
    progressionFromRoomId: 'supplement:challenge-room',
    progressionToRoomId: 'supplement:challenge-room',
  }), null, 'A physical proxy arm collapsed onto one true room must not create a minimap/progression self-edge.');
});

test('unknown supplemental gates fail closed without changing legacy encounter-gate behavior', () => {
  const validator = new DungeonValidator({
    entranceRoomId: 'hubTown',
    bands: [{ bandId: 0, roomIds: ['hubTown', 'supplementRoom'] }],
    doors: [],
    keycards: [],
    roomConnections: [],
  });

  assert.equal(validator.canPassConnection({ doorId: 'unknownSupplementGate', isDungeonSupplement: true }, new Set(), new Set()), false);
  assert.equal(validator.canPassConnection({ doorId: 'enemyNestGate' }, new Set(), new Set()), true);
});

test('optional supplemental routes participate in the graph without claiming authored progression authority', () => {
  const progression = {
    entranceRoomId: 'hubTown',
    shrineRoomId: 'hubTown',
    bands: [{ bandId: 0, roomIds: ['hubTown', 'supplementRoom'] }],
    doors: [],
    keycards: [],
    roomConnections: [{
      id: 'supplement-loop-arm',
      fromRoomId: 'hubTown',
      toRoomId: 'supplementRoom',
      isDungeonSupplement: true,
      routes: [{
        id: 'supplement-loop-arm:route',
        requiredForProgression: false,
        elevationDelta: 0,
        fromSocket: { id: 'a', matchingSocketId: 'b', roomId: 'hubTown', elevation: 0 },
        toSocket: { id: 'b', matchingSocketId: 'a', roomId: 'supplementRoom', elevation: 0 },
      }],
    }],
    boss: { roomId: 'hubTown' },
    shrineKey: { keycardId: 'Shrine_Key' },
  };
  const result = new DungeonValidator(progression).validate();
  assert.equal(
    result.errors.some((error) => error.includes('has no required physical traversal route')),
    false,
  );
  assert.equal(result.solver.reachableRooms.includes('supplementRoom'), true);
});

test('supplemental cross-band edges remain closed until every declared credential is present', () => {
  const connection = {
    id: 'supplement:band-shortcut',
    fromRoomId: 'hubTown',
    toRoomId: 'deepSupplementRoom',
    doorId: 'supplement:alpha-gate',
    isDungeonSupplement: true,
  };
  const validator = new DungeonValidator({
    entranceRoomId: 'hubTown',
    bands: [
      { bandId: 0, roomIds: ['hubTown'] },
      { bandId: 1, roomIds: ['deepSupplementRoom'] },
    ],
    doors: [{
      doorId: 'supplement:alpha-gate',
      requiredCredentialIds: ['Keycard_Alpha', 'Keycard_Beta'],
    }],
    keycards: [],
    roomConnections: [connection],
  });

  assert.deepEqual([...validator.getReachableRooms(new Set())], ['hubTown']);
  assert.deepEqual(
    [...validator.getReachableRooms(new Set(['Keycard_Alpha']))],
    ['hubTown'],
  );
  assert.deepEqual(
    [...validator.getReachableRooms(new Set(['Keycard_Alpha', 'Keycard_Beta']))].sort(),
    ['deepSupplementRoom', 'hubTown'],
  );
});

test('supplemental encounter, mechanism, and shortcut requirements are conjunctive and fail closed', () => {
  const connection = {
    id: 'supplement:stateful-route',
    fromRoomId: 'hubTown',
    toRoomId: 'payoffRoom',
    doorId: 'supplement:stateful-gate',
    isDungeonSupplement: true,
    requiredMechanismStateIds: ['supplement:mechanism:online'],
    requiredShortcutStateIds: ['supplement:shortcut:deployed'],
  };
  const validator = new DungeonValidator({
    entranceRoomId: 'hubTown',
    bands: [{ bandId: 0, roomIds: ['hubTown', 'payoffRoom'] }],
    doors: [{
      doorId: 'supplement:stateful-gate',
      requiredEncounterStateIds: ['supplement:encounter:cleared'],
    }],
    keycards: [],
    roomConnections: [connection],
  });

  assert.deepEqual([...validator.getReachableRooms()], ['hubTown']);
  assert.deepEqual(
    [...validator.getReachableRooms(new Set(), new Set(), {
      completedEncounterIds: ['supplement:encounter:cleared'],
      activatedMechanismIds: ['supplement:mechanism:online'],
    })],
    ['hubTown'],
  );
  assert.deepEqual(
    [...validator.getReachableRooms(new Set(), new Set(), {
      completedEncounterIds: ['supplement:encounter:cleared'],
      activatedMechanismIds: ['supplement:mechanism:online'],
      unlockedShortcutIds: ['supplement:shortcut:deployed'],
    })].sort(),
    ['hubTown', 'payoffRoom'],
  );
});

test('effective supplemental contracts preserve generic and pressure requirements', () => {
  const requirements = createDungeonSupplementProgressionRequirements({
    id: 'supplement:normalized-stateful-route',
    augmentationOperationType: 'routeNetwork',
    requiredStateId: 'supplement:reward:claimed',
    gateRequirement: {
      requiredPressurePlateIds: ['supplement:plate:powered'],
    },
  });
  assert.deepEqual(requirements.requiredStateIds, ['supplement:reward:claimed']);
  assert.deepEqual(
    requirements.requiredPressurePlateIds,
    ['supplement:plate:powered'],
  );
  assert.equal(requirements.requiresState, true);
  assert.equal(requirements.requiresPressurePlate, true);
  assert.equal(requirements.requirementsMalformed, false);
  assert.deepEqual(
    createDungeonSupplementProgressionRequirements({
      requiredStateIds: 'not-an-array',
      requiredPressurePlateIds: [null],
    }),
    {
      requiredKeycardId: null,
      requiredCredentialIds: [],
      requiredEncounterStateIds: [],
      requiredMechanismStateIds: [],
      requiredShortcutStateIds: [],
      requiredStateIds: [],
      requiredPressurePlateIds: [],
      requiresEncounterState: false,
      requiresMechanismState: false,
      requiresShortcutState: false,
      requiresState: false,
      requiresPressurePlate: false,
      requirementsMalformed: true,
    },
  );

  const connection = {
    id: 'supplement:normalized-stateful-route',
    fromRoomId: 'hubTown',
    toRoomId: 'payoffRoom',
    isDungeonSupplement: true,
    ...requirements,
  };
  const validator = new DungeonValidator({
    entranceRoomId: 'hubTown',
    bands: [{ bandId: 0, roomIds: ['hubTown', 'payoffRoom'] }],
    doors: [],
    keycards: [],
    roomConnections: [connection],
  });

  assert.equal(validator.canPassConnection(connection, new Set(), new Set()), false);
  assert.equal(validator.canPassConnection(connection, new Set(), new Set(), {
    activeStateIds: ['supplement:reward:claimed'],
  }), false);
  assert.equal(validator.canPassConnection(connection, new Set(), new Set(), {
    activeStateIds: ['supplement:reward:claimed'],
    activatedPressurePlateIds: ['supplement:plate:powered'],
  }), true);
});

test('unknown and incomplete supplemental state gates fail closed and report malformed contracts', () => {
  const unknownStateConnection = {
    id: 'supplement:unknown-state',
    fromRoomId: 'hubTown',
    toRoomId: 'unknownStateRoom',
    isDungeonSupplement: true,
    requiredEncounterStateIds: ['supplement:encounter:not-completed'],
  };
  const malformedConnection = {
    id: 'supplement:malformed-state',
    fromRoomId: 'hubTown',
    toRoomId: 'malformedStateRoom',
    isDungeonSupplement: true,
    requiresShortcutState: true,
    routes: [],
  };
  const malformedPressureConnection = {
    id: 'supplement:malformed-pressure-state',
    fromRoomId: 'hubTown',
    toRoomId: 'malformedPressureRoom',
    isDungeonSupplement: true,
    requiresPressurePlate: true,
    routes: [],
  };
  const validator = new DungeonValidator({
    entranceRoomId: 'hubTown',
    shrineRoomId: 'hubTown',
    bands: [{
      bandId: 0,
      roomIds: [
        'hubTown',
        'unknownStateRoom',
        'malformedStateRoom',
        'malformedPressureRoom',
      ],
    }],
    doors: [],
    keycards: [],
    roomConnections: [
      unknownStateConnection,
      malformedConnection,
      malformedPressureConnection,
    ],
    boss: { roomId: 'hubTown' },
    shrineKey: { keycardId: 'Shrine_Key' },
  });

  assert.equal(validator.canPassConnection(unknownStateConnection, new Set(), new Set()), false);
  assert.equal(validator.canPassConnection(malformedConnection, new Set(), new Set()), false);
  assert.equal(
    validator.canPassConnection(malformedPressureConnection, new Set(), new Set()),
    false,
  );
  const validation = validator.validate();
  assert.ok(validation.errors.includes(
    'supplement:malformed-state has an incomplete supplemental gate requirement.',
  ));
  assert.ok(validation.errors.includes(
    'supplement:malformed-pressure-state has an incomplete supplemental gate requirement.',
  ));
});

test('supplemental minimap records preserve their assigned dynamic progression band', () => {
  const supplementalRoom = {
    id: 'supplement:band-two-room',
    type: 'supplement',
    x: 4,
    z: 7,
    width: 5,
    depth: 5,
    baseElevation: 0,
    isDungeonSupplement: true,
    augmentationProgressionBandId: 2,
  };
  const progression = createDungeonProgressionData({
    rooms: [supplementalRoom],
    doors: [],
    landmarks: { keycards: [] },
    chests: [],
    encounters: [],
    connectionPlans: [],
  });
  const minimapRoom = progression.minimap.rooms.find(({ roomId }) => (
    roomId === supplementalRoom.id
  ));

  assert.equal(supplementalRoom.progressionBand, 2);
  assert.equal(minimapRoom.progressionBand, 2);
  assert.equal(minimapRoom.isInitialUnlockedArea, false);
});
