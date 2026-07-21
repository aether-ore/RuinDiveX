import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { LEGACY_FIXED_ROOM_MODULE_CATALOG_V2 } from '../../../src/dungeon-v2/LegacyFixedRoomModuleCatalogV2.js';

const PLACEMENT_ID = 'placement.extraction';
const NATIVE_PROFILE = 'legacy-fixed-room-native-v2';
const EXPECTED_DESCRIPTOR_IDS = LEGACY_FIXED_ROOM_MODULE_CATALOG_V2
  .map(({ id }) => id)
  .sort();
// InstancedMesh stores transforms in Float32 matrices.  At the Shrine's
// x ~= 200m world coordinates, the representable step is larger than 1e-6m
// (for example 196.2 becomes 196.2000061).  This tolerance is still 5,000x
// tighter than the plan's 0.05m render/collision parity contract.
const FLOAT32_WORLD_BOUNDS_TOLERANCE = 1e-5;

function assertBoundsEqual(actual, expected, label) {
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(actual.min[axis] - expected.min[axis]) <= FLOAT32_WORLD_BOUNDS_TOLERANCE,
      `${label}.min.${axis} differs`);
    assert.ok(Math.abs(actual.max[axis] - expected.max[axis]) <= FLOAT32_WORLD_BOUNDS_TOLERANCE,
      `${label}.max.${axis} differs`);
  }
}

function instanceBounds(batch, index) {
  batch.geometry.computeBoundingBox();
  const matrix = new THREE.Matrix4();
  batch.getMatrixAt(index, matrix);
  assert.ok(matrix.elements.every(Number.isFinite), `${batch.name}[${index}] has a finite transform`);
  return batch.geometry.boundingBox.clone().applyMatrix4(matrix);
}

for (const undercroftType of ['magma', 'electrical']) {
  test(`actual ${undercroftType} seed assembles a native V1 Shrine, route, supports, rewards, and extraction`, () => {
    const seed = `native-extraction-shrine-${undercroftType}-actual-seed`;
    const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({ seed, undercroftType }), {
      throwOnError: false,
    });
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    const plan = validation.plan;
    const placement = plan.modulePlacements.find(({ id }) => id === PLACEMENT_ID);
    assert.equal(placement?.presentationProfileId, NATIVE_PROFILE);
    assert.equal(placement.descriptorId, 'v1-room.refractor-shrine');
    assert.equal(plan.nativeFixedRoomIntegration.activePlacementIds.length, 11,
      'the actual golden seed must place every catalogued native V1 room');
    assert.equal(new Set(plan.nativeFixedRoomIntegration.activePlacementIds).size, 11,
      'every native V1 room requires one unique plan placement');
    assert.deepEqual([...plan.nativeFixedRoomIntegration.activeDescriptorIds].sort(),
      EXPECTED_DESCRIPTOR_IDS,
      'the actual golden seed must place every native V1 descriptor exactly once');
    assert.deepEqual(plan.nativeFixedRoomIntegration.incompleteDescriptorIds, []);
    assert.equal(plan.nativeFixedRoomIntegration.genericFallbackGeometry, false);

    const extractionBoundaries = plan.structuralBoundaries.filter(({ regionId }) => regionId === 'extraction');
    const extractionSurfaces = plan.walkableSurfaces.filter(({ regionId }) => regionId === 'extraction');
    assert.ok(extractionBoundaries.length > 1000, 'segmented native V1 enclosure is plan-owned');
    assert.equal(extractionBoundaries.every(({ presentationOwnerId }) => presentationOwnerId === PLACEMENT_ID), true);
    assert.equal(extractionSurfaces.length, 713);
    assert.equal(extractionSurfaces.every(({ presentationOwnerId }) => presentationOwnerId === PLACEMENT_ID), true);
    assert.equal(extractionBoundaries.some(({ id }) => id.startsWith('boundary.extraction.')), false,
      'generic extraction shell boundaries are absent');
    assert.equal(extractionSurfaces.some(({ id }) => id.startsWith('surface.extraction.')), false,
      'generic extraction floor and ramp slabs are absent');

    const nativeFloor = extractionBoundaries.find(({ side }) => side === 'floor');
    assert.equal(nativeFloor.materialProfileId, 'legacy-floor');
    assert.equal(nativeFloor.presentationOwnerId, PLACEMENT_ID);
    assert.deepEqual(nativeFloor.bounds, {
      min: { x: 187.8, y: 15.780000000000001, z: -35 },
      max: { x: 252.2, y: 16, z: 35 },
    });

    const portal = plan.portals.find(({ id }) => id === 'portal.machine-core-extraction-shrine');
    const routeEnd = portal.physicalRoute.routePoints.at(-1);
    assert.deepEqual(routeEnd, { x: 187.8, y: 20.05, z: -19.6 });
    assert.equal(portal.to.nativeFixedRoomSocketId,
      'placement.extraction:socket.v1-room.refractor-shrine.catwalk.north-east-bucket');
    assert.equal(portal.physicalRoute.endpointSurfaceIds.to.startsWith(`${PLACEMENT_ID}:surface.`), true);
    const connectorSurface = plan.walkableSurfaces.find(({ id }) => (
      id === portal.physicalRoute.surfaceIds.at(-1)
    ));
    const inletSurface = plan.walkableSurfaces.find(({ id }) => (
      id === portal.physicalRoute.endpointSurfaceIds.to
    ));
    assert.ok(connectorSurface.bounds.max.x >= inletSurface.bounds.min.x - 0.001
      && connectorSurface.bounds.min.x <= inletSurface.bounds.max.x + 0.001
      && connectorSurface.bounds.max.z >= inletSurface.bounds.min.z - 0.001
      && connectorSurface.bounds.min.z <= inletSurface.bounds.max.z + 0.001,
    'the enclosed connector physically reaches the native V1 inlet surface');
    assert.equal(inletSurface.createsLedgeCandidates, false,
      'only the closed Shrine gate throat is excluded from ledge correction');

    for (const anchorId of ['anchor.refractor', 'anchor.extraction', 'anchor.safe-return']) {
      const anchor = plan.anchors.find(({ id }) => id === anchorId);
      assert.equal(anchor.nativeFixedRoomPlacementId, PLACEMENT_ID);
      assert.equal(anchor.surfaceId.startsWith(`${PLACEMENT_ID}:surface.`), true);
      const surface = plan.walkableSurfaces.find(({ id }) => id === anchor.surfaceId);
      assert.equal(surface.presentationOwnerId, PLACEMENT_ID);
      assert.equal(Math.abs(anchor.position.y - surface.bounds.max.y) <= 0.051, true);
    }
    const safeAnchor = plan.safeAnchors.find(({ id }) => id === 'safe.extraction-return');
    assert.equal(safeAnchor.nativeFixedRoomPlacementId, PLACEMENT_ID);
    assert.equal(safeAnchor.surfaceId.startsWith(`${PLACEMENT_ID}:surface.`), true);

    const supportFixtures = plan.structuralFixtures.filter(({ nativeFixedRoomPlacementId }) => (
      nativeFixedRoomPlacementId === PLACEMENT_ID
    ));
    assert.equal(supportFixtures.filter(({ type }) => type === 'native-v1-solid-deck-mass').length, 1,
      'only the explicitly authored Refractor dais is a solid architectural mass');
    const catwalkFrames = supportFixtures.filter(({ type }) => type === 'native-v1-catwalk-frame');
    assert.equal(catwalkFrames.length, 2,
      'the perimeter catwalk and revered mezzanine remain thin V1 framed decks');
    assert.equal(catwalkFrames.every(({ partRoles, catwalkProfile }) => (
      partRoles.includes('support-post')
      && partRoles.includes('underbeam-x')
      && partRoles.includes('underbeam-z')
      && partRoles.includes('rail-run')
      && partRoles.includes('rail-post')
      && catwalkProfile.deckAuthority === 'native-walkable-surface-0.12m'
    )), true);
    assert.equal(supportFixtures.filter(({ type }) => type === 'native-v1-ramp-support').length, 2);
    const raisedSurfaces = extractionSurfaces.filter((surface) => (
      surface.bounds.min.y > nativeFloor.bounds.max.y + 0.5
    ));
    assert.equal(raisedSurfaces.length, 224);
    assert.equal(raisedSurfaces.every(({ supportFixtureIds }) => supportFixtureIds.length === 1), true);

    const assembly = assembleDungeonPlanV2(plan);
    try {
      assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.active, true);
      assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.placementCount, 11,
        'runtime must assemble all eleven native placements without counting generic rooms');
      assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.genericFallbackGeometry, false);
      assert.equal(assembly.legacyFixedRoomPresentationDiagnostics.instanced, true);
      const shrineMappings = assembly.legacyFixedRoomVisualMappings.filter(({ placementId }) => (
        placementId === PLACEMENT_ID
      ));
      assert.equal(shrineMappings.length, 1940,
        'the Machine Factory cutover cannot perturb the Shrine native mapping contract');

      const mappedIds = new Set(shrineMappings.map(({ planId }) => planId));
      for (const record of [...extractionBoundaries, ...extractionSurfaces]) {
        assert.equal(mappedIds.has(record.id), true, `${record.id} has an exact native visual mapping`);
        assert.ok(assembly.structuralRegistry.getCollider(record.id), `${record.id} has plan collision`);
      }

      const nativeRampLocalIds = new Set(extractionSurfaces
        .filter(({ shape }) => shape === 'ramp-tile')
        .map(({ localId }) => localId));
      const rampBatches = [];
      assembly.group.traverse((object) => {
        if (object.isInstancedMesh
          && object.userData.v2LegacyFixedRoomPresentation
          && object.userData.v2ContractIds?.some((id) => nativeRampLocalIds.has(id))) {
          rampBatches.push(object);
        }
      });
      assert.ok(rampBatches.length >= 1);
      assert.equal(rampBatches.every((batch) => (
        batch.geometry.getAttribute('instanceV2TextureDimensions')
        && batch.material.map
        && batch.material.userData.v2WorldScaleTiling === true
      )), true, 'native ramp tiles use geometry-backed V1 world-tiled materials, not generic slabs');

      for (const fixture of supportFixtures.filter(({ type }) => type === 'native-v1-ramp-support')) {
        const visual = assembly.structuralRegistry.getVisual(fixture.id);
        assert.ok(visual);
        const foundationBatches = [];
        const stringerBatches = [];
        visual.traverse((object) => {
          if (object.userData.v2InstancedNativeRampFoundations) foundationBatches.push(object);
          if (object.userData.v2InstancedNativeRampStringers) stringerBatches.push(object);
        });
        assert.equal(foundationBatches.length, 1);
        assert.equal(stringerBatches.length, 1);
        const foundationBatch = foundationBatches[0];
        const stringerBatch = stringerBatches[0];
        assert.equal(foundationBatch.count, fixture.colliderBounds.length);
        assert.equal(stringerBatch.count, fixture.stringers.length);
        assert.deepEqual(foundationBatch.userData.v2ColliderIds, fixture.colliderIds);
        for (const batch of [foundationBatch, stringerBatch]) {
          const textureDimensions = batch.geometry.getAttribute('instanceV2TextureDimensions');
          assert.ok(textureDimensions);
          assert.equal(textureDimensions.count, batch.count);
          assert.deepEqual(batch.userData.v2TextureTiling, {
            mode: 'per-instance-world-dimensions',
            tileScaleMetres: 2.8,
            attribute: 'instanceV2TextureDimensions',
          });
          for (let index = 0; index < textureDimensions.count; index += 1) {
            assert.ok(textureDimensions.getX(index) > 0);
            assert.ok(textureDimensions.getY(index) > 0);
            assert.ok(textureDimensions.getZ(index) > 0);
          }
        }
        assert.equal(foundationBatch.material.userData.v2WorldScaleTiling, true);
        assert.equal(foundationBatch.material.map.userData.v2WorldScaleTiling, true);
        assert.equal(stringerBatch.material.userData.v2LegacyRuinMaterial, true);
        for (const [index, expectedBounds] of fixture.colliderBounds.entries()) {
          const worldBox = instanceBounds(foundationBatch, index);
          assertBoundsEqual({
            min: { x: worldBox.min.x, y: worldBox.min.y, z: worldBox.min.z },
            max: { x: worldBox.max.x, y: worldBox.max.y, z: worldBox.max.z },
          }, expectedBounds, `${fixture.id} foundation instance ${index}`);
          const collider = assembly.structuralRegistry.getColliderById(fixture.colliderIds[index]);
          assertBoundsEqual(collider.bounds, expectedBounds, `${fixture.id} registered collider ${index}`);
        }
        for (let index = 0; index < stringerBatch.count; index += 1) {
          const box = instanceBounds(stringerBatch, index);
          assert.equal(box.isEmpty(), false);
          assert.ok([
            box.min.x, box.min.y, box.min.z,
            box.max.x, box.max.y, box.max.z,
          ].every(Number.isFinite));
        }
      }
    } finally {
      assembly.dispose();
    }
  });
}

test('exact segmented enclosure rejects a missing native Shrine panel', () => {
  const plan = structuredClone(createGoldenDungeonPlanV2({
    seed: 'native-extraction-shrine-missing-panel',
    undercroftType: 'magma',
  }));
  const removedIndex = plan.structuralBoundaries.findIndex((boundary) => (
    boundary.presentationOwnerId === PLACEMENT_ID
    && boundary.side === 'ceiling'
  ));
  assert.ok(removedIndex >= 0);
  const [removed] = plan.structuralBoundaries.splice(removedIndex, 1);
  const validation = validateDungeonPlanV2(plan, { throwOnError: false });
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some((error) => (
    error.code === 'cell-face-coverage-gap'
    && error.details.cellId === 'cell.extraction.main'
    && error.details.side === 'ceiling'
  )), `removing ${removed.id} must expose an exact enclosure gap`);
});
