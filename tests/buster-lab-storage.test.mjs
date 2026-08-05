import test from 'node:test';
import assert from 'node:assert/strict';

import { RollSalvageStorage } from '../src/RollSalvageStorage.js';
import {
  BUSTER_RECIPE_LIST,
  BUSTER_RECIPES,
  LEGACY_AFTER_DELAY_RECIPE,
  getRecipeDiscoveryState,
} from '../src/buster/BusterRecipeCatalog.js';
import {
  BUSTER_MODULE_LIST,
  MEGA_BUSTER_CALIBRATION_CATALOG,
} from '../src/buster/catalog.js';
import {
  ASCENSION_ENGINE_PROGRESS_SCHEMA_VERSION,
  BUSTER_LAB_STORAGE_KEY,
  BOSS_HUNT_REPEAT_REWARD_CHANCE,
  BusterLabStorage,
  createAscensionEngineEncounterProgress,
  createDefaultBossHuntState,
  createDefaultBusterLabState,
  getBossHuntRewardRoll,
  validateBusterLabState,
} from '../src/buster/BusterLabStorage.js';
import {
  DEFAULT_BOSS_PROFILE_ID,
  REAVERBOT_BOSS_PROFILE_IDS,
  createBossExpeditionSpec,
  resolveBossFeaturedMaterial,
  resolveBossRewardMaterial,
} from '../src/reaverbots/ReaverbotBossCatalog.js';
import {
  MemoryLockManager,
  createBusterLabEnvelope,
} from '../src/buster/BusterLabPersistence.js';
import {
  createDungeonAugmentationSaveIdentity,
  withDungeonAugmentationMutableState,
} from '../src/dungeon-augmentation/identity.js';
import {
  computeEffectiveDungeonPlanHash,
} from '../src/dungeon-augmentation/validation.js';

const AUTHORED_V4_LAYOUT_SEED = 'layout:industrial-v4-authored-r1';

function createAuthoredV4SaveIdentity(input = {}) {
  return createDungeonAugmentationSaveIdentity({
    ...input,
    generationMode: 'authored-artifact',
    artifactId: 'industrial-v4-authored-r1',
    artifactRevision: 1,
    profileId: 'industrial-supplement-preview-v4',
    profileRevision: 6,
    gameplayTuningRevision: 1,
    resolvedLayoutSeed: AUTHORED_V4_LAYOUT_SEED,
    seed: AUTHORED_V4_LAYOUT_SEED,
  });
}

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

class FakeStorageEventTarget {
  constructor() {
    this.listeners = new Set();
  }

  addEventListener(type, listener) {
    if (type === 'storage') this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === 'storage') this.listeners.delete(listener);
  }

  dispatch({ key, newValue, storageArea = null }) {
    for (const listener of [...this.listeners]) {
      listener({ type: 'storage', key, newValue, storageArea });
    }
  }
}

function addPart(state, partId, quantity = 1) {
  state.rollSalvage.parts[partId] = {
    id: partId,
    name: partId,
    family: 'Test Part',
    quantity,
  };
}

test('Custom Buster recipe catalog uses the authored named salvage and scrap costs', () => {
  assert.deepEqual(BUSTER_RECIPES.pulse.requirements, {
    identifiedScrap: 6,
    scrap: 6,
    parts: { revolvingPulseBarrel: 1 },
  });
  assert.deepEqual(BUSTER_RECIPES.mortar.parts, { highAngleLaunchTube: 1 });
  assert.equal(BUSTER_RECIPES.mortar.scrapCost, 8);
  assert.deepEqual(BUSTER_RECIPES.pursuit.parts, {
    behaviorChipPursuit: 1,
    rubyOpticLens: 1,
  });
  assert.equal(BUSTER_RECIPES.pursuit.scrapCost, 12);
  assert.deepEqual(BUSTER_RECIPES.apex.parts, { ballisticsLogicChip: 1 });
  assert.equal(BUSTER_RECIPES.apex.scrapCost, 8);
  assert.equal(BUSTER_RECIPES.afterDelay, undefined);
  assert.deepEqual(LEGACY_AFTER_DELAY_RECIPE.parts, { clusterBurstSequencer: 1 });
  assert.equal(LEGACY_AFTER_DELAY_RECIPE.scrapCost, 8);
  assert.deepEqual(BUSTER_RECIPES.spread3.parts, {
    ammunitionFeedDrum: 1,
    revolvingPulseBarrel: 1,
  });
  assert.equal(BUSTER_RECIPES.spread3.scrapCost, 10);
  assert.deepEqual(BUSTER_RECIPES.cluster5.parts, { clusterBurstSequencer: 1 });
  assert.equal(BUSTER_RECIPES.cluster5.scrapCost, 12);
  assert.deepEqual(BUSTER_RECIPES.explosion.parts, { volatileOverloadCell: 1 });
  assert.equal(BUSTER_RECIPES.explosion.scrapCost, 10);
});

test('discovery moves from silhouette to Roll clue to exact recipe and survives consumption', () => {
  const unknown = getRecipeDiscoveryState('pursuit', []);
  assert.equal(unknown.level, 'unknown');
  assert.equal(unknown.visibility, 'silhouette');
  assert.equal(unknown.moduleId, null);
  assert.equal(unknown.requirements, null);
  assert.equal(unknown.missingPartIds, null);

  const hinted = getRecipeDiscoveryState('pursuit', ['behaviorChipPursuit']);
  assert.equal(hinted.level, 'hinted');
  assert.equal(hinted.moduleId, 'pursuitGuidance');
  assert.equal(hinted.kind, 'module');
  assert.ok(hinted.rollClue.length > 20);
  assert.equal(hinted.requirements, null);
  assert.equal(hinted.missingPartIds, null);

  const exact = getRecipeDiscoveryState('pursuit', [
    'behaviorChipPursuit',
    'rubyOpticLens',
  ]);
  assert.equal(exact.level, 'full');
  assert.deepEqual(exact.requirements.parts, BUSTER_RECIPES.pursuit.parts);

  const roll = new RollSalvageStorage();
  roll.identifiedScrap = 6;
  roll.addPart({ id: 'revolvingPulseBarrel', name: 'Revolving Pulse Barrel' });
  assert.equal(getRecipeDiscoveryState('pulse', roll).level, 'full');
  assert.equal(roll.transactRecipe(BUSTER_RECIPES.pulse).ok, true);
  assert.equal(roll.getPartCount('revolvingPulseBarrel'), 0);
  assert.equal(roll.hasDiscoveredPart('revolvingPulseBarrel'), true);
  assert.equal(getRecipeDiscoveryState('pulse', roll).level, 'full');

  const discoveries = [];
  const direct = new RollSalvageStorage({}, (_snapshot, reason) => discoveries.push(reason));
  direct.markPartDiscovered('volatileOverloadCell');
  assert.deepEqual(discoveries, ['discoverPart']);
});

test('Roll recipe transactions are all-or-nothing for shortages and thrown factories', () => {
  const roll = new RollSalvageStorage();
  roll.identifiedScrap = 5;
  roll.addPart({ id: 'revolvingPulseBarrel', name: 'Revolving Pulse Barrel' });

  const short = roll.transactRecipe(BUSTER_RECIPES.pulse);
  assert.equal(short.ok, false);
  assert.equal(short.reason, 'insufficient-resources');
  assert.equal(roll.identifiedScrap, 5);
  assert.equal(roll.getPartCount('revolvingPulseBarrel'), 1);

  roll.addIdentifiedScrap(1);
  const thrown = roll.transactRecipe(BUSTER_RECIPES.pulse, {
    createResult() {
      throw new Error('fabricator jam');
    },
  });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.reason, 'transaction-failed');
  assert.equal(roll.identifiedScrap, 6);
  assert.equal(roll.getPartCount('revolvingPulseBarrel'), 1);
});

test('fresh lab grants Build A and its physical Pulse Bolt exactly once', () => {
  const storage = new MemoryStorage();
  const firstLab = new BusterLabStorage({ storage });
  const first = firstLab.load();

  assert.equal(storage.values.has(firstLab.storageKeys.main), true);
  assert.equal(first.chassisInstances.length, 1);
  assert.equal(first.moduleInstances.length, 1);
  assert.equal(first.moduleInstances[0].moduleId, 'pulseBolt');
  assert.equal(first.moduleInstances[0].origin, 'starter');
  assert.equal(first.chassisBuilds.length, 1);
  assert.equal(first.chassisDrafts.length, 1);
  assert.equal(first.chassisRevisions.length, 1);
  assert.deepEqual(first.assignments.slots, { 1: null, 2: 'build-a' });
  assert.deepEqual(first.megaCalibrations, {
    instances: [],
    slots: [null, null, null, null],
    nextInstanceId: 1,
    revision: 1,
  });
  assert.deepEqual(first.chassisBuilds[0].tuning, {
    power: 4,
    energy: 4,
    range: 4,
    rapid: 4,
  });
  assert.equal(first.chassisBuilds[0].program.nodes[0].moduleInstanceId, first.moduleInstances[0].instanceId);
  assert.deepEqual(validateBusterLabState(first), []);

  const reloaded = new BusterLabStorage({ storage }).load();
  assert.equal(reloaded.chassisInstances.length, 1);
  assert.equal(reloaded.moduleInstances.filter((module) => module.origin === 'starter').length, 1);
  assert.equal(reloaded.chassisRevisions.length, 1);
});

test('repeatable debug kits atomically grant every physical part and one complete active recipe bill', () => {
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage });
  lab.load();
  const physicalModuleIds = BUSTER_MODULE_LIST
    .filter((module) => module.physical)
    .map((module) => module.id);
  const calibrationTypes = Object.keys(MEGA_BUSTER_CALIBRATION_CATALOG);

  const first = lab.grantDebugKit();
  assert.equal(first.ok, true);
  assert.equal(first.grantNumber, 1);
  assert.equal(first.modules.length, physicalModuleIds.length);
  assert.deepEqual(first.modules.map((entry) => entry.moduleId), physicalModuleIds);
  assert.equal(first.calibrations.length, calibrationTypes.length);
  assert.equal(lab.state.moduleInstances.length, 1 + physicalModuleIds.length);
  assert.equal(lab.state.moduleInstances.filter((entry) => entry.origin === 'debug').length, physicalModuleIds.length);
  for (const moduleId of physicalModuleIds) {
    assert.equal(
      lab.state.moduleInstances.filter((entry) => entry.moduleId === moduleId).length,
      moduleId === 'pulseBolt' ? 2 : 1,
    );
  }
  assert.equal(lab.state.chassisInstances.length, 2);
  assert.equal(lab.state.chassisInstances.find((entry) => entry.chassisId === 'chassis-b').origin, 'debug');
  assert.ok(lab.state.chassisDrafts.some((entry) => entry.buildId === 'build-b'));
  assert.equal(lab.state.chassisBuilds.some((entry) => entry.buildId === 'build-b'), false);
  assert.equal(lab.state.megaCalibrations.instances.length, calibrationTypes.length);
  assert.deepEqual(
    new Set(lab.state.megaCalibrations.instances.map((entry) => entry.legacyType)),
    new Set(calibrationTypes),
  );
  assert.deepEqual(lab.state.megaCalibrations.slots, [null, null, null, null]);
  assert.deepEqual(lab.state.assignments.slots, { 1: null, 2: 'build-a' });
  assert.equal(lab.state.rollSalvage.identifiedScrap, 66);
  assert.equal(lab.state.rollSalvage.parts.revolvingPulseBarrel.quantity, 2);
  assert.equal(lab.state.rollSalvage.parts.clusterBurstSequencer.quantity, 1);
  for (const recipe of BUSTER_RECIPE_LIST) {
    assert.equal(getRecipeDiscoveryState(recipe, lab.state.discovery).level, 'full');
  }
  assert.deepEqual(validateBusterLabState(lab.state), []);

  const reloaded = new BusterLabStorage({ storage });
  reloaded.load();
  assert.equal(reloaded.state.migrations.debugKitGrantCount, 1);
  assert.equal(reloaded.state.moduleInstances.filter((entry) => entry.origin === 'debug').length, physicalModuleIds.length);

  const second = reloaded.grantDebugKit();
  assert.equal(second.ok, true);
  assert.equal(second.grantNumber, 2);
  assert.equal(reloaded.state.chassisInstances.length, 2);
  assert.equal(reloaded.state.chassisDrafts.filter((entry) => entry.buildId === 'build-b').length, 1);
  assert.equal(reloaded.state.moduleInstances.length, 1 + physicalModuleIds.length * 2);
  assert.equal(reloaded.state.megaCalibrations.instances.length, calibrationTypes.length * 2);
  assert.equal(
    new Set(reloaded.state.moduleInstances.map((entry) => entry.instanceId)).size,
    reloaded.state.moduleInstances.length,
  );

  const beforeFailure = JSON.stringify(reloaded.state);
  storage.failWrites = true;
  const failed = reloaded.grantDebugKit();
  assert.equal(failed.ok, false);
  assert.equal(JSON.stringify(reloaded.state), beforeFailure);
});

test('fabrication consumes resources atomically and creates deterministic physical instances', () => {
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage });
  const state = lab.load();
  state.rollSalvage.identifiedScrap = 6;
  addPart(state, 'revolvingPulseBarrel');
  lab.save(state);

  const fabricated = lab.fabricate('pulse');
  assert.equal(fabricated.ok, true);
  assert.equal(fabricated.module.instanceId, 'module-1');
  assert.equal(fabricated.module.moduleId, 'pulseBolt');
  assert.equal(lab.state.rollSalvage.identifiedScrap, 0);
  assert.equal(lab.state.rollSalvage.parts.revolvingPulseBarrel, undefined);
  assert.ok(lab.state.discovery.salvageTypes.includes('revolvingPulseBarrel'));

  const persisted = new BusterLabStorage({ storage }).load();
  assert.ok(persisted.moduleInstances.some((module) => module.instanceId === 'module-1'));
  assert.equal(getRecipeDiscoveryState('pulse', persisted.discovery).level, 'full');

  const forged = lab.fabricate({ id: 'free-module', moduleId: 'not-in-the-catalog', scrapCost: 0, parts: {} });
  assert.equal(forged.ok, false);
  assert.equal(forged.reason, 'unknown-recipe');
  assert.equal(lab.state.moduleInstances.some((module) => module.moduleId === 'not-in-the-catalog'), false);
});

test('Roll autosave keeps the originally loaded lab state reference live', () => {
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage });
  const loaded = lab.load();
  const roll = lab.createRollSalvageStorage();
  roll.addIdentifiedScrap(3);
  roll.addPart({ id: 'volatileOverloadCell', name: 'Volatile Overload Cell' });

  assert.equal(loaded, lab.state);
  assert.equal(loaded.rollSalvage.identifiedScrap, 3);
  assert.equal(loaded.rollSalvage.parts.volatileOverloadCell.quantity, 1);
  assert.ok(loaded.discovery.salvageTypes.includes('volatileOverloadCell'));
});

test('failed persistence leaves fabrication resources and physical inventory unchanged', () => {
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage });
  const state = lab.load();
  state.rollSalvage.identifiedScrap = 6;
  addPart(state, 'revolvingPulseBarrel');
  lab.save(state);

  storage.failWrites = true;
  const failed = lab.fabricate('pulse');
  assert.equal(failed.ok, false);
  assert.equal(lab.state.rollSalvage.identifiedScrap, 6);
  assert.equal(lab.state.rollSalvage.parts.revolvingPulseBarrel.quantity, 1);
  assert.equal(lab.state.moduleInstances.length, 1);
  assert.equal(lab.lastSaveSucceeded, false);
  assert.match(lab.lastWarning, /no resources were spent/i);
});

test('failed Roll autosave restores the detached stockpile instead of leaking a later write', () => {
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage });
  lab.load();
  const roll = lab.createRollSalvageStorage();
  storage.failWrites = true;

  assert.throws(() => roll.addIdentifiedScrap(5), /disk full/);
  assert.equal(roll.identifiedScrap, 0);
  assert.equal(lab.state.rollSalvage.identifiedScrap, 0);
  assert.equal(lab.lastSaveSucceeded, false);
});

test('second chassis costs 20 scrap, creates only an invalid Build B draft, and caps at two', () => {
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage });
  const state = lab.load();
  state.rollSalvage.identifiedScrap = 20;
  lab.save(state);

  const purchase = lab.purchaseSecondChassis();
  assert.equal(purchase.ok, true);
  assert.equal(lab.state.rollSalvage.identifiedScrap, 0);
  assert.equal(lab.state.chassisInstances.length, 2);
  assert.equal(lab.state.chassisBuilds.length, 1);
  assert.equal(lab.state.chassisDrafts.length, 2);
  const draftB = lab.state.chassisDrafts.find((draft) => draft.buildId === 'build-b');
  assert.equal(draftB.program.rootNodeId, null);
  assert.deepEqual(draftB.program.nodes, []);
  assert.deepEqual(lab.state.assignments.slots, { 1: null, 2: 'build-a' });

  const again = lab.purchaseSecondChassis();
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'chassis-limit');
  assert.equal(lab.state.chassisInstances.length, 2);
});

test('one physical module cannot be installed in two saved chassis builds', () => {
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage });
  const state = lab.load();
  state.rollSalvage.identifiedScrap = 26;
  addPart(state, 'revolvingPulseBarrel');
  lab.save(state);
  assert.equal(lab.fabricate('pulse').ok, true);
  assert.equal(lab.purchaseSecondChassis().ok, true);

  const duplicatePhysicalPart = {
    schemaVersion: 1,
    rulesetVersion: 'custom-buster-v0.1',
    buildId: 'build-b',
    chassisId: 'chassis-b',
    tuning: { power: 4, energy: 4, range: 4, rapid: 4 },
    program: {
      rootNodeId: 'b-root',
      nodes: [{
        nodeId: 'b-root',
        moduleId: 'pulseBolt',
        moduleInstanceId: 'module-pulse-starter',
      }],
      edges: [],
    },
  };
  const rejected = lab.saveBuild(duplicatePhysicalPart);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'invalid-build');
  assert.equal(lab.state.chassisBuilds.length, 1);

  const invalidTuning = structuredClone(duplicatePhysicalPart);
  invalidTuning.program.nodes[0].moduleInstanceId = 'module-1';
  invalidTuning.tuning = { power: 10, energy: 10, range: 10, rapid: 10 };
  const invalidCompilerBuild = lab.saveBuild(invalidTuning);
  assert.equal(invalidCompilerBuild.ok, false);
  assert.equal(invalidCompilerBuild.reason, 'invalid-build');
  assert.ok(invalidCompilerBuild.errors.some((error) => error.code === 'INVALID_TUNING_TOTAL'));

  duplicatePhysicalPart.program.nodes[0].moduleInstanceId = 'module-1';
  duplicatePhysicalPart.program.nodes.push({
    nodeId: 'builtin-impact',
    moduleId: 'onImpact',
    moduleInstanceId: null,
  }, {
    nodeId: 'builtin-pulse',
    moduleId: 'pulsePayload',
    moduleInstanceId: null,
  });
  duplicatePhysicalPart.program.edges.push(
    { from: 'b-root', port: 'next', to: 'builtin-impact' },
    { from: 'builtin-impact', port: 'child', to: 'builtin-pulse' },
  );
  const saved = lab.saveBuild(duplicatePhysicalPart);
  assert.equal(saved.ok, true);
  assert.equal(lab.state.chassisBuilds.length, 2);
  assert.deepEqual(new Set(lab.getClaimedModuleInstanceIds()), new Set([
    'module-pulse-starter',
    'module-1',
  ]));
  assert.equal(lab.assignBuildToSlot('build-b', 2).ok, true);
  assert.equal(lab.state.assignments.slots['2'], 'build-b');
  const duplicateAssignment = lab.setAssignments({
    slots: { 1: 'build-a', 2: 'build-a' },
    transientSelection: 'should-not-persist',
  });
  assert.equal(duplicateAssignment.ok, false);
  assert.equal(lab.state.assignments.slots['2'], 'build-b');
});

test('serialization whitelists durable fields, adopts old saves, and visibly quarantines corruption', async () => {
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage });
  const state = createDefaultBusterLabState();
  state.runtimeCompilerCache = { shouldNotPersist: true };
  state.transientWarning = 'not durable';
  state.assignments.transientSelection = 'not durable';
  state.megaCalibrations = {
    instances: [{
      instanceId: 'calibration-1',
      legacyType: 'powerRaiser',
      name: 'Power Calibration',
      bonuses: { power: 2 },
    }],
    slots: ['calibration-1', null, null, null],
    nextInstanceId: 2,
    revision: 7,
  };
  lab.save(state);

  const envelope = JSON.parse(storage.getItem(lab.storageKeys.main));
  assert.equal(envelope.storageVersion, 3);
  assert.equal(envelope.saveContextId, lab.saveContextId);
  assert.ok(envelope.revision > 0);
  assert.ok(envelope.writeId);
  const persisted = envelope.state;
  assert.deepEqual(Object.keys(persisted).sort(), [
    'armsGear',
    'assignments',
    'blueprints',
    'bossHunts',
    'chassisBuilds',
    'chassisDrafts',
    'chassisInstances',
    'chassisRevisions',
    'discovery',
    'fabricationHistory',
    'legacyBusterParts',
    'megaCalibrations',
    'migrations',
    'moduleInstances',
    'nextBlueprintId',
    'nextInstanceId',
    'rollSalvage',
    'version',
  ]);
  assert.equal(persisted.runtimeCompilerCache, undefined);
  assert.deepEqual(Object.keys(persisted.assignments), ['slots']);
  assert.deepEqual(persisted.megaCalibrations.slots, ['calibration-1', null, null, null]);
  assert.equal(persisted.megaCalibrations.revision, 7);

  storage.setItem(BUSTER_LAB_STORAGE_KEY, JSON.stringify({
    version: 0,
    roll: { identifiedScrap: 9, parts: {} },
  }));
  const migratedLab = new BusterLabStorage({ storage });
  migratedLab.load();
  const adoption = await migratedLab.adoptLegacyV1({ confirmed: true });
  assert.equal(adoption.ok, true);
  const migrated = adoption.state;
  assert.equal(migrated.version, 3);
  assert.equal(migrated.rollSalvage.identifiedScrap, 9);
  assert.equal(migrated.chassisInstances.length, 1);
  assert.equal(migrated.migrations.starterChassisGranted, true);

  storage.setItem(migratedLab.storageKeys.main, '{definitely-not-json');
  const corruptLab = new BusterLabStorage({ storage });
  const fallback = corruptLab.load();
  assert.equal(fallback.chassisInstances.length, 1);
  assert.match(corruptLab.lastWarning, /quarantined|couldn't read/i);
  assert.match(fallback.warning, /backup|safe starter lab/i);
  assert.equal(corruptLab.updateRollSalvage((roll) => roll.addIdentifiedScrap(1)).ok, true);
  assert.ok(storage.getItem(corruptLab.storageKeys.corrupt));

  const inconsistent = createDefaultBusterLabState();
  inconsistent.chassisInstances = [];
  storage.setItem(corruptLab.storageKeys.main, JSON.stringify(createBusterLabEnvelope({
    saveContextId: corruptLab.saveContextId,
    state: inconsistent,
    revision: 1,
  })));
  const inconsistentLab = new BusterLabStorage({ storage });
  const safeState = inconsistentLab.load();
  assert.equal(safeState.chassisInstances.length, 1);
  assert.match(inconsistentLab.lastWarning, /chassis-a is missing|quarantined/i);
});

test('unknown module ids preserve the source draft while quarantining its saved assignment', () => {
  const storage = new MemoryStorage();
  const futureState = createDefaultBusterLabState();
  futureState.moduleInstances[0].moduleId = 'futureArcOrb';
  futureState.moduleInstances[0].name = 'Future Arc Orb';
  futureState.chassisBuilds[0].program.nodes[0].moduleId = 'futureArcOrb';
  futureState.chassisDrafts[0].program.nodes[0].moduleId = 'futureArcOrb';
  futureState.assignments.slots['1'] = 'build-a';
  const lab = new BusterLabStorage({ storage });
  storage.setItem(lab.storageKeys.main, JSON.stringify(createBusterLabEnvelope({
    saveContextId: lab.saveContextId,
    state: futureState,
    revision: 1,
  })));
  const loaded = lab.load();
  assert.equal(loaded.chassisBuilds.some((build) => build.buildId === 'build-a'), false);
  assert.equal(
    loaded.chassisDrafts.find((build) => build.buildId === 'build-a').program.nodes[0].moduleId,
    'futureArcOrb',
  );
  assert.equal(loaded.moduleInstances[0].moduleId, 'futureArcOrb');
  assert.equal(loaded.assignments.slots['1'], null);
  assert.deepEqual(loaded.migrations.unknownModuleQuarantine, [{
    buildId: 'build-a',
    unknownModuleIds: ['futureArcOrb'],
  }]);
  assert.match(lab.lastWarning, /preserved the source as an invalid draft/i);

  const persisted = JSON.parse(storage.getItem(lab.storageKeys.main)).state;
  assert.equal(persisted.chassisDrafts[0].program.nodes[0].moduleId, 'futureArcOrb');
  assert.equal(persisted.assignments.slots['1'], null);
});

test('Boss Hunt state defaults to Revolving Fusillade and quarantines unknown saved selections', () => {
  assert.deepEqual(createDefaultBossHuntState(), {
    selectedBossProfileId: DEFAULT_BOSS_PROFILE_ID,
    activeExpeditionId: null,
    victoriesByProfile: {},
    recordedExpeditions: {},
    pendingRecoveries: [],
    fallbackFromProfileId: null,
    quarantinedRecoveryCount: 0,
    quarantinedEncounterProgressCount: 0,
  });
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage, saveContextId: 'boss-hunt-fallback' });
  const state = createDefaultBusterLabState();
  state.bossHunts.selectedBossProfileId = 'future-boss-profile';
  storage.setItem(lab.storageKeys.main, JSON.stringify(createBusterLabEnvelope({
    saveContextId: lab.saveContextId,
    state,
    revision: 1,
  })));
  const loaded = lab.load();
  assert.equal(loaded.bossHunts.selectedBossProfileId, DEFAULT_BOSS_PROFILE_ID);
  assert.equal(loaded.bossHunts.fallbackFromProfileId, 'future-boss-profile');
  assert.match(lab.lastWarning, /Revolving Fusillade was selected instead/i);
});

test('Boss Hunt selection locks for an expedition and unlocks without changing the repeat target', async () => {
  const lab = await BusterLabStorage.open({
    storage: new MemoryStorage(),
    lockManager: new MemoryLockManager(),
    saveContextId: 'boss-hunt-selection',
  });
  const selected = await lab.selectBossHunt('pursuitRegent');
  assert.equal(selected.ok, true);
  const expedition = createBossExpeditionSpec({
    id: 'hunt-selection-1',
    seed: 17,
    depth: 4,
    bossProfileId: 'pursuitRegent',
  });
  const locked = await lab.lockBossHuntForExpedition(expedition);
  assert.equal(locked.ok, true);
  assert.equal(lab.state.bossHunts.activeExpeditionId, expedition.id);
  assert.equal((await lab.selectBossHunt('rubyOpticOracle')).reason, 'expedition-active');
  const completed = await lab.completeBossExpedition(expedition.id, { outcome: 'defeat' });
  assert.equal(completed.ok, true);
  assert.equal(lab.state.bossHunts.activeExpeditionId, null);
  assert.equal(lab.state.bossHunts.recordedExpeditions[expedition.id].status, 'defeat');
  assert.equal(lab.state.bossHunts.selectedBossProfileId, 'pursuitRegent');
  assert.equal((await lab.lockBossHuntForExpedition(expedition)).reason, 'expedition-closed');
  assert.equal((await lab.selectBossHunt('rubyOpticOracle')).ok, true);
});

test('Boss Hunt locks persist an exact dungeon layout seed and reject non-identical replay specs', async () => {
  const lab = await BusterLabStorage.open({
    storage: new MemoryStorage(),
    lockManager: new MemoryLockManager(),
    saveContextId: 'boss-hunt-layout-seed',
  });
  const expedition = {
    ...createBossExpeditionSpec({
      id: 'layout-seed-expedition',
      seed: 818,
      depth: 3,
      bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    }),
    dungeonLayoutSeed: 'layout:authored-overworld-entry-818',
  };

  const locked = await lab.lockBossHuntForExpedition(expedition);
  assert.equal(locked.ok, true);
  assert.equal(locked.expedition.dungeonLayoutSeed, expedition.dungeonLayoutSeed);
  assert.equal(locked.expedition.dungeonFamilyId, 'industrial-v1');
  assert.equal(lab.getActiveBossExpedition().dungeonLayoutSeed, expedition.dungeonLayoutSeed);

  const idempotent = await lab.lockBossHuntForExpedition(expedition);
  assert.equal(idempotent.ok, true);
  assert.equal(idempotent.unchanged, true);
  assert.equal(idempotent.expedition.dungeonLayoutSeed, expedition.dungeonLayoutSeed);

  const mismatch = await lab.lockBossHuntForExpedition({
    ...expedition,
    dungeonLayoutSeed: 'layout:different-dungeon',
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'expedition-spec-mismatch');
  assert.equal(lab.getActiveBossExpedition().dungeonLayoutSeed, expedition.dungeonLayoutSeed);

  const retiredFamilyCompatibility = await lab.lockBossHuntForExpedition({
    ...expedition,
    dungeonFamilyId: 'magma-refinery-v1',
  });
  assert.equal(retiredFamilyCompatibility.ok, true);
  assert.equal(retiredFamilyCompatibility.unchanged, true);
  assert.equal(retiredFamilyCompatibility.expedition.dungeonFamilyId, 'industrial-v1');
});

test('Boss Hunt locks and restarts preserve the canonical augmentation identity', async () => {
  const storage = new MemoryStorage();
  const saveContextId = 'boss-hunt-augmentation-identity';
  const lab = await BusterLabStorage.open({
    storage,
    lockManager: new MemoryLockManager(),
    saveContextId,
  });
  const basePlanHash = 'base-plan:persistence-test';
  const augmentationPlanHash = 'augmentation-plan:persistence-test';
  const dungeonAugmentation = createAuthoredV4SaveIdentity({
    profileId: 'industrial-supplement-preview-v1',
    seed: 'augmentation-seed:persistence-test',
    basePlanHash,
    augmentationPlanHash,
    effectivePlanHash: computeEffectiveDungeonPlanHash(basePlanHash, augmentationPlanHash),
    themeRevisions: [{
      parentRegionId: 'industrial:main',
      themeId: 'industrial-v1',
      revision: '1',
      contentHash: 'industrial-content:test',
    }],
    progressionStateIds: ['reward:supplement:1'],
  });
  const expedition = {
    ...createBossExpeditionSpec({
      id: 'augmentation-identity-expedition',
      seed: 8181,
      depth: 3,
      bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    }),
    dungeonLayoutSeed: 'layout:augmentation-identity',
    dungeonAugmentation,
  };

  const locked = await lab.lockBossHuntForExpedition(expedition);
  assert.equal(locked.ok, true);
  assert.deepEqual(locked.expedition.dungeonAugmentation, dungeonAugmentation);
  assert.deepEqual(lab.getActiveBossExpedition().dungeonAugmentation, dungeonAugmentation);

  const restarted = await lab.restartActiveBossExpedition(expedition);
  assert.equal(restarted.ok, true);
  assert.deepEqual(restarted.expedition.dungeonAugmentation, dungeonAugmentation);

  const reloaded = new BusterLabStorage({ storage, saveContextId }).load()
    .bossHunts.recordedExpeditions[expedition.id];
  assert.deepEqual(reloaded.dungeonAugmentation, dungeonAugmentation);
});

test('active Boss Hunt persists augmentation mutable state without changing content identity', async () => {
  const storage = new MemoryStorage();
  const saveContextId = 'boss-hunt-augmentation-runtime-state';
  const lab = await BusterLabStorage.open({
    storage,
    lockManager: new MemoryLockManager(),
    saveContextId,
  });
  const basePlanHash = 'base-plan:runtime-state';
  const augmentationPlanHash = 'augmentation-plan:runtime-state';
  const dungeonAugmentation = createAuthoredV4SaveIdentity({
    profileId: 'industrial-supplement-preview-v4',
    seed: 'augmentation-seed:runtime-state',
    basePlanHash,
    augmentationPlanHash,
    effectivePlanHash: computeEffectiveDungeonPlanHash(basePlanHash, augmentationPlanHash),
    themeRevisions: [],
    progressionStateIds: ['network:encounter', 'network:shortcut'],
  });
  const expedition = {
    ...createBossExpeditionSpec({
      id: 'augmentation-runtime-state-expedition',
      seed: 8282,
      depth: 3,
      bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    }),
    dungeonLayoutSeed: 'layout:augmentation-runtime-state',
    dungeonAugmentation,
  };
  assert.equal((await lab.lockBossHuntForExpedition(expedition)).ok, true);

  const updatedIdentity = withDungeonAugmentationMutableState(dungeonAugmentation, {
    'network:encounter': true,
    'network:shortcut': 'available',
    'foreign:state': true,
  });
  const recorded = await lab.recordActiveBossExpeditionDungeonAugmentationState({
    expeditionId: expedition.id,
    dungeonAugmentation: updatedIdentity,
  });
  assert.equal(recorded.ok, true);
  assert.deepEqual(recorded.dungeonAugmentation.mutableState, {
    'network:encounter': true,
    'network:shortcut': 'available',
  });

  // A rebuild may present the same immutable content identity without the
  // mutable values; restart compatibility must not mistake that for new content.
  const restarted = await lab.restartActiveBossExpedition({
    ...expedition,
    dungeonAugmentation,
  });
  assert.equal(restarted.ok, true);
  assert.deepEqual(restarted.expedition.dungeonAugmentation.mutableState, {
    'network:encounter': true,
    'network:shortcut': 'available',
  });

  const reloaded = new BusterLabStorage({ storage, saveContextId }).load()
    .bossHunts.recordedExpeditions[expedition.id];
  assert.deepEqual(reloaded.dungeonAugmentation.mutableState, {
    'network:encounter': true,
    'network:shortcut': 'available',
  });

  const mismatched = createDungeonAugmentationSaveIdentity({
    ...dungeonAugmentation,
    augmentationPlanHash: 'augmentation-plan:different-content',
    effectivePlanHash: computeEffectiveDungeonPlanHash(
      basePlanHash,
      'augmentation-plan:different-content',
    ),
  });
  const rejected = await lab.recordActiveBossExpeditionDungeonAugmentationState({
    expeditionId: expedition.id,
    dungeonAugmentation: mismatched,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'expedition-spec-mismatch');
});

test('dungeon-content reset compare-and-swap rejects stale mutable augmentation state', async () => {
  const lab = await BusterLabStorage.open({
    storage: new MemoryStorage(),
    lockManager: new MemoryLockManager(),
    saveContextId: 'dungeon-content-reset-mutable-state-cas',
  });
  const basePlanHash = 'base-plan:reset-mutable-state-cas';
  const augmentationPlanHash = 'augmentation-plan:reset-mutable-state-cas';
  const initialIdentity = createAuthoredV4SaveIdentity({
    profileId: 'industrial-supplement-preview-v4',
    seed: 'augmentation-seed:reset-mutable-state-cas',
    basePlanHash,
    augmentationPlanHash,
    effectivePlanHash: computeEffectiveDungeonPlanHash(basePlanHash, augmentationPlanHash),
    themeRevisions: [],
    progressionStateIds: ['network:shortcut'],
  });
  const expedition = {
    ...createBossExpeditionSpec({
      id: 'dungeon-content-reset-mutable-state-cas-expedition',
      seed: 8383,
      depth: 3,
      bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    }),
    dungeonLayoutSeed: 'layout:dungeon-content-reset-mutable-state-cas',
    dungeonAugmentation: initialIdentity,
  };
  assert.equal((await lab.lockBossHuntForExpedition(expedition)).ok, true);

  const currentIdentity = withDungeonAugmentationMutableState(initialIdentity, {
    'network:shortcut': true,
  });
  assert.equal((await lab.recordActiveBossExpeditionDungeonAugmentationState({
    expeditionId: expedition.id,
    dungeonAugmentation: currentIdentity,
  })).ok, true);

  const resetSpec = {
    expeditionId: expedition.id,
    bossProfileId: expedition.bossProfileId,
    seed: expedition.seed,
    depth: expedition.depth,
    dungeonLayoutSeed: expedition.dungeonLayoutSeed,
    dungeonFamilyId: 'industrial-v1',
    dungeonAugmentation: null,
  };
  const staleReset = await lab.resetActiveBossExpeditionDungeonContent({
    ...resetSpec,
    expectedDungeonAugmentation: initialIdentity,
  });
  assert.equal(staleReset.ok, false);
  assert.equal(staleReset.reason, 'expedition-spec-mismatch');
  assert.deepEqual(
    lab.getActiveBossExpedition().dungeonAugmentation,
    currentIdentity,
  );

  const currentReset = await lab.resetActiveBossExpeditionDungeonContent({
    ...resetSpec,
    expectedDungeonAugmentation: currentIdentity,
  });
  assert.equal(currentReset.ok, true);
  assert.equal(currentReset.contentReset, true);
  assert.deepEqual(currentReset.previousDungeonAugmentation, currentIdentity);
  assert.equal(currentReset.dungeonAugmentation, null);
});

test('legacy active Boss Hunts deterministically migrate and persist a restart layout seed', () => {
  const storage = new MemoryStorage();
  const saveContextId = 'legacy-active-layout-migration';
  const lab = new BusterLabStorage({ storage, saveContextId });
  const state = createDefaultBusterLabState();
  const expeditionId = 'legacy-active-expedition';
  state.bossHunts.activeExpeditionId = expeditionId;
  state.bossHunts.recordedExpeditions[expeditionId] = {
    schemaVersion: 2,
    expeditionId,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    dungeonFamilyId: 'magma-refinery-v1',
    seed: 1919,
    depth: 2,
    status: 'active',
    startedAt: new Date(0).toISOString(),
    completedAt: null,
    reward: null,
  };
  storage.setItem(lab.storageKeys.main, JSON.stringify(createBusterLabEnvelope({
    saveContextId,
    state,
    revision: 1,
  })));

  const expectedLayoutSeed = `layout:resume:${expeditionId}`;
  const loaded = lab.load();
  assert.equal(
    loaded.bossHunts.recordedExpeditions[expeditionId].dungeonLayoutSeed,
    expectedLayoutSeed,
  );
  assert.equal(loaded.bossHunts.recordedExpeditions[expeditionId].dungeonFamilyId, 'industrial-v1');
  assert.equal(
    loaded.bossHunts.recordedExpeditions[expeditionId].dungeonFamilyFallback?.reason,
    'retired-dungeon-family',
  );
  assert.equal(
    loaded.bossHunts.recordedExpeditions[expeditionId].dungeonAugmentation,
    null,
  );
  const persisted = JSON.parse(storage.getItem(lab.storageKeys.main));
  assert.equal(
    persisted.state.bossHunts.recordedExpeditions[expeditionId].dungeonLayoutSeed,
    expectedLayoutSeed,
  );
  const reloaded = new BusterLabStorage({ storage, saveContextId }).load();
  assert.equal(
    reloaded.bossHunts.recordedExpeditions[expeditionId].dungeonLayoutSeed,
    expectedLayoutSeed,
  );
  assert.equal(
    reloaded.bossHunts.recordedExpeditions[expeditionId].dungeonFamilyFallback?.requestedDungeonFamilyId,
    'magma-refinery-v1',
  );
});

test('malformed committed dungeon augmentation stays incompatible until reset or abandon', async () => {
  const storage = new MemoryStorage();
  const saveContextId = 'invalid-committed-dungeon-augmentation';
  const lab = new BusterLabStorage({ storage, saveContextId });
  const state = createDefaultBusterLabState();
  const expeditionId = 'invalid-augmentation-expedition';
  state.bossHunts.activeExpeditionId = expeditionId;
  state.bossHunts.recordedExpeditions[expeditionId] = {
    schemaVersion: 2,
    expeditionId,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    seed: 919,
    dungeonLayoutSeed: 'layout:invalid-augmentation',
    dungeonAugmentation: {
      schema: 'ruindivex-dungeon-augmentation-save-identity/v1',
      profileId: 'industrial-supplement-preview-v1',
      // Deliberately missing the committed hashes and theme revisions.
    },
    depth: 2,
    status: 'active',
    startedAt: new Date(0).toISOString(),
    completedAt: null,
    reward: null,
  };
  storage.setItem(lab.storageKeys.main, JSON.stringify(createBusterLabEnvelope({
    saveContextId,
    state,
    revision: 1,
  })));

  const loaded = lab.load();
  const committed = loaded.bossHunts.recordedExpeditions[expeditionId];
  assert.notEqual(committed.dungeonAugmentation, null);
  assert.equal(committed.dungeonAugmentation.status, 'incompatible-content');
  assert.equal(committed.dungeonAugmentation.resetOrAbandonRequired, true);
  assert.equal(
    committed.dungeonAugmentation.reason,
    'saved-augmentation-identity-invalid',
  );

  const restart = await lab.restartActiveBossExpedition({
    expeditionId,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    dungeonLayoutSeed: committed.dungeonLayoutSeed,
  });
  assert.equal(restart.ok, false);
  assert.equal(restart.reason, 'incompatible-dungeon-augmentation');
  assert.equal(restart.status, 'incompatible-content');
  assert.equal(restart.resetOrAbandonRequired, true);
  assert.equal(lab.getActiveBossExpedition().dungeonAugmentation.resetOrAbandonRequired, true);

  const reloaded = new BusterLabStorage({ storage, saveContextId }).load()
    .bossHunts.recordedExpeditions[expeditionId];
  assert.equal(reloaded.dungeonAugmentation.status, 'incompatible-content');
  assert.equal(reloaded.dungeonAugmentation.resetOrAbandonRequired, true);

  const reset = await lab.resetActiveBossExpeditionDungeonContent({
    expeditionId,
    bossProfileId: committed.bossProfileId,
    seed: committed.seed,
    depth: committed.depth,
    dungeonLayoutSeed: committed.dungeonLayoutSeed,
    dungeonFamilyId: committed.dungeonFamilyId,
    expectedDungeonAugmentation: committed.dungeonAugmentation,
    // This explicit user-selected reset targets the currently installed base
    // content. Null is intentional here, not save sanitization fallback.
    dungeonAugmentation: null,
  });
  assert.equal(reset.ok, true);
  assert.equal(reset.contentReset, true);
  assert.equal(reset.expedition.expeditionId, expeditionId);
  assert.equal(reset.expedition.status, 'active');
  assert.equal(reset.expedition.dungeonAugmentation, null);
  assert.equal(reset.expedition.restartCount, 1);
  assert.equal(lab.getActiveBossExpedition().dungeonAugmentation, null);
  assert.equal(
    new BusterLabStorage({ storage, saveContextId }).load()
      .bossHunts.recordedExpeditions[expeditionId].dungeonAugmentation,
    null,
  );
});

test('dungeon-content reset requires exact prior identity and a canonical replacement', async () => {
  const lab = await BusterLabStorage.open({
    storage: new MemoryStorage(),
    lockManager: new MemoryLockManager(),
    saveContextId: 'dungeon-content-reset-identity-guard',
  });
  const basePlanHash = 'base-plan:content-reset';
  const augmentationPlanHash = 'augmentation-plan:content-reset';
  const dungeonAugmentation = createAuthoredV4SaveIdentity({
    profileId: 'industrial-supplement-preview-v1',
    seed: 'augmentation-seed:content-reset',
    basePlanHash,
    augmentationPlanHash,
    effectivePlanHash: computeEffectiveDungeonPlanHash(basePlanHash, augmentationPlanHash),
    themeRevisions: [],
    progressionStateIds: [],
  });
  const expedition = {
    ...createBossExpeditionSpec({
      id: 'dungeon-content-reset-identity-guard-expedition',
      seed: 921,
      depth: 2,
      bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    }),
    dungeonLayoutSeed: 'layout:dungeon-content-reset-identity-guard',
    dungeonAugmentation,
  };
  assert.equal((await lab.lockBossHuntForExpedition(expedition)).ok, true);

  const mismatch = await lab.resetActiveBossExpeditionDungeonContent({
    expeditionId: expedition.id,
    bossProfileId: expedition.bossProfileId,
    seed: expedition.seed,
    depth: expedition.depth,
    dungeonLayoutSeed: expedition.dungeonLayoutSeed,
    dungeonFamilyId: 'industrial-v1',
    expectedDungeonAugmentation: null,
    dungeonAugmentation: null,
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'expedition-spec-mismatch');
  assert.deepEqual(lab.getActiveBossExpedition().dungeonAugmentation, dungeonAugmentation);

  const invalidReplacement = await lab.resetActiveBossExpeditionDungeonContent({
    expeditionId: expedition.id,
    bossProfileId: expedition.bossProfileId,
    seed: expedition.seed,
    depth: expedition.depth,
    dungeonLayoutSeed: expedition.dungeonLayoutSeed,
    dungeonFamilyId: 'industrial-v1',
    expectedDungeonAugmentation: dungeonAugmentation,
    dungeonAugmentation: { schema: dungeonAugmentation.schema },
  });
  assert.equal(invalidReplacement.ok, false);
  assert.equal(invalidReplacement.reason, 'invalid-dungeon-augmentation');
  assert.deepEqual(lab.getActiveBossExpedition().dungeonAugmentation, dungeonAugmentation);
});

test('new expedition locks reject every present malformed augmentation identity', async () => {
  const lab = await BusterLabStorage.open({
    storage: new MemoryStorage(),
    lockManager: new MemoryLockManager(),
    saveContextId: 'invalid-new-dungeon-augmentation',
  });
  const baseSpec = createBossExpeditionSpec({
    id: 'invalid-new-augmentation-expedition',
    seed: 920,
    depth: 2,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });
  for (const dungeonAugmentation of ['', false, {}, {
    schema: 'ruindivex-dungeon-augmentation-save-identity/v1',
  }]) {
    const result = await lab.lockBossHuntForExpedition({
      ...baseSpec,
      dungeonAugmentation,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-dungeon-augmentation');
  }
  assert.equal(lab.getActiveBossExpedition(), null);
});

test('restarting an active Boss Hunt atomically resets progress and preserves its exact identity', async () => {
  const storage = new MemoryStorage();
  const lab = await BusterLabStorage.open({
    storage,
    lockManager: new MemoryLockManager(),
    saveContextId: 'boss-hunt-restart',
  });
  assert.equal((await lab.selectBossHunt('ascensionEngine')).ok, true);
  const expedition = {
    ...createBossExpeditionSpec({
      id: 'restart-ascension-expedition',
      seed: 1441,
      depth: 5,
      bossProfileId: 'ascensionEngine',
    }),
    dungeonLayoutSeed: 'layout:restart-ascension-golden',
  };
  assert.equal((await lab.lockBossHuntForExpedition(expedition)).ok, true);
  assert.equal((await lab.recordBossCheckpoint({
    expeditionId: expedition.id,
    bossProfileId: 'ascensionEngine',
    securedCheckpointIndex: 1,
    securedCheckpointId: 'ascensionCheckpoint:compressionFoundry',
    brokenSealIndex: 0,
  })).ok, true);

  const before = lab.getActiveBossExpedition();
  const revisionBeforeMismatch = lab.revision;
  const wrongId = await lab.restartActiveBossExpedition({
    ...expedition,
    id: 'another-expedition',
  });
  assert.equal(wrongId.reason, 'active-expedition-mismatch');
  const wrongSpec = await lab.restartActiveBossExpedition({
    ...expedition,
    seed: Number(expedition.seed) + 1,
  });
  assert.equal(wrongSpec.reason, 'expedition-spec-mismatch');
  assert.equal(lab.revision, revisionBeforeMismatch);
  assert.deepEqual(lab.getActiveBossExpedition().encounterProgress, before.encounterProgress);

  const restarted = await lab.restartActiveBossExpedition(expedition);
  assert.equal(restarted.ok, true);
  assert.deepEqual(restarted.expedition.encounterProgress, createAscensionEngineEncounterProgress(0));
  assert.equal(restarted.expedition.restartCount, 1);
  assert.equal(typeof restarted.expedition.restartedAt, 'string');
  for (const field of ['expeditionId', 'bossProfileId', 'seed', 'depth', 'dungeonLayoutSeed']) {
    assert.equal(restarted.expedition[field], before[field], field);
    assert.equal(lab.getActiveBossExpedition()[field], before[field], field);
  }
  assert.equal(lab.state.bossHunts.activeExpeditionId, expedition.id);
  assert.deepEqual(
    lab.getActiveBossExpedition().encounterProgress,
    createAscensionEngineEncounterProgress(0),
  );
  const reloaded = new BusterLabStorage({
    storage,
    saveContextId: 'boss-hunt-restart',
  }).load().bossHunts.recordedExpeditions[expedition.id];
  assert.equal(reloaded.restartCount, 1);
  assert.equal(reloaded.restartedAt, restarted.expedition.restartedAt);
  assert.equal(reloaded.dungeonLayoutSeed, expedition.dungeonLayoutSeed);
  assert.deepEqual(reloaded.encounterProgress, createAscensionEngineEncounterProgress(0));
});

test('Ascension checkpoints are exact-next, idempotent, and final victory commits reward atomically', async () => {
  const storage = new MemoryStorage();
  const lab = await BusterLabStorage.open({
    storage,
    lockManager: new MemoryLockManager(),
    saveContextId: 'ascension-checkpoint-contract',
  });
  assert.equal((await lab.selectBossHunt('ascensionEngine')).ok, true);
  const expedition = createBossExpeditionSpec({
    id: 'ascension-checkpoint-expedition',
    seed: 909,
    depth: 5,
    bossProfileId: 'ascensionEngine',
  });
  const locked = await lab.lockBossHuntForExpedition(expedition);
  assert.equal(locked.ok, true);
  assert.deepEqual(
    locked.expedition.encounterProgress,
    createAscensionEngineEncounterProgress(0),
  );
  assert.equal(
    locked.expedition.encounterProgress.schemaVersion,
    ASCENSION_ENGINE_PROGRESS_SCHEMA_VERSION,
  );
  const initialRestart = await lab.restartActiveBossExpedition(locked.expedition);
  assert.equal(initialRestart.ok, true);
  assert.equal(initialRestart.expedition.restartCount, 1);
  assert.equal(createAscensionEngineEncounterProgress('1'), null);
  assert.equal(createAscensionEngineEncounterProgress(1.9), null);
  assert.equal((await lab.recordBossCheckpoint({
    expeditionId: expedition.id,
    bossProfileId: 'ascensionEngine',
    securedCheckpointIndex: '1',
    securedCheckpointId: 'ascensionCheckpoint:compressionFoundry',
    brokenSealIndex: 0,
  })).reason, 'invalid-checkpoint');
  assert.equal((await lab.recordBossCheckpoint({
    expeditionId: expedition.id,
    bossProfileId: 'ascensionEngine',
    securedCheckpointIndex: 1,
    securedCheckpointId: 'ascensionCheckpoint:compressionFoundry',
    brokenSealIndex: '0',
  })).reason, 'checkpoint-contract-mismatch');

  const skipped = await lab.recordBossCheckpoint({
    expeditionId: expedition.id,
    bossProfileId: 'ascensionEngine',
    securedCheckpointIndex: 2,
    securedCheckpointId: 'ascensionCheckpoint:brokenElevatorSpine',
    brokenSealIndex: 1,
  });
  assert.equal(skipped.ok, false);
  assert.equal(skipped.reason, 'checkpoint-out-of-order');

  const first = await lab.recordBossCheckpoint({
    expeditionId: expedition.id,
    bossProfileId: 'ascensionEngine',
    securedCheckpointIndex: 1,
    securedCheckpointId: 'ascensionCheckpoint:compressionFoundry',
    brokenSealIndex: 0,
  });
  assert.equal(first.ok, true);
  assert.deepEqual(first.encounterProgress.brokenSealIds, [
    'ascensionSeal:compressionFoundry',
  ]);
  const firstRevision = lab.revision;
  const duplicate = await lab.recordBossCheckpoint({
    expeditionId: expedition.id,
    bossProfileId: 'ascensionEngine',
    securedCheckpointIndex: 1,
    securedCheckpointId: 'ascensionCheckpoint:compressionFoundry',
    brokenSealIndex: 0,
  });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.idempotent, true);
  assert.equal(lab.revision, firstRevision);

  const prematureVictory = await lab.recordAscensionBossVictory({ expeditionId: expedition.id });
  assert.equal(prematureVictory.ok, false);
  assert.equal(prematureVictory.reason, 'final-checkpoint-not-secured');

  for (const checkpoint of [
    {
      securedCheckpointIndex: 2,
      securedCheckpointId: 'ascensionCheckpoint:brokenElevatorSpine',
      brokenSealIndex: 1,
    },
    {
      securedCheckpointIndex: 3,
      securedCheckpointId: 'ascensionCheckpoint:suspendedMachinerySea',
      brokenSealIndex: 2,
    },
  ]) {
    assert.equal((await lab.recordBossCheckpoint({
      expeditionId: expedition.id,
      bossProfileId: 'ascensionEngine',
      ...checkpoint,
    })).ok, true);
  }
  const persistedProgress = lab.state.bossHunts.recordedExpeditions[expedition.id].encounterProgress;
  assert.deepEqual(persistedProgress.brokenSealIds, [
    'ascensionSeal:compressionFoundry',
    'ascensionSeal:brokenElevatorSpine',
    'ascensionSeal:suspendedMachinerySea',
  ]);

  storage.failWrites = true;
  const failedVictory = await lab.recordAscensionBossVictory({ expeditionId: expedition.id });
  assert.equal(failedVictory.ok, false);
  assert.equal(lab.state.bossHunts.recordedExpeditions[expedition.id].status, 'active');
  assert.equal(lab.state.bossHunts.pendingRecoveries.length, 0);
  assert.deepEqual(lab.state.bossHunts.victoriesByProfile, {});

  storage.failWrites = false;
  const victory = await lab.recordAscensionBossVictory({ expeditionId: expedition.id });
  assert.equal(victory.ok, true);
  assert.equal(victory.firstClear, true);
  assert.equal(victory.reward.materialId, 'perfectedCompressionGreave');
  assert.equal(victory.expedition.encounterProgress.securedCheckpointIndex, 3);
  assert.equal(victory.expedition.dungeonLayoutSeed, locked.expedition.dungeonLayoutSeed);
  assert.equal(victory.expedition.restartCount, 1);
  assert.equal(victory.expedition.restartedAt, initialRestart.expedition.restartedAt);
  assert.equal(lab.state.bossHunts.activeExpeditionId, expedition.id);
  assert.equal(lab.state.bossHunts.pendingRecoveries[0].part.id, 'perfectedCompressionGreave');

  const resumedLab = await BusterLabStorage.open({
    storage,
    lockManager: new MemoryLockManager(),
    saveContextId: 'ascension-checkpoint-contract',
  });
  const reloaded = resumedLab.state;
  assert.equal(reloaded.bossHunts.activeExpeditionId, expedition.id);
  assert.equal(reloaded.bossHunts.recordedExpeditions[expedition.id].schemaVersion, 2);
  assert.equal(reloaded.bossHunts.recordedExpeditions[expedition.id].restartCount, 1);
  assert.equal(
    reloaded.bossHunts.recordedExpeditions[expedition.id].restartedAt,
    initialRestart.expedition.restartedAt,
  );
  assert.deepEqual(
    reloaded.bossHunts.recordedExpeditions[expedition.id].encounterProgress,
    persistedProgress,
  );
  assert.equal((await resumedLab.selectBossHunt(DEFAULT_BOSS_PROFILE_ID)).reason, 'expedition-active');

  const unresolvedVictory = resumedLab.getActiveBossExpedition();
  const restartedVictory = await resumedLab.restartActiveBossExpedition({
    id: unresolvedVictory.expeditionId,
    bossProfileId: unresolvedVictory.bossProfileId,
    seed: unresolvedVictory.seed,
    depth: unresolvedVictory.depth,
    dungeonLayoutSeed: unresolvedVictory.dungeonLayoutSeed,
  });
  assert.equal(restartedVictory.ok, true);
  assert.equal(restartedVictory.expedition.status, 'victory');
  assert.deepEqual(restartedVictory.expedition.reward, unresolvedVictory.reward);
  assert.deepEqual(restartedVictory.expedition.encounterProgress, persistedProgress);
  assert.equal(restartedVictory.expedition.victoryIndex, unresolvedVictory.victoryIndex);
  assert.equal(restartedVictory.expedition.completedAt, unresolvedVictory.completedAt);

  const release = await resumedLab.completeBossExpedition(expedition.id, { outcome: 'abandoned' });
  assert.equal(release.ok, true);
  assert.equal(resumedLab.state.bossHunts.activeExpeditionId, null);
  assert.equal(resumedLab.state.bossHunts.recordedExpeditions[expedition.id].status, 'victory');
  assert.deepEqual(resumedLab.state.bossHunts.recordedExpeditions[expedition.id].reward, victory.reward);
  assert.equal((await resumedLab.selectBossHunt(DEFAULT_BOSS_PROFILE_ID)).ok, true);
});

test('generic Boss victory cannot convert Ascension overload into a guaranteed repeat recovery', async () => {
  const saveContextId = 'ascension-overload-coercion-14';
  const lab = await BusterLabStorage.open({
    storage: new MemoryStorage(),
    lockManager: new MemoryLockManager(),
    saveContextId,
  });
  assert.equal((await lab.selectBossHunt('ascensionEngine')).ok, true);
  const lockAndSecureSummit = async (expeditionId, seed) => {
    const spec = createBossExpeditionSpec({
      id: expeditionId,
      seed,
      depth: 5,
      bossProfileId: 'ascensionEngine',
    });
    assert.equal((await lab.lockBossHuntForExpedition(spec)).ok, true);
    for (const checkpoint of [
      [1, 'ascensionCheckpoint:compressionFoundry', 0],
      [2, 'ascensionCheckpoint:brokenElevatorSpine', 1],
      [3, 'ascensionCheckpoint:suspendedMachinerySea', 2],
    ]) {
      assert.equal((await lab.recordBossCheckpoint({
        expeditionId,
        bossProfileId: 'ascensionEngine',
        securedCheckpointIndex: checkpoint[0],
        securedCheckpointId: checkpoint[1],
        brokenSealIndex: checkpoint[2],
      })).ok, true);
    }
  };

  await lockAndSecureSummit('ascension-overload-first-clear', 10);
  const first = await lab.recordBossVictory({
    expeditionId: 'ascension-overload-first-clear',
    bossProfileId: 'ascensionEngine',
    signaturePartOverloaded: true,
  });
  assert.equal(first.ok, true);
  assert.equal(first.reward.reason, 'first-clear');
  assert.equal(first.expedition.signaturePartOverloaded, false);
  assert.equal((await lab.completeBossExpedition(
    'ascension-overload-first-clear',
    { outcome: 'abandoned' },
  )).ok, true);

  await lockAndSecureSummit('ascension-overload-repeat', 11);
  const repeatRoll = getBossHuntRewardRoll({
    saveContextId,
    bossProfileId: 'ascensionEngine',
    victoryIndex: 2,
  });
  assert.ok(repeatRoll >= BOSS_HUNT_REPEAT_REWARD_CHANCE);
  const repeat = await lab.recordBossVictory({
    expeditionId: 'ascension-overload-repeat',
    bossProfileId: 'ascensionEngine',
    signaturePartOverloaded: true,
  });
  assert.equal(repeat.ok, true);
  assert.equal(repeat.rewardQueued, false);
  assert.equal(repeat.reward.reason, 'repeat-miss');
  assert.equal(repeat.expedition.signaturePartOverloaded, false);
});

test('Boss Hunt loading quarantines corrupt recovery rows and reconstructs the committed reward', () => {
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage, saveContextId: 'boss-hunt-recovery-quarantine' });
  const state = createDefaultBusterLabState();
  const expeditionId = 'corrupt-recovery-expedition';
  const recoveryId = `boss-recovery:${expeditionId}`;
  state.bossHunts.recordedExpeditions[expeditionId] = {
    expeditionId,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    seed: 2,
    depth: 1,
    status: 'victory',
    startedAt: null,
    completedAt: new Date(0).toISOString(),
    victoryIndex: 1,
    signaturePartOverloaded: false,
    reward: {
      eligible: true,
      queued: true,
      recoveryId,
      deterministicRoll: 0.2,
      reason: 'first-clear',
      identified: false,
    },
  };
  state.bossHunts.victoriesByProfile[DEFAULT_BOSS_PROFILE_ID] = 1;
  state.bossHunts.pendingRecoveries.push({
    recoveryId,
    expeditionId,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    victoryIndex: 1,
    quantity: 1,
    part: { id: 'rubyOpticLens', name: 'Injected wrong material' },
  });
  storage.setItem(lab.storageKeys.main, JSON.stringify(createBusterLabEnvelope({
    saveContextId: lab.saveContextId,
    state,
    revision: 1,
  })));

  const loaded = lab.load();
  assert.equal(loaded.bossHunts.pendingRecoveries.length, 1);
  assert.equal(
    loaded.bossHunts.pendingRecoveries[0].part.id,
    resolveBossRewardMaterial(DEFAULT_BOSS_PROFILE_ID).id,
  );
  assert.equal(loaded.bossHunts.quarantinedRecoveryCount, 1);
  assert.match(lab.lastWarning, /quarantined 1 Boss Recovery/i);
  assert.equal(loaded.rollSalvage.parts.rubyOpticLens, undefined);
});

test('explicit unknown Boss reward ids quarantine the expedition instead of migrating to a different material', () => {
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage, saveContextId: 'boss-hunt-unknown-recorded-reward' });
  const state = createDefaultBusterLabState();
  const expeditionId = 'unknown-recorded-reward-expedition';
  state.bossHunts.victoriesByProfile[DEFAULT_BOSS_PROFILE_ID] = 1;
  state.bossHunts.recordedExpeditions[expeditionId] = {
    expeditionId,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    seed: 17,
    depth: 3,
    status: 'victory',
    completedAt: new Date(0).toISOString(),
    victoryIndex: 1,
    signaturePartOverloaded: false,
    reward: {
      eligible: true,
      queued: true,
      recoveryId: `boss-recovery:${expeditionId}`,
      deterministicRoll: 0.1,
      reason: 'first-clear',
      identified: false,
      materialId: 'futureUnknownBossMaterial',
    },
  };
  state.bossHunts.pendingRecoveries.push({
    recoveryId: `boss-recovery:${expeditionId}`,
    expeditionId,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    victoryIndex: 1,
    quantity: 1,
    part: { id: 'futureUnknownBossMaterial', name: 'Unknown future material' },
  });
  storage.setItem(lab.storageKeys.main, JSON.stringify(createBusterLabEnvelope({
    saveContextId: lab.saveContextId,
    state,
    revision: 1,
  })));

  const loaded = lab.load();
  assert.equal(loaded.bossHunts.recordedExpeditions[expeditionId], undefined);
  assert.equal(loaded.bossHunts.pendingRecoveries.length, 0);
  assert.equal(loaded.bossHunts.quarantinedRecoveryCount, 1);
  assert.equal(loaded.bossHunts.victoriesByProfile[DEFAULT_BOSS_PROFILE_ID], 1);
  assert.match(lab.lastWarning, /quarantined 1 Boss Recovery/i);
});

test('malformed Ascension Boss progress is quarantined visibly and its active expedition is abandoned', async () => {
  const storage = new MemoryStorage();
  const saveContextId = 'ascension-progress-quarantine';
  const lab = new BusterLabStorage({ storage, saveContextId });
  const state = createDefaultBusterLabState();
  const expeditionId = 'corrupt-ascension-progress-expedition';
  state.bossHunts.selectedBossProfileId = 'ascensionEngine';
  state.bossHunts.activeExpeditionId = expeditionId;
  state.bossHunts.recordedExpeditions[expeditionId] = {
    expeditionId,
    bossProfileId: 'ascensionEngine',
    seed: 91,
    depth: 5,
    status: 'active',
    startedAt: new Date(0).toISOString(),
    encounterProgress: {
      ...createAscensionEngineEncounterProgress(2),
      revision: createAscensionEngineEncounterProgress(2).revision + 1,
    },
    reward: null,
  };
  storage.setItem(lab.storageKeys.main, JSON.stringify(createBusterLabEnvelope({
    saveContextId,
    state,
    revision: 1,
  })));

  const loaded = lab.load();
  const expedition = loaded.bossHunts.recordedExpeditions[expeditionId];
  assert.equal(expedition.status, 'abandoned');
  assert.equal(expedition.encounterProgress, null);
  assert.equal(expedition.encounterProgressQuarantined, true);
  assert.equal(loaded.bossHunts.activeExpeditionId, null);
  assert.equal(loaded.bossHunts.quarantinedEncounterProgressCount, 1);
  assert.match(lab.lastWarning, /quarantined 1 invalid Ascension checkpoint record/i);
  const blocked = await lab.recordBossCheckpoint({
    expeditionId,
    bossProfileId: 'ascensionEngine',
    securedCheckpointIndex: 1,
    securedCheckpointId: 'ascensionCheckpoint:compressionFoundry',
    brokenSealIndex: 0,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'expedition-progress-quarantined');

  const reloaded = new BusterLabStorage({ storage, saveContextId }).load();
  assert.equal(reloaded.bossHunts.quarantinedEncounterProgressCount, 1);
  assert.equal(
    reloaded.bossHunts.recordedExpeditions[expeditionId].encounterProgressQuarantined,
    true,
  );
});

test('missing and null active Ascension Boss progress are quarantined instead of becoming checkpoint zero', () => {
  for (const variant of ['missing', 'null']) {
    const storage = new MemoryStorage();
    const saveContextId = `ascension-${variant}-progress-quarantine`;
    const lab = new BusterLabStorage({ storage, saveContextId });
    const state = createDefaultBusterLabState();
    const expeditionId = `${variant}-ascension-progress-expedition`;
    const record = {
      expeditionId,
      bossProfileId: 'ascensionEngine',
      seed: 117,
      depth: 5,
      status: 'active',
      startedAt: new Date(0).toISOString(),
      reward: null,
    };
    if (variant === 'null') record.encounterProgress = null;
    state.bossHunts.selectedBossProfileId = 'ascensionEngine';
    state.bossHunts.activeExpeditionId = expeditionId;
    state.bossHunts.recordedExpeditions[expeditionId] = record;
    storage.setItem(lab.storageKeys.main, JSON.stringify(createBusterLabEnvelope({
      saveContextId,
      state,
      revision: 1,
    })));

    const loaded = lab.load();
    assert.equal(loaded.bossHunts.activeExpeditionId, null, variant);
    assert.equal(loaded.bossHunts.quarantinedEncounterProgressCount, 1, variant);
    assert.deepEqual(
      {
        status: loaded.bossHunts.recordedExpeditions[expeditionId].status,
        encounterProgress: loaded.bossHunts.recordedExpeditions[expeditionId].encounterProgress,
        quarantined: loaded.bossHunts.recordedExpeditions[expeditionId].encounterProgressQuarantined,
      },
      { status: 'abandoned', encounterProgress: null, quarantined: true },
      variant,
    );
    const reloaded = new BusterLabStorage({ storage, saveContextId }).load();
    assert.equal(reloaded.bossHunts.quarantinedEncounterProgressCount, 1, variant);
  }
});

test('Boss victories are idempotent, guarantee first clears, and deterministically resolve repeats', async () => {
  const storage = new MemoryStorage();
  const lab = await BusterLabStorage.open({
    storage,
    lockManager: new MemoryLockManager(),
    saveContextId: 'boss-hunt-rewards',
  });
  const firstSpec = createBossExpeditionSpec({
    id: 'hunt-reward-1',
    seed: 1,
    depth: 5,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });
  assert.equal((await lab.lockBossHuntForExpedition(firstSpec)).ok, true);
  const first = await lab.recordBossVictory({
    expeditionId: firstSpec.id,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    signaturePartOverloaded: false,
  });
  assert.equal(first.ok, true);
  assert.equal(first.firstClear, true);
  assert.equal(first.rewardQueued, true);
  assert.equal(first.reward.reason, 'first-clear');
  assert.equal(lab.state.bossHunts.victoriesByProfile[DEFAULT_BOSS_PROFILE_ID], 1);
  assert.equal(lab.state.bossHunts.pendingRecoveries.length, 1);

  const revisionAfterFirst = lab.revision;
  const duplicate = await lab.recordBossVictory({
    expeditionId: firstSpec.id,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    signaturePartOverloaded: true,
  });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.idempotent, true);
  assert.equal(lab.revision, revisionAfterFirst);
  assert.equal(lab.state.bossHunts.victoriesByProfile[DEFAULT_BOSS_PROFILE_ID], 1);
  assert.equal(lab.state.bossHunts.pendingRecoveries.length, 1);

  const identifiedFirst = await lab.identifyBossRecoveries();
  const featured = resolveBossFeaturedMaterial(DEFAULT_BOSS_PROFILE_ID);
  assert.equal(identifiedFirst.ok, true);
  assert.equal(identifiedFirst.bossRecoveriesProcessed, 1);
  assert.equal(lab.state.rollSalvage.parts[featured.id].quantity, 1);
  assert.equal(lab.state.bossHunts.pendingRecoveries.length, 0);
  assert.equal((await lab.completeBossExpedition(firstSpec.id, { outcome: 'abandoned' })).ok, true);

  const repeatSpec = createBossExpeditionSpec({
    id: 'hunt-reward-2',
    seed: 2,
    depth: 5,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });
  assert.equal((await lab.lockBossHuntForExpedition(repeatSpec)).ok, true);
  const expectedRoll = getBossHuntRewardRoll({
    saveContextId: lab.saveContextId,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    victoryIndex: 2,
  });
  const repeat = await lab.recordBossVictory({
    expeditionId: repeatSpec.id,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });
  assert.equal(repeat.ok, true);
  assert.equal(repeat.firstClear, false);
  assert.equal(repeat.reward.deterministicRoll, expectedRoll);
  assert.equal(repeat.rewardQueued, expectedRoll < BOSS_HUNT_REPEAT_REWARD_CHANCE);
  assert.equal((await lab.completeBossExpedition(repeatSpec.id, { outcome: 'abandoned' })).ok, true);

  const overloadedSpec = createBossExpeditionSpec({
    id: 'hunt-reward-3',
    seed: 3,
    depth: 5,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });
  assert.equal((await lab.lockBossHuntForExpedition(overloadedSpec)).ok, true);
  const overloaded = await lab.recordBossVictory({
    expeditionId: overloadedSpec.id,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    signaturePartOverloaded: true,
  });
  assert.equal(overloaded.ok, true);
  assert.equal(overloaded.rewardQueued, true);
  assert.equal(overloaded.reward.reason, 'signature-overload');
  assert.equal(lab.state.bossHunts.victoriesByProfile[DEFAULT_BOSS_PROFILE_ID], 3);
});

test('debug Boss victories retain provenance without consuming campaign first-clear progression', async () => {
  const lab = await BusterLabStorage.open({
    storage: new MemoryStorage(),
    lockManager: new MemoryLockManager(),
    saveContextId: 'debug-boss-first-clear-isolation',
  });
  const debug = await lab.recordBossVictory({
    expeditionId: 'debug-only-victory',
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    debug: true,
    allowDebugOverride: true,
    debugRewardOutcome: true,
  });
  assert.equal(debug.ok, true);
  assert.equal(debug.suppressed, true);
  assert.equal(debug.rewardQueued, false);
  assert.equal(debug.reward.eligible, false);
  assert.equal(debug.reward.reason, 'debug-suppressed');
  assert.equal(lab.state.bossHunts.recordedExpeditions['debug-only-victory'].debug, true);
  assert.deepEqual(lab.state.bossHunts.victoriesByProfile, {});
  assert.deepEqual(lab.state.bossHunts.pendingRecoveries, []);

  const expedition = createBossExpeditionSpec({
    id: 'campaign-after-debug',
    seed: 22,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });
  assert.equal((await lab.lockBossHuntForExpedition(expedition)).ok, true);
  const campaign = await lab.recordBossVictory({
    expeditionId: expedition.id,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });
  assert.equal(campaign.ok, true);
  assert.equal(campaign.firstClear, true);
  assert.equal(campaign.victoryIndex, 1);
  assert.equal(campaign.reward.reason, 'first-clear');
});

test('every boss kind guarantees its own canonical advertised material on first victory', async () => {
  const lab = await BusterLabStorage.open({
    storage: new MemoryStorage(),
    lockManager: new MemoryLockManager(),
    saveContextId: 'boss-hunt-all-first-clears',
  });
  for (const [index, profileId] of REAVERBOT_BOSS_PROFILE_IDS.entries()) {
    assert.equal((await lab.selectBossHunt(profileId)).ok, true);
    const expedition = createBossExpeditionSpec({
      id: `all-first-clears:${profileId}`,
      seed: index + 1,
      depth: 5,
      bossProfileId: profileId,
    });
    assert.equal((await lab.lockBossHuntForExpedition(expedition)).ok, true);
    if (profileId === 'ascensionEngine') {
      for (const checkpoint of [
        [1, 'ascensionCheckpoint:compressionFoundry', 0],
        [2, 'ascensionCheckpoint:brokenElevatorSpine', 1],
        [3, 'ascensionCheckpoint:suspendedMachinerySea', 2],
      ]) {
        assert.equal((await lab.recordBossCheckpoint({
          expeditionId: expedition.id,
          bossProfileId: profileId,
          securedCheckpointIndex: checkpoint[0],
          securedCheckpointId: checkpoint[1],
          brokenSealIndex: checkpoint[2],
        })).ok, true);
      }
    }
    const victory = profileId === 'ascensionEngine'
      ? await lab.recordAscensionBossVictory({ expeditionId: expedition.id })
      : await lab.recordBossVictory({
        expeditionId: expedition.id,
        bossProfileId: profileId,
        signaturePartOverloaded: false,
      });
    assert.equal(victory.ok, true);
    assert.equal(victory.firstClear, true);
    assert.equal(victory.rewardQueued, true);
    const recovery = lab.state.bossHunts.pendingRecoveries
      .find((entry) => entry.expeditionId === expedition.id);
    assert.equal(recovery?.part?.id, resolveBossRewardMaterial(profileId)?.id, profileId);
    assert.equal((await lab.completeBossExpedition(expedition.id, { outcome: 'abandoned' })).ok, true);
  }
  assert.equal(lab.state.bossHunts.pendingRecoveries.length, REAVERBOT_BOSS_PROFILE_IDS.length);
});

test('Boss Recovery identification is atomic with ordinary salvage and survives failed durable writes', async () => {
  const storage = new MemoryStorage();
  const lab = await BusterLabStorage.open({
    storage,
    lockManager: new MemoryLockManager(),
    saveContextId: 'boss-hunt-identification',
  });
  const expedition = createBossExpeditionSpec({
    id: 'hunt-identification-1',
    seed: 11,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });
  await lab.lockBossHuntForExpedition(expedition);
  await lab.recordBossVictory({
    expeditionId: expedition.id,
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
  });
  const featured = resolveBossFeaturedMaterial(DEFAULT_BOSS_PROFILE_ID);

  storage.failWrites = true;
  const failed = await lab.identifyRecoveriesWithBossRewards({ total: 2, recoveries: [] });
  assert.equal(failed.ok, false);
  assert.equal(lab.state.bossHunts.pendingRecoveries.length, 1);
  assert.equal(lab.state.rollSalvage.parts[featured.id], undefined);
  assert.equal(lab.state.rollSalvage.identifiedScrap, 0);

  storage.failWrites = false;
  const committed = await lab.identifyRecoveriesWithBossRewards({ total: 2, recoveries: [] });
  assert.equal(committed.ok, true);
  assert.equal(committed.ordinaryProcessed, 2);
  assert.equal(committed.bossRecoveriesProcessed, 1);
  assert.equal(lab.state.rollSalvage.identifiedScrap, 2);
  assert.equal(lab.state.rollSalvage.parts[featured.id].quantity, 1);
  assert.equal(lab.state.bossHunts.pendingRecoveries.length, 0);
  assert.equal(
    lab.state.bossHunts.recordedExpeditions[expedition.id].reward.identified,
    true,
  );
});

test('read-only Boss Hunt victory leaves first-clear eligibility and recovery state untouched', async () => {
  const storage = new MemoryStorage();
  const lab = await BusterLabStorage.open({
    storage,
    lockManager: null,
    saveContextId: 'boss-hunt-read-only',
  });
  const result = await lab.recordBossVictory({
    expeditionId: 'read-only-victory',
    bossProfileId: DEFAULT_BOSS_PROFILE_ID,
    signaturePartOverloaded: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'read-only');
  assert.equal(result.firstClearEligible, true);
  assert.deepEqual(lab.state.bossHunts.victoriesByProfile, {});
  assert.deepEqual(lab.state.bossHunts.pendingRecoveries, []);
  assert.equal(lab.state.bossHunts.recordedExpeditions['read-only-victory'], undefined);
});

test('Mega calibration sockets persist revisions and enforce physical exclusivity', () => {
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage });
  lab.load();
  const seeded = lab.setMegaCalibrationState({
    instances: [{
      instanceId: 'calibration-1',
      legacyType: 'powerRaiser',
      name: 'Power Calibration',
      bonuses: { power: 2 },
    }],
    slots: [null, null, null, null],
    nextInstanceId: 2,
    revision: 4,
  });
  assert.equal(seeded.ok, true);

  const installed = lab.setMegaCalibration(0, 'calibration-1');
  assert.equal(installed.ok, true);
  assert.equal(lab.state.megaCalibrations.revision, 5);
  const duplicate = lab.setMegaCalibration(1, 'calibration-1');
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'calibration-already-installed');

  const reloaded = new BusterLabStorage({ storage }).load();
  assert.equal(reloaded.megaCalibrations.revision, 5);
  assert.deepEqual(reloaded.megaCalibrations.slots, ['calibration-1', null, null, null]);
});

test('async v2 transactions serialize writers and reject a stale same-revision commit', async () => {
  const storage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  const first = await BusterLabStorage.open({ storage, lockManager });
  const second = await BusterLabStorage.open({
    storage,
    lockManager,
    saveContextId: first.saveContextId,
  });
  assert.equal(first.revision, second.revision);
  assert.equal(first.writeId, second.writeId);

  const expectedRevision = first.revision;
  const expectedWriteId = first.writeId;
  const [winner, loser] = await Promise.all([
    first.transact({ operation: 'writer-a', expectedRevision, expectedWriteId }, (state) => {
      state.rollSalvage.identifiedScrap += 3;
    }),
    second.transact({ operation: 'writer-b', expectedRevision, expectedWriteId }, (state) => {
      state.rollSalvage.identifiedScrap += 7;
    }),
  ]);
  const outcomes = [winner, loser];
  assert.equal(outcomes.filter((entry) => entry.ok).length, 1);
  assert.equal(outcomes.find((entry) => !entry.ok).reason, 'conflict');
  const final = new BusterLabStorage({
    storage,
    lockManager,
    saveContextId: first.saveContextId,
  }).load();
  assert.ok([3, 7].includes(final.rollSalvage.identifiedScrap));
});

test('durable storage opens read-only when no Web Locks-compatible manager exists', async () => {
  const storage = new MemoryStorage();
  const lab = await BusterLabStorage.open({
    storage,
    lockManager: null,
    saveContextId: 'no-web-locks',
  });
  assert.equal(lab.readOnly, true);
  assert.equal(lab.writePauseReason, 'lock-unavailable');
  assert.match(lab.lastWarning, /read-only/i);
  assert.equal((await lab.transact({ operation: 'must-not-write' }, () => {})).reason, 'read-only');
  assert.equal(lab.exportRecoveryData().ok, true);
});

test('initial lock timeout pauses writes while retaining inspection and recovery export', async () => {
  const storage = new MemoryStorage();
  const stalledLockManager = {
    request(_name, options) {
      return new Promise((resolve, reject) => {
        if (options.signal?.aborted) {
          reject(options.signal.reason);
          return;
        }
        options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        void resolve;
      });
    },
  };
  const lab = await BusterLabStorage.open({
    storage,
    lockManager: stalledLockManager,
    lockTimeoutMs: 5,
    saveContextId: 'lock-timeout',
  });
  assert.equal(lab.readOnly, true);
  assert.equal(lab.writePauseReason, 'lock-timeout');
  assert.match(lab.lastWarning, /lock|writes are paused/i);
  assert.equal(lab.state.chassisInstances[0].chassisId, 'chassis-a');
  assert.equal(lab.exportRecoveryData().ok, true);
});

test('confirmed New Campaign rotates context without deleting the dormant campaign payload', async () => {
  const storage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  let contextSequence = 0;
  const idFactory = (kind, sequence) => (
    kind === 'saveContext' ? `campaign-context-${++contextSequence}` : `${kind}-${sequence}`
  );
  const lab = await BusterLabStorage.open({ storage, lockManager, idFactory });
  const oldContextId = lab.saveContextId;
  const oldStorageKey = lab.storageKeys.main;
  const seeded = await lab.updateRollSalvageAsync((roll) => roll.addIdentifiedScrap(17));
  assert.equal(seeded.ok, true);
  const oldPayload = storage.getItem(oldStorageKey);

  const rotated = await lab.beginNewCampaign({ confirmed: true });
  assert.equal(rotated.ok, true);
  assert.notEqual(lab.saveContextId, oldContextId);
  assert.equal(lab.state.rollSalvage.identifiedScrap, 0);
  assert.equal(storage.getItem(oldStorageKey), oldPayload);
  assert.notEqual(lab.storageKeys.main, oldStorageKey);

  const dormant = await BusterLabStorage.open({
    storage,
    lockManager,
    idFactory,
    saveContextId: oldContextId,
  });
  assert.equal(dormant.state.rollSalvage.identifiedScrap, 17);
});

test('hidden legacy records reserve the forty-slot logical inventory capacity', () => {
  const lab = new BusterLabStorage({ storage: new MemoryStorage(), saveContextId: 'capacity-test' });
  lab.load();
  const finalAvailableSlot = lab.registerLegacyBusterPart(
    { type: 'powerRaiser', name: 'Capacity Probe A' },
    { location: { kind: 'inventory' }, occupiedInventoryCount: 39 },
  );
  assert.equal(finalAvailableSlot.ok, true);
  const rejected = lab.registerLegacyBusterPart(
    { type: 'energyBattery', name: 'Capacity Probe B' },
    { location: { kind: 'inventory' }, occupiedInventoryCount: 39 },
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'inventory-capacity');
  assert.equal(lab.state.legacyBusterParts.records.length, 1);
});

test('awaited command adapters keep starter, crafting, draft, slot, and calibration writes under one lock', async () => {
  const storage = new MemoryStorage();
  const lab = await BusterLabStorage.open({ storage, lockManager: new MemoryLockManager() });
  const initialRevision = lab.revision;
  const starter = await lab.ensureStarterPowerRaiserShadowAsync({ rarity: 'standard' });
  assert.equal(starter.ok, true);
  assert.ok(lab.revision > initialRevision);
  assert.equal(lab.state.megaCalibrations.slots[0], starter.record.calibrationInstanceId);

  const debug = await lab.grantDebugKitAsync();
  assert.equal(debug.ok, true);
  assert.equal(debug.resources.identifiedScrap, 66);
  const draft = structuredClone(lab.state.chassisDrafts.find((entry) => entry.buildId === 'build-b'));
  const savedDraft = await lab.saveDraftAsync(draft);
  assert.equal(savedDraft.ok, true);
  const calibration = debug.calibrations[0].instanceId;
  const installed = await lab.setMegaCalibrationAsync(1, calibration);
  assert.equal(installed.ok, true);
  assert.equal(lab.state.megaCalibrations.slots[1], calibration);
});

test('awaited blueprint import is locked, ownership-free, and preserves foreign provenance', async () => {
  const storage = new MemoryStorage();
  const lab = await BusterLabStorage.open({
    storage,
    lockManager: new MemoryLockManager(),
    saveContextId: 'blueprint-import',
  });
  const initialRevision = lab.revision;
  const imported = await lab.importBlueprintAsync({
    format: 'ruin-digger-buster-blueprint',
    formatVersion: 1,
    sourceContextId: 'another-campaign',
    blueprint: {
      blueprintId: 'foreign-id-must-not-win',
      name: 'Foreign Pulse',
      schemaVersion: 1,
      rulesetVersion: 'custom-buster-v0.2',
      tuning: { power: 4, energy: 4, range: 4, rapid: 4 },
      program: {
        rootNodeId: 'pulse',
        nodes: [{
          nodeId: 'pulse',
          moduleId: 'pulseBolt',
          moduleInstanceId: 'foreign-physical-instance',
        }],
        edges: [],
      },
    },
  });

  assert.equal(imported.ok, true);
  assert.equal(lab.revision, initialRevision + 1);
  assert.equal(imported.blueprint.imported, true);
  assert.equal(imported.blueprint.sourceContextId, 'another-campaign');
  assert.notEqual(imported.blueprint.blueprintId, 'foreign-id-must-not-win');
  assert.equal('moduleInstanceId' in imported.blueprint.program.nodes[0], false);
});

test('unexpected cross-tab storage events pause writes until locked reload and dispose detaches detection', async () => {
  const storage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  const events = new FakeStorageEventTarget();
  const lab = await BusterLabStorage.open({
    storage,
    lockManager,
    saveContextId: 'storage-events',
    storageEventTarget: events,
  });
  assert.equal(events.listeners.size, 1);
  await lab.open();
  assert.equal(events.listeners.size, 1, 'opening twice must not duplicate the listener');

  events.dispatch({
    key: lab.storageKeys.main,
    newValue: storage.getItem(lab.storageKeys.main),
    storageArea: storage,
  });
  assert.equal(lab.readOnly, false, 'an event matching the adopted revision/write id is harmless');

  const foreign = await BusterLabStorage.open({
    storage,
    lockManager,
    saveContextId: lab.saveContextId,
    storageEventTarget: null,
  });
  const foreignWrite = await foreign.transact({ operation: 'foreign-write' }, (state) => {
    state.rollSalvage.identifiedScrap += 7;
  });
  assert.equal(foreignWrite.ok, true);
  events.dispatch({
    key: lab.storageKeys.main,
    newValue: storage.getItem(lab.storageKeys.main),
    storageArea: storage,
  });

  const paused = lab.getPersistenceStatus();
  assert.equal(paused.readOnly, true);
  assert.equal(paused.writePaused, true);
  assert.equal(paused.writePauseReason, 'external-conflict');
  assert.equal(paused.conflict.actualRevision, foreign.revision);
  assert.equal((await lab.transact({ operation: 'blocked' }, () => {})).reason, 'read-only');

  const recovery = lab.exportRecoveryData();
  assert.equal(recovery.ok, true);
  assert.equal(recovery.payload.saveContextId, lab.saveContextId);
  assert.equal(
    JSON.parse(recovery.payload.durablePayloads.main).writeId,
    foreign.writeId,
  );

  const reloaded = await lab.reloadFromStorage();
  assert.equal(reloaded.ok, true);
  assert.equal(lab.readOnly, false);
  assert.equal(lab.writePauseReason, null);
  assert.equal(lab.state.rollSalvage.identifiedScrap, 7);
  assert.equal(lab.revision, foreign.revision);

  const adoptedRevision = lab.revision;
  lab.dispose();
  assert.equal(events.listeners.size, 0);
  const afterDispose = await foreign.reloadFromStorage();
  assert.equal(afterDispose.ok, true);
  assert.equal((await foreign.transact({ operation: 'post-dispose' }, (state) => {
    state.rollSalvage.identifiedScrap += 1;
  })).ok, true);
  events.dispatch({
    key: lab.storageKeys.main,
    newValue: storage.getItem(lab.storageKeys.main),
    storageArea: storage,
  });
  assert.equal(lab.revision, adoptedRevision, 'disposed stores no longer observe cross-tab events');
  assert.equal(lab.readOnly, false);
});

test('blueprints strip ownership and materialization redacts undiscovered recipe details', async () => {
  const storage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  const lab = await BusterLabStorage.open({ storage, lockManager });
  const saved = lab.saveBlueprint({
    name: 'Tracking Pulse',
    schemaVersion: 1,
    rulesetVersion: 'custom-buster-v0.2',
    tuning: { power: 4, energy: 4, range: 4, rapid: 4 },
    program: {
      rootNodeId: 'pulse',
      nodes: [{
        nodeId: 'pulse',
        moduleId: 'pulseBolt',
        moduleInstanceId: 'must-not-persist',
      }, {
        nodeId: 'guide',
        moduleId: 'pursuitGuidance',
        moduleInstanceId: 'must-not-persist-either',
      }],
      edges: [{ from: 'pulse', port: 'next', to: 'guide' }],
    },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.blueprint.program.nodes.some((node) => 'moduleInstanceId' in node), false);

  const unknown = lab.suggestMaterialization(saved.blueprint.blueprintId, {
    buildId: 'build-a',
    chassisId: 'chassis-a',
  });
  const hidden = unknown.requests.find((entry) => entry.nodeId === 'guide');
  assert.equal(hidden.moduleId, null);
  assert.equal(hidden.discoveryLevel, 'unknown');
  assert.equal(hidden.requirements, undefined);
  assert.deepEqual(hidden.routes, []);
  assert.equal(unknown.canConfirm, false);

  lab.updateRollSalvage((roll) => {
    roll.addPart({ id: 'behaviorChipPursuit', name: 'Behavior Chip: Pursuit' });
  });
  const hinted = lab.suggestMaterialization(saved.blueprint.blueprintId, {
    buildId: 'build-a',
    chassisId: 'chassis-a',
  }).requests.find((entry) => entry.nodeId === 'guide');
  assert.equal(hinted.moduleId, 'pursuitGuidance');
  assert.equal(hinted.discoveryLevel, 'hinted');
  assert.equal(hinted.recipeId, undefined);
  assert.deepEqual(hinted.routes, []);

  lab.updateRollSalvage((roll) => {
    roll.addPart({ id: 'rubyOpticLens', name: 'Ruby Optic Lens' });
    roll.addIdentifiedScrap(12);
  });
  const exact = lab.suggestMaterialization(saved.blueprint.blueprintId, {
    buildId: 'build-a',
    chassisId: 'chassis-a',
  });
  const pursuitRequest = exact.requests.find((entry) => entry.nodeId === 'guide');
  assert.equal(pursuitRequest.discoveryLevel, 'full');
  assert.deepEqual(pursuitRequest.routes[0].requirements.parts, {
    behaviorChipPursuit: 1,
    rubyOpticLens: 1,
  });
  assert.equal(exact.canConfirm, true);

  const materialized = await lab.confirmMaterialization(exact);
  assert.equal(materialized.ok, true);
  assert.equal(materialized.result.fabricated.length, 1);
  assert.equal(materialized.result.fabricated[0].moduleId, 'pursuitGuidance');
  assert.ok(materialized.result.build.program.nodes.find((node) => node.nodeId === 'guide').moduleInstanceId);
  assert.equal(lab.state.blueprints[0].program.nodes.some((node) => 'moduleInstanceId' in node), false);
});

test('materialization follows graph order and can unlock a later replication inside one transaction', async () => {
  const lab = await BusterLabStorage.open({
    storage: new MemoryStorage(),
    lockManager: new MemoryLockManager(),
    saveContextId: 'materialization-order',
  });
  const seeded = lab.mutate((state) => {
    state.moduleInstances.push({
      id: 'owned-mortar',
      instanceId: 'owned-mortar',
      moduleInstanceId: 'owned-mortar',
      moduleId: 'mortarShell',
      recipeId: 'mortar',
      name: 'Mortar Shell',
      origin: 'starter',
      fabricationSequence: 0,
    }, {
      id: 'owned-explosion',
      instanceId: 'owned-explosion',
      moduleInstanceId: 'owned-explosion',
      moduleId: 'explosion',
      recipeId: 'explosion',
      name: 'Explosion',
      origin: 'starter',
      fabricationSequence: 0,
    });
  });
  assert.equal(seeded.ok, true);
  const resources = lab.updateRollSalvage((roll) => {
    roll.addPart({ id: 'behaviorChipPursuit', name: 'Behavior Chip: Pursuit' });
    roll.addPart({ id: 'rubyOpticLens', name: 'Ruby Optic Lens' });
    roll.addIdentifiedScrap(36);
  });
  assert.equal(resources.ok, true);

  const saved = lab.saveBlueprint({
    name: 'Double Pursuit Delivery',
    schemaVersion: 1,
    rulesetVersion: 'custom-buster-v0.2',
    tuning: { power: 4, energy: 4, range: 4, rapid: 4 },
    // Deliberately scrambled: materialization order must come from edges.
    program: {
      rootNodeId: 'root-mortar',
      nodes: [
        { nodeId: 'a-child-guide', moduleId: 'pursuitGuidance' },
        { nodeId: 'payload-explosion', moduleId: 'explosion' },
        { nodeId: 'relay-delay', moduleId: 'afterDelay' },
        { nodeId: 'z-root-guide', moduleId: 'pursuitGuidance' },
        { nodeId: 'root-mortar', moduleId: 'mortarShell' },
      ],
      edges: [
        { from: 'root-mortar', port: 'next', to: 'z-root-guide' },
        { from: 'z-root-guide', port: 'next', to: 'relay-delay' },
        { from: 'relay-delay', port: 'child', to: 'a-child-guide' },
        { from: 'a-child-guide', port: 'next', to: 'payload-explosion' },
      ],
    },
  });
  assert.equal(saved.ok, true);
  const suggestion = lab.suggestMaterialization(saved.blueprint.blueprintId, {
    buildId: 'build-a',
    chassisId: 'chassis-a',
  });
  assert.equal(suggestion.canConfirm, true);
  assert.deepEqual(suggestion.requests.map((request) => request.nodeId), [
    'root-mortar',
    'z-root-guide',
    'a-child-guide',
    'payload-explosion',
  ]);
  const rootGuide = suggestion.requests.find((request) => request.nodeId === 'z-root-guide');
  const childGuide = suggestion.requests.find((request) => request.nodeId === 'a-child-guide');
  assert.deepEqual(rootGuide.routes.map((route) => [route.id, route.affordable]), [['original', true]]);
  assert.deepEqual(childGuide.routes.map((route) => [route.id, route.affordable]), [
    ['original', false],
    ['replication', true],
  ]);

  const materialized = await lab.confirmMaterialization(suggestion);
  assert.equal(materialized.ok, true);
  assert.deepEqual(materialized.result.fabricated.map((entry) => entry.route), ['original', 'replication']);
  assert.equal(lab.state.fabricationHistory.pursuitGuidance.originalCrafts, 1);
  assert.equal(lab.state.fabricationHistory.pursuitGuidance.replicationCrafts, 1);
  assert.equal(lab.state.rollSalvage.identifiedScrap, 0);
  assert.equal(lab.state.rollSalvage.parts.behaviorChipPursuit?.quantity ?? 0, 0);
  assert.equal(lab.state.rollSalvage.parts.rubyOpticLens?.quantity ?? 0, 0);
});

test('original fabrication unlocks replication while starter and debug instances do not', () => {
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage });
  const state = lab.load();
  assert.equal(lab.getFabricationRoutes('pulse').length, 0, 'undiscovered recipes expose no routes');
  state.rollSalvage.identifiedScrap = 18;
  addPart(state, 'revolvingPulseBarrel');
  lab.save(state);

  assert.equal(lab.fabricate('pulse', { route: 'replication' }).reason, 'replication-locked');
  const original = lab.fabricate('pulse', { route: 'original' });
  assert.equal(original.ok, true);
  assert.equal(lab.state.fabricationHistory.pulseBolt.originalCrafts, 1);
  assert.equal(lab.fabricate('pulse', { route: 'replication' }).ok, true);
  assert.equal(lab.state.fabricationHistory.pulseBolt.replicationCrafts, 1);
  assert.equal(lab.state.rollSalvage.identifiedScrap, 0);
});

test('v1 physical After Delay copies become built-in and refund real crafts exactly once', () => {
  const legacy = createDefaultBusterLabState();
  legacy.version = 1;
  delete legacy.migrations.afterDelayBuiltInV2;
  legacy.migrations.applied = legacy.migrations.applied.filter((entry) => entry !== 'after-delay-built-in-v2');
  legacy.moduleInstances.push({
    instanceId: 'module-delay-real',
    moduleId: 'afterDelay',
    recipeId: 'afterDelay',
    name: 'After Delay',
    origin: 'fabricated',
    fabricationSequence: 9,
  }, {
    instanceId: 'module-delay-debug',
    moduleId: 'afterDelay',
    recipeId: 'afterDelay',
    name: 'After Delay',
    origin: 'debug',
    fabricationSequence: 10,
  });
  legacy.chassisBuilds[0].program.nodes.push({
    nodeId: 'delay',
    moduleId: 'afterDelay',
    moduleInstanceId: 'module-delay-real',
  }, {
    nodeId: 'payload',
    moduleId: 'pulsePayload',
    moduleInstanceId: null,
  });
  legacy.chassisBuilds[0].program.edges.push({
    from: 'node-pulse-bolt',
    port: 'next',
    to: 'delay',
  }, {
    from: 'delay',
    port: 'child',
    to: 'payload',
  });

  const migrated = BusterLabStorage.prototype.deserialize.call({
    saveContextId: 'migration-test',
  }, legacy);
  assert.equal(migrated.moduleInstances.some((entry) => entry.moduleId === 'afterDelay'), false);
  assert.equal(migrated.chassisBuilds[0].program.nodes.find((node) => node.nodeId === 'delay').moduleInstanceId, null);
  assert.equal(migrated.rollSalvage.identifiedScrap, 8);
  assert.equal(migrated.rollSalvage.parts.clusterBurstSequencer.quantity, 1);
  assert.deepEqual(migrated.migrations.afterDelayBuiltInV2, {
    completed: true,
    totalRemoved: 2,
    fabricatedRefunded: 1,
    debugRemoved: 1,
    refundedScrap: 8,
    refundedParts: { clusterBurstSequencer: 1 },
  });

  const reloaded = BusterLabStorage.prototype.deserialize.call({
    saveContextId: 'migration-test',
  }, migrated);
  assert.equal(reloaded.rollSalvage.identifiedScrap, 8);
  assert.equal(reloaded.rollSalvage.parts.clusterBurstSequencer.quantity, 1);
});

test('legacy Buster shadow records preserve reciprocal calibration ownership and item mutation', () => {
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage });
  lab.load();
  const starter = lab.ensureStarterPowerRaiserShadow({ rarity: 'standard', rolls: { attack: 2 } });
  assert.equal(starter.ok, true);
  assert.equal(starter.record.legacyId.startsWith(`legacy-buster:${lab.saveContextId}:`), true);
  assert.equal(lab.state.megaCalibrations.slots[0], starter.record.calibrationInstanceId);
  assert.deepEqual(validateBusterLabState(lab.state), []);

  const removed = lab.moveLegacyBusterPart(starter.record.legacyId, { kind: 'inventory' });
  assert.equal(removed.ok, true);
  assert.equal(lab.state.megaCalibrations.slots[0], null);
  assert.equal(lab.getLegacyBusterView({ featureEnabled: true })[0].item, null);
  assert.equal(lab.getLegacyBusterView({ featureEnabled: false })[0].item.rarity, 'standard');

  const updated = lab.updateLegacyBusterItem(starter.record.legacyId, (item) => ({
    ...item,
    rarity: 'rare',
    soldValue: 42,
  }));
  assert.equal(updated.ok, true);
  assert.equal(lab.getLegacyBusterView({ featureEnabled: false })[0].item.rarity, 'rare');
  assert.equal(lab.moveLegacyBusterPart(starter.record.legacyId, {
    kind: 'megaSocket',
    socketIndex: 2,
  }).ok, true);
  assert.equal(lab.state.megaCalibrations.slots[2], starter.record.calibrationInstanceId);

  const destroyed = lab.removeLegacyBusterPart(starter.record.legacyId);
  assert.equal(destroyed.ok, true);
  assert.equal(lab.state.legacyBusterParts.records.length, 0);
  assert.equal(lab.state.megaCalibrations.instances.length, 0);
  assert.deepEqual(lab.state.megaCalibrations.slots, [null, null, null, null]);
  assert.equal(lab.state.legacyBusterParts.starterRegistered, true);
  assert.equal(lab.ensureStarterPowerRaiserShadow({ rarity: 'standard' }).created, false);
  assert.equal(lab.state.legacyBusterParts.records.length, 0);
});

test('a committed legacy acquisition can be retried by canonical id without duplicating ownership', () => {
  const storage = new MemoryStorage();
  const lab = new BusterLabStorage({ storage, saveContextId: 'legacy-retry' });
  lab.load();
  const first = lab.registerLegacyBusterPart(
    { id: 'runtime-item-1', type: 'rangeBooster', rarity: 'standard' },
    { location: { kind: 'inventory' } },
  );
  assert.equal(first.ok, true);

  const retry = lab.registerLegacyBusterPart({
    id: 'runtime-item-1',
    type: 'rangeBooster',
    rarity: 'standard',
    canonicalId: first.record.legacyId,
    legacyBusterId: first.record.legacyId,
  }, { location: { kind: 'inventory' } });
  assert.equal(retry.ok, true);
  assert.equal(retry.created, false);
  assert.equal(retry.record.legacyId, first.record.legacyId);
  assert.equal(lab.state.legacyBusterParts.records.length, 1);
  assert.equal(lab.state.megaCalibrations.instances.length, 1);
  assert.deepEqual(validateBusterLabState(lab.state), []);
});

test('legacy Buster layout swaps and removals commit as one durable reconciliation', async () => {
  const storage = new MemoryStorage();
  const lockManager = new MemoryLockManager();
  const lab = await BusterLabStorage.open({ storage, lockManager, saveContextId: 'legacy-layout' });
  const power = await lab.registerLegacyBusterPartAsync(
    { type: 'powerRaiser', rarity: 'standard' },
    { location: { kind: 'megaSocket', socketIndex: 0 } },
  );
  const energy = await lab.registerLegacyBusterPartAsync(
    { type: 'energyBattery', rarity: 'standard' },
    { location: { kind: 'megaSocket', socketIndex: 1 } },
  );
  const revisionBefore = lab.revision;

  const result = await lab.reconcileLegacyBusterPartsAsync({
    locations: [
      { legacyId: power.record.legacyId, location: { kind: 'megaSocket', socketIndex: 1 } },
      { legacyId: energy.record.legacyId, location: { kind: 'megaSocket', socketIndex: 0 } },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(lab.revision, revisionBefore + 1);
  assert.equal(lab.state.legacyBusterParts.records.find((entry) => entry.legacyId === power.record.legacyId).location.socketIndex, 1);
  assert.equal(lab.state.legacyBusterParts.records.find((entry) => entry.legacyId === energy.record.legacyId).location.socketIndex, 0);
  assert.deepEqual(validateBusterLabState(lab.state), []);

  const removed = await lab.reconcileLegacyBusterPartsAsync({
    removals: [power.record.legacyId, energy.record.legacyId],
  });
  assert.equal(removed.ok, true);
  assert.equal(lab.state.legacyBusterParts.records.length, 0);
  assert.deepEqual(lab.state.megaCalibrations.slots, [null, null, null, null]);
});
