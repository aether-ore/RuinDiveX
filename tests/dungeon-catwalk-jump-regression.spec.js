import { expect, test } from '@playwright/test';

import {
  followPublicFloorRoute,
  readPublicV1JourneyState,
} from './helpers/public-v1-journey.js';

const JOURNEY_SEED = 'overworld-v1-public-extraction-easy-110';
const EXPECTED_JUMP_HEIGHT = 1.65;
const JUMP_HEIGHT_TOLERANCE = 0.16;

test.use({ viewport: { width: 640, height: 360 } });

const waitForGroundedPlayer = async (page) => {
  await expect.poll(async () => {
    const state = await readPublicV1JourneyState(page, { includeGeometry: false });
    return state.player.jumpState === 'Grounded'
      && !state.player.ledgeClinging
      && state.player.ladderTraversal === null;
  }, { timeout: 10_000 }).toBe(true);
  return readPublicV1JourneyState(page, { includeGeometry: false });
};

/**
 * Measure one ordinary stationary jump using only Space input and the cloned
 * public journey diagnostics. Sampling begins before takeoff and continues
 * until the physical state machine returns to Grounded.
 */
const measurePublicJump = async (page, label) => {
  const start = await waitForGroundedPlayer(page);
  const startY = start.player.position.y;
  // Read the public dataset once per rendered frame inside the page. Repeated
  // cross-process diagnostics calls can skip the apex when the full dungeon is
  // under load, creating a false short-jump result despite correct physics.
  const samplePromise = page.evaluate(({ timeoutMs, initialY }) => new Promise((resolve) => {
    const container = document.querySelector('#game-container');
    const startedAt = Date.now();
    let maximumY = Number(container?.dataset?.playerRootY);
    if (!Number.isFinite(maximumY)) maximumY = initialY;
    let minimumY = maximumY;
    let sawAirborne = false;
    const states = new Set([container?.dataset?.playerJumpState ?? 'unknown']);

    const sampleFrame = () => {
      const y = Number(container?.dataset?.playerRootY);
      const jumpState = container?.dataset?.playerJumpState ?? 'unknown';
      if (Number.isFinite(y)) {
        maximumY = Math.max(maximumY, y);
        minimumY = Math.min(minimumY, y);
      }
      states.add(jumpState);
      if (jumpState === 'Rising' || jumpState === 'Falling') sawAirborne = true;
      if (sawAirborne && jumpState === 'Grounded') {
        resolve({ maximumY, minimumY, landingY: y, states: [...states], timedOut: false });
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve({ maximumY, minimumY, landingY: y, states: [...states], timedOut: true });
        return;
      }
      requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);
  }), { timeoutMs: 4_000, initialY: startY });

  await page.keyboard.down('Space');
  await page.waitForTimeout(70);
  await page.keyboard.up('Space');
  const sampled = await samplePromise;
  if (sampled.timedOut) {
    throw new Error(`Public jump did not complete: ${JSON.stringify({ label, startY, ...sampled })}`);
  }
  return {
    label,
    startY,
    landingY: sampled.landingY,
    apexY: sampled.maximumY,
    height: sampled.maximumY - startY,
    minimumY: sampled.minimumY,
    states: sampled.states,
  };
};

test('ordinary jump height remains unchanged before, on, and after an elevated catwalk', async ({
  page,
}) => {
  test.setTimeout(360_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(`/?startupWorld=dungeon&dungeonSeed=${JOURNEY_SEED}&reaverbotSeed=${JOURNEY_SEED}`);
  await expect.poll(
    () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
    { timeout: 60_000 },
  ).toBe('true');

  const before = await measurePublicJump(page, 'before-catwalk');

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
  const topLaneTiles = state.floorTiles.filter((tile) => (
    tile.connectionId === ladder.connectionId
    && Math.abs(tile.elevation - ladder.topY) <= 0.05
    && Math.abs(tile.x * state.tileSize - ladder.topExit.x) <= 0.05
    && ['upperConnectionBridge', 'connectorGalleryFloor'].includes(tile.surface)
  )).sort((left, right) => left.z - right.z);
  expect(topLaneTiles.length).toBeGreaterThanOrEqual(6);
  const topJumpTile = topLaneTiles.at(-2);
  await followPublicFloorRoute(page, {
    x: topJumpTile.x * state.tileSize,
    y: topJumpTile.elevation,
    z: topJumpTile.z * state.tileSize,
  }, {
    targetRadius: 0.9,
    maximumTargetVerticalDifference: 0.55,
    stopDistance: 0.72,
    timeout: 90_000,
  });
  const onCatwalk = await measurePublicJump(page, 'on-elevated-catwalk');

  const downward = await followPublicFloorRoute(page, ladder.bottomExit, {
    targetRadius: 0.9,
    maximumTargetVerticalDifference: 0.55,
    stopDistance: 0.72,
    timeout: 90_000,
  });
  expect(downward.traversedActions).toContain('ladder');

  // Move off the ladder landing so the final sample measures ordinary floor
  // physics after the elevated support has left the player's vicinity.
  state = await readPublicV1JourneyState(page);
  const lowerLaneTile = state.floorTiles
    .filter((tile) => (
      tile.connectionId === ladder.connectionId
      && Math.abs(tile.elevation - ladder.bottomY) <= 0.05
      && ['upperConnectionBridge', 'connectorGalleryFloor'].includes(tile.surface)
    ))
    .sort((left, right) => (
      Math.hypot(
        right.x * state.tileSize - ladder.bottomExit.x,
        right.z * state.tileSize - ladder.bottomExit.z,
      ) - Math.hypot(
        left.x * state.tileSize - ladder.bottomExit.x,
        left.z * state.tileSize - ladder.bottomExit.z,
      )
    ))
    .find((tile) => Math.hypot(
      tile.x * state.tileSize - ladder.bottomExit.x,
      tile.z * state.tileSize - ladder.bottomExit.z,
    ) >= state.tileSize * 1.5);
  expect(lowerLaneTile).toBeTruthy();
  await followPublicFloorRoute(page, {
    x: lowerLaneTile.x * state.tileSize,
    y: lowerLaneTile.elevation,
    z: lowerLaneTile.z * state.tileSize,
  }, {
    targetRadius: 0.9,
    maximumTargetVerticalDifference: 0.55,
    stopDistance: 0.72,
    timeout: 90_000,
  });
  const after = await measurePublicJump(page, 'after-catwalk');

  for (const sample of [before, onCatwalk, after]) {
    expect(sample.states).toEqual(expect.arrayContaining(['Rising', 'Falling', 'Grounded']));
    expect(sample.height, JSON.stringify({ before, onCatwalk, after }, null, 2)).toBeGreaterThanOrEqual(
      EXPECTED_JUMP_HEIGHT - JUMP_HEIGHT_TOLERANCE,
    );
    expect(sample.height).toBeLessThanOrEqual(EXPECTED_JUMP_HEIGHT + JUMP_HEIGHT_TOLERANCE);
    expect(sample.landingY).toBeCloseTo(sample.startY, 1);
  }
  expect(Math.abs(onCatwalk.height - before.height)).toBeLessThanOrEqual(JUMP_HEIGHT_TOLERANCE);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(JUMP_HEIGHT_TOLERANCE);
  expect(errors).toEqual([]);
});
