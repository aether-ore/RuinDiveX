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
      seed: 'qa:3',
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
    const encounter = game.dungeonController.encounters.find((candidate) => (
      !candidate.isBoss
      && !candidate.roster?.some((type) => String(type).startsWith('legacy:'))
    ));
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
    game.player.root.rotation.y = 0;
    const hunterPosition = game.player.root.position.clone();
    hunterPosition.z += 1.2;
    const hunter = window.spawnReaverbot({
      archetypeId: 'packHunter',
      seed: 'qa:0',
      position: hunterPosition,
    });
    hunter.encounterId = 'runtime-pack-test';
    hunter.brain.cooldown = 0;
    const frontExposed = hunter._isPlayerBackExposed(game);
    const rearTarget = hunter._getPackRearTarget(game).clone();
    const frontDirection = game.player.root.position.clone().sub(hunter.root.position).setY(0).normalize();
    hunter._updatePositionState(0.1, game, frontDirection, 1.2);
    const frontState = hunter.brain.state;

    hunter.root.position.copy(game.player.root.position);
    hunter.root.position.z -= 1.5;
    const rearExposed = hunter._isPlayerBackExposed(game);
    const rearDirection = game.player.root.position.clone().sub(hunter.root.position).setY(0).normalize();
    hunter.brain.cooldown = 0;
    hunter.brain.state = 'position';
    hunter._updatePositionState(0.1, game, rearDirection, 1.5);
    const soloRearState = hunter.brain.state;

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
      pack: {
        minimumPackSize: hunter.genome.behavior.minimumPackSize,
        frontExposed,
        frontState,
        rearExposed,
        soloRearState,
        rearTargetZ: rearTarget.z,
        playerZ: game.player.root.position.z,
      },
      verticalMeleeDamage,
    };
  });

  expect(result.catalog.archetypes).toHaveLength(10);
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
  expect(result.pounce.recoveryWeakPoint).toBe(false);
  expect(result.pack.minimumPackSize).toBe(1);
  expect(result.pack.frontExposed).toBe(false);
  expect(result.pack.frontState).toBe('position');
  expect(result.pack.rearExposed).toBe(true);
  expect(result.pack.soloRearState).toBe('telegraph');
  expect(result.pack.rearTargetZ).toBeLessThan(result.pack.playerZ);
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
        defense: enemy.genome.modules.defense?.id ?? null,
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
      seed: 'runtime-aggro-proof:1',
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
    const blockedCommitAccepted = pouncer._moveCommitAlongWalkablePath(
      game,
      pouncer.root.position.x,
      pouncer.root.position.z + 4,
      pouncer.root.position.y,
    );
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

    // The armed mine is a powerful hit and now correctly protects the player
    // through get-up. Reset that completed scenario before independently
    // exercising Guard Projector impact-direction logic below.
    game.player.powerKnockbackState = null;
    game.player.powerKnockbackTimer = 0;
    game.player.powerKnockbackDuration = 0;
    game.player.powerKnockbackLandingCommitted = false;
    game.player.powerKnockbackVelocity.set(0, 0, 0);
    game.player.movementLockMultiplier = 1;
    game.player.animation.externalControlLocked = false;

    const originalGearEffects = game.player.gearEffects;
    game.player.gearEffects = {
      ...originalGearEffects,
      guard: {
        duration: 0.7,
        parryWindow: 0.18,
        cooldown: 0.82,
        guardReduction: 0.6,
        parryReduction: 0.9,
      },
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
    game.player.gearEffects = originalGearEffects;

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
      blockedCommitAccepted,
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
  expect(result.blockedCommitAccepted).toBe(false);
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

test('paired guards protect leg joints and the rotor exposes its counterweight side', async ({ page }) => {
  await page.goto('/?reaverbotSeed=paired-defense-runtime');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();
    game.projectiles.clear();
    for (const enemy of [...game.enemies]) {
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;

    let legGuard = null;
    for (let variant = 0; variant < 300; variant += 1) {
      const candidate = window.spawnReaverbot({
        archetypeId: 'pursuer',
        seed: `paired:pursuer:${variant}`,
        position: new Vector3(0, 0, 4),
      });
      if (
        candidate.genome.modules.defense?.id === 'sidePlates'
        && candidate.genome.modules.weakPoint.id === 'legJoint'
      ) {
        legGuard = candidate;
        break;
      }
      const candidateIndex = game.enemies.indexOf(candidate);
      if (candidateIndex >= 0) game.enemies.splice(candidateIndex, 1);
      candidate.dispose?.();
      candidate.root.removeFromParent();
    }
    if (!legGuard) throw new Error('Could not generate a pursuer with paired side plates and a leg-joint weak point.');
    legGuard.root.rotation.y = 0;
    legGuard.brain.state = 'position';
    legGuard._updateExposureAndDefense();
    legGuard._animateVisual(0);
    const closedPlatePositions = legGuard.visual.defense.plates.map((plate) => plate.position.clone());
    const closedTargets = legGuard.getCombatTargets().length;
    legGuard.visual.weakPoint.core.getWorldPosition(legGuard.brain.targetPosition);
    const closedResolve = legGuard.resolveProjectileHit(legGuard.brain.targetPosition, 0.12);
    const guardedMeta = {
      projectileHit: true,
      hitPartId: legGuard.genome.modules.weakPoint.id,
      knockbackDirection: new Vector3(0, 0, -1),
    };
    legGuard.brain.weakPointExposed = true;
    const guardedWeakDamage = legGuard.modifyDamageTaken(10, guardedMeta);
    legGuard.brain.weakPointExposed = false;

    legGuard.brain.state = 'recovery';
    legGuard.brain.stateTime = legGuard.genome.behavior.recoveryDuration * 0.45;
    legGuard._updateExposureAndDefense();
    legGuard._animateVisual(0.12);
    const openTargets = legGuard.getCombatTargets().length;
    legGuard.visual.weakPoint.core.getWorldPosition(legGuard.brain.targetPosition);
    const openResolve = legGuard.resolveProjectileHit(legGuard.brain.targetPosition, 0.12);
    const openMeta = {
      projectileHit: true,
      hitPartId: legGuard.genome.modules.weakPoint.id,
      knockbackDirection: new Vector3(0, 0, -1),
    };
    const openWeakDamage = legGuard.modifyDamageTaken(10, openMeta);
    const plateRetraction = Math.max(...legGuard.visual.defense.plates.map((plate, index) => (
      plate.position.distanceTo(closedPlatePositions[index])
    )));

    const rotor = window.spawnReaverbot({
      archetypeId: 'rotorHunter',
      seed: 'paired:rotor:0',
      position: new Vector3(0, 0, 8),
    });
    rotor.root.rotation.y = 0;
    rotor.visual.defense.group.rotation.y = 0;
    rotor.brain.state = 'position';
    rotor._updateExposureAndDefense();
    const shieldPhaseTargets = rotor.getCombatTargets().length;
    const rotorFrontMeta = { projectileHit: true, knockbackDirection: new Vector3(0, 0, -1) };
    const rotorFrontDamage = rotor.modifyDamageTaken(10, rotorFrontMeta);
    const rotorRearMeta = { projectileHit: true, knockbackDirection: new Vector3(0, 0, 1) };
    const rotorRearDamage = rotor.modifyDamageTaken(10, rotorRearMeta);

    const shieldDirection = rotor.visual.defense.primaryPlate.position.clone().normalize();
    const weakDirection = rotor.visual.weakPoint.group.position.clone().normalize();
    const shieldWeakDot = shieldDirection.dot(weakDirection);
    const linkedAssembly = rotor.visual.weakPoint.group.parent === rotor.visual.defense.group
      && rotor.visual.weapon.group.parent === rotor.visual.defense.group;

    rotor.visual.defense.group.rotation.y = Math.PI;
    rotor._updateExposureAndDefense();
    const weakPhaseTargets = rotor.getCombatTargets().length;
    const rotorWeakMeta = {
      projectileHit: true,
      hitPartId: rotor.genome.modules.weakPoint.id,
      knockbackDirection: new Vector3(0, 0, -1),
    };
    const rotorWeakDamage = rotor.modifyDamageTaken(10, rotorWeakMeta);

    game.player.root.position.set(0, 0, 3.5);
    rotor.root.position.set(0, 0, 8);
    rotor.brain.state = 'position';
    rotor.brain.cooldown = 99;
    rotor.brain.alerted = true;
    const distanceBefore = rotor.root.position.distanceTo(game.player.root.position);
    const angleBefore = rotor.visual.defense.group.rotation.y;
    rotor._updatePositionState(0.2, game, new Vector3(0, 0, -1), distanceBefore);
    rotor._animateVisual(0.2);
    const distanceAfter = rotor.root.position.distanceTo(game.player.root.position);
    const rotorAngleAdvance = rotor.visual.defense.group.rotation.y - angleBefore;

    const passiveArmor = [
      {
        archetypeId: 'pouncer',
        seed: 'passive:pouncer:0',
        expectedDefense: 'armoredBack',
        expectedWeakPoint: 'bellyCore',
      },
      {
        archetypeId: 'artillery',
        seed: 'passive:artillery:0',
        expectedDefense: 'armoredCarapace',
        expectedWeakPoint: 'ammoDrum',
      },
    ].map((sample, index) => {
      const enemy = window.spawnReaverbot({
        archetypeId: sample.archetypeId,
        seed: sample.seed,
        position: new Vector3(4 + index * 2, 0, 8),
      });
      enemy.root.rotation.y = 0;
      enemy.brain.state = 'position';
      enemy._updateExposureAndDefense();
      const bodyMeta = {
        projectileHit: true,
        knockbackDirection: new Vector3(0, 0, 1),
      };
      const guardedBodyDamage = enemy.modifyDamageTaken(10, bodyMeta);

      enemy.brain.state = 'recovery';
      enemy.brain.stateTime = enemy.genome.behavior.recoveryDuration * 0.45;
      enemy._updateExposureAndDefense();
      const weakMeta = {
        projectileHit: true,
        hitPartId: enemy.genome.modules.weakPoint.id,
        knockbackDirection: new Vector3(0, 0, 1),
      };
      const exposedWeakDamage = enemy.modifyDamageTaken(10, weakMeta);

      return {
        expectedDefense: sample.expectedDefense,
        expectedWeakPoint: sample.expectedWeakPoint,
        defense: enemy.genome.modules.defense?.id ?? null,
        weakPoint: enemy.genome.modules.weakPoint.id,
        guardedBodyDamage,
        bodyBlocked: bodyMeta.shieldBlocked,
        recoveryDefenseActive: enemy.brain.defenseActive,
        weakExposed: enemy.brain.weakPointExposed,
        exposedWeakDamage,
        weakHit: weakMeta.weakPointHit,
        weakBlocked: Boolean(weakMeta.shieldBlocked),
      };
    });

    return {
      leg: {
        defense: legGuard.genome.modules.defense.id,
        weakPoint: legGuard.genome.modules.weakPoint.id,
        weakRadius: legGuard.genome.modules.weakPoint.radius,
        closedTargets,
        closedResolvedWeak: Boolean(closedResolve?.weakPointHit),
        guardedWeakDamage,
        guardedWeakBlocked: guardedMeta.shieldBlocked,
        guardedWeakDefended: guardedMeta.weakPointDefended,
        openTargets,
        openResolvedWeak: Boolean(openResolve?.weakPointHit),
        openWeakDamage,
        openWeakHit: openMeta.weakPointHit,
        plateRetraction,
      },
      rotor: {
        archetype: rotor.genome.archetypeId,
        weapon: rotor.genome.modules.weapon.id,
        defense: rotor.genome.modules.defense.id,
        weakPoint: rotor.genome.modules.weakPoint.id,
        shieldPhaseTargets,
        rotorFrontDamage,
        rotorFrontBlocked: rotorFrontMeta.shieldBlocked,
        rotorRearDamage,
        shieldWeakDot,
        linkedAssembly,
        weakPhaseTargets,
        rotorWeakDamage,
        rotorWeakHit: rotorWeakMeta.weakPointHit,
        distanceBefore,
        distanceAfter,
        rotorAngleAdvance,
      },
      passiveArmor,
    };
  });

  expect(result.leg.defense).toBe('sidePlates');
  expect(result.leg.weakPoint).toBe('legJoint');
  expect(result.leg.weakRadius).toBeGreaterThanOrEqual(0.24);
  expect(result.leg.closedTargets).toBe(1);
  expect(result.leg.closedResolvedWeak).toBe(false);
  expect(result.leg.guardedWeakDamage).toBeLessThan(3);
  expect(result.leg.guardedWeakBlocked).toBe(true);
  expect(result.leg.guardedWeakDefended).toBe(true);
  expect(result.leg.openTargets).toBe(2);
  expect(result.leg.openResolvedWeak).toBe(true);
  expect(result.leg.openWeakDamage).toBeGreaterThan(20);
  expect(result.leg.openWeakHit).toBe(true);
  expect(result.leg.plateRetraction).toBeGreaterThan(0.35);

  expect(result.rotor.archetype).toBe('rotorHunter');
  expect(result.rotor.weapon).toBe('rotorBlade');
  expect(result.rotor.defense).toBe('rotatingPlates');
  expect(result.rotor.weakPoint).toBe('counterweightCore');
  expect(result.rotor.shieldPhaseTargets).toBe(1);
  expect(result.rotor.rotorFrontDamage).toBeLessThan(1);
  expect(result.rotor.rotorFrontBlocked).toBe(true);
  expect(result.rotor.rotorRearDamage).toBe(10);
  expect(result.rotor.shieldWeakDot).toBeLessThan(-0.9);
  expect(result.rotor.linkedAssembly).toBe(true);
  expect(result.rotor.weakPhaseTargets).toBe(2);
  expect(result.rotor.rotorWeakDamage).toBeGreaterThan(25);
  expect(result.rotor.rotorWeakHit).toBe(true);
  expect(result.rotor.distanceAfter).toBeLessThan(result.rotor.distanceBefore);
  expect(result.rotor.rotorAngleAdvance).toBeGreaterThan(0.5);

  for (const sample of result.passiveArmor) {
    expect(sample.defense).toBe(sample.expectedDefense);
    expect(sample.weakPoint).toBe(sample.expectedWeakPoint);
    expect(sample.guardedBodyDamage).toBeLessThan(8);
    expect(sample.bodyBlocked).toBe(true);
    expect(sample.recoveryDefenseActive).toBe(true);
    expect(sample.weakExposed).toBe(true);
    expect(sample.exposedWeakDamage).toBeGreaterThan(20);
    expect(sample.weakHit).toBe(true);
    expect(sample.weakBlocked).toBe(false);
  }
});

test('Reaverbot scrap stays unidentified until Roll analyzes and stores it', async ({ page }) => {
  await page.goto('/?reaverbotSeed=module-salvage-runtime');
  await page.waitForFunction(() => Boolean(
    window.game
    && window.spawnReaverbot
    && window.getReaverbotSalvageCatalog,
  ));

  const result = await page.evaluate(async () => {
    const game = window.game;
    game.stop();
    game.lootSystem.clear();
    game.inventory.clear();
    game.rollSalvageStorage.clear();
    for (const enemy of [...game.enemies]) {
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;

    let hopper = null;
    for (let index = 0; index < 80; index += 1) {
      const candidate = window.spawnReaverbot({
        archetypeId: 'pouncer',
        seed: `runtime-spring-hunt:${index}`,
        position: game.player.root.position.clone().add({ x: 0, y: 0, z: 3 }),
      });
      if (candidate.genome.body.planId === 'hopper') {
        hopper = candidate;
        break;
      }
      candidate.dispose?.();
      candidate.root.removeFromParent();
      game.enemies.splice(game.enemies.indexOf(candidate), 1);
    }

    if (!hopper) throw new Error('Unable to generate a Spring Hopper salvage sample.');
    const profile = hopper.salvageProfile.map((candidate) => ({
      aspect: candidate.aspect,
      moduleId: candidate.moduleId,
      materialId: candidate.materialId,
    }));

    // Drop succeeds, the bonus raises the hidden batch to two units, and the
    // rare-part roll selects the hopper body recovery. The field still exposes
    // only one generic, unidentified pickup.
    const rolls = [0, 0, 0, 0.2, 0.5, 0.5];
    let rollIndex = 0;
    const droppedAmount = game._rollEnemyScrapDrop(hopper, {
      random: () => rolls[rollIndex++] ?? 0.5,
    });
    const pickupCount = game.lootSystem.pickups.length;
    const pickup = game.lootSystem.pickups[0];
    const pickupSnapshot = {
      kind: pickup?.kind ?? null,
      quantity: pickup?.item?.quantity ?? 0,
      name: pickup?.item?.name ?? '',
      itemShape: pickup?.item?.scrapShape ?? null,
      visualShape: pickup?.object?.children?.[0]?.userData?.scrapShape ?? null,
    };
    const hiddenPart = pickup?.item?.recovery?.recoverableParts?.[0] ?? null;
    game.player.root.position.copy(hopper.root.position);
    const collected = game.lootSystem.update(0.016, game.player, game.inventory);
    game.setInventoryOpen(true);
    game.ui.renderInventory();

    const carriedSnapshot = {
      unidentifiedScrap: game.inventory.unidentifiedScrap,
      recoveryCount: game.inventory.unidentifiedRecoveries.length,
      inventoryNotifier: document.getElementById('unidentified-scrap-value')?.textContent ?? '',
      rollServiceHidden: document.getElementById('roll-scrap-service')?.hidden ?? false,
      visibleStoredPartText: document.getElementById('material-inventory')?.textContent ?? '',
    };

    const identification = await game.identifyReaverbotScrap();
    game.setInventoryOpen(true, { mode: 'roll' });
    game.ui.renderInventory();
    const storedParts = game.rollSalvageStorage.getParts().map((part) => ({
      id: part.id,
      name: part.name,
      quantity: part.quantity,
      sourceModule: part.lastSource?.moduleLabel ?? null,
      sourceEnemy: part.lastSource?.enemyName ?? null,
    }));
    const rollSnapshot = {
      serviceHidden: document.getElementById('roll-scrap-service')?.hidden ?? true,
      panelMode: document.getElementById('inventory-panel')?.dataset?.mode ?? '',
      stockpileText: document.getElementById('roll-scrap-service')?.textContent ?? '',
      partText: document.getElementById('material-inventory')?.textContent ?? '',
    };

    game.setInventoryOpen(true);
    const garageSnapshot = {
      serviceHidden: document.getElementById('roll-scrap-service')?.hidden ?? false,
      panelMode: document.getElementById('inventory-panel')?.dataset?.mode ?? '',
    };

    const salvageCatalog = window.getReaverbotSalvageCatalog();
    return {
      catalogMaterialCount: salvageCatalog.materials.length,
      bossOnlyMaterialIds: salvageCatalog.bossOnlyMaterialIds,
      bodyPlan: hopper.genome.body.planId,
      mobilityLabel: hopper.genome.body.mobilityLabel,
      profile,
      droppedAmount,
      pickupCount,
      pickupSnapshot,
      hiddenPart: hiddenPart ? {
        id: hiddenPart.id,
        name: hiddenPart.name,
        sourceModule: hiddenPart.source?.moduleLabel ?? null,
      } : null,
      remainingPickups: game.lootSystem.pickups.length,
      collectedKinds: collected.map((pickup) => pickup.pickupKind),
      carriedSnapshot,
      identification,
      pendingAfterIdentification: game.inventory.unidentifiedScrap,
      pendingRecoveriesAfterIdentification: game.inventory.unidentifiedRecoveries.length,
      identifiedScrap: game.rollSalvageStorage.identifiedScrap,
      storedPartCount: game.rollSalvageStorage.getStoredPartCount(),
      storedParts,
      rollSnapshot,
      garageSnapshot,
    };
  });

  expect(result.catalogMaterialCount).toBe(63);
  expect(result.bossOnlyMaterialIds).toEqual(['perfectedCompressionGreave']);
  expect(result.profile.some((candidate) => candidate.materialId === 'perfectedCompressionGreave')).toBe(false);
  expect(result.bodyPlan).toBe('hopper');
  expect(result.profile).toHaveLength(6);
  expect(result.profile.find((candidate) => candidate.aspect === 'body')).toEqual({
    aspect: 'body',
    moduleId: 'hopper',
    materialId: 'temperedJumpSpring',
  });
  expect(result.droppedAmount).toBe(2);
  expect(result.pickupCount).toBe(1);
  expect(result.pickupSnapshot.kind).toBe('unidentifiedScrap');
  expect(result.pickupSnapshot.quantity).toBe(2);
  expect(result.pickupSnapshot.name).toBe('Unidentified Reaverbot Scrap +2');
  expect(result.pickupSnapshot.itemShape).toBe(result.pickupSnapshot.visualShape);
  expect(result.hiddenPart).toEqual({
    id: 'temperedJumpSpring',
    name: 'Tempered Jump Spring',
    sourceModule: result.mobilityLabel,
  });
  expect(result.remainingPickups).toBe(0);
  expect(result.collectedKinds).toEqual(['unidentifiedScrap']);
  expect(result.carriedSnapshot).toMatchObject({
    unidentifiedScrap: 2,
    recoveryCount: 1,
    inventoryNotifier: '2',
    rollServiceHidden: true,
  });
  expect(result.carriedSnapshot.visibleStoredPartText).not.toContain(result.hiddenPart.name);
  expect(result.identification).toMatchObject({
    processed: 2,
    scrapStored: 1,
    partCount: 1,
    identifiedScrap: 1,
    storedPartCount: 1,
  });
  expect(result.pendingAfterIdentification).toBe(0);
  expect(result.pendingRecoveriesAfterIdentification).toBe(0);
  expect(result.identifiedScrap).toBe(1);
  expect(result.storedPartCount).toBe(1);
  expect(result.storedParts).toEqual([{
    id: result.hiddenPart.id,
    name: result.hiddenPart.name,
    quantity: 1,
    sourceModule: result.hiddenPart.sourceModule,
    sourceEnemy: expect.any(String),
  }]);
  expect(result.rollSnapshot.serviceHidden).toBe(false);
  expect(result.rollSnapshot.panelMode).toBe('roll');
  expect(result.rollSnapshot.stockpileText).toContain('Crafting Scrap');
  expect(result.rollSnapshot.stockpileText).toContain(result.hiddenPart.name);
  expect(result.rollSnapshot.partText).toContain(result.hiddenPart.sourceModule);
  expect(result.garageSnapshot).toEqual({
    serviceHidden: true,
    panelMode: 'garage',
  });
});

test('rush enemies acquire from range and expose accelerating red attack warnings', async ({ page }) => {
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

    const Vector3 = game.player.root.position.constructor;
    const base = game.player.root.position.clone();
    const controller = game.dungeonController;
    const originalWalkable = controller.isPositionWalkable;
    const originalElevation = controller.getSurfaceElevationAt;
    controller.isPositionWalkable = () => true;
    controller.getSurfaceElevationAt = (position) => position.y;

    const removeEnemy = (enemy) => {
      enemy.dispose?.();
      enemy.root.removeFromParent();
      const index = game.enemies.indexOf(enemy);
      if (index >= 0) game.enemies.splice(index, 1);
    };
    const findEnemy = (archetypeId, attackKind, position) => {
      for (let variant = 0; variant < 100; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId,
          seed: `runtime-rush:${archetypeId}:${variant}`,
          position,
        });
        if (enemy.genome.modules.weapon.attackKind === attackKind) return enemy;
        removeEnemy(enemy);
      }
      return null;
    };

    const pouncerPosition = base.clone().add(new Vector3(0, 0, 8.2));
    const pouncer = findEnemy('pouncer', 'pounce', pouncerPosition);
    pouncer.brain.cooldown = 0;
    const pounceDirection = base.clone().sub(pouncer.root.position).setY(0).normalize();
    pouncer._updatePositionState(1 / 60, game, pounceDirection, 8.2);
    const pounceMarkerColor = pouncer.brain.telegraphMarker?.material.color.getHex() ?? null;
    pouncer.brain.warningPhase = 0;
    pouncer.brain.stateTime = pouncer.genome.behavior.telegraphDuration * 0.1;
    pouncer._animateVisual(0);
    const pounceEarlyRate = pouncer.brain.warningBlinkRate;
    pouncer.brain.warningPhase = 0;
    pouncer.brain.stateTime = pouncer.genome.behavior.telegraphDuration * 0.9;
    pouncer._animateVisual(0);
    const pounceLateRate = pouncer.brain.warningBlinkRate;
    const pounceBodyColor = pouncer.visual.materials.primary.emissive.getHex();
    const pounceBodyIntensity = pouncer.visual.materials.primary.emissiveIntensity;

    const chargerPosition = base.clone().add(new Vector3(0, 0, 10));
    const charger = findEnemy('pursuer', 'charge', chargerPosition);
    const chargeDirection = base.clone().sub(charger.root.position).setY(0).normalize();
    const chargeCanStartAtTen = charger._isAttackDistance(10);
    charger._beginTelegraph(game, chargeDirection);
    const initialChargeDirection = charger.brain.attackDirection.clone();
    const initialChargeTravel = charger.root.position.distanceTo(charger.brain.targetPosition);
    const trackingDirection = new Vector3(0.75, 0, -0.66).normalize();
    charger._updateTelegraphState(0.05, game, trackingDirection);
    const trackedDirectionDot = charger.brain.attackDirection.dot(initialChargeDirection);
    charger.brain.warningPhase = 0;
    charger.brain.stateTime = charger.genome.behavior.telegraphDuration * 0.1;
    charger._animateVisual(0);
    const chargeEarlyRate = charger.brain.warningBlinkRate;
    charger.brain.warningPhase = 0;
    charger.brain.stateTime = charger.genome.behavior.telegraphDuration * 0.9;
    charger._animateVisual(0);
    const chargeLateRate = charger.brain.warningBlinkRate;

    charger._applyStatusVisuals();
    charger.brain.state = 'commit';
    charger.brain.stateTime = charger.genome.behavior.commitDuration * 0.35;
    charger._animateVisual(0);
    const chargeCommitColor = charger.visual.materials.primary.emissive.getHex();
    const chargeCommitIntensity = charger.visual.materials.primary.emissiveIntensity;

    const minimumEncounterSize = Math.min(
      ...game.dungeonController.encounters
        .filter((encounter) => !encounter.isBoss)
        .map((encounter) => encounter.roster.length),
    );

    pouncer._removeTelegraphMarker();
    charger._removeTelegraphMarker();
    controller.isPositionWalkable = originalWalkable;
    controller.getSurfaceElevationAt = originalElevation;

    return {
      pounce: {
        attackRange: pouncer.stats.attackRange,
        aggroRange: pouncer.genome.behavior.aggroRange,
        state: pouncer.brain.state,
        markerColor: pounceMarkerColor,
        earlyRate: pounceEarlyRate,
        lateRate: pounceLateRate,
        bodyColor: pounceBodyColor,
        bodyIntensity: pounceBodyIntensity,
      },
      charge: {
        aggroRange: charger.genome.behavior.aggroRange,
        canStartAtTen: chargeCanStartAtTen,
        travel: initialChargeTravel,
        trackedDirectionDot,
        earlyRate: chargeEarlyRate,
        lateRate: chargeLateRate,
        commitColor: chargeCommitColor,
        commitIntensity: chargeCommitIntensity,
      },
      minimumEncounterSize,
    };
  });

  expect(result.pounce.attackRange).toBeGreaterThanOrEqual(8.5);
  expect(result.pounce.aggroRange).toBeGreaterThanOrEqual(24);
  expect(result.pounce.state).toBe('telegraph');
  expect(result.pounce.markerColor).toBe(0xff2020);
  expect(result.pounce.lateRate).toBeGreaterThan(result.pounce.earlyRate * 3);
  expect(result.pounce.bodyColor).toBe(0xff2020);
  expect(result.pounce.bodyIntensity).toBeGreaterThan(0.1);
  expect(result.charge.aggroRange).toBeGreaterThanOrEqual(26);
  expect(result.charge.canStartAtTen).toBe(true);
  expect(result.charge.travel).toBeGreaterThan(10.5);
  expect(result.charge.travel).toBeLessThanOrEqual(12.5);
  expect(result.charge.trackedDirectionDot).toBeLessThan(0.999);
  expect(result.charge.lateRate).toBeGreaterThan(result.charge.earlyRate * 3);
  expect(result.charge.commitColor).toBe(0xff2020);
  expect(result.charge.commitIntensity).toBeGreaterThanOrEqual(0.2);
  expect(result.minimumEncounterSize).toBeGreaterThanOrEqual(3);
});

test('near and far charge attacks travel the same distance at one constant speed', async ({ page }) => {
  await page.goto('/?reaverbotSeed=fixed-charge-speed-regression');
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

    const controller = game.dungeonController;
    const originalWalkable = controller.isPositionWalkable;
    const originalElevation = controller.getSurfaceElevationAt;
    controller.isPositionWalkable = () => true;
    controller.getSurfaceElevationAt = () => 0;

    let charger = null;
    for (let variant = 0; variant < 180 && !charger; variant += 1) {
      const candidate = window.spawnReaverbot({
        archetypeId: 'pursuer',
        seed: `fixed-charge-speed:${variant}`,
        position: new Vector3(0, 0, 0),
      });
      if (candidate.genome.modules.weapon.attackKind === 'charge') charger = candidate;
      else {
        game.enemies.splice(game.enemies.indexOf(candidate), 1);
        candidate.dispose?.();
        candidate.root.removeFromParent();
      }
    }
    if (!charger) throw new Error('Unable to generate a fixed-speed charger');

    const dt = 1 / 120;
    const runCharge = (playerDistance) => {
      charger.root.position.set(0, 0, 0);
      charger.brain.state = 'position';
      charger.brain.stateTime = 0;
      charger.brain.attackHit = true;
      charger.brain.contactCooldown = 0;
      game.player.root.position.set(0, 0, playerDistance);
      const directionToPlayer = game.player.root.position.clone()
        .sub(charger.root.position)
        .setY(0)
        .normalize();
      charger._beginTelegraph(game, directionToPlayer);
      const plannedTarget = charger.brain.targetPosition.clone();
      const plannedDistance = charger.root.position.distanceTo(plannedTarget);
      const directionDot = charger.brain.attackDirection.dot(directionToPlayer);

      charger.brain.state = 'commit';
      charger.brain.stateTime = 0;
      charger.brain.commitStart.copy(charger.root.position);
      charger.brain.commitDistance = plannedDistance;
      charger.brain.chargeDistanceTravelled = 0;
      charger.brain.attackHit = true;
      const start = charger.root.position.clone();
      const speeds = [];
      let elapsed = 0;
      for (let frame = 0; frame < 360 && charger.brain.state === 'commit'; frame += 1) {
        const before = charger.root.position.clone();
        charger._updateCommitState(dt, game);
        const travel = charger.root.position.distanceTo(before);
        if (travel > 0.000001) speeds.push(travel / dt);
        elapsed += dt;
      }
      return {
        playerDistance,
        plannedDistance,
        actualDistance: charger.root.position.distanceTo(start),
        directionDot,
        elapsed,
        state: charger.brain.state,
        minimumSpeed: Math.min(...speeds),
        maximumSpeed: Math.max(...speeds),
        averageSpeed: speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length,
        passedPlayer: charger.root.position.distanceTo(start) > playerDistance,
      };
    };

    const near = runCharge(1.5);
    const far = runCharge(9.5);
    controller.isPositionWalkable = originalWalkable;
    controller.getSurfaceElevationAt = originalElevation;
    charger.dispose?.();
    charger.root.removeFromParent();
    game.enemies.length = 0;
    return { near, far };
  });

  for (const charge of [result.near, result.far]) {
    expect(charge.plannedDistance).toBeCloseTo(12.5, 5);
    expect(charge.actualDistance).toBeCloseTo(12.5, 5);
    expect(charge.directionDot).toBeGreaterThan(0.999999);
    expect(charge.state).toBe('recovery');
    expect(charge.minimumSpeed).toBeGreaterThan(13.8);
    expect(charge.maximumSpeed - charge.minimumSpeed).toBeLessThan(0.0001);
  }
  expect(result.near.passedPlayer).toBe(true);
  expect(result.near.actualDistance).toBeCloseTo(result.far.actualDistance, 6);
  expect(result.near.averageSpeed).toBeCloseTo(result.far.averageSpeed, 6);
  expect(result.near.elapsed).toBeCloseTo(result.far.elapsed, 6);
});

test('charge leases release by duration when pinned and by distance when unobstructed', async ({ page }) => {
  await page.goto('/?reaverbotSeed=charge-lease-termination-regression');
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

    const resetDirector = () => {
      game.enemyAttackDirector.owner = null;
      game.enemyAttackDirector.queue.length = 0;
      game.enemyAttackDirector.requestTimes.clear();
      game.enemyAttackDirector.handoffTimer = 0;
      game.enemyAttackDirector.time = 0;
    };
    const spawnCharger = (label, position) => {
      for (let variant = 0; variant < 180; variant += 1) {
        const candidate = window.spawnReaverbot({
          archetypeId: 'pursuer',
          seed: `${label}:${variant}`,
          position,
        });
        if (candidate.genome.modules.weapon.attackKind === 'charge') return candidate;
        const index = game.enemies.indexOf(candidate);
        if (index >= 0) game.enemies.splice(index, 1);
        candidate.dispose?.();
        candidate.root.removeFromParent();
      }
      throw new Error(`Unable to generate charger for ${label}`);
    };
    const primeCharge = (charger, start, direction) => {
      charger.root.position.copy(start);
      charger.brain.state = 'position';
      charger.brain.stateTime = 0;
      charger.brain.attackHit = true;
      charger.brain.contactCooldown = 0;
      charger._beginTelegraph(game, direction);
      const target = charger.brain.targetPosition.clone();
      const plannedDistance = charger.root.position.distanceTo(target);
      charger.brain.state = 'commit';
      charger.brain.stateTime = 0;
      charger.brain.commitStart.copy(charger.root.position);
      charger.brain.commitDistance = plannedDistance;
      charger.brain.chargeDistanceTravelled = 0;
      charger.brain.attackHit = true;
      return { target, plannedDistance };
    };

    resetDirector();
    const controller = game.dungeonController;
    const originalWalkable = controller.isPositionWalkable;
    const originalElevation = controller.getSurfaceElevationAt;
    controller.isPositionWalkable = () => true;
    controller.getSurfaceElevationAt = () => 0;
    game.player.root.position.set(0, 0, -20);

    const pinned = spawnCharger('pinned-charge-lease', new Vector3(0, 0, 0));
    const follower = spawnCharger('queued-charge-follower', new Vector3(3, 0, 0));
    const chargeDirection = new Vector3(0, 0, 1);
    const pinnedStart = new Vector3(0, 0, 0);
    const pinnedPlan = primeCharge(pinned, pinnedStart, chargeDirection);
    const pinnedDuration = pinned._getStateDuration('commit');
    const dt = 1 / 120;
    const originalPinnedMove = pinned._moveCommitAlongWalkablePath;
    // Model a solid obstacle resolving the attempted charge back to its start:
    // movement reports success, but the root never advances toward the target.
    pinned._moveCommitAlongWalkablePath = () => true;

    const pinnedLeaseClaimed = game.requestEnemyAttack(pinned);
    const followerInitiallyQueued = !game.requestEnemyAttack(follower)
      && game.enemyAttackDirector.queue.includes(follower);
    let pinnedElapsed = 0;
    let midCommitState = null;
    let midCommitOwned = false;
    let midCommitTravel = null;
    while (pinned.brain.state === 'commit' && pinnedElapsed < pinnedDuration + 0.25) {
      game._updateEnemyAttackDirector(dt);
      game.requestEnemyAttack(follower);
      pinned._updateCommitState(dt, game);
      pinnedElapsed += dt;
      if (midCommitState === null && pinnedElapsed >= pinnedDuration * 0.5) {
        midCommitState = pinned.brain.state;
        midCommitOwned = game.enemyAttackDirector.owner === pinned;
        midCommitTravel = pinned.root.position.distanceTo(pinnedStart);
      }
    }
    pinned._moveCommitAlongWalkablePath = originalPinnedMove;
    const pinnedSummary = {
      plannedDistance: pinnedPlan.plannedDistance,
      duration: pinnedDuration,
      elapsed: pinnedElapsed,
      midCommitState,
      midCommitOwned,
      midCommitTravel,
      actualTravel: pinned.root.position.distanceTo(pinnedStart),
      state: pinned.brain.state,
      leaseClaimed: pinnedLeaseClaimed,
      leaseReleased: game.enemyAttackDirector.owner !== pinned,
      requestCleared: !game.enemyAttackDirector.requestTimes.has(pinned)
        && !game.enemyAttackDirector.queue.includes(pinned),
    };

    let followerHandoffElapsed = 0;
    let followerClaimed = game.enemyAttackDirector.owner === follower;
    while (!followerClaimed && followerHandoffElapsed < 1) {
      game._updateEnemyAttackDirector(dt);
      game.requestEnemyAttack(follower);
      followerHandoffElapsed += dt;
      followerClaimed = game.enemyAttackDirector.owner === follower;
    }
    const followerSummary = {
      initiallyQueued: followerInitiallyQueued,
      claimed: followerClaimed,
      handoffElapsed: followerHandoffElapsed,
      ownerIsFollower: game.enemyAttackDirector.owner === follower,
    };

    game.completeEnemyAttack(follower, 0);
    resetDirector();
    const clearStart = new Vector3(0, 0, 0);
    const clearPlan = primeCharge(follower, clearStart, chargeDirection);
    const normalClearDuration = follower._getStateDuration('commit');
    const stretchedClearDuration = normalClearDuration * 2;
    const originalGetStateDuration = follower._getStateDuration;
    follower._getStateDuration = function getStretchedChargeDuration(state = this.brain.state) {
      return state === 'commit'
        ? stretchedClearDuration
        : originalGetStateDuration.call(this, state);
    };
    const clearLeaseClaimed = game.requestEnemyAttack(follower);
    let clearElapsed = 0;
    while (follower.brain.state === 'commit' && clearElapsed < stretchedClearDuration + 0.25) {
      game._updateEnemyAttackDirector(dt);
      follower._updateCommitState(dt, game);
      clearElapsed += dt;
    }
    follower._getStateDuration = originalGetStateDuration;
    const clearSummary = {
      plannedDistance: clearPlan.plannedDistance,
      normalDuration: normalClearDuration,
      stretchedDuration: stretchedClearDuration,
      elapsed: clearElapsed,
      actualTravel: follower.root.position.distanceTo(clearStart),
      targetError: follower.root.position.distanceTo(clearPlan.target),
      state: follower.brain.state,
      leaseClaimed: clearLeaseClaimed,
      leaseReleased: game.enemyAttackDirector.owner !== follower,
      requestCleared: !game.enemyAttackDirector.requestTimes.has(follower)
        && !game.enemyAttackDirector.queue.includes(follower),
    };

    controller.isPositionWalkable = originalWalkable;
    controller.getSurfaceElevationAt = originalElevation;
    for (const charger of [pinned, follower]) {
      const index = game.enemies.indexOf(charger);
      if (index >= 0) game.enemies.splice(index, 1);
      charger.dispose?.();
      charger.root.removeFromParent();
    }
    resetDirector();
    return { pinned: pinnedSummary, follower: followerSummary, clear: clearSummary, dt };
  });

  expect(result.pinned.leaseClaimed).toBe(true);
  expect(result.pinned.plannedDistance).toBeCloseTo(12.5, 5);
  expect(result.pinned.midCommitState).toBe('commit');
  expect(result.pinned.midCommitOwned).toBe(true);
  expect(result.pinned.midCommitTravel).toBeLessThan(0.001);
  expect(result.pinned.actualTravel).toBeLessThan(0.001);
  expect(result.pinned.state).toBe('recovery');
  expect(result.pinned.elapsed).toBeGreaterThanOrEqual(result.pinned.duration - result.dt);
  expect(result.pinned.elapsed).toBeLessThanOrEqual(result.pinned.duration + result.dt * 2);
  expect(result.pinned.leaseReleased).toBe(true);
  expect(result.pinned.requestCleared).toBe(true);

  expect(result.follower.initiallyQueued).toBe(true);
  expect(result.follower.claimed).toBe(true);
  expect(result.follower.ownerIsFollower).toBe(true);
  expect(result.follower.handoffElapsed).toBeGreaterThanOrEqual(0.45);
  expect(result.follower.handoffElapsed).toBeLessThan(0.55);

  expect(result.clear.leaseClaimed).toBe(true);
  expect(result.clear.plannedDistance).toBeCloseTo(12.5, 5);
  expect(result.clear.actualTravel).toBeCloseTo(result.clear.plannedDistance, 5);
  expect(result.clear.targetError).toBeLessThan(0.0001);
  expect(result.clear.state).toBe('recovery');
  expect(result.clear.elapsed).toBeCloseTo(result.clear.normalDuration, 2);
  expect(result.clear.elapsed).toBeLessThan(result.clear.stretchedDuration - result.dt);
  expect(result.clear.leaseReleased).toBe(true);
  expect(result.clear.requestCleared).toBe(true);
});

test('attack pacing serializes enemies while fixed-speed rocket chargers retreat after impact', async ({ page }) => {
  await page.goto('/?reaverbotSeed=attack-pacing-rocket-proof');
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
    game.enemyAttackDirector.owner = null;
    game.enemyAttackDirector.handoffTimer = 0;
    game.enemyAttackDirector.queue.length = 0;

    const controller = game.dungeonController;
    const originalWalkable = controller.isPositionWalkable;
    const originalElevation = controller.getSurfaceElevationAt;
    const originalEnemyNavigation = controller.getEnemyNavigationDirection;
    const originalSafeZone = controller.isPlayerInSafeZone;
    controller.isPositionWalkable = () => true;
    controller.getSurfaceElevationAt = (position) => position.y;
    controller.getEnemyNavigationDirection = (enemy, target) => target.clone().sub(enemy.root.position).setY(0).normalize();
    controller.isPlayerInSafeZone = () => false;

    const base = game.player.root.position.clone();
    const chargers = [];
    for (let slot = 0; slot < 3; slot += 1) {
      let charger = null;
      for (let variant = 0; variant < 180 && !charger; variant += 1) {
        const candidate = window.spawnReaverbot({
          archetypeId: 'pursuer',
          seed: `pacing-charge:${slot}:${variant}`,
          position: base.clone().add(new Vector3((slot - 1) * 1.6, 0, 7 + slot * 0.4)),
        });
        if (candidate.genome.modules.weapon.attackKind === 'charge') charger = candidate;
        else {
          const index = game.enemies.indexOf(candidate);
          if (index >= 0) game.enemies.splice(index, 1);
          candidate.dispose?.();
          candidate.root.removeFromParent();
        }
      }
      if (!charger) throw new Error('Unable to generate pacing charger');
      charger.brain.cooldown = 0;
      chargers.push(charger);
    }

    for (const charger of chargers) {
      const toPlayer = base.clone().sub(charger.root.position).setY(0).normalize();
      charger._updatePositionState(1 / 60, game, toPlayer, charger.root.position.distanceTo(base));
    }
    const simultaneousAttackers = chargers.filter((enemy) => ['telegraph', 'commit'].includes(enemy.brain.state)).length;
    const first = game.enemyAttackDirector.owner;
    game.completeEnemyAttack(first);
    first.brain.state = 'recovery';
    first.brain.stateTime = 0;

    for (const charger of chargers.filter((enemy) => enemy !== first)) {
      charger.brain.cooldown = 0;
      const toPlayer = base.clone().sub(charger.root.position).setY(0).normalize();
      charger._updatePositionState(1 / 60, game, toPlayer, charger.root.position.distanceTo(base));
    }
    const attackedDuringHandoff = chargers.filter((enemy) => enemy !== first && ['telegraph', 'commit'].includes(enemy.brain.state)).length;
    game._updateEnemyAttackDirector(0.5);
    for (const charger of chargers.filter((enemy) => enemy !== first)) {
      charger.brain.cooldown = 0;
      const toPlayer = base.clone().sub(charger.root.position).setY(0).normalize();
      charger._updatePositionState(1 / 60, game, toPlayer, charger.root.position.distanceTo(base));
    }
    const nextOwnerIndex = chargers.indexOf(game.enemyAttackDirector.owner);

    first.root.position.copy(base).add(new Vector3(0, 0, 1.55));
    first.brain.state = 'recovery';
    first.brain.stateTime = 0;
    const retreatBefore = first.root.position.distanceTo(base);
    first._updateRecoveryState(0.3, game);
    const retreatAfter = first.root.position.distanceTo(base);

    const chargeDuration = first._getStateDuration('commit');
    first.root.position.copy(base).add(new Vector3(0, 0, 7.5));
    first.brain.state = 'commit';
    first.brain.stateTime = 0;
    first.brain.commitStart.copy(first.root.position);
    first.brain.attackDirection.set(0, 0, -1);
    first.brain.targetPosition.copy(first.root.position).add(new Vector3(0, 0, -10));
    first.brain.attackHit = true;
    const chargeStart = first.root.position.clone();
    const originalParticleBurst = game.addParticleBurst;
    const jetTrailBursts = [];
    game.addParticleBurst = (position, color, count, scale) => {
      if (count === 2) jetTrailBursts.push({ position: position.clone(), color, scale });
    };
    const earlyStepDuration = chargeDuration * 0.35;
    first._updateCommitState(earlyStepDuration, game);
    game.addParticleBurst = originalParticleBurst;
    const earlyTravelDistance = first.root.position.distanceTo(chargeStart);
    const earlyTravelSpeed = earlyTravelDistance / earlyStepDuration;
    const nozzlePositions = first.visual.chargeModule.nozzles.map((nozzle) => nozzle.getWorldPosition(new Vector3()));
    first._animateVisual(1 / 60);
    const flameCount = first.visual.chargeModule.flames.filter((flame) => flame.visible).length;
    const trailAtNozzle = jetTrailBursts.every((burst) => (
      nozzlePositions.some((position) => position.distanceTo(burst.position) < 0.05)
    ));

    game.completeEnemyAttack(game.enemyAttackDirector.owner);
    game._updateEnemyAttackDirector(0.5);
    game.enemyAttackDirector.queue.length = 0;
    game.enemyAttackDirector.requestTimes.clear();
    game.enemyAttackDirector.handoffTimer = 0;
    first.brain.state = 'telegraph';
    first.brain.stateTime = 0;
    first.statusEffects.stagger.duration = 1;
    const interruptedLeaseClaimed = game.requestEnemyAttack(first);
    first._updateCustomBehavior(0.016, game);
    const interruptedState = first.brain.state;
    const interruptedLeaseReleased = game.enemyAttackDirector.owner !== first;
    first.statusEffects.stagger.duration = 0;

    controller.isPositionWalkable = originalWalkable;
    controller.getSurfaceElevationAt = originalElevation;
    controller.getEnemyNavigationDirection = originalEnemyNavigation;
    controller.isPlayerInSafeZone = originalSafeZone;
    return {
      simultaneousAttackers,
      attackedDuringHandoff,
      nextOwnerIndex,
      retreatBefore,
      retreatAfter,
      chargeDuration,
      earlyTravelSpeed,
      expectedChargeSpeed: 12.5 / chargeDuration,
      chargeModuleId: first.genome.modules.charge?.id ?? null,
      nozzleCount: first.visual.chargeModule.nozzles.length,
      flameCount,
      jetTrailBurstCount: jetTrailBursts.length,
      trailAtNozzle,
      interruptedState,
      interruptedLeaseClaimed,
      interruptedLeaseReleased,
    };
  });

  expect(result.simultaneousAttackers).toBe(1);
  expect(result.attackedDuringHandoff).toBe(0);
  expect(result.nextOwnerIndex).toBeGreaterThanOrEqual(1);
  expect(result.retreatAfter).toBeGreaterThan(result.retreatBefore);
  expect(result.chargeDuration).toBeGreaterThanOrEqual(0.9);
  expect(result.earlyTravelSpeed).toBeCloseTo(result.expectedChargeSpeed, 6);
  expect(result.chargeModuleId).toBeTruthy();
  expect(result.nozzleCount).toBeGreaterThan(0);
  expect(result.flameCount).toBe(result.nozzleCount);
  expect(result.jetTrailBurstCount).toBeGreaterThanOrEqual(result.nozzleCount);
  expect(result.trailAtNozzle).toBe(true);
  expect(result.interruptedState).toBe('recovery');
  expect(result.interruptedLeaseClaimed).toBe(true);
  expect(result.interruptedLeaseReleased).toBe(true);
});

test('a normal Reaverbot refocuses once when its canonical red eye is shot', async ({ page }) => {
  await page.goto('/?bossDebug=1&reaverbotSeed=red-eye-refocus-runtime');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();

    const resetDirector = () => {
      const director = game.enemyAttackDirector;
      director.owner = null;
      director.handoffTimer = 0;
      director.queue.length = 0;
      director.requestTimes.clear();
    };
    const removeEnemy = (enemy) => {
      if (!enemy) return;
      enemy.dispose?.();
      enemy.root?.removeFromParent?.();
      const index = game.enemies.indexOf(enemy);
      if (index >= 0) game.enemies.splice(index, 1);
      if (game.activeReaverbotBoss === enemy) game.activeReaverbotBoss = null;
    };
    const clearEnemies = () => {
      for (const enemy of [...game.enemies]) removeEnemy(enemy);
      game.enemies.length = 0;
      game.projectiles.clear();
      resetDirector();
    };
    const fireEyeShot = (enemy, damage = 2) => {
      game.projectiles.clear();
      enemy.root.updateMatrixWorld(true);
      const position = enemy.visual.eye.lens.getWorldPosition(new Vector3());
      const direction = enemy.root.position.clone().sub(game.player.root.position).setY(0);
      if (direction.lengthSq() <= 0.0001) direction.set(0, 0, 1);
      else direction.normalize();
      game.projectiles.spawn({
        owner: 'player',
        position,
        direction,
        speed: 0,
        range: 1,
        radius: 0.06,
        damage,
        source: game.player,
        attackMeta: {
          armorPierce: Number.POSITIVE_INFINITY,
          unblockable: true,
          playerOwnedAttack: true,
        },
      });
      game.projectiles.update(1 / 60);
    };

    clearEnemies();
    const controller = game.dungeonController;
    const originalSafeZone = controller.isPlayerInSafeZone;
    controller.isPlayerInSafeZone = () => false;

    const spawnPosition = game.player.root.position.clone().add(new Vector3(0, 0, 5));
    let enemy = null;
    for (let variant = 0; variant < 180 && !enemy; variant += 1) {
      const candidate = window.spawnReaverbot({
        archetypeId: 'artillery',
        seed: `red-eye-refocus:${variant}`,
        position: spawnPosition,
      });
      if (candidate.genome.modules.weakPoint.id !== 'eyeLens') enemy = candidate;
      else removeEnemy(candidate);
    }
    if (!enemy) throw new Error('Unable to generate an artillery Reaverbot with a separate weak point');

    enemy._runtimeGame = game;
    enemy.root.rotation.y = 0;
    enemy.brain.defenseActive = false;
    enemy.brain.weakPointExposed = false;
    enemy.defenseDisabled = true;
    enemy.root.updateMatrixWorld(true);

    const eyePosition = enemy.visual.eye.lens.getWorldPosition(new Vector3());
    const pointHit = enemy.resolveProjectileHit(eyePosition, 0.06);
    const worldFront = new Vector3(0, 0, 1).applyQuaternion(enemy.root.quaternion).normalize();
    const lineStart = eyePosition.clone().addScaledVector(worldFront, 1.4);
    const lineHit = enemy.resolveLineHit(
      lineStart,
      worldFront.clone().multiplyScalar(-1),
      3,
      0.05,
    );

    const toPlayer = game.player.root.position.clone().sub(enemy.root.position).setY(0).normalize();
    const firstLeaseClaimed = game.requestEnemyAttack(enemy);
    enemy._beginTelegraph(game, toPlayer);
    enemy._createTelegraphMarker(game, 0.8);
    const firstMarker = enemy.brain.telegraphMarker;
    const firstHealthBefore = enemy.health;
    const positionBeforeRefocus = enemy.root.position.clone();
    fireEyeShot(enemy);

    const firstImpact = {
      damageDealt: firstHealthBefore - enemy.health,
      state: enemy.brain.state,
      consumed: enemy.brain.eyeFlinchConsumed,
      moving: enemy.brain.moving,
      knockback: enemy.knockback.length(),
      markerRemoved: Boolean(firstMarker) && !enemy.brain.telegraphMarker,
      leaseReleased: game.enemyAttackDirector.owner !== enemy,
      requestCleared: !game.enemyAttackDirector.requestTimes.has(enemy)
        && !game.enemyAttackDirector.queue.includes(enemy),
    };

    const visualRootStartX = enemy.visual.root.position.x;
    const visualRootStartY = enemy.visual.root.position.y;
    const head = enemy.visual.frame.headAssembly ?? enemy.visual.frame.head;
    const headStartRoll = head.rotation.z;
    let peakVisualShake = 0;
    let refocusFrames = 0;
    let stationaryThroughout = true;
    while (enemy.brain.state === 'eyeRefocus' && refocusFrames < 120) {
      enemy.update(1 / 60, game);
      peakVisualShake = Math.max(
        peakVisualShake,
        Math.abs(enemy.visual.root.position.x - visualRootStartX),
        Math.abs(enemy.visual.root.position.y - visualRootStartY),
        Math.abs(head.rotation.z - headStartRoll),
      );
      stationaryThroughout = stationaryThroughout
        && !enemy.brain.moving
        && enemy.knockback.lengthSq() < 0.000001;
      refocusFrames += 1;
    }
    const refocus = {
      duration: enemy._getStateDuration('eyeRefocus'),
      frames: refocusFrames,
      peakVisualShake,
      stationaryThroughout,
      positionDrift: enemy.root.position.distanceTo(positionBeforeRefocus),
      exitState: enemy.brain.state,
    };

    game.projectiles.clear();
    resetDirector();
    enemy.hitStopTimer = 0;
    enemy.statusEffects.stagger.duration = 0;
    enemy.brain.state = 'position';
    enemy.brain.stateTime = 0;
    const secondLeaseClaimed = game.requestEnemyAttack(enemy);
    enemy._beginTelegraph(game, toPlayer);
    enemy._createTelegraphMarker(game, 0.8);
    const secondMarker = enemy.brain.telegraphMarker;
    const secondHealthBefore = enemy.health;
    fireEyeShot(enemy);
    const secondImpact = {
      damageDealt: secondHealthBefore - enemy.health,
      state: enemy.brain.state,
      consumed: enemy.brain.eyeFlinchConsumed,
      markerRetained: enemy.brain.telegraphMarker === secondMarker,
      leaseRetained: game.enemyAttackDirector.owner === enemy,
    };

    removeEnemy(enemy);
    resetDirector();
    game.projectiles.clear();

    const bossSpawn = game.debugSpawnBoss('revolvingFusillade');
    const boss = bossSpawn.boss;
    boss._runtimeGame = game;
    boss.brain.state = 'telegraph';
    boss.brain.stateTime = 0;
    boss.brain.eyeFlinchConsumed = false;
    boss.brain.weakPointExposed = false;
    boss.root.updateMatrixWorld(true);
    const bossEyePosition = boss.visual.eye.lens.getWorldPosition(new Vector3());
    const bossResolvedEye = boss.resolveProjectileHit(bossEyePosition, 0.06);
    const bossHealthBefore = boss.health;
    const bossDamage = boss.takeDamage(2, {
      source: game.player,
      playerOwnedAttack: true,
      projectileHit: true,
      directHit: true,
      redEyeHit: true,
      hitPartId: 'eyeLens',
      weakPointHit: false,
      armorPierce: Number.POSITIVE_INFINITY,
      unblockable: true,
      hitPosition: bossEyePosition,
    });
    const bossGuard = {
      spawned: bossSpawn.ok,
      isBoss: boss.isBoss,
      resolvedAsRedEye: Boolean(bossResolvedEye?.redEyeHit),
      damageDealt: bossHealthBefore - boss.health,
      returnedDamage: bossDamage,
      state: boss.brain.state,
      consumed: boss.brain.eyeFlinchConsumed,
    };

    removeEnemy(boss);
    resetDirector();
    game.projectiles.clear();
    controller.isPlayerInSafeZone = originalSafeZone;

    return {
      weakPointId: pointHit ? enemy?.genome?.modules?.weakPoint?.id ?? null : null,
      pointHit: pointHit && {
        redEyeHit: pointHit.redEyeHit,
        hitPartId: pointHit.hitPartId,
        weakPointHit: pointHit.weakPointHit,
      },
      lineHit: lineHit && {
        redEyeHit: lineHit.redEyeHit,
        hitPartId: lineHit.hitPartId,
        weakPointHit: lineHit.weakPointHit,
      },
      firstLeaseClaimed,
      firstImpact,
      refocus,
      secondLeaseClaimed,
      secondImpact,
      bossGuard,
    };
  });

  expect(result.weakPointId).not.toBe('eyeLens');
  expect(result.pointHit).toEqual({ redEyeHit: true, hitPartId: 'eyeLens', weakPointHit: false });
  expect(result.lineHit).toEqual({ redEyeHit: true, hitPartId: 'eyeLens', weakPointHit: false });
  expect(result.firstLeaseClaimed).toBe(true);
  expect(result.firstImpact.damageDealt).toBeGreaterThan(0);
  expect(result.firstImpact).toMatchObject({
    state: 'eyeRefocus',
    consumed: true,
    moving: false,
    markerRemoved: true,
    leaseReleased: true,
    requestCleared: true,
  });
  expect(result.firstImpact.knockback).toBeLessThan(0.001);
  expect(result.refocus.duration).toBeCloseTo(0.9, 5);
  expect(result.refocus.frames).toBeGreaterThanOrEqual(50);
  expect(result.refocus.frames).toBeLessThan(120);
  expect(result.refocus.peakVisualShake).toBeGreaterThan(0.02);
  expect(result.refocus.stationaryThroughout).toBe(true);
  expect(result.refocus.positionDrift).toBeLessThan(0.001);
  expect(result.refocus.exitState).toBe('recovery');

  expect(result.secondLeaseClaimed).toBe(true);
  expect(result.secondImpact.damageDealt).toBeGreaterThan(0);
  expect(result.secondImpact).toMatchObject({
    state: 'telegraph',
    consumed: true,
    markerRetained: true,
    leaseRetained: true,
  });

  expect(result.bossGuard).toMatchObject({
    spawned: true,
    isBoss: true,
    resolvedAsRedEye: false,
    state: 'telegraph',
    consumed: false,
  });
  expect(result.bossGuard.damageDealt).toBeGreaterThan(0);
  expect(result.bossGuard.returnedDamage).toBeGreaterThan(0);
});
