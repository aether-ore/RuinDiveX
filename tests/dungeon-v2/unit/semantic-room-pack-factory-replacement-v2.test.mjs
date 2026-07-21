import assert from 'node:assert/strict';
import test from 'node:test';

import { clonePlanData } from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';
import { stablePlanStringify } from '../../../src/dungeon-v2/DungeonPlanDiagnostics.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import {
  FACTORY_CORKSCREW_SOCKET_ROUTE_BINDINGS_V2,
  FactoryCorkscrewMacroReplacementErrorV2,
  prepareFactoryCorkscrewMacroReplacementV2,
  replaceGoldenFactoryWithSemanticRoomPackV2,
} from '../../../src/dungeon-v2/SemanticRoomPackFactoryReplacementV2.js';

const ROOM_ID = 'rdx_factory_corkscrew_exchange';
const PLACEMENT_ID = 'placement.semantic-room-pack.factory-corkscrew';
const REMOVED_PORTAL_ID = 'portal.nest-corkscrew-service';

function golden(undercroftType = 'magma') {
  return createGoldenDungeonPlanV2({
    seed: `factory-macro-replacement-${undercroftType}`,
    undercroftType,
    deferSemanticRoomPackIntegration: true,
  });
}

test('Factory Corkscrew authored macro replaces the Golden cell and remains fully accepted for both hazard stories', () => {
  for (const undercroftType of ['magma', 'electrical']) {
    const source = golden(undercroftType);
    const before = stablePlanStringify(source);
    const result = prepareFactoryCorkscrewMacroReplacementV2(source);

    assert.equal(result.accepted, true, result.errors.map(({ code }) => code).join(', '));
    assert.equal(result.productionAccepted, true, result.dungeonValidation?.errors.map(({ code }) => code).join(', '));
    assert.equal(result.dungeonValidation.accepted, true);
    assert.equal(result.dungeonValidation.diagnostics.symbolicVisitedStates > 0, true);
    assert.equal(stablePlanStringify(source), before, 'prepare must not mutate the accepted source plan');

    const placement = result.placement;
    assert.equal(Object.isFrozen(placement), true);
    assert.equal(placement.roomId, ROOM_ID);
    assert.deepEqual(placement.placementTransform, {
      translation: { x: 96, y: 10.2, z: 0 },
      yawQuarterTurns: 2,
      scale: { x: 1, y: 1, z: 1 },
      authoredScalePreserved: true,
      aggregateBoundsOffsetApplied: false,
    });
    assert.deepEqual(placement.worldBounds, {
      min: { x: 78, y: 6, z: -17 },
      max: { x: 114, y: 25.7, z: 17 },
    });
    assert.equal(result.plan.semanticRoomPackFactoryReplacement.genericCorkscrewGeometryRetained, false);
  }
});

test('all four named sockets own useful existing graph routes without weakening credential gates', () => {
  const source = golden();
  const previousPhysicalIds = new Map(FACTORY_CORKSCREW_SOCKET_ROUTE_BINDINGS_V2.map(({ portalId }) => {
    const portal = source.portals.find(({ id }) => id === portalId);
    return [portalId, [...portal.physicalRoute.cellIds]];
  }));
  const result = prepareFactoryCorkscrewMacroReplacementV2(source);
  assert.equal(result.productionAccepted, true);
  const plan = result.plan;
  const placement = result.placement;
  const bindingBySocket = new Map(placement.socketBindings.map((entry) => [entry.socketId, entry]));

  assert.deepEqual(placement.socketBindings.map(({ status }) => status), ['bound', 'bound', 'bound', 'bound']);
  assert.equal(plan.portals.some(({ id }) => id === REMOVED_PORTAL_ID), false);
  assert.equal(plan.progression.connections.some(({ id }) => id === REMOVED_PORTAL_ID), false);
  assert.equal(plan.minimap.connections.some(({ id, portalId }) => id === REMOVED_PORTAL_ID || portalId === REMOVED_PORTAL_ID), false);

  for (const route of FACTORY_CORKSCREW_SOCKET_ROUTE_BINDINGS_V2) {
    const binding = bindingBySocket.get(route.socketId);
    const socket = placement.sockets.find(({ id }) => id === route.socketId);
    const portal = plan.portals.find(({ id }) => id === route.portalId);
    const endpoint = portal.from.regionId === 'corkscrew' ? portal.from : portal.to;
    const boundary = plan.structuralBoundaries.find(({ id }) => id === binding.boundaryId);

    assert.equal(binding.portalId, route.portalId);
    assert.equal(portal.barrierId, route.expectedBarrierId);
    assert.equal(endpoint.boundaryId, binding.boundaryId);
    const expectedCenter = {
      x: socket.worldPosition.x,
      y: socket.worldPosition.y + socket.aperture.height * 0.5,
      z: socket.worldPosition.z,
    };
    for (const axis of ['x', 'y', 'z']) assert.equal(Math.abs(endpoint.center[axis] - expectedCenter[axis]) <= 1e-7, true);
    assert.equal(boundary.openings.some(({ portalId }) => portalId === portal.id), true);
    assert.equal(portal.physicalRoute.authored, true);
    assert.equal(portal.physicalRoute.enclosed, true);
    assert.equal(portal.physicalRoute.continuous, true);
    assert.equal(portal.physicalRoute.supported, true);
    for (const previousId of previousPhysicalIds.get(portal.id)) {
      assert.equal(portal.physicalRoute.cellIds.includes(previousId), true, `${portal.id} preserves ${previousId}`);
    }
  }

  const credential = plan.progression.gateContracts.find(({ id }) => id === 'Gate_Credential_Loop');
  const gamma = plan.progression.gateContracts.find(({ id }) => id === 'Door_Gamma');
  assert.equal(credential.portalId, 'portal.corkscrew-credential-loop');
  assert.equal(gamma.portalId, 'portal.corkscrew-machine-core-gamma');
  assert.equal(gamma.requiredKeycardId, 'Keycard_Gamma');
  assert.equal(plan.actions.find(({ id }) => id === gamma.actionId).conditions.some(({ op, keyId }) => (
    op === 'hasKey' && keyId === 'Keycard_Gamma'
  )), true);

  const previousAffectedCellCount = [...previousPhysicalIds.values()].flat().length
    + source.portals.find(({ id }) => id === REMOVED_PORTAL_ID).physicalRoute.cellIds.length;
  assert.equal(placement.connectorCellIds.length <= previousAffectedCellCount + 1, true,
    'replacement reuses the existing macro routes instead of adding branch corridors');
  assert.equal(placement.connectorCellIds.some((id) => id.includes('semantic-room-pack.factory-corkscrew-branch')), false);
});

test('accepted Factory replacement has no generic chamber shell and uses manifest collision authority', () => {
  const { plan, placement, productionAccepted } = prepareFactoryCorkscrewMacroReplacementV2(golden());
  assert.equal(productionAccepted, true);
  const mainCell = plan.spatialCells.filter(({ id }) => id === 'cell.corkscrew.main');
  assert.equal(mainCell.length, 1);
  assert.equal(mainCell[0].semanticRoomPackPlacementId, PLACEMENT_ID);

  const authoredBoundaries = plan.structuralBoundaries.filter(({ cellId, semanticRoomPackPlacementId }) => (
    cellId === 'cell.corkscrew.main' && semanticRoomPackPlacementId === PLACEMENT_ID
  ));
  const manifestBoundaryIds = new Set(placement.placedRecordIds.structuralBoundaryIds);
  assert.equal(manifestBoundaryIds.size > 0, true);
  for (const id of manifestBoundaryIds) {
    const boundary = authoredBoundaries.find((entry) => entry.id === id);
    assert.ok(boundary, id);
    assert.equal(boundary.descriptorReference.collisionSourcePolicy, 'manifest-collision-volumes-only');
    assert.equal(boundary.descriptorReference.sourceNodeName.startsWith('SHELL_'), true);
  }
  assert.equal(plan.walkableSurfaces.some(({ id }) => id === 'surface.corkscrew.main'), false);
  assert.equal(plan.structuralBoundaries.some(({ id }) => id === 'boundary.corkscrew.ceiling'), false);
  assert.equal(plan.structuralFixtures.some(({ id }) => id === 'fixture.corkscrew.catwalk-supports'), false);
});

test('runtime bindings expose four exact authored stops and one explicit non-mesh dynamic collider', () => {
  const { plan, placement, productionAccepted } = prepareFactoryCorkscrewMacroReplacementV2(golden('electrical'));
  assert.equal(productionAccepted, true);
  const binding = placement.runtimeContractBindings.corkscrew;
  assert.deepEqual(binding.stableStateSocketBindings.map(({ stateId, socketId }) => ({ stateId, socketId })), [
    { stateId: 'south_entry', socketId: 'entry_south' },
    { stateId: 'east_mid', socketId: 'exit_east_mid' },
    { stateId: 'north_high', socketId: 'exit_north_high' },
    { stateId: 'west_top', socketId: 'exit_west_top' },
  ]);
  const dynamic = plan.walkableSurfaces.find(({ id }) => id === binding.dynamicSurfaceId);
  const control = plan.walkableSurfaces.find(({ id }) => id === binding.controlSurfaceId);
  assert.equal(dynamic.collision, 'dynamic');
  assert.equal(dynamic.mechanismId, 'mechanism.corkscrew-gear');
  assert.equal(dynamic.sourceNodeName, 'MECH_GEAR_PLATFORM');
  assert.equal(dynamic.derivedFromVisibleMeshBounds, false);
  assert.equal(control.collision, 'static');
  assert.match(control.purpose, /control pedestal/i);

  const mechanism = plan.mechanisms.find(({ id }) => id === 'mechanism.corkscrew-gear');
  assert.deepEqual(mechanism.states.map(({ id }) => id), ['south_entry', 'east_mid', 'north_high', 'west_top']);
  assert.equal(mechanism.runtimeProfile.dynamicSurfaceId, dynamic.id);
  assert.deepEqual(mechanism.actionIds, [
    'action.gear.align-low',
    'action.gear.align-bridge',
    'action.gear.align-north-high',
    'action.gear.align-high',
  ]);
});

test('Factory replacement fails closed atomically when an existing gate route is missing or weakened', () => {
  for (const mutate of [
    (plan) => { plan.portals = plan.portals.filter(({ id }) => id !== 'portal.corkscrew-machine-core-gamma'); },
    (plan) => { plan.portals.find(({ id }) => id === 'portal.corkscrew-machine-core-gamma').barrierId = null; },
  ]) {
    const source = clonePlanData(golden());
    mutate(source);
    const before = stablePlanStringify(source);
    const prepared = prepareFactoryCorkscrewMacroReplacementV2(source);
    assert.equal(prepared.accepted, false);
    assert.equal(prepared.productionAccepted, false);
    assert.equal(prepared.plan, null);
    assert.equal(prepared.errors[0].code, 'factory-macro-replacement-failed-closed');
    assert.equal(stablePlanStringify(source), before);
    assert.throws(
      () => replaceGoldenFactoryWithSemanticRoomPackV2(source),
      (error) => error instanceof FactoryCorkscrewMacroReplacementErrorV2
        && error.code === 'FACTORY_CORKSCREW_MACRO_REPLACEMENT_INVALID',
    );
    assert.equal(stablePlanStringify(source), before, 'failed public integration cannot partially mutate the plan');
  }
});

test('public replacement mutator commits the already accepted candidate atomically', () => {
  const plan = clonePlanData(golden('magma'));
  const returned = replaceGoldenFactoryWithSemanticRoomPackV2(plan);
  assert.equal(returned, plan);
  assert.equal(plan.semanticRoomPackPlacements.length, 1);
  assert.equal(plan.semanticRoomPackPlacements[0].roomId, ROOM_ID);
  assert.equal(plan.semanticRoomPackFactoryReplacement.fullyIntegrated, true);
  assert.equal(plan.portals.some(({ id }) => id === REMOVED_PORTAL_ID), false);
});
