import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const unitMode = process.argv.includes('--unit');
const listFiles = process.argv.includes('--list-files');
const countArgument = process.argv.find((argument) => argument.startsWith('--count='));
const requestedCount = Number.parseInt(countArgument?.slice('--count='.length) ?? '1000', 10);
const releaseSeedCount = Number.isFinite(requestedCount) && requestedCount >= 100
  ? requestedCount
  : 1000;
const seedCount = unitMode ? 100 : releaseSeedCount;

if (unitMode && countArgument) {
  throw new Error('--unit and --count cannot be used together.');
}

const testFiles = [
  'tests/dungeon-augmentation-core.test.mjs',
  'tests/dungeon-augmentation-validation.test.mjs',
  'tests/dungeon-augmentation-theme-session.test.mjs',
  'tests/dungeon-augmentation-materializer.test.mjs',
  'tests/dungeon-augmentation-persistence.test.mjs',
  'tests/dungeon-augmentation-legacy-applied-replay.test.mjs',
  'tests/dungeon-augmentation-effective-progression.test.mjs',
  'tests/dungeon-augmentation-shortcut-runtime.test.mjs',
  'tests/dungeon-augmentation-industrial-host-v4.test.mjs',
  'tests/dungeon-augmentation-blueprints.test.mjs',
  'tests/dungeon-augmentation-blueprint-integration.test.mjs',
  'tests/dungeon-augmentation-topology-blueprint-reachability.test.mjs',
  'tests/dungeon-augmentation-content.test.mjs',
  'tests/dungeon-augmentation-runtime-content-integration.test.mjs',
  'tests/dungeon-augmentation-socket-seam-realization.test.mjs',
  'tests/dungeon-augmentation-issue-066.test.mjs',
  'tests/dungeon-augmentation-wrong-seam-side-regressions.test.mjs',
  'tests/dungeon-augmentation-runtime-contracts.test.mjs',
  'tests/dungeon-augmentation-selection-witness.test.mjs',
  'tests/dungeon-augmentation-structural-frames.test.mjs',
  'tests/dungeon-augmentation-release-evidence.test.mjs',
  'src/dungeon-augmentation/DungeonSupplementAssembler.test.mjs',
];

if (listFiles) {
  console.log(testFiles.join('\n'));
  process.exit(0);
}

const verificationMode = unitMode ? 'focused unit run' : 'release seed sweep';
console.log(`Running dungeon augmentation ${verificationMode} across ${seedCount} deterministic seeds.`);
const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: projectRoot,
  env: {
    ...process.env,
    DUNGEON_AUGMENTATION_SEED_COUNT: String(seedCount),
  },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
