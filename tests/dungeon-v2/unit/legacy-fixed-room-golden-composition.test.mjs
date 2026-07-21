import test from 'node:test';
import assert from 'node:assert/strict';
import { isSerializablePlanValue } from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';
import { LEGACY_FIXED_ROOM_MODULE_CATALOG_V2 } from '../../../src/dungeon-v2/LegacyFixedRoomModuleCatalogV2.js';
import { recompileAcceptedLegacyFixedRoomPlacementV2 } from '../../../src/dungeon-v2/LegacyFixedRoomRuntimeAdapterV2.js';
import {
  LEGACY_FIXED_ROOM_GOLDEN_COMPOSITION_REVISION_V2,
  LEGACY_FIXED_ROOM_GOLDEN_CONNECTION_SPECS_V2,
  LEGACY_FIXED_ROOM_GOLDEN_EXPLICIT_CAPS_V2,
  LEGACY_FIXED_ROOM_GOLDEN_INTERNAL_BINDINGS_V2,
  LEGACY_FIXED_ROOM_GOLDEN_PLACEMENT_SPECS_V2,
  createLegacyFixedRoomGoldenCompositionV2,
  validateLegacyFixedRoomGoldenCompositionV2,
} from '../../../src/dungeon-v2/LegacyFixedRoomGoldenCompositionV2.js';

const clone = (value) => structuredClone(value);

test('native golden composition is immutable serializable data and explicitly not a full DungeonPlan', () => {
  const composition = createLegacyFixedRoomGoldenCompositionV2();
  assert.equal(composition.revision, LEGACY_FIXED_ROOM_GOLDEN_COMPOSITION_REVISION_V2);
  assert.equal(composition.status, 'composition-contract-only');
  assert.equal(composition.fullDungeonPlanReady, false);
  assert.equal(composition.genericFallbackGeometry, false);
  assert.equal(composition.fixedChainReused, false);
  assert.equal(isSerializablePlanValue(composition), true);
  assert.equal(Object.isFrozen(composition), true);
  assert.equal(Object.isFrozen(composition.placements), true);
  assert.deepEqual(validateLegacyFixedRoomGoldenCompositionV2(composition).errors, []);
});

test('all eleven V1 rooms are placed once at native scale without overlap', () => {
  const composition = createLegacyFixedRoomGoldenCompositionV2();
  assert.equal(composition.placements.length, 11);
  assert.deepEqual(
    new Set(composition.placements.map(({ descriptorId }) => descriptorId)),
    new Set(LEGACY_FIXED_ROOM_MODULE_CATALOG_V2.map(({ id }) => id)),
  );
  assert.deepEqual(
    composition.placements.map(({ transform }) => transform.translation),
    LEGACY_FIXED_ROOM_GOLDEN_PLACEMENT_SPECS_V2.map(({ translation }) => translation),
  );
  assert.deepEqual(
    new Set(composition.placements.map(({ transform }) => transform.yawQuarterTurns)),
    new Set([0, 1, 2, 3]),
  );
  for (const placement of composition.placements) {
    const rebuilt = recompileAcceptedLegacyFixedRoomPlacementV2(placement);
    assert.equal(rebuilt.expectedPlacement.structuralContractSignature, placement.structuralContractSignature);
    assert.equal(placement.presentationProfileId, 'legacy-fixed-room-native-v2');
  }
  assert.equal(validateLegacyFixedRoomGoldenCompositionV2(composition).accepted, true);

  const overlapped = clone(composition);
  overlapped.placements[1].worldBounds = clone(overlapped.placements[0].worldBounds);
  assert.equal(
    validateLegacyFixedRoomGoldenCompositionV2(overlapped).errors
      .some(({ code }) => code === 'composition-placement-overlap'),
    true,
  );
});

test('socket ownership is exhaustive: fourteen pairs, two internal drops, and eight opaque caps', () => {
  const composition = createLegacyFixedRoomGoldenCompositionV2();
  assert.equal(composition.connections.length, LEGACY_FIXED_ROOM_GOLDEN_CONNECTION_SPECS_V2.length);
  assert.equal(composition.connections.length, 14);
  assert.equal(composition.internalBindings.length, LEGACY_FIXED_ROOM_GOLDEN_INTERNAL_BINDINGS_V2.length);
  assert.equal(composition.internalBindings.length, 2);
  assert.equal(composition.cappedSockets.length, LEGACY_FIXED_ROOM_GOLDEN_EXPLICIT_CAPS_V2.length);
  assert.equal(composition.cappedSockets.length, 8);
  assert.equal(composition.diagnostics.connectionCount, 14);
  assert.equal(composition.diagnostics.cappedSocketCount, 8);
  assert.deepEqual(validateLegacyFixedRoomGoldenCompositionV2(composition).stats, {
    placements: 11,
    connections: 14,
    pairedOrBoundSockets: 30,
    cappedSockets: 8,
    cycleRank: 4,
  });
  assert.ok(composition.internalBindings.every((binding) => (
    binding.damageFree && binding.playableDestination && binding.permanentReturn
  )));

  const uncapped = clone(composition);
  uncapped.cappedSockets.pop();
  assert.equal(
    validateLegacyFixedRoomGoldenCompositionV2(uncapped).errors
      .some(({ code }) => code === 'composition-socket-partition-incomplete'),
    true,
  );
});

test('the authored graph is connected, looped, non-linear, and keeps Nest optional', () => {
  const composition = createLegacyFixedRoomGoldenCompositionV2();
  assert.equal(composition.graph.connected, true);
  assert.equal(composition.graph.connectedPlacementIds.length, 11);
  assert.equal(composition.graph.cycleRank, 4);
  assert.deepEqual(composition.graph.adjacency['placement.nest'], ['placement.parts']);
  assert.equal(composition.connections.filter(({ optionalBranch }) => optionalBranch).length, 1);
  assert.equal(composition.connections.some(({ from, to }) => (
    from.placementId === 'placement.security' && to.placementId === 'placement.machine'
  )), true);
  assert.equal(composition.connections.some(({ from, to }) => (
    new Set([from.placementId, to.placementId]).has('placement.machine')
    && new Set([from.placementId, to.placementId]).has('placement.coolant')
    && from.form === 'elevated-catwalk'
  )), true);
});

test('connection forms, placement buckets, elevations, and endpoint facings are genuinely varied', () => {
  const composition = createLegacyFixedRoomGoldenCompositionV2();
  assert.deepEqual(composition.diagnostics.formCounts, {
    'cargo-lift': 3,
    'elevated-catwalk': 3,
    'ground-bulkhead': 5,
    'pipe-water-breach': 2,
    'service-ladder': 1,
  });
  assert.ok(Math.max(...Object.values(composition.diagnostics.formCounts)) / 14 <= 0.4);
  assert.ok(composition.diagnostics.elevationBands.includes(0));
  assert.ok(composition.diagnostics.elevationBands.includes(3));
  assert.ok(composition.diagnostics.elevationBands.includes(4.05));
  assert.ok(composition.diagnostics.elevationBands.includes(12.8));
  const boundarySides = new Set(composition.connections.flatMap(({ from, to }) => [
    from.boundarySide,
    to.boundarySide,
  ]));
  assert.ok(boundarySides.size >= 5);

  for (const connection of composition.connections) {
    assert.equal(connection.from.form, connection.to.form);
    assert.equal(connection.traversal.enclosed, true);
    assert.equal(connection.traversal.supported, true);
    const dot = connection.from.facing.x * connection.to.facing.x
      + connection.from.facing.y * connection.to.facing.y
      + connection.from.facing.z * connection.to.facing.z;
    if (connection.form === 'service-ladder') assert.ok(dot > 0.999);
    else if (connection.traversal.connectorProfileId === 'enclosed-double-elbow-bulkhead-v2') {
      assert.ok(dot > 0.999);
      assert.equal(connection.traversal.endpointFacingPolicy, 'parallel-outward-double-elbow');
      assert.equal(connection.traversal.minimumElbows, 2);
    } else assert.ok(dot < -0.999);
    if (!['cargo-lift', 'service-ladder'].includes(connection.form)) {
      assert.ok(Math.abs(connection.traversal.verticalDelta) <= 0.001);
    }
  }
  const credentialLift = composition.connections.find(({ id }) => id === 'connection.conveyor-credential-lift');
  assert.equal(credentialLift.traversal.verticalDelta, 3);
  assert.equal(credentialLift.traversal.automaticTravel, true);
  assert.equal(credentialLift.traversal.recallable, true);
  assert.equal(credentialLift.traversal.controlsBesideWalkway, true);
});

test('the Parts-to-Nest service route owns two aligned ladders and an enclosed overhead gallery', () => {
  const composition = createLegacyFixedRoomGoldenCompositionV2();
  const connection = composition.connections.find(({ form }) => form === 'service-ladder');
  assert.equal(connection.id, 'connection.parts-nest-overhead-service');
  assert.equal(connection.traversal.mode, 'dual-service-ladder-overhead-gallery');
  assert.equal(connection.traversal.connectorProfileId, 'dual-service-ladder-overhead-gallery-v2');
  assert.equal(connection.traversal.overheadGallery.enclosed, true);
  assert.equal(connection.traversal.overheadGallery.supported, true);
  for (const shaft of Object.values(connection.traversal.ladderShafts)) {
    assert.equal(shaft.bodyClearance, 0.4);
    assert.ok(shaft.rootPath[1].y > shaft.rootPath[0].y + 8);
    assert.deepEqual(shaft.bottomExit, shaft.rootPath[0]);
    assert.deepEqual(shaft.topExit, shaft.rootPath[1]);
    const delta = {
      x: shaft.rootPath[0].x - shaft.planePath[0].x,
      z: shaft.rootPath[0].z - shaft.planePath[0].z,
    };
    assert.ok(Math.abs(
      delta.x * shaft.planeNormal.x + delta.z * shaft.planeNormal.z - 0.4,
    ) < 1e-9);
    assert.ok(
      shaft.climbFacing.x * shaft.planeNormal.x
      + shaft.climbFacing.z * shaft.planeNormal.z < -0.999,
    );
  }
});
