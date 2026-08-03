import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import {
  augmentDungeonDraft,
  canonicalStringify,
  computeDungeonAugmentationPlanHash,
  createIndustrialAugmentationHost,
  createIndustrialBaseDraft,
} from '../src/dungeon-augmentation/index.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';

const SEED = 'layout:augmentation-realized-v4-001';
const V4_PROFILE_ID = 'industrial-supplement-preview-v4';
const V1_PROFILE_ID = 'industrial-supplement-preview-v1';

function createCanonicalPlannerFixture() {
  const seeded = new SeededRandom(hashSeed(SEED));
  const generator = new DungeonGenerator({
    random: () => seeded.next(),
    difficulty: 1,
    augmentationProfileId: V4_PROFILE_ID,
    augmentationSeed: SEED,
    basePlanHash: `v1:${SEED}:depth:1:revolvingFusillade`,
  });
  const texture = new THREE.Texture();
  generator.textureCache.set('pre-pruned-planner-test', texture);
  generator._loadRuinTexture = () => texture;
  generator.augmentationProfileId = null;
  const base = generator._generateAcceptedIndustrialDungeon({
    captureAcceptedRandomTape: true,
  });
  const baseDraft = createIndustrialBaseDraft({
    rooms: base.dungeon.rooms,
    connectionPlans: base.dungeon.connectionPlans,
    basePlanHash: generator.basePlanHash,
    tileSize: generator.tileSize,
    difficulty: generator.difficulty,
  });
  const host = createIndustrialAugmentationHost({
    basePlanHash: baseDraft.basePlanHash,
    baseDraft,
    rooms: base.dungeon.rooms,
    connectionPlans: base.dungeon.connectionPlans,
    tileSize: generator.tileSize,
  });
  return {
    generator,
    texture,
    base,
    baseDraft,
    host,
    dispose() {
      generator._disposeGeneratedDungeonCandidate(base.dungeon);
      texture.dispose();
    },
  };
}

function twoGrantV4Region(host) {
  const region = structuredClone(host.extensionRegions[0]);
  const landmark = region.routeNetworkGrants.find(({ kind }) => (
    kind === 'landmark-perimeter-loop'
  ));
  const coverage = region.routeNetworkGrants.find(({ kind }) => (
    kind === 'objective-route-coverage'
  ));
  assert.ok(landmark);
  assert.ok(coverage);
  region.routeNetworkGrants = [landmark, coverage];
  region.progressionSnapshot.objectiveRouteIds = [coverage.coverage.logicalEdgeId];
  return { region, landmark, coverage };
}

test('public pre-pruning omits only the supplied complete grant and hashes its canonical replay override', {
  timeout: 30_000,
}, () => {
  const fixture = createCanonicalPlannerFixture();
  try {
    const { region, landmark, coverage } = twoGrantV4Region(fixture.host);
    const baseSnapshot = canonicalStringify(fixture.baseDraft);
    const options = {
      baseDraft: fixture.baseDraft,
      extensionRegions: [region],
      profileId: V4_PROFILE_ID,
      layoutSeed: SEED,
      augmentationSeed: SEED,
      difficulty: 1,
    };
    const exactConflictExclusion = {
      grantId: landmark.id,
      entityKind: 'node',
      entityId: 'nonmatching-prior-candidate-node',
      signature: 'v1-nonmatching-prior-candidate-signature',
      reason: 'route-network-runtime-physical-validation-failed',
    };
    const first = augmentDungeonDraft({
      ...options,
      routeNetworkConflictExclusions: [exactConflictExclusion],
      prePrunedRouteNetworkGrants: [
        { grantId: coverage.id, reason: 'z-runtime-conflict', recoveryPass: 7 },
        { grantId: coverage.id, reason: 'a-runtime-conflict', recoveryPass: 3 },
      ],
    });
    const reordered = augmentDungeonDraft({
      ...options,
      routeNetworkConflictExclusions: [exactConflictExclusion],
      prePrunedRouteNetworkGrants: [
        { grantId: coverage.id, reason: 'a-runtime-conflict', recoveryPass: 3 },
        { grantId: coverage.id, reason: 'z-runtime-conflict', recoveryPass: 7 },
      ],
    });

    assert.equal(first.status, 'applied', JSON.stringify(first.diagnostics.errors));
    assert.deepEqual(first.overlayPlan, reordered.overlayPlan);
    assert.equal(canonicalStringify(fixture.baseDraft), baseSnapshot);
    assert.equal(first.overlayPlan.completionMode, 'best-effort-partial');
    assert.deepEqual(
      first.overlayPlan.operations.map(({ grantId }) => grantId),
      [landmark.id],
    );
    const retainedOperationId = first.overlayPlan.operations[0].id;
    assert.equal(
      first.overlayPlan.nodes.every(({ operationId }) => operationId === retainedOperationId),
      true,
    );
    assert.equal(
      first.overlayPlan.segments.every(({ operationId }) => operationId === retainedOperationId),
      true,
    );
    assert.deepEqual(first.overlayPlan.prunedRouteNetworkGrants, [{
      grantId: coverage.id,
      parentRegionId: region.id,
      routeNetworkKind: coverage.kind,
      operationOrdinal: 1,
      reason: 'a-runtime-conflict',
    }]);
    assert.deepEqual(first.overlayPlan.routeNetworkPruningOverrides, [{
      grantId: coverage.id,
      reason: 'a-runtime-conflict',
    }]);
    assert.deepEqual(
      first.overlayPlan.routeNetworkConflictExclusions,
      [exactConflictExclusion],
    );
    assert.equal(
      first.overlayPlan.augmentationPlanHash,
      computeDungeonAugmentationPlanHash(first.overlayPlan),
    );

    const allPruned = augmentDungeonDraft({
      ...options,
      prePrunedRouteNetworkGrants: [landmark.id, coverage.id],
    });
    assert.equal(allPruned.status, 'unchanged');
    assert.equal(allPruned.overlayPlan, null);
    assert.equal(
      allPruned.diagnostics.errors.some(({ code }) => (
        code === 'route-network-no-valid-supplements'
      )),
      true,
    );
  } finally {
    fixture.dispose();
  }
});

test('the pre-pruned route option is inert for the frozen V1 planner', {
  timeout: 30_000,
}, () => {
  const fixture = createCanonicalPlannerFixture();
  try {
    const options = {
      baseDraft: fixture.baseDraft,
      extensionRegions: fixture.host.extensionRegions,
      profileId: V1_PROFILE_ID,
      layoutSeed: SEED,
      augmentationSeed: SEED,
      difficulty: 1,
    };
    const baseline = augmentDungeonDraft(options);
    const withIrrelevantOverride = augmentDungeonDraft({
      ...options,
      prePrunedRouteNetworkGrants: [{
        grantId: 'ignored-by-v1',
        reason: 'must-not-change-v1',
      }],
      routeNetworkConflictExclusions: [{
        grantId: 'ignored-by-v1',
        entityKind: 'node',
        entityId: 'ignored-node',
        signature: 'ignored-exact-signature',
        reason: 'must-not-change-v1',
      }],
    });

    assert.deepEqual(withIrrelevantOverride, baseline);
    assert.equal(
      withIrrelevantOverride.overlayPlan?.routeNetworkPruningOverrides,
      undefined,
    );
    assert.equal(
      withIrrelevantOverride.overlayPlan?.routeNetworkConflictExclusions,
      undefined,
    );
  } finally {
    fixture.dispose();
  }
});
