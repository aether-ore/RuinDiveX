import {
  createBuildFingerprint,
  createIsolatedOverworldServer,
} from './overworld-global-setup.js';

const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.OVERWORLD_TEST_PORT ?? '5184', 10);
const build = await createBuildFingerprint();
const server = createIsolatedOverworldServer(build);

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, HOST, resolve);
});

process.stdout.write(`overworld-test-server http://${HOST}:${PORT}/ ${build.digest}\n`);

server.once('close', () => {
  if (!shuttingDown) process.exit(0);
});

let shuttingDown = false;
const launcherPid = process.ppid;
let launcherWatchdog = null;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (launcherWatchdog) clearInterval(launcherWatchdog);
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('SIGHUP', shutdown);
process.stdin.once('end', shutdown);
// On Windows Playwright launches webServer commands through a transient shell.
// Killing that shell does not reliably deliver SIGTERM to its Node child, and
// the inherited stdout pipe then keeps the test runner waiting forever. Exit
// as soon as the launcher process disappears so both the server and its pipes
// have a deterministic owner.
launcherWatchdog = setInterval(() => {
  try {
    process.kill(launcherPid, 0);
  } catch {
    shutdown();
  }
}, 250);
