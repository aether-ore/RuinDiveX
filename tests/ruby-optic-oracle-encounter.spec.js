import { expect, test } from '@playwright/test';

async function waitForGame(page) {
  await page.waitForFunction(() => Boolean(window.game?.spawner && window.game?.ui));
}

async function openRubyEncounter(page, seed) {
  await page.goto(`/?bossDebug=1&reaverbotSeed=${seed}`);
  await waitForGame(page);
  await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const spawned = game.debugSpawnBoss('rubyOpticOracle');
    if (!spawned.ok) throw new Error(spawned.message ?? spawned.reason);
    window.rubyEncounterBoss = spawned.boss;
    spawned.boss._runtimeGame = game;
    spawned.boss._ensureArenaConstructs(game);
  });
}

test('Ruby observatory installs six moving lens platforms and carries grounded support before movement', async ({ page }) => {
  await openRubyEncounter(page, 'ruby-observatory-platforms');

  const result = await page.evaluate(() => {
    const game = window.game;
    const boss = window.rubyEncounterBoss;
    const encounter = boss.specialEncounter;
    const lens = encounter.lenses[0];
    const collider = lens.platformCollider;
    game.player.jumpState = 'Grounded';
    game.player.velocity.set(0, 0, 0);
    game.player.root.position.copy(collider.center);
    game.player.root.position.y = collider.topY;
    game.dungeonController.lastSafePlayerPosition.copy(game.player.root.position);

    const playerBefore = game.player.root.position.clone();
    boss.prePlayerUpdate(0.5, game);
    const playerAfter = game.player.root.position.clone();
    const localOffset = playerAfter.clone().sub(collider.center).setY(0).length();
    const supported = lens.supportingPlayer;

    encounter.debugStartAttack('singleLens', game);
    const selectedIndex = encounter.attack.lenses[0].index;
    const stateBeforeDispose = {
      initialized: encounter.initialized,
      lensCount: encounter.lenses.length,
      selectedIndex,
      movingDistance: playerAfter.distanceTo(playerBefore),
      localOffset,
      supported,
      platformY: collider.topY,
      playerY: playerAfter.y,
      dynamicPlatforms: game.dynamicPlatformingPlatforms.length,
      resources: boss.getBossResourceCounts(game),
      observatoryAttached: encounter.observatory.root.parent === game.scene,
      emitterAttached: encounter.emitter.root.parent === game.scene,
      genericConstructs: boss.bossState.constructs.length,
    };

    const lateOccupiedLens = encounter.attack.lenses[0];
    game.player.root.position.copy(lateOccupiedLens.platformCollider.center);
    game.player.root.position.y = lateOccupiedLens.platformCollider.topY;
    for (let frame = 0; frame < 60; frame += 1) {
      boss.prePlayerUpdate(1 / 60, game);
      encounter.update(1 / 60, game);
    }
    stateBeforeDispose.lateOccupancyCancelled = encounter.attack === null;
    stateBeforeDispose.lateOccupiedLensRaised = lateOccupiedLens.state === 'ACTIVE_MIRROR';

    boss.dispose();
    return {
      ...stateBeforeDispose,
      dynamicPlatformsAfterDispose: game.dynamicPlatformingPlatforms.length,
      observatoryRemnants: game.scene.children.filter((object) => (
        object.name === 'rubyOracleObservatoryArena'
        || object.name === 'rubyCeilingEmitter'
        || object.name.startsWith('rubyOrbitalLensOrbit_')
      )).length,
    };
  });

  expect(result).toMatchObject({
    initialized: true,
    lensCount: 6,
    supported: true,
    dynamicPlatforms: 6,
    resources: { projectiles: 0, constructs: 6 },
    observatoryAttached: true,
    emitterAttached: true,
    genericConstructs: 0,
    lateOccupancyCancelled: true,
    lateOccupiedLensRaised: false,
    dynamicPlatformsAfterDispose: 0,
    observatoryRemnants: 0,
  });
  expect(result.selectedIndex).not.toBe(0);
  expect(result.movingDistance).toBeGreaterThan(0.2);
  expect(result.localOffset).toBeLessThan(0.02);
  expect(result.playerY).toBeCloseTo(result.platformY, 5);
  expect(result.resources.telegraphs).toBeLessThanOrEqual(12);
});

test('Ruby keeps a centered, player-facing planetarium whose live lenses anchor both phases', async ({ page }) => {
  await openRubyEncounter(page, 'ruby-planetarium-orbits');

  const result = await page.evaluate(() => {
    const game = window.game;
    const boss = window.rubyEncounterBoss;
    const encounter = boss.specialEncounter;
    const Vector3 = boss.root.position.constructor;
    const up = new Vector3(0, 1, 0);
    encounter.attackCooldown = Infinity;
    encounter.ascensionDue = Infinity;
    boss.bossState.transitionRemaining = 0;
    boss.bossState.interruptRemaining = 0;

    const snapshotFormation = () => {
      const positions = encounter.lenses.map((lens) => lens.getWorldPosition(new Vector3()));
      const heights = encounter.lenses.map((lens) => lens.platformCollider.topY - encounter.floorY);
      let minimumClearance = Infinity;
      for (let index = 0; index < encounter.lenses.length; index += 1) {
        for (let other = index + 1; other < encounter.lenses.length; other += 1) {
          minimumClearance = Math.min(
            minimumClearance,
            positions[index].distanceTo(positions[other])
              - encounter.lenses[index].size * 0.97
              - encounter.lenses[other].size * 0.97,
          );
        }
      }
      return {
        positions,
        minimumClearance,
        minimumHeight: Math.min(...heights),
        maximumHeight: Math.max(...heights),
        minimumRadius: Math.min(...encounter.lenses.map((lens) => Math.hypot(
          lens.platformCollider.center.x - encounter.center.x,
          lens.platformCollider.center.z - encounter.center.z,
        ))),
        maximumRadius: Math.max(...encounter.lenses.map((lens) => Math.hypot(
          lens.platformCollider.center.x - encounter.center.x,
          lens.platformCollider.center.z - encounter.center.z,
        ))),
        inert: encounter.lenses.every((lens) => lens.state === 'INERT_PLATFORM'),
        collidersEnabled: encounter.lenses.every((lens) => lens.platformCollider.enabled),
        horizontal: encounter.lenses.every((lens) => (
          up.clone().applyQuaternion(lens.tiltPivot.quaternion).dot(up) > 0.999
        )),
      };
    };
    const facingDot = () => {
      const direction = game.player.root.position.clone().sub(boss.root.position).setY(0).normalize();
      const forward = new Vector3(Math.sin(boss.root.rotation.y), 0, Math.cos(boss.root.rotation.y));
      return forward.dot(direction);
    };
    const centerError = () => Math.hypot(
      boss.root.position.x - encounter.center.x,
      boss.root.position.z - encounter.center.z,
    );
    const advanceStableFormation = (seconds) => {
      const start = snapshotFormation();
      let minimumClearance = start.minimumClearance;
      const frames = Math.ceil(seconds * 60);
      for (let frame = 0; frame < frames; frame += 1) {
        boss.prePlayerUpdate(1 / 60, game);
        boss.update(1 / 60, game);
        minimumClearance = Math.min(minimumClearance, snapshotFormation().minimumClearance);
      }
      const end = snapshotFormation();
      return {
        start,
        end,
        minimumClearance,
        minimumMotion: Math.min(...start.positions.map((position, index) => (
          position.distanceTo(end.positions[index])
        ))),
      };
    };

    game.player.root.position.set(encounter.center.x + 5, encounter.floorY, encounter.center.z - 3);
    boss.update(0.6, game);
    const phaseOneCenterError = centerError();
    const phaseOneFacing = facingDot();
    const phaseOne = advanceStableFormation(6);

    encounter.debugStartAttack('singleLens', game);
    const phaseOneLens = encounter.attack.lenses[0];
    const phaseOnePath = encounter.attack.path;
    const phaseOneLensBefore = phaseOneLens.getBeamJunctionPosition(new Vector3());
    const phaseOneLayoutBefore = [
      phaseOneLens.orbitRadius,
      phaseOneLens.orbitHeight,
      phaseOneLens.verticalAmplitude,
    ];
    boss.prePlayerUpdate(0.5, game);
    boss.update(0.5, game);
    const phaseOneLensAfter = phaseOneLens.getBeamJunctionPosition(new Vector3());
    const phaseOneIncomingEnd = phaseOnePath.segments[0].getEnd(new Vector3());
    const phaseOneOutgoingStart = phaseOnePath.segments[1].getStart(new Vector3());
    const phaseOneBeam = {
      moved: phaseOneLensBefore.distanceTo(phaseOneLensAfter),
      incomingError: phaseOneIncomingEnd.distanceTo(phaseOneLensAfter),
      outgoingError: phaseOneOutgoingStart.distanceTo(phaseOneLensAfter),
      layoutDrift: Math.max(
        Math.abs(phaseOneLens.orbitRadius - phaseOneLayoutBefore[0]),
        Math.abs(phaseOneLens.orbitHeight - phaseOneLayoutBefore[1]),
        Math.abs(phaseOneLens.verticalAmplitude - phaseOneLayoutBefore[2]),
      ),
    };
    encounter.cancelCurrentAttack(game, 'planetarium-phase-one-complete');

    boss.bossState.phase = 2;
    encounter.beginPhaseTwo(game);
    encounter.ascensionDue = Infinity;
    encounter.attackCooldown = Infinity;
    let phaseTransitionMinimumClearance = Infinity;
    for (let frame = 0; frame < 180; frame += 1) {
      boss.prePlayerUpdate(1 / 60, game);
      boss.update(1 / 60, game);
      phaseTransitionMinimumClearance = Math.min(
        phaseTransitionMinimumClearance,
        snapshotFormation().minimumClearance,
      );
    }
    game.player.root.position.set(encounter.center.x - 4, encounter.floorY, encounter.center.z + 4);
    boss.update(0.6, game);
    const phaseTwoCenterError = centerError();
    const phaseTwoFacing = facingDot();
    const phaseTwo = advanceStableFormation(6);

    encounter.debugStartAttack('refractionCascade', game);
    const [firstLens, secondLens] = encounter.attack.lenses;
    const incomingPath = encounter.attack.paths.find((path) => path.role.endsWith(':incoming'));
    const outgoingPath = encounter.attack.paths.find((path) => path.role.endsWith(':outgoing'));
    const firstBefore = firstLens.getBeamJunctionPosition(new Vector3());
    const secondBefore = secondLens.getBeamJunctionPosition(new Vector3());
    boss.prePlayerUpdate(0.5, game);
    boss.update(0.5, game);
    const firstAfter = firstLens.getBeamJunctionPosition(new Vector3());
    const secondAfter = secondLens.getBeamJunctionPosition(new Vector3());
    const phaseTwoBeam = {
      firstMoved: firstBefore.distanceTo(firstAfter),
      secondMoved: secondBefore.distanceTo(secondAfter),
      eyeToFirstError: incomingPath.segments[0].getEnd(new Vector3()).distanceTo(firstAfter),
      firstChainStartError: incomingPath.segments[1].getStart(new Vector3()).distanceTo(firstAfter),
      secondChainEndError: incomingPath.segments[1].getEnd(new Vector3()).distanceTo(secondAfter),
      outgoingStartError: outgoingPath.segments[0].getStart(new Vector3()).distanceTo(secondAfter),
      junctionHeightDifference: Math.abs(firstAfter.y - secondAfter.y),
      unselectedInert: encounter.lenses
        .filter((lens) => lens !== firstLens && lens !== secondLens)
        .every((lens) => lens.state === 'INERT_PLATFORM'),
    };

    return {
      phaseOne: {
        ...phaseOne,
        centerError: phaseOneCenterError,
        facing: phaseOneFacing,
      },
      phaseTwo: {
        ...phaseTwo,
        centerError: phaseTwoCenterError,
        facing: phaseTwoFacing,
      },
      phaseTransitionMinimumClearance,
      phaseOneBeam,
      phaseTwoBeam,
      planetariumGuideCount: encounter.observatory.root.children.filter((object) => (
        object.name.startsWith('rubyObservatoryPlanetariumRing_')
      )).length,
    };
  });

  for (const phase of [result.phaseOne, result.phaseTwo]) {
    expect(phase.start.inert).toBe(true);
    expect(phase.end.inert).toBe(true);
    expect(phase.end.collidersEnabled).toBe(true);
    expect(phase.end.horizontal).toBe(true);
    expect(phase.end.minimumHeight).toBeGreaterThan(1.3);
    expect(phase.end.maximumHeight - phase.end.minimumHeight).toBeGreaterThan(5);
    expect(phase.end.maximumRadius - phase.end.minimumRadius).toBeGreaterThan(3.6);
    expect(phase.minimumClearance).toBeGreaterThan(0.15);
    expect(phase.minimumMotion).toBeGreaterThan(0.5);
    expect(phase.centerError).toBeLessThan(0.001);
    expect(phase.facing).toBeGreaterThan(0.999);
  }
  expect(result.phaseTransitionMinimumClearance).toBeGreaterThan(0.15);
  expect(result.phaseOneBeam.moved).toBeGreaterThan(0.1);
  expect(result.phaseOneBeam.incomingError).toBeLessThan(0.001);
  expect(result.phaseOneBeam.outgoingError).toBeLessThan(0.001);
  expect(result.phaseOneBeam.layoutDrift).toBeLessThan(0.000001);
  expect(result.phaseTwoBeam.firstMoved).toBeGreaterThan(0.1);
  expect(result.phaseTwoBeam.secondMoved).toBeGreaterThan(0.1);
  expect(result.phaseTwoBeam.eyeToFirstError).toBeLessThan(0.001);
  expect(result.phaseTwoBeam.firstChainStartError).toBeLessThan(0.001);
  expect(result.phaseTwoBeam.secondChainEndError).toBeLessThan(0.001);
  expect(result.phaseTwoBeam.outgoingStartError).toBeLessThan(0.001);
  expect(result.phaseTwoBeam.junctionHeightDifference).toBeGreaterThan(1.5);
  expect(result.phaseTwoBeam.unselectedInert).toBe(true);
  expect(result.planetariumGuideCount).toBe(3);
});

test('active mirrors accept point, line, and arc hits while splash is ignored and knockdown cancels the route', async ({ page }) => {
  await openRubyEncounter(page, 'ruby-mirror-interruption');

  const result = await page.evaluate(() => {
    const game = window.game;
    const boss = window.rubyEncounterBoss;
    const encounter = boss.specialEncounter;
    encounter.debugStartAttack('singleLens', game);
    const lens = encounter.attack.lenses[0];
    const target = lens.combatTarget;
    const position = lens.getWorldPosition(new boss.root.position.constructor());
    const lineStart = position.clone();
    lineStart.z -= 4;
    const lineDirection = position.clone().sub(lineStart).normalize();
    const arcOrigin = position.clone();
    arcOrigin.z -= 2;
    const arcDirection = position.clone().sub(arcOrigin).setY(0).normalize();

    const pointHit = boss.resolveProjectileHit(position, 0.12);
    const lineHit = boss.resolveLineHit(lineStart, lineDirection, 8, 0.12);
    const arcHit = boss.resolveArcHit(arcOrigin, arcDirection, 3, 0.4);
    const healthBefore = boss.health;
    boss.takeDamage(99, {
      hitPartId: target.partId,
      explosionSplash: true,
      areaDamage: true,
      source: game.player,
    });
    const hitsAfterSplash = lens.stabilityHits;
    game.combat.lockOn.target = target;
    game.combat.lockOn.progress = 0.67;
    for (let index = 0; index < 3; index += 1) {
      boss.takeDamage(1, {
        hitPartId: target.partId,
        projectileHit: true,
        playerOwnedAttack: true,
        source: game.player,
        executionId: `mirror-shot-${index}`,
      });
    }
    return {
      pointPart: pointHit?.hitPartId,
      linePart: lineHit?.hitPartId,
      arcPart: arcHit?.hitPartId,
      targetPart: target.partId,
      hitsAfterSplash,
      state: lens.state,
      routeInterrupted: encounter.attack.interrupted,
      associatedPathsCancelled: encounter.paths
        .filter((path) => path.referencesLens(lens))
        .every((path) => path.complete),
      healthUnchanged: boss.health === healthBefore,
      lockTargetIsBoss: game.combat.lockOn.target === boss,
      lockProgress: game.combat.lockOn.progress,
    };
  });

  expect(result.pointPart).toBe(result.targetPart);
  expect(result.linePart).toBe(result.targetPart);
  expect(result.arcPart).toBe(result.targetPart);
  expect(result).toMatchObject({
    hitsAfterSplash: 0,
    state: 'KNOCKED_DOWN',
    routeInterrupted: true,
    associatedPathsCancelled: true,
    healthUnchanged: true,
    lockTargetIsBoss: true,
    lockProgress: 0.67,
  });
});

test('crossing, cascade, and Ascension expose their authored interruption and stagger rules', async ({ page }) => {
  await openRubyEncounter(page, 'ruby-phase-two-patterns');

  const result = await page.evaluate(() => {
    const game = window.game;
    const boss = window.rubyEncounterBoss;
    const encounter = boss.specialEncounter;
    boss.bossState.phase = 2;
    boss.bossState.transitionRemaining = 0;
    boss.bossState.interruptRemaining = 0;

    encounter.debugStartAttack('crossingReflection', game);
    const crossing = {
      lensCount: encounter.attack.lenses.length,
      segmentCount: encounter.attack.paths.reduce((sum, path) => sum + path.segments.length, 0),
      telegraphs: encounter.getResourceCounts().telegraphs,
    };
    const firstCrossingLens = encounter.attack.lenses[0];
    for (let index = 0; index < 3; index += 1) {
      firstCrossingLens.receiveDirectImpact({ projectileHit: true, executionId: `cross-${index}` }, game);
    }
    crossing.cancelledRoutes = encounter.paths.filter((path) => path.complete).length;
    crossing.liveRoutes = encounter.paths.filter((path) => !path.complete).length;

    encounter.debugStartAttack('refractionCascade', game);
    const secondCascadeLens = encounter.attack.lenses[1];
    for (let index = 0; index < 3; index += 1) {
      secondCascadeLens.receiveDirectImpact({ projectileHit: true, executionId: `cascade-second-${index}` }, game);
    }
    const secondPriority = {
      redirected: encounter.attack.redirected,
      interrupted: encounter.attack.interrupted,
      incomingLive: encounter.attack.paths.find((path) => path.role.endsWith(':incoming'))?.complete === false,
      outgoingCancelled: encounter.attack.paths.find((path) => path.role.endsWith(':outgoing'))?.complete !== false,
      redirectHarmless: encounter.attack.redirectPath?.segments.every((segment) => !segment.damaging),
    };

    encounter.debugStartAttack('refractionCascade', game);
    const cascadePaths = [...encounter.attack.paths];
    const cascadeFirstLens = encounter.attack.lenses[0];
    const cascade = {
      segmentCount: cascadePaths.reduce((sum, path) => sum + path.segments.length, 0),
      firstTier: cascadeFirstLens.tier,
      secondPriority,
    };
    for (let index = 0; index < 3; index += 1) {
      cascadeFirstLens.receiveDirectImpact({ projectileHit: true, executionId: `cascade-${index}` }, game);
    }
    cascade.cancelled = cascadePaths.every((path) => path.complete);
    cascade.interrupted = encounter.attack.interrupted;

    encounter.debugStartAttack('singleLens', game);
    const queuedMagnifiedPath = encounter.paths.find((path) => !path.complete);
    const ascensionRefusedWhileQueued = encounter._startAscension() === false;
    const queuedAttackPreserved = encounter.attack?.type === 'singleLens' && !queuedMagnifiedPath.complete;
    encounter.cancelCurrentAttack(game, 'queued-ultimate-test');

    encounter.debugStartAttack('ascension', game);
    for (let frame = 0; frame < 100; frame += 1) {
      encounter.prePlayerUpdate(1 / 60, game);
      encounter.update(1 / 60, game);
    }
    const channelLockedBeforeUpper = !encounter.isChannelCoreActive();
    const upperLens = encounter.lenses.find((lens) => lens.tier === 'upper');
    game.player.root.position.copy(upperLens.platformCollider.center);
    game.player.root.position.y = upperLens.platformCollider.topY;
    game.player.jumpState = 'Grounded';
    game.player.grounded = true;
    game.player.onGround = true;
    encounter.prePlayerUpdate(1 / 60, game);
    encounter.update(1 / 60, game);
    const originalPlayerTakeDamage = game.player.takeDamage;
    game.player.takeDamage = () => 0;
    const channelRangeLimit = game.player.stats.attackRange;
    let maximumChannelCoreRange = 0;
    let channelRangeSamples = 0;
    let upperSupportStayedResolved = true;
    for (let frame = 0; frame < 660
      && encounter.attack?.type === 'ascension'
      && encounter.attack.stage === 'channel'
      && encounter.attack.channelElapsed < 10.82; frame += 1) {
      boss.prePlayerUpdate(1 / 60, game);
      boss.update(1 / 60, game);
      const support = game.getPlatformSupport(game.player.root.position)?.surface ?? null;
      upperSupportStayedResolved &&= support === upperLens.platformCollider
        && upperLens.supportingPlayer;
      const muzzlePosition = game.player.getProjectileOrigin();
      const corePosition = encounter.channelCoreTarget.getWorldPosition(
        new boss.root.position.constructor(),
      );
      maximumChannelCoreRange = Math.max(
        maximumChannelCoreRange,
        muzzlePosition.distanceTo(corePosition),
      );
      channelRangeSamples += 1;
    }
    game.player.takeDamage = originalPlayerTakeDamage;
    const ascension = {
      stage: encounter.attack.stage,
      channelActive: encounter.isChannelCoreActive(),
      targetActive: encounter.channelCoreTarget.active,
      channelLockedBeforeUpper,
      ascensionRefusedWhileQueued,
      queuedAttackPreserved,
      lowerHeight: encounter.lenses[0].platformCollider.topY - encounter.floorY,
      middleHeight: encounter.lenses[3].platformCollider.topY - encounter.floorY,
      upperHeight: encounter.lenses[5].platformCollider.topY - encounter.floorY,
      upperEyeRange: encounter.lenses[5].getWorldPosition(new boss.root.position.constructor())
        .distanceTo(encounter.getEyePosition(new boss.root.position.constructor())),
      channelElapsedAtInterrupt: encounter.attack.channelElapsed,
      channelRangeLimit,
      maximumChannelCoreRange,
      channelRangeSamples,
      upperSupportStayedResolved,
    };
    const corePartId = encounter.channelCorePartId;
    for (let index = 0; index < 6; index += 1) {
      boss.takeDamage(1, {
        hitPartId: corePartId,
        projectileHit: true,
        signaturePartHit: true,
        playerOwnedAttack: true,
        source: game.player,
        executionId: `channel-${index}`,
      });
    }
    const fallStartY = boss.root.position.y;
    const fallStage = encounter.attack?.stage ?? null;
    const staggerBeforeLanding = encounter.staggerRemaining;
    let previousFallY = fallStartY;
    let fallStayedMonotonic = true;
    let sawIntermediateFallPosition = false;
    for (let frame = 0; frame < 90 && encounter.attack; frame += 1) {
      encounter.prePlayerUpdate(1 / 60, game);
      encounter.update(1 / 60, game);
      const currentY = boss.root.position.y;
      fallStayedMonotonic &&= currentY <= previousFallY + 0.00001;
      sawIntermediateFallPosition ||= currentY < fallStartY - 0.1
        && currentY > encounter.floorY + 0.1;
      previousFallY = currentY;
    }
    const staggerMeta = {
      projectileHit: true,
      signaturePartHit: true,
      playerOwnedAttack: true,
      source: game.player,
    };
    boss.modifyDamageTaken(10, staggerMeta);
    ascension.success = {
      attackCleared: encounter.attack === null,
      staggerRemaining: encounter.staggerRemaining,
      repeatCooldown: encounter.ascensionDue,
      damageMultiplier: staggerMeta.rubyOracleStaggerMultiplier,
      resources: encounter.getResourceCounts(),
      fallStage,
      fallStartY,
      staggerBeforeLanding,
      fallStayedMonotonic,
      sawIntermediateFallPosition,
      landingY: boss.root.position.y,
    };
    return { crossing, cascade, ascension };
  });

  expect(result.crossing).toMatchObject({
    lensCount: 2,
    segmentCount: 4,
    telegraphs: 4,
    cancelledRoutes: 1,
    liveRoutes: 1,
  });
  expect(result.cascade).toMatchObject({
    segmentCount: 3,
    firstTier: 'lower',
    cancelled: true,
    interrupted: true,
    secondPriority: {
      redirected: true,
      interrupted: false,
      incomingLive: true,
      outgoingCancelled: true,
      redirectHarmless: true,
    },
  });
  expect(result.ascension).toMatchObject({
    stage: 'channel',
    channelActive: true,
    targetActive: true,
    channelLockedBeforeUpper: true,
    ascensionRefusedWhileQueued: true,
    queuedAttackPreserved: true,
    success: {
      attackCleared: true,
      damageMultiplier: 1.65,
      fallStage: 'falling',
      staggerBeforeLanding: 0,
      fallStayedMonotonic: true,
      sawIntermediateFallPosition: true,
      resources: { projectiles: 0, constructs: 6 },
    },
  });
  expect(result.ascension.lowerHeight).toBeCloseTo(1.35, 1);
  expect(result.ascension.middleHeight).toBeCloseTo(3.2, 1);
  expect(result.ascension.upperHeight).toBeCloseTo(5.15, 1);
  expect(result.ascension.upperEyeRange).toBeLessThan(6);
  expect(result.ascension.channelElapsedAtInterrupt).toBeGreaterThan(10.8);
  expect(result.ascension.channelRangeSamples).toBeGreaterThan(600);
  expect(result.ascension.upperSupportStayedResolved).toBe(true);
  expect(result.ascension.maximumChannelCoreRange)
    .toBeLessThanOrEqual(result.ascension.channelRangeLimit + 0.02);
  expect(result.ascension.success.staggerRemaining).toBeGreaterThan(4.4);
  expect(result.ascension.success.repeatCooldown).toBeGreaterThan(24.9);
  expect(result.ascension.success.fallStartY).toBeGreaterThan(result.ascension.success.landingY + 6);
  expect(result.ascension.success.landingY).toBeCloseTo(0, 5);
  expect(result.ascension.success.resources.telegraphs).toBeLessThanOrEqual(12);
});

test('failed Ascension deals a survivable 75-percent burst and reflects through all six lenses', async ({ page }) => {
  await openRubyEncounter(page, 'ruby-ascension-failure');

  const result = await page.evaluate(() => {
    const game = window.game;
    const boss = window.rubyEncounterBoss;
    const encounter = boss.specialEncounter;
    boss.bossState.phase = 2;
    boss.bossState.transitionRemaining = 0;
    boss.bossState.interruptRemaining = 0;
    game.player.health = game.player.stats.maxHealth;
    game.player.powerKnockbackState = null;
    encounter.debugStartAttack('ascension', game);
    let fallStartY = null;
    let previousFallY = null;
    let fallStayedMonotonic = true;
    let sawIntermediateFallPosition = false;
    for (let frame = 0; frame < 14 * 60; frame += 1) {
      encounter.prePlayerUpdate(1 / 60, game);
      encounter.update(1 / 60, game);
      if (encounter.attack?.stage === 'falling') {
        fallStartY ??= encounter.attack.fallStartY;
        const currentY = boss.root.position.y;
        if (previousFallY != null) fallStayedMonotonic &&= currentY <= previousFallY + 0.00001;
        sawIntermediateFallPosition ||= currentY < fallStartY - 0.1
          && currentY > encounter.floorY + 0.1;
        previousFallY = currentY;
      }
      if (!encounter.attack) break;
    }
    const reflectionPaths = encounter.paths.filter((path) => (
      path.role.startsWith('allSeeingBurstReflection:')
    ));
    return {
      healthRatio: game.player.health / game.player.stats.maxHealth,
      playerDead: game.player.dead,
      burstRecovery: encounter.burstRecoveryRemaining,
      attackCleared: encounter.attack === null,
      reflectionPathCount: reflectionPaths.length,
      reflectionSegmentCount: reflectionPaths.reduce((sum, path) => sum + path.segments.length, 0),
      telegraphs: encounter.getResourceCounts().telegraphs,
      powerKnockback: game.player.powerKnockbackState,
      fallStartY,
      fallStayedMonotonic,
      sawIntermediateFallPosition,
      landingY: boss.root.position.y,
    };
  });

  expect(result.playerDead).toBe(false);
  expect(result.healthRatio).toBeGreaterThanOrEqual(0.24);
  expect(result.healthRatio).toBeLessThanOrEqual(0.27);
  expect(result.burstRecovery).toBeGreaterThan(1.2);
  expect(result.attackCleared).toBe(true);
  expect(result.reflectionPathCount).toBe(6);
  expect(result.reflectionSegmentCount).toBe(12);
  expect(result.telegraphs).toBe(12);
  expect(result.powerKnockback).not.toBeNull();
  expect(result.fallStartY).toBeGreaterThan(result.landingY + 6);
  expect(result.fallStayedMonotonic).toBe(true);
  expect(result.sawIntermediateFallPosition).toBe(true);
  expect(result.landingY).toBeCloseTo(0, 5);
});
