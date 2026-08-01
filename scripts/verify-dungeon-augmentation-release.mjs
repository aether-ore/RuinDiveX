import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';
import {
  RELEASE_PROFILE_ID,
  RELEASE_REQUIRED_SUITE_IDS,
  RELEASE_SHARD_TOPOLOGY,
  createReleaseProvenance,
  hashCanonicalValue,
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
const sourceEvidenceId = hashCanonicalValue({
  gitCommit: provenance.gitCommit,
  sourceHash: provenance.sourceHash,
  profileHash: provenance.profile.hash,
  nodeVersion: provenance.nodeVersion,
  platform: provenance.platform,
  machine: provenance.machine,
}, 'dungeon-augmentation-v4-release-artifact-root-v1')
  .replace(/[^a-z0-9-]/giu, '-');
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
    receiptDirectory: tier === 'release' ? receiptDirectory : null,
    attestationPath: tier === 'release' ? attestationPath : null,
    shardCount: topology.shardCount,
    shardSize: topology.shardSize,
    steps,
  }, null, 2));
  process.exit(0);
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
}

console.log(JSON.stringify({
  result: 'passed',
  tier,
  profileId: RELEASE_PROFILE_ID,
  sourceHash: provenance.sourceHash,
  manifestPath,
  shardDirectory,
  aggregatePath,
  receiptDirectory: tier === 'release' ? receiptDirectory : null,
  attestationPath: tier === 'release' ? attestationPath : null,
  shardCount: topology.shardCount,
  shardSize: topology.shardSize,
}, null, 2));
