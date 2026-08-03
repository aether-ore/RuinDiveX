import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';
import {
  RELEASE_PERFORMANCE_BUDGET_MS,
  RELEASE_PROFILE_ID,
  assertCleanReleaseProvenance,
  assertMatchingReleaseProvenance,
  createReleaseProvenance,
  createReleaseWorkerFailureDiagnostics,
  createShardEvidence,
  readJson,
  readReleasePhaseHeartbeat,
  runReleaseSeedWorkerProcess,
  selectCorpusEntries,
  validateCompletedReleaseWorkerPhaseEvidence,
  validateCorpusManifest,
  validateSeedWorkerEvidence,
  validateShardEvidence,
  writeImmutableJson,
} from './dungeon-augmentation-release-evidence.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const argumentValue = (name) => process.argv
  .find((argument) => argument.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const manifestArgument = argumentValue('manifest');
const outputArgument = argumentValue('output');
const tier = argumentValue('tier') ?? 'release';
const shardIndex = Number.parseInt(argumentValue('shard-index') ?? '', 10);
const shardCount = Number.parseInt(argumentValue('shard-count') ?? '', 10);

if (!manifestArgument || !outputArgument) {
  throw new Error('--manifest=<path> and --output=<path> are required.');
}
if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount)) {
  throw new Error('--shard-index and --shard-count are required integers.');
}

const manifestPath = path.resolve(projectRoot, manifestArgument);
const outputPath = path.resolve(projectRoot, outputArgument);
const provenance = await createReleaseProvenance({
  projectRoot,
  profile: DUNGEON_AUGMENTATION_PROFILES[RELEASE_PROFILE_ID],
});
assertCleanReleaseProvenance(provenance, 'release shard runner source');
const manifest = validateCorpusManifest(await readJson(manifestPath));
const selection = selectCorpusEntries(manifest, { tier, shardIndex, shardCount });
assertMatchingReleaseProvenance(provenance, manifest.provenance, 'release shard runner');

try {
  await access(outputPath);
  const existing = validateShardEvidence(await readJson(outputPath), manifest);
  const exactSelection = existing.ordinalStart === selection.ordinalStart
    && existing.ordinalEndExclusive === selection.ordinalEndExclusive
    && existing.corpusTier === selection.tier
    && existing.corpusViewCount === selection.viewCount;
  if (!exactSelection) throw new Error('Existing immutable shard uses a different ordinal range.');
  console.log(JSON.stringify({
    action: 'reused',
    outputPath,
    result: existing.result,
    ordinalStart: existing.ordinalStart,
    ordinalEndExclusive: existing.ordinalEndExclusive,
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

const verifierPath = fileURLToPath(new URL('./verify-dungeon-augmentation-realized.mjs', import.meta.url));
const timeoutMs = RELEASE_PERFORMANCE_BUDGET_MS.ciTimeoutPerSeed;
const workerDirectory = await mkdtemp(path.join(os.tmpdir(), 'dungeon-augmentation-seed-workers-'));
const records = [];
let shardFailure = null;

try {
  for (const entry of selection.entries) {
    const workerOutputPath = path.join(
      workerDirectory,
      `ordinal-${String(entry.ordinal).padStart(4, '0')}.json`,
    );
    const workerHeartbeatPath = path.join(
      workerDirectory,
      `ordinal-${String(entry.ordinal).padStart(4, '0')}.phase.jsonl`,
    );
    const workerSelection = selectCorpusEntries(manifest, {
      tier,
      ordinalStart: entry.ordinal,
      ordinalCount: 1,
    });
    const child = runReleaseSeedWorkerProcess({
      executablePath: process.execPath,
      args: [
        verifierPath,
        `--manifest=${manifestPath}`,
        `--tier=${tier}`,
        `--ordinal-start=${entry.ordinal}`,
        '--ordinal-count=1',
        `--seed-worker-output=${workerOutputPath}`,
        `--phase-heartbeat=${workerHeartbeatPath}`,
        '--summary',
      ],
      cwd: projectRoot,
      stdio: ['ignore', 'ignore', 'inherit'],
    });

    let worker = null;
    let workerValidationError = null;
    try {
      worker = validateSeedWorkerEvidence(await readJson(workerOutputPath), manifest, {
        tier,
        ordinal: entry.ordinal,
      });
    } catch (error) {
      workerValidationError = error;
    }
    let lastPhaseEvidence = null;
    let heartbeatReadError = null;
    try {
      lastPhaseEvidence = await readReleasePhaseHeartbeat(workerHeartbeatPath, {
        manifest,
        selection: workerSelection,
      });
      if (lastPhaseEvidence && worker?.result === 'passed') {
        validateCompletedReleaseWorkerPhaseEvidence(
          lastPhaseEvidence,
          worker.records?.[0]?.generatorPhaseTimings,
          {
            manifest,
            selection: workerSelection,
            label: `release seed worker ordinal ${entry.ordinal} phase evidence`,
          },
        );
      }
    } catch (error) {
      heartbeatReadError = error;
    }

    if (child.error
      || child.status !== 0
      || worker?.result !== 'passed'
      || workerValidationError
      || heartbeatReadError
      || !lastPhaseEvidence) {
      const diagnosticError = child.error
        ?? heartbeatReadError
        ?? workerValidationError
        ?? worker?.failure
        ?? (!lastPhaseEvidence ? {
          name: 'SeedWorkerPhaseEvidenceError',
          message: 'Release seed worker did not retain phase heartbeat evidence.',
        } : null)
        ?? null;
      shardFailure = createReleaseWorkerFailureDiagnostics({
        errorName: diagnosticError?.name
          ?? diagnosticError?.errorName
          ?? 'VerifierProcessFailure',
        message: diagnosticError?.message
          ?? `Realized verifier exited with status ${child.status ?? 'unknown'}.`,
        entry,
        timedOut: child.error?.code === 'ETIMEDOUT',
        timeoutMs,
        workerEvidenceHash: worker?.evidenceHash ?? null,
        workerFailure: worker?.failure ?? null,
        lastPhaseEvidence,
      });
      if (child.error) console.error(child.error.stack ?? child.error);
      break;
    }

    records.push(worker.records[0]);
    console.error(
      `[${records.length}/${selection.entries.length}] ${entry.seed}: ${worker.records[0].status}`,
    );
  }

  const artifact = createShardEvidence({
    manifest,
    selection,
    provenance,
    records,
    result: shardFailure ? 'failed' : 'passed',
    failure: shardFailure,
  });
  await writeImmutableJson(outputPath, artifact);
} finally {
  await rm(workerDirectory, { recursive: true, force: true });
}

const artifact = validateShardEvidence(await readJson(outputPath), manifest);
if (artifact.result !== 'passed') process.exitCode = 1;
