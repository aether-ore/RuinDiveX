import { test, expect } from '@playwright/test';
import {
  PUBLIC_INPUT_JOURNEY,
  readV2Diagnostics,
  waitForV2Runtime,
} from '../helpers/journey-runtime.mjs';

void PUBLIC_INPUT_JOURNEY;

const ACTUAL_SEED_URL = '/?dungeonGen=v2&undercroft=magma&seed=m1-golden-magma';

async function readCameraDomContract(shell) {
  return {
    policy: await shell.getAttribute('data-camera-occlusion-policy'),
    hiddenCount: Number(await shell.getAttribute('data-camera-occlusion-hidden-count')),
    containmentAdjustments: Number(await shell.getAttribute('data-camera-containment-adjustments')),
  };
}

function horizontalDistance(left, right) {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

test('PUBLIC_INPUT_REGRESSION: actual seeded camera contact hides the wall before player contact', async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto(ACTUAL_SEED_URL);
  const initial = await waitForV2Runtime(page);
  const shell = page.locator('[data-dungeon-generation-mode="v2"]');
  await expect(shell).toHaveCount(1);
  await expect(shell).toHaveAttribute('data-camera-occlusion-policy', 'opaque-ray-hide');
  const before = await readCameraDomContract(shell);
  expect(before.containmentAdjustments,
    'The actual V2 facade incorrectly entered camera containment before public input.')
    .toBe(0);

  let obstructed = null;
  await page.keyboard.down('KeyS');
  try {
    await expect.poll(async () => {
      const contract = await readCameraDomContract(shell);
      if (contract.hiddenCount > 0) {
        obstructed = {
          contract,
          movement: await readV2Diagnostics(page, 'movement'),
        };
      }
      return contract.hiddenCount;
    }, {
      message: 'Backpedaling never put the full-distance camera behind a camera-side Security wall.',
      timeout: 8_000,
    }).toBeGreaterThan(0);
  } finally {
    await page.keyboard.up('KeyS');
  }

  expect(obstructed).toBeTruthy();
  expect(obstructed.contract).toMatchObject({
    policy: 'opaque-ray-hide',
    containmentAdjustments: 0,
  });
  expect(horizontalDistance(obstructed.movement.cameraPosition, obstructed.movement.playerPosition),
    'The camera was pulled forward instead of retaining its requested orbit through the wall.')
    .toBeGreaterThanOrEqual(6.55);

  const full = await readV2Diagnostics(page, 'full');
  const northWallColliders = full.structuralRegistry.colliderEntries.filter(({ planId, active }) => (
    active === true
    && typeof planId === 'string'
    && planId.startsWith('placement.security:boundary.v1-room.security-entrance.north.')
  ));
  expect(northWallColliders.length,
    'The actual seeded Security room exposes no physical north-wall colliders.')
    .toBeGreaterThan(0);
  const wallInteriorZ = Math.max(...northWallColliders.map(({ bounds }) => bounds.max.z));
  expect(obstructed.movement.playerPosition.z - wallInteriorZ,
    'The wall only hid after the player capsule contacted it; camera contact must be the trigger.')
    .toBeGreaterThan(1.2);

  await page.keyboard.down('KeyW');
  try {
    await expect.poll(async () => (await readCameraDomContract(shell)).hiddenCount, {
      message: 'The camera-side Security wall did not restore after the camera returned inside.',
      timeout: 8_000,
    }).toBe(0);
  } finally {
    await page.keyboard.up('KeyW');
  }
  const restored = await readV2Diagnostics(page, 'movement');
  expect(restored.cameraContainmentAdjustments).toBe(0);
  expect(restored.errors).toEqual([]);
  expect(restored.frameHeartbeat).toBeGreaterThan(initial.frameHeartbeat);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
