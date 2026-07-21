import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveRegionTopologySignatureV2,
  validatePhysicalPlayableGeometryUniquenessV2,
} from '../../../src/dungeon-v2/DungeonTopologySignatureV2.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';

function topologyPlan() {
  return {
    regions: [{
      id: 'room',
      displayName: 'Self-authored label must not count',
      topologySignature: 'claimed-signature',
      bounds: { min: { x: -15, y: 2, z: -10 }, max: { x: 15, y: 14, z: 10 } },
    }],
    spatialCells: [
      { id: 'cell.main', regionId: 'room', bounds: { min: { x: -15, y: 2, z: -10 }, max: { x: 15, y: 14, z: 10 } }, playable: true },
      { id: 'cell.branch', regionId: 'room', bounds: { min: { x: 4, y: 6, z: 1 }, max: { x: 11, y: 11, z: 8 } }, playable: true, compoundSubRegion: true },
    ],
    walkableSurfaces: [
      { id: 'surface.main', regionId: 'room', cellId: 'cell.main', bounds: { min: { x: -14, y: 2, z: -9 }, max: { x: 14, y: 2.3, z: 9 } }, collision: 'static' },
      { id: 'surface.catwalk', regionId: 'room', cellId: 'cell.branch', bounds: { min: { x: 4, y: 6, z: 1 }, max: { x: 11, y: 6.3, z: 3 } }, collision: 'static', geometry: { type: 'catwalk' } },
    ],
    structuralFixtures: [{
      id: 'fixture.pump', regionId: 'room', type: 'pump-array',
      bounds: { min: { x: -9, y: 2, z: 3 }, max: { x: -4, y: 8, z: 8 } },
    }],
    portals: [{
      id: 'portal.main', connectorForm: 'pipe-tunnel', approachType: 'ladder', direction: 'bidirectional',
      from: { regionId: 'room', side: 'north', center: { x: 7, y: 7, z: -10 }, dimensions: { width: 4, height: 4, depth: 1 } },
      to: { regionId: 'other', side: 'south', center: { x: 7, y: 11, z: -22 }, dimensions: { width: 4, height: 4, depth: 1 } },
      traversal: { mode: 'ladder' },
    }],
    mechanisms: [{
      id: 'mechanism.lift', regionId: 'room', type: 'cargo-lift', recallable: true, automaticTravel: true,
      states: [
        { id: 'low', stable: true, position: { x: 9, y: 3, z: -4 } },
        { id: 'high', stable: true, position: { x: 9, y: 10, z: -4 } },
      ],
      transitions: [{ fromStateId: 'low', toStateId: 'high', automatic: true }],
    }],
    environmentStates: [{
      id: 'water', type: 'conserved-water-unit',
      basins: [{ id: 'basin.room', regionId: 'room', bounds: { min: { x: -4, y: 2, z: -5 }, max: { x: 4, y: 8, z: 5 } }, capacityUnits: 1 }],
      stableStates: [{ id: 'dry', basinLevels: { 'basin.room': 0 } }, { id: 'full', basinLevels: { 'basin.room': 6 } }],
    }],
    falls: [],
    traversalLinks: [{ id: 'link.branch', regionId: 'room', fromSurfaceId: 'surface.main', toSurfaceId: 'surface.catwalk', mode: 'walkable-stairs', bidirectional: true, viaSurfaceId: 'surface.stairs' }],
  };
}

function rotatePoint(point) {
  return { ...point, x: -point.z, z: point.x };
}

function rotateBounds(bounds) {
  const corners = [
    rotatePoint({ x: bounds.min.x, y: bounds.min.y, z: bounds.min.z }),
    rotatePoint({ x: bounds.min.x, y: bounds.min.y, z: bounds.max.z }),
    rotatePoint({ x: bounds.max.x, y: bounds.max.y, z: bounds.min.z }),
    rotatePoint({ x: bounds.max.x, y: bounds.max.y, z: bounds.max.z }),
  ];
  return {
    min: { x: Math.min(...corners.map(({ x }) => x)), y: bounds.min.y, z: Math.min(...corners.map(({ z }) => z)) },
    max: { x: Math.max(...corners.map(({ x }) => x)), y: bounds.max.y, z: Math.max(...corners.map(({ z }) => z)) },
  };
}

function rotateSide(side) {
  return ({ north: 'east', east: 'south', south: 'west', west: 'north' })[side] ?? side;
}

function rotatePlan(source) {
  const plan = structuredClone(source);
  for (const region of plan.regions) region.bounds = rotateBounds(region.bounds);
  for (const cell of plan.spatialCells) cell.bounds = rotateBounds(cell.bounds);
  for (const surface of plan.walkableSurfaces) surface.bounds = rotateBounds(surface.bounds);
  for (const fixture of plan.structuralFixtures) fixture.bounds = rotateBounds(fixture.bounds);
  for (const portal of plan.portals) {
    for (const endpoint of [portal.from, portal.to]) {
      endpoint.center = rotatePoint(endpoint.center);
      endpoint.side = rotateSide(endpoint.side);
    }
  }
  for (const mechanism of plan.mechanisms) {
    for (const state of mechanism.states) if (state.position) state.position = rotatePoint(state.position);
  }
  for (const environment of plan.environmentStates) {
    for (const basin of environment.basins ?? []) basin.bounds = rotateBounds(basin.bounds);
  }
  return plan;
}

test('derived topology signatures are invariant under quarter-turn placement', () => {
  const plan = topologyPlan();
  assert.equal(
    deriveRegionTopologySignatureV2(plan, 'room'),
    deriveRegionTopologySignatureV2(rotatePlan(plan), 'room'),
  );
});

test('authored labels cannot manufacture topology uniqueness', () => {
  const plan = topologyPlan();
  const before = deriveRegionTopologySignatureV2(plan, 'room');
  plan.regions[0].displayName = 'A completely different label';
  plan.regions[0].topologySignature = 'd4:I-said-so';
  assert.equal(deriveRegionTopologySignatureV2(plan, 'room'), before);
});

test('a physical topology change changes the derived signature', () => {
  const plan = topologyPlan();
  const before = deriveRegionTopologySignatureV2(plan, 'room');
  plan.walkableSurfaces[1].bounds.min.x += 5;
  plan.walkableSurfaces[1].bounds.max.x += 5;
  assert.notEqual(deriveRegionTopologySignatureV2(plan, 'room'), before);
});

test('fixture names, materials, and small prop substitutions cannot manufacture topology uniqueness', () => {
  const plan = topologyPlan();
  const before = deriveRegionTopologySignatureV2(plan, 'room');
  plan.structuralFixtures[0].id = 'fixture.completely-different-label';
  plan.structuralFixtures[0].type = 'decorative-metadata-only-prop';
  plan.structuralFixtures[0].materialProfileId = 'different-material';
  plan.structuralFixtures.push({
    id: 'fixture.small-block-substitution',
    regionId: 'room',
    type: 'small-block',
    bounds: { min: { x: -1, y: 2, z: -1 }, max: { x: 1, y: 3, z: 1 } },
  });
  assert.equal(deriveRegionTopologySignatureV2(plan, 'room'), before);
});

test('physical uniqueness validation rejects a relabeled room with substituted props', () => {
  const plan = topologyPlan();
  const surfaceIdMap = new Map(plan.walkableSurfaces.map(({ id }) => [id, `copy.${id}`]));
  plan.regions.push({
    ...structuredClone(plan.regions[0]),
    id: 'room-copy',
    displayName: 'Metadata-only replacement room',
    topologySignature: 'claimed-different-signature',
  });
  plan.spatialCells.push(...plan.spatialCells.map((entry) => ({
    ...structuredClone(entry),
    id: `copy.${entry.id}`,
    regionId: 'room-copy',
  })));
  plan.walkableSurfaces.push(...plan.walkableSurfaces.map((entry) => ({
    ...structuredClone(entry),
    id: surfaceIdMap.get(entry.id),
    cellId: `copy.${entry.cellId}`,
    regionId: 'room-copy',
  })));
  plan.structuralFixtures.push({
    id: 'fixture.copy.unrelated-prop-substitution',
    regionId: 'room-copy',
    type: 'different-small-prop',
    bounds: { min: { x: -2, y: 2, z: -2 }, max: { x: 2, y: 3, z: 2 } },
  });
  plan.portals.push({
    ...structuredClone(plan.portals[0]),
    id: 'portal.copy',
    from: { ...structuredClone(plan.portals[0].from), regionId: 'room-copy' },
  });
  plan.mechanisms.push({
    ...structuredClone(plan.mechanisms[0]),
    id: 'mechanism.copy',
    regionId: 'room-copy',
  });
  plan.environmentStates = [];
  plan.traversalLinks.push(...plan.traversalLinks.map((entry) => ({
    ...structuredClone(entry),
    id: `copy.${entry.id}`,
    regionId: 'room-copy',
    fromSurfaceId: surfaceIdMap.get(entry.fromSurfaceId),
    toSurfaceId: surfaceIdMap.get(entry.toSurfaceId),
    viaSurfaceId: surfaceIdMap.get(entry.viaSurfaceId),
  })));

  const validation = validatePhysicalPlayableGeometryUniquenessV2(plan);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, regionIds }) => (
    code === 'physical-playable-geometry-reused'
    && regionIds.includes('room')
    && regionIds.includes('room-copy')
  )));
});

test('golden validation rejects a self-authored signature that disagrees with physical topology', () => {
  const plan = structuredClone(createGoldenDungeonPlanV2({
    seed: 'derived-signature-negative',
    undercroftType: 'magma',
  }));
  plan.regions[0].topologySignature = 'd4:self-authored-label';
  const result = validateDungeonPlanV2(plan);
  assert.equal(result.accepted, false);
  assert.ok(result.errors.some((entry) => entry.code === 'topology-signature-not-derived'));
});
