import { expect, test } from '@playwright/test';

function collectRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function waitForGame(page) {
  await page.waitForFunction(() => Boolean(window.game?.combat && window.game?.ui));
}

async function waitForRollAssets(page) {
  await page.waitForFunction(() => {
    const roll = window.game?.dungeon?.group?.getObjectByName('rollCaskettNpc');
    return !roll || roll.userData?.animationAssetsSettled === true;
  });
}

test('feature-off and feature-on share one canonical starter Power Raiser without duplication', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?reaverbotSeed=buster-feature-off');
  await waitForGame(page);
  await waitForRollAssets(page);

  const state = await page.evaluate(() => {
    const { game } = window;
    game.setInventoryOpen(true, { mode: 'roll' });
    return {
      enabled: game.busterLabEnabled,
      runtime: game.busterRuntime,
      plan: game.getActiveBusterPlan?.(),
      rollTabsHidden: document.getElementById('roll-workshop-tabs')?.hidden,
      busterDebugTabHidden: document.getElementById('buster-debug-tab')?.hidden,
      starterPowerRaisers: game.inventory.items.filter((item) => item.type === 'powerRaiser').length,
      starterIds: game.inventory.items
        .filter((item) => item.type === 'powerRaiser')
        .map((item) => item.legacyBusterId ?? item.canonicalId ?? item.id),
      shadow: game.busterLabStorage.state.legacyBusterParts.records.find((entry) => entry.starter),
      unifiedHud: Boolean(game.combat.getWeaponHudData()?.unifiedBuster),
    };
  });

  expect(state.enabled).toBe(false);
  expect(state.runtime).toBe(null);
  expect(state.plan).toBe(null);
  expect(state.rollTabsHidden).toBe(false);
  expect(state.busterDebugTabHidden).toBe(true);
  expect(state.starterPowerRaisers).toBe(1);
  expect(state.starterIds).toEqual([state.shadow.legacyId]);
  expect(state.shadow.legacyType).toBe('powerRaiser');
  expect(state.shadow.location).toEqual({ kind: 'megaSocket', socketIndex: 0 });
  expect(state.unifiedHud).toBe(false);

  await page.goto('/?busterLab=1&reaverbotSeed=buster-feature-off');
  await waitForGame(page);
  await waitForRollAssets(page);
  const featureOn = await page.evaluate(() => {
    const { game } = window;
    const shadow = game.busterLabStorage.state.legacyBusterParts.records.find((entry) => entry.starter);
    return {
      starterPowerRaisers: game.inventory.items.filter((item) => item.type === 'powerRaiser').length,
      shadowId: shadow?.legacyId,
      linkedCalibrationId: shadow?.calibrationInstanceId,
      socket: game.busterLabState.megaCalibrations.slots[0],
      power: game.busterLabPlans.get('megaBuster')?.stats?.effectivePower,
      energy: game.busterLabPlans.get('megaBuster')?.stats?.maxEnergy,
      cost: game.busterLabPlans.get('megaBuster')?.stats?.energyCost,
    };
  });
  expect(featureOn.starterPowerRaisers).toBe(0);
  expect(featureOn.shadowId).toBe(state.shadow.legacyId);
  expect(featureOn.linkedCalibrationId).toBe(state.shadow.calibrationInstanceId);
  expect(featureOn.socket).toBe(state.shadow.calibrationInstanceId);
  expect(featureOn.power).toBeCloseTo(9.12, 10);
  expect(featureOn.energy).toBe(6);
  expect(featureOn.cost).toBe(2);

  await page.goto('/?reaverbotSeed=buster-feature-off');
  await waitForGame(page);
  const toggledOff = await page.evaluate(() => ({
    ids: window.game.inventory.items
      .filter((item) => item.type === 'powerRaiser')
      .map((item) => item.legacyBusterId ?? item.canonicalId ?? item.id),
    recordCount: window.game.busterLabStorage.state.legacyBusterParts.records
      .filter((entry) => entry.starter).length,
  }));
  expect(toggledOff).toEqual({ ids: [state.shadow.legacyId], recordCount: 1 });
  expect(runtimeErrors).toEqual([]);
});

test('Buster Part world pickups remain live until their durable ownership commit succeeds', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?busterLab=1&reaverbotSeed=buster-durable-pickup');
  await waitForGame(page);

  const result = await page.evaluate(async () => {
    const { game } = window;
    game.stop();
    const storage = game.busterLabStorage;
    const originalRegister = storage.registerLegacyBusterPartAsync;
    const item = game.lootSystem.generateItem(1, {
      type: 'powerRaiser',
      rarity: 'standard',
      name: 'Durability Probe Power Raiser',
    });
    const inventoryBefore = game.inventory.items.map((entry) => entry.id);
    const recordsBefore = storage.state.legacyBusterParts.records.length;
    const calibrationsBefore = storage.state.megaCalibrations.instances.length;
    const persistedBefore = localStorage.getItem(storage.storageKeys.main);
    const object = game.lootSystem.createPickup(item, game.player.root.position.clone());
    const pickup = game.lootSystem.pickups.find((entry) => entry.item === item);
    let settleAttempt = null;
    let storageCalls = 0;
    storage.registerLegacyBusterPartAsync = (..._args) => {
      storageCalls += 1;
      return new Promise((resolve) => { settleAttempt = resolve; });
    };
    let asyncCollected = 0;
    const collect = () => game.lootSystem.update(0, game.player, game.inventory, {
      collectItem: (candidate) => game._collectWorldItemDurably(candidate),
      onAsyncCollected: () => { asyncCollected += 1; },
    });

    const syncCollected = collect();
    for (let attempt = 0; attempt < 20 && typeof settleAttempt !== 'function'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (typeof settleAttempt !== 'function') throw new Error('The durable pickup transaction did not start.');
    const whilePending = {
      syncCollected: syncCollected.length,
      pending: pickup.pendingCollection,
      pickupCount: game.lootSystem.pickups.length,
      visible: object.visible,
      inScene: object.parent === game.scene,
      inventoryIds: game.inventory.items.map((entry) => entry.id),
      records: storage.state.legacyBusterParts.records.length,
      calibrations: storage.state.megaCalibrations.instances.length,
      persisted: localStorage.getItem(storage.storageKeys.main),
      storageCalls,
    };

    settleAttempt({
      ok: false,
      reason: 'transaction-failed',
      error: new Error('simulated durable failure'),
      state: storage.state,
    });
    await game.busterGameCommandQueue;
    await game.busterStorageOperationQueue;
    await Promise.resolve();
    await Promise.resolve();
    const afterFailure = {
      pending: pickup.pendingCollection,
      pickupCount: game.lootSystem.pickups.length,
      visible: object.visible,
      inScene: object.parent === game.scene,
      inventoryIds: game.inventory.items.map((entry) => entry.id),
      records: storage.state.legacyBusterParts.records.length,
      calibrations: storage.state.megaCalibrations.instances.length,
      persisted: localStorage.getItem(storage.storageKeys.main),
      asyncCollected,
    };

    storage.registerLegacyBusterPartAsync = originalRegister;
    collect();
    await game.busterGameCommandQueue;
    await game.busterStorageOperationQueue;
    await Promise.resolve();
    await Promise.resolve();
    const linkedRecord = storage.state.legacyBusterParts.records.find((entry) => (
      entry.legacyId === item.legacyBusterId
    ));
    const afterSuccess = {
      pending: pickup.pendingCollection,
      pickupCount: game.lootSystem.pickups.length,
      visible: object.visible,
      inScene: object.parent === game.scene,
      inventoryIds: game.inventory.items.map((entry) => entry.id),
      records: storage.state.legacyBusterParts.records.length,
      calibrations: storage.state.megaCalibrations.instances.length,
      persistedChanged: localStorage.getItem(storage.storageKeys.main) !== persistedBefore,
      linked: Boolean(linkedRecord),
      linkedType: linkedRecord?.legacyType ?? null,
      linkedCalibration: linkedRecord?.calibrationInstanceId ?? null,
      asyncCollected,
    };
    storage.registerLegacyBusterPartAsync = originalRegister;
    return {
      inventoryBefore,
      recordsBefore,
      calibrationsBefore,
      persistedBefore,
      whilePending,
      afterFailure,
      afterSuccess,
    };
  });

  expect(result.whilePending).toEqual({
    syncCollected: 0,
    pending: true,
    pickupCount: 1,
    visible: true,
    inScene: true,
    inventoryIds: result.inventoryBefore,
    records: result.recordsBefore,
    calibrations: result.calibrationsBefore,
    persisted: result.persistedBefore,
    storageCalls: 1,
  });
  expect(result.afterFailure).toEqual({
    pending: false,
    pickupCount: 1,
    visible: true,
    inScene: true,
    inventoryIds: result.inventoryBefore,
    records: result.recordsBefore,
    calibrations: result.calibrationsBefore,
    persisted: result.persistedBefore,
    asyncCollected: 0,
  });
  expect(result.afterSuccess.pending).toBe(false);
  expect(result.afterSuccess.pickupCount).toBe(0);
  expect(result.afterSuccess.visible).toBe(false);
  expect(result.afterSuccess.inScene).toBe(false);
  expect(result.afterSuccess.inventoryIds).toEqual(result.inventoryBefore);
  expect(result.afterSuccess.records).toBe(result.recordsBefore + 1);
  expect(result.afterSuccess.calibrations).toBe(result.calibrationsBefore + 1);
  expect(result.afterSuccess.persistedChanged).toBe(true);
  expect(result.afterSuccess.linked).toBe(true);
  expect(result.afterSuccess.linkedType).toBe('powerRaiser');
  expect(result.afterSuccess.linkedCalibration).toContain(':calibration');
  expect(result.afterSuccess.asyncCollected).toBe(1);
  expect(runtimeErrors).toEqual([]);
});

test('Debug Tools grants a repeatable complete Buster Lab testing kit', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?busterLab=1&busterLabDebug=1&reaverbotSeed=buster-debug-kit');
  await waitForGame(page);
  await page.evaluate(() => window.game.setPoseDebugOpen(true));

  await expect(page.locator('#pose-debug-panel')).toBeVisible();
  await expect(page.locator('#buster-debug-tab')).toBeVisible();
  await expect(page.locator('#buster-debug-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#buster-debug-view')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter Test Range' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Enter Sandbox', exact: true })).toBeDisabled();
  await expect(page.locator('#buster-debug-test-status')).toContainText('Use ?busterLab=sandbox');
  await page.getByRole('button', { name: 'Grant one of each Buster part' }).click();
  await expect(page.locator('#buster-debug-status')).toContainText('1 kit granted');

  const first = await page.evaluate(() => {
    const { game } = window;
    const state = game.busterLabState;
    const moduleCounts = Object.fromEntries([
      'pulseBolt',
      'mortarShell',
      'pursuitGuidance',
      'atApex',
      'spread3',
      'cluster5',
      'explosion',
    ].map((moduleId) => [
      moduleId,
      state.moduleInstances.filter((entry) => entry.moduleId === moduleId).length,
    ]));
    return {
      grantCount: state.migrations.debugKitGrantCount,
      moduleCounts,
      moduleTotal: state.moduleInstances.length,
      uniqueModuleIds: new Set(state.moduleInstances.map((entry) => entry.instanceId)).size,
      chassisCount: state.chassisInstances.length,
      buildBAvailable: state.chassisInstances.some((entry) => entry.chassisId === 'chassis-b'),
      buildBDraft: state.chassisDrafts.some((entry) => entry.buildId === 'build-b'),
      buildBSaved: state.chassisBuilds.some((entry) => entry.buildId === 'build-b'),
      calibrationCount: state.megaCalibrations.instances.length,
      calibrationTypes: [...new Set(state.megaCalibrations.instances.map((entry) => entry.legacyType))].sort(),
      recipeLevels: game.getBusterLabViewModel('build-a').recipes.map((entry) => entry.discoveryState),
      scrap: state.rollSalvage.identifiedScrap,
      namedParts: Object.fromEntries(Object.entries(state.rollSalvage.parts)
        .map(([partId, part]) => [partId, part.quantity])),
      assignments: { ...state.assignments.slots },
    };
  });

  expect(first.grantCount).toBe(1);
  expect(first.moduleCounts).toEqual({
    pulseBolt: 2,
    mortarShell: 1,
    pursuitGuidance: 1,
    atApex: 1,
    spread3: 1,
    cluster5: 1,
    explosion: 1,
  });
  expect(first.moduleTotal).toBe(8);
  expect(first.uniqueModuleIds).toBe(first.moduleTotal);
  expect(first.chassisCount).toBe(2);
  expect(first.buildBAvailable).toBe(true);
  expect(first.buildBDraft).toBe(true);
  expect(first.buildBSaved).toBe(false);
  expect(first.calibrationCount).toBe(7);
  expect(first.calibrationTypes).toEqual([
    'energyBattery',
    'heatSinkCore',
    'powerRaiser',
    'rangeBooster',
    'rapidFireUnit',
    'sniperScope',
  ]);
  expect(first.recipeLevels.every((level) => level === 'full')).toBe(true);
  expect(first.scrap).toBe(66);
  expect(first.namedParts).toEqual({
    revolvingPulseBarrel: 2,
    highAngleLaunchTube: 1,
    behaviorChipPursuit: 1,
    rubyOpticLens: 1,
    ballisticsLogicChip: 1,
    ammunitionFeedDrum: 1,
    clusterBurstSequencer: 1,
    volatileOverloadCell: 1,
  });
  expect(first.assignments).toEqual({ 1: null, 2: null });

  const mortarBattery = await page.evaluate(async () => {
    const { game } = window;
    await game.updateBusterDraft('build-a', {
      type: 'setProgramSlot',
      slot: 'emitter',
      moduleId: 'mortarShell',
    });
    const view = game.getBusterLabViewModel('build-a');
    await game.updateBusterDraft('build-a', {
      type: 'setProgramSlot',
      slot: 'emitter',
      moduleId: 'pulseBolt',
    });
    return {
      valid: view.validation.valid,
      maxEnergy: view.result?.stats.maxEnergy,
      energyCost: view.result?.stats.energyCost,
      shotsPerCharge: view.result?.stats.shotsPerCharge,
    };
  });
  expect(mortarBattery).toEqual({
    valid: true,
    maxEnergy: 6,
    energyCost: 3,
    shotsPerCharge: 2,
  });

  await page.getByRole('button', { name: 'Grant one of each Buster part' }).click();
  await expect(page.locator('#buster-debug-status')).toContainText('2 kits granted');
  const second = await page.evaluate(() => ({
    grantCount: window.game.busterLabState.migrations.debugKitGrantCount,
    moduleTotal: window.game.busterLabState.moduleInstances.length,
    chassisCount: window.game.busterLabState.chassisInstances.length,
    calibrationCount: window.game.busterLabState.megaCalibrations.instances.length,
  }));
  expect(second).toEqual({ grantCount: 2, moduleTotal: 15, chassisCount: 2, calibrationCount: 13 });

  await page.reload();
  await waitForGame(page);
  await page.evaluate(() => window.game.setPoseDebugOpen(true));
  await expect(page.locator('#buster-debug-status')).toContainText('2 kits granted');
  expect(runtimeErrors).toEqual([]);
});

test('Debug Tools launches range and sandbox tests and restores its Buster tab', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?busterLab=sandbox&busterLabDebug=1&reaverbotSeed=buster-debug-launcher');
  await waitForGame(page);
  await page.evaluate(() => window.game.setPoseDebugOpen(true));

  await expect(page.locator('#buster-debug-view')).toBeVisible();
  await expect(page.locator('#buster-debug-build')).toHaveValue('build-a');
  await expect(page.getByRole('button', { name: 'Enter Test Range' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Enter Sandbox', exact: true })).toBeEnabled();

  await page.locator('#buster-debug-build').selectOption('megaBuster');
  await page.locator('#buster-debug-targets').selectOption('4');
  await page.locator('#buster-debug-profile').selectOption('moving');
  await page.locator('#buster-debug-depth').selectOption('5');
  await expect(page.locator('#buster-debug-test-status')).toContainText('Mega Buster is ready');

  const drained = await page.evaluate(() => {
    const game = window.game;
    const key = game.busterLabPlans.get('megaBuster').weaponKey;
    const state = game.busterRuntime.states.get(key);
    state.energy = 0;
    state.cycleRemaining = 1;
    state.recoveryLocked = true;
    return { key, maxEnergy: state.maxEnergy };
  });
  await page.getByRole('button', { name: 'Refill Buster Batteries' }).click();
  await expect.poll(() => page.evaluate((key) => {
    const state = window.game.busterRuntime.states.get(key);
    return {
      energy: state.energy,
      maxEnergy: state.maxEnergy,
      cycleRemaining: state.cycleRemaining,
      recoveryLocked: state.recoveryLocked,
    };
  }, drained.key)).toEqual({
    energy: drained.maxEnergy,
    maxEnergy: drained.maxEnergy,
    cycleRemaining: 0,
    recoveryLocked: false,
  });

  await page.getByRole('button', { name: 'Enter Test Range' }).click();
  await page.waitForFunction(() => window.game.busterTestRange?.active === true);
  await expect(page.locator('#pose-debug-panel')).toBeHidden();
  const range = await page.evaluate(() => ({
    buildId: window.game.busterTestRange.buildId,
    config: window.game.busterTestRange.benchmarkConfig,
    debugOpen: window.game.poseDebugOpen,
  }));
  expect(range).toEqual({
    buildId: 'megaBuster',
    config: {
      targetCount: 4,
      profile: 'moving',
      depthLevel: 5,
      distanceBand: 'mid',
      layout: 'compact',
      aimOffset: 'center',
    },
    debugOpen: false,
  });

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.game.busterTestRange === null);
  await expect(page.locator('#pose-debug-panel')).toBeVisible();
  await expect(page.locator('#buster-debug-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#buster-debug-build')).toHaveValue('megaBuster');

  await page.getByRole('button', { name: 'Enter Sandbox', exact: true }).click();
  await page.waitForFunction(() => window.game.busterSandboxSession?.active === true);
  await expect(page.locator('#pose-debug-panel')).toBeHidden();
  const sandbox = await page.evaluate(() => ({
    buildId: window.game.busterSandboxSession.plan.buildId,
    debugOpen: window.game.poseDebugOpen,
    sandboxPlayer: window.game.player !== window.game.busterSandboxSession.production.values.player,
  }));
  expect(sandbox).toEqual({ buildId: 'megaBuster', debugOpen: false, sandboxPlayer: true });

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.game.busterSandboxSession === null);
  await expect(page.locator('#pose-debug-panel')).toBeVisible();
  await expect(page.locator('#buster-debug-tab')).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: "Open Roll's Buster Lab" }).click();
  await expect(page.locator('#pose-debug-panel')).toBeHidden();
  await expect(page.locator('#inventory-panel')).toBeVisible();
  await expect(page.locator('#buster-lab-view')).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('Mega and Custom Busters release only after the arm reaches its extended firing pose', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?busterLab=1&reaverbotSeed=buster-extension-timing');
  await waitForGame(page);
  await page.waitForFunction(() => window.game.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(async () => {
    const { game } = window;
    game.stop();
    const { player, combat, busterRuntime: runtime, pointer } = game;
    const Vector3 = player.root.position.constructor;
    const forward = new Vector3(0, 0, 1);
    const right = new Vector3(1, 0, 0);
    const originalSafeAreaCheck = game.isPlayerInSafeArea;
    const originalExecuteShot = runtime.executeShot;
    game.isPlayerInSafeArea = () => false;
    const captures = [];
    runtime.executeShot = (execution) => {
      captures.push({
        weaponKey: execution.weaponKey,
        origin: execution.context.origin.toArray(),
        muzzle: player.getProjectileOrigin().toArray(),
        braceElapsed: combat.compiledBusterBraceElapsed,
        attackTimer: player.animation.attackTimer,
        sustainedPose: player.isProjectileAimSustained?.(execution.weaponKey) === true,
        poseReady: combat._isCompiledBusterPoseReady?.(execution.weaponKey) === true,
      });
      runtime.releaseReservation(execution.reservationToken);
      return true;
    };
    const movementOptions = () => ({
      arenaRadius: game.arenaRadius,
      movementForward: forward,
      movementRight: right,
      groundY: player.root.position.y,
      aimWorld: pointer.aimWorld,
      projectileAimInputHeld: Boolean(pointer.primary || pointer.secondary),
      game,
    });
    const step = (dt) => {
      player.update(dt, new Set(), movementOptions());
      runtime.update(dt);
      combat.update(dt);
    };
    const clearInput = () => {
      pointer.primary = false;
      pointer.primaryPressed = false;
      pointer.secondary = false;
      pointer.secondaryPressed = false;
      pointer.lockOnPressed = false;
      pointer.alternate = false;
      pointer.alternatePressed = false;
      combat.primaryWasDown = false;
    };
    const prepare = (slotIndex) => {
      clearInput();
      combat._clearPendingAttacks();
      player._releaseProjectileAim();
      player.animation.cancelAttack();
      player.switchArmWeapon(slotIndex, true);
      combat.swapTimer = 0;
      const plan = game.getActiveBusterPlan();
      runtime.resetWeapon(plan.weaponKey);
      runtime.equip(plan);
      pointer.aimWorld.copy(player.root.position).add(new Vector3(0, 1.1, 8));
      player.updateWeaponVisualState();
      return plan;
    };
    const fireTap = (slotIndex) => {
      const plan = prepare(slotIndex);
      const captureStart = captures.length;
      const energyBefore = runtime.getHudState(plan.weaponKey).energy;
      pointer.primary = true;
      pointer.primaryPressed = true;
      step(1 / 120);
      const intent = {
        captureCount: captures.length - captureStart,
        energy: runtime.getHudState(plan.weaponKey).energy,
        pending: Boolean(combat.pendingCompiledBusterShot),
        attackTimer: player.animation.attackTimer,
      };
      pointer.primary = false;
      pointer.primaryPressed = false;
      let elapsed = 0;
      while (captures.length === captureStart && elapsed < 0.6) {
        step(1 / 120);
        elapsed += 1 / 120;
      }
      const capture = captures[captureStart];
      const releaseOrigin = capture ? new Vector3().fromArray(capture.origin) : null;
      const releaseMuzzle = capture ? new Vector3().fromArray(capture.muzzle) : null;
      return {
        weaponKey: plan.weaponKey,
        energyCost: plan.stats.energyCost,
        energyBefore,
        energyAfter: runtime.getHudState(plan.weaponKey).energy,
        intent,
        released: Boolean(capture),
        releaseElapsed: elapsed,
        braceElapsed: capture?.braceElapsed ?? 0,
        attackTimerAtRelease: capture?.attackTimer ?? null,
        releaseMatchesMuzzle: releaseOrigin && releaseMuzzle
          ? releaseOrigin.distanceTo(releaseMuzzle)
          : null,
        sustainedPose: capture?.sustainedPose ?? false,
        poseReady: capture?.poseReady ?? false,
        pendingAfterRelease: Boolean(combat.pendingCompiledBusterShot),
      };
    };

    const mega = fireTap(0);
    const equipped = await game.equipCustomBuster('build-a', 1);
    const custom = equipped.ok ? fireTap(1) : { equipError: equipped.message };

    const cancellationPlan = prepare(0);
    const cancellationEnergy = runtime.getHudState(cancellationPlan.weaponKey).energy;
    const capturesBeforeCancel = captures.length;
    pointer.primary = true;
    pointer.primaryPressed = true;
    step(1 / 120);
    pointer.primary = false;
    pointer.primaryPressed = false;
    const queuedBeforeSwitch = Boolean(combat.pendingCompiledBusterShot);
    combat.switchArmSlot(1);
    for (let frame = 0; frame < 36; frame += 1) step(1 / 120);
    const cancellation = {
      queuedBeforeSwitch,
      pendingAfterSwitch: Boolean(combat.pendingCompiledBusterShot),
      shotsAfterSwitch: captures.length - capturesBeforeCancel,
      energyBefore: cancellationEnergy,
      energyAfter: runtime.getHudState(cancellationPlan.weaponKey).energy,
    };

    runtime.executeShot = originalExecuteShot;
    game.isPlayerInSafeArea = originalSafeAreaCheck;
    clearInput();
    return { mega, custom, cancellation };
  });

  for (const shot of [result.mega, result.custom]) {
    expect(shot.intent.captureCount).toBe(0);
    expect(shot.intent.energy).toBe(shot.energyBefore);
    expect(shot.intent.pending).toBe(true);
    expect(shot.intent.attackTimer).toBeGreaterThan(0);
    expect(shot.released).toBe(true);
    expect(shot.releaseElapsed).toBeGreaterThanOrEqual(0.17);
    expect(shot.braceElapsed).toBeGreaterThanOrEqual(0.18);
    expect(shot.attackTimerAtRelease).toBeLessThanOrEqual(0);
    expect(shot.releaseMatchesMuzzle).toBeLessThan(0.0001);
    expect(shot.sustainedPose).toBe(true);
    expect(shot.poseReady).toBe(true);
    expect(shot.energyAfter).toBeCloseTo(shot.energyBefore - shot.energyCost, 8);
    expect(shot.pendingAfterRelease).toBe(false);
  }
  expect(result.mega.energyCost).toBe(2);
  expect(result.custom.energyCost).toBe(2);
  expect(result.cancellation).toEqual({
    queuedBeforeSwitch: true,
    pendingAfterSwitch: false,
    shotsAfterSwitch: 0,
    energyBefore: 6,
    energyAfter: 6,
  });
  expect(runtimeErrors).toEqual([]);
});

test('free Custom Buster fire does not lock tank movement to an in-flight shot', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?busterLab=1&reaverbotSeed=buster-free-fire-movement');
  await waitForGame(page);
  await page.waitForFunction(() => window.game.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const rangeEntry = game.enterBusterTestRange('build-a');
    if (!rangeEntry.ok) throw new Error(rangeEntry.message);

    const { player, combat, busterRuntime: runtime, projectiles, pointer } = game;
    const plan = game.busterTestRange.plan;
    const weaponKey = plan.weaponKey;
    const Vector3 = player.root.position.constructor;
    const forward = new Vector3(0, 0, 1);
    const right = new Vector3(1, 0, 0);
    const rangeStart = player.root.position.clone();
    const originalExecuteShot = runtime.executeShot;
    const executions = [];

    runtime.executeShot = (execution) => {
      const fired = originalExecuteShot(execution);
      if (fired) executions.push(execution);
      return fired;
    };

    const movementOptions = () => ({
      arenaRadius: game.arenaRadius,
      movementForward: forward,
      movementRight: right,
      groundY: rangeStart.y,
      aimWorld: pointer.aimWorld,
      projectileAimInputHeld: Boolean(pointer.primary || pointer.secondary),
      game,
    });
    const step = (input = new Set(), dt = 1 / 120) => {
      player.update(dt, input, movementOptions());
      runtime.update(dt, {
        activeWeaponKey: weaponKey,
        fireHeld: Boolean(pointer.primary),
      });
      combat.update(dt);
      projectiles.update(dt);
    };
    const bodyForward = () => new Vector3(
      Math.sin(player.root.rotation.y),
      0,
      Math.cos(player.root.rotation.y),
    ).normalize();
    const activeFor = (reservationToken) => projectiles.active.filter((projectile) => (
      projectile.reservationToken === reservationToken
    ));
    const reset = () => {
      projectiles.cancelWhere(
        (projectile) => projectile.attackDomain === 'customBuster',
        'freeFireMovementReset',
      );
      runtime.resetWeapon(weaponKey);
      runtime.equip(plan);
      combat._clearPendingAttacks();
      combat._clearLockOn();
      combat.primaryWasDown = false;
      player._releaseProjectileAim();
      player.animation.cancelAttack();
      player.root.position.copy(rangeStart);
      player.root.rotation.y = 0;
      player.lastMoveDirection.copy(forward);
      player.velocity.set(0, 0, 0);
      player.jumpState = 'Grounded';
      player._jumpGroundY = rangeStart.y;
      pointer.primary = false;
      pointer.primaryPressed = false;
      pointer.secondary = false;
      pointer.secondaryPressed = false;
      pointer.lockOnPressed = false;
      pointer.aimWorld.copy(rangeStart).add(new Vector3(0, 1.05, -12));
    };
    const runScenario = (holdPrimary) => {
      reset();
      const executionStart = executions.length;
      pointer.primary = true;
      pointer.primaryPressed = true;
      step();
      pointer.primary = holdPrimary;
      pointer.primaryPressed = false;

      let releaseElapsed = 1 / 120;
      while (executions.length === executionStart && releaseElapsed < 0.6) {
        step();
        releaseElapsed += 1 / 120;
      }
      const execution = executions[executionStart];
      if (!execution) throw new Error('The Custom Buster never released its queued shot.');
      const reservationToken = execution.reservationToken;
      const positionAtRelease = player.root.position.clone();
      const facingAtRelease = bodyForward();
      const projectileActiveAtRelease = activeFor(reservationToken).length > 0;
      const reservationActiveAtRelease = runtime.getReservedProjectileCount() > 0;

      for (let frame = 0; frame < 18; frame += 1) {
        step(new Set(['KeyW', 'KeyD']));
      }

      const displacement = player.root.position.clone().sub(positionAtRelease);
      return {
        releaseElapsed,
        projectileActiveAtRelease,
        projectileActiveAfterMovement: activeFor(reservationToken).length > 0,
        reservationActiveAtRelease,
        reservationActiveAfterMovement: runtime.getReservedProjectileCount() > 0,
        turnRadians: facingAtRelease.angleTo(bodyForward()),
        lateralTravel: Math.abs(displacement.x),
        forwardTravel: displacement.dot(facingAtRelease),
        manualAim: pointer.secondary,
        movementLockTarget: Boolean(combat.getMovementLockTarget()),
      };
    };

    const held = runScenario(true);
    const tapped = runScenario(false);
    runtime.executeShot = originalExecuteShot;
    pointer.primary = false;
    pointer.primaryPressed = false;
    game.exitBusterTestRange();
    return { held, tapped };
  });

  for (const scenario of [result.held, result.tapped]) {
    expect(scenario.releaseElapsed).toBeGreaterThanOrEqual(0.17);
    expect(scenario.projectileActiveAtRelease).toBe(true);
    expect(scenario.projectileActiveAfterMovement).toBe(true);
    expect(scenario.reservationActiveAtRelease).toBe(true);
    expect(scenario.reservationActiveAfterMovement).toBe(true);
    expect(scenario.turnRadians).toBeGreaterThan(0.08);
    expect(scenario.lateralTravel).toBeGreaterThan(0.01);
    expect(scenario.manualAim).toBe(false);
    expect(scenario.movementLockTarget).toBe(false);
  }
  expect(runtimeErrors).toEqual([]);
});

test('Roll can save, equip, fire, and safely exit the starter Custom Buster range', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?busterLab=1&reaverbotSeed=buster-lab-runtime');
  await waitForGame(page);

  const initial = await page.evaluate(() => {
    const { game } = window;
    game.setInventoryOpen(true, { mode: 'roll' });
    const view = game.getBusterLabViewModel('build-a');
    const mega = game.busterLabPlans.get('megaBuster');
    return {
      enabled: game.busterLabEnabled,
      buildValid: view.validation.valid,
      canSave: view.canSave,
      canEquip: view.canEquip,
      canTest: view.canTest,
      starterModuleCount: view.moduleInstances.filter((entry) => entry.moduleId === 'pulseBolt').length,
      starterPowerRaisers: game.inventory.items.filter((item) => item.type === 'powerRaiser').length,
      megaEnergy: mega.stats.maxEnergy,
      megaCost: mega.stats.energyCost,
      megaShots: mega.stats.shotsPerCharge,
      pulseEnergy: view.result.stats.maxEnergy,
      pulseCost: view.result.stats.energyCost,
      pulseShots: view.result.stats.shotsPerCharge,
      pulseMagazineRecovery: view.benchmarkRange.metrics.recoveryTime,
      megaTuning: view.mega.tuning,
      hud: game.combat.getWeaponHudData(),
    };
  });

  expect(initial.enabled).toBe(true);
  expect(initial.buildValid).toBe(true);
  expect(initial.canSave).toBe(true);
  expect(initial.canEquip).toBe(true);
  expect(initial.canTest).toBe(true);
  expect(initial.starterModuleCount).toBe(1);
  expect(initial.starterPowerRaisers).toBe(0);
  expect(initial.megaEnergy).toBe(6);
  expect(initial.megaCost).toBe(2);
  expect(initial.megaShots).toBe(3);
  expect(initial.pulseEnergy).toBe(6);
  expect(initial.pulseCost).toBe(2);
  expect(initial.pulseShots).toBe(3);
  expect(initial.pulseMagazineRecovery).toBeCloseTo(2.45, 8);
  expect(initial.megaTuning).toEqual({ power: 6, energy: 4, range: 4, rapid: 4 });
  expect(initial.hud.unifiedBuster).toBe(true);
  expect(initial.hud.singleGauge).toBe(true);

  await page.getByRole('tab', { name: 'Buster Lab' }).click();
  await expect(page.locator('#buster-lab-view')).toBeVisible();
  await expect(page.locator('#buster-compiler-result')).toContainText('Base PWR');
  await expect(page.locator('#buster-tuning-remaining')).toHaveText('0 points remaining');
  await expect(page.locator('[data-action="buster-save"]')).toBeEnabled();

  const staleDraft = await page.evaluate(async () => {
    const { game } = window;
    await game.updateBusterDraft('build-a', { type: 'setTuning', stat: 'power', value: 5 });
    await game.updateBusterDraft('build-a', { type: 'setTuning', stat: 'rapid', value: 3 });
    const view = game.getBusterLabViewModel('build-a');
    const equip = await game.equipCustomBuster('build-a', 1);
    await game.updateBusterDraft('build-a', { type: 'setTuning', stat: 'power', value: 4 });
    await game.updateBusterDraft('build-a', { type: 'setTuning', stat: 'rapid', value: 4 });
    game.ui._renderBusterLab();
    return { valid: view.validation.valid, canEquip: view.canEquip, equip };
  });
  expect(staleDraft.valid).toBe(true);
  expect(staleDraft.canEquip).toBe(false);
  expect(staleDraft.equip.ok).toBe(false);
  expect(staleDraft.equip.message).toContain('Save this draft');

  await page.locator('[data-action="buster-save"]').click();
  await page.locator('[data-action="buster-equip"][data-slot-index="1"]').click();
  await expect.poll(() => page.evaluate(() => window.game.busterLabState.assignments.slots['1']))
    .toBe('build-a');

  const equipped = await page.evaluate(() => ({
    activeSlot: window.game.player.activeArmIndex,
    resolved: window.game.getResolvedArmSlot(1),
    assignment: window.game.busterLabState.assignments.slots['1'],
  }));
  expect(equipped.activeSlot).toBe(1);
  expect(equipped.resolved).toEqual({ kind: 'customBuster', buildId: 'build-a' });
  expect(equipped.assignment).toBe('build-a');

  await page.reload();
  await waitForGame(page);
  const persistedAssignment = await page.evaluate(() => {
    const { game } = window;
    const snapshot = {
      resolved: game.getResolvedArmSlot(1),
      assignment: game.busterLabState.assignments.slots['1'],
      displacedSwordCount: game.inventory.items.filter((item) => item.type === 'swordArm').length,
    };
    game.player.switchArmWeapon(1, true);
    game.setInventoryOpen(true, { mode: 'roll' });
    return snapshot;
  });
  expect(persistedAssignment.resolved).toEqual({ kind: 'customBuster', buildId: 'build-a' });
  expect(persistedAssignment.assignment).toBe('build-a');
  expect(persistedAssignment.displacedSwordCount).toBeGreaterThanOrEqual(1);
  await page.getByRole('tab', { name: 'Buster Lab' }).click();

  await page.evaluate(() => {
    window.game.setBusterRangeBenchmarkOptions({ targetCount: 2, profile: 'moving' });
    window.game.ui._renderBusterLab();
  });
  await page.locator('[data-action="buster-test-range"]').click();
  await expect.poll(() => page.evaluate(() => Boolean(window.game.busterTestRange?.active))).toBe(true);

  const shot = await page.evaluate(() => {
    const { game } = window;
    const range = game.busterTestRange;
    const target = range.dummies[0];
    const origin = game.player.getProjectileOrigin?.() ?? game.player.getAttackOrigin();
    const aimPoint = target.root.position.clone();
    aimPoint.y += 1.05;
    const direction = aimPoint.clone().sub(origin).normalize();
    const beforeHealth = target.health;
    const beforeExperience = game.player.experience;
    const beforeGold = game.inventory.gold;
    const beforeScrap = game.rollSalvageStorage.identifiedScrap;
    const fired = game.busterRuntime.fire({
      origin: origin.clone(),
      direction,
      aimPoint,
      target,
      noRewards: true,
    });
    for (let index = 0; index < 120 && target.health === beforeHealth; index += 1) {
      game.projectiles.update(1 / 120);
    }
    return {
      fired: fired.ok,
      damage: beforeHealth - target.health,
      energy: game.busterRuntime.getHudState(range.plan.weaponKey).energy,
      reservations: game.busterRuntime.getReservedProjectileCount(),
      rewardsUnchanged: game.player.experience === beforeExperience
        && game.inventory.gold === beforeGold
        && game.rollSalvageStorage.identifiedScrap === beforeScrap,
      dummyCount: range.dummies.length,
      movingDummyMoves: (() => {
        const moving = range.dummies[1];
        const beforeX = moving.root.position.x;
        moving.update(0.5);
        return moving.root.position.x !== beforeX;
      })(),
    };
  });

  expect(shot.fired).toBe(true);
  expect(shot.damage).toBeGreaterThan(0);
  expect(shot.energy).toBe(4);
  expect(shot.reservations).toBe(0);
  expect(shot.rewardsUnchanged).toBe(true);
  expect(shot.dummyCount).toBe(2);
  expect(shot.movingDummyMoves).toBe(true);

  const restoration = await page.evaluate(() => {
    const { game } = window;
    const restore = game.busterTestRange.restore;
    const expectedPosition = restore.position.toArray();
    const expectedSlot = restore.activeArmIndex;
    const expectedBattery = restore.runtimeResources.states.find((entry) => entry.key === 'build-a')?.energy;
    const exited = game.exitBusterTestRange();
    return {
      exited,
      active: Boolean(game.busterTestRange?.active),
      position: game.player.root.position.toArray(),
      expectedPosition,
      activeSlot: game.player.activeArmIndex,
      expectedSlot,
      inventoryOpen: game.inventoryOpen,
      workshopMode: game.ui.inventoryMode,
      battery: game.busterRuntime.getHudState('build-a').energy,
      expectedBattery,
      rangeProjectiles: game.projectiles.active.filter((projectile) => projectile.attackMeta?.busterRange).length,
    };
  });

  expect(restoration.exited).toBe(true);
  expect(restoration.active).toBe(false);
  expect(restoration.position).toEqual(restoration.expectedPosition);
  expect(restoration.activeSlot).toBe(restoration.expectedSlot);
  expect(restoration.inventoryOpen).toBe(true);
  expect(restoration.workshopMode).toBe('roll');
  expect(restoration.battery).toBe(restoration.expectedBattery);
  expect(restoration.rangeProjectiles).toBe(0);

  const replacement = await page.evaluate(async () => {
    const { game } = window;
    await game.equipCustomBuster('build-a', 2);
    const afterMove = {
      oldSlot: game.player.armHotbar[1],
      newSlotBuildId: game.player.armHotbar[2]?.buildId,
      assignments: { ...game.busterLabState.assignments.slots },
    };
    await game.equipCustomBuster('build-a', 1);
    const replacementArm = game.inventory.items.find((item) => item.type === 'machineGunArm');
    await game.ui._assignArmWeaponToSlot(replacementArm.id, 1);
    const afterManual = {
      slotType: game.player.armHotbar[1]?.type,
      assignment: game.busterLabState.assignments.slots['1'],
      customInventoryCount: game.inventory.items.filter((item) => item.type === 'customBusterArm').length,
    };
    return { afterMove, afterManual };
  });
  expect(replacement.afterMove.oldSlot).toBe(null);
  expect(replacement.afterMove.newSlotBuildId).toBe('build-a');
  expect(replacement.afterMove.assignments).toEqual({ 1: null, 2: 'build-a' });
  expect(replacement.afterManual.slotType).toBe('machineGunArm');
  expect(replacement.afterManual.assignment).toBe(null);
  expect(replacement.afterManual.customInventoryCount).toBe(0);

  const failedAnalysis = await page.evaluate(async () => {
    const { game } = window;
    game.inventory.unidentifiedScrap = 0;
    game.inventory.unidentifiedRecoveries = [];
    game.inventory.addUnidentifiedScrap(2, {
      source: { enemyId: 'test-reaverbot' },
      recoverableParts: [{ id: 'rubyOpticLens', name: 'Ruby Optic Lens', quantity: 1 }],
    });
    const originalIdentify = game.busterLabStorage.identifyRecoveriesWithBossRewards;
    game.busterLabStorage.identifyRecoveriesWithBossRewards = async () => ({
      ok: false,
      reason: 'transaction-failed',
      error: new Error('quota full'),
    });
    const result = await game.identifyReaverbotScrap();
    game.busterLabStorage.identifyRecoveriesWithBossRewards = originalIdentify;
    return {
      ok: result.ok,
      unidentified: game.inventory.unidentifiedScrap,
      recoveries: game.inventory.unidentifiedRecoveries.length,
      storedParts: game.rollSalvageStorage.getStoredPartCount(),
    };
  });
  expect(failedAnalysis).toEqual({ ok: false, unidentified: 2, recoveries: 1, storedParts: 0 });
  expect(runtimeErrors).toEqual([]);
});

test('Roll UI stores ownership-free blueprints and atomically materializes an original route', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?busterLab=1&busterLabDebug=1&reaverbotSeed=buster-blueprint-ui');
  await waitForGame(page);
  await page.evaluate(() => window.game.setInventoryOpen(true, { mode: 'roll' }));
  await page.getByRole('tab', { name: 'Buster Lab' }).click();

  const debugGrant = await page.evaluate(() => window.game.grantBusterLabDebugKit());
  expect(debugGrant.ok).toBe(true);
  await page.evaluate(() => window.game.ui._renderBusterLab());

  const payload = page.locator('[data-buster-program="payload"]');
  await payload.selectOption('explosion');
  await expect.poll(() => page.evaluate(() => (
    window.game.getBusterLabViewModel('build-a').programSelections.payload
  ))).toBe('explosion');

  await page.locator('[data-action="buster-blueprint-new"]').click();
  await expect(page.locator('#buster-blueprint-count')).toHaveText('1 / 8');
  const blueprintId = await page.evaluate(() => window.game.selectedBusterBlueprintId);
  expect(blueprintId).toMatch(/^blueprint-/);

  const ownershipFree = await page.evaluate((id) => {
    const blueprint = window.game.busterLabState.blueprints.find((entry) => entry.blueprintId === id);
    return {
      rulesetVersion: blueprint.rulesetVersion,
      nodeModuleIds: blueprint.program.nodes.map((node) => node.moduleId),
      hasPhysicalIds: blueprint.program.nodes.some((node) => (
        Object.hasOwn(node, 'moduleInstanceId') || Object.hasOwn(node, 'instanceId')
      )),
    };
  }, blueprintId);
  expect(ownershipFree).toEqual({
    rulesetVersion: 'custom-buster-v0.2',
    nodeModuleIds: ['pulseBolt', 'explosion'],
    hasPhysicalIds: false,
  });

  const resourceBefore = await page.evaluate(async () => {
    const { game } = window;
    const committed = await game.busterLabStorage.transact({
      operation: 'browser-test-reserve-debug-explosion',
    }, (state) => {
      state.moduleInstances = state.moduleInstances.filter((entry) => (
        entry.moduleId !== 'explosion' || entry.origin !== 'debug'
      ));
      return true;
    });
    if (!committed.ok) throw committed.error ?? new Error('Could not reserve the debug Explosion copy.');
    game.busterLabState = committed.state;
    game._refreshRollSalvageStorage();
    game._recompileBusterPlans();
    game.ui._renderBusterLab();
    return {
      revision: game.busterLabStorage.revision,
      scrap: game.busterLabState.rollSalvage.identifiedScrap,
      volatileCells: game.busterLabState.rollSalvage.parts.volatileOverloadCell?.quantity ?? 0,
    };
  });
  expect(resourceBefore.scrap).toBe(66);
  expect(resourceBefore.volatileCells).toBe(1);

  await page.locator('[data-action="buster-materialize-suggest"]').click();
  await expect(page.locator('#buster-materialization-suggestion')).toBeVisible();
  await expect(page.locator('#buster-materialization-suggestion')).toContainText('Explosion');
  const route = page.locator('[data-buster-materialization-module="payload"]');
  await expect(route).toHaveValue('original');
  await expect(route.locator('option:checked')).toContainText('Original fabrication');
  await expect(page.locator('#buster-materialize-confirm')).toBeEnabled();

  await page.locator('#buster-materialize-confirm').click();
  await expect.poll(() => page.evaluate(() => (
    window.game.busterLabState.chassisBuilds
      .find((entry) => entry.buildId === 'build-a')?.program.nodes
      .find((node) => node.moduleId === 'explosion')?.moduleInstanceId ?? null
  ))).not.toBeNull();

  const materialized = await page.evaluate((id) => {
    const { game } = window;
    const blueprint = game.busterLabState.blueprints.find((entry) => entry.blueprintId === id);
    const build = game.busterLabState.chassisBuilds.find((entry) => entry.buildId === 'build-a');
    const explosion = build.program.nodes.find((node) => node.moduleId === 'explosion');
    const instance = game.busterLabState.moduleInstances.find((entry) => (
      entry.instanceId === explosion.moduleInstanceId
    ));
    return {
      blueprintStillOwnershipFree: blueprint.program.nodes.every((node) => (
        !Object.hasOwn(node, 'moduleInstanceId')
      )),
      buildHasPhysicalAssignments: build.program.nodes
        .filter((node) => !['pulsePayload', 'onImpact', 'afterDelay'].includes(node.moduleId))
        .every((node) => typeof node.moduleInstanceId === 'string'),
      route: instance.fabricationRoute,
      origin: instance.origin,
      scrap: game.busterLabState.rollSalvage.identifiedScrap,
      volatileCells: game.busterLabState.rollSalvage.parts.volatileOverloadCell?.quantity ?? 0,
      revisionAdvanced: game.busterLabStorage.revision > 0,
      pendingSuggestion: game.pendingBusterMaterializationSuggestion,
    };
  }, blueprintId);
  expect(materialized).toEqual({
    blueprintStillOwnershipFree: true,
    buildHasPhysicalAssignments: true,
    route: 'original',
    origin: 'fabricated',
    scrap: 56,
    volatileCells: 0,
    revisionAdvanced: true,
    pendingSuggestion: null,
  });
  expect(runtimeErrors).toEqual([]);
});

test('full-catalog sandbox isolates ids, rejects durable writes, and remains leak-free across reuse', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?busterLab=sandbox&busterLabDebug=1&reaverbotSeed=buster-sandbox-freeze');
  await waitForGame(page);

  const result = await page.evaluate(async () => {
    const { game } = window;
    game.stop();
    game.setInventoryOpen(true, { mode: 'roll' });
    const production = {
      scene: game.scene,
      player: game.player,
      inventory: game.inventory,
      projectiles: game.projectiles,
      runtime: game.busterRuntime,
      combat: game.combat,
      enemies: game.enemies,
      enemyIdAllocator: game.enemyIdAllocator,
      nextEnemyId: game.enemyIdAllocator.snapshot(),
      seed: game.dungeon.layoutSeed,
      position: game.player.root.position.toArray(),
      health: game.player.health,
      experience: game.player.experience,
      gold: game.inventory.gold,
      elapsedTime: game.elapsedTime,
      storage: localStorage.getItem(game.busterLabStorage.storageKeys.main),
      revision: game.busterLabStorage.revision,
      writeId: game.busterLabStorage.writeId,
      debugGrantCount: game.busterLabState.migrations.debugKitGrantCount ?? 0,
      sceneChildCount: game.scene.children.length,
    };
    let releasePendingCommand = null;
    const pendingCommandGate = new Promise((resolve) => { releasePendingCommand = resolve; });
    const pendingCommand = game._queueBusterGameCommand(() => pendingCommandGate);
    const blockedByPendingCommand = game.enterBusterSandbox('build-a');
    releasePendingCommand({ ok: true });
    await pendingCommand;
    let releasePendingStorage = null;
    const pendingStorageGate = new Promise((resolve) => { releasePendingStorage = resolve; });
    const pendingStorage = game._queueBusterStorageOperation(() => pendingStorageGate);
    const blockedByPendingStorage = game.enterBusterSandbox('build-a');
    releasePendingStorage({ ok: true });
    await pendingStorage;
    const entered = game.enterBusterSandbox('build-a');
    const session = game.busterSandboxSession;
    const sandboxAllocator = game.enemyIdAllocator;
    const sandboxAllocatedIds = [sandboxAllocator.allocate(), sandboxAllocator.allocate()];
    const isolated = {
      scene: game.scene !== production.scene,
      player: game.player !== production.player,
      inventory: game.inventory !== production.inventory,
      projectiles: game.projectiles !== production.projectiles,
      runtime: game.busterRuntime !== production.runtime,
      combat: game.combat !== production.combat,
      enemies: game.enemies !== production.enemies,
      enemyIdAllocator: sandboxAllocator !== production.enemyIdAllocator,
      enemyIdPrefix: sandboxAllocator.prefix,
      sandboxAllocatedIds,
      productionAllocatorUntouched: production.enemyIdAllocator.snapshot() === production.nextEnemyId,
      sameLayoutSeed: game.dungeon.layoutSeed === production.seed,
      independentProjectileBudget: game.busterRuntime.getReservedProjectileCount() === 0,
      fullHealth: game.player.health === game.player.stats.maxHealth,
      atEntrance: game.player.root.position.distanceTo(game.dungeon.playerStart) < 0.001,
    };

    let durableDebugCalls = 0;
    const originalGrantDebugKitAsync = game.busterLabStorage.grantDebugKitAsync;
    game.busterLabStorage.grantDebugKitAsync = (...args) => {
      durableDebugCalls += 1;
      return originalGrantDebugKitAsync.apply(game.busterLabStorage, args);
    };
    const debugWrite = await game.grantBusterLabDebugKit();
    const draftWrite = await game.updateBusterDraft('build-a', {
      type: 'setTuning',
      stat: 'power',
      value: 5,
    });
    game.busterLabStorage.grantDebugKitAsync = originalGrantDebugKitAsync;
    const rejectedWrites = {
      debugOk: debugWrite.ok,
      debugMessage: debugWrite.message,
      draftOk: draftWrite.ok,
      draftReason: draftWrite.reason,
      durableDebugCalls,
      storageUnchanged: localStorage.getItem(game.busterLabStorage.storageKeys.main) === production.storage,
      revisionUnchanged: game.busterLabStorage.revision === production.revision,
      writeIdUnchanged: game.busterLabStorage.writeId === production.writeId,
      debugGrantCount: game.busterLabState.migrations.debugKitGrantCount ?? 0,
    };

    game.player.root.position.addScalar(17);
    game.player.health = 1;
    game.player.experience += 9000;
    game.inventory.gold += 9000;
    game.elapsedTime += 123;
    game.ruinCompleted = true;
    game.largeRefractorsSecured += 10;
    const sandboxScene = game.scene;
    const sandboxPlayer = game.player;
    const sandboxProjectiles = game.projectiles;
    const sandboxEnemies = game.enemies;
    const submittedBeforeExit = game.updateBusterDraft('build-a', {
      type: 'setTuning',
      stat: 'power',
      value: 6,
    });
    const exited = game.exitBusterSandbox('browserTest');
    const submittedBeforeExitResult = await submittedBeforeExit;
    const restored = {
      scene: game.scene === production.scene,
      player: game.player === production.player,
      inventory: game.inventory === production.inventory,
      projectiles: game.projectiles === production.projectiles,
      runtime: game.busterRuntime === production.runtime,
      combat: game.combat === production.combat,
      enemies: game.enemies === production.enemies,
      enemyIdAllocator: game.enemyIdAllocator === production.enemyIdAllocator,
      enemyIdSequence: game.enemyIdAllocator.snapshot(),
      position: game.player.root.position.toArray(),
      health: game.player.health,
      experience: game.player.experience,
      gold: game.inventory.gold,
      elapsedTime: game.elapsedTime,
      storage: localStorage.getItem(game.busterLabStorage.storageKeys.main),
      revision: game.busterLabStorage.revision,
      writeId: game.busterLabStorage.writeId,
      inventoryOpen: game.inventoryOpen,
      workshopMode: game.ui.inventoryMode,
      sandboxDisposed: sandboxScene.children.length === 0
        && sandboxPlayer.disposed === true
        && sandboxProjectiles.active.length === 0
        && sandboxEnemies.length === 0,
      sessionCleared: game.busterSandboxSession === null,
    };

    const repeatedCycles = [];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const sceneChildCount = game.scene.children.length;
      const cycleEnter = game.enterBusterSandbox('build-a');
      const cycleScene = game.scene;
      const cyclePlayer = game.player;
      const cycleProjectiles = game.projectiles;
      const cycleEnemies = game.enemies;
      const cycleAllocator = game.enemyIdAllocator;
      const allocatedId = cycleAllocator.allocate();
      const cycleExit = game.exitBusterSandbox(`browserReuse${cycle + 1}`);
      repeatedCycles.push({
        entered: cycleEnter.ok,
        exited: cycleExit,
        sandboxId: allocatedId,
        sceneCleared: cycleScene.children.length === 0,
        playerDisposed: cyclePlayer.disposed === true,
        projectilesCleared: cycleProjectiles.active.length === 0,
        enemiesCleared: cycleEnemies.length === 0,
        productionSceneStable: game.scene.children.length === sceneChildCount,
        productionIdentityRestored: game.scene === production.scene
          && game.player === production.player
          && game.inventory === production.inventory
          && game.enemies === production.enemies,
        allocatorRestored: game.enemyIdAllocator === production.enemyIdAllocator
          && game.enemyIdAllocator.snapshot() === production.nextEnemyId,
        storageUnchanged: localStorage.getItem(game.busterLabStorage.storageKeys.main) === production.storage
          && game.busterLabStorage.revision === production.revision
          && game.busterLabStorage.writeId === production.writeId,
      });
    }
    return {
      pendingBarrier: {
        gameCommandOk: blockedByPendingCommand.ok,
        gameCommandReason: blockedByPendingCommand.reason,
        storageOk: blockedByPendingStorage.ok,
        storageReason: blockedByPendingStorage.reason,
        gamePending: game.busterGameCommandPending,
        storagePending: game.busterStorageOperationPending,
      },
      entered: entered.ok,
      sessionActive: Boolean(session?.active),
      isolated,
      rejectedWrites,
      exited,
      submittedBeforeExit: {
        ok: submittedBeforeExitResult.ok,
        reason: submittedBeforeExitResult.reason,
      },
      restored,
      repeatedCycles,
      production: {
        position: production.position,
        health: production.health,
        experience: production.experience,
        gold: production.gold,
        elapsedTime: production.elapsedTime,
        storage: production.storage,
        revision: production.revision,
        writeId: production.writeId,
        nextEnemyId: production.nextEnemyId,
        debugGrantCount: production.debugGrantCount,
      },
    };
  });

  expect(result.pendingBarrier).toEqual({
    gameCommandOk: false,
    gameCommandReason: 'campaign-command-pending',
    storageOk: false,
    storageReason: 'campaign-command-pending',
    gamePending: 0,
    storagePending: 0,
  });
  expect(result.entered).toBe(true);
  expect(result.sessionActive).toBe(true);
  expect(result.isolated).toEqual({
    scene: true,
    player: true,
    inventory: true,
    projectiles: true,
    runtime: true,
    combat: true,
    enemies: true,
    enemyIdAllocator: true,
    enemyIdPrefix: 'sandbox-enemy',
    sandboxAllocatedIds: ['sandbox-enemy-1', 'sandbox-enemy-2'],
    productionAllocatorUntouched: true,
    sameLayoutSeed: true,
    independentProjectileBudget: true,
    fullHealth: true,
    atEntrance: true,
  });
  expect(result.rejectedWrites.debugOk).toBe(false);
  expect(result.rejectedWrites.debugMessage).toContain('could not be granted');
  expect(result.rejectedWrites.draftOk).toBe(false);
  expect(result.rejectedWrites.draftReason).toBe('sandbox-read-only');
  expect(result.rejectedWrites.durableDebugCalls).toBe(0);
  expect(result.rejectedWrites.storageUnchanged).toBe(true);
  expect(result.rejectedWrites.revisionUnchanged).toBe(true);
  expect(result.rejectedWrites.writeIdUnchanged).toBe(true);
  expect(result.rejectedWrites.debugGrantCount).toBe(result.production.debugGrantCount);
  expect(result.exited).toBe(true);
  expect(result.submittedBeforeExit).toEqual({ ok: false, reason: 'sandbox-read-only' });
  expect(result.restored).toEqual({
    scene: true,
    player: true,
    inventory: true,
    projectiles: true,
    runtime: true,
    combat: true,
    enemies: true,
    enemyIdAllocator: true,
    enemyIdSequence: result.production.nextEnemyId,
    position: result.production.position,
    health: result.production.health,
    experience: result.production.experience,
    gold: result.production.gold,
    elapsedTime: result.production.elapsedTime,
    storage: result.production.storage,
    revision: result.production.revision,
    writeId: result.production.writeId,
    inventoryOpen: true,
    workshopMode: 'roll',
    sandboxDisposed: true,
    sessionCleared: true,
  });
  expect(result.repeatedCycles).toHaveLength(3);
  for (const [index, cycle] of result.repeatedCycles.entries()) {
    expect(cycle).toEqual({
      entered: true,
      exited: true,
      sandboxId: 'sandbox-enemy-1',
      sceneCleared: true,
      playerDisposed: true,
      projectilesCleared: true,
      enemiesCleared: true,
      productionSceneStable: true,
      productionIdentityRestored: true,
      allocatorRestored: true,
      storageUnchanged: true,
    });
    expect(index).toBeLessThan(3);
  }
  expect(runtimeErrors).toEqual([]);
});

test('production projectile lifecycle runs Explosion, Delay, Impact, and Apex programs deterministically', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?busterLab=1&reaverbotSeed=buster-lifecycle-runtime');
  await waitForGame(page);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const offensiveStats = ['attackDamage', 'fireDamage', 'projectileCount', 'criticalChance', 'lifeSteal', 'chainChance', 'explodeOnKillChance'];
    const originalOffense = Object.fromEntries(offensiveStats.map((key) => [key, game.player.stats[key]]));
    Object.assign(game.player.stats, {
      attackDamage: 999,
      fireDamage: 777,
      projectileCount: 9,
      criticalChance: 1,
      lifeSteal: 1,
      chainChance: 1,
      explodeOnKillChance: 1,
    });
    const starterInstanceId = 'module-pulse-starter';
    const instanceSpecs = [
      ['module-explosion-test', 'explosion'],
      ['module-cluster-test', 'cluster5'],
      ['module-spread-test', 'spread3'],
      ['module-mortar-test', 'mortarShell'],
      ['module-apex-test', 'atApex'],
    ];
    const seeded = game.busterLabStorage.mutate((state) => {
      for (const [instanceId, moduleId] of instanceSpecs) {
        if (state.moduleInstances.some((entry) => entry.instanceId === instanceId)) continue;
        state.moduleInstances.push({
          id: instanceId,
          instanceId,
          moduleInstanceId: instanceId,
          moduleId,
          name: moduleId,
          origin: 'fabricated',
          fabricationSequence: state.nextInstanceId++,
        });
      }
    });
    if (!seeded.ok) throw seeded.error;
    game.busterLabState = seeded.state;

    const makeBuild = (nodes, edges) => ({
      schemaVersion: 1,
      rulesetVersion: 'custom-buster-v0.2',
      buildId: 'build-a',
      chassisId: 'chassis-a',
      name: 'Build A',
      tuning: { power: 4, energy: 4, range: 4, rapid: 4 },
      program: { rootNodeId: nodes[0].nodeId, nodes, edges },
    });
    const install = (build) => {
      const draft = game.busterLabStorage.saveDraft(build);
      if (!draft.ok) throw draft.error;
      const saved = game.busterLabStorage.saveBuild(build);
      if (!saved.ok) throw new Error(`Build rejected: ${JSON.stringify(saved.errors)}`);
      game.busterLabState = saved.state;
      game._recompileBusterPlans();
      return game.busterLabPlans.get('build-a');
    };
    const fireAt = (target = null, fallbackDirection = null) => {
      const range = game.busterTestRange;
      game.player.root.updateMatrixWorld(true);
      const origin = game.player.getProjectileOrigin?.() ?? game.player.getAttackOrigin();
      const aimPoint = target
        ? target.root.position.clone().add({ x: 0, y: 1.05, z: 0 })
        : origin.clone().addScaledVector(fallbackDirection, range.plan.stats.rootRange);
      const direction = aimPoint.clone().sub(origin).normalize();
      return game.busterRuntime.fire({
        origin: origin.clone(),
        direction,
        aimPoint,
        target,
        noRewards: true,
      });
    };
    const activeFor = (token) => game.projectiles.active.filter((projectile) => (
      projectile.reservationToken === token
    ));

    install(makeBuild([
      { nodeId: 'pulse', moduleId: 'pulseBolt', moduleInstanceId: starterInstanceId },
      { nodeId: 'explosion', moduleId: 'explosion', moduleInstanceId: 'module-explosion-test' },
    ], [{ from: 'pulse', port: 'next', to: 'explosion' }]));
    game.enterBusterTestRange('build-a');
    const explosionTarget = game.busterTestRange.dummies[0];
    const explosionHealth = explosionTarget.health;
    const playerHealth = game.player.health;
    let mineTriggers = 0;
    const originalTriggerMines = game.combat.triggerMinesNear;
    game.combat.triggerMinesNear = () => { mineTriggers += 1; };
    const flatWavesBefore = game.timedEffects.filter((effect) => effect.object?.name === 'explosionWave').length;
    const explosionShot = fireAt(explosionTarget);
    for (let step = 0; step < 180 && explosionTarget.health === explosionHealth; step += 1) {
      game.projectiles.update(1 / 180);
    }
    game.combat.triggerMinesNear = originalTriggerMines;
    const explosionEffect = game.timedEffects.find((effect) => effect.kind === 'busterExplosionSphere');
    const scaleBeforeUpdate = explosionEffect?.object.scale.x ?? 0;
    game._updateTimedEffects(0.08);
    const visual = {
      kind: explosionEffect?.kind ?? null,
      name: explosionEffect?.object.name ?? null,
      style: explosionEffect?.object.userData.explosionVisual ?? null,
      children: explosionEffect?.object.children.map((child) => child.name) ?? [],
      geometryTypes: explosionEffect?.object.children.map((child) => child.geometry.type) ?? [],
      colors: explosionEffect?.object.children.map((child) => `#${child.material.color.getHexString()}`) ?? [],
      expands: (explosionEffect?.object.scale.x ?? 0) > scaleBeforeUpdate,
      flatRingsCreated: game.timedEffects.filter((effect) => effect.object?.name === 'explosionWave').length - flatWavesBefore,
      cleanedUp: false,
      materialsDisposed: 0,
    };
    for (const child of explosionEffect?.object.children ?? []) {
      child.material.addEventListener('dispose', () => { visual.materialsDisposed += 1; });
    }
    game._updateTimedEffects(0.5);
    visual.cleanedUp = !explosionEffect?.object.parent && !game.timedEffects.includes(explosionEffect);
    const explosion = {
      fired: explosionShot.ok,
      damage: explosionHealth - explosionTarget.health,
      playerDamage: playerHealth - game.player.health,
      mineTriggers,
      visual,
    };
    game.exitBusterTestRange();

    install(makeBuild([
      { nodeId: 'pulse', moduleId: 'pulseBolt', moduleInstanceId: starterInstanceId },
      { nodeId: 'delay', moduleId: 'afterDelay', moduleInstanceId: null },
      { nodeId: 'cluster', moduleId: 'cluster5', moduleInstanceId: 'module-cluster-test' },
    ], [
      { from: 'pulse', port: 'next', to: 'delay' },
      { from: 'delay', port: 'child', to: 'cluster' },
    ]));
    game.enterBusterTestRange('build-a');
    const delayShot = fireAt(null, game.player.lastMoveDirection.clone().set(1, 0, 0));
    for (let step = 0; step < 59; step += 1) game.projectiles.update(0.01);
    const beforeDelay = activeFor(delayShot.execution.reservationToken).map((projectile) => projectile.actionId);
    game.projectiles.update(0.011);
    const delayedChildren = activeFor(delayShot.execution.reservationToken);
    const firstDirections = delayedChildren.map((projectile) => projectile.direction.toArray().map((value) => Number(value.toFixed(6))));
    const delay = {
      beforeDelay,
      childCount: delayedChildren.length,
      actionIds: delayedChildren.map((projectile) => projectile.actionId),
      powers: delayedChildren.map((projectile) => projectile.damage),
      reservation: game.busterRuntime.getReservedProjectileCount(),
      firstDirections,
    };
    const delayKey = game.busterTestRange.plan.weaponKey;
    game.busterRuntime.cancelBuild(delayKey, 'repeat-proof');
    game.busterRuntime.resetWeapon(delayKey);
    game.busterRuntime.equip(game.busterTestRange.plan);
    const repeatShot = fireAt(null, game.player.lastMoveDirection.clone().set(1, 0, 0));
    for (let step = 0; step < 59; step += 1) game.projectiles.update(0.01);
    game.projectiles.update(0.011);
    delay.repeatDirections = activeFor(repeatShot.execution.reservationToken)
      .map((projectile) => projectile.direction.toArray().map((value) => Number(value.toFixed(6))));
    game.exitBusterTestRange();

    install(makeBuild([
      { nodeId: 'pulse', moduleId: 'pulseBolt', moduleInstanceId: starterInstanceId },
      { nodeId: 'impact', moduleId: 'onImpact', moduleInstanceId: null },
      { nodeId: 'spread', moduleId: 'spread3', moduleInstanceId: 'module-spread-test' },
    ], [
      { from: 'pulse', port: 'next', to: 'impact' },
      { from: 'impact', port: 'child', to: 'spread' },
    ]));
    game.enterBusterTestRange('build-a');
    const impactTarget = game.busterTestRange.dummies[0];
    const impactHealth = impactTarget.health;
    const childSpawnEvents = [];
    const originalProjectileSpawn = game.projectiles.spawn;
    game.projectiles.spawn = function recordBusterChildSpawn(options) {
      const projectile = originalProjectileSpawn.call(this, options);
      if (projectile && options.actionId === 'emit-child') {
        childSpawnEvents.push({
          reservationToken: options.reservationToken,
          damage: options.damage,
        });
      }
      return projectile;
    };
    const impactShot = fireAt(impactTarget);
    const impactToken = impactShot.execution.reservationToken;
    let impactChildSpawns = [];
    for (let step = 0; step < 180 && impactChildSpawns.length === 0; step += 1) {
      game.projectiles.update(1 / 180);
      impactChildSpawns = childSpawnEvents
        .filter((event) => event.reservationToken === impactToken);
    }
    const impact = {
      deliveredDamage: impactHealth - impactTarget.health,
      childCount: impactChildSpawns.length,
      childPowers: impactChildSpawns.map((event) => event.damage),
    };
    game.busterRuntime.cancelBuild(game.busterTestRange.plan.weaponKey, 'range-end-proof');
    game.busterRuntime.resetWeapon(game.busterTestRange.plan.weaponKey);
    game.busterRuntime.equip(game.busterTestRange.plan);
    const rangeEndShot = fireAt(null, game.player.lastMoveDirection.clone().set(-1, 0, 0));
    game.projectiles.update(1);
    impact.rangeEndChildCount = childSpawnEvents
      .filter((event) => event.reservationToken === rangeEndShot.execution.reservationToken).length;
    game.projectiles.spawn = originalProjectileSpawn;
    game.exitBusterTestRange();

    install(makeBuild([
      { nodeId: 'mortar', moduleId: 'mortarShell', moduleInstanceId: 'module-mortar-test' },
      { nodeId: 'apex', moduleId: 'atApex', moduleInstanceId: 'module-apex-test' },
      { nodeId: 'payload', moduleId: 'pulsePayload', moduleInstanceId: null },
    ], [
      { from: 'mortar', port: 'next', to: 'apex' },
      { from: 'apex', port: 'child', to: 'payload' },
    ]));
    game.enterBusterTestRange('build-a');
    const apexShot = fireAt(null, game.player.lastMoveDirection.clone().set(1, 0, 0));
    const apexRoot = activeFor(apexShot.execution.reservationToken)[0];
    const elevationDelta = apexRoot.endY - apexRoot.baseY;
    const ratio = -elevationDelta / (apexRoot.arcHeight * Math.PI);
    const apexProgress = ratio <= -1 ? 1 : ratio >= 1 ? 0 : Math.acos(ratio) / Math.PI;
    const expectedApexTime = (apexRoot.range * apexProgress) / apexRoot.speed;
    let elapsed = 0;
    let apexChildren = [];
    while (elapsed < 2 && apexChildren.length === 0) {
      game.projectiles.update(0.001);
      elapsed += 0.001;
      apexChildren = activeFor(apexShot.execution.reservationToken)
        .filter((projectile) => projectile.actionId === 'emit-child');
    }
    const apex = {
      timingError: Math.abs(elapsed - expectedApexTime),
      childCount: apexChildren.length,
      childArcHeight: apexChildren[0]?.arcHeight ?? 0,
    };
    game.exitBusterTestRange();

    Object.assign(game.player.stats, originalOffense);
    return { explosion, delay, impact, apex };
  });

  expect(result.explosion).toEqual({
    fired: true,
    damage: 8,
    playerDamage: 0,
    mineTriggers: 0,
    visual: {
      kind: 'busterExplosionSphere',
      name: 'busterExplosionSphere',
      style: 'fierySphere',
      children: [
        'busterExplosionFieryShell',
        'busterExplosionFlameCore',
        'busterExplosionHotCore',
      ],
      geometryTypes: ['SphereGeometry', 'IcosahedronGeometry', 'SphereGeometry'],
      colors: ['#ff6a16', '#ffa21a', '#ffe06a'],
      expands: true,
      flatRingsCreated: 0,
      cleanedUp: true,
      materialsDisposed: 3,
    },
  });
  expect(result.delay.beforeDelay).toEqual(['emit-carrier']);
  expect(result.delay.childCount).toBe(5);
  expect(new Set(result.delay.actionIds)).toEqual(new Set(['emit-child']));
  for (const power of result.delay.powers) expect(power).toBeCloseTo(9.984 / 5, 8);
  expect(result.delay.reservation).toBe(5);
  expect(result.delay.repeatDirections).toEqual(result.delay.firstDirections);
  expect(result.impact.deliveredDamage).toBeCloseTo(1.6 + 7.04, 8);
  expect(result.impact.childCount).toBe(3);
  for (const power of result.impact.childPowers) expect(power).toBeCloseTo(7.04 / 3, 8);
  expect(result.impact.rangeEndChildCount).toBe(3);
  expect(result.apex.childCount).toBe(1);
  expect(result.apex.timingError).toBeLessThan(0.0021);
  expect(result.apex.childArcHeight).toBeGreaterThan(0);
  expect(runtimeErrors).toEqual([]);
});

test('corrupt local Lab data is quarantined with a visible warning and safe Mega fallback', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.addInitScript(() => {
    const saveContextId = 'campaign-browser-corrupt';
    localStorage.setItem('ruinDigger.saveContext.v1', JSON.stringify({
      storageVersion: 1,
      saveContextId,
    }));
    localStorage.setItem(`ruinDigger.busterLab.v2.${encodeURIComponent(saveContextId)}`, '{not valid json');
  });
  await page.goto('/?busterLab=1&reaverbotSeed=buster-corrupt-save');
  await waitForGame(page);
  await page.evaluate(() => window.game.setInventoryOpen(true, { mode: 'roll' }));
  await page.getByRole('tab', { name: 'Buster Lab' }).click();

  await expect(page.locator('#buster-lab-warning')).toBeVisible();
  await expect(page.locator('#buster-lab-warning')).toContainText('safe starter lab');
  const fallback = await page.evaluate(() => ({
    active: window.game.getResolvedArmSlot(window.game.player.activeArmIndex),
    starterPlan: window.game.busterLabPlans.has('build-a'),
    megaPlan: window.game.busterLabPlans.has('megaBuster'),
  }));
  expect(fallback.active).toEqual({ kind: 'megaBuster' });
  expect(fallback.starterPlan).toBe(true);
  expect(fallback.megaPlan).toBe(true);

  expect(runtimeErrors).toEqual([]);
});

test('unknown module ids preserve the invalid draft and force the Mega Buster fallback', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?busterLab=1&reaverbotSeed=buster-unknown-module');
  await waitForGame(page);
  await page.waitForFunction(() => (
    window.game?.dungeon?.group?.getObjectByName('rollCaskettNpc')?.userData?.animationAssetsSettled === true
  ));
  await page.evaluate(() => {
    const key = window.game.busterLabStorage.storageKeys.main;
    const envelope = JSON.parse(localStorage.getItem(key));
    const state = envelope.state;
    state.moduleInstances[0].moduleId = 'futureArcOrb';
    state.moduleInstances[0].name = 'Future Arc Orb';
    state.chassisBuilds[0].program.nodes[0].moduleId = 'futureArcOrb';
    state.chassisDrafts[0].program.nodes[0].moduleId = 'futureArcOrb';
    state.assignments.slots['1'] = 'build-a';
    envelope.revision += 1;
    envelope.writeId = 'browser-unknown-module-injection';
    localStorage.setItem(key, JSON.stringify(envelope));
  });
  await page.reload();
  try {
    await page.waitForFunction(
      () => Boolean(window.game?.combat && window.game?.ui),
      undefined,
      { timeout: 15_000 },
    );
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      gamePublished: Boolean(window.game),
      documentState: document.readyState,
      bodyText: document.body?.innerText?.slice(0, 240) ?? '',
    }));
    throw new Error(`Game reload did not finish: ${JSON.stringify({ diagnostics, runtimeErrors })}`, {
      cause: error,
    });
  }
  await page.evaluate(() => window.game.setInventoryOpen(true, { mode: 'roll' }));
  await page.getByRole('tab', { name: 'Buster Lab' }).click();
  await expect(page.locator('#buster-lab-warning')).toContainText('Unknown Custom Buster modules');
  const quarantine = await page.evaluate(() => {
    const view = window.game.getBusterLabViewModel('build-a');
    return {
      draftModuleId: view.build.draft.program.nodes[0].moduleId,
      savedPlan: window.game.busterLabPlans.has('build-a'),
      megaPlan: window.game.busterLabPlans.has('megaBuster'),
      assignment: window.game.busterLabState.assignments.slots['1'],
      active: window.game.getResolvedArmSlot(window.game.player.activeArmIndex),
    };
  });
  expect(quarantine.draftModuleId).toBe('futureArcOrb');
  expect(quarantine.savedPlan).toBe(false);
  expect(quarantine.megaPlan).toBe(true);
  expect(quarantine.assignment).toBe(null);
  expect(quarantine.active).toEqual({ kind: 'megaBuster' });
  expect(runtimeErrors).toEqual([]);
});
