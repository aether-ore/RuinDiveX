import { expect, test } from '@playwright/test';

test('solo Tractor Controller chooses MegaMan only after allies fall, then flips, zigzags, and leaves a dodgeable fixed beam', async ({ page }) => {
  await page.goto('/?reaverbotSeed=solo-controller-approach-proof');
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

    const dungeon = game.dungeonController;
    const player = game.player;
    const floorY = dungeon.getSurfaceElevationAt(player.root.position);
    const arenaCenter = player.root.position.clone().setY(floorY);
    player.root.position.copy(arenaCenter);
    player.lastMoveDirection.set(0, 0, 1);
    player.dead = false;
    player.health = player.stats.maxHealth;
    player.clearExternalMotion?.('reset', game);

    dungeon.isPlayerInSafeZone = () => false;
    dungeon.getSurfaceElevationAt = () => floorY;
    dungeon.isPositionWalkable = () => true;
    dungeon.isAerialPositionClear = () => true;
    dungeon.isAerialPathClear = () => true;
    dungeon.getAerialNavigationDirection = (from, target) => {
      const direction = target.clone().sub(from);
      return direction.lengthSq() > 0.0001
        ? direction.normalize()
        : new Vector3(0, 0, 1);
    };

    const spawn = (archetypeId, seed, position) => window.spawnReaverbot({
      archetypeId,
      seed,
      position,
    });
    const controller = spawn(
      'tractorController',
      'solo-controller-approach:controller',
      arenaCenter.clone().add(new Vector3(0, 3.2, -9)),
    );
    const ally = spawn(
      'pursuer',
      'solo-controller-approach:ally',
      arenaCenter.clone().add(new Vector3(2.4, 0, -1.2)),
    );
    const encounterId = 'solo-controller-approach-arena';
    const arena = {
      encounterId,
      center: arenaCenter.clone(),
      zoneCenter: arenaCenter.clone(),
      halfWidth: 18,
      halfDepth: 18,
      softHalfWidth: 17,
      softHalfDepth: 17,
    };
    controller.encounterId = encounterId;
    controller.encounterArena = arena;
    ally.encounterId = encounterId;
    controller._runtimeGame = game;
    controller._isTractorCargoRootPathClear = () => true;

    const alliedObjective = controller._selectTractorObjective(game);
    ally.root.position.copy(arenaCenter).add(new Vector3(24, 0, 0));
    const outsideSameEncounterObjective = controller._selectTractorObjective(game);
    const ambientInside = spawn(
      'pursuer',
      'solo-controller-approach:ambient-inside',
      arenaCenter.clone().add(new Vector3(-2.2, 0, 1.4)),
    );
    ambientInside.encounterId = 'different-ambient-encounter';
    const ambientInsideObjective = controller._selectTractorObjective(game);
    controller.brain.controllerTagPause = 0;
    controller.takeDamage(0.5, {
      source: ambientInside,
      directHit: true,
      unblockable: true,
      armorPierce: 999,
    });
    const nonPlayerHitDidNotTag = controller.brain.controllerTagPause === 0;
    ally.dead = true;
    ambientInside.dead = true;
    const soloObjective = controller._selectTractorObjective(game);

    controller._setTractorObjective(player, 'player');
    controller.brain.cooldown = 0;
    controller.brain.state = 'position';
    controller.root.position.copy(arenaCenter).add(new Vector3(0, 3.2, -9));
    controller._prepareTractorApproach(game, player);
    const flipStart = controller.root.position.clone();
    const flipDuration = controller.genome.modules.weapon.flipWindupDuration ?? 0.38;
    let maximumFlipRotation = 0;
    let maximumFlipTravel = 0;
    for (let frame = 0; frame < 12
      && controller.brain.tractorApproachPhase === 'flip'; frame += 1) {
      controller._updateTractorController(flipDuration / 10, game);
      maximumFlipRotation = Math.max(
        maximumFlipRotation,
        Math.abs(controller.visual.root.rotation.z),
      );
      maximumFlipTravel = Math.max(
        maximumFlipTravel,
        controller.root.position.distanceTo(flipStart),
      );
    }
    const phaseAfterFlip = controller.brain.tractorApproachPhase;

    const transitStart = controller.root.position.clone();
    const transitDestination = controller.brain.tractorApproachDestination.clone();
    const transitForward = transitDestination.clone().sub(transitStart).setY(0).normalize();
    const transitLateral = new Vector3(-transitForward.z, 0, transitForward.x);
    const lateralSamples = [];
    const observedZigzagSigns = new Set();
    let maximumTransitSpeed = 0;
    let telegraphReached = false;
    for (let frame = 0; frame < 160; frame += 1) {
      const before = controller.root.position.clone();
      const dt = 0.025;
      controller._updateTractorController(dt, game);
      const step = controller.root.position.distanceTo(before);
      maximumTransitSpeed = Math.max(maximumTransitSpeed, step / dt);
      if (controller.brain.tractorApproachPhase === 'zigzag') {
        observedZigzagSigns.add(Math.sign(controller.brain.tractorZigzagSign));
      }
      const relative = controller.root.position.clone().sub(transitStart);
      lateralSamples.push(relative.dot(transitLateral));
      if (controller.brain.state === 'telegraph') {
        telegraphReached = true;
        break;
      }
    }

    const beamPoint = controller.brain.tractorBeamPoint.clone();
    const markerPosition = controller.brain.telegraphMarker?.position.clone() ?? null;
    const captureRadius = controller.genome.modules.weapon.playerCaptureRadius ?? 0.95;
    player.root.position.copy(beamPoint).add(new Vector3(
      captureRadius + player.radius + 0.85,
      0,
      0,
    ));
    const escapedPosition = player.root.position.clone();
    controller._updateTractorController(
      controller.genome.behavior.telegraphDuration + 0.02,
      game,
    );

    return {
      alliedTargetIsAlly: alliedObjective?.kind === 'enemy'
        && alliedObjective.target === ally,
      outsideSameEncounterDoesNotBlockSolo: outsideSameEncounterObjective?.kind === 'player'
        && outsideSameEncounterObjective.target === player,
      ambientInsideCountsAndCanBeSelected: ambientInsideObjective?.kind === 'enemy'
        && ambientInsideObjective.target === ambientInside,
      nonPlayerHitDidNotTag,
      soloTargetIsPlayer: soloObjective?.kind === 'player'
        && soloObjective.target === player,
      maximumFlipRotation,
      maximumFlipTravel,
      phaseAfterFlip,
      observedZigzagSigns: [...observedZigzagSigns],
      hasPositiveLateralTravel: lateralSamples.some((value) => value > 0.08),
      hasNegativeLateralTravel: lateralSamples.some((value) => value < -0.08),
      maximumTransitSpeed,
      baseMoveSpeed: controller.stats.moveSpeed,
      telegraphReached,
      markerMatchesBeam: Boolean(markerPosition)
        && Math.hypot(markerPosition.x - beamPoint.x, markerPosition.z - beamPoint.z) < 0.001,
      beamStayedFixed: controller.brain.tractorBeamPoint.distanceTo(beamPoint) < 0.001,
      playerActuallyEscaped: Math.hypot(
        escapedPosition.x - beamPoint.x,
        escapedPosition.z - beamPoint.z,
      ) > captureRadius + player.radius,
      escapedWithoutClaim: !player.hasExternalControl?.(),
      stateAfterEscape: controller.brain.state,
      targetClearedAfterEscape: controller.brain.tractorTarget === null,
      markerRemovedAfterEscape: controller.brain.telegraphMarker === null,
    };
  });

  expect(result.alliedTargetIsAlly).toBe(true);
  expect(result.outsideSameEncounterDoesNotBlockSolo).toBe(true);
  expect(result.ambientInsideCountsAndCanBeSelected).toBe(true);
  expect(result.nonPlayerHitDidNotTag).toBe(true);
  expect(result.soloTargetIsPlayer).toBe(true);
  expect(result.maximumFlipTravel).toBeLessThan(0.001);
  expect(result.maximumFlipRotation).toBeGreaterThan(5);
  expect(result.phaseAfterFlip).toBe('zigzag');
  expect(result.observedZigzagSigns).toContain(-1);
  expect(result.observedZigzagSigns).toContain(1);
  expect(result.hasPositiveLateralTravel).toBe(true);
  expect(result.hasNegativeLateralTravel).toBe(true);
  expect(result.maximumTransitSpeed).toBeGreaterThan(result.baseMoveSpeed * 4.5);
  expect(result.telegraphReached).toBe(true);
  expect(result.markerMatchesBeam).toBe(true);
  expect(result.beamStayedFixed).toBe(true);
  expect(result.playerActuallyEscaped).toBe(true);
  expect(result.escapedWithoutClaim).toBe(true);
  expect(result.stateAfterEscape).toBe('recovery');
  expect(result.targetClearedAfterEscape).toBe(true);
  expect(result.markerRemovedAfterEscape).toBe(true);
});

test('solo Tractor Controller can lift and throw MegaMan, preserves his flight after dying, and aborts when an ally appears', async ({ page }) => {
  await page.goto('/?reaverbotSeed=solo-controller-player-throw-proof');
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
    clearEnemies();

    const dungeon = game.dungeonController;
    const player = game.player;
    const floorY = dungeon.getSurfaceElevationAt(player.root.position);
    const arenaCenter = player.root.position.clone().setY(floorY);

    dungeon.isPlayerInSafeZone = () => false;
    dungeon.getSurfaceElevationAt = () => floorY;
    dungeon.isPositionWalkable = () => true;
    dungeon.isAerialPositionClear = () => true;
    dungeon.isAerialPathClear = () => true;
    dungeon.getAerialNavigationDirection = (from, target) => {
      const direction = target.clone().sub(from);
      return direction.lengthSq() > 0.0001
        ? direction.normalize()
        : new Vector3(0, 0, 1);
    };
    player.powerKnockbackTravelResolver = () => ({ blocked: false });

    const resetPlayer = () => {
      player.clearExternalMotion?.('reset', game);
      player.powerKnockbackState = null;
      player.powerKnockbackTimer = 0;
      player.powerKnockbackDuration = 0;
      player.powerKnockbackVelocity.set(0, 0, 0);
      player.animation.externalControlLocked = false;
      player.dead = false;
      player.health = player.stats.maxHealth;
      player.root.position.copy(arenaCenter);
      player.root.rotation.set(0, 0, 0);
      player.lastMoveDirection.set(0, 0, 1);
      player._restoreAfterExternalMotion?.({ grounded: true, groundY: floorY });
    };
    resetPlayer();

    const configureController = (controller, encounterId) => {
      controller.encounterId = encounterId;
      controller.encounterArena = {
        encounterId,
        center: arenaCenter.clone(),
        zoneCenter: arenaCenter.clone(),
        halfWidth: 18,
        halfDepth: 18,
        softHalfWidth: 17,
        softHalfDepth: 17,
      };
      controller._runtimeGame = game;
      controller._isTractorCargoRootPathClear = () => true;
      controller.root.position.copy(player.root.position);
      controller._setTractorObjective(player, 'player');
      controller.root.position.y = controller._getTractorControllerHeight(player);
      controller.brain.state = 'position';
      controller.brain.cooldown = 0;
      controller._prepareTractorApproach(game, player);
    };
    const enterPlayerCommit = (controller) => {
      controller._updateTractorController(0.01, game);
      const telegraphStarted = controller.brain.state === 'telegraph';
      controller._updateTractorController(
        controller.genome.behavior.telegraphDuration + 0.02,
        game,
      );
      return {
        telegraphStarted,
        claimed: player.hasExternalControl?.(controller) === true,
        state: controller.brain.state,
      };
    };

    const controller = window.spawnReaverbot({
      archetypeId: 'tractorController',
      seed: 'solo-controller-player-throw:controller',
      position: arenaCenter.clone().add(new Vector3(0, 3, -2)),
    });
    configureController(controller, 'solo-controller-throw-arena');
    const commitEntry = enterPlayerCommit(controller);
    const liftStartY = player.root.position.y;
    const liftDuration = controller.genome.modules.weapon.liftDuration ?? 1;
    const carryDuration = controller.genome.modules.weapon.carryDuration ?? 1.25;
    controller._updateTractorController(liftDuration * 0.58, game);
    const liftAmount = player.root.position.y - liftStartY;
    const lockedWhileHeld = player.animation.externalControlLocked;

    const explosionEvents = [];
    const originalAddExplosion = game.addExplosion;
    game.addExplosion = (position, damage, radius, color, meta = {}) => {
      if (meta.attackKind === 'tractorThrownPlayerImpact') {
        explosionEvents.push({
          position: position.clone(),
          damage,
          radius,
          attackKind: meta.attackKind,
          damageEnemies: meta.damageEnemies,
          damagePlayer: meta.damagePlayer,
          powerfulKnockback: meta.powerfulKnockback,
          unblockable: meta.unblockable,
        });
      }
      return originalAddExplosion.call(game, position, damage, radius, color, meta);
    };

    controller._updateTractorController(
      Math.max(0.01, liftDuration + carryDuration - controller.brain.stateTime + 0.03),
      game,
    );
    const ballisticStarted = Boolean(player.externalBallisticMotion);
    const ballisticDuration = player.externalBallisticMotion?.duration ?? 0;
    const ballisticLanding = player.externalBallisticMotion?.targetPosition.clone() ?? null;
    const noLongerHeldAfterThrow = !player.hasExternalControl?.();
    controller.dead = true;
    controller.onDeath(game);
    const ballisticSurvivedControllerDeath = Boolean(player.externalBallisticMotion);
    const healthBeforeImpact = player.health;
    const flightSamples = [];
    for (let elapsed = 0; elapsed < ballisticDuration + 0.12; elapsed += 0.04) {
      player.update(0.04, new Set(), {
        arenaRadius: game.arenaRadius,
        groundY: floorY,
        game,
      });
      flightSamples.push(player.root.position.y);
    }
    game.addExplosion = originalAddExplosion;
    const impactDamageTaken = healthBeforeImpact - player.health;
    const impactKnockbackState = player.powerKnockbackState;
    const impactNearTarget = Boolean(ballisticLanding && explosionEvents[0])
      && Math.hypot(
        explosionEvents[0].position.x - ballisticLanding.x,
        explosionEvents[0].position.z - ballisticLanding.z,
      ) < 0.6;

    clearEnemies();
    resetPlayer();
    const abortController = window.spawnReaverbot({
      archetypeId: 'tractorController',
      seed: 'solo-controller-player-throw:abort-controller',
      position: arenaCenter.clone().add(new Vector3(0, 3, -2)),
    });
    configureController(abortController, 'solo-controller-abort-arena');
    const abortCommitEntry = enterPlayerCommit(abortController);
    abortController._updateTractorController(liftDuration * 0.42, game);
    const healthBeforeAllyAbort = player.health;
    const ally = window.spawnReaverbot({
      archetypeId: 'pursuer',
      seed: 'solo-controller-player-throw:late-ally',
      position: arenaCenter.clone().add(new Vector3(2, 0, 1)),
    });
    ally.encounterId = 'solo-controller-abort-arena';
    abortController._updateTractorController(0.02, game);
    const releasedWhenAllyAppeared = !player.hasExternalControl?.(abortController);
    const safeDropStarted = Boolean(player.externalBallisticMotion)
      || Math.abs(player.root.position.y - floorY) < 0.05;
    const stateAfterAllyAppeared = abortController.brain.state;
    for (let frame = 0; frame < 40 && player.externalBallisticMotion; frame += 1) {
      player.update(0.04, new Set(), {
        arenaRadius: game.arenaRadius,
        groundY: floorY,
        game,
      });
    }

    return {
      commitEntry,
      liftAmount,
      lockedWhileHeld,
      ballisticStarted,
      noLongerHeldAfterThrow,
      ballisticSurvivedControllerDeath,
      flightRoseAboveEndpoints: flightSamples.length > 2
        && Math.max(...flightSamples) > Math.max(liftStartY, ballisticLanding?.y ?? floorY) + 0.5,
      impactNearTarget,
      explosionEvents,
      impactDamageTaken,
      impactKnockbackState,
      abortCommitEntry,
      releasedWhenAllyAppeared,
      safeDropStarted,
      stateAfterAllyAppeared,
      safeDropFinished: !player.isExternalMotionActive?.(),
      controlsRestoredAfterSafeDrop: !player.animation.externalControlLocked,
      allyAbortDamage: healthBeforeAllyAbort - player.health,
    };
  });

  expect(result.commitEntry).toEqual({
    telegraphStarted: true,
    claimed: true,
    state: 'commit',
  });
  expect(result.liftAmount).toBeGreaterThan(0.4);
  expect(result.lockedWhileHeld).toBe(true);
  expect(result.ballisticStarted).toBe(true);
  expect(result.noLongerHeldAfterThrow).toBe(true);
  expect(result.ballisticSurvivedControllerDeath).toBe(true);
  expect(result.flightRoseAboveEndpoints).toBe(true);
  expect(result.impactNearTarget).toBe(true);
  expect(result.explosionEvents).toHaveLength(1);
  expect(result.explosionEvents[0]).toMatchObject({
    attackKind: 'tractorThrownPlayerImpact',
    damageEnemies: false,
    damagePlayer: true,
    powerfulKnockback: true,
    unblockable: true,
  });
  expect(result.explosionEvents[0].radius).toBeGreaterThanOrEqual(1.8);
  expect(result.explosionEvents[0].damage).toBeGreaterThanOrEqual(12);
  expect(result.impactDamageTaken).toBeGreaterThan(0);
  expect(result.impactKnockbackState).not.toBeNull();
  expect(result.abortCommitEntry).toEqual({
    telegraphStarted: true,
    claimed: true,
    state: 'commit',
  });
  expect(result.releasedWhenAllyAppeared).toBe(true);
  expect(result.safeDropStarted).toBe(true);
  expect(result.stateAfterAllyAppeared).toBe('recovery');
  expect(result.safeDropFinished).toBe(true);
  expect(result.controlsRestoredAfterSafeDrop).toBe(true);
  expect(result.allyAbortDamage).toBeCloseTo(0, 5);
});
