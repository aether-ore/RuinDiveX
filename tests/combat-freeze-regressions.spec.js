import { expect, test } from '@playwright/test';

test('clustered mines detonate once each without recursive duplicates', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&reaverbotSeed=mine-recursion-guard');
  await page.waitForFunction(() => Boolean(window.game?.combat));

  const result = await page.evaluate(() => {
    const game = window.game;
    const combat = game.combat;
    const Group = game.player.root.constructor;
    game.stop();
    combat._clearMines();

    const origin = game.player.root.position.clone().add({ x: 18, y: 0.05, z: 18 });
    const mines = Array.from({ length: 6 }, (_, index) => {
      const group = new Group();
      group.name = `recursionGuardMine${index}`;
      group.position.copy(origin);
      game.scene.add(group);
      return {
        group,
        color: 0xffaa33,
        damage: 0,
        explosionRadius: 1.8,
        triggerRadius: 1.1,
        detonated: false,
      };
    });
    combat.activeMines.push(...mines);

    const originalResolve = game._resolveExplosion.bind(game);
    let resolvedExplosions = 0;
    game._resolveExplosion = (...args) => {
      resolvedExplosions += 1;
      return originalResolve(...args);
    };

    const firstResult = combat._detonateMine(mines[0]);
    const duplicateResult = combat._detonateMine(mines[0]);
    game._updatePendingExplosions();
    const waveCount = game.timedEffects.filter((effect) => effect.object?.name === 'explosionWave').length;
    const pendingCount = game.pendingExplosions.length;
    const activeCount = combat.activeMines.length;
    const detonatedCount = mines.filter((mine) => mine.detonated).length;
    game._resolveExplosion = originalResolve;
    game._updateTimedEffects(1);

    return {
      firstResult,
      duplicateResult,
      resolvedExplosions,
      waveCount,
      pendingCount,
      activeCount,
      detonatedCount,
    };
  });

  expect(result).toEqual({
    firstResult: true,
    duplicateResult: false,
    resolvedExplosions: 6,
    waveCount: 6,
    pendingCount: 0,
    activeCount: 0,
    detonatedCount: 6,
  });
});

test('combat-owned fire zones and refractor pickups release GPU resources', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&reaverbotSeed=combat-resource-cleanup');
  await page.waitForFunction(() => Boolean(window.game?.refractors));

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();

    const zonePosition = game.player.root.position.clone().add({ x: 12, y: 0, z: 12 });
    game.addFireZone(zonePosition, 1, 0.1, 1);
    const zone = game.hazards[game.hazards.length - 1];
    let zoneGeometryDisposals = 0;
    let zoneMaterialDisposals = 0;
    const zoneGeometryDispose = zone.object.geometry.dispose.bind(zone.object.geometry);
    const zoneMaterialDispose = zone.object.material.dispose.bind(zone.object.material);
    zone.object.geometry.dispose = () => {
      zoneGeometryDisposals += 1;
      zoneGeometryDispose();
    };
    zone.object.material.dispose = () => {
      zoneMaterialDisposals += 1;
      zoneMaterialDispose();
    };
    game._updateHazards(0.2);

    const pickup = game.refractors.createPickup({ position: zonePosition.clone() });
    const pickupResources = [];
    pickup.traverse((object) => {
      if (object.geometry) pickupResources.push(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (material) pickupResources.push(material);
    });
    let pickupDisposals = 0;
    for (const resource of new Set(pickupResources)) {
      const originalDispose = resource.dispose.bind(resource);
      resource.dispose = () => {
        pickupDisposals += 1;
        originalDispose();
      };
    }
    game.refractors.clear();

    const legacyEnemy = game.spawner.spawnCuratedEnemy('basic', false, zonePosition.clone());
    const legacyResources = new Set();
    legacyEnemy.root.traverse((object) => {
      if (object.geometry) legacyResources.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (material) legacyResources.add(material);
    });
    let legacyDisposals = 0;
    for (const resource of legacyResources) {
      const originalDispose = resource.dispose.bind(resource);
      resource.dispose = () => {
        legacyDisposals += 1;
        originalDispose();
      };
    }
    legacyEnemy.dispose();
    legacyEnemy.dispose();
    legacyEnemy.root.removeFromParent();
    game.enemies.splice(game.enemies.indexOf(legacyEnemy), 1);

    return {
      hazardRemoved: !game.hazards.includes(zone),
      zoneAttached: Boolean(zone.object.parent),
      zoneGeometryDisposals,
      zoneMaterialDisposals,
      pickupCount: game.refractors.pickups.length,
      pickupDisposals,
      pickupResourceCount: new Set(pickupResources).size,
      legacyDisposals,
      legacyResourceCount: legacyResources.size,
    };
  });

  expect(result.hazardRemoved).toBe(true);
  expect(result.zoneAttached).toBe(false);
  expect(result.zoneGeometryDisposals).toBe(1);
  expect(result.zoneMaterialDisposals).toBe(1);
  expect(result.pickupCount).toBe(0);
  expect(result.pickupDisposals).toBe(result.pickupResourceCount);
  expect(result.pickupDisposals).toBeGreaterThanOrEqual(6);
  expect(result.legacyDisposals).toBe(result.legacyResourceCount);
  expect(result.legacyDisposals).toBeGreaterThan(10);
});

test('death presentation stays staged, animated, and within the pack-wipe budget', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon&reaverbotSeed=death-effect-budget');
  await page.waitForFunction(() => Boolean(window.game?.spawner));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    const Group = game.player.root.constructor;
    game.stop();

    const enemy = window.spawnReaverbot({
      archetypeId: 'pursuer',
      seed: 'death-effect-real-parts',
      position: game.player.root.position.clone().add(new Vector3(7, 0, 3)),
    });
    game.damageEnemy(enemy, enemy.health + 999, { source: game.player });
    enemy.update(0.22, game);
    const beforeBurst = {
      phase: enemy.deathPhase,
      explosions: game.timedEffects.filter((effect) => effect.kind === 'enemyDeathExplosion').length,
      parts: game.timedEffects.filter((effect) => effect.kind === 'enemyDeathParts').length,
    };
    enemy.update(0.23, game);
    const explosion = game.timedEffects.find((effect) => effect.kind === 'enemyDeathExplosion');
    const debris = game.timedEffects.find((effect) => effect.kind === 'enemyDeathParts');
    const initialExplosionScale = explosion.object.scale.x;
    const initialPartPosition = debris.parts[0].object.position.clone();
    const initialPartRotation = debris.parts[0].object.rotation.clone();
    game._updateTimedEffects(0.16);
    const animated = {
      explosionGrew: explosion.object.scale.x > initialExplosionScale,
      partMoved: debris.parts[0].object.position.distanceTo(initialPartPosition) > 0.01,
      partSpun: Math.abs(debris.parts[0].object.rotation.x - initialPartRotation.x)
        + Math.abs(debris.parts[0].object.rotation.y - initialPartRotation.y)
        + Math.abs(debris.parts[0].object.rotation.z - initialPartRotation.z) > 0.01,
    };

    game._updateTimedEffects(1);
    const baselineExplosionCount = game.timedEffects.filter((effect) => effect.kind === 'enemyDeathExplosion').length;
    const fakeEnemies = Array.from({ length: 12 }, (_, index) => {
      const root = new Group();
      root.position.copy(game.player.root.position).add(new Vector3(10 + index * 0.2, 0, 8));
      game.scene.add(root);
      return {
        id: `budgetEnemy${index}`,
        root,
        collisionHeight: 1.4,
        type: { skinColor: 0x87935f, clothColor: 0x4d5532 },
        deathFloorY: root.position.y,
      };
    });
    for (const fakeEnemy of fakeEnemies) game.addEnemyDeathEffect(fakeEnemy);
    const budgetedExplosionCount = game.timedEffects.filter((effect) => effect.kind === 'enemyDeathExplosion').length;
    const budgetedPartEffects = game.timedEffects.filter((effect) => effect.kind === 'enemyDeathParts');
    const maxPartsPerEffect = Math.max(...budgetedPartEffects.map((effect) => effect.parts.length));
    const particleCountAtPeak = game.activeParticles.length;
    game._updateTimedEffects(1);
    game._updateParticles(1);
    for (const fakeEnemy of fakeEnemies) fakeEnemy.root.removeFromParent();

    return {
      beforeBurst,
      afterBurstPhase: enemy.deathPhase,
      explosionLayerCount: explosion.object.children.length,
      partCount: debris.parts.length,
      animated,
      baselineExplosionCount,
      budgetedExplosionCount,
      maxPartsPerEffect,
      particleCountAtPeak,
      deathEffectsAfterCleanup: game.timedEffects.filter((effect) => effect.kind?.startsWith('enemyDeath')).length,
    };
  });

  expect(result.beforeBurst).toEqual({ phase: 'fall', explosions: 0, parts: 0 });
  expect(result.afterBurstPhase).toBe('burst');
  expect(result.explosionLayerCount).toBe(3);
  expect(result.partCount).toBe(3);
  expect(result.animated).toEqual({ explosionGrew: true, partMoved: true, partSpun: true });
  expect(result.baselineExplosionCount).toBe(0);
  expect(result.budgetedExplosionCount).toBeLessThanOrEqual(6);
  expect(result.maxPartsPerEffect).toBeLessThanOrEqual(3);
  expect(result.particleCountAtPeak).toBeLessThanOrEqual(220);
  expect(result.deathEffectsAfterCleanup).toBe(0);
});
