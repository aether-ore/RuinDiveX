import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROUTE_NETWORK_CAP_PLANNING_CONSTANTS,
  routeNetworkInactiveSocketCapPlanningVolume,
  routeNetworkInactiveSocketCapPlanningVolumes,
  validateRouteNetworkInactiveSocketCapPlanningVolumes,
} from '../src/dungeon-augmentation/routeNetworkCapPlanning.js';
import {
  nodePlanningCollisionScore,
  routeNetworkPlanningOverlapIsGranted,
} from '../src/dungeon-augmentation/planner.js';

const baseCenter = { x: 100, y: 10, z: 200 };
const localSize = { x: 14, y: 8.4, z: 19.6 };

function fixture({ id, turns, facing, position }) {
  const node = {
    id: `node:${id}`,
    placement: {
      center: { ...baseCenter },
      rotationQuarterTurns: turns,
    },
    size: { ...localSize },
    sockets: [],
  };
  const socket = {
    id: `socket:${id}`,
    localSocketId: 'exit',
    nodeId: node.id,
    state: 'capped',
    position: { ...position },
    facing: { ...facing, y: 0 },
    widthMeters: 8.4,
    heightMeters: 5.6,
  };
  node.sockets.push(socket);
  return { node, socket };
}

test('inactive socket cap volumes mirror assembler dimensions on all cardinal walls', () => {
  const thickness = 0.22 * 1.18;
  const fixtures = [
    {
      id: 'south',
      turns: 0,
      facing: { x: 0, z: 1 },
      position: { x: 102.8, y: 15.6, z: 208.4 },
      expectedCenter: { x: 102.8, y: 12.8, z: 209.8 },
      expectedSize: { x: 8.4, y: 5.6, z: thickness },
    },
    {
      id: 'east',
      turns: 1,
      facing: { x: 1, z: 0 },
      position: { x: 108.4, y: 15.6, z: 202.8 },
      expectedCenter: { x: 109.8, y: 12.8, z: 202.8 },
      expectedSize: { x: thickness, y: 5.6, z: 8.4 },
    },
    {
      id: 'north',
      turns: 2,
      facing: { x: 0, z: -1 },
      position: { x: 97.2, y: 15.6, z: 191.6 },
      expectedCenter: { x: 97.2, y: 12.8, z: 190.2 },
      expectedSize: { x: 8.4, y: 5.6, z: thickness },
    },
    {
      id: 'west',
      turns: 3,
      facing: { x: -1, z: 0 },
      position: { x: 91.6, y: 15.6, z: 197.2 },
      expectedCenter: { x: 90.2, y: 12.8, z: 197.2 },
      expectedSize: { x: thickness, y: 5.6, z: 8.4 },
    },
  ];

  for (const entry of fixtures) {
    const { node, socket } = fixture(entry);
    const volume = routeNetworkInactiveSocketCapPlanningVolume(node, socket);
    assert.deepEqual(volume.center, entry.expectedCenter, entry.id);
    assert.deepEqual(volume.size, entry.expectedSize, entry.id);
    assert.equal(volume.nodeId, node.id, entry.id);
    assert.equal(volume.socketId, socket.id, entry.id);
    assert.equal(volume.planningOnly, true, entry.id);
  }
  assert.equal(
    ROUTE_NETWORK_CAP_PLANNING_CONSTANTS.capThicknessMultiplier,
    1.18,
  );
});

test('active or claimed sockets do not receive planning caps', () => {
  const { node, socket } = fixture({
    id: 'active',
    turns: 0,
    facing: { x: 0, z: 1 },
    position: { x: 100, y: 10, z: 208.4 },
  });
  assert.equal(
    routeNetworkInactiveSocketCapPlanningVolume(node, {
      ...socket,
      state: 'connected',
      segmentId: 'segment:1',
    }),
    null,
  );
  assert.equal(
    routeNetworkInactiveSocketCapPlanningVolume(node, socket, { claimed: true }),
    null,
  );
  assert.deepEqual(
    routeNetworkInactiveSocketCapPlanningVolumes([node], {
      claimedSocketIdsByNodeId: new Map([[node.id, new Set(['exit'])]]),
    }),
    [],
  );
});

test('cap overlap validation is deterministic and reports actionable conflict evidence', () => {
  const { node, socket } = fixture({
    id: 'conflict',
    turns: 0,
    facing: { x: 0, z: 1 },
    position: { x: 100, y: 10, z: 208.4 },
  });
  const cap = routeNetworkInactiveSocketCapPlanningVolume(node, socket);
  const owningNodeVolume = {
    id: `${node.id}:occupied:0`,
    ownerId: node.id,
    center: { ...cap.center },
    size: { x: 14, y: 8.4, z: 1 },
    purpose: 'supplement-room-occupied',
  };
  const routeVolume = {
    id: 'segment:crossing-cap:occupied:0',
    ownerId: 'segment:crossing-cap',
    center: { ...cap.center },
    size: { x: 8.4, y: 5.6, z: 8.4 },
    purpose: 'supplement-connector-occupied',
  };
  const distantVolume = {
    id: 'segment:distant:occupied:0',
    ownerId: 'segment:distant',
    center: { x: 300, y: 10, z: 300 },
    size: { x: 8.4, y: 5.6, z: 8.4 },
  };

  const forward = validateRouteNetworkInactiveSocketCapPlanningVolumes(
    [cap],
    [distantVolume, routeVolume, owningNodeVolume],
  );
  const reversed = validateRouteNetworkInactiveSocketCapPlanningVolumes(
    [cap],
    [owningNodeVolume, routeVolume, distantVolume],
  );
  assert.deepEqual(reversed, forward);
  assert.equal(forward.accepted, false);
  assert.equal(forward.code, 'route-network-inactive-socket-cap-overlap');
  assert.equal(forward.conflictCount, 1);
  assert.equal(forward.conflicts[0].nodeId, node.id);
  assert.equal(forward.conflicts[0].socketId, socket.id);
  assert.equal(forward.conflicts[0].obstacleId, routeVolume.id);
  assert.equal(forward.conflicts[0].obstaclePurpose, routeVolume.purpose);

  const owningNodeOnly = validateRouteNetworkInactiveSocketCapPlanningVolumes(
    [cap],
    [owningNodeVolume],
  );
  assert.equal(owningNodeOnly.accepted, true);
  assert.equal(owningNodeOnly.conflictCount, 0);
});

test('overlapping cap pairs are rejected even without external obstacles', () => {
  const first = {
    ...fixture({
      id: 'pair-a',
      turns: 0,
      facing: { x: 0, z: 1 },
      position: { x: 100, y: 10, z: 208.4 },
    }),
  };
  const second = fixture({
    id: 'pair-b',
    turns: 2,
    facing: { x: 0, z: -1 },
    position: { x: 100, y: 10, z: 211.2 },
  });
  second.node.placement.center.z = 219.6;
  const firstCap = routeNetworkInactiveSocketCapPlanningVolume(first.node, first.socket);
  const secondCap = routeNetworkInactiveSocketCapPlanningVolume(second.node, second.socket);
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(
      Math.abs(Number(secondCap.center[axis]) - Number(firstCap.center[axis])) <= 1e-9,
      axis,
    );
  }

  const result = validateRouteNetworkInactiveSocketCapPlanningVolumes(
    [secondCap, firstCap],
    [],
  );
  assert.equal(result.accepted, false);
  assert.equal(result.conflictCount, 1);
  assert.equal(result.conflicts[0].capVolumeId, firstCap.id);
  assert.equal(result.conflicts[0].obstacleId, secondCap.id);
});

test('socket-assignment backtracking can recover by claiming the cap-conflicting socket', () => {
  const node = {
    id: 'node:alternate-socket',
    placement: {
      center: { ...baseCenter },
      rotationQuarterTurns: 0,
    },
    size: { ...localSize },
    sockets: [{
      id: 'socket:alternate-socket:east',
      localSocketId: 'east',
      nodeId: 'node:alternate-socket',
      state: 'capped',
      position: { x: 107, y: 10, z: 200 },
      facing: { x: 1, y: 0, z: 0 },
      widthMeters: 8.4,
      heightMeters: 5.6,
    }, {
      id: 'socket:alternate-socket:west',
      localSocketId: 'west',
      nodeId: 'node:alternate-socket',
      state: 'capped',
      position: { x: 93, y: 10, z: 200 },
      facing: { x: -1, y: 0, z: 0 },
      widthMeters: 8.4,
      heightMeters: 5.6,
    }],
  };
  const eastCap = routeNetworkInactiveSocketCapPlanningVolume(
    node,
    node.sockets[0],
  );
  const blockingRoute = {
    id: 'segment:blocking-east-cap:occupied:0',
    ownerId: 'segment:blocking-east-cap',
    center: { ...eastCap.center },
    size: { x: 2.8, y: 5.6, z: 8.4 },
    purpose: 'supplement-connector-occupied',
  };
  const attemptClaim = (localSocketId) => {
    const caps = routeNetworkInactiveSocketCapPlanningVolumes([node], {
      claimedSocketIdsByNodeId: new Map([
        [node.id, new Set([localSocketId])],
      ]),
    });
    return {
      localSocketId,
      caps,
      validation: validateRouteNetworkInactiveSocketCapPlanningVolumes(
        caps,
        [blockingRoute],
      ),
    };
  };

  const blockedFirstChoice = attemptClaim('west');
  assert.equal(blockedFirstChoice.validation.accepted, false);
  assert.equal(blockedFirstChoice.validation.conflictCount, 1);
  assert.equal(
    blockedFirstChoice.validation.conflicts[0].socketId,
    'socket:alternate-socket:east',
  );

  const recoveredChoice = attemptClaim('east');
  assert.equal(recoveredChoice.validation.accepted, true);
  assert.deepEqual(
    recoveredChoice.caps.map(({ socketId }) => socketId),
    ['socket:alternate-socket:west'],
  );
  const firstAccepted = ['west', 'east']
    .map(attemptClaim)
    .find(({ validation }) => validation.accepted);
  assert.equal(firstAccepted.localSocketId, 'east');
  assert.deepEqual(attemptClaim('east'), recoveredChoice);
});

test('landmark-loop solids reject a finalized inactive room cap with stable evidence', () => {
  const { node, socket } = fixture({
    id: 'landmark-loop-conflict',
    turns: 0,
    facing: { x: 0, z: 1 },
    position: { x: 100, y: 10, z: 208.4 },
  });
  const cap = routeNetworkInactiveSocketCapPlanningVolume(node, socket);
  const owningRoomShell = {
    id: `${node.id}:blueprint-structural-shell-clearance`,
    ownerId: node.id,
    center: { ...cap.center },
    size: { x: 14, y: 8.4, z: 1 },
    purpose: 'supplement-room-clearance',
  };
  const landmarkLoopSolid = {
    id: 'landmark-loop:segment:7:occupied:0',
    ownerId: 'landmark-loop:segment:7',
    center: { ...cap.center },
    size: { x: 8.4, y: 5.6, z: 2.8 },
    purpose: 'supplement-landmark-perimeter-loop-occupied',
  };

  const first = validateRouteNetworkInactiveSocketCapPlanningVolumes(
    [cap],
    [owningRoomShell, landmarkLoopSolid],
  );
  const repeated = validateRouteNetworkInactiveSocketCapPlanningVolumes(
    [cap],
    [landmarkLoopSolid, owningRoomShell],
  );
  assert.deepEqual(repeated, first);
  assert.equal(first.accepted, false);
  assert.equal(first.code, 'route-network-inactive-socket-cap-overlap');
  assert.equal(first.conflictCount, 1);
  assert.equal(first.conflicts[0].obstacleId, landmarkLoopSolid.id);
  assert.equal(first.conflicts[0].obstaclePurpose, landmarkLoopSolid.purpose);
});

test('accepted cap reservations remain hard obstacles for later route networks', () => {
  const { node, socket } = fixture({
    id: 'prior-network',
    turns: 0,
    facing: { x: 0, z: 1 },
    position: { x: 100, y: 10, z: 208.4 },
  });
  const cap = routeNetworkInactiveSocketCapPlanningVolume(node, socket);
  const projectedPriorCap = {
    ...cap,
    center: { ...cap.center, y: 0 },
    size: { ...cap.size, y: 2048 },
    purpose: `${cap.purpose}:cross-network-xz-reservation`,
  };
  const laterNetworkSolid = {
    id: 'later-network:segment:occupied:0',
    ownerId: 'later-network:segment',
    center: { ...projectedPriorCap.center },
    size: { ...cap.size },
    purpose: 'supplement-connector-occupied',
  };
  const unrelatedEndpointSeam = {
    id: 'later-network:unowned-endpoint-overlap',
    center: { ...projectedPriorCap.center },
    size: { ...projectedPriorCap.size },
  };

  assert.equal(
    routeNetworkPlanningOverlapIsGranted(
      laterNetworkSolid,
      projectedPriorCap,
      [unrelatedEndpointSeam],
    ),
    false,
  );
  assert.equal(
    nodePlanningCollisionScore({
      id: 'later-network:node',
      grammarId: 'Through-T',
      occupiedVolumes: [laterNetworkSolid],
      clearanceVolumes: [],
    }, [projectedPriorCap], [unrelatedEndpointSeam]),
    1,
  );
});

test('final inactive caps are deterministic and disjoint from every non-owning solid', () => {
  const firstNode = {
    id: 'node:final-a',
    placement: {
      center: { x: 100, y: 10, z: 200 },
      rotationQuarterTurns: 0,
    },
    size: { ...localSize },
    sockets: [{
      id: 'socket:final-a:active',
      localSocketId: 'active',
      state: 'connected',
      segmentId: 'segment:final-a-to-b',
      position: { x: 107, y: 10, z: 200 },
      facing: { x: 1, y: 0, z: 0 },
      widthMeters: 8.4,
      heightMeters: 5.6,
    }, {
      id: 'socket:final-a:capped',
      localSocketId: 'capped',
      state: 'capped',
      position: { x: 100, y: 10, z: 208.4 },
      facing: { x: 0, y: 0, z: 1 },
      widthMeters: 8.4,
      heightMeters: 5.6,
    }],
  };
  const secondNode = {
    id: 'node:final-b',
    placement: {
      center: { x: 140, y: 10, z: 200 },
      rotationQuarterTurns: 0,
    },
    size: { ...localSize },
    sockets: [{
      id: 'socket:final-b:capped',
      localSocketId: 'capped',
      state: 'capped',
      position: { x: 140, y: 10, z: 191.6 },
      facing: { x: 0, y: 0, z: -1 },
      widthMeters: 8.4,
      heightMeters: 5.6,
    }],
  };
  const nodes = [firstNode, secondNode];
  const unchangedNodes = structuredClone(nodes);
  const caps = routeNetworkInactiveSocketCapPlanningVolumes(nodes);
  const reversedCaps = routeNetworkInactiveSocketCapPlanningVolumes(
    [...nodes].reverse().map((node) => ({
      ...node,
      sockets: [...node.sockets].reverse(),
    })),
  );
  assert.deepEqual(reversedCaps, caps);
  assert.deepEqual(nodes, unchangedNodes);
  assert.deepEqual(
    caps.map(({ socketId }) => socketId),
    ['socket:final-a:capped', 'socket:final-b:capped'],
  );
  assert.equal(caps.every(({ planningOnly }) => planningOnly === true), true);

  const finalSolids = [{
    id: 'node:final-a:occupied:0',
    ownerId: firstNode.id,
    center: { ...firstNode.placement.center },
    size: { x: 14, y: 8.4, z: 19.6 },
    purpose: 'supplement-room-occupied',
  }, {
    id: 'node:final-b:occupied:0',
    ownerId: secondNode.id,
    center: { ...secondNode.placement.center },
    size: { x: 14, y: 8.4, z: 19.6 },
    purpose: 'supplement-room-occupied',
  }, {
    id: 'segment:final-a-to-b:occupied:0',
    ownerId: 'segment:final-a-to-b',
    center: { x: 120, y: 12.8, z: 200 },
    size: { x: 26, y: 5.6, z: 8.4 },
    purpose: 'supplement-connector-occupied',
  }];
  const validation = validateRouteNetworkInactiveSocketCapPlanningVolumes(
    caps,
    finalSolids,
  );
  const reorderedValidation = validateRouteNetworkInactiveSocketCapPlanningVolumes(
    [...caps].reverse(),
    [...finalSolids].reverse(),
  );
  assert.deepEqual(reorderedValidation, validation);
  assert.equal(validation.accepted, true);
  assert.equal(validation.conflictCount, 0);
});
