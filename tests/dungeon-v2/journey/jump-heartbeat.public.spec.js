import { test, expect } from '@playwright/test';
import {
  PUBLIC_INPUT_JOURNEY,
  readV2Diagnostics,
  waitForV2Runtime,
} from '../helpers/journey-runtime.mjs';

void PUBLIC_INPUT_JOURNEY;

test('PUBLIC_INPUT_JOURNEY: jumping cannot stall the V2 frame heartbeat', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?dungeonGen=v2&undercroft=magma&seed=m1-golden-magma');
  const before = await waitForV2Runtime(page);
  const beforeRootY = Number(before?.playerPosition?.y);
  expect(Number.isFinite(beforeRootY)).toBe(true);

  await page.keyboard.press('Space');
  const jumpSamples = [];
  let observedPhysicalJump = false;
  const jumpDeadline = Date.now() + 4_000;
  while (Date.now() < jumpDeadline) {
    const diagnostics = await readV2Diagnostics(page, 'movement');
    const rootY = Number(diagnostics?.playerPosition?.y);
    jumpSamples.push({
      heartbeat: diagnostics?.frameHeartbeat ?? 0,
      jumpState: diagnostics?.jumpState ?? null,
      verticalVelocity: diagnostics?.verticalVelocity ?? null,
      rootY,
    });
    if (['Rising', 'Falling'].includes(diagnostics?.jumpState)
      || (Number.isFinite(rootY) && rootY > beforeRootY + 0.15)) {
      observedPhysicalJump = true;
      break;
    }
    await page.waitForTimeout(25);
  }
  expect(
    observedPhysicalJump,
    `Public Space input produced no airborne state or positive displacement: ${JSON.stringify(jumpSamples.slice(-12))}`,
  ).toBe(true);

  const observedJumpHeartbeat = jumpSamples.at(-1)?.heartbeat ?? before.frameHeartbeat;
  await expect.poll(async () => (await readV2Diagnostics(page, 'movement'))?.frameHeartbeat ?? 0, {
    message: 'V2 frame heartbeat stopped after public jump input',
    timeout: 5_000,
  }).toBeGreaterThan(Math.max(before.frameHeartbeat + 8, observedJumpHeartbeat + 4));

  const after = await readV2Diagnostics(page, 'movement');
  const afterRootY = Number(after?.playerPosition?.y);
  expect(Number.isFinite(afterRootY)).toBe(true);
  expect(after.errors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
