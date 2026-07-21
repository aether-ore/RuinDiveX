import {
  clonePlanData,
  deepFreezePlan,
} from './DungeonPlanV2Contract.js';

// This is a data transcription of the working V1 room kit. It deliberately
// does not import DungeonGenerator or THREE. V2 may rearrange these authored
// rooms, but it must preserve their floor topology, reserved fixture volumes,
// and stable extension sockets instead of replacing them with generic boxes.

export const LEGACY_FIXED_ROOM_MODULE_CATALOG_REVISION_V2 = 3;

export const LEGACY_FIXED_ROOM_TILE_SIZE_V2 = 2.8;

const TILE_SIZE = LEGACY_FIXED_ROOM_TILE_SIZE_V2;
const FACTORY_ELEVATION = 1.05;
const LOWER_SERVICE_ELEVATION = -1.35;
const MINOR_DROP_ELEVATION = -4.8;
const SECOND_FLOOR_ELEVATION = 4.05;
const THIRD_FLOOR_ELEVATION = 7.25;
// The source Shrine stacked its 4.05m mezzanine directly over a 1.05m
// perimeter catwalk. V2 keeps the working upper route and its flush connector
// elevation, but lowers only that overlapping lower catwalk enough to retain
// the exact thin deck/underbeam frame with at least 3.2m player headroom.
const SHRINE_LOWER_CATWALK_ELEVATION = 0.63;
const JUMP_PLATFORM_ELEVATION = 1.35;
const WALL_HEIGHT = 15.6;
const FLOOR_THICKNESS = 0.12;
const SHELL_WALL_THICKNESS = 0.22;
const SHELL_CEILING_THICKNESS = 0.12;
const PLAYER_RADIUS = 0.56;
const PLAYER_HEADROOM = 3.2;
const RAMP_HEADROOM_SAMPLE_SPACING = 0.21;

const SOURCE_FILE = 'src/DungeonGenerator.js';

const sourceReference = (symbol, startLine, endLine, purpose) => ({
  file: SOURCE_FILE,
  symbol,
  startLine,
  endLine,
  purpose,
});

const round = (value) => Math.round(value * 10000) / 10000;
const tileColumnKey = (x, z) => `${x},${z}`;
const levelKey = (level) => String(round(level)).replace('-', 'n').replace('.', '_');
const surfaceKey = (x, z, level = 0) => `${tileColumnKey(x, z)}@${levelKey(level)}`;

function rangeOrdered(from, to) {
  const values = [];
  const step = from <= to ? 1 : -1;
  for (let value = from; step > 0 ? value <= to : value >= to; value += step) {
    values.push(value);
  }
  return values;
}

function expandOrthogonalPath(points) {
  const expanded = [];
  const append = (point) => {
    const last = expanded.at(-1);
    if (!last || last.x !== point.x || last.z !== point.z) {
      expanded.push({ x: point.x, z: point.z });
    }
  };

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from.x !== to.x) {
      for (const x of rangeOrdered(from.x, to.x)) {
        append({ x, z: from.z });
      }
    } else {
      append(from);
    }
    if (from.z !== to.z) {
      const zValues = rangeOrdered(from.z, to.z);
      for (const z of zValues.slice(from.x !== to.x ? 1 : 0)) {
        append({ x: to.x, z });
      }
    }
  }
  append(points.at(-1));
  return expanded;
}

function materialForSurface(surface, type) {
  if (surface?.includes('server')) return 'legacy-server-floor';
  if (surface?.includes('coolant')) return 'legacy-coolant-floor';
  if (surface?.includes('shrine') || surface?.includes('refractor') || surface?.includes('revered')) return 'legacy-shrine';
  if (surface?.includes('conveyor') || type === 'conveyor') return 'legacy-conveyor';
  if (surface?.includes('machine') || surface?.includes('raised') || surface?.includes('Deck')) return 'legacy-raised-deck';
  if (surface?.includes('catwalk') || surface?.includes('Catwalk') || surface?.includes('Gantry')) return 'legacy-catwalk';
  if (surface?.includes('basement') || surface?.includes('hazard')) return 'legacy-floor-cracked';
  if (surface?.includes('Pyramid') || surface?.includes('pyramid')) return 'legacy-keycard';
  return 'legacy-floor';
}

function createTopologyBuilder(moduleId, sourceRoomId, type, width, depth, {
  centerType = type,
  catwalkSide = 'west',
  includeV1Catwalk = true,
} = {}) {
  const halfWidthTiles = Math.floor(width / 2);
  const halfDepthTiles = Math.floor(depth / 2);
  const surfaces = new Map();
  const rampHeadroomClearances = new Map();

  const createSurface = (x, z, options = {}) => {
    const level = options.level ?? 0;
    const elevation = options.elevation ?? 0;
    const surface = options.surface ?? options.type ?? 'floor';
    const tileType = options.type ?? 'floor';
    const id = `surface.${moduleId}.${x}.${z}.${levelKey(level)}`;
    return {
      id,
      shape: options.shape ?? 'tile',
      sourceRoomId,
      localTile: { x, z, level: round(level) },
      center: { x: round(x * TILE_SIZE), y: round(elevation), z: round(z * TILE_SIZE) },
      size: { x: TILE_SIZE, y: FLOOR_THICKNESS, z: TILE_SIZE },
      topY: round(elevation),
      type: tileType,
      sourceSurface: surface,
      materialProfileId: options.materialProfileId ?? materialForSurface(surface, tileType),
      collision: {
        mode: 'walkable',
        supportsGroundedTraversal: true,
        ...options.collision,
      },
      support: options.support ?? {
        style: options.supportStyle ?? (Math.abs(elevation) > 0.05 ? 'v1-authored-structural-support' : 'foundation-slab'),
        visible: true,
      },
      purpose: options.purpose ?? 'authored-room-floor',
      ...(options.ramp ? { ramp: options.ramp } : {}),
      ...(options.traversalRoute ? { traversalRoute: options.traversalRoute } : {}),
      ...(options.tags ? { tags: [...options.tags] } : {}),
    };
  };

  const setBase = (x, z, options = {}) => {
    const existing = surfaces.get(surfaceKey(x, z, 0));
    const merged = createSurface(x, z, {
      ...(existing ?? {}),
      ...options,
      level: options.level ?? existing?.localTile?.level ?? 0,
      elevation: options.elevation ?? existing?.topY ?? 0,
      type: options.type ?? existing?.type ?? 'floor',
      surface: options.surface ?? existing?.sourceSurface ?? existing?.type ?? 'floor',
    });
    surfaces.set(surfaceKey(x, z, 0), merged);
    return merged;
  };

  const addSurface = (x, z, options = {}) => {
    const key = surfaceKey(x, z, options.level ?? 0);
    const existing = surfaces.get(key);
    if (existing) {
      return existing;
    }
    const created = createSurface(x, z, options);
    surfaces.set(key, created);
    return created;
  };

  for (let x = -halfWidthTiles; x <= halfWidthTiles; x += 1) {
    for (let z = -halfDepthTiles; z <= halfDepthTiles; z += 1) {
      setBase(x, z, {
        type: x === 0 && z === 0 ? centerType : 'floor',
        surface: x === 0 && z === 0 ? centerType : 'floor',
      });
    }
  }

  const reservedCenterTypes = new Set(['entrance', 'keycard', 'boss', 'shrine']);
  const markCatwalk = (x, z, surface = 'catwalk') => {
    const existing = surfaces.get(surfaceKey(x, z, 0));
    if (!existing || (x === 0 && z === 0 && reservedCenterTypes.has(centerType))) {
      return;
    }
    setBase(x, z, { elevation: FACTORY_ELEVATION, surface });
  };

  if (includeV1Catwalk) {
    if (type === 'conveyor') {
      for (let z = -halfDepthTiles; z <= halfDepthTiles; z += 1) markCatwalk(0, z, 'conveyorBridge');
      for (let x = -1; x <= 1; x += 1) {
        markCatwalk(x, -halfDepthTiles, 'raisedDeck');
        markCatwalk(x, halfDepthTiles, 'raisedDeck');
      }
    } else if (type === 'bonus') {
      for (let x = -halfWidthTiles; x <= halfWidthTiles; x += 1) markCatwalk(x, -halfDepthTiles, 'raisedDeck');
    } else if (type === 'shrine') {
      for (let x = -halfWidthTiles; x <= halfWidthTiles; x += 1) markCatwalk(x, -halfDepthTiles, 'catwalk');
      for (let z = -halfDepthTiles; z <= halfDepthTiles; z += 1) {
        markCatwalk(-halfWidthTiles, z, 'catwalk');
        markCatwalk(halfWidthTiles, z, 'catwalk');
      }
    } else if (type === 'boss') {
      for (let x = -halfWidthTiles; x <= halfWidthTiles; x += 1) {
        markCatwalk(x, -halfDepthTiles, 'raisedDeck');
        markCatwalk(x, halfDepthTiles, 'raisedDeck');
      }
      for (let z = -halfDepthTiles; z <= halfDepthTiles; z += 1) {
        markCatwalk(-halfWidthTiles, z, 'catwalk');
        markCatwalk(halfWidthTiles, z, 'catwalk');
      }
    } else {
      const catwalkX = catwalkSide === 'east' ? halfWidthTiles : -halfWidthTiles;
      for (let z = -halfDepthTiles; z <= halfDepthTiles; z += 1) markCatwalk(catwalkX, z, 'catwalk');
      for (let x = -halfWidthTiles; x <= halfWidthTiles; x += 1) markCatwalk(x, -halfDepthTiles, 'catwalk');
    }
  }

  const markBaseRect = ({ minX, maxX, minZ, maxZ, ...options }) => {
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) setBase(x, z, options);
    }
  };

  const addDeck = ({ minX, maxX, minZ, maxZ, ring = false, ...options }) => {
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        if (ring && x > minX && x < maxX && z > minZ && z < maxZ) continue;
        addSurface(x, z, options);
      }
    }
  };

  const addRamp = (points, fromElevation, toElevation, fromLevel, toLevel, routeId) => {
    if (rampHeadroomClearances.has(routeId)) {
      throw new Error(`${moduleId} repeats ramp headroom route ${routeId}.`);
    }
    const clearanceId = `ramp-headroom.${routeId}`;
    rampHeadroomClearances.set(routeId, {
      id: clearanceId,
      routeId,
      minimumHeadroom: PLAYER_HEADROOM,
      sampleSpacing: RAMP_HEADROOM_SAMPLE_SPACING,
      overheadSurfacePolicy: 'remove-or-split-plan-owned-visual-and-collider',
      enclosurePolicy: 'retain-opaque-colliding-module-ceiling',
      removedOverheadSurfaces: [],
      lowerLandingSurfaceId: null,
      upperLandingSurfaceId: null,
    });
    const path = expandOrthogonalPath(points);
    const span = path.length - 1;
    const useBase = fromLevel === 0 || toLevel === 0;
    const directionBetween = (from, to) => ({
      x: Math.sign((to?.x ?? from.x) - from.x),
      z: Math.sign((to?.z ?? from.z) - from.z),
    });
    const isTurn = (index) => {
      if (index <= 0 || index >= path.length - 1) return false;
      const incoming = directionBetween(path[index - 1], path[index]);
      const outgoing = directionBetween(path[index], path[index + 1]);
      return incoming.x !== outgoing.x || incoming.z !== outgoing.z;
    };
    let runIndex = 1;

    path.forEach((point, index) => {
      const t = span ? index / span : 0;
      const elevation = fromElevation + (toElevation - fromElevation) * t;
      const level = round(fromLevel + (toLevel - fromLevel) * t);
      if (isTurn(index)) {
        const options = {
          type: 'floor',
          elevation,
          level,
          surface: 'rampLanding',
          shape: 'tile',
          purpose: 'v1-authored-ramp-landing',
          tags: [routeId],
          traversalRoute: { routeId, sequenceIndex: index, surfaceCount: path.length },
        };
        if (useBase) setBase(point.x, point.z, options);
        else addSurface(point.x, point.z, options);
        runIndex += 1;
        return;
      }
      const previous = path[index - 1] ?? null;
      const next = path[index + 1] ?? null;
      const direction = next ? directionBetween(point, next) : directionBetween(previous, point);
      const startT = Math.max(0, (index - 0.5) / span);
      const endT = Math.min(1, (index + 0.5) / span);
      const options = {
        type: 'floor',
        elevation,
        level,
        surface: 'industrialRamp',
        shape: 'ramp-tile',
        purpose: 'v1-authored-continuous-ramp',
        ramp: {
          routeId,
          runId: `${routeId}.run-${runIndex}`,
          headroomClearanceId: clearanceId,
          startY: round(fromElevation + (toElevation - fromElevation) * startT),
          endY: round(fromElevation + (toElevation - fromElevation) * endT),
          direction,
        },
        traversalRoute: { routeId, sequenceIndex: index, surfaceCount: path.length },
      };
      if (useBase) setBase(point.x, point.z, options);
      else addSurface(point.x, point.z, options);
    });
  };

  const authorRampHeadroomClearance = (routeId, {
    removeOverheadTiles = [],
    lowerLandingTile = null,
    upperLandingTile = null,
  } = {}) => {
    const clearance = rampHeadroomClearances.get(routeId);
    if (!clearance) throw new Error(`${moduleId} cannot clear unknown ramp route ${routeId}.`);
    const resolveLanding = (tile, label) => {
      if (!tile) return null;
      const surface = surfaces.get(surfaceKey(tile.x, tile.z, tile.level));
      if (!surface) {
        throw new Error(`${routeId} ${label} landing is missing ${tile.x},${tile.z}@${tile.level}.`);
      }
      return surface.id;
    };
    clearance.lowerLandingSurfaceId = resolveLanding(lowerLandingTile, 'lower');
    clearance.upperLandingSurfaceId = resolveLanding(upperLandingTile, 'upper');
    for (const tile of removeOverheadTiles) {
      const key = surfaceKey(tile.x, tile.z, tile.level);
      const surface = surfaces.get(key);
      if (!surface) {
        throw new Error(`${routeId} cannot remove missing overhead surface ${tile.x},${tile.z}@${tile.level}.`);
      }
      if (surface.traversalRoute?.routeId === routeId || surface.shape === 'ramp-tile') {
        throw new Error(`${routeId} cannot remove its own traversal surface ${surface.id}.`);
      }
      const coveringRampSurfaceIds = [...surfaces.values()]
        .filter((candidate) => (
          candidate.shape === 'ramp-tile'
          && candidate.ramp?.routeId === routeId
          && candidate.localTile.x === surface.localTile.x
          && candidate.localTile.z === surface.localTile.z
        ))
        .map(({ id }) => id);
      if (!coveringRampSurfaceIds.length) {
        throw new Error(`${routeId} cannot open ${surface.id} without a playable ramp beneath it.`);
      }
      clearance.removedOverheadSurfaces.push({
        id: surface.id,
        localTile: { ...surface.localTile },
        center: { ...surface.center },
        size: { ...surface.size },
        topY: surface.topY,
        sourceSurface: surface.sourceSurface,
        materialProfileId: surface.materialProfileId,
        removalMode: 'remove-entire-over-ramp-tile',
        coveringRampSurfaceIds,
      });
      surfaces.delete(key);
    }
    return clearance;
  };

  return {
    moduleId,
    sourceRoomId,
    type,
    width,
    depth,
    halfWidthTiles,
    halfDepthTiles,
    surfaces,
    setBase,
    addSurface,
    markBaseRect,
    addDeck,
    addRamp,
    authorRampHeadroomClearance,
    finalizeRampHeadroomClearances(walkableSurfaces) {
      const surfaceIds = new Set(walkableSurfaces.map(({ id }) => id));
      return [...rampHeadroomClearances.values()].map((clearance) => ({
        ...clearance,
        rampSurfaceIds: walkableSurfaces
          .filter((surface) => (
            surface.shape === 'ramp-tile'
            && surface.ramp?.routeId === clearance.routeId
          ))
          .map(({ id }) => id),
        removedOverheadSurfaces: clearance.removedOverheadSurfaces.map((removed) => ({
          ...removed,
          coveringRampSurfaceIds: removed.coveringRampSurfaceIds.filter((id) => surfaceIds.has(id)),
        })),
      }));
    },
    finalize() {
      const byId = new Map();
      for (const surface of surfaces.values()) {
        const existing = byId.get(surface.id);
        if (!existing || surface.shape === 'ramp-tile') {
          byId.set(surface.id, surface);
        }
      }
      return [...byId.values()].sort((left, right) => (
        left.topY - right.topY
        || left.localTile.z - right.localTile.z
        || left.localTile.x - right.localTile.x
        || left.id.localeCompare(right.id)
      ));
    },
  };
}

function fixture(moduleId, id, kind, center, halfSize, {
  collisionMode = 'reserved-only',
  prefabId = null,
  assetFamilyId = null,
  materialProfileId = null,
  purpose = 'v1-authored-room-landmark',
  sourceSymbol = '_addIndustrialRoomSetpieces',
  tags = [],
  collisionParts = [],
  authoredUniformScale = 1,
  sourceArguments = null,
  yawQuarterTurns = 0,
} = {}) {
  return {
    id: `fixture.${moduleId}.${id}`,
    kind,
    prefabId,
    assetFamilyId,
    localBounds: {
      center: { x: round(center.x), y: round(center.y), z: round(center.z) },
      halfSize: { x: round(halfSize.x), y: round(halfSize.y), z: round(halfSize.z) },
    },
    collision: {
      mode: collisionMode,
      authority: 'descriptor-local-bounds',
      inferredFromMeshName: false,
      runtimeColliderRequired: ['blocking', 'walkable', 'compound-blocking'].includes(collisionMode),
      parts: collisionParts.map((part) => ({
        id: part.id,
        center: {
          x: round(part.center.x),
          y: round(part.center.y),
          z: round(part.center.z),
        },
        halfSize: {
          x: round(part.halfSize.x),
          y: round(part.halfSize.y),
          z: round(part.halfSize.z),
        },
      })),
    },
    presentation: {
      source: 'dungeon-v1',
      recipeId: prefabId,
      materialProfileId,
      authoredUniformScale,
      scalePolicy: 'source-authored-uniform-only',
      yawQuarterTurns,
      ...(sourceArguments ? { sourceArguments: { ...sourceArguments } } : {}),
    },
    purpose,
    sourceSymbol,
    tags: [...tags],
  };
}

function surfaceAt(topology, x, z, elevation = 0) {
  return topology
    .filter((surface) => surface.localTile.x === x && surface.localTile.z === z)
    .sort((left, right) => Math.abs(left.topY - elevation) - Math.abs(right.topY - elevation))[0] ?? null;
}

function createSocket(moduleId, topology, halfWidthTiles, halfDepthTiles, {
  suffix,
  form,
  side,
  tileX,
  tileZ,
  elevation = 0,
  openingWidth = 3.2,
  openingHeight = 4.8,
  approachTiles,
  apertureTiles = [],
  apertureMode = side === 'interior-floor' ? 'remove-declared-surfaces' : 'boundary-opening',
  semanticRegionIds,
  purpose,
  direction = 'bidirectional',
  destinationTags = [],
}, ceilingHeight = WALL_HEIGHT) {
  const boundaryX = (halfWidthTiles + 0.5) * TILE_SIZE;
  const boundaryZ = (halfDepthTiles + 0.5) * TILE_SIZE;
  const anchor = { x: tileX * TILE_SIZE, y: elevation, z: tileZ * TILE_SIZE };
  const facing = { x: 0, y: 0, z: 0 };
  if (side === 'west') {
    anchor.x = -boundaryX;
    facing.x = -1;
  } else if (side === 'east') {
    anchor.x = boundaryX;
    facing.x = 1;
  } else if (side === 'north') {
    anchor.z = -boundaryZ;
    facing.z = -1;
  } else if (side === 'south') {
    anchor.z = boundaryZ;
    facing.z = 1;
  } else if (side === 'ceiling') {
    anchor.y = ceilingHeight;
    facing.y = 1;
  } else if (side === 'interior-floor') {
    facing.y = -1;
  }

  const approachSurfaceIds = approachTiles.map(([x, z, y = elevation]) => {
    const surface = surfaceAt(topology, x, z, y);
    if (!surface) {
      throw new Error(`${moduleId}/${suffix} references missing approach surface ${x},${z}@${y}.`);
    }
    return surface.id;
  });
  const apertureSurfaceIds = apertureTiles.map(([x, z, y = elevation]) => {
    const surface = surfaceAt(topology, x, z, y);
    if (!surface) {
      throw new Error(`${moduleId}/${suffix} references missing aperture surface ${x},${z}@${y}.`);
    }
    return surface.id;
  });

  return {
    id: `socket.${moduleId}.${suffix}`,
    form,
    boundarySide: side,
    anchor: { x: round(anchor.x), y: round(anchor.y), z: round(anchor.z) },
    facing,
    opening: {
      width: openingWidth,
      height: openingHeight,
      sillElevation: elevation,
    },
    clearance: {
      playerRadius: PLAYER_RADIUS,
      cameraRadius: 0.34,
      headroom: PLAYER_HEADROOM,
      internalDepth: TILE_SIZE * Math.max(2, approachTiles.length),
    },
    approachSurfaceIds,
    aperture: {
      mode: apertureMode,
      surfaceIds: apertureSurfaceIds,
      pairedCatchmentRequired: side === 'interior-floor',
    },
    semanticRegionIds: [...semanticRegionIds],
    purpose,
    direction,
    destinationTags: [...destinationTags],
    connectorAuthority: 'plan-owned-paired-portal',
    unusedSocketCapRequired: true,
  };
}

function region(id, name, purpose, surfaceSelector, {
  optional = false,
  district = 'factory',
  elevationBand = 'ground',
} = {}) {
  return {
    id,
    name,
    purpose,
    district,
    elevationBand,
    optional,
    surfaceSelector,
  };
}

function landmark(id, regionId, purpose, localPosition, {
  surfaceId = null,
  kind = 'exploration-landmark',
  spawnClearance = null,
} = {}) {
  return {
    id,
    regionId,
    kind,
    purpose,
    localPosition: {
      x: round(localPosition.x),
      y: round(localPosition.y),
      z: round(localPosition.z),
    },
    surfaceId,
    ...(spawnClearance ? { spawnClearance: { ...spawnClearance } } : {}),
  };
}

function createModuleShellBoundaries(moduleId, bounds, extensionSockets) {
  const wallCenterY = round((bounds.min.y + bounds.max.y) * 0.5);
  const wallHalfY = round((bounds.max.y - bounds.min.y) * 0.5);
  const halfWidth = round((bounds.max.x - bounds.min.x) * 0.5);
  const halfDepth = round((bounds.max.z - bounds.min.z) * 0.5);
  const centerX = round((bounds.min.x + bounds.max.x) * 0.5);
  const centerZ = round((bounds.min.z + bounds.max.z) * 0.5);

  const boundaryBounds = {
    west: {
      center: { x: bounds.min.x, y: wallCenterY, z: centerZ },
      halfSize: { x: SHELL_WALL_THICKNESS * 0.5, y: wallHalfY, z: halfDepth },
    },
    east: {
      center: { x: bounds.max.x, y: wallCenterY, z: centerZ },
      halfSize: { x: SHELL_WALL_THICKNESS * 0.5, y: wallHalfY, z: halfDepth },
    },
    north: {
      center: { x: centerX, y: wallCenterY, z: bounds.min.z },
      halfSize: { x: halfWidth, y: wallHalfY, z: SHELL_WALL_THICKNESS * 0.5 },
    },
    south: {
      center: { x: centerX, y: wallCenterY, z: bounds.max.z },
      halfSize: { x: halfWidth, y: wallHalfY, z: SHELL_WALL_THICKNESS * 0.5 },
    },
    floor: {
      center: { x: centerX, y: round(bounds.min.y - FLOOR_THICKNESS * 0.5), z: centerZ },
      halfSize: { x: halfWidth, y: FLOOR_THICKNESS * 0.5, z: halfDepth },
    },
    ceiling: {
      center: { x: centerX, y: round(bounds.max.y + SHELL_CEILING_THICKNESS * 0.5), z: centerZ },
      halfSize: { x: halfWidth, y: SHELL_CEILING_THICKNESS * 0.5, z: halfDepth },
    },
  };

  return ['west', 'east', 'north', 'south', 'floor', 'ceiling'].map((side) => {
    const socketSide = side === 'floor' ? 'interior-floor' : side;
    const candidateSockets = extensionSockets.filter((socket) => socket.boundarySide === socketSide);
    return {
      id: `boundary.${moduleId}.${side}`,
      side,
      kind: side === 'ceiling'
        ? 'opaque-enclosure-ceiling-template'
        : side === 'floor'
          ? 'opaque-enclosure-floor-template'
          : 'opaque-enclosure-wall-template',
      localBounds: boundaryBounds[side],
      materialProfileId: side === 'ceiling' ? 'legacy-ceiling' : 'legacy-wall-industrial',
      opaque: true,
      collider: true,
      collision: {
        mode: 'blocking',
        grounded: side !== 'ceiling',
        aerial: true,
        camera: true,
        powerKnockback: true,
      },
      compilePolicy: 'subdivide-around-paired-openings-and-cap-all-unused-sockets',
      candidateSocketIds: candidateSockets.map(({ id: socketId }) => socketId),
      candidateApertures: candidateSockets.map((socket) => ({
        socketId: socket.id,
        boundarySide: socket.boundarySide,
        anchor: { ...socket.anchor },
        opening: { ...socket.opening },
        aperture: {
          mode: socket.aperture.mode,
          surfaceIds: [...socket.aperture.surfaceIds],
        },
      })),
    };
  });
}

function createModule({
  id,
  sourceRoomId,
  sourceType,
  displayName,
  width,
  depth,
  ceilingHeight,
  assetFamilyId,
  topologyBuilder,
  semanticRegions,
  fixtures,
  landmarkAnchors,
  socketSpecs,
  attachedZoneSockets = [],
  sourceReferences,
  sourceVariants = [],
  compositionNotes = [],
}) {
  const walkableSurfaces = topologyBuilder.finalize();
  const rampHeadroomClearances = topologyBuilder.finalizeRampHeadroomClearances(walkableSurfaces);
  const extensionSockets = socketSpecs.map((spec) => createSocket(
    id,
    walkableSurfaces,
    topologyBuilder.halfWidthTiles,
    topologyBuilder.halfDepthTiles,
    spec,
    ceilingHeight,
  ));
  const bounds = {
    min: {
      x: round(-(Math.floor(width / 2) + 0.5) * TILE_SIZE),
      y: Math.min(0, ...walkableSurfaces.map((surface) => surface.topY)),
      z: round(-(Math.floor(depth / 2) + 0.5) * TILE_SIZE),
    },
    max: {
      x: round((Math.floor(width / 2) + 0.5) * TILE_SIZE),
      y: ceilingHeight,
      z: round((Math.floor(depth / 2) + 0.5) * TILE_SIZE),
    },
  };
  const structuralBoundaries = createModuleShellBoundaries(id, bounds, extensionSockets);
  return {
    id,
    revision: LEGACY_FIXED_ROOM_MODULE_CATALOG_REVISION_V2,
    displayName,
    sourceRoom: {
      id: sourceRoomId,
      type: sourceType,
      fixedChainRole: true,
      footprintTiles: { width, depth },
      footprintMeters: {
        width: round((Math.floor(width / 2) * 2 + 1) * TILE_SIZE),
        depth: round((Math.floor(depth / 2) * 2 + 1) * TILE_SIZE),
      },
      ceilingHeight,
      canonicalCatwalkVariant: 'west-and-north',
      sourceVariants: [...sourceVariants],
    },
    bounds,
    semanticRegions,
    floorTopology: {
      coordinateSystem: 'room-local-v1-tile-grid',
      tileSize: TILE_SIZE,
      floorThickness: FLOOR_THICKNESS,
      walkableSurfaces,
      rampHeadroomClearances,
      collisionAuthority: 'surface-contracts',
      preserveSourceTopology: true,
    },
    fixtures,
    landmarkAnchors,
    extensionSockets,
    attachedZoneSockets,
    structuralBoundaries,
    presentation: {
      source: 'dungeon-v1',
      assetFamilyId,
      structuralKitId: 'legacy-ruin-industrial-kit',
      surfaceGeometry: 'concrete-walkable-surface-list',
      fixtureGeometry: 'explicit-v1-prefab-recipes',
      coveredBySurfaceIds: walkableSurfaces.map(({ id: surfaceId }) => surfaceId),
      scalePolicy: 'native-dimensions-only',
      collisionDerivedFromPresentation: false,
    },
    enclosure: {
      required: true,
      wallHeight: ceilingHeight,
      ceilingHeight,
      socketOpeningsOnly: true,
      unusedSocketsMustBeCapped: true,
    },
    compositionNotes,
    sourceReferences,
  };
}

const COMMON_ROOM_SOURCE_REFERENCES = Object.freeze([
  sourceReference('_generateOnce', 1271, 1668, 'fixed V1 room identities, footprints, chain roles, and reward seeds'),
  sourceReference('_assignRoomArchetypes', 1876, 1997, 'authored industrial room archetypes and vertical intent'),
  sourceReference('_markRoomCatwalks', 6429, 6504, 'canonical V1 perimeter catwalk surface grammar'),
  sourceReference('_addIndustrialRoomSetpieces', 8129, 8690, 'procedural authored room landmarks and exact local placement formulae'),
  sourceReference('_addVolumetricIndustrialPrefabs', 8691, 9438, 'large V1 machinery prefab recipes and registered occupied volumes'),
  sourceReference('_addRoomLandmarks', 10760, 11056, 'V1 interaction, treasure, mechanism, and objective anchors'),
]);

function buildSecurityEntranceModule() {
  const id = 'v1-room.security-entrance';
  const topology = createTopologyBuilder(id, 'entrance', 'entrance', 9, 9, {
    centerType: 'entrance',
  });
  const catwalkAccessRouteId = 'ramp.security-entrance.west-catwalk-access';
  // Preserve the working V1 north/west catwalk, but give it an authored
  // grounded route rather than leaving a 1.05m ledge at either socket.  The
  // flat endpoint tiles remain outside the ramp so the compiled continuous
  // incline meets both decks edge-to-edge without a gap or overlap.
  topology.addRamp([
    { x: -3, z: 3 },
    { x: -1, z: 3 },
  ], FACTORY_ELEVATION, 0, 0, 0, catwalkAccessRouteId);
  for (const surface of topology.surfaces.values()) {
    if (surface.traversalRoute?.routeId !== catwalkAccessRouteId) continue;
    surface.sourceSurface = 'securityCatwalkAccessRamp';
    surface.materialProfileId = 'legacy-raised-deck';
    surface.purpose = 'V1-tiled continuous access ramp between the security floor and perimeter catwalk';
    surface.support = {
      style: 'v1-authored-ramp-stringers',
      visible: true,
    };
    surface.collision = {
      ...surface.collision,
      mode: 'walkable',
      supportsGroundedTraversal: true,
      ledgeClimbDisabled: true,
      maximumEndpointGap: 0,
    };
    surface.tags = [...new Set([
      ...(surface.tags ?? []),
      catwalkAccessRouteId,
      'security-catwalk-grounded-access',
    ])];
  }
  const surfaces = [...topology.surfaces.values()];
  const keySeekerSurface = surfaceAt(surfaces, 2, 2, 0);
  const fixtures = [
    fixture(id, 'scanner-arch', 'security-scanner-arch', { x: 0, y: 1.06, z: 0.15 }, { x: 1.05, y: 1.06, z: 0.18 }, {
      prefabId: 'legacy-fixed-security-scanner-arch',
      collisionMode: 'compound-blocking',
      collisionParts: [
        { id: 'west-post', center: { x: -0.9, y: 1.05, z: 0.15 }, halfSize: { x: 0.08, y: 1.05, z: 0.08 } },
        { id: 'east-post', center: { x: 0.9, y: 1.05, z: 0.15 }, halfSize: { x: 0.08, y: 1.05, z: 0.08 } },
      ],
      purpose: 'V1 security scanner landmark; exact arch placement is reserved for presentation parity',
      sourceSymbol: '_addIndustrialRoomSetpieces',
    }),
    fixture(id, 'security-cylinder-arch', 'industrial-cylinder-arch', { x: 0, y: 2.7, z: 4.48 }, { x: 3.7, y: 2.7, z: 0.5 }, {
      prefabId: 'legacy-girder-frame',
      collisionMode: 'compound-blocking',
      collisionParts: [
        { id: 'west-column', center: { x: -3.2, y: 2.7, z: 4.48 }, halfSize: { x: 0.5, y: 2.7, z: 0.5 } },
        { id: 'east-column', center: { x: 3.2, y: 2.7, z: 4.48 }, halfSize: { x: 0.5, y: 2.7, z: 0.5 } },
      ],
      sourceArguments: { width: 6.4, height: 5.4 },
      assetFamilyId: 'v1.security-checkpoint',
      purpose: 'visible entrance portal frame with blocking side columns',
      sourceSymbol: '_addVolumetricIndustrialPrefabs',
    }),
    fixture(id, 'security-fence-west', 'chain-link-security-fence', { x: -6.496, y: 1.59, z: -4.256 }, { x: 0.1, y: 1.59, z: 4.132 }, {
      prefabId: 'legacy-fixed-chain-link-security-fence',
      collisionMode: 'blocking',
      yawQuarterTurns: 1,
      sourceArguments: { width: 8.064, height: 2.9 },
      purpose: 'V1 left security-fence reserved volume',
      sourceSymbol: '_addVolumetricIndustrialPrefabs',
    }),
    fixture(id, 'security-fence-east', 'chain-link-security-fence', { x: 6.496, y: 1.59, z: -4.256 }, { x: 0.1, y: 1.59, z: 4.132 }, {
      prefabId: 'legacy-fixed-chain-link-security-fence',
      collisionMode: 'blocking',
      yawQuarterTurns: 1,
      sourceArguments: { width: 8.064, height: 2.9 },
      purpose: 'V1 right security-fence reserved volume',
      sourceSymbol: '_addVolumetricIndustrialPrefabs',
    }),
  ];

  return createModule({
    id,
    sourceRoomId: 'entrance',
    sourceType: 'entrance',
    displayName: 'V1 Security Entrance',
    width: 9,
    depth: 9,
    ceilingHeight: 8.4,
    assetFamilyId: 'v1.security-checkpoint',
    topologyBuilder: topology,
    semanticRegions: [
      region('security', 'Security Vestibule', 'sealed ruin entry, Key Seeker station, and credential-return hub', {
        kind: 'all-module-surfaces',
      }),
    ],
    fixtures,
    landmarkAnchors: [
      landmark('anchor.key-seeker', 'security', 'V1 Key Seeker placement, two tiles east and south of room center', { x: 2 * TILE_SIZE, y: keySeekerSurface.topY, z: 2 * TILE_SIZE }, {
        surfaceId: keySeekerSurface.id,
        kind: 'key-seeker',
      }),
      landmark('anchor.ruin-entry', 'security', 'sealed transition from camp into the V2 acceptance boundary', { x: 0, y: 0, z: -TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 0, -1, 0).id,
        kind: 'player-entry',
        // The V1 scanner arch crosses the centre tile at head height. Spawn
        // one complete native floor tile north of it so neither Volnutt's
        // body nor the default follow camera begins inside presentation-only
        // geometry. These values are deliberately more conservative than the
        // live 0.42m player collision radius.
        spawnClearance: {
          capsuleRadius: PLAYER_RADIUS,
          capsuleHeight: PLAYER_HEADROOM,
          cameraRadius: 0.34,
          cameraFollowDistance: 6.8,
          cameraHeight: 3.25,
          nonCollidingVisualOverlapAllowed: false,
        },
      }),
    ],
    socketSpecs: [
      {
        suffix: 'ground.north-center', form: 'ground-bulkhead', side: 'north', tileX: 0, tileZ: -4, elevation: FACTORY_ELEVATION, approachTiles: [
          [0, -4, FACTORY_ELEVATION], [-1, -4, FACTORY_ELEVATION], [-2, -4, FACTORY_ELEVATION],
          [-3, -4, FACTORY_ELEVATION], [-4, -4, FACTORY_ELEVATION], [-4, -3, FACTORY_ELEVATION],
          [-4, -2, FACTORY_ELEVATION], [-4, -1, FACTORY_ELEVATION], [-4, 0, FACTORY_ELEVATION],
          [-4, 1, FACTORY_ELEVATION], [-4, 2, FACTORY_ELEVATION], [-4, 3, FACTORY_ELEVATION],
          [-3, 3, FACTORY_ELEVATION], [-2, 3], [-1, 3], [0, 3],
        ], semanticRegionIds: ['security'], purpose: 'raised V1 north threshold with a continuous authored return to the security floor', destinationTags: ['factory'],
      },
      {
        suffix: 'ground.south-center', form: 'ground-bulkhead', side: 'south', tileX: 0, tileZ: 4, approachTiles: [[0, 4], [0, 3], [0, 2]], semanticRegionIds: ['security'], purpose: 'new ground-level Assembly connection clear of the Key Seeker, scanner, and catwalk access ramp', destinationTags: ['factory', 'assembly'],
      },
      {
        suffix: 'ground.east-south-bucket', form: 'ground-bulkhead', side: 'east', tileX: 4, tileZ: 3, approachTiles: [[4, 3], [3, 3], [2, 3]], semanticRegionIds: ['security'], purpose: 'new off-center shortcut or chamber exit', destinationTags: ['factory', 'shortcut'],
      },
      {
        suffix: 'lift.west-south-bucket', form: 'cargo-lift', side: 'west', tileX: -4, tileZ: 3, elevation: FACTORY_ELEVATION, approachTiles: [[-4, 3, FACTORY_ELEVATION], [-3, 3, FACTORY_ELEVATION], [-2, 3], [-1, 3], [0, 3]], semanticRegionIds: ['security'], purpose: 'raised side-wall lift landing with continuous floor access and console space beside the walkway', destinationTags: ['waterworks', 'vertical-transition'],
      },
    ],
    sourceReferences: [
      ...COMMON_ROOM_SOURCE_REFERENCES,
      sourceReference('_createSolidCollisionZones', 12516, 12618, 'authoritative V1 distinction between visible room details and registered blockers'),
    ],
    compositionNotes: [
      'The raised north threshold and west lift landing share one supported V1-tiled access ramp; the new south opening is the ground-level Assembly route.',
      'Fences remain reserved presentation volumes but never become invisible runtime colliders.',
    ],
  });
}

function buildEnemyNestModule() {
  const id = 'v1-room.enemy-nest';
  const topology = createTopologyBuilder(id, 'enemyNest', 'enemy', 15, 13);
  topology.addDeck({
    level: 1,
    elevation: SECOND_FLOOR_ELEVATION,
    surface: 'secondFloor',
    minX: -5,
    maxX: 7,
    minZ: 4,
    maxZ: 6,
    supportStyle: 'solid_mass',
    purpose: 'V1 rear nest structural mezzanine',
  });
  topology.addRamp([
    { x: -6, z: -5 },
    { x: -6, z: 3 },
  ], 0, SECOND_FLOOR_ELEVATION, 0, 1, 'ramp.enemy-nest.rear-mezzanine');
  const surfaces = [...topology.surfaces.values()];
  const halfW = 7 * TILE_SIZE;
  const halfD = 6 * TILE_SIZE;
  const fixtures = [];
  for (const sign of [-1, 1]) {
    fixtures.push(fixture(id, `massive-monolith-${sign < 0 ? 'west' : 'east'}`, 'massive-alien-monolith', {
      x: sign * halfW * 0.62,
      y: 3.05,
      z: -halfD * 0.42,
    }, { x: 2.123, y: 3.024, z: 2.123 }, {
      prefabId: 'legacy-server-monolith',
      collisionMode: 'blocking',
      authoredUniformScale: 1.12,
      assetFamilyId: 'v1.nest-warehouse',
      purpose: 'V1 dormant nest monolith landmark',
      sourceSymbol: '_addVolumetricIndustrialPrefabs',
    }));
  }

  return createModule({
    id,
    sourceRoomId: 'enemyNest',
    sourceType: 'enemy',
    displayName: 'V1 Reaverbot Nest Warehouse',
    width: 15,
    depth: 13,
    ceilingHeight: 12.8,
    assetFamilyId: 'v1.nest-warehouse',
    topologyBuilder: topology,
    semanticRegions: [
      region('nest', 'Nest Warehouse', 'optional Reaverbot nest, upper salvage route, and rare component cache', {
        kind: 'surface-and-fixture-zone',
        includeSourceSurfaces: ['enemy', 'secondFloor', 'catwalk', 'industrialRamp'],
      }, { optional: true, elevationBand: 'multi-level' }),
    ],
    fixtures,
    landmarkAnchors: [
      landmark('anchor.encounter.nest', 'nest', 'center of the optional V1 nest encounter', { x: 0, y: surfaceAt(surfaces, 0, 0, 0).topY, z: 0 }, {
        surfaceId: surfaceAt(surfaces, 0, 0, 0).id,
        kind: 'encounter',
      }),
      landmark('anchor.cache.nest', 'nest', 'farthest supported rear-mezzanine cache', { x: 5 * TILE_SIZE, y: SECOND_FLOOR_ELEVATION, z: 5 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 5, 5, SECOND_FLOOR_ELEVATION).id,
        kind: 'salvage-cache',
      }),
    ],
    socketSpecs: [
      {
        suffix: 'ground.west-center', form: 'ground-bulkhead', side: 'west', tileX: -7, tileZ: 0, elevation: FACTORY_ELEVATION, approachTiles: [[-7, 0, FACTORY_ELEVATION], [-7, 1, FACTORY_ELEVATION], [-7, 2, FACTORY_ELEVATION]], semanticRegionIds: ['nest'], purpose: 'preserved V1 west perimeter threshold on its exact supported catwalk elevation', destinationTags: ['factory'],
      },
      {
        suffix: 'catwalk.east-rear', form: 'elevated-catwalk', side: 'east', tileX: 7, tileZ: 5, elevation: SECOND_FLOOR_ELEVATION, approachTiles: [[7, 5, SECOND_FLOOR_ELEVATION], [6, 5, SECOND_FLOOR_ELEVATION], [5, 5, SECOND_FLOOR_ELEVATION]], semanticRegionIds: ['nest'], purpose: 'new elevated warehouse bridge', destinationTags: ['factory', 'upper-route'],
      },
      {
        suffix: 'ladder.ceiling-rear', form: 'service-ladder', side: 'ceiling', tileX: 4, tileZ: 5, elevation: SECOND_FLOOR_ELEVATION, approachTiles: [[4, 5, SECOND_FLOOR_ELEVATION], [3, 5, SECOND_FLOOR_ELEVATION]], semanticRegionIds: ['nest'], purpose: 'new ladder shaft continuing above the supported mezzanine', destinationTags: ['vertical-transition'],
      },
    ],
    sourceReferences: [
      ...COMMON_ROOM_SOURCE_REFERENCES,
      sourceReference('_createFactoryLevelTiles.enemyNest', 4014, 4034, 'exact rear mezzanine bounds and authored access ramp'),
    ],
    compositionNotes: [
      'This remains an optional chamber; its encounter cannot own a permanent exit.',
      'Both monolith occupied volumes are fixed before socket selection, preventing passage obstruction.',
    ],
  });
}

function buildCredentialPyramidModule() {
  const id = 'v1-room.credential-pyramid';
  const topology = createTopologyBuilder(id, 'keycardRoom', 'keycard', 23, 21, {
    centerType: 'keycard',
  });
  const baseHalfExtent = 8;
  const terraceCount = 8;
  const stepRise = 0.5;
  for (let dx = -baseHalfExtent; dx <= baseHalfExtent; dx += 1) {
    for (let dz = -baseHalfExtent; dz <= baseHalfExtent; dz += 1) {
      const inset = Math.min(baseHalfExtent - Math.abs(dx), baseHalfExtent - Math.abs(dz));
      const terraceIndex = Math.min(terraceCount - 1, inset);
      const elevation = (terraceIndex + 1) * stepRise;
      const summit = Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
      const processional = Math.abs(dx) <= 1 && dz <= -1;
      topology.setBase(dx, dz, {
        type: 'floor',
        elevation,
        level: round(elevation / SECOND_FLOOR_ELEVATION),
        surface: summit
          ? 'mechanicalPyramidSummit'
          : processional
            ? 'mechanicalPyramidProcessionalStep'
            : 'mechanicalPyramidTerrace',
        supportStyle: 'solid_mass',
        purpose: summit
          ? 'keycard-pyramid-summit'
          : processional
            ? 'enemy-lined-processional-stair'
            : 'walkable-mayan-terrace',
        collision: {
          groundedStepTransitionHeight: 0.55,
        },
      });
    }
  }
  for (const sign of [-1, 1]) {
    const route = [
      { x: sign * 9, z: 2, elevation: JUMP_PLATFORM_ELEVATION },
      { x: sign * 8, z: 1, elevation: JUMP_PLATFORM_ELEVATION * 2 },
      { x: sign * 7, z: 0, elevation: SECOND_FLOOR_ELEVATION },
    ];
    route.forEach((point, index) => topology.setBase(point.x, point.z, {
      type: 'floor',
      elevation: point.elevation,
      level: 0.5 + index * 0.25,
      surface: 'mechanicalPyramidSidePlatform',
      supportStyle: 'solid_mass',
      purpose: 'optional-side-platforming-ascent',
      tags: [`pyramid-side-${sign < 0 ? 'west' : 'east'}`],
    }));
  }
  // The new north bulkhead is a ground opening. Cut only its boundary landing
  // out of the decorative V1 perimeter catwalk instead of declaring a false
  // zero-metre sill against a 1.05m surface.
  topology.setBase(-9, -10, {
    elevation: 0,
    level: 0,
    surface: 'credentialGroundThreshold',
    purpose: 'flush ground threshold for the north-west credential return',
  });
  const surfaces = [...topology.surfaces.values()];
  const halfW = 11 * TILE_SIZE;
  const halfD = 10 * TILE_SIZE;
  const fixtures = [
    fixture(id, 'processional-arch', 'industrial-cylinder-arch', { x: 0, y: 2.6, z: -halfD * 0.62 }, { x: 3.1, y: 2.6, z: 0.5 }, {
      prefabId: 'legacy-girder-frame',
      collisionMode: 'compound-blocking',
      collisionParts: [
        { id: 'west-column', center: { x: -3.1, y: 2.6, z: -halfD * 0.62 }, halfSize: { x: 0.5, y: 2.6, z: 0.5 } },
        { id: 'east-column', center: { x: 3.1, y: 2.6, z: -halfD * 0.62 }, halfSize: { x: 0.5, y: 2.6, z: 0.5 } },
      ],
      sourceArguments: { width: 6.2, height: 5.2 },
      assetFamilyId: 'v1.credential-pyramid',
      purpose: 'V1 processional arch at the pyramid approach',
      sourceSymbol: '_addVolumetricIndustrialPrefabs',
    }),
  ];

  return createModule({
    id,
    sourceRoomId: 'keycardRoom',
    sourceType: 'keycard',
    displayName: 'V1 Grand Credential Pyramid',
    width: 23,
    depth: 21,
    ceilingHeight: 15.2,
    assetFamilyId: 'v1.credential-pyramid',
    topologyBuilder: topology,
    semanticRegions: [
      region('credential', 'Credential Tower', 'multi-tier credential landmark, guarded summit, and shortcut hub', {
        kind: 'surface-and-fixture-zone',
        includeSourceSurfaces: ['mechanicalPyramidSummit', 'mechanicalPyramidProcessionalStep', 'mechanicalPyramidTerrace', 'mechanicalPyramidSidePlatform'],
      }, { elevationBand: 'multi-level' }),
    ],
    fixtures,
    landmarkAnchors: [
      landmark('anchor.credential.summit', 'credential', 'V1 pyramid summit pedestal anchor', { x: 0, y: 4, z: 0 }, {
        surfaceId: surfaceAt(surfaces, 0, 0, 4).id,
        kind: 'credential-pedestal',
      }),
      landmark('anchor.encounter.credential-guard', 'credential', 'guard encounter staging at the processional face', { x: 0, y: surfaceAt(surfaces, 0, -7, 1).topY, z: -7 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 0, -7, 1).id,
        kind: 'encounter',
      }),
    ],
    socketSpecs: [
      {
        suffix: 'ground.north-west-bucket', form: 'ground-bulkhead', side: 'north', tileX: -9, tileZ: -10, approachTiles: [[-9, -10], [-9, -9], [-9, -8]], semanticRegionIds: ['credential'], purpose: 'off-center processional entry that preserves the pyramid face', destinationTags: ['factory'],
      },
      {
        suffix: 'ground.south-east-bucket', form: 'ground-bulkhead', side: 'south', tileX: 9, tileZ: 10, approachTiles: [[9, 10], [9, 9], [9, 8]], semanticRegionIds: ['credential'], purpose: 'new permanent shortcut return outside the pyramid mass', destinationTags: ['factory', 'shortcut'],
      },
      {
        suffix: 'lift.east-north-bucket', form: 'cargo-lift', side: 'east', tileX: 11, tileZ: -9, approachTiles: [[11, -9], [10, -9], [9, -9]], semanticRegionIds: ['credential'], purpose: 'new external lift tower with a clear perimeter landing', destinationTags: ['undercroft', 'vertical-transition'],
      },
    ],
    sourceReferences: [
      ...COMMON_ROOM_SOURCE_REFERENCES,
      sourceReference('_createFactoryLevelTiles.keycardRoom', 4074, 4158, 'exact 17x17 stepped pyramid, 0.5m terraces, summit, and side routes'),
      sourceReference('createMechanicalPyramid', 9008, 9112, 'V1 visual terrace caps and processional identity'),
    ],
    compositionNotes: [
      'The summit remains remote from all perimeter sockets; a gate must never consume a key on this same module.',
      'Pyramid collision is the exact walkable terrace list, never a single invisible cap or blank box.',
    ],
  });
}

function buildServerCryptModule() {
  const id = 'v1-room.server-crypt';
  const topology = createTopologyBuilder(id, 'alienServerRoom', 'server', 15, 13);
  topology.markBaseRect({
    elevation: 0,
    level: 0,
    surface: 'serverCoreFloor',
    minX: -1,
    maxX: 1,
    minZ: -1,
    maxZ: 1,
  });
  topology.addDeck({
    level: 1,
    elevation: SECOND_FLOOR_ELEVATION,
    surface: 'serverUpperCatwalk',
    minX: -5,
    maxX: 5,
    minZ: -5,
    maxZ: -4,
    purpose: 'V1 north server inspection catwalk',
  });
  topology.addDeck({
    level: 1,
    elevation: SECOND_FLOOR_ELEVATION,
    surface: 'serverUpperCatwalk',
    minX: 5,
    maxX: 5,
    minZ: -4,
    maxZ: 4,
    purpose: 'V1 east server inspection catwalk',
  });
  topology.addRamp([
    { x: -6, z: 5 },
    { x: -6, z: -4 },
  ], 0, SECOND_FLOOR_ELEVATION, 0, 1, 'ramp.server-crypt.outer-wall');
  // The source ramp reaches the north inspection run at its outside corner.
  // Preserve that as a full supported landing tile: binding the ramp directly
  // to the east-adjacent catwalk leaves only a point contact and produces the
  // same jarring ledge correction as two overlapping sloped planes.
  topology.addDeck({
    level: 1,
    elevation: SECOND_FLOOR_ELEVATION,
    surface: 'serverUpperCatwalk',
    minX: -6,
    maxX: -6,
    minZ: -5,
    maxZ: -5,
    purpose: 'V1 outer-ramp top landing into the north server inspection run',
  });
  const surfaces = [...topology.surfaces.values()];
  const fixtureHalfW = 7 * TILE_SIZE - 0.7;
  const fixtureHalfD = 6 * TILE_SIZE - 0.7;
  const fixtures = [];
  const rackXs = [-fixtureHalfW * 0.42, -fixtureHalfW * 0.24, fixtureHalfW * 0.24, fixtureHalfW * 0.42];
  const rackZs = [-fixtureHalfD * 0.46, -fixtureHalfD * 0.16, fixtureHalfD * 0.16, fixtureHalfD * 0.46];
  rackXs.forEach((x, xIndex) => rackZs.forEach((z, zIndex) => {
    fixtures.push(fixture(id, `server-monolith-${xIndex + 1}-${zIndex + 1}`, 'alien-server-monolith', {
      x,
      y: 0.972,
      z,
    }, { x: 0.6822, y: 0.972, z: 0.6822 }, {
      prefabId: 'legacy-server-monolith',
      collisionMode: 'blocking',
      authoredUniformScale: 0.36,
      assetFamilyId: 'v1.server-crypt',
      purpose: 'exact V1 server-rack grid position and blocker',
      sourceSymbol: '_createSolidCollisionZones',
    }));
  }));
  fixtures.push(
    fixture(id, 'central-energy-core', 'server-energy-core', { x: 0, y: 1.635, z: 0 }, { x: 1.52028, y: 1.635, z: 1.52028 }, {
      prefabId: 'legacy-fixed-server-energy-core',
      collisionMode: 'blocking',
      purpose: 'exact V1 central core reserved volume; surrounding floor remains authoritative',
      sourceSymbol: '_createSolidCollisionZones',
    }),
    fixture(id, 'south-entry-console', 'server-entry-console', { x: 0, y: 0.505, z: fixtureHalfD * 0.72 - 0.035 }, { x: 0.56, y: 0.505, z: 0.29 }, {
      prefabId: 'legacy-fixed-server-entry-console',
      collisionMode: 'blocking',
      purpose: 'exact V1 entry-console reserved volume and interaction anchor',
      sourceSymbol: '_createSolidCollisionZones',
    }),
    fixture(id, 'south-girder-frame', 'massive-girder-frame', { x: 0, y: 3.4, z: 6 * TILE_SIZE * 0.66 }, { x: 7 * TILE_SIZE * 1.35 * 0.5, y: 3.4, z: 0.42 }, {
      prefabId: 'legacy-girder-frame',
      collisionMode: 'compound-blocking',
      collisionParts: [
        { id: 'west-column', center: { x: -7 * TILE_SIZE * 1.35 * 0.5, y: 3.4, z: 6 * TILE_SIZE * 0.66 }, halfSize: { x: 0.42, y: 3.4, z: 0.42 } },
        { id: 'east-column', center: { x: 7 * TILE_SIZE * 1.35 * 0.5, y: 3.4, z: 6 * TILE_SIZE * 0.66 }, halfSize: { x: 0.42, y: 3.4, z: 0.42 } },
      ],
      sourceArguments: { width: 7 * TILE_SIZE * 1.35, height: 6.8 },
      assetFamilyId: 'v1.server-crypt',
      purpose: 'V1 server-crypt load-bearing frame with visible blocking columns',
      sourceSymbol: '_addVolumetricIndustrialPrefabs',
    }),
  );

  return createModule({
    id,
    sourceRoomId: 'alienServerRoom',
    sourceType: 'server',
    displayName: 'V1 Alien Server Crypt',
    width: 15,
    depth: 13,
    ceilingHeight: 12.8,
    assetFamilyId: 'v1.server-crypt',
    topologyBuilder: topology,
    semanticRegions: [
      region('server', 'Server Crypt', 'raised data crypt, monolith aisles, pipe-top route, and Alpha exploration pedestal', {
        kind: 'surface-and-fixture-zone',
        includeSourceSurfaces: ['serverCoreFloor', 'serverUpperCatwalk', 'industrialRamp'],
      }, { elevationBand: 'multi-level' }),
    ],
    fixtures,
    landmarkAnchors: [
      // Offset the pedestal 0.4m toward the outer half of its authored tile.
      // A centred 1.4m pedestal leaves no legal 0.46m player capsule approach
      // on a 2.8m catwalk tile; this retains the same remote V1 catwalk pad
      // while providing a real supported approach from its south edge.
      landmark('anchor.key.alpha', 'server', 'remote Alpha pedestal on the east inspection catwalk', { x: 5 * TILE_SIZE, y: SECOND_FLOOR_ELEVATION, z: 3 * TILE_SIZE + 0.4 }, {
        surfaceId: surfaceAt(surfaces, 5, 3, SECOND_FLOOR_ELEVATION).id,
        kind: 'credential-pedestal',
      }),
      landmark('anchor.cache.server', 'server', 'V1 rare cache on the north inspection run', { x: -3 * TILE_SIZE, y: SECOND_FLOOR_ELEVATION, z: -5 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, -3, -5, SECOND_FLOOR_ELEVATION).id,
        kind: 'salvage-cache',
      }),
    ],
    socketSpecs: [
      {
        suffix: 'ground.south-east-bucket', form: 'ground-bulkhead', side: 'south', tileX: 3, tileZ: 6, approachTiles: [[3, 6], [3, 5], [3, 4]], semanticRegionIds: ['server'], purpose: 'off-center ground entrance through the clear span between the server girder columns', destinationTags: ['factory'],
      },
      {
        suffix: 'catwalk.north-center', form: 'elevated-catwalk', side: 'north', tileX: 0, tileZ: -6, elevation: SECOND_FLOOR_ELEVATION, approachTiles: [[0, -5, SECOND_FLOOR_ELEVATION], [0, -4, SECOND_FLOOR_ELEVATION], [1, -4, SECOND_FLOOR_ELEVATION]], semanticRegionIds: ['server'], purpose: 'new elevated server bridge', destinationTags: ['factory', 'upper-route'],
      },
      {
        suffix: 'ladder.ceiling-east-catwalk', form: 'service-ladder', side: 'ceiling', tileX: 5, tileZ: 0, elevation: SECOND_FLOOR_ELEVATION, approachTiles: [[5, 0, SECOND_FLOOR_ELEVATION], [5, 1, SECOND_FLOOR_ELEVATION]], semanticRegionIds: ['server'], purpose: 'new service ladder continuing from the supported east catwalk', destinationTags: ['vertical-transition'],
      },
    ],
    sourceReferences: [
      ...COMMON_ROOM_SOURCE_REFERENCES,
      sourceReference('_createFactoryLevelTiles.alienServerRoom', 4035, 4073, 'exact server-core patch, L-shaped upper catwalk, and outer-wall ramp'),
      sourceReference('_createSolidCollisionZones.alienServerRoom', 12534, 12557, 'exact 4x4 server rack grid, core, and entry-console occupied volumes'),
    ],
    sourceVariants: ['outer-ramp-west-for-positive-prefab-yaw', 'outer-ramp-east-for-negative-prefab-yaw'],
    compositionNotes: [
      'The catalog chooses the positive-yaw V1 variant with its ramp on the west wall; D4 placement remains plan-owned.',
      'Every server rack is a visible supported prefab and owns matching explicit collision.',
    ],
  });
}

function buildMachineFactoryModule() {
  const id = 'v1-room.machine-factory';
  const topology = createTopologyBuilder(id, 'machineFactoryRoom', 'machine', 19, 15);
  for (let z = -5; z <= 5; z += 1) {
    topology.setBase(0, z, {
      type: 'conveyor',
      elevation: 0,
      surface: 'machineAssemblyConveyor',
      purpose: 'V1 central assembly conveyor',
      tags: ['conveyor-direction-south'],
    });
  }
  for (const x of [-6, 6]) {
    for (let z = -4; z <= 4; z += 1) {
      topology.setBase(x, z, {
        type: 'conveyor',
        elevation: 0,
        surface: 'machineSideConveyor',
        purpose: 'V1 side parts conveyor',
        tags: [x < 0 ? 'conveyor-direction-north' : 'conveyor-direction-south'],
      });
    }
  }
  topology.markBaseRect({
    elevation: 0,
    level: 0,
    surface: 'machinePressZone',
    minX: -1,
    maxX: 1,
    minZ: -3,
    maxZ: 3,
  });
  topology.addDeck({ level: 1, elevation: SECOND_FLOOR_ELEVATION, surface: 'machineUpperCatwalk', minX: -8, maxX: 8, minZ: -6, maxZ: -5, purpose: 'V1 north machine catwalk' });
  topology.addDeck({ level: 1, elevation: SECOND_FLOOR_ELEVATION, surface: 'machineCrossBridge', minX: -8, maxX: 8, minZ: 0, maxZ: 0, purpose: 'V1 press-line cross bridge' });
  topology.addDeck({ level: 1, elevation: SECOND_FLOOR_ELEVATION, surface: 'machineUpperCatwalk', minX: -8, maxX: -7, minZ: -5, maxZ: 5, purpose: 'V1 west machine catwalk' });
  topology.addDeck({ level: 1, elevation: SECOND_FLOOR_ELEVATION, surface: 'machineUpperCatwalk', minX: 7, maxX: 8, minZ: -5, maxZ: 5, purpose: 'V1 east machine catwalk' });
  topology.addRamp([
    { x: -8, z: 6 },
    { x: -8, z: -4 },
  ], 0, SECOND_FLOOR_ELEVATION, 0, 1, 'ramp.machine-factory.west-catwalk');
  topology.authorRampHeadroomClearance('ramp.machine-factory.west-catwalk', {
    removeOverheadTiles: rangeOrdered(4, -3).map((z) => ({ x: -8, z, level: 1 })),
    lowerLandingTile: { x: -8, z: 7, level: 0 },
    upperLandingTile: { x: -8, z: -5, level: 1 },
  });
  const surfaces = [...topology.surfaces.values()];
  const fixtureHalfW = 9 * TILE_SIZE - 0.7;
  const fixtureHalfD = 7 * TILE_SIZE - 0.7;
  const sideBeltX = fixtureHalfW * 0.68;
  const fixtures = [];
  for (const z of [-fixtureHalfD * 0.34, 0, fixtureHalfD * 0.34]) {
    fixtures.push(fixture(id, `press-${round(z)}`, 'machine-press-assembly', { x: 0, y: 1.05, z }, { x: 1.575, y: 1.05, z: 0.38 }, {
      prefabId: 'legacy-fixed-machine-press',
      collisionMode: 'compound-blocking',
      collisionParts: [
        { id: 'west-leg', center: { x: -1.15, y: 0.725, z }, halfSize: { x: 0.14, y: 0.725, z: 0.21 } },
        { id: 'east-leg', center: { x: 1.15, y: 0.725, z }, halfSize: { x: 0.14, y: 0.725, z: 0.21 } },
      ],
      purpose: 'full visible V1 press assembly with collision limited to its two support legs',
      sourceSymbol: '_addIndustrialRoomSetpieces',
    }));
  }
  for (const x of [-sideBeltX - 1.5, -sideBeltX + 1.5, sideBeltX - 1.5, sideBeltX + 1.5]) {
    for (const z of [-fixtureHalfD * 0.38, fixtureHalfD * 0.38]) {
      const direction = x < 0 ? 1 : -1;
      const zDirection = Math.sign(z || 1);
      fixtures.push(fixture(id, `robot-arm-${round(x)}-${round(z)}`, 'machine-robot-arm', {
        x: x + direction * 0.59,
        y: 0.72,
        z: z + zDirection * 0.14,
      }, { x: 0.72, y: 0.72, z: 0.74 }, {
        prefabId: 'legacy-fixed-machine-robot-arm',
        collisionMode: 'compound-blocking',
        collisionParts: [
          { id: 'base', center: { x, y: 0.41, z }, halfSize: { x: 0.14, y: 0.41, z: 0.14 } },
        ],
        sourceArguments: { direction, zDirection },
        purpose: 'full visible V1 robot arm with collision limited to its grounded base',
        sourceSymbol: '_addIndustrialRoomSetpieces',
      }));
    }
  }
  fixtures.push(
    fixture(id, 'prime-mover', 'factory-prime-mover-engine', { x: -9 * TILE_SIZE * 0.58, y: 2.4752, z: 7 * TILE_SIZE * 0.62 - 0.2128 }, { x: 3.136, y: 2.4752, z: 2.1168 }, {
      prefabId: 'legacy-fixed-industrial-engine',
      collisionMode: 'blocking',
      authoredUniformScale: 1.12,
      yawQuarterTurns: 0,
      sourceArguments: { scale: 1.12, yawQuarterTurns: 0 },
      assetFamilyId: 'v1.factory-assembly',
      purpose: 'V1 prime mover at its authored preferred anchor',
      sourceSymbol: '_addVolumetricIndustrialPrefabs',
    }),
    fixture(id, 'north-girder-frame', 'massive-girder-frame', { x: 0, y: 3.2, z: -7 * TILE_SIZE * 0.68 }, { x: 9 * TILE_SIZE * 1.36 * 0.5, y: 3.2, z: 0.42 }, {
      prefabId: 'legacy-girder-frame',
      collisionMode: 'compound-blocking',
      collisionParts: [
        { id: 'west-column', center: { x: -9 * TILE_SIZE * 1.36 * 0.5, y: 3.2, z: -7 * TILE_SIZE * 0.68 }, halfSize: { x: 0.42, y: 3.2, z: 0.42 } },
        { id: 'east-column', center: { x: 9 * TILE_SIZE * 1.36 * 0.5, y: 3.2, z: -7 * TILE_SIZE * 0.68 }, halfSize: { x: 0.42, y: 3.2, z: 0.42 } },
      ],
      sourceArguments: { width: 9 * TILE_SIZE * 1.36, height: 6.4 },
      assetFamilyId: 'v1.factory-assembly',
      purpose: 'V1 machine-factory structural frame',
      sourceSymbol: '_addVolumetricIndustrialPrefabs',
    }),
  );

  return createModule({
    id,
    sourceRoomId: 'machineFactoryRoom',
    sourceType: 'machine',
    displayName: 'V1 Industrial Machine Factory',
    width: 19,
    depth: 15,
    ceilingHeight: 15.2,
    assetFamilyId: 'v1.factory-assembly',
    topologyBuilder: topology,
    semanticRegions: [
      region('assembly', 'Assembly Pump Cavern', 'sprawling V1 factory floor, three conveyor lanes, press machinery, and upper catwalk exploration', {
        kind: 'surface-and-fixture-zone',
        includeSourceSurfaces: ['machineAssemblyConveyor', 'machineSideConveyor', 'machinePressZone', 'machineUpperCatwalk', 'machineCrossBridge', 'industrialRamp'],
      }, { elevationBand: 'multi-level' }),
      region('freight', 'Broken Freight Shaft', 'new playable freight catchment attached below the V1 factory without altering its original floor topology', {
        kind: 'extension-zone',
        extensionSocketId: `socket.${id}.lower.freight-catchment`,
      }, { elevationBand: 'lower' }),
    ],
    fixtures,
    landmarkAnchors: [
      landmark('anchor.encounter.assembly', 'assembly', 'ordinary encounter staging between the three authored conveyor lanes', { x: 3 * TILE_SIZE, y: 0, z: 2 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 3, 2, 0).id,
        kind: 'encounter',
      }),
      landmark('anchor.cache.assembly', 'assembly', 'upper machine inspection cache', { x: 7 * TILE_SIZE, y: SECOND_FLOOR_ELEVATION, z: 4 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 7, 4, SECOND_FLOOR_ELEVATION).id,
        kind: 'salvage-cache',
      }),
      landmark('anchor.freight-return', 'freight', 'damage-free return landing from the attached lower freight zone', { x: 4 * TILE_SIZE, y: 0, z: 5 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 4, 5, 0).id,
        kind: 'safe-return',
      }),
    ],
    socketSpecs: [
      {
        suffix: 'ground.south-east-bucket', form: 'ground-bulkhead', side: 'south', tileX: 7, tileZ: 7, approachTiles: [[7, 7], [7, 6], [7, 5]], semanticRegionIds: ['assembly'], purpose: 'new off-center factory-floor connection', destinationTags: ['factory'],
      },
      {
        suffix: 'catwalk.north-center', form: 'elevated-catwalk', side: 'north', tileX: 0, tileZ: -7, elevation: SECOND_FLOOR_ELEVATION, approachTiles: [[0, -6, SECOND_FLOOR_ELEVATION], [0, -5, SECOND_FLOOR_ELEVATION], [1, -5, SECOND_FLOOR_ELEVATION]], semanticRegionIds: ['assembly'], purpose: 'new upper factory bridge through the center opening of the visible girder', destinationTags: ['factory', 'upper-route'],
      },
      {
        suffix: 'pipe.east-center', form: 'pipe-water-breach', side: 'east', tileX: 9, tileZ: 3, approachTiles: [[9, 3], [8, 3], [7, 3]], semanticRegionIds: ['assembly'], purpose: 'new pipe tunnel from factory machinery into Waterworks', destinationTags: ['waterworks'],
      },
      {
        suffix: 'lower.freight-catchment', form: 'intentional-lower-zone', side: 'interior-floor', tileX: 4, tileZ: 5, apertureTiles: [[4, 5]], approachTiles: [[3, 5], [2, 5], [1, 5]], semanticRegionIds: ['assembly', 'freight'], purpose: 'signaled intentional descent into a fully playable lower freight sub-zone', direction: 'forward-with-authored-return', destinationTags: ['lower-playable-region', 'damage-free-catchment'],
      },
    ],
    sourceReferences: [
      ...COMMON_ROOM_SOURCE_REFERENCES,
      sourceReference('_generateOnce.machineFactoryRoom', 1362, 1391, 'exact three V1 assembly conveyor lanes and treasure seed'),
      sourceReference('_createFactoryLevelTiles.machineFactoryRoom', 4262, 4316, 'exact press floor, U-shaped upper catwalks, cross bridge, and west access ramp'),
      sourceReference('_createSolidCollisionZones.machineFactoryRoom', 12558, 12598, 'exact visible press-leg, robot-arm, tank, and console collision policy'),
    ],
    compositionNotes: [
      'The attached freight sub-zone is reached through a declared intentional drop and must supply its own authored catchment and return; no V1 floor is silently removed.',
      'Press housings are never projected into invisible full-width blockers; only visible support reservations are retained.',
    ],
  });
}

function buildConveyorGantryModule() {
  const id = 'v1-room.conveyor-gantry';
  const topology = createTopologyBuilder(id, 'conveyorRoom', 'conveyor', 21, 17, {
    centerType: 'floor',
  });
  const belts = [
    [-6, -2, 'feedA'], [-5, -2, 'feedB'], [-4, -2, 'feedC'], [-3, -2, 'feedD'],
    [-2, -2, 'junctionA'], [-1, -2, 'targetRunA'], [0, -2, 'targetRunB'], [1, -2, 'targetRunC'], [2, -2, 'targetRunD'], [3, -2, 'targetRunE'],
    [-2, -1, 'returnA'], [-2, 0, 'returnB'], [-2, 1, 'returnC'], [-3, 1, 'returnD'], [-4, 1, 'returnE'], [-5, 1, 'returnF'], [-6, 1, 'returnG'], [-6, 0, 'returnH'], [-6, -1, 'returnI'],
  ];
  belts.forEach(([x, z, beltId]) => topology.setBase(x, z, {
    type: 'conveyor',
    elevation: 0,
    surface: 'conveyorPuzzleBelt',
    purpose: 'V1 TwoRouteJunction cargo-routing puzzle',
    tags: [`conveyor-node-${beltId}`],
  }));
  for (let z = -8; z <= 8; z += 1) topology.addSurface(0, z, {
    type: 'conveyor', level: 1, elevation: SECOND_FLOOR_ELEVATION, surface: 'secondFloorConveyor', purpose: 'V1 elevated center conveyor',
  });
  topology.addDeck({ level: 1, elevation: SECOND_FLOOR_ELEVATION, surface: 'secondFloor', minX: -10, maxX: -7, minZ: -8, maxZ: 8, supportStyle: 'solid_mass', purpose: 'V1 west structural gantry mass' });
  topology.addDeck({ level: 1, elevation: SECOND_FLOOR_ELEVATION, surface: 'conveyorCrossBridge', minX: -8, maxX: -1, minZ: 0, maxZ: 0, purpose: 'V1 conveyor cross bridge' });
  topology.addDeck({ level: 2, elevation: THIRD_FLOOR_ELEVATION, surface: 'thirdFloorGantry', minX: -4, maxX: 4, minZ: 2, maxZ: 3, purpose: 'V1 third-floor sorting gantry' });
  topology.addRamp([
    { x: 9, z: -7 },
    { x: 9, z: 7 },
    { x: 2, z: 7 },
  ], 0, SECOND_FLOOR_ELEVATION, 0, 1, 'ramp.conveyor-gantry.ground-to-second');
  topology.addRamp([
    { x: -9, z: 6 },
    { x: 4, z: 6 },
    { x: 4, z: 3 },
  ], SECOND_FLOOR_ELEVATION, THIRD_FLOOR_ELEVATION, 1, 2, 'ramp.conveyor-gantry.second-to-third');
  const surfaces = [...topology.surfaces.values()];
  const halfW = 10 * TILE_SIZE;
  const halfD = 8 * TILE_SIZE;
  const fixtures = [
    fixture(id, 'drive-engine', 'conveyor-drive-engine', { x: halfW * 0.64 - 0.1824, y: 2.1216, z: -halfD * 0.46 }, { x: 1.8144, y: 2.1216, z: 2.688 }, {
      prefabId: 'legacy-fixed-industrial-engine',
      collisionMode: 'blocking',
      authoredUniformScale: 0.96,
      yawQuarterTurns: 1,
      sourceArguments: { scale: 0.96, yawQuarterTurns: 1 },
      assetFamilyId: 'v1.factory-conveyor',
      purpose: 'V1 sorting conveyor drive at its authored preferred anchor',
      sourceSymbol: '_addVolumetricIndustrialPrefabs',
    }),
  ];

  return createModule({
    id,
    sourceRoomId: 'conveyorRoom',
    sourceType: 'conveyor',
    displayName: 'V1 Conveyor Sorting Gantry',
    width: 21,
    depth: 17,
    ceilingHeight: 15.2,
    assetFamilyId: 'v1.factory-conveyor',
    topologyBuilder: topology,
    semanticRegions: [
      region('sorting', 'Sorting Gantry', 'automatic cargo sorting, ordinary encounter, optional routing puzzle, and Waterworks threshold', {
        kind: 'surface-and-fixture-zone',
        includeSourceSurfaces: ['conveyorPuzzleBelt', 'secondFloorConveyor', 'secondFloor', 'conveyorCrossBridge', 'thirdFloorGantry', 'industrialRamp'],
      }, { elevationBand: 'three-level' }),
    ],
    fixtures,
    landmarkAnchors: [
      landmark('anchor.encounter.sorting', 'sorting', 'ordinary V1 sorting encounter on open floor east of the puzzle', { x: 5 * TILE_SIZE, y: 0, z: 3 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 5, 3, 0).id,
        kind: 'encounter',
      }),
      landmark('anchor.cargo.spawner', 'sorting', 'V1 TwoRouteJunction cargo spawner', { x: -7 * TILE_SIZE, y: 0, z: -2 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, -7, -2, 0).id,
        kind: 'moving-cargo-spawner',
      }),
      landmark('anchor.cargo.receiver', 'sorting', 'V1 TwoRouteJunction receiver plate', { x: 4 * TILE_SIZE, y: 0, z: -2 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 4, -2, 0).id,
        kind: 'pressure-plate',
      }),
      landmark('anchor.cache.sorting', 'sorting', 'third-floor gantry reward', { x: -3 * TILE_SIZE, y: THIRD_FLOOR_ELEVATION, z: 3 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, -3, 3, THIRD_FLOOR_ELEVATION).id,
        kind: 'salvage-cache',
      }),
    ],
    socketSpecs: [
      {
        suffix: 'ground.north-east-bucket', form: 'ground-bulkhead', side: 'north', tileX: 6, tileZ: -8, approachTiles: [[6, -8], [6, -7], [6, -6]], semanticRegionIds: ['sorting'], purpose: 'new off-center sorting-floor entrance clear of cargo routing', destinationTags: ['factory'],
      },
      {
        suffix: 'catwalk.west-south-bucket', form: 'elevated-catwalk', side: 'west', tileX: -10, tileZ: 5, elevation: SECOND_FLOOR_ELEVATION, approachTiles: [[-10, 5, SECOND_FLOOR_ELEVATION], [-9, 5, SECOND_FLOOR_ELEVATION], [-8, 5, SECOND_FLOOR_ELEVATION]], semanticRegionIds: ['sorting'], purpose: 'new elevated sorting bridge from the supported west gantry', destinationTags: ['factory', 'upper-route'],
      },
      {
        suffix: 'pipe.east-north-bucket', form: 'pipe-water-breach', side: 'east', tileX: 10, tileZ: -5, approachTiles: [[10, -5], [9, -5], [8, -5]], semanticRegionIds: ['sorting'], purpose: 'new pipe breach descending into Waterworks', destinationTags: ['waterworks'],
      },
      {
        suffix: 'lift.south-west-bucket', form: 'cargo-lift', side: 'south', tileX: -6, tileZ: 8, approachTiles: [[-6, 8], [-6, 7], [-6, 6]], semanticRegionIds: ['sorting'], purpose: 'new automatic recallable lift return from Waterworks', destinationTags: ['waterworks', 'shortcut'],
      },
    ],
    sourceReferences: [
      ...COMMON_ROOM_SOURCE_REFERENCES,
      sourceReference('_createTwoRouteConveyorPuzzleDefinition', 2354, 2449, 'exact V1 difficulty-one conveyor belt graph and cargo anchors'),
      sourceReference('_createFactoryLevelTiles.conveyorRoom', 4206, 4261, 'exact elevated conveyor, west mass, cross bridge, third-floor gantry, and two authored ramps'),
    ],
    sourceVariants: ['SimpleRedirect', 'TwoRouteJunction', 'ReturnLoop', 'MultiStageRouting'],
    compositionNotes: [
      'The fixed catalog uses the V1 TwoRouteJunction variant; later plan selection may expose the other transcribed V1 puzzle graphs as revisions.',
      'Moving cargo remains elevated/functional where it serves the second-floor and third-floor sorting routes.',
    ],
  });
}

function buildPartsVaultModule() {
  const id = 'v1-room.parts-vault';
  const topology = createTopologyBuilder(id, 'bonusVault', 'bonus', 15, 13);
  topology.markBaseRect({
    level: 0.1,
    elevation: 0.42,
    surface: 'vaultRewardDais',
    minX: -1,
    maxX: 1,
    minZ: -1,
    maxZ: 1,
    supportStyle: 'solid_mass',
    purpose: 'V1 parts-vault reward dais',
  });
  const surfaces = [...topology.surfaces.values()];
  const halfW = 7 * TILE_SIZE;
  const halfD = 6 * TILE_SIZE;
  const fixtures = [];
  for (const sign of [-1, 1]) {
    fixtures.push(
      fixture(id, `reserve-tank-${sign < 0 ? 'west' : 'east'}`, 'sealed-reserve-tank', { x: sign * halfW * 0.58, y: 1.9, z: -halfD * 0.45 }, { x: 1.25, y: 1.9, z: 1.25 }, {
        prefabId: 'legacy-water-tank',
        collisionMode: 'blocking',
        authoredUniformScale: 0.92,
        assetFamilyId: 'v1.parts-warehouse',
        purpose: 'V1 reserve tank at its authored preferred anchor',
        sourceSymbol: '_addVolumetricIndustrialPrefabs',
      }),
      fixture(id, `storage-rack-${sign < 0 ? 'west' : 'east'}`, 'parts-storage-rack', { x: sign * 0.95, y: 0.6, z: 0.92 }, { x: 0.36, y: 0.6, z: 0.18 }, {
        prefabId: 'legacy-storage-rack',
        collisionMode: 'blocking',
        authoredUniformScale: 0.25,
        assetFamilyId: 'v1.parts-warehouse',
        purpose: 'V1 central parts rack',
        sourceSymbol: '_addIndustrialRoomSetpieces',
      }),
    );
  }

  return createModule({
    id,
    sourceRoomId: 'bonusVault',
    sourceType: 'bonus',
    displayName: 'V1 Parts Storage Vault',
    width: 15,
    depth: 13,
    ceilingHeight: 12.8,
    assetFamilyId: 'v1.parts-warehouse',
    topologyBuilder: topology,
    semanticRegions: [
      region('parts', 'Parts Warehouse', 'treasure warehouse with reserve tanks, parts racks, and branching service exits', {
        kind: 'surface-and-fixture-zone',
        includeSourceSurfaces: ['vaultSanctumFloor', 'vaultRewardDais', 'raisedDeck'],
      }),
    ],
    fixtures,
    landmarkAnchors: [
      landmark('anchor.cache.parts', 'parts', 'V1 focal reward on the supported center dais', { x: 0, y: 0.42, z: 0 }, {
        surfaceId: surfaceAt(surfaces, 0, 0, 0.42).id,
        kind: 'salvage-cache',
      }),
      landmark('anchor.shortcut.parts', 'parts', 'warehouse shortcut control beside a clear east landing', { x: 5 * TILE_SIZE, y: 0, z: 3 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 5, 3, 0).id,
        kind: 'shortcut-control',
      }),
    ],
    socketSpecs: [
      {
        suffix: 'ground.south-east-bucket', form: 'ground-bulkhead', side: 'south', tileX: 5, tileZ: 6, approachTiles: [[5, 6], [5, 5], [5, 4]], semanticRegionIds: ['parts'], purpose: 'new off-center warehouse entry', destinationTags: ['factory'],
      },
      {
        suffix: 'lift.east-south-bucket', form: 'cargo-lift', side: 'east', tileX: 7, tileZ: 4, approachTiles: [[7, 4], [6, 4], [5, 4]], semanticRegionIds: ['parts'], purpose: 'new external automatic lift serving the warehouse branch', destinationTags: ['vertical-transition', 'shortcut'],
      },
      {
        suffix: 'ladder.ceiling-west-north', form: 'service-ladder', side: 'ceiling', tileX: -5, tileZ: -4, approachTiles: [[-5, -4], [-4, -4]], semanticRegionIds: ['parts'], purpose: 'new ladder into overhead pipe and storage routes', destinationTags: ['upper-route'],
      },
    ],
    sourceReferences: [
      ...COMMON_ROOM_SOURCE_REFERENCES,
      sourceReference('_generateOnce.bonusVault', 1341, 1361, 'V1 13/15-tile vault width variants and reward-room role'),
      sourceReference('_createFactoryLevelTiles.bonusVault', 4367, 4382, 'exact supported center reward dais'),
    ],
    sourceVariants: ['13x13-footprint', '15x13-footprint'],
    compositionNotes: [
      'The catalog uses the larger 15x13 V1 footprint so new sockets do not consume the reward aisle.',
      'This module is a branch/reward room and cannot be the only path to a required control.',
    ],
  });
}

function buildMachineCoreModule() {
  const id = 'v1-room.machine-core';
  const topology = createTopologyBuilder(id, 'bossRoom', 'boss', 21, 19, {
    centerType: 'boss',
  });
  const surfaces = [...topology.surfaces.values()];
  const halfW = 10 * TILE_SIZE;
  const halfD = 9 * TILE_SIZE;
  const fixtures = [
    fixture(id, 'colossal-engine', 'colossal-dormant-engine', { x: -halfW * 0.64 - 0.247, y: 2.873, z: 0 }, { x: 2.457, y: 2.873, z: 3.64 }, {
      prefabId: 'legacy-fixed-industrial-engine',
      collisionMode: 'blocking',
      authoredUniformScale: 1.3,
      yawQuarterTurns: 1,
      sourceArguments: { scale: 1.3, yawQuarterTurns: 1 },
      assetFamilyId: 'v1.machine-core',
      purpose: 'V1 boss-room colossal engine at its authored preferred anchor',
      sourceSymbol: '_addVolumetricIndustrialPrefabs',
    }),
    fixture(id, 'south-load-bearing-girder', 'load-bearing-girder', { x: 0, y: 3.5, z: halfD * 0.58 }, { x: halfW * 1.28 * 0.5, y: 3.5, z: 0.42 }, {
      prefabId: 'legacy-girder-frame',
      collisionMode: 'compound-blocking',
      collisionParts: [
        { id: 'west-column', center: { x: -halfW * 1.28 * 0.5, y: 3.5, z: halfD * 0.58 }, halfSize: { x: 0.42, y: 3.5, z: 0.42 } },
        { id: 'east-column', center: { x: halfW * 1.28 * 0.5, y: 3.5, z: halfD * 0.58 }, halfSize: { x: 0.42, y: 3.5, z: 0.42 } },
      ],
      sourceArguments: { width: halfW * 1.28, height: 7 },
      assetFamilyId: 'v1.machine-core',
      purpose: 'V1 boss-room structural frame',
      sourceSymbol: '_addVolumetricIndustrialPrefabs',
    }),
  ];

  return createModule({
    id,
    sourceRoomId: 'bossRoom',
    sourceType: 'boss',
    displayName: 'V1 Machine Core Arena',
    width: 21,
    depth: 19,
    ceilingHeight: WALL_HEIGHT,
    assetFamilyId: 'v1.machine-core',
    topologyBuilder: topology,
    semanticRegions: [
      region('corkscrew', 'Corkscrew Machine Hall', 'new gear-platform exploration branch anchored to the V1 arena perimeter', {
        kind: 'extension-zone',
        extensionSocketId: `socket.${id}.gear.north-upper`,
      }, { elevationBand: 'upper' }),
      region('machine-core', 'Machine Core', 'V1 final arena embedded in the colossal engine and containment ring', {
        kind: 'surface-and-fixture-zone',
        includeSourceSurfaces: ['boss', 'catwalk', 'raisedDeck'],
      }, { elevationBand: 'multi-level' }),
    ],
    fixtures,
    landmarkAnchors: [
      landmark('anchor.encounter.machine-core', 'machine-core', 'V1 arena center for the final elite encounter', { x: 0, y: 0, z: 0 }, {
        surfaceId: surfaceAt(surfaces, 0, 0, 0).id,
        kind: 'final-elite-encounter',
      }),
      landmark('anchor.reward.shrine-key', 'machine-core', 'Shrine Key reward after the final elite, away from the engine blocker', { x: 4 * TILE_SIZE, y: 0, z: 2 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 4, 2, 0).id,
        kind: 'elite-reward',
      }),
    ],
    socketSpecs: [
      {
        suffix: 'ground.west-south-bucket', form: 'ground-bulkhead', side: 'west', tileX: -10, tileZ: 6, approachTiles: [[-9, 6], [-8, 6], [-7, 6]], semanticRegionIds: ['machine-core'], purpose: 'final-gate entrance outside the colossal engine footprint', destinationTags: ['factory', 'gated'],
      },
      {
        suffix: 'gear.north-upper', form: 'elevated-catwalk', side: 'north', tileX: 4, tileZ: -9, elevation: FACTORY_ELEVATION, approachTiles: [[4, -9, FACTORY_ELEVATION], [3, -9, FACTORY_ELEVATION], [2, -9, FACTORY_ELEVATION]], semanticRegionIds: ['corkscrew', 'machine-core'], purpose: 'new supported entrance to the corkscrew mechanism branch', destinationTags: ['upper-route', 'mechanism:corkscrew'],
      },
      {
        suffix: 'ground.east-north-bucket', form: 'ground-bulkhead', side: 'east', tileX: 10, tileZ: -6, approachTiles: [[9, -6], [8, -6], [7, -6]], semanticRegionIds: ['machine-core'], purpose: 'Shrine bridge exit after the final elite', destinationTags: ['shrine', 'gated'],
      },
      {
        suffix: 'lower.undercroft-mouth', form: 'intentional-lower-zone', side: 'interior-floor', tileX: 5, tileZ: 5, apertureTiles: [[5, 5]], approachTiles: [[4, 5], [3, 5], [2, 5]], semanticRegionIds: ['corkscrew'], purpose: 'signaled descent from the machinery branch to a playable Undercroft', direction: 'forward-with-authored-return', destinationTags: ['undercroft', 'damage-free-catchment'],
      },
    ],
    sourceReferences: [
      ...COMMON_ROOM_SOURCE_REFERENCES,
      sourceReference('_markRoomCatwalks.boss', 6470, 6480, 'exact V1 raised north/south edges and east/west containment catwalks'),
      sourceReference('_addVolumetricIndustrialPrefabs.boss', 9238, 9253, 'exact colossal engine and load-bearing girder preferred anchors'),
    ],
    compositionNotes: [
      'The V1 boss arena remains intact. Corkscrew traversal is an attached authored sub-zone, not props sliding across its combat floor.',
      'The final elite alone awards Shrine Key; merely reaching this module does not.',
    ],
  });
}

function buildRefractorShrineModule() {
  const id = 'v1-room.refractor-shrine';
  const topology = createTopologyBuilder(id, 'shrineRoom', 'shrine', 25, 23, {
    centerType: 'shrine',
  });
  for (const surface of topology.surfaces.values()) {
    if (surface.sourceSurface !== 'catwalk' || surface.localTile.level !== 0) continue;
    surface.center.y = SHRINE_LOWER_CATWALK_ELEVATION;
    surface.topY = SHRINE_LOWER_CATWALK_ELEVATION;
    surface.purpose = 'V1 lower shrine perimeter catwalk with V2 player-headroom clearance';
  }
  topology.addDeck({
    level: 1,
    elevation: SECOND_FLOOR_ELEVATION,
    surface: 'reveredMezzanine',
    minX: -12,
    maxX: 12,
    minZ: -11,
    maxZ: 11,
    ring: true,
    purpose: 'V1 full shrine perimeter mezzanine',
  });
  topology.markBaseRect({ elevation: 0, level: 0, surface: 'shrineSanctumFloor', minX: -2, maxX: 2, minZ: -2, maxZ: 2 });
  topology.addDeck({
    level: 2,
    elevation: THIRD_FLOOR_ELEVATION,
    surface: 'refractorDais',
    minX: -2,
    maxX: 2,
    minZ: -2,
    maxZ: 2,
    supportStyle: 'solid_mass',
    purpose: 'V1 elevated Large Refractor sanctum',
  });
  topology.addRamp([
    { x: -11, z: -10 },
    { x: -11, z: 10 },
  ], 0, SECOND_FLOOR_ELEVATION, 0, 1, 'ramp.refractor-shrine.ground-to-mezzanine');
  topology.addRamp([
    { x: 11, z: 10 },
    { x: 11, z: -2 },
    { x: 2, z: -2 },
  ], SECOND_FLOOR_ELEVATION, THIRD_FLOOR_ELEVATION, 1, 2, 'ramp.refractor-shrine.mezzanine-to-dais');
  const surfaces = [...topology.surfaces.values()];
  const fixtures = [];
  const pillarOffsets = [[-3.15, 1.525], [3.15, 1.525], [0, -3.05]];
  pillarOffsets.forEach(([x, z], index) => fixtures.push(fixture(id, `focal-pillar-${index + 1}`, 'shrine-focal-monolith', {
    x,
    y: THIRD_FLOOR_ELEVATION + 1.7336,
    z,
  }, { x: 1.1583, y: 1.7336, z: 1.1583 }, {
    prefabId: 'legacy-shrine-monolith',
    collisionMode: 'blocking',
    authoredUniformScale: 0.78,
    assetFamilyId: 'v1.refractor-shrine',
    purpose: 'V1 triple-pillar refractor sanctum',
    sourceSymbol: '_addVolumetricIndustrialPrefabs',
  })));
  fixtures.push(fixture(id, 'north-cylinder-arch', 'shrine-cylinder-arch', { x: 0, y: 3.1, z: -11 * TILE_SIZE * 0.62 }, { x: 3.7, y: 3.1, z: 0.5 }, {
    prefabId: 'legacy-girder-frame',
    collisionMode: 'compound-blocking',
    collisionParts: [
      { id: 'west-column', center: { x: -3.7, y: 3.1, z: -11 * TILE_SIZE * 0.62 }, halfSize: { x: 0.5, y: 3.1, z: 0.5 } },
      { id: 'east-column', center: { x: 3.7, y: 3.1, z: -11 * TILE_SIZE * 0.62 }, halfSize: { x: 0.5, y: 3.1, z: 0.5 } },
    ],
    sourceArguments: { width: 7.4, height: 6.2 },
    assetFamilyId: 'v1.refractor-shrine',
    purpose: 'V1 shrine processional arch',
    sourceSymbol: '_addVolumetricIndustrialPrefabs',
  }));

  return createModule({
    id,
    sourceRoomId: 'shrineRoom',
    sourceType: 'shrine',
    displayName: 'V1 Large Refractor Shrine',
    width: 25,
    depth: 23,
    ceilingHeight: 15.2,
    assetFamilyId: 'v1.refractor-shrine',
    topologyBuilder: topology,
    semanticRegions: [
      region('extraction', 'Shrine and Extraction', 'V1 three-tier machine chapel containing the Large Refractor and sealed extraction pad', {
        kind: 'surface-and-fixture-zone',
        includeSourceSurfaces: ['shrineSanctumFloor', 'reveredMezzanine', 'refractorDais', 'industrialRamp'],
      }, { elevationBand: 'three-level' }),
    ],
    fixtures,
    landmarkAnchors: [
      landmark('anchor.reward.large-refractor', 'extraction', 'V1 Large Refractor focus on the third-floor dais', { x: 0, y: THIRD_FLOOR_ELEVATION, z: 0 }, {
        surfaceId: surfaceAt(surfaces, 0, 0, THIRD_FLOOR_ELEVATION).id,
        kind: 'large-refractor',
      }),
      landmark('anchor.extraction', 'extraction', 'safe extraction pad after collecting the Large Refractor', { x: 0, y: 0, z: 6 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 0, 6, 0).id,
        kind: 'extraction',
      }),
      landmark('anchor.safe-return.extraction', 'extraction', 'plan-safe recovery anchor on the uncluttered sanctum floor', { x: 4 * TILE_SIZE, y: 0, z: 5 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 4, 5, 0).id,
        kind: 'safe-return',
      }),
    ],
    socketSpecs: [
      {
        suffix: 'ground.south-west-bucket', form: 'ground-bulkhead', side: 'south', tileX: -7, tileZ: 11, approachTiles: [[-7, 11], [-7, 10], [-7, 9]], semanticRegionIds: ['extraction'], purpose: 'Shrine Key gate entry away from both authored ramps', destinationTags: ['factory', 'gated'],
      },
      {
        suffix: 'catwalk.north-east-bucket', form: 'elevated-catwalk', side: 'north', tileX: 7, tileZ: -11, elevation: SECOND_FLOOR_ELEVATION, approachTiles: [[7, -11, SECOND_FLOOR_ELEVATION], [6, -11, SECOND_FLOOR_ELEVATION], [5, -11, SECOND_FLOOR_ELEVATION]], semanticRegionIds: ['extraction'], purpose: 'optional elevated reveal into the shrine mezzanine', destinationTags: ['upper-route'],
      },
    ],
    sourceReferences: [
      ...COMMON_ROOM_SOURCE_REFERENCES,
      sourceReference('_createFactoryLevelTiles.shrineRoom', 4317, 4366, 'exact perimeter mezzanine, central sanctum, third-floor dais, and both authored ramps'),
      sourceReference('_addVolumetricIndustrialPrefabs.shrine', 9254, 9306, 'exact triple-pillar sanctum and cylinder-arch placement'),
    ],
    compositionNotes: [
      'The V1 shrine topology, ramps, and three focal pillars are preserved without flattening.',
      'Extraction remains a real child action anchored to a walkable surface, not a mesh-name scan.',
    ],
  });
}

function buildCoolantRelayModule() {
  const id = 'v1-room.coolant-relay';
  const topology = createTopologyBuilder(id, 'coolantRelayRoom', 'coolant', 19, 17);
  topology.markBaseRect({
    elevation: 0,
    level: 0,
    surface: 'coolantValveDeck',
    minX: -4,
    maxX: 4,
    minZ: -3,
    maxZ: 3,
  });
  topology.markBaseRect({
    level: -1,
    elevation: LOWER_SERVICE_ELEVATION,
    surface: 'coolantServicePit',
    minX: -2,
    maxX: 2,
    minZ: -2,
    maxZ: 2,
    purpose: 'V1 lowered coolant service pit',
  });
  topology.addDeck({
    level: 1,
    elevation: SECOND_FLOOR_ELEVATION,
    surface: 'coolantControlBalcony',
    minX: -4,
    maxX: 4,
    minZ: -7,
    maxZ: -6,
    purpose: 'V1 permanently dry north control balcony',
  });
  const surfaces = [...topology.surfaces.values()];
  const collisionHalfW = 9 * TILE_SIZE - 0.7;
  const collisionHalfD = 8 * TILE_SIZE - 0.7;
  const fixtures = [
    fixture(id, 'central-machine-base', 'coolant-central-machine-base', { x: 0, y: 0.17, z: 0 }, { x: 0.7316, y: 0.17, z: 0.7316 }, {
      prefabId: 'legacy-fixed-coolant-machine-base',
      collisionMode: 'blocking',
      purpose: 'exact V1 coolant machine-base reservation', sourceSymbol: '_getCoolantFixtureSpecs',
    }),
    fixture(id, 'pressure-core', 'coolant-pressure-core', { x: 0, y: 1.2, z: 0 }, { x: 0.4956, y: 1.2, z: 0.4956 }, {
      prefabId: 'legacy-fixed-coolant-pressure-core',
      collisionMode: 'blocking',
      purpose: 'exact V1 pressure-core reservation', sourceSymbol: '_getCoolantFixtureSpecs',
    }),
  ];
  const coolantTankSpecs = [
    ['source-a', -collisionHalfW * 0.74, -collisionHalfD * 0.68, 'legacy-glow-blue'],
    ['source-b', collisionHalfW * 0.74, -collisionHalfD * 0.68, 'legacy-glow-yellow'],
    ['source-c', -collisionHalfW * 0.74, collisionHalfD * 0.68, 'legacy-glow-violet'],
  ];
  coolantTankSpecs.forEach(([name, x, z, accentMaterialProfileId]) => fixtures.push(fixture(id, `tank-${name}`, 'coolant-source-tank', { x, y: 0.83, z: z - 0.025 }, { x: 0.41, y: 0.83, z: 0.435 }, {
    prefabId: 'legacy-fixed-coolant-source-tank',
    collisionMode: 'blocking',
    sourceArguments: { accentMaterialProfileId },
    purpose: 'exact V1 coolant tank occupied reservation', sourceSymbol: '_getCoolantFixtureSpecs',
  })));
  fixtures.push(fixture(id, 'tank-overflow', 'coolant-overflow-tank', { x: collisionHalfW * 0.74, y: 0.64, z: collisionHalfD * 0.68 }, { x: 0.3776, y: 0.64, z: 0.3776 }, {
    prefabId: 'legacy-fixed-coolant-overflow-tank',
    collisionMode: 'blocking',
    purpose: 'exact V1 overflow tank occupied reservation', sourceSymbol: '_getCoolantFixtureSpecs',
  }));
  const valveSpecs = [
    ['a', -collisionHalfW * 0.34, -collisionHalfD * 0.08, 'legacy-glow-blue'],
    ['b', collisionHalfW * 0.34, -collisionHalfD * 0.08, 'legacy-glow-yellow'],
    ['c', 0, collisionHalfD * 0.44, 'legacy-glow-violet'],
  ];
  valveSpecs.forEach(([name, x, z, accentMaterialProfileId]) => fixtures.push(fixture(id, `valve-${name}`, 'coolant-valve-pylon', { x, y: 0.74, z }, { x: 0.3068, y: 0.74, z: 0.3068 }, {
    prefabId: 'legacy-fixed-coolant-valve-pylon',
    collisionMode: 'blocking',
    sourceArguments: { accentMaterialProfileId },
    purpose: 'exact V1 coolant valve-pylon reservation', sourceSymbol: '_getCoolantFixtureSpecs',
  })));
  const terminalSpecs = [
    ['a', -collisionHalfW * 0.44, collisionHalfD * 0.08, 'legacy-glow-blue'],
    ['b', collisionHalfW * 0.44, collisionHalfD * 0.08, 'legacy-glow-yellow'],
    ['c', 0, collisionHalfD * 0.66, 'legacy-glow-violet'],
  ];
  terminalSpecs.forEach(([name, x, z, accentMaterialProfileId]) => fixtures.push(fixture(id, `terminal-${name}`, 'coolant-valve-terminal', { x, y: 0.47, z: z - 0.03 }, { x: 0.38, y: 0.47, z: 0.25 }, {
    prefabId: 'legacy-fixed-coolant-valve-terminal',
    collisionMode: 'blocking',
    sourceArguments: { accentMaterialProfileId },
    purpose: 'exact V1 coolant terminal reservation', sourceSymbol: '_getCoolantFixtureSpecs',
  })));
  fixtures.push(
    fixture(id, 'master-console', 'coolant-master-pressure-console', { x: 0, y: SECOND_FLOOR_ELEVATION + 0.41, z: -collisionHalfD * 0.82 - 0.04 }, { x: 0.59, y: 0.41, z: 0.3 }, {
      prefabId: 'legacy-fixed-coolant-master-console',
      collisionMode: 'blocking',
      purpose: 'exact V1 dry master-console reservation', sourceSymbol: '_getCoolantFixtureSpecs',
    }),
    fixture(id, 'main-circulation-pump', 'coolant-circulation-pump', { x: 9 * TILE_SIZE * 0.66, y: 1.1918, z: -8 * TILE_SIZE * 0.42 }, { x: 2.006, y: 1.1918, z: 1.4898 }, {
      prefabId: 'legacy-circulation-pump', collisionMode: 'blocking', authoredUniformScale: 1.18, assetFamilyId: 'v1.coolant-relay', purpose: 'V1 main pump at its authored preferred anchor', sourceSymbol: '_addVolumetricIndustrialPrefabs',
    }),
    fixture(id, 'massive-water-tank', 'coolant-massive-water-tank', { x: -9 * TILE_SIZE * 0.7, y: 2.4721, z: -8 * TILE_SIZE * 0.66 }, { x: 1.4396, y: 2.4721, z: 1.4396 }, {
      prefabId: 'legacy-water-tank', collisionMode: 'blocking', authoredUniformScale: 1.18, assetFamilyId: 'v1.coolant-relay', purpose: 'V1 massive coolant tank at its authored preferred anchor', sourceSymbol: '_addVolumetricIndustrialPrefabs',
    }),
  );

  return createModule({
    id,
    sourceRoomId: 'coolantRelayRoom',
    sourceType: 'coolant',
    displayName: 'V1 Coolant Relay Waterworks',
    width: 19,
    depth: 17,
    ceilingHeight: 15.2,
    assetFamilyId: 'v1.coolant-relay',
    topologyBuilder: topology,
    semanticRegions: [
      region('freight-sump', 'Freight Sump', 'west side of the V1 coolant deck and drainable service-pit catchment', {
        kind: 'local-tile-zone', minX: -4, maxX: -1, minZ: -3, maxZ: 3, includeLevels: [-1, 0],
      }, { district: 'waterworks', elevationBand: 'lower' }),
      region('reservoir', 'Reservoir Pump Gallery', 'permanently dry V1 north balcony, master router, reservoir machinery, and pump controls', {
        kind: 'local-tile-zone', minX: -4, maxX: 4, minZ: -7, maxZ: -4, includeLevels: [0, 1],
      }, { district: 'waterworks', elevationBand: 'upper' }),
      region('gantry-sump', 'Gantry Sump', 'east side of the V1 coolant deck, tank gallery, and submerged traversal route', {
        kind: 'local-tile-zone', minX: 0, maxX: 4, minZ: -3, maxZ: 3, includeLevels: [-1, 0],
      }, { district: 'waterworks', elevationBand: 'lower' }),
      region('salvage-tunnel', 'Drained Salvage Tunnel', 'south service perimeter and new pipe-breach branch used for Beta exploration and lift return', {
        kind: 'local-tile-zone', minX: -8, maxX: 8, minZ: 4, maxZ: 8, includeLevels: [0], extensionSocketId: `socket.${id}.pipe.east-center`,
      }, { district: 'waterworks' }),
    ],
    fixtures,
    landmarkAnchors: [
      landmark('anchor.water-router', 'reservoir', 'permanently dry master water router on the V1 north balcony', { x: 0, y: SECOND_FLOOR_ELEVATION, z: -7 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 0, -7, SECOND_FLOOR_ELEVATION).id,
        kind: 'water-router',
      }),
      landmark('anchor.key.beta', 'salvage-tunnel', 'remote Beta pedestal on the south service perimeter, away from its gate', { x: -5 * TILE_SIZE, y: 0, z: 6 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, -5, 6, 0).id,
        kind: 'credential-pedestal',
      }),
      landmark('anchor.discovery.flooded', 'freight-sump', 'flooded-only Waterworks discovery', { x: -2 * TILE_SIZE, y: LOWER_SERVICE_ELEVATION, z: 0 }, {
        surfaceId: surfaceAt(surfaces, -2, 0, LOWER_SERVICE_ELEVATION).id,
        kind: 'stateful-discovery',
      }),
      landmark('anchor.discovery.drained', 'salvage-tunnel', 'drained-only salvage discovery', { x: 5 * TILE_SIZE, y: 0, z: 6 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 5, 6, 0).id,
        kind: 'stateful-discovery',
      }),
    ],
    socketSpecs: [
      {
        suffix: 'ground.south-west-bucket', form: 'ground-bulkhead', side: 'south', tileX: -5, tileZ: 8, approachTiles: [[-5, 8], [-5, 7], [-5, 6]], semanticRegionIds: ['salvage-tunnel'], purpose: 'ground Waterworks threshold outside all tanks and controls', destinationTags: ['waterworks'],
      },
      {
        suffix: 'catwalk.north-east-bucket', form: 'elevated-catwalk', side: 'north', tileX: 4, tileZ: -8, elevation: SECOND_FLOOR_ELEVATION, approachTiles: [[4, -7, SECOND_FLOOR_ELEVATION], [3, -7, SECOND_FLOOR_ELEVATION], [3, -6, SECOND_FLOOR_ELEVATION]], semanticRegionIds: ['reservoir'], purpose: 'new elevated balcony bridge away from the master console', destinationTags: ['waterworks', 'upper-route'],
      },
      {
        suffix: 'pipe.east-center', form: 'pipe-water-breach', side: 'east', tileX: 9, tileZ: 0, approachTiles: [[9, 0], [8, 0], [7, 0]], semanticRegionIds: ['gantry-sump', 'salvage-tunnel'], purpose: 'new large pipe tunnel between the coolant relay and a playable water zone', destinationTags: ['waterworks', 'water-basin'],
      },
      {
        suffix: 'lift.west-center', form: 'cargo-lift', side: 'west', tileX: -9, tileZ: 0, elevation: FACTORY_ELEVATION, approachTiles: [[-9, 0, FACTORY_ELEVATION], [-9, 1, FACTORY_ELEVATION], [-9, 2, FACTORY_ELEVATION]], semanticRegionIds: ['freight-sump', 'salvage-tunnel'], purpose: 'new automatic recallable Waterworks shortcut lift on the existing supported V1 perimeter landing', destinationTags: ['factory', 'shortcut'],
      },
    ],
    sourceReferences: [
      ...COMMON_ROOM_SOURCE_REFERENCES,
      sourceReference('_getCoolantFixtureSpecs', 5107, 5236, 'exact coolant tank, valve, terminal, master-console, and core occupied-volume formulae'),
      sourceReference('_createFactoryLevelTiles.coolantRelayRoom', 4169, 4205, 'exact valve deck, lowered service pit, and north control balcony'),
    ],
    compositionNotes: [
      'The four Waterworks semantic regions are sub-zones of one V1 coolant-relay chamber rather than four blank V2 boxes.',
      'The master router stays on permanent dry ground; the north socket is offset east so its landing and controls cannot overlap.',
    ],
  });
}

function buildHazardProcessingModule() {
  const id = 'v1-room.hazard-processing';
  const topology = createTopologyBuilder(id, 'trapRoom', 'trap', 17, 15);
  const lowerZoneTiles = new Map();
  const addLowerTile = (x, z, sourceSurface = 'undercroftHazardFloor') => {
    lowerZoneTiles.set(tileColumnKey(x, z), { x, z, sourceSurface });
  };
  // Purpose-built V2 lower sub-zone: a broad processing cavern with two pipe
  // galleries and cache alcoves. It deliberately does not reproduce V1's
  // square trap divot or its precision ledge-climb shelf.
  for (let x = -5; x <= 5; x += 1) {
    for (let z = -3; z <= 3; z += 1) addLowerTile(x, z);
  }
  for (let x = -2; x <= 2; x += 1) {
    for (let z = -5; z <= -4; z += 1) addLowerTile(x, z, 'undercroftPipeGallery');
  }
  for (let x = 1; x <= 5; x += 1) {
    for (let z = 4; z <= 5; z += 1) addLowerTile(x, z, 'undercroftSalvageBranch');
  }
  for (const { x, z, sourceSurface } of lowerZoneTiles.values()) {
    topology.setBase(x, z, {
      level: -1,
      elevation: MINOR_DROP_ELEVATION,
      surface: sourceSurface,
      purpose: sourceSurface === 'undercroftHazardFloor'
        ? 'playable lower hazard-processing cavern'
        : 'playable lower pipe-and-salvage exploration branch',
      tags: ['v2-purpose-built-undercroft', 'playable-lower-destination'],
      supportStyle: 'supported-undercroft-foundation',
    });
  }
  const catchment = topology.surfaces.get(surfaceKey(-5, 0, 0));
  catchment.collision.allowsGroundedDropLanding = true;
  catchment.tags = [...(catchment.tags ?? []), 'damage-free-drop-catchment'];

  const returnRouteId = 'stairs.hazard-processing.lower-return';
  topology.addRamp([
    { x: 4, z: 3 },
    { x: 7, z: 3 },
    { x: 7, z: -6 },
    { x: 5, z: -6 },
  ], MINOR_DROP_ELEVATION, 0, -1, 0, returnRouteId);
  for (const surface of topology.surfaces.values()) {
    if (surface.ramp?.routeId !== returnRouteId && !surface.tags?.includes(returnRouteId)) continue;
    surface.sourceSurface = surface.shape === 'ramp-tile'
      ? 'undercroftReturnStair'
      : 'undercroftReturnLanding';
    surface.materialProfileId = 'legacy-raised-deck';
    surface.purpose = surface.shape === 'ramp-tile'
      ? 'flush continuous walking stair from the lower sub-zone'
      : 'wide flush stair landing aligned to the adjoining deck';
    surface.collision = {
      ...surface.collision,
      mode: 'walkable',
      supportsGroundedTraversal: true,
      ordinaryStairs: true,
      ledgeClimbDisabled: true,
      maximumEndpointGap: 0,
    };
    surface.tags = [...new Set([...(surface.tags ?? []), returnRouteId, 'walkable-stairs-no-ledge-climb'])];
  }
  // The west pipe breach is intentionally ground-level. Remove only the
  // perimeter catwalk tile occupying its aperture so its declared sill and
  // physical boundary landing are the same surface.
  topology.setBase(-8, 5, {
    elevation: 0,
    level: 0,
    surface: 'hazardPipeGroundThreshold',
    purpose: 'flush ground threshold for the Waterworks pipe breach',
    tags: ['v2-purpose-built-undercroft', 'pipe-breach-threshold'],
  });
  const surfaces = topology.finalize();
  const halfW = 8 * TILE_SIZE;
  const halfD = 7 * TILE_SIZE;
  const fixtures = [];
  for (const sign of [-1, 1]) {
    fixtures.push(fixture(id, `processing-vat-${sign < 0 ? 'west' : 'east'}`, 'hazard-processing-vat', {
      x: sign * halfW * 0.62,
      y: 1.215,
      z: -halfD * 0.5,
    }, { x: 1.998, y: 1.215, z: 1.998 }, {
      prefabId: 'legacy-processing-vat',
      collisionMode: 'blocking',
      authoredUniformScale: 1.08,
      assetFamilyId: 'v1.freight-recovery',
      purpose: 'V1 hazard-processing vat at its authored preferred anchor',
      sourceSymbol: '_addVolumetricIndustrialPrefabs',
    }));
  }

  return createModule({
    id,
    sourceRoomId: 'trapRoom',
    sourceType: 'trap',
    displayName: 'V1 Hazard Processing Undercroft',
    width: 17,
    depth: 15,
    ceilingHeight: 12.8,
    assetFamilyId: 'v1.freight-recovery',
    topologyBuilder: topology,
    semanticRegions: [
      region('hazard-intake', 'Hazard Intake', 'signaled upper processing rim and intentional damage-free descent', {
        kind: 'local-tile-zone', minX: -8, maxX: 8, minZ: -7, maxZ: 7, excludeRect: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 }, includeLevels: [0],
      }, { district: 'undercroft' }),
      region('hazard-core', 'Hazard Core', 'purpose-built lower processing cavern, pipe branches, Gamma cache, and continuous stair return', {
        kind: 'surface-source-prefixes', prefixes: ['undercroftHazard', 'undercroftPipe', 'undercroftSalvage', 'undercroftReturn'],
      }, { district: 'undercroft', elevationBand: 'lower' }),
    ],
    fixtures,
    landmarkAnchors: [
      landmark('anchor.key.gamma', 'hazard-core', 'remote Gamma pedestal on the playable lower floor', { x: 2 * TILE_SIZE, y: MINOR_DROP_ELEVATION, z: 2 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 2, 2, MINOR_DROP_ELEVATION).id,
        kind: 'credential-pedestal',
      }),
      landmark('anchor.cache.undercroft', 'hazard-core', 'major Undercroft cache on the opposite lower corner', { x: -2 * TILE_SIZE, y: MINOR_DROP_ELEVATION, z: 3 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, -2, 3, MINOR_DROP_ELEVATION).id,
        kind: 'salvage-cache',
      }),
      landmark('anchor.return.hazard', 'hazard-core', 'wide upper stair landing; no ledge climb or player rearm interaction', { x: 5 * TILE_SIZE, y: 0, z: -6 * TILE_SIZE }, {
        surfaceId: surfaceAt(surfaces, 5, -6, 0).id,
        kind: 'safe-return',
      }),
    ],
    socketSpecs: [
      {
        suffix: 'ground.south-east-bucket', form: 'ground-bulkhead', side: 'south', tileX: 6, tileZ: 7, approachTiles: [[6, 7], [6, 6], [6, 5]], semanticRegionIds: ['hazard-intake'], purpose: 'signaled upper hazard entrance outside the lower aperture', destinationTags: ['undercroft'],
      },
      {
        suffix: 'lower.intentional-west', form: 'intentional-lower-zone', side: 'interior-floor', tileX: -5, tileZ: 0, apertureMode: 'edge-between-levels', approachTiles: [[-6, 0], [-7, 0], [-7, 1]], semanticRegionIds: ['hazard-intake', 'hazard-core'], purpose: 'signaled drop lip into the damage-free lower pipe-processing cavern', direction: 'forward-with-authored-return', destinationTags: ['damage-free-catchment', 'lower-playable-region', 'walkable-stair-return'],
      },
      {
        suffix: 'lift.east-center', form: 'cargo-lift', side: 'east', tileX: 8, tileZ: 0, approachTiles: [[8, 0], [7, 0], [6, 0]], semanticRegionIds: ['hazard-intake', 'hazard-core'], purpose: 'new automatic recallable permanent return from the Undercroft', destinationTags: ['factory', 'shortcut'],
      },
      {
        suffix: 'pipe.west-south-bucket', form: 'pipe-water-breach', side: 'west', tileX: -8, tileZ: 5, approachTiles: [[-8, 5], [-7, 5], [-6, 5]], semanticRegionIds: ['hazard-intake'], purpose: 'optional pipe tunnel linking hazard processing to Waterworks service routes', destinationTags: ['waterworks', 'undercroft'],
      },
    ],
    sourceReferences: [
      ...COMMON_ROOM_SOURCE_REFERENCES,
      sourceReference('addMinorDropSpace', 3337, 3573, 'discarded V1 trap-divot reference; V2 retains only the damage-free playable-destination principle'),
      sourceReference('_createFactoryLevelTiles.trapRoom', 4159, 4168, 'V1 hazard-room shell and art source; its old trap floor topology is intentionally replaced'),
    ],
    sourceVariants: ['17x15-footprint', '17x17-footprint'],
    compositionNotes: [
      'There is no bottomless floor and no Rearm fracture floor action. The lower area is explicit walkable topology with hazards, treasure, pipe branches, and a physical return.',
      'The V1 17x15 room shell and processing-vat art remain source material; the rejected square trap divot and ledge-climb shelf are replaced by a purpose-built V2 undercroft and flush walking stair.',
    ],
  });
}

const MODULE_BUILDERS = Object.freeze([
  buildSecurityEntranceModule,
  buildMachineFactoryModule,
  buildServerCryptModule,
  buildConveyorGantryModule,
  buildCredentialPyramidModule,
  buildPartsVaultModule,
  buildEnemyNestModule,
  buildMachineCoreModule,
  buildRefractorShrineModule,
  buildCoolantRelayModule,
  buildHazardProcessingModule,
]);

export const LEGACY_FIXED_ROOM_MODULE_CATALOG_V2 = deepFreezePlan(
  MODULE_BUILDERS.map((buildModule) => buildModule()),
);

export const LEGACY_FIXED_ROOM_MODULE_IDS_V2 = Object.freeze(
  LEGACY_FIXED_ROOM_MODULE_CATALOG_V2.map((module) => module.id),
);

export const LEGACY_FIXED_ROOM_MODULE_BY_ID_V2 = deepFreezePlan(Object.fromEntries(
  LEGACY_FIXED_ROOM_MODULE_CATALOG_V2.map((module) => [module.id, module]),
));

export function getLegacyFixedRoomModuleV2(id) {
  return LEGACY_FIXED_ROOM_MODULE_BY_ID_V2[id] ?? null;
}

export function cloneLegacyFixedRoomModuleV2(id) {
  const descriptor = getLegacyFixedRoomModuleV2(id);
  return descriptor ? clonePlanData(descriptor) : null;
}

function boxesOverlap2d(center, halfSize, otherCenter, otherHalfSize, padding = 0) {
  return Math.abs(center.x - otherCenter.x) < halfSize.x + otherHalfSize.x + padding
    && Math.abs(center.z - otherCenter.z) < halfSize.z + otherHalfSize.z + padding;
}

function fixtureOccupiedParts(fixtureDescriptor) {
  if (fixtureDescriptor.collision.mode === 'compound-blocking') {
    return fixtureDescriptor.collision.parts;
  }
  if (fixtureDescriptor.collision.mode === 'blocking') {
    return [{
      id: 'aggregate',
      center: fixtureDescriptor.localBounds.center,
      halfSize: fixtureDescriptor.localBounds.halfSize,
    }];
  }
  if (
    fixtureDescriptor.collision.mode === 'reserved-only'
    && !['industrial-cylinder-arch', 'massive-girder-frame', 'load-bearing-girder', 'shrine-cylinder-arch', 'grand-mechanical-pyramid'].includes(fixtureDescriptor.kind)
  ) {
    return [{
      id: 'presentation-reservation',
      center: fixtureDescriptor.localBounds.center,
      halfSize: fixtureDescriptor.localBounds.halfSize,
    }];
  }
  return [];
}

function localSurfaceBounds(surface) {
  return {
    min: {
      x: surface.center.x - surface.size.x * 0.5,
      z: surface.center.z - surface.size.z * 0.5,
    },
    max: {
      x: surface.center.x + surface.size.x * 0.5,
      z: surface.center.z + surface.size.z * 0.5,
    },
  };
}

function planarPointInside(bounds, x, z, epsilon = 1e-6) {
  return x > bounds.min.x + epsilon && x < bounds.max.x - epsilon
    && z > bounds.min.z + epsilon && z < bounds.max.z - epsilon;
}

function rectanglesSharePlayableEdge(surface, landing, minimumWidth = 1.2) {
  const surfaceBounds = localSurfaceBounds(surface);
  const landingBounds = localSurfaceBounds(landing);
  const xOverlap = Math.min(surfaceBounds.max.x, landingBounds.max.x)
    - Math.max(surfaceBounds.min.x, landingBounds.min.x);
  const zOverlap = Math.min(surfaceBounds.max.z, landingBounds.max.z)
    - Math.max(surfaceBounds.min.z, landingBounds.min.z);
  const xGap = Math.max(
    landingBounds.min.x - surfaceBounds.max.x,
    surfaceBounds.min.x - landingBounds.max.x,
    0,
  );
  const zGap = Math.max(
    landingBounds.min.z - surfaceBounds.max.z,
    surfaceBounds.min.z - landingBounds.max.z,
    0,
  );
  return (xGap <= 0.001 && zOverlap >= minimumWidth)
    || (zGap <= 0.001 && xOverlap >= minimumWidth);
}

/**
 * Audit the immutable local ramp contracts before composition. This proves
 * that plan-owned walkable surfaces and fixture collision leave a complete
 * player-height tunnel over every V1 incline. Authored deck cuts remain
 * enclosed by the opaque module ceiling and must expose a supported ramp,
 * never exterior void.
 */
export function auditLegacyFixedRoomRampHeadroomV2(module, {
  maximumSampleSpacing = RAMP_HEADROOM_SAMPLE_SPACING,
} = {}) {
  const errors = [];
  const surfaces = module?.floorTopology?.walkableSurfaces ?? [];
  const surfaceById = new Map(surfaces.map((surface) => [surface.id, surface]));
  const clearances = module?.floorTopology?.rampHeadroomClearances ?? [];
  const clearanceByRoute = new Map(clearances.map((clearance) => [clearance.routeId, clearance]));
  const ceilingBoundary = module?.structuralBoundaries?.find(({ side }) => side === 'ceiling') ?? null;
  const rampRoutes = new Map();
  for (const surface of surfaces.filter(({ shape }) => shape === 'ramp-tile')) {
    const routeId = surface.ramp?.routeId;
    if (!routeId) continue;
    const route = rampRoutes.get(routeId) ?? [];
    route.push(surface);
    rampRoutes.set(routeId, route);
  }

  const routeDiagnostics = [];
  for (const [routeId, routeSurfaces] of rampRoutes) {
    const clearance = clearanceByRoute.get(routeId);
    if (!clearance) {
      errors.push({ code: 'ramp-headroom-contract-missing', moduleId: module.id, routeId });
      continue;
    }
    if (!(clearance.sampleSpacing > 0) || clearance.sampleSpacing > maximumSampleSpacing + 1e-9) {
      errors.push({
        code: 'ramp-headroom-sample-spacing-invalid',
        moduleId: module.id,
        routeId,
        sampleSpacing: clearance.sampleSpacing,
        maximumSampleSpacing,
      });
    }
    if (clearance.minimumHeadroom < PLAYER_HEADROOM) {
      errors.push({
        code: 'ramp-headroom-minimum-invalid',
        moduleId: module.id,
        routeId,
        minimumHeadroom: clearance.minimumHeadroom,
      });
    }
    if (!ceilingBoundary?.opaque || !ceilingBoundary?.collider) {
      errors.push({
        code: 'ramp-headroom-clearance-not-enclosed',
        moduleId: module.id,
        routeId,
        ceilingBoundaryId: ceilingBoundary?.id ?? null,
      });
    }

    let minimumObservedHeadroom = Number.POSITIVE_INFINITY;
    let worstSample = null;
    let sampleCount = 0;
    for (const rampSurface of routeSurfaces) {
      if (rampSurface.ramp?.headroomClearanceId !== clearance.id) {
        errors.push({
          code: 'ramp-headroom-surface-contract-mismatch',
          moduleId: module.id,
          routeId,
          surfaceId: rampSurface.id,
        });
      }
      const direction = rampSurface.ramp.direction;
      const runLength = Math.abs(direction.x) > 0.5
        ? rampSurface.size.x
        : rampSurface.size.z;
      const sampleSteps = Math.max(1, Math.ceil(runLength / clearance.sampleSpacing));
      for (let index = 0; index < sampleSteps; index += 1) {
        const progress = (index + 0.5) / sampleSteps;
        const along = (progress - 0.5) * runLength;
        const rampY = rampSurface.ramp.startY
          + (rampSurface.ramp.endY - rampSurface.ramp.startY) * progress;
        for (const lateral of [-PLAYER_RADIUS, 0, PLAYER_RADIUS]) {
          const x = rampSurface.center.x + direction.x * along - direction.z * lateral;
          const z = rampSurface.center.z + direction.z * along + direction.x * lateral;
          let overheadY = module.enclosure.ceilingHeight;
          let blockerId = ceilingBoundary?.id ?? 'module-ceiling';
          for (const surface of surfaces) {
            if (surface.traversalRoute?.routeId === routeId) continue;
            const bounds = localSurfaceBounds(surface);
            if (!planarPointInside(bounds, x, z)) continue;
            const surfaceBottom = surface.topY - surface.size.y;
            if (surface.topY <= rampY + 1e-6) continue;
            const candidateY = surfaceBottom > rampY ? surfaceBottom : rampY;
            if (candidateY < overheadY) {
              overheadY = candidateY;
              blockerId = surface.id;
            }
          }
          for (const fixtureDescriptor of module.fixtures ?? []) {
            for (const occupiedPart of fixtureOccupiedParts(fixtureDescriptor)) {
              const bounds = {
                min: {
                  x: occupiedPart.center.x - occupiedPart.halfSize.x,
                  z: occupiedPart.center.z - occupiedPart.halfSize.z,
                },
                max: {
                  x: occupiedPart.center.x + occupiedPart.halfSize.x,
                  z: occupiedPart.center.z + occupiedPart.halfSize.z,
                },
              };
              if (!planarPointInside(bounds, x, z)) continue;
              const partTop = occupiedPart.center.y + occupiedPart.halfSize.y;
              if (partTop <= rampY + 1e-6) continue;
              const partBottom = occupiedPart.center.y - occupiedPart.halfSize.y;
              const candidateY = partBottom > rampY ? partBottom : rampY;
              if (candidateY < overheadY) {
                overheadY = candidateY;
                blockerId = `${fixtureDescriptor.id}/${occupiedPart.id}`;
              }
            }
          }
          const headroom = overheadY - rampY;
          sampleCount += 1;
          if (headroom < minimumObservedHeadroom) {
            minimumObservedHeadroom = headroom;
            worstSample = {
              surfaceId: rampSurface.id,
              x: round(x),
              y: round(rampY),
              z: round(z),
              headroom: round(headroom),
              blockerId,
            };
          }
        }
      }
    }
    if (minimumObservedHeadroom + 1e-6 < clearance.minimumHeadroom) {
      errors.push({
        code: 'ramp-headroom-insufficient',
        moduleId: module.id,
        routeId,
        requiredHeadroom: clearance.minimumHeadroom,
        observedHeadroom: round(minimumObservedHeadroom),
        worstSample,
      });
    }

    for (const removed of clearance.removedOverheadSurfaces) {
      if (surfaceById.has(removed.id)) {
        errors.push({
          code: 'ramp-overhead-surface-still-present',
          moduleId: module.id,
          routeId,
          surfaceId: removed.id,
        });
      }
      const coveringSurfaces = removed.coveringRampSurfaceIds
        .map((surfaceId) => surfaceById.get(surfaceId))
        .filter(Boolean);
      const removedBounds = localSurfaceBounds(removed);
      const supported = coveringSurfaces.some((surface) => {
        const bounds = localSurfaceBounds(surface);
        return bounds.min.x <= removedBounds.min.x + 0.001
          && bounds.max.x >= removedBounds.max.x - 0.001
          && bounds.min.z <= removedBounds.min.z + 0.001
          && bounds.max.z >= removedBounds.max.z - 0.001
          && surface.support?.visible === true;
      });
      if (!supported) {
        errors.push({
          code: 'ramp-headroom-clearance-unsupported-opening',
          moduleId: module.id,
          routeId,
          removedSurfaceId: removed.id,
          coveringRampSurfaceIds: [...removed.coveringRampSurfaceIds],
        });
      }
    }

    const endpointHeights = routeSurfaces.flatMap(({ ramp }) => [ramp.startY, ramp.endY]);
    for (const [label, landingId, expectedY] of [
      ['lower', clearance.lowerLandingSurfaceId, Math.min(...endpointHeights)],
      ['upper', clearance.upperLandingSurfaceId, Math.max(...endpointHeights)],
    ]) {
      if (!landingId) continue;
      const landing = surfaceById.get(landingId);
      const endpointSurfaces = routeSurfaces.filter(({ ramp }) => (
        Math.abs(ramp.startY - expectedY) <= 0.001 || Math.abs(ramp.endY - expectedY) <= 0.001
      ));
      if (!landing || Math.abs(landing.topY - expectedY) > 0.05
        || landing.support?.visible !== true
        || !endpointSurfaces.some((surface) => rectanglesSharePlayableEdge(surface, landing))) {
        errors.push({
          code: `ramp-headroom-${label}-landing-not-flush`,
          moduleId: module.id,
          routeId,
          landingSurfaceId: landingId,
          expectedY: round(expectedY),
          actualY: landing?.topY ?? null,
        });
      }
    }

    routeDiagnostics.push({
      routeId,
      clearanceId: clearance.id,
      rampSurfaceCount: routeSurfaces.length,
      removedOverheadSurfaceCount: clearance.removedOverheadSurfaces.length,
      sampleSpacing: clearance.sampleSpacing,
      sampleCount,
      requiredHeadroom: clearance.minimumHeadroom,
      minimumObservedHeadroom: round(minimumObservedHeadroom),
      worstSample,
    });
  }

  for (const clearance of clearances) {
    if (!rampRoutes.has(clearance.routeId)) {
      errors.push({
        code: 'ramp-headroom-clearance-route-missing',
        moduleId: module.id,
        routeId: clearance.routeId,
      });
    }
  }

  return {
    accepted: errors.length === 0,
    moduleId: module?.id ?? null,
    maximumSampleSpacing,
    errors,
    routes: routeDiagnostics,
  };
}

export function validateLegacyFixedRoomModuleCatalogV2(
  catalog = LEGACY_FIXED_ROOM_MODULE_CATALOG_V2,
) {
  const errors = [];
  const warnings = [];
  const moduleIds = new Set();
  const sourceRoomIds = new Set();
  const semanticRegionIds = new Set();
  const socketIds = new Set();
  const boundaryIds = new Set();
  const fixtureIds = new Set();
  const surfaceIds = new Set();
  const supportedPrefabIds = new Set([
    'legacy-server-monolith',
    'legacy-conveyor-drive',
    'legacy-water-tank',
    'legacy-circulation-pump',
    'legacy-processing-vat',
    'legacy-girder-frame',
    'legacy-storage-rack',
    'legacy-shrine-monolith',
    'legacy-fixed-security-scanner-arch',
    'legacy-fixed-chain-link-security-fence',
    'legacy-fixed-industrial-engine',
    'legacy-fixed-server-energy-core',
    'legacy-fixed-server-entry-console',
    'legacy-fixed-machine-press',
    'legacy-fixed-machine-robot-arm',
    'legacy-fixed-coolant-machine-base',
    'legacy-fixed-coolant-pressure-core',
    'legacy-fixed-coolant-source-tank',
    'legacy-fixed-coolant-overflow-tank',
    'legacy-fixed-coolant-valve-pylon',
    'legacy-fixed-coolant-valve-terminal',
    'legacy-fixed-coolant-master-console',
  ]);

  if (catalog.length !== 11) {
    errors.push(`Expected exactly 11 unique V1 room modules; received ${catalog.length}.`);
  }

  for (const module of catalog) {
    if (moduleIds.has(module.id)) errors.push(`Duplicate module ID ${module.id}.`);
    moduleIds.add(module.id);
    if (sourceRoomIds.has(module.sourceRoom.id)) errors.push(`V1 source room ${module.sourceRoom.id} is reused by multiple modules.`);
    sourceRoomIds.add(module.sourceRoom.id);

    if (module.presentation.source !== 'dungeon-v1') {
      errors.push(`${module.id} does not declare Dungeon V1 as its presentation source.`);
    }
    if (module.floorTopology.walkableSurfaces.length < 60) {
      errors.push(`${module.id} has too few concrete walkable surfaces to be an authored V1 room.`);
    }
    if (!module.enclosure.required || !module.enclosure.unusedSocketsMustBeCapped) {
      errors.push(`${module.id} does not require a closed shell and socket caps.`);
    }
    const expectedBoundarySides = ['ceiling', 'east', 'floor', 'north', 'south', 'west'];
    if (module.structuralBoundaries.length !== expectedBoundarySides.length) {
      errors.push(`${module.id} must declare exactly six closed-shell boundary templates.`);
    }
    const actualBoundarySides = module.structuralBoundaries.map(({ side }) => side).sort();
    if (JSON.stringify(actualBoundarySides) !== JSON.stringify(expectedBoundarySides)) {
      errors.push(`${module.id} boundary templates do not cover every shell face exactly once.`);
    }
    const socketBoundaryOwnerCounts = new Map(module.extensionSockets.map(({ id: socketId }) => [socketId, 0]));
    for (const boundary of module.structuralBoundaries) {
      if (boundaryIds.has(boundary.id)) errors.push(`Duplicate structural boundary template ID ${boundary.id}.`);
      boundaryIds.add(boundary.id);
      if (!boundary.opaque || !boundary.collider || boundary.collision?.mode !== 'blocking') {
        errors.push(`${boundary.id} is not an explicit opaque collider template.`);
      }
      if (boundary.compilePolicy !== 'subdivide-around-paired-openings-and-cap-all-unused-sockets') {
        errors.push(`${boundary.id} can expose a socket without an explicit paired-opening/cap policy.`);
      }
      for (const candidateSocketId of boundary.candidateSocketIds) {
        if (!socketBoundaryOwnerCounts.has(candidateSocketId)) {
          errors.push(`${boundary.id} references missing candidate socket ${candidateSocketId}.`);
          continue;
        }
        socketBoundaryOwnerCounts.set(candidateSocketId, socketBoundaryOwnerCounts.get(candidateSocketId) + 1);
      }
      if (boundary.candidateApertures.map(({ socketId }) => socketId).join('|') !== boundary.candidateSocketIds.join('|')) {
        errors.push(`${boundary.id} candidate apertures do not exactly match its socket ownership.`);
      }
      for (const axis of ['x', 'y', 'z']) {
        if (!Number.isFinite(boundary.localBounds?.center?.[axis])
          || !Number.isFinite(boundary.localBounds?.halfSize?.[axis])
          || boundary.localBounds.halfSize[axis] <= 0) {
          errors.push(`${boundary.id} has invalid ${axis}-axis local bounds.`);
        }
      }
    }
    for (const [socketId, ownerCount] of socketBoundaryOwnerCounts) {
      if (ownerCount !== 1) errors.push(`${socketId} must belong to exactly one closed-shell boundary template; received ${ownerCount}.`);
    }

    const moduleSurfaceIds = new Set();
    for (const surface of module.floorTopology.walkableSurfaces) {
      if (surfaceIds.has(surface.id)) errors.push(`Duplicate global surface ID ${surface.id}.`);
      surfaceIds.add(surface.id);
      moduleSurfaceIds.add(surface.id);
      if (surface.collision.mode !== 'walkable') errors.push(`${surface.id} is not an explicit walkable collider.`);
      if (surface.center.x < module.bounds.min.x - 0.001 || surface.center.x > module.bounds.max.x + 0.001
        || surface.center.z < module.bounds.min.z - 0.001 || surface.center.z > module.bounds.max.z + 0.001) {
        errors.push(`${surface.id} lies outside ${module.id}'s V1 footprint.`);
      }
      if (surface.shape === 'ramp-tile' && (!Number.isFinite(surface.ramp?.startY) || !Number.isFinite(surface.ramp?.endY))) {
        errors.push(`${surface.id} is a ramp without exact endpoint heights.`);
      }
    }
    const rampHeadroomAudit = auditLegacyFixedRoomRampHeadroomV2(module);
    for (const rampError of rampHeadroomAudit.errors) {
      errors.push(`${module.id} failed ${rampError.code}: ${JSON.stringify(rampError)}.`);
    }

    const moduleRegionIds = new Set();
    for (const semanticRegion of module.semanticRegions) {
      if (semanticRegionIds.has(semanticRegion.id)) errors.push(`Semantic region ${semanticRegion.id} is assigned to more than one V1 module.`);
      semanticRegionIds.add(semanticRegion.id);
      moduleRegionIds.add(semanticRegion.id);
    }

    for (const fixtureDescriptor of module.fixtures) {
      if (fixtureIds.has(fixtureDescriptor.id)) errors.push(`Duplicate fixture ID ${fixtureDescriptor.id}.`);
      fixtureIds.add(fixtureDescriptor.id);
      const recipeId = fixtureDescriptor.presentation.recipeId;
      if (recipeId && !supportedPrefabIds.has(recipeId)) {
        errors.push(`${fixtureDescriptor.id} uses unknown V1 prefab recipe ${recipeId}.`);
      }
      if (fixtureDescriptor.collision.runtimeColliderRequired && !recipeId) {
        errors.push(`${fixtureDescriptor.id} requires collision but has no visible V1 recipe.`);
      }
      if (fixtureDescriptor.collision.mode === 'compound-blocking' && fixtureDescriptor.collision.parts.length < 1) {
        errors.push(`${fixtureDescriptor.id} declares compound collision without visible parts.`);
      }
      if (
        fixtureDescriptor.collision.mode === 'compound-blocking'
        && /(?:arch|girder|press)/.test(fixtureDescriptor.kind)
        && fixtureDescriptor.collision.parts.length !== 2
      ) {
        errors.push(`${fixtureDescriptor.id} must describe its two visible support parts, not a full-span blocker.`);
      }
      if (fixtureDescriptor.collision.mode === 'blocking' && fixtureDescriptor.kind.includes('girder')) {
        errors.push(`${fixtureDescriptor.id} incorrectly blocks its entire girder presentation envelope.`);
      }
      const bounds = fixtureDescriptor.localBounds;
      if (Math.abs(bounds.center.x) + bounds.halfSize.x > module.bounds.max.x + 0.75
        || Math.abs(bounds.center.z) + bounds.halfSize.z > module.bounds.max.z + 0.75) {
        errors.push(`${fixtureDescriptor.id} extends outside ${module.id}'s authored shell.`);
      }
    }

    for (const anchorDescriptor of module.landmarkAnchors) {
      if (!moduleRegionIds.has(anchorDescriptor.regionId)) {
        errors.push(`${anchorDescriptor.id} references missing semantic region ${anchorDescriptor.regionId}.`);
      }
      if (anchorDescriptor.surfaceId && !moduleSurfaceIds.has(anchorDescriptor.surfaceId)) {
        errors.push(`${anchorDescriptor.id} references missing surface ${anchorDescriptor.surfaceId}.`);
      }
    }

    for (const socket of module.extensionSockets) {
      if (socketIds.has(socket.id)) errors.push(`Duplicate socket ID ${socket.id}.`);
      socketIds.add(socket.id);
      if (socket.opening.width < 1.2 || socket.opening.height < PLAYER_HEADROOM) {
        errors.push(`${socket.id} is smaller than the player/camera traversal envelope.`);
      }
      const epsilon = 0.001;
      const onExpectedFace = socket.boundarySide === 'west'
        ? Math.abs(socket.anchor.x - module.bounds.min.x) <= epsilon
        : socket.boundarySide === 'east'
          ? Math.abs(socket.anchor.x - module.bounds.max.x) <= epsilon
          : socket.boundarySide === 'north'
            ? Math.abs(socket.anchor.z - module.bounds.min.z) <= epsilon
            : socket.boundarySide === 'south'
              ? Math.abs(socket.anchor.z - module.bounds.max.z) <= epsilon
              : socket.boundarySide === 'ceiling'
                ? Math.abs(socket.anchor.y - module.bounds.max.y) <= epsilon
                : socket.boundarySide === 'interior-floor';
      if (!onExpectedFace) {
        errors.push(`${socket.id} is not anchored on its declared ${socket.boundarySide} boundary.`);
      }
      if (socket.anchor.x < module.bounds.min.x - epsilon || socket.anchor.x > module.bounds.max.x + epsilon
        || socket.anchor.z < module.bounds.min.z - epsilon || socket.anchor.z > module.bounds.max.z + epsilon
        || socket.anchor.y < module.bounds.min.y - epsilon || socket.anchor.y > module.bounds.max.y + epsilon) {
        errors.push(`${socket.id} anchor lies outside ${module.id}'s closed shell.`);
      }
      if (['north', 'south', 'east', 'west'].includes(socket.boundarySide)
        && (socket.opening.sillElevation < module.bounds.min.y - epsilon
          || socket.opening.sillElevation + socket.opening.height > module.bounds.max.y + epsilon)) {
        errors.push(`${socket.id} opening exceeds ${module.id}'s vertical shell.`);
      }
      if (!socket.semanticRegionIds.every((regionId) => moduleRegionIds.has(regionId))) {
        errors.push(`${socket.id} references a semantic region outside ${module.id}.`);
      }
      if (socket.approachSurfaceIds.length < 2) {
        errors.push(`${socket.id} lacks a physical multi-surface approach.`);
      }
      if (!socket.approachSurfaceIds.every((surfaceId) => moduleSurfaceIds.has(surfaceId))) {
        errors.push(`${socket.id} references a missing approach surface.`);
      }
      if (!socket.aperture.surfaceIds.every((surfaceId) => moduleSurfaceIds.has(surfaceId))) {
        errors.push(`${socket.id} references a missing aperture surface.`);
      }
      if (socket.approachSurfaceIds.some((surfaceId) => socket.aperture.surfaceIds.includes(surfaceId))) {
        errors.push(`${socket.id} removes one of its own approach surfaces.`);
      }
      if (socket.boundarySide === 'interior-floor'
        && socket.aperture.mode === 'remove-declared-surfaces'
        && socket.aperture.surfaceIds.length === 0) {
        errors.push(`${socket.id} declares an interior opening without an aperture surface.`);
      }

      const approachSurfaces = socket.approachSurfaceIds
        .map((surfaceId) => module.floorTopology.walkableSurfaces.find((surface) => surface.id === surfaceId));
      if (approachSurfaces.every(Boolean)) {
        const boundaryApproach = approachSurfaces[0];
        if (Math.abs(boundaryApproach.topY - socket.opening.sillElevation) > epsilon) {
          errors.push(`${socket.id} sill ${socket.opening.sillElevation} does not match boundary approach ${boundaryApproach.id} top ${boundaryApproach.topY}.`);
        }
        for (let index = 1; index < approachSurfaces.length; index += 1) {
          const previous = approachSurfaces[index - 1];
          const current = approachSurfaces[index];
          const tileDistance = Math.abs(previous.localTile.x - current.localTile.x)
            + Math.abs(previous.localTile.z - current.localTile.z);
          if (tileDistance !== 1) {
            errors.push(`${socket.id} approach jumps from ${previous.id} to non-adjacent ${current.id}.`);
          }
          if (Math.abs(previous.topY - current.topY) > epsilon) {
            const authoredTraversal = [previous, current].some((surface) => (
              surface.shape === 'ramp-tile'
              && typeof surface.traversalRoute?.routeId === 'string'
              && surface.traversalRoute.routeId.length > 0
              && Number.isFinite(surface.ramp?.startY)
              && Number.isFinite(surface.ramp?.endY)
            ));
            if (!authoredTraversal) {
              errors.push(`${socket.id} approach changes elevation from ${previous.topY} to ${current.topY} without an authored traversal surface.`);
            }
          }
        }

        for (const approach of approachSurfaces) {
          const playerCenter = { x: approach.center.x, y: approach.topY + PLAYER_HEADROOM * 0.5, z: approach.center.z };
          const playerHalfSize = { x: PLAYER_RADIUS, y: PLAYER_HEADROOM * 0.5, z: PLAYER_RADIUS };
          for (const fixtureDescriptor of module.fixtures) {
            for (const occupiedPart of fixtureOccupiedParts(fixtureDescriptor)) {
              const verticalOverlap = Math.abs(playerCenter.y - occupiedPart.center.y)
                < playerHalfSize.y + occupiedPart.halfSize.y;
              if (verticalOverlap && boxesOverlap2d(playerCenter, playerHalfSize, occupiedPart.center, occupiedPart.halfSize, 0.05)) {
                errors.push(`${socket.id} approach ${approach.id} is obstructed by ${fixtureDescriptor.id}/${occupiedPart.id}.`);
              }
            }
          }
        }
      }
    }

    for (const traversalSurface of module.floorTopology.walkableSurfaces.filter((surface) => (
      typeof surface.traversalRoute?.routeId === 'string'
    ))) {
      const playerCenter = {
        x: traversalSurface.center.x,
        y: traversalSurface.topY + PLAYER_HEADROOM * 0.5,
        z: traversalSurface.center.z,
      };
      const playerHalfSize = { x: PLAYER_RADIUS, y: PLAYER_HEADROOM * 0.5, z: PLAYER_RADIUS };
      for (const fixtureDescriptor of module.fixtures) {
        for (const occupiedPart of fixtureOccupiedParts(fixtureDescriptor)) {
          const verticalOverlap = Math.abs(playerCenter.y - occupiedPart.center.y)
            < playerHalfSize.y + occupiedPart.halfSize.y;
          if (verticalOverlap && boxesOverlap2d(
            playerCenter,
            playerHalfSize,
            occupiedPart.center,
            occupiedPart.halfSize,
            0.05,
          )) {
            errors.push(`${traversalSurface.traversalRoute.routeId} surface ${traversalSurface.id} is obstructed by ${fixtureDescriptor.id}/${occupiedPart.id}.`);
          }
        }
      }
    }

    if (module.sourceReferences.some((reference) => (
      reference.file !== SOURCE_FILE
      || !reference.symbol
      || !Number.isInteger(reference.startLine)
      || !Number.isInteger(reference.endLine)
      || reference.endLine < reference.startLine
    ))) {
      errors.push(`${module.id} has an invalid V1 source reference.`);
    }
  }

  const expectedSemanticRegions = [
    'security', 'assembly', 'server', 'freight', 'sorting', 'credential', 'parts', 'nest',
    'corkscrew', 'machine-core', 'extraction', 'freight-sump', 'reservoir', 'gantry-sump',
    'salvage-tunnel', 'hazard-intake', 'hazard-core',
  ];
  for (const regionId of expectedSemanticRegions) {
    if (!semanticRegionIds.has(regionId)) errors.push(`Missing semantic region ${regionId}.`);
  }
  if (semanticRegionIds.size !== expectedSemanticRegions.length) {
    errors.push(`Expected exactly ${expectedSemanticRegions.length} semantic regions; received ${semanticRegionIds.size}.`);
  }

  const requiredForms = [
    'ground-bulkhead',
    'elevated-catwalk',
    'service-ladder',
    'cargo-lift',
    'pipe-water-breach',
    'intentional-lower-zone',
  ];
  const forms = new Set(catalog.flatMap((module) => module.extensionSockets.map((socket) => socket.form)));
  for (const form of requiredForms) {
    if (!forms.has(form)) errors.push(`The V1 module catalog lacks required extension form ${form}.`);
  }

  return {
    accepted: errors.length === 0,
    errors,
    warnings,
    details: {
      revision: LEGACY_FIXED_ROOM_MODULE_CATALOG_REVISION_V2,
      moduleCount: moduleIds.size,
      semanticRegionCount: semanticRegionIds.size,
      surfaceCount: surfaceIds.size,
      fixtureCount: fixtureIds.size,
      socketCount: socketIds.size,
      structuralBoundaryTemplateCount: boundaryIds.size,
      sourceRoomCount: sourceRoomIds.size,
      connectorForms: [...forms].sort(),
    },
  };
}
