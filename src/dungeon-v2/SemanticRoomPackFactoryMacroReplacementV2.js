import {
  clonePlanData,
  deepFreezePlan,
  isSerializablePlanValue,
} from './DungeonPlanV2Contract.js';
import {
  createPlanDiagnostic,
  hashPlanDiagnostics,
  sortPlanDiagnostics,
} from './DungeonPlanDiagnostics.js';
import { validateDungeonPlanV2 } from './DungeonPlanV2Validator.js';
import {
  compileSemanticRoomPackPlacementV2,
  validateSemanticRoomPackPlacementV2,
} from './SemanticRoomPackPlanAdapterV2.js';
import { getSemanticRoomPackV1Descriptor } from './SemanticRoomPackV1Catalog.js';
import { deriveDungeonTopologySignaturesV2 } from './DungeonTopologySignatureV2.js';

export const SEMANTIC_ROOM_PACK_FACTORY_MACRO_REPLACEMENT_V2_REVISION = 1;

const ROOM_ID = 'rdx_factory_corkscrew_exchange';
const REGION_ID = 'corkscrew';
const CELL_ID = 'cell.corkscrew.main';
const HOST_MODULE_PLACEMENT_ID = 'placement.corkscrew';
const PLACEMENT_ID = 'placement.semantic-room-pack.factory-corkscrew';
const COMPOUND_ID = 'compound.corkscrew.authored-exchange';
const EPSILON = 1e-7;
const WALL_THICKNESS = 0.4;

const SIDE_FORWARD = Object.freeze({
  north: Object.freeze({ x: 0, y: 0, z: -1 }),
  south: Object.freeze({ x: 0, y: 0, z: 1 }),
  east: Object.freeze({ x: 1, y: 0, z: 0 }),
  west: Object.freeze({ x: -1, y: 0, z: 0 }),
});

/**
 * This is intentionally a replacement map, not a branch map.  The existing
 * Golden graph owns five Corkscrew edges, but Parts already owns the optional
 * Nest route.  Removing the redundant Nest -> Corkscrew edge lets the four
 * authored sockets each own one useful route without multiplexing two portals
 * through one aperture or creating a credential bypass.
 */
export const FACTORY_CORKSCREW_SOCKET_ROUTE_BINDINGS_V2 = deepFreezePlan([
  {
    socketId: 'entry_south',
    portalId: 'portal.parts-corkscrew-service',
    role: 'main-ingress',
    expectedBarrierId: null,
    routePoints: [
      { x: 67, y: 15.3, z: -48 },
      { x: 67, y: 10.2, z: -22 },
      { x: 96, y: 10.2, z: -22 },
      { x: 96, y: 10.2, z: -17 },
    ],
  },
  {
    socketId: 'exit_east_mid',
    portalId: 'portal.corkscrew-credential-loop',
    role: 'gated-shortcut-return',
    expectedBarrierId: 'Gate_Credential_Loop',
    routePoints: [
      { x: 78, y: 13.4, z: 0 },
      { x: 72.6, y: 13.4, z: 0 },
      { x: 72.6, y: 14, z: 22 },
      { x: 68.8, y: 14, z: 22 },
      { x: 68.8, y: 14, z: -4.5 },
      { x: 66, y: 14, z: -4.5 },
    ],
  },
  {
    socketId: 'exit_north_high',
    portalId: 'portal.corkscrew-hazard-intake',
    role: 'conditioned-undercroft-route',
    expectedBarrierId: null,
    routePoints: [
      { x: 96, y: 16.6, z: 17 },
      { x: 96, y: 16.6, z: 21 },
      { x: 112, y: 16.6, z: 21 },
      { x: 112, y: -5, z: 21 },
      { x: 112, y: -5, z: 14 },
    ],
  },
  {
    socketId: 'exit_west_top',
    portalId: 'portal.corkscrew-machine-core-gamma',
    role: 'non-bypassable-gamma-route',
    expectedBarrierId: 'Door_Gamma',
    routePoints: [
      { x: 114, y: 19.8, z: 0 },
      { x: 121, y: 19.8, z: 0 },
      { x: 121, y: 16, z: -10 },
      { x: 127, y: 16, z: -10 },
    ],
  },
]);

const REMOVED_REDUNDANT_PORTAL_ID = 'portal.nest-corkscrew-service';
const REGION_SURFACE_NODE = Object.freeze({
  entry_apron: 'WALK_ENTRY_APRON',
  corkscrew_platform: 'MECH_GEAR_PLATFORM',
  recovery_floor: 'WALK_LOWER_CATCHMENT',
  east_mid_ledge: 'WALK_EAST_MID_LEDGE',
  north_high_ledge: 'WALK_NORTH_HIGH_LEDGE',
  west_top_ledge: 'WALK_WEST_TOP_LEDGE',
});

function round(value) {
  const result = Math.round(Number(value) * 1e9) / 1e9;
  return Object.is(result, -0) ? 0 : result;
}

function vector(x, y, z) {
  return { x: round(x), y: round(y), z: round(z) };
}

function finiteVector(value) {
  return value && ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]));
}

function finiteBounds(bounds) {
  return finiteVector(bounds?.min)
    && finiteVector(bounds?.max)
    && ['x', 'y', 'z'].every((axis) => bounds.min[axis] < bounds.max[axis]);
}

function samePoint(left, right, tolerance = 1e-6) {
  return ['x', 'y', 'z'].every((axis) => Math.abs(left[axis] - right[axis]) <= tolerance);
}

function sideFromForward(forward) {
  for (const [side, expected] of Object.entries(SIDE_FORWARD)) {
    if (samePoint(forward, expected)) return side;
  }
  throw new Error(`Authored socket forward is not cardinal: ${JSON.stringify(forward)}`);
}

function rotatedSide(localSide, yawQuarterTurns) {
  if (localSide === 'floor' || localSide === 'ceiling') return localSide;
  const order = ['north', 'west', 'south', 'east'];
  const index = order.indexOf(localSide);
  if (index < 0) throw new Error(`Unsupported authored shell side ${localSide}.`);
  return order[(index + yawQuarterTurns) % order.length];
}

function sourceShellSide(sourceNodeName, yawQuarterTurns) {
  if (/^SHELL_FLOOR(?:_|$)/u.test(sourceNodeName)) return 'floor';
  if (/^SHELL_CEILING(?:_|$)/u.test(sourceNodeName)) return 'ceiling';
  const match = sourceNodeName.match(/_(NORTH|SOUTH|EAST|WEST)(?:_|$)/u);
  if (!match) throw new Error(`Authored shell collider ${sourceNodeName} has no explicit side.`);
  return rotatedSide(match[1].toLowerCase(), yawQuarterTurns);
}

function boundsForManifestCollider(collider) {
  const center = collider.worldCenter;
  if (collider.shape === 'cylinder') {
    return {
      min: vector(center.x - collider.worldRadius, center.y - collider.worldHeight * 0.5, center.z - collider.worldRadius),
      max: vector(center.x + collider.worldRadius, center.y + collider.worldHeight * 0.5, center.z + collider.worldRadius),
    };
  }
  if (collider.shape !== 'box') throw new TypeError(`Unsupported manifest collider ${collider.shape}.`);
  const halfX = collider.worldSize.x * 0.5;
  const halfY = collider.worldSize.y * 0.5;
  const halfZ = collider.worldSize.z * 0.5;
  const cosine = Math.abs(Math.cos(collider.worldYawRadians));
  const sine = Math.abs(Math.sin(collider.worldYawRadians));
  const extentX = halfX * cosine + halfZ * sine;
  const extentZ = halfX * sine + halfZ * cosine;
  return {
    min: vector(center.x - extentX, center.y - halfY, center.z - extentZ),
    max: vector(center.x + extentX, center.y + halfY, center.z + extentZ),
  };
}

function descriptorReference(placement, record) {
  return {
    packId: placement.packId,
    packRevision: placement.packRevision,
    roomId: placement.roomId,
    placementId: placement.placementId,
    sourceNodeName: record.sourceNodeName,
    colliderId: record.colliderId,
    collisionSourcePolicy: placement.collisionSourcePolicy,
  };
}

function presentationFields(placement, record) {
  return {
    visualId: `visual.${record.id}`,
    visualIds: [`visual.${record.id}`],
    presentationOwnerId: placement.placementId,
    descriptorReference: descriptorReference(placement, record),
  };
}

function enrichBoundary(placement, record) {
  const bounds = boundsForManifestCollider(record);
  const side = sourceShellSide(record.sourceNodeName, placement.placementTransform.yawQuarterTurns);
  return {
    ...clonePlanData(record),
    regionId: REGION_ID,
    cellId: CELL_ID,
    bounds,
    side,
    kind: 'solid',
    openings: [],
    materialProfileId: 'semantic-room-pack-v1.factory-corkscrew.shell',
    visualProfile: `semantic-room-pack-v1:${ROOM_ID}:${side}`,
    collider: true,
    collision: 'static',
    opaque: true,
    colliderIds: [record.colliderId],
    colliderBounds: [clonePlanData(bounds)],
    gameplayPurpose: `authored enclosed ${side} shell for the Corkscrew Exchange`,
    semanticRoomPackPlacementId: placement.placementId,
    ...presentationFields(placement, record),
  };
}

function fixturePurpose(record) {
  return ({
    support: 'visible authored structural support',
    rail: 'authored fall-prevention railing',
    console: 'reachable authored mechanism console',
    mechanismSupport: 'authored corkscrew support column',
  }[record.semantic] ?? `authored ${record.semantic} Factory fixture`);
}

function enrichFixture(placement, record, supportBoundaryIds) {
  const bounds = boundsForManifestCollider(record);
  return {
    ...clonePlanData(record),
    type: `semantic-room-pack-${record.semantic}`,
    regionId: REGION_ID,
    cellId: CELL_ID,
    bounds,
    gameplayPurpose: fixturePurpose(record),
    collision: 'blocking',
    accessibility: 'reachable',
    supportBoundaryIds: [...supportBoundaryIds],
    colliderIds: [record.colliderId],
    colliderBounds: [clonePlanData(bounds)],
    blocksAerialTraversal: true,
    semanticRoomPackPlacementId: placement.placementId,
    ...presentationFields(placement, record),
  };
}

function enrichSurface(placement, descriptor, record, supportBoundaryIds, fixtures) {
  const bounds = boundsForManifestCollider(record);
  const dynamic = record.semantic === 'movingSurface';
  const directSupports = fixtures
    .filter(({ sourceNodeName }) => sourceNodeName.startsWith(`SUPPORT_${record.sourceNodeName}_`))
    .map(({ id }) => id);
  const mechanismSupports = fixtures
    .filter(({ semantic }) => semantic === 'mechanismSupport')
    .map(({ id }) => id);
  return {
    ...clonePlanData(record),
    regionId: REGION_ID,
    cellId: CELL_ID,
    bounds,
    purpose: descriptor.platformPurposes?.[record.sourceNodeName]
      ?? (record.semantic === 'recoveryCatchment'
        ? 'damage-free authored lower recovery destination'
        : 'authored Factory traversal surface'),
    supportBoundaryIds: [...supportBoundaryIds],
    supportFixtureIds: directSupports.length ? directSupports : dynamic ? mechanismSupports : [],
    supportProfile: 'semantic-room-pack-v1-authored-support',
    visualProfile: `semantic-room-pack-v1:${ROOM_ID}:walkable`,
    collision: dynamic ? 'dynamic' : 'static',
    mechanismId: dynamic ? 'mechanism.corkscrew-gear' : null,
    hazardTag: null,
    colliderIds: [record.colliderId],
    colliderBounds: [clonePlanData(bounds)],
    createsLedgeCandidates: false,
    ledgePolicy: 'authored-semantic-surface-seams-disabled',
    semanticRoomPackPlacementId: placement.placementId,
    ...presentationFields(placement, record),
  };
}

function socketStripBounds(socket, side, minY, maxY, header) {
  if (maxY - minY <= EPSILON) return null;
  const halfWidth = socket.aperture.width * 0.5;
  if (side === 'north' || side === 'south') {
    return {
      min: vector(socket.worldPosition.x - halfWidth, minY, header.bounds.min.z),
      max: vector(socket.worldPosition.x + halfWidth, maxY, header.bounds.max.z),
    };
  }
  return {
    min: vector(header.bounds.min.x, minY, socket.worldPosition.z - halfWidth),
    max: vector(header.bounds.max.x, maxY, socket.worldPosition.z + halfWidth),
  };
}

function socketKitBoundary(placement, socket, side, suffix, bounds) {
  const id = `${socket.worldId}:bound-${suffix}-infill`;
  return {
    id,
    regionId: REGION_ID,
    cellId: CELL_ID,
    side,
    kind: 'solid',
    bounds,
    openings: [],
    materialProfileId: 'semantic-room-pack-v1.factory-corkscrew.socket-frame',
    visualProfile: `semantic-room-pack-v1:${ROOM_ID}:socket-frame`,
    collider: true,
    collision: 'static',
    opaque: true,
    gameplayPurpose: `opaque structural infill around authored socket ${socket.id}`,
    structuralKitProfileId: 'semantic-room-pack-v1-opaque-socket-frame',
    presentationOwnerId: placement.placementId,
    semanticRoomPackPlacementId: placement.placementId,
    visualId: `visual.${id}`,
    visualIds: [`visual.${id}`],
  };
}

function bindSocketFrames(placement, manifestBoundaries) {
  const bindings = [];
  const kitBoundaries = [];
  const boundaryBySocketId = {};
  const routeBySocket = new Map(FACTORY_CORKSCREW_SOCKET_ROUTE_BINDINGS_V2.map((entry) => [entry.socketId, entry]));
  for (const socket of placement.sockets) {
    const route = routeBySocket.get(socket.id);
    if (!route) throw new Error(`Functional Factory socket ${socket.id} has no Golden route.`);
    const side = sideFromForward(socket.worldForward);
    const header = manifestBoundaries.find((boundary) => (
      boundary.side === side && boundary.sourceNodeName.includes('SHELL_DOOR_HEADER_')
    ));
    if (!header) throw new Error(`Factory socket ${socket.id} has no manifest header collider.`);
    const opening = {
      id: `opening.factory-corkscrew.${socket.id}`,
      portalId: route.portalId,
      center: vector(socket.worldPosition.x, socket.worldPosition.y + socket.aperture.height * 0.5, socket.worldPosition.z),
      dimensions: { width: socket.aperture.width, height: socket.aperture.height, depth: 1.2 },
    };
    header.kind = 'portal-frame';
    header.openings.push(opening);
    boundaryBySocketId[socket.id] = header.id;
    const socketTop = socket.worldPosition.y + socket.aperture.height;
    const strips = [
      ['lower', placement.worldBounds.min.y, socket.worldPosition.y],
      ['upper', socketTop, header.bounds.min.y],
    ];
    for (const [suffix, minY, maxY] of strips) {
      const bounds = socketStripBounds(socket, side, minY, maxY, header);
      if (bounds) kitBoundaries.push(socketKitBoundary(placement, socket, side, suffix, bounds));
    }
    bindings.push({
      socketId: socket.id,
      sourceNodeName: socket.sourceNodeName,
      status: 'bound',
      portalId: route.portalId,
      boundaryId: header.id,
      capId: null,
      role: route.role,
    });
  }
  return { bindings, kitBoundaries, boundaryBySocketId };
}

function boundaryBounds(bounds, side) {
  if (side === 'north') return { min: vector(bounds.min.x, bounds.min.y, bounds.min.z - WALL_THICKNESS), max: vector(bounds.max.x, bounds.max.y, bounds.min.z) };
  if (side === 'south') return { min: vector(bounds.min.x, bounds.min.y, bounds.max.z), max: vector(bounds.max.x, bounds.max.y, bounds.max.z + WALL_THICKNESS) };
  if (side === 'west') return { min: vector(bounds.min.x - WALL_THICKNESS, bounds.min.y, bounds.min.z), max: vector(bounds.min.x, bounds.max.y, bounds.max.z) };
  if (side === 'east') return { min: vector(bounds.max.x, bounds.min.y, bounds.min.z), max: vector(bounds.max.x + WALL_THICKNESS, bounds.max.y, bounds.max.z) };
  if (side === 'floor') return { min: vector(bounds.min.x, bounds.min.y - WALL_THICKNESS, bounds.min.z), max: vector(bounds.max.x, bounds.min.y, bounds.max.z) };
  if (side === 'ceiling') return { min: vector(bounds.min.x, bounds.max.y, bounds.min.z), max: vector(bounds.max.x, bounds.max.y + WALL_THICKNESS, bounds.max.z) };
  throw new Error(`Unsupported connector side ${side}.`);
}

function segmentTravelSide(from, to) {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const dz = Math.abs(to.z - from.z);
  if (dy > EPSILON && dx <= EPSILON && dz <= EPSILON) return to.y > from.y ? 'ceiling' : 'floor';
  if (dx >= dz) return to.x >= from.x ? 'east' : 'west';
  return to.z >= from.z ? 'south' : 'north';
}

function oppositeSide(side) {
  return ({ north: 'south', south: 'north', east: 'west', west: 'east', floor: 'ceiling', ceiling: 'floor' })[side];
}

function segmentBounds(from, to, aperture) {
  const half = aperture.width * 0.5;
  const side = segmentTravelSide(from, to);
  if (side === 'floor' || side === 'ceiling') {
    return {
      min: vector(from.x - half, Math.min(from.y, to.y), from.z - half),
      max: vector(from.x + half, Math.max(from.y, to.y), from.z + half),
    };
  }
  if (side === 'east' || side === 'west') {
    return {
      min: vector(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.min(from.z, to.z) - half),
      max: vector(Math.max(from.x, to.x), Math.max(from.y, to.y) + aperture.height, Math.max(from.z, to.z) + half),
    };
  }
  return {
    min: vector(Math.min(from.x, to.x) - half, Math.min(from.y, to.y), Math.min(from.z, to.z)),
    max: vector(Math.max(from.x, to.x) + half, Math.max(from.y, to.y) + aperture.height, Math.max(from.z, to.z)),
  };
}

function openingCenter(bounds, side, point, aperture) {
  if (side === 'north') return vector(point.x, point.y + aperture.height * 0.5, bounds.min.z);
  if (side === 'south') return vector(point.x, point.y + aperture.height * 0.5, bounds.max.z);
  if (side === 'west') return vector(bounds.min.x, point.y + aperture.height * 0.5, point.z);
  if (side === 'east') return vector(bounds.max.x, point.y + aperture.height * 0.5, point.z);
  if (side === 'floor') return vector(point.x, bounds.min.y, point.z);
  return vector(point.x, bounds.max.y, point.z);
}

function connectorRecordIds(portal, index) {
  const slug = portal.id.replace(/^portal\./u, '');
  return {
    cellId: `cell.connector.${slug}.${index}`,
    surfaceId: `surface.connector.${slug}.${index}`,
    boundaryId: (side) => `boundary.connector.${slug}.${index}.${side}`,
  };
}

function buildConnectorRoute(portal, route, socket, entrySurfaceId) {
  const points = route.routePoints.map((entry) => vector(entry.x, entry.y, entry.z));
  if (portal.from.regionId === REGION_ID) {
    if (!samePoint(points[0], socket.worldPosition)) throw new Error(`${portal.id} route does not start at ${socket.id}.`);
  } else if (!samePoint(points.at(-1), socket.worldPosition)) {
    throw new Error(`${portal.id} route does not end at ${socket.id}.`);
  }
  const aperture = socket.aperture;
  const compoundId = `compound.connector.${portal.id}`;
  const cells = [];
  const boundaries = [];
  const surfaces = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const ids = connectorRecordIds(portal, index);
    const bounds = segmentBounds(from, to, aperture);
    const travelSide = segmentTravelSide(from, to);
    const startSide = oppositeSide(travelSide);
    const endSide = travelSide;
    const vertical = startSide === 'floor' || startSide === 'ceiling';
    const stair = !vertical && Math.abs(from.y - to.y) > EPSILON;
    cells.push({
      id: ids.cellId,
      regionId: portal.from.regionId,
      bounds,
      playable: true,
      interior: true,
      cameraContained: true,
      occupiedVolume: true,
      connector: true,
      portalId: portal.id,
      connectorForPortalId: portal.id,
      compoundId,
      semanticRoomPackPlacementId: PLACEMENT_ID,
    });
    for (const side of ['north', 'south', 'east', 'west', 'floor', 'ceiling']) {
      const isStart = side === startSide;
      const isEnd = side === endSide;
      const opening = isStart || isEnd ? [{
        id: `opening.connector.${portal.id}.${index}.${side}`,
        portalId: portal.id,
        center: openingCenter(bounds, side, isStart ? from : to, aperture),
        dimensions: {
          width: aperture.width,
          height: aperture.height,
          depth: aperture.width,
        },
      }] : [];
      const id = ids.boundaryId(side);
      boundaries.push({
        id,
        regionId: portal.from.regionId,
        cellId: ids.cellId,
        side,
        kind: opening.length ? 'portal-frame' : 'solid',
        bounds: boundaryBounds(bounds, side),
        openings: opening,
        connector: true,
        materialProfileId: `${portal.connectorForm}.semantic-room-pack-connector`,
        visualProfile: `semantic-room-pack-v1:${portal.connectorForm}:${side}`,
        collider: true,
        collision: 'static',
        opaque: true,
        gameplayPurpose: `enclosed supported ${portal.connectorForm} route segment`,
        presentationOwnerId: `connector.${portal.id}.${index}`,
        visualId: `visual.${id}`,
        visualIds: [`visual.${id}`],
      });
    }
    const floorId = ids.boundaryId('floor');
    surfaces.push({
      id: ids.surfaceId,
      regionId: portal.from.regionId,
      cellId: ids.cellId,
      bounds: vertical
        ? {
            min: vector(from.x - 0.8, Math.min(from.y, to.y), from.z - 0.2),
            max: vector(from.x + 0.8, Math.max(from.y, to.y), from.z + 0.2),
          }
        : {
            min: vector(bounds.min.x, Math.min(from.y, to.y) - 0.3, bounds.min.z),
            max: vector(bounds.max.x, Math.max(from.y, to.y), bounds.max.z),
          },
      purpose: vertical ? 'authored enclosed ladder shaft' : stair ? 'smooth supported connector stair' : 'supported connector deck',
      supportBoundaryIds: [floorId],
      supportFixtureIds: [],
      supportProfile: vertical ? 'enclosed-ladder-frame-v2' : stair ? 'continuous-stair-stringers-v2' : 'enclosed-connector-foundation-v2',
      visualProfile: vertical ? 'industrial-ladder-v2' : `semantic-room-pack-v1:${portal.connectorForm}:${stair ? 'walkable-stairs' : 'floor'}`,
      collision: 'static',
      hazardTag: null,
      createsLedgeCandidates: false,
      ledgePolicy: 'connector-route-ledges-disabled',
      ...(vertical ? {
        geometry: {
          type: 'ladder',
          path: [clonePlanData(from), clonePlanData(to)],
          width: 1.6,
          mountClearance: 1.4,
        },
      } : stair ? {
        geometry: {
          type: 'stairs',
          path: [clonePlanData(from), clonePlanData(to)],
          maxRiser: 0.18,
          minimumTread: 0.45,
          width: aperture.width,
          ledgeClimbDisabled: true,
        },
      } : {}),
    });
  }
  const remoteSurfaceId = portal.from.regionId === REGION_ID
    ? portal.physicalRoute.endpointSurfaceIds.to
    : portal.physicalRoute.endpointSurfaceIds.from;
  const sequence = portal.from.regionId === REGION_ID
    ? [entrySurfaceId, ...surfaces, remoteSurfaceId]
    : [remoteSurfaceId, ...surfaces, entrySurfaceId];
  for (let index = 0; index < surfaces.length; index += 1) {
    const geometry = surfaces[index].geometry;
    if (geometry?.type === 'stairs') {
      geometry.endpointSurfaceIds = {
        start: typeof sequence[index] === 'string' ? sequence[index] : sequence[index].id,
        end: typeof sequence[index + 2] === 'string' ? sequence[index + 2] : sequence[index + 2].id,
      };
      geometry.minimumEndpointOverlap = 1.2;
      geometry.maximumEndpointHeightDelta = 0.05;
    }
  }
  const surfaceIds = surfaces.map(({ id }) => id);
  const sequenceIds = portal.from.regionId === REGION_ID
    ? [entrySurfaceId, ...surfaceIds, remoteSurfaceId]
    : [remoteSurfaceId, ...surfaceIds, entrySurfaceId];
  const traversalLinks = sequenceIds.slice(0, -1).map((fromSurfaceId, index) => ({
    id: `traversal.connector.${portal.id.replace(/^portal\./u, '')}.${index}`,
    regionId: portal.from.regionId,
    fromSurfaceId,
    toSurfaceId: sequenceIds[index + 1],
    mode: surfaces.some(({ geometry }) => geometry?.type === 'ladder') ? 'ladder' : surfaces.some(({ geometry }) => geometry?.type === 'stairs') ? 'walkable-stairs' : 'walk',
    bidirectional: true,
    minimumWidth: surfaces.some(({ geometry }) => geometry?.type === 'ladder') ? 1.6 : aperture.width,
    portalId: portal.id,
    conditions: clonePlanData(portal.conditions ?? []),
  }));
  return { points, cells, boundaries, surfaces, traversalLinks, remoteSurfaceId };
}

function packSurfaceByNode(surfaces, sourceNodeName) {
  const surface = surfaces.find((entry) => entry.sourceNodeName === sourceNodeName);
  if (!surface) throw new Error(`Factory replacement lacks manifest surface ${sourceNodeName}.`);
  return surface;
}

function createInternalTraversalLinks(placement, surfaces, dynamicSurface) {
  const links = [];
  const resolve = (localReference) => {
    const sourceNodeName = REGION_SURFACE_NODE[localReference];
    if (sourceNodeName === 'MECH_GEAR_PLATFORM') return dynamicSurface;
    return packSurfaceByNode(surfaces, sourceNodeName);
  };
  for (const authored of placement.traversalLinks) {
    const from = resolve(authored.localFrom);
    const to = resolve(authored.localTo);
    links.push({
      id: `traversal.semantic-room-pack.factory-corkscrew.internal.${String(links.length).padStart(2, '0')}`,
      regionId: REGION_ID,
      fromSurfaceId: from.id,
      toSurfaceId: to.id,
      mode: authored.kind === 'fallCatchment' ? 'intentional-fall'
        : authored.kind === 'permanentStairs' ? 'walkable-stairs'
          : 'corkscrew-gear',
      bidirectional: authored.kind !== 'fallCatchment',
      minimumWidth: 1.2,
      condition: clonePlanData(authored.condition),
      sourceTraversalId: authored.id,
      sourcePredicate: authored.sourcePredicate,
      semanticRoomPackPlacementId: placement.placementId,
    });
  }
  return links;
}

function createDynamicGearSurface(placement, supportBoundaryIds, supportFixtureIds) {
  const marker = placement.semanticMarkers.find(({ sourceNodeName }) => sourceNodeName === 'MECH_GEAR_PLATFORM');
  if (!marker) throw new Error('Factory manifest lacks MECH_GEAR_PLATFORM marker.');
  return {
    id: 'surface.semantic-room-pack.factory-corkscrew.gear-platform',
    regionId: REGION_ID,
    cellId: CELL_ID,
    bounds: {
      min: vector(marker.worldPosition.x - 2.2, marker.worldPosition.y - 0.15, marker.worldPosition.z - 2.2),
      max: vector(marker.worldPosition.x + 2.2, marker.worldPosition.y + 0.15, marker.worldPosition.z + 2.2),
    },
    purpose: 'plan-owned dynamic collider for the authored Corkscrew gear platform',
    supportBoundaryIds: [...supportBoundaryIds],
    supportFixtureIds: [...supportFixtureIds],
    supportProfile: 'explicit-corkscrew-column-and-bearing-v2',
    visualProfile: 'semantic-room-pack-v1:factory:corkscrew-gear-platform',
    collision: 'dynamic',
    mechanismId: 'mechanism.corkscrew-gear',
    sourceNodeName: 'MECH_GEAR_PLATFORM',
    collisionSourcePolicy: 'explicit-plan-dynamic-platform-contract',
    derivedFromVisibleMeshBounds: false,
    createsLedgeCandidates: false,
    ledgePolicy: 'mechanism-owned-dynamic-platform',
    semanticRoomPackPlacementId: placement.placementId,
  };
}

function createGearControlPad(placement, bridgeSurface, supportBoundaryIds, supportFixtureIds) {
  const marker = placement.semanticMarkers.find(({ sourceNodeName }) => sourceNodeName === 'ANCHOR_MECHANISM_CONSOLE');
  if (!marker) throw new Error('Factory manifest lacks ANCHOR_MECHANISM_CONSOLE marker.');
  return {
    id: 'surface.semantic-room-pack.factory-corkscrew.control-pedestal',
    regionId: REGION_ID,
    cellId: CELL_ID,
    bounds: {
      min: vector(marker.worldPosition.x - 1.25, bridgeSurface.bounds.max.y - 0.3, marker.worldPosition.z - 1.25),
      max: vector(marker.worldPosition.x + 1.25, bridgeSurface.bounds.max.y, marker.worldPosition.z + 1.25),
    },
    purpose: 'static authored corkscrew control pedestal side-console pad',
    supportBoundaryIds: [...supportBoundaryIds],
    supportFixtureIds: [...supportFixtureIds],
    supportProfile: 'corkscrew-control-pedestal-bearing-v2',
    visualProfile: 'semantic-room-pack-v1:factory:control-pedestal-deck',
    collision: 'static',
    hazardTag: null,
    sourceNodeName: 'ANCHOR_MECHANISM_CONSOLE',
    collisionSourcePolicy: 'explicit-plan-control-pad-contract',
    derivedFromVisibleMeshBounds: false,
    createsLedgeCandidates: false,
    ledgePolicy: 'side-console-pad',
    semanticRoomPackPlacementId: placement.placementId,
  };
}

function removePortalPhysicalRoute(plan, portal) {
  const cellIds = new Set(portal?.physicalRoute?.cellIds ?? []);
  const boundaryIds = new Set(portal?.physicalRoute?.boundaryIds ?? []);
  const surfaceIds = new Set(portal?.physicalRoute?.surfaceIds ?? []);
  plan.spatialCells = plan.spatialCells.filter(({ id }) => !cellIds.has(id));
  plan.structuralBoundaries = plan.structuralBoundaries.filter(({ id, cellId }) => !boundaryIds.has(id) && !cellIds.has(cellId));
  plan.walkableSurfaces = plan.walkableSurfaces.filter(({ id, cellId }) => !surfaceIds.has(id) && !cellIds.has(cellId));
  plan.structuralFixtures = plan.structuralFixtures.filter(({ cellId }) => !cellIds.has(cellId));
  plan.traversalLinks = plan.traversalLinks.filter((link) => (
    link.portalId !== portal.id
      && link.proofPortalId !== portal.id
      && !surfaceIds.has(link.fromSurfaceId)
      && !surfaceIds.has(link.toSurfaceId)
  ));
}

function removeGenericCorkscrewGeometry(plan) {
  const roomCellIds = new Set(plan.spatialCells
    .filter((cell) => cell.id === CELL_ID || cell.compoundId === 'compound.corkscrew')
    .map(({ id }) => id));
  const removedSurfaceIds = new Set(plan.walkableSurfaces
    .filter(({ cellId }) => roomCellIds.has(cellId))
    .map(({ id }) => id));
  plan.spatialCells = plan.spatialCells.filter(({ id }) => !roomCellIds.has(id));
  plan.structuralBoundaries = plan.structuralBoundaries.filter(({ cellId, kind, id }) => (
    !roomCellIds.has(cellId)
      || kind === 'movable-gate-barrier'
      || id === 'Door_Gamma'
      || id === 'Gate_Credential_Loop'
  ));
  plan.walkableSurfaces = plan.walkableSurfaces.filter(({ cellId }) => !roomCellIds.has(cellId));
  plan.structuralFixtures = plan.structuralFixtures.filter(({ cellId }) => !roomCellIds.has(cellId));
  plan.traversalLinks = plan.traversalLinks.filter(({ fromSurfaceId, toSurfaceId, regionId }) => (
    !removedSurfaceIds.has(fromSurfaceId)
      && !removedSurfaceIds.has(toSurfaceId)
      && regionId !== REGION_ID
  ));
  return { roomCellIds, removedSurfaceIds };
}

function removeRedundantNestRoute(plan) {
  const portal = plan.portals.find(({ id }) => id === REMOVED_REDUNDANT_PORTAL_ID);
  if (!portal) throw new Error(`Factory replacement requires ${REMOVED_REDUNDANT_PORTAL_ID}.`);
  removePortalPhysicalRoute(plan, portal);
  plan.portals = plan.portals.filter(({ id }) => id !== portal.id);
  plan.connectionOrder = (plan.connectionOrder ?? []).filter((id) => id !== portal.id);
  if (Array.isArray(plan.progression?.connections)) {
    plan.progression.connections = plan.progression.connections.filter(({ id }) => id !== portal.id);
  }
  if (Array.isArray(plan.minimap?.connections)) {
    plan.minimap.connections = plan.minimap.connections.filter(({ id, portalId }) => id !== portal.id && portalId !== portal.id);
  }
}

function endpointForSocket(previous, socket, boundaryId) {
  const side = sideFromForward(socket.worldForward);
  return {
    ...previous,
    regionId: REGION_ID,
    cellId: CELL_ID,
    boundaryId,
    side,
    center: vector(socket.worldPosition.x, socket.worldPosition.y + socket.aperture.height * 0.5, socket.worldPosition.z),
    elevation: socket.worldPosition.y,
    placementBucket: `authored-socket-${socket.id}`,
    dimensions: { width: socket.aperture.width, height: socket.aperture.height, depth: 1.2 },
  };
}

function updateGateBarrier(plan, portal, socket) {
  if (!portal.barrierId) return;
  const barrier = plan.structuralBoundaries.find(({ id }) => id === portal.barrierId);
  if (!barrier) throw new Error(`${portal.id} lacks barrier ${portal.barrierId}.`);
  const side = sideFromForward(socket.worldForward);
  const halfWidth = socket.aperture.width * 0.5;
  const depth = 0.6;
  const p = socket.worldPosition;
  barrier.cellId = CELL_ID;
  barrier.regionId = REGION_ID;
  barrier.side = side;
  if (side === 'east' || side === 'west') {
    barrier.bounds = {
      min: vector(p.x - depth, p.y, p.z - halfWidth),
      max: vector(p.x + depth, p.y + socket.aperture.height, p.z + halfWidth),
    };
  } else {
    barrier.bounds = {
      min: vector(p.x - halfWidth, p.y, p.z - depth),
      max: vector(p.x + halfWidth, p.y + socket.aperture.height, p.z + depth),
    };
  }
  barrier.blocksPortalId = portal.id;
  barrier.portalId = portal.id;
}

function rehomeGateInteraction(plan, portal, socket, landingSurface, packFloorBoundaryId) {
  const actionId = portal.barrierId === 'Door_Gamma' ? 'action.open.door-gamma' : 'action.open.credential-loop';
  const anchorId = portal.barrierId === 'Door_Gamma' ? 'anchor.gate.gamma' : 'anchor.shortcut.credential-loop';
  const fixtureId = `fixture.interaction.${actionId.replace(/^action\./u, '')}`;
  const outward = socket.worldForward;
  const basePosition = vector(
    socket.worldPosition.x - outward.x * 1.8,
    landingSurface.bounds.max.y,
    socket.worldPosition.z - outward.z * 1.8,
  );
  const lateralAxis = Math.abs(outward.x) > 0.5 ? 'z' : 'x';
  const lateralDirection = 1;
  const position = {
    ...basePosition,
    [lateralAxis]: round(socket.worldPosition[lateralAxis] + lateralDirection * (socket.aperture.width * 0.5 + 1.25)),
  };
  const padId = `surface.console-pad.${actionId.replace(/^action\./u, '')}`;
  const padBounds = {
    min: vector(position.x - 0.8, landingSurface.bounds.max.y - 0.3, position.z - 0.8),
    max: vector(position.x + 0.8, landingSurface.bounds.max.y, position.z + 0.8),
  };
  plan.walkableSurfaces = plan.walkableSurfaces.filter(({ id }) => id !== padId);
  plan.walkableSurfaces.push({
    id: padId,
    regionId: REGION_ID,
    cellId: CELL_ID,
    bounds: padBounds,
    purpose: `${portal.barrierId} static authored side-console pad`,
    supportBoundaryIds: [packFloorBoundaryId],
    supportFixtureIds: [],
    supportProfile: 'braced-side-console-pedestal-v2',
    visualProfile: 'semantic-room-pack-v1:factory:gate-side-console-pad',
    collision: 'static',
    hazardTag: null,
    createsLedgeCandidates: false,
    ledgePolicy: 'gate-side-console-pad',
    semanticRoomPackPlacementId: PLACEMENT_ID,
  });
  const anchor = plan.anchors.find(({ id }) => id === anchorId);
  const action = plan.actions.find(({ id }) => id === actionId);
  if (!anchor || !action) throw new Error(`${portal.id} lacks its gate action/anchor contract.`);
  Object.assign(anchor, {
    regionId: REGION_ID,
    position,
    forward: vector(
      socket.worldPosition.x - position.x,
      0,
      socket.worldPosition.z - position.z,
    ),
    surfaceId: padId,
    safeSurfaceId: padId,
    approachSurfaceId: landingSurface.id,
  });
  action.interaction = { ...(action.interaction ?? {}), activationSide: 'either' };
  action.visualFixtureIds = [fixtureId];
  action.colliderIds = [fixtureId];
  plan.structuralFixtures = plan.structuralFixtures.filter(({ id }) => id !== fixtureId);
  const bounds = {
    min: vector(position.x - 0.45, position.y, position.z - 0.35),
    max: vector(position.x + 0.45, position.y + 1.4, position.z + 0.35),
  };
  plan.structuralFixtures.push({
    id: fixtureId,
    type: 'interaction-console',
    subtype: 'control-console-terminal',
    regionId: REGION_ID,
    cellId: CELL_ID,
    bounds,
    materialProfileId: 'interaction-console-v2',
    visualProfile: 'interaction:control-console-terminal',
    collision: 'blocking',
    supportBoundaryIds: [packFloorBoundaryId],
    gameplayPurpose: `${portal.barrierId} reachable side console`,
    actionId,
    visualId: `visual.${fixtureId}`,
    visualIds: [`visual.${fixtureId}`],
    colliderIds: [`collider.${fixtureId}.0`],
    colliderBounds: [clonePlanData(bounds)],
  });
}

function updateGearActionPhysicalRefs(plan, placement, controlSurface) {
  const consoleFixture = placement.structuralFixtures.find(({ sourceNodeName }) => sourceNodeName === 'MECH_CONTROL_PEDESTAL');
  const marker = placement.semanticMarkers.find(({ sourceNodeName }) => sourceNodeName === 'ANCHOR_MECHANISM_CONSOLE');
  if (!consoleFixture || !marker) throw new Error('Factory replacement lacks its authored control pedestal contract.');
  const bindings = [
    { actionId: 'action.gear.align-low', anchorId: 'anchor.gear.low', stateId: 'south_entry' },
    { actionId: 'action.gear.align-bridge', anchorId: 'anchor.gear.bridge', stateId: 'east_mid' },
    { actionId: 'action.gear.align-north-high', anchorId: 'anchor.gear.north-high', stateId: 'north_high' },
    { actionId: 'action.gear.align-high', anchorId: 'anchor.gear.high', stateId: 'west_top' },
  ];
  for (const binding of bindings) {
    let anchor = plan.anchors.find(({ id }) => id === binding.anchorId);
    if (!anchor) {
      anchor = { id: binding.anchorId };
      plan.anchors.push(anchor);
    }
    Object.assign(anchor, {
      regionId: REGION_ID,
      position: clonePlanData(marker.worldPosition),
      purpose: `authored Corkscrew command for ${binding.stateId}`,
      surfaceId: controlSurface.id,
      safeSurfaceId: controlSurface.id,
      approachSurfaceId: controlSurface.id,
      sourceNodeName: marker.sourceNodeName,
      sourceSemanticAnchorId: marker.id,
    });
    let action = plan.actions.find(({ id }) => id === binding.actionId);
    if (!action) {
      action = { id: binding.actionId };
      plan.actions.push(action);
    }
    Object.assign(action, {
      type: 'mechanism-control',
      anchorId: binding.anchorId,
      interaction: { radius: 2.2, activationSide: 'either', requiresLineOfSight: false },
      conditions: [],
      effects: [{ op: 'setMechanismState', mechanismId: 'mechanism.corkscrew-gear', stateId: binding.stateId }],
      barrierIds: [],
      controllerId: 'mechanism.corkscrew-gear',
      semanticRoomPackStateId: binding.stateId,
      visualFixtureIds: [consoleFixture.id],
      colliderIds: [consoleFixture.id],
    });
  }
}

function rewriteCorkscrewStateReferences(value, authoredStateVariableId) {
  if (Array.isArray(value)) return value.map((entry) => rewriteCorkscrewStateReferences(entry, authoredStateVariableId));
  if (!value || typeof value !== 'object') return value;
  const next = Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    rewriteCorkscrewStateReferences(entry, authoredStateVariableId),
  ]));
  const aliases = { LowLanding: 'south_entry', BridgeAligned: 'east_mid', HighLanding: 'west_top' };
  if (next.op === 'stateEquals') {
    if (next.variableId === authoredStateVariableId) next.variableId = 'mechanism.corkscrew-gear.state';
    if (next.variableId === 'mechanism.corkscrew-gear.state') next.value = aliases[next.value] ?? next.value;
  }
  if (next.op === 'setMechanismState' && next.mechanismId === 'mechanism.corkscrew-gear') {
    next.stateId = aliases[next.stateId] ?? next.stateId;
  }
  return next;
}

function replaceModulePlacement(plan, placement, connectorCellIds) {
  const index = plan.modulePlacements.findIndex(({ id }) => id === HOST_MODULE_PLACEMENT_ID);
  if (index < 0) throw new Error(`Factory replacement requires ${HOST_MODULE_PLACEMENT_ID}.`);
  plan.modulePlacements[index] = {
    id: PLACEMENT_ID,
    placementId: PLACEMENT_ID,
    descriptorId: `semantic-room-pack-v1.${ROOM_ID}`,
    descriptorRevision: placement.packRevision,
    roomId: ROOM_ID,
    packId: placement.packId,
    packRevision: placement.packRevision,
    semanticRoomPackPlacementId: placement.placementId,
    regionIds: [REGION_ID],
    translation: clonePlanData(placement.placementTransform.translation),
    yawQuarterTurns: placement.placementTransform.yawQuarterTurns,
    bounds: clonePlanData(placement.worldBounds),
    topologySignature: `semantic-room-pack-v1:${ROOM_ID}:${placement.topologyVariant}`,
    occupiedCellIds: [CELL_ID, ...connectorCellIds],
    collisionSourcePolicy: placement.collisionSourcePolicy,
    socketBindings: clonePlanData(placement.socketBindings),
    boundPortalIds: clonePlanData(placement.boundPortalIds),
    connectorCellIds: [...connectorCellIds],
    runtimeContractBindings: clonePlanData(placement.runtimeContractBindings),
    fullyIntegrated: true,
    placedRecordIds: clonePlanData(placement.placedRecordIds),
    nativeIntegrationStatus: 'factory-corkscrew-macro-cell-replaced',
  };
}

function assertUniqueIds(plan) {
  for (const name of ['modulePlacements', 'spatialCells', 'structuralBoundaries', 'walkableSurfaces', 'structuralFixtures', 'portals', 'traversalLinks']) {
    const ids = plan[name].map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      const id = ids.find((entry, index) => ids.indexOf(entry) !== index);
      throw new Error(`Factory replacement duplicated ${name} ID ${id}.`);
    }
  }
}

function compileReplacement(plan) {
  const hostCell = plan.spatialCells.find(({ id }) => id === CELL_ID);
  if (!hostCell) throw new Error(`Factory replacement requires ${CELL_ID}.`);
  const center = vector(
    (hostCell.bounds.min.x + hostCell.bounds.max.x) * 0.5,
    hostCell.bounds.min.y,
    (hostCell.bounds.min.z + hostCell.bounds.max.z) * 0.5,
  );
  const compiled = compileSemanticRoomPackPlacementV2(ROOM_ID, {
    placementId: PLACEMENT_ID,
    entrySocketId: 'entry_south',
    targetPortal: {
      id: 'portal.parts-corkscrew-service',
      position: vector(center.x, center.y + 0.2, center.z - 17),
      forward: { x: 0, y: 0, z: -1 },
      connectorType: 'factory_door',
    },
    yawQuarterTurns: 2,
  });
  const expectedSocketPositions = Object.fromEntries(FACTORY_CORKSCREW_SOCKET_ROUTE_BINDINGS_V2.map((route) => [
    route.socketId,
    plan.portals.find(({ id }) => id === route.portalId)?.from?.regionId === REGION_ID
      ? route.routePoints[0]
      : route.routePoints.at(-1),
  ]));
  for (const socket of compiled.sockets) {
    if (!samePoint(socket.worldPosition, expectedSocketPositions[socket.id])) {
      throw new Error(`Factory socket route ${socket.id} drifted from its named transform.`);
    }
  }
  return compiled;
}

function assertInputPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new TypeError('Factory macro replacement requires a DungeonPlanV2 object.');
  for (const name of ['regions', 'modulePlacements', 'spatialCells', 'structuralBoundaries', 'walkableSurfaces', 'structuralFixtures', 'portals', 'traversalLinks']) {
    if (!Array.isArray(plan[name])) throw new TypeError(`Factory macro replacement requires plan.${name}.`);
  }
  if (plan.fixtureKind !== 'golden-complex' || !plan.regions.some(({ id }) => id === REGION_ID)) {
    throw new Error('Factory macro replacement only accepts the Golden complex with a Corkscrew region.');
  }
  if ((plan.semanticRoomPackPlacements ?? []).some(({ roomId }) => roomId === ROOM_ID)) {
    throw new Error('Factory Corkscrew semantic room is already present.');
  }
}

function applyReplacement(candidate) {
  assertInputPlan(candidate);
  const compiled = compileReplacement(candidate);
  const descriptor = getSemanticRoomPackV1Descriptor(ROOM_ID);
  const affectedPortalIds = new Set([
    ...FACTORY_CORKSCREW_SOCKET_ROUTE_BINDINGS_V2.map(({ portalId }) => portalId),
    REMOVED_REDUNDANT_PORTAL_ID,
  ]);
  const originalPortals = new Map(candidate.portals
    .filter(({ id }) => affectedPortalIds.has(id))
    .map((portal) => [portal.id, clonePlanData(portal)]));
  if (originalPortals.size !== affectedPortalIds.size) {
    throw new Error('Factory replacement cannot resolve every required existing Golden portal.');
  }
  for (const route of FACTORY_CORKSCREW_SOCKET_ROUTE_BINDINGS_V2) {
    const portal = originalPortals.get(route.portalId);
    if (portal.barrierId !== route.expectedBarrierId) {
      throw new Error(`${route.portalId} barrier drift would create a progression bypass.`);
    }
  }

  for (const portal of originalPortals.values()) removePortalPhysicalRoute(candidate, portal);
  removeGenericCorkscrewGeometry(candidate);
  removeRedundantNestRoute(candidate);

  const manifestBoundaries = compiled.structuralBoundaries.map((record) => enrichBoundary(compiled, record));
  const floorBoundaryIds = manifestBoundaries.filter(({ side }) => side === 'floor').map(({ id }) => id);
  if (!floorBoundaryIds.length) throw new Error('Factory replacement lacks a manifest-derived floor shell.');
  const fixtures = compiled.structuralFixtures.map((record) => enrichFixture(compiled, record, floorBoundaryIds));
  const surfaces = compiled.walkableSurfaces.map((record) => enrichSurface(compiled, descriptor, record, floorBoundaryIds, fixtures));
  const mechanismSupportIds = fixtures.filter(({ semantic }) => semantic === 'mechanismSupport').map(({ id }) => id);
  const dynamicSurface = createDynamicGearSurface(compiled, floorBoundaryIds, mechanismSupportIds);
  surfaces.push(dynamicSurface);
  const southBridgeSurface = packSurfaceByNode(surfaces, 'MECH_BRIDGE_SOUTH');
  const controlSurface = createGearControlPad(compiled, southBridgeSurface, floorBoundaryIds, mechanismSupportIds);
  surfaces.push(controlSurface);
  const socketFrames = bindSocketFrames(compiled, manifestBoundaries);
  const boundaryBySocketId = socketFrames.boundaryBySocketId;

  candidate.spatialCells.push({
    id: CELL_ID,
    regionId: REGION_ID,
    bounds: clonePlanData(compiled.worldBounds),
    playable: true,
    interior: true,
    cameraContained: true,
    occupiedVolume: true,
    compoundId: COMPOUND_ID,
    compoundShell: true,
    semanticRoomPackPlacementId: compiled.placementId,
  });
  candidate.structuralBoundaries.push(...manifestBoundaries, ...socketFrames.kitBoundaries);
  candidate.walkableSurfaces.push(...surfaces);
  candidate.structuralFixtures.push(...fixtures);

  const socketById = new Map(compiled.sockets.map((socket) => [socket.id, socket]));
  const connectorCellIds = [];
  const connectorBoundaryIds = [];
  const connectorSurfaceIds = [];
  const boundPortalIds = [];
  for (const route of FACTORY_CORKSCREW_SOCKET_ROUTE_BINDINGS_V2) {
    const portalIndex = candidate.portals.findIndex(({ id }) => id === route.portalId);
    const original = originalPortals.get(route.portalId);
    if (portalIndex < 0 || !original) throw new Error(`Factory replacement lost ${route.portalId}.`);
    const socket = socketById.get(route.socketId);
    const landingNode = ({
      entry_south: 'WALK_ENTRY_APRON',
      exit_east_mid: 'WALK_EAST_MID_LEDGE',
      exit_north_high: 'WALK_NORTH_HIGH_LEDGE',
      exit_west_top: 'WALK_WEST_TOP_LEDGE',
    })[route.socketId];
    const landingSurface = packSurfaceByNode(surfaces, landingNode);
    const nextPortal = clonePlanData(original);
    if (nextPortal.from.regionId === REGION_ID) {
      nextPortal.from = endpointForSocket(nextPortal.from, socket, boundaryBySocketId[socket.id]);
    } else {
      nextPortal.to = endpointForSocket(nextPortal.to, socket, boundaryBySocketId[socket.id]);
    }
    if (nextPortal.id === 'portal.corkscrew-hazard-intake') {
      // The aperture itself is permanently open; the authored internal
      // platform-to-ledge traversal owns the north_high condition. Duplicating
      // that condition on the region portal makes the symbolic region solver
      // treat the mechanism action as impossible even though the physical
      // surface graph correctly gates access.
      nextPortal.conditions = [];
      nextPortal.mechanismId = 'mechanism.corkscrew-gear';
      nextPortal.physicalAccessCondition = {
        op: 'stateEquals',
        variableId: 'mechanism.corkscrew-gear.state',
        value: 'north_high',
        owner: 'authored-internal-traversal-link',
      };
    }
    const rebuilt = buildConnectorRoute(nextPortal, route, socket, landingSurface.id);
    if (route.socketId === 'entry_south') {
      const socketDeck = rebuilt.surfaces.at(-1);
      socketDeck.bounds.max.z = landingSurface.bounds.min.z;
      socketDeck.bounds.max.y = landingSurface.bounds.max.y;
    }
    nextPortal.physicalRoute = {
      ...nextPortal.physicalRoute,
      authored: true,
      enclosed: true,
      continuous: true,
      supported: true,
      cellIds: rebuilt.cells.map(({ id }) => id),
      boundaryIds: rebuilt.boundaries.map(({ id }) => id),
      surfaceIds: rebuilt.surfaces.map(({ id }) => id),
      endpointSurfaceIds: nextPortal.from.regionId === REGION_ID
        ? { from: landingSurface.id, to: rebuilt.remoteSurfaceId }
        : { from: rebuilt.remoteSurfaceId, to: landingSurface.id },
      routePoints: clonePlanData(rebuilt.points),
      replacementPolicy: 'existing-golden-route-rebuilt-to-authored-socket',
    };
    nextPortal.authoredRoute = { mode: 'macro-cell-replacement', detour: null };
    candidate.portals[portalIndex] = nextPortal;
    candidate.spatialCells.push(...rebuilt.cells);
    candidate.structuralBoundaries.push(...rebuilt.boundaries);
    candidate.walkableSurfaces.push(...rebuilt.surfaces);
    candidate.traversalLinks.push(...rebuilt.traversalLinks);
    connectorCellIds.push(...rebuilt.cells.map(({ id }) => id));
    connectorBoundaryIds.push(...rebuilt.boundaries.map(({ id }) => id));
    connectorSurfaceIds.push(...rebuilt.surfaces.map(({ id }) => id));
    boundPortalIds.push(nextPortal.id);
    updateGateBarrier(candidate, nextPortal, socket);
    if (nextPortal.barrierId) rehomeGateInteraction(candidate, nextPortal, socket, landingSurface, floorBoundaryIds[0]);
  }
  candidate.traversalLinks.push(...createInternalTraversalLinks(compiled, surfaces, dynamicSurface));

  const placement = deepFreezePlan({
    ...compiled,
    factoryMacroReplacementRevision: SEMANTIC_ROOM_PACK_FACTORY_MACRO_REPLACEMENT_V2_REVISION,
    goldenRegionId: REGION_ID,
    goldenCellId: CELL_ID,
    socketBindings: socketFrames.bindings,
    boundPortalIds,
    connectorCellIds,
    connectorBoundaryIds,
    connectorSurfaceIds,
    structuralKitBoundaryIds: socketFrames.kitBoundaries.map(({ id }) => id),
    auxiliaryRuntimeSurfaceIds: [dynamicSurface.id],
    runtimeContractBindings: {
      corkscrew: {
        mechanismId: 'mechanism.corkscrew-gear',
        dynamicSurfaceId: dynamicSurface.id,
        controlSurfaceId: controlSurface.id,
        sourceNodeName: 'MECH_GEAR_PLATFORM',
        controlSourceNodeName: 'ANCHOR_MECHANISM_CONSOLE',
        stableStateSocketBindings: [
          { stateId: 'south_entry', socketId: 'entry_south', landingSurfaceId: packSurfaceByNode(surfaces, 'WALK_ENTRY_APRON').id, bridgeSurfaceId: packSurfaceByNode(surfaces, 'MECH_BRIDGE_SOUTH').id },
          { stateId: 'east_mid', socketId: 'exit_east_mid', landingSurfaceId: packSurfaceByNode(surfaces, 'WALK_EAST_MID_LEDGE').id, bridgeSurfaceId: packSurfaceByNode(surfaces, 'MECH_BRIDGE_EAST').id },
          { stateId: 'north_high', socketId: 'exit_north_high', landingSurfaceId: packSurfaceByNode(surfaces, 'WALK_NORTH_HIGH_LEDGE').id, bridgeSurfaceId: packSurfaceByNode(surfaces, 'MECH_BRIDGE_NORTH').id },
          { stateId: 'west_top', socketId: 'exit_west_top', landingSurfaceId: packSurfaceByNode(surfaces, 'WALK_WEST_TOP_LEDGE').id, bridgeSurfaceId: packSurfaceByNode(surfaces, 'MECH_BRIDGE_WEST').id },
        ],
      },
    },
    fullyIntegrated: true,
    structuralBoundaries: manifestBoundaries,
    walkableSurfaces: surfaces,
    structuralFixtures: fixtures,
  });
  candidate.semanticRoomPackPlacements ??= [];
  candidate.semanticRoomPackPlacements.push(placement);
  updateGearActionPhysicalRefs(candidate, placement, controlSurface);
  const globalMechanism = candidate.mechanisms.find(({ id }) => id === 'mechanism.corkscrew-gear');
  if (!globalMechanism) throw new Error('Factory replacement requires mechanism.corkscrew-gear.');
  const authoredMechanism = placement.mechanisms.find(({ localId }) => localId === 'corkscrew_exchange');
  const platformMarker = placement.semanticMarkers.find(({ sourceNodeName }) => sourceNodeName === 'MECH_GEAR_PLATFORM');
  if (!authoredMechanism || !platformMarker) throw new Error('Factory replacement lacks exact authored Corkscrew states.');
  globalMechanism.initialStateId = 'south_entry';
  globalMechanism.anchorId = 'anchor.gear.bridge';
  globalMechanism.recallable = true;
  globalMechanism.automaticTravel = false;
  globalMechanism.states = authoredMechanism.stableStates.map((state) => ({
    id: state.localId,
    stable: true,
    elevation: state.worldHeight,
    position: vector(platformMarker.worldPosition.x, state.worldHeight, platformMarker.worldPosition.z),
    yawDegrees: state.worldYawDegrees,
    deployedBridge: state.deployedBridge,
    dynamicSurfaceId: dynamicSurface.id,
  }));
  const mechanismActionBindings = [
    ['south_entry', 'action.gear.align-low'],
    ['east_mid', 'action.gear.align-bridge'],
    ['north_high', 'action.gear.align-north-high'],
    ['west_top', 'action.gear.align-high'],
  ];
  globalMechanism.transitions = mechanismActionBindings.map(([toStateId, actionId]) => ({
    fromStateId: '*',
    toStateId,
    actionId,
    trigger: 'authored-console-command',
    automatic: false,
    legal: true,
  }));
  globalMechanism.actionIds = mechanismActionBindings.map(([, actionId]) => actionId);
  globalMechanism.runtimeProfile = {
    ...(globalMechanism.runtimeProfile ?? {}),
    dynamicSurfaceId: dynamicSurface.id,
    collisionAuthority: 'plan-owned-semantic-room-pack-surface',
    sourceNodeName: 'MECH_GEAR_PLATFORM',
    stableStateOrder: authoredMechanism.stableStates.map(({ localId }) => localId),
    controlsAreAutomatic: false,
  };
  globalMechanism.legacyStateAliases = { LowLanding: 'south_entry', BridgeAligned: 'east_mid', HighLanding: 'west_top' };
  const authoredStateVariableId = authoredMechanism.stateVariableId;
  candidate.portals = rewriteCorkscrewStateReferences(candidate.portals, authoredStateVariableId);
  candidate.traversalLinks = rewriteCorkscrewStateReferences(candidate.traversalLinks, authoredStateVariableId);
  candidate.actions = rewriteCorkscrewStateReferences(candidate.actions, authoredStateVariableId);
  replaceModulePlacement(candidate, placement, connectorCellIds);

  const region = candidate.regions.find(({ id }) => id === REGION_ID);
  region.bounds = {
    min: vector(
      Math.min(region.bounds.min.x, compiled.worldBounds.min.x),
      Math.min(region.bounds.min.y, compiled.worldBounds.min.y),
      Math.min(region.bounds.min.z, compiled.worldBounds.min.z),
    ),
    max: vector(
      Math.max(region.bounds.max.x, compiled.worldBounds.max.x),
      Math.max(region.bounds.max.y, compiled.worldBounds.max.y),
      Math.max(region.bounds.max.z, compiled.worldBounds.max.z),
    ),
  };
  const minimapRegion = candidate.minimap?.regions?.find(({ id }) => id === REGION_ID);
  if (minimapRegion) minimapRegion.bounds = clonePlanData(region.bounds);
  candidate.semanticRoomPackFactoryReplacement = {
    revision: SEMANTIC_ROOM_PACK_FACTORY_MACRO_REPLACEMENT_V2_REVISION,
    placementId: placement.placementId,
    roomId: placement.roomId,
    replacedCellId: CELL_ID,
    removedPortalIds: [REMOVED_REDUNDANT_PORTAL_ID],
    boundPortalIds,
    connectorCellIds,
    genericCorkscrewGeometryRetained: false,
    collisionSourcePolicy: 'manifest-collision-volumes-only-plus-explicit-dynamic-platform-and-enclosed-connector-kit',
    progressionBypassAllowed: false,
    fullyIntegrated: true,
  };
  const signatures = deriveDungeonTopologySignaturesV2(candidate);
  for (const regionRecord of candidate.regions) regionRecord.topologySignature = signatures[regionRecord.id];
  for (const modulePlacement of candidate.modulePlacements) {
    const regionId = modulePlacement.regionIds?.[0];
    if (regionId && signatures[regionId]) modulePlacement.topologySignature = signatures[regionId];
  }
  assertUniqueIds(candidate);
  return { candidate, placement };
}

function replacementAudit(plan, placement) {
  const errors = [];
  const error = (code, message, details = {}) => errors.push(createPlanDiagnostic(code, message, details));
  const placementValidation = validateSemanticRoomPackPlacementV2(placement);
  errors.push(...placementValidation.errors);
  if (!isSerializablePlanValue(plan)) error('factory-macro-replacement-not-serializable', 'Factory replacement produced non-serializable plan data.');
  if (plan.spatialCells.filter(({ id }) => id === CELL_ID).length !== 1) error('factory-macro-replacement-cell-count', 'Factory replacement must own exactly one Corkscrew main cell.');
  if (plan.portals.some(({ id }) => id === REMOVED_REDUNDANT_PORTAL_ID)) error('factory-macro-redundant-nest-route-retained', 'Redundant Nest -> Corkscrew portal was not removed.');
  const bindingBySocket = new Map(placement.socketBindings.map((entry) => [entry.socketId, entry]));
  for (const route of FACTORY_CORKSCREW_SOCKET_ROUTE_BINDINGS_V2) {
    const binding = bindingBySocket.get(route.socketId);
    const portal = plan.portals.find(({ id }) => id === route.portalId);
    if (!binding || binding.portalId !== route.portalId || binding.status !== 'bound' || !portal) {
      error('factory-macro-socket-route-unbound', `${route.socketId} is not bound to ${route.portalId}.`, { route });
      continue;
    }
    if (portal.barrierId !== route.expectedBarrierId) {
      error('factory-macro-gate-bypass', `${route.portalId} lost its exact gate contract.`, { expectedBarrierId: route.expectedBarrierId, actualBarrierId: portal.barrierId });
    }
    const socket = placement.sockets.find(({ id }) => id === route.socketId);
    const endpoint = portal.from.regionId === REGION_ID ? portal.from : portal.to;
    if (!samePoint(endpoint.center, {
      x: socket.worldPosition.x,
      y: socket.worldPosition.y + socket.aperture.height * 0.5,
      z: socket.worldPosition.z,
    }) || endpoint.boundaryId !== binding.boundaryId) {
      error('factory-macro-portal-socket-drift', `${route.portalId} does not terminate on its authored socket.`, { portalId: route.portalId, socketId: route.socketId });
    }
  }
  const genericRecords = [
    ...plan.spatialCells,
    ...plan.structuralBoundaries,
    ...plan.walkableSurfaces,
    ...plan.structuralFixtures,
  ].filter((record) => record.regionId === REGION_ID
    && record.cellId === CELL_ID
    && record.semanticRoomPackPlacementId !== PLACEMENT_ID
    && !['Door_Gamma', 'Gate_Credential_Loop'].includes(record.id)
    && !String(record.id).startsWith('fixture.interaction.'));
  if (genericRecords.length) {
    error('factory-macro-generic-geometry-retained', 'Generic Corkscrew room geometry survived the authored macro replacement.', { ids: genericRecords.map(({ id }) => id) });
  }
  const sorted = sortPlanDiagnostics(errors);
  return {
    accepted: sorted.length === 0,
    errors: sorted,
    diagnosticHash: hashPlanDiagnostics(sorted),
  };
}

export function prepareFactoryCorkscrewMacroReplacementV2(sourcePlan, options = {}) {
  let candidate = null;
  let placement = null;
  const errors = [];
  try {
    const result = applyReplacement(clonePlanData(sourcePlan));
    candidate = result.candidate;
    placement = result.placement;
    const audit = replacementAudit(candidate, placement);
    errors.push(...audit.errors);
  } catch (cause) {
    errors.push(createPlanDiagnostic(
      'factory-macro-replacement-failed-closed',
      cause?.message ?? 'Factory macro replacement failed.',
      { name: cause?.name ?? 'Error' },
    ));
  }
  const replacementErrors = sortPlanDiagnostics(errors);
  const dungeonValidation = candidate && replacementErrors.length === 0 && options.validateDungeon !== false
    ? validateDungeonPlanV2(candidate, {
      ...(options.validatorOptions ?? {}),
      allowIncompleteGoldenComposition: true,
    })
    : null;
  return {
    accepted: replacementErrors.length === 0,
    productionAccepted: replacementErrors.length === 0
      && (options.validateDungeon === false || dungeonValidation?.accepted === true),
    plan: candidate,
    placement,
    errors: replacementErrors,
    diagnosticHash: hashPlanDiagnostics(replacementErrors),
    dungeonValidation,
  };
}

export class FactoryCorkscrewMacroReplacementErrorV2 extends Error {
  constructor(result) {
    const first = result.errors?.[0] ?? result.dungeonValidation?.errors?.[0];
    super(first
      ? `Factory Corkscrew macro replacement rejected: ${first.code}: ${first.message}`
      : 'Factory Corkscrew macro replacement rejected.');
    this.name = 'FactoryCorkscrewMacroReplacementErrorV2';
    this.code = 'FACTORY_CORKSCREW_MACRO_REPLACEMENT_INVALID';
    this.result = result;
  }
}

/**
 * Atomic public mutator. The source plan is untouched until the replacement
 * audit succeeds. Production callers also require whole-plan acceptance; a
 * staged caller may set requireDungeonAcceptance=false, apply the combined
 * state bridge, and then run the validator before freezing the plan.
 */
export function integrateFactoryCorkscrewMacroReplacementV2(plan, options = {}) {
  const result = prepareFactoryCorkscrewMacroReplacementV2(plan, options);
  const requireDungeonAcceptance = options.requireDungeonAcceptance !== false;
  if (!result.accepted || (requireDungeonAcceptance && !result.productionAccepted)) {
    throw new FactoryCorkscrewMacroReplacementErrorV2(result);
  }
  for (const key of Object.keys(plan)) delete plan[key];
  Object.assign(plan, clonePlanData(result.plan));
  return plan;
}

export default integrateFactoryCorkscrewMacroReplacementV2;
