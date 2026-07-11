import { expect, test } from '@playwright/test';

test('aerial navigation ignores ground rules while routing over or around true obstacles', async ({ page }) => {
  await page.goto('/?reaverbotSeed=aerial-navigation-proof');
  await page.waitForFunction(() => Boolean(window.game?.dungeonController));

  const result = await page.evaluate(() => {
    const game = window.game;
    const controller = game.dungeonController;
    const Vector3 = game.player.root.position.constructor;
    game.stop();

    const generatedBoundaryCount = game.dungeon.aerialBoundaryZones?.length ?? 0;
    const controllerBoundaryCount = controller.aerialBoundaryZones.length;
    const boundaryContainsRail = controller.aerialBoundaryZones.some((zone) => (
      `${zone.id} ${zone.label}`.toLowerCase().includes('rail')
    ));
    const solidContainsRail = controller.solidZones.some((zone) => (
      `${zone.id} ${zone.label}`.toLowerCase().includes('rail')
    ));

    const originalSolidZones = controller.solidZones;
    const originalBoundaryZones = controller.aerialBoundaryZones;
    const originalDoors = controller.doors;
    const originalGetPlatforms = game._getPlatformingSurfaces;
    const originalEnemies = game.enemies;
    const originalWalkable = controller.isPositionWalkable;
    const originalSyncToFloor = controller._syncPositionToFloor;
    const originalLastSafe = controller.lastSafeEnemyPositions;

    const options = {
      radius: 0.2,
      verticalRadius: 0.2,
      lookAhead: 8,
      ignoreAirspace: true,
    };
    controller.solidZones = [];
    controller.aerialBoundaryZones = [];
    controller.doors = [];
    game._getPlatformingSurfaces = () => [];

    const directFrom = new Vector3(0, 1, 0);
    const directTarget = new Vector3(1, 2, 4);
    const expectedDirect = directTarget.clone().sub(directFrom).normalize();
    const direct = controller.getAerialNavigationDirection(directFrom, directTarget, options);

    controller.solidZones = [{
      id: 'syntheticLowMachine',
      position: new Vector3(0, 0.6, 1.6),
      halfWidth: 2.5,
      halfDepth: 0.5,
      verticalHalfHeight: 0.6,
    }];
    const lowFrom = new Vector3(0, 0.8, 0);
    const lowTarget = new Vector3(0, 0.8, 4);
    const lowDirect = lowTarget.clone().sub(lowFrom).normalize();
    const lowRoute = controller.getAerialNavigationDirection(lowFrom, lowTarget, options);
    const lowPathInitiallyClear = controller.isAerialPathClear(lowFrom, lowTarget, options);

    controller.solidZones = [{
      id: 'syntheticTallMachine',
      position: new Vector3(0, 2.4, 2),
      halfWidth: 1.35,
      halfDepth: 0.14,
      verticalHalfHeight: 2.4,
      allowFlyOver: false,
    }];
    const tallFrom = new Vector3(0, 1, 0);
    const tallTarget = new Vector3(0, 1, 5);
    const tallDirect = tallTarget.clone().sub(tallFrom).normalize();
    const tallRoute = controller.getAerialNavigationDirection(tallFrom, tallTarget, options);

    controller.solidZones = [];
    controller.aerialBoundaryZones = [{
      id: 'syntheticBoundaryWall',
      label: 'Dungeon boundary wall',
      obstacleKind: 'boundaryWall',
      position: new Vector3(0, 2.8, 2),
      halfWidth: 2,
      halfDepth: 0.1,
      verticalHalfHeight: 2.8,
      allowFlyOver: false,
    }];
    const wallPathClear = controller.isAerialPathClear(tallFrom, tallTarget, options);
    const wallRoute = controller.getAerialNavigationDirection(tallFrom, tallTarget, options);

    controller.aerialBoundaryZones = [];
    controller.doors = [{
      id: 'syntheticClosedDoor',
      closed: true,
      position: new Vector3(0, 0, 2),
      baseY: 0,
      collisionHeight: 4.8,
      collisionHalfWidth: 2,
      collisionHalfDepth: 0.12,
    }];
    const closedDoorPathClear = controller.isAerialPathClear(tallFrom, tallTarget, options);
    const closedDoorRoute = controller.getAerialNavigationDirection(tallFrom, tallTarget, options);

    controller.doors = [];
    game._getPlatformingSurfaces = () => [{
      id: 'syntheticOverheadDeck',
      center: new Vector3(0, 1, 2),
      halfWidth: 2,
      halfDepth: 0.18,
      baseY: 0,
      topY: 2,
      blocksBelow: true,
    }];
    const platformPathClear = controller.isAerialPathClear(tallFrom, tallTarget, options);
    const platformRoute = controller.getAerialNavigationDirection(tallFrom, tallTarget, options);

    controller.solidZones = [];
    controller.aerialBoundaryZones = [];
    controller.doors = [];
    game._getPlatformingSurfaces = () => [];
    controller.lastSafeEnemyPositions = new Map();
    const spawn = game.dungeon.playerStart.clone();
    const airStart = spawn.clone();
    const airEnemy = {
      id: 'syntheticAirEnemy',
      dead: false,
      navigationMode: 'air',
      radius: 0.4,
      collisionHeight: 1.4,
      hoverHeight: 0.8,
      root: { position: airStart.clone() },
      getAerialNavigationCenter(target) {
        return target.copy(this.root.position).add(new Vector3(0, 1.1, 0));
      },
    };
    let walkabilityCalls = 0;
    let floorSyncCalls = 0;
    controller.isPositionWalkable = () => {
      walkabilityCalls += 1;
      return true;
    };
    controller._syncPositionToFloor = () => {
      floorSyncCalls += 1;
    };
    game.enemies = [airEnemy];
    controller.constrainEnemies();
    const airAfterConstraint = airEnemy.root.position.clone();
    const aerialWalkabilityCalls = walkabilityCalls;
    const aerialFloorSyncCalls = floorSyncCalls;

    const groundEnemy = {
      id: 'syntheticGroundEnemy',
      dead: false,
      navigationMode: 'ground',
      root: { position: spawn.clone() },
    };
    game.enemies = [groundEnemy];
    controller.constrainEnemies();
    const groundWalkabilityCalls = walkabilityCalls - aerialWalkabilityCalls;
    const groundFloorSyncCalls = floorSyncCalls - aerialFloorSyncCalls;

    const carriedStart = spawn.clone().add(new Vector3(0, 2, 0));
    const carriedEnemy = {
      id: 'syntheticCarriedEnemy',
      dead: false,
      navigationMode: 'ground',
      root: { position: carriedStart.clone() },
      shouldIgnoreGroundConstraint: () => true,
    };
    const callsBeforeCarry = walkabilityCalls;
    const syncsBeforeCarry = floorSyncCalls;
    game.enemies = [carriedEnemy];
    controller.constrainEnemies();
    const carriedStayedAirborne = carriedEnemy.root.position.distanceTo(carriedStart) < 0.0001;
    const carryWalkabilityCalls = walkabilityCalls - callsBeforeCarry;
    const carryFloorSyncCalls = floorSyncCalls - syncsBeforeCarry;

    controller.solidZones = originalSolidZones;
    controller.aerialBoundaryZones = originalBoundaryZones;
    controller.doors = originalDoors;
    game._getPlatformingSurfaces = originalGetPlatforms;
    game.enemies = originalEnemies;
    controller.isPositionWalkable = originalWalkable;
    controller._syncPositionToFloor = originalSyncToFloor;
    controller.lastSafeEnemyPositions = originalLastSafe;

    return {
      generatedBoundaryCount,
      controllerBoundaryCount,
      boundaryContainsRail,
      solidContainsRail,
      directDot: direct?.dot(expectedDirect) ?? -1,
      lowPathInitiallyClear,
      lowRouteY: lowRoute?.y ?? 0,
      lowRouteDirectDot: lowRoute?.dot(lowDirect) ?? 1,
      tallRouteX: Math.abs(tallRoute?.x ?? 0),
      tallRouteDirectDot: tallRoute?.dot(tallDirect) ?? 1,
      wallPathClear,
      wallRouteDirectDot: wallRoute?.dot(tallDirect) ?? null,
      closedDoorPathClear,
      closedDoorRouteDirectDot: closedDoorRoute?.dot(tallDirect) ?? null,
      platformPathClear,
      platformRouteY: platformRoute?.y ?? 0,
      airStayedPut: airAfterConstraint.distanceTo(airStart) < 0.0001,
      aerialWalkabilityCalls,
      aerialFloorSyncCalls,
      groundWalkabilityCalls,
      groundFloorSyncCalls,
      carriedStayedAirborne,
      carryWalkabilityCalls,
      carryFloorSyncCalls,
    };
  });

  expect(result.generatedBoundaryCount).toBeGreaterThan(0);
  expect(result.controllerBoundaryCount).toBe(result.generatedBoundaryCount);
  expect(result.boundaryContainsRail).toBe(false);
  expect(result.solidContainsRail).toBe(false);
  expect(result.directDot).toBeGreaterThan(0.9999);
  expect(result.lowPathInitiallyClear).toBe(false);
  expect(result.lowRouteY).toBeGreaterThan(0.25);
  expect(result.lowRouteDirectDot).toBeLessThan(0.98);
  expect(result.tallRouteX).toBeGreaterThan(0.1);
  expect(result.tallRouteDirectDot).toBeLessThan(0.99);
  expect(result.wallPathClear).toBe(false);
  expect(result.wallRouteDirectDot === null || result.wallRouteDirectDot < 0.99).toBe(true);
  expect(result.closedDoorPathClear).toBe(false);
  expect(result.closedDoorRouteDirectDot === null || result.closedDoorRouteDirectDot < 0.99).toBe(true);
  expect(result.platformPathClear).toBe(false);
  expect(result.platformRouteY).toBeGreaterThan(0.05);
  expect(result.airStayedPut).toBe(true);
  expect(result.aerialWalkabilityCalls).toBe(0);
  expect(result.aerialFloorSyncCalls).toBe(0);
  expect(result.groundWalkabilityCalls).toBeGreaterThan(0);
  expect(result.groundFloorSyncCalls).toBeGreaterThan(0);
  expect(result.carriedStayedAirborne).toBe(true);
  expect(result.carryWalkabilityCalls).toBe(0);
  expect(result.carryFloorSyncCalls).toBe(0);
});

test('aerial Reaverbots use full-volume range, cargo sweeps, and validated throw arcs', async ({ page }) => {
  await page.goto('/?reaverbotSeed=aerial-hardening-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const controller = game.dungeonController;
    const Vector3 = game.player.root.position.constructor;
    game.stop();

    for (const enemy of [...game.enemies]) {
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;

    const base = game.dungeon.playerStart.clone();
    game.player.root.position.copy(base);
    const bomber = window.spawnReaverbot({
      archetypeId: 'aerialBomber',
      seed: 'aerial-hardening:bomber',
      position: base.clone().add(new Vector3(0, 8, 0)),
    });
    bomber.brain.alerted = true;
    bomber.brain.state = 'position';
    bomber.brain.cooldown = 0;
    bomber._updatePositionState(0, game, new Vector3(0, 0, 1), 0);
    const verticallyDistantState = bomber.brain.state;

    bomber.root.position.copy(base).add(new Vector3(0, 0.25, 0));
    bomber.brain.state = 'position';
    bomber.brain.cooldown = 0;
    bomber._updatePositionState(0, game, new Vector3(0, 0, 1), 0);
    const verticallyNearState = bomber.brain.state;

    const originalSolidZones = controller.solidZones;
    const originalBoundaryZones = controller.aerialBoundaryZones;
    const originalDoors = controller.doors;
    const originalGetPlatforms = game._getPlatformingSurfaces;
    const enemyRadius = bomber.radius;
    const wallCenterX = 0.5 + enemyRadius * 0.96;
    controller.solidZones = [
      {
        id: 'fullRadiusLeftWall',
        position: new Vector3(-wallCenterX, 1, 2),
        halfWidth: 0.5,
        halfDepth: 3,
        verticalHalfHeight: 2,
        allowFlyOver: false,
      },
      {
        id: 'fullRadiusRightWall',
        position: new Vector3(wallCenterX, 1, 2),
        halfWidth: 0.5,
        halfDepth: 3,
        verticalHalfHeight: 2,
        allowFlyOver: false,
      },
    ];
    controller.aerialBoundaryZones = [];
    controller.doors = [];
    game._getPlatformingSurfaces = () => [];
    const corridorFrom = new Vector3(0, 1, 0);
    const corridorTarget = new Vector3(0, 1, 4);
    const reducedRadiusPathClear = controller.isAerialPathClear(corridorFrom, corridorTarget, {
      radius: enemyRadius * 0.92,
      verticalRadius: 0.2,
      ignoreAirspace: true,
    });
    const fullRadiusPathClear = controller.isAerialPathClear(corridorFrom, corridorTarget, {
      radius: enemyRadius,
      verticalRadius: 0.2,
      ignoreAirspace: true,
    });
    const bomberCollisionRadius = bomber._getAerialCollisionOptions().radius;

    controller.solidZones = [];
    const tractor = window.spawnReaverbot({
      archetypeId: 'tractorController',
      seed: 'aerial-hardening:tractor',
      position: base.clone().add(new Vector3(0, 3.2, -3)),
    });
    const captive = window.spawnReaverbot({
      archetypeId: 'pursuer',
      seed: 'aerial-hardening:captive',
      position: base.clone(),
    });
    tractor.brain.tractorTarget = captive;
    tractor.brain.tractorCargoTopOffset = tractor._measureTractorCargoTopOffset(captive);
    captive.root.position.copy(tractor._getTractorCarryAnchor(captive, new Vector3()));
    const captiveCollisionProfile = tractor._measureTractorCargoCollisionProfile(captive);

    const originalGetAerialDirection = controller.getAerialNavigationDirection;
    const originalIsAerialPathClear = controller.isAerialPathClear;
    let cargoSweepCalls = 0;
    let cargoSweepDistance = 0;
    let cargoSweepRadius = null;
    controller.getAerialNavigationDirection = () => new Vector3(0, 0, 1);
    controller.isAerialPathClear = (from, to, options) => {
      cargoSweepCalls += 1;
      cargoSweepDistance = from.distanceTo(to);
      cargoSweepRadius = options?.radius ?? null;
      return false;
    };
    const tractorStart = tractor.root.position.clone();
    const tractorMoveTarget = tractorStart.clone().add(new Vector3(0, 0, 5));
    const carriedMoveAccepted = tractor._moveAirTowardPosition(
      0.25,
      game,
      tractorMoveTarget,
      1,
      captive,
    );
    const tractorTravelWhileCargoBlocked = tractor.root.position.distanceTo(tractorStart);
    controller.getAerialNavigationDirection = originalGetAerialDirection;
    controller.isAerialPathClear = originalIsAerialPathClear;

    const arcStart = base.clone();
    const arcLanding = base.clone().add(new Vector3(0, 0, 4));
    captive.root.position.copy(arcStart);
    const arcHeight = 2.1;
    const captiveHeight = captive.collisionHeight ?? 1.4;
    const arcMidpoint = arcStart.clone().lerp(arcLanding, 0.5);
    arcMidpoint.y += arcHeight + captiveHeight * 0.45;
    controller.solidZones = [{
      id: 'throwArcBlocker',
      position: arcMidpoint,
      halfWidth: 0.55,
      halfDepth: 0.55,
      verticalHalfHeight: 0.55,
      allowFlyOver: false,
    }];
    const blockedThrowArcClear = tractor._isTractorThrowArcClear(
      game,
      captive,
      arcLanding,
      arcHeight,
    );
    controller.solidZones = [];
    const unobstructedThrowArcClear = tractor._isTractorThrowArcClear(
      game,
      captive,
      arcLanding,
      arcHeight,
    );

    const originalThrowArcCheck = tractor._isTractorThrowArcClear;
    let rejectedArcChecks = 0;
    tractor._isTractorThrowArcClear = () => {
      rejectedArcChecks += 1;
      return false;
    };
    const rejectedLanding = tractor._findTractorThrowLanding(game, captive, arcHeight);
    tractor._isTractorThrowArcClear = originalThrowArcCheck;

    let aerialCharger = null;
    for (let variant = 0; variant < 80 && !aerialCharger; variant += 1) {
      const candidate = window.spawnReaverbot({
        archetypeId: 'rotorHunter',
        seed: `aerial-hardening:overshoot:${variant}`,
        position: base.clone().add(new Vector3(0, 0.9, 2)),
      });
      if (candidate.navigationMode === 'air') aerialCharger = candidate;
      else {
        const index = game.enemies.indexOf(candidate);
        if (index >= 0) game.enemies.splice(index, 1);
        candidate.dispose?.();
        candidate.root.removeFromParent();
      }
    }
    if (!aerialCharger) throw new Error('Could not generate an aerial rotor charger');
    aerialCharger.root.position.copy(base).add(new Vector3(0, 0.9, 2));
    controller.solidZones = [{
      id: 'chargeOvershootWall',
      position: base.clone().add(new Vector3(0, 1.2, -0.82)),
      halfWidth: 1.4,
      halfDepth: 0.12,
      verticalHalfHeight: 2.4,
      allowFlyOver: false,
    }];
    const playerAimPoint = base.clone();
    playerAimPoint.y += 0.9;
    const pathOnlyToPlayerClear = aerialCharger._isAerialRootPathClear(game, playerAimPoint);
    const overshootChargeAllowed = aerialCharger._canBeginAttack(game);

    const priorChargeDirection = new Vector3(0.6, 0, 0.8).normalize();
    const priorChargeTarget = aerialCharger.root.position.clone().add(new Vector3(2.4, 0.35, -3.1));
    aerialCharger.brain.state = 'telegraph';
    aerialCharger.brain.stateTime = 0;
    aerialCharger.brain.effectTimer = 99;
    aerialCharger.brain.commitDistance = 5;
    aerialCharger.brain.attackDirection.copy(priorChargeDirection);
    aerialCharger.brain.targetPosition.copy(priorChargeTarget);
    const originalChargerPathCheck = aerialCharger._isAerialRootPathClear;
    aerialCharger._isAerialRootPathClear = () => false;
    aerialCharger._updateTelegraphState(0.01, game, new Vector3(-1, 0, 0));
    aerialCharger._isAerialRootPathClear = originalChargerPathCheck;
    const blockedTrackingDirectionError = aerialCharger.brain.attackDirection.distanceTo(priorChargeDirection);
    const blockedTrackingTargetError = aerialCharger.brain.targetPosition.distanceTo(priorChargeTarget);

    controller.solidZones = [];
    captive.cancelExternalBallisticMotion?.('upright-regression', game);
    captive.releaseExternalControl?.(tractor, 'upright-regression');
    captive.root.position.copy(base);
    captive.root.rotation.set(0.62, 0.35, -0.48);
    captive.tryClaimExternalControl(tractor, 'tractorBeam', {
      freeze: true,
      ignoreGroundConstraint: true,
    });
    tractor.brain.tractorTarget = captive;
    tractor.brain.tractorCargoTopOffset = 0;
    tractor.brain.tractorLiftStart.copy(captive.root.position);
    tractor.brain.state = 'commit';
    tractor.brain.stateTime = 0;
    tractor.brain.attackFired = false;
    let measuredCargoPitch = null;
    let measuredCargoRoll = null;
    const originalCargoProfileMeasure = tractor._measureTractorCargoCollisionProfile;
    tractor._measureTractorCargoCollisionProfile = function measureUprightCargo(target) {
      measuredCargoPitch = target.root.rotation.x;
      measuredCargoRoll = target.root.rotation.z;
      return originalCargoProfileMeasure.call(this, target);
    };
    tractor._updateTractorController(0.016, game);
    tractor._measureTractorCargoCollisionProfile = originalCargoProfileMeasure;
    const carriedPitchAfterUpdate = captive.root.rotation.x;
    const carriedRollAfterUpdate = captive.root.rotation.z;

    captive.root.position.copy(base).add(new Vector3(0, 4, 0));
    captive.root.rotation.x = 0;
    captive.root.rotation.z = 0;
    tractor.brain.tractorTarget = captive;
    if (!captive.hasExternalControl(tractor)) {
      captive.tryClaimExternalControl(tractor, 'tractorBeam', {
        freeze: true,
        ignoreGroundConstraint: true,
      });
    }
    const releaseProfile = tractor._measureTractorCargoCollisionProfile(captive);
    const directReleaseLanding = base.clone();
    directReleaseLanding.y = controller.getSurfaceElevationAt(directReleaseLanding);
    controller.solidZones = [{
      id: 'abortDirectDropFixture',
      position: directReleaseLanding.clone().add(new Vector3(0, releaseProfile.centerOffsetY, 0)),
      halfWidth: 0.05,
      halfDepth: 0.05,
      verticalHalfHeight: 0.05,
      allowFlyOver: false,
    }];
    const directAbortDropClear = tractor._isTractorThrowArcClear(
      game,
      captive,
      directReleaseLanding,
      0,
    );
    tractor._releaseTractorTarget('abort-drop-regression', game);
    const abortMotion = captive.externalBallisticMotion;
    const abortLanding = abortMotion?.targetPosition.clone() ?? null;
    const abortLandingDistance = abortLanding
      ? Math.hypot(abortLanding.x - directReleaseLanding.x, abortLanding.z - directReleaseLanding.z)
      : 0;
    const abortLandingWalkable = abortLanding
      ? controller.isPositionWalkable(abortLanding)
      : false;
    const abortLandingSweepClear = abortLanding
      ? tractor._isTractorThrowArcClear(game, captive, abortLanding, abortMotion.arcHeight)
      : false;

    controller.solidZones = originalSolidZones;
    controller.aerialBoundaryZones = originalBoundaryZones;
    controller.doors = originalDoors;
    game._getPlatformingSurfaces = originalGetPlatforms;

    for (const enemy of [...game.enemies]) {
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;

    return {
      verticallyDistantState,
      verticallyNearState,
      reducedRadiusPathClear,
      fullRadiusPathClear,
      enemyRadius,
      bomberCollisionRadius,
      cargoSweepCalls,
      cargoSweepDistance,
      cargoSweepRadius,
      captiveRadius: captive.radius,
      captiveVisualCollisionRadius: captiveCollisionProfile.radius,
      carriedMoveAccepted,
      tractorTravelWhileCargoBlocked,
      blockedThrowArcClear,
      unobstructedThrowArcClear,
      rejectedArcChecks,
      rejectedLandingFound: Boolean(rejectedLanding),
      pathOnlyToPlayerClear,
      overshootChargeAllowed,
      blockedTrackingDirectionError,
      blockedTrackingTargetError,
      measuredCargoPitch,
      measuredCargoRoll,
      carriedPitchAfterUpdate,
      carriedRollAfterUpdate,
      directAbortDropClear,
      abortMotionStarted: Boolean(abortMotion),
      abortLandingDistance,
      abortLandingWalkable,
      abortLandingSweepClear,
    };
  });

  expect(result.verticallyDistantState).toBe('position');
  expect(result.verticallyNearState).toBe('telegraph');
  expect(result.reducedRadiusPathClear).toBe(true);
  expect(result.fullRadiusPathClear).toBe(false);
  expect(result.bomberCollisionRadius).toBeCloseTo(result.enemyRadius, 6);
  expect(result.cargoSweepCalls).toBeGreaterThan(0);
  expect(result.cargoSweepDistance).toBeGreaterThan(0);
  expect(result.cargoSweepRadius).toBeCloseTo(result.captiveVisualCollisionRadius, 6);
  expect(result.cargoSweepRadius).toBeGreaterThan(result.captiveRadius);
  expect(result.carriedMoveAccepted).toBe(false);
  expect(result.tractorTravelWhileCargoBlocked).toBeLessThan(0.0001);
  expect(result.blockedThrowArcClear).toBe(false);
  expect(result.unobstructedThrowArcClear).toBe(true);
  expect(result.rejectedArcChecks).toBeGreaterThan(0);
  expect(result.rejectedLandingFound).toBe(false);
  expect(result.pathOnlyToPlayerClear).toBe(true);
  expect(result.overshootChargeAllowed).toBe(false);
  expect(result.blockedTrackingDirectionError).toBeLessThan(0.000001);
  expect(result.blockedTrackingTargetError).toBeLessThan(0.000001);
  expect(result.measuredCargoPitch).not.toBeNull();
  expect(result.measuredCargoRoll).not.toBeNull();
  expect(Math.abs(result.measuredCargoPitch)).toBeLessThan(0.000001);
  expect(Math.abs(result.measuredCargoRoll)).toBeLessThan(0.000001);
  expect(Math.abs(result.carriedPitchAfterUpdate)).toBeLessThan(0.000001);
  expect(Math.abs(result.carriedRollAfterUpdate)).toBeLessThan(0.000001);
  expect(result.directAbortDropClear).toBe(false);
  expect(result.abortMotionStarted).toBe(true);
  expect(result.abortLandingDistance).toBeGreaterThan(0.1);
  expect(result.abortLandingWalkable).toBe(true);
  expect(result.abortLandingSweepClear).toBe(true);
});
