import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUSTER_MODULE_CATALOG,
  BUSTER_BALANCE_SEARCH,
  BusterCompileError,
  CUSTOM_BUSTER_RULESET,
  MEGA_BUSTER_BASE_PROFILE,
  MEGA_BUSTER_CALIBRATION_CATALOG,
  applyBusterPowerSoftCap,
  compileBusterBuild,
  compileMegaBusterPlan,
  deserializeBusterBuild,
  getBusterCombatDepthScalar,
  normalizeBusterBuild,
  serializeBusterBuild,
  validateBusterAssignments,
  validateBusterBuild,
  validateBusterProgram,
} from '../src/buster/index.js';

const RULESET = 'custom-buster-v0.2';

function node(nodeId, moduleId, moduleInstanceId = `instance:${nodeId}`) {
  return { nodeId, moduleId, moduleInstanceId };
}

function edge(from, port, to) {
  return { from, port, to };
}

function build(nodes, edges = [], {
  tuning = { power: 4, energy: 4, range: 4, rapid: 4 },
  rootNodeId = nodes[0]?.nodeId ?? null,
  buildId = 'test-build',
  chassisId = 'test-chassis',
  schemaVersion = 1,
  rulesetVersion = RULESET,
} = {}) {
  return {
    schemaVersion,
    rulesetVersion,
    buildId,
    chassisId,
    tuning: { ...tuning },
    program: {
      rootNodeId,
      nodes: nodes.map((entry) => ({ ...entry })),
      edges: edges.map((entry) => ({ ...entry })),
    },
  };
}

function errorCodes(result) {
  return new Set(result.errors.map((error) => error.code));
}

function approximately(actual, expected, epsilon = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`);
}

test('the v0.2 catalog publishes the exact immutable module constants', () => {
  assert.deepEqual(
    {
      power: BUSTER_MODULE_CATALOG.pulseBolt.basePower,
      range: BUSTER_MODULE_CATALOG.pulseBolt.baseRange,
      rapid: BUSTER_MODULE_CATALOG.pulseBolt.baseRapid,
      speed: BUSTER_MODULE_CATALOG.pulseBolt.projectileSpeed,
      energy: BUSTER_MODULE_CATALOG.pulseBolt.energyCost,
    },
    { power: 8, range: 6.9, rapid: 4.2, speed: 9.5, energy: 2 },
  );
  assert.deepEqual(
    {
      power: BUSTER_MODULE_CATALOG.mortarShell.basePower,
      range: BUSTER_MODULE_CATALOG.mortarShell.baseRange,
      rapid: BUSTER_MODULE_CATALOG.mortarShell.baseRapid,
      speed: BUSTER_MODULE_CATALOG.mortarShell.projectileSpeed,
      energy: BUSTER_MODULE_CATALOG.mortarShell.energyCost,
    },
    { power: 15, range: 6.2, rapid: 1.15, speed: 5.8, energy: 3 },
  );
  assert.equal(BUSTER_MODULE_CATALOG.pursuitGuidance.energyCost, 0);
  assert.equal(BUSTER_MODULE_CATALOG.pursuitGuidance.cycleDelay, 0);
  assert.equal(BUSTER_MODULE_CATALOG.atApex.energyCost, 0);
  assert.equal(BUSTER_MODULE_CATALOG.onImpact.energyCost, 0);
  assert.equal(BUSTER_MODULE_CATALOG.onImpact.label, 'Terminal Relay');
  assert.equal(BUSTER_MODULE_CATALOG.afterDelay.energyCost, 0);
  assert.equal(BUSTER_MODULE_CATALOG.afterDelay.physical, false);
  assert.equal(BUSTER_MODULE_CATALOG.afterDelay.childTransfer, 1.04);
  assert.deepEqual(BUSTER_MODULE_CATALOG.spread3.angleOffsets, [-0.14, 0, 0.14]);
  assert.equal(BUSTER_MODULE_CATALOG.cluster5.radialCount, 5);
  assert.equal(BUSTER_MODULE_CATALOG.explosion.radius, 1.55);
  assert.deepEqual(BUSTER_BALANCE_SEARCH.mortarPower, {
    min: 12, max: 18, step: 0.5, preferred: 15,
  });
  assert.ok(Object.isFrozen(BUSTER_MODULE_CATALOG));
  assert.ok(Object.isFrozen(BUSTER_MODULE_CATALOG.spread3.angleOffsets));
  assert.deepEqual(
    {
      tuningPoints: CUSTOM_BUSTER_RULESET.tuningPoints,
      ratingMin: CUSTOM_BUSTER_RULESET.ratingMin,
      ratingMax: CUSTOM_BUSTER_RULESET.ratingMax,
      capacity: CUSTOM_BUSTER_RULESET.programCapacity,
      rechargeDelay: CUSTOM_BUSTER_RULESET.rechargeDelay,
      rechargeDuration: CUSTOM_BUSTER_RULESET.rechargeDuration,
      projectileCap: CUSTOM_BUSTER_RULESET.maxMovingProjectiles,
    },
    {
      tuningPoints: 16,
      ratingMin: 1,
      ratingMax: 10,
      capacity: 5,
      rechargeDelay: 0.65,
      rechargeDuration: 1.8,
      projectileCap: 24,
    },
  );
  assert.equal(Object.keys(MEGA_BUSTER_CALIBRATION_CATALOG).length, 6);
  assert.deepEqual(MEGA_BUSTER_CALIBRATION_CATALOG.sniperScope.bonuses, { power: 1, range: 1 });
  assert.deepEqual(MEGA_BUSTER_BASE_PROFILE.tuning, { power: 4, energy: 4, range: 4, rapid: 4 });
  assert.equal(MEGA_BUSTER_BASE_PROFILE.baseMaxEnergy, 6);
  assert.equal(MEGA_BUSTER_BASE_PROFILE.energyCost, 2);
  assert.equal(MEGA_BUSTER_BASE_PROFILE.socketCount, 4);
  assert.ok(Object.isFrozen(CUSTOM_BUSTER_RULESET));
  assert.ok(Object.isFrozen(MEGA_BUSTER_CALIBRATION_CATALOG.sniperScope.bonuses));
});

test('a neutral pulse emitter compiles to the base conformance values', () => {
  const source = build([node('emitter', 'pulseBolt')]);
  const plan = compileBusterBuild(source, { revision: 3 });

  assert.equal(plan.stats.basePower, 8);
  assert.equal(plan.stats.effectivePower, 8);
  assert.equal(plan.stats.maxEnergy, 6);
  assert.equal(plan.stats.energyCost, 2);
  assert.equal(plan.stats.baseRapid, 4.2);
  approximately(plan.stats.cycleTime, 1 / 4.2);
  assert.equal(plan.stats.finalRapid, 4.2);
  assert.equal(plan.stats.rootRange, 6.9);
  assert.equal(plan.stats.childRange, 4.485);
  assert.equal(plan.stats.shotsPerCharge, 3);
  assert.equal(plan.peakProjectileReservation, 1);
  assert.equal(plan.revision, 3);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].type, 'emit');
  assert.equal(plan.actions[0].payload.type, 'pulse');
  assert.equal(plan.stats.programCapacityUsed, 1);
  assert.equal(plan.trajectory.nominalRootLifetime, 6.9 / 9.5);
  assert.equal(plan.occupancy.peakMovingProjectiles, 1);

  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.stats));
  assert.ok(Object.isFrozen(plan.actions[0].payload));
  assert.ok(!Object.isFrozen(source));
});

test('Mega plans compile from resolved tuning without assuming a starter calibration', () => {
  const neutral = compileMegaBusterPlan({
    resolvedTuning: { power: 4, energy: 4, range: 4, rapid: 4 },
    calibrationRevision: 7,
  });
  assert.equal(neutral.isMegaBuster, true);
  assert.equal(neutral.weaponKey, 'megaBuster');
  assert.equal(neutral.revision, 7);
  assert.equal(neutral.stats.effectivePower, 8);
  assert.equal(neutral.stats.maxEnergy, 6);
  assert.equal(neutral.stats.energyCost, 2);
  assert.equal(neutral.stats.shotsPerCharge, 3);
  assert.equal(neutral.stats.rootRange, 6.9);
  assert.equal(neutral.stats.baseRapid, 4.2);
  assert.deepEqual(neutral.resolvedTuning, { power: 4, energy: 4, range: 4, rapid: 4 });
  assert.equal(Object.isFrozen(neutral), true);

  const calibrated = compileMegaBusterPlan({
    resolvedTuning: { power: 6, energy: 4, range: 4, rapid: 4 },
  });
  approximately(calibrated.stats.effectivePower, 9.12);
  assert.equal(calibrated.stats.maxEnergy, 6);
  assert.equal(calibrated.actions[0].power, calibrated.stats.effectivePower);
  assert.equal(calibrated.packets.root.damagePower, calibrated.stats.effectivePower);
});

test('spread3 multiplies aggregate power before allocating three projectiles', () => {
  const plan = compileBusterBuild(build(
    [node('emitter', 'pulseBolt'), node('split', 'spread3')],
    [edge('emitter', 'next', 'split')],
  ));

  approximately(plan.stats.effectivePower, 8.8);
  approximately(plan.stats.perChildPower, 8.8 / 3);
  approximately(plan.stats.cycleTime, 1 / 4.2 + 0.08);
  assert.equal(plan.stats.energyCost, 3);
  assert.equal(plan.stats.shotsPerCharge, 2);
  assert.equal(plan.stats.projectileCount, 3);
  assert.equal(plan.peakProjectileReservation, 3);
  assert.deepEqual(plan.splitter.angles, [-0.14, 0, 0.14]);
});

test('explosion replaces direct impact and uses its radius, cycle delay, and stagger rule', () => {
  const plan = compileBusterBuild(build(
    [node('emitter', 'pulseBolt'), node('payload', 'explosion')],
    [edge('emitter', 'next', 'payload')],
  ));

  assert.equal(plan.stats.effectivePower, 8);
  assert.equal(plan.payload.type, 'explosion');
  assert.equal(plan.payload.radius, 1.55);
  assert.equal(plan.payload.replacesDirect, true);
  approximately(plan.stats.cycleTime, 1 / 4.2 + 0.1);
  approximately(plan.stats.stagger, 8 * 0.015);
  assert.equal(plan.stats.energyCost, 3);
});

test('afterDelay plus cluster5 remains below the soft-cap knee and allocates once', () => {
  const plan = compileBusterBuild(build(
    [node('emitter', 'pulseBolt'), node('trigger', 'afterDelay'), node('split', 'cluster5')],
    [edge('emitter', 'next', 'trigger'), edge('trigger', 'child', 'split')],
  ));

  approximately(plan.stats.rawEffectivePower, 8 * 1.04 * 1.2);
  assert.equal(plan.stats.effectivePowerCap, 10);
  approximately(plan.stats.effectivePower, 8 * 1.04 * 1.2);
  approximately(plan.stats.perChildPower, (8 * 1.04 * 1.2) / 5);
  assert.equal(plan.stats.childRange, 6.9 * 0.65);
  approximately(plan.stats.cycleTime, 1 / 4.2 + 0.08 + 0.16);
  assert.equal(plan.stats.energyCost, 4);
  assert.equal(plan.peakProjectileReservation, 5);
  assert.equal(plan.trigger.delay, 0.6);
  assert.deepEqual(plan.actions.map((action) => action.type), ['emit', 'trigger', 'emit']);
  assert.equal(plan.actions[2].count, 5);
  assert.equal(plan.ledger.power.capClipped, 0);
  assert.equal(plan.preview.powerSoftCap, null);
  approximately(plan.powerLedger.at(-1).allocation.each, (8 * 1.04 * 1.2) / 5);
});

test('onImpact reserves the larger batch without overlapping its disposed carrier', () => {
  const plan = compileBusterBuild(build(
    [
      node('emitter', 'mortarShell'),
      node('trigger', 'onImpact', null),
      node('split', 'spread3'),
      node('payload', 'pulsePayload', null),
    ],
    [
      edge('emitter', 'next', 'trigger'),
      edge('trigger', 'child', 'split'),
      edge('split', 'next', 'payload'),
    ],
  ));

  approximately(plan.carrierPower, 15 * 0.2);
  approximately(plan.childPower, 15 * 0.8 * 1.1);
  approximately(plan.perChildPower, (15 * 0.8 * 1.1) / 3);
  assert.equal(plan.peakProjectileReservation, 3);
  assert.equal(plan.actions[1].disposeCarrier, true);
});

test('mortar supports atApex while pulse rejects it by compatibility tag', () => {
  const edges = [edge('emitter', 'next', 'trigger'), edge('trigger', 'child', 'payload')];
  const mortar = build([
    node('emitter', 'mortarShell'),
    node('trigger', 'atApex'),
    node('payload', 'explosion'),
  ], edges);
  assert.equal(validateBusterBuild(mortar).valid, true);
  assert.equal(compileBusterBuild(mortar).trigger.event, 'apex');

  const pulse = build([
    node('emitter', 'pulseBolt'),
    node('trigger', 'atApex'),
    node('payload', 'pulsePayload', null),
  ], edges);
  const validation = validateBusterBuild(pulse);
  assert.equal(validation.valid, false);
  assert.ok(errorCodes(validation).has('INCOMPATIBLE_MODULE'));
});

test('one guidance modifier is allowed independently in root and child scopes', () => {
  const source = build(
    [
      node('emitter', 'pulseBolt'),
      node('root-guide', 'pursuitGuidance'),
      node('trigger', 'afterDelay'),
      node('child-guide', 'pursuitGuidance'),
      node('payload', 'pulsePayload', null),
    ],
    [
      edge('emitter', 'next', 'root-guide'),
      edge('root-guide', 'next', 'trigger'),
      edge('trigger', 'child', 'child-guide'),
      edge('child-guide', 'next', 'payload'),
    ],
  );
  const plan = compileBusterBuild(source);
  assert.equal(plan.rootGuidance, true);
  assert.equal(plan.childGuidance, true);
  assert.equal(plan.preview.rootGuidance, true);
  assert.equal(plan.preview.childGuidance, true);
  assert.match(plan.description, /Pursuit Guidance \(root\).*Pursuit Guidance \(child\)/);
  approximately(plan.stats.effectivePower, 8 * 0.9 * 1.04 * 0.9);

  const invalid = build(
    [node('emitter', 'pulseBolt'), node('guide-a', 'pursuitGuidance'), node('guide-b', 'pursuitGuidance')],
    [edge('emitter', 'next', 'guide-a'), edge('guide-a', 'next', 'guide-b')],
  );
  assert.ok(errorCodes(validateBusterBuild(invalid)).has('TOO_MANY_MODIFIERS_IN_SCOPE'));
});

test('schema, tuning, capacity, and energy limits return structured errors', () => {
  const wrongTuning = build([node('emitter', 'pulseBolt')], [], {
    schemaVersion: 2,
    tuning: { power: 10, energy: 1, range: 1, rapid: 1 },
  });
  const basicCodes = errorCodes(validateBusterBuild(wrongTuning));
  assert.ok(basicCodes.has('UNSUPPORTED_SCHEMA_VERSION'));
  assert.ok(basicCodes.has('INVALID_TUNING_TOTAL'));

  const overCapacity = build(
    [
      node('emitter', 'pulseBolt'),
      node('guide-a', 'pursuitGuidance'),
      node('trigger', 'afterDelay'),
      node('guide-b', 'pursuitGuidance'),
      node('split', 'cluster5'),
      node('payload', 'explosion'),
    ],
    [
      edge('emitter', 'next', 'guide-a'),
      edge('guide-a', 'next', 'trigger'),
      edge('trigger', 'child', 'guide-b'),
      edge('guide-b', 'next', 'split'),
      edge('split', 'next', 'payload'),
    ],
  );
  assert.ok(errorCodes(validateBusterBuild(overCapacity)).has('CAPACITY_EXCEEDED'));

  const lowEnergy = build(
    [node('emitter', 'pulseBolt'), node('trigger', 'afterDelay'), node('split', 'cluster5')],
    [edge('emitter', 'next', 'trigger'), edge('trigger', 'child', 'split')],
    { tuning: { power: 5, energy: 1, range: 5, rapid: 5 } },
  );
  assert.ok(errorCodes(validateBusterBuild(lowEnergy)).has('INSUFFICIENT_ENERGY'));
});

test('graph validation rejects cycles, disconnected nodes, bad ports, joins, and invalid trigger edges', () => {
  const cyclic = build(
    [node('emitter', 'pulseBolt'), node('guide', 'pursuitGuidance')],
    [edge('emitter', 'next', 'guide'), edge('guide', 'next', 'emitter')],
  );
  const cyclicCodes = errorCodes(validateBusterBuild(cyclic));
  assert.ok(cyclicCodes.has('CYCLE'));
  assert.ok(cyclicCodes.has('ROOT_HAS_INCOMING_EDGE'));

  const malformed = build(
    [node('emitter', 'pulseBolt'), node('trigger', 'afterDelay'), node('orphan', 'pulsePayload', null)],
    [
      edge('emitter', 'child', 'trigger'),
      edge('emitter', 'side', 'orphan'),
      edge('trigger', 'next', 'orphan'),
    ],
  );
  const malformedCodes = errorCodes(validateBusterBuild(malformed));
  assert.ok(malformedCodes.has('INVALID_EDGE_PORT'));
  assert.ok(malformedCodes.has('CHILD_EDGE_REQUIRES_TRIGGER'));
  assert.ok(malformedCodes.has('TRIGGER_CHILD_REQUIRED'));
  assert.ok(malformedCodes.has('TRIGGER_NEXT_NOT_ALLOWED'));

  const joined = build(
    [node('emitter', 'pulseBolt'), node('a', 'pursuitGuidance'), node('b', 'pulsePayload', null)],
    [edge('emitter', 'next', 'b'), edge('a', 'next', 'b')],
  );
  const joinedCodes = errorCodes(validateBusterBuild(joined));
  assert.ok(joinedCodes.has('MULTIPLE_INCOMING_EDGES'));
  assert.ok(joinedCodes.has('DISCONNECTED'));
});

test('ownership context checks fabricated instances but exempts built-in nodes', () => {
  const source = build(
    [
      node('emitter', 'pulseBolt', 'owned-emitter'),
      node('trigger', 'onImpact', null),
      node('payload', 'pulsePayload', null),
    ],
    [edge('emitter', 'next', 'trigger'), edge('trigger', 'child', 'payload')],
  );
  const valid = validateBusterBuild(source, {
    ownedModuleInstanceIds: ['owned-emitter'],
    claimedModuleInstanceIds: [],
  });
  assert.equal(valid.valid, true);

  const notOwned = validateBusterBuild(source, {
    ownedModuleInstanceIds: [],
    claimedModuleInstanceIds: ['owned-emitter'],
  });
  const codes = errorCodes(notOwned);
  assert.ok(codes.has('INSTANCE_NOT_OWNED'));
  assert.ok(codes.has('INSTANCE_ALREADY_CLAIMED'));
  assert.equal(notOwned.errors.some((error) => error.moduleId === 'onImpact'), false);
  assert.equal(notOwned.errors.some((error) => error.moduleId === 'pulsePayload'), false);
  for (const error of notOwned.errors) {
    assert.deepEqual(Object.keys(error), ['code', 'path', 'moduleId', 'message']);
  }

  const missingPhysicalInstance = build([node('emitter', 'pulseBolt', null)]);
  assert.ok(errorCodes(validateBusterBuild(missingPhysicalInstance)).has('MODULE_INSTANCE_REQUIRED'));
});

test('ownership-free programs compile while physical assignment validation remains separate', () => {
  const blueprint = build([
    node('emitter', 'pulseBolt', null),
    node('payload', 'explosion', null),
  ], [edge('emitter', 'next', 'payload')]);

  assert.equal(validateBusterProgram(blueprint).valid, true);
  assert.ok(errorCodes(validateBusterBuild(blueprint)).has('MODULE_INSTANCE_REQUIRED'));
  assert.equal(compileBusterBuild(blueprint).payload.type, 'explosion');

  const buildA = build([node('emitter', 'pulseBolt', 'shared-emitter')], [], {
    buildId: 'build-a',
    chassisId: 'chassis-a',
  });
  const buildB = build([node('emitter', 'pulseBolt', 'shared-emitter')], [], {
    buildId: 'build-b',
    chassisId: 'chassis-b',
  });
  const assignments = validateBusterAssignments({
    builds: [buildA, buildB],
    chassisInventory: [{ chassisId: 'chassis-a' }, { chassisId: 'chassis-b' }],
    moduleInventory: [{ moduleInstanceId: 'shared-emitter', moduleId: 'pulseBolt' }],
    assignments: { slot2: 'build-a', slot3: 'build-b' },
  });
  assert.ok(errorCodes(assignments).has('INSTANCE_ALREADY_CLAIMED'));
});

test('semantic capacity counts built-ins but not an explicit native Pulse payload', () => {
  const source = build(
    [
      node('emitter', 'pulseBolt'),
      node('root-guide', 'pursuitGuidance'),
      node('trigger', 'afterDelay', null),
      node('child-guide', 'pursuitGuidance'),
      node('split', 'spread3'),
      node('payload', 'pulsePayload', null),
    ],
    [
      edge('emitter', 'next', 'root-guide'),
      edge('root-guide', 'next', 'trigger'),
      edge('trigger', 'child', 'child-guide'),
      edge('child-guide', 'next', 'split'),
      edge('split', 'next', 'payload'),
    ],
  );
  const validation = validateBusterProgram(source);
  assert.equal(validation.valid, true);
  assert.equal(validation.semanticCapacityUsed, 5);
  assert.equal(compileBusterBuild(source).stats.programCapacityUsed, 5);
});

test('graph traversal order is authoritative and direct Cluster is rejected', () => {
  const badOrder = build(
    [node('emitter', 'pulseBolt'), node('split', 'spread3'), node('guide', 'pursuitGuidance')],
    [edge('emitter', 'next', 'split'), edge('split', 'next', 'guide')],
  );
  assert.ok(errorCodes(validateBusterProgram(badOrder)).has('INVALID_MODULE_ORDER'));

  const directCluster = build(
    [node('emitter', 'pulseBolt'), node('cluster', 'cluster5')],
    [edge('emitter', 'next', 'cluster')],
  );
  assert.ok(errorCodes(validateBusterProgram(directCluster)).has('CHILD_ONLY_MODULE'));

  const shuffledArrays = build(
    [node('payload', 'explosion'), node('split', 'spread3'), node('emitter', 'pulseBolt')],
    [edge('split', 'next', 'payload'), edge('emitter', 'next', 'split')],
    { rootNodeId: 'emitter' },
  );
  const plan = compileBusterBuild(shuffledArrays);
  assert.equal(plan.splitter.moduleId, 'spread3');
  assert.equal(plan.payload.moduleId, 'explosion');
  assert.deepEqual(plan.programOrder.root, ['emitter', 'split', 'payload']);
});

test('After Delay rejects unreachable carriers and warns for a narrow valid window', () => {
  const nodes = [
    node('emitter', 'pulseBolt'),
    node('delay', 'afterDelay', null),
    node('payload', 'pulsePayload', null),
  ];
  const edges = [edge('emitter', 'next', 'delay'), edge('delay', 'child', 'payload')];
  const unreachable = validateBusterProgram(build(nodes, edges, {
    tuning: { power: 5, energy: 5, range: 1, rapid: 5 },
  }));
  assert.ok(errorCodes(unreachable).has('TRIGGER_UNREACHABLE'));

  const narrow = validateBusterProgram(build(nodes, edges, {
    tuning: { power: 5, energy: 4, range: 2, rapid: 5 },
  }));
  assert.equal(narrow.valid, true);
  assert.ok(new Set(narrow.warnings.map((warning) => warning.code)).has('TRIGGER_WINDOW_NARROW'));
  assert.ok(Object.isFrozen(narrow.warnings));
});

test('soft-cap math and diagnostic combat-depth scaling are deterministic and contained', () => {
  assert.equal(applyBusterPowerSoftCap(1.25), 1.25);
  approximately(applyBusterPowerSoftCap(1.26), 1.25 + 0.01 / 1.04);
  assert.ok(applyBusterPowerSoftCap(100) < 1.5);
  approximately(getBusterCombatDepthScalar(5, 1.18), 1.08);
  assert.equal(getBusterCombatDepthScalar(10, 1.18), 1.18);

  const source = build([node('emitter', 'pulseBolt')]);
  const canonical = compileBusterBuild(source, {
    combatDepthLevel: 5,
    level10PowerScalar: 1,
  });
  assert.equal(canonical.stats.combatDepthScalar, 1);
  assert.equal(canonical.stats.effectivePower, 8);
  assert.equal(canonical.diagnostic, undefined);

  const unauthorized = compileBusterBuild(source, {
    throwOnError: false,
    combatDepthLevel: 5,
    level10PowerScalar: 1.18,
  });
  assert.equal(unauthorized.ok, false);
  assert.ok(unauthorized.errors.some((error) => error.code === 'DIAGNOSTIC_CONTEXT_REQUIRED'));

  const plan = compileBusterBuild(source, {
    diagnosticContext: true,
    combatDepthLevel: 5,
    level10PowerScalar: 1.18,
  });
  assert.equal(plan.stats.combatDepthLevel, 5);
  approximately(plan.stats.combatDepthScalar, 1.08);
  approximately(plan.stats.depthScaledPower, 8 * 1.08);
  approximately(plan.stats.effectivePower, 8 * 1.08);
  assert.equal(plan.ledger.power.entries[1].stage, 'combat-depth');
  assert.equal(plan.preview.powerSoftCap, null);
  assert.equal(plan.diagnostic.overrideOnly, true);
  assert.deepEqual(plan.diagnostic.overrides, [{
    moduleId: 'ruleset',
    field: 'level10PowerScalar',
    catalogValue: 1,
    diagnosticValue: 1.18,
  }]);
});

test('diagnostic balance overrides are strict, immutable, and reflected throughout compilation', () => {
  const source = build(
    [
      node('emitter', 'mortarShell'),
      node('delay', 'afterDelay', null),
      node('cluster', 'cluster5'),
      node('payload', 'explosion'),
    ],
    [
      edge('emitter', 'next', 'delay'),
      edge('delay', 'child', 'cluster'),
      edge('cluster', 'next', 'payload'),
    ],
  );
  const plan = compileBusterBuild(source, {
    diagnosticContext: true,
    combatDepthLevel: 10,
    level10PowerScalar: 1.18,
    balanceOverrides: {
      mortarShell: { basePower: 17 },
      cluster5: { energyCost: 1 },
    },
  });

  assert.equal(plan.diagnostic.overrideOnly, true);
  assert.deepEqual(
    plan.diagnostic.overrides.map(({ moduleId, field }) => [moduleId, field]),
    [
      ['mortarShell', 'basePower'],
      ['cluster5', 'energyCost'],
      ['ruleset', 'level10PowerScalar'],
    ],
  );
  assert.equal(Object.isFrozen(plan.diagnostic.overrides), true);
  assert.equal(plan.stats.basePower, 17);
  assert.equal(plan.emitter.basePower, 17);
  assert.equal(plan.stats.energyCost, 5);
  assert.equal(plan.ledger.energy.energyCost, 5);
  assert.equal(
    plan.ledger.energy.entries.find((entry) => entry.moduleId === 'cluster5').energyCost,
    1,
  );
  approximately(plan.stats.depthScaledPower, 17 * 1.18);

  const withoutContext = compileBusterBuild(source, {
    throwOnError: false,
    balanceOverrides: { mortarShell: { basePower: 16 } },
  });
  assert.ok(withoutContext.errors.some((error) => error.code === 'DIAGNOSTIC_CONTEXT_REQUIRED'));

  const unsupported = compileBusterBuild(source, {
    throwOnError: false,
    diagnosticContext: true,
    balanceOverrides: { mortarShell: { baseRapid: 9 } },
  });
  assert.ok(unsupported.errors.some((error) => error.code === 'UNSUPPORTED_BALANCE_OVERRIDE'));

  const invalidEnergy = compileBusterBuild(source, {
    throwOnError: false,
    diagnosticContext: true,
    balanceOverrides: { cluster5: { energyCost: 3 } },
  });
  assert.ok(invalidEnergy.errors.some((error) => error.code === 'INSUFFICIENT_ENERGY'));
  assert.equal(invalidEnergy.diagnostic.overrideOnly, true);
  assert.deepEqual(invalidEnergy.diagnostic.overrides, [{
    moduleId: 'cluster5',
    field: 'energyCost',
    catalogValue: 2,
    diagnosticValue: 3,
  }]);
  assert.equal(Object.isFrozen(invalidEnergy.diagnostic), true);

  assert.throws(
    () => compileBusterBuild(source, {
      diagnosticContext: true,
      balanceOverrides: { cluster5: { energyCost: 3 } },
    }),
    (error) => {
      assert.ok(error instanceof BusterCompileError);
      assert.equal(error.diagnostic.overrideOnly, true);
      assert.equal(error.diagnostic.overrides[0].diagnosticValue, 3);
      return true;
    },
  );
});

test('normalization and serialization are canonical, pure, and retain unknown ids', () => {
  const source = build(
    [node('z', 'futureModule'), node('a', 'pulseBolt')],
    [edge('a', 'next', 'z')],
    { rootNodeId: 'a' },
  );
  const shuffled = build(
    [node('a', 'pulseBolt'), node('z', 'futureModule')],
    [edge('a', 'next', 'z')],
    { rootNodeId: 'a' },
  );
  const sourceSnapshot = structuredClone(source);

  assert.equal(serializeBusterBuild(source), serializeBusterBuild(shuffled));
  const normalized = normalizeBusterBuild(source);
  assert.deepEqual(normalizeBusterBuild(normalized), normalized);
  assert.deepEqual(source, sourceSnapshot);
  const restored = deserializeBusterBuild(serializeBusterBuild(source));
  assert.equal(restored.program.nodes.find((entry) => entry.nodeId === 'z').moduleId, 'futureModule');
  assert.ok(errorCodes(validateBusterBuild(restored)).has('UNKNOWN_MODULE'));
});

test('invalid compilation throws structured errors or returns them without substitution', () => {
  const source = build([node('emitter', 'futureEmitter')]);
  assert.throws(
    () => compileBusterBuild(source),
    (error) => {
      assert.ok(error instanceof BusterCompileError);
      assert.ok(Object.isFrozen(error.errors));
      assert.ok(error.errors.some((entry) => entry.code === 'UNKNOWN_MODULE' && entry.moduleId === 'futureEmitter'));
      return true;
    },
  );

  const result = compileBusterBuild(source, { throwOnError: false });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.code === 'UNKNOWN_MODULE'));
  assert.equal('plan' in result, false);
  assert.ok(Object.isFrozen(result));
});
