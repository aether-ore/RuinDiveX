import { expect, test } from '@playwright/test';

test('generated defense modules use three eligible hits, independent weak-point rupture, and an exact stun', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&reaverbotSeed=defense-break-runtime');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();
    game.projectiles.clear();
    const originalSafeZone = game.dungeonController.isPlayerInSafeZone;
    game.dungeonController.isPlayerInSafeZone = () => false;

    const removeEnemy = (enemy) => {
      if (!enemy) return;
      const index = game.enemies.indexOf(enemy);
      if (index >= 0) game.enemies.splice(index, 1);
      enemy.dispose?.();
      enemy.root?.removeFromParent?.();
    };
    for (const enemy of [...game.enemies]) removeEnemy(enemy);

    const spawnDirectionalShield = (label, elite = false) => {
      for (let variant = 0; variant < 300; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId: 'shieldSentinel',
          seed: `${label}:${variant}`,
          elite,
          position: game.player.root.position.clone().add(new Vector3(0, 0, 5)),
        });
        if (enemy.genome.modules.defense?.id === 'directionalShield'
          && enemy.genome.modules.weakPoint.id !== 'eyeLens') {
          enemy._runtimeGame = game;
          enemy.root.rotation.y = 0;
          enemy.brain.state = 'position';
          enemy.brain.defenseActive = true;
          enemy.brain.weakPointExposed = false;
          enemy.root.updateMatrixWorld(true);
          return enemy;
        }
        removeEnemy(enemy);
      }
      throw new Error(`Unable to generate a directional shield for ${label}`);
    };
    const spawnMitigatingDefense = (label) => {
      for (let variant = 0; variant < 300; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId: 'shieldSentinel',
          seed: `${label}:${variant}`,
          position: game.player.root.position.clone().add(new Vector3(0, 0, 5)),
        });
        const defense = enemy.genome.modules.defense;
        if (defense && defense.directMultiplier > 0 && defense.directMultiplier < 1) {
          enemy._runtimeGame = game;
          enemy.root.rotation.y = 0;
          enemy.brain.state = 'position';
          enemy.brain.defenseActive = true;
          enemy.brain.weakPointExposed = false;
          enemy.root.updateMatrixWorld(true);
          return enemy;
        }
        removeEnemy(enemy);
      }
      throw new Error(`Unable to generate a mitigating defense for ${label}`);
    };
    const spawnClaw = () => {
      for (let variant = 0; variant < 300; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId: 'duelist',
          seed: `defense-break-claw:${variant}`,
          position: game.player.root.position.clone().add(new Vector3(0, 0, 5)),
        });
        if (enemy.genome.modules.weapon.id === 'clawArm') {
          enemy._runtimeGame = game;
          enemy.root.rotation.y = 0;
          enemy.brain.state = 'guard';
          enemy.brain.clawGuardTimeRemaining = enemy.brain.clawGuardDuration;
          return enemy;
        }
        removeEnemy(enemy);
      }
      throw new Error('Unable to generate a claw carrier');
    };
    const directMeta = (overrides = {}) => ({
      source: game.player,
      playerOwnedAttack: true,
      projectileHit: true,
      directHit: true,
      knockbackDirection: new Vector3(0, 0, -1),
      ...overrides,
    });
    const hitDefense = (enemy, overrides = {}, amount = 10) => {
      enemy.brain.defenseActive = true;
      const meta = directMeta(overrides);
      const dealt = enemy.takeDamage(amount, meta);
      return { dealt, meta };
    };
    const ruptureWeakPoint = (enemy) => {
      enemy.brain.weakPointExposed = true;
      enemy.weakPointDamage = enemy.stats.maxHealth * 0.32 - 0.1;
      const meta = directMeta({
        hitPartId: enemy.genome.modules.weakPoint.id,
        weakPointHit: true,
        armorPierce: Number.POSITIVE_INFINITY,
        unblockable: true,
      });
      enemy.takeDamage(1, meta);
      return meta;
    };

    const normal = spawnDirectionalShield('defense-break-normal');
    normal.brain.state = 'telegraph';
    normal._createTelegraphMarker(game, 0.8);
    game.requestEnemyAttack(normal);
    const first = hitDefense(normal);
    const firstState = {
      count: normal.defenseHitCount,
      broken: normal.defenseBroken,
      remaining: first.meta.defenseHitsRemaining,
      registered: first.meta.defenseHitRegistered,
      blocked: first.meta.shieldBlocked,
    };
    const second = hitDefense(normal);
    const secondState = {
      count: normal.defenseHitCount,
      broken: normal.defenseBroken,
      remaining: second.meta.defenseHitsRemaining,
      registered: second.meta.defenseHitRegistered,
      blocked: second.meta.shieldBlocked,
    };
    const healthBeforeThird = normal.health;
    const third = hitDefense(normal);
    const breakEffect = game.timedEffects.find((effect) => (
      effect.kind === 'reaverbotDefenseParts'
    ));
    const thirdState = {
      count: normal.defenseHitCount,
      broken: normal.defenseBroken,
      disabled: normal.defenseDisabled,
      remaining: third.meta.defenseHitsRemaining,
      metaBroken: third.meta.defenseBroken,
      blocked: third.meta.shieldBlocked,
      damage: healthBeforeThird - normal.health,
      weakPointBroken: normal.weakPointBroken,
      weakPointExposed: normal.brain.weakPointExposed,
      targetActive: normal.weakPointTarget.active,
      defenseVisible: normal.visual.defense.group.visible,
      state: normal.brain.state,
      moving: normal.brain.moving,
      markerRemoved: !normal.brain.telegraphMarker,
      leaseReleased: game.enemyAttackDirector.owner !== normal,
      stunDuration: normal.statusEffects.stagger.duration,
      debrisParts: breakEffect?.parts.length ?? 0,
    };
    const postBreak = directMeta();
    const postBreakDamage = normal.takeDamage(10, postBreak);

    normal.knockback.set(0, 0, 0);
    const rootBeforeStun = normal.root.position.clone();
    normal.update(1.99, game);
    const duringStun = {
      duration: normal.statusEffects.stagger.duration,
      controlLocked: normal._isControlLocked(),
      positionDrift: normal.root.position.distanceTo(rootBeforeStun),
      moving: normal.brain.moving,
    };
    normal.update(0.02, game);
    const afterStun = {
      duration: normal.statusEffects.stagger.duration,
      controlLocked: normal._isControlLocked(),
    };
    const postDefenseWeakMeta = ruptureWeakPoint(normal);
    const defenseThenWeakPoint = {
      defenseBroken: normal.defenseBroken,
      weakPointBroken: normal.weakPointBroken,
      metaWeakPointBroken: postDefenseWeakMeta.weakPointBroken,
    };

    const weakFirst = spawnDirectionalShield('defense-break-weak-first');
    const weakFirstMeta = ruptureWeakPoint(weakFirst);
    weakFirst.brain.state = 'position';
    weakFirst._updateExposureAndDefense();
    const beforeDefenseHits = {
      weakPointBroken: weakFirst.weakPointBroken,
      metaWeakPointBroken: weakFirstMeta.weakPointBroken,
      defenseBroken: weakFirst.defenseBroken,
      defenseDisabled: weakFirst.defenseDisabled,
      defenseActive: weakFirst.brain.defenseActive,
      defenseVisible: weakFirst.visual.defense.group.visible,
    };
    const weakFirstHits = [
      hitDefense(weakFirst),
      hitDefense(weakFirst),
      hitDefense(weakFirst),
    ];
    const weakThenDefense = {
      defenseBroken: weakFirst.defenseBroken,
      count: weakFirst.defenseHitCount,
      allBlocked: weakFirstHits.every((entry) => entry.meta.shieldBlocked),
    };

    const excluded = spawnDirectionalShield('defense-break-excluded');
    const excludedMetas = [
      directMeta({ areaDamage: true }),
      directMeta({ explosionSplash: true }),
      directMeta({ statusTick: true }),
      directMeta({ hazardDomain: 'testHazard' }),
      {
        source: excluded,
        playerOwnedAttack: false,
        projectileHit: true,
        directHit: true,
        knockbackDirection: new Vector3(0, 0, -1),
      },
    ];
    for (const meta of excludedMetas) {
      excluded.brain.defenseActive = true;
      excluded.takeDamage(0.1, meta);
    }
    excluded.brain.defenseActive = false;
    const inactiveMeta = directMeta();
    excluded.takeDamage(0.1, inactiveMeta);
    const exclusions = {
      count: excluded.defenseHitCount,
      broken: excluded.defenseBroken,
      interceptedButIgnored: excludedMetas.map((meta) => Boolean(meta.shieldBlocked)),
      inactiveBlocked: Boolean(inactiveMeta.shieldBlocked),
    };

    const elite = spawnDirectionalShield('defense-break-elite', true);
    const eliteHealthScale = elite.stats.maxHealth / elite.genome.stats.maxHealth;
    hitDefense(elite);
    hitDefense(elite);
    elite.statusEffects.stagger.duration = 5;
    hitDefense(elite);
    const eliteState = {
      elite: elite.isElite,
      healthScale: eliteHealthScale,
      broken: elite.defenseBroken,
      stunDuration: elite.statusEffects.stagger.duration,
    };

    const lethal = spawnMitigatingDefense('defense-break-lethal');
    hitDefense(lethal, {}, 0.01);
    hitDefense(lethal, {}, 0.01);
    lethal.health = 0.05;
    const effectsBeforeLethalHit = game.timedEffects.filter((effect) => (
      effect.kind === 'reaverbotDefenseParts'
    )).length;
    const lethalThird = hitDefense(lethal, {}, 100);
    const lethalState = {
      dead: lethal.dead,
      blocked: lethalThird.meta.shieldBlocked,
      broken: lethal.defenseBroken,
      metaBroken: lethalThird.meta.defenseBroken,
      stunDuration: lethal.statusEffects.stagger.duration,
      debrisAdded: game.timedEffects.filter((effect) => (
        effect.kind === 'reaverbotDefenseParts'
      )).length - effectsBeforeLethalHit,
    };

    const claw = spawnClaw();
    const clawMeta = directMeta();
    claw.takeDamage(1, clawMeta);
    const clawState = {
      blocked: clawMeta.shieldBlocked,
      defensePartId: clawMeta.defensePartId,
      count: claw.defenseHitCount,
      broken: claw.defenseBroken,
      stunDuration: claw.statusEffects.stagger.duration,
    };

    game.dungeonController.isPlayerInSafeZone = originalSafeZone;
    return {
      firstState,
      secondState,
      thirdState,
      postBreak: {
        damage: postBreakDamage,
        blocked: Boolean(postBreak.shieldBlocked),
      },
      duringStun,
      afterStun,
      defenseThenWeakPoint,
      beforeDefenseHits,
      weakThenDefense,
      exclusions,
      eliteState,
      lethalState,
      clawState,
    };
  });

  expect(result.firstState).toEqual({
    count: 1,
    broken: false,
    remaining: 2,
    registered: true,
    blocked: true,
  });
  expect(result.secondState).toEqual({
    count: 2,
    broken: false,
    remaining: 1,
    registered: true,
    blocked: true,
  });
  expect(result.thirdState).toMatchObject({
    count: 3,
    broken: true,
    disabled: true,
    remaining: 0,
    metaBroken: true,
    blocked: true,
    weakPointBroken: false,
    weakPointExposed: true,
    targetActive: true,
    defenseVisible: false,
    state: 'position',
    moving: false,
    markerRemoved: true,
    leaseReleased: true,
    stunDuration: 2,
  });
  expect(result.thirdState.damage).toBe(0);
  expect(result.thirdState.debrisParts).toBeGreaterThanOrEqual(2);
  expect(result.thirdState.debrisParts).toBeLessThanOrEqual(4);
  expect(result.postBreak.blocked).toBe(false);
  expect(result.postBreak.damage).toBeGreaterThan(0);
  expect(result.duringStun.duration).toBeCloseTo(0.01, 5);
  expect(result.duringStun.controlLocked).toBe(true);
  expect(result.duringStun.positionDrift).toBeLessThan(0.001);
  expect(result.duringStun.moving).toBe(false);
  expect(result.afterStun).toEqual({ duration: 0, controlLocked: false });
  expect(result.defenseThenWeakPoint).toEqual({
    defenseBroken: true,
    weakPointBroken: true,
    metaWeakPointBroken: true,
  });
  expect(result.beforeDefenseHits).toEqual({
    weakPointBroken: true,
    metaWeakPointBroken: true,
    defenseBroken: false,
    defenseDisabled: false,
    defenseActive: true,
    defenseVisible: true,
  });
  expect(result.weakThenDefense).toEqual({
    defenseBroken: true,
    count: 3,
    allBlocked: true,
  });
  expect(result.exclusions.count).toBe(0);
  expect(result.exclusions.broken).toBe(false);
  expect(result.exclusions.interceptedButIgnored).toEqual([true, true, true, true, true]);
  expect(result.exclusions.inactiveBlocked).toBe(false);
  expect(result.eliteState.elite).toBe(true);
  expect(result.eliteState.healthScale).toBeCloseTo(2.15, 5);
  expect(result.eliteState.broken).toBe(true);
  expect(result.eliteState.stunDuration).toBe(2);
  expect(result.lethalState).toEqual({
    dead: true,
    blocked: true,
    broken: true,
    metaBroken: true,
    stunDuration: 0,
    debrisAdded: 1,
  });
  expect(result.clawState).toEqual({
    blocked: true,
    defensePartId: 'clawArmGuard',
    count: 0,
    broken: false,
    stunDuration: 0,
  });
});

test('shield and quadruped-eyelid break debris moves, spins, fades, and cleans up', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&reaverbotSeed=defense-break-debris');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();
    for (const enemy of [...game.enemies]) {
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;

    const removeEnemy = (enemy) => {
      const index = game.enemies.indexOf(enemy);
      if (index >= 0) game.enemies.splice(index, 1);
      enemy.dispose?.();
      enemy.root.removeFromParent();
    };
    const findEnemy = (label, predicate) => {
      for (let variant = 0; variant < 400; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId: label === 'eyelid' ? 'pursuer' : 'shieldSentinel',
          seed: `defense-debris:${label}:${variant}`,
          position: game.player.root.position.clone().add(new Vector3(0, 0, 5)),
        });
        if (predicate(enemy)) {
          enemy._runtimeGame = game;
          enemy.root.rotation.y = 0;
          enemy.brain.state = 'position';
          enemy._updateExposureAndDefense();
          enemy.root.updateMatrixWorld(true);
          return enemy;
        }
        removeEnemy(enemy);
      }
      throw new Error(`Unable to generate ${label} defense`);
    };
    const breakDefense = (enemy) => {
      for (let hit = 0; hit < 3; hit += 1) {
        enemy.brain.defenseActive = true;
        enemy.takeDamage(1, {
          source: game.player,
          playerOwnedAttack: true,
          projectileHit: true,
          directHit: true,
          knockbackDirection: new Vector3(0, 0, -1),
        });
      }
      return game.timedEffects.filter((effect) => effect.kind === 'reaverbotDefenseParts').at(-1);
    };

    const shield = findEnemy('shield', (enemy) => (
      enemy.genome.modules.defense?.id === 'directionalShield'
    ));
    const shieldEffect = breakDefense(shield);
    const shieldNames = shieldEffect.parts.map((part) => part.object.userData.sourceName);

    const eyelid = findEnemy('eyelid', (enemy) => (
      enemy.genome.body.planId === 'quadruped'
      && enemy.genome.modules.weapon.id !== 'clawArm'
      && enemy.visual.defense.group.userData.quadrupedEyelids === true
    ));
    const eyelidEffect = breakDefense(eyelid);
    const eyelidNames = eyelidEffect.parts.map((part) => part.object.userData.sourceName);
    const trackedPart = eyelidEffect.parts[0];
    const initialPosition = trackedPart.object.position.clone();
    const initialRotation = trackedPart.object.rotation.clone();
    const initialOpacity = trackedPart.materials[0].opacity;
    game._updateTimedEffects(0.16);
    const animated = {
      moved: trackedPart.object.position.distanceTo(initialPosition) > 0.01,
      spun: Math.abs(trackedPart.object.rotation.x - initialRotation.x)
        + Math.abs(trackedPart.object.rotation.y - initialRotation.y)
        + Math.abs(trackedPart.object.rotation.z - initialRotation.z) > 0.01,
    };
    game._updateTimedEffects(0.92);
    const faded = trackedPart.materials[0].opacity < initialOpacity;
    game._updateTimedEffects(0.2);

    return {
      shield: {
        broken: shield.defenseBroken,
        visible: shield.visual.defense.group.visible,
        partCount: shieldEffect.parts.length,
        names: shieldNames,
      },
      eyelid: {
        broken: eyelid.defenseBroken,
        visible: eyelid.visual.defense.group.visible,
        partCount: eyelidEffect.parts.length,
        names: eyelidNames,
      },
      animated,
      faded,
      cleaned: !game.timedEffects.includes(eyelidEffect)
        && eyelidEffect.object.parent === null,
    };
  });

  expect(result.shield.broken).toBe(true);
  expect(result.shield.visible).toBe(false);
  expect(result.shield.partCount).toBeGreaterThanOrEqual(2);
  expect(result.shield.partCount).toBeLessThanOrEqual(4);
  expect(result.shield.names.some((name) => name.includes('DirectionalShield'))).toBe(true);
  expect(result.eyelid.broken).toBe(true);
  expect(result.eyelid.visible).toBe(false);
  expect(result.eyelid.partCount).toBeGreaterThanOrEqual(2);
  expect(result.eyelid.partCount).toBeLessThanOrEqual(4);
  expect(result.eyelid.names.filter((name) => name === 'generatedQuadrupedEyeArmorEyelid')).toHaveLength(2);
  expect(result.animated).toEqual({ moved: true, spun: true });
  expect(result.faded).toBe(true);
  expect(result.cleaned).toBe(true);
});
