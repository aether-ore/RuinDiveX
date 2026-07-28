import { expect, test } from '@playwright/test';

import {
  attachRuntimeErrorCapture,
  beginBossExpedition,
  waitForWorld,
} from './helpers/overworld-runtime.js';

const SAVE_IDENTITY_SCHEMA = 'ruindivex-dungeon-augmentation-save-identity/v1';

test('incompatible committed augmentation can be explicitly reset to current content', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const runtimeErrors = attachRuntimeErrorCapture(page);
  const startupUrl = [
    '/?dungeonSeed=augmentation-runtime-check',
    'reaverbotSeed=augmentation-runtime-check',
    'dungeonAugmentation=preview',
  ].join('&');
  await page.goto(startupUrl);
  await waitForWorld(page, 'overworld');
  await beginBossExpedition(page, 'revolvingFusillade');

  const committed = await page.evaluate(() => (
    structuredClone(window.game.busterLabStorage.getActiveBossExpedition())
  ));
  expect(committed.dungeonAugmentation).toMatchObject({
    schema: SAVE_IDENTITY_SCHEMA,
    profileId: 'industrial-supplement-preview-v2',
  });

  const corrupted = await page.evaluate(async () => {
    const lab = window.game.busterLabStorage;
    const expeditionId = lab.getActiveBossExpedition().expeditionId;
    const result = await lab.transact({
      operation: 'test-corrupt-committed-augmentation',
      expectedRevision: lab.revision,
      expectedWriteId: lab.writeId,
    }, (state) => {
      state.bossHunts.recordedExpeditions[expeditionId].dungeonAugmentation = {
        schema: 'ruindivex-dungeon-augmentation-save-identity/v1',
        profileId: 'removed-preview-profile',
      };
    });
    return {
      ok: result.ok,
      active: lab.getActiveBossExpedition(),
    };
  });
  expect(corrupted.ok).toBe(true);
  expect(corrupted.active.dungeonAugmentation).toMatchObject({
    status: 'incompatible-content',
    resetOrAbandonRequired: true,
  });

  await page.close();
  const reopened = await context.newPage();
  const reopenedErrors = attachRuntimeErrorCapture(reopened);
  await reopened.goto(startupUrl);
  await waitForWorld(reopened, 'overworld');
  const modal = reopened.locator('[data-interrupted-expedition-modal]');
  const resetButton = modal.locator('[data-action="reset-interrupted-expedition-content"]');
  const resumeButton = modal.locator('[data-action="resume-interrupted-expedition"]');
  await expect(modal).toBeVisible();
  await expect(resetButton).toBeVisible();
  await expect(resumeButton).toBeHidden();
  expect(await reopened.evaluate(() => document.activeElement?.dataset?.action ?? null))
    .toBe('reset-interrupted-expedition-content');

  await resetButton.click();
  await waitForWorld(reopened, 'dungeon', { timeout: 90_000 });
  await expect(modal).toBeHidden();
  const reset = await reopened.evaluate(() => {
    const { game } = window;
    return structuredClone({
      active: game.busterLabStorage.getActiveBossExpedition(),
      facadeIdentity: game.dungeon.augmentationIdentity ?? null,
      diagnostics: game.getWorldTransitionDiagnostics(),
    });
  });
  expect(reset.active).toMatchObject({
    expeditionId: committed.expeditionId,
    bossProfileId: committed.bossProfileId,
    dungeonLayoutSeed: committed.dungeonLayoutSeed,
    dungeonFamilyId: committed.dungeonFamilyId,
    status: 'active',
    restartCount: 1,
  });
  expect(reset.active.dungeonAugmentation).toEqual(reset.facadeIdentity);
  expect(reset.active.dungeonAugmentation).toMatchObject({
    schema: SAVE_IDENTITY_SCHEMA,
    profileId: 'industrial-supplement-preview-v2',
  });
  expect(reset.diagnostics.worldKind).toBe('dungeon');
  expect(runtimeErrors).toEqual([]);
  expect(reopenedErrors).toEqual([]);

  await reopened.evaluate(() => window.game?.stop?.());
});

test('direct dungeon startup rebuilds the complete persisted expedition spec', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const runtimeErrors = attachRuntimeErrorCapture(page);
  await page.goto('/?dungeonSeed=direct-setup');
  await waitForWorld(page, 'overworld');
  const locked = await page.evaluate(async () => {
    const lab = window.game.busterLabStorage;
    return lab.lockBossHuntForExpedition({
      id: 'direct-committed-spec-expedition',
      bossProfileId: 'revolvingFusillade',
      seed: 'boss:direct-committed-spec',
      depth: 4,
      dungeonLayoutSeed: 'layout:direct-committed-spec',
      dungeonFamilyId: 'industrial-v1',
      dungeonAugmentation: null,
    });
  });
  expect(locked.ok).toBe(true);

  await page.close();
  const reopened = await context.newPage();
  const reopenedErrors = attachRuntimeErrorCapture(reopened);
  await reopened.goto([
    '/?startupWorld=dungeon',
    'dungeonSeed=url-must-not-win',
    'dungeonAugmentation=preview',
  ].join('&'));
  await waitForWorld(reopened, 'dungeon', { timeout: 90_000 });
  const rebuilt = await reopened.evaluate(() => {
    const { game } = window;
    return structuredClone({
      selectedBossProfileId: game.getSelectedBossProfileId(),
      layoutSeed: game.dungeonLayoutSeed,
      ruinFloor: game.ruinFloor,
      dungeonFamilyId: game.dungeonFamilyId,
      facadeLayoutSeed: game.dungeon.layoutSeed,
      basePlanHash: game.dungeon.basePlanHash,
      augmentationIdentity: game.dungeon.augmentationIdentity ?? null,
      activeSpec: game.getActiveBossExpeditionSpec(),
    });
  });
  expect(rebuilt).toMatchObject({
    selectedBossProfileId: 'revolvingFusillade',
    layoutSeed: 'layout:direct-committed-spec',
    ruinFloor: 4,
    dungeonFamilyId: 'industrial-v1',
    facadeLayoutSeed: 'layout:direct-committed-spec',
    basePlanHash: 'v1:layout:direct-committed-spec:depth:4:revolvingFusillade',
    augmentationIdentity: null,
    activeSpec: {
      id: 'direct-committed-spec-expedition',
      bossProfileId: 'revolvingFusillade',
      depth: 4,
      dungeonLayoutSeed: 'layout:direct-committed-spec',
      dungeonFamilyId: 'industrial-v1',
      dungeonAugmentation: null,
    },
  });
  expect(runtimeErrors).toEqual([]);
  expect(reopenedErrors).toEqual([]);
  await reopened.evaluate(() => window.game?.stop?.());
});
