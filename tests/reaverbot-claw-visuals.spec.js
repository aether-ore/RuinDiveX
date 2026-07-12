import { expect, test } from '@playwright/test';

test('claw palm rig presents its counter, cross-body guard, recoil, and destroyed states without a defense mesh', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
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

    let mirroredClaw = null;
    for (let variant = 0; variant < 220; variant += 1) {
      const candidate = window.spawnReaverbot({
        archetypeId: 'duelist',
        seed: `claw-palm-mirrored-guard:${variant}`,
        position: new Vector3(0, 0, 0),
      });
      if (candidate.genome.modules.weapon.attackKind === 'clawMoveset'
        && candidate.genome.modules.weapon.mountSide !== claw.genome.modules.weapon.mountSide) {
        mirroredClaw = candidate;
        break;
      }
      removeEnemy(candidate);
    }
    if (!mirroredClaw) throw new Error('Unable to generate a mirrored claw guard');

    let quadrupedClaw = null;
    for (let variant = 0; variant < 320; variant += 1) {
      const candidate = window.spawnReaverbot({
        archetypeId: 'pursuer',
        seed: `claw-palm-quadruped-guard:${variant}`,
        position: new Vector3(0, 0, 0),
      });
      if (candidate.genome.body.planId === 'quadruped'
        && candidate.genome.modules.weapon.attackKind === 'clawMoveset') {
        quadrupedClaw = candidate;
        break;
      }
      removeEnemy(candidate);
    }
    if (!quadrupedClaw) throw new Error('Unable to generate a quadruped claw guard');

    const visual = claw.visual;
    const weapon = visual.weapon;
    const palmForward = () => (
      new Vector3(0, 0, 1)
        .applyQuaternion(weapon.clawPalmAnchor.getWorldQuaternion(visual.root.quaternion.clone()))
        .normalize()
    );
    const palmPosition = () => weapon.clawPalmAnchor.getWorldPosition(new Vector3());
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

    const measureGuardPose = (candidate) => {
      const candidateVisual = candidate.visual;
      const candidateWeapon = candidateVisual.weapon;
      const mountSide = candidate.genome.modules.weapon.mountSide;
      animateReaverbotVisual(candidateVisual, {
        time: 0.31,
        dt: 1,
        state: 'position',
        stateProgress: 0,
        attackKind: 'clawMoveset',
        comboMountSide: mountSide,
        clawGuardProgress: 1,
        clawDestroyedProgress: 0,
        weakPointExposed: false,
        weakPointLocation: 'clawPalm',
      });
      candidateVisual.root.updateMatrixWorld(true);

      const candidateQuaternion = candidate.root.getWorldQuaternion(candidateVisual.root.quaternion.clone());
      const axis = (x, y, z) => new Vector3(x, y, z).applyQuaternion(candidateQuaternion).normalize();
      const bodyRight = axis(1, 0, 0);
      const bodyUp = axis(0, 1, 0);
      const bodyForwardAxis = axis(0, 0, 1);
      const shoulder = candidateWeapon.clawSwingPivot.getWorldPosition(new Vector3());
      const elbow = candidateWeapon.clawElbowPivot.getWorldPosition(new Vector3());
      const wrist = candidateWeapon.clawWristPivot.getWorldPosition(new Vector3());
      const upperDirection = elbow.clone().sub(shoulder).normalize();
      const forearmDirection = wrist.clone().sub(elbow).normalize();
      const elbowBend = Math.acos(Math.max(-1, Math.min(1, upperDirection.dot(forearmDirection))));
      const backQuaternion = candidateWeapon.clawPalmBackAnchor.getWorldQuaternion(
        candidateVisual.root.quaternion.clone(),
      );
      const palmQuaternion = candidateWeapon.clawPalmAnchor.getWorldQuaternion(
        candidateVisual.root.quaternion.clone(),
      );
      const backNormal = new Vector3(0, 0, -1).applyQuaternion(backQuaternion).normalize();
      const palmNormal = new Vector3(0, 0, 1).applyQuaternion(palmQuaternion).normalize();
      const palmRight = new Vector3(1, 0, 0).applyQuaternion(palmQuaternion).normalize();
      const palmUp = new Vector3(0, 1, 0).applyQuaternion(palmQuaternion).normalize();
      const toLocal = (position) => candidateVisual.root.worldToLocal(position.clone());
      const shoulderLocal = toLocal(shoulder);
      const elbowLocal = toLocal(elbow);
      const wristLocal = toLocal(wrist);
      const backLocal = toLocal(candidateWeapon.clawPalmBackAnchor.getWorldPosition(new Vector3()));
      const center = candidateVisual.frame.anchors.center;
      const halfBodyWidth = Math.max(0.45, Math.abs(candidateVisual.frame.anchors.side[0]));
      const belongsTo = (object, ancestor) => {
        for (let current = object; current; current = current.parent) {
          if (current === ancestor) return true;
        }
        return false;
      };
      const firstHitToward = (target) => {
        const origin = target.clone().addScaledVector(bodyForwardAxis, 6);
        const direction = target.clone().sub(origin).normalize();
        game.raycaster.set(origin, direction);
        return game.raycaster.intersectObject(candidateVisual.root, true).find((hit) => (
          hit.object.visible
          && hit.object.material?.visible !== false
          && (hit.object.material?.opacity ?? 1) > 0.01
        ))?.object ?? null;
      };

      let guardHits = 0;
      let centerColumnGuardHits = 0;
      for (const horizontal of [-0.6, 0, 0.6]) {
        for (const vertical of [-0.32, 0, 0.32]) {
          const target = candidateVisual.root.localToWorld(new Vector3(
            center[0] + horizontal * halfBodyWidth,
            center[1] + vertical,
            center[2],
          ));
          const first = firstHitToward(target);
          if (first && belongsTo(first, candidateWeapon.clawArmAssembly)) {
            guardHits += 1;
            if (horizontal === 0) centerColumnGuardHits += 1;
          }
        }
      }

      const eyeWorld = candidateVisual.eye.lens.getWorldPosition(new Vector3());
      const eyeFirstHit = firstHitToward(eyeWorld);
      candidateVisual.weakPoint.group.visible = true;
      candidateVisual.root.updateMatrixWorld(true);
      const palmEyeWorld = candidateVisual.weakPoint.core.getWorldPosition(new Vector3());
      const palmFirstHit = firstHitToward(palmEyeWorld);
      candidateVisual.weakPoint.group.visible = false;

      return {
        bodyPlan: candidate.genome.body.planId,
        mountSide,
        guardStyle: candidateWeapon.group.userData.clawRig.guardStyle,
        basePositionShift: candidateWeapon.group.position.distanceTo(
          candidateWeapon.group.userData.clawBasePosition,
        ),
        elbowBend,
        forearmAcrossDot: forearmDirection.dot(bodyRight) * mountSide,
        forearmVerticalDot: Math.abs(forearmDirection.dot(bodyUp)),
        forearmForwardDot: Math.abs(forearmDirection.dot(bodyForwardAxis)),
        backFacingDot: backNormal.dot(bodyForwardAxis),
        palmFacingDot: palmNormal.dot(bodyForwardAxis),
        palmRightAlignment: Math.abs(palmRight.dot(bodyRight)),
        palmUpAlignment: palmUp.dot(bodyUp),
        shoulderLocal: shoulderLocal.toArray(),
        elbowLocal: elbowLocal.toArray(),
        wristLocal: wristLocal.toArray(),
        backLocal: backLocal.toArray(),
        halfBodyWidth,
        center: [...center],
        crossesBodyCenter: elbowLocal.x * mountSide > halfBodyWidth * 0.35
          && wristLocal.x * mountSide < -halfBodyWidth * 0.35,
        guardHits,
        centerColumnGuardHits,
        eyeFirstHitIsEye: eyeFirstHit?.userData?.reaverbotEye === true,
        palmFirstHitIsGuard: Boolean(
          palmFirstHit
          && palmFirstHit.userData?.clawPalmEye !== true
          && belongsTo(palmFirstHit, candidateWeapon.clawArmAssembly)
        ),
        palmFirstHitName: palmFirstHit?.name ?? null,
        palmVisible: candidateVisual.weakPoint.group.visible,
      };
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

    const guard = measureGuardPose(claw);
    const mirroredGuard = measureGuardPose(mirroredClaw);
    const quadrupedGuard = measureGuardPose(quadrupedClaw);

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

    // Leave a deterministic pair in the replacement guard for the visual
    // artifact: both mount sides must read as the same attached elbow brace.
    measureGuardPose(claw);
    measureGuardPose(mirroredClaw);
    claw.root.position.set(-2.25, 0, 0);
    mirroredClaw.root.position.set(2.25, 0, 0);
    claw.root.rotation.y = 0;
    mirroredClaw.root.rotation.y = 0;
    quadrupedClaw.root.visible = false;
    const stagedRoots = [claw.root, mirroredClaw.root];
    const belongsToStage = (object) => stagedRoots.some((root) => {
      for (let current = object; current; current = current.parent) {
        if (current === root) return true;
      }
      return false;
    });
    game.scene.traverse((object) => {
      if (object.isMesh) object.visible = belongsToStage(object);
    });
    game.player.root.visible = false;
    const uiRoot = document.getElementById('ui-root');
    if (uiRoot) uiRoot.style.display = 'none';
    game.scene.fog = null;
    game.scene.background?.set?.(0x11151c);
    game.camera.position.set(0, 2.45, 9.6);
    game.camera.lookAt(new Vector3(0, 1.25, 0));
    game.camera.updateMatrixWorld(true);
    for (const root of stagedRoots) root.updateMatrixWorld(true);
    game.renderer.setAnimationLoop(() => game.renderer.render(game.scene, game.camera));

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
      mirroredGuard,
      quadrupedGuard,
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

  await page.screenshot({
    path: testInfo.outputPath('claw-cross-body-guard.png'),
    fullPage: false,
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
  expect(result.guard.mountSide).toBe(-result.mirroredGuard.mountSide);
  for (const guard of [result.guard, result.mirroredGuard, result.quadrupedGuard]) {
    expect(guard.guardStyle).toBe('crossBodyElbowBrace');
    expect(guard.basePositionShift).toBeLessThan(0.001);
    expect(guard.elbowBend).toBeGreaterThan(2.05);
    expect(guard.elbowBend).toBeLessThan(2.3);
    expect(guard.forearmAcrossDot).toBeLessThan(-0.72);
    expect(guard.forearmVerticalDot).toBeLessThan(0.08);
    expect(guard.forearmForwardDot).toBeGreaterThan(0.55);
    expect(guard.forearmForwardDot).toBeLessThan(0.72);
    expect(guard.palmFacingDot).toBeLessThan(-0.94);
    expect(guard.backFacingDot).toBeGreaterThan(0.94);
    expect(guard.palmRightAlignment).toBeGreaterThan(0.82);
    expect(guard.palmUpAlignment).toBeGreaterThan(0.82);
    expect(guard.crossesBodyCenter).toBe(true);
    expect(guard.elbowLocal[2] - guard.wristLocal[2]).toBeGreaterThan(1.1);
    expect(Math.abs(guard.backLocal[0])).toBeLessThan(guard.halfBodyWidth + 0.25);
    expect(guard.guardHits).toBeGreaterThanOrEqual(3);
    expect(guard.centerColumnGuardHits).toBeGreaterThanOrEqual(1);
    expect(guard.eyeFirstHitIsEye).toBe(true);
    expect(guard.palmFirstHitIsGuard).toBe(true);
    expect(guard.palmVisible).toBe(false);
  }

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
