import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';
import {
  RELEASE_CORPUS_COUNTS,
  RELEASE_PROFILE_ID,
  assertCleanReleaseProvenance,
  assertMatchingReleaseProvenance,
  createCorpusManifest,
  createReleaseProvenance,
  readJson,
  validateCorpusManifest,
  writeImmutableJson,
} from './dungeon-augmentation-release-evidence.mjs';
import {
  collectOrderedAcceptedParentSnapshots,
  createReleaseParentSnapshotWorkerPool,
  resolveReleaseParentSnapshotConcurrency,
} from './dungeon-augmentation-parent-snapshot-pool.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const argumentValue = (name) => process.argv
  .find((argument) => argument.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const tier = argumentValue('tier') ?? 'release';
const outputPath = argumentValue('output');
const requestedRawStart = Number.parseInt(argumentValue('raw-start') ?? '0', 10);
const requestedMaximumRawAttempts = Number.parseInt(
  argumentValue('maximum-raw-attempts') ?? '',
  10,
);
const parentWorkersArgument = argumentValue('parent-workers');
const requestedParentWorkerCount = parentWorkersArgument == null
  ? null
  : Number(parentWorkersArgument);
const progressEnabled = process.argv.includes('--progress');

if (tier !== 'release') {
  throw new Error(
    '--tier must be release. Smoke and normal reuse the first 10/100 ordinals of the same 1,000-parent manifest.',
  );
}
if (!outputPath) throw new Error('--output=<path> is required for an immutable corpus manifest.');
if (!Number.isInteger(requestedRawStart) || requestedRawStart < 0) {
  throw new Error('--raw-start must be a non-negative integer.');
}

const profile = DUNGEON_AUGMENTATION_PROFILES[RELEASE_PROFILE_ID];
const provenance = await createReleaseProvenance({ projectRoot, profile });
assertCleanReleaseProvenance(provenance, 'release corpus builder source');
const acceptedParentCount = RELEASE_CORPUS_COUNTS[tier];
const maximumRawAttempts = Number.isInteger(requestedMaximumRawAttempts)
  && requestedMaximumRawAttempts >= acceptedParentCount
  ? requestedMaximumRawAttempts
  : acceptedParentCount * 20;
const parentSnapshotConcurrency = resolveReleaseParentSnapshotConcurrency(
  requestedParentWorkerCount,
);
const resolvedOutputPath = path.resolve(projectRoot, outputPath);

try {
  const existing = validateCorpusManifest(await readJson(resolvedOutputPath));
  assertMatchingReleaseProvenance(existing.provenance, provenance, 'existing release corpus');
  if (existing.tier !== tier
    || existing.rawStartIndex !== requestedRawStart
    || existing.requestedAcceptedParentCount !== acceptedParentCount) {
    throw new Error('Existing immutable corpus uses a different tier, raw start, or count.');
  }
  console.log(JSON.stringify({
    action: 'reused',
    outputPath: resolvedOutputPath,
    tier,
    acceptedParentCount,
    manifestHash: existing.evidenceHash,
  }, null, 2));
  process.exit(0);
} catch (error) {
  if (error?.code !== 'ENOENT') {
    // JSON parse, seal, provenance, or configuration mismatches are evidence
    // failures. Only a genuinely absent path authorizes manifest creation.
    try {
      await readJson(resolvedOutputPath);
      throw error;
    } catch (readError) {
      if (readError?.code !== 'ENOENT') throw error;
    }
  }
}

const parentSnapshotPool = createReleaseParentSnapshotWorkerPool({
  concurrency: parentSnapshotConcurrency,
});
let scan;
try {
  scan = await collectOrderedAcceptedParentSnapshots({
    rawStartIndex: requestedRawStart,
    maximumRawAttempts,
    requestedAcceptedParentCount: acceptedParentCount,
    concurrency: parentSnapshotConcurrency,
    buildBatch: (rawIndices) => parentSnapshotPool.runBatch(rawIndices),
    onCommittedSnapshot(committed) {
      if (!progressEnabled) return;
      if (committed.status === 'accepted') {
        console.error(
          `[parent ${committed.acceptedParentCount}/${acceptedParentCount}] ${committed.entry.seed}`,
        );
      } else {
        console.error(
          `[parent-skip ${committed.skippedParentSeedCount}] ${committed.skippedParentSeed.seed}`,
        );
      }
    },
  });
} finally {
  await parentSnapshotPool.close();
}
const { entries, skippedParentSeeds, rawEndIndexExclusive } = scan;

const manifest = createCorpusManifest({
  tier,
  rawStartIndex: requestedRawStart,
  rawEndIndexExclusive,
  requestedAcceptedParentCount: acceptedParentCount,
  entries,
  skippedParentSeeds,
  provenance,
});
const action = await writeImmutableJson(resolvedOutputPath, manifest);
console.log(JSON.stringify({
  action,
  outputPath: resolvedOutputPath,
  tier,
  acceptedParentCount,
  rawStartIndex: requestedRawStart,
  rawEndIndexExclusive,
  skippedParentSeedCount: skippedParentSeeds.length,
  parentSnapshotConcurrency,
  manifestHash: manifest.evidenceHash,
  provenance,
}, null, 2));
