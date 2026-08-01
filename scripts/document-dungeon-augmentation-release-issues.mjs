import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';
import {
  RELEASE_PERFORMANCE_BUDGET_MS,
  RELEASE_PROFILE_ID,
  RELEASE_PROFILE_REVISION,
  createReleaseProvenance,
  readJson,
  validateReleaseAttestationForCurrentProvenance,
} from './dungeon-augmentation-release-evidence.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const EVIDENCE_START = '<!-- V4_RELEASE_EVIDENCE_START -->';
const EVIDENCE_END = '<!-- V4_RELEASE_EVIDENCE_END -->';
const argumentValue = (name) => process.argv
  .find((argument) => argument.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const evidenceArgument = argumentValue('evidence');
const reportArgument = argumentValue('report');
const checkOnly = process.argv.includes('--check');
const reportPath = reportArgument
  ? path.resolve(projectRoot, reportArgument)
  : path.resolve(projectRoot, 'docs/DUNGEON_AUGMENTATION_V4_RELEASE_ISSUES.md');

const yesNo = (value) => (value ? 'passed' : 'failed');
const displayMilliseconds = (value) => (
  Number.isFinite(value) ? `${(value / 1000).toFixed(2)} s` : 'not recorded'
);

function buildUnevidencedBlock() {
  return [
    EVIDENCE_START,
    '## Release evidence status — blocked',
    '',
    'No sealed aggregate-and-receipts attestation has been supplied for this working tree.',
    '',
    `- Authoritative profile: \`${RELEASE_PROFILE_ID}\` revision ${RELEASE_PROFILE_REVISION}.`,
    '- Immutable accepted-parent corpus: **not supplied**.',
    '- Ordinal shard coverage: **not established**.',
    '- First-realization, strict-validation, diversity, and performance gates: **not established**.',
    '- Overall V4 release readiness: **blocked**.',
    '',
    'This block is intentionally conservative. A canonical validator witness, a playable-alpha run, or a corpus aggregate without all same-source receipts cannot establish release. Supply `--evidence=<release-attestation.json>` only after the manifest shards and every required suite receipt have been sealed.',
    EVIDENCE_END,
  ].join('\n');
}

function buildAttestationBlock(attestation, evidencePath) {
  const aggregate = attestation.aggregate;
  const failedGates = Object.entries(aggregate.gates ?? {})
    .filter(([, accepted]) => accepted !== true)
    .map(([gate]) => gate);
  const corpusStatus = aggregate.corpusAccepted === true ? 'passed' : 'failed';
  const evidenceDate = String(aggregate.generatedAt ?? new Date().toISOString()).slice(0, 10);
  const failedAttestationGates = Object.entries(attestation.gates ?? {})
    .filter(([, accepted]) => accepted !== true)
    .map(([gate]) => gate);
  const overallReady = attestation.releaseAccepted === true;
  const lines = [
    EVIDENCE_START,
    `## Release evidence status — ${overallReady ? 'ready' : 'blocked'}`,
    '',
    `Regenerated ${evidenceDate} from sealed aggregate-and-receipts attestation \`${path.basename(evidencePath)}\`.`,
    '',
    `- Authoritative profile: \`${aggregate.profile.id}\` revision ${aggregate.profile.revision}.`,
    `- Git commit: \`${aggregate.provenance?.gitCommit ?? 'unavailable'}\`.`,
    `- Release-source hash: \`${aggregate.provenance?.sourceHash ?? 'unavailable'}\`.`,
    `- Profile hash: \`${aggregate.profile.hash}\`.`,
    `- Accepted-parent manifest hash: \`${aggregate.manifestHash}\`.`,
    `- Corpus tier and coverage: **${aggregate.corpusTier}**, ${aggregate.recordCount}/${aggregate.expectedSeedCount} records across ${aggregate.shardCount} shards.`,
    `- Corpus acceptance: **${corpusStatus}**.`,
    `- Zero fallback: **${yesNo(aggregate.gates.zeroFallback)}**.`,
    `- First realization for every corpus entry: **${yesNo(aggregate.gates.firstRealization)}**.`,
    `- Current release validator: **${yesNo(aggregate.gates.releaseValidation)}**.`,
    `- Strict realized verifier: **${yesNo(aggregate.gates.strictRealizedValidation)}**.`,
    `- Accepted-parent parity: **${yesNo(aggregate.gates.acceptedParentParity)}**.`,
    `- Corpus diversity: **${yesNo(aggregate.gates.diversity)}**.`,
    `- Performance: **${yesNo(aggregate.gates.performance)}**; median ${displayMilliseconds(aggregate.performance?.medianMs)}, p95 ${displayMilliseconds(aggregate.performance?.p95Ms)}, maximum ${displayMilliseconds(aggregate.performance?.maximumMs)}.`,
    `- Versioned performance budget: median ≤ ${displayMilliseconds(RELEASE_PERFORMANCE_BUDGET_MS.median)}, p95 ≤ ${displayMilliseconds(RELEASE_PERFORMANCE_BUDGET_MS.p95)}, maximum ≤ ${displayMilliseconds(RELEASE_PERFORMANCE_BUDGET_MS.maximum)}.`,
    `- Aggregate evidence hash: \`${aggregate.evidenceHash}\`.`,
    ...attestation.suiteReceipts.map((receipt) => (
      `- ${receipt.label}: **${receipt.result}**; receipt \`${receipt.evidenceHash}\`.`
    )),
    `- Release attestation hash: \`${attestation.evidenceHash}\`.`,
    `- Overall V4 release readiness: **${overallReady ? 'ready' : 'blocked'}**.`,
    '',
  ];
  if (failedGates.length > 0) {
    lines.push(`Failed corpus gates: ${failedGates.map((gate) => `\`${gate}\``).join(', ')}.`, '');
  }
  if (failedAttestationGates.length > 0) {
    lines.push(
      `Failed aggregate-and-receipts gates: ${failedAttestationGates.map((gate) => `\`${gate}\``).join(', ')}.`,
      '',
    );
  }
  lines.push(
    overallReady
      ? 'All release corpus and independently sealed same-source suite gates passed. The historical register remains preserved below as audit evidence.'
      : 'The release attestation failed. The historical register remains open; alpha acceptance, weaker one-seed validation, or an aggregate without matching receipts cannot substitute for the failed evidence.',
    EVIDENCE_END,
  );
  return lines.join('\n');
}

let attestation = null;
let evidencePath = null;
if (evidenceArgument) {
  evidencePath = path.resolve(projectRoot, evidenceArgument);
  const currentProvenance = await createReleaseProvenance({
    projectRoot,
    profile: DUNGEON_AUGMENTATION_PROFILES[RELEASE_PROFILE_ID],
  });
  attestation = validateReleaseAttestationForCurrentProvenance(
    await readJson(evidencePath),
    currentProvenance,
  );
}
const evidenceBlock = attestation
  ? buildAttestationBlock(attestation, evidencePath)
  : buildUnevidencedBlock();
const report = await readFile(reportPath, 'utf8');
if (!report.includes('ISSUE-001') || !report.includes('ISSUE-175')) {
  throw new Error('The historical ISSUE-001 through ISSUE-175 register is missing or incomplete.');
}
const markerPattern = new RegExp(`${EVIDENCE_START}[\\s\\S]*?${EVIDENCE_END}`, 'u');
if (!markerPattern.test(report)) {
  throw new Error(`Release report is missing the narrow ${EVIDENCE_START} evidence block.`);
}
const updatedReport = report.replace(markerPattern, evidenceBlock);
if (checkOnly) {
  if (updatedReport !== report) {
    throw new Error('Release evidence section is stale. Regenerate it without --check.');
  }
} else if (updatedReport !== report) {
  await writeFile(reportPath, updatedReport, 'utf8');
}
console.log(JSON.stringify({
  reportPath,
  evidencePath,
  aggregateEvidenceHash: attestation?.aggregateEvidenceHash ?? null,
  attestationEvidenceHash: attestation?.evidenceHash ?? null,
  corpusAccepted: attestation?.aggregate?.corpusAccepted ?? false,
  overallReleaseReady: attestation?.releaseAccepted ?? false,
  changed: updatedReport !== report,
  checkOnly,
}, null, 2));
