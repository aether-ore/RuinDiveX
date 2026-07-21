import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonRuntimeV2 } from '../../../src/dungeon-v2/DungeonRuntimeV2.js';
import { compileSemanticRoomPackPlacementV2 } from '../../../src/dungeon-v2/SemanticRoomPackPlanAdapterV2.js';
import { getSemanticRoomPackV1Descriptor } from '../../../src/dungeon-v2/SemanticRoomPackV1Catalog.js';

const WATER_STATES = ['FreightSumpFilled', 'StoredInReservoir', 'GantrySumpFilled'];
const FACTORY_STATES = ['south_entry', 'east_mid', 'north_high', 'west_top'];

function compilePlacement(roomId, placementId, { yawQuarterTurns = 0, y = 12 } = {}) {
  const descriptor = getSemanticRoomPackV1Descriptor(roomId);
  const entry = descriptor.sockets.find(({ id }) => id === 'entry_south');
  const forward = [
    { x: entry.forward[0], y: entry.forward[1], z: entry.forward[2] },
    { x: entry.forward[2], y: entry.forward[1], z: -entry.forward[0] },
    { x: -entry.forward[0], y: entry.forward[1], z: -entry.forward[2] },
    { x: -entry.forward[2], y: entry.forward[1], z: entry.forward[0] },
  ][yawQuarterTurns];
  return compileSemanticRoomPackPlacementV2(roomId, {
    placementId,
    entrySocketId: entry.id,
    targetPortal: {
      position: { x: 80, y, z: -40 },
      forward,
    },
    yawQuarterTurns,
  });
}

function liveNode(marker, { material = false } = {}) {
  const node = new THREE.Object3D();
  node.name = marker.sourceNodeName;
  node.position.set(marker.localPosition.x, marker.localPosition.y, marker.localPosition.z);
  node.userData = { ...marker.extras };
  if (material) node.material = { emissive: {}, emissiveIntensity: 0 };
  return node;
}

function dynamicBinding(placement) {
  const result = {
    mechanisms: new Map(),
    fluids: new Map(),
    hazards: new Map(),
    consoles: new Map(),
    stableSemanticIds: new Map(),
    loaderStableSemanticIds: new Map(),
  };
  for (const marker of placement.semanticMarkers) {
    const node = liveNode(marker, { material: marker.semantic === 'hazardSurface' });
    if (marker.semantic === 'fluidSurface') result.fluids.set(marker.sourceNodeName, node);
    if (marker.semantic === 'hazardSurface') result.hazards.set(marker.sourceNodeName, node);
    if (marker.sourceNodeName.startsWith('MECH_')) result.mechanisms.set(marker.sourceNodeName, node);
  }
  return result;
}

function baseResources(placement, binding) {
  return {
    mechanismObjects: new Map(),
    mechanismFixtures: new Map(),
    mechanismConsoles: new Map(),
    dynamicSurfaces: new Map(),
    dynamicSurfaceByController: new Map(),
    platformSurfaces: new Map(),
    surfaceObjects: new Map(),
    waterObjects: new Map(),
    hazardObjects: new Map(),
    crumbleOverlays: new Map(),
    semanticRoomPackDynamicBindingsByPlacementId: new Map([[placement.placementId, binding]]),
  };
}

function basePlan(placement, overrides = {}) {
  return {
    id: `runtime.${placement.placementId}`,
    semanticRoomPackPlacements: [placement],
    spatialCells: [],
    structuralBoundaries: [],
    walkableSurfaces: [{
      id: 'surface.runtime-floor',
      regionId: 'runtime-region',
      bounds: { min: { x: -2, y: -0.2, z: -2 }, max: { x: 2, y: 0, z: 2 } },
    }],
    safeAnchors: [],
    anchors: [],
    falls: [],
    actions: [],
    portals: [],
    traversalLinks: [],
    mechanisms: [],
    environmentStates: [],
    ...overrides,
  };
}

function baseFacade() {
  return {
    group: new THREE.Group(),
    encounters: [],
    rewards: [],
    objectives: [],
    doors: [],
    traps: [],
    structuralRegistry: {
      colliders: new Map(),
      getStructuralRaycastVisuals: () => [],
      getColliderById: () => null,
    },
  };
}

function mountRuntime(plan, resources, facade = baseFacade()) {
  const player = {
    root: new THREE.Object3D(),
    setEnvironmentalTraversalProfile() {},
  };
  const runtime = new DungeonRuntimeV2({ plan, facade, resources });
  runtime.mount({
    player,
    enemies: [],
    registerDynamicPlatformingSurface() {},
    unregisterDynamicPlatformingSurface() {},
  });
  return runtime;
}

function waterEnvironment(placement = null) {
  const authoredFreightSurfaceY = placement?.semanticMarkers
    ?.find(({ sourceNodeName }) => sourceNodeName === 'FLUID_FACTORY_WATER_LEVEL_FREIGHT')
    ?.worldPosition?.y ?? -4;
  const basins = [
    { id: 'basin.freight-sump', regionId: 'freight-sump', bounds: { min: { x: 0, y: authoredFreightSurfaceY - 6, z: 0 }, max: { x: 10, y: authoredFreightSurfaceY + 2, z: 10 } } },
    { id: 'basin.reservoir', regionId: 'reservoir', bounds: { min: { x: 20, y: -6, z: 0 }, max: { x: 30, y: 6, z: 10 } } },
    { id: 'basin.gantry-sump', regionId: 'gantry-sump', bounds: { min: { x: 40, y: -8, z: 0 }, max: { x: 50, y: 4, z: 10 } } },
  ];
  const levels = (filledId) => Object.fromEntries(basins.map(({ id }) => [id, id === filledId ? 6 : 0]));
  return {
    id: 'environment.water-unit',
    type: 'conserved-water-unit',
    variableId: 'water.unit.configuration',
    initialStateId: WATER_STATES[0],
    capacityUnits: 1,
    transferCommit: 'atomic-after-animation',
    transferSeconds: 2,
    basins,
    stableStates: WATER_STATES.map((id, index) => ({
      id,
      totalUnits: 1,
      basinLevels: levels(basins[index].id),
    })),
    movementProfile: {
      captureFloodedStateAtTakeoff: true,
      groundMovementMultiplier: 0.76,
      jumpHeight: 4.95,
      gravityScale: 0.28,
      mode: 'bottom-walking',
    },
  };
}

test('authored FLUID nodes interpolate conserved transfer levels and return to exact manifest Y on commit', () => {
  const placement = structuredClone(compilePlacement(
    'rdx_waterworks_freight_sump',
    'placement.runtime.waterworks',
    { y: 18 },
  ));
  placement.runtimePresentationBindings = {
    waterBasins: [{
      basinId: 'basin.freight-sump',
      sourceNodeName: 'FLUID_FACTORY_WATER_LEVEL_FREIGHT',
      presentationMode: 'authored-fluid-volume',
    }],
  };
  const binding = dynamicBinding(placement);
  const resources = baseResources(placement, binding);
  const environment = waterEnvironment(placement);
  for (const basin of environment.basins) {
    const object = new THREE.Object3D();
    object.userData = {};
    object.visible = true;
    resources.waterObjects.set(basin.id, object);
  }
  const states = WATER_STATES.map((id) => ({ id, stable: true }));
  const plan = basePlan(placement, {
    environmentStates: [environment],
    mechanisms: [{
      id: 'mechanism.water-router',
      type: 'water-router',
      initialStateId: WATER_STATES[0],
      states,
      transitions: WATER_STATES.map((toStateId) => ({ fromStateId: '*', toStateId })),
    }],
  });
  const fluidMarker = placement.semanticMarkers
    .find(({ sourceNodeName }) => sourceNodeName === 'FLUID_FACTORY_WATER_LEVEL_FREIGHT');
  const fluidNode = binding.fluids.get(fluidMarker.sourceNodeName);
  const runtime = mountRuntime(plan, resources);
  try {
    assert.equal(fluidNode.visible, true);
    assert.equal(fluidNode.position.y, fluidMarker.localPosition.y);
    assert.equal(fluidNode.userData.v2ManifestAbsoluteWorldY, fluidMarker.worldPosition.y);
    assert.equal(resources.waterObjects.get('basin.freight-sump').visible, false);
    assert.equal(resources.waterObjects.get('basin.reservoir').userData.v2SuppressedBySemanticRoomPack, undefined);
    assert.doesNotThrow(() => JSON.stringify(fluidNode.userData.v2SemanticPlanBinding));

    assert.equal(runtime.setWaterConfiguration('StoredInReservoir'), true);
    runtime.update(1);
    assert.equal(fluidNode.visible, true, 'the authored source surface remains visible while its water is animating away');
    assert.equal(fluidNode.position.y, fluidMarker.localPosition.y - 3, 'the authored surface descends with its conserved source volume');
    assert.equal(fluidNode.userData.v2WaterDisplayLevel, 3);
    assert.equal(fluidNode.userData.v2WaterDisplaySurfaceWorldY, fluidMarker.worldPosition.y - 3);
    assert.equal(fluidNode.userData.v2WaterVisualPhase, 'transfer');
    runtime.update(1);
    assert.equal(fluidNode.visible, false);

    assert.equal(runtime.setWaterConfiguration('GantrySumpFilled'), true);
    runtime.update(2);
    assert.equal(fluidNode.visible, false);
    assert.equal(runtime.setWaterConfiguration('FreightSumpFilled'), true);
    runtime.update(1);
    assert.equal(fluidNode.visible, true, 'the authored destination surface appears while water animates into it');
    assert.equal(fluidNode.position.y, fluidMarker.localPosition.y - 3, 'the authored surface rises with its conserved destination volume');
    runtime.update(1);
    assert.equal(fluidNode.visible, true);
    assert.equal(fluidNode.position.y, fluidMarker.localPosition.y, 'the committed authored surface returns to its exact manifest level');
    assert.equal(fluidNode.userData.v2WaterConfigurationId, 'FreightSumpFilled');
    assert.equal(resources.waterObjects.get('basin.freight-sump').visible, false);
    assert.equal(runtime.errors.some(({ code }) => code.includes('semantic-room-pack-water')), false);
  } finally {
    runtime.dispose();
  }
});

test('runtime never guesses authored water ownership from similar basin names', () => {
  const placement = compilePlacement(
    'rdx_waterworks_freight_sump',
    'placement.runtime.waterworks-no-explicit-binding',
    { y: 18 },
  );
  const binding = dynamicBinding(placement);
  const resources = baseResources(placement, binding);
  const environment = waterEnvironment();
  const genericFreightWater = new THREE.Object3D();
  genericFreightWater.visible = true;
  resources.waterObjects.set('basin.freight-sump', genericFreightWater);
  const plan = basePlan(placement, {
    environmentStates: [environment],
    mechanisms: [{
      id: 'mechanism.water-router',
      type: 'water-router',
      initialStateId: WATER_STATES[0],
      states: WATER_STATES.map((id) => ({ id, stable: true })),
      transitions: [],
    }],
  });

  const runtime = mountRuntime(plan, resources);
  try {
    assert.equal(genericFreightWater.visible, true);
    assert.ok(runtime.errors.some(({ code }) => (
      code === 'semantic-room-pack-water-presentation-binding-missing'
    )));
  } finally {
    runtime.dispose();
  }
});

function hazardPlan(roomId, profile) {
  const placement = compilePlacement(roomId, `placement.runtime.${profile}`, { y: 5 });
  const binding = dynamicBinding(placement);
  const resources = baseResources(placement, binding);
  const electrical = profile === 'electric_floor_cycle_v1';
  const environment = electrical
    ? {
        id: 'environment.undercroft-hazard',
        type: 'electric-floor-cycle-v1',
        phases: [
          { id: 'safe', durationSeconds: 1 },
          { id: 'charging', durationSeconds: 1 },
          { id: 'energized', durationSeconds: 1 },
        ],
        damagePerSecond: 9,
        surfaces: [],
      }
    : {
        id: 'environment.undercroft-hazard',
        type: 'magma-floor-v1',
        entryGraceSeconds: 0.5,
        damagePerSecond: 12,
        pulseSeconds: 0.25,
        surfaces: [],
      };
  return {
    placement,
    binding,
    resources,
    plan: basePlan(placement, { environmentStates: [environment] }),
  };
}

test('authored magma HAZARD node follows the global active phase without mesh-derived collision', () => {
  const fixture = hazardPlan('rdx_magma_foundry_undercroft', 'magma_floor_v1');
  const runtime = mountRuntime(fixture.plan, fixture.resources);
  try {
    runtime.update(0.1);
    const nodes = [...fixture.binding.hazards.values()];
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].userData.v2HazardPhase, 'active');
    assert.equal(nodes[0].userData.v2HazardActive, true);
    assert.equal(nodes[0].material.emissiveIntensity, 1.35);
    assert.equal(nodes[0].userData.v2CollisionDerivedFromMeshBounds, false);
    assert.equal(nodes[0].userData.v2CollisionAuthority, 'accepted-plan-semantic-room-pack-records');
  } finally {
    runtime.dispose();
  }
});

test('all authored electrical HAZARD panels follow safe, charging, and energized phases deterministically', () => {
  const fixture = hazardPlan('rdx_electric_transformer_undercroft', 'electric_floor_cycle_v1');
  const runtime = mountRuntime(fixture.plan, fixture.resources);
  try {
    const nodes = [...fixture.binding.hazards.values()];
    assert.ok(nodes.length > 1);
    runtime.update(0.5);
    assert.ok(nodes.every((node) => node.userData.v2HazardPhase === 'safe'
      && node.userData.v2HazardActive === false
      && node.material.emissiveIntensity === 0.22));
    runtime.update(1);
    assert.ok(nodes.every((node) => node.userData.v2HazardPhase === 'charging'
      && node.userData.v2HazardActive === false
      && node.material.emissiveIntensity === 0.72));
    runtime.update(1);
    assert.ok(nodes.every((node) => node.userData.v2HazardPhase === 'energized'
      && node.userData.v2HazardActive === true
      && node.material.emissiveIntensity === 1.35));
  } finally {
    runtime.dispose();
  }
});

function dynamicSurfaceFor(record) {
  const bounds = record.worldBounds ?? record.bounds ?? {
    min: {
      x: record.worldCenter.x - record.worldSize.x * 0.5,
      y: record.worldCenter.y - record.worldSize.y * 0.5,
      z: record.worldCenter.z - record.worldSize.z * 0.5,
    },
    max: {
      x: record.worldCenter.x + record.worldSize.x * 0.5,
      y: record.worldCenter.y + record.worldSize.y * 0.5,
      z: record.worldCenter.z + record.worldSize.z * 0.5,
    },
  };
  const center = new THREE.Vector3(
    (bounds.min.x + bounds.max.x) * 0.5,
    (bounds.min.y + bounds.max.y) * 0.5,
    (bounds.min.z + bounds.max.z) * 0.5,
  );
  const height = bounds.max.y - bounds.min.y;
  return {
    id: record.id,
    center,
    position: center,
    bounds: {
      min: { ...bounds.min },
      max: { ...bounds.max },
    },
    halfWidth: (bounds.max.x - bounds.min.x) * 0.5,
    halfDepth: (bounds.max.z - bounds.min.z) * 0.5,
    height,
    verticalHalfHeight: height * 0.5,
    baseY: bounds.min.y,
    topY: bounds.max.y,
    enabled: true,
    active: true,
  };
}

function factoryFixture(stateIds = FACTORY_STATES) {
  const placement = compilePlacement(
    'rdx_factory_corkscrew_exchange',
    'placement.runtime.factory',
    { yawQuarterTurns: 1, y: 22 },
  );
  const binding = dynamicBinding(placement);
  const resources = baseResources(placement, binding);
  for (const record of placement.walkableSurfaces.filter(({ sourceNodeName }) => (
    sourceNodeName === 'MECH_GEAR_PLATFORM' || sourceNodeName.startsWith('MECH_BRIDGE_')
  ))) {
    resources.dynamicSurfaces.set(record.id, dynamicSurfaceFor(record));
  }
  const gearMarker = placement.semanticMarkers
    .find(({ sourceNodeName }) => sourceNodeName === 'MECH_GEAR_PLATFORM');
  const gearSurface = dynamicSurfaceFor({
    id: 'surface.accepted-plan.corkscrew-gear',
    worldCenter: gearMarker.worldPosition,
    worldSize: { x: 4.4, y: 0.36, z: 4.4 },
  });
  resources.dynamicSurfaceByController.set('mechanism.corkscrew-gear', gearSurface);
  const genericGearVisual = new THREE.Object3D();
  genericGearVisual.userData = {};
  resources.mechanismObjects.set('mechanism.corkscrew-gear', genericGearVisual);
  const states = stateIds.map((id) => ({ id, stable: true }));
  const plan = basePlan(placement, {
    mechanisms: [{
      id: 'mechanism.corkscrew-gear',
      type: 'corkscrew-gear',
      initialStateId: stateIds[0],
      states,
      transitions: stateIds.map((toStateId) => ({ fromStateId: '*', toStateId })),
      automaticTravel: false,
    }],
  });
  return { placement, binding, resources, plan };
}

test('all four authored factory stops drive exact gear poses and one supported bridge without mesh AABB collision', () => {
  const fixture = factoryFixture();
  const runtime = mountRuntime(fixture.plan, fixture.resources);
  try {
    const mechanism = fixture.placement.mechanisms
      .find(({ localId }) => localId === 'corkscrew_exchange');
    const gearMarker = fixture.placement.semanticMarkers
      .find(({ sourceNodeName }) => sourceNodeName === 'MECH_GEAR_PLATFORM');
    const gearNode = fixture.binding.mechanisms.get('MECH_GEAR_PLATFORM');
    const gearSurface = fixture.resources.dynamicSurfaceByController
      .get('mechanism.corkscrew-gear');
    for (const stateId of FACTORY_STATES) {
      assert.equal(runtime.applyMechanismStableState('mechanism.corkscrew-gear', stateId), true);
      const state = mechanism.stableStates.find(({ localId }) => localId === stateId);
      const expectedLocalY = state.worldHeight - fixture.placement.placementTransform.translation.y;
      const expectedLocalYaw = THREE.MathUtils.degToRad(
        state.worldYawDegrees - fixture.placement.placementTransform.yawQuarterTurns * 90,
      );
      assert.ok(Math.abs(gearNode.position.y - expectedLocalY) < 1e-9);
      assert.ok(Math.abs(gearNode.rotation.y - expectedLocalYaw) < 1e-9);
      assert.equal(gearSurface.center.y, state.worldHeight);
      assert.equal(gearSurface.active, true);
      assert.equal(gearNode.userData.v2CollisionDerivedFromMeshBounds, false);
      assert.equal(gearNode.userData.v2SemanticSourceNodeName, gearMarker.sourceNodeName);
      assert.equal(fixture.resources.mechanismObjects.get('mechanism.corkscrew-gear').visible, false);

      const visibleBridgeNames = [...fixture.binding.mechanisms]
        .filter(([name, node]) => name.startsWith('MECH_BRIDGE_') && node.visible)
        .map(([name]) => name);
      const localDirection = state.localId.split('_')[0].toUpperCase();
      assert.deepEqual(visibleBridgeNames, [`MECH_BRIDGE_${localDirection}`]);
      for (const record of fixture.placement.walkableSurfaces
        .filter(({ sourceNodeName }) => sourceNodeName.startsWith('MECH_BRIDGE_'))) {
        const surface = fixture.resources.dynamicSurfaces.get(record.id);
        assert.equal(surface.active, record.sourceNodeName === visibleBridgeNames[0]);
      }
    }
    assert.equal(runtime.errors.some(({ code }) => code.includes('semantic-room-pack-mechanism')), false);
  } finally {
    runtime.dispose();
  }
});

test('three global corkscrew aliases cannot silently collapse the authored four-stop contract', () => {
  const fixture = factoryFixture(['LowLanding', 'BridgeAligned', 'HighLanding']);
  const runtime = mountRuntime(fixture.plan, fixture.resources);
  try {
    const mismatch = runtime.errors.find(({ code }) => (
      code === 'semantic-room-pack-mechanism-state-contract-mismatch'
    ));
    assert.ok(mismatch);
    assert.deepEqual(mismatch.requiredStateIds, FACTORY_STATES);
    assert.deepEqual(mismatch.actualStateIds, ['LowLanding', 'BridgeAligned', 'HighLanding']);
  } finally {
    runtime.dispose();
  }
});
