import { access } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';
import {
  RELEASE_PROFILE_ID,
  RELEASE_REQUIRED_SUITE_IDS,
  RELEASE_SUITE_CONTRACTS,
  assertCleanReleaseProvenance,
  assertMatchingReleaseProvenance,
  createReleaseProvenance,
  createReleaseReceiptEnvironment,
  createReleaseSuiteReceipt,
  readJson,
  validateReleaseSuiteReceipt,
  writeImmutableJson,
} from './dungeon-augmentation-release-evidence.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const argumentValue = (name) => process.argv
  .find((argument) => argument.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const suiteId = argumentValue('suite');
const outputArgument = argumentValue('output');

if (!RELEASE_REQUIRED_SUITE_IDS.includes(suiteId)) {
  throw new Error(`--suite must be one of ${RELEASE_REQUIRED_SUITE_IDS.join(', ')}.`);
}
if (!outputArgument) throw new Error('--output=<path> is required for an immutable receipt.');

const outputPath = path.resolve(projectRoot, outputArgument);
const profile = DUNGEON_AUGMENTATION_PROFILES[RELEASE_PROFILE_ID];
const provenance = await createReleaseProvenance({ projectRoot, profile });
assertCleanReleaseProvenance(provenance, `release receipt ${suiteId} source before run`);

try {
  await access(outputPath);
  const existing = validateReleaseSuiteReceipt(await readJson(outputPath));
  if (existing.suiteId !== suiteId) {
    throw new Error('Existing immutable receipt belongs to another suite.');
  }
  assertMatchingReleaseProvenance(existing.provenance, provenance, 'existing release receipt');
  console.log(JSON.stringify({
    action: 'reused',
    outputPath,
    suiteId,
    result: existing.result,
    evidenceHash: existing.evidenceHash,
  }, null, 2));
  process.exit(existing.result === 'passed' ? 0 : 1);
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

const contract = RELEASE_SUITE_CONTRACTS[suiteId];
const releaseCommandEnvironment = createReleaseReceiptEnvironment(process.env);
const commandResults = [];
let priorCommandFailed = false;
for (const command of contract.commands) {
  if (priorCommandFailed) {
    commandResults.push({
      id: command.id,
      runner: command.runner,
      args: [...command.args],
      status: null,
      signal: null,
      error: { code: 'PRIOR_COMMAND_FAILED' },
      skipped: true,
      elapsedMs: 0,
    });
    continue;
  }
  console.error(`[release-receipt:${suiteId}] ${command.id}`);
  const startedAt = performance.now();
  const result = spawnSync(process.execPath, [...command.args], {
    cwd: projectRoot,
    env: releaseCommandEnvironment,
    stdio: 'inherit',
    windowsHide: true,
  });
  const commandResult = {
    id: command.id,
    runner: command.runner,
    args: [...command.args],
    status: Number.isInteger(result.status) ? result.status : 1,
    signal: result.signal ?? null,
    error: result.error ? {
      name: result.error.name ?? 'Error',
      code: result.error.code ?? null,
      message: result.error.message ?? String(result.error),
    } : null,
    skipped: false,
    elapsedMs: performance.now() - startedAt,
  };
  commandResults.push(commandResult);
  priorCommandFailed = commandResult.status !== 0
    || commandResult.signal != null
    || commandResult.error != null;
}

const postRunProvenance = await createReleaseProvenance({ projectRoot, profile });
const sourceStable = provenance.gitCommit === postRunProvenance.gitCommit
  && provenance.sourceHash === postRunProvenance.sourceHash
  && provenance.profile.hash === postRunProvenance.profile.hash
  && provenance.sourceDirty === false
  && postRunProvenance.sourceDirty === false;
const receipt = createReleaseSuiteReceipt({
  suiteId,
  provenance,
  commandResults,
  sourceStable,
  postRunSourceHash: postRunProvenance.sourceHash,
  postRunSourceDirty: postRunProvenance.sourceDirty,
});
const action = await writeImmutableJson(outputPath, receipt);
console.log(JSON.stringify({
  action,
  outputPath,
  suiteId,
  result: receipt.result,
  sourceStable: receipt.sourceStable,
  evidenceHash: receipt.evidenceHash,
  commandResults: receipt.commandResults.map(({ id, status, skipped, elapsedMs }) => ({
    id,
    status,
    skipped,
    elapsedMs,
  })),
}, null, 2));
if (receipt.result !== 'passed') process.exitCode = 1;
