import { expect, test } from '@playwright/test';

test('quadruped eyelids and the cross-body claw brace read as distinct defenses', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?startupWorld=dungeon&reaverbotSeed=defense-pose-visual-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
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

    const findQuadruped = () => {
      for (let variant = 0; variant < 400; variant += 1) {
        const options = {
          archetypeId: 'pursuer',
          seed: `defense-pose-quadruped:${variant}`,
          position: new Vector3(0, 0, 0),
        };
        const enemy = window.spawnReaverbot(options);
        if (enemy.genome.body.planId === 'quadruped'
          && enemy.genome.modules.weapon.id !== 'clawArm') {
          return { enemy, options };
        }
        removeEnemy(enemy);
      }
      throw new Error('Unable to generate a non-claw quadruped');
    };
    const findClaw = () => {
      for (let variant = 0; variant < 300; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId: 'duelist',
          seed: `defense-pose-claw:${variant}`,
          position: new Vector3(0, 0, 0),
        });
        if (enemy.genome.modules.weapon.id === 'clawArm') return enemy;
        removeEnemy(enemy);
      }
      throw new Error('Unable to generate a claw carrier');
    };

    const { enemy: closedQuadruped, options: quadrupedOptions } = findQuadruped();
    const openQuadruped = window.spawnReaverbot(quadrupedOptions);
    const claw = findClaw();

    closedQuadruped.root.position.set(-3.15, 0, 0);
    openQuadruped.root.position.set(0, 0, 0);
    claw.root.position.set(3.15, 0, -0.1);
    for (const enemy of [closedQuadruped, openQuadruped, claw]) {
      enemy.root.rotation.y = 0;
    }

    closedQuadruped.brain.state = 'position';
    closedQuadruped.brain.stateTime = 0;
    closedQuadruped._updateExposureAndDefense();
    closedQuadruped._animateVisual(1);

    openQuadruped.brain.state = 'telegraph';
    openQuadruped.brain.stateTime = openQuadruped._getStateDuration('telegraph') * 0.1;
    openQuadruped._updateExposureAndDefense();
    openQuadruped._animateVisual(1);
    const earlyTelegraph = {
      defenseActive: openQuadruped.brain.defenseActive,
      weakPointExposed: openQuadruped.brain.weakPointExposed,
      weakPointResolved: Boolean(openQuadruped.resolveProjectileHit(
        openQuadruped.visual.weakPoint.core.getWorldPosition(new Vector3()),
        0.08,
      )),
    };
    openQuadruped.brain.stateTime = openQuadruped._getStateDuration('telegraph') * 0.52;
    openQuadruped._updateExposureAndDefense();
    openQuadruped._animateVisual(1);
    openQuadruped.root.updateMatrixWorld(true);
    const openWeakPointResolved = Boolean(openQuadruped.resolveProjectileHit(
      openQuadruped.visual.weakPoint.core.getWorldPosition(new Vector3()),
      0.08,
    ));

    claw.brain.state = 'guard';
    claw.brain.stateTime = 0.2;
    claw._updateExposureAndDefense();
    claw._animateVisual(1);

    const eyelidGap = (enemy) => Math.abs(
      enemy.visual.defense.shutters[1].position.y
        - enemy.visual.defense.shutters[0].position.y,
    );
    const bodyQuaternion = claw.root.getWorldQuaternion(claw.visual.root.quaternion.clone());
    const bodyForward = new Vector3(0, 0, 1)
      .applyQuaternion(bodyQuaternion)
      .setY(0)
      .normalize();
    const bodyRight = new Vector3(1, 0, 0).applyQuaternion(bodyQuaternion).normalize();
    const backForward = new Vector3(0, 0, -1)
      .applyQuaternion(claw.visual.weapon.clawPalmBackAnchor.getWorldQuaternion(claw.visual.root.quaternion.clone()))
      .setY(0)
      .normalize();
    const guardShoulder = claw.visual.weapon.clawSwingPivot.getWorldPosition(new Vector3());
    const guardElbow = claw.visual.weapon.clawElbowPivot.getWorldPosition(new Vector3());
    const guardWrist = claw.visual.weapon.clawWristPivot.getWorldPosition(new Vector3());
    const upperDirection = guardElbow.clone().sub(guardShoulder).normalize();
    const forearmDirection = guardWrist.clone().sub(guardElbow).normalize();
    const guardElbowBend = Math.acos(Math.max(-1, Math.min(1, upperDirection.dot(forearmDirection))));
    const guardElbowLocal = claw.visual.root.worldToLocal(guardElbow.clone());
    const guardWristLocal = claw.visual.root.worldToLocal(guardWrist.clone());
    const guardBackLocal = claw.visual.root.worldToLocal(
      claw.visual.weapon.clawPalmBackAnchor.getWorldPosition(new Vector3()),
    );
    const halfBodyWidth = Math.max(0.45, Math.abs(claw.visual.frame.anchors.side[0]));

    const stagedRoots = [closedQuadruped.root, openQuadruped.root, claw.root];
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
    game.scene.background?.set?.(0x141820);
    game.camera.position.set(0, 2.65, 9.8);
    game.camera.lookAt(new Vector3(0, 1.2, 0));
    game.camera.updateMatrixWorld(true);
    for (const enemy of [closedQuadruped, openQuadruped, claw]) {
      enemy.root.updateMatrixWorld(true);
    }
    game.renderer.setAnimationLoop(() => game.renderer.render(game.scene, game.camera));

    return {
      closedDefense: closedQuadruped.genome.modules.defense.id,
      openDefense: openQuadruped.genome.modules.defense.id,
      closedPlateCount: closedQuadruped.visual.defense.plates.length,
      eyelidNames: closedQuadruped.visual.defense.shutters.map((shutter) => shutter.name),
      closedGap: eyelidGap(closedQuadruped),
      openGap: eyelidGap(openQuadruped),
      openEyeExposed: openQuadruped.brain.weakPointExposed,
      openWeakPointResolved,
      earlyTelegraph,
      guardStyle: claw.visual.weapon.group.userData.clawRig.guardStyle,
      guardBasePositionShift: claw.visual.weapon.group.position.distanceTo(
        claw.visual.weapon.group.userData.clawBasePosition,
      ),
      guardElbowBend,
      guardForearmAcross: forearmDirection.dot(bodyRight)
        * claw.genome.modules.weapon.mountSide,
      guardDepthReturn: guardElbowLocal.z - guardWristLocal.z,
      guardPalmCenterOverlap: Math.abs(guardBackLocal.x) < halfBodyWidth + 0.25,
      guardBackFacingDot: backForward.dot(bodyForward),
      guardPalmVisible: claw.visual.weakPoint.group.visible,
    };
  });

  expect(result.closedDefense).toBe('armorShutters');
  expect(result.openDefense).toBe('armorShutters');
  expect(result.closedPlateCount).toBe(0);
  expect(result.eyelidNames).toEqual([
    'generatedQuadrupedEyeArmorEyelid',
    'generatedQuadrupedEyeArmorEyelid',
  ]);
  expect(result.openGap).toBeGreaterThan(result.closedGap + 0.5);
  expect(result.earlyTelegraph).toEqual({
    defenseActive: true,
    weakPointExposed: false,
    weakPointResolved: false,
  });
  expect(result.openEyeExposed).toBe(true);
  expect(result.openWeakPointResolved).toBe(true);
  expect(result.guardStyle).toBe('crossBodyElbowBrace');
  expect(result.guardBasePositionShift).toBeLessThan(0.001);
  expect(result.guardElbowBend).toBeGreaterThan(2.05);
  expect(result.guardElbowBend).toBeLessThan(2.3);
  expect(result.guardForearmAcross).toBeLessThan(-0.72);
  expect(result.guardDepthReturn).toBeGreaterThan(1.1);
  expect(result.guardPalmCenterOverlap).toBe(true);
  expect(result.guardBackFacingDot).toBeGreaterThan(0.95);
  expect(result.guardPalmVisible).toBe(false);

  await page.screenshot({
    path: process.env.REAVERBOT_DEFENSE_VISUAL_ARTIFACT
      ?? testInfo.outputPath('reaverbot-defense-poses.png'),
    fullPage: false,
  });
});
