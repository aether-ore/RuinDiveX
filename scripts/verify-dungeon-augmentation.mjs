import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const countArgument = process.argv.find((argument) => argument.startsWith('--count='));
const requestedCount = Number.parseInt(countArgument?.slice('--count='.length) ?? '1000', 10);
const seedCount = Number.isFinite(requestedCount) && requestedCount >= 100
  ? requestedCount
  : 1000;

const testFiles = [
  'tests/dungeon-augmentation-core.test.mjs',
  'tests/dungeon-augmentation-theme-session.test.mjs',
  'tests/dungeon-augmentation-materializer.test.mjs',
  'tests/dungeon-augmentation-persistence.test.mjs',
  'src/dungeon-augmentation/DungeonSupplementAssembler.test.mjs',
];

console.log(`Verifying dungeon augmentation across ${seedCount} deterministic seeds.`);
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
