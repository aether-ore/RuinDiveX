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
  buildIndependentPortalRouteProofs,
  buildMechanismStateProofs,
  buildOffscreenStructuralRenderProof,
  buildStructuralAssemblyProof,
} from '../helpers/assembly-proofs.mjs';
import {
  createRealRoomPackRuntime,
  getRealRoomPackRuntimeDiagnostics,
} from '../helpers/real-room-pack-runtime.mjs';
import {
  EXPECTED_PACK_ID,
  REQUIRED_PACK_ROOM_IDS,
  UNDERCROFT_PACK_ROOM_IDS,
} from '../unit/authored-room-pack-test-support.mjs';

export const FULL_COMPLEX_NATIVE_ACCEPTANCE_SENTINEL =
  'DUNGEON_V2_NATIVE_FULL_COMPLEX_ACCEPTANCE';

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
const CATALOG_BY_DESCRIPTOR_ID = new Map(
  LEGACY_FIXED_ROOM_MODULE_CATALOG_V2.map((descriptor) => [descriptor.id, descriptor]),
);

function sorted(values) {
  return [...values].sort();
}

function nativePlacements(plan) {
  return plan.modulePlacements.filter(({ descriptorId }) => (
    CATALOG_BY_DESCRIPTOR_ID.has(descriptorId)
  ));
}

function expectedPackRoomIds(undercroftType) {
  const undercroftRoomId = undercroftType === 'magma'
    ? 'rdx_magma_foundry_undercroft'
    : 'rdx_electric_transformer_undercroft';
  return [...REQUIRED_PACK_ROOM_IDS, undercroftRoomId].sort();
}

function assertRoomPackMacrosOwnPhysicalPlanRecords(plan, undercroftType) {
  const packPlacements = plan.semanticRoomPackPlacements;
  assert.ok(Array.isArray(packPlacements), 'accepted golden plan omitted semantic room-pack placements');
  assert.equal(packPlacements.length, 3,
    'the golden complex must contain exactly three authored room-pack macro placements');
  assert.equal(new Set(packPlacements.map(({ id }) => id)).size, 3,
    'room-pack placement IDs must be unique');
  assert.deepEqual(sorted(packPlacements.map(({ roomId }) => roomId)), expectedPackRoomIds(undercroftType));
  assert.equal(packPlacements.every(({ packId }) => packId === EXPECTED_PACK_ID), true);
  assert.equal(packPlacements.filter(({ roomId }) => UNDERCROFT_PACK_ROOM_IDS.includes(roomId)).length, 1,
    'exactly one seeded Undercroft macro must be present');

  const moduleById = new Map(plan.modulePlacements.map((placement) => [placement.id, placement]));
  assert.equal(moduleById.size, plan.modulePlacements.length, 'module placement IDs must be unique');
  const physicalCollections = [
    ['structuralBoundaryIds', plan.structuralBoundaries],
    ['walkableSurfaceIds', plan.walkableSurfaces],
    ['structuralFixtureIds', plan.structuralFixtures],
  ];
  for (const placement of packPlacements) {
    assert.equal(placement.id, placement.placementId,
      `${placement.id} must use one stable plan/module/presentation identity`);
    const modulePlacement = moduleById.get(placement.id);
    assert.ok(modulePlacement, `${placement.id} is metadata without a live module placement`);
    assert.equal(modulePlacement.roomId, placement.roomId);
    assert.equal(modulePlacement.packId, placement.packId);
    assert.ok((modulePlacement.occupiedCellIds ?? []).length > 0,
      `${placement.id} has no physically occupied plan cell`);
    for (const cellId of modulePlacement.occupiedCellIds) {
      assert.ok(plan.spatialCells.some(({ id }) => id === cellId),
        `${placement.id} cannot resolve occupied cell ${cellId}`);
    }

    const recordIds = placement.placedRecordIds;
    assert.ok(recordIds && typeof recordIds === 'object', `${placement.id} omitted physical record ownership`);
    for (const [key, records] of physicalCollections) {
      assert.ok(recordIds[key]?.length > 0, `${placement.id}.${key} must not be empty`);
      const availableIds = new Set(records.map(({ id }) => id));
      for (const id of recordIds[key]) {
        assert.ok(availableIds.has(id), `${placement.id}.${key} cannot resolve ${id}`);
      }
    }
    assert.equal(recordIds.colliderIds.length, placement.transformedCollisionVolumes.length,
      `${placement.id} must register every manifest collider exactly once`);
    assert.equal(placement.compiledPhysicalRecords.colliders, placement.transformedCollisionVolumes,
      `${placement.id} collider ownership must reference accepted transformed manifest records`);
    assert.equal(placement.collisionSourcePolicy, 'manifest-collision-volumes-only');

    const socketBindings = placement.socketBindings ?? [];
    assert.equal(socketBindings.length, placement.sockets.length,
      `${placement.id} must explicitly bind or cap every authored socket`);
    for (const binding of socketBindings) {
      assert.ok(binding.status === 'bound' || binding.status === 'capped',
        `${placement.id}:${binding.socketId} retained an unused socket`);
      if (binding.status === 'bound') {
        assert.ok(plan.portals.some(({ id }) => id === binding.portalId),
          `${placement.id}:${binding.socketId} cannot resolve portal ${binding.portalId}`);
      } else {
        assert.ok(binding.capId,
          `${placement.id}:${binding.socketId} is capped without a physical cap record`);
      }
    }
  }
  return packPlacements;
}

function assertAllNativeRoomsOwnTheGoldenRegions(plan, packPlacements) {
  const placements = nativePlacements(plan);
  const placementCount = placements.length;
  assert.equal(plan.modulePlacements.length, 14,
    'the golden complex must contain exactly eleven V1 rooms plus three authored room-pack macros');
  assert.equal(placementCount, 11,
    'the accepted golden plan must place all eleven native V1 room descriptors');
  assert.equal(new Set(placements.map(({ id }) => id)).size, 11,
    'native V1 placement IDs must be unique');
  assert.deepEqual(sorted(placements.map(({ descriptorId }) => descriptorId)), EXPECTED_DESCRIPTOR_IDS,
    'every catalog descriptor must occur exactly once');
  assert.deepEqual(sorted(placements.map(({ descriptorId }) => (
    CATALOG_BY_DESCRIPTOR_ID.get(descriptorId).sourceRoom.id
  ))), EXPECTED_SOURCE_ROOM_IDS,
  'the eleven native placements must be the exact eleven V1 fixed source rooms, not aliases');

  assert.equal(EXPECTED_REGION_IDS.length, 17,
    'the native V1 catalog must map onto exactly seventeen semantic regions');
  assert.equal(new Set(EXPECTED_REGION_IDS).size, 17,
    'the native V1 catalog cannot assign one semantic region to two rooms');
  assert.deepEqual(sorted(plan.regions.map(({ id }) => id)), EXPECTED_REGION_IDS,
    'the catalog semantic-region mapping must cover the complete golden complex');

  for (const placement of placements) {
    const descriptor = CATALOG_BY_DESCRIPTOR_ID.get(placement.descriptorId);
    const expectedRegions = sorted(descriptor.semanticRegions.map(({ id }) => id));
    assert.deepEqual(sorted(placement.semanticRegionIds), expectedRegions,
      `${placement.id} does not own its catalog semantic-region mapping`);
    assert.deepEqual(sorted(placement.regionIds), expectedRegions,
      `${placement.id} runtime region ownership differs from its descriptor mapping`);
    assert.equal(placement.presentationProfileId, 'legacy-fixed-room-native-v2');
    assert.equal(placement.nativeIntegrationStatus, 'playable-plan-owned');
    assert.ok((placement.occupiedCellIds ?? []).length >= expectedRegions.length,
      `${placement.id} does not own a playable cell for every mapped region`);
    for (const regionId of expectedRegions) {
      const region = plan.regions.find(({ id }) => id === regionId);
      assert.ok(region, `${placement.id} references missing region ${regionId}`);
      assert.equal(region.cellIds.some((cellId) => placement.occupiedCellIds.includes(cellId)), true,
        `${placement.id} does not retain a native playable cell in ${regionId}`);
    }

    const physicalShellCellIds = new Set(plan.spatialCells
      .filter((cell) => (
        placement.occupiedCellIds.includes(cell.id)
        && cell.connector !== true
        && cell.semanticZone !== true
        && cell.occupiedVolume !== false
      ))
      .map(({ id }) => id));
    assert.ok(physicalShellCellIds.size > 0,
      `${placement.id} has no physical occupied shell cell`);
    assert.ok(plan.structuralBoundaries.some((boundary) => (
      physicalShellCellIds.has(boundary.cellId)
      && (boundary.presentationOwnerId === placement.id
        || boundary.nativeFixedRoomPlacementId === placement.id
        || boundary.sharedNativePlacementId === placement.id)
    )), `${placement.id} has no placement-owned physical enclosure`);

    for (const regionId of expectedRegions) {
      const logicalCells = plan.spatialCells.filter((cell) => (
        cell.regionId === regionId
        && cell.connector !== true
        && placement.occupiedCellIds.includes(cell.id)
      ));
      assert.ok(logicalCells.length > 0, `${placement.id}:${regionId} has no playable logical cell`);
      for (const cell of logicalCells.filter(({ semanticZone }) => semanticZone === true)) {
        assert.equal(cell.occupiedVolume, false,
          `${cell.id} semantic zone must not masquerade as a second overlapping shell`);
        assert.equal(cell.sharedNativePlacementId, placement.id,
          `${cell.id} does not reference its enclosing native placement`);
      }
    }
  }

  const nativeRegionIds = new Set(EXPECTED_REGION_IDS);
  const placementByRegionId = new Map();
  for (const placement of placements) {
    for (const regionId of placement.semanticRegionIds) {
      assert.equal(placementByRegionId.has(regionId), false,
        `${regionId} is assigned to more than one native room placement`);
      placementByRegionId.set(regionId, placement);
    }
  }
  const packPlacementByCellId = new Map();
  for (const packPlacement of packPlacements) {
    const packModulePlacement = plan.modulePlacements.find(({ id }) => id === packPlacement.id);
    for (const cellId of [
      ...(packModulePlacement?.occupiedCellIds ?? []),
      ...(packPlacement.connectorCellIds ?? []),
    ]) {
      packPlacementByCellId.set(cellId, packPlacement);
    }
    const recordIds = new Set([
      ...(packPlacement.placedRecordIds.structuralBoundaryIds ?? []),
      ...(packPlacement.placedRecordIds.walkableSurfaceIds ?? []),
    ]);
    for (const record of [...plan.structuralBoundaries, ...plan.walkableSurfaces]) {
      if (recordIds.has(record.id) && record.cellId) packPlacementByCellId.set(record.cellId, packPlacement);
    }
  }
  const usedNativeSocketIds = new Map();
  const intentionalFallPortalIds = new Set(plan.falls.map(({ portalId }) => portalId).filter(Boolean));
  for (const portal of plan.portals) {
    const fromPlacement = placementByRegionId.get(portal.from.regionId);
    const toPlacement = placementByRegionId.get(portal.to.regionId);
    assert.ok(fromPlacement && toPlacement,
      `${portal.id} endpoint lacks native room ownership`);
    const fromPackPlacement = packPlacementByCellId.get(portal.from.cellId);
    const toPackPlacement = packPlacementByCellId.get(portal.to.cellId);
    const fromPhysicalPlacementId = fromPackPlacement?.id ?? fromPlacement.id;
    const toPhysicalPlacementId = toPackPlacement?.id ?? toPlacement.id;
    if (fromPlacement.id === toPlacement.id && !fromPackPlacement && !toPackPlacement) {
      assert.equal(intentionalFallPortalIds.has(portal.id), true,
        `${portal.id} retained an internal same-room connector instead of a direct traversal link`);
    }
    for (const [endpointName, endpoint, owner, packOwner] of [
      ['from', portal.from, fromPlacement, fromPackPlacement],
      ['to', portal.to, toPlacement, toPackPlacement],
    ]) {
      if (packOwner) {
        assert.ok(packOwner.socketBindings.some((binding) => (
          binding.status === 'bound'
          && binding.portalId === portal.id
          && (!binding.endpointName || binding.endpointName === endpointName)
        )), `${portal.id}:${endpointName} is in ${packOwner.id} but is not bound to an authored pack socket`);
        continue;
      }
      if (fromPhysicalPlacementId !== toPhysicalPlacementId) {
        assert.equal(typeof endpoint.nativeFixedRoomSocketId, 'string',
          `${portal.id}:${endpointName} is not bound to a physical native socket`);
      }
      if (!endpoint.nativeFixedRoomSocketId) continue;
      assert.equal(owner.openSocketIds.includes(endpoint.nativeFixedRoomSocketId), true,
        `${portal.id}:${endpointName} uses a socket not opened by ${owner.id}`);
      const previousEndpoint = usedNativeSocketIds.get(endpoint.nativeFixedRoomSocketId);
      assert.equal(previousEndpoint, undefined,
        `${endpoint.nativeFixedRoomSocketId} is reused by ${previousEndpoint} and ${portal.id}:${endpointName}`);
      usedNativeSocketIds.set(endpoint.nativeFixedRoomSocketId, `${portal.id}:${endpointName}`);
    }
  }

  const retiredGenericShellBodyFamilies = plan.modulePlacements.filter((placement) => (
    !CATALOG_BY_DESCRIPTOR_ID.has(placement.descriptorId)
    && /^module\..+\.golden-v1$/.test(placement.descriptorId ?? '')
    && [...(placement.regionIds ?? placement.semanticRegionIds ?? [])]
      .some((regionId) => nativeRegionIds.has(regionId))
  ));
  assert.deepEqual(retiredGenericShellBodyFamilies, [],
    'native semantic regions still contain retired generic shell body families');

  const retiredGenericBoundaries = plan.structuralBoundaries.filter((boundary) => (
    nativeRegionIds.has(boundary.regionId)
    && boundary.id.startsWith(`boundary.${boundary.regionId}.`)
  ));
  assert.deepEqual(retiredGenericBoundaries, [],
    'native semantic regions still contain retired generic cell-shell boundaries');

  const placementIds = new Set([
    ...placements.map(({ id }) => id),
    ...packPlacements.map(({ id }) => id),
  ]);
  const orphanedGenericSurfaces = plan.walkableSurfaces.filter((surface) => {
    if (!nativeRegionIds.has(surface.regionId)) return false;
    const cell = plan.spatialCells.find(({ id }) => id === surface.cellId);
    if (cell?.connector === true || surface.id.startsWith('surface.connector.')) return false;
    const ownerId = surface.presentationOwnerId
      ?? surface.nativeFixedRoomPlacementId
      ?? surface.sharedNativePlacementId
      ?? surface.semanticRoomPackPlacementId;
    if (placementIds.has(ownerId)) {
      if (surface.presentationOwnerId || surface.nativeFixedRoomPlacementId) return false;
      return !surface.nativeExtensionPurpose;
    }
    return true;
  });
  assert.deepEqual(orphanedGenericSurfaces, [],
    'native semantic regions retain generic surfaces without native placement ownership');

  const ledger = plan.nativeFixedRoomIntegration;
  assert.ok(ledger, 'accepted golden plan omitted the native fixed-room integration ledger');
  assert.equal(ledger.requiredPlacementCount, 11);
  assert.deepEqual(sorted(ledger.activePlacementIds), sorted(placements.map(({ id }) => id)));
  assert.deepEqual(sorted(ledger.activeDescriptorIds), EXPECTED_DESCRIPTOR_IDS);
  assert.deepEqual(ledger.incompleteDescriptorIds, []);
  assert.equal(ledger.genericFallbackGeometry, false);
  return placements;
}

function assertLiveRoomPackVisualColliderLedger(facade, packPlacements) {
  const diagnostics = facade.semanticRoomPackPresentationDiagnostics;
  assert.ok(diagnostics, 'assembled golden complex omitted room-pack presentation diagnostics');
  assert.equal(diagnostics.accepted, true);
  assert.equal(diagnostics.active, true);
  assert.equal(diagnostics.placementCount, 3);
  assert.equal(diagnostics.placements.length, 3);
  assert.equal(diagnostics.genericFallbackGeometry, false);
  assert.equal(diagnostics.collisionDerivedFromMeshBounds, false);
  assert.equal(diagnostics.collisionAuthority, 'accepted-plan-semantic-room-pack-records');
  assert.ok(diagnostics.mappedPhysicalRecordCount > 0);
  assert.ok(diagnostics.boundaryCount > 0);
  assert.ok(diagnostics.surfaceCount > 0);
  assert.ok(diagnostics.fixtureCount > 0);
  assert.deepEqual(
    sorted(diagnostics.placements.map(({ placementId }) => placementId)),
    sorted(packPlacements.map(({ id }) => id)),
  );
  for (const placement of diagnostics.placements) {
    assert.ok(placement.mappedPhysicalRecordCount > 0,
      `${placement.placementId} has no authored visual-to-plan mappings`);
    assert.ok(placement.boundaryCount > 0, `${placement.placementId} has no mapped enclosure`);
    assert.ok(placement.surfaceCount > 0, `${placement.placementId} has no mapped walkable surface`);
    assert.ok(placement.fixtureCount > 0, `${placement.placementId} has no mapped authored fixture`);
  }
}

function assertLiveNativeVisualColliderLedger(plan, facade, placements) {
  const native = facade.nativeFixedRoomAssemblyDiagnostics;
  assert.ok(native, 'assembled golden complex omitted native-room diagnostics');
  assert.equal(native.requiredPlacementCount, 11);
  assert.equal(native.activePlacementCount, 11);
  assert.equal(native.incompleteDescriptorCount, 0);
  assert.equal(native.allRequiredPlacementsActive, true);
  assert.equal(native.presentationActive, true);
  assert.equal(native.presentationPlacementCount, 11);
  assert.equal(native.genericFallbackGeometry, false);
  assert.deepEqual(sorted(native.activePlacementIds), sorted(placements.map(({ id }) => id)));
  assert.deepEqual(sorted(native.activeDescriptorIds), EXPECTED_DESCRIPTOR_IDS);
  assert.deepEqual(native.incompleteDescriptorIds, []);
  assert.equal(native.placements.length, 11);

  const diagnosticByPlacementId = new Map(native.placements.map((placement) => [
    placement.placementId,
    placement,
  ]));
  for (const planPlacement of placements) {
    const live = diagnosticByPlacementId.get(planPlacement.id);
    assert.ok(live, `${planPlacement.id} is absent from the live native assembly ledger`);
    assert.equal(live.descriptorId, planPlacement.descriptorId);
    assert.equal(live.renderGroupAttached, true,
      `${planPlacement.id} has no render group attached beneath the assembled dungeon root`);
    assert.equal(live.renderGroupVisible, true,
      `${planPlacement.id} native render group is hidden at assembly acceptance`);
    assert.ok(live.renderedObjectCount > 0,
      `${planPlacement.id} has no attached native rendered object`);
    assert.ok(live.visibleRenderedObjectCount > 0,
      `${planPlacement.id} has no visible native rendered object`);
    assert.ok(live.visualMappingCount > 0,
      `${planPlacement.id} has no plan-to-native-visual mappings`);
    assert.ok(live.registeredMappedVisualCount > 0,
      `${planPlacement.id} has no registered native visual`);
    assert.equal(live.attachedMappedVisualCount, live.registeredMappedVisualCount,
      `${planPlacement.id} has registered visuals detached from the dungeon`);
    assert.equal(live.visibleMappedVisualCount, live.registeredMappedVisualCount,
      `${planPlacement.id} has registered visuals hidden at startup`);
    assert.ok(live.planSurfaceCount > 0,
      `${planPlacement.id} has no plan-owned native walkable surface`);
    assert.equal(live.registeredSurfaceCount, live.planSurfaceCount,
      `${planPlacement.id} does not register collision for every native walkable surface`);
    assert.ok(live.registeredColliderCount > 0,
      `${planPlacement.id} has no registered native collider`);
  }
}

for (const undercroftType of ['magma', 'electrical']) {
  test(`${undercroftType} golden complex assembles eleven native V1 rooms and three real authored macros`, async () => {
    const seed = `m1-golden-${undercroftType}`;
    const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
      seed,
      undercroftType,
    }), { throwOnError: false });
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    const plan = validation.plan;
    assertAcceptedDungeonFixture(plan, { stage: 'plan', profile: 'golden' });
    const solver = assertGoldenProductionStateSolver(plan);
    assert.ok(solver.visitedStates > 0 && solver.evaluatedTransitions > 0,
      'independent full-content solver did not explore the production state graph');
    const packPlacements = assertRoomPackMacrosOwnPhysicalPlanRecords(plan, undercroftType);
    const placements = assertAllNativeRoomsOwnTheGoldenRegions(plan, packPlacements);
    const roomPackRuntime = await createRealRoomPackRuntime(packPlacements.map(({ roomId }) => roomId));
    const realAssetAudit = getRealRoomPackRuntimeDiagnostics(roomPackRuntime);
    assert.equal(realAssetAudit.loaderIsGLTFLoader, true);
    assert.equal(realAssetAudit.parser, 'three/addons/loaders/GLTFLoader.parseAsync');
    assert.deepEqual(realAssetAudit.loadedRoomIds, expectedPackRoomIds(undercroftType));
    assert.equal(realAssetAudit.loads.length, 3);
    assert.equal(realAssetAudit.loads.every(({ byteLength, nodeCount, meshCount, sceneParsed }) => (
      byteLength > 0 && nodeCount > 0 && meshCount > 0 && sceneParsed === true
    )), true, 'acceptance did not parse every supplied GLB into a real Three.js scene');
    for (const load of realAssetAudit.loads) {
      const placement = packPlacements.find(({ roomId }) => roomId === load.roomId);
      assert.equal(load.sha256, placement?.assetSha256,
        `${load.roomId} real GLB bytes drifted from the accepted room-pack source hash`);
    }
    assert.equal(realAssetAudit.manifests.length, 3);
    const facade = assembleDungeonPlanV2(plan, {
      semanticRoomPackPresentationRuntime: roomPackRuntime,
    });
    try {
      assertLiveNativeVisualColliderLedger(plan, facade, placements);
      assertLiveRoomPackVisualColliderLedger(facade, packPlacements);
      assertAcceptedDungeonFixture({
        stage: 'assembly',
        plan,
        facade,
        proofs: {
          visualCollider: buildStructuralAssemblyProof(plan, facade),
          portalRoutes: buildIndependentPortalRouteProofs(plan, facade),
          mechanismStates: buildMechanismStateProofs(plan, facade),
          offscreenStructuralRender: buildOffscreenStructuralRenderProof(plan, facade),
        },
      }, { stage: 'assembly', profile: 'golden' });
    } finally {
      facade.dispose();
    }
  });
}
