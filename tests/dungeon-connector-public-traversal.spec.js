import { expect, test } from '@playwright/test';

import {
  beginBossExpedition,
  waitForWorld,
} from './helpers/overworld-runtime.js';
import {
  followPublicFloorRoute,
  readPublicV1JourneyState,
} from './helpers/public-v1-journey.js';

const JOURNEY_SEED = 'overworld-v1-public-extraction-easy-110';

test.use({ viewport: { width: 640, height: 360 } });

test('real V1 seed climbs its signed ladder and walks a stacked upper gallery through public input', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(`/?dungeonSeed=${JOURNEY_SEED}&reaverbotSeed=${JOURNEY_SEED}`);
  await waitForWorld(page, 'overworld');
  await beginBossExpedition(page, 'revolvingFusillade');
  await waitForWorld(page, 'dungeon', { timeout: 75_000 });

  let state = await readPublicV1JourneyState(page);
  const ladder = state.connectorLadders.find(({ connectionId }) => (
    connectionId === 'enemyNest_keycardRoom_ground'
  ));
  expect(ladder).toMatchObject({ direction: 'ascending', bottomY: 0, topY: 14 });

  const upward = await followPublicFloorRoute(page, ladder.topExit, {
    targetRadius: 0.9,
    maximumTargetVerticalDifference: 0.55,
    stopDistance: 0.72,
    timeout: 180_000,
  });
  expect(upward.traversedActions).toContain('ladder');
  state = await readPublicV1JourneyState(page);
  expect(state.player.ladderTraversal).toBeNull();
  expect(state.player.position.y).toBeCloseTo(ladder.topY, 1);

  // Walk the elevated destination approach before descending again. Its long
  // three-wide lane sits one complete 14m transfer above the source approach
  // and shaft. Every waypoint is reached by normal input, and remaining on the
  // top support proves edge correction cannot select the remote lower layer.
  const topLaneTiles = state.floorTiles.filter((tile) => (
    tile.connectionId === ladder.connectionId
    && Math.abs(tile.elevation - ladder.topY) <= 0.05
    && Math.abs(tile.x * state.tileSize - ladder.topExit.x) <= 0.05
    && ['upperConnectionBridge', 'connectorGalleryFloor'].includes(tile.surface)
  )).sort((left, right) => left.z - right.z);
  expect(topLaneTiles.length).toBeGreaterThanOrEqual(6);
  const longitudinalTarget = topLaneTiles.at(-2);
  const edgeTarget = state.floorTiles.find((tile) => (
    tile.connectionId === ladder.connectionId
    && Math.abs(tile.elevation - ladder.topY) <= 0.05
    && tile.z === longitudinalTarget.z
    && Math.abs(tile.x - longitudinalTarget.x) === 1
  ));
  expect(edgeTarget).toBeTruthy();
  for (const tile of [longitudinalTarget, edgeTarget]) {
    const elevatedWalk = await followPublicFloorRoute(page, {
      x: tile.x * state.tileSize,
      y: tile.elevation,
      z: tile.z * state.tileSize,
    }, {
      targetRadius: 0.9,
      maximumTargetVerticalDifference: 0.55,
      stopDistance: 1,
      timeout: 90_000,
    });
    expect(elevatedWalk.traversedConnectorIds).toContain(ladder.connectionId);
    state = await readPublicV1JourneyState(page, { includeGeometry: false });
    expect(Math.abs(state.player.position.y - ladder.topY)).toBeLessThanOrEqual(0.55);
  }

  const downward = await followPublicFloorRoute(page, ladder.bottomExit, {
    targetRadius: 0.9,
    maximumTargetVerticalDifference: 0.55,
    stopDistance: 0.72,
    timeout: 90_000,
  });
  expect(downward.traversedActions).toContain('ladder');
  state = await readPublicV1JourneyState(page, { includeGeometry: false });
  expect(state.player.ladderTraversal).toBeNull();
  expect(state.player.position.y).toBeCloseTo(ladder.bottomY, 1);
  expect(errors).toEqual([]);
});
