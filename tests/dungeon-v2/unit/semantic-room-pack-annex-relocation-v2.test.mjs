import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clonePlanData,
  isSerializablePlanValue,
} from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { createLegacyFixedRoomGoldenCompositionV2 } from '../../../src/dungeon-v2/LegacyFixedRoomGoldenCompositionV2.js';
import { validateSemanticRoomPackPlacementV2 } from '../../../src/dungeon-v2/SemanticRoomPackPlanAdapterV2.js';
import {
  SEMANTIC_ROOM_PACK_ANNEX_TARGETS_V2,
  prepareSemanticRoomPackAnnexRelocationV2,
  relocateSemanticRoomPackAnnexesV2,
} from '../../../src/dungeon-v2/SemanticRoomPackAnnexRelocationV2.js';

const RECORD_COLLECTIONS = Object.freeze([
  'modulePlacements',
  'spatialCells',
  'structuralBoundaries',
  'walkableSurfaces',
  'structuralFixtures',
  'traversalLinks',
  'falls',
  'anchors',
  'safeAnchors',
  'mechanisms',
  'environmentStates',
  'basins',
  'hazards',
  'discoveries',
  'rewards',
  'encounters',
  'actions',
]);

const EXPECTED_BOUNDS = Object.freeze({
  rdx_factory_corkscrew_exchange: {
    min: { x: 132, y: -1.2, z: -92 },
    max: { x: 168, y: 18.5, z: -58 },
  },
  rdx_waterworks_freight_sump: {
    min: { x: -91, y: -9.3, z: -94 },
    max: { x: -49, y: 10.5, z: -56 },
  },
  rdx_magma_foundry_undercroft: {
    min: { x: -18, y: -29, z: -307 },
    max: { x: 18, y: -12, z: -273 },
  },
  rdx_electric_transformer_undercroft: {
    min: { x: -18, y: -28.8, z: -307 },
    max: { x: 18, y: -11.5, z: -273 },
  },
});

function addVector(value, delta) {
  return {
    x: Math.round((value.x + delta.x) * 1e9) / 1e9,
    y: Math.round((value.y + delta.y) * 1e9) / 1e9,
    z: Math.round((value.z + delta.z) * 1e9) / 1e9,
  };
}

function boundsOverlap(left, right, epsilon = 1e-6) {
  return left.min.x < right.max.x - epsilon && left.max.x > right.min.x + epsilon
    && left.min.y < right.max.y - epsilon && left.max.y > right.min.y + epsilon
    && left.min.z < right.max.z - epsilon && left.max.z > right.min.z + epsilon;
}

function connectorRouteSnapshot(plan) {
  const result = {};
  for (const collection of RECORD_COLLECTIONS) {
    const records = (plan[collection] ?? []).filter((record) => (
      record.connector === true
      || String(record.id ?? '').includes('.connector.')
      || String(record.id ?? '').startsWith('connector.')
    ));
    if (records.length > 0) result[collection] = records;
  }
  return result;
}

function recordsById(records) {
  return new Map((records ?? []).map((record) => [record.id, record]));
}

function assertManifestRecordParity(sourcePlacement, targetPlacement, delta) {
  assert.deepEqual(targetPlacement.placedRecordIds, sourcePlacement.placedRecordIds);
  for (const key of [
    'sockets',
    'portals',
    'structuralBoundaries',
    'walkableSurfaces',
    'structuralFixtures',
    'transformedCollisionVolumes',
    'anchors',
    'mechanisms',
  ]) {
    assert.deepEqual(
      (targetPlacement[key] ?? []).map(({ id }) => id),
      (sourcePlacement[key] ?? []).map(({ id }) => id),
      `${sourcePlacement.placementId}.${key} IDs changed`,
    );
  }

  const sourceSockets = recordsById(sourcePlacement.sockets);
  for (const socket of targetPlacement.sockets) {
    const source = sourceSockets.get(socket.id);
    assert.deepEqual(socket.localPosition, source.localPosition);
    assert.deepEqual(socket.localForward, source.localForward);
    assert.deepEqual(socket.worldPosition, addVector(source.worldPosition, delta));
    assert.deepEqual(socket.worldForward, source.worldForward);
    assert.deepEqual(socket.aperture, source.aperture);
  }

  for (const key of ['structuralBoundaries', 'walkableSurfaces', 'structuralFixtures']) {
    const sourceRecords = recordsById(sourcePlacement[key]);
    for (const record of targetPlacement[key]) {
      const source = sourceRecords.get(record.id);
      assert.ok(source, `${sourcePlacement.placementId}.${key}:${record.id} missing from source`);
      if (source.worldCenter) {
        assert.deepEqual(record.worldCenter, addVector(source.worldCenter, delta));
      } else if (source.bounds?.min && source.bounds?.max) {
        assert.deepEqual(record.bounds, {
          min: addVector(source.bounds.min, delta),
          max: addVector(source.bounds.max, delta),
        });
      }
      assert.deepEqual(record.worldSize, source.worldSize);
      assert.equal(record.worldYawRadians, source.worldYawRadians);
    }
  }

  const sourceColliders = recordsById(sourcePlacement.transformedCollisionVolumes);
  for (const collider of targetPlacement.transformedCollisionVolumes) {
    const source = sourceColliders.get(collider.id);
    assert.deepEqual(collider.localCenter, source.localCenter);
    assert.deepEqual(collider.worldCenter, addVector(source.worldCenter, delta));
    assert.deepEqual(collider.worldSize, source.worldSize);
    assert.equal(collider.worldYawRadians, source.worldYawRadians);
    if (collider.shape === 'cylinder') {
      assert.equal(
        collider.worldHeight,
        source.worldHeight,
        `${collider.id} cylinder height is a dimension, not a world-space elevation`,
      );
    }
  }

  const sourceMechanisms = recordsById(sourcePlacement.mechanisms);
  for (const mechanism of targetPlacement.mechanisms ?? []) {
    const source = sourceMechanisms.get(mechanism.id);
    const sourceStates = recordsById(source?.stableStates);
    for (const state of mechanism.stableStates ?? []) {
      if (!Number.isFinite(state.worldHeight)) continue;
      assert.equal(
        state.worldHeight,
        Math.round((sourceStates.get(state.id).worldHeight + delta.y) * 1e9) / 1e9,
        `${state.id} mechanism stop height must move with its annex`,
      );
    }
  }
}

for (const hazardType of ['magma', 'electrical']) {
  test(`semantic room-pack annex relocation has exact immutable bounds and record parity (${hazardType})`, () => {
    const source = createGoldenDungeonPlanV2({
      seed: `annex-relocation-${hazardType}`,
      hazardType,
    });
    const sourcePortals = clonePlanData(source.portals);
    const sourceConnectorRoutes = connectorRouteSnapshot(source);
    const sourcePlacements = new Map(source.semanticRoomPackPlacements.map((placement) => (
      [placement.placementId, placement]
    )));

    const result = prepareSemanticRoomPackAnnexRelocationV2(source);
    assert.equal(result.accepted, true, JSON.stringify(result.errors, null, 2));
    assert.equal(isSerializablePlanValue(result.plan.semanticRoomPackAnnexRelocation), true);
    assert.equal(result.plan.semanticRoomPackAnnexRelocation.planPortalsRelocated, false);
    assert.equal(result.plan.semanticRoomPackAnnexRelocation.oldConnectorRoutesRelocated, false);
    assert.deepEqual(result.plan.portals, sourcePortals);
    assert.deepEqual(connectorRouteSnapshot(result.plan), sourceConnectorRoutes);
    assert.equal(result.plan.semanticRoomPackPlacements.length, 3);
    const minimumWalkableY = Math.min(
      ...result.plan.walkableSurfaces.map((surface) => surface.bounds.min.y),
    );
    assert.equal(result.plan.recoverySafeguard.minimumWalkableY, minimumWalkableY);
    assert.equal(result.plan.recoverySafeguard.planeY, minimumWalkableY - 8);
    assert.equal(result.plan.semanticRoomPackAnnexRelocation.minimumWalkableY, minimumWalkableY);
    assert.equal(
      result.plan.semanticRoomPackAnnexRelocation.recoverySafeguardPlaneY,
      minimumWalkableY - 8,
    );

    for (const placement of result.plan.semanticRoomPackPlacements) {
      const sourcePlacement = sourcePlacements.get(placement.placementId);
      const target = SEMANTIC_ROOM_PACK_ANNEX_TARGETS_V2[placement.roomId];
      const ledger = result.plan.semanticRoomPackAnnexRelocation.placements.find(({ placementId }) => (
        placementId === placement.placementId
      ));
      assert.ok(sourcePlacement);
      assert.ok(target);
      assert.ok(ledger);
      assert.deepEqual(placement.placementTransform.translation, target.translation);
      assert.equal(
        placement.placementTransform.yawQuarterTurns,
        sourcePlacement.placementTransform.yawQuarterTurns,
      );
      assert.deepEqual(placement.placementTransform.scale, sourcePlacement.placementTransform.scale);
      assert.deepEqual(placement.worldBounds, EXPECTED_BOUNDS[placement.roomId]);
      assert.deepEqual(ledger.oldWorldBounds, sourcePlacement.worldBounds);
      assert.deepEqual(ledger.newWorldBounds, EXPECTED_BOUNDS[placement.roomId]);
      assert.equal(validateSemanticRoomPackPlacementV2(placement).accepted, true);
      assert.equal(Object.isFrozen(placement), true);
      assertManifestRecordParity(sourcePlacement, placement, ledger.delta);

      for (const [collection, ids] of Object.entries(ledger.relocatedRecordIds)) {
        assert.equal(new Set(ids).size, ids.length, `${placement.placementId}.${collection} duplicated IDs`);
        const sourceIds = new Set((source[collection] ?? []).map((record) => (
          record.id ?? record.placementId
        )));
        const targetIds = new Set((result.plan[collection] ?? []).map((record) => (
          record.id ?? record.placementId
        )));
        for (const id of ids) {
          assert.equal(sourceIds.has(id), true, `${collection}:${id} missing before relocation`);
          assert.equal(targetIds.has(id), true, `${collection}:${id} missing after relocation`);
        }
      }
    }
  });

  test(`semantic room-pack annexes do not intersect any of the eleven canonical V1 room bodies (${hazardType})`, () => {
    const source = createGoldenDungeonPlanV2({
      seed: `annex-native-overlap-${hazardType}`,
      hazardType,
    });
    const result = prepareSemanticRoomPackAnnexRelocationV2(source);
    const composition = createLegacyFixedRoomGoldenCompositionV2();
    assert.equal(result.accepted, true, JSON.stringify(result.errors, null, 2));
    assert.equal(composition.placements.length, 11);
    for (const annex of result.plan.semanticRoomPackPlacements) {
      for (const native of composition.placements) {
        assert.equal(
          boundsOverlap(annex.worldBounds, native.worldBounds),
          false,
          `${annex.placementId} overlaps ${native.placementId}`,
        );
      }
    }
  });
}

test('mutating annex relocation keeps compiled placements frozen and leaves old routes for the coordinator', () => {
  const source = createGoldenDungeonPlanV2({
    seed: 'annex-mutation-contract',
    hazardType: 'magma',
  });
  const mutable = clonePlanData(source);
  const sourcePortals = clonePlanData(mutable.portals);
  const sourceConnectorRoutes = connectorRouteSnapshot(mutable);
  const returned = relocateSemanticRoomPackAnnexesV2(mutable);
  assert.equal(returned, mutable);
  assert.ok(mutable.semanticRoomPackPlacements.every((placement) => Object.isFrozen(placement)));
  assert.deepEqual(mutable.portals, sourcePortals);
  assert.deepEqual(connectorRouteSnapshot(mutable), sourceConnectorRoutes);
  assert.equal(
    mutable.semanticRoomPackAnnexRelocation.status,
    'relocated-awaiting-canonical-route-rebuild',
  );
});
