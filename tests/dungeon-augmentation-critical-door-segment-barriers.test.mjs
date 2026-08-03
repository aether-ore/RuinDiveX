import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';

test('augmented critical-door validation cannot graph-walk through an unrelated boundary wall', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const floor = (x, z, roomId) => ({
    x,
    z,
    elevation: 0,
    type: 'floor',
    surface: 'floor',
    roomId,
  });
  const floorTiles = [
    floor(0, 0, 'hubTown'),
    floor(1, 0, 'sourceRoom'),
    floor(1, 1, 'sourceRoom'),
    floor(2, 1, 'destinationRoom'),
    floor(2, 0, 'destinationRoom'),
  ];
  const rooms = [{
    id: 'hubTown', type: 'hub', x: 0, z: 0, width: 1, depth: 1, baseElevation: 0,
  }, {
    id: 'sourceRoom', type: 'industrial', x: 1, z: 0, width: 1, depth: 1, baseElevation: 0,
  }, {
    id: 'destinationRoom', type: 'bonus', x: 2, z: 0, width: 1, depth: 1, baseElevation: 0,
  }];
  const remoteThresholdWing = (id, thresholdSide) => ({
    id,
    thresholdSide,
    position: new THREE.Vector3(100, 1.5, 100),
    halfWidth: 0.2,
    halfDepth: 0.2,
    verticalHalfHeight: 1.5,
  });
  const door = {
    id: 'fixtureLockedDoor',
    fromRoomId: 'sourceRoom',
    toRoomId: 'destinationRoom',
    closed: true,
    locked: true,
    thresholdAnchored: true,
    thresholdWallZones: [
      remoteThresholdWing('fixture-left-wing', 'left'),
      remoteThresholdWing('fixture-right-wing', 'right'),
    ],
    alongX: true,
    position: new THREE.Vector3(generator.tileSize * 1.5, 0, 0),
    graphBlockingPosition: new THREE.Vector3(generator.tileSize * 1.5, 0, 0),
    collisionHalfWidth: 0.16,
    collisionHalfDepth: generator.tileSize * 0.48,
    collisionHeight: 3.15,
    baseY: 0,
  };
  const specification = {
    floorTiles,
    rooms,
    solidZones: [],
    doors: [door],
    useSegmentBarriers: true,
  };
  const reachableProofCalls = [];
  const createReachableFloorTileKeySet = generator._createReachableFloorTileKeySet;
  const createFloorTileLookup = generator._createFloorTileLookup;
  let floorTraversalLookupBuildCount = 0;
  generator._createFloorTileLookup = function (...args) {
    floorTraversalLookupBuildCount += 1;
    return createFloorTileLookup.apply(this, args);
  };
  generator._createReachableFloorTileKeySet = function (...args) {
    const options = args[2] ?? {};
    reachableProofCalls.push({
      capturesPredecessors: options.predecessorByFloorKey instanceof Map,
      usesSegmentBarrierPredicate: typeof options.canTraverseEdge === 'function',
    });
    return createReachableFloorTileKeySet.apply(this, args);
  };

  const wallBlindValidation = generator._validateCriticalDoorChokepoints(specification);
  assert.equal(
    wallBlindValidation.details.checks[0].destinationReachableWhileClosed,
    true,
    'the alternate four-edge route is reachable when its intervening wall is omitted',
  );
  assert.deepEqual(
    reachableProofCalls,
    [{
      capturesPredecessors: false,
      usesSegmentBarrierPredicate: true,
    }, {
      capturesPredecessors: true,
      usesSegmentBarrierPredicate: true,
    }],
    'a failed chokepoint proof should replay the identical flood only to capture diagnostics',
  );
  assert.equal(
    floorTraversalLookupBuildCount,
    1,
    'the diagnostic replay must reuse the door cut\'s immutable floor lookup',
  );
  assert.deepEqual(
    wallBlindValidation.details.checks[0].bypassPathTail,
    [{
      floorKey: '0,0@y0.000',
      roomId: 'hubTown',
      connectionId: null,
      surface: 'floor',
      traversalAction: null,
      traversalLinkId: null,
    }, {
      floorKey: '1,0@y0.000',
      roomId: 'sourceRoom',
      connectionId: null,
      surface: 'floor',
      traversalAction: 'walk',
      traversalLinkId: null,
    }, {
      floorKey: '1,1@y0.000',
      roomId: 'sourceRoom',
      connectionId: null,
      surface: 'floor',
      traversalAction: 'walk',
      traversalLinkId: null,
    }, {
      floorKey: '2,1@y0.000',
      roomId: 'destinationRoom',
      connectionId: null,
      surface: 'floor',
      traversalAction: 'walk',
      traversalLinkId: null,
    }, {
      floorKey: '2,0@y0.000',
      roomId: 'destinationRoom',
      connectionId: null,
      surface: 'floor',
      traversalAction: 'walk',
      traversalLinkId: null,
    }],
    'the lazy replay must preserve the eager bypass path exactly',
  );
  assert.deepEqual(
    wallBlindValidation.details.checks[0].bypassDestinationEntryEdges,
    [{
      from: wallBlindValidation.details.checks[0].bypassPathTail[2],
      to: wallBlindValidation.details.checks[0].bypassPathTail[3],
      intersectingSegmentBarrierZoneIds: [],
      intersectingActiveDoorBarrierZoneIds: [],
    }],
    'the lazy replay must preserve destination-entry diagnostics exactly',
  );

  const alternateRouteWall = {
    id: 'fixture-boundary-wall',
    obstacleKind: 'boundaryWall',
    position: new THREE.Vector3(generator.tileSize * 1.5, 1.5, generator.tileSize),
    halfWidth: 0.1,
    halfDepth: generator.tileSize * 0.48,
    verticalHalfHeight: 1.5,
  };
  const unrelatedSourceApproachWall = {
    id: 'fixture-unrelated-source-wall',
    obstacleKind: 'boundaryWall',
    position: new THREE.Vector3(generator.tileSize * 0.5, 1.5, 0),
    halfWidth: 0.1,
    halfDepth: generator.tileSize * 0.48,
    verticalHalfHeight: 1.5,
  };
  const barrierAwareValidation = generator._validateCriticalDoorChokepoints({
    ...specification,
    segmentBarrierZones: [unrelatedSourceApproachWall, alternateRouteWall],
  });
  assert.equal(barrierAwareValidation.accepted, true, barrierAwareValidation.errors.join('\n'));
  assert.equal(
    barrierAwareValidation.details.checks[0].sourceReachable,
    true,
    'a static wall outside the destination cut must not block the unlocked source approach',
  );
  assert.equal(
    barrierAwareValidation.details.checks[0].destinationReachableWhileClosed,
    false,
  );
  assert.equal(
    barrierAwareValidation.details.checks[0].destinationFloorKey,
    '2,0@y0.000',
  );
  assert.equal(
    barrierAwareValidation.details.checks[0].destinationFloorOwnerId,
    'destinationRoom',
  );
  assert.deepEqual(
    reachableProofCalls.slice(2),
    [{
      capturesPredecessors: false,
      usesSegmentBarrierPredicate: true,
    }],
    'an accepted chokepoint proof should flood once without predecessor capture',
  );
  assert.equal(
    floorTraversalLookupBuildCount,
    2,
    'each distinct door validation invocation owns exactly one lookup context',
  );
  assert.equal(
    Object.hasOwn(barrierAwareValidation.details.checks[0], 'bypassPathTail'),
    false,
  );
});

test('critical-door validation computes static floor occupancy once for every locked gate', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const floorTiles = [
    { x: 0, z: 0, elevation: 0, type: 'floor', surface: 'floor', roomId: 'hubTown' },
    { x: 1, z: 0, elevation: 0, type: 'floor', surface: 'floor', roomId: 'sourceRoom' },
    { x: 2, z: 0, elevation: 0, type: 'floor', surface: 'floor', roomId: 'destinationRoom' },
  ];
  const rooms = [
    { id: 'hubTown', type: 'hub', x: 0, z: 0, width: 1, depth: 1, baseElevation: 0 },
    { id: 'sourceRoom', type: 'industrial', x: 1, z: 0, width: 1, depth: 1, baseElevation: 0 },
    { id: 'destinationRoom', type: 'bonus', x: 2, z: 0, width: 1, depth: 1, baseElevation: 0 },
  ];
  const makeDoor = (id) => ({
    id,
    fromRoomId: 'sourceRoom',
    toRoomId: 'destinationRoom',
    closed: true,
    locked: true,
    thresholdAnchored: true,
    thresholdWallZones: [
      { id: `${id}:left`, thresholdSide: 'left', position: new THREE.Vector3(100, 1, 100) },
      { id: `${id}:right`, thresholdSide: 'right', position: new THREE.Vector3(100, 1, 100) },
    ],
    alongX: true,
    position: new THREE.Vector3(generator.tileSize * 1.5, 0, 0),
    graphBlockingPosition: new THREE.Vector3(generator.tileSize * 1.5, 0, 0),
    collisionHalfWidth: 0.16,
    collisionHalfDepth: generator.tileSize * 0.48,
    collisionHeight: 3.15,
    baseY: 0,
  });
  let solidOccupancyChecks = 0;
  let generatedPlatformChecks = 0;
  const isFloorTileBlockedBySolidZone = generator._isFloorTileBlockedBySolidZone;
  const isFloorTileBlockedByGeneratedPlatform = generator._isFloorTileBlockedByGeneratedPlatform;
  generator._isFloorTileBlockedBySolidZone = function (...args) {
    solidOccupancyChecks += 1;
    return isFloorTileBlockedBySolidZone.apply(this, args);
  };
  generator._isFloorTileBlockedByGeneratedPlatform = function (...args) {
    generatedPlatformChecks += 1;
    return isFloorTileBlockedByGeneratedPlatform.apply(this, args);
  };

  const validation = generator._validateCriticalDoorChokepoints({
    floorTiles,
    rooms,
    solidZones: [],
    doors: [makeDoor('firstDoor'), makeDoor('secondDoor')],
    useSegmentBarriers: true,
  });

  assert.equal(validation.accepted, true, validation.errors.join('\n'));
  assert.equal(validation.details.checkedDoorCount, 2);
  assert.equal(solidOccupancyChecks, floorTiles.length);
  assert.equal(generatedPlatformChecks, floorTiles.length);
});
