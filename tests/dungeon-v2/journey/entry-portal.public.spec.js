import { test, expect } from '@playwright/test';
import {
  PUBLIC_INPUT_JOURNEY,
  readV2Diagnostics,
  steerThroughPortalPublicly,
  waitForV2Runtime,
} from '../helpers/journey-runtime.mjs';

void PUBLIC_INPUT_JOURNEY;

test('PUBLIC_INPUT_JOURNEY: traversal-lab spawn physically crosses its first portal', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?dungeonGen=v2&v2Fixture=traversal-lab&seed=m1-traversal-lab-public');
  const initial = await waitForV2Runtime(page);
  expect(initial.currentRegionId).toBe('lab-entry');

  await steerThroughPortalPublicly(page, 'portal.lab-entry-stairs', {
    forbidJump: true,
    forbidLedgeClimb: true,
    timeout: 30_000,
  });

  const final = await readV2Diagnostics(page, 'movement');
  expect(final.currentRegionId).toBe('lab-stairs');
  expect(final.safeguardActivations).toBe(0);
  expect(final.errors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
