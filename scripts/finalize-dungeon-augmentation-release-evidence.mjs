import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';
import {
  RELEASE_PROFILE_ID,
  canonicalStringify,
  createReleaseAttestation,
  createReleaseProvenance,
  readJson,
  validateAggregateEvidenceForCurrentProvenance,
  validateReleaseAttestationForCurrentProvenance,
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
const outputArgument = argumentValue('output');
const receiptDirectoryArgument = argumentValue('receipt-dir');
const receiptArguments = argumentValues('receipt');

if (!aggregateArgument || !outputArgument) {
  throw new Error('--aggregate=<path> and --output=<path> are required.');
}
if (!receiptDirectoryArgument && receiptArguments.length === 0) {
  throw new Error('Supply all sealed suite receipts with --receipt or --receipt-dir.');
}

const currentProvenance = await createReleaseProvenance({
  projectRoot,
  profile: DUNGEON_AUGMENTATION_PROFILES[RELEASE_PROFILE_ID],
});
const aggregatePath = path.resolve(projectRoot, aggregateArgument);
const outputPath = path.resolve(projectRoot, outputArgument);
const aggregate = validateAggregateEvidenceForCurrentProvenance(
  await readJson(aggregatePath),
  currentProvenance,
  'release attestation aggregate',
);

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

const attestation = createReleaseAttestation({ aggregate, suiteReceipts });
const action = await writeImmutableJson(outputPath, attestation);
console.log(JSON.stringify({
  action,
  outputPath,
  result: attestation.result,
  releaseAccepted: attestation.releaseAccepted,
  aggregateEvidenceHash: attestation.aggregateEvidenceHash,
  suiteReceiptEvidenceHashes: attestation.suiteReceiptEvidenceHashes,
  gates: attestation.gates,
  evidenceHash: attestation.evidenceHash,
}, null, 2));
if (!attestation.releaseAccepted) process.exitCode = 1;
