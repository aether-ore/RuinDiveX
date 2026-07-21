import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import {
  createLegacyFixedRoomGoldenCompositionV2,
} from '../../../src/dungeon-v2/LegacyFixedRoomGoldenCompositionV2.js';
import { assertAcceptedDungeonFixture } from '../helpers/accepted-fixture.mjs';

const FORMERLY_DORMANT_PLACEMENTS = Object.freeze({
  'placement.conveyor': 'v1-room.conveyor-gantry',
  'placement.credential': 'v1-room.credential-pyramid',
  'placement.parts': 'v1-room.parts-vault',
  'placement.nest': 'v1-room.enemy-nest',
});

function endpointSocketUseCounts(plan) {
  const counts = new Map();
  for (const portal of plan.portals) {
    for (const endpoint of [portal.from, portal.to]) {
      if (!endpoint.nativeFixedRoomSocketId) continue;
      counts.set(
        endpoint.nativeFixedRoomSocketId,
        (counts.get(endpoint.nativeFixedRoomSocketId) ?? 0) + 1,
      );
    }
  }
  return counts;
}

for (const undercroftType of ['magma', 'electrical']) {
  test(`${undercroftType} production golden activates the former Sorting/Credential/Parts/Nest native tranche`, () => {
    const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
      seed: `active-single-region-native-${undercroftType}`,
      undercroftType,
    }), { throwOnError: false });
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    const plan = validation.plan;
    assertAcceptedDungeonFixture(plan, { stage: 'plan', profile: 'golden' });

    assert.equal(plan.singleRegionNativeV1IntegrationDiagnostics, undefined,
      'production must not run the superseded partial four-room integration seam');
    const coexistence = plan.canonicalNativeV1Coexistence;
    assert.ok(coexistence, 'accepted plan omitted the canonical authored-coexistence ledger');
    assert.equal(coexistence.accepted, true);
    assert.equal(coexistence.nativePlacementCount, 11);
    assert.equal(coexistence.semanticPackPlacementCount, 3);
    assert.equal(coexistence.totalAuthoredPlacementCount, 14);
    assert.equal(coexistence.genericRoomBodyCount, 0);
    assert.equal(plan.modulePlacements.length, 14);

    const canonical = createLegacyFixedRoomGoldenCompositionV2();
    const canonicalById = new Map(canonical.placements.map((placement) => [placement.id, placement]));
    const liveById = new Map(plan.modulePlacements.map((placement) => [placement.id, placement]));
    const socketUseCounts = endpointSocketUseCounts(plan);

    for (const [placementId, descriptorId] of Object.entries(FORMERLY_DORMANT_PLACEMENTS)) {
      const expected = canonicalById.get(placementId);
      const placement = liveById.get(placementId);
      assert.ok(expected, `${placementId} is absent from the canonical eleven-room composition`);
      assert.ok(placement, `${placementId} is absent from the accepted Golden plan`);
      assert.equal(placement.descriptorId, descriptorId);
      assert.equal(placement.nativeIntegrationStatus, 'playable-plan-owned');
      assert.deepEqual(placement.transform, expected.transform,
        `${placementId} drifted away from its non-overlapping canonical transform`);
      assert.deepEqual(placement.worldBounds, expected.worldBounds,
        `${placementId} no longer occupies its canonical authored volume`);
      assert.deepEqual(placement.openSocketIds, expected.openSocketIds,
        `${placementId} physical socket contract differs from the validated composition`);
      assert.ok(placement.occupiedCellIds.length > 0, `${placementId} has no occupied cells`);

      const physicalCells = plan.spatialCells.filter((cell) => (
        placement.occupiedCellIds.includes(cell.id)
        && cell.occupiedVolume !== false
      ));
      assert.ok(physicalCells.length > 0, `${placementId} has no occupied authored shell`);
      const physicalCellIds = new Set(physicalCells.map(({ id }) => id));
      assert.ok(plan.structuralBoundaries.some((boundary) => (
        physicalCellIds.has(boundary.cellId)
        && boundary.nativeFixedRoomPlacementId === placementId
        && boundary.collider === true
      )), `${placementId} has no plan-owned colliding enclosure`);
      assert.ok(plan.walkableSurfaces.some((surface) => (
        physicalCellIds.has(surface.cellId)
        && surface.nativeFixedRoomPlacementId === placementId
        && surface.collision === 'static'
      )), `${placementId} has no plan-owned walkable authored surface`);

      for (const socketId of placement.openSocketIds) {
        assert.equal(socketUseCounts.get(socketId), 1,
          `${placementId} socket ${socketId} must bind exactly one physical plan portal endpoint`);
      }
    }

    const partsNestConnection = canonical.connections.find(
      ({ id }) => id === 'connection.parts-nest-overhead-service',
    );
    assert.ok(partsNestConnection, 'canonical Parts -> Nest service-ladder connection is missing');
    assert.equal(partsNestConnection.form, 'service-ladder');
    assert.equal(partsNestConnection.optionalBranch, true);
    assert.equal(partsNestConnection.traversal.enclosed, true);
    assert.equal(partsNestConnection.traversal.supported, true);
    assert.equal(partsNestConnection.traversal.mode, 'dual-service-ladder-overhead-gallery');
    for (const endpoint of [partsNestConnection.from, partsNestConnection.to]) {
      assert.equal(socketUseCounts.get(endpoint.socketId), 1,
        `${endpoint.socketId} is not installed as the physical optional-branch route`);
    }
  });
}
