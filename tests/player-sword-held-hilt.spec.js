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
    const hiltMeshes = [];
    hilt?.traverse((object) => {
      if (object.isMesh && object.geometry) hiltMeshes.push(object);
    });
    const solidHiltMeshes = hiltMeshes.filter((mesh) => (
      mesh.material?.transparent !== true
      && mesh.material?.blending !== 2 // THREE.AdditiveBlending
    ));
    const geometryKinds = [...new Set(hiltMeshes.map((mesh) => mesh.geometry.type))];

    const equipped = {
      swordIndex,
      hasWeaponGroup: Boolean(weaponGroup?.isObject3D),
      hasHilt: Boolean(hilt?.isObject3D),
      hasEmitter: Boolean(emitter?.isObject3D),
      hasBlade: Boolean(blade?.isObject3D),
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
    };

    const state = combat.getCurrentWeaponState();
    const profile = combat._getStatefulProfile(combat._getCurrentProfile(), state);
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
    const started = combat.tryPrimaryAttack(aimWorld);
    const sampledBase = new Vector3();
    const sampledTip = new Vector3();
    let liveSample = null;

    for (let frame = 0; frame < 70; frame += 1) {
      player.update(1 / 60, new Set(), movementOptions);
      combat.update(1 / 60);
      if (!blade?.visible || !emitter) continue;
      if (!combat._readSwordSweepTrailObservation({}, sampledBase, sampledTip)) continue;

      emitter.updateWorldMatrix(true, false);
      const emitterPosition = emitter.getWorldPosition(new Vector3());
      const muzzlePosition = busterMuzzle?.getWorldPosition(new Vector3()) ?? null;
      liveSample = {
        hiltVisible: isEffectivelyVisible(hilt),
        bladeVisible: isEffectivelyVisible(blade),
        baseToEmitter: sampledBase.distanceTo(emitterPosition),
        baseToOldBusterMuzzle: muzzlePosition ? sampledBase.distanceTo(muzzlePosition) : null,
        sampledBladeLength: sampledBase.distanceTo(sampledTip),
      };
      break;
    }

    return { equipped, started, liveSample };
  });

  expect(result.equipped.swordIndex).toBeGreaterThanOrEqual(0);
  expect(result.equipped).toEqual(expect.objectContaining({
    hasWeaponGroup: true,
    hasHilt: true,
    hasEmitter: true,
    hasBlade: true,
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

  expect(result.started).toBe(true);
  expect(result.liveSample).not.toBeNull();
  expect(result.liveSample).toEqual(expect.objectContaining({
    hiltVisible: true,
    bladeVisible: true,
  }));
  expect(result.liveSample.baseToEmitter).toBeLessThan(0.08);
  expect(result.liveSample.sampledBladeLength).toBeGreaterThan(1);
  expect(result.liveSample.baseToOldBusterMuzzle).toBeGreaterThan(0.15);
});
