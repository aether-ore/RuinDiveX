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
    const animators = window.game?.dungeon?.npcAnimators ?? [];
    return animators.length > 0 && animators.every((animator) => animator.assetsSettled);
  });
}

async function readLiveProfileRanges(page) {
  return page.evaluate(() => {
    const combat = window.game.combat;
    const stats = { ...window.game.player.stats, attackRange: 6 };
    return {
      featureEnabled: window.game.busterLabEnabled,
      base: stats.attackRange,
      machineGun: combat._getProfileRange({ type: 'machineGunArm' }, stats),
      cannon: combat._getProfileRange({ type: 'cannonArm' }, stats),
      missileBase: combat._getProfileRange({
        type: 'missileArm',
        special: 'missile',
        homingRange: 5,
      }, stats),
      missileHoming: combat._getProfileRange({
        type: 'missileArm',
        special: 'missile',
        homingRange: 9.4,
      }, stats),
    };
  });
}

test('live legacy Range resolution is identical with and without the obsolete Buster Lab query', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?startupWorld=dungeon&reaverbotSeed=buster-range-parity-off');
  await waitForGame(page);
  const featureOff = await readLiveProfileRanges(page);
  // Let Roll's queued local FBX requests settle before navigating. Chromium
  // reports aborted navigation fetches as console errors even though they are
  // unrelated to the Range contract being compared here.
  await waitForRollAssets(page);

  await page.goto('/?startupWorld=dungeon&busterLab=1&reaverbotSeed=buster-range-parity-on');
  await waitForGame(page);
  const featureOn = await readLiveProfileRanges(page);

  expect(featureOff).toEqual({
    featureEnabled: true,
    base: 6,
    machineGun: 6,
    cannon: 6,
    missileBase: 7.8,
    missileHoming: 9.4,
  });
  expect(featureOn).toEqual(featureOff);
  expect(runtimeErrors).toEqual([]);
});

test('Custom Explosion uses capsule distance while the same legacy blast retains root distance', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?startupWorld=dungeon&busterLab=1&reaverbotSeed=buster-explosion-capsule-parity');
  await waitForGame(page);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const rootPosition = game.player.root.position.clone().set(50, 0, 50);
    const explosionCenter = rootPosition.clone().add({ x: 0, y: 1.8, z: 0 });
    const target = {
      id: 'capsule-parity-target',
      root: { position: rootPosition },
      radius: 0.58,
      collisionHeight: 1.8,
      dead: false,
      damageTaken: 0,
      takeDamage(amount) {
        this.damageTaken += amount;
        return amount;
      },
    };
    const originalGetProjectileTargets = game.getProjectileTargets;
    game.getProjectileTargets = () => [target];
    try {
      game.addExplosion(explosionCenter, 10, 1.55, 0xff6a16, {
        source: game.player,
        damagePlayer: false,
        triggerMines: false,
        targetGeometry: 'verticalCapsule',
        suppressGenericOffense: true,
      });
      const customDamage = target.damageTaken;
      target.damageTaken = 0;
      game.addExplosion(explosionCenter, 10, 1.55, 0xffb347, {
        source: game.player,
        damagePlayer: false,
        triggerMines: false,
      });
      return {
        rootPointDistance: rootPosition.distanceTo(explosionCenter),
        radius: 1.55,
        customDamage,
        legacyDamage: target.damageTaken,
      };
    } finally {
      game.getProjectileTargets = originalGetProjectileTargets;
    }
  });

  expect(result.rootPointDistance).toBeGreaterThan(result.radius);
  expect(result.customDamage).toBe(10);
  expect(result.legacyDamage).toBe(0);
  expect(runtimeErrors).toEqual([]);
});

test('neutral and live Mega action packets match their compiled and displayed Power', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?startupWorld=dungeon&busterLab=1&reaverbotSeed=buster-mega-packet-parity');
  await waitForGame(page);

  const result = await page.evaluate(async () => {
    const { compileMegaBusterPlan } = await import('/src/buster/compiler.js');
    const { game } = window;
    game.stop();
    game.player.switchArmWeapon(0, true);
    game.combat.swapTimer = 0;
    const live = game.busterLabPlans.get('megaBuster');
    const neutral = compileMegaBusterPlan({
      resolvedTuning: { power: 4, energy: 4, range: 4, rapid: 4 },
      calibrationRevision: -1,
      combatDepthLevel: 1,
    });
    const actionPower = (plan) => {
      const action = plan.actions.find((entry) => entry.type === 'emit' && entry.scope === 'root');
      return action?.damagePower ?? action?.power ?? null;
    };

    game.busterLabPlans.set('megaBuster', neutral);
    game.busterRuntime.register(neutral);
    const neutralHud = game.combat.getWeaponHudData();
    game.busterLabPlans.set('megaBuster', live);
    game.busterRuntime.register(live);
    const liveHud = game.combat.getWeaponHudData();

    return {
      neutral: {
        compiled: neutral.stats.effectivePower,
        action: actionPower(neutral),
        displayed: neutralHud.stats.attack,
      },
      live: {
        compiled: live.stats.effectivePower,
        action: actionPower(live),
        displayed: liveHud.stats.attack,
        tuning: live.resolvedTuning,
      },
    };
  });

  expect(result.neutral.compiled).toBe(8);
  expect(result.neutral.action).toBe(8);
  expect(result.neutral.displayed).toBe(8);
  expect(result.live.compiled).toBeCloseTo(9.12, 10);
  expect(result.live.action).toBeCloseTo(9.12, 10);
  expect(result.live.displayed).toBe(9.1);
  expect(result.live.tuning.power).toBe(6);
  expect(runtimeErrors).toEqual([]);
});

test('the production range weak point applies 2.4x direct packet damage', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?startupWorld=dungeon&busterLab=1&reaverbotSeed=buster-range-weak-point-parity');
  await waitForGame(page);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    game.setBusterRangeBenchmarkOptions({ targetCount: 1, profile: 'weakPoint', depthLevel: 1 });
    const entered = game.enterBusterTestRange('megaBuster');
    if (!entered.ok) return { entered: false, message: entered.message };

    const range = game.busterTestRange;
    const target = range.dummies[0];
    target.root.updateMatrixWorld(true);
    const weakPoint = target.root.position.clone().add({ x: 0, y: 1.12, z: -0.48 });
    const origin = weakPoint.clone().add({ x: 0, y: 0, z: -3 });
    const direction = weakPoint.clone().sub(origin).normalize();
    const action = range.plan.actions.find((entry) => entry.type === 'emit' && entry.scope === 'root');
    const packetPower = action?.damagePower ?? action?.power ?? 0;
    const healthBefore = target.health;
    const fired = game.busterRuntime.fire({
      origin,
      direction,
      aimPoint: weakPoint,
      target,
      noRewards: true,
    });
    for (let step = 0; step < 480 && target.health === healthBefore; step += 1) {
      game.projectiles.update(1 / 240);
    }
    const response = {
      entered: true,
      fired: fired.ok,
      packetPower,
      damage: healthBefore - target.health,
      armor: target.stats.armor,
      weakPointHits: target.benchmark.weakPointHits,
      deliveredPower: target.benchmark.deliveredPower,
      mitigatedPower: target.benchmark.mitigatedPower,
    };
    game.exitBusterTestRange();
    return response;
  });

  expect(result.entered).toBe(true);
  expect(result.fired).toBe(true);
  expect(result.weakPointHits).toBe(1);
  const preMitigation = result.packetPower * 2.4;
  const expectedDamage = preMitigation * (100 / (100 + result.armor));
  expect(result.damage).toBeCloseTo(expectedDamage, 8);
  expect(result.deliveredPower).toBeCloseTo(expectedDamage, 8);
  expect(result.deliveredPower + result.mitigatedPower).toBeCloseTo(preMitigation, 8);
  expect(runtimeErrors).toEqual([]);
});

test('large-frame guided Delay-Cluster lifecycle matches the shared simulator', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?startupWorld=dungeon&busterLab=1&reaverbotSeed=buster-guided-large-frame-parity');
  await waitForGame(page);

  const result = await page.evaluate(async () => {
    const { compileBusterBuild } = await import('/src/buster/compiler.js');
    const {
      createBusterBenchmarkScenario,
      simulateBusterEncounter,
    } = await import('/src/buster/BusterBalanceSimulator.js');
    const { game } = window;
    game.stop();
    game.setBusterRangeBenchmarkOptions({
      targetCount: 1,
      profile: 'stationary',
      depthLevel: 1,
      distanceBand: 'mid',
      layout: 'compact',
      aimOffset: 'center',
    });
    const entered = game.enterBusterTestRange('megaBuster');
    if (!entered.ok) return { entered: false, message: entered.message };

    const source = {
      schemaVersion: 1,
      rulesetVersion: 'custom-buster-v0.2',
      buildId: 'browser-guided-delay-cluster',
      chassisId: 'browser-guided-delay-cluster:chassis',
      tuning: { power: 4, energy: 4, range: 4, rapid: 4 },
      program: {
        rootNodeId: 'emitter',
        nodes: [
          { nodeId: 'emitter', moduleId: 'mortarShell', moduleInstanceId: 'browser:mortar' },
          { nodeId: 'delay', moduleId: 'afterDelay' },
          { nodeId: 'guidance', moduleId: 'pursuitGuidance', moduleInstanceId: 'browser:guidance' },
          { nodeId: 'cluster', moduleId: 'cluster5', moduleInstanceId: 'browser:cluster' },
          { nodeId: 'payload', moduleId: 'explosion', moduleInstanceId: 'browser:explosion' },
        ],
        edges: [
          { from: 'emitter', port: 'next', to: 'delay' },
          { from: 'delay', port: 'child', to: 'guidance' },
          { from: 'guidance', port: 'next', to: 'cluster' },
          { from: 'cluster', port: 'next', to: 'payload' },
        ],
      },
    };
    const compiled = compileBusterBuild(source);
    const plan = { ...compiled, weaponKey: 'browser-guided-delay-cluster' };
    const target = game.busterTestRange.dummies[0];
    const origin = game.player.root.position.clone();
    origin.y += 1.05;
    const aimPoint = target.root.position.clone();
    aimPoint.y += 1.05;
    const direction = aimPoint.clone().sub(origin).normalize();
    game.busterRuntime.register(plan);
    game.busterRuntime.equip(plan);
    const fired = game.busterRuntime.fire({
      origin,
      direction,
      aimPoint,
      target,
      noRewards: true,
    });
    game.projectiles.update(0.7);
    game.projectiles.update(0.7);

    const scenario = createBusterBenchmarkScenario({
      level: 1,
      targetCount: 1,
      profile: 'ordinary',
      motion: 'stationary',
      distanceBand: 'mid',
      layout: 'compact',
      aimOffset: 'center',
      nonlethal: true,
      duration: 2,
    });
    const simulated = simulateBusterEncounter(plan, scenario, {
      duration: 2,
      timeStep: 0.7,
    });
    const response = {
      entered: true,
      fired: fired.ok,
      productionPower: target.benchmark.deliveredPower,
      simulatedPower: simulated.metrics.deliveredPower,
      productionHits: target.benchmark.hitCount,
      simulatedHits: simulated.metrics.explosionTargetHits,
      childTriggers: simulated.transcript.filter((event) => event.type === 'child-trigger').length,
    };
    game.busterRuntime.resetWeapon(plan.weaponKey, { remove: true });
    game.exitBusterTestRange();
    return response;
  });

  expect(result.entered).toBe(true);
  expect(result.fired).toBe(true);
  expect(result.childTriggers).toBe(1);
  expect(result.productionHits).toBe(5);
  expect(result.simulatedHits).toBe(5);
  expect(result.productionPower).toBeCloseTo(result.simulatedPower, 8);
  expect(runtimeErrors).toEqual([]);
});

test('Pulse and Mortar packets match at Range ratings 1, 4, and 10 for both aim signs', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?startupWorld=dungeon&busterLab=1&reaverbotSeed=buster-range-rating-parity');
  await waitForGame(page);

  const rows = await page.evaluate(async () => {
    const { compileBusterBuild } = await import('/src/buster/compiler.js');
    const {
      createBusterBenchmarkScenario,
      simulateBusterEncounter,
    } = await import('/src/buster/BusterBalanceSimulator.js');
    const { game } = window;
    game.stop();
    game.setBusterRangeBenchmarkOptions({
      targetCount: 1,
      profile: 'stationary',
      depthLevel: 1,
      distanceBand: 'near',
      layout: 'compact',
      aimOffset: 'half-radius',
    });
    const entered = game.enterBusterTestRange('megaBuster');
    if (!entered.ok) return [{ error: entered.message }];
    const target = game.busterTestRange.dummies[0];
    const origin = game.player.root.position.clone();
    origin.y += 1.05;
    const tunings = {
      1: { power: 5, energy: 5, range: 1, rapid: 5 },
      4: { power: 4, energy: 4, range: 4, rapid: 4 },
      10: { power: 2, energy: 2, range: 10, rapid: 2 },
    };
    const results = [];
    for (const emitter of ['pulseBolt', 'mortarShell']) {
      for (const rangeRating of [1, 4, 10]) {
        for (const aimSign of [-1, 1]) {
          const buildId = `browser-${emitter}-range-${rangeRating}-sign-${aimSign}`;
          const compiled = compileBusterBuild({
            schemaVersion: 1,
            rulesetVersion: 'custom-buster-v0.2',
            buildId,
            chassisId: `${buildId}:chassis`,
            tuning: tunings[rangeRating],
            program: {
              rootNodeId: 'emitter',
              nodes: [{
                nodeId: 'emitter',
                moduleId: emitter,
                moduleInstanceId: `${buildId}:emitter`,
              }],
              edges: [],
            },
          });
          const plan = { ...compiled, weaponKey: buildId };
          target.health = target.stats.maxHealth;
          target.dead = false;
          target.benchmark.deliveredPower = 0;
          target.benchmark.hitCount = 0;
          const aimPoint = target.root.position.clone();
          aimPoint.y += 1.05;
          aimPoint.x += 0.29 * aimSign;
          const direction = aimPoint.clone().sub(origin).normalize();
          game.busterRuntime.register(plan);
          game.busterRuntime.resetWeapon(plan.weaponKey);
          game.busterRuntime.equip(plan);
          const fired = game.busterRuntime.fire({
            origin,
            direction,
            aimPoint,
            target,
            noRewards: true,
          });
          for (let frame = 0; frame < 360
            && game.projectiles.active.some((projectile) => (
              projectile.reservationToken === fired.execution?.reservationToken
            )); frame += 1) {
            game.projectiles.update(1 / 120);
          }

          const scenario = createBusterBenchmarkScenario({
            level: 1,
            targetCount: 1,
            profile: 'ordinary',
            motion: 'stationary',
            distanceBand: 'near',
            layout: 'compact',
            aimOffset: 'half-radius',
            aimSign,
            nonlethal: true,
            duration: 2,
          });
          const simulated = simulateBusterEncounter(plan, scenario, { duration: 2 });
          const firstRelease = simulated.transcript.find((event) => event.type === 'shot-release');
          const simulatedFirstHits = simulated.transcript.filter((event) => (
            event.executionId === firstRelease?.executionId
              && (event.type === 'direct-hit' || event.type === 'explosion-hit')
          ));
          const simulatedFirstPacket = simulatedFirstHits
            .reduce((sum, event) => sum + event.power, 0);
          results.push({
            emitter,
            rangeRating,
            aimSign,
            fired: fired.ok,
            productionHits: target.benchmark.hitCount,
            productionPower: target.benchmark.deliveredPower,
            simulatedFirstHits: simulatedFirstHits.length,
            simulatedFirstPacket,
          });
          game.busterRuntime.resetWeapon(plan.weaponKey, { remove: true });
        }
      }
    }
    game.exitBusterTestRange();
    return results;
  });

  expect(rows).toHaveLength(12);
  for (const row of rows) {
    expect(row.error).toBeUndefined();
    expect(row.fired).toBe(true);
    expect(row.productionHits, JSON.stringify(row)).toBe(row.simulatedFirstHits);
    expect(row.productionPower).toBeCloseTo(row.simulatedFirstPacket, 8);
  }
  expect(runtimeErrors).toEqual([]);
});

test('root Guidance and direct Spread-Explosion match shared moving and off-axis fixtures', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?startupWorld=dungeon&busterLab=1&reaverbotSeed=buster-guidance-spread-shared-fixtures');
  await waitForGame(page);

  const result = await page.evaluate(async () => {
    const { compileBusterBuild } = await import('/src/buster/compiler.js');
    const {
      BUSTER_BENCHMARK_FIXTURE,
      createBusterBenchmarkScenario,
      simulateBusterEncounter,
    } = await import('/src/buster/BusterBalanceSimulator.js');
    const { game } = window;
    game.stop();

    const compilePlan = (buildId, nodes, edges) => ({
      ...compileBusterBuild({
        schemaVersion: 1,
        rulesetVersion: 'custom-buster-v0.2',
        buildId,
        chassisId: `${buildId}:chassis`,
        tuning: { power: 4, energy: 4, range: 4, rapid: 4 },
        program: { rootNodeId: nodes[0].nodeId, nodes, edges },
      }),
      weaponKey: buildId,
    });
    const resetDummy = (dummy) => {
      dummy.health = dummy.stats.maxHealth;
      dummy.dead = false;
      Object.assign(dummy.benchmark, {
        deliveredPower: 0,
        mitigatedPower: 0,
        hitCount: 0,
        weakPointHits: 0,
        stagger: 0,
        firstHitAt: null,
      });
    };
    const firstExecutionEvents = (simulation) => {
      const release = simulation.transcript.find((event) => event.type === 'shot-release');
      return simulation.transcript.filter((event) => event.executionId === release?.executionId);
    };
    const fireOnce = (plan, scenario, targetIndex = 0) => {
      const range = game.busterTestRange;
      const target = range.dummies[targetIndex];
      const scenarioTarget = scenario.targets[targetIndex];
      const origin = game.player.root.position.clone();
      origin.y += BUSTER_BENCHMARK_FIXTURE.muzzle.y;
      const aimPoint = target.root.position.clone();
      aimPoint.y += BUSTER_BENCHMARK_FIXTURE.bodyAimHeight;
      const offset = BUSTER_BENCHMARK_FIXTURE.bodyAimOffsets[scenario.aimOffset] ?? 0;
      aimPoint.x += scenarioTarget.right.x * offset * scenario.aimSign;
      aimPoint.y += scenarioTarget.right.y * offset * scenario.aimSign;
      aimPoint.z += scenarioTarget.right.z * offset * scenario.aimSign;
      const direction = aimPoint.clone().sub(origin).normalize();
      game.busterRuntime.register(plan);
      game.busterRuntime.resetWeapon(plan.weaponKey);
      game.busterRuntime.equip(plan);
      return game.busterRuntime.fire({
        origin,
        direction,
        aimPoint,
        target,
        noRewards: true,
      });
    };
    const drainExecution = (token, { moving = false } = {}) => {
      const dt = 1 / 240;
      for (let frame = 0; frame < 960; frame += 1) {
        if (!game.projectiles.active.some((projectile) => projectile.reservationToken === token)) break;
        if (moving) game._updateBusterTestRange(dt);
        game.projectiles.update(dt);
      }
    };

    const rootGuided = compilePlan('browser-root-guided-moving', [
      { nodeId: 'emitter', moduleId: 'pulseBolt', moduleInstanceId: 'browser:pulse' },
      { nodeId: 'guidance', moduleId: 'pursuitGuidance', moduleInstanceId: 'browser:guidance' },
      { nodeId: 'terminal', moduleId: 'onImpact' },
      { nodeId: 'payload', moduleId: 'explosion', moduleInstanceId: 'browser:explosion' },
    ], [
      { from: 'emitter', port: 'next', to: 'guidance' },
      { from: 'guidance', port: 'next', to: 'terminal' },
      { from: 'terminal', port: 'child', to: 'payload' },
    ]);
    const movingScenario = createBusterBenchmarkScenario({
      id: 'browser:root-guided-moving',
      level: 1,
      targetCount: 1,
      profile: 'moving',
      motion: 'lateral',
      distanceBand: 'far',
      layout: 'compact',
      aimOffset: 'half-radius',
      aimSign: 1,
      nonlethal: true,
      duration: 2,
    });
    game.setBusterRangeBenchmarkOptions({
      targetCount: 1,
      profile: 'moving',
      depthLevel: 1,
      distanceBand: 'far',
      layout: 'compact',
      aimOffset: 'half-radius',
    });
    const guidanceEntry = game.enterBusterTestRange('megaBuster');
    if (!guidanceEntry.ok) return { error: guidanceEntry.message };
    const movingTarget = game.busterTestRange.dummies[0];
    movingTarget.id = movingScenario.targets[0].id;
    resetDummy(movingTarget);
    const guidedShot = fireOnce(rootGuided, movingScenario);
    const guidedProjectile = game.projectiles.active.find((projectile) => (
      projectile.reservationToken === guidedShot.execution?.reservationToken
    ));
    const productionLockedTarget = guidedProjectile?.target?.id ?? null;
    drainExecution(guidedShot.execution?.reservationToken, { moving: true });
    const guidedSimulation = simulateBusterEncounter(rootGuided, movingScenario, {
      duration: 2,
      timeStep: 1 / 240,
    });
    const guidedEvents = firstExecutionEvents(guidedSimulation);
    const guidedPackets = guidedEvents.filter((event) => (
      event.type === 'direct-hit' || event.type === 'explosion-hit'
    ));
    const guidance = {
      fired: guidedShot.ok,
      productionLockedTarget,
      simulatorGuidanceTarget: guidedEvents.find((event) => (
        event.type === 'guidance-target' && event.scope === 'root'
      ))?.targetId ?? null,
      productionHits: movingTarget.benchmark.hitCount,
      simulatorHits: guidedPackets.length,
      productionPower: movingTarget.benchmark.deliveredPower,
      simulatorPower: guidedPackets.reduce((sum, event) => sum + event.power, 0),
      terminalDeliveries: guidedEvents.filter((event) => (
        event.type === 'child-trigger' && event.reason === 'terminalRelay'
      )).length,
    };
    game.busterRuntime.resetWeapon(rootGuided.weaponKey, { remove: true });
    game.exitBusterTestRange();

    const spreadExplosion = compilePlan('browser-spread-explosion-off-axis', [
      { nodeId: 'emitter', moduleId: 'pulseBolt', moduleInstanceId: 'browser:pulse' },
      { nodeId: 'spread', moduleId: 'spread3', moduleInstanceId: 'browser:spread' },
      { nodeId: 'payload', moduleId: 'explosion', moduleInstanceId: 'browser:explosion' },
    ], [
      { from: 'emitter', port: 'next', to: 'spread' },
      { from: 'spread', port: 'next', to: 'payload' },
    ]);
    const spreadScenario = createBusterBenchmarkScenario({
      id: 'browser:spread-separated-off-axis',
      level: 1,
      targetCount: 4,
      profile: 'ordinary',
      motion: 'stationary',
      distanceBand: 'mid',
      layout: 'separated',
      aimOffset: 'half-radius',
      aimSign: 1,
      nonlethal: true,
      duration: 2,
    });
    game.setBusterRangeBenchmarkOptions({
      targetCount: 4,
      profile: 'stationary',
      depthLevel: 1,
      distanceBand: 'mid',
      layout: 'separated',
      aimOffset: 'half-radius',
    });
    const spreadEntry = game.enterBusterTestRange('megaBuster');
    if (!spreadEntry.ok) return { error: spreadEntry.message };
    for (const [index, dummy] of game.busterTestRange.dummies.entries()) {
      dummy.id = spreadScenario.targets[index].id;
      resetDummy(dummy);
    }
    const spreadShot = fireOnce(spreadExplosion, spreadScenario);
    drainExecution(spreadShot.execution?.reservationToken);
    const spreadSimulation = simulateBusterEncounter(spreadExplosion, spreadScenario, {
      duration: 2,
      timeStep: 1 / 240,
    });
    const spreadEvents = firstExecutionEvents(spreadSimulation);
    const spreadPackets = spreadEvents.filter((event) => event.type === 'explosion-hit');
    const productionDamaged = game.busterTestRange.dummies
      .filter((dummy) => dummy.benchmark.hitCount > 0)
      .map((dummy) => dummy.id)
      .sort();
    const simulatorDamaged = [...new Set(spreadPackets.map((event) => event.targetId))].sort();
    const spread = {
      fired: spreadShot.ok,
      productionHits: game.busterTestRange.dummies.reduce(
        (sum, dummy) => sum + dummy.benchmark.hitCount,
        0,
      ),
      simulatorHits: spreadPackets.length,
      productionPower: game.busterTestRange.dummies.reduce(
        (sum, dummy) => sum + dummy.benchmark.deliveredPower,
        0,
      ),
      simulatorPower: spreadPackets.reduce((sum, event) => sum + event.power, 0),
      productionDamaged,
      simulatorDamaged,
    };
    game.busterRuntime.resetWeapon(spreadExplosion.weaponKey, { remove: true });
    game.exitBusterTestRange();
    return { guidance, spread };
  });

  expect(result.error).toBeUndefined();
  expect(result.guidance.fired).toBe(true);
  expect(result.guidance.productionLockedTarget).toBe('target-01');
  expect(result.guidance.simulatorGuidanceTarget).toBe('target-01');
  expect(result.guidance.terminalDeliveries).toBe(1);
  expect(result.guidance.productionHits).toBe(result.guidance.simulatorHits);
  expect(result.guidance.productionPower).toBeCloseTo(result.guidance.simulatorPower, 7);
  expect(result.spread.fired).toBe(true);
  expect(result.spread.productionHits).toBe(result.spread.simulatorHits);
  expect(result.spread.productionPower).toBeCloseTo(result.spread.simulatorPower, 7);
  expect(result.spread.productionDamaged).toEqual(result.spread.simulatorDamaged);
  expect(result.spread.productionDamaged.length).toBeGreaterThan(1);
  expect(runtimeErrors).toEqual([]);
});

test('Apex and Terminal Relay production lifecycle matches simulator timing and packets', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?startupWorld=dungeon&busterLab=1&reaverbotSeed=buster-trigger-lifecycle-parity');
  await waitForGame(page);

  const rows = await page.evaluate(async () => {
    const { compileBusterBuild } = await import('/src/buster/compiler.js');
    const {
      BUSTER_BENCHMARK_FIXTURE,
      createBusterBenchmarkScenario,
      simulateBusterEncounter,
    } = await import('/src/buster/BusterBalanceSimulator.js');
    const { game } = window;
    game.stop();
    game.setBusterRangeBenchmarkOptions({
      targetCount: 1,
      profile: 'stationary',
      depthLevel: 1,
      distanceBand: 'mid',
      layout: 'compact',
      aimOffset: 'center',
    });
    const entered = game.enterBusterTestRange('megaBuster');
    if (!entered.ok) return [{ error: entered.message }];
    const scenario = createBusterBenchmarkScenario({
      id: 'browser:trigger-lifecycle',
      level: 1,
      targetCount: 1,
      profile: 'ordinary',
      motion: 'stationary',
      distanceBand: 'mid',
      layout: 'compact',
      aimOffset: 'center',
      nonlethal: true,
      duration: 4,
    });
    const target = game.busterTestRange.dummies[0];
    target.id = scenario.targets[0].id;
    const resetTarget = () => {
      target.health = target.stats.maxHealth;
      target.dead = false;
      target.elapsed = 0;
      Object.assign(target.benchmark, {
        deliveredPower: 0,
        mitigatedPower: 0,
        hitCount: 0,
        weakPointHits: 0,
        stagger: 0,
        firstHitAt: null,
      });
    };
    const buildPlan = ({ id, emitter, trigger }) => ({
      ...compileBusterBuild({
        schemaVersion: 1,
        rulesetVersion: 'custom-buster-v0.2',
        buildId: id,
        chassisId: `${id}:chassis`,
        tuning: { power: 4, energy: 4, range: 4, rapid: 4 },
        program: {
          rootNodeId: 'emitter',
          nodes: [
            { nodeId: 'emitter', moduleId: emitter, moduleInstanceId: `${id}:emitter` },
            { nodeId: 'trigger', moduleId: trigger, moduleInstanceId: trigger === 'onImpact' ? null : `${id}:trigger` },
            { nodeId: 'payload', moduleId: 'explosion', moduleInstanceId: `${id}:payload` },
          ],
          edges: [
            { from: 'emitter', port: 'next', to: 'trigger' },
            { from: 'trigger', port: 'child', to: 'payload' },
          ],
        },
      }),
      weaponKey: id,
    });
    const definitions = [
      { id: 'browser-apex-parity', emitter: 'mortarShell', trigger: 'atApex', reason: 'apexTrigger' },
      { id: 'browser-terminal-parity', emitter: 'pulseBolt', trigger: 'onImpact', reason: 'terminalRelay' },
    ];
    const results = [];
    for (const definition of definitions) {
      resetTarget();
      const plan = buildPlan(definition);
      const origin = game.player.root.position.clone();
      origin.y += BUSTER_BENCHMARK_FIXTURE.muzzle.y;
      const aimPoint = target.root.position.clone();
      aimPoint.y += BUSTER_BENCHMARK_FIXTURE.bodyAimHeight;
      const direction = aimPoint.clone().sub(origin).normalize();
      let productionClock = 0;
      const spawnEvents = [];
      const originalSpawn = game.projectiles.spawn.bind(game.projectiles);
      game.projectiles.spawn = (options) => {
        const projectile = originalSpawn(options);
        if (projectile) spawnEvents.push({ actionId: options.actionId, time: productionClock });
        return projectile;
      };
      game.busterRuntime.register(plan);
      game.busterRuntime.resetWeapon(plan.weaponKey);
      game.busterRuntime.equip(plan);
      const fired = game.busterRuntime.fire({
        origin,
        direction,
        aimPoint,
        target,
        noRewards: true,
      });
      const dt = 1 / 480;
      for (let frame = 0; frame < 1920; frame += 1) {
        if (!game.projectiles.active.some((projectile) => (
          projectile.reservationToken === fired.execution?.reservationToken
        ))) break;
        productionClock += dt;
        game._updateBusterTestRange(dt);
        game.projectiles.update(dt);
      }
      game.projectiles.spawn = originalSpawn;

      const simulated = simulateBusterEncounter(plan, scenario, { duration: 4, timeStep: 1 / 480 });
      const release = simulated.transcript.find((event) => event.type === 'shot-release');
      const events = simulated.transcript.filter((event) => event.executionId === release?.executionId);
      const packets = events.filter((event) => (
        event.type === 'direct-hit' || event.type === 'explosion-hit'
      ));
      const triggerEvent = events.find((event) => event.type === 'child-trigger');
      results.push({
        id: definition.id,
        reason: definition.reason,
        fired: fired.ok,
        productionChildSpawns: spawnEvents.filter((event) => event.actionId === 'emit-child').length,
        simulatorChildTriggers: events.filter((event) => event.type === 'child-trigger').length,
        productionTriggerTime: spawnEvents.find((event) => event.actionId === 'emit-child')?.time ?? null,
        simulatorTriggerTime: triggerEvent?.releaseTime ?? null,
        simulatorTriggerReason: triggerEvent?.reason ?? null,
        productionHits: target.benchmark.hitCount,
        simulatorHits: packets.length,
        productionPower: target.benchmark.deliveredPower,
        simulatorPower: packets.reduce((sum, event) => sum + event.power, 0),
      });
      game.busterRuntime.resetWeapon(plan.weaponKey, { remove: true });
    }
    game.exitBusterTestRange();
    return results;
  });

  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row.error).toBeUndefined();
    expect(row.fired).toBe(true);
    expect(row.productionChildSpawns, JSON.stringify(row)).toBe(1);
    expect(row.simulatorChildTriggers, JSON.stringify(row)).toBe(1);
    expect(row.simulatorTriggerReason).toBe(row.reason);
    expect(row.productionTriggerTime).toBeCloseTo(row.simulatorTriggerTime, 2);
    expect(row.productionHits, JSON.stringify(row)).toBe(row.simulatorHits);
    expect(row.productionPower).toBeCloseTo(row.simulatorPower, 7);
  }
  expect(runtimeErrors).toEqual([]);
});

test('in-flight executions survive switch and recompile while explicit cancellation tears down', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/?startupWorld=dungeon&busterLab=1&reaverbotSeed=buster-inflight-revision-parity');
  await waitForGame(page);

  const result = await page.evaluate(async () => {
    const { compileBusterBuild } = await import('/src/buster/compiler.js');
    const {
      BUSTER_BENCHMARK_FIXTURE,
      createBusterBenchmarkScenario,
      simulateBusterEncounter,
    } = await import('/src/buster/BusterBalanceSimulator.js');
    const { game } = window;
    game.stop();
    game.setBusterRangeBenchmarkOptions({
      targetCount: 1,
      profile: 'stationary',
      depthLevel: 1,
      distanceBand: 'mid',
      layout: 'compact',
      aimOffset: 'center',
    });
    const entered = game.enterBusterTestRange('megaBuster');
    if (!entered.ok) return { error: entered.message };
    const scenario = createBusterBenchmarkScenario({
      id: 'browser:inflight-revision',
      level: 1,
      targetCount: 1,
      profile: 'ordinary',
      motion: 'stationary',
      distanceBand: 'mid',
      layout: 'compact',
      aimOffset: 'center',
      nonlethal: true,
      duration: 3,
    });
    const target = game.busterTestRange.dummies[0];
    target.id = scenario.targets[0].id;
    const resetTarget = () => {
      target.health = target.stats.maxHealth;
      target.dead = false;
      Object.assign(target.benchmark, {
        deliveredPower: 0,
        mitigatedPower: 0,
        hitCount: 0,
        weakPointHits: 0,
        stagger: 0,
        firstHitAt: null,
      });
    };
    const source = (tuning) => ({
      schemaVersion: 1,
      rulesetVersion: 'custom-buster-v0.2',
      buildId: 'browser-inflight-revision',
      chassisId: 'browser-inflight-revision:chassis',
      tuning,
      program: {
        rootNodeId: 'emitter',
        nodes: [
          { nodeId: 'emitter', moduleId: 'mortarShell', moduleInstanceId: 'browser:mortar' },
          { nodeId: 'delay', moduleId: 'afterDelay' },
          { nodeId: 'payload', moduleId: 'explosion', moduleInstanceId: 'browser:explosion' },
        ],
        edges: [
          { from: 'emitter', port: 'next', to: 'delay' },
          { from: 'delay', port: 'child', to: 'payload' },
        ],
      },
    });
    const weaponKey = 'browser-inflight-revision';
    const revisionOne = {
      ...compileBusterBuild(source({ power: 4, energy: 4, range: 4, rapid: 4 })),
      weaponKey,
      revision: 1,
    };
    const revisionTwo = {
      ...compileBusterBuild(source({ power: 5, energy: 4, range: 3, rapid: 4 })),
      weaponKey,
      revision: 2,
    };
    const origin = game.player.root.position.clone();
    origin.y += BUSTER_BENCHMARK_FIXTURE.muzzle.y;
    const aimPoint = target.root.position.clone();
    aimPoint.y += BUSTER_BENCHMARK_FIXTURE.bodyAimHeight;
    const direction = aimPoint.clone().sub(origin).normalize();
    const fire = (plan) => {
      game.busterRuntime.register(plan);
      game.busterRuntime.resetWeapon(plan.weaponKey);
      game.busterRuntime.equip(plan);
      return game.busterRuntime.fire({
        origin: origin.clone(),
        direction: direction.clone(),
        aimPoint: aimPoint.clone(),
        target,
        noRewards: true,
      });
    };
    const activeFor = (token) => game.projectiles.active.filter((projectile) => (
      projectile.reservationToken === token
    ));

    resetTarget();
    const firstShot = fire(revisionOne);
    const token = firstShot.execution?.reservationToken;
    const activeAfterFire = activeFor(token).length;
    const alternate = game.busterLabPlans.get('megaBuster');
    game.busterRuntime.equip(alternate);
    const activeAfterSwitch = activeFor(token).length;
    game.busterRuntime.register(revisionTwo);
    const activeAfterRecompile = activeFor(token).length;
    const dt = 1 / 240;
    for (let frame = 0; frame < 960 && activeFor(token).length > 0; frame += 1) {
      game._updateBusterTestRange(dt);
      game.projectiles.update(dt);
    }
    const simulated = simulateBusterEncounter(revisionOne, scenario, {
      duration: 3,
      timeStep: 1 / 240,
    });
    const release = simulated.transcript.find((event) => event.type === 'shot-release');
    const firstEvents = simulated.transcript.filter((event) => event.executionId === release?.executionId);
    const simulatedPackets = firstEvents.filter((event) => (
      event.type === 'direct-hit' || event.type === 'explosion-hit'
    ));
    const survival = {
      fired: firstShot.ok,
      executionRevision: firstShot.execution?.buildRevision,
      executionPower: firstShot.execution?.plan?.stats?.effectivePower,
      currentRevisionPower: game.busterRuntime.plans.get(weaponKey)?.stats?.effectivePower,
      activeAfterFire,
      activeAfterSwitch,
      activeAfterRecompile,
      activeAfterDelivery: activeFor(token).length,
      productionHits: target.benchmark.hitCount,
      simulatorHits: simulatedPackets.length,
      productionPower: target.benchmark.deliveredPower,
      simulatorPower: simulatedPackets.reduce((sum, event) => sum + event.power, 0),
      reservationAfterDelivery: game.busterRuntime.getReservedProjectileCount(),
    };

    resetTarget();
    const cancelReasons = [];
    let childSpawnsAfterCancelRequest = 0;
    const originalCancelWhere = game.projectiles.cancelWhere.bind(game.projectiles);
    const originalSpawn = game.projectiles.spawn.bind(game.projectiles);
    let cancellationRequested = false;
    game.projectiles.cancelWhere = (predicate, reason) => {
      cancelReasons.push(reason);
      cancellationRequested = true;
      return originalCancelWhere(predicate, reason);
    };
    game.projectiles.spawn = (options) => {
      const projectile = originalSpawn(options);
      if (projectile && cancellationRequested && options.actionId === 'emit-child') {
        childSpawnsAfterCancelRequest += 1;
      }
      return projectile;
    };
    const cancelShot = fire(revisionOne);
    const cancelToken = cancelShot.execution?.reservationToken;
    const reservationBeforeCancel = game.busterRuntime.getReservedProjectileCount();
    const cancelledExecutions = game.busterRuntime.cancelBuild(weaponKey, 'browser-explicit-cancel');
    const activeAfterCancel = activeFor(cancelToken).length;
    const reservationAfterCancel = game.busterRuntime.getReservedProjectileCount();
    for (let frame = 0; frame < 360; frame += 1) {
      game._updateBusterTestRange(dt);
      game.projectiles.update(dt);
    }
    game.projectiles.cancelWhere = originalCancelWhere;
    game.projectiles.spawn = originalSpawn;
    const cancellation = {
      fired: cancelShot.ok,
      reservationBeforeCancel,
      cancelledExecutions,
      activeAfterCancel,
      reservationAfterCancel,
      cancelReasons,
      childSpawnsAfterCancelRequest,
      deliveredPowerAfterCancel: target.benchmark.deliveredPower,
      hitsAfterCancel: target.benchmark.hitCount,
    };
    game.busterRuntime.resetWeapon(weaponKey, { remove: true });
    game.exitBusterTestRange();
    return { survival, cancellation };
  });

  expect(result.error).toBeUndefined();
  expect(result.survival.fired).toBe(true);
  expect(result.survival.executionRevision).toBe(1);
  expect(result.survival.executionPower).not.toBe(result.survival.currentRevisionPower);
  expect(result.survival.activeAfterFire).toBe(1);
  expect(result.survival.activeAfterSwitch).toBe(1);
  expect(result.survival.activeAfterRecompile).toBe(1);
  expect(result.survival.activeAfterDelivery).toBe(0);
  expect(result.survival.productionHits).toBe(result.survival.simulatorHits);
  expect(result.survival.productionPower).toBeCloseTo(result.survival.simulatorPower, 7);
  expect(result.survival.reservationAfterDelivery).toBe(0);
  expect(result.cancellation.fired).toBe(true);
  expect(result.cancellation.reservationBeforeCancel).toBeGreaterThan(0);
  expect(result.cancellation.cancelledExecutions).toBe(1);
  expect(result.cancellation.activeAfterCancel).toBe(0);
  expect(result.cancellation.reservationAfterCancel).toBe(0);
  expect(result.cancellation.cancelReasons).toContain('browser-explicit-cancel');
  expect(result.cancellation.childSpawnsAfterCancelRequest).toBe(0);
  expect(result.cancellation.deliveredPowerAfterCancel).toBe(0);
  expect(result.cancellation.hitsAfterCancel).toBe(0);
  expect(runtimeErrors).toEqual([]);
});
