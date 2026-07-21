// RETIRED: documents the rejected generic legacy-prefab runtime kit; not acceptance coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  LEGACY_AUTHORED_ASSET_CATALOG_V2,
} from '../../../src/dungeon-v2/LegacyAuthoredModuleKitV2.js';
import {
  LEGACY_AUTHORED_PRESENTATION_COLLISION_POLICY_V2,
  LEGACY_AUTHORED_PRESENTATION_FIT_TOLERANCE_V2,
  LegacyAuthoredRuntimeKitV2,
  createLegacyAuthoredRuntimeKitV2,
  resolveLegacyAssetFamilyIdV2,
  resolveLegacyRuinMaterialProfileIdV2,
  selectLegacyAuthoredPrefabV2,
} from '../../../src/dungeon-v2/LegacyAuthoredRuntimeKitV2.js';

const WORKSPACE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function bounds(min, max) {
  return { min, max };
}

function maximumBoundsError(actual, expected) {
  return Math.max(
    Math.abs(actual.min.x - expected.min.x),
    Math.abs(actual.min.y - expected.min.y),
    Math.abs(actual.min.z - expected.min.z),
    Math.abs(actual.max.x - expected.max.x),
    Math.abs(actual.max.y - expected.max.y),
    Math.abs(actual.max.z - expected.max.z),
  );
}

test('arbitrary V2 identifiers map deterministically onto V1 ruin material profiles', () => {
  assert.equal(resolveLegacyRuinMaterialProfileIdV2('legacy-server-floor'), 'legacy-server-floor');
  assert.equal(resolveLegacyRuinMaterialProfileIdV2({ regionId: 'reservoir-pump-gallery', type: 'floor' }), 'legacy-coolant-floor');
  assert.equal(resolveLegacyRuinMaterialProfileIdV2({ fixtureId: 'sorting-belt-long', type: 'conveyor' }), 'legacy-conveyor');
  assert.equal(resolveLegacyRuinMaterialProfileIdV2({ regionId: 'server-crypt', type: 'walkable-floor' }), 'legacy-server-floor');
  assert.equal(resolveLegacyRuinMaterialProfileIdV2('waterworksWall'), 'legacy-wall-industrial');
  assert.equal(resolveLegacyRuinMaterialProfileIdV2('factoryTrim'), 'legacy-support');
  assert.equal(resolveLegacyRuinMaterialProfileIdV2({ regionId: 'shrine-extraction', type: 'refractor-dais' }), 'legacy-large-refractor');
  assert.equal(resolveLegacyRuinMaterialProfileIdV2({ fixtureType: 'control-bank' }), 'legacy-terminal');
  assert.equal(resolveLegacyRuinMaterialProfileIdV2({ fixtureType: 'load-bearing-girder' }), 'legacy-support');
  assert.equal(resolveLegacyAssetFamilyIdV2({ regionId: 'drained-waterworks-sump' }), 'v1.coolant-relay');
  assert.equal(resolveLegacyAssetFamilyIdV2({ fixtureId: 'large-refractor-shrine' }), 'v1.refractor-shrine');
});

test('fixture type and asset family select the intended code-native recipe', () => {
  const cases = [
    [{ type: 'server-bank', assetFamilyId: 'v1.server-crypt' }, 'legacy-server-monolith'],
    [{ type: 'server-bank', assetFamilyId: 'v1.parts-warehouse' }, 'legacy-storage-rack'],
    [{ type: 'pump-array', assetFamilyId: 'v1.coolant-relay' }, 'legacy-circulation-pump'],
    [{ type: 'conveyor', assetFamilyId: 'v1.factory-conveyor' }, 'legacy-conveyor-drive'],
    [{ type: 'pressure-vessel', assetFamilyId: 'v1.coolant-control' }, 'legacy-water-tank'],
    [{ type: 'processing-tank', assetFamilyId: 'v1.nest-warehouse' }, 'legacy-processing-vat'],
    [{ type: 'server-bank', assetFamilyId: 'v1.refractor-shrine' }, 'legacy-shrine-monolith'],
    [{ type: 'conduit', assetFamilyId: 'v1.refractor-shrine' }, 'legacy-water-tank'],
    [{ type: 'functional-machine', assetFamilyId: 'v1.machine-core' }, 'legacy-girder-frame'],
  ];
  for (const [fixture, expected] of cases) {
    assert.equal(selectLegacyAuthoredPrefabV2(fixture).id, expected, JSON.stringify(fixture));
  }
  assert.throws(
    () => selectLegacyAuthoredPrefabV2({ prefabId: 'not-a-real-prefab' }),
    /Unknown legacy-authored V2 prefab/,
  );
});

test('Node uses cached THREE.Texture placeholders while browser loading uses real V1 URLs', async () => {
  const kit = createLegacyAuthoredRuntimeKitV2({ loadBrowserTextures: false });
  assert.ok(kit instanceof LegacyAuthoredRuntimeKitV2);
  const first = kit.getMaterial('legacy-server-floor');
  const second = kit.getMaterial({ regionId: 'server-crypt', type: 'floor' });
  assert.strictEqual(second, first, 'resolved materials share the profile cache');
  assert.ok(first.map instanceof THREE.Texture);
  assert.equal(first.map.userData.v2TextureSource, 'node-placeholder');
  assert.match(first.map.userData.v2TextureUrl, /^\/assets\/textures\/ruins\/.+\.png$/);
  assert.deepEqual(kit.getDiagnostics(), {
    disposed: false,
    textureCount: 1,
    materialCount: 1,
    geometryCount: 0,
    browserTextures: false,
    presentationCollisionPolicy: LEGACY_AUTHORED_PRESENTATION_COLLISION_POLICY_V2,
  });

  const loadedUrls = [];
  const browserKit = createLegacyAuthoredRuntimeKitV2({
    loadBrowserTextures: true,
    textureLoader: {
      load(url) {
        loadedUrls.push(url);
        return new THREE.Texture();
      },
    },
  });
  const browserMaterial = browserKit.getMaterial('legacy-floor');
  assert.equal(browserMaterial.map.userData.v2TextureSource, 'dungeon-v1-asset');
  assert.deepEqual(loadedUrls, ['/assets/textures/ruins/floor_plain.png']);

  for (const asset of Object.values(LEGACY_AUTHORED_ASSET_CATALOG_V2.textures)) {
    assert.match(asset.url, /^\/assets\/textures\/ruins\/.+\.png$/);
    await access(`${WORKSPACE_ROOT}${asset.url.slice(1).replaceAll('/', '\\')}`);
  }
  browserKit.dispose();
  kit.dispose();
});

test('all selected recipes fit exact supplied world bounds and carry presentation-only stable tags', () => {
  const kit = createLegacyAuthoredRuntimeKitV2({ loadBrowserTextures: false });
  const parent = new THREE.Group();
  const fixtures = [
    { id: 'server', type: 'server-bank', assetFamilyId: 'v1.server-crypt' },
    { id: 'pump', type: 'pump-array', assetFamilyId: 'v1.coolant-relay' },
    { id: 'belt', type: 'conveyor', assetFamilyId: 'v1.factory-conveyor' },
    { id: 'tank', type: 'pressure-vessel', assetFamilyId: 'v1.coolant-control' },
    { id: 'pipe', type: 'coolant-pipe', assetFamilyId: 'v1.coolant-relay' },
    { id: 'vat', type: 'processing-tank', assetFamilyId: 'v1.nest-warehouse' },
    { id: 'rack', type: 'server-bank', assetFamilyId: 'v1.parts-warehouse' },
    { id: 'shrine', type: 'server-bank', assetFamilyId: 'v1.refractor-shrine' },
  ].map((fixture, index) => ({
    ...fixture,
    yawQuarterTurns: index % 4,
    bounds: bounds(
      { x: index * 15 - 3.2, y: -2 + index * 0.25, z: -8 - index * 2.5 },
      { x: index * 15 + 4.7, y: 5.5 + index * 0.25, z: -1.4 - index * 2.5 },
    ),
  }));

  for (const fixture of fixtures) {
    const group = kit.renderFixture(fixture, { parent });
    assert.strictEqual(group.parent, parent);
    assert.equal(group.userData.v2FixtureId, fixture.id);
    assert.equal(group.userData.v2AssetFamilyId, fixture.assetFamilyId);
    assert.equal(group.userData.v2LegacyPrefabId, selectLegacyAuthoredPrefabV2(fixture).id);
    assert.equal(group.userData.v2CollisionPolicy, LEGACY_AUTHORED_PRESENTATION_COLLISION_POLICY_V2);
    assert.equal(group.userData.v2PresentationOnly, true);
    assert.ok(group.userData.v2BoundsFitError <= LEGACY_AUTHORED_PRESENTATION_FIT_TOLERANCE_V2);

    const expected = new THREE.Box3(
      new THREE.Vector3(fixture.bounds.min.x, fixture.bounds.min.y, fixture.bounds.min.z),
      new THREE.Vector3(fixture.bounds.max.x, fixture.bounds.max.y, fixture.bounds.max.z),
    );
    const rendered = new THREE.Box3().setFromObject(group);
    assert.ok(maximumBoundsError(rendered, expected) <= 1e-5, `${fixture.id} aligns to exact fixture bounds`);

    let meshCount = 0;
    group.traverse((object) => {
      assert.equal(object.userData.v2CollisionPolicy, LEGACY_AUTHORED_PRESENTATION_COLLISION_POLICY_V2);
      assert.equal(object.userData.v2FixtureId, fixture.id);
      assert.equal(object.userData.v2AssetFamilyId, fixture.assetFamilyId);
      assert.equal(object.userData.v2LegacyPrefabId, group.userData.v2LegacyPrefabId);
      assert.equal('v2ColliderBounds' in object.userData, false, 'renderer does not infer collision');
      assert.equal('v2ColliderIds' in object.userData, false, 'renderer does not register collision');
      if (!object.isMesh) return;
      meshCount += 1;
      const childBounds = new THREE.Box3().setFromObject(object);
      assert.ok(childBounds.min.x >= expected.min.x - 1e-5);
      assert.ok(childBounds.min.y >= expected.min.y - 1e-5);
      assert.ok(childBounds.min.z >= expected.min.z - 1e-5);
      assert.ok(childBounds.max.x <= expected.max.x + 1e-5);
      assert.ok(childBounds.max.y <= expected.max.y + 1e-5);
      assert.ok(childBounds.max.z <= expected.max.z + 1e-5);
    });
    assert.ok(meshCount >= 3, `${fixture.id} is an authored multi-part prefab, not a blank box`);
  }
  assert.equal(parent.children.length, fixtures.length);
  assert.ok(kit.getDiagnostics().materialCount > 4);
  assert.ok(kit.getDiagnostics().geometryCount > 4);
  kit.dispose();
});

test('cache disposal is idempotent and disposes each shared resource once', () => {
  const kit = createLegacyAuthoredRuntimeKitV2({ loadBrowserTextures: false });
  kit.renderFixture({
    id: 'shared-server-one',
    type: 'server-bank',
    assetFamilyId: 'v1.server-crypt',
    bounds: bounds({ x: 0, y: 0, z: 0 }, { x: 3, y: 6, z: 3 }),
  });
  kit.renderFixture({
    id: 'shared-server-two',
    type: 'server-bank',
    assetFamilyId: 'v1.server-crypt',
    bounds: bounds({ x: 5, y: 0, z: 0 }, { x: 8, y: 6, z: 3 }),
  });
  const resources = [
    ...new Set(kit.materials.values()),
    ...new Set(kit.textures.values()),
    ...new Set(kit.geometries.values()),
  ];
  const disposeCounts = new Map(resources.map((resource) => [resource, 0]));
  for (const resource of resources) {
    resource.addEventListener('dispose', () => disposeCounts.set(resource, disposeCounts.get(resource) + 1));
  }
  kit.dispose();
  kit.dispose();
  for (const count of disposeCounts.values()) assert.equal(count, 1);
  assert.deepEqual(kit.getDiagnostics(), {
    disposed: true,
    textureCount: 0,
    materialCount: 0,
    geometryCount: 0,
    browserTextures: false,
    presentationCollisionPolicy: LEGACY_AUTHORED_PRESENTATION_COLLISION_POLICY_V2,
  });
  assert.throws(() => kit.getMaterial('legacy-floor'), /has been disposed/);
});
