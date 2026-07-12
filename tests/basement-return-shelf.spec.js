import { expect, test } from '@playwright/test';

test('the basement return ledge is one solid impassable block without a center seam', async ({ page }) => {
  await page.goto('/?roomPreview=trapRoom&roomPreviewLevel=-1&roomPreviewFacing=north');
  await page.waitForFunction(() => Boolean(window.game?.dungeonController));

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const room = game.dungeon.rooms.find((entry) => entry.id === 'trapRoom');
    const spec = room.dropSpace;
    const shelfPlatforms = game.dungeon.platforms.filter((platform) => (
      platform.dropSpaceId === spec.id
    ));
    const shelf = shelfPlatforms[0];
    const shelfLedges = game.platformingLedgeCandidates.filter((candidate) => (
      candidate.id.startsWith(`${shelf.id}-`)
    ));
    const volumes = [];
    const bands = [];
    game.dungeon.group.updateMatrixWorld(true);
    game.dungeon.group.traverse((object) => {
      if (object.name === 'minorDropReturnShelfVolume') volumes.push(object);
      if (object.name === 'minorDropReturnShelfBand') bands.push(object);
    });

    const seamPosition = shelf.center.clone().setY(spec.lowerElevation);
    const ledge = shelfLedges[0];
    const approachPosition = shelf.center.clone()
      .addScaledVector(ledge.normal, game.dungeon.tileSize)
      .setY(spec.lowerElevation);
    const player = game.player;
    const controller = game.dungeonController;
    player.ledgeCling = null;
    player.jumpState = 'Grounded';
    player.velocity.set(0, 0, 0);
    player.root.position.copy(seamPosition);
    controller.lastSafePlayerPosition.copy(approachPosition);
    controller.pendingPlayerJumpOffLanding = null;
    const seamBlocked = game.isPositionInsidePlatformBlock(seamPosition);
    controller._constrainPlayerToWalkable();

    const geometry = volumes[0]?.geometry;
    geometry?.computeBoundingBox();
    const size = geometry?.boundingBox?.getSize(new player.root.position.constructor());
    return {
      accepted: game.dungeon.progression.validation.accepted,
      shelfPlatformCount: shelfPlatforms.length,
      shelfLedgeCount: shelfLedges.length,
      volumeCount: volumes.length,
      bandCount: bands.length,
      mergedVolume: volumes[0]?.userData.mergedReturnShelf === true,
      volumeTileCount: volumes[0]?.userData.tileCount ?? 0,
      maximumHorizontalSize: size ? Math.max(size.x, size.z) : 0,
      seamBlocked,
      rejectedFromSeam: player.root.position.distanceTo(approachPosition) < 0.05,
      ledgeHalfSpan: ledge?.halfSpan ?? 0,
    };
  });

  expect(result.accepted).toBe(true);
  expect(result.shelfPlatformCount).toBe(1);
  expect(result.shelfLedgeCount).toBe(1);
  expect(result.volumeCount).toBe(1);
  expect(result.bandCount).toBe(2);
  expect(result.mergedVolume).toBe(true);
  expect(result.volumeTileCount).toBe(2);
  expect(result.maximumHorizontalSize).toBeGreaterThan(5.4);
  expect(result.seamBlocked).toBe(true);
  expect(result.rejectedFromSeam).toBe(true);
  expect(result.ledgeHalfSpan).toBeGreaterThan(2.6);
});
