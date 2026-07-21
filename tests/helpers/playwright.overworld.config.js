import { defineConfig, devices } from '@playwright/test';

const OVERWORLD_TEST_PORT = Number.parseInt(process.env.OVERWORLD_TEST_PORT ?? '5184', 10);

export default defineConfig({
  testDir: '..',
  testMatch: [
    'overworld-runtime.spec.js',
    'overworld-v1-extraction-journey.spec.js',
    'v1-combat-probe.spec.js',
  ],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/overworld',
  preserveOutput: 'always',
  globalTeardown: './overworld-global-teardown.js',
  webServer: {
    // Playwright resolves webServer commands from the configuration file's
    // directory, not from the repository root.
    command: 'node overworld-test-server.mjs',
    url: `http://127.0.0.1:${OVERWORLD_TEST_PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      OVERWORLD_TEST_PORT: String(OVERWORLD_TEST_PORT),
    },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${OVERWORLD_TEST_PORT}`,
    trace: 'off',
    screenshot: 'only-on-failure',
    // Chromium video finalization can keep a failed isolated run alive after
    // the browser has already reported its diagnostics. Screenshots, traces,
    // page errors and deterministic runtime logs remain the acceptance record.
    video: 'off',
  },
  projects: [{ name: 'chromium' }],
});
