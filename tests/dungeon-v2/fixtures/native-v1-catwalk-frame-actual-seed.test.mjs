import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../../src/TraversalCapabilities.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { assertAcceptedDungeonFixture } from '../helpers/accepted-fixture.mjs';

const ACTIVE_NATIVE_PLACEMENTS = Object.freeze({
  'placement.security': { frameCount: 1, massCount: 0 },
  'placement.assembly': { frameCount: 2, massCount: 0 },
  'placement.server': { frameCount: 2, massCount: 0 },
  'placement.extraction': { frameCount: 2, massCount: 1 },
});
const CAPSULE_RADIUS = PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
const CAPSULE_HEIGHT = Math.max(3.2, PLAYER_TRAVERSAL_ENVELOPE.headClearance);
const TOLERANCE = 1e-5;

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= TOLERANCE,
    `${label}: expected ${expected}, received ${actual}`);
}

function assertBoundsEqual(actual, expected, label) {
  for (const axis of ['x', 'y', 'z']) {
    close(actual.min[axis], expected.min[axis], `${label}.min.${axis}`);
    close(actual.max[axis], expected.max[axis], `${label}.max.${axis}`);
  }
}

function instanceBounds(batch, index) {
  batch.geometry.computeBoundingBox();
  const matrix = new THREE.Matrix4();
  batch.getMatrixAt(index, matrix);
  return batch.geometry.boundingBox.clone().applyMatrix4(matrix);
}

function capsuleIntersectsBounds(position, bounds) {
  if (bounds.max.y <= position.y + 0.03
    || bounds.min.y >= position.y + CAPSULE_HEIGHT - 0.005) return false;
  const dx = Math.max(bounds.min.x - position.x, 0, position.x - bounds.max.x);
  const dz = Math.max(bounds.min.z - position.z, 0, position.z - bounds.max.z);
  return dx * dx + dz * dz < CAPSULE_RADIUS * CAPSULE_RADIUS - 1e-8;
}

function assertCapsuleClear(position, colliderBounds, label) {
  const blockers = colliderBounds
    .map((bounds, index) => ({ bounds, index }))
    .filter(({ bounds }) => capsuleIntersectsBounds(position, bounds));
  assert.deepEqual(blockers, [], `${label} intersects native frame parts`);
}

for (const undercroftType of ['magma', 'electrical']) {
  test(`actual ${undercroftType} seed keeps V1 catwalks thin, supported, rendered, colliding, and capsule-clear`, () => {
    const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
      seed: `native-v1-catwalk-frame-${undercroftType}-actual-seed`,
      undercroftType,
    }), { throwOnError: false });
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    const plan = validation.plan;
    assertAcceptedDungeonFixture(plan);

    const surfaceById = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
    const assembly = assembleDungeonPlanV2(plan);
    let alongRouteProbeCount = 0;
    let underRouteProbeCount = 0;
    try {
      for (const [placementId, expected] of Object.entries(ACTIVE_NATIVE_PLACEMENTS)) {
        const supportFixtures = plan.structuralFixtures.filter(({ nativeFixedRoomPlacementId }) => (
          nativeFixedRoomPlacementId === placementId
        ));
        const frames = supportFixtures.filter(({ type }) => type === 'native-v1-catwalk-frame');
        const masses = supportFixtures.filter(({ type }) => type === 'native-v1-solid-deck-mass');
        assert.equal(frames.length, expected.frameCount, `${placementId} frame count`);
        assert.equal(masses.length, expected.massCount, `${placementId} explicit mass count`);
        for (const mass of masses) {
          assert.equal(mass.supportedSurfaceIds.every((surfaceId) => (
            surfaceById.get(surfaceId)?.support?.style === 'solid_mass'
          )), true, `${mass.id} can support only explicitly authored solid-mass surfaces`);
        }

        const placementSurfaces = plan.walkableSurfaces.filter(({ presentationOwnerId }) => (
          presentationOwnerId === placementId
        ));
        const placementFrameBounds = frames.flatMap(({ colliderBounds }) => colliderBounds);
        for (const frame of frames) {
          assert.equal(frame.sourceArchitecture,
            'DungeonGenerator._addFactoryTileSupports+_addFactoryRailRuns');
          assert.equal(frame.colliderIds.length, frame.colliderBounds.length);
          assert.equal(frame.colliderIds.length, frame.partRoles.length);
          assert.equal(frame.catwalkProfile.deckAuthority, 'native-walkable-surface-0.12m');
          for (const role of ['support-post', 'underbeam-x', 'underbeam-z', 'rail-run', 'rail-post']) {
            assert.ok(frame.partRoles.includes(role), `${frame.id} is missing ${role}`);
          }
          for (const [index, bounds] of frame.colliderBounds.entries()) {
            const size = {
              x: bounds.max.x - bounds.min.x,
              y: bounds.max.y - bounds.min.y,
              z: bounds.max.z - bounds.min.z,
            };
            assert.equal(size.y > 1 && size.x > 2.7 && size.z > 2.7, false,
              `${frame.id}/${frame.partRoles[index]} recreates a broad floor-to-deck obstruction`);
            const registered = assembly.structuralRegistry.getColliderById(frame.colliderIds[index]);
            assert.ok(registered, `${frame.colliderIds[index]} is registered`);
            assertBoundsEqual(registered.bounds, bounds, `${frame.colliderIds[index]} collider parity`);
          }

          const visual = assembly.structuralRegistry.getVisual(frame.id);
          const batches = visual?.children.filter(({ userData }) => (
            userData.v2InstancedNativeCatwalkFrame === true
          )) ?? [];
          assert.equal(batches.length, 2,
            `${frame.id} has separate exact supportMetal and factoryRail render batches`);
          assert.equal(batches.reduce((count, batch) => count + batch.count, 0),
            frame.colliderBounds.length);
          assert.deepEqual(new Set(batches.map(({ userData }) => userData.v2FrameMaterialProfileId)),
            new Set(['legacy-support', 'legacy-rail']));
          for (const batch of batches) {
            assert.equal(batch.userData.v2CameraOcclusionClass, 'elevated-catwalk');
            assert.equal(batch.userData.v2CameraOcclusionInstanceMode, 'per-instance');
            assert.equal(batch.geometry.getAttribute('instanceV2TextureDimensions').count, batch.count);
            const expectsRail = batch.userData.v2FrameMaterialProfileId === 'legacy-rail';
            assert.equal(batch.userData.v2PartRoles.every((role) => role.startsWith('rail-') === expectsRail), true);
            assert.match(batch.material.name, expectsRail ? /legacy-rail/ : /legacy-support/);
            for (let batchIndex = 0; batchIndex < batch.count; batchIndex += 1) {
              const partIndex = batch.userData.v2FramePartIndices[batchIndex];
              const bounds = instanceBounds(batch, batchIndex);
              assertBoundsEqual({
                min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
                max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
              }, frame.colliderBounds[partIndex], `${frame.id} visual part ${partIndex}`);
            }
          }

          const supported = frame.supportedSurfaceIds.map((surfaceId) => surfaceById.get(surfaceId));
          assert.equal(supported.every(Boolean), true);
          assert.equal(supported.every(({ size }) => Math.abs(size.y - 0.12) <= 1e-9), true,
            `${frame.id} supports only the original thin V1 walkable decks`);
          for (const surface of supported) {
            assertCapsuleClear({
              x: surface.center.x,
              y: surface.bounds.max.y,
              z: surface.center.z,
            }, placementFrameBounds, `${surface.id} deck centerline`);
            alongRouteProbeCount += 1;

            const lowerSurface = placementSurfaces.find((candidate) => (
              candidate.localTile.x === surface.localTile.x
              && candidate.localTile.z === surface.localTile.z
              && candidate.topY <= surface.topY - CAPSULE_HEIGHT - 0.1
            ));
            if (lowerSurface) {
              assertCapsuleClear({
                x: surface.center.x,
                y: lowerSurface.bounds.max.y,
                z: surface.center.z,
              }, placementFrameBounds, `${surface.id} authored underpass centerline`);
              underRouteProbeCount += 1;
            }
          }

          const supportedByTile = new Map(supported.map((surface) => [
            `${surface.localTile.x}:${surface.localTile.z}`,
            surface,
          ]));
          for (const surface of supported) {
            for (const direction of [{ x: 1, z: 0 }, { x: 0, z: 1 }]) {
              const neighbor = supportedByTile.get(
                `${surface.localTile.x + direction.x}:${surface.localTile.z + direction.z}`,
              );
              if (!neighbor || Math.abs(neighbor.topY - surface.topY) > 0.01) continue;
              for (const ratio of [0.25, 0.5, 0.75]) {
                assertCapsuleClear({
                  x: THREE.MathUtils.lerp(surface.center.x, neighbor.center.x, ratio),
                  y: surface.bounds.max.y,
                  z: THREE.MathUtils.lerp(surface.center.z, neighbor.center.z, ratio),
                }, placementFrameBounds, `${surface.id} to ${neighbor.id} route sample ${ratio}`);
                alongRouteProbeCount += 1;
              }
            }
          }
        }
      }
      assert.ok(alongRouteProbeCount > 600,
        `expected extensive raised-route coverage, received ${alongRouteProbeCount}`);
      assert.ok(underRouteProbeCount > 100,
        `expected extensive open-underpass coverage, received ${underRouteProbeCount}`);
    } finally {
      assembly.dispose();
    }
  });
}
