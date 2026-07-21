// RETIRED: documents the rejected generic legacy-prefab module kit; not acceptance coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  LEGACY_AUTHORED_ASSET_CATALOG_V2,
  LEGACY_AUTHORED_ASSET_FAMILY_IDS_V2,
  LEGACY_AUTHORED_MODULE_DESCRIPTORS_V2,
  LEGACY_CODE_NATIVE_PREFABS_V2,
  LEGACY_RUIN_MATERIAL_PROFILES_V2,
  createLegacyAuthoredModulePlacementV2,
  getLegacyAuthoredModuleDescriptorV2,
} from '../../../src/dungeon-v2/LegacyAuthoredModuleKitV2.js';
import { loadMergedLegacyAuthoredPresentationV2 } from '../../../src/dungeon-v2/LegacyAuthoredPresentationLoaderV2.js';
import { isSerializablePlanValue } from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';
import {
  transformBoundsQuarterTurns,
  transformPointQuarterTurns,
} from '../../../src/dungeon-v2/DungeonSpatialMathV2.js';

const EXPECTED_MODULE_IDS = [
  'legacy-credential-pyramid-v2',
  'legacy-server-crypt-v2',
  'legacy-conveyor-factory-v2',
  'legacy-coolant-relay-v2',
  'legacy-warehouse-nest-v2',
  'legacy-refractor-shrine-v2',
];

const SIDES = ['north', 'south', 'east', 'west', 'floor', 'ceiling'];

function localAssetUrl(url) {
  assert.match(url, /^\/assets\//);
  return new URL(`../../../${url.slice(1)}`, import.meta.url);
}

function contains2d(surface, point, epsilon = 0.011) {
  return Math.abs(point.x - surface.center.x) <= surface.dimensions.x / 2 + epsilon
    && Math.abs(point.z - surface.center.z) <= surface.dimensions.z / 2 + epsilon;
}

test('legacy-authored module kit is immutable, serializable, renderer-free data', async () => {
  assert.deepEqual(LEGACY_AUTHORED_MODULE_DESCRIPTORS_V2.map(({ id }) => id), EXPECTED_MODULE_IDS);
  for (const collection of [
    LEGACY_AUTHORED_ASSET_CATALOG_V2,
    LEGACY_CODE_NATIVE_PREFABS_V2,
    LEGACY_RUIN_MATERIAL_PROFILES_V2,
    LEGACY_AUTHORED_MODULE_DESCRIPTORS_V2,
  ]) {
    assert.equal(Object.isFrozen(collection), true);
    assert.equal(isSerializablePlanValue(collection), true);
    assert.doesNotThrow(() => JSON.stringify(collection));
  }

  const source = await readFile(new URL('../../../src/dungeon-v2/LegacyAuthoredModuleKitV2.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]three(?:\/|['"])/);
  assert.doesNotMatch(source, /new THREE\./);
  assert.doesNotMatch(source, /from\s+['"][^'"]*DungeonGenerator\.js['"]/);
  assert.equal(typeof loadMergedLegacyAuthoredPresentationV2, 'function', 'optional browser loader remains lazy and Node-safe');
});

test('catalog references existing V1 art and avoids duplicate industrial wall payloads', async () => {
  const assets = [
    ...Object.values(LEGACY_AUTHORED_ASSET_CATALOG_V2.textures),
    ...Object.values(LEGACY_AUTHORED_ASSET_CATALOG_V2.rooms),
    ...Object.values(LEGACY_AUTHORED_ASSET_CATALOG_V2.contracts),
  ];
  await Promise.all(assets.map(({ url }) => access(fileURLToPath(localAssetUrl(url)))));

  const textureIds = new Set(Object.values(LEGACY_AUTHORED_ASSET_CATALOG_V2.textures).map(({ id }) => id));
  for (const profile of Object.values(LEGACY_RUIN_MATERIAL_PROFILES_V2)) {
    if (profile.textureAssetId !== null) {
      assert.ok(textureIds.has(profile.textureAssetId), `${profile.id} references a catalog texture`);
    }
  }
  const industrialWallTextures = Object.values(LEGACY_AUTHORED_ASSET_CATALOG_V2.textures)
    .filter(({ url }) => /wall_macro_industrial/.test(url));
  assert.equal(industrialWallTextures.length, 1, 'load the industrial atlas, not its nine duplicate tile files');
  assert.equal(LEGACY_RUIN_MATERIAL_PROFILES_V2.wallIndustrial.textureSelectionPolicy, 'atlas-only');
});

test('descriptors use stable asset-family IDs without importing the legacy runtime', () => {
  const stableFamilies = new Set(LEGACY_AUTHORED_ASSET_FAMILY_IDS_V2);
  for (const descriptor of LEGACY_AUTHORED_MODULE_DESCRIPTORS_V2) {
    assert.ok(stableFamilies.has(descriptor.assetFamilyId), `${descriptor.id} has a stable asset family`);
    assert.equal(descriptor.familyId, descriptor.assetFamilyId);
    assert.equal(descriptor.sourceContract.generator, 'src/DungeonGenerator.js');
    assert.equal(descriptor.sourceContract.runtimeReuse, 'none');
    assert.ok(descriptor.sourceContract.functions.includes('_createMaterials'));
    assert.ok(descriptor.sourceContract.functions.includes('_createSolidCollisionZones'));
    assert.ok(descriptor.sourceContract.discardedPatterns.includes('mesh-name-derived-collision'));
  }
});

test('every module is closed, multi-elevation, purpose-built, and collision-authoritative', () => {
  for (const descriptor of LEGACY_AUTHORED_MODULE_DESCRIPTORS_V2) {
    assert.deepEqual([...new Set(descriptor.structuralBoundaries.map(({ side }) => side))].sort(), [...SIDES].sort());
    for (const boundary of descriptor.structuralBoundaries) {
      assert.equal(boundary.coverage, 'opaque-visual-and-collider');
      assert.equal(boundary.groundedCollision, true);
      assert.equal(boundary.aerialCollision, true);
      assert.equal(boundary.cameraCollision, true);
      assert.equal(boundary.powerKnockbackCollision, true);
    }
    assert.ok(descriptor.regions.length >= 3);
    assert.ok(new Set(descriptor.sockets.map(({ elevationBand }) => elevationBand)).size >= 2);
    assert.ok(new Set(descriptor.sockets.map(({ placementBucket }) => placementBucket)).size >= 2);
    assert.ok(new Set(descriptor.sockets.map(({ connectorForm }) => connectorForm)).size >= 3);
    assert.equal(descriptor.presentation.noPrimitiveFallbackRooms, true);

    for (const surface of descriptor.walkableSurfaces) {
      assert.ok(surface.purpose.length >= 24, `${surface.id} needs a functional traversal purpose`);
      assert.ok(surface.supportIds.length > 0, `${surface.id} needs visible support`);
      assert.equal(surface.collision, 'visual-and-walkable');
    }
    for (const fixture of descriptor.structuralFixtures) {
      assert.ok(fixture.purpose.length >= 24, `${fixture.id} needs a functional purpose`);
      assert.equal(fixture.collision.authority, 'plan-fixture-bounds');
      assert.deepEqual(fixture.collision.center, fixture.center);
      assert.deepEqual(fixture.collision.dimensions, fixture.dimensions);
    }
  }
});

test('authored stair contracts terminate flush on walkable surfaces and never require ledge climbing', () => {
  for (const descriptor of LEGACY_AUTHORED_MODULE_DESCRIPTORS_V2) {
    for (const stair of descriptor.stairs) {
      assert.equal(stair.kind, 'aligned-stair-run');
      assert.equal(stair.collisionProfile, 'continuous-walkable-stair-ramp');
      assert.equal(stair.ledgeClimbAllowed, false);
      assert.ok(Math.abs(stair.stepRise) <= 0.55);
      assert.ok(stair.treadDepth >= 0.45, `${stair.id} needs walkable tread depth`);
      assert.equal(stair.endAlignmentTolerance, 0.01);
      const startSurface = descriptor.walkableSurfaces.find((surface) => (
        Math.abs(surface.topY - stair.start.y) <= stair.endAlignmentTolerance + 0.001
        && contains2d(surface, stair.start)
      ));
      const endSurface = descriptor.walkableSurfaces.find((surface) => (
        Math.abs(surface.topY - stair.end.y) <= stair.endAlignmentTolerance + 0.001
        && contains2d(surface, stair.end)
      ));
      assert.ok(startSurface, `${stair.id} begins flush on a registered walkable surface`);
      assert.ok(endSurface, `${stair.id} ends flush on a registered walkable surface`);
    }
  }
});

test('module topology signatures and layouts remain unique under catalog composition', () => {
  assert.equal(
    new Set(LEGACY_AUTHORED_MODULE_DESCRIPTORS_V2.map(({ topologySignature }) => topologySignature)).size,
    LEGACY_AUTHORED_MODULE_DESCRIPTORS_V2.length,
  );
  const layoutSignatures = LEGACY_AUTHORED_MODULE_DESCRIPTORS_V2.map((descriptor) => JSON.stringify({
    regions: descriptor.regions.map(({ elevationBand }) => elevationBand),
    sockets: descriptor.sockets.map(({ side, center, connectorForm, placementBucket }) => ({ side, center, connectorForm, placementBucket })),
    surfaces: descriptor.walkableSurfaces.map(({ center, dimensions }) => ({ center, dimensions })),
  }));
  assert.equal(new Set(layoutSignatures).size, layoutSignatures.length);
});

test('all four quarter-turn placements preserve immutable descriptor references', () => {
  const descriptor = getLegacyAuthoredModuleDescriptorV2('legacy-server-crypt-v2');
  const original = JSON.stringify(descriptor);
  for (let yawQuarterTurns = 0; yawQuarterTurns < 4; yawQuarterTurns += 1) {
    const placement = createLegacyAuthoredModulePlacementV2(descriptor.id, {
      id: `server-${yawQuarterTurns}`,
      translation: { x: 80, y: -3, z: 40 },
      yawQuarterTurns,
    });
    assert.equal(Object.isFrozen(placement), true);
    assert.equal(placement.descriptorId, descriptor.id);
    assert.equal(placement.descriptorRevision, descriptor.revision);
    assert.doesNotThrow(() => transformBoundsQuarterTurns(descriptor.bounds, placement));
    for (const socket of descriptor.sockets) {
      const world = transformPointQuarterTurns(socket.center, placement);
      assert.ok(['x', 'y', 'z'].every((axis) => Number.isFinite(world[axis])));
    }
  }
  assert.equal(JSON.stringify(descriptor), original);
  assert.throws(() => createLegacyAuthoredModulePlacementV2(descriptor.id, { translation: { x: NaN, y: 0, z: 0 } }), /finite/);
  assert.throws(() => getLegacyAuthoredModuleDescriptorV2('not-a-module'), /Unknown legacy-authored/);
});

test('optional GLB bindings enforce merged presentation and plan-owned collision', () => {
  const bindings = Object.values(LEGACY_AUTHORED_ASSET_CATALOG_V2.rooms);
  assert.deepEqual(bindings.map(({ footprint }) => footprint), [
    { width: 24, depth: 18 },
    { width: 30, depth: 22 },
    { width: 30, depth: 24 },
  ]);
  for (const binding of bindings) {
    assert.equal(binding.collisionAuthority, 'descriptor-fixture-bounds');
    assert.equal(binding.mergePolicy.rawMeshDrawsForbidden, true);
    assert.equal(binding.mergePolicy.preserveVertexColors, true);
    assert.ok(binding.mergePolicy.targetDrawCalls <= 3);
  }
  const descriptorsWithAssets = LEGACY_AUTHORED_MODULE_DESCRIPTORS_V2
    .filter(({ presentation }) => presentation.optionalMergedAssetId !== null);
  assert.equal(descriptorsWithAssets.length, 3);
  for (const descriptor of descriptorsWithAssets) {
    assert.ok(bindings.some(({ id }) => id === descriptor.presentation.optionalMergedAssetId));
    assert.ok(descriptor.performanceBudget.maximumMergedAssetSlices <= 3);
  }
});
