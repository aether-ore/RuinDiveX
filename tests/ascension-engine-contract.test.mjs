import assert from 'node:assert/strict';
import test from 'node:test';

import { getReaverbotBossProfile } from '../src/reaverbots/ReaverbotBossCatalog.js';
import {
  ASCENSION_ENGINE_ATTACK_DECKS,
  ASCENSION_ENGINE_ENCOUNTER_REVISION,
  ASCENSION_ENGINE_MODES,
  ASCENSION_ENGINE_PROFILE_ID,
  ASCENSION_ENGINE_SEAL_COUNT,
  ASCENSION_ENGINE_TUNING,
  ASCENSION_RELIQUARY_CHECKPOINTS,
  ASCENSION_RELIQUARY_SCALE,
  ASCENSION_RELIQUARY_SEGMENTS,
  breakAscensionSeal,
  createAscensionAttackSequence,
  createAscensionEngineState,
  getAscensionCheckpoint,
  getAscensionTraversalDiagnostics,
  normalizeAscensionCheckpoint,
} from '../src/reaverbots/bosses/AscensionEngineContract.js';

const EXPECTED_CHECKPOINT_IDS = Object.freeze([
  'ascensionCheckpoint:initialFloor',
  'ascensionCheckpoint:compressionFoundry',
  'ascensionCheckpoint:brokenElevatorSpine',
  'ascensionCheckpoint:suspendedMachinerySea',
]);

test('Ascension Engine exposes four stable, bounded checkpoint identities', () => {
  assert.equal(ASCENSION_ENGINE_ENCOUNTER_REVISION, 2);
  assert.equal(ASCENSION_ENGINE_SEAL_COUNT, 4);
  assert.equal(ASCENSION_RELIQUARY_SEGMENTS.length, ASCENSION_ENGINE_SEAL_COUNT);
  assert.equal(ASCENSION_RELIQUARY_CHECKPOINTS.length, ASCENSION_ENGINE_SEAL_COUNT);
  assert.deepEqual(
    ASCENSION_RELIQUARY_CHECKPOINTS.map((checkpoint) => checkpoint.id),
    EXPECTED_CHECKPOINT_IDS,
  );
  assert.deepEqual(
    ASCENSION_RELIQUARY_CHECKPOINTS.map((checkpoint) => checkpoint.index),
    [0, 1, 2, 3],
  );
  assert.ok(ASCENSION_RELIQUARY_CHECKPOINTS.every(Object.isFrozen));

  assert.equal(normalizeAscensionCheckpoint(-50), 0);
  assert.equal(normalizeAscensionCheckpoint(2.9), 2);
  assert.equal(normalizeAscensionCheckpoint(99), 3);
  assert.equal(normalizeAscensionCheckpoint('not-a-checkpoint'), 0);
  assert.strictEqual(getAscensionCheckpoint(99), ASCENSION_RELIQUARY_CHECKPOINTS[3]);
  assert.strictEqual(getAscensionCheckpoint(EXPECTED_CHECKPOINT_IDS[2]), ASCENSION_RELIQUARY_CHECKPOINTS[2]);
  assert.equal(getAscensionCheckpoint('ascensionCheckpoint:unknown'), null);

  const resumed = createAscensionEngineState({ checkpointIndex: 3 });
  assert.equal(resumed.revision, ASCENSION_ENGINE_ENCOUNTER_REVISION);
  assert.equal(resumed.segmentIndex, 3);
  assert.equal(resumed.securedCheckpoint, 3);
  assert.equal(resumed.securedCheckpointId, EXPECTED_CHECKPOINT_IDS[3]);
  assert.deepEqual(resumed.brokenSeals, [true, true, true, false]);
  assert.equal(resumed.mode, ASCENSION_ENGINE_MODES.ESCAPE);
});

test('the Reliquary declares a dungeon-scale shaft, traversal path, and summit arena', () => {
  const diagnostics = getAscensionTraversalDiagnostics();
  const ordinaryRoomMinimumWidth = 15 * 2.8;
  const ordinaryRoomMinimumDepth = 13 * 2.8;
  const ordinaryBossRoomMinimumDimension = 19 * 2.8;
  const ordinaryMiniDungeonHeight = 15.6;

  assert.ok(Object.isFrozen(ASCENSION_RELIQUARY_SCALE));
  assert.ok(
    ASCENSION_RELIQUARY_SCALE.chamberDiameter >= ordinaryRoomMinimumWidth,
    'every chamber must be at least as wide as an ordinary functional ruin room',
  );
  assert.ok(
    ASCENSION_RELIQUARY_SCALE.chamberDiameter >= ordinaryRoomMinimumDepth,
    'every chamber must be at least as deep as an ordinary functional ruin room',
  );
  assert.ok(
    ASCENSION_RELIQUARY_SCALE.summitRadius * 2 >= ordinaryBossRoomMinimumDimension,
    'the summit must offer at least the narrow dimension of the ordinary boss room',
  );
  assert.ok(
    ASCENSION_RELIQUARY_SCALE.shellHeight >= ordinaryMiniDungeonHeight * ASCENSION_ENGINE_SEAL_COUNT,
    'four stacked chambers must occupy at least four ordinary mini-dungeon heights',
  );
  assert.ok(ASCENSION_RELIQUARY_SCALE.summitCombatRadius < ASCENSION_RELIQUARY_SCALE.summitRadius);
  assert.ok(ASCENSION_RELIQUARY_SCALE.voidRadius < ASCENSION_RELIQUARY_SCALE.playableRadius);

  assert.equal(diagnostics.playableDiameter, ASCENSION_RELIQUARY_SCALE.chamberDiameter);
  assert.equal(diagnostics.summitDiameter, ASCENSION_RELIQUARY_SCALE.summitRadius * 2);
  assert.ok(diagnostics.totalRise >= ordinaryMiniDungeonHeight * ASCENSION_ENGINE_SEAL_COUNT);
  assert.ok(
    diagnostics.totalCriticalPathLength
      >= ASCENSION_RELIQUARY_SCALE.minimumChamberPathLength * ASCENSION_ENGINE_SEAL_COUNT,
    'the complete pursuit must span at least four ordinary room-depth traversal runs',
  );
  assert.ok(
    diagnostics.segments.slice(0, -1).every((segment) => (
      segment.criticalPathLength >= ASCENSION_RELIQUARY_SCALE.minimumChamberPathLength
    )),
    'each pursuit chamber must contain a full room-scale critical path before the short summit trial',
  );
});

test('seals break only in exact order and each nonfinal seal advances one durable checkpoint', () => {
  let state = createAscensionEngineState();
  assert.deepEqual(state.brokenSeals, [false, false, false, false]);
  assert.equal(state.mode, ASCENSION_ENGINE_MODES.TRAVERSAL);

  for (let sealIndex = 0; sealIndex < ASCENSION_ENGINE_SEAL_COUNT; sealIndex += 1) {
    const outOfOrder = breakAscensionSeal(
      { ...state, activeSealIndex: sealIndex },
      Math.min(ASCENSION_ENGINE_SEAL_COUNT - 1, sealIndex + 1),
    );
    if (sealIndex < ASCENSION_ENGINE_SEAL_COUNT - 1) {
      assert.equal(outOfOrder.ok, false);
      assert.equal(outOfOrder.reason, 'wrong-seal');
      assert.strictEqual(outOfOrder.state.brokenSeals, state.brokenSeals);
    }

    const previous = state;
    const ready = {
      ...state,
      mode: sealIndex === ASCENSION_ENGINE_SEAL_COUNT - 1
        ? ASCENSION_ENGINE_MODES.FINAL_CHARGE
        : ASCENSION_ENGINE_MODES.PUNISH,
      activeSealIndex: sealIndex,
    };
    const result = breakAscensionSeal(ready, sealIndex);
    assert.equal(result.ok, true);
    assert.equal(previous.brokenSeals[sealIndex], false, 'the input state remains unchanged');
    assert.equal(result.state.brokenSeals[sealIndex], true);

    if (sealIndex < ASCENSION_ENGINE_SEAL_COUNT - 1) {
      assert.equal(result.completed, false);
      assert.equal(result.checkpointIndex, sealIndex + 1);
      assert.equal(result.checkpointId, EXPECTED_CHECKPOINT_IDS[sealIndex + 1]);
      assert.equal(result.state.segmentIndex, sealIndex + 1);
      assert.equal(result.state.securedCheckpoint, sealIndex + 1);
      assert.equal(result.state.mode, ASCENSION_ENGINE_MODES.ESCAPE);
    } else {
      assert.equal(result.completed, true);
      assert.equal(result.checkpointIndex, 3, 'victory is committed separately from the last durable checkpoint');
      assert.equal(result.state.mode, ASCENSION_ENGINE_MODES.DEFEATED);
      assert.deepEqual(result.state.brokenSeals, [true, true, true, true]);
    }
    state = result.state;
  }

  const afterVictory = breakAscensionSeal(state, 3);
  assert.equal(afterVictory.ok, false);
  assert.equal(afterVictory.reason, 'inactive');
});

test('seeded attack decks are deterministic permutations of their authored chamber decks', () => {
  const snapshots = [
    ['targetedPounce', 'foundryVentImpact', 'targetedPounce'],
    ['wallRebound', 'counterweightImpact', 'wallRebound'],
    ['boosterWash', 'launchChain', 'launchChain'],
    ['emergencyPogo', 'doubleRebound', 'targetedPounce', 'skyfallBreaker', 'compressionSweep'],
  ];

  for (const segment of ASCENSION_RELIQUARY_SEGMENTS) {
    const first = createAscensionAttackSequence({
      seed: 'contract-seed',
      segmentIndex: segment.index,
      cycle: 0,
    });
    const repeated = createAscensionAttackSequence({
      seed: 'contract-seed',
      segmentIndex: segment.index,
      cycle: 0,
    });
    assert.deepEqual(first, repeated);
    assert.deepEqual(first, snapshots[segment.index]);
    assert.deepEqual([...first].sort(), [...ASCENSION_ENGINE_ATTACK_DECKS[segment.id]].sort());
    assert.ok(Object.isFrozen(first));
  }

  assert.notDeepEqual(
    createAscensionAttackSequence({ seed: 'contract-seed', segmentIndex: 3, cycle: 0 }),
    createAscensionAttackSequence({ seed: 'contract-seed', segmentIndex: 3, cycle: 1 }),
  );
});

test('the authored route is reachable but cannot be completed as an ordinary jump staircase', () => {
  const diagnostics = getAscensionTraversalDiagnostics();
  const routeCount = ASCENSION_RELIQUARY_SEGMENTS
    .reduce((total, segment) => total + segment.route.length, 0);
  const traversalSegments = ASCENSION_RELIQUARY_SEGMENTS.slice(0, -1);
  const authoredRouteDiagnostics = diagnostics.routes.filter((route) => route.role !== 'sealStation');
  const terminalDiagnostics = diagnostics.routes.filter((route) => route.role === 'sealStation');

  assert.ok(traversalSegments.every((segment) => segment.route.length >= 6));
  assert.equal(authoredRouteDiagnostics.length, routeCount);
  assert.equal(diagnostics.routes.length, routeCount + ASCENSION_ENGINE_SEAL_COUNT);
  assert.equal(terminalDiagnostics.length, ASCENSION_ENGINE_SEAL_COUNT);
  assert.equal(diagnostics.segments.length, ASCENSION_ENGINE_SEAL_COUNT);
  assert.deepEqual(
    diagnostics.segments.map((segment) => segment.routeStepCount),
    ASCENSION_RELIQUARY_SEGMENTS.map((segment) => segment.route.length),
  );
  for (const segment of ASCENSION_RELIQUARY_SEGMENTS) {
    assert.deepEqual(
      segment.route.map((route) => route.sequence),
      Array.from({ length: segment.route.length }, (_, index) => index),
      `${segment.id} must preserve an exact, gap-free impact sequence`,
    );
  }
  assert.equal(diagnostics.reachable, true);
  assert.equal(diagnostics.requiresBossMechanics, true);
  assert.equal(diagnostics.masteryShortcuts.length, ASCENSION_ENGINE_SEAL_COUNT);
  assert.equal(diagnostics.masteryRouteReachable, true);
  assert.equal(diagnostics.masteryRouteRequiresJumpSprings, true);
  assert.equal(diagnostics.summitLaunch.reachable, true);
  assert.ok(diagnostics.summitLaunch.apexRise > diagnostics.summitLaunch.requiredRise);
  assert.equal(diagnostics.summitLaunch.landingRadius, ASCENSION_RELIQUARY_SCALE.summitRadius);
  assert.ok(authoredRouteDiagnostics.every((route) => route.impactGated));
  assert.ok(terminalDiagnostics.every((route) => !route.impactGated && route.requiresPriorImpact));
  assert.ok(diagnostics.segments.every((segment) => segment.complete));
  assert.ok(diagnostics.masteryShortcuts.every((route) => (
    !route.normallyReachable && route.jumpSpringsReachable
  )));
  assert.ok(diagnostics.routes.every((route) => route.reachable));
  assert.ok(diagnostics.routes
    .filter((route) => ['launchVent', 'momentum', 'counterweight'].includes(route.role))
    .every((route) => route.mechanismReachable));
  assert.ok(diagnostics.landingSafetyInset > 0);
  assert.ok(diagnostics.routes
    .filter((route) => route.assisted && route.launchHorizontalTravel > 0)
    .every((route) => route.launchReachable
      && route.launchLandingError <= route.launchLandingHalfExtent));
  assert.ok(diagnostics.routes.some((route) => (
    route.impactGated && route.mechanismRise > diagnostics.maximumNormalRise
  )));
  assert.ok(diagnostics.routes.some((route) => !route.assisted && route.normallyJumpable));
  assert.ok(
    ASCENSION_RELIQUARY_SEGMENTS
      .flatMap((segment) => segment.route)
      .every((step) => Math.min(step.size[0], step.size[2]) >= diagnostics.minimumLandingWidth),
  );
});

test('four equal health segments enter phase two only after the third seal', () => {
  const bossProfile = getReaverbotBossProfile(ASCENSION_ENGINE_PROFILE_ID);
  const summitThreshold = 1 - (ASCENSION_ENGINE_SEAL_COUNT - 1) * ASCENSION_ENGINE_TUNING.segmentHealthRatio;
  assert.equal(ASCENSION_ENGINE_TUNING.segmentHealthRatio, 0.25);
  assert.equal(summitThreshold, 0.25);
  assert.equal(bossProfile.combat.phaseThreshold, summitThreshold);

  let state = createAscensionEngineState();
  for (let index = 0; index < 3; index += 1) {
    state = breakAscensionSeal({ ...state, mode: ASCENSION_ENGINE_MODES.PUNISH, activeSealIndex: index }, index).state;
  }
  assert.deepEqual(state.brokenSeals, [true, true, true, false]);
  assert.equal(state.segmentIndex, 3);
  assert.equal(state.securedCheckpoint, 3);
  assert.equal(state.mode, ASCENSION_ENGINE_MODES.ESCAPE);
});
