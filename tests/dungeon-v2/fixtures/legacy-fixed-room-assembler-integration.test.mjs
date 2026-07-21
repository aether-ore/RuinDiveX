import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTraversalLabPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { getLegacyFixedRoomModuleV2 } from '../../../src/dungeon-v2/LegacyFixedRoomModuleCatalogV2.js';
import {
  compileLegacyFixedRoomPlacementV2,
  compileLegacyFixedRoomStructuralContractV2,
  createLegacyFixedRoomPlanPlacementRecordV2,
} from '../../../src/dungeon-v2/LegacyFixedRoomRuntimeAdapterV2.js';
import { buildLadderRuntimeProofs } from '../helpers/assembly-proofs.mjs';

const PLACEMENT_ID = 'placement.native-server-crypt';
const REGION_ID = 'server';
const CELL_ID = 'cell.native-server-crypt';
const LADDER_SURFACE_ID = 'surface.native-server-crypt.service-ladder';
const LADDER_LANDING_ID = 'surface.native-server-crypt.service-ladder-top';

function clone(value) {
  return structuredClone(value);
}

function unionBounds(boundsList) {
  return boundsList.reduce((result, bounds) => ({
    min: {
      x: Math.min(result.min.x, bounds.min.x),
      y: Math.min(result.min.y, bounds.min.y),
      z: Math.min(result.min.z, bounds.min.z),
    },
    max: {
      x: Math.max(result.max.x, bounds.max.x),
      y: Math.max(result.max.y, bounds.max.y),
      z: Math.max(result.max.z, bounds.max.z),
    },
  }), {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  });
}

function buildNativeFixedRoomPlan(mutate = null) {
  const validation = validateDungeonPlanV2(createTraversalLabPlanV2({
    seed: 'native-fixed-room-assembler-fixture',
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const plan = clone(validation.plan);
  const module = getLegacyFixedRoomModuleV2('v1-room.server-crypt');
  const ladderSocket = module.extensionSockets.find(({ form }) => form === 'service-ladder');
  assert.ok(ladderSocket, 'fixture module must own a native V1 service-ladder socket');
  const structuralContract = compileLegacyFixedRoomStructuralContractV2(module, {
    openSocketIds: [ladderSocket.id],
  });
  const compiled = compileLegacyFixedRoomPlacementV2(module, {
    id: PLACEMENT_ID,
    translation: { x: 280, y: -4, z: 64 },
    yawQuarterTurns: 1,
    structuralContract,
  });
  const placement = createLegacyFixedRoomPlanPlacementRecordV2(compiled, {
    semanticRegionIds: [REGION_ID],
  });

  plan.modulePlacements.push(clone(placement));
  plan.regions.push({
    id: REGION_ID,
    districtId: plan.districts[0].id,
    displayName: 'Native Server Crypt Fixture',
    functionalPurpose: 'native V1 fixed-room assembler acceptance',
    bounds: clone(compiled.worldBounds),
    topologySignature: 'fixture:native-server-crypt',
  });
  plan.spatialCells.push({
    id: CELL_ID,
    regionId: REGION_ID,
    bounds: clone(compiled.worldBounds),
    playable: true,
    interior: true,
  });
  plan.minimap.regions.push({
    id: REGION_ID,
    districtId: plan.districts[0].id,
    bounds: clone(compiled.worldBounds),
    elevation: compiled.worldBounds.min.y,
  });

  const placedBoundaries = compiled.structuralBoundaries.map((boundary) => ({
    ...clone(boundary),
    regionId: REGION_ID,
    cellId: CELL_ID,
    kind: boundary.role.includes('ceiling') ? 'solid' : 'solid',
    materialProfileId: boundary.materialProfileId ?? 'legacy-wall-industrial',
    collider: true,
    openings: [],
  }));
  plan.structuralBoundaries.push(...placedBoundaries);
  const supportBoundaryId = placedBoundaries[0].id;

  const colliderGroups = new Map();
  for (const collider of compiled.fixtureColliders) {
    const group = colliderGroups.get(collider.fixtureId) ?? [];
    group.push(collider);
    colliderGroups.set(collider.fixtureId, group);
  }
  const placedFixtures = [...colliderGroups].map(([fixtureId, colliders]) => ({
    id: fixtureId,
    type: 'legacy-fixed-room-fixture',
    regionId: REGION_ID,
    cellId: CELL_ID,
    bounds: unionBounds(colliders.map(({ bounds }) => bounds)),
    gameplayPurpose: 'native V1 authored fixture with plan-owned collision',
    collision: 'blocking',
    supportBoundaryIds: [supportBoundaryId],
    visualId: `visual.${fixtureId}`,
    visualIds: [`visual.${fixtureId}`],
    colliderIds: colliders.map(({ id }) => id),
    colliderBounds: colliders.map(({ bounds }) => clone(bounds)),
    presentationOwnerId: PLACEMENT_ID,
    presentationContractId: compiled.presentation.contractId,
  }));
  assert.ok(placedFixtures.length > 0);
  plan.structuralFixtures.push(...placedFixtures);
  const supportFixtureId = placedFixtures[0].id;

  const placedSurfaces = compiled.walkableSurfaces.map((surface) => ({
    ...clone(surface),
    regionId: REGION_ID,
    cellId: CELL_ID,
    purpose: surface.purpose ?? 'native V1 authored walkable surface',
    supportBoundaryIds: [supportBoundaryId],
    supportFixtureIds: [supportFixtureId],
    supportProfile: surface.support?.style ?? 'v1-authored-visible-support',
    visualProfile: surface.materialProfileId,
    collision: 'static',
    hazardTag: null,
  }));

  const worldSocket = compiled.portals.find(({ localId }) => localId === ladderSocket.id);
  const bottomApproach = placedSurfaces.find(({ id }) => (
    worldSocket.approachSurfaceIds.includes(id)
  ));
  assert.ok(bottomApproach, 'open native socket must retain its plan-owned approach surface');
  const bottomY = bottomApproach.topY;
  const topY = compiled.transform.translation.y + module.enclosure.ceilingHeight + 0.4;
  const rootX = worldSocket.anchor.x;
  const rootZ = worldSocket.anchor.z;
  const climbFacing = { x: 0, y: 0, z: 1 };
  const planeNormal = { x: 0, y: 0, z: -1 };
  const ladderSurface = {
    id: LADDER_SURFACE_ID,
    regionId: REGION_ID,
    cellId: CELL_ID,
    bounds: {
      min: { x: rootX - 1, y: bottomY - 0.12, z: rootZ - 1 },
      max: { x: rootX + 1, y: topY, z: rootZ + 1 },
    },
    purpose: `physical service ladder bound to ${worldSocket.id}`,
    supportBoundaryIds: [supportBoundaryId],
    supportProfile: 'v1-service-ladder-cage',
    visualProfile: 'legacy-support',
    collision: 'static',
    hazardTag: null,
    nativeFixedRoomSocketId: worldSocket.id,
    geometry: {
      type: 'ladder',
      path: [
        { x: rootX, y: bottomY, z: rootZ },
        { x: rootX, y: topY, z: rootZ },
      ],
      planePath: [
        { x: rootX, y: bottomY, z: rootZ + 0.4 },
        { x: rootX, y: topY, z: rootZ + 0.4 },
      ],
      climbFacing,
      facing: climbFacing,
      planeNormal,
      bodyClearance: 0.4,
      width: 1.6,
      mountClearance: 1.4,
      bottomExit: { x: rootX, y: bottomY, z: rootZ },
      topExit: { x: rootX, y: topY, z: rootZ + 0.7 },
      bottomExitFacing: { x: 1, y: 0, z: 0 },
      topExitFacing: { x: 0, y: 0, z: 1 },
      topOpening: {
        kind: 'native-service-ladder-aperture',
        bounds: {
          min: { x: rootX - 1.3, y: topY - 0.35, z: rootZ - 0.7 },
          max: { x: rootX + 1.3, y: topY + 0.05, z: rootZ + 0.45 },
        },
        playableBelowSurfaceId: bottomApproach.id,
        minimumClearWidth: 1.6,
        minimumClearDepth: 0.7,
      },
      landings: {
        bottom: {
          surfaceId: bottomApproach.id,
          exit: { x: rootX, y: bottomY, z: rootZ },
          egressDirection: { x: 1, y: 0, z: 0 },
          minimumClearLength: 1.2,
          minimumClearWidth: 1.2,
          minimumHeadroom: 3.2,
        },
        top: {
          surfaceId: LADDER_LANDING_ID,
          exit: { x: rootX, y: topY, z: rootZ + 0.7 },
          egressDirection: { x: 0, y: 0, z: 1 },
          minimumClearLength: 1.2,
          minimumClearWidth: 1.2,
          minimumHeadroom: 3.2,
        },
      },
    },
  };
  const ladderLanding = {
    id: LADDER_LANDING_ID,
    regionId: REGION_ID,
    cellId: CELL_ID,
    bounds: {
      min: { x: rootX - 2, y: topY - 0.12, z: rootZ + 0.45 },
      max: { x: rootX + 2, y: topY, z: rootZ + 2.2 },
    },
    purpose: 'playable upper destination for the native V1 service-ladder socket',
    supportBoundaryIds: [supportBoundaryId],
    supportFixtureIds: [supportFixtureId],
    supportProfile: 'v1-service-ladder-headframe',
    visualProfile: 'legacy-catwalk',
    collision: 'static',
    hazardTag: null,
  };
  plan.walkableSurfaces.push(...placedSurfaces, ladderSurface, ladderLanding);

  const startAnchor = plan.safeAnchors.find(({ id }) => id === plan.compatibility.playerStartAnchorId);
  let previousSurfaceId = startAnchor?.surfaceId
    ?? startAnchor?.safeSurfaceId
    ?? plan.walkableSurfaces[0].id;
  for (const surface of placedSurfaces) {
    plan.traversalLinks.push({
      id: `traversal.fixture.${surface.id}`,
      regionId: REGION_ID,
      fromSurfaceId: previousSurfaceId,
      toSurfaceId: surface.id,
      mode: surface.shape === 'ramp-tile' ? 'walkable-stairs' : 'walk',
      bidirectional: true,
      minimumWidth: 1.2,
    });
    previousSurfaceId = surface.id;
  }
  plan.traversalLinks.push(
    {
      id: 'traversal.fixture.native-ladder-entry',
      regionId: REGION_ID,
      fromSurfaceId: bottomApproach.id,
      toSurfaceId: LADDER_SURFACE_ID,
      mode: 'ladder',
      bidirectional: true,
      minimumWidth: 1.6,
    },
    {
      id: 'traversal.fixture.native-ladder-exit',
      regionId: REGION_ID,
      fromSurfaceId: LADDER_SURFACE_ID,
      toSurfaceId: LADDER_LANDING_ID,
      mode: 'ladder',
      bidirectional: true,
      minimumWidth: 1.6,
    },
  );

  mutate?.({ plan, module, compiled, placement, ladderSocket, ladderSurface });
  return { plan, module, compiled, placement, ladderSocket, ladderSurface };
}

test('assembler renders explicit native fixed rooms as mapped instanced batches without generic duplicates', () => {
  const fixture = buildNativeFixedRoomPlan();
  const facade = assembleDungeonPlanV2(fixture.plan);
  try {
    const diagnostics = facade.legacyFixedRoomPresentationDiagnostics;
    assert.equal(diagnostics.active, true);
    assert.equal(diagnostics.placementCount, 1);
    assert.equal(diagnostics.instanced, true);
    assert.equal(diagnostics.genericFallbackGeometry, false);
    assert.ok(diagnostics.drawCalls > 0 && diagnostics.drawCalls <= 24);
    assert.ok(diagnostics.visualMappingCount > fixture.compiled.walkableSurfaces.length);

    const fixedBoundaryIds = new Set(fixture.compiled.placedRecordIds.structuralBoundaryIds);
    const fixedSurfaceIds = new Set(fixture.compiled.placedRecordIds.walkableSurfaceIds);
    let nativeBatchCount = 0;
    const duplicateGenericVisuals = [];
    facade.group.traverse((object) => {
      if (object.isInstancedMesh && object.userData.v2LegacyFixedRoomPresentation) nativeBatchCount += 1;
      for (const boundaryId of fixedBoundaryIds) {
        if (object.name?.startsWith(`v2Boundary:${boundaryId}:`)) duplicateGenericVisuals.push(object.name);
      }
      for (const surfaceId of fixedSurfaceIds) {
        if (object.name === `v2WalkableSurface:${surfaceId}`
          || object.name === `v2Stairs:${surfaceId}`) duplicateGenericVisuals.push(object.name);
      }
    });
    assert.ok(nativeBatchCount > 0);
    assert.deepEqual(duplicateGenericVisuals, []);

    for (const boundaryId of fixedBoundaryIds) {
      assert.ok(facade.structuralRegistry.getVisual(boundaryId)?.isInstancedMesh, boundaryId);
      assert.ok(facade.structuralRegistry.getCollider(boundaryId), boundaryId);
    }
    for (const surfaceId of fixedSurfaceIds) {
      assert.ok(facade.structuralRegistry.getVisual(surfaceId)?.isInstancedMesh, surfaceId);
      assert.ok(facade.structuralRegistry.getCollider(surfaceId), surfaceId);
      const source = fixture.compiled.walkableSurfaces.find(({ id }) => id === surfaceId);
      assert.ok(
        source.shape === 'ramp-tile'
          ? facade.stairProofs.some(({ surfaceId: stairSurfaceId }) => stairSurfaceId === surfaceId)
          : facade.platforms.some(({ id }) => id === surfaceId),
        surfaceId,
      );
    }

    const fixedRamp = fixture.compiled.walkableSurfaces.find(({ shape }) => shape === 'ramp-tile');
    assert.ok(fixedRamp, 'native module must exercise a ramp-tile');
    const rampCollider = facade.structuralRegistry.getCollider(fixedRamp.id);
    assert.deepEqual(rampCollider.bounds, fixedRamp.bounds,
      'fixed ramp collision must use its exact plan bounds, not its shared InstancedMesh batch bounds');
    assert.equal(rampCollider.shape, 'oriented-ramp-strip');
  } finally {
    facade.dispose();
  }
});

test('native fixed-room service-ladder socket assembles a real aligned surface ladder', () => {
  const fixture = buildNativeFixedRoomPlan();
  const facade = assembleDungeonPlanV2(fixture.plan);
  try {
    const ladder = facade.ladders.find(({ surfaceId }) => surfaceId === LADDER_SURFACE_ID);
    assert.ok(ladder, 'native fixed-room plan must assemble its socket-bound ladder surface');
    assert.equal(ladder.bodyClearance, 0.4);
    assert.deepEqual(ladder.facing, { x: 0, z: 1 });
    assert.deepEqual(ladder.planeNormal, { x: 0, z: -1 });
    assert.equal(ladder.object.userData.v2LadderPlane.bodyClearance, 0.4);
    assert.deepEqual(ladder.object.userData.v2LadderPlane.climbFacing, { x: 0, z: 1 });
    assert.deepEqual(ladder.object.userData.v2LadderPlane.normal, { x: 0, z: -1 });
    const runtimeProof = buildLadderRuntimeProofs(fixture.plan, facade);
    const nativeProof = runtimeProof.ladderProofs.find(({ ladderId }) => ladderId === ladder.id);
    assert.ok(nativeProof, 'real Player/controller proof must include native socket ladder');
    assert.equal(runtimeProof.accepted, true, JSON.stringify(runtimeProof.rejectedLadders, null, 2));
    assert.equal(nativeProof.accepted, true, JSON.stringify(nativeProof, null, 2));
    assert.equal(nativeProof.directions.every(({ egress }) => (
      egress.accepted
      && egress.remainedGrounded
      && !egress.supportLost
      && !egress.snapBackDetected
    )), true, JSON.stringify(nativeProof.directions.map(({ egress }) => egress), null, 2));
    assert.equal(nativeProof.directions.every(({ planeAlignment }) => (
      planeAlignment.minimumFacingAlignment >= 0.999
      && planeAlignment.maximumPlaneClearanceError <= 0.01
    )), true);
  } finally {
    facade.dispose();
  }
});

test('assembler rejects stale signatures, missing geometry, and slash-aliased placed IDs', () => {
  for (const [expectedCode, mutate] of [
    ['DUNGEON_V2_FIXED_ROOM_SIGNATURE_MISMATCH', ({ plan }) => {
      plan.modulePlacements.at(-1).structuralContractSignature = 'legacy-fixed-room-structural-v2:00000000';
    }],
    ['DUNGEON_V2_FIXED_ROOM_SURFACE_MISMATCH', ({ plan, compiled }) => {
      const target = plan.walkableSurfaces.find(({ id }) => id === compiled.walkableSurfaces[0].id);
      target.bounds.max.x += 0.25;
    }],
    ['DUNGEON_V2_FIXED_ROOM_SIGNATURE_MISMATCH', ({ plan }) => {
      const placement = plan.modulePlacements.at(-1);
      placement.placedRecordIds.walkableSurfaceIds[0] = placement.placedRecordIds.walkableSurfaceIds[0].replace(':', '/');
    }],
  ]) {
    const fixture = buildNativeFixedRoomPlan(mutate);
    assert.throws(
      () => assembleDungeonPlanV2(fixture.plan),
      (error) => error.code === expectedCode,
    );
  }
});
