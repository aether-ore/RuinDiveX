import { expect, test } from '@playwright/test';

test('procedural Reaverbots integrate with encounters, targeting, defenses, and persistent projectiles', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot && window.getReaverbotCatalog));

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    game.projectiles.clear();
    for (const enemy of [...game.enemies]) enemy.root.removeFromParent();
    game.enemies.length = 0;

    const catalog = window.getReaverbotCatalog();
    const base = game.player.root.position.clone();
    const sentinelPosition = base.clone();
    sentinelPosition.z += 4;
    const sentinel = window.spawnReaverbot({
      archetypeId: 'shieldSentinel',
      seed: 'qa:7',
      position: sentinelPosition,
    });

    let eyeCount = 0;
    sentinel.root.traverse((object) => {
      if (object.userData?.reaverbotEye) eyeCount += 1;
    });

    const Vector3 = sentinel.root.position.constructor;
    sentinel.root.rotation.y = 0;
    sentinel.brain.defenseActive = true;
    sentinel.brain.weakPointExposed = false;
    const frontMeta = { projectileHit: true, knockbackDirection: new Vector3(0, 0, -1) };
    const rearMeta = { projectileHit: true, knockbackDirection: new Vector3(0, 0, 1) };
    const frontDamage = sentinel.modifyDamageTaken(10, frontMeta);
    const rearDamage = sentinel.modifyDamageTaken(10, rearMeta);
    const closedTargetCount = sentinel.getCombatTargets().length;

    sentinel.brain.weakPointExposed = true;
    const weakMeta = {
      projectileHit: true,
      hitPartId: sentinel.genome.modules.weakPoint.id,
      knockbackDirection: new Vector3(0, 0, 1),
    };
    const weakDamage = sentinel.modifyDamageTaken(10, weakMeta);
    const openTargetCount = sentinel.getCombatTargets().length;
    sentinel.visual.weakPoint.core.getWorldPosition(base);
    const resolvedWeakPoint = sentinel.resolveProjectileHit(base, 0.12);
    game.combat.lockOn.target = sentinel.weakPointTarget;
    game.combat.lockOn.movementLocked = true;
    const movementBasis = game._getPlayerMovementBasis();
    const expectedFacing = base.clone().sub(game.player.root.position).setY(0).normalize();
    const movementBasisDot = movementBasis.forward.dot(expectedFacing);
    game.combat._clearLockOn();

    for (const enemy of [...game.enemies]) enemy.root.removeFromParent();
    game.enemies.length = 0;
    const encounter = game.dungeonController.encounters.find((candidate) => !candidate.isBoss);
    encounter.spawned = false;
    encounter.cleared = false;
    encounter.enemyIds = [];
    const encounterEnemies = game.spawner.spawnEncounter(encounter);
    const encounterSummary = encounterEnemies.map((enemy) => ({
      procedural: enemy.isProceduralReaverbot,
      archetype: enemy.genome?.archetypeId,
      weapon: enemy.genome?.modules?.weapon?.id,
      defense: enemy.genome?.modules?.defense?.id,
      weakPoint: enemy.genome?.modules?.weakPoint?.id,
      eyeColor: enemy.genome?.modules?.eye?.color,
      encounterId: enemy.encounterId,
      seed: enemy.genome?.seed,
    }));

    game.projectiles.clear();
    for (const enemy of [...game.enemies]) enemy.root.removeFromParent();
    game.enemies.length = 0;
    const controllerPosition = game.player.root.position.clone();
    controllerPosition.z += 1.2;
    const controller = window.spawnReaverbot({
      archetypeId: 'zoneController',
      seed: 'qa:0',
      position: controllerPosition,
    });
    game.player.health = game.player.stats.maxHealth;
    controller._fireElectricOrb(game);
    for (let index = 0; index < 20; index += 1) {
      game.projectiles.update(0.1);
    }
    const orb = game.projectiles.active.find((projectile) => projectile.visualType === 'electricOrb');
    const orbSummary = orb ? {
      persistent: orb.persistentOnPlayerHit,
      hits: orb.playerHitCount,
      collisionRadius: orb.collisionRadius,
      remainingLifetime: orb.remainingLifetime,
    } : null;

    game.projectiles.clear();
    for (const enemy of [...game.enemies]) enemy.root.removeFromParent();
    game.enemies.length = 0;
    const pouncerPosition = game.player.root.position.clone();
    pouncerPosition.z += 4;
    const pouncer = window.spawnReaverbot({
      archetypeId: 'pouncer',
      seed: 'qa:0',
      position: pouncerPosition,
    });
    pouncer.brain.cooldown = 0;
    const toPlayer = game.player.root.position.clone().sub(pouncer.root.position).setY(0).normalize();
    pouncer._updatePositionState(0.1, game, toPlayer, 4);
    const pounceTelegraph = {
      state: pouncer.brain.state,
      marker: Boolean(pouncer.brain.telegraphMarker),
      weakPointExposed: pouncer.brain.weakPointExposed,
    };
    pouncer.brain.state = 'recovery';
    pouncer._updateExposureAndDefense();
    const pounceRecoveryWeakPoint = pouncer.brain.weakPointExposed;
    pouncer._removeTelegraphMarker();

    for (const enemy of [...game.enemies]) enemy.root.removeFromParent();
    game.enemies.length = 0;
    const hunterPosition = game.player.root.position.clone();
    hunterPosition.z += 1.2;
    const hunter = window.spawnReaverbot({
      archetypeId: 'packHunter',
      seed: 'qa:0',
      position: hunterPosition,
    });
    hunter.encounterId = 'runtime-pack-test';
    hunter.brain.cooldown = 0;
    const soloSupport = hunter._hasPackSupport(game);
    hunter._updatePositionState(0.1, game, toPlayer, 1.2);
    const soloState = hunter.brain.state;
    const allyPosition = hunterPosition.clone();
    allyPosition.x += 2;
    const ally = window.spawnReaverbot({
      archetypeId: 'pursuer',
      seed: 'qa:0',
      position: allyPosition,
    });
    ally.encounterId = 'runtime-pack-test';
    const groupedSupport = hunter._hasPackSupport(game);
    hunter.brain.cooldown = 0;
    hunter.brain.state = 'position';
    hunter._updatePositionState(0.1, game, toPlayer, 1.2);
    const groupedState = hunter.brain.state;

    game.player.health = game.player.stats.maxHealth;
    const verticalHealthBefore = game.player.health;
    hunter.brain.attackHit = false;
    hunter.root.position.copy(game.player.root.position);
    hunter.root.position.y += 4.05;
    hunter._tryContactHit(game, 0.8);
    const verticalMeleeDamage = verticalHealthBefore - game.player.health;

    return {
      catalog,
      sentinel: {
        eyeCount,
        eyeColor: sentinel.genome.modules.eye.color,
        frontDamage,
        rearDamage,
        frontBlocked: frontMeta.shieldBlocked,
        frontNullified: frontMeta.damageNullified,
        weakDamage,
        weakHit: weakMeta.weakPointHit,
        closedTargetCount,
        openTargetCount,
        resolvedWeakPoint: resolvedWeakPoint?.weakPointHit,
        movementBasisDot,
      },
      encounterId: encounter.id,
      encounterSummary,
      orbSummary,
      pounce: {
        weapon: pouncer.genome.modules.weapon.id,
        telegraph: pounceTelegraph,
        recoveryWeakPoint: pounceRecoveryWeakPoint,
      },
      pack: { soloSupport, soloState, groupedSupport, groupedState },
      verticalMeleeDamage,
    };
  });

  expect(result.catalog.archetypes).toHaveLength(8);
  expect(result.catalog.bodyPlans).toHaveLength(8);
  expect(result.catalog.weapons.length).toBeGreaterThanOrEqual(12);
  expect(result.sentinel.eyeCount).toBe(1);
  expect(result.sentinel.eyeColor).toBe(result.catalog.eyeColor);
  expect(result.sentinel.frontDamage).toBe(0);
  expect(result.sentinel.rearDamage).toBe(10);
  expect(result.sentinel.frontBlocked).toBe(true);
  expect(result.sentinel.frontNullified).toBe(true);
  expect(result.sentinel.weakDamage).toBeGreaterThan(20);
  expect(result.sentinel.weakHit).toBe(true);
  expect(result.sentinel.closedTargetCount).toBe(1);
  expect(result.sentinel.openTargetCount).toBe(2);
  expect(result.sentinel.resolvedWeakPoint).toBe(true);
  expect(result.sentinel.movementBasisDot).toBeGreaterThan(0.99);
  expect(result.encounterSummary.length).toBeGreaterThanOrEqual(2);
  expect(result.encounterSummary.every((enemy) => enemy.procedural)).toBe(true);
  expect(result.encounterSummary.every((enemy) => enemy.encounterId === result.encounterId)).toBe(true);
  expect(new Set(result.encounterSummary.map((enemy) => enemy.seed)).size).toBe(result.encounterSummary.length);
  expect(result.orbSummary).not.toBeNull();
  expect(result.orbSummary.persistent).toBe(true);
  expect(result.orbSummary.hits).toBeGreaterThanOrEqual(3);
  expect(result.orbSummary.collisionRadius).toBeGreaterThan(0.8);
  expect(result.orbSummary.remainingLifetime).toBeGreaterThan(1);
  expect(result.pounce.weapon).toBe('pounceActuator');
  expect(result.pounce.telegraph.state).toBe('telegraph');
  expect(result.pounce.telegraph.marker).toBe(true);
  expect(result.pounce.recoveryWeakPoint).toBe(true);
  expect(result.pack.soloSupport).toBe(false);
  expect(result.pack.soloState).toBe('position');
  expect(result.pack.groupedSupport).toBe(true);
  expect(result.pack.groupedState).toBe('telegraph');
  expect(result.verticalMeleeDamage).toBe(0);
});

test('run seeds, line hits, guarded posture, path clamps, telegraph cleanup, and mines work at runtime', async ({ page }) => {
  await page.goto('/?reaverbotSeed=runtime-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const snapshotSeededEncounter = () => page.evaluate(() => {
    const game = window.game;
    game.stop();
    game.projectiles.clear();
    for (const enemy of [...game.enemies]) {
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;

    const Vector3 = game.player.root.position.constructor;
    const encounter = {
      id: 'runtime-seed-proof',
      zone: { position: new Vector3(0, 0, 0) },
      spawnPoints: [
        new Vector3(3, 0, 4),
        new Vector3(5, 0, 4),
        new Vector3(7, 0, 4),
      ],
      roster: ['fast', 'tank', 'ranged'],
      enemyBehaviorModifiers: ['aggressive pack'],
    };
    const enemies = game.spawner.spawnEncounter(encounter);
    return {
      seedLabel: game.reaverbotSeedLabel,
      runSeed: game.reaverbotRunSeed,
      enemies: enemies.map((enemy) => ({
        seed: enemy.genome.seed,
        archetype: enemy.genome.archetypeId,
        body: enemy.genome.body.planId,
        weapon: enemy.genome.modules.weapon.id,
        defense: enemy.genome.modules.defense.id,
        weakPoint: enemy.genome.modules.weakPoint.id,
        position: enemy.root.position.toArray(),
      })),
    };
  });

  const firstSeededEncounter = await snapshotSeededEncounter();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));
  const repeatedSeededEncounter = await snapshotSeededEncounter();

  expect(firstSeededEncounter.seedLabel).toBe('runtime-proof');
  expect(repeatedSeededEncounter).toEqual(firstSeededEncounter);

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.projectiles.clear();
    for (const enemy of [...game.enemies]) {
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;

    const sentinel = window.spawnReaverbot({
      archetypeId: 'shieldSentinel',
      seed: 'runtime-guard-proof',
      position: new Vector3(0, 0, 7),
    });
    sentinel.brain.cooldown = 0;
    const sentinelStart = sentinel.root.position.clone();
    sentinel._updatePositionState(0.2, game, new Vector3(0, 0, -1), 7);
    const guardTravel = sentinel.root.position.distanceTo(sentinelStart);
    const guardState = sentinel.brain.state;
    sentinel._updatePositionState(0.1, game, new Vector3(0, 0, -1), Math.min(2, sentinel.stats.attackRange));
    const approachState = sentinel.brain.state;

    const dormant = window.spawnReaverbot({
      archetypeId: 'duelist',
      seed: 'runtime-aggro-proof',
      position: new Vector3(30, 0, 30),
    });
    const dormantStart = dormant.root.position.clone();
    dormant._updatePositionState(0.2, game, new Vector3(-1, 0, 0), 40);
    const dormantTravel = dormant.root.position.distanceTo(dormantStart);
    dormant.takeDamage(1);
    dormant._updatePositionState(0.2, game, new Vector3(-1, 0, 0), 40);
    const alertedTravel = dormant.root.position.distanceTo(dormantStart);

    sentinel.brain.weakPointExposed = true;
    sentinel.visual.weakPoint.core.getWorldPosition(sentinelStart);
    const bodyCenter = sentinel.root.position.clone().add(new Vector3(0, sentinel.collisionHeight * 0.5, 0));
    const weakPointOutward = sentinelStart.clone().sub(bodyCenter);
    if (weakPointOutward.lengthSq() < 0.001) weakPointOutward.set(0, 0, 1);
    const lineStart = sentinelStart.clone().addScaledVector(weakPointOutward.normalize(), 3);
    const lineDirection = sentinelStart.clone().sub(lineStart).normalize();
    const lineHits = game.combat._getLineHitCandidates(lineStart, lineDirection, 6, 0.08);
    const lineWeakPoint = lineHits[0]?.hitInfo?.weakPointHit === true;

    const pouncer = window.spawnReaverbot({
      archetypeId: 'pouncer',
      seed: 'runtime-path-proof',
      position: new Vector3(10, 0, 10),
    });
    const controller = game.dungeonController;
    const originalWalkable = controller.isPositionWalkable;
    const originalElevation = controller.getSurfaceElevationAt;
    const startZ = pouncer.root.position.z;
    controller.isPositionWalkable = (position) => position.z <= startZ + 1.05;
    controller.getSurfaceElevationAt = () => 0;
    const blockedTarget = pouncer.root.position.clone().add(new Vector3(0, 0, 4));
    pouncer._clampCommitTargetToWalkablePath(game, blockedTarget);
    const clampedTravel = blockedTarget.z - startZ;

    controller.isPositionWalkable = (position) => position.z <= startZ + 0.55;
    pouncer.brain.state = 'commit';
    pouncer.brain.stateTime = 0;
    pouncer.brain.commitStart.copy(pouncer.root.position);
    pouncer.brain.targetPosition.copy(pouncer.root.position).add(new Vector3(0, 0, 4));
    pouncer._updateCommitState(pouncer.genome.behavior.commitDuration * 0.7, game);
    const blockedCommitState = pouncer.brain.state;
    const blockedCommitTravel = pouncer.root.position.z - startZ;
    controller.isPositionWalkable = originalWalkable;
    controller.getSurfaceElevationAt = originalElevation;

    pouncer._beginTelegraph(game, new Vector3(0, 0, -1));
    const telegraphMarker = pouncer.brain.telegraphMarker;
    const markerWasAttached = Boolean(telegraphMarker?.parent);
    pouncer.dispose();
    const markerRemovedByDispose = !telegraphMarker?.parent && pouncer.brain.telegraphMarker === null;
    pouncer.root.removeFromParent();
    game.enemies.splice(game.enemies.indexOf(pouncer), 1);
    const staleWeakPointValid = game.combat._isValidLockTarget(pouncer.weakPointTarget);

    game.player.root.position.set(-8, 0, -8);
    game.player.health = game.player.stats.maxHealth;
    const miner = window.spawnReaverbot({
      archetypeId: 'zoneController',
      seed: 'runtime-mine-proof',
      position: new Vector3(1, 0, 1),
    });
    miner.brain.targetPosition.set(6, 0, 1);
    miner._fireMortar(game, true);
    for (let step = 0; step < 110; step += 1) game.projectiles.update(0.05);
    const mine = game.projectiles.active.find((projectile) => projectile.landedMine);
    const mineLanded = Boolean(mine);
    const mineArmed = Boolean(mine?.mineArmed);
    const minePosition = mine?.mesh.position.clone();
    const healthBeforeMine = game.player.health;
    if (minePosition) {
      game.player.root.position.copy(minePosition);
      game.projectiles.update(0.05);
    }
    const mineTriggered = mineLanded && !game.projectiles.active.includes(mine);
    const mineDamage = healthBeforeMine - game.player.health;

    const originalEquipmentGet = game.player.equipment.get;
    game.player.equipment.get = function getRuntimeShield(slot) {
      if (slot === 'offhand') {
        return { type: 'shieldArm', getStatTotals: () => ({ armor: 0 }) };
      }
      return originalEquipmentGet.call(this, slot);
    };
    game.player.root.position.set(0, 0, 0);
    game.player.guardTimer = 1;
    game.player.guardParryTimer = 0;
    game.player.guardDirection.set(0, 0, 1);
    game.player.lastGuardResult = null;
    game.player.health = game.player.stats.maxHealth;
    const remoteSource = { root: { position: new Vector3(0, 0, -5) } };
    game.player.takeDamage(10, remoteSource, { impactPosition: new Vector3(0, 0, 2) });
    const impactGuardBlocked = game.player.lastGuardResult?.blocked === true;
    game.player.guardTimer = 0;
    game.player.equipment.get = originalEquipmentGet;

    game.player.health = game.player.stats.maxHealth;
    game.player.root.position.copy(miner.root.position);
    miner.affix = { id: 'overcharged', color: 0x8ee8ff };
    miner.affixTimers.surge = 0;
    const originalSafeZoneCheck = controller.isPlayerInSafeZone;
    controller.isPlayerInSafeZone = () => true;
    const safeHealthBefore = game.player.health;
    miner.update(0.15, game);
    const safeZoneAffixDamage = safeHealthBefore - game.player.health;
    controller.isPlayerInSafeZone = originalSafeZoneCheck;

    game.player.root.position.set(-12, 0, -12);
    const bomber = window.spawnReaverbot({
      archetypeId: 'aerialBomber',
      seed: 'runtime-self-destruct-proof',
      position: new Vector3(12, 0, 12),
    });
    bomber.affix = { id: 'explosiveCore', color: 0xff7842 };
    const experienceBefore = game.player.experience;
    const originalAddExplosion = game.addExplosion;
    let selfDestructExplosionCount = 0;
    game.addExplosion = (...args) => {
      selfDestructExplosionCount += 1;
      return originalAddExplosion.apply(game, args);
    };
    bomber._selfDestruct(game);
    game.addExplosion = originalAddExplosion;
    const selfDestructExperience = game.player.experience - experienceBefore;

    return {
      guardTravel,
      guardState,
      approachState,
      dormantTravel,
      alertedTravel,
      lineWeakPoint,
      clampedTravel,
      blockedCommitState,
      blockedCommitTravel,
      markerWasAttached,
      markerRemovedByDispose,
      staleWeakPointValid,
      mineLanded,
      mineArmed,
      mineTriggered,
      mineDamage,
      impactGuardBlocked,
      safeZoneAffixDamage,
      selfDestructExperience,
      selfDestructExplosionCount,
    };
  });

  expect(result.guardTravel).toBeLessThan(0.001);
  expect(result.guardState).toBe('position');
  expect(result.approachState).toBe('telegraph');
  expect(result.dormantTravel).toBeLessThan(0.001);
  expect(result.alertedTravel).toBeGreaterThan(0.01);
  expect(result.lineWeakPoint).toBe(true);
  expect(result.clampedTravel).toBeGreaterThan(0.5);
  expect(result.clampedTravel).toBeLessThanOrEqual(1.05);
  expect(result.blockedCommitState).toBe('recovery');
  expect(result.blockedCommitTravel).toBeLessThanOrEqual(0.55);
  expect(result.markerWasAttached).toBe(true);
  expect(result.markerRemovedByDispose).toBe(true);
  expect(result.staleWeakPointValid).toBe(false);
  expect(result.mineLanded).toBe(true);
  expect(result.mineArmed).toBe(true);
  expect(result.mineTriggered).toBe(true);
  expect(result.mineDamage).toBeGreaterThan(0);
  expect(result.impactGuardBlocked).toBe(true);
  expect(result.safeZoneAffixDamage).toBe(0);
  expect(result.selfDestructExperience).toBe(0);
  expect(result.selfDestructExplosionCount).toBe(1);
});
