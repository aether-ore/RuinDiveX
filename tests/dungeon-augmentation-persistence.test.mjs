import test from 'node:test';
import assert from 'node:assert/strict';

import {
  captureDungeonAugmentationMutableState,
  createLegacyDungeonBasePlanHash,
  restoreDungeonAugmentationMutableState,
  resolveCommittedDungeonGenerationSpec,
  resolveDungeonAugmentationGenerationRequest,
  resolveDungeonAugmentationProfileId,
} from '../src/Game.js';
import {
  createDungeonAugmentationSaveIdentity,
  validateCommittedDungeonAugmentationIdentity,
  withDungeonAugmentationMutableState,
} from '../src/dungeon-augmentation/identity.js';
import {
  DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA,
} from '../src/dungeon-augmentation/contracts.js';
import {
  computeEffectiveDungeonPlanHash,
} from '../src/dungeon-augmentation/validation.js';
import { DungeonController } from '../src/DungeonController.js';
import {
  INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID,
  INDUSTRIAL_SUPPLEMENT_PREVIEW_V3_PROFILE_ID,
  INDUSTRIAL_SUPPLEMENT_PREVIEW_V4_PROFILE_ID,
} from '../src/dungeon-augmentation/IndustrialExtensionHost.js';

test('base-plan identity preserves Industrial V1 while namespacing future parent families', () => {
  const input = {
    layoutSeed: 'layout:family-hash',
    difficulty: 3,
    bossProfileId: 'revolvingFusillade',
  };
  const industrial = createLegacyDungeonBasePlanHash({
    ...input,
    dungeonFamilyId: 'industrial-v1',
  });
  const magma = createLegacyDungeonBasePlanHash({
    ...input,
    dungeonFamilyId: 'magma-refinery-v2',
  });

  assert.equal(industrial, 'v1:layout:family-hash:depth:3:revolvingFusillade');
  assert.equal(
    magma,
    'v1:layout:family-hash:depth:3:revolvingFusillade:family:magma-refinery-v2',
  );
  assert.notEqual(magma, industrial);
});

test('direct committed generation uses the complete persisted parent specification', () => {
  const savedAugmentation = Object.freeze({
    schema: 'ruindivex-dungeon-augmentation-save-identity/v1',
    profileId: INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  });
  const spec = resolveCommittedDungeonGenerationSpec({
    status: 'active',
    bossProfileId: 'saved-boss',
    dungeonLayoutSeed: 'layout:saved-parent',
    depth: 7,
    dungeonFamilyId: 'saved-family-v3',
    dungeonAugmentation: savedAugmentation,
  }, {
    bossProfileId: 'url-boss',
    layoutSeed: 'layout:url',
    difficulty: 1,
    dungeonFamilyId: 'url-family',
    dungeonAugmentation: undefined,
  });

  assert.deepEqual(spec, {
    bossProfileId: 'saved-boss',
    layoutSeed: 'layout:saved-parent',
    difficulty: 7,
    dungeonFamilyId: 'saved-family-v3',
    dungeonAugmentation: savedAugmentation,
  });
});

test('direct committed legacy generation remains augmentation-off despite URL defaults', () => {
  const spec = resolveCommittedDungeonGenerationSpec({
    status: 'victory',
    bossProfileId: 'saved-boss',
    dungeonLayoutSeed: 'layout:saved-legacy',
    depth: 2,
    dungeonFamilyId: 'industrial-v1',
  }, {
    dungeonAugmentation: { profileId: INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID },
  });
  assert.equal(spec.dungeonAugmentation, null);
});

test('new runs may opt into preview while committed legacy runs remain augmentation-off', () => {
  const newRun = resolveDungeonAugmentationGenerationRequest(
    undefined,
    INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  );
  assert.equal(newRun.isCommittedRun, false);
  assert.equal(newRun.augmentationProfileId, INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID);
  assert.equal(newRun.committedAugmentationIdentity, null);

  const committedLegacyRun = resolveDungeonAugmentationGenerationRequest(
    null,
    INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  );
  assert.equal(committedLegacyRun.isCommittedRun, true);
  assert.equal(committedLegacyRun.augmentationProfileId, null);
  assert.equal(committedLegacyRun.committedAugmentationIdentity, null);
});

test('boolean URL opt-ins select V4 while explicit older profiles remain replayable', () => {
  for (const alias of ['1', 'true', 'on', '2', '3', '4', 'preview', 'expanded']) {
    assert.equal(
      resolveDungeonAugmentationProfileId(alias),
      INDUSTRIAL_SUPPLEMENT_PREVIEW_V4_PROFILE_ID,
      alias,
    );
  }
  assert.equal(
    resolveDungeonAugmentationProfileId(INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID),
    INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  );
  assert.equal(
    resolveDungeonAugmentationProfileId(INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID),
    INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID,
  );
  assert.equal(
    resolveDungeonAugmentationProfileId(INDUSTRIAL_SUPPLEMENT_PREVIEW_V3_PROFILE_ID),
    INDUSTRIAL_SUPPLEMENT_PREVIEW_V3_PROFILE_ID,
  );
  assert.equal(
    resolveDungeonAugmentationProfileId(INDUSTRIAL_SUPPLEMENT_PREVIEW_V4_PROFILE_ID),
    INDUSTRIAL_SUPPLEMENT_PREVIEW_V4_PROFILE_ID,
  );
  for (const disabled of [null, '', '0', 'off', 'disabled', 'none', 'unknown']) {
    assert.equal(resolveDungeonAugmentationProfileId(disabled), null, String(disabled));
  }
});

test('committed augmentation identity owns its profile instead of the current URL preview choice', () => {
  const committedIdentity = Object.freeze({
    schema: 'ruindivex-dungeon-augmentation-save-identity/v1',
    profileId: 'saved-profile-v1',
  });
  const request = resolveDungeonAugmentationGenerationRequest(
    committedIdentity,
    INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  );
  assert.equal(request.isCommittedRun, true);
  assert.equal(request.augmentationProfileId, 'saved-profile-v1');
  assert.equal(request.committedAugmentationIdentity, committedIdentity);
});

test('a committed v1 expedition remains v1 when new runs default to preview v2', () => {
  const committedIdentity = Object.freeze({
    schema: 'ruindivex-dungeon-augmentation-save-identity/v1',
    profileId: INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  });
  const request = resolveDungeonAugmentationGenerationRequest(
    committedIdentity,
    INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID,
  );
  assert.equal(request.isCommittedRun, true);
  assert.equal(request.augmentationProfileId, INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID);
  assert.equal(request.committedAugmentationIdentity, committedIdentity);
});

test('malformed committed augmentation remains present for compatibility rejection', () => {
  const invalidIdentityMarker = Object.freeze({
    schema: 'ruindivex-dungeon-augmentation-save-invalid/v1',
    resetOrAbandonRequired: true,
  });
  const request = resolveDungeonAugmentationGenerationRequest(
    invalidIdentityMarker,
    INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  );
  assert.equal(request.isCommittedRun, true);
  assert.equal(request.augmentationProfileId, null);
  assert.equal(request.committedAugmentationIdentity, invalidIdentityMarker);
});

test('V4 save identity collects stable state IDs from operations, nodes, segments, and connections', () => {
  const basePlanHash = 'base:v4-state-identity';
  const augmentationPlanHash = 'augmentation:v4-state-identity';
  const identity = createDungeonAugmentationSaveIdentity({
    schema: DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA,
    profileId: INDUSTRIAL_SUPPLEMENT_PREVIEW_V4_PROFILE_ID,
    augmentationSeed: 'layout:v4-state-identity',
    basePlanHash,
    augmentationPlanHash,
    effectivePlanHash: computeEffectiveDungeonPlanHash(basePlanHash, augmentationPlanHash),
    themeBindings: [{
      binding: {
        parentRegionId: 'industrial:main',
        themeRef: { id: 'industrial-v1', revision: '1', contentHash: 'industrial:test' },
      },
    }],
    operations: [{
      id: 'operation:coverage',
      stableRuntimeStateIds: {
        encounter: 'state:encounter',
        mechanism: 'state:mechanism',
        reward: 'state:reward',
      },
      segments: [{ shortcut: { stateId: 'state:nested-shortcut' } }],
    }],
    nodes: [{
      id: 'node:reward',
      stableRuntimeStateIds: { reward: 'state:node-reward' },
    }],
    segments: [{ shortcutStateId: 'state:segment-shortcut' }],
    connections: [{ traversal: { stateId: 'state:connection-shortcut' } }],
  });

  assert.deepEqual(identity.progressionStateIds, [
    'state:connection-shortcut',
    'state:encounter',
    'state:mechanism',
    'state:nested-shortcut',
    'state:node-reward',
    'state:reward',
    'state:segment-shortcut',
  ]);
});

test('augmentation mutable state captures and restores scoped V4 runtime records', () => {
  const basePlanHash = 'base:v4-runtime-state';
  const augmentationPlanHash = 'augmentation:v4-runtime-state';
  const stateIds = {
    encounter: 'operation:coverage:state:encounter',
    mechanism: 'operation:coverage:state:mechanism',
    reward: 'operation:coverage:state:reward',
    shortcut: 'operation:coverage:state:shortcut',
    pressurePlate: 'operation:coverage:state:pressure-plate',
  };
  const identity = createDungeonAugmentationSaveIdentity({
    profileId: INDUSTRIAL_SUPPLEMENT_PREVIEW_V4_PROFILE_ID,
    seed: 'layout:v4-runtime-state',
    basePlanHash,
    augmentationPlanHash,
    effectivePlanHash: computeEffectiveDungeonPlanHash(basePlanHash, augmentationPlanHash),
    themeRevisions: [],
    progressionStateIds: Object.values(stateIds),
  });
  const overlayPlan = {
    operations: [{ id: 'operation:coverage', stableRuntimeStateIds: stateIds }],
    segments: [{
      id: 'segment:shortcut',
      operationId: 'operation:coverage',
      shortcut: { stateId: stateIds.shortcut },
    }],
  };
  const dungeon = { augmentationIdentity: identity, augmentationOverlayPlan: overlayPlan };
  const controller = {
    encounters: [{ id: 'encounter:runtime', operationId: 'operation:coverage', cleared: true }],
    mechanisms: [{
      id: 'mechanism:runtime',
      operationId: 'operation:coverage',
      connectionId: 'segment:shortcut',
      type: 'dungeonSupplementShortcut',
      stateId: stateIds.shortcut,
      initialState: 'unavailable',
      activatedState: 'available',
      activated: true,
    }],
    chests: [{ id: 'reward:runtime', operationId: 'operation:coverage', opened: true }],
    ladders: [{
      id: 'ladder:runtime',
      connectionId: 'segment:shortcut',
      deployed: true,
      disabled: false,
      object: { visible: true },
    }],
    connectorLifts: [],
    pressurePlates: [{
      id: 'pressure:runtime',
      operationId: 'operation:coverage',
      activated: true,
    }],
    doors: [],
  };
  const connectorLiftRuntime = {
    lifts: [{
      id: 'lift:runtime',
      descriptor: { connectionId: 'segment:shortcut' },
      shortcutUnlocked: true,
    }],
    unlockLift() { return { ok: true }; },
  };
  const mutableState = captureDungeonAugmentationMutableState({
    dungeon,
    controller,
    connectorLiftRuntime,
  });
  assert.deepEqual(mutableState, {
    [stateIds.encounter]: true,
    [stateIds.mechanism]: true,
    [stateIds.reward]: true,
    [stateIds.shortcut]: 'available',
    [stateIds.pressurePlate]: true,
  });

  const committedIdentity = withDungeonAugmentationMutableState(identity, {
    ...mutableState,
    'foreign:state': true,
  });
  assert.equal(committedIdentity.mutableState['foreign:state'], undefined);
  assert.equal(
    validateCommittedDungeonAugmentationIdentity(identity, committedIdentity).compatible,
    true,
  );

  const restoredDungeon = {
    augmentationIdentity: committedIdentity,
    augmentationOverlayPlan: overlayPlan,
  };
  const restoredController = {
    encounters: [{ id: 'encounter:runtime', operationId: 'operation:coverage', cleared: false }],
    mechanisms: [{
      id: 'mechanism:runtime',
      operationId: 'operation:coverage',
      connectionId: 'segment:shortcut',
      type: 'dungeonSupplementShortcut',
      stateId: stateIds.shortcut,
      activated: false,
      object: { userData: {} },
    }],
    chests: [{
      id: 'reward:runtime',
      operationId: 'operation:coverage',
      opened: false,
      object: { userData: {} },
    }],
    ladders: [{
      id: 'ladder:runtime',
      connectionId: 'segment:shortcut',
      deployed: false,
      disabled: true,
      object: { visible: false },
    }],
    connectorLifts: [],
    pressurePlates: [{
      id: 'pressure:runtime',
      operationId: 'operation:coverage',
      activated: false,
    }],
    doors: [],
    traps: [],
    conveyors: [],
    _getMechanismBlockingEncounter:
      DungeonController.prototype._getMechanismBlockingEncounter,
    _activateMechanism(mechanism) {
      return DungeonController.prototype._activateMechanism.call(this, mechanism);
    },
  };
  const unlockedLiftIds = [];
  const restoredLiftRuntime = {
    lifts: [{
      id: 'lift:runtime',
      descriptor: { connectionId: 'segment:shortcut' },
      shortcutUnlocked: false,
    }],
    unlockLift(id) {
      unlockedLiftIds.push(id);
      this.lifts.find((lift) => lift.id === id).shortcutUnlocked = true;
      return { ok: true };
    },
  };
  restoredController.connectorLifts = restoredLiftRuntime.lifts;
  restoredController.game = {
    connectorLiftRuntime: restoredLiftRuntime,
    addParticleBurst() {},
    ui: { showToast() {} },
  };
  const restoration = restoreDungeonAugmentationMutableState({
    dungeon: restoredDungeon,
    controller: restoredController,
    connectorLiftRuntime: restoredLiftRuntime,
  });
  assert.equal(restoration.applied, true);
  assert.equal(restoredController.encounters[0].cleared, true);
  assert.equal(restoredController.mechanisms[0].activated, true);
  assert.equal(restoredController.chests[0].opened, true);
  assert.equal(restoredController.ladders[0].deployed, true);
  assert.equal(restoredController.ladders[0].object.visible, true);
  assert.equal(restoredController.pressurePlates[0].activated, true);
  assert.deepEqual(unlockedLiftIds, ['lift:runtime']);
});

test('reward, ladder, and lift restoration remains inside the persisted network namespace', () => {
  const networkA = {
    reward: 'operation:network-a:state:reward',
    shortcut: 'operation:network-a:state:shortcut',
  };
  const networkB = {
    reward: 'operation:network-b:state:reward',
    shortcut: 'operation:network-b:state:shortcut',
  };
  const baseIdentity = createDungeonAugmentationSaveIdentity({
    profileId: INDUSTRIAL_SUPPLEMENT_PREVIEW_V4_PROFILE_ID,
    seed: 'layout:namespaced-runtime-state',
    basePlanHash: 'base:namespaced-runtime-state',
    augmentationPlanHash: 'augmentation:namespaced-runtime-state',
    effectivePlanHash: computeEffectiveDungeonPlanHash(
      'base:namespaced-runtime-state',
      'augmentation:namespaced-runtime-state',
    ),
    themeRevisions: [],
    progressionStateIds: [...Object.values(networkA), ...Object.values(networkB)],
  });
  const identity = withDungeonAugmentationMutableState(baseIdentity, {
    [networkA.reward]: 'claimed',
    [networkA.shortcut]: 'available',
  });
  const overlayPlan = {
    operations: [
      { id: 'operation:network-a', stableRuntimeStateIds: networkA },
      { id: 'operation:network-b', stableRuntimeStateIds: networkB },
    ],
    segments: [
      { id: 'segment:network-a', operationId: 'operation:network-a' },
      { id: 'segment:network-b', operationId: 'operation:network-b' },
    ],
  };
  const makeMechanism = (suffix, stateId) => ({
    id: `mechanism:${suffix}`,
    operationId: `operation:${suffix}`,
    connectionId: `segment:${suffix}`,
    targetConnectionId: `segment:${suffix}`,
    type: 'dungeonSupplementShortcut',
    shortcutStateId: stateId,
    activated: false,
    position: { x: 0, y: 0, z: 0 },
    object: { userData: {} },
  });
  const mechanismA = makeMechanism('network-a', networkA.shortcut);
  const mechanismB = makeMechanism('network-b', networkB.shortcut);
  const chestA = {
    id: 'reward:network-a',
    stateId: networkA.reward,
    opened: false,
    object: { userData: {} },
  };
  const chestB = {
    id: 'reward:network-b',
    stateId: networkB.reward,
    opened: false,
    object: { userData: {} },
  };
  const ladderA = {
    id: 'ladder:network-a',
    connectionId: 'segment:network-a',
    deployed: false,
    disabled: true,
    object: { visible: false },
  };
  const ladderB = {
    id: 'ladder:network-b',
    connectionId: 'segment:network-b',
    deployed: false,
    disabled: true,
    object: { visible: false },
  };
  const liftA = {
    id: 'lift:network-a',
    connectionId: 'segment:network-a',
    shortcutUnlocked: false,
  };
  const liftB = {
    id: 'lift:network-b',
    connectionId: 'segment:network-b',
    shortcutUnlocked: false,
  };
  const liftRuntime = {
    lifts: [liftA, liftB],
    unlockLift(id) {
      const lift = this.lifts.find((candidate) => candidate.id === id);
      if (lift) lift.shortcutUnlocked = true;
      return { ok: Boolean(lift) };
    },
  };
  const controller = {
    encounters: [],
    mechanisms: [mechanismA, mechanismB],
    chests: [chestA, chestB],
    pressurePlates: [],
    ladders: [ladderA, ladderB],
    connectorLifts: [liftA, liftB],
    doors: [],
    traps: [],
    conveyors: [],
    game: {
      connectorLiftRuntime: liftRuntime,
      addParticleBurst() {},
      ui: { showToast() {} },
    },
    _getMechanismBlockingEncounter:
      DungeonController.prototype._getMechanismBlockingEncounter,
    _activateMechanism(candidate) {
      return DungeonController.prototype._activateMechanism.call(this, candidate);
    },
  };

  const result = restoreDungeonAugmentationMutableState({
    dungeon: { augmentationIdentity: identity, augmentationOverlayPlan: overlayPlan },
    controller,
    connectorLiftRuntime: liftRuntime,
  });

  assert.equal(result.applied, true);
  assert.equal(chestA.opened, true);
  assert.equal(chestB.opened, false);
  assert.equal(mechanismA.activated, true);
  assert.equal(mechanismB.activated, false);
  assert.equal(ladderA.deployed, true);
  assert.equal(ladderA.disabled, false);
  assert.equal(ladderB.deployed, false);
  assert.equal(ladderB.disabled, true);
  assert.equal(liftA.shortcutUnlocked, true);
  assert.equal(liftB.shortcutUnlocked, false);
});

test('persisted shortcut replay uses the guarded activation path and normal topology invalidation', () => {
  const shortcutStateId = 'operation:restore:state:shortcut';
  const rewardStateId = 'supplement:restore:reward';
  const pressureStateId = 'supplement:restore:plate';
  const baseIdentity = createDungeonAugmentationSaveIdentity({
    profileId: INDUSTRIAL_SUPPLEMENT_PREVIEW_V4_PROFILE_ID,
    seed: 'layout:guarded-shortcut-restore',
    basePlanHash: 'base:guarded-shortcut-restore',
    augmentationPlanHash: 'augmentation:guarded-shortcut-restore',
    effectivePlanHash: computeEffectiveDungeonPlanHash(
      'base:guarded-shortcut-restore',
      'augmentation:guarded-shortcut-restore',
    ),
    themeRevisions: [],
    progressionStateIds: [shortcutStateId, rewardStateId, pressureStateId],
  });
  const blockedIdentity = withDungeonAugmentationMutableState(baseIdentity, {
    [shortcutStateId]: 'available',
  });
  const satisfiedIdentity = withDungeonAugmentationMutableState(baseIdentity, {
    [shortcutStateId]: 'available',
    [rewardStateId]: true,
    [pressureStateId]: true,
  });
  const createDungeon = (identity) => ({
    augmentationIdentity: identity,
    augmentationOverlayPlan: { operations: [], segments: [] },
  });
  const createController = () => {
    const mechanism = {
      id: 'supplement:restore:shortcut-control',
      type: 'dungeonSupplementShortcut',
      shortcutStateId,
      activated: false,
      targetDoorIds: ['supplement:restore:gate'],
      position: { x: 0, y: 0, z: 0 },
    };
    const door = {
      id: 'supplement:restore:gate',
      label: 'Restored shortcut gate',
      closed: true,
      locked: true,
      isDungeonSupplement: true,
      requiredShortcutStateIds: [shortcutStateId],
      requiredStateIds: [rewardStateId],
      requiredPressurePlateIds: [pressureStateId],
    };
    const controller = {
      mechanisms: [mechanism],
      doors: [door],
      encounters: [],
      ladders: [],
      connectorLifts: [],
      traps: [],
      conveyors: [],
      chests: [{
        id: rewardStateId,
        opened: false,
      }],
      pressurePlates: [{
        id: pressureStateId,
        activated: false,
      }],
      navigationTopologyRevision: 0,
      topologyInvalidationCount: 0,
      activationCallCount: 0,
      progressionManager: {
        hasKeycard: () => false,
        getDoor: () => null,
      },
      lastSafePlayerPosition: { copy() {} },
      game: {
        connectorLiftRuntime: { lifts: [], unlockLift() {} },
        addParticleBurst() {},
        player: { root: { position: { x: 0, y: 0, z: 0 } } },
        ui: { showToast() {} },
      },
      invalidateNavigationTopology() {
        this.navigationTopologyRevision += 1;
        this.topologyInvalidationCount += 1;
      },
      _pulseDoor() {},
      _activateMechanism(candidate) {
        this.activationCallCount += 1;
        return DungeonController.prototype._activateMechanism.call(this, candidate);
      },
    };
    for (const method of [
      '_getMechanismBlockingEncounter',
      '_openDoorIfRequirementsSatisfied',
      '_getDoorRequirementStatus',
      '_readDoorRequirementIds',
      '_isEncounterRequirementSatisfied',
      '_isMechanismActivated',
      '_isShortcutStateActivated',
      '_isGenericProgressionStateActivated',
      '_isPressurePlateActivated',
      '_openDoor',
    ]) {
      controller[method] = DungeonController.prototype[method];
    }
    return { controller, mechanism, door };
  };

  const blocked = createController();
  restoreDungeonAugmentationMutableState({
    dungeon: createDungeon(blockedIdentity),
    controller: blocked.controller,
    connectorLiftRuntime: blocked.controller.game.connectorLiftRuntime,
  });
  assert.equal(blocked.controller.activationCallCount, 1);
  assert.equal(blocked.mechanism.activated, true);
  assert.equal(blocked.door.closed, true);
  assert.equal(blocked.door.locked, true);
  assert.equal(blocked.controller.topologyInvalidationCount, 0);

  const satisfied = createController();
  restoreDungeonAugmentationMutableState({
    dungeon: createDungeon(satisfiedIdentity),
    controller: satisfied.controller,
    connectorLiftRuntime: satisfied.controller.game.connectorLiftRuntime,
  });
  assert.equal(satisfied.controller.activationCallCount, 1);
  assert.equal(satisfied.door.closed, false);
  assert.equal(satisfied.door.locked, false);
  assert.equal(satisfied.controller.chests[0].opened, true);
  assert.equal(satisfied.controller.pressurePlates[0].activated, true);
  assert.equal(satisfied.controller.topologyInvalidationCount, 1);
});

test('persisted V4 local controls replay only their namespaced hazard scope', () => {
  const mechanismStateId = 'operation:local-control:state:mechanism';
  const identity = createDungeonAugmentationSaveIdentity({
    profileId: INDUSTRIAL_SUPPLEMENT_PREVIEW_V4_PROFILE_ID,
    seed: 'layout:local-control-restore',
    basePlanHash: 'base:local-control-restore',
    augmentationPlanHash: 'augmentation:local-control-restore',
    effectivePlanHash: computeEffectiveDungeonPlanHash(
      'base:local-control-restore',
      'augmentation:local-control-restore',
    ),
    themeRevisions: [],
    progressionStateIds: [mechanismStateId],
  });
  const overlayPlan = {
    operations: [{
      id: 'operation:local-control',
      stableRuntimeStateIds: { mechanism: mechanismStateId },
    }],
  };
  const sourceDungeon = { augmentationIdentity: identity, augmentationOverlayPlan: overlayPlan };
  const sourceController = {
    encounters: [],
    mechanisms: [{
      id: 'mechanism:local-control',
      operationId: 'operation:local-control',
      type: 'dungeonSupplementLocalControl',
      scopedAction: 'controlLocalHazards',
      activated: true,
    }],
    chests: [],
    pressurePlates: [],
    ladders: [],
    connectorLifts: [],
  };
  const mutableState = captureDungeonAugmentationMutableState({
    dungeon: sourceDungeon,
    controller: sourceController,
  });
  assert.deepEqual(mutableState, { [mechanismStateId]: true });

  const committedIdentity = withDungeonAugmentationMutableState(identity, mutableState);
  const localTrap = {
    id: 'trap:local',
    roomId: 'room:local-control',
    operationId: 'operation:local-control',
    hazardProfileId: 'supplement-route-network-floor-trap',
    active: true,
  };
  const unrelatedTrap = {
    id: 'trap:unrelated',
    roomId: 'authored:trap-room',
    operationId: 'authored:trap-operation',
    hazardProfileId: 'authored-global-trap',
    active: true,
  };
  const siblingNetworkTrap = {
    id: 'trap:sibling-network-room',
    roomId: 'room:sibling-network-module',
    operationId: 'operation:local-control',
    hazardProfileId: 'supplement-route-network-floor-trap',
    active: true,
  };
  const mechanism = {
    id: 'mechanism:local-control',
    operationId: 'operation:local-control',
    roomId: 'room:local-control',
    targetRoomId: 'room:local-control',
    targetOperationId: 'operation:local-control',
    controlledHazardProfileIds: ['supplement-route-network-floor-trap'],
    type: 'dungeonSupplementLocalControl',
    scopedAction: 'controlLocalHazards',
    activated: false,
    position: { x: 0, y: 0, z: 0 },
    object: { userData: {} },
  };
  const restoredController = {
    encounters: [],
    mechanisms: [mechanism],
    chests: [],
    pressurePlates: [],
    ladders: [],
    connectorLifts: [],
    doors: [],
    traps: [localTrap, siblingNetworkTrap, unrelatedTrap],
    conveyors: [{ id: 'authored:conveyor', active: true }],
    game: {
      addParticleBurst() {},
      ui: { showToast() {} },
    },
    _getMechanismBlockingEncounter:
      DungeonController.prototype._getMechanismBlockingEncounter,
    _activateMechanism(candidate) {
      return DungeonController.prototype._activateMechanism.call(this, candidate);
    },
  };
  const restoration = restoreDungeonAugmentationMutableState({
    dungeon: {
      augmentationIdentity: committedIdentity,
      augmentationOverlayPlan: overlayPlan,
    },
    controller: restoredController,
  });
  assert.equal(restoration.applied, true);
  assert.equal(mechanism.activated, true);
  assert.equal(localTrap.active, false);
  assert.equal(siblingNetworkTrap.active, true);
  assert.equal(unrelatedTrap.active, true);
  assert.equal(restoredController.conveyors[0].active, true);
});
