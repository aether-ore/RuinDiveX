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

test('manual aim overrides only shot direction while movement lock keeps target facing', async ({ page }) => {
  await page.goto('/?reaverbotSeed=locked-manual-aim-proof');
  await page.waitForFunction(() => Boolean(window.game?.combat && window.game?.player));

  const result = await page.evaluate(async () => {
    const { Vector3 } = await import('three');
    const { getCombatTargetWorldPosition } = await import('./src/reaverbots/CombatTarget.js');
    const game = window.game;
    const combat = game.combat;
    const player = game.player;
    game.stop();
    for (const existing of [...game.enemies]) {
      existing.dispose?.();
      existing.root.removeFromParent();
    }
    game.enemies.length = 0;

    player.root.position.set(0, 0, 0);
    player.lastMoveDirection.set(0, 0, 1);
    game.camera.position.set(0, 3.2, -7);
    game.camera.lookAt(0, 1.25, 8);
    game.camera.updateMatrixWorld(true);
    const enemy = game.spawner.spawnEnemy('basic', false, new Vector3(0, 0, 8), {
      allowRandomElite: false,
    });
    combat.lockOn.target = enemy;
    combat.lockOn.progress = 1;
    combat.lockOn.movementLocked = true;
    combat.lockOn.manual = true;

    const lockPoint = getCombatTargetWorldPosition(enemy, new Vector3());
    const cameraRight = new Vector3(1, 0, 0).applyQuaternion(game.camera.quaternion).normalize();
    const cameraUp = new Vector3(0, 1, 0).applyQuaternion(game.camera.quaternion).normalize();
    const desiredManualPoint = lockPoint.clone()
      .addScaledVector(cameraRight, 1.15)
      .addScaledVector(cameraUp, 0.82);
    const projectedManualPoint = desiredManualPoint.clone().project(game.camera);
    const canvasRect = game.renderer.domElement.getBoundingClientRect();
    game.pointer.x = canvasRect.left + (projectedManualPoint.x + 1) * canvasRect.width * 0.5;
    game.pointer.y = canvasRect.top + (1 - projectedManualPoint.y) * canvasRect.height * 0.5;

    game.pointer.secondary = false;
    const automaticAim = combat._getEffectiveAimWorld(game.pointer.aimWorld, false).clone();
    game.pointer.secondary = true;
    game._updateAimFromPointer();
    const manualAim = game.pointer.aimWorld.clone();
    const manualOverrideActive = combat.isManualAimOverrideActive(game.pointer);
    const effectiveManualAim = combat._getEffectiveAimWorld(manualAim, manualOverrideActive).clone();

    const state = combat.getCurrentWeaponState();
    const profile = combat._getStatefulProfile(combat._getCurrentProfile(), state);
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.attackTimer = 0;
    player.animation.hurtTimer = 0;
    player.holdProjectileFiringPose(lockPoint, 1, { weaponKey: state.key });
    const capturedShots = [];
    const originalSpawn = game.projectiles.spawn;
    game.projectiles.spawn = (shot) => {
      capturedShots.push({
        position: shot.position.clone(),
        direction: shot.direction.clone(),
        target: shot.target ?? null,
      });
      return shot;
    };
    try {
      state.cooldown = 0;
      state.reloadTimer = 0;
      state.weaponOutput = state.maxWeaponOutput ?? 1;
      combat.manualAimOverrideActive = false;
      combat.tryPrimaryAttack(automaticAim);

      state.cooldown = 0;
      state.reloadTimer = 0;
      state.weaponOutput = state.maxWeaponOutput ?? 1;
      player.animation.attackTimer = 0;
      combat.manualAimOverrideActive = true;
      combat.tryPrimaryAttack(effectiveManualAim);
    } finally {
      game.projectiles.spawn = originalSpawn;
    }

    const automaticShot = capturedShots[0];
    const manualShot = capturedShots[1];
    const automaticExpected = lockPoint.clone().sub(automaticShot.position).normalize();
    const manualExpected = effectiveManualAim.clone().sub(manualShot.position).normalize();
    const lockFlatDirection = lockPoint.clone().sub(player.root.position).setY(0).normalize();
    const bodyForward = new Vector3(0, 0, 1).applyQuaternion(player.root.quaternion).setY(0).normalize();
    const bracedFacing = player.bracedFireDirection.clone().setY(0).normalize();
    const autoProjectileLock = (() => {
      combat.manualAimOverrideActive = false;
      return combat._getProjectileLockTarget({ lockOn: true }) === enemy;
    })();
    const manualProjectileLockSuppressed = (() => {
      combat.manualAimOverrideActive = true;
      return combat._getProjectileLockTarget({ lockOn: true }) === null;
    })();
    const movementLockPreservedDuringShots = combat.getMovementLockTarget() === enemy;

    game.cameraController.snapTo(player);
    game.camera.updateMatrixWorld(true);
    const targetOnScreen = lockPoint.clone().project(game.camera);

    game.pointer.primary = false;
    game.pointer.primaryPressed = false;
    game.pointer.secondary = true;
    game.pointer.secondaryPressed = true;
    combat.secondaryWasDown = false;
    combat.update(0.1);
    const lockSurvivesManualAimPress = combat.getMovementLockTarget() === enemy;
    game.pointer.secondary = true;
    combat.update(0.1);
    const heldAimRecognized = combat.lockOn.manualAimUsed;
    game.pointer.secondary = false;
    combat.update(0.01);
    const lockSurvivesManualAimRelease = combat.getMovementLockTarget() === enemy;
    game.pointer.secondary = true;
    game.pointer.secondaryPressed = true;
    combat.update(0.05);
    game.pointer.secondary = false;
    combat.update(0.05);
    const quickTapUnlocks = combat.getMovementLockTarget() === null;

    return {
      manualOverrideActive,
      automaticAimDistanceToLock: automaticAim.distanceTo(lockPoint),
      manualAimDistanceToDesired: manualAim.distanceTo(desiredManualPoint),
      effectiveManualAimDistance: effectiveManualAim.distanceTo(desiredManualPoint),
      shotCount: capturedShots.length,
      automaticShotDot: automaticShot.direction.dot(automaticExpected),
      manualShotDot: manualShot.direction.dot(manualExpected),
      shotDirectionsDiffer: automaticShot.direction.angleTo(manualShot.direction),
      bodyFacesLock: bodyForward.dot(lockFlatDirection),
      bracedPoseFacesLock: bracedFacing.dot(lockFlatDirection),
      movementLockPreserved: movementLockPreservedDuringShots,
      autoProjectileLock,
      manualProjectileLockSuppressed,
      targetScreenX: targetOnScreen.x,
      targetScreenY: targetOnScreen.y,
      targetScreenZ: targetOnScreen.z,
      lockSurvivesManualAimPress,
      heldAimRecognized,
      lockSurvivesManualAimRelease,
      quickTapUnlocks,
    };
  });

  expect(result.manualOverrideActive).toBe(true);
  expect(result.automaticAimDistanceToLock).toBeLessThan(0.001);
  expect(result.manualAimDistanceToDesired).toBeLessThan(0.01);
  expect(result.effectiveManualAimDistance).toBeLessThan(0.01);
  expect(result.shotCount).toBe(2);
  expect(result.automaticShotDot).toBeGreaterThan(0.999);
  expect(result.manualShotDot).toBeGreaterThan(0.999);
  expect(result.shotDirectionsDiffer).toBeGreaterThan(0.08);
  expect(result.bodyFacesLock).toBeGreaterThan(0.999);
  expect(result.bracedPoseFacesLock).toBeGreaterThan(0.999);
  expect(result.movementLockPreserved).toBe(true);
  expect(result.autoProjectileLock).toBe(true);
  expect(result.manualProjectileLockSuppressed).toBe(true);
  expect(Math.abs(result.targetScreenX)).toBeLessThan(0.35);
  expect(Math.abs(result.targetScreenY)).toBeLessThan(0.65);
  expect(result.targetScreenZ).toBeGreaterThan(-1);
  expect(result.targetScreenZ).toBeLessThan(1);
  expect(result.lockSurvivesManualAimPress).toBe(true);
  expect(result.heldAimRecognized).toBe(true);
  expect(result.lockSurvivesManualAimRelease).toBe(true);
  expect(result.quickTapUnlocks).toBe(true);
});
