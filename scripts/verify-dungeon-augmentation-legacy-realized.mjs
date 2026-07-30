import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { canonicalStringify } from '../src/dungeon-augmentation/canonical.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';

const countArgument = process.argv.find((argument) => argument.startsWith('--count='));
const startArgument = process.argv.find((argument) => argument.startsWith('--start='));
const requestedCount = Number.parseInt(countArgument?.slice('--count='.length) ?? '10', 10);
const requestedStart = Number.parseInt(startArgument?.slice('--start='.length) ?? '0', 10);
const summaryOnly = process.argv.includes('--summary');
const verifyHeadBaselines = process.argv.includes('--verify-head-baselines');
const seedCount = Number.isFinite(requestedCount) && requestedCount > 0 ? requestedCount : 10;
const startIndex = Number.isFinite(requestedStart) && requestedStart >= 0 ? requestedStart : 0;

const LEGACY_BASELINE_HASH_NAMESPACE =
  'ruindivex-industrial-v1-source-gate-realized-baseline/v3';
const PRE_SOURCE_GATE_HEAD_HASH_NAMESPACE =
  'ruindivex-industrial-v1-pre-sidecar-realized-baseline/v1';
// Regenerated after the explicit source-gate migration. These include the
// realized tile maps, every floor tile, and stable door-threshold geometry in
// addition to the logical plan. Rejected augmentation must still reproduce the
// same accepted authored result exactly.
const LEGACY_BASELINE_FINGERPRINTS = Object.freeze({
  'layout:augmentation-legacy-realized-000':
    'sha256-ed15a3097c23e4ccc4ba14e110830c035b4d0d116cf84c233cd39904c71ab89f',
  'layout:augmentation-legacy-realized-023':
    'sha256-fc432270a88ba472e2dc5d45293cdefb23648aa7a19e133d5795154cee14eb07',
});

// `--verify-head-baselines` also proves the saved pre-migration fingerprints
// still describe git HEAD. Current output is intentionally not equal to these:
// every locked gate and its full-height clearance lane moved from the far end
// of its corridor to the source entrance.
const PRE_SOURCE_GATE_HEAD_FINGERPRINTS = Object.freeze({
  'layout:augmentation-legacy-realized-000':
    'sha256-6e8e1d72df7db45e21616fd246c388dea6f1a28019e60deffedaca9315f677b9',
  'layout:augmentation-legacy-realized-023':
    'sha256-9adbd637692c147aa3b136d8c7222e85c55e0e4ba2ecd71c2543533e2404bac4',
});

const LEGACY_DOOR_SNAPSHOT_FIELDS = Object.freeze([
  'id',
  'label',
  'baseY',
  'radius',
  'locked',
  'closed',
  'requiresKeycard',
  'requiredKeycardId',
  'progressionTier',
  'fromRoomId',
  'toRoomId',
  'optional',
  'isShrineDoor',
  'encounterId',
  'mechanismId',
  'pressurePlateId',
  'opened',
  'alongX',
  'slidingAxis',
  'leftPanelClosedOffset',
  'rightPanelClosedOffset',
  'slidingOpenOffset',
  'collisionHalfWidth',
  'collisionHalfDepth',
  'collisionHeight',
  'connectionPlanId',
  'thresholdAnchored',
  'thresholdPortalSpan',
  'exitElevation',
  'entranceElevation',
  'position',
  'graphBlockingPosition',
  'fromPortal',
  'toPortal',
  'thresholdWallZones',
]);

function rendererFreeCopy(value, seen = new WeakSet()) {
  if (value == null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') {
    // Geometry frequently reaches the same value through addition/subtraction
    // in one implementation and a literal in another (for example 7.8 versus
    // 7.800000000000001). Quantize below gameplay/collision precision so the
    // baseline tracks real output changes rather than IEEE-754 expression order.
    return Number.isFinite(value) ? Number(value.toFixed(9)) : value;
  }
  if (typeof value === 'function') return undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => rendererFreeCopy(entry, seen)).filter((entry) => entry !== undefined);
  }
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entry]) => [String(key), rendererFreeCopy(entry, seen)])
      .sort(([left], [right]) => left.localeCompare(right));
  }
  if (value instanceof Set) {
    return [...value].map((entry) => rendererFreeCopy(entry, seen)).sort();
  }
  if (value?.isVector2) return { x: value.x, y: value.y };
  if (value?.isVector3) return { x: value.x, y: value.y, z: value.z };
  if (
    value?.isObject3D
    || value?.isMaterial
    || value?.isBufferGeometry
    || value?.isTexture
  ) {
    return undefined;
  }
  if (typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  const copy = {};
  for (const key of Object.keys(value).sort()) {
    // Added by the sidecar walkability audit. It records which validation mode
    // ran, not any pre-sidecar layout, tile, door, or progression result.
    if (key === 'segmentBarriersValidated') continue;
    const entry = rendererFreeCopy(value[key], seen);
    if (entry !== undefined) copy[key] = entry;
  }
  seen.delete(value);
  return copy;
}

function createLegacyDoorSnapshot(door) {
  const snapshot = {};
  for (const field of LEGACY_DOOR_SNAPSHOT_FIELDS) {
    if (Object.hasOwn(door ?? {}, field)) snapshot[field] = door[field];
  }
  return snapshot;
}

function createLegacySnapshot(dungeon, expectedBasePlanHash) {
  return rendererFreeCopy({
    // The pre-sidecar generator did not expose plan-hash fields. Supplying the
    // expected legacy identity keeps the structural baseline comparable while
    // still pinning every snapshot to its expedition seed.
    basePlanHash: dungeon.basePlanHash ?? expectedBasePlanHash,
    effectivePlanHash: dungeon.basePlanHash ?? expectedBasePlanHash,
    generationAttempts: dungeon.generationAttempts,
    layoutVariant: dungeon.layoutVariant,
    rooms: dungeon.rooms,
    connectionPlans: dungeon.connectionPlans,
    verticalConnectors: dungeon.verticalConnectors,
    roomArchetypes: dungeon.roomArchetypes,
    progression: dungeon.progression,
    minimap: dungeon.minimap,
    connectorPlanningDiagnostics: dungeon.connectorPlanningDiagnostics,
    connectorAssignmentSearchDiagnostics: dungeon.connectorAssignmentSearchDiagnostics,
    connectorFootprintReservationDiagnostics: dungeon.connectorFootprintReservationDiagnostics,
    connectorTrackTrapPlanningDiagnostics: dungeon.connectorTrackTrapPlanningDiagnostics,
    roomElevationDiagnostics: dungeon.roomElevationDiagnostics,
    floorIdentityDiagnostics: dungeon.floorIdentityDiagnostics,
    // These realized walkability surfaces are deliberately included rather
    // than inferred from rooms/connections. A wall, missing threshold, or
    // changed tile-elevation assignment must change the baseline fingerprint.
    tiles: dungeon.tiles,
    floorTiles: dungeon.floorTiles,
    doors: (dungeon.doors ?? []).map(createLegacyDoorSnapshot),
  });
}

function createStableSourceGateBaselineSnapshot(snapshot) {
  const stable = rendererFreeCopy(snapshot);
  const platformability = stable?.progression?.validation?.platformability;
  if (!platformability) return stable;

  // These records describe the sidecar's increasingly strict proof process,
  // not Industrial V1's authored layout. Keep the legacy baseline pinned to
  // realized rooms, connectors, tiles, floors, doors, and the pre-existing
  // traversal result while allowing diagnostic schema to evolve independently.
  for (const key of [
    'connectorSpineChecks',
    'supplementConnectivityChecks',
    'supplementRoomConnectivityChecks',
    'supplementJunctionConnectivityChecks',
    'supplementVerticalConnectivityChecks',
    'supplementShortcutConnectivityChecks',
    'supplementalOwnedFloorCount',
    'orphanSupplementFloorCount',
    'orphanSupplementFloorKeys',
    'bidirectionallyTraversableConnectorCount',
  ]) {
    delete platformability[key];
  }
  for (const check of platformability.localSocketChecks ?? []) {
    delete check.exactOwner;
    delete check.exactElevation;
  }
  return stable;
}

function fingerprintCanonicalValue(value, namespace = LEGACY_BASELINE_HASH_NAMESPACE) {
  return `sha256-${createHash('sha256')
    .update(`${namespace}\u0000${canonicalStringify(value)}`)
    .digest('hex')}`;
}

function fingerprintLegacySnapshot(snapshot) {
  return fingerprintCanonicalValue(createStableSourceGateBaselineSnapshot(snapshot));
}

function collectLegacyDifferencePaths(actual, expected, path = '$', results = [], limit = 32) {
  if (results.length >= limit) return results;
  if (Object.is(actual, expected)) return results;
  const actualIsObject = actual != null && typeof actual === 'object';
  const expectedIsObject = expected != null && typeof expected === 'object';
  if (!actualIsObject || !expectedIsObject || Array.isArray(actual) !== Array.isArray(expected)) {
    results.push({ path, actual, expected });
    return results;
  }
  const keys = Array.isArray(actual) && Array.isArray(expected)
    ? Array.from({ length: Math.max(actual.length, expected.length) }, (_, index) => index)
    : [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort();
  for (const key of keys) {
    if (!Object.hasOwn(actual, key) || !Object.hasOwn(expected, key)) {
      results.push({
        path: `${path}.${key}`,
        actual: actual?.[key],
        expected: expected?.[key],
      });
    } else {
      collectLegacyDifferencePaths(actual[key], expected[key], `${path}.${key}`, results, limit);
    }
    if (results.length >= limit) break;
  }
  return results;
}

function assertLegacySnapshotsEqual(actual, expected, message) {
  if (canonicalStringify(actual) === canonicalStringify(expected)) return;
  const fields = [...new Set([
    ...Object.keys(actual ?? {}),
    ...Object.keys(expected ?? {}),
  ])].sort();
  const differingFields = fields.filter((field) => (
    canonicalStringify(actual?.[field]) !== canonicalStringify(expected?.[field])
  ));
  const fieldFingerprints = Object.fromEntries(differingFields.map((field) => [field, {
    actual: fingerprintCanonicalValue(
      actual?.[field],
      `${LEGACY_BASELINE_HASH_NAMESPACE}:${field}`,
    ),
    expected: fingerprintCanonicalValue(
      expected?.[field],
      `${LEGACY_BASELINE_HASH_NAMESPACE}:${field}`,
    ),
  }]));
  const differencePaths = collectLegacyDifferencePaths(actual, expected);
  assert.fail(
    `${message} Differing fields: ${JSON.stringify(fieldFingerprints)}; paths: ${JSON.stringify(differencePaths)}`,
  );
}

function generate(
  seed,
  basePlanHash,
  augmentationProfileId = null,
  GeneratorClass = DungeonGenerator,
) {
  const seededRandom = new SeededRandom(hashSeed(seed));
  let sourceRandomCalls = 0;
  const generator = new GeneratorClass({
    random: () => {
      sourceRandomCalls += 1;
      return seededRandom.next();
    },
    difficulty: 1,
    augmentationProfileId,
    augmentationSeed: seed,
    basePlanHash,
  });
  const inertTexture = new THREE.Texture();
  inertTexture.name = `legacyAugmentationAudit:${seed}:${augmentationProfileId ?? 'off'}`;
  generator.textureCache.set(inertTexture.name, inertTexture);
  generator._loadRuinTexture = () => inertTexture;
  let dungeon;
  try {
    dungeon = generator.generate();
  } catch (error) {
    inertTexture.dispose();
    error.auditSourceRandomCalls = sourceRandomCalls;
    throw error;
  }
  return {
    dungeon,
    generator,
    inertTexture,
    sourceRandomCalls,
    snapshot: createLegacySnapshot(dungeon, basePlanHash),
  };
}

function disposeGeneratedRun(run) {
  if (!run) return;
  if (typeof run.generator?._disposeGeneratedDungeonCandidate === 'function') {
    run.generator._disposeGeneratedDungeonCandidate(run.dungeon);
  } else {
    run.dungeon?.group?.removeFromParent?.();
    run.dungeon?.group?.traverse?.((object) => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material?.dispose?.();
    });
  }
  run.inertTexture?.dispose?.();
}

async function loadGitHeadDungeonGenerator() {
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
  const sourceUrl = new URL('../src/DungeonGenerator.js', import.meta.url);
  const resolveSpecifier = (specifier) => (
    specifier.startsWith('.')
      ? new URL(specifier, sourceUrl).href
      : import.meta.resolve(specifier)
  );
  const source = execFileSync(
    'git',
    ['show', 'HEAD:src/DungeonGenerator.js'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  ).replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, quote, specifier) => (
    `${prefix}${quote}${resolveSpecifier(specifier)}${quote}`
  ));
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  );
  assert.equal(typeof module.DungeonGenerator, 'function');
  return module.DungeonGenerator;
}

async function auditHardCodedBaselines() {
  const headGenerator = verifyHeadBaselines
    ? await loadGitHeadDungeonGenerator()
    : null;
  const results = [];
  for (const [seed, expectedFingerprint] of Object.entries(LEGACY_BASELINE_FINGERPRINTS)) {
    const basePlanHash = `v1:${seed}:depth:1:revolvingFusillade`;
    const disabled = generate(seed, basePlanHash);
    const rejected = generate(
      seed,
      basePlanHash,
      'missing-augmentation-profile-for-regression',
    );
    let head = null;
    try {
      const disabledFingerprint = fingerprintLegacySnapshot(disabled.snapshot);
      const rejectedFingerprint = fingerprintLegacySnapshot(rejected.snapshot);
      assert.equal(disabled.dungeon.progression.validation.accepted, true);
      assert.equal(rejected.dungeon.progression.validation.accepted, true);
      assert.equal(rejected.dungeon.augmentationStatus, 'unchanged');
      assert.equal(rejected.dungeon.augmentationPlanHash, null);
      assert.equal(rejected.dungeon.effectivePlanHash, basePlanHash);
      assert.equal(rejected.dungeon.augmentationReplayDiagnostics?.fallbackToAcceptedBase, true);
      assert.equal(rejected.sourceRandomCalls, disabled.sourceRandomCalls);
      assertLegacySnapshotsEqual(
        rejected.snapshot,
        disabled.snapshot,
        `Rejected sidecar changed hard-coded legacy baseline ${seed}.`,
      );
      assert.equal(rejectedFingerprint, disabledFingerprint);
      if (expectedFingerprint) {
        assert.equal(
          disabledFingerprint,
          expectedFingerprint,
          `Disabled sidecar drifted from the source-gate regeneration baseline for ${seed}.`,
        );
      }

      let headFingerprint = null;
      if (headGenerator) {
        head = generate(seed, basePlanHash, null, headGenerator);
        headFingerprint = fingerprintCanonicalValue(
          head.snapshot,
          PRE_SOURCE_GATE_HEAD_HASH_NAMESPACE,
        );
        const expectedHeadFingerprint = PRE_SOURCE_GATE_HEAD_FINGERPRINTS[seed];
        if (expectedHeadFingerprint) {
          assert.equal(
            headFingerprint,
            expectedHeadFingerprint,
            `Saved pre-source-gate fingerprint no longer matches git HEAD for ${seed}.`,
          );
        }
      }
      results.push({
        seed,
        fingerprint: disabledFingerprint,
        headFingerprint,
        generationAttempts: disabled.dungeon.generationAttempts,
        sourceRandomCalls: disabled.sourceRandomCalls,
        floorTileCount: disabled.dungeon.floorTiles?.length ?? 0,
        tileCount: disabled.dungeon.tiles?.size ?? 0,
        doorCount: disabled.dungeon.doors?.length ?? 0,
      });
    } finally {
      disposeGeneratedRun(disabled);
      disposeGeneratedRun(rejected);
      disposeGeneratedRun(head);
    }
  }
  return results;
}

const hardCodedBaselineChecks = await auditHardCodedBaselines();

const records = [];
const skippedParentSeeds = [];
let index = startIndex;
while (records.length < seedCount) {
  const suffix = String(index).padStart(3, '0');
  const seed = `layout:augmentation-legacy-realized-${suffix}`;
  const basePlanHash = `v1:${seed}:depth:1:revolvingFusillade`;
  const startedAt = performance.now();
  let legacy;
  try {
    legacy = generate(seed, basePlanHash);
  } catch (legacyError) {
    let rejectedError = null;
    let rejectedSuccess = null;
    try {
      rejectedSuccess = generate(
        seed,
        basePlanHash,
        'missing-augmentation-profile-for-regression',
      );
    } catch (error) {
      rejectedError = error;
    }
    if (rejectedSuccess) {
      disposeGeneratedRun(rejectedSuccess);
    }
    assert.ok(rejectedError, `Rejected sidecar unexpectedly accepted failed parent seed ${seed}.`);
    assert.equal(rejectedError.message, legacyError.message);
    assert.equal(rejectedError.auditSourceRandomCalls, legacyError.auditSourceRandomCalls);
    skippedParentSeeds.push({
      seed,
      sourceRandomCalls: legacyError.auditSourceRandomCalls,
      reason: legacyError.message,
    });
    index += 1;
    continue;
  }
  const rejected = generate(seed, basePlanHash, 'missing-augmentation-profile-for-regression');
  try {
    assert.equal(legacy.dungeon.progression.validation.accepted, true);
    assert.equal(rejected.dungeon.progression.validation.accepted, true);
    assert.equal(rejected.dungeon.augmentationStatus, 'unchanged');
    assert.equal(rejected.dungeon.augmentationPlanHash, null);
    assert.equal(rejected.dungeon.effectivePlanHash, basePlanHash);
    assert.equal(rejected.dungeon.augmentationReplayDiagnostics?.fallbackToAcceptedBase, true);
    assert.equal(rejected.sourceRandomCalls, legacy.sourceRandomCalls);
    assertLegacySnapshotsEqual(
      rejected.snapshot,
      legacy.snapshot,
      `Rejected sidecar changed the accepted legacy plan for ${seed}.`,
    );
    const snapshotFingerprint = fingerprintLegacySnapshot(legacy.snapshot);
    const baselineFingerprint = LEGACY_BASELINE_FINGERPRINTS[seed] ?? null;
    if (baselineFingerprint) {
      assert.equal(
        snapshotFingerprint,
        baselineFingerprint,
        `Accepted disabled generation drifted from its pre-sidecar HEAD baseline for ${seed}.`,
      );
    }
    records.push({
      seed,
      snapshotFingerprint,
      generationAttempts: legacy.dungeon.generationAttempts,
      sourceRandomCalls: legacy.sourceRandomCalls,
      floorTileCount: legacy.dungeon.floorTiles?.length ?? 0,
      tileCount: legacy.dungeon.tiles?.size ?? 0,
      doorCount: legacy.dungeon.doors?.length ?? 0,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  } finally {
    disposeGeneratedRun(legacy);
    disposeGeneratedRun(rejected);
  }
  index += 1;
}

console.log(JSON.stringify({
  startIndex,
  endIndexExclusive: index,
  seedCount,
  comparedFullIndustrialGenerations: seedCount * 2,
  skippedParentSeedCount: skippedParentSeeds.length,
  skippedParentSeeds,
  generationAttemptRange: {
    minimum: Math.min(...records.map(({ generationAttempts }) => generationAttempts)),
    maximum: Math.max(...records.map(({ generationAttempts }) => generationAttempts)),
  },
  totalSourceRandomCalls: records.reduce((sum, record) => sum + record.sourceRandomCalls, 0),
  hardCodedBaselineChecks,
  ...(summaryOnly ? {} : { records }),
}, null, 2));
