import assert from 'node:assert/strict';
import test from 'node:test';

import { DungeonGenerator } from '../src/DungeonGenerator.js';

test('augmented pre-landmark validation defers duplicate proofs while legacy validation remains eager', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const criticalDoorSentinel = { accepted: true, details: { sentinel: true } };
  let criticalDoorCallCount = 0;
  let connectorEntranceCallCount = 0;
  generator._validateCriticalDoorChokepoints = () => {
    criticalDoorCallCount += 1;
    return criticalDoorSentinel;
  };
  generator._validateConnectorEntranceWalkability = () => {
    connectorEntranceCallCount += 1;
    return { accepted: true };
  };

  const augmented = generator._createPreLandmarkDungeonAssemblyValidationState({
    augmentationApplied: true,
  });
  assert.equal(augmented.deferredUntilFinalCollision, true);
  assert.equal(augmented.criticalDoorValidation, null);
  assert.equal(augmented.connectorEntranceValidation, null);
  assert.equal(criticalDoorCallCount, 0);
  assert.equal(connectorEntranceCallCount, 0);

  const legacy = generator._createPreLandmarkDungeonAssemblyValidationState({
    augmentationApplied: false,
  });
  assert.equal(legacy.deferredUntilFinalCollision, false);
  assert.equal(legacy.criticalDoorValidation, criticalDoorSentinel);
  assert.equal(legacy.connectorEntranceValidation.accepted, true);
  assert.equal(legacy.connectorEntranceValidation.details.reason, 'augmentation-disabled');
  assert.equal(criticalDoorCallCount, 1);
  assert.equal(connectorEntranceCallCount, 0);
});

test('V1 forward and reverse floor proofs share lookup context without semantic drift', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const floorTiles = [{
    x: 0,
    z: 0,
    elevation: 0,
    roomId: 'v1-source',
    surface: 'floor',
  }, {
    x: 1,
    z: 0,
    elevation: 0,
    roomId: 'v1-source',
    surface: 'floor',
    traversalLinks: [{
      id: 'v1-one-way-service-link',
      toFloorKey: '4,0@y0.000',
      action: 'ladder',
    }],
  }, {
    x: 4,
    z: 0,
    elevation: 0,
    roomId: 'v1-destination',
    surface: 'floor',
  }];
  const startTile = floorTiles[0];
  const createFloorTileLookup = generator._createFloorTileLookup.bind(generator);
  let lookupBuildCount = 0;
  generator._createFloorTileLookup = (...args) => {
    lookupBuildCount += 1;
    return createFloorTileLookup(...args);
  };
  const runProofs = (traversalContext = null) => {
    const evaluatedEdges = [];
    const canTraverseEdge = (fromTile, toTile, action, link = null) => {
      evaluatedEdges.push({
        from: generator._getFloorTileGraphKey(fromTile),
        to: generator._getFloorTileGraphKey(toTile),
        action,
        linkId: link?.id ?? null,
      });
      return true;
    };
    const predecessorByFloorKey = new Map();
    const options = {
      canTraverseEdge,
      predecessorByFloorKey,
      ...(traversalContext ? { traversalContext } : {}),
    };
    const reachable = generator._createReachableFloorTileKeySet(
      startTile,
      floorTiles,
      options,
    );
    const returnable = generator._createFloorTileKeySetThatCanReach(
      startTile,
      floorTiles,
      {
        canTraverseEdge,
        ...(traversalContext ? { traversalContext } : {}),
      },
    );
    return {
      reachable: [...reachable],
      returnable: [...returnable],
      predecessors: [...predecessorByFloorKey],
      evaluatedEdges,
    };
  };

  const uncached = runProofs();
  assert.equal(lookupBuildCount, 2);
  lookupBuildCount = 0;
  const traversalContext = generator._createFloorTraversalLookupContext(floorTiles);
  const cached = runProofs(traversalContext);

  assert.equal(lookupBuildCount, 1);
  assert.deepEqual(cached, uncached);
  assert.deepEqual(cached.reachable, [
    '0,0@y0.000',
    '1,0@y0.000',
    '4,0@y0.000',
  ]);
  assert.deepEqual(cached.returnable, [
    '0,0@y0.000',
    '1,0@y0.000',
  ]);

  generator._createReachableFloorTileKeySet(
    startTile,
    [...floorTiles],
    { traversalContext },
  );
  assert.equal(
    lookupBuildCount,
    2,
    'a lookup context must not cross an immutable floor-array identity boundary',
  );
});

test('barrier traversal memo preserves direction and bypass semantics without rescanning zones', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const source = { x: 0, z: 0, elevation: 0 };
  const destination = { x: 1, z: 0, elevation: 0 };
  const barrierZones = [{ id: 'clear-a' }, { id: 'blocking' }, { id: 'clear-b' }];
  const evaluatedZoneIds = [];
  generator._doesFloorTraversalSegmentIntersectZone = (_from, _to, zone) => {
    evaluatedZoneIds.push(zone.id);
    return zone.id === 'blocking';
  };
  const canTraverse = generator._createMemoizedFloorTraversalBarrierPredicate(
    barrierZones,
    0.42,
  );

  assert.equal(canTraverse(source, destination, 'walk'), false);
  assert.deepEqual(evaluatedZoneIds, ['clear-a', 'blocking']);
  assert.equal(canTraverse(source, destination, 'walk'), false);
  assert.deepEqual(
    evaluatedZoneIds,
    ['clear-a', 'blocking'],
    'the same directed edge must reuse its exact collision result',
  );
  assert.equal(canTraverse(destination, source, 'walk'), false);
  assert.deepEqual(
    evaluatedZoneIds,
    ['clear-a', 'blocking', 'clear-a', 'blocking'],
    'reverse traversal remains an independently proved edge',
  );
  assert.equal(canTraverse(source, destination, 'ladder'), true);
  assert.equal(canTraverse(source, destination, 'automatic_lift'), true);
  assert.deepEqual(
    evaluatedZoneIds,
    ['clear-a', 'blocking', 'clear-a', 'blocking'],
    'explicit vertical links retain their collision bypass without consulting the cache',
  );
});

test('barrier spatial candidates preserve exact directed results while pruning distant zones', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const source = { x: 0, z: 0, elevation: 0 };
  const destination = { x: 1, z: 0, elevation: 0 };
  const clearParallelSource = { x: 0, z: 1, elevation: 0 };
  const clearParallelDestination = { x: 1, z: 1, elevation: 0 };
  const distantZones = Array.from({ length: 48 }, (_, index) => ({
    id: `distant-${index}`,
    position: { x: 70 + index * 14, y: 1, z: 0 },
    halfWidth: 0.1,
    halfDepth: 0.1,
    verticalHalfHeight: 1,
  }));
  const clearNearZone = {
    id: 'clear-near',
    position: { x: generator.tileSize * 0.5, y: 20, z: 0 },
    halfWidth: 0.1,
    halfDepth: 0.1,
    verticalHalfHeight: 0.1,
  };
  const blockingNearZone = {
    id: 'blocking-near',
    position: { x: generator.tileSize * 0.5, y: 1, z: 0 },
    halfWidth: 0.1,
    halfDepth: 0.1,
    verticalHalfHeight: 1,
    rotationY: Math.PI / 4,
  };
  const barrierZones = [
    ...distantZones.slice(0, 24),
    clearNearZone,
    blockingNearZone,
    ...distantZones.slice(24),
  ];
  const exactIntersection = generator
    ._doesFloorTraversalSegmentIntersectZone
    .bind(generator);
  const naiveCanTraverse = (from, to) => !barrierZones.some((zone) => (
    exactIntersection(from, to, zone, 0.42)
  ));
  const expectedForward = naiveCanTraverse(source, destination);
  const expectedReverse = naiveCanTraverse(destination, source);
  const expectedParallel = naiveCanTraverse(
    clearParallelSource,
    clearParallelDestination,
  );
  const evaluatedZoneIds = [];
  generator._doesFloorTraversalSegmentIntersectZone = (from, to, zone, padding) => {
    evaluatedZoneIds.push(zone.id);
    return exactIntersection(from, to, zone, padding);
  };
  const canTraverse = generator._createMemoizedFloorTraversalBarrierPredicate(
    barrierZones,
    0.42,
  );

  assert.equal(canTraverse(source, destination, 'walk'), expectedForward);
  assert.deepEqual(evaluatedZoneIds, ['clear-near', 'blocking-near']);
  assert.equal(canTraverse(source, destination, 'walk'), expectedForward);
  assert.deepEqual(
    evaluatedZoneIds,
    ['clear-near', 'blocking-near'],
    'the same directed edge remains memoized after spatial filtering',
  );
  assert.equal(canTraverse(destination, source, 'walk'), expectedReverse);
  assert.deepEqual(
    evaluatedZoneIds,
    ['clear-near', 'blocking-near', 'clear-near', 'blocking-near'],
    'the reverse edge independently executes the exact predicate in source order',
  );
  assert.equal(
    canTraverse(clearParallelSource, clearParallelDestination, 'walk'),
    expectedParallel,
  );
  assert.equal(evaluatedZoneIds.length, 4, 'a clear distant cell needs no exact zone checks');
  assert.equal(canTraverse(source, destination, 'ladder'), true);
  assert.equal(canTraverse(destination, source, 'automatic_lift'), true);
  assert.equal(evaluatedZoneIds.length, 4, 'vertical bypasses never query the spatial index');
});

test('zone candidate boundaries retain supplemental tolerance and exact support identities', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const boundaryTile = { x: 1, z: 0, elevation: 0 };
  const tolerantBoundaryZone = {
    id: 'tolerant-boundary',
    position: { x: generator.tileSize - 0.00005, y: 0, z: 0 },
    halfWidth: 0,
    halfDepth: 0.1,
    isDungeonSupplement: true,
  };
  const boundaryIndex = generator._createFloorTraversalZoneCandidateIndex(
    [tolerantBoundaryZone],
    0,
  );
  assert.deepEqual(
    boundaryIndex.getCandidates(boundaryTile, boundaryTile).map(({ id }) => id),
    ['tolerant-boundary'],
  );
  assert.equal(
    generator._isPositionInsideZone(
      generator._floorTileToWorld(boundaryTile),
      tolerantBoundaryZone,
    ),
    true,
    'the exact supplemental containment epsilon reaches across the cell boundary',
  );

  const identityTile = {
    x: 0,
    z: 0,
    elevation: 0,
    augmentationFloorCellId: 'identity-cell',
  };
  const identityZone = {
    id: 'distant-identity-zone',
    position: { x: generator.tileSize * 20, y: 1, z: 0 },
    halfWidth: 0.1,
    halfDepth: 0.1,
    verticalHalfHeight: 1,
    occupiedSupportCellIds: ['identity-cell'],
  };
  const occupiedSupportCellIdSets =
    generator._createSolidZoneOccupiedSupportCellIdSets([identityZone]);
  const identityIndex = generator._createFloorTraversalZoneCandidateIndex(
    [identityZone],
    0.42,
    occupiedSupportCellIdSets,
  );
  assert.deepEqual(
    identityIndex.getCandidates(identityTile, identityTile).map(({ id }) => id),
    [],
    'geometry-only lookup excludes the distant solid',
  );
  assert.equal(
    generator._isFloorTileBlockedBySolidZone(
      identityTile,
      [identityZone],
      occupiedSupportCellIdSets,
      identityIndex,
    ),
    true,
    'authoritative support identity reintroduces the exact matching solid',
  );
});

test('compiled support-cell occupancy is reused without changing exact identity blocking', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const occupiedSupportCellIds = ['fixture-cell'];
  const nativeMap = occupiedSupportCellIds.map.bind(occupiedSupportCellIds);
  let supportIdNormalizationCount = 0;
  occupiedSupportCellIds.map = (...args) => {
    supportIdNormalizationCount += 1;
    return nativeMap(...args);
  };
  const zone = {
    id: 'fixture-solid',
    occupiedSupportCellIds,
    isDungeonSupplement: false,
  };
  const occupiedSupportCellIdSets =
    generator._createSolidZoneOccupiedSupportCellIdSets([zone]);
  assert.equal(supportIdNormalizationCount, 1);

  const occupiedFloor = {
    x: 0,
    z: 0,
    elevation: 0,
    augmentationFloorCellId: 'fixture-cell',
  };
  const unrelatedFloor = {
    x: 0,
    z: 0,
    elevation: 0,
    augmentationFloorCellId: 'other-cell',
  };
  assert.equal(
    generator._isFloorTileBlockedBySolidZone(
      occupiedFloor,
      [zone],
      occupiedSupportCellIdSets,
    ),
    true,
  );
  assert.equal(
    generator._isFloorTileBlockedBySolidZone(
      occupiedFloor,
      [zone],
      occupiedSupportCellIdSets,
    ),
    true,
  );
  assert.equal(
    generator._isFloorTileBlockedBySolidZone(
      unrelatedFloor,
      [zone],
      occupiedSupportCellIdSets,
    ),
    false,
  );
  assert.equal(
    supportIdNormalizationCount,
    1,
    'the immutable invocation lookup must normalize each zone only once',
  );
});

test('linear barrier deduplication preserves legacy first-occurrence identity rules', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const shared = { id: null, position: { x: 0, y: 0, z: 0 } };
  const firstUndefined = { position: { x: 1, y: 0, z: 0 } };
  const secondUndefined = { position: { x: 2, y: 0, z: 0 } };
  const firstNamed = { id: 'same', position: { x: 3, y: 0, z: 0 } };
  const secondNamed = { id: 'same', position: { x: 4, y: 0, z: 0 } };
  const firstNaN = { id: Number.NaN, position: { x: 5, y: 0, z: 0 } };
  const secondNaN = { id: Number.NaN, position: { x: 6, y: 0, z: 0 } };

  assert.deepEqual(
    generator._deduplicateFloorTraversalZonesById([
      firstUndefined,
      secondUndefined,
      firstNamed,
      secondNamed,
      firstNaN,
      secondNaN,
      { id: 'missing-position' },
    ]),
    [firstUndefined, firstNamed, firstNaN, secondNaN],
    'platform and connector strict lists deduplicate undefined IDs but retain NaN IDs',
  );
  assert.deepEqual(
    generator._deduplicateDoorTraversalZones([
      shared,
      shared,
      firstUndefined,
      secondUndefined,
      firstNamed,
      secondNamed,
      firstNaN,
      secondNaN,
    ]),
    [shared, firstUndefined, secondUndefined, firstNamed, firstNaN, secondNaN],
    'door lists deduplicate object identity and equal non-null IDs only',
  );
});
