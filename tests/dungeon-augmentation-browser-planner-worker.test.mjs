import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  DUNGEON_AUGMENTATION_BROWSER_PLANNER_REQUEST_SCHEMA,
  DUNGEON_AUGMENTATION_BROWSER_PLANNER_RESPONSE_SCHEMA,
  createDungeonAugmentationBrowserPlannerSession,
  planDungeonAugmentationInBrowserWorker,
} from '../src/dungeon-augmentation/BrowserPlannerWorkerClient.js';
import {
  createDungeonAugmentationBrowserPlannerWorkerState,
} from '../src/dungeon-augmentation/BrowserPlannerWorker.js';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';

class FakeWorker {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.listeners = new Map();
    this.messages = [];
    this.terminated = false;
    FakeWorker.instances.push(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function latestWorker() {
  return FakeWorker.instances.at(-1);
}

test('browser planner session reuses one worker and sends the invariant once', async () => {
  FakeWorker.instances.length = 0;
  let clock = 10;
  const session = createDungeonAugmentationBrowserPlannerSession({
    WorkerImplementation: FakeWorker,
    workerUrl: new URL('https://example.test/planner-worker.js'),
    timeoutMs: 1_000,
    now: () => clock,
  });
  const firstPromise = session.plan({
    baseDraft: { basePlanHash: 'base-a' },
    routeNetworkPlanResultCache: new Map([['stale-main-thread-entry', true]]),
  }, { realizationAttempt: 0 });
  const firstWorker = latestWorker();
  assert.deepEqual(firstWorker.options, {
    type: 'module',
    name: 'dungeon-augmentation-planner',
  });
  const firstRequest = firstWorker.messages[0];
  assert.equal(firstRequest.schema, DUNGEON_AUGMENTATION_BROWSER_PLANNER_REQUEST_SCHEMA);
  assert.equal(firstRequest.realizationAttempt, 0);
  assert.deepEqual(firstRequest.plannerInvariantInput, {
    baseDraft: { basePlanHash: 'base-a' },
  });
  assert.equal(
    Object.hasOwn(firstRequest.plannerInvariantInput, 'routeNetworkPlanResultCache'),
    false,
  );
  assert.deepEqual(firstRequest.plannerInputPatch, {
    augmentationSeed: undefined,
    prePrunedRouteNetworkGrants: undefined,
    routeNetworkConflictExclusions: undefined,
  });
  clock = 35;
  firstWorker.emit('message', { data: {
    schema: DUNGEON_AUGMENTATION_BROWSER_PLANNER_RESPONSE_SCHEMA,
    requestId: firstRequest.requestId,
    ok: true,
    result: { status: 'applied', overlayPlan: { augmentationPlanHash: 'plan-a' } },
    diagnostics: { workerExecutionTimeMs: 20 },
    routeNetworkSalvageWitnessCacheEntries: [
      ['salvage-a', [{ operation: { id: 'operation-a' }, nodes: [], segments: [] }]],
      ['completed-plan-is-not-an-array', { error: null }],
    ],
  } });
  assert.deepEqual(await firstPromise, {
    result: { status: 'applied', overlayPlan: { augmentationPlanHash: 'plan-a' } },
    elapsedMs: 25,
    workerDiagnostics: {
      totalRoundTripTimeMs: 25,
      inputCloneDispatchTimeMs: 0,
      workerExecutionTimeMs: 20,
      outputCloneAndDeliveryTimeMs: 5,
    },
  });
  assert.equal(firstWorker.terminated, false);

  const secondPromise = session.plan({
    baseDraft: { basePlanHash: 'base-a' },
    augmentationSeed: 'seed-a',
    routeNetworkConflictExclusions: [{ grantId: 'grant-a' }],
  }, { realizationAttempt: 0 });
  const secondWorker = latestWorker();
  assert.equal(secondWorker, firstWorker);
  assert.equal(FakeWorker.instances.length, 1);
  const secondRequest = secondWorker.messages[1];
  assert.notEqual(secondRequest.requestId, firstRequest.requestId);
  assert.equal(secondRequest.realizationAttempt, 0);
  assert.equal(Object.hasOwn(secondRequest, 'plannerInvariantInput'), false);
  assert.deepEqual(secondRequest.plannerInputPatch, {
    augmentationSeed: 'seed-a',
    prePrunedRouteNetworkGrants: undefined,
    routeNetworkConflictExclusions: [{ grantId: 'grant-a' }],
  });
  firstWorker.emit('message', { data: {
    schema: DUNGEON_AUGMENTATION_BROWSER_PLANNER_RESPONSE_SCHEMA,
    requestId: firstRequest.requestId,
    ok: true,
    result: { status: 'stale' },
  } });
  secondWorker.emit('message', { data: {
    schema: DUNGEON_AUGMENTATION_BROWSER_PLANNER_RESPONSE_SCHEMA,
    requestId: secondRequest.requestId,
    ok: true,
    result: { status: 'unchanged' },
    routeNetworkSalvageWitnessCacheEntries: [],
  } });
  assert.equal((await secondPromise).result.status, 'unchanged');
  assert.equal(secondWorker.terminated, false);

  const thirdPromise = session.plan({ baseDraft: { basePlanHash: 'base-a' } }, {
    realizationAttempt: 1,
  });
  const thirdWorker = latestWorker();
  assert.equal(thirdWorker, firstWorker);
  const thirdRequest = thirdWorker.messages[2];
  assert.equal(thirdRequest.realizationAttempt, 1);
  assert.equal(Object.hasOwn(thirdRequest, 'plannerInvariantInput'), false);
  thirdWorker.emit('message', { data: {
    schema: DUNGEON_AUGMENTATION_BROWSER_PLANNER_RESPONSE_SCHEMA,
    requestId: thirdRequest.requestId,
    ok: true,
    result: { status: 'unchanged' },
    routeNetworkSalvageWitnessCacheEntries: [],
  } });
  await thirdPromise;
  assert.equal(thirdWorker.terminated, false);
  session.dispose();
  assert.equal(thirdWorker.terminated, true);
});

test('worker retains only cloned array-valued salvage witnesses per realization', () => {
  const observedInputs = [];
  let originalWitness = null;
  const state = createDungeonAugmentationBrowserPlannerWorkerState({
    planner(input) {
      observedInputs.push({
        basePlanHash: input.baseDraft.basePlanHash,
        augmentationSeed: input.augmentationSeed,
        cacheEntries: [...input.routeNetworkPlanResultCache],
      });
      if (input.augmentationSeed === 'seed-a') {
        originalWitness = [{ operation: { id: 'operation-a' }, nodes: [], segments: [] }];
        input.routeNetworkPlanResultCache.set('salvage-a', originalWitness);
        input.routeNetworkPlanResultCache.set('completed-plan', {
          plan: { nodes: new Array(100).fill({ id: 'discard-me' }) },
        });
      }
      return { status: 'applied', augmentationSeed: input.augmentationSeed };
    },
  });
  const plannerInvariantInput = {
    baseDraft: { basePlanHash: 'base-a' },
    extensionRegions: [{ id: 'region-a' }],
    profileId: 'profile-a',
    layoutSeed: 'layout-a',
    difficulty: 1,
  };

  assert.deepEqual(state.plan({
    plannerInvariantInput,
    plannerInputPatch: {
      augmentationSeed: 'seed-a',
      prePrunedRouteNetworkGrants: [],
      routeNetworkConflictExclusions: [],
    },
    realizationAttempt: 0,
  }), { status: 'applied', augmentationSeed: 'seed-a' });
  state.plan({
    plannerInputPatch: {
      augmentationSeed: 'seed-a-repair',
      prePrunedRouteNetworkGrants: [],
      routeNetworkConflictExclusions: [{ grantId: 'grant-a' }],
    },
    realizationAttempt: 0,
  });
  state.plan({
    plannerInputPatch: {
      augmentationSeed: 'seed-b',
      prePrunedRouteNetworkGrants: [],
      routeNetworkConflictExclusions: [],
    },
    realizationAttempt: 1,
  });

  assert.equal(observedInputs[1].basePlanHash, 'base-a');
  assert.deepEqual(observedInputs[1].cacheEntries.map(([key]) => key), ['salvage-a']);
  assert.deepEqual(observedInputs[1].cacheEntries[0][1], originalWitness);
  assert.notEqual(observedInputs[1].cacheEntries[0][1], originalWitness);
  assert.deepEqual(observedInputs[2].cacheEntries, []);
  assert.throws(() => state.plan({
    plannerInvariantInput,
    plannerInputPatch: {},
    realizationAttempt: 0,
  }), /invariant may only be initialized once/u);
});

test('standalone browser planning terminates after worker errors', async () => {
  FakeWorker.instances.length = 0;
  const promise = planDungeonAugmentationInBrowserWorker(
    { baseDraft: { basePlanHash: 'base-b' } },
    { WorkerImplementation: FakeWorker, timeoutMs: 1_000 },
  );
  const worker = latestWorker();
  worker.emit('error', { message: 'synthetic worker failure' });
  await assert.rejects(promise, /synthetic worker failure/u);
  assert.equal(worker.terminated, true);
});

test('browser planner timeout terminates the transaction worker', async () => {
  FakeWorker.instances.length = 0;
  const session = createDungeonAugmentationBrowserPlannerSession({
    WorkerImplementation: FakeWorker,
    timeoutMs: 5,
  });
  const worker = latestWorker();
  await assert.rejects(
    session.plan({ baseDraft: { basePlanHash: 'base-timeout' } }),
    /exceeded 5 ms/u,
  );
  assert.equal(worker.terminated, true);
  await assert.rejects(
    session.plan({ baseDraft: { basePlanHash: 'base-timeout' } }),
    /no longer available/u,
  );
});

test('repair passes share one absolute transaction deadline', async () => {
  FakeWorker.instances.length = 0;
  let clock = 100;
  const scheduled = [];
  const session = createDungeonAugmentationBrowserPlannerSession({
    WorkerImplementation: FakeWorker,
    timeoutMs: 100,
    now: () => clock,
    setTimeoutImplementation(callback, delay) {
      const handle = { callback, delay, cleared: false };
      scheduled.push(handle);
      return handle;
    },
    clearTimeoutImplementation(handle) {
      handle.cleared = true;
    },
  });
  const worker = latestWorker();
  const firstPromise = session.plan({ baseDraft: { basePlanHash: 'base-deadline' } });
  assert.equal(scheduled[0].delay, 100);
  const firstRequest = worker.messages[0];
  clock = 140;
  worker.emit('message', { data: {
    schema: DUNGEON_AUGMENTATION_BROWSER_PLANNER_RESPONSE_SCHEMA,
    requestId: firstRequest.requestId,
    ok: true,
    result: { status: 'repair-required' },
  } });
  await firstPromise;
  assert.equal(scheduled[0].cleared, true);

  clock = 175;
  const repairPromise = session.plan({
    baseDraft: { basePlanHash: 'base-deadline' },
    routeNetworkConflictExclusions: [{ grantId: 'grant-a' }],
  });
  assert.equal(scheduled[1].delay, 25);
  assert.equal(worker.messages.length, 2);
  scheduled[1].callback();
  await assert.rejects(repairPromise, /exceeded 100 ms/u);
  assert.equal(worker.terminated, true);

  const expiredSchedules = [];
  clock = 500;
  const expiredSession = createDungeonAugmentationBrowserPlannerSession({
    WorkerImplementation: FakeWorker,
    timeoutMs: 100,
    now: () => clock,
    setTimeoutImplementation(callback, delay) {
      const handle = { callback, delay, cleared: false };
      expiredSchedules.push(handle);
      return handle;
    },
    clearTimeoutImplementation(handle) {
      handle.cleared = true;
    },
  });
  const expiredWorker = latestWorker();
  const acceptedPromise = expiredSession.plan({
    baseDraft: { basePlanHash: 'base-expired' },
  });
  const acceptedRequest = expiredWorker.messages[0];
  clock = 550;
  expiredWorker.emit('message', { data: {
    schema: DUNGEON_AUGMENTATION_BROWSER_PLANNER_RESPONSE_SCHEMA,
    requestId: acceptedRequest.requestId,
    ok: true,
    result: { status: 'repair-required' },
  } });
  await acceptedPromise;
  clock = 601;
  await assert.rejects(
    expiredSession.plan({ baseDraft: { basePlanHash: 'base-expired' } }),
    /exceeded 100 ms/u,
  );
  assert.equal(expiredWorker.messages.length, 1);
  assert.equal(expiredWorker.terminated, true);
});

test('browser planner session aborts and terminates its active worker', async () => {
  FakeWorker.instances.length = 0;
  const controller = new AbortController();
  const session = createDungeonAugmentationBrowserPlannerSession({
    WorkerImplementation: FakeWorker,
    timeoutMs: 1_000,
    signal: controller.signal,
  });
  const promise = session.plan({ baseDraft: { basePlanHash: 'base-abort' } });
  const worker = latestWorker();
  controller.abort(new Error('navigation superseded the build'));
  await assert.rejects(promise, (error) => (
    error?.name === 'AbortError'
      && /cancelled/u.test(error.message)
      && error.cause?.message === 'navigation superseded the build'
  ));
  assert.equal(worker.terminated, true);
  await assert.rejects(
    session.plan({ baseDraft: { basePlanHash: 'base-abort' } }),
    (error) => error?.name === 'AbortError' && /cancelled/u.test(error.message),
  );
});

test('browser planner preserves an already-aborted signal as cancellation', async () => {
  FakeWorker.instances.length = 0;
  const controller = new AbortController();
  controller.abort(new Error('request was superseded before worker creation'));
  const session = createDungeonAugmentationBrowserPlannerSession({
    WorkerImplementation: FakeWorker,
    timeoutMs: 1_000,
    signal: controller.signal,
  });

  assert.equal(FakeWorker.instances.length, 0);
  await assert.rejects(
    session.plan({ baseDraft: { basePlanHash: 'base-pre-abort' } }),
    (error) => error?.name === 'AbortError'
      && /cancelled/u.test(error.message)
      && error.cause?.message === 'request was superseded before worker creation',
  );
});

test('async augmentation replay awaits every yielded repair plan', async () => {
  const requests = [
    { requestKey: 'request-a', realizationAttempt: 0, plannerInput: { id: 'a' } },
    { requestKey: 'request-b', realizationAttempt: 0, plannerInput: { id: 'b' } },
  ];
  const host = {
    *_generateIndustrialDungeonWithAugmentationReplaySteps() {
      const first = yield requests[0];
      const second = yield requests[1];
      return [first, second];
    },
  };
  const visited = [];
  const result = await DungeonGenerator.prototype
    ._generateIndustrialDungeonWithAugmentationReplayAsync.call(
      host,
      async (request) => {
        visited.push(request.plannerInput.id);
        return {
          result: { status: 'applied', id: request.plannerInput.id },
          elapsedMs: request.plannerInput.id === 'a' ? 10 : 20,
        };
      },
    );
  assert.deepEqual(visited, ['a', 'b']);
  assert.deepEqual(result, [
    {
      requestKey: 'request-a',
      result: { status: 'applied', id: 'a' },
      elapsedMs: 10,
    },
    {
      requestKey: 'request-b',
      result: { status: 'applied', id: 'b' },
      elapsedMs: 20,
    },
  ]);
});

test('the real Seed001 planning request crosses the structured-clone boundary', () => {
  const seed = 'layout:augmentation-realized-v4-001';
  const random = new SeededRandom(hashSeed(seed));
  const generator = new DungeonGenerator({
    random: () => random.next(),
    difficulty: 1,
    augmentationProfileId: 'industrial-supplement-preview-v4',
    augmentationSeed: seed,
    basePlanHash: `v1:${seed}:depth:1:revolvingFusillade`,
  });
  const inertTexture = new THREE.Texture();
  generator.textureCache.set('browser-planner-worker-test', inertTexture);
  generator._loadRuinTexture = () => inertTexture;

  const steps = generator._generateIndustrialDungeonWithAugmentationReplaySteps();
  const planningStep = steps.next();
  try {
    assert.equal(planningStep.done, false);
    assert.equal(planningStep.value.kind, 'dungeon-augmentation-planning-request');
    const clonedInput = structuredClone(planningStep.value.plannerInput);
    assert.equal(clonedInput.baseDraft.basePlanHash, generator.basePlanHash);
    assert.equal(clonedInput.profileId, generator.augmentationProfileId);
    assert.equal(clonedInput.routeNetworkPlanResultCache instanceof Map, true);
  } finally {
    steps.return();
  }
});
