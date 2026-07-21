import test from 'node:test';
import { createTraversalLabPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import {
  assertAcceptanceFailure,
  assertWalkableSurfaceContracts,
} from '../helpers/accepted-fixture.mjs';

function mutableLab() {
  return structuredClone(createTraversalLabPlanV2({ seed: 'ladder-alignment-negative' }));
}

function firstLadder(plan) {
  return plan.walkableSurfaces.find(({ geometry }) => geometry?.type === 'ladder');
}

test('walkable-surface acceptance includes explicit ladder plane/root semantics', () => {
  assertWalkableSurfaceContracts(createTraversalLabPlanV2({ seed: 'ladder-alignment-positive' }));
});

test('ladder descriptor rejects a missing visual plane path', () => {
  const plan = mutableLab();
  delete firstLadder(plan).geometry.planePath;
  assertAcceptanceFailure('ladder-plane-contract-missing', () => assertWalkableSurfaceContracts(plan));
});

test('ladder descriptor rejects a plane normal that faces with the climber', () => {
  const plan = mutableLab();
  const geometry = firstLadder(plan).geometry;
  geometry.planeNormal = { ...geometry.climbFacing };
  assertAcceptanceFailure('ladder-facing-contract-invalid', () => assertWalkableSurfaceContracts(plan));
});

test('ladder descriptor rejects an intersecting root/plane clearance', () => {
  const plan = mutableLab();
  firstLadder(plan).geometry.bodyClearance = 0;
  assertAcceptanceFailure('ladder-body-clearance-invalid', () => assertWalkableSurfaceContracts(plan));
});

test('ladder descriptor rejects root-path tangent drift from the rung plane', () => {
  const plan = mutableLab();
  firstLadder(plan).geometry.path[0].z += 0.2;
  assertAcceptanceFailure('ladder-root-plane-clearance-mismatch', () => assertWalkableSurfaceContracts(plan));
});

test('ladder descriptor rejects a landing with less than 1.2m of ordinary walk-away space', () => {
  const plan = mutableLab();
  firstLadder(plan).geometry.landings.bottom.minimumClearLength = 1.19;
  assertAcceptanceFailure('ladder-landing-contract-missing', () => assertWalkableSurfaceContracts(plan));
});

test('ladder descriptor rejects a root or dismount below its exact landing floor', () => {
  const plan = mutableLab();
  const ladder = firstLadder(plan);
  ladder.geometry.path[0].y -= 0.02;
  ladder.geometry.planePath[0].y -= 0.02;
  ladder.geometry.bottomExit.y -= 0.02;
  ladder.geometry.landings.bottom.exit.y -= 0.02;
  assertAcceptanceFailure('ladder-landing-height-mismatch', () => assertWalkableSurfaceContracts(plan));
});

test('ladder descriptor rejects navigation that omits safe exits and mount roots', () => {
  const plan = mutableLab();
  const ladder = firstLadder(plan);
  const link = plan.traversalLinks.find(({ viaSurfaceId }) => viaSurfaceId === ladder.id);
  delete link.waypoints;
  assertAcceptanceFailure('ladder-navigation-route-missing', () => assertWalkableSurfaceContracts(plan));
});

test('ladder descriptor rejects a walkable floor covering its descending aperture', () => {
  const plan = mutableLab();
  const ladder = firstLadder(plan);
  const opening = ladder.geometry.topOpening.bounds;
  const landing = plan.walkableSurfaces.find(({ id }) => (
    id === ladder.geometry.landings.top.surfaceId
  ));
  landing.bounds = {
    min: { x: opening.min.x, y: opening.max.y - 0.3, z: opening.min.z },
    max: { x: opening.max.x, y: opening.max.y, z: opening.max.z },
  };
  assertAcceptanceFailure('ladder-top-opening-covered', () => assertWalkableSurfaceContracts(plan));
});
