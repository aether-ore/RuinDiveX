import { expect, test } from '@playwright/test';

const JUMP_SLASH = 'swordJumpSlash';
const OPENING_SLASH = 'swordForwardSlash';
const JUMP_SLASH_DURATION = 0.86;
const JUMP_SLASH_STRIKE_PROGRESS = 0.5;
const JUMP_SLASH_TRAIL_START = 24 / 56;
const JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS = 28.5143 / 56;
const JUMP_SLASH_SEAM_PROGRESS = 32 / 56;
const JUMP_SLASH_UPPER_BODY_END_PROGRESS = 37 / 56;
const JUMP_SLASH_TRAIL_END = 37 / 56;
const JUMP_SLASH_TRAIL_COLOR = 0xa8ff8a;
const JUMP_SLASH_RECOVERY_DURATION = JUMP_SLASH_DURATION * (1 - JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS);
const JUMP_SLASH_LOWER_BODY_JOINTS = Object.freeze([
  'hips',
  'leftHip',
  'leftKnee',
  'leftAnkle',
  'rightHip',
  'rightKnee',
  'rightAnkle',
]);
const JUMP_SLASH_UPPER_BODY_JOINTS = Object.freeze([
  'spine',
  'neck',
  'leftShoulder',
  'leftElbow',
  'leftWrist',
  'rightShoulder',
  'rightElbow',
  'rightWrist',
]);
const JUMP_SLASH_AERIAL_POSE = Object.freeze({
  hips: Object.freeze({ pitch: 10.5, yaw: -26.8, roll: 0.7 }),
  spine: Object.freeze({ pitch: 2, yaw: -0.4, roll: 0.2 }),
  neck: Object.freeze({ pitch: 0.2, yaw: 15, roll: -10.6 }),
  leftShoulder: Object.freeze({ pitch: 52, yaw: 7.3, roll: 64.6 }),
  leftElbow: Object.freeze({ pitch: 19.8, yaw: -34.7, roll: 38.5 }),
  leftWrist: Object.freeze({ pitch: -8.9, yaw: 5.6, roll: -47.7 }),
  rightShoulder: Object.freeze({ pitch: 42.3, yaw: 26.1, roll: -28.5 }),
  rightElbow: Object.freeze({ pitch: 29.3, yaw: 45.1, roll: -25.5 }),
  rightWrist: Object.freeze({ pitch: -12.5, yaw: -6.9, roll: 38.5 }),
  leftHip: Object.freeze({ pitch: 54.5, yaw: -10, roll: 16.4 }),
  leftKnee: Object.freeze({ pitch: -10.6, yaw: -8.2, roll: 2.6 }),
  leftAnkle: Object.freeze({ pitch: -16.9, yaw: 1.8, roll: 0.4 }),
  rightHip: Object.freeze({ pitch: 63.9, yaw: 5.8, roll: -3.9 }),
  rightKnee: Object.freeze({ pitch: -65.3, yaw: -0.1, roll: -1.2 }),
  rightAnkle: Object.freeze({ pitch: -2.9, yaw: 0.3, roll: 2.3 }),
});
async function openLoadedGame(page) {
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => (
    window.game?.player?._fbxAnimationLibraryLoaded === true
    && window.game?.player?._busterArmLoaded === true
  ));
}

async function installJumpSlashHarness(page) {
  await page.evaluate(({ jumpSlash, matchProgress, seamProgress, targetPose }) => {
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

      const poseError = (jointNames = Object.keys(targetPose)) => {
        let maximum = 0;
        let missing = 0;
        const semanticBones = [];
        for (const jointName of jointNames) {
          const pose = targetPose[jointName];
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

      const runtimeSourcePoseError = (
        progress = seamProgress,
        jointNames = Object.keys(targetPose),
      ) => {
        let maximum = 0;
        let missing = 0;
        const sampleTime = (clip?.duration ?? 0) * progress;
        for (const jointName of jointNames) {
          const joint = rig.joints.get(jointName);
          const track = rig._findJointQuaternionTrack?.(clip, jointName);
          if (!joint || !track?.values || track.values.length < 4) {
            missing += 1;
            continue;
          }
          const sampled = track.createInterpolant(new Float32Array(4)).evaluate(sampleTime);
          const expected = new Quaternion().fromArray(sampled).normalize();
          maximum = Math.max(
            maximum,
            joint.quaternion.angleTo(expected) * 180 / Math.PI,
          );
        }
        return { maximum, missing };
      };

      const sourceTargetPoseError = (progress = matchProgress) => {
        let maximum = 0;
        let missing = 0;
        const sampleTime = (clip?.duration ?? 0) * progress;
        for (const [jointName, pose] of Object.entries(targetPose)) {
          const joint = rig.joints.get(jointName);
          const rest = joint ? rig.restLocalQuaternions.get(joint) : null;
          const track = rig._findJointQuaternionTrack?.(clip, jointName);
          if (!joint || !rest || !track?.values || track.values.length < 4) {
            missing += 1;
            continue;
          }
          const sampled = track.createInterpolant(new Float32Array(4)).evaluate(sampleTime);
          const source = new Quaternion().fromArray(sampled).normalize();
          const target = rest.clone().multiply(new Quaternion().setFromEuler(new Euler(
            pose.pitch * Math.PI / 180,
            pose.yaw * Math.PI / 180,
            pose.roll * Math.PI / 180,
            joint.rotation.order,
          ))).normalize();
          maximum = Math.max(maximum, source.angleTo(target) * 180 / Math.PI);
        }
        return { maximum, missing };
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
          const color = args[0];
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
              trailMode: handle?.glow?.userData?.trailMode ?? null,
              color: handle?.glow?.material?.color?.getHex?.() ?? color ?? null,
              coreColor: handle?.core?.material?.color?.getHex?.() ?? null,
              glowAdditive: handle?.glow?.material?.blending === 2
                && handle?.core?.material?.blending === 2,
              rolling: Boolean(handle?.rolling),
              maxSamples: handle?.maxSamples ?? null,
              minimumSampleDistance: handle?.minimumSampleDistance ?? null,
              maximumTrailLength: handle?.maximumTrailLength ?? null,
              optionsFollowRoot: options.followObject === player.root,
              handleFollowRoot: handle?.followObject === player.root,
              glowParentRoot: handle?.glow?.parent === player.root,
              coreParentRoot: handle?.core?.parent === player.root,
              glowParentScene: handle?.glow?.parent === game.scene,
              coreParentScene: handle?.core?.parent === game.scene,
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

        const residentRibbonGeometryError = (mesh, ratio, handle) => {
          const position = mesh?.geometry?.attributes?.position;
          if (!position || !handle?.samples?.length) return Infinity;
          let maximumError = 0;
          for (let sampleIndex = 0; sampleIndex < handle.samples.length; sampleIndex += 1) {
            const ribbonSample = handle.samples[sampleIndex];
            const offset = sampleIndex * 2;
            const renderedInner = new Vector3(
              position.getX(offset),
              position.getY(offset),
              position.getZ(offset),
            );
            const renderedTip = new Vector3(
              position.getX(offset + 1),
              position.getY(offset + 1),
              position.getZ(offset + 1),
            );
            const expectedInner = ribbonSample.base.clone().lerp(ribbonSample.tip, ratio);
            maximumError = Math.max(
              maximumError,
              renderedInner.distanceTo(expectedInner),
              renderedTip.distanceTo(ribbonSample.tip),
            );
          }
          return maximumError;
        };

        game.appendBeamBladeSweepTrail = (...args) => {
          const [handle, baseWorld, tipWorld, progress] = args;
          const result = originalAppend(...args);
          const afterCount = handle?.samples?.length ?? 0;
          if (handle?.clipKey === jumpSlash) {
            const accepted = Boolean(result);
            const sample = accepted ? handle.samples[afterCount - 1] : null;
            const residentFirstSample = accepted ? handle.samples[0] : null;
            let localSampleError = null;
            let worldMetadataError = null;
            let geometryError = null;
            let residentGeometryError = null;
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
              residentGeometryError = Math.max(
                residentRibbonGeometryError(handle.glow, 0.24, handle),
                residentRibbonGeometryError(handle.core, 0.76, handle),
              );
            }
            appends.push({
              id: getId(handle),
              elapsed,
              accepted,
              progress: Number.isFinite(progress) ? progress : null,
              phase: player._jumpSlashVisualState?.phase ?? null,
              airborne: player.isJumpAirborne(),
              attackTimer: player.animation.attackTimer,
              rootY: player.root.position.y,
              baseWorld: sample?.baseWorld?.toArray?.() ?? null,
              tipWorld: sample?.tipWorld?.toArray?.() ?? null,
              baseWorldY: sample?.baseWorld?.y ?? null,
              tipWorldY: sample?.tipWorld?.y ?? null,
              residentBaseWorldYSpan: accepted
                ? Math.abs((residentFirstSample?.baseWorld?.y ?? 0) - (sample?.baseWorld?.y ?? 0))
                : null,
              residentTipWorldYSpan: accepted
                ? Math.abs((residentFirstSample?.tipWorld?.y ?? 0) - (sample?.tipWorld?.y ?? 0))
                : null,
              localSampleError,
              worldMetadataError,
              geometryError,
              residentGeometryError,
              followRoot: handle.followObject === player.root,
              glowParentRoot: handle.glow?.parent === player.root,
              coreParentRoot: handle.core?.parent === player.root,
              glowParentScene: handle.glow?.parent === game.scene,
              coreParentScene: handle.core?.parent === game.scene,
              trailSpace: handle.glow?.userData?.trailSpace ?? null,
              trailMode: handle.glow?.userData?.trailMode ?? null,
              glowVisible: Boolean(handle.glow?.visible),
              coreVisible: Boolean(handle.core?.visible),
              glowDrawCount: handle.glow?.geometry?.drawRange?.count ?? 0,
              coreDrawCount: handle.core?.geometry?.drawRange?.count ?? 0,
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
              trailMode: handle.glow?.userData?.trailMode ?? null,
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
              trailMode: handle.glow?.userData?.trailMode ?? null,
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
        runtimeSourcePoseError,
        sourceTargetPoseError,
        actionProgress,
        countJumpSlashMeshes,
        installProbe,
        get elapsed() { return elapsed; },
      };
    };
  }, {
    jumpSlash: JUMP_SLASH,
    matchProgress: JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS,
    seamProgress: JUMP_SLASH_SEAM_PROGRESS,
    targetPose: JUMP_SLASH_AERIAL_POSE,
  });
}

test('jump slash keeps the full clip, strips horizontal root travel, and caches its source anchor', async ({ page }) => {
  await openLoadedGame(page);

  const result = await page.evaluate(({ jumpSlash }) => {
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
      restHips: rig.joints.get('hips')?.userData?.restLocalPosition?.toArray?.() ?? null,
      clampWhenFinished: action?.clampWhenFinished ?? null,
    };
  }, { jumpSlash: JUMP_SLASH });

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
  expect(result.cachedAnchor[1]).not.toBeCloseTo(result.restHips[1], 3);
});

test('a rolling blade trail retains its capped glow across one coarse fall sample', async ({ page }) => {
  await openLoadedGame(page);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const Vector3 = game.player.root.position.constructor;
    const trail = game.beginBeamBladeSweepTrail(0xa8ff8a, {
      trailPhase: 'airborneFall',
      rolling: true,
      maxSamples: 100,
      minimumSampleDistance: 0.035,
      maximumTrailLength: 3.4,
    });
    const acceptedFirst = game.appendBeamBladeSweepTrail(
      trail,
      new Vector3(0, 10, 0),
      new Vector3(0, 10, 1.57),
      28.5143 / 56,
    );
    const acceptedSecond = game.appendBeamBladeSweepTrail(
      trail,
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 1.57),
      28.5143 / 56,
    );
    const first = trail.samples[0];
    const last = trail.samples[trail.samples.length - 1];
    const snapshot = {
      acceptedFirst,
      acceptedSecond,
      sampleCount: trail.samples.length,
      baseSpan: first.base.distanceTo(last.base),
      tipSpan: first.tip.distanceTo(last.tip),
      glowVisible: trail.glow.visible,
      coreVisible: trail.core.visible,
      glowDrawCount: trail.glow.geometry.drawRange.count,
      coreDrawCount: trail.core.geometry.drawRange.count,
      firstBaseY: first.base.y,
      lastBaseY: last.base.y,
    };
    game.cancelBeamBladeSweepTrail(trail);
    snapshot.cancelled = trail.finished;
    snapshot.glowDetached = trail.glow.parent === null;
    snapshot.coreDetached = trail.core.parent === null;
    return snapshot;
  });

  expect(result).toEqual(expect.objectContaining({
    acceptedFirst: true,
    acceptedSecond: true,
    sampleCount: 2,
    glowVisible: true,
    coreVisible: true,
    glowDrawCount: 6,
    coreDrawCount: 6,
    lastBaseY: 0,
    cancelled: true,
    glowDetached: true,
    coreDetached: true,
  }));
  expect(result.baseSpan).toBeCloseTo(3.4, 6);
  expect(result.tipSpan).toBeCloseTo(3.4, 6);
  expect(result.firstBaseY).toBeCloseTo(3.4, 6);
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

test('jump slash holds its falling lower body while the airborne upper slash completes', async ({ page }) => {
  await openLoadedGame(page);
  await installJumpSlashHarness(page);

  const result = await page.evaluate(({
    matchProgress,
    seamProgress,
    trailStart,
    trailEnd,
    upperEndProgress,
    lowerBodyJoints,
    upperBodyJoints,
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
    let preHoldWindupFrames = 0;
    let preHoldAllPoseMarkersOff = true;
    let holdFrames = 0;
    let firstHoldProgress = null;
    let minimumHoldProgress = 1;
    let maximumHoldProgress = 0;
    let holdMaximumPoseError = 0;
    let holdMaximumLowerPoseError = 0;
    let holdMaximumUpperSourceError = 0;
    let holdMaximumUpperSourceMissing = 0;
    let holdMinimumUpperProgress = 1;
    let holdMaximumUpperProgress = 0;
    let holdUpperProgressMonotonic = true;
    let previousHoldUpperProgress = matchProgress;
    let upperEndReachedAt = null;
    let upperContinuationStartedAt = null;
    let firstHoldWeight = null;
    let minimumHoldWeight = 1;
    let holdMaximumHipsError = 0;
    let holdMaximumActionError = 0;
    let holdMaximumBonePositionDrift = 0;
    let holdMaximumBoneQuaternionDrift = 0;
    let holdBoneSnapshot = null;
    let holdUpperJointSnapshot = null;
    const holdMaximumUpperJointMotion = Object.fromEntries(
      upperBodyJoints.map((jointName) => [jointName, 0]),
    );
    let holdMaximumBladePositionDrift = 0;
    let holdMaximumBladeQuaternionDrift = 0;
    let holdMaximumBladeScaleDrift = 0;
    let holdBladeTransformSnapshot = null;
    let firstHoldBladeTipLocal = null;
    let holdMaximumBladeTipTravel = 0;
    let lastAirborneHoldElapsed = null;
    let holdAllMarkersOn = true;
    let holdAllEquipmentVisible = true;
    let airborneRecoveryFrames = 0;
    let semanticPoseCheck = null;
    let touchdown = null;
    let recoveryStartedAt = null;
    let recoveryFinishedAt = null;
    let recoveryFrames = 0;
    let firstRecoveryProgress = null;
    let maximumRecoveryProgress = 0;
    let previousRecoveryProgress = matchProgress;
    let recoveryMonotonic = true;
    let allRecoveryBladeVisible = true;
    let maximumGroundedFootError = 0;
    let minimumLeftFootClearance = Infinity;
    let minimumRightFootClearance = Infinity;
    let lastAirborneBodySnapshot = null;
    let touchdownMaximumLowerAngularStep = null;
    let touchdownMaximumUpperAngularStep = null;
    let touchdownHipsPositionStep = null;
    let recoverySawUpperOverride = false;
    let recoverySawMergedBody = false;
    const lowerBranchRoots = [rig.joints.get('leftHip'), rig.joints.get('rightHip')].filter(Boolean);
    const isLowerBranchBone = (bone) => {
      if (bone === rig.joints.get('hips')) return true;
      for (let current = bone; current; current = current.parent) {
        if (lowerBranchRoots.includes(current)) return true;
        if (current === rig.joints.get('hips')) break;
      }
      return false;
    };
    const lowerBranchBones = [...rig.animatedBones].filter(isLowerBranchBone);
    const snapshotBody = () => ({
      hipsPosition: rig.joints.get('hips').position.clone(),
      lower: lowerBranchBones.map((bone) => ({
        bone,
        quaternion: bone.quaternion.clone().normalize(),
      })),
      upper: upperBodyJoints.map((jointName) => ({
        jointName,
        quaternion: rig.joints.get(jointName).quaternion.clone().normalize(),
      })),
    });
    const sourceTargetMatch = h.sourceTargetPoseError(matchProgress);

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
        preHoldWindupFrames += 1;
        preHoldAllPoseMarkersOff &&= rig.root.userData.jumpSlashAerialPoseActive === false;
      }

      if (visual && player.isJumpAirborne() && visual.phase === 'airborneHold') {
        const poseCheck = h.poseError();
        const lowerPoseCheck = h.poseError(lowerBodyJoints);
        const upperProgress = player.getSwordJumpSlashUpperBodyProgress();
        const upperSourceError = h.runtimeSourcePoseError(upperProgress, upperBodyJoints);
        const poseWeight = rig.root.userData.jumpSlashAerialPoseWeight ?? 0;
        semanticPoseCheck ??= poseCheck;
        holdFrames += 1;
        firstHoldProgress ??= progress;
        upperContinuationStartedAt ??= h.elapsed;
        minimumHoldProgress = Math.min(minimumHoldProgress, progress);
        maximumHoldProgress = Math.max(maximumHoldProgress, progress);
        holdMinimumUpperProgress = Math.min(holdMinimumUpperProgress, upperProgress);
        holdMaximumUpperProgress = Math.max(holdMaximumUpperProgress, upperProgress);
        holdUpperProgressMonotonic &&= upperProgress + 0.000001 >= previousHoldUpperProgress;
        previousHoldUpperProgress = upperProgress;
        if (upperEndReachedAt === null && upperProgress >= upperEndProgress - 0.000001) {
          upperEndReachedAt = h.elapsed;
        }
        firstHoldWeight ??= poseWeight;
        minimumHoldWeight = Math.min(minimumHoldWeight, poseWeight);
        holdMaximumPoseError = Math.max(holdMaximumPoseError, poseCheck.maximum);
        holdMaximumLowerPoseError = Math.max(
          holdMaximumLowerPoseError,
          lowerPoseCheck.maximum,
        );
        holdMaximumUpperSourceError = Math.max(
          holdMaximumUpperSourceError,
          upperSourceError.maximum,
        );
        holdMaximumUpperSourceMissing = Math.max(
          holdMaximumUpperSourceMissing,
          upperSourceError.missing,
        );
        holdMaximumHipsError = Math.max(
          holdMaximumHipsError,
          rig.joints.get('hips').position.distanceTo(h.sourceStartHips),
        );
        holdMaximumActionError = Math.max(
          holdMaximumActionError,
          Math.abs(h.actionProgress() - upperProgress),
        );
        if (!holdBoneSnapshot) {
          holdBoneSnapshot = lowerBranchBones.map((bone) => ({
            bone,
            position: bone.position.clone(),
            quaternion: bone.quaternion.clone().normalize(),
          }));
        } else {
          for (const entry of holdBoneSnapshot) {
            const positionDrift = entry.bone.position.distanceTo(entry.position);
            const quaternionDrift = entry.bone.quaternion.clone().normalize().angleTo(
              entry.quaternion,
            );
            holdMaximumBonePositionDrift = Math.max(
              holdMaximumBonePositionDrift,
              positionDrift,
            );
            holdMaximumBoneQuaternionDrift = Math.max(
              holdMaximumBoneQuaternionDrift,
              quaternionDrift,
            );
          }
        }
        if (!holdUpperJointSnapshot) {
          holdUpperJointSnapshot = new Map(upperBodyJoints.map((jointName) => [
            jointName,
            rig.joints.get(jointName).quaternion.clone().normalize(),
          ]));
        } else {
          for (const jointName of upperBodyJoints) {
            holdMaximumUpperJointMotion[jointName] = Math.max(
              holdMaximumUpperJointMotion[jointName],
              rig.joints.get(jointName).quaternion.clone().normalize().angleTo(
                holdUpperJointSnapshot.get(jointName),
              ) * 180 / Math.PI,
            );
          }
        }
        if (!holdBladeTransformSnapshot) {
          holdBladeTransformSnapshot = {
            position: rig.beamBladeGroup.position.clone(),
            quaternion: rig.beamBladeGroup.quaternion.clone().normalize(),
            scale: rig.beamBladeGroup.scale.clone(),
          };
        } else {
          holdMaximumBladePositionDrift = Math.max(
            holdMaximumBladePositionDrift,
            rig.beamBladeGroup.position.distanceTo(holdBladeTransformSnapshot.position),
          );
          holdMaximumBladeQuaternionDrift = Math.max(
            holdMaximumBladeQuaternionDrift,
            rig.beamBladeGroup.quaternion.clone().normalize().angleTo(
              holdBladeTransformSnapshot.quaternion,
            ),
          );
          holdMaximumBladeScaleDrift = Math.max(
            holdMaximumBladeScaleDrift,
            rig.beamBladeGroup.scale.distanceTo(holdBladeTransformSnapshot.scale),
          );
        }
        rig.beamBladeGroup.updateWorldMatrix(true, false);
        player.root.updateWorldMatrix(true, false);
        const bladeTipLocal = new (player.root.position.constructor)(0, 0, 1.57).applyMatrix4(
          rig.beamBladeGroup.matrixWorld,
        );
        player.root.worldToLocal(bladeTipLocal);
        firstHoldBladeTipLocal ??= bladeTipLocal.clone();
        holdMaximumBladeTipTravel = Math.max(
          holdMaximumBladeTipTravel,
          bladeTipLocal.distanceTo(firstHoldBladeTipLocal),
        );
        lastAirborneBodySnapshot = snapshotBody();
        lastAirborneHoldElapsed = h.elapsed;
        holdAllMarkersOn &&= Boolean(
          rig.root.userData.jumpSlashAerialPoseActive
          && rig.root.userData.jumpSlashLowerBodyPoseActive
          && rig.root.userData.jumpSlashAirborneRootAnchorActive
          && rig.root.userData.jumpSlashBeamBladeHoldTransformActive
        );
        holdAllEquipmentVisible &&= Boolean(
          rig.beamBladeWeaponGroup?.visible
          && rig.beamBladeHilt?.visible
          && rig.beamBladeGroup?.visible
          && !rig.busterArmGroup?.visible
        );
      }

      if (visual?.phase === 'groundedRecovery' && player.isJumpAirborne()) {
        airborneRecoveryFrames += 1;
      }

      if (wasAirborne && !player.isJumpAirborne() && !touchdown) {
        const grounding = player.getExternalModelGroundingDiagnostics?.();
        if (lastAirborneBodySnapshot) {
          touchdownMaximumLowerAngularStep = Math.max(
            ...lastAirborneBodySnapshot.lower.map(({ bone, quaternion }) => (
              bone.quaternion.clone().normalize().angleTo(quaternion) * 180 / Math.PI
            )),
          );
          touchdownMaximumUpperAngularStep = Math.max(
            ...lastAirborneBodySnapshot.upper.map(({ jointName, quaternion }) => (
              rig.joints.get(jointName).quaternion.clone().normalize().angleTo(quaternion)
                * 180 / Math.PI
            )),
          );
          touchdownHipsPositionStep = rig.joints.get('hips').position.distanceTo(
            lastAirborneBodySnapshot.hipsPosition,
          );
        }
        touchdown = {
          elapsed: h.elapsed,
          phase: visual?.phase ?? null,
          visualProgress: progress,
          upperBodyProgress: player.getSwordJumpSlashUpperBodyProgress(),
          actionProgress: h.actionProgress(),
          poseError: h.poseError().maximum,
          hipsDistanceFromAnchor: rig.joints.get('hips').position.distanceTo(h.sourceStartHips),
          poseMarker: rig.root.userData.jumpSlashAerialPoseActive,
          rootAnchorMarker: rig.root.userData.jumpSlashAirborneRootAnchorActive,
          upperBodyOverrideMarker: rig.root.userData.jumpSlashUpperBodyOverrideActive,
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
        recoverySawUpperOverride ||= Boolean(
          rig.root.userData.jumpSlashUpperBodyOverrideActive,
        );
        recoverySawMergedBody ||= Boolean(
          !visual.splitBodyLandingActive
          && progressNow >= upperEndProgress - 0.000001,
        );
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
        trailModes: [...new Set(samples.map((sample) => sample.trailMode))],
        maximumLocalSampleError: Math.max(...samples.map((sample) => sample.localSampleError)),
        maximumWorldMetadataError: Math.max(...samples.map((sample) => sample.worldMetadataError)),
        maximumGeometryError: Math.max(...samples.map((sample) => sample.geometryError)),
        maximumResidentGeometryError: Math.max(
          ...samples.map((sample) => sample.residentGeometryError),
        ),
        allFollowRoot: samples.every((sample) => (
          sample.followRoot
          && sample.glowParentRoot
          && sample.coreParentRoot
          && sample.trailSpace === 'followObjectLocal'
        )),
        allWorldSpace: samples.every((sample) => (
          !sample.followRoot
          && sample.glowParentScene
          && sample.coreParentScene
          && sample.trailSpace === 'world'
        )),
        visibleSamples: samples.filter((sample) => (
          sample.glowVisible
          && sample.coreVisible
          && sample.glowDrawCount > 0
          && sample.coreDrawCount > 0
        )).length,
        postGameplaySamples: samples.filter((sample) => sample.attackTimer <= 0).length,
        firstBaseWorldY: samples[0]?.baseWorldY ?? null,
        lastBaseWorldY: samples[samples.length - 1]?.baseWorldY ?? null,
        firstTipWorldY: samples[0]?.tipWorldY ?? null,
        lastTipWorldY: samples[samples.length - 1]?.tipWorldY ?? null,
        maximumResidentBaseWorldYSpan: Math.max(
          ...samples.map((sample) => sample.residentBaseWorldYSpan ?? 0),
        ),
        maximumResidentTipWorldYSpan: Math.max(
          ...samples.map((sample) => sample.residentTipWorldYSpan ?? 0),
        ),
        lastElapsed: samples[samples.length - 1]?.elapsed ?? null,
      };
    });
    const crossHoldOrLandingSegments = ids.filter((id) => {
      const samples = accepted.filter((sample) => sample.id === id);
      return samples.some((sample) => sample.airborne)
        && samples.some((sample) => !sample.airborne);
    });
    const samplesPastAirborneMatch = accepted.filter((sample) => (
      sample.airborne && sample.progress > matchProgress + 0.000001
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
      preHoldWindupFrames,
      preHoldAllPoseMarkersOff,
      sourceTargetMatch,
      holdFrames,
      firstHoldProgress,
      minimumHoldProgress,
      maximumHoldProgress,
      holdMaximumPoseError,
      holdMaximumLowerPoseError,
      holdMaximumUpperSourceError,
      holdMaximumUpperSourceMissing,
      holdMinimumUpperProgress,
      holdMaximumUpperProgress,
      holdUpperProgressMonotonic,
      upperContinuationDuration: upperEndReachedAt === null
        ? null
        : upperEndReachedAt - upperContinuationStartedAt,
      firstHoldWeight,
      minimumHoldWeight,
      holdMaximumHipsError,
      holdMaximumActionError,
      holdMaximumBonePositionDrift,
      holdMaximumBoneQuaternionDrift,
      holdMaximumUpperJointMotion,
      holdMaximumBladePositionDrift,
      holdMaximumBladeQuaternionDrift,
      holdMaximumBladeScaleDrift,
      holdMaximumBladeTipTravel,
      lastAirborneHoldElapsed,
      holdAllMarkersOn,
      holdAllEquipmentVisible,
      airborneRecoveryFrames,
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
      touchdownMaximumLowerAngularStep,
      touchdownMaximumUpperAngularStep,
      touchdownHipsPositionStep,
      recoverySawUpperOverride,
      recoverySawMergedBody,
      lowerBranchBoneCount: lowerBranchBones.length,
      cachedLowerBodyBoneCount: rig.root.userData.jumpSlashLowerBodyBoneCount ?? 0,
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
      samplesPastAirborneMatch: samplesPastAirborneMatch.length,
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
    matchProgress: JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS,
    seamProgress: JUMP_SLASH_SEAM_PROGRESS,
    trailStart: JUMP_SLASH_TRAIL_START,
    trailEnd: JUMP_SLASH_TRAIL_END,
    upperEndProgress: JUMP_SLASH_UPPER_BODY_END_PROGRESS,
    lowerBodyJoints: JUMP_SLASH_LOWER_BODY_JOINTS,
    upperBodyJoints: JUMP_SLASH_UPPER_BODY_JOINTS,
  });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.jumped).toBe(true);
  expect(result.started).toBe(true);
  expect(result.energySpent).toBe(result.expectedEnergyCost);
  expect(result.outputSpent).toBeCloseTo(result.expectedOutputCost, 6);
  expect(result.initialTrailState).toEqual({
    progressSource: 'jumpSlashUpperBody',
    startProgress: JUMP_SLASH_TRAIL_START,
    endProgress: JUMP_SLASH_TRAIL_END,
    followRoot: false,
  });

  expect(result.windupFrames).toBeGreaterThan(80);
  expect(result.windupMonotonic).toBe(true);
  expect(result.windupMaximumProgress).toBeGreaterThan(
    JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS - 0.01,
  );
  expect(result.windupMaximumProgress).toBeLessThan(JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS);
  expect(result.windupMaximumActionSyncError).toBeLessThan(0.001);
  expect(result.windupMaximumHipsError).toBeLessThan(0.000001);
  expect(result.windupMaximumPoseError).toBeGreaterThan(5);
  expect(result.windupAllRootAnchored).toBe(true);
  expect(result.preHoldWindupFrames).toBeGreaterThan(80);
  expect(result.preHoldAllPoseMarkersOff).toBe(true);
  expect(result.sourceTargetMatch).toEqual(expect.objectContaining({ missing: 0 }));
  expect(result.sourceTargetMatch.maximum).toBeLessThan(0.1);

  expect(result.holdFrames).toBeGreaterThan(10);
  expect(result.firstHoldProgress).toBeCloseTo(JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS, 8);
  expect(result.minimumHoldProgress).toBeCloseTo(JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS, 8);
  expect(result.maximumHoldProgress).toBeCloseTo(JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS, 8);
  expect(result.holdMaximumPoseError).toBeGreaterThan(45);
  expect(result.holdMaximumLowerPoseError).toBeLessThan(0.1);
  expect(result.holdMaximumUpperSourceError).toBeLessThan(0.1);
  expect(result.holdMaximumUpperSourceMissing).toBe(0);
  expect(result.lowerBranchBoneCount).toBeGreaterThanOrEqual(9);
  expect(result.cachedLowerBodyBoneCount).toBe(9);
  expect(result.lowerBranchBoneCount).toBeGreaterThanOrEqual(result.cachedLowerBodyBoneCount);
  expect(result.holdMinimumUpperProgress).toBeCloseTo(
    JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS,
    8,
  );
  expect(result.holdMaximumUpperProgress).toBeCloseTo(JUMP_SLASH_UPPER_BODY_END_PROGRESS, 8);
  expect(result.holdUpperProgressMonotonic).toBe(true);
  expect(Math.abs(
    result.upperContinuationDuration
      - JUMP_SLASH_DURATION * (JUMP_SLASH_UPPER_BODY_END_PROGRESS - JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS)
  )).toBeLessThanOrEqual((2 / 240) + 0.000001);
  expect(result.firstHoldWeight).toBeCloseTo(1, 6);
  expect(result.minimumHoldWeight).toBeCloseTo(1, 6);
  expect(result.holdMaximumHipsError).toBeLessThan(0.000001);
  expect(result.holdMaximumActionError).toBeLessThan(0.001);
  expect(result.holdMaximumBonePositionDrift).toBeLessThan(0.000001);
  expect(result.holdMaximumBoneQuaternionDrift).toBeLessThan(0.000001);
  expect(result.holdMaximumUpperJointMotion.rightShoulder).toBeGreaterThan(20);
  expect(result.holdMaximumUpperJointMotion.rightElbow).toBeGreaterThan(15);
  expect(result.holdMaximumUpperJointMotion.rightWrist).toBeGreaterThan(10);
  expect(result.holdMaximumBladePositionDrift).toBeLessThan(0.000001);
  expect(result.holdMaximumBladeQuaternionDrift).toBeLessThan(0.000001);
  expect(result.holdMaximumBladeScaleDrift).toBeLessThan(0.000001);
  expect(result.holdMaximumBladeTipTravel).toBeGreaterThan(0.5);
  expect(result.holdAllMarkersOn).toBe(true);
  expect(result.holdAllEquipmentVisible).toBe(true);
  expect(result.airborneRecoveryFrames).toBe(0);
  expect(result.touchdown.elapsed - result.lastAirborneHoldElapsed).toBeLessThanOrEqual(
    (1 / 240) + 0.000001,
  );
  expect(result.semanticPoseCheck).toEqual(expect.objectContaining({
    missing: 0,
    uniqueSemanticBones: 15,
  }));
  expect(result.semanticPoseCheck.maximum).toBeLessThan(0.1);

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

  expect(result.begins).toHaveLength(1);
  const continuousBegin = result.begins[0];
  expect(continuousBegin).toEqual(expect.objectContaining({
    phase: 'airborneWindup',
    airborne: true,
    color: JUMP_SLASH_TRAIL_COLOR,
    coreColor: JUMP_SLASH_TRAIL_COLOR,
    glowAdditive: true,
    rolling: true,
    maxSamples: 100,
    minimumSampleDistance: 0.035,
    maximumTrailLength: 3.4,
    optionsFollowRoot: false,
    handleFollowRoot: false,
    glowParentScene: true,
    coreParentScene: true,
    trailSpace: 'world',
  }));
  expect(continuousBegin.trailMode).toBe('continuousJumpSlash');
  expect(result.trailEpochs).toHaveLength(1);
  const continuousEpoch = result.trailEpochs[0];
  expect(continuousEpoch.id).toBe(continuousBegin.id);
  expect(continuousEpoch.count).toBeGreaterThan(20);
  expect(continuousEpoch.minimumProgress).toBeGreaterThanOrEqual(JUMP_SLASH_TRAIL_START);
  expect(continuousEpoch.minimumProgress).toBeLessThan(JUMP_SLASH_TRAIL_START + 0.01);
  expect(continuousEpoch.maximumProgress).toBeCloseTo(JUMP_SLASH_TRAIL_END, 8);
  expect(continuousEpoch.phases).toEqual(['airborneWindup', 'airborneHold']);
  expect(continuousEpoch.trailModes).toEqual(['continuousJumpSlash']);
  expect(continuousEpoch.allWorldSpace).toBe(true);
  expect(continuousEpoch.visibleSamples).toBeGreaterThan(0);
  expect(continuousEpoch.firstBaseWorldY - continuousEpoch.lastBaseWorldY).toBeGreaterThan(0.05);
  expect(continuousEpoch.firstTipWorldY - continuousEpoch.lastTipWorldY).toBeGreaterThan(0.05);
  expect(continuousEpoch.maximumResidentBaseWorldYSpan).toBeLessThanOrEqual(3.400001);
  expect(continuousEpoch.maximumResidentTipWorldYSpan).toBeLessThanOrEqual(3.400001);
  expect(continuousEpoch.maximumLocalSampleError).toBeLessThan(0.000001);
  expect(continuousEpoch.maximumWorldMetadataError).toBeLessThan(0.000001);
  expect(continuousEpoch.maximumGeometryError).toBeLessThan(0.00001);
  expect(continuousEpoch.maximumResidentGeometryError).toBeLessThan(0.00001);
  expect(result.crossHoldOrLandingSegments).toEqual([]);
  expect(result.samplesPastAirborneMatch).toBeGreaterThan(10);
  expect(result.samplesBeforeLandingSeam).toBe(0);
  expect(result.finishes).toHaveLength(1);
  expect(result.finishes[0].id).toBe(continuousEpoch.id);
  expect(result.cancels).toHaveLength(0);

  expect(result.touchdown).toEqual(expect.objectContaining({
    phase: 'groundedRecovery',
    poseMarker: false,
    rootAnchorMarker: false,
    upperBodyOverrideMarker: true,
    reason: 'jumpSlashLanding',
  }));
  expect(result.touchdown.visualProgress).toBeCloseTo(
    JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS,
    6,
  );
  expect(result.touchdown.upperBodyProgress).toBeCloseTo(JUMP_SLASH_UPPER_BODY_END_PROGRESS, 6);
  expect(result.touchdown.actionProgress).toBeCloseTo(
    JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS,
    4,
  );
  expect(result.touchdown.poseError).toBeGreaterThan(45);
  expect(result.touchdown.hipsDistanceFromAnchor).toBeLessThan(0.000001);
  expect(result.touchdownMaximumLowerAngularStep).toBeLessThan(0.1);
  expect(result.touchdownMaximumUpperAngularStep).toBeLessThan(0.1);
  expect(result.touchdownHipsPositionStep).toBeLessThan(0.000001);
  expect(Math.abs(result.touchdown.footClearance)).toBeLessThan(0.005);

  expect(result.recoveryFrames).toBeGreaterThan(40);
  expect(result.firstRecoveryProgress).toBeGreaterThanOrEqual(
    JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS - 0.000001,
  );
  expect(result.firstRecoveryProgress).toBeLessThan(
    JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS + 0.02,
  );
  expect(result.maximumRecoveryProgress).toBeGreaterThan(0.98);
  expect(result.recoveryMonotonic).toBe(true);
  expect(Math.abs(result.recoveryDuration - JUMP_SLASH_RECOVERY_DURATION)).toBeLessThanOrEqual(
    (2 / 240) + 0.000001,
  );
  expect(result.allRecoveryBladeVisible).toBe(true);
  expect(result.recoverySawUpperOverride).toBe(true);
  expect(result.recoverySawMergedBody).toBe(true);
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

test('a long fall holds completed upper follow-through and frozen legs through touchdown', async ({ page }) => {
  await openLoadedGame(page);
  await installJumpSlashHarness(page);

  const result = await page.evaluate(({
    matchProgress,
    lowerBodyJoints,
    upperBodyJoints,
  }) => {
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
    let holdMaximumLowerPoseError = 0;
    let holdMaximumUpperSourceError = 0;
    let holdMaximumUpperSourceMissing = 0;
    let holdMaximumHipsError = 0;
    let holdMaximumActionError = 0;
    let holdMinimumProgress = 1;
    let holdMaximumProgress = 0;
    let holdMinimumUpperProgress = 1;
    let holdMaximumUpperProgress = 0;
    let holdAllMarkersOn = true;
    let holdAllBladeVisible = true;
    let lastAirborneHoldElapsed = null;
    let airborneRecoveryFrames = 0;
    let postGameplayHoldFrames = 0;
    let postGameplayMaximumPoseError = 0;
    let postGameplayMaximumLowerPoseError = 0;
    let touchdown = null;
    let recoveryStartedAt = null;
    let recoveryFinishedAt = null;
    let recoveryFrames = 0;
    let firstRecoveryProgress = null;
    let maximumRecoveryProgress = 0;
    let previousRecoveryProgress = matchProgress;
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
        const lowerPoseError = h.poseError(lowerBodyJoints).maximum;
        const upperProgress = player.getSwordJumpSlashUpperBodyProgress();
        holdFrames += 1;
        holdMinimumProgress = Math.min(holdMinimumProgress, progress);
        holdMaximumProgress = Math.max(holdMaximumProgress, progress);
        holdMaximumPoseError = Math.max(holdMaximumPoseError, poseError);
        holdMaximumLowerPoseError = Math.max(holdMaximumLowerPoseError, lowerPoseError);
        const upperSourceError = h.runtimeSourcePoseError(upperProgress, upperBodyJoints);
        holdMaximumUpperSourceError = Math.max(
          holdMaximumUpperSourceError,
          upperSourceError.maximum,
        );
        holdMaximumUpperSourceMissing = Math.max(
          holdMaximumUpperSourceMissing,
          upperSourceError.missing,
        );
        holdMinimumUpperProgress = Math.min(holdMinimumUpperProgress, upperProgress);
        holdMaximumUpperProgress = Math.max(holdMaximumUpperProgress, upperProgress);
        holdMaximumHipsError = Math.max(
          holdMaximumHipsError,
          rig.joints.get('hips').position.distanceTo(h.sourceStartHips),
        );
        holdMaximumActionError = Math.max(
          holdMaximumActionError,
          Math.abs(h.actionProgress() - upperProgress),
        );
        holdAllMarkersOn &&= Boolean(
          rig.root.userData.jumpSlashAerialPoseActive
          && rig.root.userData.jumpSlashLowerBodyPoseActive
          && rig.root.userData.jumpSlashAirborneRootAnchorActive
        );
        holdAllBladeVisible &&= Boolean(rig.beamBladeGroup?.visible);
        lastAirborneHoldElapsed = h.elapsed;
        if (player.animation.attackTimer <= 0) {
          postGameplayHoldFrames += 1;
          postGameplayMaximumPoseError = Math.max(postGameplayMaximumPoseError, poseError);
          postGameplayMaximumLowerPoseError = Math.max(
            postGameplayMaximumLowerPoseError,
            lowerPoseError,
          );
        }
      }

      if (visual?.phase === 'groundedRecovery' && player.isJumpAirborne()) {
        airborneRecoveryFrames += 1;
      }

      if (wasAirborne && !player.isJumpAirborne() && !touchdown) {
        const grounding = player.getExternalModelGroundingDiagnostics?.();
        touchdown = {
          elapsed: h.elapsed,
          phase: visual?.phase ?? null,
          attackTimer: player.animation.attackTimer,
          visualProgress: progress,
          upperBodyProgress: player.getSwordJumpSlashUpperBodyProgress(),
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
        trailModes: [...new Set(samples.map((sample) => sample.trailMode))],
        allRootLocal: samples.every((sample) => (
          sample.followRoot
          && sample.glowParentRoot
          && sample.coreParentRoot
          && sample.trailSpace === 'followObjectLocal'
        )),
        allWorldSpace: samples.every((sample) => (
          !sample.followRoot
          && sample.glowParentScene
          && sample.coreParentScene
          && sample.trailSpace === 'world'
        )),
        visibleSamples: samples.filter((sample) => (
          sample.glowVisible
          && sample.coreVisible
          && sample.glowDrawCount > 0
          && sample.coreDrawCount > 0
        )).length,
        postGameplaySamples: samples.filter((sample) => sample.attackTimer <= 0).length,
        firstBaseWorldY: samples[0]?.baseWorldY ?? null,
        lastBaseWorldY: samples[samples.length - 1]?.baseWorldY ?? null,
        firstTipWorldY: samples[0]?.tipWorldY ?? null,
        lastTipWorldY: samples[samples.length - 1]?.tipWorldY ?? null,
        maximumResidentBaseWorldYSpan: Math.max(
          ...samples.map((sample) => sample.residentBaseWorldYSpan ?? 0),
        ),
        maximumResidentTipWorldYSpan: Math.max(
          ...samples.map((sample) => sample.residentTipWorldYSpan ?? 0),
        ),
        maximumResidentGeometryError: Math.max(
          ...samples.map((sample) => sample.residentGeometryError),
        ),
        lastElapsed: samples[samples.length - 1]?.elapsed ?? null,
      };
    });
    const anyCrossEpoch = ids.some((id) => {
      const samples = accepted.filter((sample) => sample.id === id);
      return samples.some((sample) => sample.airborne)
        && samples.some((sample) => !sample.airborne);
    });
    const anyHoldProgressPastMatch = accepted.some((sample) => (
      sample.airborne && sample.progress > matchProgress + 0.000001
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
      windupFrames,
      windupMaximumProgress,
      windupMaximumHipsError,
      windupMonotonic,
      holdFrames,
      holdMaximumPoseError,
      holdMaximumLowerPoseError,
      holdMaximumUpperSourceError,
      holdMaximumUpperSourceMissing,
      holdMaximumHipsError,
      holdMaximumActionError,
      holdMinimumProgress,
      holdMaximumProgress,
      holdMinimumUpperProgress,
      holdMaximumUpperProgress,
      holdAllMarkersOn,
      holdAllBladeVisible,
      lastAirborneHoldElapsed,
      airborneRecoveryFrames,
      postGameplayHoldFrames,
      postGameplayMaximumPoseError,
      postGameplayMaximumLowerPoseError,
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
      anyHoldProgressPastMatch,
      finalJumpState: player.jumpState,
      finalVisualActive: player.isSwordJumpSlashVisualActive(),
      finalBladeVisible: rig.beamBladeGroup?.visible ?? false,
      finalPendingStrikeCount: combat.pendingMeleeStrikes.length,
      finalActiveTrail: Boolean(combat.activeSwordSweepTrail),
      remainingJumpSlashMeshes: h.countJumpSlashMeshes(),
    };
  }, {
    matchProgress: JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS,
    lowerBodyJoints: JUMP_SLASH_LOWER_BODY_JOINTS,
    upperBodyJoints: JUMP_SLASH_UPPER_BODY_JOINTS,
  });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.started).toBe(true);
  expect(result.energySpent).toBe(result.expectedEnergyCost);
  expect(result.outputSpent).toBeCloseTo(result.expectedOutputCost, 6);
  expect(result.windupFrames).toBeGreaterThan(100);
  expect(result.windupMonotonic).toBe(true);
  expect(result.windupMaximumProgress).toBeGreaterThan(
    JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS - 0.01,
  );
  expect(result.windupMaximumProgress).toBeLessThan(JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS);
  expect(result.windupMaximumHipsError).toBeLessThan(0.000001);
  expect(result.holdFrames).toBeGreaterThan(100);
  expect(result.holdMaximumPoseError).toBeGreaterThan(45);
  expect(result.holdMaximumLowerPoseError).toBeLessThan(0.1);
  expect(result.holdMaximumUpperSourceError).toBeLessThan(0.1);
  expect(result.holdMaximumUpperSourceMissing).toBe(0);
  expect(result.holdMaximumHipsError).toBeLessThan(0.000001);
  expect(result.holdMaximumActionError).toBeLessThan(0.001);
  expect(result.holdMinimumProgress).toBeCloseTo(JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS, 8);
  expect(result.holdMaximumProgress).toBeCloseTo(JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS, 8);
  expect(result.holdMinimumUpperProgress).toBeCloseTo(
    JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS,
    8,
  );
  expect(result.holdMaximumUpperProgress).toBeCloseTo(JUMP_SLASH_UPPER_BODY_END_PROGRESS, 8);
  expect(result.holdAllMarkersOn).toBe(true);
  expect(result.holdAllBladeVisible).toBe(true);
  expect(result.airborneRecoveryFrames).toBe(0);
  expect(result.postGameplayHoldFrames).toBeGreaterThan(20);
  expect(result.postGameplayMaximumPoseError).toBeGreaterThan(45);
  expect(result.postGameplayMaximumLowerPoseError).toBeLessThan(0.1);

  expect(result.strikes).toHaveLength(1);
  expect(result.strikes[0].delay).toBeCloseTo(
    JUMP_SLASH_DURATION * JUMP_SLASH_STRIKE_PROGRESS,
    2,
  );
  expect(result.strikes[0].airborne).toBe(true);
  expect(result.staticFallbackCount).toBe(0);
  expect(result.begins).toHaveLength(1);
  expect(result.epochs).toHaveLength(1);
  const continuousEpoch = result.epochs[0];
  expect(continuousEpoch.id).toBe(result.begins[0].id);
  expect(continuousEpoch.trailModes).toEqual(['continuousJumpSlash']);
  expect(continuousEpoch.count).toBeGreaterThan(30);
  expect(continuousEpoch.allAirborne).toBe(false);
  expect(continuousEpoch.allGrounded).toBe(false);
  expect(continuousEpoch.allWorldSpace).toBe(true);
  expect(continuousEpoch.visibleSamples).toBeGreaterThan(0);
  expect(continuousEpoch.postGameplaySamples).toBeGreaterThan(10);
  expect(continuousEpoch.firstBaseWorldY - continuousEpoch.lastBaseWorldY).toBeGreaterThan(1);
  expect(continuousEpoch.firstTipWorldY - continuousEpoch.lastTipWorldY).toBeGreaterThan(1);
  expect(continuousEpoch.maximumResidentBaseWorldYSpan).toBeLessThanOrEqual(3.400001);
  expect(continuousEpoch.maximumResidentTipWorldYSpan).toBeLessThanOrEqual(3.400001);
  expect(continuousEpoch.maximumResidentGeometryError).toBeLessThan(0.00001);
  expect(result.touchdown.elapsed - continuousEpoch.lastElapsed).toBeLessThanOrEqual(
    (2 / 240) + 0.000001,
  );
  expect(result.anyCrossEpoch).toBe(true);
  expect(result.anyHoldProgressPastMatch).toBe(true);
  expect(result.finishes).toHaveLength(1);
  expect(result.finishes[0].id).toBe(continuousEpoch.id);
  expect(result.cancels).toHaveLength(0);

  expect(result.touchdown.elapsed).toBeGreaterThanOrEqual(result.intendedAirTime - 0.000001);
  expect(result.touchdown.elapsed).toBeLessThanOrEqual(
    result.intendedAirTime + (1 / 240) + 0.000001,
  );
  expect(result.touchdown.elapsed - result.lastAirborneHoldElapsed).toBeLessThanOrEqual(
    (1 / 240) + 0.000001,
  );
  expect(result.touchdown).toEqual(expect.objectContaining({
    phase: 'groundedRecovery',
    poseMarker: false,
    rootAnchorMarker: false,
    reason: 'jumpSlashLanding',
  }));
  expect(result.touchdown.attackTimer).toBeLessThanOrEqual(0);
  expect(result.touchdown.visualProgress).toBeCloseTo(
    JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS,
    6,
  );
  expect(result.touchdown.upperBodyProgress).toBeCloseTo(JUMP_SLASH_UPPER_BODY_END_PROGRESS, 6);
  expect(result.touchdown.actionProgress).toBeCloseTo(
    JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS,
    4,
  );
  expect(result.touchdown.poseError).toBeGreaterThan(45);
  expect(result.touchdown.hipsDistanceFromAnchor).toBeLessThan(0.000001);
  expect(Math.abs(result.touchdown.footClearance)).toBeLessThan(0.005);

  expect(result.recoveryFrames).toBeGreaterThan(40);
  expect(result.firstRecoveryProgress).toBeGreaterThanOrEqual(
    JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS - 0.000001,
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

test('touchdown before the split-body hold continues the blade trail without a frame gap', async ({ page }) => {
  await openLoadedGame(page);
  await installJumpSlashHarness(page);

  const result = await page.evaluate(({ matchProgress, seamProgress, upperEndProgress }) => {
    const h = window.__createJumpSlashHarness({ dt: 1 / 240 });
    const { player, combat } = h;
    const probe = h.installProbe();
    const fall = h.beginFalling(0.41);
    const started = combat.tryPrimaryAttack(window.game.pointer.aimWorld);
    let touchdown = null;

    for (let frame = 0; frame < 720; frame += 1) {
      const wasAirborne = player.isJumpAirborne();
      h.tick();
      if (wasAirborne && !player.isJumpAirborne() && !touchdown) {
        touchdown = {
          elapsed: h.elapsed,
          phase: player._jumpSlashVisualState?.phase ?? null,
          lowerProgress: player.getSwordJumpSlashVisualProgress(),
          upperProgress: player.getSwordJumpSlashUpperBodyProgress(),
        };
      }
      if (touchdown && !player.isSwordJumpSlashVisualActive()) break;
    }

    const accepted = probe.appends.filter((sample) => sample.accepted);
    const airborneSamples = accepted.filter((sample) => sample.airborne);
    const groundedSamples = accepted.filter((sample) => !sample.airborne);
    const endpointStep = (from, to) => Math.max(
      Math.hypot(...from.baseWorld.map((value, axis) => value - to.baseWorld[axis])),
      Math.hypot(...from.tipWorld.map((value, axis) => value - to.tipWorld[axis])),
    );
    const firstGroundedIndex = accepted.findIndex((sample) => !sample.airborne);
    const touchdownEndpointStep = endpointStep(
      accepted[firstGroundedIndex - 1],
      accepted[firstGroundedIndex],
    );
    const ordinaryEndpointSteps = [];
    for (let index = 1; index < accepted.length; index += 1) {
      if (index === firstGroundedIndex
        || accepted[index - 1].airborne !== accepted[index].airborne) continue;
      ordinaryEndpointSteps.push(endpointStep(accepted[index - 1], accepted[index]));
    }
    for (let frame = 0; frame < 60; frame += 1) h.game._updateTimedEffects(1 / 60);
    return {
      started,
      intendedAirTime: fall.intendedAirTime,
      touchdown,
      airborneMaximumProgress: Math.max(...airborneSamples.map((sample) => sample.progress)),
      groundedMinimumProgress: Math.min(...groundedSamples.map((sample) => sample.progress)),
      groundedMaximumProgress: Math.max(...groundedSamples.map((sample) => sample.progress)),
      groundedSampleCount: groundedSamples.length,
      acceptedIds: [...new Set(accepted.map((sample) => sample.id))],
      airborneIds: [...new Set(airborneSamples.map((sample) => sample.id))],
      groundedIds: [...new Set(groundedSamples.map((sample) => sample.id))],
      firstGroundedSampleElapsed: groundedSamples[0]?.elapsed ?? null,
      touchdownEndpointStep,
      maximumOrdinaryEndpointStep: Math.max(0, ...ordinaryEndpointSteps),
      maximumResidentGeometryError: Math.max(
        ...accepted.map((sample) => sample.residentGeometryError),
      ),
      begins: probe.begins,
      finishes: probe.finishes,
      cancels: probe.cancels,
      remainingJumpSlashMeshes: h.countJumpSlashMeshes(),
      matchProgress,
      seamProgress,
      upperEndProgress,
    };
  }, {
    matchProgress: JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS,
    seamProgress: JUMP_SLASH_SEAM_PROGRESS,
    upperEndProgress: JUMP_SLASH_UPPER_BODY_END_PROGRESS,
  });

  expect(result.started).toBe(true);
  expect(result.touchdown.elapsed).toBeGreaterThanOrEqual(result.intendedAirTime - 0.000001);
  expect(result.touchdown.phase).toBe('groundedRecovery');
  expect(result.touchdown.lowerProgress).toBeLessThan(result.matchProgress);
  expect(result.touchdown.upperProgress).toBeCloseTo(result.touchdown.lowerProgress, 8);
  expect(result.groundedSampleCount).toBeGreaterThan(10);
  expect(result.groundedMinimumProgress).toBeLessThan(result.matchProgress);
  expect(result.groundedMinimumProgress).toBeLessThan(result.seamProgress);
  expect(result.groundedMinimumProgress).toBeCloseTo(result.touchdown.upperProgress, 6);
  expect(result.groundedMinimumProgress - result.airborneMaximumProgress).toBeLessThan(0.01);
  expect(result.groundedMaximumProgress).toBeCloseTo(result.upperEndProgress, 6);
  expect(result.begins).toHaveLength(1);
  expect(result.finishes).toHaveLength(1);
  expect(result.acceptedIds).toEqual([result.begins[0].id]);
  expect(result.airborneIds).toEqual([result.begins[0].id]);
  expect(result.groundedIds).toEqual([result.begins[0].id]);
  expect(result.finishes[0].id).toBe(result.begins[0].id);
  expect(result.finishes[0].elapsed).toBeGreaterThanOrEqual(result.firstGroundedSampleElapsed);
  expect(result.touchdownEndpointStep).toBeLessThanOrEqual(Math.max(
    0.1,
    result.maximumOrdinaryEndpointStep * 2.5,
  ));
  expect(result.maximumResidentGeometryError).toBeLessThan(0.00001);
  expect(result.cancels).toHaveLength(0);
  expect(result.remainingJumpSlashMeshes).toBe(0);
});

test('a short touchdown during split-body follow-through neither pops nor rewinds', async ({ page }) => {
  await openLoadedGame(page);
  await installJumpSlashHarness(page);

  const result = await page.evaluate(({
    matchProgress,
    landingStartProgress,
    upperEndProgress,
    lowerBodyJoints,
    upperBodyJoints,
  }) => {
    const h = window.__createJumpSlashHarness({ dt: 1 / 240 });
    const { player, combat, rig } = h;
    const probe = h.installProbe();
    const fall = h.beginFalling(0.49);
    const started = combat.tryPrimaryAttack(window.game.pointer.aimWorld);
    const lowerBranchBones = [...rig.jumpSlashAerialLowerBodyQuaternions.keys()];
    const snapshotBones = (bones) => bones.map((bone) => ({
      bone,
      quaternion: bone.quaternion.clone().normalize(),
    }));
    const snapshotJoints = (jointNames) => jointNames.map((jointName) => ({
      jointName,
      quaternion: rig.joints.get(jointName).quaternion.clone().normalize(),
    }));
    const maximumBoneStep = (snapshot) => Math.max(...snapshot.map(({ bone, quaternion }) => (
      bone.quaternion.clone().normalize().angleTo(quaternion) * 180 / Math.PI
    )));
    const maximumJointStep = (snapshot) => Math.max(...snapshot.map(({ jointName, quaternion }) => (
      rig.joints.get(jointName).quaternion.clone().normalize().angleTo(quaternion)
        * 180 / Math.PI
    )));

    let lastAirborne = null;
    let touchdown = null;
    let previousRecovery = null;
    let recoveryMaximumUpperAngularStep = 0;
    let recoveryMaximumHipsPositionStep = 0;
    let recoveryMaximumLowerSourceError = 0;
    let recoveryMaximumUpperSourceError = 0;
    let recoveryMaximumSourceMissing = 0;
    let recoveryLowerProgressMonotonic = true;
    let recoveryUpperProgressMonotonic = true;
    let landingHipsBlendMonotonic = true;
    let recoverySawSplitBody = false;
    let merge = null;
    for (let frame = 0; frame < 720; frame += 1) {
      const wasAirborne = player.isJumpAirborne();
      h.tick();
      const visual = player._jumpSlashVisualState;
      if (player.isJumpAirborne() && visual?.phase === 'airborneHold') {
        lastAirborne = {
          elapsed: h.elapsed,
          lower: snapshotBones(lowerBranchBones),
          upper: snapshotJoints(upperBodyJoints),
          hipsPosition: rig.joints.get('hips').position.clone(),
          upperBodyProgress: player.getSwordJumpSlashUpperBodyProgress(),
        };
      }
      if (wasAirborne && !player.isJumpAirborne() && !touchdown) {
        touchdown = {
          elapsed: h.elapsed,
          phase: visual?.phase ?? null,
          visualProgress: visual?.visualProgress ?? null,
          upperBodyProgress: player.getSwordJumpSlashUpperBodyProgress(),
          actionProgress: h.actionProgress(),
          lowerAngularStep: maximumBoneStep(lastAirborne.lower),
          upperAngularStep: maximumJointStep(lastAirborne.upper),
          hipsPositionStep: rig.joints.get('hips').position.distanceTo(
            lastAirborne.hipsPosition,
          ),
          upperProgressStep: player.getSwordJumpSlashUpperBodyProgress()
            - lastAirborne.upperBodyProgress,
          upperOverrideActive: rig.root.userData.jumpSlashUpperBodyOverrideActive,
          landingHipsBlendWeight: rig.root.userData.jumpSlashLandingHipsBlendWeight,
        };
      }
      if (visual?.phase === 'groundedRecovery' && !player.isJumpAirborne()) {
        const lowerProgress = visual.visualProgress;
        const upperProgress = player.getSwordJumpSlashUpperBodyProgress();
        const splitBody = Boolean(visual.splitBodyLandingActive);
        const hipsBlendWeight = rig.root.userData.jumpSlashLandingHipsBlendWeight ?? 0;
        const lowerSourceError = h.runtimeSourcePoseError(lowerProgress, lowerBodyJoints);
        const upperSourceError = h.runtimeSourcePoseError(upperProgress, upperBodyJoints);
        recoverySawSplitBody ||= splitBody;
        if (splitBody) {
          recoveryMaximumLowerSourceError = Math.max(
            recoveryMaximumLowerSourceError,
            lowerSourceError.maximum,
          );
          recoveryMaximumUpperSourceError = Math.max(
            recoveryMaximumUpperSourceError,
            upperSourceError.maximum,
          );
          recoveryMaximumSourceMissing = Math.max(
            recoveryMaximumSourceMissing,
            lowerSourceError.missing,
            upperSourceError.missing,
          );
        }
        if (previousRecovery) {
          const lowerAngularStep = maximumBoneStep(previousRecovery.lower);
          const upperAngularStep = maximumJointStep(previousRecovery.upper);
          const hipsPositionStep = rig.joints.get('hips').position.distanceTo(
            previousRecovery.hipsPosition,
          );
          if (previousRecovery.splitBody || splitBody) {
            recoveryMaximumUpperAngularStep = Math.max(
              recoveryMaximumUpperAngularStep,
              upperAngularStep,
            );
          }
          if (hipsPositionStep > recoveryMaximumHipsPositionStep) {
            recoveryMaximumHipsPositionStep = hipsPositionStep;
          }
          recoveryLowerProgressMonotonic &&= (
            lowerProgress + 0.000001 >= previousRecovery.lowerProgress
          );
          recoveryUpperProgressMonotonic &&= (
            upperProgress + 0.000001 >= previousRecovery.upperProgress
          );
          landingHipsBlendMonotonic &&= (
            hipsBlendWeight <= previousRecovery.hipsBlendWeight + 0.000001
          );
          if (previousRecovery.splitBody && !splitBody && !merge) {
            merge = {
              lowerAngularStep,
              upperAngularStep,
              hipsPositionStep,
              lowerProgress,
              upperProgress,
              actionProgress: h.actionProgress(),
              upperOverrideActive: rig.root.userData.jumpSlashUpperBodyOverrideActive,
              hipsBlendActive: rig.root.userData.jumpSlashLandingHipsBlendActive,
              hipsBlendWeight,
              sourcePoseError: h.runtimeSourcePoseError(
                lowerProgress,
                [...lowerBodyJoints, ...upperBodyJoints],
              ),
            };
          }
        }
        previousRecovery = {
          lower: snapshotBones(lowerBranchBones),
          upper: snapshotJoints(upperBodyJoints),
          hipsPosition: rig.joints.get('hips').position.clone(),
          lowerProgress,
          upperProgress,
          splitBody,
          hipsBlendWeight,
        };
      }
      if (touchdown && !player.isSwordJumpSlashVisualActive()) {
        break;
      }
    }

    const accepted = probe.appends.filter((sample) => sample.accepted);
    const airborneSamples = accepted.filter((sample) => sample.airborne);
    const groundedSamples = accepted.filter((sample) => !sample.airborne);
    for (let frame = 0; frame < 60; frame += 1) h.game._updateTimedEffects(1 / 60);
    return {
      intendedAirTime: fall.intendedAirTime,
      started,
      lastAirborne,
      touchdown,
      begins: probe.begins,
      finishes: probe.finishes,
      cancels: probe.cancels,
      acceptedIds: [...new Set(accepted.map((sample) => sample.id))],
      airborneIds: [...new Set(airborneSamples.map((sample) => sample.id))],
      groundedIds: [...new Set(groundedSamples.map((sample) => sample.id))],
      acceptedPhases: [...new Set(accepted.map((sample) => sample.phase))],
      trailModes: [...new Set(accepted.map((sample) => sample.trailMode))],
      lowerBranchBoneCount: lowerBranchBones.length,
      cachedLowerBodyBoneCount: rig.root.userData.jumpSlashLowerBodyBoneCount ?? 0,
      recoveryMaximumUpperAngularStep,
      recoveryMaximumHipsPositionStep,
      recoveryMaximumLowerSourceError,
      recoveryMaximumUpperSourceError,
      recoveryMaximumSourceMissing,
      recoveryLowerProgressMonotonic,
      recoveryUpperProgressMonotonic,
      landingHipsBlendMonotonic,
      recoverySawSplitBody,
      merge,
      lastRecovery: previousRecovery ? {
        lowerProgress: previousRecovery.lowerProgress,
        upperProgress: previousRecovery.upperProgress,
        splitBody: previousRecovery.splitBody,
        hipsBlendWeight: previousRecovery.hipsBlendWeight,
      } : null,
      groundedTrailCount: groundedSamples.length,
      groundedTrailMinimumProgress: groundedSamples.length
        ? Math.min(...groundedSamples.map((sample) => sample.progress))
        : null,
      groundedTrailMaximumProgress: groundedSamples.length
        ? Math.max(...groundedSamples.map((sample) => sample.progress))
        : null,
      finalVisualActive: player.isSwordJumpSlashVisualActive(),
      finalHipsBlendActive: rig.root.userData.jumpSlashLandingHipsBlendActive,
      finalHipsBlendWeight: rig.root.userData.jumpSlashLandingHipsBlendWeight,
      finalActiveTrail: Boolean(combat.activeSwordSweepTrail),
      remainingJumpSlashMeshes: h.countJumpSlashMeshes(),
      matchProgress,
      landingStartProgress,
      upperEndProgress,
    };
  }, {
    matchProgress: JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS,
    landingStartProgress: JUMP_SLASH_SEAM_PROGRESS,
    upperEndProgress: JUMP_SLASH_UPPER_BODY_END_PROGRESS,
    lowerBodyJoints: JUMP_SLASH_LOWER_BODY_JOINTS,
    upperBodyJoints: JUMP_SLASH_UPPER_BODY_JOINTS,
  });

  expect(result.started).toBe(true);
  expect(result.lastAirborne).not.toBeNull();
  expect(result.touchdown.elapsed).toBeGreaterThanOrEqual(result.intendedAirTime - 0.000001);
  expect(result.touchdown.phase).toBe('groundedRecovery');
  expect(result.touchdown.visualProgress).toBeCloseTo(result.matchProgress, 8);
  expect(result.touchdown.upperBodyProgress).toBeGreaterThan(result.matchProgress);
  expect(result.touchdown.upperBodyProgress).toBeLessThan(result.upperEndProgress);
  expect(result.touchdown.actionProgress).toBeCloseTo(result.matchProgress, 4);
  expect(result.touchdown.lowerAngularStep).toBeLessThan(0.1);
  expect(result.touchdown.upperAngularStep).toBeLessThan(5);
  expect(result.touchdown.hipsPositionStep).toBeLessThan(0.000001);
  expect(result.touchdown.upperProgressStep).toBeGreaterThanOrEqual(-0.000001);
  expect(result.touchdown.upperOverrideActive).toBe(true);
  expect(result.touchdown.landingHipsBlendWeight).toBeCloseTo(1, 6);
  expect(result.lowerBranchBoneCount).toBe(9);
  expect(result.cachedLowerBodyBoneCount).toBe(9);
  expect(result.lowerBranchBoneCount).toBe(result.cachedLowerBodyBoneCount);
  expect(result.recoverySawSplitBody).toBe(true);
  expect(result.recoveryLowerProgressMonotonic).toBe(true);
  expect(result.recoveryUpperProgressMonotonic).toBe(true);
  expect(result.landingHipsBlendMonotonic).toBe(true);
  expect(result.recoveryMaximumUpperAngularStep).toBeLessThan(5);
  expect(result.recoveryMaximumHipsPositionStep).toBeLessThan(0.01);
  expect(result.recoveryMaximumLowerSourceError).toBeLessThan(0.1);
  expect(result.recoveryMaximumUpperSourceError).toBeLessThan(0.1);
  expect(result.recoveryMaximumSourceMissing).toBe(0);
  expect(result.merge).not.toBeNull();
  expect(result.merge.lowerAngularStep).toBeLessThan(5);
  expect(result.merge.upperAngularStep).toBeLessThan(5);
  expect(result.merge.hipsPositionStep).toBeLessThan(0.01);
  expect(result.merge.lowerProgress).toBeGreaterThanOrEqual(result.upperEndProgress - 0.000001);
  expect(result.merge.lowerProgress).toBeCloseTo(result.merge.upperProgress, 6);
  expect(result.merge.actionProgress).toBeCloseTo(result.merge.lowerProgress, 4);
  expect(result.merge.upperOverrideActive).toBe(false);
  expect(result.merge.hipsBlendActive).toBe(true);
  expect(result.merge.hipsBlendWeight).toBeGreaterThan(0);
  expect(result.merge.hipsBlendWeight).toBeLessThan(1);
  expect(result.merge.sourcePoseError).toEqual(expect.objectContaining({ missing: 0 }));
  expect(result.merge.sourcePoseError.maximum).toBeLessThan(0.1);
  expect(result.lastRecovery.lowerProgress).toBeGreaterThan(0.98);
  expect(result.lastRecovery.upperProgress).toBeCloseTo(result.lastRecovery.lowerProgress, 8);
  expect(result.lastRecovery.splitBody).toBe(false);
  expect(result.lastRecovery.hipsBlendWeight).toBeLessThan(0.001);
  expect(result.begins).toHaveLength(1);
  expect(result.finishes).toHaveLength(1);
  expect(result.acceptedIds).toEqual([result.begins[0].id]);
  expect(result.airborneIds).toEqual([result.begins[0].id]);
  expect(result.groundedIds).toEqual([result.begins[0].id]);
  expect(result.finishes[0].id).toBe(result.begins[0].id);
  expect(result.acceptedPhases).toEqual(expect.arrayContaining([
    'airborneWindup',
    'airborneHold',
    'groundedRecovery',
  ]));
  expect(result.trailModes).toEqual(['continuousJumpSlash']);
  expect(result.cancels).toHaveLength(0);
  expect(result.groundedTrailCount).toBeGreaterThan(5);
  expect(result.groundedTrailMinimumProgress).toBeLessThan(result.landingStartProgress);
  expect(result.groundedTrailMinimumProgress).toBeCloseTo(
    result.touchdown.upperBodyProgress,
    6,
  );
  expect(result.groundedTrailMaximumProgress).toBeCloseTo(result.upperEndProgress, 6);
  expect(result.finalVisualActive).toBe(false);
  expect(result.finalHipsBlendActive).toBe(false);
  expect(result.finalHipsBlendWeight).toBe(0);
  expect(result.finalActiveTrail).toBe(false);
  expect(result.remainingJumpSlashMeshes).toBe(0);
});

test('a coarse frame keeps the same continuous ribbon until its next blade sample', async ({ page }) => {
  await openLoadedGame(page);
  await installJumpSlashHarness(page);

  const result = await page.evaluate(() => {
    const h = window.__createJumpSlashHarness({ dt: 1 / 240 });
    const { player, combat } = h;
    h.beginFalling(1.2);
    const probe = h.installProbe();
    const started = combat.tryPrimaryAttack(window.game.pointer.aimWorld);

    // Cross the visual-start and hit thresholds in one update. The first
    // sample cannot draw a ribbon yet, but it must not be replaced by another
    // green effect or handle before the next blade observation arrives.
    h.tick(0.43);
    const afterCoarseFrame = {
      active: Boolean(combat.activeSwordSweepTrail),
      handleId: probe.begins[0]?.id ?? null,
      sampleCount: combat.activeSwordSweepTrail?.handle?.samples?.length ?? 0,
      visible: Boolean(combat.activeSwordSweepTrail?.handle?.glow?.visible),
    };
    h.tick(1 / 30);

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
      activeHandleSampleCount: combat.activeSwordSweepTrail?.handle?.samples?.length ?? 0,
      activeGlowVisible: Boolean(combat.activeSwordSweepTrail?.handle?.glow?.visible),
      afterCoarseFrame,
    };
  });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.started).toBe(true);
  expect(result.stillAirborne).toBe(true);
  expect(result.visualProgress).toBeCloseTo(JUMP_SLASH_FALLING_POSE_MATCH_PROGRESS, 4);
  expect(result.strikes).toHaveLength(1);
  expect(result.strikes[0].activeTrailSampleCount).toBe(1);
  expect(result.begins).toHaveLength(1);
  expect(result.afterCoarseFrame).toEqual(expect.objectContaining({
    active: true,
    sampleCount: 1,
    visible: false,
  }));
  expect(result.acceptedAppends.length).toBeGreaterThanOrEqual(2);
  expect(new Set(result.acceptedAppends.map((sample) => sample.id))).toEqual(
    new Set([result.afterCoarseFrame.handleId]),
  );
  for (const sample of result.acceptedAppends) {
    expect(sample).toEqual(expect.objectContaining({
      followRoot: false,
      glowParentScene: true,
      coreParentScene: true,
      trailSpace: 'world',
      trailMode: 'continuousJumpSlash',
    }));
  }
  expect(result.finishes).toHaveLength(0);
  expect(result.cancels).toHaveLength(0);
  expect(result.activeTrailAfterHit).toBe(true);
  expect(result.activeHandleSampleCount).toBeGreaterThanOrEqual(2);
  expect(result.activeGlowVisible).toBe(true);
  expect(result.staticFallbacks).toHaveLength(0);
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

test('synchronous jump-slash cancellation does not reveal the hidden landing legs', async ({ page }) => {
  await openLoadedGame(page);
  await installJumpSlashHarness(page);

  const result = await page.evaluate(({ upperEndProgress }) => {
    const h = window.__createJumpSlashHarness({ dt: 1 / 240 });
    const { game, player, combat, rig } = h;
    h.beginFalling(1.1);
    const started = combat.tryPrimaryAttack(game.pointer.aimWorld);

    for (let frame = 0; frame < 240; frame += 1) {
      h.tick();
      if (player._jumpSlashVisualState?.phase === 'airborneHold'
        && player.getSwordJumpSlashUpperBodyProgress() >= upperEndProgress - 0.000001) {
        break;
      }
    }

    // These source transforms are the later clip frame hidden beneath the
    // frozen lower-body mask. A synchronous cancel must not expose them before
    // the replacement animation gets its first mixer evaluation.
    const restoreMap = rig.jumpSlashAerialPoseRestoreTransforms;
    const heldLowerBody = [...(restoreMap?.keys() ?? [])].map((bone) => ({
      bone,
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone().normalize(),
    }));
    const hiddenMaximumPositionStep = Math.max(
      0,
      ...heldLowerBody.map(({ bone, position }) => (
        restoreMap.get(bone).position.distanceTo(position)
      )),
    );
    const hiddenMaximumAngularStep = Math.max(
      0,
      ...heldLowerBody.map(({ bone, quaternion }) => (
        restoreMap.get(bone).quaternion.clone().normalize().angleTo(quaternion)
          * 180 / Math.PI
      )),
    );
    const beforeCancel = {
      phase: player._jumpSlashVisualState?.phase ?? null,
      upperProgress: player.getSwordJumpSlashUpperBodyProgress(),
      lowerPoseActive: rig.root.userData.jumpSlashLowerBodyPoseActive,
      restoreBoneCount: heldLowerBody.length,
      bladeHoldActive: rig.root.userData.jumpSlashBeamBladeHoldTransformActive,
      heldBladeTransformCached: Boolean(rig.jumpSlashHeldBeamBladeTransform),
    };

    const cancelled = player.cancelSwordJumpSlashVisual({ cancelAttack: true });
    const maximumPositionStep = Math.max(
      0,
      ...heldLowerBody.map(({ bone, position }) => bone.position.distanceTo(position)),
    );
    const maximumAngularStep = Math.max(
      0,
      ...heldLowerBody.map(({ bone, quaternion }) => (
        bone.quaternion.clone().normalize().angleTo(quaternion) * 180 / Math.PI
      )),
    );

    return {
      started,
      cancelled,
      beforeCancel,
      hiddenMaximumPositionStep,
      hiddenMaximumAngularStep,
      maximumPositionStep,
      maximumAngularStep,
      visualActive: player.isSwordJumpSlashVisualActive(),
      aerialPoseMarker: rig.root.userData.jumpSlashAerialPoseActive,
      lowerPoseMarker: rig.root.userData.jumpSlashLowerBodyPoseActive,
      rootAnchorMarker: rig.root.userData.jumpSlashAirborneRootAnchorActive,
      bladeHoldMarker: rig.root.userData.jumpSlashBeamBladeHoldTransformActive,
      heldBladeTransformCleared: rig.jumpSlashHeldBeamBladeTransform === null,
      restoreMapCleared: rig.jumpSlashAerialPoseRestoreTransforms === null,
    };
  }, {
    upperEndProgress: JUMP_SLASH_UPPER_BODY_END_PROGRESS,
  });

  expect(result.started).toBe(true);
  expect(result.beforeCancel).toEqual(expect.objectContaining({
    phase: 'airborneHold',
    upperProgress: JUMP_SLASH_UPPER_BODY_END_PROGRESS,
    lowerPoseActive: true,
    bladeHoldActive: true,
    heldBladeTransformCached: true,
  }));
  expect(result.beforeCancel.restoreBoneCount).toBeGreaterThanOrEqual(9);
  expect(Math.max(
    result.hiddenMaximumPositionStep,
    result.hiddenMaximumAngularStep,
  )).toBeGreaterThan(0.001);
  expect(result.cancelled).toBe(true);
  expect(result.visualActive).toBe(false);
  expect(result.aerialPoseMarker).toBe(false);
  expect(result.lowerPoseMarker).toBe(false);
  expect(result.rootAnchorMarker).toBe(false);
  expect(result.bladeHoldMarker).toBe(false);
  expect(result.heldBladeTransformCleared).toBe(true);
  expect(result.restoreMapCleared).toBe(true);
  expect(result.maximumPositionStep).toBeLessThan(0.000001);
  expect(result.maximumAngularStep).toBeLessThan(0.0001);
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

    const countContinuousJumpSlashMeshes = () => {
      let count = 0;
      game.scene.traverse((object) => {
        if (object.userData?.slashClipKey === jumpSlash
          && object.userData?.trailMode === 'continuousJumpSlash') count += 1;
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
      liveMeshCount: countContinuousJumpSlashMeshes(),
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
      liveMeshCount: countContinuousJumpSlashMeshes(),
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
