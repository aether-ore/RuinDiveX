import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clonePlanData,
  isSerializablePlanValue,
} from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';
import { stablePlanStringify } from '../../../src/dungeon-v2/DungeonPlanDiagnostics.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { compileSemanticRoomPackPlacementV2 } from '../../../src/dungeon-v2/SemanticRoomPackPlanAdapterV2.js';
import {
  SemanticRoomPackStateBridgeErrorV2,
  reconcileSemanticRoomPackStateBridgeV2,
  validateSemanticRoomPackStateBridgeV2,
} from '../../../src/dungeon-v2/SemanticRoomPackStateBridgeV2.js';

const FACTORY_ROOM_ID = 'rdx_factory_corkscrew_exchange';
const WATER_ROOM_ID = 'rdx_waterworks_freight_sump';
const UNDERCROFT_ROOM_IDS = {
  magma: 'rdx_magma_foundry_undercroft',
  electrical: 'rdx_electric_transformer_undercroft',
};

function compilePlacement(roomId, placementId, x) {
  return compileSemanticRoomPackPlacementV2(roomId, {
    placementId,
    entrySocketId: 'entry_south',
    targetPortal: {
      id: `portal.${placementId}`,
      position: { x, y: 0, z: 100 },
      forward: { x: 0, y: 0, z: 1 },
    },
    yawQuarterTurns: 0,
  });
}

function marker(placement, sourceNodeName) {
  const result = placement.semanticMarkers.find((entry) => entry.sourceNodeName === sourceNodeName);
  assert.ok(result, `${placement.roomId} must expose ${sourceNodeName}`);
  return result;
}

function surface(id, regionId, bounds, extras = {}) {
  return {
    id,
    regionId,
    cellId: `cell.${regionId}.main`,
    bounds,
    purpose: `focused state bridge fixture ${id}`,
    supportBoundaryIds: [],
    collision: 'static',
    hazardTag: null,
    ...extras,
  };
}

function thinSurfaceAt(id, regionId, position, half = 1.5, extras = {}) {
  return surface(id, regionId, {
    min: { x: position.x - half, y: position.y - 0.2, z: position.z - half },
    max: { x: position.x + half, y: position.y, z: position.z + half },
  }, extras);
}

function basinFixture({ stateId, levelKey, basinId, regionId, levelY, bottomY, centerX, volume = 100 }) {
  const depth = levelY - bottomY;
  const width = Math.sqrt(volume / depth);
  const bounds = {
    min: { x: centerX - width / 2, y: bottomY, z: 92 - width / 2 },
    max: { x: centerX + width / 2, y: levelY + 1, z: 92 + width / 2 },
  };
  const floorSurfaceId = `surface.bridge.water.${stateId}`;
  return {
    binding: { stateId, levelKey, basinId, regionId, bounds, floorSurfaceId },
    floor: surface(floorSurfaceId, regionId, {
      min: { x: bounds.min.x, y: bottomY - 0.2, z: bounds.min.z },
      max: { x: bounds.max.x, y: bottomY, z: bounds.max.z },
    }),
  };
}

function makeFixture(undercroftType) {
  const plan = clonePlanData(createGoldenDungeonPlanV2({
    seed: `semantic-state-bridge-${undercroftType}`,
    undercroftType,
    deferSemanticRoomPackIntegration: true,
  }));
  const factoryBase = compilePlacement(FACTORY_ROOM_ID, 'placement.bridge.factory', 180);
  const waterBase = compilePlacement(WATER_ROOM_ID, 'placement.bridge.water', 260);
  const undercroftBase = compilePlacement(
    UNDERCROFT_ROOM_IDS[undercroftType],
    'placement.bridge.undercroft',
    340,
  );

  const gearPlatform = marker(factoryBase, 'MECH_GEAR_PLATFORM');
  const gearConsole = marker(factoryBase, 'ANCHOR_MECHANISM_CONSOLE');
  const dynamicSurface = thinSurfaceAt(
    'surface.bridge.factory.gear-platform',
    'corkscrew',
    {
      ...gearPlatform.worldPosition,
      y: factoryBase.mechanisms[0].stableStates[0].worldHeight,
    },
    2.2,
    {
      collision: 'dynamic',
      mechanismId: 'mechanism.corkscrew-gear',
      sourceNodeName: 'MECH_GEAR_PLATFORM',
      semanticRoomPackPlacementId: factoryBase.placementId,
    },
  );
  const gearControl = thinSurfaceAt(
    'surface.bridge.factory.control',
    'corkscrew',
    gearConsole.worldPosition,
    1.2,
  );

  const waterContract = waterBase.environmentContracts.find(({ kind }) => kind === 'conserved-fluid-network');
  const levelByState = Object.fromEntries(waterContract.stableStates.map(({ id, levels }) => [id, levels]));
  const freight = basinFixture({
    stateId: 'FreightSumpFilled',
    levelKey: 'freightLevelWorldY',
    basinId: 'basin.freight-sump.authored',
    regionId: 'freight-sump',
    levelY: levelByState.FreightSumpFilled.freightLevelWorldY,
    bottomY: waterContract.basinBottomWorldY,
    centerX: 252,
  });
  const reservoir = basinFixture({
    stateId: 'StoredInReservoir',
    levelKey: 'storedLevelWorldY',
    basinId: 'basin.reservoir.authored',
    regionId: 'reservoir',
    levelY: levelByState.StoredInReservoir.storedLevelWorldY,
    bottomY: levelByState.StoredInReservoir.storedLevelWorldY - 2.5,
    centerX: 260,
  });
  const gantry = basinFixture({
    stateId: 'GantrySumpFilled',
    levelKey: 'gantryLevelWorldY',
    basinId: 'basin.gantry-sump.authored',
    regionId: 'gantry-sump',
    levelY: levelByState.GantrySumpFilled.gantryLevelWorldY,
    bottomY: levelByState.GantrySumpFilled.gantryLevelWorldY - 2,
    centerX: 268,
  });
  const waterConsole = marker(waterBase, 'ANCHOR_MASTER_CONSOLE');
  const flooded = marker(waterBase, 'ANCHOR_REWARD_SUBMERGED');
  const drained = marker(waterBase, 'ANCHOR_REWARD_DRAINED');
  const waterControlSurface = thinSurfaceAt('surface.bridge.water.control', 'freight-sump', waterConsole.worldPosition, 1);
  const floodedSurface = thinSurfaceAt('surface.bridge.water.flooded-discovery', 'freight-sump', flooded.worldPosition, 1.5);
  const drainedSurface = thinSurfaceAt('surface.bridge.water.drained-discovery', 'freight-sump', drained.worldPosition, 1.5);

  const hazardMarker = undercroftBase.semanticMarkers.find(({ semantic }) => semantic === 'hazardSurface');
  const rewardMarker = undercroftBase.semanticMarkers.find(({ semantic }) => semantic === 'rewardAnchor');
  assert.ok(hazardMarker && rewardMarker);
  const hazardSurface = thinSurfaceAt(
    `surface.bridge.${undercroftType}.hazard`,
    'hazard-core',
    hazardMarker.worldPosition,
    5,
    { semanticRoomPackPlacementId: undercroftBase.placementId },
  );
  const hazardRewardSurface = thinSurfaceAt(
    `surface.bridge.${undercroftType}.reward`,
    'hazard-core',
    rewardMarker.worldPosition,
    1.5,
  );

  plan.walkableSurfaces.push(
    dynamicSurface,
    gearControl,
    freight.floor,
    reservoir.floor,
    gantry.floor,
    waterControlSurface,
    floodedSurface,
    drainedSurface,
    hazardSurface,
    hazardRewardSurface,
  );
  plan.semanticRoomPackPlacements = [
    {
      ...clonePlanData(factoryBase),
      goldenRegionId: 'corkscrew',
      runtimeContractBindings: {
        corkscrew: {
          dynamicSurfaceId: dynamicSurface.id,
          controlSurfaceId: gearControl.id,
        },
      },
    },
    {
      ...clonePlanData(waterBase),
      goldenRegionId: 'freight-sump',
      runtimeContractBindings: {
        water: {
          controlSurfaceId: waterControlSurface.id,
          basins: [freight.binding, reservoir.binding, gantry.binding],
          discoverySurfaceIds: {
            submerged_salvage_cache: floodedSurface.id,
            drained_tunnel_cache: drainedSurface.id,
          },
        },
      },
    },
    {
      ...clonePlanData(undercroftBase),
      goldenRegionId: 'hazard-core',
      runtimeContractBindings: {
        hazard: {
          surfaceIds: [hazardSurface.id],
          rewardSurfaceId: hazardRewardSurface.id,
        },
      },
    },
  ];
  return { plan, factoryBase, waterBase, undercroftBase };
}

for (const undercroftType of ['magma', 'electrical']) {
  test(`state bridge reconciles exact pack-owned Factory, Waterworks, and ${undercroftType} contracts`, () => {
    const fixture = makeFixture(undercroftType);
    const preflight = validateSemanticRoomPackStateBridgeV2(fixture.plan);
    assert.equal(preflight.accepted, true, JSON.stringify(preflight.errors, null, 2));
    const returned = reconcileSemanticRoomPackStateBridgeV2(fixture.plan);
    assert.equal(returned, fixture.plan);
    assert.equal(fixture.plan.semanticRoomPackStateBridge.fullyReconciled, true);
    assert.equal(isSerializablePlanValue(fixture.plan), true);

    const mechanism = fixture.plan.mechanisms.find(({ id }) => id === 'mechanism.corkscrew-gear');
    assert.deepEqual(mechanism.states.map(({ id }) => id), [
      'south_entry', 'east_mid', 'north_high', 'west_top',
    ]);
    assert.deepEqual(
      mechanism.states.map(({ elevation, yawDegrees }) => ({ elevation, yawDegrees })),
      fixture.factoryBase.mechanisms[0].stableStates.map(({ worldHeight: elevation, worldYawDegrees: yawDegrees }) => ({ elevation, yawDegrees })),
    );
    assert.equal(mechanism.transitions.length, 4);
    assert.equal(mechanism.runtimeProfile.sourceNodeName, 'MECH_GEAR_PLATFORM');
    assert.deepEqual(mechanism.legacyStateAliases, {
      LowLanding: 'south_entry', BridgeAligned: 'east_mid', HighLanding: 'west_top',
    });
    const gearActions = fixture.plan.actions.filter(({ controllerId }) => controllerId === mechanism.id);
    assert.deepEqual(gearActions.map(({ effects }) => effects[0].stateId).sort(), [
      'east_mid', 'north_high', 'south_entry', 'west_top',
    ]);
    assert.equal(
      fixture.plan.portals.find(({ id }) => id === 'portal.corkscrew-hazard-intake').conditions[0].value,
      'south_entry',
    );

    const water = fixture.plan.environmentStates.find(({ id }) => id === 'environment.water-unit');
    assert.equal(fixture.plan.environmentStates.filter(({ type }) => type === 'conserved-water-unit').length, 1);
    assert.equal(water.basins.length, 3);
    assert.deepEqual(water.stableStates.map(({ id }) => id), [
      'FreightSumpFilled', 'StoredInReservoir', 'GantrySumpFilled',
    ]);
    assert.ok(water.stableStates.every(({ exactVolume }) => Math.abs(exactVolume - 100) < 0.001));
    assert.deepEqual(water.movementProfile, {
      captureFloodedStateAtTakeoff: true,
      groundMovementMultiplier: 0.76,
      jumpHeight: 4.95,
      gravityScale: 0.28,
      mode: 'bottom-walking',
    });
    const authoredWaterPlacement = fixture.plan.semanticRoomPackPlacements
      .find(({ roomId }) => roomId === WATER_ROOM_ID);
    assert.deepEqual(authoredWaterPlacement.runtimePresentationBindings.waterBasins, [{
      basinId: 'basin.freight-sump.authored',
      sourceNodeName: 'FLUID_FACTORY_WATER_LEVEL_FREIGHT',
      presentationMode: 'authored-fluid-volume',
      stateId: 'FreightSumpFilled',
      absoluteWorldY: fixture.waterBase.environmentContracts[0].stableStates[0].levels.freightLevelWorldY,
    }]);
    for (const [anchorId, sourceNodeName] of [
      ['anchor.discovery.flooded', 'ANCHOR_REWARD_SUBMERGED'],
      ['anchor.discovery.drained', 'ANCHOR_REWARD_DRAINED'],
    ]) {
      const anchor = fixture.plan.anchors.find(({ id }) => id === anchorId);
      assert.deepEqual(anchor.position, marker(fixture.waterBase, sourceNodeName).worldPosition);
    }

    const hazard = fixture.plan.environmentStates.find(({ id }) => id === 'environment.undercroft-hazard');
    const contract = fixture.undercroftBase.environmentContracts[0];
    assert.equal(hazard.sourceEnvironmentContractId, contract.id);
    assert.equal(hazard.damagePerSecond, contract.parameters.damagePerSecond);
    if (undercroftType === 'magma') {
      assert.equal(hazard.type, 'magma-floor-v1');
      assert.equal(hazard.pulseSeconds, 0.25);
      assert.equal(hazard.entryGraceSeconds, 0.5);
    } else {
      assert.equal(hazard.type, 'electric-floor-cycle-v1');
      assert.equal(hazard.phaseCycleSeconds, 3.5);
      assert.deepEqual(hazard.phases.map(({ durationSeconds }) => durationSeconds), [1.25, 0.75, 1.5]);
    }
    const hazardSurface = fixture.plan.walkableSurfaces.find(({ id }) => id === hazard.surfaces[0].surfaceId);
    assert.equal(hazardSurface.hazardTag, hazard.hazardTag);
    const undercroftAnchor = fixture.plan.anchors.find(({ id }) => id === 'anchor.cache.undercroft');
    assert.deepEqual(
      undercroftAnchor.position,
      fixture.undercroftBase.semanticMarkers.find(({ semantic }) => semantic === 'rewardAnchor').worldPosition,
    );
  });
}

test('state bridge fails closed with deterministic diagnostics when integration omits plan-owned dynamic geometry', () => {
  const first = makeFixture('magma');
  const second = makeFixture('magma');
  delete first.plan.semanticRoomPackPlacements[0].runtimeContractBindings.corkscrew.dynamicSurfaceId;
  delete second.plan.semanticRoomPackPlacements[0].runtimeContractBindings.corkscrew.dynamicSurfaceId;
  const before = stablePlanStringify(first.plan);
  const a = validateSemanticRoomPackStateBridgeV2(first.plan);
  const b = validateSemanticRoomPackStateBridgeV2(second.plan);
  assert.equal(a.accepted, false);
  assert.equal(a.diagnosticHash, b.diagnosticHash);
  assert.ok(a.errors.some(({ code }) => code === 'semantic-room-pack-state-surface-binding-missing'));
  assert.equal(stablePlanStringify(first.plan), before, 'dry-run validation must be atomic');
  assert.throws(
    () => reconcileSemanticRoomPackStateBridgeV2(first.plan),
    (error) => error instanceof SemanticRoomPackStateBridgeErrorV2
      && error.result.diagnosticHash === a.diagnosticHash,
  );
  assert.equal(stablePlanStringify(first.plan), before, 'failed reconciliation must not partially mutate the plan');
});

test('state bridge rejects authored basin geometry that changes the conserved water volume', () => {
  const { plan } = makeFixture('electrical');
  const waterPlacement = plan.semanticRoomPackPlacements.find(({ roomId }) => roomId === WATER_ROOM_ID);
  waterPlacement.runtimeContractBindings.water.basins[1].bounds.max.x += 1;
  const result = validateSemanticRoomPackStateBridgeV2(plan);
  assert.equal(result.accepted, false);
  assert.ok(result.errors.some(({ code }) => code === 'semantic-room-pack-water-geometric-volume-mismatch'));
});
