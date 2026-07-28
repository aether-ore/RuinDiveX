import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createDungeonRegionThemeBinding } from './contracts.js';
import {
  createDungeonThemeResourceReference,
  createDungeonThemeResourceLedger,
  createDungeonThemeSession,
} from './ThemeSession.js';
import {
  assembleDungeonSupplement,
  DUNGEON_SUPPLEMENT_ROOT_NAME,
} from './DungeonSupplementAssembler.js';
import { mergeDungeonFacade } from './DungeonFacadeOverlay.js';
import {
  INDUSTRIAL_THEME_MATERIAL_ROLE_MAP,
  MAGMA_THEME_MATERIAL_ROLE_MAP,
  createIndustrialThemeAdapter,
  createMagmaThemeAdapter,
} from './ThemeAdapters.js';

const MATERIAL_ROLES = [
  'primaryFloor',
  'corridorFloor',
  'wall',
  'ceiling',
  'support',
  'cap',
];

function binding(regionId, themeId = 'test-theme') {
  return createDungeonRegionThemeBinding({
    parentMapId: 'test-map',
    parentMapRevision: '1',
    parentRegionId: regionId,
    themeRef: { id: themeId, revision: '1', contentHash: `${themeId}-hash` },
    presentationVariantId: 'test-variant',
    localLightingProfileId: 'test-lights',
    soundscapeProfileId: 'test-sound',
  });
}

function themeSession(themeBinding, label) {
  const material = new THREE.MeshStandardMaterial({ name: `${label}-parent-material` });
  const resources = createDungeonThemeResourceLedger();
  const materialProviders = Object.fromEntries(MATERIAL_ROLES.map((role) => [role, material]));
  const namedGroup = (name) => {
    const group = new THREE.Group();
    group.name = `${label}-${name}`;
    return group;
  };
  const session = createDungeonThemeSession({
    id: `${label}-session`,
    themeBinding,
    resources,
    materialProviders,
    assetProviders: {
      cap: () => namedGroup('cap'),
      lightFixture: () => namedGroup('light'),
      transitionFrame: () => namedGroup('transition-frame'),
    },
    connectorSkinProviders: {
      serviceGallery: () => namedGroup('service-gallery'),
      transitionBay: () => namedGroup('transition-bay'),
    },
    transitionProviders: {
      levelTransitionBay: () => namedGroup('transition-provider'),
    },
  });
  return { session, material, resources };
}

function basicOverlay(themeBinding) {
  const nodeA = {
    id: 'region-a__optionalBranch__node__0',
    operationId: 'region-a__optionalBranch__operation__0',
    parentRegionId: 'region-a',
    kind: 'supplementRoom',
    grammarId: 'test-room',
    themeBinding,
    placement: {
      center: { x: 28, y: 1.5, z: 0 },
      rotationQuarterTurns: 0,
      coordinateSpace: 'parent-plan',
    },
    size: { x: 11.2, y: 5.6, z: 11.2, widthMeters: 11.2, heightMeters: 5.6, depthMeters: 11.2 },
    structure: { supports: [{ id: 'corner-supports', role: 'support' }] },
    sockets: [
      {
        id: 'node-a-entry',
        nodeId: 'region-a__optionalBranch__node__0',
        position: { x: 28, y: 1.5, z: -5.6 },
        facing: { x: 0, y: 0, z: -1 },
        widthMeters: 8.4,
        heightMeters: 4.2,
        state: 'connected',
      },
      {
        id: 'node-a-unused',
        nodeId: 'region-a__optionalBranch__node__0',
        position: { x: 28, y: 1.5, z: 5.6 },
        facing: { x: 0, y: 0, z: 1 },
        widthMeters: 8.4,
        heightMeters: 4.2,
        state: 'capped',
      },
    ],
    anchors: [
      { id: 'node-a-encounter', kind: 'encounter', position: { x: 28, y: 1.5, z: 0 } },
      { id: 'node-a-reward', kind: 'reward', position: { x: 30.8, y: 1.5, z: 0 } },
      { id: 'node-a-light', kind: 'light-fixture', position: { x: 28, y: 5.8, z: 0 } },
    ],
    requiredThemeCapabilities: {
      materials: ['primary-floor', 'wall', 'ceiling', 'support', 'cap'],
      assets: ['light-fixture'],
      connectors: ['service-gallery'],
    },
  };
  return {
    schema: 'ruindivex-dungeon-augmentation-overlay/v1',
    revision: 1,
    profileId: 'test-profile',
    basePlanHash: 'base-hash',
    augmentationPlanHash: 'augmentation-hash',
    effectivePlanHash: 'effective-hash',
    augmentationSeed: 'test-seed',
    themeBindings: [themeBinding],
    operations: [{
      id: nodeA.operationId,
      type: 'optionalBranch',
      parentRegionId: 'region-a',
      themeBinding,
      nodeIds: [nodeA.id],
      segmentIds: ['region-a__optionalBranch__segment__0'],
    }],
    nodes: [nodeA],
    segments: [{
      id: 'region-a__optionalBranch__segment__0',
      operationId: nodeA.operationId,
      parentRegionId: 'region-a',
      connectorFamily: 'service-gallery',
      themeBinding,
      coordinateSpace: 'parent-plan',
      from: { nodeId: 'parent-room', socketId: 'parent-socket', position: { x: 28, y: 1.5, z: -11.2 } },
      to: { nodeId: nodeA.id, socketId: 'node-a-entry', position: { x: 28, y: 1.5, z: -5.6 } },
      path: [{ x: 28, y: 1.5, z: -11.2 }, { x: 28, y: 1.5, z: -5.6 }],
    }],
    transitionBays: [],
  };
}

test('assembles deterministic enclosed facade output from parent theme resources', () => {
  const regionBinding = binding('region-a');
  const { session, material, resources } = themeSession(regionBinding, 'a');
  let parentMaterialDisposeCount = 0;
  material.addEventListener('dispose', () => { parentMaterialDisposeCount += 1; });
  const fragment = assembleDungeonSupplement({
    overlayPlan: basicOverlay(regionBinding),
    themeSessions: new Map([['region-a', session]]),
  });

  assert.equal(fragment.root.name, DUNGEON_SUPPLEMENT_ROOT_NAME);
  assert.equal(fragment.rooms.length, 1);
  assert.equal(fragment.rooms[0].x, 10, 'world-meter center must not be scaled twice');
  assert.ok(fragment.floorTiles.length > 0);
  assert.ok(fragment.solidZones.some((zone) => zone.obstacleKind === 'boundaryWall'));
  assert.ok(fragment.solidZones.some((zone) => zone.obstacleKind === 'socketCap'));
  assert.ok(fragment.root.getObjectByName('supplementSupport__region-a__optionalBranch__node__0__0'));
  assert.equal(fragment.encounters.length, 1);
  assert.equal(fragment.chests.length, 1);
  assert.equal(fragment.localLights.length, 1);
  assert.equal(fragment.connectionPlans.length, 1);
  assert.equal(fragment.minimap.rooms[0].id, fragment.rooms[0].id);
  assert.ok(resources.isBorrowed(material));
  const meshMaterials = [];
  fragment.root.traverse((object) => {
    if (object.isMesh) meshMaterials.push(object.material);
  });
  assert.ok(meshMaterials.length > 0);
  assert.ok(meshMaterials.every((entry) => entry === material));

  const stableNames = [];
  fragment.root.traverse((object) => stableNames.push(object.name));
  const second = assembleDungeonSupplement({
    overlayPlan: basicOverlay(regionBinding),
    themeSessions: new Map([['region-a', themeSession(regionBinding, 'a').session]]),
  });
  const secondNames = [];
  second.root.traverse((object) => secondNames.push(object.name));
  assert.deepEqual(secondNames, stableNames);

  fragment.dispose();
  assert.equal(parentMaterialDisposeCount, 0, 'borrowed parent material remains parent-owned');
  second.dispose();
});

test('fragment disposal delegates owned theme products to their custom disposers once', () => {
  const regionBinding = binding('region-a');
  const resources = createDungeonThemeResourceLedger();
  const parentMaterial = new THREE.MeshStandardMaterial({ name: 'custom-disposer-parent' });
  let parentMaterialDisposals = 0;
  let customDisposals = 0;
  parentMaterial.addEventListener('dispose', () => { parentMaterialDisposals += 1; });
  const session = createDungeonThemeSession({
    id: 'custom-disposer-session',
    themeBinding: regionBinding,
    resources,
    materialProviders: Object.fromEntries(MATERIAL_ROLES.map((role) => [role, parentMaterial])),
    assetProviders: {
      lightFixture: () => createDungeonThemeResourceReference(
        new THREE.Group(),
        {
          ownership: 'owned',
          label: 'custom-light-fixture',
          dispose: (fixture) => {
            customDisposals += 1;
            fixture.clear();
          },
        },
      ),
    },
    connectorSkinProviders: {
      serviceGallery: () => new THREE.Group(),
    },
  });
  const fragment = assembleDungeonSupplement({
    overlayPlan: basicOverlay(regionBinding),
    themeSessions: new Map([['region-a', session]]),
    structuralMode: 'facadeOnly',
  });
  const secondFragment = assembleDungeonSupplement({
    overlayPlan: basicOverlay(regionBinding),
    themeSessions: new Map([['region-a', session]]),
    structuralMode: 'facadeOnly',
  });

  assert.equal(resources.snapshot().disposed, false);
  fragment.dispose();
  fragment.dispose();
  assert.equal(customDisposals, 1);
  assert.equal(resources.snapshot().disposed, false, 'disposing one fragment must not close a reusable parent session');
  secondFragment.dispose();
  assert.equal(customDisposals, 2);
  assert.equal(resources.snapshot().disposed, false);
  assert.equal(resources.snapshot().ownedCount, 0, 'disposed fragment products must not remain strongly retained');
  assert.equal(parentMaterialDisposals, 0, 'borrowed parent material remains parent-owned');
  resources.disposeOwned();
  parentMaterial.dispose();
});

test('merges facade arrays and maps without mutating the parent facade', () => {
  const regionBinding = binding('region-a');
  const { session } = themeSession(regionBinding, 'merge');
  const fragment = assembleDungeonSupplement({
    overlayPlan: basicOverlay(regionBinding),
    themeSessions: { 'region-a': session },
    structuralMode: 'facadeOnly',
  });
  assert.equal(fragment.localLights.length, 1);
  assert.equal(fragment.socketCaps.length, 1);
  assert.ok(fragment.root.getObjectByName('merge-light'));
  const baseRoom = { id: 'parent-room', x: 0, z: 0, width: 3, depth: 3 };
  const baseMinimapRoom = {
    roomId: 'parent-room',
    roomType: 'industrial-base',
    roomBounds2D: { x: -1.5, z: -1.5, width: 3, depth: 3 },
    roomCenter2D: { x: 0, z: 0 },
    connectedRoomIds: [],
  };
  const baseTile = { id: 'base-floor', x: 0, z: 0, elevation: 0 };
  const base = {
    group: new THREE.Group(),
    rooms: [baseRoom],
    floorTiles: [baseTile],
    tiles: new Map([['0,0', baseTile]]),
    minimap: {
      rooms: [baseMinimapRoom],
      hallways: [],
      bounds: { minX: -2, minZ: -2, width: 4, depth: 4 },
    },
    progression: { minimap: null, doors: [] },
  };
  const originalBaseBounds = { ...base.minimap.bounds };
  const effective = mergeDungeonFacade(base, fragment);

  assert.equal(base.rooms.length, 1);
  assert.equal(base.tiles.size, 1);
  assert.equal(fragment.root.parent, null);
  assert.equal(effective.rooms.length, 2);
  assert.notEqual(effective.rooms, base.rooms);
  assert.notEqual(effective.tiles, base.tiles);
  assert.equal(effective.basePlanHash, 'base-hash');
  assert.equal(effective.augmentationPlanHash, 'augmentation-hash');
  assert.equal(effective.effectivePlanHash, 'effective-hash');
  assert.deepEqual(base.minimap.bounds, originalBaseBounds, 'parent minimap bounds remain immutable');
  assert.deepEqual(effective.minimap.rooms[0].roomCenter2D, { x: 0, z: 0 });
  assert.deepEqual(effective.minimap.rooms[0].roomBounds2D, {
    x: -1.5,
    z: -1.5,
    width: 3,
    depth: 3,
  });
  const supplementRoom = effective.minimap.rooms.find((room) => room.dungeonSupplement);
  assert.ok(supplementRoom);
  assert.deepEqual(supplementRoom.roomCenter2D, { x: 10, z: 0 });
  assert.deepEqual(supplementRoom.roomBounds2D, { x: 8, z: -2, width: 4, depth: 4 });
  assert.ok(supplementRoom.connectedRoomIds.includes('parent-room'));
  assert.ok(effective.minimap.rooms[0].connectedRoomIds.includes(supplementRoom.roomId));
  const supplementHallway = effective.minimap.hallways.find((hallway) => hallway.dungeonSupplement);
  assert.equal(supplementHallway.hallwayId, supplementHallway.id);
  assert.equal(supplementHallway.fromRoomId, 'parent-room');
  assert.equal(supplementHallway.toRoomId, supplementRoom.roomId);
  assert.deepEqual(effective.minimap.bounds, {
    minX: -2,
    maxX: 12,
    minZ: -4,
    maxZ: 2,
    width: 14,
    depth: 6,
  });
  effective.attachDungeonSupplement();
  assert.equal(fragment.root.parent, base.group);
  effective.detachDungeonSupplement();
  assert.equal(fragment.root.parent, null);
});

test('builds a split transition bay cooperatively from both parent themes', () => {
  const sourceBinding = binding('source-region', 'source-theme');
  const destinationBinding = binding('destination-region', 'destination-theme');
  const source = themeSession(sourceBinding, 'source');
  const destination = themeSession(destinationBinding, 'destination');
  const overlayPlan = {
    schema: 'ruindivex-dungeon-augmentation-overlay/v1',
    revision: 1,
    operations: [],
    nodes: [],
    segments: [],
    transitionBays: [{
      schema: 'ruindivex-dungeon-transition-bay/v1',
      id: 'split-transition',
      sourceThemeBinding: sourceBinding,
      destinationThemeBinding: destinationBinding,
      splitRatio: 0.5,
      placement: {
        center: { x: 0, y: 0, z: 0 },
        rotationQuarterTurns: 0,
        coordinateSpace: 'parent-plan',
      },
      size: { x: 8.4, y: 5.6, z: 2.8, widthMeters: 8.4, heightMeters: 5.6, depthMeters: 2.8 },
      gatesAllowed: false,
      hazardsAllowed: false,
      encountersAllowed: false,
      connectorFamiliesAllowed: ['service-gallery'],
    }],
  };
  const fragment = assembleDungeonSupplement({
    overlayPlan,
    themeSessions: new Map([
      ['source-region', source.session],
      ['destination-region', destination.session],
    ]),
  });
  const names = [];
  fragment.root.traverse((object) => names.push(object.name));
  assert.ok(names.includes('source-transition-frame'));
  assert.ok(names.includes('destination-transition-frame'));
  assert.ok(names.includes('source-transition-bay'));
  assert.ok(names.includes('destination-transition-bay'));
  assert.ok(names.includes('source-transition-provider'));
  assert.ok(names.includes('destination-transition-provider'));
  assert.equal(fragment.connectionPlans[0].gatesAllowed, false);
  assert.equal(fragment.connectionPlans[0].hazardsAllowed, false);
  assert.equal(fragment.connectionPlans[0].path.length, 3);
  const transitionRoomIds = new Set(fragment.minimap.rooms.map((room) => room.roomId));
  assert.ok(transitionRoomIds.has('split-transition'));
  assert.equal(fragment.minimap.hallways.every((hallway) => (
    transitionRoomIds.has(hallway.fromRoomId)
      && transitionRoomIds.has(hallway.toRoomId)
  )), true);
  const facadeOnly = assembleDungeonSupplement({
    overlayPlan,
    structuralMode: 'facadeOnly',
    themeSessions: new Map([
      ['source-region', source.session],
      ['destination-region', destination.session],
    ]),
  });
  const facadeNames = [];
  facadeOnly.root.traverse((object) => facadeNames.push(object.name));
  assert.ok(facadeNames.includes('source-transition-frame'));
  assert.ok(facadeNames.includes('destination-transition-frame'));
  assert.ok(facadeNames.includes('source-transition-bay'));
  assert.ok(facadeNames.includes('destination-transition-bay'));
  assert.ok(facadeNames.includes('source-transition-provider'));
  assert.ok(facadeNames.includes('destination-transition-provider'));
  fragment.dispose();
  facadeOnly.dispose();
});

test('transition assembly rejects an exact-binding mismatch and missing seam capability before factories run', () => {
  const sourceBinding = binding('source-exact-region', 'shared-theme');
  const destinationBinding = binding('destination-exact-region', 'destination-theme');
  const wrongSourceBinding = createDungeonRegionThemeBinding({
    ...sourceBinding,
    parentRegionId: sourceBinding.parentRegionId,
    themeRef: {
      ...sourceBinding.themeRef,
      revision: 'wrong-revision',
      contentHash: 'wrong-content-hash',
    },
  });
  let presentationFactoryCalls = 0;
  const material = new THREE.MeshStandardMaterial({ name: 'preflight-parent-material' });
  const materialProviders = Object.fromEntries(MATERIAL_ROLES.map((role) => [role, material]));
  const createIncompleteSession = (themeBinding) => createDungeonThemeSession({
    themeBinding,
    materialProviders,
    assetProviders: {
      transitionFrame: () => {
        presentationFactoryCalls += 1;
        return new THREE.Group();
      },
    },
    connectorSkinProviders: {
      transitionBay: () => {
        presentationFactoryCalls += 1;
        return new THREE.Group();
      },
    },
  });
  const destination = themeSession(destinationBinding, 'destination-preflight');
  const overlayPlan = {
    schema: 'ruindivex-dungeon-augmentation-overlay/v1',
    revision: 1,
    operations: [],
    nodes: [],
    segments: [],
    transitionBays: [{
      schema: 'ruindivex-dungeon-transition-bay/v1',
      id: 'preflight-transition',
      sourceThemeBinding: sourceBinding,
      destinationThemeBinding: destinationBinding,
      splitRatio: 0.5,
      placement: { center: { x: 0, y: 0, z: 0 }, rotationQuarterTurns: 0 },
      size: { x: 8.4, y: 5.6, z: 2.8 },
      gatesAllowed: false,
      hazardsAllowed: false,
      encountersAllowed: false,
    }],
  };

  assert.throws(
    () => assembleDungeonSupplement({
      overlayPlan,
      themeSessions: new Map([
        [sourceBinding.parentRegionId, createIncompleteSession(wrongSourceBinding)],
        [destinationBinding.parentRegionId, destination.session],
      ]),
    }),
    (error) => error.code === 'MISSING_PARENT_THEME_SESSION',
  );
  assert.equal(presentationFactoryCalls, 0);

  assert.throws(
    () => assembleDungeonSupplement({
      overlayPlan,
      themeSessions: new Map([
        [sourceBinding.parentRegionId, createIncompleteSession(sourceBinding)],
        [destinationBinding.parentRegionId, destination.session],
      ]),
    }),
    (error) => error.code === 'MISSING_THEME_CAPABILITY'
      && error.diagnostics.some(({ capability }) => (
        capability === 'transition:levelTransitionBay'
      )),
  );
  assert.equal(presentationFactoryCalls, 0);

  material.dispose();
  destination.material.dispose();
});

test('assembles an Industrial-to-Magma seam through the concrete parent adapters', () => {
  const sourceBinding = binding('industrial-adapter-region', 'industrial-v1');
  const destinationBinding = binding('magma-adapter-region', 'magma-refinery');
  const materialSet = (roleMap, color) => Object.fromEntries(
    [...new Set(Object.values(roleMap))].map((key) => [
      key,
      new THREE.MeshStandardMaterial({ name: `${key}-parent`, color }),
    ]),
  );
  const industrialMaterials = materialSet(INDUSTRIAL_THEME_MATERIAL_ROLE_MAP, 0x59636a);
  const magmaMaterials = materialSet(MAGMA_THEME_MATERIAL_ROLE_MAP, 0xa84218);
  const product = (themeId, role) => {
    const group = new THREE.Group();
    group.name = `${themeId}-${role}`;
    group.userData.parentThemeId = themeId;
    return group;
  };
  const adapterOptions = (themeId) => ({
    assetFactory: (role) => product(themeId, role),
    assetRoles: ['transitionFrame'],
    connectorSkinFactory: (family) => product(themeId, family),
    connectorFamilies: ['transitionBay'],
    transitionFactory: (type) => product(themeId, type),
    transitionTypes: ['levelTransitionBay'],
  });
  const industrial = createIndustrialThemeAdapter({
    themeBinding: sourceBinding,
    materials: industrialMaterials,
    ...adapterOptions('industrial-v1'),
  });
  const magma = createMagmaThemeAdapter({
    themeBinding: destinationBinding,
    materials: magmaMaterials,
    textureContract: {
      root: '/assets/textures/magma-refinery/',
      metersPerRepeat: 2.8,
      sets: Object.fromEntries([...new Set(Object.values(MAGMA_THEME_MATERIAL_ROLE_MAP))]
        .map((key) => [key, `magma-${key}`])),
    },
    ...adapterOptions('magma-refinery'),
  });
  const overlayPlan = {
    schema: 'ruindivex-dungeon-augmentation-overlay/v1',
    revision: 1,
    operations: [],
    nodes: [],
    segments: [],
    transitionBays: [{
      schema: 'ruindivex-dungeon-transition-bay/v1',
      id: 'industrial-magma-transition',
      sourceThemeBinding: sourceBinding,
      destinationThemeBinding: destinationBinding,
      splitRatio: 0.5,
      placement: { center: { x: 0, y: 0, z: 0 }, rotationQuarterTurns: 0 },
      size: { x: 8.4, y: 5.6, z: 2.8 },
      gatesAllowed: false,
      hazardsAllowed: false,
      encountersAllowed: false,
    }],
  };
  const fragment = assembleDungeonSupplement({
    overlayPlan,
    structuralMode: 'facadeOnly',
    themeSessions: new Map([
      [sourceBinding.parentRegionId, industrial],
      [destinationBinding.parentRegionId, magma],
    ]),
  });
  const themeIds = new Set();
  fragment.root.traverse((object) => {
    if (object.userData?.parentThemeId) themeIds.add(object.userData.parentThemeId);
  });
  assert.deepEqual([...themeIds].sort(), ['industrial-v1', 'magma-refinery']);
  assert.equal(fragment.minimap.rooms.some(({ roomId }) => (
    roomId === 'industrial-magma-transition'
  )), true);
  fragment.dispose();
  for (const material of [...Object.values(industrialMaterials), ...Object.values(magmaMaterials)]) {
    material.dispose();
  }
});
