import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  deepFreezePlan,
} from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';
import { stablePlanStringify } from '../../../src/dungeon-v2/DungeonPlanDiagnostics.js';
import {
  compileSemanticRoomPackPlacementV2,
} from '../../../src/dungeon-v2/SemanticRoomPackPlanAdapterV2.js';
import {
  SemanticRoomPackTemplateNotReadyErrorV1,
  createSemanticRoomPackPresentationRuntimeV1,
} from '../../../src/dungeon-v2/SemanticRoomPackPresentationV1.js';
import {
  SemanticRoomPackSceneIntegrationErrorV2,
  disposeSemanticRoomPackSceneIntegrationV2,
  prepareSemanticRoomPackSceneIntegrationV2,
  renderSemanticRoomPackSceneIntegrationV2,
} from '../../../src/dungeon-v2/SemanticRoomPackSceneIntegrationV2.js';

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

function sceneFromGlbJson(json) {
  const scene = new THREE.Group();
  scene.name = 'TEST_GLTF_SCENE';
  const material = new THREE.MeshStandardMaterial({ color: 0x8797a5 });
  for (const record of json.nodes ?? []) {
    const object = record.mesh == null
      ? new THREE.Object3D()
      : new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), material);
    object.name = record.name ?? '';
    object.userData = structuredClone(record.extras ?? {});
    if (record.translation) object.position.fromArray(record.translation);
    if (record.rotation) object.quaternion.fromArray(record.rotation);
    if (record.scale) object.scale.fromArray(record.scale);
    scene.add(object);
  }
  return scene;
}

class TestStructuralRegistry {
  constructor() {
    this.visuals = new Map();
    this.visualMetadata = new Map();
    this.byPlanId = new Map();
  }

  register(planId, { visual, role, regionId = null, visualId }) {
    if (this.visuals.has(visualId)) throw new Error(`duplicate visual ${visualId}`);
    const record = this.byPlanId.get(planId) ?? {
      planId,
      roles: [],
      visualIds: [],
      colliderIds: [],
    };
    record.visualIds.push(visualId);
    if (!record.roles.includes(role)) record.roles.push(role);
    this.byPlanId.set(planId, record);
    this.visuals.set(visualId, visual);
    this.visualMetadata.set(visualId, { planId, role, regionId });
    return record;
  }
}

async function acceptedWaterworksFixture() {
  const roomId = 'rdx_waterworks_freight_sump';
  const glb = await readFile(new URL(
    `../../../assets/models/rooms/ruindivex-room-pack-v1/glb/${roomId}.glb`,
    import.meta.url,
  ));
  const scene = sceneFromGlbJson(parseGlbJson(glb));
  const compiledPlacement = compileSemanticRoomPackPlacementV2(roomId, {
    placementId: 'semantic.waterworks.golden',
    targetPortal: {
      id: 'portal.factory-waterworks',
      position: { x: 36, y: 4, z: -52 },
      forward: { x: 0, y: 0, z: 1 },
      connectorType: 'pressure_door',
    },
  });
  const placement = deepFreezePlan({
    ...compiledPlacement,
    socketBindings: compiledPlacement.sockets.map((socket) => ({
      socketId: socket.id,
      sourceNodeName: socket.sourceNodeName,
      status: socket.id === compiledPlacement.entrySocketId ? 'bound' : 'capped',
      portalId: socket.id === compiledPlacement.entrySocketId ? 'portal.factory-waterworks' : null,
      capId: socket.id === compiledPlacement.entrySocketId ? null : `${socket.worldId}:structural-cap`,
    })),
    boundPortalIds: ['portal.factory-waterworks'],
    runtimePresentationBindings: {
      waterBasins: [{
        basinId: 'basin.freight-sump',
        sourceNodeName: 'FLUID_FACTORY_WATER_LEVEL_FREIGHT',
        presentationMode: 'authored-fluid-volume',
      }],
    },
  });
  const entrySocket = placement.sockets.find(({ id }) => id === placement.entrySocketId);
  const plan = deepFreezePlan({
    schemaVersion: 'test-semantic-room-scene-integration/1',
    semanticRoomPackPlacements: [placement],
    structuralBoundaries: placement.structuralBoundaries,
    walkableSurfaces: placement.walkableSurfaces,
    structuralFixtures: placement.structuralFixtures,
    portals: [{
      id: 'portal.factory-waterworks',
      from: {
        regionId: 'waterworks-entry',
        center: { ...entrySocket.worldPosition },
        elevation: entrySocket.worldPosition.y,
      },
      to: {
        regionId: 'factory-exit',
        center: { x: entrySocket.worldPosition.x, y: entrySocket.worldPosition.y, z: entrySocket.worldPosition.z + 8 },
        elevation: entrySocket.worldPosition.y,
      },
    }],
    environmentStates: [{
      id: 'environment.water-unit',
      type: 'conserved-water-unit',
      basins: [{ id: 'basin.freight-sump' }],
    }],
  });
  const runtime = createSemanticRoomPackPresentationRuntimeV1({
    runtimeModules: {
      three: THREE,
      GLTFLoader: class {},
      mergeGeometries,
      cloneObjectGraph: (root) => root.clone(true),
    },
    loader: { loadAsync: async () => ({ scene }) },
  });
  return { roomId, scene, placement, plan, runtime };
}

test('prepare/render maps every physical plan record to its exact authored semantic node', async () => {
  const fixture = await acceptedWaterworksFixture();
  await fixture.runtime.preload(fixture.placement.presentationBinding);
  const planBefore = stablePlanStringify(fixture.plan);
  const prepared = prepareSemanticRoomPackSceneIntegrationV2({
    plan: fixture.plan,
    presentationRuntime: fixture.runtime,
  });
  assert.equal(prepared.diagnostics.cachedAuthoredTemplatesReady, true);
  assert.deepEqual([...prepared.ownedBoundaryIds].sort(), [...fixture.placement.placedRecordIds.structuralBoundaryIds].sort());
  assert.deepEqual([...prepared.ownedSurfaceIds].sort(), [...fixture.placement.placedRecordIds.walkableSurfaceIds].sort());
  assert.deepEqual([...prepared.ownedFixtureIds].sort(), [...fixture.placement.placedRecordIds.structuralFixtureIds].sort());
  assert.deepEqual([...prepared.ownedPortalIds], ['portal.factory-waterworks']);
  assert.deepEqual([...prepared.ownedPortalEndpointKeys], ['portal.factory-waterworks:from']);
  assert.equal(prepared.waterBasinBindingDescriptors.get('basin.freight-sump').sourceNodeName,
    'FLUID_FACTORY_WATER_LEVEL_FREIGHT');

  const parent = new THREE.Group();
  const registry = new TestStructuralRegistry();
  const integration = renderSemanticRoomPackSceneIntegrationV2({
    prepared,
    parent,
    structuralRegistry: registry,
  });
  const expectedPhysicalCount = fixture.placement.structuralBoundaries.length
    + fixture.placement.walkableSurfaces.length
    + fixture.placement.structuralFixtures.length;
  assert.equal(integration.diagnostics.accepted, true);
  assert.equal(integration.diagnostics.mappedPhysicalRecordCount, expectedPhysicalCount);
  assert.equal(integration.physicalNodeBindings.size, expectedPhysicalCount);
  assert.equal(parent.children.length, 1);
  const group = parent.children[0];
  assert.equal(group.userData.v2SemanticRoomPackPresentation, true);
  assert.equal(group.userData.v2CollisionDerivedFromMeshBounds, false);
  assert.deepEqual(group.position.toArray(), Object.values(fixture.placement.placementTransform.translation));
  assert.deepEqual(group.scale.toArray(), [1, 1, 1]);

  for (const record of [
    ...fixture.placement.structuralBoundaries,
    ...fixture.placement.walkableSurfaces,
    ...fixture.placement.structuralFixtures,
  ]) {
    const binding = integration.physicalNodeBindings.get(record.id);
    assert.ok(binding, record.id);
    assert.equal(binding.sourceNodeName, record.sourceNodeName);
    assert.equal(binding.semanticNode.name, record.sourceNodeName);
    assert.equal(registry.byPlanId.get(record.id).visualIds.includes(binding.visualId), true);
  }
  for (const boundary of fixture.placement.structuralBoundaries) {
    const binding = integration.physicalNodeBindings.get(boundary.id);
    if (boundary.side === 'floor') {
      assert.notEqual(binding.visualNode.userData.v2CameraOcclusionPlanId, boundary.id);
      continue;
    }
    assert.equal(binding.visualNode.userData.cameraOcclusionSurface, true, boundary.id);
    assert.equal(binding.visualNode.userData.cameraOcclusionOwner, true, boundary.id);
    assert.equal(binding.visualNode.userData.v2CameraOcclusionClass, 'opaque-enclosure', boundary.id);
    assert.equal(binding.visualNode.userData.v2CameraOcclusionInstanceMode, 'per-object', boundary.id);
    assert.equal(binding.visualNode.userData.v2CameraOcclusionPlanId, boundary.id, boundary.id);
    assert.notEqual(binding.visualNode, group, `${boundary.id} hides one shell piece, never the whole room`);
  }
  const mergedMappings = [...integration.physicalNodeBindings.values()].filter(({ merged }) => merged);
  assert.ok(mergedMappings.length > 0, 'SUPPORT/RAIL physical records resolve through merged-source mappings');
  assert.equal(mergedMappings.every(({ visualNode, semanticNode }) => (
    visualNode.userData.sourceNodeNames.includes(semanticNode.name)
  )), true);

  const dynamic = integration.dynamicBindingsByPlacementId.get(fixture.placement.id);
  assert.ok(dynamic.fluids.has('FLUID_FACTORY_WATER_LEVEL_FREIGHT'));
  assert.ok(dynamic.consoles.has('CONSOLE_MASTER_ROUTING'));
  const fluidMarker = fixture.placement.semanticMarkers.find(({ semantic }) => semantic === 'fluidSurface');
  assert.equal(dynamic.stableSemanticIds.get(fluidMarker.id).node.name, fluidMarker.sourceNodeName);
  assert.equal(integration.waterBasinBindings.get('basin.freight-sump').node.name,
    'FLUID_FACTORY_WATER_LEVEL_FREIGHT');
  assert.equal(stablePlanStringify(fixture.plan), planBefore, 'scene integration never mutates accepted plan data');
});

test('dispose removes registered presentation and only disposes per-instance materials', async () => {
  const fixture = await acceptedWaterworksFixture();
  await fixture.runtime.preload(fixture.placement.presentationBinding);
  const parent = new THREE.Group();
  const registry = new TestStructuralRegistry();
  const prepared = prepareSemanticRoomPackSceneIntegrationV2({ plan: fixture.plan, presentationRuntime: fixture.runtime });
  const integration = renderSemanticRoomPackSceneIntegrationV2({ prepared, parent, structuralRegistry: registry });
  const group = integration.groups[0];
  const materials = new Set();
  const geometries = new Set();
  group.traverse((object) => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) materials.add(material);
  });
  let materialDisposals = 0;
  let geometryDisposals = 0;
  materials.forEach((material) => material.addEventListener('dispose', () => { materialDisposals += 1; }));
  geometries.forEach((geometry) => geometry.addEventListener('dispose', () => { geometryDisposals += 1; }));

  disposeSemanticRoomPackSceneIntegrationV2(integration);
  disposeSemanticRoomPackSceneIntegrationV2(integration);
  assert.equal(parent.children.length, 0);
  assert.equal(registry.visuals.size, 0);
  assert.equal(registry.byPlanId.size, 0);
  assert.equal(materialDisposals, materials.size);
  assert.equal(geometryDisposals, 0, 'cached/shared authored geometry is never disposed by an instance');
});

test('prepare fails closed when the authored template was not preloaded', async () => {
  const fixture = await acceptedWaterworksFixture();
  assert.throws(
    () => prepareSemanticRoomPackSceneIntegrationV2({ plan: fixture.plan, presentationRuntime: fixture.runtime }),
    (error) => error instanceof SemanticRoomPackTemplateNotReadyErrorV1
      && error.code === 'semantic-room-pack-template-not-ready',
  );
});

test('missing accepted IDs and missing live semantic nodes cannot partially attach presentation', async () => {
  const fixture = await acceptedWaterworksFixture();
  await fixture.runtime.preload(fixture.placement.presentationBinding);
  const missingBoundaryPlan = {
    ...fixture.plan,
    structuralBoundaries: fixture.plan.structuralBoundaries.slice(1),
  };
  assert.throws(
    () => prepareSemanticRoomPackSceneIntegrationV2({
      plan: missingBoundaryPlan,
      presentationRuntime: fixture.runtime,
    }),
    (error) => error instanceof SemanticRoomPackSceneIntegrationErrorV2
      && error.code === 'semantic-room-pack-owned-plan-id-missing',
  );

  const prepared = prepareSemanticRoomPackSceneIntegrationV2({ plan: fixture.plan, presentationRuntime: fixture.runtime });
  const template = fixture.runtime.getTemplateSync(fixture.placement.presentationBinding);
  const removed = template.templateRoot.getObjectByName('WALK_SUMP_BOTTOM');
  removed.removeFromParent();
  const parent = new THREE.Group();
  const registry = new TestStructuralRegistry();
  assert.throws(
    () => renderSemanticRoomPackSceneIntegrationV2({ prepared, parent, structuralRegistry: registry }),
    (error) => error instanceof SemanticRoomPackSceneIntegrationErrorV2
      && error.code === 'semantic-room-pack-source-node-missing',
  );
  assert.equal(parent.children.length, 0, 'failed render rolls back already attached authored groups');
  assert.equal(registry.visuals.size, 0, 'failed render rolls back structural registrations');
});

test('water presentation metadata fails closed on missing FLUID sources and duplicate global basin ownership', async () => {
  const fixture = await acceptedWaterworksFixture();
  await fixture.runtime.preload(fixture.placement.presentationBinding);
  const missingFluidPlacement = deepFreezePlan({
    ...fixture.placement,
    runtimePresentationBindings: {
      waterBasins: [{
        basinId: 'basin.freight-sump',
        sourceNodeName: 'CONSOLE_MASTER_ROUTING',
        presentationMode: 'authored-fluid-volume',
      }],
    },
  });
  assert.throws(
    () => prepareSemanticRoomPackSceneIntegrationV2({
      plan: { ...fixture.plan, semanticRoomPackPlacements: [missingFluidPlacement] },
      presentationRuntime: fixture.runtime,
    }),
    (error) => error instanceof SemanticRoomPackSceneIntegrationErrorV2
      && error.code === 'semantic-room-pack-fluid-source-missing',
  );

  const duplicatePlacementId = 'semantic.waterworks.duplicate';
  const duplicatePlacement = deepFreezePlan({
    ...fixture.placement,
    id: duplicatePlacementId,
    placementId: duplicatePlacementId,
    presentationBinding: {
      ...fixture.placement.presentationBinding,
      placementId: duplicatePlacementId,
    },
    transformedCollisionVolumes: [],
    compiledPhysicalRecords: { colliders: [] },
    structuralBoundaries: [],
    walkableSurfaces: [],
    structuralFixtures: [],
    placedRecordIds: {
      structuralBoundaryIds: [],
      walkableSurfaceIds: [],
      structuralFixtureIds: [],
      colliderIds: [],
    },
    socketBindings: fixture.placement.sockets.map((socket) => ({
      socketId: socket.id,
      sourceNodeName: socket.sourceNodeName,
      status: 'capped',
      portalId: null,
      capId: `${duplicatePlacementId}:${socket.id}:structural-cap`,
    })),
    boundPortalIds: [],
  });
  assert.throws(
    () => prepareSemanticRoomPackSceneIntegrationV2({
      plan: {
        ...fixture.plan,
        semanticRoomPackPlacements: [fixture.placement, duplicatePlacement],
      },
      presentationRuntime: fixture.runtime,
    }),
    (error) => error instanceof SemanticRoomPackSceneIntegrationErrorV2
      && error.code === 'semantic-room-pack-global-water-basin-owned-twice',
  );
});
