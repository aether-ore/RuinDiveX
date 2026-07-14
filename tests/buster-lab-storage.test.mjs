import test from 'node:test';
import assert from 'node:assert/strict';

import { RollSalvageStorage } from '../src/RollSalvageStorage.js';
import {
  BUSTER_RECIPE_LIST,
  BUSTER_RECIPES,
  getRecipeDiscoveryState,
} from '../src/buster/BusterRecipeCatalog.js';
import {
  BUSTER_MODULE_LIST,
  MEGA_BUSTER_CALIBRATION_CATALOG,
} from '../src/buster/catalog.js';
import {
  BUSTER_LAB_STORAGE_KEY,
  BusterLabStorage,
  createDefaultBusterLabState,
  validateBusterLabState,
} from '../src/buster/BusterLabStorage.js';

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
  assert.deepEqual(BUSTER_RECIPES.afterDelay.parts, { clusterBurstSequencer: 1 });
  assert.equal(BUSTER_RECIPES.afterDelay.scrapCost, 8);
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

  const hinted = getRecipeDiscoveryState('pursuit', ['behaviorChipPursuit']);
  assert.equal(hinted.level, 'hinted');
  assert.equal(hinted.moduleId, 'pursuitGuidance');
  assert.equal(hinted.kind, 'module');
  assert.ok(hinted.rollClue.length > 20);
  assert.equal(hinted.requirements, null);

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

  assert.equal(storage.values.has(BUSTER_LAB_STORAGE_KEY), true);
  assert.equal(first.chassisInstances.length, 1);
  assert.equal(first.moduleInstances.length, 1);
  assert.equal(first.moduleInstances[0].moduleId, 'pulseBolt');
  assert.equal(first.moduleInstances[0].origin, 'starter');
  assert.equal(first.chassisBuilds.length, 1);
  assert.equal(first.chassisDrafts.length, 1);
  assert.equal(first.chassisRevisions.length, 1);
  assert.deepEqual(first.assignments.slots, { 1: null, 2: null });
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

test('repeatable debug kits atomically grant every physical part without changing builds or salvage', () => {
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
  assert.deepEqual(lab.state.assignments.slots, { 1: null, 2: null });
  assert.deepEqual(lab.state.rollSalvage, { identifiedScrap: 0, parts: {} });
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
  assert.deepEqual(lab.state.assignments.slots, { 1: null, 2: null });

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

test('serialization whitelists durable fields, migrates old saves, and visibly recovers corruption', () => {
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

  const persisted = JSON.parse(storage.getItem(BUSTER_LAB_STORAGE_KEY));
  assert.deepEqual(Object.keys(persisted).sort(), [
    'assignments',
    'chassisBuilds',
    'chassisDrafts',
    'chassisInstances',
    'chassisRevisions',
    'discovery',
    'megaCalibrations',
    'migrations',
    'moduleInstances',
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
  const migrated = migratedLab.load();
  assert.equal(migrated.version, 1);
  assert.equal(migrated.rollSalvage.identifiedScrap, 9);
  assert.equal(migrated.chassisInstances.length, 1);
  assert.equal(migrated.migrations.starterChassisGranted, true);

  storage.setItem(BUSTER_LAB_STORAGE_KEY, '{definitely-not-json');
  const corruptLab = new BusterLabStorage({ storage });
  const fallback = corruptLab.load();
  assert.equal(fallback.chassisInstances.length, 1);
  assert.match(corruptLab.lastWarning, /couldn't read/i);
  assert.match(fallback.warning, /safe starter lab/i);

  const inconsistent = createDefaultBusterLabState();
  inconsistent.chassisInstances = [];
  storage.setItem(BUSTER_LAB_STORAGE_KEY, JSON.stringify(inconsistent));
  const inconsistentLab = new BusterLabStorage({ storage });
  const safeState = inconsistentLab.load();
  assert.equal(safeState.chassisInstances.length, 1);
  assert.match(inconsistentLab.lastWarning, /chassis-a is missing/i);
});

test('unknown module ids preserve the source draft while quarantining its saved assignment', () => {
  const storage = new MemoryStorage();
  const futureState = createDefaultBusterLabState();
  futureState.moduleInstances[0].moduleId = 'futureArcOrb';
  futureState.moduleInstances[0].name = 'Future Arc Orb';
  futureState.chassisBuilds[0].program.nodes[0].moduleId = 'futureArcOrb';
  futureState.chassisDrafts[0].program.nodes[0].moduleId = 'futureArcOrb';
  futureState.assignments.slots['1'] = 'build-a';
  storage.setItem(BUSTER_LAB_STORAGE_KEY, JSON.stringify(futureState));

  const lab = new BusterLabStorage({ storage });
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

  const persisted = JSON.parse(storage.getItem(BUSTER_LAB_STORAGE_KEY));
  assert.equal(persisted.chassisDrafts[0].program.nodes[0].moduleId, 'futureArcOrb');
  assert.equal(persisted.assignments.slots['1'], null);
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
