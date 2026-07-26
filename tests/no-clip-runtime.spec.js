import { expect, test } from '@playwright/test';

test('Debug Pose No Clip flies freely and restores normal grounded movement when disabled', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?startupWorld=dungeon&dungeonSeed=no-clip-runtime');
  await page.waitForFunction(() => (
    window.game?.player?._fbxAnimationLibraryLoaded === true
    && document.querySelector('#game-container')?.dataset?.browserTestReady === 'true'
  ));

  const start = await page.evaluate(() => ({
    x: window.game.player.root.position.x,
    y: window.game.player.root.position.y,
    z: window.game.player.root.position.z,
  }));

  await page.keyboard.press('Backquote');
  await page.getByRole('tab', { name: 'Platforming' }).click();
  const toggle = page.locator('#platform-debug-no-clip');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveText('No Clip: On');
  await page.locator('[data-action="pose-close"]').click();

  await expect(page.locator('#game-container')).toHaveAttribute('data-debug-no-clip-enabled', 'true');
  await page.keyboard.down('Space');
  await page.waitForTimeout(700);
  await page.keyboard.up('Space');

  const airborne = await page.evaluate(() => ({
    y: window.game.player.root.position.y,
    noClip: window.game.player.noClipEnabled,
  }));
  expect(airborne.noClip).toBe(true);
  expect(airborne.y).toBeGreaterThan(start.y + 3);

  await page.keyboard.down('ControlLeft');
  await page.waitForTimeout(220);
  await page.keyboard.up('ControlLeft');
  const descendedY = await page.evaluate(() => window.game.player.root.position.y);
  expect(descendedY).toBeLessThan(airborne.y - 1);
  expect(descendedY).toBeGreaterThan(start.y + 0.5);

  await page.keyboard.press('Backquote');
  await page.getByRole('tab', { name: 'Platforming' }).click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toHaveText('No Clip: Off');
  await page.locator('[data-action="pose-close"]').click();

  await expect(page.locator('#game-container')).toHaveAttribute('data-debug-no-clip-enabled', 'false');
  const restored = await page.evaluate(() => ({
    x: window.game.player.root.position.x,
    y: window.game.player.root.position.y,
    z: window.game.player.root.position.z,
    noClip: window.game.player.noClipEnabled,
    jumpState: window.game.player.jumpState,
    restoreSource: window.game.debugNoClipLastRestoreSource,
    controllerSafeY: window.game.dungeonController.lastSafePlayerPosition.y,
  }));
  expect(restored.noClip).toBe(false);
  expect(restored.jumpState).toBe('Grounded');
  expect(restored.restoreSource).toBe('current-surface');
  expect(restored.y).toBeCloseTo(start.y, 2);
  expect(restored.controllerSafeY).toBeCloseTo(restored.y, 3);

  // A normal jump after disabling proves gravity/grounding resumed instead of
  // leaving the player in a collision-free or permanently suspended state.
  await page.keyboard.press('Space');
  await expect.poll(
    () => page.evaluate(() => window.game.player.jumpState),
    { timeout: 7_000 },
  ).toBe('Grounded');
  const afterNormalJump = await page.evaluate(() => ({
    y: window.game.player.root.position.y,
    jumpState: window.game.player.jumpState,
  }));
  expect(afterNormalJump.jumpState).toBe('Grounded');
  expect(afterNormalJump.y).toBeCloseTo(restored.y, 2);
});

test('Debug Pose No Clip is available in the overworld and restores at the current terrain', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?startupWorld=overworld');
  await page.waitForFunction(() => (
    window.game?.worldKind === 'overworld'
    && document.querySelector('#game-container')?.dataset?.browserTestReady === 'true'
  ));
  const startY = await page.evaluate(() => window.game.player.root.position.y);

  await page.keyboard.press('Backquote');
  await page.getByRole('tab', { name: 'Platforming' }).click();
  await page.locator('#platform-debug-no-clip').click();
  await page.locator('[data-action="pose-close"]').click();
  await page.keyboard.down('Space');
  await page.waitForTimeout(500);
  await page.keyboard.up('Space');
  const flyingY = await page.evaluate(() => window.game.player.root.position.y);
  expect(flyingY).toBeGreaterThan(startY + 2);

  await page.keyboard.press('Backquote');
  await page.getByRole('tab', { name: 'Platforming' }).click();
  await page.locator('#platform-debug-no-clip').click();
  await page.locator('[data-action="pose-close"]').click();
  const restored = await page.evaluate(() => ({
    y: window.game.player.root.position.y,
    enabled: window.game.debugNoClipEnabled,
    playerEnabled: window.game.player.noClipEnabled,
    restoreSource: window.game.debugNoClipLastRestoreSource,
  }));
  expect(restored).toMatchObject({
    enabled: false,
    playerEnabled: false,
    restoreSource: 'current-surface',
  });
  expect(restored.y).toBeCloseTo(startY, 1);
});
