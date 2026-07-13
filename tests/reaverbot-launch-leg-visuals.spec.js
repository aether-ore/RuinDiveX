import { expect, test } from '@playwright/test';

test('Launch Leg pouncers carry a massive mirrored kangaroo leg with rocket-assisted jump power', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?reaverbotSeed=launch-leg-visual-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const result = await page.evaluate(async () => {
    const { Box3, Vector3 } = await import('three');
    const game = window.game;
    game.stop();

    const removeEnemy = (enemy) => {
      const index = game.enemies.indexOf(enemy);
      if (index >= 0) game.enemies.splice(index, 1);
      enemy.dispose?.();
      enemy.root.removeFromParent();
    };
    for (const enemy of [...game.enemies]) removeEnemy(enemy);

    // Seed-searching is intentional: generation must continue to produce both
    // mirrored mount sides instead of pinning the leg to a showcase fixture.
    const launchLegBySide = new Map();
    let ordinaryPouncer = null;
    for (let variant = 0; variant < 480; variant += 1) {
      const candidate = window.spawnReaverbot({
        archetypeId: 'pouncer',
        seed: `launch-leg-audit:${variant}`,
        threatTier: 2,
        encounterSize: 2,
        position: new Vector3(0, 0, 0),
      });
      const weapon = candidate.genome.modules.weapon;
      const launchLeg = weapon.id === 'launchLeg'
        && weapon.attackKind === 'pounce'
        && candidate.genome.body.mobilityId === 'launchLeg';
      if (launchLeg) {
        const side = Math.sign(weapon.mountSide || candidate.visual.weapon.launchLegMountSide || 1);
        if (!launchLegBySide.has(side)) {
          launchLegBySide.set(side, candidate);
        } else {
          removeEnemy(candidate);
        }
      } else if (!ordinaryPouncer
        && weapon.id === 'shockPiston'
        && weapon.attackKind === 'pounce') {
        ordinaryPouncer = candidate;
      } else {
        removeEnemy(candidate);
      }
      if (launchLegBySide.has(-1) && launchLegBySide.has(1) && ordinaryPouncer) break;
    }
    if (!launchLegBySide.has(-1) || !launchLegBySide.has(1)) {
      throw new Error('Unable to generate Launch Leg pouncers on both mount sides');
    }
    if (!ordinaryPouncer) throw new Error('Unable to generate an ordinary shock-piston pouncer');

    const launchLegs = [-1, 1].map((side) => launchLegBySide.get(side));
    const launchLeg = launchLegs[0];
    const visual = launchLeg.visual;
    const weapon = visual.weapon;
    const rig = weapon.group.userData.launchLegRig;
    const joints = [
      weapon.launchLegHipPivot,
      weapon.launchLegKneePivot,
      weapon.launchLegAnklePivot,
      weapon.launchLegFootPivot,
    ];
    const within = (object, ancestor) => {
      for (let current = object; current; current = current.parent) {
        if (current === ancestor) return true;
      }
      return false;
    };
    const worldPosition = (object) => object.getWorldPosition(new Vector3());
    const longestDimension = (object) => {
      const size = new Box3().setFromObject(object).getSize(new Vector3());
      return Math.max(size.x, size.y, size.z);
    };
    const rotationSnapshot = () => joints.map((joint) => [
      joint.rotation.x,
      joint.rotation.y,
      joint.rotation.z,
    ]);
    const flameIsActive = (flame) => flame.visible
      && Math.max(Math.abs(flame.scale.x), Math.abs(flame.scale.y), Math.abs(flame.scale.z)) > 0.2;
    const poseSnapshot = () => ({
      hipToFoot: worldPosition(weapon.launchLegHipPivot)
        .distanceTo(worldPosition(weapon.launchLegFootPivot)),
      rotations: rotationSnapshot(),
      activeFlames: weapon.launchLegFlames.filter(flameIsActive).length,
    });
    const setPose = (enemy, state, progress) => {
      enemy.brain.state = state;
      enemy.brain.stateTime = enemy._getStateDuration(state) * progress;
      enemy.brain.moving = state === 'commit';
      enemy.brain.speedRatio = state === 'commit' ? 1.4 : 0;
      enemy.brain.time = 0.37;
      // A full response step makes this a pose contract rather than a frame-
      // rate-sensitive easing test.
      enemy._animateVisual(1);
      enemy.root.updateMatrixWorld(true);
    };

    setPose(launchLeg, 'position', 0);
    const idle = poseSnapshot();
    const jointPositions = joints.map(worldPosition);
    let jointChainLength = 0;
    for (let index = 1; index < jointPositions.length; index += 1) {
      jointChainLength += jointPositions[index - 1].distanceTo(jointPositions[index]);
    }
    const footPosition = jointPositions.at(-1);
    const clawReach = Math.max(...weapon.launchLegClaws.map((claw) => (
      footPosition.distanceTo(worldPosition(claw))
    )));
    const boosterHeights = weapon.launchLegBoosters.map((booster) => worldPosition(booster).y);
    const kneeHeight = worldPosition(weapon.launchLegKneePivot).y;
    const geometry = {
      assemblyLongest: longestDimension(weapon.launchLegAssembly),
      bodyLongest: longestDimension(visual.frame.body),
      authoredJointSpan: jointChainLength + clawReach,
      articulatedHierarchy: within(weapon.launchLegHipPivot, weapon.launchLegAssembly)
        && within(weapon.launchLegKneePivot, weapon.launchLegHipPivot)
        && within(weapon.launchLegAnklePivot, weapon.launchLegKneePivot)
        && within(weapon.launchLegFootPivot, weapon.launchLegAnklePivot)
        && weapon.launchLegClaws.every((claw) => within(claw, weapon.launchLegFootPivot)),
      boostersUpperMounted: weapon.launchLegBoosters.every((booster) => (
        within(booster, weapon.launchLegHipPivot)
      )),
      flamesAttachedToBoosters: weapon.launchLegFlames.every((flame) => (
        weapon.launchLegBoosters.some((booster) => within(flame, booster))
      )),
      boosterHeights,
      kneeHeight,
    };

    setPose(launchLeg, 'telegraph', 0.88);
    const telegraph = poseSnapshot();
    const telegraphHingeChange = telegraph.rotations.reduce((total, rotation, jointIndex) => (
      total + rotation.reduce((jointTotal, angle, axisIndex) => (
        jointTotal + Math.abs(angle - idle.rotations[jointIndex][axisIndex])
      ), 0)
    ), 0);
    setPose(launchLeg, 'commit', 0.48);
    const commit = poseSnapshot();

    const dungeon = game.dungeonController;
    const originals = {
      getEnemyArenaTarget: dungeon.getEnemyArenaTarget,
      getSurfaceElevationAt: dungeon.getSurfaceElevationAt,
      isEnemyPositionClear: dungeon.isEnemyPositionClear,
      isAerialPositionClear: dungeon.isAerialPositionClear,
      isPositionWalkable: dungeon.isPositionWalkable,
    };
    dungeon.getEnemyArenaTarget = (_enemy, desired, target) => target.copy(desired);
    dungeon.getSurfaceElevationAt = () => 0;
    dungeon.isEnemyPositionClear = () => true;
    dungeon.isAerialPositionClear = () => true;
    dungeon.isPositionWalkable = () => true;
    game.player.lastMoveDirection.set(0, 0, 0);

    const exercisePounce = (enemy) => {
      enemy._removeTelegraphMarker();
      enemy.root.position.set(0, 0, 0);
      enemy.root.rotation.set(0, 0, 0);
      enemy.brain.state = 'position';
      enemy.brain.stateTime = 0;
      enemy.brain.cooldown = 0;
      enemy.brain.attackFired = false;
      enemy.brain.attackHit = false;
      setPose(enemy, 'position', 0);
      game.player.root.position.set(0, 0, 9.2);
      const towardPlayer = game.player.root.position.clone().sub(enemy.root.position).setY(0).normalize();
      enemy._beginTelegraph(game, towardPlayer);
      const telegraphMarkerRadius = enemy.brain.telegraphMarker?.geometry?.parameters?.outerRadius ?? 0;
      const targetTravel = Math.hypot(
        enemy.brain.targetPosition.x - enemy.root.position.x,
        enemy.brain.targetPosition.z - enemy.root.position.z,
      );
      const configuredJumpHeight = enemy.brain.pounceJumpHeight;

      enemy.brain.state = 'commit';
      enemy.brain.stateTime = 0;
      enemy.brain.commitStart.copy(enemy.root.position);
      // Keep this geometry/trajectory audit from damaging the staged player.
      enemy.brain.attackHit = true;
      const start = enemy.root.position.clone();
      const explosionCalls = [];
      const originalAddExplosion = game.addExplosion;
      game.addExplosion = (position, damage, radius, color, options) => {
        explosionCalls.push({ position: position.clone(), damage, radius, color, options });
      };
      const duration = enemy._getStateDuration('commit');
      enemy._updateCommitState(duration * 0.5, game);
      const apexRise = enemy.root.position.y - start.y;
      enemy._animateVisual(0.016);
      const activeFlamesAtApex = enemy.visual.weapon.launchLegFlames?.filter(flameIsActive).length ?? 0;
      enemy._updateCommitState(duration * 0.51, game);
      game.addExplosion = originalAddExplosion;
      enemy._removeTelegraphMarker();
      return {
        configuredJumpHeight,
        telegraphMarkerRadius,
        targetTravel,
        apexRise,
        activeFlamesAtApex,
        landingRadius: explosionCalls[0]?.radius ?? 0,
        explosionCount: explosionCalls.length,
      };
    };

    const ordinaryPounce = exercisePounce(ordinaryPouncer);
    const launchPounce = exercisePounce(launchLeg);
    for (const [key, value] of Object.entries(originals)) dungeon[key] = value;

    const identities = launchLegs.map((enemy) => ({
      bodyPlan: enemy.genome.body.planId,
      mobilityId: enemy.genome.body.mobilityId,
      mobilityLabel: enemy.genome.body.mobilityLabel,
      mobilityLegCount: enemy.genome.body.mobilityLegCount,
      movementModel: enemy.genome.body.movementModel,
      weaponId: enemy.genome.modules.weapon.id,
      weaponLabel: enemy.genome.modules.weapon.label,
      attackKind: enemy.genome.modules.weapon.attackKind,
      mountSide: Math.sign(enemy.genome.modules.weapon.mountSide),
      visualMountSide: Math.sign(enemy.visual.weapon.launchLegMountSide),
      integratedIntoMobility: enemy.genome.modules.weapon.integratedIntoMobility === true,
      mountRole: enemy.genome.modules.weapon.mountRole,
    }));

    // Stage both deterministic mirror outcomes: one compressed before launch,
    // the other firing both upper-leg rockets in the committed pose.
    const stageStates = [['telegraph', 0.88], ['commit', 0.48]];
    launchLegs.forEach((enemy, index) => {
      enemy._removeTelegraphMarker();
      enemy.root.position.set(index === 0 ? -3.15 : 3.15, index === 0 ? 0 : 0.65, 0);
      enemy.root.rotation.set(0, index === 0 ? -0.32 : 2.42, 0);
      setPose(enemy, stageStates[index][0], stageStates[index][1]);
    });
    ordinaryPouncer.root.visible = false;
    const stagedRoots = launchLegs.map((enemy) => enemy.root);
    const belongsToStage = (object) => stagedRoots.some((root) => within(object, root));
    game.scene.traverse((object) => {
      if (object.isMesh && !belongsToStage(object)) object.visible = false;
    });
    game.player.root.visible = false;
    const uiRoot = document.getElementById('ui-root');
    if (uiRoot) uiRoot.style.display = 'none';
    game.scene.fog = null;
    game.scene.background?.set?.(0x10151d);
    const stageBounds = new Box3();
    for (const root of stagedRoots) stageBounds.expandByObject(root);
    const stageCenter = stageBounds.getCenter(new Vector3());
    const stageSize = stageBounds.getSize(new Vector3());
    game.camera.position.set(
      stageCenter.x,
      stageCenter.y + stageSize.y * 0.08,
      stageCenter.z + Math.max(7.4, stageSize.y * 1.8, stageSize.x * 0.95),
    );
    game.camera.lookAt(stageCenter);
    game.camera.updateMatrixWorld(true);
    for (const root of stagedRoots) root.updateMatrixWorld(true);
    game.renderer.setAnimationLoop(() => game.renderer.render(game.scene, game.camera));

    return {
      identities,
      rig,
      clawCount: weapon.launchLegClaws.length,
      boosterCount: weapon.launchLegBoosters.length,
      flameCount: weapon.launchLegFlames.length,
      geometry,
      idle,
      telegraph,
      telegraphHingeChange,
      commit,
      ordinaryPounce,
      launchPounce,
    };
  });

  for (const identity of result.identities) {
    expect(identity).toMatchObject({
      bodyPlan: 'hopper',
      mobilityId: 'launchLeg',
      mobilityLabel: 'Launch Leg',
      mobilityLegCount: 1,
      movementModel: 'springBounce',
      weaponId: 'launchLeg',
      weaponLabel: 'Launch Leg',
      attackKind: 'pounce',
      integratedIntoMobility: true,
      mountRole: 'locomotion',
    });
    expect(identity.visualMountSide).toBe(identity.mountSide);
  }
  expect(result.identities.map((identity) => identity.mountSide).sort()).toEqual([-1, 1]);

  expect(result.rig).toMatchObject({
    articulated: true,
    segmentCount: 3,
    authoredLength: 4.35,
    rocketAssisted: true,
    boosterCount: 2,
    clawCount: 3,
  });
  expect(result.clawCount).toBeGreaterThanOrEqual(3);
  expect(result.boosterCount).toBe(2);
  expect(result.flameCount).toBe(2);
  expect(result.geometry.articulatedHierarchy).toBe(true);
  expect(result.geometry.boostersUpperMounted).toBe(true);
  expect(result.geometry.flamesAttachedToBoosters).toBe(true);
  expect(result.geometry.authoredJointSpan).toBeGreaterThan(3.8);
  expect(result.geometry.assemblyLongest).toBeGreaterThan(3.4);
  expect(result.geometry.assemblyLongest).toBeGreaterThan(result.geometry.bodyLongest * 1.7);
  expect(Math.min(...result.geometry.boosterHeights)).toBeGreaterThan(result.geometry.kneeHeight);

  expect(result.idle.activeFlames).toBe(0);
  expect(result.telegraph.hipToFoot).toBeLessThan(result.idle.hipToFoot - 0.35);
  expect(result.telegraphHingeChange).toBeGreaterThan(0.75);
  expect(result.commit.activeFlames).toBe(2);

  expect(result.ordinaryPounce.configuredJumpHeight).toBeCloseTo(2.5, 5);
  expect(result.launchPounce.configuredJumpHeight).toBeCloseTo(4.4, 5);
  expect(result.launchPounce.apexRise).toBeGreaterThan(result.ordinaryPounce.apexRise + 1.2);
  expect(result.launchPounce.targetTravel).toBeGreaterThan(result.ordinaryPounce.targetTravel + 0.7);
  expect(result.launchPounce.telegraphMarkerRadius).toBeCloseTo(3.15, 5);
  expect(result.launchPounce.telegraphMarkerRadius)
    .toBeGreaterThan(result.ordinaryPounce.telegraphMarkerRadius + 0.5);
  expect(result.launchPounce.explosionCount).toBe(1);
  expect(result.launchPounce.landingRadius).toBeCloseTo(3.15, 5);
  expect(result.launchPounce.activeFlamesAtApex).toBe(2);

  await page.screenshot({
    path: testInfo.outputPath('reaverbot-launch-leg-mirrored-pounce.png'),
    fullPage: false,
  });
});
