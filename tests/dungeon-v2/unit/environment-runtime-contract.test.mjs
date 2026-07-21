import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonRuntimeV2 } from '../../../src/dungeon-v2/DungeonRuntimeV2.js';

const STATE_IDS = ['FreightSumpFilled', 'StoredInReservoir', 'GantrySumpFilled'];

function waterRuntimeFixture() {
  const basins = [
    { id: 'basin.freight', regionId: 'freight', minX: 0, floorY: -10 },
    { id: 'basin.reservoir', regionId: 'reservoir', minX: 20, floorY: -4 },
    { id: 'basin.gantry', regionId: 'gantry', minX: 40, floorY: -8 },
  ].map((basin) => ({
    id: basin.id,
    regionId: basin.regionId,
    bounds: {
      min: { x: basin.minX, y: basin.floorY, z: 0 },
      max: { x: basin.minX + 10, y: basin.floorY + 12, z: 10 },
    },
    floorSurfaceId: `surface.${basin.regionId}`,
    walkableBottomY: basin.floorY + 0.35,
    playerRootTolerance: 0.5,
    capacityUnits: 1,
  }));
  const levels = (filledBasinId) => Object.fromEntries(basins.map(({ id }) => [id, id === filledBasinId ? 6 : 0]));
  const stableStates = [
    { id: STATE_IDS[0], totalUnits: 1, exactVolume: 600, basinLevels: levels(basins[0].id) },
    { id: STATE_IDS[1], totalUnits: 1, exactVolume: 600, basinLevels: levels(basins[1].id) },
    { id: STATE_IDS[2], totalUnits: 1, exactVolume: 600, basinLevels: levels(basins[2].id) },
  ];
  const walkableSurfaces = [
    ...basins.map((basin) => ({
      id: basin.floorSurfaceId,
      regionId: basin.regionId,
      bounds: {
        min: { ...basin.bounds.min },
        max: { x: basin.bounds.max.x, y: basin.walkableBottomY, z: basin.bounds.max.z },
      },
    })),
    {
      id: 'surface.router', regionId: 'reservoir',
      bounds: { min: { x: 18, y: 4, z: -5 }, max: { x: 22, y: 4.3, z: -1 } },
    },
  ];
  const plan = {
    id: 'unit-water-runtime',
    environmentStates: [{
      id: 'environment.water-unit',
      type: 'conserved-water-unit',
      variableId: 'waterConfiguration',
      initialStateId: STATE_IDS[0],
      capacityUnits: 1,
      conservedVolume: 1,
      transferCommit: 'atomic-after-animation',
      transferSeconds: 2,
      basins,
      stableStates,
      permanentDryControlAnchorIds: ['anchor.router'],
      movementProfile: {
        captureFloodedStateAtTakeoff: true,
        groundMovementMultiplier: 0.76,
        jumpHeight: 4.95,
        gravityScale: 0.28,
        mode: 'bottom-walking',
      },
    }],
    actions: [],
    anchors: [{ id: 'anchor.router', regionId: 'reservoir', surfaceId: 'surface.router', position: { x: 20, y: 4.3, z: -3 } }],
    safeAnchors: [],
    walkableSurfaces,
    falls: [],
    spatialCells: [],
    mechanisms: [{
      id: 'mechanism.water-router', type: 'water-router', initialStateId: STATE_IDS[0],
      states: stableStates.map(({ id }) => ({ id, stable: true })),
      transitions: STATE_IDS.map((id) => ({ fromStateId: '*', toStateId: id, automatic: true })),
    }],
  };
  const waterObjects = new Map(basins.map((basin) => {
    const object = new THREE.Object3D();
    const level = stableStates[0].basinLevels[basin.id];
    object.position.y = basin.bounds.min.y + level;
    object.visible = level > 0;
    return [basin.id, object];
  }));
  const resources = {
    mechanismObjects: new Map(),
    dynamicSurfaceByController: new Map(),
    platformSurfaces: new Map(),
    surfaceObjects: new Map(),
    dynamicSurfaces: new Map(),
    crumbleOverlays: new Map(),
    hazardObjects: new Map(),
    waterObjects,
  };
  const facade = {
    group: new THREE.Group(),
    encounters: [], rewards: [], objectives: [], doors: [], traps: [],
    structuralRegistry: { getStructuralRaycastVisuals: () => [] },
  };
  const player = {
    root: new THREE.Object3D(),
    setEnvironmentalTraversalProfile(profile) { this.lastTraversalProfile = profile; },
  };
  player.root.position.set(20, 4.3, -3);
  const game = {
    player,
    enemies: [],
    registerDynamicPlatformingSurface() {},
    unregisterDynamicPlatformingSurface() {},
  };
  const runtime = new DungeonRuntimeV2({ plan, facade, resources });
  runtime.mount(game);
  return { runtime, basins, stableStates, waterObjects, game };
}

function basinRoot(basin) {
  return new THREE.Vector3(
    (basin.bounds.min.x + basin.bounds.max.x) * 0.5,
    basin.walkableBottomY,
    (basin.bounds.min.z + basin.bounds.max.z) * 0.5,
  );
}

function assertFloodedExactly(runtime, basins, filledIndex) {
  basins.forEach((basin, index) => {
    assert.equal(runtime.isPositionFlooded(basinRoot(basin)), index === filledIndex,
      `${basin.id} flooded result must exactly match its committed level`);
  });
  assert.equal(runtime.isPositionFlooded(new THREE.Vector3(20, 4.3, -3)), false,
    'master router remains dry in every committed water configuration');
}

test('water runtime bottom-walks only on flooded basin floors and commits transfers atomically', () => {
  const { runtime, basins, waterObjects } = waterRuntimeFixture();
  try {
    assert.equal(runtime.getDiagnostics().waterConfigurationId, STATE_IDS[0]);
    assertFloodedExactly(runtime, basins, 0);
    const capturedAtTakeoff = runtime.captureTakeoffFloodedState(basinRoot(basins[0]));
    assert.equal(capturedAtTakeoff, true);
    assert.deepEqual(runtime.getTraversalProfile(basinRoot(basins[0]), { takeoffFlooded: capturedAtTakeoff }), {
      flooded: true,
      movementMultiplier: 0.76,
      jumpHeight: 4.95,
      gravityScale: 0.28,
      captureFloodedStateAtTakeoff: true,
      mode: 'bottom-walking',
    });

    assert.equal(runtime.setWaterConfiguration(STATE_IDS[1]), true);
    runtime.update(1);
    let diagnostics = runtime.getDiagnostics();
    assert.equal(diagnostics.waterConfigurationId, STATE_IDS[0], 'logical water state changes only after visual transfer completes');
    assert.equal(diagnostics.waterTransfer.phase, 'transferring');
    assert.ok(Math.abs(waterObjects.get(basins[0].id).position.y - (basins[0].bounds.min.y + 3)) < 0.0001);
    assert.ok(Math.abs(waterObjects.get(basins[1].id).position.y - (basins[1].bounds.min.y + 3)) < 0.0001);
    assertFloodedExactly(runtime, basins, 0);

    runtime.update(1);
    diagnostics = runtime.getDiagnostics();
    assert.equal(diagnostics.waterConfigurationId, STATE_IDS[1]);
    assert.equal(diagnostics.waterTransfer.phase, 'idle');
    assertFloodedExactly(runtime, basins, 1);
    assert.equal(runtime.getTraversalProfile(basinRoot(basins[0]), { takeoffFlooded: capturedAtTakeoff }).jumpHeight, 4.95,
      'flooded takeoff capture survives the atomic state change while airborne');

    for (const [stateId, filledIndex] of [[STATE_IDS[2], 2], [STATE_IDS[0], 0]]) {
      assert.equal(runtime.setWaterConfiguration(stateId), true);
      runtime.update(2);
      assert.equal(runtime.getDiagnostics().waterConfigurationId, stateId);
      assertFloodedExactly(runtime, basins, filledIndex);
    }
  } finally {
    runtime.dispose();
  }
});
