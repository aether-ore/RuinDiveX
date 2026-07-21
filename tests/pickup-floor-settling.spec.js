import { expect, test } from '@playwright/test';

test('airborne enemy drops fall to their local floor before hovering', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await expect
    .poll(
      async () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20000 },
    )
    .toBe('true');

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();

    const Vector3 = game.player.root.position.constructor;
    const floorPosition = game.player.root.position.clone();
    const floorY = game.dungeonController.getSurfaceElevationAt(floorPosition);
    const airbornePosition = floorPosition.clone();
    airbornePosition.y = floorY + 8;
    const enemy = {
      root: { position: airbornePosition.clone() },
      deathDropPosition: airbornePosition.clone(),
      isElite: false,
      level: 1,
    };
    const distantPlayer = {
      root: { position: new Vector3(999, 999, 999) },
      stats: { pickupRadius: 0 },
    };
    const inertInventory = {
      gold: 0,
      addItem: () => false,
      addMaterial: () => false,
    };

    const originalRandom = Math.random;
    Math.random = () => 0;
    const lootStart = game.lootSystem.pickups.length;
    const refractorStart = game.refractors.pickups.length;
    game.lootSystem.rollDrop(enemy);
    game.lootSystem.createMaterialPickup(
      { id: 'floor-test-alloy', name: 'Floor Test Alloy', color: 0xa7afb2 },
      1,
      airbornePosition.clone(),
    );
    game.refractors.rollEnemyDrop(enemy);
    Math.random = originalRandom;

    const loot = game.lootSystem.pickups.slice(lootStart);
    const refractors = game.refractors.pickups.slice(refractorStart);
    const initialYs = [...loot, ...refractors].map((pickup) => pickup.object.position.y);

    for (let frame = 0; frame < 120; frame += 1) {
      game.lootSystem.update(1 / 60, distantPlayer, inertInventory);
      game.refractors.update(1 / 60, distantPlayer, inertInventory);
    }

    return {
      floorY,
      initialYs,
      loot: loot.map((pickup) => ({
        y: pickup.object.position.y,
        restY: pickup.object.userData.spawnY,
        falling: pickup.object.userData.falling,
      })),
      refractors: refractors.map((pickup) => ({
        y: pickup.object.position.y,
        restY: pickup.object.userData.spawnY,
        falling: pickup.object.userData.falling,
      })),
    };
  });

  expect(Math.min(...result.initialYs)).toBeGreaterThan(result.floorY + 7);
  expect(result.loot).toHaveLength(2);
  expect(result.refractors.length).toBeGreaterThanOrEqual(2);
  expect(result.loot.every((pickup) => pickup.falling === false)).toBe(true);
  expect(result.refractors.every((pickup) => pickup.falling === false)).toBe(true);
  expect(result.loot.every((pickup) => Math.abs(pickup.y - pickup.restY) <= 0.081)).toBe(true);
  expect(result.refractors.every((pickup) => Math.abs(pickup.y - pickup.restY) <= 0.101)).toBe(true);
  expect(Math.max(...result.loot.map((pickup) => pickup.restY))).toBeLessThan(result.floorY + 0.4);
  expect(Math.max(...result.refractors.map((pickup) => pickup.restY))).toBeLessThan(result.floorY + 0.8);
});
