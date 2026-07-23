import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
import {
  DUNGEON_CONNECTOR_VARIANT_IDS,
  reserveDungeonConnectorFamilyFootprints,
} from '../src/DungeonConnectorVariants.js';
import { createSeededRandom, hashSeed } from '../src/reaverbots/SeededRandom.js';

const TEST_SEED = 'v1-bidirectional-connector-sweep-0000';
const VOLUME_EPSILON = 0.001;

function volumeBounds(volume) {
  const center = volume?.center;
  const size = volume?.size;
  assert.ok(center && size, `Volume ${volume?.id ?? '<unknown>'} must declare center and size.`);
  const halfX = Number(size.x) * 0.5;
  const halfY = Number(size.y) * 0.5;
  const halfZ = Number(size.z) * 0.5;
  assert.ok(
    [center.x, center.y, center.z, halfX, halfY, halfZ].every(Number.isFinite),
    `Volume ${volume?.id ?? '<unknown>'} must contain finite coordinates.`,
  );
  return {
    minX: center.x - halfX,
    maxX: center.x + halfX,
    minY: center.y - halfY,
    maxY: center.y + halfY,
    minZ: center.z - halfZ,
    maxZ: center.z + halfZ,
  };
}

function volumesOverlap(first, second) {
  const a = volumeBounds(first);
  const b = volumeBounds(second);
  return Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > VOLUME_EPSILON
    && Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > VOLUME_EPSILON
    && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > VOLUME_EPSILON;
}

function disposeDungeon(dungeon) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  dungeon?.group?.traverse?.((object) => {
    if (object.geometry?.isBufferGeometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (!material?.isMaterial) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  dungeon?.group?.clear?.();
}

function createAcceptedDungeon(seed = TEST_SEED, { browserLayoutSeed = false } = {}) {
  const generator = new DungeonGenerator({
    random: createSeededRandom(browserLayoutSeed ? hashSeed(`layout:${seed}`) : seed),
    difficulty: 1,
  });
  const inertTexture = new THREE.Texture();
  inertTexture.name = `connectorVolumeReservationTexture_${seed}`;
  generator._loadRuinTexture = () => inertTexture;
  return generator.generate();
}

function createValidationPlan(id, xOffset, occupiedVolume) {
  return {
    id,
    sourceElevation: 0,
    destinationElevation: 0,
    elevationDelta: 0,
    direction: 'level',
    fromSocket: { x: xOffset, z: 0, elevation: 0 },
    toSocket: { x: xOffset + 1, z: 0, elevation: 0 },
    connectorVariant: { traversalKind: 'walk' },
    connectorAssemblyErrors: [],
    galleryCrossSections: [],
    occupiedStructuralVolumes: [occupiedVolume],
    clearanceVolumes: [],
  };
}

function createFamilyReservationPlan(id, z, variantId) {
  const bridgePath = Array.from({ length: 15 }, (_, x) => ({ x, z }));
  const slope = variantId === DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE;
  return {
    id,
    fromRoomId: `${id}:from`,
    toRoomId: `${id}:to`,
    connectorType: 'ground_corridor',
    bridgePath,
    sourceElevation: 0,
    destinationElevation: slope ? 14 : 0,
    elevationDelta: slope ? 14 : 0,
    connectorVariantId: variantId,
    connectorVariantConstraints: { roomFootprints: [] },
    connectorVariant: slope ? {
      variantId,
      traversalKind: 'slope',
      pathContract: { selectedStraightRun: { startIndex: 1, endIndex: 13 } },
      mechanisms: [],
      construction: {
        switchbackSideSign: 1,
        sourceFlightDirection: { x: 1, z: 0 },
        returnFlightDirection: { x: -1, z: 0 },
        segmentsPerFlight: 13,
        intermediateElevation: 7,
        switchbackLandingOriginGridPoint: { x: 14, z },
        destinationLandingOriginGridPoint: { x: 0, z: z + 3 },
        destinationLaneOffsetTiles: 6,
        destinationCrossoverOriginGridPoint: { x: 13, z },
        flights: [
          {
            startGridPoint: { x: 1, z },
            startElevation: 0,
            endElevation: 7,
          },
          {
            startGridPoint: { x: 13, z: z + 3 },
            startElevation: 7,
            endElevation: 14,
          },
        ],
      },
    } : {
      variantId,
      traversalKind: 'walk',
      mechanisms: [],
      construction: {},
    },
  };
}

test('pass-one reservations expand to the assigned connector family before assembly', () => {
  const slope = createFamilyReservationPlan(
    'family-slope',
    0,
    DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
  );
  const otherwiseDisjointService = createFamilyReservationPlan(
    'nearby-service',
    5,
    DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY,
  );
  // Its generic five-column route starts one column beyond the slope's
  // generic reservation, but its 10 m layer intersects the returning flight
  // that only exists once the slope family is assigned.
  otherwiseDisjointService.sourceElevation = 10;
  otherwiseDisjointService.destinationElevation = 10;
  const collision = reserveDungeonConnectorFamilyFootprints([
    slope,
    otherwiseDisjointService,
  ]);

  assert.equal(collision.diagnostics.accepted, false);
  assert.ok(collision.diagnostics.collisionPairs.some((pair) => (
    pair.firstConnectionId === slope.id && pair.secondConnectionId === otherwiseDisjointService.id
  )));
  const slopeReservation = collision.connectionPlans[0].connectorVariantConstraints.familyReservation;
  assert.equal(slopeReservation.halfWidthTiles, 7);
  assert.ok(slopeReservation.footprintColumnCount > slope.bridgePath.length * 5);
  assert.ok(slopeReservation.connectorCollisionCount > 0);

  const clearService = createFamilyReservationPlan(
    'clear-service',
    20,
    DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY,
  );
  const accepted = reserveDungeonConnectorFamilyFootprints([slope, clearService]);
  assert.equal(accepted.diagnostics.accepted, true, accepted.diagnostics.errors.join('\n'));
  assert.equal(
    accepted.connectionPlans[1].connectorVariantConstraints.familyReservation.halfWidthTiles,
    2,
  );
});

test('seed 0003 deterministically reselects a collision-free family assignment', { timeout: 60_000 }, () => {
  const dungeon = createAcceptedDungeon('v1-bidirectional-connector-sweep-0003', {
    browserLayoutSeed: true,
  });
  try {
    assert.equal(dungeon.progression?.validation?.accepted, true);
    assert.equal(dungeon.connectorAssignmentSearchDiagnostics?.accepted, true);
    assert.ok(dungeon.connectorAssignmentSearchDiagnostics.evaluatedAttemptCount >= 1);
    assert.equal(dungeon.connectorFootprintReservationDiagnostics?.accepted, true);
    assert.deepEqual(dungeon.connectorFootprintReservationDiagnostics.collisionPairs, []);
    const elevationPlans = (dungeon.connectionPlans ?? []).filter((plan) => (
      Math.abs(Number(plan.elevationDelta ?? 0)) === 14
    ));
    assert.ok(elevationPlans.some((plan) => plan.direction === 'ascending'));
    assert.ok(elevationPlans.some((plan) => plan.direction === 'descending'));
    assert.deepEqual(
      new Set(elevationPlans.map((plan) => plan.connectorVariantId)),
      new Set([
        DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
        DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
        DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
      ]),
    );
  } finally {
    disposeDungeon(dungeon);
  }
});

test('accepted generated plans reserve full connector width and have disjoint structural/clearance volumes', { timeout: 60_000 }, () => {
  const dungeon = createAcceptedDungeon();
  try {
    const plans = dungeon.connectionPlans ?? [];
    assert.ok(plans.length > 0);
    assert.equal(dungeon.progression?.validation?.accepted, true);
    assert.equal(
      dungeon.connectorFootprintReservationDiagnostics?.accepted,
      true,
      dungeon.connectorFootprintReservationDiagnostics?.errors?.join('\n'),
    );

    for (const plan of plans) {
      const constraints = plan.connectorVariantConstraints;
      assert.equal(
        constraints?.reservedFootprintHalfWidthTiles,
        2,
        `${plan.id} must reserve the three walkable lanes plus a support/clearance lane on each side.`,
      );
      assert.ok(
        constraints.reservedFootprintColumnCount > 0,
        `${plan.id} must retain its deterministic full-width reservation footprint.`,
      );
      assert.equal(constraints.footprintRoomCollisionCount, 0, `${plan.id} overlaps an unrelated room footprint.`);
      assert.equal(constraints.footprintConnectorCollisionCount, 0, `${plan.id} overlaps an earlier connector footprint.`);
      assert.ok(
        constraints.familyReservation?.footprintColumnCount > 0,
        `${plan.id} must retain its assigned-family footprint reservation.`,
      );
      assert.equal(constraints.familyReservation.roomCollisionCount, 0);
      assert.equal(constraints.familyReservation.connectorCollisionCount, 0);
      assert.ok(plan.occupiedStructuralVolumes?.length > 0, `${plan.id} has no structural volume contract.`);
      assert.ok(plan.clearanceVolumes?.length > 0, `${plan.id} has no clearance volume contract.`);
      for (const volume of [...plan.occupiedStructuralVolumes, ...plan.clearanceVolumes]) {
        volumeBounds(volume);
      }
    }

    for (let firstIndex = 0; firstIndex < plans.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < plans.length; secondIndex += 1) {
        const first = plans[firstIndex];
        const second = plans[secondIndex];
        const firstVolumes = [...first.occupiedStructuralVolumes, ...first.clearanceVolumes];
        const secondVolumes = [...second.occupiedStructuralVolumes, ...second.clearanceVolumes];
        for (const firstVolume of firstVolumes) {
          for (const secondVolume of secondVolumes) {
            assert.equal(
              volumesOverlap(firstVolume, secondVolume),
              false,
              `${first.id} and ${second.id} overlap (${firstVolume.id} / ${secondVolume.id}).`,
            );
          }
        }
      }
    }
  } finally {
    disposeDungeon(dungeon);
  }
});

test('connector assembly validation rejects a pairwise structural-volume overlap', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const sharedVolume = {
    id: 'shared-test-volume',
    center: { x: 12, y: 0, z: 8 },
    size: { x: 2.8, y: 0.2, z: 2.8 },
  };
  const first = createValidationPlan('first-connector', 0, {
    ...sharedVolume,
    id: 'first-structural-volume',
  });
  const second = createValidationPlan('second-connector', 10, {
    ...sharedVolume,
    id: 'second-structural-volume',
  });
  const floorTiles = [
    { x: 0, z: 0, elevation: 0 },
    { x: 1, z: 0, elevation: 0 },
    { x: 10, z: 0, elevation: 0 },
    { x: 11, z: 0, elevation: 0 },
  ];

  const validation = generator._validateConnectorTraversalAssembly({
    floorTiles,
    rooms: [],
    connectionPlans: [first, second],
  });

  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some((error) => (
    error.includes('first-connector and second-connector have overlapping connector volumes')
    && error.includes('first-structural-volume / second-structural-volume')
  )), validation.errors.join('\n'));
});
