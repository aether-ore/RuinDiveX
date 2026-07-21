// RETIRED: documents the rejected generic legacy-prefab presentation; not acceptance coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DungeonGeneratorV2 } from '../../../src/dungeon-v2/DungeonGeneratorV2.js';
import { LEGACY_AUTHORED_ASSET_FAMILY_IDS_V2 } from '../../../src/dungeon-v2/LegacyAuthoredModuleKitV2.js';

const REQUIRED_V1_TEXTURES = Object.freeze([
  '/assets/textures/ruins/wall_macro_industrial.png',
  '/assets/textures/ruins/ceiling_panel.png',
  '/assets/textures/ruins/floor_panel.png',
  '/assets/textures/ruins/floor_circuit.png',
  '/assets/textures/ruins/special_conveyor.png',
  '/assets/textures/ruins/terminal_mechanism.png',
]);

for (const undercroftType of ['magma', 'electrical']) {
  test(`golden ${undercroftType} assembly resolves its plan-owned V1 presentation instead of blank primitives`, () => {
    const facade = new DungeonGeneratorV2({
      seed: `legacy-authored-assembly-${undercroftType}`,
      undercroftType,
    }).generate();

    try {
      const authoredFixtures = facade.plan.structuralFixtures.filter((fixture) => (
        fixture.presentationAsset?.source === 'dungeon-v1'
      ));
      assert.ok(authoredFixtures.length >= 50, 'golden fixture retains the V1-authored machinery set');
      assert.deepEqual(
        [...new Set(authoredFixtures.map(({ assetFamilyId }) => assetFamilyId))].sort(),
        [...LEGACY_AUTHORED_ASSET_FAMILY_IDS_V2].sort(),
        'all seventeen golden regions resolve a stable V1 asset family',
      );

      const rootsByFixtureId = new Map();
      const textureUrls = new Set();
      facade.group.traverse((object) => {
        if (object.userData?.v2PresentationSource === 'dungeon-v1') {
          rootsByFixtureId.set(object.userData.v2FixtureId, object);
        }
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          const url = material?.map?.userData?.v2TextureUrl;
          if (url) textureUrls.add(url);
        }
      });

      const registryByPlanId = new Map(
        facade.structuralDiagnostics.map((entry) => [entry.planId, entry]),
      );
      for (const fixture of authoredFixtures) {
        const root = rootsByFixtureId.get(fixture.id);
        assert.ok(root, `${fixture.id} has an assembled V1-derived visual root`);
        assert.equal(root.userData.v2AssetFamilyId, fixture.assetFamilyId);
        assert.match(root.userData.v2LegacyPrefabId, /^legacy-/);
        assert.equal(root.userData.v2ColliderAuthority, 'accepted-dungeon-plan-v2');

        let meshCount = 0;
        root.traverse((object) => {
          if (!object.isMesh) return;
          meshCount += 1;
          assert.equal(object.userData.v2PresentationOnly, true);
          assert.equal(object.userData.v2FixtureId, fixture.id);
          assert.equal('v2ColliderBounds' in object.userData, false,
            'presentation recipes cannot invent collision');
        });
        assert.ok(meshCount >= 3, `${fixture.id} is a multi-part V1 recipe, not a blank box`);

        const registryEntry = registryByPlanId.get(fixture.id);
        assert.ok(registryEntry, `${fixture.id} is registered by its plan identity`);
        assert.deepEqual(
          [...registryEntry.colliderIds].sort(),
          [...fixture.colliderIds].sort(),
          `${fixture.id} collision remains exactly plan-owned`,
        );
      }

      for (const url of REQUIRED_V1_TEXTURES) {
        assert.ok(textureUrls.has(url), `assembled golden complex uses ${url}`);
      }
      assert.equal(facade.legacyPresentationDiagnostics.browserTextures, false,
        'Node assembly intentionally uses texture placeholders without losing V1 asset identity');
      assert.ok(facade.legacyPresentationDiagnostics.textureCount >= REQUIRED_V1_TEXTURES.length);
      assert.ok(facade.assemblyPerformance.visibleShadowCasterCount <= 80,
        `golden assembly retained ${facade.assemblyPerformance.visibleShadowCasterCount} shadow casters`);
      assert.ok(facade.assemblyPerformance.triangleCount <= 100_000,
        `golden assembly retained ${facade.assemblyPerformance.triangleCount} triangles`);
    } finally {
      facade.dispose();
    }
  });
}
