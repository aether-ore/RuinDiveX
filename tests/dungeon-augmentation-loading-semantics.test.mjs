import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDungeonAugmentationLoadingState,
  createOwnedDungeonBuildCancellation,
  runDungeonAugmentationGenerationTransaction,
} from '../src/Game.js';

class FakeElement {
  constructor(tagName, ownerDocument = null) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.removed = false;
    this.textContent = '';
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  async click() {
    for (const listener of this.listeners.get('click') ?? []) {
      await listener({ currentTarget: this });
    }
  }

  remove() {
    this.removed = true;
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
  }
}

function createFakeContainer() {
  const documentHost = {
    createElement(tagName) {
      return new FakeElement(tagName, documentHost);
    },
  };
  return new FakeElement('div', documentHost);
}

function descendant(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children ?? []) {
    const match = descendant(child, predicate);
    if (match) return match;
  }
  return null;
}

const baseRequest = Object.freeze({
  layoutSeed: 'loading-semantics-seed',
  difficulty: 1,
  bossProfileId: 'boss-a',
  dungeonFamilyId: 'industrial-v1',
  basePlanHash: 'base-loading-semantics',
});

const authoredArtifact = Object.freeze({
  artifactId: 'industrial-v4-authored-r1',
  artifactRevision: 1,
  artifactHash: 'v1-authored-artifact-fixture',
  generationMode: 'authored-artifact',
  profileId: 'industrial-supplement-preview-v4',
  profileRevision: 6,
  gameplayTuningRevision: 1,
  canonicalLayoutSeed: 'layout:industrial-v4-authored-r1',
  baseGeometryHash: 'v1-authored-base',
});

const authoredRequest = Object.freeze({
  ...baseRequest,
  augmentationRequest: {
    augmentationProfileId: 'industrial-supplement-preview-v4',
    committedAugmentationIdentity: null,
  },
});

function authoredAssetPreparation({
  onDispose = null,
  onCacheInstall = null,
  onCacheRelease = null,
} = {}) {
  return {
    receipt: { accepted: true, receiptHash: 'v1-assets-receipt' },
    metrics: { totalTimeMs: 5, decodedTextureCount: 1, concurrency: 8 },
    assets: [{ id: 'texture:fixture', uri: '/fixture.png', kind: 'texture', handle: {} }],
    installIntoCache(cache) {
      onCacheInstall?.(cache);
      let disposed = false;
      return {
        installedCount: 1,
        dispose() {
          if (disposed) return false;
          disposed = true;
          onCacheRelease?.();
          return true;
        },
      };
    },
    async dispose() { onDispose?.(); },
  };
}

test('Cancel aborts an owned authored build and removes loading only after cleanup', async () => {
  const container = createFakeContainer();
  const cancellation = createOwnedDungeonBuildCancellation();
  createDungeonAugmentationLoadingState(container, { cancellation });
  const status = descendant(container, (element) => (
    element.dataset?.dungeonAugmentationLoading === 'active'
  ));
  const retry = descendant(container, (element) => element.textContent === 'Retry');
  const cancel = descendant(container, (element) => element.textContent === 'Cancel');

  assert.ok(status);
  assert.equal(retry.hidden, true);
  assert.equal(cancel.hidden, false);
  assert.equal(container.dataset.dungeonAugmentationBuild, 'active');
  const clickPromise = cancel.click();
  await Promise.resolve();
  assert.equal(cancellation.signal.aborted, true);
  assert.equal(cancel.disabled, true);
  assert.equal(status.removed, false);

  cancellation.finishCleanup();
  await clickPromise;
  assert.equal(status.removed, true);
  assert.equal(Object.hasOwn(container.dataset, 'dungeonAugmentationBuild'), false);
  assert.equal(container.attributes.has('aria-busy'), false);
});

test('loading state reports authored phases and exposes Retry on failure', () => {
  const container = createFakeContainer();
  const cancellation = createOwnedDungeonBuildCancellation();
  const loadingState = createDungeonAugmentationLoadingState(container, { cancellation });
  const status = descendant(container, (element) => (
    element.dataset?.dungeonAugmentationLoading === 'active'
  ));
  const detail = descendant(status, (element) => element.tagName === 'SPAN');
  const retry = descendant(status, (element) => element.textContent === 'Retry');

  const expectedCopy = new Map([
    ['artifact-loading', 'Verifying the authored dungeon artifact.'],
    ['asset-preparation', 'Fetching and decoding the authored dungeon assets.'],
    ['parent-generation', 'Constructing the authored dungeon layout.'],
    ['validation', 'Validating traversal, progression, and presentation.'],
    ['assembly', 'Assembling the authored dungeon render batches.'],
    ['activation', 'Activating the authored dungeon.'],
  ]);
  for (const [phase, copy] of expectedCopy) {
    loadingState.update(phase);
    assert.equal(detail.textContent, copy);
  }
  assert.doesNotMatch(detail.textContent, /planner|repair|worker/iu);

  loadingState.fail(new Error('synthetic artifact rejection'));
  assert.equal(status.dataset.dungeonAugmentationLoading, 'failed');
  assert.equal(retry.hidden, false);
  assert.equal(container.dataset.dungeonAugmentationBuild, 'failed');
  cancellation.finishCleanup();
});

test('Cancel aborts an in-flight artifact load before assets or a generator are created', async () => {
  const events = [];
  const container = createFakeContainer();
  const cancellation = createOwnedDungeonBuildCancellation();
  createDungeonAugmentationLoadingState(container, { cancellation });
  const cancel = descendant(container, (element) => element.textContent === 'Cancel');
  let resolveLoaderStarted;
  const loaderStarted = new Promise((resolve) => { resolveLoaderStarted = resolve; });

  class ForbiddenGenerator {
    constructor() { throw new Error('generator must not be constructed'); }
  }
  const transactionPromise = runDungeonAugmentationGenerationTransaction({
    ...authoredRequest,
    signal: cancellation.signal,
    dependencies: {
      DungeonGenerator: ForbiddenGenerator,
      loadAuthoredArtifact: ({ signal }) => new Promise((resolve, reject) => {
        resolveLoaderStarted();
        signal.addEventListener('abort', () => {
          events.push('artifact-load-aborted');
          const error = new Error('cancelled');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }),
      prepareAuthoredAssets: async () => {
        throw new Error('asset preparation must not start');
      },
    },
  }).finally(() => {
    events.push('cleanup-finished');
    cancellation.finishCleanup();
  });

  await loaderStarted;
  const clickPromise = cancel.click();
  await assert.rejects(transactionPromise, (error) => error?.name === 'AbortError');
  await clickPromise;
  assert.deepEqual(events, ['artifact-load-aborted', 'cleanup-finished']);
});

test('authored V4 reports fixed phases, canonicalizes the seed, and owns one-shot cleanup', async () => {
  let generatorOptions = null;
  let randomSeed = null;
  let preparedAssetDisposeCount = 0;
  let generatedDungeonDisposeCount = 0;
  let cacheInstallCount = 0;
  let cacheReleaseCount = 0;
  let cacheInstalled = false;
  const progress = [];
  const loadingPhases = [];
  class AuthoredGenerator {
    constructor(options) { generatorOptions = options; }

    async generateAsync(options) {
      assert.equal(options, undefined);
      assert.equal(cacheInstalled, true, 'decoded textures must be cached before assembly');
      return {
        augmentationMetrics: {
          materializationTimeMs: 2,
          rendererFreeValidationTimeMs: 3,
          assemblyTimeMs: 4,
        },
      };
    }

    _disposeGeneratedDungeonCandidate(dungeon) {
      generatedDungeonDisposeCount += 1;
      for (const resource of dungeon.disposableResources ?? []) resource.dispose?.();
    }
  }

  const transaction = await runDungeonAugmentationGenerationTransaction({
    ...authoredRequest,
    loadingState: { update: (phase) => loadingPhases.push(phase) },
    onProgress: (record) => progress.push(record.phase),
    dependencies: {
      DungeonGenerator: AuthoredGenerator,
      createRandom(seed) {
        randomSeed = seed;
        return () => 0.5;
      },
      loadAuthoredArtifact: async () => authoredArtifact,
      prepareAuthoredAssets: async () => authoredAssetPreparation({
        onDispose: () => { preparedAssetDisposeCount += 1; },
        onCacheInstall: () => {
          cacheInstallCount += 1;
          cacheInstalled = true;
        },
        onCacheRelease: () => {
          cacheReleaseCount += 1;
          cacheInstalled = false;
        },
      }),
      now: (() => {
        let value = 100;
        return () => ++value;
      })(),
    },
  });

  assert.deepEqual(progress, [
    'artifact-loading',
    'asset-preparation',
    'parent-generation',
    'validation',
  ]);
  assert.deepEqual(loadingPhases, progress);
  assert.equal(randomSeed, authoredArtifact.canonicalLayoutSeed);
  assert.equal(generatorOptions.authoredAugmentationArtifact, authoredArtifact);
  assert.equal(generatorOptions.augmentationSeed, authoredArtifact.canonicalLayoutSeed);
  assert.equal(generatorOptions.basePlanHash, authoredArtifact.baseGeometryHash);
  assert.equal(transaction.dungeon.layoutSeed, authoredArtifact.canonicalLayoutSeed);
  assert.equal(transaction.dungeon.requestedLayoutSeed, authoredRequest.layoutSeed);
  assert.equal(transaction.dungeon.preparedBuildDiagnostics.plannerWorkerCreated, false);
  assert.equal(transaction.dungeon.preparedBuildDiagnostics.proceduralPlanningInvoked, false);
  assert.equal(transaction.dungeon.preparedBuildDiagnostics.assetCacheHandoffCount, 1);
  assert.deepEqual(
    transaction.dungeon.preparedBuildDiagnostics.assetPreparationMetrics,
    { totalTimeMs: 5, decodedTextureCount: 1, concurrency: 8 },
  );
  assert.equal(cacheInstallCount, 1);
  assert.equal(cacheReleaseCount, 1);
  assert.equal(cacheInstalled, false);
  assert.equal(
    Object.hasOwn(transaction.dungeon.preparedBuildDiagnostics, 'workerBacked'),
    false,
  );
  assert.equal(preparedAssetDisposeCount, 0);
  assert.equal(transaction.disposeDungeon(), true);
  assert.equal(transaction.disposeDungeon(), false);
  assert.equal(generatedDungeonDisposeCount, 1);
  await Promise.resolve();
  assert.equal(preparedAssetDisposeCount, 1);
});

test('generator failure disposes prepared authored assets and never constructs a fallback', async () => {
  const generatorError = new Error('synthetic authored assembly failure');
  let generatorConstructorCount = 0;
  let preparedAssetDisposeCount = 0;
  class FailingGenerator {
    constructor() { generatorConstructorCount += 1; }
    async generateAsync() { throw generatorError; }
  }

  await assert.rejects(
    runDungeonAugmentationGenerationTransaction({
      ...authoredRequest,
      dependencies: {
        DungeonGenerator: FailingGenerator,
        createRandom: () => () => 0.5,
        loadAuthoredArtifact: async () => authoredArtifact,
        prepareAuthoredAssets: async () => authoredAssetPreparation({
          onDispose: () => { preparedAssetDisposeCount += 1; },
        }),
      },
    }),
    (error) => error === generatorError,
  );
  assert.equal(generatorConstructorCount, 1);
  assert.equal(preparedAssetDisposeCount, 1);
});

test('aborting after detached generation disposes both the dungeon and prepared assets', async () => {
  const controller = new AbortController();
  let dungeonDisposed = 0;
  let assetsDisposed = 0;
  class AbortAfterGeneration {
    async generateAsync() {
      controller.abort(new Error('cancel after generation'));
      return { detached: true };
    }

    _disposeGeneratedDungeonCandidate(dungeon) {
      assert.equal(dungeon.detached, true);
      dungeonDisposed += 1;
    }
  }

  await assert.rejects(
    runDungeonAugmentationGenerationTransaction({
      ...authoredRequest,
      signal: controller.signal,
      dependencies: {
        DungeonGenerator: AbortAfterGeneration,
        createRandom: () => () => 0.5,
        loadAuthoredArtifact: async () => authoredArtifact,
        prepareAuthoredAssets: async () => authoredAssetPreparation({
          onDispose: () => { assetsDisposed += 1; },
        }),
      },
    }),
    (error) => error?.name === 'AbortError',
  );
  assert.equal(dungeonDisposed, 1);
  assert.equal(assetsDisposed, 1);
});

test('artifact rejection is immediate and never constructs assets, generator, or fallback', async () => {
  const artifactError = Object.assign(new Error('artifact integrity mismatch'), {
    code: 'DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_INTEGRITY_MISMATCH',
  });
  let generatorConstructorCount = 0;
  let assetPreparationCount = 0;
  class ForbiddenGenerator {
    constructor() { generatorConstructorCount += 1; }
  }

  await assert.rejects(
    runDungeonAugmentationGenerationTransaction({
      ...authoredRequest,
      dependencies: {
        DungeonGenerator: ForbiddenGenerator,
        loadAuthoredArtifact: async () => { throw artifactError; },
        prepareAuthoredAssets: async () => { assetPreparationCount += 1; },
      },
    }),
    (error) => error === artifactError,
  );
  assert.equal(generatorConstructorCount, 0);
  assert.equal(assetPreparationCount, 0);
});

test('explicit procedural V1-V3 profiles report offline-only before artifact loading', async () => {
  for (const profileId of [
    'industrial-supplement-preview-v1',
    'industrial-supplement-preview-v2',
    'industrial-supplement-preview-v3',
  ]) {
    let loaderCalls = 0;
    await assert.rejects(
      runDungeonAugmentationGenerationTransaction({
        ...baseRequest,
        augmentationRequest: {
          augmentationProfileId: profileId,
          committedAugmentationIdentity: null,
        },
        dependencies: {
          loadAuthoredArtifact: async () => { loaderCalls += 1; },
        },
      }),
      (error) => (
        error?.code === 'DUNGEON_AUGMENTATION_INCOMPATIBLE_CONTENT'
        && error?.compatibility?.status === 'legacy-profile-offline-only'
      ),
    );
    assert.equal(loaderCalls, 0);
  }
});

test('a committed procedural V4 identity is legacy offline-only even when V4 is requested', async () => {
  await assert.rejects(
    runDungeonAugmentationGenerationTransaction({
      ...authoredRequest,
      augmentationRequest: {
        augmentationProfileId: 'industrial-supplement-preview-v4',
        committedAugmentationIdentity: {
          profileId: 'industrial-supplement-preview-v4',
          generationMode: 'procedural',
        },
      },
    }),
    (error) => error?.compatibility?.status === 'legacy-profile-offline-only',
  );
});

test('unknown augmentation profiles fail closed without invoking runtime dependencies', async () => {
  let dependencyCalls = 0;
  await assert.rejects(
    runDungeonAugmentationGenerationTransaction({
      ...baseRequest,
      augmentationRequest: {
        augmentationProfileId: 'test-procedural-profile',
        committedAugmentationIdentity: null,
      },
      dependencies: {
        loadAuthoredArtifact: async () => { dependencyCalls += 1; },
        prepareAuthoredAssets: async () => { dependencyCalls += 1; },
      },
    }),
    (error) => (
      error?.code === 'DUNGEON_AUGMENTATION_INCOMPATIBLE_CONTENT'
      && error?.compatibility?.status === 'unsupported-augmentation-profile'
      && error?.compatibility?.errors?.[0]?.code === 'browser-procedural-planning-disabled'
    ),
  );
  assert.equal(dependencyCalls, 0);
});

test('an authored V4 committed identity resolves through the artifact path without a URL profile', async () => {
  let committedIdentitySeen = null;
  class AuthoredCommittedGenerator {
    constructor(options) { committedIdentitySeen = options.committedAugmentationIdentity; }
    async generateAsync() { return { augmentationMetrics: {} }; }
  }
  const committedIdentity = {
    profileId: 'industrial-supplement-preview-v4',
    generationMode: 'authored-artifact',
  };

  const transaction = await runDungeonAugmentationGenerationTransaction({
    ...baseRequest,
    augmentationRequest: {
      augmentationProfileId: null,
      committedAugmentationIdentity: committedIdentity,
    },
    dependencies: {
      DungeonGenerator: AuthoredCommittedGenerator,
      createRandom: () => () => 0.5,
      loadAuthoredArtifact: async () => authoredArtifact,
      prepareAuthoredAssets: async () => authoredAssetPreparation(),
    },
  });
  assert.equal(committedIdentitySeen, committedIdentity);
  transaction.disposeDungeon();
});
