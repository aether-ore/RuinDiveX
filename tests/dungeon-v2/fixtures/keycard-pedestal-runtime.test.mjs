import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonController } from '../../../src/DungeonController.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';

const ORDINARY_KEYCARDS = Object.freeze([
  Object.freeze({
    keycardId: 'Keycard_Alpha',
    rewardId: 'reward.keycard-alpha',
    actionId: 'action.pickup.keycard-alpha',
  }),
  Object.freeze({
    keycardId: 'Keycard_Beta',
    rewardId: 'reward.keycard-beta',
    actionId: 'action.pickup.keycard-beta',
  }),
  Object.freeze({
    keycardId: 'Keycard_Gamma',
    rewardId: 'reward.keycard-gamma',
    actionId: 'action.pickup.keycard-gamma',
  }),
]);

const GOLDEN_SEEDS = Object.freeze([
  Object.freeze({ seed: 'm1-golden-magma', undercroftType: 'magma' }),
  Object.freeze({ seed: 'm1-golden-electrical', undercroftType: 'electrical' }),
]);

function acceptedGolden({ seed, undercroftType }) {
  const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
    seed,
    undercroftType,
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  return validation.plan;
}

function createControllerHarness(facade) {
  const player = {
    root: new THREE.Object3D(),
    radius: 0.45,
    collisionHeight: 2.6,
    isClimbingLadder: () => false,
    setEnvironmentalTraversalProfile() {},
  };
  player.root.position.copy(facade.playerStart);
  const game = {
    player,
    dungeon: facade,
    enemies: [],
    ruinCompleted: false,
    elapsedTime: 0,
    platformingPlatforms: facade.platforms,
    dynamicPlatformingPlatforms: [],
    debugSpawnedPlatforms: [],
    isPositionInsidePlatformBlock: () => false,
    getPlatformFloorElevation: () => null,
    _getPlatformingSurfaces: () => [],
    registerDynamicPlatformingSurface(surface) {
      this.dynamicPlatformingPlatforms.push(surface);
    },
    unregisterDynamicPlatformingSurface(surface) {
      const index = this.dynamicPlatformingPlatforms.indexOf(surface);
      if (index >= 0) this.dynamicPlatformingPlatforms.splice(index, 1);
    },
    addParticleBurst() {},
    ui: {
      showToast() {},
      renderInventory() {},
    },
  };
  const controller = new DungeonController(game, facade);
  game.dungeonController = controller;
  facade.environmentRuntime.mount(game);
  return { player, game, controller, runtime: facade.environmentRuntime };
}

function keycardBody(entry) {
  return entry.object.getObjectByName('floatingKeycard');
}

function keycardHalo(entry) {
  return entry.object.getObjectByName('droppedKeycardHalo');
}

function isVisibleInFacade(facade, target) {
  let visible = false;
  facade.group.traverseVisible((object) => {
    if (object === target) visible = true;
  });
  return visible;
}

function assertExactActionMapping(plan, expected) {
  const reward = plan.rewards.find(({ id }) => id === expected.rewardId);
  const action = plan.actions.find(({ id }) => id === expected.actionId);
  assert.ok(reward, `${expected.rewardId} is missing from the accepted golden plan`);
  assert.ok(action, `${expected.actionId} is missing from the accepted golden plan`);
  assert.equal(reward.actionId, expected.actionId);
  assert.equal(action.anchorId, reward.anchorId);
  assert.deepEqual(
    action.effects.filter(({ op }) => op === 'collectReward').map(({ rewardId }) => rewardId),
    [expected.rewardId],
    `${expected.actionId} collects a different or additional reward`,
  );
  assert.deepEqual(
    action.effects.filter(({ op }) => op === 'grantKey').map(({ keyId }) => keyId),
    [expected.keycardId],
    `${expected.actionId} grants a different or additional credential`,
  );
  return { reward, action };
}

function standBesidePedestal(player, plan, action, distance = 1.35) {
  const anchor = plan.anchors.find(({ id }) => id === action.anchorId);
  assert.ok(anchor, `${action.id} has no authored anchor`);
  const forward = new THREE.Vector3(
    anchor.forward?.x ?? 0,
    0,
    anchor.forward?.z ?? 1,
  ).normalize();
  player.root.position.set(anchor.position.x, anchor.position.y, anchor.position.z)
    .addScaledVector(forward, distance);
}

for (const fixture of GOLDEN_SEEDS) {
  test(`${fixture.seed} Key Seeker records one authoritative public operation`, () => {
    const plan = acceptedGolden(fixture);
    const facade = assembleDungeonPlanV2(plan);
    const { player, game, controller, runtime } = createControllerHarness(facade);
    try {
      const actionId = 'action.activate.key-seeker';
      const action = plan.actions.find(({ id }) => id === actionId);
      const anchor = plan.anchors.find(({ id }) => id === action?.anchorId);
      assert.ok(action && anchor, 'the actual golden plan must own the Key Seeker action and anchor');
      assert.equal(facade.keySeeker?.actionId, actionId);

      player.root.position.set(anchor.position.x, anchor.position.y, anchor.position.z + 1.2);
      game.elapsedTime += 1 / 60;
      controller._updateNearestInteractable();
      assert.equal(controller.getNearestInteractable()?.kind, 'keySeeker');
      assert.equal(controller.getNearestInteractable()?.target?.actionId, actionId);

      const before = runtime.getDiagnostics('runtime');
      assert.equal(before.actionOperationCounts[actionId] ?? 0, 0);
      assert.equal(before.collectedRewardIds.includes('reward.key-seeker'), false);
      assert.equal(controller.activateNearest(), true,
        'the actual-seed Key Seeker must activate through the controller interaction path');

      const after = runtime.getDiagnostics('runtime');
      assert.equal(after.actionOperationCounts[actionId], 1);
      assert.equal(after.operatedActionIds.includes(actionId), true);
      assert.equal(after.collectedRewardIds.includes('reward.key-seeker'), true);
      assert.equal(facade.keySeeker.activated, true);
      assert.equal(controller.activateNearest(), false,
        'the one-shot Key Seeker must not apply a duplicate operation');
      assert.equal(runtime.getDiagnostics('runtime').actionOperationCounts[actionId], 1);
    } finally {
      facade.dispose();
    }
  });

  test(`${fixture.seed} renders every ordinary keycard clearly above its authored pedestal`, () => {
    const plan = acceptedGolden(fixture);
    const facade = assembleDungeonPlanV2(plan);
    try {
      const normalEntries = facade.keycards.filter(({ keycardId }) => keycardId !== 'Shrine_Key');
      assert.deepEqual(normalEntries.map(({ keycardId }) => keycardId),
        ORDINARY_KEYCARDS.map(({ keycardId }) => keycardId));

      for (const expected of ORDINARY_KEYCARDS) {
        const { reward } = assertExactActionMapping(plan, expected);
        const anchor = plan.anchors.find(({ id }) => id === reward.anchorId);
        const entry = normalEntries.find(({ keycardId }) => keycardId === expected.keycardId);
        assert.ok(entry?.object?.isObject3D, `${expected.keycardId} has no assembled render object`);
        assert.equal(entry.object.parent, facade.group, `${expected.keycardId} is detached before pickup`);
        assert.equal(entry.object.userData.v2KeycardVisualStyle, 'dungeon-v1-floating-keycard');
        assert.equal(entry.object.userData.v2ActionId, expected.actionId);
        assert.equal(entry.pedestalObject?.userData?.v2FixtureType, 'keycard-pedestal');
        assert.ok(keycardBody(entry)?.isMesh, `${expected.keycardId} lacks the V1 floating-card body`);
        assert.equal(keycardBody(entry).geometry.parameters.width, 0.42);
        assert.equal(keycardBody(entry).geometry.parameters.height, 0.06);
        assert.equal(keycardBody(entry).geometry.parameters.depth, 0.62);
        const halo = keycardHalo(entry);
        assert.ok(halo?.isMesh, `${expected.keycardId} lacks the V1 dropped-keycard halo`);
        assert.equal(halo.geometry.type, 'RingGeometry');
        assert.equal(halo.geometry.parameters.innerRadius, 0.36);
        assert.equal(halo.geometry.parameters.outerRadius, 0.44);
        assert.equal(halo.geometry.parameters.thetaSegments, 28);
        assert.equal(halo.rotation.x, -Math.PI / 2);
        assert.equal(halo.position.y, -0.18);
        assert.equal(halo.material.color.getHex(), 0xffd66b);
        assert.equal(halo.material.transparent, true);
        assert.equal(halo.material.opacity, 0.26);
        assert.equal(halo.material.side, THREE.DoubleSide);
        assert.equal(halo.material.depthWrite, false);
        assert.equal(entry.object.userData.v2CollisionPolicy, 'nonblocking-pickup');
        assert.equal(halo.userData.v2CollisionPolicy, 'nonblocking-presentation');
        assert.equal([...facade.structuralRegistry.visuals.values()].includes(entry.object), false,
          `${expected.keycardId} pickup presentation was incorrectly registered as structure`);
        assert.equal([...facade.structuralRegistry.visuals.values()].includes(halo), false,
          `${expected.keycardId} halo was incorrectly registered as structure`);
        assert.ok(entry.position.distanceTo(new THREE.Vector3(
          anchor.position.x,
          anchor.position.y,
          anchor.position.z,
        )) <= 0.0001, `${expected.keycardId} pickup anchor drifted from its plan reward`);

        entry.object.updateWorldMatrix(true, true);
        const pedestalBounds = new THREE.Box3().setFromObject(entry.pedestalObject);
        const cardBounds = new THREE.Box3().setFromObject(keycardBody(entry));
        const haloBounds = new THREE.Box3().setFromObject(halo);
        assert.ok(Math.abs(entry.object.position.x - pedestalBounds.getCenter(new THREE.Vector3()).x) <= 0.0001);
        assert.ok(Math.abs(entry.object.position.z - pedestalBounds.getCenter(new THREE.Vector3()).z) <= 0.0001);
        assert.ok(cardBounds.min.y >= pedestalBounds.max.y + 0.2,
          `${expected.keycardId} is embedded in its pedestal: card=${JSON.stringify(cardBounds)} pedestal=${JSON.stringify(pedestalBounds)}`);
        assert.ok(haloBounds.min.y > pedestalBounds.max.y,
          `${expected.keycardId} halo intersects its physical pedestal`);
        assert.equal(entry.object.visible, true);
        assert.equal(isVisibleInFacade(facade, entry.object), true);
      }

      const { game, runtime } = createControllerHarness(facade);
      runtime.update(1 / 30);
      game.elapsedTime += 1 / 30;
      for (const entry of normalEntries) {
        assert.equal(entry.collected, false);
        assert.equal(entry.object.visible, true,
          `${entry.keycardId} disappeared before the player physically reached its pedestal`);
        assert.equal(isVisibleInFacade(facade, entry.object), true);
      }
    } finally {
      facade.dispose();
    }
  });

  test(`${fixture.seed} physical pedestal arrival immediately grants exactly its visible card`, () => {
    const plan = acceptedGolden(fixture);
    const facade = assembleDungeonPlanV2(plan);
    const { player, game, controller, runtime } = createControllerHarness(facade);
    try {
      for (const expected of ORDINARY_KEYCARDS) {
        const { reward, action } = assertExactActionMapping(plan, expected);
        const entry = facade.keycards.find(({ id }) => id === expected.rewardId);
        assert.ok(entry, `${expected.rewardId} has no runtime pedestal entry`);
        assert.deepEqual(reward.conditions, [],
          `${expected.keycardId} reward retained a hidden exploration prerequisite`);
        assert.deepEqual(action.conditions, [],
          `${expected.keycardId} pickup retained a hidden exploration prerequisite`);

        player.root.position.copy(facade.playerStart);
        game.elapsedTime += 1 / 60;
        controller._updateKeycards(1 / 60);
        assert.equal(entry.collected, false, `${expected.keycardId} was collected away from its pedestal`);
        assert.equal(entry.object.visible, true, `${expected.keycardId} did not persist before pickup`);
        const diagnosticBefore = runtime.getDiagnostics('runtime');
        assert.equal(diagnosticBefore.ownedKeycardIds.includes(expected.keycardId), false);
        assert.deepEqual(
          diagnosticBefore.keycardPickups.find(({ rewardId }) => rewardId === expected.rewardId),
          {
            rewardId: expected.rewardId,
            keycardId: expected.keycardId,
            actionId: expected.actionId,
            regionId: entry.spawnRoomId,
            collected: false,
            renderAttached: true,
            renderVisible: true,
            pedestalAttached: true,
            visualPosition: {
              x: entry.object.position.x,
              y: entry.object.position.y,
              z: entry.object.position.z,
            },
            visualRestY: entry.visualRestY,
            pedestalTopY: entry.pedestalTopY,
          },
        );

        const before = new Set(controller.progressionManager.collectedKeycardIds);
        standBesidePedestal(player, plan, action);
        game.elapsedTime += 1 / 60;
        controller._updateKeycards(1 / 60);
        assert.equal(entry.collected, true,
          `${expected.keycardId} did not collect on physical pedestal arrival`);
        assert.equal(entry.object.visible, false,
          `${expected.keycardId} remained visible after its authoritative pickup`);
        const newlyGranted = [...controller.progressionManager.collectedKeycardIds]
          .filter((keycardId) => !before.has(keycardId));

        assert.deepEqual(newlyGranted, [expected.keycardId],
          `${expected.rewardId} granted a mismatched or additional keycard`);
        assert.equal(runtime.operatedActionIds.has(expected.actionId), true);
        assert.equal(entry.collected, true);
        assert.equal(entry.object.visible, false);
        assert.equal(isVisibleInFacade(facade, entry.object), false,
          `${expected.keycardId} remained in the rendered scene after collection`);
        const diagnosticAfter = runtime.getDiagnostics('runtime');
        assert.equal(diagnosticAfter.ownedKeycardIds.includes(expected.keycardId), true);
        assert.deepEqual(
          diagnosticAfter.keycardPickups.find(({ rewardId }) => rewardId === expected.rewardId),
          {
            rewardId: expected.rewardId,
            keycardId: expected.keycardId,
            actionId: expected.actionId,
            regionId: entry.spawnRoomId,
            collected: true,
            renderAttached: true,
            renderVisible: false,
            pedestalAttached: true,
            visualPosition: {
              x: entry.object.position.x,
              y: entry.object.position.y,
              z: entry.object.position.z,
            },
            visualRestY: entry.visualRestY,
            pedestalTopY: entry.pedestalTopY,
          },
        );

        game.elapsedTime += 1 / 60;
        controller._updateKeycards(1 / 60);
        assert.deepEqual([...controller.progressionManager.collectedKeycardIds]
          .filter((keycardId) => !before.has(keycardId)), [expected.keycardId],
        `${expected.keycardId} pickup was applied more than once`);
        assert.equal(entry.object.visible, false);
      }
    } finally {
      facade.dispose();
    }
  });
}

for (const fixture of GOLDEN_SEEDS) {
  test(`${fixture.seed} failed inventory grant gives feedback and leaves the physical card visible and retryable`, () => {
    const plan = acceptedGolden(fixture);
    const facade = assembleDungeonPlanV2(plan);
    const { player, game, controller, runtime } = createControllerHarness(facade);
    try {
      const gamma = facade.keycards.find(({ keycardId }) => keycardId === 'Keycard_Gamma');
      const gammaAction = plan.actions.find(({ id }) => id === 'action.pickup.keycard-gamma');
      const grantKeycard = controller._grantKeycard.bind(controller);
      const toasts = [];
      game.ui.showToast = (message) => { toasts.push(message); };
      controller._grantKeycard = () => false;
      standBesidePedestal(player, plan, gammaAction);
      game.elapsedTime += 1 / 60;
      controller._updateKeycards(1 / 60);
      assert.equal(controller.progressionManager.hasKeycard('Keycard_Gamma'), false);
      assert.equal(gamma.collected, false,
        'a failed authoritative inventory grant committed the Gamma reward');
      assert.equal(gamma.object.visible, true,
        'a failed authoritative inventory grant hid the Gamma card');
      assert.equal(runtime.operatedActionIds.has(gammaAction.id), false,
        'a failed authoritative inventory grant was recorded as an operated pickup');
      assert.equal(runtime.eventLog.some((event) => (
        event.type === 'action-operated' && event.actionId === gammaAction.id
      )), false, 'a failed authoritative inventory grant emitted a false pickup event');
      assert.ok(toasts.some((message) => /unavailable \(key-grant-failed\)/i.test(message)),
        'a failed automatic pedestal pickup gave no public feedback');

      controller._grantKeycard = grantKeycard;
      game.elapsedTime += 1 / 60;
      controller._updateKeycards(1 / 60);
      assert.equal(controller.progressionManager.hasKeycard('Keycard_Gamma'), true);
      assert.equal(gamma.collected, true);
      assert.equal(gamma.object.visible, false);
      assert.equal(runtime.operatedActionIds.has(gammaAction.id), true);
      assert.equal(runtime.eventLog.filter((event) => (
        event.type === 'action-operated' && event.actionId === gammaAction.id
      )).length, 1, 'the successful retry must emit exactly one pickup event');
    } finally {
      facade.dispose();
    }
  });
}

test('assembler rejects a golden keycard reward whose declared action grants another card', () => {
  const plan = structuredClone(acceptedGolden(GOLDEN_SEEDS[0]));
  const betaAction = plan.actions.find(({ id }) => id === 'action.pickup.keycard-beta');
  betaAction.effects.find(({ op }) => op === 'grantKey').keyId = 'Keycard_Alpha';
  assert.throws(
    () => assembleDungeonPlanV2(plan),
    /keycard reward\.keycard-beta must use one anchored action.*grants only Keycard_Beta/,
  );
});

test('ordinary keycards share one managed V1 halo material and dispose it exactly once', () => {
  const facade = assembleDungeonPlanV2(acceptedGolden(GOLDEN_SEEDS[0]));
  const haloMaterials = facade.keycards
    .filter(({ keycardId }) => keycardId !== 'Shrine_Key')
    .map((entry) => keycardHalo(entry)?.material);
  assert.equal(haloMaterials.length, 3);
  assert.equal(new Set(haloMaterials).size, 1,
    'ordinary keycard halos should share the assembler-owned material');
  const [haloMaterial] = haloMaterials;
  let disposeEvents = 0;
  haloMaterial.addEventListener('dispose', () => { disposeEvents += 1; });
  facade.dispose();
  assert.equal(disposeEvents, 1,
    'the assembler material library must dispose the shared keycard halo material once');
});
