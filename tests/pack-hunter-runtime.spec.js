import { expect, test } from '@playwright/test';

test('solo Pack Hunters pursue the facing-defined rear lane and only attack an exposed back', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    game.projectiles.clear();
    for (const enemy of [...game.enemies]) {
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;

    const player = game.player;
    const Vector3 = player.root.position.constructor;
    const base = player.root.position.clone();
    player.root.rotation.y = 0;

    const hunter = window.spawnReaverbot({
      archetypeId: 'packHunter',
      seed: 'pack-hunter-rear-lane-runtime',
      position: base.clone().add(new Vector3(0, 0, 4)),
    });
    const controller = game.dungeonController;
    const originalNavigation = controller.getEnemyNavigationDirection;
    controller.getEnemyNavigationDirection = (enemy, target) => target.clone()
      .sub(enemy.root.position)
      .setY(0)
      .normalize();

    const forwardRearTarget = hunter._getPackRearTarget(game).clone();
    const frontExposed = hunter._isPlayerBackExposed(game);
    const moveStart = hunter.root.position.clone();
    const moved = hunter._movePackHunterTowardRear(0.2, game);
    const movement = hunter.root.position.clone().sub(moveStart).setY(0);
    const expectedMovement = forwardRearTarget.clone().sub(moveStart).setY(0).normalize();
    const movementDot = movement.lengthSq() > 0
      ? movement.normalize().dot(expectedMovement)
      : -1;

    hunter.root.position.copy(base).add(new Vector3(0, 0, 1.5));
    hunter.brain.state = 'position';
    hunter.brain.cooldown = 0;
    const frontDirection = base.clone().sub(hunter.root.position).setY(0).normalize();
    hunter._updatePositionState(1 / 60, game, frontDirection, 1.5);
    const frontState = hunter.brain.state;

    hunter.root.position.copy(base).add(new Vector3(0, 0, -1.5));
    hunter.brain.state = 'position';
    hunter.brain.cooldown = 0;
    const rearExposed = hunter._isPlayerBackExposed(game);
    const rearDirection = base.clone().sub(hunter.root.position).setY(0).normalize();
    hunter._updatePositionState(1 / 60, game, rearDirection, 1.5);
    const rearState = hunter.brain.state;

    hunter._removeTelegraphMarker();
    player.root.rotation.y = Math.PI;
    const reversedRearTarget = hunter._getPackRearTarget(game).clone();
    const oldRearNowExposed = hunter._isPlayerBackExposed(game);
    controller.getEnemyNavigationDirection = originalNavigation;

    return {
      liveEnemyCount: game.enemies.filter((enemy) => !enemy.dead).length,
      minimumPackSize: hunter.genome.behavior.minimumPackSize,
      forwardRearTargetZ: forwardRearTarget.z,
      reversedRearTargetZ: reversedRearTarget.z,
      playerZ: base.z,
      frontExposed,
      rearExposed,
      oldRearNowExposed,
      moved,
      movementDot,
      frontState,
      rearState,
    };
  });

  expect(result.liveEnemyCount).toBe(1);
  expect(result.minimumPackSize).toBe(1);
  expect(result.forwardRearTargetZ).toBeLessThan(result.playerZ);
  expect(result.reversedRearTargetZ).toBeGreaterThan(result.playerZ);
  expect(result.frontExposed).toBe(false);
  expect(result.rearExposed).toBe(true);
  expect(result.oldRearNowExposed).toBe(false);
  expect(result.moved).toBe(true);
  expect(result.movementDot).toBeGreaterThan(0.99);
  expect(result.frontState).toBe('position');
  expect(result.rearState).toBe('telegraph');
});

