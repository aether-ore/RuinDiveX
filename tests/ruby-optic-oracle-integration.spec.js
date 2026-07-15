import { expect, test } from '@playwright/test';

async function waitForGame(page) {
  await page.waitForFunction(() => Boolean(window.game?.spawner && window.game?.ui));
}

test('Ruby encounter owns movement, shutter defense, interrupt scheduling, and channel stagger damage', async ({ page }) => {
  await page.goto('/?bossDebug=1&reaverbotSeed=ruby-integration-ownership');
  await waitForGame(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const boss = game.debugSpawnBoss('rubyOpticOracle').boss;
    const encounter = boss.specialEncounter;
    encounter.initialize(game);
    boss.bossState.phase = 2;
    boss.bossState.transitionRemaining = 0;
    boss.bossState.interruptRemaining = 0;

    boss.brain.defenseActive = true;
    const openMeta = { projectileHit: true, directHit: true };
    const openDamage = boss.modifyDamageTaken(10, openMeta);

    encounter.debugStartAttack('shutterFlash', game);
    const shutterMeta = { projectileHit: true, directHit: true };
    const shutterDamage = boss.modifyDamageTaken(10, shutterMeta);
    encounter.cancelCurrentAttack(game, 'test-shutter-reset');

    encounter.debugStartAttack('directBeam', game);
    const ordinaryAttackLocksGenericMotion = boss._isControlLocked();
    encounter.cancelCurrentAttack(game, 'test-motion-reset');

    encounter.attackCooldown = 0;
    boss.bossState.interruptRemaining = 0.6;
    boss.update(0.1, game);
    const attackDuringInterrupt = encounter.attack?.type ?? null;

    boss.bossState.interruptRemaining = 0;
    boss.bossState.transitionRemaining = 0.6;
    encounter.ceremonyRemaining = 0;
    encounter.attackCooldown = 0;
    boss.update(0.1, game);
    const attackDuringTransition = encounter.attack?.type ?? null;

    boss.bossState.transitionRemaining = 0;
    encounter.cancelCurrentAttack(game, 'test-channel-reset');
    encounter.attackCooldown = 0;
    encounter.debugStartAttack('ascension', game);
    encounter.attack.stage = 'channel';
    encounter.attack.channelElapsed = 0;
    encounter.attack.channelHits = 0;
    encounter.attack.channelDamage = 0;
    encounter.attack.channelCoreUnlocked = true;
    boss.root.position.y = encounter.floorY + 6.9;
    boss.signatureIntegrity = 0.25;
    const channelMeta = {
      hitPartId: encounter.channelCorePartId,
      signaturePartHit: true,
      rubyChannelCoreHit: true,
      projectileHit: true,
      directHit: true,
      mirrorImpactUnits: 6,
    };
    const channelDamage = boss.takeDamage(1, channelMeta);
    const fallStage = encounter.attack?.stage ?? null;
    const fallStartY = boss.root.position.y;
    encounter.prePlayerUpdate(0.36, game);
    encounter.update(0.36, game);
    const fallMidY = boss.root.position.y;
    for (let frame = 0; frame < 60 && encounter.attack; frame += 1) {
      encounter.prePlayerUpdate(1 / 60, game);
      encounter.update(1 / 60, game);
    }

    const bodyStaggerMeta = { projectileHit: true, directHit: true };
    const eyeStaggerMeta = { projectileHit: true, directHit: true, signaturePartHit: true };
    const rearStaggerMeta = {
      hitPartId: boss.genome.modules.weakPoint.id,
      projectileHit: true,
      directHit: true,
    };
    const bodyStaggerDamage = boss.modifyDamageTaken(10, bodyStaggerMeta);
    const eyeStaggerDamage = boss.modifyDamageTaken(10, eyeStaggerMeta);
    const rearStaggerDamage = boss.modifyDamageTaken(10, rearStaggerMeta);

    const output = {
      openDamage,
      openShieldBlocked: Boolean(openMeta.shieldBlocked),
      shutterDamage,
      shutterBlocked: Boolean(shutterMeta.rubyShuttersBlocked),
      ordinaryAttackLocksGenericMotion,
      attackDuringInterrupt,
      attackDuringTransition,
      channelDamage,
      channelSucceeded: encounter.staggerRemaining > 0,
      fallStage,
      fallStartY,
      fallMidY,
      landingY: boss.root.position.y,
      signatureIntegrity: boss.signatureIntegrity,
      signatureOverloaded: boss.signaturePartOverloaded,
      bodyStaggerDamage,
      bodyReceivedStaggerMultiplier: Boolean(bodyStaggerMeta.rubyOracleStaggerMultiplier),
      eyeStaggerDamage,
      eyeReceivedStaggerMultiplier: eyeStaggerMeta.rubyOracleStaggerMultiplier,
      eyeReceivedGenericSignatureMultiplier: eyeStaggerMeta.bossSignatureMultiplier ?? null,
      rearStaggerDamage,
      rearReceivedStaggerMultiplier: rearStaggerMeta.rubyOracleStaggerMultiplier,
      rearRegisteredWeakPoint: Boolean(rearStaggerMeta.weakPointHit),
    };

    if (game.activeReaverbotBoss === boss) game.activeReaverbotBoss = null;
    game.removeEnemy(boss);
    return output;
  });

  expect(result.openDamage).toBeCloseTo(10, 5);
  expect(result.openShieldBlocked).toBe(false);
  expect(result.shutterDamage).toBe(0);
  expect(result.shutterBlocked).toBe(true);
  expect(result.ordinaryAttackLocksGenericMotion).toBe(true);
  expect(result.attackDuringInterrupt).toBeNull();
  expect(result.attackDuringTransition).toBeNull();
  expect(result.channelDamage).toBeGreaterThan(0);
  expect(result.channelSucceeded).toBe(true);
  expect(result.fallStage).toBe('falling');
  expect(result.fallMidY).toBeLessThan(result.fallStartY);
  expect(result.fallMidY).toBeGreaterThan(result.landingY);
  expect(result.landingY).toBeCloseTo(0, 5);
  expect(result.signatureIntegrity).toBe(0.25);
  expect(result.signatureOverloaded).toBe(false);
  expect(result.bodyReceivedStaggerMultiplier).toBe(false);
  expect(result.bodyStaggerDamage).toBeCloseTo(10, 5);
  expect(result.eyeReceivedStaggerMultiplier).toBe(1.65);
  expect(result.eyeReceivedGenericSignatureMultiplier).toBeNull();
  expect(result.eyeStaggerDamage).toBeCloseTo(16.5, 5);
  expect(result.rearReceivedStaggerMultiplier).toBe(1.65);
  expect(result.rearRegisteredWeakPoint).toBe(true);
  expect(result.rearStaggerDamage).toBeCloseTo(16.5, 5);
});

test('arena extraction disposes and removes the live Ruby boss and prepares a fresh encounter attempt', async ({ page }) => {
  await page.goto('/?bossDebug=1&reaverbotSeed=ruby-integration-extraction');
  await waitForGame(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    game.selectedBossProfileId = 'rubyOpticOracle';
    game.activeBossExpeditionSpec = null;
    const encounter = game._configureBossHuntEncounter(game.dungeon, { ignorePersistedActive: true });
    encounter.spawned = false;
    encounter.cleared = false;
    encounter.enemyIds = [];
    const previousExpeditionId = encounter.expeditionSpec.id;
    const boss = game.spawner.spawnEncounter(encounter)[0];
    boss.specialEncounter.initialize(game);
    game.combat.lockOn.target = boss.signatureTarget;

    const dynamicPlatformsBefore = game.dynamicPlatformingPlatforms.length;
    const extracted = game.extractToCamp();
    return {
      extracted,
      dynamicPlatformsBefore,
      dynamicPlatformsAfter: game.dynamicPlatformingPlatforms.length,
      removedFromEnemies: !game.enemies.includes(boss),
      removedFromScene: boss.root.parent == null,
      activeBossCleared: game.activeReaverbotBoss == null,
      lockOnCleared: game.combat.lockOn.target == null,
      encounterSpawned: encounter.spawned,
      encounterCleared: encounter.cleared,
      encounterEnemyIds: [...encounter.enemyIds],
      encounterDisposed: boss.specialEncounter.disposed,
      resourceCounts: boss.getBossResourceCounts(game),
      previousExpeditionId,
      nextExpeditionId: game.activeBossExpeditionSpec?.id ?? null,
    };
  });

  expect(result.extracted).toBe(true);
  expect(result.dynamicPlatformsBefore).toBe(6);
  expect(result.dynamicPlatformsAfter).toBe(0);
  expect(result.removedFromEnemies).toBe(true);
  expect(result.removedFromScene).toBe(true);
  expect(result.activeBossCleared).toBe(true);
  expect(result.lockOnCleared).toBe(true);
  expect(result.encounterSpawned).toBe(false);
  expect(result.encounterCleared).toBe(false);
  expect(result.encounterEnemyIds).toEqual([]);
  expect(result.encounterDisposed).toBe(true);
  expect(result.resourceCounts).toEqual({ projectiles: 0, telegraphs: 0, constructs: 0 });
  expect(result.nextExpeditionId).toBeTruthy();
  expect(result.nextExpeditionId).not.toBe(result.previousExpeditionId);
});

test('worst-aligned Ascension lenses retain two routes and a real fall can recover onto the staircase', async ({ page }) => {
  await page.goto('/?bossDebug=1&reaverbotSeed=ruby-worst-alignment-recovery');
  await waitForGame(page);

  const result = await page.evaluate(async () => {
    const game = window.game;
    game.stop();
    const { PLAYER_TRAVERSAL_ENVELOPE } = await import('/src/TraversalCapabilities.js');
    const { RUBY_ASCENSION_LAYOUT } = await import('/src/reaverbots/bosses/RubyOpticOracleEncounter.js');
    const boss = game.debugSpawnBoss('rubyOpticOracle').boss;
    const encounter = boss.specialEncounter;
    encounter.initialize(game);
    boss.bossState.phase = 2;
    boss.bossState.transitionRemaining = 0;
    boss.bossState.interruptRemaining = 0;
    encounter.debugStartAttack('ascension', game);
    encounter.attack.stage = 'channel';
    encounter.attack.channelElapsed = 0;
    boss.root.position.set(encounter.center.x, encounter.floorY + 6.9, encounter.center.z);
    boss.root.updateMatrixWorld(true);

    for (const lens of encounter.lenses) {
      lens.forceInert();
      lens.setOrbitLayout(RUBY_ASCENSION_LAYOUT[lens.tier], 0);
    }

    const lower = encounter.lenses.filter((lens) => lens.tier === 'lower');
    const middle = encounter.lenses.filter((lens) => lens.tier === 'middle');
    const upper = encounter.lenses.find((lens) => lens.tier === 'upper');
    const setAlignment = (middleOffset, upperOffset) => {
      const angles = [
        0,
        Math.PI * 2 / 3,
        Math.PI * 4 / 3,
        middleOffset,
        middleOffset + Math.PI,
        upperOffset,
      ];
      encounter.lenses.forEach((lens, index) => {
        lens.angularPosition = angles[index];
        lens._advanceLayout(0);
        lens.orbitPivot.rotation.y = -angles[index];
        lens.orbitPivot.updateMatrixWorld(true);
        lens._updateColliderFromWorldTransform();
      });
    };
    const edgeGap = (from, to) => {
      const dx = from.platformCollider.center.x - to.platformCollider.center.x;
      const dz = from.platformCollider.center.z - to.platformCollider.center.z;
      return Math.max(
        0,
        Math.hypot(dx, dz) - from.platformCollider.radius - to.platformCollider.radius,
      );
    };
    const routeIsReachable = (from, to) => (
      edgeGap(from, to) <= PLAYER_TRAVERSAL_ENVELOPE.maximumHorizontalJumpDistance * 0.8
      && to.platformCollider.topY - from.platformCollider.topY
        <= PLAYER_TRAVERSAL_ENVELOPE.maximumLedgeClimbRise * 0.75
    );

    let minimumLowerMiddleRoutes = Number.POSITIVE_INFINITY;
    let minimumMiddleUpperRoutes = Number.POSITIVE_INFINITY;
    let worstMiddleOffset = 0;
    let worstUpperOffset = 0;
    let worstRouteScore = Number.POSITIVE_INFINITY;
    let worstRouteGap = 0;
    const alignmentSamples = 72;
    for (let middleIndex = 0; middleIndex < alignmentSamples; middleIndex += 1) {
      const middleOffset = middleIndex / alignmentSamples * Math.PI * 2;
      for (let upperIndex = 0; upperIndex < alignmentSamples; upperIndex += 1) {
        const upperOffset = upperIndex / alignmentSamples * Math.PI * 2;
        setAlignment(middleOffset, upperOffset);
        const lowerMiddleRoutes = lower.reduce((count, from) => (
          count + middle.filter((to) => routeIsReachable(from, to)).length
        ), 0);
        const middleUpperRoutes = middle.filter((from) => routeIsReachable(from, upper)).length;
        minimumLowerMiddleRoutes = Math.min(minimumLowerMiddleRoutes, lowerMiddleRoutes);
        minimumMiddleUpperRoutes = Math.min(minimumMiddleUpperRoutes, middleUpperRoutes);
        const routeScore = lowerMiddleRoutes * 10 + middleUpperRoutes;
        const routeGap = Math.min(...middle.map((from) => edgeGap(from, upper)));
        if (routeScore < worstRouteScore
          || (routeScore === worstRouteScore && routeGap > worstRouteGap)) {
          worstRouteScore = routeScore;
          worstRouteGap = routeGap;
          worstMiddleOffset = middleOffset;
          worstUpperOffset = upperOffset;
        }
      }
    }
    setAlignment(worstMiddleOffset, worstUpperOffset);

    const player = game.player;
    const Vector3 = player.root.position.constructor;
    const outward = upper.platformCollider.center.clone().sub(encounter.center).setY(0).normalize();
    const fallStart = upper.platformCollider.center.clone()
      .addScaledVector(outward, upper.platformCollider.radius + player.radius + 0.18);
    fallStart.y = upper.platformCollider.topY + 0.16;
    player.ledgeCling = null;
    player.externalControl = null;
    player.externalBallisticMotion = null;
    player.powerKnockbackState = null;
    player.root.position.copy(fallStart);
    player.modelRoot.position.y = 0;
    player.velocity.set(0, -1.2, 0);
    player.takeoffHorizontalVelocity.set(0, 0, 0);
    player.jumpState = 'Falling';
    player.grounded = false;
    player.onGround = false;
    player._jumpGroundY = encounter.floorY;
    player._jumpAirTimer = player._getEstimatedJumpAirTime() * 0.52;
    game.dungeonController.pendingPlayerJumpOffLanding = null;
    game.dungeonController.lastSafePlayerPosition.copy(upper.platformCollider.center);

    const movementOptions = (direction) => ({
      arenaRadius: game.arenaRadius,
      movementForward: direction,
      movementRight: new Vector3(direction.z, 0, -direction.x),
      groundY: game._getPlayerGroundY(),
      game,
    });
    const noInput = new Set();
    let fallFrames = 0;
    let landedOnFloor = false;
    for (; fallFrames < 240; fallFrames += 1) {
      boss.prePlayerUpdate(1 / 60, game);
      player.update(1 / 60, noInput, movementOptions(outward));
      game.dungeonController.update(1 / 60);
      if (player.jumpState === 'Grounded'
        && Math.abs(player.root.position.y - encounter.floorY) < 0.04) {
        landedOnFloor = true;
        break;
      }
    }
    const floorLandingPosition = player.root.position.clone();

    const nearestLower = [...lower].sort((a, b) => (
      a.platformCollider.center.distanceToSquared(player.root.position)
      - b.platformCollider.center.distanceToSquared(player.root.position)
    ))[0];
    const launchOutward = nearestLower.platformCollider.center.clone()
      .sub(encounter.center)
      .setY(0)
      .normalize();
    const launchPosition = nearestLower.platformCollider.center.clone()
      .addScaledVector(
        launchOutward,
        nearestLower.platformCollider.radius + 0.12,
      );
    launchPosition.y = encounter.floorY;
    const floorWalkDistance = Math.hypot(
      launchPosition.x - floorLandingPosition.x,
      launchPosition.z - floorLandingPosition.z,
    );
    player.root.position.copy(launchPosition);
    player.modelRoot.position.y = 0;
    player.jumpState = 'Grounded';
    player.grounded = true;
    player.onGround = true;
    player.velocity.set(0, 0, 0);
    player.takeoffHorizontalVelocity.set(0, 0, 0);
    player._jumpGroundY = encounter.floorY;
    game.dungeonController.lastSafePlayerPosition.copy(launchPosition);

    const predictedLowerPosition = (seconds, out = new Vector3()) => {
      const angle = nearestLower.angularPosition
        + nearestLower.orbitDirection * nearestLower.angularSpeed * seconds;
      return out.set(
        encounter.center.x + Math.cos(angle) * nearestLower.orbitRadius,
        nearestLower.platformCollider.topY,
        encounter.center.z + Math.sin(angle) * nearestLower.orbitRadius,
      );
    };
    let jumpDirection = predictedLowerPosition(0.45)
      .sub(player.root.position)
      .setY(0)
      .normalize();
    player.velocity.copy(jumpDirection).multiplyScalar(
      player.jumpSettings.forwardJumpSpeed ?? PLAYER_TRAVERSAL_ENVELOPE.forwardJumpSpeed,
    );
    player.velocity.y = 0;
    player.takeoffHorizontalVelocity.set(0, 0, 0);
    player._jumpBufferTimer = 0;
    player._coyoteTimer = player.jumpSettings.coyoteTime;
    player._landingRecoveryTimer = 0;
    player.lastMoveDirection.copy(jumpDirection);
    player.faceDirection(jumpDirection);
    const recoveryJumpStarted = player.tryJump(new Set(['KeyW']), movementOptions(jumpDirection));

    let recoveryFrames = 0;
    let recoveredLensIndex = null;
    let recoveryWasAirborne = false;
    let sawLedgeCling = false;
    game.lastDebugLedgeLandingId = null;
    game.lastDebugLedgeClingId = null;
    for (; recoveryFrames < 180; recoveryFrames += 1) {
      boss.prePlayerUpdate(1 / 60, game);
      jumpDirection = predictedLowerPosition(0.22)
        .sub(player.root.position)
        .setY(0);
      if (jumpDirection.lengthSq() > 0.0001) jumpDirection.normalize();
      player.update(1 / 60, new Set(['KeyW']), movementOptions(jumpDirection));
      game.dungeonController.update(1 / 60);
      recoveryWasAirborne ||= player.isJumpAirborne();
      sawLedgeCling ||= Boolean(player.ledgeCling);
      const support = game.getPlatformSupport(player.root.position)?.surface ?? null;
      const recoveredLens = encounter.lenses.find((lens) => support === lens.platformCollider);
      if (recoveredLens && player.jumpState === 'Grounded') {
        recoveredLensIndex = recoveredLens.index;
        break;
      }
      if (recoveryWasAirborne && player.jumpState === 'Grounded') break;
    }
    const middleTarget = middle.find((candidate) => (
      routeIsReachable(candidate, upper)
      && lower.some((source) => routeIsReachable(source, candidate))
    ));
    const lowerSource = middleTarget
      ? lower.find((candidate) => routeIsReachable(candidate, middleTarget))
      : null;
    if (!lowerSource || !middleTarget) {
      throw new Error('Worst-alignment route graph did not contain a connected lower-to-upper chain.');
    }

    const predictLensPosition = (lens, seconds, out = new Vector3()) => {
      const angle = lens.angularPosition + lens.orbitDirection * lens.angularSpeed * seconds;
      return out.set(
        encounter.center.x + Math.cos(angle) * lens.orbitRadius,
        lens.platformCollider.topY,
        encounter.center.z + Math.sin(angle) * lens.orbitRadius,
      );
    };
    const performInstantStepJump = (source, target) => {
      const edgeDirection = target.platformCollider.center.clone()
        .sub(source.platformCollider.center)
        .setY(0)
        .normalize();
      const launchPosition = source.platformCollider.center.clone()
        .addScaledVector(edgeDirection, Math.max(0.1, source.platformCollider.radius - 0.1));
      launchPosition.y = source.platformCollider.topY;
      player.ledgeCling = null;
      player.root.position.copy(launchPosition);
      player.modelRoot.position.y = 0;
      player.jumpState = 'Grounded';
      player.grounded = true;
      player.onGround = true;
      player.velocity.set(0, 0, 0);
      player.takeoffHorizontalVelocity.set(0, 0, 0);
      player._jumpGroundY = source.platformCollider.topY;
      player._jumpBufferTimer = 0;
      player._coyoteTimer = player.jumpSettings.coyoteTime;
      player._landingRecoveryTimer = 0;
      game.dungeonController.lastSafePlayerPosition.copy(launchPosition);

      let direction = predictLensPosition(target, 0.42)
        .sub(player.root.position)
        .setY(0)
        .normalize();
      player.velocity.copy(direction).multiplyScalar(
        player.jumpSettings.forwardJumpSpeed ?? PLAYER_TRAVERSAL_ENVELOPE.forwardJumpSpeed,
      );
      player.velocity.y = 0;
      player.lastMoveDirection.copy(direction);
      player.faceDirection(direction);
      const jumpStarted = player.tryJump(new Set(['KeyW']), movementOptions(direction));
      game.lastDebugLedgeLandingId = null;
      game.lastDebugLedgeClingId = null;
      let sawAirborne = false;
      let sawClingState = false;
      let supportedTarget = false;
      let frames = 0;
      for (; frames < 180; frames += 1) {
        boss.prePlayerUpdate(1 / 60, game);
        direction = predictLensPosition(target, 0.18)
          .sub(player.root.position)
          .setY(0);
        if (direction.lengthSq() > 0.0001) direction.normalize();
        player.update(1 / 60, new Set(['KeyW']), movementOptions(direction));
        game.dungeonController.update(1 / 60);
        sawAirborne ||= player.isJumpAirborne();
        sawClingState ||= Boolean(player.ledgeCling);
        const support = game.getPlatformSupport(player.root.position)?.surface ?? null;
        if (support === target.platformCollider && player.jumpState === 'Grounded') {
          supportedTarget = true;
          break;
        }
        if (sawAirborne && player.jumpState === 'Grounded') break;
      }
      return {
        sourceIndex: source.index,
        targetIndex: target.index,
        rise: target.platformCollider.topY - source.platformCollider.topY,
        jumpStarted,
        frames,
        sawClingState,
        supportedTarget,
        instantStepResolverId: game.lastDebugLedgeClingId,
        landingResolverId: game.lastDebugLedgeLandingId,
      };
    };
    const lowerToMiddle = performInstantStepJump(lowerSource, middleTarget);
    const middleToUpper = performInstantStepJump(middleTarget, upper);

    // Probe the opt-in Ruby fallback directly with valid live candidate geometry.
    // The real-physics transitions above may resolve through ordinary landing when
    // their center aim clears the rim, so they intentionally do not require a
    // particular diagnostic ID.
    const fallbackCandidate = game
      ._createPlatformLedgeCandidates(middleTarget.platformCollider)[0];
    const fallbackDirection = fallbackCandidate.normal.clone().multiplyScalar(-1);
    player.ledgeCling = null;
    player.root.position.copy(fallbackCandidate.center)
      .addScaledVector(fallbackCandidate.normal, 0.42)
      .setY(fallbackCandidate.topY - 0.2);
    player.modelRoot.position.y = 0;
    player.jumpState = 'Falling';
    player.grounded = false;
    player.onGround = false;
    player.velocity.copy(fallbackDirection).multiplyScalar(1.2);
    player.velocity.y = -0.4;
    game.lastDebugLedgeLandingId = null;
    game.lastDebugLedgeClingId = null;
    const fallbackResolved = game._tryResolveDebugLedgeCling({
      player,
      root: player.root,
      jumpDirection: fallbackDirection,
      progress: 0.5,
      jumpStartY: lowerSource.platformCollider.topY,
      jumpReachHeight: player.getJumpReachHeight(),
    }, [fallbackCandidate]);
    const fallbackSupport = game.getPlatformSupport(player.root.position)?.surface ?? null;
    const instantStepFallback = {
      candidateId: fallbackCandidate.id,
      candidateMode: fallbackCandidate.ledgeCatchMode,
      resolved: fallbackResolved,
      resolverId: game.lastDebugLedgeClingId,
      jumpState: player.jumpState,
      hasClingState: Boolean(player.ledgeCling),
      supportedTarget: fallbackSupport === middleTarget.platformCollider,
    };

    const output = {
      minimumLowerMiddleRoutes,
      minimumMiddleUpperRoutes,
      upperLandingWidth: upper.platformCollider.radius * 2,
      minimumLandingWidth: PLAYER_TRAVERSAL_ENVELOPE.minimumLandingWidth,
      landedOnFloor,
      floorLandingY: player.root.position.y,
      recoveredLensIndex,
      fallFrames,
      recoveryFrames,
      recoveryJumpStarted,
      recoveryJumpState: player.jumpState,
      sawLedgeCling,
      lowerToMiddle,
      middleToUpper,
      instantStepFallback,
      floorLandingPosition: floorLandingPosition.toArray(),
      floorWalkDistance,
      recoveryPosition: player.root.position.toArray(),
      recoveryTargetPosition: nearestLower.platformCollider.center.toArray(),
      recoveryTargetDistance: Math.hypot(
        player.root.position.x - nearestLower.platformCollider.center.x,
        player.root.position.z - nearestLower.platformCollider.center.z,
      ),
      withinArena: Math.hypot(
        player.root.position.x - encounter.center.x,
        player.root.position.z - encounter.center.z,
      ) <= game.arenaRadius,
    };
    boss.dispose();
    boss.root.removeFromParent();
    const bossIndex = game.enemies.indexOf(boss);
    if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);
    return output;
  });

  expect(result.minimumLowerMiddleRoutes).toBeGreaterThanOrEqual(2);
  expect(result.minimumMiddleUpperRoutes).toBeGreaterThanOrEqual(1);
  expect(result.upperLandingWidth).toBeGreaterThanOrEqual(result.minimumLandingWidth);
  expect(result.landedOnFloor).toBe(true);
  expect(result.floorWalkDistance).toBeLessThanOrEqual(6.5);
  expect(result.recoveredLensIndex, JSON.stringify(result)).not.toBeNull();
  expect(result.sawLedgeCling).toBe(false);
  expect(result.fallFrames).toBeLessThan(240);
  expect(result.recoveryFrames).toBeLessThan(180);
  expect(result.withinArena).toBe(true);
  for (const jump of [result.lowerToMiddle, result.middleToUpper]) {
    expect(jump.jumpStarted).toBe(true);
    expect(jump.rise).toBeGreaterThan(1.65);
    expect(jump.frames).toBeLessThan(180);
    expect(jump.sawClingState).toBe(false);
    expect(jump.supportedTarget, JSON.stringify(jump)).toBe(true);
  }
  expect(result.lowerToMiddle.rise).toBeCloseTo(1.85, 2);
  expect(result.middleToUpper.rise).toBeCloseTo(1.95, 2);
  expect(result.instantStepFallback.candidateMode).toBe('instant-step');
  expect(result.instantStepFallback.resolved, JSON.stringify(result.instantStepFallback)).toBe(true);
  expect(result.instantStepFallback.resolverId).toBe(result.instantStepFallback.candidateId);
  expect(result.instantStepFallback.jumpState).toBe('Grounded');
  expect(result.instantStepFallback.hasClingState).toBe(false);
  expect(result.instantStepFallback.supportedTarget).toBe(true);
});

test('Ruby phase-two scheduler stays within caps at 30, 60, and 120 Hz and releases scene-owned resources', async ({ page }) => {
  test.slow();
  await page.goto('/?bossDebug=1&reaverbotSeed=ruby-phase-two-stress');
  await waitForGame(page);

  const runs = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const originalTakeDamage = game.player.takeDamage;
    game.player.takeDamage = () => 0;
    const output = [];

    for (const rate of [30, 60, 120]) {
      const boss = game.debugSpawnBoss('rubyOpticOracle').boss;
      const encounter = boss.specialEncounter;
      encounter.initialize(game);
      boss.bossState.phase = 2;
      boss.bossState.transitionRemaining = 0;
      boss.bossState.interruptRemaining = 0;

      for (let index = 0; index < 40; index += 1) {
        encounter.debugStartAttack('singleLens', game);
      }
      let synchronousPathRoots = 0;
      game.scene.traverse((object) => {
        if (object.userData?.rubyBeamPath) synchronousPathRoots += 1;
      });
      const synchronousPathEntries = encounter.paths.length;
      encounter.cancelCurrentAttack(game, 'stress-reset');

      game.player.dead = false;
      game.player.health = game.player.stats.maxHealth;
      game.player.powerKnockbackState = null;
      game.player.jumpState = 'Grounded';
      game.player.velocity.set(0, 0, 0);
      game.player.root.position.set(encounter.center.x, encounter.floorY, encounter.center.z);
      game.dungeonController.lastSafePlayerPosition.copy(game.player.root.position);

      encounter.ascensionDue = 0.8;
      encounter.attackCooldown = 0;
      const attacksSeen = new Set();
      const attackLog = [];
      const attackStartTimes = [];
      const observedHazardPaths = new WeakSet();
      const occupiedAscensions = new Set();
      let observedAttackSerial = -1;
      let previousAttackType = null;
      let ascensionCompletions = 0;
      let platformHazardsSeen = 0;
      let maxTelegraphs = 0;
      let maxConstructs = 0;
      let maxProjectiles = 0;
      let maxPathRoots = 0;
      const dt = 1 / rate;
      let elapsed = 0;
      let completedStressRun = false;
      const fullDeck = [
        'directBeam',
        'singleLens',
        'crossingReflection',
        'refractionCascade',
        'shutterFlash',
      ];
      for (let frame = 0; frame < 75 * rate; frame += 1) {
        elapsed += dt;
        if (!encounter.attack
          && encounter.staggerRemaining <= 0
          && encounter.burstRecoveryRemaining <= 0) {
          encounter.attackCooldown = Math.min(encounter.attackCooldown, 0.18);
        }
        if (encounter.attack?.type === 'ascension'
          && encounter.attack.stage === 'channel'
          && !occupiedAscensions.has(encounter.attackSerial)) {
          const occupiedLens = encounter.lenses.find((lens) => lens.tier === 'lower');
          game.player.root.position.copy(occupiedLens.platformCollider.center);
          game.player.root.position.y = occupiedLens.platformCollider.topY;
          game.player.jumpState = 'Grounded';
          game.player.grounded = true;
          game.player.onGround = true;
          game.player.velocity.set(0, 0, 0);
          game.dungeonController.lastSafePlayerPosition.copy(game.player.root.position);
          occupiedAscensions.add(encounter.attackSerial);
        }
        boss.prePlayerUpdate(dt, game);
        boss.update(dt, game);
        game.projectiles.update(dt);
        game._updateTimedEffects(dt);
        game._updateParticles(dt);
        game._updatePendingExplosions();

        const currentAttackType = encounter.attack?.type ?? null;
        if (currentAttackType && encounter.attackSerial !== observedAttackSerial) {
          observedAttackSerial = encounter.attackSerial;
          attacksSeen.add(currentAttackType);
          attackLog.push(currentAttackType);
          attackStartTimes.push(elapsed);
        }
        if (previousAttackType === 'ascension' && currentAttackType !== 'ascension') {
          ascensionCompletions += 1;
        }
        previousAttackType = currentAttackType;
        const platformHazardPath = encounter.attack?.platformHazard?.path;
        if (platformHazardPath && !observedHazardPaths.has(platformHazardPath)) {
          observedHazardPaths.add(platformHazardPath);
          platformHazardsSeen += 1;
        }
        const counts = boss.getBossResourceCounts(game);
        maxTelegraphs = Math.max(maxTelegraphs, counts.telegraphs);
        maxConstructs = Math.max(maxConstructs, counts.constructs);
        maxProjectiles = Math.max(maxProjectiles, counts.projectiles);
        maxPathRoots = Math.max(
          maxPathRoots,
          encounter.paths.filter((path) => !path.complete && path.root.parent === game.scene).length,
        );

        const sawFullDeck = fullDeck.every((type) => attacksSeen.has(type));
        if (ascensionCompletions >= 2 && sawFullDeck && !encounter.attack) {
          completedStressRun = true;
          break;
        }
      }

      const sceneOwnedRoots = [
        encounter.observatory?.root,
        encounter.emitter?.root,
        encounter.emitter?.feedBeamRoot,
        encounter.channelMeter?.root,
        ...encounter.lenses.map((lens) => lens.orbitPivot),
        ...encounter.paths.map((path) => path.root),
      ].filter(Boolean);
      const trackedResources = new Set();
      for (const root of sceneOwnedRoots) {
        root.traverse((object) => {
          if (object.geometry) trackedResources.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (material) trackedResources.add(material);
          }
        });
      }
      const disposeCounts = new Map([...trackedResources].map((resource) => [resource, 0]));
      for (const resource of trackedResources) {
        resource.addEventListener('dispose', () => {
          disposeCounts.set(resource, (disposeCounts.get(resource) ?? 0) + 1);
        });
      }
      boss.dispose();
      let remnants = 0;
      game.scene.traverse((object) => {
        if (object.name === 'rubyOracleObservatoryArena'
          || object.name === 'rubyCeilingEmitter'
          || object.name === 'rubyCeilingEmitterFeedBeam'
          || object.name === 'rubyOracleEyeChannelMeter'
          || object.name.startsWith('rubyOrbitalLensOrbit_')
          || object.userData?.rubyEnergyFeed
          || object.userData?.rubyBeamPath) remnants += 1;
      });
      output.push({
        rate,
        attacksSeen: [...attacksSeen],
        attackLog,
        attackStartTimes,
        elapsed,
        completedStressRun,
        ascensionStarts: attackLog.filter((type) => type === 'ascension').length,
        ascensionCompletions,
        platformHazardsSeen,
        synchronousPathRoots,
        synchronousPathEntries,
        maxTelegraphs,
        maxConstructs,
        maxProjectiles,
        maxPathRoots,
        remnants,
        dynamicPlatforms: game.dynamicPlatformingPlatforms.length,
        sceneOwnedRootsDetached: sceneOwnedRoots.every((root) => root.parent === null),
        trackedResourceCount: trackedResources.size,
        undisposedResourceCount: [...disposeCounts.values()].filter((count) => count === 0).length,
        multiplyDisposedResourceCount: [...disposeCounts.values()].filter((count) => count > 1).length,
      });
      boss.root.removeFromParent();
      const bossIndex = game.enemies.indexOf(boss);
      if (bossIndex >= 0) game.enemies.splice(bossIndex, 1);
      if (game.activeReaverbotBoss === boss) game.activeReaverbotBoss = null;
    }
    game.player.takeDamage = originalTakeDamage;
    return output;
  });

  const baseline = runs[0];
  for (const run of runs) {
    expect(run.synchronousPathRoots).toBe(1);
    expect(run.synchronousPathEntries).toBe(1);
    expect(run.completedStressRun).toBe(true);
    expect(run.attacksSeen).toEqual(expect.arrayContaining([
      'directBeam',
      'singleLens',
      'crossingReflection',
      'refractionCascade',
      'shutterFlash',
      'ascension',
    ]));
    expect(run.ascensionStarts).toBeGreaterThanOrEqual(2);
    expect(run.ascensionCompletions).toBeGreaterThanOrEqual(2);
    expect(run.platformHazardsSeen).toBeGreaterThanOrEqual(2);
    expect(run.maxTelegraphs).toBe(12);
    expect(run.maxConstructs).toBe(6);
    expect(run.maxProjectiles).toBeLessThanOrEqual(20);
    expect(run.maxPathRoots).toBe(6);
    expect(run.remnants).toBe(0);
    expect(run.dynamicPlatforms).toBe(0);
    expect(run.sceneOwnedRootsDetached).toBe(true);
    expect(run.trackedResourceCount).toBeGreaterThan(0);
    expect(run.undisposedResourceCount).toBe(0);
    expect(run.multiplyDisposedResourceCount).toBe(0);
    expect(run.attackLog).toEqual(baseline.attackLog);
    expect(run.attackStartTimes).toHaveLength(baseline.attackStartTimes.length);
    run.attackStartTimes.forEach((startedAt, index) => {
      expect(Math.abs(startedAt - baseline.attackStartTimes[index])).toBeLessThanOrEqual(0.35);
    });
    expect(Math.abs(run.elapsed - baseline.elapsed)).toBeLessThanOrEqual(0.35);
  }
});

test('Ruby defeat, retry, and boss death clean the encounter in the same frame', async ({ page }) => {
  await page.goto('/?bossDebug=1&reaverbotSeed=ruby-death-retry-cleanup');
  await waitForGame(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const first = game.debugSpawnBoss('rubyOpticOracle').boss;
    const firstEncounter = first.specialEncounter;
    firstEncounter.initialize(game);
    first.bossState.phase = 2;
    first.bossState.transitionRemaining = 0;
    first.bossState.interruptRemaining = 0;
    game.player.dead = false;
    game.player.health = 1;
    game.player.powerKnockbackState = null;
    firstEncounter.debugStartAttack('ascension', game);
    firstEncounter.attack.stage = 'channel';
    firstEncounter.attack.channelElapsed = 10.95;
    first.update(0.1, game);
    const defeat = {
      playerDead: game.player.dead,
      disposed: firstEncounter.disposed,
      resources: first.getBossResourceCounts(game),
      dynamicPlatforms: game.dynamicPlatformingPlatforms.length,
    };

    game.player.dead = false;
    game.player.health = game.player.stats.maxHealth;
    game.player.powerKnockbackState = null;
    const retry = game.debugSpawnBoss('rubyOpticOracle').boss;
    retry.specialEncounter.initialize(game);
    const retryConstructs = retry.getBossResourceCounts(game).constructs;
    retry.bossState.phase = 2;
    retry.bossState.transitionRemaining = 0;
    retry.health = 1;
    retry.takeDamage(9999, {
      projectileHit: true,
      directHit: true,
      playerOwnedAttack: true,
      source: game.player,
    });
    retry.update(1 / 60, game);
    const victory = {
      bossDead: retry.dead,
      disposed: retry.specialEncounter.disposed,
      resources: retry.getBossResourceCounts(game),
      dynamicPlatforms: game.dynamicPlatformingPlatforms.length,
    };
    return { defeat, retryConstructs, victory };
  });

  expect(result.defeat).toEqual({
    playerDead: true,
    disposed: true,
    resources: { projectiles: 0, telegraphs: 0, constructs: 0 },
    dynamicPlatforms: 0,
  });
  expect(result.retryConstructs).toBe(6);
  expect(result.victory).toEqual({
    bossDead: true,
    disposed: true,
    resources: { projectiles: 0, telegraphs: 0, constructs: 0 },
    dynamicPlatforms: 0,
  });
});
