import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  SEMANTIC_ROOM_PACK_CATALOG_V1,
  SemanticRoomPackTemplateNotReadyErrorV1,
  SemanticRoomPackValidationErrorV1,
  createSemanticRoomPackPresentationRuntimeV1,
} from '../../../src/dungeon-v2/SemanticRoomPackPresentationV1.js';

function mesh(name, material, semantic, position = [0, 0, 0]) {
  const result = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  result.name = name;
  result.position.fromArray(position);
  result.userData.semantic = semantic;
  return result;
}

function marker(name, semantic, position = [0, 0, 0]) {
  const result = new THREE.Object3D();
  result.name = name;
  result.position.fromArray(position);
  result.userData.semantic = semantic;
  return result;
}

function authoredScene() {
  const scene = new THREE.Group();
  scene.name = 'ROOM_test_semantic_room';
  const metal = new THREE.MeshStandardMaterial({ color: 0x778899 });
  const hazard = new THREE.MeshStandardMaterial({ color: 0xff4400 });
  scene.add(
    marker('SOCKET_ENTRY_SOUTH', 'socket', [0, 0, 10]),
    marker('REGION_LOWER', 'region', [0, -40, 0]),
    marker('ANCHOR_REWARD', 'rewardAnchor', [2, -40, 1]),
    mesh('WALK_LOWER', metal, 'walkable', [0, -40, 0]),
    mesh('SHELL_CEILING', metal, 'shell', [0, 10, 0]),
    mesh('SUPPORT_COLUMN_A', metal, 'support', [-2, -20, 0]),
    mesh('SUPPORT_COLUMN_B', metal, 'support', [2, -20, 0]),
    mesh('RAIL_LOWER_A', metal, 'rail', [-1, -39, 0]),
    mesh('RAIL_LOWER_B', metal, 'rail', [1, -39, 0]),
    mesh('MECH_PLATFORM', metal, 'movingSurface', [0, 2, 0]),
    mesh('MECH_CONTROL', metal, 'console', [1, 0, 8]),
    mesh('FLUID_WATER', hazard, 'fluidSurface', [0, -4, 0]),
    mesh('HAZARD_FLOOR', hazard, 'hazardSurface', [0, -3, 0]),
    mesh('CONSOLE_ROUTER', metal, 'console', [-1, 0, 8]),
  );
  return scene;
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    roomId: 'test_semantic_room',
    units: 'meters',
    upAxis: 'Y',
    forwardAxis: '-Z',
    originPolicy: 'entry-tier origin; do not recenter from aggregate bounds',
    collisionPolicy: 'Use manifest collision volumes; do not derive collision from visible mesh bounds.',
    bounds: { min: [-10, -40.5, -10], max: [10, 12, 10] },
    sockets: [{ id: 'entry_south', nodeName: 'SOCKET_ENTRY_SOUTH' }],
    controller: { id: 'router', consoleNode: 'CONSOLE_ROUTER' },
    fluidNetwork: { id: 'water', masterConsoleNode: 'CONSOLE_ROUTER' },
    hazard: { node: 'HAZARD_FLOOR' },
    fallCatchments: [{ id: 'lower', destinationNode: 'WALK_LOWER' }],
    collisionVolumes: [
      { nodeName: 'WALK_LOWER', shape: 'box', center: [0, -40, 0], size: [8, 0.4, 8] },
      { nodeName: 'SHELL_CEILING', shape: 'box', center: [0, 10, 0], size: [20, 0.4, 20] },
    ],
    ...overrides,
  };
}

function runtimeFor({ scene = authoredScene(), roomManifest = manifest(), mergeStaticVisuals = true } = {}) {
  const calls = { glb: 0, manifest: 0 };
  const loader = {
    async loadAsync() {
      calls.glb += 1;
      return { scene };
    },
  };
  const runtime = createSemanticRoomPackPresentationRuntimeV1({
    runtimeModules: {
      three: THREE,
      GLTFLoader: class {},
      mergeGeometries,
      cloneObjectGraph: (root) => root.clone(true),
    },
    loader,
    manifestLoader: async () => {
      calls.manifest += 1;
      return structuredClone(roomManifest);
    },
    mergeStaticVisuals,
  });
  const binding = {
    schemaVersion: 1,
    packId: 'ruindivex-threejs-room-pack-v1',
    roomId: 'test_semantic_room',
    placementId: 'placement.test-room',
    assetPath: '/test/test_semantic_room.glb',
    manifestPath: '/test/test_semantic_room.json',
    manifestRevision: 1,
    assetSha256: 'asset-sha',
    manifestContractHash: 'manifest-hash',
    authoredRootTransform: {
      origin: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      recenter: false,
      entryTierY: 0,
    },
    placementTransform: {
      translation: { x: 25, y: 12, z: -8 },
      yawQuarterTurns: 1,
      scale: { x: 1, y: 1, z: 1 },
    },
    entrySocket: { id: 'entry_south', nodeName: 'SOCKET_ENTRY_SOUTH' },
    stableSemanticIds: {
      sockets: [{ id: 'entry_south', nodeName: 'SOCKET_ENTRY_SOUTH' }],
      regions: [{ id: 'lower', nodeName: 'REGION_LOWER' }],
      collisionVolumes: [
        { id: 'lower-floor', nodeName: 'WALK_LOWER' },
        { id: 'ceiling', nodeName: 'SHELL_CEILING' },
      ],
      mechanisms: [{ id: 'platform', nodeName: 'MECH_PLATFORM' }],
      anchors: [{ id: 'reward', nodeName: 'ANCHOR_REWARD' }],
      hazards: [{ id: 'floor', nodeName: 'HAZARD_FLOOR' }],
      fluids: [{ id: 'water', nodeName: 'FLUID_WATER' }],
    },
  };
  return { runtime, binding, calls };
}

test('preload enables synchronous authored clones and a cache miss fails deterministically', async () => {
  const { runtime, binding, calls } = runtimeFor();
  assert.equal(runtime.isReady(binding), false);
  assert.throws(
    () => runtime.instantiateSync(binding),
    (error) => error instanceof SemanticRoomPackTemplateNotReadyErrorV1
      && error.code === 'semantic-room-pack-template-not-ready',
  );

  const preload = await runtime.preload([binding]);
  assert.equal(preload.accepted, true);
  assert.equal(runtime.isReady(binding), true);
  assert.equal(runtime.isReady(), true);
  const first = runtime.instantiateSync(binding);
  const second = runtime.instantiateSync(binding);
  assert.equal(calls.glb, 1);
  assert.equal(calls.manifest, 1);
  assert.notEqual(first.group, second.group);
  assert.notEqual(first.getNodeByName('FLUID_WATER'), second.getNodeByName('FLUID_WATER'));

  first.getNodeByName('FLUID_WATER').position.x = 99;
  assert.notEqual(second.getNodeByName('FLUID_WATER').position.x, 99);
  first.getNodeByName('FLUID_WATER').material.color.setHex(0x112233);
  assert.notEqual(
    first.getNodeByName('FLUID_WATER').material.color.getHex(),
    second.getNodeByName('FLUID_WATER').material.color.getHex(),
  );
});

test('placement preserves authored origin/scale and never floor-normalizes aggregate bounds', async () => {
  const { runtime, binding } = runtimeFor();
  await runtime.preload(binding);
  const instance = runtime.instantiateSync(binding);
  assert.deepEqual(instance.appliedPlacement.translation, { x: 25, y: 12, z: -8 });
  assert.equal(instance.appliedPlacement.yawQuarterTurns, 1);
  assert.deepEqual(instance.group.position.toArray(), [25, 12, -8]);
  assert.equal(instance.group.rotation.y, Math.PI / 2);
  assert.deepEqual(instance.group.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(instance.authoredRoot.scale.toArray(), [1, 1, 1]);
  assert.equal(instance.getNodeByName('WALK_LOWER').position.y, -40);
  const world = new THREE.Vector3();
  instance.getNodeByName('WALK_LOWER').getWorldPosition(world);
  assert.equal(world.y, -28, 'authored lower floor remains 40m below the placement tier');
  assert.equal(instance.group.userData.aggregateBoundsNormalizationApplied, false);
  assert.equal(instance.group.userData.authoredScalePreserved, true);

  assert.throws(
    () => runtime.instantiateSync({
      ...binding,
      placementTransform: { ...binding.placementTransform, scale: { x: 2, y: 2, z: 2 } },
    }),
    /retain authored unit scale/,
  );
});

test('semantic indexes keep mechanisms, fluids, hazards, and consoles addressable while merging only safe static classes', async () => {
  const { runtime, binding } = runtimeFor();
  await runtime.preload(binding);
  const instance = runtime.instantiateSync(binding);

  assert.equal(instance.dynamicNodes.mechanisms.get('MECH_PLATFORM'), instance.getNodeByName('MECH_PLATFORM'));
  assert.equal(instance.dynamicNodes.fluids.get('FLUID_WATER'), instance.getNodeByName('FLUID_WATER'));
  assert.equal(instance.dynamicNodes.hazards.get('HAZARD_FLOOR'), instance.getNodeByName('HAZARD_FLOOR'));
  assert.equal(instance.dynamicNodes.consoles.get('CONSOLE_ROUTER'), instance.getNodeByName('CONSOLE_ROUTER'));
  assert.equal(instance.dynamicNodes.consoles.get('MECH_CONTROL'), instance.getNodeByName('MECH_CONTROL'));
  assert.equal(instance.markerNodes.sockets.get('SOCKET_ENTRY_SOUTH'), instance.getNodeByName('SOCKET_ENTRY_SOUTH'));
  assert.equal(instance.getStableSemanticNode('platform'), instance.getNodeByName('MECH_PLATFORM'));
  assert.equal(instance.getStableSemanticNode('socket:entry_south'), instance.getNodeByName('SOCKET_ENTRY_SOUTH'));
  assert.ok(instance.semanticIndex.nodesBySemanticExtra.get('fluidSurface').has('FLUID_WATER'));

  assert.ok(instance.mergedStaticVisualGroup);
  assert.deepEqual(instance.staticMerge.semanticClasses, ['RAIL', 'SUPPORT']);
  assert.equal(instance.getNodeByName('SUPPORT_COLUMN_A').visible, false);
  assert.equal(instance.getNodeByName('RAIL_LOWER_A').visible, false);
  assert.equal(instance.getNodeByName('SHELL_CEILING').visible, true);
  assert.equal(instance.getNodeByName('MECH_PLATFORM').visible, true);
  assert.equal(instance.getNodeByName('FLUID_WATER').visible, true);
  assert.equal(instance.collisionDerivedFromMeshBounds, false);
  assert.equal(instance.manifestCollisionVolumes.length, 2);
  assert.equal(instance.group.userData.collisionAuthority, 'manifest-and-accepted-plan-data-only');
  assert.equal('collisionMeshes' in instance, false);
});

test('missing, duplicate, and prefix requirements produce structured diagnostics', async () => {
  const scene = authoredScene();
  scene.add(marker('CONSOLE_ROUTER', 'console'));
  const brokenManifest = manifest({
    sockets: [{ id: 'missing', nodeName: 'SOCKET_MISSING' }],
    controller: { id: 'router', consoleNode: 'CONSOLE_ROUTER' },
    hazard: { panelPrefix: 'HAZARD_PANEL_MISSING_' },
  });
  const { runtime, binding } = runtimeFor({ scene, roomManifest: brokenManifest });
  await assert.rejects(
    runtime.preload(binding),
    (error) => {
      assert.ok(error instanceof SemanticRoomPackValidationErrorV1);
      assert.deepEqual(error.diagnostics.missingNodes.map(({ nodeName }) => nodeName), ['SOCKET_MISSING']);
      assert.deepEqual(error.diagnostics.duplicateNodes.map(({ nodeName }) => nodeName), ['CONSOLE_ROUTER']);
      assert.deepEqual(error.diagnostics.missingPrefixes.map(({ prefix }) => prefix), ['HAZARD_PANEL_MISSING_']);
      assert.equal(error.diagnostics.collisionDerivedFromMeshBounds, false);
      return true;
    },
  );
  assert.equal(runtime.isReady(binding), false);
  assert.throws(
    () => runtime.getTemplateSync(binding),
    (error) => error instanceof SemanticRoomPackTemplateNotReadyErrorV1
      && error.diagnostics.preloadFailed === true,
  );
});

function parseGlbJson(buffer) {
  let offset = 12;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) {
      return JSON.parse(buffer.subarray(offset + 8, offset + 8 + length).toString('utf8'));
    }
    offset += 8 + length;
  }
  throw new Error('GLB has no JSON chunk.');
}

function semanticSceneFromGlbJson(json) {
  const scene = new THREE.Group();
  scene.name = 'TEST_GLTF_SCENE';
  for (const record of json.nodes ?? []) {
    const object = new THREE.Object3D();
    object.name = record.name ?? '';
    object.userData = structuredClone(record.extras ?? {});
    if (record.translation) object.position.fromArray(record.translation);
    if (record.rotation) object.quaternion.fromArray(record.rotation);
    if (record.scale) object.scale.fromArray(record.scale);
    scene.add(object);
  }
  return scene;
}

test('every supplied pack GLB satisfies its manifest semantic-node contract', async () => {
  for (const room of SEMANTIC_ROOM_PACK_CATALOG_V1.rooms) {
    const glbUrl = new URL(`../../../assets/models/rooms/ruindivex-room-pack-v1/glb/${room.roomId}.glb`, import.meta.url);
    const manifestUrl = new URL(`../../../assets/models/rooms/ruindivex-room-pack-v1/manifests/${room.roomId}.json`, import.meta.url);
    const [glb, rawManifest] = await Promise.all([readFile(glbUrl), readFile(manifestUrl, 'utf8')]);
    const scene = semanticSceneFromGlbJson(parseGlbJson(glb));
    const roomManifest = JSON.parse(rawManifest);
    const runtime = createSemanticRoomPackPresentationRuntimeV1({
      runtimeModules: { three: THREE, GLTFLoader: class {} },
      loader: { loadAsync: async () => ({ scene }) },
      manifestLoader: async () => structuredClone(roomManifest),
      mergeStaticVisuals: false,
    });
    const template = await runtime.loadTemplate(room.roomId);
    assert.equal(template.validation.accepted, true, room.roomId);
    assert.equal(template.validation.missingNodes.length, 0, room.roomId);
    assert.equal(template.validation.missingPrefixes.length, 0, room.roomId);
    assert.equal(template.manifestCollisionVolumes.length, roomManifest.collisionVolumes.length);
    assert.equal(template.collisionDerivedFromMeshBounds, false);
  }
});

test('real GLTFLoader preloads every supplied pack room after restoring authored decimal node names', async () => {
  // GLTFLoader uses the browser-style `self.URL` spelling while decoding
  // embedded images. Node supplies URL/Blob but not the `self` alias.
  globalThis.self ??= globalThis;

  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const suppressExpectedNodeTextureWarning = (...args) => {
    if (String(args[0] ?? '').startsWith("THREE.GLTFLoader: Couldn't load texture blob:nodedata:")) return;
    originalConsoleError(...args);
  };
  console.error = suppressExpectedNodeTextureWarning;
  console.warn = suppressExpectedNodeTextureWarning;
  try {
    for (const room of SEMANTIC_ROOM_PACK_CATALOG_V1.rooms) {
      const glbUrl = new URL(`../../../assets/models/rooms/ruindivex-room-pack-v1/glb/${room.roomId}.glb`, import.meta.url);
      const manifestUrl = new URL(`../../../assets/models/rooms/ruindivex-room-pack-v1/manifests/${room.roomId}.json`, import.meta.url);
      const roomManifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
      const runtime = createSemanticRoomPackPresentationRuntimeV1({
        runtimeModules: { three: THREE, GLTFLoader },
        loader: {
          async loadAsync() {
            const bytes = await readFile(glbUrl);
            const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            return new GLTFLoader().parseAsync(arrayBuffer, '');
          },
        },
        manifestLoader: async () => structuredClone(roomManifest),
        mergeStaticVisuals: false,
      });

      const template = await runtime.loadTemplate(room.roomId);
      assert.equal(template.validation.accepted, true, room.roomId);
      assert.ok(template.nameRestoration.restored.length > 0, `${room.roomId} must exercise real GLTFLoader name restoration`);
      assert.equal(template.nameRestoration.ambiguous.length, 0, room.roomId);
      for (const { rawName, sanitizedName } of template.nameRestoration.restored) {
        assert.ok(template.templateRoot.getObjectByName(rawName), `${room.roomId}: ${rawName}`);
        assert.equal(template.templateRoot.getObjectByName(sanitizedName), undefined, `${room.roomId}: stale ${sanitizedName}`);
      }
    }
  } finally {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }
});
