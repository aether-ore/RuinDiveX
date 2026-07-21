import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { stablePlanStringify } from '../../../src/dungeon-v2/DungeonPlanDiagnostics.js';
import { validateSemanticRoomPackPlacementV2 } from '../../../src/dungeon-v2/SemanticRoomPackPlanAdapterV2.js';
import {
  SemanticRoomPackWaterworksReplacementErrorV2,
  replaceGoldenWaterworksWithSemanticRoomPackV2,
  validateGoldenWaterworksSemanticRoomPackReplacementV2,
} from '../../../src/dungeon-v2/SemanticRoomPackWaterworksReplacementV2.js';

const ROOM_ID = 'rdx_waterworks_freight_sump';
const PLACEMENT_ID = 'placement.semantic-room-pack.waterworks-freight-sump';
const ABSORBED = [
  'placement.freight-sump',
  'placement.reservoir',
  'placement.gantry-sump',
  'placement.salvage-tunnel',
];

function mutableGolden(undercroftType = 'magma', seed = `waterworks-replacement-${undercroftType}`) {
  return structuredClone(createGoldenDungeonPlanV2({
    seed,
    undercroftType,
    deferSemanticRoomPackIntegration: true,
  }));
}

function integratedGolden(undercroftType = 'magma', seed = `waterworks-replacement-${undercroftType}`) {
  const plan = createGoldenDungeonPlanV2({ seed, undercroftType });
  return {
    plan,
    sharedValidation: validateDungeonPlanV2(plan),
  };
}

for (const undercroftType of ['magma', 'electrical']) {
  test(`authored Waterworks macro replacement is shared-validator accepted for ${undercroftType}`, () => {
    const result = validateGoldenWaterworksSemanticRoomPackReplacementV2(mutableGolden(undercroftType));
    assert.equal(result.accepted, true, JSON.stringify(result.errors, null, 2));
    assert.equal(result.sharedValidation.accepted, true, JSON.stringify(result.sharedValidation.errors, null, 2));
    assert.equal(result.sharedValidation.errors.length, 0);
    assert.equal(result.plan.semanticRoomPackWaterworksReplacement.productionEligible, true);
    assert.equal(result.plan.semanticRoomPackWaterworksReplacement.fullyPhysicalized, true);
    assert.equal(validateDungeonPlanV2(result.plan).accepted, true);
  });
}

test('replacement absorbs four legacy macro placements without adding long connector cells', () => {
  const result = validateGoldenWaterworksSemanticRoomPackReplacementV2(mutableGolden());
  const plan = result.plan;
  const placement = plan.semanticRoomPackPlacements.find(({ roomId }) => roomId === ROOM_ID);
  const modulePlacement = plan.modulePlacements.find(({ id }) => id === PLACEMENT_ID);
  assert.ok(placement && modulePlacement);
  assert.deepEqual(placement.absorbedModulePlacementIds, ABSORBED);
  assert.deepEqual(modulePlacement.absorbedModulePlacementIds, ABSORBED);
  assert.ok(ABSORBED.every((id) => !plan.modulePlacements.some((entry) => entry.id === id)));
  assert.deepEqual(modulePlacement.regionIds, [
    'freight-sump', 'reservoir', 'gantry-sump', 'salvage-tunnel',
  ]);
  assert.equal(placement.physicalReplacement.addedConnectorCellCount, 0);
  assert.deepEqual(placement.connectorCellIds, []);
  assert.equal(plan.semanticRoomPackWaterworksReplacement.addedConnectorCellCount, 0);
  assert.ok(!plan.spatialCells.some(({ id }) => id.startsWith('cell.semantic-room-pack.waterworks.connector')));
});

test('all four authored sockets bind unique useful routes and retain exact entry-tier placement', () => {
  const { plan } = validateGoldenWaterworksSemanticRoomPackReplacementV2(mutableGolden());
  const placement = plan.semanticRoomPackPlacements.find(({ roomId }) => roomId === ROOM_ID);
  assert.deepEqual(placement.socketBindings.map(({ socketId, portalId, status }) => ({ socketId, portalId, status })), [
    { socketId: 'entry_south', portalId: 'portal.sorting-freight-sump', status: 'bound' },
    { socketId: 'exit_north', portalId: 'portal.gantry-sump-salvage', status: 'bound' },
    { socketId: 'gantry_exit_west', portalId: 'portal.reservoir-gantry-sump', status: 'bound' },
    { socketId: 'drain_tunnel_east', portalId: 'portal.freight-sump-reservoir', status: 'bound' },
  ]);
  assert.equal(new Set(placement.socketBindings.map(({ portalId }) => portalId)).size, 4);
  assert.ok(placement.socketBindings.every(({ routePurpose, surfaceId, boundaryId }) => (
    routePurpose.length > 20
      && plan.walkableSurfaces.some(({ id }) => id === surfaceId)
      && plan.structuralBoundaries.some(({ id }) => id === boundaryId)
  )));
  const entry = placement.sockets.find(({ id }) => id === placement.entrySocketId);
  assert.deepEqual(entry.worldPosition, { x: -28, y: -12, z: -3.5 });
  assert.deepEqual(entry.worldPosition, placement.presentationBinding.targetPortal.position);
  assert.deepEqual(placement.worldBounds, {
    min: { x: -70, y: -17.3, z: -22.5 },
    max: { x: -28, y: 2.5, z: 15.5 },
  });
  assert.equal(placement.placementTransform.yawQuarterTurns, 1);
  assert.equal(Object.isFrozen(placement), true);
  assert.equal(validateSemanticRoomPackPlacementV2(placement).accepted, true);
});

test('replacement owns exact conserved water geometry, dry controls, and three authored discoveries', () => {
  const { plan } = validateGoldenWaterworksSemanticRoomPackReplacementV2(mutableGolden());
  const placement = plan.semanticRoomPackPlacements.find(({ roomId }) => roomId === ROOM_ID);
  const binding = placement.runtimeContractBindings.water;
  const environment = plan.environmentStates.find(({ id }) => id === 'environment.water-unit');
  assert.deepEqual(binding.basins.map(({ stateId, levelKey }) => ({ stateId, levelKey })), [
    { stateId: 'FreightSumpFilled', levelKey: 'freightLevelWorldY' },
    { stateId: 'StoredInReservoir', levelKey: 'storedLevelWorldY' },
    { stateId: 'GantrySumpFilled', levelKey: 'gantryLevelWorldY' },
  ]);
  assert.equal(new Set(binding.basins.map(({ exactVolume }) => exactVolume)).size, 1);
  assert.ok(binding.basins.every(({ floorSurfaceId, bounds, exactLevelWorldY }) => {
    const floor = plan.walkableSurfaces.find(({ id }) => id === floorSurfaceId);
    return floor
      && floor.runtimeContractOnly === true
      && floor.derivedFromManifestCollisionPartition === true
      && floor.bounds.max.y === bounds.min.y
      && exactLevelWorldY > bounds.min.y;
  }));
  assert.deepEqual(environment.stableStates.map(({ id }) => id), [
    'FreightSumpFilled', 'StoredInReservoir', 'GantrySumpFilled',
  ]);
  assert.ok(environment.stableStates.every(({ exactVolume }) => exactVolume === binding.exactGeometricVolume));
  assert.deepEqual(environment.movementProfile, {
    captureFloodedStateAtTakeoff: true,
    groundMovementMultiplier: 0.76,
    jumpHeight: 4.95,
    gravityScale: 0.28,
    mode: 'bottom-walking',
  });
  assert.deepEqual(Object.keys(binding.discoverySurfaceIds), [
    'submerged_salvage_cache', 'drained_tunnel_cache', 'gantry_high_route',
  ]);
  const controlSurface = plan.walkableSurfaces.find(({ id }) => id === binding.controlSurfaceId);
  assert.match(controlSurface.purpose, /control console pad/u);
  assert.ok(environment.permanentDryControlAnchorIds.every((id) => (
    plan.anchors.find((anchor) => anchor.id === id)?.surfaceId === controlSurface.id
  )));
});

test('authored room collision comes only from reviewed manifest volumes and explicit socket frames', () => {
  const { plan } = validateGoldenWaterworksSemanticRoomPackReplacementV2(mutableGolden());
  const placement = plan.semanticRoomPackPlacements.find(({ roomId }) => roomId === ROOM_ID);
  assert.ok(placement.transformedCollisionVolumes.length > 100);
  assert.ok(placement.transformedCollisionVolumes.every((collider) => (
    collider.sourcePolicy === 'manifest-collision-volume'
      && collider.derivedFromVisibleMeshBounds === false
  )));
  const authoredIds = new Set(placement.integratedPlanRecordIds.structuralBoundaryIds);
  const authoredBoundaries = plan.structuralBoundaries.filter(({ id, sourcePolicy }) => (
    authoredIds.has(id) && sourcePolicy !== 'explicit-plan-owned-socket-frame'
  ));
  assert.ok(authoredBoundaries.every(({ descriptorReference, colliderIds }) => (
    descriptorReference?.collisionSourcePolicy === 'manifest-collision-volumes-only'
      && colliderIds.length === 1
  )));
  const frames = plan.structuralBoundaries.filter(({ sourcePolicy }) => sourcePolicy === 'explicit-plan-owned-socket-frame');
  assert.ok(frames.length >= 4);
  assert.ok(frames.every(({ derivedFromVisibleMeshBounds }) => derivedFromVisibleMeshBounds === false));
  assert.ok(!plan.structuralBoundaries.some(({ derivedFromVisibleMeshBounds }) => derivedFromVisibleMeshBounds === true));
});

test('drain-to-Reservoir transfer is a physical ladder with usable top and bottom landings', () => {
  const { plan } = validateGoldenWaterworksSemanticRoomPackReplacementV2(mutableGolden());
  const ladder = plan.walkableSurfaces.find(({ id }) => id === 'surface.connector.freight-sump-reservoir.0');
  assert.equal(ladder.geometry.type, 'ladder');
  assert.equal(ladder.geometry.height > 8, true);
  assert.equal(ladder.geometry.landings.bottom.minimumClearLength, 1.2);
  assert.equal(ladder.geometry.landings.top.minimumClearLength, 1.2);
  assert.equal(ladder.geometry.landings.bottom.minimumHeadroom, 3.2);
  assert.ok(plan.walkableSurfaces.some(({ id }) => id === ladder.geometry.landings.bottom.surfaceId));
  assert.ok(plan.walkableSurfaces.some(({ id }) => id === ladder.geometry.landings.top.surfaceId));
});

test('replacement is deterministic, dry-run atomic, and fails closed when a required route is missing', () => {
  const firstInput = mutableGolden('magma', 'waterworks-deterministic');
  const secondInput = mutableGolden('magma', 'waterworks-deterministic');
  const before = stablePlanStringify(firstInput);
  const first = validateGoldenWaterworksSemanticRoomPackReplacementV2(firstInput);
  const second = validateGoldenWaterworksSemanticRoomPackReplacementV2(secondInput);
  assert.equal(stablePlanStringify(firstInput), before);
  assert.equal(stablePlanStringify(first.plan), stablePlanStringify(second.plan));
  assert.equal(first.sharedValidation.diagnosticHash, second.sharedValidation.diagnosticHash);

  const broken = mutableGolden();
  broken.portals = broken.portals.filter(({ id }) => id !== 'portal.freight-sump-reservoir');
  const brokenBefore = stablePlanStringify(broken);
  const rejected = validateGoldenWaterworksSemanticRoomPackReplacementV2(broken);
  assert.equal(rejected.accepted, false);
  assert.ok(rejected.errors.some(({ code }) => code === 'semantic-room-pack-waterworks-portal-missing'));
  assert.equal(stablePlanStringify(broken), brokenBefore);
  assert.throws(
    () => replaceGoldenWaterworksWithSemanticRoomPackV2(broken),
    (error) => error instanceof SemanticRoomPackWaterworksReplacementErrorV2,
  );
  assert.equal(stablePlanStringify(broken), brokenBefore);
});

test('mutator applies the accepted candidate in place without fallback geometry', () => {
  const plan = mutableGolden('electrical');
  assert.equal(replaceGoldenWaterworksWithSemanticRoomPackV2(plan), plan);
  assert.equal(plan.semanticRoomPackWaterworksReplacement.productionEligible, true);
  assert.equal(plan.semanticRoomPackPlacements.filter(({ roomId }) => roomId === ROOM_ID).length, 1);
  assert.equal(validateDungeonPlanV2(plan).accepted, true);
});

test('default golden production composition includes the replacement exactly once', () => {
  for (const undercroftType of ['magma', 'electrical']) {
    const { plan, sharedValidation } = integratedGolden(undercroftType);
    assert.equal(sharedValidation.accepted, true, JSON.stringify(sharedValidation.errors, null, 2));
    assert.equal(plan.semanticRoomPackWaterworksReplacement.productionEligible, true);
    assert.equal(plan.semanticRoomPackPlacements.filter(({ roomId }) => roomId === ROOM_ID).length, 1);
  }
});
