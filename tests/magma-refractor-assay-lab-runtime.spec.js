import { expect, test } from '@playwright/test';

import {
  readPublicV1JourneyState,
} from './helpers/public-v1-journey.js';

const ROOM_ID = 'magma-refractor-assay-lab';
const SMELTER_SEAL_ID = 'Smelter_Seal';
const BULKHEAD_ID = 'Door_Smelter_Bulkhead';

const previewUrl = (suffix = '') => (
  `/?startupWorld=dungeon&roomPreview=${ROOM_ID}`
    + `&dungeonSeed=assay-lab-runtime${suffix}`
);

const waitForPreview = async (page) => {
  await page.waitForFunction(() => (
    document.getElementById('game-container')?.dataset.browserTestReady === 'true'
  ));
};

const captureRuntimeErrors = (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
};

test('Refractor Assay Lab preview loads its complete authored contract and keeps advancing frames', async ({ page }) => {
  const runtimeErrors = captureRuntimeErrors(page);
  const textureRequests = [];
  const retiredRoomAssetRequests = [];
  page.on('response', (response) => {
    const url = response.url();
    if (/assets\/textures\/magma-refinery\//i.test(url)) {
      textureRequests.push({ url, status: response.status() });
    }
    if (/assets\/models\/magma-refinery\/(rooms|connectors)\//i.test(url)) {
      retiredRoomAssetRequests.push(url);
    }
  });

  await page.goto(previewUrl('-load'));
  await waitForPreview(page);

  const contract = await page.evaluate(() => {
    const game = window.game;
    const dungeon = game.dungeon;
    const meshes = [];
    dungeon.group.traverse((object) => {
      if (object.isMesh || object.isInstancedMesh) meshes.push(object);
    });
    const wallOwners = meshes.filter((mesh) => mesh.userData.cameraOcclusionOwner === true);
    const registeredWallRecords = [...game.cameraOcclusionProximityRecordByKey.values()]
      .filter((record) => record.entry?.object?.name?.startsWith('assayLabCameraWallBatch'));
    const publicState = game.getPublicDungeonJourneyDiagnostics({ includeGeometry: false });
    const seal = publicState.keycards.find((keycard) => keycard.keycardId === 'Smelter_Seal');
    const bulkhead = publicState.doors.find((door) => door.id === 'Door_Smelter_Bulkhead');
    const materials = [...dungeon.group.userData.authoredOwnedMaterials]
      .filter((material) => material.map)
      .map((material) => ({
        name: material.name,
        metersPerRepeat: material.userData.worldUvMetersPerRepeat,
        stretchedUvsAllowed: material.userData.stretchedUvsAllowed,
        wrapS: material.map.wrapS,
        wrapT: material.map.wrapT,
      }));
    return {
      roomModuleIds: dungeon.roomModuleIds,
      dungeonFamilyId: dungeon.dungeonFamilyId,
      dungeonKind: dungeon.dungeonKind,
      developmentFixture: dungeon.developmentFixture,
      playerStart: dungeon.playerStart.toArray(),
      floorTileCount: dungeon.floorTiles.length,
      walkableFloorTileCount: dungeon.floorTiles.filter((tile) => tile.surface !== 'deepMagma').length,
      floorElevations: [...new Set(dungeon.floorTiles.map((tile) => tile.elevation))].sort((a, b) => a - b),
      rampRouteIds: [...new Set(dungeon.floorTiles
        .filter((tile) => tile.surfaceRole === 'ramp')
        .map((tile) => tile.rampRouteId))].sort(),
      rampLandings: dungeon.rampLandings,
      socketFrames: dungeon.socketFrames,
      environmentalSpines: dungeon.minimap.environmentalSpines,
      environmentalHazards: dungeon.environmentalHazards,
      meshCount: meshes.length,
      tiledMeshCount: meshes.filter((mesh) => mesh.geometry?.userData?.worldUvTiled === true).length,
      materials,
      wallOwnerCount: wallOwners.length,
      invalidWallOwnerCount: wallOwners.filter((owner) => (
        owner.userData.cameraOcclusionSurface !== true
          || owner.userData.cameraOcclusionWall !== true
          || owner.userData.literalWall !== true
          || owner.userData.cameraOcclusionPerInstance !== true
      )).length,
      registeredWallRecordCount: registeredWallRecords.length,
      registeredNonWallRecordCount: [...game.cameraOcclusionProximityRecordByKey.values()]
        .filter((record) => record.entry?.object?.userData?.cameraOcclusionOwner === true)
        .filter((record) => record.entry?.object?.userData?.cameraOcclusionWall !== true)
        .length,
      seal,
      bulkhead,
      sealPedestalExists: Boolean(dungeon.group.getObjectByName('smelterSealGrandPedestal')),
      sealCradleExists: Boolean(dungeon.group.getObjectByName('smelterSealEmptyCradle')),
      sealPickupExists: Boolean(dungeon.group.getObjectByName('smelter-seal-pickup')),
      bulkheadPanelCount: [
        dungeon.group.getObjectByName('smelterBulkheadPanelLeft'),
        dungeon.group.getObjectByName('smelterBulkheadPanelRight'),
      ].filter(Boolean).length,
      diagnostics: dungeon.moduleManifestDiagnostics,
      supportDiagnostics: dungeon.supportDiagnostics,
    };
  });

  expect(contract.roomModuleIds).toEqual([ROOM_ID]);
  expect(contract.dungeonFamilyId).toBe('industrial-v1');
  expect(contract.dungeonKind).toBe('magmaRefractorAssayLabDevelopmentFixture');
  expect(contract.developmentFixture).toBe(true);
  expect(contract.playerStart).toEqual([33.599999999999994, 0, 50.4]);
  expect(contract.floorTileCount).toBeGreaterThan(1_000);
  expect(contract.walkableFloorTileCount).toBeGreaterThan(800);
  expect(contract.floorElevations).toEqual(expect.arrayContaining([-8.4, -5.6, -2.8, 0, 2.8]));
  expect(contract.rampRouteIds).toEqual([
    'assay-entry-descent',
    'assay-rear-rise',
    'assayer-gallery-return',
    'assayer-gallery-rise',
    'east-dais-rise',
    'west-dais-return',
  ]);
  expect(contract.rampLandings).toHaveLength(12);
  expect(contract.rampLandings.every((landing) => (
    landing.widthTiles >= 3
      && landing.depthTiles >= 3
      && landing.clearWidthMeters >= 8.4 - 0.001
      && landing.clearDepthMeters >= 8.4 - 0.001
      && landing.propFree === true
  ))).toBe(true);
  expect(contract.socketFrames).toHaveLength(2);
  expect(contract.socketFrames.map(({ socketId }) => socketId)).toEqual([
    'assay-lab-entry-socket',
    'assay-lab-ember-crown-socket',
  ]);
  expect(contract.socketFrames.every((frame) => (
    frame.openingWidthMeters === 8.4
      && frame.openingHeightMeters === 5.6
      && frame.thresholdAlignmentToleranceMeters === 0.05
  ))).toBe(true);
  expect(contract.environmentalSpines).toEqual([
    expect.objectContaining({
      id: 'magma-refinery-lava-spine',
      inletSocketId: 'assay-lab-lava-inlet',
      outletSocketId: 'assay-lab-lava-outlet',
      active: true,
    }),
  ]);
  expect(contract.environmentalHazards).toEqual([
    expect.objectContaining({
      id: 'magma-refinery-lava-spine',
      kind: 'deepMagma',
      damagePerSecond: 24,
      movementMultiplier: 0.55,
      heatResistantMovementMultiplier: 0.8,
      heatResistDamageMultiplier: 0.4,
    }),
  ]);
  expect(contract.meshCount).toBeGreaterThan(80);
  expect(contract.tiledMeshCount).toBe(contract.meshCount);
  expect(contract.materials).toHaveLength(9);
  expect(contract.materials.every((material) => (
    material.metersPerRepeat === 2.8
      && material.stretchedUvsAllowed === false
      && material.wrapS === material.wrapT
  ))).toBe(true);
  expect(contract.wallOwnerCount).toBeGreaterThan(0);
  expect(contract.invalidWallOwnerCount).toBe(0);
  expect(contract.registeredWallRecordCount).toBeGreaterThan(contract.wallOwnerCount);
  expect(contract.registeredNonWallRecordCount).toBe(0);
  expect(contract.seal).toEqual(expect.objectContaining({
    id: 'smelter-seal-pickup',
    keycardId: SMELTER_SEAL_ID,
    collected: false,
  }));
  expect(contract.bulkhead).toEqual(expect.objectContaining({
    id: BULKHEAD_ID,
    closed: true,
    opened: false,
  }));
  expect(contract.sealPedestalExists).toBe(true);
  expect(contract.sealCradleExists).toBe(true);
  expect(contract.sealPickupExists).toBe(true);
  expect(contract.bulkheadPanelCount).toBe(2);
  expect(contract.supportDiagnostics).toEqual(expect.objectContaining({
    structuralSupportCount: expect.any(Number),
    supportDatumViolationCount: 0,
    unresolvedElevatedFootprintCount: 0,
  }));
  expect(contract.supportDiagnostics.structuralSupportCount).toBeGreaterThan(0);
  expect(contract.diagnostics).toEqual(expect.objectContaining({
    accepted: true,
    moduleId: ROOM_ID,
    safeRequiredRoute: true,
    criticalPathEncounterLocked: false,
    entryElevation: 0,
    mainFloorElevation: -5.6,
    sealDaisElevation: -2.8,
    galleryElevation: 2.8,
    exitElevation: 0,
    minimumRouteWidthTiles: 3,
    minimumHeadroomMeters: 8.4,
    rampLandingCount: 12,
    minimumRampLandingTiles: 3,
    lavaContinuityAccepted: true,
    dryRequiredRoute: true,
    untexturedVoidCellCount: 0,
    exteriorVoidVisible: false,
    giantShellPresent: false,
    cameraOcclusion: expect.objectContaining({
      surfaceType: 'walls-only',
      wallOwnerCount: expect.any(Number),
      nonWallOwnerCount: 0,
    }),
    collisionParity: expect.objectContaining({ accepted: true }),
  }));

  // Browser readiness precedes texture compilation. Prove the render loop
  // continues after the room and its retained texture suite have settled.
  await page.waitForTimeout(1_800);
  const frameSample = await page.evaluate(async () => {
    let frames = 0;
    const started = performance.now();
    const gameElapsedAtStart = window.game.elapsedTime;
    await new Promise((resolve) => {
      const tick = () => {
        frames += 1;
        if (performance.now() - started >= 900) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return {
      frames,
      wallMilliseconds: performance.now() - started,
      gameElapsedDelta: window.game.elapsedTime - gameElapsedAtStart,
    };
  });
  expect(frameSample.frames).toBeGreaterThan(2);
  expect(frameSample.wallMilliseconds).toBeLessThan(1_800);
  expect(frameSample.gameElapsedDelta).toBeGreaterThan(0.1);

  expect(textureRequests.length).toBeGreaterThanOrEqual(36);
  expect(textureRequests.every(({ status }) => status === 200)).toBe(true);
  expect(retiredRoomAssetRequests).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  await page.evaluate(() => window.game.stop());
});

test('the player can collect the Smelter Seal through normal controls and it opens the paired bulkhead', async ({ page }) => {
  test.setTimeout(90_000);
  const runtimeErrors = captureRuntimeErrors(page);
  await page.goto(
    previewUrl('-credential')
      + '&roomPreviewAnchor=smelterSeal&roomPreviewFacing=west',
  );
  await waitForPreview(page);
  await page.waitForTimeout(900);
  await page.locator('canvas').click({ position: { x: 640, y: 360 } });

  const before = await readPublicV1JourneyState(page);
  const seal = before.keycards.find((keycard) => keycard.keycardId === SMELTER_SEAL_ID);
  const bulkheadBefore = before.doors.find((door) => door.id === BULKHEAD_ID);
  expect(seal).toEqual(expect.objectContaining({ collected: false }));
  expect(bulkheadBefore).toEqual(expect.objectContaining({ closed: true, opened: false }));
  expect(before.ownedKeys).not.toContain(SMELTER_SEAL_ID);

  const startPosition = before.player.position;
  await page.keyboard.down('KeyW');
  try {
    await expect.poll(async () => (
      (await readPublicV1JourneyState(page, { includeGeometry: false }))
        .ownedKeys.includes(SMELTER_SEAL_ID)
    ), { timeout: 20_000, intervals: [100, 150, 250] }).toBe(true);
  } finally {
    await page.keyboard.up('KeyW').catch(() => {});
  }
  await expect.poll(async () => {
    const state = await readPublicV1JourneyState(page, { includeGeometry: false });
    const currentSeal = state.keycards.find((keycard) => keycard.keycardId === SMELTER_SEAL_ID);
    const currentBulkhead = state.doors.find((door) => door.id === BULKHEAD_ID);
    return {
      sealCollected: currentSeal?.collected ?? false,
      sealOwned: state.ownedKeys.includes(SMELTER_SEAL_ID),
      bulkheadClosed: currentBulkhead?.closed ?? true,
      bulkheadOpened: currentBulkhead?.opened ?? false,
    };
  }, { timeout: 20_000 }).toEqual({
    sealCollected: true,
    sealOwned: true,
    bulkheadClosed: false,
    bulkheadOpened: true,
  });

  const visibleState = await page.evaluate(() => ({
    pickupVisible: window.game.dungeon.group.getObjectByName('smelter-seal-pickup')?.visible,
    pedestalVisible: window.game.dungeon.group.getObjectByName('smelterSealGrandPedestal')?.visible,
    cradleVisible: window.game.dungeon.group.getObjectByName('smelterSealEmptyCradle')?.visible,
    leftPanelVisible: window.game.dungeon.group.getObjectByName('smelterBulkheadPanelLeft')?.visible,
    rightPanelVisible: window.game.dungeon.group.getObjectByName('smelterBulkheadPanelRight')?.visible,
  }));
  expect(visibleState).toEqual({
    pickupVisible: false,
    pedestalVisible: true,
    cradleVisible: true,
    leftPanelVisible: true,
    rightPanelVisible: true,
  });
  const after = await readPublicV1JourneyState(page, { includeGeometry: false });
  expect(after.player.position.x).toBeLessThan(startPosition.x - 3);
  expect(runtimeErrors).toEqual([]);
  await page.evaluate(() => window.game.stop());
});

test('Assay Lab camera occlusion hides only wall panels lying between camera and player', async ({ page }) => {
  await page.goto(previewUrl('-occlusion'));
  await waitForPreview(page);

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const wallRecords = [...game.cameraOcclusionProximityRecordByKey.values()]
      .filter((record) => record.entry?.object?.name?.startsWith('assayLabCameraWallBatch'));
    const target = wallRecords[Math.floor(wallRecords.length / 2)];
    if (!target) throw new Error('Assay Lab published no wall occlusion records.');

    const originalPlayerPosition = game.player.root.position.clone();
    const originalCameraPosition = game.camera.position.clone();
    const originalCameraQuaternion = game.camera.quaternion.clone();
    const center = target.bounds.min.clone().add(target.bounds.max).multiplyScalar(0.5);
    const size = target.bounds.max.clone().sub(target.bounds.min);
    const thinAxis = size.x < size.z ? 'x' : 'z';
    const rayHeight = Math.min(target.bounds.max.y - 0.5, target.bounds.min.y + 2.5);
    const targetKey = `${target.entry.object.uuid}:${target.instanceId}`;
    const hiddenKey = (hidden) => `${hidden.object.uuid}:${hidden.instanceId}`;
    const inspectHidden = () => ({
      targetHidden: game.cameraOcclusionHiddenInstances.some((hidden) => (
        hiddenKey(hidden) === targetKey
      )),
      hiddenPanelCount: game.cameraOcclusionHiddenInstances.length,
      hiddenNonWallCount: game.cameraOcclusionHiddenInstances.filter((hidden) => {
        const entry = game.cameraOcclusionEntries.find((candidate) => (
          candidate.object === hidden.object
        ));
        return entry?.object?.userData?.cameraOcclusionWall !== true;
      }).length + [...game.cameraOcclusionHiddenOwners].filter((owner) => (
        owner.userData?.cameraOcclusionWall !== true
      )).length,
    });

    game.camera.position.copy(center);
    game.player.root.position.copy(center);
    game.camera.position[thinAxis] -= 11.2;
    game.player.root.position[thinAxis] += 5.6;
    game.camera.position.y = rayHeight;
    game.player.root.position.y = rayHeight - 1.25;
    game.camera.lookAt(
      game.player.root.position.x,
      game.player.root.position.y + 1.25,
      game.player.root.position.z,
    );
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const acrossWall = inspectHidden();

    // Remain close to the same wall but keep camera and player on one side.
    // Proximity by itself must not make architecture disappear.
    game.camera.position.copy(center);
    game.player.root.position.copy(center);
    game.camera.position[thinAxis] -= 1.4;
    game.player.root.position[thinAxis] -= 5.6;
    game.camera.position.y = rayHeight;
    game.player.root.position.y = rayHeight - 1.25;
    game.camera.lookAt(
      game.player.root.position.x,
      game.player.root.position.y + 1.25,
      game.player.root.position.z,
    );
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const sameSide = inspectHidden();

    game.player.root.position.copy(originalPlayerPosition);
    game.camera.position.copy(originalCameraPosition);
    game.camera.quaternion.copy(originalCameraQuaternion);
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    return {
      wallRecordCount: wallRecords.length,
      acrossWall,
      sameSide,
    };
  });

  expect(result.wallRecordCount).toBeGreaterThan(10);
  expect(result.acrossWall.targetHidden).toBe(true);
  expect(result.acrossWall.hiddenPanelCount).toBeGreaterThan(0);
  expect(result.acrossWall.hiddenNonWallCount).toBe(0);
  expect(result.sameSide.targetHidden).toBe(false);
  expect(result.sameSide.hiddenNonWallCount).toBe(0);
});
