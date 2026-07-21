import { expect, test } from '@playwright/test';
import { beginBossExpedition, waitForWorld } from './helpers/overworld-runtime.js';
import {
  activatePublicInteractable,
  clearPublicEncounter,
  readPublicV1JourneyState,
} from './helpers/public-v1-journey.js';

const JOURNEY_SEED = 'overworld-v1-public-extraction-easy-110';
test.use({ viewport: { width: 640, height: 360 } });

test('replays the full prelude and clears the streamed V1 Nest', async ({ page }) => {
  test.setTimeout(360_000);
  await page.goto(`/?dungeonSeed=${JOURNEY_SEED}&reaverbotSeed=${JOURNEY_SEED}`);
  await waitForWorld(page, 'overworld');
  await beginBossExpedition(page, 'revolvingFusillade');
  let state = await readPublicV1JourneyState(page);
  if (state.keySeeker && !state.keySeeker.activated) {
    await activatePublicInteractable(page, state.keySeeker.id, {
      targetPosition: state.keySeeker.position,
      targetRadius: 2.1,
      expectedState: (next) => next.keySeeker?.activated === true,
    });
  }
  await clearPublicEncounter(page, 'enemyNest', { timeout: 300_000 });
  state = await readPublicV1JourneyState(page, { includeGeometry: false });
  expect(state.encounters.find(({ id }) => id === 'enemyNest')?.cleared).toBe(true);
});
