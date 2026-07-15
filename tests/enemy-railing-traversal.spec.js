import { expect, test } from '@playwright/test';

test('ordinary grounded enemies hop a railing to a lower floor and bosses remain excluded', async ({ page }) => {
  await page.goto('/?reaverbotSeed=enemy-railing-traversal-proof');
  await page.waitForFunction(() => Boolean(
    window.game?.spawner
    && window.game?.dungeonController
    && window.spawnReaverbot,
  ));

  const result = await page.evaluate(() => {
    const game = window.game;
    const controller = game.dungeonController;
    const Vector3 = game.player.root.position.constructor;
    game.stop();

    // Replace navigation data with a small deterministic cross-section: a
    // broad elevated deck ends at a rail, with a broad walkable floor below on
    // the far side. The real Enemy and DungeonController implementations still
    // own collision, traversal planning, motion, constraint, and cooldown.
    const tileSize = 2.8;
    const roomId = 'synthetic-railing-room';
    const floorTiles = [];
    for (let x = -2; x <= 0; x += 1) {
      for (let z = -2; z <= 2; z += 1) {
        floorTiles.push({
          x,
          z,
          elevation: 2,
          level: 1,
          surface: 'catwalk',
          roomId,
        });
      }
    }
    for (let x = 1; x <= 4; x += 1) {
      for (let z = -2; z <= 2; z += 1) {
        floorTiles.push({
          x,
          z,
          elevation: 0,
          level: 0,
          surface: 'floor',
          roomId,
        });
      }
    }

    const tiles = new Map(floorTiles.map((tile) => [`${tile.x},${tile.z}`, tile]));
    controller.tileSize = tileSize;
    controller.floorTiles = floorTiles;
    controller.floorTilesByColumn = controller._createFloorTileColumns(floorTiles);
    controller.tiles = tiles;
    controller.solidZones = [];
    controller.aerialBoundaryZones = [];
    controller.doors = [];
    controller.safeZones = [];
    controller.lastSafeEnemyPositions = new Map();
    controller.playerRailTopSurfaces = [{
      id: 'synthetic-deck-rail',
      center: new Vector3(tileSize * 0.5, 2.68, 0),
      halfWidth: 0.05,
      halfDepth: tileSize * 2.5,
      topY: 2.72,
      baseElevation: 2,
      horizontal: false,
    }];
    game.getPlatformFloorElevation = () => null;
    game.isPositionInsidePlatformBlock = () => false;
    game._getPlatformingSurfaces = () => [];
    controller.invalidateNavigationTopology();

    game.enemies = [];
    const source = new Vector3(0.75, 2, 0);
    const blocked = new Vector3(1.2, 2, 0);
    const desiredTarget = new Vector3(tileSize * 2, 0, 0);
    const enemy = game.spawner.spawnCuratedEnemy('basic', false, source.clone());
    enemy.navigationMode = 'ground';
    enemy.collisionHeight = 1.6;
    enemy.setEncounterArena({
      id: 'synthetic-railing-encounter',
      zone: {
        position: new Vector3(tileSize, 0, 0),
        halfWidth: tileSize * 3.5,
        halfDepth: tileSize * 2.5,
      },
    }, new Vector3(tileSize, 0, 0));
    enemy.lastNavigationTarget.copy(desiredTarget);

    const sourceClear = controller.isEnemyPositionClear(enemy, source);
    const blockedClear = controller.isEnemyPositionClear(enemy, blocked);
    const preview = controller.resolveEnemyGroundTraversal(enemy, blocked, desiredTarget);

    // Exercise the production recovery path: movement has entered an invalid
    // footprint, the constraint restores the last safe point, then starts the
    // traversal returned by the resolver.
    controller.lastSafeEnemyPositions.set(enemy.id, source.clone());
    enemy.root.position.copy(blocked);
    controller.constrainEnemies();
    const startedMotion = enemy.navigationTraversalMotion;
    const beganAtSafePoint = startedMotion?.startPosition.distanceTo(source) ?? Infinity;
    const targetMatchesPreview = startedMotion && preview
      ? startedMotion.targetPosition.distanceTo(preview.targetPosition)
      : Infinity;
    const ignoresGroundDuringTraversal = enemy.shouldIgnoreGroundConstraint();

    let maximumY = enemy.root.position.y;
    let crossingY = -Infinity;
    let crossingDistance = Infinity;
    let constrainedMidArcDelta = Infinity;
    let externalControlClaimDuringTraversal = null;
    const externalControlProbe = { id: 'mid-hop-control-probe' };
    const motionDuration = startedMotion?.duration ?? preview?.duration ?? 0.42;
    const steps = 120;
    for (let step = 1; step <= steps; step += 1) {
      enemy._updateExternalMotion(motionDuration / steps, game);
      maximumY = Math.max(maximumY, enemy.root.position.y);
      const railDistance = Math.abs(enemy.root.position.x - tileSize * 0.5);
      if (railDistance < crossingDistance) {
        crossingDistance = railDistance;
        crossingY = enemy.root.position.y;
      }
      if (step === Math.floor(steps * 0.5)) {
        externalControlClaimDuringTraversal = enemy.tryClaimExternalControl(
          externalControlProbe,
          'mid-hop-probe',
        );
        const beforeConstraint = enemy.root.position.clone();
        controller.constrainEnemies();
        constrainedMidArcDelta = enemy.root.position.distanceTo(beforeConstraint);
      }
    }

    const landing = preview?.targetPosition?.clone() ?? new Vector3();
    const landingError = enemy.root.position.distanceTo(landing);
    const landedAcrossRail = enemy.root.position.x > tileSize * 0.5;
    const ignoresGroundAfterLanding = enemy.shouldIgnoreGroundConstraint();
    const cooldownAfterLanding = enemy.navigationTraversalCooldown;
    const retryTarget = enemy.root.position.clone().add(new Vector3(1.2, 0, 0));
    const retryDuringCooldown = enemy.startNavigationTraversal(retryTarget, {
      arcHeight: 1,
      duration: 0.5,
      kind: 'cooldownProbe',
    });

    // Keep the enemy behavior idle while its real update heartbeat consumes the
    // cooldown, then prove a new traversal can begin once it expires.
    controller.isPlayerInSafeZone = () => true;
    enemy.update(cooldownAfterLanding + 0.01, game);
    const cooldownAfterWait = enemy.navigationTraversalCooldown;
    const retryAfterCooldown = enemy.startNavigationTraversal(retryTarget, {
      arcHeight: 1,
      duration: 0.5,
      kind: 'cooldownProbe',
    });
    enemy.clearExternalMotion('cleared', game);

    const boss = game.spawner.spawnCuratedEnemy('basic', false, source.clone());
    boss.navigationMode = 'ground';
    boss.collisionHeight = 1.6;
    boss.isBoss = true;
    boss.setEncounterArena({
      id: 'synthetic-boss-railing-encounter',
      zone: {
        position: new Vector3(tileSize, 0, 0),
        halfWidth: tileSize * 3.5,
        halfDepth: tileSize * 2.5,
      },
    }, new Vector3(tileSize, 0, 0));
    const bossPreview = controller.resolveEnemyGroundTraversal(boss, blocked, desiredTarget);
    const bossMotionStarted = boss.startNavigationTraversal(
      preview?.targetPosition ?? desiredTarget,
      preview ?? { arcHeight: 1, duration: 0.5, kind: 'railing' },
    );

    const springEnemy = window.spawnReaverbot({
      archetypeId: 'pouncer',
      seed: 'spring-audit:1',
      threatTier: 2,
      encounterSize: 2,
      position: source.clone(),
    });
    springEnemy.navigationMode = 'ground';
    springEnemy.brain.state = 'position';
    springEnemy.brain.coilBounceActive = true;
    const coilMotionStarted = springEnemy.startNavigationTraversal(
      preview?.targetPosition ?? desiredTarget,
      preview ?? { arcHeight: 1, duration: 0.5, kind: 'railing' },
    );
    springEnemy.brain.coilBounceActive = false;
    springEnemy.brain.clawVaultActive = true;
    const clawVaultMotionStarted = springEnemy.startNavigationTraversal(
      preview?.targetPosition ?? desiredTarget,
      preview ?? { arcHeight: 1, duration: 0.5, kind: 'railing' },
    );

    return {
      sourceClear,
      blockedClear,
      previewKind: preview?.kind ?? null,
      previewTarget: preview?.targetPosition.toArray() ?? null,
      beganAtSafePoint,
      targetMatchesPreview,
      startedKind: startedMotion?.kind ?? null,
      ignoresGroundDuringTraversal,
      maximumY,
      crossingY,
      railTopY: controller.playerRailTopSurfaces[0].topY,
      constrainedMidArcDelta,
      externalControlClaimDuringTraversal,
      landingError,
      landingY: enemy.root.position.y,
      landedAcrossRail,
      ignoresGroundAfterLanding,
      cooldownAfterLanding,
      retryDuringCooldown,
      cooldownAfterWait,
      retryAfterCooldown,
      bossPreviewKind: bossPreview?.kind ?? null,
      bossMotionStarted,
      bossMotionActive: Boolean(boss.navigationTraversalMotion),
      coilMotionStarted,
      clawVaultMotionStarted,
    };
  });

  expect(result.sourceClear).toBe(true);
  expect(result.blockedClear).toBe(false);
  expect(result.previewKind).toBe('railing');
  expect(result.previewTarget).not.toBeNull();
  expect(result.startedKind).toBe('railing');
  expect(result.beganAtSafePoint).toBeLessThan(0.001);
  expect(result.targetMatchesPreview).toBeLessThan(0.001);
  expect(result.ignoresGroundDuringTraversal).toBe(true);
  expect(result.maximumY).toBeGreaterThan(2.7);
  expect(result.crossingY).toBeGreaterThan(result.railTopY);
  expect(result.constrainedMidArcDelta).toBeLessThan(0.001);
  expect(result.externalControlClaimDuringTraversal).toBe(false);
  expect(result.landingError).toBeLessThan(0.001);
  expect(result.landingY).toBeCloseTo(0, 5);
  expect(result.landedAcrossRail).toBe(true);
  expect(result.ignoresGroundAfterLanding).toBe(false);
  expect(result.cooldownAfterLanding).toBeGreaterThan(0.75);
  expect(result.retryDuringCooldown).toBe(false);
  expect(result.cooldownAfterWait).toBe(0);
  expect(result.retryAfterCooldown).toBe(true);
  expect(result.bossPreviewKind).toBeNull();
  expect(result.bossMotionStarted).toBe(false);
  expect(result.bossMotionActive).toBe(false);
  expect(result.coilMotionStarted).toBe(false);
  expect(result.clawVaultMotionStarted).toBe(false);
});
