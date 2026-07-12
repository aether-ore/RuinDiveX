import { expect, test } from '@playwright/test';

async function prepareSharukurusu(page, { two = false } = {}) {
  await page.goto('/?reaverbotSeed=sharukurusu-runtime');
  await page.waitForFunction(() => Boolean(window.game && window.spawnCuratedReaverbot));
  await page.evaluate(({ twoInstances }) => {
    const { game } = window;
    game.stop();
    for (const enemy of [...game.enemies]) {
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;
    const Vector3 = game.player.root.position.constructor;
    game.player.root.position.set(0, 0, 0);
    const first = game.spawner.spawnEnemy('sharukurusu', false, new Vector3(0, 0, -6), {
      allowRandomElite: false,
    });
    const second = twoInstances
      ? game.spawner.spawnEnemy('legacy:sharukurusu', false, new Vector3(5, 0, -6), {
        allowRandomElite: false,
      })
      : null;
    window.__sharukurusuQA = { first, second };
  }, { twoInstances: two });
  await page.waitForFunction(({ requireSecond }) => {
    const qa = window.__sharukurusuQA;
    return Boolean(
      qa?.first?.sharukurusuRig?.ready
      && qa.first.externalModelVisual
      && (!requireSecond || (qa.second?.sharukurusuRig?.ready && qa.second.externalModelVisual)),
    );
  }, { requireSecond: two });
}

test('Sharukurusu loads its authored texture and independent eleven-joint rig', async ({ page }) => {
  await prepareSharukurusu(page, { two: true });

  const result = await page.evaluate(async () => {
    const { Box3, Vector3, SRGBColorSpace } = await import('three');
    const { first, second } = window.__sharukurusuQA;
    const rig = first.sharukurusuRig;
    const semanticParts = [
      'abdomen',
      'leftThigh', 'leftShin', 'leftFoot',
      'rightThigh', 'rightShin', 'rightFoot',
      'leftUpperArm', 'leftDrill',
      'rightUpperArm', 'rightDrill',
    ];
    const meshes = [];
    first.externalModelVisual.traverse((object) => {
      if (object.isMesh) meshes.push(object);
    });
    const textureSources = meshes.flatMap((mesh) => (
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        .map((material) => material?.map?.source?.data?.currentSrc
          ?? material?.map?.source?.data?.src
          ?? '')
        .filter(Boolean)
    ));
    const texturesUseSrgb = meshes.every((mesh) => (
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        .filter((material) => material?.map)
        .every((material) => material.map.colorSpace === SRGBColorSpace)
    ));
    const standardMaterials = meshes.every((mesh) => (
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        .every((material) => material?.isMeshStandardMaterial)
    ));
    const bounds = new Box3().setFromObject(first.externalModelVisual);
    const size = bounds.getSize(new Vector3());
    const flipPivot = first.sharukurusuFlipPivot;
    flipPivot.rotation.x = Math.PI;
    first.root.updateMatrixWorld(true);
    const invertedBounds = new Box3().setFromObject(first.externalModelVisual);
    const invertedFloorOffset = invertedBounds.min.y - first.root.position.y;
    flipPivot.rotation.x = 0;
    first.root.updateMatrixWorld(true);
    const firstArmBefore = first.sharukurusuRig.leftUpperArm.quaternion.clone();
    const secondArmBefore = second.sharukurusuRig.leftUpperArm.quaternion.clone();
    first.sharukurusuRig.leftUpperArm.rotation.x += 0.42;
    const firstArmMoved = first.sharukurusuRig.leftUpperArm.quaternion.angleTo(firstArmBefore);
    const secondArmMoved = second.sharukurusuRig.leftUpperArm.quaternion.angleTo(secondArmBefore);
    const firstMaterial = meshes.find((mesh) => mesh.material)?.material;
    const secondMesh = [];
    second.externalModelVisual.traverse((object) => {
      if (object.isMesh && object.material) secondMesh.push(object);
    });
    const elbow = new Vector3();
    const drillTip = new Vector3();
    rig.leftDrill.getWorldPosition(elbow);
    rig.leftDrillTip.getWorldPosition(drillTip);
    const limbHitPoint = elbow.clone().lerp(drillTip, 0.9);
    const projectileLimbHit = first.resolveProjectileHit(limbHitPoint, 0.04);
    const lineStart = limbHitPoint.clone().add(new Vector3(0, 0, 2));
    const lineDirection = limbHitPoint.clone().sub(lineStart).normalize();
    const lineLimbHit = first.resolveLineHit(lineStart, lineDirection, 4, 0.04);
    const drillAxis = drillTip.clone().sub(elbow).normalize();
    const capsuleOffset = drillAxis.clone().cross(new Vector3(1, 0, 0));
    if (capsuleOffset.lengthSq() < 0.001) capsuleOffset.set(0, 0, 1);
    capsuleOffset.normalize();
    const capsuleLineDirection = drillAxis.clone().cross(capsuleOffset).normalize();
    const capsuleGrazingPoint = elbow.clone().lerp(drillTip, 0.75)
      .addScaledVector(capsuleOffset, 0.337);
    const capsuleLineStart = capsuleGrazingPoint.clone().addScaledVector(capsuleLineDirection, -1);
    const continuousCapsuleLineHit = first.resolveLineHit(
      capsuleLineStart,
      capsuleLineDirection,
      2,
      0.005,
    );

    return {
      typeKey: first.typeKey,
      modelAsset: first.type.modelAsset,
      semanticPartsPresent: semanticParts.every((name) => Boolean(rig[name])),
      skinnedMeshCount: rig.skinnedMeshes.length,
      skeletonBoneCount: rig.skinnedMeshes[0]?.skeleton?.bones?.length ?? 0,
      vertexCount: meshes.reduce((sum, mesh) => sum + (mesh.geometry.attributes.position?.count ?? 0), 0),
      textureSources,
      texturesUseSrgb,
      standardMaterials,
      centeredFlipPivot: flipPivot.name === 'sharukurusuFlipPivot',
      invertedFloorOffset,
      fittedHeight: size.y,
      targetHeight: first.type.modelHeight,
      floorAligned: Math.abs(bounds.min.y - first.root.position.y) < 0.02,
      proceduralHidden: [
        first.humanoid.bodyGroup,
        first.humanoid.headGroup,
        first.humanoid.armorGroup,
        first.humanoid.equipmentGroup,
      ].every((group) => group.visible === false),
      correctHierarchy: rig.leftDrill.parent === rig.leftUpperArm
        && rig.rightDrill.parent === rig.rightUpperArm
        && rig.leftShin.parent === rig.leftThigh
        && rig.leftFoot.parent === rig.leftShin
        && rig.rightShin.parent === rig.rightThigh
        && rig.rightFoot.parent === rig.rightShin,
      firstArmMoved,
      secondArmMoved,
      independentBones: first.sharukurusuRig.leftUpperArm !== second.sharukurusuRig.leftUpperArm,
      independentMaterials: firstMaterial !== secondMesh[0]?.material,
      projectileLimbHit: projectileLimbHit?.hitPartId ?? null,
      lineLimbHit: lineLimbHit?.hitPartId ?? null,
      continuousCapsuleLineHit: continuousCapsuleLineHit?.hitPartId ?? null,
    };
  });

  expect(result.typeKey).toBe('sharukurusu');
  expect(result.modelAsset).toBe('sharukurusu');
  expect(result.semanticPartsPresent).toBe(true);
  expect(result.skinnedMeshCount).toBeGreaterThan(0);
  expect(result.skeletonBoneCount).toBe(11);
  expect(result.vertexCount).toBeGreaterThan(250);
  expect(result.textureSources.some((source) => source.endsWith('/assets/models/reaverbots/Sharukurusu.png'))).toBe(true);
  expect(result.texturesUseSrgb).toBe(true);
  expect(result.standardMaterials).toBe(true);
  expect(result.centeredFlipPivot).toBe(true);
  expect(result.invertedFloorOffset).toBeGreaterThan(-0.02);
  expect(result.fittedHeight).toBeCloseTo(result.targetHeight, 2);
  expect(result.floorAligned).toBe(true);
  expect(result.proceduralHidden).toBe(true);
  expect(result.correctHierarchy).toBe(true);
  expect(result.firstArmMoved).toBeGreaterThan(0.4);
  expect(result.secondArmMoved).toBeLessThan(0.000001);
  expect(result.independentBones).toBe(true);
  expect(result.independentMaterials).toBe(true);
  expect(result.projectileLimbHit).toBe('leftDrill');
  expect(['leftDrill', 'leftUpperArm']).toContain(result.lineLimbHit);
  expect(result.continuousCapsuleLineHit).toBe('leftDrill');
});

test('generated keycard encounter preserves Sharukurusu elite and authored-asset contracts', async ({ page }) => {
  await page.goto('/?reaverbotSeed=sharukurusu-encounter');
  await page.waitForFunction(() => Boolean(window.game?.spawner && window.game?.dungeonController));
  await page.evaluate(async () => {
    const { game } = window;
    const { DungeonGenerator } = await import('./src/DungeonGenerator.js');
    game.stop();
    for (const enemy of [...game.enemies]) {
      enemy.dispose?.();
      enemy.root.removeFromParent();
    }
    game.enemies.length = 0;
    const encounter = game.dungeonController.encounters.find((candidate) => !candidate.isBoss);
    encounter.spawned = false;
    encounter.cleared = false;
    encounter.enemyIds = [];
    const rosterGenerator = new DungeonGenerator({ random: () => 0.999999 });
    const generatedRoster = rosterGenerator._createEncounterRoster('server');
    encounter.roster = generatedRoster;
    encounter.keycardDropId = 'sharukurusu-qa-keycard';
    const enemies = game.spawner.spawnEncounter(encounter);
    window.__sharukurusuEncounterQA = { encounter, enemy: enemies[0], generatedRoster };
  });
  await page.waitForFunction(() => (
    window.__sharukurusuEncounterQA?.enemy?.sharukurusuRig?.ready
  ));

  const result = await page.evaluate(() => {
    const { encounter, enemy, generatedRoster } = window.__sharukurusuEncounterQA;
    const externalMesh = [];
    enemy.externalModelVisual.traverse((object) => {
      if (object.isMesh && object.material) externalMesh.push(object);
    });
    const externalMaterial = externalMesh[0].material;
    const sharedTexture = externalMaterial.map;
    const sharedGeometry = externalMesh[0].geometry;
    const aura = enemy.root.getObjectByName('eliteAuraRing');
    const proceduralMesh = [];
    enemy.humanoid.bodyGroup.traverse((object) => {
      if (object.isMesh && object.geometry) proceduralMesh.push(object);
    });
    const healthBarMesh = enemy.healthBar.children.find((object) => object.isMesh);
    let externalMaterialDisposed = false;
    let sharedTextureDisposed = false;
    let sharedGeometryDisposed = false;
    let skeletonDisposed = false;
    let auraGeometryDisposed = false;
    let auraMaterialDisposed = false;
    let proceduralGeometryDisposed = false;
    let healthBarGeometryDisposed = false;
    externalMaterial.addEventListener('dispose', () => { externalMaterialDisposed = true; });
    sharedTexture?.addEventListener('dispose', () => { sharedTextureDisposed = true; });
    sharedGeometry.addEventListener('dispose', () => { sharedGeometryDisposed = true; });
    const skeleton = externalMesh.find((mesh) => mesh.isSkinnedMesh)?.skeleton;
    const originalSkeletonDispose = skeleton.dispose.bind(skeleton);
    skeleton.dispose = () => {
      skeletonDisposed = true;
      originalSkeletonDispose();
    };
    aura.geometry.addEventListener('dispose', () => { auraGeometryDisposed = true; });
    aura.material.addEventListener('dispose', () => { auraMaterialDisposed = true; });
    proceduralMesh[0].geometry.addEventListener('dispose', () => { proceduralGeometryDisposed = true; });
    healthBarMesh.geometry.addEventListener('dispose', () => { healthBarGeometryDisposed = true; });
    const originalAerialPathClear = window.game.dungeonController.isAerialPathClear;
    let eliteAirborneRadius = 0;
    window.game.dungeonController.isAerialPathClear = (from, to, options = {}) => {
      eliteAirborneRadius = options.radius ?? 0;
      return true;
    };
    enemy._isSharukurusuAirborneStepClear(
      window.game,
      enemy.root.position.clone().add({ x: 0, y: 0.1, z: 0.1 }),
    );
    window.game.dungeonController.isAerialPathClear = originalAerialPathClear;
    const summary = {
      encounterSpawned: encounter.spawned,
      encounterOwnsEnemy: encounter.enemyIds.includes(enemy.id),
      typeKey: enemy.typeKey,
      isElite: enemy.isElite,
      affixId: enemy.affix?.id ?? null,
      eliteScale: enemy.root.scale.x,
      maxHealth: enemy.stats.maxHealth,
      baseHealth: enemy.type.maxHealth,
      hasAura: Boolean(enemy.root.getObjectByName('eliteAuraRing')),
      keycardDropId: enemy.guaranteedKeycardDropId,
      isKeyHoldingElite: enemy.isKeyHoldingElite,
      authoredRigReady: enemy.sharukurusuRig.ready,
      generatedRoster,
      eliteAirborneRadius,
    };
    enemy.dispose();
    return {
      ...summary,
      externalMaterialDisposed,
      sharedTextureDisposed,
      sharedGeometryDisposed,
      skeletonDisposed,
      auraGeometryDisposed,
      auraMaterialDisposed,
      proceduralGeometryDisposed,
      healthBarGeometryDisposed,
    };
  });

  expect(result).toMatchObject({
    encounterSpawned: true,
    encounterOwnsEnemy: true,
    typeKey: 'sharukurusu',
    isElite: true,
    hasAura: true,
    keycardDropId: 'sharukurusu-qa-keycard',
    isKeyHoldingElite: true,
    authoredRigReady: true,
    generatedRoster: ['legacy:sharukurusu', 'fast', 'ranged', 'basic'],
    externalMaterialDisposed: true,
    sharedTextureDisposed: false,
    sharedGeometryDisposed: false,
    skeletonDisposed: true,
    auraGeometryDisposed: true,
    auraMaterialDisposed: true,
    proceduralGeometryDisposed: true,
    healthBarGeometryDisposed: true,
  });
  expect(result.affixId).toBeTruthy();
  expect(result.eliteScale).toBeCloseTo(0.9 * 1.16, 4);
  expect(result.maxHealth).toBeGreaterThan(result.baseHealth * 2);
  expect(result.eliteAirborneRadius).toBeGreaterThan(1.5);
});

test('Sharukurusu sprints, spins both drill arms, charges once, and backflips away', async ({ page }) => {
  await prepareSharukurusu(page);

  const result = await page.evaluate(() => {
    const { game } = window;
    const enemy = window.__sharukurusuQA.first;
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    const controller = game.dungeonController;
    const originals = {
      isPositionWalkable: controller.isPositionWalkable,
      getSurfaceElevationAt: controller.getSurfaceElevationAt,
      getEnemyNavigationDirection: controller.getEnemyNavigationDirection,
      isAerialPathClear: controller.isAerialPathClear,
      isPlayerInSafeZone: controller.isPlayerInSafeZone,
      takeDamage: player.takeDamage,
    };
    const hits = [];
    try {
      controller.isPositionWalkable = () => true;
      controller.getSurfaceElevationAt = () => 0;
      controller.getEnemyNavigationDirection = (candidate, target) => (
        target.clone().sub(candidate.root.position).setY(0).normalize()
      );
      controller.isAerialPathClear = () => true;
      controller.isPlayerInSafeZone = () => false;
      player.root.position.set(0, 0, 0);
      player.takeDamage = (amount, source, context = {}) => {
        hits.push({ amount, sourceId: source?.id, context: { ...context } });
        return amount;
      };

      enemy.root.position.set(0, 0, -6);
      enemy.attackCooldown = 99;
      const runStart = enemy.root.position.clone();
      enemy._setSharukurusuState('ninjaRun');
      enemy.sharukurusuState.runPhase = 0;
      enemy.update(0.16, game);
      const runTravel = enemy.root.position.distanceTo(runStart);
      const runRootGrounded = Math.abs(enemy.root.position.y) < 0.00001;
      const runVisualHop = enemy.externalModelGroup.position.y - enemy.externalModelBaseY;
      const leftRunSwing = enemy.sharukurusuRig.leftThigh.rotation.x
        - enemy.sharukurusuRig.leftThigh.userData.sharukurusuBaseRotation.x;
      const rightRunSwing = enemy.sharukurusuRig.rightThigh.rotation.x
        - enemy.sharukurusuRig.rightThigh.userData.sharukurusuBaseRotation.x;

      enemy.root.position.set(0, 0, -6);
      const chargeStart = enemy.root.position.clone();
      const leftPrevious = enemy.sharukurusuRig.leftDrill.quaternion.clone();
      const rightPrevious = enemy.sharukurusuRig.rightDrill.quaternion.clone();
      let leftSpin = 0;
      let rightSpin = 0;
      let maximumBackflipY = 0;
      let maximumBackflipRotation = 0;
      let maximumChargeTravel = 0;
      let sawBackflip = false;
      enemy._startSharukurusuCharge(game, new Vector3(0, 0, 1));
      for (let step = 0; step < 110; step += 1) {
        enemy.update(0.025, game);
        maximumChargeTravel = Math.max(
          maximumChargeTravel,
          enemy.root.position.distanceTo(chargeStart),
        );
        leftSpin += leftPrevious.angleTo(enemy.sharukurusuRig.leftDrill.quaternion);
        rightSpin += rightPrevious.angleTo(enemy.sharukurusuRig.rightDrill.quaternion);
        leftPrevious.copy(enemy.sharukurusuRig.leftDrill.quaternion);
        rightPrevious.copy(enemy.sharukurusuRig.rightDrill.quaternion);
        if (enemy.sharukurusuState.mode === 'backflip') {
          sawBackflip = true;
          maximumBackflipY = Math.max(maximumBackflipY, enemy.root.position.y);
          maximumBackflipRotation = Math.max(
            maximumBackflipRotation,
            enemy.sharukurusuState.backflipRotation,
          );
        }
        if (sawBackflip && enemy.sharukurusuState.mode === 'ninjaRun') break;
      }

      const drillTip = new Vector3();
      enemy.sharukurusuRig.leftDrillTip.getWorldPosition(drillTip);
      player.root.position.set(drillTip.x, drillTip.y - 0.2, drillTip.z);
      controller.isAerialPathClear = () => true;
      const clearDrillContact = Boolean(enemy._getSharukurusuDrillContact(game));
      controller.isAerialPathClear = () => false;
      const blockedDrillContact = Boolean(enemy._getSharukurusuDrillContact(game));
      controller.isAerialPathClear = () => true;
      player.root.position.y = drillTip.y + 2;
      const verticallySeparatedDrillContact = Boolean(enemy._getSharukurusuDrillContact(game));
      player.root.position.set(drillTip.x, drillTip.y - 0.2, drillTip.z);
      const bodyAnchor = enemy.root.position.clone();
      bodyAnchor.y += enemy.collisionHeight * 0.45;
      controller.isAerialPathClear = (from) => from.distanceTo(bodyAnchor) > 0.01;
      const disconnectedTipContact = Boolean(enemy._getSharukurusuDrillContact(game));
      controller.isAerialPathClear = () => false;
      const blockedChargeStep = !enemy._isSharukurusuChargeStepClear(
        game,
        enemy.root.position.clone().add(new Vector3(0, 0, 0.25)),
      );
      const originalArena = enemy.encounterArena;
      enemy.encounterArena = {
        center: new Vector3(0, 0, 0),
        zoneCenter: new Vector3(0, 0, 0),
        softHalfWidth: 2,
        softHalfDepth: 2,
      };
      const arenaAcceptsInterior = enemy._isSharukurusuChargeCandidateInsideArena(
        new Vector3(1.99, 0, 0),
      );
      const arenaRejectsDoorwayExit = !enemy._isSharukurusuChargeCandidateInsideArena(
        new Vector3(2.01, 0, 0),
      );
      enemy.encounterArena = originalArena;

      return {
        moveSpeed: enemy.stats.moveSpeed,
        runTravel,
        runRootGrounded,
        runVisualHop,
        opposingLegSwing: leftRunSwing * rightRunSwing < 0,
        chargeTravel: maximumChargeTravel,
        leftSpin,
        rightSpin,
        hitCount: hits.length,
        hit: hits[0] ? {
          attackKind: hits[0].context.attackKind,
          powerfulKnockback: hits[0].context.powerfulKnockback,
          knockbackDirectionLength: hits[0].context.knockbackDirection?.length?.() ?? 0,
        } : null,
        maximumBackflipY,
        maximumBackflipRotation,
        clearDrillContact,
        blockedDrillContact,
        verticallySeparatedDrillContact,
        disconnectedTipContact,
        blockedChargeStep,
        arenaAcceptsInterior,
        arenaRejectsDoorwayExit,
        finalState: enemy.sharukurusuState.mode,
        finalGroundedY: enemy.root.position.y,
      };
    } finally {
      controller.isPositionWalkable = originals.isPositionWalkable;
      controller.getSurfaceElevationAt = originals.getSurfaceElevationAt;
      controller.getEnemyNavigationDirection = originals.getEnemyNavigationDirection;
      controller.isAerialPathClear = originals.isAerialPathClear;
      controller.isPlayerInSafeZone = originals.isPlayerInSafeZone;
      player.takeDamage = originals.takeDamage;
    }
  });

  expect(result.moveSpeed).toBeGreaterThan(5);
  expect(result.runTravel).toBeGreaterThan(0.7);
  expect(result.runRootGrounded).toBe(true);
  expect(result.runVisualHop).toBeGreaterThan(0.05);
  expect(result.opposingLegSwing).toBe(true);
  expect(result.chargeTravel).toBeGreaterThan(4);
  expect(result.leftSpin).toBeGreaterThan(Math.PI * 2);
  expect(result.rightSpin).toBeGreaterThan(Math.PI * 2);
  expect(result.hitCount).toBe(1);
  expect(result.hit).toMatchObject({
    attackKind: 'sharukurusuDrillCharge',
    powerfulKnockback: true,
  });
  expect(result.hit.knockbackDirectionLength).toBeGreaterThan(0.99);
  expect(result.maximumBackflipY).toBeGreaterThan(0.9);
  expect(result.maximumBackflipRotation).toBeGreaterThan(5.5);
  expect(result.clearDrillContact).toBe(true);
  expect(result.blockedDrillContact).toBe(false);
  expect(result.verticallySeparatedDrillContact).toBe(false);
  expect(result.disconnectedTipContact).toBe(false);
  expect(result.blockedChargeStep).toBe(true);
  expect(result.arenaAcceptsInterior).toBe(true);
  expect(result.arenaRejectsDoorwayExit).toBe(true);
  expect(result.finalState).toBe('ninjaRun');
  expect(result.finalGroundedY).toBeCloseTo(0, 4);
});

test('only a projectile during Sharukurusu diving blades knocks it to the floor', async ({ page }) => {
  await prepareSharukurusu(page);

  const result = await page.evaluate(() => {
    const { game } = window;
    const enemy = window.__sharukurusuQA.first;
    const player = game.player;
    const Vector3 = player.root.position.constructor;
    const controller = game.dungeonController;
    const originals = {
      isPositionWalkable: controller.isPositionWalkable,
      getSurfaceElevationAt: controller.getSurfaceElevationAt,
      findNearestEnemyClearPosition: controller.findNearestEnemyClearPosition,
      isAerialPathClear: controller.isAerialPathClear,
      isPlayerInSafeZone: controller.isPlayerInSafeZone,
    };
    try {
      controller.isPositionWalkable = () => true;
      controller.getSurfaceElevationAt = () => 3;
      controller.findNearestEnemyClearPosition = (candidate, target) => target.clone().setY(3);
      controller.isAerialPathClear = () => true;
      controller.isPlayerInSafeZone = () => false;
      player.root.position.set(0, 3, 2);
      enemy.root.position.set(0, 3, -4);
      enemy.attackCooldown = 99;

      enemy._setSharukurusuState('ninjaRun');
      enemy.takeDamage(1, {
        source: player,
        projectileHit: true,
        knockbackDirection: new Vector3(1, 0, 0),
      });
      const idleProjectileState = enemy.sharukurusuState.mode;

      enemy._startSharukurusuDive(game, new Vector3(0, 0, 1));
      const windupTimerBeforeHitStopUpdate = enemy.sharukurusuState.timer;
      enemy.update(0.05, game);
      const windupTimerFrozenByHitStop = enemy.sharukurusuState.timer
        === windupTimerBeforeHitStopUpdate;
      for (let step = 0; step < 20 && enemy.sharukurusuState.mode !== 'diveAirborne'; step += 1) {
        enemy.update(0.05, game);
      }
      enemy.update(0.12, game);
      const airborneBeforeHit = enemy.sharukurusuState.mode === 'diveAirborne'
        && enemy.root.position.y > 3.2
        && enemy.shouldIgnoreGroundConstraint();
      const interruptionMeta = {
        source: player,
        projectileHit: true,
        knockbackDirection: new Vector3(-1, 0, 0),
      };
      enemy.takeDamage(2, interruptionMeta);
      const knockedDownState = enemy.sharukurusuState.mode;
      const knockedDownY = enemy.root.position.y;
      const knockbackCleared = enemy.knockback.lengthSq() < 0.000001;
      const interruptionCount = enemy.sharukurusuDiveInterruptions;
      const downTimerBeforeRepeat = enemy.sharukurusuState.timer;
      enemy.takeDamage(1, {
        source: player,
        projectileHit: true,
        knockbackDirection: new Vector3(1, 0, 0),
      });
      const repeatedShotStable = enemy.sharukurusuState.mode === 'knockedDown'
        && enemy.sharukurusuState.timer === downTimerBeforeRepeat
        && enemy.root.position.y === knockedDownY;

      let maximumRecoveryY = enemy.root.position.y;
      let maximumRecoveryRotation = 0;
      for (let step = 0; step < 100 && enemy.sharukurusuState.mode !== 'ninjaRun'; step += 1) {
        enemy.update(0.03, game);
        maximumRecoveryY = Math.max(maximumRecoveryY, enemy.root.position.y);
        maximumRecoveryRotation = Math.max(
          maximumRecoveryRotation,
          enemy.sharukurusuState.backflipRotation,
        );
      }

      enemy._startSharukurusuDive(game, new Vector3(0, 0, 1));
      for (let step = 0; step < 20 && enemy.sharukurusuState.mode !== 'diveAirborne'; step += 1) {
        enemy.update(0.05, game);
      }
      const stateBeforeNonProjectile = enemy.sharukurusuState.mode;
      enemy.takeDamage(1, {
        source: player,
        projectileHit: false,
        attackKind: 'explosion',
      });
      const stateAfterNonProjectile = enemy.sharukurusuState.mode;

      enemy.root.position.set(0, 3, -4);
      enemy._setSharukurusuState('ninjaRun');
      enemy.hitStopTimer = 0;
      enemy._startSharukurusuDive(game, new Vector3(0, 0, 1));
      for (let step = 0; step < 20 && enemy.sharukurusuState.mode !== 'diveAirborne'; step += 1) {
        enemy.update(0.05, game);
      }
      controller.isAerialPathClear = () => false;
      enemy.update(0.05, game);
      const blockedDiveState = enemy.sharukurusuState.mode;
      const blockedDiveStayedOnSafeSide = enemy.root.position.z <= -3.99;
      const blockedDiveGrounded = Math.abs(enemy.root.position.y - 3) < 0.00001;

      return {
        idleProjectileState,
        windupTimerFrozenByHitStop,
        airborneBeforeHit,
        interruptedFlag: interruptionMeta.sharukurusuDiveInterrupted === true,
        knockedDownState,
        knockedDownY,
        knockbackCleared,
        interruptionCount,
        repeatedShotStable,
        maximumRecoveryY,
        maximumRecoveryRotation,
        recoveredState: stateBeforeNonProjectile === 'diveAirborne'
          ? stateAfterNonProjectile
          : stateBeforeNonProjectile,
        blockedDiveState,
        blockedDiveStayedOnSafeSide,
        blockedDiveGrounded,
      };
    } finally {
      controller.isPositionWalkable = originals.isPositionWalkable;
      controller.getSurfaceElevationAt = originals.getSurfaceElevationAt;
      controller.findNearestEnemyClearPosition = originals.findNearestEnemyClearPosition;
      controller.isAerialPathClear = originals.isAerialPathClear;
      controller.isPlayerInSafeZone = originals.isPlayerInSafeZone;
    }
  });

  expect(result.idleProjectileState).toBe('ninjaRun');
  expect(result.windupTimerFrozenByHitStop).toBe(true);
  expect(result.airborneBeforeHit).toBe(true);
  expect(result.interruptedFlag).toBe(true);
  expect(result.knockedDownState).toBe('knockedDown');
  expect(result.knockedDownY).toBeCloseTo(3, 5);
  expect(result.knockbackCleared).toBe(true);
  expect(result.interruptionCount).toBe(1);
  expect(result.repeatedShotStable).toBe(true);
  expect(result.maximumRecoveryY).toBeGreaterThan(3.8);
  expect(result.maximumRecoveryRotation).toBeGreaterThan(5.5);
  expect(result.recoveredState).toBe('diveAirborne');
  expect(result.blockedDiveState).toBe('backflip');
  expect(result.blockedDiveStayedOnSafeSide).toBe(true);
  expect(result.blockedDiveGrounded).toBe(true);
});

test('Sharukurusu faces Mega Man and leads a dive with both drill arms', async ({ page }) => {
  await prepareSharukurusu(page);

  const result = await page.evaluate(async () => {
    const { Vector3 } = await import('three');
    const { game } = window;
    const enemy = window.__sharukurusuQA.first;
    const player = game.player;
    const controller = game.dungeonController;
    const originals = {
      getSurfaceElevationAt: controller.getSurfaceElevationAt,
      findNearestEnemyClearPosition: controller.findNearestEnemyClearPosition,
      isAerialPathClear: controller.isAerialPathClear,
      isPlayerInSafeZone: controller.isPlayerInSafeZone,
    };
    try {
      controller.getSurfaceElevationAt = () => 0;
      controller.findNearestEnemyClearPosition = (candidate, target) => target.clone().setY(0);
      controller.isAerialPathClear = () => true;
      controller.isPlayerInSafeZone = () => false;
      enemy.root.position.set(0, 0, -5);
      player.root.position.set(2.4, 0, 4);
      enemy.attackCooldown = 99;
      enemy.hitStopTimer = 0;
      enemy._setSharukurusuState('ninjaRun');

      // Start on a deliberately stale heading. Entering the airborne phase
      // must refresh facing from the resolved target where Mega Man now is.
      enemy._startSharukurusuDive(game, new Vector3(0, 0, 1));
      for (let step = 0; step < 20 && enemy.sharukurusuState.mode !== 'diveAirborne'; step += 1) {
        enemy.update(0.05, game);
      }
      enemy.update(0.08, game);
      enemy._updateExternalModelVisual(0, true);
      enemy.root.updateMatrixWorld(true);

      const movementDirection = enemy.sharukurusuState.targetPosition.clone()
        .sub(enemy.sharukurusuState.startPosition)
        .setY(0)
        .normalize();
      const bodyForward = new Vector3(0, 0, 1)
        .applyQuaternion(enemy.root.quaternion)
        .setY(0)
        .normalize();
      const toPlayer = player.root.position.clone().sub(enemy.root.position).setY(0).normalize();
      const drillAlignment = (upperArm, drillTip) => {
        const shoulder = new Vector3();
        const tip = new Vector3();
        upperArm.getWorldPosition(shoulder);
        drillTip.getWorldPosition(tip);
        return {
          movementDot: tip.clone().sub(shoulder).normalize().dot(movementDirection),
          playerDot: tip.clone().sub(shoulder).normalize().dot(toPlayer),
          forwardReach: tip.clone().sub(enemy.root.position).dot(bodyForward),
        };
      };
      return {
        mode: enemy.sharukurusuState.mode,
        bodyFacesMovement: bodyForward.dot(movementDirection),
        bodyFacesPlayer: bodyForward.dot(toPlayer),
        left: drillAlignment(enemy.sharukurusuRig.leftUpperArm, enemy.sharukurusuRig.leftDrillTip),
        right: drillAlignment(enemy.sharukurusuRig.rightUpperArm, enemy.sharukurusuRig.rightDrillTip),
      };
    } finally {
      controller.getSurfaceElevationAt = originals.getSurfaceElevationAt;
      controller.findNearestEnemyClearPosition = originals.findNearestEnemyClearPosition;
      controller.isAerialPathClear = originals.isAerialPathClear;
      controller.isPlayerInSafeZone = originals.isPlayerInSafeZone;
    }
  });

  expect(result.mode).toBe('diveAirborne');
  expect(result.bodyFacesMovement).toBeGreaterThan(0.98);
  expect(result.bodyFacesPlayer).toBeGreaterThan(0.95);
  expect(result.left.movementDot).toBeGreaterThan(0.9);
  expect(result.right.movementDot).toBeGreaterThan(0.9);
  expect(result.left.playerDot).toBeGreaterThan(0.9);
  expect(result.right.playerDot).toBeGreaterThan(0.9);
  expect(result.left.forwardReach).toBeGreaterThan(1);
  expect(result.right.forwardReach).toBeGreaterThan(1);
});
