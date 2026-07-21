import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';

const SEED = 'm1-golden-gate-contract-negative-fixtures';
const TARGET_GATE_ID = 'Door_Alpha';

function createPlan() {
  return structuredClone(createGoldenDungeonPlanV2({
    seed: SEED,
    undercroftType: 'magma',
  }));
}

function gateParts(plan, gateId = TARGET_GATE_ID) {
  const gate = plan.progression.gateContracts.find((entry) => entry.id === gateId);
  assert.ok(gate, `${gateId} gate contract is required by this fixture`);
  const portal = plan.portals.find((entry) => entry.id === gate.portalId);
  const action = plan.actions.find((entry) => entry.id === gate.actionId);
  const anchor = plan.anchors.find((entry) => entry.id === action?.anchorId);
  const endpoint = [portal?.from, portal?.to]
    .find((entry) => entry.regionId === anchor?.regionId);
  const surface = plan.walkableSurfaces.find((entry) => (
    entry.id === (anchor?.surfaceId ?? anchor?.safeSurfaceId)
  ));
  const barrier = plan.structuralBoundaries.find((entry) => (
    entry.id === (gate.barrierBoundaryId ?? gate.barrierId)
  ));
  assert.ok(portal && action && anchor && endpoint && surface && barrier,
    `${gateId} must resolve its portal, action, anchor, side pad, and barrier`);
  return { gate, portal, action, anchor, endpoint, surface, barrier };
}

function assertRejectedWith(plan, code, expectedDetails) {
  const validation = validateDungeonPlanV2(plan);
  assert.equal(validation.accepted, false, `${code} mutation was incorrectly accepted`);
  const diagnostic = validation.errors.find((entry) => entry.code === code);
  assert.ok(diagnostic, `${code} missing from ${JSON.stringify(validation.errors, null, 2)}`);
  assert.deepEqual(
    Object.fromEntries(Object.keys(expectedDetails).map((key) => [key, diagnostic.details[key]])),
    expectedDetails,
  );
}

test('seeded golden gate contract baseline is accepted before negative mutations', () => {
  const validation = validateDungeonPlanV2(createPlan());
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
});

test('seeded golden validation rejects a side console pad placed in the portal lane', () => {
  const plan = createPlan();
  const { gate, endpoint, surface } = gateParts(plan);
  const lateralAxis = ['north', 'south'].includes(endpoint.side) ? 'x' : 'z';
  surface.bounds.min[lateralAxis] = endpoint.center[lateralAxis] - 0.5;
  surface.bounds.max[lateralAxis] = endpoint.center[lateralAxis] + 0.5;

  assertRejectedWith(plan, 'gate-control-in-portal-lane', {
    gateId: gate.id,
    surfaceId: surface.id,
    lateralAxis,
  });
});

test('seeded golden validation rejects a legal activation face pointing away from its gate lane', () => {
  const plan = createPlan();
  const { gate, action, anchor } = gateParts(plan);
  anchor.forward.x *= -1;
  anchor.forward.z *= -1;

  assertRejectedWith(plan, 'gate-control-facing-away-from-lane', {
    gateId: gate.id,
    actionId: action.id,
    anchorId: anchor.id,
  });
});

test('seeded golden validation rejects a barrier that does not seal the authored portal throat', () => {
  const plan = createPlan();
  const { gate, endpoint, barrier } = gateParts(plan);
  const depthAxis = ['north', 'south'].includes(endpoint.side) ? 'z' : 'x';
  const requiredDepth = endpoint.dimensions.depth;
  barrier.bounds.max[depthAxis] = barrier.bounds.min[depthAxis] + requiredDepth * 0.5;

  assertRejectedWith(plan, 'gate-barrier-throat-gap', {
    gateId: gate.id,
    barrierId: barrier.id,
    requiredThroatDepth: requiredDepth,
  });
});

test('seeded golden validation rejects gate-route surfaces that permit ledge correction', () => {
  const plan = createPlan();
  const { gate, portal } = gateParts(plan);
  const surfaceId = portal.physicalRoute.endpointSurfaceIds.from;
  const surface = plan.walkableSurfaces.find((entry) => entry.id === surfaceId);
  assert.ok(surface, `${surfaceId} route surface must exist`);
  surface.createsLedgeCandidates = true;

  assertRejectedWith(plan, 'gate-route-ledge-candidates-enabled', {
    gateId: gate.id,
    portalId: portal.id,
    surfaceId,
  });
});
