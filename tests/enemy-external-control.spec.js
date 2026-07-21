import { expect, test } from '@playwright/test';

test('enemy external control is exclusive and target-owned throws survive their carrier', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&reaverbotSeed=external-control-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();
    game.combat._stopLiftArm(false);
    for (const enemy of [...game.enemies]) {
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;
    game.destructibles.length = 0;

    const ownerA = { id: 'carrier-a', dead: false };
    const ownerB = { id: 'carrier-b', dead: false };
    const target = window.spawnReaverbot({
      archetypeId: 'pursuer',
      seed: 'external-control-target',
      position: new Vector3(0, 0, 5),
    });
    target.brain.alerted = true;
    target.brain.cooldown = 99;

    const claimA = target.tryClaimExternalControl(ownerA, 'tractorCarry');
    const claimBWhileHeld = target.tryClaimExternalControl(ownerB, 'tractorCarry');
    const releaseByWrongOwner = target.releaseExternalControl(ownerB);
    const heldStart = target.root.position.clone();
    target.knockback.set(4, 0, 0);
    target.update(0.2, game);
    const heldTravel = target.root.position.distanceTo(heldStart);
    const heldKnockback = target.knockback.length();

    const landingEvents = [];
    const landingPosition = new Vector3(4, 0.25, 5);
    const throwStarted = target.startExternalBallisticMotion(ownerA, {
      targetPosition: landingPosition,
      duration: 0.9,
      arcHeight: 2,
      spinRate: { x: 2, y: 7, z: 1 },
      onLand: (enemy, callbackGame, reason) => {
        landingEvents.push({
          enemyId: enemy.id,
          hasGame: callbackGame === game,
          reason,
        });
      },
    });
    ownerA.dead = true;
    target.update(0.45, game);
    const midpoint = target.root.position.clone();
    const midpointMotionActive = target.isExternalMotionActive();
    const midpointIgnoresGround = target.shouldIgnoreGroundConstraint();
    target.update(0.45, game);
    const landingDistance = target.root.position.distanceTo(landingPosition);
    const motionAfterLanding = target.isExternalMotionActive();
    const claimBAfterLanding = target.tryClaimExternalControl(ownerB, 'test');
    target.releaseExternalControl(ownerB);

    const heldDeathTarget = window.spawnReaverbot({
      archetypeId: 'pursuer',
      seed: 'external-control-held-death',
      position: new Vector3(7, 0.4, 5),
    });
    heldDeathTarget.tryClaimExternalControl(ownerB, 'tractorCarry');
    heldDeathTarget.root.position.y = 4;
    const heldDeathCurrent = heldDeathTarget.root.position.clone();
    heldDeathTarget.takeDamage(99999);

    const thrownDeathEvents = [];
    const thrownDeathTarget = window.spawnReaverbot({
      archetypeId: 'pursuer',
      seed: 'external-control-thrown-death',
      position: new Vector3(9, 0, 5),
    });
    const thrownDeathLanding = new Vector3(11, 0.6, 5);
    thrownDeathTarget.tryClaimExternalControl(ownerB, 'tractorCarry');
    thrownDeathTarget.startExternalBallisticMotion(ownerB, {
      targetPosition: thrownDeathLanding,
      onLand: (enemy, callbackGame, reason) => thrownDeathEvents.push({
        enemyId: enemy.id,
        hasGame: Boolean(callbackGame),
        reason,
      }),
    });
    const thrownDeathCurrent = thrownDeathTarget.root.position.clone();
    thrownDeathTarget.takeDamage(99999);

    const groundedDeathLanding = new Vector3(13, 0.35, 5);
    const groundedDeathOwner = {
      id: 'grounded-death-owner',
      _findTractorReleaseLanding: () => ({
        position: groundedDeathLanding.clone(),
        arcHeight: 0,
      }),
    };
    const groundedDeathTarget = window.spawnReaverbot({
      archetypeId: 'pursuer',
      seed: 'external-control-grounded-death',
      position: new Vector3(13, 0.35, 5),
    });
    groundedDeathTarget.tryClaimExternalControl(groundedDeathOwner, 'tractorCarry');
    groundedDeathTarget.root.position.y = 4;
    const groundedDeathCurrent = groundedDeathTarget.root.position.clone();
    game.damageEnemy(groundedDeathTarget, 99999, { selfDestruct: true });
    const groundedDeathImmediate = groundedDeathTarget.root.position.clone();
    groundedDeathTarget.update(1.25, game);
    const groundedDeathFinal = groundedDeathTarget.root.position.clone();

    const aerialDeathLanding = new Vector3(15, 0.35, 5);
    const aerialDeathOwner = {
      id: 'aerial-death-owner',
      _findTractorReleaseLanding: () => ({
        position: aerialDeathLanding.clone(),
        arcHeight: 0,
      }),
    };
    const aerialDeathTarget = window.spawnReaverbot({
      archetypeId: 'aerialBomber',
      seed: 'external-control-aerial-death',
      position: new Vector3(15, 4, 5),
    });
    aerialDeathTarget.tryClaimExternalControl(aerialDeathOwner, 'tractorCarry');
    const aerialDeathCurrent = aerialDeathTarget.root.position.clone();
    game.damageEnemy(aerialDeathTarget, 99999, { selfDestruct: true });
    const aerialDeathImmediate = aerialDeathTarget.root.position.clone();
    aerialDeathTarget.update(1.25, game);
    const aerialDeathFinal = aerialDeathTarget.root.position.clone();

    for (const enemy of [...game.enemies]) {
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;

    game.player.root.position.set(0, 0, 0);
    game.player.lastMoveDirection.set(0, 0, 1);
    const liftTarget = game.spawner.spawnCuratedEnemy(
      'horokko',
      false,
      new Vector3(0, 0, 1.1),
    );
    const liftDirection = new Vector3(0, 0, 1);
    const liftProfile = {
      liftRange: 2,
      liftConeAngle: 0.82,
      liftHoldHeight: 2.45,
      liftObjectOffset: 0.22,
      liftEnemyOutputDrainPerSecond: 0.1,
      outputRecoveryDelay: 0.2,
      color: 0x7ee7ff,
    };
    const liftState = {
      cooldown: 0,
      reloadTimer: 0,
      weaponOutput: 10,
      outputRecoveryDelay: 0,
    };
    liftTarget.tryClaimExternalControl(ownerB, 'tractorReservation', { freeze: false });
    const blockedLiftTarget = game.combat._findLiftArmTarget(liftDirection, liftProfile);
    liftTarget.releaseExternalControl(ownerB);
    game.combat.swapTimer = 0;
    game.combat._updateLiftArm(
      0.1,
      game.player.root.position.clone().add(liftDirection),
      liftProfile,
      liftState,
    );
    const liftClaimedByCombat = liftTarget.hasExternalControl(game.combat);
    const liftFrozen = liftTarget.isExternalMotionActive();
    game.combat._stopLiftArm(false);
    const liftReleased = !liftTarget.hasExternalControl();

    return {
      claimA,
      claimBWhileHeld,
      releaseByWrongOwner,
      heldTravel,
      heldKnockback,
      throwStarted,
      midpointY: midpoint.y,
      midpointMotionActive,
      midpointIgnoresGround,
      landingDistance,
      motionAfterLanding,
      claimBAfterLanding,
      landingEvents,
      heldDeath: {
        dead: heldDeathTarget.dead,
        hasControl: heldDeathTarget.hasExternalControl(),
        height: heldDeathTarget.root.position.y,
        expectedHeight: heldDeathCurrent.y,
        currentDistance: heldDeathTarget.root.position.distanceTo(heldDeathCurrent),
        deathFloorY: heldDeathTarget.deathFloorY,
      },
      thrownDeath: {
        dead: thrownDeathTarget.dead,
        motionActive: thrownDeathTarget.isExternalMotionActive(),
        landingDistance: thrownDeathTarget.root.position.distanceTo(thrownDeathLanding),
        currentDistance: thrownDeathTarget.root.position.distanceTo(thrownDeathCurrent),
        deathFloorY: thrownDeathTarget.deathFloorY,
        expectedFloorY: thrownDeathCurrent.y,
        events: thrownDeathEvents,
      },
      groundedDeath: {
        immediateDistance: groundedDeathImmediate.distanceTo(groundedDeathCurrent),
        landingDistance: groundedDeathTarget.deathLandingPosition.distanceTo(groundedDeathLanding),
        dropDistance: groundedDeathTarget.deathDropPosition.distanceTo(groundedDeathLanding),
        finalHorizontalDistance: Math.hypot(
          groundedDeathFinal.x - groundedDeathLanding.x,
          groundedDeathFinal.z - groundedDeathLanding.z,
        ),
        finalHeight: groundedDeathFinal.y,
        expectedHeight: groundedDeathLanding.y - 0.08,
      },
      aerialDeath: {
        immediateDistance: aerialDeathImmediate.distanceTo(aerialDeathCurrent),
        landingDistance: aerialDeathTarget.deathLandingPosition.distanceTo(aerialDeathLanding),
        dropDistance: aerialDeathTarget.deathDropPosition.distanceTo(aerialDeathLanding),
        finalHorizontalDistance: Math.hypot(
          aerialDeathFinal.x - aerialDeathLanding.x,
          aerialDeathFinal.z - aerialDeathLanding.z,
        ),
        finalHeight: aerialDeathFinal.y,
        expectedHeight: aerialDeathLanding.y - 0.08,
      },
      lift: {
        blockedWhileReserved: blockedLiftTarget === null,
        liftClaimedByCombat,
        liftFrozen,
        liftReleased,
      },
    };
  });

  expect(result.claimA).toBe(true);
  expect(result.claimBWhileHeld).toBe(false);
  expect(result.releaseByWrongOwner).toBe(false);
  expect(result.heldTravel).toBeLessThan(0.001);
  expect(result.heldKnockback).toBe(0);
  expect(result.throwStarted).toBe(true);
  expect(result.midpointY).toBeGreaterThan(2);
  expect(result.midpointMotionActive).toBe(true);
  expect(result.midpointIgnoresGround).toBe(true);
  expect(result.landingDistance).toBeLessThan(0.001);
  expect(result.motionAfterLanding).toBe(false);
  expect(result.claimBAfterLanding).toBe(true);
  expect(result.landingEvents).toHaveLength(1);
  expect(result.landingEvents[0]).toMatchObject({
    hasGame: true,
    reason: 'landed',
  });
  expect(result.heldDeath.dead).toBe(true);
  expect(result.heldDeath.hasControl).toBe(false);
  expect(result.heldDeath.currentDistance).toBeLessThan(0.001);
  expect(result.heldDeath.height).toBeCloseTo(result.heldDeath.expectedHeight, 4);
  expect(result.heldDeath.deathFloorY).toBeCloseTo(result.heldDeath.expectedHeight, 4);
  expect(result.thrownDeath.dead).toBe(true);
  expect(result.thrownDeath.motionActive).toBe(false);
  expect(result.thrownDeath.currentDistance).toBeLessThan(0.001);
  expect(result.thrownDeath.landingDistance).toBeGreaterThan(1);
  expect(result.thrownDeath.deathFloorY).toBeCloseTo(result.thrownDeath.expectedFloorY, 4);
  expect(result.thrownDeath.events).toHaveLength(1);
  expect(result.thrownDeath.events[0].reason).toBe('death');
  expect(result.thrownDeath.events[0].hasGame).toBe(false);
  expect(result.groundedDeath.immediateDistance).toBeLessThan(0.001);
  expect(result.groundedDeath.landingDistance).toBeLessThan(0.001);
  expect(result.groundedDeath.dropDistance).toBeLessThan(0.001);
  expect(result.groundedDeath.finalHorizontalDistance).toBeLessThan(0.001);
  expect(result.groundedDeath.finalHeight).toBeCloseTo(result.groundedDeath.expectedHeight, 4);
  expect(result.aerialDeath.immediateDistance).toBeLessThan(0.001);
  expect(result.aerialDeath.landingDistance).toBeLessThan(0.001);
  expect(result.aerialDeath.dropDistance).toBeLessThan(0.001);
  expect(result.aerialDeath.finalHorizontalDistance).toBeLessThan(0.001);
  expect(result.aerialDeath.finalHeight).toBeCloseTo(result.aerialDeath.expectedHeight, 4);
  expect(result.lift.blockedWhileReserved).toBe(true);
  expect(result.lift.liftClaimedByCombat).toBe(true);
  expect(result.lift.liftFrozen).toBe(true);
  expect(result.lift.liftReleased).toBe(true);
});

test('player external control freezes input, owns collision constraints, and lands target-owned throws', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&reaverbotSeed=player-external-control-proof');
  await page.waitForFunction(() => Boolean(window.game?.player));

  const result = await page.evaluate(() => {
    const game = window.game;
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    game.stop();

    player.clearExternalMotion('reset', game);
    player.dead = false;
    player.health = player.stats.maxHealth;
    const groundPosition = player.root.position.clone();
    groundPosition.y = game.dungeonController.getSurfaceElevationAt(groundPosition);
    player.root.position.copy(groundPosition);
    game.dungeonController.lastSafePlayerPosition.copy(groundPosition);

    const ownerA = { id: 'player-carrier-a', dead: false };
    const ownerB = { id: 'player-carrier-b', dead: false };
    player.jumpState = 'Rising';
    player.velocity.set(3, 4, 2);
    player.animation.attackTimer = 1;
    player.animation.actionState = 'forwardJump';
    player.animation.actionTimer = 1;

    const claimA = player.tryClaimExternalControl(ownerA, 'tractorCarry');
    const claimBWhileHeld = player.tryClaimExternalControl(ownerB, 'tractorCarry');
    const releaseByWrongOwner = player.releaseExternalControl(ownerB);
    const resetOnClaim = {
      jumpState: player.jumpState,
      velocity: player.velocity.length(),
      attackTimer: player.animation.attackTimer,
      actionState: player.animation.actionState,
    };

    player.root.position.y += 2.4;
    const heldPosition = player.root.position.clone();
    game.dungeonController._constrainPlayerToWalkable();
    const constraintTravel = player.root.position.distanceTo(heldPosition);
    player.update(0.15, new Set(['KeyW']), {
      arenaRadius: game.arenaRadius,
      groundY: groundPosition.y,
      game,
    });
    const inputTravel = player.root.position.distanceTo(heldPosition);
    const heldAnimationState = player.animation.state;

    const targetPosition = groundPosition.clone();
    const landingEvents = [];
    const throwStarted = player.startExternalBallisticMotion(ownerA, {
      targetPosition,
      duration: 0.9,
      arcHeight: 2,
      spinRate: { x: 2, y: 7, z: 1 },
      onLand: (target, callbackGame, reason) => landingEvents.push({
        isPlayer: target === player,
        hasGame: callbackGame === game,
        reason,
      }),
    });
    ownerA.dead = true;
    player.update(0.45, new Set(), {
      arenaRadius: game.arenaRadius,
      groundY: groundPosition.y,
      game,
    });
    const midpoint = player.root.position.clone();
    const midpointMotionActive = player.isExternalMotionActive();
    player.update(0.45, new Set(), {
      arenaRadius: game.arenaRadius,
      groundY: groundPosition.y,
      game,
    });
    const landingDistance = player.root.position.distanceTo(targetPosition);
    const motionAfterLanding = player.isExternalMotionActive();
    const controlUnlocked = !player.animation.externalControlLocked;

    const reservationState = player.jumpState;
    const reservationClaimed = player.tryClaimExternalControl(ownerB, 'tractorReservation', {
      freeze: false,
    });
    const reservationActive = player.isExternalMotionActive();
    player.releaseExternalControl(ownerB, 'reservationReleased');
    const reservationPreservedState = player.jumpState === reservationState;

    const originalTravelResolver = player.powerKnockbackTravelResolver;
    const originalLandingResolver = player.powerKnockbackLandingResolver;
    const blockedLanding = targetPosition.clone();
    const blockedEvents = [];
    player.tryClaimExternalControl(ownerB, 'tractorCarry');
    player.powerKnockbackTravelResolver = ({ fromPosition }) => ({
      blocked: true,
      position: fromPosition.clone(),
      barrierKind: 'boundaryWall',
    });
    player.powerKnockbackLandingResolver = () => ({
      position: blockedLanding.clone(),
      mode: 'launchSideFallback',
    });
    const blockedThrowStarted = player.startExternalBallisticMotion(ownerB, {
      targetPosition: targetPosition.clone().add(new Vector3(4, 0, 0)),
      duration: 0.8,
      arcHeight: 1.5,
      onLand: (_target, callbackGame, reason) => blockedEvents.push({
        hasGame: callbackGame === game,
        reason,
      }),
    });
    player.update(0.2, new Set(), {
      arenaRadius: game.arenaRadius,
      groundY: groundPosition.y,
      game,
    });
    const blockedLandingDistance = player.root.position.distanceTo(blockedLanding);
    const blockedMotionActive = player.isExternalMotionActive();
    player.powerKnockbackTravelResolver = originalTravelResolver;
    player.powerKnockbackLandingResolver = originalLandingResolver;

    return {
      claimA,
      claimBWhileHeld,
      releaseByWrongOwner,
      resetOnClaim,
      constraintTravel,
      inputTravel,
      heldAnimationState,
      throwStarted,
      midpointY: midpoint.y,
      heldY: heldPosition.y,
      midpointMotionActive,
      landingDistance,
      motionAfterLanding,
      controlUnlocked,
      landingEvents,
      reservationClaimed,
      reservationActive,
      reservationPreservedState,
      blockedThrowStarted,
      blockedLandingDistance,
      blockedMotionActive,
      blockedEvents,
    };
  });

  expect(result.claimA).toBe(true);
  expect(result.claimBWhileHeld).toBe(false);
  expect(result.releaseByWrongOwner).toBe(false);
  expect(result.resetOnClaim).toEqual({
    jumpState: 'Grounded',
    velocity: 0,
    attackTimer: 0,
    actionState: null,
  });
  expect(result.constraintTravel).toBeLessThan(0.001);
  expect(result.inputTravel).toBeLessThan(0.001);
  expect(result.heldAnimationState).toBe('fall');
  expect(result.throwStarted).toBe(true);
  expect(result.midpointY).toBeGreaterThan(result.heldY);
  expect(result.midpointMotionActive).toBe(true);
  expect(result.landingDistance).toBeLessThan(0.001);
  expect(result.motionAfterLanding).toBe(false);
  expect(result.controlUnlocked).toBe(true);
  expect(result.landingEvents).toEqual([{
    isPlayer: true,
    hasGame: true,
    reason: 'landed',
  }]);
  expect(result.reservationClaimed).toBe(true);
  expect(result.reservationActive).toBe(false);
  expect(result.reservationPreservedState).toBe(true);
  expect(result.blockedThrowStarted).toBe(true);
  expect(result.blockedLandingDistance).toBeLessThan(0.001);
  expect(result.blockedMotionActive).toBe(false);
  expect(result.blockedEvents).toEqual([{ hasGame: true, reason: 'blocked' }]);
});
