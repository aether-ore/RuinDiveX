import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DungeonConnectorTrapRuntime } from '../src/DungeonConnectorTrapRuntime.js';
import { DungeonConnectorTrapVisualFactory } from '../src/DungeonConnectorTrapVisualFactory.js';
import { Game } from '../src/Game.js';

function createDescriptor(id = 'lifecycle-track-trap') {
  return {
    id,
    trackStart: { x: -4, y: 4.5, z: 0 },
    trackEnd: { x: 4, y: 4.5, z: 0 },
    warningVolume: {
      center: { x: 0, y: 1.8, z: 0 },
      halfSize: { x: 4, y: 1.8, z: 1.4 },
    },
    contactOffsetMeters: { x: 0, y: -1.1, z: 0 },
    initialTrackRatio: 0.25,
    initialDirection: 'toward-end',
  };
}

function createTexture() {
  const texture = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  texture.needsUpdate = true;
  return texture;
}

function createAuthoredTrapSource() {
  const source = new THREE.Group();
  source.add(new THREE.Mesh(
    new THREE.BoxGeometry(2, 1.4, 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  ));
  return source;
}

function createImmediateFactory() {
  let modelLoads = 0;
  let textureLoads = 0;
  const factory = new DungeonConnectorTrapVisualFactory({
    objLoader: {
      async loadAsync() {
        modelLoads += 1;
        return createAuthoredTrapSource();
      },
    },
    textureLoader: {
      async loadAsync() {
        textureLoads += 1;
        return createTexture();
      },
    },
  });
  return {
    factory,
    getLoadCounts: () => ({ modelLoads, textureLoads }),
  };
}

function createBundleDisposalHarness() {
  const scene = new THREE.Scene();
  return {
    activeWorldBundle: null,
    connectorTrackTrapRuntime: null,
    connectorLiftRuntime: null,
    scene,
    worldDisposalCount: 0,
    lastWorldDisposalStats: null,
    lastDungeonResourceDisposalStats: null,
    hostListenerRegistrationCount: 9,
    _clearDungeonRunState() {},
    _collectRenderResources: Game.prototype._collectRenderResources,
    _disposeDetachedDungeonResources(root) {
      this.lifecycleEvents.push('dungeon-root-resources-disposed');
      assert.equal(
        this.connectorTrackTrapRuntime,
        null,
        'host trap runtime must be released before root GPU resources',
      );
      return Game.prototype._disposeDetachedDungeonResources.call(this, root);
    },
    _recordWorldLifecycleEvent(type) {
      this.lifecycleEvents.push(type);
    },
    lifecycleEvents: [],
  };
}

test('late model and texture completion cannot attach a trap to a disposed dungeon root', async () => {
  let resolveModel;
  let resolveTexture;
  const factory = new DungeonConnectorTrapVisualFactory({
    objLoader: {
      loadAsync: () => new Promise((resolve) => { resolveModel = resolve; }),
    },
    textureLoader: {
      loadAsync: () => new Promise((resolve) => { resolveTexture = resolve; }),
    },
  });
  const visualRoot = new THREE.Group();
  let rootDisposed = false;
  let addAfterDisposalCount = 0;
  const originalAdd = visualRoot.add;
  visualRoot.add = function guardedAdd(...objects) {
    if (rootDisposed) addAfterDisposalCount += 1;
    return originalAdd.apply(this, objects);
  };
  const runtime = new DungeonConnectorTrapRuntime(null, [createDescriptor()], {
    visualFactory: factory,
    visualRoot,
    ownsVisualFactory: true,
  });

  runtime.mount();
  assert.equal(factory.getDiagnostics().loadCount, 1);
  runtime.dispose();
  rootDisposed = true;
  resolveModel(createAuthoredTrapSource());
  resolveTexture(createTexture());
  await runtime.whenVisualsReady();

  const visual = factory.getDiagnostics();
  assert.equal(addAfterDisposalCount, 0);
  assert.equal(visualRoot.children.length, 0);
  assert.equal(visual.instanceCount, 0);
  assert.equal(visual.activeInstanceCount, 0);
  assert.equal(visual.disposed, true);
  assert.equal(visual.resourcesDisposed, true);
  assert.equal(runtime.getDiagnostics().disposed, true);
});

test('streamed dungeon candidate consumes trap visual acceptance before commit', async () => {
  const lifecycleEvents = [];
  const runtime = {
    disposed: false,
    mountCount: 0,
    mount() {
      this.mountCount += 1;
      return true;
    },
    async whenVisualsReady(options) {
      assert.deepEqual(options, { requireVisualAcceptance: true });
      throw new Error('connector-track-trap-visual-acceptance-failed:test-trap:missing-png');
    },
  };
  const bundle = {
    worldKind: 'dungeon',
    facade: {
      group: new THREE.Group(),
      connectorTrackTraps: [createDescriptor('test-trap')],
    },
    connectorTrackTrapRuntime: runtime,
    connectorTrackTrapVisualFactory: {},
  };
  const game = {
    _isStandardLegacyDungeonFacade: Game.prototype._isStandardLegacyDungeonFacade,
    _recordWorldLifecycleEvent(event, details) {
      lifecycleEvents.push({ event, details });
    },
  };

  await assert.rejects(
    Game.prototype._prepareConnectorTrackTrapVisualAcceptanceForBundle.call(game, bundle),
    /connector-track-trap-visual-acceptance-failed:test-trap:missing-png/,
  );
  assert.equal(runtime.mountCount, 1);
  assert.deepEqual(lifecycleEvents, [{
    event: 'connector-track-trap-visual-acceptance-failed',
    details: {
      message: 'connector-track-trap-visual-acceptance-failed:test-trap:missing-png',
      trapCount: 1,
    },
  }]);
});

test('five dungeon bundle replacements dispose traps before roots and hold a zero-resource plateau', async () => {
  const game = createBundleDisposalHarness();
  const seenRuntimes = new Set();
  const seenFactories = new Set();
  const plateau = [];

  for (let cycle = 1; cycle <= 5; cycle += 1) {
    game.lifecycleEvents = [];
    const { factory, getLoadCounts } = createImmediateFactory();
    const root = new THREE.Group();
    root.name = `lifecycle-dungeon-root-${cycle}`;
    const roomGeometry = new THREE.BoxGeometry(2, 2, 2);
    const roomMaterial = new THREE.MeshBasicMaterial({ color: 0x334455 });
    let roomGeometryDisposeCount = 0;
    let roomMaterialDisposeCount = 0;
    const disposeRoomGeometry = roomGeometry.dispose.bind(roomGeometry);
    const disposeRoomMaterial = roomMaterial.dispose.bind(roomMaterial);
    roomGeometry.dispose = () => {
      roomGeometryDisposeCount += 1;
      disposeRoomGeometry();
    };
    roomMaterial.dispose = () => {
      roomMaterialDisposeCount += 1;
      disposeRoomMaterial();
    };
    root.add(new THREE.Mesh(roomGeometry, roomMaterial));
    game.scene.add(root);

    const runtime = new DungeonConnectorTrapRuntime(null, [createDescriptor(`cycle-${cycle}`)], {
      visualFactory: factory,
      visualRoot: root,
      ownsVisualFactory: true,
    });
    const originalRuntimeDispose = runtime.dispose.bind(runtime);
    runtime.dispose = () => {
      game.lifecycleEvents.push('trap-runtime-disposed');
      return originalRuntimeDispose();
    };
    const originalFactoryDispose = factory.dispose.bind(factory);
    factory.dispose = () => {
      if (!factory.disposed) game.lifecycleEvents.push('trap-factory-disposed');
      return originalFactoryDispose();
    };
    runtime.mount();
    await runtime.whenVisualsReady();
    assert.equal(root.children.length, 2, `cycle ${cycle} should own one room mesh and one trap`);
    assert.equal(factory.getDiagnostics().activeInstanceCount, 1);

    const templateMesh = factory.template?.rotor?.getObjectByProperty?.('isMesh', true);
    assert.ok(templateMesh?.geometry);
    assert.ok(templateMesh?.material);
    assert.ok(factory.template?.texture);
    let trapGeometryDisposeCount = 0;
    let trapMaterialDisposeCount = 0;
    let trapTextureDisposeCount = 0;
    const disposeTrapGeometry = templateMesh.geometry.dispose.bind(templateMesh.geometry);
    const disposeTrapMaterial = templateMesh.material.dispose.bind(templateMesh.material);
    const disposeTrapTexture = factory.template.texture.dispose.bind(factory.template.texture);
    templateMesh.geometry.dispose = () => {
      trapGeometryDisposeCount += 1;
      disposeTrapGeometry();
    };
    templateMesh.material.dispose = () => {
      trapMaterialDisposeCount += 1;
      disposeTrapMaterial();
    };
    factory.template.texture.dispose = () => {
      trapTextureDisposeCount += 1;
      disposeTrapTexture();
    };

    const originalRemoveFromParent = root.removeFromParent.bind(root);
    root.removeFromParent = () => {
      game.lifecycleEvents.push('dungeon-root-detached');
      return originalRemoveFromParent();
    };
    const controller = {
      dispose() {
        game.lifecycleEvents.push('controller-disposed');
      },
    };
    const bundle = {
      worldKind: 'dungeon',
      root,
      facade: {},
      controller,
      npcAnimators: [],
      disposableResources: [],
      connectorTrackTrapRuntime: runtime,
      connectorTrackTrapVisualFactory: factory,
      connectorLiftRuntime: null,
      disposed: false,
    };
    game.activeWorldBundle = bundle;
    game.connectorTrackTrapRuntime = runtime;

    const listenerBaseline = game.hostListenerRegistrationCount;
    const stats = Game.prototype._disposeWorldBundle.call(
      game,
      bundle,
      `lifecycle-cycle-${cycle}`,
    );
    const runtimeIndex = game.lifecycleEvents.indexOf('trap-runtime-disposed');
    const factoryIndex = game.lifecycleEvents.indexOf('trap-factory-disposed');
    const detachIndex = game.lifecycleEvents.indexOf('dungeon-root-detached');
    const resourceIndex = game.lifecycleEvents.indexOf('dungeon-root-resources-disposed');

    assert.ok(runtimeIndex >= 0);
    assert.ok(factoryIndex > runtimeIndex);
    assert.ok(detachIndex > factoryIndex);
    assert.ok(resourceIndex > detachIndex);
    assert.equal(game.connectorTrackTrapRuntime, null);
    assert.equal(bundle.disposed, true);
    assert.equal(root.parent, null);
    assert.equal(root.children.length, 1, 'trap instance must be released before root disposal');
    assert.equal(runtime.getDiagnostics().disposed, true);
    assert.deepEqual(getLoadCounts(), { modelLoads: 1, textureLoads: 1 });
    assert.equal(factory.getDiagnostics().activeInstanceCount, 0);
    assert.equal(factory.getDiagnostics().releasedCount, 1);
    assert.equal(factory.getDiagnostics().resourcesDisposed, true);
    assert.equal(trapGeometryDisposeCount, 1);
    assert.equal(trapMaterialDisposeCount, 1);
    assert.equal(trapTextureDisposeCount, 1);
    assert.equal(roomGeometryDisposeCount, 1);
    assert.equal(roomMaterialDisposeCount, 1);
    assert.equal(game.hostListenerRegistrationCount, listenerBaseline);
    assert.deepEqual(stats.connectorTrackTrapDisposal, {
      trapCount: 1,
      activeVisualCount: 1,
      visualLoadCount: 1,
    });

    seenRuntimes.add(runtime);
    seenFactories.add(factory);
    plateau.push({
      mountedRuntimes: runtime.mounted ? 1 : 0,
      activeInstances: factory.getDiagnostics().activeInstanceCount,
      retainedRootChildren: root.children.length,
      modelLoads: getLoadCounts().modelLoads,
      textureLoads: getLoadCounts().textureLoads,
      disposedRoomGeometries: roomGeometryDisposeCount,
      disposedRoomMaterials: roomMaterialDisposeCount,
      disposedTrapGeometries: trapGeometryDisposeCount,
      disposedTrapMaterials: trapMaterialDisposeCount,
      disposedTrapTextures: trapTextureDisposeCount,
      hostListeners: game.hostListenerRegistrationCount,
    });
  }

  assert.equal(seenRuntimes.size, 5, 'each dungeon must receive a distinct trap runtime');
  assert.equal(seenFactories.size, 5, 'each dungeon must receive a distinct visual factory');
  for (const sample of plateau.slice(1)) assert.deepEqual(sample, plateau[0]);
  assert.equal(game.worldDisposalCount, 5);
});
