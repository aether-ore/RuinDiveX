import { expect, test } from '@playwright/test';

const OPENING_SLASH = 'swordForwardSlash';
const FOLLOW_UP_SLASH = 'swordInwardSlash';

test('sword attack buffers the legacy inward slash after the new forward opener', async ({ page }) => {
  await page.goto('/');
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
  await page.goto('/');
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

test('sword follow-up does not play when the opener spends the remaining energy', async ({ page }) => {
  await page.goto('/');
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
  await page.goto('/');
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
