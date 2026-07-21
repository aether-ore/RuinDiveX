import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import {
  replaceGoldenUndercroftWithSemanticRoomPackV2,
  validateSemanticRoomPackUndercroftReplacementV2,
} from '../../../src/dungeon-v2/SemanticRoomPackUndercroftReplacementV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { validateSemanticRoomPackPlacementV2 } from '../../../src/dungeon-v2/SemanticRoomPackPlanAdapterV2.js';
import { stablePlanStringify } from '../../../src/dungeon-v2/DungeonPlanDiagnostics.js';

function mutableGolden(undercroftType, seed = `undercroft-replacement-${undercroftType}`) {
  return structuredClone(createGoldenDungeonPlanV2({
    seed,
    undercroftType,
    deferSemanticRoomPackIntegration: true,
  }));
}

function replaced(undercroftType, seed) {
  const plan = mutableGolden(undercroftType, seed);
  const connectorCellIdsBefore = plan.spatialCells.filter(({ connector }) => connector).map(({ id }) => id).sort();
  assert.equal(replaceGoldenUndercroftWithSemanticRoomPackV2(plan), plan);
  const connectorCellIdsAfter = plan.spatialCells.filter(({ connector }) => connector).map(({ id }) => id).sort();
  assert.deepEqual(connectorCellIdsAfter, connectorCellIdsBefore);
  return plan;
}

for (const [undercroftType, roomId, expected] of [
  ['magma', 'rdx_magma_foundry_undercroft', {
    type: 'magma-floor-v1',
    damagePerSecond: 12,
    surfaceCount: 1,
    pulseSeconds: 0.25,
    entryGraceSeconds: 0.5,
  }],
  ['electrical', 'rdx_electric_transformer_undercroft', {
    type: 'electric-floor-cycle-v1',
    damagePerSecond: 9,
    surfaceCount: 25,
    phaseCycleSeconds: 3.5,
  }],
]) {
  test(`${undercroftType} authored Undercroft replaces the macro cell and passes the shared whole-plan validator`, () => {
    const plan = replaced(undercroftType);
    const placement = plan.semanticRoomPackPlacements.find(({ id }) => id === 'placement.semantic-room-pack.undercroft');
    assert.equal(placement.roomId, roomId);
    assert.equal(Object.isFrozen(placement), true);
    assert.equal(validateSemanticRoomPackPlacementV2(placement).accepted, true);
    assert.deepEqual(placement.socketBindings.map(({ socketId, status }) => [socketId, status]), undercroftType === 'magma'
      ? [['entry_south', 'bound'], ['exit_north', 'bound'], ['service_west', 'capped']]
      : [['entry_south', 'bound'], ['exit_north', 'bound'], ['upper_east', 'capped']]);
    assert.equal(placement.collisionSourcePolicy, 'manifest-collision-volumes-only');
    assert.ok(placement.transformedCollisionVolumes.every(({ derivedFromVisibleMeshBounds }) => derivedFromVisibleMeshBounds === false));

    assert.equal(plan.spatialCells.some(({ id }) => id === 'cell.hazard-core.main'), false);
    assert.equal(plan.spatialCells.some(({ id }) => id === 'cell.hazard-core.process-alcove'), false);
    assert.equal(plan.spatialCells.some(({ id }) => id === 'cell.hazard-core.inspection-vault'), false);
    assert.equal(plan.spatialCells.some(({ id }) => id === 'cell.semantic-room-pack.undercroft'), true);
    assert.deepEqual(plan.semanticRoomPackUndercroftReplacement.addedConnectorCellIds, []);
    assert.equal(plan.portals.find(({ id }) => id === 'portal.hazard-intake-core').to.cellId, 'cell.semantic-room-pack.undercroft');
    assert.equal(plan.portals.find(({ id }) => id === 'portal.hazard-core-credential-return').from.cellId, 'cell.semantic-room-pack.undercroft');

    const environment = plan.environmentStates.find(({ id }) => id === 'environment.undercroft-hazard');
    assert.equal(environment.type, expected.type);
    assert.equal(environment.damagePerSecond, expected.damagePerSecond);
    assert.equal(environment.surfaces.length, expected.surfaceCount);
    assert.equal(environment.safeRouteRequired, true);
    assert.equal(environment.unavoidableExposureAllowed, false);
    if (undercroftType === 'magma') {
      assert.equal(environment.pulseSeconds, expected.pulseSeconds);
      assert.equal(environment.entryGraceSeconds, expected.entryGraceSeconds);
    } else {
      assert.equal(environment.phaseCycleSeconds, expected.phaseCycleSeconds);
      assert.deepEqual(environment.phases.map(({ id, durationSeconds }) => [id, durationSeconds]), [
        ['safe', 1.25], ['charging', 0.75], ['energized', 1.5],
      ]);
    }

    const cacheAnchor = plan.anchors.find(({ id }) => id === 'anchor.cache.undercroft');
    assert.equal(cacheAnchor.descriptorReference.placementId, placement.id);
    assert.equal(cacheAnchor.descriptorReference.sourceNodeName.startsWith('ANCHOR_REWARD_'), true);
    const shortcutAnchor = plan.anchors.find(({ id }) => id === 'anchor.shortcut.gamma');
    const shortcutSurface = plan.walkableSurfaces.find(({ id }) => id === shortcutAnchor.surfaceId);
    assert.equal(shortcutAnchor.position.y, shortcutSurface.bounds.max.y,
      'Gamma shortcut interaction anchor must sit on top of its console pad');
    assert.ok(placement.runtimeContractBindings.hazard.safeRouteSurfaceIds.length > 1);
    assert.equal(placement.runtimeContractBindings.reward.surfaceId, cacheAnchor.surfaceId);
    assert.ok(plan.semanticRoomPackUndercroftReplacement.safeRouteTraversalLinkIds.length > 0);

    const replacementValidation = validateSemanticRoomPackUndercroftReplacementV2(plan);
    assert.equal(replacementValidation.accepted, true, JSON.stringify(replacementValidation.errors, null, 2));
    const wholePlanValidation = validateDungeonPlanV2(plan);
    assert.equal(wholePlanValidation.accepted, true, JSON.stringify(wholePlanValidation.errors, null, 2));
  });
}

test('Undercroft replacement is deterministic and fails closed on incompatible or duplicate application', () => {
  const first = replaced('electrical', 'undercroft-replacement-deterministic');
  const second = replaced('electrical', 'undercroft-replacement-deterministic');
  assert.equal(
    stablePlanStringify(first.semanticRoomPackPlacements),
    stablePlanStringify(second.semanticRoomPackPlacements),
  );
  assert.equal(
    stablePlanStringify(first.semanticRoomPackUndercroftReplacement),
    stablePlanStringify(second.semanticRoomPackUndercroftReplacement),
  );
  assert.throws(
    () => replaceGoldenUndercroftWithSemanticRoomPackV2(first),
    /already been applied|already contains/u,
  );
  const magma = mutableGolden('magma');
  assert.throws(
    () => replaceGoldenUndercroftWithSemanticRoomPackV2(magma, { undercroftType: 'electrical' }),
    /does not match/u,
  );
});
