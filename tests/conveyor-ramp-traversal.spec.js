import { expect, test } from '@playwright/test';

test('large conveyor-room ramps keep grounded support across overlapping platform seams', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&reaverbotSeed=conveyor-ramp-runtime-proof');
  await page.waitForFunction(() => Boolean(window.game?.dungeonController));

  const result = await page.evaluate(() => {
    const game = window.game;
    const controller = game.dungeonController;
    const player = game.player;
    const dungeon = game.dungeon;
    const room = dungeon.rooms.find((entry) => entry.id === 'conveyorRoom');
    game.stop();

    const upperRampTiles = dungeon.floorTiles.filter((tile) => (
      tile.roomId === room.id
      && tile.surface === 'industrialRamp'
    ));
    const routes = new Map();
    for (const tile of upperRampTiles) {
      const route = routes.get(tile.rampRouteId) ?? [];
      route.push(tile);
      routes.set(tile.rampRouteId, route);
    }
    const route = [...routes.values()].sort((left, right) => (
      Math.max(...right.flatMap((tile) => [tile.rampStartElevation, tile.rampEndElevation]))
      - Math.max(...left.flatMap((tile) => [tile.rampStartElevation, tile.rampEndElevation]))
    ))[0];
    const runs = new Map();
    for (const tile of route) {
      const run = runs.get(tile.rampRunId) ?? [];
      run.push(tile);
      runs.set(tile.rampRunId, run);
    }
    const ascendingPlatformRun = [...runs.values()].sort((left, right) => (
      Math.min(...left.map((tile) => tile.rampStartElevation))
      - Math.min(...right.map((tile) => tile.rampStartElevation))
    ))[0];
    const directionX = Math.sign(ascendingPlatformRun[0].rampDirectionX ?? 0);
    const directionZ = Math.sign(ascendingPlatformRun[0].rampDirectionZ ?? 0);
    ascendingPlatformRun.sort((left, right) => (
      (left.x * directionX + left.z * directionZ)
      - (right.x * directionX + right.z * directionZ)
    ));

    player.jumpState = 'Grounded';
    player.velocity.set(0, 0, 0);
    player._jumpBufferTimer = 0;
    if (player.animation) {
      player.animation.actionState = null;
      player.animation.actionTimer = 0;
      player.animation.attackTimer = 0;
      player.animation.hurtTimer = 0;
    }

    let previousY = ascendingPlatformRun[0].rampStartElevation;
    const samples = [];
    for (const tile of ascendingPlatformRun) {
      for (const localProgress of [-0.45, 0, 0.45]) {
        const x = (tile.x + directionX * localProgress) * dungeon.tileSize;
        const z = (tile.z + directionZ * localProgress) * dungeon.tileSize;
        player.root.position.set(x, previousY, z);
        player.jumpState = 'Grounded';
        player.velocity.set(0, 0, 0);

        const rampY = controller.getRampSurfaceElevationAt(player.root.position);
        const platformY = game.getPlatformFloorElevation(player.root.position);
        const resolvedGroundY = game._getPlayerGroundY();
        player._updatePhysicalJumpAndMovement(1 / 120, new player.root.position.constructor(), {
          arenaRadius: 1000,
          movementOptions: { groundY: resolvedGroundY },
        });
        controller._constrainPlayerToWalkable();
        samples.push({
          rampY,
          platformY,
          resolvedGroundY,
          playerY: player.root.position.y,
          jumpState: player.jumpState,
        });
        previousY = player.root.position.y;
      }
    }

    return {
      sampleCount: samples.length,
      overlapSampleCount: samples.filter((sample) => (
        Number.isFinite(sample.platformY)
        && Math.abs(sample.platformY - sample.rampY) > 0.03
      )).length,
      allRampSamplesSolid: samples.every((sample) => (
        Number.isFinite(sample.rampY)
        && Math.abs(sample.resolvedGroundY - sample.rampY) < 0.001
        && Math.abs(sample.playerY - sample.rampY) < 0.001
      )),
      fallingSampleCount: samples.filter((sample) => sample.jumpState === 'Falling').length,
      minimumY: Math.min(...samples.map((sample) => sample.playerY)),
      maximumY: Math.max(...samples.map((sample) => sample.playerY)),
    };
  });

  expect(result.sampleCount).toBeGreaterThanOrEqual(6);
  expect(result.overlapSampleCount).toBeGreaterThan(0);
  expect(result.allRampSamplesSolid).toBe(true);
  expect(result.fallingSampleCount).toBe(0);
  expect(result.maximumY).toBeGreaterThan(result.minimumY + 0.2);
});

test('high conveyor scaffolding permits a railing jump to the distant floor below', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&reaverbotSeed=conveyor-high-rail-jump-proof');
  await page.waitForFunction(() => Boolean(window.game?.dungeonController));

  const result = await page.evaluate(() => {
    const game = window.game;
    const controller = game.dungeonController;
    const player = game.player;
    const room = game.dungeon.rooms.find((entry) => entry.id === 'conveyorRoom');
    const Vector3 = player.root.position.constructor;
    game.stop();

    const roomHalfWidth = room.width * game.dungeon.tileSize * 0.5;
    const roomHalfDepth = room.depth * game.dungeon.tileSize * 0.5;
    const rails = controller.playerRailTopSurfaces.filter((rail) => (
      Math.abs(rail.center.x - room.x * game.dungeon.tileSize) <= roomHalfWidth
      && Math.abs(rail.center.z - room.z * game.dungeon.tileSize) <= roomHalfDepth
      && rail.topY > 2
    ));

    let scenario = null;
    for (const rail of rails) {
      const normal = rail.horizontal
        ? new Vector3(0, 0, 1)
        : new Vector3(1, 0, 0);
      const sideA = rail.center.clone().addScaledVector(normal, 0.7).setY(rail.topY);
      const sideB = rail.center.clone().addScaledVector(normal, -0.7).setY(rail.topY);
      const floorA = controller.getFloorElevationAt(sideA);
      const floorB = controller.getFloorElevationAt(sideB);
      const highSide = floorA >= floorB ? sideA : sideB;
      const lowSide = floorA >= floorB ? sideB : sideA;
      const highFloorY = Math.max(floorA, floorB);
      const lowFloorY = Math.min(floorA, floorB);
      const landingProbe = controller._getWalkableJumpOffLanding(
        lowSide.clone().setY(highFloorY + 0.9),
      );
      if (highFloorY - lowFloorY <= 3
        || Math.abs(rail.topY - highFloorY) > 1.1
        || !landingProbe
        || Math.abs(landingProbe.y - lowFloorY) > 0.01) {
        continue;
      }
      scenario = { rail, highSide, lowSide, highFloorY, lowFloorY };
      break;
    }

    if (!scenario) {
      return { found: false, railCount: rails.length };
    }

    const { rail, highSide, lowSide, highFloorY, lowFloorY } = scenario;
    const airborneY = highFloorY + 0.9;
    const previousPosition = highSide.clone().setY(airborneY);
    const crossingPosition = lowSide.clone().setY(airborneY);
    const outward = crossingPosition.clone().sub(previousPosition).setY(0).normalize();

    player.root.position.copy(crossingPosition);
    player.jumpState = 'Falling';
    player.velocity.copy(outward).multiplyScalar(2.2);
    player.velocity.y = -1.4;
    player._jumpGroundY = highFloorY;
    player._jumpBufferTimer = 0;
    controller.lastSafePlayerPosition.copy(previousPosition);
    controller.pendingPlayerJumpOffLanding = null;

    controller._constrainPlayerToWalkable();
    const positionAfterConstraint = player.root.position.clone();
    const pendingLandingY = controller.pendingPlayerJumpOffLanding?.y ?? null;
    const remainedBeyondRail = positionAfterConstraint.distanceToSquared(crossingPosition) < 0.0001;

    player.velocity.x = 0;
    player.velocity.z = 0;
    for (let frame = 0; frame < 360 && player.isJumpAirborne(); frame += 1) {
      const groundY = game._getPlayerGroundY();
      player._updatePhysicalJumpAndMovement(1 / 120, new Vector3(), {
        arenaRadius: 1000,
        movementOptions: { groundY },
      });
      controller._constrainPlayerToWalkable();
    }

    const railNormalDistance = rail.horizontal
      ? Math.abs(player.root.position.z - rail.center.z)
      : Math.abs(player.root.position.x - rail.center.x);
    return {
      found: true,
      highFloorY,
      lowFloorY,
      drop: highFloorY - lowFloorY,
      remainedBeyondRail,
      pendingLandingY,
      finalY: player.root.position.y,
      jumpState: player.jumpState,
      railNormalDistance,
    };
  });

  expect(result.found).toBe(true);
  expect(result.drop).toBeGreaterThan(3);
  expect(result.remainedBeyondRail).toBe(true);
  expect(result.pendingLandingY).toBeCloseTo(result.lowFloorY, 3);
  expect(result.jumpState).not.toBe('Falling');
  expect(result.finalY).toBeCloseTo(result.lowFloorY, 2);
  expect(result.railNormalDistance).toBeGreaterThan(0.5);
});

test('conveyor scaffolding wins ramp conflicts without leaving partial slopes or support intrusions', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => Boolean(window.game?.dungeonController));

  const results = await page.evaluate(async () => {
    window.game.stop();
    const { DungeonGenerator } = await import('/src/DungeonGenerator.js');
    const generated = [];

    for (let seed = 1; seed <= 12; seed += 1) {
      let state = seed >>> 0;
      const random = () => (
        (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
      );
      const generator = new DungeonGenerator({ random });
      const dungeon = generator.generate();
      const conveyorRoom = dungeon.rooms.find((room) => room.id === 'conveyorRoom');
      const conveyorTiles = dungeon.floorTiles.filter((tile) => tile.roomId === conveyorRoom.id);
      const rampColumns = new Map();
      for (const tile of dungeon.floorTiles.filter((entry) => entry.surface === 'industrialRamp')) {
        const key = `${tile.x},${tile.z}`;
        const column = rampColumns.get(key) ?? [];
        column.push(tile);
        rampColumns.set(key, column);
      }
      const supportsInRampColumns = [];
      dungeon.group.traverse((object) => {
        if (object.name !== 'factoryCatwalkSupport') {
          return;
        }
        const x = Math.round(object.position.x / dungeon.tileSize);
        const z = Math.round(object.position.z / dungeon.tileSize);
        const ramps = rampColumns.get(`${x},${z}`) ?? [];
        object.geometry.computeBoundingBox();
        const supportTopY = object.position.y + object.geometry.boundingBox.max.y;
        if (ramps.some((ramp) => {
          const directionX = Math.sign(ramp.rampDirectionX ?? 0);
          const directionZ = Math.sign(ramp.rampDirectionZ ?? 0);
          const localProgress = Math.max(0, Math.min(1, 0.5
            + directionX * (object.position.x / dungeon.tileSize - ramp.x)
            + directionZ * (object.position.z / dungeon.tileSize - ramp.z)));
          const startY = ramp.rampStartElevation ?? ramp.elevation ?? 0;
          const endY = ramp.rampEndElevation ?? ramp.elevation ?? 0;
          const rampSurfaceY = startY + (endY - startY) * localProgress;
          return supportTopY > rampSurfaceY + 0.08;
        })) {
          supportsInRampColumns.push({ x, z });
        }
      });

      generated.push({
        seed,
        accepted: dungeon.progression.validation.accepted,
        errors: dungeon.progression.validation.errors,
        headroomConflictCount:
          dungeon.progression.validation.platformability.rampScaffoldHeadroomConflictCount,
        removedScaffoldTileCount:
          dungeon.progression.validation.platformability.rampClearanceRemovedScaffoldTileCount,
        conveyorPreferredScaffold: conveyorRoom.rampClearancePreferredScaffold === true,
        conveyorRemovedRampRouteCount:
          conveyorRoom.rampClearanceRemovedRampRouteIds?.length ?? 0,
        conveyorConvertedRampTileCount:
          conveyorRoom.rampClearanceConvertedToSolidTileCount ?? 0,
        conveyorRemovedScaffoldTileCount:
          conveyorRoom.rampClearanceRemovedScaffoldTileCount ?? 0,
        conveyorScaffoldCounts: {
          secondFloorConveyor: conveyorTiles.filter((tile) => (
            tile.surface === 'secondFloorConveyor'
          )).length,
          conveyorCrossBridge: conveyorTiles.filter((tile) => (
            tile.surface === 'conveyorCrossBridge'
          )).length,
          thirdFloorGantry: conveyorTiles.filter((tile) => (
            tile.surface === 'thirdFloorGantry'
          )).length,
        },
        directConflictCount: generator._findRampScaffoldHeadroomConflicts(dungeon.floorTiles).length,
        supportsInRampColumns,
      });
      dungeon.group.clear();
    }

    return generated;
  });

  expect(results.every((result) => result.accepted && result.errors.length === 0)).toBe(true);
  expect(results.every((result) => (
    result.headroomConflictCount === 0
    && result.directConflictCount === 0
    && result.supportsInRampColumns.length === 0
  ))).toBe(true);
  expect(results.every((result) => (
    result.conveyorPreferredScaffold
    && result.conveyorConvertedRampTileCount > 0
    && result.conveyorRemovedScaffoldTileCount === 0
    && result.conveyorScaffoldCounts.secondFloorConveyor === 17
    && result.conveyorScaffoldCounts.conveyorCrossBridge === 6
    && result.conveyorScaffoldCounts.thirdFloorGantry === 18
  ))).toBe(true);
  expect(results.some((result) => result.removedScaffoldTileCount > 0)).toBe(true);
});
