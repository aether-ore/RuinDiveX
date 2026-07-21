import test from 'node:test';
import assert from 'node:assert/strict';
import { DungeonGeneratorV2 } from '../../../src/dungeon-v2/DungeonGeneratorV2.js';

const ACTUAL_GOLDEN_SEEDS = Object.freeze([
  Object.freeze({ seed: 'm1-golden-magma', undercroftType: 'magma' }),
  Object.freeze({ seed: 'm1-golden-electrical', undercroftType: 'electrical' }),
]);

function fixedRoomOwner(object) {
  for (let parent = object.parent; parent; parent = parent.parent) {
    if (parent.name?.startsWith('legacy-fixed-room:')) return parent;
  }
  return null;
}

for (const fixture of ACTUAL_GOLDEN_SEEDS) {
  test(`actual ${fixture.undercroftType} seed keeps native V1 detail inside the shadow budget`, () => {
    const facade = new DungeonGeneratorV2(fixture).generate();
    try {
      const nativeMeshes = [];
      facade.group.traverse((object) => {
        if (!object.isMesh || object.visible === false) return;
        if (fixedRoomOwner(object)) nativeMeshes.push(object);
      });

      assert.ok(nativeMeshes.length > 0, 'the actual seed must assemble native V1 rooms');
      assert.ok(
        facade.assemblyPerformance.visibleShadowCasterCount <= 80,
        `${fixture.seed} retained ${facade.assemblyPerformance.visibleShadowCasterCount} global shadow casters`,
      );

      const nativeCasters = nativeMeshes.filter(({ castShadow }) => castShadow);
      const nativeReceiverOnly = nativeMeshes.filter((object) => (
        object.castShadow === false
        && object.userData.v2ShadowPolicy === 'legacy-fixed-room-receiver-only'
      ));
      assert.ok(nativeCasters.length > 0, 'substantial native V1 landmarks still cast route-readable shadows');
      assert.ok(nativeCasters.length <= 12,
        `native V1 presentation retained ${nativeCasters.length} shadow-casting batches`);
      assert.ok(nativeReceiverOnly.length > nativeCasters.length * 3,
        'small repeated native V1 detail should remain visible without multiplying shadow submissions');
      assert.equal(nativeMeshes.every(({ receiveShadow }) => receiveShadow), true,
        'receiver-only policy must not remove native V1 lighting/shadow reception');

      for (const object of nativeMeshes) {
        if (object.castShadow) {
          assert.equal(object.userData.v2BatchRole, 'v1-authored-landmark');
          assert.equal(object.userData.v2ShadowPolicy, 'legacy-fixed-room-landmark-caster');
        }
        if ([
          'walkable-surface',
          'opaque-enclosure-wall',
          'opaque-enclosure-ceiling',
          'opaque-enclosure-floor-foundation',
          'paired-portal-frame',
        ].includes(object.userData.v2BatchRole)) {
          assert.equal(object.castShadow, false,
            `${object.name} is static receiver-only structure, not a landmark caster`);
        }
      }
    } finally {
      facade.dispose();
    }
  });
}

