import { expect, test } from '@playwright/test';

test('large conveyor-room ramps keep grounded support across overlapping platform seams', async ({ page }) => {
  await page.goto('/?reaverbotSeed=conveyor-ramp-runtime-proof');
  await page.waitForFunction(() => Boolean(window.game?.dungeonController));

  const result = await page.evaluate(() => {
    const game = window.game;
    const controller = game.dungeonController;
    const player = game.player;
    const dungeon = game.dungeon;
    const room = dungeon.rooms.find((entry) => entry.id === 'conveyorRoom');
    game.stop();

    const upperRampTiles = dungeon.floorTiles.filter((tile) => (
      tile.roomId === room.id
      && tile.surface === 'industrialRamp'
    ));
    const routes = new Map();
    for (const tile of upperRampTiles) {
      const route = routes.get(tile.rampRouteId) ?? [];
      route.push(tile);
      routes.set(tile.rampRouteId, route);
    }
    const route = [...routes.values()].sort((left, right) => (
      Math.max(...right.flatMap((tile) => [tile.rampStartElevation, tile.rampEndElevation]))
      - Math.max(...left.flatMap((tile) => [tile.rampStartElevation, tile.rampEndElevation]))
    ))[0];
    const runs = new Map();
    for (const tile of route) {
      const run = runs.get(tile.rampRunId) ?? [];
      run.push(tile);
      runs.set(tile.rampRunId, run);
    }
    const ascendingPlatformRun = [...runs.values()].sort((left, right) => (
      Math.min(...left.map((tile) => tile.rampStartElevation))
      - Math.min(...right.map((tile) => tile.rampStartElevation))
    ))[0];
    const directionX = Math.sign(ascendingPlatformRun[0].rampDirectionX ?? 0);
    const directionZ = Math.sign(ascendingPlatformRun[0].rampDirectionZ ?? 0);
    ascendingPlatformRun.sort((left, right) => (
      (left.x * directionX + left.z * directionZ)
      - (right.x * directionX + right.z * directionZ)
    ));

    player.jumpState = 'Grounded';
    player.velocity.set(0, 0, 0);
    player._jumpBufferTimer = 0;
    if (player.animation) {
      player.animation.actionState = null;
      player.animation.actionTimer = 0;
      player.animation.attackTimer = 0;
      player.animation.hurtTimer = 0;
    }

    let previousY = ascendingPlatformRun[0].rampStartElevation;
    const samples = [];
    for (const tile of ascendingPlatformRun) {
      for (const localProgress of [-0.45, 0, 0.45]) {
        const x = (tile.x + directionX * localProgress) * dungeon.tileSize;
        const z = (tile.z + directionZ * localProgress) * dungeon.tileSize;
        player.root.position.set(x, previousY, z);
        player.jumpState = 'Grounded';
        player.velocity.set(0, 0, 0);

        const rampY = controller.getRampSurfaceElevationAt(player.root.position);
        const platformY = game.getPlatformFloorElevation(player.root.position);
        const resolvedGroundY = game._getPlayerGroundY();
        player._updatePhysicalJumpAndMovement(1 / 120, new player.root.position.constructor(), {
          arenaRadius: 1000,
          movementOptions: { groundY: resolvedGroundY },
        });
        controller._constrainPlayerToWalkable();
        samples.push({
          rampY,
          platformY,
          resolvedGroundY,
          playerY: player.root.position.y,
          jumpState: player.jumpState,
        });
        previousY = player.root.position.y;
      }
    }

    return {
      sampleCount: samples.length,
      overlapSampleCount: samples.filter((sample) => (
        Number.isFinite(sample.platformY)
        && Math.abs(sample.platformY - sample.rampY) > 0.03
      )).length,
      allRampSamplesSolid: samples.every((sample) => (
        Number.isFinite(sample.rampY)
        && Math.abs(sample.resolvedGroundY - sample.rampY) < 0.001
        && Math.abs(sample.playerY - sample.rampY) < 0.001
      )),
      fallingSampleCount: samples.filter((sample) => sample.jumpState === 'Falling').length,
      minimumY: Math.min(...samples.map((sample) => sample.playerY)),
      maximumY: Math.max(...samples.map((sample) => sample.playerY)),
    };
  });

  expect(result.sampleCount).toBeGreaterThanOrEqual(6);
  expect(result.overlapSampleCount).toBeGreaterThan(0);
  expect(result.allRampSamplesSolid).toBe(true);
  expect(result.fallingSampleCount).toBe(0);
  expect(result.maximumY).toBeGreaterThan(result.minimumY + 0.2);
});
