import { expect } from '@playwright/test';

export const OVERWORLD_OBJECT_NAMES = Object.freeze({
  root: 'overworldWorldRoot',
  door: 'overworldDungeonDoor',
  roll: 'rollCaskettNpc',
  supportCar: 'expeditionSupportCar',
  workbench: 'rollWorkshopWorkbench',
});

export const attachRuntimeErrorCapture = (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
};

export const waitForWorld = async (page, worldKind, { timeout = 45_000 } = {}) => {
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.waitForFunction((expectedKind) => {
    const getter = window.game?.getWorldTransitionDiagnostics;
    if (typeof getter !== 'function') return false;
    const diagnostics = getter.call(window.game);
    return diagnostics?.worldKind === expectedKind
      && (expectedKind === 'overworld'
        ? diagnostics.transitionState === 'overworld'
        : diagnostics.transitionState === 'dungeon');
  }, worldKind, { timeout });
};

export const readWorldDiagnostics = (page) => page.evaluate(() => {
  const diagnostics = window.game?.getWorldTransitionDiagnostics?.();
  if (!diagnostics) throw new Error('Game did not publish world transition diagnostics.');
  return structuredClone(diagnostics);
});

const readCampAssetState = (page) => page.evaluate((names) => {
  const root = window.game?.activeWorldBundle?.root ?? null;
  const read = (name) => {
    const data = root?.getObjectByName?.(name)?.userData ?? {};
    return {
      modelLoading: Boolean(data.modelLoading),
      modelSettled: data.modelLoaded === true || Boolean(data.modelLoadError),
      textureLoading: Boolean(data.textureLoading),
      textureSettled: data.textureAssetsSettled === true
        || data.textureLoaded === true
        || Boolean(data.textureLoadError),
      animationSettled: typeof data.animationLibraryReady === 'boolean'
        || Boolean(data.modelLoadError),
    };
  };
  return {
    worldKind: window.game?.worldKind ?? null,
    roll: read(names.roll),
    supportCar: read(names.supportCar),
    workbench: read(names.workbench),
    renderer: structuredClone(window.game?.getWorldTransitionDiagnostics?.()?.renderer ?? {}),
  };
}, OVERWORLD_OBJECT_NAMES);

/**
 * Wait for the reused V1 camp assets and WebGL renderer accounting to settle.
 * This is a real warm-up gate, not a fixed grace delay: Roll's FBX animation
 * library can finish several seconds after her model first appears.
 */
export const waitForOverworldAssetsSettled = async (page, {
  timeout = 30_000,
  stableSamples = 3,
  sampleDelay = 250,
} = {}) => {
  await page.waitForFunction((names) => {
    const root = window.game?.activeWorldBundle?.root;
    if (window.game?.worldKind !== 'overworld' || !root) return false;
    const roll = root.getObjectByName(names.roll)?.userData ?? {};
    const supportCar = root.getObjectByName(names.supportCar)?.userData ?? {};
    const workbench = root.getObjectByName(names.workbench)?.userData ?? {};
    const rollModelSettled = roll.modelLoaded === true || Boolean(roll.modelLoadError);
    const rollAnimationsSettled = typeof roll.animationLibraryReady === 'boolean'
      || Boolean(roll.modelLoadError);
    const carSettled = supportCar.modelLoaded === true || Boolean(supportCar.modelLoadError);
    const benchSettled = workbench.textureAssetsSettled === true
      || Boolean(workbench.textureLoadError);
    return rollModelSettled
      && rollAnimationsSettled
      && !roll.modelLoading
      && !roll.textureLoading
      && carSettled
      && !supportCar.modelLoading
      && !supportCar.textureLoading
      && benchSettled
      && !workbench.textureLoading;
  }, OVERWORLD_OBJECT_NAMES, { timeout });

  const started = Date.now();
  let previous = null;
  let matchingSamples = 0;
  let latest = null;
  while (Date.now() - started < timeout) {
    latest = await readCampAssetState(page);
    const rendererKey = JSON.stringify({
      geometries: latest.renderer.geometries,
      textures: latest.renderer.textures,
    });
    if (rendererKey === previous) matchingSamples += 1;
    else matchingSamples = 1;
    previous = rendererKey;
    if (matchingSamples >= stableSamples) return latest;
    await page.waitForTimeout(sampleDelay);
  }
  throw new Error(`Overworld renderer accounting did not settle: ${JSON.stringify(latest)}`);
};

export const getActiveRootSummary = (page) => page.evaluate((names) => {
  const { game } = window;
  const root = game?.activeWorldBundle?.root
    ?? game?.worldBundle?.root
    ?? game?.activeWorldRoot
    ?? null;
  if (!root) throw new Error('Active world bundle does not expose its root.');

  const counts = {};
  for (const name of Object.values(names)) counts[name] = 0;
  let meshCount = 0;
  let instancedMeshCount = 0;
  let terrainChunkCount = 0;
  let nonGreedyTerrainChunkCount = 0;
  let suspiciousPerVoxelMeshCount = 0;
  const terrainChunks = [];
  root.traverse((object) => {
    if (Object.hasOwn(counts, object.name)) counts[object.name] += 1;
    if (object.isMesh) meshCount += 1;
    if (object.isInstancedMesh) instancedMeshCount += 1;
    if (object.userData?.overworldTerrainChunk === true) {
      terrainChunkCount += 1;
      if (object.userData?.greedyMeshed !== true) nonGreedyTerrainChunkCount += 1;
      terrainChunks.push({
        name: object.name,
        sourceCellCount: object.userData?.sourceCellCount ?? null,
        groups: object.geometry?.groups?.length ?? 0,
        indexed: Boolean(object.geometry?.index),
      });
    }
    if (
      object.userData?.voxelCell === true
      || object.userData?.perVoxelMesh === true
      || /(?:^|[-_])voxel[-_]?cell(?:$|[-_])/i.test(object.name)
    ) {
      suspiciousPerVoxelMeshCount += 1;
    }
  });

  return {
    rootName: root.name,
    rootId: root.userData?.worldRootId ?? root.uuid,
    planHash: root.userData?.overworldPlanHash ?? null,
    counts,
    meshCount,
    instancedMeshCount,
    terrainChunkCount,
    nonGreedyTerrainChunkCount,
    suspiciousPerVoxelMeshCount,
    terrainChunks,
  };
}, OVERWORLD_OBJECT_NAMES);

const readSteering = (page, targetName) => page.evaluate((objectName) => {
  const { game } = window;
  const root = game?.activeWorldBundle?.root
    ?? game?.worldBundle?.root
    ?? game?.activeWorldRoot;
  const target = root?.getObjectByName?.(objectName);
  const player = game?.player?.root;
  const camera = game?.camera;
  if (!target || !player || !camera) return null;

  const targetPosition = target.getWorldPosition(target.position.clone());
  const deltaX = targetPosition.x - player.position.x;
  const deltaZ = targetPosition.z - player.position.z;
  const distance = Math.hypot(deltaX, deltaZ);
  const cameraDirection = camera.getWorldDirection(camera.position.clone()).setY(0).normalize();
  const rightX = -cameraDirection.z;
  const rightZ = cameraDirection.x;
  return {
    distance,
    forwardDot: deltaX * cameraDirection.x + deltaZ * cameraDirection.z,
    rightDot: deltaX * rightX + deltaZ * rightZ,
    player: { x: player.position.x, y: player.position.y, z: player.position.z },
    target: { x: targetPosition.x, y: targetPosition.y, z: targetPosition.z },
  };
}, targetName);

const readPositionSteering = (page, targetPosition) => page.evaluate((target) => {
  const { game } = window;
  const player = game?.player?.root;
  const camera = game?.camera;
  if (!player || !camera) return null;
  const deltaX = target.x - player.position.x;
  const deltaZ = target.z - player.position.z;
  const distance = Math.hypot(deltaX, deltaZ);
  const cameraDirection = camera.getWorldDirection(camera.position.clone()).setY(0).normalize();
  const rightX = -cameraDirection.z;
  const rightZ = cameraDirection.x;
  return {
    distance,
    forwardDot: deltaX * cameraDirection.x + deltaZ * cameraDirection.z,
    rightDot: deltaX * rightX + deltaZ * rightZ,
    player: { x: player.position.x, y: player.position.y, z: player.position.z },
    target,
  };
}, targetPosition);

const steerOneStep = async (page, steering, stepMilliseconds) => {
  // Move along only the strongest camera-relative axis for each short sample.
  // Holding two axes while the follow camera is rotating makes the input basis
  // rotate underneath a diagonal command; over a long segment that can arc the
  // acceptance driver off the authored trail and into an otherwise unrelated
  // camp prop. Re-sampling one axis at a time keeps this ordinary keyboard
  // input deterministic without writing player or camera transforms.
  const candidates = [
    { key: steering.forwardDot >= 0 ? 'KeyW' : 'KeyS', score: Math.abs(steering.forwardDot) },
    { key: steering.rightDot >= 0 ? 'KeyD' : 'KeyA', score: Math.abs(steering.rightDot) },
  ];
  const key = candidates.sort((left, right) => right.score - left.score)[0]?.key ?? 'KeyW';
  await page.keyboard.down(key);
  try {
    await page.waitForTimeout(stepMilliseconds);
  } finally {
    await page.keyboard.up(key);
  }
};

export const walkToNamedObject = async (page, targetName, {
  stopDistance = 2.15,
  timeout = 15_000,
  stepMilliseconds = 90,
} = {}) => {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    last = await readSteering(page, targetName);
    if (!last) throw new Error(`Cannot steer toward missing object: ${targetName}`);
    if (last.distance <= stopDistance) return last;

    await steerOneStep(page, last, stepMilliseconds);
  }
  throw new Error(`Public-input steering did not reach ${targetName}: ${JSON.stringify(last)}`);
};

export const walkToWorldPosition = async (page, targetPosition, {
  stopDistance = 0.85,
  timeout = 20_000,
  stepMilliseconds = 90,
  sampleOcclusion = false,
} = {}) => {
  const started = Date.now();
  let last = null;
  let maximumHiddenOwnerCount = 0;
  const sampledHiddenOwnerIds = new Set();
  while (Date.now() - started < timeout) {
    last = await readPositionSteering(page, targetPosition);
    if (!last) throw new Error('Cannot steer before the player and camera are ready.');
    if (sampleOcclusion) {
      const occlusion = await page.evaluate(() => (
        window.game?.getWorldTransitionDiagnostics?.()?.occlusion ?? null
      ));
      maximumHiddenOwnerCount = Math.max(
        maximumHiddenOwnerCount,
        occlusion?.hiddenOwnerCount ?? 0,
      );
      for (const ownerId of occlusion?.hiddenOwnerIds ?? []) sampledHiddenOwnerIds.add(ownerId);
    }
    if (last.distance <= stopDistance) {
      return {
        ...last,
        maximumHiddenOwnerCount,
        sampledHiddenOwnerIds: [...sampledHiddenOwnerIds].sort(),
      };
    }
    await steerOneStep(page, last, stepMilliseconds);
  }
  throw new Error(`Public-input steering did not reach ${JSON.stringify(targetPosition)}: ${JSON.stringify(last)}`);
};

export const openExteriorBossModal = async (page) => {
  const approach = await page.evaluate(() => {
    const interaction = window.game?.activeWorldBundle?.facade?.plan?.interactions
      ?.find(({ id }) => id === 'overworldDungeonDoor');
    if (!interaction) return null;
    const target = { x: interaction.x, z: interaction.z };
    const side = interaction.activationSide;
    if (side?.axis === 'x') target.x += side.sign * 1.15;
    if (side?.axis === 'z') target.z += side.sign * 1.15;
    return target;
  });
  if (!approach) throw new Error('The overworld plan did not expose its dungeon-door interaction.');
  await walkToWorldPosition(page, approach, {
    stopDistance: 0.38,
    timeout: 20_000,
    stepMilliseconds: 75,
  });
  // Allow the runtime controller to publish the nearest interaction after the
  // final public-input movement sample before E is issued.
  await page.waitForTimeout(100);
  await page.keyboard.press('KeyE');
  const modal = page.locator('[data-overworld-boss-modal]');
  await expect(modal).toBeVisible();
  return modal;
};

export const beginBossExpedition = async (page, requestedProfileId = null) => {
  const modal = await openExteriorBossModal(page);
  const card = requestedProfileId
    ? modal.locator(`[data-boss-profile-id="${requestedProfileId}"]`)
    : modal.locator('[data-boss-profile-id]').first();
  await expect(card).toHaveCount(1);
  const profileId = await card.getAttribute('data-boss-profile-id');
  expect(profileId).toBeTruthy();
  await card.click();
  await expect(modal).toHaveAttribute('data-staged-boss-profile-id', profileId);
  await modal.locator('[data-action="begin-expedition"]').click();
  await waitForWorld(page, 'dungeon', { timeout: 60_000 });
  return profileId;
};

export const beginFirstBossExpedition = (page) => beginBossExpedition(page);

export const waitForInterruptedExpeditionPrompt = async (page) => {
  const modal = page.locator('[data-interrupted-expedition-modal]');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('aria-hidden', 'false');
  await expect(modal).toHaveAttribute('data-expedition-id', /\S+/);
  await expect(modal).toHaveAttribute('data-boss-profile-id', /\S+/);
  await expect(modal.locator('[data-action="resume-interrupted-expedition"]')).toBeEnabled();
  await expect(modal.locator('[data-action="abandon-interrupted-expedition"]')).toBeEnabled();
  return modal;
};

export const resumeInterruptedExpedition = async (page, { doubleSubmit = false } = {}) => {
  const modal = await waitForInterruptedExpeditionPrompt(page);
  const button = modal.locator('[data-action="resume-interrupted-expedition"]');
  await button.click();
  if (doubleSubmit) {
    // Force a second public click while the first asynchronous transaction is
    // in flight. The runtime must share that transaction rather than generate
    // or lock a second dungeon attempt.
    await button.click({ force: true }).catch(() => {});
  }
  await waitForWorld(page, 'dungeon', { timeout: 60_000 });
};

export const abandonInterruptedExpedition = async (page) => {
  const modal = await waitForInterruptedExpeditionPrompt(page);
  await modal.locator('[data-action="abandon-interrupted-expedition"]').click();
  await waitForWorld(page, 'overworld', { timeout: 60_000 });
  await expect(modal).toBeHidden();
};

export const openDungeonAbandonModalThroughEntrance = async (page) => {
  const diagnostics = await readWorldDiagnostics(page);
  const anchor = diagnostics.entryReturnAnchor;
  if (!Array.isArray(anchor) || anchor.length < 3) {
    throw new Error('Dungeon diagnostics did not expose the physical inside entrance anchor.');
  }
  await walkToWorldPosition(page, { x: anchor[0], z: anchor[2] }, {
    stopDistance: 0.9,
    timeout: 45_000,
    stepMilliseconds: 75,
  });
  await page.keyboard.press('KeyE');
  const modal = page.locator('[data-expedition-abandon-modal]');
  await expect(modal).toBeVisible();
  return modal;
};

export const abandonExpeditionThroughEntrance = async (page) => {
  const modal = await openDungeonAbandonModalThroughEntrance(page);
  await modal.locator('[data-action="confirm-abandon-expedition"]').click();
  await waitForWorld(page, 'overworld', { timeout: 60_000 });
};
