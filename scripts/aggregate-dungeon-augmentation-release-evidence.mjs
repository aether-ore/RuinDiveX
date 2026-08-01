import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';
import {
  RELEASE_CORPUS_COUNTS,
  RELEASE_PROFILE_ID,
  aggregateShardEvidence,
  assertMatchingReleaseProvenance,
  createReleaseProvenance,
  readJson,
  validateAggregateEvidence,
  validateCorpusManifest,
  validateShardArtifactCollection,
  writeImmutableJson,
} from './dungeon-augmentation-release-evidence.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const argumentValue = (name) => process.argv
  .find((argument) => argument.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const argumentValues = (name) => process.argv
  .filter((argument) => argument.startsWith(`--${name}=`))
  .map((argument) => argument.slice(name.length + 3));
const manifestArgument = argumentValue('manifest');
const outputArgument = argumentValue('output');
const tier = argumentValue('tier') ?? 'release';
const shardDirectoryArgument = argumentValue('shard-dir');
const shardArguments = argumentValues('shard');

if (!manifestArgument || !outputArgument) {
  throw new Error('--manifest=<path> and --output=<path> are required.');
}
if (!shardDirectoryArgument && shardArguments.length === 0) {
  throw new Error('Supply one or more --shard=<path> arguments or --shard-dir=<path>.');
}
if (!Object.hasOwn(RELEASE_CORPUS_COUNTS, tier)) {
  throw new Error(`--tier must be one of ${Object.keys(RELEASE_CORPUS_COUNTS).join(', ')}.`);
}

const manifestPath = path.resolve(projectRoot, manifestArgument);
const outputPath = path.resolve(projectRoot, outputArgument);
const manifest = validateCorpusManifest(await readJson(manifestPath));
const currentProvenance = await createReleaseProvenance({
  projectRoot,
  profile: DUNGEON_AUGMENTATION_PROFILES[RELEASE_PROFILE_ID],
});
assertMatchingReleaseProvenance(currentProvenance, manifest.provenance, 'release aggregate');

try {
  const existing = validateAggregateEvidence(await readJson(outputPath));
  if (existing.manifestHash !== manifest.evidenceHash) {
    throw new Error('Existing immutable aggregate references another corpus manifest.');
  }
  if (existing.corpusTier !== tier) {
    throw new Error('Existing immutable aggregate references another ordinal view.');
  }
  console.log(JSON.stringify({
    action: 'reused',
    outputPath,
    result: existing.result,
    corpusAccepted: existing.corpusAccepted,
    evidenceHash: existing.evidenceHash,
  }, null, 2));
  process.exit(existing.corpusAccepted ? 0 : 1);
} catch (error) {
  if (error?.code !== 'ENOENT') {
    try {
      await readJson(outputPath);
      throw error;
    } catch (readError) {
      if (readError?.code !== 'ENOENT') throw error;
    }
  }
}

const shardPaths = [...shardArguments.map((filePath) => path.resolve(projectRoot, filePath))];
if (shardDirectoryArgument) {
  const shardDirectory = path.resolve(projectRoot, shardDirectoryArgument);
  const names = (await readdir(shardDirectory)).filter((name) => name.endsWith('.json')).sort();
  for (const name of names) shardPaths.push(path.join(shardDirectory, name));
}

const shardCandidates = [];
for (const shardPath of shardPaths) {
  shardCandidates.push({
    artifact: await readJson(shardPath),
    label: `release shard artifact ${shardPath}`,
  });
}
const shards = validateShardArtifactCollection(shardCandidates, manifest);
if (shards.length === 0) throw new Error('No release shard evidence was supplied.');

const aggregate = aggregateShardEvidence({ manifest, shards });
if (aggregate.corpusTier !== tier) {
  throw new Error(`Shard evidence is for ${aggregate.corpusTier}; expected ${tier}.`);
}
const action = await writeImmutableJson(outputPath, aggregate);
console.log(JSON.stringify({
  action,
  outputPath,
  result: aggregate.result,
  corpusAccepted: aggregate.corpusAccepted,
  manifestHash: aggregate.manifestHash,
  evidenceHash: aggregate.evidenceHash,
  expectedSeedCount: aggregate.expectedSeedCount,
  recordCount: aggregate.recordCount,
  shardCount: aggregate.shardCount,
  gates: aggregate.gates,
  performance: aggregate.performance,
  diversity: {
    required: aggregate.diversity.required,
    accepted: aggregate.diversity.accepted,
    topologyMaximumRatio: aggregate.diversity.topologyMaximumRatio,
    junctionMaximumRatio: aggregate.diversity.junctionMaximumRatio,
    elevationMaximumRatio: aggregate.diversity.elevationMaximumRatio,
    completeSignatureMaximumRatio: aggregate.diversity.completeSignatureMaximumRatio,
  },
}, null, 2));
if (!aggregate.corpusAccepted) process.exitCode = 1;
