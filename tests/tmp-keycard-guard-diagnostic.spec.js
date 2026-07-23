import { expect, test } from '@playwright/test';
import { clearPublicEncounter, readPublicV1JourneyState } from './helpers/public-v1-journey.js';
import { beginBossExpedition, waitForWorld } from './helpers/overworld-runtime.js';

test('diagnostic: keycard guard uses public input', async ({ page }) => {
  // The global watchdog must exceed the declared 480s Nest and 420s guard
  // stages plus the physical ladder traversal between them.
  test.setTimeout(1_500_000);
  const seed = 'overworld-v1-public-extraction-easy-110';
  await page.goto(`/?dungeonSeed=${seed}&reaverbotSeed=${seed}`);
  await waitForWorld(page, 'overworld');
  await beginBossExpedition(page, 'revolvingFusillade');
  await waitForWorld(page, 'dungeon', { timeout: 75_000 });
  await clearPublicEncounter(page, 'enemyNest', { timeout: 480_000 });
  await clearPublicEncounter(page, 'keycardGuard', { timeout: 320_000 });
  const state = await readPublicV1JourneyState(page, { includeGeometry: false });
  expect(state.encounters.find(({ id }) => id === 'keycardGuard')?.cleared).toBe(true);
  expect(state.player.dead).toBe(false);
});
