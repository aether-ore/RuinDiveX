import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd());
const port = Number(process.argv[2] ?? 5174);
const testShutdownToken = String(
  process.env.DUNGEON_V2_SERVER_SHUTDOWN_TOKEN ?? '',
).trim();
const TEST_SHUTDOWN_PATH = '/__dungeon-v2-test-shutdown';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.fbx': 'application/octet-stream',
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  if (requestUrl.pathname === TEST_SHUTDOWN_PATH) {
    const suppliedToken = Array.isArray(request.headers['x-dungeon-v2-shutdown-token'])
      ? request.headers['x-dungeon-v2-shutdown-token'][0]
      : request.headers['x-dungeon-v2-shutdown-token'];
    if (!testShutdownToken) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    if (request.method !== 'POST' || suppliedToken !== testShutdownToken) {
      response.writeHead(403, { Connection: 'close' });
      response.end('Forbidden');
      return;
    }
    response.writeHead(202, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'close',
    });
    response.once('finish', () => setImmediate(() => shutdown('test-harness')));
    response.end('Shutting down');
    return;
  }
  let filePath = path.resolve(root, `.${decodeURIComponent(requestUrl.pathname)}`);

  if (requestUrl.pathname.endsWith('/')) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`http://127.0.0.1:${port}/\n`);
});

let shutdownStarted = false;

function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;

  // Playwright owns this process during isolated V2 journeys. On Windows a
  // retained browser connection can otherwise leave the HTTP child alive
  // after an assertion has already failed, preventing the runner from
  // reporting for minutes. Stop accepting work, close retained sockets, and
  // provide a short fail-safe so test teardown remains bounded.
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  const forceExit = setTimeout(() => process.exit(0), 1_000);
  forceExit.unref?.();
  server.close(() => {
    clearTimeout(forceExit);
    process.exit(0);
  });
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => shutdown(signal));
}
