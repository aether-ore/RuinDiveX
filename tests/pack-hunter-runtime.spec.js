import { expect, test } from '@playwright/test';

test('Pack Hunters accept side and rear flanks and force an in-range attack after 15 seconds', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
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

    const setPositionState = (offset, idleTime = 0) => {
      hunter._removeTelegraphMarker();
      hunter.root.position.copy(base).add(offset);
      hunter.brain.state = 'position';
      hunter.brain.stateTime = 0;
      hunter.brain.cooldown = 0;
      hunter.brain.packAttackIdleTime = idleTime;
      hunter.brain.attackFired = false;
      hunter.brain.attackHit = false;
    };
    const updatePositionState = (distance) => {
      const toPlayer = base.clone().sub(hunter.root.position).setY(0).normalize();
      hunter._updatePositionState(1 / 60, game, toPlayer, distance);
      return hunter.brain.state;
    };

    hunter.genome.behavior.orbitDirection = 1;
    const clockwiseTarget = hunter._getPackFlankTarget(game).clone();
    const moveStart = hunter.root.position.clone();
    const moved = hunter._movePackHunterTowardFlank(0.2, game);
    const movement = hunter.root.position.clone().sub(moveStart).setY(0);
    const expectedMovement = clockwiseTarget.clone().sub(moveStart).setY(0).normalize();
    const movementDot = movement.lengthSq() > 0
      ? movement.normalize().dot(expectedMovement)
      : -1;

    hunter.genome.behavior.orbitDirection = -1;
    const counterclockwiseTarget = hunter._getPackFlankTarget(game).clone();
    const clockwiseOffset = clockwiseTarget.clone().sub(base).setY(0);
    const counterclockwiseOffset = counterclockwiseTarget.clone().sub(base).setY(0);

    setPositionState(new Vector3(0, 0, 1.5));
    const frontExposed = hunter._isPlayerFlankExposed(game);
    const frontState = updatePositionState(1.5);

    setPositionState(new Vector3(1.5, 0, 0));
    const rightSideExposed = hunter._isPlayerFlankExposed(game);
    const rightSideState = updatePositionState(1.5);

    setPositionState(new Vector3(-1.5, 0, 0));
    const leftSideExposed = hunter._isPlayerFlankExposed(game);

    setPositionState(new Vector3(0, 0, -1.5));
    const rearExposed = hunter._isPlayerFlankExposed(game);
    const rearState = updatePositionState(1.5);

    let brokenClawHunter = null;
    for (let variant = 0; variant < 300 && !brokenClawHunter; variant += 1) {
      const candidate = window.spawnReaverbot({
        archetypeId: 'packHunter',
        seed: `pack-hunter-broken-claw:${variant}`,
        position: base.clone().add(new Vector3(0, 0, 2.2)),
      });
      if (candidate.genome.modules.weapon.id === 'clawArm') {
        brokenClawHunter = candidate;
      } else {
        const candidateIndex = game.enemies.indexOf(candidate);
        if (candidateIndex >= 0) game.enemies.splice(candidateIndex, 1);
        candidate.dispose?.();
        candidate.root.removeFromParent();
      }
    }
    if (!brokenClawHunter) throw new Error('Unable to generate a claw-equipped Pack Hunter');
    brokenClawHunter.genome.behavior.orbitDirection = -1;
    brokenClawHunter.brain.state = 'position';
    brokenClawHunter.brain.stateTime = 0;
    brokenClawHunter.brain.cooldown = 0;
    brokenClawHunter.brain.packAttackIdleTime = 0;
    brokenClawHunter.brain.clawDestroyed = true;
    const destroyedClawTarget = brokenClawHunter._getPackFlankTarget(game).clone();
    const destroyedClawStart = brokenClawHunter.root.position.clone();
    const destroyedClawDirection = base.clone().sub(brokenClawHunter.root.position).setY(0).normalize();
    brokenClawHunter._updatePositionState(1 / 60, game, destroyedClawDirection, 2.2);
    const destroyedClawState = brokenClawHunter.brain.state;
    const destroyedClawMovement = brokenClawHunter.root.position.clone().sub(destroyedClawStart).setY(0);
    const destroyedClawExpected = destroyedClawTarget.clone().sub(destroyedClawStart).setY(0).normalize();
    const destroyedClawMovementDot = destroyedClawMovement.lengthSq() > 0
      ? destroyedClawMovement.normalize().dot(destroyedClawExpected)
      : -1;
    const brokenClawWeaponId = brokenClawHunter.genome.modules.weapon.id;
    const brokenClawIndex = game.enemies.indexOf(brokenClawHunter);
    if (brokenClawIndex >= 0) game.enemies.splice(brokenClawIndex, 1);
    brokenClawHunter.dispose?.();
    brokenClawHunter.root.removeFromParent();

    setPositionState(new Vector3(0, 0, 30), 15);
    const forcedOutOfRangeState = updatePositionState(30);

    setPositionState(new Vector3(0, 0, 1.5), 15);
    const forcedFrontState = updatePositionState(1.5);
    const idleAtForcedTelegraph = hunter.brain.packAttackIdleTime;
    const forcedDirection = base.clone().sub(hunter.root.position).setY(0).normalize();
    hunter._updateTelegraphState(
      hunter._getStateDuration('telegraph') + 0.01,
      game,
      forcedDirection,
    );
    const stateAfterTelegraph = hunter.brain.state;
    const idleAfterCommit = hunter.brain.packAttackIdleTime;

    hunter._removeTelegraphMarker();
    controller.getEnemyNavigationDirection = originalNavigation;

    return {
      liveEnemyCount: game.enemies.filter((enemy) => !enemy.dead).length,
      minimumPackSize: hunter.genome.behavior.minimumPackSize,
      clockwiseOffset: { x: clockwiseOffset.x, z: clockwiseOffset.z },
      counterclockwiseOffset: { x: counterclockwiseOffset.x, z: counterclockwiseOffset.z },
      moved,
      movementDot,
      frontExposed,
      frontState,
      rightSideExposed,
      leftSideExposed,
      rightSideState,
      rearExposed,
      rearState,
      brokenClawWeaponId,
      destroyedClawState,
      destroyedClawMovementDot,
      forcedOutOfRangeState,
      forcedFrontState,
      idleAtForcedTelegraph,
      stateAfterTelegraph,
      idleAfterCommit,
    };
  });

  expect(result.liveEnemyCount).toBe(1);
  expect(result.minimumPackSize).toBe(1);

  expect(Math.abs(result.clockwiseOffset.x)).toBeGreaterThan(0.5);
  expect(result.counterclockwiseOffset.x).toBeCloseTo(-result.clockwiseOffset.x, 5);
  expect(result.clockwiseOffset.z).toBeLessThan(0);
  expect(result.counterclockwiseOffset.z).toBeCloseTo(result.clockwiseOffset.z, 5);
  expect(Math.abs(result.clockwiseOffset.x)).toBeGreaterThan(Math.abs(result.clockwiseOffset.z));
  expect(result.moved).toBe(true);
  expect(result.movementDot).toBeGreaterThan(0.99);

  expect(result.frontExposed).toBe(false);
  expect(result.frontState).toBe('position');
  expect(result.rightSideExposed).toBe(true);
  expect(result.leftSideExposed).toBe(true);
  expect(result.rightSideState).toBe('telegraph');
  expect(result.rearExposed).toBe(true);
  expect(result.rearState).toBe('telegraph');
  expect(result.brokenClawWeaponId).toBe('clawArm');
  expect(result.destroyedClawState).toBe('position');
  expect(result.destroyedClawMovementDot).toBeGreaterThan(0.99);

  expect(result.forcedOutOfRangeState).toBe('position');
  expect(result.forcedFrontState).toBe('telegraph');
  expect(result.idleAtForcedTelegraph).toBeGreaterThanOrEqual(15);
  expect(result.stateAfterTelegraph).toBe('commit');
  expect(result.idleAfterCommit).toBe(0);
});
