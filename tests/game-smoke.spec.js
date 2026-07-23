import { expect, test } from '@playwright/test';

test('loads the ruin scene and performs a fixed-height jump', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      runtimeErrors.push(message.text());
    }
  });

  await page.goto('/?startupWorld=dungeon');
  await expect(page.locator('canvas')).toHaveCount(1);

  const container = page.locator('#game-container');
  await expect
    .poll(async () => container.getAttribute('data-browser-test-ready'))
    .toBe('true');

  await page.locator('canvas').click({ position: { x: 320, y: 180 } });
  await page.keyboard.press('Space');

  // A committed Mega Man Legends-like hop should rise to roughly the configured
  // fixed height, then land without using a full-body action displacement.
  await expect
    .poll(async () => Number(await container.getAttribute('data-player-root-y')))
    .toBeGreaterThan(1.1);

  await expect
    .poll(async () => Number(await container.getAttribute('data-player-root-y')))
    .toBeLessThan(0.05);

  await expect(container).toHaveAttribute('data-player-full-body-action', 'none');
  expect(runtimeErrors).toEqual([]);
});

test('standing and moving hops share the forward-jump animation flow', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const player = game.player;
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

    const sampleJump = (speed, keys) => {
      player.ledgeCling = null;
      player.root.position.copy(spawn);
      player.modelRoot.position.y = 0;
      player.velocity.set(0, 0, speed);
      player.jumpState = 'Grounded';
      player._jumpGroundY = spawn.y;
      player._jumpBufferTimer = 0;
      player._coyoteTimer = player.jumpSettings.coyoteTime;
      player._landingRecoveryTimer = 0;
      player.lastMoveDirection.copy(forward);
      player.faceDirection(forward);
      player.tryJump(keys, movementOptions);
      player.update(1 / 60, keys, movementOptions);
      return {
        kind: player._jumpKind,
        state: player._getPhysicalJumpAnimationState(),
        clip: player.externalRig.activeClipKey,
        horizontalSpeed: Math.hypot(player.velocity.x, player.velocity.z),
      };
    };

    const standing = sampleJump(0, new Set());
    const moving = sampleJump(4.35, new Set(['KeyW']));
    const leftShoulder = player.externalRig.joints.get('leftShoulder');
    const rightShoulder = player.externalRig.joints.get('rightShoulder');
    let previousLeft = leftShoulder.quaternion.clone();
    let previousRight = rightShoulder.quaternion.clone();
    let previousY = player.root.position.y;
    let previousJumpState = player.jumpState;
    let transitionSeen = false;
    let transitionWindow = 0;
    let maximumTransitionArmStep = 0;
    let fallingArmTravel = 0;
    let maximumFallingHeightIncrease = 0;
    let previousFootClearance = player.getExternalModelGroundingDiagnostics()?.footClearance;
    let maximumFootDropPerFrame = 0;
    let maximumTransitionFootRise = 0;
    let maximumFootDropContext = null;
    let transitionFadeSeconds = null;
    const jumpClipSequence = [];

    for (let frame = 0; frame < 240 && player.jumpState !== 'Grounded'; frame += 1) {
      const previousClip = player.externalRig.activeClipKey;
      player.update(1 / 120, new Set(['KeyW']), movementOptions);
      const currentClip = player.externalRig.activeClipKey;
      if (jumpClipSequence.at(-1) !== currentClip) {
        jumpClipSequence.push(currentClip);
      }
      if (previousClip === 'forwardJumpLaunch' && currentClip === 'forwardJumpFall') {
        transitionSeen = true;
        transitionWindow = 12;
        transitionFadeSeconds = player.externalRig.root.userData.lastFbxAnimationFadeSeconds;
      }
      if (transitionWindow > 0) {
        maximumTransitionArmStep = Math.max(
          maximumTransitionArmStep,
          previousLeft.angleTo(leftShoulder.quaternion),
          previousRight.angleTo(rightShoulder.quaternion),
        );
        transitionWindow -= 1;
      }
      if (currentClip === 'forwardJumpFall' || currentClip === 'fallingIdle') {
        fallingArmTravel += previousLeft.angleTo(leftShoulder.quaternion)
          + previousRight.angleTo(rightShoulder.quaternion);
      }
      if (previousJumpState === 'Falling') {
        maximumFallingHeightIncrease = Math.max(
          maximumFallingHeightIncrease,
          player.root.position.y - previousY,
        );
      }
      const footClearance = player.getExternalModelGroundingDiagnostics()?.footClearance;
      if (Number.isFinite(previousFootClearance) && Number.isFinite(footClearance)) {
        if (currentClip === 'forwardJumpFall') {
          maximumTransitionFootRise = Math.max(
            maximumTransitionFootRise,
            footClearance - previousFootClearance,
          );
        }
        const footDrop = previousFootClearance - footClearance;
        if (footDrop > maximumFootDropPerFrame) {
          maximumFootDropPerFrame = footDrop;
          maximumFootDropContext = {
            frame,
            clip: currentClip,
            jumpState: player.jumpState,
            rootY: player.root.position.y,
            previousFootClearance,
            footClearance,
          };
        }
      }
      previousFootClearance = footClearance;
      previousLeft = leftShoulder.quaternion.clone();
      previousRight = rightShoulder.quaternion.clone();
      previousY = player.root.position.y;
      previousJumpState = player.jumpState;
    }

    player.root.position.copy(spawn).add(new Vector3(0, 5, 0));
    player.modelRoot.position.y = 0;
    player.velocity.set(0, -1, 0);
    player.jumpState = 'Falling';
    player._jumpGroundY = spawn.y;
    player._jumpAirTimer = player._getEstimatedJumpAirTime() * 0.52;
    player._jumpFallTransitionActive = true;
    const longFallClipSequence = [];
    for (let frame = 0; frame < 300 && player.jumpState !== 'Grounded'; frame += 1) {
      player.update(1 / 120, new Set(), movementOptions);
      const clip = player.externalRig.activeClipKey;
      if (longFallClipSequence.at(-1) !== clip) {
        longFallClipSequence.push(clip);
      }
    }

    return {
      jumpHeight: player.getJumpPhysicsDebug().jumpHeight,
      neutralClipLoaded: player.externalRig.animationClips.has('neutralJump'),
      standing,
      moving,
      transitionSeen,
      transitionFadeSeconds,
      maximumTransitionArmStep,
      fallingArmTravel,
      maximumFallingHeightIncrease,
      maximumFootDropPerFrame,
      maximumFootDropContext,
      maximumTransitionFootRise,
      jumpClipSequence,
      longFallClipSequence,
    };
  });

  expect(result.jumpHeight).toBeCloseTo(1.65, 2);
  expect(result.neutralClipLoaded).toBe(false);
  expect(result.standing).toMatchObject({
    kind: 'forwardJump',
    state: 'forwardJump',
    clip: 'forwardJumpLaunch',
  });
  expect(result.standing.horizontalSpeed).toBeLessThan(0.05);
  expect(result.moving).toMatchObject({
    kind: 'forwardJump',
    state: 'forwardJump',
    clip: 'forwardJumpLaunch',
  });
  expect(result.moving.horizontalSpeed).toBeGreaterThan(4);
  expect(result.transitionSeen).toBe(true);
  expect(result.transitionFadeSeconds).toBeCloseTo(0.12, 3);
  expect(result.maximumTransitionArmStep).toBeLessThan(0.2);
  expect(result.fallingArmTravel).toBeGreaterThan(1);
  expect(result.maximumFallingHeightIncrease).toBeLessThanOrEqual(0.0001);
  expect(result.maximumFootDropPerFrame).toBeLessThan(0.5);
  expect(result.maximumTransitionFootRise).toBeLessThanOrEqual(0.02);
  expect(result.jumpClipSequence.slice(0, 4)).toEqual([
    'forwardJumpLaunch',
    'forwardJumpFall',
    'fallingIdle',
    'fallingToLanding',
  ]);
  expect(result.longFallClipSequence.slice(0, 3)).toEqual([
    'forwardJumpFall',
    'fallingIdle',
    'fallingToLanding',
  ]);
});

test('airborne firing layers the buster arm over jump motion and dodge cancels firing', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const player = game.player;
    const combat = game.combat;
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
    const resetPlayer = () => {
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
    };

    player.switchArmWeapon(0, true);
    resetPlayer();
    player.tryJump(new Set(['KeyW']), movementOptions);
    const aimPoint = player.root.position.clone().addScaledVector(forward, 8);
    player.playProjectileShotAnimation(0.5, aimPoint, 0.8, {
      weaponKey: player.getActiveArmWeapon()?.id,
    });

    const rig = player.externalRig;
    const leftShoulder = rig.joints.get('leftShoulder');
    const rightShoulder = rig.joints.get('rightShoulder');
    const aimShoulder = rig.busterAirAimPose.get('leftShoulder');
    let maximumBusterAimError = 0;
    let rightShoulderTravel = 0;
    let previousRight = rightShoulder.quaternion.clone();
    let launchClipSeen = false;
    let fallClipSeen = false;
    let busterAimFrames = 0;

    for (let frame = 0; frame < 100 && player.isJumpAirborne(); frame += 1) {
      player.update(1 / 120, new Set(['KeyW']), movementOptions);
      launchClipSeen ||= rig.activeClipKey === 'forwardJumpLaunch';
      fallClipSeen ||= rig.activeClipKey === 'forwardJumpFall';
      if (aimShoulder && rig.root.userData.airborneBusterAimActive) {
        busterAimFrames += 1;
        maximumBusterAimError = Math.max(
          maximumBusterAimError,
          leftShoulder.quaternion.angleTo(aimShoulder),
        );
      }
      rightShoulderTravel += previousRight.angleTo(rightShoulder.quaternion);
      previousRight = rightShoulder.quaternion.clone();
    }

    resetPlayer();
    player.playProjectileShotAnimation(0.6, aimPoint, 0.8, {
      weaponKey: player.getActiveArmWeapon()?.id,
    });
    combat.pendingProjectileShots.push({ timer: 0.3, direction: forward.clone(), profile: {} });
    const dodgeStarted = player.tryDodgeRoll(new Set(['KeyW']), movementOptions);
    player.update(1 / 60, new Set(), movementOptions);

    return {
      aimPoseJointCount: rig.busterAirAimPose.size,
      launchClipSeen,
      fallClipSeen,
      maximumBusterAimError,
      busterAimFrames,
      rightShoulderTravel,
      dodgeStarted,
      dodgeClip: rig.activeClipKey,
      actionState: player.animation.actionState,
      attackTimer: player.animation.attackTimer,
      bracedFireTimer: player.bracedFireTimer,
      attackWeaponKind: player._attackWeaponKind,
      pendingProjectileCount: combat.pendingProjectileShots.length,
    };
  });

  expect(result.aimPoseJointCount).toBe(3);
  expect(result.launchClipSeen).toBe(true);
  expect(result.fallClipSeen).toBe(true);
  expect(result.busterAimFrames).toBeGreaterThan(0);
  expect(result.maximumBusterAimError).toBeLessThan(0.001);
  expect(result.rightShoulderTravel).toBeGreaterThan(0.05);
  expect(result.dodgeStarted).toBe(true);
  expect(result.dodgeClip).toBe('dodgeRoll');
  expect(result.actionState).toBe('dodgeRoll');
  expect(result.attackTimer).toBe(0);
  expect(result.bracedFireTimer).toBe(0);
  expect(result.attackWeaponKind).toBeNull();
  expect(result.pendingProjectileCount).toBe(0);
});

test('powerful hits use a distinct airborne knockback arc and resolve walkable landings', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    const start = game.dungeon.playerStart.clone();
    const lowerLandingY = start.y - 1.5;
    const movementOptions = {
      arenaRadius: game.arenaRadius,
      movementForward: new Vector3(0, 0, 1),
      movementRight: new Vector3(1, 0, 0),
      groundY: start.y,
    };

    player.root.position.copy(start);
    player.health = player.stats.maxHealth;
    player.dead = false;
    player.animation.dead = false;
    game.cameraController.snapTo(player);
    player.powerKnockbackLandingResolver = ({ position }) => ({
      position: new Vector3(position.x, lowerLandingY, position.z),
      mode: 'lowerTestSurface',
    });
    const source = { position: start.clone().add(new Vector3(0, 0, -1)) };
    const dealt = player.takeDamage(5, source, {
      attackKind: 'pounce',
      powerfulKnockback: true,
      knockbackDirection: new Vector3(0, 0, 1),
    });
    const directPowerReactionTier = player.lastDamageResult?.resolvedReactionTier ?? 0;

    const states = [];
    const animationStates = [];
    let maximumY = player.root.position.y;
    let previousFallingY = Infinity;
    let maximumFallingRise = 0;
    let stayedAirborneBelowOriginalFloor = false;
    let lyingFlatPitch = 0;
    let lyingFlatBodyAngle = 0;
    let minimumLyingFlatKneeAngle = Infinity;
    let maximumLyingFlatBackClearance = 0;
    let lyingFlatFrameCount = 0;
    let aerialAnimationWhileLyingFlat = false;
    let authoredLyingFlatClipSeen = false;
    let minimumLyingFlatClipProgress = Infinity;
    let jumpFallStateSeen = false;
    let rootDescendedBelowLandingSurface = false;
    let landingContactClearance = null;
    let landingContactSource = null;
    let landingContactSampleCount = 0;
    let landingRootY = null;
    let recoveryBeganBeforeBackContact = false;
    let backContactConfirmed = false;
    let minimumContactDescentCameraY = Infinity;
    let maximumContactDescentCameraY = -Infinity;
    let steepestContactDescentCameraLookY = 0;
    const cameraDirection = new Vector3();
    for (let frame = 0; frame < 600 && player.isPowerKnockbackActive(); frame += 1) {
      player.update(1 / 120, new Set(), movementOptions);
      game.cameraController.update(1 / 120, player);
      const state = player.powerKnockbackState;
      const diagnostics = player.getPowerKnockbackLandingDiagnostics();
      if (state && states.at(-1) !== state) states.push(state);
      if (animationStates.at(-1) !== player.animation.state) animationStates.push(player.animation.state);
      maximumY = Math.max(maximumY, player.root.position.y);
      if (state === 'AerialKnockbackFalling') {
        if (Number.isFinite(previousFallingY)) {
          maximumFallingRise = Math.max(maximumFallingRise, player.root.position.y - previousFallingY);
        }
        previousFallingY = player.root.position.y;
        stayedAirborneBelowOriginalFloor ||= player.root.position.y < start.y - 0.1;
        if (player.root.position.y < lowerLandingY - 0.02) {
          rootDescendedBelowLandingSurface = true;
          minimumContactDescentCameraY = Math.min(minimumContactDescentCameraY, game.camera.position.y);
          maximumContactDescentCameraY = Math.max(maximumContactDescentCameraY, game.camera.position.y);
          game.camera.getWorldDirection(cameraDirection);
          steepestContactDescentCameraLookY = Math.min(
            steepestContactDescentCameraLookY,
            cameraDirection.y,
          );
        }
      }
      if (state === 'BackLanding' && landingContactClearance === null) {
        landingContactClearance = diagnostics.backClearance;
        landingContactSource = diagnostics.backContactSource;
        landingContactSampleCount = diagnostics.backContactSampleCount;
        landingRootY = player.root.position.y;
        backContactConfirmed = Number.isFinite(landingContactClearance)
          && Math.abs(landingContactClearance) <= 0.002;
      }
      if ((state === 'LyingFlat' || state === 'GetUp') && !backContactConfirmed) {
        recoveryBeganBeforeBackContact = true;
      }
      if (state === 'LyingFlat') {
        lyingFlatFrameCount += 1;
        lyingFlatPitch = Math.max(lyingFlatPitch, Math.abs(player.modelRoot.rotation.x));
        maximumLyingFlatBackClearance = Math.max(
          maximumLyingFlatBackClearance,
          Math.abs(diagnostics.backClearance ?? Infinity),
        );
        aerialAnimationWhileLyingFlat ||= player.animation.state === 'aerialKnockbackFall';
        authoredLyingFlatClipSeen ||= player.externalRig.activeClipKey === 'lyingFlat';
        const lyingFlatDuration = player.externalRig.animationMetadata.get('lyingFlat')?.duration ?? 0;
        if (lyingFlatDuration > 0 && player.externalRig.activeClipKey === 'lyingFlat') {
          minimumLyingFlatClipProgress = Math.min(
            minimumLyingFlatClipProgress,
            player.externalRig.activeAction.time / lyingFlatDuration,
          );
        }
        const hips = player.externalRig.joints.get('hips');
        const restHips = player.externalRig.restLocalQuaternions.get(hips);
        if (hips && restHips) {
          lyingFlatBodyAngle = Math.max(lyingFlatBodyAngle, hips.quaternion.angleTo(restHips));
        }
        const leftKnee = player.externalRig.joints.get('leftKnee');
        const restLeftKnee = player.externalRig.restLocalQuaternions.get(leftKnee);
        if (leftKnee && restLeftKnee) {
          minimumLyingFlatKneeAngle = Math.min(
            minimumLyingFlatKneeAngle,
            leftKnee.quaternion.angleTo(restLeftKnee),
          );
        }
      }
      jumpFallStateSeen ||= player.animation.state === 'fall' || player.animation.state === 'forwardJumpFall';
    }

    const contactDescentCameraDrift = Number.isFinite(minimumContactDescentCameraY)
      ? maximumContactDescentCameraY - minimumContactDescentCameraY
      : null;

    const knockbackSummary = {
      dealt,
      states,
      animationStates,
      maximumY,
      startY: start.y,
      finalY: player.root.position.y,
      backwardTravel: player.root.position.z - start.z,
      maximumFallingRise,
      stayedAirborneBelowOriginalFloor,
      lyingFlatPitch,
      lyingFlatBodyAngle,
      minimumLyingFlatKneeAngle,
      maximumLyingFlatBackClearance,
      lyingFlatFrameCount,
      aerialAnimationWhileLyingFlat,
      authoredLyingFlatClipSeen,
      minimumLyingFlatClipProgress,
      landingMode: player.powerKnockbackLandingMode,
      jumpFallStateSeen,
      controlRestored: !player.animation.externalControlLocked,
      rootDescendedBelowLandingSurface,
      landingContactClearance,
      landingContactSource,
      landingContactSampleCount,
      landingRootY,
      lowerLandingY,
      recoveryBeganBeforeBackContact,
      contactDescentCameraDrift,
      minimumContactDescentCameraY,
      steepestContactDescentCameraLookY,
    };

    player.powerKnockbackState = null;
    player.animation.externalControlLocked = false;
    player.animation.actionState = null;
    player.animation.hurtTimer = 0;
    player.root.position.copy(start);
    player.takeDamage(1, source, { attackKind: 'melee' });
    const lightHitStartedPowerKnockback = player.isPowerKnockbackActive();
    player.update(1 / 60, new Set(), movementOptions);
    const lightSpine = player.externalRig.joints.get('spine');
    const lightSpineRest = player.externalRig.restLocalQuaternions.get(lightSpine);
    const lightReactionPose = {
      tier: player.externalRig.root.userData.standingHitReactionTier,
      progress: player.externalRig.root.userData.standingHitReactionProgress,
      spineAngle: lightSpine?.quaternion.angleTo(lightSpineRest) ?? 0,
      state: player.animation.state,
    };

    player.animation.hurtTimer = 0;
    player.animation.hurtDuration = 0;
    player.animation.hurtReactionTier = 0;
    player.movementLockTimer = 0;
    player.root.position.copy(start);
    player.velocity.set(0, 0, 0);
    player.takeIncomingHit({
      amount: 1,
      source,
      reactionTier: 2,
      knockbackDirection: new Vector3(0, 0, 1),
    });
    player.update(1 / 60, new Set(), movementOptions);
    const bracedSpine = player.externalRig.joints.get('spine');
    const bracedSpineRest = player.externalRig.restLocalQuaternions.get(bracedSpine);
    const bracedReactionPose = {
      tier: player.externalRig.root.userData.standingHitReactionTier,
      progress: player.externalRig.root.userData.standingHitReactionProgress,
      spineAngle: bracedSpine?.quaternion.angleTo(bracedSpineRest) ?? 0,
      state: player.animation.state,
      firstFrameTravel: player.root.position.distanceTo(start),
    };
    for (let frame = 0; frame < 11; frame += 1) {
      player.update(1 / 60, new Set(), movementOptions);
    }
    bracedReactionPose.activeAfterLightWindow = player.animation.hurtTimer > 0;
    bracedReactionPose.totalTravel = player.root.position.distanceTo(start);

    player.powerKnockbackState = null;
    player.animation.externalControlLocked = false;
    player.animation.hurtTimer = 0;
    player.animation.hurtDuration = 0;
    player.animation.hurtReactionTier = 0;
    player.movementLockTimer = 0;
    player.velocity.set(0, 0, 0);
    player.root.position.copy(start);
    player.health = player.stats.maxHealth;
    const pouncer = window.spawnReaverbot({
      archetypeId: 'pouncer',
      seed: 'qa:0',
      position: start.clone().add(new Vector3(0, 0, 0.5)),
    });
    pouncer.brain.attackHit = false;
    pouncer._tryContactHit(game, 1);
    const pounceWiring = {
      attackKind: pouncer.genome.modules.weapon.attackKind,
      reactionTier: player.lastDamageResult?.resolvedReactionTier ?? 0,
      state: player.powerKnockbackState,
    };
    pouncer.root.removeFromParent();
    game.enemies.splice(game.enemies.indexOf(pouncer), 1);

    player.powerKnockbackState = null;
    player.animation.externalControlLocked = false;
    player.root.position.copy(start);
    player.health = player.stats.maxHealth;
    game.addExplosion(start.clone(), 5, 1.5, 0xff8844, {
      damageEnemies: false,
      damagePlayer: true,
      playerDamageScale: 1,
      triggerMines: false,
    });
    const explosionWiringState = player.powerKnockbackState;
    const explosionReactionTier = player.lastDamageResult?.resolvedReactionTier ?? 0;
    player.powerKnockbackState = null;
    player.animation.externalControlLocked = false;

    const controller = game.dungeonController;
    const originalWalkable = controller.isPositionWalkable;
    const originalSurface = controller.getSurfaceElevationAt;
    const originalNearest = controller._findNearestWalkablePosition;
    let pastResolution;
    let beforeResolution;
    try {
      controller.getSurfaceElevationAt = () => 0;
      controller._findNearestWalkablePosition = () => new Vector3(9, 0, 9);
      controller.isPositionWalkable = (position) => position.x >= 1.1;
      pastResolution = controller.resolvePowerKnockbackLanding(
        new Vector3(0, 0.1, 0),
        new Vector3(1, 0, 0),
      );
      controller.isPositionWalkable = (position) => position.x <= -0.9;
      beforeResolution = controller.resolvePowerKnockbackLanding(
        new Vector3(0, 0.1, 0),
        new Vector3(1, 0, 0),
      );
    } finally {
      controller.isPositionWalkable = originalWalkable;
      controller.getSurfaceElevationAt = originalSurface;
      controller._findNearestWalkablePosition = originalNearest;
    }

    return {
      knockbackSummary,
      reactionTierReduction: player.gearEffects?.reactionTierReduction ?? 0,
      directPowerReactionTier,
      lightHitStartedPowerKnockback,
      lightReactionPose,
      bracedReactionPose,
      pounceWiring,
      explosionWiringState,
      explosionReactionTier,
      pastResolution: { mode: pastResolution?.mode, x: pastResolution?.position.x },
      beforeResolution: { mode: beforeResolution?.mode, x: beforeResolution?.position.x },
    };
  });

  expect(result.knockbackSummary.dealt).toBeGreaterThan(0);
  expect(result.reactionTierReduction).toBe(0);
  expect(result.directPowerReactionTier).toBe(3);
  expect(result.knockbackSummary.states).toEqual([
    'KnockbackRising',
    'AerialKnockbackFalling',
    'BackLanding',
    'LyingFlat',
    'GetUp',
  ]);
  expect(result.knockbackSummary.animationStates).toContain('aerialKnockbackFall');
  expect(result.knockbackSummary.animationStates).toContain('lyingFlat');
  expect(result.knockbackSummary.maximumY).toBeGreaterThan(result.knockbackSummary.startY + 0.9);
  expect(result.knockbackSummary.backwardTravel).toBeGreaterThan(2);
  expect(result.knockbackSummary.maximumFallingRise).toBeLessThanOrEqual(0.0001);
  expect(result.knockbackSummary.stayedAirborneBelowOriginalFloor).toBe(true);
  expect(result.knockbackSummary.finalY).toBeCloseTo(result.knockbackSummary.startY - 1.5, 3);
  expect(result.knockbackSummary.lyingFlatPitch).toBeLessThan(0.05);
  expect(result.knockbackSummary.lyingFlatBodyAngle).toBeGreaterThan(0.7);
  expect(result.knockbackSummary.minimumLyingFlatKneeAngle).toBeLessThan(0.2);
  expect(result.knockbackSummary.maximumLyingFlatBackClearance).toBeLessThanOrEqual(0.002);
  expect(result.knockbackSummary.lyingFlatFrameCount).toBeGreaterThan(10);
  expect(result.knockbackSummary.aerialAnimationWhileLyingFlat).toBe(false);
  expect(result.knockbackSummary.authoredLyingFlatClipSeen).toBe(true);
  expect(result.knockbackSummary.minimumLyingFlatClipProgress).toBeGreaterThan(0.95);
  expect(result.knockbackSummary.landingMode).toBe('lowerTestSurface');
  expect(result.knockbackSummary.jumpFallStateSeen).toBe(false);
  expect(result.knockbackSummary.controlRestored).toBe(true);
  expect(result.knockbackSummary.rootDescendedBelowLandingSurface).toBe(true);
  expect(result.knockbackSummary.landingContactSource).toBe('skinnedBackVertices');
  expect(result.knockbackSummary.landingContactSampleCount).toBeGreaterThan(100);
  expect(Math.abs(result.knockbackSummary.landingContactClearance)).toBeLessThanOrEqual(0.002);
  expect(result.knockbackSummary.landingRootY).toBeLessThan(result.knockbackSummary.lowerLandingY - 0.05);
  expect(result.knockbackSummary.recoveryBeganBeforeBackContact).toBe(false);
  expect(result.knockbackSummary.contactDescentCameraDrift).toBeLessThan(0.01);
  expect(result.knockbackSummary.minimumContactDescentCameraY).toBeGreaterThan(
    result.knockbackSummary.lowerLandingY + 3,
  );
  expect(result.knockbackSummary.steepestContactDescentCameraLookY).toBeLessThan(-0.1);
  expect(result.lightHitStartedPowerKnockback).toBe(false);
  expect(result.lightReactionPose).toMatchObject({ tier: 1, state: 'hurt' });
  expect(result.lightReactionPose.progress).toBeGreaterThan(0);
  expect(result.lightReactionPose.spineAngle).toBeGreaterThan(0.01);
  expect(result.bracedReactionPose).toMatchObject({
    tier: 2,
    state: 'hurt',
    activeAfterLightWindow: true,
  });
  expect(result.bracedReactionPose.progress).toBeGreaterThan(0);
  expect(result.bracedReactionPose.spineAngle).toBeGreaterThan(0.02);
  expect(result.bracedReactionPose.firstFrameTravel).toBeGreaterThan(0.05);
  expect(result.bracedReactionPose.totalTravel).toBeGreaterThan(
    result.bracedReactionPose.firstFrameTravel,
  );
  expect(result.pounceWiring).toEqual({
    attackKind: 'pounce',
    reactionTier: 3,
    state: 'KnockbackRising',
  });
  expect(result.explosionWiringState).toBe('KnockbackRising');
  expect(result.explosionReactionTier).toBe(3);
  expect(result.pastResolution.mode).toBe('pastObstacle');
  expect(result.pastResolution.x).toBeGreaterThan(1);
  expect(result.beforeResolution.mode).toBe('beforeObstacle');
  expect(result.beforeResolution.x).toBeLessThan(-0.8);
});

test('power knockback prevents airborne juggling and darkens the health gauge through get-up', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(async () => {
    const { game } = window;
    game.stop();
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    const start = game.dungeon.playerStart.clone();
    const source = { position: start.clone().add(new Vector3(0, 0, -1)) };
    const externalOwner = { id: 'knockback-juggle-test' };
    const movementOptions = {
      arenaRadius: game.arenaRadius,
      movementForward: new Vector3(0, 0, 1),
      movementRight: new Vector3(1, 0, 0),
      groundY: start.y,
    };

    player.root.position.copy(start);
    player.health = player.stats.maxHealth;
    player.dead = false;
    player.animation.dead = false;
    player.powerKnockbackState = null;
    player.animation.externalControlLocked = false;
    player.powerKnockbackLandingResolver = ({ position }) => ({
      position: new Vector3(position.x, start.y, position.z),
      mode: 'juggleImmunityTestSurface',
    });

    const initialDamage = player.takeDamage(5, source, {
      attackKind: 'pounce',
      powerfulKnockback: true,
      knockbackDirection: new Vector3(0, 0, 1),
    });
    const protectedHealth = player.health;
    const samples = [];
    const sampledStates = new Set();
    const track = document.querySelector('#health-gauge .gauge-track');
    const sampleProtection = () => {
      const state = player.powerKnockbackState;
      if (!state || sampledStates.has(state)) return;
      sampledStates.add(state);
      game.ui.update(0);
      const velocityBefore = player.powerKnockbackVelocity.clone();
      const stateBefore = player.powerKnockbackState;
      const repeatedDamage = player.takeDamage(9999, source, {
        attackKind: 'shockwave',
        powerfulKnockback: true,
        knockbackDirection: new Vector3(1, 0, 0),
        knockbackStrength: 1.5,
        unblockable: true,
      });
      const directRelaunch = player._playKnockbackFall(source, {
        knockbackDirection: new Vector3(-1, 0, 0),
        knockbackStrength: 1.5,
      });
      const externalClaimed = player.tryClaimExternalControl(externalOwner, 'tractorBeam', {
        freeze: true,
        ignoreGroundConstraint: true,
      });
      samples.push({
        state,
        repeatedDamage,
        directRelaunch,
        externalClaimed,
        health: player.health,
        dead: player.dead,
        stateUnchanged: player.powerKnockbackState === stateBefore,
        velocityUnchanged: player.powerKnockbackVelocity.distanceTo(velocityBefore) < 0.000001,
        gaugeProtectedClass: document.getElementById('health-gauge')
          .classList.contains('is-power-knockback'),
        trackBackground: getComputedStyle(track).backgroundColor,
      });
    };

    game.ui.update(0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    sampleProtection();
    for (let frame = 0; frame < 600 && player.isPowerKnockbackActive(); frame += 1) {
      player.update(1 / 120, new Set(), movementOptions);
      sampleProtection();
    }

    game.ui.update(0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const recoveryComplete = !player.isPowerKnockbackActive();
    const postRecoveryGaugeClass = document.getElementById('health-gauge')
      .classList.contains('is-power-knockback');
    const postRecoveryTrackBackground = getComputedStyle(track).backgroundColor;
    const healthBeforePostRecoveryHit = player.health;
    const postRecoveryDamage = player.takeDamage(1, source, { attackKind: 'melee' });

    return {
      initialDamage,
      protectedHealth,
      samples,
      recoveryComplete,
      postRecoveryGaugeClass,
      postRecoveryTrackBackground,
      postRecoveryDamage,
      postRecoveryHealthLost: healthBeforePostRecoveryHit - player.health,
    };
  });

  expect(result.initialDamage).toBeGreaterThan(0);
  expect(result.samples.map((sample) => sample.state)).toEqual([
    'KnockbackRising',
    'AerialKnockbackFalling',
    'BackLanding',
    'LyingFlat',
    'GetUp',
  ]);
  expect(result.samples.filter((sample) => !(
    sample.repeatedDamage === 0
    && sample.directRelaunch === false
    && sample.externalClaimed === false
    && sample.health === result.protectedHealth
    && !sample.dead
    && sample.stateUnchanged
    && sample.velocityUnchanged
    && sample.gaugeProtectedClass
    && sample.trackBackground === 'rgb(33, 9, 13)'
  ))).toEqual([]);
  expect(result.recoveryComplete).toBe(true);
  expect(result.postRecoveryGaugeClass).toBe(false);
  expect(result.postRecoveryTrackBackground).toBe('rgb(5, 9, 11)');
  expect(result.postRecoveryDamage).toBeGreaterThan(0);
  expect(result.postRecoveryHealthLost).toBeCloseTo(result.postRecoveryDamage, 5);
});

test('debug ledge cube is a solid 3x3x3 block with a default-height grab ledge', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await expect(page.locator('canvas')).toHaveCount(1);

  const container = page.locator('#game-container');
  await expect
    .poll(async () => container.getAttribute('data-browser-test-ready'))
    .toBe('true');
  await expect
    .poll(async () => container.getAttribute('data-player-external-rig'))
    .toBe('fbx');
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const platform = game.debugLedgePlatform;
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    const frontZ = platform.center.z - platform.halfDepth;
    const approachPosition = new Vector3(platform.center.x, platform.baseY, frontZ - 0.42);

    player.ledgeCling = null;
    player.root.position.copy(approachPosition);
    player.lastMoveDirection.set(0, 0, 1);
    player.faceDirection(player.lastMoveDirection);

    const grabbed = game._tryResolveDebugLedgeCling({
      player,
      root: player.root,
      jumpDirection: new Vector3(0, 0, 1),
      progress: 0.5,
      jumpStartY: platform.baseY,
      jumpReachHeight: player.getJumpReachHeight(),
    });

    const bodyPosition = { x: platform.center.x, y: platform.baseY, z: platform.center.z };
    const topPosition = { x: platform.center.x, y: platform.topY, z: platform.center.z };
    const spawn = game.dungeon.playerStart;
    const footprintDx = Math.max(0, Math.abs(platform.center.x - spawn.x) - platform.halfWidth);
    const footprintDz = Math.max(0, Math.abs(platform.center.z - spawn.z) - platform.halfDepth);
    const spawnClearance = Math.hypot(footprintDx, footprintDz);
    const centerLaneClearance = Math.abs(platform.center.x - spawn.x) - platform.halfWidth;
    const safeInteractableDistances = game.dungeon.safeInteractables.map((interactable) => ({
      id: interactable.id,
      distance: Math.hypot(
        interactable.position.x - spawn.x,
        interactable.position.z - spawn.z,
      ),
    }));
    const npcDistances = [];
    game.dungeon.group.traverse((object) => {
      if (!object.name.toLowerCase().includes('npc')) return;
      const world = object.getWorldPosition(new Vector3());
      npcDistances.push({
        name: object.name,
        distance: Math.hypot(world.x - spawn.x, world.z - spawn.z),
      });
    });

    for (let i = 0; i < 120; i += 1) {
      player.update(1 / 60, new Set(), {
        arenaRadius: game.arenaRadius,
        movementForward: new Vector3(0, 0, 1),
        movementRight: new Vector3(1, 0, 0),
        groundY: platform.baseY,
      });
    }

    return {
      width: platform.halfWidth * 2,
      depth: platform.halfDepth * 2,
      height: platform.topY - platform.baseY,
      bodyWalkable: game.dungeonController.isPositionWalkable(bodyPosition),
      topElevation: game.getDebugLedgeFloorElevation(topPosition),
      grabbed,
      ledgeState: player.ledgeCling?.state ?? null,
      ledgeTopY: player.ledgeCling?.topY ?? null,
      defaultJumpReachHeight: player.getJumpReachHeight(),
      spawnClearance,
      centerLaneClearance,
      safeInteractableDistances,
      npcDistances,
    };
  });

  expect(result).toMatchObject({
    width: 3,
    depth: 3,
    height: 3,
    bodyWalkable: false,
    topElevation: 3,
    grabbed: true,
    ledgeTopY: 3,
  });
  expect(result.defaultJumpReachHeight).toBeLessThan(3);
  expect(result.spawnClearance).toBeGreaterThanOrEqual(5);
  expect(result.centerLaneClearance).toBeGreaterThanOrEqual(5);
  expect(result.safeInteractableDistances.length).toBeGreaterThan(0);
  expect(Math.min(...result.safeInteractableDistances.map(({ distance }) => distance)))
    .toBeGreaterThanOrEqual(5);
  expect(result.npcDistances.length).toBeGreaterThan(0);
  expect(Math.min(...result.npcDistances.map(({ distance }) => distance)))
    .toBeGreaterThanOrEqual(5);
});

test('ledge climb anchors the left hand through the baked FBX push-off', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?startupWorld=dungeon');
  await expect(page.locator('canvas')).toHaveCount(1);

  const container = page.locator('#game-container');
  await expect
    .poll(async () => container.getAttribute('data-browser-test-ready'))
    .toBe('true');
  await expect
    .poll(async () => container.getAttribute('data-player-external-rig'))
    .toBe('fbx');
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(() => {
    const { game } = window;
    const platform = game.debugLedgePlatform;
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    const frontZ = platform.center.z - platform.halfDepth;
    const movementOptions = {
      arenaRadius: game.arenaRadius,
      movementForward: new Vector3(0, 0, 1),
      movementRight: new Vector3(1, 0, 0),
      groundY: platform.baseY,
    };

    const startCling = () => {
      player.ledgeCling = null;
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

    const update = (frames, inputToward = false, visitedStates = null) => {
      const input = inputToward ? new Set(['KeyW']) : new Set();
      for (let i = 0; i < frames; i += 1) {
        player.update(1 / 60, input, movementOptions);
        game.dungeonController.update(1 / 60);
        const state = player.ledgeCling?.state;
        if (visitedStates && state && visitedStates.at(-1) !== state) {
          visitedStates.push(state);
        }
      }
    };

    const measure = (label) => {
      player.modelRoot.updateMatrixWorld(true);
      const left = player.externalRig?.joints?.get('leftWrist')?.getWorldPosition(new Vector3()) ?? null;
      const right = player.externalRig?.joints?.get('rightWrist')?.getWorldPosition(new Vector3()) ?? null;
      const hips = player.externalRig?.joints?.get('hips')?.getWorldPosition(new Vector3()) ?? null;
      const bakedRootProgress = player.ledgeCling?.state === 'climbingUp'
        ? { ...player.externalRig.sampleRootMotionProgress('ledgeClimbUp', player._getLedgeActionProgress(), {}) }
        : null;
      const handMesh = {
        left: { minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity, edgeDistance: Infinity },
        right: { minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity, edgeDistance: Infinity },
      };
      const point = new Vector3();
      const rendered = (object) => {
        for (let current = object; current; current = current.parent) {
          if (current.visible === false) return false;
        }
        return true;
      };
      player.modelRoot.traverse((object) => {
        const position = object.geometry?.attributes?.position;
        const side = object.name.includes('HandMesh_L')
          ? 'left'
          : (object.name.includes('HandMesh_R') || object.name.includes('BusterMesh'))
            ? 'right'
            : null;
        if (!side || !object.isMesh || !position || !rendered(object)) return;
        const stride = Math.max(1, Math.floor(position.count / 500));
        for (let index = 0; index < position.count; index += stride) {
          point.fromBufferAttribute(position, index);
          if (object.isSkinnedMesh && typeof object.applyBoneTransform === 'function') {
            object.applyBoneTransform(index, point);
          }
          object.localToWorld(point);
          handMesh[side].minY = Math.min(handMesh[side].minY, point.y);
          handMesh[side].maxY = Math.max(handMesh[side].maxY, point.y);
          handMesh[side].minZ = Math.min(handMesh[side].minZ, point.z);
          handMesh[side].maxZ = Math.max(handMesh[side].maxZ, point.z);
          handMesh[side].edgeDistance = Math.min(
            handMesh[side].edgeDistance,
            Math.hypot(point.y - platform.topY, point.z - frontZ),
          );
        }
      });
      return {
        label,
        state: player.ledgeCling?.state,
        progress: player._getLedgeActionProgress?.(),
        root: { x: player.root.position.x, y: player.root.position.y, z: player.root.position.z },
        left: left ? { x: left.x, y: left.y, z: left.z } : null,
        right: right ? { x: right.x, y: right.y, z: right.z } : null,
        hips: hips ? { x: hips.x, y: hips.y, z: hips.z } : null,
        bakedRootProgress,
        climbHandsReleased: player.ledgeCling?.climbHandsReleased ?? false,
        climbStartRoot: player.ledgeCling?.climbStartPosition
          ? player.ledgeCling.climbStartPosition.toArray()
          : null,
        climbTarget: player.ledgeCling?.climbPosition
          ? player.ledgeCling.climbPosition.toArray()
          : null,
        handMesh,
        frontZ,
        topY: platform.topY,
      };
    };

    startCling();
    const freeHangPathStates = [player.ledgeCling.state];
    const jumpToHangSamples = [];
    const settleToFreeHangSamples = [];
    for (let i = 0; i < 150; i += 1) {
      update(1, false, freeHangPathStates);
      if (player.ledgeCling?.state === 'jumpingToHanging' && (i < 5 || i % 10 === 0)) {
        jumpToHangSamples.push(measure(`jumpToHang-${i}`));
      } else if (player.ledgeCling?.state === 'settlingToFreeHang' && i % 5 === 0) {
        settleToFreeHangSamples.push(measure(`settlingToFreeHang-${i}`));
      }
    }
    const freeHang = measure('freeHang');
    update(1, true, freeHangPathStates);
    const prepareStart = measure('prepareStart');
    const prepareSamples = [prepareStart];
    let prepareEnd = prepareStart;
    for (let i = 0; i < 80 && player.ledgeCling?.state === 'preparingToClimb'; i += 1) {
      prepareEnd = measure(`prepareEnd-${i}`);
      update(1, true, freeHangPathStates);
      if (player.ledgeCling?.state === 'preparingToClimb' && i % 4 === 0) {
        prepareSamples.push(measure(`prepare-${i}`));
      }
    }
    const climbStart = measure('climbStart');
    const climbSamples = [climbStart];
    for (let i = 0; i < 70 && player.ledgeCling; i += 1) {
      update(1, true, freeHangPathStates);
      if (i % 4 === 0 || !player.ledgeCling) {
        climbSamples.push(measure(`climb-${i}`));
      }
    }

    startCling();
    const directClimbPathStates = [player.ledgeCling.state];
    update(220, true, directClimbPathStates);
    const directClimbFromGrab = measure('directClimbFromGrab');

    startCling();
    update(150, false);
    const freeAgain = measure('freeAgain');
    const captureArmLocal = () => [
      'leftShoulder',
      'leftElbow',
      'leftWrist',
      'rightShoulder',
      'rightElbow',
      'rightWrist',
    ].map((jointName) => {
      const joint = player.externalRig?.joints?.get(jointName);
      return {
        jointName,
        position: joint.position.toArray(),
        quaternion: joint.quaternion.toArray(),
        scale: joint.scale.toArray(),
      };
    });
    const armsBeforeRootAnchor = captureArmLocal();
    player.root.position.y -= 0.4;
    player.root.position.z -= 0.3;
    player._anchorLedgeAnimationPose(player._getLedgeActionProgress());
    const armsAfterRootAnchor = captureArmLocal();
    const bakedRootMotionRange = player.externalRig?.animationMetadata
      ?.get('ledgeClimbUp')?.rootMotion?.totalDistance ?? 0;
    return {
      freeHang,
      jumpToHangSamples,
      settleToFreeHangSamples,
      prepareStart,
      prepareSamples,
      prepareEnd,
      climbStart,
      climbSamples,
      freeHangPathStates,
      directClimbPathStates,
      directClimbFromGrab,
      freeAgain,
      armsBeforeRootAnchor,
      armsAfterRootAnchor,
      bakedRootMotionRange,
    };
  });

  const assertLeftHandAnchored = (sample) => {
    expect(Math.abs(sample.left.y - sample.topY)).toBeLessThan(0.03);
    expect(Math.abs(sample.left.z - (sample.frontZ - 0.055))).toBeLessThan(0.03);
  };
  const assertLeftClimbHandAnchored = (sample) => {
    expect(Math.abs(sample.left.y - sample.topY)).toBeLessThan(0.13);
    expect(Math.abs(sample.left.z - (sample.frontZ - 0.055))).toBeLessThan(0.13);
    expect(sample.handMesh.left.edgeDistance).toBeLessThan(0.16);
  };

  expect(result.freeHangPathStates).toEqual([
    'jumpingToHanging',
    'settlingToFreeHang',
    'hangingIdle',
    'preparingToClimb',
    'climbingUp',
  ]);
  expect(result.directClimbPathStates).toEqual([
    'jumpingToHanging',
    'settlingToFreeHang',
    'preparingToClimb',
    'climbingUp',
  ]);

  expect(result.freeHang.state).toBe('hangingIdle');
  assertLeftHandAnchored(result.freeHang);
  expect(result.jumpToHangSamples.length).toBeGreaterThan(5);
  for (const sample of result.jumpToHangSamples) {
    expect(sample.state).toBe('jumpingToHanging');
    assertLeftHandAnchored(sample);
  }
  expect(result.settleToFreeHangSamples.length).toBeGreaterThan(5);
  for (const sample of result.settleToFreeHangSamples) {
    expect(sample.state).toBe('settlingToFreeHang');
    assertLeftHandAnchored(sample);
  }

  expect(result.directClimbFromGrab.state).toBe('climbingUp');

  expect(result.prepareStart.state).toBe('preparingToClimb');
  assertLeftHandAnchored(result.prepareStart);
  for (const sample of result.prepareSamples) {
    expect(sample.state).toBe('preparingToClimb');
    assertLeftHandAnchored(sample);
  }

  const leftBeforeClimb = result.prepareEnd.left;
  const leftAfterClimb = result.climbStart.left;
  expect(Math.hypot(
    leftAfterClimb.x - leftBeforeClimb.x,
    leftAfterClimb.y - leftBeforeClimb.y,
    leftAfterClimb.z - leftBeforeClimb.z,
  )).toBeLessThan(0.05);
  expect(result.prepareEnd.handMesh.left.edgeDistance).toBeLessThan(0.04);
  expect(result.climbStart.handMesh.left.edgeDistance).toBeLessThan(0.04);

  const averageClimbStartWristY = result.climbStart.left.y;
  const averageClimbStartWristZ = result.climbStart.left.z;
  expect(result.climbStart.state).toBe('climbingUp');
  expect(Math.abs(averageClimbStartWristY - result.climbStart.topY)).toBeLessThan(0.14);
  expect(averageClimbStartWristZ).toBeLessThan(result.climbStart.frontZ);
  assertLeftClimbHandAnchored(result.climbStart);
  expect(result.bakedRootMotionRange).toBeGreaterThan(0.5);

  const activeClimbSamples = result.climbSamples.filter((sample) => sample.state === 'climbingUp');
  let previousRootY = -Infinity;
  for (const sample of activeClimbSamples) {
    expect(sample.root.y).toBeGreaterThanOrEqual(previousRootY - 0.001);
    previousRootY = sample.root.y;
  }
  const plantedClimbSamples = activeClimbSamples.filter((sample) => !sample.climbHandsReleased);
  expect(plantedClimbSamples.length).toBeGreaterThan(5);
  for (const sample of plantedClimbSamples) {
    const start = result.climbStart.left;
    const current = sample.left;
    expect(Math.hypot(current.x - start.x, current.y - start.y, current.z - start.z))
      .toBeLessThan(0.045);
    expect(sample.handMesh.left.edgeDistance).toBeLessThan(0.06);
  }
  expect(Math.max(...activeClimbSamples.map((sample) => sample.root.y)) - result.climbStart.root.y)
    .toBeGreaterThan(1);
  const pullUpSample = activeClimbSamples.find((sample) => sample.progress >= 0.31);
  expect(pullUpSample.hips.y).toBeGreaterThan(3.1);
  const pushOffSample = activeClimbSamples.find((sample) => sample.progress >= 0.66);
  expect(pushOffSample.root.z).toBeGreaterThan(pushOffSample.frontZ + 0.05);

  expect(result.freeAgain.state).toBe('hangingIdle');
  assertLeftHandAnchored(result.freeAgain);
  expect(result.armsAfterRootAnchor).toEqual(result.armsBeforeRootAnchor);
});

test('camp platforms reserve ledge grabs for rises above normal jump reach', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    const platforms = new Map(game.platformingPlatforms.map((platform) => [platform.id, platform]));
    const low = platforms.get('campLowJumpDeck');
    const high = platforms.get('campHighClimbDeck');
    const gap = platforms.get('campHighGapDeck');
    const middle = platforms.get('campReturnDeck');

    const resetPlayer = (position, direction, speed) => {
      player.ledgeCling = null;
      player.root.position.copy(position);
      player.modelRoot.position.y = 0;
      player.velocity.copy(direction).multiplyScalar(speed);
      player.velocity.y = 0;
      player.takeoffHorizontalVelocity.set(0, 0, 0);
      player.jumpState = 'Grounded';
      player._jumpGroundY = position.y;
      player._jumpBufferTimer = 0;
      player._coyoteTimer = player.jumpSettings.coyoteTime;
      player._landingRecoveryTimer = 0;
      player.animation.actionState = null;
      player.animation.actionTimer = 0;
      player.animation.actionDuration = 0;
      player.lastMoveDirection.copy(direction);
      player.faceDirection(direction);
      game.dungeonController.pendingPlayerJumpOffLanding = null;
      game.dungeonController.lastSafePlayerPosition.copy(position);
    };

    const movementOptions = (direction) => ({
      arenaRadius: game.arenaRadius,
      movementForward: direction.clone(),
      movementRight: new Vector3(direction.z, 0, -direction.x),
      groundY: game._getPlayerGroundY(),
    });

    const startJump = (direction) => {
      const options = movementOptions(direction);
      player.tryJump(new Set(['KeyW']), options);
    };

    const update = (frames, direction, inputToward = true, stopWhen = null) => {
      const input = inputToward ? new Set(['KeyW']) : new Set();
      for (let i = 0; i < frames; i += 1) {
        const options = movementOptions(direction);
        player.update(1 / 60, input, options);
        game.dungeonController.update(1 / 60);
        if (stopWhen?.()) return i + 1;
      }
      return frames;
    };

    const debug = game.debugLedgePlatform;
    const offCubeDirection = new Vector3(0, 0, -1);
    resetPlayer(
      new Vector3(debug.center.x, debug.topY, debug.center.z - debug.halfDepth + 0.38),
      offCubeDirection,
      4.35,
    );
    startJump(offCubeDirection);
    update(180, offCubeDirection, true, () => (
      player.jumpState === 'Grounded' && player.root.position.y < 0.05
    ));
    const jumpedOffCube = {
      y: player.root.position.y,
      z: player.root.position.z,
      state: player.jumpState,
      clinging: player.isLedgeClinging(),
    };

    const forward = new Vector3(0, 0, 1);
    resetPlayer(
      new Vector3(low.center.x, low.baseY, low.center.z - low.halfDepth - 0.65),
      forward,
      4.35,
    );
    startJump(forward);
    update(120, forward, true, () => (
      player.jumpState === 'Grounded' && Math.abs(player.root.position.y - low.topY) < 0.05
    ));
    const lowLanding = {
      y: player.root.position.y,
      state: player.jumpState,
      clinging: player.isLedgeClinging(),
    };

    resetPlayer(
      new Vector3(middle.center.x, middle.baseY, middle.center.z - middle.halfDepth - 0.65),
      forward,
      4.35,
    );
    startJump(forward);
    update(120, forward, true, () => (
      player.jumpState === 'Grounded' && Math.abs(player.root.position.y - middle.topY) < 0.05
    ));
    const middleLanding = {
      y: player.root.position.y,
      state: player.jumpState,
      clinging: player.isLedgeClinging(),
    };

    resetPlayer(
      new Vector3(low.center.x, low.topY, low.center.z + low.halfDepth - 0.32),
      forward,
      3.2,
    );
    startJump(forward);
    update(120, forward, true, () => player.isLedgeClinging());
    const climbedFromLow = {
      grabbed: player.isLedgeClinging(),
      id: player.ledgeCling?.id ?? null,
    };
    if (player.isLedgeClinging()) {
      update(300, forward, true, () => !player.isLedgeClinging());
    }
    climbedFromLow.finishedY = player.root.position.y;

    const right = new Vector3(1, 0, 0);
    resetPlayer(
      new Vector3(high.center.x + high.halfWidth - 0.36, high.topY, high.center.z),
      right,
      4.35,
    );
    startJump(right);
    update(120, right, true, () => (
      player.jumpState === 'Grounded' && Math.abs(player.root.position.y - gap.topY) < 0.05
    ));
    const fullGapJump = {
      y: player.root.position.y,
      x: player.root.position.x,
      state: player.jumpState,
      clinging: player.isLedgeClinging(),
    };

    resetPlayer(
      new Vector3(high.center.x + high.halfWidth - 0.4, high.topY, high.center.z),
      right,
      0.6,
    );
    startJump(right);
    update(120, right, true, () => player.isLedgeClinging());
    const shortGapJump = {
      grabbed: player.isLedgeClinging(),
      id: player.ledgeCling?.id ?? null,
      topY: player.ledgeCling?.topY ?? null,
      y: player.root.position.y,
    };

    resetPlayer(
      new Vector3(debug.center.x, middle.topY, debug.center.z - debug.halfDepth - 1.25),
      forward,
      4.35,
    );
    startJump(forward);
    update(120, forward, true, () => (
      player.jumpState === 'Grounded' && Math.abs(player.root.position.y - debug.topY) < 0.05
    ));
    const middleToCube = {
      y: player.root.position.y,
      state: player.jumpState,
      clinging: player.isLedgeClinging(),
    };

    resetPlayer(
      new Vector3(debug.center.x, debug.baseY, debug.center.z - debug.halfDepth - 0.65),
      forward,
      4.35,
    );
    startJump(forward);
    update(120, forward, true, () => player.isLedgeClinging());
    const groundToCube = {
      grabbed: player.isLedgeClinging(),
      id: player.ledgeCling?.id ?? null,
    };

    return {
      platformCount: game.platformingPlatforms.length,
      jumpedOffCube,
      lowLanding,
      middleLanding,
      climbedFromLow,
      fullGapJump,
      shortGapJump,
      middleToCube,
      groundToCube,
      debugFrontZ: debug.center.z - debug.halfDepth,
      lowTopY: low.topY,
      highTopY: high.topY,
      middleTopY: middle.topY,
      gapInnerX: gap.center.x - gap.halfWidth,
    };
  });

  expect(result.platformCount).toBeGreaterThanOrEqual(4);
  expect(result.jumpedOffCube).toMatchObject({ y: 0, state: 'Grounded', clinging: false });
  expect(result.jumpedOffCube.z).toBeLessThan(result.debugFrontZ - 0.5);
  expect(result.lowLanding).toMatchObject({ y: result.lowTopY, state: 'Grounded', clinging: false });
  expect(result.middleLanding).toMatchObject({ y: result.middleTopY, state: 'Grounded', clinging: false });
  expect(result.climbedFromLow.grabbed).toBe(true);
  expect(result.climbedFromLow.id).toContain('campHighClimbDeck');
  expect(result.climbedFromLow.finishedY).toBeCloseTo(result.highTopY, 2);
  expect(result.fullGapJump).toMatchObject({ y: result.highTopY, state: 'Grounded', clinging: false });
  expect(result.fullGapJump.x).toBeGreaterThan(result.gapInnerX);
  expect(result.shortGapJump.grabbed).toBe(false);
  expect(result.shortGapJump.y).toBeLessThan(result.highTopY - 0.5);
  expect(result.middleToCube).toMatchObject({ y: 3, state: 'Grounded', clinging: false });
  expect(result.groundToCube.grabbed).toBe(true);
  expect(result.groundToCube.id).toContain('debug-front-ledge');
});

test('platform debug menu scales jump reach, moon gravity, and spawned blocks', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  await page.keyboard.press('Backquote');
  const panel = page.locator('#pose-debug-panel');
  await expect(panel).toBeVisible();
  await page.getByRole('tab', { name: 'Platforming' }).click();
  await expect(page.locator('#platform-debug-view')).toBeVisible();

  await page.locator('#platform-debug-jump-height').selectOption('triple');
  await page.locator('#platform-debug-gravity').selectOption('moon');
  await page.locator('#platform-debug-width').fill('4');
  await page.locator('#platform-debug-depth').fill('3');
  await page.locator('#platform-debug-height').fill('4.5');
  await page.locator('#platform-debug-distance').fill('7');
  await page.getByRole('button', { name: 'Spawn Block' }).click();
  await expect(page.locator('#platform-debug-count')).toHaveText('1 block');

  const menuState = await page.evaluate(() => ({
    ...window.game.getPlatformDebugState(),
    platform: window.game.debugSpawnedPlatforms[0]
      ? {
        width: window.game.debugSpawnedPlatforms[0].halfWidth * 2,
        depth: window.game.debugSpawnedPlatforms[0].halfDepth * 2,
        height: window.game.debugSpawnedPlatforms[0].topY - window.game.debugSpawnedPlatforms[0].baseY,
      }
      : null,
  }));
  expect(menuState).toMatchObject({
    jumpHeightPreset: 'triple',
    gravityPreset: 'moon',
    jumpHeightMultiplier: 3,
    gravityScale: 0.28,
    spawnedPlatformCount: 1,
    platform: { width: 4, depth: 3, height: 4.5 },
  });
  expect(menuState.jumpHeight).toBeCloseTo(4.95, 2);
  expect(menuState.minimumGrabElevation).toBeCloseTo(4.851, 2);
  expect(menuState.timeToApex).toBeGreaterThan(0.6);

  await page.locator('[data-action="pose-close"]').click();
  await expect(panel).toBeHidden();

  const traversal = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    const forward = new Vector3(0, 0, 1);
    const right = new Vector3(1, 0, 0);

    const resetPlayer = (position, direction, speed = 0) => {
      player.ledgeCling = null;
      player.root.position.copy(position);
      player.modelRoot.position.y = 0;
      player.velocity.copy(direction).multiplyScalar(speed);
      player.velocity.y = 0;
      player.jumpState = 'Grounded';
      player._jumpGroundY = position.y;
      player._jumpBufferTimer = 0;
      player._coyoteTimer = player.jumpSettings.coyoteTime;
      player._landingRecoveryTimer = 0;
      player.animation.actionState = null;
      player.animation.actionTimer = 0;
      player.animation.actionDuration = 0;
      player.lastMoveDirection.copy(direction);
      player.faceDirection(direction);
      game.dungeonController.pendingPlayerJumpOffLanding = null;
      game.dungeonController.lastSafePlayerPosition.copy(position);
    };
    const update = (frames, direction, stopWhen = null) => {
      for (let i = 0; i < frames; i += 1) {
        const options = {
          arenaRadius: game.arenaRadius,
          movementForward: direction,
          movementRight: new Vector3(direction.z, 0, -direction.x),
          groundY: game._getPlayerGroundY(),
        };
        player.update(1 / 60, new Set(['KeyW']), options);
        game.dungeonController.update(1 / 60);
        if (stopWhen?.()) return i + 1;
      }
      return frames;
    };

    const spawn = game.dungeon.playerStart.clone();
    resetPlayer(spawn, forward, 0);
    player.tryJump(new Set(), {
      arenaRadius: game.arenaRadius,
      movementForward: forward,
      movementRight: right,
      groundY: spawn.y,
    });
    let maxY = player.root.position.y;
    let apexFrame = null;
    for (let frame = 0; frame < 240; frame += 1) {
      update(1, forward);
      maxY = Math.max(maxY, player.root.position.y);
      if (apexFrame === null && player.jumpState === 'Falling') apexFrame = frame + 1;
      if (frame > 20 && player.jumpState === 'Grounded') break;
    }

    const jumpable = game.debugSpawnedPlatforms[0];
    resetPlayer(
      new Vector3(jumpable.center.x, jumpable.baseY, jumpable.center.z - jumpable.halfDepth - 0.8),
      forward,
      1,
    );
    player.tryJump(new Set(['KeyW']), {
      arenaRadius: game.arenaRadius,
      movementForward: forward,
      movementRight: right,
      groundY: jumpable.baseY,
    });
    update(300, forward, () => (
      player.jumpState === 'Grounded' && Math.abs(player.root.position.y - jumpable.topY) < 0.05
    ));
    const upgradedLanding = {
      y: player.root.position.y,
      clinging: player.isLedgeClinging(),
      state: player.jumpState,
    };

    game.clearDebugPlatforms();
    resetPlayer(spawn, forward, 0);
    const climbOnly = game.spawnDebugPlatform({ width: 4, depth: 3, height: 5.2, distance: 7 });
    resetPlayer(
      new Vector3(climbOnly.center.x, climbOnly.baseY, climbOnly.center.z - climbOnly.halfDepth - 3.8),
      forward,
      4.35,
    );
    player.tryJump(new Set(['KeyW']), {
      arenaRadius: game.arenaRadius,
      movementForward: forward,
      movementRight: right,
      groundY: climbOnly.baseY,
    });
    update(300, forward, () => player.isLedgeClinging());
    const upgradedGrab = {
      grabbed: player.isLedgeClinging(),
      id: player.ledgeCling?.id ?? null,
      topY: player.ledgeCling?.topY ?? null,
    };

    return {
      maxY,
      apexTime: apexFrame / 60,
      upgradedLanding,
      jumpableTopY: jumpable.topY,
      upgradedGrab,
      climbOnlyTopY: climbOnly.topY,
    };
  });

  expect(traversal.maxY).toBeCloseTo(4.95, 1);
  expect(traversal.apexTime).toBeGreaterThan(0.58);
  expect(traversal.upgradedLanding).toMatchObject({
    y: traversal.jumpableTopY,
    clinging: false,
    state: 'Grounded',
  });
  expect(traversal.upgradedGrab.grabbed).toBe(true);
  expect(traversal.upgradedGrab.id).toContain('debugPlatform2-front-ledge');
  expect(traversal.upgradedGrab.topY).toBeCloseTo(traversal.climbOnlyTopY, 2);
});

test('dodge roll is shorter and crosses short gaps during its opening quarter', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    const forward = new Vector3(0, 0, 1);
    const right = new Vector3(1, 0, 0);
    const platforms = new Map(game.platformingPlatforms.map((platform) => [platform.id, platform]));
    const nearDeck = platforms.get('campHighClimbDeck');
    const farDeck = platforms.get('campHighGapDeck');

    const resetPlayer = (position, direction) => {
      player.ledgeCling = null;
      player.root.position.copy(position);
      player.modelRoot.position.y = 0;
      player.velocity.set(0, 0, 0);
      player.jumpState = 'Grounded';
      player._jumpGroundY = position.y;
      player.animation.actionState = null;
      player.animation.actionTimer = 0;
      player.animation.actionDuration = 0;
      player.movementLockTimer = 0;
      player.movementLockMultiplier = 1;
      player.lastMoveDirection.copy(direction);
      player.faceDirection(direction);
      game.dungeonController.pendingPlayerJumpOffLanding = null;
      game.dungeonController.lastSafePlayerPosition.copy(position);
    };
    const movementOptions = (direction) => ({
      arenaRadius: game.arenaRadius,
      movementForward: direction,
      movementRight: new Vector3(direction.z, 0, -direction.x),
      groundY: game._getPlayerGroundY(),
    });

    const distanceStart = game.dungeon.playerStart.clone();
    resetPlayer(distanceStart, forward);
    player.tryDodgeRoll(new Set(['KeyW']), movementOptions(forward));
    while (player.animation.actionState === 'dodgeRoll') {
      player.update(1 / 120, new Set(), movementOptions(forward));
    }
    const rollDistance = Math.hypot(
      player.root.position.x - distanceStart.x,
      player.root.position.z - distanceStart.z,
    );

    const gapDirection = new Vector3(1, 0, 0);
    const gapStart = new Vector3(
      nearDeck.center.x + nearDeck.halfWidth - 0.08,
      nearDeck.topY,
      nearDeck.center.z,
    );
    resetPlayer(gapStart, gapDirection);
    player.tryDodgeRoll(new Set(['KeyW']), movementOptions(gapDirection));

    const samples = [{
      progress: player.animation.getActionProgress(),
      airborne: player.isDodgeRollAirborne(),
      x: player.root.position.x,
    }];
    for (let frame = 0; frame < 30 && player.animation.actionState === 'dodgeRoll'; frame += 1) {
      player.update(1 / 120, new Set(), movementOptions(gapDirection));
      game.dungeonController.update(1 / 120);
      samples.push({
        progress: player.animation.getActionProgress(),
        airborne: player.isDodgeRollAirborne(),
        x: player.root.position.x,
        floorY: game.getPlatformFloorElevation(player.root.position),
      });
      if (player.animation.getActionProgress() > 0.3) break;
    }

    const airborneSamples = samples.filter((sample) => sample.progress <= 0.25);
    const groundedRollSamples = samples.filter((sample) => sample.progress > 0.25);
    const farDeckNearEdge = farDeck.center.x - farDeck.halfWidth;
    const crossedSample = samples.find((sample) => (
      sample.x >= farDeckNearEdge - 0.08
      && sample.floorY === farDeck.topY
    ));

    return {
      rollDistance,
      airborneSamples,
      groundedRollSamples,
      crossedSample: crossedSample ?? null,
      gapWidth: farDeckNearEdge - (nearDeck.center.x + nearDeck.halfWidth),
      farDeckTopY: farDeck.topY,
    };
  });

  expect(result.rollDistance).toBeGreaterThan(7.5);
  expect(result.rollDistance).toBeLessThan(8.1);
  expect(result.gapWidth).toBeCloseTo(1.1, 2);
  expect(result.airborneSamples.length).toBeGreaterThan(2);
  expect(result.airborneSamples.every(({ airborne }) => airborne)).toBe(true);
  expect(result.groundedRollSamples.length).toBeGreaterThan(0);
  expect(result.groundedRollSamples.every(({ airborne }) => !airborne)).toBe(true);
  expect(result.crossedSample).toMatchObject({ floorY: result.farDeckTopY });
  expect(result.crossedSample.progress).toBeLessThanOrEqual(0.25);
});

test('a descending edge contact catches low ledges without making normal jumps sticky', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    const ledge = game.platformingLedgeCandidates.find((candidate) => (
      candidate.id === 'campLowJumpDeck-front-ledge'
    ));
    const elevatedLedge = {
      id: 'elevated-difference-ledge',
      center: new Vector3(18, 8, 18),
      normal: new Vector3(0, 0, -1),
      axis: new Vector3(1, 0, 0),
      halfSpan: 2,
      topY: 8,
    };
    const upgradedLedge = {
      ...elevatedLedge,
      id: 'upgraded-range-ledge',
      center: new Vector3(18, 15, 18),
      topY: 15,
    };
    const defaultMaximumGrabElevation = game.getPlatformDebugState().maximumGrabElevation;

    const attempt = ({
      candidate = ledge,
      faceDistance,
      verticalDistance,
      jumpState,
      velocityY,
      horizontalSpeed = 0,
      progress,
      jumpStartY = 0,
      jumpReachHeight = player.getJumpReachHeight(),
    }) => {
      const jumpDirection = candidate.normal.clone().multiplyScalar(-1);
      player.ledgeCling = null;
      player.jumpState = jumpState;
      player.velocity.copy(jumpDirection).multiplyScalar(horizontalSpeed);
      player.velocity.y = velocityY;
      player.jumpStartY = jumpStartY;
      player.jumpDirection.copy(jumpDirection);
      player.lastMoveDirection.copy(jumpDirection);
      player.root.position.copy(candidate.center)
        .addScaledVector(candidate.normal, faceDistance);
      player.root.position.y = candidate.topY + verticalDistance;

      const grabbed = game._tryResolveDebugLedgeCling({
        player,
        root: player.root,
        jumpDirection,
        progress,
        jumpStartY,
        jumpReachHeight,
      }, [candidate]);
      return {
        grabbed,
        id: player.ledgeCling?.id ?? null,
        state: player.ledgeCling?.state ?? null,
        autoClimb: player.ledgeCling?.autoClimb ?? false,
        rootY: player.root.position.y,
      };
    };

    return {
      ordinaryLowApproach: attempt({
        faceDistance: 0.1,
        verticalDistance: 0.5,
        jumpState: 'Falling',
        velocityY: -1,
        progress: 0.7,
      }),
      risingAtLip: attempt({
        faceDistance: 0.1,
        verticalDistance: 0.05,
        jumpState: 'Rising',
        velocityY: 1,
        progress: 0.7,
      }),
      fallingAwayFromLip: attempt({
        faceDistance: 0.35,
        verticalDistance: 0.05,
        jumpState: 'Falling',
        velocityY: -1,
        progress: 1,
      }),
      lateFallingLipContact: attempt({
        faceDistance: 0.1,
        verticalDistance: 0.05,
        jumpState: 'Falling',
        velocityY: -1,
        progress: 1,
      }),
      clearingLowEdge: attempt({
        faceDistance: 0.1,
        verticalDistance: 0.05,
        jumpState: 'Falling',
        velocityY: -1,
        horizontalSpeed: 4.35,
        progress: 1,
      }),
      elevatedSmallDifference: attempt({
        candidate: elevatedLedge,
        faceDistance: 0.1,
        verticalDistance: -1.6,
        jumpState: 'Falling',
        velocityY: -4,
        progress: 1,
        jumpStartY: 6.7,
      }),
      elevatedOutsideLipBand: attempt({
        candidate: elevatedLedge,
        faceDistance: 0.35,
        verticalDistance: -1.6,
        jumpState: 'Falling',
        velocityY: -4,
        progress: 1,
        jumpStartY: 6.7,
      }),
      upgradedScaledRange: attempt({
        candidate: upgradedLedge,
        faceDistance: 0.1,
        verticalDistance: -8,
        jumpState: 'Falling',
        velocityY: -5,
        progress: 1,
        jumpStartY: 6.7,
        jumpReachHeight: player.getJumpReachHeight() * 3,
      }),
      beyondDefaultScaledRange: attempt({
        candidate: upgradedLedge,
        faceDistance: 0.1,
        verticalDistance: -3,
        jumpState: 'Falling',
        velocityY: -5,
        progress: 1,
        jumpStartY: upgradedLedge.topY - defaultMaximumGrabElevation - 0.15,
      }),
      autoClimbMotion: (() => {
        const started = attempt({
          faceDistance: 0.1,
          verticalDistance: -1,
          jumpState: 'Falling',
          velocityY: -4,
          progress: 1,
        });
        const startY = player.root.position.y;
        let previousY = startY;
        let minimumDelta = 0;
        for (let frame = 0; frame < 90 && player.isLedgeClinging(); frame += 1) {
          player._updateLedgeClingState(1 / 60, new Set(), { groundY: 0 });
          minimumDelta = Math.min(minimumDelta, player.root.position.y - previousY);
          previousY = player.root.position.y;
        }
        return {
          started,
          startY,
          finalY: player.root.position.y,
          minimumDelta,
          completed: !player.isLedgeClinging(),
        };
      })(),
      lowLedgeHeight: ledge.topY,
      normalGrabThreshold: player.getJumpReachHeight() * 0.98,
    };
  });

  expect(result.lowLedgeHeight).toBeLessThan(result.normalGrabThreshold);
  expect(result.ordinaryLowApproach.grabbed).toBe(false);
  expect(result.risingAtLip.grabbed).toBe(false);
  expect(result.fallingAwayFromLip.grabbed).toBe(false);
  expect(result.lateFallingLipContact).toMatchObject({
    grabbed: true,
    id: null,
    state: null,
    autoClimb: false,
  });
  expect(result.lateFallingLipContact.rootY).toBeCloseTo(result.lowLedgeHeight + 0.02, 3);
  expect(result.clearingLowEdge.grabbed).toBe(false);
  expect(result.elevatedSmallDifference).toMatchObject({
    grabbed: true,
    id: null,
    state: null,
    autoClimb: false,
  });
  expect(result.elevatedOutsideLipBand.grabbed).toBe(false);
  expect(result.upgradedScaledRange).toMatchObject({
    grabbed: true,
    id: 'upgraded-range-ledge',
    state: 'jumpingToHanging',
    autoClimb: false,
  });
  expect(result.beyondDefaultScaledRange.grabbed).toBe(false);
  expect(result.autoClimbMotion.started).toMatchObject({
    grabbed: true,
    state: null,
    autoClimb: false,
  });
  expect(result.autoClimbMotion.minimumDelta).toBeGreaterThanOrEqual(-0.001);
  expect(result.autoClimbMotion.finalY).toBeCloseTo(result.autoClimbMotion.startY, 5);
  expect(result.autoClimbMotion.completed).toBe(true);
});

test('pressing S from a ledge plays the wall jump and hands off to falling', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const player = game.player;
    const platform = game.debugLedgePlatform;
    const Vector3 = player.root.position.constructor;
    const forward = new Vector3(0, 0, 1);
    const right = new Vector3(1, 0, 0);
    const frontZ = platform.center.z - platform.halfDepth;
    const movementOptions = () => ({
      arenaRadius: game.arenaRadius,
      movementForward: forward,
      movementRight: right,
      groundY: game._getPlayerGroundY(),
    });
    const update = (input = new Set()) => {
      player.update(1 / 60, input, movementOptions());
      game.dungeonController.update(1 / 60);
    };

    player.ledgeCling = null;
    player.root.position.set(platform.center.x, platform.baseY, frontZ - 0.42);
    player.velocity.set(0, 0, 0);
    player.jumpState = 'Grounded';
    player.lastMoveDirection.copy(forward);
    player.faceDirection(forward);
    game.dungeonController.lastSafePlayerPosition.copy(player.root.position);
    game._tryResolveDebugLedgeCling({
      player,
      root: player.root,
      jumpDirection: forward,
      progress: 0.5,
      jumpStartY: platform.baseY,
      jumpReachHeight: player.getJumpReachHeight(),
    });

    for (let frame = 0; frame < 240 && player.ledgeCling?.state !== 'hangingIdle'; frame += 1) {
      update();
    }

    const ledgeNormal = player.ledgeCling.normal.clone();
    const hangPosition = player.root.position.clone();
    update(new Set(['KeyS']));
    const started = {
      ledgeReleased: !player.isLedgeClinging(),
      actionState: player.animation.actionState,
      jumpState: player.jumpState,
    };

    for (let frame = 0; frame < 34 && player.animation.actionState === 'wallJump'; frame += 1) {
      update();
    }
    const midAction = {
      actionState: player.animation.actionState,
      activeClipKey: player.externalRig.activeClipKey,
      outwardDistance: player.root.position.clone().sub(hangPosition).dot(ledgeNormal),
      verticalRise: player.root.position.y - hangPosition.y,
    };

    for (let frame = 0; frame < 120 && player.animation.actionState === 'wallJump'; frame += 1) {
      update();
    }
    const handoff = {
      actionState: player.animation.actionState,
      jumpState: player.jumpState,
      ledgeReleased: !player.isLedgeClinging(),
      outwardVelocity: player.velocity.dot(ledgeNormal),
      verticalVelocity: player.velocity.y,
      outwardDistance: player.root.position.clone().sub(hangPosition).dot(ledgeNormal),
      rootY: player.root.position.y,
    };

    for (let frame = 0; frame < 240 && player.jumpState !== 'Grounded'; frame += 1) {
      update();
    }
    const landed = {
      jumpState: player.jumpState,
      y: player.root.position.y,
      ledgeReleased: !player.isLedgeClinging(),
    };
    const wallJumpMetadata = player.externalRig.animationMetadata.get('jumpFromWall');

    return {
      clipLoaded: player.externalRig.animationClips.has('jumpFromWall'),
      clipDuration: wallJumpMetadata?.duration ?? null,
      hasBakedRootMotion: Boolean(wallJumpMetadata?.rootMotion),
      started,
      midAction,
      handoff,
      landed,
    };
  });

  expect(result.clipLoaded).toBe(true);
  expect(result.clipDuration).toBeCloseTo(1.125, 2);
  expect(result.hasBakedRootMotion).toBe(true);
  expect(result.started).toMatchObject({
    ledgeReleased: true,
    actionState: 'wallJump',
    jumpState: 'Grounded',
  });
  expect(result.midAction.actionState).toBe('wallJump');
  expect(result.midAction.activeClipKey).toBe('jumpFromWall');
  expect(result.midAction.outwardDistance).toBeGreaterThan(0.2);
  expect(result.midAction.verticalRise).toBeGreaterThan(0.15);
  expect(result.handoff).toMatchObject({
    actionState: null,
    jumpState: 'Falling',
    ledgeReleased: true,
  });
  expect(result.handoff.outwardDistance).toBeGreaterThan(1.3);
  expect(result.handoff.outwardVelocity).toBeGreaterThan(2);
  expect(result.handoff.verticalVelocity).toBeLessThan(0);
  expect(result.handoff.rootY).toBeGreaterThan(0.4);
  expect(result.landed).toMatchObject({
    jumpState: 'Grounded',
    y: 0,
    ledgeReleased: true,
  });
});

test('generated factory rooms expose validated vertical plans and elevation-matched portals', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('/?startupWorld=dungeon');
  const container = page.locator('#game-container');
  await expect
    .poll(
      async () => container.getAttribute('data-browser-test-ready'),
      { timeout: 20000 },
    )
    .toBe('true');

  const result = await page.evaluate(() => {
    const dungeon = window.game.dungeon;
    const functionalRooms = dungeon.rooms.filter((room) => !['hub', 'camp'].includes(room.type));
    const elevatedConnections = dungeon.connectionPlans.filter((connection) => connection.level > 0);
    const floorKeys = new Set(dungeon.floorTiles.map((tile) => `${tile.x},${tile.z}@${tile.level ?? 0}`));

    return {
      accepted: dungeon.progression.validation.accepted,
      platformability: dungeon.progression.validation.platformability,
      generationAttempts: dungeon.generationAttempts,
      rooms: functionalRooms.map((room) => ({
        id: room.id,
        purpose: room.purpose,
        mood: room.mood,
        story: room.environmentalStory,
        ceilingHeight: room.ceilingHeight,
        tierCount: room.numberOfVerticalTiers,
        platformCount: room.platformNodes.length,
        hasPurposefulPlatform: room.platformNodes.every((platform) => (
          Boolean(platform.purpose)
          && ['jump', 'ledge_climb'].includes(platform.requiredTraversalAction)
        )),
      })),
      connections: elevatedConnections.map((connection) => ({
        id: connection.id,
        fromElevation: connection.fromSocket.elevation,
        toElevation: connection.toSocket.elevation,
        fromSocketExists: floorKeys.has(connection.fromSocket.floorKey),
        toSocketExists: floorKeys.has(connection.toSocket.floorKey),
        bridgeExists: connection.bridgePath.every((point) => (
          floorKeys.has(`${point.x},${point.z}@${connection.level}`)
        )),
      })),
      verticalPortalCount: dungeon.verticalPortals.length,
      jumpPlatforms: dungeon.platforms
        .filter((platform) => platform.generated && platform.requiredTraversalAction === 'jump')
        .map((platform) => ({
          id: platform.id,
          purpose: platform.purpose,
          blocksBelow: platform.blocksBelow,
          dropSpaceId: platform.dropSpaceId ?? null,
        })),
      ledgeSurfaces: dungeon.platforms
        .filter((platform) => platform.generated && platform.requiredTraversalAction === 'ledge_climb')
        .map((platform) => ({
          id: platform.id,
          purpose: platform.purpose,
          blocksBelow: platform.blocksBelow,
          dropSpaceId: platform.dropSpaceId ?? null,
        })),
      doorPortalPairs: dungeon.doors.map((door) => ({
        id: door.id,
        exitElevation: door.exitElevation,
        entranceElevation: door.entranceElevation,
        hasFromPortal: Boolean(door.fromPortal),
        hasToPortal: Boolean(door.toPortal),
      })),
      closedDoorCollision: dungeon.doors
        .filter((door) => door.closed)
        .map((door) => {
          const Vector3 = door.position.constructor;
          const across = (offset) => new Vector3(
            door.position.x + (door.alongX ? 0 : offset),
            door.baseY,
            door.position.z + (door.alongX ? offset : 0),
          );
          return {
            id: door.id,
            corridorSamplesBlocked: [-0.48, 0, 0.48].every((scale) => (
              window.game.dungeonController._isPositionInsideClosedDoor(
                across(scale * dungeon.tileSize),
                door,
              )
            )),
            outsideCorridorClear: !window.game.dungeonController._isPositionInsideClosedDoor(
              across(dungeon.tileSize * 0.8),
              door,
            ),
            upperTierClear: !window.game.dungeonController._isPositionInsideClosedDoor(
              new Vector3(door.position.x, door.baseY + door.collisionHeight + 0.5, door.position.z),
              door,
            ),
          };
        }),
    };
  });

  expect(result.accepted).toBe(true);
  expect(result.generationAttempts).toBeGreaterThanOrEqual(1);
  expect(result.platformability.reachableNodeCount).toBeGreaterThan(1000);
  expect(result.platformability.platformNodeCount).toBeGreaterThanOrEqual(result.rooms.length);
  expect(result.rooms.every((room) => (
    room.purpose
    && room.mood
    && room.story
    && room.ceilingHeight >= 8
    && room.tierCount >= 2
    && room.platformCount >= 1
    && room.hasPurposefulPlatform
  ))).toBe(true);
  expect(result.connections.length).toBeGreaterThanOrEqual(2);
  expect(result.connections.every((connection) => (
    connection.fromElevation === connection.toElevation
    && connection.fromSocketExists
    && connection.toSocketExists
    && connection.bridgeExists
  ))).toBe(true);
  expect(result.verticalPortalCount).toBe(result.connections.length * 2);
  expect(result.jumpPlatforms.length).toBeGreaterThanOrEqual(result.rooms.length);
  expect(result.jumpPlatforms.every((platform) => platform.purpose && platform.blocksBelow === true)).toBe(true);
  expect(result.ledgeSurfaces.filter((platform) => (
    platform.purpose === 'matched_elevation_portal_landing'
  ))).toHaveLength(result.connections.length * 2);
  expect(result.ledgeSurfaces.length).toBeGreaterThanOrEqual(result.connections.length * 2 + 2);
  expect(result.ledgeSurfaces.every((platform) => platform.purpose)).toBe(true);
  expect(result.ledgeSurfaces.filter((platform) => !platform.dropSpaceId)
    .every((platform) => platform.blocksBelow === false)).toBe(true);
  expect(result.ledgeSurfaces.filter((platform) => platform.dropSpaceId)).toHaveLength(2);
  expect(result.ledgeSurfaces.filter((platform) => platform.dropSpaceId)
    .every((platform) => platform.blocksBelow === true)).toBe(true);
  expect(result.doorPortalPairs.every((door) => (
    door.exitElevation === door.entranceElevation
    && door.hasFromPortal
    && door.hasToPortal
  ))).toBe(true);
  expect(result.closedDoorCollision.length).toBeGreaterThan(0);
  expect(result.closedDoorCollision.every((door) => (
    door.corridorSamplesBlocked
    && door.outsideCorridorClear
    && door.upperTierClear
  ))).toBe(true);
});

test('industrial rooms and connectors use solid volumetric prefabs, large slopes, and a keycard pyramid', async ({ page }) => {
  test.setTimeout(45000);
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
    const { dungeon } = game;
    const requiredObjectNames = [
      'waterTankCylindricalBody',
      'pumpTurbineHousing',
      'crankHandwheel',
      'engineMainCrankcase',
      'openProcessingVatWall',
      'massiveAlienMonolith',
      'girderFrameHeader',
      'industrialCylinderArch',
      'chainLinkFenceMesh',
      'automaticSlidingDoorPanelLeft',
      'automaticSlidingDoorPanelRight',
    ];
    const forbiddenFallbackRailNames = new Set([
      'coolantBalconyInnerRail',
      'coolantBalconyOuterRail',
      'machineLeftCatwalkRail',
      'machineRightCatwalkRail',
      'alienServerNorthCatwalkRail',
      'alienServerEastCatwalkRail',
    ]);
    const objectNameCounts = Object.fromEntries(requiredObjectNames.map((name) => [name, 0]));
    const largePlatformMasses = [];
    const largeSlopes = [];
    const architecturalAssemblies = [];
    const architecturalMasses = [];
    const railRuns = [];
    const railPostKeys = new Set();
    let forbiddenFallbackRailCount = 0;
    let pyramidLayerCount = 0;
    let pyramidCircuitStepCount = 0;
    let pyramidGuardianDecalCount = 0;
    let shrineFocalPillarCount = 0;
    dungeon.group.traverse((object) => {
      if (Object.hasOwn(objectNameCounts, object.name)) {
        objectNameCounts[object.name] += 1;
      }
      if (object.name?.startsWith('solidPurposePlatformMass_')) {
        largePlatformMasses.push({
          width: object.geometry?.parameters?.width ?? 0,
          depth: object.geometry?.parameters?.depth ?? 0,
        });
      }
      if (object.name === 'largeTexturedIndustrialSlopeVolume') {
        largeSlopes.push({
          rampTileCount: object.userData.rampTileCount,
          texturedWallToFloor: object.userData.texturedWallToFloor,
        });
      }
      if (object.name?.startsWith('reverentMechanicalPyramidLayer')) {
        pyramidLayerCount += 1;
      }
      if (object.name?.startsWith('pyramidProcessionalCircuitStep_')) {
        pyramidCircuitStepCount += 1;
      }
      if (object.name?.startsWith('pyramidReaverbotGuardianEyeDecal_')) {
        pyramidGuardianDecalCount += 1;
      }
      if (object.name?.startsWith('shrineFocalPillar_')) {
        shrineFocalPillarCount += 1;
      }
      if (object.name?.startsWith('solidArchitecturalDeckAssembly_')) {
        architecturalAssemblies.push({
          id: object.name.replace('solidArchitecturalDeckAssembly_', ''),
          roomId: object.userData.roomId,
          surface: object.userData.surface,
          solidTileCount: object.userData.solidTileCount,
          underpassTileCount: object.userData.underpassTileCount,
          segmentCount: object.userData.segmentCount,
        });
      }
      if (object.name?.startsWith('solidArchitecturalDeckMass_')) {
        const height = object.geometry?.parameters?.height ?? 0;
        architecturalMasses.push({
          id: object.userData.massGroupId,
          width: object.geometry?.parameters?.width ?? 0,
          depth: object.geometry?.parameters?.depth ?? 0,
          height,
          bottomY: object.position.y - height * 0.5,
          topY: object.position.y + height * 0.5,
        });
      }
      if (object.userData.factoryRailRun) {
        railRuns.push({
          horizontal: object.userData.horizontal,
          line: object.userData.line,
          startEndpoint: object.userData.startEndpoint,
          endEndpoint: object.userData.endEndpoint,
          elevation: object.userData.elevation,
        });
      }
      if (object.userData.factoryRailPost) {
        railPostKeys.add([
          object.position.x.toFixed(3),
          object.position.z.toFixed(3),
          Number(object.userData.elevation).toFixed(3),
        ].join(','));
      }
      if (forbiddenFallbackRailNames.has(object.name)) {
        forbiddenFallbackRailCount += 1;
      }
    });

    const missingRailEndpoints = [];
    const railEndpointKey = (run, endpoint) => [
      (run.horizontal ? endpoint : run.line) * dungeon.tileSize,
      (run.horizontal ? run.line : endpoint) * dungeon.tileSize,
      run.elevation,
    ].map((value) => Number(value).toFixed(3)).join(',');
    for (const run of railRuns) {
      for (const endpoint of [run.startEndpoint, run.endEndpoint]) {
        const key = railEndpointKey(run, endpoint);
        if (!railPostKeys.has(key)) {
          missingRailEndpoints.push(key);
        }
      }
    }

    const keycardRoom = dungeon.rooms.find((room) => room.id === 'keycardRoom');
    const pyramidCenter = keycardRoom.mechanicalPyramidCenter;
    const keycard = dungeon.keycards.find((candidate) => candidate.keycardId === 'Keycard_Alpha');
    const summitTiles = dungeon.floorTiles.filter((tile) => (
      tile.roomId === keycardRoom.id && tile.surface === 'mechanicalPyramidSummit'
    ));
    const processionalStepTiles = dungeon.floorTiles.filter((tile) => (
      tile.roomId === keycardRoom.id && tile.surface === 'mechanicalPyramidProcessionalStep'
    ));
    const pyramidTerraceTiles = dungeon.floorTiles.filter((tile) => (
      tile.roomId === keycardRoom.id && tile.surface === 'mechanicalPyramidTerrace'
    ));
    const pyramidSidePlatforms = dungeon.floorTiles.filter((tile) => (
      tile.roomId === keycardRoom.id && tile.surface === 'mechanicalPyramidSidePlatform'
    ));
    const keycardEncounter = dungeon.encounters.find((encounter) => encounter.id === 'keycardGuard');
    const connectorTiles = dungeon.floorTiles.filter((tile) => tile.connectorId);
    const roomById = new Map(dungeon.rooms.map((room) => [room.id, room]));
    const groundExplorationPlans = dungeon.connectionPlans.filter((plan) => (
      plan.level === 0 && (plan.bridgePath?.length ?? 0) >= 5
      && !['hub', 'camp'].includes(roomById.get(plan.fromRoomId)?.type)
      && !['hub', 'camp'].includes(roomById.get(plan.toRoomId)?.type)
    ));
    const progressionConnections = new Map(
      dungeon.progression.roomConnections
        .flatMap((connection) => connection.routes ?? [])
        .map((route) => [route.id, route]),
    );
    const solidPrefabLabels = dungeon.solidZones
      .filter((zone) => zone.fromProceduralPrefab)
      .map((zone) => zone.label);
    const architecturalPlatforms = dungeon.platforms.filter((platform) => platform.architecturalMass);
    const architecturalTiles = dungeon.floorTiles.filter((tile) => tile.massGroupId);
    const openUnderpassTiles = architecturalTiles.filter((tile) => tile.supportStyle === 'open_underpass');
    const architecturalTileCounts = {};
    for (const tile of architecturalTiles) {
      architecturalTileCounts[tile.massGroupId] ??= { solid: 0, underpass: 0 };
      architecturalTileCounts[tile.massGroupId][
        tile.supportStyle === 'solid_mass' ? 'solid' : 'underpass'
      ] += 1;
    }
    const architecturalMassCentersBlocked = architecturalPlatforms.every((platform) => (
      game._isPositionInsidePlatformBlock(platform, {
        x: platform.center.x,
        y: platform.baseY + (platform.topY - platform.baseY) * 0.5,
        z: platform.center.z,
      }, 0)
    ));
    const unblockedArchitecturalPlatformIds = architecturalPlatforms
      .filter((platform) => !game._isPositionInsidePlatformBlock(platform, {
        x: platform.center.x,
        y: platform.baseY + (platform.topY - platform.baseY) * 0.5,
        z: platform.center.z,
      }, 0))
      .map((platform) => ({ id: platform.id, baseY: platform.baseY, topY: platform.topY }));
    const openUnderpassesClear = openUnderpassTiles.every((tile) => (
      architecturalPlatforms.every((platform) => !game._isPositionInsidePlatformBlock(platform, {
        x: tile.x * dungeon.tileSize,
        y: 0.5,
        z: tile.z * dungeon.tileSize,
      }, 0))
    ));
    const doorClearanceOverlapCount = dungeon.doors.reduce((count, door) => {
      const clearanceSamples = [-0.6, 0, 0.6].map((offset) => ({
        x: door.position.x + (door.alongX ? 0 : offset * dungeon.tileSize),
        z: door.position.z + (door.alongX ? offset * dungeon.tileSize : 0),
      }));
      return count + clearanceSamples.filter((sample) => architecturalPlatforms.some((platform) => (
        Math.abs(sample.x - platform.center.x) <= platform.halfWidth
        && Math.abs(sample.z - platform.center.z) <= platform.halfDepth
      ))).length;
    }, 0);
    const doorDeckSlabOverlapCount = dungeon.doors.reduce((count, door) => {
      const clearanceSamples = [-0.6, 0, 0.6].map((offset) => ({
        x: Math.round(door.position.x / dungeon.tileSize) + (door.alongX ? 0 : Math.sign(offset)),
        z: Math.round(door.position.z / dungeon.tileSize) + (door.alongX ? Math.sign(offset) : 0),
      }));
      return count + clearanceSamples.filter((sample) => architecturalTiles.some((tile) => (
        tile.x === sample.x && tile.z === sample.z
      ))).length;
    }, 0);
    const closedDoor = dungeon.doors.find((door) => door.closed);
    const axis = closedDoor.slidingAxis;
    const closedOffsets = {
      left: closedDoor.leftPanel.position[axis],
      right: closedDoor.rightPanel.position[axis],
      rootY: closedDoor.object.position.y,
    };
    closedDoor.closed = false;
    game.dungeonController._updateDoorVisuals(1);

    return {
      accepted: dungeon.progression.validation.accepted,
      objectNameCounts,
      solidPrefabLabels,
      largePlatformMasses,
      largeSlopes,
      architecturalAssemblies,
      architecturalMasses,
      architecturalTileCounts,
      architecturalPlatformCount: architecturalPlatforms.length,
      architecturalMassCentersBlocked,
      unblockedArchitecturalPlatformIds,
      architecturalPlatformsDisableLedgeCandidates: architecturalPlatforms.every((platform) => (
        platform.createsLedgeCandidates === false
      )),
      generatedArchitecturalLedgeCandidateCount: game.platformingLedgeCandidates.filter((candidate) => (
        candidate.id?.startsWith('generatedArchitecturalMass_')
      )).length,
      openUnderpassTileCount: openUnderpassTiles.length,
      openUnderpassesClear,
      doorClearanceOverlapCount,
      doorDeckSlabOverlapCount,
      unexpectedArchitecturalSurfaceCount: architecturalTiles.filter((tile) => tile.surface !== 'secondFloor').length,
      reveredDaisMassTileCount: dungeon.floorTiles.filter((tile) => (
        tile.surface === 'refractorDais' && tile.massGroupId
      )).length,
      railRunCount: railRuns.length,
      railPostCount: railPostKeys.size,
      missingRailEndpoints,
      forbiddenFallbackRailCount,
      pyramidLayerCount,
      pyramidCircuitStepCount,
      pyramidGuardianDecalCount,
      shrineFocalPillarCount,
      summitTileCount: summitTiles.length,
      processionalStepTileCount: processionalStepTiles.length,
      pyramidTerraceTileCount: pyramidTerraceTiles.length,
      pyramidSidePlatformCount: pyramidSidePlatforms.length,
      pyramidMaxElevation: Math.max(...summitTiles.map((tile) => tile.elevation ?? 0)),
      pyramidSummitCollisionStable: summitTiles.every((tile) => {
        const world = new keycard.position.constructor(
          tile.x * dungeon.tileSize,
          (tile.elevation ?? 0) + 0.05,
          tile.z * dungeon.tileSize,
        );
        const resolved = game.dungeonController.getFloorTileAt(world, { allowClosest: true });
        const column = game.dungeonController.floorTilesByColumn.get(`${tile.x},${tile.z}`) ?? [];
        return resolved?.surface === 'mechanicalPyramidSummit'
          && Math.abs((resolved.elevation ?? 0) - tile.elevation) < 0.001
          && column.filter((candidate) => candidate.surface === 'mechanicalPyramidSummit').length === 1;
      }),
      pyramidEnemySpawnPoints: keycardEncounter.spawnPoints.map((point) => ({
        x: point.x / dungeon.tileSize,
        y: point.y,
        z: point.z / dungeon.tileSize,
      })),
      pyramidTinyStepAllowance: [...processionalStepTiles, ...pyramidTerraceTiles].every((tile) => (
        tile.groundedStepTransitionHeight >= 0.55
        && tile.groundedStepTransitionHeight < 1.1
      )),
      pyramidEncounterUsesSummitTrigger: Boolean(keycardEncounter.triggerZone)
        && Math.abs(keycardEncounter.triggerZone.position.x - pyramidCenter.x * dungeon.tileSize) < 0.01
        && Math.abs(keycardEncounter.triggerZone.position.z - pyramidCenter.z * dungeon.tileSize) < 0.01
        && Math.abs(keycardEncounter.triggerZone.position.y - pyramidCenter.elevation) < 0.01,
      keycardBarrierPresent: keycard.barrierObject?.name === 'keycardEncounterProtectionBarrier'
        && keycard.protectedByEncounterId === keycardEncounter.id,
      keycardOnPyramid: Boolean(pyramidCenter && keycard)
        && Math.abs(keycard.position.x - pyramidCenter.x * dungeon.tileSize) < 0.01
        && Math.abs(keycard.position.z - pyramidCenter.z * dungeon.tileSize) < 0.01
        && Math.abs(keycard.position.y - pyramidCenter.elevation) < 0.01,
      connectorGalleryTileCount: connectorTiles.length,
      explorationAlcoveCount: connectorTiles.filter((tile) => tile.connectorZone === 'exploration_alcove').length,
      serviceLaneCount: connectorTiles.filter((tile) => tile.connectorZone === 'service_lane').length,
      explorationPlans: groundExplorationPlans.map((plan) => ({
        id: plan.id,
        beatCount: plan.explorationBeats?.length ?? 0,
        progressionBeatCount: progressionConnections.get(plan.id)?.explorationBeats?.length ?? 0,
      })),
      doorSlidesLaterally: closedDoor.leftPanel.position[axis] < closedOffsets.left
        && closedDoor.rightPanel.position[axis] > closedOffsets.right,
      doorRootStaysAtElevation: Math.abs(closedDoor.object.position.y - closedOffsets.rootY) < 0.001,
      solidPurposePlatformCount: dungeon.platforms.filter((platform) => (
        platform.generated && platform.solidVolume && platform.blocksBelow
      )).length,
      functionalRoomCount: dungeon.rooms.filter((room) => !['hub', 'camp'].includes(room.type)).length,
    };
  });

  expect(result.accepted).toBe(true);
  expect(Object.values(result.objectNameCounts).every((count) => count > 0)).toBe(true);
  for (const labelPattern of [/tank/i, /pump/i, /crank/i, /engine/i, /vat/i, /monolith/i, /girder/i, /arch/i, /fence/i]) {
    expect(result.solidPrefabLabels.some((label) => labelPattern.test(label))).toBe(true);
  }
  expect(result.largePlatformMasses.length).toBeGreaterThanOrEqual(7);
  expect(result.largePlatformMasses.filter((platform) => (
    platform.width > 4.5 && platform.depth > 4.5
  )).length).toBeGreaterThanOrEqual(7);
  const expectedLegacyArchitecturalTileRanges = {
    enemyNest_rearStructuralMass: { min: 36, max: 39 },
    conveyorRoom_sideStructuralMass: { min: 59, max: 68 },
  };
  expect(result.architecturalAssemblies.length).toBeGreaterThanOrEqual(15);
  for (const [id, expectedRange] of Object.entries(expectedLegacyArchitecturalTileRanges)) {
    const assembly = result.architecturalAssemblies.find((candidate) => candidate.id === id);
    const counts = result.architecturalTileCounts[id];
    const tileCount = counts.solid + counts.underpass;
    expect(assembly).toBeTruthy();
    expect(assembly.surface).toBe('secondFloor');
    expect(assembly.solidTileCount).toBeGreaterThan(0);
    expect(assembly.segmentCount).toBeGreaterThan(0);
    expect(assembly.solidTileCount + assembly.underpassTileCount).toBe(tileCount);
    expect(tileCount).toBeGreaterThanOrEqual(expectedRange.min);
    expect(tileCount).toBeLessThanOrEqual(expectedRange.max);
  }
  expect(result.architecturalMasses.length).toBe(result.architecturalPlatformCount);
  const legacyArchitecturalMasses = result.architecturalMasses.filter((mass) => (
    Object.hasOwn(expectedLegacyArchitecturalTileRanges, mass.id)
  ));
  expect(legacyArchitecturalMasses.every((mass) => (
    mass.width > 2 && mass.depth > 2 && mass.height > 3.5
    && mass.bottomY <= 0.01 && mass.topY > 3.7
  ))).toBe(true);
  expect(result.unblockedArchitecturalPlatformIds).toEqual([]);
  expect(result.architecturalPlatformsDisableLedgeCandidates).toBe(true);
  expect(result.generatedArchitecturalLedgeCandidateCount).toBe(0);
  expect(result.openUnderpassesClear).toBe(true);
  expect(result.doorClearanceOverlapCount).toBe(0);
  expect(result.doorDeckSlabOverlapCount).toBe(0);
  expect(result.reveredDaisMassTileCount).toBe(25);
  expect(result.railRunCount).toBeGreaterThan(0);
  expect(result.railPostCount).toBeGreaterThan(0);
  expect(result.missingRailEndpoints).toEqual([]);
  expect(result.forbiddenFallbackRailCount).toBe(0);
  expect(result.solidPurposePlatformCount).toBeGreaterThanOrEqual(result.functionalRoomCount);
  expect(result.largeSlopes.length).toBeGreaterThan(0);
  expect(result.largeSlopes.every((slope) => slope.rampTileCount >= 2 && slope.texturedWallToFloor)).toBe(true);
  expect(result.pyramidLayerCount).toBe(8);
  expect(result.pyramidCircuitStepCount).toBe(8);
  expect(result.pyramidGuardianDecalCount).toBe(2);
  expect(result.shrineFocalPillarCount).toBe(3);
  expect(result.summitTileCount).toBe(9);
  expect(result.processionalStepTileCount).toBeGreaterThanOrEqual(21);
  expect(result.pyramidTerraceTileCount).toBeGreaterThanOrEqual(250);
  expect(result.pyramidSidePlatformCount).toBe(6);
  expect(result.pyramidMaxElevation).toBeGreaterThanOrEqual(4);
  expect(result.pyramidSummitCollisionStable).toBe(true);
  expect(result.pyramidEnemySpawnPoints).toHaveLength(6);
  expect(new Set(result.pyramidEnemySpawnPoints.map((point) => `${point.x},${point.z}`)).size).toBe(6);
  expect(result.pyramidEnemySpawnPoints.every((point) => (
    point.y >= result.pyramidMaxElevation - 1.5
    && point.y <= result.pyramidMaxElevation - 0.45
  ))).toBe(true);
  expect(result.pyramidTinyStepAllowance).toBe(true);
  expect(result.pyramidEncounterUsesSummitTrigger).toBe(true);
  expect(result.keycardBarrierPresent).toBe(true);
  expect(result.keycardOnPyramid).toBe(true);
  expect(result.connectorGalleryTileCount).toBeGreaterThan(40);
  expect(result.explorationAlcoveCount).toBeGreaterThan(0);
  expect(result.serviceLaneCount).toBeGreaterThan(0);
  expect(result.explorationPlans.length).toBeGreaterThan(5);
  expect(result.explorationPlans.every((plan) => (
    plan.beatCount === 2 && plan.progressionBeatCount === 2
  ))).toBe(true);
  expect(result.doorSlidesLaterally).toBe(true);
  expect(result.doorRootStaysAtElevation).toBe(true);
});

test('conveyor consoles, sealed vault, refractor sanctum, and grand keycard pyramid hold across seeds', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?startupWorld=dungeon');
  await expect
    .poll(
      async () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20000 },
    )
    .toBe('true');

  const results = await page.evaluate(async () => {
    window.game.stop();
    const { DungeonGenerator } = await import('/src/DungeonGenerator.js');
    const generated = [];

    for (const seed of [1, 2, 3, 7, 11, 17, 29, 60]) {
      let state = seed >>> 0;
      const random = () => (
        (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
      );
      const dungeon = new DungeonGenerator({ random, difficulty: 3 }).generate();
      const roomById = new Map(dungeon.rooms.map((room) => [room.id, room]));
      const conveyorRoom = roomById.get('conveyorRoom');
      const vaultRoom = roomById.get('bonusVault');
      const shrineRoom = roomById.get('shrineRoom');
      const keycardRoom = roomById.get('keycardRoom');
      const structuralColumns = new Set(
        dungeon.floorTiles
          .filter((tile) => tile.roomId === conveyorRoom.id && tile.supportStyle === 'solid_mass')
          .map((tile) => `${tile.x},${tile.z}`),
      );
      const consoleChecks = dungeon.conveyorPuzzles[0].consoles.map((console) => {
        const mechanism = dungeon.mechanisms.find((candidate) => candidate.id === console.id);
        const x = Math.round(mechanism.position.x / dungeon.tileSize);
        const z = Math.round(mechanism.position.z / dungeon.tileSize);
        return {
          id: console.id,
          movedFromUnsafeTemplate: console.originalX === undefined
            || console.x !== console.originalX
            || console.z !== console.originalZ,
          structuralOverlap: structuralColumns.has(`${x},${z}`),
          solidZoneOverlap: dungeon.solidZones.some((zone) => (
            Math.abs(zone.position.x - mechanism.position.x) <= zone.halfWidth
            && Math.abs(zone.position.z - mechanism.position.z) <= zone.halfDepth
          )),
          raisedColumnOverlap: dungeon.floorTiles.some((tile) => (
            tile.roomId === conveyorRoom.id
            && tile.x === x
            && tile.z === z
            && (tile.elevation ?? 0) > 0.2
          )),
        };
      });

      const vaultDoor = dungeon.doors.find((door) => door.id === 'bonusVaultDoor');
      const vaultChest = dungeon.chests.find((chest) => chest.roomId === vaultRoom.id);
      const vaultFocalTile = dungeon.floorTiles.find((tile) => (
        tile.roomId === vaultRoom.id
        && tile.x === vaultRoom.x
        && tile.z === vaultRoom.z
        && tile.surface === 'vaultRewardDais'
      ));
      const halfW = Math.floor(vaultRoom.width / 2);
      const halfD = Math.floor(vaultRoom.depth / 2);
      const boundaryOpenings = [];
      for (let x = vaultRoom.x - halfW; x <= vaultRoom.x + halfW; x += 1) {
        for (let z = vaultRoom.z - halfD; z <= vaultRoom.z + halfD; z += 1) {
          const onBoundary = x === vaultRoom.x - halfW || x === vaultRoom.x + halfW
            || z === vaultRoom.z - halfD || z === vaultRoom.z + halfD;
          if (!onBoundary) continue;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const outsideX = x + dx;
            const outsideZ = z + dz;
            const leavesRoom = outsideX < vaultRoom.x - halfW || outsideX > vaultRoom.x + halfW
              || outsideZ < vaultRoom.z - halfD || outsideZ > vaultRoom.z + halfD;
            if (leavesRoom && dungeon.tiles.has(`${outsideX},${outsideZ}`)) {
              boundaryOpenings.push(`${x},${z}`);
            }
          }
        }
      }
      const physicalVaultCheck = dungeon.progression.validation.physicalProgression.checks
        .find((check) => check.doorId === 'bonusVaultDoor');

      const shrinePillars = dungeon.solidZones.filter((zone) => zone.id.startsWith('shrineRoom_focalPillar_'));
      const shrineObjective = dungeon.shrine.position;
      let focalPillarMeshCount = 0;
      let pyramidLayerCount = 0;
      let pyramidCircuitCount = 0;
      let pyramidGuardianDecalCount = 0;
      dungeon.group.traverse((object) => {
        if (object.name?.startsWith('shrineFocalPillar_')) focalPillarMeshCount += 1;
        if (object.name?.startsWith('reverentMechanicalPyramidLayer')) pyramidLayerCount += 1;
        if (object.name?.startsWith('pyramidProcessionalCircuitStep_')) pyramidCircuitCount += 1;
        if (object.name?.startsWith('pyramidReaverbotGuardianEyeDecal_')) pyramidGuardianDecalCount += 1;
      });

      const pyramidTiles = dungeon.floorTiles.filter((tile) => (
        tile.roomId === keycardRoom.id
        && String(tile.surface).startsWith('mechanicalPyramid')
      ));
      const summitTiles = pyramidTiles.filter((tile) => tile.surface === 'mechanicalPyramidSummit');
      const stairLine = pyramidTiles
        .filter((tile) => tile.x === keycardRoom.x && (
          tile.surface === 'mechanicalPyramidProcessionalStep'
          || tile.surface === 'mechanicalPyramidSummit'
        ))
        .filter((tile) => tile.z <= keycardRoom.z)
        .sort((a, b) => a.z - b.z);
      const sidePlatforms = pyramidTiles.filter((tile) => tile.surface === 'mechanicalPyramidSidePlatform');
      const keycard = dungeon.keycards.find((entry) => entry.keycardId === 'Keycard_Alpha');
      const keycardEncounter = dungeon.encounters.find((encounter) => encounter.id === 'keycardGuard');

      generated.push({
        seed,
        accepted: dungeon.progression.validation.accepted,
        errors: dungeon.progression.validation.errors,
        consolesClear: consoleChecks.every((check) => (
          !check.structuralOverlap && !check.solidZoneOverlap && !check.raisedColumnOverlap
        )),
        consoleChecks,
        vault: {
          roomGapTiles: Math.abs(vaultRoom.x - conveyorRoom.x)
            - Math.floor(vaultRoom.width / 2)
            - Math.floor(conveyorRoom.width / 2),
          uniqueBoundaryOpenings: [...new Set(boundaryOpenings)],
          doorAtOnlyOpening: [...new Set(boundaryOpenings)].length === 1
            && [...new Set(boundaryOpenings)][0] === `${vaultDoor.toPortal.x},${vaultDoor.toPortal.z}`
            && Math.round(vaultDoor.graphBlockingPosition.x / dungeon.tileSize) === vaultDoor.toPortal.x
            && Math.round(vaultDoor.graphBlockingPosition.z / dungeon.tileSize) === vaultDoor.toPortal.z,
          lockedByPuzzle: vaultDoor.closed && vaultDoor.locked
            && vaultDoor.pressurePlateId === 'conveyorVaultPlate',
          inaccessibleWhileClosed: physicalVaultCheck?.destinationReachableWhileClosed === false,
          chestAtFocalPoint: Boolean(vaultChest && vaultFocalTile)
            && Math.abs(vaultChest.position.x - vaultRoom.x * dungeon.tileSize) < 0.01
            && Math.abs(vaultChest.position.z - vaultRoom.z * dungeon.tileSize) < 0.01
            && Math.abs(vaultChest.position.y - vaultFocalTile.elevation) < 0.01,
          chestPosition: vaultChest ? {
            x: vaultChest.position.x / dungeon.tileSize,
            y: vaultChest.position.y,
            z: vaultChest.position.z / dungeon.tileSize,
          } : null,
          focalTile: vaultFocalTile ? {
            x: vaultFocalTile.x,
            y: vaultFocalTile.elevation,
            z: vaultFocalTile.z,
          } : null,
          basementTileCount: dungeon.floorTiles.filter((tile) => (
            tile.roomId === vaultRoom.id && (tile.elevation ?? 0) < -0.1
          )).length,
        },
        shrine: {
          noFloorDivot: dungeon.floorTiles.every((tile) => (
            tile.roomId !== shrineRoom.id || tile.surface !== 'refractorWell'
          )),
          objectiveCentered: Math.abs(shrineObjective.x - shrineRoom.x * dungeon.tileSize) < 0.01
            && Math.abs(shrineObjective.z - shrineRoom.z * dungeon.tileSize) < 0.01
            && Math.abs(shrineObjective.y - shrineRoom.refractorFocalPoint.elevation) < 0.01,
          pillarCount: shrinePillars.length,
          pillarMeshCount: focalPillarMeshCount,
          pillarCentroidCentered: shrinePillars.length === 3
            && Math.abs(shrinePillars.reduce((sum, zone) => sum + zone.position.x, 0) / 3 - shrineObjective.x) < 0.01
            && Math.abs(shrinePillars.reduce((sum, zone) => sum + zone.position.z, 0) / 3 - shrineObjective.z) < 0.01,
        },
        pyramid: {
          centerIsRoomCenter: keycardRoom.mechanicalPyramidCenter.x === keycardRoom.x
            && keycardRoom.mechanicalPyramidCenter.z === keycardRoom.z,
          layerCount: pyramidLayerCount,
          circuitCount: pyramidCircuitCount,
          guardianDecalCount: pyramidGuardianDecalCount,
          summitCount: summitTiles.length,
          summitStable: summitTiles.length === 9
            && new Set(summitTiles.map((tile) => tile.elevation)).size === 1,
          stairCount: pyramidTiles.filter((tile) => tile.surface === 'mechanicalPyramidProcessionalStep').length,
          stairWalkable: stairLine.length >= 8 && stairLine.every((tile, index) => (
            index === 0 || tile.elevation - stairLine[index - 1].elevation <= 0.5 + 0.001
          )),
          sidePlatformCount: sidePlatforms.length,
          pairedSideRoutes: [-1, 1].every((sign) => (
            sidePlatforms.filter((tile) => Math.sign(tile.x - keycardRoom.x) === sign).length === 3
          )),
          keycardCentered: Math.abs(keycard.position.x - keycardRoom.x * dungeon.tileSize) < 0.01
            && Math.abs(keycard.position.z - keycardRoom.z * dungeon.tileSize) < 0.01
            && Math.abs(keycard.position.y - keycardRoom.mechanicalPyramidCenter.elevation) < 0.01,
          enemiesGuardUpperRing: keycardEncounter.spawnPoints.length === 6
            && new Set(keycardEncounter.spawnPoints.map((point) => (
              `${Math.round(point.x / dungeon.tileSize)},${Math.round(point.z / dungeon.tileSize)}`
            ))).size === 6
            && keycardEncounter.spawnPoints.every((point) => (
              point.y >= keycardRoom.mechanicalPyramidCenter.elevation - 1.5
              && point.y <= keycardRoom.mechanicalPyramidCenter.elevation - 0.45
            )),
          summitTrigger: Boolean(keycardEncounter.triggerZone)
            && Math.abs(keycardEncounter.triggerZone.position.y - keycardRoom.mechanicalPyramidCenter.elevation) < 0.01,
          protectedKeycard: keycard.protectedByEncounterId === keycardEncounter.id
            && keycard.barrierObject?.name === 'keycardEncounterProtectionBarrier',
          tinyStepsGrounded: pyramidTiles
            .filter((tile) => tile.surface !== 'mechanicalPyramidSidePlatform')
            .every((tile) => tile.groundedStepTransitionHeight >= 0.55),
        },
      });
      dungeon.group.clear();
    }

    return generated;
  });

  expect(results.every((result) => result.accepted && result.errors.length === 0)).toBe(true);
  expect(results.every((result) => result.consolesClear)).toBe(true);
  expect(results.filter((result) => !(
    result.vault.roomGapTiles >= 5
    && result.vault.doorAtOnlyOpening
    && result.vault.lockedByPuzzle
    && result.vault.inaccessibleWhileClosed
    && result.vault.chestAtFocalPoint
    && result.vault.basementTileCount === 0
  )).map((result) => ({ seed: result.seed, vault: result.vault }))).toEqual([]);
  expect(results.every((result) => (
    result.shrine.noFloorDivot
    && result.shrine.objectiveCentered
    && result.shrine.pillarCount === 3
    && result.shrine.pillarMeshCount === 3
    && result.shrine.pillarCentroidCentered
  ))).toBe(true);
  expect(results.every((result) => (
    result.pyramid.centerIsRoomCenter
    && result.pyramid.layerCount === 8
    && result.pyramid.circuitCount === 8
    && result.pyramid.guardianDecalCount === 2
    && result.pyramid.summitCount === 9
    && result.pyramid.summitStable
    && result.pyramid.stairCount >= 21
    && result.pyramid.stairWalkable
    && result.pyramid.sidePlatformCount === 6
    && result.pyramid.pairedSideRoutes
    && result.pyramid.keycardCentered
    && result.pyramid.enemiesGuardUpperRing
    && result.pyramid.summitTrigger
    && result.pyramid.protectedKeycard
    && result.pyramid.tinyStepsGrounded
  ))).toBe(true);
});

test('solid architectural decks preserve carved underpasses and deterministic progression routes', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?startupWorld=dungeon');
  await expect
    .poll(
      async () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20000 },
    )
    .toBe('true');

  const results = await page.evaluate(async () => {
    window.game.stop();
    const { DungeonGenerator } = await import('/src/DungeonGenerator.js');
    const expectedTileRanges = new Map([
      ['enemyNest_rearStructuralMass', { min: 36, max: 39 }],
      ['conveyorRoom_sideStructuralMass', { min: 59, max: 68 }],
    ]);
    const generated = [];

    for (const seed of [3, 10, 17, 18, 53, 60]) {
      let state = seed >>> 0;
      const random = () => (
        (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
      );
      const generator = new DungeonGenerator({ random });
      const dungeon = generator.generate();
      const architecturalTiles = dungeon.floorTiles.filter((tile) => tile.massGroupId);
      const solidTiles = architecturalTiles.filter((tile) => tile.supportStyle === 'solid_mass');
      const openTiles = architecturalTiles.filter((tile) => tile.supportStyle === 'open_underpass');
      const platforms = dungeon.platforms.filter((platform) => platform.architecturalMass);
      const containsColumn = (platform, tile) => (
        Math.abs(tile.x * dungeon.tileSize - platform.center.x) <= platform.halfWidth
        && Math.abs(tile.z * dungeon.tileSize - platform.center.z) <= platform.halfDepth
      );
      const groupCounts = new Map();
      for (const tile of architecturalTiles) {
        groupCounts.set(tile.massGroupId, (groupCounts.get(tile.massGroupId) ?? 0) + 1);
      }
      const spawnInsideMassCount = dungeon.encounters.reduce((count, encounter) => (
        count + (encounter.spawnPoints ?? []).filter((spawnPoint) => platforms.some((platform) => (
          Math.abs(spawnPoint.x - platform.center.x) <= platform.halfWidth
          && Math.abs(spawnPoint.z - platform.center.z) <= platform.halfDepth
          && spawnPoint.y < platform.topY - 0.05
        ))).length
      ), 0);
      const doorClearanceOverlapCount = dungeon.doors.reduce((count, door) => {
        const clearanceSamples = [-0.6, 0, 0.6].map((offset) => ({
          x: door.position.x + (door.alongX ? 0 : offset * dungeon.tileSize),
          z: door.position.z + (door.alongX ? offset * dungeon.tileSize : 0),
        }));
        return count + clearanceSamples.filter((sample) => platforms.some((platform) => (
          Math.abs(sample.x - platform.center.x) <= platform.halfWidth
          && Math.abs(sample.z - platform.center.z) <= platform.halfDepth
        ))).length;
      }, 0);
      const doorDeckSlabOverlapCount = dungeon.doors.reduce((count, door) => {
        const clearanceSamples = [-0.6, 0, 0.6].map((offset) => ({
          x: Math.round(door.position.x / dungeon.tileSize) + (door.alongX ? 0 : Math.sign(offset)),
          z: Math.round(door.position.z / dungeon.tileSize) + (door.alongX ? Math.sign(offset) : 0),
        }));
        return count + clearanceSamples.filter((sample) => architecturalTiles.some((tile) => (
          tile.x === sample.x && tile.z === sample.z
        ))).length;
      }, 0);

      generated.push({
        seed,
        accepted: dungeon.progression.validation.accepted,
        errors: dungeon.progression.validation.errors,
        allLocalSocketsReachable: dungeon.progression.validation.platformability.localSocketChecks
          .every((check) => check.accessibleFromOwnerRoom),
        groupCount: groupCounts.size,
        groupTileCountsCorrect: [...expectedTileRanges].every(([id, range]) => (
          groupCounts.get(id) >= range.min && groupCounts.get(id) <= range.max
        )),
        solidTileCount: solidTiles.length,
        openTileCount: openTiles.length,
        everySolidColumnBlocked: solidTiles.every((tile) => platforms.some((platform) => (
          containsColumn(platform, tile)
        ))),
        everyUnderpassColumnClear: openTiles.every((tile) => platforms.every((platform) => (
          !containsColumn(platform, tile)
        ))),
        spawnInsideMassCount,
        doorClearanceOverlapCount,
        doorDeckSlabOverlapCount,
        architecturalPlatformsDisableLedgeCandidates: platforms.every((platform) => (
          platform.createsLedgeCandidates === false
        )),
        unexpectedMassSurfaceCount: architecturalTiles.filter((tile) => ![
          'secondFloor',
          'mechanicalPyramidTerrace',
          'mechanicalPyramidProcessionalStep',
          'mechanicalPyramidSummit',
          'mechanicalPyramidSidePlatform',
          'refractorDais',
          'vaultRewardDais',
        ].includes(tile.surface)).length,
        reveredDaisMassTileCount: dungeon.floorTiles.filter((tile) => (
          tile.surface === 'refractorDais' && tile.massGroupId
        )).length,
      });
      dungeon.group.clear();
    }

    return generated;
  });

  expect(results.every((result) => result.accepted && result.errors.length === 0)).toBe(true);
  expect(results.every((result) => result.allLocalSocketsReachable)).toBe(true);
  expect(results.every((result) => result.groupCount >= 18 && result.groupTileCountsCorrect)).toBe(true);
  expect(results.every((result) => result.solidTileCount > 0)).toBe(true);
  expect(results.reduce((count, result) => count + result.openTileCount, 0)).toBeGreaterThan(0);
  expect(results.every((result) => result.everySolidColumnBlocked && result.everyUnderpassColumnClear)).toBe(true);
  expect(results.every((result) => result.spawnInsideMassCount === 0)).toBe(true);
  expect(results.every((result) => (
    result.doorClearanceOverlapCount === 0
    && result.doorDeckSlabOverlapCount === 0
    && result.architecturalPlatformsDisableLedgeCandidates
  ))).toBe(true);
  expect(results.every((result) => (
    result.unexpectedMassSurfaceCount === 0 && result.reveredDaisMassTileCount === 25
  ))).toBe(true);
});

test('trap basement remains a purposeful drop space while the bonus vault reward stays on its focal dais', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('/?startupWorld=dungeon&roomPreview=trapRoom&roomPreviewLevel=0&roomPreviewFacing=north');
  await expect
    .poll(
      async () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20000 },
    )
    .toBe('true');

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const { dungeon } = game;
    const dropRooms = ['trapRoom'].map((roomId) => (
      dungeon.rooms.find((room) => room.id === roomId)
    ));
    const checks = dungeon.progression.validation.platformability.dropSpaceChecks;
    const shelves = dungeon.platforms.filter((platform) => platform.dropSpaceId);
    const shelfLedges = game.platformingLedgeCandidates.filter((candidate) => (
      shelves.some((platform) => candidate.id.startsWith(`${platform.id}-`))
    ));
    const negativeRampCount = dungeon.floorTiles.filter((tile) => (
      tile.roomId === 'trapRoom'
      && tile.surface === 'industrialRamp'
      && Math.min(tile.rampStartElevation ?? 0, tile.rampEndElevation ?? 0) < -0.05
    )).length;
    const entryTiles = dungeon.floorTiles.filter((tile) => tile.allowsGroundedDropLanding);
    const bridgeTiles = dungeon.floorTiles.filter((tile) => tile.surface === 'dropSpaceOverpass');
    const lowerTiles = dungeon.floorTiles.filter((tile) => (
      tile.dropSpaceId && tile.surface === 'basementFloor'
    ));
    let shelfVolumeCount = 0;
    let shelfBandCount = 0;
    let overpassBeamCount = 0;
    let entryBackdropCount = 0;
    let entryRevealWallCount = 0;
    let entryHeaderCount = 0;
    let entrySillCount = 0;
    let entryAccentCount = 0;
    dungeon.group.traverse((object) => {
      if (object.name === 'minorDropReturnShelfVolume') shelfVolumeCount += 1;
      if (object.name === 'minorDropReturnShelfBand') shelfBandCount += 1;
      if (object.name === 'minorDropOverpassUnderbeam') overpassBeamCount += 1;
      if (object.name === 'factoryBasementEntryBackdrop') entryBackdropCount += 1;
      if (object.name === 'factoryBasementEntryRevealWall') entryRevealWallCount += 1;
      if (object.name === 'factoryBasementEntryHeaderBeam') entryHeaderCount += 1;
      if (object.name === 'factoryBasementEntrySill') entrySillCount += 1;
      if (object.name === 'factoryBasementEntryAccent') entryAccentCount += 1;
    });

    const player = game.player;
    const controller = game.dungeonController;
    const spec = dropRooms[0].dropSpace;
    const entryKey = spec.entryFloorKeys[0];
    const lipKey = spec.entryLipFloorKeys[0];
    const entryTile = dungeon.floorTiles.find((tile) => (
      `${tile.x},${tile.z}@${tile.level}` === entryKey
    ));
    const lipTile = dungeon.floorTiles.find((tile) => (
      `${tile.x},${tile.z}@${tile.level}` === lipKey
    ));
    player.jumpState = 'Grounded';
    controller.lastSafePlayerPosition.set(
      lipTile.x * dungeon.tileSize,
      lipTile.elevation ?? 0,
      lipTile.z * dungeon.tileSize,
    );
    player.root.position.set(
      entryTile.x * dungeon.tileSize,
      0,
      entryTile.z * dungeon.tileSize,
    );
    controller._constrainPlayerToWalkable();
    const groundedDropWasAccepted = Math.abs(player.root.position.x - entryTile.x * dungeon.tileSize) < 0.01
      && Math.abs(player.root.position.z - entryTile.z * dungeon.tileSize) < 0.01
      && Math.abs(player.root.position.y) < 0.01
      && Math.abs(game._getPlayerGroundY() - spec.lowerElevation) < 0.01;

    const Vector3 = player.root.position.constructor;
    const resetPlayer = (position, direction) => {
      player.ledgeCling = null;
      player.root.position.copy(position);
      player.modelRoot.position.y = 0;
      player.velocity.set(0, 0, 0);
      player.jumpState = 'Grounded';
      player._jumpGroundY = position.y;
      player._jumpBufferTimer = 0;
      player._coyoteTimer = player.jumpSettings.coyoteTime;
      player._landingRecoveryTimer = 0;
      player.animation.actionState = null;
      player.animation.actionTimer = 0;
      player.animation.actionDuration = 0;
      player.lastMoveDirection.copy(direction);
      player.faceDirection(direction);
      controller.pendingPlayerJumpOffLanding = null;
      controller.lastSafePlayerPosition.copy(position);
    };
    const updatePlayer = (frames, direction, input = new Set(), stopWhen = null) => {
      let minimumY = player.root.position.y;
      for (let frame = 0; frame < frames; frame += 1) {
        player.update(1 / 60, input, {
          arenaRadius: game.arenaRadius,
          movementForward: direction,
          movementRight: new Vector3(direction.z, 0, -direction.x),
          groundY: game._getPlayerGroundY(),
        });
        controller.update(1 / 60);
        minimumY = Math.min(minimumY, player.root.position.y);
        if (stopWhen?.()) break;
      }
      return minimumY;
    };

    const dropDirection = new Vector3(
      entryTile.x - lipTile.x,
      0,
      entryTile.z - lipTile.z,
    ).normalize();
    resetPlayer(new Vector3(entryTile.x * dungeon.tileSize, 0, entryTile.z * dungeon.tileSize), dropDirection);
    controller.lastSafePlayerPosition.set(
      lipTile.x * dungeon.tileSize,
      lipTile.elevation ?? 0,
      lipTile.z * dungeon.tileSize,
    );
    controller._constrainPlayerToWalkable();
    let enteredFalling = false;
    updatePlayer(240, dropDirection, new Set(), () => {
      enteredFalling ||= player.jumpState === 'Falling';
      return enteredFalling
        && player.jumpState === 'Grounded'
        && Math.abs(player.root.position.y - spec.lowerElevation) < 0.03;
    });
    const completedGroundedDrop = enteredFalling
      && player.jumpState === 'Grounded'
      && Math.abs(player.root.position.y - spec.lowerElevation) < 0.03;

    const shelf = shelves.find((platform) => platform.dropSpaceId === spec.id);
    const ledge = shelfLedges.find((candidate) => candidate.id.startsWith(`${shelf.id}-`));
    const inward = ledge.normal.clone().multiplyScalar(-1);
    const approachPosition = shelf.center.clone()
      .addScaledVector(ledge.normal, dungeon.tileSize)
      .setY(spec.lowerElevation);
    const underShelfPosition = shelf.center.clone().setY(spec.lowerElevation);
    resetPlayer(approachPosition, inward);
    const underShelfIsSolid = game.isPositionInsidePlatformBlock(underShelfPosition);
    player.root.position.copy(underShelfPosition);
    controller._constrainPlayerToWalkable();
    const solidShelfRejectedUnderside = player.root.position.distanceTo(approachPosition) < 0.05;

    resetPlayer(approachPosition, inward);
    player.tryJump(new Set(), {
      arenaRadius: game.arenaRadius,
      movementForward: inward,
      movementRight: new Vector3(inward.z, 0, -inward.x),
      groundY: spec.lowerElevation,
    });
    updatePlayer(240, inward, new Set(), () => (
      player.jumpState === 'Grounded' && Math.abs(player.root.position.y - spec.lowerElevation) < 0.03
    ));
    const neutralJumpStayedOnLowerFloor = !player.isLedgeClinging()
      && Math.abs(player.root.position.y - spec.lowerElevation) < 0.03;

    const clingStart = ledge.center.clone()
      .addScaledVector(ledge.normal, 0.42)
      .setY(spec.lowerElevation);
    resetPlayer(clingStart, inward);
    const generatedLedgeGrabStarted = game._tryResolveDebugLedgeCling({
      player,
      root: player.root,
      jumpDirection: inward,
      progress: 0.5,
      jumpStartY: spec.lowerElevation,
      jumpReachHeight: player.getJumpReachHeight(),
    }, [ledge]);
    const authoredHangY = player.ledgeCling?.hangPosition.y ?? -Infinity;
    const minimumClingRootY = updatePlayer(360, inward, new Set(['KeyW']), () => (
      !player.isLedgeClinging() && Math.abs(player.root.position.y - shelf.topY) < 0.05
    ));
    const completedGeneratedLedgeClimb = generatedLedgeGrabStarted
      && !player.isLedgeClinging()
      && Math.abs(player.root.position.y - shelf.topY) < 0.05;

    const bonusChest = dungeon.chests.find((chest) => chest.roomId === 'bonusVault');
    const trapZone = dungeon.traps.find((trap) => trap.roomId === 'trapRoom');
    return {
      accepted: dungeon.progression.validation.accepted,
      dropSpaces: dropRooms.map((room) => room.dropSpace),
      checks,
      lowerTileCounts: Object.fromEntries(dropRooms.map((room) => [
        room.id,
        lowerTiles.filter((tile) => tile.dropSpaceId === room.dropSpace.id).length,
      ])),
      bridgeTileCount: bridgeTiles.length,
      bridgeKeysUnique: new Set(bridgeTiles.map((tile) => `${tile.x},${tile.z}@${tile.level}`)).size,
      shelfCount: shelves.length,
      shelfVolumeCount,
      shelfBandCount,
      shelfLedgeCount: shelfLedges.length,
      shelfEdges: shelves.map((shelf) => shelf.ledgeEdges),
      shelfBlocksBelow: shelves.map((platform) => platform.blocksBelow),
      shelfBaseYs: shelves.map((platform) => platform.baseY),
      shelfMinimumHangYs: shelves.map((platform) => platform.minimumHangRootY),
      overpassBeamCount,
      entryBackdropCount,
      entryRevealWallCount,
      entryHeaderCount,
      entrySillCount,
      entryAccentCount,
      entryTileCount: entryTiles.length,
      groundedDropWasAccepted,
      completedGroundedDrop,
      underShelfIsSolid,
      solidShelfRejectedUnderside,
      neutralJumpStayedOnLowerFloor,
      generatedLedgeGrabStarted,
      authoredHangY,
      minimumClingRootY,
      completedGeneratedLedgeClimb,
      negativeRampCount,
      bonusChestY: bonusChest?.position.y ?? null,
      bonusBasementTileCount: dungeon.floorTiles.filter((tile) => (
        tile.roomId === 'bonusVault' && (tile.elevation ?? 0) < -0.1
      )).length,
      trapZoneY: trapZone?.position.y ?? null,
    };
  });

  expect(result.accepted).toBe(true);
  expect(result.dropSpaces).toHaveLength(1);
  expect(result.dropSpaces.every((space) => (
    space.lowerFloorKeys.length === 79
    && space.lowerElevation === -4.8
    && space.shelfElevation === -1.5
    && space.entryFloorKeys.length === 2
    && space.returnShelfFloorKeys.length === 2
    && space.exitFloorKeys.length === 2
    && space.requiredActions.join(',') === 'drop,ledge_climb,jump'
  ))).toBe(true);
  expect(result.checks).toHaveLength(1);
  expect(result.checks.every((check) => (
    check.lowerTileCount === 79
    && check.entryDropExists
    && check.entryFlagsValid
    && check.entryLipsReachable
    && check.returnClimbExists
    && check.exitJumpExists
    && check.shelfEdgesValid
    && check.shelfSupportColumnsBlocked
    && check.lowerReachable
    && check.canExit
    && check.everyLowerTileCanExit
    && check.overheadClearanceValid
    && check.bridgeCoverageRatio <= 0.5
  ))).toBe(true);
  expect(Object.values(result.lowerTileCounts)).toEqual([81]);
  expect(result.bridgeTileCount).toBeGreaterThan(0);
  expect(result.bridgeKeysUnique).toBe(result.bridgeTileCount);
  expect(result.shelfCount).toBe(1);
  expect(result.shelfVolumeCount).toBe(1);
  expect(result.shelfBandCount).toBe(2);
  expect(result.shelfLedgeCount).toBe(1);
  expect(result.shelfEdges.every((edges) => edges?.length === 1)).toBe(true);
  expect(result.shelfBlocksBelow.every(Boolean)).toBe(true);
  expect(result.shelfBaseYs.every((value) => value === -4.8)).toBe(true);
  expect(result.shelfMinimumHangYs.every((value) => value === -4.8)).toBe(true);
  expect(result.overpassBeamCount).toBe(result.bridgeTileCount * 2);
  expect(result.entryBackdropCount).toBe(1);
  expect(result.entryRevealWallCount).toBe(2);
  expect(result.entryHeaderCount).toBe(1);
  expect(result.entrySillCount).toBe(1);
  expect(result.entryAccentCount).toBe(1);
  expect(result.entryTileCount).toBe(2);
  expect(result.groundedDropWasAccepted).toBe(true);
  expect(result.completedGroundedDrop).toBe(true);
  expect(result.underShelfIsSolid).toBe(true);
  expect(result.solidShelfRejectedUnderside).toBe(true);
  expect(result.neutralJumpStayedOnLowerFloor).toBe(true);
  expect(result.generatedLedgeGrabStarted).toBe(true);
  expect(result.authoredHangY).toBeGreaterThanOrEqual(-4.8);
  expect(result.minimumClingRootY).toBeGreaterThanOrEqual(-4.8);
  expect(result.completedGeneratedLedgeClimb).toBe(true);
  expect(result.negativeRampCount).toBe(0);
  expect(result.bonusChestY).toBeCloseTo(0.42, 2);
  expect(result.bonusBasementTileCount).toBe(0);
  expect(result.trapZoneY).toBeLessThan(-4.5);
});

test('ramps and macro walls preserve tiled texel density without repeated slab seams', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('/?startupWorld=dungeon');
  await expect
    .poll(
      async () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20000 },
    )
    .toBe('true');

  const result = await page.evaluate(async () => {
    window.game.stop();
    const { dungeon, raycaster } = window.game;
    const { DungeonGenerator } = await import('/src/DungeonGenerator.js');
    const Vector3 = window.game.player.root.position.constructor;
    const rampSurfaces = [];
    const wallCells = [];
    const wallAccents = [];
    let contiguousRampRunCount = 0;
    let oldRampSlabCount = 0;
    let oldRampStripeCount = 0;
    let architecturalTiledMassCount = 0;
    let wallBaseDrawObjectCount = 0;
    let wallMacroDrawObjectCount = 0;
    let wallAccentDrawObjectCount = 0;
    let oldWallMacroMeshCount = 0;
    let oldWallAccentMeshCount = 0;
    let wallMacroInstanceRecordMismatchCount = 0;
    let maximumWallBatchSpan = 0;
    dungeon.group.traverse((object) => {
      if (object.name === 'contiguousIndustrialRampRun') contiguousRampRunCount += 1;
      if (object.userData.floorTile?.surface === 'industrialRamp') oldRampSlabCount += 1;
      if (object.name === 'industrialRampGripStripe') oldRampStripeCount += 1;
      if (object.name?.startsWith('solidArchitecturalDeckMass_')
        && object.geometry?.userData?.tiledTexture) {
        architecturalTiledMassCount += 1;
      }
      if (object.userData.contiguousRampSurface) {
        object.updateWorldMatrix(true, false);
        const position = object.geometry.getAttribute('position');
        const normal = object.geometry.getAttribute('normal');
        const uv = object.geometry.getAttribute('uv');
        const topGroup = object.geometry.groups[0];
        const bottomGroup = object.geometry.groups[1];
        const topV = [];
        const topNormalY = [];
        const bottomNormalY = [];
        for (let index = topGroup.start; index < topGroup.start + topGroup.count; index += 1) {
          topV.push(uv.getY(index));
          topNormalY.push(normal.getY(index));
        }
        for (let index = bottomGroup.start; index < bottomGroup.start + bottomGroup.count; index += 1) {
          bottomNormalY.push(normal.getY(index));
        }
        const worldVertex = (index) => new Vector3(
          position.getX(index),
          position.getY(index),
          position.getZ(index),
        ).applyMatrix4(object.matrixWorld);
        const topA = worldVertex(topGroup.start);
        const topB = worldVertex(topGroup.start + 1);
        const topC = worldVertex(topGroup.start + 2);
        const topCentroid = topA.clone().add(topB).add(topC).multiplyScalar(1 / 3);
        raycaster.set(
          topCentroid.clone().add(new Vector3(0, 10, 0)),
          new Vector3(0, -1, 0),
        );
        raycaster.near = 0;
        raycaster.far = 20;
        const topHit = raycaster.intersectObject(object, false)[0] ?? null;
        const rampMaterial = Array.isArray(object.material) ? object.material[0] : object.material;
        rampSurfaces.push({
          tileCount: object.userData.rampTileCount,
          rampRunId: object.userData.rampRunId,
          repeats: object.userData.tiledTextureRepeats,
          uvVSpan: Math.max(...topV) - Math.min(...topV),
          minimumTopNormalY: Math.min(...topNormalY),
          maximumBottomNormalY: Math.max(...bottomNormalY),
          rayHitTop: Boolean(topHit),
          rayHitMaterialIndex: topHit?.face?.materialIndex ?? null,
          rayHitNormalY: topHit?.face?.normal?.y ?? null,
          rayHitSurfaceDelta: topHit ? Math.abs(topHit.point.y - topCentroid.y) : null,
          wrapS: rampMaterial.map?.wrapS,
          wrapT: rampMaterial.map?.wrapT,
          repeatX: rampMaterial.map?.repeat.x,
          repeatY: rampMaterial.map?.repeat.y,
          offsetX: rampMaterial.map?.offset.x,
          offsetY: rampMaterial.map?.offset.y,
        });
      }
      if (object.name === 'dungeonBoundaryWall') {
        wallBaseDrawObjectCount += 1;
      }
      if (object.name === 'dungeonBoundaryWallMacroTile') {
        oldWallMacroMeshCount += 1;
      }
      if (object.name === 'dungeonBoundaryWallAccent') {
        oldWallAccentMeshCount += 1;
      }
      if (object.name === 'dungeonBoundaryWallMacroBatch') {
        wallMacroDrawObjectCount += 1;
        const records = object.userData.wallMacroCells ?? [];
        if (object.count !== records.length) {
          wallMacroInstanceRecordMismatchCount += 1;
        }
        const uv = object.geometry.getAttribute('uv');
        const us = Array.from({ length: uv.count }, (_, index) => uv.getX(index));
        const vs = Array.from({ length: uv.count }, (_, index) => uv.getY(index));
        const uSpan = Math.max(...us) - Math.min(...us);
        const vSpan = Math.max(...vs) - Math.min(...vs);
        object.computeBoundingBox();
        maximumWallBatchSpan = Math.max(
          maximumWallBatchSpan,
          object.boundingBox.max.x - object.boundingBox.min.x,
          object.boundingBox.max.z - object.boundingBox.min.z,
        );
        for (const record of records) {
          wallCells.push({
            ...record,
            facadeId: object.userData.wallFacadeId,
            uDensity: uSpan / record.width,
            vDensity: vSpan / record.height,
            uvRatioMatches: Math.abs(uSpan - record.uvWidthRatio) < 0.002,
          });
        }
      }
      if (object.name === 'dungeonBoundaryWallAccentBatch') {
        wallAccentDrawObjectCount += 1;
        const records = object.userData.wallAccentRecords ?? [];
        if (object.count !== records.length) {
          wallMacroInstanceRecordMismatchCount += 1;
        }
        wallAccents.push(...records);
      }
    });
    const facadeRows = new Map();
    for (const cell of wallCells) {
      const key = `${cell.facadeId}:${cell.normalX},${cell.normalZ}:${cell.row}`;
      const cells = facadeRows.get(key) ?? [];
      cells.push(cell);
      facadeRows.set(key, cells);
    }
    let ownerTransitionCount = 0;
    let falseOwnerGrammarSeamCount = 0;
    for (const cells of facadeRows.values()) {
      cells.sort((left, right) => left.column - right.column);
      for (let index = 1; index < cells.length; index += 1) {
        const left = cells[index - 1];
        const right = cells[index];
        if (left.column + 1 !== right.column || left.ownerId === right.ownerId) {
          continue;
        }
        ownerTransitionCount += 1;
        if (
          ['tr', 'mr', 'br'].includes(left.grammar)
          || ['tl', 'ml', 'bl'].includes(right.grammar)
        ) {
          falseOwnerGrammarSeamCount += 1;
        }
      }
    }
    const facadeProbe = new DungeonGenerator();
    const syntheticContinuousMixedOwnerFacadeCount = facadeProbe
      ._collectBoundaryWallRuns(new Map([
        ['0,0', { x: 0, z: 0, roomId: 'ownerA' }],
        ['1,0', { x: 1, z: 0, roomId: 'ownerB' }],
      ]), new Set())
      .filter((run) => run.horizontal && run.lengthTiles === 2 && run.ownerIds.length === 2)
      .length;
    const logicalRampTiles = dungeon.floorTiles.filter((tile) => tile.surface === 'industrialRamp');
    const dualAxisRampTiles = logicalRampTiles.filter((tile) => (
      Math.abs(Math.sign(tile.rampDirectionX ?? 0))
      + Math.abs(Math.sign(tile.rampDirectionZ ?? 0))
    ) !== 1);
    const routedTurnLandings = dungeon.floorTiles.filter((tile) => (
      tile.surface === 'rampLanding' && tile.rampRouteId
    ));
    const directionsByRun = new Map();
    for (const tile of logicalRampTiles) {
      const directions = directionsByRun.get(tile.rampRunId) ?? new Set();
      directions.add(`${Math.sign(tile.rampDirectionX ?? 0)},${Math.sign(tile.rampDirectionZ ?? 0)}`);
      directionsByRun.set(tile.rampRunId, directions);
    }
    return {
      accepted: dungeon.progression.validation.accepted,
      logicalRampTileCount: logicalRampTiles.length,
      rampTilesMissingRunId: logicalRampTiles.filter((tile) => !tile.rampRunId).length,
      dualAxisRampTileCount: dualAxisRampTiles.length,
      routedTurnLandingCount: routedTurnLandings.length,
      mixedDirectionRunCount: [...directionsByRun.values()].filter((directions) => directions.size !== 1).length,
      contiguousRampRunCount,
      rampSurfaces,
      oldRampSlabCount,
      oldRampStripeCount,
      wallCells,
      wallAccents,
      wallBaseDrawObjectCount,
      wallMacroDrawObjectCount,
      wallAccentDrawObjectCount,
      oldWallMacroMeshCount,
      oldWallAccentMeshCount,
      wallMacroInstanceRecordMismatchCount,
      maximumWallBatchSpan,
      ownerTransitionCount,
      falseOwnerGrammarSeamCount,
      syntheticContinuousMixedOwnerFacadeCount,
      architecturalTiledMassCount,
    };
  });

  expect(result.accepted).toBe(true);
  expect(result.contiguousRampRunCount).toBeGreaterThan(0);
  expect(result.rampSurfaces.length).toBe(result.contiguousRampRunCount);
  expect(result.rampSurfaces.reduce((sum, ramp) => sum + ramp.tileCount, 0)).toBe(result.logicalRampTileCount);
  expect(result.rampSurfaces.every((ramp) => (
    Math.abs(ramp.uvVSpan - ramp.repeats) < 0.001
    && Boolean(ramp.rampRunId)
    && ramp.minimumTopNormalY > 0.9
    && ramp.maximumBottomNormalY < -0.9
    && ramp.rayHitTop
    && ramp.rayHitMaterialIndex === 0
    && ramp.rayHitNormalY > 0.9
    && ramp.rayHitSurfaceDelta < 0.002
    && ramp.wrapS === 1000
    && ramp.wrapT === 1000
    && ramp.repeatX === 1
    && ramp.repeatY === 1
    && ramp.offsetX === 0
    && ramp.offsetY === 0
  ))).toBe(true);
  expect(result.rampTilesMissingRunId).toBe(0);
  expect(result.dualAxisRampTileCount).toBe(0);
  expect(result.routedTurnLandingCount).toBeGreaterThan(0);
  expect(result.mixedDirectionRunCount).toBe(0);
  expect(result.oldRampSlabCount).toBe(0);
  expect(result.oldRampStripeCount).toBe(0);
  expect(result.architecturalTiledMassCount).toBeGreaterThan(0);
  expect(result.wallCells.length).toBeGreaterThan(1000);
  expect(new Set(result.wallCells.map((cell) => cell.row))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  expect(result.wallCells.every((cell) => (
    cell.uvRatioMatches && Math.abs(cell.uDensity - cell.vDensity) < 0.002
  ))).toBe(true);
  expect(result.oldWallMacroMeshCount).toBe(0);
  expect(result.oldWallAccentMeshCount).toBe(0);
  expect(result.wallMacroInstanceRecordMismatchCount).toBe(0);
  expect(result.wallMacroDrawObjectCount).toBeLessThan(2500);
  expect(result.wallMacroDrawObjectCount).toBeLessThan(result.wallCells.length * 0.2);
  expect(
    result.wallBaseDrawObjectCount
      + result.wallMacroDrawObjectCount
      + result.wallAccentDrawObjectCount,
  ).toBeLessThan(result.wallCells.length * 0.25);
  expect(result.maximumWallBatchSpan).toBeLessThan(26);
  expect(result.falseOwnerGrammarSeamCount).toBe(0);
  expect(result.syntheticContinuousMixedOwnerFacadeCount).toBe(2);
  expect(result.wallAccents.length).toBeGreaterThan(20);
  expect(result.wallAccents.every((accent) => (
    accent.integrated && accent.grammar === 'mm' && Boolean(accent.type)
  ))).toBe(true);
});

test('static dungeon chunks cull by distance while floor occlusion and important objects remain safe', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('/?startupWorld=dungeon&roomPreview=trapRoom&roomPreviewLevel=0&roomPreviewFacing=north');
  await expect
    .poll(
      async () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20000 },
    )
    .toBe('true');

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const { dungeon } = game;
    const hasCullAncestor = (object) => {
      for (let current = object; current; current = current.parent) {
        if (current.userData?.renderCullGroup) return true;
      }
      return false;
    };
    const importantObjects = [
      ...dungeon.doors.map((entry) => entry.object),
      ...dungeon.keycards.map((entry) => entry.object),
      ...dungeon.chests.map((entry) => entry.object),
      ...dungeon.mechanisms.map((entry) => entry.object),
      dungeon.keySeeker?.object,
      dungeon.shrine?.object,
    ].filter(Boolean);
    const cullBucketSpan = (candidate) => Math.max(
      candidate.maxX - candidate.minX,
      candidate.maxZ - candidate.minZ,
    );
    const compositeCullGroups = dungeon.renderCullGroups.filter((candidate) => (
      candidate.memberCount > 1
    ));
    const retainingWallOwners = [];
    dungeon.group.traverse((object) => {
      if (object.name === 'factoryBasementRetainingWallVisual') {
        retainingWallOwners.push(object);
      }
    });
    const dynamicRootsStayOutside = game.enemies.every((enemy) => (
      enemy.root.parent && !hasCullAncestor(enemy.root)
    ));
    const descriptor = dungeon.renderCullGroups.find((candidate) => (
      candidate.maxX - candidate.minX < 30 && candidate.maxZ - candidate.minZ < 30
    ));
    const originalPlayerPosition = game.player.root.position.clone();
    const originalCameraPosition = game.camera.position.clone();
    const originalCameraQuaternion = game.camera.quaternion.clone();
    const leaf = descriptor.group.children[0];
    const originalLeafVisibility = leaf.visible;
    leaf.visible = false;
    descriptor.group.visible = false;
    descriptor.group.visible = true;
    const leafVisibilityPreserved = leaf.visible === false;
    leaf.visible = originalLeafVisibility;

    const centerZ = (descriptor.minZ + descriptor.maxZ) * 0.5;
    const setCullProbe = (distance) => {
      game.player.root.position.set(descriptor.maxX + distance, 0, centerZ);
      game.camera.position.set(descriptor.maxX + distance, 3, centerZ);
    };
    descriptor.group.visible = true;
    setCullProbe(60);
    game._updateDungeonRenderCulling(0, { force: true });
    const visibleStateHoldsInsideHideThreshold = descriptor.group.visible;
    descriptor.group.visible = false;
    game._updateDungeonRenderCulling(0, { force: true });
    const hiddenStateHoldsOutsideShowThreshold = !descriptor.group.visible;
    setCullProbe(0);
    game._updateDungeonRenderCulling(0, { force: true });
    const nearGroupRestored = descriptor.group.visible;
    setCullProbe(100000);
    game._updateDungeonRenderCulling(0, { force: true });
    const farCullStats = { ...game.dungeonRenderCullStats };

    const bridgeEntry = game.cameraOcclusionEntries.find((entry) => (
      entry.object.userData.floorTile?.surface === 'dropSpaceOverpass'
    ));
    const dropSpaceElevation = dungeon.rooms.find((room) => room.dropSpace)?.dropSpace?.lowerElevation ?? -4.8;
    for (let current = bridgeEntry.owner; current; current = current.parent) {
      current.visible = true;
    }
    const bridgePosition = bridgeEntry.object.getWorldPosition(bridgeEntry.object.position.clone());
    game.player.root.position.set(bridgePosition.x, dropSpaceElevation, bridgePosition.z - 4);
    game.camera.position.set(bridgePosition.x, 2.5, bridgePosition.z + 4);
    game.camera.lookAt(game.player.root.position.x, -1.95, game.player.root.position.z);
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const bridgeFloorOccluded = bridgeEntry.owner.visible === false;
    game.camera.position.set(bridgePosition.x, 2.5, bridgePosition.z + 4);
    game.player.root.position.set(bridgePosition.x, 0, bridgePosition.z + 3);
    game.camera.lookAt(game.player.root.position.x, 1.25, game.player.root.position.z);
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const bridgeFloorRestored = bridgeEntry.owner.visible === true;

    const architecturalEntry = game.cameraOcclusionEntries.find((entry) => (
      entry.object.name === 'solidArchitecturalDeckReinforcementBand'
      && entry.owner.name.startsWith('solidArchitecturalDeckAssembly_')
      && (
        entry.owner.name.includes('enemyNest_rearStructuralMass')
        || entry.owner.name.includes('conveyorRoom_sideStructuralMass')
      )
    ));
    for (let current = architecturalEntry.owner; current; current = current.parent) {
      current.visible = true;
    }
    const architecturalCenter = architecturalEntry.bounds.getCenter(new bridgePosition.constructor());
    const architecturalSize = architecturalEntry.bounds.getSize(new bridgePosition.constructor());
    const probeAlongX = architecturalSize.x <= architecturalSize.z;
    const probeDistance = (probeAlongX ? architecturalSize.x : architecturalSize.z) * 0.5 + 2;
    game.camera.position.copy(architecturalCenter);
    game.player.root.position.copy(architecturalCenter);
    if (probeAlongX) {
      game.camera.position.x += probeDistance;
      game.player.root.position.x -= probeDistance;
    } else {
      game.camera.position.z += probeDistance;
      game.player.root.position.z -= probeDistance;
    }
    game.camera.lookAt(game.player.root.position);
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const architecturalMassOccluded = architecturalEntry.owner.visible === false;
    game.player.root.position.copy(game.camera.position);
    if (probeAlongX) {
      game.player.root.position.x += 1;
    } else {
      game.player.root.position.z += 1;
    }
    game.camera.lookAt(game.player.root.position);
    game.camera.updateMatrixWorld(true);
    game._updateCameraWallOcclusion();
    const architecturalMassRestored = architecturalEntry.owner.visible === true;

    game.player.root.position.copy(originalPlayerPosition);
    game.camera.position.copy(originalCameraPosition);
    game.camera.quaternion.copy(originalCameraQuaternion);
    game.camera.updateMatrixWorld(true);
    game._updateDungeonRenderCulling(0, { force: true });
    game._updateCameraWallOcclusion();

    return {
      accepted: dungeon.progression.validation.accepted,
      cullGroupCount: dungeon.renderCullGroups.length,
      cullObjectCount: dungeon.renderCullGroups.reduce((sum, group) => sum + group.objectCount, 0),
      cullDrawObjectCount: dungeon.renderCullGroups.reduce((sum, group) => (
        sum + group.drawObjectCount
      ), 0),
      maxCullBucketSpan: Math.max(...dungeon.renderCullGroups.map(cullBucketSpan)),
      maxCompositeCullBucketSpan: Math.max(...compositeCullGroups.map(cullBucketSpan)),
      configuredCompositeCullBucketSpan: Math.max(...compositeCullGroups.map((candidate) => (
        candidate.maxBucketSpan
      ))),
      maxCullBucketDrawObjectCount: Math.max(...dungeon.renderCullGroups.map((candidate) => (
        candidate.drawObjectCount
      ))),
      configuredMaxCullBucketDrawObjects: Math.max(...dungeon.renderCullGroups.map((candidate) => (
        candidate.maxBucketDrawObjects
      ))),
      nestedCullGroupCount: dungeon.renderCullGroups.filter((candidate) => (
        candidate.hierarchyDepth > 0
      )).length,
      importantObjectsUnbucketed: importantObjects.every((object) => !hasCullAncestor(object)),
      dynamicRootsStayOutside,
      retainingWallOwnershipCoupled: retainingWallOwners.length > 0
        && retainingWallOwners.every((owner) => (
          owner.children.some((child) => child.name === 'factoryBasementRetainingWall')
          && owner.children.some((child) => child.name === 'factoryBasementRetainingWallBand')
        )),
      retainingWallOcclusionCoupled: game.cameraOcclusionEntries
        .filter((entry) => entry.object.name === 'factoryBasementRetainingWall')
        .every((entry) => entry.owner.name === 'factoryBasementRetainingWallVisual'),
      leafVisibilityPreserved,
      visibleStateHoldsInsideHideThreshold,
      hiddenStateHoldsOutsideShowThreshold,
      nearGroupRestored,
      farCullStats,
      cameraOcclusionEntryCount: game.cameraOcclusionEntries.length,
      floorOcclusionEntryCount: game.cameraOcclusionEntries.filter((entry) => (
        entry.object.userData.floorTile
      )).length,
      cameraOcclusionBinCount: game.cameraOcclusionBins.size,
      bridgeFloorOccluded,
      bridgeFloorRestored,
      architecturalMassOccluded,
      architecturalMassRestored,
    };
  });

  expect(result.accepted).toBe(true);
  expect(result.cullGroupCount).toBeGreaterThan(100);
  expect(result.cullObjectCount).toBeGreaterThan(1000);
  expect(result.cullDrawObjectCount).toBe(result.cullObjectCount);
  expect(result.maxCullBucketSpan).toBeLessThan(120);
  expect(result.maxCompositeCullBucketSpan).toBeLessThanOrEqual(
    result.configuredCompositeCullBucketSpan + 0.002,
  );
  expect(result.maxCullBucketDrawObjectCount).toBeLessThanOrEqual(
    result.configuredMaxCullBucketDrawObjects,
  );
  expect(result.nestedCullGroupCount).toBeGreaterThan(0);
  expect(result.importantObjectsUnbucketed).toBe(true);
  expect(result.dynamicRootsStayOutside).toBe(true);
  expect(result.retainingWallOwnershipCoupled).toBe(true);
  expect(result.retainingWallOcclusionCoupled).toBe(true);
  expect(result.leafVisibilityPreserved).toBe(true);
  expect(result.visibleStateHoldsInsideHideThreshold).toBe(true);
  expect(result.hiddenStateHoldsOutsideShowThreshold).toBe(true);
  expect(result.nearGroupRestored).toBe(true);
  expect(result.farCullStats.hiddenGroupCount).toBeGreaterThan(0);
  expect(result.farCullStats.hiddenObjectCount).toBeGreaterThan(1000);
  expect(result.farCullStats.hiddenDrawObjectCount).toBe(
    result.farCullStats.hiddenObjectCount,
  );
  expect(result.farCullStats.totalDrawObjectCount).toBe(result.cullDrawObjectCount);
  expect(result.cameraOcclusionEntryCount).toBeGreaterThan(1000);
  expect(result.floorOcclusionEntryCount).toBeGreaterThan(1000);
  expect(result.cameraOcclusionBinCount).toBeGreaterThan(50);
  expect(result.bridgeFloorOccluded).toBe(true);
  expect(result.bridgeFloorRestored).toBe(true);
  expect(result.architecturalMassOccluded).toBe(true);
  expect(result.architecturalMassRestored).toBe(true);
});

test('dungeon reset disposes detached GPU resources while preserving live shared assets', async ({ page }) => {
  test.setTimeout(45000);
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
    const oldRoot = game.dungeon.group;
    const oldMeshes = [];
    oldRoot.traverse((object) => {
      if (object.isMesh && object.geometry && object.material) {
        oldMeshes.push(object);
      }
    });
    const sharedMesh = oldMeshes.find((mesh) => (
      !Array.isArray(mesh.material) && mesh.material.map
    ));
    const unsharedMesh = oldMeshes.find((mesh) => (
      mesh.geometry !== sharedMesh.geometry
      && !Array.isArray(mesh.material)
      && mesh.material !== sharedMesh.material
      && mesh.material.map
      && mesh.material.map !== sharedMesh.material.map
    ));
    const sentinel = sharedMesh.clone(false);
    sentinel.name = 'externalSharedDungeonResourceSentinel';
    sentinel.visible = false;
    game.scene.add(sentinel);

    const disposed = {
      sharedGeometry: false,
      sharedMaterial: false,
      sharedTexture: false,
      unsharedGeometry: false,
      unsharedMaterial: false,
      unsharedTexture: false,
    };
    sharedMesh.geometry.addEventListener('dispose', () => { disposed.sharedGeometry = true; });
    sharedMesh.material.addEventListener('dispose', () => { disposed.sharedMaterial = true; });
    sharedMesh.material.map.addEventListener('dispose', () => { disposed.sharedTexture = true; });
    unsharedMesh.geometry.addEventListener('dispose', () => { disposed.unsharedGeometry = true; });
    unsharedMesh.material.addEventListener('dispose', () => { disposed.unsharedMaterial = true; });
    unsharedMesh.material.map.addEventListener('dispose', () => { disposed.unsharedTexture = true; });

    const resetAccepted = game.resetDungeonLayout({ free: true, message: 'GPU disposal test' });
    const disposalStats = { ...game.lastDungeonResourceDisposalStats };
    let newDungeonReferencesPreservedResource = false;
    game.dungeon.group.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (
        object.geometry === sharedMesh.geometry
        || materials.includes(sharedMesh.material)
        || materials.some((material) => material?.map === sharedMesh.material.map)
      ) {
        newDungeonReferencesPreservedResource = true;
      }
    });
    const sharedResourcesSurvived = !disposed.sharedGeometry
      && !disposed.sharedMaterial
      && !disposed.sharedTexture;
    const detachedResourcesDisposed = disposed.unsharedGeometry
      && disposed.unsharedMaterial
      && disposed.unsharedTexture;

    sentinel.removeFromParent();
    sharedMesh.geometry.dispose();
    sharedMesh.material.dispose();
    sharedMesh.material.map.dispose();

    return {
      resetAccepted,
      oldRootDetached: oldRoot.parent === null,
      newRootAttached: game.dungeon.group.parent === game.scene,
      newDungeonAccepted: game.dungeon.progression.validation.accepted,
      sharedResourcesSurvived,
      detachedResourcesDisposed,
      newDungeonReferencesPreservedResource,
      disposalStats,
    };
  });

  expect(result.resetAccepted).toBe(true);
  expect(result.oldRootDetached).toBe(true);
  expect(result.newRootAttached).toBe(true);
  expect(result.newDungeonAccepted).toBe(true);
  expect(result.sharedResourcesSurvived).toBe(true);
  expect(result.detachedResourcesDisposed).toBe(true);
  expect(result.newDungeonReferencesPreservedResource).toBe(false);
  expect(result.disposalStats.disposedGeometryCount).toBeGreaterThan(1000);
  expect(result.disposalStats.disposedMaterialCount).toBeGreaterThan(20);
  expect(result.disposalStats.disposedTextureCount).toBeGreaterThan(10);
  expect(result.disposalStats.preservedGeometryCount).toBeGreaterThanOrEqual(1);
  expect(result.disposalStats.preservedMaterialCount).toBeGreaterThanOrEqual(1);
  expect(result.disposalStats.preservedTextureCount).toBeGreaterThanOrEqual(1);
  expect(
    result.disposalStats.disposedGeometryCount + result.disposalStats.preservedGeometryCount,
  ).toBe(result.disposalStats.geometryCount);
  expect(
    result.disposalStats.disposedMaterialCount + result.disposalStats.preservedMaterialCount,
  ).toBe(result.disposalStats.materialCount);
  expect(
    result.disposalStats.disposedTextureCount + result.disposalStats.preservedTextureCount,
  ).toBe(result.disposalStats.textureCount);
});

test('elevated drops and effects stay on their tier while lore announcements are preserved', async ({ page }) => {
  test.setTimeout(30000);
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
    const elevatedTile = game.dungeon.floorTiles.find((tile) => (
      tile.surface === 'upperConnectionBridge' && tile.elevation >= 4
    ));
    const Vector3 = game.player.root.position.constructor;
    const elevatedPosition = new Vector3(
      elevatedTile.x * game.dungeon.tileSize,
      elevatedTile.elevation,
      elevatedTile.z * game.dungeon.tileSize,
    );
    const fakeEnemy = {
      root: { position: elevatedPosition.clone() },
      isElite: true,
      level: 4,
    };
    const originalRandom = Math.random;
    Math.random = () => 0;
    const refractorStart = game.refractors.pickups.length;
    game.refractors.rollEnemyDrop(fakeEnemy);
    const refractorYs = game.refractors.pickups
      .slice(refractorStart)
      .map((pickup) => pickup.object.position.y);
    const lootObject = game.lootSystem.rollDrop(fakeEnemy);
    Math.random = originalRandom;

    const hazardStart = game.hazards.length;
    game.addFireZone(elevatedPosition.clone(), 4, 1, 1);
    const fireZone = game.hazards[hazardStart].object;
    const effectStart = game.timedEffects.length;
    game.combat._addConeEffect(elevatedPosition.clone(), new Vector3(1, 0, 0), 3, 0.5, 0xffaa33);
    const cone = game.timedEffects[effectStart].object;

    const controller = game.dungeonController;
    const encounter = controller.encounters.find((candidate) => !candidate.spawned);
    const toastCalls = [];
    const originalShowToast = game.ui.showToast;
    game.ui.showToast = (message, color) => toastCalls.push({ message, color });
    controller.environmentalStoryToastTimer = 1;
    controller.pendingRoomAnnouncements.length = 0;
    controller.markEncounterSpawned(encounter.id, []);
    const queuedBeforeLoreExpires = controller.pendingRoomAnnouncements.length;
    const immediateToastCount = toastCalls.length;
    controller._updateRoomAnnouncements(0.5);
    const toastCountDuringLore = toastCalls.length;
    controller._updateRoomAnnouncements(0.6);
    game.ui.showToast = originalShowToast;

    return {
      elevation: elevatedTile.elevation,
      refractorYs,
      lootY: lootObject.position.y,
      fireZoneY: fireZone.position.y,
      coneY: cone.position.y,
      queuedBeforeLoreExpires,
      immediateToastCount,
      toastCountDuringLore,
      toastAfterLore: toastCalls.at(-1)?.message,
      pendingAfterLore: controller.pendingRoomAnnouncements.length,
    };
  });

  expect(result.refractorYs.length).toBeGreaterThan(0);
  expect(Math.min(...result.refractorYs)).toBeGreaterThan(result.elevation + 0.4);
  expect(result.lootY).toBeCloseTo(result.elevation + 0.35, 3);
  expect(result.fireZoneY).toBeCloseTo(result.elevation + 0.035, 3);
  expect(result.coneY).toBeCloseTo(result.elevation + 0.09, 3);
  expect(result.queuedBeforeLoreExpires).toBe(1);
  expect(result.immediateToastCount).toBe(0);
  expect(result.toastCountDuringLore).toBe(0);
  expect(result.toastAfterLore).toContain('active');
  expect(result.pendingAfterLore).toBe(0);
});

test('procedural vertical solver accepts a deterministic seed sweep', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/?startupWorld=dungeon&dungeonSeed=connector-c');
  await expect
    .poll(
      async () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20000 },
    )
    .toBe('true');

  const results = await page.evaluate(async () => {
    const { DungeonGenerator } = await import('/src/DungeonGenerator.js');
    const generated = [];

    for (const seed of [...Array.from({ length: 12 }, (_, index) => index + 1), 60]) {
      let state = seed >>> 0;
      const random = () => (
        (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
      );
      let dungeon;
      try {
        dungeon = new DungeonGenerator({ random }).generate();
      } catch (error) {
        throw new Error(`deterministic connector seed ${seed} failed: ${error.message}`);
      }
      const contractedPlans = dungeon.connectionPlans.filter((plan) => plan.connectorVariant);
      const elevationPlans = contractedPlans.filter((plan) => (
        plan.connectorVariant.elevationChange === true
        && plan.connectorVariant.traversalKind !== 'walk'
      ));
      const serviceGalleryPlans = contractedPlans.filter((plan) => (
        plan.connectorVariantId === 'service_gallery_v1'
        && plan.connectorVariant.traversalKind === 'walk'
        && plan.connectorVariant.elevationChange === false
      ));
      const variedConnectionIds = new Set(elevationPlans.map((plan) => plan.id));
      const specialSurfaces = new Set(['industrialRamp', 'upperConnectionBridge']);
      const pointInsideRoom = (point, room) => {
        const halfWidth = Math.floor(room.width / 2);
        const halfDepth = Math.floor(room.depth / 2);
        return point.x >= room.x - halfWidth && point.x <= room.x + halfWidth
          && point.z >= room.z - halfDepth && point.z <= room.z + halfDepth;
      };
      const modifiedRoomTiles = dungeon.floorTiles.filter((tile) => (
        variedConnectionIds.has(tile.connectionId)
        && specialSurfaces.has(tile.surface)
        && dungeon.rooms.some((room) => pointInsideRoom(tile, room))
      ));
      const flatBufferChecks = elevationPlans.flatMap((plan) => [
        ...(plan.connectorVariant.pathContract.sourceFlatBufferPath ?? []).map((point) => ({
          point,
          expectedElevation: plan.sourceElevation,
        })),
        ...(plan.connectorVariant.pathContract.destinationFlatBufferPath ?? []).map((point) => ({
          point,
          expectedElevation: plan.destinationElevation,
        })),
      ].map(({ point, expectedElevation }) => {
        const tile = dungeon.floorTiles.find((candidate) => (
          candidate.x === point.x
          && candidate.z === point.z
          && Math.abs(Number(candidate.elevation) - Number(expectedElevation)) <= 0.05
        ));
        return Boolean(tile && !specialSurfaces.has(tile.surface));
      }));
      const connectorAssembly = dungeon.progression.validation.connectorAssembly;
      const roomById = new Map(dungeon.rooms.map((room) => [room.id, room]));
      const interiorPlans = dungeon.connectionPlans.filter((plan) => (
        !['hub', 'camp'].includes(roomById.get(plan.fromRoomId)?.type)
        && !['hub', 'camp'].includes(roomById.get(plan.toRoomId)?.type)
      ));
      const classicPlans = interiorPlans.filter((plan) => (
        (!plan.connectorVariant || plan.connectorVariant.traversalKind === 'walk')
        && ['v1_service_bay', 'v1_arch_only_corridor'].includes(
          plan.connectorPresentation?.overlayFamily,
        )
      ));
      let decorativeArchVisualCount = 0;
      const decorativeArchVisualCounts = new Map();
      const classicFurnishingVisuals = new Map();
      dungeon.group.traverse((object) => {
        if (object.userData?.connectorDecorativeArch) {
          decorativeArchVisualCount += 1;
          const connectorId = object.userData.connectorId;
          decorativeArchVisualCounts.set(
            connectorId,
            (decorativeArchVisualCounts.get(connectorId) ?? 0) + 1,
          );
        }
        if (object.userData?.classicV1CorridorFurnishing) {
          const connectorId = object.userData.connectorId;
          const visuals = classicFurnishingVisuals.get(connectorId) ?? [];
          visuals.push({
            serviceBeatId: object.userData.serviceBeatId,
            keepsTravelEnvelopeClear: object.userData.keepsTravelEnvelopeClear,
          });
          classicFurnishingVisuals.set(connectorId, visuals);
        }
      });
      const plannedDecorativeArchCount = interiorPlans.reduce((sum, plan) => (
        sum + (plan.decorativeArchBeats?.length ?? 0)
      ), 0);
      const interiorArchCoverageAccepted = interiorPlans.every((plan) => {
        const arches = [...(plan.decorativeArchBeats ?? [])].sort((a, b) => a.pathIndex - b.pathIndex);
        const archEligibleSections = (plan.galleryCrossSections ?? []).filter((section) => (
          !/(?:control|shaft|aperture)/i.test(section.connectorZone ?? '')
        ));
        const requiredCount = Math.max(1, Math.ceil(archEligibleSections.length / 3));
        return arches.length >= requiredCount
          && arches.length === (decorativeArchVisualCounts.get(plan.id) ?? 0)
          && arches.every((arch) => arch.internalClearWidthMeters >= 5.6)
          && arches.every((arch) => arch.minimumLaneHeadroomMeters >= 3.15);
      });
      const classicCorridorCoverageAccepted = classicPlans.every((plan) => {
        const serviceBeats = plan.classicV1ServiceBeats ?? [];
        const plannedBeatIds = serviceBeats
          .map((beat) => beat.id)
          .sort();
        const visuals = classicFurnishingVisuals.get(plan.id) ?? [];
        const visualBeatIds = visuals.map((visual) => visual.serviceBeatId).sort();
        const overlayFamily = plan.connectorPresentation?.overlayFamily;
        const furnishingCoverageAccepted = overlayFamily === 'v1_service_bay'
          ? (
            plannedBeatIds.length > 0
            && serviceBeats.every((beat) => {
              const serviceDistance = Math.hypot(
                beat.servicePoint.x - beat.galleryCenter.x,
                beat.servicePoint.z - beat.galleryCenter.z,
              ) * dungeon.tileSize;
              return ['pump', 'water_tank'].includes(beat.serviceKind)
                && Number.isFinite(beat.fencePoint?.x)
                && Number.isFinite(beat.fencePoint?.z)
                && Number.isFinite(beat.girderPoint?.x)
                && Number.isFinite(beat.girderPoint?.z)
                && beat.girderWidthMeters >= 5.6
                && beat.keepsTravelEnvelopeClear === true
                && beat.minimumTravelClearanceMeters > 0
                && serviceDistance - beat.serviceHalfExtentMeters + 1e-6
                  >= beat.travelEnvelopeHalfWidthMeters;
            })
            && JSON.stringify(plannedBeatIds) === JSON.stringify(visualBeatIds)
            && visuals.every((visual) => visual.keepsTravelEnvelopeClear === true)
          )
          : (
            overlayFamily === 'v1_arch_only_corridor'
            && plannedBeatIds.length === 0
            && visuals.length === 0
          );
        return plan.connectorPresentation?.baseFamily === 'v1_arch_corridor'
          && ['v1_service_bay', 'v1_arch_only_corridor'].includes(overlayFamily)
          && plan.connectorPresentation?.preservesV1Corridor === true
          && furnishingCoverageAccepted;
      });
      const upperGalleryChecks = connectorAssembly.checks.filter((check) => check.level > 0);
      const upperPlans = interiorPlans.filter((plan) => plan.level > 0);
      const upperPortalCoverageAccepted = upperPlans.every((plan) => (
        [plan.fromSocket, plan.toSocket].every((socket) => {
          const portal = dungeon.verticalPortals.find((candidate) => (
            candidate.id === socket.id && candidate.connectionId === plan.id
          ));
          return portal?.portalSpan >= 5.6
            && portal.object?.userData?.verticalPortal?.portalSpan === portal.portalSpan
            && portal.object?.userData?.verticalPortal?.connectionId === plan.id;
        })
      ));
      generated.push({
        seed,
        accepted: dungeon.progression.validation.accepted,
        errors: dungeon.progression.validation.errors,
        matchedConnections: dungeon.progression.validation.platformability.matchedConnectionCount,
        platforms: dungeon.progression.validation.platformability.platformNodeCount,
        roomIds: dungeon.rooms.map(({ id }) => id).sort(),
        connectorVariants: elevationPlans.map((plan) => plan.connectorVariantId),
        contractedConnectorCount: contractedPlans.length,
        newConnectorsPreserveV1Presentation: elevationPlans.every((plan) => (
          plan.connectorPresentation?.baseFamily === 'v1_arch_corridor'
          && plan.connectorPresentation?.overlayFamily === plan.connectorVariant?.visualFamily
          && plan.connectorPresentation?.preservesV1Corridor === true
        )),
        serviceGalleryCount: serviceGalleryPlans.length,
        serviceGalleryCoverageAccepted: serviceGalleryPlans.every((plan) => (
          plan.sourceElevation === plan.destinationElevation
          && plan.elevationDelta === 0
          && plan.direction === 'level'
          && plan.connectorPresentation?.baseFamily === 'v1_arch_corridor'
          && ['v1_service_bay', 'v1_arch_only_corridor'].includes(
            plan.connectorPresentation?.overlayFamily,
          )
          && plan.connectorPresentation?.preservesV1Corridor === true
        )),
        classicCorridorCount: classicPlans.length,
        classicCorridorCoverageAccepted,
        specialVariantCount: elevationPlans.length,
        elevationConnectorCount: elevationPlans.length,
        modifiedRoomTileCount: modifiedRoomTiles.length,
        flatBuffersRemainFlat: flatBufferChecks.every(Boolean),
        assembledConnectorCount: connectorAssembly.checkedConnectorCount,
        assembledGalleryCount: connectorAssembly.checkedGalleryCount,
        minimumGalleryWidthTiles: Math.min(
          ...connectorAssembly.checks.map((check) => check.minimumGalleryWidthTiles),
        ),
        upperGalleryCount: upperGalleryChecks.length,
        upperGalleryCoverageAccepted: upperGalleryChecks.every((check) => (
          check.galleryCrossSectionCount > 0
          && check.minimumGalleryWidthTiles >= 3
          && check.decorativeArchCount > 0
        )),
        upperPlanCount: upperPlans.length,
        upperPortalCount: dungeon.verticalPortals.length,
        upperPortalCoverageAccepted,
        interiorArchCoverageAccepted,
        plannedDecorativeArchCount,
        decorativeArchVisualCount,
        wideDoorCoverageAccepted: dungeon.doors
          .filter((door) => door.connectionPlanId)
          .every((door) => (
            door.thresholdPortalSpan >= 5.6
            && (door.alongX ? door.collisionHalfDepth : door.collisionHalfWidth) * 2
              >= door.thresholdPortalSpan
          )),
        assembledLadderCount: dungeon.ladders.length,
        plannedLadderCount: elevationPlans.filter((plan) => (
          plan.connectorVariant.traversalKind === 'ladder'
        )).length,
        assembledLiftCount: dungeon.connectorLifts.length,
        plannedLiftCount: elevationPlans.filter((plan) => (
          plan.connectorVariant.traversalKind === 'automatic_lift'
        )).length,
      });
      dungeon.group.clear();
    }

    return generated;
  });

  expect(results.every((result) => result.accepted && result.errors.length === 0)).toBe(true);
  expect(results.every((result) => result.matchedConnections >= 14)).toBe(true);
  expect(results.every((result) => result.platforms >= 11)).toBe(true);
  const expectedRoomIds = [
    'alienServerRoom',
    'bonusVault',
    'bossRoom',
    'conveyorRoom',
    'coolantRelayRoom',
    'enemyNest',
    'entrance',
    'expeditionCamp',
    'hubTown',
    'keycardRoom',
    'machineFactoryRoom',
    'shrineRoom',
    'trapRoom',
  ].sort();
  expect(results.every((result) => (
    JSON.stringify(result.roomIds) === JSON.stringify(expectedRoomIds)
  ))).toBe(true);
  expect(results.every((result) => result.elevationConnectorCount > 0)).toBe(true);
  expect(results.every((result) => (
    result.classicCorridorCount > 0
    && result.classicCorridorCoverageAccepted
    && result.serviceGalleryCount > 0
    && result.serviceGalleryCoverageAccepted
    && result.specialVariantCount > 0
    && result.newConnectorsPreserveV1Presentation
  ))).toBe(true);
  expect(results.every((result) => result.modifiedRoomTileCount === 0)).toBe(true);
  expect(results.every((result) => result.flatBuffersRemainFlat)).toBe(true);
  const structuralCoverageFailures = results.flatMap((result) => Object.entries({
    assembledGalleryCount: result.assembledGalleryCount > 0,
    minimumGalleryWidthTiles: result.minimumGalleryWidthTiles >= 3,
    upperGalleryCount: result.upperGalleryCount > 0,
    upperGalleryCoverageAccepted: result.upperGalleryCoverageAccepted,
    upperPlanCount: result.upperPlanCount > 0,
    upperPortalCount: result.upperPortalCount === result.upperPlanCount * 2,
    upperPortalCoverageAccepted: result.upperPortalCoverageAccepted,
    interiorArchCoverageAccepted: result.interiorArchCoverageAccepted,
    decorativeArchVisualParity: (
      result.plannedDecorativeArchCount === result.decorativeArchVisualCount
    ),
    wideDoorCoverageAccepted: result.wideDoorCoverageAccepted,
  }).filter(([, accepted]) => !accepted).map(([check]) => ({
    seed: result.seed,
    check,
    assembledGalleryCount: result.assembledGalleryCount,
    minimumGalleryWidthTiles: result.minimumGalleryWidthTiles,
    upperGalleryCount: result.upperGalleryCount,
    upperPlanCount: result.upperPlanCount,
    upperPortalCount: result.upperPortalCount,
    plannedDecorativeArchCount: result.plannedDecorativeArchCount,
    decorativeArchVisualCount: result.decorativeArchVisualCount,
  })));
  expect(structuralCoverageFailures).toEqual([]);
  expect(results.every((result) => (
    result.assembledConnectorCount === result.contractedConnectorCount
    && result.assembledLadderCount === result.plannedLadderCount
    && result.assembledLiftCount === result.plannedLiftCount
  ))).toBe(true);
  const generatedVariantSet = new Set(results.flatMap((result) => result.connectorVariants));
  expect(generatedVariantSet).toEqual(new Set([
    'crested_slope_v1',
    'ladder_gallery_v1',
    'automatic_lift_gallery_v1',
  ]));
});

test('server room keeps one clear perimeter ramp while its upper socket remains reachable', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?startupWorld=dungeon');
  await expect
    .poll(
      async () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20000 },
    )
    .toBe('true');

  const results = await page.evaluate(async () => {
    window.game.stop();
    const { DungeonGenerator } = await import('/src/DungeonGenerator.js');
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const generated = [];

    for (const seed of [3, 6, 10, 12]) {
      let state = seed >>> 0;
      const random = () => (
        (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
      );
      const generator = new DungeonGenerator({ random });
      const dungeon = generator.generate();
      const server = dungeon.rooms.find((room) => room.id === 'alienServerRoom');
      const blockingPlatforms = generator._createBlockingPlatformColumnMap(dungeon.floorTiles);
      const localTiles = dungeon.floorTiles.filter((tile) => (
        generator._isTileInsideRoom(tile, server)
        && !generator._isFloorTileBlockedBySolidZone(tile, dungeon.solidZones)
        && !generator._isFloorTileBlockedByGeneratedPlatform(tile, blockingPlatforms)
      ));
      const start = generator._findRoomWalkabilityStartTile(server, localTiles);
      const reachable = generator._createReachableFloorTileKeySet(start, localTiles);
      const rampTiles = localTiles.filter((tile) => tile.surface === 'industrialRamp');
      const rampColumns = new Map();
      const rampByKey = new Map();

      for (const tile of rampTiles) {
        const columnKey = `${tile.x},${tile.z}`;
        const column = rampColumns.get(columnKey) ?? [];
        column.push(tile);
        rampColumns.set(columnKey, column);
        rampByKey.set(generator._getFloorTileGraphKey(tile), tile);
      }

      const unvisited = new Set(rampByKey.keys());
      const components = [];
      for (const [startKey, startTile] of rampByKey) {
        if (!unvisited.has(startKey)) {
          continue;
        }

        const queue = [startTile];
        const component = [];
        unvisited.delete(startKey);
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          const current = queue[cursor];
          component.push(current);
          for (const [dx, dz] of directions) {
            for (const candidate of rampColumns.get(`${current.x + dx},${current.z + dz}`) ?? []) {
              const candidateKey = generator._getFloorTileGraphKey(candidate);
              if (!unvisited.has(candidateKey)
                || !generator._canTraverseBetweenFloorTiles(current, candidate)) {
                continue;
              }
              unvisited.delete(candidateKey);
              queue.push(candidate);
            }
          }
        }
        components.push(component);
      }

      const fullHeightRamps = components.filter((component) => {
        const elevations = component.flatMap((tile) => [
          tile.elevation,
          tile.rampStartElevation,
          tile.rampEndElevation,
        ]).filter(Number.isFinite);
        return Math.min(...elevations) <= 0.05
          && Math.max(...elevations) >= 4
          && component.every((tile) => reachable.has(generator._getFloorTileGraphKey(tile)));
      });
      const serverSocketChecks = dungeon.progression.validation.platformability.localSocketChecks
        .filter((check) => check.roomId === server.id);

      generated.push({
        seed,
        accepted: dungeon.progression.validation.accepted,
        errors: dungeon.progression.validation.errors,
        fullHeightRampCount: fullHeightRamps.length,
        hasCrossRoomRamp: fullHeightRamps.some((component) => (
          component.some((tile) => Math.abs(tile.rampDirectionX ?? 0) > 0)
        )),
        blockedRampCount: dungeon.floorTiles.filter((tile) => (
          tile.roomId === server.id
          && tile.surface === 'industrialRamp'
          && generator._isFloorTileBlockedBySolidZone(tile, dungeon.solidZones)
        )).length,
        allElevatedTilesReachable: localTiles
          .filter((tile) => (tile.elevation ?? 0) > 0.05)
          .every((tile) => reachable.has(generator._getFloorTileGraphKey(tile))),
        serverSocketChecks,
        upperEntranceAccessible: serverSocketChecks.some((check) => (
          check.socketId === 'enemyNest_alienServerRoom_upper_entrance'
          && check.accessibleFromOwnerRoom
        )),
      });
      dungeon.group.clear();
    }

    return generated;
  });

  expect(results.every((result) => result.accepted && result.errors.length === 0)).toBe(true);
  expect(results.every((result) => result.fullHeightRampCount === 1)).toBe(true);
  expect(results.every((result) => !result.hasCrossRoomRamp && result.blockedRampCount === 0)).toBe(true);
  expect(results.every((result) => result.allElevatedTilesReachable)).toBe(true);
  expect(results.every((result) => (
    result.serverSocketChecks.length > 0
    && result.serverSocketChecks.every((check) => check.accessibleFromOwnerRoom)
    && result.upperEntranceAccessible
  ))).toBe(true);
});

test('generated jump platforms support landing and block their unsupported underside', async ({ page }) => {
  test.setTimeout(30000);
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
    const platform = game.dungeon.platforms.find((candidate) => (
      candidate.generated && candidate.requiredTraversalAction === 'jump'
    ));
    const player = game.player;
    const under = platform.center.clone();
    under.y = platform.baseY;
    const landing = platform.center.clone();
    landing.y = platform.topY + 0.06;
    player.root.position.copy(landing);

    const landed = game._tryResolvePlatformLanding({
      player,
      root: player.root,
      jumpStartY: platform.baseY,
      jumpReachHeight: player.getJumpReachHeight(),
    });

    return {
      id: platform.id,
      purpose: platform.purpose,
      blocksBelow: platform.blocksBelow,
      underIsBlocked: game.isPositionInsidePlatformBlock(under),
      topElevation: game.getPlatformFloorElevation(player.root.position),
      topY: platform.topY,
      landed,
    };
  });

  expect(result.purpose).toBeTruthy();
  expect(result.blocksBelow).toBe(true);
  expect(result.underIsBlocked).toBe(true);
  expect(result.landed).toBe(true);
  expect(result.topElevation).toBeCloseTo(result.topY, 5);
});

test('critical closed doors remain physical choke points for their deeper rooms', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('/?startupWorld=dungeon');
  await expect
    .poll(
      async () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20000 },
    )
    .toBe('true');

  const result = await page.evaluate(async () => {
    const { game } = window;
    game.stop();
    const criticalDoorIds = new Set([
      'enemyNestGate',
      'Door_Alpha',
      'Door_Beta',
      'Door_Gamma',
      'bonusVaultDoor',
      'Door_Shrine',
    ]);

    // Exercise the runtime collision rule at the full width that its tile
    // navigation currently treats as usable. A closed door must not leave a
    // point-sized route around either side of its collider.
    const originalClosedStates = new Map(game.dungeon.doors.map((door) => [door.id, door.closed]));
    const colliderLeaks = [];
    try {
      for (const door of game.dungeon.doors.filter((candidate) => criticalDoorIds.has(candidate.id))) {
        for (const candidate of game.dungeon.doors) {
          candidate.closed = candidate.id === door.id;
        }

        const lateralOffsets = [-1, 1].map((sign) => (
          sign * ((game.dungeon.tileSize * 0.5) - 0.01)
        ));
        const walkableOffsets = lateralOffsets.filter((offset) => {
          const position = door.position.clone();
          if (door.alongX) {
            position.z += offset;
          } else {
            position.x += offset;
          }
          return game.dungeonController.isPositionWalkable(position);
        });

        if (walkableOffsets.length) {
          colliderLeaks.push({
            doorId: door.id,
            walkableOffsets: walkableOffsets.map((offset) => Number(offset.toFixed(3))),
          });
        }
      }
    } finally {
      for (const door of game.dungeon.doors) {
        door.closed = originalClosedStates.get(door.id);
      }
    }

    // Seed 1 deterministically exposes broad routes around late critical
    // doors. Remove the complete widened portal cross-section (a stronger
    // blocker than the runtime collider), leave every other door open, and
    // verify that the target room center is disconnected from the start.
    const { DungeonGenerator } = await import('/src/DungeonGenerator.js');
    let state = 1;
    const random = () => (
      (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
    );
    const generator = new DungeonGenerator({ random });
    const dungeon = generator.generate();
    const alternateRouteBypasses = [];
    const startRoom = dungeon.rooms.find((room) => room.id === 'hubTown');

    for (const door of dungeon.doors.filter((candidate) => criticalDoorIds.has(candidate.id))) {
      const doorX = Math.round(door.graphBlockingPosition.x / dungeon.tileSize);
      const doorZ = Math.round(door.graphBlockingPosition.z / dungeon.tileSize);
      const doorElevation = door.exitElevation ?? door.baseY ?? 0;
      const portalHalfSpanTiles = (door.thresholdPortalSpan ?? dungeon.tileSize) / dungeon.tileSize * 0.5;
      const floorWithoutDoorway = dungeon.floorTiles.filter((tile) => (
        !(
          (door.alongX
            ? tile.x === doorX && Math.abs(tile.z - doorZ) <= portalHalfSpanTiles + 0.01
            : tile.z === doorZ && Math.abs(tile.x - doorX) <= portalHalfSpanTiles + 0.01)
          && Math.abs((tile.elevation ?? 0) - doorElevation) <= 0.1
        )
        && !generator._isFloorTileBlockedBySolidZone(tile, dungeon.solidZones)
      ));
      const startTile = generator._findRoomWalkabilityStartTile(startRoom, floorWithoutDoorway);
      const reachable = generator._createReachableFloorTileKeySet(startTile, floorWithoutDoorway);
      const targetRoom = dungeon.rooms.find((room) => room.id === door.toRoomId);
      const targetCenterKeys = floorWithoutDoorway
        .filter((tile) => tile.x === targetRoom.x && tile.z === targetRoom.z)
        .map((tile) => generator._getFloorTileGraphKey(tile));

      if (targetCenterKeys.some((key) => reachable.has(key))) {
        alternateRouteBypasses.push({
          doorId: door.id,
          targetRoomId: door.toRoomId,
          targetCenterKeys,
        });
      }
    }

    dungeon.group.clear();
    return {
      colliderLeaks,
      alternateRouteBypasses,
    };
  });

  expect(result.colliderLeaks).toEqual([]);
  expect(result.alternateRouteBypasses).toEqual([]);
});

test('every generated door is anchored in a sealed room threshold across seeds', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?startupWorld=dungeon');
  await expect
    .poll(
      async () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20000 },
    )
    .toBe('true');

  const failures = await page.evaluate(async () => {
    window.game.stop();
    const { DungeonGenerator } = await import('/src/DungeonGenerator.js');
    const generatedFailures = [];

    for (let seed = 1; seed <= 12; seed += 1) {
      let state = seed;
      const random = () => (
        (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
      );
      const generator = new DungeonGenerator({ random });
      const dungeon = generator.generate();

      for (const door of dungeon.doors) {
        const room = dungeon.rooms.find((candidate) => candidate.id === door.toRoomId);
        const portal = door.toPortal;
        const expectedX = (portal.x + (portal.facingX ?? 0) * 0.5) * dungeon.tileSize;
        const expectedZ = (portal.z + (portal.facingZ ?? 0) * 0.5) * dungeon.tileSize;
        const graphX = portal.x * dungeon.tileSize;
        const graphZ = portal.z * dungeon.tileSize;
        const wallZones = [...(door.thresholdWallZones ?? [])].sort((left, right) => {
          const leftValue = door.alongX ? left.position.z : left.position.x;
          const rightValue = door.alongX ? right.position.z : right.position.x;
          return leftValue - rightValue;
        });
        const segmentBounds = wallZones.map((zone) => {
          const center = door.alongX ? zone.position.z : zone.position.x;
          const halfSpan = door.alongX ? zone.halfDepth : zone.halfWidth;
          return { min: center - halfSpan, max: center + halfSpan };
        });
        const halfW = Math.floor(room.width / 2);
        const halfD = Math.floor(room.depth / 2);
        const expectedMin = door.alongX
          ? (room.z - halfD - 0.5) * dungeon.tileSize
          : (room.x - halfW - 0.5) * dungeon.tileSize;
        const expectedMax = door.alongX
          ? (room.z + halfD + 0.5) * dungeon.tileSize
          : (room.x + halfW + 0.5) * dungeon.tileSize;
        const wallMeshes = ['left', 'right']
          .map((side) => door.thresholdSeal?.getObjectByName(`doorThresholdWallWing_${side}`))
          .filter(Boolean);
        const checks = {
          thresholdAnchored: door.thresholdAnchored === true,
          positionAtDestinationBoundary: (
            Math.abs(door.position.x - expectedX) < 0.001
            && Math.abs(door.position.z - expectedZ) < 0.001
          ),
          graphBlockerOnPortalTile: (
            Math.abs(door.graphBlockingPosition.x - graphX) < 0.001
            && Math.abs(door.graphBlockingPosition.z - graphZ) < 0.001
          ),
          twoWallWings: wallZones.length === 2 && wallMeshes.length === 2,
          wallSpanReachesBothRoomEdges: segmentBounds.length === 2 && (
            Math.abs(segmentBounds[0].min - expectedMin) < 0.001
            && Math.abs(segmentBounds[1].max - expectedMax) < 0.001
          ),
          onlyDoorSizedOpening: segmentBounds.length === 2 && (
            Math.abs(
              (segmentBounds[1].min - segmentBounds[0].max) - door.thresholdPortalSpan,
            ) < 0.001
          ),
          wallsArePhysical: wallZones.every((zone) => (
            dungeon.solidZones.includes(zone)
            && dungeon.aerialBoundaryZones.includes(zone)
            && zone.allowFlyOver === false
          )),
        };

        if (Object.values(checks).some((accepted) => !accepted)) {
          generatedFailures.push({ seed, doorId: door.id, checks });
        }
      }

      const physicalChecks = dungeon.progression.validation.physicalProgression.checks;
      if (
        physicalChecks.length !== 6
        || physicalChecks.some((check) => (
          !check.thresholdAnchored
          || check.thresholdWallWingCount !== 2
          || check.destinationReachableWhileClosed
        ))
      ) {
        generatedFailures.push({
          seed,
          doorId: 'physicalProgressionAudit',
          physicalChecks,
        });
      }
      dungeon.group.clear();
    }

    return generatedFailures;
  });

  expect(failures).toEqual([]);
});

test('upper connection sockets are reachable from inside their owning rooms', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('/?startupWorld=dungeon');
  await expect
    .poll(
      async () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20000 },
    )
    .toBe('true');

  const failures = await page.evaluate(async () => {
    window.game.stop();
    const { DungeonGenerator } = await import('/src/DungeonGenerator.js');
    let state = 1;
    const random = () => (
      (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
    );
    const generator = new DungeonGenerator({ random });
    const dungeon = generator.generate();
    const inaccessibleSockets = [];

    for (const connection of dungeon.connectionPlans.filter((plan) => plan.level > 0)) {
      for (const role of ['from', 'to']) {
        const socket = connection[`${role}Socket`];
        const room = dungeon.rooms.find((candidate) => candidate.id === socket.roomId);
        const localFloorTiles = dungeon.floorTiles.filter((tile) => (
          generator._isTileInsideRoom(tile, room)
          && !generator._isFloorTileBlockedBySolidZone(tile, dungeon.solidZones)
        ));
        const localStart = generator._findRoomWalkabilityStartTile(room, localFloorTiles);
        const locallyReachable = generator._createReachableFloorTileKeySet(
          localStart,
          localFloorTiles,
        );

        if (!locallyReachable.has(socket.floorKey)) {
          inaccessibleSockets.push({
            connectionId: connection.id,
            role,
            roomId: room.id,
            socketFloorKey: socket.floorKey,
            reachableLocalNodeCount: locallyReachable.size,
            totalLocalNodeCount: localFloorTiles.length,
          });
        }
      }
    }

    dungeon.group.clear();
    return inaccessibleSockets;
  });

  expect(failures).toEqual([]);
});

test('sword arm slashes preserve body facing and strike forward', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const player = game.player;
    const combat = game.combat;
    const Vector3 = player.root.position.constructor;
    const swordIndex = player.armHotbar.findIndex((item) => item?.type === 'swordArm');
    player.switchArmWeapon(swordIndex, true);

    const state = combat.getCurrentWeaponState();
    state.cooldown = 0;
    state.reloadTimer = 0;
    state.energy = state.maxEnergy;
    state.weaponOutput = state.maxWeaponOutput;
    combat.swapTimer = 0;
    combat.pendingMeleeStrikes.length = 0;
    player.animation.attackTimer = 0;
    player.animation.actionState = null;
    player.attackFacingTimer = 0;
    player.root.rotation.y = 0.73;
    player.lastMoveDirection.set(-1, 0, 0);

    const initialYaw = player.root.rotation.y;
    const expectedForward = new Vector3(Math.sin(initialYaw), 0, Math.cos(initialYaw)).normalize();
    const aimWorld = player.root.position.clone().add(new Vector3(-10, 0, 0));
    const attacked = combat.tryPrimaryAttack(aimWorld);
    const immediateYaw = player.root.rotation.y;
    const strikeDirection = combat.pendingMeleeStrikes[0]?.direction.clone() ?? new Vector3();

    for (let frame = 0; frame < 12; frame += 1) {
      player.update(1 / 60, new Set(), {
        arenaRadius: game.arenaRadius,
        movementForward: new Vector3(0, 0, 1),
        movementRight: new Vector3(1, 0, 0),
        groundY: player.root.position.y,
      });
    }

    return {
      swordIndex,
      attacked,
      initialYaw,
      immediateYaw,
      finalYaw: player.root.rotation.y,
      attackFacingTimer: player.attackFacingTimer,
      strikeForwardDot: strikeDirection.dot(expectedForward),
      strikeAimDot: strikeDirection.dot(new Vector3(-1, 0, 0)),
    };
  });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.attacked).toBe(true);
  expect(result.immediateYaw).toBeCloseTo(result.initialYaw, 5);
  expect(result.finalYaw).toBeCloseTo(result.initialYaw, 5);
  expect(result.attackFacingTimer).toBe(0);
  expect(result.strikeForwardDot).toBeGreaterThan(0.999);
  expect(result.strikeAimDot).toBeLessThan(0.95);
});

test('weapon output regeneration waits half a second after firing, not while aiming', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => window.game?.combat && window.game?.player);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const combat = game.combat;
    const state = combat.getCurrentWeaponState();
    const profile = combat._getStatefulProfile(combat._getCurrentProfile(), state);

    state.weaponOutput = state.maxWeaponOutput * 0.4;
    state.outputRecoveryDelay = 0;
    game.pointer.primary = true;
    const beforeAimRecovery = state.weaponOutput;
    combat._updateWeaponStates(0.1);
    const afterAimRecovery = state.weaponOutput;

    combat._drainWeaponOutput(state, profile, 0.05);
    const afterShot = state.weaponOutput;
    const shotDelay = state.outputRecoveryDelay;
    combat._updateWeaponStates(0.49);
    const beforeDelayExpires = state.weaponOutput;
    combat._updateWeaponStates(0.02);
    const afterDelayExpires = state.weaponOutput;
    game.pointer.primary = false;

    return {
      beforeAimRecovery,
      afterAimRecovery,
      afterShot,
      shotDelay,
      beforeDelayExpires,
      afterDelayExpires,
    };
  });

  expect(result.afterAimRecovery).toBeGreaterThan(result.beforeAimRecovery);
  expect(result.shotDelay).toBeCloseTo(0.5, 5);
  expect(result.beforeDelayExpires).toBeCloseTo(result.afterShot, 5);
  expect(result.afterDelayExpires).toBeGreaterThan(result.beforeDelayExpires);
});

test('default buster stays level on the same tier and aims up at an upper lock target', async ({ page }) => {
  test.setTimeout(30000);
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

    const { combat, player } = game;
    const weaponState = combat.getCurrentWeaponState();
    const capturedDirections = [];
    const originalFireOrQueue = combat._fireOrQueueProjectileAction;
    const originalPlayProjectileShotAnimation = player.playProjectileShotAnimation;
    const originalLockState = {
      target: combat.lockOn.target,
      progress: combat.lockOn.progress,
      movementLocked: combat.lockOn.movementLocked,
      manual: combat.lockOn.manual,
    };
    const resetWeaponState = () => {
      combat.swapTimer = 0;
      weaponState.cooldown = 0;
      weaponState.reloadTimer = 0;
      weaponState.energy = weaponState.maxEnergy;
      weaponState.weaponOutput = weaponState.maxWeaponOutput;
      weaponState.outputRecoveryDelay = 0;
    };

    try {
      combat._fireOrQueueProjectileAction = (action, direction) => {
        capturedDirections.push({
          action,
          direction: direction.clone(),
        });
      };
      player.playProjectileShotAnimation = () => {};

      const forward = player.lastMoveDirection.clone().setY(0);
      if (forward.lengthSq() <= 0.0001) {
        forward.set(0, 0, 1);
      }
      forward.normalize();

      combat.lockOn.target = null;
      combat.lockOn.progress = 0;
      combat.lockOn.movementLocked = false;
      combat.lockOn.manual = false;
      const sameTierAim = player.root.position.clone().addScaledVector(forward, 8);
      resetWeaponState();
      const sameTierStarted = combat.tryPrimaryAttack(sameTierAim);

      const upperTarget = {
        id: 'verticalAimRegressionTarget',
        dead: false,
        root: {
          parent: game.scene,
          position: player.root.position.clone()
            .addScaledVector(forward, 8)
            .add({ x: 0, y: 4.05, z: 0 }),
        },
      };
      combat.lockOn.target = upperTarget;
      combat.lockOn.progress = 1;
      combat.lockOn.movementLocked = true;
      combat.lockOn.manual = true;
      const upperAim = combat._getEffectiveAimWorld(sameTierAim).clone();
      const upperOrigin = player.getProjectileOrigin();
      const expectedUpperDirection = upperAim.clone().sub(upperOrigin).normalize();
      resetWeaponState();
      const upperStarted = combat.tryPrimaryAttack(upperAim);

      const sameTierDirection = capturedDirections[0]?.direction ?? null;
      const upperDirection = capturedDirections[1]?.direction ?? null;
      return {
        weaponType: weaponState.weaponType,
        sameTierStarted,
        upperStarted,
        sameTierDirectionY: sameTierDirection?.y ?? null,
        upperDirectionY: upperDirection?.y ?? null,
        upperAlignment: upperDirection?.dot(expectedUpperDirection) ?? null,
      };
    } finally {
      combat._fireOrQueueProjectileAction = originalFireOrQueue;
      player.playProjectileShotAnimation = originalPlayProjectileShotAnimation;
      Object.assign(combat.lockOn, originalLockState);
    }
  });

  expect(result.weaponType).toBe('busterArm');
  expect(result.sameTierStarted).toBe(true);
  expect(result.upperStarted).toBe(true);
  expect(result.sameTierDirectionY).toBeCloseTo(0, 2);
  expect(result.upperDirectionY).toBeGreaterThan(0.1);
  expect(result.upperAlignment).toBeGreaterThan(0.999);
});

test('projectile collision and homing preserve vertical separation', async ({ page }) => {
  test.setTimeout(30000);
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

    const originalEnemies = game.enemies;
    const originalDamageEnemy = game.damageEnemy;
    const origin = game.player.root.position.clone().set(12, 6, 12);
    const lowEnemy = {
      id: 'lowVerticalRegressionEnemy',
      dead: false,
      radius: 0.42,
      root: { position: origin.clone().setY(0) },
    };
    const upperEnemy = {
      id: 'upperVerticalRegressionEnemy',
      dead: false,
      radius: 0.42,
      root: { position: origin.clone() },
    };
    const projectile = {
      mesh: { position: origin.clone() },
      radius: 0.16,
      damage: 1,
      source: game.player,
      critical: false,
      element: null,
      pierceRemaining: 0,
      explosiveRadius: 0,
      armorBreakChance: 0,
      armorPierce: 0,
      stagger: 0,
      statusBuildup: 1,
      chainChance: 0,
      chainDamageMultiplier: 0,
      visualType: 'buster',
      hitEnemyIds: new Set(),
      direction: game.player.lastMoveDirection.clone().set(1, 0, 0),
    };

    try {
      game.damageEnemy = () => 1;
      game.enemies = [lowEnemy];
      const lowEnemyHit = game.projectiles._checkEnemyHit(projectile);

      projectile.hitEnemyIds.clear();
      game.enemies = [upperEnemy];
      const upperEnemyHit = game.projectiles._checkEnemyHit(projectile);

      const homingProjectile = {
        owner: 'player',
        homingStrength: 8,
        homingRange: 12,
        range: 12,
        freeHoming: false,
        target: {
          id: 'upperHomingRegressionTarget',
          dead: false,
          root: {
            position: origin.clone().set(16, 10, 12),
          },
        },
        hitEnemyIds: new Set(),
        mesh: {
          position: origin.clone(),
        },
        direction: game.player.lastMoveDirection.clone().set(1, 0, 0),
      };
      const expectedHomingDirection = homingProjectile.target.root.position.clone()
        .sub(homingProjectile.mesh.position)
        .normalize();
      const alignmentBefore = homingProjectile.direction.dot(expectedHomingDirection);
      game.projectiles._updateHoming(homingProjectile, 0.1);
      const alignmentAfter = homingProjectile.direction.dot(expectedHomingDirection);

      return {
        lowEnemyHit,
        upperEnemyHit,
        homingDirectionY: homingProjectile.direction.y,
        alignmentBefore,
        alignmentAfter,
      };
    } finally {
      game.enemies = originalEnemies;
      game.damageEnemy = originalDamageEnemy;
    }
  });

  expect(result.lowEnemyHit).toBe(false);
  expect(result.upperEnemyHit).toBe(true);
  expect(result.homingDirectionY).toBeGreaterThan(0);
  expect(result.alignmentAfter).toBeGreaterThan(result.alignmentBefore);
});
