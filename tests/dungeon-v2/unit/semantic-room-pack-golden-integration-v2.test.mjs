import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { integrateSemanticRoomPackGoldenPlanV2 } from '../../../src/dungeon-v2/SemanticRoomPackGoldenIntegrationV2.js';
import { validateSemanticRoomPackPlacementV2 } from '../../../src/dungeon-v2/SemanticRoomPackPlanAdapterV2.js';
import { isSerializablePlanValue } from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';
import { stablePlanStringify } from '../../../src/dungeon-v2/DungeonPlanDiagnostics.js';

function mutableGolden(undercroftType) {
  return structuredClone(createGoldenDungeonPlanV2({
    seed: `semantic-room-pack-golden-${undercroftType}`,
    undercroftType,
    deferSemanticRoomPackIntegration: true,
  }));
}

function integrate(undercroftType) {
  const plan = mutableGolden(undercroftType);
  assert.deepEqual(plan.semanticRoomPackPlacements, []);
  assert.equal(integrateSemanticRoomPackGoldenPlanV2(plan), plan);
  return plan;
}

for (const [undercroftType, undercroftRoomId, hazardSurfaceCount] of [
  ['magma', 'rdx_magma_foundry_undercroft', 1],
  ['electrical', 'rdx_electric_transformer_undercroft', 25],
]) {
  test(`${undercroftType} diagnostic candidate binds every required authored socket without claiming production acceptance`, () => {
    const plan = integrate(undercroftType);
    const [factory, waterworks, undercroft] = plan.semanticRoomPackPlacements;
    assert.deepEqual(plan.semanticRoomPackPlacements.map(({ roomId }) => roomId), [
      'rdx_factory_corkscrew_exchange',
      'rdx_waterworks_freight_sump',
      undercroftRoomId,
    ]);
    assert.deepEqual(factory.socketBindings.map(({ status }) => status), ['bound', 'bound', 'bound', 'bound']);
    assert.deepEqual(waterworks.socketBindings.map(({ status }) => status), ['bound', 'bound', 'bound', 'bound']);
    assert.deepEqual(undercroft.socketBindings.map(({ status }) => status), ['bound', 'bound', 'capped']);
    assert.equal(plan.semanticRoomPackIntegration.portalIds.length, 10);
    assert.equal(plan.semanticRoomPackIntegration.connectorCellIds.length, 42);
    assert.equal(plan.semanticRoomPackIntegration.pendingRoutes.length, 10);
    assert.equal(plan.semanticRoomPackIntegration.fullyIntegrated, false);
    assert.equal(plan.semanticRoomPackIntegration.acceptanceBlocking, true);
    assert.equal(plan.semanticRoomPackIntegration.productionEligible, false);
    assert.equal(plan.semanticRoomPackIntegration.diagnostics[0].code, 'semantic-room-pack-macro-replacement-required');
    assert.equal(plan.semanticRoomPackIntegration.diagnostics[0].details.connectorCellCount, 42);
    for (const placement of plan.semanticRoomPackPlacements) {
      assert.equal(Object.isFrozen(placement), true);
      assert.equal(placement.fullyIntegrated, false);
      assert.equal(validateSemanticRoomPackPlacementV2(placement).accepted, true);
    }
    assert.equal(isSerializablePlanValue(plan.semanticRoomPackPlacements), true);
    assert.equal(undercroft.runtimeContractBindings.hazard.surfaceIds.length, hazardSurfaceCount);
    assert.ok(plan.walkableSurfaces.some(({ id }) => id === undercroft.runtimeContractBindings.hazard.rewardSurfaceId));
  });
}

test('diagnostic candidate exposes exact plan-owned corkscrew, water, discovery, and presentation bindings', () => {
  const plan = integrate('magma');
  const [factory, waterworks] = plan.semanticRoomPackPlacements;
  const corkscrew = factory.runtimeContractBindings.corkscrew;
  const dynamic = plan.walkableSurfaces.find(({ id }) => id === corkscrew.dynamicSurfaceId);
  const control = plan.walkableSurfaces.find(({ id }) => id === corkscrew.controlSurfaceId);
  assert.equal(dynamic.sourceNodeName, 'MECH_GEAR_PLATFORM');
  assert.equal(dynamic.collision, 'dynamic');
  assert.equal(dynamic.mechanismId, 'mechanism.corkscrew-gear');
  assert.equal(control.collision, 'static');

  const water = waterworks.runtimeContractBindings.water;
  assert.equal(water.environmentStateId, 'environment.water-unit');
  assert.deepEqual(water.basins.map(({ stateId }) => stateId), [
    'FreightSumpFilled', 'StoredInReservoir', 'GantrySumpFilled',
  ]);
  const freight = water.basins[0];
  const authoredFloor = plan.walkableSurfaces.find(({ id }) => id === freight.floorSurfaceId);
  const authoredContract = waterworks.waterContracts[0];
  assert.equal(freight.basinId, 'basin.freight-sump');
  assert.equal(freight.bounds.min.y, authoredContract.basinBottomWorldY);
  assert.ok(Math.abs(authoredFloor.bounds.max.y - authoredContract.basinBottomWorldY) <= 0.01);
  assert.equal(water.discoverySurfaceIds.submerged_salvage_cache.endsWith(':surface:WALK_SUMP_ISLAND_0'), true);
  assert.equal(water.discoverySurfaceIds.drained_tunnel_cache.endsWith(':surface:WALK_DRAIN_TUNNEL'), true);
  assert.deepEqual(waterworks.runtimePresentationBindings.waterBasins, [{
    basinId: 'basin.freight-sump',
    sourceNodeName: 'FLUID_FACTORY_WATER_LEVEL_FREIGHT',
    presentationMode: 'authored-fluid-volume',
  }]);
});

test('diagnostic candidate is deterministic and preserves authored entry-tier placement transforms', () => {
  const first = integrate('electrical');
  const second = integrate('electrical');
  assert.equal(
    stablePlanStringify(first.semanticRoomPackPlacements),
    stablePlanStringify(second.semanticRoomPackPlacements),
  );
  for (const placement of first.semanticRoomPackPlacements) {
    const entry = placement.sockets.find(({ id }) => id === placement.entrySocketId);
    assert.deepEqual(entry.worldPosition, placement.presentationBinding.targetPortal.position);
    assert.equal(placement.authoredRootTransform.recenter, false);
    assert.deepEqual(placement.authoredRootTransform.scale, { x: 1, y: 1, z: 1 });
    assert.equal(placement.placementTransform.aggregateBoundsOffsetApplied, false);
  }
});
