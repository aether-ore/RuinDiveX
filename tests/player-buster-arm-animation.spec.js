import { expect, test } from '@playwright/test';

async function openLoadedGame(page) {
  await page.goto('/');
  await expect
    .poll(
      async () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20_000 },
    )
    .toBe('true');
  await page.waitForFunction(() => (
    window.game?.player?._fbxAnimationLibraryLoaded === true
    && window.game.player._busterArmLoaded === true
    && Boolean(window.game.player.externalRig?.megaBusterMuzzle)
    && Boolean(window.game.player.externalRig?.megaBusterArmGroup)
  ));
}

test('Mega Buster stays on the left while slot 2 and 3 weapons use the right arm', async ({ page }) => {
  await openLoadedGame(page);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const { player } = game;
    const rig = player.externalRig;
    const Vector3 = player.root.position.constructor;

    const isRendered = (object) => {
      if (!object) return false;
      for (let current = object; current; current = current.parent) {
        if (current.visible === false) return false;
      }
      return true;
    };
    const mountedSide = (group) => {
      if (!group) return null;
      for (let current = group.parent; current; current = current.parent) {
        for (const [jointName, joint] of rig.joints) {
          if (joint !== current) continue;
          if (jointName.startsWith('left')) return 'left';
          if (jointName.startsWith('right')) return 'right';
        }
      }
      return null;
    };
    const distanceToWrists = (position) => {
      const left = rig.joints.get('leftWrist').getWorldPosition(new Vector3());
      const right = rig.joints.get('rightWrist').getWorldPosition(new Vector3());
      return {
        left: position.distanceTo(left),
        right: position.distanceTo(right),
      };
    };
    const select = (slotIndex) => {
      player.switchArmWeapon(slotIndex, true);
      player.updateWeaponVisualState();
      player.modelRoot.updateMatrixWorld(true);
      const origin = player.getProjectileOrigin();
      return {
        type: player.getActiveArmWeapon()?.type ?? null,
        firingSide: rig.busterArmSide ?? null,
        megaVisible: isRendered(rig.megaBusterArmGroup),
        subweaponVisible: isRendered(rig.busterArmGroup),
        originDistances: distanceToWrists(origin),
      };
    };

    const megaMountSide = mountedSide(rig.megaBusterArmGroup);
    const subweaponMountSide = mountedSide(rig.busterArmGroup);
    const slot0 = select(0);
    const slot1 = select(1);
    const slot2 = select(2);
    const restored = select(0);

    return {
      megaMountSide,
      subweaponMountSide,
      slot0,
      slot1,
      slot2,
      restored,
    };
  });

  expect(result.megaMountSide).toBe('left');
  expect(result.subweaponMountSide).toBe('right');

  expect(result.slot0.type).toBe('busterArm');
  expect(result.slot0.firingSide).toBe('left');
  expect(result.slot0.megaVisible).toBe(true);
  expect(result.slot0.subweaponVisible).toBe(false);
  expect(result.slot0.originDistances.left).toBeLessThan(result.slot0.originDistances.right);

  expect(result.slot1.type).toBe('swordArm');
  expect(result.slot1.megaVisible).toBe(true);
  expect(result.slot1.subweaponVisible).toBe(true);
  expect(result.slot1.firingSide).toBe('right');

  expect(result.slot2.type).not.toBe('busterArm');
  expect(result.slot2.megaVisible).toBe(true);
  expect(result.slot2.subweaponVisible).toBe(true);
  expect(result.slot2.firingSide).toBe('right');
  expect(result.slot2.originDistances.right).toBeLessThan(result.slot2.originDistances.left);

  expect(result.restored.firingSide).toBe('left');
  expect(result.restored.megaVisible).toBe(true);
  expect(result.restored.subweaponVisible).toBe(false);
  expect(result.restored.originDistances.left).toBeLessThan(result.restored.originDistances.right);
});

test('airborne Mega Buster aim owns the left arm and preserves right-arm jump motion', async ({ page }) => {
  await openLoadedGame(page);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const { player } = game;
    const rig = player.externalRig;
    const Vector3 = player.root.position.constructor;
    const forward = new Vector3(0, 0, 1);
    const right = new Vector3(1, 0, 0);
    const spawn = game.dungeon.playerStart.clone();
    const movementOptions = {
      arenaRadius: game.arenaRadius,
      movementForward: forward,
      movementRight: right,
      groundY: spawn.y,
    };

    player.ledgeCling = null;
    player.root.position.copy(spawn);
    player.modelRoot.position.y = 0;
    player.velocity.set(0, 0, 4.35);
    player.jumpState = 'Grounded';
    player._jumpGroundY = spawn.y;
    player._jumpBufferTimer = 0;
    player._coyoteTimer = player.jumpSettings.coyoteTime;
    player._landingRecoveryTimer = 0;
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.actionDuration = 0;
    player.animation.cancelAttack();
    player.bracedFireTimer = 0;
    player.bracedBackpedalTimer = 0;
    player._attackWeaponKind = null;
    player.movementLockTimer = 0;
    player.movementLockMultiplier = 1;
    player.lastMoveDirection.copy(forward);
    player.faceDirection(forward);
    player.switchArmWeapon(0, true);
    player.updateWeaponVisualState();

    player.tryJump(new Set(['KeyW']), movementOptions);
    const aimPoint = player.root.position.clone().addScaledVector(forward, 8);
    player.playProjectileShotAnimation(0.5, aimPoint, 0.8, {
      weaponKey: player.getActiveArmWeapon()?.id,
    });

    const leftShoulder = rig.joints.get('leftShoulder');
    const rightShoulder = rig.joints.get('rightShoulder');
    const aimShoulder = rig.busterAirAimPose.get('leftShoulder');
    let maximumLeftAimError = 0;
    let rightShoulderTravel = 0;
    let previousRight = rightShoulder.quaternion.clone();
    let aimFrames = 0;
    let launchClipSeen = false;
    let fallClipSeen = false;

    for (let frame = 0; frame < 100 && player.isJumpAirborne(); frame += 1) {
      player.update(1 / 120, new Set(['KeyW']), movementOptions);
      launchClipSeen ||= rig.activeClipKey === 'forwardJumpLaunch';
      fallClipSeen ||= rig.activeClipKey === 'forwardJumpFall';
      if (aimShoulder && rig.root.userData.airborneBusterAimActive) {
        aimFrames += 1;
        maximumLeftAimError = Math.max(
          maximumLeftAimError,
          leftShoulder.quaternion.angleTo(aimShoulder),
        );
      }
      rightShoulderTravel += previousRight.angleTo(rightShoulder.quaternion);
      previousRight = rightShoulder.quaternion.clone();
    }

    return {
      aimJointNames: [...rig.busterAirAimPose.keys()],
      firingSide: rig.busterArmSide,
      maximumLeftAimError,
      rightShoulderTravel,
      aimFrames,
      launchClipSeen,
      fallClipSeen,
    };
  });

  expect(result.aimJointNames).toEqual(['leftShoulder', 'leftElbow', 'leftWrist']);
  expect(result.firingSide).toBe('left');
  expect(result.launchClipSeen).toBe(true);
  expect(result.fallClipSeen).toBe(true);
  expect(result.aimFrames).toBeGreaterThan(0);
  expect(result.maximumLeftAimError).toBeLessThan(0.001);
  expect(result.rightShoulderTravel).toBeGreaterThan(0.05);
});

test('moving Mega Buster fire layers over normal locomotion while alternate fire keeps right-arm clips', async ({ page }) => {
  await openLoadedGame(page);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const { player } = game;
    const rig = player.externalRig;
    const Vector3 = player.root.position.constructor;
    const Quaternion = player.root.quaternion.constructor;

    const sampleMovingAim = (slotIndex, running = false) => {
      player.switchArmWeapon(slotIndex, true);
      player.updateWeaponVisualState();
      const leftShoulder = rig.joints.get('leftShoulder');
      const leftShoulderRestPosition = leftShoulder.userData.restLocalPosition;
      const rightShoulder = rig.joints.get('rightShoulder');
      let previousRight = rightShoulder.quaternion.clone();
      let initialMuzzlePosition = null;
      let previousMuzzlePosition = null;
      let previousMuzzleQuaternion = null;
      let rightShoulderTravel = 0;
      let muzzlePositionTravel = 0;
      let maximumMuzzlePositionStep = 0;
      let maximumMuzzlePositionOffset = 0;
      let muzzleRotationTravel = 0;
      let maximumLeftShoulderLocalDrift = 0;
      const clipKeys = new Set();
      let leftAimFrames = 0;
      let armAnchorFrames = 0;

      for (let frame = 0; frame < 120; frame += 1) {
        player.previewExternalAnimation(1 / 60, {
          moving: true,
          running,
          moveAmount: running ? 1.35 : 1,
          projectileAiming: true,
          lockOnActive: true,
        });
        clipKeys.add(rig.activeClipKey);
        leftAimFrames += rig.root.userData.leftMegaBusterAimActive ? 1 : 0;
        armAnchorFrames += rig.root.userData.megaBusterArmWorldAnchorActive ? 1 : 0;
        rightShoulderTravel += previousRight.angleTo(rightShoulder.quaternion);
        rig.root.updateMatrixWorld(true);
        const muzzle = rig.busterArmSide === 'left' ? rig.megaBusterMuzzle : rig.busterMuzzle;
        const muzzlePosition = muzzle.getWorldPosition(new Vector3());
        rig.root.worldToLocal(muzzlePosition);
        const rootInverse = rig.root.getWorldQuaternion(new Quaternion()).invert();
        const muzzleQuaternion = rootInverse.multiply(muzzle.getWorldQuaternion(new Quaternion())).normalize();
        initialMuzzlePosition ??= muzzlePosition.clone();
        maximumMuzzlePositionOffset = Math.max(
          maximumMuzzlePositionOffset,
          initialMuzzlePosition.distanceTo(muzzlePosition),
        );
        maximumLeftShoulderLocalDrift = Math.max(
          maximumLeftShoulderLocalDrift,
          leftShoulder.position.distanceTo(leftShoulderRestPosition),
        );
        if (previousMuzzlePosition) {
          const muzzlePositionStep = previousMuzzlePosition.distanceTo(muzzlePosition);
          muzzlePositionTravel += muzzlePositionStep;
          maximumMuzzlePositionStep = Math.max(maximumMuzzlePositionStep, muzzlePositionStep);
          muzzleRotationTravel += previousMuzzleQuaternion.angleTo(muzzleQuaternion);
        }
        previousRight = rightShoulder.quaternion.clone();
        previousMuzzlePosition = muzzlePosition;
        previousMuzzleQuaternion = muzzleQuaternion;
      }

      return {
        firingSide: rig.busterArmSide,
        clipKeys: [...clipKeys],
        leftAimFrames,
        armAnchorFrames,
        rightShoulderTravel,
        muzzlePositionTravel,
        maximumMuzzlePositionStep,
        maximumMuzzlePositionOffset,
        muzzleRotationTravel,
        maximumLeftShoulderLocalDrift,
      };
    };

    return {
      megaWalk: sampleMovingAim(0, false),
      megaRun: sampleMovingAim(0, true),
      alternate: sampleMovingAim(2, false),
    };
  });

  for (const sample of [result.megaWalk, result.megaRun]) {
    expect(sample.firingSide).toBe('left');
    expect(sample.leftAimFrames).toBeGreaterThan(0);
    expect(sample.armAnchorFrames).toBeGreaterThan(0);
    expect(sample.rightShoulderTravel).toBeGreaterThan(0.1);
    // The shoulder remains attached and follows the torso's small positional
    // bob, while the cannon's forward orientation stays locked.
    expect(sample.maximumLeftShoulderLocalDrift).toBeLessThan(0.00001);
    expect(sample.maximumMuzzlePositionStep).toBeLessThan(0.03);
    expect(sample.maximumMuzzlePositionOffset).toBeLessThan(0.12);
    expect(sample.muzzlePositionTravel).toBeLessThan(1.6);
    expect(sample.muzzleRotationTravel).toBeLessThan(0.002);
    expect(sample.clipKeys.some((key) => key?.startsWith('pistol'))).toBe(false);
  }

  expect(result.alternate.firingSide).toBe('right');
  expect(result.alternate.leftAimFrames).toBe(0);
  expect(result.alternate.clipKeys.some((key) => key?.startsWith('pistol'))).toBe(true);
});

test('Mega Buster aims at the lock target or the manual reticle without releasing movement lock', async ({ page }) => {
  await openLoadedGame(page);

  const result = await page.evaluate(async () => {
    const { Vector3, Quaternion } = await import('three');
    const { getCombatTargetWorldPosition } = await import('./src/reaverbots/CombatTarget.js');
    const { game } = window;
    game.stop();
    const { player, combat } = game;
    const rig = player.externalRig;
    const forward = new Vector3(0, 0, 1);
    const right = new Vector3(1, 0, 0);

    for (const existing of [...game.enemies]) {
      existing.dispose?.();
      existing.root.removeFromParent();
    }
    game.enemies.length = 0;

    player.ledgeCling = null;
    player.root.position.set(0, 0, 0);
    player.modelRoot.position.y = 0;
    player.velocity.set(0, 0, 0);
    player.jumpState = 'Grounded';
    player._jumpGroundY = 0;
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.actionDuration = 0;
    player.animation.cancelAttack();
    player.bracedFireTimer = 0;
    player.bracedBackpedalTimer = 0;
    player.bracedFireTargetValid = false;
    player._attackWeaponKind = null;
    player.lastMoveDirection.copy(forward);
    player.faceDirection(forward);
    player.switchArmWeapon(0, true);
    player.updateWeaponVisualState();

    game.camera.position.set(0, 3.1, -7);
    game.camera.lookAt(0, 1.2, 5);
    game.camera.updateMatrixWorld(true);
    const enemy = game.spawner.spawnEnemy('basic', false, new Vector3(0.7, 0, 5), {
      allowRandomElite: false,
    });
    const lockPoint = getCombatTargetWorldPosition(enemy, new Vector3());
    combat.lockOn.target = enemy;
    combat.lockOn.progress = 1;
    combat.lockOn.movementLocked = true;
    combat.lockOn.manual = true;
    combat.swapTimer = 0;

    const weaponState = combat.getCurrentWeaponState();
    weaponState.cooldown = 0;
    weaponState.reloadTimer = 0;
    weaponState.energy = weaponState.maxEnergy;
    weaponState.weaponOutput = weaponState.maxWeaponOutput;
    game.pointer.primary = false;
    game.pointer.primaryPressed = false;
    game.pointer.secondary = false;
    game.pointer.secondaryPressed = false;
    game.pointer.lockOnPressed = false;
    combat.primaryWasDown = false;

    const movementOptions = () => ({
      arenaRadius: game.arenaRadius,
      movementForward: forward,
      movementRight: right,
      lockOnTarget: enemy,
      lockOnTargetPosition: lockPoint,
      aimWorld: game.pointer.aimWorld,
      projectileAimInputHeld: Boolean(game.pointer.secondary),
      groundY: 0,
    });
    const settleAimPose = () => {
      for (let frame = 0; frame < 6; frame += 1) {
        player.update(1 / 120, new Set(), movementOptions());
      }
    };
    const sampleMuzzle = (targetWorld) => {
      rig.root.updateMatrixWorld(true);
      const muzzlePosition = rig.megaBusterMuzzle.getWorldPosition(new Vector3());
      const muzzleForward = new Vector3(0, 0, 1)
        .applyQuaternion(rig.megaBusterMuzzle.getWorldQuaternion(new Quaternion()))
        .normalize();
      const expectedDirection = targetWorld.clone().sub(muzzlePosition).normalize();
      return {
        alignment: muzzleForward.dot(expectedDirection),
        direction: muzzleForward,
        expectedDirection,
      };
    };

    combat.update(1 / 60);
    settleAimPose();
    const lockedAim = sampleMuzzle(lockPoint);

    const cameraRight = new Vector3(1, 0, 0).applyQuaternion(game.camera.quaternion).normalize();
    const cameraUp = new Vector3(0, 1, 0).applyQuaternion(game.camera.quaternion).normalize();
    const desiredManualPoint = lockPoint.clone()
      .addScaledVector(cameraRight, 1.8)
      .addScaledVector(cameraUp, 1.15);
    const projectedManualPoint = desiredManualPoint.clone().project(game.camera);
    const canvasRect = game.renderer.domElement.getBoundingClientRect();
    game.pointer.x = canvasRect.left + (projectedManualPoint.x + 1) * canvasRect.width * 0.5;
    game.pointer.y = canvasRect.top + (1 - projectedManualPoint.y) * canvasRect.height * 0.5;
    game.pointer.secondary = true;
    game.pointer.secondaryPressed = true;
    game._updateAimFromPointer();
    const manualAimPoint = game.pointer.aimWorld.clone();
    const projectedResolvedManualAim = manualAimPoint.clone().project(game.camera);
    const manualReticleProjectionError = Math.hypot(
      projectedResolvedManualAim.x - projectedManualPoint.x,
      projectedResolvedManualAim.y - projectedManualPoint.y,
    );

    combat.update(1 / 60);
    settleAimPose();
    const manualAim = sampleMuzzle(manualAimPoint);

    return {
      firingSide: rig.busterArmSide,
      targetAimActive: rig.root.userData.megaBusterTargetAimActive,
      lockedAlignment: lockedAim.alignment,
      manualAlignment: manualAim.alignment,
      aimDirectionSeparation: lockedAim.direction.angleTo(manualAim.direction),
      manualReticleProjectionError,
      manualOverrideActive: combat.isManualAimOverrideActive(game.pointer),
      movementLockPreserved: combat.getMovementLockTarget() === enemy,
      visualTargetDistanceToManualAim: player.bracedFireTargetWorld.distanceTo(manualAimPoint),
      facingTargetDistanceToLock: player.bracedFireDirection
        .angleTo(lockPoint.clone().sub(player.root.position).setY(0).normalize()),
    };
  });

  expect(result.firingSide).toBe('left');
  expect(result.targetAimActive).toBe(true);
  expect(result.lockedAlignment).toBeGreaterThan(0.999);
  expect(result.manualAlignment).toBeGreaterThan(0.999);
  expect(result.aimDirectionSeparation).toBeGreaterThan(0.15);
  expect(result.manualReticleProjectionError).toBeLessThan(0.0001);
  expect(result.manualOverrideActive).toBe(true);
  expect(result.movementLockPreserved).toBe(true);
  expect(result.visualTargetDistanceToManualAim).toBeLessThan(0.001);
  expect(result.facingTargetDistanceToLock).toBeLessThan(0.001);
});

test('stationary Mega Buster aim locks the supplied Action Idle pose without a walk cycle', async ({ page }) => {
  await openLoadedGame(page);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const { player } = game;
    const rig = player.externalRig;
    const Vector3 = player.root.position.constructor;
    const Quaternion = player.root.quaternion.constructor;
    const clipKeys = new Set();
    const actionIdlePose = {
      hips: { pitch: -6.2, yaw: -43, roll: -4 },
      spine: { pitch: 11.8, yaw: 9.1, roll: -2.7 },
      neck: { pitch: -4.2, yaw: -1.3, roll: 0.2 },
      leftShoulder: { pitch: 59, yaw: -22.5, roll: 102.5 },
      leftElbow: { pitch: 2.2, yaw: 2.6, roll: 1.5 },
      leftWrist: { pitch: -17.1, yaw: 14.9, roll: -1 },
      rightShoulder: { pitch: 50.6, yaw: 19.7, roll: 17.8 },
      rightElbow: { pitch: 11.2, yaw: 4, roll: -40 },
      rightWrist: { pitch: 15.5, yaw: -6.8, roll: -4.2 },
      leftHip: { pitch: 27.4, yaw: -8.8, roll: 4.1 },
      leftKnee: { pitch: -34.7, yaw: 15.7, roll: 1.1 },
      leftAnkle: { pitch: 3.8, yaw: 1.2, roll: 3 },
      rightHip: { pitch: 6.3, yaw: 14, roll: -4.9 },
      rightKnee: { pitch: -34, yaw: 7.7, roll: -0.4 },
      rightAnkle: { pitch: 19, yaw: 4.4, roll: -0.6 },
    };
    let previousLeftShoulder = null;
    let leftShoulderTravel = 0;
    let anchoredLeftFoot = null;
    let anchoredRightFoot = null;
    let anchoredMuzzlePosition = null;
    let anchoredMuzzleQuaternion = null;
    let maximumLeftFootDrift = 0;
    let maximumRightFootDrift = 0;
    let maximumMuzzlePositionDrift = 0;
    let maximumMuzzleRotationDrift = 0;

    player.switchArmWeapon(0, true);
    player.updateWeaponVisualState();
    for (let frame = 0; frame < 90; frame += 1) {
      player.previewExternalAnimation(1 / 60, {
        moving: false,
        running: false,
        moveAmount: 0,
        projectileAiming: true,
        lockOnActive: true,
      });
      clipKeys.add(rig.activeClipKey);
      const leftShoulder = rig.joints.get('leftShoulder');
      if (previousLeftShoulder) {
        leftShoulderTravel += previousLeftShoulder.angleTo(leftShoulder.quaternion);
      }
      previousLeftShoulder = leftShoulder.quaternion.clone();

      rig.root.updateMatrixWorld(true);
      const leftFoot = rig.joints.get('leftAnkle').getWorldPosition(new Vector3());
      const rightFoot = rig.joints.get('rightAnkle').getWorldPosition(new Vector3());
      const muzzlePosition = rig.megaBusterMuzzle.getWorldPosition(new Vector3());
      rig.root.worldToLocal(muzzlePosition);
      const rootInverse = rig.root.getWorldQuaternion(new Quaternion()).invert();
      const muzzleQuaternion = rootInverse
        .multiply(rig.megaBusterMuzzle.getWorldQuaternion(new Quaternion()))
        .normalize();
      anchoredLeftFoot ??= leftFoot.clone();
      anchoredRightFoot ??= rightFoot.clone();
      anchoredMuzzlePosition ??= muzzlePosition.clone();
      anchoredMuzzleQuaternion ??= muzzleQuaternion.clone();
      maximumLeftFootDrift = Math.max(maximumLeftFootDrift, anchoredLeftFoot.distanceTo(leftFoot));
      maximumRightFootDrift = Math.max(maximumRightFootDrift, anchoredRightFoot.distanceTo(rightFoot));
      maximumMuzzlePositionDrift = Math.max(
        maximumMuzzlePositionDrift,
        anchoredMuzzlePosition.distanceTo(muzzlePosition),
      );
      maximumMuzzleRotationDrift = Math.max(
        maximumMuzzleRotationDrift,
        anchoredMuzzleQuaternion.angleTo(muzzleQuaternion),
      );
    }

    const poseError = (jointName, pose) => {
      const joint = rig.joints.get(jointName);
      const rest = rig.restLocalQuaternions.get(joint);
      const euler = joint.rotation.clone().set(
        pose.pitch * Math.PI / 180,
        pose.yaw * Math.PI / 180,
        pose.roll * Math.PI / 180,
        joint.rotation.order,
      );
      const delta = joint.quaternion.clone().identity().setFromEuler(euler);
      const expected = rest.clone().multiply(delta);
      return joint.quaternion.angleTo(expected);
    };

    const poseErrors = Object.fromEntries(
      Object.entries(actionIdlePose).map(([jointName, pose]) => [jointName, poseError(jointName, pose)]),
    );

    return {
      clipKeys: [...clipKeys],
      poseErrors,
      leftShoulderTravel,
      firingSide: rig.busterArmSide,
      leftAimActive: rig.root.userData.leftMegaBusterAimActive,
      actionIdleActive: rig.root.userData.megaBusterActionIdleActive,
      maximumLeftFootDrift,
      maximumRightFootDrift,
      maximumMuzzlePositionDrift,
      maximumMuzzleRotationDrift,
      groundingReason: player.getExternalModelGroundingDiagnostics()?.reason ?? null,
    };
  });

  expect(result.firingSide).toBe('left');
  expect(result.leftAimActive).toBe(true);
  expect(result.actionIdleActive).toBe(true);
  expect(result.clipKeys.length).toBeGreaterThan(0);
  expect(result.clipKeys.every((key) => ['breathingIdle', 'sideIdle', 'idle', 'idle2'].includes(key))).toBe(true);
  expect(result.leftShoulderTravel).toBeLessThan(0.001);
  expect(result.maximumLeftFootDrift).toBeLessThan(0.001);
  expect(result.maximumRightFootDrift).toBeLessThan(0.001);
  expect(result.maximumMuzzlePositionDrift).toBeLessThan(0.001);
  expect(result.maximumMuzzleRotationDrift).toBeLessThan(0.001);
  expect(result.groundingReason).toBe('megaBusterActionIdle');
  for (const error of Object.values(result.poseErrors)) {
    expect(error).toBeLessThan(0.001);
  }
});

test('ledge traversal restores the left hand and only Lift Arm may raise the right hand', async ({ page }) => {
  test.setTimeout(60_000);
  await openLoadedGame(page);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const platform = game.debugLedgePlatform;
    const player = game.player;
    const rig = player.externalRig;
    const Vector3 = player.root.position.constructor;
    const frontZ = platform.center.z - platform.halfDepth;
    const movementOptions = {
      arenaRadius: game.arenaRadius,
      movementForward: new Vector3(0, 0, 1),
      movementRight: new Vector3(1, 0, 0),
      groundY: platform.baseY,
    };

    const isRendered = (object) => {
      if (!object) return false;
      for (let current = object; current; current = current.parent) {
        if (current.visible === false) return false;
      }
      return true;
    };
    const namedMeshRendered = (token) => {
      let rendered = false;
      player.modelRoot.traverse((object) => {
        if (object.isMesh && object.name.includes(token) && isRendered(object)) {
          rendered = true;
        }
      });
      return rendered;
    };
    const measure = (label) => {
      player.modelRoot.updateMatrixWorld(true);
      const left = rig.joints.get('leftWrist').getWorldPosition(new Vector3());
      const right = rig.joints.get('rightWrist').getWorldPosition(new Vector3());
      const rightShoulder = rig.joints.get('rightShoulder').getWorldPosition(new Vector3());
      return {
        label,
        state: player.ledgeCling?.state ?? null,
        leftEdgeDistance: Math.hypot(left.y - platform.topY, left.z - frontZ),
        rightEdgeDistance: Math.hypot(right.y - platform.topY, right.z - frontZ),
        rightWristBelowShoulder: rightShoulder.y - right.y,
        leftNormalHandVisible: namedMeshRendered('HandMesh_L'),
        megaBusterVisible: isRendered(rig.megaBusterArmGroup),
        subweaponVisible: isRendered(rig.busterArmGroup),
      };
    };
    const update = (frames, toward = false) => {
      const input = toward ? new Set(['KeyW']) : new Set();
      for (let frame = 0; frame < frames; frame += 1) {
        player.update(1 / 60, input, movementOptions);
        game.dungeonController.update(1 / 60);
      }
    };
    const startCling = (slotIndex) => {
      player.ledgeCling = null;
      player.switchArmWeapon(slotIndex, true);
      player.updateWeaponVisualState();
      player.root.position.set(platform.center.x, platform.baseY, frontZ - 0.42);
      player.lastMoveDirection.set(0, 0, 1);
      player.faceDirection(player.lastMoveDirection);
      game._tryResolveDebugLedgeCling({
        player,
        root: player.root,
        jumpDirection: new Vector3(0, 0, 1),
        progress: 0.5,
        jumpStartY: platform.baseY,
        jumpReachHeight: player.getJumpReachHeight(),
      });
    };
    const sampleTraversal = (slotIndex) => {
      startCling(slotIndex);
      update(150, false);
      const hanging = measure('hanging');
      update(20, true);
      const preparing = measure('preparing');
      for (let frame = 0; frame < 100 && player.ledgeCling?.state === 'preparingToClimb'; frame += 1) {
        update(1, true);
      }
      update(8, true);
      const climbing = measure('climbing');
      return { hanging, preparing, climbing };
    };

    const normal = sampleTraversal(0);
    const lift = sampleTraversal(3);
    player.ledgeCling = null;
    player.switchArmWeapon(0, true);
    player.updateWeaponVisualState();
    player.modelRoot.updateMatrixWorld(true);

    return {
      normal,
      lift,
      restoredMegaBusterVisible: isRendered(rig.megaBusterArmGroup),
      restoredLeftNormalHandVisible: namedMeshRendered('HandMesh_L'),
    };
  });

  for (const sample of Object.values(result.normal)) {
    expect(sample.leftNormalHandVisible, sample.label).toBe(true);
    expect(sample.megaBusterVisible, sample.label).toBe(false);
    expect(sample.subweaponVisible, sample.label).toBe(false);
    expect(sample.leftEdgeDistance, sample.label).toBeLessThan(0.17);
    expect(sample.rightEdgeDistance, sample.label).toBeGreaterThan(0.2);
    expect(sample.rightWristBelowShoulder, sample.label).toBeGreaterThan(0.05);
  }

  for (const sample of Object.values(result.lift)) {
    expect(sample.leftNormalHandVisible, sample.label).toBe(true);
    expect(sample.megaBusterVisible, sample.label).toBe(false);
    expect(sample.subweaponVisible, sample.label).toBe(false);
    expect(sample.leftEdgeDistance, sample.label).toBeLessThan(0.17);
    expect(sample.rightEdgeDistance, sample.label).toBeLessThan(0.2);
  }

  expect(result.restoredMegaBusterVisible).toBe(true);
  expect(result.restoredLeftNormalHandVisible).toBe(false);
});

test('repeated moving Mega Buster aim and dodge transitions preserve arm-bone attachment lengths', async ({ page }) => {
  await openLoadedGame(page);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const { player } = game;
    const rig = player.externalRig;
    const Vector3 = player.root.position.constructor;
    const forward = new Vector3(0, 0, 1);
    const right = new Vector3(1, 0, 0);
    const spawn = game.dungeon.playerStart.clone();
    const movementOptions = {
      arenaRadius: game.arenaRadius,
      movementForward: forward,
      movementRight: right,
      groundY: spawn.y,
    };
    const jointNames = [
      'leftShoulder',
      'leftElbow',
      'leftWrist',
      'rightShoulder',
      'rightElbow',
      'rightWrist',
    ];
    const segmentJointNames = [
      'leftShoulder',
      'leftElbow',
      'leftWrist',
      'rightShoulder',
      'rightElbow',
      'rightWrist',
    ];
    const restPositions = new Map(jointNames.map((jointName) => {
      const joint = rig.joints.get(jointName);
      return [jointName, joint.userData.restLocalPosition.clone()];
    }));
    const restSegmentLengths = new Map(segmentJointNames.map((jointName) => [
      jointName,
      restPositions.get(jointName).length(),
    ]));
    const leftElbow = rig.joints.get('leftElbow');
    const stats = {
      maximumSegmentLengthError: 0,
      maximumNonShoulderLocalDrift: 0,
      maximumShoulderLocalDrift: 0,
      maximumSettledLocalDrift: 0,
      nonFiniteSamples: 0,
      aimAnchorOffsets: [],
      dodgeStarts: 0,
      aimFrames: 0,
      dodgeFrames: 0,
      mountDetachedFrames: 0,
    };

    const sample = (phase, cycle) => {
      for (const jointName of jointNames) {
        const joint = rig.joints.get(jointName);
        const rest = restPositions.get(jointName);
        const drift = joint.position.distanceTo(rest);
        if (!Number.isFinite(drift)) stats.nonFiniteSamples += 1;
        if (jointName.endsWith('Shoulder')) {
          stats.maximumShoulderLocalDrift = Math.max(stats.maximumShoulderLocalDrift, drift);
        } else {
          stats.maximumNonShoulderLocalDrift = Math.max(stats.maximumNonShoulderLocalDrift, drift);
        }
        if (phase === 'settled') {
          stats.maximumSettledLocalDrift = Math.max(stats.maximumSettledLocalDrift, drift);
        }
      }
      for (const jointName of segmentJointNames) {
        const joint = rig.joints.get(jointName);
        stats.maximumSegmentLengthError = Math.max(
          stats.maximumSegmentLengthError,
          Math.abs(joint.position.length() - restSegmentLengths.get(jointName)),
        );
      }
      if (phase === 'aim') {
        stats.aimAnchorOffsets[cycle] = rig.joints.get('leftShoulder').position
          .distanceTo(restPositions.get('leftShoulder'));
      }
      if (rig.megaBusterArmGroup?.parent !== leftElbow) {
        stats.mountDetachedFrames += 1;
      }
    };

    player.ledgeCling = null;
    player.root.position.copy(spawn);
    player.modelRoot.position.y = 0;
    player.velocity.set(0, 0, 0);
    player.jumpState = 'Grounded';
    player._jumpGroundY = spawn.y;
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.actionDuration = 0;
    player.animation.cancelAttack();
    player.bracedFireTimer = 0;
    player.bracedBackpedalTimer = 0;
    player._attackWeaponKind = null;
    player.movementLockTimer = 0;
    player.movementLockMultiplier = 1;
    player.lastMoveDirection.copy(forward);
    player.faceDirection(forward);
    player.switchArmWeapon(0, true);
    player.updateWeaponVisualState();
    player.update(1 / 60, new Set(), movementOptions);
    sample('settled', -1);

    for (let cycle = 0; cycle < 6; cycle += 1) {
      const aimPoint = player.root.position.clone().addScaledVector(forward, 8);
      player.playProjectileShotAnimation(0.5, aimPoint, 0.8, {
        weaponKey: player.getActiveArmWeapon()?.id,
      });
      for (let frame = 0; frame < 10; frame += 1) {
        player.update(1 / 120, new Set(['KeyW']), movementOptions);
        sample('aim', cycle);
        stats.aimFrames += 1;
      }

      const dodgeStarted = player.tryDodgeRoll(new Set(['KeyW']), movementOptions);
      if (dodgeStarted) stats.dodgeStarts += 1;
      for (let frame = 0; frame < 180 && player.animation.actionState === 'dodgeRoll'; frame += 1) {
        player.update(1 / 120, new Set(), movementOptions);
        sample('dodge', cycle);
        stats.dodgeFrames += 1;
      }
      player.update(1 / 60, new Set(), movementOptions);
      sample('settled', cycle);
    }

    const minimumAimAnchorOffset = Math.min(...stats.aimAnchorOffsets);
    const maximumAimAnchorOffset = Math.max(...stats.aimAnchorOffsets);
    return {
      ...stats,
      aimAnchorOffsetSpread: maximumAimAnchorOffset - minimumAimAnchorOffset,
      finalAttackKind: player._attackWeaponKind,
      finalActionState: player.animation.actionState,
      finalFiringSide: rig.busterArmSide,
    };
  });

  expect(result.dodgeStarts).toBe(6);
  expect(result.aimFrames).toBe(60);
  expect(result.dodgeFrames).toBeGreaterThan(300);
  expect(result.nonFiniteSamples).toBe(0);
  expect(result.mountDetachedFrames).toBe(0);
  expect(result.maximumSegmentLengthError).toBeLessThan(0.00001);
  expect(result.maximumNonShoulderLocalDrift).toBeLessThan(0.00001);
  expect(result.maximumShoulderLocalDrift).toBeLessThan(0.00001);
  expect(result.maximumSettledLocalDrift).toBeLessThan(0.00001);
  expect(result.aimAnchorOffsetSpread).toBeLessThan(0.00001);
  expect(result.finalAttackKind).toBeNull();
  expect(result.finalActionState).toBeNull();
  expect(result.finalFiringSide).toBe('left');
});
