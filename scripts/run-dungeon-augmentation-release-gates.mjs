import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';
import {
  RELEASE_PROFILE_ID,
  assertCleanReleaseProvenance,
  createReleaseArtifactIdentity,
  createReleaseProvenance,
} from './dungeon-augmentation-release-evidence.mjs';
import {
  RELEASE_CANONICAL_PROBES,
  createReleaseGateSteps,
  runReleaseGateSteps,
} from './dungeon-augmentation-release-gates.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const argumentValue = (name) => process.argv
  .find((argument) => argument.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const through = argumentValue('through') ?? 'release';
const requestedArtifactRoot = argumentValue('artifact-root');
const printPlan = process.argv.includes('--print-plan');

const provenance = await createReleaseProvenance({
  projectRoot,
  profile: DUNGEON_AUGMENTATION_PROFILES[RELEASE_PROFILE_ID],
});
assertCleanReleaseProvenance(provenance, 'release gate runner source');
const sourceEvidenceId = createReleaseArtifactIdentity(provenance);
const artifactRoot = requestedArtifactRoot
  ? path.resolve(projectRoot, requestedArtifactRoot)
  : path.join(
    projectRoot,
    'artifacts',
    'dungeon-augmentation-v4-release',
    sourceEvidenceId,
  );
const plan = createReleaseGateSteps({ projectRoot, artifactRoot, through });

if (printPlan) {
  console.log(JSON.stringify({
    ...plan,
    profileId: RELEASE_PROFILE_ID,
    sourceHash: provenance.sourceHash,
    canonicalProbes: RELEASE_CANONICAL_PROBES,
  }, null, 2));
  process.exit(0);
}

const outcome = runReleaseGateSteps({
  plan,
  provenance,
  onStep(step, index) {
    console.error(
      `[release-gate ${index + 1}/${plan.steps.length}] ${step.label}`,
    );
  },
});

console.log(JSON.stringify({
  ...outcome,
  through,
  profileId: RELEASE_PROFILE_ID,
  sourceHash: provenance.sourceHash,
  artifactRoot,
  manifestPath: plan.manifestPath,
  performanceBudgetMs: plan.performanceBudgetMs,
  watchdogTimeoutMs: plan.watchdogTimeoutMs,
}, null, 2));
if (outcome.result !== 'passed') process.exitCode = 1;
