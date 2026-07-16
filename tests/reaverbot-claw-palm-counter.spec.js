import { expect, test } from '@playwright/test';

test('claw palm counters guard, interrupt, break, and replace the moveset without changing salvage identity', async ({ page }) => {
  await page.goto('/?reaverbotSeed=claw-palm-counter-runtime');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();

    const clearEnemies = () => {
      for (const enemy of [...game.enemies]) {
        enemy.dispose?.();
        enemy.root.removeFromParent();
      }
      game.enemies.length = 0;
    };
    const spawnClaw = (suffix, offset = new Vector3(0, 0, 3)) => {
      for (let variant = 0; variant < 200; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId: 'duelist',
          seed: `claw-palm-counter:${suffix}:${variant}`,
          position: game.player.root.position.clone().add(offset),
        });
        if (enemy.genome.modules.weapon.attackKind === 'clawMoveset') return enemy;
        const index = game.enemies.indexOf(enemy);
        if (index >= 0) game.enemies.splice(index, 1);
        enemy.dispose?.();
        enemy.root.removeFromParent();
      }
      throw new Error('Unable to generate clawMoveset enemy');
    };
    const pointClawAtPlayer = (enemy) => {
      const direction = game.player.root.position.clone().sub(enemy.root.position).setY(0).normalize();
      enemy.root.rotation.y = Math.atan2(direction.x, direction.z);
      enemy.brain.attackDirection.copy(direction);
      enemy.root.updateMatrixWorld(true);
      return direction;
    };
    const beginCounterableAttack = (enemy) => {
      enemy.brain.state = 'position';
      enemy.brain.cooldown = 0;
      const direction = pointClawAtPlayer(enemy);
      enemy._beginTelegraph(game, direction);
      enemy._updateExposureAndDefense();
      enemy._animateVisual(0.12);
      enemy.root.updateMatrixWorld(true);
      return enemy.brain.clawAttackVariant;
    };
    const hitPalm = (enemy, damage = 1) => {
      const palm = enemy.visual.weakPoint.core.getWorldPosition(new Vector3());
      const resolved = enemy.resolveProjectileHit(palm, 0.08);
      const meta = {
        source: game.player,
        playerOwnedAttack: true,
        projectileHit: true,
        directHit: true,
        knockbackDirection: enemy.root.position.clone().sub(game.player.root.position).setY(0).normalize(),
        hitPartId: resolved?.hitPartId ?? null,
        weakPointHit: Boolean(resolved?.weakPointHit),
        hitPosition: resolved?.hitPosition,
      };
      const dealt = enemy.takeDamage(damage, meta);
      return { dealt, resolved: Boolean(resolved), meta };
    };

    clearEnemies();
    const claw = spawnClaw('guard');
    claw._runtimeGame = game;
    pointClawAtPlayer(claw);
    claw.brain.state = 'position';
    claw.brain.cooldown = 0;
    const incoming = claw.root.position.clone().sub(game.player.root.position).setY(0).normalize();
    const firstMeta = {
      source: game.player,
      playerOwnedAttack: true,
      projectileHit: true,
      directHit: true,
      knockbackDirection: incoming,
    };
    const healthBeforeGuard = claw.health;
    const firstGuardHit = claw.takeDamage(5, firstMeta);
    const healthAfterFirst = claw.health;
    const blockMeta = { ...firstMeta, knockbackDirection: incoming.clone() };
    const blockedHit = claw.takeDamage(5, blockMeta);
    const stationaryAfterBlock = claw.knockback.lengthSq() === 0;
    claw._updateClawGuardState(0.2);
    const decayedGuard = claw.brain.clawGuardTimeRemaining;
    const refreshMeta = { ...firstMeta, knockbackDirection: incoming.clone() };
    claw.takeDamage(5, refreshMeta);
    const refreshedGuard = claw.brain.clawGuardTimeRemaining > decayedGuard;
    const flankMeta = {
      ...firstMeta,
      knockbackDirection: new Vector3(incoming.z, 0, -incoming.x),
    };
    const flankHit = claw.takeDamage(5, flankMeta);
    const meleeHit = claw.takeDamage(5, {
      source: game.player,
      playerOwnedAttack: true,
      directHit: true,
      attackKind: 'melee',
      knockbackDirection: incoming,
    });
    const guardSummary = {
      triggeringHitLanded: firstGuardHit > 0 && healthAfterFirst < healthBeforeGuard,
      state: claw.brain.state,
      stopped: claw.brain.moving === false && stationaryAfterBlock,
      blockedHit,
      blockFlags: blockMeta.shieldBlocked && blockMeta.damageNullified,
      refreshedGuard,
      flankBypassed: flankHit > 0,
      meleeBypassed: meleeHit > 0,
    };

    claw.brain.state = 'recovery';
    claw.brain.stateTime = 0.31;
    claw.takeDamage(1, {
      source: game.player,
      playerOwnedAttack: true,
      projectileHit: true,
      directHit: true,
      knockbackDirection: incoming,
    });
    claw._updateClawGuardState(claw.brain.clawGuardDuration + 0.01);
    guardSummary.recoveryDebtPreserved = claw.brain.state === 'recovery'
      && Math.abs(claw.brain.stateTime - 0.31) < 0.001;

    claw.health = claw.stats.maxHealth;
    const chosenVariants = [];
    const interruptResults = [];
    for (let hit = 0; hit < 3; hit += 1) {
      chosenVariants.push(beginCounterableAttack(claw));
      const attempt = claw.brain.clawAttackAttempt;
      const palmHit = hitPalm(claw);
      const acceptedHits = claw.brain.clawPalmHits;
      // A stale second resolution in the same attempt may damage the body, but
      // can never advance the three-counter break contract.
      claw.takeDamage(1, {
        source: game.player,
        playerOwnedAttack: true,
        projectileHit: true,
        directHit: true,
        hitPartId: 'clawPalm',
        weakPointHit: true,
        knockbackDirection: incoming,
      });
      interruptResults.push({
        resolved: palmHit.resolved,
        weakDamage: palmHit.dealt > 1,
        attempt,
        hitCount: claw.brain.clawPalmHits,
        acceptedOnce: claw.brain.clawPalmHits === acceptedHits,
        state: claw.brain.state,
      });
      if (!claw.brain.clawDestroyed) {
        claw._updateClawRecoilState(claw.brain.clawRecoilDuration + 0.01);
      }
    }
    const breakSummary = {
      variants: chosenVariants,
      interruptResults,
      destroyed: claw.brain.clawDestroyed,
      weakPointBroken: claw.weakPointBroken,
      brokenWeaponModuleId: claw.brokenWeaponModuleId,
      effectiveAttackKind: claw._getEffectiveAttackKind(),
      originalAttackKind: claw.genome.modules.weapon.attackKind,
      originalWeaponId: claw.genome.modules.weapon.id,
      palmTargetActive: claw.weakPointTarget.active,
      state: claw.brain.state,
      survived: !claw.dead,
      selfDamageApplied: claw.health < claw.stats.maxHealth * 0.7,
    };

    clearEnemies();
    const directRouteSummary = {};
    for (const route of ['beam', 'rail', 'drill', 'melee']) {
      const routeDistance = route === 'drill' ? 0.55 : (route === 'melee' ? 1.55 : 3);
      const routeEnemy = spawnClaw(`route-${route}`, new Vector3(0, 0, routeDistance));
      routeEnemy._runtimeGame = game;
      beginCounterableAttack(routeEnemy);
      routeEnemy.brain.clawAttackVariant = route === 'drill' || route === 'melee'
        ? 'verticalSlam'
        : 'horizontalSwipe';
      routeEnemy.brain.stateTime = routeEnemy._getStateDuration('telegraph') * 0.78;
      routeEnemy._updateExposureAndDefense();
      routeEnemy._animateVisual(0.2);
      routeEnemy.root.updateMatrixWorld(true);
      const palm = routeEnemy.visual.weakPoint.core.getWorldPosition(new Vector3());
      if (route === 'drill' || route === 'melee') {
        const desiredPalmPosition = game.player.root.position.clone()
          .add(new Vector3(0, 0, routeDistance));
        routeEnemy.root.position.add(desiredPalmPosition.sub(palm).setY(0));
        routeEnemy.root.updateMatrixWorld(true);
        routeEnemy.visual.weakPoint.core.getWorldPosition(palm);
      }
      let hitInfo = null;
      const before = routeEnemy.brain.clawPalmHits;
      if (route === 'melee') {
        const direction = palm.clone()
          .sub(game.player.root.position).setY(0).normalize();
        const profile = game.combat._getProfileForWeapon({ type: 'swordArm' });
        game.combat._meleeAttackDirection(direction, profile, {
          visual: { color: 0xbffcff, element: null },
        });
      } else if (route === 'drill') {
        const direction = palm.clone()
          .sub(game.player.root.position).setY(0).normalize();
        const profile = game.combat._getProfileForWeapon({ type: 'drillArm' });
        game.combat._damageDrillContact(direction, profile, 0.1);
      } else {
        const attackOrigin = game.player.getProjectileOrigin?.() ?? game.player.getAttackOrigin();
        const direction = palm.clone().sub(attackOrigin).normalize();
        hitInfo = routeEnemy.resolveLineHit(
          attackOrigin,
          direction,
          attackOrigin.distanceTo(palm) + 0.4,
          route === 'drill' ? 0.5 : 0.22,
        );
        routeEnemy.takeDamage(1, {
          source: game.player,
          playerOwnedAttack: true,
          directHit: true,
          attackKind: route,
          hitPartId: hitInfo?.hitPartId ?? null,
          weakPointHit: Boolean(hitInfo?.weakPointHit),
          hitPosition: hitInfo?.hitPosition,
          knockbackDirection: routeEnemy.root.position.clone()
            .sub(game.player.root.position).setY(0).normalize(),
        });
      }
      directRouteSummary[route] = (route === 'drill' || route === 'melee' || Boolean(hitInfo))
        && routeEnemy.brain.clawPalmHits === before + 1
        && routeEnemy.brain.state === 'recoil';
      clearEnemies();
    }

    const lethalClaw = spawnClaw('lethal-third', new Vector3(-2, 0, 3));
    lethalClaw._runtimeGame = game;
    for (let hit = 0; hit < 2; hit += 1) {
      beginCounterableAttack(lethalClaw);
      hitPalm(lethalClaw);
      lethalClaw._updateClawRecoilState(lethalClaw.brain.clawRecoilDuration + 0.01);
    }
    beginCounterableAttack(lethalClaw);
    lethalClaw.health = 0.01;
    const lethalThird = hitPalm(lethalClaw, 2);
    const lethalSummary = {
      dead: lethalClaw.dead,
      hitCount: lethalClaw.brain.clawPalmHits,
      destroyed: lethalClaw.brain.clawDestroyed,
      weakPointBroken: lethalClaw.weakPointBroken,
      brokenWeaponModuleId: lethalClaw.brokenWeaponModuleId,
      metaMarkedBroken: lethalThird.meta.weakPointBroken,
      effectiveAttackKind: lethalClaw._getEffectiveAttackKind(),
      originalAttackKind: lethalClaw.genome.modules.weapon.attackKind,
    };

    clearEnemies();
    const attacker = spawnClaw('attacks');
    attacker._runtimeGame = game;
    pointClawAtPlayer(attacker);
    const originalAerialPathClear = game.dungeonController.isAerialPathClear;
    game.dungeonController.isAerialPathClear = () => true;
    const originalTakeDamage = game.player.takeDamage;
    const originalTakeIncomingHit = game.player.takeIncomingHit;
    const playerHits = [];
    game.player.takeDamage = (amount, source, meta = {}) => {
      playerHits.push({ amount, attackKind: meta.attackKind });
      return amount;
    };
    game.player.takeIncomingHit = (incomingHit = {}) => {
      playerHits.push({ amount: incomingHit.amount, attackKind: incomingHit.attackKind });
      return {
        contacted: true,
        dodged: false,
        immune: false,
        healthDamage: incomingHit.amount,
      };
    };

    attacker.brain.state = 'commit';
    attacker.brain.stateTime = 0;
    attacker.brain.clawAttackVariant = 'horizontalSwipe';
    attacker.brain.attackFired = false;
    const logicalYaw = attacker.root.rotation.y;
    attacker._updateCommitState((attacker.genome.modules.weapon.horizontalCommitDuration ?? 0.52) * 0.44, game);
    attacker._animateVisual(0.016);
    const visualSpinDuringCommit = Math.abs(attacker.visual.root.rotation.y) > 0.5;
    const trail = game.hazards.find((hazard) => hazard.kind === 'clawSwipeTrail');
    const directSwipeHits = playerHits.filter((hit) => hit.attackKind === 'clawHorizontalSwipe').length;
    game._updateHazards(0.12);
    const noImmediateTrailDouble = playerHits.filter((hit) => hit.attackKind === 'clawSwipeTrail').length === 0;
    const trailStart = playerHits.length;
    if (trail) {
      const crossingAngle = 1.1;
      game.player.root.position.copy(trail.object.position).add(new Vector3(
        Math.cos(crossingAngle) * (trail.radius + 1.2),
        0,
        -Math.sin(crossingAngle) * (trail.radius + 1.2),
      ));
      game._updateHazards(0.28);
      game.player.root.position.copy(trail.object.position).add(new Vector3(
        Math.cos(crossingAngle) * trail.radius * 0.82,
        0,
        -Math.sin(crossingAngle) * trail.radius * 0.82,
      ));
      game._updateHazards(0.03);
      game._updateHazards(0.03);
    }
    const trailHits = playerHits.slice(trailStart)
      .filter((hit) => hit.attackKind === 'clawSwipeTrail').length;

    game.player.root.position.copy(attacker.root.position);
    const revealTrailObject = game.addClawSwipeTrailHazard(attacker.root.position, {
      source: attacker,
      radius: 4.55,
      duration: 0.65,
      damage: attacker.stats.damage,
    });
    const revealTrail = game.hazards.find((hazard) => hazard.object === revealTrailObject);
    const revealHitStart = playerHits.filter((hit) => hit.attackKind === 'clawSwipeTrail').length;
    game.player.root.position.copy(revealTrail.object.position)
      .add(new Vector3(-revealTrail.radius * 0.82, 0, 0));
    game._updateHazards(0.005);
    const undrawnAngleSafe = playerHits.filter((hit) => hit.attackKind === 'clawSwipeTrail').length
      === revealHitStart;
    game._updateHazards(0.48);
    const drawnAngleHit = playerHits.filter((hit) => hit.attackKind === 'clawSwipeTrail').length
      === revealHitStart + 1;

    game.player.root.position.copy(attacker.root.position);
    const gapTrailObject = game.addClawSwipeTrailHazard(attacker.root.position, {
      source: attacker,
      radius: 4.55,
      duration: 0.65,
      damage: attacker.stats.damage,
    });
    const gapTrail = game.hazards.find((hazard) => hazard.object === gapTrailObject);
    game._updateHazards(0.5);
    const firstRibbon = gapTrail.object.children[0];
    const firstBandStart = firstRibbon.userData.collisionRadius
      - firstRibbon.userData.collisionHalfWidth
      - (game.player.radius ?? 0.42);
    const gapDistance = (gapTrail.innerRadius + firstBandStart) * 0.5;
    const gapHitStart = playerHits.filter((hit) => hit.attackKind === 'clawSwipeTrail').length;
    game.player.root.position.copy(gapTrail.object.position).add(new Vector3(
      Math.cos(1.1) * gapDistance,
      0,
      -Math.sin(1.1) * gapDistance,
    ));
    game._updateHazards(0.02);
    const ribbonGapSafe = !gapTrail.consumed
      && playerHits.filter((hit) => hit.attackKind === 'clawSwipeTrail').length === gapHitStart;

    game.dungeonController.isAerialPathClear = () => false;
    game.player.root.position.copy(attacker.root.position).add(new Vector3(0, 0, 3));
    const wallDirectStart = playerHits.filter((hit) => hit.attackKind === 'clawHorizontalSwipe').length;
    attacker._performClawHorizontalSwipe(game);
    const wallBlockedDirect = playerHits.filter((hit) => hit.attackKind === 'clawHorizontalSwipe').length
      === wallDirectStart;
    const wallTrail = [...game.hazards].reverse()
      .find((hazard) => hazard.kind === 'clawSwipeTrail');
    const wallTrailStart = playerHits.filter((hit) => hit.attackKind === 'clawSwipeTrail').length;
    game.player.root.position.copy(wallTrail.object.position).add(new Vector3(wallTrail.radius + 1, 0, 0));
    game._updateHazards(0.02);
    game.player.root.position.copy(wallTrail.object.position).add(new Vector3(wallTrail.radius * 0.82, 0, 0));
    game._updateHazards(0.45);
    const wallBlockedTrail = !wallTrail.consumed
      && playerHits.filter((hit) => hit.attackKind === 'clawSwipeTrail').length === wallTrailStart;
    game.dungeonController.isAerialPathClear = originalAerialPathClear;

    game.player.takeDamage = originalTakeDamage;
    game.player.takeIncomingHit = originalTakeIncomingHit;
    game.player.health = game.player.stats.maxHealth;
    const dodgeCrossingAngle = 1.1;
    const dodgeRadius = 4.55;
    const dodgeInnerRadius = dodgeRadius * 0.62;
    const dodgeMiddleRibbonRadius = dodgeInnerRadius + (dodgeRadius - dodgeInnerRadius) * (2 / 3);
    game.player.root.position.copy(attacker.root.position).add(new Vector3(
      Math.cos(dodgeCrossingAngle) * dodgeMiddleRibbonRadius,
      0,
      -Math.sin(dodgeCrossingAngle) * dodgeMiddleRibbonRadius,
    ));
    const dodgeTrailObject = game.addClawSwipeTrailHazard(attacker.root.position, {
      source: attacker,
      radius: dodgeRadius,
      duration: 0.65,
      damage: attacker.stats.damage,
    });
    const dodgeTrail = game.hazards.find((hazard) => hazard.object === dodgeTrailObject);
    const previousActionState = game.player.animation.actionState;
    game.player.animation.actionState = 'dodgeRoll';
    const dodgeHealth = game.player.health;
    game._updateHazards(0.3);
    const dodgeConsumed = dodgeTrail.consumed && game.player.health === dodgeHealth;
    game._updateHazards(0.02);
    const dodgeDidNotRetry = game.player.health === dodgeHealth;
    game.player.animation.actionState = previousActionState;

    attacker._updateCommitState(1, game);
    attacker._animateVisual(0.016);
    const horizontalSummary = {
      directSwipeHits,
      noImmediateTrailDouble,
      trailExists: Boolean(trail),
      ribbonCount: trail?.object.children.length ?? 0,
      trailHits,
      undrawnAngleSafe,
      drawnAngleHit,
      ribbonGapSafe,
      wallBlockedDirect,
      wallBlockedTrail,
      dodgeConsumed,
      dodgeDidNotRetry,
      visualSpinDuringCommit,
      logicalYawUnchanged: Math.abs(attacker.root.rotation.y - logicalYaw) < 0.0001,
      visualYawReturned: Math.abs(attacker.visual.root.rotation.y) < 0.0001,
    };

    for (const hazard of [...game.hazards]) {
      hazard.object.removeFromParent();
      game._disposeTimedEffectObject(hazard.object);
    }
    game.hazards.length = 0;
    const explosions = [];
    const originalAddExplosion = game.addExplosion;
    game.addExplosion = (position, damage, radius, color, meta = {}) => {
      explosions.push({ position: position.clone(), damage, radius, color, meta });
    };
    attacker.brain.state = 'commit';
    attacker.brain.stateTime = 0;
    attacker.brain.clawAttackVariant = 'verticalSlam';
    attacker.brain.attackFired = false;
    attacker._updateCommitState((attacker.genome.modules.weapon.slamCommitDuration ?? 0.58) * 0.56, game);
    const slam = explosions.find((entry) => entry.meta.attackKind === 'clawGroundSlam');
    const expectedSurface = game.dungeonController?.getSurfaceElevationAt?.(slam?.position)
      ?? attacker.root.position.y;
    const verticalSummary = {
      count: explosions.length,
      radius: slam?.radius ?? 0,
      damageScale: slam ? slam.damage / attacker.stats.damage : 0,
      powerful: Boolean(slam?.meta.powerfulKnockback),
      groundProjected: slam ? Math.abs(slam.position.y - (expectedSurface + 0.06)) < 0.08 : false,
    };
    game.addExplosion = originalAddExplosion;
    game.player.takeDamage = originalTakeDamage;
    game.player.takeIncomingHit = originalTakeIncomingHit;

    const disposalTrail = game.addClawSwipeTrailHazard(attacker.root.position, {
      source: attacker,
      radius: 4.55,
      duration: 0.65,
      damage: 1,
    });
    let disposedTrailResources = 0;
    for (const ribbon of disposalTrail.children) {
      const disposeGeometry = ribbon.geometry.dispose.bind(ribbon.geometry);
      ribbon.geometry.dispose = () => {
        disposedTrailResources += 1;
        disposeGeometry();
      };
      const disposeMaterial = ribbon.material.dispose.bind(ribbon.material);
      ribbon.material.dispose = () => {
        disposedTrailResources += 1;
        disposeMaterial();
      };
    }
    game._clearDungeonRunState();
    const disposalSummary = {
      disposedTrailResources,
      hazardsCleared: game.hazards.length === 0,
      detached: !disposalTrail.parent,
    };

    return {
      guardSummary,
      breakSummary,
      directRouteSummary,
      lethalSummary,
      horizontalSummary,
      verticalSummary,
      disposalSummary,
    };
  });

  expect(result.guardSummary.triggeringHitLanded).toBe(true);
  expect(result.guardSummary.state).toBe('guard');
  expect(result.guardSummary.stopped).toBe(true);
  expect(result.guardSummary.blockedHit).toBe(0);
  expect(result.guardSummary.blockFlags).toBe(true);
  expect(result.guardSummary.refreshedGuard).toBe(true);
  expect(result.guardSummary.flankBypassed).toBe(true);
  expect(result.guardSummary.meleeBypassed).toBe(true);
  expect(result.guardSummary.recoveryDebtPreserved).toBe(true);

  expect(result.breakSummary.variants).toHaveLength(3);
  expect(result.breakSummary.variants.every((variant) => (
    variant === 'horizontalSwipe' || variant === 'verticalSlam'
  ))).toBe(true);
  expect(result.breakSummary.interruptResults.every((entry) => (
    entry.resolved && entry.weakDamage && entry.acceptedOnce
  ))).toBe(true);
  expect(result.breakSummary.interruptResults.slice(0, 2).every((entry) => entry.state === 'recoil')).toBe(true);
  expect(result.breakSummary.destroyed).toBe(true);
  expect(result.breakSummary.weakPointBroken).toBe(true);
  expect(result.breakSummary.brokenWeaponModuleId).toBe('clawArm');
  expect(result.breakSummary.effectiveAttackKind).toBe('charge');
  expect(result.breakSummary.originalAttackKind).toBe('clawMoveset');
  expect(result.breakSummary.originalWeaponId).toBe('clawArm');
  expect(result.breakSummary.palmTargetActive).toBe(false);
  expect(result.breakSummary.state).toBe('position');
  expect(result.breakSummary.survived).toBe(true);
  expect(result.breakSummary.selfDamageApplied).toBe(true);

  expect(result.directRouteSummary).toEqual({
    beam: true,
    rail: true,
    drill: true,
    melee: true,
  });
  expect(result.lethalSummary.dead).toBe(true);
  expect(result.lethalSummary.hitCount).toBe(3);
  expect(result.lethalSummary.destroyed).toBe(true);
  expect(result.lethalSummary.weakPointBroken).toBe(true);
  expect(result.lethalSummary.brokenWeaponModuleId).toBe('clawArm');
  expect(result.lethalSummary.metaMarkedBroken).toBe(true);
  expect(result.lethalSummary.effectiveAttackKind).toBe('charge');
  expect(result.lethalSummary.originalAttackKind).toBe('clawMoveset');

  expect(result.horizontalSummary.directSwipeHits).toBe(1);
  expect(result.horizontalSummary.noImmediateTrailDouble).toBe(true);
  expect(result.horizontalSummary.trailExists).toBe(true);
  expect(result.horizontalSummary.ribbonCount).toBe(3);
  expect(result.horizontalSummary.trailHits).toBe(1);
  expect(result.horizontalSummary.undrawnAngleSafe).toBe(true);
  expect(result.horizontalSummary.drawnAngleHit).toBe(true);
  expect(result.horizontalSummary.ribbonGapSafe).toBe(true);
  expect(result.horizontalSummary.wallBlockedDirect).toBe(true);
  expect(result.horizontalSummary.wallBlockedTrail).toBe(true);
  expect(result.horizontalSummary.dodgeConsumed).toBe(true);
  expect(result.horizontalSummary.dodgeDidNotRetry).toBe(true);
  expect(result.horizontalSummary.visualSpinDuringCommit).toBe(true);
  expect(result.horizontalSummary.logicalYawUnchanged).toBe(true);
  expect(result.horizontalSummary.visualYawReturned).toBe(true);

  expect(result.verticalSummary.count).toBe(1);
  expect(result.verticalSummary.radius).toBeCloseTo(2.65, 2);
  expect(result.verticalSummary.damageScale).toBeCloseTo(1.15, 2);
  expect(result.verticalSummary.powerful).toBe(true);
  expect(result.verticalSummary.groundProjected).toBe(true);
  expect(result.disposalSummary.disposedTrailResources).toBe(6);
  expect(result.disposalSummary.hazardsCleared).toBe(true);
  expect(result.disposalSummary.detached).toBe(true);
});
