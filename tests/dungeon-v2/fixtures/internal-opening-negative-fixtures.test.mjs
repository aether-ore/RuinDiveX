import test from 'node:test';

import {
  assertAcceptanceFailure,
  assertClosedCellContract,
} from '../helpers/accepted-fixture.mjs';
import { createAcceptedSyntheticFixture } from '../helpers/synthetic-fixtures.mjs';

function structuralBoundary(id, side, bounds, kind = 'solid') {
  return {
    id,
    cellId: 'cell-a-alcove',
    regionId: 'region-a',
    side,
    kind,
    bounds,
    openings: [],
    materialProfileId: 'test-bulkhead',
    collider: { enabled: true },
  };
}

function planWithInternalOpening() {
  const plan = structuredClone(createAcceptedSyntheticFixture().plan);
  const containingCell = plan.spatialCells.find(({ id }) => id === 'cell-a');
  containingCell.compoundId = 'compound.region-a';
  containingCell.compoundShell = true;
  plan.spatialCells.push({
    id: 'cell-a-alcove',
    regionId: 'region-a',
    bounds: { min: { x: 2, y: 0, z: 2 }, max: { x: 6, y: 5, z: 6 } },
    playable: true,
    interior: true,
    compoundId: 'compound.region-a',
    compoundSubRegion: true,
  });
  const alcoveBoundaries = [
    structuralBoundary('a-alcove-west', 'west', { min: { x: 2, y: 0, z: 2 }, max: { x: 2, y: 5, z: 6 } }),
    structuralBoundary('a-alcove-east', 'east', { min: { x: 6, y: 0, z: 2 }, max: { x: 6, y: 5, z: 6 } }),
    structuralBoundary('a-alcove-floor', 'floor', { min: { x: 2, y: 0, z: 2 }, max: { x: 6, y: 0, z: 6 } }),
    structuralBoundary('a-alcove-ceiling', 'ceiling', { min: { x: 2, y: 5, z: 2 }, max: { x: 6, y: 5, z: 6 } }),
    structuralBoundary('a-alcove-north', 'north', { min: { x: 2, y: 0, z: 2 }, max: { x: 6, y: 5, z: 2 } }),
    structuralBoundary('a-alcove-south', 'south', { min: { x: 2, y: 0, z: 6 }, max: { x: 6, y: 5, z: 6 } }, 'portal-frame'),
  ];
  alcoveBoundaries.at(-1).openings.push({
    id: 'opening.internal.region-a.alcove',
    portalId: 'internal.region-a.alcove',
    internalPortalId: 'internal.region-a.alcove',
    pairedWithinCompound: true,
    sourceCellId: 'cell-a-alcove',
    targetCellId: 'cell-a',
    targetRegionId: 'region-a',
    center: { x: 4, y: 2, z: 6 },
    dimensions: { width: 2, height: 4, depth: 0.5 },
  });
  plan.structuralBoundaries.push(...alcoveBoundaries);
  plan.walkableSurfaces.push({
    id: 'surface-a-alcove',
    regionId: 'region-a',
    cellId: 'cell-a-alcove',
    bounds: { min: { x: 2.2, y: 0, z: 2.2 }, max: { x: 5.8, y: 0.2, z: 5.8 } },
    purpose: 'compound exploration alcove',
    supportBoundaryIds: ['a-alcove-floor'],
    collision: { enabled: true },
  });
  plan.traversalLinks.push({
    id: 'traversal.internal.region-a.alcove',
    regionId: 'region-a',
    fromSurfaceId: 'surface-a',
    toSurfaceId: 'surface-a-alcove',
    mode: 'walk',
    bidirectional: true,
    internalPortalId: 'internal.region-a.alcove',
  });
  return plan;
}

function internalOpening(plan) {
  return plan.structuralBoundaries.find(({ id }) => id === 'a-alcove-south').openings[0];
}

test('closed-cell proof accepts an explicitly paired opening into its containing compound shell', () => {
  assertClosedCellContract(planWithInternalOpening());
});

const internalOpeningNegatives = [
  ['internal-opening-contract-missing', (plan) => { delete internalOpening(plan).pairedWithinCompound; }],
  ['internal-opening-target-missing', (plan) => { internalOpening(plan).targetCellId = 'cell-painted-backdrop'; }],
  ['internal-opening-compound-mismatch', (plan) => {
    plan.spatialCells.find(({ id }) => id === 'cell-a-alcove').compoundId = 'compound.unrelated';
  }],
  ['internal-opening-outside-target', (plan) => {
    const source = plan.spatialCells.find(({ id }) => id === 'cell-a-alcove');
    source.bounds.max.z = 10;
    internalOpening(plan).center.z = 10;
  }],
  ['internal-opening-traversal-missing', (plan) => {
    plan.traversalLinks.find(({ id }) => id === 'traversal.internal.region-a.alcove').internalPortalId = 'internal.wrong-id';
  }],
  ['internal-opening-traversal-mismatch', (plan) => {
    plan.traversalLinks.find(({ id }) => id === 'traversal.internal.region-a.alcove').toSurfaceId = 'surface-b';
  }],
  ['internal-opening-id-duplicate', (plan) => {
    const frame = plan.structuralBoundaries.find(({ id }) => id === 'a-alcove-south');
    frame.openings.push({ ...frame.openings[0], id: 'opening.internal.region-a.duplicate' });
  }],
  ['internal-opening-top-level-portal', (plan) => {
    internalOpening(plan).portalId = 'portal-a-b';
  }],
];

for (const [code, mutate] of internalOpeningNegatives) {
  test(`closed-cell proof rejects ${code}`, () => {
    const plan = planWithInternalOpening();
    mutate(plan);
    assertAcceptanceFailure(code, () => assertClosedCellContract(plan));
  });
}

function planWithMovableGateBarrier() {
  const plan = structuredClone(createAcceptedSyntheticFixture().plan);
  plan.structuralBoundaries.push({
    id: 'gate.portal-a-b',
    cellId: 'cell-a',
    regionId: 'region-a',
    side: 'east',
    kind: 'movable-gate-barrier',
    bounds: { min: { x: 9.8, y: 0, z: 3.5 }, max: { x: 10.2, y: 4, z: 6.5 } },
    openings: [],
    materialProfileId: 'test-security-gate',
    collider: { enabled: true },
    collision: 'dynamic',
    opaque: true,
    movable: true,
    blocksPortalId: 'portal-a-b',
  });
  return plan;
}

test('closed-cell proof accepts an opaque colliding movable barrier tied to a portal endpoint', () => {
  assertClosedCellContract(planWithMovableGateBarrier());
});

for (const [label, mutate] of [
  ['transparent', (barrier) => { barrier.opaque = false; }],
  ['unowned', (barrier) => { barrier.blocksPortalId = 'portal-painted-only'; }],
  ['wrong-side', (barrier) => { barrier.side = 'north'; }],
]) {
  test(`closed-cell proof rejects ${label} movable gate barrier`, () => {
    const plan = planWithMovableGateBarrier();
    mutate(plan.structuralBoundaries.find(({ id }) => id === 'gate.portal-a-b'));
    assertAcceptanceFailure('gate-barrier-contract-invalid', () => assertClosedCellContract(plan));
  });
}
