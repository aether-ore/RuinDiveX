import { expect, test } from '@playwright/test';

test('crawler artillery use layered chassis with articulated legs or driven wheel bogies', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?reaverbotSeed=crawler-mobility-visual-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(() => {
    const game = window.game;
    const Vector3 = game.player.root.position.constructor;
    game.stop();

    for (const enemy of [...game.enemies]) {
      const index = game.enemies.indexOf(enemy);
      if (index >= 0) game.enemies.splice(index, 1);
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }

    const spawnFixture = (seed, mobilityId, x) => {
      const enemy = window.spawnReaverbot({
        seed,
        archetypeId: 'artillery',
        threatTier: 2,
        encounterSize: 3,
        position: new Vector3(x, 0, 0),
      });
      if (enemy.genome.body.planId !== 'crawler' || enemy.genome.body.mobilityId !== mobilityId) {
        throw new Error(`Unexpected crawler fixture ${seed}: ${enemy.genome.body.planId}/${enemy.genome.body.mobilityId}`);
      }
      return enemy;
    };
    const wheeled = spawnFixture('crawler-playwright:26', 'wheelBogies', -1.8);
    const articulated = spawnFixture('crawler-playwright:14', 'articulatedCrawler', 1.8);

    const summarize = (enemy) => {
      const names = [];
      const eyeNames = [];
      const workingEnds = [];
      let mobilityMinY = Number.POSITIVE_INFINITY;
      enemy.visual.root.updateMatrixWorld(true);
      const mobilityRoots = enemy.visual.frame.wheels.length > 0
        ? enemy.visual.frame.wheels.map((wheel) => wheel.assembly)
        : enemy.visual.frame.limbs.map((limb) => limb.hipPivot);
      for (const mobilityRoot of mobilityRoots) {
        mobilityRoot.traverse((object) => {
          if (!object.isMesh) return;
          object.geometry.computeBoundingBox();
          const bounds = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
          mobilityMinY = Math.min(mobilityMinY, bounds.min.y);
        });
      }
      enemy.visual.root.traverse((object) => {
        names.push(object.name);
        if (object.userData?.dominantFocalPoint) eyeNames.push(object.name);
        if (object.userData?.reaverbotWorkingEnd) workingEnds.push(object.name);
      });
      const summarizeAssembly = (assembly) => {
        const meshes = [];
        assembly.traverse((object) => {
          if (object.isMesh) meshes.push(object);
        });
        return {
          meshCount: meshes.length,
          geometryFamilies: [...new Set(meshes.map((mesh) => mesh.geometry.type))],
        };
      };
      return {
        mobilityId: enemy.genome.body.mobilityId,
        movementModel: enemy.genome.body.movementModel,
        mobilityLegCount: enemy.genome.body.mobilityLegCount,
        mobilityWheelCount: enemy.genome.body.mobilityWheelCount,
        bodyIsGroup: enemy.visual.frame.body.isGroup,
        headIsGroup: enemy.visual.frame.head.isGroup,
        body: summarizeAssembly(enemy.visual.frame.body),
        head: summarizeAssembly(enemy.visual.frame.head),
        visualLegCount: enemy.visual.frame.limbs.length,
        visualWheelCount: enemy.visual.frame.wheels.length,
        mobilityMinY,
        dominantEyeCount: eyeNames.length,
        oldBoxBodyPresent: names.includes('generatedReaverbotAnimalTorso'),
        oldBoxHeadPresent: names.includes('generatedReaverbotAnimalHead'),
        oldPegPartsPresent: names.some((name) => /generatedCrawler(UpperLeg|LowerLeg|WedgeFoot)/.test(name)),
        wheelWorkingEnds: workingEnds.filter((name) => name.includes('WheelTire')).length,
        articulatedHierarchy: enemy.visual.frame.limbs.every((limb) => (
          limb.crawlerArticulated
          && limb.kneePivot.parent === limb.hipPivot
          && limb.footPivot.parent === limb.kneePivot
        )),
      };
    };
    const structures = [summarize(wheeled), summarize(articulated)];

    wheeled.brain.moving = false;
    wheeled.brain.speedRatio = 0;
    wheeled._animateVisual(0.016);
    const idleWheelAngles = wheeled.visual.frame.wheels.map((wheel) => wheel.spinPivot.rotation.x);
    wheeled._animateVisual(0.25);
    const stillIdleWheelAngles = wheeled.visual.frame.wheels.map((wheel) => wheel.spinPivot.rotation.x);
    wheeled.root.position.z += 1.8;
    wheeled.brain.moving = true;
    wheeled.brain.speedRatio = 1;
    wheeled.brain.time += 0.25;
    wheeled._animateVisual(0.25);
    const movedWheelAngles = wheeled.visual.frame.wheels.map((wheel) => wheel.spinPivot.rotation.x);
    wheeled.brain.time += 0.25;
    wheeled._animateVisual(0.25);
    const blockedWheelAngles = wheeled.visual.frame.wheels.map((wheel) => wheel.spinPivot.rotation.x);

    articulated.brain.moving = true;
    articulated.brain.speedRatio = 1;
    articulated.brain.time = 0;
    articulated._animateVisual(0.016);
    const articulatedBefore = articulated.visual.frame.limbs.map((limb) => ({
      hip: limb.hipPivot.rotation.x,
      knee: limb.kneePivot.rotation.x,
    }));
    articulated.brain.time = 0.42;
    articulated._animateVisual(0.25);
    const articulatedAfter = articulated.visual.frame.limbs.map((limb) => ({
      hip: limb.hipPivot.rotation.x,
      knee: limb.kneePivot.rotation.x,
    }));

    wheeled.root.position.set(-1.8, 0, 0);
    articulated.root.position.set(1.8, 0, 0);
    for (const enemy of [wheeled, articulated]) {
      enemy.root.rotation.y = 0;
      enemy.brain.moving = false;
      enemy.brain.speedRatio = 0;
      enemy.brain.state = 'telegraph';
      enemy.brain.stateTime = enemy.genome.behavior.telegraphDuration * 0.72;
      enemy._updateExposureAndDefense();
      enemy._animateVisual(0.016);
      enemy.root.updateMatrixWorld(true);
    }

    const stagedRoots = [wheeled.root, articulated.root];
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
    game.scene.background?.set?.(0x10151d);
    game.camera.position.set(4.8, 2.35, 7);
    game.camera.lookAt(new Vector3(0, 0.85, 0));
    game.camera.updateMatrixWorld(true);
    game.renderer.setAnimationLoop(() => game.renderer.render(game.scene, game.camera));

    return {
      structures,
      wheelAnimation: {
        idleDelta: Math.max(...stillIdleWheelAngles.map((angle, index) => Math.abs(angle - idleWheelAngles[index]))),
        travelDelta: Math.min(...movedWheelAngles.map((angle, index) => Math.abs(angle - stillIdleWheelAngles[index]))),
        blockedDelta: Math.max(...blockedWheelAngles.map((angle, index) => Math.abs(angle - movedWheelAngles[index]))),
      },
      articulatedJointDelta: Math.max(...articulatedAfter.map((pose, index) => Math.max(
        Math.abs(pose.hip - articulatedBefore[index].hip),
        Math.abs(pose.knee - articulatedBefore[index].knee),
      ))),
    };
  });

  expect(result.structures.map((entry) => entry.mobilityId)).toEqual(['wheelBogies', 'articulatedCrawler']);
  for (const structure of result.structures) {
    expect(structure.bodyIsGroup).toBe(true);
    expect(structure.headIsGroup).toBe(true);
    expect(structure.body.meshCount).toBeGreaterThanOrEqual(8);
    expect(structure.body.geometryFamilies.length).toBeGreaterThanOrEqual(3);
    expect(structure.head.meshCount).toBeGreaterThanOrEqual(6);
    expect(structure.head.geometryFamilies.length).toBeGreaterThanOrEqual(3);
    expect(structure.dominantEyeCount).toBe(1);
    expect(structure.oldBoxBodyPresent).toBe(false);
    expect(structure.oldBoxHeadPresent).toBe(false);
    expect(structure.oldPegPartsPresent).toBe(false);
    expect(structure.mobilityMinY).toBeGreaterThanOrEqual(-0.04);
    expect(structure.mobilityMinY).toBeLessThan(0.16);
  }
  const [wheelStructure, articulatedStructure] = result.structures;
  expect(wheelStructure.movementModel).toBe('wheelDrive');
  expect(wheelStructure.mobilityLegCount).toBe(0);
  expect(wheelStructure.mobilityWheelCount).toBe(4);
  expect(wheelStructure.visualLegCount).toBe(0);
  expect(wheelStructure.visualWheelCount).toBe(4);
  expect(wheelStructure.wheelWorkingEnds).toBe(4);
  expect(articulatedStructure.movementModel).toBe('groundStep');
  expect(articulatedStructure.mobilityLegCount).toBe(6);
  expect(articulatedStructure.mobilityWheelCount).toBe(0);
  expect(articulatedStructure.visualLegCount).toBe(6);
  expect(articulatedStructure.visualWheelCount).toBe(0);
  expect(articulatedStructure.articulatedHierarchy).toBe(true);
  expect(result.wheelAnimation.idleDelta).toBeLessThan(0.0001);
  expect(result.wheelAnimation.travelDelta).toBeGreaterThan(0.5);
  expect(result.wheelAnimation.blockedDelta).toBeLessThan(0.0001);
  expect(result.articulatedJointDelta).toBeGreaterThan(0.08);

  await page.screenshot({
    path: testInfo.outputPath('reaverbot-crawler-mobility-rigs.png'),
    fullPage: false,
  });
});
