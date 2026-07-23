import { expect, test } from '@playwright/test';

import {
  attachRuntimeErrorCapture,
  beginBossExpedition,
  waitForWorld,
} from './helpers/overworld-runtime.js';
import {
  activatePublicInteractable,
  clearPublicEncounter,
  collectPublicKeycard,
  findById,
  readPublicV1JourneyState,
  traversePublicConnectorBothWays,
} from './helpers/public-v1-journey.js';

const JOURNEY_SEED = 'v1-bidirectional-connector-sweep-0000';
const COMBAT_SEED = 'overworld-v1-public-extraction-easy-110';

test.use({ viewport: { width: 640, height: 360 } });

const findConnectorRoute = (state, connectionId) => {
  const route = state.connectorRoutes.find((candidate) => (
    candidate.connectionId === connectionId
  ));
  expect(route, `public connector route ${connectionId}`).toBeTruthy();
  return route;
};

const expectBidirectionalTraversal = (result, route, expectedAction) => {
  expect(result).toMatchObject({
    connectionId: route.connectionId,
    traversalKind: route.traversalKind,
    expectedAction,
  });
  for (const leg of [result.forward, result.reverse]) {
    expect(leg.traversedConnectorIds).toContain(route.connectionId);
    expect(leg.traversedActions).toContain(expectedAction);
  }
};

test('real V1 seed traverses its descending lift and ascending slope in both directions', async ({
  page,
}) => {
  // Stage-level movement/combat deadlines are the acceptance authority. This
  // watchdog exceeds their combined legal envelope so it cannot pre-empt a
  // still-valid public-input run.
  test.setTimeout(4_800_000);
  const runtimeErrors = attachRuntimeErrorCapture(page);

  await page.goto(`/?dungeonSeed=${JOURNEY_SEED}&reaverbotSeed=${COMBAT_SEED}`);
  await waitForWorld(page, 'overworld');
  await beginBossExpedition(page, 'revolvingFusillade');
  await waitForWorld(page, 'dungeon', { timeout: 75_000 });

  // This journey intentionally performs every mutation through normal player
  // input. Diagnostics are detached snapshots used only to identify physical
  // targets and verify the connector contracts the player actually traversed.
  await clearPublicEncounter(page, 'enemyNest', { timeout: 480_000 });
  await clearPublicEncounter(page, 'keycardGuard');
  let state = await readPublicV1JourneyState(page);
  const alpha = findById(state.keycards, 'Keycard_Alpha');
  await collectPublicKeycard(page, 'Keycard_Alpha', alpha.position, { timeout: 180_000 });
  await expect.poll(async () => (
    (await readPublicV1JourneyState(page, { includeGeometry: false }))
      .ownedKeys.includes('Keycard_Alpha')
  ), { timeout: 15_000 }).toBe(true);

  state = await readPublicV1JourneyState(page);
  const alphaDoor = findById(state.doors, 'Door_Alpha');
  await activatePublicInteractable(page, alphaDoor.id, {
    targetPosition: alphaDoor.position,
    targetRadius: 2.45,
    expectedState: (next) => !findById(next.doors, alphaDoor.id).closed,
  });

  state = await readPublicV1JourneyState(page);
  expect(findById(state.doors, alphaDoor.id).closed).toBe(false);

  await clearPublicEncounter(page, 'trapAmbush');
  await clearPublicEncounter(page, 'coolantRelayDefense');
  state = await readPublicV1JourneyState(page);
  const coolantConsole = state.mechanisms.find(({ id }) => id === 'coolantRelayMasterConsole');
  expect(coolantConsole).toBeTruthy();
  if (!coolantConsole.activated) {
    await activatePublicInteractable(page, coolantConsole.id, {
      targetPosition: coolantConsole.position,
      targetRadius: 2.1,
      expectedState: (next) => findById(next.mechanisms, coolantConsole.id).activated,
      timeout: 180_000,
    });
  }

  state = await readPublicV1JourneyState(page);
  const betaChest = state.chests.find(({ guaranteedKeycardId }) => (
    guaranteedKeycardId === 'Keycard_Beta'
  ));
  expect(betaChest).toBeTruthy();
  await activatePublicInteractable(page, betaChest.id, {
    targetPosition: betaChest.position,
    targetRadius: 2.05,
    expectedState: (next) => next.ownedKeys.includes('Keycard_Beta'),
    timeout: 180_000,
  });

  state = await readPublicV1JourneyState(page);
  const betaDoor = findById(state.doors, 'Door_Beta');
  await activatePublicInteractable(page, betaDoor.id, {
    targetPosition: betaDoor.position,
    targetRadius: 2.45,
    expectedState: (next) => !findById(next.doors, betaDoor.id).closed,
    timeout: 180_000,
  });

  state = await readPublicV1JourneyState(page);
  expect(findById(state.doors, betaDoor.id).closed).toBe(false);
  const ascendingSlope = findConnectorRoute(
    state,
    'trapRoom_conveyorRoom_ground',
  );
  expect(ascendingSlope).toMatchObject({
    logicalConnectionId: 'trapRoom_conveyorRoom',
    fromRoomId: 'trapRoom',
    toRoomId: 'conveyorRoom',
    traversalKind: 'slope',
    direction: 'ascending',
    sourceElevation: 0,
    destinationElevation: 14,
    elevationDelta: 14,
    higherEndpoint: {
      role: 'destination',
      roomId: 'conveyorRoom',
      elevation: 14,
    },
    lowerEndpoint: {
      role: 'source',
      roomId: 'trapRoom',
      elevation: 0,
    },
  });
  const slopeTraps = state.connectorTrackTraps.filter(({ connectionId }) => (
    connectionId === ascendingSlope.connectionId
  ));
  expect(slopeTraps).toHaveLength(3);

  const slopeTraversal = await traversePublicConnectorBothWays(page, ascendingSlope);
  expectBidirectionalTraversal(slopeTraversal, ascendingSlope, 'ramp');

  await clearPublicEncounter(page, 'conveyorGuard', { timeout: 240_000 });
  await expect.poll(async () => (
    (await readPublicV1JourneyState(page, { includeGeometry: false }))
      .keycards.some(({ keycardId }) => keycardId === 'Keycard_Gamma')
  ), { timeout: 15_000 }).toBe(true);
  state = await readPublicV1JourneyState(page);
  const gamma = findById(state.keycards, 'Keycard_Gamma');
  await collectPublicKeycard(page, 'Keycard_Gamma', gamma.position, { timeout: 180_000 });
  await expect.poll(async () => (
    (await readPublicV1JourneyState(page, { includeGeometry: false }))
      .ownedKeys.includes('Keycard_Gamma')
  ), { timeout: 15_000 }).toBe(true);

  state = await readPublicV1JourneyState(page);
  const gammaDoor = findById(state.doors, 'Door_Gamma');
  await activatePublicInteractable(page, gammaDoor.id, {
    targetPosition: gammaDoor.position,
    targetRadius: 2.45,
    expectedState: (next) => !findById(next.doors, gammaDoor.id).closed,
    timeout: 180_000,
  });

  state = await readPublicV1JourneyState(page);
  expect(findById(state.doors, gammaDoor.id).closed).toBe(false);
  const descendingLift = findConnectorRoute(
    state,
    'conveyorRoom_bossRoom_ground',
  );
  expect(descendingLift).toMatchObject({
    logicalConnectionId: 'conveyorRoom_bossRoom',
    fromRoomId: 'conveyorRoom',
    toRoomId: 'bossRoom',
    traversalKind: 'automatic_lift',
    direction: 'descending',
    sourceElevation: 14,
    destinationElevation: 0,
    elevationDelta: -14,
    higherEndpoint: {
      role: 'source',
      roomId: 'conveyorRoom',
      elevation: 14,
    },
    lowerEndpoint: {
      role: 'destination',
      roomId: 'bossRoom',
      elevation: 0,
    },
  });

  const liftTraversal = await traversePublicConnectorBothWays(page, descendingLift);
  expectBidirectionalTraversal(liftTraversal, descendingLift, 'automatic_lift');
  expect(runtimeErrors).toEqual([]);
});
