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

test('manual aim redirects shots while movement lock keeps target facing', async ({ page }) => {
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
    const manualDepthWithLock = game.manualAimPlaneDepth;
    const savedLockState = {
      target: combat.lockOn.target,
      progress: combat.lockOn.progress,
      movementLocked: combat.lockOn.movementLocked,
      manual: combat.lockOn.manual,
      source: combat.lockOn.source,
    };
    combat.lockOn.target = null;
    combat.lockOn.progress = 0;
    combat.lockOn.movementLocked = false;
    combat.lockOn.manual = false;
    combat.lockOn.source = null;
    game.manualAimPlaneActive = false;
    game.manualAimPlaneDepth = 0;
    game._updateAimFromPointer();
    const manualAimWithoutLock = game.pointer.aimWorld.clone();
    const manualDepthWithoutLock = game.manualAimPlaneDepth;
    Object.assign(combat.lockOn, savedLockState);
    const manualAimProjected = manualAim.clone().project(game.camera);
    const manualAimReticleError = Math.hypot(
      manualAimProjected.x - projectedManualPoint.x,
      manualAimProjected.y - projectedManualPoint.y,
    );
    const projectileOrigin = player.getProjectileOrigin();
    const manualDirectionWithLock = manualAim.clone().sub(projectileOrigin).normalize();
    const manualDirectionWithoutLock = manualAimWithoutLock.clone().sub(projectileOrigin).normalize();
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
    combat.update(0.1);
    const lockSurvivesManualAimPress = combat.getMovementLockTarget() === enemy;
    const rightMouseActivatesManualAim = combat.isManualAimOverrideActive(game.pointer);
    game.pointer.secondary = false;
    combat.update(0.01);
    const lockSurvivesManualAimRelease = combat.getMovementLockTarget() === enemy;
    const rightMouseReleaseEndsManualAim = !combat.isManualAimOverrideActive(game.pointer);

    const unlockEvent = new KeyboardEvent('keydown', {
      code: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(unlockEvent);
    const firstTabPulseQueued = game.pointer.lockOnPressed;
    combat.update(0.01);
    const tabUnlocks = combat.getMovementLockTarget() === null;

    const relockEvent = new KeyboardEvent('keydown', {
      code: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(relockEvent);
    const secondTabPulseQueued = game.pointer.lockOnPressed;
    combat.update(0.01);
    const tabRelocks = combat.getMovementLockTarget() === enemy;

    return {
      manualOverrideActive,
      automaticAimDistanceToLock: automaticAim.distanceTo(lockPoint),
      manualAimReticleError,
      effectiveManualAimDistance: effectiveManualAim.distanceTo(manualAim),
      manualAimLockIndependence: manualAim.distanceTo(manualAimWithoutLock),
      manualDirectionLockIndependence: manualDirectionWithLock.dot(manualDirectionWithoutLock),
      manualDepthDifference: Math.abs(manualDepthWithLock - manualDepthWithoutLock),
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
      rightMouseActivatesManualAim,
      lockSurvivesManualAimRelease,
      rightMouseReleaseEndsManualAim,
      unlockTabPrevented: unlockEvent.defaultPrevented,
      relockTabPrevented: relockEvent.defaultPrevented,
      firstTabPulseQueued,
      secondTabPulseQueued,
      tabUnlocks,
      tabRelocks,
    };
  });

  expect(result.manualOverrideActive).toBe(true);
  expect(result.automaticAimDistanceToLock).toBeLessThan(0.001);
  expect(result.manualAimReticleError).toBeLessThan(0.0001);
  expect(result.effectiveManualAimDistance).toBeLessThan(0.001);
  expect(result.manualAimLockIndependence).toBeLessThan(0.001);
  expect(result.manualDirectionLockIndependence).toBeGreaterThan(0.999999);
  expect(result.manualDepthDifference).toBeLessThan(0.001);
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
  expect(result.rightMouseActivatesManualAim).toBe(true);
  expect(result.lockSurvivesManualAimRelease).toBe(true);
  expect(result.rightMouseReleaseEndsManualAim).toBe(true);
  expect(result.unlockTabPrevented).toBe(true);
  expect(result.relockTabPrevented).toBe(true);
  expect(result.firstTabPulseQueued).toBe(true);
  expect(result.secondTabPulseQueued).toBe(true);
  expect(result.tabUnlocks).toBe(true);
  expect(result.tabRelocks).toBe(true);
});

test('free aim reticle acquisition initiates strafing lock without steering manual fire', async ({ page }) => {
  await page.goto('/?reaverbotSeed=free-aim-reticle-lock-proof');
  await page.waitForFunction(() => Boolean(window.game?.combat && window.game?.player));

  const result = await page.evaluate(async () => {
    const { Object3D, Vector3 } = await import('three');
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
    player.root.updateMatrixWorld(true);
    game.camera.position.set(0, 3.1, -7);
    game.camera.lookAt(0, 1.35, 5.5);
    game.camera.updateMatrixWorld(true);

    const enemy = game.spawner.spawnEnemy('basic', false, new Vector3(0, 0, 5.5), {
      allowRandomElite: false,
    });
    const makeLockPoint = (id, x) => {
      const root = new Object3D();
      root.position.set(x, 1.45, 0);
      enemy.root.add(root);
      return {
        id,
        ownerEnemy: enemy,
        root,
        isWeakPointTarget: true,
        active: true,
        get dead() {
          return enemy.dead;
        },
        getWorldPosition(out) {
          return root.getWorldPosition(out);
        },
      };
    };
    const leftLockPoint = makeLockPoint(`${enemy.id}:left-lock-point`, -1.2);
    const rightLockPoint = makeLockPoint(`${enemy.id}:right-lock-point`, 1.2);
    enemy.getCombatTargets = () => [leftLockPoint, rightLockPoint, enemy];
    enemy.root.updateMatrixWorld(true);

    const canvasRect = game.renderer.domElement.getBoundingClientRect();
    const pointReticleAt = (worldPosition, offsetX = 0, offsetY = 0) => {
      const projected = worldPosition.clone().project(game.camera);
      game.pointer.x = canvasRect.left + (projected.x + 1) * canvasRect.width * 0.5 + offsetX;
      game.pointer.y = canvasRect.top + (1 - projected.y) * canvasRect.height * 0.5 + offsetY;
      game._updateAimFromPointer();
    };
    const updateCombat = () => {
      game.pointer.primary = false;
      game.pointer.primaryPressed = false;
      combat.update(1 / 60);
    };

    combat._clearLockOn();
    game.pointer.secondary = false;
    pointReticleAt(getCombatTargetWorldPosition(leftLockPoint, new Vector3()));
    updateCombat();
    const hoverWithoutAimIgnored = combat.lockOn.target === null;

    game.pointer.secondary = true;
    game.pointer.secondaryPressed = true;
    game.pointer.x = canvasRect.left + canvasRect.width * 0.78;
    game.pointer.y = canvasRect.top + canvasRect.height * 0.22;
    game._updateAimFromPointer();
    updateCombat();
    const highFreeAim = game.pointer.aimWorld.clone();
    game.pointer.y = canvasRect.top + canvasRect.height * 0.78;
    game._updateAimFromPointer();
    const lowFreeAim = game.pointer.aimWorld.clone();
    const cameraForward = new Vector3();
    game.camera.getWorldDirection(cameraForward);
    const freeAimWithoutLock = {
      active: combat.isManualAimOverrideActive(game.pointer),
      cachedActive: combat.manualAimOverrideActive,
      movementTarget: combat.getMovementLockTarget(),
      finiteAimWorld: game.pointer.aimWorld.toArray().every(Number.isFinite),
      verticalAimSpan: highFreeAim.y - lowFreeAim.y,
      cameraFacingPlane: Math.abs(game.aimPlane.normal.dot(cameraForward)),
    };

    pointReticleAt(getCombatTargetWorldPosition(leftLockPoint, new Vector3()));
    updateCombat();
    const leftTargetWorld = getCombatTargetWorldPosition(leftLockPoint, new Vector3());
    const expectedLeftMovementForward = leftTargetWorld.clone()
      .sub(player.root.position)
      .setY(0)
      .normalize();
    const leftMovementBasis = game._getPlayerMovementBasis();
    const leftHover = {
      target: combat.lockOn.target,
      progress: combat.lockOn.progress,
      movementLocked: combat.lockOn.movementLocked,
      movementTarget: combat.getMovementLockTarget(),
      movementBasisTarget: leftMovementBasis.lockOnTarget,
      movementBasisForwardDot: leftMovementBasis.forward.dot(expectedLeftMovementForward),
      source: combat.lockOn.source,
    };

    pointReticleAt(getCombatTargetWorldPosition(enemy, new Vector3()));
    updateCombat();
    const bodyHover = {
      target: combat.lockOn.target,
      progress: combat.lockOn.progress,
      movementLocked: combat.lockOn.movementLocked,
      movementTarget: combat.getMovementLockTarget(),
      source: combat.lockOn.source,
    };

    pointReticleAt(getCombatTargetWorldPosition(rightLockPoint, new Vector3()));
    updateCombat();
    const rightHover = {
      target: combat.lockOn.target,
      progress: combat.lockOn.progress,
      movementLocked: combat.lockOn.movementLocked,
      movementTarget: combat.getMovementLockTarget(),
      source: combat.lockOn.source,
    };

    const rightTargetWorld = getCombatTargetWorldPosition(rightLockPoint, new Vector3());
    pointReticleAt(rightTargetWorld, 72);
    updateCombat();
    const manualShotAim = game.pointer.aimWorld.clone();
    combat.manualAimOverrideActive = combat.isManualAimOverrideActive(game.pointer);
    const effectiveManualAim = combat._getEffectiveAimWorld(
      game.pointer.aimWorld,
      combat.manualAimOverrideActive,
    ).clone();
    const automaticProjectileTarget = (() => {
      combat.manualAimOverrideActive = false;
      return combat._getProjectileLockTarget({ lockOn: true });
    })();
    const manualProjectileTarget = (() => {
      combat.manualAimOverrideActive = true;
      return combat._getProjectileLockTarget({ lockOn: true });
    })();

    const state = combat.getCurrentWeaponState();
    state.cooldown = 0;
    state.reloadTimer = 0;
    state.energy = state.maxEnergy;
    state.weaponOutput = state.maxWeaponOutput ?? 1;
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.attackTimer = 0;
    player.animation.hurtTimer = 0;
    player.holdProjectileFiringPose(effectiveManualAim, 1, { weaponKey: state.key });
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
      combat.tryPrimaryAttack(effectiveManualAim);
    } finally {
      game.projectiles.spawn = originalSpawn;
    }
    const manualShot = capturedShots[0];
    const immediateShotCount = capturedShots.length;
    const expectedManualDirection = effectiveManualAim.clone().sub(manualShot.position).normalize();
    const lockDirection = rightTargetWorld.clone().sub(manualShot.position).normalize();

    game.pointer.x = canvasRect.left + 8;
    game.pointer.y = canvasRect.top + 8;
    game._updateAimFromPointer();
    updateCombat();
    const emptyHoverRetainsRight = combat.lockOn.target === rightLockPoint
      && combat.lockOn.source === 'reticle'
      && combat.getMovementLockTarget() === rightLockPoint;
    game.pointer.secondary = false;
    updateCombat();
    const aimReleaseRetainsRight = combat.lockOn.target === rightLockPoint
      && combat.lockOn.source === 'reticle'
      && combat.getMovementLockTarget() === rightLockPoint
      && !combat.isManualAimOverrideActive(game.pointer);

    game.pointer.secondary = true;
    pointReticleAt(getCombatTargetWorldPosition(leftLockPoint, new Vector3()));
    updateCombat();
    const reticleSwitchLocksLeft = combat.getMovementLockTarget() === leftLockPoint;

    const onTargetUnlockEvent = new KeyboardEvent('keydown', {
      code: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(onTargetUnlockEvent);
    updateCombat();
    updateCombat();
    const onTargetTabUnlockStaysOff = combat.getMovementLockTarget() === null
      && combat.lockOn.target === null;
    game.pointer.secondary = false;
    updateCombat();
    game.pointer.secondary = true;
    pointReticleAt(getCombatTargetWorldPosition(leftLockPoint, new Vector3()));
    updateCombat();
    const aimRepressReacquiresLeft = combat.getMovementLockTarget() === leftLockPoint;

    game.pointer.x = canvasRect.right - 8;
    game.pointer.y = canvasRect.top + 8;
    game._updateAimFromPointer();
    updateCombat();
    const reticleLockStaysStickyOffTarget = combat.getMovementLockTarget() === leftLockPoint;

    const tabUnlockEvent = new KeyboardEvent('keydown', {
      code: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(tabUnlockEvent);
    const unlockTabPulseQueued = game.pointer.lockOnPressed;
    updateCombat();
    const tabClearsReticleMovementLock = combat.getMovementLockTarget() === null;
    const tabClearsReticleTarget = combat.lockOn.target === null;

    const relockState = combat.getCurrentWeaponState();
    const relockProfile = combat._getStatefulProfile(combat._getCurrentProfile(), relockState);
    const expectedTabRelockTarget = combat._findLockCandidate(relockProfile);
    const tabRelockEvent = new KeyboardEvent('keydown', {
      code: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(tabRelockEvent);
    const relockTabPulseQueued = game.pointer.lockOnPressed;
    updateCombat();
    const tabRelocksNearest = Boolean(expectedTabRelockTarget)
      && combat.getMovementLockTarget() === expectedTabRelockTarget
      && combat.lockOn.progress === 1
      && combat.lockOn.source === 'tab';

    pointReticleAt(getCombatTargetWorldPosition(rightLockPoint, new Vector3()));
    updateCombat();
    const missile = game.inventory.items.find((item) => item.type === 'missileArm');
    player.assignArmWeaponToSlot(1, missile);
    const missileState = combat.getCurrentWeaponState();
    missileState.cooldown = 0;
    missileState.reloadTimer = 0;
    missileState.energy = missileState.maxEnergy;
    missileState.weaponOutput = missileState.maxWeaponOutput ?? 1;
    const missileOnTargetUnlockEvent = new KeyboardEvent('keydown', {
      code: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(missileOnTargetUnlockEvent);
    updateCombat();
    updateCombat();
    const missileOnTargetTabUnlockStaysOff = combat.getMovementLockTarget() === null
      && combat.lockOn.target === rightLockPoint;
    game.pointer.secondary = false;
    updateCombat();
    game.pointer.secondary = true;
    pointReticleAt(getCombatTargetWorldPosition(rightLockPoint, new Vector3()));
    updateCombat();
    const missileAimRepressReacquiresRight = combat.getMovementLockTarget() === rightLockPoint;
    game.pointer.aimWorld.copy(manualShotAim);
    combat.manualAimOverrideActive = true;
    const capturedSalvoShots = [];
    game.projectiles.spawn = (shot) => {
      capturedSalvoShots.push({
        position: shot.position.clone(),
        direction: shot.direction.clone(),
        target: shot.target ?? null,
      });
      return shot;
    };
    let manualSalvoAccepted = false;
    try {
      manualSalvoAccepted = combat.trySecondaryAction(manualShotAim);
    } finally {
      game.projectiles.spawn = originalSpawn;
    }
    const salvoDirectionDots = capturedSalvoShots.map((shot) => shot.direction.dot(
      manualShotAim.clone().sub(shot.position).normalize(),
    ));
    const manualSalvoBestAlignment = salvoDirectionDots.length > 0
      ? Math.max(...salvoDirectionDots)
      : -1;
    const manualSalvoWorstAlignment = salvoDirectionDots.length > 0
      ? Math.min(...salvoDirectionDots)
      : -1;
    const manualSalvoTargetsSuppressed = capturedSalvoShots.length > 0
      && capturedSalvoShots.every((shot) => shot.target === null);
    missileState.cooldown = 0;
    missileState.reloadTimer = 0;
    missileState.energy = missileState.maxEnergy;
    missileState.weaponOutput = missileState.maxWeaponOutput ?? 1;
    player._releaseProjectileAim();
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.attackTimer = 0;
    player.animation.hurtTimer = 0;
    combat.manualAimOverrideActive = true;
    const pendingBefore = combat.pendingProjectileShots.length;
    game.projectiles.spawn = (shot) => {
      capturedShots.push({
        position: shot.position.clone(),
        direction: shot.direction.clone(),
        target: shot.target ?? null,
      });
      return shot;
    };
    let delayedAttackAccepted = false;
    let queuedDuringManualAim = false;
    try {
      delayedAttackAccepted = combat.tryPrimaryAttack(manualShotAim);
      queuedDuringManualAim = combat.pendingProjectileShots.length === pendingBefore + 1;
      game.pointer.secondary = false;
      combat.manualAimOverrideActive = false;
      player.animation.attackTimer = 0;
      player.animation.actionTimer = 0;
      combat._updatePendingProjectileShots(1);
    } finally {
      game.projectiles.spawn = originalSpawn;
    }
    const delayedShot = capturedShots[1] ?? null;
    const delayedExpectedDirection = delayedShot
      ? manualShotAim.clone().sub(delayedShot.position).normalize()
      : null;
    const releasedAimCanUseSelectedTarget = combat._getProjectileLockTarget({ lockOn: true })
      === rightLockPoint;

    return {
      freeAimWithoutLock,
      hoverWithoutAimIgnored,
      leftHoverMatches: leftHover.target === leftLockPoint,
      leftHoverProgress: leftHover.progress,
      leftHoverMovementLocked: leftHover.movementLocked,
      leftHoverMovementTargetMatches: leftHover.movementTarget === leftLockPoint,
      leftMovementBasisTargetMatches: leftHover.movementBasisTarget === leftLockPoint,
      leftMovementBasisForwardDot: leftHover.movementBasisForwardDot,
      leftHoverSource: leftHover.source,
      bodyHoverMatches: bodyHover.target === enemy,
      bodyHoverProgress: bodyHover.progress,
      bodyHoverMovementLocked: bodyHover.movementLocked,
      bodyHoverMovementTargetMatches: bodyHover.movementTarget === enemy,
      bodyHoverSource: bodyHover.source,
      rightHoverMatches: rightHover.target === rightLockPoint,
      rightHoverProgress: rightHover.progress,
      rightHoverMovementLocked: rightHover.movementLocked,
      rightHoverMovementTargetMatches: rightHover.movementTarget === rightLockPoint,
      rightHoverSource: rightHover.source,
      effectiveAimDistance: effectiveManualAim.distanceTo(manualShotAim),
      automaticProjectileUsesHoverLock: automaticProjectileTarget === rightLockPoint,
      manualProjectileIgnoresHoverLock: manualProjectileTarget === null,
      shotCount: immediateShotCount,
      shotFollowsReticle: manualShot.direction.dot(expectedManualDirection),
      shotAngleFromLock: manualShot.direction.angleTo(lockDirection),
      shotTargetSuppressed: manualShot.target === null,
      emptyHoverRetainsRight,
      aimReleaseRetainsRight,
      tabUnlockPrevented: tabUnlockEvent.defaultPrevented,
      unlockTabPulseQueued,
      reticleSwitchLocksLeft,
      onTargetUnlockPrevented: onTargetUnlockEvent.defaultPrevented,
      onTargetTabUnlockStaysOff,
      aimRepressReacquiresLeft,
      reticleLockStaysStickyOffTarget,
      tabClearsReticleMovementLock,
      tabClearsReticleTarget,
      tabRelockPrevented: tabRelockEvent.defaultPrevented,
      relockTabPulseQueued,
      tabRelocksNearest,
      missileFound: Boolean(missile),
      missileOnTargetUnlockPrevented: missileOnTargetUnlockEvent.defaultPrevented,
      missileOnTargetTabUnlockStaysOff,
      missileAimRepressReacquiresRight,
      manualSalvoAccepted,
      manualSalvoShotCount: capturedSalvoShots.length,
      manualSalvoBestAlignment,
      manualSalvoWorstAlignment,
      manualSalvoTargetsSuppressed,
      delayedAttackAccepted,
      queuedDuringManualAim,
      delayedShotFired: Boolean(delayedShot),
      delayedShotFollowsReticle: delayedShot && delayedExpectedDirection
        ? delayedShot.direction.dot(delayedExpectedDirection)
        : -1,
      delayedShotTargetSuppressed: delayedShot?.target === null,
      releasedAimCanUseSelectedTarget,
    };
  });

  expect(result.freeAimWithoutLock.active).toBe(true);
  expect(result.freeAimWithoutLock.cachedActive).toBe(true);
  expect(result.freeAimWithoutLock.movementTarget).toBe(null);
  expect(result.freeAimWithoutLock.finiteAimWorld).toBe(true);
  expect(result.freeAimWithoutLock.verticalAimSpan).toBeGreaterThan(1);
  expect(result.freeAimWithoutLock.cameraFacingPlane).toBeGreaterThan(0.999);
  expect(result.hoverWithoutAimIgnored).toBe(true);
  expect(result.leftHoverMatches).toBe(true);
  expect(result.leftHoverProgress).toBe(1);
  expect(result.leftHoverMovementLocked).toBe(true);
  expect(result.leftHoverMovementTargetMatches).toBe(true);
  expect(result.leftMovementBasisTargetMatches).toBe(true);
  expect(result.leftMovementBasisForwardDot).toBeGreaterThan(0.9999);
  expect(result.leftHoverSource).toBe('reticle');
  expect(result.bodyHoverMatches).toBe(true);
  expect(result.bodyHoverProgress).toBe(1);
  expect(result.bodyHoverMovementLocked).toBe(true);
  expect(result.bodyHoverMovementTargetMatches).toBe(true);
  expect(result.bodyHoverSource).toBe('reticle');
  expect(result.rightHoverMatches).toBe(true);
  expect(result.rightHoverProgress).toBe(1);
  expect(result.rightHoverMovementLocked).toBe(true);
  expect(result.rightHoverMovementTargetMatches).toBe(true);
  expect(result.rightHoverSource).toBe('reticle');
  expect(result.effectiveAimDistance).toBeLessThan(0.001);
  expect(result.automaticProjectileUsesHoverLock).toBe(true);
  expect(result.manualProjectileIgnoresHoverLock).toBe(true);
  expect(result.shotCount).toBe(1);
  expect(result.shotFollowsReticle).toBeGreaterThan(0.9999);
  expect(result.shotAngleFromLock).toBeGreaterThan(0.08);
  expect(result.shotTargetSuppressed).toBe(true);
  expect(result.emptyHoverRetainsRight).toBe(true);
  expect(result.aimReleaseRetainsRight).toBe(true);
  expect(result.tabUnlockPrevented).toBe(true);
  expect(result.unlockTabPulseQueued).toBe(true);
  expect(result.reticleSwitchLocksLeft).toBe(true);
  expect(result.onTargetUnlockPrevented).toBe(true);
  expect(result.onTargetTabUnlockStaysOff).toBe(true);
  expect(result.aimRepressReacquiresLeft).toBe(true);
  expect(result.reticleLockStaysStickyOffTarget).toBe(true);
  expect(result.tabClearsReticleMovementLock).toBe(true);
  expect(result.tabClearsReticleTarget).toBe(true);
  expect(result.tabRelockPrevented).toBe(true);
  expect(result.relockTabPulseQueued).toBe(true);
  expect(result.tabRelocksNearest).toBe(true);
  expect(result.missileFound).toBe(true);
  expect(result.missileOnTargetUnlockPrevented).toBe(true);
  expect(result.missileOnTargetTabUnlockStaysOff).toBe(true);
  expect(result.missileAimRepressReacquiresRight).toBe(true);
  expect(result.manualSalvoAccepted).toBe(true);
  expect(result.manualSalvoShotCount).toBeGreaterThanOrEqual(2);
  expect(result.manualSalvoBestAlignment).toBeGreaterThan(0.9999);
  expect(result.manualSalvoWorstAlignment).toBeGreaterThan(0.97);
  expect(result.manualSalvoTargetsSuppressed).toBe(true);
  expect(result.delayedAttackAccepted).toBe(true);
  expect(result.queuedDuringManualAim).toBe(true);
  expect(result.delayedShotFired).toBe(true);
  expect(result.delayedShotFollowsReticle).toBeGreaterThan(0.99);
  expect(result.delayedShotTargetSuppressed).toBe(true);
  expect(result.releasedAimCanUseSelectedTarget).toBe(true);
});

test('entering pointer lock preserves the existing reticle position', async ({ page }) => {
  await page.goto('/?reaverbotSeed=pointer-lock-reticle-continuity');
  await page.waitForFunction(() => Boolean(window.game?.renderer?.domElement));

  const result = await page.evaluate(() => {
    const game = window.game;
    game.stop();
    const canvas = game.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const priorPointer = {
      x: rect.left + rect.width * 0.73,
      y: rect.top + rect.height * 0.28,
    };
    const pointerLockClick = {
      x: rect.left + rect.width * 0.16,
      y: rect.top + rect.height * 0.82,
    };
    let pointerLockRequests = 0;
    game._requestGameplayPointerLock = () => {
      pointerLockRequests += 1;
    };
    game.pointerLocked = false;
    game.pointer.secondary = false;
    game.pointer.secondaryPressed = false;

    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: priorPointer.x,
      clientY: priorPointer.y,
      bubbles: true,
    }));
    const beforePointerDown = { x: game.pointer.x, y: game.pointer.y };

    const pointerDown = new PointerEvent('pointerdown', {
      pointerId: 1,
      button: 2,
      clientX: pointerLockClick.x,
      clientY: pointerLockClick.y,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(pointerDown);

    return {
      priorPointer,
      pointerLockClick,
      beforePointerDown,
      afterPointerDown: { x: game.pointer.x, y: game.pointer.y },
      pointerLockRequests,
      secondaryHeld: game.pointer.secondary,
      secondaryPressed: game.pointer.secondaryPressed,
      pointerDownPrevented: pointerDown.defaultPrevented,
    };
  });

  expect(result.beforePointerDown.x).toBeCloseTo(result.priorPointer.x, 5);
  expect(result.beforePointerDown.y).toBeCloseTo(result.priorPointer.y, 5);
  expect(result.afterPointerDown.x).toBeCloseTo(result.priorPointer.x, 5);
  expect(result.afterPointerDown.y).toBeCloseTo(result.priorPointer.y, 5);
  expect(result.afterPointerDown.x).not.toBeCloseTo(result.pointerLockClick.x, 1);
  expect(result.afterPointerDown.y).not.toBeCloseTo(result.pointerLockClick.y, 1);
  expect(result.pointerLockRequests).toBe(1);
  expect(result.secondaryHeld).toBe(true);
  expect(result.secondaryPressed).toBe(true);
  expect(result.pointerDownPrevented).toBe(true);
});
