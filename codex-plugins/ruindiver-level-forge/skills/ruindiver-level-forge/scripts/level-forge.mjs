#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const candidates = [
  process.env.RUINDIVER_LEVEL_FORGE_ROOT,
  process.cwd(),
  'C:\\Users\\K\\Documents\\New Three.js Practice',
].filter(Boolean);
const repository = candidates.find((candidate) => (
  existsSync(path.join(candidate, 'level-editor.html'))
  && existsSync(path.join(candidate, 'scripts', 'level-forge-cli.mjs'))
));

if (!repository) {
  process.stderr.write('RuinDiver Level Forge repository was not found. Set RUINDIVER_LEVEL_FORGE_ROOT.\n');
  process.exit(2);
}

const child = spawnSync(process.execPath, [
  path.join(repository, 'scripts', 'level-forge-cli.mjs'),
  ...process.argv.slice(2),
], {
  cwd: repository,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

if (child.error) {
  process.stderr.write(`${child.error.message}\n`);
  process.exit(1);
}
process.exit(child.status ?? 1);
