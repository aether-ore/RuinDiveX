import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../../src/TraversalCapabilities.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { ACCEPTANCE_LIMITS } from '../helpers/accepted-fixture.mjs';

const MINIMUM_ESCAPE_SPAN = Math.max(
  ACCEPTANCE_LIMITS.minimumLandingWidth,
  PLAYER_TRAVERSAL_ENVELOPE.collisionRadius * 2
    + ACCEPTANCE_LIMITS.visualColliderSampleSpacing * 2,
);

function overlapLength(minA, maxA, minB, maxB) {
  return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
}

function findNonPairedStackedConnectorFloors(plan) {
  const surfaceById = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
  const connectorFloors = [];
  const ownerBySurfaceId = new Map();
  for (const portal of plan.portals) {
    for (const surfaceId of portal.physicalRoute?.surfaceIds ?? []) {
      const surface = surfaceById.get(surfaceId);
      assert.ok(surface, `${portal.id} references missing connector floor ${surfaceId}`);
      const previousOwner = ownerBySurfaceId.get(surfaceId);
      assert.ok(!previousOwner || previousOwner === portal.id,
        `${surfaceId} is ambiguously owned by ${previousOwner} and ${portal.id}`);
      if (previousOwner) continue;
      ownerBySurfaceId.set(surfaceId, portal.id);
      connectorFloors.push({ portalId: portal.id, surface });
    }
  }

  const violations = [];
  for (let leftIndex = 0; leftIndex < connectorFloors.length; leftIndex += 1) {
    const left = connectorFloors[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < connectorFloors.length; rightIndex += 1) {
      const right = connectorFloors[rightIndex];
      if (left.portalId === right.portalId) continue;
      const overlapX = overlapLength(
        left.surface.bounds.min.x,
        left.surface.bounds.max.x,
        right.surface.bounds.min.x,
        right.surface.bounds.max.x,
      );
      const overlapZ = overlapLength(
        left.surface.bounds.min.z,
        left.surface.bounds.max.z,
        right.surface.bounds.min.z,
        right.surface.bounds.max.z,
      );
      const leftFloorY = left.surface.bounds.max.y;
      const rightFloorY = right.surface.bounds.max.y;
      const verticalSeparation = Math.abs(leftFloorY - rightFloorY);
      if (overlapX + 1e-9 < MINIMUM_ESCAPE_SPAN
        || overlapZ + 1e-9 < MINIMUM_ESCAPE_SPAN
        || verticalSeparation + 1e-9 < PLAYER_TRAVERSAL_ENVELOPE.headClearance
        || verticalSeparation > ACCEPTANCE_LIMITS.cameraProofRange) continue;
      const upper = leftFloorY >= rightFloorY ? left : right;
      const lower = upper === left ? right : left;
      violations.push(Object.freeze({
        upperPortalId: upper.portalId,
        upperSurfaceId: upper.surface.id,
        upperFloorY: upper.surface.bounds.max.y,
        lowerPortalId: lower.portalId,
        lowerSurfaceId: lower.surface.id,
        lowerFloorY: lower.surface.bounds.max.y,
        overlapX,
        overlapZ,
        verticalSeparation,
      }));
    }
  }
  return violations.sort((left, right) => (
    `${left.upperPortalId}:${left.upperSurfaceId}:${left.lowerPortalId}:${left.lowerSurfaceId}`
      .localeCompare(`${right.upperPortalId}:${right.upperSurfaceId}:${right.lowerPortalId}:${right.lowerSurfaceId}`)
  ));
}

test('reported Security/Assembly connector fall is classified as non-paired vertical stacking', () => {
  const reportedCase = {
    portals: [
      {
        id: 'portal.security-assembly',
        physicalRoute: { surfaceIds: ['surface.connector.security-assembly.1'] },
      },
      {
        id: 'portal.freight-security-shortcut',
        physicalRoute: { surfaceIds: ['surface.connector.freight-security-shortcut.2'] },
      },
    ],
    walkableSurfaces: [
      {
        id: 'surface.connector.security-assembly.1',
        bounds: {
          min: { x: -64.8, y: 0, z: 33.4 },
          max: { x: -62.4, y: 0.3, z: 64.2 },
        },
      },
      {
        id: 'surface.connector.freight-security-shortcut.2',
        bounds: {
          min: { x: -112.8, y: -10, z: 58.6 },
          max: { x: -27.2, y: -9.7, z: 63.4 },
        },
      },
    ],
  };
  const violations = findNonPairedStackedConnectorFloors(reportedCase);
  assert.equal(violations.length, 1);
  assert.deepEqual({
    ...violations[0],
    overlapX: Math.round(violations[0].overlapX * 10) / 10,
    overlapZ: Math.round(violations[0].overlapZ * 10) / 10,
  }, {
    upperPortalId: 'portal.security-assembly',
    upperSurfaceId: 'surface.connector.security-assembly.1',
    upperFloorY: 0.3,
    lowerPortalId: 'portal.freight-security-shortcut',
    lowerSurfaceId: 'surface.connector.freight-security-shortcut.2',
    lowerFloorY: -9.7,
    overlapX: 2.4,
    overlapZ: 4.8,
    verticalSeparation: 10,
  });
});

for (const undercroftType of ['magma', 'electrical']) {
  test(`${undercroftType} actual golden seed has no non-paired stacked connector floors`, () => {
    const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
      seed: `m1-golden-${undercroftType}`,
      undercroftType,
    }));
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    assert.deepEqual(
      findNonPairedStackedConnectorFloors(validation.plan),
      [],
      'Different portal routes share a player/camera-sized vertical column. A failed upper floor can drop the player into an unrelated enclosed connector.',
    );
  });
}
