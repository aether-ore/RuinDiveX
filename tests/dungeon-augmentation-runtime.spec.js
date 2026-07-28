import { expect, test } from '@playwright/test';

const INDUSTRIAL_PROFILE_ID = 'industrial-supplement-preview-v2';
const INDUSTRIAL_THEME_ID = 'industrial-v1';
const INDUSTRIAL_THEME_REVISION = 'industrial-v1-presentation-r1';
const SAVE_IDENTITY_SCHEMA = 'ruindivex-dungeon-augmentation-save-identity/v1';

function captureRuntimeErrors(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  return { pageErrors, consoleErrors };
}

async function waitForDungeon(page, runtimeErrors, timeout = 120_000) {
  try {
    await expect.poll(
      () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout },
    ).toBe('true');
    await expect.poll(
      () => page.evaluate(() => Boolean(window.game?.dungeon?.group)),
      { timeout: 15_000 },
    ).toBe(true);
  } catch (error) {
    throw new Error([
      error.message,
      ...runtimeErrors.pageErrors.map((message) => `pageerror: ${message}`),
      ...runtimeErrors.consoleErrors.map((message) => `console: ${message}`),
    ].join('\n'));
  }
}

async function waitForDungeonPresentationAssets(page, timeout = 20_000) {
  await expect.poll(
    () => page.evaluate(() => {
      const group = window.game?.dungeon?.group;
      if (!group) return false;
      const modelSettled = (name) => {
        const anchor = group.getObjectByName(name);
        return !anchor || (
          anchor.userData.modelLoading === false
          && Boolean(anchor.userData.modelLoaded || anchor.userData.modelLoadError)
        );
      };
      const workbench = group.getObjectByName('rollWorkshopWorkbench');
      const workbenchSettled = !workbench || (
        workbench.userData.textureLoading === false
        && workbench.userData.textureAssetsSettled === true
      );
      let pendingPresentationLoad = false;
      group.traverse((object) => {
        if (object.userData.modelLoading || object.userData.textureLoading) {
          pendingPresentationLoad = true;
        }
      });
      return modelSettled('rollCaskettNpc')
        && modelSettled('expeditionSupportCar')
        && workbenchSettled
        && !pendingPresentationLoad;
    }),
    { timeout },
  ).toBe(true);
  await page.evaluate(() => new Promise((resolve) => (
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  )));
}

async function readLegacySnapshot(page) {
  return page.evaluate(() => {
    const { game } = window;
    const dungeon = game.dungeon;
    const diagnostics = game.getWorldTransitionDiagnostics();
    return {
      groupName: dungeon.group.name,
      basePlanHash: dungeon.basePlanHash ?? null,
      augmentationPlanHash: dungeon.augmentationPlanHash ?? null,
      effectivePlanHash: dungeon.effectivePlanHash ?? null,
      activePlanHash: game.activeWorldBundle?.planHash ?? null,
      augmentationStatus: dungeon.augmentationStatus ?? null,
      augmentationIdentity: dungeon.augmentationIdentity ?? null,
      augmentationOverlayPlan: dungeon.augmentationOverlayPlan ?? null,
      diagnostics: diagnostics.dungeonAugmentation,
      supplementRootCount: dungeon.group.children.filter((child) => (
        child.name === 'DungeonSupplementRoot'
        || child.userData?.dungeonSupplementRoot === true
      )).length,
      supplementalRoomCount: dungeon.rooms.filter((room) => room.isDungeonSupplement).length,
      rooms: dungeon.rooms
        .map((room) => ({
          id: room.id,
          type: room.type,
          x: room.x,
          z: room.z,
          width: room.width,
          depth: room.depth,
          baseElevation: Number(room.baseElevation ?? 0),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      connections: dungeon.connectionPlans
        .map((connection) => ({
          id: connection.id,
          logicalConnectionId: connection.logicalConnectionId ?? null,
          fromRoomId: connection.fromRoomId,
          toRoomId: connection.toRoomId,
          doorId: connection.doorId ?? null,
          connectorVariantId: connection.connectorVariantId ?? null,
          fullPath: (connection.fullPath ?? []).map(({ x, z }) => ({ x, z })),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    };
  });
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.game?.stop?.()).catch(() => {});
});

test('default and explicit off preserve the exact legacy dungeon facade and hashes', async ({ page }) => {
  test.setTimeout(240_000);
  const runtimeErrors = captureRuntimeErrors(page);
  const seedQuery = 'startupWorld=dungeon&busterLab=sandbox&dungeonSeed=augmentation-off-runtime';

  await page.goto(`/?${seedQuery}`);
  await waitForDungeon(page, runtimeErrors);
  const defaultSnapshot = await readLegacySnapshot(page);

  await page.evaluate(() => window.game.stop());
  await page.goto(`/?${seedQuery}&dungeonAugmentation=off`);
  await waitForDungeon(page, runtimeErrors);
  const explicitOffSnapshot = await readLegacySnapshot(page);

  expect(explicitOffSnapshot).toEqual(defaultSnapshot);
  expect(defaultSnapshot.rooms).toHaveLength(13);
  expect(defaultSnapshot.basePlanHash).toBeTruthy();
  expect(defaultSnapshot.effectivePlanHash).toBe(defaultSnapshot.basePlanHash);
  expect(defaultSnapshot.activePlanHash).toBe(defaultSnapshot.basePlanHash);
  expect(defaultSnapshot.augmentationPlanHash).toBeNull();
  expect(defaultSnapshot.augmentationStatus).toBeNull();
  expect(defaultSnapshot.augmentationIdentity).toBeNull();
  expect(defaultSnapshot.augmentationOverlayPlan).toBeNull();
  expect(defaultSnapshot.supplementRootCount).toBe(0);
  expect(defaultSnapshot.supplementalRoomCount).toBe(0);
  expect(defaultSnapshot.diagnostics).toMatchObject({
    status: 'disabled',
    profileId: null,
    basePlanHash: defaultSnapshot.basePlanHash,
    augmentationPlanHash: null,
    effectivePlanHash: defaultSnapshot.basePlanHash,
  });
});

test('opt-in Industrial preview assembles the deterministic inherited sidecar', async ({ page }) => {
  test.setTimeout(240_000);
  const runtimeErrors = captureRuntimeErrors(page);

  await page.goto([
    '/?startupWorld=dungeon',
    'busterLab=sandbox',
    'dungeonSeed=augmentation-runtime-check',
    'dungeonAugmentation=preview',
  ].join('&'));
  await waitForDungeon(page, runtimeErrors, 180_000);

  const snapshot = await page.evaluate(() => {
    const { game } = window;
    const dungeon = game.dungeon;
    const supplementRoot = dungeon.dungeonSupplementRoot ?? dungeon.supplementRoot ?? null;
    const supplementRooms = dungeon.rooms
      .filter((room) => room.isDungeonSupplement)
      .sort((left, right) => left.id.localeCompare(right.id));
    const supplementRoomIds = supplementRooms.map((room) => room.id);
    const supplementRoomIdSet = new Set(supplementRoomIds);
    const supplementConnections = dungeon.connectionPlans.filter((connection) => (
      connection.isDungeonSupplement
    ));
    const minimapRoomIds = (dungeon.minimap?.rooms ?? [])
      .map((room) => room.roomId ?? room.id)
      .filter((roomId) => supplementRoomIdSet.has(roomId))
      .sort();
    const minimapHallways = (dungeon.minimap?.hallways ?? dungeon.minimap?.connections ?? [])
      .filter((hallway) => {
        const from = hallway.fromRoomId ?? hallway.fromNodeId ?? hallway.from;
        const to = hallway.toRoomId ?? hallway.toNodeId ?? hallway.to;
        return supplementRoomIdSet.has(from) || supplementRoomIdSet.has(to);
      });
    const supplementEncounters = (dungeon.encounters ?? []).filter((encounter) => (
      encounter.isDungeonSupplement
      || supplementRoomIdSet.has(encounter.roomId)
    ));

    const supplementObjects = new Set();
    supplementRoot?.traverse((object) => supplementObjects.add(object));
    const outsideSupplementOwners = [];
    const supplementMaterials = new Map();
    const parentMaterials = new Set();
    const assetCatalogIds = [];
    const boundThemeIds = [];
    let supplementLightCount = 0;
    const addMaterials = (target, material) => {
      for (const entry of (Array.isArray(material) ? material : [material])) {
        if (!entry) continue;
        if (target instanceof Map) target.set(entry.uuid, entry.name || entry.type || entry.uuid);
        else target.add(entry.uuid);
      }
    };
    supplementRoot?.traverse((object) => {
      if (object.isLight) supplementLightCount += 1;
      if (object.isMesh) addMaterials(supplementMaterials, object.material);
      if (object.userData?.parentAssetCatalogId) {
        assetCatalogIds.push(object.userData.parentAssetCatalogId);
      }
      const themeId = object.userData?.themeBinding?.themeRef?.id;
      if (themeId) boundThemeIds.push(themeId);
    });
    dungeon.group.traverse((object) => {
      if (!supplementObjects.has(object) && object.isMesh) {
        addMaterials(parentMaterials, object.material);
      }
      if (supplementObjects.has(object)) return;
      const directOwners = [
        object.userData?.augmentationOwnerId,
        object.userData?.roomId,
        object.userData?.connectorId,
      ].filter(Boolean);
      if (directOwners.some((ownerId) => String(ownerId).startsWith('supplement:'))) {
        outsideSupplementOwners.push(object.name || object.uuid);
      }
    });
    const foreignSupplementMaterials = [...supplementMaterials]
      .filter(([uuid]) => !parentMaterials.has(uuid))
      .map(([, name]) => name)
      .sort();
    const resourceCounts = dungeon.dungeonSupplement
      ?.diagnostics?.assembled?.resourceCounts ?? null;
    const identity = dungeon.augmentationIdentity ?? null;
    const overlay = dungeon.augmentationOverlayPlan ?? null;
    const diagnostics = game.getWorldTransitionDiagnostics().dungeonAugmentation;
    const operationTypeById = new Map((overlay?.operations ?? []).map((operation) => [
      operation.id,
      operation.type ?? operation.operationType ?? operation.kind,
    ]));
    const branchRoomCount = supplementRooms.filter((room) => (
      operationTypeById.get(room.augmentationOperationId) === 'optionalBranch'
    )).length;
    const paddingRoomCount = supplementRooms.filter((room) => (
      operationTypeById.get(room.augmentationOperationId) === 'edgePadding'
    )).length;
    const physicalSupplementConnections = dungeon.connectionPlans.filter((plan) => (
      plan.isDungeonSupplement && !plan.isSupplementGraphConnection
    ));
    const longestExteriorCorridorRunTiles = Math.max(0, ...physicalSupplementConnections
      .map((plan) => {
        let longest = 0;
        let current = 0;
        for (const point of plan.bridgePath ?? plan.fullPath ?? []) {
          const hasExteriorFloor = dungeon.floorTiles.some((tile) => (
            tile.x === point.x
            && tile.z === point.z
            && !tile.roomId
            && (tile.connectionId === plan.id || tile.connectorId === plan.id)
          ));
          current = hasExteriorFloor ? current + 1 : 0;
          longest = Math.max(longest, current);
        }
        return longest;
      }));
    const paddedLogicalIds = new Set((overlay?.operations ?? [])
      .filter((operation) => operation.type === 'edgePadding')
      .map((operation) => operation.originalLogicalEdge?.id)
      .filter(Boolean));
    const progressionSupplementConnections = (dungeon.progression?.roomConnections ?? [])
      .filter((connection) => connection.isDungeonSupplement);
    const connectorEntrances = dungeon.progression?.validation?.connectorEntrances ?? null;
    const augmentationMetrics = dungeon.augmentationMetrics ?? null;

    return {
      generationAccepted: dungeon.progression?.validation?.accepted ?? false,
      status: dungeon.augmentationStatus ?? null,
      profileId: identity?.profileId ?? null,
      basePlanHash: dungeon.basePlanHash ?? null,
      augmentationPlanHash: dungeon.augmentationPlanHash ?? null,
      effectivePlanHash: dungeon.effectivePlanHash ?? null,
      activePlanHash: game.activeWorldBundle?.planHash ?? null,
      operationTypes: (overlay?.operations ?? [])
        .map((operation) => operation.type ?? operation.operationType ?? operation.kind)
        .sort(),
      totalRoomCount: dungeon.rooms.length,
      authoredRoomCount: dungeon.rooms.filter((room) => !room.isDungeonSupplement).length,
      supplementRoomIds,
      branchRoomCount,
      paddingRoomCount,
      longestExteriorCorridorRunTiles,
      supplementConnectionCount: supplementConnections.length,
      paddedLogicalConnectionCount: dungeon.connectionPlans.filter((connection) => (
        connection.isPaddedByDungeonSupplement && !connection.isDungeonSupplement
      )).length,
      rootName: supplementRoot?.name ?? null,
      rootParentIsDungeon: supplementRoot?.parent === dungeon.group,
      rootRoomIds: [...(supplementRoot?.userData?.supplementalRoomIds ?? [])].sort(),
      minimapRoomIds,
      minimapHallwayCount: minimapHallways.length,
      supplementEncounterCount: supplementEncounters.length,
      supplementEncounterRoomIds: [...new Set(
        supplementEncounters.map((encounter) => encounter.roomId).filter(Boolean),
      )].sort(),
      supplementLightCount,
      localLightRecordCount: (dungeon.localLights ?? []).length,
      identity,
      diagnostics,
      assetCatalogIds: [...new Set(assetCatalogIds)].sort(),
      boundThemeIds: [...new Set(boundThemeIds)].sort(),
      supplementMaterialCount: supplementMaterials.size,
      foreignSupplementMaterials,
      outsideSupplementOwners,
      resourceCounts,
      progressionSupplementConnectionCount: progressionSupplementConnections.length,
      progressionSupplementEndpointsResolve: progressionSupplementConnections.every((connection) => (
        dungeon.rooms.some((room) => room.id === connection.fromRoomId)
          && dungeon.rooms.some((room) => room.id === connection.toRoomId)
      )),
      connectorEntrances,
      segmentBarriersValidated:
        dungeon.progression?.validation?.platformability?.segmentBarriersValidated ?? false,
      augmentationMetrics,
      retainsPaddedLogicalProgressionEdge: (dungeon.progression?.roomConnections ?? [])
        .some((connection) => paddedLogicalIds.has(connection.id)),
      retainsPaddedLogicalMinimapEdge: (dungeon.minimap?.hallways ?? [])
        .some((hallway) => paddedLogicalIds.has(hallway.hallwayId ?? hallway.id)),
    };
  });

  expect(snapshot.generationAccepted).toBe(true);
  expect(snapshot.status, JSON.stringify(snapshot.diagnostics, null, 2)).toBe('applied');
  expect(snapshot.profileId).toBe(INDUSTRIAL_PROFILE_ID);
  expect(snapshot.operationTypes).toEqual(['edgePadding', 'optionalBranch']);
  expect(snapshot.supplementRoomIds.length).toBeGreaterThanOrEqual(3);
  expect(snapshot.supplementRoomIds.length).toBeLessThanOrEqual(4);
  expect(snapshot.branchRoomCount).toBe(2);
  expect(snapshot.paddingRoomCount).toBeGreaterThanOrEqual(1);
  expect(snapshot.paddingRoomCount).toBeLessThanOrEqual(2);
  expect(snapshot.branchRoomCount + snapshot.paddingRoomCount).toBe(
    snapshot.supplementRoomIds.length,
  );
  expect(snapshot.longestExteriorCorridorRunTiles).toBeGreaterThanOrEqual(2);
  expect(snapshot.authoredRoomCount).toBe(13);
  expect(snapshot.totalRoomCount).toBe(
    snapshot.authoredRoomCount + snapshot.supplementRoomIds.length,
  );
  expect(snapshot.supplementConnectionCount).toBeGreaterThanOrEqual(2);
  expect(snapshot.paddedLogicalConnectionCount).toBe(1);
  expect(snapshot.augmentationMetrics).toMatchObject({
    operationCount: 2,
    roomCount: snapshot.supplementRoomIds.length,
    physicalConnectionCount: snapshot.supplementConnectionCount,
  });
  expect(snapshot.augmentationMetrics.tileCount).toBeGreaterThan(0);
  expect(snapshot.augmentationMetrics.meshCount).toBeGreaterThan(0);

  expect(snapshot.connectorEntrances.checkedSocketCount).toBeGreaterThan(0);
  expect(snapshot.connectorEntrances.acceptedSocketCount).toBe(
    snapshot.connectorEntrances.checkedSocketCount,
  );
  expect(snapshot.connectorEntrances.checks.every((check) => (
    check.socketReachable
      && check.outsideReachable
      && check.traversableOutward
      && check.traversableReturn
      && check.blockingWallFacadeId === null
  ))).toBe(true);
  expect(snapshot.segmentBarriersValidated).toBe(true);

  expect(snapshot.basePlanHash).toBeTruthy();
  expect(snapshot.augmentationPlanHash).toBeTruthy();
  expect(snapshot.augmentationPlanHash).not.toBe(snapshot.basePlanHash);
  expect(snapshot.effectivePlanHash).toBeTruthy();
  expect(snapshot.effectivePlanHash).not.toBe(snapshot.basePlanHash);
  expect(snapshot.activePlanHash).toBe(snapshot.effectivePlanHash);

  expect(snapshot.rootName).toBe('DungeonSupplementRoot');
  expect(snapshot.rootParentIsDungeon).toBe(true);
  expect(snapshot.rootRoomIds).toEqual(snapshot.supplementRoomIds);
  expect(snapshot.minimapRoomIds).toEqual(snapshot.supplementRoomIds);
  expect(snapshot.minimapHallwayCount).toBeGreaterThanOrEqual(2);
  expect(snapshot.supplementEncounterCount).toBeGreaterThanOrEqual(
    snapshot.supplementRoomIds.length,
  );
  expect(snapshot.supplementEncounterRoomIds).toEqual(snapshot.supplementRoomIds);
  expect(snapshot.supplementLightCount).toBeGreaterThan(0);
  expect(snapshot.localLightRecordCount).toBeGreaterThan(0);

  expect(snapshot.identity).toMatchObject({
    schema: SAVE_IDENTITY_SCHEMA,
    profileId: INDUSTRIAL_PROFILE_ID,
    basePlanHash: snapshot.basePlanHash,
    augmentationPlanHash: snapshot.augmentationPlanHash,
    effectivePlanHash: snapshot.effectivePlanHash,
    themeRevisions: [{
      themeId: INDUSTRIAL_THEME_ID,
      revision: INDUSTRIAL_THEME_REVISION,
    }],
  });
  expect(snapshot.diagnostics).toMatchObject({
    status: 'applied',
    profileId: INDUSTRIAL_PROFILE_ID,
    basePlanHash: snapshot.basePlanHash,
    augmentationPlanHash: snapshot.augmentationPlanHash,
    effectivePlanHash: snapshot.effectivePlanHash,
  });

  expect(snapshot.assetCatalogIds.length).toBeGreaterThan(0);
  expect(snapshot.assetCatalogIds.every((id) => id.startsWith('industrial-v1:'))).toBe(true);
  expect(snapshot.boundThemeIds).toEqual([INDUSTRIAL_THEME_ID]);
  expect(snapshot.supplementMaterialCount).toBeGreaterThan(0);
  expect(snapshot.foreignSupplementMaterials).toEqual([]);
  // Parent-integrated floors, ceilings, and threshold arches intentionally
  // remain in the parent's culling/occlusion hierarchy. They may carry the
  // supplemental connector owner ID without becoming foreign presentation.
  expect(snapshot.outsideSupplementOwners.length).toBeGreaterThan(0);
  expect(snapshot.outsideSupplementOwners.every((name) => (
    name === 'dungeonFloorTileVisual'
      || name === 'dungeonRoomCeiling'
      || name.startsWith('connectorIndustrialArch_')
      || name.startsWith('classicV1CorridorFurnishing_')
  ))).toBe(true);
  expect(snapshot.progressionSupplementConnectionCount).toBe(snapshot.supplementConnectionCount);
  expect(snapshot.progressionSupplementEndpointsResolve).toBe(true);
  expect(snapshot.retainsPaddedLogicalProgressionEdge).toBe(false);
  expect(snapshot.retainsPaddedLogicalMinimapEdge).toBe(false);
  expect(snapshot.resourceCounts).toMatchObject({
    borrowedCount: expect.any(Number),
    ownedCount: expect.any(Number),
  });
  // Facade-only assembly owns its generated asset groups at the fragment
  // level; the parent material borrows are tracked by the resolved theme
  // session inside those products.
  expect(snapshot.resourceCounts.ownedCount).toBeGreaterThan(0);
  expect(snapshot.resourceCounts.themeSessions?.[0]?.borrowedCount ?? 0).toBeGreaterThan(0);

  const teardown = await page.evaluate(() => {
    const dungeon = window.game.dungeon;
    const fragment = dungeon.dungeonSupplement;
    const root = dungeon.dungeonSupplementRoot;
    const materials = new Set();
    const supplementGeometries = new Set();
    const parentGeometries = new Set();
    let materialDisposeEvents = 0;
    let geometryDisposeEvents = 0;
    let sharedGeometryDisposeEvents = 0;
    root.traverse((object) => {
      if (object.geometry && !supplementGeometries.has(object.geometry)) {
        supplementGeometries.add(object.geometry);
        object.geometry.addEventListener?.('dispose', () => { geometryDisposeEvents += 1; });
      }
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material || materials.has(material)) continue;
        materials.add(material);
        material.addEventListener?.('dispose', () => { materialDisposeEvents += 1; });
      }
    });
    const supplementObjects = new Set();
    root.traverse((object) => supplementObjects.add(object));
    dungeon.group.traverse((object) => {
      if (!supplementObjects.has(object) && object.geometry) parentGeometries.add(object.geometry);
    });
    const sharedGeometries = [...supplementGeometries].filter((geometry) => parentGeometries.has(geometry));
    for (const geometry of sharedGeometries) {
      geometry.addEventListener?.('dispose', () => { sharedGeometryDisposeEvents += 1; });
    }
    fragment.dispose();
    fragment.dispose();
    return {
      rootDetached: root.parent === null,
      materialDisposeEvents,
      geometryDisposeEvents,
      sharedGeometryCount: sharedGeometries.length,
      sharedGeometryDisposeEvents,
    };
  });
  expect(teardown.rootDetached).toBe(true);
  expect(teardown.materialDisposeEvents).toBe(0);
  expect(teardown.geometryDisposeEvents).toBeGreaterThan(0);
  expect(teardown.sharedGeometryCount).toBeGreaterThan(0);
  expect(teardown.sharedGeometryDisposeEvents).toBe(0);
});

test('five opt-in reset cycles plateau supplement ownership and live resource counts', async ({ page }) => {
  test.setTimeout(360_000);
  const runtimeErrors = captureRuntimeErrors(page);
  await page.goto([
    '/?startupWorld=dungeon',
    'busterLab=sandbox',
    'dungeonSeed=augmentation-runtime-check',
    'dungeonAugmentation=preview',
  ].join('&'));
  await waitForDungeon(page, runtimeErrors, 180_000);

  const samples = [];
  for (let cycle = 0; cycle < 5; cycle += 1) {
    const reset = await page.evaluate(() => (
      window.game.resetDungeonLayout({
        free: true,
        advanceFloor: false,
        regenerateSeed: false,
        abandonExpedition: false,
        message: 'Dungeon augmentation lifecycle verification',
      })
    ));
    await waitForDungeonPresentationAssets(page);
    const sample = await page.evaluate((resetResult) => {
      const { game } = window;
      const geometries = new Set();
      const materials = new Set();
      game.dungeon.group.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry.uuid);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (material) materials.add(material.uuid);
        }
      });
      return {
        reset: resetResult,
        status: game.dungeon.augmentationStatus,
        roomCount: game.dungeon.rooms.length,
        supplementRoomCount: game.dungeon.rooms.filter((room) => room.isDungeonSupplement).length,
        supplementRootCount: game.dungeon.group.children.filter((child) => (
          child.userData?.dungeonSupplementRoot === true
        )).length,
        geometryCount: geometries.size,
        materialCount: materials.size,
        encounterCount: game.dungeon.encounters.length,
        hazardCount: (game.dungeon.environmentalHazards ?? []).length
          + (game.dungeon.traps ?? []).length,
        disposableResourceCount: game.activeWorldBundle?.disposableResources?.length ?? 0,
        rendererGeometries: game.renderer.info.memory.geometries,
        rendererTextures: game.renderer.info.memory.textures,
        controllerBoundToCurrentDungeon: game.dungeonController?.dungeon === game.dungeon,
      };
    }, reset);
    samples.push(sample);
  }

  for (const sample of samples) {
    expect(sample).toMatchObject({
      reset: true,
      status: 'applied',
      supplementRootCount: 1,
      disposableResourceCount: 1,
      controllerBoundToCurrentDungeon: true,
    });
    expect(sample.supplementRoomCount).toBeGreaterThanOrEqual(3);
    expect(sample.supplementRoomCount).toBeLessThanOrEqual(4);
  }
  const stableKeys = [
    'roomCount',
    'supplementRoomCount',
    'geometryCount',
    'materialCount',
    'encounterCount',
    'hazardCount',
    'disposableResourceCount',
  ];
  for (const key of stableKeys) {
    expect(
      new Set(samples.slice(2).map((sample) => sample[key])).size,
      `${key} did not plateau: ${JSON.stringify(samples.map((sample) => sample[key]))}`,
    ).toBe(1);
  }
  for (const key of ['rendererGeometries', 'rendererTextures']) {
    const tail = samples.slice(2).map((sample) => sample[key]);
    expect(
      Math.max(...tail) - Math.min(...tail),
      `${key} kept growing: ${JSON.stringify(samples.map((sample) => sample[key]))}`,
    ).toBeLessThanOrEqual(1);
  }
});
