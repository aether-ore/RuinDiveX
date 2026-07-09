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
