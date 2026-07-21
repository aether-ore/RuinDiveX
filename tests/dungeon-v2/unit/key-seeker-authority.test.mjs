import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonController } from '../../../src/DungeonController.js';

const KEY_SEEKER_ACTION_ID = 'action.activate.key-seeker';

function createControllerHarness({
  generationMode = 'v2',
  includePlanAction = true,
  actionResults = [],
} = {}) {
  const keySeeker = {
    id: 'reward.key-seeker',
    actionId: KEY_SEEKER_ACTION_ID,
    label: 'Key Seeker',
    position: new THREE.Vector3(3, 1, -2),
    activated: false,
    isActivated: false,
  };
  const progression = {
    keySeeker: { isActivated: false },
  };
  const action = {
    id: KEY_SEEKER_ACTION_ID,
    type: 'pickup',
    effects: [{ op: 'collectReward', rewardId: 'reward.key-seeker' }],
  };
  const calls = {
    actionIds: [],
    events: [],
    particles: 0,
    toasts: [],
  };
  let resultIndex = 0;
  const runtime = generationMode === 'v2'
    ? {
      activateAction(actionId) {
        calls.actionIds.push(actionId);
        const result = actionResults[Math.min(resultIndex, actionResults.length - 1)] ?? null;
        resultIndex += 1;
        if (result?.ok) calls.events.push({ type: 'action-operated', actionId });
        return result;
      },
    }
    : null;

  const controller = Object.create(DungeonController.prototype);
  controller.game = {
    player: { root: new THREE.Object3D() },
    addParticleBurst() { calls.particles += 1; },
    ui: {
      showToast(message, color) { calls.toasts.push({ message, color }); },
    },
  };
  controller.dungeon = { generationMode };
  controller.keySeeker = keySeeker;
  controller.progression = progression;
  controller.progressionManager = { hasKeycard: () => false };
  controller.dungeonV2Runtime = runtime;
  controller.dungeonV2Actions = includePlanAction ? [action] : [];
  controller.dungeonV2ActionById = new Map(
    controller.dungeonV2Actions.map((entry) => [entry.id, entry]),
  );
  controller.nearestInteractable = { kind: 'keySeeker', target: keySeeker };

  return { controller, keySeeker, progression, calls };
}

function assertNotCommitted({ keySeeker, progression, calls }) {
  assert.equal(keySeeker.activated, false);
  assert.equal(keySeeker.isActivated, false);
  assert.equal(progression.keySeeker.isActivated, false);
  assert.equal(calls.particles, 0);
  assert.equal(
    calls.toasts.some(({ message }) => message.startsWith('Key Seeker activated.')),
    false,
  );
}

test('V2 Key Seeker remains retryable after null and failed authoritative actions', () => {
  const harness = createControllerHarness({
    actionResults: [
      null,
      { ok: false, reason: 'conditions-not-met' },
      { ok: true, actionId: KEY_SEEKER_ACTION_ID },
    ],
  });

  assert.equal(harness.controller.activateNearest(), false);
  assertNotCommitted(harness);
  assert.equal(harness.calls.actionIds.length, 1);

  assert.equal(harness.controller.activateNearest(), false);
  assertNotCommitted(harness);
  assert.equal(harness.calls.actionIds.length, 2);

  assert.equal(harness.controller.activateNearest(), true);
  assert.equal(harness.keySeeker.activated, true);
  assert.equal(harness.keySeeker.isActivated, true);
  assert.equal(harness.progression.keySeeker.isActivated, true);
  assert.equal(harness.calls.particles, 1);
  assert.deepEqual(harness.calls.events, [
    { type: 'action-operated', actionId: KEY_SEEKER_ACTION_ID },
  ]);
  assert.equal(
    harness.calls.toasts.filter(({ message }) => message.startsWith('Key Seeker activated.')).length,
    1,
  );

  assert.equal(harness.controller.activateNearest(), false);
  assert.equal(harness.calls.actionIds.length, 3, 'committed activation must not call runtime twice');
  assert.equal(harness.calls.particles, 1);
  assert.equal(harness.calls.events.length, 1);
});

test('V2 Key Seeker cannot fall through to legacy activation when its plan action is missing', () => {
  const harness = createControllerHarness({
    includePlanAction: false,
    actionResults: [{ ok: true, actionId: KEY_SEEKER_ACTION_ID }],
  });

  assert.equal(harness.controller.activateNearest(), false);
  assertNotCommitted(harness);
  assert.deepEqual(harness.calls.actionIds, [], 'an undeclared action must not reach the runtime');

  assert.equal(harness.controller.activateNearest(), false);
  assertNotCommitted(harness);
});

test('legacy Key Seeker keeps its no-runtime activation behavior and commits once', () => {
  const harness = createControllerHarness({
    generationMode: 'legacy',
    includePlanAction: false,
  });

  assert.equal(harness.controller.activateNearest(), true);
  assert.equal(harness.keySeeker.activated, true);
  assert.equal(harness.keySeeker.isActivated, true);
  assert.equal(harness.progression.keySeeker.isActivated, true);
  assert.equal(harness.calls.particles, 1);
  assert.equal(
    harness.calls.toasts.filter(({ message }) => message.startsWith('Key Seeker activated.')).length,
    1,
  );

  assert.equal(harness.controller.activateNearest(), false);
  assert.equal(harness.calls.particles, 1);
});
