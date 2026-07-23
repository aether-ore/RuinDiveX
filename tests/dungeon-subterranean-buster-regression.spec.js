import { expect, test } from '@playwright/test';

import {
  followPublicFloorRoute,
  readPublicV1JourneyState,
} from './helpers/public-v1-journey.js';

const SIGNED_ELEVATION_SEED = 'v1-bidirectional-connector-sweep-0000';
const TEST_ELEVATIONS = [0, -14];

test.use({ viewport: { width: 640, height: 360 } });

test('integration: Buster muzzle, aim, projectile, and energy remain player-relative below world zero', async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.goto(`/?startupWorld=dungeon&dungeonSeed=${SIGNED_ELEVATION_SEED}`);
  await expect.poll(
    () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
    { timeout: 60_000 },
  ).toBe('true');
  await page.waitForFunction(() => (
    window.game?.player?._busterArmLoaded === true
    && Boolean(window.game.player.externalRig?.megaBusterMuzzle)
  ));

  const result = await page.evaluate((elevations) => {
    const { game } = window;
    game.stop();

    const { player, combat, projectiles } = game;
    const Vector3 = player.root.position.constructor;
    const originalRootPosition = player.root.position.clone();
    const originalSpawn = projectiles.spawn;
    const originalFireOrQueue = combat._fireOrQueueProjectileAction;
    const originalAnimationState = {
      actionState: player.animation.actionState,
      actionTimer: player.animation.actionTimer,
      attackTimer: player.animation.attackTimer,
      hurtTimer: player.animation.hurtTimer,
    };
    const samples = [];

    try {
      // Exercise the complete primary-fire transaction (including its energy
      // debit), but launch immediately so animation timing cannot make this
      // signed-coordinate regression frame-rate dependent.
      combat._fireOrQueueProjectileAction = (
        action,
        direction,
        profile,
        aimWorld,
      ) => combat._fireProjectileAction(action, direction, profile, aimWorld);

      for (const elevation of elevations) {
        player.root.position.copy(originalRootPosition);
        player.root.position.y = elevation;
        player.root.updateMatrixWorld(true);
        player.switchArmWeapon(0, true);
        player.updateWeaponVisualState();
        player.root.updateMatrixWorld(true);

        const rawMuzzle = player.externalRig.getBusterMuzzleWorldPosition(
          new Vector3(),
          player._getActiveBusterArmSide(),
        );
        const reportedOrigin = player.getProjectileOrigin();
        const forward = new Vector3(
          Math.sin(player.root.rotation.y),
          0,
          Math.cos(player.root.rotation.y),
        ).normalize();
        const aimWorld = player.root.position.clone()
          .addScaledVector(forward, 8)
          .add(new Vector3(0, 1.05, 0));
        const state = combat.getCurrentWeaponState();
        state.cooldown = 0;
        state.reloadTimer = 0;
        state.energy = state.maxEnergy;
        state.weaponOutput = state.maxWeaponOutput;
        state.outputRecoveryDelay = 0;
        player.animation.actionState = null;
        player.animation.actionTimer = 0;
        player.animation.attackTimer = 0;
        player.animation.hurtTimer = 0;

        let spawned = null;
        projectiles.spawn = (options) => {
          const projectile = originalSpawn.call(projectiles, options);
          spawned = projectile ? {
            origin: projectile.mesh.position.toArray(),
            direction: projectile.direction.toArray(),
            meshVisible: projectile.mesh.visible,
            attachedToScene: projectile.mesh.parent === game.scene,
          } : null;
          return projectile;
        };

        const energyBefore = state.energy;
        const outputBefore = state.weaponOutput;
        const attackStarted = combat.tryPrimaryAttack(aimWorld);
        const energyAfter = state.energy;
        const outputAfter = state.weaponOutput;
        const rootY = player.root.position.y;
        samples.push({
          elevation,
          attackStarted,
          rootY,
          rawMuzzle: rawMuzzle.toArray(),
          rawMuzzleLocalY: rawMuzzle.y - rootY,
          reportedOrigin: reportedOrigin.toArray(),
          reportedOriginLocalY: reportedOrigin.y - rootY,
          originError: reportedOrigin.distanceTo(rawMuzzle),
          energyBefore,
          energyAfter,
          energySpent: energyBefore - energyAfter,
          outputBefore,
          outputAfter,
          outputSpent: outputBefore - outputAfter,
          spawned,
          spawnedOriginLocalY: spawned ? spawned.origin[1] - rootY : null,
        });

        for (let index = projectiles.active.length - 1; index >= 0; index -= 1) {
          if (projectiles.active[index].owner === 'player') {
            projectiles._deactivate(index, false);
          }
        }
      }
    } finally {
      projectiles.spawn = originalSpawn;
      combat._fireOrQueueProjectileAction = originalFireOrQueue;
      player.root.position.copy(originalRootPosition);
      player.root.updateMatrixWorld(true);
      Object.assign(player.animation, originalAnimationState);
    }

    return samples;
  }, TEST_ELEVATIONS);

  const [ground, subterranean] = result;
  expect(result.map(({ elevation }) => elevation)).toEqual(TEST_ELEVATIONS);
  for (const sample of result) {
    expect(sample.attackStarted).toBe(true);
    expect(sample.energySpent + sample.outputSpent).toBeGreaterThan(0);
    expect(sample.spawned).not.toBeNull();
    expect(sample.spawned.meshVisible).toBe(true);
    expect(sample.spawned.attachedToScene).toBe(true);
    expect(sample.originError).toBeLessThan(0.05);
    expect(sample.reportedOriginLocalY).toBeGreaterThan(0.7);
    expect(sample.reportedOriginLocalY).toBeLessThan(2.5);
    expect(sample.spawnedOriginLocalY).toBeCloseTo(sample.reportedOriginLocalY, 5);
  }

  expect(subterranean.rawMuzzleLocalY).toBeCloseTo(ground.rawMuzzleLocalY, 4);
  expect(subterranean.reportedOriginLocalY).toBeCloseTo(ground.reportedOriginLocalY, 4);
  expect(subterranean.spawnedOriginLocalY).toBeCloseTo(ground.spawnedOriginLocalY, 4);
  expect(subterranean.spawned.direction[1]).toBeCloseTo(ground.spawned.direction[1], 4);
  expect(subterranean.energySpent).toBeCloseTo(ground.energySpent, 5);
  expect(subterranean.outputSpent).toBeCloseTo(ground.outputSpent, 5);
});

const fireBusterThroughPublicInput = async (page) => {
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (
    (await readPublicV1JourneyState(page, { includeGeometry: false })).activeWeapon
  ), { timeout: 5_000 }).toMatchObject({ slotIndex: 0, type: 'busterArm' });
  // The public hotbar swap has a short authored lockout; wait for it exactly
  // as a player would before pressing fire.
  await page.waitForTimeout(700);

  const canvas = page.locator('canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Dungeon canvas has no public-input bounds.');
  const pointer = {
    x: bounds.x + bounds.width * 0.5,
    y: bounds.y + bounds.height * 0.5,
  };
  await page.mouse.click(pointer.x, pointer.y);
  await page.waitForTimeout(300);
  await expect.poll(async () => (
    (await readPublicV1JourneyState(page, { includeGeometry: false }))
      .activePlayerProjectiles.length
  ), { timeout: 8_000 }).toBe(0);
  await expect.poll(async () => {
    const { activeWeapon } = await readPublicV1JourneyState(page, { includeGeometry: false });
    return activeWeapon.maxWeaponOutput - activeWeapon.weaponOutput;
  }, { timeout: 8_000 }).toBeLessThan(0.001);

  const before = await readPublicV1JourneyState(page, { includeGeometry: false });
  let fired = null;
  await page.mouse.down({ button: 'left' });
  try {
    await expect.poll(async () => {
      const state = await readPublicV1JourneyState(page, { includeGeometry: false });
      if (state.activePlayerProjectiles.length > 0) fired = state;
      return Boolean(fired);
    }, { timeout: 8_000, intervals: [16, 16, 32, 64] }).toBe(true);
  } finally {
    await page.mouse.up({ button: 'left' }).catch(() => {});
  }
  if (!fired) throw new Error('Public Buster input never produced a visible projectile.');

  const projectile = fired.activePlayerProjectiles.at(-1);
  return {
    playerY: fired.player.position.y,
    projectileOriginY: fired.player.projectileOrigin.y,
    projectileOriginLocalY: fired.player.projectileOrigin.y - fired.player.position.y,
    projectilePositionY: projectile.position.y,
    projectilePositionLocalY: projectile.position.y - fired.player.position.y,
    projectileDirection: projectile.direction,
    projectileVisible: projectile.visible,
    projectileAttachedToScene: projectile.attachedToScene,
    projectileDistance: projectile.distance,
    energySpent: before.activeWeapon.energy - fired.activeWeapon.energy,
    outputSpent: before.activeWeapon.weaponOutput - fired.activeWeapon.weaponOutput,
  };
};

test('actual signed V1 seed fires normally after a public descent to -14m', async ({ page }) => {
  test.setTimeout(720_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(
    '/?startupWorld=dungeon'
      + `&dungeonSeed=${SIGNED_ELEVATION_SEED.replace('0000', '0002')}`
      + '&reaverbotSeed=overworld-v1-public-extraction-easy-110',
  );
  await expect.poll(
    () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
    { timeout: 60_000 },
  ).toBe('true');

  console.log('[subterranean-buster] phase=ground-fire');
  const groundSample = await fireBusterThroughPublicInput(page);
  expect(Math.abs(groundSample.playerY)).toBeLessThanOrEqual(0.55);

  let state = await readPublicV1JourneyState(page);
  const ladder = state.connectorLadders.find(({ connectionId }) => (
    connectionId === 'enemyNest_keycardRoom_ground'
  ));
  expect(ladder).toMatchObject({ direction: 'descending', bottomY: -14, topY: 0 });

  console.log('[subterranean-buster] phase=public-route-to-negative-ladder', {
    player: state.player.position,
    bottomExit: ladder.bottomExit,
  });
  const descent = await followPublicFloorRoute(page, ladder.bottomExit, {
    targetRadius: 0.9,
    maximumTargetVerticalDifference: 0.55,
    stopDistance: 0.72,
    timeout: 180_000,
  });
  expect(descent.traversedActions).toContain('ladder');
  expect(descent.traversedConnectorIds).toContain(ladder.connectionId);
  state = await readPublicV1JourneyState(page, { includeGeometry: false });
  expect(state.player.ladderTraversal).toBeNull();
  expect(state.player.position.y).toBeCloseTo(-14, 1);

  console.log('[subterranean-buster] phase=subterranean-fire', {
    player: state.player.position,
  });
  const subterraneanSample = await fireBusterThroughPublicInput(page);
  expect(subterraneanSample.playerY).toBeCloseTo(-14, 1);
  for (const sample of [groundSample, subterraneanSample]) {
    expect(sample.projectileVisible).toBe(true);
    expect(sample.projectileAttachedToScene).toBe(true);
    expect(sample.projectileOriginLocalY).toBeGreaterThan(0.7);
    expect(sample.projectileOriginLocalY).toBeLessThan(2.5);
    expect(sample.projectilePositionLocalY).toBeGreaterThan(0.65);
    expect(sample.projectilePositionLocalY).toBeLessThan(2.6);
    expect(Math.abs(sample.projectileDirection.y)).toBeLessThan(0.08);
    expect(sample.energySpent + sample.outputSpent).toBeGreaterThan(0);
  }
  expect(subterraneanSample.projectileOriginLocalY)
    .toBeCloseTo(groundSample.projectileOriginLocalY, 2);
  expect(subterraneanSample.projectilePositionLocalY)
    .toBeCloseTo(groundSample.projectilePositionLocalY, 1);
  expect(subterraneanSample.projectileDirection.y)
    .toBeCloseTo(groundSample.projectileDirection.y, 2);
  expect(subterraneanSample.energySpent).toBeCloseTo(groundSample.energySpent, 3);
  expect(subterraneanSample.outputSpent).toBeCloseTo(groundSample.outputSpent, 3);
  expect(errors).toEqual([]);
  console.log('[subterranean-buster] phase=complete', {
    groundSample,
    subterraneanSample,
  });
});
