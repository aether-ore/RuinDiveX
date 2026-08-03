import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';
import {
  RELEASE_PROFILE_ID,
  RELEASE_REQUIRED_SUITE_IDS,
  RELEASE_SHARD_TOPOLOGY,
  assertCleanReleaseProvenance,
  createReleaseArtifactIdentity,
  createReleaseProvenance,
  readJson,
  validateCorpusManifest,
  validateReleasePredecessorEvidenceCollection,
} from './dungeon-augmentation-release-evidence.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const argumentValue = (name) => process.argv
  .find((argument) => argument.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const tier = argumentValue('tier') ?? 'release';
const requestedArtifactRoot = argumentValue('artifact-root');
const printPlan = process.argv.includes('--print-plan');

if (!Object.hasOwn(RELEASE_SHARD_TOPOLOGY, tier)) {
  throw new Error(`--tier must be one of ${Object.keys(RELEASE_SHARD_TOPOLOGY).join(', ')}.`);
}

const provenance = await createReleaseProvenance({
  projectRoot,
  profile: DUNGEON_AUGMENTATION_PROFILES[RELEASE_PROFILE_ID],
});
assertCleanReleaseProvenance(provenance, 'release evidence runner source');
const sourceEvidenceId = createReleaseArtifactIdentity(provenance);
const artifactRoot = requestedArtifactRoot
  ? path.resolve(projectRoot, requestedArtifactRoot)
  : path.join(
    projectRoot,
    'artifacts',
    'dungeon-augmentation-v4-release',
    sourceEvidenceId,
  );
const manifestPath = path.join(artifactRoot, 'accepted-parent-manifest-1000.json');
const shardDirectory = path.join(artifactRoot, 'shards', tier);
const aggregatePath = path.join(artifactRoot, `aggregate-${tier}.json`);
const canonicalPredecessorPath = path.join(artifactRoot, 'canonical-seed-0-1.json');
const smokePredecessorPath = path.join(artifactRoot, 'aggregate-smoke.json');
const normalPredecessorPath = path.join(artifactRoot, 'aggregate-normal.json');
const receiptDirectory = path.join(artifactRoot, 'receipts');
const attestationPath = path.join(artifactRoot, 'release-attestation.json');
const topology = RELEASE_SHARD_TOPOLOGY[tier];

const steps = [{
  label: 'immutable accepted-parent manifest',
  script: 'scripts/build-dungeon-augmentation-release-corpus.mjs',
  args: [
    '--tier=release',
    `--output=${manifestPath}`,
    '--progress',
  ],
}];
for (let shardIndex = 0; shardIndex < topology.shardCount; shardIndex += 1) {
  steps.push({
    label: `${tier} ordinal shard ${shardIndex + 1}/${topology.shardCount}`,
    script: 'scripts/run-dungeon-augmentation-release-shard.mjs',
    args: [
      `--manifest=${manifestPath}`,
      `--tier=${tier}`,
      `--shard-index=${shardIndex}`,
      `--shard-count=${topology.shardCount}`,
      `--output=${path.join(
        shardDirectory,
        `shard-${String(shardIndex).padStart(2, '0')}-of-${topology.shardCount}.json`,
      )}`,
    ],
  });
}
steps.push({
  label: `${tier} same-source aggregate`,
  script: 'scripts/aggregate-dungeon-augmentation-release-evidence.mjs',
  args: [
    `--manifest=${manifestPath}`,
    `--tier=${tier}`,
    `--shard-dir=${shardDirectory}`,
    `--output=${aggregatePath}`,
  ],
});
if (tier === 'release') {
  for (const suiteId of RELEASE_REQUIRED_SUITE_IDS) {
    steps.push({
      label: `${suiteId} same-source receipt`,
      script: 'scripts/run-dungeon-augmentation-release-receipt.mjs',
      args: [
        `--suite=${suiteId}`,
        `--output=${path.join(receiptDirectory, `${suiteId}.json`)}`,
      ],
    });
  }
  steps.push({
    label: 'sealed aggregate-and-receipts attestation',
    script: 'scripts/finalize-dungeon-augmentation-release-evidence.mjs',
    args: [
      `--aggregate=${aggregatePath}`,
      `--canonical=${canonicalPredecessorPath}`,
      `--smoke-aggregate=${smokePredecessorPath}`,
      `--normal-aggregate=${normalPredecessorPath}`,
      `--receipt-dir=${receiptDirectory}`,
      `--output=${attestationPath}`,
    ],
  });
}

if (printPlan) {
  console.log(JSON.stringify({
    tier,
    profileId: RELEASE_PROFILE_ID,
    provenance,
    artifactRoot,
    manifestPath,
    shardDirectory,
    aggregatePath,
    predecessorPaths: tier === 'release' ? {
      canonical: canonicalPredecessorPath,
      smoke: smokePredecessorPath,
      normal: normalPredecessorPath,
    } : null,
    receiptDirectory: tier === 'release' ? receiptDirectory : null,
    attestationPath: tier === 'release' ? attestationPath : null,
    shardCount: topology.shardCount,
    shardSize: topology.shardSize,
    steps,
  }, null, 2));
  process.exit(0);
}

let releasePredecessorEvidence = null;
if (tier === 'release') {
  try {
    const [canonical, smoke, normal] = await Promise.all([
      readJson(canonicalPredecessorPath),
      readJson(smokePredecessorPath),
      readJson(normalPredecessorPath),
    ]);
    releasePredecessorEvidence = { canonical, smoke, normal };
    validateReleasePredecessorEvidenceCollection(releasePredecessorEvidence, {
      provenance,
      profile: provenance.profile,
    });
  } catch (error) {
    throw new Error(
      `Release tier requires passing same-source canonical, smoke, and normal predecessor evidence: ${error.message}`,
      { cause: error },
    );
  }
}

await mkdir(shardDirectory, { recursive: true });
for (const step of steps) {
  console.error(`[release-evidence] ${step.label}`);
  const result = spawnSync(
    process.execPath,
    [path.resolve(projectRoot, step.script), ...step.args],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  if (result.error) {
    throw new Error(
      `No release claim was emitted because ${step.label} could not run.`,
      { cause: result.error },
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `No release claim was emitted because ${step.label} failed with status ${result.status}.`,
    );
  }
  if (tier === 'release' && step.script === 'scripts/build-dungeon-augmentation-release-corpus.mjs') {
    const manifest = validateCorpusManifest(await readJson(manifestPath));
    validateReleasePredecessorEvidenceCollection(releasePredecessorEvidence, {
      manifestHash: manifest.evidenceHash,
      provenance: manifest.provenance,
      profile: manifest.profile,
    });
  }
}

console.log(JSON.stringify({
  result: 'passed',
  tier,
  profileId: RELEASE_PROFILE_ID,
  sourceHash: provenance.sourceHash,
  manifestPath,
  shardDirectory,
  aggregatePath,
  predecessorPaths: tier === 'release' ? {
    canonical: canonicalPredecessorPath,
    smoke: smokePredecessorPath,
    normal: normalPredecessorPath,
  } : null,
  receiptDirectory: tier === 'release' ? receiptDirectory : null,
  attestationPath: tier === 'release' ? attestationPath : null,
  shardCount: topology.shardCount,
  shardSize: topology.shardSize,
}, null, 2));
