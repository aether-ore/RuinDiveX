import { expect, test } from '@playwright/test';

async function openReadyGame(page) {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(
    window.game?.busterLabStorage?.state?.armsGear
    && window.game?.dungeonController
    && window.game?.player?.armHotbar?.[0],
  ));
  await page.evaluate(() => window.game.stop());
  return runtimeErrors;
}

test('Arms, Gear, fabrication discovery, and Barrier HUD expose fixed-function state', async ({ page }) => {
  const runtimeErrors = await openReadyGame(page);

  const locationAccess = await page.evaluate(() => {
    const { game } = window;
    const hubEditable = game.canEditArmsGear();
    game.player.root.position.copy(game.dungeon.campReturnPosition);
    const campEditable = game.canEditArmsGear();
    game.setInventoryOpen(true, { mode: 'roll' });
    game.ui.renderInventory();
    return { hubEditable, campEditable };
  });
  expect(locationAccess).toEqual({ hubEditable: false, campEditable: true });

  const armCards = page.locator('#garage-weapon-slots .garage-weapon-card');
  const gearCards = page.locator('#equipment-slots .equipment-slot');
  await expect(armCards).toHaveCount(4);
  await expect(gearCards).toHaveCount(6);
  await expect(armCards.nth(0)).toContainText('Mega Buster');
  await expect(armCards.nth(1)).toContainText('Laser Beam Blade');
  await expect(armCards.nth(1)).toContainText('DMG29.9');
  await expect(armCards.nth(1)).toContainText('RNG2.82m');
  await expect(armCards.nth(1)).toContainText('CAD1.16/s');
  await expect(armCards.nth(2)).toContainText('Custom Buster');
  await expect(armCards.nth(3)).toContainText('Lift Arm');

  await expect(gearCards.filter({ has: page.locator('[data-gear-loadout-slot="mobility"]') })).toContainText(
    'Jump Springs must be fabricated through Roll',
  );
  const defenseCard = gearCards.filter({ has: page.locator('[data-gear-loadout-slot="defense"]') });
  await expect(defenseCard).toContainText('LOCKED');
  await expect(defenseCard).toContainText('defeat a qualifying boss');
  await expect(page.locator('#inventory-panel')).not.toContainText(/Optimize|Power Score|Affix|Legendary|Item Level/i);

  const jumpRecipe = page.locator('#equipment-fabrication .equipment-recipe-card').first();
  await expect(jumpRecipe).toContainText('Unknown Fabrication Pattern');
  await expect(jumpRecipe).toContainText('SILHOUETTE');

  await page.evaluate(() => {
    const { game } = window;
    game.rollSalvageStorage.addPart({
      id: 'temperedJumpSpring',
      name: 'Tempered Jump Spring',
    });
    game.ui.renderInventory();
  });
  await expect(jumpRecipe).toContainText('Jump Springs');
  await expect(jumpRecipe).toContainText("ROLL'S CLUE");

  await page.evaluate(() => {
    const { game } = window;
    game.rollSalvageStorage.addPart({
      id: 'stabilizedBellyCore',
      name: 'Stabilized Belly Core',
    });
    game.ui.renderInventory();
  });
  await expect(jumpRecipe).toContainText('RECIPE COMPLETE');
  await expect(jumpRecipe).toContainText('Tempered Jump Spring');
  await expect(jumpRecipe).toContainText('Stabilized Belly Core');
  await expect(jumpRecipe).toContainText('0/12');

  const fieldState = await page.evaluate(() => {
    const { game } = window;
    game.player.root.position.copy(game.dungeon.ruinEntryPosition);
    game.ui.renderInventory();
    const disabledSelectors = [...document.querySelectorAll(
      '[data-arm-loadout-slot], [data-gear-loadout-slot]',
    )].every((select) => select.disabled);
    const switched = game.combat.switchArmSlot(1);
    return {
      disabledSelectors,
      switched,
      activeArmId: game.player.getActiveArmWeapon()?.fixedArmId,
      status: document.getElementById('loadout-edit-status')?.textContent,
    };
  });
  expect(fieldState).toMatchObject({
    disabledSelectors: true,
    switched: true,
    activeArmId: 'laserBeamBlade',
  });
  expect(fieldState.status).toMatch(/Read-only/);

  const barrierState = await page.evaluate(() => {
    const { game } = window;
    const loadout = game.player.gearLoadout;
    loadout.setDefenseUnlocked(true);
    loadout.unlock('barrierGenerator');
    loadout.equip('barrierGenerator', 'defense');
    game.player.applyGearLoadoutState(loadout.snapshot(), { refillBarrier: true });
    game.ui._renderBarrierHud();
    const ready = {
      hidden: document.getElementById('barrier-hud').hidden,
      value: document.getElementById('barrier-value').textContent,
      ariaNow: document.getElementById('barrier-hud').getAttribute('aria-valuenow'),
      ariaLabel: document.getElementById('barrier-hud').getAttribute('aria-label'),
    };
    game.player.takeIncomingHit({ amount: 50, reactionTier: 0 });
    game.ui._renderBarrierHud();
    return {
      ready,
      broken: {
        value: document.getElementById('barrier-value').textContent,
        status: document.getElementById('barrier-status').textContent,
        ariaNow: document.getElementById('barrier-hud').getAttribute('aria-valuenow'),
        ariaLabel: document.getElementById('barrier-hud').getAttribute('aria-label'),
      },
    };
  });
  expect(barrierState.ready).toEqual({
    hidden: false,
    value: '40 / 40',
    ariaNow: '40',
    ariaLabel: 'Barrier 40 of 40',
  });
  expect(barrierState.broken).toEqual({
    value: '0 / 40',
    status: 'BROKEN',
    ariaNow: '0',
    ariaLabel: 'Barrier 0 of 40, broken',
  });
  expect(runtimeErrors).toEqual([]);
});

test('Target Scanner creates cyan target highlighting and obeys range and world line of sight', async ({ page }) => {
  const runtimeErrors = await openReadyGame(page);

  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { game } = window;
    const loadout = game.player.gearLoadout;
    loadout.unlock('targetScanner');
    loadout.equip('targetScanner', 'utility1');
    const attackBefore = game.player.stats.attackDamage;
    game.player.applyGearLoadoutState(loadout.snapshot());

    const root = new THREE.Group();
    root.name = 'scannerTestEnemy';
    const weakPoint = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.4, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xff3344 }),
    );
    weakPoint.position.copy(game.player.root.position).add(new THREE.Vector3(0, 1, 5));
    root.add(weakPoint);
    game.scene.add(root);
    root.updateMatrixWorld(true);
    const enemy = {
      root,
      dead: false,
      weakPointBroken: false,
      brain: { weakPointExposed: true, clawDestroyed: true },
      visual: { weakPoint: { core: weakPoint } },
    };
    game.enemies.push(enemy);
    game._updateTargetScanner();
    const visibleMarker = game.targetScannerMarkers.get(weakPoint);
    const visible = {
      markerCount: game.targetScannerMarkers.size,
      reticleName: visibleMarker?.reticle?.name,
      highlightName: visibleMarker?.highlight?.name,
      highlightColor: visibleMarker?.highlight?.material?.color?.getHexString(),
      attackUnchanged: game.player.stats.attackDamage === attackBefore,
    };

    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 3, 0.35),
      new THREE.MeshBasicMaterial({ color: 0x333333 }),
    );
    wall.position.copy(game.player.root.position).add(new THREE.Vector3(0, 1, 2.5));
    game.scene.add(wall);
    wall.updateMatrixWorld(true);
    game.cameraOcclusionEntries.push({ object: wall });
    game._updateTargetScanner();
    const blockedCount = game.targetScannerMarkers.size;

    game.cameraOcclusionEntries = game.cameraOcclusionEntries.filter((entry) => entry.object !== wall);
    weakPoint.position.copy(game.player.root.position).add(new THREE.Vector3(0, 1, 19));
    root.updateMatrixWorld(true);
    game._updateTargetScanner();
    const outOfRangeCount = game.targetScannerMarkers.size;

    game.enemies.splice(game.enemies.indexOf(enemy), 1);
    wall.removeFromParent();
    root.removeFromParent();
    wall.geometry.dispose();
    wall.material.dispose();
    weakPoint.geometry.dispose();
    weakPoint.material.dispose();
    return { visible, blockedCount, outOfRangeCount };
  });

  expect(result.visible).toEqual({
    markerCount: 1,
    reticleName: 'targetScannerCyanReticle',
    highlightName: 'targetScannerCyanHighlight',
    highlightColor: '55f4ff',
    attackUnchanged: true,
  });
  expect(result.blockedCount).toBe(0);
  expect(result.outOfRangeCount).toBe(0);
  expect(runtimeErrors).toEqual([]);
});

test('mandatory generated routes validate with the unequipped 1.65 base jump envelope', async ({ page }) => {
  test.setTimeout(60_000);
  const runtimeErrors = await openReadyGame(page);

  const results = await page.evaluate(async () => {
    const [{ DungeonGenerator }, traversal] = await Promise.all([
      import('/src/DungeonGenerator.js'),
      import('/src/TraversalCapabilities.js'),
    ]);
    const generated = [];
    for (const seed of [1, 2, 3, 7, 11]) {
      let state = seed >>> 0;
      const random = () => (
        (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
      );
      const dungeon = new DungeonGenerator({ random }).generate();
      const floorKeys = new Set(dungeon.floorTiles.map((tile) => (
        `${tile.x},${tile.z}@${tile.level ?? 0}`
      )));
      const requiredRoutes = dungeon.connectionPlans.filter((plan) => plan.requiredForProgression);
      generated.push({
        seed,
        accepted: dungeon.progression.validation.accepted,
        errors: dungeon.progression.validation.errors,
        requiredRouteCount: requiredRoutes.length,
        everyRequiredTileExists: requiredRoutes.every((plan) => plan.bridgePath.every((point) => (
          floorKeys.has(`${point.x},${point.z}@${plan.level}`)
        ))),
      });
      dungeon.group.clear();
    }
    return {
      jumpHeight: traversal.PLAYER_TRAVERSAL_CAPABILITIES.jumpHeight,
      generated,
    };
  });

  expect(results.jumpHeight).toBe(1.65);
  expect(results.generated.every((entry) => (
    entry.accepted
    && entry.errors.length === 0
    && entry.requiredRouteCount > 0
    && entry.everyRequiredTileExists
  ))).toBe(true);
  expect(runtimeErrors).toEqual([]);
});
