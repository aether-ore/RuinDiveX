import { expect, test } from '@playwright/test';

const OPENING_SLASH = 'swordForwardSlash';
const FOLLOW_UP_SLASH = 'swordInwardSlash';
const FOLLOW_UP_TERMINAL_POSE_DEGREES = Object.freeze({
  hips: Object.freeze({ pitch: 25.9, yaw: -69, roll: 14.9 }),
  spine: Object.freeze({ pitch: 5.7, yaw: -5.7, roll: 0.6 }),
  neck: Object.freeze({ pitch: 7.8, yaw: 9.7, roll: -2.8 }),
  leftShoulder: Object.freeze({ pitch: 16.1, yaw: 6.1, roll: -13.9 }),
  leftElbow: Object.freeze({ pitch: 4.8, yaw: 1.3, roll: 60.4 }),
  leftWrist: Object.freeze({ pitch: -43.8, yaw: 11.5, roll: -7.1 }),
  rightShoulder: Object.freeze({ pitch: 34.1, yaw: -9.7, roll: 26.5 }),
  rightElbow: Object.freeze({ pitch: 4.4, yaw: -0.9, roll: -51.7 }),
  rightWrist: Object.freeze({ pitch: -10.8, yaw: 17.1, roll: 76 }),
  leftHip: Object.freeze({ pitch: 51.9, yaw: -1.9, roll: 21 }),
  leftKnee: Object.freeze({ pitch: -68.2, yaw: -9.2, roll: -2.7 }),
  leftAnkle: Object.freeze({ pitch: 13.9, yaw: -16.2, roll: 15.6 }),
  rightHip: Object.freeze({ pitch: 46.2, yaw: 13.7, roll: -4.9 }),
  rightKnee: Object.freeze({ pitch: -52.1, yaw: -9.2, roll: -9.8 }),
  rightAnkle: Object.freeze({ pitch: 11.5, yaw: -3.6, roll: 9 }),
});

test('sword attack buffers the legacy inward slash after the new forward opener', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => (
    window.game?.player?._fbxAnimationLibraryLoaded === true
    && window.game?.player?._busterArmLoaded === true
  ));

  const result = await page.evaluate(({ openingSlash, followUpSlash }) => {
    const { game } = window;
    game.stop();
    game.isPlayerInSafeArea = () => false;

    const player = game.player;
    const combat = game.combat;
    const rig = player.externalRig;
    const Vector3 = player.root.position.constructor;
    const swordIndex = player.armHotbar.findIndex((item) => item?.type === 'swordArm');
    player.switchArmWeapon(swordIndex, true);

    const state = combat.getCurrentWeaponState();
    state.cooldown = 0;
    state.reloadTimer = 0;
    state.energy = 2;
    state.weaponOutput = state.maxWeaponOutput;
    state.outputRecoveryDelay = 0;
    combat.swapTimer = 0;
    combat.primaryWasDown = false;
    combat.pendingMeleeStrikes.length = 0;
    player.animation.attackTimer = 0;
    player.animation.actionState = null;

    const pointer = game.pointer;
    pointer.primary = false;
    pointer.primaryPressed = false;
    pointer.secondary = false;
    pointer.alternate = false;
    pointer.aimWorld.copy(player.root.position).add(new Vector3(0, 0, 10));

    const clipTimeline = [];
    const resourceSnapshots = [];
    const openingHitSamples = [];
    const plantedLeadFootSamples = [];
    const playerRootStart = player.root.position.clone();
    let maximumPlayerRootTravel = 0;
    let queuedStrikeCount = 0;
    const queuedStrikeDelays = [];
    const originalQueueMeleeStrike = combat._queueMeleeStrike.bind(combat);
    combat._queueMeleeStrike = (...args) => {
      queuedStrikeCount += 1;
      queuedStrikeDelays.push(args[2]);
      return originalQueueMeleeStrike(...args);
    };
    const originalMeleeAttack = combat._meleeAttackDirection.bind(combat);
    combat._meleeAttackDirection = (...args) => {
      if (rig.activeClipKey === openingSlash) {
        const progress = 1 - (player.animation.attackTimer / player.animation.attackDuration);
        openingHitSamples.push({
          progress,
          bladeVisible: rig.beamBladeGroup?.visible ?? false,
          bladeScaleZ: rig.beamBladeGroup?.scale.z ?? 0,
        });
      }
      return originalMeleeAttack(...args);
    };

    const movementOptions = {
      arenaRadius: game.arenaRadius,
      movementForward: new Vector3(0, 0, 1),
      movementRight: new Vector3(1, 0, 0),
      groundY: player.root.position.y,
      game,
    };
    const tick = () => {
      player.update(1 / 60, new Set(), movementOptions);
      combat.update(1 / 60);
      const clip = rig.activeClipKey;
      const progress = player.animation.attackDuration > 0
        ? 1 - (player.animation.attackTimer / player.animation.attackDuration)
        : 0;
      if (clip === openingSlash && progress >= 0.37 && progress <= 0.72) {
        plantedLeadFootSamples.push(rig.joints.get('leftAnkle').getWorldPosition(new Vector3()));
      }
      maximumPlayerRootTravel = Math.max(
        maximumPlayerRootTravel,
        player.root.position.distanceTo(playerRootStart),
      );
      if (clip && clipTimeline.at(-1) !== clip) {
        clipTimeline.push(clip);
        if (clip === openingSlash || clip === followUpSlash) {
          resourceSnapshots.push({
            clip,
            energy: state.energy,
            output: state.weaponOutput,
          });
        }
      }
    };
    const pressPrimary = () => {
      pointer.primary = true;
      pointer.primaryPressed = true;
      tick();
      pointer.primary = false;
      tick();
    };

    pressPrimary();
    for (let frame = 0; frame < 20; frame += 1) {
      tick();
    }
    const activeProfile = combat._getStatefulProfile(combat._getCurrentProfile(), state);
    const heldInputAcceptedAsFollowUp = combat._shouldTryPrimaryAttack(
      { primary: true },
      false,
      state,
      activeProfile,
    );

    // This second, discrete press lands while the opening attack is still in
    // progress, so it must be buffered instead of discarded by its cooldown.
    pressPrimary();
    for (let frame = 0; frame < 80; frame += 1) {
      tick();
    }

    const openingClip = rig.animationClips.get(openingSlash);
    const openingHipsTrack = openingClip?.tracks.find((track) => (
      track.name.toLowerCase().includes('hips.position')
    ));
    const openingRootZ = [];
    for (let index = 2; index < (openingHipsTrack?.values.length ?? 0); index += 3) {
      openingRootZ.push(openingHipsTrack.values[index]);
    }
    const plantedLeadFootStart = plantedLeadFootSamples[0] ?? new Vector3();
    const maximumPlantedLeadFootDrift = plantedLeadFootSamples.reduce((maximum, sample) => {
      const dx = sample.x - plantedLeadFootStart.x;
      const dz = sample.z - plantedLeadFootStart.z;
      return Math.max(maximum, Math.hypot(dx, dz));
    }, 0);

    return {
      swordIndex,
      hasOpeningClip: rig.animationMetadata.has(openingSlash),
      hasFollowUpClip: rig.animationMetadata.has(followUpSlash),
      openingPreservesRootMotion: rig.animationMetadata.get(openingSlash)?.preserveRootMotion,
      openingRootTravel: openingRootZ.length > 0
        ? Math.max(...openingRootZ) - Math.min(...openingRootZ)
        : 0,
      clipTimeline,
      resourceSnapshots,
      queuedStrikeCount,
      queuedStrikeDelays,
      heldInputAcceptedAsFollowUp,
      openingHitSamples,
      plantedLeadFootSampleCount: plantedLeadFootSamples.length,
      maximumPlantedLeadFootDrift,
      maximumPlayerRootTravel,
    };
  }, { openingSlash: OPENING_SLASH, followUpSlash: FOLLOW_UP_SLASH });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.hasOpeningClip).toBe(true);
  expect(result.hasFollowUpClip).toBe(true);
  expect(result.openingPreservesRootMotion).toBe(true);
  expect(result.openingRootTravel).toBeGreaterThan(0.4);
  expect(result.heldInputAcceptedAsFollowUp).toBe(false);
  expect(result.openingHitSamples).toHaveLength(1);
  expect(result.openingHitSamples[0].progress).toBeGreaterThanOrEqual(0.38);
  expect(result.openingHitSamples[0].progress).toBeLessThanOrEqual(0.43);
  expect(result.openingHitSamples[0].bladeVisible).toBe(true);
  expect(result.openingHitSamples[0].bladeScaleZ).toBeGreaterThan(1);
  expect(result.plantedLeadFootSampleCount).toBeGreaterThan(5);
  expect(result.maximumPlantedLeadFootDrift).toBeLessThan(0.025);
  expect(result.maximumPlayerRootTravel).toBeLessThan(0.001);

  const openingIndex = result.clipTimeline.indexOf(OPENING_SLASH);
  const followUpIndex = result.clipTimeline.indexOf(FOLLOW_UP_SLASH);
  expect(openingIndex).toBeGreaterThanOrEqual(0);
  expect(followUpIndex).toBeGreaterThan(openingIndex);
  expect(result.queuedStrikeCount).toBe(2);
  expect(result.queuedStrikeDelays[0]).toBeLessThan(result.queuedStrikeDelays[1]);
  expect(result.resourceSnapshots).toEqual([
    expect.objectContaining({ clip: OPENING_SLASH, energy: 1 }),
    expect.objectContaining({ clip: FOLLOW_UP_SLASH, energy: 0 }),
  ]);
});

test('each sword combo stage leaves a trail matching its authored sweep plane', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => (
    window.game?.player?._fbxAnimationLibraryLoaded === true
    && window.game?.player?._busterArmLoaded === true
  ));

  const result = await page.evaluate(({ openingSlash, followUpSlash }) => {
    const { game } = window;
    game.stop();
    game.isPlayerInSafeArea = () => false;

    const { player, combat } = game;
    const Vector3 = player.root.position.constructor;
    const swordIndex = player.armHotbar.findIndex((item) => item?.type === 'swordArm');
    player.switchArmWeapon(swordIndex, true);

    const state = combat.getCurrentWeaponState();
    const profile = combat._getStatefulProfile(combat._getCurrentProfile(), state);
    state.cooldown = 0;
    state.reloadTimer = 0;
    state.energy = Math.max(state.maxEnergy, profile.energyCost * 2);
    state.weaponOutput = state.maxWeaponOutput;
    state.outputRecoveryDelay = 0;
    combat.swapTimer = 0;
    combat.primaryWasDown = false;
    combat.pendingMeleeStrikes.length = 0;
    player.animation.attackTimer = 0;
    player.animation.actionState = null;
    player.root.rotation.y = 0;

    const pointer = game.pointer;
    pointer.primary = false;
    pointer.primaryPressed = false;
    pointer.secondary = false;
    pointer.alternate = false;
    const aimWorld = player.root.position.clone().add(new Vector3(0, 0, 10));
    pointer.aimWorld.copy(aimWorld);

    const capturedTrails = new Map();
    const captureTrails = () => {
      game.scene.traverse((object) => {
        if (object.name !== 'laserBeamBladeSlashGlow') {
          return;
        }
        const clipKey = object.userData?.slashClipKey;
        if (clipKey === openingSlash || clipKey === followUpSlash) {
          capturedTrails.set(clipKey, object);
        }
      });
    };
    const movementOptions = {
      arenaRadius: game.arenaRadius,
      movementForward: new Vector3(0, 0, 1),
      movementRight: new Vector3(1, 0, 0),
      groundY: player.root.position.y,
      game,
    };
    const tick = () => {
      player.update(1 / 60, new Set(), movementOptions);
      combat.update(1 / 60);
      game._updateTimedEffects(1 / 60);
      captureTrails();
    };

    const openerStarted = combat.tryPrimaryAttack(aimWorld);
    captureTrails();
    let openerFrames = 0;
    while (state.cooldown > 0 && openerFrames < 90) {
      tick();
      openerFrames += 1;
    }

    const followUpStarted = combat.tryPrimaryAttack(aimWorld);
    captureTrails();
    for (let frame = 0; frame < 70; frame += 1) {
      tick();
    }

    const summarize = (clipKey) => {
      const trail = capturedTrails.get(clipKey);
      const readVector = (value) => Array.isArray(value)
        ? [...value]
        : value?.toArray?.() ?? null;
      return {
        found: Boolean(trail),
        name: trail?.name ?? null,
        slashClipKey: trail?.userData?.slashClipKey ?? null,
        trailMode: trail?.userData?.trailMode ?? null,
        motion: readVector(trail?.userData?.trailMotionWorld),
        planeNormal: readVector(trail?.userData?.trailPlaneNormalWorld),
      };
    };

    return {
      swordIndex,
      openerStarted,
      followUpStarted,
      openerFrames,
      openingTrail: summarize(openingSlash),
      followUpTrail: summarize(followUpSlash),
    };
  }, { openingSlash: OPENING_SLASH, followUpSlash: FOLLOW_UP_SLASH });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.openerStarted).toBe(true);
  expect(result.followUpStarted).toBe(true);
  expect(result.openerFrames).toBeGreaterThan(0);
  expect(result.openingTrail).toEqual(expect.objectContaining({
    found: true,
    name: 'laserBeamBladeSlashGlow',
    slashClipKey: OPENING_SLASH,
    trailMode: 'authoredSlashPlane',
  }));
  expect(result.followUpTrail).toEqual(expect.objectContaining({
    found: true,
    name: 'laserBeamBladeSlashGlow',
    slashClipKey: FOLLOW_UP_SLASH,
    trailMode: 'authoredSlashPlane',
  }));
  expect(result.openingTrail.motion).toHaveLength(3);
  expect(result.followUpTrail.motion).toHaveLength(3);
  expect(result.openingTrail.planeNormal).toHaveLength(3);
  expect(result.followUpTrail.planeNormal).toHaveLength(3);

  // Facing +Z, the opener travels from character-right/high to the opposite
  // hip, then the legacy follow-up reverses laterally across a nearly level plane.
  expect(result.openingTrail.motion[0]).toBeGreaterThan(0.5);
  expect(result.openingTrail.motion[1]).toBeLessThan(-0.4);
  expect(result.followUpTrail.motion[0]).toBeLessThan(-0.5);
  expect(Math.abs(result.followUpTrail.motion[1])).toBeLessThan(0.12);
  expect(result.openingTrail.planeNormal[1]).toBeGreaterThan(0.65);
  expect(result.openingTrail.planeNormal[1]).toBeLessThan(0.9);
  expect(result.followUpTrail.planeNormal[1]).toBeGreaterThan(0.95);
});

test('sword follow-up completes in its authored outward guard without crossing the player body', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => (
    window.game?.player?._fbxAnimationLibraryLoaded === true
    && window.game?.player?._busterArmLoaded === true
  ));

  const result = await page.evaluate(({ openingSlash, followUpSlash, terminalPoseDegrees }) => {
    const { game } = window;
    game.stop();
    game.isPlayerInSafeArea = () => false;

    const { player, combat } = game;
    const rig = player.externalRig;
    const Vector3 = player.root.position.constructor;
    const Quaternion = player.root.quaternion.constructor;
    const Euler = player.root.rotation.constructor;
    const swordIndex = player.armHotbar.findIndex((item) => item?.type === 'swordArm');
    player.switchArmWeapon(swordIndex, true);

    const state = combat.getCurrentWeaponState();
    const profile = combat._getStatefulProfile(combat._getCurrentProfile(), state);
    const authoredHitGeometry = {
      range: profile.range,
      arcScale: profile.arcScale,
      animationDuration: profile.animationDuration,
      activeStart: profile.activeStart,
      slashEnd: profile.slashEnd,
    };
    state.cooldown = 0;
    state.reloadTimer = 0;
    state.energy = Math.max(state.maxEnergy, profile.energyCost * 2);
    state.weaponOutput = state.maxWeaponOutput;
    state.outputRecoveryDelay = 0;
    combat.swapTimer = 0;
    combat.primaryWasDown = false;
    combat.pendingMeleeStrikes.length = 0;
    player.animation.attackTimer = 0;
    player.animation.actionState = null;
    player.root.rotation.y = 0;

    const aimWorld = player.root.position.clone().add(new Vector3(0, 0, 10));
    game.pointer.primary = false;
    game.pointer.primaryPressed = false;
    game.pointer.secondary = false;
    game.pointer.alternate = false;
    game.pointer.aimWorld.copy(aimWorld);

    const movementOptions = {
      arenaRadius: game.arenaRadius,
      movementForward: new Vector3(0, 0, 1),
      movementRight: new Vector3(1, 0, 0),
      groundY: player.root.position.y,
      game,
    };
    const tick = () => {
      player.update(1 / 120, new Set(), movementOptions);
      combat.update(1 / 120);
    };
    const getAttackProgress = () => (
      player.animation.attackDuration > 0
        ? 1 - (player.animation.attackTimer / player.animation.attackDuration)
        : 0
    );
    const distanceFromBodyAxis = (base, tip, bodyRoot) => {
      const baseX = base.x - bodyRoot.x;
      const baseZ = base.z - bodyRoot.z;
      const deltaX = tip.x - base.x;
      const deltaZ = tip.z - base.z;
      const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
      const closestT = lengthSquared > 0.000001
        ? Math.max(0, Math.min(1, -(baseX * deltaX + baseZ * deltaZ) / lengthSquared))
        : 0;
      return Math.hypot(baseX + deltaX * closestT, baseZ + deltaZ * closestT);
    };

    const followUpHitProgress = [];
    const originalMeleeAttack = combat._meleeAttackDirection.bind(combat);
    combat._meleeAttackDirection = (...args) => {
      if (rig.activeClipKey === followUpSlash) {
        followUpHitProgress.push(getAttackProgress());
      }
      return originalMeleeAttack(...args);
    };

    const openerStarted = combat.tryPrimaryAttack(aimWorld);
    let openerFrames = 0;
    while (state.cooldown > 0 && openerFrames < 180) {
      tick();
      openerFrames += 1;
    }
    const followUpStarted = combat.tryPrimaryAttack(aimWorld);

    const completionSamples = [];
    let completionPose = null;
    let completionDistance = Number.POSITIVE_INFINITY;
    for (let frame = 0; frame < 160; frame += 1) {
      tick();
      if (rig.activeClipKey !== followUpSlash || !rig.beamBladeGroup?.visible) continue;

      const progress = getAttackProgress();
      if (progress < 0.82 || progress > 0.98) continue;
      const bladeBase = new Vector3();
      const bladeTip = new Vector3();
      if (!combat._readSwordSweepTrailObservation({}, bladeBase, bladeTip)) continue;

      const root = player.root.getWorldPosition(new Vector3());
      const shoulder = rig.joints.get('rightShoulder').getWorldPosition(new Vector3());
      const elbow = rig.joints.get('rightElbow').getWorldPosition(new Vector3());
      const wrist = rig.joints.get('rightWrist').getWorldPosition(new Vector3());
      const facing = new Vector3(Math.sin(player.root.rotation.y), 0, Math.cos(player.root.rotation.y));
      // The model's right side is -X when it faces +Z.
      const characterRight = new Vector3(-facing.z, 0, facing.x).normalize();
      const bladeVector = bladeTip.clone().sub(bladeBase);
      const horizontalBlade = bladeVector.clone().setY(0);
      const bodyClearance = distanceFromBodyAxis(bladeBase, bladeTip, root);
      completionSamples.push({ progress, bodyClearance });

      const distanceToAuthoredCompletion = Math.abs(progress - 0.90);
      if (distanceToAuthoredCompletion < completionDistance) {
        completionDistance = distanceToAuthoredCompletion;
        const armPathLength = shoulder.distanceTo(elbow) + elbow.distanceTo(wrist);
        completionPose = {
          progress,
          terminalPoseWeight: rig.root.userData.swordInwardTerminalPoseWeight ?? 0,
          bladeVisible: rig.beamBladeGroup.visible,
          armExtensionRatio: shoulder.distanceTo(wrist) / Math.max(0.0001, armPathLength),
          outwardWristReach: wrist.clone().sub(root).dot(characterRight),
          outwardBladeDirection: horizontalBlade.lengthSq() > 0.000001
            ? horizontalBlade.normalize().dot(characterRight)
            : 0,
          outwardBladeTipReach: bladeTip.clone().sub(root).dot(characterRight),
          verticalBladeFraction: Math.abs(bladeVector.y) / Math.max(0.0001, bladeVector.length()),
          bodyClearance,
          localPoseDegrees: Object.fromEntries(
            Object.keys(terminalPoseDegrees).map((jointName) => {
              const joint = rig.joints.get(jointName);
              const rest = rig.restLocalQuaternions.get(joint);
              const delta = rest && joint
                ? rest.clone().invert().multiply(joint.quaternion).normalize()
                : new Quaternion();
              const euler = new Euler().setFromQuaternion(delta, 'XYZ');
              return [jointName, {
                pitch: euler.x * 180 / Math.PI,
                yaw: euler.y * 180 / Math.PI,
                roll: euler.z * 180 / Math.PI,
              }];
            }),
          ),
        };
      }
    }

    const finalProfile = combat._getStatefulProfile(combat._getCurrentProfile(), state);
    const hitGeometryStable = Object.entries(authoredHitGeometry).every(([key, value]) => (
      finalProfile[key] === value
    ));
    return {
      swordIndex,
      openerStarted,
      followUpStarted,
      openerFrames,
      openingClipPlayed: rig.animationMetadata.has(openingSlash),
      followUpClipPlayed: rig.animationMetadata.has(followUpSlash),
      followUpHitProgress,
      completionSampleCount: completionSamples.length,
      minimumCompletionClearance: completionSamples.reduce(
        (minimum, sample) => Math.min(minimum, sample.bodyClearance),
        Number.POSITIVE_INFINITY,
      ),
      requiredBodyClearance: player.radius + 0.08,
      completionPose,
      hitGeometryStable,
    };
  }, {
    openingSlash: OPENING_SLASH,
    followUpSlash: FOLLOW_UP_SLASH,
    terminalPoseDegrees: FOLLOW_UP_TERMINAL_POSE_DEGREES,
  });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.openerStarted).toBe(true);
  expect(result.followUpStarted).toBe(true);
  expect(result.openerFrames).toBeGreaterThan(0);
  expect(result.openingClipPlayed).toBe(true);
  expect(result.followUpClipPlayed).toBe(true);
  expect(result.followUpHitProgress).toHaveLength(1);
  expect(result.followUpHitProgress[0]).toBeGreaterThanOrEqual(0.49);
  expect(result.followUpHitProgress[0]).toBeLessThanOrEqual(0.52);
  expect(result.hitGeometryStable).toBe(true);

  expect(result.completionSampleCount).toBeGreaterThanOrEqual(12);
  expect(result.completionPose).not.toBeNull();
  expect(result.completionPose.progress).toBeGreaterThanOrEqual(0.89);
  expect(result.completionPose.progress).toBeLessThanOrEqual(0.91);
  expect(result.completionPose.bladeVisible).toBe(true);
  expect(result.completionPose.terminalPoseWeight).toBe(1);
  const angularDifference = (actual, expected) => (
    Math.abs(((actual - expected + 180) % 360 + 360) % 360 - 180)
  );
  for (const [jointName, expectedRotation] of Object.entries(FOLLOW_UP_TERMINAL_POSE_DEGREES)) {
    const actualRotation = result.completionPose.localPoseDegrees[jointName];
    expect(actualRotation, `${jointName} terminal pose was not applied`).toBeDefined();
    for (const axis of ['pitch', 'yaw', 'roll']) {
      expect(
        angularDifference(actualRotation[axis], expectedRotation[axis]),
        `${jointName}.${axis} drifted from the authored terminal pose`,
      ).toBeLessThan(0.25);
    }
  }
  expect(result.completionPose.armExtensionRatio).toBeGreaterThan(0.88);
  expect(Math.abs(result.completionPose.outwardWristReach)).toBeLessThan(0.2);
  expect(result.completionPose.outwardBladeDirection).toBeGreaterThan(0.45);
  expect(result.completionPose.outwardBladeTipReach).toBeGreaterThan(0.6);
  expect(result.completionPose.verticalBladeFraction).toBeGreaterThan(0.25);
  expect(result.completionPose.verticalBladeFraction).toBeLessThan(0.43);
  expect(result.completionPose.bodyClearance).toBeGreaterThan(result.requiredBodyClearance);
  expect(result.minimumCompletionClearance).toBeGreaterThan(result.requiredBodyClearance);
});

test('sword follow-up does not play when the opener spends the remaining energy', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(({ openingSlash, followUpSlash }) => {
    const { game } = window;
    game.stop();
    game.isPlayerInSafeArea = () => false;

    const player = game.player;
    const combat = game.combat;
    const rig = player.externalRig;
    const Vector3 = player.root.position.constructor;
    const swordIndex = player.armHotbar.findIndex((item) => item?.type === 'swordArm');
    player.switchArmWeapon(swordIndex, true);

    const state = combat.getCurrentWeaponState();
    state.cooldown = 0;
    state.reloadTimer = 0;
    state.energy = 1;
    state.weaponOutput = state.maxWeaponOutput;
    state.outputRecoveryDelay = 0;
    combat.swapTimer = 0;
    combat.primaryWasDown = false;
    combat.pendingMeleeStrikes.length = 0;
    player.animation.attackTimer = 0;
    player.animation.actionState = null;

    const pointer = game.pointer;
    pointer.primary = false;
    pointer.primaryPressed = false;
    pointer.secondary = false;
    pointer.alternate = false;
    pointer.aimWorld.copy(player.root.position).add(new Vector3(0, 0, 10));

    const clipTimeline = [];
    let queuedStrikeCount = 0;
    const originalQueueMeleeStrike = combat._queueMeleeStrike.bind(combat);
    combat._queueMeleeStrike = (...args) => {
      queuedStrikeCount += 1;
      return originalQueueMeleeStrike(...args);
    };

    const movementOptions = {
      arenaRadius: game.arenaRadius,
      movementForward: new Vector3(0, 0, 1),
      movementRight: new Vector3(1, 0, 0),
      groundY: player.root.position.y,
      game,
    };
    const tick = () => {
      player.update(1 / 60, new Set(), movementOptions);
      combat.update(1 / 60);
      const clip = rig.activeClipKey;
      if (clip && clipTimeline.at(-1) !== clip) {
        clipTimeline.push(clip);
      }
    };
    const pressPrimary = () => {
      pointer.primary = true;
      pointer.primaryPressed = true;
      tick();
      pointer.primary = false;
      tick();
    };

    pressPrimary();
    for (let frame = 0; frame < 20; frame += 1) {
      tick();
    }
    pressPrimary();
    const energyAfterRejectedFollowUp = state.energy;
    for (let frame = 0; frame < 32; frame += 1) {
      tick();
    }

    return {
      swordIndex,
      clipTimeline,
      queuedStrikeCount,
      energyAfterRejectedFollowUp,
      reloadTimer: state.reloadTimer,
      legacyFollowUpPlayed: clipTimeline.includes(followUpSlash),
      openingPlayed: clipTimeline.includes(openingSlash),
    };
  }, { openingSlash: OPENING_SLASH, followUpSlash: FOLLOW_UP_SLASH });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.openingPlayed).toBe(true);
  expect(result.energyAfterRejectedFollowUp).toBe(0);
  expect(result.queuedStrikeCount).toBe(1);
  expect(result.legacyFollowUpPlayed).toBe(false);
  expect(result.reloadTimer).toBeGreaterThan(0);
});

test('manually reloading cancels the pending sword follow-up', async ({ page }) => {
  await page.goto('/?startupWorld=dungeon');
  await page.waitForFunction(() => window.game?.player?._fbxAnimationLibraryLoaded === true);

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    game.isPlayerInSafeArea = () => false;

    const { player, combat } = game;
    const Vector3 = player.root.position.constructor;
    const swordIndex = player.armHotbar.findIndex((item) => item?.type === 'swordArm');
    player.switchArmWeapon(swordIndex, true);

    const state = combat.getCurrentWeaponState();
    state.cooldown = 0;
    state.reloadTimer = 0;
    state.energy = 2;
    state.weaponOutput = state.maxWeaponOutput;
    state.outputRecoveryDelay = 0;
    combat.swapTimer = 0;
    combat.pendingMeleeStrikes.length = 0;
    player.animation.attackTimer = 0;
    player.animation.actionState = null;

    const aimWorld = player.root.position.clone().add(new Vector3(0, 0, 10));
    const opened = combat.tryPrimaryAttack(aimWorld);
    const followUpWasPending = combat.swordCombo.awaitingFollowUp;
    const reloadStarted = combat.requestManualReload();
    const followUpPendingAfterReload = combat.swordCombo.awaitingFollowUp;

    state.reloadTimer = 0;
    state.cooldown = 0;
    state.energy = 2;
    state.weaponOutput = state.maxWeaponOutput;
    const attackedAfterReload = combat.tryPrimaryAttack(aimWorld);

    return {
      swordIndex,
      opened,
      followUpWasPending,
      reloadStarted,
      followUpPendingAfterReload,
      attackedAfterReload,
      clipAfterReload: player._activeSwordSlashClipKey,
    };
  });

  expect(result.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.opened).toBe(true);
  expect(result.followUpWasPending).toBe(true);
  expect(result.reloadStarted).toBe(true);
  expect(result.followUpPendingAfterReload).toBe(false);
  expect(result.attackedAfterReload).toBe(true);
  expect(result.clipAfterReload).toBe(OPENING_SLASH);
});
