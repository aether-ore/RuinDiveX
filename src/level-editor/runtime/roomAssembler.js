import * as THREE from 'three';
import { AssetResolver, createAssetResolver } from './AssetResolver.js';
import {
  createPBRMaterialLibrary,
  PBRMaterialLibrary,
} from './materials.js';
import {
  applyTransform,
  asArray,
  cloneData,
  createBoxGeometry,
  DisposableResourceSet,
  finiteNumber,
  normalizeId,
  readEuler,
  readSize3,
  readTransform,
  readVector3,
  setObjectMetadata,
  transformMatrix,
  transformPoint,
} from './utils.js';

function roomSource(input = {}) {
  if (input?.definition && typeof input.definition === 'object') {
    return {
      ...cloneData(input.definition),
      id: input.roomId ?? input.id ?? input.definition.id,
      moduleId: input.moduleId ?? input.definition.moduleId,
      templateId: input.templateId ?? input.definition.templateId,
      instanceProperties: cloneData(input.properties ?? {}),
    };
  }
  return cloneData(input ?? {});
}

function collection(source, ...keys) {
  for (const key of keys) {
    const value = key.split('.').reduce((owner, field) => owner?.[field], source);
    if (value != null) return asArray(value);
  }
  return [];
}

function materialFor(library, source, fallback = 'default') {
  return library.resolve(
    source?.materialId ?? source?.material ?? source?.surfaceMaterial,
    fallback,
  );
}

function applyModelMaterialOverrides(model, overrides, library) {
  if (!overrides || typeof overrides !== 'object') return;
  model.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const replaced = sourceMaterials.map((sourceMaterial, slotIndex) => {
      const materialId = overrides[`${object.name}:${slotIndex}`]
        ?? overrides[object.name]
        ?? overrides[sourceMaterial?.name]
        ?? overrides[String(slotIndex)]
        ?? overrides.default;
      return materialId ? library.resolve(materialId, null) ?? sourceMaterial : sourceMaterial;
    });
    object.material = Array.isArray(object.material) ? replaced : replaced[0];
  });
}

function itemSize(source = {}, fallback = { x: 1, y: 1, z: 1 }) {
  return readSize3(
    source.size
      ?? source.dimensions
      ?? {
        x: source.width ?? source.radius != null ? Number(source.radius) * 2 : fallback.x,
        y: source.height ?? source.thickness ?? fallback.y,
        z: source.depth ?? source.length ?? fallback.z,
      },
    fallback,
  );
}

function explicitSize(source = {}, fallback = { x: 1, y: 1, z: 1 }) {
  if (source.size != null || source.dimensions != null) return readSize3(source.size ?? source.dimensions, fallback);
  return readSize3({
    x: source.width ?? (source.radius != null ? Number(source.radius) * 2 : fallback.x),
    y: source.height ?? source.thickness ?? fallback.y,
    z: source.depth ?? source.length ?? fallback.z,
  }, fallback);
}

function primitiveGeometry(source, resources) {
  const kind = String(source.shape ?? source.primitive ?? source.kind ?? source.type ?? 'box').toLowerCase();
  const size = explicitSize(source);
  let geometry;
  switch (kind) {
    case 'sphere':
    case 'orb':
      geometry = new THREE.SphereGeometry(
        finiteNumber(source.radius, Math.max(size.x, size.y, size.z) * 0.5),
        Math.max(3, Math.floor(finiteNumber(source.widthSegments ?? source.segments, 24))),
        Math.max(2, Math.floor(finiteNumber(source.heightSegments, 16))),
      );
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(
        finiteNumber(source.radiusTop, finiteNumber(source.radius, size.x * 0.5)),
        finiteNumber(source.radiusBottom, finiteNumber(source.radius, size.z * 0.5)),
        size.y,
        Math.max(3, Math.floor(finiteNumber(source.radialSegments ?? source.segments, 16))),
      );
      break;
    case 'cone':
      geometry = new THREE.ConeGeometry(
        finiteNumber(source.radius, Math.max(size.x, size.z) * 0.5),
        size.y,
        Math.max(3, Math.floor(finiteNumber(source.radialSegments ?? source.segments, 16))),
      );
      break;
    case 'capsule':
      geometry = new THREE.CapsuleGeometry(
        finiteNumber(source.radius, Math.max(size.x, size.z) * 0.5),
        Math.max(0.0001, finiteNumber(source.length, size.y - Math.max(size.x, size.z))),
        Math.max(1, Math.floor(finiteNumber(source.capSegments, 4))),
        Math.max(3, Math.floor(finiteNumber(source.radialSegments, 12))),
      );
      break;
    case 'plane':
    case 'quad':
      geometry = new THREE.PlaneGeometry(size.x, size.z);
      if (source.vertical !== true) geometry.rotateX(-Math.PI * 0.5);
      break;
    case 'circle':
      geometry = new THREE.CircleGeometry(
        finiteNumber(source.radius, Math.max(size.x, size.z) * 0.5),
        Math.max(3, Math.floor(finiteNumber(source.segments, 24))),
      );
      if (source.vertical !== true) geometry.rotateX(-Math.PI * 0.5);
      break;
    case 'ring':
      geometry = new THREE.RingGeometry(
        finiteNumber(source.innerRadius, Math.max(size.x, size.z) * 0.25),
        finiteNumber(source.outerRadius, Math.max(size.x, size.z) * 0.5),
        Math.max(3, Math.floor(finiteNumber(source.segments, 24))),
      );
      if (source.vertical !== true) geometry.rotateX(-Math.PI * 0.5);
      break;
    case 'torus':
      geometry = new THREE.TorusGeometry(
        finiteNumber(source.radius, Math.max(size.x, size.z) * 0.35),
        finiteNumber(source.tube, Math.min(size.x, size.y, size.z) * 0.15),
        Math.max(3, Math.floor(finiteNumber(source.radialSegments, 8))),
        Math.max(3, Math.floor(finiteNumber(source.tubularSegments ?? source.segments, 24))),
      );
      break;
    case 'ramp': {
      const halfWidth = size.x * 0.5;
      const halfHeight = size.y * 0.5;
      const halfDepth = size.z * 0.5;
      const points = {
        frontLeft: [-halfWidth, -halfHeight, -halfDepth],
        frontRight: [halfWidth, -halfHeight, -halfDepth],
        backLeft: [-halfWidth, -halfHeight, halfDepth],
        backRight: [halfWidth, -halfHeight, halfDepth],
        topLeft: [-halfWidth, halfHeight, halfDepth],
        topRight: [halfWidth, halfHeight, halfDepth],
      };
      const triangles = [
        ['frontLeft', 'backLeft', 'backRight'], ['frontLeft', 'backRight', 'frontRight'],
        ['frontLeft', 'topRight', 'frontRight'], ['frontLeft', 'topLeft', 'topRight'],
        ['backLeft', 'backRight', 'topRight'], ['backLeft', 'topRight', 'topLeft'],
        ['frontLeft', 'backLeft', 'topLeft'],
        ['frontRight', 'topRight', 'backRight'],
      ];
      const positions = triangles.flatMap((triangle) => triangle.flatMap((key) => points[key]));
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      break;
    }
    case 'cube':
    case 'rect':
    case 'box':
    default:
      geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
      break;
  }
  if (['box', 'cube', 'rect', 'ramp', 'plane', 'quad'].includes(kind)) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const metersPerRepeat = Math.max(0.01, finiteNumber(
      source.uvTileSizeMeters ?? source.textureTileSizeMeters ?? source.metersPerRepeat,
      2.8,
    ));
    const uvs = new Float32Array(position.count * 2);
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      const nx = Math.abs(normal?.getX(index) ?? 0);
      const ny = Math.abs(normal?.getY(index) ?? 1);
      const nz = Math.abs(normal?.getZ(index) ?? 0);
      if (ny >= nx && ny >= nz) {
        uvs[index * 2] = x / metersPerRepeat;
        uvs[index * 2 + 1] = z / metersPerRepeat;
      } else if (nx >= nz) {
        uvs[index * 2] = z / metersPerRepeat;
        uvs[index * 2 + 1] = y / metersPerRepeat;
      } else {
        uvs[index * 2] = x / metersPerRepeat;
        uvs[index * 2 + 1] = y / metersPerRepeat;
      }
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  resources.own(geometry);
  return geometry;
}

function createPrimitiveMesh(source, parent, library, resources, fallbackMaterial = 'default') {
  const mesh = new THREE.Mesh(
    primitiveGeometry(source, resources),
    materialFor(library, source, fallbackMaterial),
  );
  applyTransform(mesh, source);
  setObjectMetadata(mesh, source, {
    name: normalizeId(source.id, 'authoredPrimitive'),
    userData: { authoredPrimitive: true, authoredShape: source.shape ?? source.type ?? 'box' },
  });
  parent.add(mesh);
  return mesh;
}

function surfacePosition(surface, thickness) {
  const transform = readTransform(surface);
  const explicitElevation = surface.elevation ?? surface.floorY ?? surface.topY;
  if (explicitElevation != null) transform.position.y = finiteNumber(explicitElevation) - thickness * 0.5;
  else if (surface.anchor === 'top') transform.position.y -= thickness * 0.5;
  return transform.position;
}

function expandSurface(surface, room) {
  const cells = asArray(surface.cells ?? surface.tiles);
  if (cells.length > 0) {
    return cells.map((cell, index) => ({
      ...surface,
      ...cell,
      id: normalizeId(cell.id, `${surface.id ?? 'surface'}-${index + 1}`),
      cells: undefined,
      tiles: undefined,
    }));
  }
  const grid = surface.grid;
  if (!grid || typeof grid !== 'object') return [surface];
  const columns = Math.max(1, Math.floor(finiteNumber(grid.columns ?? grid.width, 1)));
  const rows = Math.max(1, Math.floor(finiteNumber(grid.rows ?? grid.depth, 1)));
  const tileSize = finiteNumber(grid.tileSize ?? surface.tileSize ?? room.tileSize, 1);
  const origin = readVector3(grid.origin ?? surface.position ?? surface);
  const entries = [];
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      entries.push({
        ...surface,
        id: `${surface.id ?? 'surface'}-${column}-${row}`,
        position: {
          x: origin.x + (column - (columns - 1) * 0.5) * tileSize,
          y: origin.y,
          z: origin.z + (row - (rows - 1) * 0.5) * tileSize,
        },
        gridX: finiteNumber(grid.startX, 0) + column,
        gridZ: finiteNumber(grid.startZ, 0) + row,
        width: tileSize,
        depth: tileSize,
        grid: undefined,
      });
    }
  }
  return entries;
}

function floorDescriptor(surface, mesh, roomId, thickness) {
  const position = mesh.position.clone();
  const top = surface.elevation ?? surface.floorY ?? surface.topY ?? position.y + thickness * 0.5;
  return {
    ...cloneData(surface),
    id: normalizeId(surface.id, mesh.name),
    roomId,
    x: finiteNumber(surface.gridX ?? surface.tileX ?? surface.x ?? position.x),
    z: finiteNumber(surface.gridZ ?? surface.tileZ ?? surface.z ?? position.z),
    elevation: finiteNumber(top),
    position,
    localPosition: position.clone(),
    surface: surface.surface ?? surface.surfaceId ?? surface.materialId ?? 'authoredFloor',
    surfaceRole: surface.surfaceRole ?? surface.role ?? 'floor',
    mesh,
  };
}

function createSolidZone(source, roomId, defaults = {}) {
  const size = explicitSize(source, defaults.size ?? { x: 1, y: 1, z: 1 });
  const transform = readTransform(source);
  return {
    ...cloneData(source),
    id: normalizeId(source.id, defaults.id ?? `${roomId}-solid`),
    roomId,
    position: transform.position,
    localPosition: transform.position.clone(),
    size: size.clone(),
    halfWidth: finiteNumber(source.halfWidth, size.x * 0.5),
    halfDepth: finiteNumber(source.halfDepth, size.z * 0.5),
    verticalHalfHeight: finiteNumber(source.verticalHalfHeight ?? source.halfHeight, size.y * 0.5),
    rotation: transform.rotation.clone(),
    rotationY: transform.rotation.y,
    obstacleKind: source.obstacleKind ?? source.colliderKind ?? source.kind ?? defaults.obstacleKind ?? 'authoredSolid',
  };
}

function createPlatformDescriptor(source, mesh, roomId) {
  const transform = readTransform(source);
  const authoredSize = explicitSize(source, { x: 1, y: 0.25, z: 1 });
  const size = new THREE.Vector3(
    Math.abs(authoredSize.x * transform.scale.x),
    Math.abs(authoredSize.y * transform.scale.y),
    Math.abs(authoredSize.z * transform.scale.z),
  );
  const topY = finiteNumber(
    source.elevation ?? source.floorY ?? source.topY,
    transform.position.y + size.y * 0.5,
  );
  return {
    ...cloneData(source),
    id: normalizeId(source.id, `${roomId}-platform`),
    roomId,
    position: transform.position,
    localPosition: transform.position.clone(),
    center: transform.position.clone(),
    size,
    halfWidth: size.x * 0.5,
    halfDepth: size.z * 0.5,
    topY,
    baseY: finiteNumber(source.baseY, topY - size.y),
    rotationY: transform.rotation.y,
    authoredRoomSurface: source.authoredRoomSurface === true,
    surfaceRole: source.surfaceRole ?? source.role ?? source.type ?? 'platform',
    containsTop(position, tolerance = 0) {
      const center = this.center ?? this.position;
      if (!position || !center) return false;
      const deltaX = position.x - center.x;
      const deltaZ = position.z - center.z;
      const yaw = finiteNumber(this.rotationY);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const localX = deltaX * cos - deltaZ * sin;
      const localZ = deltaX * sin + deltaZ * cos;
      return Math.abs(localX) <= this.halfWidth + tolerance
        && Math.abs(localZ) <= this.halfDepth + tolerance;
    },
    mesh,
  };
}

const WALKABLE_PRIMITIVE_ROLES = new Set([
  'floor',
  'platform',
  'walkway',
  'catwalk',
  'ramp',
]);

function walkablePrimitiveRole(source = {}) {
  const role = String(
    source.surfaceRole
      ?? source.role
      ?? source.type
      ?? source.properties?.surfaceRole
      ?? '',
  ).toLowerCase();
  return WALKABLE_PRIMITIVE_ROLES.has(role) ? role : null;
}

function primitiveRequestsBlockingCollider(source, collisionOnly, walkable) {
  if (collisionOnly) return true;
  const collisionRole = String(source.collisionRole ?? source.properties?.collisionRole ?? '').toLowerCase();
  const explicitBlocking = source.blockingCollider === true
    || source.solidObstacle === true
    || source.properties?.blockingCollider === true
    || collisionRole === 'solid'
    || collisionRole === 'obstacle';
  if (walkable && !explicitBlocking) return false;
  return source.collider === true
    || source.collision === true
    || source.solid === true
    || explicitBlocking;
}

function isBoxWallPrimitive(source) {
  const descriptor = `${source?.type ?? ''} ${source?.kind ?? ''} ${source?.surfaceRole ?? ''} ${source?.name ?? ''} ${source?.id ?? ''}`.toLowerCase();
  const shape = String(source?.shape ?? source?.primitive ?? source?.type ?? 'box').toLowerCase();
  return /wall/.test(descriptor) && ['box', 'cube', 'rect', 'wall'].includes(shape);
}

function splitWallPrimitiveAtConnectedSockets(source, sockets, connectedSocketIds) {
  if (!isBoxWallPrimitive(source) || connectedSocketIds.size === 0) return [source];
  const transform = readTransform(source);
  if (Math.abs(transform.rotation.x) > 0.001 || Math.abs(transform.rotation.z) > 0.001) return [source];
  const authoredSize = explicitSize(source, { x: 1, y: 1, z: 1 });
  const size = new THREE.Vector3(
    Math.abs(authoredSize.x * transform.scale.x),
    Math.abs(authoredSize.y * transform.scale.y),
    Math.abs(authoredSize.z * transform.scale.z),
  );
  const normalAxis = size.x <= size.z ? 'x' : 'z';
  const lateralAxis = normalAxis === 'x' ? 'z' : 'x';
  const thickness = size[normalAxis];
  const lateralSize = size[lateralAxis];
  if (thickness > Math.max(1, lateralSize * 0.25)) return [source];

  const portals = [];
  for (const socket of sockets) {
    if (!connectedSocketIds.has(String(socket?.id ?? '')) || socket.enabled === false) continue;
    const socketTransform = readTransform(socket);
    const localPosition = socketTransform.position.clone()
      .sub(transform.position)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), -transform.rotation.y);
    const socketFacing = readVector3(
      socket.facing ?? socket.direction ?? { x: socket.facingX, y: socket.facingY, z: socket.facingZ },
      { x: Math.sin(socketYaw(socket)), y: 0, z: Math.cos(socketYaw(socket)) },
    ).applyAxisAngle(new THREE.Vector3(0, 1, 0), -transform.rotation.y).normalize();
    if (Math.abs(socketFacing[normalAxis]) < 0.9) continue;
    const socketDepth = Math.max(0.05, finiteNumber(socket.depth, 0.3));
    if (Math.abs(localPosition[normalAxis]) > thickness * 0.5 + socketDepth * 0.5 + 0.05) continue;
    const width = Math.max(0.1, finiteNumber(socket.width ?? socket.widthMeters, 3));
    const height = Math.max(0.1, finiteNumber(socket.height ?? socket.heightMeters, 3));
    const padding = 0.02;
    portals.push({
      left: localPosition[lateralAxis] - width * 0.5 - padding,
      right: localPosition[lateralAxis] + width * 0.5 + padding,
      bottom: socketTransform.position.y - padding,
      top: socketTransform.position.y + height + padding,
    });
  }
  if (!portals.length) return [source];

  const wallBottom = transform.position.y - size.y * 0.5;
  const wallTop = transform.position.y + size.y * 0.5;
  const lateralMinimum = -lateralSize * 0.5;
  const lateralMaximum = lateralSize * 0.5;
  let rectangles = [{ left: lateralMinimum, right: lateralMaximum, bottom: wallBottom, top: wallTop }];
  for (const portal of portals) {
    const next = [];
    for (const rectangle of rectangles) {
      const left = Math.max(rectangle.left, portal.left);
      const right = Math.min(rectangle.right, portal.right);
      const bottom = Math.max(rectangle.bottom, portal.bottom);
      const top = Math.min(rectangle.top, portal.top);
      if (right - left <= 0.001 || top - bottom <= 0.001) {
        next.push(rectangle);
        continue;
      }
      if (left - rectangle.left > 0.02) next.push({ ...rectangle, right: left });
      if (rectangle.right - right > 0.02) next.push({ ...rectangle, left: right });
      if (bottom - rectangle.bottom > 0.02) next.push({ left, right, bottom: rectangle.bottom, top: bottom });
      if (rectangle.top - top > 0.02) next.push({ left, right, bottom: top, top: rectangle.top });
    }
    rectangles = next;
  }

  return rectangles.map((rectangle, index) => {
    const lateralCenter = (rectangle.left + rectangle.right) * 0.5;
    const verticalCenter = (rectangle.bottom + rectangle.top) * 0.5;
    const localOffset = new THREE.Vector3(
      lateralAxis === 'x' ? lateralCenter : 0,
      verticalCenter - transform.position.y,
      lateralAxis === 'z' ? lateralCenter : 0,
    ).applyAxisAngle(new THREE.Vector3(0, 1, 0), transform.rotation.y);
    const position = transform.position.clone().add(localOffset);
    const pieceSize = normalAxis === 'x'
      ? { x: thickness, y: rectangle.top - rectangle.bottom, z: rectangle.right - rectangle.left }
      : { x: rectangle.right - rectangle.left, y: rectangle.top - rectangle.bottom, z: thickness };
    return {
      ...source,
      id: `${source.id ?? 'wall'}-portal-segment-${index + 1}`,
      name: `${source.name ?? source.id ?? 'Wall'} portal segment ${index + 1}`,
      size: pieceSize,
      transform: {
        position: { x: position.x, y: position.y, z: position.z },
        rotation: { x: 0, y: transform.rotation.y, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      sourceWallId: source.id ?? null,
      properties: { ...(source.properties ?? {}), socketPortalSegment: true },
    };
  });
}

/**
 * Runtime floor records use integer 2.8 m tile keys. Editor primitives are
 * free to have arbitrary dimensions, so rasterize their footprint onto that
 * grid while a continuous platform descriptor preserves the exact top area.
 */
function floorDescriptorsForPrimitive(source, mesh, roomId, roomTileSize) {
  const role = walkablePrimitiveRole(source);
  if (!role) return [];

  const tileSize = Math.max(0.05, finiteNumber(source.tileSize ?? roomTileSize, 2.8));
  const transform = readTransform(source);
  const authoredSize = explicitSize(source, { x: tileSize, y: 0.2, z: tileSize });
  const size = new THREE.Vector3(
    Math.abs(authoredSize.x * transform.scale.x),
    Math.abs(authoredSize.y * transform.scale.y),
    Math.abs(authoredSize.z * transform.scale.z),
  );
  const columns = Math.max(1, Math.ceil(size.x / tileSize - 1e-7));
  const rows = Math.max(1, Math.ceil(size.z / tileSize - 1e-7));
  const yaw = transform.rotation.y;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const lowY = transform.position.y - size.y * 0.5;
  const highY = transform.position.y + size.y * 0.5;
  const flatTopY = finiteNumber(
    source.elevation ?? source.floorY ?? source.topY,
    highY,
  );
  const directionX = Math.abs(Math.sin(yaw)) >= Math.abs(Math.cos(yaw))
    ? Math.sign(Math.sin(yaw))
    : 0;
  const directionZ = directionX === 0 ? Math.sign(Math.cos(yaw)) || 1 : 0;
  const descriptors = new Map();

  const rampElevation = (localZ) => THREE.MathUtils.lerp(
    lowY,
    highY,
    THREE.MathUtils.clamp((localZ + size.z * 0.5) / Math.max(0.0001, size.z), 0, 1),
  );

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const localX = (column - (columns - 1) * 0.5) * tileSize;
      const localZ = (row - (rows - 1) * 0.5) * tileSize;
      const unsnappedX = transform.position.x + localX * cos + localZ * sin;
      const unsnappedZ = transform.position.z - localX * sin + localZ * cos;
      // Match Math.round's positive-half convention despite floating-point
      // representations such as 1.4 / 2.8 landing infinitesimally below 0.5.
      const gridX = Math.round(unsnappedX / tileSize + 1e-7);
      const gridZ = Math.round(unsnappedZ / tileSize + 1e-7);
      const key = `${gridX},${gridZ}`;
      const elevation = role === 'ramp' ? rampElevation(localZ) : flatTopY;
      const tileSource = {
        ...source,
        id: `${source.id ?? mesh?.name ?? 'primitive'}-tile-${gridX}-${gridZ}`,
        position: {
          x: gridX * tileSize,
          y: transform.position.y,
          z: gridZ * tileSize,
        },
        gridX,
        gridZ,
        elevation,
        surfaceRole: role,
        surface: source.surface ?? source.surfaceId ?? source.materialId ?? 'authoredFloor',
        tileSize,
      };
      if (role === 'ramp') {
        tileSource.rampDirectionX = directionX;
        tileSource.rampDirectionZ = directionZ;
        tileSource.rampStartElevation = rampElevation(localZ - tileSize * 0.5);
        tileSource.rampEndElevation = rampElevation(localZ + tileSize * 0.5);
      }
      const tileMesh = {
        name: mesh?.name ?? source.id ?? 'authoredFloor',
        position: readVector3(tileSource.position),
      };
      const descriptor = floorDescriptor(tileSource, tileMesh, roomId, size.y);
      descriptor.mesh = mesh;
      descriptors.set(key, descriptor);
    }
  }

  return [...descriptors.values()];
}

function socketYaw(socket) {
  const facing = readVector3(
    socket.facing
      ?? socket.direction
      ?? { x: socket.facingX, y: socket.facingY, z: socket.facingZ },
    { x: 0, y: 0, z: 1 },
  );
  if (Math.abs(facing.x) + Math.abs(facing.z) > 0.0001) return Math.atan2(facing.x, facing.z);
  return readEuler(socket.rotation ?? socket, socket).y;
}

function addSocketFrame({ socket, parent, library, resources, roomId, solidZones }) {
  const frame = new THREE.Group();
  frame.name = normalizeId(socket.name ?? socket.id, `${roomId}-socket`);
  const position = readVector3(socket.position ?? {
    x: socket.x,
    y: socket.y ?? socket.elevation,
    z: socket.z,
  });
  frame.position.copy(position);
  frame.rotation.y = socketYaw(socket);
  frame.userData = {
    ...cloneData(socket.userData),
    authoredSocketFrame: true,
    socketId: socket.id ?? null,
    roomId,
  };
  parent.add(frame);
  const width = Math.max(0.4, finiteNumber(socket.width ?? socket.widthMeters ?? socket.clearWidth ?? socket.clearWidthMeters, 3));
  const height = Math.max(0.4, finiteNumber(socket.height ?? socket.heightMeters ?? socket.clearHeight ?? socket.clearHeightMeters, 3));
  const thickness = Math.max(0.04, finiteNumber(socket.frameThickness ?? socket.thickness, 0.18));
  const depth = Math.max(0.04, finiteNumber(socket.depth, 0.3));
  const material = materialFor(library, socket, 'trim');
  const parts = [
    { id: 'left', size: { x: thickness, y: height, z: depth }, position: { x: -(width + thickness) * 0.5, y: height * 0.5, z: 0 } },
    { id: 'right', size: { x: thickness, y: height, z: depth }, position: { x: (width + thickness) * 0.5, y: height * 0.5, z: 0 } },
    { id: 'top', size: { x: width + thickness * 2, y: thickness, z: depth }, position: { x: 0, y: height + thickness * 0.5, z: 0 } },
  ];
  const partMeshes = [];
  frame.updateMatrix();
  for (const part of parts) {
    const mesh = new THREE.Mesh(createBoxGeometry(part.size, resources), material);
    mesh.name = `${frame.name}-${part.id}`;
    mesh.position.copy(readVector3(part.position));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { authoredSocketPart: part.id, socketId: socket.id ?? null, roomId };
    frame.add(mesh);
    partMeshes.push(mesh);
    if (socket.collision !== false) {
      const localMatrix = new THREE.Matrix4().compose(
        position,
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), frame.rotation.y),
        new THREE.Vector3(1, 1, 1),
      );
      const center = transformPoint(part.position, localMatrix);
      solidZones.push(createSolidZone({
        id: `${socket.id ?? frame.name}-${part.id}-collider`,
        position: center,
        size: part.size,
        rotationY: frame.rotation.y,
        obstacleKind: 'socketFrame',
      }, roomId));
    }
  }
  return {
    ...cloneData(socket),
    id: normalizeId(socket.id, frame.name),
    roomId,
    position,
    localPosition: position.clone(),
    facing: readVector3(
      socket.facing
        ?? socket.direction
        ?? { x: socket.facingX, y: socket.facingY, z: socket.facingZ },
      { x: 0, y: 0, z: 1 },
    ).normalize(),
    width,
    height,
    frame,
    group: frame,
    meshes: partMeshes,
  };
}

function addSocketCap({ cap, socket, parent, library, resources, roomId, solidZones }) {
  const source = { ...socket, ...cap };
  const capId = normalizeId(cap.id, `${socket.id ?? 'socket'}-cap`);
  const width = Math.max(0.4, finiteNumber(source.width ?? source.widthMeters ?? source.clearWidth ?? source.clearWidthMeters, 3));
  const height = Math.max(0.4, finiteNumber(source.height ?? source.heightMeters ?? source.clearHeight ?? source.clearHeightMeters, 3));
  const depth = Math.max(0.04, finiteNumber(source.capDepth ?? source.depth, 0.2));
  const mesh = new THREE.Mesh(
    createBoxGeometry({ x: width, y: height, z: depth }, resources),
    materialFor(library, source, 'wall'),
  );
  mesh.name = normalizeId(cap.name, capId);
  mesh.position.copy(readVector3(source.position ?? socket.position ?? {
    x: source.x ?? socket.x,
    y: source.y ?? source.elevation ?? socket.y ?? socket.elevation,
    z: source.z ?? socket.z,
  }));
  mesh.position.y += height * 0.5;
  mesh.rotation.y = socketYaw(source);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { ...cloneData(source.userData), authoredSocketCap: true, socketId: socket.id, roomId };
  parent.add(mesh);
  const descriptor = {
    ...cloneData(source),
    id: capId,
    socketId: socket.id,
    roomId,
    position: mesh.position.clone(),
    localPosition: mesh.position.clone(),
    width,
    height,
    depth,
    mesh,
  };
  if (source.collision !== false) {
    const zone = createSolidZone({
      id: `${descriptor.id}-collider`,
      position: mesh.position,
      size: { x: width, y: height, z: depth },
      rotationY: mesh.rotation.y,
      obstacleKind: 'socketCap',
    }, roomId);
    descriptor.solidZone = zone;
    solidZones.push(zone);
  }
  return descriptor;
}

function shouldCapSocket(socket, connectedSocketIds, options) {
  if (connectedSocketIds.has(String(socket.id))) return false;
  if (socket.connected === true || socket.active === true || socket.open === true) return false;
  if (socket.cap === false || socket.capped === false) return false;
  return socket.cap === true
    || socket.capped === true
    || socket.closed === true
    || socket.inactive === true
    || socket.capPreset != null
    || socket.optional === true
    || options.capUnusedSockets === true;
}

async function prepareMaterialLibrary(definition, options, resolver) {
  if (options.materialLibrary instanceof PBRMaterialLibrary) {
    return { library: options.materialLibrary, owned: false };
  }
  if (options.materials instanceof PBRMaterialLibrary) {
    return { library: options.materials, owned: false };
  }
  const suppliedMaterialValues = options.materials ? Object.values(options.materials) : [];
  const externalMaterials = suppliedMaterialValues.length > 0
    && suppliedMaterialValues.every((value) => value?.isMaterial);
  if (externalMaterials) {
    return {
      library: new PBRMaterialLibrary({ materials: new Map(Object.entries(options.materials)), assetResolver: resolver }),
      owned: false,
    };
  }
  const definitions = {
    ...(definition.materials ?? definition.materialDefinitions ?? {}),
    ...(options.materials ?? {}),
  };
  return {
    library: await createPBRMaterialLibrary(definitions, {
      assetResolver: resolver,
      includeDefaults: options.includeDefaultMaterials !== false,
      ownsResolver: false,
    }),
    owned: true,
  };
}

/**
 * Turns a declarative room module into scene geometry plus collision/traversal
 * descriptors. The input is never mutated and may be serialized plain data.
 */
export async function assembleAuthoredRoom(input, options = {}) {
  const definition = roomSource(input);
  const roomId = normalizeId(definition.id ?? definition.roomId ?? definition.moduleId, 'authored-room');
  const ownsResolver = !(options.assetResolver instanceof AssetResolver);
  const assetResolver = ownsResolver
    ? createAssetResolver(options.assetResolver ?? {
        baseUrl: options.assetBaseUrl ?? definition.assetBaseUrl,
        manifest: options.assetManifest ?? definition.assets,
      })
    : options.assetResolver;
  const { library: materials, owned: ownsMaterials } = await prepareMaterialLibrary(definition, options, assetResolver);
  const resources = new DisposableResourceSet();
  const group = new THREE.Group();
  group.name = normalizeId(definition.name ?? definition.room?.name, roomId);
  group.userData = {
    ...cloneData(definition.userData),
    authoredRoom: true,
    roomId,
    roomModuleId: definition.moduleId ?? null,
    templateId: definition.templateId ?? null,
  };
  if (definition.transform) applyTransform(group, definition.transform);
  group.updateMatrix();

  const floorTiles = [];
  const solidZones = [];
  const platforms = [];
  const socketFrames = [];
  const socketCaps = [];
  const models = [];
  const meshes = [];
  const diagnostics = { accepted: true, errors: [], warnings: [] };
  const connectedSocketIds = new Set(asArray(options.connectedSocketIds).map((entry) => String(entry.id ?? entry.value ?? entry)));
  const socketSources = collection(definition, 'socketFrames', 'sockets', 'connections.sockets');

  const surfaces = collection(definition, 'surfaces', 'geometry.surfaces', 'floorSurfaces')
    .flatMap((surface) => expandSurface(surface, definition));
  for (const surface of surfaces) {
    const thickness = Math.max(0.02, finiteNumber(surface.thickness ?? surface.height, 0.2));
    const size = explicitSize(surface, {
      x: finiteNumber(surface.tileSize ?? definition.tileSize, 1),
      y: thickness,
      z: finiteNumber(surface.tileSize ?? definition.tileSize, 1),
    });
    size.y = thickness;
    const meshSource = {
      ...surface,
      shape: surface.shape ?? (surface.surfaceRole === 'ramp' ? 'ramp' : 'box'),
      size,
      position: surfacePosition(surface, thickness),
    };
    if (surface.surfaceRole === 'ramp' && surface.rise != null && surface.run != null && !surface.rotation && !surface.rotationDegrees) {
      meshSource.rotation = { x: -Math.atan2(finiteNumber(surface.rise), Math.max(0.0001, finiteNumber(surface.run))), y: finiteNumber(surface.yaw), z: 0 };
    }
    const mesh = createPrimitiveMesh(meshSource, group, materials, resources, 'floor');
    mesh.userData.authoredSurface = true;
    mesh.userData.surfaceRole = surface.surfaceRole ?? surface.role ?? 'floor';
    meshes.push(mesh);
    if (surface.walkable !== false && surface.collisionOnly !== true) {
      floorTiles.push(floorDescriptor(surface, mesh, roomId, thickness));
    }
    if (surface.solid === true || surface.collider === true) {
      solidZones.push(createSolidZone({ ...meshSource, id: `${surface.id ?? mesh.name}-collider` }, roomId));
    }
    if (surface.platform === true || surface.surfaceRole === 'platform') {
      platforms.push(createPlatformDescriptor(meshSource, mesh, roomId));
    }
  }

  const primitiveSources = collection(definition, 'primitives', 'geometry.primitives', 'geometry.meshes')
    .flatMap((primitive) => splitWallPrimitiveAtConnectedSockets(primitive, socketSources, connectedSocketIds));
  for (const primitive of primitiveSources) {
    if (primitive.enabled === false) continue;
    const collisionOnly = primitive.collisionOnly === true
      || primitive.type === 'collision-box'
      || primitive.properties?.visual === false;
    const surfaceRole = walkablePrimitiveRole(primitive);
    const walkable = Boolean(surfaceRole)
      && primitive.walkable !== false
      && primitive.collision !== false
      && !collisionOnly;
    const mesh = primitive.visual === false || collisionOnly
      ? null
      : createPrimitiveMesh(primitive, group, materials, resources);
    if (mesh) meshes.push(mesh);
    if (walkable) {
      floorTiles.push(...floorDescriptorsForPrimitive(
        { ...primitive, surfaceRole },
        mesh,
        roomId,
        definition.tileSize,
      ));
      if (surfaceRole !== 'ramp') {
        platforms.push(createPlatformDescriptor({
          ...primitive,
          authoredRoomSurface: true,
          surfaceRole,
          blocksBelow: primitive.blocksBelow ?? false,
          collisionThicknessMeters: primitive.collisionThicknessMeters
            ?? explicitSize(primitive, { x: 1, y: 0.2, z: 1 }).y,
        }, mesh, roomId));
      }
    }
    if (primitiveRequestsBlockingCollider(primitive, collisionOnly, walkable)) {
      solidZones.push(createSolidZone({ ...primitive, id: `${primitive.id ?? mesh?.name ?? 'primitive'}-collider` }, roomId));
    }
    if (!walkable && primitive.platform === true) platforms.push(createPlatformDescriptor(primitive, mesh, roomId));
  }

  const colliderSources = collection(definition, 'colliders', 'solidZones', 'collision.solids');
  for (const collider of colliderSources) solidZones.push(createSolidZone(collider, roomId));

  const platformSources = collection(definition, 'platforms', 'traversal.platforms');
  for (const platform of platformSources) {
    let mesh = null;
    if (platform.visual !== false && platform.mesh !== false) {
      mesh = createPrimitiveMesh({ shape: 'box', height: 0.24, ...platform }, group, materials, resources, 'metal');
      meshes.push(mesh);
    }
    const descriptor = createPlatformDescriptor(platform, mesh, roomId);
    platforms.push(descriptor);
    if (platform.solid === true || platform.collider === true) {
      solidZones.push(createSolidZone({ ...platform, id: `${descriptor.id}-collider` }, roomId));
    }
  }

  const modelSources = collection(definition, 'models', 'assets.models', 'geometry.models');
  for (const modelDefinition of modelSources) {
    if (modelDefinition.enabled === false) continue;
    const asset = modelDefinition.asset ?? modelDefinition.assetId ?? modelDefinition.url ?? modelDefinition.src ?? modelDefinition.model;
    try {
      const model = await assetResolver.loadModel(asset, {
        clone: modelDefinition.clone !== false,
        cloneMaterials: modelDefinition.cloneMaterials === true,
        cloneGeometry: modelDefinition.cloneGeometry === true,
        resources,
      });
      if (!model) continue;
      applyTransform(model, modelDefinition);
      setObjectMetadata(model, modelDefinition, {
        name: normalizeId(modelDefinition.id, 'authoredModel'),
        userData: { authoredModel: true, roomId, assetId: modelDefinition.assetId ?? null },
      });
      const overrideMaterial = materialFor(materials, modelDefinition, null);
      if ((modelDefinition.materialId || modelDefinition.material) && overrideMaterial) {
        model.traverse((object) => {
          if (object.isMesh) object.material = overrideMaterial;
        });
      }
      applyModelMaterialOverrides(model, modelDefinition.materialOverrides, materials);
      group.add(model);
      models.push({ ...cloneData(modelDefinition), object: model, model });
      if (modelDefinition.collider === true || modelDefinition.collision === true || modelDefinition.solid === true) {
        const bounds = modelDefinition.colliderSize ?? modelDefinition.size ?? modelDefinition.dimensions;
        if (bounds) solidZones.push(createSolidZone({ ...modelDefinition, size: bounds, id: `${modelDefinition.id ?? model.name}-collider` }, roomId));
        else diagnostics.warnings.push(`Model ${modelDefinition.id ?? asset} requested collision without colliderSize.`);
      }
    } catch (error) {
      const message = `Failed to load room model ${modelDefinition.id ?? asset}: ${error.message}`;
      if (options.strictAssets === true) {
        diagnostics.errors.push(message);
      } else {
        diagnostics.warnings.push(message);
      }
    }
  }

  const socketsById = new Map();
  for (const socket of socketSources) {
    if (socket.enabled === false) continue;
    const frame = addSocketFrame({ socket, parent: group, library: materials, resources, roomId, solidZones });
    socketFrames.push(frame);
    socketsById.set(frame.id, frame);
  }

  const explicitCaps = collection(definition, 'socketCaps', 'caps');
  const explicitlyCapped = new Set();
  for (const cap of explicitCaps) {
    const socketId = normalizeId(cap.socketId ?? cap.id);
    const socket = socketSources.find((candidate) => String(candidate.id) === socketId) ?? cap;
    if (connectedSocketIds.has(socketId) || cap.enabled === false) continue;
    socketCaps.push(addSocketCap({ cap, socket, parent: group, library: materials, resources, roomId, solidZones }));
    explicitlyCapped.add(socketId);
  }
  for (const socket of socketSources) {
    const socketId = normalizeId(socket.id);
    if (!socketId || explicitlyCapped.has(socketId) || !shouldCapSocket(socket, connectedSocketIds, options)) continue;
    const cap = typeof socket.cap === 'object' ? socket.cap : {};
    socketCaps.push(addSocketCap({ cap, socket, parent: group, library: materials, resources, roomId, solidZones }));
  }

  diagnostics.accepted = diagnostics.errors.length === 0;
  if (!diagnostics.accepted && options.strict !== false) {
    if (ownsMaterials) materials.dispose();
    resources.dispose();
    if (ownsResolver) assetResolver.dispose();
    throw new AggregateError(
      diagnostics.errors.map((message) => new Error(message)),
      `Authored room ${roomId} could not be assembled.`,
    );
  }

  let disposed = false;
  const disposableResources = new Set(resources);
  if (ownsMaterials) for (const resource of materials.resources) disposableResources.add(resource);
  const result = {
    group,
    room: definition,
    roomId,
    moduleId: definition.moduleId ?? null,
    templateId: definition.templateId ?? null,
    floorTiles,
    solidZones,
    platforms,
    socketFrames,
    socketCaps,
    sockets: socketFrames,
    models,
    meshes,
    materials,
    assetResolver,
    resources,
    disposableResources,
    diagnostics,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      resources.dispose();
      if (ownsMaterials) materials.dispose();
      if (ownsResolver) assetResolver.dispose();
      disposableResources.clear();
    },
  };
  Object.defineProperty(result, 'disposed', { enumerable: true, get: () => disposed });
  return result;
}

export const assembleRoom = assembleAuthoredRoom;
export const createAuthoredRoom = assembleAuthoredRoom;
export { createSolidZone as createAuthoredSolidZone };
