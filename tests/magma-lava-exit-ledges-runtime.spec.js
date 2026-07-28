import { expect, test } from '@playwright/test';

test('combined Magma map registers climbable safe ledges along its lava spine', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(
    '/?startupWorld=dungeon&roomPreview=magma-breached-freight-adit'
      + '&roomPreviewAnchor=assayReveal&dungeonSeed=lava-exit-ledge-runtime',
  );
  await page.waitForFunction(() => (
    document.querySelector('#game-container')?.dataset?.browserTestReady === 'true'
    && window.game?.dungeon?.roomModuleIds?.includes('magma-refractor-assay-lab')
  ));
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const ledges = game.platformingLedgeCandidates.filter((candidate) => (
      candidate.hazardSurface === 'deepMagma'
    ));
    const malformed = ledges.filter((ledge) => (
      ledge.hazardSurface !== 'deepMagma'
      || !ledge.sourceHazardTileKey
      || !Number.isFinite(ledge.approachSurfaceY)
      || ledge.topY <= ledge.approachSurfaceY
      || ledge.halfSpan < 0.5
      || ledge.ledgeCatchMode != null
      || ledge.minimumHangRootY != null
    )).map((ledge) => ledge.id);
    const roomIds = [...new Set(ledges.map((ledge) => ledge.roomId).filter(Boolean))].sort();
    const distinctElevationCount = new Set(ledges.map((ledge) => ledge.topY.toFixed(2))).size;

    const ledge = ledges.find((candidate) => (
      candidate.roomId === 'magma-refractor-assay-lab'
      && candidate.topY - candidate.approachSurfaceY >= 0.45
      && candidate.topY - candidate.approachSurfaceY <= 3
    )) ?? ledges.find((candidate) => (
      candidate.topY - candidate.approachSurfaceY >= 0.45
      && candidate.topY - candidate.approachSurfaceY <= 3
    ));
    if (!ledge) {
      return { count: ledges.length, malformed, roomIds, distinctElevationCount, started: false };
    }

    const player = game.player;
    player.ledgeCling = null;
    player.root.position.copy(ledge.center)
      .addScaledVector(ledge.normal, 0.62)
      .setY(ledge.topY - 0.12);
    player.jumpState = 'Falling';
    player.velocity.copy(ledge.normal).multiplyScalar(-2).setY(-1);
    const jumpDirection = ledge.normal.clone().multiplyScalar(-1);
    const started = game._tryResolvePlatformLedgeCling({
      player,
      root: player.root,
      jumpDirection,
      progress: 0.6,
      jumpStartY: ledge.approachSurfaceY,
      jumpReachHeight: player.getJumpReachHeight(),
    });
    const movementOptions = {
      arenaRadius: game.arenaRadius,
      movementForward: jumpDirection,
      movementRight: new player.root.position.constructor(-jumpDirection.z, 0, jumpDirection.x),
      groundY: ledge.approachSurfaceY,
    };
    for (let frame = 0; frame < 150 && player.ledgeCling; frame += 1) {
      player.update(1 / 60, new Set(), movementOptions);
      game.dungeonController.update(1 / 60);
    }
    player.modelRoot.updateMatrixWorld(true);
    const wrist = player.externalRig?.joints?.get('leftWrist')
      ?.getWorldPosition(new player.root.position.constructor()) ?? null;
    return {
      count: ledges.length,
      malformed,
      roomIds,
      distinctElevationCount,
      started,
      selectedId: ledge.id,
      selectedRise: ledge.topY - ledge.approachSurfaceY,
      minimumRootY: player.ledgeCling?.minimumRootY ?? null,
      clingState: player.getLedgeClingDiagnostics()?.state ?? null,
      clingId: player.getLedgeClingDiagnostics()?.id ?? null,
      wristY: wrist?.y ?? null,
      wristVerticalError: wrist ? Math.abs(wrist.y - ledge.topY) : null,
    };
  });

  expect(result.count).toBeGreaterThan(12);
  expect(result.malformed).toEqual([]);
  expect(result.roomIds).toEqual(expect.arrayContaining([
    'magma-breached-freight-adit',
    'magma-linear-digger-excavation',
    'magma-refractor-assay-lab',
  ]));
  expect(result.distinctElevationCount).toBeGreaterThanOrEqual(3);
  expect(result.started).toBe(true);
  expect(result.clingState).toBe('hangingIdle');
  expect(result.clingId).toBe(result.selectedId);
  expect(result.selectedId).toContain('magma-refractor-assay-lab');
  expect(result.selectedRise).toBeGreaterThanOrEqual(0.45);
  expect(result.minimumRootY).toBeNull();
  expect(result.wristY).not.toBeNull();
  expect(result.wristVerticalError).toBeLessThan(0.03);
});
