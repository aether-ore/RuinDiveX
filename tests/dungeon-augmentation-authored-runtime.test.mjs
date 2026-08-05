import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  DungeonGenerator,
  verifyIndustrialV4AuthoredMaterializedDescriptors,
} from '../src/DungeonGenerator.js';
import { hashCanonicalValue } from '../src/dungeon-augmentation/canonical.js';
import {
  loadIndustrialV4AuthoredArtifact,
} from '../src/dungeon-augmentation/authored/IndustrialV4AuthoredArtifact.js';

function createTapeHarness(artifact, { consumeDelta = 0 } = {}) {
  const sourceRandom = () => 0.123456;
  const generator = new DungeonGenerator({
    difficulty: 3,
    random: sourceRandom,
    augmentationProfileId: artifact.profileId,
    augmentationSeed: artifact.canonicalLayoutSeed,
    basePlanHash: artifact.baseGeometryHash,
    authoredAugmentationArtifact: artifact,
    requestedLayoutSeed: 'layout:requested-diagnostic-only',
  });
  let disposed = false;
  generator._generateOnce = function generateOnceHarness() {
    const count = artifact.canonicalBaseRandomTape.length + consumeDelta;
    for (let index = 0; index < count; index += 1) this.random();
    return {
      rooms: [],
      progression: { validation: { accepted: true, errors: [] } },
      augmentationDiagnostics: { accepted: true },
    };
  };
  generator._finalizeAcceptedIndustrialDungeon = (dungeon) => dungeon;
  generator._disposeGeneratedDungeonCandidate = () => { disposed = true; };
  return {
    generator,
    sourceRandom,
    get disposed() { return disposed; },
  };
}

test('authored runtime consumes the sealed tape exactly once and restores RNG/difficulty', async () => {
  const artifact = await loadIndustrialV4AuthoredArtifact();
  const harness = createTapeHarness(artifact);
  const dungeon = await harness.generator.generateAsync({
    augmentationPlanner: () => { throw new Error('planner must not run'); },
  });

  assert.equal(harness.generator.random, harness.sourceRandom);
  assert.equal(harness.generator.difficulty, 3);
  assert.equal(dungeon.layoutSeed, artifact.canonicalLayoutSeed);
  assert.equal(dungeon.resolvedLayoutSeed, artifact.canonicalLayoutSeed);
  assert.equal(dungeon.requestedLayoutSeed, 'layout:requested-diagnostic-only');
  assert.equal(dungeon.augmentationReplayDiagnostics.randomCallCount, 80);
  assert.equal(dungeon.augmentationReplayDiagnostics.consumedRandomCallCount, 80);
  assert.equal(dungeon.augmentationDiagnostics.gameplayDifficulty, 3);
  assert.equal(dungeon.augmentationDiagnostics.geometryDifficulty, 1);
  assert.equal(harness.disposed, false);
});

test('authored runtime fails closed on tape under-consumption and restores state', async () => {
  const artifact = await loadIndustrialV4AuthoredArtifact();
  const harness = createTapeHarness(artifact, { consumeDelta: -1 });

  await assert.rejects(
    harness.generator.generateAsync(),
    { code: 'DUNGEON_AUGMENTATION_AUTHORED_RANDOM_TAPE_UNDER_CONSUMED' },
  );
  assert.equal(harness.generator.random, harness.sourceRandom);
  assert.equal(harness.generator.difficulty, 3);
  assert.equal(harness.disposed, true);
});

test('authored runtime fails closed on tape overflow without procedural replay', async () => {
  const artifact = await loadIndustrialV4AuthoredArtifact();
  const harness = createTapeHarness(artifact, { consumeDelta: 1 });

  await assert.rejects(
    harness.generator.generateAsync(),
    { code: 'DUNGEON_AUGMENTATION_AUTHORED_RANDOM_TAPE_EXHAUSTED' },
  );
  assert.equal(harness.generator.random, harness.sourceRandom);
  assert.equal(harness.generator.difficulty, 3);
});

test('compact runtime descriptor verification rejects record and ID drift', () => {
  const room = { id: 'room-a', x: 1, z: 2 };
  const expected = {
    rooms: [{
      id: room.id,
      kind: 'room',
      recordHash: hashCanonicalValue(room, {
        namespace: 'ruindivex-industrial-v4-authored-room-record/v1',
      }),
    }],
    connectionPlans: [],
    connectorJunctionProxies: [],
    supplementalRoomIds: ['room-a'],
    supplementalConnectorJunctionIds: [],
    supplementalConnectionIds: [],
    supplementalPhysicalConnectionIds: [],
    supplementalGraphOnlyConnectionIds: [],
    diagnostics: { routeNetworks: [] },
  };
  const materialized = {
    rooms: [room],
    connectionPlans: [],
    connectorJunctionProxies: [],
    supplementalRoomIds: ['room-a'],
    supplementalConnectorJunctionIds: [],
    supplementalConnectionIds: [],
    supplementalPhysicalConnectionIds: [],
    supplementalGraphOnlyConnectionIds: [],
    diagnostics: { routeNetworks: [] },
  };
  assert.equal(
    verifyIndustrialV4AuthoredMaterializedDescriptors(expected, materialized).accepted,
    true,
  );
  materialized.rooms[0] = { ...room, x: 99 };
  const drift = verifyIndustrialV4AuthoredMaterializedDescriptors(expected, materialized);
  assert.equal(drift.accepted, false);
  assert.ok(drift.errors.some(({ code }) => (
    code === 'authored-materialized-runtime-record-hash-mismatch'
  )));
});

test('authored runtime uses only bounded receipt-backed startup checks', async () => {
  const artifact = await loadIndustrialV4AuthoredArtifact();
  const generator = new DungeonGenerator({
    difficulty: 1,
    random: () => 0.5,
    augmentationProfileId: artifact.profileId,
    augmentationSeed: artifact.canonicalLayoutSeed,
    basePlanHash: artifact.baseGeometryHash,
    authoredAugmentationArtifact: artifact,
  });
  const texture = new THREE.Texture();
  generator._loadRuinTexture = () => texture;
  const createFactoryLevelTiles = generator._createFactoryLevelTiles;
  const createReachableFloorTileKeySet = generator._createReachableFloorTileKeySet;
  let insideFactoryLevelTiles = false;
  let factoryReachabilityFloodCount = 0;
  generator._createFactoryLevelTiles = function createFactoryLevelTilesProbe(...args) {
    insideFactoryLevelTiles = true;
    try {
      return createFactoryLevelTiles.apply(this, args);
    } finally {
      insideFactoryLevelTiles = false;
    }
  };
  generator._createReachableFloorTileKeySet = function reachableFloorProbe(...args) {
    if (insideFactoryLevelTiles) factoryReachabilityFloodCount += 1;
    return createReachableFloorTileKeySet.apply(this, args);
  };
  generator._validateCriticalDoorChokepoints = () => {
    throw new Error('authored runtime invoked exhaustive critical-door validation');
  };
  generator._validateDungeonSupplementAnchorPlacementsAgainstFinalCollision = () => {
    throw new Error('authored runtime invoked exhaustive final-anchor validation');
  };
  generator._validateConnectorTraversalAssembly = () => {
    throw new Error('authored runtime invoked exhaustive connector assembly validation');
  };
  generator._enforceGeneratedWalkability = () => {
    throw new Error('authored runtime invoked repeated room walkability floods');
  };

  const dungeon = await generator.generateAsync();
  try {
    assert.equal(dungeon.progression.validation.accepted, true);
    assert.equal(factoryReachabilityFloodCount, 0);
    assert.deepEqual(dungeon.augmentationMetrics.boundedRuntimePreflight, {
      receiptBacked: true,
      legacyScaffoldRepairSearchSkipped: true,
      criticalDoorExhaustiveSkipped: true,
      anchorGlobalFloodSkipped: true,
    });
    assert.equal(dungeon.progression.validation.physicalProgression.receiptBacked, true);
    assert.equal(dungeon.progression.validation.connectorAssembly.receiptBacked, true);
    assert.ok(dungeon.rooms.some((room) => room.generatedTraversalCoverageReceiptBacked));
    assert.equal(dungeon.augmentationMetrics.operationCount, 5);
    assert.equal(dungeon.rooms.length, 28);
    assert.equal(dungeon.connectionPlans.length, 48);
    assert.equal(dungeon.floorTiles.length, 6835);
  } finally {
    generator._disposeGeneratedDungeonCandidate(dungeon);
  }
});
