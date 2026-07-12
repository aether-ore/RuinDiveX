import { expect, test } from '@playwright/test';

test('pyramid tiers stay grounded, guardians trigger at the summit, and the keycard remains shielded', async ({ page }) => {
  await page.goto('/?reaverbotSeed=pyramid-runtime-proof');
  await page.waitForFunction(() => Boolean(window.game?.dungeonController));

  const result = await page.evaluate(() => {
    const game = window.game;
    const controller = game.dungeonController;
    const player = game.player;
    const dungeon = game.dungeon;
    const room = dungeon.rooms.find((entry) => entry.id === 'keycardRoom');
    const encounter = controller.encounters.find((entry) => entry.id === 'keycardGuard');
    const keycard = controller.keycards.find((entry) => entry.keycardId === 'Keycard_Alpha');
    game.stop();

    const stair = dungeon.floorTiles
      .filter((tile) => tile.roomId === room.id
        && tile.x === room.x
        && ['mechanicalPyramidProcessionalStep', 'mechanicalPyramidSummit'].includes(tile.surface))
      .sort((left, right) => left.z - right.z);
    let lower = null;
    let upper = null;
    for (let index = 1; index < stair.length; index += 1) {
      if (stair[index].z - stair[index - 1].z === 1
        && Math.abs(stair[index].elevation - stair[index - 1].elevation - 0.5) < 0.001) {
        lower = stair[index - 1];
        upper = stair[index];
        break;
      }
    }

    const toWorld = (tile) => new player.root.position.constructor(
      tile.x * dungeon.tileSize,
      tile.elevation,
      tile.z * dungeon.tileSize,
    );
    const upperWorld = toWorld(upper);
    const lowerWorld = toWorld(lower);
    player.jumpState = 'Grounded';
    player.velocity.set(0, 0, 0);
    if (player.animation) {
      player.animation.actionState = null;
      player.animation.actionTimer = 0;
    }
    controller.lastSafePlayerPosition.copy(upperWorld);
    player.root.position.set(lowerWorld.x, upperWorld.y, lowerWorld.z);
    const pyramidProbe = {
      surfaceY: controller.getSurfaceElevationAt(player.root.position),
      floorY: controller.getFloorElevationAt(player.root.position),
      platformY: game.getPlatformFloorElevation(player.root.position),
      walkable: controller.isPositionWalkable(player.root.position),
      insideBlock: game.isPositionInsidePlatformBlock(player.root.position),
      transitionHeight: controller._getGroundedStepTransitionHeight(
        controller.lastSafePlayerPosition,
        player.root.position,
        0.24,
      ),
      playerJumping: controller._isPlayerJumping(),
    };
    controller._constrainPlayerToWalkable();
    const pyramidDescent = {
      state: player.jumpState,
      y: player.root.position.y,
      expectedY: lowerWorld.y,
    };

    player.jumpState = 'Grounded';
    player.root.position.set(0, 1.1, 0);
    player.velocity.set(0, 0, 0);
    player._updatePhysicalJumpAndMovement(1 / 60, new player.root.position.constructor(), {
      movementOptions: { groundY: 0 },
    });
    const campSizedDropState = player.jumpState;

    encounter.spawned = false;
    encounter.cleared = false;
    const entranceProbe = new player.root.position.constructor(
      room.x * dungeon.tileSize,
      0,
      (room.z - room.mechanicalPyramidCenter.baseHalfExtent - 2) * dungeon.tileSize,
    );
    const summitProbe = encounter.triggerZone.position.clone();
    const entranceEncounter = controller.getUnspawnedEncounterAt(entranceProbe)?.id ?? null;
    const summitEncounter = controller.getUnspawnedEncounterAt(summitProbe)?.id ?? null;

    player.root.position.copy(keycard.position);
    controller._updateKeycards(1 / 60);
    const protectedBeforeClear = !keycard.collected && keycard.barrierObject.visible;
    encounter.cleared = true;
    controller._updateKeycards(1 / 60);

    const roomCenter = new player.root.position.constructor(
      room.x * dungeon.tileSize,
      0,
      room.z * dungeon.tileSize,
    );
    const pyramidWallEntries = game.cameraOcclusionEntries
      .filter((entry) => (
        entry.object.name === 'dungeonBoundaryWall'
        && (
          entry.owner.userData.roomId === room.id
          || entry.owner.userData.wallOwnerIds?.includes(room.id)
          || entry.object.userData.wallRun?.ownerIds?.includes(room.id)
        )
      ));
    const originalCameraPosition = game.camera.position.clone();
    const originalCameraQuaternion = game.camera.quaternion.clone();
    const setWallVisibilityProbe = (wallEntry, cameraCrossesWall) => {
      for (let current = wallEntry.owner; current; current = current.parent) {
        current.visible = true;
      }
      const wallSurfacePoint = wallEntry.bounds.clampPoint(
        roomCenter,
        new player.root.position.constructor(),
      );
      const wallRun = wallEntry.object.userData.wallRun;
      const inward = new player.root.position.constructor(-wallRun.dx, 0, -wallRun.dz).normalize();
      player.root.position.copy(wallSurfacePoint)
        .addScaledVector(inward, 0.45);
      player.root.position.y = controller.getSurfaceElevationAt(player.root.position);
      game.camera.position.copy(cameraCrossesWall ? wallSurfacePoint : player.root.position)
        .addScaledVector(inward, cameraCrossesWall ? -2 : 2);
      game.camera.position.y += 2.5;
      game.camera.lookAt(
        player.root.position.x,
        player.root.position.y + 1.25,
        player.root.position.z,
      );
      game.camera.updateMatrixWorld(true);
      game._updateCameraWallOcclusion();
    };
    const cameraRayOccludesEveryWall = pyramidWallEntries.every((wallEntry) => {
      setWallVisibilityProbe(wallEntry, true);
      return wallEntry.owner.visible === false;
    });
    const sameSideCameraKeepsEveryWallVisible = pyramidWallEntries.every((wallEntry) => {
      setWallVisibilityProbe(wallEntry, false);
      return wallEntry.owner.visible === true;
    });
    game.camera.position.copy(originalCameraPosition);
    game.camera.quaternion.copy(originalCameraQuaternion);
    game.camera.updateMatrixWorld(true);

    return {
      pyramidDescent,
      pyramidProbe,
      campSizedDropState,
      enemyCanTraverseTier: controller._canEnemyTraverseFloorTiles(lower, upper),
      entranceEncounter,
      summitEncounter,
      protectedBeforeClear,
      collectedAfterClear: keycard.collected,
      barrierVisibleAfterClear: keycard.barrierObject.visible,
      spawnCount: encounter.spawnPoints.length,
      uniqueSpawnCount: new Set(encounter.spawnPoints.map((point) => (
        `${point.x.toFixed(2)},${point.z.toFixed(2)}`
      ))).size,
      cameraRayOccludesEveryWall,
      sameSideCameraKeepsEveryWallVisible,
    };
  });

  expect(result.pyramidDescent.state).toBe('Grounded');
  expect(result.pyramidProbe.walkable).toBe(true);
  expect(result.pyramidProbe.transitionHeight).toBeCloseTo(0.55, 4);
  expect(result.pyramidDescent.y).toBeCloseTo(result.pyramidDescent.expectedY, 4);
  expect(result.campSizedDropState).toBe('Falling');
  expect(result.enemyCanTraverseTier).toBe(true);
  expect(result.entranceEncounter).toBeNull();
  expect(result.summitEncounter).toBe('keycardGuard');
  expect(result.protectedBeforeClear).toBe(true);
  expect(result.collectedAfterClear).toBe(true);
  expect(result.barrierVisibleAfterClear).toBe(false);
  expect(result.spawnCount).toBe(6);
  expect(result.uniqueSpawnCount).toBe(6);
  expect(result.cameraRayOccludesEveryWall).toBe(true);
  expect(result.sameSideCameraKeepsEveryWallVisible).toBe(true);
});

test('tall architectural wall faces occlude globally without hiding their walkable tops', async ({ page }) => {
  await page.goto('/?reaverbotSeed=global-wall-occlusion-proof');
  await page.waitForFunction(() => Boolean(window.game?.dungeonController));

  const result = await page.evaluate(() => {
    const game = window.game;
    const player = game.player;
    game.stop();

    const entry = game.cameraOcclusionEntries.find((candidate) => (
      candidate.owner.visible
      && candidate.owner.userData?.roomId !== 'keycardRoom'
      && (
        candidate.object.name.startsWith('solidArchitecturalDeckMass_')
        || candidate.object.name.startsWith('solidPurposePlatformMass_')
      )
    ));
    if (!entry) {
      return { found: false };
    }

    const center = entry.bounds.getCenter(new player.root.position.constructor());
    const halfWidth = (entry.bounds.max.x - entry.bounds.min.x) * 0.5;
    const halfDepth = (entry.bounds.max.z - entry.bounds.min.z) * 0.5;
    const sideDirection = new player.root.position.constructor(
      halfWidth <= halfDepth ? 1 : 0,
      0,
      halfWidth <= halfDepth ? 0 : 1,
    );
    const sideSurface = center.clone();
    if (sideDirection.x) sideSurface.x = entry.bounds.max.x;
    if (sideDirection.z) sideSurface.z = entry.bounds.max.z;

    const setProbe = ({ cameraCrossesSurface, playerY }) => {
      for (let current = entry.owner; current; current = current.parent) {
        current.visible = true;
      }
      player.root.position.copy(sideSurface).addScaledVector(sideDirection, 0.45);
      player.root.position.y = playerY;
      game.camera.position.copy(cameraCrossesSurface ? sideSurface : player.root.position)
        .addScaledVector(sideDirection, cameraCrossesSurface ? -2 : 2);
      game.camera.position.y += 2.5;
      game.camera.lookAt(
        player.root.position.x,
        player.root.position.y + 1.25,
        player.root.position.z,
      );
      game.camera.updateMatrixWorld(true);
      game._updateCameraWallOcclusion();
      return entry.owner.visible;
    };

    const wallBetweenCameraAndPlayerVisible = setProbe({
      cameraCrossesSurface: true,
      playerY: entry.bounds.min.y + 0.1,
    });
    const nearbyOffRayWallVisible = setProbe({
      cameraCrossesSurface: false,
      playerY: entry.bounds.min.y + 0.1,
    });
    const standingOnTopVisible = setProbe({
      cameraCrossesSurface: false,
      playerY: entry.bounds.max.y + 0.05,
    });
    return {
      found: true,
      wallBetweenCameraAndPlayerHidden: !wallBetweenCameraAndPlayerVisible,
      nearbyOffRayWallVisible,
      standingOnTopVisible,
      objectName: entry.object.name,
      roomId: entry.owner.userData?.roomId ?? null,
    };
  });

  expect(result.found).toBe(true);
  expect(result.roomId).not.toBe('keycardRoom');
  expect(result.wallBetweenCameraAndPlayerHidden).toBe(true);
  expect(result.nearbyOffRayWallVisible).toBe(true);
  expect(result.standingOnTopVisible).toBe(true);
});

test('door threshold wall wings occlude independently in pyramid and conveyor rooms', async ({ page }) => {
  await page.goto('/?reaverbotSeed=threshold-wall-occlusion-proof');
  await page.waitForFunction(() => Boolean(window.game?.dungeonController));

  const result = await page.evaluate(() => {
    const game = window.game;
    const player = game.player;
    const controller = game.dungeonController;
    const dungeon = game.dungeon;
    game.stop();

    const roomIds = ['keycardRoom', 'conveyorRoom'];
    const roomById = new Map(dungeon.rooms.map((room) => [room.id, room]));
    const entries = game.cameraOcclusionEntries.filter((entry) => (
      entry.object.name.startsWith('doorThresholdWallWing_')
      && roomIds.includes(entry.object.userData?.roomId)
    ));
    const probes = [];
    for (const entry of entries) {
      const room = roomById.get(entry.object.userData.roomId);
      const roomCenter = new player.root.position.constructor(
        room.x * dungeon.tileSize,
        0,
        room.z * dungeon.tileSize,
      );
      const wallSurface = entry.bounds.clampPoint(
        roomCenter,
        new player.root.position.constructor(),
      );
      const inward = roomCenter.clone().sub(wallSurface).setY(0).normalize();
      const sibling = entries.find((candidate) => (
        candidate !== entry
        && candidate.object.userData?.doorId === entry.object.userData?.doorId
      ));
      const setProbe = (cameraCrossesWall) => {
        for (let current = entry.owner; current; current = current.parent) {
          current.visible = true;
        }
        if (sibling) sibling.owner.visible = true;
        player.root.position.copy(wallSurface).addScaledVector(inward, 0.45);
        player.root.position.y = controller.getSurfaceElevationAt(player.root.position);
        game.camera.position.copy(cameraCrossesWall ? wallSurface : player.root.position)
          .addScaledVector(inward, cameraCrossesWall ? -2 : 2);
        game.camera.position.y = player.root.position.y + 2.5;
        game.camera.lookAt(
          player.root.position.x,
          player.root.position.y + 1.25,
          player.root.position.z,
        );
        game.camera.updateMatrixWorld(true);
        game._updateCameraWallOcclusion();
        return {
          wingVisible: entry.owner.visible,
          siblingVisible: sibling?.owner.visible ?? true,
        };
      };
      const crossing = setProbe(true);
      const sameSide = setProbe(false);
      probes.push({
        roomId: room.id,
        doorId: entry.object.userData.doorId,
        side: entry.object.userData.thresholdSide,
        crossingHidesWing: !crossing.wingVisible,
        crossingKeepsSibling: crossing.siblingVisible,
        sameSideKeepsWing: sameSide.wingVisible,
      });
    }

    return {
      probeCount: probes.length,
      coveredRooms: [...new Set(probes.map((probe) => probe.roomId))],
      everyCrossingHidesWing: probes.every((probe) => probe.crossingHidesWing),
      everyCrossingKeepsSibling: probes.every((probe) => probe.crossingKeepsSibling),
      everySameSideKeepsWing: probes.every((probe) => probe.sameSideKeepsWing),
    };
  });

  expect(result.probeCount).toBeGreaterThanOrEqual(4);
  expect(result.coveredRooms.sort()).toEqual(['conveyorRoom', 'keycardRoom']);
  expect(result.everyCrossingHidesWing).toBe(true);
  expect(result.everyCrossingKeepsSibling).toBe(true);
  expect(result.everySameSideKeepsWing).toBe(true);
});
