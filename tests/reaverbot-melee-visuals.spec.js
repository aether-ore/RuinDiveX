import { expect, test } from '@playwright/test';

test('live melee Reaverbots expose independent armor silhouettes while keeping one red eye readable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?reaverbotSeed=melee-visual-runtime-proof');
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

    const findEnemy = (archetypeId, attackKind, seedPrefix) => {
      for (let variant = 0; variant < 180; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId,
          seed: `${seedPrefix}:${variant}`,
          position: new Vector3(0, 0, 0),
        });
        if (enemy.genome.modules.weapon.attackKind === attackKind) return enemy;
        removeEnemy(enemy);
      }
      throw new Error(`Unable to generate ${archetypeId}/${attackKind}`);
    };

    const jaw = findEnemy('pursuer', 'jawCombo', 'melee-visual-jaw');
    const claw = findEnemy('duelist', 'clawCombo', 'melee-visual-claw');
    jaw.root.position.set(-1.9, 0, 0);
    claw.root.position.set(1.55, 0, -0.05);
    jaw.root.rotation.y = 0.34;
    claw.root.rotation.y = -0.42;

    jaw.brain.state = 'telegraph';
    jaw.brain.stateTime = jaw.genome.behavior.telegraphDuration * 0.68;
    jaw.brain.time = 0.23;
    jaw._animateVisual(0.016);
    claw.brain.state = 'position';
    claw.brain.stateTime = 0;
    claw.brain.time = 0.16;
    claw._animateVisual(0.016);

    const summarize = (enemy) => {
      const armor = enemy.visual.meleeArmor;
      const eyeMeshes = [];
      enemy.visual.root.traverse((object) => {
        if (object.userData?.reaverbotEye) eyeMeshes.push(object);
      });
      return {
        weaponId: enemy.genome.modules.weapon.id,
        enabled: armor.enabled,
        plateCount: armor.plates.length,
        sidePlateCount: armor.sidePlates.length,
        spikeCount: armor.spikes.length,
        decorativeOnly: [...armor.plates, ...armor.spikes].every((part) => (
          part.userData.decorativeArmor === true
          && part.userData.gameplayDefense === false
          && !enemy.visual.defense.plates.includes(part)
        )),
        defenseId: enemy.visual.defense.group.userData.defenseId,
        expectedDefenseId: enemy.genome.modules.defense.id,
        eyeCount: eyeMeshes.length,
        eyeColor: eyeMeshes[0]?.material?.color?.getHex(),
        sidePlateSpan: Math.abs(armor.sidePlates[1].position.x - armor.sidePlates[0].position.x),
        bodyWidth: enemy.visual.frame.anchors.side[0] * 2,
      };
    };

    // Isolate the two silhouettes for a stable visual-QA artifact while
    // retaining the game's authored lighting.
    const belongsTo = (object, root) => {
      for (let current = object; current; current = current.parent) {
        if (current === root) return true;
      }
      return false;
    };
    game.scene.traverse((object) => {
      if (!object.isMesh) return;
      object.visible = belongsTo(object, jaw.root) || belongsTo(object, claw.root);
    });
    game.player.root.visible = false;
    const uiRoot = document.getElementById('ui-root');
    if (uiRoot) uiRoot.style.display = 'none';
    game.scene.fog = null;
    if (game.scene.background?.set) game.scene.background.set(0x171b22);
    game.camera.position.set(0, 2.85, 9.6);
    game.camera.lookAt(new Vector3(0, 1.05, 0));
    game.camera.updateMatrixWorld(true);
    jaw.visual.root.updateMatrixWorld(true);
    claw.visual.root.updateMatrixWorld(true);
    const jawEyeWorld = jaw.visual.eye.lens.getWorldPosition(new Vector3());
    const clawEyeWorld = claw.visual.eye.lens.getWorldPosition(new Vector3());
    // Keep presenting the staged frame: the production renderer does not use
    // preserveDrawingBuffer, so a one-shot render may be cleared before the
    // browser screenshot compositor reads the canvas.
    game.renderer.setAnimationLoop(() => game.renderer.render(game.scene, game.camera));

    return {
      jaw: summarize(jaw),
      claw: summarize(claw),
      framing: {
        jawEyeWorld: jawEyeWorld.toArray(),
        clawEyeWorld: clawEyeWorld.toArray(),
        jawEyeNdc: jawEyeWorld.clone().project(game.camera).toArray(),
        clawEyeNdc: clawEyeWorld.clone().project(game.camera).toArray(),
        jawVisible: jaw.root.visible && jaw.visual.root.visible && jaw.visual.eye.lens.visible,
        clawVisible: claw.root.visible && claw.visual.root.visible && claw.visual.eye.lens.visible,
      },
    };
  });

  for (const sample of [result.jaw, result.claw]) {
    expect(sample.enabled).toBe(true);
    expect(sample.plateCount).toBe(4);
    expect(sample.sidePlateCount).toBe(2);
    expect(sample.spikeCount).toBeGreaterThanOrEqual(4);
    expect(sample.decorativeOnly).toBe(true);
    expect(sample.defenseId).toBe(sample.expectedDefenseId);
    expect(sample.eyeCount).toBe(1);
    expect(sample.eyeColor).toBe(0xff254f);
    expect(sample.sidePlateSpan).toBeGreaterThan(sample.bodyWidth);
  }
  expect(result.jaw.weaponId).toBe('crusherJaw');
  expect(result.claw.weaponId).toBe('clawArm');
  expect(result.framing.jawVisible).toBe(true);
  expect(result.framing.clawVisible).toBe(true);
  expect(Math.abs(result.framing.jawEyeNdc[0])).toBeLessThan(0.9);
  expect(Math.abs(result.framing.clawEyeNdc[0])).toBeLessThan(0.9);
  expect(Math.abs(result.framing.jawEyeNdc[1])).toBeLessThan(0.9);
  expect(Math.abs(result.framing.clawEyeNdc[1])).toBeLessThan(0.9);

  await page.screenshot({
    path: process.env.REAVERBOT_VISUAL_ARTIFACT
      ?? testInfo.outputPath('reaverbot-melee-silhouettes.png'),
    fullPage: false,
  });
});
