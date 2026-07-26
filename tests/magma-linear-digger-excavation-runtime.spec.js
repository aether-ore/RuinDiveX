import { expect, test } from '@playwright/test';

test('Linear Digger Excavation preview loads, advances frames, and remains physically playable', async ({ page }) => {
  const runtimeErrors = [];
  const textureRequests = [];
  const retiredRoomAssetRequests = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  page.on('response', (response) => {
    const url = response.url();
    if (/assets\/textures\/magma-refinery\//i.test(url)) {
      textureRequests.push({ url, status: response.status() });
    }
    if (/assets\/models\/magma-refinery\/(rooms|connectors)\//i.test(url)) {
      retiredRoomAssetRequests.push(url);
    }
  });

  await page.goto('/?startupWorld=dungeon&roomPreview=magma-linear-digger-excavation&dungeonSeed=linear-runtime');
  await page.waitForFunction(() => document.getElementById('game-container')?.dataset.browserTestReady === 'true');

  const contract = await page.evaluate(() => {
    const game = window.game;
    const dungeon = game.dungeon;
    const meshes = [];
    const owners = [];
    dungeon.group.traverse((object) => {
      if (object.isMesh) meshes.push(object);
      if (object.userData?.cameraOcclusionOwner === true) owners.push(object);
    });
    const wallMeshes = meshes.filter((mesh) => (
      mesh.userData.cameraOcclusionWall === true
        || /(?:wall|backdrop|retaining|partition|bulkhead|barrier)/i.test(mesh.name)
        || /(?:wall|backdrop|retaining|partition|bulkhead|barrier)/i.test(
          mesh.userData.architectureRole ?? '',
        )
    ));
    const instancedWallEntry = game.cameraOcclusionEntries.find((entry) => (
      entry.object.name.startsWith('excavationWallBatch')
    ));
    const proximityRecords = [...new Map(
      [...game.cameraOcclusionWallProximityBins.values()]
        .flat()
        .map((record) => [record.key, record]),
    ).values()];
    const instancedWallRecords = proximityRecords.filter((record) => (
      record.entry === instancedWallEntry
    ));
    const neighborhoodSize = (record) => {
      const center = record.bounds.min.clone().add(record.bounds.max).multiplyScalar(0.5);
      return instancedWallRecords.filter((candidate) => (
        candidate.bounds.distanceToPoint(center) <= 3.4
      )).length;
    };
    const instancedWallRecord = instancedWallRecords.reduce((best, record) => (
      !best || neighborhoodSize(record) > neighborhoodSize(best) ? record : best
    ), null);
    const floorEntry = game.cameraOcclusionEntries.find((entry) => (
      entry.object.name === 'linearExcavationBoredBasaltFloors'
    ));
    const floorRecord = proximityRecords.find((record) => record.entry === floorEntry);
    const originalPlayerPosition = game.player.root.position.clone();
    const originalCameraPosition = game.camera.position.clone();
    const originalCameraQuaternion = game.camera.quaternion.clone();
    const wallCenter = instancedWallRecord.bounds.min.clone()
      .add(instancedWallRecord.bounds.max)
      .multiplyScalar(0.5);
    game.camera.position.copy(wallCenter);
    game.player.root.position.copy(wallCenter).add({ x: 0, y: -1.25, z: 4 });
    game.camera.lookAt(
      game.player.root.position.x,
      game.player.root.position.y + 1.25,
      game.player.root.position.z,
    );
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const cameraInsideInstancedWallOccluded = game.cameraOcclusionHiddenInstances.some((entry) => (
      entry.object === instancedWallEntry.object
        && entry.instanceId === instancedWallRecord.instanceId
    ));
    const cameraWallNeighborhoodPanelCount = game.cameraOcclusionHiddenInstances.filter((entry) => (
      entry.object === instancedWallEntry.object
    )).length;
    const wallSize = instancedWallRecord.bounds.max.clone().sub(instancedWallRecord.bounds.min);
    const thinWallAxis = wallSize.x < wallSize.z ? 'x' : 'z';
    game.camera.position.copy(wallCenter);
    game.player.root.position.copy(wallCenter);
    game.camera.position[thinWallAxis] += 8;
    game.player.root.position[thinWallAxis] -= 4;
    game.player.root.position.y -= 1.25;
    game.camera.lookAt(
      game.player.root.position.x,
      game.player.root.position.y + 1.25,
      game.player.root.position.z,
    );
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const externalCameraWallCutoutPanelCount = game.cameraOcclusionHiddenInstances.filter((entry) => (
      entry.object === instancedWallEntry.object
    )).length;
    const externalCameraArchitectureCutoutCount = game.cameraOcclusionHiddenInstances.length
      + game.cameraOcclusionHiddenOwners.size;
    const wallLongAxis = thinWallAxis === 'x' ? 'z' : 'x';
    game.camera.position.copy(wallCenter);
    game.camera.position[thinWallAxis] += 8;
    game.player.root.position.copy(wallCenter);
    game.player.root.position[thinWallAxis] -= 4;
    game.player.root.position[wallLongAxis] += 12;
    game.player.root.position.y -= 1.25;
    game.camera.lookAt(wallCenter);
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const offAxisForwardWallOccluded = game.cameraOcclusionHiddenInstances.some((entry) => (
      entry.object === instancedWallEntry.object
        && entry.instanceId === instancedWallRecord.instanceId
    ));
    const offAxisForwardCutoutPanelCount = game.cameraOcclusionHiddenInstances.filter((entry) => (
      entry.object === instancedWallEntry.object
    )).length;
    const offAxisForwardFloorPanelCount = game.cameraOcclusionHiddenInstances.filter((entry) => (
      entry.object === floorEntry.object
    )).length;
    const floorCenter = floorRecord.bounds.min.clone().add(floorRecord.bounds.max).multiplyScalar(0.5);
    game.camera.position.copy(floorCenter);
    game.player.root.position.copy(floorCenter).add({ x: 0, y: 0.19, z: 4 });
    game.camera.lookAt(
      game.player.root.position.x,
      game.player.root.position.y + 1.25,
      game.player.root.position.z,
    );
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const cameraInsideFloorMassOccluded = game.cameraOcclusionHiddenInstances.some((entry) => (
      entry.object === floorEntry.object && entry.instanceId === floorRecord.instanceId
    ));
    game.camera.position.copy(floorCenter).add({ x: 0, y: -2.5, z: 0 });
    game.player.root.position.copy(floorCenter).add({ x: 0, y: 2.5, z: 0 });
    game.camera.lookAt(
      game.player.root.position.x,
      game.player.root.position.y + 1.25,
      game.player.root.position.z,
    );
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const architectureHitCutoutPanelCount = game.cameraOcclusionHiddenInstances.filter((entry) => (
      entry.object === floorEntry.object
    )).length;
    game.player.root.position.copy(originalPlayerPosition);
    game.camera.position.copy(originalCameraPosition);
    game.camera.quaternion.copy(originalCameraQuaternion);
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const publicState = window.game.getPublicDungeonJourneyDiagnostics({ includeGeometry: false });
    return {
      roomModuleIds: dungeon.roomModuleIds,
      dungeonFamilyId: dungeon.dungeonFamilyId,
      dungeonKind: dungeon.dungeonKind,
      developmentFixture: dungeon.developmentFixture,
      playerStart: dungeon.playerStart.toArray(),
      meshCount: meshes.length,
      tiledMeshCount: meshes.filter((mesh) => mesh.userData.worldUvTiled === true).length,
      instancedMeshCount: meshes.filter((mesh) => mesh.isInstancedMesh).length,
      perInstanceOccluderCount: meshes.filter((mesh) => (
        mesh.userData.cameraOcclusionPerInstance === true
      )).length,
      occlusionOwnerCount: owners.length,
      oversizedOcclusionOwnerCount: owners.filter((owner) => owner.userData.maximumBaySpan > 3).length,
      retiredShellMeshCount: meshes.filter((mesh) => (
        /CavernBackdrop|cavernBackdrop/i.test(mesh.name)
          || mesh.userData.exteriorBackdrop === true
      )).length,
      retiredShellCollisionCount: [
        ...dungeon.solidZones,
        ...dungeon.aerialBoundaryZones,
      ].filter((zone) => (
        /cavernBackdrop/i.test(zone.id)
          || /cavernBackdrop/i.test(zone.obstacleKind)
      )).length,
      wallMeshCount: wallMeshes.length,
      unlabelledWallCount: wallMeshes.filter((mesh) => (
        mesh.userData.cameraOcclusionSurface !== true
          || mesh.userData.cameraOcclusionWall !== true
      )).length,
      exemptWallCount: wallMeshes.filter((mesh) => (
        mesh.userData.cameraOcclusionExcluded === true
          || mesh.userData.cameraOcclusionSurface === false
      )).length,
      cameraInsideInstancedWallOccluded,
      cameraWallNeighborhoodPanelCount,
      externalCameraWallCutoutPanelCount,
      externalCameraArchitectureCutoutCount,
      offAxisForwardWallOccluded,
      offAxisForwardCutoutPanelCount,
      offAxisForwardFloorPanelCount,
      cameraInsideFloorMassOccluded,
      architectureHitCutoutPanelCount,
      solidZoneCount: dungeon.solidZones.length,
      aerialBoundaryZoneCount: dungeon.aerialBoundaryZones.length,
      trapCount: dungeon.traps.length,
      encounterCount: dungeon.encounters.length,
      rampFlights: dungeon.verticalConnectors,
      rampLandings: dungeon.rampLandings,
      diagnostics: dungeon.moduleManifestDiagnostics,
      oldDrillChest: publicState.chests.find((chest) => (
        chest.id === 'magma-linear-excavation-old-drill-chest'
      )),
    };
  });

  expect(contract.roomModuleIds).toEqual(['magma-linear-digger-excavation']);
  expect(contract.dungeonFamilyId).toBe('industrial-v1');
  expect(contract.dungeonKind).toBe('magmaLinearDiggerExcavationDevelopmentFixture');
  expect(contract.developmentFixture).toBe(true);
  expect(contract.playerStart).toEqual([0, 0, 42]);
  expect(contract.meshCount).toBeGreaterThan(120);
  expect(contract.meshCount).toBeLessThan(170);
  expect(contract.tiledMeshCount).toBe(contract.meshCount);
  expect(contract.instancedMeshCount).toBeGreaterThan(25);
  expect(contract.perInstanceOccluderCount).toBeGreaterThan(15);
  expect(contract.occlusionOwnerCount).toBeGreaterThan(8);
  expect(contract.oversizedOcclusionOwnerCount).toBe(0);
  expect(contract.retiredShellMeshCount).toBe(0);
  expect(contract.retiredShellCollisionCount).toBe(0);
  expect(contract.wallMeshCount).toBeGreaterThan(5);
  expect(contract.unlabelledWallCount).toBe(0);
  expect(contract.exemptWallCount).toBe(0);
  expect(contract.cameraInsideInstancedWallOccluded).toBe(true);
  expect(contract.cameraWallNeighborhoodPanelCount).toBeGreaterThan(0);
  expect(contract.cameraWallNeighborhoodPanelCount).toBeLessThanOrEqual(4);
  expect(contract.externalCameraWallCutoutPanelCount).toBeGreaterThan(0);
  expect(contract.externalCameraWallCutoutPanelCount).toBeLessThanOrEqual(4);
  expect(contract.externalCameraArchitectureCutoutCount).toBeGreaterThan(0);
  expect(contract.externalCameraArchitectureCutoutCount).toBeLessThanOrEqual(4);
  expect(contract.offAxisForwardWallOccluded).toBe(false);
  expect(contract.offAxisForwardCutoutPanelCount).toBeLessThan(3);
  expect(contract.offAxisForwardFloorPanelCount).toBe(0);
  expect(contract.cameraInsideFloorMassOccluded).toBe(false);
  expect(contract.architectureHitCutoutPanelCount).toBe(0);
  expect(contract.solidZoneCount).toBeGreaterThan(300);
  expect(contract.aerialBoundaryZoneCount).toBeGreaterThan(400);
  expect(contract.trapCount).toBe(82);
  expect(contract.encounterCount).toBe(2);
  expect(contract.rampFlights).toEqual([
    expect.objectContaining({ sourceElevation: 0, destinationElevation: -7, segmentCount: 13, widthTiles: 3 }),
    expect.objectContaining({ sourceElevation: -7, destinationElevation: -14, segmentCount: 13, widthTiles: 3 }),
  ]);
  expect(contract.rampLandings).toHaveLength(4);
  expect(contract.rampLandings.every((landing) => (
    landing.widthTiles === 3 && landing.depthTiles === 3 && landing.propFree === true
  ))).toBe(true);
  expect(contract.diagnostics).toEqual(expect.objectContaining({
    accepted: true,
    safeRequiredRoute: true,
    criticalPathEncounterLocked: false,
    entryElevation: 0,
    exitElevation: -14,
    totalDescentMeters: 14,
    minimumTunnelWidthTiles: 3,
    minimumTunnelHeadroomMeters: 8.4,
    minimumChamberHeadroomMeters: 11.2,
    stackedWalkableColumnCount: 0,
    untexturedVoidCellCount: 0,
    exteriorVoidVisible: false,
  }));
  expect(contract.oldDrillChest).toEqual(expect.objectContaining({
    rewardPartId: 'oldDrill',
    rewardPersistenceKey: 'oldDrillClaimed',
    opened: false,
  }));

  // Browser-test readiness precedes asynchronous model/texture compilation.
  // Sample steady-state traversal only after the first render warm-up settles.
  await page.waitForTimeout(1800);
  const frameSample = await page.evaluate(async () => {
    let frames = 0;
    const started = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        frames += 1;
        if (performance.now() - started >= 900) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { frames, elapsed: performance.now() - started };
  });
  // Headless Chromium throttles requestAnimationFrame under video capture;
  // require continued advancement rather than a desktop refresh-rate target.
  expect(frameSample.frames).toBeGreaterThan(2);
  expect(frameSample.elapsed).toBeLessThan(1800);

  const canvas = page.locator('canvas');
  await expect(canvas).toHaveCount(1);
  await canvas.click({ position: { x: 620, y: 380 } });
  const start = await page.evaluate(() => window.game.player.root.position.toArray());
  await page.keyboard.down('w');
  await page.waitForTimeout(1100);
  await page.keyboard.up('w');
  const movement = await page.evaluate(() => ({
    position: window.game.player.root.position.toArray(),
    health: window.game.player.health,
    publicState: window.game.getPublicDungeonJourneyDiagnostics({ includeGeometry: false }),
  }));
  expect(movement.position[2]).toBeLessThan(start[2] - 0.5);
  expect(movement.position.every(Number.isFinite)).toBe(true);
  expect(movement.health).toBeGreaterThan(0);
  expect(movement.publicState.player.position.y).toBeCloseTo(0, 2);

  expect(textureRequests.length).toBeGreaterThanOrEqual(36);
  expect(textureRequests.every(({ status }) => status === 200)).toBe(true);
  expect(retiredRoomAssetRequests).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  await page.evaluate(() => window.game.stop());
});

for (const ramp of [
  {
    routeId: 'digger-descent-flight-a',
    anchor: 'flightATop',
    bottomX: -17 * 2.8,
    bottomY: -7,
  },
  {
    routeId: 'digger-descent-flight-b',
    anchor: 'flightBTop',
    bottomX: -5 * 2.8,
    bottomY: -14,
  },
]) {
  test(`${ramp.routeId} descends from its upper landing to its lower landing`, async ({ page }) => {
    const runtimeErrors = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    await page.addInitScript(() => {
      window.__linearRampWalkabilityCollisions = [];
      window.addEventListener('ruindivex:player-walkability-collision', (event) => {
        window.__linearRampWalkabilityCollisions.push(structuredClone(event.detail));
      });
    });
    await page.goto(
      '/?startupWorld=dungeon&roomPreview=magma-linear-digger-excavation'
        + `&roomPreviewAnchor=${ramp.anchor}&roomPreviewFacing=west`
        + `&dungeonSeed=${ramp.routeId}-downhill-runtime`,
    );
    await page.waitForFunction(() => (
      document.getElementById('game-container')?.dataset.browserTestReady === 'true'
    ));
    await page.waitForTimeout(1200);
    await page.locator('canvas').click({ position: { x: 640, y: 360 } });
    await page.evaluate(() => {
      window.__linearRampWalkabilityCollisions.length = 0;
    });
    const readPlayer = () => page.evaluate(() => (
      window.game.getPublicDungeonPlayerJourneyDiagnostics().player.position
    ));

    const deadline = Date.now() + 20_000;
    await page.keyboard.down('KeyW');
    try {
      while (Date.now() < deadline) {
        await page.waitForTimeout(120);
        const player = await readPlayer();
        if (player.x <= ramp.bottomX + 0.8 && player.y <= ramp.bottomY + 0.35) break;
      }
    } finally {
      await page.keyboard.up('KeyW');
    }

    const landing = await readPlayer();
    const collisions = await page.evaluate(() => window.__linearRampWalkabilityCollisions);
    expect(landing.x).toBeLessThanOrEqual(ramp.bottomX + 0.8);
    expect(landing.y).toBeCloseTo(ramp.bottomY, 1);
    expect(collisions).toEqual([]);
    expect(runtimeErrors).toEqual([]);
    await page.evaluate(() => window.game.stop());
  });
}

test('only bored-wall panels crossing the camera-to-player silhouette clear', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&roomPreview=magma-linear-digger-excavation&dungeonSeed=linear-runtime');
  await page.waitForFunction(() => document.getElementById('game-container')?.dataset.browserTestReady === 'true');

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const records = [...new Map(
      [...game.cameraOcclusionWallProximityBins.values()]
        .flat()
        .filter((record) => record.entry.object.name.startsWith('excavationWallBatch'))
        .map((record) => [record.key, record]),
    ).values()];
    const planes = new Map();
    for (const record of records) {
      const size = record.bounds.getSize(game.player.root.position.clone());
      const center = record.bounds.getCenter(game.player.root.position.clone());
      const thinAxis = size.x < size.z ? 'x' : 'z';
      const planeCoordinate = center[thinAxis].toFixed(2);
      const key = `${record.entry.object.uuid}:${thinAxis}:${planeCoordinate}`;
      const plane = planes.get(key) ?? { thinAxis, records: [] };
      plane.records.push({ record, center });
      planes.set(key, plane);
    }
    const plane = [...planes.values()].sort((left, right) => (
      right.records.length - left.records.length
    ))[0];
    const longAxis = plane.thinAxis === 'x' ? 'z' : 'x';
    plane.records.sort((left, right) => left.center[longAxis] - right.center[longAxis]);
    const target = plane.records[Math.floor(plane.records.length / 2)];
    const floorY = target.record.bounds.min.y;
    const cameraSide = target.center.clone();
    const playerSide = target.center.clone();
    cameraSide[plane.thinAxis] -= 16.8;
    playerSide[plane.thinAxis] += 5.6;
    cameraSide.y = floorY + 3;
    playerSide.y = floorY;
    game.camera.position.copy(cameraSide);
    game.player.root.position.copy(playerSide);
    game.camera.lookAt(playerSide.x, playerSide.y + 1.25, playerSide.z);
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();

    const visibleFieldRecords = plane.records.filter(({ center }) => {
      const projected = center.clone().project(game.camera);
      return projected.z >= -1 && projected.z <= 1
        && projected.x >= -1 && projected.x <= 1
        && projected.y >= -1 && projected.y <= 1;
    });
    const hiddenKeys = new Set(game.cameraOcclusionHiddenInstances.map((hidden) => (
      `${hidden.object.uuid}:${hidden.instanceId}`
    )));
    return {
      visibleFieldPanelCount: visibleFieldRecords.length,
      hiddenFieldPanelCount: visibleFieldRecords.filter(({ record }) => (
        hiddenKeys.has(record.key)
      )).length,
      hiddenWalkablePanelCount: game.cameraOcclusionHiddenInstances.filter((hidden) => (
        game.cameraOcclusionEntries.find((entry) => entry.object === hidden.object)?.surfaceClass
          === 'walkable'
      )).length,
    };
  });

  expect(result.visibleFieldPanelCount).toBeGreaterThan(5);
  expect(result.hiddenFieldPanelCount).toBeGreaterThan(0);
  expect(result.hiddenFieldPanelCount).toBeLessThan(result.visibleFieldPanelCount);
  expect(result.hiddenWalkablePanelCount).toBe(0);
});
