import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUSTER_MODULE_CATALOG,
  BusterCompileError,
  CUSTOM_BUSTER_RULESET,
  MEGA_BUSTER_BASE_PROFILE,
  MEGA_BUSTER_CALIBRATION_CATALOG,
  compileBusterBuild,
  deserializeBusterBuild,
  normalizeBusterBuild,
  serializeBusterBuild,
  validateBusterBuild,
} from '../src/buster/index.js';

const RULESET = 'custom-buster-v0.1';

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

test('the v0.1 catalog publishes the exact immutable module constants', () => {
  assert.deepEqual(
    {
      power: BUSTER_MODULE_CATALOG.pulseBolt.basePower,
      range: BUSTER_MODULE_CATALOG.pulseBolt.baseRange,
      rapid: BUSTER_MODULE_CATALOG.pulseBolt.baseRapid,
      speed: BUSTER_MODULE_CATALOG.pulseBolt.projectileSpeed,
      energy: BUSTER_MODULE_CATALOG.pulseBolt.energyCost,
    },
    { power: 8, range: 6.9, rapid: 4.2, speed: 9.5, energy: 1 },
  );
  assert.deepEqual(
    {
      power: BUSTER_MODULE_CATALOG.mortarShell.basePower,
      range: BUSTER_MODULE_CATALOG.mortarShell.baseRange,
      rapid: BUSTER_MODULE_CATALOG.mortarShell.baseRapid,
      speed: BUSTER_MODULE_CATALOG.mortarShell.projectileSpeed,
      energy: BUSTER_MODULE_CATALOG.mortarShell.energyCost,
    },
    { power: 15, range: 6.2, rapid: 1.15, speed: 5.8, energy: 1 },
  );
  assert.deepEqual(BUSTER_MODULE_CATALOG.spread3.angleOffsets, [-0.14, 0, 0.14]);
  assert.equal(BUSTER_MODULE_CATALOG.cluster5.radialCount, 5);
  assert.equal(BUSTER_MODULE_CATALOG.explosion.radius, 1.55);
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
  assert.equal(MEGA_BUSTER_BASE_PROFILE.baseMaxEnergy, 9);
  assert.equal(MEGA_BUSTER_BASE_PROFILE.energyCost, 3);
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
  assert.equal(plan.stats.energyCost, 1);
  assert.equal(plan.stats.baseRapid, 4.2);
  approximately(plan.stats.cycleTime, 1 / 4.2);
  assert.equal(plan.stats.finalRapid, 4.2);
  assert.equal(plan.stats.rootRange, 6.9);
  assert.equal(plan.stats.childRange, 4.485);
  assert.equal(plan.stats.shotsPerCharge, 6);
  assert.equal(plan.peakProjectileReservation, 1);
  assert.equal(plan.revision, 3);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].type, 'emit');
  assert.equal(plan.actions[0].payload.type, 'pulse');

  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.stats));
  assert.ok(Object.isFrozen(plan.actions[0].payload));
  assert.ok(!Object.isFrozen(source));
});

test('spread3 multiplies aggregate power before allocating three projectiles', () => {
  const plan = compileBusterBuild(build(
    [node('emitter', 'pulseBolt'), node('split', 'spread3')],
    [edge('emitter', 'next', 'split')],
  ));

  approximately(plan.stats.effectivePower, 8.8);
  approximately(plan.stats.perChildPower, 8.8 / 3);
  approximately(plan.stats.cycleTime, 1 / 4.2 + 0.08);
  assert.equal(plan.stats.energyCost, 2);
  assert.equal(plan.stats.shotsPerCharge, 3);
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
  assert.equal(plan.stats.energyCost, 2);
});

test('afterDelay plus cluster5 caps aggregate power before five-way allocation', () => {
  const plan = compileBusterBuild(build(
    [node('emitter', 'pulseBolt'), node('trigger', 'afterDelay'), node('split', 'cluster5')],
    [edge('emitter', 'next', 'trigger'), edge('trigger', 'child', 'split')],
  ));

  approximately(plan.stats.rawEffectivePower, 8 * 1.05 * 1.2);
  assert.equal(plan.stats.effectivePowerCap, 10);
  assert.equal(plan.stats.effectivePower, 10);
  assert.equal(plan.stats.perChildPower, 2);
  assert.equal(plan.stats.childRange, 6.9 * 0.65);
  approximately(plan.stats.cycleTime, 1 / 4.2 + 0.08 + 0.16);
  assert.equal(plan.stats.energyCost, 4);
  assert.equal(plan.peakProjectileReservation, 5);
  assert.equal(plan.trigger.delay, 0.6);
  assert.deepEqual(plan.actions.map((action) => action.type), ['emit', 'trigger', 'emit']);
  assert.equal(plan.actions[2].count, 5);
  assert.equal(plan.ledger.power.capClipped > 0, true);
  assert.equal(plan.powerLedger.at(-1).allocation.each, 2);
  assert.equal(plan.powerLedger.at(-1).outputPower, 2);
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
  approximately(plan.stats.effectivePower, 8 * 0.9 * 1.05 * 0.9);

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
