import { expect, test } from '@playwright/test';

test('player hits weaponize aerial self-detonators with a safe fall, re-vector, and recovery', async ({ page }) => {
  await page.goto('/?reaverbotSeed=weaponized-detonator-motion-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();
    game.projectiles.clear();

    const clearEnemies = () => {
      for (const enemy of [...game.enemies]) {
        enemy.dispose?.();
        enemy.root.removeFromParent();
      }
      game.enemies.length = 0;
      game.enemyAttackDirector.owner = null;
      game.enemyAttackDirector.queue = [];
      game.enemyAttackDirector.requestTimes.clear();
      game.enemyAttackDirector.handoffTimer = 0;
    };
    const findEnemy = (archetypeId, attackKind, position) => {
      for (let variant = 0; variant < 180; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId,
          seed: `detonator-motion:${archetypeId}:${attackKind}:${variant}`,
          position,
        });
        if (enemy.genome.modules.weapon.attackKind === attackKind) return enemy;
        game.enemies.splice(game.enemies.indexOf(enemy), 1);
        enemy.dispose?.();
        enemy.root.removeFromParent();
      }
      throw new Error(`Could not generate ${archetypeId}/${attackKind}`);
    };

    clearEnemies();
    const dungeon = game.dungeonController;
    const originalSurface = dungeon.getSurfaceElevationAt;
    const originalWalkable = dungeon.isPositionWalkable;
    const originalAerialClear = dungeon.isAerialPositionClear;
    const originalArenaTarget = dungeon.getEnemyArenaTarget;
    const floorY = game.player.root.position.y;
    const walkableProbes = [];
    dungeon.getSurfaceElevationAt = () => floorY;
    dungeon.isPositionWalkable = (position) => {
      walkableProbes.push(position.clone());
      return true;
    };
    dungeon.isAerialPositionClear = () => true;
    dungeon.getEnemyArenaTarget = (enemy, position, out = new Vector3()) => out.copy(position);

    const originalPlayerPosition = game.player.root.position.clone();
    game.player.root.position.copy(originalPlayerPosition);
    const origin = originalPlayerPosition.clone().add(new Vector3(0, 0.45, 3.2));
    const flyer = findEnemy('aerialBomber', 'selfDestruct', origin);
    const baseVisualHover = flyer.visual.root.userData.baseHoverHeight
      ?? flyer.visual.root.position.y;
    flyer.brain.state = 'telegraph';
    flyer._createTelegraphMarker(game, 3, flyer.genome.palette.emissive);
    game.enemyAttackDirector.owner = flyer;
    game.enemyAttackDirector.requestTimes.set(flyer, 0);

    const dealt = game.damageEnemy(flyer, 1, {
      source: game.player,
      playerOwnedAttack: true,
      projectileHit: true,
      unblockable: true,
      armorPierce: 999,
      knockbackDirection: new Vector3(0, 0, 1),
      hitPosition: flyer.root.position.clone(),
    });
    const firstMotion = flyer.brain.detonatorKnockback;
    if (!firstMotion) {
      throw new Error(JSON.stringify({
        weaponizable: flyer._isWeaponizableSelfDetonator(),
        navigationMode: flyer.navigationMode,
        attackKind: flyer.genome.modules.weapon.attackKind,
        tags: flyer.genome.modules.weapon.tags,
        dealt,
        dead: flyer.dead,
        runtimeGame: flyer._runtimeGame === game,
      }));
    }
    const firstLandingVector = firstMotion.landingPosition.clone().sub(origin).setY(0);
    const launchSummary = {
      dealt,
      redirectedByPlayer: firstMotion.redirectedByPlayer,
      directionDot: firstLandingVector.normalize().dot(new Vector3(0, 0, 1)),
      markerRemoved: flyer.brain.telegraphMarker === null,
      leaseReleased: game.enemyAttackDirector.owner !== flyer,
      externalMotionActive: flyer.isExternalMotionActive(),
      ignoresGroundConstraint: flyer.shouldIgnoreGroundConstraint(),
      walkableLanding: dungeon.isPositionWalkable(firstMotion.landingPosition),
    };

    let maximumRoll = 0;
    let minimumVisualHeight = Infinity;
    let groundedSnapshot = null;
    for (let frame = 0; frame < 180 && flyer.brain.detonatorKnockback; frame += 1) {
      flyer.update(1 / 60, game);
      maximumRoll = Math.max(maximumRoll, Math.abs(flyer.visual.root.rotation.z));
      minimumVisualHeight = Math.min(minimumVisualHeight, flyer.visual.root.position.y);
      if (!groundedSnapshot && flyer.brain.detonatorKnockback?.phase === 'grounded') {
        groundedSnapshot = {
          rootY: flyer.root.position.y,
          visualY: flyer.visual.root.position.y,
          roll: Math.abs(flyer.visual.root.rotation.z),
          phaseTime: flyer.brain.detonatorKnockback.phaseTime,
        };
      }
    }
    const recoverySummary = {
      groundedSnapshot,
      maximumRoll,
      minimumVisualHeight,
      motionFinished: flyer.brain.detonatorKnockback === null,
      state: flyer.brain.state,
      visualHoverError: Math.abs(flyer.visual.root.position.y - baseVisualHover),
      visualRollError: Math.abs(flyer.visual.root.rotation.z),
      cooldown: flyer.brain.cooldown,
    };

    // A second player hit replaces the in-flight vector instead of stacking a
    // generic force or waiting for the first fall to finish.
    game.player.root.position.set(flyer.root.position.x, floorY, flyer.root.position.z - 5);
    game.damageEnemy(flyer, 1, {
      source: game.player,
      playerOwnedAttack: true,
      directHit: true,
      unblockable: true,
      armorPierce: 999,
      knockbackDirection: new Vector3(0, 0, 1),
    });
    flyer.update(0.08, game);
    game.player.root.position.set(flyer.root.position.x - 5, floorY, flyer.root.position.z);
    game.damageEnemy(flyer, 1, {
      source: game.player,
      playerOwnedAttack: true,
      projectileHit: true,
      unblockable: true,
      armorPierce: 999,
      knockbackDirection: new Vector3(1, 0, 0),
    });
    const redirectedMotion = flyer.brain.detonatorKnockback;
    const redirectedTravel = redirectedMotion.landingPosition.clone()
      .sub(redirectedMotion.startPosition)
      .setY(0)
      .normalize();
    const redirectSummary = {
      redirectCount: redirectedMotion.redirectCount,
      directionDot: redirectedMotion.launchDirection.dot(new Vector3(1, 0, 0)),
      travelDot: redirectedTravel.dot(new Vector3(1, 0, 0)),
    };

    const lethalFlyer = findEnemy(
      'aerialBomber',
      'selfDestruct',
      origin.clone().add(new Vector3(5, 0, 0)),
    );
    const lethalHealthBefore = lethalFlyer.health;
    const lethalDealt = game.damageEnemy(lethalFlyer, lethalFlyer.stats.maxHealth * 100, {
      source: game.player,
      playerOwnedAttack: true,
      projectileHit: true,
      unblockable: true,
      armorPierce: 999,
      knockbackDirection: new Vector3(1, 0, 0),
    });
    const lethalHitSummary = {
      dealt: lethalDealt,
      healthBefore: lethalHealthBefore,
      healthAfter: lethalFlyer.health,
      survived: !lethalFlyer.dead,
      weaponized: lethalFlyer.brain.detonatorKnockback?.redirectedByPlayer === true,
    };

    const statusFlyer = findEnemy(
      'aerialBomber',
      'selfDestruct',
      origin.clone().add(new Vector3(7, 0, 0)),
    );
    game.damageEnemy(statusFlyer, 1, {
      source: game.player,
      playerOwnedAttack: true,
      statusTick: true,
      unblockable: true,
      armorPierce: 999,
      knockbackDirection: new Vector3(1, 0, 0),
    });
    const statusIgnored = statusFlyer.brain.detonatorKnockback === null;

    const bossFlaggedFlyer = findEnemy(
      'aerialBomber',
      'selfDestruct',
      origin.clone().add(new Vector3(9, 0, 0)),
    );
    bossFlaggedFlyer.isBoss = true;
    game.damageEnemy(bossFlaggedFlyer, 1, {
      source: game.player,
      playerOwnedAttack: true,
      projectileHit: true,
      unblockable: true,
      armorPierce: 999,
      knockbackDirection: new Vector3(1, 0, 0),
    });
    const bossIgnored = bossFlaggedFlyer.brain.detonatorKnockback === null;

    dungeon.getSurfaceElevationAt = originalSurface;
    dungeon.isPositionWalkable = originalWalkable;
    dungeon.isAerialPositionClear = originalAerialClear;
    dungeon.getEnemyArenaTarget = originalArenaTarget;
    game.player.root.position.copy(originalPlayerPosition);
    clearEnemies();

    return {
      launchSummary,
      recoverySummary,
      redirectSummary,
      lethalHitSummary,
      statusIgnored,
      bossIgnored,
      walkableProbeCount: walkableProbes.length,
    };
  });

  expect(result.launchSummary.dealt).toBeGreaterThan(0);
  expect(result.launchSummary.redirectedByPlayer).toBe(true);
  expect(result.launchSummary.directionDot).toBeGreaterThan(0.9);
  expect(result.launchSummary.markerRemoved).toBe(true);
  expect(result.launchSummary.leaseReleased).toBe(true);
  expect(result.launchSummary.externalMotionActive).toBe(true);
  expect(result.launchSummary.ignoresGroundConstraint).toBe(true);
  expect(result.launchSummary.walkableLanding).toBe(true);
  expect(result.walkableProbeCount).toBeGreaterThan(1);

  expect(result.recoverySummary.groundedSnapshot).not.toBeNull();
  expect(result.recoverySummary.groundedSnapshot.rootY).toBeCloseTo(0, 5);
  expect(result.recoverySummary.groundedSnapshot.visualY).toBeLessThan(0.2);
  expect(result.recoverySummary.groundedSnapshot.roll).toBeGreaterThan(3);
  expect(result.recoverySummary.maximumRoll).toBeGreaterThan(3);
  expect(result.recoverySummary.minimumVisualHeight).toBeLessThan(0.2);
  expect(result.recoverySummary.motionFinished).toBe(true);
  expect(result.recoverySummary.state).toBe('position');
  expect(result.recoverySummary.visualHoverError).toBeLessThan(0.0001);
  expect(result.recoverySummary.visualRollError).toBeLessThan(0.0001);
  expect(result.recoverySummary.cooldown).toBeGreaterThan(0);

  expect(result.redirectSummary.redirectCount).toBe(2);
  expect(result.redirectSummary.directionDot).toBeGreaterThan(0.99);
  expect(result.redirectSummary.travelDot).toBeGreaterThan(0.9);
  expect(result.lethalHitSummary.dealt).toBeGreaterThan(0);
  expect(result.lethalHitSummary.dealt).toBeLessThan(result.lethalHitSummary.healthBefore);
  expect(result.lethalHitSummary.healthAfter).toBeGreaterThan(0);
  expect(result.lethalHitSummary.survived).toBe(true);
  expect(result.lethalHitSummary.weaponized).toBe(true);
  expect(result.statusIgnored).toBe(true);
  expect(result.bossIgnored).toBe(true);
});

test('launched detonators use swept contact, friendly fire, player contact, and boss absorption exactly once', async ({ page }) => {
  await page.goto('/?reaverbotSeed=weaponized-detonator-impact-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();
    game.projectiles.clear();
    const clearEnemies = () => {
      for (const enemy of [...game.enemies]) {
        enemy.dispose?.();
        enemy.root.removeFromParent();
      }
      game.enemies.length = 0;
    };
    const findEnemy = (archetypeId, attackKind, position, seedLabel) => {
      for (let variant = 0; variant < 180; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId,
          seed: `${seedLabel}:${variant}`,
          position,
        });
        if (enemy.genome.modules.weapon.attackKind === attackKind) return enemy;
        game.enemies.splice(game.enemies.indexOf(enemy), 1);
        enemy.dispose?.();
        enemy.root.removeFromParent();
      }
      throw new Error(`Could not generate ${archetypeId}/${attackKind}`);
    };

    clearEnemies();
    const dungeon = game.dungeonController;
    const originalSurface = dungeon.getSurfaceElevationAt;
    const originalWalkable = dungeon.isPositionWalkable;
    const originalAerialClear = dungeon.isAerialPositionClear;
    const originalArenaTarget = dungeon.getEnemyArenaTarget;
    const originalAddExplosion = game.addExplosion;
    const originalPlayerPosition = game.player.root.position.clone();
    const floorY = originalPlayerPosition.y;
    dungeon.getSurfaceElevationAt = () => floorY;
    dungeon.isPositionWalkable = () => true;
    dungeon.isAerialPositionClear = () => true;
    dungeon.getEnemyArenaTarget = (enemy, position, out = new Vector3()) => out.copy(position);

    const spawnImpactPair = (label, lateralBystander = false) => {
      const playerPosition = originalPlayerPosition.clone();
      game.player.root.position.copy(playerPosition);
      const origin = playerPosition.clone().add(new Vector3(0, 0.45, 3));
      const flyer = findEnemy('aerialBomber', 'selfDestruct', origin, `${label}:detonator`);
      const target = findEnemy(
        'pursuer',
        'charge',
        origin.clone().add(new Vector3(0, -0.45, 2.45)),
        `${label}:target`,
      );
      target.radius = Math.max(target.radius, 0.8);
      target.collisionHeight = Math.max(target.collisionHeight, 3.4);
      const bystander = lateralBystander
        ? findEnemy(
          'pursuer',
          'charge',
          target.root.position.clone().add(new Vector3(2.15, 0, 0)),
          `${label}:bystander`,
        )
        : null;
      return { flyer, target, bystander };
    };

    let weaponizedExplosionCount = 0;
    const weaponizedExplosionMeta = [];
    game.addExplosion = (position, damage, radius, color, meta = {}) => {
      if (meta.attackKind === 'weaponizedDetonator') {
        weaponizedExplosionCount += 1;
        weaponizedExplosionMeta.push({
          damageEnemies: meta.damageEnemies,
          damagePlayer: meta.damagePlayer,
          suppressRewards: meta.suppressRewards,
          excludedEnemyIds: [...(meta.excludedEnemyIds ?? [])],
        });
      }
      return originalAddExplosion.call(game, position, damage, radius, color, meta);
    };

    const friendly = spawnImpactPair('friendly-fire');
    friendly.target.health = 1;
    const experienceBefore = game.player.experience;
    game.damageEnemy(friendly.flyer, 1, {
      source: game.player,
      playerOwnedAttack: true,
      projectileHit: true,
      unblockable: true,
      armorPierce: 999,
      knockbackDirection: new Vector3(0, 0, 1),
    });
    friendly.flyer.update(0.7, game);
    const friendlySummary = {
      flyerDead: friendly.flyer.dead,
      targetDead: friendly.target.dead,
      experienceGain: game.player.experience - experienceBefore,
      explosionCount: weaponizedExplosionCount,
      explosionMeta: weaponizedExplosionMeta[0],
    };

    clearEnemies();
    weaponizedExplosionCount = 0;
    weaponizedExplosionMeta.length = 0;
    const shield = spawnImpactPair('shield-absorption', true);
    const shieldHealthBefore = shield.target.health;
    const bystanderHealthBefore = shield.bystander.health;
    let callbackStateLive = false;
    let callbackImpact = null;
    shield.target.onWeaponizedDetonatorImpact = (detonator, callbackGame, impact) => {
      callbackStateLive = detonator.brain.detonatorKnockback?.redirectedByPlayer === true;
      callbackImpact = {
        gameMatched: callbackGame === game,
        hasPosition: Boolean(impact.position?.isVector3),
        hasDirection: Boolean(impact.direction?.isVector3),
        damage: impact.damage,
        radius: impact.radius,
      };
      return { absorbed: true };
    };
    game.damageEnemy(shield.flyer, 1, {
      source: game.player,
      playerOwnedAttack: true,
      projectileHit: true,
      unblockable: true,
      armorPierce: 999,
      knockbackDirection: new Vector3(0, 0, 1),
    });
    shield.flyer.update(0.7, game);
    const shieldSummary = {
      flyerDead: shield.flyer.dead,
      shieldDamage: shieldHealthBefore - shield.target.health,
      bystanderDamage: bystanderHealthBefore - shield.bystander.health,
      callbackStateLive,
      callbackImpact,
      explosionCount: weaponizedExplosionCount,
      excludedShield: weaponizedExplosionMeta[0]?.excludedEnemyIds.includes(shield.target.id),
      excludedSelf: weaponizedExplosionMeta[0]?.excludedEnemyIds.includes(shield.flyer.id),
    };

    clearEnemies();
    weaponizedExplosionCount = 0;
    weaponizedExplosionMeta.length = 0;
    const playerPair = spawnImpactPair('player-contact');
    game.enemies.splice(game.enemies.indexOf(playerPair.target), 1);
    playerPair.target.dispose?.();
    playerPair.target.root.removeFromParent();
    let playerDamage = 0;
    const originalPlayerTakeDamage = game.player.takeDamage;
    game.player.takeDamage = (amount) => {
      playerDamage += amount;
      return amount;
    };
    game.damageEnemy(playerPair.flyer, 1, {
      source: game.player,
      playerOwnedAttack: true,
      projectileHit: true,
      unblockable: true,
      armorPierce: 999,
      knockbackDirection: new Vector3(0, 0, 1),
    });
    game.player.root.position.copy(playerPair.flyer.root.position).add(new Vector3(0, -0.45, 2.45));
    playerPair.flyer.update(0.7, game);
    game.player.takeDamage = originalPlayerTakeDamage;
    const playerSummary = {
      flyerDead: playerPair.flyer.dead,
      playerDamage,
      explosionCount: weaponizedExplosionCount,
    };

    clearEnemies();
    const overlapFlyer = findEnemy(
      'aerialBomber',
      'selfDestruct',
      originalPlayerPosition.clone().add(new Vector3(0, 0.05, 0)),
      'player-overlap-grace',
    );
    game.player.root.position.copy(originalPlayerPosition);
    game.damageEnemy(overlapFlyer, 1, {
      source: game.player,
      playerOwnedAttack: true,
      projectileHit: true,
      unblockable: true,
      armorPierce: 999,
      knockbackDirection: new Vector3(0, 0, 1),
    });
    const overlapGraceStarted = overlapFlyer.brain.detonatorKnockback?.playerCollisionArmed === false;
    overlapFlyer.update(0.05, game);
    const survivedInitialOverlap = !overlapFlyer.dead;

    game.addExplosion = originalAddExplosion;
    dungeon.getSurfaceElevationAt = originalSurface;
    dungeon.isPositionWalkable = originalWalkable;
    dungeon.isAerialPositionClear = originalAerialClear;
    dungeon.getEnemyArenaTarget = originalArenaTarget;
    game.player.root.position.copy(originalPlayerPosition);
    clearEnemies();
    return {
      friendlySummary,
      shieldSummary,
      playerSummary,
      overlapGraceStarted,
      survivedInitialOverlap,
    };
  });

  expect(result.friendlySummary.flyerDead).toBe(true);
  expect(result.friendlySummary.targetDead).toBe(true);
  expect(result.friendlySummary.experienceGain).toBe(0);
  expect(result.friendlySummary.explosionCount).toBe(1);
  expect(result.friendlySummary.explosionMeta).toMatchObject({
    damageEnemies: true,
    damagePlayer: true,
    suppressRewards: true,
  });

  expect(result.shieldSummary.flyerDead).toBe(true);
  expect(result.shieldSummary.shieldDamage).toBe(0);
  expect(result.shieldSummary.bystanderDamage).toBeGreaterThan(0);
  expect(result.shieldSummary.callbackStateLive).toBe(true);
  expect(result.shieldSummary.callbackImpact).toMatchObject({
    gameMatched: true,
    hasPosition: true,
    hasDirection: true,
  });
  expect(result.shieldSummary.callbackImpact.damage).toBeGreaterThan(0);
  expect(result.shieldSummary.callbackImpact.radius).toBeGreaterThan(2);
  expect(result.shieldSummary.explosionCount).toBe(1);
  expect(result.shieldSummary.excludedShield).toBe(true);
  expect(result.shieldSummary.excludedSelf).toBe(true);

  expect(result.playerSummary.flyerDead).toBe(true);
  expect(result.playerSummary.playerDamage).toBeGreaterThan(0);
  expect(result.playerSummary.explosionCount).toBe(1);
  expect(result.overlapGraceStarted).toBe(true);
  expect(result.survivedInitialOverlap).toBe(true);
});
