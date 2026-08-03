import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';
import {
  RELEASE_PROFILE_ID,
  assertCleanReleaseProvenance,
  canonicalStringify,
  createReleaseAttestation,
  createReleaseProvenance,
  readJson,
  validateAggregateEvidenceForCurrentProvenance,
  validateReleaseAttestationForCurrentProvenance,
  validateReleasePredecessorEvidenceCollection,
  validateReleaseSuiteReceipt,
  writeImmutableJson,
} from './dungeon-augmentation-release-evidence.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const argumentValue = (name) => process.argv
  .find((argument) => argument.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const argumentValues = (name) => process.argv
  .filter((argument) => argument.startsWith(`--${name}=`))
  .map((argument) => argument.slice(name.length + 3));
const aggregateArgument = argumentValue('aggregate');
const canonicalArgument = argumentValue('canonical');
const smokeAggregateArgument = argumentValue('smoke-aggregate');
const normalAggregateArgument = argumentValue('normal-aggregate');
const outputArgument = argumentValue('output');
const receiptDirectoryArgument = argumentValue('receipt-dir');
const receiptArguments = argumentValues('receipt');

if (!aggregateArgument || !canonicalArgument || !smokeAggregateArgument
  || !normalAggregateArgument || !outputArgument) {
  throw new Error(
    '--aggregate, --canonical, --smoke-aggregate, --normal-aggregate, and --output are required.',
  );
}
if (!receiptDirectoryArgument && receiptArguments.length === 0) {
  throw new Error('Supply all sealed suite receipts with --receipt or --receipt-dir.');
}

const currentProvenance = await createReleaseProvenance({
  projectRoot,
  profile: DUNGEON_AUGMENTATION_PROFILES[RELEASE_PROFILE_ID],
});
assertCleanReleaseProvenance(currentProvenance, 'release attestation source');
const aggregatePath = path.resolve(projectRoot, aggregateArgument);
const outputPath = path.resolve(projectRoot, outputArgument);
const aggregate = validateAggregateEvidenceForCurrentProvenance(
  await readJson(aggregatePath),
  currentProvenance,
  'release attestation aggregate',
);
const predecessorEvidence = validateReleasePredecessorEvidenceCollection({
  canonical: await readJson(path.resolve(projectRoot, canonicalArgument)),
  smoke: await readJson(path.resolve(projectRoot, smokeAggregateArgument)),
  normal: await readJson(path.resolve(projectRoot, normalAggregateArgument)),
}, {
  manifestHash: aggregate.manifestHash,
  provenance: aggregate.provenance,
  profile: aggregate.profile,
});

const receiptPaths = receiptArguments.map((filePath) => path.resolve(projectRoot, filePath));
if (receiptDirectoryArgument) {
  const directory = path.resolve(projectRoot, receiptDirectoryArgument);
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  for (const name of names) receiptPaths.push(path.join(directory, name));
}
const suiteReceipts = [];
for (const receiptPath of receiptPaths) {
  suiteReceipts.push(validateReleaseSuiteReceipt(await readJson(receiptPath)));
}

let existing = null;
try {
  existing = validateReleaseAttestationForCurrentProvenance(
    await readJson(outputPath),
    currentProvenance,
    'existing release attestation',
  );
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

if (existing) {
  if (existing.aggregateEvidenceHash !== aggregate.evidenceHash) {
    throw new Error('Existing immutable attestation references another aggregate.');
  }
  const suppliedPredecessorHashes = Object.fromEntries(
    Object.entries(predecessorEvidence).map(([stage, evidence]) => [
      stage,
      evidence.evidenceHash,
    ]),
  );
  if (canonicalStringify(existing.predecessorEvidenceHashes)
    !== canonicalStringify(suppliedPredecessorHashes)) {
    throw new Error('Existing immutable attestation references different predecessor evidence.');
  }
  const suppliedReceiptHashes = Object.fromEntries(suiteReceipts.map((receipt) => [
    receipt.suiteId,
    receipt.evidenceHash,
  ]));
  if (canonicalStringify(existing.suiteReceiptEvidenceHashes)
    !== canonicalStringify(suppliedReceiptHashes)) {
    throw new Error('Existing immutable attestation references different suite receipts.');
  }
  console.log(JSON.stringify({
    action: 'reused',
    outputPath,
    result: existing.result,
    releaseAccepted: existing.releaseAccepted,
    evidenceHash: existing.evidenceHash,
  }, null, 2));
  process.exit(existing.releaseAccepted ? 0 : 1);
}

const attestation = createReleaseAttestation({
  aggregate,
  predecessorEvidence,
  suiteReceipts,
});
const action = await writeImmutableJson(outputPath, attestation);
console.log(JSON.stringify({
  action,
  outputPath,
  result: attestation.result,
  releaseAccepted: attestation.releaseAccepted,
  aggregateEvidenceHash: attestation.aggregateEvidenceHash,
  predecessorEvidenceHashes: attestation.predecessorEvidenceHashes,
  suiteReceiptEvidenceHashes: attestation.suiteReceiptEvidenceHashes,
  gates: attestation.gates,
  evidenceHash: attestation.evidenceHash,
}, null, 2));
if (!attestation.releaseAccepted) process.exitCode = 1;
