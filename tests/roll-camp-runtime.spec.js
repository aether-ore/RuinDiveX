import { expect, test } from '@playwright/test';

const EXPECTED_CLIPS = Object.freeze({
  bashful: 11,
  talking: 10.25,
  thankful: 3,
  thinking: 4.25,
  waving: 3.166666746,
  explaining: 5.916666508,
  happy: 10,
  idle: 16.625,
});

test('Roll owns the camp services, animates contextually, and stays clear of the route', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('/');
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.waitForFunction(() => {
    const dungeonGroup = window.game?.dungeon?.group;
    const state = dungeonGroup?.getObjectByName('rollCaskettNpc')?.userData;
    const supportCarState = dungeonGroup?.getObjectByName('expeditionSupportCar')?.userData;
    const workbenchState = dungeonGroup?.getObjectByName('rollWorkshopWorkbench')?.userData;
    return Boolean(
      (state?.modelLoaded || state?.modelLoadError)
      && (state?.textureLoaded || state?.textureLoadError)
      && (state?.animationAssetsSettled || state?.animationLoadCancelled)
      && (supportCarState?.modelLoaded || supportCarState?.modelLoadError)
      && (
        supportCarState?.textureLoaded
        || supportCarState?.textureLoadError
        || supportCarState?.textureLoadCancelled
      )
      && (workbenchState?.textureAssetsSettled || workbenchState?.textureLoadCancelled)
      && window.game?.player?.externalRig,
    );
  }, null, { timeout: 45_000 });

  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { game } = window;
    game.stop();

    const roll = game.dungeon.group.getObjectByName('rollCaskettNpc');
    const model = game.dungeon.group.getObjectByName('rollCaskettModel');
    const workshop = game.dungeon.group.getObjectByName('rollSupportCampWorkshop');
    const supportCar = game.dungeon.group.getObjectByName('expeditionSupportCar');
    const supportCarModel = game.dungeon.group.getObjectByName('supportCarModel');
    const supportCarMesh = game.dungeon.group.getObjectByName('supportCarMesh');
    const frontDoorMarker = game.dungeon.group.getObjectByName('supportCarFrontDoorMarker');
    const workbench = game.dungeon.group.getObjectByName('rollWorkshopWorkbench');
    const blueprint = game.dungeon.group.getObjectByName('rollWorkbenchBlueprint');
    const tools = game.dungeon.group.getObjectByName('rollWorkshopTools');
    const interaction = game.dungeon.safeInteractables.find(({ id }) => id === 'rollCaskett');
    const animator = roll?.userData?.rollAnimator;
    if (!roll || !model || !interaction || !animator) {
      throw new Error('Roll model, interaction, or animator did not initialize.');
    }
    if (
      !workshop
      || !supportCar
      || !supportCarModel
      || !supportCarMesh
      || !frontDoorMarker
      || !workbench
      || !blueprint
      || !tools
    ) {
      throw new Error('Roll support-car workshop did not initialize completely.');
    }

    const oldNpcNames = [];
    const oldResearchObjectNames = [];
    let meshCount = 0;
    let texturedMeshCount = 0;
    let skinnedMeshCount = 0;

    game.dungeon.group.traverse((object) => {
      if (['hubMechanicNpc', 'expeditionLeaderNpc', 'expeditionResearcherNpc'].includes(object.name)) {
        oldNpcNames.push(object.name);
      }
      if (/research/i.test(object.name)) oldResearchObjectNames.push(object.name);
    });
    model.traverse((object) => {
      if (!object.isMesh && !object.isSkinnedMesh) return;
      meshCount += 1;
      if (object.isSkinnedMesh) skinnedMeshCount += 1;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.length > 0 && materials.every((material) => Boolean(material?.map?.image))) {
        texturedMeshCount += 1;
      }
    });

    const vertex = new THREE.Vector3();
    const measureObjectX = (root) => {
      root.updateMatrixWorld(true);
      root.traverse((object) => object.skeleton?.update?.());
      let minX = Infinity;
      let maxX = -Infinity;
      root.traverse((object) => {
        const positions = object.geometry?.attributes?.position;
        if (!positions) return;
        for (let index = 0; index < positions.count; index += 1) {
          vertex.fromBufferAttribute(positions, index);
          if (object.isSkinnedMesh) object.applyBoneTransform(index, vertex);
          vertex.applyMatrix4(object.matrixWorld);
          minX = Math.min(minX, vertex.x);
          maxX = Math.max(maxX, vertex.x);
        }
      });
      return { minX, maxX };
    };
    const measureModelX = () => measureObjectX(model);

    // Sample every supplied clip across its full pose range. Roll is left of
    // the x-aligned camp route, so the largest model x is its closest extent.
    let minimumAnimatedClearance = Infinity;
    let minimumClearanceClip = null;
    for (const [name, clip] of animator.clips) {
      animator.play(name, { fade: 0 });
      for (let sample = 0; sample < 16; sample += 1) {
        animator.mixer.setTime(clip.duration * (sample / 16));
        const { maxX } = measureModelX();
        const clearance = game.dungeon.campReturnPosition.x - maxX;
        if (clearance < minimumAnimatedClearance) {
          minimumAnimatedClearance = clearance;
          minimumClearanceClip = name;
        }
      }
    }
    animator.play('idle', { fade: 0 });
    const idleBounds = measureModelX();
    const workshopBounds = measureObjectX(workshop);

    supportCarMesh.geometry.computeBoundingBox();
    const sourceCarSize = supportCarMesh.geometry.boundingBox.getSize(new THREE.Vector3());
    const supportCarWorldPosition = supportCar.getWorldPosition(new THREE.Vector3());
    const supportCarWorldBounds = new THREE.Box3().setFromObject(supportCarModel);
    const supportCarMaterial = Array.isArray(supportCarMesh.material)
      ? supportCarMesh.material[0]
      : supportCarMesh.material;
    const supportCarTexture = supportCarMaterial?.map;

    const doorWorldPosition = frontDoorMarker.getWorldPosition(new THREE.Vector3());
    const rollWorldPosition = roll.getWorldPosition(new THREE.Vector3());
    const workbenchWorldPosition = workbench.getWorldPosition(new THREE.Vector3());
    const horizontalDirection = (from, to) => to.clone().sub(from).setY(0);
    const doorToRoll = horizontalDirection(doorWorldPosition, rollWorldPosition);
    const rollToWorkbench = horizontalDirection(rollWorldPosition, workbenchWorldPosition);
    const carWorldQuaternion = supportCar.getWorldQuaternion(new THREE.Quaternion());
    const rollWorldQuaternion = roll.getWorldQuaternion(new THREE.Quaternion());
    const workbenchWorldQuaternion = workbench.getWorldQuaternion(new THREE.Quaternion());
    const carFront = new THREE.Vector3(0, 0, -1).applyQuaternion(carWorldQuaternion).setY(0).normalize();
    const doorOutward = new THREE.Vector3(1, 0, 0).applyQuaternion(carWorldQuaternion).setY(0).normalize();
    const rollForward = new THREE.Vector3(0, 0, 1).applyQuaternion(rollWorldQuaternion).setY(0).normalize();
    const rollToCampInterior = horizontalDirection(
      rollWorldPosition,
      game.dungeon.campReturnPosition,
    ).normalize();
    const workbenchFront = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(workbenchWorldQuaternion)
      .setY(0)
      .normalize();
    const workbenchToRoll = horizontalDirection(workbenchWorldPosition, rollWorldPosition).normalize();

    const toolNames = tools.children.map(({ name }) => name).sort();
    const surfaceTexture = workbench.userData.surfaceMaterial?.map;
    const blueprintMaterial = Array.isArray(blueprint.material)
      ? blueprint.material[0]
      : blueprint.material;
    const blueprintTexture = blueprintMaterial?.map;

    const controller = game.dungeonController;
    const supportCarCollision = game.dungeon.solidZones
      .find(({ id }) => id === 'expeditionSupportCarCollision');
    const workbenchCollision = game.dungeon.solidZones
      .find(({ id }) => id === 'rollWorkshopWorkbenchCollision');
    const workshopCollisionZones = [supportCarCollision, workbenchCollision].filter(Boolean);
    const zoneRouteClearance = (zone) => {
      const padding = zone.playerCollisionPadding ?? 0;
      const projectedHalfWidth = Math.abs(Math.cos(zone.rotationY)) * (zone.halfWidth + padding)
        + Math.abs(Math.sin(zone.rotationY)) * (zone.halfDepth + padding);
      return game.dungeon.campReturnPosition.x - (zone.position.x + projectedHalfWidth);
    };
    const calls = [];
    const original = {
      addParticleBurst: game.addParticleBurst,
      beginExpedition: game.beginExpedition,
      offerRuinReset: game.offerRuinReset,
      setInventoryOpen: game.setInventoryOpen,
      showToast: game.ui.showToast,
      unidentifiedScrap: game.inventory.unidentifiedScrap,
      ruinCompleted: game.ruinCompleted,
      expeditionAccepted: game.expeditionAccepted,
      inventoryOpen: game.inventoryOpen,
    };
    game.addParticleBurst = () => {};
    game.beginExpedition = () => calls.push('briefing');
    game.offerRuinReset = () => calls.push('debrief');
    game.setInventoryOpen = (open, options = {}) => calls.push(
      open && options.mode === 'roll' ? 'workshop' : 'garage',
    );
    game.ui.showToast = () => {};

    const runScenario = ({ unidentified, completed, accepted }) => {
      calls.length = 0;
      game.inventory.unidentifiedScrap = unidentified;
      game.ruinCompleted = completed;
      game.expeditionAccepted = accepted;
      animator.inactivitySeconds = 12;
      const prompt = controller._getSafeInteractablePrompt(interaction);
      controller._activateSafeInteractable(interaction);
      return {
        prompt,
        calls: [...calls],
        animationState: animator.currentName,
        inactivitySeconds: animator.inactivitySeconds,
      };
    };

    const scenarios = {
      debrief: runScenario({ unidentified: 0, completed: true, accepted: true }),
      briefing: runScenario({ unidentified: 3, completed: false, accepted: false }),
      identify: runScenario({ unidentified: 3, completed: false, accepted: true }),
      workshop: runScenario({ unidentified: 0, completed: false, accepted: true }),
    };

    // NPC visuals are updated independently from the gameplay pause gate, so
    // Explaining continues while the garage/inventory overlay is open.
    animator.play('explaining', { fade: 0 });
    game.inventoryOpen = true;
    const explainingTimeBeforePausedUpdate = animator.currentAction.time;
    controller.updateNpcVisuals(0.5, { allowAmbient: false });
    const explainingTimeAfterPausedUpdate = animator.currentAction.time;

    animator.play('explaining', { fade: 0 });
    animator.update(animator.clips.get('explaining').duration + 0.1, { allowAmbient: false });
    const stateAfterExplaining = animator.currentName;

    animator.play('idle', { fade: 0 });
    animator.inactivitySeconds = animator.nextThinkingSeconds - 0.01;
    animator.update(0.02, { allowAmbient: true });
    const stateAfterInactivity = animator.currentName;
    animator.update(animator.clips.get('thinking').duration + 0.1, { allowAmbient: false });
    const stateAfterThinking = animator.currentName;

    Object.assign(game, {
      addParticleBurst: original.addParticleBurst,
      beginExpedition: original.beginExpedition,
      offerRuinReset: original.offerRuinReset,
      setInventoryOpen: original.setInventoryOpen,
      ruinCompleted: original.ruinCompleted,
      expeditionAccepted: original.expeditionAccepted,
      inventoryOpen: original.inventoryOpen,
    });
    game.ui.showToast = original.showToast;
    game.inventory.unidentifiedScrap = original.unidentifiedScrap;

    return {
      loadError: roll.userData.modelLoadError ?? null,
      textureLoaded: roll.userData.textureLoaded === true,
      textureLoadError: roll.userData.textureLoadError ?? null,
      animationLibraryReady: roll.userData.animationLibraryReady === true,
      animationLoadErrors: roll.userData.animationLoadErrors,
      animationAssetsSettled: roll.userData.animationAssetsSettled === true,
      animationState: animator.currentName,
      clipSummaries: animator.getClipSummary().sort((a, b) => a.name.localeCompare(b.name)),
      hasAnimator: Boolean(animator),
      mixerRegistered: game.dungeon.npcAnimationMixers.includes(animator.mixer),
      animatorRegistered: game.dungeon.npcAnimators.includes(animator),
      meshCount,
      texturedMeshCount,
      skinnedMeshCount,
      oldNpcNames,
      oldResearchObjectNames,
      oldNpcInteractionIds: game.dungeon.safeInteractables
        .filter(({ id }) => ['hubMechanic', 'expeditionLeader', 'researchStation'].includes(id))
        .map(({ id }) => id),
      oldResearchInteractions: game.dungeon.safeInteractables
        .filter(({ id, label, action }) => /research/i.test(`${id} ${label} ${action}`))
        .map(({ id }) => id),
      action: interaction.action,
      interactionRadius: interaction.interactionRadius,
      questBoardAction: game.dungeon.safeInteractables.find(({ id }) => id === 'questBoard')?.action,
      routeCenterX: game.dungeon.campReturnPosition.x,
      routeCenterZ: game.dungeon.campReturnPosition.z,
      rollX: interaction.position.x,
      rollTargetModelHeight: roll.userData.targetModelHeight,
      playerModelHeight: game.player.externalRig.modelHeight,
      modelMinX: idleBounds.minX,
      modelMaxX: idleBounds.maxX,
      minimumAnimatedClearance,
      minimumClearanceClip,
      workshopRouteClearance: game.dungeon.campReturnPosition.x - workshopBounds.maxX,
      supportCar: {
        modelLoaded: supportCar.userData.modelLoaded === true,
        modelLoadError: supportCar.userData.modelLoadError ?? null,
        textureLoaded: supportCar.userData.textureLoaded === true,
        textureLoadError: supportCar.userData.textureLoadError ?? null,
        usingFallback: supportCar.userData.usingFallback,
        targetModelHeight: supportCar.userData.targetModelHeight,
        modelHeight: supportCar.userData.modelHeight,
        modelScale: supportCar.userData.modelScale,
        worldHeight: supportCarWorldBounds.max.y - supportCarWorldBounds.min.y,
        groundOffset: supportCarWorldBounds.min.y - supportCarWorldPosition.y,
        frontAxis: supportCar.userData.frontAxis,
        frontDoorSide: supportCar.userData.frontDoorSide,
        sourceSize: sourceCarSize.toArray(),
        vertexCount: supportCarMesh.geometry.attributes.position.count,
        triangleCount: supportCarMesh.geometry.index
          ? supportCarMesh.geometry.index.count / 3
          : supportCarMesh.geometry.attributes.position.count / 3,
        meshName: supportCarMesh.name,
        meshCastsShadow: supportCarMesh.castShadow,
        meshReceivesShadow: supportCarMesh.receiveShadow,
        materialName: supportCarMaterial?.name,
        materialRoughness: supportCarMaterial?.roughness,
        materialMetalness: supportCarMaterial?.metalness,
        materialAlphaTest: supportCarMaterial?.alphaTest,
        materialTransparent: supportCarMaterial?.transparent,
        materialDepthWrite: supportCarMaterial?.depthWrite,
        materialFrontSide: supportCarMaterial?.side === THREE.FrontSide,
        textureName: supportCarTexture?.name,
        textureWidth: supportCar.userData.textureWidth,
        textureHeight: supportCar.userData.textureHeight,
        textureSrgb: supportCarTexture?.colorSpace === THREE.SRGBColorSpace,
        textureNearestMagnification: supportCarTexture?.magFilter === THREE.NearestFilter,
        textureNearestMipmapMinification:
          supportCarTexture?.minFilter === THREE.NearestMipmapNearestFilter,
        textureMipmaps: supportCarTexture?.generateMipmaps,
      },
      workshop: {
        localPosition: workshop.position.toArray(),
        yaw: workshop.rotation.y,
        carRelativeToRoute: [
          supportCarWorldPosition.x - game.dungeon.campReturnPosition.x,
          supportCarWorldPosition.z - game.dungeon.campReturnPosition.z,
        ],
        carFront: carFront.toArray(),
        frontDoorLocalPosition: frontDoorMarker.position.toArray(),
        rollLocalPosition: roll.position.toArray(),
        workbenchLocalPosition: workbench.position.toArray(),
        doorToRollDistance: doorToRoll.length(),
        rollToWorkbenchDistance: rollToWorkbench.length(),
        alignmentDot: doorToRoll.clone().normalize().dot(rollToWorkbench.clone().normalize()),
        doorOutwardDot: doorOutward.dot(doorToRoll.clone().normalize()),
        rollFacingWorkbenchDot: rollForward.dot(rollToWorkbench.clone().normalize()),
        rollFacingCampInteriorDot: rollForward.dot(rollToCampInterior),
        workbenchFacingRollDot: workbenchFront.dot(workbenchToRoll),
      },
      workbench: {
        textureAssetsSettled: workbench.userData.textureAssetsSettled === true,
        textureLoaded: workbench.userData.textureLoaded === true,
        textureLoadErrors: workbench.userData.textureLoadErrors,
        surfaceTextureLoaded: workbench.userData.surfaceTextureLoaded === true,
        blueprintTextureLoaded: workbench.userData.blueprintTextureLoaded === true,
        surfaceTextureSize: [
          workbench.userData.surfaceTextureWidth,
          workbench.userData.surfaceTextureHeight,
        ],
        blueprintTextureSize: [
          workbench.userData.blueprintTextureWidth,
          workbench.userData.blueprintTextureHeight,
        ],
        surfaceMaterialName: workbench.userData.surfaceMaterial?.name,
        blueprintMaterialName: blueprintMaterial?.name,
        surfaceTextureName: surfaceTexture?.name,
        blueprintTextureName: blueprintTexture?.name,
        surfaceTextureSrgb: surfaceTexture?.colorSpace === THREE.SRGBColorSpace,
        blueprintTextureSrgb: blueprintTexture?.colorSpace === THREE.SRGBColorSpace,
        surfaceTextureRepeat: surfaceTexture?.repeat.toArray(),
        blueprintDoubleSided: blueprintMaterial?.side === THREE.DoubleSide,
        blueprintName: blueprint.name,
        blueprintCastsShadow: blueprint.castShadow,
        toolsName: tools.name,
        toolNames,
      },
      collision: {
        ids: workshopCollisionZones.map(({ id }) => id).sort(),
        registeredInController: workshopCollisionZones.length === 2
          && workshopCollisionZones.every((zone) => controller.solidZones.includes(zone)),
        supportCar: supportCarCollision && {
          roomId: supportCarCollision.roomId,
          halfWidth: supportCarCollision.halfWidth,
          halfDepth: supportCarCollision.halfDepth,
          verticalHalfHeight: supportCarCollision.verticalHalfHeight,
          rotationY: supportCarCollision.rotationY,
          horizontalPositionError: Math.hypot(
            supportCarCollision.position.x - supportCarWorldPosition.x,
            supportCarCollision.position.z - supportCarWorldPosition.z,
          ),
        },
        workbench: workbenchCollision && {
          roomId: workbenchCollision.roomId,
          halfWidth: workbenchCollision.halfWidth,
          halfDepth: workbenchCollision.halfDepth,
          verticalHalfHeight: workbenchCollision.verticalHalfHeight,
          rotationY: workbenchCollision.rotationY,
          playerCollisionPadding: workbenchCollision.playerCollisionPadding,
          horizontalPositionError: Math.hypot(
            workbenchCollision.position.x - workbenchWorldPosition.x,
            workbenchCollision.position.z - workbenchWorldPosition.z,
          ),
        },
        minimumRouteClearance: Math.min(...workshopCollisionZones.map(zoneRouteClearance)),
      },
      scenarios,
      explainingTimeBeforePausedUpdate,
      explainingTimeAfterPausedUpdate,
      stateAfterExplaining,
      stateAfterInactivity,
      stateAfterThinking,
    };
  });

  expect(result.loadError).toBeNull();
  expect(result.textureLoadError).toBeNull();
  expect(result.textureLoaded).toBe(true);
  expect(result.animationLoadErrors).toEqual({});
  expect(result.animationAssetsSettled).toBe(true);
  expect(result.animationLibraryReady).toBe(true);
  expect(result.hasAnimator).toBe(true);
  expect(result.mixerRegistered).toBe(true);
  expect(result.animatorRegistered).toBe(true);
  expect(result.meshCount).toBeGreaterThan(0);
  expect(result.skinnedMeshCount).toBe(result.meshCount);
  expect(result.texturedMeshCount).toBe(result.meshCount);

  expect(result.clipSummaries.map(({ name }) => name)).toEqual(Object.keys(EXPECTED_CLIPS).sort());
  for (const summary of result.clipSummaries) {
    expect(summary.duration).toBeCloseTo(EXPECTED_CLIPS[summary.name], 2);
    expect(summary.tracks).toBe(62);
  }

  expect(result.oldNpcNames).toEqual([]);
  expect(result.oldResearchObjectNames).toEqual([]);
  expect(result.oldNpcInteractionIds).toEqual([]);
  expect(result.oldResearchInteractions).toEqual([]);
  expect(result.action).toBe('roll');
  expect(result.interactionRadius).toBeCloseTo(2.4, 3);
  expect(result.questBoardAction).toBeUndefined();
  expect(result.rollTargetModelHeight).toBeCloseTo(result.playerModelHeight, 2);
  expect(result.rollTargetModelHeight).toBeCloseTo(2.85, 2);
  expect(Math.abs(result.rollX - result.routeCenterX)).toBeGreaterThanOrEqual(3.55);
  expect(result.modelMaxX).toBeLessThan(result.routeCenterX);
  expect(result.minimumAnimatedClearance).toBeGreaterThanOrEqual(2.25);
  expect(result.workshopRouteClearance).toBeGreaterThanOrEqual(2.25);

  expect(result.supportCar.modelLoadError).toBeNull();
  expect(result.supportCar.textureLoadError).toBeNull();
  expect(result.supportCar.modelLoaded).toBe(true);
  expect(result.supportCar.textureLoaded).toBe(true);
  expect(result.supportCar.usingFallback).toBe(false);
  expect(result.supportCar.targetModelHeight).toBeCloseTo(3.6, 3);
  expect(result.supportCar.modelHeight).toBeCloseTo(3.6, 3);
  expect(result.supportCar.worldHeight).toBeCloseTo(3.6, 2);
  expect(result.supportCar.groundOffset).toBeCloseTo(0, 3);
  expect(result.supportCar.modelScale).toBeCloseTo(3.6 / 143.5, 4);
  expect(result.supportCar.frontAxis).toBe('-Z');
  expect(result.supportCar.frontDoorSide).toBe('+X');
  expect(result.supportCar.sourceSize[0]).toBeCloseTo(112.4, 2);
  expect(result.supportCar.sourceSize[1]).toBeCloseTo(143.5, 2);
  expect(result.supportCar.sourceSize[2]).toBeCloseTo(180.4, 2);
  expect(result.supportCar.vertexCount).toBe(534);
  expect(result.supportCar.triangleCount).toBe(178);
  expect(result.supportCar.meshName).toBe('supportCarMesh');
  expect(result.supportCar.meshCastsShadow).toBe(true);
  expect(result.supportCar.meshReceivesShadow).toBe(true);
  expect(result.supportCar.materialName).toBe('material_SupportCarTextured');
  expect(result.supportCar.materialRoughness).toBeCloseTo(0.58, 3);
  expect(result.supportCar.materialMetalness).toBeCloseTo(0.16, 3);
  expect(result.supportCar.materialAlphaTest).toBeCloseTo(0.5, 3);
  expect(result.supportCar.materialTransparent).toBe(false);
  expect(result.supportCar.materialDepthWrite).toBe(true);
  expect(result.supportCar.materialFrontSide).toBe(true);
  expect(result.supportCar.textureName).toBe('texture_SupportCarDiffuse');
  expect(result.supportCar.textureWidth).toBe(256);
  expect(result.supportCar.textureHeight).toBe(128);
  expect(result.supportCar.textureSrgb).toBe(true);
  expect(result.supportCar.textureNearestMagnification).toBe(true);
  expect(result.supportCar.textureNearestMipmapMinification).toBe(true);
  expect(result.supportCar.textureMipmaps).toBe(true);

  expect(result.workshop.localPosition).toEqual([-10, 0, -5.7]);
  expect(result.workshop.yaw).toBeCloseTo(-Math.PI * 0.25, 5);
  expect(result.workshop.carRelativeToRoute[0]).toBeCloseTo(-10, 3);
  expect(result.workshop.carRelativeToRoute[1]).toBeCloseTo(-5.7, 3);
  expect(Math.abs(result.workshop.carFront[0])).toBeCloseTo(Math.SQRT1_2, 3);
  expect(Math.abs(result.workshop.carFront[2])).toBeCloseTo(Math.SQRT1_2, 3);
  expect(result.workshop.frontDoorLocalPosition[2]).toBeCloseTo(-1.32, 3);
  expect(result.workshop.rollLocalPosition[2]).toBeCloseTo(-1.32, 3);
  expect(result.workshop.workbenchLocalPosition[2]).toBeCloseTo(-1.32, 3);
  expect(result.workshop.frontDoorLocalPosition[0])
    .toBeLessThan(result.workshop.rollLocalPosition[0]);
  expect(result.workshop.rollLocalPosition[0])
    .toBeLessThan(result.workshop.workbenchLocalPosition[0]);
  expect(result.workshop.doorToRollDistance).toBeGreaterThan(0.6);
  expect(result.workshop.doorToRollDistance).toBeLessThan(0.9);
  expect(result.workshop.rollToWorkbenchDistance).toBeCloseTo(1.4, 3);
  expect(result.workshop.alignmentDot).toBeGreaterThan(0.999);
  expect(result.workshop.doorOutwardDot).toBeGreaterThan(0.999);
  expect(result.workshop.rollFacingWorkbenchDot).toBeGreaterThan(0.999);
  expect(result.workshop.rollFacingCampInteriorDot).toBeGreaterThan(0.95);
  expect(result.workshop.workbenchFacingRollDot).toBeGreaterThan(0.999);

  expect(result.workbench.textureAssetsSettled).toBe(true);
  expect(result.workbench.textureLoaded).toBe(true);
  expect(result.workbench.textureLoadErrors).toEqual({});
  expect(result.workbench.surfaceTextureLoaded).toBe(true);
  expect(result.workbench.blueprintTextureLoaded).toBe(true);
  expect(result.workbench.surfaceTextureSize[0]).toBeGreaterThanOrEqual(1024);
  expect(result.workbench.surfaceTextureSize[1]).toBeGreaterThanOrEqual(1024);
  expect(result.workbench.blueprintTextureSize).toEqual([1536, 1024]);
  expect(result.workbench.surfaceMaterialName).toBe('rollWorkbenchGeneratedSurfaceMaterial');
  expect(result.workbench.blueprintMaterialName).toBe('rollWorkbenchGeneratedBlueprintMaterial');
  expect(result.workbench.surfaceTextureName).toBe('texture_RollWorkbench_surface');
  expect(result.workbench.blueprintTextureName).toBe('texture_RollWorkbench_blueprint');
  expect(result.workbench.surfaceTextureSrgb).toBe(true);
  expect(result.workbench.blueprintTextureSrgb).toBe(true);
  expect(result.workbench.surfaceTextureRepeat).toEqual([2, 1]);
  expect(result.workbench.blueprintDoubleSided).toBe(true);
  expect(result.workbench.blueprintName).toBe('rollWorkbenchBlueprint');
  expect(result.workbench.blueprintCastsShadow).toBe(true);
  expect(result.workbench.toolsName).toBe('rollWorkshopTools');
  expect(result.workbench.toolNames).toEqual([
    'rollWorkshopHammer',
    'rollWorkshopScrewdriver',
    'rollWorkshopWrench',
  ]);

  expect(result.collision.ids).toEqual([
    'expeditionSupportCarCollision',
    'rollWorkshopWorkbenchCollision',
  ]);
  expect(result.collision.registeredInController).toBe(true);
  expect(result.collision.supportCar.roomId).toBe('expeditionCamp');
  expect(result.collision.supportCar.halfWidth).toBeCloseTo((56.2 / 143.5) * 3.6 + 0.12, 3);
  expect(result.collision.supportCar.halfDepth).toBeCloseTo((90.2 / 143.5) * 3.6 + 0.12, 3);
  expect(result.collision.supportCar.verticalHalfHeight).toBeCloseTo(1.8, 3);
  expect(result.collision.supportCar.rotationY).toBeCloseTo(Math.PI * 0.25, 5);
  expect(result.collision.supportCar.horizontalPositionError).toBeCloseTo(0, 3);
  expect(result.collision.workbench.roomId).toBe('expeditionCamp');
  expect(result.collision.workbench.halfWidth).toBeCloseTo(1.1, 3);
  expect(result.collision.workbench.halfDepth).toBeCloseTo(0.41, 3);
  expect(result.collision.workbench.verticalHalfHeight).toBeCloseTo(0.55, 3);
  expect(result.collision.workbench.rotationY).toBeCloseTo(-Math.PI * 0.25, 5);
  expect(result.collision.workbench.playerCollisionPadding).toBeCloseTo(0.42, 3);
  expect(result.collision.workbench.horizontalPositionError).toBeCloseTo(0, 3);
  expect(result.collision.minimumRouteClearance).toBeGreaterThanOrEqual(2.25);

  const explainingScenario = (prompt, call) => ({
    prompt,
    calls: [call],
    animationState: 'explaining',
    inactivitySeconds: 0,
  });
  expect(result.scenarios).toEqual({
    debrief: explainingScenario('Roll: Debrief', 'debrief'),
    briefing: explainingScenario('Roll: Expedition Briefing', 'briefing'),
    identify: explainingScenario('Roll: Identify 3 Scrap', 'workshop'),
    workshop: explainingScenario('Roll: Workshop', 'workshop'),
  });
  expect(result.explainingTimeBeforePausedUpdate).toBe(0);
  expect(result.explainingTimeAfterPausedUpdate).toBeGreaterThan(0.45);
  expect(result.stateAfterExplaining).toBe('idle');
  expect(result.stateAfterInactivity).toBe('thinking');
  expect(result.stateAfterThinking).toBe('idle');
  expect(result.animationState).toBe('idle');
  expect(runtimeErrors).toEqual([]);
});

test('Roll identifies hidden recoveries and keeps the stockpile out of Mega Man inventory', async ({ page }) => {
  await page.goto('/');
  await expect
    .poll(
      async () => page.locator('#game-container').getAttribute('data-browser-test-ready'),
      { timeout: 20_000 },
    )
    .toBe('true');

  const result = await page.evaluate(async () => {
    const { REAVERBOT_SALVAGE_MATERIALS } = await import('/src/reaverbots/ReaverbotSalvageCatalog.js');
    const { game } = window;
    game.stop();
    game.inventory.unidentifiedScrap = 0;
    game.inventory.unidentifiedRecoveries = [];
    game.rollSalvageStorage.clear();
    game.ui.lastScrapIdentification = null;

    const source = {
      aspect: 'body',
      aspectLabel: 'Chassis / Locomotion',
      moduleId: 'hopper',
      moduleLabel: 'Spring Hopper',
      enemyName: 'Test Reaverbot',
    };
    game.inventory.addUnidentifiedScrap(2, {
      source,
      recoverableParts: [{
        ...REAVERBOT_SALVAGE_MATERIALS.temperedJumpSpring,
        quantity: 1,
        source,
      }],
    });

    const readPanel = () => ({
      mode: document.getElementById('inventory-panel')?.dataset.mode,
      title: document.getElementById('inventory-panel-title')?.textContent,
      headerCount: document.getElementById('unidentified-scrap-value')?.textContent,
      serviceHidden: document.getElementById('roll-scrap-service')?.hidden,
      awaiting: document.getElementById('roll-unidentified-value')?.textContent,
      identified: document.getElementById('roll-identified-value')?.textContent,
      parts: document.getElementById('roll-parts-value')?.textContent,
      identifyDisabled: document.getElementById('roll-identify-scrap')?.disabled,
      identifyLabel: document.getElementById('roll-identify-scrap')?.textContent,
      result: document.getElementById('roll-identification-result')?.textContent,
      partText: document.getElementById('material-inventory')?.textContent,
      questText: document.getElementById('quest-log')?.textContent,
    });

    game.setInventoryOpen(true);
    const megaManInventory = readPanel();
    game.setInventoryOpen(false);

    game.expeditionAccepted = true;
    game.ruinCompleted = false;
    const rollInteraction = game.dungeon.safeInteractables.find(({ id }) => id === 'rollCaskett');
    game.dungeonController._activateSafeInteractable(rollInteraction);
    const beforeIdentification = readPanel();

    document.getElementById('roll-identify-scrap').click();
    await game.ui.busterLabActionQueue;
    await game.busterGameCommandQueue;
    const afterIdentification = readPanel();
    const storedPart = game.rollSalvageStorage.parts.temperedJumpSpring;
    const stateAfterIdentification = {
      unidentified: game.inventory.unidentifiedScrap,
      recoveryBatches: game.inventory.unidentifiedRecoveries.length,
      identifiedScrap: game.rollSalvageStorage.identifiedScrap,
      partCount: game.rollSalvageStorage.getPartCount('temperedJumpSpring'),
      partSource: storedPart?.lastSource?.moduleLabel,
    };

    game.setInventoryOpen(false);
    game.setInventoryOpen(true);
    const garageAfterIdentification = readPanel();

    return {
      megaManInventory,
      beforeIdentification,
      afterIdentification,
      stateAfterIdentification,
      garageAfterIdentification,
    };
  });

  expect(result.megaManInventory).toMatchObject({
    mode: 'garage',
    title: 'Garage Loadout',
    headerCount: '2',
    serviceHidden: true,
  });
  expect(result.megaManInventory.questText).not.toContain('Scrap Contract');
  expect(result.megaManInventory.questText).not.toContain('Research Processing');

  expect(result.beforeIdentification).toMatchObject({
    mode: 'roll',
    title: "Roll's Workshop",
    headerCount: '2',
    serviceHidden: false,
    awaiting: '2',
    identified: '0',
    parts: '0',
    identifyDisabled: false,
    identifyLabel: 'Identify All (2)',
  });
  expect(result.beforeIdentification.partText).not.toContain('Tempered Jump Spring');

  expect(result.stateAfterIdentification).toEqual({
    unidentified: 0,
    recoveryBatches: 0,
    identifiedScrap: 1,
    partCount: 1,
    partSource: 'Spring Hopper',
  });
  expect(result.afterIdentification).toMatchObject({
    headerCount: '0',
    serviceHidden: false,
    awaiting: '0',
    identified: '1',
    parts: '1',
    identifyDisabled: true,
    identifyLabel: 'Nothing to Identify',
  });
  expect(result.afterIdentification.result).toContain('Intact part found: Tempered Jump Spring');
  expect(result.afterIdentification.partText).toContain('Tempered Jump Spring');
  expect(result.afterIdentification.partText).toContain('Spring Hopper');

  expect(result.garageAfterIdentification).toMatchObject({
    mode: 'garage',
    title: 'Garage Loadout',
    headerCount: '0',
    serviceHidden: true,
  });
});

test('the Support Car fallback remains when the imported model is unavailable', async ({ page }) => {
  await page.route('**/assets/models/props/support-car/support-car.obj', (route) => (
    route.abort('failed')
  ));

  await page.goto('/');
  await page.waitForFunction(() => {
    const group = window.game?.dungeon?.group;
    const supportCar = group?.getObjectByName('expeditionSupportCar');
    const roll = group?.getObjectByName('rollCaskettNpc');
    const workbench = group?.getObjectByName('rollWorkshopWorkbench');
    return Boolean(
      supportCar?.userData?.modelLoadError
      && (roll?.userData?.modelLoaded || roll?.userData?.modelLoadError)
      && (workbench?.userData?.textureAssetsSettled || workbench?.userData?.textureLoadCancelled),
    );
  }, null, { timeout: 30_000 });

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const group = game.dungeon.group;
    const supportCar = group.getObjectByName('expeditionSupportCar');
    const fallback = group.getObjectByName('supportCarFallback');
    return {
      modelLoadError: supportCar.userData.modelLoadError ?? null,
      usingFallback: supportCar.userData.usingFallback,
      hasFallback: Boolean(fallback),
      hasImportedModel: Boolean(group.getObjectByName('supportCarModel')),
      rollModelLoaded: group.getObjectByName('rollCaskettNpc')?.userData?.modelLoaded === true,
      workbenchTexturesSettled: group.getObjectByName('rollWorkshopWorkbench')
        ?.userData?.textureAssetsSettled === true,
      hasRollInteraction: game.dungeon.safeInteractables.some(({ id }) => id === 'rollCaskett'),
      collisionIds: game.dungeon.solidZones
        .filter(({ id }) => ['expeditionSupportCarCollision', 'rollWorkshopWorkbenchCollision'].includes(id))
        .map(({ id }) => id)
        .sort(),
    };
  });

  expect(result.modelLoadError).toBeTruthy();
  expect(result.usingFallback).toBe(true);
  expect(result.hasFallback).toBe(true);
  expect(result.hasImportedModel).toBe(false);
  expect(result.rollModelLoaded).toBe(true);
  expect(result.workbenchTexturesSettled).toBe(true);
  expect(result.hasRollInteraction).toBe(true);
  expect(result.collisionIds).toEqual([
    'expeditionSupportCarCollision',
    'rollWorkshopWorkbenchCollision',
  ]);
});

test('the workbench blocks the player while Roll remains usable across it', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => {
    const group = window.game?.dungeon?.group;
    const rollState = group?.getObjectByName('rollCaskettNpc')?.userData;
    return Boolean(
      window.game?.dungeonController
      && group?.getObjectByName('rollWorkshopWorkbench')
      && rollState?.rollAnimator
      && rollState?.animationLibraryReady
      && rollState?.animationAssetsSettled
      && window.game?.dungeon?.safeInteractables?.some(({ id }) => id === 'rollCaskett'),
    );
  }, null, { timeout: 30_000 });

  const result = await page.evaluate(() => {
    const { game } = window;
    game.stop();
    const controller = game.dungeonController;
    const group = game.dungeon.group;
    const roll = group.getObjectByName('rollCaskettNpc');
    const workbench = group.getObjectByName('rollWorkshopWorkbench');
    const interaction = game.dungeon.safeInteractables.find(({ id }) => id === 'rollCaskett');
    const collision = game.dungeon.solidZones
      .find(({ id }) => id === 'rollWorkshopWorkbenchCollision');
    const Vector3 = interaction.position.constructor;
    const rollPosition = roll.getWorldPosition(new Vector3());
    const workbenchPosition = workbench.getWorldPosition(new Vector3());
    const outward = workbenchPosition.clone().sub(rollPosition).setY(0).normalize();
    const floorY = collision.position.y - collision.verticalHalfHeight;
    const playerRadius = game.player.radius;
    const blockedPosition = workbenchPosition.clone().addScaledVector(
      outward,
      collision.halfDepth + playerRadius - 0.02,
    ).setY(floorY);
    const farSidePosition = workbenchPosition.clone().addScaledVector(
      outward,
      collision.halfDepth + playerRadius + 0.05,
    ).setY(floorY);

    const blockedByCapsuleCollision = controller._isPositionInsideSolidZone(blockedPosition);
    const blockedPositionWalkable = controller.isPositionWalkable(blockedPosition);
    const farSideOutsideCollision = !controller._isPositionInsideSolidZone(farSidePosition);
    const farSideWalkable = controller.isPositionWalkable(farSidePosition);

    const original = {
      playerPosition: game.player.root.position.clone(),
      lastSafePlayerPosition: controller.lastSafePlayerPosition.clone(),
      playerVelocity: game.player.velocity.clone(),
      jumpState: game.player.jumpState,
      nearestInteractable: controller.nearestInteractable,
      setInventoryOpen: game.setInventoryOpen,
      addParticleBurst: game.addParticleBurst,
      showToast: game.ui.showToast,
      expeditionAccepted: game.expeditionAccepted,
      ruinCompleted: game.ruinCompleted,
      unidentifiedScrap: game.inventory.unidentifiedScrap,
      animatorName: roll.userData.rollAnimator.currentName,
    };

    game.player.root.position.copy(farSidePosition);
    controller.lastSafePlayerPosition.copy(farSidePosition);
    game.player.velocity.set(0, 0, 0);
    game.player.jumpState = 'Grounded';
    game.player.root.position.copy(blockedPosition);
    controller._constrainPlayerToWalkable();
    const correctedPosition = game.player.root.position.clone();
    const collisionCorrectionDistance = correctedPosition.distanceTo(blockedPosition);
    const offsetX = correctedPosition.x - collision.position.x;
    const offsetZ = correctedPosition.z - collision.position.z;
    const cos = Math.cos(collision.rotationY);
    const sin = Math.sin(collision.rotationY);
    const localX = offsetX * cos + offsetZ * sin;
    const localZ = -offsetX * sin + offsetZ * cos;
    const bodyDistanceFromVisibleBench = Math.hypot(
      Math.max(Math.abs(localX) - collision.halfWidth, 0),
      Math.max(Math.abs(localZ) - collision.halfDepth, 0),
    );

    const nearestRollAt = (distance) => {
      game.player.root.position.copy(rollPosition).addScaledVector(outward, distance).setY(floorY);
      controller._updateNearestInteractable();
      return controller.getNearestInteractable()?.target?.id === 'rollCaskett';
    };
    const rollAvailableAt239 = nearestRollAt(2.39);
    const rollAvailableAt241 = nearestRollAt(2.41);

    const calls = [];
    game.expeditionAccepted = true;
    game.ruinCompleted = false;
    game.inventory.unidentifiedScrap = 0;
    game.setInventoryOpen = (open, options = {}) => calls.push(
      open && options.mode === 'roll' ? 'workshop' : 'garage',
    );
    game.addParticleBurst = () => {};
    game.ui.showToast = () => {};
    game.player.root.position.copy(farSidePosition);
    controller._updateNearestInteractable();
    const farSideDistanceToRoll = game.player.root.position.distanceTo(rollPosition);
    const farSideNearest = controller.getNearestInteractable();
    const activatedFromFarSide = controller.activateNearest();
    const animatorAfterActivation = roll.userData.rollAnimator.currentName;

    game.player.root.position.copy(original.playerPosition);
    controller.lastSafePlayerPosition.copy(original.lastSafePlayerPosition);
    game.player.velocity.copy(original.playerVelocity);
    game.player.jumpState = original.jumpState;
    controller.nearestInteractable = original.nearestInteractable;
    game.setInventoryOpen = original.setInventoryOpen;
    game.addParticleBurst = original.addParticleBurst;
    game.ui.showToast = original.showToast;
    game.expeditionAccepted = original.expeditionAccepted;
    game.ruinCompleted = original.ruinCompleted;
    game.inventory.unidentifiedScrap = original.unidentifiedScrap;
    roll.userData.rollAnimator.play(original.animatorName ?? 'idle', { fade: 0 });

    return {
      playerRadius,
      collisionPadding: collision.playerCollisionPadding,
      blockedByCapsuleCollision,
      blockedPositionWalkable,
      farSideOutsideCollision,
      farSideWalkable,
      collisionCorrectionDistance,
      bodyDistanceFromVisibleBench,
      interactionRadius: interaction.interactionRadius,
      farSideDistanceToRoll,
      farSideNearestKind: farSideNearest?.kind ?? null,
      farSideNearestId: farSideNearest?.target?.id ?? null,
      activatedFromFarSide,
      calls,
      animatorAfterActivation,
      rollAvailableAt239,
      rollAvailableAt241,
    };
  });

  expect(result.collisionPadding).toBeCloseTo(result.playerRadius, 3);
  expect(result.blockedByCapsuleCollision).toBe(true);
  expect(result.blockedPositionWalkable).toBe(false);
  expect(result.farSideOutsideCollision).toBe(true);
  expect(result.farSideWalkable).toBe(true);
  expect(result.collisionCorrectionDistance).toBeGreaterThan(0.01);
  expect(result.bodyDistanceFromVisibleBench).toBeGreaterThanOrEqual(result.playerRadius - 0.01);
  expect(result.interactionRadius).toBeCloseTo(2.4, 3);
  expect(result.farSideDistanceToRoll).toBeGreaterThan(2.2);
  expect(result.farSideDistanceToRoll).toBeLessThan(result.interactionRadius);
  expect(result.farSideNearestKind).toBe('safe');
  expect(result.farSideNearestId).toBe('rollCaskett');
  expect(result.activatedFromFarSide).toBe(true);
  expect(result.calls).toEqual(['workshop']);
  expect(result.animatorAfterActivation).toBe('explaining');
  expect(result.rollAvailableAt239).toBe(true);
  expect(result.rollAvailableAt241).toBe(false);
});
