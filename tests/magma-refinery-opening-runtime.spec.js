import { expect, test } from '@playwright/test';

test('approved Magma opening loads tiled retained textures and remains playable', async ({ page }) => {
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

  await page.goto('/?startupWorld=dungeon&roomPreview=magma-breached-freight-adit&dungeonSeed=opening-runtime');
  await page.waitForFunction(() => document.getElementById('game-container')?.dataset.browserTestReady === 'true');

  const contract = await page.evaluate(() => {
    const game = window.game;
    const dungeon = window.game.dungeon;
    const meshes = [];
    dungeon.group.traverse((object) => {
      if (object.isMesh) meshes.push(object);
    });
    const boundaryEntry = game.cameraOcclusionEntries.find((entry) => (
      /^(?:north|south|east|west)-cavern-/.test(entry.object.name)
    ));
    const originalPlayerPosition = game.player.root.position.clone();
    const originalCameraPosition = game.camera.position.clone();
    const originalCameraQuaternion = game.camera.quaternion.clone();
    const boundaryCenter = boundaryEntry.bounds.min.clone()
      .add(boundaryEntry.bounds.max)
      .multiplyScalar(0.5);
    const boundarySize = boundaryEntry.bounds.max.clone().sub(boundaryEntry.bounds.min);
    const thinAlongX = boundarySize.x < boundarySize.z;
    game.player.root.position.copy(boundaryCenter);
    game.camera.position.copy(boundaryCenter);
    game.player.root.position.y = boundaryEntry.bounds.min.y;
    game.camera.position.y = game.player.root.position.y + 1.25;
    if (thinAlongX) {
      game.player.root.position.x -= 2;
      game.camera.position.x += 2;
    } else {
      game.player.root.position.z -= 2;
      game.camera.position.z += 2;
    }
    game.camera.lookAt(
      game.player.root.position.x,
      game.player.root.position.y + 1.25,
      game.player.root.position.z,
    );
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const boundaryWallOccluded = boundaryEntry.owner.visible === false;
    game.player.root.position.copy(game.camera.position);
    game.player.root.position.y = boundaryEntry.bounds.min.y;
    if (thinAlongX) game.player.root.position.x += 1;
    else game.player.root.position.z += 1;
    game.camera.lookAt(
      game.player.root.position.x,
      game.player.root.position.y + 1.25,
      game.player.root.position.z,
    );
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const boundaryWallRestored = boundaryEntry.owner.visible === true;

    game.camera.position.copy(boundaryCenter);
    game.camera.position.y = boundaryEntry.bounds.min.y + 1.25;
    game.player.root.position.copy(game.camera.position);
    game.player.root.position.y = boundaryEntry.bounds.min.y;
    if (thinAlongX) game.player.root.position.x -= 4;
    else game.player.root.position.z -= 4;
    game.camera.lookAt(
      game.player.root.position.x,
      game.player.root.position.y + 1.25,
      game.player.root.position.z,
    );
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const cameraInsideBoundaryOccluded = boundaryEntry.owner.visible === false;

    game.camera.position.copy(boundaryCenter);
    game.camera.position.y = boundaryEntry.bounds.min.y + 1.25;
    game.player.root.position.copy(game.camera.position);
    game.player.root.position.y = boundaryEntry.bounds.min.y;
    if (thinAlongX) {
      game.camera.position.x += 0.75;
      game.player.root.position.x += 0.75;
      game.player.root.position.z += 5;
    } else {
      game.camera.position.z += 0.75;
      game.player.root.position.z += 0.75;
      game.player.root.position.x += 5;
    }
    game.camera.lookAt(
      game.player.root.position.x,
      game.player.root.position.y + 1.25,
      game.player.root.position.z,
    );
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const cameraAdjacentBoundaryOccluded = boundaryEntry.owner.visible === false;

    const inferredWall = boundaryEntry.object.clone();
    inferredWall.name = 'runtimeUnflaggedProceduralPartitionWall';
    inferredWall.position.set(10000, 0, 10000);
    inferredWall.userData = { worldUvTiled: true, collisionBacked: true };
    dungeon.group.add(inferredWall);
    game._collectCameraOcclusionWalls();
    const inferredWallEntry = game.cameraOcclusionEntries.find((entry) => (
      entry.object === inferredWall
    ));
    const inferredWallRegistered = Boolean(inferredWallEntry)
      && inferredWall.userData.cameraOcclusionInferredSurface === true;
    dungeon.group.remove(inferredWall);
    game._collectCameraOcclusionWalls();

    game.player.root.position.copy(originalPlayerPosition);
    game.camera.position.copy(originalCameraPosition);
    game.camera.quaternion.copy(originalCameraQuaternion);
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const normalViewHiddenWalkablePanelCount = game.cameraOcclusionHiddenInstances.filter((hidden) => (
      game.cameraOcclusionEntries.find((entry) => entry.object === hidden.object)?.surfaceClass
        === 'walkable'
    )).length;
    const wallMeshes = meshes.filter((mesh) => (
      mesh.userData.cameraOcclusionWall === true
        || /(?:wall|backdrop|retaining|partition|bulkhead|barrier)/i.test(mesh.name)
        || /(?:wall|backdrop|retaining|partition|bulkhead|barrier)/i.test(
          mesh.userData.architectureRole ?? '',
        )
    ));
    return {
      roomModuleIds: dungeon.roomModuleIds,
      themePackId: dungeon.themePackId,
      developmentFixture: dungeon.developmentFixture,
      meshCount: meshes.length,
      tiledMeshCount: meshes.filter((mesh) => mesh.userData.worldUvTiled === true).length,
      materialTileContracts: [...dungeon.group.userData.authoredOwnedMaterials]
        .filter((material) => material.map)
        .map((material) => ({
          name: material.name,
          metersPerRepeat: material.userData.worldUvMetersPerRepeat,
          stretchedUvsAllowed: material.userData.stretchedUvsAllowed,
          wrapS: material.map.wrapS,
          wrapT: material.map.wrapT,
        })),
      rampRouteIds: [...new Set(dungeon.floorTiles
        .filter((tile) => tile.surfaceRole === 'ramp')
        .map((tile) => tile.rampRouteId))],
      rampLandings: dungeon.rampLandings,
      socketFrames: dungeon.socketFrames,
      socketFrameAlignment: dungeon.moduleManifestDiagnostics.socketFrameAlignment,
      sequenceSocketAlignment: dungeon.moduleManifestDiagnostics.sequenceSocketAlignment,
      connectionPlans: dungeon.connectionPlans,
      supportDiagnostics: dungeon.supportDiagnostics,
      freightPreviewCapCount: meshes.filter((mesh) => mesh.name === 'ancientFreightTunnelPreviewCap').length,
      duplicateEntryFrameCount: meshes.filter((mesh) => (
        mesh.name.startsWith('linear-excavation-entry-socket-frame')
      )).length,
      removedReceiverObjectCount: meshes.filter((mesh) => mesh.name.startsWith('ancientReceiver')).length,
      removedReceiverCollisionCount: dungeon.solidZones.filter((zone) => zone.id.startsWith('ancientReceiver')).length,
      basaltColumnCount: meshes.filter((mesh) => mesh.name.startsWith('cavern-infill-')).length,
      nonHexagonalBasaltColumnCount: meshes.filter((mesh) => (
        mesh.name.startsWith('cavern-infill-')
          && (mesh.geometry.type !== 'CylinderGeometry'
            || mesh.geometry.parameters.radialSegments !== 6)
      )).length,
      untexturedVoidCellCount: dungeon.moduleManifestDiagnostics.untexturedVoidCellCount,
      rockInfillCellCount: dungeon.moduleManifestDiagnostics.rockInfillCellCount,
      solidZoneCount: dungeon.solidZones.length,
      magmaTrapCount: dungeon.traps.filter((trap) => trap.label === 'Deep magma').length,
      interactiveMagmaTrapCount: dungeon.traps.filter((trap) => (
        trap.label === 'Deep magma' && trap.interactive !== false
      )).length,
      jumpGap: dungeon.moduleManifestDiagnostics.jumpAirGapMeters,
      maximumPlayerJump: dungeon.moduleManifestDiagnostics.maximumPlayerJumpMeters,
      playerStart: dungeon.playerStart.toArray(),
      boundaryWallOccluded,
      boundaryWallRestored,
      cameraInsideBoundaryOccluded,
      cameraAdjacentBoundaryOccluded,
      normalViewHiddenWalkablePanelCount,
      inferredWallRegistered,
      wallMeshCount: wallMeshes.length,
      unlabelledWallCount: wallMeshes.filter((mesh) => (
        mesh.userData.cameraOcclusionSurface !== true
          || mesh.userData.cameraOcclusionWall !== true
      )).length,
      exemptWallCount: wallMeshes.filter((mesh) => (
        mesh.userData.cameraOcclusionExcluded === true
          || mesh.userData.cameraOcclusionSurface === false
      )).length,
      boundaryWallOcclusionCoverage: meshes
        .filter((mesh) => /^(?:north|south|east|west)-cavern-/.test(mesh.name))
        .every((mesh) => game.cameraOcclusionEntries.some((entry) => entry.object === mesh)),
    };
  });

  expect(contract.roomModuleIds).toEqual([
    'magma-breached-freight-adit',
    'magma-linear-digger-excavation',
  ]);
  expect(contract.themePackId).toBe('magma-refinery-future');
  expect(contract.developmentFixture).toBe(true);
  expect(contract.meshCount).toBeGreaterThan(250);
  expect(contract.tiledMeshCount).toBe(contract.meshCount);
  expect(contract.materialTileContracts.length).toBeGreaterThanOrEqual(8);
  expect(contract.materialTileContracts.every((material) => (
    material.metersPerRepeat === 2.8
      && material.stretchedUvsAllowed === false
      && material.wrapS === 1000
      && material.wrapT === 1000
  ))).toBe(true);
  expect(contract.rampRouteIds).toEqual(expect.arrayContaining([
    'digger-catwalk-flight-1',
    'digger-catwalk-flight-2',
    'ancient-terrace-descent',
    'lava-west-ramp-out',
    'lava-east-ramp-out',
  ]));
  expect(contract.rampLandings).toHaveLength(14);
  expect(contract.rampLandings.every((landing) => (
    landing.widthTiles >= 3
      && landing.depthTiles >= 3
      && landing.clearWidthMeters >= 8.4
      && landing.clearDepthMeters >= 8.4
  ))).toBe(true);
  expect(contract.untexturedVoidCellCount).toBe(0);
  expect(contract.rockInfillCellCount).toBeGreaterThan(0);
  expect(contract.socketFrames).toEqual(expect.arrayContaining([expect.objectContaining({
    socketId: 'opening-deeper-socket',
    x: 9,
    z: -12,
    openingWidthMeters: 8.4,
    openingHeightMeters: 5.6,
  })]));
  expect(contract.socketFrames).toHaveLength(2);
  expect(contract.socketFrameAlignment).toEqual(expect.objectContaining({
    accepted: true,
    centerOffsetMeters: 0,
    widthOffsetMeters: 0,
    heightOffsetMeters: 0,
  }));
  expect(contract.sequenceSocketAlignment).toEqual(expect.objectContaining({
    accepted: true,
    player: expect.objectContaining({ centerOffsetMeters: 0, facingDot: -1, accepted: true }),
    lava: expect.objectContaining({ centerOffsetMeters: 0, facingDot: -1, accepted: true }),
  }));
  expect(contract.connectionPlans).toEqual([expect.objectContaining({
    connectorId: 'opening-to-linear-excavation',
    clearWidthMeters: 8.4,
    elevationDelta: 0,
  })]);
  expect(contract.freightPreviewCapCount).toBe(0);
  expect(contract.duplicateEntryFrameCount).toBe(0);
  expect(contract.supportDiagnostics).toEqual(expect.objectContaining({
    supportDatumViolationCount: 0,
    unresolvedElevatedFootprintCount: 0,
  }));
  expect(contract.supportDiagnostics.structuralSupportCount).toBeGreaterThan(20);
  expect(contract.supportDiagnostics.structuralFoundationCount).toBeGreaterThan(40);
  expect(contract.supportDiagnostics.undercroftFloorCount).toBeGreaterThan(40);
  expect(contract.removedReceiverObjectCount).toBe(0);
  expect(contract.removedReceiverCollisionCount).toBe(0);
  expect(contract.basaltColumnCount).toBeGreaterThan(0);
  expect(contract.nonHexagonalBasaltColumnCount).toBe(0);
  expect(contract.solidZoneCount).toBeGreaterThan(70);
  expect(contract.magmaTrapCount).toBeGreaterThan(20);
  expect(contract.interactiveMagmaTrapCount).toBe(0);
  expect(contract.jumpGap).toBeLessThan(contract.maximumPlayerJump);
  expect(contract.playerStart).toEqual([0, 0, 22.4]);
  expect(contract.boundaryWallOccluded).toBe(true);
  expect(contract.boundaryWallRestored).toBe(true);
  expect(contract.cameraInsideBoundaryOccluded).toBe(true);
  expect(contract.cameraAdjacentBoundaryOccluded).toBe(false);
  expect(contract.normalViewHiddenWalkablePanelCount).toBe(0);
  expect(contract.inferredWallRegistered).toBe(true);
  expect(contract.wallMeshCount).toBeGreaterThan(100);
  expect(contract.unlabelledWallCount).toBe(0);
  expect(contract.exemptWallCount).toBe(0);
  expect(contract.boundaryWallOcclusionCoverage).toBe(true);

  const canvas = page.locator('canvas');
  await expect(canvas).toHaveCount(1);
  await canvas.click({ position: { x: 620, y: 380 } });
  const start = await page.evaluate(() => window.game.player.root.position.toArray());
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  await page.keyboard.press('Space');
  await page.waitForTimeout(1100);
  const movement = await page.evaluate(() => ({
    position: window.game.player.root.position.toArray(),
    health: window.game.player.health,
    roomId: window.game.dungeonController._getRoomAtPosition(window.game.player.root.position)?.id ?? null,
  }));
  expect(movement.position[2]).toBeLessThan(start[2] - 0.5);
  expect(movement.position.every(Number.isFinite)).toBe(true);
  expect(movement.health).toBeGreaterThan(0);
  expect(movement.roomId).toBe('magma-breached-freight-adit');

  expect(textureRequests.length).toBeGreaterThanOrEqual(32);
  expect(textureRequests.every(({ status }) => status === 200)).toBe(true);
  expect(retiredRoomAssetRequests).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  await page.evaluate(() => window.game.stop());
});

test('only cavern wall panels crossing the camera-to-player silhouette clear', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&roomPreview=magma-breached-freight-adit&dungeonSeed=opening-runtime');
  await page.waitForFunction(() => document.getElementById('game-container')?.dataset.browserTestReady === 'true');

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const originalPlayerPosition = game.player.root.position.clone();
    const originalCameraPosition = game.camera.position.clone();
    const originalCameraQuaternion = game.camera.quaternion.clone();
    const infillEntries = game.cameraOcclusionEntries.filter((entry) => (
      entry.object.userData?.architectureRole === 'cavern wall infill'
    ));
    const rows = new Map();
    for (const entry of infillEntries) {
      const center = entry.bounds.getCenter(entry.object.position.clone());
      const key = center.x.toFixed(2);
      const rowEntries = rows.get(key) ?? [];
      rowEntries.push({ entry, center });
      rows.set(key, rowEntries);
    }
    const row = [...rows.values()].sort((left, right) => right.length - left.length)[0];
    row.sort((left, right) => left.center.z - right.center.z);
    const rowX = row[0].center.x;
    const rowZ = row[Math.floor(row.length / 2)].center.z;

    game.player.root.position.set(rowX + 5.6, 0, rowZ);
    game.camera.position.set(rowX - 16.8, 3, rowZ);
    game.camera.lookAt(
      game.player.root.position.x,
      game.player.root.position.y + 1.25,
      game.player.root.position.z,
    );
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();

    const visibleFieldEntries = row.filter(({ center }) => {
      const projected = center.clone().project(game.camera);
      return projected.z >= -1 && projected.z <= 1
        && projected.x >= -1 && projected.x <= 1
        && projected.y >= -1 && projected.y <= 1;
    });
    const hiddenFieldPanelCount = visibleFieldEntries.filter(({ entry }) => (
      entry.owner.visible === false
    )).length;
    const hiddenWalkablePanelCount = game.cameraOcclusionHiddenInstances.filter((hidden) => (
      game.cameraOcclusionEntries.find((entry) => entry.object === hidden.object)?.surfaceClass
        === 'walkable'
    )).length;

    game.player.root.position.copy(originalPlayerPosition);
    game.camera.position.copy(originalCameraPosition);
    game.camera.quaternion.copy(originalCameraQuaternion);
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    return {
      visibleFieldPanelCount: visibleFieldEntries.length,
      hiddenFieldPanelCount,
      hiddenWalkablePanelCount,
    };
  });

  expect(result.visibleFieldPanelCount).toBeGreaterThan(5);
  expect(result.hiddenFieldPanelCount).toBeGreaterThan(0);
  expect(result.hiddenFieldPanelCount).toBeLessThan(result.visibleFieldPanelCount);
  expect(result.hiddenWalkablePanelCount).toBe(0);
});

test('combined-map Linear Digger uses transformed bounds and clears only sightline walls', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&roomPreview=magma-breached-freight-adit&dungeonSeed=combined-wall-occlusion');
  await page.waitForFunction(() => document.getElementById('game-container')?.dataset.browserTestReady === 'true');

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const linearGroup = game.dungeon.group.getObjectByName('magmaLinearDiggerExcavationRoom');
    const linearObjects = new Set();
    linearGroup.traverse((object) => linearObjects.add(object));
    const records = [...game.cameraOcclusionProximityRecordByKey.values()].filter((record) => (
      record.entry.wallSurface
        && Number.isInteger(record.instanceId)
        && linearObjects.has(record.entry.object)
    ));

    let maximumWorldBoundsError = 0;
    for (const record of records) {
      const object = record.entry.object;
      object.geometry.computeBoundingBox();
      const instanceMatrix = object.matrixWorld.clone();
      object.getMatrixAt(record.instanceId, instanceMatrix);
      const worldMatrix = object.matrixWorld.clone().multiply(instanceMatrix);
      const expected = object.geometry.boundingBox.clone().applyMatrix4(worldMatrix);
      maximumWorldBoundsError = Math.max(
        maximumWorldBoundsError,
        Math.abs(expected.min.x - record.bounds.min.x),
        Math.abs(expected.min.y - record.bounds.min.y),
        Math.abs(expected.min.z - record.bounds.min.z),
        Math.abs(expected.max.x - record.bounds.max.x),
        Math.abs(expected.max.y - record.bounds.max.y),
        Math.abs(expected.max.z - record.bounds.max.z),
      );
    }

    const planes = new Map();
    for (const record of records) {
      const size = record.bounds.getSize(game.player.root.position.clone());
      const center = record.bounds.getCenter(game.player.root.position.clone());
      const thinAxis = size.x < size.z ? 'x' : 'z';
      const key = `${record.entry.object.uuid}:${thinAxis}:${center[thinAxis].toFixed(2)}`;
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
    const cameraSide = target.center.clone();
    const playerSide = target.center.clone();
    cameraSide[plane.thinAxis] -= 16.8;
    playerSide[plane.thinAxis] += 5.6;
    cameraSide.y = target.record.bounds.min.y + 3;
    playerSide.y = target.record.bounds.min.y;
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
      roomModuleIds: game.dungeon.roomModuleIds,
      linearGroupPosition: linearGroup.position.toArray(),
      linearGroupScale: linearGroup.scale.toArray(),
      wallRecordCount: records.length,
      maximumWorldBoundsError,
      visibleFieldPanelCount: visibleFieldRecords.length,
      hiddenFieldPanelCount: visibleFieldRecords.filter(({ record }) => (
        hiddenKeys.has(record.key)
      )).length,
    };
  });

  expect(result.roomModuleIds).toEqual([
    'magma-breached-freight-adit',
    'magma-linear-digger-excavation',
  ]);
  expect(result.linearGroupPosition[0]).toBeCloseTo(25.2, 6);
  expect(result.linearGroupPosition[1]).toBeCloseTo(0, 6);
  expect(result.linearGroupPosition[2]).toBeCloseTo(-81.2, 6);
  expect(result.linearGroupScale).toEqual([-1, 1, 1]);
  expect(result.wallRecordCount).toBeGreaterThan(500);
  expect(result.maximumWorldBoundsError).toBeLessThanOrEqual(0.001);
  expect(result.visibleFieldPanelCount).toBeGreaterThan(5);
  expect(result.hiddenFieldPanelCount).toBeGreaterThan(0);
  expect(result.hiddenFieldPanelCount).toBeLessThan(result.visibleFieldPanelCount);
});

test('thick opening floor supports never participate in wall invisibility', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&roomPreview=magma-breached-freight-adit&dungeonSeed=opening-runtime');
  await page.waitForFunction(() => document.getElementById('game-container')?.dataset.browserTestReady === 'true');

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const supportEntries = game.cameraOcclusionEntries.filter((entry) => (
      entry.object.name.startsWith('magmaOpeningFloor_')
        && entry.surfaceClass === 'walkable'
        && entry.bounds.max.y - entry.bounds.min.y > 2.5
        && Math.abs(entry.bounds.max.y) < 0.05
    ));
    const rows = new Map();
    for (const entry of supportEntries) {
      const center = entry.bounds.getCenter(entry.object.position.clone());
      const key = center.z.toFixed(2);
      const row = rows.get(key) ?? [];
      row.push({ entry, center });
      rows.set(key, row);
    }
    const row = [...rows.values()].sort((left, right) => right.length - left.length)[0];
    row.sort((left, right) => left.center.x - right.center.x);
    const rowX = row[Math.floor(row.length / 2)].center.x;
    const rowZ = row[0].center.z;

    game.camera.position.set(rowX, -1.2, rowZ + 16.8);
    game.player.root.position.set(rowX, -2.8, rowZ - 16.8);
    game.camera.lookAt(rowX, -1.55, rowZ - 16.8);
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();

    const visibleField = row.filter(({ center }) => {
      const projected = center.clone().project(game.camera);
      return projected.z >= -1 && projected.z <= 1
        && projected.x >= -1 && projected.x <= 1
        && projected.y >= -1 && projected.y <= 1;
    });
    const interveningField = visibleField.filter(({ entry, center }) => (
      Math.abs(center.x - rowX)
        - (entry.bounds.max.x - entry.bounds.min.x) * 0.5 <= 5.6
    ));
    const obstructingFaceVisibleCount = interveningField.filter(({ entry }) => (
      entry.owner.visible !== false
    )).length;

    game.camera.position.set(rowX, 3, rowZ + 16.8);
    game.player.root.position.set(rowX, 0, rowZ - 16.8);
    game.camera.lookAt(rowX, 1.25, rowZ - 16.8);
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const lowerFloorHiddenCount = visibleField.filter(({ entry }) => (
      entry.owner.visible === false
    )).length;

    return {
      supportEntryCount: supportEntries.length,
      unlabelledSupportMassCount: supportEntries.filter(({ object }) => (
        object.userData.cameraOcclusionSurface !== true
          || object.userData.cameraOcclusionOwner !== true
          || object.userData.cameraOcclusionSupportedFloorMass !== true
      )).length,
      visibleFieldCount: visibleField.length,
      interveningFieldCount: interveningField.length,
      obstructingFaceVisibleCount,
      lowerFloorHiddenCount,
    };
  });

  expect(result.supportEntryCount).toBeGreaterThan(10);
  expect(result.unlabelledSupportMassCount).toBe(0);
  expect(result.visibleFieldCount).toBeGreaterThan(3);
  expect(result.interveningFieldCount).toBeGreaterThan(3);
  expect(result.obstructingFaceVisibleCount).toBe(result.interveningFieldCount);
  expect(result.lowerFloorHiddenCount).toBe(0);
});

test('opening freight socket publicly continues into the Linear Digger Excavation', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  await page.goto(
    '/?startupWorld=dungeon&roomPreview=magma-breached-freight-adit'
      + '&roomPreviewAnchor=excavationThreshold&dungeonSeed=combined-threshold-runtime',
  );
  await page.waitForFunction(() => (
    document.getElementById('game-container')?.dataset.browserTestReady === 'true'
  ));
  await page.waitForTimeout(1500);
  await page.locator('canvas').click({ position: { x: 640, y: 360 } });
  const readPlayer = () => page.evaluate(() => (
    window.game.getPublicDungeonJourneyDiagnostics({ includeGeometry: false }).player.position
  ));
  const start = await readPlayer();

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(7000);
  await page.keyboard.up('KeyW');
  const insideExcavation = await readPlayer();
  expect(insideExcavation.z).toBeLessThan(start.z - 3);
  expect(insideExcavation.y).toBeCloseTo(0, 2);
  expect(runtimeErrors).toEqual([]);
  await page.evaluate(() => window.game.stop());
});

test('combined excavation contains no encompassing shell or shell collision', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  await page.goto(
    '/?startupWorld=dungeon&roomPreview=magma-breached-freight-adit'
      + '&roomPreviewAnchor=shellBoundaryCrossing&dungeonSeed=combined-shell-runtime',
  );
  await page.waitForFunction(() => (
    document.getElementById('game-container')?.dataset.browserTestReady === 'true'
  ));
  await page.waitForTimeout(1500);
  const shellRetirement = await page.evaluate(() => {
    const dungeon = window.game.dungeon;
    const shellObjects = [];
    dungeon.group.traverse((object) => {
      if (/CavernBackdrop|cavernBackdrop/i.test(object.name)
        || object.userData?.exteriorBackdrop === true) {
        shellObjects.push(object.name);
      }
    });
    return {
      shellObjects,
      shellCollisionCount: [
        ...dungeon.solidZones,
        ...dungeon.aerialBoundaryZones,
      ].filter((zone) => (
        /cavernBackdrop/i.test(zone.id)
          || /cavernBackdrop/i.test(zone.obstacleKind)
      )).length,
    };
  });
  expect(shellRetirement.shellObjects).toEqual([]);
  expect(shellRetirement.shellCollisionCount).toBe(0);
  await page.locator('canvas').click({ position: { x: 640, y: 360 } });
  const readPlayer = () => page.evaluate(() => (
    window.game.getPublicDungeonJourneyDiagnostics({ includeGeometry: false }).player.position
  ));
  const start = await readPlayer();

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(5000);
  await page.keyboard.up('KeyW');
  const beyondFormerWall = await readPlayer();
  expect(beyondFormerWall.z).toBeLessThan(start.z - 2.5);
  expect(beyondFormerWall.y).toBeCloseTo(0, 2);
  expect(runtimeErrors).toEqual([]);
  await page.evaluate(() => window.game.stop());
});
