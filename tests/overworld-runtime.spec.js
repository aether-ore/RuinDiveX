import { expect, test } from '@playwright/test';
import {
  OVERWORLD_OBJECT_NAMES,
  abandonInterruptedExpedition,
  abandonExpeditionThroughEntrance,
  attachRuntimeErrorCapture,
  beginBossExpedition,
  beginFirstBossExpedition,
  getActiveRootSummary,
  openDungeonAbandonModalThroughEntrance,
  openExteriorBossModal,
  readWorldDiagnostics,
  resumeInterruptedExpedition,
  waitForOverworldAssetsSettled,
  waitForInterruptedExpeditionPrompt,
  waitForWorld,
  walkToNamedObject,
  walkToWorldPosition,
} from './helpers/overworld-runtime.js';

const ENTRY_ROLLBACK_FAILURES = Object.freeze([
  {
    name: 'selection storage',
    message: 'Injected selection failure',
    install: () => {
      window.game.selectBossHunt = async () => ({
        ok: false,
        reason: 'injected-selection-failure',
        message: 'Injected selection failure',
      });
    },
  },
  {
    name: 'expedition lock storage',
    message: 'Injected expedition lock failure',
    install: () => {
      window.game.busterLabStorage.lockBossHuntForExpedition = async () => ({
        ok: false,
        reason: 'injected-lock-failure',
        message: 'Injected expedition lock failure',
      });
    },
  },
  {
    name: 'V1 generation',
    message: 'Injected V1 generation failure',
    install: () => {
      window.game._createLegacyDungeonWorldCandidate = () => {
        throw new Error('Injected V1 generation failure');
      };
    },
  },
  {
    name: 'V1 streamed adapter preparation',
    message: 'Injected V1 adapter preparation failure',
    install: () => {
      window.game._prepareStreamedDungeonFacade = (bundle) => {
        window.__rejectedStreamedDungeonCandidate = bundle;
        throw new Error('Injected V1 adapter preparation failure');
      };
    },
  },
  {
    name: 'runtime assembly after durable lock',
    message: 'Injected runtime assembly failure',
    install: () => {
      window.game._installRuntimeControllerForBundle = () => {
        throw new Error('Injected runtime assembly failure');
      };
    },
  },
]);

const RETURN_ROLLBACK_FAILURES = Object.freeze([
  {
    name: 'overworld controller installation',
    message: 'Injected return controller failure',
    install: () => {
      const original = window.game._installRuntimeControllerForBundle.bind(window.game);
      window.game._installRuntimeControllerForBundle = (bundle) => {
        if (bundle?.worldKind === 'overworld') throw new Error('Injected return controller failure');
        return original(bundle);
      };
    },
  },
  {
    name: 'abandonment storage',
    message: 'Injected abandonment storage failure',
    install: () => {
      window.game.busterLabStorage.completeBossExpedition = async () => ({
        ok: false,
        reason: 'injected-abandonment-storage-failure',
        message: 'Injected abandonment storage failure',
      });
    },
  },
]);

const PLAYER_COLLISION_RADIUS = 0.42;

const readInterruptedExpeditionSnapshot = (page) => page.evaluate(() => {
  const { game } = window;
  const active = game.busterLabStorage?.getActiveBossExpedition?.() ?? null;
  const hunts = game.busterLabStorage?.getBossHuntState?.() ?? {};
  const records = Object.values(hunts.recordedExpeditions ?? {});
  const journey = game.worldKind === 'dungeon'
    ? game.getPublicDungeonJourneyDiagnostics?.({ includeGeometry: false }) ?? null
    : null;
  const entranceDoor = game.activeWorldBundle?.entranceDoor ?? null;
  return structuredClone({
    world: game.getWorldTransitionDiagnostics?.() ?? null,
    selectedBossProfileId: game.getSelectedBossProfileId?.() ?? null,
    storageRevision: game.busterLabStorage?.revision ?? null,
    storageWriteId: game.busterLabStorage?.writeId ?? null,
    active,
    activeExpeditionId: hunts.activeExpeditionId ?? null,
    activeRecordIds: records
      .filter(({ status }) => status === 'active')
      .map(({ expeditionId }) => expeditionId)
      .sort(),
    pendingRecoveries: hunts.pendingRecoveries ?? [],
    playerPosition: game.player?.root?.position?.toArray?.() ?? null,
    authoredEntry: game.dungeon?.ruinEntryPosition?.toArray?.()
      ?? game.dungeon?.playerStart?.toArray?.()
      ?? null,
    entranceDoor: entranceDoor ? {
      closed: Boolean(entranceDoor.closed),
      collisionHeight: entranceDoor.collisionHeight ?? null,
    } : null,
    localState: journey ? {
      ownedKeys: journey.ownedKeys ?? [],
      keycards: (journey.keycards ?? []).map(({ id, collected }) => ({ id, collected })),
      chests: (journey.chests ?? []).map(({ id, opened }) => ({ id, opened })),
      encounters: (journey.encounters ?? []).map(({ id, cleared }) => ({ id, cleared })),
      mechanisms: (journey.mechanisms ?? []).map(({ id, activated }) => ({ id, activated })),
    } : null,
  });
});

const horizontalDistance = (left, right) => Math.hypot(left.x - right.x, left.z - right.z);

const blockerContact = (position, blocker, radius = PLAYER_COLLISION_RADIUS) => {
  if (blocker.kind === 'cylinder') {
    const signedGap = Math.hypot(position.x - blocker.x, position.z - blocker.z)
      - (blocker.radius + radius);
    return {
      boundaryDistance: Math.abs(signedGap),
      penetration: Math.max(0, -signedGap),
    };
  }
  const yaw = blocker.rotationY ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const dx = position.x - blocker.x;
  const dz = position.z - blocker.z;
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  const outsideX = Math.abs(localX) - (blocker.halfWidth + radius);
  const outsideZ = Math.abs(localZ) - (blocker.halfDepth + radius);
  const inside = outsideX < 0 && outsideZ < 0;
  return {
    boundaryDistance: inside
      ? Math.min(-outsideX, -outsideZ)
      : Math.hypot(Math.max(0, outsideX), Math.max(0, outsideZ)),
    penetration: inside ? Math.min(-outsideX, -outsideZ) : 0,
  };
};

const approachBlockerFrom = (blocker, reference, clearance = 0.72) => {
  let directionX = reference.x - blocker.x;
  let directionZ = reference.z - blocker.z;
  const length = Math.hypot(directionX, directionZ) || 1;
  directionX /= length;
  directionZ /= length;
  if (blocker.kind === 'cylinder') {
    return {
      x: blocker.x + directionX * (blocker.radius + clearance),
      z: blocker.z + directionZ * (blocker.radius + clearance),
    };
  }
  const yaw = blocker.rotationY ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const localX = directionX * cos + directionZ * sin;
  const localZ = -directionX * sin + directionZ * cos;
  const boundaryDistance = Math.min(
    Math.abs(localX) > 0.000001 ? blocker.halfWidth / Math.abs(localX) : Infinity,
    Math.abs(localZ) > 0.000001 ? blocker.halfDepth / Math.abs(localZ) : Infinity,
  );
  return {
    x: blocker.x + directionX * (boundaryDistance + clearance),
    z: blocker.z + directionZ * (boundaryDistance + clearance),
  };
};

const readPlayerTraversalState = (page) => page.evaluate(() => {
  const { game } = window;
  const position = game.player.root.position;
  return {
    x: position.x,
    y: position.y,
    z: position.z,
    groundY: game.overworldController.getHeightAt(position.x, position.z),
    airborne: game.player.isJumpAirborne?.() === true,
    ledgeClinging: game.player.isLedgeClinging?.() === true,
  };
});

const assertPublicColliderContact = async (page, blocker, approach) => {
  await walkToWorldPosition(page, approach, {
    stopDistance: 0.34,
    timeout: 25_000,
    stepMilliseconds: 65,
  });

  let crossedCollider = false;
  await walkToWorldPosition(page, { x: blocker.x, z: blocker.z }, {
    stopDistance: 0.1,
    timeout: 900,
    stepMilliseconds: 55,
  }).then(() => { crossedCollider = true; }, () => {});
  expect(crossedCollider, `${blocker.id} allowed public input to reach its center`).toBe(false);

  const firstContact = await readPlayerTraversalState(page);
  const firstGeometry = blockerContact(firstContact, blocker);
  // The movement loop resolves discrete public-input frames, so the last safe
  // sample may remain one short movement step outside the exact Minkowski edge.
  expect(firstGeometry.boundaryDistance, `${blocker.id} did not stop at its authored boundary`).toBeLessThanOrEqual(0.4);
  expect(firstGeometry.penetration, `${blocker.id} allowed a deep player penetration`).toBeLessThanOrEqual(0.06);

  await walkToWorldPosition(page, { x: blocker.x, z: blocker.z }, {
    stopDistance: 0.1,
    timeout: 450,
    stepMilliseconds: 55,
  }).catch(() => {});
  const heldContact = await readPlayerTraversalState(page);
  expect(
    horizontalDistance(firstContact, heldContact),
    `${blocker.id} did not plateau while movement remained held`,
  // A slightly oblique tank-control approach may slide along the blocking
  // face while still remaining outside it; deep penetration is asserted
  // independently above.
  ).toBeLessThanOrEqual(0.65);

  const retreat = approachBlockerFrom(blocker, approach, 1.65);
  await walkToWorldPosition(page, retreat, {
    stopDistance: 0.4,
    timeout: 8_000,
    stepMilliseconds: 65,
  });
  const released = await readPlayerTraversalState(page);
  expect(
    horizontalDistance(heldContact, released),
    `${blocker.id} collision did not release when moving away`,
  ).toBeGreaterThan(0.55);
  return firstContact;
};

const readRuntimeLandmarkParity = (page) => page.evaluate(() => {
  const { game } = window;
  const plan = game.overworldPlan;
  const root = game.activeWorldBundle.root;
  root.updateMatrixWorld(true);
  const errors = [];
  const approximately = (left, right, tolerance = 0.002) => Math.abs(left - right) <= tolerance;
  const angleDelta = (left, right) => {
    let result = left - right;
    while (result > Math.PI) result -= Math.PI * 2;
    while (result < -Math.PI) result += Math.PI * 2;
    return Math.abs(result);
  };
  const visibleMeshCount = (owner) => {
    let count = 0;
    owner?.traverse?.((object) => {
      if (object.isMesh && object.material && object.visible !== false) count += 1;
    });
    return count;
  };
  const matrixScale = (matrix) => {
    const elements = matrix.elements;
    return {
      x: Math.hypot(elements[0], elements[1], elements[2]),
      y: Math.hypot(elements[4], elements[5], elements[6]),
      z: Math.hypot(elements[8], elements[9], elements[10]),
    };
  };
  const blockerById = new Map(plan.blockers.map((blocker) => [blocker.id, blocker]));

  for (const house of plan.houses) {
    const owner = root.getObjectByName(house.id);
    const mainBlocker = blockerById.get(`${house.id}-collision`);
    if (!owner || visibleMeshCount(owner) === 0) errors.push(`missing-visible-house:${house.id}`);
    if (!mainBlocker) {
      errors.push(`missing-house-blocker:${house.id}`);
      continue;
    }
    const visualYaw = house.yawQuarterTurns * Math.PI * 0.5;
    if (!approximately(owner.position.x, house.x) || !approximately(owner.position.z, house.z)) {
      errors.push(`house-transform-mismatch:${house.id}`);
    }
    if (angleDelta(mainBlocker.rotationY ?? 0, -visualYaw) > 0.00001) {
      errors.push(`house-collider-yaw-mismatch:${house.id}`);
    }

    const bodyExtensions = house.extensions.filter(({ kind }) => (
      !['porch', 'overlook', 'chimney', 'dormer'].includes(kind)
    ));
    const bodies = root.getObjectByName(`${house.id}-instancedWalls`);
    if (!bodies) {
      errors.push(`missing-house-wall-instances:${house.id}`);
    } else {
      const matrix = bodies.matrix.clone();
      bodies.getMatrixAt(0, matrix);
      const scale = matrixScale(matrix);
      const visualRoofTop = house.level * plan.dimensions.levelHeight
        + house.wallHeight + 0.555 + Math.max(0, house.roofTiers - 1) * 0.52;
      const colliderMinimumY = mainBlocker.y - mainBlocker.halfHeight;
      const colliderMaximumY = mainBlocker.y + mainBlocker.halfHeight;
      if (!approximately(scale.x, mainBlocker.halfWidth * 2)
        || !approximately(scale.y, house.wallHeight)
        || !approximately(scale.z, mainBlocker.halfDepth * 2)) {
        errors.push(`house-main-bounds-mismatch:${house.id}`);
      }
      if (colliderMinimumY > house.level * plan.dimensions.levelHeight + 0.01
        || colliderMaximumY < visualRoofTop - 0.05) {
        errors.push(`house-vertical-collider-coverage-mismatch:${house.id}`);
      }
    }
    for (const [extensionIndex, extension] of house.extensions.entries()) {
      if (['porch', 'overlook', 'dormer'].includes(extension.kind)) continue;
      const blocker = blockerById.get(`${house.id}-extension-${extensionIndex}-collision`);
      if (!blocker) {
        errors.push(`missing-house-extension-blocker:${house.id}:${extensionIndex}`);
        continue;
      }
      let visualPosition = null;
      let visualScale = null;
      if (extension.kind === 'chimney') {
        const mesh = root.getObjectByName(`${house.id}-chimney`);
        visualPosition = mesh?.getWorldPosition?.(owner.position.clone()) ?? null;
        const parameters = mesh?.geometry?.parameters;
        if (parameters) {
          visualScale = {
            x: parameters.width,
            y: parameters.height,
            z: parameters.depth,
          };
        }
      } else {
        const bodyIndex = bodyExtensions.indexOf(extension);
        if (bodies && bodyIndex >= 0) {
          const matrix = bodies.matrix.clone();
          bodies.getMatrixAt(bodyIndex + 1, matrix);
          visualPosition = owner.localToWorld(owner.position.clone().setFromMatrixPosition(matrix));
          visualScale = matrixScale(matrix);
        }
      }
      if (!visualPosition
        || !approximately(visualPosition.x, blocker.x)
        || !approximately(visualPosition.y, blocker.y)
        || !approximately(visualPosition.z, blocker.z)) {
        errors.push(`house-extension-transform-mismatch:${house.id}:${extensionIndex}`);
      }
      if (!visualScale
        || !approximately(visualScale.x, blocker.halfWidth * 2)
        || !approximately(visualScale.y, blocker.halfHeight * 2)
        || !approximately(visualScale.z, blocker.halfDepth * 2)) {
        errors.push(`house-extension-bounds-mismatch:${house.id}:${extensionIndex}`);
      }
    }
  }

  const renderedTrunks = new Map();
  root.traverse((object) => {
    if (!object.isInstancedMesh || !object.name.startsWith('overworldTreeTrunks-')) return;
    for (const [index, ownerId] of (object.userData.instanceOwnerIds ?? []).entries()) {
      if (renderedTrunks.has(ownerId)) {
        errors.push(`duplicate-rendered-tree:${ownerId}`);
        continue;
      }
      const matrix = object.matrix.clone();
      object.getMatrixAt(index, matrix);
      const position = object.localToWorld(object.position.clone().setFromMatrixPosition(matrix));
      renderedTrunks.set(ownerId, { position, scale: matrixScale(matrix) });
    }
  });
  for (const tree of plan.trees) {
    const rendered = renderedTrunks.get(tree.id);
    const position = rendered?.position;
    const blocker = blockerById.get(`${tree.id}-collision`);
    if (!position) errors.push(`missing-rendered-tree:${tree.id}`);
    if (!blocker || blocker.kind !== 'cylinder') errors.push(`missing-tree-cylinder:${tree.id}`);
    if (position && (!approximately(position.x, tree.x)
      || !approximately(position.y, tree.y + tree.trunkHeight * 0.5)
      || !approximately(position.z, tree.z))) {
      errors.push(`tree-transform-mismatch:${tree.id}`);
    }
    if (blocker && (!approximately(blocker.x, tree.x)
      || !approximately(blocker.y, tree.y + tree.trunkHeight * 0.5)
      || !approximately(blocker.z, tree.z))) {
      errors.push(`tree-collider-transform-mismatch:${tree.id}`);
    }
    if (rendered && blocker && (
      !approximately(rendered.scale.y, blocker.halfHeight * 2)
      || blocker.radius * 2 + 0.001 < rendered.scale.x
      || blocker.radius * 2 > rendered.scale.x + 0.35
    )) {
      errors.push(`tree-collider-bounds-mismatch:${tree.id}`);
    }
  }
  if (renderedTrunks.size !== plan.trees.length) errors.push('rendered-tree-owner-count-mismatch');

  for (const ownerId of ['expeditionSupportCar', 'rollWorkshopWorkbench']) {
    const owner = root.getObjectByName(ownerId);
    const landmark = plan.landmarks.find(({ id }) => id === ownerId);
    const blocker = plan.blockers.find((candidate) => candidate.ownerId === ownerId);
    if (!owner || visibleMeshCount(owner) === 0) errors.push(`missing-visible-landmark:${ownerId}`);
    if (!landmark || !blocker) errors.push(`missing-landmark-contract:${ownerId}`);
    if (owner && landmark && (!approximately(owner.position.x, landmark.x)
      || !approximately(owner.position.z, landmark.z)
      || angleDelta(owner.rotation.y, landmark.yaw ?? 0) > 0.00001)) {
      errors.push(`landmark-transform-mismatch:${ownerId}`);
    }
    if (blocker && landmark && angleDelta(blocker.rotationY ?? 0, -(landmark.yaw ?? 0)) > 0.00001) {
      errors.push(`landmark-collider-yaw-mismatch:${ownerId}`);
    }
  }

  const door = root.getObjectByName('overworldDungeonDoor');
  const doorBlocker = blockerById.get('overworldDungeonDoorCollision');
  if (!door || visibleMeshCount(door) < 2) errors.push('missing-visible-dungeon-door');
  if (!doorBlocker || doorBlocker.halfHeight < 3 || doorBlocker.halfWidth < 2.5) {
    errors.push('invalid-dungeon-door-blocker');
  } else {
    const panels = [
      root.getObjectByName('overworldDungeonDoorPanelLeft'),
      root.getObjectByName('overworldDungeonDoorPanelRight'),
    ];
    if (panels.some((panel) => !panel?.geometry?.parameters)) {
      errors.push('missing-dungeon-door-seal-panels');
    } else {
      const sealBounds = panels.reduce((bounds, panel) => {
        const { width, height, depth } = panel.geometry.parameters;
        const worldPosition = panel.getWorldPosition(panel.position.clone());
        return {
          minX: Math.min(bounds.minX, worldPosition.x - width * 0.5),
          maxX: Math.max(bounds.maxX, worldPosition.x + width * 0.5),
          minY: Math.min(bounds.minY, worldPosition.y - height * 0.5),
          maxY: Math.max(bounds.maxY, worldPosition.y + height * 0.5),
          minZ: Math.min(bounds.minZ, worldPosition.z - depth * 0.5),
          maxZ: Math.max(bounds.maxZ, worldPosition.z + depth * 0.5),
        };
      }, {
        minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
        minZ: Infinity, maxZ: -Infinity,
      });
      if (sealBounds.minX < doorBlocker.x - doorBlocker.halfWidth - 0.01
        || sealBounds.maxX > doorBlocker.x + doorBlocker.halfWidth + 0.01
        || sealBounds.minY < doorBlocker.y - doorBlocker.halfHeight - 0.01
        || sealBounds.maxY > doorBlocker.y + doorBlocker.halfHeight + 0.01
        || sealBounds.minZ < doorBlocker.z - doorBlocker.halfDepth - 0.01
        || sealBounds.maxZ > doorBlocker.z + doorBlocker.halfDepth + 0.01) {
        errors.push('dungeon-door-seal-collider-bounds-mismatch');
      }
    }
  }
  return errors;
});

test.describe('voxel overworld acceptance', () => {
  test.describe.configure({ mode: 'serial' });

  test('default boot owns one deterministic overworld and stable camp landmarks', async ({ page }) => {
    const runtimeErrors = attachRuntimeErrorCapture(page);
    const response = await page.goto('/');
    expect(response?.headers()['x-overworld-test-server']).toBe('isolated');
    expect(response?.headers()['x-overworld-build-fingerprint']).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(response?.headers()['x-overworld-build-input-count'])).toBeGreaterThan(30);
    await waitForWorld(page, 'overworld');

    await expect(page.locator('#dungeon-minimap')).toBeHidden();
    await expect(page.locator('#objective-value')).toContainText(
      /Choose a Boss Hunt at the sealed ruin door/i,
    );

    const diagnostics = await readWorldDiagnostics(page);
    const root = await getActiveRootSummary(page);

    expect(diagnostics).toMatchObject({
      worldKind: 'overworld',
      transitionState: 'overworld',
      disposalCount: 0,
    });
    expect(diagnostics.activeRootId).toBeTruthy();
    expect(diagnostics.planHash).toMatch(/^[a-z0-9_-]{6,}$/i);
    expect(diagnostics.generationCount).toBeGreaterThanOrEqual(1);
    expect(diagnostics.ownership).toMatchObject({
      scenePlayerRootCount: 1,
      sceneActiveWorldRootCount: 1,
      activeControllerCount: 1,
      gameHostEventBindingPasses: 1,
    });
    expect(diagnostics.ownership.gameHostEventListenerRegistrations).toBeGreaterThan(0);
    expect(diagnostics.ownership.activeRootObjectCount).toBeGreaterThan(0);
    expect(diagnostics.ownership.disposableResourceCount).toBeGreaterThan(0);
    expect(diagnostics.eventLog).toEqual([
      expect.objectContaining({
        sequence: 0,
        event: 'initialized',
        state: 'overworld',
        worldKind: 'overworld',
      }),
    ]);
    expect(root.rootName).toBe(OVERWORLD_OBJECT_NAMES.root);
    expect(root.rootId).toBe(diagnostics.activeRootId);
    expect(root.planHash).toBe(diagnostics.planHash);
    for (const objectName of [
      OVERWORLD_OBJECT_NAMES.door,
      OVERWORLD_OBJECT_NAMES.roll,
      OVERWORLD_OBJECT_NAMES.supportCar,
      OVERWORLD_OBJECT_NAMES.workbench,
    ]) {
      expect(root.counts[objectName], `${objectName} must have one active owner`).toBe(1);
    }
    expect(runtimeErrors).toEqual([]);

    const firstHash = diagnostics.planHash;
    await page.reload();
    await waitForWorld(page, 'overworld');
    expect((await readWorldDiagnostics(page)).planHash).toBe(firstHash);
  });

  test('the closed ruin door blocks traversal and cancelling its modal leaves the world intact', async ({ page }) => {
    const runtimeErrors = attachRuntimeErrorCapture(page);
    await page.goto('/');
    await waitForWorld(page, 'overworld');
    const before = await readWorldDiagnostics(page);

    const nearest = await walkToNamedObject(page, OVERWORLD_OBJECT_NAMES.door, {
      stopDistance: 1.3,
      timeout: 18_000,
    });
    expect(nearest.distance).toBeGreaterThan(0.72);

    // Repeated forward/jump input must not cross or vault the full-height seal.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await walkToNamedObject(page, OVERWORLD_OBJECT_NAMES.door, {
        stopDistance: 0.4,
        timeout: 1_500,
        stepMilliseconds: 100,
      }).catch(() => {});
      await page.keyboard.press('Space');
      await page.waitForTimeout(180);
    }
    const blocked = await walkToNamedObject(page, OVERWORLD_OBJECT_NAMES.door, {
      stopDistance: 0.4,
      timeout: 700,
      stepMilliseconds: 80,
    }).then(() => false, () => true);
    expect(blocked).toBe(true);

    await page.keyboard.press('KeyE');
    const modal = page.locator('[data-overworld-boss-modal]');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('data-staged-boss-profile-id', '');
    await expect(modal.locator('[data-action="begin-expedition"]')).toBeDisabled();
    await modal.locator('[data-action="cancel-expedition"]').first().click();
    await expect(modal).toBeHidden();

    const after = await readWorldDiagnostics(page);
    expect(after).toMatchObject({
      worldKind: 'overworld',
      transitionState: 'overworld',
      activeRootId: before.activeRootId,
      planHash: before.planHash,
      generationCount: before.generationCount,
      disposalCount: before.disposalCount,
    });
    expect(after.occlusion.hiddenOwnerCount).toBe(0);
    expect(runtimeErrors).toEqual([]);
  });

  test('boss choice is staged before one atomic dungeon transition', async ({ page }) => {
    const runtimeErrors = attachRuntimeErrorCapture(page);
    await page.goto('/');
    await waitForWorld(page, 'overworld');
    const before = await readWorldDiagnostics(page);
    const modal = await openExteriorBossModal(page);
    const card = modal.locator('[data-boss-profile-id]').first();
    const profileId = await card.getAttribute('data-boss-profile-id');
    await card.click();
    await expect(modal).toHaveAttribute('data-staged-boss-profile-id', profileId);

    const staged = await readWorldDiagnostics(page);
    expect(staged).toMatchObject({
      worldKind: 'overworld',
      transitionState: 'overworld',
      activeRootId: before.activeRootId,
      planHash: before.planHash,
      generationCount: before.generationCount,
      disposalCount: before.disposalCount,
    });

    await page.evaluate(() => {
      const { game } = window;
      const order = [];
      const wrap = (owner, name, label) => {
        const original = owner[name].bind(owner);
        owner[name] = (...args) => {
          order.push(label);
          return original(...args);
        };
      };
      wrap(game, 'selectBossHunt', 'persist-selection');
      wrap(game, '_createLegacyDungeonWorldCandidate', 'generate-detached-candidate');
      wrap(game, '_configureBossHuntEncounter', 'configure-boss');
      wrap(game.busterLabStorage, 'lockBossHuntForExpedition', 'durable-lock');
      wrap(game, '_animateExteriorDungeonDoorOpening', 'animate-exterior-door');
      const originalMount = game._assignMountedWorldBundle.bind(game);
      game._assignMountedWorldBundle = (bundle, ...args) => {
        if (bundle?.worldKind === 'dungeon') order.push('mount-dungeon');
        return originalMount(bundle, ...args);
      };
      window.__entryTransactionOrder = order;
    });

    const begin = modal.locator('[data-action="begin-expedition"]');
    await begin.click();
    await begin.click({ force: true }).catch(() => {});
    await waitForWorld(page, 'dungeon', { timeout: 60_000 });
    const entered = await readWorldDiagnostics(page);

    expect(entered.worldKind).toBe('dungeon');
    expect(entered.transitionState).toBe('dungeon');
    expect(entered.activeRootId).not.toBe(before.activeRootId);
    expect(entered.generationCount).toBe(before.generationCount + 1);
    expect(entered.disposalCount).toBe(before.disposalCount + 1);
    expect(entered.lastDisposalStats).toBeTruthy();
    expect(await page.evaluate(() => window.game.getSelectedBossProfileId?.())).toBe(profileId);
    expect(await page.evaluate(() => window.__entryTransactionOrder)).toEqual([
      'persist-selection',
      'generate-detached-candidate',
      'configure-boss',
      'durable-lock',
      'animate-exterior-door',
      'mount-dungeon',
    ]);
    expect(runtimeErrors).toEqual([]);
  });

  test('every rendered entry-transition frame contains exactly one world root', async ({ page }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    await page.goto('/');
    await waitForWorld(page, 'overworld');
    const modal = await openExteriorBossModal(page);
    const card = modal.locator('[data-boss-profile-id="revolvingFusillade"]');
    await card.click();
    await expect(modal).toHaveAttribute('data-staged-boss-profile-id', 'revolvingFusillade');
    await page.evaluate(() => {
      const { game } = window;
      const renderer = game.renderer;
      const originalRender = renderer.render;
      const samples = [];
      renderer.render = function renderWithWorldRootExclusivityProbe(...args) {
        const roots = game.scene.children.filter((object) => (
          object.userData?.worldRootId
          && ['overworld', 'dungeon'].includes(object.userData?.worldKind)
        ));
        samples.push({
          transitionState: game.transitionState,
          worldKinds: roots.map((root) => root.userData.worldKind),
          rootIds: roots.map((root) => root.userData.worldRootId),
          rootCount: roots.length,
        });
        return originalRender.apply(this, args);
      };
      window.__worldRootExclusivityProbe = {
        samples,
        stop() {
          renderer.render = originalRender;
          return structuredClone(samples);
        },
      };
    });

    await modal.locator('[data-action="begin-expedition"]').click();
    await waitForWorld(page, 'dungeon', { timeout: 60_000 });
    const samples = await page.evaluate(() => window.__worldRootExclusivityProbe.stop());
    const transitionSamples = samples.filter(({ transitionState }) => transitionState === 'enteringDungeon');
    expect(transitionSamples.length).toBeGreaterThan(0);
    expect(samples.every(({ rootCount }) => rootCount === 1)).toBe(true);
    expect(samples.some(({ worldKinds }) => worldKinds[0] === 'overworld')).toBe(true);
    expect(samples.some(({ worldKinds }) => worldKinds[0] === 'dungeon')).toBe(true);
    const diagnostics = await readWorldDiagnostics(page);
    expect(diagnostics.ownership.sceneWorldRootCount).toBe(1);
    expect(diagnostics.ownership.sceneWorldRootIds).toEqual([diagnostics.activeRootId]);
    expect(runtimeErrors).toEqual([]);
  });

  test('closing and reopening during a durable expedition requires an explicit restart and rebuilds the same V1 run from its beginning', async ({ page, context }) => {
    test.setTimeout(150_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    const startupUrl = '/?dungeonSeed=interrupted-expedition-restart&reaverbotSeed=interrupted-expedition-restart';
    await page.goto(startupUrl);
    await waitForWorld(page, 'overworld');
    await beginBossExpedition(page, 'revolvingFusillade');

    const entered = await readInterruptedExpeditionSnapshot(page);
    expect(entered.active).toMatchObject({
      status: 'active',
      bossProfileId: 'revolvingFusillade',
      dungeonLayoutSeed: 'layout:interrupted-expedition-restart',
    });
    expect(entered.activeRecordIds).toEqual([entered.active.expeditionId]);
    expect(entered.world.planHash).toBeTruthy();

    // Leave the authored entrance using ordinary input so restart must prove
    // it returned to the beginning instead of retaining an in-memory position.
    await page.keyboard.down('KeyW');
    try {
      await page.waitForTimeout(2_500);
    } finally {
      await page.keyboard.up('KeyW');
    }
    const departedPosition = await page.evaluate(() => window.game.player.root.position.toArray());
    expect(Math.hypot(
      departedPosition[0] - entered.authoredEntry[0],
      departedPosition[2] - entered.authoredEntry[2],
    )).toBeGreaterThan(2);

    // Closing the page and creating another page in the same browser context
    // preserves real browser storage without mutating campaign state in test.
    await page.close();
    const reopened = await context.newPage();
    const reopenedErrors = attachRuntimeErrorCapture(reopened);
    await reopened.goto(startupUrl);
    await waitForWorld(reopened, 'overworld');
    const modal = await waitForInterruptedExpeditionPrompt(reopened);
    await expect(reopened.locator('[data-overworld-boss-modal]')).toBeHidden();
    expect(await reopened.evaluate(() => document.activeElement?.dataset?.action ?? null))
      .toBe('resume-interrupted-expedition');

    // There is intentionally no third choice: backdrop and Escape must not
    // silently discard or bypass the durable expedition decision.
    await modal.click({ position: { x: 4, y: 4 } });
    await reopened.keyboard.press('Escape');
    await expect(modal).toBeVisible();

    const prompting = await readInterruptedExpeditionSnapshot(reopened);
    expect(prompting.active).toEqual(entered.active);
    expect(prompting.activeRecordIds).toEqual([entered.active.expeditionId]);
    expect(prompting.world).toMatchObject({
      worldKind: 'overworld',
      transitionState: 'overworld',
    });

    await resumeInterruptedExpedition(reopened, { doubleSubmit: true });
    const restarted = await readInterruptedExpeditionSnapshot(reopened);
    expect(restarted.world).toMatchObject({
      worldKind: 'dungeon',
      transitionState: 'dungeon',
      planHash: entered.world.planHash,
    });
    expect(restarted.selectedBossProfileId).toBe(entered.selectedBossProfileId);
    expect(restarted.active).toMatchObject({
      expeditionId: entered.active.expeditionId,
      bossProfileId: entered.active.bossProfileId,
      seed: entered.active.seed,
      depth: entered.active.depth,
      dungeonLayoutSeed: entered.active.dungeonLayoutSeed,
      status: 'active',
      startedAt: entered.active.startedAt,
      restartCount: (entered.active.restartCount ?? 0) + 1,
    });
    expect(restarted.active.restartedAt).toEqual(expect.any(String));
    expect(restarted.activeRecordIds).toEqual([entered.active.expeditionId]);
    // The two rapid clicks must collapse to one durable restart transaction.
    expect(restarted.storageRevision).toBe(entered.storageRevision + 1);
    expect(restarted.storageWriteId).not.toBe(entered.storageWriteId);
    expect(restarted.playerPosition[0]).toBeCloseTo(restarted.authoredEntry[0], 3);
    expect(restarted.playerPosition[1]).toBeCloseTo(restarted.authoredEntry[1], 3);
    expect(restarted.playerPosition[2]).toBeCloseTo(restarted.authoredEntry[2], 3);
    expect(Math.hypot(
      restarted.playerPosition[0] - departedPosition[0],
      restarted.playerPosition[2] - departedPosition[2],
    )).toBeGreaterThan(2);
    expect(restarted.entranceDoor).toMatchObject({ closed: true });
    expect(restarted.entranceDoor.collisionHeight).toBeGreaterThan(12);
    expect(restarted.localState.ownedKeys).toEqual([]);
    expect(restarted.localState.keycards.every(({ collected }) => !collected)).toBe(true);
    expect(restarted.localState.chests.every(({ opened }) => !opened)).toBe(true);
    expect(restarted.localState.encounters.every(({ cleared }) => !cleared)).toBe(true);
    expect(restarted.localState.mechanisms.every(({ activated }) => !activated)).toBe(true);
    await expect(modal).toBeHidden();
    expect([...runtimeErrors, ...reopenedErrors]).toEqual([]);
  });

  test('abandoning an interrupted expedition clears its durable lock and permits a different Boss Hunt', async ({ page, context }) => {
    test.setTimeout(150_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    const startupUrl = '/?dungeonSeed=interrupted-expedition-abandon&reaverbotSeed=interrupted-expedition-abandon';
    const abandonedProfileId = 'revolvingFusillade';
    const replacementProfileId = 'pursuitRegent';
    await page.goto(startupUrl);
    await waitForWorld(page, 'overworld');
    await beginBossExpedition(page, abandonedProfileId);
    const entered = await readInterruptedExpeditionSnapshot(page);
    expect(entered.active).toMatchObject({
      status: 'active',
      bossProfileId: abandonedProfileId,
    });

    await page.close();
    const reopened = await context.newPage();
    const reopenedErrors = attachRuntimeErrorCapture(reopened);
    await reopened.goto(startupUrl);
    await waitForWorld(reopened, 'overworld');
    await waitForInterruptedExpeditionPrompt(reopened);
    const beforeAbandon = await readWorldDiagnostics(reopened);

    await abandonInterruptedExpedition(reopened);
    const abandoned = await reopened.evaluate((expeditionId) => {
      const { game } = window;
      const hunts = game.busterLabStorage.getBossHuntState();
      return structuredClone({
        world: game.getWorldTransitionDiagnostics(),
        locked: game.getBossHuntViewModel().locked,
        selectedBossProfileId: game.getSelectedBossProfileId(),
        active: game.busterLabStorage.getActiveBossExpedition(),
        activeExpeditionId: hunts.activeExpeditionId,
        abandonedRecord: hunts.recordedExpeditions[expeditionId] ?? null,
      });
    }, entered.active.expeditionId);
    expect(abandoned.world).toMatchObject({
      worldKind: 'overworld',
      transitionState: 'overworld',
      activeRootId: beforeAbandon.activeRootId,
      generationCount: beforeAbandon.generationCount,
      disposalCount: beforeAbandon.disposalCount,
    });
    expect(abandoned.active).toBeNull();
    expect(abandoned.activeExpeditionId).toBeNull();
    expect(abandoned.locked).toBe(false);
    expect(abandoned.selectedBossProfileId).toBe(abandonedProfileId);
    expect(abandoned.abandonedRecord).toMatchObject({
      expeditionId: entered.active.expeditionId,
      bossProfileId: abandonedProfileId,
      status: 'abandoned',
    });

    await beginBossExpedition(reopened, replacementProfileId);
    const replacement = await readInterruptedExpeditionSnapshot(reopened);
    expect(replacement.world).toMatchObject({
      worldKind: 'dungeon',
      transitionState: 'dungeon',
    });
    expect(replacement.selectedBossProfileId).toBe(replacementProfileId);
    expect(replacement.active).toMatchObject({
      status: 'active',
      bossProfileId: replacementProfileId,
      dungeonLayoutSeed: 'layout:interrupted-expedition-abandon',
    });
    expect(replacement.active.expeditionId).not.toBe(entered.active.expeditionId);
    expect(replacement.activeRecordIds).toEqual([replacement.active.expeditionId]);
    expect([...runtimeErrors, ...reopenedErrors]).toEqual([]);
  });

  test('an interrupted-expedition rebuild failure leaves the mandatory prompt, durable lock, and overworld intact', async ({ page, context }) => {
    test.setTimeout(120_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    const startupUrl = '/?dungeonSeed=interrupted-expedition-rollback&reaverbotSeed=interrupted-expedition-rollback';
    await page.goto(startupUrl);
    await waitForWorld(page, 'overworld');
    await beginBossExpedition(page, 'revolvingFusillade');
    const entered = await readInterruptedExpeditionSnapshot(page);

    await page.close();
    const reopened = await context.newPage();
    const reopenedErrors = attachRuntimeErrorCapture(reopened);
    await reopened.goto(startupUrl);
    await waitForWorld(reopened, 'overworld');
    const modal = await waitForInterruptedExpeditionPrompt(reopened);
    const before = await readInterruptedExpeditionSnapshot(reopened);

    // Fault injection is confined to this rollback contract; the resolution
    // itself is still initiated through the same public button as a player.
    await reopened.evaluate(() => {
      window.game._createLegacyDungeonWorldCandidate = () => {
        throw new Error('Injected interrupted V1 rebuild failure');
      };
    });
    await modal.locator('[data-action="resume-interrupted-expedition"]').click();
    await expect(reopened.locator('#interrupted-expedition-error'))
      .toContainText('Injected interrupted V1 rebuild failure');
    await expect.poll(async () => (await readWorldDiagnostics(reopened)).transitionState)
      .toBe('overworld');

    const after = await readInterruptedExpeditionSnapshot(reopened);
    expect(after.world).toMatchObject({
      worldKind: 'overworld',
      transitionState: 'overworld',
      activeRootId: before.world.activeRootId,
      planHash: before.world.planHash,
      generationCount: before.world.generationCount,
      disposalCount: before.world.disposalCount,
    });
    expect(after.active).toEqual(entered.active);
    expect(after.activeRecordIds).toEqual([entered.active.expeditionId]);
    expect(after.storageRevision).toBe(before.storageRevision);
    expect(after.storageWriteId).toBe(before.storageWriteId);
    expect(after.world.eventLog.map(({ event }) => event))
      .toContain('interrupted-expedition-restart-failed');
    await expect(modal).toBeVisible();
    await expect(modal.locator('[data-action="resume-interrupted-expedition"]')).toBeEnabled();
    await expect(modal.locator('[data-action="abandon-interrupted-expedition"]')).toBeEnabled();
    expect([...runtimeErrors, ...reopenedErrors]).toEqual([]);
  });

  test('a mounted-candidate failure before the durable restart write preserves the exact checkpoint and restart counters', async ({ page, context }) => {
    test.setTimeout(150_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    const startupUrl = '/?dungeonSeed=interrupted-expedition-post-mount-rollback&reaverbotSeed=interrupted-expedition-post-mount-rollback';
    await page.goto(startupUrl);
    await waitForWorld(page, 'overworld');
    await beginBossExpedition(page, 'ascensionEngine');

    const checkpoint = await page.evaluate(async () => {
      const { game } = window;
      const expedition = game.busterLabStorage.getActiveBossExpedition();
      return game.busterLabStorage.recordBossCheckpoint({
        expeditionId: expedition.expeditionId,
        bossProfileId: expedition.bossProfileId,
        securedCheckpointIndex: 1,
        securedCheckpointId: 'ascensionCheckpoint:compressionFoundry',
        brokenSealIndex: 0,
      });
    });
    expect(checkpoint).toMatchObject({ ok: true });
    const checkpointed = await readInterruptedExpeditionSnapshot(page);
    expect(checkpointed.active.encounterProgress).toMatchObject({
      securedCheckpointIndex: 1,
      securedCheckpointId: 'ascensionCheckpoint:compressionFoundry',
    });

    await page.close();
    const reopened = await context.newPage();
    const reopenedErrors = attachRuntimeErrorCapture(reopened);
    await reopened.goto(startupUrl);
    await waitForWorld(reopened, 'overworld');
    const modal = await waitForInterruptedExpeditionPrompt(reopened);
    const before = await readInterruptedExpeditionSnapshot(reopened);
    expect(before.active).toEqual(checkpointed.active);

    await reopened.evaluate(() => {
      const { game } = window;
      const originalInstall = game._installRuntimeControllerForBundle.bind(game);
      game._installRuntimeControllerForBundle = (bundle) => {
        if (bundle?.worldKind === 'dungeon') {
          throw new Error('Injected post-mount controller installation failure');
        }
        return originalInstall(bundle);
      };
    });
    await modal.locator('[data-action="resume-interrupted-expedition"]').click();
    await expect(reopened.locator('#interrupted-expedition-error'))
      .toContainText('Injected post-mount controller installation failure');
    await expect.poll(async () => (await readWorldDiagnostics(reopened)).transitionState)
      .toBe('overworld');

    const after = await readInterruptedExpeditionSnapshot(reopened);
    expect(after.world).toMatchObject({
      worldKind: 'overworld',
      transitionState: 'overworld',
      activeRootId: before.world.activeRootId,
      planHash: before.world.planHash,
      generationCount: before.world.generationCount,
      disposalCount: before.world.disposalCount,
    });
    expect(after.active).toEqual(before.active);
    expect(after.active.encounterProgress).toEqual(checkpointed.active.encounterProgress);
    expect(after.active.restartCount).toBe(checkpointed.active.restartCount);
    expect(after.storageRevision).toBe(before.storageRevision);
    expect(after.storageWriteId).toBe(before.storageWriteId);
    await expect(modal).toBeVisible();
    expect([...runtimeErrors, ...reopenedErrors]).toEqual([]);
  });

  test('an interrupted depth-four expedition reconstructs the same depth-aware V1 plan', async ({ page, context }) => {
    test.setTimeout(150_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    const startupUrl = '/?dungeonSeed=interrupted-expedition-depth-four&reaverbotSeed=interrupted-expedition-depth-four';
    await page.goto(startupUrl);
    await waitForWorld(page, 'overworld');

    // This is fixture setup for a later-floor durable contract. Expedition
    // entry and recovery themselves still run only through public modal input.
    await page.evaluate(() => {
      window.game.ruinFloor = 4;
    });
    await beginBossExpedition(page, 'revolvingFusillade');
    const entered = await readInterruptedExpeditionSnapshot(page);
    expect(entered.active).toMatchObject({
      depth: 4,
      dungeonLayoutSeed: 'layout:interrupted-expedition-depth-four',
    });
    expect(entered.world.planHash)
      .toBe('v1:layout:interrupted-expedition-depth-four:depth:4:revolvingFusillade');

    await page.close();
    const reopened = await context.newPage();
    const reopenedErrors = attachRuntimeErrorCapture(reopened);
    await reopened.goto(startupUrl);
    await waitForWorld(reopened, 'overworld');
    await waitForInterruptedExpeditionPrompt(reopened);
    await resumeInterruptedExpedition(reopened);
    const restarted = await readInterruptedExpeditionSnapshot(reopened);
    const generated = await reopened.evaluate(() => ({
      ruinFloor: window.game.ruinFloor,
      layoutSeed: window.game.dungeon.layoutSeed,
      bossProfileId: window.game.dungeon.encounters.find(({ isBoss }) => isBoss)?.bossProfileId ?? null,
      expeditionDepth: window.game.dungeon.encounters.find(({ isBoss }) => isBoss)?.expeditionSpec?.depth ?? null,
    }));
    expect(restarted.world.planHash).toBe(entered.world.planHash);
    expect(restarted.active).toMatchObject({
      expeditionId: entered.active.expeditionId,
      bossProfileId: entered.active.bossProfileId,
      seed: entered.active.seed,
      depth: 4,
      dungeonLayoutSeed: entered.active.dungeonLayoutSeed,
    });
    expect(generated).toEqual({
      ruinFloor: 4,
      layoutSeed: 'layout:interrupted-expedition-depth-four',
      bossProfileId: 'revolvingFusillade',
      expeditionDepth: 4,
    });
    expect([...runtimeErrors, ...reopenedErrors]).toEqual([]);
  });

  test('a committed boss victory still prompts after reload and abandonment preserves its recovery while unlocking selection', async ({ page, context }) => {
    test.setTimeout(150_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    const startupUrl = '/?dungeonSeed=interrupted-expedition-victory&reaverbotSeed=interrupted-expedition-victory';
    const profileId = 'revolvingFusillade';
    await page.goto(startupUrl);
    await waitForWorld(page, 'overworld');
    await beginBossExpedition(page, profileId);

    // A full boss fight is covered by the V1 journey. Here the real durable
    // victory command creates the narrow post-victory/pre-extraction fixture.
    const victory = await page.evaluate(async () => {
      const { game } = window;
      const expedition = game.busterLabStorage.getActiveBossExpedition();
      return game.busterLabStorage.recordBossVictory({
        expeditionId: expedition.expeditionId,
        bossProfileId: expedition.bossProfileId,
        signaturePartOverloaded: false,
      });
    });
    expect(victory).toMatchObject({ ok: true, firstClear: true, rewardQueued: true });
    const victorious = await readInterruptedExpeditionSnapshot(page);
    expect(victorious.active).toMatchObject({
      status: 'victory',
      bossProfileId: profileId,
    });
    expect(victorious.activeExpeditionId).toBe(victorious.active.expeditionId);
    expect(victorious.pendingRecoveries).toHaveLength(1);

    await page.close();
    const reopened = await context.newPage();
    const reopenedErrors = attachRuntimeErrorCapture(reopened);
    await reopened.goto(startupUrl);
    await waitForWorld(reopened, 'overworld');
    const modal = await waitForInterruptedExpeditionPrompt(reopened);
    await expect(modal).toHaveAttribute('data-expedition-id', victorious.active.expeditionId);
    const beforeAbandon = await readInterruptedExpeditionSnapshot(reopened);
    expect(beforeAbandon.active).toEqual(victorious.active);

    await abandonInterruptedExpedition(reopened);
    const abandoned = await reopened.evaluate((expeditionId) => {
      const { game } = window;
      const hunts = game.busterLabStorage.getBossHuntState();
      return structuredClone({
        activeExpeditionId: hunts.activeExpeditionId,
        record: hunts.recordedExpeditions[expeditionId],
        pendingRecoveries: hunts.pendingRecoveries,
        victoryCount: hunts.victoriesByProfile.revolvingFusillade ?? 0,
        locked: game.getBossHuntViewModel().locked,
      });
    }, victorious.active.expeditionId);
    expect(abandoned.activeExpeditionId).toBeNull();
    expect(abandoned.record).toEqual(victorious.active);
    expect(abandoned.pendingRecoveries).toEqual(victorious.pendingRecoveries);
    expect(abandoned.victoryCount).toBe(1);
    expect(abandoned.locked).toBe(false);

    const bossModal = await openExteriorBossModal(reopened);
    await expect(bossModal).toBeVisible();
    const cancel = bossModal.locator('[data-action="cancel-expedition"]');
    await expect(cancel).toHaveCount(1);
    await cancel.click();
    await expect(bossModal).toBeHidden();
    expect([...runtimeErrors, ...reopenedErrors]).toEqual([]);
  });

  test('a stale recovery prompt reloads durable state after another tab abandons the expedition', async ({ page, context }) => {
    test.setTimeout(150_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    const startupUrl = '/?dungeonSeed=interrupted-expedition-cross-tab&reaverbotSeed=interrupted-expedition-cross-tab';
    await page.goto(startupUrl);
    await waitForWorld(page, 'overworld');
    await beginBossExpedition(page, 'revolvingFusillade');
    await page.close();

    const resolver = await context.newPage();
    const resolverErrors = attachRuntimeErrorCapture(resolver);
    await resolver.goto(startupUrl);
    await waitForWorld(resolver, 'overworld');
    await waitForInterruptedExpeditionPrompt(resolver);

    const stale = await context.newPage();
    const staleErrors = attachRuntimeErrorCapture(stale);
    await stale.goto(startupUrl);
    await waitForWorld(stale, 'overworld');
    const staleModal = await waitForInterruptedExpeditionPrompt(stale);
    const staleBefore = await readWorldDiagnostics(stale);
    await stale.evaluate(() => {
      window.__interruptedReloadRefs = {
        labState: window.game.busterLabState,
        rollSalvageStorage: window.game.rollSalvageStorage,
        busterLabPlans: window.game.busterLabPlans,
      };
    });

    await abandonInterruptedExpedition(resolver);
    await stale.waitForFunction(() => (
      window.game.busterLabStorage.getPersistenceStatus().writePauseReason === 'external-conflict'
    ));
    await staleModal.locator('[data-action="resume-interrupted-expedition"]').click();
    await expect(staleModal).toBeHidden();

    const staleAfter = await readWorldDiagnostics(stale);
    expect(staleAfter).toMatchObject({
      worldKind: 'overworld',
      transitionState: 'overworld',
      activeRootId: staleBefore.activeRootId,
      planHash: staleBefore.planHash,
      generationCount: staleBefore.generationCount,
      disposalCount: staleBefore.disposalCount,
    });
    expect(staleAfter.eventLog.map(({ event }) => event))
      .toContain('interrupted-expedition-resolved-externally');
    expect(await stale.evaluate(() => (
      window.game.busterLabStorage.getActiveBossExpedition()
    ))).toBeNull();
    expect(await stale.evaluate(() => ({
      stateMatchesDurable: window.game.busterLabState === window.game.busterLabStorage.state,
      salvageStorageRebuilt: window.game.rollSalvageStorage
        !== window.__interruptedReloadRefs.rollSalvageStorage,
      busterPlansRecompiled: !window.game.busterLabEnabled
        || window.game.busterLabPlans !== window.__interruptedReloadRefs.busterLabPlans,
      selectedBossProfileId: window.game.getSelectedBossProfileId(),
      durableBossProfileId: window.game.busterLabStorage.state.bossHunts.selectedBossProfileId,
    }))).toEqual({
      stateMatchesDurable: true,
      salvageStorageRebuilt: true,
      busterPlansRecompiled: true,
      selectedBossProfileId: 'revolvingFusillade',
      durableBossProfileId: 'revolvingFusillade',
    });
    expect([...runtimeErrors, ...resolverErrors, ...staleErrors]).toEqual([]);
  });

  test('a stale prompt cannot abandon a replacement Boss Hunt created in another tab', async ({ page, context }) => {
    test.setTimeout(180_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    const startupUrl = '/?dungeonSeed=interrupted-expedition-replaced&reaverbotSeed=interrupted-expedition-replaced';
    await page.goto(startupUrl);
    await waitForWorld(page, 'overworld');
    await beginBossExpedition(page, 'revolvingFusillade');
    await page.close();

    const resolver = await context.newPage();
    const resolverErrors = attachRuntimeErrorCapture(resolver);
    await resolver.goto(startupUrl);
    await waitForWorld(resolver, 'overworld');
    const resolverPrompt = await waitForInterruptedExpeditionPrompt(resolver);
    const originalExpeditionId = await resolverPrompt.getAttribute('data-expedition-id');

    const stale = await context.newPage();
    const staleErrors = attachRuntimeErrorCapture(stale);
    await stale.goto(startupUrl);
    await waitForWorld(stale, 'overworld');
    const staleModal = await waitForInterruptedExpeditionPrompt(stale);
    await expect(staleModal).toHaveAttribute('data-expedition-id', originalExpeditionId);

    await abandonInterruptedExpedition(resolver);
    await beginBossExpedition(resolver, 'pursuitRegent');
    const replacement = await readInterruptedExpeditionSnapshot(resolver);
    expect(replacement.active).toMatchObject({
      status: 'active',
      bossProfileId: 'pursuitRegent',
    });
    expect(replacement.active.expeditionId).not.toBe(originalExpeditionId);

    await stale.waitForFunction(() => (
      window.game.busterLabStorage.getPersistenceStatus().writePauseReason === 'external-conflict'
    ));
    await staleModal.locator('[data-action="abandon-interrupted-expedition"]').click();

    await expect(staleModal).toBeVisible();
    await expect(staleModal).toHaveAttribute('data-expedition-id', replacement.active.expeditionId);
    await expect(staleModal).toHaveAttribute('data-boss-profile-id', 'pursuitRegent');
    await expect(stale.locator('#interrupted-expedition-error'))
      .toContainText('changed in another window');
    const refreshed = await readInterruptedExpeditionSnapshot(stale);
    expect(refreshed.world).toMatchObject({
      worldKind: 'overworld',
      transitionState: 'overworld',
    });
    expect(refreshed.active).toEqual(replacement.active);
    expect(refreshed.activeExpeditionId).toBe(replacement.active.expeditionId);
    expect(refreshed.selectedBossProfileId).toBe('pursuitRegent');
    expect(refreshed.world.eventLog.map(({ event }) => event))
      .toContain('interrupted-expedition-identity-changed');
    expect([...runtimeErrors, ...resolverErrors, ...staleErrors]).toEqual([]);
  });

  test('a simultaneous cross-tab abandonment resolves a restart already rebuilding its dungeon', async ({ page, context }) => {
    test.setTimeout(180_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    const startupUrl = '/?dungeonSeed=interrupted-expedition-cross-tab-race&reaverbotSeed=interrupted-expedition-cross-tab-race';
    await page.goto(startupUrl);
    await waitForWorld(page, 'overworld');
    await beginBossExpedition(page, 'revolvingFusillade');
    await page.close();

    const resolver = await context.newPage();
    const resolverErrors = attachRuntimeErrorCapture(resolver);
    await resolver.goto(startupUrl);
    await waitForWorld(resolver, 'overworld');
    await waitForInterruptedExpeditionPrompt(resolver);

    const stale = await context.newPage();
    const staleErrors = attachRuntimeErrorCapture(stale);
    await stale.goto(startupUrl);
    await waitForWorld(stale, 'overworld');
    const staleModal = await waitForInterruptedExpeditionPrompt(stale);
    const staleBefore = await readWorldDiagnostics(stale);

    // Hold the stale tab at its last durable operation. This preserves the
    // public UI flow while deterministically placing the other tab's abandon
    // after candidate assembly and before the restart commit.
    await stale.evaluate(() => {
      const storage = window.game.busterLabStorage;
      const originalRestart = storage.restartActiveBossExpedition.bind(storage);
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      window.__interruptedExpeditionRace = { entered: false, release };
      storage.restartActiveBossExpedition = async (...args) => {
        window.__interruptedExpeditionRace.entered = true;
        await gate;
        return originalRestart(...args);
      };
    });
    await staleModal.locator('[data-action="resume-interrupted-expedition"]').click();
    await stale.waitForFunction(() => window.__interruptedExpeditionRace?.entered === true);

    await abandonInterruptedExpedition(resolver);
    await stale.waitForFunction(() => (
      window.game.busterLabStorage.getPersistenceStatus().writePauseReason === 'external-conflict'
    ));
    await stale.evaluate(() => window.__interruptedExpeditionRace.release());

    await stale.waitForFunction(() => (
      window.game.worldKind === 'overworld'
      && window.game.transitionState === 'overworld'
    ));
    await expect(staleModal).toBeHidden();
    const staleAfter = await readWorldDiagnostics(stale);
    expect(staleAfter).toMatchObject({
      worldKind: 'overworld',
      transitionState: 'overworld',
      activeRootId: staleBefore.activeRootId,
      planHash: staleBefore.planHash,
      generationCount: staleBefore.generationCount,
    });
    expect(staleAfter.eventLog.map(({ event }) => event))
      .toContain('interrupted-expedition-resolved-externally');
    expect(await stale.evaluate(() => (
      window.game.busterLabStorage.getActiveBossExpedition()
    ))).toBeNull();
    expect([...runtimeErrors, ...resolverErrors, ...staleErrors]).toEqual([]);
  });

  test('a streamed conventional V1 expedition begins on its authored entrance floor and walks inward without jumping', async ({ page }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    await page.goto('/?dungeonSeed=overworld-v1-entry-continuity&reaverbotSeed=overworld-v1-entry-continuity');
    await waitForWorld(page, 'overworld');
    await beginBossExpedition(page, 'revolvingFusillade');

    const before = await page.evaluate(() => ({
      position: window.game.player.root.position.toArray(),
      authoredEntry: window.game.dungeon.ruinEntryPosition.toArray(),
      entranceDoorPosition: window.game.activeWorldBundle.entranceDoor.position.toArray(),
      entranceDoorClosed: window.game.activeWorldBundle.entranceDoor.closed,
      entranceDoorCollisionHeight: window.game.activeWorldBundle.entranceDoor.collisionHeight,
    }));
    expect(before.position[0]).toBeCloseTo(before.authoredEntry[0], 3);
    expect(before.position[1]).toBeCloseTo(before.authoredEntry[1], 3);
    expect(before.position[2]).toBeCloseTo(before.authoredEntry[2], 3);
    expect(before.entranceDoorPosition[2]).toBeCloseTo(before.position[2] - 2.55, 1);
    expect(before.entranceDoorClosed).toBe(true);
    expect(before.entranceDoorCollisionHeight).toBeGreaterThan(12);

    const samples = [];
    await page.keyboard.down('KeyW');
    try {
      for (let sample = 0; sample < 12; sample += 1) {
        await page.waitForTimeout(500);
        samples.push(await page.evaluate(() => window.game.player.root.position.toArray()));
      }
    } finally {
      await page.keyboard.up('KeyW');
    }
    await page.waitForTimeout(250);

    const after = await page.evaluate(() => ({
      position: window.game.player.root.position.toArray(),
      airborne: window.game.player.isJumpAirborne?.() === true,
      ledgeClinging: window.game.player.isLedgeClinging?.() === true,
      worldKind: window.game.worldKind,
    }));
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index][2]).toBeGreaterThanOrEqual(samples[index - 1][2] - 0.01);
    }
    expect(after.position[2] - before.position[2]).toBeGreaterThan(7.5);
    expect(Math.abs(after.position[0] - before.position[0])).toBeLessThan(0.1);
    expect(Math.abs(after.position[1] - before.position[1])).toBeLessThan(0.1);
    expect(after).toMatchObject({
      airborne: false,
      ledgeClinging: false,
      worldKind: 'dungeon',
    });

    // Return to the inside face using only public movement, then prove the
    // full-height seal cannot be crossed or vaulted.
    const sealSamples = [];
    await page.keyboard.down('KeyS');
    try {
      for (let sample = 0; sample < 24; sample += 1) {
        await page.waitForTimeout(500);
        sealSamples.push(await page.evaluate(() => window.game.player.root.position.toArray()));
      }
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await page.keyboard.press('Space');
        await page.waitForTimeout(700);
        sealSamples.push(await page.evaluate(() => window.game.player.root.position.toArray()));
      }
    } finally {
      await page.keyboard.up('KeyS');
    }
    const sealState = await page.evaluate(() => ({
      position: window.game.player.root.position.toArray(),
      worldKind: window.game.worldKind,
      collisionHeight: window.game.activeWorldBundle.entranceDoor.collisionHeight,
      doorZ: window.game.activeWorldBundle.entranceDoor.position.z,
    }));
    const minimumZ = Math.min(...sealSamples.map((position) => position[2]));
    expect(minimumZ).toBeGreaterThan(sealState.doorZ + 0.4);
    expect(minimumZ).toBeLessThan(sealState.doorZ + 2);
    expect(sealState.collisionHeight).toBeGreaterThan(12);
    expect(sealState.worldKind).toBe('dungeon');
    expect(runtimeErrors).toEqual([]);
  });

  for (const failure of ENTRY_ROLLBACK_FAILURES) {
    test(`entry rollback keeps the intact overworld after ${failure.name} failure`, async ({ page }) => {
      const runtimeErrors = attachRuntimeErrorCapture(page);
      await page.goto('/');
      await waitForWorld(page, 'overworld');
      const before = await readWorldDiagnostics(page);
      const beforeState = await page.evaluate(() => {
        const { game } = window;
        Object.assign(game.player.barrier, {
          capacity: 25,
          current: 7,
          rechargeDelayRemaining: 999,
          broken: false,
          recharging: false,
        });
        return {
          selectedProfileId: game.getSelectedBossProfileId(),
          activeExpedition: game.busterLabStorage?.getActiveBossExpedition?.() ?? null,
          player: {
            health: game.player.health,
            barrier: {
              capacity: game.player.barrier.capacity,
              current: game.player.barrier.current,
              broken: game.player.barrier.broken,
              recharging: game.player.barrier.recharging,
            },
          },
        };
      });
      expect(beforeState.activeExpedition).toBeNull();

      const modal = await openExteriorBossModal(page);
      const stagedProfileId = await modal.locator('[data-boss-profile-id]').evaluateAll(
        (cards, selectedProfileId) => (
          cards.map((card) => card.dataset.bossProfileId)
            .find((profileId) => profileId && profileId !== selectedProfileId)
          ?? cards[0]?.dataset.bossProfileId
          ?? null
        ),
        beforeState.selectedProfileId,
      );
      expect(stagedProfileId).toBeTruthy();
      await modal.locator(`[data-boss-profile-id="${stagedProfileId}"]`).click();
      await expect(modal).toHaveAttribute('data-staged-boss-profile-id', stagedProfileId);
      const transactionPosition = await page.evaluate(() => window.game.player.root.position.toArray());

      await page.evaluate(failure.install);
      await modal.locator('[data-action="begin-expedition"]').click();
      await expect(page.locator('#boss-expedition-error')).toContainText(failure.message);
      await expect(modal).toBeVisible();
      await expect.poll(async () => (await readWorldDiagnostics(page)).transitionState).toBe('overworld');

      const after = await readWorldDiagnostics(page);
      const afterState = await page.evaluate(() => ({
        selectedProfileId: window.game.getSelectedBossProfileId(),
        activeExpedition: window.game.busterLabStorage?.getActiveBossExpedition?.() ?? null,
        player: {
          health: window.game.player.health,
          barrier: {
            capacity: window.game.player.barrier.capacity,
            current: window.game.player.barrier.current,
            broken: window.game.player.barrier.broken,
            recharging: window.game.player.barrier.recharging,
          },
          position: window.game.player.root.position.toArray(),
        },
      }));
      const root = await getActiveRootSummary(page);
      const rejectedCandidate = await page.evaluate(() => {
        const bundle = window.__rejectedStreamedDungeonCandidate;
        return bundle ? {
          disposed: bundle.disposed,
          attached: Boolean(bundle.root?.parent),
        } : null;
      });
      expect(after).toMatchObject({
        worldKind: 'overworld',
        transitionState: 'overworld',
        activeRootId: before.activeRootId,
        planHash: before.planHash,
        generationCount: before.generationCount,
        disposalCount: before.disposalCount,
      });
      expect(afterState.selectedProfileId).toBe(beforeState.selectedProfileId);
      expect(afterState.activeExpedition).toBeNull();
      expect(afterState.player.health).toBe(beforeState.player.health);
      expect(afterState.player.barrier).toEqual(beforeState.player.barrier);
      expect(afterState.player.position[0]).toBeCloseTo(transactionPosition[0], 4);
      expect(afterState.player.position[1]).toBeCloseTo(transactionPosition[1], 4);
      expect(afterState.player.position[2]).toBeCloseTo(transactionPosition[2], 4);
      expect(root.rootId).toBe(before.activeRootId);
      expect(root.counts[OVERWORLD_OBJECT_NAMES.roll]).toBe(1);
      expect(root.counts[OVERWORLD_OBJECT_NAMES.supportCar]).toBe(1);
      expect(root.counts[OVERWORLD_OBJECT_NAMES.door]).toBe(1);
      if (failure.name === 'V1 streamed adapter preparation') {
        expect(rejectedCandidate).toEqual({ disposed: true, attached: false });
      }
      expect(runtimeErrors).toEqual([]);
    });
  }

  test('entry rollback restores the overworld even when durable compensation rejects', async ({ page }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    await page.goto('/');
    await waitForWorld(page, 'overworld');
    const before = await readWorldDiagnostics(page);
    const modal = await openExteriorBossModal(page);
    const card = modal.locator('[data-boss-profile-id]').first();
    await card.click();
    await page.evaluate(() => {
      const { game } = window;
      const originalTransition = game._transitionWorldLifecycleTo.bind(game);
      game._transitionWorldLifecycleTo = (nextState) => {
        if (nextState === 'dungeon') {
          game._transitionWorldLifecycleTo = originalTransition;
          throw new Error('Injected post-lock commit failure');
        }
        return originalTransition(nextState);
      };
      game.busterLabStorage.completeBossExpedition = async () => {
        throw new Error('Injected rollback compensation failure');
      };
    });
    await modal.locator('[data-action="begin-expedition"]').click();
    await expect(page.locator('#boss-expedition-error')).toContainText('Injected post-lock commit failure');
    await expect.poll(async () => (await readWorldDiagnostics(page)).transitionState).toBe('overworld');

    const after = await readWorldDiagnostics(page);
    expect(after).toMatchObject({
      worldKind: 'overworld',
      transitionState: 'overworld',
      activeRootId: before.activeRootId,
      generationCount: before.generationCount,
      disposalCount: before.disposalCount,
    });
    expect(after.eventLog.some(({ event }) => event === 'rollback-compensation-error')).toBe(true);
    expect(runtimeErrors).toEqual([]);
  });

  for (const failure of RETURN_ROLLBACK_FAILURES) {
    test(`return rollback preserves the sealed dungeon after ${failure.name} failure`, async ({ page }) => {
      test.setTimeout(120_000);
      const runtimeErrors = attachRuntimeErrorCapture(page);
      await page.goto('/');
      await waitForWorld(page, 'overworld');
      await beginFirstBossExpedition(page);

      await page.evaluate(() => {
        Object.assign(window.game.player.barrier, {
          capacity: 30,
          current: 9,
          rechargeDelayRemaining: 999,
          broken: false,
          recharging: false,
        });
      });
      const before = await readWorldDiagnostics(page);
      const beforeState = await page.evaluate(() => ({
        activeExpedition: structuredClone(window.game.busterLabStorage.getActiveBossExpedition()),
        health: window.game.player.health,
        barrier: {
          capacity: window.game.player.barrier.capacity,
          current: window.game.player.barrier.current,
          broken: window.game.player.barrier.broken,
          recharging: window.game.player.barrier.recharging,
        },
        position: window.game.player.root.position.toArray(),
        expeditionAccepted: window.game.expeditionAccepted,
        expeditionActive: window.game.expeditionActive,
        ruinCompleted: window.game.ruinCompleted,
        activeBossExpeditionSpec: structuredClone(window.game.activeBossExpeditionSpec),
        lastExpeditionSummary: window.game.lastExpeditionSummary,
      }));
      expect(beforeState.activeExpedition?.status).toBe('active');

      await page.evaluate(failure.install);
      const returnAnchor = before.entryReturnAnchor;
      expect(returnAnchor).toHaveLength(3);
      await walkToWorldPosition(page, { x: returnAnchor[0], z: returnAnchor[2] }, {
        stopDistance: 0.9,
        timeout: 45_000,
        stepMilliseconds: 75,
      });
      await page.waitForFunction(() => window.game.player.velocity.lengthSq() < 0.0001);
      beforeState.position = await page.evaluate(() => window.game.player.root.position.toArray());
      await page.keyboard.press('KeyE');
      const modal = page.locator('[data-expedition-abandon-modal]');
      await expect(modal).toBeVisible();
      await modal.locator('[data-action="confirm-abandon-expedition"]').click();
      await expect(page.locator('#expedition-abandon-error')).toContainText(failure.message);
      await expect.poll(async () => (await readWorldDiagnostics(page)).transitionState).toBe('dungeon');

      const after = await readWorldDiagnostics(page);
      const afterState = await page.evaluate(() => ({
        activeExpedition: structuredClone(window.game.busterLabStorage.getActiveBossExpedition()),
        health: window.game.player.health,
        barrier: {
          capacity: window.game.player.barrier.capacity,
          current: window.game.player.barrier.current,
          broken: window.game.player.barrier.broken,
          recharging: window.game.player.barrier.recharging,
        },
        position: window.game.player.root.position.toArray(),
        expeditionAccepted: window.game.expeditionAccepted,
        expeditionActive: window.game.expeditionActive,
        ruinCompleted: window.game.ruinCompleted,
        activeBossExpeditionSpec: structuredClone(window.game.activeBossExpeditionSpec),
        lastExpeditionSummary: window.game.lastExpeditionSummary,
      }));
      expect(after).toMatchObject({
        worldKind: 'dungeon',
        transitionState: 'dungeon',
        activeRootId: before.activeRootId,
        planHash: before.planHash,
        generationCount: before.generationCount,
        disposalCount: before.disposalCount,
      });
      const afterPosition = afterState.position;
      const beforePosition = beforeState.position;
      delete afterState.position;
      delete beforeState.position;
      expect(afterState).toEqual(beforeState);
      expect(Math.hypot(
        afterPosition[0] - beforePosition[0],
        afterPosition[1] - beforePosition[1],
        afterPosition[2] - beforePosition[2],
      )).toBeLessThan(0.05);
      expect(runtimeErrors).toEqual([]);
    });
  }

  test('abandoning through the inside entrance reconstructs the identical overworld', async ({ page }) => {
    const runtimeErrors = attachRuntimeErrorCapture(page);
    await page.goto('/');
    await waitForWorld(page, 'overworld');
    const initial = await readWorldDiagnostics(page);
    await beginFirstBossExpedition(page);
    const dungeon = await readWorldDiagnostics(page);

    // The authored spawn is deliberately well inside the entrance chamber;
    // abandonment must not be available until public movement returns to the
    // physical inside face of the sealed door.
    await page.keyboard.press('KeyE');
    await expect(page.locator('[data-expedition-abandon-modal]')).toBeHidden();

    await abandonExpeditionThroughEntrance(page);
    const returned = await readWorldDiagnostics(page);
    const root = await getActiveRootSummary(page);

    expect(returned.worldKind).toBe('overworld');
    expect(returned.transitionState).toBe('overworld');
    expect(returned.planHash).toBe(initial.planHash);
    expect(returned.activeRootId).not.toBe(dungeon.activeRootId);
    expect(returned.generationCount).toBe(initial.generationCount + 2);
    expect(returned.disposalCount).toBe(initial.disposalCount + 2);
    expect(returned.lastDisposalStats).toBeTruthy();
    expect(root.planHash).toBe(initial.planHash);
    expect(root.counts[OVERWORLD_OBJECT_NAMES.roll]).toBe(1);
    expect(root.counts[OVERWORLD_OBJECT_NAMES.supportCar]).toBe(1);
    expect(returned.eventLog.map(({ event }) => event)).toContain('bundle-disposed');
    expect(returned.eventLog.map(({ event, to }) => `${event}:${to ?? ''}`)).toContain('transition:overworld');
    expect(runtimeErrors).toEqual([]);
  });

  test('cancelling at the inside entrance leaves the sealed dungeon unchanged', async ({ page }) => {
    const runtimeErrors = attachRuntimeErrorCapture(page);
    await page.goto('/');
    await waitForWorld(page, 'overworld');
    await beginFirstBossExpedition(page);
    const before = await readWorldDiagnostics(page);

    const modal = await openDungeonAbandonModalThroughEntrance(page);
    await modal.locator('[data-action="cancel-abandon-expedition"]').click();
    await expect(modal).toBeHidden();

    const after = await readWorldDiagnostics(page);
    const entrance = await page.evaluate(() => {
      const state = window.game.getPublicDungeonJourneyDiagnostics({ includeGeometry: false });
      return structuredClone({
        door: state?.doors?.find(({ id }) => (
          id === 'streamedDungeonEntranceDoor' || id === 'streamedAscensionEntranceDoor'
        )) ?? null,
        activeExpedition: window.game.busterLabStorage?.getActiveBossExpedition?.() ?? null,
      });
    });
    expect(after).toMatchObject({
      worldKind: 'dungeon',
      transitionState: 'dungeon',
      activeRootId: before.activeRootId,
      planHash: before.planHash,
      generationCount: before.generationCount,
      disposalCount: before.disposalCount,
    });
    expect(entrance.door).toMatchObject({ closed: true, opened: false });
    expect(entrance.activeExpedition).toBeTruthy();
    expect(runtimeErrors).toEqual([]);
  });

  test('extraction waits for boss recovery and preserves secured rewards (runtime contract, not a completion journey)', async ({ page }) => {
    const runtimeErrors = attachRuntimeErrorCapture(page);
    await page.goto('/');
    await waitForWorld(page, 'overworld');
    const conventionalProfileId = await page.evaluate(() => (
      window.game.getBossHuntViewModel().profiles.find(({ id }) => id !== 'ascensionEngine')?.id
        ?? null
    ));
    expect(conventionalProfileId).toBeTruthy();
    await beginBossExpedition(page, conventionalProfileId);
    const dungeon = await readWorldDiagnostics(page);

    const result = await page.evaluate(async () => {
      const { game } = window;
      const profileId = game.getSelectedBossProfileId();
      const profileBefore = game.getBossHuntViewModel().profiles.find(({ id }) => id === profileId);
      const goldBefore = game.inventory.gold;
      const refractorsBefore = game.largeRefractorsSecured;
      const bundle = game.activeWorldBundle;
      const expeditionSpec = game.activeBossExpeditionSpec;
      const storage = game.busterLabStorage;
      const recordBossVictory = storage.recordBossVictory.bind(storage);
      let durableVictoryFinished = false;

      // Delay the real durable command so this test proves the world cannot
      // unload merely because the in-memory boss encounter has completed.
      storage.recordBossVictory = async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        const victory = await recordBossVictory(...args);
        durableVictoryFinished = true;
        return victory;
      };

      const pendingVictory = game._trackBossVictoryCommit(game._recordBossVictory({
        id: 'overworld-extraction-contract-boss',
        bossProfileId: profileId,
        bossProfile: profileBefore,
        expeditionSpec,
        signaturePartOverloaded: true,
        debugBoss: false,
      }, { present: false, originBundle: bundle }), bundle);
      const objectiveCommitted = game.completeRuinObjective({
        reward: 321,
        label: 'Extraction contract Refractor',
      });
      const transition = await game.extractToCamp();
      const victory = await pendingVictory;
      const profileAfter = game.getBossHuntViewModel().profiles.find(({ id }) => id === profileId);
      return {
        transition,
        victory: {
          ok: victory?.ok ?? false,
          reason: victory?.reason ?? null,
        },
        objectiveCommitted,
        durableVictoryFinished,
        profileId,
        victoryCountBefore: profileBefore?.victoryCount ?? 0,
        victoryCountAfter: profileAfter?.victoryCount ?? 0,
        goldBefore,
        goldAfter: game.inventory.gold,
        refractorsBefore,
        refractorsAfter: game.largeRefractorsSecured,
        activeExpedition: storage.getActiveBossExpedition(),
        lastExpeditionSummary: game.lastExpeditionSummary,
      };
    });
    expect(result.transition).toMatchObject({
      ok: true,
      worldKind: 'overworld',
      outcome: 'extracted',
    });
    await waitForWorld(page, 'overworld');
    const returned = await readWorldDiagnostics(page);
    const root = await getActiveRootSummary(page);

    expect(result.victory.ok).toBe(true);
    expect(result.objectiveCommitted).toBe(true);
    expect(result.durableVictoryFinished).toBe(true);
    expect(result.victoryCountAfter).toBe(result.victoryCountBefore + 1);
    expect(result.goldAfter).toBe(result.goldBefore + 321);
    expect(result.refractorsAfter).toBe(result.refractorsBefore + 1);
    expect(result.activeExpedition).toBeNull();
    expect(result.lastExpeditionSummary).toContain('Expedition complete');
    expect(returned).toMatchObject({
      worldKind: 'overworld',
      transitionState: 'overworld',
      generationCount: dungeon.generationCount + 1,
      disposalCount: dungeon.disposalCount + 1,
    });
    expect(root.rootName).toBe(OVERWORLD_OBJECT_NAMES.root);
    expect(root.counts[OVERWORLD_OBJECT_NAMES.roll]).toBe(1);
    expect(root.counts[OVERWORLD_OBJECT_NAMES.supportCar]).toBe(1);
    expect(runtimeErrors).toEqual([]);
  });

  test('all trail circuits and authored landmarks are physically visitable without traversal correction', async ({ page }, testInfo) => {
    test.setTimeout(600_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    await page.goto('/');
    await waitForWorld(page, 'overworld');
    await waitForOverworldAssetsSettled(page);
    await page.screenshot({ path: testInfo.outputPath('overworld-camp-visual.png'), fullPage: false });
    expect(await readRuntimeLandmarkParity(page)).toEqual([]);
    const plan = await page.evaluate(() => {
      const source = window.game.overworldPlan;
      return structuredClone({
        trails: source.trails,
        houses: source.houses,
        trees: source.trees,
        blockers: source.blockers,
        landmarks: source.landmarks,
        regions: source.regions,
        anchors: source.anchors,
        terrain: {
          originX: source.terrain.originX,
          originZ: source.terrain.originZ,
          width: source.terrain.width,
          depth: source.terrain.depth,
          cellSize: source.terrain.cellSize,
          heightLevels: source.terrain.heightLevels,
        },
        vegetationChunkSize: source.chunkMetadata.vegetation.cullChunkWorldSize,
      });
    });
    const byId = Object.fromEntries(plan.trails.map((trail) => [trail.id, trail.points]));
    const densifyTrail = (points, maximumSpacing = 2) => points.flatMap((start, index) => {
      const end = points[index + 1];
      if (!end) return [start];
      const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / maximumSpacing));
      return Array.from({ length: steps }, (_, step) => {
        const amount = step / steps;
        return {
          x: start.x + (end.x - start.x) * amount,
          z: start.z + (end.z - start.z) * amount,
          level: start.level + (end.level - start.level) * amount,
        };
      });
    });
    const route = [
      ...densifyTrail(byId['village-meadow-loop']),
      ...densifyTrail(byId['forest-cabin-loop']),
      ...densifyTrail(byId['village-meadow-loop'].slice(0, 3)),
      ...densifyTrail(byId['highland-switchback-loop']),
    ];
    const nearestRouteIndex = (position) => route.reduce((bestIndex, point, index) => (
      horizontalDistance(position, point) < horizontalDistance(position, route[bestIndex])
        ? index
        : bestIndex
    ), 0);
    const terrainLevelAt = ({ x, z }) => {
      const cellX = Math.floor((x - plan.terrain.originX) / plan.terrain.cellSize);
      const cellZ = Math.floor((z - plan.terrain.originZ) / plan.terrain.cellSize);
      if (cellX < 0 || cellZ < 0 || cellX >= plan.terrain.width || cellZ >= plan.terrain.depth) {
        return null;
      }
      return plan.terrain.heightLevels[cellZ * plan.terrain.width + cellX];
    };
    const hasWalkableGroundSegment = (start, end) => {
      const distance = horizontalDistance(start, end);
      const steps = Math.max(1, Math.ceil(distance / (plan.terrain.cellSize * 0.45)));
      let previousLevel = terrainLevelAt(start);
      if (!Number.isFinite(previousLevel)) return false;
      for (let step = 1; step <= steps; step += 1) {
        const amount = step / steps;
        const sample = {
          x: start.x + (end.x - start.x) * amount,
          z: start.z + (end.z - start.z) * amount,
        };
        const level = terrainLevelAt(sample);
        if (!Number.isFinite(level) || Math.abs(level - previousLevel) > 1) return false;
        previousLevel = level;
      }
      return true;
    };
    const hasClearBlockerSegment = (start, end) => {
      const distance = horizontalDistance(start, end);
      const steps = Math.max(1, Math.ceil(distance / 0.35));
      for (let step = 0; step <= steps; step += 1) {
        const amount = step / steps;
        const sample = {
          x: start.x + (end.x - start.x) * amount,
          z: start.z + (end.z - start.z) * amount,
        };
        if (plan.blockers.some((other) => blockerContact(sample, other).penetration > 0)) {
          return false;
        }
      }
      return true;
    };
    const blockerById = new Map(plan.blockers.map((blocker) => [blocker.id, blocker]));
    const landmarkDetours = new Map();
    const addDetour = (routeIndex, detour) => {
      const entries = landmarkDetours.get(routeIndex) ?? [];
      entries.push(detour);
      landmarkDetours.set(routeIndex, entries);
    };

    for (const house of plan.houses) {
      const blocker = blockerById.get(`${house.id}-collision`);
      expect(blocker, `${house.id} must own its primary collider`).toBeTruthy();
      const approachChoice = [
        { x: blocker.x + 20, z: blocker.z },
        { x: blocker.x - 20, z: blocker.z },
        { x: blocker.x, z: blocker.z + 20 },
        { x: blocker.x, z: blocker.z - 20 },
      ].map((reference) => approachBlockerFrom(blocker, reference))
        .filter((approach) => plan.blockers.every((other) => {
          if (other.id === blocker.id) return true;
          const contact = blockerContact(approach, other);
          return contact.penetration === 0 && contact.boundaryDistance > 0.35;
        }))
        .map((approach) => {
          const routeIndex = nearestRouteIndex(approach);
          return {
            approach,
            routeIndex,
            distance: horizontalDistance(approach, route[routeIndex]),
          };
        })
        .filter(({ approach, routeIndex }) => (
          hasWalkableGroundSegment(route[routeIndex], approach)
          && hasClearBlockerSegment(route[routeIndex], approach)
        ))
        .sort((left, right) => left.distance - right.distance)[0];
      expect(approachChoice, `${house.id} needs one unobstructed collider approach`).toBeTruthy();
      addDetour(approachChoice.routeIndex, {
        kind: 'house',
        id: house.id,
        district: house.district,
        blocker,
        approach: approachChoice.approach,
      });
    }

    const forestTrail = byId['forest-cabin-loop'];
    const distanceToForestTrail = (tree) => Math.min(...forestTrail.slice(0, -1).map((start, index) => {
      const end = forestTrail[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthSquared = dx * dx + dz * dz;
      const amount = Math.max(0, Math.min(1, (
        (tree.x - start.x) * dx + (tree.z - start.z) * dz
      ) / lengthSquared));
      return Math.hypot(
        tree.x - (start.x + dx * amount),
        tree.z - (start.z + dz * amount),
      );
    }));
    const treeCandidates = plan.trees.map((tree) => ({
      tree,
      trailDistance: distanceToForestTrail(tree),
      nearestNeighbor: Math.min(...plan.trees
        .filter(({ id }) => id !== tree.id)
        .map((other) => horizontalDistance(tree, other))),
      chunkId: `${Math.floor((tree.x - plan.terrain.originX) / plan.vegetationChunkSize)},${Math.floor((tree.z - plan.terrain.originZ) / plan.vegetationChunkSize)}`,
    })).filter(({ nearestNeighbor }) => nearestNeighbor >= 4)
      .sort((left, right) => left.trailDistance - right.trailDistance);
    const selectedTreeChunks = new Set();
    const selectedTrees = [];
    for (const candidate of treeCandidates) {
      if (selectedTreeChunks.has(candidate.chunkId)) continue;
      selectedTreeChunks.add(candidate.chunkId);
      selectedTrees.push(candidate.tree);
      if (selectedTrees.length === 3) break;
    }
    expect(selectedTrees, 'three isolated tree samples must span distinct culling chunks').toHaveLength(3);
    for (const tree of selectedTrees) {
      const blocker = blockerById.get(`${tree.id}-collision`);
      const routeIndex = nearestRouteIndex(tree);
      addDetour(routeIndex, {
        kind: 'tree',
        id: tree.id,
        blocker,
        approach: approachBlockerFrom(blocker, route[routeIndex]),
      });
    }

    const hillOverlook = plan.landmarks.find(({ id }) => id === 'hill-overlook');
    const hillOverlookIndex = nearestRouteIndex(hillOverlook);
    const maximumRouteLevel = Math.max(...route.map(({ level = 0 }) => level));
    const highlandEdgeIndex = route.reduce((bestIndex, point, index) => {
      if ((point.level ?? 0) !== maximumRouteLevel) return bestIndex;
      if ((route[bestIndex].level ?? 0) !== maximumRouteLevel) return index;
      return Math.hypot(point.x, point.z) > Math.hypot(route[bestIndex].x, route[bestIndex].z)
        ? index
        : bestIndex;
    }, 0);
    const forestRegion = plan.regions.find(({ id }) => id === 'forest');
    const forestInterior = route.map((point, index) => ({
      index,
      point,
      treeCount: plan.trees.filter((tree) => horizontalDistance(tree, point) <= 12).length,
    })).filter(({ point }) => (
      point.x >= forestRegion.bounds.minX + 6
      && point.x <= forestRegion.bounds.maxX - 6
      && point.z >= forestRegion.bounds.minZ + 6
      && point.z <= forestRegion.bounds.maxZ - 6
    )).sort((left, right) => right.treeCount - left.treeCount)[0];
    expect(forestInterior.treeCount).toBeGreaterThanOrEqual(5);

    const carBlocker = plan.blockers.find(({ ownerId }) => ownerId === 'expeditionSupportCar');
    expect(carBlocker).toBeTruthy();
    // Stage on the authored vehicle's open northeast side. Route around its
    // rotated long axis first; a straight tank-control approach correctly
    // collides with the vehicle before reaching the contact-test staging point.
    const carReference = { x: carBlocker.x + 6, z: carBlocker.z + 6 };
    await walkToWorldPosition(page, { x: 5, z: 3 }, { stopDistance: 0.6, timeout: 12_000 });
    await walkToWorldPosition(page, carReference, { stopDistance: 0.6, timeout: 15_000 });
    await assertPublicColliderContact(
      page,
      carBlocker,
      approachBlockerFrom(carBlocker, carReference),
    );
    await walkToWorldPosition(page, { x: 5, z: 3 }, { stopDistance: 0.6, timeout: 12_000 });
    await walkToWorldPosition(page, plan.anchors.playerStart, { stopDistance: 0.5, timeout: 12_000 });

    const visitedRegions = new Set();
    const visitedHouses = new Set();
    const physicallySampledTrees = new Set();
    let forestInteriorVisited = false;
    let hillOverlookVisited = false;
    const noteRegions = (state) => {
      for (const region of plan.regions) {
        if (state.x >= region.bounds.minX && state.x <= region.bounds.maxX
          && state.z >= region.bounds.minZ && state.z <= region.bounds.maxZ) {
          visitedRegions.add(region.id);
        }
      }
    };
    let previous = await page.evaluate(() => ({
      x: window.game.player.root.position.x,
      y: window.game.player.root.position.y,
      z: window.game.player.root.position.z,
    }));
    noteRegions(previous);

    for (const [routeIndex, point] of route.entries()) {
      const reached = await walkToWorldPosition(page, point, {
        stopDistance: 1.6,
        timeout: 30_000,
        stepMilliseconds: 75,
      });
      const state = await readPlayerTraversalState(page);
      expect(reached.distance).toBeLessThanOrEqual(1.6);
      expect(Number.isFinite(state.groundY)).toBe(true);
      expect(Math.abs(state.y - state.groundY)).toBeLessThanOrEqual(0.08);
      expect(state.airborne).toBe(false);
      expect(state.ledgeClinging).toBe(false);
      // Route targets are densified to at most 2m. Including both 1.6m target
      // tolerances, a larger segment delta can only come from an external
      // reposition rather than ordinary public-input locomotion.
      expect(Math.hypot(state.x - previous.x, state.z - previous.z)).toBeLessThan(5.5);
      previous = state;
      noteRegions(state);
      if (routeIndex === forestInterior.index) {
        forestInteriorVisited = true;
        expect(visitedRegions.has('forest')).toBe(true);
        expect(plan.trees.filter((tree) => horizontalDistance(tree, state) <= 13.6).length).toBeGreaterThanOrEqual(5);
      }
      if (routeIndex === hillOverlookIndex) {
        hillOverlookVisited = true;
        expect(horizontalDistance(state, hillOverlook)).toBeLessThanOrEqual(1.7);
      }
      if (routeIndex === highlandEdgeIndex) {
        await page.waitForTimeout(250);
        const edgeCoverage = await page.evaluate(() => {
          const { game } = window;
          const root = game.activeWorldBundle.root;
          const horizon = root.getObjectByName('overworldVisualHorizon');
          root.updateMatrixWorld(true);
          game.camera.updateMatrixWorld(true);
          const Raycaster = game.raycaster.constructor;
          const Vector2 = game.pointerNdc.constructor;
          const rays = [];
          for (const y of [-0.92, -0.72, -0.52]) {
            for (const x of [-0.9, -0.45, 0, 0.45, 0.9]) {
              const raycaster = new Raycaster();
              raycaster.far = 120;
              raycaster.setFromCamera(new Vector2(x, y), game.camera);
              const hit = raycaster.intersectObject(root, true).find((candidate) => {
                let object = candidate.object;
                while (object && object !== root) {
                  if (!object.visible) return false;
                  object = object.parent;
                }
                const materials = Array.isArray(candidate.object.material)
                  ? candidate.object.material
                  : [candidate.object.material];
                return materials.some((material) => material?.visible !== false && material?.opacity !== 0);
              });
              rays.push({ x, y, hit: Boolean(hit), distance: hit?.distance ?? null, name: hit?.object?.name ?? null });
            }
          }
          const horizonMaterials = Array.isArray(horizon?.material) ? horizon.material : [horizon?.material];
          return {
            rays,
            horizonVisible: horizon?.visible === true,
            horizonTextured: horizonMaterials.every((material) => Boolean(material?.map)),
            horizonClearance: horizon?.userData?.horizon?.minimumOuterEdgeClearanceFromPlayableCore ?? 0,
          };
        });
        expect(edgeCoverage.horizonVisible).toBe(true);
        expect(edgeCoverage.horizonTextured).toBe(true);
        expect(edgeCoverage.horizonClearance).toBeGreaterThan(120);
        expect(edgeCoverage.rays.every(({ hit, distance }) => hit && distance <= 120)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath('overworld-highland-edge-qa.png'), fullPage: false });
      }

      for (const detour of landmarkDetours.get(routeIndex) ?? []) {
        const contact = await assertPublicColliderContact(page, detour.blocker, detour.approach);
        noteRegions(contact);
        if (detour.kind === 'house') {
          visitedHouses.add(detour.id);
          expect(visitedRegions.has(detour.district), `${detour.id} district was not physically visited`).toBe(true);
          expect(Math.abs(contact.y - contact.groundY)).toBeLessThanOrEqual(0.08);
          expect(contact.airborne).toBe(false);
          expect(contact.ledgeClinging).toBe(false);
        } else {
          physicallySampledTrees.add(detour.id);
        }
        await walkToWorldPosition(page, point, {
          stopDistance: 1,
          timeout: 25_000,
          stepMilliseconds: 65,
        });
        previous = await readPlayerTraversalState(page);
      }
    }
    expect(visitedRegions.has('camp')).toBe(true);
    expect(visitedRegions.has('village')).toBe(true);
    expect(forestInteriorVisited).toBe(true);
    expect(hillOverlookVisited).toBe(true);
    expect([...visitedHouses].sort()).toEqual(plan.houses.map(({ id }) => id).sort());
    expect(visitedHouses.has('forest-cabin')).toBe(true);
    expect(visitedHouses.has('hill-lodge')).toBe(true);
    expect(physicallySampledTrees.size).toBe(3);
    expect(runtimeErrors).toEqual([]);
  });

  test('every Boss Hunt profile streams into V1 and specialized entry seals are physical', async ({ page }) => {
    test.setTimeout(240_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    await page.goto('/');
    await waitForWorld(page, 'overworld');
    const profileIds = await page.evaluate(() => (
      window.game.getBossHuntViewModel().profiles.map(({ id }) => id)
    ));
    expect(profileIds.length).toBeGreaterThanOrEqual(9);

    for (const profileId of profileIds) {
      await beginBossExpedition(page, profileId);
      const contract = await page.evaluate(() => {
        const { game } = window;
        const root = game.activeWorldBundle.root;
        const encounter = game.dungeon.encounters.find(({ isBoss }) => isBoss);
        const seal = root.getObjectByName('streamedAscensionEntranceSeal');
        const activeStorage = game.busterLabStorage?.getActiveBossExpedition?.();
        return {
          selectedProfileId: game.getSelectedBossProfileId(),
          encounterProfileId: encounter?.bossProfileId ?? null,
          expeditionProfileId: encounter?.expeditionSpec?.bossProfileId ?? null,
          dungeonKind: game.dungeon.dungeonKind ?? 'standard',
          specializedSealCount: seal ? 1 : 0,
          specializedSealCollisionCount: game.dungeon.solidZones.filter(
            ({ id }) => id === 'streamedAscensionEntranceSealCollision',
          ).length,
          storageStatus: activeStorage?.status ?? null,
          storageProfileId: activeStorage?.bossProfileId ?? null,
        };
      });
      expect(contract).toMatchObject({
        selectedProfileId: profileId,
        encounterProfileId: profileId,
        expeditionProfileId: profileId,
        storageStatus: 'active',
        storageProfileId: profileId,
      });
      if (profileId === 'ascensionEngine') {
        expect(contract.dungeonKind).toBe('ascensionReliquary');
        expect(contract.specializedSealCount).toBe(1);
        expect(contract.specializedSealCollisionCount).toBe(1);
      }
      await page.waitForTimeout(100);
      await abandonExpeditionThroughEntrance(page);
    }
    expect(runtimeErrors).toEqual([]);
  });

  test('five enter-return cycles plateau without duplicate world-owned objects', async ({ page }) => {
    test.setTimeout(360_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    await page.goto('/');
    await waitForWorld(page, 'overworld');
    const initial = await readWorldDiagnostics(page);
    const samples = [];
    const activeRootIds = new Set([initial.activeRootId]);
    const dungeonRootIds = new Set();
    const hostReferences = await page.evaluateHandle(() => ({
      player: window.game.player,
      inventory: window.game.inventory,
      equipment: window.game.player.equipment,
      campaignStorage: window.game.busterLabStorage,
      renderer: window.game.renderer,
      scene: window.game.scene,
      camera: window.game.camera,
      ui: window.game.ui,
    }));
    const persistentBaseline = await page.evaluate(() => ({
      gold: window.game.inventory.gold,
      items: JSON.stringify(window.game.inventory.items),
      unidentifiedScrap: window.game.inventory.unidentifiedScrap,
      equipment: JSON.stringify(window.game.player.equipment.getSummary?.() ?? null),
      level: window.game.player.level,
      largeRefractorsSecured: window.game.largeRefractorsSecured,
    }));
    let entryStateSignature = null;
    let previousDungeonReferences = null;

    for (let cycle = 1; cycle <= 5; cycle += 1) {
      await beginBossExpedition(page, 'revolvingFusillade');
      const dungeonDiagnostics = await readWorldDiagnostics(page);
      activeRootIds.add(dungeonDiagnostics.activeRootId);
      dungeonRootIds.add(dungeonDiagnostics.activeRootId);
      if (previousDungeonReferences) {
        const replacement = await page.evaluate((previous) => ({
          bundle: window.game.activeWorldBundle !== previous.bundle,
          root: window.game.activeWorldBundle.root !== previous.root,
          facade: window.game.activeWorldBundle.facade !== previous.facade,
          controller: window.game.dungeonController !== previous.controller,
          spawner: window.game.spawner !== previous.spawner,
          mapEvents: window.game.mapEvents !== previous.mapEvents,
        }), previousDungeonReferences);
        expect(Object.values(replacement).every(Boolean), `cycle ${cycle} reused dungeon-local state`).toBe(true);
        await previousDungeonReferences.dispose();
      }
      const entryState = await page.evaluate(() => {
        const snapshot = window.game.getPublicDungeonJourneyDiagnostics({ includeGeometry: false });
        const trapRuntime = window.game.getConnectorTrackTrapDiagnostics();
        const trapFacadeRuntime = window.game.dungeon.connectorTrackTrapRuntimeDiagnostics;
        return {
          ownedKeys: snapshot.ownedKeys,
          keycards: snapshot.keycards.map(({ id, collected }) => ({ id, collected })),
          doors: snapshot.doors.map(({ id, closed, opened }) => ({ id, closed, opened })),
          chests: snapshot.chests.map(({ id, opened }) => ({ id, opened })),
          encounters: snapshot.encounters.map(({ id, spawned, cleared }) => ({ id, spawned, cleared })),
          mechanisms: snapshot.mechanisms.map(({ id, activated }) => ({ id, activated })),
          keySeekerActivated: snapshot.keySeeker?.activated ?? null,
          shrineCollected: snapshot.shrine?.collected ?? null,
          connectorTrackTraps: {
            descriptorCount: window.game.dungeon.connectorTrackTraps?.length ?? 0,
            mounted: trapRuntime.mounted,
            runtimeCount: trapRuntime.trapCount,
            facadeCount: trapFacadeRuntime?.trapCount ?? 0,
            facadeMounted: trapFacadeRuntime?.mounted ?? false,
            visualLoaded: trapRuntime.visual?.loaded ?? false,
            visualLoadCount: trapRuntime.visual?.loadCount ?? 0,
            activeVisualCount: trapRuntime.visual?.activeInstanceCount ?? 0,
          },
        };
      });
      if (entryStateSignature === null) entryStateSignature = entryState;
      else expect(entryState, `cycle ${cycle} did not reset dungeon-local progression`).toEqual(entryStateSignature);
      expect(entryState.ownedKeys).toEqual([]);
      expect(entryState.keycards.every(({ collected }) => !collected)).toBe(true);
      expect(entryState.chests.every(({ opened }) => !opened)).toBe(true);
      expect(entryState.encounters.every(({ cleared }) => !cleared)).toBe(true);
      expect(entryState.connectorTrackTraps).toMatchObject({
        mounted: true,
        facadeMounted: true,
        visualLoaded: true,
        visualLoadCount: 1,
      });
      expect(entryState.connectorTrackTraps.descriptorCount).toBeGreaterThan(0);
      expect(entryState.connectorTrackTraps.runtimeCount).toBe(
        entryState.connectorTrackTraps.descriptorCount,
      );
      expect(entryState.connectorTrackTraps.facadeCount).toBe(
        entryState.connectorTrackTraps.descriptorCount,
      );
      expect(entryState.connectorTrackTraps.activeVisualCount).toBe(
        entryState.connectorTrackTraps.descriptorCount,
      );
      previousDungeonReferences = await page.evaluateHandle(() => ({
        bundle: window.game.activeWorldBundle,
        root: window.game.activeWorldBundle.root,
        facade: window.game.activeWorldBundle.facade,
        controller: window.game.dungeonController,
        spawner: window.game.spawner,
        mapEvents: window.game.mapEvents,
        trapRuntime: window.game.connectorTrackTrapRuntime,
        trapFactory: window.game.activeWorldBundle.connectorTrackTrapVisualFactory,
      }));
      await abandonExpeditionThroughEntrance(page);
      await waitForOverworldAssetsSettled(page);

      const releasedLocalState = await page.evaluate((previous) => ({
        disposed: previous.bundle.disposed === true,
        detached: previous.root.parent === null,
        noMountedDungeonController: window.game.dungeonController !== previous.controller,
        trapRuntimeDisposed: previous.trapRuntime?.disposed === true,
        trapFactoryDisposed: previous.trapFactory?.disposed === true,
        noMountedTrapRuntime: window.game.connectorTrackTrapRuntime === null,
        facadePublishedDisposal:
          previous.facade.connectorTrackTrapRuntimeDiagnostics?.disposed === true,
      }), previousDungeonReferences);
      expect(releasedLocalState).toEqual({
        disposed: true,
        detached: true,
        noMountedDungeonController: true,
        trapRuntimeDisposed: true,
        trapFactoryDisposed: true,
        noMountedTrapRuntime: true,
        facadePublishedDisposal: true,
      });
      const hostState = await page.evaluate((references) => ({
        identities: {
          player: window.game.player === references.player,
          inventory: window.game.inventory === references.inventory,
          equipment: window.game.player.equipment === references.equipment,
          campaignStorage: window.game.busterLabStorage === references.campaignStorage,
          renderer: window.game.renderer === references.renderer,
          scene: window.game.scene === references.scene,
          camera: window.game.camera === references.camera,
          ui: window.game.ui === references.ui,
        },
        values: {
          gold: window.game.inventory.gold,
          items: JSON.stringify(window.game.inventory.items),
          unidentifiedScrap: window.game.inventory.unidentifiedScrap,
          equipment: JSON.stringify(window.game.player.equipment.getSummary?.() ?? null),
          level: window.game.player.level,
          largeRefractorsSecured: window.game.largeRefractorsSecured,
        },
      }), hostReferences);
      expect(Object.values(hostState.identities).every(Boolean), `cycle ${cycle} replaced host state`).toBe(true);
      expect(hostState.values, `cycle ${cycle} lost persistent host values`).toEqual(persistentBaseline);

      const diagnostics = await readWorldDiagnostics(page);
      const root = await getActiveRootSummary(page);
      activeRootIds.add(diagnostics.activeRootId);
      expect(diagnostics.planHash).toBe(initial.planHash);
      expect(diagnostics.generationCount).toBe(initial.generationCount + cycle * 2);
      expect(diagnostics.disposalCount).toBe(initial.disposalCount + cycle * 2);
      expect(root.counts[OVERWORLD_OBJECT_NAMES.roll]).toBe(1);
      expect(root.counts[OVERWORLD_OBJECT_NAMES.supportCar]).toBe(1);
      expect(root.counts[OVERWORLD_OBJECT_NAMES.workbench]).toBe(1);
      expect(root.counts[OVERWORLD_OBJECT_NAMES.door]).toBe(1);
      expect(diagnostics.ownership).toMatchObject({
        scenePlayerRootCount: 1,
        sceneActiveWorldRootCount: 1,
        activeControllerCount: 1,
        gameHostEventBindingPasses: initial.ownership.gameHostEventBindingPasses,
        gameHostEventListenerRegistrations: initial.ownership.gameHostEventListenerRegistrations,
        mountedRuntimeContractAccepted: true,
        mountedEnemyCount: 0,
        mountedHazardCount: 0,
        mountedProjectileCount: 0,
        mountedMineCount: 0,
        mountedLootCount: 0,
        mountedRefractorCount: 0,
      });
      expect(diagnostics.ownership.disposableResourceCount).toBeGreaterThan(0);
      expect(diagnostics.lastDisposalStats.connectorTrackTrapDisposal).toMatchObject({
        trapCount: entryState.connectorTrackTraps.descriptorCount,
        // Transition teardown unmounts the runtime before resource accounting;
        // zero here proves every trap instance has already detached.
        activeVisualCount: 0,
        visualLoadCount: 1,
      });
      samples.push({ renderer: diagnostics.renderer, ownership: diagnostics.ownership });
      console.log(`overworld-cycle-${cycle}`, JSON.stringify({
        renderer: diagnostics.renderer,
        ownership: diagnostics.ownership,
        disposal: diagnostics.lastDisposalStats,
      }));
    }

    expect(activeRootIds.size).toBeGreaterThanOrEqual(2);
    expect(dungeonRootIds.size).toBe(5);
    const plateau = samples.slice(1);
    for (const field of ['geometries', 'textures']) {
      const values = plateau.map((sample) => sample.renderer[field]);
      expect(new Set(values).size, `${field} changed after the first warm-up cycle`).toBe(1);
      expect(values.at(-1) - values[0], `${field} retained a non-zero resource slope`).toBe(0);
    }
    for (const field of [
      'activeRootObjectCount',
      'activeRootMeshCount',
      'activeRootLightCount',
      'sceneObjectCount',
      'scenePlayerRootCount',
      'sceneActiveWorldRootCount',
      'controllerRuntimeRootCount',
      'npcAnimatorCount',
      'npcMixerCount',
      'collisionEntryCount',
      'cullingEntryCount',
      'disposableResourceCount',
      'gameHostEventBindingPasses',
      'gameHostEventListenerRegistrations',
      'activeControllerCount',
      'mountedRuntimeContractAccepted',
      'mountedEnemyCount',
      'mountedHazardCount',
      'mountedProjectileCount',
      'mountedMineCount',
      'mountedLootCount',
      'mountedRefractorCount',
    ]) {
      const values = plateau.map((sample) => sample.ownership[field]);
      expect(new Set(values).size, `${field} did not plateau`).toBe(1);
    }
    await previousDungeonReferences?.dispose();
    await hostReferences.dispose();
    expect(runtimeErrors).toEqual([]);
  });

  test('terrain uses greedy chunks and stays inside the render budget', async ({ page }) => {
    test.setTimeout(180_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    await page.goto('/');
    await waitForWorld(page, 'overworld');

    // Wait for Roll's model and animation library, the Support Car, workbench
    // textures, and renderer resource accounting to reach a stable window.
    await waitForOverworldAssetsSettled(page);
    for (const point of [
      { x: -17, z: -8 },
      { x: -30, z: -20 },
      { x: -38, z: -28 },
    ]) {
      await walkToWorldPosition(page, point, { timeout: 25_000, stopDistance: 2 });
    }
    await page.waitForTimeout(750);
    const diagnostics = await readWorldDiagnostics(page);
    const root = await getActiveRootSummary(page);
    const denseForest = await page.evaluate(() => {
      const position = window.game.player.root.position;
      const nearbyTreeCount = window.game.overworldPlan.trees.filter((tree) => (
        Math.hypot(tree.x - position.x, tree.z - position.z) <= 15
      )).length;
      return {
        playerPosition: position.toArray(),
        nearbyTreeCount,
      };
    });
    const playerPosition = denseForest.playerPosition;
    console.log('overworld-dense-diagnostics', JSON.stringify({
      renderer: diagnostics.renderer,
      ownership: diagnostics.ownership,
      playerPosition,
    }));

    expect(root.terrainChunkCount).toBeGreaterThan(0);
    expect(root.terrainChunkCount).toBeLessThanOrEqual(36);
    expect(root.nonGreedyTerrainChunkCount).toBe(0);
    expect(root.suspiciousPerVoxelMeshCount).toBe(0);
    expect(root.instancedMeshCount).toBeGreaterThan(0);
    expect(root.terrainChunks.every(({ sourceCellCount }) => sourceCellCount > 1)).toBe(true);
    expect(root.terrainChunks.every(({ groups }) => groups > 0 && groups <= 6)).toBe(true);
    expect(diagnostics.renderer.calls).toBeLessThanOrEqual(220);
    expect(diagnostics.renderer.triangles).toBeGreaterThan(0);
    expect(diagnostics.renderer.geometries).toBeGreaterThan(0);
    expect(diagnostics.renderer.textures).toBeGreaterThan(0);
    expect(diagnostics.occlusion.entryCount).toBeGreaterThan(0);
    expect(diagnostics.occlusion.hiddenOwnerCount).toBeGreaterThanOrEqual(0);
    expect(playerPosition[0]).toBeLessThan(-35);
    expect(playerPosition[2]).toBeLessThan(-18);
    expect(denseForest.nearbyTreeCount).toBeGreaterThanOrEqual(18);

    const heartbeat = await page.evaluate(() => new Promise((resolve) => {
      const deltas = [];
      let previous = performance.now();
      const sample = (now) => {
        deltas.push(now - previous);
        previous = now;
        if (deltas.length >= 300) {
          const stable = [...deltas].sort((a, b) => a - b);
          resolve({
            frameCount: stable.length,
            maximum: Math.max(...stable),
            p99: stable[Math.floor(stable.length * 0.99)],
            average: stable.reduce((sum, value) => sum + value, 0) / stable.length,
          });
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    console.log('overworld-heartbeat', JSON.stringify(heartbeat));
    expect(heartbeat.frameCount).toBe(300);
    expect(heartbeat.maximum).toBeLessThanOrEqual(100);
    expect(heartbeat.p99).toBeLessThanOrEqual(100);
    expect(heartbeat.average).toBeLessThanOrEqual(100);
    expect(runtimeErrors).toEqual([]);
  });

  test('camera occlusion follows the camera-to-player segment rather than player collision', async ({ page }) => {
    test.setTimeout(300_000);
    const runtimeErrors = attachRuntimeErrorCapture(page);
    await page.goto('/');
    await waitForWorld(page, 'overworld');
    await waitForOverworldAssetsSettled(page);

    const plan = await page.evaluate(() => structuredClone({
      trails: window.game.overworldPlan.trails,
    }));
    const forestTrail = plan.trails.find(({ id }) => id === 'forest-cabin-loop')?.points;
    expect(forestTrail, 'the authored forest trail must be available to the public-input route').toBeTruthy();

    // This is the same short-segment traversal used by the full no-jump trail
    // journey above. Long tank-control targets are inherently unstable because
    // the follow-camera basis rotates while the key remains held; re-sampling
    // every two metres keeps the player on the authored, blocker-cleared path.
    const densifyPath = (points, maximumSpacing = 2) => points.flatMap((start, index) => {
      const end = points[index + 1];
      if (!end) return [start];
      const steps = Math.max(1, Math.ceil(horizontalDistance(start, end) / maximumSpacing));
      return Array.from({ length: steps }, (_, step) => {
        const amount = step / steps;
        return {
          x: start.x + (end.x - start.x) * amount,
          z: start.z + (end.z - start.z) * amount,
        };
      });
    });
    const walkAuthoredPath = async (points, {
      sampleOcclusion = false,
      maximumSpacing = 2,
      stopDistance = 1.6,
    } = {}) => {
      const start = await page.evaluate(() => ({
        x: window.game.player.root.position.x,
        z: window.game.player.root.position.z,
      }));
      const sampledHiddenOwnerIds = new Set();
      let maximumHiddenOwnerCount = 0;
      const samples = densifyPath([start, ...points], maximumSpacing).slice(1);
      for (const point of samples) {
        const reached = await walkToWorldPosition(page, point, {
          timeout: 30_000,
          stopDistance,
          stepMilliseconds: 75,
          sampleOcclusion,
        });
        maximumHiddenOwnerCount = Math.max(
          maximumHiddenOwnerCount,
          reached.maximumHiddenOwnerCount ?? 0,
        );
        for (const ownerId of reached.sampledHiddenOwnerIds ?? []) {
          sampledHiddenOwnerIds.add(ownerId);
        }
      }
      return {
        maximumHiddenOwnerCount,
        sampledHiddenOwnerIds: [...sampledHiddenOwnerIds].sort(),
      };
    };

    const registeredOcclusion = (await readWorldDiagnostics(page))
      .occlusion.registeredSurfaceKindsByOwner;
    expect(registeredOcclusion['forest-cabin']).toEqual(
      expect.arrayContaining(['house-wall', 'house-roof']),
    );
    expect(Object.entries(registeredOcclusion).some(([ownerId, kinds]) => (
      ownerId.startsWith('forest-canopy-') && kinds.includes('tree-canopy')
    ))).toBe(true);

    await walkToNamedObject(page, OVERWORLD_OBJECT_NAMES.door, {
      stopDistance: 3.7,
      timeout: 15_000,
    });
    // At the exterior face the mound is ahead of the player rather than
    // intersecting the camera-to-player segment.
    expect((await readWorldDiagnostics(page)).occlusion.hiddenOwnerCount).toBe(0);

    // Walk around the east side using ordinary movement. Once north of the
    // mound, continued northward travel puts the follow camera inside the mound
    // while the player's own capsule remains completely clear of it.
    // Keep the east-side waypoint beyond the Support Car's rotated collision
    // envelope. The previous x=9 route aimed directly through the vehicle and
    // could fail before the camera-occlusion behavior was exercised.
    await walkAuthoredPath([
      { x: 3, z: 2 },
      { x: 12, z: 2 },
      { x: 12, z: -5 },
      { x: 12, z: -13 },
      { x: 0, z: -13 },
    ]);
    const crossing = await walkToWorldPosition(page, { x: 0, z: -16.5 }, {
      timeout: 15_000,
      // The camera is deliberately intersecting the mound in this band, so
      // its follow basis can rotate while the owner disappears. The sample is
      // accepted by observed segment occlusion, not by touching an arbitrary
      // sub-metre coordinate behind the mound.
      stopDistance: 2.25,
      stepMilliseconds: 30,
      sampleOcclusion: true,
    });
    expect(crossing.maximumHiddenOwnerCount).toBeGreaterThan(0);

    await walkAuthoredPath([{ x: 0, z: -27 }], { stopDistance: 1.3 });
    await expect.poll(async () => (
      (await readWorldDiagnostics(page)).occlusion.hiddenOwnerCount
    )).toBe(0);

    // The highland connector terminates at the second forest-loop point, so
    // this remains on authored walkable terrain and bypasses the mound without
    // crossing Roll, the workbench, or the Support Car. Continue on the exact
    // forest loop, then use the same short cabin-perimeter waypoints exercised
    // by the all-landmarks no-jump journey. The physical assertion targets a
    // trunk batch because normal camera/player heights are below the authored
    // canopy bottoms; cabin and canopy participation are proven by the
    // registration assertions above rather than a contrived intersection.
    await walkAuthoredPath([forestTrail[1]]);
    const forestSample = await walkAuthoredPath([
      ...forestTrail.slice(2, 4),
      { x: -43, z: -31 },
      { x: -50, z: -31 },
      { x: -50, z: -41 },
      { x: -43, z: -41 },
      { x: -43, z: -47 },
    ], { sampleOcclusion: true });
    expect(forestSample.sampledHiddenOwnerIds.some(
      (ownerId) => ownerId.startsWith('forest-trunks-'),
    )).toBe(true);

    await walkAuthoredPath([{ x: -43, z: -52 }], { stopDistance: 1.3 });
    await expect.poll(async () => (
      (await readWorldDiagnostics(page)).occlusion.hiddenOwnerCount
    )).toBe(0);
    expect(runtimeErrors).toEqual([]);
  });
});
