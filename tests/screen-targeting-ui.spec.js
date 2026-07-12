import { expect, test } from '@playwright/test';

test('aim and lock-on reticles are flat, screen-space HUD indicators', async ({ page }) => {
  await page.goto('/?reaverbotSeed=screen-targeting-ui-proof');
  await page.waitForFunction(() => Boolean(window.game?.combat && window.game?.player));

  const result = await page.evaluate(async () => {
    const { Vector3 } = await import('three');
    const { getCombatTargetWorldPosition } = await import('./src/reaverbots/CombatTarget.js');
    const game = window.game;
    game.stop();

    const canvasRect = game.renderer.domElement.getBoundingClientRect();
    const pointerX = canvasRect.left + canvasRect.width * 0.31;
    const pointerY = canvasRect.top + canvasRect.height * 0.46;
    game.pointer.x = pointerX;
    game.pointer.y = pointerY;
    game._updateAimFromPointer();

    const aim = document.getElementById('aim-reticle');
    const aimStyle = getComputedStyle(aim);
    const aimBounds = aim.getBoundingClientRect();
    const aimAtFirstPointer = {
      x: parseFloat(aim.style.left),
      y: parseFloat(aim.style.top),
    };
    game.pointer.x = pointerX + 120;
    game.pointer.y = pointerY - 64;
    game._updateAimFromPointer();
    const aimAtSecondPointer = {
      x: parseFloat(aim.style.left),
      y: parseFloat(aim.style.top),
    };

    game.player.root.position.set(0, 0, 0);
    game.camera.position.set(0, 3.25, -7);
    game.camera.lookAt(0, 1.3, 5);
    game.camera.updateMatrixWorld(true);
    const enemy = game.spawner.spawnEnemy('basic', false, new Vector3(0, 0, 5), {
      allowRandomElite: false,
    });
    game.combat.lockOn.target = enemy;
    game.combat.lockOn.progress = 0.64;
    game.combat._updateLockMarker();

    const marker = document.getElementById('lock-on-indicator');
    const markerStyle = getComputedStyle(marker);
    const firstMarkerBounds = marker.getBoundingClientRect();
    const targetWorld = getCombatTargetWorldPosition(enemy, new Vector3());
    if (!enemy.isWeakPointTarget) targetWorld.y += 0.58;
    const projected = targetWorld.clone().project(game.camera);
    const expectedX = canvasRect.left + (projected.x + 1) * canvasRect.width * 0.5;
    const expectedY = canvasRect.top + (1 - projected.y) * canvasRect.height * 0.5;
    const markerPosition = {
      x: parseFloat(marker.style.left),
      y: parseFloat(marker.style.top),
    };

    enemy.root.position.z = 25;
    enemy.root.updateMatrixWorld(true);
    game.combat._updateLockMarker();
    const distantMarkerBounds = marker.getBoundingClientRect();
    const markerHiddenBeforeClear = marker.hidden;
    game.combat._clearLockOn();

    return {
      aimExists: Boolean(aim),
      aimCoordinateSpace: aim.dataset.coordinateSpace,
      aimParentId: aim.parentElement?.id ?? null,
      aimPositionMode: aimStyle.position,
      aimWidth: aimBounds.width,
      aimHeight: aimBounds.height,
      aimAtFirstPointer,
      aimAtSecondPointer,
      pointerX,
      pointerY,
      worldAimReticleAbsent: !game.scene.getObjectByName('manualAimReticle'),
      lockExists: Boolean(marker),
      lockCoordinateSpace: marker.dataset.coordinateSpace,
      lockParentId: marker.parentElement?.id ?? null,
      lockPositionMode: markerStyle.position,
      lockProgress: marker.style.getPropertyValue('--lock-progress'),
      lockMarkerPosition: markerPosition,
      expectedLockPosition: { x: expectedX, y: expectedY },
      lockWidthNear: firstMarkerBounds.width,
      lockHeightNear: firstMarkerBounds.height,
      lockWidthFar: distantMarkerBounds.width,
      lockHeightFar: distantMarkerBounds.height,
      markerHiddenBeforeClear,
      markerHiddenAfterClear: marker.hidden,
      worldLockReticleAbsent: !game.scene.getObjectByName('missileLockOnReticle'),
    };
  });

  expect(result.aimExists).toBe(true);
  expect(result.aimCoordinateSpace).toBe('screen');
  expect(result.aimParentId).toBe('ui-root');
  expect(result.aimPositionMode).toBe('absolute');
  expect(result.aimAtFirstPointer.x).toBeCloseTo(result.pointerX, 3);
  expect(result.aimAtFirstPointer.y).toBeCloseTo(result.pointerY, 3);
  expect(result.aimAtSecondPointer.x).toBeCloseTo(result.pointerX + 120, 3);
  expect(result.aimAtSecondPointer.y).toBeCloseTo(result.pointerY - 64, 3);
  expect(result.aimWidth).toBeGreaterThan(25);
  expect(result.aimHeight).toBeGreaterThan(25);
  expect(result.worldAimReticleAbsent).toBe(true);

  expect(result.lockExists).toBe(true);
  expect(result.lockCoordinateSpace).toBe('screen');
  expect(result.lockParentId).toBe('ui-root');
  expect(result.lockPositionMode).toBe('absolute');
  expect(Number(result.lockProgress)).toBeCloseTo(0.64, 5);
  expect(result.lockMarkerPosition.x).toBeCloseTo(result.expectedLockPosition.x, 2);
  expect(result.lockMarkerPosition.y).toBeCloseTo(result.expectedLockPosition.y, 2);
  expect(result.lockWidthNear).toBeCloseTo(result.lockWidthFar, 2);
  expect(result.lockHeightNear).toBeCloseTo(result.lockHeightFar, 2);
  expect(result.markerHiddenBeforeClear).toBe(false);
  expect(result.markerHiddenAfterClear).toBe(true);
  expect(result.worldLockReticleAbsent).toBe(true);
});
