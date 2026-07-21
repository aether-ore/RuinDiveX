import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requestedPort = Number.parseInt(process.env.DUNGEON_V2_JOURNEY_PORT ?? '', 10);
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65_535
  ? requestedPort
  : 5187;
const baseURL = `http://127.0.0.1:${port}`;
const shutdownToken = randomUUID();
const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(configDirectory, '..', '..', '..');

export default defineConfig({
  globalTeardown: './global-teardown.mjs',
  metadata: {
    dungeonV2ServerPort: port,
    dungeonV2ServerShutdownToken: shutdownToken,
  },
  testDir: configDirectory,
  testMatch: '**/*.spec.js',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `node scripts/dev-server.mjs ${port}`,
    cwd: projectRoot,
    env: {
      DUNGEON_V2_SERVER_SHUTDOWN_TOKEN: shutdownToken,
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 45_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
