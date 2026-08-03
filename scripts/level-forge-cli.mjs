#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { LEVEL_FORGE_CONTROL_SIGNATURE } from '../src/level-editor/control/index.js';

const root = path.resolve(process.cwd());
const args = process.argv.slice(2);
const command = args.shift() ?? 'health';
const portIndex = args.indexOf('--port');
const port = Number(portIndex >= 0 ? args[portIndex + 1] : process.env.RUINDIVER_LEVEL_FORGE_PORT ?? 5174);
const origin = `http://127.0.0.1:${port}`;
const prefix = `${origin}/__level-forge/v1`;

function die(message, code = 1) { process.stderr.write(`${message}\n`); process.exit(code); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchJson(url, init) {
  const response = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) } });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { die(`Level Forge returned malformed JSON (${response.status}).`); }
  if (!response.ok) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 1;
    return null;
  }
  return payload;
}

async function health({ quiet = false } = {}) {
  try {
    const payload = await fetchJson(`${prefix}/health`);
    if (!payload || payload.signature !== LEVEL_FORGE_CONTROL_SIGNATURE) throw new Error('control signature mismatch');
    if (!quiet) process.stdout.write(`${JSON.stringify(payload)}\n`);
    return payload;
  } catch (error) {
    if (!quiet) die(`Level Forge is unavailable at ${origin}: ${error.message}`);
    return null;
  }
}

function startDetachedServer() {
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'dev-server.mjs'), String(port)], {
    cwd: root, detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
  });
  child.unref();
}

function openDefaultBrowser(url) {
  let executable;
  let browserArgs;
  if (process.platform === 'win32') {
    executable = 'powershell.exe';
    const script = `Start-Process -FilePath ${JSON.stringify(url)}`;
    browserArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  } else if (process.platform === 'darwin') { executable = 'open'; browserArgs = [url]; }
  else { executable = 'xdg-open'; browserArgs = [url]; }
  const child = spawn(executable, browserArgs, { detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
}

if (command === 'health') {
  await health();
} else if (command === 'serve') {
  if (!await health({ quiet: true })) {
    startDetachedServer();
    let ready = null;
    for (let attempt = 0; attempt < 80 && !ready; attempt += 1) { await delay(100); ready = await health({ quiet: true }); }
    if (!ready) die(`Level Forge server did not become ready at ${origin}.`);
  }
  if (args.includes('--open')) {
    const request = { jsonrpc: '2.0', id: `cli_${Date.now()}`, method: 'session.start', params: {} };
    const envelope = await fetchJson(`${prefix}/rpc`, { method: 'POST', body: JSON.stringify(request) });
    if (!envelope || envelope.error) die(envelope?.error?.message ?? 'Could not create a browser session.');
    openDefaultBrowser(envelope.result.url);
    // Tickets are deliberately not echoed; the browser receives it in-memory.
    const safe = structuredClone(envelope);
    delete safe.result.ticket;
    delete safe.result.url;
    process.stdout.write(`${JSON.stringify(safe)}\n`);
  } else await health();
} else if (command === 'rpc') {
  const fileIndex = args.indexOf('--request-file');
  let source;
  if (fileIndex >= 0) source = await readFile(path.resolve(args[fileIndex + 1]), 'utf8');
  else source = args.find((arg) => !arg.startsWith('--'));
  if (!source) die('Usage: level-forge-cli.mjs rpc <json> | --request-file <path>', 2);
  let request;
  try { request = JSON.parse(source); } catch { die('RPC request is not valid JSON.', 2); }
  const envelope = await fetchJson(`${prefix}/rpc`, { method: 'POST', body: JSON.stringify(request) });
  if (envelope) process.stdout.write(`${JSON.stringify(envelope)}\n`);
  if (envelope?.error) process.exitCode = 1;
} else {
  die('Usage: level-forge-cli.mjs health | serve [--open] | rpc <json> [--request-file path]', 2);
}
