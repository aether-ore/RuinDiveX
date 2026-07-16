import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUSTER_LAB_STORAGE_VERSION,
  BusterLabStorage,
  createDefaultBusterLabState,
  validateBusterLabState,
} from '../src/buster/BusterLabStorage.js';
import {
  MemoryLockManager,
  createBusterLabEnvelope,
  getLegacyBusterLabV2StorageKeys,
} from '../src/buster/BusterLabPersistence.js';
import {
  DEFAULT_BOSS_PROFILE_ID,
  createBossExpeditionSpec,
} from '../src/reaverbots/ReaverbotBossCatalog.js';

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.failWrites = false;
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    if (this.failWrites) throw new Error('disk full');
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('v3 defaults persist the exact authored starting Arms/Gear profile', () => {
  const state = createDefaultBusterLabState();

  assert.equal(state.version, BUSTER_LAB_STORAGE_VERSION);
  assert.equal(state.armsGear.version, 1);
  assert.equal(state.armsGear.schemaVersion, 1);
  assert.equal(state.armsGear.defenseUnlocked, false);
  assert.deepEqual(state.armsGear.unlockedFixedArmIds, ['laserBeamBlade', 'liftArm']);
  assert.deepEqual(state.armsGear.unlockedGearIds, [
    'reinforcedArmorFrame',
    'gyroStabilizerHelmet',
  ]);
  assert.deepEqual(state.armsGear.armSlots, {
    special1: { kind: 'fixedArm', armId: 'laserBeamBlade' },
    special2: { kind: 'customBuster', buildId: 'build-a' },
    utility: { kind: 'fixedArm', armId: 'liftArm' },
  });
  assert.deepEqual(state.armsGear.gearSlots, {
    armor: 'reinforcedArmorFrame',
    helmet: 'gyroStabilizerHelmet',
    mobility: null,
    defense: null,
    utility1: null,
    utility2: null,
  });
  assert.deepEqual(state.armsGear.fabricatedRecipeIds, []);
  assert.equal(
    state.armsGear.gear.records.find((record) => record.gearId === 'jumpSprings')?.unlocked,
    false,
  );
  assert.deepEqual(state.assignments.slots, { 1: null, 2: 'build-a' });
  assert.deepEqual(validateBusterLabState(state), []);
});

test('a missing v3 main recovers its valid v3 backup before retained v2 data', async () => {
  const storage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  const saveContextId = 'missing-v3-main-recovery';
  const lab = await BusterLabStorage.open({ storage, lockManager, saveContextId });

  assert.equal((await lab.updateRollSalvageAsync((roll) => roll.addIdentifiedScrap(7))).ok, true);
  assert.equal((await lab.updateRollSalvageAsync((roll) => roll.addIdentifiedScrap(1))).ok, true);
  const expectedBackupRaw = storage.getItem(lab.storageKeys.backup);
  assert.equal(JSON.parse(expectedBackupRaw).state.rollSalvage.identifiedScrap, 7);

  const legacyKeys = getLegacyBusterLabV2StorageKeys(saveContextId);
  const legacyState = clone(createDefaultBusterLabState());
  legacyState.version = 2;
  legacyState.rollSalvage.identifiedScrap = 99;
  delete legacyState.armsGear;
  storage.setItem(legacyKeys.main, JSON.stringify({
    storageVersion: 2,
    saveContextId,
    revision: 11,
    writeId: 'retained-v2-write',
    updatedAt: '2026-01-01T00:00:00.000Z',
    state: legacyState,
  }));
  storage.removeItem(lab.storageKeys.main);

  const recoveredLab = new BusterLabStorage({ storage, lockManager, saveContextId });
  const recovered = recoveredLab.load();
  assert.equal(recovered.rollSalvage.identifiedScrap, 7);
  assert.match(recoveredLab.lastWarning, /v3 backup/i);
  assert.equal(storage.getItem(recoveredLab.storageKeys.main), expectedBackupRaw);
  assert.equal(storage.getItem(legacyKeys.main) !== null, true);
  assert.equal(recoveredLab.lastSaveSucceeded, false);
});

test('partial v3 Arms/Gear repairs permanent starters without granting Jump Springs', () => {
  const storage = new MemoryStorage();
  const saveContextId = 'partial-v3-starter-repair';
  const partial = createDefaultBusterLabState();
  partial.armsGear.arms.ownedArmIds = [];
  partial.armsGear.gear.records = [];
  partial.armsGear.fabricatedRecipeIds = [];

  const lab = new BusterLabStorage({ storage, saveContextId, lockManager: new MemoryLockManager() });
  storage.setItem(lab.storageKeys.main, JSON.stringify(createBusterLabEnvelope({
    saveContextId,
    state: partial,
    revision: 4,
    writeId: 'partial-v3-write',
  })));
  const repaired = lab.load();

  assert.deepEqual(repaired.armsGear.arms.ownedArmIds, ['laserBeamBlade', 'liftArm']);
  assert.deepEqual(
    repaired.armsGear.gear.records.filter((record) => record.unlocked).map((record) => record.gearId),
    ['reinforcedArmorFrame', 'gyroStabilizerHelmet'],
  );
  assert.equal(
    repaired.armsGear.gear.records.find((record) => record.gearId === 'jumpSprings')?.unlocked,
    false,
  );
  assert.deepEqual(validateBusterLabState(repaired), []);
});

test('fabrication markers repair missing permanent output unlocks without auto-equipping', () => {
  const storage = new MemoryStorage();
  const saveContextId = 'fabrication-marker-repair';
  const partial = createDefaultBusterLabState();
  partial.armsGear.fabricatedRecipeIds = ['jumpSprings', 'machineGunArm'];
  partial.armsGear.arms.ownedArmIds = ['laserBeamBlade', 'liftArm'];
  partial.armsGear.gear.records.find((record) => record.gearId === 'jumpSprings').unlocked = false;

  const lab = new BusterLabStorage({ storage, saveContextId, lockManager: new MemoryLockManager() });
  storage.setItem(lab.storageKeys.main, JSON.stringify(createBusterLabEnvelope({
    saveContextId,
    state: partial,
    revision: 3,
    writeId: 'fabrication-marker-write',
  })));
  const repaired = lab.load();

  assert.equal(repaired.armsGear.arms.ownedArmIds.includes('machineGunArm'), true);
  assert.equal(
    repaired.armsGear.gear.records.find((record) => record.gearId === 'jumpSprings')?.unlocked,
    true,
  );
  assert.equal(repaired.armsGear.gear.slots.mobility, null);
  assert.deepEqual(repaired.armsGear.fabricatedRecipeIds, ['jumpSprings', 'machineGunArm']);
  assert.deepEqual(validateBusterLabState(repaired), []);
});

test('reset leaves the current lab unchanged when persistence fails or writes are read-only', async () => {
  const storage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  const saveContextId = 'failure-safe-reset';
  const lab = await BusterLabStorage.open({ storage, lockManager, saveContextId });
  assert.equal((await lab.updateRollSalvageAsync((roll) => roll.addIdentifiedScrap(9))).ok, true);
  const durableBeforeFailure = storage.getItem(lab.storageKeys.main);
  const stateBeforeFailure = clone(lab.state);
  const revisionBeforeFailure = lab.revision;

  storage.failWrites = true;
  assert.equal(lab.reset(), lab.state);
  assert.deepEqual(lab.state, stateBeforeFailure);
  assert.equal(lab.revision, revisionBeforeFailure);
  assert.equal(storage.getItem(lab.storageKeys.main), durableBeforeFailure);
  assert.match(lab.lastWarning, /left unchanged/i);

  storage.failWrites = false;
  const readOnlyLab = await BusterLabStorage.open({
    storage,
    saveContextId,
    lockManager: null,
  });
  const stateBeforeReadOnlyReset = clone(readOnlyLab.state);
  const durableBeforeReadOnlyReset = storage.getItem(readOnlyLab.storageKeys.main);
  storage.failWrites = true;
  assert.equal(readOnlyLab.reset(), readOnlyLab.state);
  assert.deepEqual(readOnlyLab.state, stateBeforeReadOnlyReset);
  assert.equal(storage.getItem(readOnlyLab.storageKeys.main), durableBeforeReadOnlyReset);
  assert.match(readOnlyLab.lastWarning, /writes are paused|left unchanged/i);
});

test('Jump Springs fabrication spends its exact bill once and persists unlocked but unequipped', async () => {
  const storage = new MemoryStorage();
  const saveContextId = 'equipment-crafting';
  const lockManager = new MemoryLockManager();
  const lab = await BusterLabStorage.open({ storage, saveContextId, lockManager });

  const funded = await lab.updateRollSalvageAsync((roll) => {
    roll.addIdentifiedScrap(24);
    roll.addPart({ id: 'temperedJumpSpring', name: 'Tempered Jump Spring' }, 2);
    roll.addPart({ id: 'stabilizedBellyCore', name: 'Stabilized Belly Core' }, 2);
  });
  assert.equal(funded.ok, true);

  const fabricated = await lab.fabricateEquipment('jumpSprings');
  assert.equal(fabricated.ok, true);
  assert.deepEqual(fabricated.spent, {
    identifiedScrap: 12,
    scrap: 12,
    parts: { temperedJumpSpring: 1, stabilizedBellyCore: 1 },
  });
  assert.equal(lab.state.rollSalvage.identifiedScrap, 12);
  assert.equal(lab.state.rollSalvage.parts.temperedJumpSpring.quantity, 1);
  assert.equal(lab.state.rollSalvage.parts.stabilizedBellyCore.quantity, 1);
  assert.deepEqual(lab.state.armsGear.fabricatedRecipeIds, ['jumpSprings']);
  assert.equal(
    lab.state.armsGear.gear.records.find((record) => record.gearId === 'jumpSprings')?.unlocked,
    true,
  );
  assert.equal(lab.state.armsGear.gear.slots.mobility, null);

  const revisionAfterFabrication = lab.revision;
  const repeated = await lab.fabricateEquipment('jumpSprings');
  assert.equal(repeated.ok, false);
  assert.equal(repeated.reason, 'already-fabricated');
  assert.equal(lab.revision, revisionAfterFabrication);
  assert.equal(lab.state.rollSalvage.identifiedScrap, 12);
  assert.equal(lab.state.rollSalvage.parts.temperedJumpSpring.quantity, 1);
  assert.equal(lab.state.rollSalvage.parts.stabilizedBellyCore.quantity, 1);

  const reloaded = new BusterLabStorage({ storage, saveContextId, lockManager }).load();
  assert.deepEqual(reloaded.armsGear.fabricatedRecipeIds, ['jumpSprings']);
  assert.equal(reloaded.armsGear.gear.slots.mobility, null);
  assert.equal(
    reloaded.armsGear.gear.records.find((record) => record.gearId === 'jumpSprings')?.unlocked,
    true,
  );
});

test('Guard Projector fabrication is blocked without spending until Defense unlocks', async () => {
  const storage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  const lab = await BusterLabStorage.open({
    storage,
    lockManager,
    saveContextId: 'guard-projector-prerequisite',
  });
  const funded = await lab.updateRollSalvageAsync((roll) => {
    roll.addIdentifiedScrap(14);
    roll.addPart({ id: 'metalShieldPlating', name: 'Metal Shield Plating' }, 1);
    roll.addPart({ id: 'shieldPivotJoint', name: 'Shield Pivot Joint' }, 1);
    roll.addPart({ id: 'behaviorChipSentry', name: 'Behavior Chip: Sentry' }, 1);
  });
  assert.equal(funded.ok, true);
  const revisionBeforeBlockedCraft = lab.revision;

  const blocked = await lab.fabricateEquipment('guardProjector');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'defense-locked');
  assert.equal(lab.revision, revisionBeforeBlockedCraft);
  assert.equal(lab.state.rollSalvage.identifiedScrap, 14);
  assert.equal(lab.state.rollSalvage.parts.metalShieldPlating.quantity, 1);
  assert.equal(lab.state.rollSalvage.parts.shieldPivotJoint.quantity, 1);
  assert.equal(lab.state.rollSalvage.parts.behaviorChipSentry.quantity, 1);
  assert.equal(lab.state.armsGear.fabricatedRecipeIds.includes('guardProjector'), false);

  assert.equal((await lab.grantDefenseBarrier()).ok, true);
  const crafted = await lab.fabricateEquipment('guardProjector');
  assert.equal(crafted.ok, true);
  assert.equal(lab.state.rollSalvage.identifiedScrap, 0);
  assert.equal(lab.state.rollSalvage.parts.metalShieldPlating?.quantity ?? 0, 0);
  assert.equal(lab.state.rollSalvage.parts.shieldPivotJoint?.quantity ?? 0, 0);
  assert.equal(lab.state.rollSalvage.parts.behaviorChipSentry?.quantity ?? 0, 0);
  assert.equal(
    lab.state.armsGear.gear.records.find((record) => record.gearId === 'guardProjector')?.unlocked,
    true,
  );
  assert.equal(lab.state.armsGear.gear.slots.defense, 'barrierGenerator');
});

test('first qualifying Boss victory grants and auto-equips Barrier exactly once', async () => {
  const storage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  const lab = await BusterLabStorage.open({
    storage,
    lockManager,
    saveContextId: 'defense-milestone',
  });
  assert.equal(lab.state.armsGear.gear.unlockedSlots.includes('defense'), false);

  const expedition = createBossExpeditionSpec({
    id: 'defense-milestone-boss',
    seed: 1701,
    depth: 5,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });
  assert.equal((await lab.lockBossHuntForExpedition(expedition)).ok, true);
  const victory = await lab.recordBossVictory({
    expeditionId: expedition.id,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });

  assert.equal(victory.ok, true);
  assert.equal(victory.defenseUnlocked, true);
  assert.equal(victory.barrierGranted, true);
  assert.equal(lab.state.armsGear.gear.unlockedSlots.includes('defense'), true);
  assert.equal(
    lab.state.armsGear.gear.records.find((record) => record.gearId === 'barrierGenerator')?.unlocked,
    true,
  );
  assert.equal(lab.state.armsGear.gear.slots.defense, 'barrierGenerator');

  const revisionAfterVictory = lab.revision;
  const duplicateVictory = await lab.recordBossVictory({
    expeditionId: expedition.id,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });
  assert.equal(duplicateVictory.ok, true);
  assert.equal(duplicateVictory.idempotent, true);
  assert.equal(lab.revision, revisionAfterVictory);

  const repeatedGrant = await lab.grantDefenseBarrier();
  assert.equal(repeatedGrant.ok, true);
  assert.equal(repeatedGrant.unchanged, true);
  assert.equal(lab.revision, revisionAfterVictory);
});

test('qualifying Boss victory equips an already-owned Barrier when Defense unlocks empty', async () => {
  const storage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  const lab = await BusterLabStorage.open({
    storage,
    lockManager,
    saveContextId: 'preowned-defense-milestone',
  });
  const seeded = await lab.transact({ operation: 'seed-preowned-barrier' }, (state) => {
    state.armsGear.gear.records
      .find((record) => record.gearId === 'barrierGenerator').unlocked = true;
  });
  assert.equal(seeded.ok, true);
  assert.equal(lab.state.armsGear.gear.unlockedSlots.includes('defense'), false);
  assert.equal(lab.state.armsGear.gear.slots.defense, null);

  const expedition = createBossExpeditionSpec({
    id: 'preowned-defense-milestone-boss',
    seed: 1703,
    depth: 5,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });
  assert.equal((await lab.lockBossHuntForExpedition(expedition)).ok, true);
  const victory = await lab.recordBossVictory({
    expeditionId: expedition.id,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });

  assert.equal(victory.ok, true);
  assert.equal(victory.barrierGranted, false, 'the entitlement already existed');
  assert.equal(victory.defenseUnlocked, true);
  assert.equal(lab.state.armsGear.gear.slots.defense, 'barrierGenerator');

  const unequipped = await lab.equipGearLoadoutSlot('defense', null);
  assert.equal(unequipped.ok, true);
  assert.equal(lab.state.armsGear.gear.slots.defense, null, 'later intentional unequip remains respected');
});

test('debug and sandbox Boss outcomes cannot unlock Defense before a qualifying victory', async () => {
  const storage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  const lab = await BusterLabStorage.open({
    storage,
    lockManager,
    saveContextId: 'defense-milestone-provenance',
  });

  const sandbox = await lab.recordBossVictory({
    expeditionId: 'sandbox-boss',
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    sandbox: true,
  });
  assert.equal(sandbox.suppressed, true);

  const debug = await lab.recordBossVictory({
    expeditionId: 'debug-boss',
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    debug: true,
    allowDebugOverride: true,
    debugRewardOutcome: false,
  });
  assert.equal(debug.ok, true);
  assert.equal(debug.barrierGranted, false);
  assert.equal(debug.defenseUnlocked, false);
  assert.equal(lab.state.bossHunts.recordedExpeditions['debug-boss'].debug, true);
  assert.equal(lab.state.armsGear.defenseUnlocked, false);

  const reloaded = new BusterLabStorage({
    storage,
    lockManager,
    saveContextId: 'defense-milestone-provenance',
  }).load();
  assert.equal(reloaded.armsGear.defenseUnlocked, false);

  const expedition = createBossExpeditionSpec({
    id: 'qualifying-boss-after-debug',
    seed: 1702,
    depth: 5,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });
  assert.equal((await lab.lockBossHuntForExpedition(expedition)).ok, true);
  const victory = await lab.recordBossVictory({
    expeditionId: expedition.id,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });
  assert.equal(victory.ok, true);
  assert.equal(victory.barrierGranted, true);
  assert.equal(victory.defenseUnlocked, true);
});

test('v2 envelope adoption preserves the Custom Buster and starts Mobility empty with Jump Springs locked', () => {
  const storage = new MemoryStorage();
  const saveContextId = 'v2-fixed-arms-adoption';
  const legacyKeys = getLegacyBusterLabV2StorageKeys(saveContextId);
  const legacyState = clone(createDefaultBusterLabState());
  legacyState.version = 2;
  delete legacyState.armsGear;
  legacyState.assignments = { slots: { 1: 'build-a', 2: null } };
  legacyState.chassisBuilds[0].name = 'Preserved V2 Build';
  legacyState.chassisBuilds[0].tuning.power = 5;
  legacyState.chassisBuilds[0].tuning.energy = 3;
  legacyState.migrations = {
    ...legacyState.migrations,
    applied: ['buster-lab-v1', 'starter-build-a-v1', 'buster-lab-state-v2'],
  };

  storage.setItem(legacyKeys.main, JSON.stringify({
    storageVersion: 2,
    saveContextId,
    revision: 7,
    writeId: 'v2-write-7',
    updatedAt: '2026-01-01T00:00:00.000Z',
    state: legacyState,
  }));

  const lab = new BusterLabStorage({ storage, saveContextId, lockManager: new MemoryLockManager() });
  const adopted = lab.load();

  assert.equal(adopted.chassisBuilds[0].name, 'Preserved V2 Build');
  assert.equal(adopted.chassisBuilds[0].tuning.power, 5);
  assert.equal(adopted.chassisBuilds[0].tuning.energy, 3);
  assert.deepEqual(adopted.armsGear.armSlots.special1, {
    kind: 'fixedArm',
    armId: 'laserBeamBlade',
  });
  assert.deepEqual(adopted.armsGear.armSlots.special2, {
    kind: 'customBuster',
    buildId: 'build-a',
  });
  assert.equal(adopted.armsGear.gearSlots.mobility, null);
  assert.equal(
    adopted.armsGear.gear.records.find((record) => record.gearId === 'jumpSprings')?.unlocked,
    false,
  );
  assert.equal(storage.getItem(legacyKeys.main) !== null, true, 'v2 recovery copy is retained.');
  assert.equal(JSON.parse(storage.getItem(lab.storageKeys.main)).storageVersion, 3);
  assert.deepEqual(validateBusterLabState(adopted), []);
});
