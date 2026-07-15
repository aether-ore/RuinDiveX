import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUSTER_BALANCE_TARGET_PROFILES,
  BUSTER_BENCHMARK_FIXTURE,
  createBusterBalanceScenarioMatrix,
  createBusterBatterySchedule,
  createBusterBenchmarkScenario,
  simulateBusterBalanceScenario,
  simulateBusterEncounter,
  simulateBusterRotation,
  summarizeBusterSimulation,
} from '../src/buster/BusterBalanceSimulator.js';
import {
  compileBusterBuild,
  compileMegaBusterPlan,
} from '../src/buster/compiler.js';
import { BusterRuntime } from '../src/buster/BusterRuntime.js';

const RULESET = 'custom-buster-v0.2';

function node(nodeId, moduleId, moduleInstanceId = `simulator:${nodeId}`) {
  return { nodeId, moduleId, moduleInstanceId };
}

function edge(from, port, to) {
  return { from, port, to };
}

function build(nodes, edges = [], {
  buildId = 'simulator-build',
  chassisId = 'simulator-chassis',
  tuning = { power: 4, energy: 4, range: 4, rapid: 4 },
} = {}) {
  return {
    schemaVersion: 1,
    rulesetVersion: RULESET,
    buildId,
    chassisId,
    tuning: { ...tuning },
    program: {
      rootNodeId: nodes[0].nodeId,
      nodes: nodes.map((entry) => ({ ...entry })),
      edges: edges.map((entry) => ({ ...entry })),
    },
  };
}

function compilePulse(buildId = 'simulator-pulse') {
  return compileBusterBuild(build(
    [node('emitter', 'pulseBolt')],
    [],
    { buildId, chassisId: `${buildId}:chassis` },
  ));
}

function compileMortar(buildId = 'simulator-mortar') {
  return compileBusterBuild(build(
    [node('emitter', 'mortarShell')],
    [],
    { buildId, chassisId: `${buildId}:chassis` },
  ));
}

function compileExplosion(buildId = 'simulator-explosion') {
  return compileBusterBuild(build(
    [node('emitter', 'pulseBolt'), node('payload', 'explosion')],
    [edge('emitter', 'next', 'payload')],
    { buildId, chassisId: `${buildId}:chassis` },
  ));
}

function benchmarkScenario(overrides = {}) {
  return createBusterBenchmarkScenario({
    level: 1,
    targetCount: 1,
    targetProfileId: 'ordinary',
    aimOffset: 'center',
    motion: 'stationary',
    distanceBand: 'near',
    layout: 'compact',
    ...overrides,
  });
}

function authoredTarget(id, priority, x, z) {
  const magnitude = Math.hypot(x, z) || 1;
  const forward = { x: x / magnitude, y: 0, z: z / magnitude };
  return {
    id,
    priority,
    radius: BUSTER_BENCHMARK_FIXTURE.targetRadius,
    collisionHeight: BUSTER_BENCHMARK_FIXTURE.targetHeight,
    root: { position: { x, y: 0, z } },
    home: { x, y: 0, z },
    forward,
    right: { x: forward.z, y: 0, z: -forward.x },
    motion: 'stationary',
    phase: 0,
    maxHealth: Number.POSITIVE_INFINITY,
    health: Number.POSITIVE_INFINITY,
    armor: 0,
    hasWeakPoint: false,
    weakPointMultiplier: 1,
    dead: false,
  };
}

function authoredScenario(targets, overrides = {}) {
  return {
    ...benchmarkScenario({ targetCount: targets.length, duration: 3, ...overrides }),
    targets,
    targetCount: targets.length,
    nonlethal: true,
  };
}

function readNumber(source, ...paths) {
  for (const path of paths) {
    let value = source;
    for (const part of path.split('.')) value = value?.[part];
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function shotTimes(schedule) {
  if (Array.isArray(schedule.shotTimes)) return schedule.shotTimes.slice();
  if (Array.isArray(schedule.shots)) {
    return schedule.shots.map((shot) => (
      typeof shot === 'number'
        ? shot
        : readNumber(shot, 'wallClock', 'wallTime', 'time', 'at')
    )).filter(Number.isFinite);
  }
  if (Array.isArray(schedule.events)) {
    return schedule.events.filter((event) => (
      event.type === 'shot' || event.type === 'fire' || event.status === 'FIRED'
    )).map((event) => readNumber(event, 'wallClock', 'wallTime', 'time', 'at'))
      .filter(Number.isFinite);
  }
  return [];
}

function assertExplicitResultState(result) {
  assert.equal(typeof result.status, 'string', 'simulations expose an explicit terminal status');
  assert.ok(
    readNumber(result, 'wallClock', 'wallClockSeconds', 'clocks.wall', 'clocks.wallSeconds') !== null,
    'simulations expose their wall clock',
  );
  assert.ok(
    readNumber(result, 'combatClock', 'combatClockSeconds', 'clocks.combat', 'clocks.combatSeconds') !== null,
    'simulations expose their combat clock',
  );
}

test('benchmark fixtures and the exhaustive scenario matrix are stable and immutable', () => {
  const fixedStep = readNumber(
    BUSTER_BENCHMARK_FIXTURE,
    'fixedStep',
    'fixedStepSeconds',
    'dt',
    'timeStep',
  );
  assert.equal(fixedStep, 1 / 120);
  assert.equal(BUSTER_BALANCE_TARGET_PROFILES.weakPoint.weakPointMultiplier, 2.4);
  assert.ok(Object.isFrozen(BUSTER_BENCHMARK_FIXTURE));
  assert.ok(Object.isFrozen(BUSTER_BALANCE_TARGET_PROFILES));

  const matrix = createBusterBalanceScenarioMatrix();
  // Center plus explicit positive/negative half-radius and edge offsets.
  assert.equal(matrix.length, 3 * 3 * 5 * 3 * 2 * 2 * 5);
  assert.equal(new Set(matrix.map((scenario) => scenario.id)).size, matrix.length);
  assert.ok(Object.isFrozen(matrix));
  assert.ok(matrix.every((scenario) => Object.isFrozen(scenario)));

  const scenario = benchmarkScenario({ level: 5, targetCount: 4, targetProfileId: 'armored' });
  assert.equal(scenario.level, 5);
  assert.equal(scenario.targetCount, 4);
  assert.equal(scenario.targetProfileId, 'armored');
  assert.ok(Object.isFrozen(scenario));
});

test('battery schedules use runtime magazine locking and publish status plus both clocks', () => {
  const schedule = createBusterBatterySchedule(compilePulse(), {
    duration: 4,
    durationSeconds: 4,
    fireHeld: true,
    fixedStep: 1 / 120,
  });
  const times = shotTimes(schedule);

  assertExplicitResultState(schedule);
  assert.ok(times.length >= 4, 'the schedule includes the first post-recovery shot');
  assert.ok(times[2] < 0.7, 'three Pulse shots leave the opening magazine at normal cadence');
  assert.ok(
    times[3] - times[2] >= 0.65 + 1.8 - 1 / 120,
    'the fourth shot waits for the successful-shot delay and a full locked refill',
  );
  assert.ok(Array.isArray(schedule.statuses) || Array.isArray(schedule.timeline));

  const clockSample = schedule.timeline?.find((entry) => (
    Number.isFinite(entry?.cycleRemaining) && Number.isFinite(entry?.rechargeDelayRemaining)
  )) ?? schedule.statuses?.find((entry) => (
    Number.isFinite(entry?.cycleRemaining) && Number.isFinite(entry?.rechargeDelayRemaining)
  ));
  assert.ok(clockSample, 'schedule samples preserve the independent cycle and recharge-delay clocks');
});

test('packet simulation is deterministic, keeps 10/30 output nonlethal, and still reports finite TTK', () => {
  const plan = compilePulse();
  const scenario = benchmarkScenario();
  const first = simulateBusterBalanceScenario(plan, scenario);
  const second = simulateBusterEncounter(plan, scenario);
  const finiteResult = simulateBusterEncounter(plan, benchmarkScenario({
    nonlethal: false,
  }));
  const finite = summarizeBusterSimulation(finiteResult);
  const summary = summarizeBusterSimulation(first);
  const repeated = summarizeBusterSimulation(second);

  assert.equal(simulateBusterEncounter, simulateBusterBalanceScenario, 'the encounter API is a true alias');
  assertExplicitResultState(first);
  assertExplicitResultState(summary);
  assert.ok(summary.output10s > 0);
  assert.ok(summary.output30s > summary.output10s, 'horizon output continues after benchmark targets would die');
  assert.ok(Number.isFinite(finite.singleTargetTtk));
  assert.ok(Number.isFinite(finite.roomClearTime));
  assert.ok(finite.singleTargetTtk > 0);
  const finiteRelease = finiteResult.transcript.find((event) => event.type === 'shot-release');
  const finiteFinalHit = finiteResult.transcript.filter((event) => event.type === 'direct-hit').at(-1);
  assert.ok(Math.abs(
    finite.roomClearTime - (finiteFinalHit.releaseTime - finiteRelease.releaseTime)
  ) < 1e-9, 'TTK uses the exact lethal packet timestamp rather than the outer frame boundary');
  assert.deepEqual(
    {
      output10s: repeated.output10s,
      output30s: repeated.output30s,
      singleTargetTtk: repeated.singleTargetTtk,
      roomClearTime: repeated.roomClearTime,
      peakProjectileOccupancy: repeated.peakProjectileOccupancy,
      misses: repeated.misses,
    },
    {
      output10s: summary.output10s,
      output30s: summary.output30s,
      singleTargetTtk: summary.singleTargetTtk,
      roomClearTime: summary.roomClearTime,
      peakProjectileOccupancy: summary.peakProjectileOccupancy,
      misses: summary.misses,
    },
  );
});

test('armored fixtures report exact incoming, delivered, and mitigated Power', () => {
  const result = simulateBusterEncounter(compilePulse('armored-mitigation-pulse'), benchmarkScenario({
    targetProfileId: 'armored',
    duration: 1,
  }), { duration: 1 });

  assert.ok(result.metrics.incomingPower > result.metrics.deliveredPower);
  assert.ok(result.metrics.mitigation > 0);
  assert.equal(result.metrics.mitigatedPower, result.metrics.mitigation);
  assert.ok(Math.abs(
    result.metrics.incomingPower
      - result.metrics.deliveredPower
      - result.metrics.mitigation
  ) < 1e-8);
});

test('diagnostic compile failures remain candidate-invalid in simulation', () => {
  const candidate = compileBusterBuild(build(
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
    { buildId: 'candidate-invalid-cluster' },
  ), {
    throwOnError: false,
    diagnosticContext: true,
    balanceOverrides: { cluster5: { energyCost: 10 } },
  });

  assert.equal(candidate.ok, false);
  assert.equal(candidate.diagnostic?.overrideOnly, true);
  assert.equal(
    simulateBusterEncounter(candidate, benchmarkScenario()).status,
    'candidate-invalid',
  );
});

test('Explosion is resolved as packet-level capsule splash across compact targets', () => {
  const scenario = benchmarkScenario({ targetCount: 4, layout: 'compact' });
  const pulse = summarizeBusterSimulation(simulateBusterBalanceScenario(compilePulse(), scenario));
  const explosion = summarizeBusterSimulation(simulateBusterBalanceScenario(compileExplosion(), scenario));

  assert.ok(explosion.explosions > 0);
  assert.ok(explosion.explosionTargetHits >= 2, 'one fiery sphere can touch multiple target capsules');
  assert.ok(
    explosion.deliveredEncounterPower > pulse.deliveredEncounterPower,
    'compact-group splash is evaluated per affected target instead of as one analytical multiplier',
  );
  assert.equal(explosion.weakPointHits, 0, 'Explosion splash is body/AoE damage only');
});

test('only authored weak-point profiles add a precision collision sphere', () => {
  const plan = compilePulse('weak-point-geometry-pulse');
  const ordinary = simulateBusterEncounter(plan, benchmarkScenario({
    targetProfileId: 'ordinary',
    duration: 1,
  }), { duration: 1 });
  const weakPoint = simulateBusterEncounter(plan, benchmarkScenario({
    targetProfileId: 'weakPoint',
    duration: 1,
  }), { duration: 1 });
  const ordinaryHit = ordinary.transcript.find((event) => event.type === 'direct-hit');
  const weakPointHit = weakPoint.transcript.find((event) => event.type === 'direct-hit');

  assert.equal(ordinaryHit?.weakPoint, false);
  assert.equal(ordinary.metrics.weakPointHits, 0);
  assert.equal(weakPointHit?.weakPoint, true);
  assert.ok(weakPoint.metrics.weakPointHits > 0);
});

test('triggered ballistic children retain the original production aim elevation', () => {
  const plan = compileBusterBuild(build(
    [node('emitter', 'mortarShell'), node('delay', 'afterDelay', null), node('payload', 'explosion')],
    [edge('emitter', 'next', 'delay'), edge('delay', 'child', 'payload')],
    { buildId: 'child-ballistic-endpoint' },
  ));
  const result = simulateBusterEncounter(plan, benchmarkScenario({
    distanceBand: 'mid',
    duration: 2,
  }), { duration: 2 });
  const childSpawn = result.transcript.find((event) => (
    event.type === 'projectile-spawn' && event.scope === 'child'
  ));

  assert.ok(childSpawn, 'the delayed child projectile is emitted');
  assert.ok(
    childSpawn.position.y > BUSTER_BENCHMARK_FIXTURE.bodyAimHeight + 0.5,
    'the carrier triggers while elevated on its ballistic arc',
  );
  assert.equal(
    childSpawn.trajectoryEndY,
    BUSTER_BENCHMARK_FIXTURE.bodyAimHeight,
    'the child descends toward the original release-time aim point, not its elevated spawn point',
  );
});

test('root Guidance preserves its valid lock while child Guidance reacquires in range', () => {
  const rootGuided = compileBusterBuild(build(
    [node('emitter', 'pulseBolt'), node('guidance', 'pursuitGuidance')],
    [edge('emitter', 'next', 'guidance')],
    { buildId: 'root-guidance-lock' },
  ));
  const rootScenario = authoredScenario([
    authoredTarget('target-01', 0, 2, 6),
    authoredTarget('target-02', 1, -2, 2),
  ], { duration: 2 });
  const rootResult = simulateBusterEncounter(rootGuided, rootScenario, { duration: 2 });
  const rootSelection = rootResult.transcript.find((event) => (
    event.type === 'guidance-target' && event.scope === 'root'
  ));
  const rootHit = rootResult.transcript.find((event) => event.type === 'direct-hit');

  assert.deepEqual(
    { targetId: rootSelection?.targetId, locked: rootSelection?.locked },
    { targetId: 'target-01', locked: true },
  );
  assert.equal(rootHit?.targetId, 'target-01');

  const childGuided = compileBusterBuild(build(
    [
      node('emitter', 'mortarShell'),
      node('delay', 'afterDelay', null),
      node('guidance', 'pursuitGuidance'),
      node('payload', 'explosion'),
    ],
    [
      edge('emitter', 'next', 'delay'),
      edge('delay', 'child', 'guidance'),
      edge('guidance', 'next', 'payload'),
    ],
    { buildId: 'child-guidance-reacquire' },
  ));
  const childScenario = authoredScenario([
    authoredTarget('target-01', 0, 2, 6),
    authoredTarget('target-02', 1, -0.5, 3.3),
  ]);
  const childResult = simulateBusterEncounter(childGuided, childScenario, { duration: 2 });
  const childSelection = childResult.transcript.find((event) => (
    event.type === 'guidance-target' && event.scope === 'child'
  ));

  assert.deepEqual(
    { targetId: childSelection?.targetId, locked: childSelection?.locked },
    { targetId: 'target-02', locked: false },
    'the child does not inherit the carrier lock and instead uses production nearest/stable-ID acquisition',
  );

  const rangeLimitedChild = {
    ...childGuided,
    buildId: 'child-guidance-range-limit',
    weaponKey: 'child-guidance-range-limit',
    actions: childGuided.actions.map((action) => (
      action.type === 'emit' && action.scope === 'child'
        ? { ...action, range: 1 }
        : action
    )),
  };
  const rangeLimitedResult = simulateBusterEncounter(
    rangeLimitedChild,
    childScenario,
    { duration: 2 },
  );
  assert.equal(
    rangeLimitedResult.transcript.some((event) => (
      event.type === 'guidance-target' && event.scope === 'child'
    )),
    false,
    'free child Guidance does not acquire a target outside its production homing Range',
  );
});

test('trigger and guided-child lifecycle results are stable at 30/60/120 Hz and a large step', () => {
  const delayGuidedCluster = compileBusterBuild(build(
    [
      node('emitter', 'mortarShell'),
      node('delay', 'afterDelay', null),
      node('guidance', 'pursuitGuidance'),
      node('cluster', 'cluster5'),
      node('payload', 'explosion'),
    ],
    [
      edge('emitter', 'next', 'delay'),
      edge('delay', 'child', 'guidance'),
      edge('guidance', 'next', 'cluster'),
      edge('cluster', 'next', 'payload'),
    ],
    { buildId: 'lifecycle-delay-guided-cluster' },
  ));
  const apex = compileBusterBuild(build(
    [node('emitter', 'mortarShell'), node('apex', 'atApex'), node('payload', 'explosion')],
    [edge('emitter', 'next', 'apex'), edge('apex', 'child', 'payload')],
    { buildId: 'lifecycle-apex' },
  ));
  const terminal = compileBusterBuild(build(
    [node('emitter', 'pulseBolt'), node('impact', 'onImpact', null), node('payload', 'explosion')],
    [edge('emitter', 'next', 'impact'), edge('impact', 'child', 'payload')],
    { buildId: 'lifecycle-terminal' },
  ));
  const scenario = benchmarkScenario({ distanceBand: 'mid', duration: 4 });
  const steps = [1 / 30, 1 / 60, 1 / 120, 0.35];

  const firstExecutionEvents = (plan, timeStep) => {
    const result = simulateBusterEncounter(plan, scenario, { duration: 4, timeStep });
    const release = result.transcript.find((event) => event.type === 'shot-release');
    return result.transcript.filter((event) => event.executionId === release?.executionId);
  };
  let delayedDeliveryTimes = null;
  for (const timeStep of steps) {
    const delayed = firstExecutionEvents(delayGuidedCluster, timeStep);
    const delayedTrigger = delayed.find((event) => event.type === 'child-trigger');
    assert.equal(delayedTrigger?.reason, 'delayTrigger');
    assert.equal(delayedTrigger?.releaseTime, 0.6);
    assert.equal(delayed.filter((event) => event.type === 'explosion').length, 5);
    assert.equal(delayed.filter((event) => event.type === 'explosion-hit').length, 5);
    const deliveryTimes = delayed
      .filter((event) => event.type === 'explosion')
      .map((event) => event.releaseTime)
      .sort((left, right) => left - right);
    if (delayedDeliveryTimes == null) delayedDeliveryTimes = deliveryTimes;
    else assert.deepEqual(
      deliveryTimes,
      delayedDeliveryTimes,
      'children drain the carrier frame remainder instead of waiting for the next outer tick',
    );

    const apexEvents = firstExecutionEvents(apex, timeStep);
    assert.equal(apexEvents.filter((event) => event.type === 'child-trigger').length, 1);
    assert.equal(
      apexEvents.find((event) => event.type === 'child-trigger')?.reason,
      'apexTrigger',
    );
    assert.equal(apexEvents.filter((event) => event.type === 'explosion').length, 1);

    const terminalEvents = firstExecutionEvents(terminal, timeStep);
    assert.equal(terminalEvents.filter((event) => event.type === 'child-trigger').length, 1);
    assert.equal(
      terminalEvents.find((event) => event.type === 'child-trigger')?.reason,
      'terminalRelay',
    );
    assert.equal(terminalEvents.filter((event) => event.type === 'direct-hit').length, 1);
    assert.equal(terminalEvents.filter((event) => event.type === 'explosion-hit').length, 1);
  }
});

test('30/60 second rotations use stable plan-order ties, swaps, brace time, and inactive recharge', () => {
  const neutralMega = compileMegaBusterPlan({
    resolvedTuning: { power: 4, energy: 4, range: 4, rapid: 4 },
    calibrationRevision: 1,
  });
  const liveMega = compileMegaBusterPlan({
    resolvedTuning: { power: 6, energy: 4, range: 4, rapid: 4 },
    calibrationRevision: 2,
  });
  const customPlans = [compilePulse('rotation-pulse'), compileMortar('rotation-mortar')];
  const options = {
    canonicalPlans: [neutralMega, ...customPlans],
    livePlans: [liveMega, ...customPlans],
    plans: [liveMega, ...customPlans],
    scenario: benchmarkScenario(),
    durations: [30, 60],
    durationSeconds: 60,
    fixedStep: 1 / 120,
  };
  const first = simulateBusterRotation(options);
  const second = simulateBusterRotation(options);

  assertExplicitResultState(first);
  assert.equal(first.status, 'bounded');
  assert.equal(first.exact, false);
  assert.equal(first.optimality, 'unproven');
  assert.equal(first.inputPolicy, 'precision-tap/no-insufficient-requests');
  assert.deepEqual(first.searchPolicy, {
    consecutiveNoFireSwaps: 'omitted-unproven',
    statePrecisionDecimals: 6,
    movingScenarios: 'unsupported',
  });
  assert.ok(first.rotationOutput30s > 0);
  assert.ok(first.rotationOutput60s > first.rotationOutput30s);
  assert.equal(first.outputLowerBound30s, first.rotationOutput30s);
  assert.equal(first.outputLowerBound60s, first.rotationOutput60s);
  assert.ok(first.rotationSwaps > 0);
  assert.ok(first.rotationBraceTime > 0);
  assert.ok(Math.abs(first.rotationBraceTime - (0.18 * (first.rotationSwaps + 1))) < 1e-9);
  assert.ok(Math.abs(first.rotationSwapTime - (0.34 * first.rotationSwaps)) < 1e-9);
  assert.ok(Math.abs(
    first.rotationTransitionLockTime - (first.rotationBraceTime + first.rotationSwapTime),
  ) < 1e-9);
  assert.deepEqual(first.transitions, { 30: 120001, 60: 120001 });
  assert.equal(first.termination[30].reason, 'transition-limit');
  assert.equal(first.termination[60].reason, 'transition-limit');
  assert.ok(Number.isFinite(first.rotationAdvantageRatio));
  assert.ok(first.rotationAdvantageRatio > 0);

  const runtime = new BusterRuntime({ executeShot: () => true });
  for (const plan of options.plans) runtime.register(plan);
  let activeWeaponKey = options.plans[0].weaponKey;
  let replayTime = 0;
  for (const event of first.transcript) {
    if (event.type === 'fire') {
      const elapsed = Math.max(0, event.inputTime - replayTime);
      runtime.update(elapsed, { activeWeaponKey });
      replayTime += elapsed;
      assert.equal(event.weaponKey, activeWeaponKey);
      const fired = runtime.fire({ rotationReplay: true }, activeWeaponKey);
      assert.equal(fired.ok, true, JSON.stringify({ event, hud: runtime.getHudState(activeWeaponKey) }));
      runtime.releaseReservation(fired.execution.reservationToken);
      continue;
    }
    if (event.type === 'swap') activeWeaponKey = event.weaponKey;
    runtime.update(event.duration, { activeWeaponKey });
    replayTime += event.duration;
  }
  assert.deepEqual(
    {
      output30s: second.rotationOutput30s,
      output60s: second.rotationOutput60s,
      swaps: second.rotationSwaps,
      brace: second.rotationBraceTime,
      ratio: second.rotationAdvantageRatio,
      order: second.weaponOrder ?? second.planOrder,
    },
    {
      output30s: first.rotationOutput30s,
      output60s: first.rotationOutput60s,
      swaps: first.rotationSwaps,
      brace: first.rotationBraceTime,
      ratio: first.rotationAdvantageRatio,
      order: first.weaponOrder ?? first.planOrder,
    },
    'fixed-step rotation and stable plan-order ties are reproducible',
  );
});

test('rotation delivery profiles reject moving scenarios instead of reusing a time-zero packet', () => {
  const plans = [
    compileMegaBusterPlan({
      resolvedTuning: { power: 6, energy: 4, range: 4, rapid: 4 },
      calibrationRevision: 2,
    }),
    compilePulse('moving-rotation-pulse'),
    compileMortar('moving-rotation-mortar'),
  ];
  const result = simulateBusterRotation({
    plans,
    scenario: benchmarkScenario({ motion: 'lateral' }),
    horizons: [5],
  });
  assert.deepEqual(result, {
    status: 'unavailable',
    reason: 'rotation-requires-stationary-scenario',
    exact: false,
    optimality: 'unproven',
    wallClock: 0,
    combatClock: 0,
    clocks: { input: 0, release: 0, wall: 0, combat: 0 },
  });
});
