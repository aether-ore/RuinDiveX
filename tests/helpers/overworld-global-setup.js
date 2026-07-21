import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.OVERWORLD_TEST_PORT ?? '5184', 10);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.fbx': 'application/octet-stream',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.mjs': 'text/javascript; charset=utf-8',
  '.obj': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
});

export const OVERWORLD_BUILD_FINGERPRINT_BASE_INPUTS = Object.freeze([
    'index.html',
    'package.json',
    'src/Game.js',
    'src/DungeonController.js',
    'src/DungeonGenerator.js',
    'src/UIManager.js',
    'src/ui.css',
    'src/reaverbots/ReaverbotBossCatalog.js',
    'scripts/build-overworld-voxel-textures.mjs',
]);

async function listFingerprintFiles(relativeDirectory, predicate = () => true) {
  const absoluteDirectory = path.join(ROOT, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFingerprintFiles(relativePath, predicate));
    } else if (entry.isFile() && predicate(relativePath)) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

export async function collectOverworldBuildFingerprintInputs() {
  const overworldFiles = await listFingerprintFiles(
    'src/overworld',
    (relativePath) => relativePath.endsWith('.js'),
  );
  const voxelRuntimeAssets = await listFingerprintFiles('assets/textures/overworld/voxel');
  return [...new Set([
    ...OVERWORLD_BUILD_FINGERPRINT_BASE_INPUTS,
    ...overworldFiles,
    ...voxelRuntimeAssets,
  ])].sort();
}

export async function createBuildFingerprint() {
  const files = await collectOverworldBuildFingerprintInputs();
  const hash = createHash('sha256');
  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update(await readFile(path.join(ROOT, relativePath)));
  }
  return Object.freeze({
    digest: hash.digest('hex'),
    inputCount: files.length,
    inputs: Object.freeze(files),
  });
}

export function createIsolatedOverworldServer(build) {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'POST' && requestUrl.pathname === '/__overworld_test_shutdown__') {
      response.writeHead(204, {
        Connection: 'close',
        'Cache-Control': 'no-store',
        'X-Overworld-Test-Server': 'isolated',
      });
      response.end();
      // Playwright's Windows process-tree fallback uses taskkill, which can be
      // unavailable in sandboxed runners. Global teardown asks the dedicated
      // server to close itself before the webServer plugin begins termination.
      setTimeout(() => {
        server.closeAllConnections?.();
        server.close();
      }, 25).unref();
      return;
    }
    let filePath = path.resolve(ROOT, `.${decodeURIComponent(requestUrl.pathname)}`);
    if (requestUrl.pathname.endsWith('/')) filePath = path.join(filePath, 'index.html');
    if (!filePath.startsWith(ROOT)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    try {
      const data = await readFile(filePath);
      response.writeHead(200, {
        'Content-Type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Overworld-Test-Server': 'isolated',
        'X-Overworld-Build-Fingerprint': build.digest,
        'X-Overworld-Build-Input-Count': String(build.inputCount),
      });
      response.end(data);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  return server;
}

export default async function overworldGlobalSetup() {
  const build = await createBuildFingerprint();
  const server = createIsolatedOverworldServer(build);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, resolve);
  });

  return async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 1_000);
      server.close(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  };
}
