import { expect, test } from '@playwright/test';

test('claw palm rig presents its counter, guard, recoil, and destroyed states without a defense mesh', async ({ page }) => {
  await page.goto('/?reaverbotSeed=claw-palm-visual-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(async () => {
    const { animateReaverbotVisual } = await import('/src/reaverbots/ReaverbotVisualFactory.js');
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();

    const removeEnemy = (enemy) => {
      const index = game.enemies.indexOf(enemy);
      if (index >= 0) game.enemies.splice(index, 1);
      enemy.dispose?.();
      enemy.root.removeFromParent();
    };
    for (const enemy of [...game.enemies]) removeEnemy(enemy);

    let claw = null;
    for (let variant = 0; variant < 220; variant += 1) {
      const candidate = window.spawnReaverbot({
        archetypeId: 'duelist',
        seed: `claw-palm-visual:${variant}`,
        position: new Vector3(0, 0, 0),
      });
      if (candidate.genome.modules.weapon.attackKind === 'clawMoveset') {
        claw = candidate;
        break;
      }
      removeEnemy(candidate);
    }
    if (!claw) throw new Error('Unable to generate a clawMoveset Reaverbot');

    const visual = claw.visual;
    const weapon = visual.weapon;
    const palmForward = () => (
      new Vector3(0, 0, 1)
        .applyQuaternion(weapon.clawPalmAnchor.getWorldQuaternion(visual.root.quaternion.clone()))
        .normalize()
    );
    const palmPosition = () => weapon.clawPalmAnchor.getWorldPosition(new Vector3());
    const palmBackPosition = () => weapon.clawPalmBackAnchor.getWorldPosition(new Vector3());
    const palmBackForward = () => (
      new Vector3(0, 0, -1)
        .applyQuaternion(weapon.clawPalmBackAnchor.getWorldQuaternion(visual.root.quaternion.clone()))
        .normalize()
    );
    const bodyForward = () => (
      new Vector3(0, 0, 1)
        .applyQuaternion(claw.root.getWorldQuaternion(visual.root.quaternion.clone()))
        .setY(0)
        .normalize()
    );
    const centerWorld = () => visual.root.localToWorld(
      new Vector3(
        visual.frame.anchors.center[0],
        visual.frame.anchors.center[1] + 0.08,
        visual.frame.anchors.center[2] + 0.58,
      ),
    );
    const animate = (options) => {
      animateReaverbotVisual(visual, {
        time: 0.31,
        dt: 1,
        attackKind: 'clawMoveset',
        comboMountSide: claw.genome.modules.weapon.mountSide,
        weakPointLocation: 'clawPalm',
        ...options,
      });
      visual.root.updateMatrixWorld(true);
    };

    const defenseMeshes = [];
    visual.defense.group.traverse((object) => {
      if (object.isMesh) defenseMeshes.push(object.name);
    });
    const eyeParts = [];
    visual.root.traverse((object) => {
      if (object.userData?.reaverbotEye || object.userData?.clawPalmEye) {
        eyeParts.push({
          name: object.name,
          color: object.material?.color?.getHex(),
          dominant: object.userData.dominantFocalPoint === true,
          palm: object.userData.clawPalmEye === true,
        });
      }
    });

    animate({ state: 'position', stateProgress: 0, weakPointExposed: false });
    const idle = {
      palmVisible: visual.weakPoint.group.visible,
      armVisible: weapon.clawArmAssembly.visible,
      stumpVisible: weapon.clawBrokenStump.visible,
      rootY: visual.root.position.y,
    };

    animate({
      state: 'position',
      clawGuardProgress: 1,
      weakPointExposed: false,
    });
    const guard = {
      backToTorso: palmBackPosition().distanceTo(centerWorld()),
      palmFacingDot: palmForward().setY(0).normalize().dot(bodyForward()),
      backFacingDot: palmBackForward().setY(0).normalize().dot(bodyForward()),
      palmVisible: visual.weakPoint.group.visible,
      pivotYaw: weapon.clawSwingPivot.rotation.y,
    };

    animate({
      state: 'telegraph',
      stateProgress: 0.84,
      clawAttackVariant: 'horizontalSwipe',
      weakPointExposed: true,
    });
    const horizontal = {
      pivotYaw: weapon.clawSwingPivot.rotation.y,
      pivotPitch: weapon.clawSwingPivot.rotation.x,
      palmVisible: visual.weakPoint.group.visible,
      palmExposed: visual.weakPoint.core.userData.exposed,
      palmForwardZ: palmForward().z,
      palmEyeIntensity: visual.weakPoint.core.material.emissiveIntensity,
      openTalons: weapon.clawTalonPivots.filter((talon) => talon.rotation.x < -0.45).length,
    };

    animate({
      state: 'telegraph',
      stateProgress: 0.84,
      clawAttackVariant: 'verticalSlam',
      weakPointExposed: true,
    });
    const raisedPalmY = palmPosition().y;
    const vertical = {
      pivotPitch: weapon.clawSwingPivot.rotation.x,
      palmForwardZ: palmForward().z,
      palmVisible: visual.weakPoint.group.visible,
      openTalons: weapon.clawTalonPivots.filter((talon) => talon.rotation.x < -0.45).length,
    };

    animate({
      state: 'commit',
      stateProgress: 0.88,
      clawAttackVariant: 'verticalSlam',
      weakPointExposed: false,
    });
    const slam = {
      palmDrop: raisedPalmY - palmPosition().y,
      pivotPitch: weapon.clawSwingPivot.rotation.x,
    };

    animate({
      state: 'commit',
      stateProgress: 0.5,
      clawAttackVariant: 'horizontalSwipe',
      clawSpinProgress: 0.5,
      weakPointExposed: false,
    });
    const halfSpin = Math.abs(visual.root.rotation.y - visual.root.userData.baseClawVisualYaw);
    animate({
      state: 'commit',
      stateProgress: 1,
      clawAttackVariant: 'horizontalSwipe',
      clawSpinProgress: 1,
      weakPointExposed: false,
    });
    const settledSpin = Math.abs(visual.root.rotation.y - visual.root.userData.baseClawVisualYaw);

    animate({
      state: 'position',
      clawRecoilProgress: 0.5,
      weakPointExposed: false,
    });
    const recoil = {
      pivotRoll: Math.abs(weapon.clawSwingPivot.rotation.z),
      elbowFold: weapon.clawElbowPivot.rotation.x,
      chassisPitch: Math.abs(visual.root.rotation.x),
      chassisRoll: Math.abs(visual.root.rotation.z),
      chassisDrop: idle.rootY - visual.root.position.y,
    };
    animate({
      state: 'position',
      clawRecoilProgress: 1,
      weakPointExposed: false,
    });
    recoil.returnPitch = Math.abs(visual.root.rotation.x);
    recoil.returnRoll = Math.abs(visual.root.rotation.z);
    recoil.returnHeightError = Math.abs(idle.rootY - visual.root.position.y);

    const blinkMax = (progress) => {
      let maximum = 0;
      for (let sample = 0; sample < 16; sample += 1) {
        animate({
          time: sample * 0.035,
          state: 'telegraph',
          stateProgress: progress,
          clawAttackVariant: 'horizontalSwipe',
          weakPointExposed: true,
        });
        maximum = Math.max(maximum, visual.materials.weapon.emissiveIntensity);
      }
      return maximum;
    };
    const blink = { early: blinkMax(0.18), late: blinkMax(0.94) };

    animate({
      state: 'position',
      clawDestroyedProgress: 1,
      weakPointExposed: true,
    });
    const destroyed = {
      armVisible: weapon.clawArmAssembly.visible,
      stumpVisible: weapon.clawBrokenStump.visible,
      palmVisible: visual.weakPoint.group.visible,
      palmExposed: visual.weakPoint.core.userData.exposed,
    };

    claw.brain.state = 'telegraph';
    claw.brain.stateTime = claw._getStateDuration('telegraph') - 0.05;
    claw._updateExposureAndDefense();
    const lateTelegraphPalmActive = claw.weakPointTarget.active;

    return {
      defense: {
        genome: claw.genome.modules.defense,
        id: visual.defense.group.userData.defenseId,
        meshNames: defenseMeshes,
        plateCount: visual.defense.plates.length,
      },
      decorativeArmor: {
        enabled: visual.meleeArmor.enabled,
        sidePlates: visual.meleeArmor.sidePlates.length,
        decorativeOnly: visual.meleeArmor.sidePlates.every((plate) => (
          plate.userData.decorativeArmor === true
          && plate.userData.gameplayDefense === false
        )),
      },
      eyeParts,
      palmParented: visual.weakPoint.group.parent === weapon.clawPalmAnchor,
      backAnchorPresent: Boolean(weapon.clawPalmBackAnchor),
      telegraphDuration: claw._getStateDuration('telegraph'),
      lateTelegraphPalmActive,
      idle,
      guard,
      horizontal,
      vertical,
      slam,
      halfSpin,
      settledSpin,
      recoil,
      blink,
      destroyed,
    };
  });

  expect(result.defense.genome).toBeNull();
  expect(result.defense.id).toBeNull();
  expect(result.defense.meshNames).toEqual([]);
  expect(result.defense.plateCount).toBe(0);
  expect(result.decorativeArmor).toEqual({ enabled: true, sidePlates: 2, decorativeOnly: true });

  expect(result.eyeParts.filter((eye) => eye.dominant)).toHaveLength(1);
  expect(result.eyeParts.filter((eye) => eye.palm)).toHaveLength(1);
  expect(result.eyeParts.every((eye) => eye.color === 0xff254f)).toBe(true);
  expect(result.palmParented).toBe(true);
  expect(result.backAnchorPresent).toBe(true);
  expect(result.telegraphDuration).toBeCloseTo(1.65, 5);
  expect(result.lateTelegraphPalmActive).toBe(true);

  expect(result.idle.palmVisible).toBe(false);
  expect(result.idle.armVisible).toBe(true);
  expect(result.idle.stumpVisible).toBe(false);
  expect(result.guard.backToTorso).toBeLessThan(0.08);
  expect(result.guard.palmFacingDot).toBeLessThan(-0.95);
  expect(result.guard.backFacingDot).toBeGreaterThan(0.95);
  expect(result.guard.palmVisible).toBe(false);
  expect(Math.abs(result.guard.pivotYaw)).toBeGreaterThan(0.5);

  expect(Math.abs(result.horizontal.pivotYaw)).toBeGreaterThan(1.25);
  expect(Math.abs(result.horizontal.pivotPitch)).toBeLessThan(0.1);
  expect(result.horizontal.palmVisible).toBe(true);
  expect(result.horizontal.palmExposed).toBe(true);
  expect(result.horizontal.palmForwardZ).toBeGreaterThan(0.82);
  expect(result.horizontal.palmEyeIntensity).toBeGreaterThan(1.75);
  expect(result.horizontal.openTalons).toBe(3);

  expect(result.vertical.pivotPitch).toBeLessThan(-1.25);
  expect(result.vertical.palmForwardZ).toBeGreaterThan(0.82);
  expect(result.vertical.palmVisible).toBe(true);
  expect(result.vertical.openTalons).toBe(3);
  expect(result.slam.palmDrop).toBeGreaterThan(1.5);
  expect(result.slam.pivotPitch).toBeGreaterThan(0.45);

  expect(result.halfSpin).toBeCloseTo(Math.PI, 4);
  expect(result.settledSpin).toBeLessThan(0.001);
  expect(result.recoil.pivotRoll).toBeGreaterThan(0.65);
  expect(result.recoil.elbowFold).toBeGreaterThan(0.82);
  expect(result.recoil.chassisPitch).toBeGreaterThan(0.6);
  expect(result.recoil.chassisRoll).toBeGreaterThan(0.75);
  expect(result.recoil.chassisDrop).toBeGreaterThan(0.3);
  expect(result.recoil.returnPitch).toBeLessThan(0.001);
  expect(result.recoil.returnRoll).toBeLessThan(0.001);
  expect(result.recoil.returnHeightError).toBeLessThan(0.001);
  expect(result.blink.late).toBeGreaterThan(result.blink.early + 1);

  expect(result.destroyed).toEqual({
    armVisible: false,
    stumpVisible: true,
    palmVisible: false,
    palmExposed: false,
  });
});
