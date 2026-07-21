import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

function collectTests(path, files) {
  const absolutePath = resolve(path);
  const stat = statSync(absolutePath, { throwIfNoEntry: false });
  if (!stat) {
    throw new Error(`Test path does not exist: ${path}`);
  }
  if (stat.isFile()) {
    if (/\.(?:test|spec)\.(?:mjs|js)$/u.test(absolutePath)) files.push(absolutePath);
    return;
  }

  for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
    const child = resolve(absolutePath, entry.name);
    if (entry.isDirectory()) collectTests(child, files);
    else if (/\.(?:test|spec)\.(?:mjs|js)$/u.test(entry.name)) files.push(child);
  }
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  throw new Error('Provide at least one test directory or file.');
}

const files = [];
for (const root of roots) collectTests(root, files);
files.sort((left, right) => left.localeCompare(right));

if (files.length === 0) {
  throw new Error(`No recursively discovered test files beneath: ${roots.join(', ')}`);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
