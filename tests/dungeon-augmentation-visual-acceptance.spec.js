import { expect, test } from '@playwright/test';

const PROFILE_ID = 'industrial-supplement-preview-v4';
const PROFILE_REVISION = 5;
const SEEDS = [{
  id: '000',
  authored: 'augmentation-realized-v4-000',
}, {
  id: '001',
  authored: 'augmentation-realized-v4-001',
}];

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 720 } });

function captureRuntimeErrors(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  return { pageErrors, consoleErrors };
}

async function waitForDungeon(page, runtimeErrors, timeout = 240_000) {
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

async function waitForDungeonPresentationAssets(page, timeout = 30_000) {
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
      let pending = false;
      group.traverse((object) => {
        if (object.userData.modelLoading || object.userData.textureLoading) pending = true;
      });
      return modelSettled('rollCaskettNpc')
        && modelSettled('expeditionSupportCar')
        && workbenchSettled
        && !pending;
    }),
    { timeout },
  ).toBe(true);
  await page.evaluate(() => new Promise((resolve) => (
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  )));
}

async function installVisualAcceptanceHarness(page) {
  await page.evaluate(() => {
    const game = window.game;
    const dungeon = game?.dungeon;
    if (!game || !dungeon?.group || !game.camera || !game.renderer) {
      throw new Error('Dungeon visual-acceptance harness requires a live rendered dungeon.');
    }

    const Vector3 = game.camera.position.constructor;
    const isGraphOnlyConnection = (plan) => Boolean(
      plan?.isSupplementGraphConnection
      || plan?.graphOnly === true
      || plan?.connectorVariantConstraints?.graphOnly === true
    );
    const v4Plans = () => (dungeon.connectionPlans ?? []).filter((plan) => (
      plan?.isDungeonSupplement === true
      && plan?.augmentationOperationType === 'routeNetwork'
      && Boolean(plan?.routeNetworkGrantId)
      && !isGraphOnlyConnection(plan)
    ));
    const sortStrings = (values) => [...values].map(String).sort((left, right) => (
      left.localeCompare(right)
    ));
    const plainVector = (value) => ({
      x: Number(value?.x ?? 0),
      y: Number(value?.y ?? 0),
      z: Number(value?.z ?? 0),
    });
    const collect = (root, predicate) => {
      const matches = [];
      root?.traverse?.((object) => {
        if (predicate(object)) matches.push(object);
      });
      return matches;
    };
    const worldVisible = (object) => {
      for (let current = object; current; current = current.parent) {
        if (current.visible === false) return false;
      }
      return true;
    };
    const meshDrawCallCount = (mesh) => (
      Array.isArray(mesh.material) ? mesh.material.length : mesh.material ? 1 : 0
    );
    const meshSummary = (root) => {
      const meshes = collect(root, (object) => object.isMesh);
      return {
        meshNames: meshes.map(({ name }) => name).sort((left, right) => left.localeCompare(right)),
        meshCount: meshes.length,
        drawCallCount: meshes.reduce((count, mesh) => count + meshDrawCallCount(mesh), 0),
      };
    };
    const objectBounds = (root) => {
      game.scene.updateMatrixWorld(true);
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      let pointCount = 0;
      for (const mesh of collect(root, (object) => object.isMesh)) {
        mesh.geometry?.computeBoundingBox?.();
        const bounds = mesh.geometry?.boundingBox;
        if (!bounds) continue;
        for (const x of [bounds.min.x, bounds.max.x]) {
          for (const y of [bounds.min.y, bounds.max.y]) {
            for (const z of [bounds.min.z, bounds.max.z]) {
              const corner = new Vector3(x, y, z);
              mesh.localToWorld(corner);
              min.min(corner);
              max.max(corner);
              pointCount += 1;
            }
          }
        }
      }
      if (pointCount === 0) {
        const point = root.getWorldPosition(new Vector3());
        min.copy(point);
        max.copy(point);
      }
      return { min, max };
    };
    const projectBounds = ({ min, max }) => {
      const points = [];
      for (const x of [min.x, max.x]) {
        for (const y of [min.y, max.y]) {
          for (const z of [min.z, max.z]) {
            points.push(new Vector3(x, y, z).project(game.camera));
          }
        }
      }
      return {
        minX: Math.min(...points.map(({ x }) => x)),
        maxX: Math.max(...points.map(({ x }) => x)),
        minY: Math.min(...points.map(({ y }) => y)),
        maxY: Math.max(...points.map(({ y }) => y)),
        minZ: Math.min(...points.map(({ z }) => z)),
        maxZ: Math.max(...points.map(({ z }) => z)),
      };
    };
    const prepareScene = () => {
      game.stop();
      game.renderer.setAnimationLoop(null);
      if (game.player?.root) game.player.root.visible = false;
      for (const enemy of game.enemies ?? []) {
        if (enemy?.root) enemy.root.visible = false;
      }
      const uiRoot = document.getElementById('ui-root');
      if (uiRoot) uiRoot.style.display = 'none';
    };
    const renderFrame = ({ cameraPosition, target, playerPosition = target }) => {
      prepareScene();
      if (game.player?.root) game.player.root.position.copy(playerPosition);
      game.camera.fov = 52;
      game.camera.position.copy(cameraPosition);
      game.camera.lookAt(target);
      game.camera.updateProjectionMatrix();
      game.camera.updateMatrixWorld(true);
      game.scene.updateMatrixWorld(true);
      game._updateDungeonRenderCulling?.(0, { force: true });
      game._updateCameraWallOcclusion?.();
      game.scene.updateMatrixWorld(true);
      game.camera.updateMatrixWorld(true);
      game.renderer.render(game.scene, game.camera);
    };
    const projectionForMesh = (mesh) => {
      mesh.geometry?.computeBoundingBox?.();
      const center = mesh.geometry?.boundingBox
        ?.getCenter(new Vector3()) ?? new Vector3();
      mesh.localToWorld(center);
      const projected = center.clone().project(game.camera);
      return {
        name: mesh.name,
        x: projected.x,
        y: projected.y,
        z: projected.z,
        inView: Math.abs(projected.x) <= 1
          && Math.abs(projected.y) <= 1
          && projected.z >= -1
          && projected.z <= 1,
      };
    };
    const presentationRecords = () => (dungeon.rooms ?? [])
      .filter(({ isDungeonSupplement }) => isDungeonSupplement === true)
      .flatMap(({ augmentationPresentationRecords = [] }) => augmentationPresentationRecords)
      .filter(({ semanticRole }) => [
        'gameplay-cover',
        'machinery-landmark',
      ].includes(semanticRole));
    const supplementRoot = () => dungeon.dungeonSupplementRoot
      ?? dungeon.supplementRoot
      ?? dungeon.dungeonSupplement?.root
      ?? null;

    const inspect = () => {
      game.scene.updateMatrixWorld(true);
      const plans = v4Plans();
      const v4PlanIds = new Set(plans.map(({ id }) => String(id)));
      const expectedBoundaryIds = sortStrings(new Set(plans.flatMap((plan) => [
        plan.fromSocket?.attachmentSocketId,
        plan.toSocket?.attachmentSocketId,
      ]).filter(Boolean)));
      const boundaryRoots = collect(dungeon.group, (object) => (
        object.userData?.connectorBoundaryIndicator === true
      ));
      const boundaryIndicators = boundaryRoots.map((root) => {
        const summary = meshSummary(root);
        return {
          attachmentSocketId: String(root.userData.attachmentSocketId ?? ''),
          name: root.name,
          connectorId: String(root.userData.connectorId ?? ''),
          meshNames: summary.meshNames,
          meshCount: summary.meshCount,
          drawCallCount: summary.drawCallCount,
          recordedMeshCount: Number(root.userData.meshCount),
          recordedDrawCallCount: Number(root.userData.drawCallCount),
          drawCallUpperBound: Number(root.userData.drawCallUpperBound),
          nonBlockingPresentation: root.userData.nonBlockingPresentation === true,
          worldPosition: plainVector(root.getWorldPosition(new Vector3())),
        };
      }).sort((left, right) => left.attachmentSocketId.localeCompare(right.attachmentSocketId));
      const structuralFrameRealizations = plans.flatMap((plan) => (
        plan.structuralFrameRealizations ?? []
      )).filter(({ attachmentSocketId }) => Boolean(attachmentSocketId)).map((realization) => ({
        attachmentSocketId: String(realization.attachmentSocketId),
        rendererObjectId: String(realization.rendererObjectId ?? ''),
        required: realization.required === true,
        rendered: realization.rendered === true,
        renderedObjectId: String(realization.renderedObjectId ?? ''),
      })).sort((left, right) => left.attachmentSocketId.localeCompare(right.attachmentSocketId));
      const planArchBeats = plans.map((plan) => ({
        connectorId: String(plan.id),
        count: (plan.decorativeArchBeats ?? []).length,
      }));
      const sceneV4Arches = collect(dungeon.group, (object) => (
        object.userData?.connectorDecorativeArch === true
        && v4PlanIds.has(String(object.userData?.connectorId ?? ''))
      )).map((object) => ({
        name: object.name,
        connectorId: String(object.userData.connectorId),
        pathIndex: Number(object.userData.pathIndex),
      }));

      const records = presentationRecords().map((record) => ({
        id: String(record.id),
        sourceFeatureId: String(record.sourceFeatureId),
        sourceFeatureRuntimeId: String(record.sourceFeatureRuntimeId),
        semanticRole: record.semanticRole,
        assetRole: record.presentationAssetRole ?? record.themeRole ?? null,
        realizationOwner: record.realizationOwner,
        selectedForRendering: record.selectedForRendering === true,
        renderedBySupplementAssembler: record.renderedBySupplementAssembler === true,
        collisionRecordIds: sortStrings(record.collisionRecordIds ?? []),
        position: plainVector(record.transform?.position ?? record.position),
        width: Number(record.authoredFootprint?.widthMeters ?? record.widthMeters),
        height: Number(record.authoredFootprint?.heightMeters ?? record.heightMeters),
        depth: Number(record.authoredFootprint?.depthMeters ?? record.depthMeters),
      })).sort((left, right) => left.id.localeCompare(right.id));
      const recordIds = new Set(records.map(({ id }) => id));
      const realizations = (dungeon.dungeonSupplement?.presentationRealizations ?? [])
        .filter(({ presentationRecordId }) => recordIds.has(String(presentationRecordId)))
        .map((realization) => ({
          presentationRecordId: String(realization.presentationRecordId),
          sourceFeatureId: String(realization.sourceFeatureId),
          sourceFeatureRuntimeId: String(realization.sourceFeatureRuntimeId),
          semanticRole: realization.semanticRole,
          assetRole: realization.assetRole,
          realizationOwner: realization.realizationOwner,
          realizationDisposition: realization.realizationDisposition,
          renderedBySupplementAssembler: realization.renderedBySupplementAssembler === true,
          rendererObjectId: realization.rendererObjectId,
          rootObjectCount: Number(realization.rootObjectCount),
          meshCount: Number(realization.meshCount),
          drawCallCount: Number(realization.drawCallCount),
          collisionRecordIds: sortStrings(realization.collisionRecordIds ?? []),
          position: plainVector(realization.position),
          width: Number(realization.width),
          height: Number(realization.height),
          depth: Number(realization.depth),
        })).sort((left, right) => (
          left.presentationRecordId.localeCompare(right.presentationRecordId)
        ));
      const presentationRoots = collect(supplementRoot(), (object) => (
        recordIds.has(String(object.userData?.presentationRecordId ?? ''))
      )).map((root) => {
        const summary = meshSummary(root);
        return {
          presentationRecordId: String(root.userData.presentationRecordId),
          sourceFeatureId: String(root.userData.sourceFeatureId),
          sourceFeatureRuntimeId: String(root.userData.sourceFeatureRuntimeId),
          semanticRole: root.userData.presentationSemanticRole,
          assetRole: root.userData.presentationAssetRole,
          name: root.name,
          worldPosition: plainVector(root.getWorldPosition(new Vector3())),
          meshNames: summary.meshNames,
          meshCount: summary.meshCount,
          drawCallCount: summary.drawCallCount,
        };
      }).sort((left, right) => (
        left.presentationRecordId.localeCompare(right.presentationRecordId)
      ));
      const cargoMeshes = collect(dungeon.group, (object) => (
        object.isMesh
        && ['industrialCargoBody', 'industrialCargoStripe'].includes(object.name)
      )).map((mesh) => ({
        name: mesh.name,
        worldPosition: plainVector(mesh.getWorldPosition(new Vector3())),
      }));
      const internalDoorwayFrameRoots = collect(supplementRoot(), (object) => (
        object.userData?.dungeonSupplementAssetRole === 'frame'
      )).map((root) => ({
        name: root.name,
        nodeId: String(root.userData?.supplementNodeId ?? ''),
        meshNames: meshSummary(root).meshNames,
        worldPosition: plainVector(root.getWorldPosition(new Vector3())),
      }));

      return {
        gates: {
          status: dungeon.augmentationStatus ?? null,
          profileId: dungeon.augmentationIdentity?.profileId ?? null,
          profileRevision: Number(dungeon.augmentationOverlayPlan?.profileRevision ?? 0),
          progressionAccepted: dungeon.progression?.validation?.accepted === true,
          alphaMode: game.dungeonAugmentationPlayableAlphaMode === true,
          diagnostics: dungeon.augmentationDiagnostics ?? null,
        },
        boundary: {
          expectedBoundaryIds,
          indicators: boundaryIndicators,
          structuralFrameRealizations,
          planArchBeats,
          sceneV4Arches,
        },
        presentation: {
          records,
          realizations,
          roots: presentationRoots,
          cargoMeshes,
          internalDoorwayFrameRoots,
        },
      };
    };

    const stageBoundary = (attachmentSocketId) => {
      const roots = collect(dungeon.group, (object) => (
        object.userData?.connectorBoundaryIndicator === true
        && String(object.userData?.attachmentSocketId ?? '') === String(attachmentSocketId)
      ));
      if (roots.length !== 1) {
        throw new Error(`Expected one boundary root for ${attachmentSocketId}; received ${roots.length}.`);
      }
      const [root] = roots;
      game.scene.updateMatrixWorld(true);
      const floorPoint = root.getWorldPosition(new Vector3());
      const target = floorPoint.clone();
      target.y += 2.5;
      const quaternion = root.getWorldQuaternion(root.quaternion.clone());
      const serviceSide = new Vector3(0, 0, -1).applyQuaternion(quaternion).setY(0);
      if (serviceSide.lengthSq() < 0.5) serviceSide.set(0, 0, 1);
      serviceSide.normalize();
      const cameraPosition = target.clone().addScaledVector(serviceSide, 9.2);
      cameraPosition.y += 0.35;
      renderFrame({ cameraPosition, target, playerPosition: floorPoint });
      const projections = collect(root, (object) => object.isMesh).map(projectionForMesh);
      return {
        attachmentSocketId: String(attachmentSocketId),
        rootVisible: worldVisible(root),
        cameraPosition: plainVector(cameraPosition),
        target: plainVector(target),
        projections,
      };
    };

    const stageQuietCorridor = () => {
      game.scene.updateMatrixWorld(true);
      const tileSize = Number(dungeon.tileSize ?? 2.8);
      const boundaryPositions = collect(dungeon.group, (object) => (
        object.userData?.connectorBoundaryIndicator === true
      )).map((root) => root.getWorldPosition(new Vector3()));
      const candidates = [];
      for (const plan of v4Plans()) {
        const path = plan.bridgePath?.length ? plan.bridgePath : plan.fullPath ?? [];
        for (let pathIndex = 1; pathIndex < path.length - 1; pathIndex += 1) {
          const point = path[pathIndex];
          const previous = path[pathIndex - 1];
          const next = path[pathIndex + 1];
          const outgoing = {
            x: Math.sign(Number(next?.x) - Number(point?.x)),
            z: Math.sign(Number(next?.z) - Number(point?.z)),
          };
          if (Math.abs(outgoing.x) + Math.abs(outgoing.z) !== 1) continue;
          const incoming = {
            x: Math.sign(Number(point?.x) - Number(previous?.x)),
            z: Math.sign(Number(point?.z) - Number(previous?.z)),
          };
          const straight = incoming.x === outgoing.x && incoming.z === outgoing.z;
          const worldPoint = new Vector3(Number(point.x) * tileSize, 0, Number(point.z) * tileSize);
          const nearestBoundaryMeters = boundaryPositions.length > 0
            ? Math.min(...boundaryPositions.map((boundary) => Math.hypot(
              boundary.x - worldPoint.x,
              boundary.z - worldPoint.z,
            )))
            : Infinity;
          const section = (plan.galleryCrossSections ?? [])
            .flatMap((entry) => entry.sections ?? [])
            .find((entry) => Number(entry.pathIndex) === pathIndex) ?? null;
          const elevation = Number(
            section?.elevation
            ?? plan.fromSocket?.elevation
            ?? plan.toSocket?.elevation
            ?? 0,
          );
          const endpointMargin = Math.min(pathIndex, path.length - 1 - pathIndex);
          candidates.push({
            plan,
            path,
            pathIndex,
            point,
            direction: outgoing,
            elevation,
            nearestBoundaryMeters,
            score: nearestBoundaryMeters
              + endpointMargin * tileSize
              + (straight ? tileSize * 3 : 0)
              + path.length * 0.001,
          });
        }
      }
      candidates.sort((left, right) => (
        right.score - left.score
        || String(left.plan.id).localeCompare(String(right.plan.id))
        || left.pathIndex - right.pathIndex
      ));
      const minimumQuietBoundaryClearanceMeters = tileSize * 2;
      const candidate = candidates.find(({ nearestBoundaryMeters }) => (
        nearestBoundaryMeters >= minimumQuietBoundaryClearanceMeters - 1e-6
      ));
      if (!candidate) {
        throw new Error(
          `No V4 internal corridor camera candidate clears two tiles (${minimumQuietBoundaryClearanceMeters} m) from every boundary.`,
        );
      }
      const center = new Vector3(
        Number(candidate.point.x) * tileSize,
        candidate.elevation,
        Number(candidate.point.z) * tileSize,
      );
      const direction = new Vector3(candidate.direction.x, 0, candidate.direction.z);
      const cameraPosition = center.clone().addScaledVector(direction, -tileSize * 1.35);
      cameraPosition.y += 2.2;
      const target = center.clone().addScaledVector(direction, tileSize * 2.2);
      target.y += 1.8;
      renderFrame({ cameraPosition, target, playerPosition: center });
      const v4PlanIds = new Set(v4Plans().map(({ id }) => String(id)));
      const visibleV4ArchIds = collect(dungeon.group, (object) => (
        object.userData?.connectorDecorativeArch === true
        && v4PlanIds.has(String(object.userData?.connectorId ?? ''))
        && worldVisible(object)
      )).map(({ name }) => name);
      return {
        connectorId: String(candidate.plan.id),
        pathIndex: candidate.pathIndex,
        pathLength: candidate.path.length,
        nearestBoundaryMeters: candidate.nearestBoundaryMeters,
        cameraPosition: plainVector(cameraPosition),
        target: plainVector(target),
        visibleV4ArchIds,
      };
    };

    const stagePresentation = (presentationRecordId) => {
      const roots = collect(supplementRoot(), (object) => (
        String(object.userData?.presentationRecordId ?? '') === String(presentationRecordId)
      ));
      if (roots.length !== 1) {
        throw new Error(`Expected one presentation root for ${presentationRecordId}; received ${roots.length}.`);
      }
      const [root] = roots;
      const bounds = objectBounds(root);
      const target = bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
      const size = bounds.max.clone().sub(bounds.min);
      const quaternion = root.getWorldQuaternion(root.quaternion.clone());
      const serviceSide = new Vector3(0, 0, -1).applyQuaternion(quaternion).setY(0);
      if (serviceSide.lengthSq() < 0.5) serviceSide.set(0, 0, 1);
      serviceSide.normalize();
      const fovRadians = 52 * Math.PI / 180;
      const aspect = game.camera.aspect || 16 / 9;
      const framingHalfExtent = Math.max(
        size.y * 0.5,
        Math.max(size.x, size.z) * 0.5 / aspect,
      );
      const distance = Math.max(
        6.5,
        framingHalfExtent / Math.tan(fovRadians * 0.5) * 1.55
          + Math.max(size.x, size.z) * 0.25,
      );
      const cameraPosition = target.clone().addScaledVector(serviceSide, distance);
      cameraPosition.y += Math.max(0.25, size.y * 0.08);
      const playerPosition = target.clone();
      playerPosition.y = bounds.min.y;
      renderFrame({ cameraPosition, target, playerPosition });
      const projectedBounds = projectBounds(bounds);
      return {
        presentationRecordId: String(presentationRecordId),
        semanticRole: root.userData.presentationSemanticRole,
        rootVisible: worldVisible(root),
        cameraPosition: plainVector(cameraPosition),
        target: plainVector(target),
        projectedBounds,
        meshNames: meshSummary(root).meshNames,
      };
    };

    window.__dungeonAugmentationVisualAcceptance = {
      inspect,
      stageBoundary,
      stageQuietCorridor,
      stagePresentation,
    };
  });
}

async function capturePng(page, testInfo, filename, attachmentName = filename) {
  const screenshotPath = testInfo.outputPath(filename);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach(attachmentName, {
    path: screenshotPath,
    contentType: 'image/png',
  });
}

function expectCloseVector(actual, expected, digits = 5) {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.game?.stop?.()).catch(() => {});
});

for (const seed of SEEDS) {
  test(`canonical V4 seed ${seed.id} has sparse, unduplicated visual acceptance evidence`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(360_000);
    const runtimeErrors = captureRuntimeErrors(page);
    const startupUrl = [
      '/?startupWorld=dungeon',
      'dungeonFamily=industrial-v1',
      'busterLab=sandbox',
      'playerInvulnerable=1',
      `dungeonSeed=${seed.authored}`,
      `reaverbotSeed=${seed.authored}`,
      `dungeonAugmentation=${PROFILE_ID}`,
    ].join('&');

    await page.goto(startupUrl);
    await waitForDungeon(page, runtimeErrors);
    await waitForDungeonPresentationAssets(page);
    await installVisualAcceptanceHarness(page);

    const inspection = await page.evaluate(() => (
      window.__dungeonAugmentationVisualAcceptance.inspect()
    ));
    await testInfo.attach(`seed-${seed.id}-visual-acceptance-manifest`, {
      body: Buffer.from(JSON.stringify(inspection, null, 2)),
      contentType: 'application/json',
    });

    expect(
      inspection.gates.status,
      JSON.stringify(inspection.gates.diagnostics, null, 2),
    ).toBe('applied');
    expect(inspection.gates.profileId).toBe(PROFILE_ID);
    expect(inspection.gates.profileRevision).toBe(PROFILE_REVISION);
    expect(inspection.gates.progressionAccepted).toBe(true);
    expect(inspection.gates.alphaMode).toBe(false);

    const expectedBoundaryIds = inspection.boundary.expectedBoundaryIds;
    const actualBoundaryIds = inspection.boundary.indicators
      .map(({ attachmentSocketId }) => attachmentSocketId);
    expect(expectedBoundaryIds.length).toBeGreaterThanOrEqual(2);
    expect(actualBoundaryIds).toEqual(expectedBoundaryIds);
    expect(new Set(actualBoundaryIds).size).toBe(actualBoundaryIds.length);
    for (const indicator of inspection.boundary.indicators) {
      expect(indicator.connectorId).toBeTruthy();
      expect(indicator.meshNames).toEqual([
        'industrialBoundaryIndicatorMergedHeader',
        'industrialBoundaryIndicatorServiceStripe',
      ]);
      expect(indicator.meshCount).toBe(2);
      expect(indicator.drawCallCount).toBeLessThanOrEqual(2);
      expect(indicator.recordedMeshCount).toBe(2);
      expect(indicator.recordedDrawCallCount).toBeLessThanOrEqual(2);
      expect(indicator.drawCallUpperBound).toBe(2);
      expect(indicator.nonBlockingPresentation).toBe(true);
    }
    expect(sortUnique(
      inspection.boundary.structuralFrameRealizations
        .map(({ attachmentSocketId }) => attachmentSocketId),
    )).toEqual(expectedBoundaryIds);
    for (const attachmentSocketId of expectedBoundaryIds) {
      const realizations = inspection.boundary.structuralFrameRealizations.filter((entry) => (
        entry.attachmentSocketId === attachmentSocketId
      ));
      expect(realizations).toHaveLength(1);
      expect(realizations[0]).toMatchObject({ required: true, rendered: true });
      expect(realizations[0].renderedObjectId).toBe(realizations[0].rendererObjectId);
    }
    expect(inspection.boundary.planArchBeats.every(({ count }) => count === 0)).toBe(true);
    expect(inspection.boundary.sceneV4Arches).toEqual([]);

    const records = inspection.presentation.records;
    expect(records.filter(({ semanticRole }) => semanticRole === 'gameplay-cover').length)
      .toBeGreaterThan(0);
    expect(records.filter(({ semanticRole }) => semanticRole === 'machinery-landmark').length)
      .toBeGreaterThan(0);
    expect(new Set(records.map(({ id }) => id)).size).toBe(records.length);
    expect(new Set(records.map(({ sourceFeatureRuntimeId }) => sourceFeatureRuntimeId)).size)
      .toBe(records.length);
    expect(inspection.presentation.realizations.map(({ presentationRecordId }) => (
      presentationRecordId
    ))).toEqual(records.map(({ id }) => id));
    expect(inspection.presentation.roots.map(({ presentationRecordId }) => (
      presentationRecordId
    ))).toEqual(records.map(({ id }) => id));
    expect(inspection.presentation.cargoMeshes).toEqual([]);
    expect(inspection.presentation.internalDoorwayFrameRoots).toEqual([]);

    for (const record of records) {
      expect(record.realizationOwner).toBe('supplement-assembler');
      expect(record.selectedForRendering).toBe(true);
      expect(record.renderedBySupplementAssembler).toBe(true);
      expect(record.collisionRecordIds.length).toBeGreaterThan(0);
      const realization = inspection.presentation.realizations.find((entry) => (
        entry.presentationRecordId === record.id
      ));
      const root = inspection.presentation.roots.find((entry) => (
        entry.presentationRecordId === record.id
      ));
      expect(realization).toMatchObject({
        sourceFeatureId: record.sourceFeatureId,
        sourceFeatureRuntimeId: record.sourceFeatureRuntimeId,
        semanticRole: record.semanticRole,
        assetRole: record.assetRole,
        realizationOwner: 'supplement-assembler',
        realizationDisposition: 'rendered',
        renderedBySupplementAssembler: true,
        rootObjectCount: 1,
        meshCount: 2,
      });
      expect(realization.drawCallCount).toBeLessThanOrEqual(2);
      expect(realization.collisionRecordIds).toEqual(record.collisionRecordIds);
      expect(realization.width).toBeCloseTo(record.width, 5);
      expect(realization.height).toBeCloseTo(record.height, 5);
      expect(realization.depth).toBeCloseTo(record.depth, 5);
      expectCloseVector(realization.position, record.position);
      expect(root).toMatchObject({
        sourceFeatureId: record.sourceFeatureId,
        sourceFeatureRuntimeId: record.sourceFeatureRuntimeId,
        semanticRole: record.semanticRole,
        assetRole: record.assetRole,
        meshCount: 2,
      });
      expect(root.drawCallCount).toBeLessThanOrEqual(2);
      expectCloseVector(root.worldPosition, record.position);
      expect(root.meshNames).toEqual(record.semanticRole === 'gameplay-cover' ? [
        'industrialAuthoredCoverBody',
        'industrialAuthoredCoverCap',
      ] : [
        'industrialAuthoredMachineryBody',
        'industrialAuthoredMachineryServicePlate',
      ]);
    }

    for (const [index, attachmentSocketId] of expectedBoundaryIds.entries()) {
      const staged = await page.evaluate((socketId) => (
        window.__dungeonAugmentationVisualAcceptance.stageBoundary(socketId)
      ), attachmentSocketId);
      expect(staged.rootVisible).toBe(true);
      expect(staged.projections.map(({ name }) => name).sort()).toEqual([
        'industrialBoundaryIndicatorMergedHeader',
        'industrialBoundaryIndicatorServiceStripe',
      ]);
      expect(staged.projections.every(({ inView }) => inView)).toBe(true);
      await capturePng(
        page,
        testInfo,
        `seed-${seed.id}-boundary-${String(index + 1).padStart(2, '0')}.png`,
        `seed-${seed.id}-boundary-${String(index + 1).padStart(2, '0')}-${attachmentSocketId}`,
      );
    }

    const quiet = await page.evaluate(() => (
      window.__dungeonAugmentationVisualAcceptance.stageQuietCorridor()
    ));
    expect(quiet.connectorId).toBeTruthy();
    expect(quiet.pathLength).toBeGreaterThanOrEqual(3);
    expect(quiet.pathIndex).toBeGreaterThan(0);
    expect(quiet.pathIndex).toBeLessThan(quiet.pathLength - 1);
    expect(quiet.nearestBoundaryMeters).toBeGreaterThanOrEqual(5.6 - 1e-6);
    expect(quiet.visibleV4ArchIds).toEqual([]);
    await capturePng(
      page,
      testInfo,
      `seed-${seed.id}-quiet-internal-corridor.png`,
      `seed-${seed.id}-quiet-internal-corridor`,
    );

    for (const semanticRole of ['gameplay-cover', 'machinery-landmark']) {
      const record = records.find((candidate) => candidate.semanticRole === semanticRole);
      const staged = await page.evaluate((recordId) => (
        window.__dungeonAugmentationVisualAcceptance.stagePresentation(recordId)
      ), record.id);
      expect(staged.rootVisible).toBe(true);
      expect(staged.semanticRole).toBe(semanticRole);
      expect(staged.projectedBounds.maxX).toBeGreaterThan(-1);
      expect(staged.projectedBounds.minX).toBeLessThan(1);
      expect(staged.projectedBounds.maxY).toBeGreaterThan(-1);
      expect(staged.projectedBounds.minY).toBeLessThan(1);
      expect(staged.projectedBounds.maxX - staged.projectedBounds.minX).toBeGreaterThan(0.08);
      expect(staged.projectedBounds.maxY - staged.projectedBounds.minY).toBeGreaterThan(0.08);
      const label = semanticRole === 'gameplay-cover' ? 'cover' : 'machinery';
      await capturePng(
        page,
        testInfo,
        `seed-${seed.id}-${label}.png`,
        `seed-${seed.id}-${label}-${record.id}`,
      );
    }

    expect(runtimeErrors.pageErrors).toEqual([]);
    expect(runtimeErrors.consoleErrors).toEqual([]);
  });
}

function sortUnique(values) {
  return [...new Set(values.map(String))].sort((left, right) => left.localeCompare(right));
}
