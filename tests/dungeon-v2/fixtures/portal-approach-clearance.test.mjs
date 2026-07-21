import test from 'node:test';
import assert from 'node:assert/strict';
import { createTraversalLabPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { buildIndependentPortalRouteProofs } from '../helpers/assembly-proofs.mjs';
import { createAcceptedSyntheticFixture } from '../helpers/synthetic-fixtures.mjs';

function portalProof(fixture) {
  return buildIndependentPortalRouteProofs(fixture.plan, fixture.assembly)
    .find(({ portalId }) => portalId === 'portal-a-b');
}

test('independent portal clearance proof declares and clears both player approaches', () => {
  const fixture = createAcceptedSyntheticFixture();
  const proof = portalProof(fixture);
  assert.deepEqual(proof.approachClearanceVolumes.map(({ endpoint }) => endpoint), ['from', 'to']);
  assert.equal(proof.approachClearanceAccepted, true);
  for (const approach of proof.approachClearanceVolumes) {
    assert.equal(approach.declaredBy, 'portal-endpoint-traversal-contract');
    assert.ok(approach.width >= fixture.plan.portals[0].traversal.minimumWidth);
    assert.ok(approach.headroom >= fixture.plan.portals[0].traversal.minimumHeadroom);
    assert.deepEqual(approach.structuralFixtureIntrusions, []);
    assert.deepEqual(approach.interactionIntrusions, []);
    assert.deepEqual(approach.colliderIntrusions, []);
  }
});

test('vertical lift/drop portals declare playable clearance above floors and below ceilings', () => {
  const fixture = createAcceptedSyntheticFixture((candidate) => {
    const portal = candidate.plan.portals[0];
    portal.from.side = 'floor';
    portal.from.center = { x: 10, y: 0, z: 5 };
    portal.from.elevation = 0;
    portal.from.dimensions = { width: 3, height: 0.8, depth: 3 };
    portal.to.side = 'ceiling';
    portal.to.center = { x: 10, y: 4, z: 5 };
    portal.to.elevation = 4;
    portal.to.dimensions = { width: 3, height: 0.8, depth: 3 };
  });
  const proof = portalProof(fixture);
  const from = proof.approachClearanceVolumes.find(({ endpoint }) => endpoint === 'from');
  const to = proof.approachClearanceVolumes.find(({ endpoint }) => endpoint === 'to');
  assert.equal(from.declaredBy, 'portal-endpoint-traversal-contract');
  assert.equal(to.declaredBy, 'portal-endpoint-traversal-contract');
  assert.equal(from.bounds.min.y, 0.025);
  assert.equal(from.bounds.max.y, 3.2);
  assert.ok(Math.abs(to.bounds.min.y - 0.8) < 1e-9);
  assert.ok(Math.abs(to.bounds.max.y - 3.975) < 1e-9);
  assert.equal(from.headroom, 3.2);
  assert.equal(to.headroom, 3.2);
});

test('independent portal clearance proof detects a structural fixture on the from side', () => {
  const fixture = createAcceptedSyntheticFixture((candidate) => {
    candidate.plan.structuralFixtures[0].bounds = {
      min: { x: 9.1, y: 0.2, z: 4.5 },
      max: { x: 9.8, y: 1.7, z: 5.5 },
    };
  });
  const proof = portalProof(fixture);
  const from = proof.approachClearanceVolumes.find(({ endpoint }) => endpoint === 'from');
  assert.deepEqual(from.structuralFixtureIntrusions.map(({ id }) => id), ['fixture-a-pipe']);
  assert.equal(from.accepted, false);
  assert.equal(proof.approachClearanceAccepted, false);
});

test('independent portal clearance proof uses exact support posts instead of their spanning union', () => {
  const fixture = createAcceptedSyntheticFixture((candidate) => {
    const support = candidate.plan.structuralFixtures[0];
    support.bounds = {
      min: { x: 8.8, y: 0.2, z: 2 },
      max: { x: 9.8, y: 2.4, z: 8 },
    };
    support.colliderIds = [
      `${support.id}:collider:left-post`,
      `${support.id}:collider:right-post`,
    ];
    support.colliderBounds = [
      {
        min: { x: 8.8, y: 0.2, z: 2 },
        max: { x: 9.8, y: 2.4, z: 2.3 },
      },
      {
        min: { x: 8.8, y: 0.2, z: 7.7 },
        max: { x: 9.8, y: 2.4, z: 8 },
      },
    ];
  });
  const proof = portalProof(fixture);
  const from = proof.approachClearanceVolumes.find(({ endpoint }) => endpoint === 'from');
  assert.deepEqual(from.structuralFixtureIntrusions, []);
  assert.equal(from.accepted, true,
    'support union may span the doorway only when every exact collider remains outside the lane');
});

test('independent portal clearance proof detects an interaction console on the to side', () => {
  const fixture = createAcceptedSyntheticFixture((candidate) => {
    candidate.plan.anchors.push({
      id: 'anchor.portal-console',
      regionId: 'region-b',
      position: { x: 10.55, y: 0.2, z: 5 },
      forward: { x: 1, y: 0, z: 0 },
      surfaceId: 'surface-b',
    });
    candidate.plan.actions.push({
      id: 'action.portal-console',
      anchorId: 'anchor.portal-console',
      interaction: { activationSide: 'front', radius: 1.4 },
      conditions: [],
      effects: [],
    });
  });
  const proof = portalProof(fixture);
  const to = proof.approachClearanceVolumes.find(({ endpoint }) => endpoint === 'to');
  assert.deepEqual(to.interactionIntrusions.map(({ actionId }) => actionId), ['action.portal-console']);
  assert.equal(to.accepted, false);
  assert.equal(proof.approachClearanceAccepted, false);
});

test('independent portal clearance proof detects an unowned runtime collider on the to side', () => {
  const fixture = createAcceptedSyntheticFixture();
  fixture.assembly.structuralRegistry.colliders.set('collider:stray-portal-obstruction', {
    id: 'collider:stray-portal-obstruction',
    planId: null,
    obstacleKind: 'wall',
    active: true,
    bounds: {
      min: { x: 10.2, y: 0.15, z: 4.6 },
      max: { x: 10.8, y: 2.1, z: 5.4 },
    },
  });
  const proof = portalProof(fixture);
  const to = proof.approachClearanceVolumes.find(({ endpoint }) => endpoint === 'to');
  assert.deepEqual(to.colliderIntrusions.map(({ colliderId }) => colliderId), [
    'collider:stray-portal-obstruction',
  ]);
  assert.equal(to.accepted, false);
  assert.equal(proof.approachClearanceAccepted, false);
});

test('assembled portal trim follows each endpoint boundary plane instead of crossing its doorway', () => {
  const validation = validateDungeonPlanV2(createTraversalLabPlanV2({
    seed: 'portal-frame-orientation-regression',
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const facade = assembleDungeonPlanV2(validation.plan);
  try {
    for (const portal of validation.plan.portals) {
      for (const endpoint of [portal.from, portal.to]) {
        if (!['north', 'south', 'east', 'west'].includes(endpoint.side)) continue;
        const frame = facade.group.getObjectByName(`v2PortalFrame:${portal.id}:${endpoint.regionId}`);
        assert.ok(frame, `${portal.id}:${endpoint.regionId} has no assembled frame`);
        assert.equal(frame.children.length, 3,
          `${portal.id}:${endpoint.regionId} requires two side trims and one header`);
        const [left, right] = frame.children;
        const tangentAxis = ['east', 'west'].includes(endpoint.side) ? 'z' : 'x';
        const fixedAxis = tangentAxis === 'z' ? 'x' : 'z';
        for (const side of [left, right]) {
          assert.ok(Math.abs(side.position[fixedAxis] - endpoint.center[fixedAxis]) < 1e-9,
            `${portal.id}:${endpoint.regionId} trim left its ${endpoint.side} boundary plane`);
          assert.ok(Math.abs(
            Math.abs(side.position[tangentAxis] - endpoint.center[tangentAxis])
              - (endpoint.dimensions.width * 0.5 + 0.11),
          ) < 1e-9, `${portal.id}:${endpoint.regionId} trim crosses the central doorway`);
        }
      }
    }
  } finally {
    facade.dispose();
  }
});
