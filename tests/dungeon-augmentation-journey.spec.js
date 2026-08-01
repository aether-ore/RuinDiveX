import { expect, test } from '@playwright/test';

import {
  attachRuntimeErrorCapture,
  beginBossExpedition,
  resumeInterruptedExpedition,
  waitForWorld,
} from './helpers/overworld-runtime.js';
import {
  activatePublicInteractable,
  clearPublicEncounter,
  findById,
  followPublicFloorRoute,
  readPublicV1JourneyState,
  traversePublicConnectorBothWays,
} from './helpers/public-v1-journey.js';

const PROFILE_ID = 'industrial-supplement-preview-v4';
const PROFILE_REVISION = 5;
const JOURNEY_SEED = 'augmentation-runtime-check';
const COMBAT_SEED = 'overworld-v1-public-extraction-easy-110';
const STARTUP_URL = [
  `/?dungeonSeed=${JOURNEY_SEED}`,
  `reaverbotSeed=${COMBAT_SEED}`,
  `dungeonAugmentation=${PROFILE_ID}`,
  'playerInvulnerable=1',
].join('&');

test.use({ viewport: { width: 640, height: 360 } });

const activeMutableStateValue = (value) => value === true || [
  'active',
  'activated',
  'available',
  'claimed',
  'cleared',
  'deployed',
  'isolated',
  'open',
  'opened',
].includes(String(value ?? '').toLowerCase());

const distance2d = (left, right) => Math.hypot(
  Number(left?.x ?? 0) - Number(right?.x ?? 0),
  Number(left?.z ?? 0) - Number(right?.z ?? 0),
);

/**
 * Selects one complete, realized V4 network from live runtime records. This is
 * deliberately fail-closed: a fallback dungeon, metadata-only content, a
 * missing local state id, or an incomplete enter/challenge/control/reward/
 * reconnect contract throws with candidate diagnostics instead of skipping.
 */
const readJourneyContract = (page) => page.evaluate(({ profileId, profileRevision }) => {
  const game = window.game;
  const dungeon = game?.dungeon;
  const controller = game?.dungeonController;
  if (!game || !dungeon || !controller) {
    throw new Error('The V4 acceptance journey requires a live dungeon controller.');
  }
  if (dungeon.augmentationStatus !== 'applied') {
    throw new Error(`V4 augmentation did not apply: ${JSON.stringify({
      status: dungeon.augmentationStatus ?? null,
      diagnostics: dungeon.augmentationDiagnostics ?? null,
    })}`);
  }
  if (dungeon.augmentationIdentity?.profileId !== profileId) {
    throw new Error(`Unexpected augmentation profile ${String(
      dungeon.augmentationIdentity?.profileId,
    )}.`);
  }

  const overlay = dungeon.augmentationOverlayPlan;
  if (!overlay || Number(overlay.profileRevision) !== profileRevision) {
    throw new Error(`The live overlay is not V4 profile revision ${profileRevision}.`);
  }

  const isGraphOnly = (plan) => Boolean(
    plan?.isSupplementGraphConnection
      || plan?.graphOnly === true
      || plan?.connectorVariantConstraints?.graphOnly === true,
  );
  const stateIds = (record) => [...new Set([
    ...(record?.runtimeStateIds ?? []),
    record?.runtimeStateId,
    record?.stateId,
    record?.encounterStateId,
    record?.rewardStateId,
    record?.shortcutStateId,
  ].filter(Boolean).map(String))];
  const socketId = (socket) => String(
    socket?.attachmentSocketId
      ?? socket?.sourceSocketId
      ?? socket?.socketId
      ?? socket?.id
      ?? '',
  );
  const worldSocket = (socket) => ({
    x: Number(socket?.x ?? 0) * Number(dungeon.tileSize ?? 2.8),
    y: Number(socket?.elevation ?? socket?.y ?? 0),
    z: Number(socket?.z ?? 0) * Number(dungeon.tileSize ?? 2.8),
  });
  const floorPosition = (floor) => ({
    x: Number(floor.x) * Number(dungeon.tileSize ?? 2.8),
    y: Number(floor.elevation ?? 0),
    z: Number(floor.z) * Number(dungeon.tileSize ?? 2.8),
  });
  const measure2d = (left, right) => Math.hypot(
    Number(left?.x ?? 0) - Number(right?.x ?? 0),
    Number(left?.z ?? 0) - Number(right?.z ?? 0),
  );
  const findParentFloor = (socket, operationNodeIds, planId) => {
    const point = worldSocket(socket);
    const facing = {
      x: Number(socket?.facingX ?? 0),
      z: Number(socket?.facingZ ?? 0),
    };
    if (Math.abs(facing.x) + Math.abs(facing.z) !== 1) return null;
    const preferred = {
      x: point.x - facing.x * Number(dungeon.tileSize ?? 2.8),
      y: point.y,
      z: point.z - facing.z * Number(dungeon.tileSize ?? 2.8),
    };
    const vector = game.player.root.position.clone();
    return (dungeon.floorTiles ?? [])
      .filter((floor) => Math.abs(Number(floor.elevation ?? 0) - point.y) <= 0.56)
      .map((floor) => {
        const position = floorPosition(floor);
        const outwardDot = (position.x - point.x) * facing.x
          + (position.z - point.z) * facing.z;
        const belongsToOperation = operationNodeIds.has(String(floor.roomId ?? ''));
        const belongsToAttachment = [
          floor.connectionId,
          floor.connectorId,
          floor.signedConnectorFloorOwnerId,
        ].some((id) => String(id ?? '') === String(planId));
        vector.set(position.x, position.y, position.z);
        return {
          floor,
          position,
          walkable: controller.isPositionWalkable(vector),
          score: Math.hypot(position.x - preferred.x, position.z - preferred.z)
            + Math.abs(position.y - preferred.y) * 4
            + (outwardDot >= -0.05 ? 100 : 0)
            + (belongsToOperation || belongsToAttachment ? 50 : 0),
        };
      })
      .filter(({ walkable }) => walkable)
      .sort((left, right) => left.score - right.score)[0]?.position ?? null;
  };

  const operations = (overlay.operations ?? []).filter(({ type }) => type === 'routeNetwork');
  const candidates = operations.map((operation) => {
    const operationNodeIds = new Set((operation.nodeIds ?? []).map(String));
    const roomIds = new Set((operation.roomNodeIds ?? operation.nodeIds ?? []).map(String));
    const rooms = (dungeon.rooms ?? []).filter((room) => roomIds.has(String(room.id)));
    const plans = (dungeon.connectionPlans ?? []).filter((plan) => (
      plan.isDungeonSupplement
        && !isGraphOnly(plan)
        && String(plan.augmentationOperationId ?? '') === String(operation.id)
    ));
    const encounters = (controller.encounters ?? []).filter((encounter) => (
      encounter.isDungeonSupplement
        && roomIds.has(String(encounter.roomId))
        && stateIds(encounter).length > 0
    ));
    const mechanisms = (controller.mechanisms ?? []).filter((mechanism) => (
      (mechanism.isDungeonSupplement || mechanism.dungeonSupplement)
        && roomIds.has(String(mechanism.roomId))
        && (
          mechanism.scopedAction === 'controlLocalHazards'
            || mechanism.type === 'dungeonSupplementLocalControl'
            || mechanism.action?.type === 'controlDungeonSupplementLocalHazards'
        )
        && stateIds(mechanism).length > 0
    ));
    const rewards = (controller.chests ?? []).filter((chest) => (
      (chest.isDungeonSupplement || chest.dungeonSupplement)
        && roomIds.has(String(chest.roomId))
        && stateIds(chest).length > 0
        && chest.isProgressionCritical !== true
    ));
    const endpointIds = new Set((operation.endpointSocketIds ?? []).map(String));
    const attachments = plans.flatMap((plan) => {
      const endpoints = [
        { socket: plan.fromSocket, internal: operationNodeIds.has(String(plan.fromRoomId)) },
        { socket: plan.toSocket, internal: operationNodeIds.has(String(plan.toRoomId)) },
      ];
      if (endpoints[0].internal === endpoints[1].internal) return [];
      const parent = endpoints.find(({ internal }) => !internal);
      const inside = endpoints.find(({ internal }) => internal);
      if (!parent?.socket || !inside?.socket || !endpointIds.has(socketId(parent.socket))) return [];
      const parentPosition = findParentFloor(parent.socket, operationNodeIds, plan.id);
      if (!parentPosition) return [];
      return [{
        endpointSocketId: socketId(parent.socket),
        planId: String(plan.id),
        parentPosition,
        socketPosition: worldSocket(parent.socket),
        insidePosition: worldSocket(inside.socket),
      }];
    });

    const rampGroups = new Map();
    for (const floor of (dungeon.floorTiles ?? []).filter((candidate) => (
      roomIds.has(String(candidate.roomId)) && candidate.surface === 'industrialRamp'
    ))) {
      const key = `${floor.roomId}:${floor.rampRouteId ?? 'authored-ramp'}`;
      const group = rampGroups.get(key) ?? [];
      group.push(floor);
      rampGroups.set(key, group);
    }
    const rampTransfers = [...rampGroups.values()].map((floors) => {
      const ordered = [...floors].sort((left, right) => (
        Number(left.elevation ?? 0) - Number(right.elevation ?? 0)
          || Number(left.rampSegmentIndex ?? 0) - Number(right.rampSegmentIndex ?? 0)
      ));
      return {
        roomId: String(ordered[0]?.roomId ?? ''),
        low: ordered[0] ? floorPosition(ordered[0]) : null,
        high: ordered.at(-1) ? floorPosition(ordered.at(-1)) : null,
        elevationDelta: ordered.length > 1
          ? Number(ordered.at(-1).elevation ?? 0) - Number(ordered[0].elevation ?? 0)
          : 0,
      };
    }).filter(({ elevationDelta }) => elevationDelta >= 1.4)
      .sort((left, right) => (
        Number(left.roomId !== String(mechanisms[0]?.roomId ?? ''))
          - Number(right.roomId !== String(mechanisms[0]?.roomId ?? ''))
          || right.elevationDelta - left.elevationDelta
      ));
    const allConnectorTransfers = plans.filter((plan) => (
      Math.abs(Number(plan.elevationDelta ?? 0)) >= 1.4
        && ['slope', 'ladder', 'automatic_lift'].includes(
          String(plan.connectorVariant?.traversalKind ?? ''),
        )
    )).sort((left, right) => {
      const rank = (plan) => ['slope', 'ladder', 'automatic_lift']
        .indexOf(String(plan.connectorVariant?.traversalKind ?? ''));
      return rank(left) - rank(right) || String(left.id).localeCompare(String(right.id));
    });
    const connectorTransfers = allConnectorTransfers.filter((plan) => (
      !plan.oneSideActivatedShortcut
        && !['shortcut-lift', 'drop-ladder'].includes(String(plan.shortcutMode ?? ''))
    ));

    const mechanism = mechanisms[0] ?? null;
    const controlledProfiles = new Set(
      (mechanism?.controlledHazardProfileIds ?? []).map(String),
    );
    const targetHazards = (controller.traps ?? []).filter((trap) => {
      if (!mechanism) return false;
      const sameRoom = String(trap.roomId ?? '') === String(
        mechanism.targetRoomId ?? mechanism.roomId ?? '',
      );
      const sameOperation = String(trap.operationId ?? '') === String(
        mechanism.targetOperationId ?? mechanism.operationId ?? '',
      );
      const allowedProfile = controlledProfiles.size === 0
        || controlledProfiles.has(String(trap.hazardProfileId ?? ''));
      return (sameRoom || sameOperation) && allowedProfile;
    });

    const accepted = encounters.length > 0
      && mechanisms.length > 0
      && rewards.length > 0
      && targetHazards.length > 0
      && attachments.length >= 2
      && (rampTransfers.length > 0 || connectorTransfers.length > 0)
      && operation.returnRouteGuaranteed === true
      && operation.bidirectional === true
      && (operation.localProgressionArc ?? []).join(':')
        === 'enter:challenge:mechanism:payoff:reconnect';
    return {
      operation,
      rooms,
      plans,
      encounters,
      mechanisms,
      rewards,
      attachments,
      rampTransfers,
      connectorTransfers,
      allConnectorTransfers,
      targetHazards,
      accepted,
      diagnostic: {
        operationId: operation.id,
        routeNetworkKind: operation.routeNetworkKind,
        encounterCount: encounters.length,
        localMechanismCount: mechanisms.length,
        rewardCount: rewards.length,
        targetHazardCount: targetHazards.length,
        attachmentCount: attachments.length,
        rampTransferCount: rampTransfers.length,
        connectorTransferCount: connectorTransfers.length,
        allConnectorTransferCount: allConnectorTransfers.length,
        returnRouteGuaranteed: operation.returnRouteGuaranteed,
        bidirectional: operation.bidirectional,
        localProgressionArc: operation.localProgressionArc,
      },
    };
  }).sort((left, right) => (
    Number(left.operation.routeNetworkKind !== 'landmark-perimeter-loop')
      - Number(right.operation.routeNetworkKind !== 'landmark-perimeter-loop')
      || String(left.operation.id).localeCompare(String(right.operation.id))
  ));

  const selected = candidates.find(({ accepted }) => accepted);
  if (!selected) {
    throw new Error(`No realized V4 network exposes a complete playable arc: ${JSON.stringify(
      candidates.map(({ diagnostic }) => diagnostic),
    )}`);
  }
  const encounter = selected.encounters[0];
  const mechanism = selected.mechanisms[0];
  const reward = selected.rewards[0];
  const orderedAttachments = [...selected.attachments].sort((left, right) => (
    measure2d(left.insidePosition, encounter.zone?.position)
      - measure2d(right.insidePosition, encounter.zone?.position)
      || left.endpointSocketId.localeCompare(right.endpointSocketId)
  ));
  const entry = orderedAttachments[0];
  const reconnect = orderedAttachments.find(({ endpointSocketId }) => (
    endpointSocketId !== entry.endpointSocketId
  ));
  if (!reconnect) throw new Error(`Network ${selected.operation.id} has no distinct reconnect.`);

  const elevationFamiliesByMode = new Map();
  for (const candidate of candidates) {
    const mode = String(candidate.operation.elevationModes?.[0] ?? '');
    if (!mode || elevationFamiliesByMode.has(mode)) continue;
    if (mode === 'split-level-platform') {
      const ramp = candidate.rampTransfers[0];
      if (!ramp) {
        throw new Error(`Network ${candidate.operation.id} declares ${mode} without a physical ramp.`);
      }
      elevationFamiliesByMode.set(mode, {
        mode,
        operationId: candidate.operation.id,
        kind: 'internal-ramp',
        ...ramp,
      });
      continue;
    }
    const expectedTraversalKind = mode === 'slope'
      ? 'slope'
      : ['ladder', 'drop-ladder'].includes(mode)
        ? 'ladder'
        : ['lift', 'shortcut-lift'].includes(mode)
          ? 'automatic_lift'
          : null;
    const plan = candidate.allConnectorTransfers.find((transfer) => (
      transfer.connectorVariant?.traversalKind === expectedTraversalKind
        && (mode === 'drop-ladder'
          ? transfer.shortcutMode === 'drop-ladder'
          : mode === 'shortcut-lift'
            ? transfer.shortcutMode === 'shortcut-lift'
            : !transfer.oneSideActivatedShortcut && !transfer.shortcutMode)
    ));
    if (!plan) {
      throw new Error(`Network ${candidate.operation.id} declares ${mode} without its physical transfer.`);
    }
    elevationFamiliesByMode.set(mode, {
      mode,
      operationId: candidate.operation.id,
      kind: 'connector',
      connectionId: String(plan.id),
      traversalKind: plan.connectorVariant.traversalKind,
      elevationDelta: Number(plan.elevationDelta),
      shortcutMode: plan.shortcutMode ?? null,
      shortcutMechanismId: plan.shortcutMechanismId ?? null,
    });
  }
  const declaredElevationModes = [...new Set(operations
    .flatMap((operation) => operation.elevationModes ?? [])
    .map(String))].sort();
  const realizedElevationModes = [...elevationFamiliesByMode.keys()].sort();
  if (JSON.stringify(realizedElevationModes) !== JSON.stringify(declaredElevationModes)) {
    throw new Error(`Live elevation families are incomplete: ${JSON.stringify({
      declaredElevationModes,
      realizedElevationModes,
    })}`);
  }

  return structuredClone({
    profileId,
    profileRevision,
    operationId: selected.operation.id,
    routeNetworkKind: selected.operation.routeNetworkKind,
    augmentationPlanHash: dungeon.augmentationPlanHash,
    effectivePlanHash: dungeon.effectivePlanHash,
    entry,
    reconnect,
    encounter: {
      id: encounter.id,
      roomId: encounter.roomId,
      stateId: stateIds(encounter)[0],
    },
    mechanism: {
      id: mechanism.id,
      roomId: mechanism.roomId,
      stateId: stateIds(mechanism)[0],
      targetHazardIds: selected.targetHazards.map(({ id }) => String(id)).sort(),
    },
    reward: {
      id: reward.id,
      roomId: reward.roomId,
      stateId: stateIds(reward)[0],
    },
    elevationFamilies: [...elevationFamiliesByMode.values()]
      .sort((left, right) => left.mode.localeCompare(right.mode)),
    physicalSupplementConnectionIds: [...new Set([
      ...selected.plans.map(({ id }) => String(id)),
      ...[...elevationFamiliesByMode.values()]
        .map(({ connectionId }) => connectionId)
        .filter(Boolean),
    ])].sort(),
  });
}, { profileId: PROFILE_ID, profileRevision: PROFILE_REVISION });

const placePlayerAtJourneyEntry = async (page, position) => {
  const placed = await page.evaluate((target) => {
    const game = window.game;
    const player = game?.player;
    const controller = game?.dungeonController;
    if (!player?.root || !controller) return null;
    const point = player.root.position.clone().set(target.x, target.y, target.z);
    if (!controller.isPositionWalkable(point)) {
      throw new Error(`The selected authored-side entry floor is not walkable: ${JSON.stringify(target)}`);
    }
    player.cancelLadderTraversal?.();
    player.cancelJetSkateBoost?.();
    player.ledgeCling = null;
    player.jumpState = 'Grounded';
    player.velocity?.set?.(0, 0, 0);
    player.root.position.copy(point);
    controller.lastSafePlayerPosition?.copy?.(point);
    controller.pendingPlayerJumpOffLanding = null;
    return { x: point.x, y: point.y, z: point.z };
  }, position);
  expect(placed).toEqual(position);
  await page.waitForTimeout(250);
};

const readSelectedRuntimeState = (page, contract) => page.evaluate((selection) => {
  const game = window.game;
  const dungeon = game?.dungeon;
  const controller = game?.dungeonController;
  if (!dungeon || !controller) throw new Error('Selected V4 runtime state is unavailable.');
  const encounter = controller.encounters?.find(({ id }) => id === selection.encounter.id);
  const mechanism = controller.mechanisms?.find(({ id }) => id === selection.mechanism.id);
  const reward = controller.chests?.find(({ id }) => id === selection.reward.id);
  if (!encounter || !mechanism || !reward) {
    throw new Error(`Stable V4 runtime records are missing after assembly: ${JSON.stringify({
      encounter: Boolean(encounter),
      mechanism: Boolean(mechanism),
      reward: Boolean(reward),
    })}`);
  }
  const supplementConnectionIds = new Set(selection.physicalSupplementConnectionIds);
  const ladders = (controller.ladders ?? dungeon.ladders ?? [])
    .filter((ladder) => supplementConnectionIds.has(String(
      ladder.connectionId ?? ladder.descriptor?.connectionId ?? '',
    )))
    .map((ladder) => ({
      id: String(ladder.id),
      connectionId: String(ladder.connectionId ?? ladder.descriptor?.connectionId ?? ''),
      deployed: ladder.deployed === true,
      disabled: ladder.disabled === true,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const lifts = (game.connectorLiftRuntime?.lifts ?? [])
    .filter((lift) => supplementConnectionIds.has(String(
      lift.descriptor?.connectionId ?? lift.connectionId ?? '',
    )))
    .map((lift) => ({
      id: String(lift.id),
      connectionId: String(lift.descriptor?.connectionId ?? lift.connectionId ?? ''),
      shortcutUnlocked: lift.shortcutUnlocked === true,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const traps = (controller.traps ?? [])
    .filter((trap) => trap.isDungeonSupplement
      || String(trap.operationId ?? '') === String(selection.operationId))
    .map((trap) => ({
      id: String(trap.id),
      active: trap.active !== false,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const identity = game._captureCurrentDungeonAugmentationIdentity?.()
    ?? dungeon.augmentationIdentity;
  return structuredClone({
    profileId: dungeon.augmentationIdentity?.profileId ?? null,
    augmentationStatus: dungeon.augmentationStatus ?? null,
    augmentationPlanHash: dungeon.augmentationPlanHash ?? null,
    effectivePlanHash: dungeon.effectivePlanHash ?? null,
    mutableState: identity?.mutableState ?? {},
    encounter: {
      id: encounter.id,
      spawned: encounter.spawned === true,
      cleared: encounter.cleared === true,
      enemyIds: [...(encounter.enemyIds ?? [])],
      liveEnemyIds: (game.enemies ?? []).filter((enemy) => (
        !enemy.dead
          && Number(enemy.health ?? 0) > 0
          && (
            (encounter.enemyIds ?? []).includes(enemy.id)
              || enemy.encounterId === encounter.id
          )
      )).map(({ id }) => String(id)).sort(),
    },
    mechanism: {
      id: mechanism.id,
      activated: mechanism.activated === true,
      objectActivated: mechanism.object?.userData?.activated === true,
    },
    reward: {
      id: reward.id,
      opened: reward.opened === true,
      rewardClaimed: reward.rewardClaimed === true,
      objectOpened: reward.object?.userData?.opened === true,
    },
    traps,
    ladders,
    lifts,
  });
}, contract);

const expectScopedHazardChange = (before, after, targetHazardIds) => {
  const targetIds = new Set(targetHazardIds);
  const beforeById = new Map(before.traps.map((trap) => [trap.id, trap]));
  const afterById = new Map(after.traps.map((trap) => [trap.id, trap]));
  expect(targetIds.size).toBeGreaterThan(0);
  for (const targetId of targetIds) {
    expect(beforeById.get(targetId)?.active, `target hazard ${targetId} began armed`).toBe(true);
    expect(afterById.get(targetId)?.active, `target hazard ${targetId} was isolated`).toBe(false);
  }
  const unrelatedBefore = before.traps.filter(({ id }) => !targetIds.has(id));
  const unrelatedAfter = after.traps.filter(({ id }) => !targetIds.has(id));
  expect(unrelatedAfter, 'local control did not mutate unrelated supplemental hazards')
    .toEqual(unrelatedBefore);
};

test('ordinary opt-in V4 journey plays one complete arc and every realized elevation family', async ({
  page,
  context,
}) => {
  test.setTimeout(1_800_000);
  const runtimeErrors = attachRuntimeErrorCapture(page);

  await page.goto(STARTUP_URL);
  await waitForWorld(page, 'overworld');
  await beginBossExpedition(page, 'revolvingFusillade');
  await waitForWorld(page, 'dungeon', { timeout: 120_000 });

  const contract = await readJourneyContract(page);
  expect(contract).toMatchObject({
    profileId: PROFILE_ID,
    profileRevision: PROFILE_REVISION,
    routeNetworkKind: expect.any(String),
    augmentationPlanHash: expect.any(String),
    effectivePlanHash: expect.any(String),
    entry: { planId: expect.any(String), endpointSocketId: expect.any(String) },
    reconnect: { planId: expect.any(String), endpointSocketId: expect.any(String) },
    encounter: { stateId: expect.any(String) },
    mechanism: { stateId: expect.any(String) },
    reward: { stateId: expect.any(String) },
    elevationFamilies: expect.any(Array),
  });
  expect(contract.entry.endpointSocketId).not.toBe(contract.reconnect.endpointSocketId);
  expect(contract.elevationFamilies.length).toBeGreaterThanOrEqual(3);
  expect(new Set(contract.elevationFamilies.map(({ mode }) => mode)).size)
    .toBe(contract.elevationFamilies.length);

  const initial = await readSelectedRuntimeState(page, contract);
  expect(initial).toMatchObject({
    augmentationStatus: 'applied',
    profileId: PROFILE_ID,
    encounter: { spawned: false, cleared: false },
    mechanism: { activated: false },
    reward: { opened: false, rewardClaimed: false },
  });

  // Positioning is used once, solely to bound travel from the authored ruin to
  // the chosen network. Every progression mutation below is normal input.
  await placePlayerAtJourneyEntry(page, contract.entry.parentPosition);
  const entered = await followPublicFloorRoute(page, contract.entry.insidePosition, {
    targetRadius: 0.9,
    maximumTargetVerticalDifference: 0.6,
    stopDistance: 0.72,
    timeout: 120_000,
  });
  expect(entered.traversedConnectorIds).toContain(contract.entry.planId);

  let publicState = await readPublicV1JourneyState(page);
  let publicEncounter = findById(publicState.encounters, contract.encounter.id);
  const trigger = publicEncounter.triggerZone ?? publicEncounter.zone;
  await followPublicFloorRoute(page, trigger.position, {
    targetRadius: Math.max(trigger.halfWidth, trigger.halfDepth),
    maximumTargetVerticalDifference: 3.5,
    goalZone: trigger,
    stopDistance: 0.8,
    timeout: 150_000,
  });
  await expect.poll(async () => {
    publicState = await readPublicV1JourneyState(page, { includeGeometry: false });
    publicEncounter = findById(publicState.encounters, contract.encounter.id);
    return publicEncounter.spawned && !publicEncounter.cleared
      && publicState.enemies.some((enemy) => (
        !enemy.dead
          && enemy.health > 0
          && (
            publicEncounter.enemyIds.includes(enemy.id)
              || enemy.encounterId === publicEncounter.id
          )
      ));
  }, { timeout: 20_000 }).toBe(true);
  await clearPublicEncounter(page, contract.encounter.id, { timeout: 300_000 });
  publicState = await readPublicV1JourneyState(page, { includeGeometry: false });
  expect(findById(publicState.encounters, contract.encounter.id).cleared).toBe(true);

  const traversedElevationModes = [];
  for (const elevation of contract.elevationFamilies) {
    if (elevation.shortcutMode) {
      expect(elevation.shortcutMechanismId, `${elevation.mode} stable shortcut mechanism`)
        .toEqual(expect.any(String));
      publicState = await readPublicV1JourneyState(page);
      const shortcutMechanism = findById(
        publicState.mechanisms,
        elevation.shortcutMechanismId,
      );
      if (!shortcutMechanism.activated) {
        await activatePublicInteractable(page, shortcutMechanism.id, {
          targetPosition: shortcutMechanism.position,
          targetRadius: 2.1,
          expectedState: (next) => (
            findById(next.mechanisms, shortcutMechanism.id).activated
          ),
          timeout: 180_000,
        });
      }
    }
    if (elevation.kind === 'internal-ramp') {
      await followPublicFloorRoute(page, elevation.low, {
        targetRadius: 0.9,
        maximumTargetVerticalDifference: 0.55,
        stopDistance: 0.72,
        timeout: 150_000,
      });
      const ascending = await followPublicFloorRoute(page, elevation.high, {
        targetRadius: 0.9,
        maximumTargetVerticalDifference: 0.55,
        stopDistance: 0.72,
        timeout: 150_000,
      });
      expect(ascending.traversedActions).toContain('ramp');
      let playerState = await readPublicV1JourneyState(page, { includeGeometry: false });
      expect(Math.abs(playerState.player.position.y - elevation.high.y))
        .toBeLessThanOrEqual(0.55);
      const descending = await followPublicFloorRoute(page, elevation.low, {
        targetRadius: 0.9,
        maximumTargetVerticalDifference: 0.55,
        stopDistance: 0.72,
        timeout: 150_000,
      });
      expect(descending.traversedActions).toContain('ramp');
      playerState = await readPublicV1JourneyState(page, { includeGeometry: false });
      expect(Math.abs(playerState.player.position.y - elevation.low.y))
        .toBeLessThanOrEqual(0.55);
    } else {
      publicState = await readPublicV1JourneyState(page);
      const route = publicState.connectorRoutes.find(({ connectionId }) => (
        connectionId === elevation.connectionId
      ));
      expect(route, `supplemental ${elevation.mode} connector ${elevation.connectionId}`)
        .toBeTruthy();
      const traversal = await traversePublicConnectorBothWays(page, route, {
        approachTimeout: 150_000,
        legTimeout: 180_000,
      });
      expect(traversal.traversalKind).toBe(elevation.traversalKind);
    }
    traversedElevationModes.push(elevation.mode);
  }
  expect(traversedElevationModes.sort()).toEqual(
    contract.elevationFamilies.map(({ mode }) => mode).sort(),
  );

  publicState = await readPublicV1JourneyState(page);
  const publicMechanism = findById(publicState.mechanisms, contract.mechanism.id);
  await activatePublicInteractable(page, publicMechanism.id, {
    targetPosition: publicMechanism.position,
    targetRadius: 2.1,
    expectedState: (next) => findById(next.mechanisms, publicMechanism.id).activated,
    timeout: 180_000,
  });
  const afterMechanism = await readSelectedRuntimeState(page, contract);
  expect(afterMechanism.mechanism.activated).toBe(true);
  expectScopedHazardChange(initial, afterMechanism, contract.mechanism.targetHazardIds);

  publicState = await readPublicV1JourneyState(page);
  const publicReward = findById(publicState.chests, contract.reward.id);
  await activatePublicInteractable(page, publicReward.id, {
    targetPosition: publicReward.position,
    targetRadius: 2.1,
    expectedState: (next) => findById(next.chests, publicReward.id).opened,
    timeout: 180_000,
  });

  await followPublicFloorRoute(page, contract.reconnect.insidePosition, {
    targetRadius: 0.9,
    maximumTargetVerticalDifference: 0.6,
    stopDistance: 0.72,
    timeout: 180_000,
  });
  const reconnected = await followPublicFloorRoute(page, contract.reconnect.parentPosition, {
    targetRadius: 0.9,
    maximumTargetVerticalDifference: 0.6,
    stopDistance: 0.72,
    timeout: 120_000,
  });
  expect(reconnected.traversedConnectorIds).toContain(contract.reconnect.planId);
  const returnedState = await readPublicV1JourneyState(page, { includeGeometry: false });
  expect(distance2d(returnedState.player.position, contract.reconnect.parentPosition))
    .toBeLessThanOrEqual(0.9);

  const completed = await readSelectedRuntimeState(page, contract);
  expect(completed).toMatchObject({
    encounter: { spawned: true, cleared: true, liveEnemyIds: [] },
    mechanism: { activated: true },
    reward: { opened: true, objectOpened: true },
  });
  for (const stateId of [
    contract.encounter.stateId,
    contract.mechanism.stateId,
    contract.reward.stateId,
  ]) {
    expect(
      activeMutableStateValue(completed.mutableState[stateId]),
      `captured mutable state ${stateId}`,
    ).toBe(true);
  }

  const persisted = await page.evaluate(async () => {
    const game = window.game;
    const captured = game._captureCurrentDungeonAugmentationIdentity?.();
    const result = await game._persistCurrentDungeonAugmentationState?.({ force: true });
    const committed = game.busterLabStorage?.getActiveBossExpedition?.()
      ?.dungeonAugmentation ?? null;
    return structuredClone({
      result: result ? {
        ok: result.ok === true,
        unchanged: result.unchanged === true,
        reason: result.reason ?? null,
      } : null,
      captured,
      committed,
    });
  });
  expect(persisted.result?.ok).toBe(true);
  expect(persisted.captured?.mutableState).toEqual(completed.mutableState);
  expect(persisted.committed?.mutableState).toEqual(completed.mutableState);

  await page.close();
  const reopened = await context.newPage();
  const reopenedErrors = attachRuntimeErrorCapture(reopened);
  await reopened.goto(STARTUP_URL);
  await waitForWorld(reopened, 'overworld');
  await resumeInterruptedExpedition(reopened);
  await waitForWorld(reopened, 'dungeon', { timeout: 120_000 });

  const restored = await readSelectedRuntimeState(reopened, contract);
  expect(restored).toMatchObject({
    augmentationStatus: 'applied',
    profileId: PROFILE_ID,
    augmentationPlanHash: contract.augmentationPlanHash,
    effectivePlanHash: contract.effectivePlanHash,
    encounter: { spawned: true, cleared: true, enemyIds: [], liveEnemyIds: [] },
    mechanism: { activated: true, objectActivated: true },
    reward: { opened: true, rewardClaimed: true, objectOpened: true },
  });
  expect(restored.mutableState).toEqual(completed.mutableState);
  expect(restored.ladders, 'supplemental ladder deploy/disabled state after rebuild')
    .toEqual(completed.ladders);
  expect(restored.lifts, 'supplemental lift unlock state after rebuild')
    .toEqual(completed.lifts);
  expectScopedHazardChange(initial, restored, contract.mechanism.targetHazardIds);
  expect(runtimeErrors).toEqual([]);
  expect(reopenedErrors).toEqual([]);

  await reopened.evaluate(() => window.game?.stop?.());
});
