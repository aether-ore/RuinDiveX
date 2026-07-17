import { expect, test } from '@playwright/test';

test('free aim uses directional strafing and Sprint keeps stable Buster and sword wrists', async ({ page }) => {
  await page.goto('/?reaverbotSeed=free-aim-strafe-sprint-pose');
  await page.waitForFunction(() => Boolean(
    window.game?.player?._fbxAnimationLibraryLoaded
    && window.game?.player?._busterArmLoaded
    && window.game?.player?.externalRig?.animationActions?.has('sprint'),
  ));

  const result = await page.evaluate(() => {
    const game = window.game;
    const player = game.player;
    const rig = player.externalRig;
    game.stop();
    player.activeArmIndex = 1;
    player.updateWeaponVisualState();

    const movementOptions = {
      arenaRadius: 100,
      movementForward: new player.root.position.constructor(0, 0, 1),
      // Match CameraController/Game lock-on convention: right = forward x up.
      movementRight: new player.root.position.constructor(-1, 0, 0),
      cameraForward: new player.root.position.constructor(0, 0, 1),
      cameraRight: new player.root.position.constructor(-1, 0, 0),
      lockOnTarget: null,
      lockOnTargetPosition: null,
      aimWorld: new player.root.position.constructor(0, 1.2, 12),
      projectileAimInputHeld: true,
      groundY: 0,
      game,
    };
    const runPlayerTankInput = (codes) => {
      player.root.position.set(0, 0, 0);
      player.root.rotation.set(0, 0, 0);
      player.velocity.set(0, 0, 0);
      player.lastMoveDirection.set(0, 0, 1);
      player.bracedFireTimer = 0;
      player.bracedBackpedalTimer = 0;
      player.bracedFireLocksFacing = false;
      player.attackFacingTimer = 0;
      player._attackWeaponKind = null;
      player.animation.actionState = null;
      player.animation.actionTimer = 0;
      player.animation.attackTimer = 0;
      player.walkModeEnabled = false;
      player.update(1 / 60, new Set(codes), {
        ...movementOptions,
        aimWorld: null,
        projectileAimInputHeld: false,
      });
      return {
        clip: rig.activeClipKey,
        speed: player.velocity.length(),
        running: player.isRunning,
        tankTurnActive: player.tankTurnActive,
        tankTurnTranslating: player.tankTurnTranslating,
      };
    };
    const tankSprint = {
      jogForward: runPlayerTankInput(['KeyW']),
      straight: runPlayerTankInput(['KeyW', 'ShiftLeft']),
      arcLeft: runPlayerTankInput(['KeyW', 'KeyA', 'ShiftLeft']),
      arcRight: runPlayerTankInput(['KeyW', 'KeyD', 'ShiftLeft']),
      turnLeft: runPlayerTankInput(['KeyA', 'ShiftLeft']),
      turnRight: runPlayerTankInput(['KeyD', 'ShiftLeft']),
      backward: runPlayerTankInput(['KeyS', 'ShiftLeft']),
      backwardArc: runPlayerTankInput(['KeyS', 'KeyA', 'ShiftLeft']),
    };
    const runPlayerAimInput = (codes, frames = 1, {
      cameraTurnDirection = 0,
      cameraTurnRadiansPerFrame = Math.PI / 600,
      cameraTurnAlternationFrames = 0,
    } = {}) => {
      player.root.position.set(0, 0, 0);
      player.root.rotation.set(0, 0, 0);
      player.velocity.set(0, 0, 0);
      player.lastMoveDirection.set(0, 0, 1);
      player.bracedFireDirection.set(0, 0, 1);
      player.bracedFireTargetWorld.set(0, 1.2, 12);
      player.bracedFireTargetValid = true;
      player.bracedFireTimer = Math.max(1, (frames / 60) + 1);
      player.bracedFireLocksFacing = true;
      player._attackWeaponKind = 'projectile';
      player.animation.actionState = null;
      player.animation.actionTimer = 0;
      player.animation.attackTimer = 0.5;
      player.pistolRunArcCameraBasisValid = false;
      player.pistolRunArcCameraTurnAmount = 0;
      player.pistolRunArcAccumulatedCameraTurn = 0;
      player.pistolRunArcLatchedTurnDirection = 0;
      movementOptions.movementForward.set(0, 0, 1);
      movementOptions.movementRight.set(-1, 0, 0);
      movementOptions.cameraForward.copy(movementOptions.movementForward);
      movementOptions.cameraRight.copy(movementOptions.movementRight);
      const cameraUp = new player.root.position.constructor(0, 1, 0);
      let accumulatedSpeed = 0;
      let arcFrameCount = 0;
      let minimumRootMotionSpeedMultiplier = Number.POSITIVE_INFINITY;
      let maximumRootMotionSpeedMultiplier = 0;
      for (let frame = 0; frame < frames; frame += 1) {
        if (frame > 0) player.root.position.set(0, 0, 0);
        if (cameraTurnDirection !== 0) {
          const frameTurnDirection = cameraTurnAlternationFrames > 0
            && Math.floor(frame / cameraTurnAlternationFrames) % 2 === 1
            ? -cameraTurnDirection
            : cameraTurnDirection;
          movementOptions.cameraForward.applyAxisAngle(
            cameraUp,
            -frameTurnDirection * cameraTurnRadiansPerFrame,
          ).normalize();
          movementOptions.cameraRight.crossVectors(
            movementOptions.cameraForward,
            cameraUp,
          ).normalize();
          movementOptions.movementForward.copy(movementOptions.cameraForward);
          movementOptions.movementRight.copy(movementOptions.cameraRight);
          player.bracedFireDirection.copy(movementOptions.cameraForward);
          player.bracedFireTargetWorld.copy(player.root.position)
            .addScaledVector(movementOptions.cameraForward, 12)
            .setY(1.2);
        }
        player.update(1 / 60, new Set(codes), movementOptions);
        accumulatedSpeed += player.velocity.length();
        if (rig.activeClipKey === 'pistolRunArc' || rig.activeClipKey === 'pistolRunArc2') {
          arcFrameCount += 1;
        }
        const speedMultiplier = rig.root.userData.pistolRunArcRootMotionSpeedMultiplier ?? 1;
        minimumRootMotionSpeedMultiplier = Math.min(minimumRootMotionSpeedMultiplier, speedMultiplier);
        maximumRootMotionSpeedMultiplier = Math.max(maximumRootMotionSpeedMultiplier, speedMultiplier);
      }
      return {
        clip: rig.activeClipKey,
        translated: player.velocity.lengthSq() > 0.0001,
        speed: player.velocity.length(),
        averageSpeed: accumulatedSpeed / frames,
        arcFrameCount,
        velocityX: player.velocity.x,
        velocityZ: player.velocity.z,
        lockOnActive: Boolean(movementOptions.lockOnTarget),
        rootMotionActive: rig.root.userData.pistolRunArcRootMotionActive,
        rootMotionClip: rig.root.userData.pistolRunArcRootMotionClip,
        rootMotionLocalX: rig.root.userData.pistolRunArcRootMotionLocalX,
        rootMotionLocalZ: rig.root.userData.pistolRunArcRootMotionLocalZ,
        rootMotionSpeedMultiplier: rig.root.userData.pistolRunArcRootMotionSpeedMultiplier ?? 1,
        minimumRootMotionSpeedMultiplier,
        maximumRootMotionSpeedMultiplier,
        footSyncActive: rig.root.userData.pistolRunArcFootSyncActive,
        cadenceScale: rig.root.userData.pistolRunArcCadenceScale,
        phaseSyncApplied: rig.root.userData.pistolRunArcPhaseSyncApplied,
        phaseSyncError: rig.root.userData.pistolRunArcPhaseSyncError,
        transitionFadeSeconds: rig.root.userData.lastFbxAnimationFadeSeconds,
        transitionFootLockActive: rig.root.userData.pistolRunArcFootLockActive,
        transitionFootLockJoint: rig.root.userData.pistolRunArcFootLockJoint,
        transitionFootLockOffset: rig.root.userData.pistolRunArcFootLockOffset,
        cameraTurnAmount: rig.root.userData.pistolRunArcCameraTurnAmount ?? 0,
        cameraTurnAligned: rig.root.userData.pistolRunArcCameraTurnAligned,
        cameraTurnDegrees: rig.root.userData.pistolRunArcCameraTurnDegrees ?? 0,
        cameraTurnEntryDegrees: rig.root.userData.pistolRunArcCameraTurnEntryDegrees ?? 0,
        cameraTurnLatched: rig.root.userData.pistolRunArcCameraTurnLatched,
      };
    };
    const playerIntegrated = {
      pureLeft: runPlayerAimInput(['KeyA']),
      forwardLeft: runPlayerAimInput(['KeyW', 'KeyA']),
      backwardRight: runPlayerAimInput(['KeyS', 'KeyD']),
    };
    const aimedSprintArcs = {
      straight: runPlayerAimInput(['KeyW', 'ShiftLeft'], 120),
      left: runPlayerAimInput(['KeyW', 'KeyA', 'ShiftLeft'], 120),
      right: runPlayerAimInput(['KeyW', 'KeyD', 'ShiftLeft'], 120),
    };
    const subthresholdCameraTurn = runPlayerAimInput(
      ['KeyW', 'KeyD', 'ShiftLeft'],
      30,
      { cameraTurnDirection: 1 },
    );
    const oscillatingCameraTurn = runPlayerAimInput(
      ['KeyW', 'KeyD', 'ShiftLeft'],
      120,
      { cameraTurnDirection: 1, cameraTurnAlternationFrames: 10 },
    );
    const turningSprintArcs = {
      left: runPlayerAimInput(
        ['KeyW', 'KeyA', 'ShiftLeft'],
        120,
        { cameraTurnDirection: -1 },
      ),
      right: runPlayerAimInput(
        ['KeyW', 'KeyD', 'ShiftLeft'],
        120,
        { cameraTurnDirection: 1 },
      ),
    };
    const leftFootBeforeReverse = rig.joints.get('leftAnkle')
      ?.getWorldPosition(new player.root.position.constructor());
    const rightFootBeforeReverse = rig.joints.get('rightAnkle')
      ?.getWorldPosition(new player.root.position.constructor());
    const reverseArcSwap = runPlayerAimInput(['KeyW', 'KeyA', 'ShiftLeft']);
    const lockedFootBeforeReverse = reverseArcSwap.transitionFootLockJoint === 'leftAnkle'
      ? leftFootBeforeReverse
      : rightFootBeforeReverse;
    const lockedFootAfterReverse = rig.joints.get(reverseArcSwap.transitionFootLockJoint)
      ?.getWorldPosition(new player.root.position.constructor());
    const reverseArcLockedFootDisplacement = lockedFootBeforeReverse && lockedFootAfterReverse
      ? Math.hypot(
        lockedFootAfterReverse.x - lockedFootBeforeReverse.x,
        lockedFootAfterReverse.z - lockedFootBeforeReverse.z,
      )
      : Number.POSITIVE_INFINITY;
    const reverseArcSwapSettled = runPlayerAimInput(
      ['KeyW', 'KeyA', 'ShiftLeft'],
      60,
      { cameraTurnDirection: -1 },
    );
    const getRootRotationLoopError = (key) => {
      const track = rig.animationClips.get(key)?.tracks.find((candidate) => (
        candidate.name.endsWith('.quaternion') && rig._isRootMotionTrack(candidate.name)
      ));
      if (!track?.values?.length) return Number.POSITIVE_INFINITY;
      const Quaternion = player.root.quaternion.constructor;
      const first = new Quaternion().fromArray(track.values, 0).normalize();
      const last = new Quaternion().fromArray(track.values, track.values.length - 4).normalize();
      return first.angleTo(last);
    };
    const pistolRunArcLoopErrors = {
      arc: getRootRotationLoopError('pistolRunArc'),
      arc2: getRootRotationLoopError('pistolRunArc2'),
    };

    const base = {
      moving: true,
      moveAmount: 1.55,
      state: 'attacking',
      projectileAiming: true,
      running: true,
      attackKind: 'projectile',
      lockOnActive: false,
      busterArmSide: 'right',
    };
    const select = (options) => {
      // Let a deliberate left/right arc reversal complete its brief neutral
      // transfer before asserting the destination clip mapping.
      for (let frame = 0; frame < 7; frame += 1) {
        rig.update(1 / 60, { ...base, ...options });
      }
      return rig.activeClipKey;
    };

    const pureLeft = select({ strafeAmount: -1, forwardAmount: 0, backpedaling: false });
    const pureRight = select({ strafeAmount: 1, forwardAmount: 0, backpedaling: false });
    const diagonalLeft = select({ strafeAmount: -1, forwardAmount: 1, backpedaling: false });
    const diagonalRight = select({ strafeAmount: 1, forwardAmount: 1, backpedaling: false });
    const backwardDiagonal = select({ strafeAmount: -1, forwardAmount: -1, backpedaling: true });

    rig.update(1 / 60, {
      ...base,
      strafeAmount: 0,
      forwardAmount: 1,
      clipKey: 'sprint',
    });
    const hipsY = rig.joints.get('hips')?.getWorldPosition(new player.root.position.constructor()).y;
    const wristY = rig.joints.get('rightWrist')?.getWorldPosition(new player.root.position.constructor()).y;
    const muzzlePosition = rig.busterMuzzle?.getWorldPosition(new player.root.position.constructor());
    const muzzleQuaternion = rig.busterMuzzle?.getWorldQuaternion(new player.root.quaternion.constructor());
    const muzzleForward = muzzleQuaternion
      ? new player.root.position.constructor(0, 0, 1).applyQuaternion(muzzleQuaternion).normalize()
      : null;
    const bodyForward = new player.root.position.constructor(
      Math.sin(player.root.rotation.y),
      0,
      Math.cos(player.root.rotation.y),
    ).normalize();
    const rightWrist = rig.joints.get('rightWrist');
    const expectedWrist = rig.restLocalQuaternions.get(rightWrist).clone();
    const aimedSprint = {
      clip: rig.activeClipKey,
      poseActive: rig.root.userData.sprintPistolRunAimPoseActive,
      correctionActive: rig.root.userData.pistolBusterPoseCorrectionActive,
      poseJointCount: rig.root.userData.sprintPistolRunAimPoseJointCount,
      wristAnchorReady: rig.root.userData.sprintPistolRunWristAnchorReady,
      wristAnchorError: rig.root.userData.sprintPistolRunWristAnchorError,
      firingWristAboveHips: Number.isFinite(hipsY) && Number.isFinite(wristY) && wristY > hipsY,
      muzzleAboveHip: Number.isFinite(hipsY)
        && Number.isFinite(muzzlePosition?.y)
        && muzzlePosition.y > hipsY,
      muzzleFacesForward: Boolean(muzzleForward) && muzzleForward.dot(bodyForward) > 0.5,
      wristOverrideActive: rig.root.userData.sprintBusterRightWristOverrideActive,
      wristOverrideError: rightWrist.quaternion.angleTo(expectedWrist),
    };

    const unaimedSprintInput = {
      ...base,
      projectileAiming: false,
      attackKind: 'melee',
      strafeAmount: 0,
      forwardAmount: 1,
      clipKey: 'sprint',
    };
    let maximumUnaimedWristError = 0;
    let maximumUnaimedLocalAxis = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      rig.update(1 / 60, unaimedSprintInput);
      maximumUnaimedWristError = Math.max(
        maximumUnaimedWristError,
        rightWrist.quaternion.angleTo(expectedWrist),
      );
      const localRotation = rig.getCurrentDebugPoseDegrees(['rightWrist']).rightWrist;
      maximumUnaimedLocalAxis = Math.max(
        maximumUnaimedLocalAxis,
        Math.abs(localRotation.pitch),
        Math.abs(localRotation.yaw),
        Math.abs(localRotation.roll),
      );
    }
    const unaimedSprint = {
      poseActive: rig.root.userData.sprintPistolRunAimPoseActive,
      wristOverrideActive: rig.root.userData.sprintRightWristOverrideActive,
      busterWristOverrideActive: rig.root.userData.sprintBusterRightWristOverrideActive,
      maximumWristError: maximumUnaimedWristError,
      maximumLocalAxis: maximumUnaimedLocalAxis,
    };

    rig.update(1 / 60, {
      ...base,
      strafeAmount: 0,
      forwardAmount: 1,
      busterArmSide: 'left',
      clipKey: 'sprint',
    });
    const megaBusterSprint = {
      leftAimActive: rig.root.userData.leftMegaBusterAimActive,
      pistolRunPoseActive: rig.root.userData.sprintPistolRunAimPoseActive,
      wristOverrideActive: rig.root.userData.sprintRightWristOverrideActive,
      wristOverrideError: rightWrist.quaternion.angleTo(expectedWrist),
    };

    rig.setBeamBladeActive(true, 0xa8ff8a);
    rig.update(1 / 60, {
      ...base,
      state: 'running',
      projectileAiming: false,
      attackKind: 'beamBlade',
      strafeAmount: 0,
      forwardAmount: 1,
      busterArmSide: 'right',
      clipKey: 'sprint',
    });
    const swordSprint = {
      clip: rig.activeClipKey,
      pistolRunPoseActive: rig.root.userData.sprintPistolRunAimPoseActive,
      wristOverrideActive: rig.root.userData.sprintRightWristOverrideActive,
      swordWristOverrideActive: rig.root.userData.sprintSwordRightWristOverrideActive,
      wristOverrideError: rightWrist.quaternion.angleTo(expectedWrist),
    };
    rig.setBeamBladeActive(false);

    return {
      pureLeft,
      pureRight,
      diagonalLeft,
      diagonalRight,
      backwardDiagonal,
      tankSprint,
      playerIntegrated,
      aimedSprintArcs,
      subthresholdCameraTurn,
      oscillatingCameraTurn,
      turningSprintArcs,
      reverseArcSwap,
      reverseArcLockedFootDisplacement,
      reverseArcSwapSettled,
      pistolRunArcLoopErrors,
      aimedSprint,
      unaimedSprint,
      megaBusterSprint,
      swordSprint,
    };
  });

  expect(result).toMatchObject({
    pureLeft: 'pistolStrafe',
    pureRight: 'pistolStrafe2',
    diagonalLeft: 'pistolRun',
    diagonalRight: 'pistolRun',
    backwardDiagonal: 'pistolRunBackwardArc',
    tankSprint: {
      jogForward: { clip: 'running', running: false },
      straight: { clip: 'sprint', running: true },
      arcLeft: {
        clip: 'sprint',
        running: true,
        tankTurnActive: true,
        tankTurnTranslating: true,
      },
      arcRight: {
        clip: 'sprint',
        running: true,
        tankTurnActive: true,
        tankTurnTranslating: true,
      },
      turnLeft: {
        clip: 'leftTurn',
        running: false,
        tankTurnActive: true,
        tankTurnTranslating: false,
      },
      turnRight: {
        clip: 'rightTurn',
        running: false,
        tankTurnActive: true,
        tankTurnTranslating: false,
      },
      backward: { clip: 'slowJogBackwards', running: false },
      backwardArc: {
        clip: 'slowJogBackwards',
        running: false,
        tankTurnActive: true,
        tankTurnTranslating: true,
      },
    },
    playerIntegrated: {
      pureLeft: { clip: 'pistolStrafe', translated: true, lockOnActive: false },
      forwardLeft: { clip: 'pistolRun', translated: true, lockOnActive: false },
      backwardRight: { clip: 'pistolRunBackwardArc2', translated: true, lockOnActive: false },
    },
    aimedSprintArcs: {
      straight: { clip: 'sprint', rootMotionActive: false },
      left: {
        clip: 'sprint',
        rootMotionActive: false,
        cameraTurnAligned: false,
      },
      right: {
        clip: 'sprint',
        rootMotionActive: false,
        cameraTurnAligned: false,
      },
    },
    subthresholdCameraTurn: {
      clip: 'sprint',
      rootMotionActive: false,
      cameraTurnAligned: false,
      cameraTurnLatched: false,
      arcFrameCount: 0,
    },
    oscillatingCameraTurn: {
      clip: 'sprint',
      rootMotionActive: false,
      cameraTurnAligned: false,
      cameraTurnLatched: false,
      arcFrameCount: 0,
    },
    turningSprintArcs: {
      left: {
        clip: 'pistolRunArc2',
        rootMotionActive: true,
        rootMotionClip: 'pistolRunArc2',
        footSyncActive: true,
        cameraTurnAligned: true,
      },
      right: {
        clip: 'pistolRunArc',
        rootMotionActive: true,
        rootMotionClip: 'pistolRunArc',
        footSyncActive: true,
        cameraTurnAligned: true,
        phaseSyncApplied: true,
      },
    },
    reverseArcSwap: {
      clip: 'sprint',
      phaseSyncApplied: true,
      transitionFootLockActive: true,
    },
    reverseArcSwapSettled: {
      clip: 'pistolRunArc2',
      rootMotionActive: true,
      phaseSyncApplied: true,
    },
    aimedSprint: {
      clip: 'sprint',
      poseActive: true,
      correctionActive: true,
      poseJointCount: 4,
      wristAnchorReady: true,
      firingWristAboveHips: true,
      muzzleAboveHip: true,
      muzzleFacesForward: true,
      wristOverrideActive: true,
    },
    unaimedSprint: {
      poseActive: false,
      wristOverrideActive: true,
      busterWristOverrideActive: false,
    },
    megaBusterSprint: {
      leftAimActive: true,
      pistolRunPoseActive: false,
      wristOverrideActive: true,
    },
    swordSprint: {
      clip: 'sprint',
      pistolRunPoseActive: false,
      wristOverrideActive: true,
      swordWristOverrideActive: true,
    },
  });
  expect(result.aimedSprint.wristAnchorError).toBeLessThan(0.061);
  expect(result.aimedSprint.wristOverrideError).toBeLessThan(0.00001);
  expect(result.unaimedSprint.maximumWristError).toBeLessThan(0.00001);
  expect(result.unaimedSprint.maximumLocalAxis).toBe(0);
  expect(result.megaBusterSprint.wristOverrideError).toBeLessThan(0.00001);
  expect(result.swordSprint.wristOverrideError).toBeLessThan(0.00001);
  expect(result.subthresholdCameraTurn.cameraTurnDegrees).toBeLessThan(
    result.subthresholdCameraTurn.cameraTurnEntryDegrees,
  );
  expect(result.turningSprintArcs.left.cameraTurnDegrees).toBeLessThanOrEqual(-14);
  expect(result.turningSprintArcs.right.cameraTurnDegrees).toBeGreaterThanOrEqual(14);
  expect(result.turningSprintArcs.left.cameraTurnAmount).toBeLessThan(-0.1);
  expect(result.turningSprintArcs.right.cameraTurnAmount).toBeGreaterThan(0.1);
  expect(result.turningSprintArcs.left.rootMotionLocalX).toBeLessThan(0);
  expect(result.turningSprintArcs.left.rootMotionLocalZ).toBeGreaterThan(0);
  expect(result.turningSprintArcs.right.rootMotionLocalX).toBeGreaterThan(0);
  expect(result.turningSprintArcs.right.rootMotionLocalZ).toBeGreaterThan(0);
  expect(result.turningSprintArcs.left.velocityX).toBeGreaterThan(0);
  expect(result.turningSprintArcs.right.velocityX).toBeLessThan(0);
  expect(result.turningSprintArcs.left.velocityZ).toBeGreaterThan(0);
  expect(result.turningSprintArcs.right.velocityZ).toBeGreaterThan(0);
  expect(Math.abs(result.turningSprintArcs.left.averageSpeed - result.aimedSprintArcs.straight.averageSpeed)
    / result.aimedSprintArcs.straight.averageSpeed).toBeLessThan(0.03);
  expect(Math.abs(result.turningSprintArcs.right.averageSpeed - result.aimedSprintArcs.straight.averageSpeed)
    / result.aimedSprintArcs.straight.averageSpeed).toBeLessThan(0.03);
  expect(result.turningSprintArcs.left.minimumRootMotionSpeedMultiplier).toBeGreaterThanOrEqual(0.72);
  expect(result.turningSprintArcs.left.maximumRootMotionSpeedMultiplier).toBeLessThanOrEqual(1.28);
  expect(result.turningSprintArcs.right.minimumRootMotionSpeedMultiplier).toBeGreaterThanOrEqual(0.72);
  expect(result.turningSprintArcs.right.maximumRootMotionSpeedMultiplier).toBeLessThanOrEqual(1.28);
  expect(result.turningSprintArcs.left.cadenceScale).toBeGreaterThan(1.5);
  expect(result.turningSprintArcs.right.cadenceScale).toBeGreaterThan(1.5);
  expect(result.turningSprintArcs.right.phaseSyncError).toBeLessThan(0.000001);
  expect(result.turningSprintArcs.right.transitionFadeSeconds).toBeLessThanOrEqual(0.08);
  expect(result.reverseArcSwap.phaseSyncError).toBeLessThan(0.000001);
  expect(result.reverseArcSwap.transitionFadeSeconds).toBeLessThanOrEqual(0.08);
  expect(['leftAnkle', 'rightAnkle']).toContain(result.reverseArcSwap.transitionFootLockJoint);
  expect(result.reverseArcSwap.transitionFootLockOffset).toBeGreaterThan(0);
  expect(result.reverseArcLockedFootDisplacement).toBeLessThan(0.000001);
  expect(result.reverseArcSwapSettled.phaseSyncError).toBeLessThan(0.000001);
  expect(result.pistolRunArcLoopErrors.arc).toBeLessThan(0.0001);
  expect(result.pistolRunArcLoopErrors.arc2).toBeLessThan(0.0001);
  expect(result.tankSprint.arcLeft.speed).toBeCloseTo(result.tankSprint.straight.speed, 5);
  expect(result.tankSprint.arcRight.speed).toBeCloseTo(result.tankSprint.straight.speed, 5);
  expect(result.tankSprint.backward.speed).toBeCloseTo(result.tankSprint.jogForward.speed, 5);
  expect(result.tankSprint.backwardArc.speed).toBeCloseTo(result.tankSprint.jogForward.speed, 5);
  expect(result.tankSprint.turnLeft.speed).toBeCloseTo(0, 5);
  expect(result.tankSprint.turnRight.speed).toBeCloseTo(0, 5);
});

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

test('lock-on survives covered weak points and the complete dodge roll', async ({ page }) => {
  await page.goto('/?reaverbotSeed=lock-retention-proof');
  await page.waitForFunction(() => Boolean(
    window.game?.player?._fbxAnimationLibraryLoaded
    && window.spawnReaverbot,
  ));

  const result = await page.evaluate(() => {
    const game = window.game;
    const combat = game.combat;
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    game.stop();

    for (const existing of [...game.enemies]) {
      existing.dispose?.();
      existing.root.removeFromParent();
    }
    game.enemies.length = 0;
    game.projectiles.clear();

    player.root.position.set(0, 0, 0);
    player.lastMoveDirection.set(0, 0, 1);
    player.velocity.set(0, 0, 0);
    player.dead = false;
    player.animation.dead = false;
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.actionDuration = 0;
    player.animation.attackTimer = 0;
    player.animation.hurtTimer = 0;
    player.animation.cancelAttack();
    game.camera.position.set(0, 3.2, -7);
    game.camera.lookAt(0, 1.2, 5);
    game.camera.updateMatrixWorld(true);

    const enemy = window.spawnReaverbot({
      archetypeId: 'shieldSentinel',
      seed: 'lock-retention-sentinel',
      position: new Vector3(0, 0, 5),
    });
    enemy.brain.weakPointExposed = true;
    enemy.brain.defenseActive = false;
    enemy.root.updateMatrixWorld(true);
    const weakPoint = enemy.weakPointTarget;
    const profile = combat._getStatefulProfile(
      combat._getCurrentProfile(),
      combat.getCurrentWeaponState(),
    );
    const originalSafeAreaCheck = game.isPlayerInSafeArea;
    game.isPlayerInSafeArea = () => false;

    Object.assign(combat.lockOn, {
      target: weakPoint,
      progress: 1,
      manual: true,
      movementLocked: true,
      source: 'tab',
    });
    combat._updateLockOn(1 / 60, game.pointer.aimWorld, profile, {
      pressed: false,
      aiming: false,
    });
    const exposed = {
      candidateListed: enemy.getCombatTargets().includes(weakPoint),
      active: weakPoint.active,
      target: combat.lockOn.target === weakPoint,
      movement: combat.getMovementLockTarget() === weakPoint,
      targeting: combat.getTargetingLockTarget() === weakPoint,
    };

    enemy.brain.weakPointExposed = false;
    enemy.brain.defenseActive = true;
    combat._updateLockOn(1 / 60, game.pointer.aimWorld, profile, {
      pressed: false,
      aiming: false,
    });
    const covered = {
      candidateListed: enemy.getCombatTargets().includes(weakPoint),
      active: weakPoint.active,
      target: combat.lockOn.target === weakPoint,
      progress: combat.lockOn.progress,
      movement: combat.getMovementLockTarget() === weakPoint,
      targeting: combat.getTargetingLockTarget() === weakPoint,
    };

    const movementOptions = {
      arenaRadius: 100,
      movementForward: new Vector3(0, 0, 1),
      movementRight: new Vector3(1, 0, 0),
      groundY: 0,
      game,
    };
    game.pointer.primary = false;
    game.pointer.primaryPressed = false;
    game.pointer.secondary = false;
    game.pointer.secondaryPressed = false;
    game.pointer.lockOnPressed = false;
    const rollStarted = player.tryDodgeRoll(new Set(['KeyW']), movementOptions);
    const rollSamples = [];
    let frames = 0;
    while (player.animation.actionState === 'dodgeRoll' && frames < 240) {
      player.update(1 / 120, new Set(), movementOptions);
      combat.update(1 / 120);
      rollSamples.push({
        target: combat.lockOn.target === weakPoint,
        movement: combat.getMovementLockTarget() === weakPoint,
        targeting: combat.getTargetingLockTarget() === weakPoint,
      });
      frames += 1;
    }
    combat.update(1 / 60);
    const afterRoll = {
      target: combat.lockOn.target === weakPoint,
      movement: combat.getMovementLockTarget() === weakPoint,
      targeting: combat.getTargetingLockTarget() === weakPoint,
    };

    enemy.dead = true;
    combat.update(1 / 60);
    const deadClearsLock = combat.lockOn.target === null
      && combat.getMovementLockTarget() === null
      && combat.getTargetingLockTarget() === null;
    game.isPlayerInSafeArea = originalSafeAreaCheck;

    return {
      exposed,
      covered,
      rollStarted,
      frames,
      rollSamples,
      afterRoll,
      deadClearsLock,
    };
  });

  expect(result.exposed).toEqual({
    candidateListed: true,
    active: true,
    target: true,
    movement: true,
    targeting: true,
  });
  expect(result.covered).toEqual({
    candidateListed: false,
    active: false,
    target: true,
    progress: 1,
    movement: true,
    targeting: true,
  });
  expect(result.rollStarted).toBe(true);
  expect(result.frames).toBeGreaterThan(0);
  expect(result.rollSamples.every((sample) => (
    sample.target && sample.movement && sample.targeting
  ))).toBe(true);
  expect(result.afterRoll).toEqual({ target: true, movement: true, targeting: true });
  expect(result.deadClearsLock).toBe(true);
});

test('unified Buster combat also retains a covered weak-point lock while rolling', async ({ page }) => {
  await page.goto('/?busterLab=1&reaverbotSeed=unified-lock-retention-proof');
  await page.waitForFunction(() => Boolean(
    window.game?.busterLabPlans?.get('megaBuster')
    && window.game?.player?._fbxAnimationLibraryLoaded
    && window.spawnReaverbot,
  ));

  const result = await page.evaluate(() => {
    const game = window.game;
    const combat = game.combat;
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    game.stop();
    for (const existing of [...game.enemies]) {
      existing.dispose?.();
      existing.root.removeFromParent();
    }
    game.enemies.length = 0;
    game.projectiles.clear();
    player.root.position.set(0, 0, 0);
    player.lastMoveDirection.set(0, 0, 1);
    player.velocity.set(0, 0, 0);
    player.animation.actionState = null;
    player.animation.actionTimer = 0;
    player.animation.actionDuration = 0;
    player.animation.attackTimer = 0;
    player.animation.hurtTimer = 0;
    player.animation.cancelAttack();
    const enemy = window.spawnReaverbot({
      archetypeId: 'shieldSentinel',
      seed: 'unified-lock-retention-sentinel',
      position: new Vector3(0, 0, 5),
    });
    enemy.brain.weakPointExposed = false;
    enemy.brain.defenseActive = true;
    const weakPoint = enemy.weakPointTarget;
    Object.assign(combat.lockOn, {
      target: weakPoint,
      progress: 1,
      manual: true,
      movementLocked: true,
      source: 'tab',
    });
    const originalSafeAreaCheck = game.isPlayerInSafeArea;
    game.isPlayerInSafeArea = () => false;
    game.pointer.primary = false;
    game.pointer.primaryPressed = false;
    game.pointer.secondary = false;
    game.pointer.secondaryPressed = false;
    game.pointer.lockOnPressed = false;
    const movementOptions = {
      arenaRadius: 100,
      movementForward: new Vector3(0, 0, 1),
      movementRight: new Vector3(1, 0, 0),
      groundY: 0,
      game,
    };
    const rollStarted = player.tryDodgeRoll(new Set(['KeyW']), movementOptions);
    let retained = true;
    let frames = 0;
    while (player.animation.actionState === 'dodgeRoll' && frames < 240) {
      player.update(1 / 120, new Set(), movementOptions);
      combat.update(1 / 120);
      retained = retained
        && combat.lockOn.target === weakPoint
        && combat.getMovementLockTarget() === weakPoint
        && combat.getTargetingLockTarget() === weakPoint;
      frames += 1;
    }
    combat.update(1 / 60);
    const retainedAfterRoll = combat.lockOn.target === weakPoint
      && combat.getMovementLockTarget() === weakPoint
      && combat.getTargetingLockTarget() === weakPoint;
    game.isPlayerInSafeArea = originalSafeAreaCheck;
    return {
      compiledPlanActive: game.getActiveBusterPlan()?.isMegaBuster === true,
      rollStarted,
      frames,
      retained,
      retainedAfterRoll,
    };
  });

  expect(result.compiledPlanActive).toBe(true);
  expect(result.rollStarted).toBe(true);
  expect(result.frames).toBeGreaterThan(0);
  expect(result.retained).toBe(true);
  expect(result.retainedAfterRoll).toBe(true);
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
    const enemy = game.spawner.spawnEnemy('basic', false, new Vector3(0, 0, 5.5), {
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
    const { createFixedArmDescriptor } = await import('./src/equipment/ArmCatalog.js');
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
    const missile = createFixedArmDescriptor('missileArm');
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
