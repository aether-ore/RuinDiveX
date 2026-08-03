import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectDungeonAugmentationAnchorPlacementFailureAttribution,
  collectDungeonAugmentationPhysicalFailureAttribution,
  DungeonGenerator,
} from '../src/DungeonGenerator.js';
import {
  DUNGEON_AUGMENTATION_OVERLAY_SCHEMA,
  DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA,
  DUNGEON_EXTENSION_HOST_V2_SCHEMA,
  DUNGEON_PROGRESSION_SNAPSHOT_V2_SCHEMA,
  DUNGEON_ROUTE_NETWORK_GRANT_V2_SCHEMA,
  DUNGEON_SELECTION_BAG_FAMILIES,
  DUNGEON_AUGMENTATION_SAVE_IDENTITY_SCHEMA,
  DUNGEON_AUGMENTATION_PROFILES,
  GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  DungeonAugmentationRandom,
  augmentDungeonDraft,
  canonicalStringify,
  computeDungeonAugmentationPlanHash,
  computeEffectiveDungeonPlanHash,
  createDungeonAugmentationProfile,
  createRouteNetworkConflictEntitySignature,
  createDungeonSelectionBag,
  createDungeonAugmentationSaveIdentity,
  createDungeonRouteEndpointSeam,
  createIndustrialAugmentationHost,
  createIndustrialBaseDraft,
  dungeonVolumesOverlap,
  dungeonSelectionBagCandidates,
  hashCanonicalValue,
  materializeIndustrialOverlay,
  normalizeRouteNetworkConflictExclusions,
  sanitizeDungeonAugmentationSaveIdentity,
  validateCommittedDungeonAugmentationIdentity,
  validateDungeonExtensionHost,
  validateDungeonAugmentationPlan,
  validateDungeonSelectionBagWitnessSequence,
} from '../src/dungeon-augmentation/index.js';

const SOURCE_THEME = Object.freeze({
  schema: 'ruindivex-dungeon-region-theme/v1',
  parentMapId: 'fixture-map',
  parentMapRevision: 'fixture-map-r1',
  parentRegionId: 'fixture-region',
  themeRef: { id: 'fixture-theme', revision: 'theme-r1', contentHash: 'fixture-content-a' },
  presentationVariantId: 'fixture-main',
  localLightingProfileId: 'fixture-lights',
  soundscapeProfileId: 'fixture-ambience',
});

const DESTINATION_THEME = Object.freeze({
  schema: 'ruindivex-dungeon-region-theme/v1',
  parentMapId: 'fixture-map',
  parentMapRevision: 'fixture-map-r1',
  parentRegionId: 'fixture-magma-region',
  themeRef: { id: 'fixture-magma', revision: 'magma-r3', contentHash: 'fixture-content-b' },
  presentationVariantId: 'fixture-magma-main',
  localLightingProfileId: 'fixture-magma-lights',
  soundscapeProfileId: 'fixture-magma-ambience',
});

const COMPLETE_CAPABILITIES = Object.freeze({
  materials: [
    'primary-floor', 'corridor-floor', 'wall', 'ceiling', 'support', 'cap',
    'catwalk', 'rail', 'ramp', 'warning',
  ],
  assets: ['frame', 'hazard', 'light-fixture', 'transition-frame'],
  connectors: ['service-gallery', 'slope', 'ladder', 'lift', 'transition-bay'],
  transitions: ['level-transition-bay'],
});

const requestedVerificationSeedCount = Number.parseInt(
  process.env.DUNGEON_AUGMENTATION_SEED_COUNT ?? '100',
  10,
);
const VERIFICATION_SEED_COUNT = Number.isFinite(requestedVerificationSeedCount)
  && requestedVerificationSeedCount >= 100
  ? requestedVerificationSeedCount
  : 100;

test('Industrial augmentation planning snapshots commit elevations without mutating the live V1 kit', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const rooms = [{
    id: 'source-room',
    plannedBaseElevation: 14,
    ceilingHeight: 8.4,
    exitSockets: [{ id: 'source-upper', roomId: 'source-room', elevation: 4.05 }],
  }, {
    id: 'destination-room',
    plannedBaseElevation: -14,
    ceilingHeight: 8.4,
    exitSockets: [{ id: 'destination-upper', roomId: 'destination-room', elevation: 4.05 }],
  }];
  const connectionPlans = [{
    id: 'upper-connection',
    level: 1,
    localElevation: 4.05,
    elevation: 4.05,
    fromRoomId: 'source-room',
    toRoomId: 'destination-room',
    fromSocket: { id: 'source-upper', roomId: 'source-room', elevation: 4.05 },
    toSocket: { id: 'destination-upper', roomId: 'destination-room', elevation: 4.05 },
  }];
  const liveSnapshot = structuredClone({ rooms, connectionPlans });

  const first = generator._createIndustrialDungeonAugmentationPlanningSnapshot({
    rooms,
    connectionPlans,
  });
  const second = generator._createIndustrialDungeonAugmentationPlanningSnapshot({
    rooms,
    connectionPlans,
  });

  assert.deepEqual({ rooms, connectionPlans }, liveSnapshot);
  assert.deepEqual(first, second);
  assert.equal(first.rooms[0].baseElevation, 14);
  assert.equal(first.rooms[1].baseElevation, -14);
  assert.equal(first.connectionPlans[0].sourceElevation, 18.05);
  assert.equal(first.connectionPlans[0].destinationElevation, -9.95);
  assert.equal(first.connectionPlans[0].fromSocket.elevation, 18.05);
  assert.equal(first.connectionPlans[0].toSocket.elevation, -9.95);
  assert.equal(first.rooms[0].exitSockets[0].elevation, 18.05);
  assert.equal(first.rooms[1].exitSockets[0].elevation, -9.95);
});

test('Industrial replay planning snapshots preserve resolved basement bounds', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const rooms = [{
    id: 'trapRoom',
    type: 'trap',
    x: 18,
    z: 58,
    width: 17,
    depth: 15,
    plannedBaseElevation: 28,
    baseElevation: 28,
    minY: 23.2,
    maximumWalkableY: 32.05,
    maxY: 43.2,
    ceilingHeight: 15.2,
    dropSpace: {
      lowerElevation: -4.8,
      lowerBounds: { minX: 12, maxX: 20, minZ: 55, maxZ: 63 },
    },
    ceilingY: 43.2,
    exitSockets: [],
  }];
  const planningSnapshot =
    generator._createIndustrialDungeonAugmentationPlanningSnapshot({
      rooms,
      connectionPlans: [],
    });

  assert.equal(planningSnapshot.rooms[0].minY, 23.2);
  assert.equal(planningSnapshot.rooms[0].maximumWalkableY, 32.05);
  assert.equal(planningSnapshot.rooms[0].maxY, 43.2);

  const baseDraft = createIndustrialBaseDraft({
    rooms: planningSnapshot.rooms,
    connectionPlans: [],
    tileSize: generator.tileSize,
  });
  const dropSpaceVolume = baseDraft.occupiedVolumes.find(({ id }) => (
    id === 'base:room:trapRoom:drop-space-occupied'
  ));
  assert.ok(dropSpaceVolume);
  assert.deepEqual(dropSpaceVolume.center, { x: 44.8, y: 33.2, z: 165.2 });
  assert.ok(Math.abs(dropSpaceVolume.size.x - 25.2) <= 1e-9);
  assert.ok(Math.abs(dropSpaceVolume.size.y - 20) <= 1e-9);
  assert.ok(Math.abs(dropSpaceVolume.size.z - 25.2) <= 1e-9);
});

test('a supplemental collision severing an authored drop-space egress excludes only its owning node', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const floor = (x, z, elevation, options = {}) => ({
    type: 'floor',
    surface: 'floor',
    roomId: 'trapRoom',
    x,
    z,
    elevation,
    level: elevation,
    ...options,
  });
  const floorKey = (tile) => generator._getFloorTileGraphKey(tile);
  const lowerTiles = [];
  for (let x = 0; x <= 6; x += 1) {
    for (let z = 0; z <= 5; z += 1) {
      lowerTiles.push(floor(x, z, -4.8, {
        surface: 'basementFloor',
        dropSpaceId: 'trapRoom_hazardDropSpace',
      }));
    }
  }
  const entryTiles = lowerTiles.filter(({ x, z }) => x === 0 && [2, 3].includes(z));
  for (const tile of entryTiles) tile.allowsGroundedDropLanding = true;
  const shelfTiles = [2, 3].map((z) => floor(6, z, -1.5, {
    surface: 'basementReturnShelf',
    isLedgeSurface: true,
    ledgeEdges: ['left'],
    supportBaseElevation: -4.8,
    platformPurpose: 'trapRoom_hazardDropSpace_return_climb_shelf',
    requiredTraversalAction: 'ledge_climb',
    dropSpaceId: 'trapRoom_hazardDropSpace',
  }));
  const exitTiles = [2, 3].map((z) => floor(7, z, 0));
  const entryLipTiles = [2, 3].map((z) => floor(-1, z, 0));
  const outsideRoute = [];
  for (let x = -1; x <= 7; x += 1) outsideRoute.push(floor(x, -1, 0));
  for (let z = 0; z <= 1; z += 1) {
    outsideRoute.push(floor(-1, z, 0), floor(7, z, 0));
  }
  const floorTiles = [
    ...lowerTiles,
    ...shelfTiles,
    ...exitTiles,
    ...entryLipTiles,
    ...outsideRoute,
  ];
  const lowerFloorKeys = lowerTiles
    .filter(({ x, z }) => !(x === 6 && [2, 3].includes(z)))
    .map(floorKey);
  const trapRoom = {
    id: 'trapRoom',
    type: 'trap',
    x: 3,
    z: 2,
    width: 19,
    depth: 15,
    baseElevation: 0,
    ceilingHeight: 12,
    dropSpace: {
      id: 'trapRoom_hazardDropSpace',
      roomId: 'trapRoom',
      lowerElevation: -4.8,
      lowerBounds: { minX: 0, maxX: 6, minZ: 0, maxZ: 5 },
      lowerFloorKeys,
      entryFloorKeys: entryTiles.map(floorKey),
      entryLipFloorKeys: entryLipTiles.map(floorKey),
      returnShelfFloorKeys: shelfTiles.map(floorKey),
      exitFloorKeys: exitTiles.map(floorKey),
      bridgeFloorKeys: [],
      returnDirectionX: 1,
      returnDirectionZ: 0,
    },
  };
  const operation = {
    id: 'operation:drop-egress-blocker',
    type: 'routeNetwork',
    grantId: 'grant:drop-egress-blocker',
    routeNetworkKind: 'objective-route-coverage',
  };
  const node = {
    id: 'node:drop-egress-blocker',
    operationId: operation.id,
    kind: 'supplementRoom',
    grammarId: 'industrial-switchback-room',
    placement: { center: { x: 18.2, y: 0, z: 7 }, rotationQuarterTurns: 0 },
    size: { x: 8.4, y: 5.6, z: 8.4 },
    sockets: [],
  };
  const blockingZone = {
    id: 'collision:drop-egress-blocker',
    roomId: node.id,
    operationId: operation.id,
    manifestCollisionRecordId: 'collision:drop-egress-blocker',
    moduleManifestId: 'module:drop-egress-blocker',
    obstacleKind: 'supplement-authored-cover',
    position: { x: 6.5 * generator.tileSize, y: -0.75, z: 2.5 * generator.tileSize },
    halfWidth: 0.08,
    halfDepth: generator.tileSize,
    verticalHalfHeight: 1.2,
    rotationY: 0,
    dungeonSupplement: true,
    isDungeonSupplement: true,
  };
  const validation = generator._validatePlatformability({
    floorTiles,
    rooms: [trapRoom],
    solidZones: [blockingZone],
    segmentBarrierZones: [blockingZone],
    useSegmentBarriers: true,
  });
  const dropCheck = validation.details.dropSpaceChecks[0];

  assert.equal(dropCheck.lowerReachable, true);
  assert.equal(dropCheck.canExit, false);
  assert.deepEqual(
    dropCheck.egressBlockingZoneIds,
    [blockingZone.id],
    JSON.stringify(dropCheck),
  );
  assert.deepEqual(dropCheck.egressBlockingZones, [{
    id: blockingZone.id,
    roomId: node.id,
    connectionId: null,
    operationId: operation.id,
    manifestCollisionRecordId: blockingZone.manifestCollisionRecordId,
    moduleManifestId: blockingZone.moduleManifestId,
    obstacleKind: blockingZone.obstacleKind,
    dungeonSupplement: true,
  }]);

  const attribution = collectDungeonAugmentationPhysicalFailureAttribution({
    augmentationOverlayPlan: {
      operations: [operation],
      nodes: [node],
      segments: [],
    },
    rooms: [trapRoom, { id: node.id, isDungeonSupplement: true }],
    connectionPlans: [],
    progression: { validation: { platformability: validation.details } },
  });
  assert.deepEqual(attribution.failedRouteNetworkGrants, [{
    grantId: operation.grantId,
    augmentationOperationId: operation.id,
    routeNetworkKind: operation.routeNetworkKind,
    connectionIds: [],
    roomIds: [node.id],
    socketIds: [],
    failureKinds: ['dropSpaceEgressChecks'],
  }]);
  assert.deepEqual(attribution.routeNetworkConflictExclusions, [{
    grantId: operation.grantId,
    entityKind: 'node',
    entityId: node.id,
    signature: createRouteNetworkConflictEntitySignature(node, 'node'),
    reason: 'route-network-runtime-physical-validation-failed',
  }]);

  const segment = {
    id: 'segment:drop-egress-blocker',
    operationId: operation.id,
    connectorFamily: 'service-gallery',
    from: { nodeId: 'parent-room', position: { x: 14, y: 0, z: 7 } },
    to: { nodeId: node.id, position: { x: 22.4, y: 0, z: 7 } },
    path: [
      { x: 14, y: 0, z: 7 },
      { x: 22.4, y: 0, z: 7 },
    ],
  };
  const segmentBlocker = {
    ...dropCheck.egressBlockingZones[0],
    roomId: null,
    connectionId: segment.id,
  };
  const segmentAttribution = collectDungeonAugmentationPhysicalFailureAttribution({
    augmentationOverlayPlan: {
      operations: [operation],
      nodes: [node],
      segments: [segment],
    },
    rooms: [trapRoom, { id: node.id, isDungeonSupplement: true }],
    connectionPlans: [{ id: segment.id }],
    progression: {
      validation: {
        platformability: {
          dropSpaceChecks: [{
            ...dropCheck,
            egressBlockingZones: [segmentBlocker],
          }],
        },
      },
    },
  });
  assert.deepEqual(segmentAttribution.routeNetworkConflictExclusions, [{
    grantId: operation.grantId,
    entityKind: 'segment',
    entityId: segment.id,
    signature: createRouteNetworkConflictEntitySignature(segment, 'segment'),
    reason: 'route-network-runtime-physical-validation-failed',
  }]);

  const ambiguousAttribution = collectDungeonAugmentationPhysicalFailureAttribution({
    augmentationOverlayPlan: {
      operations: [operation],
      nodes: [node],
      segments: [segment],
    },
    rooms: [trapRoom, { id: node.id, isDungeonSupplement: true }],
    connectionPlans: [{ id: segment.id }],
    progression: {
      validation: {
        platformability: {
          dropSpaceChecks: [{
            ...dropCheck,
            egressBlockingZones: [{
              ...segmentBlocker,
              roomId: node.id,
            }],
          }],
        },
      },
    },
  });
  assert.deepEqual(ambiguousAttribution.failedRouteNetworkGrants, []);
  assert.deepEqual(ambiguousAttribution.routeNetworkConflictExclusions, []);
});

test('a critical-door bypass entry excludes only its exact realized route-network entity', () => {
  const operation = {
    id: 'operation:critical-door-bypass',
    type: 'routeNetwork',
    grantId: 'grant:critical-door-bypass',
    routeNetworkKind: 'objective-route-coverage',
  };
  const node = {
    id: 'node:critical-door-bypass',
    operationId: operation.id,
    kind: 'supplementConnectorJunction',
    placement: {
      center: { x: -19.6, y: 0, z: 352.8 },
      rotationQuarterTurns: 0,
    },
    size: { x: 8.4, y: 5.6, z: 19.6 },
    sockets: [],
  };
  const segment = {
    id: 'segment:critical-door-bypass',
    operationId: operation.id,
    connectorFamily: 'service-gallery',
    from: { nodeId: 'parent-route', position: { x: -2.8, y: 0, z: 326.2 } },
    to: { nodeId: node.id, position: { x: -16.8, y: 0, z: 343 } },
    path: [
      { x: -2.8, y: 0, z: 326.2 },
      { x: -16.8, y: 0, z: 343 },
    ],
  };
  const createDungeon = (from) => ({
    augmentationOverlayPlan: {
      operations: [operation],
      nodes: [node],
      segments: [segment],
    },
    rooms: [{ id: 'shrineRoom' }],
    connectorJunctionProxies: [{ id: node.id, isConnectorJunctionProxy: true }],
    connectionPlans: [{ id: segment.id, isDungeonSupplement: true }],
    progression: {
      validation: {
        physicalProgression: {
          checks: [{
            doorId: 'Door_Shrine',
            toRoomId: 'shrineRoom',
            destinationReachableWhileClosed: true,
            bypassDestinationEntryEdges: [{
              from,
              to: {
                floorKey: '-7,130@y0.000',
                roomId: 'shrineRoom',
                connectionId: null,
              },
              intersectingSegmentBarrierZoneIds: [],
              intersectingActiveDoorBarrierZoneIds: [],
            }],
          }],
        },
      },
    },
  });

  const nodeAttribution = collectDungeonAugmentationPhysicalFailureAttribution(
    createDungeon({
      floorKey: '-7,129@y0.000',
      roomId: node.id,
      connectionId: null,
    }),
  );
  assert.deepEqual(nodeAttribution.failedRouteNetworkGrants, [{
    grantId: operation.grantId,
    augmentationOperationId: operation.id,
    routeNetworkKind: operation.routeNetworkKind,
    connectionIds: [],
    roomIds: [node.id],
    socketIds: [],
    failureKinds: ['critical-door-bypass-entry'],
  }]);
  assert.deepEqual(nodeAttribution.routeNetworkConflictExclusions, [{
    grantId: operation.grantId,
    entityKind: 'node',
    entityId: node.id,
    signature: createRouteNetworkConflictEntitySignature(node, 'node'),
    reason: 'route-network-runtime-physical-validation-failed',
  }]);

  const segmentAttribution = collectDungeonAugmentationPhysicalFailureAttribution(
    createDungeon({
      floorKey: '-7,129@y0.000',
      roomId: null,
      connectionId: segment.id,
    }),
  );
  assert.deepEqual(segmentAttribution.failedRouteNetworkGrants, [{
    grantId: operation.grantId,
    augmentationOperationId: operation.id,
    routeNetworkKind: operation.routeNetworkKind,
    connectionIds: [segment.id],
    roomIds: [],
    socketIds: [],
    failureKinds: ['critical-door-bypass-entry'],
  }]);
  assert.deepEqual(segmentAttribution.routeNetworkConflictExclusions, [{
    grantId: operation.grantId,
    entityKind: 'segment',
    entityId: segment.id,
    signature: createRouteNetworkConflictEntitySignature(segment, 'segment'),
    reason: 'route-network-runtime-physical-validation-failed',
  }]);

  const ambiguousAttribution = collectDungeonAugmentationPhysicalFailureAttribution(
    createDungeon({
      floorKey: '-7,129@y0.000',
      roomId: node.id,
      connectionId: segment.id,
    }),
  );
  assert.deepEqual(ambiguousAttribution.failedRouteNetworkGrants, []);
  assert.deepEqual(ambiguousAttribution.routeNetworkConflictExclusions, []);
});

function createReplayLifecycleFixture({ committed = false } = {}) {
  const sourceRandom = () => 0.5;
  const baseDungeon = {
    id: 'base',
    generationAttempts: 2,
    rooms: [],
    connectionPlans: [],
    progression: { validation: { accepted: true, errors: [] } },
  };
  const generator = new DungeonGenerator({
    random: sourceRandom,
    augmentationProfileId: 'industrial-supplement-preview-v4',
    augmentationRealizationAttemptLimit: 1,
    ...(committed ? {
      committedAugmentationIdentity: {
        profileId: 'industrial-supplement-preview-v4',
        seed: 'committed-lifecycle-seed',
      },
    } : {}),
  });
  generator._generateAcceptedIndustrialDungeon = () => ({
    dungeon: baseDungeon,
    randomTape: [],
  });
  generator._finalizeAcceptedIndustrialDungeon = (dungeon) => dungeon;
  return { generator, sourceRandom, baseDungeon };
}

test('final-facade wall ownership replays one exact connector-proxy node repair', () => {
  const validator = new DungeonGenerator({ random: () => 0.5 });
  const floor = (x, z, elevation, options = {}) => ({
    type: 'floor',
    surface: 'floor',
    roomId: 'trapRoom',
    x,
    z,
    elevation,
    level: elevation,
    ...options,
  });
  const floorKey = (tile) => validator._getFloorTileGraphKey(tile);
  const lowerTiles = [];
  for (let x = 0; x <= 6; x += 1) {
    for (let z = 0; z <= 5; z += 1) {
      lowerTiles.push(floor(x, z, -4.8, {
        surface: 'basementFloor',
        dropSpaceId: 'trapRoom_hazardDropSpace',
      }));
    }
  }
  const entryTiles = lowerTiles.filter(({ x, z }) => x === 0 && [2, 3].includes(z));
  for (const tile of entryTiles) tile.allowsGroundedDropLanding = true;
  const shelfTiles = [2, 3].map((z) => floor(6, z, -1.5, {
    surface: 'basementReturnShelf',
    isLedgeSurface: true,
    ledgeEdges: ['left'],
    supportBaseElevation: -4.8,
    platformPurpose: 'trapRoom_hazardDropSpace_return_climb_shelf',
    requiredTraversalAction: 'ledge_climb',
    dropSpaceId: 'trapRoom_hazardDropSpace',
  }));
  const exitTiles = [2, 3].map((z) => floor(7, z, 0));
  const entryLipTiles = [2, 3].map((z) => floor(-1, z, 0));
  const outsideRoute = [];
  for (let x = -1; x <= 7; x += 1) outsideRoute.push(floor(x, -1, 0));
  for (let z = 0; z <= 1; z += 1) {
    outsideRoute.push(floor(-1, z, 0), floor(7, z, 0));
  }
  const floorTiles = [
    ...lowerTiles,
    ...shelfTiles,
    ...exitTiles,
    ...entryLipTiles,
    ...outsideRoute,
  ];
  const trapRoom = {
    id: 'trapRoom',
    type: 'trap',
    x: 3,
    z: 2,
    width: 19,
    depth: 15,
    baseElevation: 0,
    ceilingHeight: 12,
    dropSpace: {
      id: 'trapRoom_hazardDropSpace',
      roomId: 'trapRoom',
      lowerElevation: -4.8,
      lowerBounds: { minX: 0, maxX: 6, minZ: 0, maxZ: 5 },
      lowerFloorKeys: lowerTiles
        .filter(({ x, z }) => !(x === 6 && [2, 3].includes(z)))
        .map(floorKey),
      entryFloorKeys: entryTiles.map(floorKey),
      entryLipFloorKeys: entryLipTiles.map(floorKey),
      returnShelfFloorKeys: shelfTiles.map(floorKey),
      exitFloorKeys: exitTiles.map(floorKey),
      bridgeFloorKeys: [],
      returnDirectionX: 1,
      returnDirectionZ: 0,
    },
  };
  const operation = {
    id: 'operation:final-wall-proxy-owner',
    type: 'routeNetwork',
    grantId: 'grant:final-wall-proxy-owner',
    routeNetworkKind: 'objective-route-coverage',
  };
  const node = {
    id: 'node:final-wall-proxy-owner',
    operationId: operation.id,
    kind: 'supplementConnectorJunction',
    grammarId: 'industrial-junction',
    placement: { center: { x: 18.2, y: 0, z: 7 }, rotationQuarterTurns: 0 },
    size: { x: 8.4, y: 5.6, z: 8.4 },
    sockets: [],
  };
  const authoritativeWallRun = {
    horizontal: false,
    dx: 1,
    dz: 0,
    line: 6.5,
    start: 2,
    end: 3,
    lengthTiles: 2,
    ownerId: node.id,
    ownerIds: [node.id],
    ownerByAxis: { 2: node.id, 3: node.id },
    ownerIdsByAxis: { 2: [node.id], 3: [node.id] },
    facadeId: 'v:1:0:6.5:2:3:-4.80:4.00',
    wallBottomY: -4.8,
    wallTopY: 4,
    wallHeight: 8.8,
  };
  validator._addBoundaryWallRun = () => {};
  const [blockingWall] = validator._addWalls(
    null,
    null,
    null,
    new Set(),
    [],
    new Map(),
    [authoritativeWallRun],
  );
  assert.equal(blockingWall.authoritativeBoundaryWall, true);
  assert.deepEqual(blockingWall.wallOwnerIdsByAxis, {
    2: [node.id],
    3: [node.id],
  });

  const validation = validator._validatePlatformability({
    floorTiles,
    rooms: [trapRoom],
    solidZones: [blockingWall],
    segmentBarrierZones: [blockingWall],
    useSegmentBarriers: true,
  });
  const dropCheck = validation.details.dropSpaceChecks[0];
  assert.equal(dropCheck.canExit, false);
  assert.deepEqual(dropCheck.egressBlockingZones, [{
    id: blockingWall.id,
    roomId: null,
    connectionId: null,
    operationId: null,
    manifestCollisionRecordId: null,
    moduleManifestId: null,
    obstacleKind: 'boundaryWall',
    dungeonSupplement: false,
    ownerIds: [node.id],
    authoritativeBoundaryWall: true,
  }]);

  const { generator } = createReplayLifecycleFixture();
  const rejectedDungeon = {
    id: 'final-wall-proxy-rejected',
    augmentationStatus: 'applied',
    augmentationOverlayPlan: {
      operations: [operation],
      nodes: [node],
      segments: [],
    },
    // This is the completed-facade shape: connector identities do not leak
    // into runtime rooms, but remain available as physical owner proxies.
    rooms: [trapRoom],
    connectorJunctionProxies: [{
      id: node.id,
      isConnectorJunctionProxy: true,
      suppressRoomGeometry: true,
    }],
    connectionPlans: [],
    progression: {
      validation: {
        accepted: false,
        errors: ['Synthetic final boundary wall blocks the authored drop-space egress.'],
        platformability: validation.details,
      },
    },
  };
  const acceptedDungeon = {
    id: 'final-wall-proxy-accepted',
    augmentationStatus: 'applied',
    progression: { validation: { accepted: true, errors: [] } },
  };
  const observedConflictExclusions = [];
  let generationPass = 0;
  generator._generateOnce = () => {
    observedConflictExclusions.push([
      ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
    ]);
    generationPass += 1;
    return generationPass === 1 ? rejectedDungeon : acceptedDungeon;
  };

  const result = generator._generateIndustrialDungeonWithAugmentationReplay();
  const expectedExclusion = {
    grantId: operation.grantId,
    entityKind: 'node',
    entityId: node.id,
    signature: createRouteNetworkConflictEntitySignature(node, 'node'),
    reason: 'route-network-runtime-physical-validation-failed',
  };
  assert.equal(result, acceptedDungeon);
  assert.equal(generationPass, 2);
  assert.deepEqual(observedConflictExclusions, [[], [expectedExclusion]]);
  assert.equal(result.augmentationReplayDiagnostics.runtimePruningPasses, 1);
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .excludedRouteNetworkEntities,
    [expectedExclusion],
  );
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .prunedRouteNetworkGrantIds,
    [],
  );
});

function createExpectedPlanningRejection() {
  const error = new Error('Synthetic expected planning rejection.');
  error.code = 'DUNGEON_AUGMENTATION_PLANNING_UNCHANGED';
  error.augmentationDiagnostics = {
    status: 'unchanged',
    reason: 'no-eligible-regions',
    errors: [],
  };
  return error;
}

test('augmentation replay restores exact own-property state for every temporary override', () => {
  for (const mode of ['absent', 'own-undefined', 'own-sentinel', 'inherited']) {
    const { generator, sourceRandom, baseDungeon } = createReplayLifecycleFixture();
    const planSeedSentinel = { mode, property: 'plan-seed' };
    const planningSnapshotSentinel = { mode, property: 'planning-snapshot' };
    const pruningOverrideSentinel = { mode, property: 'route-network-pruning' };
    const conflictExclusionSentinel = { mode, property: 'route-network-conflict' };
    if (mode === 'inherited') {
      const inheritedPrototype = Object.create(Object.getPrototypeOf(generator));
      Object.defineProperties(inheritedPrototype, {
        augmentationPlanSeedOverride: {
          configurable: true,
          writable: true,
          value: planSeedSentinel,
        },
        _augmentationReplayPlanningSnapshotOverride: {
          configurable: true,
          writable: true,
          value: planningSnapshotSentinel,
        },
        augmentationRouteNetworkPruningOverrides: {
          configurable: true,
          writable: true,
          value: pruningOverrideSentinel,
        },
        augmentationRouteNetworkConflictExclusions: {
          configurable: true,
          writable: true,
          value: conflictExclusionSentinel,
        },
      });
      Object.setPrototypeOf(generator, inheritedPrototype);
    } else if (mode !== 'absent') {
      Object.defineProperties(generator, {
        augmentationPlanSeedOverride: {
          configurable: true,
          enumerable: false,
          writable: true,
          value: mode === 'own-undefined' ? undefined : planSeedSentinel,
        },
        _augmentationReplayPlanningSnapshotOverride: {
          configurable: true,
          enumerable: false,
          writable: true,
          value: mode === 'own-undefined' ? undefined : planningSnapshotSentinel,
        },
        augmentationRouteNetworkPruningOverrides: {
          configurable: true,
          enumerable: false,
          writable: true,
          value: mode === 'own-undefined' ? undefined : pruningOverrideSentinel,
        },
        augmentationRouteNetworkConflictExclusions: {
          configurable: true,
          enumerable: false,
          writable: true,
          value: mode === 'own-undefined' ? undefined : conflictExclusionSentinel,
        },
      });
    }
    const originalPlanSeedDescriptor = Object.getOwnPropertyDescriptor(
      generator,
      'augmentationPlanSeedOverride',
    );
    const originalPlanningSnapshotDescriptor = Object.getOwnPropertyDescriptor(
      generator,
      '_augmentationReplayPlanningSnapshotOverride',
    );
    const originalPruningOverrideDescriptor = Object.getOwnPropertyDescriptor(
      generator,
      'augmentationRouteNetworkPruningOverrides',
    );
    const originalConflictExclusionDescriptor = Object.getOwnPropertyDescriptor(
      generator,
      'augmentationRouteNetworkConflictExclusions',
    );
    let observedPlanningSnapshot = null;
    generator._generateOnce = () => {
      assert.equal(Object.hasOwn(generator, 'augmentationPlanSeedOverride'), true, mode);
      assert.equal(generator.augmentationPlanSeedOverride, null, mode);
      assert.deepEqual(generator.augmentationRouteNetworkPruningOverrides, [], mode);
      assert.deepEqual(generator.augmentationRouteNetworkConflictExclusions, [], mode);
      assert.equal(
        Object.hasOwn(generator, '_augmentationReplayPlanningSnapshotOverride'),
        true,
        mode,
      );
      observedPlanningSnapshot = generator._augmentationReplayPlanningSnapshotOverride;
      throw createExpectedPlanningRejection();
    };

    assert.equal(generator._generateIndustrialDungeonWithAugmentationReplay(), baseDungeon, mode);
    assert.ok(observedPlanningSnapshot, mode);
    assert.equal(generator.random, sourceRandom, mode);
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(generator, 'augmentationPlanSeedOverride'),
      originalPlanSeedDescriptor,
      mode,
    );
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(
        generator,
        'augmentationRouteNetworkPruningOverrides',
      ),
      originalPruningOverrideDescriptor,
      mode,
    );
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(
        generator,
        'augmentationRouteNetworkConflictExclusions',
      ),
      originalConflictExclusionDescriptor,
      mode,
    );
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(
        generator,
        '_augmentationReplayPlanningSnapshotOverride',
      ),
      originalPlanningSnapshotDescriptor,
      mode,
    );
    if (mode === 'inherited') {
      assert.equal(generator.augmentationPlanSeedOverride, planSeedSentinel);
      assert.equal(
        generator._augmentationReplayPlanningSnapshotOverride,
        planningSnapshotSentinel,
      );
      assert.equal(
        generator.augmentationRouteNetworkPruningOverrides,
        pruningOverrideSentinel,
      );
      assert.equal(
        generator.augmentationRouteNetworkConflictExclusions,
        conflictExclusionSentinel,
      );
    }
  }
});

test('augmentation replay never falls back to pruning an entire failed route-network grant', () => {
  const { generator, baseDungeon } = createReplayLifecycleFixture();
  const observedOverrides = [];
  let generationPass = 0;
  generator._generateOnce = () => {
    generationPass += 1;
    observedOverrides.push([
      ...(generator.augmentationRouteNetworkPruningOverrides ?? []),
    ]);
    const error = new Error('Synthetic aggregate connector preflight conflict.');
    error.code = 'DUNGEON_AUGMENTATION_CONNECTOR_PREFLIGHT_FAILED';
    error.augmentationDiagnostics = {
      status: 'unchanged',
      reason: 'connector-entrance-preflight-failed',
      augmentationPlanHash: 'augmentation:rejected-without-an-exact-entity',
      routeNetworkGrantIds: ['grant:retained', 'grant:conflicting'],
      failedRouteNetworkGrants: [{
        grantId: 'grant:conflicting',
        augmentationOperationId: 'operation:conflicting',
        routeNetworkKind: 'objective-route-coverage',
        connectionIds: ['connection:ambiguous-aggregate'],
        socketIds: ['socket:ambiguous-aggregate'],
      }],
      errors: ['synthetic aggregate connector preflight conflict'],
    };
    throw error;
  };

  const result = generator._generateIndustrialDungeonWithAugmentationReplay();
  assert.equal(result, baseDungeon);
  assert.equal(generationPass, 1);
  assert.deepEqual(observedOverrides, [[]]);
  assert.equal(result.augmentationReplayDiagnostics.realizationAttempts, 1);
  assert.equal(result.augmentationReplayDiagnostics.runtimePruningPasses, 0);
  assert.deepEqual(result.augmentationReplayDiagnostics.runtimePruningRecords, []);
  assert.equal(
    Object.hasOwn(generator, 'augmentationRouteNetworkPruningOverrides'),
    false,
  );
});

test('augmentation replay excludes an exact conflicting module signature before pruning its grant', () => {
  const { generator } = createReplayLifecycleFixture();
  const conflictingOperation = {
    id: 'operation:retained',
    type: 'routeNetwork',
    grantId: 'grant:retained',
    routeNetworkKind: 'objective-route-coverage',
  };
  const conflictingSegment = {
    id: 'segment:conflicting-path',
    operationId: conflictingOperation.id,
    kind: 'route-network-segment',
    routeRole: 'objective-route-coverage:spine',
    connectorFamily: 'service-gallery',
    from: { nodeId: 'authored:a', socketId: 'socket:a' },
    to: { nodeId: 'supplement:1', socketId: 'socket:entry' },
    path: [{ x: 0, y: 0, z: 0 }, { x: 8.4, y: 0, z: 0 }],
  };
  const exclusion = {
    grantId: 'grant:retained',
    entityKind: 'segment',
    entityId: 'segment:conflicting-path',
    signature: createRouteNetworkConflictEntitySignature(
      conflictingSegment,
      'segment',
    ),
    reason: 'route-network-runtime-physical-validation-failed',
  };
  const rejectedDungeon = {
    id: 'module-conflict-rejected',
    augmentationStatus: 'applied',
    augmentationPlanHash: 'augmentation:module-conflict-rejected',
    augmentationOverlayPlan: {
      operations: [conflictingOperation],
      nodes: [],
      segments: [conflictingSegment],
    },
    connectionPlans: [{
      id: conflictingSegment.id,
      augmentationOperationId: conflictingOperation.id,
      routeNetworkGrantId: conflictingOperation.grantId,
      isDungeonSupplement: true,
    }],
    rooms: [],
    progression: {
      validation: {
        accepted: false,
        errors: ['synthetic exact segment conflict'],
        platformability: {
          supplementConnectivityChecks: [{
            accepted: false,
            operationId: conflictingOperation.id,
            connectionId: conflictingSegment.id,
            missingOwnedCenterlinePointCount: 1,
          }],
        },
      },
    },
  };
  const acceptedDungeon = {
    id: 'module-replacement-accepted',
    augmentationStatus: 'applied',
    progression: { validation: { accepted: true, errors: [] } },
  };
  const observedConflictExclusions = [];
  const observedGrantPruningOverrides = [];
  let generationPass = 0;
  generator._generateOnce = () => {
    generationPass += 1;
    observedConflictExclusions.push([
      ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
    ]);
    observedGrantPruningOverrides.push([
      ...(generator.augmentationRouteNetworkPruningOverrides ?? []),
    ]);
    return generationPass === 1 ? rejectedDungeon : acceptedDungeon;
  };

  const result = generator._generateIndustrialDungeonWithAugmentationReplay();
  assert.equal(result, acceptedDungeon);
  assert.equal(generationPass, 2);
  assert.deepEqual(observedConflictExclusions, [[], [exclusion]]);
  assert.deepEqual(observedGrantPruningOverrides, [[], []]);
  assert.equal(result.augmentationReplayDiagnostics.runtimePruningPasses, 1);
  assert.equal(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0].recoveryKind,
    'exact-conflict-entity-exclusion',
  );
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .prunedRouteNetworkGrantIds,
    [],
  );
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .excludedRouteNetworkEntities,
    [exclusion],
  );
  assert.equal(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0].recoveryOutcome,
    'exact-entity-replacement-realized',
  );
  assert.equal(
    Object.hasOwn(generator, 'augmentationRouteNetworkConflictExclusions'),
    false,
  );
});

test('ramp/scaffold validation excludes only the exact supplemental room node', () => {
  const { generator } = createReplayLifecycleFixture();
  const operation = {
    id: 'operation:layered-ramp-conflict',
    type: 'routeNetwork',
    grantId: 'grant:layered-ramp-conflict',
    routeNetworkKind: 'objective-route-coverage',
  };
  const node = {
    id: 'node:layered-ramp-conflict',
    operationId: operation.id,
    kind: 'room',
    grammarId: 'supplement-blueprint-ind-room-switchgear-cache-descent-01-v1',
    position: { x: -67.2, y: -14, z: 350 },
    rotationQuarterTurns: 3,
  };
  const exclusion = {
    grantId: operation.grantId,
    entityKind: 'node',
    entityId: node.id,
    signature: createRouteNetworkConflictEntitySignature(node, 'node'),
    reason: 'route-network-runtime-physical-validation-failed',
  };
  const rejectedDungeon = {
    id: 'layered-ramp-conflict-rejected',
    augmentationStatus: 'applied',
    augmentationPlanHash: 'augmentation:layered-ramp-conflict-rejected',
    augmentationOverlayPlan: {
      operations: [operation],
      nodes: [node],
      segments: [],
    },
    connectionPlans: [],
    rooms: [{
      id: node.id,
      augmentationOperationId: operation.id,
      isDungeonSupplement: true,
    }],
    progression: {
      validation: {
        accepted: false,
        errors: ['synthetic ramp/scaffold conflict'],
        platformability: {
          rampScaffoldHeadroomConflicts: [{
            accepted: false,
            rampRoomId: node.id,
            rampFloorKey: '-22,126@y-11.667',
            scaffoldFloorKey: '-22,126@y1.050',
            clearance: 12.48,
          }],
        },
      },
    },
  };
  const acceptedDungeon = {
    id: 'layered-ramp-replacement-accepted',
    augmentationStatus: 'applied',
    progression: { validation: { accepted: true, errors: [] } },
  };
  const observedConflictExclusions = [];
  let generationPass = 0;
  generator._generateOnce = () => {
    observedConflictExclusions.push([
      ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
    ]);
    generationPass += 1;
    return generationPass === 1 ? rejectedDungeon : acceptedDungeon;
  };

  const result = generator._generateIndustrialDungeonWithAugmentationReplay();
  assert.equal(result, acceptedDungeon);
  assert.equal(generationPass, 2);
  assert.deepEqual(observedConflictExclusions, [[], [exclusion]]);
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .excludedRouteNetworkEntities,
    [exclusion],
  );
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .prunedRouteNetworkGrantIds,
    [],
  );
});

test('bounded exact replacement exhaustion fails closed instead of deleting its grant', () => {
  const { generator, baseDungeon } = createReplayLifecycleFixture();
  const retainedOperation = {
    id: 'operation:retained-landmark',
    type: 'routeNetwork',
    grantId: 'grant:retained-landmark',
    routeNetworkKind: 'landmark-perimeter-loop',
  };
  const conflictingOperation = {
    id: 'operation:exhausted-coverage',
    type: 'routeNetwork',
    grantId: 'grant:exhausted-coverage',
    routeNetworkKind: 'objective-route-coverage',
  };
  const conflictingSegment = {
    id: 'segment:exhausted-coverage',
    operationId: conflictingOperation.id,
    kind: 'route-network-segment',
    routeRole: 'objective-route-coverage:spine',
    connectorFamily: 'service-gallery',
    from: { nodeId: 'authored:a', socketId: 'socket:a' },
    to: { nodeId: 'supplement:1', socketId: 'socket:entry' },
    path: [{ x: 0, y: 0, z: 0 }, { x: 8.4, y: 0, z: 0 }],
  };
  const exclusion = {
    grantId: conflictingOperation.grantId,
    entityKind: 'segment',
    entityId: conflictingSegment.id,
    signature: createRouteNetworkConflictEntitySignature(conflictingSegment, 'segment'),
    reason: 'route-network-runtime-physical-validation-failed',
  };
  const rejectedDungeon = {
    id: 'bounded-replacement-rejected',
    augmentationStatus: 'applied',
    augmentationPlanHash: 'augmentation:bounded-replacement-rejected',
    augmentationOverlayPlan: {
      operations: [retainedOperation, conflictingOperation],
      nodes: [],
      segments: [conflictingSegment],
    },
    connectionPlans: [{
      id: conflictingSegment.id,
      augmentationOperationId: conflictingOperation.id,
      routeNetworkGrantId: conflictingOperation.grantId,
      isDungeonSupplement: true,
    }],
    rooms: [],
    progression: {
      validation: {
        accepted: false,
        errors: ['synthetic bounded replacement exhaustion'],
        platformability: {
          supplementConnectivityChecks: [{
            accepted: false,
            operationId: conflictingOperation.id,
            connectionId: conflictingSegment.id,
            missingOwnedCenterlinePointCount: 1,
          }],
        },
      },
    },
  };
  const acceptedDungeon = {
    id: 'bounded-replacement-partial-accepted',
    augmentationStatus: 'applied',
    augmentationOverlayPlan: {
      completionMode: 'best-effort-partial',
      operations: [retainedOperation],
      nodes: [],
      segments: [],
      routeNetworkConflictExclusions: [exclusion],
      prunedRouteNetworkGrants: [{
        grantId: conflictingOperation.grantId,
        recoveryKind: 'exact-conflict-replacements-exhausted',
        conflictExclusionCount: 1,
        conflictEntityKinds: ['segment'],
        replacementExhaustionKind: 'candidate-domain-exhausted',
        reason: 'route-network-conflict-exclusion-replacements-exhausted',
      }],
    },
    progression: { validation: { accepted: true, errors: [] } },
  };
  const observedConflictExclusions = [];
  let generationPass = 0;
  generator._generateOnce = () => {
    observedConflictExclusions.push([
      ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
    ]);
    generationPass += 1;
    return generationPass === 1 ? rejectedDungeon : acceptedDungeon;
  };

  const result = generator._generateIndustrialDungeonWithAugmentationReplay();
  assert.equal(result, baseDungeon);
  assert.deepEqual(observedConflictExclusions, [[], [exclusion]]);
  assert.equal(result.augmentationReplayDiagnostics.accepted, false);
  assert.equal(result.augmentationReplayDiagnostics.fallbackToAcceptedBase, true);
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .prunedRouteNetworkGrantIds,
    [],
  );
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .excludedRouteNetworkEntities,
    [exclusion],
  );
});

test('planning-time exact segment diagnostics replay the same seed without pruning the grant', () => {
  const { generator } = createReplayLifecycleFixture();
  const operation = {
    id: 'operation:planning-contract-rejection',
    type: 'routeNetwork',
    grantId: 'grant:planning-contract-rejection',
    routeNetworkKind: 'objective-route-coverage',
  };
  const segment = {
    id: 'segment:planning-contract-rejection',
    operationId: operation.id,
    kind: 'route-network-segment',
    routeRole: 'objective-route-coverage:spine',
    connectorFamily: 'lift',
    from: { position: { x: 0, y: 0, z: 0 }, facing: { x: 1, y: 0, z: 0 } },
    to: { position: { x: 8.4, y: 14, z: 0 }, facing: { x: -1, y: 0, z: 0 } },
    path: [{ x: 0, y: 0, z: 0 }, { x: 8.4, y: 14, z: 0 }],
  };
  const exclusion = {
    grantId: operation.grantId,
    entityKind: 'segment',
    entityId: segment.id,
    signature: createRouteNetworkConflictEntitySignature(segment, 'segment'),
    reason: 'route-network-materialization-contract-rejected',
  };
  const acceptedDungeon = {
    id: 'planning-contract-replacement-accepted',
    augmentationStatus: 'applied',
    progression: { validation: { accepted: true, errors: [] } },
  };
  const observedConflictExclusions = [];
  const observedGrantPruningOverrides = [];
  let generationPass = 0;
  generator._generateOnce = () => {
    generationPass += 1;
    observedConflictExclusions.push([
      ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
    ]);
    observedGrantPruningOverrides.push([
      ...(generator.augmentationRouteNetworkPruningOverrides ?? []),
    ]);
    if (generationPass > 1) return acceptedDungeon;
    const error = new Error('Synthetic exact lift contract rejection.');
    error.code = 'DUNGEON_AUGMENTATION_PLANNING_UNCHANGED';
    error.augmentationDiagnostics = {
      status: 'unchanged',
      reason: 'industrial-materialization-failed',
      augmentationPlanHash: 'augmentation:planning-contract-rejected',
      routeNetworkGrantIds: [operation.grantId],
      routeNetworkEntityCount: 1,
      failedRouteNetworkGrants: [{
        grantId: operation.grantId,
        augmentationOperationId: operation.id,
        routeNetworkKind: operation.routeNetworkKind,
        connectionIds: [segment.id],
        roomIds: [],
        socketIds: [],
        failureKinds: ['DUNGEON_SUPPLEMENT_CONNECTOR_CONTRACT_REJECTED'],
      }],
      routeNetworkConflictExclusions: [exclusion],
      errors: ['Synthetic exact lift contract rejection.'],
    };
    throw error;
  };

  const result = generator._generateIndustrialDungeonWithAugmentationReplay();
  assert.equal(result, acceptedDungeon);
  assert.equal(generationPass, 2);
  assert.deepEqual(observedConflictExclusions, [[], [exclusion]]);
  assert.deepEqual(observedGrantPruningOverrides, [[], []]);
  assert.equal(result.augmentationReplayDiagnostics.realizationAttempts, 1);
  assert.equal(result.augmentationReplayDiagnostics.runtimePruningPasses, 1);
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .excludedRouteNetworkEntities,
    [exclusion],
  );
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .prunedRouteNetworkGrantIds,
    [],
  );
});

test('structural-frame wall-run rejection excludes exact segments without pruning their grants', () => {
  const { generator } = createReplayLifecycleFixture();
  const operation = {
    id: 'operation:structural-frame-conflict',
    type: 'routeNetwork',
    grantId: 'grant:structural-frame-conflict',
    routeNetworkKind: 'objective-route-coverage',
  };
  const segment = {
    id: 'segment:structural-frame-conflict',
    operationId: operation.id,
    kind: 'route-network-segment',
    routeRole: 'objective-route-coverage:spine',
    connectorFamily: 'service-gallery',
    from: { position: { x: 0, y: 0, z: 0 }, facing: { x: 1, y: 0, z: 0 } },
    to: { position: { x: 8.4, y: 0, z: 0 }, facing: { x: -1, y: 0, z: 0 } },
    path: [{ x: 0, y: 0, z: 0 }, { x: 8.4, y: 0, z: 0 }],
  };
  const exclusion = {
    grantId: operation.grantId,
    entityKind: 'segment',
    entityId: segment.id,
    signature: createRouteNetworkConflictEntitySignature(segment, 'segment'),
    reason: 'route-network-structural-frame-wall-run-missing',
  };
  const acceptedDungeon = {
    id: 'structural-frame-replacement-accepted',
    augmentationStatus: 'applied',
    progression: { validation: { accepted: true, errors: [] } },
  };
  const observedConflictExclusions = [];
  const observedGrantPruningOverrides = [];
  let generationPass = 0;
  generator._generateOnce = () => {
    generationPass += 1;
    observedConflictExclusions.push([
      ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
    ]);
    observedGrantPruningOverrides.push([
      ...(generator.augmentationRouteNetworkPruningOverrides ?? []),
    ]);
    if (generationPass > 1) return acceptedDungeon;
    const error = new Error('Synthetic exact structural-frame wall-run rejection.');
    error.code = 'DUNGEON_AUGMENTATION_INCOMPATIBLE_CONTENT';
    error.compatibility = {
      compatible: false,
      code: 'DUNGEON_AUGMENTATION_STRUCTURAL_FRAME_BINDING_FAILED',
    };
    error.augmentationDiagnostics = {
      status: 'unchanged',
      reason: 'route-network-structural-frame-binding-failed',
      augmentationPlanHash: 'augmentation:structural-frame-conflict',
      routeNetworkGrantIds: [operation.grantId],
      routeNetworkEntityCount: 1,
      failedRouteNetworkGrants: [{
        grantId: operation.grantId,
        augmentationOperationId: operation.id,
        routeNetworkKind: operation.routeNetworkKind,
        connectionIds: [segment.id],
        roomIds: [],
        socketIds: ['socket:structural-frame-conflict'],
        failureKinds: ['DUNGEON_AUGMENTATION_STRUCTURAL_FRAME_WALL_RUN_MISSING'],
      }],
      routeNetworkConflictExclusions: [exclusion],
      errors: ['synthetic exact structural-frame wall-run rejection'],
    };
    throw error;
  };

  const result = generator._generateIndustrialDungeonWithAugmentationReplay();
  assert.equal(result, acceptedDungeon);
  assert.equal(generationPass, 2);
  assert.deepEqual(observedConflictExclusions, [[], [exclusion]]);
  assert.deepEqual(observedGrantPruningOverrides, [[], []]);
  assert.equal(result.augmentationReplayDiagnostics.realizationAttempts, 1);
  assert.equal(result.augmentationReplayDiagnostics.runtimePruningPasses, 1);
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .excludedRouteNetworkEntities,
    [exclusion],
  );
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .prunedRouteNetworkGrantIds,
    [],
  );
});

test('unwalkable anchor support replaces only its exact supplemental room node', () => {
  const { generator } = createReplayLifecycleFixture();
  const operation = {
    id: 'operation:anchor-support-conflict',
    type: 'routeNetwork',
    grantId: 'grant:anchor-support-conflict',
    routeNetworkKind: 'objective-route-coverage',
  };
  const node = {
    id: 'node:anchor-support-conflict',
    operationId: operation.id,
    kind: 'supplementRoom',
    grammarId: 'industrial-switchgear-cache-descent',
    blueprintId: 'ind-room-switchgear-cache-descent-01',
    contentRole: 'treasure',
    placement: { center: { x: -26, y: 14, z: 2 }, rotationQuarterTurns: 0 },
    size: { x: 14, y: 8.4, z: 14 },
    sockets: [],
  };
  const exactSupportCellId = `${node.id}:floor-tier:base:cell:2:2`;
  const placementFailure = {
    code: 'v4-anchor-placement-unwalkable-support',
    recordId: `${node.id}:anchor:vault-reward:placement-request`,
    ownerId: `${node.id}:anchor:vault-reward`,
    details: {
      roomId: node.id,
      blueprintId: node.blueprintId,
      grammarId: node.grammarId,
      exactSupportCellId,
      candidateCount: 1,
      unwalkableSupportDetails: [{
        supportCellId: exactSupportCellId,
        walkabilityIntent: 'support-only',
        floorKey: '-26,2@y14.000',
        coveredByAuthoritativeFloorKey: '-26,2@y14.467',
      }],
    },
  };
  const overlayPlan = {
    augmentationPlanHash: 'augmentation:anchor-support-conflict',
    operations: [operation],
    nodes: [node],
    segments: [],
  };
  const attribution = collectDungeonAugmentationAnchorPlacementFailureAttribution(
    overlayPlan,
    [placementFailure],
  );
  const exclusion = {
    grantId: operation.grantId,
    entityKind: 'node',
    entityId: node.id,
    signature: createRouteNetworkConflictEntitySignature(node, 'node'),
    reason: 'route-network-anchor-placement-unwalkable-support',
  };
  assert.deepEqual(attribution.routeNetworkConflictExclusions, [exclusion]);
  assert.deepEqual(attribution.failedRouteNetworkGrants, [{
    grantId: operation.grantId,
    augmentationOperationId: operation.id,
    routeNetworkKind: operation.routeNetworkKind,
    connectionIds: [],
    roomIds: [node.id],
    socketIds: [],
    failureKinds: ['v4-anchor-placement-unwalkable-support'],
  }]);

  const acceptedDungeon = {
    id: 'anchor-support-replacement-accepted',
    augmentationStatus: 'applied',
    progression: { validation: { accepted: true, errors: [] } },
  };
  const observedConflictExclusions = [];
  const observedGrantPruningOverrides = [];
  let generationPass = 0;
  generator._generateOnce = () => {
    generationPass += 1;
    observedConflictExclusions.push([
      ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
    ]);
    observedGrantPruningOverrides.push([
      ...(generator.augmentationRouteNetworkPruningOverrides ?? []),
    ]);
    if (generationPass > 1) return acceptedDungeon;
    const error = new Error('Synthetic exact anchor support rejection.');
    error.code = 'DUNGEON_AUGMENTATION_ANCHOR_PLACEMENT_FAILED';
    error.compatibility = {
      compatible: false,
      code: 'DUNGEON_AUGMENTATION_ANCHOR_PLACEMENT_FAILED',
    };
    error.augmentationDiagnostics = {
      status: 'unchanged',
      reason: 'DUNGEON_AUGMENTATION_ANCHOR_PLACEMENT_FAILED',
      anchorPlacementFailures: [placementFailure],
      errors: [placementFailure],
      ...attribution,
    };
    throw error;
  };

  const result = generator._generateIndustrialDungeonWithAugmentationReplay();
  assert.equal(result, acceptedDungeon);
  assert.equal(generationPass, 2);
  assert.deepEqual(observedConflictExclusions, [[], [exclusion]]);
  assert.deepEqual(observedGrantPruningOverrides, [[], []]);
  assert.equal(result.augmentationReplayDiagnostics.runtimePruningPasses, 1);
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .excludedRouteNetworkEntities,
    [exclusion],
  );
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .prunedRouteNetworkGrantIds,
    [],
  );
});

test('realization attempt limit one reaches a fixed point across two exact same-seed repairs', () => {
  const { generator } = createReplayLifecycleFixture();
  const operation = {
    id: 'operation:bounded-exact-replay',
    type: 'routeNetwork',
    grantId: 'grant:bounded-exact-replay',
    routeNetworkKind: 'objective-route-coverage',
  };
  const makeSegment = (middleZ) => ({
    id: 'segment:bounded-exact-replay',
    operationId: operation.id,
    kind: 'route-network-segment',
    connectorFamily: 'service-gallery',
    routeRole: 'objective-route-coverage:spine',
    from: { position: { x: 0, y: 0, z: 0 }, facing: { x: 1, y: 0, z: 0 } },
    to: { position: { x: 8.4, y: 0, z: 0 }, facing: { x: -1, y: 0, z: 0 } },
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 2.8, y: 0, z: middleZ },
      { x: 8.4, y: 0, z: 0 },
    ],
  });
  const segments = [makeSegment(0), makeSegment(2.8)];
  const repairBoundWitnessNode = {
    id: 'node:bounded-exact-replay:witness',
    operationId: operation.id,
    kind: 'supplementRoom',
    placement: { center: { x: 14, y: 0, z: 14 }, rotationQuarterTurns: 0 },
    size: { x: 2.8, y: 2.8, z: 2.8 },
    sockets: [],
  };
  const exclusions = segments.map((segment) => ({
    grantId: operation.grantId,
    entityKind: 'segment',
    entityId: segment.id,
    signature: createRouteNetworkConflictEntitySignature(segment, 'segment'),
    reason: 'route-network-runtime-physical-validation-failed',
  }));
  const normalizedExclusions = normalizeRouteNetworkConflictExclusions(exclusions);
  const rejectedDungeon = (segment, ordinal) => ({
    id: `bounded-exact-rejection:${ordinal}`,
    augmentationStatus: 'applied',
    augmentationOverlayPlan: {
      operations: [operation],
      // The first rejected overlay has two exact physical entities, providing
      // a natural cap of two monotonic same-seed repair passes.
      nodes: [repairBoundWitnessNode],
      segments: [segment],
    },
    rooms: [],
    connectionPlans: [{
      id: segment.id,
      augmentationOperationId: operation.id,
      routeNetworkGrantId: operation.grantId,
      isDungeonSupplement: true,
    }],
    progression: {
      validation: {
        accepted: false,
        errors: [`synthetic bounded exact conflict ${ordinal}`],
        platformability: {
          supplementConnectivityChecks: [{
            accepted: false,
            operationId: operation.id,
            connectionId: segment.id,
            missingOwnedCenterlinePointCount: 1,
          }],
        },
      },
    },
  });
  const observedConflictExclusions = [];
  const observedGrantPruningOverrides = [];
  const acceptedDungeon = {
    id: 'bounded-exact-repair-accepted',
    augmentationStatus: 'applied',
    progression: { validation: { accepted: true, errors: [] } },
  };
  let generationPass = 0;
  generator._generateOnce = () => {
    observedConflictExclusions.push([
      ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
    ]);
    observedGrantPruningOverrides.push([
      ...(generator.augmentationRouteNetworkPruningOverrides ?? []),
    ]);
    const pass = generationPass;
    generationPass += 1;
    return pass < segments.length
      ? rejectedDungeon(segments[pass], pass)
      : acceptedDungeon;
  };

  const result = generator._generateIndustrialDungeonWithAugmentationReplay();
  assert.equal(result, acceptedDungeon);
  assert.equal(generationPass, 3);
  assert.deepEqual(observedConflictExclusions, [
    [],
    [exclusions[0]],
    normalizedExclusions,
  ]);
  assert.deepEqual(observedGrantPruningOverrides, [[], [], []]);
  assert.equal(result.augmentationReplayDiagnostics.realizationAttempts, 1);
  assert.equal(result.augmentationReplayDiagnostics.runtimePruningPasses, 2);
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords.map((record) => ({
      sameSeedRepairPass: record.sameSeedRepairPass,
      sameSeedRepairLimit: record.sameSeedRepairLimit,
      prunedRouteNetworkGrantIds: record.prunedRouteNetworkGrantIds,
      excludedRouteNetworkEntities: record.excludedRouteNetworkEntities,
    })),
    [{
      sameSeedRepairPass: 1,
      sameSeedRepairLimit: 2,
      prunedRouteNetworkGrantIds: [],
      excludedRouteNetworkEntities: [exclusions[0]],
    }, {
      sameSeedRepairPass: 2,
      sameSeedRepairLimit: 2,
      prunedRouteNetworkGrantIds: [],
      excludedRouteNetworkEntities: [exclusions[1]],
    }],
  );
});

test('same-seed exact repair stops on signature no-progress and restores overrides', () => {
  const { generator, sourceRandom, baseDungeon } = createReplayLifecycleFixture();
  const operation = {
    id: 'operation:no-progress-exact-replay',
    type: 'routeNetwork',
    grantId: 'grant:no-progress-exact-replay',
    routeNetworkKind: 'objective-route-coverage',
  };
  const makeSegment = (id) => ({
    id,
    operationId: operation.id,
    kind: 'route-network-segment',
    connectorFamily: 'service-gallery',
    routeRole: 'objective-route-coverage:spine',
    from: { position: { x: 0, y: 0, z: 0 }, facing: { x: 1, y: 0, z: 0 } },
    to: { position: { x: 8.4, y: 0, z: 0 }, facing: { x: -1, y: 0, z: 0 } },
    path: [{ x: 0, y: 0, z: 0 }, { x: 8.4, y: 0, z: 0 }],
  });
  const segments = [
    makeSegment('segment:no-progress:first-ordinal'),
    makeSegment('segment:no-progress:renumbered-ordinal'),
  ];
  assert.equal(
    createRouteNetworkConflictEntitySignature(segments[0], 'segment'),
    createRouteNetworkConflictEntitySignature(segments[1], 'segment'),
    'the repeated conflict must differ only in diagnostic ordinal identity',
  );
  const repairBoundWitnessNode = {
    id: 'node:no-progress:witness',
    operationId: operation.id,
    kind: 'supplementRoom',
    placement: { center: { x: 14, y: 0, z: 14 }, rotationQuarterTurns: 0 },
    size: { x: 2.8, y: 2.8, z: 2.8 },
    sockets: [],
  };
  const rejectedDungeon = (segment, ordinal) => ({
    id: `no-progress-exact-rejection:${ordinal}`,
    augmentationStatus: 'applied',
    augmentationOverlayPlan: {
      operations: [operation],
      nodes: [repairBoundWitnessNode],
      segments: [segment],
    },
    rooms: [],
    connectionPlans: [{
      id: segment.id,
      augmentationOperationId: operation.id,
      routeNetworkGrantId: operation.grantId,
      isDungeonSupplement: true,
    }],
    progression: {
      validation: {
        accepted: false,
        errors: [`synthetic no-progress exact conflict ${ordinal}`],
        platformability: {
          supplementConnectivityChecks: [{
            accepted: false,
            operationId: operation.id,
            connectionId: segment.id,
            missingOwnedCenterlinePointCount: 1,
          }],
        },
      },
    },
  });
  const observedConflictExclusions = [];
  let generationPass = 0;
  generator._generateOnce = () => {
    observedConflictExclusions.push([
      ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
    ]);
    const pass = generationPass;
    generationPass += 1;
    return rejectedDungeon(segments[Math.min(pass, segments.length - 1)], pass);
  };

  const result = generator._generateIndustrialDungeonWithAugmentationReplay();
  assert.equal(result, baseDungeon);
  assert.equal(generationPass, 2, 'the repeated physical signature must not replay again');
  assert.equal(result.augmentationReplayDiagnostics.realizationAttempts, 1);
  assert.equal(result.augmentationReplayDiagnostics.runtimePruningPasses, 1);
  assert.deepEqual(observedConflictExclusions, [
    [],
    [result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .excludedRouteNetworkEntities[0]],
  ]);
  assert.equal(generator.random, sourceRandom);
  assert.equal(
    Object.hasOwn(generator, 'augmentationRouteNetworkConflictExclusions'),
    false,
  );
  assert.equal(
    Object.hasOwn(generator, 'augmentationRouteNetworkPruningOverrides'),
    false,
  );
});

test('room-side connector preflight replay excludes the exact supplemental node, not its path', () => {
  const { generator } = createReplayLifecycleFixture();
  const operation = {
    id: 'operation:room-blocker',
    type: 'routeNetwork',
    grantId: 'grant:room-blocker',
    routeNetworkKind: 'objective-route-coverage',
  };
  const node = {
    id: 'node:room-blocker',
    operationId: operation.id,
    kind: 'supplementRoom',
    grammarId: 'industrial-switchback-room',
    contentRole: 'challenge',
    placement: { center: { x: 8.4, y: 0, z: 0 }, rotationQuarterTurns: 0 },
    size: { x: 14, y: 5.6, z: 14 },
    structure: {
      collisionVolumes: [{
        id: 'node:room-blocker:interior-obstruction',
        center: { x: 5.6, y: 1.4, z: 0 },
        size: { x: 2.8, y: 2.8, z: 2.8 },
      }],
    },
    sockets: [{
      id: 'node:room-blocker:entry',
      localSocketId: 'entry',
      position: { x: 1.4, y: 0, z: 0 },
      facing: { x: -1, y: 0, z: 0 },
    }],
  };
  const exclusion = {
    grantId: operation.grantId,
    entityKind: 'node',
    entityId: node.id,
    signature: createRouteNetworkConflictEntitySignature(node, 'node'),
    reason: 'route-network-runtime-connector-preflight-failed',
  };
  const acceptedDungeon = {
    id: 'room-blocker-replacement-accepted',
    augmentationStatus: 'applied',
    progression: { validation: { accepted: true, errors: [] } },
  };
  const observedConflictExclusions = [];
  const observedGrantPruningOverrides = [];
  let generationPass = 0;
  generator._generateOnce = () => {
    generationPass += 1;
    observedConflictExclusions.push([
      ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
    ]);
    observedGrantPruningOverrides.push([
      ...(generator.augmentationRouteNetworkPruningOverrides ?? []),
    ]);
    if (generationPass > 1) return acceptedDungeon;
    const error = new Error('Synthetic room-side connector preflight blocker.');
    error.code = 'DUNGEON_AUGMENTATION_CONNECTOR_PREFLIGHT_FAILED';
    error.augmentationDiagnostics = {
      status: 'unchanged',
      reason: 'connector-entrance-preflight-failed',
      augmentationPlanHash: 'augmentation:room-blocker-rejected',
      routeNetworkGrantIds: [operation.grantId],
      failedRouteNetworkGrants: [{
        grantId: operation.grantId,
        augmentationOperationId: operation.id,
        routeNetworkKind: operation.routeNetworkKind,
        connectionIds: [],
        roomIds: [node.id],
        socketIds: [node.sockets[0].id],
      }],
      routeNetworkConflictExclusions: [exclusion],
      errors: ['synthetic room-side connector blocker'],
    };
    throw error;
  };

  const result = generator._generateIndustrialDungeonWithAugmentationReplay();
  assert.equal(result, acceptedDungeon);
  assert.equal(generationPass, 2);
  assert.deepEqual(observedConflictExclusions, [[], [exclusion]]);
  assert.deepEqual(observedGrantPruningOverrides, [[], []]);
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .excludedRouteNetworkEntities,
    [exclusion],
  );
});

test('room-side failure on an authored parent room never excludes a supplemental node', () => {
  const { generator, baseDungeon } = createReplayLifecycleFixture();
  const operation = {
    id: 'operation:authored-parent-attachment',
    type: 'routeNetwork',
    grantId: 'grant:authored-parent-attachment',
    routeNetworkKind: 'objective-route-coverage',
  };
  const supplementalNode = {
    id: 'node:healthy-supplement',
    operationId: operation.id,
    kind: 'supplementRoom',
    grammarId: 'industrial-switchback-room',
    placement: { center: { x: 8.4, y: 0, z: 0 }, rotationQuarterTurns: 0 },
    size: { x: 14, y: 5.6, z: 14 },
    sockets: [],
  };
  const rejectedDungeon = {
    id: 'authored-parent-room-side-rejection',
    augmentationStatus: 'applied',
    augmentationOverlayPlan: {
      operations: [operation],
      nodes: [supplementalNode],
      segments: [],
    },
    rooms: [{
      id: 'authored-parent-room',
      augmentationOperationId: operation.id,
    }],
    connectionPlans: [],
    progression: {
      validation: {
        accepted: false,
        errors: ['synthetic authored parent room-side failure'],
        connectorEntrances: {
          failedRouteNetworkGrants: [{
            grantId: operation.grantId,
            augmentationOperationId: operation.id,
            roomIds: ['authored-parent-room'],
            socketIds: ['authored-parent-room:socket'],
          }],
          checks: [{
            accepted: false,
            augmentationOperationId: operation.id,
            roomId: 'authored-parent-room',
            socketId: 'authored-parent-room:socket',
            roomSideFailure: true,
            pathSideFailure: false,
          }],
        },
      },
    },
  };
  const observedConflictExclusions = [];
  const observedGrantPruningOverrides = [];
  generator._generateOnce = () => {
    observedConflictExclusions.push([
      ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
    ]);
    observedGrantPruningOverrides.push([
      ...(generator.augmentationRouteNetworkPruningOverrides ?? []),
    ]);
    return rejectedDungeon;
  };

  assert.equal(generator._generateIndustrialDungeonWithAugmentationReplay(), baseDungeon);
  assert.deepEqual(observedConflictExclusions, [[]]);
  assert.deepEqual(observedGrantPruningOverrides, [[]]);
  assert.equal(baseDungeon.augmentationReplayDiagnostics.runtimePruningPasses, 0);
});

test('aggregate global room reachability failure does not ban an otherwise healthy module', () => {
  const { generator, baseDungeon } = createReplayLifecycleFixture();
  const operation = {
    id: 'operation:aggregate-room-check',
    type: 'routeNetwork',
    grantId: 'grant:aggregate-room-check',
    routeNetworkKind: 'objective-route-coverage',
  };
  const node = {
    id: 'node:aggregate-room-check',
    operationId: operation.id,
    kind: 'supplementRoom',
    grammarId: 'industrial-switchback-room',
    placement: { center: { x: 8.4, y: 0, z: 0 }, rotationQuarterTurns: 0 },
    size: { x: 14, y: 5.6, z: 14 },
    sockets: [],
  };
  const rejectedDungeon = {
    id: 'aggregate-room-rejection',
    augmentationStatus: 'applied',
    augmentationOverlayPlan: {
      operations: [operation],
      nodes: [node],
      segments: [],
    },
    rooms: [{ id: node.id, augmentationOperationId: operation.id }],
    connectionPlans: [],
    progression: {
      validation: {
        accepted: false,
        errors: ['synthetic global reachability failure'],
        platformability: {
          supplementRoomConnectivityChecks: [{
            accepted: false,
            operationId: operation.id,
            roomId: node.id,
            meetsSubstantiveRoomFootprint: true,
            // These aggregate values are false in the real validator whenever
            // only global reachability fails. Attribution must inspect their
            // local constituents instead of treating either aggregate as a
            // defect in this room's exact physical signature.
            baseFootprintCoverageAccepted: false,
            localRoomConnectivityAccepted: false,
            missingBaseFootprintColumnKeys: [],
            nonNavigableBaseFootprintFloorKeys: [],
            locallyUnreachableBaseFootprintFloorKeys: [],
            locallyNonReturnableBaseFootprintFloorKeys: [],
            localApproachChecks: [{
              floorKey: 'healthy-floor@0.000',
              reachableFromFirstApproach: true,
              returnReachable: true,
            }],
            locallyUnreachableRoomFloorKeys: [],
            locallyNonReturnableRoomFloorKeys: [],
            unexpectedNonNavigableRoomFloorKeys: [],
            outsideDeclaredRoomFloorKeys: [],
            foreignRoomFloorOwnership: [],
            globallyUnreachableBaseFootprintFloorKeys: ['healthy-floor@0.000'],
            globallyNonReturnableRoomFloorKeys: ['healthy-floor@0.000'],
          }],
        },
      },
    },
  };
  const observedConflictExclusions = [];
  generator._generateOnce = () => {
    observedConflictExclusions.push([
      ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
    ]);
    return rejectedDungeon;
  };

  assert.equal(generator._generateIndustrialDungeonWithAugmentationReplay(), baseDungeon);
  assert.deepEqual(observedConflictExclusions, [[]]);
  assert.equal(baseDungeon.augmentationReplayDiagnostics.runtimePruningPasses, 0);
});

test('a local room component failure still excludes that exact supplemental node', () => {
  const { generator } = createReplayLifecycleFixture();
  const operation = {
    id: 'operation:local-room-check',
    type: 'routeNetwork',
    grantId: 'grant:local-room-check',
    routeNetworkKind: 'objective-route-coverage',
  };
  const node = {
    id: 'node:local-room-check',
    operationId: operation.id,
    kind: 'supplementRoom',
    grammarId: 'industrial-switchback-room',
    placement: { center: { x: 8.4, y: 0, z: 0 }, rotationQuarterTurns: 0 },
    size: { x: 14, y: 5.6, z: 14 },
    sockets: [],
  };
  const exclusion = {
    grantId: operation.grantId,
    entityKind: 'node',
    entityId: node.id,
    signature: createRouteNetworkConflictEntitySignature(node, 'node'),
    reason: 'route-network-runtime-physical-validation-failed',
  };
  const rejectedDungeon = {
    id: 'local-room-rejection',
    augmentationStatus: 'applied',
    augmentationOverlayPlan: {
      operations: [operation],
      nodes: [node],
      segments: [],
    },
    rooms: [{ id: node.id, augmentationOperationId: operation.id }],
    connectionPlans: [],
    progression: {
      validation: {
        accepted: false,
        errors: ['synthetic local room component failure'],
        platformability: {
          supplementRoomConnectivityChecks: [{
            accepted: false,
            operationId: operation.id,
            roomId: node.id,
            meetsSubstantiveRoomFootprint: true,
            baseFootprintCoverageAccepted: true,
            localRoomConnectivityAccepted: false,
            missingBaseFootprintColumnKeys: [],
            nonNavigableBaseFootprintFloorKeys: [],
            locallyUnreachableBaseFootprintFloorKeys: [],
            locallyNonReturnableBaseFootprintFloorKeys: [],
            localApproachChecks: [{
              floorKey: 'local-room-entry@0.000',
              reachableFromFirstApproach: true,
              returnReachable: true,
            }],
            connectedSocketIds: ['local-room:entry'],
            distinctLocalApproachCount: 1,
            locallyUnreachableRoomFloorKeys: ['local-room-interior@0.000'],
            locallyNonReturnableRoomFloorKeys: [],
            globallyNonReturnableRoomFloorKeys: [],
            unexpectedNonNavigableRoomFloorKeys: [],
            outsideDeclaredRoomFloorKeys: [],
            foreignRoomFloorOwnership: [],
          }],
        },
      },
    },
  };
  const acceptedDungeon = {
    id: 'local-room-replacement-accepted',
    augmentationStatus: 'applied',
    progression: { validation: { accepted: true, errors: [] } },
  };
  const observedConflictExclusions = [];
  let generationPass = 0;
  generator._generateOnce = () => {
    generationPass += 1;
    observedConflictExclusions.push([
      ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
    ]);
    return generationPass === 1 ? rejectedDungeon : acceptedDungeon;
  };

  assert.equal(generator._generateIndustrialDungeonWithAugmentationReplay(), acceptedDungeon);
  assert.deepEqual(observedConflictExclusions, [[], [exclusion]]);
  assert.equal(acceptedDungeon.augmentationReplayDiagnostics.runtimePruningPasses, 1);
});

test('global connector reachability and shortcut-control failures do not ban a healthy path', () => {
  for (const failureKind of ['global-centerline', 'shortcut-control']) {
    const { generator, baseDungeon } = createReplayLifecycleFixture();
    const operation = {
      id: `operation:${failureKind}`,
      type: 'routeNetwork',
      grantId: `grant:${failureKind}`,
      routeNetworkKind: failureKind === 'shortcut-control'
        ? 'cross-band-shortcut'
        : 'objective-route-coverage',
    };
    const segment = {
      id: `segment:${failureKind}`,
      operationId: operation.id,
      kind: 'route-network-segment',
      connectorFamily: failureKind === 'shortcut-control' ? 'lift' : 'service-gallery',
      routeRole: `${operation.routeNetworkKind}:spine`,
      from: {
        position: { x: 0, y: 0, z: 0 },
        facing: { x: 1, y: 0, z: 0 },
      },
      to: {
        position: { x: 8.4, y: 0, z: 0 },
        facing: { x: -1, y: 0, z: 0 },
      },
      path: [{ x: 0, y: 0, z: 0 }, { x: 8.4, y: 0, z: 0 }],
    };
    const healthyLocalConnectivity = {
      connectionId: segment.id,
      operationId: operation.id,
      accepted: failureKind !== 'global-centerline',
      centerlineChecks: [{
        floorKey: 'healthy-segment-floor@0.000',
        reachable: failureKind !== 'global-centerline',
      }],
      missingOwnedCenterlinePointCount: 0,
      // This is the real aggregate produced when the segment is locally
      // complete but its whole operation is disconnected upstream.
      unreachableCenterlinePointCount: failureKind === 'global-centerline' ? 1 : 0,
      locallyUnreachableTraversalFloorKeys: [],
      locallyNonReturnableTraversalFloorKeys: [],
      strictLocalComponentAccepted: true,
      finalCollisionSpineCheck: {
        accepted: true,
        malformed: false,
        missingFloorKeys: [],
        foreignOwnerFloorKeys: [],
        forwardAccepted: true,
        reverseAccepted: true,
      },
      needsVerticalTransfer: false,
      hasRampTransfer: false,
      hasRealVerticalTransfer: true,
      verticalContractChecks: [],
    };
    const platformability = {
      supplementConnectivityChecks: [healthyLocalConnectivity],
      ...(failureKind === 'shortcut-control' ? {
        supplementShortcutConnectivityChecks: [{
          connectionId: segment.id,
          operationId: operation.id,
          accepted: false,
          sourceReachableBeforeActivation: true,
          farSideReachableBeforeActivation: true,
          postActivationBidirectional: true,
          initiallyUnavailable: true,
          matchingContractChecks: [{ accepted: true }],
          matchingTraversalLinkIds: ['shortcut:forward', 'shortcut:reverse'],
          mechanismRecordAccepted: false,
        }],
      } : {}),
    };
    const rejectedDungeon = {
      id: `aggregate-${failureKind}-rejection`,
      augmentationStatus: 'applied',
      augmentationOverlayPlan: {
        operations: [operation],
        nodes: [],
        segments: [segment],
      },
      rooms: [],
      connectionPlans: [{
        id: segment.id,
        augmentationOperationId: operation.id,
        routeNetworkGrantId: operation.grantId,
        isDungeonSupplement: true,
      }],
      progression: {
        validation: {
          accepted: false,
          errors: [`synthetic ${failureKind} failure`],
          platformability,
        },
      },
    };
    const observedConflictExclusions = [];
    let generationPass = 0;
    generator._generateOnce = () => {
      generationPass += 1;
      observedConflictExclusions.push([
        ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
      ]);
      return rejectedDungeon;
    };

    assert.equal(
      generator._generateIndustrialDungeonWithAugmentationReplay(),
      baseDungeon,
      failureKind,
    );
    assert.equal(generationPass, 1, failureKind);
    assert.deepEqual(observedConflictExclusions, [[]], failureKind);
    assert.equal(
      baseDungeon.augmentationReplayDiagnostics.runtimePruningPasses,
      0,
      failureKind,
    );
  }
});

test('augmentation replay replaces one exact late-conflicting segment and retains unrelated networks', () => {
  const { generator } = createReplayLifecycleFixture();
  const retainedOperation = {
    id: 'operation:retained',
    type: 'routeNetwork',
    grantId: 'grant:retained',
    routeNetworkKind: 'landmark-perimeter-loop',
  };
  const conflictingOperation = {
    id: 'operation:conflicting',
    type: 'routeNetwork',
    grantId: 'grant:conflicting',
    routeNetworkKind: 'objective-route-coverage',
  };
  const conflictingSegment = {
    id: 'connection:conflicting',
    operationId: conflictingOperation.id,
    kind: 'route-network-segment',
    connectorFamily: 'service-gallery',
    routeRole: 'objective-route-coverage:spine',
    from: {
      nodeId: 'authored:a',
      socketId: 'authored:a:exit',
      position: { x: 0, y: 0, z: 0 },
      facing: { x: 1, y: 0, z: 0 },
    },
    to: {
      nodeId: 'supplement:conflicting',
      socketId: 'supplement:conflicting:entry',
      position: { x: 8.4, y: 0, z: 0 },
      facing: { x: -1, y: 0, z: 0 },
    },
    path: [{ x: 0, y: 0, z: 0 }, { x: 8.4, y: 0, z: 0 }],
  };
  const exclusion = {
    grantId: conflictingOperation.grantId,
    entityKind: 'segment',
    entityId: conflictingSegment.id,
    signature: createRouteNetworkConflictEntitySignature(
      conflictingSegment,
      'segment',
    ),
    reason: 'route-network-runtime-physical-validation-failed',
  };
  const rejectedDungeon = {
    id: 'late-physical-rejection',
    augmentationStatus: 'applied',
    augmentationPlanHash: 'augmentation:late-physical-rejection',
    augmentationOverlayPlan: {
      operations: [retainedOperation, conflictingOperation],
      nodes: [],
      segments: [conflictingSegment],
    },
    connectionPlans: [{
      id: 'connection:conflicting',
      isDungeonSupplement: true,
      augmentationOperationId: conflictingOperation.id,
      routeNetworkGrantId: conflictingOperation.grantId,
    }],
    rooms: [],
    progression: {
      validation: {
        accepted: false,
        errors: ['Synthetic late physical validation failure.'],
        platformability: {
          supplementConnectivityChecks: [{
            connectionId: 'connection:conflicting',
            operationId: conflictingOperation.id,
            accepted: false,
            missingOwnedCenterlinePointCount: 1,
          }],
        },
      },
    },
  };
  const acceptedDungeon = {
    id: 'late-physical-repaired',
    augmentationStatus: 'applied',
    augmentationOverlayPlan: {
      operations: [retainedOperation, conflictingOperation],
      nodes: [],
      segments: [{
        ...conflictingSegment,
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 2.8, y: 0, z: 2.8 },
          { x: 8.4, y: 0, z: 0 },
        ],
      }],
    },
    progression: { validation: { accepted: true, errors: [] } },
  };
  const observedOverrides = [];
  const observedConflictExclusions = [];
  const disposalCalls = [];
  generator._generateOnce = () => {
    observedOverrides.push([
      ...(generator.augmentationRouteNetworkPruningOverrides ?? []),
    ]);
    observedConflictExclusions.push([
      ...(generator.augmentationRouteNetworkConflictExclusions ?? []),
    ]);
    return observedOverrides.length === 1 ? rejectedDungeon : acceptedDungeon;
  };
  generator._disposeGeneratedDungeonCandidate = (candidate, preserved = null) => {
    disposalCalls.push([candidate?.id, preserved?.id ?? null]);
  };

  const result = generator._generateIndustrialDungeonWithAugmentationReplay();
  assert.equal(result, acceptedDungeon);
  assert.deepEqual(observedOverrides, [[], []]);
  assert.deepEqual(observedConflictExclusions, [[], [exclusion]]);
  assert.equal(result.augmentationReplayDiagnostics.realizationAttempts, 1);
  assert.equal(result.augmentationReplayDiagnostics.runtimePruningPasses, 1);
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .prunedRouteNetworkGrantIds,
    [],
  );
  assert.deepEqual(
    result.augmentationReplayDiagnostics.runtimePruningRecords[0]
      .excludedRouteNetworkEntities,
    [exclusion],
  );
  assert.deepEqual(
    result.augmentationOverlayPlan.operations.map(({ id }) => id),
    [retainedOperation.id, conflictingOperation.id],
    'the unrelated landmark and repaired coverage network must both remain',
  );
  assert.deepEqual(disposalCalls, [
    ['late-physical-rejection', 'base'],
    ['base', 'late-physical-repaired'],
  ]);
});

test('augmentation replay never prunes the final retained route network', () => {
  const { generator, baseDungeon } = createReplayLifecycleFixture();
  let generationPass = 0;
  generator._generateOnce = () => {
    generationPass += 1;
    const error = new Error('Synthetic final-network connector conflict.');
    error.code = 'DUNGEON_AUGMENTATION_CONNECTOR_PREFLIGHT_FAILED';
    error.augmentationDiagnostics = {
      status: 'unchanged',
      reason: 'connector-entrance-preflight-failed',
      routeNetworkGrantIds: ['grant:final'],
      failedRouteNetworkGrants: [{ grantId: 'grant:final' }],
      errors: ['synthetic final-network connector conflict'],
    };
    throw error;
  };

  assert.equal(generator._generateIndustrialDungeonWithAugmentationReplay(), baseDungeon);
  assert.equal(generationPass, 1);
  assert.equal(baseDungeon.augmentationReplayDiagnostics.runtimePruningPasses, 0);
  assert.equal(baseDungeon.augmentationReplayDiagnostics.realizationAttempts, 1);
});

test('augmentation replay owns and disposes accepted, rejected, and failed candidates exactly once', () => {
  {
    const { generator, baseDungeon } = createReplayLifecycleFixture();
    const acceptedDungeon = {
      id: 'accepted',
      augmentationStatus: 'applied',
      progression: { validation: { accepted: true, errors: [] } },
    };
    const disposalCalls = [];
    generator._generateOnce = () => acceptedDungeon;
    generator._disposeGeneratedDungeonCandidate = (candidate, preserved = null) => {
      disposalCalls.push([candidate?.id, preserved?.id ?? null]);
    };
    assert.equal(generator._generateIndustrialDungeonWithAugmentationReplay(), acceptedDungeon);
    assert.deepEqual(disposalCalls, [['base', 'accepted']]);
  }

  {
    const { generator, baseDungeon } = createReplayLifecycleFixture();
    const rejectedDungeon = {
      id: 'rejected',
      augmentationStatus: 'applied',
      augmentationDiagnostics: { errors: [] },
      progression: { validation: { accepted: false, errors: ['synthetic-invalid'] } },
    };
    const disposalCalls = [];
    generator._generateOnce = () => rejectedDungeon;
    generator._disposeGeneratedDungeonCandidate = (candidate, preserved = null) => {
      disposalCalls.push([candidate?.id, preserved?.id ?? null]);
    };
    assert.equal(generator._generateIndustrialDungeonWithAugmentationReplay(), baseDungeon);
    assert.deepEqual(disposalCalls, [['rejected', 'base']]);
  }

  {
    const { generator, baseDungeon } = createReplayLifecycleFixture();
    const disposalCalls = [];
    generator._generateOnce = () => { throw createExpectedPlanningRejection(); };
    generator._disposeGeneratedDungeonCandidate = (candidate, preserved = null) => {
      disposalCalls.push([candidate?.id, preserved?.id ?? null]);
    };
    assert.equal(generator._generateIndustrialDungeonWithAugmentationReplay(), baseDungeon);
    assert.deepEqual(disposalCalls, [], 'a thrown _generateOnce owns its partial cleanup');
  }

  {
    const { generator, baseDungeon } = createReplayLifecycleFixture({ committed: true });
    const rejectedDungeon = {
      id: 'committed-rejected',
      augmentationStatus: 'applied',
      augmentationDiagnostics: { errors: [] },
      progression: { validation: { accepted: false, errors: ['committed-invalid'] } },
    };
    const disposalCalls = [];
    const committedCleanupErrors = [
      new Error('Synthetic committed candidate cleanup failure.'),
      new Error('Synthetic committed base cleanup failure.'),
    ];
    generator._generateOnce = () => rejectedDungeon;
    generator._disposeGeneratedDungeonCandidate = (candidate, preserved = null) => {
      disposalCalls.push([candidate?.id, preserved?.id ?? null]);
      throw committedCleanupErrors[disposalCalls.length - 1];
    };
    assert.throws(
      () => generator._generateIndustrialDungeonWithAugmentationReplay(),
      (error) => (
        error.name === 'DungeonAugmentationIncompatibleContentError'
          && error.generationCandidateCleanupError === committedCleanupErrors[0]
          && error.generationCandidateCleanupErrors?.length === 2
      ),
    );
    assert.deepEqual(disposalCalls, [
      ['committed-rejected', 'base'],
      ['base', null],
    ]);
    assert.equal(Object.hasOwn(generator, 'augmentationPlanSeedOverride'), false);
    assert.equal(baseDungeon.id, 'base');
  }
});

test('augmentation replay propagates programming failures and preserves primary cleanup errors', () => {
  {
    const { generator } = createReplayLifecycleFixture();
    const snapshotError = new TypeError('Synthetic planning snapshot failure.');
    const disposalCalls = [];
    generator._createIndustrialDungeonAugmentationPlanningSnapshot = () => {
      throw snapshotError;
    };
    generator._disposeGeneratedDungeonCandidate = (candidate, preserved = null) => {
      disposalCalls.push([candidate?.id, preserved?.id ?? null]);
    };
    assert.throws(
      () => generator._generateIndustrialDungeonWithAugmentationReplay(),
      (error) => error === snapshotError,
    );
    assert.deepEqual(disposalCalls, [['base', null]]);
    assert.equal(Object.hasOwn(generator, 'augmentationPlanSeedOverride'), false);
  }

  {
    const { generator } = createReplayLifecycleFixture();
    const primaryError = new TypeError('Synthetic programming failure.');
    const cleanupError = new Error('Synthetic base cleanup failure.');
    const disposalCalls = [];
    generator._generateOnce = () => { throw primaryError; };
    generator._disposeGeneratedDungeonCandidate = (candidate, preserved = null) => {
      disposalCalls.push([candidate?.id, preserved?.id ?? null]);
      throw cleanupError;
    };
    assert.throws(
      () => generator._generateIndustrialDungeonWithAugmentationReplay(),
      (error) => (
        error === primaryError
          && error.generationCandidateCleanupError === cleanupError
      ),
    );
    assert.deepEqual(disposalCalls, [['base', null]]);
    assert.equal(Object.hasOwn(generator, 'augmentationPlanSeedOverride'), false);
    assert.equal(
      Object.hasOwn(generator, '_augmentationReplayPlanningSnapshotOverride'),
      false,
    );
  }

  {
    const { generator } = createReplayLifecycleFixture();
    const rejectedDungeon = {
      id: 'dispose-rejected',
      augmentationStatus: 'applied',
      augmentationDiagnostics: { errors: [] },
      progression: { validation: { accepted: false, errors: ['synthetic-invalid'] } },
    };
    const disposalError = new Error('Synthetic rejected-candidate disposal failure.');
    const disposalCalls = [];
    generator._generateOnce = () => rejectedDungeon;
    generator._disposeGeneratedDungeonCandidate = (candidate, preserved = null) => {
      disposalCalls.push([candidate?.id, preserved?.id ?? null]);
      if (candidate === rejectedDungeon) throw disposalError;
    };
    assert.throws(
      () => generator._generateIndustrialDungeonWithAugmentationReplay(),
      (error) => error === disposalError,
    );
    assert.deepEqual(disposalCalls, [
      ['dispose-rejected', 'base'],
      ['base', null],
    ]);
    assert.equal(Object.hasOwn(generator, 'augmentationPlanSeedOverride'), false);
  }

  {
    const { generator } = createReplayLifecycleFixture();
    const acceptedDungeon = {
      id: 'finalize-rejected',
      augmentationStatus: 'applied',
      progression: { validation: { accepted: true, errors: [] } },
    };
    const finalizationError = new Error('Synthetic finalization failure.');
    const disposalCalls = [];
    generator._generateOnce = () => acceptedDungeon;
    generator._finalizeAcceptedIndustrialDungeon = () => { throw finalizationError; };
    generator._disposeGeneratedDungeonCandidate = (candidate, preserved = null) => {
      disposalCalls.push([candidate?.id, preserved?.id ?? null]);
    };
    assert.throws(
      () => generator._generateIndustrialDungeonWithAugmentationReplay(),
      (error) => error === finalizationError,
    );
    assert.deepEqual(disposalCalls, [
      ['finalize-rejected', 'base'],
      ['base', null],
    ]);
  }
});

test('V4 endpoint seams quantize half-grid thresholds once for every cardinal facing', () => {
  const tileSize = 2.8;
  const facings = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
  ];
  const cases = facings.flatMap((facing, facingIndex) => (
    [-1, 1].map((thresholdSign) => {
      const normalAlongX = Math.abs(facing.x) > 0.5;
      return {
        facing,
        facingIndex,
        thresholdSign,
        position: normalAlongX
          ? { x: thresholdSign * 29.4, y: 14, z: thresholdSign * -18.2 }
          : { x: thresholdSign * -18.2, y: 14, z: thresholdSign * 29.4 },
      };
    })
  ));
  for (const [index, {
    facing,
    facingIndex,
    thresholdSign,
    position,
  }] of cases.entries()) {
    const seam = createDungeonRouteEndpointSeam({
      id: `socket-${index}`,
      nodeId: `node-${index}`,
      position,
      facing,
    }, {
      id: `segment-${index}:from-endpoint-seam`,
      segmentId: `segment-${index}`,
      operationId: 'operation-0',
      networkId: 'operation-0',
      role: 'from',
      elevationBand: 2,
    });
    assert.equal(seam.schema, 'ruindivex-dungeon-route-endpoint-seam/v1');
    assert.equal(seam.widthTiles, 3);
    assert.equal(seam.depthTiles, 5);
    assert.equal(seam.orderedCells.length, 15);
    assert.deepEqual(
      [...new Set(seam.orderedCells.map(({ lane }) => lane))],
      [-1, 0, 1],
    );
    assert.deepEqual(
      [...new Set(seam.orderedCells.map(({ signedDepthTiles }) => signedDepthTiles))],
      [-2, -1, 0, 1, 2],
    );
    assert.equal(seam.orderedCells[0].signedDepthTiles, -2);
    assert.equal(seam.orderedCells[0].lane, -1);
    assert.equal(seam.orderedCells.at(-1).signedDepthTiles, 2);
    assert.equal(seam.orderedCells.at(-1).lane, 1);
    const cellKeys = seam.orderedCells.map(({ gridX, gridZ }) => `${gridX},${gridZ}`);
    assert.equal(
      new Set(cellKeys).size,
      15,
      `facing ${facingIndex}, threshold sign ${thresholdSign}: ${cellKeys.join(' ')}`,
    );
    const thresholdGridX = Math.round(position.x / tileSize);
    const thresholdGridZ = Math.round(position.z / tileSize);
    const lateral = { x: -facing.z, z: facing.x };
    const cellsByLocalIdentity = new Map(seam.orderedCells.map((cell) => (
      [`${cell.signedDepthTiles}:${cell.lane}`, cell]
    )));
    for (let signedDepthTiles = -2; signedDepthTiles <= 2; signedDepthTiles += 1) {
      for (let lane = -1; lane <= 1; lane += 1) {
        const cell = cellsByLocalIdentity.get(`${signedDepthTiles}:${lane}`);
        assert.ok(cell);
        assert.deepEqual(
          { gridX: cell.gridX, gridZ: cell.gridZ },
          {
            gridX: thresholdGridX + facing.x * signedDepthTiles + lateral.x * lane,
            gridZ: thresholdGridZ + facing.z * signedDepthTiles + lateral.z * lane,
          },
          `facing ${facingIndex}, threshold sign ${thresholdSign}, cell ${signedDepthTiles}:${lane}`,
        );
        assert.deepEqual(cell.position, {
          x: Number((position.x
            + facing.x * signedDepthTiles * tileSize
            + lateral.x * lane * tileSize).toFixed(6)),
          y: position.y,
          z: Number((position.z
            + facing.z * signedDepthTiles * tileSize
            + lateral.z * lane * tileSize).toFixed(6)),
        });
        if (lane < 1) {
          const nextLane = cellsByLocalIdentity.get(`${signedDepthTiles}:${lane + 1}`);
          assert.equal(
            Math.abs(cell.gridX - nextLane.gridX) + Math.abs(cell.gridZ - nextLane.gridZ),
            1,
          );
        }
        if (signedDepthTiles < 2) {
          const nextDepth = cellsByLocalIdentity.get(`${signedDepthTiles + 1}:${lane}`);
          assert.equal(
            Math.abs(cell.gridX - nextDepth.gridX) + Math.abs(cell.gridZ - nextDepth.gridZ),
            1,
          );
        }
      }
    }
    const normalAlongX = Math.abs(facing.x) > 0.5;
    assert.deepEqual(seam.overlapEnvelope.size, {
      x: normalAlongX ? 14 : 8.4,
      y: 5.6,
      z: normalAlongX ? 8.4 : 14,
    });
    assert.deepEqual(seam.ownerIds, {
      seamId: seam.id,
      segmentId: `segment-${index}`,
      nodeId: `node-${index}`,
      socketId: `socket-${index}`,
    });
  }
});

test('V4 immutable selection bags preserve shuffle order and failed branches', () => {
  const bag = createDungeonSelectionBag({
    shuffle: (ids) => [...ids].reverse(),
  }, ['beta', 'alpha', 'gamma', 'beta']);
  assert.deepEqual(bag, {
    order: ['gamma', 'beta', 'alpha'],
    cycle: 0,
    consumedIds: [],
  });
  const parentSnapshot = structuredClone(bag);
  const candidates = dungeonSelectionBagCandidates(bag, ['alpha', 'gamma']);
  assert.deepEqual(candidates.map(({ id }) => id), ['gamma', 'alpha']);
  assert.deepEqual(bag, parentSnapshot);
  assert.deepEqual(
    dungeonSelectionBagCandidates(bag, ['alpha', 'gamma']).map(({ id }) => id),
    ['gamma', 'alpha'],
  );

  const afterGamma = candidates[0].state;
  const afterAlpha = dungeonSelectionBagCandidates(afterGamma, ['alpha', 'gamma'])
    .find(({ id }) => id === 'alpha').state;
  const refilled = dungeonSelectionBagCandidates(afterAlpha, ['alpha', 'gamma']);
  assert.equal(refilled.every(({ refilled: didRefill }) => didRefill), true);
  assert.equal(refilled[0].state.cycle, 1);
});

test('V4 selection bags isolate overlapping legal compatibility domains', () => {
  const bag = createDungeonSelectionBag({ shuffle: (ids) => ids }, ['a', 'b', 'c']);
  const parentSnapshot = structuredClone(bag);
  const challengeA = dungeonSelectionBagCandidates(bag, ['a', 'b'])[0];
  assert.equal(challengeA.id, 'a');
  // Enumerating and discarding a branch cannot consume its choice.
  assert.deepEqual(bag, parentSnapshot);
  assert.equal(dungeonSelectionBagCandidates(bag, ['a', 'b'])[0].id, 'a');

  const rewardB = dungeonSelectionBagCandidates(challengeA.state, ['b', 'c'])[0];
  assert.equal(rewardB.id, 'b');
  const challengeB = dungeonSelectionBagCandidates(rewardB.state, ['a', 'b'])[0];
  assert.equal(challengeB.id, 'b');
  const rewardC = dungeonSelectionBagCandidates(challengeB.state, ['b', 'c'])[0];
  assert.equal(rewardC.id, 'c');

  const refilledChallenge = dungeonSelectionBagCandidates(
    rewardC.state,
    ['b', 'a'],
  );
  assert.equal(refilledChallenge.every(({ refilled }) => refilled), true);
  assert.deepEqual(refilledChallenge.map(({ id }) => id), ['a', 'b']);
  assert.equal(refilledChallenge[0].state.cycle, 1);
  // Refilling A/B never releases B early in the overlapping B/C domain.
  assert.equal(
    dungeonSelectionBagCandidates(refilledChallenge[0].state, ['b', 'c'])[0].id,
    'b',
  );
});

test('V4 selection bag RNG families are isolated and replayable', () => {
  const root = new DungeonAugmentationRandom('selection-bag-replay');
  const first = createDungeonSelectionBag(root.fork('topology'), ['a', 'b', 'c']);
  root.fork('encounter').next();
  root.fork('encounter').next();
  const replayed = createDungeonSelectionBag(root.fork('topology'), ['a', 'b', 'c']);
  assert.deepEqual(first, replayed);
  assert.notDeepEqual(
    first.order,
    createDungeonSelectionBag(root.fork('room-layout'), ['a', 'b', 'c']).order,
  );
});

function makeFixture({
  profileId = 'industrial-supplement-preview-v1',
  crossTheme = false,
  includeCapabilities = true,
  delegatedProgressionBeats = [],
} = {}) {
  const baseDraft = {
    schema: 'fixture-base-draft/v1',
    basePlanHash: 'fixture-base-plan-v1',
    rooms: [{
      id: 'far-authored-room',
      occupiedVolumes: [{
        id: 'far-authored-room:body',
        center: { x: 0, y: 2.8, z: 160 },
        size: { x: 20, y: 5.6, z: 20 },
      }],
    }],
    occupiedVolumes: [],
    protectedVolumes: [],
    connectionPlans: [{ id: 'legacy-edge-record', untouched: true }],
    progression: { keys: ['alpha'], gates: ['alpha-door'] },
  };
  const extensionRegion = {
    id: 'fixture-region',
    themeBinding: SOURCE_THEME,
    attachmentSockets: [{
      id: 'fixture-branch-socket',
      nodeId: 'authored-side-room',
      position: { x: -80, y: 0, z: -80 },
      facing: { x: 0, y: 0, z: -1 },
      widthMeters: 8.4,
      heightMeters: 5.6,
      availableDepthMeters: 160,
      connectorFamilies: ['service-gallery'],
    }],
    spliceEdges: [{
      id: 'fixture-splice-edge',
      logicalEdgeId: 'authored-a_authored-b',
      gateId: 'alpha-door',
      credentialRequirement: 'alpha',
      progressionTier: 2,
      dominanceBoundary: 'alpha-door:deeper-side',
      connectorFamilies: ['service-gallery'],
      availableLengthMeters: 120,
      path: [
        { x: -60, y: 0, z: 0 },
        { x: 60, y: 0, z: 0 },
      ],
      from: {
        nodeId: 'authored-a',
        socketId: 'authored-a:exit',
        position: { x: -60, y: 0, z: 0 },
        facing: { x: 1, y: 0, z: 0 },
      },
      to: {
        nodeId: 'authored-b',
        socketId: 'authored-b:entry',
        position: { x: 60, y: 0, z: 0 },
        facing: { x: -1, y: 0, z: 0 },
      },
      sourceThemeBinding: SOURCE_THEME,
      destinationThemeBinding: crossTheme ? DESTINATION_THEME : SOURCE_THEME,
    }],
    allowedProfileIds: [profileId],
    delegatedProgressionBeats,
    ...(includeCapabilities ? { themeCapabilities: COMPLETE_CAPABILITIES } : {}),
  };
  return {
    baseDraft,
    extensionRegions: [extensionRegion],
    themeCapabilitiesByRegionId: crossTheme
      ? { 'fixture-magma-region': COMPLETE_CAPABILITIES }
      : {},
  };
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function assertRendererFree(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) {
    assert.notEqual(typeof child, 'function');
    assertRendererFree(child, seen);
  }
}

test('canonical hashing is stable across key order and rejects renderer-owned values', () => {
  const first = { z: 3, nested: { beta: true, alpha: [1, undefined, -0] }, a: 'value' };
  const second = { a: 'value', nested: { alpha: [1, null, 0], beta: true }, z: 3 };
  assert.equal(canonicalStringify(first), canonicalStringify(second));
  assert.equal(hashCanonicalValue(first), hashCanonicalValue(second));
  assert.match(hashCanonicalValue(first), /^v1-[a-f0-9]{32}$/);
  assert.throws(() => canonicalStringify({ assemble() {} }), /Unsupported function/);
});

test('labeled RNG forks are deterministic and isolated from sibling consumption', () => {
  const root = new DungeonAugmentationRandom('fork-isolation');
  const topologyBefore = root.fork('topology').next();
  const dressing = root.fork('dressing');
  for (let index = 0; index < 100; index += 1) dressing.next();
  const topologyAfter = root.fork('topology').next();
  assert.equal(topologyBefore, topologyAfter);
  assert.notEqual(root.fork('topology').next(), root.fork('progression').next());
});

test('an explicit augmentation seed deterministically controls the isolated overlay stream', () => {
  const fixture = makeFixture();
  const options = {
    ...fixture,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'parent-layout-seed',
    difficulty: 2,
  };
  const first = augmentDungeonDraft({
    ...options,
    augmentationSeed: 'explicit-overlay-seed',
  });
  const repeated = augmentDungeonDraft({
    ...options,
    augmentationSeed: 'explicit-overlay-seed',
  });
  const alternate = augmentDungeonDraft({
    ...options,
    augmentationSeed: 'alternate-overlay-seed',
  });

  assert.equal(first.status, 'applied');
  assert.equal(repeated.status, 'applied');
  assert.equal(alternate.status, 'applied');
  assert.equal(first.overlayPlan.augmentationSeed, 'explicit-overlay-seed');
  assert.deepEqual(repeated.overlayPlan, first.overlayPlan);
  assert.notEqual(
    alternate.overlayPlan.augmentationPlanHash,
    first.overlayPlan.augmentationPlanHash,
  );
});

test(`${VERIFICATION_SEED_COUNT} legacy seeds preserve the exact base for absent, disabled, and rejected augmentation`, () => {
  const disabledProfile = createDungeonAugmentationProfile({
    id: 'fixture-disabled-v1',
    enabled: false,
  });
  const legacyRandomSpy = {
    calls: 0,
    next() {
      this.calls += 1;
      return 0.5;
    },
  };
  for (let index = 0; index < VERIFICATION_SEED_COUNT; index += 1) {
    const fixture = makeFixture();
    const baseReference = fixture.baseDraft;
    const roomReference = baseReference.rooms;
    const connectionReference = baseReference.connectionPlans;
    const before = canonicalStringify(baseReference);
    const beforeHash = hashCanonicalValue(baseReference);
    const absent = augmentDungeonDraft({
      baseDraft: baseReference,
      layoutSeed: `legacy:${index}`,
      legacyRandom: legacyRandomSpy,
    });
    const disabled = augmentDungeonDraft({
      baseDraft: baseReference,
      extensionRegions: fixture.extensionRegions,
      profileId: disabledProfile.id,
      profiles: { [disabledProfile.id]: disabledProfile },
      layoutSeed: `legacy:${index}`,
      legacyRandom: legacyRandomSpy,
    });
    const rejectedFixture = makeFixture({ includeCapabilities: false });
    const rejected = augmentDungeonDraft({
      ...rejectedFixture,
      baseDraft: baseReference,
      profileId: 'industrial-supplement-preview-v1',
      layoutSeed: `legacy:${index}`,
      legacyRandom: legacyRandomSpy,
    });
    for (const result of [absent, disabled, rejected]) {
      assert.equal(result.status, 'unchanged');
      assert.equal(result.effectiveDraft, baseReference);
      assert.equal(result.overlayPlan, null);
    }
    assert.equal(absent.diagnostics.reason, 'augmentation-disabled');
    assert.equal(disabled.diagnostics.reason, 'augmentation-disabled');
    assert.equal(rejected.diagnostics.reason, 'validation-failed');
    assert.equal(baseReference.rooms, roomReference);
    assert.equal(baseReference.connectionPlans, connectionReference);
    assert.equal(canonicalStringify(baseReference), before);
    assert.equal(hashCanonicalValue(baseReference), beforeHash);
  }
  assert.equal(legacyRandomSpy.calls, 0);
});

test(`${VERIFICATION_SEED_COUNT} Industrial generator hooks leave the legacy RNG untouched when disabled or rejected`, () => {
  for (let index = 0; index < VERIFICATION_SEED_COUNT; index += 1) {
    const disabledRandom = { calls: 0, next() { this.calls += 1; return 0.5; } };
    const disabledGenerator = new DungeonGenerator({
      random: () => disabledRandom.next(),
      basePlanHash: `industrial-hook:${index}`,
      augmentationSeed: `industrial-hook:${index}`,
    });
    assert.equal(disabledGenerator._planIndustrialDungeonAugmentation({ rooms: [], connectionPlans: [] }), null);
    assert.equal(disabledRandom.calls, 0);

    const rejectedRandom = { calls: 0, next() { this.calls += 1; return 0.5; } };
    const rejectedGenerator = new DungeonGenerator({
      random: () => rejectedRandom.next(),
      basePlanHash: `industrial-hook:${index}`,
      augmentationSeed: `industrial-hook:${index}`,
      augmentationProfileId: 'industrial-supplement-preview-v1',
    });
    const rejected = rejectedGenerator._planIndustrialDungeonAugmentation({
      rooms: [],
      connectionPlans: [],
    });
    assert.equal(rejected.status, 'unchanged');
    assert.equal(rejected.result.effectiveDraft, rejected.baseDraft);
    assert.equal(rejectedRandom.calls, 0);
  }
});

test('missing parent theme capabilities and bindings stop realization after one attempt', () => {
  for (const failureCode of [
    'MISSING_THEME_CAPABILITY',
    'MISSING_PARENT_THEME_SESSION',
    'INVALID_THEME_MATERIAL',
    'THEME_ASSET_CREATION_FAILED',
    'THEME_CONNECTOR_CREATION_FAILED',
    'invalid-theme-binding',
  ]) {
    let realizationCalls = 0;
    const generator = new DungeonGenerator({
      random: () => 0.5,
      basePlanHash: `base:non-retryable-theme:${failureCode}`,
      augmentationSeed: `augmentation:non-retryable-theme:${failureCode}`,
      augmentationProfileId: 'industrial-supplement-preview-v4',
    });
    generator._generateAcceptedIndustrialDungeon = () => ({
      dungeon: {
        basePlanHash: generator.basePlanHash,
        generationAttempts: 1,
        progression: { validation: { accepted: true, errors: [] } },
      },
      randomTape: [],
    });
    generator._generateOnce = () => {
      realizationCalls += 1;
      const error = new Error(`Missing deterministic theme content: ${failureCode}`);
      error.code = failureCode;
      throw error;
    };

    const dungeon = generator._generateIndustrialDungeonWithAugmentationReplay();
    assert.equal(realizationCalls, 1, failureCode);
    assert.equal(dungeon.augmentationStatus, 'unchanged');
    assert.equal(
      dungeon.augmentationDiagnostics.reason,
      'theme-capability-or-binding-unavailable',
    );
    assert.equal(dungeon.augmentationDiagnostics.nonRetryable, true);
    assert.equal(dungeon.augmentationReplayDiagnostics.realizationAttempts, 1);
    assert.equal(
      dungeon.augmentationDiagnostics.rejectedOverlay.attempts[0].failureCode,
      failureCode,
    );
    assert.equal(
      dungeon.augmentationDiagnostics.rejectedOverlay.attempts[0].failureCategory,
      'theme-capability-or-binding',
    );
  }

  let geometryRealizationCalls = 0;
  const retryableGenerator = new DungeonGenerator({
    random: () => 0.5,
    basePlanHash: 'base:retryable-geometry-failure',
    augmentationSeed: 'augmentation:retryable-geometry-failure',
    augmentationProfileId: 'industrial-supplement-preview-v4',
  });
  retryableGenerator._generateAcceptedIndustrialDungeon = () => ({
    dungeon: {
      basePlanHash: retryableGenerator.basePlanHash,
      generationAttempts: 1,
      progression: { validation: { accepted: true, errors: [] } },
    },
    randomTape: [],
  });
  retryableGenerator._generateOnce = () => {
    geometryRealizationCalls += 1;
    const error = new Error('Seed-dependent supplemental geometry collision.');
    error.code = 'INVALID_SUPPLEMENT_STRUCTURE_RAMP';
    throw error;
  };
  const retryableFallback = retryableGenerator
    ._generateIndustrialDungeonWithAugmentationReplay();
  assert.equal(geometryRealizationCalls, 8);
  assert.equal(retryableFallback.augmentationDiagnostics.nonRetryable, false);
  assert.equal(
    retryableFallback.augmentationDiagnostics.reason,
    'physical-validation-fallback',
  );
});

test('invalid augmentation preview acceptance requires both explicit opt-in and the V4 profile', () => {
  const runInvalidReplay = ({
    profileId = 'industrial-supplement-preview-v4',
    allowInvalidAugmentationPreview = false,
  } = {}) => {
    let realizationCalls = 0;
    const collisionDerivedDiagnostics = {
      schema: 'ruindivex-dungeon-augmentation-diagnostics/v1',
      accepted: false,
      errors: [{
        code: 'supplemental-floor-non-returnable',
        message: 'Synthetic collision-derived release failure.',
      }],
      traversal: {
        graphKind: 'collision-derived',
        blockedFloorIds: ['supplement:test:floor:blocked'],
      },
    };
    const generator = new DungeonGenerator({
      random: () => 0.5,
      basePlanHash: `base:explicit-alpha-gate:${profileId}`,
      augmentationSeed: `augmentation:explicit-alpha-gate:${profileId}`,
      augmentationProfileId: profileId,
      allowInvalidAugmentationPreview,
    });
    generator._generateAcceptedIndustrialDungeon = () => ({
      dungeon: {
        basePlanHash: generator.basePlanHash,
        generationAttempts: 1,
        progression: { validation: { accepted: true, errors: [] } },
      },
      randomTape: [],
    });
    generator._generateOnce = () => {
      realizationCalls += 1;
      return {
        augmentationStatus: 'applied',
        augmentationDiagnostics: structuredClone(collisionDerivedDiagnostics),
        progression: {
          validation: {
            accepted: false,
            errors: ['Synthetic collision-derived release failure.'],
          },
        },
      };
    };
    generator._finalizeAcceptedIndustrialDungeon = (dungeon) => dungeon;
    generator._disposeGeneratedDungeonCandidate = () => {};
    return {
      dungeon: generator._generateIndustrialDungeonWithAugmentationReplay(),
      realizationCalls,
      collisionDerivedDiagnostics,
    };
  };

  const ordinaryV4 = runInvalidReplay();
  assert.equal(ordinaryV4.realizationCalls, 8);
  assert.equal(ordinaryV4.dungeon.augmentationStatus, 'unchanged');
  assert.equal(ordinaryV4.dungeon.augmentationReplayDiagnostics.fallbackToAcceptedBase, true);

  const explicitV4Alpha = runInvalidReplay({ allowInvalidAugmentationPreview: true });
  assert.equal(explicitV4Alpha.realizationCalls, 1);
  assert.equal(explicitV4Alpha.dungeon.augmentationStatus, 'applied');
  assert.equal(explicitV4Alpha.dungeon.augmentationPlayableAlpha.accepted, true);
  assert.equal(explicitV4Alpha.dungeon.augmentationReplayDiagnostics.acceptedAsPlayableAlpha, true);
  assert.equal(explicitV4Alpha.dungeon.augmentationReplayDiagnostics.releaseValidationAccepted, false);
  const { warnings: _alphaWarnings, ...alphaValidationDiagnostics } =
    explicitV4Alpha.dungeon.augmentationDiagnostics;
  const ordinaryValidationDiagnostics = ordinaryV4.dungeon
    .augmentationDiagnostics.rejectedOverlay.attempts[0].diagnostics;
  assert.equal(
    JSON.stringify(alphaValidationDiagnostics),
    JSON.stringify(ordinaryValidationDiagnostics),
    'Alpha acceptance may append a warning but must not rewrite release diagnostics.',
  );
  assert.deepEqual(
    alphaValidationDiagnostics,
    explicitV4Alpha.collisionDerivedDiagnostics,
  );

  const legacyProfile = runInvalidReplay({
    profileId: 'industrial-supplement-preview-v3',
    allowInvalidAugmentationPreview: true,
  });
  assert.equal(legacyProfile.realizationCalls, 8);
  assert.equal(legacyProfile.dungeon.augmentationStatus, 'unchanged');
  assert.equal(legacyProfile.dungeon.augmentationPlayableAlpha, undefined);
});

test(`${VERIFICATION_SEED_COUNT} augmentation seeds are deterministic, immutable, namespaced, and within profile budgets`, () => {
  const planHashes = new Set();
  const structuralSignatures = new Set();
  for (let index = 0; index < VERIFICATION_SEED_COUNT; index += 1) {
    const fixture = makeFixture();
    const before = canonicalStringify(fixture.baseDraft);
    const options = {
      ...fixture,
      profileId: 'industrial-supplement-preview-v1',
      layoutSeed: `augmentation:${index}`,
      difficulty: 2,
    };
    const first = augmentDungeonDraft(options);
    const second = augmentDungeonDraft(options);
    assert.equal(first.status, 'applied', JSON.stringify({
      index,
      layoutSeed: options.layoutSeed,
      errors: first.diagnostics.errors,
    }));
    assert.deepEqual(first.overlayPlan, second.overlayPlan);
    assert.equal(first.overlayPlan.schema, DUNGEON_AUGMENTATION_OVERLAY_SCHEMA);
    assert.equal(first.overlayPlan.augmentationPlanHash, computeDungeonAugmentationPlanHash(first.overlayPlan));
    assert.notEqual(first.effectiveDraft, fixture.baseDraft);
    assert.equal(canonicalStringify(fixture.baseDraft), before);
    assert.deepEqual(first.effectiveDraft.rooms, fixture.baseDraft.rooms);
    assert.deepEqual(first.effectiveDraft.connectionPlans, fixture.baseDraft.connectionPlans);
    assert.equal(first.effectiveDraft.dungeonAugmentation.overlayPlan, first.overlayPlan);
    assert.ok(first.overlayPlan.nodes.length >= 2 && first.overlayPlan.nodes.length <= 4);
    assert.equal(first.overlayPlan.operations.some(({ type }) => type === 'optionalBranch'), true);
    assert.equal(first.overlayPlan.operations.some(({ type }) => type === 'edgePadding'), true);
    assert.equal(first.overlayPlan.nodes.every(({ id }) => id.startsWith('supplement:fixture-region:')), true);
    assert.equal(first.overlayPlan.nodes.every((node) => node.sockets.every(({ state }) => (
      state === 'connected' || state === 'capped'
    ))), true);
    assert.equal(first.overlayPlan.operations
      .filter(({ type }) => type === 'edgePadding')
      .every(({ originalEdgePreserved, gateDominancePreserved }) => (
        originalEdgePreserved && gateDominancePreserved
      )), true);
    assertRendererFree(first.overlayPlan);
    assertDeepFrozen(first.overlayPlan);
    assertDeepFrozen(first.effectiveDraft);
    planHashes.add(first.overlayPlan.augmentationPlanHash);
    structuralSignatures.add(canonicalStringify({
      grammars: first.overlayPlan.nodes.map(({ grammarId }) => grammarId),
      operationRoomCounts: first.overlayPlan.operations
        .filter(({ type }) => type !== 'delegatedProgression')
        .map(({ type, nodeIds }) => [type, nodeIds.length]),
    }));
  }
  assert.ok(planHashes.size >= 80, `expected seed diversity, received ${planHashes.size} hashes`);
  assert.ok(structuralSignatures.size >= 10, `expected structural variation, received ${structuralSignatures.size} layouts`);
});

test(`${VERIFICATION_SEED_COUNT} preview-v2 seeds guarantee a perceptible two-room branch plus padding`, () => {
  const profileId = 'industrial-supplement-preview-v2';
  const planHashes = new Set();
  for (let index = 0; index < VERIFICATION_SEED_COUNT; index += 1) {
    const fixture = makeFixture({ profileId });
    const result = augmentDungeonDraft({
      ...fixture,
      profileId,
      layoutSeed: `augmentation-v2:${index}`,
      difficulty: 2,
    });
    assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
    assert.ok(result.overlayPlan.nodes.length >= 3 && result.overlayPlan.nodes.length <= 4);
    const structuralOperations = result.overlayPlan.operations.filter(({ type }) => (
      type === 'optionalBranch' || type === 'edgePadding'
    ));
    assert.deepEqual(structuralOperations.map(({ type }) => type).sort(), [
      'edgePadding',
      'optionalBranch',
    ]);
    assert.equal(
      structuralOperations.find(({ type }) => type === 'optionalBranch').nodeIds.length,
      2,
    );
    assert.ok([
      1,
      2,
    ].includes(structuralOperations.find(({ type }) => type === 'edgePadding').nodeIds.length));
    planHashes.add(result.overlayPlan.augmentationPlanHash);
  }
  assert.ok(planHashes.size >= 80, `expected v2 seed diversity, received ${planHashes.size} hashes`);
});

test(`${VERIFICATION_SEED_COUNT} preview-v3 seeds build a multi-door hallway cluster with varied vertical traversal`, () => {
  const profileId = 'industrial-supplement-preview-v3';
  const observedVerticalFamilies = new Set();
  const observedVerticalDirections = new Set();
  const planHashes = new Set();
  for (let index = 0; index < VERIFICATION_SEED_COUNT; index += 1) {
    const fixture = makeFixture({ profileId });
    const options = {
      ...fixture,
      profileId,
      layoutSeed: `augmentation-v3:${index}`,
      difficulty: 2,
    };
    const result = augmentDungeonDraft(options);
    const repeated = augmentDungeonDraft(options);
    assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
    assert.deepEqual(result.overlayPlan, repeated.overlayPlan);
    assert.equal(result.overlayPlan.nodes.length, 5);
    const branch = result.overlayPlan.operations.find(({ type }) => type === 'optionalBranch');
    const padding = result.overlayPlan.operations.find(({ type }) => type === 'edgePadding');
    assert.ok(branch);
    assert.ok(padding);
    assert.equal(branch.topology, 'hallway-cluster-v1');
    assert.equal(branch.nodeIds.length, 4);
    assert.equal(branch.segmentIds.length, 4);
    assert.equal(padding.nodeIds.length, 1);
    assert.deepEqual(branch.featureSummary, {
      sideRoomCount: 2,
      elevationTransferCount: 1,
      encounterCount: 1,
      rewardCount: 1,
      trapCount: 1,
      platformRoomCount: 2,
      doorwayCount: 4,
      hallwaySpineCount: 1,
    });

    const nodeById = new Map(result.overlayPlan.nodes.map((node) => [node.id, node]));
    const hallway = nodeById.get(branch.hallwayNodeId);
    const terminal = nodeById.get(branch.terminalNodeId);
    assert.ok(hallway);
    assert.ok(terminal);
    assert.deepEqual(
      { x: hallway.size.x, z: hallway.size.z },
      { x: 14, z: 36.4 },
    );
    assert.equal(branch.corridorOriented, true);
    assert.equal(branch.hallwayLengthMeters, 36.4);
    assert.equal(branch.hallwayDoorwayCount, 4);
    assert.equal(branch.sideRoomDoorwayCount, 2);
    assert.deepEqual(branch.hallwayDoorwaySocketIds, hallway.hallwayDoorwaySocketIds);
    assert.deepEqual(branch.sideRoomDoorwaySocketIds, hallway.sideRoomDoorwaySocketIds);
    assert.equal(hallway.layoutRole, 'corridor-hallway-spine');
    assert.equal(hallway.corridorOriented, true);
    const hallwaySocketByLocalId = new Map(
      hallway.sockets.map((candidate) => [candidate.localSocketId, candidate]),
    );
    const hallwayForward = hallway.placement.facing;
    const longitudinalOffset = (candidate) => (
      (candidate.position.x - hallway.placement.center.x) * hallwayForward.x
        + (candidate.position.z - hallway.placement.center.z) * hallwayForward.z
    );
    assert.ok(Math.abs(longitudinalOffset(hallwaySocketByLocalId.get('left')) + 8.4) < 1e-9);
    assert.ok(Math.abs(longitudinalOffset(hallwaySocketByLocalId.get('right')) - 8.4) < 1e-9);
    assert.deepEqual(
      branch.sideRoomNodeIds.map((id) => ({ x: nodeById.get(id).size.x, z: nodeById.get(id).size.z })),
      [{ x: 19.6, z: 19.6 }, { x: 19.6, z: 19.6 }],
    );
    assert.deepEqual(
      { x: terminal.size.x, z: terminal.size.z },
      { x: 25.2, z: 25.2 },
    );
    assert.equal(hallway.sockets.every(({ state }) => state === 'connected'), true);
    for (const sideRoomId of branch.sideRoomNodeIds) {
      const states = Object.fromEntries(nodeById.get(sideRoomId).sockets
        .map(({ localSocketId, state }) => [localSocketId, state]));
      assert.deepEqual(states, { entry: 'connected', exit: 'capped' });
    }
    assert.deepEqual(
      Object.fromEntries(terminal.sockets.map(({ localSocketId, state }) => [localSocketId, state])),
      { entry: 'connected', exit: 'capped' },
    );
    assert.equal(
      nodeById.get(branch.sideRoomNodeIds[0]).anchors.some(({ kind }) => kind === 'encounter'),
      true,
    );
    assert.equal(
      nodeById.get(branch.sideRoomNodeIds[1]).anchors.some(({ kind }) => kind === 'reward'),
      true,
    );
    assert.equal(terminal.anchors.some(({ kind }) => kind === 'trap'), true);
    assert.ok(terminal.structure.platforms.length > 0);
    assert.ok(terminal.structure.ramps.length > 0);
    assert.equal(
      hallway.anchors.filter(({ assetRole }) => assetRole === 'frame').length,
      4,
    );

    const verticalSegment = result.overlayPlan.segments.find(({ id }) => (
      id === branch.verticalConnectorSegmentId
    ));
    assert.ok(verticalSegment);
    assert.ok(['slope', 'ladder', 'lift'].includes(verticalSegment.connectorFamily));
    assert.equal(verticalSegment.connectorFamily, branch.verticalConnectorFamily);
    assert.equal(verticalSegment.verticalTransfer, true);
    assert.equal(Math.abs(verticalSegment.elevationDelta), 14);
    assert.equal(
      verticalSegment.destinationElevation - verticalSegment.sourceElevation,
      verticalSegment.elevationDelta,
    );
    assert.ok(verticalSegment.path[1].z !== verticalSegment.path[0].z
      || verticalSegment.path[1].x !== verticalSegment.path[0].x);
    const verticalConnectorLength = Math.hypot(
      verticalSegment.path[1].x - verticalSegment.path[0].x,
      verticalSegment.path[1].z - verticalSegment.path[0].z,
    );
    assert.ok(
      verticalConnectorLength >= (verticalSegment.connectorFamily === 'slope' ? 50.4 : 44.8),
    );
    observedVerticalFamilies.add(verticalSegment.connectorFamily);
    observedVerticalDirections.add(verticalSegment.direction);
    assert.equal(
      result.overlayPlan.nodes.find(({ id }) => id === padding.nodeIds[0]).grammarId,
      'supplement-padding-through-chamber-v1',
      `seed ${index} must use the dedicated padding grammar`,
    );
    assertRendererFree(result.overlayPlan);
    assertDeepFrozen(result.overlayPlan);
    planHashes.add(result.overlayPlan.augmentationPlanHash);
  }
  assert.deepEqual([...observedVerticalFamilies].sort(), ['ladder', 'lift', 'slope']);
  assert.deepEqual([...observedVerticalDirections].sort(), ['ascending', 'descending']);
  assert.ok(planHashes.size >= 80, `expected v3 seed diversity, received ${planHashes.size} hashes`);
});

test(`${VERIFICATION_SEED_COUNT} preview-v3 seeds keep a corridor hallway when edge padding has no safe insertion`, () => {
  const profileId = 'industrial-supplement-preview-v3';
  const hashes = new Set();
  for (let index = 0; index < VERIFICATION_SEED_COUNT; index += 1) {
    const fixture = makeFixture({ profileId });
    fixture.baseDraft.protectedVolumes.push({
      id: 'fixture-splice-corridor-reserved',
      center: { x: 0, y: 2.8, z: 0 },
      size: { x: 140, y: 5.6, z: 30 },
      purpose: 'force-v3-padding-fallback',
    });
    const options = {
      ...fixture,
      profileId,
      layoutSeed: `augmentation-v3-padding-fallback:${index}`,
      difficulty: 2,
    };
    const result = augmentDungeonDraft(options);
    const repeated = augmentDungeonDraft(options);
    assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
    assert.deepEqual(result.overlayPlan, repeated.overlayPlan);
    assert.deepEqual(result.overlayPlan.operations.map(({ type }) => type), ['optionalBranch']);
    assert.equal(result.overlayPlan.nodes.length, 4);
    assert.equal(result.overlayPlan.segments.length, 4);
    assert.equal(result.diagnostics.decisions.some(({ context }) => (
      context?.optionalEdgePaddingOmitted === true
    )), true);
    const branch = result.overlayPlan.operations[0];
    const hallway = result.overlayPlan.nodes.find(({ id }) => id === branch.hallwayNodeId);
    assert.equal(branch.corridorOriented, true);
    assert.equal(branch.hallwayLengthMeters, 36.4);
    assert.equal(branch.hallwayDoorwayCount, 4);
    assert.equal(branch.sideRoomDoorwayCount, 2);
    assert.equal(hallway.size.z > hallway.size.x * 2, true);
    assert.equal(hallway.sockets.every(({ state }) => state === 'connected'), true);
    assert.deepEqual(
      branch.sideRoomNodeIds.map((nodeId) => (
        result.overlayPlan.nodes.find(({ id }) => id === nodeId).contentRole
      )),
      ['encounter', 'reward'],
    );
    hashes.add(result.overlayPlan.augmentationPlanHash);
  }
  assert.ok(hashes.size >= 80, `expected fallback seed diversity, received ${hashes.size} hashes`);
});

test('edge-padding connector paths follow an L-shaped parent splice instead of cutting a chord', () => {
  const profileId = 'industrial-supplement-preview-v3';
  const fixture = makeFixture({ profileId });
  const splice = fixture.extensionRegions[0].spliceEdges[0];
  splice.path = [
    { x: -60, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 60 },
    { x: 60, y: 0, z: 60 },
  ];
  splice.availableLengthMeters = 180;
  splice.to.position = { x: 60, y: 0, z: 60 };
  const result = augmentDungeonDraft({
    ...fixture,
    profileId,
    layoutSeed: 'l-shaped-padding-splice-regression',
    difficulty: 2,
  });

  assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
  const padding = result.overlayPlan.operations.find(({ type }) => type === 'edgePadding');
  assert.ok(padding, 'the L-shaped fixture should retain its preferred padding room');
  const paddingSegments = result.overlayPlan.segments.filter(({ operationId }) => (
    operationId === padding.id
  ));
  assert.equal(paddingSegments.length, 2);
  assert.equal(paddingSegments.some(({ path }) => path.length > 2), true);
  const pointIsOnSplice = ({ x, z }) => (
    (Math.abs(z) <= 1e-6 && x >= -60 && x <= 0)
      || (Math.abs(x) <= 1e-6 && z >= 0 && z <= 60)
      || (Math.abs(z - 60) <= 1e-6 && x >= 0 && x <= 60)
  );
  assert.equal(
    paddingSegments.every(({ path }) => path.every(pointIsOnSplice)),
    true,
  );
  assert.equal(
    paddingSegments.some(({ path }) => path.some(({ x, z }) => x === 0 && z === 0)),
    true,
  );
});

test('the Industrial adapter forwards authoritative base volumes into route planning', () => {
  const baseVolume = {
    id: 'industrial-wrapper-authoritative-volume',
    ownerId: 'industrial-wrapper-room',
    center: { x: 14, y: 2.8, z: -14 },
    size: { x: 8.4, y: 5.6, z: 8.4 },
  };
  const baseDraft = {
    basePlanHash: 'industrial-wrapper-authoritative-base',
    occupiedVolumes: [baseVolume],
    rooms: [],
    connectionPlans: [],
  };
  const host = createIndustrialAugmentationHost({ baseDraft });

  assert.deepEqual(
    host.extensionRegions[0].routeNetworkPlacementProtectedVolumes,
    [{ ...baseVolume, purpose: 'base-draft-protected' }],
  );
});

test('the Industrial adapter protects resolved room floors below base elevation', () => {
  const trapRoom = {
    id: 'trapRoom',
    type: 'trap',
    x: 18,
    z: 58,
    width: 17,
    depth: 15,
    baseElevation: 28,
    minY: 23.2,
    maxY: 43.2,
    ceilingHeight: 15.2,
    dropSpace: {
      lowerElevation: -4.8,
      lowerBounds: { minX: 12, maxX: 20, minZ: 55, maxZ: 63 },
    },
  };
  const baseDraft = createIndustrialBaseDraft({
    rooms: [trapRoom],
    connectionPlans: [],
    tileSize: 2.8,
  });
  const roomVolume = baseDraft.occupiedVolumes[0];

  assert.equal(roomVolume.id, 'base:room:trapRoom:occupied');
  assert.ok(Math.abs(roomVolume.center.y - 35.6) <= 1e-9);
  assert.ok(Math.abs(roomVolume.size.y - 15.2) <= 1e-9);

  const dropSpaceVolume = baseDraft.occupiedVolumes.find(({ id }) => (
    id === 'base:room:trapRoom:drop-space-occupied'
  ));
  assert.ok(dropSpaceVolume);
  assert.equal(dungeonVolumesOverlap(dropSpaceVolume, {
    center: { x: 12 * 2.8, y: 21, z: 63 * 2.8 },
    size: { x: 2.8, y: 14, z: 2.8 },
  }), true, 'a supplemental y14..28 shell must collide with the authored basement volume');
  assert.equal(dungeonVolumesOverlap(dropSpaceVolume, {
    center: { x: 12 * 2.8, y: 18.5, z: 63 * 2.8 },
    size: { x: 2.8, y: 9, z: 2.8 },
  }), false, 'a supplemental shell ending below y23.2 remains safely stackable');

  const host = createIndustrialAugmentationHost({
    baseDraft,
    rooms: [trapRoom],
    connectionPlans: [],
    tileSize: 2.8,
  });
  const protectedDropSpaceVolume = host.extensionRegions[0]
    .routeNetworkPlacementProtectedVolumes
    .find(({ id }) => id === dropSpaceVolume.id);
  assert.ok(protectedDropSpaceVolume);
});

test('the pure planner accepts the Industrial adapter world-meter snapshot without replacing its base graph', () => {
  const rooms = [
    { id: 'enemyNest', type: 'combat', x: -30, z: 0, width: 7, depth: 7, baseElevation: 0 },
    { id: 'keycardRoom', type: 'key', x: 30, z: 0, width: 7, depth: 7, baseElevation: 0 },
  ];
  const connectionPlans = [{
    id: 'industrial-fixture-physical-edge',
    logicalConnectionId: 'enemyNest_keycardRoom',
    fromRoomId: 'enemyNest',
    toRoomId: 'keycardRoom',
    doorId: 'enemyNestGate',
    level: 0,
    elevation: 0,
    fullPath: Array.from({ length: 53 }, (_, index) => ({ x: index - 26, z: 0 })),
    fromSocket: { id: 'enemyNest:east', roomId: 'enemyNest', x: -27, z: 0, elevation: 0, facingX: 1, facingZ: 0 },
    toSocket: { id: 'keycardRoom:west', roomId: 'keycardRoom', x: 27, z: 0, elevation: 0, facingX: -1, facingZ: 0 },
  }];
  const baseDraft = createIndustrialBaseDraft({ rooms, connectionPlans, tileSize: 2.8 });
  const host = createIndustrialAugmentationHost({ baseDraft, rooms, connectionPlans, tileSize: 2.8 });
  assert.equal(host.basePlanHash, baseDraft.basePlanHash);
  const before = canonicalStringify(baseDraft);
  const result = augmentDungeonDraft({
    baseDraft,
    extensionRegions: host.extensionRegions,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'industrial-adapter-compatibility',
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
  assert.equal(result.overlayPlan.basePlanHash, baseDraft.basePlanHash);
  assert.equal(canonicalStringify(baseDraft), before);
  assert.deepEqual(result.effectiveDraft.connectionPlans, baseDraft.connectionPlans);
  assert.equal(result.overlayPlan.operations.some(({ type }) => type === 'edgePadding'), true);
  const paddedOperation = result.overlayPlan.operations.find(({ type }) => type === 'edgePadding');
  assert.equal(paddedOperation.originalLogicalEdge.gateId, 'enemyNestGate');
  assert.equal(paddedOperation.originalLogicalEdge.gatePlacementSide, 'source');
  const materialized = materializeIndustrialOverlay({
    rooms,
    connectionPlans,
    overlayPlan: result.overlayPlan,
    extensionRegions: host.extensionRegions,
    tileSize: 2.8,
  });
  assert.equal(materialized.diagnostics.accepted, true, JSON.stringify(materialized.diagnostics.errors));
  assert.equal(materialized.rooms.length, rooms.length + result.overlayPlan.nodes.length);
  const physicalGateHost = materialized.connectionPlans.find((plan) => (
    plan.isPaddedByDungeonSupplement && plan.hostsLogicalGate
  ));
  assert.ok(physicalGateHost);
  assert.equal(physicalGateHost.fromRoomId, 'enemyNest');
  assert.equal(physicalGateHost.gatePlacementSide, 'source');
  assert.deepEqual(connectionPlans[0].fullPath, Array.from({ length: 53 }, (_, index) => ({ x: index - 26, z: 0 })));
});

test('the Industrial host advertises only boundary-socket-to-boundary-socket padding length', () => {
  const rooms = [
    { id: 'entrance', type: 'entrance', x: 0, z: 0, width: 5, depth: 5, baseElevation: 0 },
    { id: 'enemyNest', type: 'combat', x: 0, z: 8, width: 5, depth: 5, baseElevation: 0 },
  ];
  const connectionPlans = [{
    id: 'entrance_enemyNest_ground',
    logicalConnectionId: 'entrance_enemyNest',
    fromRoomId: 'entrance',
    toRoomId: 'enemyNest',
    level: 0,
    elevation: 0,
    fullPath: Array.from({ length: 9 }, (_, z) => ({ x: 0, z })),
    fromSocket: {
      id: 'entrance:south',
      roomId: 'entrance',
      x: 0,
      z: 2,
      elevation: 0,
      facingX: 0,
      facingZ: 1,
    },
    toSocket: {
      id: 'enemyNest:north',
      roomId: 'enemyNest',
      x: 0,
      z: 6,
      elevation: 0,
      facingX: 0,
      facingZ: -1,
    },
  }];
  const baseDraft = createIndustrialBaseDraft({ rooms, connectionPlans, tileSize: 2.8 });
  const host = createIndustrialAugmentationHost({
    baseDraft,
    rooms,
    connectionPlans,
    tileSize: 2.8,
  });
  const splice = host.extensionRegions[0].spliceEdges[0];

  assert.ok(splice);
  assert.equal(splice.pathContract, 'boundary-socket-to-boundary-socket');
  assert.deepEqual(splice.fullPath, Array.from({ length: 5 }, (_, index) => ({
    x: 0,
    z: index + 2,
  })));
  assert.deepEqual(splice.path[0], { x: 0, y: 0, z: 5.6 });
  assert.equal(splice.path.at(-1).x, 0);
  assert.equal(splice.path.at(-1).y, 0);
  assert.ok(Math.abs(splice.path.at(-1).z - 16.8) <= 1e-9);
  assert.ok(Math.abs(splice.availableLengthMeters - 11.2) <= 1e-9);
  assert.equal(splice.availableLengthMeters, splice.measuredPathLengthMeters);
});

test('the Industrial V2 host grants the exact unused keycard walls and tile-aligned long-route stations', () => {
  const tileSize = 2.8;
  const rooms = [
    { id: 'enemyNest', x: -30, z: 0, width: 7, depth: 7, baseElevation: 0 },
    { id: 'keycardRoom', x: 0, z: 0, width: 23, depth: 21, baseElevation: 0 },
    { id: 'trapRoom', x: 0, z: 50, width: 7, depth: 7, baseElevation: 0 },
  ];
  const connectionPlans = [
    {
      id: 'enemyNest_keycardRoom_ground',
      logicalConnectionId: 'enemyNest_keycardRoom',
      fromRoomId: 'enemyNest',
      toRoomId: 'keycardRoom',
      doorId: 'enemyNestGate',
      level: 0,
      elevation: 0,
      fullPath: Array.from({ length: 17 }, (_, index) => ({ x: index - 27, z: 0 })),
      fromSocket: { id: 'enemy:east', roomId: 'enemyNest', x: -27, z: 0, elevation: 0, facingX: 1, facingZ: 0 },
      toSocket: { id: 'keycard:west', roomId: 'keycardRoom', x: -11, z: 0, elevation: 0, facingX: -1, facingZ: 0 },
    },
    {
      id: 'keycardRoom_trapRoom_ground',
      logicalConnectionId: 'keycardRoom_trapRoom',
      fromRoomId: 'keycardRoom',
      toRoomId: 'trapRoom',
      doorId: 'Door_Alpha',
      level: 0,
      elevation: 0,
      fullPath: Array.from({ length: 38 }, (_, index) => ({ x: 0, z: index + 10 })),
      fromSocket: { id: 'keycard:south', roomId: 'keycardRoom', x: 0, z: 10, elevation: 0, facingX: 0, facingZ: 1 },
      toSocket: { id: 'trap:north', roomId: 'trapRoom', x: 0, z: 47, elevation: 0, facingX: 0, facingZ: -1 },
    },
  ];
  const baseDraft = createIndustrialBaseDraft({ rooms, connectionPlans, tileSize });
  const host = createIndustrialAugmentationHost({ baseDraft, rooms, connectionPlans, tileSize });
  const validation = validateDungeonExtensionHost(host);
  const region = host.extensionRegions[0];
  const pyramid = region.routeNetworkGrants.find(({ kind }) => (
    kind === 'landmark-perimeter-loop'
  ));
  const coverage = region.routeNetworkGrants.filter(({ kind }) => (
    kind === 'objective-route-coverage'
  ));

  assert.equal(validation.accepted, true, validation.errors.join(', '));
  assert.equal(host.schema, DUNGEON_EXTENSION_HOST_V2_SCHEMA);
  assert.equal(region.progressionSnapshot.schema, DUNGEON_PROGRESSION_SNAPSHOT_V2_SCHEMA);
  assert.ok(pyramid);
  assert.equal(pyramid.schema, DUNGEON_ROUTE_NETWORK_GRANT_V2_SCHEMA);
  assert.deepEqual(pyramid.occupiedCriticalWallSides, ['south', 'west']);
  assert.deepEqual(pyramid.openedWallSides, ['east', 'north']);
  assert.deepEqual(
    pyramid.endpointSockets.map(({ wallSide }) => wallSide).sort(),
    ['east', 'north'],
  );
  assert.equal(pyramid.endpointSockets.every(({ roomId, widthMeters }) => (
    roomId === 'keycardRoom' && Math.abs(widthMeters - 8.4) <= 1e-9
  )), true);
  assert.equal(coverage.length, 2);
  assert.equal(coverage.every(({ coverage: contract }) => (
    contract.coverageComplete
      && Math.max(...contract.featurelessSpansMeters) <= 33.6 + 1e-6
      && contract.stationDistancesMeters.every((distance) => (
        Math.abs(distance / tileSize - Math.round(distance / tileSize)) <= 1e-9
      ))
  )), true);
  assert.equal(coverage.every((grant) => (
    grant.minimumModules === 3
      && grant.maximumModules === 6
      && !('minimumTrueRoomCount' in grant)
      && grant.planningReservationRectangles.every((rectangle) => {
        const spans = [
          rectangle.maxX - rectangle.minX,
          rectangle.maxZ - rectangle.minZ,
        ].sort((first, second) => first - second);
        return Math.abs(spans[0] - tileSize) <= 1e-6
          && Math.abs(spans[1] - tileSize * 3) <= 1e-6;
      })
      && grant.endpointSockets.every(({ endpointModuleOverlapRequired }) => (
        endpointModuleOverlapRequired === true
      ))
      && grant.socketModuleOverlapGrants.length === grant.endpointSockets.length * 2
  )), true);
  const alphaCoverage = coverage.find(({ coverage: contract }) => (
    contract.logicalEdgeId === 'keycardRoom_trapRoom'
  ));
  assert.deepEqual(alphaCoverage.requiredCredentialIds, ['Keycard_Alpha']);
  assert.equal(alphaCoverage.sourceGate.gatePlacementSide, 'source');
  assert.equal(alphaCoverage.endpointSockets.every(({ roomId }) => roomId === 'trapRoom'), true);
});

test(`${VERIFICATION_SEED_COUNT} pure V4 seeds realize a deterministic, active pyramid route network`, () => {
  const tileSize = 2.8;
  const accessDomainId = 'fixture-region:band-0';
  const endpointSockets = [
    {
      id: 'fixture:keycard:north',
      nodeId: 'keycardRoom',
      roomId: 'keycardRoom',
      position: { x: 0, y: 0, z: -30 },
      facing: { x: 0, y: 0, z: -1 },
      wallSide: 'north',
    },
    {
      id: 'fixture:keycard:east',
      nodeId: 'keycardRoom',
      roomId: 'keycardRoom',
      position: { x: 32, y: 0, z: 0 },
      facing: { x: 1, y: 0, z: 0 },
      wallSide: 'east',
    },
  ].map((socket) => ({
    ...socket,
    widthMeters: 8.4,
    heightMeters: 3.6,
    landingWidthTiles: 3,
    clearanceHeightMeters: 3.6,
    connectorFamilies: ['service-gallery'],
    progressionBandId: 0,
    accessDomainId,
  }));
  const grant = {
    schema: DUNGEON_ROUTE_NETWORK_GRANT_V2_SCHEMA,
    id: 'fixture:keycard-pyramid-loop-grant',
    required: true,
    kind: 'landmark-perimeter-loop',
    landmarkRoomId: 'keycardRoom',
    endpointSockets,
    occupiedCriticalWallSides: ['south', 'west'],
    openedWallSides: ['north', 'east'],
    progressionBandId: 0,
    accessDomainId,
    dominanceRegionId: 'fixture:post-encounter:pre-alpha',
    crossedBoundaryIds: [],
    requiredCredentialIds: [],
    sourceGate: null,
    protectedVolumes: [{
      id: 'fixture:keycard-pyramid-protected',
      center: { x: 0, y: 4, z: 0 },
      size: { x: 20, y: 8, z: 20 },
    }],
    socketLandingOverlapGrants: endpointSockets.map((socket) => {
      const horizontal = Math.abs(socket.facing.x) > 0;
      return {
        id: `${socket.id}:landing-overlap`,
        socketId: socket.id,
        center: { ...socket.position, y: 1.8 },
        size: { x: horizontal ? 14 : 8.4, y: 3.6, z: horizontal ? 8.4 : 14 },
        widthTiles: 3,
        insideDepthTiles: 2,
        outsideDepthTiles: 2,
        maximumBoundaryDepthTiles: 2,
      };
    }),
    mustPreserveBeatIds: ['enemyNestGate', 'keycardGuard', 'Keycard_Alpha', 'Door_Alpha'],
    minimumModules: 3,
    maximumModules: 5,
    requiredCycleRankDelta: 1,
  };
  const extensionRegion = {
    id: 'fixture-region',
    themeBinding: SOURCE_THEME,
    attachmentSockets: [],
    spliceEdges: [],
    allowedProfileIds: ['industrial-supplement-preview-v4'],
    delegatedProgressionBeats: [],
    routeNetworkGrants: [grant],
    progressionSnapshot: {
      schema: DUNGEON_PROGRESSION_SNAPSHOT_V2_SCHEMA,
      startRoomId: 'keycardRoom',
      rooms: [{ id: 'keycardRoom', progressionBandId: 0, accessDomainId }],
      connections: [],
      bands: [{ progressionBandId: 0, accessDomainId, roomIds: ['keycardRoom'] }],
      keycards: [],
      doors: [],
      objectiveRouteIds: [],
      protectedBeatIds: ['enemyNestGate', 'keycardGuard', 'Keycard_Alpha', 'Door_Alpha'],
    },
    themeCapabilities: COMPLETE_CAPABILITIES,
  };
  const baseDraft = {
    basePlanHash: 'fixture-v4-base-plan',
    rooms: [],
    occupiedVolumes: [],
    protectedVolumes: [],
    connectionPlans: [],
  };
  const topologyKinds = new Set();
  const junctionKinds = new Set();
  const elevationModes = new Set();
  const v4Profile = DUNGEON_AUGMENTATION_PROFILES['industrial-supplement-preview-v4'];
  const singleNetworkProfile = {
    ...v4Profile,
    // A single-network fixture exercises the planner's per-dungeon default.
    // Corpus-wide family diversity is enforced by the 100-seed verifier.
    requiredVariety: undefined,
  };
  const metersFromTiles = (tiles) => Number((tiles * tileSize).toFixed(6));
  const expectedJunctionFootprints = new Map([
    ['through-t', [metersFromTiles(5), metersFromTiles(7)]],
    ['crossroads', [metersFromTiles(7), metersFromTiles(7)]],
    ['staggered-cross', [metersFromTiles(5), metersFromTiles(13)]],
    ['stacked-interchange', [metersFromTiles(9), metersFromTiles(13)]],
    ['over-under-crossover', [metersFromTiles(7), metersFromTiles(7)]],
  ]);
  const v4Grammars = v4Profile.grammarPool.map(({ id }) => (
    GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[id]
  ));
  const connectorGrammars = v4Grammars.filter((grammar) => (
    grammar?.selectionConstraints?.routeNetworkModuleKind === 'connector-module'
  ));
  const contentGrammars = v4Grammars.filter((grammar) => (
    grammar?.selectionConstraints?.routeNetworkModuleKind !== 'connector-module'
  ));
  assert.equal(v4Profile.revision, 5);
  assert.equal(v4Grammars.length, v4Profile.grammarPool.length);
  assert.equal(v4Grammars.every((grammar) => Boolean(grammar?.blueprintId)), true);
  assert.equal(connectorGrammars.length, 6);
  assert.equal(contentGrammars.length, v4Grammars.length - connectorGrammars.length);
  assert.equal(contentGrammars.every((grammar) => (
    grammar?.selectionConstraints?.connectorOwned !== true
  )), true);
  for (const grammar of connectorGrammars) {
    const kind = grammar.selectionConstraints.routeNetworkJunctionKind;
    const expected = [...expectedJunctionFootprints.get(kind)]
      .sort((left, right) => left - right);
    const actual = [Number(grammar.size.width), Number(grammar.size.depth)]
      .sort((left, right) => left - right);
    assert.deepEqual(actual, expected, kind);
    assert.equal(grammar.selectionConstraints.connectorOwned, true);
    assert.equal(grammar.selectionConstraints.substantiveRoom, false);
    assert.equal(
      grammar.selectionConstraints.supportsJunctionPromotion,
      kind !== 'over-under-crossover',
    );
  }
  for (let index = 0; index < VERIFICATION_SEED_COUNT; index += 1) {
    const options = {
      baseDraft,
      extensionRegions: [extensionRegion],
      profileId: singleNetworkProfile.id,
      profiles: { [singleNetworkProfile.id]: singleNetworkProfile },
      layoutSeed: `pure-v4:${index}`,
    };
    const first = augmentDungeonDraft(options);
    const repeated = augmentDungeonDraft(options);
    assert.equal(
      first.status,
      'applied',
      `${options.layoutSeed}: ${JSON.stringify(first.diagnostics.errors)}`,
    );
    assert.deepEqual(first.overlayPlan, repeated.overlayPlan);
    assert.equal(first.overlayPlan.schema, DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA);
    assert.equal(first.overlayPlan.operations.length, 1);
    const operation = first.overlayPlan.operations[0];
    const roomNodes = first.overlayPlan.nodes.filter(({ kind }) => (
      kind === 'supplementRoom'
    ));
    const connectorModuleNodes = first.overlayPlan.nodes.filter(({ kind }) => (
      kind === 'supplementConnectorModule'
    ));
    const connectorJunctionNodes = first.overlayPlan.nodes.filter(({ kind }) => (
      kind === 'supplementConnectorJunction'
    ));
    assert.ok(roomNodes.length >= 2);
    assert.ok(connectorJunctionNodes.length >= 1);
    assert.equal(first.overlayPlan.nodes.every(({ kind }) => (
      kind === 'supplementRoom'
        || kind === 'supplementConnectorModule'
        || kind === 'supplementConnectorJunction'
    )), true);
    for (const node of connectorJunctionNodes) {
      const expected = [...expectedJunctionFootprints.get(node.junction.junctionKind)]
        .sort((left, right) => left - right);
      const spans = [Number(node.size?.x ?? 0), Number(node.size?.z ?? 0)]
        .sort((left, right) => left - right);
      assert.deepEqual(spans, expected);
      assert.ok(Number(node.graphDegree ?? 0) >= 3);
      assert.equal(node.junction.countsAsMeaningfulStation, true);
    }
    assert.equal(connectorModuleNodes.every((node) => (
      Number(node.graphDegree ?? 0) < 3
        && node.junction?.countsAsMeaningfulStation !== true
    )), true);
    assert.equal(first.overlayPlan.nodes.every((node) => (
      Number(node.graphDegree ?? 0) >= 1
        && node.sockets.some(({ segmentId }) => Boolean(segmentId))
    )), true);
    assert.deepEqual(
      [...(operation.connectorModuleNodeIds ?? [])].sort(),
      connectorModuleNodes.map(({ id }) => id).sort(),
    );
    assert.deepEqual(
      [...(operation.connectorJunctionNodeIds ?? [])].sort(),
      connectorJunctionNodes.map(({ id }) => id).sort(),
    );
    assert.equal(operation.type, 'routeNetwork');
    assert.equal(operation.routeNetworkKind, 'landmark-perimeter-loop');
    assert.equal(
      operation.selectionManifest.schema,
      'ruindivex-dungeon-route-network-selection-manifest/v1',
    );
    assert.equal(operation.selectionManifest.topology.id, operation.topologyTemplateId);
    assert.equal(operation.selectionManifest.elevation.id, operation.elevationModes[0]);
    assert.equal(
      operation.selectionManifest.normalizedSemanticSignature,
      operation.normalizedSemanticSignature,
    );
    for (const family of DUNGEON_SELECTION_BAG_FAMILIES) {
      const witnessValidation = validateDungeonSelectionBagWitnessSequence(
        operation.selectionManifest.bagWitnesses?.[family],
        { family, requireNonEmpty: true },
      );
      assert.equal(
        witnessValidation.accepted,
        true,
        `${family}: ${JSON.stringify(witnessValidation.errors)}`,
      );
    }
    assert.deepEqual(
      operation.selectionManifest.roomLayouts.map(({ grammarId }) => grammarId).sort(),
      roomNodes.map(({ grammarId }) => grammarId).sort(),
    );
    assert.deepEqual([...operation.endpointSocketIds].sort(), endpointSockets.map(({ id }) => id).sort());
    assert.equal(operation.cycleRankDelta, 1);
    assert.ok(operation.moduleCount >= 3 && operation.moduleCount <= 5);
    assert.equal(operation.substantiveModuleCount, operation.moduleCount);
    assert.equal(
      operation.moduleCount,
      roomNodes.length + connectorJunctionNodes.length,
    );
    assert.equal(operation.physicalNodeCount, first.overlayPlan.nodes.length);
    assert.equal(operation.connectorModuleCount, connectorModuleNodes.length);
    assert.equal(operation.featurelessSpans.every(({ distanceMeters }) => distanceMeters <= 33.6 + 1e-6), true);
    const physicalNodeIds = new Set(first.overlayPlan.nodes.map(({ id }) => id));
    const adjacency = new Map([...physicalNodeIds].map((id) => [id, new Set()]));
    const parentAnchoredNodeIds = new Set();
    for (const segment of first.overlayPlan.segments) {
      assert.ok(Array.isArray(segment.path) && segment.path.length >= 2);
      if (segment.sharedEndpointFootprint?.kind !== 'shared-junction-threshold') {
        assert.deepEqual(segment.endpointSeams.map(({ role }) => role), ['from', 'to']);
        assert.equal(segment.endpointSeams.every(({ orderedCells }) => (
          orderedCells.length === 15
        )), true);
      }
      for (const landing of segment.landingVolumes ?? []) {
        assert.deepEqual(
          [Number(landing.size.x), Number(landing.size.z)]
            .sort((left, right) => left - right),
          [5.6, 8.4],
          'V4 route-network landings use the bounded three-by-two-tile doorway footprint',
        );
      }
      const supplementalEndpointIds = [segment.from, segment.to]
        .map(({ nodeId }) => String(nodeId ?? ''))
        .filter((nodeId) => physicalNodeIds.has(nodeId));
      if (supplementalEndpointIds.length === 2) {
        adjacency.get(supplementalEndpointIds[0]).add(supplementalEndpointIds[1]);
        adjacency.get(supplementalEndpointIds[1]).add(supplementalEndpointIds[0]);
      } else if (supplementalEndpointIds.length === 1
        && [segment.from, segment.to].some(({ kind }) => kind === 'parentSocket')) {
        parentAnchoredNodeIds.add(supplementalEndpointIds[0]);
      }
    }
    assert.equal(parentAnchoredNodeIds.size, 2);
    const physicallyReachableNodeIds = new Set(parentAnchoredNodeIds);
    const pendingReachability = [...parentAnchoredNodeIds];
    while (pendingReachability.length > 0) {
      const nodeId = pendingReachability.pop();
      for (const adjacentNodeId of adjacency.get(nodeId) ?? []) {
        if (physicallyReachableNodeIds.has(adjacentNodeId)) continue;
        physicallyReachableNodeIds.add(adjacentNodeId);
        pendingReachability.push(adjacentNodeId);
      }
    }
    assert.deepEqual(
      [...physicallyReachableNodeIds].sort(),
      [...physicalNodeIds].sort(),
      'every physical route module must connect to an exact parent aperture',
    );
    topologyKinds.add(operation.topologyTemplateId);
    operation.junctionKinds.forEach((kind) => junctionKinds.add(kind));
    operation.elevationModes.forEach((mode) => elevationModes.add(mode));
  }
  assert.deepEqual([...topologyKinds].sort(), [
    'fork-merge-h-loop',
    'multi-door-room-chain',
    'over-under-loop',
    'parallel-gallery-loop',
    'split-level-ring',
    'stacked-interchange',
  ]);
  assert.ok(junctionKinds.size >= 3);
  assert.deepEqual(
    [...elevationModes].sort(),
    ['split-level-platform'],
    'the keycard-pyramid loop remains in band 0 and uses only its internal split level',
  );
});

test('the Industrial host excludes special-surface conveyor routes from generic edge padding', () => {
  const rooms = [
    { id: 'enemyNest', x: -30, z: 0, width: 7, depth: 7, baseElevation: 0 },
    { id: 'keycardRoom', x: 30, z: 0, width: 7, depth: 7, baseElevation: 0 },
    { id: 'trapRoom', x: -30, z: 30, width: 7, depth: 7, baseElevation: 0 },
    { id: 'conveyorRoom', x: 30, z: 30, width: 7, depth: 7, baseElevation: 0 },
  ];
  const connection = ({ id, logicalConnectionId, fromRoomId, toRoomId, z }) => ({
    id,
    logicalConnectionId,
    fromRoomId,
    toRoomId,
    level: 0,
    elevation: 0,
    fullPath: Array.from({ length: 55 }, (_, index) => ({ x: index - 27, z })),
    fromSocket: { id: `${id}:from`, roomId: fromRoomId, x: -27, z, elevation: 0, facingX: 1, facingZ: 0 },
    toSocket: { id: `${id}:to`, roomId: toRoomId, x: 27, z, elevation: 0, facingX: -1, facingZ: 0 },
  });
  const connectionPlans = [
    connection({
      id: 'enemyNest_keycardRoom_ground',
      logicalConnectionId: 'enemyNest_keycardRoom',
      fromRoomId: 'enemyNest',
      toRoomId: 'keycardRoom',
      z: 0,
    }),
    connection({
      id: 'trapRoom_conveyorRoom_ground',
      logicalConnectionId: 'trapRoom_conveyorRoom',
      fromRoomId: 'trapRoom',
      toRoomId: 'conveyorRoom',
      z: 30,
    }),
  ];
  const baseDraft = createIndustrialBaseDraft({ rooms, connectionPlans, tileSize: 2.8 });
  const host = createIndustrialAugmentationHost({ baseDraft, rooms, connectionPlans, tileSize: 2.8 });

  assert.deepEqual(
    host.extensionRegions[0].spliceEdges.map(({ logicalEdgeId }) => logicalEdgeId),
    ['enemyNest_keycardRoom'],
  );
});

test('the Industrial host protects every authored gallery footprint cell', () => {
  const rooms = [
    { id: 'enemyNest', x: -8, z: 0, width: 7, depth: 7, baseElevation: 0 },
    { id: 'keycardRoom', x: 8, z: 0, width: 7, depth: 7, baseElevation: 0 },
  ];
  const connectionPlans = [{
    id: 'enemyNest_keycardRoom_ground',
    logicalConnectionId: 'enemyNest_keycardRoom',
    fromRoomId: 'enemyNest',
    toRoomId: 'keycardRoom',
    level: 0,
    elevation: 0,
    // Keep this footprint-only fixture below the objective-route coverage
    // threshold; coverage allocation is exercised by dedicated host tests.
    fullPath: [{ x: -5, z: 0 }, { x: 5, z: 0 }],
    fromSocket: { id: 'gallery:from', roomId: 'enemyNest', x: -5, z: 0, elevation: 0, facingX: 1, facingZ: 0 },
    toSocket: { id: 'gallery:to', roomId: 'keycardRoom', x: 5, z: 0, elevation: 0, facingX: -1, facingZ: 0 },
    galleryFootprintTiles: [
      { x: 0, z: -2, elevation: 0 },
      { x: 0, z: -1, elevation: 0 },
      { x: 0, z: 0, elevation: 0 },
      { x: 0, z: 1, elevation: 0 },
      { x: 0, z: 2, elevation: 0 },
      { x: 0, z: 2, elevation: 0 },
    ],
  }];
  const baseDraft = createIndustrialBaseDraft({ rooms, connectionPlans, tileSize: 2.8 });
  const host = createIndustrialAugmentationHost({ baseDraft, rooms, connectionPlans, tileSize: 2.8 });
  const galleryVolumes = host.extensionRegions[0].protectedVolumes.filter(({ purpose }) => (
    purpose === 'industrial-authored-gallery-footprint-column'
  ));

  assert.equal(galleryVolumes.length, 5);
  assert.deepEqual(galleryVolumes.map(({ center }) => center.z).sort((a, b) => a - b), [
    -5.6, -2.8, 0, 2.8, 5.6,
  ]);
  assert.equal(galleryVolumes.every((volume) => (
    volume.ownerId === 'enemyNest_keycardRoom'
      && volume.physicalConnectionId === 'enemyNest_keycardRoom_ground'
      && volume.size.x === 2.8
      && volume.size.z === 2.8
      && volume.size.y === 2048
  )), true);
});

test('the Industrial host and base draft preserve exact family-reserved connector heights', () => {
  const rooms = [
    { id: 'enemyNest', x: -8, z: 0, width: 7, depth: 7, baseElevation: 0 },
    { id: 'keycardRoom', x: 8, z: 0, width: 7, depth: 7, baseElevation: 0 },
  ];
  const connectionPlans = [{
    id: 'enemyNest_keycardRoom_ground',
    logicalConnectionId: 'enemyNest_keycardRoom',
    fromRoomId: 'enemyNest',
    toRoomId: 'keycardRoom',
    level: 0,
    elevation: 14,
    // Keep this vertical-interval fixture below the objective-route coverage
    // threshold; only the exact reserved Y extents are under test here.
    fullPath: [{ x: -5, z: 0 }, { x: 5, z: 0 }],
    fromSocket: { id: 'gallery:from', roomId: 'enemyNest', x: -5, z: 0, elevation: 14, facingX: 1, facingZ: 0 },
    toSocket: { id: 'gallery:to', roomId: 'keycardRoom', x: 5, z: 0, elevation: 14, facingX: -1, facingZ: 0 },
    familyReservedFootprintColumns: [
      { x: 0, z: 0, minY: 13.4, maxY: 17.6, purposes: ['gallery-envelope'] },
      { x: 0, z: 0, minY: 27.4, maxY: 31.6, purposes: ['gallery-envelope'] },
      { x: 1, z: 0, minY: 13.4, maxY: 17.6, purposes: ['gallery-envelope'] },
    ],
  }];
  const baseDraft = createIndustrialBaseDraft({ rooms, connectionPlans, tileSize: 2.8 });
  const host = createIndustrialAugmentationHost({ baseDraft, rooms, connectionPlans, tileSize: 2.8 });
  const hostColumns = host.extensionRegions[0].protectedVolumes.filter(({ purpose }) => (
    purpose === 'industrial-authored-gallery-footprint-column'
  ));
  const baseColumns = baseDraft.protectedVolumes.filter(({ purpose }) => (
    purpose === 'industrial-single-owner-xz-connector-column'
  ));

  assert.equal(hostColumns.length, 3);
  assert.equal(baseColumns.length, 3);
  for (const columns of [hostColumns, baseColumns]) {
    const originIntervals = columns
      .filter(({ center }) => center.x === 0 && center.z === 0)
      .sort((first, second) => first.center.y - second.center.y);
    assert.equal(originIntervals.length, 2);
    assert.deepEqual(
      originIntervals.map(({ center }) => Number(center.y.toFixed(6))),
      [15.5, 29.5],
    );
    assert.deepEqual(
      originIntervals.map(({ size }) => Number(size.y.toFixed(6))),
      [4.2, 4.2],
    );
    assert.equal(dungeonVolumesOverlap(originIntervals[0], {
      center: { x: 0, y: 15.5, z: 0 },
      size: { x: 2, y: 2, z: 2 },
    }), true);
    assert.equal(dungeonVolumesOverlap(originIntervals[0], {
      center: { x: 0, y: 23, z: 0 },
      size: { x: 2, y: 2, z: 2 },
    }), false);
  }
});

test('the Industrial adapter rejects supplemental rooms stacked over authored connector columns', () => {
  const rooms = [
    { id: 'enemyNest', type: 'combat', x: -30, z: 0, width: 7, depth: 7, baseElevation: 0 },
    { id: 'keycardRoom', type: 'key', x: 30, z: 0, width: 7, depth: 7, baseElevation: 0 },
  ];
  const connectionPlans = [{
    id: 'industrial-projected-column-edge',
    logicalConnectionId: 'enemyNest_keycardRoom',
    fromRoomId: 'enemyNest',
    toRoomId: 'keycardRoom',
    level: 0,
    elevation: 0,
    fullPath: Array.from({ length: 53 }, (_, index) => ({ x: index - 26, z: 0 })),
    fromSocket: { id: 'enemyNest:east', roomId: 'enemyNest', x: -27, z: 0, elevation: 0, facingX: 1, facingZ: 0 },
    toSocket: { id: 'keycardRoom:west', roomId: 'keycardRoom', x: 27, z: 0, elevation: 0, facingX: -1, facingZ: 0 },
  }];
  const baseDraft = createIndustrialBaseDraft({ rooms, connectionPlans, tileSize: 2.8 });
  const host = createIndustrialAugmentationHost({ baseDraft, rooms, connectionPlans, tileSize: 2.8 });
  const result = augmentDungeonDraft({
    baseDraft,
    extensionRegions: host.extensionRegions,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'industrial-projected-column-fixture',
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));

  const invalidPlan = structuredClone(result.overlayPlan);
  const branchOperation = invalidPlan.operations.find(({ type }) => type === 'optionalBranch');
  const branchNode = invalidPlan.nodes.find(({ operationId }) => (
    operationId === branchOperation.id
  ));
  const projectedColumn = baseDraft.protectedVolumes.find(({ purpose }) => (
    purpose === 'industrial-single-owner-xz-connector-column'
  ));
  assert.ok(projectedColumn);
  for (const volume of [...branchNode.occupiedVolumes, ...branchNode.clearanceVolumes]) {
    volume.center = {
      x: projectedColumn.center.x,
      y: 64 + volume.size.y * 0.5,
      z: projectedColumn.center.z,
    };
  }
  invalidPlan.augmentationPlanHash = computeDungeonAugmentationPlanHash(invalidPlan);
  invalidPlan.effectivePlanHash = computeEffectiveDungeonPlanHash(
    invalidPlan.basePlanHash,
    invalidPlan.augmentationPlanHash,
  );
  const validation = validateDungeonAugmentationPlan(invalidPlan, {
    baseDraft,
    extensionRegions: host.extensionRegions,
    profiles: DUNGEON_AUGMENTATION_PROFILES,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  });

  assert.equal(validation.accepted, false);
  assert.equal(validation.errors.some(({ code, context }) => (
    code === 'supplement-overlaps-base-draft'
      && context.nodeId === branchNode.id
      && context.baseVolumeId.endsWith(':industrial-projected-column')
  )), true);
});

test('cross-theme padding splits at a flat midpoint and propagates each exact parent binding', () => {
  const fixture = makeFixture({ crossTheme: true });
  const result = augmentDungeonDraft({
    ...fixture,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'cross-theme-fixture',
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
  assert.equal(result.overlayPlan.transitionBays.length, 1);
  const transition = result.overlayPlan.transitionBays[0];
  assert.equal(transition.splitRatio, 0.5);
  assert.deepEqual(transition.placement.center, { x: 0, y: 0, z: 0 });
  assert.equal(transition.gatesAllowed, false);
  assert.equal(transition.hazardsAllowed, false);
  assert.equal(transition.encountersAllowed, false);
  assert.equal(transition.elevationTransfersAllowed, false);
  assert.deepEqual(transition.sourceThemeBinding, SOURCE_THEME);
  assert.deepEqual(transition.destinationThemeBinding, DESTINATION_THEME);
  const paddingNodes = result.overlayPlan.nodes.filter(({ operationId }) => operationId === transition.operationId);
  assert.equal(paddingNodes.length, 2);
  assert.deepEqual(paddingNodes[0].themeBinding, SOURCE_THEME);
  assert.deepEqual(paddingNodes[1].themeBinding, DESTINATION_THEME);
  const paddingSegments = result.overlayPlan.segments
    .filter(({ operationId }) => operationId === transition.operationId)
    .sort((left, right) => left.physicalOrdinal - right.physicalOrdinal);
  assert.equal(paddingSegments.length, 4);
  assert.deepEqual(
    paddingSegments.map(({ themeBinding }) => themeBinding),
    [SOURCE_THEME, SOURCE_THEME, DESTINATION_THEME, DESTINATION_THEME],
  );
});

test('cross-theme padding rejects descriptive seam labels that runtime cannot assemble', () => {
  const fixture = makeFixture({ crossTheme: true });
  const descriptiveOnly = {
    ...COMPLETE_CAPABILITIES,
    assets: ['light-fixture'],
    connectors: ['service-gallery'],
    transitions: ['flat-threshold', 'architectural-seam'],
  };
  fixture.extensionRegions[0].themeCapabilities = descriptiveOnly;
  fixture.themeCapabilitiesByRegionId = {
    'fixture-magma-region': descriptiveOnly,
  };
  const result = augmentDungeonDraft({
    ...fixture,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'descriptive-seam-is-not-runtime-capability',
  });
  assert.equal(result.status, 'unchanged');
  assert.equal(result.effectiveDraft, fixture.baseDraft);
  assert.ok(result.diagnostics.errors.some(({ code }) => (
    code === 'transition-theme-capabilities-missing'
  )));
});

test('cross-theme padding rejects the overlay rather than using a foreign fallback', () => {
  const fixture = makeFixture({ crossTheme: true });
  fixture.themeCapabilitiesByRegionId = {};
  const result = augmentDungeonDraft({
    ...fixture,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'missing-magma-theme',
  });
  assert.equal(result.status, 'unchanged');
  assert.equal(result.effectiveDraft, fixture.baseDraft);
  assert.equal(result.overlayPlan, null);
  assert.equal(result.diagnostics.errors.some(({ code }) => (
    code === 'theme-capabilities-missing' || code === 'transition-theme-capabilities-missing'
  )), true);
});

test('validation rejects node clearance and connector landing collisions', () => {
  const fixture = makeFixture();
  const result = augmentDungeonDraft({
    ...fixture,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'clearance-and-landing-collisions',
  });
  assert.equal(result.status, 'applied');
  const invalidPlan = structuredClone(result.overlayPlan);
  const baseVolume = fixture.baseDraft.rooms[0].occupiedVolumes[0];
  invalidPlan.nodes[0].clearanceVolumes[0].center = { ...baseVolume.center };
  invalidPlan.nodes[0].clearanceVolumes[0].size = { ...baseVolume.size };
  invalidPlan.segments[0].landingVolumes[0].center = { ...baseVolume.center };
  invalidPlan.segments[0].landingVolumes[0].size = { ...baseVolume.size };
  invalidPlan.segments[0].landingVolumes[0].endpointParentNodeIds = [];
  const validation = validateDungeonAugmentationPlan(invalidPlan, {
    baseDraft: fixture.baseDraft,
    extensionRegions: fixture.extensionRegions,
    profiles: DUNGEON_AUGMENTATION_PROFILES,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  });
  assert.equal(validation.accepted, false);
  assert.equal(validation.errors.some(({ code, context }) => (
    code === 'supplement-overlaps-base-draft'
      && context.nodeId === invalidPlan.nodes[0].id
  )), true);
  assert.equal(validation.errors.some(({ code, context }) => (
    code === 'supplement-segment-overlaps-base-draft'
      && context.volumePurpose === 'supplement-connector-landing-clearance'
  )), true);
});

test('delegated progression assigns only parent-authorized beats in prerequisite order', () => {
  const profile = createDungeonAugmentationProfile({
    id: 'fixture-delegated-progression-v1',
    operationBudget: {
      optionalBranchCount: 1,
      optionalBranchRooms: [2, 2],
      edgePaddingCount: 0,
      edgePaddingRooms: [0, 0],
      minimumTotalRooms: 2,
      maximumTotalRooms: 2,
    },
    requiredOperations: { optionalBranch: true, edgePadding: false },
    allowDelegatedProgression: true,
  });
  const fixture = makeFixture({
    profileId: profile.id,
    delegatedProgressionBeats: [
      { id: 'delegated-alpha-key', kind: 'key', required: true, unlocksBeatId: 'delegated-alpha-gate' },
      { id: 'delegated-alpha-gate', kind: 'gate', required: true },
    ],
  });
  const profiles = { ...DUNGEON_AUGMENTATION_PROFILES, [profile.id]: profile };
  const result = augmentDungeonDraft({
    ...fixture,
    profileId: profile.id,
    profiles,
    layoutSeed: 'delegated-progression',
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
  assert.deepEqual(
    result.overlayPlan.progressionAssignments.map(({ beatId }) => beatId),
    ['delegated-alpha-key', 'delegated-alpha-gate'],
  );
  assert.ok(
    result.overlayPlan.progressionAssignments[0].progressionOrder
      < result.overlayPlan.progressionAssignments[1].progressionOrder,
  );
  const [keyAssignment, gateAssignment] = result.overlayPlan.progressionAssignments;
  assert.equal(keyAssignment.gatedSegmentId, null);
  assert.ok(gateAssignment.gatedSegmentId);
  assert.ok(result.overlayPlan.segments.some((segment) => (
    segment.id === gateAssignment.gatedSegmentId
      && [segment.from.nodeId, segment.to.nodeId].includes(gateAssignment.nodeId)
  )));
  assert.equal(result.overlayPlan.operations.filter(({ type }) => type === 'delegatedProgression').length, 2);
  const validation = validateDungeonAugmentationPlan(result.overlayPlan, {
    baseDraft: fixture.baseDraft,
    extensionRegions: fixture.extensionRegions,
    profiles,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  });
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors));

  const unsolvable = structuredClone(result.overlayPlan);
  const invalidKey = unsolvable.progressionAssignments[0];
  const invalidGate = unsolvable.progressionAssignments[1];
  const originalKeyNodeId = invalidKey.nodeId;
  const originalKeyAnchorId = invalidKey.anchorId;
  invalidKey.nodeId = invalidGate.nodeId;
  invalidKey.anchorId = invalidGate.anchorId;
  invalidGate.nodeId = originalKeyNodeId;
  invalidGate.anchorId = originalKeyAnchorId;
  invalidGate.gatedSegmentId = unsolvable.nodes
    .find(({ id }) => id === originalKeyNodeId)
    .sockets.find(({ localSocketId }) => localSocketId === 'entry')
    .segmentId;
  const unsolvableValidation = validateDungeonAugmentationPlan(unsolvable, {
    baseDraft: fixture.baseDraft,
    extensionRegions: fixture.extensionRegions,
    profiles,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  });
  assert.equal(unsolvableValidation.accepted, false);
  assert.ok(unsolvableValidation.errors.some(({ code }) => (
    code === 'delegated-progression-unsolvable'
  )));
});

test('committed augmentation identity requires exact plans, themes, and stable progression IDs', () => {
  const fixture = makeFixture();
  const result = augmentDungeonDraft({
    ...fixture,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'save-identity',
  });
  assert.equal(result.status, 'applied');
  const identity = createDungeonAugmentationSaveIdentity(result.overlayPlan);
  assert.equal(identity.schema, DUNGEON_AUGMENTATION_SAVE_IDENTITY_SCHEMA);
  assert.ok(identity.progressionStateIds.length > 0);
  assert.deepEqual(sanitizeDungeonAugmentationSaveIdentity(identity), identity);
  assert.equal(validateCommittedDungeonAugmentationIdentity(identity, identity).compatible, true);
  assert.equal(validateCommittedDungeonAugmentationIdentity(null, null).status, 'legacy-unaugmented');
  const changed = JSON.parse(JSON.stringify(identity));
  changed.themeRevisions[0].revision = 'missing-theme-revision';
  const incompatible = validateCommittedDungeonAugmentationIdentity(identity, changed);
  assert.equal(incompatible.compatible, false);
  assert.equal(incompatible.resetOrAbandonRequired, true);
  assert.equal(incompatible.errors.some(({ code }) => code === 'augmentation-theme-revisions-mismatch'), true);
  const unavailable = validateCommittedDungeonAugmentationIdentity(identity, null);
  assert.equal(unavailable.compatible, false);
  assert.equal(unavailable.errors.some(({ code }) => code === 'committed-augmentation-content-unavailable'), true);
});
