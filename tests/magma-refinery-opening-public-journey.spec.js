import { expect, test } from '@playwright/test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const TILE_SIZE = 2.8;
const RUN_STAMP = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const QA_REVISION = 'linear-digger-ramp-descent-only-v1-20260726';
const EVIDENCE_ROOT = path.resolve(
  'artifacts',
  'magma-linear-ramp-descent',
  `run-${RUN_STAMP}`,
);

const RAMP_CASES = Object.freeze([
  {
    id: 'flight-a',
    routeId: 'digger-descent-flight-a',
    anchor: 'flightATop',
    top: { x: -1 * TILE_SIZE, y: 0, z: -6 * TILE_SIZE },
    midpoint: { x: -9 * TILE_SIZE, y: -3.5, z: -6 * TILE_SIZE },
    bottom: { x: -17 * TILE_SIZE, y: -7, z: -6 * TILE_SIZE },
  },
  {
    id: 'flight-b',
    routeId: 'digger-descent-flight-b',
    anchor: 'flightBTop',
    top: { x: 11 * TILE_SIZE, y: -7, z: -22 * TILE_SIZE },
    midpoint: { x: 3 * TILE_SIZE, y: -10.5, z: -22 * TILE_SIZE },
    bottom: { x: -5 * TILE_SIZE, y: -14, z: -22 * TILE_SIZE },
  },
]);

const readPlayer = (page) => page.evaluate(() => (
  window.game.getPublicDungeonPlayerJourneyDiagnostics().player
));

const readPendingCollisions = (page) => page.evaluate(() => (
  window.__linearRampWalkabilityCollisions.splice(0)
));

const buildRampUrl = (ramp) => '/?startupWorld=dungeon'
  + '&roomPreview=magma-linear-digger-excavation'
  + `&roomPreviewAnchor=${ramp.anchor}`
  + '&roomPreviewFacing=west'
  + `&dungeonSeed=linear-ramp-descent-${ramp.id}`
  + `&qaRevision=${QA_REVISION}`;

const createEvidenceRecorder = async (page, testInfo, ramp, url) => {
  const directory = path.join(EVIDENCE_ROOT, ramp.id);
  const ledgerPath = path.join(directory, 'ramp-evidence.json');
  const entries = [];
  await mkdir(directory, { recursive: true });

  const capture = async (label, metadata = {}) => {
    const player = await readPlayer(page);
    const filename = `${String(entries.length + 1).padStart(2, '0')}-${label}.png`;
    const screenshotPath = path.join(directory, filename);
    await page.screenshot({ path: screenshotPath });
    entries.push({
      label,
      screenshotPath,
      player,
      metadata,
    });
    await writeFile(ledgerPath, `${JSON.stringify({
      url,
      routeId: ramp.routeId,
      entries,
    }, null, 2)}\n`, 'utf8');
    return player;
  };

  return {
    capture,
    async finish() {
      await writeFile(ledgerPath, `${JSON.stringify({
        url,
        routeId: ramp.routeId,
        completedAt: new Date().toISOString(),
        entries,
      }, null, 2)}\n`, 'utf8');
      await testInfo.attach(`${ramp.id}-descent-evidence`, {
        path: ledgerPath,
        contentType: 'application/json',
      });
    },
  };
};

const descendRampWithPublicInput = async (page, evidence, ramp) => {
  const movementSamples = [];
  let midpointCaptured = false;
  let reachedBottom = false;
  const deadline = Date.now() + 20_000;

  await page.keyboard.down('KeyW');
  try {
    while (Date.now() < deadline) {
      await page.waitForTimeout(120);
      const player = await readPlayer(page);
      movementSamples.push({ ...player.position });

      const collisions = await readPendingCollisions(page);
      if (collisions.length > 0) {
        await page.keyboard.up('KeyW');
        for (const collision of collisions) {
          await evidence.capture(`obstruction-${String(collision.serial).padStart(3, '0')}`, {
            collision,
          });
        }
        throw new Error(
          `${ramp.routeId} hit an obstruction: ${JSON.stringify(collisions[0])}`,
        );
      }

      if (!midpointCaptured && player.position.x <= ramp.midpoint.x + 0.8) {
        await page.keyboard.up('KeyW');
        await evidence.capture('midpoint', { expected: ramp.midpoint });
        midpointCaptured = true;
        await page.keyboard.down('KeyW');
      }

      if (
        player.position.x <= ramp.bottom.x + 0.8
        && player.position.y <= ramp.bottom.y + 0.35
      ) {
        reachedBottom = true;
        break;
      }
    }
  } finally {
    await page.keyboard.up('KeyW');
  }

  expect(midpointCaptured, `${ramp.routeId} never reached its midpoint`).toBe(true);
  expect(reachedBottom, `${ramp.routeId} never reached its lower landing`).toBe(true);
  return movementSamples;
};

test.use({
  viewport: { width: 1600, height: 900 },
  trace: 'on',
});

for (const ramp of RAMP_CASES) {
  test(`${ramp.routeId} is traversable from its upper landing to its lower landing`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const runtimeErrors = [];
    const failedResponses = [];
    const url = buildRampUrl(ramp);
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
      if (
        message.type() === 'error'
        && !message.text().startsWith('Failed to load resource:')
      ) {
        runtimeErrors.push(message.text());
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedResponses.push({ status: response.status(), url: response.url() });
      }
    });
    await page.addInitScript(() => {
      window.__linearRampWalkabilityCollisions = [];
      window.addEventListener('ruindivex:player-walkability-collision', (event) => {
        window.__linearRampWalkabilityCollisions.push(structuredClone(event.detail));
      });
    });

    const evidence = await createEvidenceRecorder(page, testInfo, ramp, url);
    try {
      await page.goto(url);
      await page.waitForFunction(() => (
        document.getElementById('game-container')?.dataset.browserTestReady === 'true'
      ));
      expect(await page.evaluate(() => (
        typeof window.game?.getPublicDungeonPlayerJourneyDiagnostics
      ))).toBe('function');
      await page.waitForTimeout(1_200);
      await page.locator('canvas').click({ position: { x: 800, y: 450 } });
      await page.evaluate(() => {
        window.__linearRampWalkabilityCollisions.length = 0;
      });

      const top = await evidence.capture('top', { expected: ramp.top });
      expect(top.position.x).toBeCloseTo(ramp.top.x, 1);
      expect(top.position.y).toBeCloseTo(ramp.top.y, 1);
      expect(top.position.z).toBeCloseTo(ramp.top.z, 1);

      const movementSamples = await descendRampWithPublicInput(page, evidence, ramp);
      const bottom = await evidence.capture('bottom', { expected: ramp.bottom });
      expect(bottom.position.x).toBeLessThanOrEqual(ramp.bottom.x + 0.8);
      expect(bottom.position.y).toBeCloseTo(ramp.bottom.y, 1);
      expect(Math.abs(bottom.position.z - ramp.bottom.z)).toBeLessThan(1.25);
      expect(bottom.dead).toBe(false);

      for (let index = 1; index < movementSamples.length; index += 1) {
        expect(
          movementSamples[index].y,
          `${ramp.routeId} climbed while the downhill input remained held`,
        ).toBeLessThanOrEqual(movementSamples[index - 1].y + 0.08);
      }
      expect(await readPendingCollisions(page)).toEqual([]);
      expect(failedResponses.filter(({ url: responseUrl }) => (
        !responseUrl.endsWith('/favicon.ico')
          && !responseUrl.includes('/.well-known/appspecific/com.chrome.devtools.json')
      ))).toEqual([]);
      expect(runtimeErrors).toEqual([]);
    } finally {
      await evidence.finish();
      await page.evaluate(() => window.game?.stop?.()).catch(() => {});
    }
  });
}
