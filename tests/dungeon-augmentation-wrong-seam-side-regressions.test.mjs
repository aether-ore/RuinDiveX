import assert from 'node:assert/strict';
import test from 'node:test';

import { createDungeonRouteEndpointSeam } from '../src/dungeon-augmentation/geometry.js';
import { materializeIndustrialOverlay } from '../src/dungeon-augmentation/IndustrialOverlayMaterializer.js';

const TILE_SIZE = 2.8;
const PROFILE_ID = 'industrial-supplement-preview-v4';
const REGION_ID = 'industrial-v1:main-region';
const THEME_BINDING = Object.freeze({
  themeId: 'industrial-v1',
  themeSessionId: 'wrong-seam-side-canonical-regression',
});

const CANONICAL_WRONG_SEAM_PATHS = Object.freeze([
  Object.freeze({
    label: 'pyramid network 0 segment 1',
    routeNetworkIndex: 0,
    segmentIndex: 1,
    routeSlug: 'industrial-v1-main-region-route-network-grant-keycard-pyramid-loop',
    grantId: `${REGION_ID}:route-network-grant:keycard-pyramid-loop`,
    routeNetworkKind: 'landmark-perimeter-loop',
    source: Object.freeze({
      nodeId: 'keycardRoom',
      position: Object.freeze({ x: -82.6, y: 14, z: 98 }),
      facing: Object.freeze({ x: -1, y: 0, z: 0 }),
    }),
    destination: Object.freeze({
      nodeId: 'supplement:pyramid-loop:node:3',
      position: Object.freeze({ x: -95.2, y: 14, z: 98 }),
      facing: Object.freeze({ x: 1, y: 0, z: 0 }),
    }),
    expectedSourceLeadX: Object.freeze([-29, -30, -31]),
    expectedDestinationLeadX: Object.freeze([-32, -33, -34]),
    expectedPathX: Object.freeze([-29, -30, -31, -32, -33, -34]),
    expectedGridZ: 35,
  }),
  Object.freeze({
    label: 'enemyNest_keycardRoom network 1 segment 1',
    routeNetworkIndex: 1,
    segmentIndex: 1,
    routeSlug: 'industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom',
    grantId: `${REGION_ID}:route-network-grant:coverage:enemyNest_keycardRoom`,
    routeNetworkKind: 'objective-route-coverage',
    source: Object.freeze({
      nodeId: 'supplement:enemyNest-keycard:node:0',
      position: Object.freeze({ x: -54.6, y: 14, z: 58.8 }),
      facing: Object.freeze({ x: -1, y: 0, z: 0 }),
    }),
    destination: Object.freeze({
      nodeId: 'supplement:enemyNest-keycard:node:1',
      position: Object.freeze({ x: -74.2, y: 14, z: 58.8 }),
      facing: Object.freeze({ x: 1, y: 0, z: 0 }),
    }),
    expectedSourceLeadX: Object.freeze([-19, -20, -21]),
    expectedDestinationLeadX: Object.freeze([-25, -26, -27]),
    expectedPathX: Object.freeze([-19, -20, -21, -22, -23, -24, -25, -26, -27]),
    expectedGridZ: 21,
  }),
  Object.freeze({
    label: 'trapRoom_conveyorRoom network 3 segment 0',
    routeNetworkIndex: 3,
    segmentIndex: 0,
    routeSlug: 'industrial-v1-main-region-route-network-grant-coverage-traproom_conveyorroom',
    grantId: `${REGION_ID}:route-network-grant:coverage:trapRoom_conveyorRoom`,
    routeNetworkKind: 'objective-route-coverage',
    source: Object.freeze({
      nodeId: 'trapRoom',
      position: Object.freeze({ x: -40.6, y: 14, z: 179.2 }),
      facing: Object.freeze({ x: 1, y: 0, z: 0 }),
    }),
    destination: Object.freeze({
      nodeId: 'supplement:trap-conveyor:node:0',
      position: Object.freeze({ x: -35, y: 14, z: 179.2 }),
      facing: Object.freeze({ x: -1, y: 0, z: 0 }),
    }),
    expectedSourceLeadX: Object.freeze([-15, -14, -13]),
    expectedDestinationLeadX: Object.freeze([-14, -13, -12]),
    expectedPathX: Object.freeze([-15, -14, -13, -12]),
    expectedGridZ: 64,
  }),
  Object.freeze({
    label: 'conveyorRoom_bossRoom network 4 segment 0',
    routeNetworkIndex: 4,
    segmentIndex: 0,
    routeSlug: 'industrial-v1-main-region-route-network-grant-coverage-conveyorroom_bossroom',
    grantId: `${REGION_ID}:route-network-grant:coverage:conveyorRoom_bossRoom`,
    routeNetworkKind: 'objective-route-coverage',
    source: Object.freeze({
      nodeId: 'conveyorRoom',
      position: Object.freeze({ x: -35, y: 0, z: 322 }),
      facing: Object.freeze({ x: -1, y: 0, z: 0 }),
    }),
    destination: Object.freeze({
      nodeId: 'supplement:conveyor-boss:node:0',
      position: Object.freeze({ x: -43.4, y: 0, z: 322 }),
      facing: Object.freeze({ x: 1, y: 0, z: 0 }),
    }),
    expectedSourceLeadX: Object.freeze([-12, -13, -14]),
    expectedDestinationLeadX: Object.freeze([-13, -14, -15]),
    expectedPathX: Object.freeze([-12, -13, -14, -15]),
    expectedGridZ: 115,
  }),
]);

function segmentIdFor(fixture) {
  return `supplement:industrial-v1-main-region:routenetwork:${fixture.routeNetworkIndex}`
    + `:segment:${fixture.segmentIndex}:${fixture.routeSlug}`;
}

function operationIdFor(fixture) {
  return `supplement:industrial-v1-main-region:routenetwork:${fixture.routeNetworkIndex}`
    + `:operation:0:${fixture.routeSlug}`;
}

function routeSocket(fixture, endpoint, role) {
  return {
    kind: 'parentSocket',
    id: `${fixture.grantId}:canonical-regression:${role}`,
    socketId: `${fixture.grantId}:canonical-regression:${role}`,
    nodeId: endpoint.nodeId,
    roomId: endpoint.nodeId,
    position: { ...endpoint.position },
    facing: { ...endpoint.facing },
    widthMeters: TILE_SIZE * 3,
    heightMeters: 3.6,
    landingWidthTiles: 3,
    state: 'connected',
  };
}

function endpointSeam(fixture, socket, role) {
  return createDungeonRouteEndpointSeam(socket, {
    id: `${segmentIdFor(fixture)}:${role}-endpoint-seam`,
    segmentId: segmentIdFor(fixture),
    operationId: operationIdFor(fixture),
    networkId: operationIdFor(fixture),
    nodeId: socket.nodeId,
    socketId: socket.id,
    role,
    tileSize: TILE_SIZE,
    elevationBand: fixture.source.position.y === 0 ? 0 : 1,
  });
}

function centerLaneLead(seam, depths) {
  return depths.map((signedDepthTiles) => {
    const cell = seam.orderedCells.find((candidate) => (
      candidate.lane === 0 && candidate.signedDepthTiles === signedDepthTiles
    ));
    assert.ok(cell, `${seam.id} is missing center-lane depth ${signedDepthTiles}`);
    return { x: cell.gridX, z: cell.gridZ };
  });
}

function assertExactSeamLattice(seam) {
  assert.equal(seam.orderedCells.length, 15);
  assert.equal(new Set(seam.orderedCells.map(({ gridX, gridZ }) => `${gridX},${gridZ}`)).size, 15);

  const byIdentity = new Map(seam.orderedCells.map((cell) => (
    [`${cell.signedDepthTiles},${cell.lane}`, cell]
  )));
  for (const cell of seam.orderedCells) {
    const nextDepth = byIdentity.get(`${cell.signedDepthTiles + 1},${cell.lane}`);
    if (nextDepth) {
      assert.equal(
        Math.abs(nextDepth.gridX - cell.gridX) + Math.abs(nextDepth.gridZ - cell.gridZ),
        1,
        `${seam.id} skips a grid cell between depth ${cell.signedDepthTiles} and ${cell.signedDepthTiles + 1}`,
      );
    }
    const nextLane = byIdentity.get(`${cell.signedDepthTiles},${cell.lane + 1}`);
    if (nextLane) {
      assert.equal(
        Math.abs(nextLane.gridX - cell.gridX) + Math.abs(nextLane.gridZ - cell.gridZ),
        1,
        `${seam.id} skips a grid cell between lanes ${cell.lane} and ${cell.lane + 1}`,
      );
    }
  }
}

function authoredRoom(endpoint) {
  const thresholdGridX = Math.round(Number(endpoint.position.x.toFixed(6)) / TILE_SIZE);
  const thresholdGridZ = Math.round(Number(endpoint.position.z.toFixed(6)) / TILE_SIZE);
  return {
    id: endpoint.nodeId,
    x: thresholdGridX - endpoint.facing.x * 2,
    z: thresholdGridZ - endpoint.facing.z * 2,
    width: 5,
    depth: 5,
    baseElevation: endpoint.position.y,
    plannedBaseElevation: endpoint.position.y,
    suppressRoomGeometry: true,
    exitSockets: [],
  };
}

function materializeCanonicalPath(fixture) {
  const operationId = operationIdFor(fixture);
  const segmentId = segmentIdFor(fixture);
  const from = routeSocket(fixture, fixture.source, 'from');
  const to = routeSocket(fixture, fixture.destination, 'to');
  const endpointSeams = [
    endpointSeam(fixture, from, 'from'),
    endpointSeam(fixture, to, 'to'),
  ];
  const segment = {
    id: segmentId,
    operationId,
    connectorFamily: 'service-gallery',
    from,
    to,
    path: [{ ...from.position }, { ...to.position }],
    endpointSeams,
    bidirectional: true,
  };
  const operation = {
    id: operationId,
    type: 'routeNetwork',
    parentRegionId: REGION_ID,
    grantId: fixture.grantId,
    routeNetworkKind: fixture.routeNetworkKind,
    topologyTemplateId: 'canonical-wrong-seam-side-regression',
    progressionBandId: fixture.source.position.y === 0 ? 0 : 1,
    accessDomainId: `${REGION_ID}:access-domain:canonical-regression`,
    elevationModes: [],
    endpointSocketIds: [from.id, to.id],
    nodeIds: [],
    segmentIds: [segmentId],
    themeBinding: THEME_BINDING,
  };
  const result = materializeIndustrialOverlay({
    rooms: [authoredRoom(fixture.source), authoredRoom(fixture.destination)],
    overlayPlan: {
      profileId: PROFILE_ID,
      profileRevision: 5,
      difficulty: 1,
      operations: [operation],
      nodes: [],
      segments: [segment],
    },
    extensionRegions: [{
      id: REGION_ID,
      themeBinding: THEME_BINDING,
      routeNetworkGrants: [{
        id: fixture.grantId,
        kind: fixture.routeNetworkKind,
        routeNetworkKind: fixture.routeNetworkKind,
        endpointSockets: [from, to],
        progressionBandId: operation.progressionBandId,
        accessDomainId: operation.accessDomainId,
        themeBinding: THEME_BINDING,
      }],
    }],
    tileSize: TILE_SIZE,
  });
  return { endpointSeams, result, segmentId };
}

for (const fixture of CANONICAL_WRONG_SEAM_PATHS) {
  test(`${fixture.label} preserves exact seam leads and a bidirectional authoritative spine`, () => {
    const { endpointSeams, result, segmentId } = materializeCanonicalPath(fixture);
    const [fromSeam, toSeam] = endpointSeams;

    assertExactSeamLattice(fromSeam);
    assertExactSeamLattice(toSeam);
    assert.deepEqual(fromSeam.position, fixture.source.position);
    assert.deepEqual(toSeam.position, fixture.destination.position);
    assert.deepEqual(
      centerLaneLead(fromSeam, [0, 1, 2]),
      fixture.expectedSourceLeadX.map((x) => ({ x, z: fixture.expectedGridZ })),
    );
    assert.deepEqual(
      centerLaneLead(toSeam, [2, 1, 0]),
      fixture.expectedDestinationLeadX.map((x) => ({ x, z: fixture.expectedGridZ })),
    );

    assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
    assert.doesNotMatch(
      result.diagnostics.errors.join('\n'),
      /DUNGEON_AUGMENTATION_ROUTE_WRONG_SEAM_SIDE/,
    );
    const plan = result.connectionPlans.find(({ id }) => id === segmentId);
    assert.ok(plan);
    const expectedPath = fixture.expectedPathX.map((x) => ({ x, z: fixture.expectedGridZ }));
    assert.deepEqual(plan.fullPath, expectedPath);
    assert.deepEqual(plan.fullPath.slice(0, 3), expectedPath.slice(0, 3));
    assert.deepEqual(plan.fullPath.slice(-3), expectedPath.slice(-3));
    assert.deepEqual(
      plan.authoritativeTraversalSpine.requiredFloorKeys,
      expectedPath.map(({ x, z }) => (
        `${x},${z}@y${Number(fixture.source.position.y).toFixed(3)}`
      )),
    );
    assert.equal(plan.authoritativeTraversalSpine.precommitTraversal.forwardAccepted, true);
    assert.equal(plan.authoritativeTraversalSpine.precommitTraversal.reverseAccepted, true);
    assert.equal(
      plan.authoritativeTraversalSpine.precommitTraversal.forwardReachableCellCount,
      expectedPath.length,
    );
    assert.equal(
      plan.authoritativeTraversalSpine.precommitTraversal.reverseReachableCellCount,
      expectedPath.length,
    );
  });
}
