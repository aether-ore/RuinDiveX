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

const STRUCTURAL_MATERIAL_ROLES = [
  ...MATERIAL_ROLES,
  'catwalk',
  'ramp',
  'rail',
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

function structuralOverlay(themeBinding, { baseElevation = 10 } = {}) {
  const nodeId = 'region-a__optionalBranch__structural-node__0';
  const operationId = 'region-a__optionalBranch__structural-operation__0';
  return {
    schema: 'ruindivex-dungeon-augmentation-overlay/v1',
    revision: 1,
    profileId: 'test-structural-profile',
    basePlanHash: 'base-hash',
    augmentationPlanHash: 'structural-augmentation-hash',
    effectivePlanHash: 'structural-effective-hash',
    augmentationSeed: 'structural-test-seed',
    themeBindings: [themeBinding],
    operations: [{
      id: operationId,
      type: 'optionalBranch',
      parentRegionId: 'region-a',
      themeBinding,
      nodeIds: [nodeId],
      segmentIds: [],
    }],
    nodes: [{
      id: nodeId,
      operationId,
      parentRegionId: 'region-a',
      kind: 'supplementRoom',
      grammarId: 'test-structural-room',
      themeBinding,
      placement: {
        center: { x: 28, y: baseElevation, z: 0 },
        rotationQuarterTurns: 0,
        coordinateSpace: 'parent-plan',
      },
      size: {
        x: 19.6,
        y: 8.4,
        z: 19.6,
        widthMeters: 19.6,
        heightMeters: 8.4,
        depthMeters: 19.6,
      },
      structure: {
        supports: [],
        platforms: [{
          id: 'overlook',
          role: 'catwalk',
          localCenterGrid: { x: 0, z: 1 },
          widthTiles: 3,
          depthTiles: 3,
          elevation: 2.8,
          platformPurpose: 'test-overlook',
        }],
        ramps: [{
          id: 'overlook-ramp',
          role: 'ramp',
          localStartGrid: { x: -2, z: -2 },
          localEndGrid: { x: -2, z: 1 },
          fromElevation: 0,
          toElevation: 2.8,
          widthTiles: 1,
        }],
        rails: [{
          id: 'overlook-rails',
          role: 'rail',
          platformId: 'overlook',
        }],
      },
      sockets: [],
      anchors: [{
        id: 'overlook-anchor',
        kind: 'platform',
        position: { x: 28, y: baseElevation + 2.8, z: 2.8 },
        localPosition: { x: 0, y: 0, z: 2.8 },
        elevation: 2.8,
        halfWidth: 4.2,
        halfDepth: 4.2,
        platformPurpose: 'test-overlook',
      }],
      requiredThemeCapabilities: {
        materials: ['primary-floor', 'wall', 'ceiling'],
        assets: [],
        connectors: [],
      },
    }],
    segments: [],
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
  const sharedThresholdFloor = fragment.floorTiles.find((floor) => (
    floor.x === 10 && floor.z === -2 && Math.abs(floor.elevation - 1.5) < 0.001
  ));
  assert.ok(sharedThresholdFloor, 'the exact room/corridor threshold must be rasterized');
  assert.deepEqual(sharedThresholdFloor.mergedFloorOwnerIds, [
    'region-a__optionalBranch__node__0',
    'region-a__optionalBranch__segment__0',
  ]);
  assert.ok(sharedThresholdFloor.mergedFloorSourceCount >= 2);
  assert.equal(sharedThresholdFloor.mergedUnownedFloorSourceCount, 0);
  assert.equal(sharedThresholdFloor.sharedThresholdContractIds.length, 1);
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

test('assembles compact connector junctions as themed non-room proxy metadata', () => {
  const regionBinding = binding('region-a');
  const { session, material } = themeSession(regionBinding, 'compact');
  const operationId = 'region-a__routeNetwork__compact-operation';
  const proxyId = `${operationId}__connector-junction`;
  const roomSpecifications = [
    { id: `${operationId}__room-a`, center: { x: -28, y: 0, z: 0 } },
    { id: `${operationId}__room-b`, center: { x: 28, y: 0, z: 0 } },
    { id: `${operationId}__room-c`, center: { x: 0, y: 0, z: 28 } },
  ];
  const armSpecifications = [
    { id: 'west', position: { x: -5.6, y: 0, z: 0 }, facing: { x: -1, y: 0, z: 0 } },
    { id: 'east', position: { x: 5.6, y: 0, z: 0 }, facing: { x: 1, y: 0, z: 0 } },
    { id: 'south', position: { x: 0, y: 0, z: 5.6 }, facing: { x: 0, y: 0, z: 1 } },
  ];
  const segments = roomSpecifications.map((room, index) => ({
    id: `${operationId}__segment-${index}`,
    operationId,
    parentRegionId: 'region-a',
    themeBinding: regionBinding,
    connectorFamily: 'service-gallery',
    from: {
      nodeId: room.id,
      socketId: `${room.id}:exit`,
      position: room.center,
    },
    to: {
      nodeId: proxyId,
      socketId: `${proxyId}:${armSpecifications[index].id}`,
      position: armSpecifications[index].position,
      facing: armSpecifications[index].facing,
    },
    path: [room.center, armSpecifications[index].position],
  }));
  const roomNodes = roomSpecifications.map((room, index) => ({
    id: room.id,
    operationId,
    parentRegionId: 'region-a',
    kind: 'supplementRoom',
    grammarId: 'test-substantive-room',
    themeBinding: regionBinding,
    placement: { center: room.center, coordinateSpace: 'parent-plan' },
    size: { x: 11.2, y: 5.6, z: 11.2 },
    structure: {},
    sockets: [{
      id: `${room.id}:exit`,
      nodeId: room.id,
      position: room.center,
      state: 'connected',
      segmentId: segments[index].id,
    }],
    anchors: [],
    environment: false,
  }));
  const connectorNode = {
    id: proxyId,
    operationId,
    parentRegionId: 'region-a',
    kind: 'supplementConnectorJunction',
    grammarId: 'test-compact-crossroads',
    themeBinding: regionBinding,
    placement: { center: { x: 0, y: 0, z: 0 }, coordinateSpace: 'parent-plan' },
    size: { x: 11.2, y: 5.6, z: 11.2 },
    structure: {},
    sockets: [
      ...armSpecifications.map((arm, index) => ({
        id: `${proxyId}:${arm.id}`,
        nodeId: proxyId,
        position: arm.position,
        facing: arm.facing,
        state: 'connected',
        segmentId: segments[index].id,
      })),
      {
        id: `${proxyId}:north-unused`,
        nodeId: proxyId,
        position: { x: 0, y: 0, z: -5.6 },
        facing: { x: 0, y: 0, z: -1 },
        state: 'capped',
      },
    ],
    anchors: [
      { id: `${proxyId}:encounter`, kind: 'encounter', position: { x: 0, y: 0, z: 0 } },
      { id: `${proxyId}:reward`, kind: 'reward', position: { x: 0, y: 0, z: 0 } },
      { id: `${proxyId}:progression`, kind: 'progression', position: { x: 0, y: 0, z: 0 } },
      {
        id: `${proxyId}:light`,
        kind: 'light-fixture',
        assetRole: 'light-fixture',
        position: { x: 0, y: 4.8, z: 0 },
      },
    ],
    encounters: [{ id: `${proxyId}:declared-encounter` }],
    junction: {
      id: `${proxyId}:junction`,
      junctionKind: 'crossroads',
      activeSocketIds: armSpecifications.map(({ id }) => `${proxyId}:${id}`),
      countsAsMeaningfulStation: true,
    },
    countsAsMeaningfulStation: true,
    requiredThemeCapabilities: { materials: [], assets: ['light-fixture'], connectors: [] },
    environment: false,
  };
  const fragment = assembleDungeonSupplement({
    overlayPlan: {
      schema: 'ruindivex-dungeon-augmentation-overlay/v2',
      profileId: 'compact-proxy-test',
      themeBindings: [regionBinding],
      operations: [{
        id: operationId,
        type: 'optionalBranch',
        parentRegionId: 'region-a',
        themeBinding: regionBinding,
        nodeIds: [...roomNodes.map(({ id }) => id), proxyId],
        segmentIds: segments.map(({ id }) => id),
      }],
      nodes: [...roomNodes, connectorNode],
      segments,
      progressionAssignments: [{
        id: `${proxyId}:delegated-beat`,
        nodeId: proxyId,
        anchorId: `${proxyId}:progression`,
        beatId: 'must-not-appear',
        beatKind: 'objective',
      }],
    },
    themeSessions: new Map([['region-a', session]]),
    structuralMode: 'facadeOnly',
  });

  assert.deepEqual(fragment.rooms.map(({ id }) => id).sort(), roomNodes.map(({ id }) => id).sort());
  assert.equal(fragment.minimap.rooms.some(({ roomId }) => roomId === proxyId), false);
  assert.equal(fragment.connectorJunctionProxies.length, 1);
  const proxy = fragment.connectorJunctionProxies[0];
  assert.equal(proxy.id, proxyId);
  assert.equal(proxy.kind, 'supplementConnectorJunction');
  assert.equal(proxy.isDungeonSupplement, false);
  assert.equal(proxy.isConnectorJunctionProxy, true);
  assert.equal(proxy.suppressRoomGeometry, true);
  assert.equal(proxy.stampConnectorJunctionFloor, true);
  assert.equal(proxy.countsAsMeaningfulStation, true);
  assert.equal(proxy.minimumPhysicalArmCount, 3);
  assert.equal(proxy.physicalArmCount, 3);
  assert.equal(proxy.connectorJunctionSockets.length, 4);
  assert.deepEqual(proxy.anchors.map(({ kind }) => kind), ['light-fixture']);
  assert.equal(Object.hasOwn(proxy, 'encounters'), false);
  assert.equal(fragment.junctions.length, 1);
  assert.equal(fragment.socketCaps.length, 1);
  assert.equal(fragment.socketCaps[0].connectorJunctionProxyId, proxyId);
  assert.equal(Object.hasOwn(fragment.socketCaps[0], 'roomId'), false);
  assert.equal(fragment.encounters.length, 0);
  assert.equal(fragment.chests.length, 0);
  assert.equal(fragment.progressionAssignments.length, 0);
  assert.equal(fragment.progressionPatch, undefined);
  assert.equal(fragment.localLights.length, 1);
  assert.ok(fragment.root.getObjectByName('compact-cap'));
  assert.ok(fragment.root.getObjectByName('compact-light'));
  assert.ok(fragment.root.getObjectByName(`DungeonSupplementConnectorJunction__${proxyId}`));
  assert.deepEqual(fragment.root.userData.supplementalRoomIds, roomNodes.map(({ id }) => id).sort());
  assert.deepEqual(fragment.root.userData.connectorJunctionProxyIds, [proxyId]);
  assert.equal(fragment.connectionPlans.length, 3);
  assert.equal(fragment.connectionPlans.every((connection) => (
    connection.toNodeId === proxyId
      && connection.progressionFromRoomId !== proxyId
      && connection.progressionToRoomId !== proxyId
      && connection.progressionCollapsedSelfEdge === false
      && connection.toSocket.connectorJunctionProxyId === proxyId
  )), true);
  assert.equal(fragment.minimap.hallways.length, 3);
  assert.equal(fragment.minimap.hallways.every((hallway) => (
    hallway.fromRoomId !== proxyId && hallway.toRoomId !== proxyId
  )), true);

  fragment.dispose();
  material.dispose();
});

test('facade-only doorway frames require an active socket and inherit its exact aperture', () => {
  const regionBinding = binding('region-a');
  const overlayPlan = basicOverlay(regionBinding);
  const node = overlayPlan.nodes[0];
  node.anchors.push({
    id: 'node-a-entry-frame',
    localAnchorId: 'entry-frame',
    kind: 'doorway-frame',
    assetRole: 'frame',
    position: { ...node.sockets[0].position },
  }, {
    id: 'node-a-unused-frame',
    localAnchorId: 'unused-frame',
    kind: 'doorway-frame',
    assetRole: 'frame',
    position: { ...node.sockets[1].position },
  });
  node.sockets[0].localSocketId = 'entry';
  node.sockets[1].localSocketId = 'unused';
  node.requiredThemeCapabilities.assets.push('frame');

  const material = new THREE.MeshStandardMaterial({ name: 'frame-parent-material' });
  const resources = createDungeonThemeResourceLedger();
  const frameSpecifications = [];
  const makeAsset = (name) => {
    const group = new THREE.Group();
    group.name = name;
    return group;
  };
  const session = createDungeonThemeSession({
    id: 'frame-theme-session',
    themeBinding: regionBinding,
    resources,
    materialProviders: Object.fromEntries(MATERIAL_ROLES.map((role) => [role, material])),
    assetProviders: {
      cap: () => makeAsset('capped-socket'),
      lightFixture: () => makeAsset('room-light'),
      frame: (specification) => {
        frameSpecifications.push(specification);
        return makeAsset('active-doorway-frame');
      },
    },
    connectorSkinProviders: {
      serviceGallery: () => makeAsset('service-gallery'),
    },
  });
  const fragment = assembleDungeonSupplement({
    overlayPlan,
    themeSessions: new Map([['region-a', session]]),
    structuralMode: 'facadeOnly',
  });

  assert.equal(frameSpecifications.length, 1);
  assert.equal(frameSpecifications[0].socketId, 'node-a-entry');
  assert.equal(frameSpecifications[0].widthMeters, 8.4);
  assert.equal(frameSpecifications[0].heightMeters, 4.2);
  assert.equal(fragment.socketCaps.length, 1);
  const names = [];
  fragment.root.traverse((object) => names.push(object.name));
  assert.ok(names.includes('active-doorway-frame'));
  assert.ok(names.includes('capped-socket'));

  const unsafeSession = createDungeonThemeSession({
    id: 'unsafe-frame-theme-session',
    themeBinding: regionBinding,
    resources: createDungeonThemeResourceLedger(),
    materialProviders: Object.fromEntries(MATERIAL_ROLES.map((role) => [role, material])),
    assetProviders: {
      cap: () => makeAsset('unsafe-cap'),
      lightFixture: () => makeAsset('unsafe-light'),
      frame: () => ({
        object: makeAsset('unsafe-frame'),
        floorTiles: [{ x: 999, z: 999, elevation: 0 }],
        platforms: [{ id: 'orphan-factory-platform' }],
      }),
    },
    connectorSkinProviders: {
      serviceGallery: () => makeAsset('unsafe-service-gallery'),
    },
  });
  assert.throws(() => assembleDungeonSupplement({
    overlayPlan,
    themeSessions: new Map([['region-a', unsafeSession]]),
    structuralMode: 'facadeOnly',
  }), (error) => error?.code === 'FACADE_ONLY_FACTORY_TOPOLOGY_FORBIDDEN');
  assert.throws(() => assembleDungeonSupplement({
    overlayPlan,
    themeSessions: new Map([['region-a', unsafeSession]]),
    structuralMode: 'complete',
  }), (error) => error?.code === 'THEME_FACTORY_TOPOLOGY_FORBIDDEN');

  fragment.dispose();
  material.dispose();
});

test('complete assembly rejects unrelated same-elevation floor ownership collisions', () => {
  const regionBinding = binding('region-a');
  const overlayPlan = basicOverlay(regionBinding);
  const firstNode = overlayPlan.nodes[0];
  const secondNode = structuredClone(firstNode);
  secondNode.id = 'region-a__optionalBranch__unrelated-overlap';
  secondNode.grammarId = 'unrelated-overlap-room';
  secondNode.sockets = [];
  secondNode.anchors = [];
  overlayPlan.nodes.push(secondNode);
  overlayPlan.operations[0].nodeIds.push(secondNode.id);
  const { session, material } = themeSession(regionBinding, 'overlap');

  assert.throws(() => assembleDungeonSupplement({
    overlayPlan,
    themeSessions: new Map([['region-a', session]]),
    structuralMode: 'complete',
  }), (error) => (
    error?.code === 'DUNGEON_SUPPLEMENT_FLOOR_OWNERSHIP_CONFLICT'
    && error.diagnostics[0].existingOwnerIds.includes(firstNode.id)
    && error.diagnostics[0].incomingOwnerIds.includes(secondNode.id)
  ));

  material.dispose();
});

test('realizes declared platforms, ramps, and rails with absolute facade elevations', () => {
  const regionBinding = binding('region-a');
  const material = new THREE.MeshStandardMaterial({ name: 'structural-parent-material' });
  const resources = createDungeonThemeResourceLedger();
  const session = createDungeonThemeSession({
    id: 'structural-theme-session',
    themeBinding: regionBinding,
    resources,
    materialProviders: Object.fromEntries(
      STRUCTURAL_MATERIAL_ROLES.map((role) => [role, material]),
    ),
  });
  const fragment = assembleDungeonSupplement({
    overlayPlan: structuralOverlay(regionBinding),
    themeSessions: new Map([['region-a', session]]),
  });

  assert.equal(fragment.platforms.length, 1, 'structure and matching anchor must upsert one platform');
  const [platform] = fragment.platforms;
  assert.equal(platform.id, 'overlook-anchor');
  assert.equal(platform.center.y, 12.8);
  assert.equal(platform.position.y, 12.8);
  assert.equal(platform.elevation, 12.8);
  assert.equal(platform.topY, 12.8);
  assert.ok(Math.abs(platform.baseY - 12.62) < 1e-9);
  assert.deepEqual(platform.railSides, ['north', 'south', 'east']);

  const platformMesh = [];
  const rampMeshes = [];
  const railMeshes = [];
  fragment.root.traverse((object) => {
    if (object.userData?.supplementPlatformId && !object.userData?.supplementRailId) {
      platformMesh.push(object);
    }
    if (object.userData?.supplementRampId) rampMeshes.push(object);
    if (object.userData?.supplementRailId) railMeshes.push(object);
  });
  assert.equal(platformMesh.length, 1);
  assert.equal(rampMeshes.length, 1);
  assert.equal(railMeshes.length, 3, 'the ramp-facing west edge remains open');
  assert.ok([...platformMesh, ...rampMeshes, ...railMeshes].every((mesh) => (
    mesh.material === material
  )));

  const platformFloors = fragment.floorTiles.filter(({ surfaceRole }) => surfaceRole === 'catwalk');
  const rampFloors = fragment.floorTiles.filter(({ surfaceRole }) => surfaceRole === 'ramp');
  assert.ok(platformFloors.length >= 9);
  assert.equal(new Set(platformFloors.map(({ elevation }) => elevation)).size, 1);
  assert.equal(platformFloors[0].elevation, 12.8);
  assert.ok(rampFloors.length >= 2);
  const rampElevations = rampFloors.map(({ elevation }) => elevation);
  assert.ok(Math.min(...rampElevations) >= 10);
  assert.ok(Math.max(...rampElevations) <= 12.8);
  assert.ok(rampElevations.some((elevation) => elevation > 10 && elevation < 12.8));

  assert.equal(fragment.verticalConnectors.length, 1);
  assert.equal(fragment.verticalConnectors[0].connectorFamily, 'slope');
  assert.equal(fragment.verticalConnectors[0].fromElevation, 10);
  assert.equal(fragment.verticalConnectors[0].toElevation, 12.8);
  assert.ok(Math.abs(fragment.verticalConnectors[0].elevationDelta - 2.8) < 1e-9);
  assert.equal(
    fragment.solidZones.filter(({ obstacleKind }) => obstacleKind === 'safetyRail').length,
    3,
  );
  assert.ok(resources.isBorrowed(material));

  const facadeOnly = assembleDungeonSupplement({
    overlayPlan: structuralOverlay(regionBinding),
    themeSessions: new Map([['region-a', session]]),
    structuralMode: 'facadeOnly',
  });
  assert.equal(facadeOnly.platforms.length, 0);
  assert.equal(facadeOnly.verticalConnectors.length, 0);
  assert.equal(facadeOnly.floorTiles.length, 0);

  facadeOnly.dispose();
  fragment.dispose();
  material.dispose();
});

test('preflights declared structure roles before resolving any theme material', () => {
  const regionBinding = binding('region-a');
  const material = new THREE.MeshStandardMaterial({ name: 'incomplete-structure-material' });
  let resolverCalls = 0;
  const materialProviders = Object.fromEntries(
    STRUCTURAL_MATERIAL_ROLES
      .filter((role) => role !== 'rail')
      .map((role) => [role, () => {
        resolverCalls += 1;
        return material;
      }]),
  );
  const session = createDungeonThemeSession({
    id: 'incomplete-structural-theme-session',
    themeBinding: regionBinding,
    materialProviders,
  });

  assert.throws(
    () => assembleDungeonSupplement({
      overlayPlan: structuralOverlay(regionBinding),
      themeSessions: new Map([['region-a', session]]),
    }),
    (error) => error.code === 'MISSING_THEME_CAPABILITY'
      && error.diagnostics.some(({ capability }) => capability === 'material:rail'),
  );
  assert.equal(resolverCalls, 0);
  material.dispose();
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

test('facade floor overlays preserve explicit shared-threshold provenance and reject unrelated owners', () => {
  const baseFloor = {
    id: 'authored-floor',
    x: 4,
    z: 2,
    elevation: 0,
    roomId: 'authored-room',
  };
  const base = {
    group: new THREE.Group(),
    floorTiles: [baseFloor],
    tiles: new Map([['4,2', baseFloor]]),
  };
  const fragment = (floor) => ({
    schema: 'ruindivex-dungeon-supplement-fragment/v1',
    root: new THREE.Group(),
    floorTiles: [floor],
    tiles: new Map([['4,2', floor]]),
  });
  const unrelatedFloor = {
    id: 'unrelated-supplement-floor',
    x: 4,
    z: 2,
    elevation: 0,
    roomId: 'unrelated-supplement-room',
  };
  assert.throws(
    () => mergeDungeonFacade(base, fragment(unrelatedFloor)),
    (error) => error?.code === 'DUNGEON_FACADE_FLOOR_OWNERSHIP_CONFLICT',
  );
  assert.equal(base.floorTiles[0], baseFloor);
  assert.equal(baseFloor.mergedFloorOwnerIds, undefined);

  const sharedFloor = {
    id: 'shared-supplement-threshold',
    x: 4,
    z: 2,
    elevation: 0,
    connectorId: 'supplement-connector',
    connectionId: 'supplement-connector',
    sharedThresholdOwnerIds: ['authored-room', 'supplement-connector'],
    sharedThresholdContractIds: ['supplement-threshold-contract'],
  };
  const effective = mergeDungeonFacade(base, fragment(sharedFloor));
  assert.equal(effective.floorTiles.length, 1);
  assert.deepEqual(effective.floorTiles[0].mergedFloorOwnerIds, [
    'authored-room',
    'supplement-connector',
  ]);
  assert.equal(effective.floorTiles[0].mergedFloorSourceCount, 2);
  assert.equal(effective.floorTiles[0].mergedUnownedFloorSourceCount, 0);
  assert.deepEqual(
    effective.floorTiles[0].sharedThresholdContractIds,
    ['supplement-threshold-contract'],
  );
  assert.deepEqual(effective.tiles.get('4,2').mergedFloorOwnerIds, [
    'authored-room',
    'supplement-connector',
  ]);
  assert.equal(baseFloor.mergedFloorOwnerIds, undefined, 'base provenance remains immutable');
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

function routeNetworkOverlay(themeBinding, { corruptSocket = false } = {}) {
  const operationId = 'region-a__routeNetwork__operation__0';
  const junctionId = 'region-a__routeNetwork__junction__0';
  const rewardId = 'region-a__routeNetwork__reward__0';
  const parentWestId = 'parent-west-unused';
  const parentEastId = 'parent-east-unused';
  const westId = `${junctionId}:west`;
  const eastId = `${junctionId}:east`;
  const southId = `${junctionId}:south`;
  const rewardNorthId = `${rewardId}:north`;
  const socket = (id, nodeId, position, facing, state = 'connected') => ({
    id,
    nodeId,
    position,
    facing,
    widthMeters: 8.4,
    heightMeters: 3.6,
    state,
  });
  const nodes = [{
    id: junctionId,
    operationId,
    parentRegionId: 'region-a',
    grammarId: 'supplement-through-t-v1',
    themeBinding,
    placement: { center: { x: 0, y: 0, z: -28 }, rotationQuarterTurns: 0 },
    size: { x: 14, y: 8.4, z: 19.6 },
    sockets: [
      socket(westId, junctionId, { x: -7, y: 0, z: -28 }, { x: -1, y: 0, z: 0 }),
      socket(eastId, junctionId, { x: 7, y: 0, z: -28 }, { x: 1, y: 0, z: 0 }),
      socket(southId, junctionId, { x: 0, y: 0, z: -18.2 }, { x: 0, y: 0, z: 1 }),
    ],
    junction: {
      junctionKind: 'through-t',
      throughSocketPairs: [[westId, eastId]],
      decisionSocketIds: [southId],
      countsAsMeaningfulStation: true,
    },
    contentRole: 'challenge-junction',
    anchors: [{ id: 'junction-encounter', kind: 'encounter', position: { x: 0, y: 0, z: -28 } }],
    requiredThemeCapabilities: {
      materials: ['primary-floor', 'wall', 'ceiling'],
      connectors: ['service-gallery'],
    },
  }, {
    id: rewardId,
    operationId,
    parentRegionId: 'region-a',
    grammarId: 'supplement-reward-v1',
    themeBinding,
    placement: { center: { x: 0, y: 0, z: 0 }, rotationQuarterTurns: 0 },
    size: { x: 11.2, y: 8.4, z: 11.2 },
    sockets: [socket(rewardNorthId, rewardId, { x: 0, y: 0, z: -5.6 }, { x: 0, y: 0, z: -1 })],
    contentRole: 'treasure',
    anchors: [{ id: 'reward-cache', kind: 'reward', position: { x: 0, y: 0, z: 0 } }],
    requiredThemeCapabilities: {
      materials: ['primary-floor', 'wall', 'ceiling'],
      connectors: ['service-gallery'],
    },
  }];
  const parentWest = {
    id: parentWestId,
    nodeId: 'keycardRoom',
    socketId: corruptSocket ? 'ungranted-parent-socket' : parentWestId,
    position: { x: -28, y: 0, z: -28 },
    facing: { x: 1, y: 0, z: 0 },
  };
  const parentEast = {
    id: parentEastId,
    nodeId: 'keycardRoom',
    socketId: parentEastId,
    position: { x: 28, y: 0, z: -28 },
    facing: { x: -1, y: 0, z: 0 },
  };
  const segments = [{
    id: `${operationId}:segment:west`,
    operationId,
    parentRegionId: 'region-a',
    connectorFamily: 'service-gallery',
    themeBinding,
    from: parentWest,
    to: { nodeId: junctionId, socketId: westId, position: { x: -7, y: 0, z: -28 } },
    path: [parentWest.position, { x: -7, y: 0, z: -28 }],
  }, {
    id: `${operationId}:segment:east`,
    operationId,
    parentRegionId: 'region-a',
    connectorFamily: 'service-gallery',
    themeBinding,
    from: { nodeId: junctionId, socketId: eastId, position: { x: 7, y: 0, z: -28 } },
    to: parentEast,
    path: [{ x: 7, y: 0, z: -28 }, parentEast.position],
  }, {
    id: `${operationId}:segment:reward`,
    operationId,
    parentRegionId: 'region-a',
    connectorFamily: 'service-gallery',
    themeBinding,
    from: { nodeId: junctionId, socketId: southId, position: { x: 0, y: 0, z: -18.2 } },
    to: { nodeId: rewardId, socketId: rewardNorthId, position: { x: 0, y: 0, z: -5.6 } },
    path: [{ x: 0, y: 0, z: -18.2 }, { x: 0, y: 0, z: -5.6 }],
    doorId: 'SupplementEncounterGate_0',
    requiresEncounterId: 'junction-encounter',
    gatePlacementSide: 'source',
    shortcut: {
      kind: 'drop-ladder',
      stateId: 'route-network-shortcut-state-0',
      initialState: 'retracted',
      activatedState: 'deployed',
      activationSide: 'far',
      persistent: true,
    },
  }];
  return {
    schema: 'ruindivex-dungeon-augmentation-overlay/v2',
    revision: 2,
    profileId: 'industrial-supplement-preview-v4',
    themeBindings: [themeBinding],
    operations: [{
      id: operationId,
      type: 'routeNetwork',
      parentRegionId: 'region-a',
      themeBinding,
      grantId: 'pyramid-loop-grant',
      routeNetworkKind: 'landmark-perimeter-loop',
      endpointSocketIds: [parentWestId, parentEastId],
      nodeIds: nodes.map(({ id }) => id),
      segmentIds: segments.map(({ id }) => id),
      topologyTemplateId: 'fork-merge-h-loop',
      elevationModes: ['drop-ladder'],
      progressionBandId: 0,
      accessDomainId: 'industrial:band-0',
      stableRuntimeStateIds: ['route-network-shortcut-state-0'],
    }],
    nodes,
    segments,
  };
}

function connectorOnlyParentAnchoredOverlay(themeBinding, {
  realizationMode = 'parent-anchored-forest',
  corruptComponent = false,
} = {}) {
  const overlayPlan = routeNetworkOverlay(themeBinding);
  overlayPlan.profileRevision = 5;
  const operation = overlayPlan.operations[0];
  const connectorNode = overlayPlan.nodes[0];
  const retainedSegments = overlayPlan.segments.slice(0, 2);
  connectorNode.kind = 'supplementConnectorModule';
  connectorNode.nodeKind = 'supplementConnectorModule';
  connectorNode.anchors = [];
  connectorNode.sockets = connectorNode.sockets.slice(0, 2);
  for (const segment of retainedSegments) segment.bidirectional = true;
  overlayPlan.nodes = [connectorNode];
  overlayPlan.segments = retainedSegments;
  operation.nodeIds = [connectorNode.id];
  operation.segmentIds = retainedSegments.map(({ id }) => id);
  operation.returnRouteGuaranteed = true;
  if (realizationMode) {
    operation.realizationMode = realizationMode;
    operation.localProgressionArcRealized = false;
    operation.omittedEndpointSocketIds = [];
    operation.parentAnchoredComponents = [{
      id: `${operation.id}:parent-anchored-component:0`,
      attachmentSocketIds: corruptComponent
        ? [operation.endpointSocketIds[0]]
        : [...operation.endpointSocketIds],
      attachmentSocketId: operation.endpointSocketIds[0],
      nodeIds: [...operation.nodeIds],
      segmentIds: [...operation.segmentIds],
      bidirectional: true,
    }];
  }
  return overlayPlan;
}

test('connector-only V4 parent-anchored forests assemble as exact physical supplements', () => {
  const regionBinding = binding('region-a');
  const { session, material } = themeSession(regionBinding, 'connector-only-forest');
  const overlayPlan = connectorOnlyParentAnchoredOverlay(regionBinding);

  const fragment = assembleDungeonSupplement({
    overlayPlan,
    themeSession: session,
    structuralMode: 'complete',
  });

  assert.equal(fragment.rooms.length, 0);
  assert.equal(fragment.connectorJunctionProxies.length, 1);
  assert.equal(fragment.connectorJunctionProxies[0].physicalArmCount, 2);
  assert.equal(fragment.connectionPlans.length, 2);
  assert.ok(fragment.connectionPlans.every((plan) => (
    plan.routeNetworkRealizationMode === 'parent-anchored-forest'
      && plan.routeNetworkLocalProgressionArcRealized === false
      && plan.routeNetworkProgressionProjectionMode
        === 'parent-anchored-component-physical-only'
      && plan.progressionFromRoomId === 'keycardRoom'
      && plan.progressionToRoomId === 'keycardRoom'
      && plan.progressionCollapsedSelfEdge === true
  )));
  assert.equal(fragment.minimap.hallways.length, 0);
  fragment.dispose();
  material.dispose();
});

test('connector-only progression remains strict outside an exact parent-anchored forest', () => {
  const regionBinding = binding('region-a');
  const { session, material } = themeSession(regionBinding, 'connector-only-rejection');
  for (const overlayPlan of [
    connectorOnlyParentAnchoredOverlay(regionBinding, { realizationMode: null }),
    connectorOnlyParentAnchoredOverlay(regionBinding, { corruptComponent: true }),
  ]) {
    assert.throws(
      () => assembleDungeonSupplement({
        overlayPlan,
        themeSession: session,
        structuralMode: 'complete',
      }),
      (error) => error?.code === 'INVALID_SUPPLEMENT_CONNECTOR_JUNCTION_PROGRESSION',
    );
  }
  material.dispose();
});

test('assembles V4 route junction, exact landings, source gate, and scoped shortcut records', () => {
  const regionBinding = binding('region-a');
  const { session, material } = themeSession(regionBinding, 'route-network');
  const overlayPlan = routeNetworkOverlay(regionBinding);
  const fragment = assembleDungeonSupplement({
    overlayPlan,
    themeSession: session,
    structuralMode: 'complete',
  });

  assert.equal(fragment.junctions.length, 1);
  assert.equal(fragment.junctions[0].junctionKind, 'through-t');
  assert.equal(fragment.junctions[0].countsAsMeaningfulStation, true);
  assert.deepEqual(fragment.junctions[0].decisionSocketIds, [
    'region-a__routeNetwork__junction__0:south',
  ]);
  assert.equal(fragment.landingClearances.length, 2);
  assert.deepEqual(fragment.landingClearances.map(({ socketId }) => socketId).sort(), [
    'parent-east-unused',
    'parent-west-unused',
  ]);
  const gate = fragment.doors.find(({ id }) => id === 'SupplementEncounterGate_0');
  assert.ok(gate);
  assert.equal(gate.gatePlacementSide, 'source');
  assert.equal(gate.sourceRoomId, 'region-a__routeNetwork__junction__0');
  assert.equal(gate.requiresEncounterId, 'junction-encounter');
  const shortcut = fragment.mechanisms.find(({ type }) => type === 'dungeonSupplementShortcut');
  assert.ok(shortcut);
  assert.equal(shortcut.stateId, 'route-network-shortcut-state-0');
  assert.equal(shortcut.shortcutStateId, 'route-network-shortcut-state-0');
  assert.deepEqual(shortcut.runtimeStateIds, ['route-network-shortcut-state-0']);
  assert.equal(shortcut.scopedAction, 'unlockShortcut');
  assert.equal(shortcut.shortcutAction, 'deploy-ladder');
  assert.equal(
    shortcut.targetConnectionId,
    'region-a__routeNetwork__operation__0:segment:reward',
  );
  assert.equal(shortcut.initialState, 'retracted');
  assert.equal(shortcut.activationSide, 'far');
  assert.deepEqual(shortcut.action, {
    type: 'activateDungeonSupplementShortcut',
    scope: 'connection',
    connectionId: 'region-a__routeNetwork__operation__0:segment:reward',
    stateId: 'route-network-shortcut-state-0',
  });
  const shortcutConnection = fragment.connectionPlans.find(
    ({ id }) => id === 'region-a__routeNetwork__operation__0:segment:reward',
  );
  assert.equal(shortcutConnection.shortcutMechanismId, shortcut.id);
  assert.equal(shortcutConnection.shortcutStateId, shortcut.shortcutStateId);
  assert.deepEqual(shortcutConnection.runtimeStateIds, shortcut.runtimeStateIds);
  assert.deepEqual(shortcutConnection.elevationModes, ['drop-ladder']);
  assert.equal(fragment.diagnostics.assembled.junctionCount, 1);
  assert.equal(fragment.diagnostics.assembled.landingClearanceCount, 2);
  fragment.dispose();
  material.dispose();
});

test('assembles a V4 parent-anchored forest with one retained exact parent attachment', () => {
  const regionBinding = binding('region-a');
  const { session, material } = themeSession(regionBinding, 'route-network-forest');
  const overlayPlan = routeNetworkOverlay(regionBinding);
  overlayPlan.profileRevision = 5;
  const operation = overlayPlan.operations[0];
  const retainedSegment = overlayPlan.segments[0];
  retainedSegment.bidirectional = true;
  overlayPlan.nodes = [overlayPlan.nodes[0]];
  overlayPlan.segments = [retainedSegment];
  operation.realizationMode = 'parent-anchored-forest';
  operation.localProgressionArcRealized = false;
  operation.endpointSocketIds = ['parent-west-unused'];
  operation.omittedEndpointSocketIds = ['parent-east-unused'];
  operation.nodeIds = [overlayPlan.nodes[0].id];
  operation.segmentIds = [retainedSegment.id];
  operation.parentAnchoredComponents = [{
    id: `${operation.id}:parent-anchored-component:0`,
    attachmentSocketIds: ['parent-west-unused'],
    attachmentSocketId: 'parent-west-unused',
    nodeIds: [...operation.nodeIds],
    segmentIds: [...operation.segmentIds],
    bidirectional: true,
  }];

  const fragment = assembleDungeonSupplement({
    overlayPlan,
    themeSession: session,
    structuralMode: 'complete',
  });
  const connection = fragment.connectionPlans.find(({ id }) => id === retainedSegment.id);
  assert.ok(connection);
  assert.equal(connection.routeNetworkRealizationMode, 'parent-anchored-forest');
  assert.equal(connection.routeNetworkLocalProgressionArcRealized, false);
  assert.deepEqual(connection.parentAnchoredDeclaredComponentIds, [
    operation.parentAnchoredComponents[0].id,
  ]);
  assert.deepEqual(connection.parentAnchoredDeclaredNodeIds, operation.nodeIds);
  assert.deepEqual(connection.parentAnchoredDeclaredSegmentIds, operation.segmentIds);
  assert.equal(
    connection.parentAnchoredComponentId,
    operation.parentAnchoredComponents[0].id,
  );
  assert.equal(connection.parentAnchoredAttachmentSocketId, 'parent-west-unused');
  assert.deepEqual(connection.parentAnchoredAttachmentSocketIds, ['parent-west-unused']);
  assert.deepEqual(fragment.landingClearances.map(({ socketId }) => socketId), [
    'parent-west-unused',
  ]);
  fragment.dispose();
  material.dispose();
});

test('authoritative V4 facade-only assembly fails closed on exact theme sessions and connector skins', () => {
  const regionBinding = binding('region-a');
  const overlayPlan = {
    ...routeNetworkOverlay(regionBinding),
    authoritativeManifestRealization: true,
  };

  assert.throws(
    () => assembleDungeonSupplement({
      overlayPlan,
      structuralMode: 'facadeOnly',
    }),
    (error) => error?.code === 'MISSING_PARENT_THEME_SESSION',
  );

  const material = new THREE.MeshStandardMaterial({ name: 'strict-facade-material' });
  const incompleteSession = createDungeonThemeSession({
    id: 'strict-facade-incomplete-session',
    themeBinding: regionBinding,
    resources: createDungeonThemeResourceLedger(),
    materialProviders: Object.fromEntries(MATERIAL_ROLES.map((role) => [role, material])),
    assetProviders: {
      cap: () => new THREE.Group(),
      lightFixture: () => new THREE.Group(),
    },
    connectorSkinProviders: {},
  });
  assert.throws(
    () => assembleDungeonSupplement({
      overlayPlan,
      structuralMode: 'facadeOnly',
      themeSession: incompleteSession,
    }),
    (error) => error?.code === 'MISSING_THEME_CAPABILITY'
      && /connector:serviceGallery/.test(error.message),
  );

  const mismatched = themeSession(binding('region-a', 'wrong-theme'), 'wrong-theme');
  assert.throws(
    () => assembleDungeonSupplement({
      overlayPlan,
      structuralMode: 'facadeOnly',
      themeSession: mismatched.session,
    }),
    (error) => error?.code === 'MISSING_PARENT_THEME_SESSION',
  );
  mismatched.material.dispose();
  material.dispose();
});

test('route-network assembly rejects ungranted parent sockets before creating resources', () => {
  const regionBinding = binding('region-a');
  const { session, material } = themeSession(regionBinding, 'route-network-invalid');
  assert.throws(
    () => assembleDungeonSupplement({
      overlayPlan: routeNetworkOverlay(regionBinding, { corruptSocket: true }),
      themeSession: session,
    }),
    (error) => error.code === 'INVALID_ROUTE_NETWORK_SOCKET_BINDING'
      && /ungranted parent socket/i.test(error.message),
  );
  material.dispose();
});

test('owner-aware presentation records realize once without delegated gameplay or transfer rendering', () => {
  const regionBinding = binding('region-a');
  const material = new THREE.MeshStandardMaterial({ name: 'presentation-test-material' });
  const calls = [];
  let propCalls = 0;
  let frameCalls = 0;
  const makeProvider = (role) => (specification) => {
    calls.push({ role, specification });
    const group = new THREE.Group();
    group.name = `presentation-${role}-${specification.sourceFeatureId}`;
    group.position.copy(specification.position);
    group.rotation.y = specification.rotationY;
    group.add(new THREE.Mesh(
      new THREE.BoxGeometry(
        specification.width,
        specification.height,
        specification.depth,
      ),
      material,
    ));
    return group;
  };
  const session = createDungeonThemeSession({
    id: 'presentation-session',
    themeBinding: regionBinding,
    resources: createDungeonThemeResourceLedger(),
    materialProviders: Object.fromEntries(MATERIAL_ROLES.map((role) => [role, material])),
    assetProviders: {
      gameplayCover: makeProvider('gameplayCover'),
      machineryLandmark: makeProvider('machineryLandmark'),
      storyMarking: makeProvider('storyMarking'),
      prop: () => {
        propCalls += 1;
        return new THREE.Group();
      },
      frame: () => {
        frameCalls += 1;
        return new THREE.Group();
      },
    },
  });
  const nodeId = 'presentation-node';
  const operationId = 'presentation-operation';
  const record = ({
    featureId,
    featureType,
    semanticRole,
    assetRole,
    position,
    width,
    height,
    depth,
    collisionRecordIds = [],
    optional = false,
    selected = !optional,
    realizationOwner = 'supplement-assembler',
    realizationKind = 'theme-object-root',
    ownerBindingId = null,
    runtimeActivation = realizationOwner === 'gameplay-runtime'
      ? 'dormant'
      : optional && !selected
        ? 'optional-not-selected'
        : 'not-applicable',
  }) => ({
    id: `${nodeId}:blueprint-feature:${featureId}:presentation`,
    schema: 'ruindivex-industrial-supplement-presentation-record/v1',
    nodeId,
    roomId: nodeId,
    operationId,
    blueprintId: 'presentation-test-blueprint',
    sourceFeatureId: featureId,
    sourceFeatureRuntimeId: `${nodeId}:blueprint-feature:${featureId}`,
    sourceFeatureType: featureType,
    semanticRole,
    themeRole: assetRole,
    presentationAssetRole: assetRole,
    presentationOwner: realizationOwner,
    realizationOwner,
    realizationKind,
    ownerBindingIds: ownerBindingId == null ? [] : [ownerBindingId],
    runtimeConsumerBindingIds: [],
    runtimeActivation,
    collisionRecordIds,
    presentationSurface: semanticRole === 'story-marking'
      ? 'floor-flush-decal'
      : 'authored-volume',
    transform: { position, rotationY: Math.PI * 0.5, scale: { x: 1, y: 1, z: 1 } },
    authoredFootprint: {
      widthMeters: width,
      heightMeters: height,
      depthMeters: depth,
    },
    required: !optional,
    optional,
    nonblocking: optional,
    selectedForRendering: selected,
    renderingRequired: selected,
    realizationRequired: true,
    renderedBySupplementAssembler:
      realizationOwner === 'supplement-assembler' && selected,
    storyPlacementLegal: optional ? true : undefined,
  });
  const presentationRecords = [
    record({
      featureId: 'cover',
      featureType: 'cover',
      semanticRole: 'gameplay-cover',
      assetRole: 'gameplayCover',
      position: { x: 30.8, y: 1.5, z: -2.8 },
      width: 2.8,
      height: 1.2,
      depth: 5.6,
      collisionRecordIds: ['cover-collision'],
    }),
    record({
      featureId: 'machine',
      featureType: 'machine',
      semanticRole: 'machinery-landmark',
      assetRole: 'machineryLandmark',
      position: { x: 25.2, y: 1.5, z: 2.8 },
      width: 5.6,
      height: 3.6,
      depth: 2.8,
      collisionRecordIds: ['machine-collision'],
    }),
    record({
      featureId: 'story',
      featureType: 'story',
      semanticRole: 'story-marking',
      assetRole: 'storyMarking',
      position: { x: 33.6, y: 1.5, z: 2.8 },
      width: 2.8,
      height: 0.035,
      depth: 2.8,
      optional: true,
      selected: true,
    }),
    record({
      featureId: 'control',
      featureType: 'control',
      semanticRole: 'gameplay-control',
      assetRole: null,
      position: { x: 28, y: 1.5, z: 0 },
      width: 2.8,
      height: 3.6,
      depth: 2.8,
      selected: false,
      realizationOwner: 'gameplay-runtime',
      realizationKind: 'gameplay-anchor',
      ownerBindingId: 'control-anchor',
    }),
    record({
      featureId: 'transfer',
      featureType: 'transfer',
      semanticRole: 'traversal-transfer',
      assetRole: null,
      position: { x: 28, y: 1.5, z: -5.6 },
      width: 2.8,
      height: 3.6,
      depth: 2.8,
      selected: false,
      realizationOwner: 'supplement-connector-assembler',
      realizationKind: 'physical-transfer',
      ownerBindingId: 'transfer-runtime',
    }),
    record({
      featureId: 'story-unselected',
      featureType: 'story',
      semanticRole: 'story-marking',
      assetRole: 'storyMarking',
      position: { x: 22.4, y: 1.5, z: 2.8 },
      width: 2.8,
      height: 0.035,
      depth: 2.8,
      optional: true,
      selected: false,
    }),
  ];
  const overlayPlan = {
    schema: 'ruindivex-dungeon-augmentation-overlay/v2',
    revision: 2,
    profileId: 'industrial-supplement-preview-v4',
    authoritativeManifestRealization: true,
    operations: [{
      id: operationId,
      type: 'optionalBranch',
      parentRegionId: 'region-a',
      themeBinding: regionBinding,
      nodeIds: [nodeId],
      segmentIds: [],
    }],
    nodes: [{
      id: nodeId,
      operationId,
      parentRegionId: 'region-a',
      kind: 'supplementRoom',
      grammarId: 'presentation-test-room',
      blueprintId: 'presentation-test-blueprint',
      authoritativeBlueprintRealization: true,
      themeBinding: regionBinding,
      placement: { center: { x: 28, y: 1.5, z: 0 }, rotationQuarterTurns: 0 },
      size: { x: 11.2, y: 5.6, z: 11.2 },
      sockets: [],
      anchors: [{ id: 'control-anchor', runtimeId: 'control-anchor' }],
      transfers: [{ id: 'transfer-runtime', runtimeId: 'transfer-runtime' }],
      features: presentationRecords.map((entry) => ({
        id: entry.sourceFeatureRuntimeId,
        runtimeId: entry.sourceFeatureRuntimeId,
        sourceFeatureRuntimeId: entry.sourceFeatureRuntimeId,
      })),
      collisionRecords: [
        { id: 'cover-collision' },
        { id: 'machine-collision' },
      ],
      presentationRecords,
    }],
    segments: [],
  };

  const fragment = assembleDungeonSupplement({
    overlayPlan,
    themeSession: session,
    structuralMode: 'facadeOnly',
  });
  const assemblerRecords = presentationRecords.filter(({ renderedBySupplementAssembler }) => (
    renderedBySupplementAssembler
  ));
  const requiredRecords = presentationRecords;
  assert.equal(calls.length, assemblerRecords.length);
  assert.equal(propCalls, 0, 'authored solids never use the generic cargo prop factory');
  assert.equal(fragment.presentationRealizations.length, requiredRecords.length);
  assert.equal(new Set(fragment.presentationRealizations.map(({ presentationRecordId }) => (
    presentationRecordId
  ))).size, requiredRecords.length);
  for (const { role, specification } of calls) {
    const source = presentationRecords.find(({ id }) => id === specification.id);
    assert.ok(source);
    assert.equal(role, source.presentationAssetRole);
    assert.equal(specification.presentationRecord.id, source.id);
    assert.equal(specification.width, source.authoredFootprint.widthMeters);
    assert.equal(specification.height, source.authoredFootprint.heightMeters);
    assert.equal(specification.depth, source.authoredFootprint.depthMeters);
    assert.equal(specification.rotationY, source.transform.rotationY);
    assert.ok(specification.position.isVector3);
    assert.ok(specification.facing.isVector3);
    const object = fragment.root.getObjectByName(
      `presentation-${role}-${source.sourceFeatureId}`,
    );
    assert.ok(object);
    assert.equal(object.parent, fragment.root, 'presentation root attaches once at world scope');
    const worldPosition = object.getWorldPosition(new THREE.Vector3());
    assert.deepEqual(worldPosition.toArray(), [
      source.transform.position.x,
      source.transform.position.y,
      source.transform.position.z,
    ]);
  }
  const delegated = fragment.presentationRealizations.filter(({ realizationOwner }) => (
    realizationOwner !== 'supplement-assembler'
  ));
  assert.deepEqual(delegated.map(({ realizationKind }) => realizationKind).sort(), [
    'gameplay-anchor',
    'physical-transfer',
  ]);
  assert.ok(delegated.every((entry) => (
    entry.rootObjectCount === 0
      && entry.rendererObjectId == null
      && entry.meshCount === 0
      && entry.drawCallCount === 0
  )));
  const unselectedStory = fragment.presentationRealizations.find(({ sourceFeatureId }) => (
    sourceFeatureId === 'story-unselected'
  ));
  assert.ok(unselectedStory);
  assert.equal(unselectedStory.realizationDisposition, 'optional-not-selected');
  assert.equal(unselectedStory.renderedBySupplementAssembler, false);
  assert.equal(unselectedStory.rootObjectCount, 0);
  assert.equal(unselectedStory.rendererObjectId, null);
  assert.equal(fragment.diagnostics.assembled.presentationRealizationCount, 6);
  fragment.dispose();

  const invalidStorySurface = structuredClone(overlayPlan);
  invalidStorySurface.nodes[0].presentationRecords.find(({ sourceFeatureId }) => (
    sourceFeatureId === 'story'
  )).presentationSurface = 'authored-volume';
  assert.throws(
    () => assembleDungeonSupplement({
      overlayPlan: invalidStorySurface,
      themeSession: session,
      structuralMode: 'facadeOnly',
    }),
    (error) => error.code === 'INVALID_STORY_PRESENTATION_SURFACE',
  );

  const thickFlushStory = structuredClone(overlayPlan);
  thickFlushStory.nodes[0].presentationRecords.find(({ sourceFeatureId }) => (
    sourceFeatureId === 'story'
  )).authoredFootprint.heightMeters = 0.5;
  assert.throws(
    () => assembleDungeonSupplement({
      overlayPlan: thickFlushStory,
      themeSession: session,
      structuralMode: 'facadeOnly',
    }),
    (error) => error.code === 'INVALID_STORY_PRESENTATION_SURFACE',
  );

  const wallMountedStory = structuredClone(overlayPlan);
  const wallMountedRecord = wallMountedStory.nodes[0].presentationRecords.find(({
    sourceFeatureId,
  }) => sourceFeatureId === 'story');
  wallMountedRecord.presentationSurface = 'wall-mounted-decal';
  wallMountedRecord.authoredFootprint.heightMeters = 1.2;
  wallMountedRecord.authoredFootprint.depthMeters = 0.035;
  const wallMountedFragment = assembleDungeonSupplement({
    overlayPlan: wallMountedStory,
    themeSession: session,
    structuralMode: 'facadeOnly',
  });
  assert.equal(
    wallMountedFragment.presentationRealizations.find(({ sourceFeatureId }) => (
      sourceFeatureId === 'story'
    ))?.renderedBySupplementAssembler,
    true,
  );
  wallMountedFragment.dispose();

  const internalFrameDrift = structuredClone(overlayPlan);
  internalFrameDrift.nodes[0].anchors.push({
    id: 'legacy-internal-doorway-frame',
    localAnchorId: 'legacy-internal-doorway-frame',
    kind: 'doorway-frame',
    assetRole: 'frame',
    position: { x: 28, y: 1.5, z: 5.6 },
  });
  assert.throws(
    () => assembleDungeonSupplement({
      overlayPlan: internalFrameDrift,
      themeSession: session,
      structuralMode: 'facadeOnly',
    }),
    (error) => error.code === 'V4_INTERNAL_DOORWAY_FRAME_PRESENTATION_FORBIDDEN',
  );
  assert.equal(frameCalls, 0, 'V4 internal sockets never invoke the legacy frame asset path');

  const missingOwnerBinding = structuredClone(overlayPlan);
  missingOwnerBinding.nodes[0].presentationRecords.find(({ sourceFeatureId }) => (
    sourceFeatureId === 'control'
  )).ownerBindingIds = ['missing-control-anchor'];
  assert.throws(
    () => assembleDungeonSupplement({
      overlayPlan: missingOwnerBinding,
      themeSession: session,
      structuralMode: 'facadeOnly',
    }),
    (error) => error.code === 'INVALID_PRESENTATION_OWNER_BINDING',
  );
  material.dispose();
});
