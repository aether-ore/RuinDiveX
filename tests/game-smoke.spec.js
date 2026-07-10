import { expect, test } from '@playwright/test';

test('loads the ruin scene and performs a fixed-height jump', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      runtimeErrors.push(message.text());
    }
  });

  await page.goto('/');
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

test('debug ledge cube is a solid 3x3x3 block with a default-height grab ledge', async ({ page }) => {
  await page.goto('/');
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

test('ledge climb anchors both hands through the baked FBX push-off', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
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
  const assertClimbHandsAnchored = (sample) => {
    for (const side of ['left', 'right']) {
      expect(Math.abs(sample[side].y - sample.topY)).toBeLessThan(0.13);
      expect(Math.abs(sample[side].z - (sample.frontZ - 0.055))).toBeLessThan(0.13);
      expect(sample.handMesh[side].edgeDistance).toBeLessThan(0.16);
    }
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

  for (const side of ['left', 'right']) {
    const before = result.prepareEnd[side];
    const after = result.climbStart[side];
    expect(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)).toBeLessThan(0.05);
    expect(result.prepareEnd.handMesh[side].edgeDistance).toBeLessThan(0.04);
    expect(result.climbStart.handMesh[side].edgeDistance).toBeLessThan(0.04);
  }

  const averageClimbStartWristY = result.climbStart.left.y;
  const averageClimbStartWristZ = result.climbStart.left.z;
  expect(result.climbStart.state).toBe('climbingUp');
  expect(Math.abs(averageClimbStartWristY - result.climbStart.topY)).toBeLessThan(0.14);
  expect(averageClimbStartWristZ).toBeLessThan(result.climbStart.frontZ);
  assertClimbHandsAnchored(result.climbStart);
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
    for (const side of ['left', 'right']) {
      const start = result.climbStart[side];
      const current = sample[side];
      expect(Math.hypot(current.x - start.x, current.y - start.y, current.z - start.z))
        .toBeLessThan(0.045);
      expect(sample.handMesh[side].edgeDistance).toBeLessThan(0.06);
    }
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
  await page.goto('/');
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
  await page.goto('/');
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
  expect(menuState.jumpHeight).toBeCloseTo(4.65, 2);
  expect(menuState.minimumGrabElevation).toBeCloseTo(4.557, 2);
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

  expect(traversal.maxY).toBeCloseTo(4.65, 1);
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
  await page.goto('/');
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
  await page.goto('/');
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

    const attempt = ({
      candidate = ledge,
      faceDistance,
      verticalDistance,
      jumpState,
      velocityY,
      progress,
      jumpStartY = 0,
      jumpReachHeight = player.getJumpReachHeight(),
    }) => {
      const jumpDirection = candidate.normal.clone().multiplyScalar(-1);
      player.ledgeCling = null;
      player.jumpState = jumpState;
      player.velocity.set(0, velocityY, 0);
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
        jumpStartY: 11.5,
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
    id: 'campLowJumpDeck-front-ledge',
    state: 'climbingUp',
    autoClimb: true,
  });
  expect(result.lateFallingLipContact.rootY).toBeGreaterThan(0.5);
  expect(result.elevatedSmallDifference).toMatchObject({
    grabbed: true,
    id: 'elevated-difference-ledge',
    state: 'climbingUp',
    autoClimb: true,
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
    state: 'climbingUp',
    autoClimb: true,
  });
  expect(result.autoClimbMotion.minimumDelta).toBeGreaterThanOrEqual(-0.001);
  expect(result.autoClimbMotion.finalY).toBeGreaterThan(result.autoClimbMotion.startY);
  expect(result.autoClimbMotion.completed).toBe(true);
});

test('pressing S from a ledge plays the wall jump and hands off to falling', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
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
  await page.goto('/');
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
        })),
      ledgeSurfaces: dungeon.platforms
        .filter((platform) => platform.generated && platform.requiredTraversalAction === 'ledge_climb')
        .map((platform) => ({
          id: platform.id,
          purpose: platform.purpose,
          blocksBelow: platform.blocksBelow,
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
  expect(result.ledgeSurfaces).toHaveLength(result.connections.length * 2);
  expect(result.ledgeSurfaces.every((platform) => platform.purpose && platform.blocksBelow === false)).toBe(true);
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
  await page.goto('/');
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
    const objectNameCounts = Object.fromEntries(requiredObjectNames.map((name) => [name, 0]));
    const largePlatformMasses = [];
    const largeSlopes = [];
    let pyramidLayerCount = 0;
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
    });

    const keycardRoom = dungeon.rooms.find((room) => room.id === 'keycardRoom');
    const pyramidCenter = keycardRoom.mechanicalPyramidCenter;
    const keycard = dungeon.keycards.find((candidate) => candidate.keycardId === 'Keycard_Alpha');
    const summitTiles = dungeon.floorTiles.filter((tile) => (
      tile.roomId === keycardRoom.id && tile.surface === 'mechanicalPyramidSummit'
    ));
    const apexTiles = dungeon.floorTiles.filter((tile) => (
      tile.roomId === keycardRoom.id && tile.surface === 'mechanicalPyramidApex'
    ));
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
      pyramidLayerCount,
      summitTileCount: summitTiles.length,
      apexTileCount: apexTiles.length,
      keycardOnPyramid: Boolean(pyramidCenter && keycard)
        && Math.abs(keycard.position.x - pyramidCenter.x * dungeon.tileSize) <= dungeon.tileSize * 1.5
        && Math.abs(keycard.position.z - pyramidCenter.z * dungeon.tileSize) <= dungeon.tileSize * 1.5
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
  expect(result.solidPurposePlatformCount).toBeGreaterThanOrEqual(result.functionalRoomCount);
  expect(result.largeSlopes.length).toBeGreaterThan(0);
  expect(result.largeSlopes.every((slope) => slope.rampTileCount >= 2 && slope.texturedWallToFloor)).toBe(true);
  expect(result.pyramidLayerCount).toBeGreaterThanOrEqual(6);
  expect(result.summitTileCount).toBe(9);
  expect(result.apexTileCount).toBe(1);
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

test('elevated drops and effects stay on their tier while lore announcements are preserved', async ({ page }) => {
  test.setTimeout(30000);
  await page.goto('/');
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
  test.setTimeout(60000);
  await page.goto('/');
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
      const dungeon = new DungeonGenerator({ random }).generate();
      generated.push({
        seed,
        accepted: dungeon.progression.validation.accepted,
        errors: dungeon.progression.validation.errors,
        matchedConnections: dungeon.progression.validation.platformability.matchedConnectionCount,
        platforms: dungeon.progression.validation.platformability.platformNodeCount,
      });
      dungeon.group.clear();
    }

    return generated;
  });

  expect(results.every((result) => result.accepted && result.errors.length === 0)).toBe(true);
  expect(results.every((result) => result.matchedConnections >= 14)).toBe(true);
  expect(results.every((result) => result.platforms >= 11)).toBe(true);
});

test('generated jump platforms support landing and block their unsupported underside', async ({ page }) => {
  test.setTimeout(30000);
  await page.goto('/');
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
  await page.goto('/');
  await expect
    .poll(
      async () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20000 },
    )
    .toBe('true');

  const result = await page.evaluate(async () => {
    const { game } = window;
    game.stop();
    const criticalDoorIds = new Set(['Door_Alpha', 'Door_Beta', 'Door_Gamma', 'Door_Shrine']);

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
    // doors. Remove the whole doorway tile (a stronger blocker than the
    // runtime collider), leave every other door open, and verify that the
    // target room center is disconnected from the dungeon start.
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
      const doorX = Math.round(door.position.x / dungeon.tileSize);
      const doorZ = Math.round(door.position.z / dungeon.tileSize);
      const doorElevation = door.exitElevation ?? door.baseY ?? 0;
      const floorWithoutDoorway = dungeon.floorTiles.filter((tile) => (
        !(
          tile.x === doorX
          && tile.z === doorZ
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

test('upper connection sockets are reachable from inside their owning rooms', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('/');
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

test('default buster stays level on the same tier and aims up at an upper lock target', async ({ page }) => {
  test.setTimeout(30000);
  await page.goto('/');
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
  await page.goto('/');
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
