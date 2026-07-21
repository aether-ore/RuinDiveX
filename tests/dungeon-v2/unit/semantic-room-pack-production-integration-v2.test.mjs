import test from 'node:test';
import assert from 'node:assert/strict';

import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { stablePlanStringify } from '../../../src/dungeon-v2/DungeonPlanDiagnostics.js';
import {
  prepareSemanticRoomPackProductionIntegrationV2,
} from '../../../src/dungeon-v2/SemanticRoomPackProductionIntegrationV2.js';

const VARIANTS = Object.freeze([
  Object.freeze({
    undercroftType: 'magma',
    undercroftRoomId: 'rdx_magma_foundry_undercroft',
  }),
  Object.freeze({
    undercroftType: 'electrical',
    undercroftRoomId: 'rdx_electric_transformer_undercroft',
  }),
]);

for (const { undercroftType, undercroftRoomId } of VARIANTS) {
  test(`default ${undercroftType} Golden seed owns the three accepted authored macro replacements`, () => {
    const options = {
      seed: `semantic-room-pack-production-${undercroftType}`,
      undercroftType,
    };
    const first = createGoldenDungeonPlanV2(options);
    const second = createGoldenDungeonPlanV2(options);
    assert.equal(stablePlanStringify(first), stablePlanStringify(second));

    const validation = validateDungeonPlanV2(first);
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    assert.equal(first.semanticRoomPackIntegration.fullyIntegrated, true);
    assert.equal(first.semanticRoomPackIntegration.acceptanceBlocking, false);
    assert.equal(first.semanticRoomPackIntegration.productionEligible, true);
    assert.equal(first.semanticRoomPackIntegration.diagnosticConnectorCellCount, 0);
    assert.equal(first.semanticRoomPackStateBridge.fullyReconciled, true);

    assert.deepEqual(first.semanticRoomPackPlacements.map(({ roomId }) => roomId), [
      'rdx_factory_corkscrew_exchange',
      'rdx_waterworks_freight_sump',
      undercroftRoomId,
    ]);
    for (const placement of first.semanticRoomPackPlacements) {
      assert.equal(Object.isFrozen(placement), true);
      assert.equal(placement.authoredRootTransform.recenter, false);
      assert.deepEqual(placement.authoredRootTransform.scale, { x: 1, y: 1, z: 1 });
      assert.equal(placement.placementTransform.aggregateBoundsOffsetApplied, false);
      assert.equal(placement.collisionSourcePolicy, 'manifest-collision-volumes-only');
      assert.ok(first.modulePlacements.some(({ id, placementId, semanticRoomPackPlacementId }) => (
        id === placement.placementId
        || placementId === placement.placementId
        || semanticRoomPackPlacementId === placement.placementId
      )));
    }

    const packCells = first.spatialCells.filter(({ semanticRoomPackPlacementId }) => (
      typeof semanticRoomPackPlacementId === 'string'
    ));
    assert.ok(packCells.some(({ id }) => id === 'cell.corkscrew.main'));
    assert.ok(packCells.some(({ id }) => id === 'cell.semantic-room-pack.waterworks.main'));
    assert.ok(packCells.some(({ id }) => id === 'cell.semantic-room-pack.undercroft'));
  });
}

test('production composer is atomic when run against the explicit pre-replacement unit fixture', () => {
  const source = createGoldenDungeonPlanV2({
    seed: 'semantic-room-pack-production-atomic',
    undercroftType: 'magma',
    deferSemanticRoomPackIntegration: true,
  });
  const before = stablePlanStringify(source);
  const result = prepareSemanticRoomPackProductionIntegrationV2(source);
  assert.equal(result.accepted, true, JSON.stringify(result.dungeonValidation?.errors, null, 2));
  assert.equal(result.dungeonValidation.accepted, true);
  assert.equal(stablePlanStringify(source), before, 'prepare must never mutate its source plan');
  assert.equal(result.plan.semanticRoomPackPlacements.length, 3);
});
