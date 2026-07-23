import { expect, test } from '@playwright/test';
import {
  beginBossExpedition,
  readWorldDiagnostics,
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

// Curated from genuine deterministic V1 generation. This layout retains all
// authored progression/encounters while giving the Nest its minimum three
// ordinary Reaverbots, keeping a real full-combat acceptance run bounded.
const JOURNEY_SEED = 'overworld-v1-public-extraction-easy-110';

const traverseSeedConnectorBothWays = async (page, {
  fromRoomId,
  toRoomId,
  traversalKind,
  direction,
  expectedAction,
}) => {
  const state = await readPublicV1JourneyState(page);
  const route = state.connectorRoutes.find((candidate) => (
    candidate.fromRoomId === fromRoomId
    && candidate.toRoomId === toRoomId
    && candidate.traversalKind === traversalKind
    && candidate.direction === direction
  ));
  expect(route, `${fromRoomId} -> ${toRoomId} ${direction} ${traversalKind}`).toBeTruthy();
  expect(route.elevationDelta).toBe(direction === 'ascending' ? 14 : -14);

  const result = await traversePublicConnectorBothWays(page, route);
  expect(result).toMatchObject({
    connectionId: route.connectionId,
    traversalKind,
    expectedAction,
  });
  for (const leg of [result.forward, result.reverse]) {
    expect(leg.traversedConnectorIds).toContain(route.connectionId);
    expect(leg.traversedActions).toContain(expectedAction);
  }
  return result;
};

test.use({ viewport: { width: 640, height: 360 } });

test.describe('overworld to streamed V1 public-input completion journey', () => {
  test('walks the authored ruin, fights, unlocks, secures the Refractor, and extracts', async ({ page }) => {
    // Stage-level movement/combat deadlines are the acceptance authority. This
    // watchdog exceeds their combined legal envelope so it cannot pre-empt a
    // still-valid public-input run.
    test.setTimeout(6_000_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });

    await page.goto(`/?dungeonSeed=${JOURNEY_SEED}&reaverbotSeed=${JOURNEY_SEED}`);
    await waitForWorld(page, 'overworld');
    const overworld = await readWorldDiagnostics(page);
    await beginBossExpedition(page, 'revolvingFusillade');
    const dungeon = await readWorldDiagnostics(page);
    expect(dungeon).toMatchObject({ worldKind: 'dungeon', transitionState: 'dungeon' });

    // The only mutating operations below are ordinary movement, jump, dodge,
    // interact, weapon-select, lock-on, fire, and modal input. The public
    // snapshot is detached and read-only; it only selects physical goals and
    // verifies what a player actually accomplished.
    let state = await readPublicV1JourneyState(page);
    if (state.keySeeker && !state.keySeeker.activated) {
      await activatePublicInteractable(page, state.keySeeker.id, {
        targetPosition: state.keySeeker.position,
        targetRadius: 2.1,
        expectedState: (next) => next.keySeeker?.activated === true,
      });
    }

    const trappedFirstConnection = state.connectorTrackTraps.filter(({ connectionId }) => (
      connectionId === 'enemyNest_keycardRoom_ground'
    ));
    expect(trappedFirstConnection.length).toBeGreaterThanOrEqual(1);
    expect(trappedFirstConnection.length).toBeLessThanOrEqual(3);
    expect(state.connectorTrackTrapRuntime).toMatchObject({
      mounted: true,
      visualAcceptancePassed: true,
    });
    expect(state.connectorTrackTrapRuntime.traps
      .filter(({ id }) => trappedFirstConnection.some((trap) => trap.id === id))
      .every((trap) => trap.visualReady && trap.visualAttached && trap.damageEnabled)).toBe(true);
    const trappedTravelBefore = new Map(state.connectorTrackTrapRuntime.traps.map((trap) => (
      [trap.id, trap.distanceTravelledMeters]
    )));

    // This real seed's first progression edge is an ascending ladder. Exercise
    // it in both directions before clearing either encounter, then continue the
    // same expedition from the source-side Enemy Nest landing.
    await traverseSeedConnectorBothWays(page, {
      fromRoomId: 'enemyNest',
      toRoomId: 'keycardRoom',
      traversalKind: 'ladder',
      direction: 'ascending',
      expectedAction: 'ladder',
    });
    state = await readPublicV1JourneyState(page, { includeGeometry: false });
    expect(state.connectorTrackTrapRuntime.traps
      .filter(({ id }) => trappedFirstConnection.some((trap) => trap.id === id))
      .every((trap) => trap.distanceTravelledMeters > trappedTravelBefore.get(trap.id))).toBe(true);

    await clearPublicEncounter(page, 'enemyNest', { timeout: 480_000 });
    await clearPublicEncounter(page, 'keycardGuard');

    state = await readPublicV1JourneyState(page);
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
      expectedState: (next) => !findById(next.doors, 'Door_Alpha').closed,
    });

    await traverseSeedConnectorBothWays(page, {
      fromRoomId: 'keycardRoom',
      toRoomId: 'trapRoom',
      traversalKind: 'slope',
      direction: 'descending',
      expectedAction: 'ramp',
    });

    // These authored combat/sub-zone branches are physically traversed rather
    // than silently skipped en route to the Beta chest.
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
      expectedState: (next) => !findById(next.doors, 'Door_Beta').closed,
      timeout: 180_000,
    });

    await traverseSeedConnectorBothWays(page, {
      fromRoomId: 'trapRoom',
      toRoomId: 'conveyorRoom',
      traversalKind: 'ladder',
      direction: 'descending',
      expectedAction: 'ladder',
    });

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
      expectedState: (next) => !findById(next.doors, 'Door_Gamma').closed,
      timeout: 180_000,
    });

    await traverseSeedConnectorBothWays(page, {
      fromRoomId: 'conveyorRoom',
      toRoomId: 'bossRoom',
      traversalKind: 'automatic_lift',
      direction: 'ascending',
      expectedAction: 'automatic_lift',
    });

    await clearPublicEncounter(page, 'bossEncounter', { timeout: 300_000 });
    await expect.poll(async () => (
      (await readPublicV1JourneyState(page, { includeGeometry: false }))
        .ownedKeys.includes('Shrine_Key')
    ), { timeout: 20_000 }).toBe(true);

    state = await readPublicV1JourneyState(page);
    const shrineDoor = findById(state.doors, 'Door_Shrine');
    await activatePublicInteractable(page, shrineDoor.id, {
      targetPosition: shrineDoor.position,
      targetRadius: 2.45,
      expectedState: (next) => !findById(next.doors, 'Door_Shrine').closed,
      timeout: 180_000,
    });

    state = await readPublicV1JourneyState(page);
    expect(state.shrine).toBeTruthy();
    await activatePublicInteractable(page, state.shrine.id, {
      targetPosition: state.shrine.position,
      targetRadius: 2.8,
      expectedState: (next) => next.shrine.collected && next.ruinCompleted,
      timeout: 180_000,
    });
    await expect.poll(async () => (
      (await readPublicV1JourneyState(page, { includeGeometry: false }))
        .nearestInteractable?.kind
    ), { timeout: 15_000 }).toBe('extraction');
    await page.keyboard.press('KeyE');
    await waitForWorld(page, 'overworld', { timeout: 75_000 });

    const returned = await readWorldDiagnostics(page);
    expect(returned).toMatchObject({
      worldKind: 'overworld',
      transitionState: 'overworld',
      planHash: overworld.planHash,
      generationCount: dungeon.generationCount + 1,
      disposalCount: dungeon.disposalCount + 1,
    });
    expect(returned.activeRootId).not.toBe(dungeon.activeRootId);
    expect(errors).toEqual([]);
  });
});
