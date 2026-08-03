import { mkdtemp, rm } from 'node:fs/promises';
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
  readJson,
  readReleasePhaseHeartbeat,
  runReleaseSeedWorkerProcess,
  selectCorpusEntries,
  validateCompletedReleaseWorkerPhaseEvidence,
  validateCorpusManifest,
  validateSeedWorkerEvidence,
  writeImmutableJson,
} from './dungeon-augmentation-release-evidence.mjs';
import {
  RELEASE_CANONICAL_PROBES,
  createCanonicalProbeEvidence,
  validateCanonicalProbeEvidence,
} from './dungeon-augmentation-release-gates.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const argumentValue = (name) => process.argv
  .find((argument) => argument.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const manifestArgument = argumentValue('manifest');
const outputArgument = argumentValue('output');

if (!manifestArgument || !outputArgument) {
  throw new Error('--manifest=<path> and --output=<path> are required.');
}

const manifestPath = path.resolve(projectRoot, manifestArgument);
const outputPath = path.resolve(projectRoot, outputArgument);
const provenance = await createReleaseProvenance({
  projectRoot,
  profile: DUNGEON_AUGMENTATION_PROFILES[RELEASE_PROFILE_ID],
});
assertCleanReleaseProvenance(provenance, 'canonical release probe source');
const manifest = validateCorpusManifest(await readJson(manifestPath));
assertMatchingReleaseProvenance(provenance, manifest.provenance, 'canonical release probes');

for (const probe of RELEASE_CANONICAL_PROBES) {
  const entry = manifest.entries[probe.ordinal];
  if (!entry || entry.ordinal !== probe.ordinal || entry.seed !== probe.seed) {
    throw new Error(
      `Canonical release probe ${probe.ordinal} must be exact manifest seed ${probe.seed}.`,
    );
  }
}

try {
  const existing = validateCanonicalProbeEvidence(await readJson(outputPath), manifest);
  console.log(JSON.stringify({
    action: 'reused',
    outputPath,
    result: existing.result,
    accepted: existing.accepted,
    manifestHash: existing.manifestHash,
    evidenceHash: existing.evidenceHash,
    performance: existing.performance,
    gates: existing.gates,
  }, null, 2));
  process.exit(existing.accepted ? 0 : 1);
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
const workerDirectory = await mkdtemp(path.join(os.tmpdir(), 'dungeon-augmentation-canonical-'));
const records = [];
let failure = null;

try {
  for (const probe of RELEASE_CANONICAL_PROBES) {
    const entry = manifest.entries[probe.ordinal];
    const selection = selectCorpusEntries(manifest, {
      tier: 'release',
      ordinalStart: probe.ordinal,
      ordinalCount: 1,
    });
    const workerOutputPath = path.join(workerDirectory, `ordinal-${probe.ordinal}.json`);
    const workerHeartbeatPath = path.join(workerDirectory, `ordinal-${probe.ordinal}.phase.jsonl`);
    const child = runReleaseSeedWorkerProcess({
      executablePath: process.execPath,
      args: [
        verifierPath,
        `--manifest=${manifestPath}`,
        '--tier=release',
        `--ordinal-start=${probe.ordinal}`,
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
        tier: 'release',
        ordinal: probe.ordinal,
      });
    } catch (error) {
      workerValidationError = error;
    }
    let lastPhaseEvidence = null;
    let heartbeatReadError = null;
    try {
      lastPhaseEvidence = await readReleasePhaseHeartbeat(workerHeartbeatPath, {
        manifest,
        selection,
      });
      if (lastPhaseEvidence && worker?.result === 'passed') {
        validateCompletedReleaseWorkerPhaseEvidence(
          lastPhaseEvidence,
          worker.records?.[0]?.generatorPhaseTimings,
          {
            manifest,
            selection,
            label: `canonical seed worker ordinal ${probe.ordinal} phase evidence`,
          },
        );
      }
    } catch (error) {
      heartbeatReadError = error;
    }

    const record = worker?.records?.[0] ?? null;
    const workerPassed = !child.error
      && child.status === 0
      && worker?.result === 'passed'
      && record?.status === 'applied'
      && record?.realizationAttempts === 1
      && lastPhaseEvidence
      && !workerValidationError
      && !heartbeatReadError;
    if (!workerPassed) {
      const diagnosticError = child.error
        ?? heartbeatReadError
        ?? workerValidationError
        ?? worker?.failure
        ?? (!lastPhaseEvidence ? {
          name: 'CanonicalProbePhaseEvidenceError',
          message: 'Canonical probe did not retain phase heartbeat evidence.',
        } : null)
        ?? {
          name: 'CanonicalProbeRejected',
          message: `Canonical seed ${probe.seed} did not apply on realization attempt one.`,
        };
      failure = createReleaseWorkerFailureDiagnostics({
        errorName: diagnosticError?.name
          ?? diagnosticError?.errorName
          ?? 'CanonicalProbeProcessFailure',
        message: diagnosticError?.message
          ?? `Canonical probe exited with status ${child.status ?? 'unknown'}.`,
        entry,
        timedOut: child.error?.code === 'ETIMEDOUT',
        timeoutMs: RELEASE_PERFORMANCE_BUDGET_MS.ciTimeoutPerSeed,
        workerEvidenceHash: worker?.evidenceHash ?? null,
        workerFailure: worker?.failure ?? null,
        lastPhaseEvidence,
      });
      break;
    }

    records.push({
      ordinal: record.ordinal,
      seed: record.seed,
      status: record.status,
      realizationAttempts: record.realizationAttempts,
      releaseValidationAccepted: record.releaseValidationAccepted,
      releaseValidationErrorCount: record.releaseValidationErrorCount,
      acceptedAsPlayableAlpha: record.acceptedAsPlayableAlpha,
      strictRealizedAccepted: record.strictRealizedAccepted,
      acceptedParentParity: record.acceptedParentParity,
      elapsedMs: record.elapsedMs,
      generatorPhaseTimings: record.generatorPhaseTimings,
      workerEvidenceHash: worker.evidenceHash,
    });
    console.error(
      `[canonical ${records.length}/${RELEASE_CANONICAL_PROBES.length}] ${probe.seed}: applied`,
    );
  }

  const evidence = createCanonicalProbeEvidence({
    manifest,
    provenance,
    records,
    failure,
  });
  const action = await writeImmutableJson(outputPath, evidence);
  console.log(JSON.stringify({
    action,
    outputPath,
    result: evidence.result,
    accepted: evidence.accepted,
    manifestHash: evidence.manifestHash,
    evidenceHash: evidence.evidenceHash,
    performance: evidence.performance,
    gates: evidence.gates,
    failure: evidence.failure,
  }, null, 2));
  if (!evidence.accepted) process.exitCode = 1;
} finally {
  await rm(workerDirectory, { recursive: true, force: true });
}
