import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';
import {
  RELEASE_CORPUS_COUNTS,
  RELEASE_PROFILE_ID,
  assertMatchingReleaseProvenance,
  createAcceptedParentWitness,
  createCorpusManifest,
  createReleaseProvenance,
  readJson,
  validateCorpusManifest,
  writeImmutableJson,
} from './dungeon-augmentation-release-evidence.mjs';

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
const acceptedParentCount = RELEASE_CORPUS_COUNTS[tier];
const maximumRawAttempts = Number.isInteger(requestedMaximumRawAttempts)
  && requestedMaximumRawAttempts >= acceptedParentCount
  ? requestedMaximumRawAttempts
  : acceptedParentCount * 20;
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

const entries = [];
const skippedParentSeeds = [];
let rawIndex = requestedRawStart;
while (entries.length < acceptedParentCount) {
  if (rawIndex - requestedRawStart >= maximumRawAttempts) {
    throw new Error(
      `Accepted-parent scan exhausted ${maximumRawAttempts} raw seeds after finding ${entries.length}/${acceptedParentCount}.`,
    );
  }
  const suffix = String(rawIndex).padStart(3, '0');
  const seed = `layout:augmentation-realized-v4-${suffix}`;
  const basePlanHash = `v1:${seed}:depth:1:revolvingFusillade`;
  const seededRandom = new SeededRandom(hashSeed(seed));
  let sourceRandomCalls = 0;
  const generator = new DungeonGenerator({
    random: () => {
      sourceRandomCalls += 1;
      return seededRandom.next();
    },
    difficulty: 1,
    augmentationProfileId: null,
    augmentationSeed: seed,
    basePlanHash,
  });
  const inertTexture = new THREE.Texture();
  inertTexture.name = `releaseCorpusParent_${suffix}`;
  generator.textureCache.set(inertTexture.name, inertTexture);
  generator._loadRuinTexture = () => inertTexture;
  let dungeon = null;
  try {
    let parentGenerationError = null;
    try {
      dungeon = generator.generate();
    } catch (error) {
      parentGenerationError = error;
    }
    if (parentGenerationError) {
      skippedParentSeeds.push({
        rawIndex,
        seed,
        sourceRandomCalls,
        errorName: parentGenerationError?.name ?? 'Error',
        reason: parentGenerationError?.message ?? String(parentGenerationError),
      });
      if (progressEnabled) {
        console.error(`[parent-skip ${skippedParentSeeds.length}] ${seed}`);
      }
      continue;
    }
    if (dungeon.basePlanHash !== basePlanHash || dungeon.effectivePlanHash !== basePlanHash) {
      throw new Error(`Disabled parent ${seed} did not preserve its exact base plan hash.`);
    }
    const parentWitness = createAcceptedParentWitness(dungeon, sourceRandomCalls);
    entries.push({
      ordinal: entries.length,
      rawIndex,
      seed,
      basePlanHash,
      parentWitness,
    });
    if (progressEnabled) {
      console.error(`[parent ${entries.length}/${acceptedParentCount}] ${seed}`);
    }
  } finally {
    generator._disposeGeneratedDungeonCandidate(dungeon);
    inertTexture.dispose();
    rawIndex += 1;
  }
}

const manifest = createCorpusManifest({
  tier,
  rawStartIndex: requestedRawStart,
  rawEndIndexExclusive: rawIndex,
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
  rawEndIndexExclusive: rawIndex,
  skippedParentSeedCount: skippedParentSeeds.length,
  manifestHash: manifest.evidenceHash,
  provenance,
}, null, 2));
