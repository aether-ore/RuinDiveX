import { expect, test } from '@playwright/test';

test('pouncers replace ordinary locomotion with spring quadruped, paired spring, or mono-pogo rigs', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?startupWorld=dungeon&reaverbotSeed=pounce-spring-mobility-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();

    const removeEnemy = (enemy) => {
      const index = game.enemies.indexOf(enemy);
      if (index >= 0) game.enemies.splice(index, 1);
      enemy.dispose?.();
      enemy.root.removeFromParent();
    };
    for (const enemy of [...game.enemies]) removeEnemy(enemy);

    const spawnFixture = (seed, expectedMobility, expectedWeapon = null) => {
      const enemy = window.spawnReaverbot({
        archetypeId: 'pouncer',
        seed,
        threatTier: 2,
        encounterSize: 2,
        position: new Vector3(0, 0, 0),
      });
      if (enemy.genome.body.mobilityId !== expectedMobility
        || (expectedWeapon && enemy.genome.modules.weapon.id !== expectedWeapon)) {
        throw new Error(`Unexpected pouncer fixture ${seed}: ${enemy.genome.body.mobilityId}/${enemy.genome.modules.weapon.id}`);
      }
      return enemy;
    };

    const quadruped = spawnFixture('spring-audit:1', 'springQuadruped', 'pounceActuator');
    const monoPogo = spawnFixture('spring-audit:3', 'monoPogo', 'pounceActuator');
    const pairedSprings = spawnFixture('spring-audit:2', 'pairedSprings', 'shockPiston');
    const stagedEnemies = [quadruped, monoPogo, pairedSprings];

    const summarizeVisual = (enemy) => {
      const names = [];
      const weaponMeshes = [];
      let integratedWeaponSurfaces = 0;
      enemy.visual.root.traverse((object) => {
        names.push(object.name);
        if (object.userData?.integratedMobilityWeapon) integratedWeaponSurfaces += 1;
      });
      enemy.visual.weapon.group.traverse((object) => {
        if (object.isMesh) weaponMeshes.push(object.name);
      });
      return {
        bodyPlan: enemy.genome.body.planId,
        mobilityId: enemy.genome.body.mobilityId,
        movementModel: enemy.genome.body.movementModel,
        mobilityLegCount: enemy.genome.body.mobilityLegCount,
        visualLegCount: enemy.visual.frame.springLimbs.length,
        springCoilsPerLeg: enemy.visual.frame.springLimbs.map((limb) => limb.springCoils.length),
        integratedWeapon: enemy.visual.weapon.integratedIntoMobility,
        weaponMeshes,
        integratedWeaponSurfaces,
        faceActuatorPresent: names.some((name) => name === 'generatedPounceActuatorArmorFace'),
        standardCanineLowerLegPresent: names.some((name) => /CanineLower(Link|Armor)/.test(name)),
        monoPogoPresent: names.includes('generatedHopperMonoPogoLeg'),
        pairedLegPresent: names.some((name) => /generatedHopper(Left|Right)SpringLeg/.test(name)),
      };
    };
    const visuals = stagedEnemies.map(summarizeVisual);

    const dungeon = game.dungeonController;
    const originals = {
      getEnemyNavigationDirection: dungeon.getEnemyNavigationDirection,
      getEnemyArenaTarget: dungeon.getEnemyArenaTarget,
      getSurfaceElevationAt: dungeon.getSurfaceElevationAt,
      isEnemyPositionClear: dungeon.isEnemyPositionClear,
      isAerialPositionClear: dungeon.isAerialPositionClear,
      isPositionWalkable: dungeon.isPositionWalkable,
    };
    dungeon.getEnemyNavigationDirection = () => new Vector3(1, 0, 0);
    dungeon.getEnemyArenaTarget = (_enemy, desired, target) => target.copy(desired);
    dungeon.getSurfaceElevationAt = () => 0;
    dungeon.isEnemyPositionClear = () => true;
    dungeon.isAerialPositionClear = () => true;
    dungeon.isPositionWalkable = () => true;
    game.player.lastMoveDirection.set(0, 0, 0);

    const bounceResults = [];
    for (const [index, enemy] of stagedEnemies.entries()) {
      enemy.root.position.set(index * 8, 0, 0);
      enemy.brain.coilBounceActive = false;
      enemy.brain.coilBounceCooldown = 0;
      enemy.brain.coilBounceTime = 0;
      const start = enemy.root.position.clone();
      const approachDistance = enemy._getAttackApproachRange() + 5;
      const started = enemy._moveByMode(
        'approach',
        0.016,
        game,
        new Vector3(1, 0, 0),
        approachDistance,
      );
      const noInitialSlide = enemy.root.position.distanceTo(start) < 0.0001;
      const ignoresGround = enemy.shouldIgnoreGroundConstraint();
      const duration = enemy.brain.coilBounceDuration;
      enemy._moveByMode('approach', duration * 0.5, game, new Vector3(1, 0, 0), approachDistance);
      const apexRise = enemy.root.position.y - start.y;
      enemy._animateVisual(1);
      const tuckedInFlight = enemy.visual.frame.springMobility.airborne;
      enemy._moveByMode(
        'approach',
        duration * 0.5 + 0.02,
        game,
        new Vector3(1, 0, 0),
        approachDistance,
      );
      const landingTravel = Math.hypot(
        enemy.root.position.x - start.x,
        enemy.root.position.z - start.z,
      );
      enemy.brain.coilBounceActive = false;
      enemy.brain.coilBounceCooldown = 0;
      const heldInsideAttackRange = !enemy._moveByMode(
        'approach',
        0.016,
        game,
        new Vector3(1, 0, 0),
        enemy._getAttackApproachRange() - 0.1,
      );
      bounceResults.push({
        started,
        noInitialSlide,
        ignoresGround,
        apexRise,
        tuckedInFlight,
        landingTravel,
        heldInsideAttackRange,
      });
    }

    quadruped.root.position.set(0, 0, 0);
    quadruped.brain.coilBounceActive = false;
    quadruped.brain.coilBounceCooldown = 0;
    dungeon.isEnemyPositionClear = (_enemy, position) => position.z > 0.35;
    const alternateBounceStarted = quadruped._updateCoilBounce(
      0.016,
      game,
      new Vector3(1, 0, 0),
      1,
    );
    const alternateLandingZ = quadruped.brain.coilBounceLanding.z;
    dungeon.isEnemyPositionClear = () => true;

    quadruped.root.position.set(0, 0, 0);
    game.player.root.position.set(0, 3, 4);
    const elevatedProbeHeights = [];
    dungeon.getSurfaceElevationAt = (position) => {
      elevatedProbeHeights.push(position.y);
      return position.y >= 2 ? 3 : 0;
    };
    const elevatedLanding = new Vector3(0, 3, 4);
    const elevatedLandingResolved = quadruped._resolveSpringPounceLanding(game, elevatedLanding);
    dungeon.getSurfaceElevationAt = () => 0;

    quadruped.brain.state = 'commit';
    quadruped.brain.coilBounceActive = true;
    quadruped.brain.coilBounceTime = 0.3;
    quadruped.brain.coilBounceStart.set(-8, 0, -8);
    quadruped.brain.coilBounceLanding.set(8, 0, 8);
    const controlOwner = { kind: 'pounce-controller-reset-proof' };
    const claimedForControl = quadruped.tryClaimExternalControl(controlOwner, 'tractor');
    const stateAfterClaim = quadruped.brain.state;
    const activeAfterClaim = quadruped.brain.coilBounceActive;
    const claimStartMatchesRoot = quadruped.brain.coilBounceStart.distanceTo(quadruped.root.position) < 0.0001;
    quadruped.brain.coilBounceActive = true;
    quadruped.brain.coilBounceStart.set(-6, 0, -6);
    quadruped.brain.coilBounceLanding.set(6, 0, 6);
    const releasedFromControl = quadruped.releaseExternalControl(controlOwner, 'released');
    const activeAfterRelease = quadruped.brain.coilBounceActive;
    const releaseLandingMatchesRoot = quadruped.brain.coilBounceLanding.distanceTo(quadruped.root.position) < 0.0001;

    const shockPouncer = pairedSprings;
    shockPouncer.root.position.set(0, 0, 0);
    shockPouncer.brain.coilBounceActive = false;
    shockPouncer.brain.coilBounceCooldown = 0;
    shockPouncer.brain.state = 'position';
    shockPouncer.brain.stateTime = 0;
    shockPouncer.brain.cooldown = 0;
    shockPouncer.brain.attackFired = false;
    game.player.root.position.set(0, 0, 4.5);
    const towardPlayer = game.player.root.position.clone().sub(shockPouncer.root.position).setY(0).normalize();
    shockPouncer._updatePositionState(0.016, game, towardPlayer, 4.5);
    const ordinaryRangeTelegraph = shockPouncer.brain.state;
    const telegraphMarkerRadius = shockPouncer.brain.telegraphMarker?.geometry?.parameters?.outerRadius ?? 0;
    const resolvedLandingTravel = Math.hypot(
      shockPouncer.brain.targetPosition.x - shockPouncer.root.position.x,
      shockPouncer.brain.targetPosition.z - shockPouncer.root.position.z,
    );
    shockPouncer._updateTelegraphState(
      shockPouncer.genome.behavior.telegraphDuration + 0.01,
      game,
      towardPlayer,
    );
    const commitStart = shockPouncer.root.position.clone();
    const explosionCalls = [];
    const originalAddExplosion = game.addExplosion;
    game.addExplosion = (position, damage, radius, color, options) => {
      explosionCalls.push({ position: position.clone(), damage, radius, color, options });
    };
    // Prevent the broad apex overlap from interrupting the pounce, then allow
    // a deterministic contact on the landing frame below.
    shockPouncer.brain.attackHit = true;
    shockPouncer._updateCommitState(shockPouncer.genome.behavior.commitDuration * 0.5, game);
    const commitApexRise = shockPouncer.root.position.y - commitStart.y;
    const airborneCommitIgnoresGround = shockPouncer.shouldIgnoreGroundConstraint();
    const originalTakeDamage = game.player.takeDamage;
    game.player.takeDamage = () => 1;
    shockPouncer.brain.attackHit = false;
    shockPouncer._updateCommitState(shockPouncer.genome.behavior.commitDuration * 0.51, game);
    const landingContactStartedRetreat = Boolean(shockPouncer.contactRetreatMotion);
    const landingImpactDamagePlayer = explosionCalls[0]?.options?.damagePlayer ?? null;
    game.player.takeDamage = originalTakeDamage;
    game.addExplosion = originalAddExplosion;
    const completedAttackState = shockPouncer.brain.state;
    shockPouncer.clearExternalMotion('cleared', game);

    const closePouncer = monoPogo;
    closePouncer.root.position.set(0, 0, 0);
    closePouncer.brain.coilBounceActive = false;
    closePouncer.brain.state = 'position';
    closePouncer.brain.stateTime = 0;
    closePouncer.brain.cooldown = 0;
    game.player.root.position.set(0.1, 0, 0);
    const closeDirection = game.player.root.position.clone().sub(closePouncer.root.position).setY(0).normalize();
    closePouncer._updatePositionState(0.016, game, closeDirection, 0.1);
    const closeRangeStateDuringHandoff = closePouncer.brain.state;
    game._updateEnemyAttackDirector(0.5);
    closePouncer.brain.cooldown = 0;
    closePouncer._updatePositionState(0.016, game, closeDirection, 0.1);
    const closeRangeState = closePouncer.brain.state;
    const closeRangeLandingTravel = Math.hypot(
      closePouncer.brain.targetPosition.x - closePouncer.root.position.x,
      closePouncer.brain.targetPosition.z - closePouncer.root.position.z,
    );

    for (const [key, value] of Object.entries(originals)) dungeon[key] = value;

    const xPositions = [-3.2, 0, 3.2];
    stagedEnemies.forEach((enemy, index) => {
      enemy.root.position.set(xPositions[index], 0, 0);
      enemy.root.rotation.y = 0;
      enemy.brain.coilBounceActive = false;
      enemy.brain.state = 'telegraph';
      enemy.brain.stateTime = enemy.genome.behavior.telegraphDuration * 0.72;
      enemy._updateExposureAndDefense();
      enemy._animateVisual(1);
      enemy.root.updateMatrixWorld(true);
    });
    const stagedRoots = stagedEnemies.map((enemy) => enemy.root);
    const belongsToStage = (object) => stagedRoots.some((root) => {
      for (let current = object; current; current = current.parent) {
        if (current === root) return true;
      }
      return false;
    });
    game.scene.traverse((object) => {
      if (object.isMesh) object.visible = belongsToStage(object);
    });
    game.player.root.visible = false;
    const uiRoot = document.getElementById('ui-root');
    if (uiRoot) uiRoot.style.display = 'none';
    game.scene.fog = null;
    game.scene.background?.set?.(0x11161d);
    game.camera.position.set(0, 2.55, 10.4);
    game.camera.lookAt(new Vector3(0, 1.05, 0));
    game.camera.updateMatrixWorld(true);
    game.renderer.setAnimationLoop(() => game.renderer.render(game.scene, game.camera));

    return {
      visuals,
      bounceResults,
      alternateBounceStarted,
      alternateLandingZ,
      elevatedLanding: {
        resolved: elevatedLandingResolved,
        y: elevatedLanding.y,
        probeHeight: elevatedProbeHeights[0] ?? -1,
      },
      springControlReset: {
        claimedForControl,
        stateAfterClaim,
        activeAfterClaim,
        claimStartMatchesRoot,
        releasedFromControl,
        activeAfterRelease,
        releaseLandingMatchesRoot,
      },
      shockPouncer: {
        attackKind: shockPouncer.genome.modules.weapon.attackKind,
        ordinaryRangeTelegraph,
        telegraphMarkerRadius,
        resolvedLandingTravel,
        commitApexRise,
        airborneCommitIgnoresGround,
        completedAttackState,
        explosionCount: explosionCalls.length,
        explosionRadius: explosionCalls[0]?.radius ?? 0,
        landingContactStartedRetreat,
        landingImpactDamagePlayer,
      },
      closeRangeState,
      closeRangeStateDuringHandoff,
      closeRangeLandingTravel,
    };
  });

  expect(result.visuals).toHaveLength(3);
  expect(result.visuals.map((visual) => visual.mobilityId)).toEqual([
    'springQuadruped',
    'monoPogo',
    'pairedSprings',
  ]);
  for (const visual of result.visuals) {
    expect(visual.movementModel).toBe('springBounce');
    expect(visual.visualLegCount).toBe(visual.mobilityLegCount);
    expect(visual.springCoilsPerLeg.every((count) => count >= 4)).toBe(true);
    expect(visual.integratedWeapon).toBe(true);
    expect(visual.weaponMeshes).toEqual([]);
    expect(visual.integratedWeaponSurfaces).toBeGreaterThanOrEqual(visual.mobilityLegCount * 2);
    expect(visual.faceActuatorPresent).toBe(false);
  }
  expect(result.visuals[0].standardCanineLowerLegPresent).toBe(false);
  expect(result.visuals[1].monoPogoPresent).toBe(true);
  expect(result.visuals[1].pairedLegPresent).toBe(false);
  expect(result.visuals[2].pairedLegPresent).toBe(true);

  for (const bounce of result.bounceResults) {
    expect(bounce.started).toBe(true);
    expect(bounce.noInitialSlide).toBe(true);
    expect(bounce.ignoresGround).toBe(true);
    expect(bounce.apexRise).toBeGreaterThan(2.3);
    expect(bounce.tuckedInFlight).toBe(true);
    expect(bounce.landingTravel).toBeGreaterThan(1.5);
    expect(bounce.heldInsideAttackRange).toBe(true);
  }
  expect(result.alternateBounceStarted).toBe(true);
  expect(result.alternateLandingZ).toBeGreaterThan(0.35);
  expect(result.elevatedLanding.resolved).toBe(true);
  expect(result.elevatedLanding.y).toBe(3);
  expect(result.elevatedLanding.probeHeight).toBeGreaterThanOrEqual(3);
  expect(result.springControlReset.claimedForControl).toBe(true);
  expect(result.springControlReset.stateAfterClaim).toBe('recovery');
  expect(result.springControlReset.activeAfterClaim).toBe(false);
  expect(result.springControlReset.claimStartMatchesRoot).toBe(true);
  expect(result.springControlReset.releasedFromControl).toBe(true);
  expect(result.springControlReset.activeAfterRelease).toBe(false);
  expect(result.springControlReset.releaseLandingMatchesRoot).toBe(true);

  expect(result.shockPouncer.attackKind).toBe('pounce');
  expect(result.shockPouncer.ordinaryRangeTelegraph).toBe('telegraph');
  expect(result.shockPouncer.telegraphMarkerRadius).toBeCloseTo(2.35, 5);
  expect(result.shockPouncer.resolvedLandingTravel).toBeGreaterThan(3.5);
  expect(result.shockPouncer.commitApexRise).toBeGreaterThan(2.3);
  expect(result.shockPouncer.airborneCommitIgnoresGround).toBe(true);
  expect(result.shockPouncer.completedAttackState).toBe('recovery');
  expect(result.shockPouncer.explosionCount).toBe(1);
  expect(result.shockPouncer.explosionRadius).toBeCloseTo(2.35, 5);
  expect(result.shockPouncer.landingContactStartedRetreat).toBe(true);
  expect(result.shockPouncer.landingImpactDamagePlayer).toBe(false);
  expect(result.closeRangeStateDuringHandoff).toBe('position');
  expect(result.closeRangeState).toBe('telegraph');
  expect(result.closeRangeLandingTravel).toBeGreaterThanOrEqual(2.35);

  await page.screenshot({
    path: testInfo.outputPath('reaverbot-spring-pounce-rigs.png'),
    fullPage: false,
  });
});
