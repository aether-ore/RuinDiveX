import { expect, test } from '@playwright/test';

const JUMP_SLASH = 'swordJumpSlash';
const OPENING_SLASH = 'swordForwardSlash';
const JUMP_SLASH_DURATION = 0.86;
const JUMP_SLASH_STRIKE_PROGRESS = 0.5;
const JUMP_SLASH_TRAIL_START = 24 / 56;
const JUMP_SLASH_SEAM_PROGRESS = 32 / 56;
const JUMP_SLASH_TRAIL_END = 37 / 56;
const JUMP_SLASH_RECOVERY_DURATION = JUMP_SLASH_DURATION * (1 - JUMP_SLASH_SEAM_PROGRESS);
const JUMP_SLASH_AERIAL_POSE = Object.freeze({
  hips: Object.freeze({ pitch: 16.2, yaw: 10, roll: -5.6 }),
  spine: Object.freeze({ pitch: -0.95, yaw: 1, roll: 0.9 }),
  neck: Object.freeze({ pitch: 2.4, yaw: 2.2, roll: -6.6 }),
  leftShoulder: Object.freeze({ pitch: 16.7, yaw: 2.6, roll: 34.5 }),
  leftElbow: Object.freeze({ pitch: -18.3, yaw: 23.3, roll: 9.3 }),
  leftWrist: Object.freeze({ pitch: 0.6, yaw: -22.3, roll: 6.8 }),
  rightShoulder: Object.freeze({ pitch: 29.6, yaw: 23.2, roll: 5.7 }),
  rightElbow: Object.freeze({ pitch: 5.6, yaw: 42.9, roll: 2.7 }),
  rightWrist: Object.freeze({ pitch: -19.4, yaw: -2.2, roll: 49.7 }),
  leftHip: Object.freeze({ pitch: 88, yaw: -10.5, roll: -7.5 }),
  leftKnee: Object.freeze({ pitch: -96.5, yaw: 1.5, roll: 4.5 }),
  leftAnkle: Object.freeze({ pitch: -12.6, yaw: 7.2, roll: 5.6 }),
  rightHip: Object.freeze({ pitch: 88.4, yaw: -31.6, roll: -16.3 }),
  rightKnee: Object.freeze({ pitch: -129.2, yaw: 10.8, roll: 4.6 }),
  rightAnkle: Object.freeze({ pitch: -19.6, yaw: -2.3, roll: 0.9 }),
});
const JUMP_SLASH_FALLBACK = Object.freeze({
  motionLocal: Object.freeze([-0.512142, -0.852924, -0.101154]),
  planeNormalLocal: Object.freeze([-0.820581, 0.451102, 0.350933]),
  centerLocal: Object.freeze([-0.835155, 1.967038, 0.294638]),
  range: 2.25,
  arcHalfAngle: 1.857862,
});

async function openLoadedGame(page) {
  await page.goto('/');
  await page.waitForFunction(() => (
    window.game?.player?._fbxAnimationLibraryLoaded === true
    && window.game?.player?._busterArmLoaded === true
  ));
}

async function installJumpSlashHarness(page) {
  await page.evaluate(({ jumpSlash, targetPose }) => {
    window.__createJumpSlashHarness = (configuration = {}) => {
      const { game } = window;
      game.stop();
      game.isPlayerInSafeArea = () => false;
      game.enemies = [];

      const { player, combat } = game;
      const rig = player.externalRig;
      const Vector3 = player.root.position.constructor;
      const Quaternion = player.root.quaternion.constructor;
      const Euler = player.root.rotation.constructor;
      const forward = new Vector3(...(configuration.forward ?? [0, 0, 1])).normalize();
      const right = new Vector3(forward.z, 0, -forward.x).normalize();
      const spawn = game.dungeon.playerStart.clone();
      const groundY = spawn.y;
      const defaultDt = configuration.dt ?? (1 / 240);
      const noInput = new Set();
      const movementOptions = {
        arenaRadius: game.arenaRadius,
        movementForward: forward,
        movementRight: right,
        groundY,
        game,
      };

      const swordIndex = player.armHotbar.findIndex((item) => item?.type === 'swordArm');
      player.switchArmWeapon(swordIndex, true);
      const state = combat.getCurrentWeaponState();
      const profile = combat._getStatefulProfile(combat._getCurrentProfile(), state);
      const expectedOutputCost = combat._getOutputCost(profile);
      const clip = rig.animationClips.get(jumpSlash);
      const hipsTrack = clip?.tracks.find((track) => (
        track.name.toLowerCase().includes('hips.position')
      ));
      const sourceStartHips = new Vector3().fromArray(
        Array.from(hipsTrack?.values?.slice(0, 3) ?? [0, 0, 0]),
      );
      let elapsed = 0;

      const clearPointer = () => {
        Object.assign(game.pointer, {
          primary: false,
          primaryPressed: false,
          secondary: false,
          secondaryPressed: false,
          lockOnPressed: false,
          alternate: false,
          alternatePressed: false,
        });
        game.pointer.aimWorld.copy(player.root.position).addScaledVector(forward, 10);
      };

      const refill = (energy = Math.max(6, state.maxEnergy)) => {
        state.cooldown = 0;
        state.reloadTimer = 0;
        state.energy = energy;
        state.weaponOutput = state.maxWeaponOutput;
        state.outputRecoveryDelay = 0;
        combat.swapTimer = 0;
        combat.suppressPrimaryUntilRelease = false;
      };

      const clearAttack = () => {
        combat._clearPendingAttacks();
        combat._resetSwordCombo?.();
        player.cancelSwordJumpSlashVisual?.({ cancelAttack: true });
        player.animation.cancelAttack();
        player.animation.hurtTimer = 0;
        player._attackWeaponKind = null;
        player._activeSwordSlashClipKey = null;
        player.movementLockTimer = 0;
        player.movementLockMultiplier = 1;
        rig.clearJumpSlashAerialOverrides?.();
      };

      const resetGrounded = () => {
        clearAttack();
        player.dead = false;
        player.animation.dead = false;
        player.ledgeCling = null;
        player.jumpLedgeClingResolver = null;
        player.jumpPlatformLandingResolver = null;
        player.externalControl = null;
        player.root.position.copy(spawn);
        player.root.rotation.set(0, 0, 0);
        player.modelRoot.position.set(0, 0, 0);
        player.modelRoot.rotation.set(0, 0, 0);
        player.velocity.set(0, 0, 0);
        player.takeoffHorizontalVelocity?.set(0, 0, 0);
        player.jumpState = 'Grounded';
        player._jumpGroundY = groundY;
        player._jumpBufferTimer = 0;
        player._coyoteTimer = player.jumpSettings.coyoteTime;
        player._landingRecoveryTimer = 0;
        player._jumpAirTimer = 0;
        player._jumpFallTransitionActive = false;
        player.animation.actionState = null;
        player.animation.actionTimer = 0;
        player.animation.actionDuration = 0;
        player.animation.setState('idle');
        player.lastMoveDirection.copy(forward);
        player.faceDirection(forward);
        combat.jumpSlashUsedThisAirtime = false;
        refill();
        clearPointer();
        combat.update(0);
        elapsed = 0;
      };

      const tick = (dt = defaultDt, input = noInput) => {
        elapsed += dt;
        player.update(dt, input, movementOptions);
        combat.update(dt);
        game._updateTimedEffects(dt);
      };

      const beginNormalJump = (input = noInput) => {
        const started = player.tryJump(input, movementOptions);
        tick(defaultDt, input);
        return started;
      };

      const beginFalling = (intendedAirTime = 1.1) => {
        resetGrounded();
        const fallGravity = player._getJumpGravity() * player._getFallGravityMultiplier();
        const startingHeight = 0.5 * Math.abs(fallGravity) * intendedAirTime * intendedAirTime;
        player.root.position.y = groundY + startingHeight;
        player.velocity.set(0, 0, 0);
        player.jumpState = 'Falling';
        player._jumpGroundY = groundY;
        player._jumpAirTimer = player._getEstimatedJumpAirTime() * 0.7;
        player._jumpFallTransitionActive = false;
        game.pointer.aimWorld.copy(player.root.position).addScaledVector(forward, 10);
        return { intendedAirTime, startingHeight, fallGravity };
      };

      const poseError = () => {
        let maximum = 0;
        let missing = 0;
        const semanticBones = [];
        for (const [jointName, pose] of Object.entries(targetPose)) {
          const joint = rig.joints.get(jointName);
          const rest = joint ? rig.restLocalQuaternions.get(joint) : null;
          if (!joint || !rest) {
            missing += 1;
            continue;
          }
          semanticBones.push(joint.uuid);
          const expectedDelta = new Quaternion().setFromEuler(new Euler(
            pose.pitch * Math.PI / 180,
            pose.yaw * Math.PI / 180,
            pose.roll * Math.PI / 180,
            joint.rotation.order,
          ));
          const actualDelta = rest.clone().invert().multiply(joint.quaternion).normalize();
          maximum = Math.max(
            maximum,
            actualDelta.angleTo(expectedDelta) * 180 / Math.PI,
          );
        }
        return {
          maximum,
          missing,
          uniqueSemanticBones: new Set(semanticBones).size,
        };
      };

      const actionProgress = () => (
        clip?.duration > 0 ? (rig.activeAction?.time ?? 0) / clip.duration : null
      );

      const countJumpSlashMeshes = () => {
        let count = 0;
        game.scene.traverse((object) => {
          if (object.userData?.slashClipKey === jumpSlash) count += 1;
        });
        return count;
      };

      const installProbe = () => {
        const begins = [];
        const appends = [];
        const finishes = [];
        const cancels = [];
        const staticFallbacks = [];
        const strikes = [];
        const ids = new WeakMap();
        let nextId = 1;
        const getId = (handle) => {
          if (!handle || typeof handle !== 'object') return null;
          if (!ids.has(handle)) ids.set(handle, nextId++);
          return ids.get(handle);
        };

        const originalBegin = game.beginBeamBladeSweepTrail.bind(game);
        const originalAppend = game.appendBeamBladeSweepTrail.bind(game);
        const originalFinish = game.finishBeamBladeSweepTrail.bind(game);
        const originalCancel = game.cancelBeamBladeSweepTrail.bind(game);
        const originalSlashEffect = game.addSlashEffect.bind(game);
        const originalMelee = combat._meleeAttackDirection.bind(combat);

        game.beginBeamBladeSweepTrail = (...args) => {
          const options = args[1] ?? {};
          const handle = originalBegin(...args);
          if (options.slashClipKey === jumpSlash) {
            begins.push({
              id: getId(handle),
              elapsed,
              phase: player._jumpSlashVisualState?.phase ?? null,
              progress: player.getSwordJumpSlashVisualProgress?.() ?? null,
              airborne: player.isJumpAirborne(),
              startProgress: options.startProgress ?? null,
              endProgress: options.endProgress ?? null,
              optionsFollowRoot: options.followObject === player.root,
              handleFollowRoot: handle?.followObject === player.root,
              glowParentRoot: handle?.glow?.parent === player.root,
              coreParentRoot: handle?.core?.parent === player.root,
              trailSpace: handle?.glow?.userData?.trailSpace ?? null,
            });
          }
          return handle;
        };

        const ribbonGeometryError = (mesh, ratio, sampleIndex, baseWorld, tipWorld) => {
          if (!mesh?.geometry?.attributes?.position || sampleIndex < 0) return Infinity;
          mesh.updateWorldMatrix(true, false);
          const position = mesh.geometry.attributes.position;
          const offset = sampleIndex * 2;
          const renderedInner = new Vector3(
            position.getX(offset),
            position.getY(offset),
            position.getZ(offset),
          ).applyMatrix4(mesh.matrixWorld);
          const renderedTip = new Vector3(
            position.getX(offset + 1),
            position.getY(offset + 1),
            position.getZ(offset + 1),
          ).applyMatrix4(mesh.matrixWorld);
          const expectedInner = baseWorld.clone().lerp(tipWorld, ratio);
          return Math.max(
            renderedInner.distanceTo(expectedInner),
            renderedTip.distanceTo(tipWorld),
          );
        };

        game.appendBeamBladeSweepTrail = (...args) => {
          const [handle, baseWorld, tipWorld, progress] = args;
          const beforeCount = handle?.samples?.length ?? 0;
          const result = originalAppend(...args);
          const afterCount = handle?.samples?.length ?? 0;
          if (handle?.clipKey === jumpSlash) {
            const accepted = afterCount > beforeCount;
            const sample = accepted ? handle.samples[afterCount - 1] : null;
            let localSampleError = null;
            let worldMetadataError = null;
            let geometryError = null;
            if (accepted) {
              const expectedBaseLocal = baseWorld.clone();
              const expectedTipLocal = tipWorld.clone();
              if (handle.followObject?.isObject3D) {
                handle.followObject.worldToLocal(expectedBaseLocal);
                handle.followObject.worldToLocal(expectedTipLocal);
              }
              localSampleError = Math.max(
                sample.base.distanceTo(expectedBaseLocal),
                sample.tip.distanceTo(expectedTipLocal),
              );
              worldMetadataError = Math.max(
                sample.baseWorld?.distanceTo(baseWorld) ?? Infinity,
                sample.tipWorld?.distanceTo(tipWorld) ?? Infinity,
              );
              geometryError = Math.max(
                ribbonGeometryError(handle.glow, 0.24, afterCount - 1, baseWorld, tipWorld),
                ribbonGeometryError(handle.core, 0.76, afterCount - 1, baseWorld, tipWorld),
              );
            }
            appends.push({
              id: getId(handle),
              elapsed,
              accepted,
              progress: Number.isFinite(progress) ? progress : null,
              phase: player._jumpSlashVisualState?.phase ?? null,
              airborne: player.isJumpAirborne(),
              rootY: player.root.position.y,
              localSampleError,
              worldMetadataError,
              geometryError,
              followRoot: handle.followObject === player.root,
              glowParentRoot: handle.glow?.parent === player.root,
              coreParentRoot: handle.core?.parent === player.root,
              trailSpace: handle.glow?.userData?.trailSpace ?? null,
            });
          }
          return result;
        };

        game.finishBeamBladeSweepTrail = (handle, ...args) => {
          if (handle?.clipKey === jumpSlash) {
            finishes.push({
              id: getId(handle),
              elapsed,
              phase: player._jumpSlashVisualState?.phase ?? null,
              progress: player.getSwordJumpSlashVisualProgress?.() ?? null,
              airborne: player.isJumpAirborne(),
              sampleCount: handle.samples?.length ?? 0,
            });
          }
          return originalFinish(handle, ...args);
        };

        game.cancelBeamBladeSweepTrail = (handle, ...args) => {
          if (handle?.clipKey === jumpSlash) {
            cancels.push({
              id: getId(handle),
              elapsed,
              phase: player._jumpSlashVisualState?.phase ?? null,
              progress: player.getSwordJumpSlashVisualProgress?.() ?? null,
              sampleCount: handle.samples?.length ?? 0,
            });
          }
          return originalCancel(handle, ...args);
        };

        game.addSlashEffect = (...args) => {
          const options = args[4] ?? {};
          const isJumpSlash = options.slashClipKey === jumpSlash;
          const before = new Set();
          if (isJumpSlash) game.scene.traverse((object) => before.add(object));
          const result = originalSlashEffect(...args);
          if (isJumpSlash) {
            const meshes = [];
            game.scene.traverse((object) => {
              if (before.has(object) || object.userData?.slashClipKey !== jumpSlash) return;
              const parameters = object.geometry?.parameters ?? {};
              meshes.push({
                mode: object.userData?.trailMode ?? null,
                parentRoot: object.parent === player.root,
                innerRadius: parameters.innerRadius ?? null,
                outerRadius: parameters.outerRadius ?? null,
                thetaStart: parameters.thetaStart ?? null,
                thetaLength: parameters.thetaLength ?? null,
              });
            });
            staticFallbacks.push({
              elapsed,
              airborne: player.isJumpAirborne(),
              followRoot: options.followObject === player.root,
              range: options.visualRange ?? null,
              arcHalfAngle: options.arcAngle ?? null,
              motionLocal: options.trailMotionLocal ? [...options.trailMotionLocal] : null,
              planeNormalLocal: options.trailPlaneNormalLocal
                ? [...options.trailPlaneNormalLocal]
                : null,
              centerLocal: options.trailCenterLocal ? [...options.trailCenterLocal] : null,
              meshes,
            });
          }
          return result;
        };

        combat._meleeAttackDirection = (...args) => {
          if (args[2]?.slashClipKey === jumpSlash) {
            strikes.push({
              elapsed,
              airborne: player.isJumpAirborne(),
              visualProgress: player.getSwordJumpSlashVisualProgress?.() ?? null,
              attackTimerProgress: player.animation.attackDuration > 0
                ? 1 - player.animation.attackTimer / player.animation.attackDuration
                : null,
              activeTrailSampleCount: combat.activeSwordSweepTrail?.handle?.samples?.length ?? 0,
            });
          }
          return originalMelee(...args);
        };

        return { begins, appends, finishes, cancels, staticFallbacks, strikes };
      };

      resetGrounded();
      return {
        game,
        player,
        combat,
        rig,
        state,
        profile,
        clip,
        hipsTrack,
        sourceStartHips,
        forward,
        right,
        spawn,
        groundY,
        movementOptions,
        noInput,
        defaultDt,
        swordIndex,
        expectedOutputCost,
        refill,
        clearAttack,
        resetGrounded,
        tick,
        beginNormalJump,
        beginFalling,
        poseError,
        actionProgress,
        countJumpSlashMeshes,
        installProbe,
        get elapsed() { return elapsed; },
      };
    };
  }, {
    jumpSlash: JUMP_SLASH,
    targetPose: JUMP_SLASH_AERIAL_POSE,
  });
}

test('jump slash keeps the full clip, strips horizontal root travel, and caches its source anchor', async ({ page }) => {
  await openLoadedGame(page);

  const result = await page.evaluate(({ jumpSlash, seamProgress }) => {
    const rig = window.game.player.externalRig;
    const metadata = rig.animationMetadata.get(jumpSlash);
    const clip = rig.animationClips.get(jumpSlash);
    const action = rig.animationActions.get(jumpSlash);
    const hipsTrack = clip?.tracks.find((track) => (
      track.name.toLowerCase().includes('hips.position')
    ));
    const axisStats = [0, 1, 2].map((axis) => {
      const values = [];
      for (let index = axis; index < (hipsTrack?.values?.length ?? 0); index += 3) {
        values.push(hipsTrack.values[index]);
      }
      return {
        first: values[0] ?? null,
        minimum: values.length ? Math.min(...values) : null,
        maximum: values.length ? Math.max(...values) : null,
        range: values.length ? Math.max(...values) - Math.min(...values) : null,
      };
    });
    const seamSample = hipsTrack?.createInterpolant?.().evaluate(clip.duration * seamProgress);
    return {
      metadata: metadata ? {
        loop: metadata.loop,
        lockRootY: metadata.lockRootY,
        rootYMode: metadata.rootYMode,
        preserveRootMotion: metadata.preserveRootMotion,
        extractRootMotion: metadata.extractRootMotion,
        hasSubclip: Boolean(metadata.subclip),
      } : null,
      duration: clip?.duration ?? null,
      trackCount: clip?.tracks?.length ?? 0,
      hipsSampleCount: (hipsTrack?.values?.length ?? 0) / 3,
      axisStats,
      sourceStart: hipsTrack?.values?.length >= 3
        ? Array.from(hipsTrack.values.slice(0, 3))
        : null,
      cachedAnchor: rig.jumpSlashAerialHipsPosition?.toArray?.() ?? null,
      cachedSeam: rig.jumpSlashAerialSeamHipsPosition?.toArray?.() ?? null,
      seamSample: seamSample ? Array.from(seamSample) : null,
      restHips: rig.joints.get('hips')?.userData?.restLocalPosition?.toArray?.() ?? null,
      clampWhenFinished: action?.clampWhenFinished ?? null,
    };
  }, { jumpSlash: JUMP_SLASH, seamProgress: JUMP_SLASH_SEAM_PROGRESS });

  expect(result.metadata).toEqual({
    loop: false,
    lockRootY: true,
    rootYMode: 'compressionOnly',
    preserveRootMotion: false,
    extractRootMotion: false,
    hasSubclip: false,
  });
  expect(result.clampWhenFinished).toBe(true);
  expect(result.duration).toBeCloseTo(2.333333, 4);
  expect(result.trackCount).toBeGreaterThan(0);
  expect(result.hipsSampleCount).toBeGreaterThanOrEqual(56);
  expect(result.axisStats[0].range).toBeLessThan(0.000001);
  expect(result.axisStats[2].range).toBeLessThan(0.000001);
  expect(result.axisStats[1].first).toBeCloseTo(0.913192, 5);
  expect(result.axisStats[1].maximum).toBeCloseTo(result.axisStats[1].first, 6);
  expect(result.axisStats[1].range).toBeGreaterThan(0.5);
  expect(result.cachedAnchor).toEqual(result.sourceStart);
  expect(result.cachedSeam).toEqual(result.seamSample);
  expect(result.cachedAnchor[1]).not.toBeCloseTo(result.restHips[1], 3);
});

test('rising and falling attacks allow one standalone jump slash per airtime', async ({ page }) => {
  await openLoadedGame(page);
  await installJumpSlashHarness(page);

  const result = await page.evaluate(({ jumpSlash, openingSlash }) => {
    const h = window.__createJumpSlashHarness();
    const { player, combat, state, rig } = h;

    const jumped = h.beginNormalJump();
    const risingState = player.jumpState;
    const energyBefore = state.energy;
    const outputBefore = state.weaponOutput;
    const risingStarted = combat.tryPrimaryAttack(window.game.pointer.aimWorld);
    const energyAfterRising = state.energy;
    const outputAfterRising = state.weaponOutput;
    h.tick();
    const risingClip = rig.activeClipKey;
    const comboAfterRising = { ...combat.swordCombo };
    const pendingAfterRising = combat.pendingMeleeStrikes.length;

    h.refill();
    const secondEnergyBefore = state.energy;
    const secondOutputBefore = state.weaponOutput;
    const secondPendingBefore = combat.pendingMeleeStrikes.length;
    const secondSameAirtime = combat.tryPrimaryAttack(window.game.pointer.aimWorld);
    const secondSnapshot = {
      energySpent: secondEnergyBefore - state.energy,
      outputSpent: secondOutputBefore - state.weaponOutput,
      pendingDelta: combat.pendingMeleeStrikes.length - secondPendingBefore,
    };

    for (let frame = 0; frame < 480; frame += 1) {
      h.tick();
      if (player.jumpState === 'Grounded'
        && player.animation.attackTimer <= 0
        && !player.isSwordJumpSlashVisualActive()) break;
    }
    const firstAirtimeFinished = player.jumpState === 'Grounded'
      && !player.isSwordJumpSlashVisualActive();
    const comboAfterJump = { ...combat.swordCombo };

    h.refill();
    const groundedStarted = combat.tryPrimaryAttack(window.game.pointer.aimWorld);
    h.tick();
    const groundedClip = rig.activeClipKey;

    h.beginFalling(1.1);
    h.refill(0);
    const failedForEnergy = combat.tryPrimaryAttack(window.game.pointer.aimWorld);
    const allowanceAfterFailure = combat.jumpSlashUsedThisAirtime;
    const pendingAfterFailure = combat.pendingMeleeStrikes.length;
    h.refill();
    const fallingStarted = combat.tryPrimaryAttack(window.game.pointer.aimWorld);
    h.tick();
    const fallingClip = rig.activeClipKey;

    return {
      swordIndex: h.swordIndex,
      jumped,
      risingState,
      risingStarted,
      risingClip,
      energySpent: energyBefore - energyAfterRising,
      outputSpent: outputBefore - outputAfterRising,
      expectedEnergyCost: h.profile.energyCost,
      expectedOutputCost: h.expectedOutputCost,
      comboAfterRising,
      pendingAfterRising,
      secondSameAirtime,
      secondSnapshot,
      firstAirtimeFinished,
      comboAfterJump,
      groundedStarted,
      groundedClip,
      failedForEnergy,
      allowanceAfterFailure,
      pendingAfterFailure,
      fallingStarted,
      fallingClip,
      comboAfterFalling: { ...combat.swordCombo },
      allowanceAfterFalling: combat.jumpSlashUsedThisAirtime,
    };
  }, { jumpSlash: JUMP_SLASH, openingSlash: OPENING_SLASH });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result).toEqual(expect.objectContaining({
    jumped: true,
    risingState: 'Rising',
    risingStarted: true,
    risingClip: JUMP_SLASH,
    pendingAfterRising: 1,
    secondSameAirtime: false,
    firstAirtimeFinished: true,
    groundedStarted: true,
    groundedClip: OPENING_SLASH,
    failedForEnergy: false,
    allowanceAfterFailure: false,
    pendingAfterFailure: 0,
    fallingStarted: true,
    fallingClip: JUMP_SLASH,
    allowanceAfterFalling: true,
  }));
  expect(result.energySpent).toBe(result.expectedEnergyCost);
  expect(result.outputSpent).toBeCloseTo(result.expectedOutputCost, 6);
  expect(result.secondSnapshot).toEqual({
    energySpent: 0,
    outputSpent: 0,
    pendingDelta: 0,
  });
  expect(result.comboAfterRising.awaitingFollowUp).toBe(false);
  expect(result.comboAfterJump.awaitingFollowUp).toBe(false);
  expect(result.comboAfterFalling.awaitingFollowUp).toBe(false);
});

test('jump slash stages wind-up, held pose, and two root-local ribbon epochs through landing', async ({ page }) => {
  await openLoadedGame(page);
  await installJumpSlashHarness(page);

  const result = await page.evaluate(({
    seamProgress,
    trailStart,
    trailEnd,
  }) => {
    const h = window.__createJumpSlashHarness({
      dt: 1 / 240,
      forward: [0.6, 0, 0.8],
    });
    const { player, combat, rig, state } = h;
    const probe = h.installProbe();
    const jumped = h.beginNormalJump();
    const attackStartedAt = h.elapsed;
    const energyBefore = state.energy;
    const outputBefore = state.weaponOutput;
    const started = combat.tryPrimaryAttack(window.game.pointer.aimWorld);
    const energyAfter = state.energy;
    const outputAfter = state.weaponOutput;
    const initialTrailState = {
      progressSource: combat.activeSwordSweepTrail?.progressSource ?? null,
      startProgress: combat.activeSwordSweepTrail?.startProgress ?? null,
      endProgress: combat.activeSwordSweepTrail?.endProgress ?? null,
      followRoot: combat.activeSwordSweepTrail?.followObject === player.root,
    };

    // AnimationController pauses attackTimer while hurtTimer is active. The
    // jump-slash visual timeline and its trail must remain independent of it.
    player.animation.hurtTimer = 0.12;

    let previousWindupProgress = -Infinity;
    let windupMonotonic = true;
    let windupFrames = 0;
    let windupMaximumProgress = 0;
    let windupMaximumActionSyncError = 0;
    let windupMaximumHipsError = 0;
    let windupMaximumPoseError = 0;
    let windupAllRootAnchored = true;
    let windupAllPoseMarkersOff = true;
    let holdFrames = 0;
    let holdMaximumPoseError = 0;
    let holdMaximumHipsError = 0;
    let holdMaximumActionError = 0;
    let holdAllMarkersOn = true;
    let holdAllEquipmentVisible = true;
    let semanticPoseCheck = null;
    let touchdown = null;
    let recoveryStartedAt = null;
    let recoveryFinishedAt = null;
    let recoveryFrames = 0;
    let firstRecoveryProgress = null;
    let maximumRecoveryProgress = 0;
    let previousRecoveryProgress = seamProgress;
    let recoveryMonotonic = true;
    let allRecoveryBladeVisible = true;
    let maximumGroundedFootError = 0;
    let minimumLeftFootClearance = Infinity;
    let minimumRightFootClearance = Infinity;

    for (let frame = 0; frame < 720; frame += 1) {
      const wasAirborne = player.isJumpAirborne();
      h.tick();
      const visual = player._jumpSlashVisualState;
      const progress = visual?.visualProgress ?? null;

      if (visual && player.isJumpAirborne() && visual.phase === 'airborneWindup') {
        windupFrames += 1;
        windupMonotonic &&= progress + 0.000001 >= previousWindupProgress;
        previousWindupProgress = progress;
        windupMaximumProgress = Math.max(windupMaximumProgress, progress);
        windupMaximumActionSyncError = Math.max(
          windupMaximumActionSyncError,
          Math.abs(h.actionProgress() - progress),
        );
        windupMaximumHipsError = Math.max(
          windupMaximumHipsError,
          rig.joints.get('hips').position.distanceTo(h.sourceStartHips),
        );
        windupMaximumPoseError = Math.max(windupMaximumPoseError, h.poseError().maximum);
        windupAllRootAnchored &&= rig.root.userData.jumpSlashAirborneRootAnchorActive === true;
        windupAllPoseMarkersOff &&= rig.root.userData.jumpSlashAerialPoseActive === false;
      }

      if (visual && player.isJumpAirborne() && visual.phase === 'airborneHold') {
        const poseCheck = h.poseError();
        semanticPoseCheck ??= poseCheck;
        holdFrames += 1;
        holdMaximumPoseError = Math.max(holdMaximumPoseError, poseCheck.maximum);
        holdMaximumHipsError = Math.max(
          holdMaximumHipsError,
          rig.joints.get('hips').position.distanceTo(h.sourceStartHips),
        );
        holdMaximumActionError = Math.max(
          holdMaximumActionError,
          Math.abs(h.actionProgress() - seamProgress),
        );
        holdAllMarkersOn &&= Boolean(
          rig.root.userData.jumpSlashAerialPoseActive
          && rig.root.userData.jumpSlashAirborneRootAnchorActive
        );
        holdAllEquipmentVisible &&= Boolean(
          rig.busterArmGroup?.visible && rig.beamBladeGroup?.visible
        );
      }

      if (wasAirborne && !player.isJumpAirborne() && !touchdown) {
        const grounding = player.getExternalModelGroundingDiagnostics?.();
        touchdown = {
          elapsed: h.elapsed,
          phase: visual?.phase ?? null,
          visualProgress: progress,
          actionProgress: h.actionProgress(),
          poseError: h.poseError().maximum,
          hipsDistanceFromAnchor: rig.joints.get('hips').position.distanceTo(h.sourceStartHips),
          poseMarker: rig.root.userData.jumpSlashAerialPoseActive,
          rootAnchorMarker: rig.root.userData.jumpSlashAirborneRootAnchorActive,
          reason: grounding?.reason ?? null,
          beforeFootClearance: grounding?.beforeFootClearance ?? null,
          footClearance: grounding?.footClearance ?? null,
          correction: grounding?.correction ?? null,
          attackTimer: player.animation.attackTimer,
        };
        recoveryStartedAt = h.elapsed;
      }

      if (visual && !player.isJumpAirborne() && visual.phase === 'groundedRecovery') {
        recoveryFrames += 1;
        const progressNow = h.actionProgress();
        firstRecoveryProgress ??= progressNow;
        maximumRecoveryProgress = Math.max(maximumRecoveryProgress, progressNow);
        recoveryMonotonic &&= progressNow + 0.000001 >= previousRecoveryProgress;
        previousRecoveryProgress = progressNow;
        allRecoveryBladeVisible &&= Boolean(rig.beamBladeGroup?.visible);
        const grounding = player.getExternalModelGroundingDiagnostics?.();
        maximumGroundedFootError = Math.max(
          maximumGroundedFootError,
          Math.abs(grounding?.footClearance ?? 0),
        );
        if (Number.isFinite(grounding?.leftFootClearance)) {
          minimumLeftFootClearance = Math.min(
            minimumLeftFootClearance,
            grounding.leftFootClearance,
          );
        }
        if (Number.isFinite(grounding?.rightFootClearance)) {
          minimumRightFootClearance = Math.min(
            minimumRightFootClearance,
            grounding.rightFootClearance,
          );
        }
      }

      if (touchdown
        && !player.isSwordJumpSlashVisualActive()
        && player.jumpState === 'Grounded') {
        recoveryFinishedAt = h.elapsed;
        break;
      }
    }

    const accepted = probe.appends.filter((sample) => sample.accepted);
    const ids = [...new Set(accepted.map((sample) => sample.id))];
    const trailEpochs = ids.map((id) => {
      const samples = accepted.filter((sample) => sample.id === id);
      return {
        id,
        count: samples.length,
        minimumProgress: Math.min(...samples.map((sample) => sample.progress)),
        maximumProgress: Math.max(...samples.map((sample) => sample.progress)),
        allAirborne: samples.every((sample) => sample.airborne),
        allGrounded: samples.every((sample) => !sample.airborne),
        phases: [...new Set(samples.map((sample) => sample.phase))],
        maximumLocalSampleError: Math.max(...samples.map((sample) => sample.localSampleError)),
        maximumWorldMetadataError: Math.max(...samples.map((sample) => sample.worldMetadataError)),
        maximumGeometryError: Math.max(...samples.map((sample) => sample.geometryError)),
        allFollowRoot: samples.every((sample) => (
          sample.followRoot
          && sample.glowParentRoot
          && sample.coreParentRoot
          && sample.trailSpace === 'followObjectLocal'
        )),
      };
    });
    const crossHoldOrLandingSegments = ids.filter((id) => {
      const samples = accepted.filter((sample) => sample.id === id);
      return samples.some((sample) => sample.airborne)
        && samples.some((sample) => !sample.airborne);
    });
    const samplesPastAirborneSeam = accepted.filter((sample) => (
      sample.airborne && sample.progress > seamProgress + 0.000001
    ));
    const samplesBeforeLandingSeam = accepted.filter((sample) => (
      !sample.airborne && sample.progress < seamProgress - 0.000001
    ));

    for (let frame = 0; frame < 60; frame += 1) h.game._updateTimedEffects(1 / 60);

    return {
      swordIndex: h.swordIndex,
      jumped,
      started,
      energySpent: energyBefore - energyAfter,
      outputSpent: outputBefore - outputAfter,
      expectedEnergyCost: h.profile.energyCost,
      expectedOutputCost: h.expectedOutputCost,
      initialTrailState,
      windupFrames,
      windupMonotonic,
      windupMaximumProgress,
      windupMaximumActionSyncError,
      windupMaximumHipsError,
      windupMaximumPoseError,
      windupAllRootAnchored,
      windupAllPoseMarkersOff,
      holdFrames,
      holdMaximumPoseError,
      holdMaximumHipsError,
      holdMaximumActionError,
      holdAllMarkersOn,
      holdAllEquipmentVisible,
      semanticPoseCheck,
      touchdown,
      recoveryFrames,
      firstRecoveryProgress,
      maximumRecoveryProgress,
      recoveryMonotonic,
      recoveryDuration: recoveryStartedAt === null || recoveryFinishedAt === null
        ? null
        : recoveryFinishedAt - recoveryStartedAt,
      allRecoveryBladeVisible,
      maximumGroundedFootError,
      minimumLeftFootClearance,
      minimumRightFootClearance,
      strikes: probe.strikes.map((strike) => ({
        ...strike,
        delay: strike.elapsed - attackStartedAt,
      })),
      begins: probe.begins,
      finishes: probe.finishes,
      cancels: probe.cancels,
      staticFallbackCount: probe.staticFallbacks.length,
      trailEpochs,
      crossHoldOrLandingSegments,
      samplesPastAirborneSeam: samplesPastAirborneSeam.length,
      samplesBeforeLandingSeam: samplesBeforeLandingSeam.length,
      finalJumpState: player.jumpState,
      finalVisualActive: player.isSwordJumpSlashVisualActive(),
      finalBladeVisible: rig.beamBladeGroup?.visible ?? false,
      finalPendingStrikeCount: combat.pendingMeleeStrikes.length,
      finalActiveTrail: Boolean(combat.activeSwordSweepTrail),
      remainingJumpSlashMeshes: h.countJumpSlashMeshes(),
      expectedTrailStart: trailStart,
      expectedTrailEnd: trailEnd,
    };
  }, {
    seamProgress: JUMP_SLASH_SEAM_PROGRESS,
    trailStart: JUMP_SLASH_TRAIL_START,
    trailEnd: JUMP_SLASH_TRAIL_END,
  });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.jumped).toBe(true);
  expect(result.started).toBe(true);
  expect(result.energySpent).toBe(result.expectedEnergyCost);
  expect(result.outputSpent).toBeCloseTo(result.expectedOutputCost, 6);
  expect(result.initialTrailState).toEqual({
    progressSource: 'jumpSlashVisual',
    startProgress: JUMP_SLASH_TRAIL_START,
    endProgress: JUMP_SLASH_SEAM_PROGRESS,
    followRoot: true,
  });

  expect(result.windupFrames).toBeGreaterThan(80);
  expect(result.windupMonotonic).toBe(true);
  expect(result.windupMaximumProgress).toBeGreaterThan(JUMP_SLASH_SEAM_PROGRESS - 0.01);
  expect(result.windupMaximumProgress).toBeLessThan(JUMP_SLASH_SEAM_PROGRESS);
  expect(result.windupMaximumActionSyncError).toBeLessThan(0.001);
  expect(result.windupMaximumHipsError).toBeLessThan(0.000001);
  expect(result.windupMaximumPoseError).toBeGreaterThan(5);
  expect(result.windupAllRootAnchored).toBe(true);
  expect(result.windupAllPoseMarkersOff).toBe(true);

  expect(result.holdFrames).toBeGreaterThan(10);
  expect(result.holdMaximumPoseError).toBeLessThan(0.1);
  expect(result.holdMaximumHipsError).toBeLessThan(0.000001);
  expect(result.holdMaximumActionError).toBeLessThan(0.000001);
  expect(result.holdAllMarkersOn).toBe(true);
  expect(result.holdAllEquipmentVisible).toBe(true);
  expect(result.semanticPoseCheck).toEqual(expect.objectContaining({
    missing: 0,
    uniqueSemanticBones: 15,
  }));

  expect(result.strikes).toHaveLength(1);
  expect(result.strikes[0].delay).toBeCloseTo(
    JUMP_SLASH_DURATION * JUMP_SLASH_STRIKE_PROGRESS,
    2,
  );
  expect(result.strikes[0].airborne).toBe(true);
  expect(result.strikes[0].visualProgress).toBeCloseTo(JUMP_SLASH_STRIKE_PROGRESS, 2);
  expect(result.strikes[0].attackTimerProgress).toBeLessThan(JUMP_SLASH_TRAIL_START);
  expect(result.strikes[0].activeTrailSampleCount).toBeGreaterThanOrEqual(2);
  expect(result.staticFallbackCount).toBe(0);

  expect(result.begins).toHaveLength(2);
  expect(result.begins.map((entry) => entry.id)).toEqual(
    expect.arrayContaining(result.trailEpochs.map((entry) => entry.id)),
  );
  for (const begin of result.begins) {
    expect(begin).toEqual(expect.objectContaining({
      optionsFollowRoot: true,
      handleFollowRoot: true,
      glowParentRoot: true,
      coreParentRoot: true,
      trailSpace: 'followObjectLocal',
    }));
  }
  expect(result.trailEpochs).toHaveLength(2);
  const airborneEpoch = result.trailEpochs.find((epoch) => epoch.allAirborne);
  const landingEpoch = result.trailEpochs.find((epoch) => epoch.allGrounded);
  expect(airborneEpoch.count).toBeGreaterThan(10);
  expect(airborneEpoch.minimumProgress).toBeGreaterThanOrEqual(JUMP_SLASH_TRAIL_START);
  expect(airborneEpoch.minimumProgress).toBeLessThan(JUMP_SLASH_TRAIL_START + 0.01);
  expect(airborneEpoch.maximumProgress).toBeGreaterThan(JUMP_SLASH_SEAM_PROGRESS - 0.01);
  expect(airborneEpoch.maximumProgress).toBeLessThanOrEqual(JUMP_SLASH_SEAM_PROGRESS + 0.000001);
  expect(landingEpoch.count).toBeGreaterThan(5);
  expect(landingEpoch.minimumProgress).toBeGreaterThanOrEqual(JUMP_SLASH_SEAM_PROGRESS - 0.000001);
  expect(landingEpoch.minimumProgress).toBeLessThan(JUMP_SLASH_SEAM_PROGRESS + 0.01);
  expect(landingEpoch.maximumProgress).toBeGreaterThan(JUMP_SLASH_TRAIL_END - 0.01);
  expect(landingEpoch.maximumProgress).toBeLessThanOrEqual(JUMP_SLASH_TRAIL_END + 0.000001);
  for (const epoch of result.trailEpochs) {
    expect(epoch.allFollowRoot).toBe(true);
    expect(epoch.maximumLocalSampleError).toBeLessThan(0.000001);
    expect(epoch.maximumWorldMetadataError).toBeLessThan(0.000001);
    expect(epoch.maximumGeometryError).toBeLessThan(0.00001);
  }
  expect(airborneEpoch.id).not.toBe(landingEpoch.id);
  expect(result.crossHoldOrLandingSegments).toEqual([]);
  expect(result.samplesPastAirborneSeam).toBe(0);
  expect(result.samplesBeforeLandingSeam).toBe(0);
  expect(result.finishes).toHaveLength(2);
  expect(result.cancels).toHaveLength(0);

  expect(result.touchdown).toEqual(expect.objectContaining({
    phase: 'groundedRecovery',
    poseMarker: false,
    rootAnchorMarker: false,
    reason: 'jumpSlashLanding',
  }));
  expect(result.touchdown.visualProgress).toBeCloseTo(JUMP_SLASH_SEAM_PROGRESS, 6);
  expect(result.touchdown.actionProgress).toBeCloseTo(JUMP_SLASH_SEAM_PROGRESS, 4);
  expect(result.touchdown.poseError).toBeGreaterThan(1);
  expect(result.touchdown.hipsDistanceFromAnchor).toBeGreaterThan(0.1);
  expect(Math.abs(result.touchdown.beforeFootClearance)).toBeLessThan(0.05);
  expect(Math.abs(result.touchdown.footClearance)).toBeLessThan(0.005);
  expect(Math.abs(result.touchdown.correction)).toBeLessThan(0.05);

  expect(result.recoveryFrames).toBeGreaterThan(40);
  expect(result.firstRecoveryProgress).toBeGreaterThanOrEqual(
    JUMP_SLASH_SEAM_PROGRESS - 0.000001,
  );
  expect(result.firstRecoveryProgress).toBeLessThan(JUMP_SLASH_SEAM_PROGRESS + 0.02);
  expect(result.maximumRecoveryProgress).toBeGreaterThan(0.98);
  expect(result.recoveryMonotonic).toBe(true);
  expect(Math.abs(result.recoveryDuration - JUMP_SLASH_RECOVERY_DURATION)).toBeLessThanOrEqual(
    (2 / 240) + 0.000001,
  );
  expect(result.allRecoveryBladeVisible).toBe(true);
  expect(result.maximumGroundedFootError).toBeLessThan(0.005);
  expect(result.minimumLeftFootClearance).toBeGreaterThanOrEqual(-0.005);
  expect(result.minimumRightFootClearance).toBeGreaterThanOrEqual(-0.005);

  expect(result.finalJumpState).toBe('Grounded');
  expect(result.finalVisualActive).toBe(false);
  expect(result.finalBladeVisible).toBe(false);
  expect(result.finalPendingStrikeCount).toBe(0);
  expect(result.finalActiveTrail).toBe(false);
  expect(result.remainingJumpSlashMeshes).toBe(0);
});

test('a long fall holds frame 32 after gameplay timing and resumes one grounded recovery', async ({ page }) => {
  await openLoadedGame(page);
  await installJumpSlashHarness(page);

  const result = await page.evaluate(({ seamProgress }) => {
    const h = window.__createJumpSlashHarness({ dt: 1 / 240 });
    const { player, combat, rig, state } = h;
    const fall = h.beginFalling(1.1);
    const probe = h.installProbe();
    const attackStartedAt = h.elapsed;
    const energyBefore = state.energy;
    const outputBefore = state.weaponOutput;
    const started = combat.tryPrimaryAttack(window.game.pointer.aimWorld);
    const energyAfter = state.energy;
    const outputAfter = state.weaponOutput;

    let windupFrames = 0;
    let windupMaximumProgress = 0;
    let windupMaximumHipsError = 0;
    let windupMonotonic = true;
    let previousWindupProgress = -Infinity;
    let holdFrames = 0;
    let holdMaximumPoseError = 0;
    let holdMaximumHipsError = 0;
    let holdMaximumActionError = 0;
    let holdAllMarkersOn = true;
    let holdAllBladeVisible = true;
    let postGameplayHoldFrames = 0;
    let postGameplayMaximumPoseError = 0;
    let touchdown = null;
    let recoveryStartedAt = null;
    let recoveryFinishedAt = null;
    let recoveryFrames = 0;
    let firstRecoveryProgress = null;
    let maximumRecoveryProgress = 0;
    let previousRecoveryProgress = seamProgress;
    let recoveryMonotonic = true;
    let allRecoveryBladeVisible = true;
    let maximumGroundedFootError = 0;

    for (let frame = 0; frame < 720; frame += 1) {
      const wasAirborne = player.isJumpAirborne();
      h.tick();
      const visual = player._jumpSlashVisualState;
      const progress = visual?.visualProgress ?? null;

      if (visual?.phase === 'airborneWindup' && player.isJumpAirborne()) {
        windupFrames += 1;
        windupMonotonic &&= progress + 0.000001 >= previousWindupProgress;
        previousWindupProgress = progress;
        windupMaximumProgress = Math.max(windupMaximumProgress, progress);
        windupMaximumHipsError = Math.max(
          windupMaximumHipsError,
          rig.joints.get('hips').position.distanceTo(h.sourceStartHips),
        );
      }

      if (visual?.phase === 'airborneHold' && player.isJumpAirborne()) {
        const poseError = h.poseError().maximum;
        holdFrames += 1;
        holdMaximumPoseError = Math.max(holdMaximumPoseError, poseError);
        holdMaximumHipsError = Math.max(
          holdMaximumHipsError,
          rig.joints.get('hips').position.distanceTo(h.sourceStartHips),
        );
        holdMaximumActionError = Math.max(
          holdMaximumActionError,
          Math.abs(h.actionProgress() - seamProgress),
        );
        holdAllMarkersOn &&= Boolean(
          rig.root.userData.jumpSlashAerialPoseActive
          && rig.root.userData.jumpSlashAirborneRootAnchorActive
        );
        holdAllBladeVisible &&= Boolean(rig.beamBladeGroup?.visible);
        if (player.animation.attackTimer <= 0) {
          postGameplayHoldFrames += 1;
          postGameplayMaximumPoseError = Math.max(postGameplayMaximumPoseError, poseError);
        }
      }

      if (wasAirborne && !player.isJumpAirborne() && !touchdown) {
        const grounding = player.getExternalModelGroundingDiagnostics?.();
        touchdown = {
          elapsed: h.elapsed,
          phase: visual?.phase ?? null,
          attackTimer: player.animation.attackTimer,
          visualProgress: progress,
          actionProgress: h.actionProgress(),
          poseError: h.poseError().maximum,
          hipsDistanceFromAnchor: rig.joints.get('hips').position.distanceTo(h.sourceStartHips),
          poseMarker: rig.root.userData.jumpSlashAerialPoseActive,
          rootAnchorMarker: rig.root.userData.jumpSlashAirborneRootAnchorActive,
          beforeFootClearance: grounding?.beforeFootClearance ?? null,
          footClearance: grounding?.footClearance ?? null,
          correction: grounding?.correction ?? null,
          reason: grounding?.reason ?? null,
        };
        recoveryStartedAt = h.elapsed;
      }

      if (visual?.phase === 'groundedRecovery' && !player.isJumpAirborne()) {
        const progressNow = h.actionProgress();
        recoveryFrames += 1;
        firstRecoveryProgress ??= progressNow;
        maximumRecoveryProgress = Math.max(maximumRecoveryProgress, progressNow);
        recoveryMonotonic &&= progressNow + 0.000001 >= previousRecoveryProgress;
        previousRecoveryProgress = progressNow;
        allRecoveryBladeVisible &&= Boolean(rig.beamBladeGroup?.visible);
        const grounding = player.getExternalModelGroundingDiagnostics?.();
        maximumGroundedFootError = Math.max(
          maximumGroundedFootError,
          Math.abs(grounding?.footClearance ?? 0),
        );
      }

      if (touchdown
        && !player.isSwordJumpSlashVisualActive()
        && player.jumpState === 'Grounded') {
        recoveryFinishedAt = h.elapsed;
        break;
      }
    }

    const accepted = probe.appends.filter((sample) => sample.accepted);
    const ids = [...new Set(accepted.map((sample) => sample.id))];
    const epochs = ids.map((id) => {
      const samples = accepted.filter((sample) => sample.id === id);
      return {
        id,
        count: samples.length,
        minProgress: Math.min(...samples.map((sample) => sample.progress)),
        maxProgress: Math.max(...samples.map((sample) => sample.progress)),
        allAirborne: samples.every((sample) => sample.airborne),
        allGrounded: samples.every((sample) => !sample.airborne),
        allRootLocal: samples.every((sample) => (
          sample.followRoot
          && sample.glowParentRoot
          && sample.coreParentRoot
          && sample.trailSpace === 'followObjectLocal'
        )),
      };
    });
    const anyCrossEpoch = ids.some((id) => {
      const samples = accepted.filter((sample) => sample.id === id);
      return samples.some((sample) => sample.airborne)
        && samples.some((sample) => !sample.airborne);
    });
    const anyHoldProgressPastSeam = accepted.some((sample) => (
      sample.airborne && sample.progress > seamProgress + 0.000001
    ));

    for (let frame = 0; frame < 60; frame += 1) h.game._updateTimedEffects(1 / 60);

    return {
      swordIndex: h.swordIndex,
      intendedAirTime: fall.intendedAirTime,
      started,
      energySpent: energyBefore - energyAfter,
      outputSpent: outputBefore - outputAfter,
      expectedEnergyCost: h.profile.energyCost,
      expectedOutputCost: h.expectedOutputCost,
      progressSource: combat.activeSwordSweepTrail?.progressSource ?? null,
      windupFrames,
      windupMaximumProgress,
      windupMaximumHipsError,
      windupMonotonic,
      holdFrames,
      holdMaximumPoseError,
      holdMaximumHipsError,
      holdMaximumActionError,
      holdAllMarkersOn,
      holdAllBladeVisible,
      postGameplayHoldFrames,
      postGameplayMaximumPoseError,
      touchdown,
      recoveryFrames,
      firstRecoveryProgress,
      maximumRecoveryProgress,
      recoveryMonotonic,
      recoveryDuration: recoveryStartedAt === null || recoveryFinishedAt === null
        ? null
        : recoveryFinishedAt - recoveryStartedAt,
      allRecoveryBladeVisible,
      maximumGroundedFootError,
      strikes: probe.strikes.map((strike) => ({
        ...strike,
        delay: strike.elapsed - attackStartedAt,
      })),
      staticFallbackCount: probe.staticFallbacks.length,
      begins: probe.begins,
      finishes: probe.finishes,
      cancels: probe.cancels,
      epochs,
      anyCrossEpoch,
      anyHoldProgressPastSeam,
      finalJumpState: player.jumpState,
      finalVisualActive: player.isSwordJumpSlashVisualActive(),
      finalBladeVisible: rig.beamBladeGroup?.visible ?? false,
      finalPendingStrikeCount: combat.pendingMeleeStrikes.length,
      finalActiveTrail: Boolean(combat.activeSwordSweepTrail),
      remainingJumpSlashMeshes: h.countJumpSlashMeshes(),
    };
  }, { seamProgress: JUMP_SLASH_SEAM_PROGRESS });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.started).toBe(true);
  expect(result.energySpent).toBe(result.expectedEnergyCost);
  expect(result.outputSpent).toBeCloseTo(result.expectedOutputCost, 6);
  expect(result.windupFrames).toBeGreaterThan(100);
  expect(result.windupMonotonic).toBe(true);
  expect(result.windupMaximumProgress).toBeGreaterThan(JUMP_SLASH_SEAM_PROGRESS - 0.01);
  expect(result.windupMaximumHipsError).toBeLessThan(0.000001);
  expect(result.holdFrames).toBeGreaterThan(100);
  expect(result.holdMaximumPoseError).toBeLessThan(0.1);
  expect(result.holdMaximumHipsError).toBeLessThan(0.000001);
  expect(result.holdMaximumActionError).toBeLessThan(0.000001);
  expect(result.holdAllMarkersOn).toBe(true);
  expect(result.holdAllBladeVisible).toBe(true);
  expect(result.postGameplayHoldFrames).toBeGreaterThan(20);
  expect(result.postGameplayMaximumPoseError).toBeLessThan(0.1);

  expect(result.strikes).toHaveLength(1);
  expect(result.strikes[0].delay).toBeCloseTo(
    JUMP_SLASH_DURATION * JUMP_SLASH_STRIKE_PROGRESS,
    2,
  );
  expect(result.strikes[0].airborne).toBe(true);
  expect(result.staticFallbackCount).toBe(0);
  expect(result.begins).toHaveLength(2);
  expect(result.epochs).toHaveLength(2);
  expect(result.epochs.find((epoch) => epoch.allAirborne).count).toBeGreaterThan(10);
  expect(result.epochs.find((epoch) => epoch.allGrounded).count).toBeGreaterThan(5);
  for (const epoch of result.epochs) expect(epoch.allRootLocal).toBe(true);
  expect(result.anyCrossEpoch).toBe(false);
  expect(result.anyHoldProgressPastSeam).toBe(false);
  expect(result.finishes).toHaveLength(2);
  expect(result.cancels).toHaveLength(0);

  expect(result.touchdown.elapsed).toBeGreaterThanOrEqual(result.intendedAirTime - 0.000001);
  expect(result.touchdown.elapsed).toBeLessThanOrEqual(
    result.intendedAirTime + (1 / 240) + 0.000001,
  );
  expect(result.touchdown).toEqual(expect.objectContaining({
    phase: 'groundedRecovery',
    poseMarker: false,
    rootAnchorMarker: false,
    reason: 'jumpSlashLanding',
  }));
  expect(result.touchdown.attackTimer).toBeLessThanOrEqual(0);
  expect(result.touchdown.visualProgress).toBeCloseTo(JUMP_SLASH_SEAM_PROGRESS, 6);
  expect(result.touchdown.actionProgress).toBeCloseTo(JUMP_SLASH_SEAM_PROGRESS, 4);
  expect(result.touchdown.poseError).toBeGreaterThan(1);
  expect(result.touchdown.hipsDistanceFromAnchor).toBeGreaterThan(0.1);
  expect(Math.abs(result.touchdown.beforeFootClearance)).toBeLessThan(0.05);
  expect(Math.abs(result.touchdown.footClearance)).toBeLessThan(0.005);
  expect(Math.abs(result.touchdown.correction)).toBeLessThan(0.05);

  expect(result.recoveryFrames).toBeGreaterThan(40);
  expect(result.firstRecoveryProgress).toBeGreaterThanOrEqual(
    JUMP_SLASH_SEAM_PROGRESS - 0.000001,
  );
  expect(result.maximumRecoveryProgress).toBeGreaterThan(0.98);
  expect(result.recoveryMonotonic).toBe(true);
  expect(Math.abs(result.recoveryDuration - JUMP_SLASH_RECOVERY_DURATION)).toBeLessThanOrEqual(
    (2 / 240) + 0.000001,
  );
  expect(result.allRecoveryBladeVisible).toBe(true);
  expect(result.maximumGroundedFootError).toBeLessThan(0.005);
  expect(result.finalJumpState).toBe('Grounded');
  expect(result.finalVisualActive).toBe(false);
  expect(result.finalBladeVisible).toBe(false);
  expect(result.finalPendingStrikeCount).toBe(0);
  expect(result.finalActiveTrail).toBe(false);
  expect(result.remainingJumpSlashMeshes).toBe(0);
});

test('a coarse frame uses the fitted root-following arc only when a live ribbon lacks two samples', async ({ page }) => {
  await openLoadedGame(page);
  await installJumpSlashHarness(page);

  const result = await page.evaluate(() => {
    const h = window.__createJumpSlashHarness({ dt: 1 / 240 });
    const { player, combat } = h;
    h.beginFalling(1.2);
    const probe = h.installProbe();
    const started = combat.tryPrimaryAttack(window.game.pointer.aimWorld);

    // Cross the visual-start and hit thresholds in one update. Exactly one
    // blade sample is insufficient for a ribbon, so the fitted plane is the
    // deliberate low-FPS fallback.
    h.tick(0.43);

    return {
      swordIndex: h.swordIndex,
      started,
      stillAirborne: player.isJumpAirborne(),
      visualProgress: player.getSwordJumpSlashVisualProgress?.() ?? null,
      strikes: probe.strikes,
      begins: probe.begins,
      acceptedAppends: probe.appends.filter((sample) => sample.accepted),
      finishes: probe.finishes,
      cancels: probe.cancels,
      staticFallbacks: probe.staticFallbacks,
      activeTrailAfterHit: Boolean(combat.activeSwordSweepTrail),
    };
  });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.started).toBe(true);
  expect(result.stillAirborne).toBe(true);
  expect(result.visualProgress).toBeCloseTo(JUMP_SLASH_STRIKE_PROGRESS, 4);
  expect(result.strikes).toHaveLength(1);
  expect(result.strikes[0].activeTrailSampleCount).toBe(1);
  expect(result.begins).toHaveLength(1);
  expect(result.acceptedAppends).toHaveLength(1);
  expect(result.acceptedAppends[0]).toEqual(expect.objectContaining({
    followRoot: true,
    glowParentRoot: true,
    coreParentRoot: true,
    trailSpace: 'followObjectLocal',
  }));
  expect(result.finishes).toHaveLength(0);
  expect(result.cancels).toHaveLength(1);
  expect(result.activeTrailAfterHit).toBe(false);
  expect(result.staticFallbacks).toHaveLength(1);

  const fallback = result.staticFallbacks[0];
  expect(fallback.airborne).toBe(true);
  expect(fallback.followRoot).toBe(true);
  expect(fallback.range).toBeCloseTo(JUMP_SLASH_FALLBACK.range, 6);
  expect(fallback.arcHalfAngle).toBeCloseTo(JUMP_SLASH_FALLBACK.arcHalfAngle, 6);
  for (let axis = 0; axis < 3; axis += 1) {
    expect(fallback.motionLocal[axis]).toBeCloseTo(
      JUMP_SLASH_FALLBACK.motionLocal[axis],
      6,
    );
    expect(fallback.planeNormalLocal[axis]).toBeCloseTo(
      JUMP_SLASH_FALLBACK.planeNormalLocal[axis],
      6,
    );
    expect(fallback.centerLocal[axis]).toBeCloseTo(
      JUMP_SLASH_FALLBACK.centerLocal[axis],
      6,
    );
  }
  expect(fallback.meshes).toHaveLength(2);
  for (const mesh of fallback.meshes) {
    expect(mesh.mode).toBe('authoredSlashPlane');
    expect(mesh.parentRoot).toBe(true);
    expect(mesh.outerRadius).toBeCloseTo(JUMP_SLASH_FALLBACK.range, 6);
    expect(mesh.thetaStart).toBeCloseTo(JUMP_SLASH_FALLBACK.arcHalfAngle, 6);
    expect(mesh.thetaLength).toBeCloseTo(-2 * JUMP_SLASH_FALLBACK.arcHalfAngle, 6);
  }
});

test('jump slash preserves the captured moving-jump trajectory', async ({ page }) => {
  await openLoadedGame(page);
  await installJumpSlashHarness(page);

  const result = await page.evaluate(() => {
    const h = window.__createJumpSlashHarness({ dt: 1 / 120 });
    const { player, combat, state } = h;
    const moveInput = new Set(['KeyW']);

    const run = (withSlash) => {
      h.resetGrounded();
      h.tick(undefined, moveInput);
      const jumped = h.beginNormalJump(moveInput);
      const started = withSlash
        ? combat.tryPrimaryAttack(window.game.pointer.aimWorld)
        : false;
      const energyAfterStart = state.energy;
      const samples = [player.root.position.toArray()];
      let apexY = player.root.position.y;
      let landingFrame = null;
      for (let frame = 0; frame < 240 && player.isJumpAirborne(); frame += 1) {
        h.tick();
        samples.push(player.root.position.toArray());
        apexY = Math.max(apexY, player.root.position.y);
        if (!player.isJumpAirborne()) landingFrame = frame + 1;
      }
      return {
        jumped,
        started,
        energyAfterStart,
        samples,
        apexY,
        landingFrame,
        finalPosition: player.root.position.toArray(),
        finalVelocity: player.velocity.toArray(),
        jumpState: player.jumpState,
      };
    };

    const control = run(false);
    const attacked = run(true);
    let maximumPositionDelta = 0;
    for (let index = 0; index < Math.min(control.samples.length, attacked.samples.length); index += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        maximumPositionDelta = Math.max(
          maximumPositionDelta,
          Math.abs(control.samples[index][axis] - attacked.samples[index][axis]),
        );
      }
    }
    return {
      swordIndex: h.swordIndex,
      control,
      attacked,
      maximumPositionDelta,
    };
  });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.control.jumped).toBe(true);
  expect(result.attacked.jumped).toBe(true);
  expect(result.attacked.started).toBe(true);
  expect(result.control.jumpState).toBe('LandRecovery');
  expect(result.attacked.jumpState).toBe('LandRecovery');
  expect(result.attacked.samples).toHaveLength(result.control.samples.length);
  expect(result.attacked.landingFrame).toBe(result.control.landingFrame);
  expect(result.attacked.apexY).toBeCloseTo(result.control.apexY, 6);
  expect(result.maximumPositionDelta).toBeLessThan(0.000001);
  for (let axis = 0; axis < 3; axis += 1) {
    expect(result.attacked.finalPosition[axis]).toBeCloseTo(result.control.finalPosition[axis], 6);
    expect(result.attacked.finalVelocity[axis]).toBeCloseTo(result.control.finalVelocity[axis], 6);
  }
});

test('starting a ledge cling cancels the visual, root anchor, blade, trail, combo, and delayed hit', async ({ page }) => {
  await openLoadedGame(page);
  await installJumpSlashHarness(page);

  const result = await page.evaluate(() => {
    const h = window.__createJumpSlashHarness({ dt: 1 / 120 });
    const { game, player, combat, rig } = h;
    h.beginFalling(1.1);
    const probe = h.installProbe();
    const started = combat.tryPrimaryAttack(game.pointer.aimWorld);
    h.tick();

    const beforeCling = {
      clip: rig.activeClipKey,
      visualActive: player.isSwordJumpSlashVisualActive(),
      visualPhase: player._jumpSlashVisualState?.phase ?? null,
      aerialPoseActive: rig.root.userData.jumpSlashAerialPoseActive,
      rootAnchorActive: rig.root.userData.jumpSlashAirborneRootAnchorActive,
      attackTimer: player.animation.attackTimer,
      pendingStrikeCount: combat.pendingMeleeStrikes.length,
      activeTrail: Boolean(combat.activeSwordSweepTrail),
      bladeVisible: rig.beamBladeGroup?.visible ?? false,
    };

    game.pointer.primary = true;
    game.pointer.primaryPressed = true;
    const hangPosition = player.root.position.clone();
    const climbPosition = hangPosition.clone().add(new h.forward.constructor(0, 1, 1));
    const clingStarted = player.startLedgeCling({
      id: 'jump-slash-cancel-test',
      hangPosition,
      handPosition: hangPosition.clone().add(new h.forward.constructor(0, 0.8, 0)),
      climbPosition,
      normal: new h.forward.constructor(0, 0, -1),
      topY: climbPosition.y,
    });
    h.tick();

    const immediatelyAfterCling = {
      attackTimer: player.animation.attackTimer,
      attackDuration: player.animation.attackDuration,
      attackWeaponKind: player._attackWeaponKind,
      activeSwordClip: player._activeSwordSlashClipKey,
      visualActive: player.isSwordJumpSlashVisualActive(),
      aerialPoseActive: rig.root.userData.jumpSlashAerialPoseActive,
      rootAnchorActive: rig.root.userData.jumpSlashAirborneRootAnchorActive,
      pendingStrikeCount: combat.pendingMeleeStrikes.length,
      activeTrail: Boolean(combat.activeSwordSweepTrail),
      comboPending: combat.swordCombo.awaitingFollowUp,
      bladeVisible: rig.beamBladeGroup?.visible ?? false,
      ledgeState: player.ledgeCling?.state ?? null,
    };

    for (let frame = 0; frame < 90; frame += 1) h.tick(1 / 60);

    return {
      swordIndex: h.swordIndex,
      started,
      clingStarted,
      beforeCling,
      immediatelyAfterCling,
      resolvedMeleeStrikes: probe.strikes.length,
      liveBegins: probe.begins.length,
      finalPendingStrikeCount: combat.pendingMeleeStrikes.length,
      finalActiveTrail: Boolean(combat.activeSwordSweepTrail),
      finalBladeVisible: rig.beamBladeGroup?.visible ?? false,
      stillClinging: player.isLedgeClinging(),
      heldPrimarySuppressed: combat.suppressPrimaryUntilRelease,
    };
  });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.started).toBe(true);
  expect(result.beforeCling).toEqual(expect.objectContaining({
    clip: JUMP_SLASH,
    visualActive: true,
    visualPhase: 'airborneWindup',
    aerialPoseActive: false,
    rootAnchorActive: true,
    pendingStrikeCount: 1,
    activeTrail: true,
    bladeVisible: true,
  }));
  expect(result.beforeCling.attackTimer).toBeGreaterThan(0);
  expect(result.clingStarted).toBe(true);
  expect(result.immediatelyAfterCling).toEqual({
    attackTimer: 0,
    attackDuration: 0,
    attackWeaponKind: null,
    activeSwordClip: null,
    visualActive: false,
    aerialPoseActive: false,
    rootAnchorActive: false,
    pendingStrikeCount: 0,
    activeTrail: false,
    comboPending: false,
    bladeVisible: false,
    ledgeState: 'jumpingToHanging',
  });
  expect(result.resolvedMeleeStrikes).toBe(0);
  expect(result.liveBegins).toBe(0);
  expect(result.finalPendingStrikeCount).toBe(0);
  expect(result.finalActiveTrail).toBe(false);
  expect(result.finalBladeVisible).toBe(false);
  expect(result.stillClinging).toBe(true);
  expect(result.heldPrimarySuppressed).toBe(true);
});

test('grounded recovery renders frame 56 once, then clears a stalled attack on the next player tick', async ({ page }) => {
  await openLoadedGame(page);
  await installJumpSlashHarness(page);

  const result = await page.evaluate(({ jumpSlash }) => {
    const h = window.__createJumpSlashHarness({ dt: 1 / 240 });
    const { player, combat, rig } = h;
    const rigUpdates = [];
    const originalRigUpdate = rig.update.bind(rig);
    rig.update = (dt, options = {}) => {
      rigUpdates.push({
        clipKey: options.clipKey ?? null,
        attackProgress: options.attackProgress ?? null,
        phase: player._jumpSlashVisualState?.phase ?? null,
      });
      return originalRigUpdate(dt, options);
    };

    const jumped = h.beginNormalJump();
    const started = combat.tryPrimaryAttack(window.game.pointer.aimWorld);
    let landingAttackTimer = null;
    for (let frame = 0; frame < 360 && player.isJumpAirborne(); frame += 1) {
      const wasAirborne = player.isJumpAirborne();
      h.tick();
      if (wasAirborne && !player.isJumpAirborne()) {
        landingAttackTimer = player.animation.attackTimer;
        // This pauses AnimationController.attackTimer for longer than the
        // remaining visual recovery. The visual timeline must still finish.
        player.animation.hurtTimer = 2;
      }
    }

    for (let frame = 0; frame < 240
      && player._jumpSlashVisualState?.phase !== 'groundedHold'; frame += 1) {
      h.tick();
    }

    const terminalRigUpdatesBeforeCleanup = rigUpdates.filter((update) => (
      update.clipKey === jumpSlash
      && Number.isFinite(update.attackProgress)
      && Math.abs(update.attackProgress - 1) <= 0.000001
    ));
    const atFrame56 = {
      visualActive: player.isSwordJumpSlashVisualActive(),
      phase: player._jumpSlashVisualState?.phase ?? null,
      visualProgress: player.getSwordJumpSlashVisualProgress?.() ?? null,
      actionProgress: (rig.activeAction?.time ?? 0) / h.clip.duration,
      bladeVisible: rig.beamBladeGroup?.visible ?? false,
      attackTimer: player.animation.attackTimer,
      attackDuration: player.animation.attackDuration,
      hurtTimer: player.animation.hurtTimer,
      movementLockTimer: player.movementLockTimer,
      movementLockMultiplier: player.movementLockMultiplier,
      terminalRenderCount: terminalRigUpdatesBeforeCleanup.length,
      terminalRenderPhases: terminalRigUpdatesBeforeCleanup.map((update) => update.phase),
    };

    // Deliberately do not call CombatSystem.update. The next Player update owns
    // groundedHold cleanup after frame 56 has been submitted to the rig once.
    player.update(h.defaultDt, h.noInput, h.movementOptions);

    const terminalRigUpdatesAfterCleanup = rigUpdates.filter((update) => (
      update.clipKey === jumpSlash
      && Number.isFinite(update.attackProgress)
      && Math.abs(update.attackProgress - 1) <= 0.000001
    ));
    const afterNextPlayerTick = {
      visualActive: player.isSwordJumpSlashVisualActive(),
      phase: player._jumpSlashVisualState?.phase ?? null,
      bladeVisible: rig.beamBladeGroup?.visible ?? false,
      attackTimer: player.animation.attackTimer,
      attackDuration: player.animation.attackDuration,
      attackWeaponKind: player._attackWeaponKind,
      activeSwordClip: player._activeSwordSlashClipKey,
      movementLockTimer: player.movementLockTimer,
      movementLockMultiplier: player.movementLockMultiplier,
      terminalRenderCount: terminalRigUpdatesAfterCleanup.length,
    };

    return {
      swordIndex: h.swordIndex,
      jumped,
      started,
      landingAttackTimer,
      atFrame56,
      afterNextPlayerTick,
    };
  }, { jumpSlash: JUMP_SLASH });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.jumped).toBe(true);
  expect(result.started).toBe(true);
  expect(result.landingAttackTimer).toBeGreaterThan(0);
  expect(result.atFrame56).toEqual(expect.objectContaining({
    visualActive: true,
    phase: 'groundedHold',
    bladeVisible: true,
    movementLockMultiplier: 1,
    terminalRenderCount: 1,
    terminalRenderPhases: ['groundedHold'],
  }));
  expect(result.atFrame56.visualProgress).toBe(1);
  expect(result.atFrame56.actionProgress).toBeCloseTo(1, 6);
  expect(result.atFrame56.attackTimer).toBeCloseTo(result.landingAttackTimer, 6);
  expect(result.atFrame56.attackDuration).toBeCloseTo(JUMP_SLASH_DURATION, 6);
  expect(result.atFrame56.hurtTimer).toBeGreaterThan(1);
  expect(result.atFrame56.movementLockTimer).toBeLessThanOrEqual(0.000001);

  expect(result.afterNextPlayerTick).toEqual({
    visualActive: false,
    phase: null,
    bladeVisible: false,
    attackTimer: 0,
    attackDuration: 0,
    attackWeaponKind: null,
    activeSwordClip: null,
    movementLockTimer: 0,
    movementLockMultiplier: 1,
    terminalRenderCount: 1,
  });
});

test('lethal damage synchronously clears jump-slash combat state and live ribbon meshes', async ({ page }) => {
  await openLoadedGame(page);
  await installJumpSlashHarness(page);

  const result = await page.evaluate(({ jumpSlash }) => {
    const h = window.__createJumpSlashHarness({ dt: 1 / 240 });
    const { game, player, combat, rig, state } = h;
    h.beginFalling(1.1);
    const probe = h.installProbe();
    const started = combat.tryPrimaryAttack(game.pointer.aimWorld);

    for (let frame = 0; frame < 180; frame += 1) {
      h.tick();
      if ((player.getSwordJumpSlashVisualProgress?.() ?? 0) >= 0.47) break;
    }

    // Jump slash intentionally resets the grounded combo. Seed every combo
    // field here so the death hook proves that its shared pending-attack
    // cleanup path resets the complete structure as well.
    Object.assign(combat.swordCombo, {
      weaponKey: state.key,
      awaitingFollowUp: true,
      buffered: true,
      timer: 1,
    });

    const countLiveJumpSlashMeshes = () => {
      let count = 0;
      game.scene.traverse((object) => {
        if (object.userData?.slashClipKey === jumpSlash
          && object.userData?.trailMode === 'liveBladeSweep') count += 1;
      });
      return count;
    };

    const activeHandle = combat.activeSwordSweepTrail?.handle ?? null;
    const beforeDeath = {
      visualActive: player.isSwordJumpSlashVisualActive(),
      visualProgress: player.getSwordJumpSlashVisualProgress?.() ?? null,
      bladeVisible: rig.beamBladeGroup?.visible ?? false,
      pendingMeleeCount: combat.pendingMeleeStrikes.length,
      activeTrail: Boolean(combat.activeSwordSweepTrail),
      activeTrailSampleCount: activeHandle?.samples?.length ?? 0,
      activeTrailGlowParented: Boolean(activeHandle?.glow?.parent),
      activeTrailCoreParented: Boolean(activeHandle?.core?.parent),
      liveMeshCount: countLiveJumpSlashMeshes(),
      combo: { ...combat.swordCombo },
      deathHookInstalled: typeof player.onDeathStarted === 'function',
    };

    let combatUpdatesAfterDamage = 0;
    const originalCombatUpdate = combat.update.bind(combat);
    combat.update = (...args) => {
      combatUpdatesAfterDamage += 1;
      return originalCombatUpdate(...args);
    };
    player.health = 0.01;
    const dealt = player.takeDamage(1, null, { unblockable: true });

    // Snapshot immediately: no Player.update, CombatSystem.update, or timed
    // effect update is allowed to make the synchronous cleanup pass later.
    const immediatelyAfterDamage = {
      dealt,
      health: player.health,
      dead: player.dead,
      combatUpdatesAfterDamage,
      visualActive: player.isSwordJumpSlashVisualActive(),
      aerialPoseActive: rig.root.userData.jumpSlashAerialPoseActive,
      rootAnchorActive: rig.root.userData.jumpSlashAirborneRootAnchorActive,
      bladeVisible: rig.beamBladeGroup?.visible ?? false,
      attackTimer: player.animation.attackTimer,
      attackDuration: player.animation.attackDuration,
      attackWeaponKind: player._attackWeaponKind,
      activeSwordClip: player._activeSwordSlashClipKey,
      pendingMeleeCount: combat.pendingMeleeStrikes.length,
      pendingProjectileCount: combat.pendingProjectileShots.length,
      activeTrail: Boolean(combat.activeSwordSweepTrail),
      combo: { ...combat.swordCombo },
      liveMeshCount: countLiveJumpSlashMeshes(),
      oldGlowParented: Boolean(activeHandle?.glow?.parent),
      oldCoreParented: Boolean(activeHandle?.core?.parent),
      trailCancelCalls: probe.cancels.length,
    };

    return {
      swordIndex: h.swordIndex,
      started,
      beforeDeath,
      immediatelyAfterDamage,
    };
  }, { jumpSlash: JUMP_SLASH });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.started).toBe(true);
  expect(result.beforeDeath).toEqual(expect.objectContaining({
    visualActive: true,
    bladeVisible: true,
    pendingMeleeCount: 1,
    activeTrail: true,
    activeTrailGlowParented: true,
    activeTrailCoreParented: true,
    liveMeshCount: 2,
    deathHookInstalled: true,
  }));
  expect(result.beforeDeath.visualProgress).toBeGreaterThanOrEqual(0.47);
  expect(result.beforeDeath.visualProgress).toBeLessThan(JUMP_SLASH_STRIKE_PROGRESS);
  expect(result.beforeDeath.activeTrailSampleCount).toBeGreaterThanOrEqual(2);
  expect(result.beforeDeath.combo).toEqual(expect.objectContaining({
    awaitingFollowUp: true,
    buffered: true,
    timer: 1,
  }));

  expect(result.immediatelyAfterDamage.dealt).toBeGreaterThan(0);
  expect(result.immediatelyAfterDamage).toEqual(expect.objectContaining({
    health: 0,
    dead: true,
    combatUpdatesAfterDamage: 0,
    visualActive: false,
    aerialPoseActive: false,
    rootAnchorActive: false,
    bladeVisible: false,
    attackTimer: 0,
    attackDuration: 0,
    attackWeaponKind: null,
    activeSwordClip: null,
    pendingMeleeCount: 0,
    pendingProjectileCount: 0,
    activeTrail: false,
    liveMeshCount: 0,
    oldGlowParented: false,
    oldCoreParented: false,
    trailCancelCalls: 1,
  }));
  expect(result.immediatelyAfterDamage.combo).toEqual({
    weaponKey: null,
    awaitingFollowUp: false,
    buffered: false,
    timer: 0,
  });
});
