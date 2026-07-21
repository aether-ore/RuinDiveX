import { expect, test } from '@playwright/test';

async function waitForLockTestGame(page) {
  await page.waitForFunction(() => Boolean(
    window.game?.combat
    && window.game?.player?._fbxAnimationLibraryLoaded
    && window.game?.busterLabPlans?.get('megaBuster')
    && window.spawnReaverbot,
  ));
}

test('manual body lock survives sustained combat, target-list refreshes, and range excursions', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&busterLab=1&reaverbotSeed=manual-lock-stability');
  await waitForLockTestGame(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    const combat = game.combat;
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    game.stop();

    for (const existing of [...game.enemies]) {
      existing.dispose?.();
      existing.root.removeFromParent();
    }
    game.enemies.length = 0;
    game.projectiles.clear();
    player.root.position.set(0, 0, 0);
    player.velocity.set(0, 0, 0);
    player.lastMoveDirection.set(0, 0, 1);
    player.dead = false;
    player.animation.dead = false;
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.attackTimer = 0;
    player.animation.hurtTimer = 0;
    player.animation.cancelAttack();
    game.camera.position.set(0, 3.2, -7);
    game.camera.lookAt(0, 1.1, 6);
    game.camera.updateMatrixWorld(true);

    const target = game.spawner.spawnEnemy('basic', false, new Vector3(0, 0, 6.35), {
      allowRandomElite: false,
    });
    const decoy = game.spawner.spawnEnemy('basic', false, new Vector3(11, 0, 11), {
      allowRandomElite: false,
    });
    const originalSafeAreaCheck = game.isPlayerInSafeArea;
    const originalGetProjectileTargets = game.getProjectileTargets;
    game.isPlayerInSafeArea = () => false;
    game.pointer.primary = false;
    game.pointer.primaryPressed = false;
    game.pointer.secondary = false;
    game.pointer.secondaryPressed = false;
    game.pointer.lockOnPressed = false;
    Object.assign(combat.lockOn, {
      target,
      progress: 1,
      manual: true,
      movementLocked: true,
      source: 'tab',
    });

    const clearFrames = [];
    const wrongTargetFrames = [];
    const samples = [];
    for (let frame = 0; frame < 420; frame += 1) {
      // The returned container and its order are deliberately refreshed every
      // frame, just as encounter cleanup/spawn bookkeeping does in production.
      game.getProjectileTargets = () => (frame % 2 === 0
        ? [target, decoy]
        : [decoy, target]);

      // Spend the first two seconds safely in range, then cross the exact
      // weapon boundary several times without destroying or disposing target.
      target.root.position.z = frame < 120
        ? 6.35
        : 6.75 + Math.sin((frame - 120) / 24) * 0.72;
      target.root.updateMatrixWorld(true);
      combat.update(1 / 60);
      if (!combat.lockOn.target) clearFrames.push(frame);
      if (combat.lockOn.target && combat.lockOn.target !== target) wrongTargetFrames.push(frame);
      if (frame % 30 === 0) {
        samples.push({
          frame,
          distance: target.root.position.distanceTo(player.root.position),
          retained: combat.lockOn.target === target,
          progress: combat.lockOn.progress,
          movementLocked: combat.lockOn.movementLocked,
        });
      }
    }
    const manualFinalTarget = combat.lockOn.target === target;
    const manualFinalProgress = combat.lockOn.progress;
    const manualFinalMovementLocked = combat.lockOn.movementLocked;

    // Weapon-provided automatic acquisition must also remain on its selected
    // object when a refreshed list has a marginally nearer alternative. A
    // target change is warranted only after the selected target is invalid.
    target.root.position.set(0, 0, 4.8);
    decoy.root.position.set(0.3, 0, 5.35);
    target.root.updateMatrixWorld(true);
    decoy.root.updateMatrixWorld(true);
    combat._clearLockOn();
    const automaticProfile = { lockOn: true, homingRange: 9, lockTime: 0.2 };
    const automaticTransitions = [];
    let previousAutomaticTarget = null;
    let acquiredAutomaticTarget = null;
    for (let frame = 0; frame < 180; frame += 1) {
      if (frame === 60) decoy.root.position.set(0.15, 0, 4.35);
      game.getProjectileTargets = () => (frame % 2 === 0
        ? [target, decoy]
        : [decoy, target]);
      combat._updateLockOn(1 / 60, game.pointer.aimWorld, automaticProfile, {
        pressed: false,
        aiming: false,
      });
      if (frame === 30) acquiredAutomaticTarget = combat.lockOn.target;
      if (combat.lockOn.target !== previousAutomaticTarget) {
        automaticTransitions.push({
          frame,
          targetId: combat.lockOn.target?.id ?? null,
          progress: combat.lockOn.progress,
        });
        previousAutomaticTarget = combat.lockOn.target;
      }
    }
    const automaticTargetStable = acquiredAutomaticTarget === target
      && combat.lockOn.target === acquiredAutomaticTarget
      && combat.lockOn.progress === 1;

    game.getProjectileTargets = originalGetProjectileTargets;
    game.isPlayerInSafeArea = originalSafeAreaCheck;
    return {
      clearFrames,
      wrongTargetFrames,
      samples,
      finalTarget: manualFinalTarget,
      finalProgress: manualFinalProgress,
      finalMovementLocked: manualFinalMovementLocked,
      automaticTargetStable,
      automaticTransitions,
    };
  });

  expect.soft(result.clearFrames, JSON.stringify(result.samples, null, 2)).toEqual([]);
  expect.soft(result.wrongTargetFrames).toEqual([]);
  expect.soft(result.finalTarget).toBe(true);
  expect.soft(result.finalProgress).toBe(1);
  expect.soft(result.finalMovementLocked).toBe(true);
  expect.soft(
    result.automaticTargetStable,
    JSON.stringify(result.automaticTransitions, null, 2),
  ).toBe(true);
});

test('covered weak-point lock survives reticle refresh and a range-crossing dodge roll', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&busterLab=1&reaverbotSeed=covered-lock-stability');
  await waitForLockTestGame(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    const combat = game.combat;
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    game.stop();
    for (const existing of [...game.enemies]) {
      existing.dispose?.();
      existing.root.removeFromParent();
    }
    game.enemies.length = 0;
    game.projectiles.clear();
    player.root.position.set(0, 0, 0);
    player.velocity.set(0, 0, 0);
    player.lastMoveDirection.set(0, 0, 1);
    player.dead = false;
    player.animation.dead = false;
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.attackTimer = 0;
    player.animation.hurtTimer = 0;
    player.animation.cancelAttack();
    game.camera.position.set(0, 3.2, -7);
    game.camera.lookAt(0, 1.1, 6);
    game.camera.updateMatrixWorld(true);

    const enemy = window.spawnReaverbot({
      archetypeId: 'shieldSentinel',
      seed: 'covered-lock-stability-sentinel',
      position: new Vector3(0, 0, 6.2),
    });
    enemy.brain.weakPointExposed = true;
    enemy.brain.defenseActive = false;
    enemy.root.updateMatrixWorld(true);
    const weakPoint = enemy.weakPointTarget;
    const originalSafeAreaCheck = game.isPlayerInSafeArea;
    game.isPlayerInSafeArea = () => false;

    const canvasRect = game.renderer.domElement.getBoundingClientRect();
    const weakWorld = weakPoint.getWorldPosition(new Vector3());
    const projected = weakWorld.clone().project(game.camera);
    game.pointer.x = canvasRect.left + (projected.x + 1) * canvasRect.width * 0.5;
    game.pointer.y = canvasRect.top + (1 - projected.y) * canvasRect.height * 0.5;
    game.pointer.primary = false;
    game.pointer.primaryPressed = false;
    game.pointer.secondary = true;
    game.pointer.secondaryPressed = false;
    game.pointer.lockOnPressed = false;
    Object.assign(combat.lockOn, {
      target: weakPoint,
      progress: 1,
      manual: true,
      movementLocked: true,
      source: 'tab',
    });

    const aimSamples = [];
    for (let frame = 0; frame < 120; frame += 1) {
      if (frame === 30) {
        enemy.brain.weakPointExposed = false;
        enemy.brain.defenseActive = true;
      }
      // `getCombatTargets` returns a newly constructed list; once the armor
      // closes it intentionally omits the selected weak point.
      enemy.getCombatTargets();
      combat.update(1 / 60);
      if (frame % 15 === 0) {
        aimSamples.push({
          frame,
          covered: !enemy.brain.weakPointExposed,
          target: combat.lockOn.target === weakPoint
            ? 'weakPoint'
            : combat.lockOn.target === enemy
              ? 'body'
              : 'none',
          progress: combat.lockOn.progress,
        });
      }
    }
    const retainedWhileAiming = combat.lockOn.target === weakPoint;

    game.pointer.secondary = false;
    Object.assign(combat.lockOn, {
      target: weakPoint,
      progress: 1,
      manual: true,
      movementLocked: true,
      source: 'tab',
    });
    const movementOptions = {
      arenaRadius: 100,
      movementForward: new Vector3(0, 0, 1),
      movementRight: new Vector3(1, 0, 0),
      lockOnTarget: weakPoint,
      lockOnTargetPosition: weakPoint.getWorldPosition(new Vector3()),
      groundY: 0,
      game,
    };
    const rollStarted = player.tryDodgeRoll(new Set(['KeyS']), movementOptions);
    const rollSamples = [];
    let frames = 0;
    while (player.animation.actionState === 'dodgeRoll' && frames < 240) {
      player.update(1 / 120, new Set(), movementOptions);
      combat.update(1 / 120);
      rollSamples.push({
        frame: frames,
        distance: enemy.root.position.distanceTo(player.root.position),
        retained: combat.lockOn.target === weakPoint,
        movementLocked: combat.lockOn.movementLocked,
      });
      frames += 1;
    }
    combat.update(1 / 60);
    const retainedAfterRoll = combat.lockOn.target === weakPoint
      && combat.lockOn.progress === 1
      && combat.lockOn.movementLocked;
    game.isPlayerInSafeArea = originalSafeAreaCheck;
    return {
      aimSamples,
      retainedWhileAiming,
      rollStarted,
      rollSamples,
      retainedAfterRoll,
    };
  });

  expect.soft(
    result.retainedWhileAiming,
    JSON.stringify(result.aimSamples, null, 2),
  ).toBe(true);
  expect(result.rollStarted).toBe(true);
  expect(result.rollSamples.length).toBeGreaterThan(0);
  expect.soft(
    result.rollSamples.every((sample) => sample.retained && sample.movementLocked),
    JSON.stringify(result.rollSamples.filter((sample) => !sample.retained), null, 2),
  ).toBe(true);
  expect(result.retainedAfterRoll).toBe(true);
});

test('boss signature lock remains stable and transfers to the body after overload', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&busterLab=1&bossDebug=1&reaverbotSeed=boss-lock-stability');
  await waitForLockTestGame(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    const combat = game.combat;
    const player = game.player;
    game.stop();
    for (const existing of [...game.enemies]) {
      existing.dispose?.();
      existing.root.removeFromParent();
    }
    game.enemies.length = 0;
    game.projectiles.clear();
    player.root.position.set(0, 0, 0);
    player.velocity.set(0, 0, 0);
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.attackTimer = 0;
    player.animation.hurtTimer = 0;
    player.animation.cancelAttack();
    const boss = game.debugSpawnBoss('revolvingFusillade').boss;
    boss.root.position.set(0, 0, 5.8);
    boss.root.updateMatrixWorld(true);
    boss._runtimeGame = game;
    const signature = boss.signatureTarget;
    const originalSafeAreaCheck = game.isPlayerInSafeArea;
    const originalGetProjectileTargets = game.getProjectileTargets;
    game.isPlayerInSafeArea = () => false;
    game.pointer.primary = false;
    game.pointer.primaryPressed = false;
    game.pointer.secondary = false;
    game.pointer.secondaryPressed = false;
    game.pointer.lockOnPressed = false;
    Object.assign(combat.lockOn, {
      target: signature,
      progress: 1,
      manual: true,
      movementLocked: true,
      source: 'tab',
    });

    const preOverloadSamples = [];
    for (let frame = 0; frame < 180; frame += 1) {
      game.getProjectileTargets = () => [...game.enemies];
      boss.getCombatTargets();
      combat.update(1 / 60);
      if (frame % 30 === 0) {
        preOverloadSamples.push({
          frame,
          signatureListed: boss.getCombatTargets().includes(signature),
          retained: combat.lockOn.target === signature,
          progress: combat.lockOn.progress,
        });
      }
    }

    boss.takeDamage(boss.signatureIntegrity / 1.5 + 0.01, {
      source: player,
      playerOwnedAttack: true,
      signaturePartHit: true,
      projectileHit: true,
      directHit: true,
      armorPierce: Number.POSITIVE_INFINITY,
      unblockable: true,
    });
    const postOverloadSamples = [];
    for (let frame = 0; frame < 180; frame += 1) {
      game.getProjectileTargets = () => [...game.enemies];
      boss.getCombatTargets();
      combat.update(1 / 60);
      if (frame % 30 === 0) {
        postOverloadSamples.push({
          frame,
          signatureListed: boss.getCombatTargets().includes(signature),
          retainedOnBody: combat.lockOn.target === boss,
          progress: combat.lockOn.progress,
          movementLocked: combat.lockOn.movementLocked,
        });
      }
    }

    game.getProjectileTargets = originalGetProjectileTargets;
    game.isPlayerInSafeArea = originalSafeAreaCheck;
    return {
      preOverloadSamples,
      postOverloadSamples,
      overloaded: boss.signaturePartOverloaded,
      transferred: combat.lockOn.target === boss,
      progress: combat.lockOn.progress,
      movementLocked: combat.lockOn.movementLocked,
    };
  });

  expect(result.preOverloadSamples.every((sample) => sample.retained)).toBe(true);
  expect(result.overloaded).toBe(true);
  expect(result.transferred).toBe(true);
  expect(result.progress).toBe(1);
  expect(result.movementLocked).toBe(true);
  expect(result.postOverloadSamples.every((sample) => (
    !sample.signatureListed
    && sample.retainedOnBody
    && sample.progress === 1
    && sample.movementLocked
  ))).toBe(true);
});

test('manual lock persists through arm swaps and full-body recovery, then transfers on weak-point break', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&busterLab=1&reaverbotSeed=lock-action-lifecycle');
  await waitForLockTestGame(page);

  const result = await page.evaluate(async () => {
    const game = window.game;
    const combat = game.combat;
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    game.stop();

    for (const existing of [...game.enemies]) {
      existing.dispose?.();
      existing.root.removeFromParent();
    }
    game.enemies.length = 0;
    game.projectiles.clear();
    player.root.position.set(0, 0, 0);
    player.velocity.set(0, 0, 0);
    player.lastMoveDirection.set(0, 0, 1);
    player.dead = false;
    player.animation.dead = false;
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.actionDuration = 0;
    player.animation.attackTimer = 0;
    player.animation.hurtTimer = 0;
    player.animation.externalControlLocked = false;
    player.animation.cancelAttack();
    player.jumpState = 'Grounded';
    player.powerKnockbackState = null;
    player.powerKnockbackVelocity.set(0, 0, 0);

    const target = game.spawner.spawnEnemy('basic', false, new Vector3(0, 0, 4.5), {
      allowRandomElite: false,
    });
    const originalSafeAreaCheck = game.isPlayerInSafeArea;
    const originalLandingResolver = player.powerKnockbackLandingResolver;
    game.isPlayerInSafeArea = () => false;
    game.pointer.primary = false;
    game.pointer.primaryPressed = false;
    game.pointer.secondary = false;
    game.pointer.secondaryPressed = false;
    game.pointer.lockOnPressed = false;
    game.pointer.alternate = false;
    game.pointer.alternatePressed = false;

    const lockTarget = (lockTarget) => {
      Object.assign(combat.lockOn, {
        target: lockTarget,
        progress: 1,
        manual: true,
        movementLocked: true,
        source: 'tab',
      });
    };
    const hasLock = (lockTarget) => (
      combat.lockOn.target === lockTarget
      && combat.lockOn.progress === 1
      && combat.lockOn.movementLocked
      && combat.getMovementLockTarget() === lockTarget
      && combat.getTargetingLockTarget() === lockTarget
    );
    const movementOptions = () => ({
      arenaRadius: 100,
      movementForward: new Vector3(0, 0, 1),
      movementRight: new Vector3(1, 0, 0),
      lockOnTarget: combat.getMovementLockTarget(),
      lockOnTargetPosition: target.root.position.clone().add(new Vector3(0, 1.1, 0)),
      aimWorld: target.root.position.clone().add(new Vector3(0, 1.1, 0)),
      projectileAimInputHeld: false,
      groundY: 0,
      game,
    });
    const step = (dt = 1 / 120) => {
      player.update(dt, new Set(), movementOptions());
      combat.update(dt);
    };

    // Materialize the starter physical chassis into slot 2, return to Mega,
    // and exercise both switchArmSlot outcomes with the live resolver.
    const equipped = await game.equipCustomBuster('build-a', 1);
    player.switchArmWeapon(0, true);
    combat.swapTimer = 0;
    lockTarget(target);
    const failedSameSlot = combat.switchArmSlot(0);
    const retainedAfterFailedSwitch = hasLock(target);
    const successfulCustomSwap = combat.switchArmSlot(1);
    const initialSwapTimer = combat.swapTimer;
    const swapSamples = [];
    for (let frame = 0; frame < 90; frame += 1) {
      combat.update(1 / 120);
      swapSamples.push({
        frame,
        retained: hasLock(target),
        swapTimer: combat.swapTimer,
      });
    }
    const swapState = {
      equipped,
      failedSameSlot,
      retainedAfterFailedSwitch,
      successfulCustomSwap,
      activeArmIndex: player.activeArmIndex,
      activePlanBuildId: game.getActiveBusterPlan()?.buildId ?? null,
      retainedThroughout: swapSamples.every((sample) => sample.retained),
      initialSwapTimer,
      finalSwapTimer: combat.swapTimer,
    };

    // The physical jump path is separate from the animation controller's
    // full-body lock, so cover both paths explicitly.
    player.root.position.set(0, 0, 0);
    player.velocity.set(0, 0, 0);
    player.jumpState = 'Grounded';
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.actionDuration = 0;
    player.animation.attackTimer = 0;
    player.animation.hurtTimer = 0;
    lockTarget(target);
    const physicalJumpStarted = player.tryJump(new Set(), movementOptions());
    const physicalJumpStates = new Set();
    const physicalJumpLostFrames = [];
    let physicalJumpFrames = 0;
    while (player.isPhysicalJumpActive?.() && physicalJumpFrames < 480) {
      physicalJumpStates.add(player.jumpState);
      step();
      if (!hasLock(target)) physicalJumpLostFrames.push(physicalJumpFrames);
      physicalJumpFrames += 1;
    }
    step();
    const physicalJump = {
      started: physicalJumpStarted,
      frames: physicalJumpFrames,
      states: [...physicalJumpStates],
      lostFrames: physicalJumpLostFrames,
      completed: !player.isPhysicalJumpActive?.(),
      retainedAfter: hasLock(target),
    };

    player.root.position.set(0, 0, 0);
    player.velocity.set(0, 0, 0);
    player.jumpState = 'Grounded';
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.actionDuration = 0;
    player.animation.attackTimer = 0;
    player.animation.hurtTimer = 0;
    lockTarget(target);
    const fullBodyJumpStarted = player.animation.playJump('forwardJump', 0.32);
    const fullBodyLostFrames = [];
    let fullBodyFrames = 0;
    while (player.animation.actionState && fullBodyFrames < 240) {
      step();
      if (!hasLock(target)) fullBodyLostFrames.push(fullBodyFrames);
      fullBodyFrames += 1;
    }
    step();
    const fullBodyJump = {
      started: fullBodyJumpStarted,
      frames: fullBodyFrames,
      lostFrames: fullBodyLostFrames,
      completed: player.animation.actionState === null,
      retainedAfter: hasLock(target),
    };

    // Exercise every power-knockback state through production Player.update.
    player.root.position.set(0, 0, 0);
    player.velocity.set(0, 0, 0);
    player.jumpState = 'Grounded';
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.actionDuration = 0;
    player.animation.attackTimer = 0;
    player.animation.hurtTimer = 0;
    player.animation.externalControlLocked = false;
    player.powerKnockbackState = null;
    player.powerKnockbackVelocity.set(0, 0, 0);
    player.powerKnockbackLandingResolver = ({ position }) => ({
      position: new Vector3(position.x, 0, position.z),
      mode: 'lockLifecycleTestSurface',
    });
    lockTarget(target);
    const knockbackStarted = player._playKnockbackFall(
      { position: new Vector3(0, 0, -1) },
      {
        powerfulKnockback: true,
        knockbackDirection: new Vector3(0, 0, 1),
        knockbackStrength: 1,
      },
    );
    const knockbackStates = new Set();
    const knockbackLostFrames = [];
    let knockbackFrames = 0;
    while (player.isPowerKnockbackActive() && knockbackFrames < 720) {
      knockbackStates.add(player.powerKnockbackState);
      step();
      if (!hasLock(target)) knockbackLostFrames.push(knockbackFrames);
      knockbackFrames += 1;
    }
    step();
    const knockback = {
      started: knockbackStarted,
      frames: knockbackFrames,
      states: [...knockbackStates],
      lostFrames: knockbackLostFrames,
      completed: !player.isPowerKnockbackActive(),
      retainedAfter: hasLock(target),
    };

    // Destroy an ordinary lockable weak point through its damage path. The
    // selected sub-target ceases to be retainable, but its living owner does
    // not, so the lock must transfer without losing its completed state.
    const sentinel = window.spawnReaverbot({
      archetypeId: 'shieldSentinel',
      seed: 'ordinary-weak-point-lock-transfer',
      position: new Vector3(1.5, 0, 4.2),
    });
    sentinel._runtimeGame = game;
    sentinel.brain.weakPointExposed = true;
    sentinel.brain.defenseActive = false;
    const weakPoint = sentinel.weakPointTarget;
    lockTarget(weakPoint);
    sentinel.weakPointDamage = sentinel.stats.maxHealth * 0.32 - 0.25;
    const breakMeta = {
      source: player,
      playerOwnedAttack: true,
      projectileHit: true,
      directHit: true,
      weakPointHit: true,
      hitPartId: weakPoint.partId,
      armorPierce: Number.POSITIVE_INFINITY,
      unblockable: true,
    };
    const breakDamage = sentinel.takeDamage(1, breakMeta);
    combat.update(1 / 60);
    const weakPointBreak = {
      breakDamage,
      metaMarkedBroken: breakMeta.weakPointBroken === true,
      weakPointBroken: sentinel.weakPointBroken,
      ownerAlive: !sentinel.dead,
      weakPointListed: sentinel.getCombatTargets().includes(weakPoint),
      weakPointRetainable: combat._isValidLockTarget(weakPoint),
      transferredToBody: combat.lockOn.target === sentinel,
      progress: combat.lockOn.progress,
      movementLocked: combat.lockOn.movementLocked,
      movementTargetIsBody: combat.getMovementLockTarget() === sentinel,
      targetingTargetIsBody: combat.getTargetingLockTarget() === sentinel,
    };

    player.powerKnockbackLandingResolver = originalLandingResolver;
    game.isPlayerInSafeArea = originalSafeAreaCheck;
    return {
      swapState,
      physicalJump,
      fullBodyJump,
      knockback,
      weakPointBreak,
    };
  });

  expect(result.swapState.equipped.ok).toBe(true);
  expect(result.swapState.failedSameSlot).toBe(false);
  expect(result.swapState.retainedAfterFailedSwitch).toBe(true);
  expect(result.swapState.successfulCustomSwap).toBe(true);
  expect(result.swapState.activeArmIndex).toBe(1);
  expect(result.swapState.activePlanBuildId).toBe('build-a');
  expect(result.swapState.retainedThroughout).toBe(true);
  expect(result.swapState.initialSwapTimer).toBeGreaterThan(0);
  expect(result.swapState.finalSwapTimer).toBe(0);

  expect(result.physicalJump.started).toBe(true);
  expect(result.physicalJump.frames).toBeGreaterThan(0);
  expect(result.physicalJump.states).toEqual(expect.arrayContaining(['Rising', 'Falling']));
  expect(result.physicalJump.lostFrames).toEqual([]);
  expect(result.physicalJump.completed).toBe(true);
  expect(result.physicalJump.retainedAfter).toBe(true);

  expect(result.fullBodyJump.started).toBe(true);
  expect(result.fullBodyJump.frames).toBeGreaterThan(0);
  expect(result.fullBodyJump.lostFrames).toEqual([]);
  expect(result.fullBodyJump.completed).toBe(true);
  expect(result.fullBodyJump.retainedAfter).toBe(true);

  expect(result.knockback.started).toBe(true);
  expect(result.knockback.frames).toBeGreaterThan(0);
  expect(result.knockback.states).toEqual(expect.arrayContaining([
    'KnockbackRising',
    'AerialKnockbackFalling',
    'BackLanding',
    'LyingFlat',
    'GetUp',
  ]));
  expect(result.knockback.lostFrames).toEqual([]);
  expect(result.knockback.completed).toBe(true);
  expect(result.knockback.retainedAfter).toBe(true);

  expect(result.weakPointBreak.breakDamage).toBeGreaterThan(0);
  expect(result.weakPointBreak.metaMarkedBroken).toBe(true);
  expect(result.weakPointBreak.weakPointBroken).toBe(true);
  expect(result.weakPointBreak.ownerAlive).toBe(true);
  expect(result.weakPointBreak.weakPointListed).toBe(false);
  expect(result.weakPointBreak.weakPointRetainable).toBe(false);
  expect(result.weakPointBreak.transferredToBody).toBe(true);
  expect(result.weakPointBreak.progress).toBe(1);
  expect(result.weakPointBreak.movementLocked).toBe(true);
  expect(result.weakPointBreak.movementTargetIsBody).toBe(true);
  expect(result.weakPointBreak.targetingTargetIsBody).toBe(true);
});
