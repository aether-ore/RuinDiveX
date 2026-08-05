import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const commandArguments = process.argv.slice(2);
const helpMode = commandArguments.includes('--help') || commandArguments.includes('-h');
const unitMode = commandArguments.includes('--unit');
const listFiles = commandArguments.includes('--list-files');
const countArguments = commandArguments.filter((argument) => argument.startsWith('--count='));
const unknownArguments = commandArguments.filter((argument) => (
  !['--help', '-h', '--unit', '--list-files'].includes(argument)
    && !argument.startsWith('--count=')
));

if (unknownArguments.length > 0) {
  throw new Error(`Unsupported argument(s): ${unknownArguments.join(', ')}`);
}
if (countArguments.length > 1) {
  throw new Error('--count may be supplied only once.');
}
if (helpMode && commandArguments.length > 1) {
  throw new Error('--help cannot be combined with verification arguments.');
}

const countArgument = countArguments[0];
const countValue = countArgument?.slice('--count='.length);
if (countArgument && (!/^\d+$/u.test(countValue) || Number(countValue) < 100)) {
  throw new Error('--count must be an integer greater than or equal to 100.');
}
const releaseSeedCount = countArgument ? Number(countValue) : 1000;
const seedCount = unitMode ? 100 : releaseSeedCount;

if (unitMode && countArgument) {
  throw new Error('--unit and --count cannot be used together.');
}
if (listFiles && (unitMode || countArgument)) {
  throw new Error('--list-files cannot be combined with seed configuration arguments.');
}

if (helpMode) {
  console.log([
    'Usage: node scripts/verify-dungeon-augmentation.mjs [--unit | --count=N]',
    '       node scripts/verify-dungeon-augmentation.mjs --list-files',
    '',
    '--unit        Run the focused 100-seed configuration.',
    '--count=N     Run the release configuration with N >= 100.',
    '--list-files  Print the discovered test inventory without running it.',
  ].join('\n'));
  process.exit(0);
}


const augmentationTestFiles = readdirSync(new URL('../tests/', import.meta.url), {
  withFileTypes: true,
})
  .filter((entry) => (
    entry.isFile()
      && /^dungeon-augmentation-.*\.test\.mjs$/u.test(entry.name)
  ))
  .map((entry) => `tests/${entry.name}`);

const testFiles = [...new Set([
  ...augmentationTestFiles,
  'tests/dungeon-performance-telemetry.test.mjs',
  'tests/dungeon-runtime-spatial-occlusion.test.mjs',
  'tests/dungeon-static-render-culling.test.mjs',
  'tests/dungeon-flat-surface-batching.test.mjs',
  'tests/dungeon-catwalk-presentation-batching.test.mjs',
  'tests/dungeon-ramp-grip-stripe-batching.test.mjs',
  'tests/dungeon-room-spawn-context-performance.test.mjs',
  'tests/dungeon-scaffold-access-optimization.test.mjs',
  'src/dungeon-augmentation/DungeonSupplementAssembler.test.mjs',
])].sort((left, right) => left.localeCompare(right));

if (listFiles) {
  console.log(testFiles.join('\n'));
  process.exit(0);
}

const verificationMode = unitMode ? 'focused unit run' : 'release seed configuration';
console.log(
  `Running ${testFiles.length} dungeon augmentation test files (${verificationMode}; seed-loop count ${seedCount}).`,
);
const result = spawnSync(process.execPath, [
  '--test',
  '--test-concurrency=1',
  ...testFiles,
], {
  cwd: projectRoot,
  env: {
    ...process.env,
    DUNGEON_AUGMENTATION_SEED_COUNT: String(seedCount),
  },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
