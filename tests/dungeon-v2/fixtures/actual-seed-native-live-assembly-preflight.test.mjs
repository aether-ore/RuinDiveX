import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { LEGACY_FIXED_ROOM_MODULE_CATALOG_V2 } from '../../../src/dungeon-v2/LegacyFixedRoomModuleCatalogV2.js';
import {
  assertAcceptedDungeonFixture,
  assertGoldenProductionStateSolver,
} from '../helpers/accepted-fixture.mjs';
import {
  createRealRoomPackRuntime,
  getRealRoomPackRuntimeDiagnostics,
} from '../helpers/real-room-pack-runtime.mjs';
import {
  EXPECTED_PACK_ID,
  REQUIRED_PACK_ROOM_IDS,
} from '../unit/authored-room-pack-test-support.mjs';

const CATALOG_BY_DESCRIPTOR_ID = new Map(
  LEGACY_FIXED_ROOM_MODULE_CATALOG_V2.map((descriptor) => [descriptor.id, descriptor]),
);
const EXPECTED_DESCRIPTOR_IDS = Object.freeze(
  LEGACY_FIXED_ROOM_MODULE_CATALOG_V2.map(({ id }) => id).sort(),
);
const EXPECTED_REGION_IDS = Object.freeze(
  LEGACY_FIXED_ROOM_MODULE_CATALOG_V2
    .flatMap(({ semanticRegions }) => semanticRegions.map(({ id }) => id))
    .sort(),
);
const EXPECTED_SOURCE_ROOM_IDS = Object.freeze([
  'entrance',
  'enemyNest',
  'keycardRoom',
  'alienServerRoom',
  'machineFactoryRoom',
  'conveyorRoom',
  'bonusVault',
  'bossRoom',
  'shrineRoom',
  'coolantRelayRoom',
  'trapRoom',
].sort());

function sorted(values) {
  return [...values].sort();
}

function expectedPackRoomIds(undercroftType) {
  return [
    ...REQUIRED_PACK_ROOM_IDS,
    undercroftType === 'magma'
      ? 'rdx_magma_foundry_undercroft'
      : 'rdx_electric_transformer_undercroft',
  ].sort();
}

for (const undercroftType of ['magma', 'electrical']) {
  test(`${undercroftType} actual seed exposes eleven native rooms and three authored macros through live diagnostics`, async () => {
    const seed = `m1-golden-${undercroftType}`;
    const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({ seed, undercroftType }), {
      throwOnError: false,
    });
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    const plan = validation.plan;
    assertAcceptedDungeonFixture(plan, { stage: 'plan', profile: 'golden' });
    const solver = assertGoldenProductionStateSolver(plan);
    assert.ok(solver.visitedStates > 0 && solver.evaluatedTransitions > 0,
      'actual-seed preflight did not independently solve the full production state graph');
    const planPlacements = plan.modulePlacements.filter(({ descriptorId }) => (
      CATALOG_BY_DESCRIPTOR_ID.has(descriptorId)
    ));
    assert.equal(plan.modulePlacements.length, 14,
      'the live actual seed must contain exactly eleven native rooms plus three authored macros');
    assert.equal(planPlacements.length, 11,
      'the actual seeded plan must contain every catalogued V1 room exactly once');
    assert.equal(new Set(planPlacements.map(({ id }) => id)).size, 11);
    assert.deepEqual(sorted(planPlacements.map(({ descriptorId }) => descriptorId)), EXPECTED_DESCRIPTOR_IDS);
    assert.deepEqual(sorted(planPlacements.map(({ descriptorId }) => (
      CATALOG_BY_DESCRIPTOR_ID.get(descriptorId).sourceRoom.id
    ))), EXPECTED_SOURCE_ROOM_IDS,
    'actual live assembly must originate from the exact eleven fixed V1 source rooms');
    assert.equal(EXPECTED_REGION_IDS.length, 17);
    assert.equal(new Set(EXPECTED_REGION_IDS).size, 17);
    assert.deepEqual(sorted(plan.regions.map(({ id }) => id)), EXPECTED_REGION_IDS);
    for (const placement of planPlacements) {
      const expectedRegions = sorted(
        CATALOG_BY_DESCRIPTOR_ID.get(placement.descriptorId).semanticRegions.map(({ id }) => id),
      );
      assert.deepEqual(sorted(placement.semanticRegionIds), expectedRegions,
        `${placement.id} does not retain its catalog semantic-region mapping`);
      assert.deepEqual(sorted(placement.regionIds), expectedRegions,
        `${placement.id} runtime region ownership differs from its catalog mapping`);
    }

    const packPlacements = plan.semanticRoomPackPlacements;
    assert.ok(Array.isArray(packPlacements));
    assert.equal(packPlacements.length, 3);
    assert.equal(new Set(packPlacements.map(({ id }) => id)).size, 3);
    assert.deepEqual(sorted(packPlacements.map(({ roomId }) => roomId)), expectedPackRoomIds(undercroftType));
    assert.equal(packPlacements.every(({ packId }) => packId === EXPECTED_PACK_ID), true);
    const moduleById = new Map(plan.modulePlacements.map((placement) => [placement.id, placement]));
    assert.equal(moduleById.size, 14);
    assert.deepEqual(
      sorted(plan.modulePlacements
        .filter(({ descriptorId }) => !CATALOG_BY_DESCRIPTOR_ID.has(descriptorId))
        .map(({ id }) => id)),
      sorted(packPlacements.map(({ id }) => id)),
      'the three non-native module placements must be the three authored room-pack macros',
    );
    for (const placement of packPlacements) {
      const modulePlacement = moduleById.get(placement.id);
      assert.ok(modulePlacement, `${placement.id} is not a live module placement`);
      assert.equal(modulePlacement.roomId, placement.roomId);
      assert.equal(modulePlacement.packId, placement.packId);
      assert.ok((modulePlacement.occupiedCellIds ?? []).length > 0,
        `${placement.id} does not own a physical spatial cell`);
      assert.ok(placement.placedRecordIds.structuralBoundaryIds.length > 0,
        `${placement.id} has no authored enclosure records`);
      assert.ok(placement.placedRecordIds.walkableSurfaceIds.length > 0,
        `${placement.id} has no authored walkable records`);
      assert.ok(placement.placedRecordIds.structuralFixtureIds.length > 0,
        `${placement.id} has no authored structural fixtures`);
      assert.equal(placement.placedRecordIds.colliderIds.length,
        placement.transformedCollisionVolumes.length,
        `${placement.id} collider ledger does not cover its manifest collision volumes`);
    }

    const roomPackRuntime = await createRealRoomPackRuntime(packPlacements.map(({ roomId }) => roomId));
    const realAssetAudit = getRealRoomPackRuntimeDiagnostics(roomPackRuntime);
    assert.equal(realAssetAudit.loaderIsGLTFLoader, true);
    assert.equal(realAssetAudit.parser, 'three/addons/loaders/GLTFLoader.parseAsync');
    assert.deepEqual(realAssetAudit.loadedRoomIds, expectedPackRoomIds(undercroftType));
    assert.equal(realAssetAudit.loads.length, 3);
    assert.equal(realAssetAudit.loads.every(({ byteLength, nodeCount, meshCount, sceneParsed }) => (
      byteLength > 0 && nodeCount > 0 && meshCount > 0 && sceneParsed === true
    )), true, 'preflight did not parse every selected GLB into a real Three.js scene');
    const facade = assembleDungeonPlanV2(plan, {
      semanticRoomPackPresentationRuntime: roomPackRuntime,
    });
    try {
      const diagnostics = facade.environmentRuntime.getDiagnostics('runtime');
      const native = diagnostics.nativeFixedRoomAssembly;
      assert.ok(native, 'runtime diagnostics omitted the live native-room assembly preflight');
      assert.equal(JSON.parse(JSON.stringify(native)).activePlacementCount, 11,
        'native-room diagnostics must remain a small serializable public snapshot');
      assert.equal(native.requiredPlacementCount, 11);
      assert.equal(native.activePlacementCount, 11);
      assert.equal(native.incompleteDescriptorCount, 0);
      assert.equal(native.allRequiredPlacementsActive, true);
      assert.equal(native.presentationActive, true);
      assert.equal(native.presentationPlacementCount, 11);
      assert.equal(native.genericFallbackGeometry, false);
      assert.deepEqual(sorted(native.activePlacementIds), sorted(planPlacements.map(({ id }) => id)));
      assert.deepEqual(sorted(native.activeDescriptorIds), EXPECTED_DESCRIPTOR_IDS);
      assert.deepEqual(native.incompleteDescriptorIds, []);
      assert.equal(native.placements.length, 11);
      assert.deepEqual(sorted(native.placements.map(({ placementId }) => placementId)),
        sorted(planPlacements.map(({ id }) => id)));
      assert.deepEqual(sorted(native.placements.map(({ descriptorId }) => descriptorId)),
        EXPECTED_DESCRIPTOR_IDS);

      for (const placement of native.placements) {
        assert.equal(placement.renderGroupAttached, true,
          `${placement.placementId} native render group is detached from the live dungeon`);
        assert.equal(placement.renderGroupVisible, true,
          `${placement.placementId} native render group is hidden in the live dungeon`);
        assert.ok(placement.renderedObjectCount > 0,
          `${placement.placementId} has no attached rendered object`);
        assert.ok(placement.visibleRenderedObjectCount > 0,
          `${placement.placementId} has no visible rendered object`);
        assert.ok(placement.visualMappingCount > 0,
          `${placement.placementId} has no plan-to-render mappings`);
        assert.ok(placement.registeredMappedVisualCount > 0,
          `${placement.placementId} has no registered native visual`);
        assert.equal(placement.attachedMappedVisualCount, placement.registeredMappedVisualCount,
          `${placement.placementId} has registered native visuals detached from the dungeon`);
        assert.equal(placement.visibleMappedVisualCount, placement.registeredMappedVisualCount,
          `${placement.placementId} has registered native visuals hidden at startup`);
        assert.ok(placement.planSurfaceCount > 0,
          `${placement.placementId} has no accepted native walkable surface`);
        assert.equal(placement.registeredSurfaceCount, placement.planSurfaceCount,
          `${placement.placementId} lacks registered collision for an accepted native surface`);
        assert.ok(placement.registeredColliderCount > 0,
          `${placement.placementId} has no registered native collision`);
      }

      const pack = facade.semanticRoomPackPresentationDiagnostics;
      assert.ok(pack, 'live facade omitted room-pack presentation diagnostics');
      assert.equal(pack.accepted, true);
      assert.equal(pack.active, true);
      assert.equal(pack.placementCount, 3);
      assert.equal(pack.placements.length, 3);
      assert.equal(pack.genericFallbackGeometry, false);
      assert.equal(pack.collisionDerivedFromMeshBounds, false);
      assert.equal(pack.collisionAuthority, 'accepted-plan-semantic-room-pack-records');
      assert.deepEqual(
        sorted(pack.placements.map(({ placementId }) => placementId)),
        sorted(packPlacements.map(({ id }) => id)),
      );
      for (const placement of pack.placements) {
        assert.ok(placement.mappedPhysicalRecordCount > 0,
          `${placement.placementId} has no real-GLB physical mappings`);
        assert.ok(placement.boundaryCount > 0, `${placement.placementId} has no mapped enclosure`);
        assert.ok(placement.surfaceCount > 0, `${placement.placementId} has no mapped walkable surface`);
        assert.ok(placement.fixtureCount > 0, `${placement.placementId} has no mapped fixture`);
      }
    } finally {
      facade.dispose();
    }
  });
}
