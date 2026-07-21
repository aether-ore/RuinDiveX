import { test, expect } from '@playwright/test';
import {
  PUBLIC_INPUT_JOURNEY,
  readV2Diagnostics,
  waitForV2Runtime,
} from '../helpers/journey-runtime.mjs';

void PUBLIC_INPUT_JOURNEY;

// This is a debug-control regression only. Noclip is never used as evidence
// that a generated dungeon's progression or physical route is solvable.
test('PUBLIC_INPUT_JOURNEY: Debug Tools noclip flies freely and toggles back to a safe surface', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?dungeonGen=v2&undercroft=magma&seed=m1-golden-magma');
  const before = await waitForV2Runtime(page);
  const startPosition = before.playerPosition;
  const startSafeguardActivations = before.safeguardActivations;

  await page.keyboard.press('Backquote');
  const debugPanel = page.locator('#pose-debug-panel');
  const noclipToggle = page.locator('#platform-debug-noclip');
  await expect(debugPanel).toBeVisible();
  await page.getByRole('tab', { name: 'Platforming' }).click();
  await expect(noclipToggle).toHaveAttribute('aria-pressed', 'false');
  await noclipToggle.click();
  await expect(noclipToggle).toHaveText('Noclip: On');
  await expect(noclipToggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (
    await readV2Diagnostics(page, 'movement')
  )?.debugNoclipEnabled).toBe(true);

  await page.locator('[data-action="pose-close"]').click();
  await expect(debugPanel).toBeHidden();

  await page.keyboard.down('Space');
  try {
    await page.waitForTimeout(1_300);
  } finally {
    await page.keyboard.up('Space');
  }
  const elevated = await readV2Diagnostics(page, 'movement');
  expect(
    elevated.playerPosition.y - startPosition.y,
    'Noclip ascent was blocked by normal jump physics or the enclosed room ceiling.',
  ).toBeGreaterThan(7);
  expect(elevated.jumpState).toBe('Grounded');
  expect(elevated.verticalVelocity).toBe(0);

  await page.waitForTimeout(300);
  const hovering = await readV2Diagnostics(page, 'movement');
  expect(
    Math.abs(hovering.playerPosition.y - elevated.playerPosition.y),
    'Gravity moved the player while noclip was hovering.',
  ).toBeLessThan(0.2);

  await page.keyboard.down('KeyC');
  try {
    await page.waitForTimeout(450);
  } finally {
    await page.keyboard.up('KeyC');
  }
  const descended = await readV2Diagnostics(page, 'movement');
  expect(descended.playerPosition.y).toBeLessThan(hovering.playerPosition.y - 2);
  expect(descended.safeguardActivations).toBe(startSafeguardActivations);

  await page.keyboard.press('Backquote');
  await expect(debugPanel).toBeVisible();
  await page.getByRole('tab', { name: 'Platforming' }).click();
  await noclipToggle.click();
  await expect(noclipToggle).toHaveText('Noclip: Off');
  await expect(noclipToggle).toHaveAttribute('aria-pressed', 'false');

  const restored = await readV2Diagnostics(page, 'movement');
  expect(restored.debugNoclipEnabled).toBe(false);
  expect(restored.debugNoclipExitMode).toBe('saved-safe-position');
  expect(restored.jumpState).toBe('Grounded');
  expect(restored.verticalVelocity).toBe(0);
  expect(Math.hypot(
    restored.playerPosition.x - startPosition.x,
    restored.playerPosition.y - startPosition.y,
    restored.playerPosition.z - startPosition.z,
  ), 'Disabling noclip did not return the player to the captured safe surface.')
    .toBeLessThan(0.35);

  await page.locator('[data-action="pose-close"]').click();
  await expect(debugPanel).toBeHidden();
  await page.keyboard.press('Space');
  await expect.poll(async () => {
    const sample = await readV2Diagnostics(page, 'movement');
    return ['Rising', 'Falling'].includes(sample?.jumpState)
      || sample?.playerPosition?.y > restored.playerPosition.y + 0.15;
  }, {
    message: 'Normal jump physics did not resume after noclip was disabled.',
    timeout: 4_000,
  }).toBe(true);
  await expect.poll(async () => (
    await readV2Diagnostics(page, 'movement')
  )?.jumpState, {
    message: 'Normal gravity did not return the player to the floor after disabling noclip.',
    timeout: 6_000,
  }).toBe('Grounded');
  const after = await readV2Diagnostics(page, 'movement');
  expect(after.debugNoclipEnabled).toBe(false);
  expect(after.safeguardActivations).toBe(startSafeguardActivations);
  expect(Math.abs(after.playerPosition.y - startPosition.y)).toBeLessThan(0.1);
  expect(pageErrors).toEqual([]);
});
