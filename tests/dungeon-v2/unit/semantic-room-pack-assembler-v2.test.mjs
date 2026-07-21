import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createTraversalLabPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { deepFreezePlan } from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';
import { compileSemanticRoomPackPlacementV2 } from '../../../src/dungeon-v2/SemanticRoomPackPlanAdapterV2.js';
import {
  SemanticRoomPackTemplateNotReadyErrorV1,
  createSemanticRoomPackPresentationRuntimeV1,
} from '../../../src/dungeon-v2/SemanticRoomPackPresentationV1.js';

const ROOM_ID = 'rdx_factory_corkscrew_exchange';
const DYNAMIC_SURFACE_ID = 'surface.lab-gear.corkscrew';

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
  scene.name = 'TEST_FACTORY_GLTF_SCENE';
  for (const record of json.nodes ?? []) {
    const object = record.mesh == null
      ? new THREE.Object3D()
      : new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.8, 0.8),
          new THREE.MeshStandardMaterial({ color: 0x8797a5 }),
        );
    object.name = record.name ?? '';
    object.userData = structuredClone(record.extras ?? {});
    if (record.translation) object.position.fromArray(record.translation);
    if (record.rotation) object.quaternion.fromArray(record.rotation);
    if (record.scale) object.scale.fromArray(record.scale);
    scene.add(object);
  }
  return scene;
}

async function createPresentationRuntime(roomId = ROOM_ID) {
  const glb = await readFile(new URL(
    `../../../assets/models/rooms/ruindivex-room-pack-v1/glb/${roomId}.glb`,
    import.meta.url,
  ));
  const scene = sceneFromGlbJson(parseGlbJson(glb));
  return createSemanticRoomPackPresentationRuntimeV1({
    runtimeModules: {
      three: THREE,
      GLTFLoader: class {},
      mergeGeometries,
      cloneObjectGraph: (root) => root.clone(true),
    },
    loader: { loadAsync: async () => ({ scene }) },
  });
}

function withSemanticFreightWater(plan) {
  const roomId = 'rdx_waterworks_freight_sump';
  const water = plan.environmentStates.find(({ type }) => type === 'conserved-water-unit');
  const basin = water.basins.find(({ id }) => id === 'basin.lab-water-freight');
  const initialLevel = water.stableStates
    .find(({ id }) => id === water.initialStateId).basinLevels[basin.id];
  const desiredSurface = {
    x: (basin.bounds.min.x + basin.bounds.max.x) * 0.5,
    y: basin.bounds.min.y + initialLevel,
    z: (basin.bounds.min.z + basin.bounds.max.z) * 0.5,
  };
  const initial = compileSemanticRoomPackPlacementV2(roomId, {
    placementId: 'placement.semantic-room-pack.test-waterworks',
    targetPortal: {
      position: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
      connectorType: 'pressure-door',
    },
  });
  const initialFluid = initial.semanticMarkers
    .find(({ sourceNodeName }) => sourceNodeName === 'FLUID_FACTORY_WATER_LEVEL_FREIGHT');
  const placement = compileSemanticRoomPackPlacementV2(roomId, {
    placementId: 'placement.semantic-room-pack.test-waterworks',
    targetPortal: {
      position: {
        x: desiredSurface.x - initialFluid.worldPosition.x,
        y: desiredSurface.y - initialFluid.worldPosition.y,
        z: desiredSurface.z - initialFluid.worldPosition.z,
      },
      forward: { x: 0, y: 0, z: 1 },
      connectorType: 'pressure-door',
    },
  });
  const focusedPlacement = deepFreezePlan({
    ...placement,
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
    socketBindings: placement.sockets.map((socket) => ({
      socketId: socket.id,
      sourceNodeName: socket.sourceNodeName,
      status: 'capped',
      portalId: null,
      capId: `${socket.worldId}:structural-cap`,
    })),
    boundPortalIds: [],
    runtimePresentationBindings: {
      waterBasins: [{
        basinId: basin.id,
        sourceNodeName: 'FLUID_FACTORY_WATER_LEVEL_FREIGHT',
        presentationMode: 'authored-fluid-volume',
      }],
    },
  });
  plan.semanticRoomPackPlacements = [focusedPlacement];
  return { plan, placement: focusedPlacement, basin };
}

function acceptedTraversalLab() {
  const validation = validateDungeonPlanV2(createTraversalLabPlanV2({
    seed: 'semantic-room-pack-assembler-v2',
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  return structuredClone(validation.plan);
}

function withSemanticDynamicSurface(plan) {
  const acceptedSurface = plan.walkableSurfaces.find(({ id }) => id === DYNAMIC_SURFACE_ID);
  assert.ok(acceptedSurface);
  const desiredCenter = {
    x: (acceptedSurface.bounds.min.x + acceptedSurface.bounds.max.x) * 0.5,
    y: (acceptedSurface.bounds.min.y + acceptedSurface.bounds.max.y) * 0.5,
    z: (acceptedSurface.bounds.min.z + acceptedSurface.bounds.max.z) * 0.5,
  };
  const initial = compileSemanticRoomPackPlacementV2(ROOM_ID, {
    placementId: 'placement.semantic-room-pack.test-factory',
    targetPortal: {
      position: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
      connectorType: 'bulkhead',
    },
  });
  const initialMoving = initial.transformedCollisionVolumes
    .find(({ sourceNodeName }) => sourceNodeName === 'MECH_BRIDGE_SOUTH');
  assert.ok(initialMoving);
  const placement = compileSemanticRoomPackPlacementV2(ROOM_ID, {
    placementId: 'placement.semantic-room-pack.test-factory',
    targetPortal: {
      position: {
        x: desiredCenter.x - initialMoving.worldCenter.x,
        y: desiredCenter.y - initialMoving.worldCenter.y,
        z: desiredCenter.z - initialMoving.worldCenter.z,
      },
      forward: { x: 0, y: 0, z: 1 },
      connectorType: 'bulkhead',
    },
  });
  const collider = placement.transformedCollisionVolumes
    .find(({ sourceNodeName }) => sourceNodeName === 'MECH_BRIDGE_SOUTH');
  const compiledSurface = placement.walkableSurfaces
    .find(({ sourceNodeName }) => sourceNodeName === collider.sourceNodeName);
  assert.ok(collider && compiledSurface);
  const semanticSurface = {
    ...compiledSurface,
    id: DYNAMIC_SURFACE_ID,
    colliderId: collider.id,
    sourceNodeName: collider.sourceNodeName,
  };
  const focusedPlacement = deepFreezePlan({
    ...placement,
    transformedCollisionVolumes: [collider],
    compiledPhysicalRecords: { colliders: [collider] },
    structuralBoundaries: [],
    walkableSurfaces: [semanticSurface],
    structuralFixtures: [],
    placedRecordIds: {
      structuralBoundaryIds: [],
      walkableSurfaceIds: [DYNAMIC_SURFACE_ID],
      structuralFixtureIds: [],
      colliderIds: [collider.id],
    },
    socketBindings: placement.sockets.map((socket) => ({
      socketId: socket.id,
      sourceNodeName: socket.sourceNodeName,
      status: 'capped',
      portalId: null,
      capId: `${socket.worldId}:structural-cap`,
    })),
    boundPortalIds: [],
  });
  plan.walkableSurfaces = plan.walkableSurfaces.map((surface) => (
    surface.id === DYNAMIC_SURFACE_ID
      ? {
          ...surface,
          colliderId: collider.id,
          colliderIds: [collider.id],
          colliderBounds: [structuredClone(surface.bounds)],
          sourceNodeName: collider.sourceNodeName,
          presentationOwnerId: focusedPlacement.id,
        }
      : surface
  ));
  plan.semanticRoomPackPlacements = [focusedPlacement];
  return { plan, placement: focusedPlacement, collider };
}

function withSemanticCylinderFixture(plan) {
  const placement = compileSemanticRoomPackPlacementV2(ROOM_ID, {
    placementId: 'placement.semantic-room-pack.test-cylinder',
    targetPortal: {
      position: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
      connectorType: 'bulkhead',
    },
  });
  const collider = placement.transformedCollisionVolumes
    .find(({ sourceNodeName }) => sourceNodeName === 'MECH_CONTROL_PEDESTAL');
  const compiledFixture = placement.structuralFixtures
    .find(({ sourceNodeName }) => sourceNodeName === collider?.sourceNodeName);
  assert.ok(collider && compiledFixture);
  assert.equal(collider.shape, 'cylinder');
  const bounds = {
    min: {
      x: collider.worldCenter.x - collider.worldRadius,
      y: collider.worldCenter.y - collider.worldHeight * 0.5,
      z: collider.worldCenter.z - collider.worldRadius,
    },
    max: {
      x: collider.worldCenter.x + collider.worldRadius,
      y: collider.worldCenter.y + collider.worldHeight * 0.5,
      z: collider.worldCenter.z + collider.worldRadius,
    },
  };
  const supportBoundary = plan.structuralBoundaries.find(({ side }) => side === 'floor')
    ?? plan.structuralBoundaries[0];
  const regionId = plan.regions[0].id;
  const cellId = plan.spatialCells[0].id;
  const acceptedFixture = {
    ...compiledFixture,
    regionId,
    cellId,
    bounds,
    type: 'semantic-room-pack-console',
    gameplayPurpose: 'authored cylindrical mechanism console collision regression',
    collision: 'blocking',
    accessibility: 'reachable',
    supportBoundaryIds: [supportBoundary.id],
    colliderIds: [collider.id],
    colliderBounds: [bounds],
    blocksAerialTraversal: true,
    visualId: `visual.${compiledFixture.id}`,
    visualIds: [`visual.${compiledFixture.id}`],
    presentationOwnerId: placement.id,
  };
  const focusedPlacement = deepFreezePlan({
    ...placement,
    transformedCollisionVolumes: [collider],
    compiledPhysicalRecords: { colliders: [collider] },
    structuralBoundaries: [],
    walkableSurfaces: [],
    structuralFixtures: [compiledFixture],
    placedRecordIds: {
      structuralBoundaryIds: [],
      walkableSurfaceIds: [],
      structuralFixtureIds: [compiledFixture.id],
      colliderIds: [collider.id],
    },
    socketBindings: placement.sockets.map((socket) => ({
      socketId: socket.id,
      sourceNodeName: socket.sourceNodeName,
      status: 'capped',
      portalId: null,
      capId: `${socket.worldId}:structural-cap`,
    })),
    boundPortalIds: [],
  });
  plan.structuralFixtures.push(acceptedFixture);
  plan.semanticRoomPackPlacements = [focusedPlacement];
  return { plan, placement: focusedPlacement, collider, fixture: acceptedFixture };
}

test('assembler fails closed when an accepted semantic placement has no cached GLB', () => {
  const fixture = withSemanticDynamicSurface(acceptedTraversalLab());
  assert.throws(
    () => assembleDungeonPlanV2(fixture.plan),
    (error) => error instanceof SemanticRoomPackTemplateNotReadyErrorV1
      && error.code === 'semantic-room-pack-template-not-ready',
  );
});

test('assembler uses the semantic dynamic node, keeps manifest collision, and disposes no cached geometry', async () => {
  const fixture = withSemanticDynamicSurface(acceptedTraversalLab());
  const runtime = await createPresentationRuntime();
  await runtime.preload(fixture.placement.presentationBinding);
  const facade = assembleDungeonPlanV2(fixture.plan, {
    semanticRoomPackPresentationRuntime: runtime,
  });
  try {
    assert.equal(facade.semanticRoomPackPresentationDiagnostics.accepted, true);
    assert.equal(facade.semanticRoomPackPresentationDiagnostics.placementCount, 1);
    assert.equal(
      facade.group.getObjectByName(`v2DynamicSurfaceRoot:${DYNAMIC_SURFACE_ID}`),
      undefined,
      'generic dynamic slab is suppressed',
    );
    const binding = facade.semanticRoomPackPhysicalNodeBindings.get(DYNAMIC_SURFACE_ID);
    assert.ok(binding);
    assert.equal(binding.semanticNode.name, 'MECH_BRIDGE_SOUTH');
    assert.equal(
      facade.environmentRuntime.resources.mechanismObjects.get('mechanism.lab-gear'),
      binding.visualNode,
      'runtime controller receives the authored moving node',
    );
    const collider = facade.structuralRegistry.getColliderById(fixture.collider.id);
    assert.ok(collider, 'manifest collider ID is retained in the runtime registry');
    assert.equal(collider.planId, DYNAMIC_SURFACE_ID);
    assert.ok(
      facade.semanticRoomPackDynamicBindingsByPlacementId
        .get(fixture.placement.id).mechanisms.has('MECH_BRIDGE_SOUTH'),
    );

    let geometryDisposals = 0;
    binding.visualNode.geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
    facade.dispose();
    assert.equal(geometryDisposals, 0, 'shared cached GLB geometry survives facade disposal');
  } finally {
    facade.dispose();
  }
});

test('assembler preserves an authored manifest cylinder as an exact runtime cylinder', async () => {
  const fixture = withSemanticCylinderFixture(acceptedTraversalLab());
  const runtime = await createPresentationRuntime();
  await runtime.preload(fixture.placement.presentationBinding);
  const facade = assembleDungeonPlanV2(fixture.plan, {
    semanticRoomPackPresentationRuntime: runtime,
  });
  try {
    const runtimeCollider = facade.structuralRegistry.getColliderById(fixture.collider.id);
    assert.ok(runtimeCollider);
    assert.equal(runtimeCollider.planId, fixture.fixture.id);
    assert.equal(runtimeCollider.shape, 'cylinder');
    assert.equal(runtimeCollider.collisionShape, 'cylinder');
    assert.equal(runtimeCollider.collisionRadius, fixture.collider.worldRadius);
    assert.equal(runtimeCollider.verticalHalfHeight, fixture.collider.worldHeight * 0.5);
    assert.equal(runtimeCollider.manifestCollisionShape, 'cylinder');
    assert.ok(facade.solidZones.includes(runtimeCollider));
    assert.ok(facade.aerialBoundaryZones.includes(runtimeCollider));
  } finally {
    facade.dispose();
  }
});

test('explicit basin binding replaces only the corresponding generic water volume', async () => {
  const fixture = withSemanticFreightWater(acceptedTraversalLab());
  const runtime = await createPresentationRuntime(fixture.placement.roomId);
  await runtime.preload(fixture.placement.presentationBinding);
  const facade = assembleDungeonPlanV2(fixture.plan, {
    semanticRoomPackPresentationRuntime: runtime,
  });
  try {
    const authored = facade.semanticRoomPackWaterBasinBindings.get(fixture.basin.id);
    assert.ok(authored);
    const runtimeObject = facade.environmentRuntime.resources.waterObjects.get(fixture.basin.id);
    assert.equal(runtimeObject.name, `v2AuthoredWaterSurface:${fixture.basin.id}`);
    assert.equal(runtimeObject.userData.v2SemanticRoomPackWater, true);
    assert.equal(runtimeObject.getObjectByName(authored.sourceNodeName), authored.node);
    assert.equal(
      facade.group.getObjectByName(`v2WaterVolume:${fixture.basin.id}`),
      undefined,
      'no generic blue volume is drawn over the authored Freight water',
    );
    assert.ok(
      facade.group.getObjectByName('v2WaterVolume:basin.lab-water-reservoir'),
      'unbound basins keep their generic full-volume presentation',
    );
    assert.equal(facade.semanticRoomPackPresentationDiagnostics.waterBasinPresentationCount, 1);
  } finally {
    facade.dispose();
  }
});
