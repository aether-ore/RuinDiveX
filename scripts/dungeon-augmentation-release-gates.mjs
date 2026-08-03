import { spawnSync } from 'node:child_process';
import path from 'node:path';

import {
  RELEASE_CANONICAL_GATE_SCHEMA,
  RELEASE_CANONICAL_PROBES,
  RELEASE_PERFORMANCE_BUDGET_MS,
  assertCleanReleaseProvenance,
  canonicalProbeGates,
  canonicalProbePerformance,
  createCanonicalProbeEvidence,
  validateCanonicalProbeEvidence,
} from './dungeon-augmentation-release-evidence.mjs';

export {
  RELEASE_CANONICAL_GATE_SCHEMA,
  RELEASE_CANONICAL_PROBES,
  canonicalProbeGates,
  canonicalProbePerformance,
  createCanonicalProbeEvidence,
  validateCanonicalProbeEvidence,
};

export const RELEASE_GATE_TIERS = Object.freeze([
  Object.freeze({ id: 'canonical', seedCount: RELEASE_CANONICAL_PROBES.length }),
  Object.freeze({ id: 'smoke', seedCount: 10 }),
  Object.freeze({ id: 'normal', seedCount: 100 }),
  Object.freeze({ id: 'release', seedCount: 1_000 }),
]);

export function createReleaseGateSteps({
  projectRoot,
  artifactRoot,
  through = 'release',
}) {
  const terminalIndex = RELEASE_GATE_TIERS.findIndex(({ id }) => id === through);
  if (terminalIndex < 0) {
    throw new Error(`--through must be one of ${RELEASE_GATE_TIERS.map(({ id }) => id).join(', ')}.`);
  }
  const manifestPath = path.join(artifactRoot, 'accepted-parent-manifest-1000.json');
  const steps = [{
    id: 'manifest',
    label: 'immutable 1,000-parent release manifest',
    seedCount: 1_000,
    script: 'scripts/build-dungeon-augmentation-release-corpus.mjs',
    args: ['--tier=release', `--output=${manifestPath}`, '--progress'],
  }, {
    id: 'canonical',
    label: 'canonical seed 0/1 gate',
    seedCount: RELEASE_CANONICAL_PROBES.length,
    script: 'scripts/run-dungeon-augmentation-canonical-probes.mjs',
    args: [
      `--manifest=${manifestPath}`,
      `--output=${path.join(artifactRoot, 'canonical-seed-0-1.json')}`,
    ],
  }];
  for (const tier of RELEASE_GATE_TIERS.slice(1, terminalIndex + 1)) {
    steps.push({
      id: tier.id,
      label: `${tier.seedCount.toLocaleString('en-US')}-seed ${tier.id} corpus gate`,
      seedCount: tier.seedCount,
      script: 'scripts/verify-dungeon-augmentation-release.mjs',
      args: [`--tier=${tier.id}`, `--artifact-root=${artifactRoot}`],
    });
  }
  return {
    through,
    projectRoot,
    artifactRoot,
    manifestPath,
    steps,
    performanceBudgetMs: {
      median: RELEASE_PERFORMANCE_BUDGET_MS.median,
      p95: RELEASE_PERFORMANCE_BUDGET_MS.p95,
      maximum: RELEASE_PERFORMANCE_BUDGET_MS.maximum,
    },
    watchdogTimeoutMs: RELEASE_PERFORMANCE_BUDGET_MS.ciTimeoutPerSeed,
  };
}

export function runReleaseGateSteps({
  plan,
  provenance,
  executablePath = process.execPath,
  environment = process.env,
  spawnSyncImpl = spawnSync,
  onStep = () => {},
}) {
  assertCleanReleaseProvenance(provenance, 'release gate runner source');
  const completedStages = [];
  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index];
    onStep(step, index);
    const child = spawnSyncImpl(
      executablePath,
      [path.resolve(plan.projectRoot, step.script), ...step.args],
      {
        cwd: plan.projectRoot,
        env: environment,
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    if (child?.error || child?.status !== 0) {
      return {
        result: 'failed',
        failedStage: step.id,
        failedStatus: child?.status ?? null,
        errorName: child?.error?.name ?? null,
        errorMessage: child?.error?.message ?? null,
        completedStages,
        blockedStages: plan.steps.slice(index + 1).map(({ id }) => id),
      };
    }
    completedStages.push(step.id);
  }
  return {
    result: 'passed',
    failedStage: null,
    failedStatus: null,
    errorName: null,
    errorMessage: null,
    completedStages,
    blockedStages: [],
  };
}
