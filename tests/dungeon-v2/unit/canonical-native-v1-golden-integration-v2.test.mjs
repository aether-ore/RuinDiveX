import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import {
  integrateCanonicalNativeV1GoldenPhysicalCompositionV2,
} from '../../../src/dungeon-v2/CanonicalNativeV1GoldenIntegrationV2.js';
import {
  integrateSemanticRoomPackProductionV2,
} from '../../../src/dungeon-v2/SemanticRoomPackProductionIntegrationV2.js';
import {
  relocateSemanticRoomPackAnnexesV2,
} from '../../../src/dungeon-v2/SemanticRoomPackAnnexRelocationV2.js';
import { LEGACY_FIXED_ROOM_MODULE_IDS_V2 } from '../../../src/dungeon-v2/LegacyFixedRoomModuleCatalogV2.js';
import { isSerializablePlanValue } from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';

const PACK_PLACEMENT_IDS = Object.freeze([
  'placement.semantic-room-pack.factory-corkscrew',
  'placement.semantic-room-pack.waterworks-freight-sump',
  'placement.semantic-room-pack.undercroft',
]);

function createPreCanonicalGoldenPlan(undercroftType) {
  const plan = structuredClone(createGoldenDungeonPlanV2({
    seed: `canonical-native-coexistence-unit-${undercroftType}`,
    undercroftType,
    deferSemanticRoomPackIntegration: true,
  }));
  integrateSemanticRoomPackProductionV2(plan, { validateDungeon: false });
  relocateSemanticRoomPackAnnexesV2(plan);
  return plan;
}

function installStandaloneFreightCatchment(plan) {
  const portal = plan.portals.find(({ id }) => id === 'portal.assembly-freight-drop');
  assert.ok(portal, 'standalone composition proof requires the stable Freight drop portal');
  const center = portal.to.center;
  const floorY = Math.min(portal.to.elevation - 2.65, portal.from.elevation - 5.4);
  const bounds = {
    min: { x: center.x - 3.6, y: floorY, z: center.z - 3.6 },
    max: { x: center.x + 3.6, y: floorY + 4.2, z: center.z + 3.6 },
  };
  const cellId = 'cell.canonical.freight-catchment';
  const surfaceId = 'surface.canonical.freight-catchment';
  const boundaryIds = ['north', 'south', 'east', 'west', 'floor', 'ceiling']
    .map((side) => `boundary.canonical.freight-catchment.${side}`);
  plan.spatialCells.push({
    id: cellId,
    regionId: 'freight',
    semanticRegionIds: ['freight'],
    bounds,
    playable: true,
    interior: true,
    cameraContained: true,
    occupiedVolume: true,
    compoundId: 'compound.native-v1.machine',
    nativeFixedRoomPlacementId: 'placement.machine',
  });
  for (const [index, side] of ['north', 'south', 'east', 'west', 'floor', 'ceiling'].entries()) {
    plan.structuralBoundaries.push({
      id: boundaryIds[index],
      cellId,
      regionId: 'freight',
      side,
      kind: 'solid',
      bounds,
      openings: [],
      opaque: true,
      collider: true,
      collision: 'static',
    });
  }
  plan.walkableSurfaces.push({
    id: surfaceId,
    cellId,
    regionId: 'freight',
    bounds: {
      min: { x: bounds.min.x, y: floorY, z: bounds.min.z },
      max: { x: bounds.max.x, y: floorY + 0.2, z: bounds.max.z },
    },
    purpose: 'standalone-test authored Freight catchment',
    supportBoundaryIds: [boundaryIds[4]],
    supportFixtureIds: [],
    collision: 'static',
    createsLedgeCandidates: false,
  });
  portal.to = {
    ...portal.to,
    cellId,
    boundaryId: boundaryIds[5],
    center: { x: center.x, y: bounds.max.y, z: center.z },
    elevation: floorY + 0.2,
  };
  portal.physicalRoute ??= {};
  portal.physicalRoute.endpointSurfaceIds ??= {};
  portal.physicalRoute.endpointSurfaceIds.to = surfaceId;
}

function strictStandaloneRouteProof(plan, { composition, bundles, packOwnership }) {
  assert.equal(composition.placements.length, 11);
  assert.equal(composition.connections.length, 14);
  assert.equal(bundles.length, 11);
  assert.equal(plan.modulePlacements.length, 14,
    'the coordinator must receive the complete coexistence placement set');
  assert.equal(bundles.every(({ physicalCell, boundaries, surfaces, fixtures }) => (
    physicalCell.occupiedVolume === true
      && boundaries.length > 0
      && surfaces.length > 0
      && fixtures.length > 0
  )), true, 'each V1 room handed to the coordinator needs physical plan contracts');
  for (const placementId of PACK_PLACEMENT_IDS) {
    assert.equal(packOwnership.placementIds.has(placementId), true,
      `${placementId} is absent from the coordinator's preserved ownership set`);
  }
  installStandaloneFreightCatchment(plan);
  const routedPortalIds = plan.portals.map(({ id }) => id).sort();
  assert.equal(routedPortalIds.length, 21,
    'the standalone proof must enumerate every stable Golden portal');
  return {
    accepted: true,
    diagnosticHash: 'unit-authoritative-route-proof',
    physicalRouteCount: routedPortalIds.length,
    routedPortalIds,
    unresolved: [],
  };
}

test('canonical coexistence atomically owns eleven V1 rooms plus three preserved pack macros', () => {
  const plan = createPreCanonicalGoldenPlan('magma');
  const packRecordIds = new Set(plan.semanticRoomPackPlacements.flatMap(({ placedRecordIds }) => [
    ...(placedRecordIds.structuralBoundaryIds ?? []),
    ...(placedRecordIds.walkableSurfaceIds ?? []),
    ...(placedRecordIds.structuralFixtureIds ?? []),
  ]));

  const ledger = integrateCanonicalNativeV1GoldenPhysicalCompositionV2(plan, {
    rebuildCanonicalConnections: strictStandaloneRouteProof,
  });
  assert.equal(ledger.nativePlacementCount, 11);
  assert.equal(ledger.semanticPackPlacementCount, 3);
  assert.equal(ledger.totalAuthoredPlacementCount, 14);
  assert.equal(plan.modulePlacements.length, 14);
  assert.deepEqual(
    new Set(plan.modulePlacements.map(({ descriptorId }) => descriptorId)
      .filter((id) => LEGACY_FIXED_ROOM_MODULE_IDS_V2.includes(id))),
    new Set(LEGACY_FIXED_ROOM_MODULE_IDS_V2),
  );
  assert.deepEqual(plan.nativeFixedRoomIntegration.incompleteDescriptorIds, []);
  assert.equal(plan.nativeFixedRoomIntegration.genericFallbackGeometry, false);
  assert.equal(new Set(plan.canonicalNativeV1Coexistence.semanticRegionIds).size, 17);
  assert.equal(Object.isFrozen(ledger), true);
  assert.equal(Object.isFrozen(ledger.nativePlacementIds), true);
  assert.equal(isSerializablePlanValue(ledger), true);
  assert.deepEqual(
    plan.modulePlacements
      .filter(({ id }) => PACK_PLACEMENT_IDS.includes(id))
      .map(({ id }) => id)
      .sort(),
    PACK_PLACEMENT_IDS.slice().sort(),
    'each selected authored room-pack macro must coexist exactly once',
  );

  const nativePlacementIds = new Set(plan.nativeFixedRoomIntegration.activePlacementIds);
  assert.equal(nativePlacementIds.size, 11);
  assert.equal(plan.regions.length, 17);
  for (const region of plan.regions) {
    assert.equal(nativePlacementIds.has(region.modulePlacementId), true,
      `${region.id} is not owned by one of the eleven canonical V1 rooms`);
    assert.equal(region.cellIds.length, 1,
      `${region.id} must resolve to one shared physical V1 room`);
    const physicalShell = plan.spatialCells.find(({ id }) => id === region.cellIds[0]);
    assert.equal(physicalShell?.occupiedVolume, true,
      `${region.id} has no shared occupied V1 physical shell`);
    assert.equal(physicalShell?.semanticRegionIds.includes(region.id), true,
      `${region.id} is absent from its physical shell's semantic ownership`);
    assert.equal(region.subRegions.length, 1);
    assert.equal(region.subRegions[0].cellId, physicalShell.id);
    assert.ok(region.subRegions[0].surfaceIds.length > 0,
      `${region.id} has no authored V1 surfaces in its semantic zone`);
  }
  const survivingRecordIds = new Set([
    ...plan.structuralBoundaries.map(({ id }) => id),
    ...plan.walkableSurfaces.map(({ id }) => id),
    ...plan.structuralFixtures.map(({ id }) => id),
  ]);
  for (const id of packRecordIds) {
    assert.ok(survivingRecordIds.has(id), `pack-owned physical record ${id} was discarded`);
  }
  assert.equal(plan.modulePlacements.some(({ descriptorId }) => (
    /^module\..+\.golden-v1$/u.test(descriptorId ?? '')
  )), false, 'generic V2 room body modules must not survive coexistence installation');
});

test('canonical coexistence rejects a connector callback that does not physically route all twenty-one stable portals', () => {
  const plan = createPreCanonicalGoldenPlan('electrical');
  assert.throws(() => integrateCanonicalNativeV1GoldenPhysicalCompositionV2(plan, {
    rebuildCanonicalConnections(candidate) {
      installStandaloneFreightCatchment(candidate);
      const portalIds = candidate.portals.map(({ id }) => id).sort();
      return {
        accepted: true,
        physicalRouteCount: portalIds.length - 1,
        routedPortalIds: portalIds.slice(0, -1),
        unresolved: [portalIds.at(-1)],
      };
    },
  }), /connection coordinator rejected/u);
});
