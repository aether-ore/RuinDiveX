import { expect, test } from '@playwright/test';

test('laser sword is a modeled right-hand weapon and its live trail starts at the hilt emitter', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (
    window.game?.player?._fbxAnimationLibraryLoaded === true
    && window.game?.player?._busterArmLoaded === true
  ));

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    game.isPlayerInSafeArea = () => false;

    const { player, combat } = game;
    const rig = player.externalRig;
    const Vector3 = player.root.position.constructor;
    const Quaternion = player.root.quaternion.constructor;
    const swordIndex = player.armHotbar.findIndex((item) => item?.type === 'swordArm');
    player.switchArmWeapon(swordIndex, true);

    const isDescendantOf = (object, ancestor) => {
      for (let current = object; current; current = current.parent) {
        if (current === ancestor) return true;
      }
      return false;
    };
    const isEffectivelyVisible = (object) => {
      for (let current = object; current; current = current.parent) {
        if (current.visible === false) return false;
      }
      return Boolean(object);
    };

    const weaponGroup = rig.beamBladeWeaponGroup;
    const hilt = rig.beamBladeHilt;
    const emitter = rig.beamBladeEmitter;
    const blade = rig.beamBladeGroup;
    const rightWrist = rig.joints.get('rightWrist');
    const busterMuzzle = rig.busterMuzzle;
    const grip = hilt?.getObjectByName('rigBeamSaberGrip') ?? null;
    const hiltMeshes = [];
    hilt?.traverse((object) => {
      if (object.isMesh && object.geometry) hiltMeshes.push(object);
    });
    const solidHiltMeshes = hiltMeshes.filter((mesh) => (
      mesh.material?.transparent !== true
      && mesh.material?.blending !== 2 // THREE.AdditiveBlending
    ));
    const geometryKinds = [...new Set(hiltMeshes.map((mesh) => mesh.geometry.type))];
    rightWrist?.updateWorldMatrix(true, false);
    emitter?.updateWorldMatrix(true, false);
    const wristWorldInverse = rightWrist
      ?.getWorldQuaternion(new Quaternion())
      .invert();
    const emitterAxisInWrist = emitter && wristWorldInverse
      ? new Vector3(0, 0, 1)
        .applyQuaternion(emitter.getWorldQuaternion(new Quaternion()))
        .applyQuaternion(wristWorldInverse)
        .normalize()
      : null;

    const equipped = {
      swordIndex,
      hasWeaponGroup: Boolean(weaponGroup?.isObject3D),
      hasHilt: Boolean(hilt?.isObject3D),
      hasEmitter: Boolean(emitter?.isObject3D),
      hasBlade: Boolean(blade?.isObject3D),
      hasGrip: Boolean(grip?.isMesh),
      weaponMountedToRightWrist: isDescendantOf(weaponGroup, rightWrist),
      bladeMountedToHeldWeapon: isDescendantOf(blade, weaponGroup),
      weaponMountedToBusterMuzzle: isDescendantOf(weaponGroup, busterMuzzle),
      bladeMountedToBusterMuzzle: isDescendantOf(blade, busterMuzzle),
      hiltVisible: isEffectivelyVisible(hilt),
      bladeVisible: isEffectivelyVisible(blade),
      busterVisible: isEffectivelyVisible(rig.busterArmGroup),
      hiltMeshCount: hiltMeshes.length,
      solidHiltMeshCount: solidHiltMeshes.length,
      geometryKinds,
      emitterAxisInWrist: emitterAxisInWrist?.toArray() ?? null,
    };

    const state = combat.getCurrentWeaponState();
    const profile = combat._getStatefulProfile(combat._getCurrentProfile(), state);
    const authoredHitGeometry = {
      range: profile.range,
      arcScale: profile.arcScale,
      slashDelay: profile.slashDelay,
    };
    state.cooldown = 0;
    state.reloadTimer = 0;
    state.energy = Math.max(state.maxEnergy, profile.energyCost);
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
    const sampledBase = new Vector3();
    const sampledTip = new Vector3();
    let liveSample = null;
    const arcSamples = [];

    const sampleGripPose = () => {
      if (!grip || !Array.isArray(rig.bones) || !(rig.restLocalQuaternions instanceof Map)) {
        return null;
      }
      grip.updateWorldMatrix(true, false);
      const animatedFingerBones = rig.bones.filter((bone) => (
        /^mixamorigRightHand(?:Thumb|Index|Middle|Ring|Pinky)[123]$/.test(bone.name)
      ));
      const distalFingerBones = rig.bones.filter((bone) => (
        /^mixamorigRightHand(?:Thumb|Index|Middle|Ring|Pinky)4$/.test(bone.name)
      ));
      const curlAngles = animatedFingerBones.map((bone) => (
        bone.quaternion.angleTo(rig.restLocalQuaternions.get(bone))
      ));
      const gripRadius = Math.max(
        grip.geometry.parameters?.radiusTop ?? 0,
        grip.geometry.parameters?.radiusBottom ?? 0,
      );
      const gripHalfLength = (grip.geometry.parameters?.height ?? 0) * 0.5;
      const distal = distalFingerBones.map((bone) => {
        const local = grip.worldToLocal(bone.getWorldPosition(new Vector3()));
        return {
          name: bone.name,
          radialRatio: Math.hypot(local.x, local.z) / Math.max(0.0001, gripRadius),
          axialRatio: Math.abs(local.y) / Math.max(0.0001, gripHalfLength),
        };
      });
      return {
        animatedFingerCount: animatedFingerBones.length,
        distalFingerCount: distalFingerBones.length,
        meanCurl: curlAngles.reduce((sum, angle) => sum + angle, 0)
          / Math.max(1, curlAngles.length),
        materiallyCurledCount: curlAngles.filter((angle) => angle >= 0.25).length,
        distal,
      };
    };

    // The equipped idle must already be a real grip. The sword clips happen
    // to close the FBX fingers themselves, so sampling only during a slash
    // would miss a regression back to the open-hand carry shown in gameplay.
    player.update(1 / 60, new Set(), movementOptions);
    const idleGripPose = sampleGripPose();
    const idleBladeVisible = isEffectivelyVisible(blade);
    const started = combat.tryPrimaryAttack(aimWorld);

    for (let frame = 0; frame < 70; frame += 1) {
      player.update(1 / 60, new Set(), movementOptions);
      combat.update(1 / 60);
      if (!blade?.visible || !emitter) continue;
      if (!combat._readSwordSweepTrailObservation({}, sampledBase, sampledTip)) continue;

      const attackProgress = player.animation.attackDuration > 0
        ? 1 - (player.animation.attackTimer / player.animation.attackDuration)
        : 0;
      if (attackProgress >= 0.36 && attackProgress <= 0.70) {
        arcSamples.push({
          base: sampledBase.clone(),
          tip: sampledTip.clone(),
        });
      }
      if (liveSample || attackProgress < 0.42) continue;

      emitter.updateWorldMatrix(true, false);
      const emitterPosition = emitter.getWorldPosition(new Vector3());
      const muzzlePosition = busterMuzzle?.getWorldPosition(new Vector3()) ?? null;
      const emitterForward = new Vector3(0, 0, 1)
        .applyQuaternion(emitter.getWorldQuaternion(new Quaternion()))
        .normalize();
      const sampledDirection = sampledTip.clone().sub(sampledBase).normalize();
      liveSample = {
        hiltVisible: isEffectivelyVisible(hilt),
        bladeVisible: isEffectivelyVisible(blade),
        baseToEmitter: sampledBase.distanceTo(emitterPosition),
        baseToOldBusterMuzzle: muzzlePosition ? sampledBase.distanceTo(muzzlePosition) : null,
        sampledBladeLength: sampledBase.distanceTo(sampledTip),
        emitterDirectionDot: emitterForward.dot(sampledDirection),
        gripPose: sampleGripPose(),
      };
    }

    let maximumArcDirectionStep = 0;
    for (let index = 1; index < arcSamples.length; index += 1) {
      const previousDirection = arcSamples[index - 1].tip
        .clone()
        .sub(arcSamples[index - 1].base)
        .normalize();
      const currentDirection = arcSamples[index].tip
        .clone()
        .sub(arcSamples[index].base)
        .normalize();
      maximumArcDirectionStep = Math.max(
        maximumArcDirectionStep,
        previousDirection.angleTo(currentDirection),
      );
    }
    const arcEndToEndTravel = arcSamples.length >= 2
      ? arcSamples[0].tip.distanceTo(arcSamples.at(-1).tip)
      : 0;
    const finalProfile = combat._getStatefulProfile(combat._getCurrentProfile(), state);
    const hitGeometryStable = authoredHitGeometry.range === finalProfile.range
      && authoredHitGeometry.arcScale === finalProfile.arcScale
      && authoredHitGeometry.slashDelay === finalProfile.slashDelay;

    return {
      equipped,
      started,
      idleGripPose,
      idleBladeVisible,
      liveSample,
      arc: {
        sampleCount: arcSamples.length,
        endToEndTravel: arcEndToEndTravel,
        maximumDirectionStep: maximumArcDirectionStep,
      },
      hitGeometryStable,
    };
  });

  expect(result.equipped.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.equipped).toEqual(expect.objectContaining({
    hasWeaponGroup: true,
    hasHilt: true,
    hasEmitter: true,
    hasBlade: true,
    hasGrip: true,
    weaponMountedToRightWrist: true,
    bladeMountedToHeldWeapon: true,
    weaponMountedToBusterMuzzle: false,
    bladeMountedToBusterMuzzle: false,
    hiltVisible: true,
    bladeVisible: false,
    busterVisible: false,
  }));
  expect(result.equipped.hiltMeshCount).toBeGreaterThanOrEqual(4);
  expect(result.equipped.solidHiltMeshCount).toBeGreaterThanOrEqual(3);
  expect(result.equipped.geometryKinds.length).toBeGreaterThanOrEqual(2);
  expect(result.equipped.emitterAxisInWrist).toHaveLength(3);
  expect(result.equipped.emitterAxisInWrist[0]).toBeGreaterThan(0.9);
  expect(Math.abs(result.equipped.emitterAxisInWrist[1])).toBeLessThan(0.3);

  expect(result.started).toBe(true);
  expect(result.idleBladeVisible).toBe(false);
  expect(result.idleGripPose).not.toBeNull();
  expect(result.idleGripPose.animatedFingerCount).toBe(15);
  expect(result.idleGripPose.meanCurl).toBeGreaterThan(0.5);
  expect(result.idleGripPose.materiallyCurledCount).toBeGreaterThanOrEqual(12);
  expect(result.liveSample).not.toBeNull();
  expect(result.liveSample).toEqual(expect.objectContaining({
    hiltVisible: true,
    bladeVisible: true,
  }));
  expect(result.liveSample.baseToEmitter).toBeLessThan(0.08);
  expect(result.liveSample.sampledBladeLength).toBeGreaterThan(1);
  expect(result.liveSample.baseToOldBusterMuzzle).toBeGreaterThan(0.15);
  expect(result.liveSample.emitterDirectionDot).toBeGreaterThan(0.999);
  expect(result.liveSample.gripPose).not.toBeNull();
  expect(result.liveSample.gripPose.animatedFingerCount).toBe(15);
  expect(result.liveSample.gripPose.distalFingerCount).toBe(5);
  expect(result.liveSample.gripPose.meanCurl).toBeGreaterThan(0.5);
  expect(result.liveSample.gripPose.materiallyCurledCount).toBeGreaterThanOrEqual(12);
  const fourFingerTips = result.liveSample.gripPose.distal.filter(({ name }) => (
    !name.includes('Thumb')
  ));
  const thumbTip = result.liveSample.gripPose.distal.find(({ name }) => name.includes('Thumb'));
  expect(fourFingerTips).toHaveLength(4);
  expect(Math.max(...fourFingerTips.map(({ radialRatio }) => radialRatio))).toBeLessThan(2.25);
  expect(Math.max(...fourFingerTips.map(({ axialRatio }) => axialRatio))).toBeLessThan(1.35);
  expect(thumbTip.radialRatio).toBeLessThan(2.5);
  expect(thumbTip.axialRatio).toBeLessThan(1.35);

  expect(result.arc.sampleCount).toBeGreaterThanOrEqual(12);
  expect(result.arc.endToEndTravel).toBeGreaterThan(2);
  // The authored release turns just under 70 degrees on its fastest 60 Hz
  // frame. Keep enough room for that deliberate snap while catching a mount
  // discontinuity or a late emitter pop.
  expect(result.arc.maximumDirectionStep).toBeLessThan(1.3);
  expect(result.hitGeometryStable).toBe(true);
});
