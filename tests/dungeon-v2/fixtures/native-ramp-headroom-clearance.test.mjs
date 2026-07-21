import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import {
  auditLegacyFixedRoomRampHeadroomV2,
  cloneLegacyFixedRoomModuleV2,
  getLegacyFixedRoomModuleV2,
} from '../../../src/dungeon-v2/LegacyFixedRoomModuleCatalogV2.js';
import { toLegacyFixedRoomWorldIdV2 } from '../../../src/dungeon-v2/LegacyFixedRoomIdsV2.js';

const PLACEMENT_ID = 'placement.assembly';
const DESCRIPTOR_ID = 'v1-room.machine-factory';
const RAMP_ROUTE_ID = 'ramp.machine-factory.west-catwalk';
const MINIMUM_HEADROOM = 3.2;
const MAXIMUM_SAMPLE_SPACING = 0.21;
const REMOVED_OVERHEAD_LOCAL_IDS = Object.freeze([
  'surface.v1-room.machine-factory.-8.4.1',
  'surface.v1-room.machine-factory.-8.3.1',
  'surface.v1-room.machine-factory.-8.2.1',
  'surface.v1-room.machine-factory.-8.1.1',
  'surface.v1-room.machine-factory.-8.0.1',
  'surface.v1-room.machine-factory.-8.-1.1',
  'surface.v1-room.machine-factory.-8.-2.1',
  'surface.v1-room.machine-factory.-8.-3.1',
]);

function containsPlanarPoint(bounds, x, z, epsilon = 1e-6) {
  return x > bounds.min.x + epsilon && x < bounds.max.x - epsilon
    && z > bounds.min.z + epsilon && z < bounds.max.z - epsilon;
}

function planarBounds(record) {
  if (record.bounds?.min && record.bounds?.max) return record.bounds;
  return {
    min: {
      x: record.center.x - record.size.x * 0.5,
      y: record.topY - record.size.y,
      z: record.center.z - record.size.z * 0.5,
    },
    max: {
      x: record.center.x + record.size.x * 0.5,
      y: record.topY,
      z: record.center.z + record.size.z * 0.5,
    },
  };
}

function assertPlanRampHeadroom(plan, assembly) {
  const rampSurfaces = plan.walkableSurfaces.filter((surface) => (
    surface.presentationOwnerId === PLACEMENT_ID
    && surface.shape === 'ramp-tile'
    && surface.ramp?.routeId === RAMP_ROUTE_ID
  ));
  assert.equal(rampSurfaces.length, 11, 'the authored V1 incline must retain all eleven ramp tiles');

  const ceilingBoundaries = plan.structuralBoundaries.filter((boundary) => (
    boundary.presentationOwnerId === PLACEMENT_ID && boundary.side === 'ceiling'
  ));
  assert.ok(ceilingBoundaries.length > 0, 'the ramp remains beneath an opaque plan-owned ceiling');
  const blockingBounds = [
    ...plan.walkableSurfaces
      .filter((surface) => surface.ramp?.routeId !== RAMP_ROUTE_ID)
      .map((record) => ({ id: record.id, bounds: planarBounds(record) })),
    ...plan.structuralBoundaries.map((record) => ({ id: record.id, bounds: planarBounds(record) })),
    ...plan.structuralFixtures.flatMap((fixture) => (
      (fixture.colliderBounds?.length ? fixture.colliderBounds : fixture.bounds ? [fixture.bounds] : [])
        .map((bounds, index) => ({ id: `${fixture.id}/collider-${index + 1}`, bounds }))
    )),
  ];

  let minimumObservedHeadroom = Number.POSITIVE_INFINITY;
  let sampledPositions = 0;
  for (const ramp of rampSurfaces) {
    const direction = ramp.ramp.direction;
    const runLength = Math.abs(direction.x) > 0.5 ? ramp.size.x : ramp.size.z;
    const steps = Math.ceil(runLength / MAXIMUM_SAMPLE_SPACING);
    assert.ok(runLength / steps <= MAXIMUM_SAMPLE_SPACING + 1e-9);
    for (let index = 0; index < steps; index += 1) {
      const progress = (index + 0.5) / steps;
      const along = (progress - 0.5) * runLength;
      const x = ramp.center.x + direction.x * along;
      const z = ramp.center.z + direction.z * along;
      const rampY = ramp.ramp.startY + (ramp.ramp.endY - ramp.ramp.startY) * progress;
      const ceiling = ceilingBoundaries.find(({ bounds }) => containsPlanarPoint(bounds, x, z));
      assert.ok(ceiling, `${ramp.id} sample (${x}, ${z}) exposes an unsupported opening or exterior void`);
      assert.ok(assembly.structuralRegistry.getCollider(ceiling.id), `${ceiling.id} lacks ceiling collision`);
      assert.ok(assembly.structuralRegistry.getVisual(ceiling.id), `${ceiling.id} lacks opaque ceiling presentation`);

      let overheadY = Number.POSITIVE_INFINITY;
      let blockerId = null;
      for (const blocker of blockingBounds) {
        if (!containsPlanarPoint(blocker.bounds, x, z) || blocker.bounds.max.y <= rampY + 1e-6) continue;
        const candidateY = blocker.bounds.min.y > rampY ? blocker.bounds.min.y : rampY;
        if (candidateY < overheadY) {
          overheadY = candidateY;
          blockerId = blocker.id;
        }
      }
      const headroom = overheadY - rampY;
      minimumObservedHeadroom = Math.min(minimumObservedHeadroom, headroom);
      sampledPositions += 1;
      assert.ok(headroom + 1e-6 >= MINIMUM_HEADROOM,
        `${ramp.id} has only ${headroom.toFixed(4)}m headroom beneath ${blockerId}`);
    }
  }
  assert.ok(sampledPositions > 100, 'actual ramp proof must sample the complete incline, not sparse waypoints');
  assert.ok(minimumObservedHeadroom >= MINIMUM_HEADROOM);
  return { rampSurfaces, minimumObservedHeadroom, sampledPositions };
}

for (const undercroftType of ['magma', 'electrical']) {
  test(`${undercroftType} actual seed removes both visual and collision tiles above the native V1 Assembly ramp`, () => {
    const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
      seed: `m1-golden-${undercroftType}`,
      undercroftType,
    }), { throwOnError: false });
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    const plan = validation.plan;
    const placement = plan.modulePlacements.find(({ id }) => id === PLACEMENT_ID);
    assert.equal(placement?.descriptorId, DESCRIPTOR_ID);
    const assembly = assembleDungeonPlanV2(plan);
    try {
      const mappings = assembly.legacyFixedRoomVisualMappings.filter(({ placementId }) => (
        placementId === PLACEMENT_ID
      ));
      const mappedLocalIds = new Set(mappings.map(({ localContractId }) => localContractId));
      const planLocalIds = new Set(plan.walkableSurfaces
        .filter(({ presentationOwnerId }) => presentationOwnerId === PLACEMENT_ID)
        .map(({ localId }) => localId));
      for (const localId of REMOVED_OVERHEAD_LOCAL_IDS) {
        const worldId = toLegacyFixedRoomWorldIdV2(PLACEMENT_ID, localId);
        assert.equal(planLocalIds.has(localId), false, `${localId} survived in the accepted plan`);
        assert.equal(mappedLocalIds.has(localId), false, `${localId} retained a rendered V1 tile`);
        assert.equal(assembly.structuralRegistry.byPlanId.has(worldId), false,
          `${localId} retained visual/collider registration`);
        assert.equal(assembly.structuralRegistry.getVisual(worldId), null, `${localId} retained a visual`);
        assert.equal(assembly.structuralRegistry.getCollider(worldId), null, `${localId} retained collision`);
      }

      const proof = assertPlanRampHeadroom(plan, assembly);
      const descriptor = getLegacyFixedRoomModuleV2(DESCRIPTOR_ID);
      const clearance = descriptor.floorTopology.rampHeadroomClearances.find(({ routeId }) => (
        routeId === RAMP_ROUTE_ID
      ));
      assert.ok(clearance);
      assert.equal(clearance.minimumHeadroom, MINIMUM_HEADROOM);
      assert.equal(clearance.sampleSpacing, MAXIMUM_SAMPLE_SPACING);
      assert.deepEqual(clearance.removedOverheadSurfaces.map(({ id }) => id), REMOVED_OVERHEAD_LOCAL_IDS);
      assert.equal(clearance.overheadSurfacePolicy, 'remove-or-split-plan-owned-visual-and-collider');
      assert.equal(clearance.enclosurePolicy, 'retain-opaque-colliding-module-ceiling');

      const rampByLocalId = new Map(proof.rampSurfaces.map((surface) => [surface.localId, surface]));
      for (const removed of clearance.removedOverheadSurfaces) {
        assert.equal(removed.coveringRampSurfaceIds.length, 1);
        const ramp = rampByLocalId.get(removed.coveringRampSurfaceIds[0]);
        assert.ok(ramp, `${removed.id} does not open onto its authored playable ramp`);
        assert.ok(ramp.supportFixtureIds?.length > 0, `${ramp.id} is unsupported beneath the deck cut`);
        assert.ok(assembly.structuralRegistry.getVisual(ramp.id), `${ramp.id} lacks visible support surface`);
        assert.ok(assembly.structuralRegistry.getCollider(ramp.id), `${ramp.id} lacks walkable collision`);
      }

      const upperLandingId = toLegacyFixedRoomWorldIdV2(PLACEMENT_ID, clearance.upperLandingSurfaceId);
      const upperLanding = plan.walkableSurfaces.find(({ id }) => id === upperLandingId);
      assert.ok(upperLanding, 'authored upper landing was removed with the overhead tiles');
      assert.ok(Math.abs(upperLanding.topY - Math.max(...proof.rampSurfaces.flatMap(({ ramp }) => (
        [ramp.startY, ramp.endY]
      )))) <= 0.05, 'upper landing is not flush with the ramp endpoint');
      assert.ok(upperLanding.supportFixtureIds?.length > 0, 'upper landing lost its visible structural support');
      assert.ok(assembly.structuralRegistry.getVisual(upperLanding.id), 'upper landing lost its rendered tile');
      assert.ok(assembly.structuralRegistry.getCollider(upperLanding.id), 'upper landing lost collision');
    } finally {
      assembly.dispose();
    }
  });
}

test('negative fixture rejects a reintroduced over-ramp deck visual/collider contract', () => {
  const module = cloneLegacyFixedRoomModuleV2(DESCRIPTOR_ID);
  const clearance = module.floorTopology.rampHeadroomClearances.find(({ routeId }) => (
    routeId === RAMP_ROUTE_ID
  ));
  const removed = clearance.removedOverheadSurfaces[0];
  module.floorTopology.walkableSurfaces.push({
    ...removed,
    shape: 'tile',
    type: 'floor',
    collision: { mode: 'walkable', supportsGroundedTraversal: true },
    support: { style: 'v1-authored-structural-support', visible: true },
    purpose: 'negative-over-ramp-deck',
  });
  const audit = auditLegacyFixedRoomRampHeadroomV2(module);
  assert.equal(audit.accepted, false);
  assert.ok(audit.errors.some(({ code }) => code === 'ramp-overhead-surface-still-present'));
  assert.ok(audit.errors.some(({ code }) => code === 'ramp-headroom-insufficient'));
});

test('negative fixture rejects a deck cut that opens above missing ramp support', () => {
  const module = cloneLegacyFixedRoomModuleV2(DESCRIPTOR_ID);
  const clearance = module.floorTopology.rampHeadroomClearances.find(({ routeId }) => (
    routeId === RAMP_ROUTE_ID
  ));
  const missingRampId = clearance.removedOverheadSurfaces[0].coveringRampSurfaceIds[0];
  module.floorTopology.walkableSurfaces = module.floorTopology.walkableSurfaces.filter(({ id }) => (
    id !== missingRampId
  ));
  const audit = auditLegacyFixedRoomRampHeadroomV2(module);
  assert.equal(audit.accepted, false);
  assert.ok(audit.errors.some(({ code }) => code === 'ramp-headroom-clearance-unsupported-opening'));
});

test('negative fixture rejects a clear ramp whose enclosing ceiling is absent', () => {
  const module = cloneLegacyFixedRoomModuleV2(DESCRIPTOR_ID);
  module.structuralBoundaries = module.structuralBoundaries.filter(({ side }) => side !== 'ceiling');
  const audit = auditLegacyFixedRoomRampHeadroomV2(module);
  assert.equal(audit.accepted, false);
  assert.ok(audit.errors.some(({ code }) => code === 'ramp-headroom-clearance-not-enclosed'));
});
