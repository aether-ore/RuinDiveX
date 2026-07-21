import { deriveDungeonTopologySignaturesV2 } from '../../../src/dungeon-v2/DungeonTopologySignatureV2.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function boundary(id, cellId, regionId, side, kind, bounds) {
  return { id, cellId, regionId, side, kind, bounds, materialProfileId: 'test-bulkhead', collider: { enabled: true } };
}

function cellBoundaries(prefix, cellId, regionId, minX, maxX, sharedSide) {
  const frameKind = (side) => side === sharedSide ? 'portal-frame' : 'solid';
  return [
    boundary(`${prefix}-west`, cellId, regionId, 'west', frameKind('west'), { min: { x: minX, y: 0, z: 0 }, max: { x: minX, y: 8, z: 10 } }),
    boundary(`${prefix}-east`, cellId, regionId, 'east', frameKind('east'), { min: { x: maxX, y: 0, z: 0 }, max: { x: maxX, y: 8, z: 10 } }),
    boundary(`${prefix}-floor`, cellId, regionId, 'floor', 'solid', { min: { x: minX, y: 0, z: 0 }, max: { x: maxX, y: 0, z: 10 } }),
    boundary(`${prefix}-ceiling`, cellId, regionId, 'ceiling', 'solid', { min: { x: minX, y: 8, z: 0 }, max: { x: maxX, y: 8, z: 10 } }),
    boundary(`${prefix}-north`, cellId, regionId, 'north', 'solid', { min: { x: minX, y: 0, z: 0 }, max: { x: maxX, y: 8, z: 0 } }),
    boundary(`${prefix}-south`, cellId, regionId, 'south', 'solid', { min: { x: minX, y: 0, z: 10 }, max: { x: maxX, y: 8, z: 10 } }),
  ];
}

function rawFixture() {
  const structuralBoundaries = [
    ...cellBoundaries('a', 'cell-a', 'region-a', 0, 10, 'east'),
    ...cellBoundaries('b', 'cell-b', 'region-b', 10, 20, 'west'),
  ];
  const walkableSurfaces = [
    { id: 'surface-a', regionId: 'region-a', cellId: 'cell-a', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 0.2, z: 10 } }, purpose: 'exploration', supportBoundaryIds: ['a-floor'], collision: { enabled: true } },
    { id: 'surface-b', regionId: 'region-b', cellId: 'cell-b', bounds: { min: { x: 10, y: 0, z: 0 }, max: { x: 20, y: 0.2, z: 10 } }, purpose: 'shortcut', supportBoundaryIds: ['b-floor'], collision: { enabled: true } },
  ];
  structuralBoundaries.find(({ id }) => id === 'a-east').openings = [{
    id: 'portal-a-b:region-a', portalId: 'portal-a-b', center: { x: 10, y: 2, z: 5 }, dimensions: { width: 3, height: 4, depth: 0.5 },
  }];
  structuralBoundaries.find(({ id }) => id === 'b-west').openings = [{
    id: 'portal-a-b:region-b', portalId: 'portal-a-b', center: { x: 10, y: 2, z: 5 }, dimensions: { width: 3, height: 4, depth: 0.5 },
  }];
  const plan = {
    id: 'synthetic-accepted-plan',
    tileSize: 4,
    accepted: true,
    validation: { accepted: true, validatorVersion: 'synthetic-test-fixture' },
    acceptanceProfile: 'module',
    districts: [{ id: 'test-district' }],
    regions: [
      { id: 'region-a', districtId: 'test-district', topologySignature: 'synthetic-a', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 8, z: 10 } } },
      { id: 'region-b', districtId: 'test-district', topologySignature: 'synthetic-b', bounds: { min: { x: 10, y: 0, z: 0 }, max: { x: 20, y: 8, z: 10 } } },
    ],
    modulePlacements: [
      { id: 'placement-a', descriptorId: 'synthetic-a', revision: 1 },
      { id: 'placement-b', descriptorId: 'synthetic-b', revision: 1 },
    ],
    progression: {}, encounters: [], rewards: [], objectives: [], environmentStates: [], mechanisms: [],
    minimap: {
      source: 'DungeonPlanV2',
      regions: [
        { id: 'region-a', districtId: 'test-district', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 8, z: 10 } }, elevation: 0 },
        { id: 'region-b', districtId: 'test-district', bounds: { min: { x: 10, y: 0, z: 0 }, max: { x: 20, y: 8, z: 10 } }, elevation: 0 },
      ],
      connections: [{ id: 'portal-a-b', fromRegionId: 'region-a', toRegionId: 'region-b', direction: 'bidirectional' }],
      staticMarkers: [],
    },
    spatialCells: [
      { id: 'cell-a', regionId: 'region-a', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 8, z: 10 } }, playable: true, interior: true },
      { id: 'cell-b', regionId: 'region-b', bounds: { min: { x: 10, y: 0, z: 0 }, max: { x: 20, y: 8, z: 10 } }, playable: true, interior: true },
    ],
    structuralBoundaries,
    portals: [{
      id: 'portal-a-b', order: 0,
      from: { regionId: 'region-a', cellId: 'cell-a', boundaryId: 'a-east', openingId: 'portal-a-b:region-a', side: 'east', center: { x: 10, y: 2, z: 5 }, dimensions: { width: 3, height: 4, depth: 0.5 } },
      to: { regionId: 'region-b', cellId: 'cell-b', boundaryId: 'b-west', openingId: 'portal-a-b:region-b', side: 'west', center: { x: 10, y: 2, z: 5 }, dimensions: { width: 3, height: 4, depth: 0.5 } },
      connectorForm: 'bulkhead', placementBucket: 'off-center-low', elevationBand: 0,
      approachType: 'walk', direction: 'bidirectional', traversal: { enabled: true, mode: 'walk', minimumWidth: 3, minimumHeadroom: 3.2 }, visibleDestinationRegionId: 'region-b',
    }],
    walkableSurfaces,
    structuralFixtures: [{
      id: 'fixture-a-pipe', type: 'pipe', regionId: 'region-a', cellId: 'cell-a',
      bounds: { min: { x: 2, y: 0.2, z: 2 }, max: { x: 4, y: 1.2, z: 3 } },
      gameplayPurpose: 'synthetic collision fixture', collision: 'blocking', supportBoundaryIds: ['a-floor'],
    }],
    traversalLinks: [{
      id: 'traversal-a-b', fromSurfaceId: 'surface-a', toSurfaceId: 'surface-b', mode: 'walk', bidirectional: true,
    }],
    falls: [], safeAnchors: [{ id: 'safe-a', regionId: 'region-a', position: { x: 2, y: 0.2, z: 2 }, purpose: 'player-start', surfaceId: 'surface-a' }], actions: [],
    anchors: [], compatibility: {
      entranceRoomId: 'region-a',
      playerStartAnchorId: 'safe-a',
      campReturnAnchorId: 'safe-a',
      extractionAnchorId: null,
    },
    sockets: [
      { id: 'socket-a', status: 'paired' },
      { id: 'socket-b', status: 'paired' },
    ],
    connectionOrder: ['portal-a-b'], visibilityLinks: [], keycardZones: [],
  };
  const byPlanId = new Map();
  const visuals = new Map();
  const colliders = new Map();
  for (const item of [...structuralBoundaries, ...walkableSurfaces, ...plan.structuralFixtures]) {
    const visualId = `visual:${item.id}`;
    const colliderId = `collider:${item.id}`;
    byPlanId.set(item.id, { visualIds: [visualId], colliderIds: [colliderId] });
    visuals.set(visualId, { id: visualId });
    colliders.set(colliderId, {
      id: colliderId,
      planId: item.id,
      obstacleKind: walkableSurfaces.includes(item) ? 'floor' : 'wall',
      bounds: item.bounds,
    });
  }
  const floorTiles = walkableSurfaces.flatMap((surface) => {
    const result = [];
    for (const x of [0, 1, 2, 3, 4, 5]) {
      for (const z of [0, 1, 2]) {
        const worldX = x * 4;
        const worldZ = z * 4;
        if (worldX < surface.bounds.min.x - 1.8
          || worldX > surface.bounds.max.x + 1.8
          || worldZ < surface.bounds.min.z - 1.8
          || worldZ > surface.bounds.max.z + 1.8) continue;
        result.push({
          id: `${surface.id}:tile:${x}:${z}`,
          x,
          z,
          elevation: surface.bounds.max.y,
          level: 0,
          roomId: surface.regionId,
          regionId: surface.regionId,
          cellId: surface.cellId,
          surfaceId: surface.id,
          surface: 'dungeonV2Floor',
          gameplayPurpose: surface.purpose,
          hazardTag: null,
          blocksEnemyNavigation: false,
        });
      }
    }
    return result;
  });
  const tiles = new Map(floorTiles.map((tile) => [`${tile.x},${tile.z}`, tile]));
  const rooms = plan.regions.map((region) => ({
    id: region.id,
    stableRegionId: region.id,
    type: 'dungeonV2Region',
    archetype: region.id,
    archetypeId: region.id,
    purpose: null,
    environmentalStory: null,
    flavorId: null,
    x: Math.round(((region.bounds.min.x + region.bounds.max.x) * 0.5) / 4),
    z: Math.round(((region.bounds.min.z + region.bounds.max.z) * 0.5) / 4),
    width: Math.ceil((region.bounds.max.x - region.bounds.min.x) / 4),
    depth: Math.ceil((region.bounds.max.z - region.bounds.min.z) / 4),
    minY: region.bounds.min.y,
    maxY: region.bounds.max.y,
    ceilingHeight: region.bounds.max.y,
    bounds: region.bounds,
    districtId: region.districtId,
  }));
  const platforms = walkableSurfaces.map((surface) => ({
    id: surface.id,
    position: {
      x: (surface.bounds.min.x + surface.bounds.max.x) * 0.5,
      y: (surface.bounds.min.y + surface.bounds.max.y) * 0.5,
      z: (surface.bounds.min.z + surface.bounds.max.z) * 0.5,
    },
    regionId: surface.regionId,
    gameplayPurpose: surface.purpose,
    dynamic: false,
    halfWidth: (surface.bounds.max.x - surface.bounds.min.x) * 0.5,
    halfDepth: (surface.bounds.max.z - surface.bounds.min.z) * 0.5,
    topY: surface.bounds.max.y,
    supportBoundaryIds: surface.supportBoundaryIds,
  }));
  const roomConnections = plan.portals.map((portal) => ({
    id: portal.id,
    fromRoomId: portal.from.regionId,
    toRoomId: portal.to.regionId,
    doorId: null,
    direction: portal.direction,
    routes: [{ connectorType: portal.connectorForm }],
  }));
  const minimap = {
    source: 'DungeonPlanV2',
    rooms: plan.minimap.regions.map((region) => ({
      ...region,
      roomId: region.id,
      districtId: region.districtId,
      bounds: region.bounds,
      roomBounds2D: {
        x: region.bounds.min.x / 4,
        z: region.bounds.min.z / 4,
        width: (region.bounds.max.x - region.bounds.min.x) / 4,
        depth: (region.bounds.max.z - region.bounds.min.z) / 4,
      },
    })),
    hallways: plan.minimap.connections.map((connection) => ({
      ...connection,
      hallwayId: connection.id,
      fromRoomId: connection.fromRegionId,
      toRoomId: connection.toRegionId,
    })),
    markers: [],
  };
  const registry = { visuals, colliders, byPlanId };
  const gateBarrierIds = new Set();
  const solidZones = [];
  const aerialBoundaryZones = [];
  for (const boundaryEntry of structuralBoundaries) {
    if (gateBarrierIds.has(boundaryEntry.id)) continue;
    const colliderEntry = colliders.get(`collider:${boundaryEntry.id}`);
    if (!['floor', 'ceiling'].includes(boundaryEntry.side)) solidZones.push(colliderEntry);
    if (boundaryEntry.side !== 'floor') aerialBoundaryZones.push(colliderEntry);
  }
  const fixtureCollider = colliders.get('collider:fixture-a-pipe');
  solidZones.push(fixtureCollider);
  aerialBoundaryZones.push(fixtureCollider);
  const assembly = {
    kind: 'DungeonV2',
    plan,
    planId: plan.id,
    seed: plan.seed,
    rooms,
    roomArchetypes: rooms.map((room) => ({
      id: room.id,
      archetypeId: room.archetypeId,
      purpose: room.purpose,
      districtId: room.districtId,
      minY: room.minY,
      maxY: room.maxY,
    })),
    floorTiles,
    tiles,
    platforms,
    doors: [],
    encounters: [],
    objectives: [],
    rewards: [],
    progression: {
      ...plan.progression,
      roomConnections,
      entranceRoomId: 'region-a',
      shrineRoomId: undefined,
      bossRoomId: undefined,
      minimap,
    },
    minimap,
    verticalConnectors: plan.portals.map((portal) => structuredClone(portal)),
    connectionPlans: plan.portals.map((portal) => ({
      id: portal.id,
      logicalConnectionId: `${portal.from.regionId}_${portal.to.regionId}`,
      connectorType: portal.connectorForm,
      fromRoomId: portal.from.regionId,
      toRoomId: portal.to.regionId,
      elevation: portal.from.center.y,
      direction: portal.direction,
    })),
    solidZones,
    aerialBoundaryZones,
    playerStart: { x: 2, y: 0.2, z: 2 },
    playerStartFacing: { x: 0, y: 0, z: 1 },
    ruinEntryPosition: { x: 2, y: 0.2, z: 2 },
    campReturnPosition: { x: 2, y: 0.2, z: 2 },
    extractionPosition: null,
    extractionVisualPosition: null,
    extractionAnchorId: null,
    extractionActionId: null,
    structuralRegistry: registry,
    structuralDiagnostics: [],
  };
  const derivedTopologySignatures = deriveDungeonTopologySignaturesV2(plan);
  for (const region of plan.regions) region.topologySignature = derivedTopologySignatures[region.id];
  return {
    stage: 'assembly',
    plan,
    assembly,
    proofs: {
      visualCollider: {
        sampleSpacing: 0.21,
        mismatches: [],
        transparentStructuralIds: [],
        unregisteredVisualIds: [],
        unregisteredColliderIds: [],
        physicalClearance: {
          proofId: 'assembled-player-capsule-v1',
          sampleSpacing: 0.21,
          capsuleRadius: 0.42,
          capsuleHeight: 3.2,
          internalLinkCount: 1,
          selectableActionCount: 0,
          linkProofs: [{
            linkId: 'traversal-a-b', mode: 'walk', sampleSpacing: 0.21,
            capsuleRadius: 0.42, capsuleHeight: 3.2,
            routePoints: [{ x: 9.5, y: 0.2, z: 5 }, { x: 10.5, y: 0.2, z: 5 }],
            sampleCount: 6, samples: [], uncoveredSamples: [], blockedSamples: [],
            endpointMismatches: [], delegatedToStableStateProof: false, mechanismId: null,
            accepted: true,
          }],
          actionProofs: [],
          blockedLinks: [],
          blockedActions: [],
          accepted: true,
        },
        ladderRuntime: {
          proofId: 'assembled-ladder-public-input-v1',
          ladderCount: 0,
          ladderProofs: [],
          rejectedLadders: [],
          accepted: true,
        },
      },
      mechanismStates: [],
      offscreenStructuralRender: {
        rendererId: 'deterministic-cpu-triangle-rasterizer-v1',
        maxRange: 120,
        opaqueTriangleCount: 1,
        frameCount: 1,
        frames: [{ backgroundPixelCount: 0, renderedPixelCount: 1, rasterHash: 'synthetic-opaque' }],
        clearFrames: [],
        transparentStructuralIds: [],
        unpairedBoundarySamples: [],
        downwardVisibility: {
          proofId: 'assembled-downward-raycast-v1',
          raycastDerived: true,
          maxRange: 120,
          raysCast: 8,
          lowerHits: [],
          unresolvedLowerHits: [],
          invalidLowerHits: [],
          accepted: true,
        },
        accepted: true,
      },
      portalRoutes: [{
        portalId: 'portal-a-b', sampleSpacing: 0.21, continuous: true, traversable: true,
        walkable: true, enclosed: true, supported: true, minimumWidth: 3, minimumHeadroom: 3.2,
        uncoveredSamples: [], blockedSamples: [], visualColliderMismatches: [],
        approachClearanceVolumes: ['from', 'to'].map((endpoint) => ({
          endpoint,
          declaredBy: 'portal-endpoint-traversal-contract',
          sampleSpacing: 0.21,
          width: 3,
          depth: 1.24,
          headroom: 3.2,
          bounds: endpoint === 'from'
            ? { min: { x: 8.76, y: 0.025, z: 3.5 }, max: { x: 10, y: 3.2, z: 6.5 } }
            : { min: { x: 10, y: 0.025, z: 3.5 }, max: { x: 11.24, y: 3.2, z: 6.5 } },
          structuralFixtureIntrusions: [],
          interactionIntrusions: [],
          colliderIntrusions: [],
          accepted: true,
        })),
        approachClearanceAccepted: true,
      }],
    },
  };
}

export function createAcceptedSyntheticFixture(mutate = null) {
  const fixture = rawFixture();
  mutate?.(fixture);
  deepFreeze(fixture.plan);
  return fixture;
}
