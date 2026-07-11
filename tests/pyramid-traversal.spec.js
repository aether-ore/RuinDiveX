import { expect, test } from '@playwright/test';

test('pyramid tiers stay grounded, guardians trigger at the summit, and the keycard remains shielded', async ({ page }) => {
  await page.goto('/?reaverbotSeed=pyramid-runtime-proof');
  await page.waitForFunction(() => Boolean(window.game?.dungeonController));

  const result = await page.evaluate(() => {
    const game = window.game;
    const controller = game.dungeonController;
    const player = game.player;
    const dungeon = game.dungeon;
    const room = dungeon.rooms.find((entry) => entry.id === 'keycardRoom');
    const encounter = controller.encounters.find((entry) => entry.id === 'keycardGuard');
    const keycard = controller.keycards.find((entry) => entry.keycardId === 'Keycard_Alpha');
    game.stop();

    const stair = dungeon.floorTiles
      .filter((tile) => tile.roomId === room.id
        && tile.x === room.x
        && ['mechanicalPyramidProcessionalStep', 'mechanicalPyramidSummit'].includes(tile.surface))
      .sort((left, right) => left.z - right.z);
    let lower = null;
    let upper = null;
    for (let index = 1; index < stair.length; index += 1) {
      if (stair[index].z - stair[index - 1].z === 1
        && Math.abs(stair[index].elevation - stair[index - 1].elevation - 0.5) < 0.001) {
        lower = stair[index - 1];
        upper = stair[index];
        break;
      }
    }

    const toWorld = (tile) => new player.root.position.constructor(
      tile.x * dungeon.tileSize,
      tile.elevation,
      tile.z * dungeon.tileSize,
    );
    const upperWorld = toWorld(upper);
    const lowerWorld = toWorld(lower);
    player.jumpState = 'Grounded';
    player.velocity.set(0, 0, 0);
    if (player.animation) {
      player.animation.actionState = null;
      player.animation.actionTimer = 0;
    }
    controller.lastSafePlayerPosition.copy(upperWorld);
    player.root.position.set(lowerWorld.x, upperWorld.y, lowerWorld.z);
    const pyramidProbe = {
      surfaceY: controller.getSurfaceElevationAt(player.root.position),
      floorY: controller.getFloorElevationAt(player.root.position),
      platformY: game.getPlatformFloorElevation(player.root.position),
      walkable: controller.isPositionWalkable(player.root.position),
      insideBlock: game.isPositionInsidePlatformBlock(player.root.position),
      transitionHeight: controller._getGroundedStepTransitionHeight(
        controller.lastSafePlayerPosition,
        player.root.position,
        0.24,
      ),
      playerJumping: controller._isPlayerJumping(),
    };
    controller._constrainPlayerToWalkable();
    const pyramidDescent = {
      state: player.jumpState,
      y: player.root.position.y,
      expectedY: lowerWorld.y,
    };

    player.jumpState = 'Grounded';
    player.root.position.set(0, 1.1, 0);
    player.velocity.set(0, 0, 0);
    player._updatePhysicalJumpAndMovement(1 / 60, new player.root.position.constructor(), {
      movementOptions: { groundY: 0 },
    });
    const campSizedDropState = player.jumpState;

    encounter.spawned = false;
    encounter.cleared = false;
    const entranceProbe = new player.root.position.constructor(
      room.x * dungeon.tileSize,
      0,
      (room.z - room.mechanicalPyramidCenter.baseHalfExtent - 2) * dungeon.tileSize,
    );
    const summitProbe = encounter.triggerZone.position.clone();
    const entranceEncounter = controller.getUnspawnedEncounterAt(entranceProbe)?.id ?? null;
    const summitEncounter = controller.getUnspawnedEncounterAt(summitProbe)?.id ?? null;

    player.root.position.copy(keycard.position);
    controller._updateKeycards(1 / 60);
    const protectedBeforeClear = !keycard.collected && keycard.barrierObject.visible;
    encounter.cleared = true;
    controller._updateKeycards(1 / 60);

    return {
      pyramidDescent,
      pyramidProbe,
      campSizedDropState,
      enemyCanTraverseTier: controller._canEnemyTraverseFloorTiles(lower, upper),
      entranceEncounter,
      summitEncounter,
      protectedBeforeClear,
      collectedAfterClear: keycard.collected,
      barrierVisibleAfterClear: keycard.barrierObject.visible,
      spawnCount: encounter.spawnPoints.length,
      uniqueSpawnCount: new Set(encounter.spawnPoints.map((point) => (
        `${point.x.toFixed(2)},${point.z.toFixed(2)}`
      ))).size,
    };
  });

  expect(result.pyramidDescent.state).toBe('Grounded');
  expect(result.pyramidProbe.walkable).toBe(true);
  expect(result.pyramidProbe.transitionHeight).toBeCloseTo(0.55, 4);
  expect(result.pyramidDescent.y).toBeCloseTo(result.pyramidDescent.expectedY, 4);
  expect(result.campSizedDropState).toBe('Falling');
  expect(result.enemyCanTraverseTier).toBe(true);
  expect(result.entranceEncounter).toBeNull();
  expect(result.summitEncounter).toBe('keycardGuard');
  expect(result.protectedBeforeClear).toBe(true);
  expect(result.collectedAfterClear).toBe(true);
  expect(result.barrierVisibleAfterClear).toBe(false);
  expect(result.spawnCount).toBe(6);
  expect(result.uniqueSpawnCount).toBe(6);
});
