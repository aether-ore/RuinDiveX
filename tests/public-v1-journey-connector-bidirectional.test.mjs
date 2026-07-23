import assert from 'node:assert/strict';
import test from 'node:test';

import { traversePublicConnectorBothWays } from './helpers/public-v1-journey.js';

const TILE_SIZE = 2.8;

const clone = (value) => structuredClone(value);

function createFakePublicPage(state) {
  return {
    async evaluate(callback, options) {
      globalThis.window = {
        game: {
          getPublicDungeonJourneyDiagnostics: () => clone(state),
        },
      };
      try {
        return callback(options);
      } finally {
        delete globalThis.window;
      }
    },
  };
}

function makeBaseState(route) {
  return {
    tileSize: TILE_SIZE,
    connectorRoutes: [route],
    connectorLadders: [],
    connectorLifts: [],
    floorTiles: [],
    player: { position: { x: -99, y: 0, z: -99 } },
  };
}

function createFollower(state, connectionId, expectedAction, calls, {
  omitConnectorOnCall = -1,
  omitActionOnCall = -1,
} = {}) {
  return async (_page, target, options) => {
    calls.push({ target: clone(target), options: clone(options) });
    state.player.position = clone(target);
    const callIndex = calls.length - 1;
    return {
      route: [],
      traversedActions: callIndex === 0 || callIndex === omitActionOnCall
        ? []
        : [expectedAction],
      traversedConnectorIds: callIndex === 0 || callIndex === omitConnectorOnCall
        ? []
        : [connectionId],
      replans: 0,
    };
  };
}

const cases = [
  {
    label: 'ascending slope',
    route: {
      connectionId: 'slope-ascending',
      traversalKind: 'slope',
      sourceElevation: 0,
      destinationElevation: 14,
      sourceSocket: { x: 90, z: 90, floorKey: '1,2@y0.000' },
      destinationSocket: { x: 91, z: 91, floorKey: '4,5@y14.000' },
    },
    expectedAction: 'ramp',
    expectedSource: { x: 2.8, y: 0, z: 5.6 },
    expectedDestination: { x: 11.2, y: 14, z: 14 },
    configure(state) {
      state.floorTiles = [
        { index: 0, x: 1, z: 2, elevation: 0, floorKey: '1,2@y0.000' },
        { index: 1, x: 4, z: 5, elevation: 14, floorKey: '4,5@y14.000' },
      ];
    },
  },
  {
    label: 'descending ladder',
    route: {
      connectionId: 'ladder-descending',
      traversalKind: 'ladder',
      sourceElevation: 14,
      destinationElevation: 0,
      sourceSocket: null,
      destinationSocket: null,
    },
    expectedAction: 'ladder',
    expectedSource: { x: 5, y: 14, z: 7 },
    expectedDestination: { x: 5, y: 0, z: 7 },
    configure(state) {
      state.connectorLadders = [{
        id: 'ladder-descending:mechanism',
        connectionId: 'ladder-descending',
        bottomY: 0,
        topY: 14,
        bottomExit: { x: 5, y: 0, z: 7 },
        topExit: { x: 5, y: 14, z: 7 },
      }];
    },
  },
  {
    label: 'ascending automatic lift',
    route: {
      connectionId: 'lift-ascending',
      traversalKind: 'automatic_lift',
      sourceElevation: -14,
      destinationElevation: 0,
      sourceSocket: null,
      destinationSocket: null,
    },
    expectedAction: 'automatic_lift',
    expectedSource: { x: -2 * TILE_SIZE, y: -14, z: 3 * TILE_SIZE },
    expectedDestination: { x: -2 * TILE_SIZE, y: 0, z: 6 * TILE_SIZE },
    configure(state) {
      state.connectorLifts = [{
        id: 'lift-ascending:mechanism',
        connectionId: 'lift-ascending',
      }];
      state.floorTiles = [
        {
          index: 0,
          x: -2,
          z: 3,
          elevation: -14,
          floorKey: '-2,3@y-14.000',
          traversalLinks: [{
            id: 'lift-ascending:mechanism:forward',
            targetId: 'lift-ascending:mechanism',
            action: 'automatic_lift',
            toFloorKey: '-2,6@y0.000',
          }],
        },
        {
          index: 1,
          x: -2,
          z: 6,
          elevation: 0,
          floorKey: '-2,6@y0.000',
          traversalLinks: [{
            id: 'lift-ascending:mechanism:reverse',
            targetId: 'lift-ascending:mechanism',
            action: 'automatic_lift',
            toFloorKey: '-2,3@y-14.000',
          }],
        },
      ];
    },
  },
];

for (const fixture of cases) {
  test(`public connector helper traverses ${fixture.label} forward and backward`, async () => {
    const state = makeBaseState(fixture.route);
    fixture.configure(state);
    const page = createFakePublicPage(state);
    const calls = [];
    const routeFollower = createFollower(
      state,
      fixture.route.connectionId,
      fixture.expectedAction,
      calls,
    );

    const result = await traversePublicConnectorBothWays(page, fixture.route, {
      routeFollower,
      approachTimeout: 100,
      legTimeout: 200,
      maximumReplans: 1,
    });

    assert.equal(result.connectionId, fixture.route.connectionId);
    assert.equal(result.expectedAction, fixture.expectedAction);
    assert.deepEqual(result.sourceAnchor, fixture.expectedSource);
    assert.deepEqual(result.destinationAnchor, fixture.expectedDestination);
    assert.deepEqual(calls.map(({ target }) => target), [
      fixture.expectedSource,
      fixture.expectedDestination,
      fixture.expectedSource,
    ]);
    assert.equal(calls[0].options.timeout, 100);
    assert.equal(calls[1].options.timeout, 200);
    assert.equal(calls[2].options.timeout, 200);
    assert.deepEqual(result.forward.traversedConnectorIds, [fixture.route.connectionId]);
    assert.deepEqual(result.reverse.traversedActions, [fixture.expectedAction]);
    assert.deepEqual(result.returnedPosition, fixture.expectedSource);
  });
}

test('public connector helper rejects a leg without connector-id proof', async () => {
  const fixture = cases[0];
  const state = makeBaseState(fixture.route);
  fixture.configure(state);
  const calls = [];
  await assert.rejects(
    traversePublicConnectorBothWays(
      createFakePublicPage(state),
      fixture.route,
      {
        routeFollower: createFollower(
          state,
          fixture.route.connectionId,
          fixture.expectedAction,
          calls,
          { omitConnectorOnCall: 1 },
        ),
      },
    ),
    /Forward connector leg did not physically traverse connector slope-ascending/,
  );
});

test('public connector helper rejects a reverse leg without its family action', async () => {
  const fixture = cases[1];
  const state = makeBaseState(fixture.route);
  fixture.configure(state);
  const calls = [];
  await assert.rejects(
    traversePublicConnectorBothWays(
      createFakePublicPage(state),
      fixture.route,
      {
        routeFollower: createFollower(
          state,
          fixture.route.connectionId,
          fixture.expectedAction,
          calls,
          { omitActionOnCall: 2 },
        ),
      },
    ),
    /Reverse connector leg did not perform ladder on connector ladder-descending/,
  );
});
