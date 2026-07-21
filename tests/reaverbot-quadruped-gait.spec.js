import { expect, test } from '@playwright/test';

test('quadruped Reaverbots use an articulated canine gait and modular jaw silhouettes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?startupWorld=dungeon&reaverbotSeed=quadruped-canine-runtime-proof');
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

    const findEnemy = (archetypeId, seedPrefix, predicate) => {
      for (let variant = 0; variant < 280; variant += 1) {
        const enemy = window.spawnReaverbot({
          archetypeId,
          seed: `${seedPrefix}:${variant}`,
          position: new Vector3(0, 0, 0),
        });
        if (predicate(enemy)) return enemy;
        removeEnemy(enemy);
      }
      throw new Error(`Unable to generate ${seedPrefix}`);
    };

    const ram = findEnemy('pursuer', 'quadruped-gait-ram', (enemy) => (
      enemy.genome.body.planId === 'quadruped'
      && enemy.genome.modules.weapon.id === 'rocketLance'
    ));
    const canineJaw = findEnemy('pursuer', 'quadruped-gait-canine-jaw', (enemy) => (
      enemy.genome.modules.weapon.id === 'crusherJaw'
      && enemy.genome.modules.weapon.jawVariant === 'canineFangCage'
    ));
    const crusherJaw = findEnemy('pursuer', 'quadruped-gait-crusher-jaw', (enemy) => (
      enemy.genome.modules.weapon.id === 'crusherJaw'
      && enemy.genome.modules.weapon.jawVariant === 'crusherTrap'
    ));

    const summarizeRig = (enemy) => {
      const limbs = enemy.visual.frame.limbs.filter((limb) => limb.role === 'quadrupedLeg');
      enemy.visual.root.updateMatrixWorld(true);
      const contacts = Object.fromEntries(limbs.map((limb) => [
        limb.slot,
        limb.contactAnchor.getWorldPosition(new Vector3()).toArray(),
      ]));
      const uuids = limbs.flatMap((limb) => [
        limb.hipPivot.uuid,
        limb.kneePivot.uuid,
        limb.hockPivot.uuid,
        limb.pawPivot.uuid,
      ]);
      let toeClawCount = 0;
      enemy.visual.root.traverse((object) => {
        if (object.name.includes('CanineToeClaw')) toeClawCount += 1;
      });
      return {
        limbCount: limbs.length,
        slots: limbs.map((limb) => limb.slot).sort(),
        uniqueJointCount: new Set(uuids).size,
        exactParentChains: limbs.every((limb) => (
          limb.pivot === limb.hipPivot
          && limb.kneePivot.parent === limb.hipPivot
          && limb.hockPivot.parent === limb.kneePivot
          && limb.anklePivot === limb.hockPivot
          && limb.pawPivot.parent === limb.hockPivot
          && limb.contactAnchor.parent === limb.pawPivot
        )),
        allContactsMarked: limbs.every((limb) => (
          limb.contactAnchor.userData.contactSurface === true
          && limb.sole.userData.contactSurface === true
        )),
        contacts,
        toeClawCount,
        articulatedChassis: enemy.visual.frame.body.userData.articulatedCanineChassis === true,
        hasRibcage: Boolean(enemy.visual.root.getObjectByName('generatedReaverbotAnimalTorso')),
        hasPelvis: Boolean(enemy.visual.root.getObjectByName('generatedCaninePelvisArmor')),
      };
    };

    const limbs = ram.visual.frame.limbs.filter((limb) => limb.role === 'quadrupedLeg');
    const bySlot = Object.fromEntries(limbs.map((limb) => [limb.slot, limb]));
    ram.root.position.set(0, 0, 0);
    ram.root.rotation.y = 0;
    ram.brain.state = 'position';
    ram.brain.stateTime = 0;
    ram.brain.time = 0;
    ram.brain.moving = false;
    ram.brain.speedRatio = 0;
    ram._animateVisual(1);
    ram.visual.root.updateMatrixWorld(true);
    const neutralContactY = Object.fromEntries(limbs.map((limb) => [
      limb.slot,
      limb.contactAnchor.getWorldPosition(new Vector3()).y,
    ]));

    const samples = [];
    const dt = 1 / 60;
    for (let frame = 0; frame < 116; frame += 1) {
      ram.root.position.z += 3.4 * dt;
      ram.brain.time += dt;
      ram.brain.moving = true;
      ram.brain.speedRatio = 1;
      ram._animateVisual(dt);
      ram.visual.root.updateMatrixWorld(true);
      if (frame < 20) continue;
      const sample = { planted: 0, legs: {} };
      for (const limb of limbs) {
        const contact = limb.contactAnchor.getWorldPosition(new Vector3());
        const pawQuaternion = limb.pawPivot.getWorldQuaternion(ram.root.quaternion.clone());
        const upDot = new Vector3(0, 1, 0).applyQuaternion(pawQuaternion).dot(new Vector3(0, 1, 0));
        sample.legs[limb.slot] = {
          hip: limb.hipPivot.rotation.x,
          knee: limb.kneePivot.rotation.x,
          hock: limb.hockPivot.rotation.x,
          lift: contact.y - neutralContactY[limb.slot],
          upDot,
          planted: limb.planted,
          contact: contact.toArray(),
        };
        if (limb.planted) sample.planted += 1;
      }
      samples.push(sample);
    }

    const range = (values) => Math.max(...values) - Math.min(...values);
    const correlation = (left, right) => {
      const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
      const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
      let covariance = 0;
      let leftVariance = 0;
      let rightVariance = 0;
      for (let index = 0; index < left.length; index += 1) {
        const leftDelta = left[index] - leftMean;
        const rightDelta = right[index] - rightMean;
        covariance += leftDelta * rightDelta;
        leftVariance += leftDelta ** 2;
        rightVariance += rightDelta ** 2;
      }
      return covariance / Math.max(0.000001, Math.sqrt(leftVariance * rightVariance));
    };
    const series = (slot, key) => samples.map((sample) => sample.legs[slot][key]);
    const jointRanges = Object.fromEntries(limbs.map((limb) => [limb.slot, {
      hip: range(series(limb.slot, 'hip')),
      knee: range(series(limb.slot, 'knee')),
      hock: range(series(limb.slot, 'hock')),
      lift: range(series(limb.slot, 'lift')),
    }]));
    const correlations = {
      opposingFrontHip: correlation(series('leftFront', 'hip'), series('rightFront', 'hip')),
      leftFrontRightRearLift: correlation(series('leftFront', 'lift'), series('rightRear', 'lift')),
      opposingFrontLift: correlation(series('leftFront', 'lift'), series('rightFront', 'lift')),
    };
    const minimumPlantedFeet = Math.min(...samples.map((sample) => sample.planted));
    const minimumPlantedUpDot = Math.min(...samples.flatMap((sample) => (
      Object.values(sample.legs).filter((leg) => leg.planted).map((leg) => leg.upDot)
    )));

    const phaseBeforeStationaryFrames = ram.visual.frame.gait.phase;
    for (let frame = 0; frame < 30; frame += 1) {
      ram.brain.time += dt;
      ram.brain.moving = true;
      ram._animateVisual(dt);
    }
    const stationaryPhaseChange = Math.abs(ram.visual.frame.gait.phase - phaseBeforeStationaryFrames);

    const jawSummary = (enemy) => {
      let upperTeeth = 0;
      let lowerTeeth = 0;
      let fangCagePartCount = 0;
      enemy.visual.weapon.jawUpperPivot.traverse((object) => {
        if (object.userData.razorJawTooth) upperTeeth += 1;
        if (object.name.includes('CanineFangCage')) fangCagePartCount += 1;
      });
      enemy.visual.weapon.jawLowerPivot.traverse((object) => {
        if (object.userData.razorJawTooth) lowerTeeth += 1;
        if (object.name.includes('CanineFangCage')) fangCagePartCount += 1;
      });
      return {
        genomeVariant: enemy.genome.modules.weapon.jawVariant,
        visualVariant: enemy.visual.weapon.jawVariant,
        upperTeeth,
        lowerTeeth,
        fangCagePartCount,
        muzzleZ: enemy.visual.weapon.muzzle.position.z,
        headMounted: enemy.visual.weapon.group.parent === enemy.visual.frame.headAssembly,
        eyeHeadMounted: enemy.visual.eye.group.parent === enemy.visual.frame.headAssembly,
        articulatedLimbCount: enemy.visual.frame.limbs.filter((limb) => limb.canine).length,
      };
    };

    const ramRig = summarizeRig(ram);
    const canineJawSummary = jawSummary(canineJaw);
    const crusherJawSummary = jawSummary(crusherJaw);

    // Stage an authored side view for visual QA of the silhouette and joints.
    ram.root.position.set(-3.05, 0, 0.7);
    canineJaw.root.position.set(2.25, 0, -0.35);
    ram.root.rotation.y = 0.95;
    canineJaw.root.rotation.y = 0.95;
    canineJaw.brain.state = 'position';
    canineJaw.brain.stateTime = 0;
    canineJaw.brain.time = 0.27;
    canineJaw.brain.moving = false;
    canineJaw._animateVisual(1);
    crusherJaw.root.visible = false;

    const belongsTo = (object, root) => {
      for (let current = object; current; current = current.parent) {
        if (current === root) return true;
      }
      return false;
    };
    game.scene.traverse((object) => {
      if (!object.isMesh) return;
      object.visible = belongsTo(object, ram.root) || belongsTo(object, canineJaw.root);
    });
    game.player.root.visible = false;
    const uiRoot = document.getElementById('ui-root');
    if (uiRoot) uiRoot.style.display = 'none';
    game.scene.fog = null;
    if (game.scene.background?.set) game.scene.background.set(0x11151b);
    game.camera.position.set(0.35, 2.3, 11.5);
    game.camera.lookAt(new Vector3(0.35, 0.95, 0));
    game.camera.updateMatrixWorld(true);
    game.renderer.setAnimationLoop(() => game.renderer.render(game.scene, game.camera));

    return {
      ramRig,
      jointRanges,
      correlations,
      minimumPlantedFeet,
      minimumPlantedUpDot,
      stationaryPhaseChange,
      canineJaw: canineJawSummary,
      crusherJaw: crusherJawSummary,
      diagonalPhasePairs: {
        leftFront: bySlot.leftFront.gaitPhase,
        rightRear: bySlot.rightRear.gaitPhase,
        rightFront: bySlot.rightFront.gaitPhase,
        leftRear: bySlot.leftRear.gaitPhase,
      },
    };
  });

  expect(result.ramRig.limbCount).toBe(4);
  expect(result.ramRig.slots).toEqual(['leftFront', 'leftRear', 'rightFront', 'rightRear']);
  expect(result.ramRig.uniqueJointCount).toBe(16);
  expect(result.ramRig.exactParentChains).toBe(true);
  expect(result.ramRig.allContactsMarked).toBe(true);
  expect(result.ramRig.toeClawCount).toBe(12);
  expect(result.ramRig.articulatedChassis).toBe(true);
  expect(result.ramRig.hasRibcage).toBe(true);
  expect(result.ramRig.hasPelvis).toBe(true);
  expect(result.ramRig.contacts.leftFront[0]).toBeLessThan(0);
  expect(result.ramRig.contacts.rightFront[0]).toBeGreaterThan(0);
  expect(result.ramRig.contacts.leftFront[2]).toBeGreaterThan(result.ramRig.contacts.leftRear[2]);

  for (const motion of Object.values(result.jointRanges)) {
    expect(motion.hip).toBeGreaterThan(0.18);
    expect(motion.knee).toBeGreaterThan(0.14);
    expect(motion.hock).toBeGreaterThan(0.08);
    expect(motion.lift).toBeGreaterThan(0.055);
  }
  expect(result.correlations.opposingFrontHip).toBeLessThan(-0.6);
  expect(result.correlations.leftFrontRightRearLift).toBeGreaterThan(0.95);
  expect(result.correlations.opposingFrontLift).toBeLessThan(-0.28);
  expect(result.minimumPlantedFeet).toBeGreaterThanOrEqual(2);
  expect(result.minimumPlantedUpDot).toBeGreaterThan(0.93);
  expect(result.stationaryPhaseChange).toBeLessThan(0.000001);

  expect(result.diagonalPhasePairs.leftFront).toBe(result.diagonalPhasePairs.rightRear);
  expect(result.diagonalPhasePairs.rightFront).toBe(result.diagonalPhasePairs.leftRear);
  expect(result.diagonalPhasePairs.leftFront).not.toBe(result.diagonalPhasePairs.rightFront);

  expect(result.canineJaw.genomeVariant).toBe('canineFangCage');
  expect(result.canineJaw.visualVariant).toBe('canineFangCage');
  expect(result.canineJaw.fangCagePartCount).toBeGreaterThanOrEqual(8);
  expect(result.canineJaw.upperTeeth).toBe(result.canineJaw.lowerTeeth);
  expect(result.canineJaw.upperTeeth).toBeGreaterThanOrEqual(10);
  expect(result.canineJaw.headMounted).toBe(true);
  expect(result.canineJaw.eyeHeadMounted).toBe(true);
  expect(result.canineJaw.articulatedLimbCount).toBe(4);
  expect(result.crusherJaw.genomeVariant).toBe('crusherTrap');
  expect(result.crusherJaw.visualVariant).toBe('crusherTrap');
  expect(result.crusherJaw.fangCagePartCount).toBe(0);
  expect(result.crusherJaw.upperTeeth).toBe(result.crusherJaw.lowerTeeth);
  expect(result.canineJaw.muzzleZ).toBeGreaterThan(result.crusherJaw.muzzleZ);

  await page.screenshot({
    path: process.env.REAVERBOT_QUADRUPED_ARTIFACT
      ?? testInfo.outputPath('reaverbot-articulated-quadrupeds.png'),
    fullPage: false,
  });
});
