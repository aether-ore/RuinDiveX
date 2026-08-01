import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { DungeonController } from '../src/DungeonController.js';

const gateHelperNames = [
  '_readDoorRequirementIds',
  '_isEncounterRequirementSatisfied',
  '_isShortcutStateActivated',
  '_isGenericProgressionStateActivated',
  '_getDoorRequirementStatus',
  '_openDoorIfRequirementsSatisfied',
  '_isMechanismActivated',
  '_isPressurePlateActivated',
];

function bindGateHelpers(context) {
  for (const name of gateHelperNames) context[name] = DungeonController.prototype[name];
  context.encounters ??= [];
  context.mechanisms ??= [];
  context.pressurePlates ??= [];
  context.connectorLifts ??= [];
  context.ladders ??= [];
  context.chests ??= [];
  context.progressionManager ??= {
    hasKeycard: () => false,
    getKeycardDisplayName: (id) => id,
  };
  return context;
}

test('controller reachability and discovery ignore graph-only connector records', () => {
  const physicalConnection = {
    id: 'physical-branch',
    fromRoomId: 'hubTown',
    toRoomId: 'rewardRoom',
  };
  const graphOnlyConnection = {
    id: 'graph-only-tail',
    fromRoomId: 'rewardRoom',
    toRoomId: 'connector-junction-proxy',
    isDungeonSupplement: true,
    isSupplementGraphConnection: true,
    connectorVariantConstraints: { graphOnly: true },
  };
  const context = {
    progression: { roomConnections: [physicalConnection, graphOnlyConnection] },
    _canTraverseProgressionConnection: () => true,
  };
  const reachable = DungeonController.prototype._getReachableRoomIds.call(context);
  assert.deepEqual([...reachable].sort(), ['hubTown', 'rewardRoom']);

  const discoveryContext = {
    progression: context.progression,
    visitedRoomIds: new Set(),
    discoveredRoomIds: new Set(),
    _getRoomAtPosition: () => ({ id: 'rewardRoom', environmentalStory: null }),
    game: { player: { root: { position: new THREE.Vector3() } } },
  };
  DungeonController.prototype._updateRoomDiscovery.call(discoveryContext);
  assert.equal(discoveryContext.discoveredRoomIds.has('hubTown'), true);
  assert.equal(discoveryContext.discoveredRoomIds.has('rewardRoom'), true);
  assert.equal(discoveryContext.discoveredRoomIds.has('connector-junction-proxy'), false);
});

test('room lookup cannot select a suppressed connector-junction proxy', () => {
  const position = new THREE.Vector3(0, 0, 0);
  const realRoom = { id: 'real-room', x: 0, z: 0, width: 3, depth: 3 };
  const proxy = {
    id: 'connector-junction-proxy',
    x: 0,
    z: 0,
    width: 7,
    depth: 5,
    suppressRoomGeometry: true,
    isRouteStationProxy: true,
    isConnectorJunctionProxy: true,
  };
  const room = DungeonController.prototype._getRoomAtPosition.call({
    dungeon: { rooms: [proxy, realRoom] },
    worldToTile: () => ({ x: 0, z: 0 }),
  }, position);
  assert.equal(room, realRoom);
});

test('calm-room discovery logs are collectible terminals, not generic treasure drops', () => {
  const toasts = [];
  let chestRollCount = 0;
  const chest = {
    id: 'supplement:discovery-log',
    isDungeonSupplementDiscovery: true,
    discoveryLabel: 'Shift Route Log',
    position: new THREE.Vector3(),
    object: new THREE.Group(),
    opened: false,
    rewardClaimed: false,
  };
  const context = {
    _getChestBlockingRequirement: () => null,
    game: {
      addParticleBurst() {},
      ui: { showToast: (message) => toasts.push(message) },
      refractors: { rollChestDrop: () => { chestRollCount += 1; } },
    },
  };

  DungeonController.prototype._activateChest.call(context, chest);

  assert.equal(chest.opened, true);
  assert.equal(chest.rewardClaimed, true);
  assert.equal(chest.object.userData.opened, true);
  assert.equal(chestRollCount, 0);
  assert.deepEqual(toasts, ['Recovered log: Shift Route Log']);
});

test('shortcut activation is scoped and does not disable unrelated dungeon hazards', () => {
  const unlocks = [];
  const openedDoors = [];
  const ladder = { id: 'supplement:ladder', disabled: true, deployed: false };
  const traps = [{ id: 'authored:trap', active: true }];
  const conveyors = [{ id: 'authored:conveyor', active: true }];
  const mechanism = {
    id: 'supplement:shortcut:control',
    label: 'Shortcut control',
    position: new THREE.Vector3(),
    shortcutAction: 'deploy-ladder',
    targetLadderIds: [ladder.id],
    targetLiftIds: ['supplement:lift'],
    targetDoorIds: ['supplement:door'],
  };
  const door = { id: 'supplement:door', closed: true };
  const context = bindGateHelpers({
    traps,
    conveyors,
    ladders: [ladder],
    doors: [door],
    mechanisms: [mechanism],
    _getMechanismBlockingEncounter: () => null,
    _openDoor: (candidate) => {
      candidate.closed = false;
      openedDoors.push(candidate.id);
    },
    game: {
      connectorLiftRuntime: {
        unlockLift: (id) => unlocks.push(id),
      },
      addParticleBurst() {},
      ui: { showToast() {} },
    },
  });

  DungeonController.prototype._activateMechanism.call(context, mechanism);

  assert.equal(mechanism.activated, true);
  assert.equal(ladder.disabled, false);
  assert.equal(ladder.deployed, true);
  assert.deepEqual(unlocks, ['supplement:lift']);
  assert.deepEqual(openedDoors, ['supplement:door']);
  assert.equal(traps[0].active, true);
  assert.equal(conveyors[0].active, true);
});

test('local supplement controls affect only their owning module within a shared network', () => {
  const operationId = 'supplement:coverage-network';
  const controlledProfileId = 'supplement-route-network-floor-trap';
  const owningTrap = {
    id: 'supplement:hazard-control:trap',
    roomId: 'supplement:hazard-control',
    operationId,
    hazardProfileId: controlledProfileId,
    active: true,
  };
  const siblingTrap = {
    id: 'supplement:sibling-challenge:trap',
    roomId: 'supplement:sibling-challenge',
    operationId,
    hazardProfileId: controlledProfileId,
    active: true,
  };
  const otherProfileInRoom = {
    id: 'supplement:hazard-control:uncontrolled-trap',
    roomId: owningTrap.roomId,
    operationId,
    hazardProfileId: 'supplement-uncontrolled-profile',
    active: true,
  };
  const mechanism = {
    id: 'supplement:hazard-control:terminal',
    type: 'dungeonSupplementLocalControl',
    scopedAction: 'controlLocalHazards',
    roomId: owningTrap.roomId,
    targetRoomId: owningTrap.roomId,
    targetOperationId: operationId,
    controlledHazardProfileIds: [controlledProfileId],
    position: new THREE.Vector3(),
    activated: false,
  };
  const context = {
    traps: [owningTrap, siblingTrap, otherProfileInRoom],
    conveyors: [{ id: 'authored:conveyor', active: true }],
    doors: [],
    ladders: [],
    connectorLifts: [],
    _getMechanismBlockingEncounter: () => null,
    game: {
      addParticleBurst() {},
      ui: { showToast() {} },
    },
  };

  DungeonController.prototype._activateMechanism.call(context, mechanism);

  assert.equal(mechanism.activated, true);
  assert.equal(owningTrap.active, false);
  assert.equal(siblingTrap.active, true);
  assert.equal(otherProfileInRoom.active, true);
  assert.equal(context.conveyors[0].active, true);
});

test('supplement action records cannot fall through to the authored global hazard override', () => {
  const scopedTrap = {
    id: 'supplement:action-scoped-trap',
    roomId: 'supplement:action-room',
    hazardProfileId: 'supplement-route-network-floor-trap',
    active: true,
  };
  const unrelatedTrap = { id: 'authored:unrelated-trap', active: true };
  const conveyor = { id: 'authored:unrelated-conveyor', active: true };
  const context = {
    traps: [scopedTrap, unrelatedTrap],
    conveyors: [conveyor],
    doors: [],
    ladders: [],
    connectorLifts: [],
    _getMechanismBlockingEncounter: () => null,
    game: {
      addParticleBurst() {},
      ui: { showToast() {} },
    },
  };
  const actionOnlyLocalControl = {
    id: 'supplement:action-only-control',
    isDungeonSupplement: true,
    action: { type: 'controlDungeonSupplementLocalHazards' },
    targetRoomId: scopedTrap.roomId,
    controlledHazardProfileIds: [scopedTrap.hazardProfileId],
    position: new THREE.Vector3(),
    activated: false,
  };

  DungeonController.prototype._activateMechanism.call(context, actionOnlyLocalControl);

  assert.equal(actionOnlyLocalControl.activated, true);
  assert.equal(scopedTrap.active, false);
  assert.equal(unrelatedTrap.active, true);
  assert.equal(conveyor.active, true);

  const malformedSupplementControl = {
    id: 'supplement:malformed-control',
    isDungeonSupplement: true,
    position: new THREE.Vector3(),
    activated: false,
  };
  DungeonController.prototype._activateMechanism.call(context, malformedSupplementControl);

  assert.equal(malformedSupplementControl.activated, false);
  assert.equal(unrelatedTrap.active, true);
  assert.equal(conveyor.active, true);
});

test('generic supplement shortcuts unlock explicit or connection-owned traversal only', () => {
  const connectionId = 'supplement:network:shortcut-connection';
  const stateId = 'supplement:network:state:shortcut';
  const ladders = [
    { id: 'matching-ladder', connectionId, disabled: true, deployed: false },
    { id: 'explicit-ladder', connectionId: 'other-connection', disabled: true, deployed: false },
    { id: 'unrelated-ladder', connectionId: 'unrelated', disabled: true, deployed: false },
  ];
  const connectorLifts = [
    { id: 'matching-lift', connectionId, shortcutUnlocked: false },
    { id: 'explicit-lift', connectionId: 'other-connection', shortcutUnlocked: false },
    { id: 'unrelated-lift', connectionId: 'unrelated', shortcutUnlocked: false },
  ];
  const unlockedLiftIds = [];
  const mechanism = {
    id: 'supplementShortcutMechanism__network__connection',
    stateId,
    shortcutStateId: stateId,
    runtimeStateIds: [stateId],
    type: 'dungeonSupplementShortcut',
    connectionId,
    targetLadderIds: ['explicit-ladder'],
    targetLiftIds: ['explicit-lift'],
    action: {
      type: 'activateDungeonSupplementShortcut',
      scope: 'connection',
      connectionId,
      stateId,
    },
    label: 'Enable shortcut',
    position: new THREE.Vector3(),
  };
  const traps = [{ id: 'authored:trap', active: true }];
  const conveyors = [{ id: 'authored:conveyor', active: true }];
  const context = bindGateHelpers({
    traps,
    conveyors,
    ladders,
    connectorLifts,
    doors: [],
    mechanisms: [mechanism],
    _getMechanismBlockingEncounter: () => null,
    game: {
      connectorLiftRuntime: {
        unlockLift: (id) => unlockedLiftIds.push(id),
        getDiagnostics: () => ({ lifts: [] }),
      },
      addParticleBurst() {},
      ui: { showToast() {} },
    },
  });

  DungeonController.prototype._activateMechanism.call(context, mechanism);

  assert.equal(mechanism.activated, true);
  assert.deepEqual(
    ladders.map(({ disabled, deployed }) => ({ disabled, deployed })),
    [
      { disabled: false, deployed: true },
      { disabled: false, deployed: true },
      { disabled: true, deployed: false },
    ],
  );
  assert.deepEqual(
    connectorLifts.map(({ shortcutUnlocked }) => shortcutUnlocked),
    [true, true, false],
  );
  assert.deepEqual(unlockedLiftIds.sort(), ['explicit-lift', 'matching-lift']);
  assert.equal(context._isShortcutStateActivated(stateId), true);
  assert.equal(traps[0].active, true);
  assert.equal(conveyors[0].active, true);
});

test('shortcut activation cannot bypass remaining credentials, encounter, or pressure requirements', () => {
  const openedDoors = [];
  const ownedCredentials = new Set(['Keycard_Alpha']);
  const encounter = { id: 'supplement:encounter', cleared: false };
  const pressurePlate = { id: 'supplement:plate', activated: false };
  const reward = {
    id: 'supplement:reward',
    stateId: 'supplement:reward:claimed',
    opened: false,
    rewardClaimed: false,
  };
  const mechanism = {
    id: 'supplement:shortcut:control',
    shortcutStateId: 'supplement:shortcut:enabled',
    label: 'Shortcut control',
    position: new THREE.Vector3(),
    shortcutAction: 'unlock-route',
    targetDoorIds: ['supplement:conjunctive-gate'],
  };
  const door = {
    id: 'supplement:conjunctive-gate',
    label: 'Conjunctive gate',
    closed: true,
    locked: true,
    isDungeonSupplement: true,
    requiredCredentialIds: ['Keycard_Alpha', 'Keycard_Beta'],
    requiredEncounterStateIds: [encounter.id],
    requiredMechanismStateIds: [mechanism.id],
    requiredShortcutStateIds: [mechanism.shortcutStateId],
    requiredStateIds: [reward.stateId],
    requiredPressurePlateIds: [pressurePlate.id],
  };
  const context = bindGateHelpers({
    traps: [{ id: 'authored:trap', active: true }],
    conveyors: [{ id: 'authored:conveyor', active: true }],
    ladders: [],
    connectorLifts: [],
    doors: [door],
    encounters: [encounter],
    mechanisms: [mechanism],
    pressurePlates: [pressurePlate],
    chests: [reward],
    progressionManager: {
      hasKeycard: (id) => ownedCredentials.has(id),
      getKeycardDisplayName: (id) => id,
    },
    _getMechanismBlockingEncounter: () => null,
    _openDoor: (candidate) => {
      candidate.closed = false;
      openedDoors.push(candidate.id);
    },
    game: {
      connectorLiftRuntime: {
        unlockLift() {},
        getDiagnostics: () => ({ lifts: [] }),
      },
      addParticleBurst() {},
      ui: { showToast() {} },
    },
  });

  DungeonController.prototype._activateMechanism.call(context, mechanism);
  assert.equal(door.closed, true);
  assert.deepEqual(openedDoors, []);

  ownedCredentials.add('Keycard_Beta');
  encounter.cleared = true;
  pressurePlate.activated = true;
  reward.opened = true;
  DungeonController.prototype._activateMechanism.call(context, mechanism);
  assert.equal(door.closed, false);
  assert.deepEqual(openedDoors, [door.id]);
});

test('automatic encounter completion leaves a conjunctive gate closed until its credential is owned', () => {
  const ownedCredentials = new Set();
  const encounter = {
    id: 'supplement:guard',
    label: 'Supplement guard',
    spawned: true,
    cleared: false,
    enemyIds: [],
    zone: { position: new THREE.Vector3() },
  };
  const door = {
    id: 'supplement:guarded-key-gate',
    label: 'Guarded key gate',
    closed: true,
    locked: true,
    isDungeonSupplement: true,
    requiredEncounterStateIds: [encounter.id],
    requiredCredentialIds: ['Keycard_Alpha'],
  };
  const openedDoors = [];
  const context = bindGateHelpers({
    doors: [door],
    encounters: [encounter],
    mechanisms: [],
    pressurePlates: [],
    ladders: [],
    connectorLifts: [],
    keycards: [],
    progressionManager: {
      hasKeycard: (id) => ownedCredentials.has(id),
      getKeycardDisplayName: (id) => id,
    },
    _openDoor: (candidate) => {
      candidate.closed = false;
      openedDoors.push(candidate.id);
    },
    game: {
      enemies: [],
      ui: { showToast() {} },
      connectorLiftRuntime: { getDiagnostics: () => ({ lifts: [] }) },
    },
  });

  DungeonController.prototype._updateEncounters.call(context);
  assert.equal(encounter.cleared, true);
  assert.equal(door.closed, true);
  assert.deepEqual(openedDoors, []);

  ownedCredentials.add('Keycard_Alpha');
  assert.equal(context._openDoorIfRequirementsSatisfied(door, 'All requirements met'), true);
  assert.equal(door.closed, false);
  assert.deepEqual(openedDoors, [door.id]);
});

test('legacy single-key doors retain their interaction behavior', () => {
  const ownedCredentials = new Set();
  const door = {
    id: 'Door_Alpha',
    label: 'Security Door Alpha',
    closed: true,
    locked: true,
    requiresKeycard: true,
    requiredKeycardId: 'Keycard_Alpha',
  };
  const openedDoors = [];
  const context = bindGateHelpers({
    doors: [door],
    encounters: [],
    mechanisms: [],
    pressurePlates: [],
    ladders: [],
    connectorLifts: [],
    keySeeker: null,
    progressionManager: {
      hasKeycard: (id) => ownedCredentials.has(id),
      getKeycardDisplayName: () => 'Keycard Alpha',
    },
    _pulseDoor() {},
    _openDoor: (candidate) => {
      candidate.closed = false;
      openedDoors.push(candidate.id);
    },
    game: {
      ui: { showToast() {} },
      connectorLiftRuntime: { getDiagnostics: () => ({ lifts: [] }) },
    },
  });

  DungeonController.prototype._activateDoor.call(context, door);
  assert.equal(door.closed, true);
  ownedCredentials.add('Keycard_Alpha');
  DungeonController.prototype._activateDoor.call(context, door);
  assert.equal(door.closed, false);
  assert.deepEqual(openedDoors, [door.id]);
});

test('doorless supplemental connections enforce generic and pressure state requirements', () => {
  const reward = {
    id: 'supplement:reward',
    rewardStateId: 'supplement:reward:claimed',
    opened: false,
  };
  const plate = {
    id: 'supplement:plate',
    pressureStateId: 'supplement:plate:powered',
    activated: false,
  };
  const connection = {
    id: 'supplement:stateful-doorless-arm',
    isDungeonSupplement: true,
    requiredStateIds: [reward.rewardStateId],
    requiredPressurePlateIds: [plate.pressureStateId],
  };
  const context = bindGateHelpers({
    doors: [],
    encounters: [],
    mechanisms: [],
    pressurePlates: [plate],
    chests: [reward],
  });
  context._canTraverseProgressionConnection =
    DungeonController.prototype._canTraverseProgressionConnection;

  assert.equal(
    context._canTraverseProgressionConnection(connection, new Set(), new Set()),
    false,
  );
  reward.opened = true;
  assert.equal(
    context._canTraverseProgressionConnection(connection, new Set(), new Set()),
    false,
  );
  plate.activated = true;
  assert.equal(
    context._canTraverseProgressionConnection(connection, new Set(), new Set()),
    true,
  );

  assert.equal(
    context._canTraverseProgressionConnection({
      id: 'supplement:malformed-pressure-arm',
      isDungeonSupplement: true,
      requiresPressurePlate: true,
    }, new Set(), new Set()),
    false,
  );
});
