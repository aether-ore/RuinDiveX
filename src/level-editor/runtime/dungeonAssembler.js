import * as THREE from 'three';
import { AssetResolver, createAssetResolver } from './AssetResolver.js';
import { AuthoredRoomRegistry } from './AuthoredRoomRegistry.js';
import { assembleAuthoredGameplay } from './gameplayAssembler.js';
import {
  createPBRMaterialLibrary,
  mergeMaterialDefinitions,
  PBRMaterialLibrary,
} from './materials.js';
import { createAuthoredProgression, createAuthoredProgressionData } from './progression.js';
import { assembleAuthoredRoom } from './roomAssembler.js';
import {
  addBeamBetween,
  applyTransform,
  asArray,
  cloneData,
  DisposableResourceSet,
  finiteNumber,
  normalizeId,
  readSize3,
  readTransform,
  readVector3,
  transformDirection,
  transformPoint,
  unwrapCompiledSource,
} from './utils.js';

function selectDungeonSource(input = {}) {
  const candidate = input?.dungeon
    ?? input?.compiled
    ?? input?.value
    ?? input;
  return unwrapCompiledSource(candidate);
}

function registrySource(input, options) {
  return options.roomRegistry
    ?? input?.roomRegistry
    ?? input?.registry
    ?? input?.compiled?.registry
    ?? input?.value?.registry
    ?? {};
}

function endpoint(connection, side) {
  const properties = connection?.properties ?? {};
  if (side === 'from') {
    return connection.from
      ?? connection.source
      ?? properties.from
      ?? properties.source
      ?? {
        roomId: connection.fromRoomId ?? connection.sourceRoomId ?? properties.fromRoomId,
        socketId: connection.fromSocketId ?? connection.sourceSocketId ?? properties.fromSocketId,
        position: connection.start ?? connection.sourcePosition ?? properties.start,
      };
  }
  return connection.to
    ?? connection.destination
    ?? properties.to
    ?? properties.destination
    ?? {
      roomId: connection.toRoomId ?? connection.destinationRoomId ?? properties.toRoomId,
      socketId: connection.toSocketId ?? connection.destinationSocketId ?? properties.toSocketId,
      position: connection.end ?? connection.destinationPosition ?? properties.end,
    };
}

function endpointRoomId(value) {
  if (typeof value === 'string') return value.includes(':') ? value.split(':')[0] : value;
  return normalizeId(value?.roomId ?? value?.room ?? value?.instanceId);
}

function endpointSocketId(value) {
  if (typeof value === 'string' && value.includes(':')) return value.slice(value.indexOf(':') + 1);
  return normalizeId(value?.socketId ?? value?.socket ?? value?.portalId ?? value?.id);
}

function connectedSocketsByRoom(connections) {
  const result = new Map();
  const add = (roomId, socketId) => {
    if (!roomId || !socketId) return;
    if (!result.has(roomId)) result.set(roomId, new Set());
    result.get(roomId).add(socketId);
  };
  for (const connection of connections) {
    const from = endpoint(connection, 'from');
    const to = endpoint(connection, 'to');
    add(endpointRoomId(from), endpointSocketId(from));
    add(endpointRoomId(to), endpointSocketId(to));
  }
  return result;
}

function hasInlineGeometry(room) {
  const definition = room?.definition ?? room;
  return Boolean(
    definition?.surfaces
      || definition?.primitives
      || definition?.models
      || definition?.colliders
      || definition?.solidZones
      || definition?.socketFrames
      || definition?.sockets
  );
}

async function resolveRoomDefinitions(instances, registry, diagnostics, strict) {
  const resolved = [];
  for (const instance of instances) {
    try {
      const baseDefinition = hasInlineGeometry(instance) && !instance.moduleId && !instance.templateId
        ? { ...(instance.definition ?? instance), id: instance.roomId ?? instance.id }
        : await registry.resolve(instance, { instance });
      const definitionOverrides = instance.properties?.definitionOverrides ?? {};
      const definition = {
        ...cloneData(baseDefinition),
        ...cloneData(definitionOverrides),
        id: instance.roomId ?? instance.id ?? baseDefinition.id,
        moduleId: instance.moduleId ?? baseDefinition.moduleId,
        templateId: instance.templateId ?? baseDefinition.templateId,
        dimensions: cloneData(instance.dimensions ?? definitionOverrides.dimensions ?? baseDefinition.dimensions),
        sockets: cloneData(instance.sockets ?? definitionOverrides.sockets ?? baseDefinition.sockets ?? []),
        properties: {
          ...(cloneData(baseDefinition.properties) ?? {}),
          ...(cloneData(instance.properties) ?? {}),
        },
        instanceProperties: cloneData(instance.properties ?? {}),
      };
      resolved.push({ instance, definition });
    } catch (error) {
      const message = `Unable to resolve room ${instance.id ?? instance.roomId ?? instance.moduleId}: ${error.message}`;
      diagnostics.errors.push(message);
      if (strict) throw new Error(message, { cause: error });
      resolved.push({
        instance,
        definition: {
          ...(instance.definition ?? {}),
          id: instance.roomId ?? instance.id,
          moduleId: instance.moduleId,
          sockets: instance.sockets ?? [],
          surfaces: [],
        },
      });
    }
  }
  return resolved;
}

function isStructuralEntity(entity) {
  const kind = String(entity?.kind ?? '').toLowerCase();
  return kind === 'structural' || kind === 'geometry' || kind === 'surface' || kind === 'primitive';
}

function isModelEntity(entity) {
  const kind = String(entity?.kind ?? '').toLowerCase();
  return kind === 'model' || kind === 'asset' || kind === 'propmodel';
}

function structuralRecord(entity) {
  const properties = entity?.properties && typeof entity.properties === 'object'
    ? entity.properties
    : {};
  return {
    ...cloneData(properties),
    ...cloneData(entity),
    id: entity.id,
    transform: entity.transform ?? properties.transform,
    size: properties.size ?? properties.dimensions ?? entity.size ?? entity.dimensions,
    materialId: properties.materialId ?? entity.materialId,
  };
}

function foldStructuralEntities(resolvedRooms, allEntities, diagnostics) {
  const byRoom = new Map(resolvedRooms.map((entry) => [
    normalizeId(entry.instance.id ?? entry.instance.roomId ?? entry.definition.id),
    entry,
  ]));
  const consumedIds = new Set();
  for (const rawEntity of allEntities) {
    if (!isStructuralEntity(rawEntity) && !isModelEntity(rawEntity)) continue;
    const roomId = normalizeId(rawEntity.roomId ?? rawEntity.properties?.roomId);
    const target = byRoom.get(roomId);
    if (!target) {
      diagnostics.warnings.push(`Structural entity ${rawEntity.id ?? '<anonymous>'} references unknown room ${roomId || '<missing>'}.`);
      continue;
    }
    target.definition = cloneData(target.definition);
    const record = structuralRecord(rawEntity);
    if (isModelEntity(rawEntity)) {
      target.definition.models = [...asArray(target.definition.models), {
        ...record,
        asset: record.assetHash
          ?? record.assetId
          ?? record.asset
          ?? record.url
          ?? record.properties?.assetId,
      }];
      consumedIds.add(rawEntity.id);
      continue;
    }
    const type = String(record.type ?? record.shape ?? 'box').toLowerCase();
    const collision = record.collision ?? record.collider;
    if (['floor', 'ramp', 'platform', 'walkway', 'catwalk'].includes(type)) {
      target.definition.surfaces = [...asArray(target.definition.surfaces), {
        ...record,
        shape: type === 'ramp' ? 'ramp' : 'box',
        surfaceRole: type === 'floor' ? 'floor' : type,
        walkable: record.walkable !== false,
        platform: type === 'platform' || record.platform === true,
      }];
      if (collision && typeof collision === 'object' && type !== 'floor') {
        target.definition.colliders = [...asArray(target.definition.colliders), {
          ...record,
          ...cloneData(collision),
          id: `${record.id}-collider`,
        }];
      }
    } else {
      target.definition.primitives = [...asArray(target.definition.primitives), {
        ...record,
        shape: record.shape ?? (type === 'wall' || type === 'ceiling' || type === 'column' ? 'box' : type),
        collider: collision !== false,
      }];
      if (collision && typeof collision === 'object') {
        target.definition.colliders = [...asArray(target.definition.colliders), {
          ...record,
          ...cloneData(collision),
          id: `${record.id}-collider-explicit`,
        }];
      }
    }
    consumedIds.add(rawEntity.id);
  }
  return consumedIds;
}

function matrixYaw(matrix) {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  return new THREE.Euler().setFromQuaternion(quaternion, 'YXZ').y;
}

function matrixScale(matrix) {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  return scale;
}

function transformSpatialRecord(record, matrix, roomId) {
  const localPosition = readVector3(record.position ?? record.center ?? record.localPosition ?? record);
  const position = transformPoint(localPosition, matrix);
  const scale = matrixScale(matrix);
  const result = {
    ...record,
    roomId: record.roomId ?? roomId,
    position,
    localPosition: record.localPosition?.isVector3
      ? record.localPosition.clone()
      : localPosition.clone(),
  };
  if (record.center) result.center = position.clone();
  if (record.facing) result.facing = transformDirection(record.facing, matrix);
  if (record.direction?.isVector3 || (record.direction && typeof record.direction === 'object')) {
    result.direction = transformDirection(record.direction, matrix);
  }
  if (Number.isFinite(Number(record.halfWidth))) result.halfWidth = Math.abs(Number(record.halfWidth) * scale.x);
  if (Number.isFinite(Number(record.halfDepth))) result.halfDepth = Math.abs(Number(record.halfDepth) * scale.z);
  if (Number.isFinite(Number(record.verticalHalfHeight))) result.verticalHalfHeight = Math.abs(Number(record.verticalHalfHeight) * scale.y);
  if (record.size?.isVector3) result.size = record.size.clone().multiply(scale).set(Math.abs(record.size.x * scale.x), Math.abs(record.size.y * scale.y), Math.abs(record.size.z * scale.z));
  result.rotationY = finiteNumber(record.rotationY) + matrixYaw(matrix);
  return result;
}

function transformFloorTile(record, matrix, roomId, tileSize) {
  const result = transformSpatialRecord(record, matrix, roomId);
  result.elevation = result.position.y + finiteNumber(record.elevation) - readVector3(record.position).y;
  result.worldX = result.position.x;
  result.worldZ = result.position.z;
  // DungeonController indexes authored traversal on the canonical integer
  // tile grid. Room visuals may be centered between cells (notably even-sized
  // surface grids), so normalize their support keys during materialization.
  result.x = Math.round(result.position.x / tileSize);
  result.z = Math.round(result.position.z / tileSize);
  return result;
}

function transformPlatform(record, matrix, roomId) {
  const result = transformSpatialRecord(record, matrix, roomId);
  result.center = result.position.clone();
  const localTopOffset = finiteNumber(record.topY, readVector3(record.position).y) - readVector3(record.position).y;
  result.topY = result.position.y + localTopOffset * Math.abs(matrixScale(matrix).y);
  result.enabled = record.enabled !== false;
  return result;
}

function normalizedGridKey(x, z) {
  const normalize = (value) => Math.abs(value - Math.round(value)) < 0.0001
    ? String(Math.round(value))
    : Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return `${normalize(x)},${normalize(z)}`;
}

function socketLookupKey(roomId, socketId) {
  return `${roomId}:${socketId}`;
}

function resolveConnectionPoint(connection, side, socketLookup, roomCenters) {
  const value = endpoint(connection, side);
  const roomId = endpointRoomId(value);
  const socketId = endpointSocketId(value);
  const socket = socketLookup.get(socketLookupKey(roomId, socketId));
  const explicit = value?.position
    ?? (side === 'from'
      ? connection.start ?? connection.sourcePosition ?? connection.properties?.start
      : connection.end ?? connection.destinationPosition ?? connection.properties?.end);
  const position = explicit ? readVector3(explicit) : socket?.position?.clone?.() ?? roomCenters.get(roomId)?.clone?.() ?? new THREE.Vector3();
  const facing = socket?.facing?.clone?.()
    ?? readVector3(value?.facing, side === 'from' ? { x: 0, y: 0, z: 1 } : { x: 0, y: 0, z: -1 });
  return { roomId, socketId, socket, position, facing };
}

function connectorKind(connection) {
  const value = String(
    connection.kind
      ?? connection.connectorType
      ?? connection.type
      ?? connection.variant
      ?? connection.connectorVariantId
      ?? connection.properties?.kind
      ?? connection.properties?.connectorType
      ?? 'service-gallery',
  ).toLowerCase();
  if (/ladder|climb/.test(value)) return 'ladder';
  if (/lift|elevator|hoist/.test(value)) return 'lift';
  if (/slope|ramp|stair|crest/.test(value)) return 'slope';
  return 'service-gallery';
}

function socketFamilies(socket) {
  return [...new Set([
    ...asArray(socket?.compatibleFamilies),
    ...asArray(socket?.connectorFamilies),
    ...asArray(socket?.families),
    socket?.family,
    socket?.connectorFamily,
  ].map((entry) => normalizeId(entry?.id ?? entry?.value ?? entry).toLowerCase()).filter(Boolean))];
}

function connectorMaterial(materials, connection, fallback) {
  return materials?.resolve?.(
    connection.materialId ?? connection.properties?.materialId,
    fallback,
  ) ?? null;
}

function connectionRoutePoints(connection, from, to, tileSize) {
  const explicit = connection.route?.waypoints
    ?? connection.route?.points
    ?? connection.waypoints
    ?? connection.properties?.waypoints
    ?? connection.properties?.route?.waypoints;
  const start = from.position.clone();
  const end = to.position.clone();
  const points = [start];
  if (asArray(explicit).length > 0) {
    const waypoints = asArray(explicit);
    for (let index = 0; index < waypoints.length; index += 1) {
      const waypoint = waypoints[index]?.position ?? waypoints[index];
      const point = readVector3(waypoint);
      if (waypoint?.y == null && !Array.isArray(waypoint)) {
        point.y = THREE.MathUtils.lerp(start.y, end.y, (index + 1) / (waypoints.length + 1));
      }
      points.push(point);
    }
  } else {
    const dx = Math.abs(end.x - start.x);
    const dz = Math.abs(end.z - start.z);
    if (dx > 0.001 && dz > 0.001) {
      const zFirst = String(connection.routeAxis ?? connection.properties?.routeAxis ?? 'x-first').toLowerCase().startsWith('z');
      const corner = zFirst
        ? new THREE.Vector3(start.x, 0, end.z)
        : new THREE.Vector3(end.x, 0, start.z);
      corner.x = Math.round(corner.x / tileSize) * tileSize;
      corner.z = Math.round(corner.z / tileSize) * tileSize;
      const firstDistance = Math.hypot(corner.x - start.x, corner.z - start.z);
      const secondDistance = Math.hypot(end.x - corner.x, end.z - corner.z);
      corner.y = THREE.MathUtils.lerp(start.y, end.y, firstDistance / Math.max(0.0001, firstDistance + secondDistance));
      points.push(corner);
    }
  }
  points.push(end);
  return points.filter((point, index) => index === 0 || point.distanceToSquared(points[index - 1]) > 0.000001);
}

function validateConnectorRoute(routePoints, from, to, rooms, {
  kind,
  tileSize,
  width,
  headroom,
  alignmentStep = 0.05,
} = {}) {
  const tolerance = 0.05;
  const segments = routePoints.slice(1).map((point, index) => ({
    start: routePoints[index],
    end: point,
  }));
  const horizontalKinds = kind === 'service-gallery' || kind === 'slope';
  const orthogonalAccepted = !horizontalKinds || segments.every(({ start, end }) => (
    Math.abs(end.x - start.x) <= tolerance || Math.abs(end.z - start.z) <= tolerance
  ));
  const alignmentAccepted = routePoints.every((point) => ['x', 'y', 'z'].every((axis) => {
    const units = point[axis] / alignmentStep;
    return Math.abs(units - Math.round(units)) <= 0.001;
  }));
  const minimumEndpointBuffer = tileSize * 2;
  const firstSegment = segments[0];
  const lastSegment = segments.at(-1);
  const horizontalLength = ({ start, end }) => Math.hypot(end.x - start.x, end.z - start.z);
  const maximumSlopeRisePerTileMeters = 7 / 13;
  const slopeGradeAccepted = kind !== 'slope' || segments.every((segment) => {
    const run = horizontalLength(segment);
    const rise = Math.abs(segment.end.y - segment.start.y);
    if (rise <= tolerance) return true;
    return run > tolerance
      && rise <= (run / tileSize) * maximumSlopeRisePerTileMeters + tolerance;
  });
  const endpointBuffersAccepted = !horizontalKinds || (
    firstSegment && lastSegment
    && horizontalLength(firstSegment) + tolerance >= minimumEndpointBuffer
    && horizontalLength(lastSegment) + tolerance >= minimumEndpointBuffer
    && (kind !== 'slope' || (
      Math.abs(firstSegment.end.y - firstSegment.start.y) <= tolerance
      && Math.abs(lastSegment.end.y - lastSegment.start.y) <= tolerance
    ))
  );
  const normalizedHorizontal = (start, end) => new THREE.Vector3(end.x - start.x, 0, end.z - start.z).normalize();
  const sourceDirection = firstSegment ? normalizedHorizontal(firstSegment.start, firstSegment.end) : new THREE.Vector3();
  const destinationDirection = lastSegment ? normalizedHorizontal(lastSegment.start, lastSegment.end) : new THREE.Vector3();
  const endpointDirectionsAccepted = !horizontalKinds || (
    sourceDirection.lengthSq() > 0.5
    && destinationDirection.lengthSq() > 0.5
    && sourceDirection.dot(from.facing.clone().setY(0).normalize()) >= 0.95
    && destinationDirection.dot(to.facing.clone().setY(0).normalize()) <= -0.95
  );
  const excludedRoomIds = new Set([from.roomId, to.roomId]);
  const halfWidth = Math.max(0, width * 0.5);
  const clearanceAccepted = segments.every(({ start, end }) => {
    const minX = Math.min(start.x, end.x) - halfWidth;
    const maxX = Math.max(start.x, end.x) + halfWidth;
    const minZ = Math.min(start.z, end.z) - halfWidth;
    const maxZ = Math.max(start.z, end.z) + halfWidth;
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y) + headroom;
    return rooms.every((room) => {
      if (excludedRoomIds.has(room.id)) return true;
      const roomHalfWidth = Math.max(0.5, Number(room.width) || 1) * tileSize * 0.5;
      const roomHalfDepth = Math.max(0.5, Number(room.depth) || 1) * tileSize * 0.5;
      const roomMinX = room.position.x - roomHalfWidth;
      const roomMaxX = room.position.x + roomHalfWidth;
      const roomMinZ = room.position.z - roomHalfDepth;
      const roomMaxZ = room.position.z + roomHalfDepth;
      const verticalOverlap = maxY > (room.minY ?? -Infinity) && minY < (room.maxY ?? Infinity);
      const horizontalOverlap = maxX > roomMinX && minX < roomMaxX && maxZ > roomMinZ && minZ < roomMaxZ;
      return !(verticalOverlap && horizontalOverlap);
    });
  });
  return {
    orthogonalAccepted,
    alignmentAccepted,
    slopeGradeAccepted,
    endpointBuffersAccepted,
    endpointDirectionsAccepted,
    clearanceAccepted,
    minimumEndpointBufferMeters: minimumEndpointBuffer,
    maximumSlopeRisePerTileMeters,
    alignmentStepMeters: alignmentStep,
  };
}

function connectorWidth(connection, from, to, tileSize) {
  const properties = { ...(connection.properties ?? {}), ...connection };
  return Math.max(0.6, finiteNumber(
    properties.widthMeters
      ?? properties.width
      ?? Math.min(from?.socket?.width ?? Infinity, to?.socket?.width ?? Infinity),
    tileSize * 3,
  ));
}

function connectorFloorThickness(connection) {
  const properties = { ...(connection.properties ?? {}), ...connection };
  return Math.max(0.05, finiteNumber(properties.floorThickness, 0.22));
}

function connectorPlatformDescriptor(connection, start, end, width, thickness, segmentIndex) {
  const delta = end.clone().sub(start);
  const horizontalLength = Math.hypot(delta.x, delta.z);
  if (horizontalLength <= 0.0001 || Math.abs(delta.y) > 0.05) return null;
  const center = start.clone().add(end).multiplyScalar(0.5);
  center.y = start.y - thickness * 0.5;
  const halfWalkwayWidth = width * 0.5;
  const halfWalkwayLength = horizontalLength * 0.5 + 0.12;
  const runsAlongX = Math.abs(delta.x) >= Math.abs(delta.z);
  return {
    id: `${connection.id ?? connection.connectionId}-walkway-platform-${segmentIndex + 1}`,
    connectorId: connection.id ?? connection.connectionId,
    connectionId: connection.id ?? connection.connectionId,
    segmentIndex,
    center,
    position: center.clone(),
    halfWidth: runsAlongX ? halfWalkwayLength : halfWalkwayWidth,
    // Overlap adjacent segment support slightly because Game intentionally
    // shrinks platform landing tests by 0.08m at exposed edges.
    halfDepth: runsAlongX ? halfWalkwayWidth : halfWalkwayLength,
    topY: start.y,
    baseY: start.y - thickness,
    rotationY: 0,
    enabled: true,
    dynamic: false,
    blocksBelow: false,
    collisionThicknessMeters: thickness,
    authoredConnectorSurface: true,
    surfaceRole: 'walkway',
    containsTop(position, tolerance = 0) {
      if (!position) return false;
      return Math.abs(position.x - this.center.x) <= this.halfWidth + tolerance
        && Math.abs(position.z - this.center.z) <= this.halfDepth + tolerance;
    },
  };
}

function connectorLandingPlatform(connection, position, width, depth, thickness, label) {
  const center = position.clone().add(new THREE.Vector3(0, -thickness * 0.5, 0));
  return {
    id: `${connection.id ?? connection.connectionId}-${label}-platform`,
    connectorId: connection.id ?? connection.connectionId,
    connectionId: connection.id ?? connection.connectionId,
    center,
    position: center.clone(),
    halfWidth: width * 0.5,
    halfDepth: depth * 0.5,
    topY: position.y,
    baseY: position.y - thickness,
    rotationY: 0,
    enabled: true,
    dynamic: false,
    blocksBelow: false,
    collisionThicknessMeters: thickness,
    authoredConnectorSurface: true,
    surfaceRole: 'landing',
    containsTop(candidate, tolerance = 0) {
      return Boolean(candidate)
        && Math.abs(candidate.x - this.center.x) <= this.halfWidth + tolerance
        && Math.abs(candidate.z - this.center.z) <= this.halfDepth + tolerance;
    },
  };
}

function sampleConnectorFloor(connection, start, end, tileSize, width, segmentIndex = 0, roomId = null) {
  const horizontalDistance = Math.hypot(end.x - start.x, end.z - start.z);
  const count = Math.max(1, Math.ceil(horizontalDistance / tileSize));
  const laneCount = Math.max(1, Math.ceil(width / tileSize - 1e-7));
  const direction = new THREE.Vector3(end.x - start.x, 0, end.z - start.z);
  if (direction.lengthSq() > 0.0001) direction.normalize();
  else direction.set(0, 0, 1);
  const side = new THREE.Vector3(-direction.z, 0, direction.x);
  const slope = connectorKind(connection) === 'slope' || Math.abs(end.y - start.y) > 0.05;
  const result = [];
  for (let index = 0; index <= count; index += 1) {
    const alpha = index / count;
    const centerline = start.clone().lerp(end, alpha);
    for (let lane = 0; lane < laneCount; lane += 1) {
      const laneOffset = (lane - (laneCount - 1) * 0.5) * tileSize;
      const sampled = centerline.clone().addScaledVector(side, laneOffset);
      const gridX = Math.round(sampled.x / tileSize);
      const gridZ = Math.round(sampled.z / tileSize);
      const canonical = new THREE.Vector3(gridX * tileSize, centerline.y, gridZ * tileSize);
      const tile = {
        id: `${connection.id ?? connection.connectionId}-floor-${segmentIndex}-${gridX}-${gridZ}`,
        roomId,
        connectorId: connection.id ?? connection.connectionId,
        connectionId: connection.id ?? connection.connectionId,
        segmentIndex,
        x: gridX,
        z: gridZ,
        worldX: sampled.x,
        worldZ: sampled.z,
        elevation: centerline.y,
        position: canonical,
        surface: 'authoredConnector',
        surfaceRole: slope ? 'ramp' : 'connector',
        isConnector: true,
      };
      if (slope) {
        const along = (canonical.x - start.x) * direction.x + (canonical.z - start.z) * direction.z;
        const centerAlpha = along / Math.max(0.0001, horizontalDistance);
        const centerElevation = THREE.MathUtils.lerp(start.y, end.y, centerAlpha);
        const halfTileRise = (end.y - start.y) * tileSize * 0.5 / Math.max(0.0001, horizontalDistance);
        tile.rampDirectionX = Math.sign(direction.x);
        tile.rampDirectionZ = Math.sign(direction.z);
        tile.rampStartElevation = centerElevation - halfTileRise;
        tile.rampEndElevation = centerElevation + halfTileRise;
        tile.elevation = centerElevation;
        tile.position.y = tile.elevation;
      }
      result.push(tile);
    }
  }
  return result;
}

function sampleConnectorLanding(connection, position, tileSize, width, depth, label) {
  const columns = Math.max(1, Math.ceil(width / tileSize - 1e-7));
  const rows = Math.max(1, Math.ceil(depth / tileSize - 1e-7));
  const centerX = Math.round(position.x / tileSize);
  const centerZ = Math.round(position.z / tileSize);
  const result = [];
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const x = centerX + column - Math.floor(columns * 0.5);
      const z = centerZ + row - Math.floor(rows * 0.5);
      result.push({
        id: `${connection.id ?? connection.connectionId}-${label}-floor-${x}-${z}`,
        connectorId: connection.id ?? connection.connectionId,
        connectionId: connection.id ?? connection.connectionId,
        x,
        z,
        worldX: x * tileSize,
        worldZ: z * tileSize,
        elevation: position.y,
        position: new THREE.Vector3(x * tileSize, position.y, z * tileSize),
        surface: 'authoredConnectorLanding',
        surfaceRole: 'connector',
        isConnector: true,
      });
    }
  }
  return result;
}

function isConnectorRouteTurn(routePoints, pointIndex) {
  if (pointIndex <= 0 || pointIndex >= routePoints.length - 1) return false;
  const incoming = routePoints[pointIndex].clone().sub(routePoints[pointIndex - 1]).setY(0);
  const outgoing = routePoints[pointIndex + 1].clone().sub(routePoints[pointIndex]).setY(0);
  if (incoming.lengthSq() <= 0.0001 || outgoing.lengthSq() <= 0.0001) return false;
  return Math.abs(incoming.normalize().dot(outgoing.normalize())) < 0.999;
}

function connectorRailSpan(routePoints, segmentIndex, width, sign) {
  const start = routePoints[segmentIndex].clone();
  const end = routePoints[segmentIndex + 1].clone();
  const sourceStart = start.clone();
  const sourceEnd = end.clone();
  const direction = end.clone().sub(start).setY(0);
  const length = direction.length();
  if (length <= 0.0001) return { start, end, length: 0 };
  direction.normalize();
  const side = new THREE.Vector3(-direction.z, 0, direction.x);
  const previousDirection = segmentIndex > 0
    ? routePoints[segmentIndex].clone().sub(routePoints[segmentIndex - 1]).setY(0).normalize()
    : null;
  const nextDirection = segmentIndex + 2 < routePoints.length
    ? routePoints[segmentIndex + 2].clone().sub(routePoints[segmentIndex + 1]).setY(0).normalize()
    : null;
  let startTrim = isConnectorRouteTurn(routePoints, segmentIndex)
    && side.dot(previousDirection) * sign < -0.5 ? width * 0.5 : 0;
  let endTrim = isConnectorRouteTurn(routePoints, segmentIndex + 1)
    && side.dot(nextDirection) * sign > 0.5 ? width * 0.5 : 0;
  const requestedTrim = startTrim + endTrim;
  const maximumTrim = Math.max(0, length - 0.2);
  if (requestedTrim > maximumTrim && requestedTrim > 0) {
    const scale = maximumTrim / requestedTrim;
    startTrim *= scale;
    endTrim *= scale;
  }
  start.addScaledVector(direction, startTrim);
  end.addScaledVector(direction, -endTrim);
  start.y = THREE.MathUtils.lerp(sourceStart.y, sourceEnd.y, startTrim / length);
  end.y = THREE.MathUtils.lerp(sourceStart.y, sourceEnd.y, 1 - endTrim / length);
  return { start, end, length: start.distanceTo(end) };
}

function connectorRailZones(connection, routePoints, width, segmentIndex) {
  const properties = { ...(connection.properties ?? {}), ...connection };
  if (properties.rails === false) return [];
  const zones = [];
  for (const sign of [-1, 1]) {
    const { start, end } = connectorRailSpan(routePoints, segmentIndex, width, sign);
    const horizontal = end.clone().sub(start).setY(0);
    const length = horizontal.length();
    if (length <= 0.0001) continue;
    horizontal.normalize();
    const side = new THREE.Vector3(-horizontal.z, 0, horizontal.x);
    const rotationY = Math.atan2(horizontal.x, horizontal.z);
    const pieceCount = Math.max(1, Math.ceil(Math.abs(end.y - start.y) / 0.8));
    for (let pieceIndex = 0; pieceIndex < pieceCount; pieceIndex += 1) {
      const pieceStart = start.clone().lerp(end, pieceIndex / pieceCount);
      const pieceEnd = start.clone().lerp(end, (pieceIndex + 1) / pieceCount);
      const pieceLength = Math.hypot(pieceEnd.x - pieceStart.x, pieceEnd.z - pieceStart.z);
      const pieceRise = Math.abs(pieceEnd.y - pieceStart.y);
      const verticalHalfHeight = 0.95 + pieceRise * 0.5;
      const position = pieceStart.clone().add(pieceEnd).multiplyScalar(0.5)
        .addScaledVector(side, sign * width * 0.5);
      position.y += 0.95;
      zones.push({
        id: `${connection.id ?? connection.connectionId}-rail-zone-${segmentIndex}-${sign < 0 ? 'left' : 'right'}-${pieceIndex}`,
        connectorId: connection.id ?? connection.connectionId,
        connectionId: connection.id ?? connection.connectionId,
        segmentIndex,
        position,
        localPosition: position.clone(),
        size: new THREE.Vector3(0.12, verticalHalfHeight * 2, pieceLength + 0.04),
        halfWidth: 0.06,
        halfDepth: pieceLength * 0.5 + 0.02,
        verticalHalfHeight,
        rotationY,
        obstacleKind: 'connectorRail',
        blocksAerial: false,
      });
    }
  }
  return zones;
}

function addGallery(connection, from, to, routePoints, connectorGroup, materials, resources, tileSize) {
  const properties = { ...(connection.properties ?? {}), ...connection };
  const width = connectorWidth(connection, from, to, tileSize);
  const thickness = connectorFloorThickness(connection);
  const floorMeshes = [];
  const railMeshes = [];
  for (let segmentIndex = 0; segmentIndex < routePoints.length - 1; segmentIndex += 1) {
    const segmentStart = routePoints[segmentIndex];
    const segmentEnd = routePoints[segmentIndex + 1];
    const floorStart = segmentStart.clone().add(new THREE.Vector3(0, -thickness * 0.5, 0));
    const floorEnd = segmentEnd.clone().add(new THREE.Vector3(0, -thickness * 0.5, 0));
    floorMeshes.push(addBeamBetween(connectorGroup, floorStart, floorEnd, {
      width,
      thickness,
      material: connectorMaterial(materials, properties, 'floor'),
      name: `${connection.id}-serviceFloor-${segmentIndex + 1}`,
      resources,
      userData: { authoredConnector: true, connectorId: connection.id, segmentIndex, architectureRole: 'walkable connector floor' },
    }));
    if (properties.rails !== false) {
      for (const sign of [-1, 1]) {
        const railSpan = connectorRailSpan(routePoints, segmentIndex, width, sign);
        const horizontal = new THREE.Vector3(
          railSpan.end.x - railSpan.start.x,
          0,
          railSpan.end.z - railSpan.start.z,
        );
        if (horizontal.lengthSq() > 0.0001) {
          horizontal.normalize();
          const side = new THREE.Vector3(-horizontal.z, 0, horizontal.x);
          const offset = side.clone().multiplyScalar(sign * width * 0.5);
          const railStart = railSpan.start.clone().add(offset).add(new THREE.Vector3(0, 0.95, 0));
          const railEnd = railSpan.end.clone().add(offset).add(new THREE.Vector3(0, 0.95, 0));
          railMeshes.push(addBeamBetween(connectorGroup, railStart, railEnd, {
            width: 0.1,
            thickness: 0.1,
            material: connectorMaterial(materials, properties, 'metal'),
            name: `${connection.id}-rail-${segmentIndex + 1}-${sign < 0 ? 'left' : 'right'}`,
            resources,
            userData: { authoredConnector: true, connectorId: connection.id, segmentIndex, architectureRole: 'guard rail' },
          }));
        }
      }
    }
  }
  const center = from.position.clone().add(to.position).multiplyScalar(0.5);
  const length = routePoints.slice(1).reduce((total, point, index) => total + point.distanceTo(routePoints[index]), 0);
  return {
    id: connection.id,
    connectionId: connection.id,
    kind: connectorKind(connection),
    fromRoomId: from.roomId,
    toRoomId: to.roomId,
    start: from.position.clone(),
    end: to.position.clone(),
    center,
    width,
    length,
    elevationDelta: to.position.y - from.position.y,
    waypoints: routePoints.map((point) => point.clone()),
    floorMesh: floorMeshes[0] ?? null,
    floorMeshes,
    railMeshes,
    group: connectorGroup,
  };
}

function addLanding(parent, position, width, depth, material, resources, name) {
  const geometry = new THREE.BoxGeometry(width, 0.2, depth);
  resources.own(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(position).add(new THREE.Vector3(0, -0.1, 0));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addLadderConnection(connection, from, to, connectorGroup, materials, resources) {
  const lower = from.position.y <= to.position.y ? from : to;
  const upper = lower === from ? to : from;
  const height = Math.max(0.2, upper.position.y - lower.position.y);
  const center = lower.position.clone().add(upper.position).multiplyScalar(0.5);
  center.y = (lower.position.y + upper.position.y) * 0.5;
  const railMaterial = connectorMaterial(materials, connection, 'metal');
  const railGeometry = new THREE.CylinderGeometry(0.055, 0.055, height, 8);
  resources.own(railGeometry);
  const railMeshes = [];
  for (const x of [-0.34, 0.34]) {
    const rail = new THREE.Mesh(railGeometry, railMaterial);
    rail.name = `${connection.id}-ladderRail`;
    rail.position.copy(center).add(new THREE.Vector3(x, 0, 0));
    rail.castShadow = true;
    connectorGroup.add(rail);
    railMeshes.push(rail);
  }
  const rungCount = Math.max(2, Math.floor(height / 0.32));
  const rungGeometry = new THREE.CylinderGeometry(0.035, 0.035, 0.68, 8);
  rungGeometry.rotateZ(Math.PI * 0.5);
  resources.own(rungGeometry);
  const rungMeshes = [];
  for (let index = 0; index <= rungCount; index += 1) {
    const rung = new THREE.Mesh(rungGeometry, railMaterial);
    rung.name = `${connection.id}-ladderRung`;
    rung.position.set(center.x, lower.position.y + (height * index) / rungCount, center.z);
    connectorGroup.add(rung);
    rungMeshes.push(rung);
  }
  return {
    ...cloneData(connection),
    id: connection.id,
    connectionId: connection.id,
    label: connection.label ?? 'service ladder',
    direction: lower === from ? 'ascending' : 'descending',
    position: center,
    bottomY: lower.position.y,
    topY: upper.position.y,
    bottomExit: lower.position.clone(),
    topExit: upper.position.clone(),
    bottomMountPosition: lower.position.clone(),
    topMountPosition: upper.position.clone(),
    mountRadius: finiteNumber(connection.mountRadius ?? connection.properties?.mountRadius, 1.7),
    railMeshes,
    rungMeshes,
    group: connectorGroup,
  };
}

function addLiftConnection(connection, from, to, connectorGroup, materials, resources, tileSize) {
  const lower = from.position.y <= to.position.y ? from : to;
  const upper = lower === from ? to : from;
  const center = lower.position.clone().add(upper.position).multiplyScalar(0.5);
  center.y = lower.position.y;
  const width = Math.max(1, finiteNumber(connection.widthMeters ?? connection.width ?? connection.properties?.widthMeters, tileSize * 3));
  const depth = Math.max(1, finiteNumber(connection.depthMeters ?? connection.depth ?? connection.properties?.depthMeters, tileSize * 3));
  const platformMesh = addLanding(
    connectorGroup,
    center,
    width,
    depth,
    connectorMaterial(materials, connection, 'metal'),
    resources,
    `${connection.id}-liftPlatform`,
  );
  const landingMeshes = [
    addLanding(connectorGroup, lower.position, tileSize * 3, tileSize * 3, connectorMaterial(materials, connection, 'floor'), resources, `${connection.id}-lowerLanding`),
    addLanding(connectorGroup, upper.position, tileSize * 3, tileSize * 3, connectorMaterial(materials, connection, 'floor'), resources, `${connection.id}-upperLanding`),
  ];
  const shaftHeight = Math.max(0.2, upper.position.y - lower.position.y);
  const shaftMaterial = connectorMaterial(materials, connection, 'trim');
  const shaftGeometry = new THREE.BoxGeometry(0.12, shaftHeight, 0.12);
  resources.own(shaftGeometry);
  const shaftMeshes = [];
  for (const x of [-width * 0.5, width * 0.5]) {
    const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
    shaft.name = `${connection.id}-liftGuide`;
    shaft.position.set(center.x + x, lower.position.y + shaftHeight * 0.5, center.z);
    connectorGroup.add(shaft);
    shaftMeshes.push(shaft);
  }
  const controls = [lower, upper].map((endpointRecord, index) => ({
    id: `${connection.id}-${index === 0 ? 'lower' : 'upper'}-control`,
    liftId: connection.id,
    endpoint: index === 0 ? 'bottom' : 'top',
    position: endpointRecord.position.clone().add(new THREE.Vector3(width * 0.55, 0.8, 0)),
    interactionRadius: 1.55,
    label: `${index === 0 ? 'Call' : 'Send'} lift`,
  }));
  return {
    ...cloneData(connection),
    id: connection.id,
    connectionId: connection.id,
    label: connection.label ?? 'service lift',
    center,
    bottomElevation: lower.position.y,
    topElevation: upper.position.y,
    initialElevation: lower.position.y,
    currentElevation: lower.position.y,
    progressionSourceElevation: from.position.y,
    progressionDestinationElevation: to.position.y,
    platformWidthMeters: width,
    platformDepthMeters: depth,
    platformMesh,
    landingMeshes,
    surface: {
      id: `${connection.id}-surface`,
      center: center.clone(),
      halfWidth: width * 0.5,
      halfDepth: depth * 0.5,
      topY: lower.position.y,
    },
    controls,
    shaftMeshes,
    group: connectorGroup,
  };
}

function roomRuntimeRecord(instance, definition, wrapper, tileSize) {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  wrapper.matrixWorld.decompose(position, quaternion, scale);
  const dimensions = readSize3(
    instance.dimensions
      ?? definition.dimensions
      ?? {
        x: definition.widthMeters ?? finiteNumber(definition.width, 1) * tileSize,
        y: definition.heightMeters ?? finiteNumber(definition.height, 1),
        z: definition.depthMeters ?? finiteNumber(definition.depth, 1) * tileSize,
      },
  );
  return {
    ...cloneData(instance),
    id: normalizeId(instance.id ?? instance.roomId ?? definition.id),
    roomId: normalizeId(instance.roomId ?? instance.id ?? definition.id),
    moduleId: instance.moduleId ?? definition.moduleId ?? null,
    templateId: instance.templateId ?? definition.templateId ?? null,
    x: position.x / tileSize,
    z: position.z / tileSize,
    position,
    width: Math.max(1, dimensions.x / tileSize),
    depth: Math.max(1, dimensions.z / tileSize),
    dimensions,
    baseElevation: position.y,
    minY: position.y,
    maxY: position.y + dimensions.y,
    group: wrapper,
    authored: true,
    progressionBand: instance.progressionBand ?? instance.properties?.progressionBand ?? 0,
  };
}

function createMinimap(rooms, connections) {
  const minimapRooms = rooms.map((room) => {
    const width = Math.max(1, Number(room.width) || 1);
    const depth = Math.max(1, Number(room.depth) || 1);
    const center = { x: Number(room.x) || 0, z: Number(room.z) || 0 };
    return {
      roomId: room.id,
      roomType: room.type ?? room.archetype ?? 'authored-room',
      roomBounds2D: {
        x: center.x - width * 0.5,
        z: center.z - depth * 0.5,
        width,
        depth,
      },
      roomCenter2D: center,
      connectedRoomIds: connections
        .filter((connection) => connection.fromRoomId === room.id || connection.toRoomId === room.id)
        .map((connection) => connection.fromRoomId === room.id
          ? connection.toRoomId
          : connection.fromRoomId),
      progressionBand: room.progressionBand ?? 0,
      isInitialUnlockedArea: room.progressionBand === 0,
      containsKeycard: false,
      containsChest: false,
      containsBoss: room.isBoss === true,
      containsShrine: room.isShrine === true,
      ceilingHeight: room.dimensions?.y ?? null,
      verticalTierCount: 1,
      elevations: [room.minY ?? room.baseElevation ?? 0, room.maxY ?? room.baseElevation ?? 0],
      minY: room.minY,
      maxY: room.maxY,
    };
  });
  const extents = minimapRooms.reduce((bounds, room) => ({
    minX: Math.min(bounds.minX, room.roomBounds2D.x),
    minZ: Math.min(bounds.minZ, room.roomBounds2D.z),
    maxX: Math.max(bounds.maxX, room.roomBounds2D.x + room.roomBounds2D.width),
    maxZ: Math.max(bounds.maxZ, room.roomBounds2D.z + room.roomBounds2D.depth),
  }), { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity });
  const bounds = Number.isFinite(extents.minX)
    ? {
        minX: extents.minX,
        minZ: extents.minZ,
        width: Math.max(1, extents.maxX - extents.minX),
        depth: Math.max(1, extents.maxZ - extents.minZ),
      }
    : { minX: -1, minZ: -1, width: 2, depth: 2 };
  return {
    projection: 'authoredPlan',
    bounds,
    rooms: minimapRooms,
    hallways: connections.map((connection) => ({
      hallwayId: connection.id,
      fromRoomId: connection.fromRoomId,
      toRoomId: connection.toRoomId,
      doorId: connection.doorId ?? null,
      routes: cloneData(connection.routes ?? []),
      kind: connection.kind,
      elevationDelta: connection.elevationDelta,
    })),
    markers: [],
  };
}

/** Assemble a compiled authored dungeon (or an editor playtest snapshot). */
export async function assembleAuthoredDungeon(input, options = {}) {
  const source = selectDungeonSource(input);
  if (!source || typeof source !== 'object') throw new TypeError('assembleAuthoredDungeon requires a compiled dungeon object.');
  const strict = options.strict !== false;
  const diagnostics = { accepted: true, errors: [], warnings: [] };
  const roomInstances = asArray(source.rooms);
  const rawConnections = asArray(source.connections ?? source.roomConnections);
  const registry = AuthoredRoomRegistry.from(registrySource(input, options), {
    fallback: options.resolveRoom,
  });
  const resolvedRooms = await resolveRoomDefinitions(roomInstances, registry, diagnostics, strict);
  const sourceEntities = asArray(source.entities);
  const structuralEntityIds = foldStructuralEntities(resolvedRooms, sourceEntities, diagnostics);

  const ownsResolver = !(options.assetResolver instanceof AssetResolver);
  const assetResolver = ownsResolver
    ? createAssetResolver(options.assetResolver ?? {
        baseUrl: options.assetBaseUrl ?? source.assetBaseUrl ?? input?.assetBaseUrl,
        manifest: options.assetManifest
          ?? input?.project?.assetRecords
          ?? input?.project?.assets
          ?? input?.assetRecords
          ?? input?.assets
          ?? source.assets,
      })
    : options.assetResolver;
  const ownsMaterials = !(options.materialLibrary instanceof PBRMaterialLibrary);
  const materialDefinitions = mergeMaterialDefinitions(
    source.materials,
    ...resolvedRooms.map(({ definition }) => definition.materials),
  );
  const materials = ownsMaterials
    ? await createPBRMaterialLibrary(materialDefinitions, {
        assetResolver,
        includeDefaults: options.includeDefaultMaterials !== false,
        ownsResolver: false,
      })
    : options.materialLibrary;

  const group = new THREE.Group();
  group.name = normalizeId(source.name ?? source.dungeonId, 'authoredDungeon');
  group.userData = {
    authoredDungeon: true,
    dungeonId: source.dungeonId ?? source.id ?? null,
    revision: source.revision ?? null,
    contentHash: source.contentHash ?? null,
    schema: source.schema ?? null,
  };
  const connectorRoot = new THREE.Group();
  connectorRoot.name = 'authoredDungeonConnectors';
  group.add(connectorRoot);
  const connectorResources = new DisposableResourceSet();
  const connectedByRoom = connectedSocketsByRoom(rawConnections);
  const roomAssemblies = [];
  const rooms = [];
  const roomTransforms = new Map();
  const roomCenters = new Map();
  const socketLookup = new Map();
  const floorTiles = [];
  const solidZones = [];
  const platforms = [];
  const connectorFloorKeys = new Set();
  const socketFrames = [];
  const socketCaps = [];
  const tileSize = Math.max(0.1, finiteNumber(source.tileSize ?? source.metadata?.tileSize, 2.8));

  const appendConnectorFloorTiles = (tiles) => {
    for (const tile of tiles) {
      const key = `${tile.connectorId ?? ''}:${tile.x},${tile.z}@${finiteNumber(tile.elevation, 0).toFixed(3)}`;
      if (connectorFloorKeys.has(key)) continue;
      connectorFloorKeys.add(key);
      floorTiles.push(tile);
    }
  };

  for (const { instance, definition } of resolvedRooms) {
    const roomId = normalizeId(instance.id ?? instance.roomId ?? definition.id);
    const assembly = await assembleAuthoredRoom(definition, {
      ...options,
      assetResolver,
      materialLibrary: materials,
      connectedSocketIds: [...(connectedByRoom.get(roomId) ?? [])],
      strict,
    });
    const wrapper = new THREE.Group();
    wrapper.name = `${roomId}-instance`;
    wrapper.userData = { authoredRoomInstance: true, roomId, moduleId: instance.moduleId ?? definition.moduleId ?? null };
    applyTransform(wrapper, instance.transform ?? instance);
    wrapper.add(assembly.group);
    group.add(wrapper);
    group.updateMatrixWorld(true);
    const instanceMatrix = wrapper.matrixWorld.clone();
    const contentMatrix = assembly.group.matrixWorld.clone();
    roomTransforms.set(roomId, instanceMatrix);
    const runtimeRoom = roomRuntimeRecord(instance, definition, wrapper, tileSize);
    roomCenters.set(roomId, runtimeRoom.position);
    rooms.push(runtimeRoom);
    roomAssemblies.push({ roomId, instance, definition, assembly, wrapper, matrix: contentMatrix });
    for (const tile of assembly.floorTiles) floorTiles.push(transformFloorTile(tile, contentMatrix, roomId, tileSize));
    for (const zone of assembly.solidZones) solidZones.push(transformSpatialRecord(zone, contentMatrix, roomId));
    for (const platform of assembly.platforms) platforms.push(transformPlatform(platform, contentMatrix, roomId));
    for (const socket of assembly.socketFrames) {
      const worldSocket = transformSpatialRecord(socket, contentMatrix, roomId);
      socketFrames.push(worldSocket);
      socketLookup.set(socketLookupKey(roomId, socket.id), worldSocket);
    }
    for (const cap of assembly.socketCaps) socketCaps.push(transformSpatialRecord(cap, contentMatrix, roomId));
    diagnostics.errors.push(...assembly.diagnostics.errors.map((message) => `${roomId}: ${message}`));
    diagnostics.warnings.push(...assembly.diagnostics.warnings.map((message) => `${roomId}: ${message}`));
  }

  const connections = [];
  const serviceGalleries = [];
  const verticalConnectors = [];
  const connectorLadders = [];
  const connectorLifts = [];
  const connectorDiagnostics = [];
  for (let index = 0; index < rawConnections.length; index += 1) {
    const sourceConnection = { ...(rawConnections[index].properties ?? {}), ...rawConnections[index] };
    const connection = {
      ...sourceConnection,
      id: normalizeId(sourceConnection.id ?? sourceConnection.connectionId, `connection-${index + 1}`),
    };
    const from = resolveConnectionPoint(connection, 'from', socketLookup, roomCenters);
    const to = resolveConnectionPoint(connection, 'to', socketLookup, roomCenters);
    const kind = connectorKind(connection);
    const routePoints = connectionRoutePoints(connection, from, to, tileSize);
    const elevationDelta = to.position.y - from.position.y;
    const horizontalEndpointDistance = Math.hypot(
      to.position.x - from.position.x,
      to.position.z - from.position.z,
    );
    const clearHeight = finiteNumber(
      connection.clearHeightMeters
        ?? connection.clearHeight
        ?? connection.headroomMeters
        ?? Math.min(from.socket?.height ?? Infinity, to.socket?.height ?? Infinity),
      tileSize * 3,
    );
    const clearWidth = Math.max(0.6, finiteNumber(
      connection.widthMeters
        ?? connection.width
        ?? Math.min(from.socket?.width ?? Infinity, to.socket?.width ?? Infinity),
      tileSize * 3,
    ));
    const fromFamilies = socketFamilies(from.socket);
    const toFamilies = socketFamilies(to.socket);
    const compatibleFamilies = fromFamilies.length === 0 || toFamilies.length === 0
      ? [...new Set([...fromFamilies, ...toFamilies])]
      : fromFamilies.filter((family) => toFamilies.includes(family));
    const facingDot = from.facing.clone().setY(0).normalize()
      .dot(to.facing.clone().setY(0).normalize());
    const endpointSocketsResolved = (!from.socketId || Boolean(from.socket))
      && (!to.socketId || Boolean(to.socket));
    const elevationAccepted = kind === 'service-gallery'
      ? Math.abs(elevationDelta) <= 0.05
      : Math.abs(Math.abs(elevationDelta) - 14) <= 0.05;
    const familiesAccepted = fromFamilies.length === 0
      || toFamilies.length === 0
      || compatibleFamilies.length > 0;
    const routeValidation = validateConnectorRoute(routePoints, from, to, rooms, {
      kind,
      tileSize,
      width: clearWidth,
      headroom: clearHeight,
    });
    const connectionDiagnostic = {
      connectionId: connection.id,
      kind,
      routePointCount: routePoints.length,
      headroomMeters: clearHeight,
      minimumHeadroomMeters: 3.6,
      clearWidthMeters: clearWidth,
      minimumClearWidthMeters: tileSize * 3,
      elevationDelta,
      maximumElevationDelta: 14,
      headroomAccepted: clearHeight >= 3.6,
      elevationAccepted,
      horizontalEndpointDistance,
      maximumLiftHorizontalOffsetMeters: 0.05,
      liftShaftAligned: kind !== 'lift' || horizontalEndpointDistance <= 0.05,
      facingDot,
      facingTolerance: 0.05,
      facingAccepted: facingDot <= -0.95,
      fromFamilies,
      toFamilies,
      compatibleFamilies,
      familiesAccepted,
      endpointSocketsResolved,
      widthAccepted: clearWidth + 0.001 >= tileSize * 3,
      landingWidthMeters: tileSize * 3,
      landingDepthMeters: tileSize * 3,
      landingsAccepted: true,
      ...routeValidation,
    };
    connectionDiagnostic.accepted = connectionDiagnostic.headroomAccepted
      && connectionDiagnostic.elevationAccepted
      && connectionDiagnostic.liftShaftAligned
      && connectionDiagnostic.facingAccepted
      && connectionDiagnostic.familiesAccepted
      && connectionDiagnostic.endpointSocketsResolved
      && connectionDiagnostic.widthAccepted
      && connectionDiagnostic.orthogonalAccepted
      && connectionDiagnostic.alignmentAccepted
      && connectionDiagnostic.slopeGradeAccepted
      && connectionDiagnostic.endpointBuffersAccepted
      && connectionDiagnostic.endpointDirectionsAccepted
      && connectionDiagnostic.clearanceAccepted;
    connectorDiagnostics.push(connectionDiagnostic);
    if (!connectionDiagnostic.headroomAccepted) {
      diagnostics.errors.push(`Connection ${connection.id} has ${clearHeight.toFixed(2)}m headroom; at least 3.60m is required.`);
    }
    if (!connectionDiagnostic.elevationAccepted) {
      diagnostics.errors.push(kind === 'service-gallery'
        ? `Connection ${connection.id} changes elevation by ${elevationDelta.toFixed(2)}m; service galleries require level endpoints.`
        : `Connection ${connection.id} changes elevation by ${elevationDelta.toFixed(2)}m; ${kind} connectors require exactly +/-14m.`);
    }
    if (!connectionDiagnostic.liftShaftAligned) {
      diagnostics.errors.push(`Connection ${connection.id} lift sockets are ${horizontalEndpointDistance.toFixed(2)}m apart horizontally; lift endpoints must share one vertical shaft.`);
    }
    if (!connectionDiagnostic.facingAccepted) {
      diagnostics.errors.push(`Connection ${connection.id} socket facings are not opposed (dot ${facingDot.toFixed(3)}, expected <= -0.950).`);
    }
    if (!connectionDiagnostic.familiesAccepted) {
      diagnostics.errors.push(`Connection ${connection.id} has incompatible socket families (${fromFamilies.join(', ') || 'generic'} vs ${toFamilies.join(', ') || 'generic'}).`);
    }
    if (!connectionDiagnostic.endpointSocketsResolved) {
      diagnostics.errors.push(`Connection ${connection.id} references an unresolved endpoint socket.`);
    }
    if (!connectionDiagnostic.widthAccepted) {
      diagnostics.errors.push(`Connection ${connection.id} is ${clearWidth.toFixed(2)}m wide; at least ${(tileSize * 3).toFixed(2)}m is required.`);
    }
    if (!connectionDiagnostic.orthogonalAccepted) {
      diagnostics.errors.push(`Connection ${connection.id} contains a diagonal route segment; waypoints must form an orthogonal grid route.`);
    }
    if (!connectionDiagnostic.alignmentAccepted) {
      diagnostics.errors.push(`Connection ${connection.id} has a waypoint outside the 0.05m alignment tolerance.`);
    }
    if (!connectionDiagnostic.slopeGradeAccepted) {
      diagnostics.errors.push(`Connection ${connection.id} contains a vertical or over-steep slope segment; rise may not exceed 7/13m per ${tileSize.toFixed(2)}m tile.`);
    }
    if (!connectionDiagnostic.endpointBuffersAccepted) {
      diagnostics.errors.push(`Connection ${connection.id} requires ${(tileSize * 2).toFixed(2)}m flat endpoint buffers.`);
    }
    if (!connectionDiagnostic.endpointDirectionsAccepted) {
      diagnostics.errors.push(`Connection ${connection.id} does not depart and arrive along its socket facings.`);
    }
    if (!connectionDiagnostic.clearanceAccepted) {
      diagnostics.errors.push(`Connection ${connection.id} overlaps another authored room clearance volume.`);
    }
    const connectionGroup = new THREE.Group();
    connectionGroup.name = `${connection.id}-${kind}`;
    connectionGroup.userData = { authoredConnection: true, connectionId: connection.id, connectorKind: kind };
    connectorRoot.add(connectionGroup);
    let gallery = null;
    let ladder = null;
    let lift = null;

    // The connector mesh is presentation only. Materialize the traversal
    // surfaces independently so playtests, headless assembly, and exports all
    // share the same collision/navigation contract.
    const walkwayWidth = connectorWidth(connection, from, to, tileSize);
    const walkwayThickness = connectorFloorThickness(connection);
    const landingWidth = tileSize * 3;
    const landingDepth = tileSize * 3;
    platforms.push(
      connectorLandingPlatform(
        connection,
        from.position,
        landingWidth,
        landingDepth,
        walkwayThickness,
        'from-landing',
      ),
      connectorLandingPlatform(
        connection,
        to.position,
        landingWidth,
        landingDepth,
        walkwayThickness,
        'to-landing',
      ),
    );
    appendConnectorFloorTiles(
      sampleConnectorLanding(connection, from.position, tileSize, landingWidth, landingDepth, 'from-landing'),
    );
    appendConnectorFloorTiles(
      sampleConnectorLanding(connection, to.position, tileSize, landingWidth, landingDepth, 'to-landing'),
    );

    if (kind !== 'ladder' && kind !== 'lift') {
      for (let segmentIndex = 0; segmentIndex < routePoints.length - 1; segmentIndex += 1) {
        const segmentStart = routePoints[segmentIndex];
        const segmentEnd = routePoints[segmentIndex + 1];
        appendConnectorFloorTiles(sampleConnectorFloor(
          connection,
          segmentStart,
          segmentEnd,
          tileSize,
          walkwayWidth,
          segmentIndex,
          from.roomId ?? to.roomId ?? null,
        ));
        const platform = connectorPlatformDescriptor(
          connection,
          segmentStart,
          segmentEnd,
          walkwayWidth,
          walkwayThickness,
          segmentIndex,
        );
        if (platform) platforms.push(platform);
        solidZones.push(...connectorRailZones(connection, routePoints, walkwayWidth, segmentIndex));
      }
    }

    if (options.createConnectorGeometry !== false) {
      if (kind === 'ladder') {
        ladder = addLadderConnection(connection, from, to, connectionGroup, materials, connectorResources);
        connectorLadders.push(ladder);
        verticalConnectors.push({ ...ladder, connectorType: 'ladder', sourceElevation: from.position.y, destinationElevation: to.position.y });
        addLanding(connectionGroup, from.position, tileSize * 3, tileSize * 3, connectorMaterial(materials, connection, 'floor'), connectorResources, `${connection.id}-fromLanding`);
        addLanding(connectionGroup, to.position, tileSize * 3, tileSize * 3, connectorMaterial(materials, connection, 'floor'), connectorResources, `${connection.id}-toLanding`);
      } else if (kind === 'lift') {
        lift = addLiftConnection(connection, from, to, connectionGroup, materials, connectorResources, tileSize);
        connectorLifts.push(lift);
        verticalConnectors.push({ ...lift, connectorType: 'lift', sourceElevation: from.position.y, destinationElevation: to.position.y });
      } else {
        gallery = addGallery(connection, from, to, routePoints, connectionGroup, materials, connectorResources, tileSize);
        serviceGalleries.push(gallery);
        addLanding(connectionGroup, from.position, tileSize * 3, tileSize * 3, connectorMaterial(materials, connection, 'floor'), connectorResources, `${connection.id}-fromLanding`);
        addLanding(connectionGroup, to.position, tileSize * 3, tileSize * 3, connectorMaterial(materials, connection, 'floor'), connectorResources, `${connection.id}-toLanding`);
        if (kind === 'slope') verticalConnectors.push({ ...gallery, connectorType: 'slope', sourceElevation: from.position.y, destinationElevation: to.position.y });
      }
    }
    connections.push({
      ...cloneData(connection),
      id: connection.id,
      connectionId: connection.id,
      connectorId: connection.connectorId ?? connection.id,
      kind,
      fromRoomId: from.roomId,
      toRoomId: to.roomId,
      fromSocketId: from.socketId,
      toSocketId: to.socketId,
      from: { roomId: from.roomId, socketId: from.socketId, position: from.position.clone() },
      to: { roomId: to.roomId, socketId: to.socketId, position: to.position.clone() },
      sourceElevation: from.position.y,
      destinationElevation: to.position.y,
      elevationDelta: to.position.y - from.position.y,
      waypoints: routePoints.map((point) => point.clone()),
      route: {
        ...(cloneData(connection.route) ?? {}),
        waypoints: routePoints.map((point) => point.clone()),
      },
      bidirectional: connection.bidirectional !== false,
      group: connectionGroup,
      gallery,
      ladder,
      lift,
      routes: [{
        id: `${connection.id}-route`,
        connectorVariantId: kind,
        sourceElevation: from.position.y,
        destinationElevation: to.position.y,
        elevationDelta: to.position.y - from.position.y,
        requiredForProgression: connection.requiredForProgression !== false,
      }],
    });
  }

  const roomEntities = roomAssemblies.flatMap(({ roomId, definition }) => (
    asArray(definition.entities ?? definition.gameplay).map((entity) => ({ roomId, ...entity }))
  ));
  const topLevelEntities = sourceEntities.filter((entity) => !structuralEntityIds.has(entity.id));
  const topLevelIds = new Set(topLevelEntities.map((entity) => entity.id));
  const entities = [
    ...topLevelEntities,
    ...roomEntities.filter((entity) => !topLevelIds.has(entity.id)),
  ];
  const gameplay = assembleAuthoredGameplay(entities, {
    roomTransforms,
    materialLibrary: materials,
    spawnId: source.spawnId,
    defaultPlayerStart: rooms[0]?.position,
    defaultPlayerFacing: source.playerStartFacing,
    createVisuals: options.createGameplayVisuals !== false,
  });
  group.add(gameplay.group);

  const allLadders = [...connectorLadders, ...gameplay.ladders];
  const allLifts = [...connectorLifts, ...gameplay.connectorLifts];
  const liftPlatforms = allLifts.map((lift) => {
    const surface = lift.surface ?? {
      id: `${lift.id}-surface`,
      center: lift.center,
      halfWidth: lift.platformWidthMeters * 0.5,
      halfDepth: lift.platformDepthMeters * 0.5,
      topY: lift.bottomElevation,
    };
    surface.position ??= surface.center;
    surface.dynamic = true;
    surface.liftId = lift.id;
    return surface;
  });
  const allPlatforms = [
    ...platforms,
    ...liftPlatforms,
  ];
  const tiles = new Map();
  for (const tile of floorTiles) tiles.set(normalizedGridKey(tile.x, tile.z), tile);
  const progressionSource = {
    ...source,
    rooms,
    connections,
    doors: gameplay.doors,
    keycards: gameplay.keycards,
    entities,
  };
  const progression = createAuthoredProgressionData(progressionSource);
  const progressionManager = createAuthoredProgression(progression, { initialState: options.progressionState ?? source.progressionState });
  const minimap = createMinimap(rooms, connections);
  progression.minimap = minimap;

  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const boundsSphere = new THREE.Sphere();
  if (!bounds.isEmpty()) bounds.getBoundingSphere(boundsSphere);
  const disposableResources = new Set(connectorResources);
  for (const assembly of roomAssemblies) {
    for (const resource of assembly.assembly.disposableResources) disposableResources.add(resource);
  }
  for (const resource of gameplay.disposableResources) disposableResources.add(resource);
  if (ownsMaterials) for (const resource of materials.resources) disposableResources.add(resource);
  diagnostics.errors.push(...gameplay.diagnostics.errors);
  diagnostics.warnings.push(...gameplay.diagnostics.warnings);
  diagnostics.accepted = diagnostics.errors.length === 0;
  if (!diagnostics.accepted && strict) {
    for (const entry of roomAssemblies) entry.assembly.dispose();
    gameplay.dispose();
    connectorResources.dispose();
    if (ownsMaterials) materials.dispose();
    if (ownsResolver) assetResolver.dispose();
    throw new AggregateError(diagnostics.errors.map((message) => new Error(message)), 'Authored dungeon assembly failed.');
  }

  let disposed = false;
  const facade = {
    group,
    root: group,
    schema: source.schema ?? 'ruindivex-authored-dungeon/v1',
    dungeonId: source.dungeonId ?? source.id ?? group.name,
    dungeonKind: source.dungeonKind ?? 'authoredDungeon',
    dungeonFamilyId: source.dungeonFamilyId ?? source.metadata?.dungeonFamilyId ?? 'authored',
    themePackId: source.themePackId ?? source.metadata?.themePackId ?? null,
    contentHash: source.contentHash ?? null,
    revision: source.revision ?? null,
    authored: true,
    replacesStandardDungeon: source.replacesStandardDungeon === true,
    rooms,
    roomModuleIds: rooms.map((room) => room.moduleId).filter(Boolean),
    roomAssemblies,
    roomTransforms,
    tiles,
    floorTiles,
    solidZones,
    aerialBoundaryZones: solidZones.filter((zone) => zone.aerialBoundary === true || zone.blocksAerial === true),
    platforms: allPlatforms,
    socketFrames,
    socketCaps,
    connections,
    connectionPlans: connections,
    serviceGalleries,
    connectorDiagnostics,
    verticalConnectors,
    doors: gameplay.doors,
    keycards: gameplay.keycards,
    chests: gameplay.chests,
    encounters: gameplay.encounters,
    traps: gameplay.traps,
    conveyors: gameplay.conveyors,
    conveyorPuzzles: [],
    ladders: allLadders,
    connectorLifts: allLifts,
    mechanisms: gameplay.mechanisms,
    puzzleBlocks: gameplay.puzzleBlocks,
    pressurePlates: gameplay.pressurePlates,
    shrine: gameplay.shrine,
    shrinePosition: gameplay.shrinePosition,
    safeZones: gameplay.safeZones,
    safeInteractables: gameplay.safeInteractables,
    interactables: gameplay.interactables,
    exits: gameplay.exits,
    playerStarts: gameplay.playerStarts,
    playerStart: gameplay.playerStart,
    playerStartFacing: gameplay.playerStartFacing,
    campReturnPosition: gameplay.campReturnPosition,
    ruinEntryPosition: gameplay.ruinEntryPosition,
    extractionPosition: gameplay.extractionPosition,
    entranceRoomId: progression.entranceRoomId,
    progression,
    progressionManager,
    minimap,
    keySeeker: gameplay.safeInteractables.find((entry) => entry.action === 'keySeeker') ?? progression.keySeeker ?? null,
    tileSize,
    boundsRadius: bounds.isEmpty() ? 0 : boundsSphere.radius,
    enemySpawnPoints: gameplay.encounters.flatMap((encounter) => encounter.spawnPoints ?? []),
    environmentalHazards: gameplay.traps,
    npcAnimationMixers: [],
    npcAnimators: [],
    renderCullGroups: [],
    specialEnvironment: source.specialEnvironment ?? null,
    specialEnvironmentId: source.specialEnvironmentId ?? null,
    assetResolver,
    materials,
    roomRegistry: registry,
    diagnostics,
    disposableResources,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      gameplay.dispose();
      for (const entry of roomAssemblies) entry.assembly.dispose();
      connectorResources.dispose();
      if (ownsMaterials) materials.dispose();
      if (ownsResolver) assetResolver.dispose();
      disposableResources.clear();
    },
  };
  Object.defineProperty(facade, 'disposed', { enumerable: true, get: () => disposed });
  return facade;
}

export const assembleDungeon = assembleAuthoredDungeon;
export const createAuthoredDungeon = assembleAuthoredDungeon;
export { selectDungeonSource as normalizeAuthoredDungeonSource };
