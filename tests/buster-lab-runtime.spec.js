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

test('feature flag off keeps the legacy Buster and Roll workshop path intact', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?reaverbotSeed=buster-feature-off');
  await waitForGame(page);

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
      unifiedHud: Boolean(game.combat.getWeaponHudData()?.unifiedBuster),
    };
  });

  expect(state).toEqual({
    enabled: false,
    runtime: null,
    plan: null,
    rollTabsHidden: true,
    busterDebugTabHidden: true,
    starterPowerRaisers: 1,
    unifiedHud: false,
  });
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
      'afterDelay',
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
      namedPartCount: Object.keys(state.rollSalvage.parts).length,
      assignments: { ...state.assignments.slots },
    };
  });

  expect(first.grantCount).toBe(1);
  expect(first.moduleCounts).toEqual({
    pulseBolt: 2,
    mortarShell: 1,
    pursuitGuidance: 1,
    atApex: 1,
    afterDelay: 1,
    spread3: 1,
    cluster5: 1,
    explosion: 1,
  });
  expect(first.moduleTotal).toBe(9);
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
  expect(first.scrap).toBe(0);
  expect(first.namedPartCount).toBe(0);
  expect(first.assignments).toEqual({ 1: null, 2: null });

  await page.getByRole('button', { name: 'Grant one of each Buster part' }).click();
  await expect(page.locator('#buster-debug-status')).toContainText('2 kits granted');
  const second = await page.evaluate(() => ({
    grantCount: window.game.busterLabState.migrations.debugKitGrantCount,
    moduleTotal: window.game.busterLabState.moduleInstances.length,
    chassisCount: window.game.busterLabState.chassisInstances.length,
    calibrationCount: window.game.busterLabState.megaCalibrations.instances.length,
  }));
  expect(second).toEqual({ grantCount: 2, moduleTotal: 17, chassisCount: 2, calibrationCount: 13 });

  await page.reload();
  await waitForGame(page);
  await page.evaluate(() => window.game.setPoseDebugOpen(true));
  await expect(page.locator('#buster-debug-status')).toContainText('2 kits granted');
  expect(runtimeErrors).toEqual([]);
});

test('Mega and Custom Busters release only after the arm reaches its extended firing pose', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?busterLab=1&reaverbotSeed=buster-extension-timing');
  await waitForGame(page);
  await page.waitForFunction(() => window.game.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(() => {
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
      const hipOrigin = player.getProjectileOrigin().clone();
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
        releaseMovedFromHip: releaseOrigin ? releaseOrigin.distanceTo(hipOrigin) : null,
        pendingAfterRelease: Boolean(combat.pendingCompiledBusterShot),
      };
    };

    const mega = fireTap(0);
    const equipped = game.equipCustomBuster('build-a', 1);
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
    expect(shot.releaseMovedFromHip).toBeGreaterThan(0.1);
    expect(shot.energyAfter).toBeCloseTo(shot.energyBefore - shot.energyCost, 8);
    expect(shot.pendingAfterRelease).toBe(false);
  }
  expect(result.mega.energyCost).toBe(2);
  expect(result.custom.energyCost).toBe(1);
  expect(result.cancellation).toEqual({
    queuedBeforeSwitch: true,
    pendingAfterSwitch: false,
    shotsAfterSwitch: 0,
    energyBefore: 6,
    energyAfter: 6,
  });
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
  expect(initial.megaTuning).toEqual({ power: 6, energy: 4, range: 4, rapid: 4 });
  expect(initial.hud.unifiedBuster).toBe(true);
  expect(initial.hud.singleGauge).toBe(true);

  await page.getByRole('tab', { name: 'Buster Lab' }).click();
  await expect(page.locator('#buster-lab-view')).toBeVisible();
  await expect(page.locator('#buster-compiler-result')).toContainText('Base PWR');
  await expect(page.locator('#buster-tuning-remaining')).toHaveText('0 points remaining');
  await expect(page.locator('[data-action="buster-save"]')).toBeEnabled();

  const staleDraft = await page.evaluate(() => {
    const { game } = window;
    game.updateBusterDraft('build-a', { type: 'setTuning', stat: 'power', value: 5 });
    game.updateBusterDraft('build-a', { type: 'setTuning', stat: 'rapid', value: 3 });
    const view = game.getBusterLabViewModel('build-a');
    const equip = game.equipCustomBuster('build-a', 1);
    game.updateBusterDraft('build-a', { type: 'setTuning', stat: 'power', value: 4 });
    game.updateBusterDraft('build-a', { type: 'setTuning', stat: 'rapid', value: 4 });
    game.ui._renderBusterLab();
    return { valid: view.validation.valid, canEquip: view.canEquip, equip };
  });
  expect(staleDraft.valid).toBe(true);
  expect(staleDraft.canEquip).toBe(false);
  expect(staleDraft.equip.ok).toBe(false);
  expect(staleDraft.equip.message).toContain('Save this draft');

  await page.locator('[data-action="buster-save"]').click();
  await page.locator('[data-action="buster-equip"][data-slot-index="1"]').click();

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
  expect(shot.energy).toBe(5);
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

  const replacement = await page.evaluate(() => {
    const { game } = window;
    game.equipCustomBuster('build-a', 2);
    const afterMove = {
      oldSlot: game.player.armHotbar[1],
      newSlotBuildId: game.player.armHotbar[2]?.buildId,
      assignments: { ...game.busterLabState.assignments.slots },
    };
    game.equipCustomBuster('build-a', 1);
    const replacementArm = game.inventory.items.find((item) => item.type === 'machineGunArm');
    game.ui._assignArmWeaponToSlot(replacementArm.id, 1);
    const afterManual = {
      slotType: game.player.armHotbar[1]?.type,
      assignment: game.busterLabState.assignments.slots['1'],
      customInventoryCount: game.inventory.items.filter((item) => item.type === 'customBusterArm').length,
    };
    game.equipCustomBuster('build-a', 1);
    game.ui._optimizeEquipment();
    return {
      afterMove,
      afterManual,
      optimizedAssignment: game.busterLabState.assignments.slots['1'],
      optimizedCustomInventoryCount: game.inventory.items.filter((item) => item.type === 'customBusterArm').length,
    };
  });
  expect(replacement.afterMove.oldSlot).toBe(null);
  expect(replacement.afterMove.newSlotBuildId).toBe('build-a');
  expect(replacement.afterMove.assignments).toEqual({ 1: null, 2: 'build-a' });
  expect(replacement.afterManual.slotType).toBe('machineGunArm');
  expect(replacement.afterManual.assignment).toBe(null);
  expect(replacement.afterManual.customInventoryCount).toBe(0);
  expect(replacement.optimizedAssignment).toBe(null);
  expect(replacement.optimizedCustomInventoryCount).toBe(0);

  const failedAnalysis = await page.evaluate(() => {
    const { game } = window;
    game.inventory.unidentifiedScrap = 0;
    game.inventory.unidentifiedRecoveries = [];
    game.inventory.addUnidentifiedScrap(2, {
      source: { enemyId: 'test-reaverbot' },
      recoverableParts: [{ id: 'rubyOpticLens', name: 'Ruby Optic Lens', quantity: 1 }],
    });
    const originalOnChange = game.rollSalvageStorage.onChange;
    game.rollSalvageStorage.onChange = () => { throw new Error('quota full'); };
    const result = game.identifyReaverbotScrap();
    game.rollSalvageStorage.onChange = originalOnChange;
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
      ['module-delay-test', 'afterDelay'],
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
      rulesetVersion: 'custom-buster-v0.1',
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
      { nodeId: 'delay', moduleId: 'afterDelay', moduleInstanceId: 'module-delay-test' },
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
    const impactShot = fireAt(impactTarget);
    let impactChildren = [];
    for (let step = 0; step < 180 && impactChildren.length === 0; step += 1) {
      game.projectiles.update(1 / 180);
      impactChildren = activeFor(impactShot.execution.reservationToken)
        .filter((projectile) => projectile.actionId === 'emit-child');
    }
    const impact = {
      carrierDamage: impactHealth - impactTarget.health,
      childCount: impactChildren.length,
      childPowers: impactChildren.map((projectile) => projectile.damage),
    };
    game.busterRuntime.cancelBuild(game.busterTestRange.plan.weaponKey, 'range-end-proof');
    game.busterRuntime.resetWeapon(game.busterTestRange.plan.weaponKey);
    game.busterRuntime.equip(game.busterTestRange.plan);
    const rangeEndShot = fireAt(null, game.player.lastMoveDirection.clone().set(-1, 0, 0));
    game.projectiles.update(1);
    impact.rangeEndChildCount = activeFor(rangeEndShot.execution.reservationToken)
      .filter((projectile) => projectile.actionId === 'emit-child').length;
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
  for (const power of result.delay.powers) expect(power).toBeCloseTo(2, 8);
  expect(result.delay.reservation).toBe(5);
  expect(result.delay.repeatDirections).toEqual(result.delay.firstDirections);
  expect(result.impact.carrierDamage).toBeCloseTo(1.6, 8);
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
    localStorage.setItem('ruinDigger.busterLab.v1', '{not valid json');
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
    const key = 'ruinDigger.busterLab.v1';
    const state = JSON.parse(localStorage.getItem(key));
    state.moduleInstances[0].moduleId = 'futureArcOrb';
    state.moduleInstances[0].name = 'Future Arc Orb';
    state.chassisBuilds[0].program.nodes[0].moduleId = 'futureArcOrb';
    state.chassisDrafts[0].program.nodes[0].moduleId = 'futureArcOrb';
    state.assignments.slots['1'] = 'build-a';
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await waitForGame(page);
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
