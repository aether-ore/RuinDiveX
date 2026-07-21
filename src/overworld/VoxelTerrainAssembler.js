import * as THREE from 'three';
import {
  OVERWORLD_CELL_SIZE,
  OVERWORLD_LEVEL_HEIGHT,
  OVERWORLD_VISUAL_CELLS,
  createAuthoredOverworldPlan,
  validateOverworldPlan,
} from './OverworldPlan.js';
import {
  toSixFaceTexturePaths,
  validateVoxelFaceTextureManifest,
} from './VoxelFaceTextureManifest.js';
import { createSharedCampAssets } from './SharedCampAssetFactory.js';

export const TERRAIN_MATERIAL_KEYS = Object.freeze([
  'meadow:top',
  'meadow:side',
  'trail:top',
  'trail:side',
  'stone:top',
  'stone:side',
]);

// The authored visual terrain ends 24m beyond the 144m playable core. A
// camera standing on the playable boundary can see another 120m, so the
// visual-only horizon continues by 126m (84 whole terrain cells). Its outer
// edge is consequently 150m from the nearest playable point and remains past
// both the camera range and the authored 115m far-fog distance.
export const OVERWORLD_HORIZON_EXTENSION_METRES = 126;
export const OVERWORLD_HORIZON_MINIMUM_EXTENSION_METRES = 125;
export const OVERWORLD_HORIZON_CAMERA_RANGE_METRES = 120;
export const OVERWORLD_HORIZON_CONTRACT = Object.freeze({
  id: 'overworld-visual-horizon-v1',
  revision: 1,
  source: 'OverworldPlan.visualTerrain.edge-cells',
  extensionMetres: OVERWORLD_HORIZON_EXTENSION_METRES,
  minimumExtensionMetres: OVERWORLD_HORIZON_MINIMUM_EXTENSION_METRES,
  cameraRangeMetres: OVERWORLD_HORIZON_CAMERA_RANGE_METRES,
  uvWorldRepeatMetres: OVERWORLD_CELL_SIZE,
  meshCount: 1,
  maximumDrawCalls: TERRAIN_MATERIAL_KEYS.length,
  collidable: false,
  playable: false,
});

/**
 * Runtime contract for voxel props whose dimensions are supplied by mesh or
 * instance transforms. Terrain does not use this shader path: greedy terrain
 * geometry already stores its exact world-metre repeat count in the UV
 * attribute. Keeping the two paths separate prevents a material hook intended
 * for scaled boxes from double-scaling the terrain UVs.
 */
export const VOXEL_PROP_UV_CONTRACT = Object.freeze({
  id: 'overworld-voxel-prop-world-density',
  revision: 1,
  repeatWorldMetres: OVERWORLD_CELL_SIZE,
  projection: 'local-face-axes-scaled-to-world-metres',
  supportsInstancing: true,
  supportsQuarterTurnYaw: true,
  terrainUvPath: 'geometry-authored',
});

export const OVERWORLD_BUILDING_GEOMETRY_CONTRACT = Object.freeze({
  id: 'overworld-shared-building-geometry-v1',
  revision: 1,
  primitive: 'unit-voxel-box',
  allocationCount: 1,
  consumers: Object.freeze([
    'house-walls',
    'house-roofs',
    'house-doors',
    'house-windows',
    'house-extensions',
    'tree-trunks',
    'tree-canopies',
  ]),
});

/**
 * JavaScript reference implementation of the shader projection. It is kept
 * pure so tests and diagnostics can verify UV density without a WebGL context.
 */
export function projectVoxelPropUv(position, normal, axisWorldLengths, {
  repeatWorldMetres = VOXEL_PROP_UV_CONTRACT.repeatWorldMetres,
} = {}) {
  const p = [position?.x, position?.y, position?.z];
  const n = [normal?.x, normal?.y, normal?.z];
  const axis = Array.isArray(axisWorldLengths)
    ? axisWorldLengths
    : [axisWorldLengths?.x, axisWorldLengths?.y, axisWorldLengths?.z];
  if (![...p, ...n, ...axis, repeatWorldMetres].every(Number.isFinite)
    || axis.some((value) => value < 0)
    || repeatWorldMetres <= 0) {
    throw new TypeError('Voxel UV projection requires finite position, normal, axis lengths, and repeat scale');
  }
  const metric = p.map((value, index) => value * axis[index]);
  const absoluteNormal = n.map(Math.abs);
  if (absoluteNormal[1] >= absoluteNormal[0] && absoluteNormal[1] >= absoluteNormal[2]) {
    return Object.freeze({ u: metric[0] / repeatWorldMetres, v: metric[2] / repeatWorldMetres });
  }
  if (absoluteNormal[0] >= absoluteNormal[2]) {
    return Object.freeze({ u: metric[2] / repeatWorldMetres, v: metric[1] / repeatWorldMetres });
  }
  return Object.freeze({ u: metric[0] / repeatWorldMetres, v: metric[1] / repeatWorldMetres });
}

function voxelUvShaderSource(repeatWorldMetres) {
  const repeatLiteral = Number(repeatWorldMetres).toFixed(8);
  return `
#include <project_vertex>
#ifdef USE_MAP
  // Match the transform order in <project_vertex>. Column lengths are the
  // exact world-space lengths of the original geometry axes, independent of
  // instance yaw, translation, and non-uniform scale.
  mat3 voxelLocalTransform = mat3( 1.0 );
  #ifdef USE_BATCHING
    voxelLocalTransform = mat3( batchingMatrix ) * voxelLocalTransform;
  #endif
  #ifdef USE_INSTANCING
    voxelLocalTransform = mat3( instanceMatrix ) * voxelLocalTransform;
  #endif
  mat3 voxelObjectToWorld = mat3( modelMatrix ) * voxelLocalTransform;
  vec3 voxelAxisWorldLengths = vec3(
    length( voxelObjectToWorld[ 0 ] ),
    length( voxelObjectToWorld[ 1 ] ),
    length( voxelObjectToWorld[ 2 ] )
  );
  vec3 voxelMetricPosition = transformed * voxelAxisWorldLengths;
  vec3 voxelAbsoluteNormal = abs( objectNormal );
  vec2 voxelMetricUv;
  if ( voxelAbsoluteNormal.y >= voxelAbsoluteNormal.x && voxelAbsoluteNormal.y >= voxelAbsoluteNormal.z ) {
    voxelMetricUv = voxelMetricPosition.xz;
  } else if ( voxelAbsoluteNormal.x >= voxelAbsoluteNormal.z ) {
    voxelMetricUv = voxelMetricPosition.zy;
  } else {
    voxelMetricUv = voxelMetricPosition.xy;
  }
  vMapUv = ( mapTransform * vec3( voxelMetricUv / ${repeatLiteral}, 1.0 ) ).xy;
#endif`;
}

/**
 * Adds an instancing-safe UV-density hook to a prop-only material. Callers must
 * not pass a greedy terrain material because its UVs are already metre based.
 */
export function configureVoxelPropWorldUv(material, {
  repeatWorldMetres = VOXEL_PROP_UV_CONTRACT.repeatWorldMetres,
  familyId = null,
  faceRole = null,
} = {}) {
  if (!material?.isMaterial) throw new TypeError('A Three.js material is required');
  if (!Number.isFinite(repeatWorldMetres) || repeatWorldMetres <= 0) {
    throw new RangeError('Voxel prop texture repeat scale must be positive and finite');
  }
  if (material.userData?.voxelPropUvContract) {
    throw new Error(`Material ${material.name || material.uuid} already has a voxel prop UV contract`);
  }
  const previousOnBeforeCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  const replacement = voxelUvShaderSource(repeatWorldMetres);
  material.onBeforeCompile = function onBeforeCompileVoxelPropWorldUv(shader, renderer) {
    previousOnBeforeCompile.call(this, shader, renderer);
    const anchor = '#include <project_vertex>';
    if (!shader.vertexShader.includes(anchor)) {
      throw new Error('Three.js voxel UV shader hook could not locate <project_vertex>');
    }
    shader.vertexShader = shader.vertexShader.replace(anchor, replacement);
  };
  material.customProgramCacheKey = () => (
    `${previousCacheKey()}|voxel-prop-uv-r${VOXEL_PROP_UV_CONTRACT.revision}:${repeatWorldMetres}`
  );
  material.userData.voxelPropUvContract = Object.freeze({
    ...VOXEL_PROP_UV_CONTRACT,
    repeatWorldMetres,
    familyId,
    faceRole,
  });
  material.needsUpdate = true;
  return material;
}

function addQuad(batches, materialKey, vertices, uvs) {
  const batch = batches.get(materialKey) ?? { positions: [], uvs: [], indices: [], quadCount: 0 };
  const offset = batch.positions.length / 3;
  for (const vertex of vertices) batch.positions.push(vertex[0], vertex[1], vertex[2]);
  for (const uv of uvs) batch.uvs.push(uv[0], uv[1]);
  batch.indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  batch.quadCount += 1;
  batches.set(materialKey, batch);
}

function terrainIndex(x, z) {
  return z * OVERWORLD_VISUAL_CELLS + x;
}

function terrainHeight(plan, x, z, outsideHeight = -8) {
  if (x < 0 || z < 0 || x >= OVERWORLD_VISUAL_CELLS || z >= OVERWORLD_VISUAL_CELLS) {
    return outsideHeight;
  }
  return plan.visualTerrain.heightLevels[terrainIndex(x, z)] * OVERWORLD_LEVEL_HEIGHT;
}

function terrainSurface(plan, x, z) {
  return plan.visualTerrain.surfaceIds[terrainIndex(x, z)];
}

function cellWorldX(x) {
  return planOrigin() + x * OVERWORLD_CELL_SIZE;
}

function cellWorldZ(z) {
  return planOrigin() + z * OVERWORLD_CELL_SIZE;
}

function planOrigin() {
  return -(OVERWORLD_VISUAL_CELLS * OVERWORLD_CELL_SIZE) * 0.5;
}

function buildTopFaces(plan, range, batches) {
  const visited = new Set();
  const endX = range.minX + range.width;
  const endZ = range.minZ + range.depth;
  for (let z = range.minZ; z < endZ; z += 1) {
    for (let x = range.minX; x < endX; x += 1) {
      const localKey = `${x},${z}`;
      if (visited.has(localKey)) continue;
      const height = terrainHeight(plan, x, z);
      const surface = terrainSurface(plan, x, z);
      let width = 1;
      while (x + width < endX
        && !visited.has(`${x + width},${z}`)
        && terrainHeight(plan, x + width, z) === height
        && terrainSurface(plan, x + width, z) === surface) width += 1;
      let depth = 1;
      depthLoop: while (z + depth < endZ) {
        for (let dx = 0; dx < width; dx += 1) {
          if (visited.has(`${x + dx},${z + depth}`)
            || terrainHeight(plan, x + dx, z + depth) !== height
            || terrainSurface(plan, x + dx, z + depth) !== surface) break depthLoop;
        }
        depth += 1;
      }
      for (let dz = 0; dz < depth; dz += 1) {
        for (let dx = 0; dx < width; dx += 1) visited.add(`${x + dx},${z + dz}`);
      }
      const x0 = cellWorldX(x);
      const x1 = cellWorldX(x + width);
      const z0 = cellWorldZ(z);
      const z1 = cellWorldZ(z + depth);
      addQuad(batches, `${surface}:top`, [
        [x0, height, z0], [x0, height, z1], [x1, height, z1], [x1, height, z0],
      ], [[0, 0], [0, depth], [width, depth], [width, 0]]);
    }
  }
}

function buildNorthSouthFaces(plan, range, batches, direction) {
  const endX = range.minX + range.width;
  const endZ = range.minZ + range.depth;
  for (let z = range.minZ; z < endZ; z += 1) {
    let x = range.minX;
    while (x < endX) {
      const ownHeight = terrainHeight(plan, x, z);
      const neighborHeight = terrainHeight(plan, x, z + direction);
      if (ownHeight <= neighborHeight) {
        x += 1;
        continue;
      }
      const surface = terrainSurface(plan, x, z);
      let width = 1;
      while (x + width < endX
        && terrainHeight(plan, x + width, z) === ownHeight
        && terrainHeight(plan, x + width, z + direction) === neighborHeight
        && terrainSurface(plan, x + width, z) === surface) width += 1;
      const x0 = cellWorldX(x);
      const x1 = cellWorldX(x + width);
      const edgeZ = cellWorldZ(direction < 0 ? z : z + 1);
      const verticalTiles = (ownHeight - neighborHeight) / OVERWORLD_CELL_SIZE;
      if (direction < 0) {
        addQuad(batches, `${surface}:side`, [
          [x0, neighborHeight, edgeZ], [x0, ownHeight, edgeZ],
          [x1, ownHeight, edgeZ], [x1, neighborHeight, edgeZ],
        ], [[0, 0], [0, verticalTiles], [width, verticalTiles], [width, 0]]);
      } else {
        addQuad(batches, `${surface}:side`, [
          [x1, neighborHeight, edgeZ], [x1, ownHeight, edgeZ],
          [x0, ownHeight, edgeZ], [x0, neighborHeight, edgeZ],
        ], [[0, 0], [0, verticalTiles], [width, verticalTiles], [width, 0]]);
      }
      x += width;
    }
  }
}

function buildEastWestFaces(plan, range, batches, direction) {
  const endX = range.minX + range.width;
  const endZ = range.minZ + range.depth;
  for (let x = range.minX; x < endX; x += 1) {
    let z = range.minZ;
    while (z < endZ) {
      const ownHeight = terrainHeight(plan, x, z);
      const neighborHeight = terrainHeight(plan, x + direction, z);
      if (ownHeight <= neighborHeight) {
        z += 1;
        continue;
      }
      const surface = terrainSurface(plan, x, z);
      let depth = 1;
      while (z + depth < endZ
        && terrainHeight(plan, x, z + depth) === ownHeight
        && terrainHeight(plan, x + direction, z + depth) === neighborHeight
        && terrainSurface(plan, x, z + depth) === surface) depth += 1;
      const edgeX = cellWorldX(direction < 0 ? x : x + 1);
      const z0 = cellWorldZ(z);
      const z1 = cellWorldZ(z + depth);
      const verticalTiles = (ownHeight - neighborHeight) / OVERWORLD_CELL_SIZE;
      if (direction > 0) {
        addQuad(batches, `${surface}:side`, [
          [edgeX, neighborHeight, z0], [edgeX, ownHeight, z0],
          [edgeX, ownHeight, z1], [edgeX, neighborHeight, z1],
        ], [[0, 0], [0, verticalTiles], [depth, verticalTiles], [depth, 0]]);
      } else {
        addQuad(batches, `${surface}:side`, [
          [edgeX, neighborHeight, z1], [edgeX, ownHeight, z1],
          [edgeX, ownHeight, z0], [edgeX, neighborHeight, z0],
        ], [[0, 0], [0, verticalTiles], [depth, verticalTiles], [depth, 0]]);
      }
      z += depth;
    }
  }
}

function finalizeGeometry(batches, range) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const uvs = [];
  const indices = [];
  const materialKeys = [];
  let vertexOffset = 0;
  let indexOffset = 0;
  let quadCount = 0;

  for (const materialKey of TERRAIN_MATERIAL_KEYS) {
    const batch = batches.get(materialKey);
    if (!batch?.quadCount) continue;
    positions.push(...batch.positions);
    uvs.push(...batch.uvs);
    indices.push(...batch.indices.map((index) => index + vertexOffset));
    geometry.addGroup(indexOffset, batch.indices.length, TERRAIN_MATERIAL_KEYS.indexOf(materialKey));
    vertexOffset += batch.positions.length / 3;
    indexOffset += batch.indices.length;
    quadCount += batch.quadCount;
    materialKeys.push(materialKey);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.greedyMeshed = true;
  geometry.userData.greedyQuadCount = quadCount;
  geometry.userData.sourceCellCount = range.width * range.depth;
  geometry.userData.materialKeys = materialKeys;
  geometry.userData.uvWorldRepeatMetres = OVERWORLD_CELL_SIZE;
  return geometry;
}

export function buildTerrainRangeGeometry(plan, range) {
  const visualWidth = plan?.visualTerrain?.width ?? OVERWORLD_VISUAL_CELLS;
  const visualDepth = plan?.visualTerrain?.depth ?? OVERWORLD_VISUAL_CELLS;
  const normalized = {
    minX: Math.max(0, Math.trunc(range?.minX ?? 0)),
    minZ: Math.max(0, Math.trunc(range?.minZ ?? 0)),
    width: Math.max(0, Math.trunc(range?.width ?? 0)),
    depth: Math.max(0, Math.trunc(range?.depth ?? 0)),
  };
  normalized.width = Math.min(normalized.width, visualWidth - normalized.minX);
  normalized.depth = Math.min(normalized.depth, visualDepth - normalized.minZ);
  if (!plan?.visualTerrain || normalized.width <= 0 || normalized.depth <= 0) {
    throw new Error('A non-empty visual terrain range is required');
  }
  const batches = new Map();
  buildTopFaces(plan, normalized, batches);
  buildNorthSouthFaces(plan, normalized, batches, -1);
  buildNorthSouthFaces(plan, normalized, batches, 1);
  buildEastWestFaces(plan, normalized, batches, -1);
  buildEastWestFaces(plan, normalized, batches, 1);
  return finalizeGeometry(batches, normalized);
}

export function buildTerrainChunkGeometry(plan, chunkX, chunkZ) {
  const descriptor = plan?.chunkMetadata?.coreChunks?.find((chunk) => (
    chunk.chunkX === chunkX && chunk.chunkZ === chunkZ
  ));
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ) || !descriptor) {
    const columns = plan?.chunkMetadata?.coreGrid?.columns ?? 0;
    const rows = plan?.chunkMetadata?.coreGrid?.rows ?? 0;
    throw new RangeError(`Overworld core chunk coordinates must be in the ${columns}x${rows} range`);
  }
  return buildTerrainRangeGeometry(plan, descriptor.range);
}

function horizonEdgeSample(plan, edge, coordinate) {
  const terrain = plan.visualTerrain;
  const horizontal = edge === 'north' || edge === 'south';
  const length = horizontal ? terrain.width : terrain.depth;
  const clamped = Math.max(0, Math.min(length - 1, coordinate));
  let x = horizontal ? clamped : (edge === 'west' ? 0 : terrain.width - 1);
  let z = horizontal ? (edge === 'north' ? 0 : terrain.depth - 1) : clamped;
  x = Math.trunc(x);
  z = Math.trunc(z);
  const index = z * terrain.width + x;
  const heightLevel = terrain.heightLevels[index];
  return {
    coordinate,
    sourceCoordinate: clamped,
    heightLevel,
    height: heightLevel * OVERWORLD_LEVEL_HEIGHT,
    surfaceId: terrain.surfaceIds[index],
  };
}

function buildHorizonEdgeProfile(plan, edge, startCell, endCell) {
  const profile = [];
  for (let coordinate = startCell; coordinate < endCell; coordinate += 1) {
    profile.push(horizonEdgeSample(plan, edge, coordinate));
  }
  return profile;
}

function compressHorizonProfile(profile, edge) {
  const runs = [];
  for (let index = 0; index < profile.length;) {
    const first = profile[index];
    let end = index + 1;
    while (end < profile.length
      && profile[end].heightLevel === first.heightLevel
      && profile[end].surfaceId === first.surfaceId) end += 1;
    runs.push(Object.freeze({
      edge,
      startCell: first.coordinate,
      cellCount: end - index,
      heightLevel: first.heightLevel,
      height: first.height,
      surfaceId: first.surfaceId,
    }));
    index = end;
  }
  return Object.freeze(runs);
}

/**
 * Returns serializable coverage diagnostics for the visual-only horizon. The
 * source-edge runs make it possible to prove that the generated continuation
 * uses the authored plan's edge height and material rather than a generic
 * fallback plane.
 */
export function createTerrainHorizonMetadata(plan) {
  if (!plan?.visualTerrain || !plan?.terrain) {
    throw new TypeError('An OverworldPlan with visual and playable terrain is required');
  }
  const terrain = plan.visualTerrain;
  const cellSize = terrain.cellSize ?? OVERWORLD_CELL_SIZE;
  const extensionCells = Math.ceil(OVERWORLD_HORIZON_EXTENSION_METRES / cellSize);
  const extensionMetres = extensionCells * cellSize;
  const innerBounds = Object.freeze({
    minX: terrain.originX,
    maxX: terrain.originX + terrain.width * cellSize,
    minZ: terrain.originZ,
    maxZ: terrain.originZ + terrain.depth * cellSize,
  });
  const outerBounds = Object.freeze({
    minX: innerBounds.minX - extensionMetres,
    maxX: innerBounds.maxX + extensionMetres,
    minZ: innerBounds.minZ - extensionMetres,
    maxZ: innerBounds.maxZ + extensionMetres,
  });
  const playableBounds = {
    minX: plan.terrain.originX,
    maxX: plan.terrain.originX + plan.terrain.width * cellSize,
    minZ: plan.terrain.originZ,
    maxZ: plan.terrain.originZ + plan.terrain.depth * cellSize,
  };
  const minimumOuterEdgeClearanceFromPlayableCore = Math.min(
    playableBounds.minX - outerBounds.minX,
    outerBounds.maxX - playableBounds.maxX,
    playableBounds.minZ - outerBounds.minZ,
    outerBounds.maxZ - playableBounds.maxZ,
  );
  const edgeRuns = Object.freeze(Object.fromEntries(
    ['north', 'south', 'west', 'east'].map((edge) => {
      const length = edge === 'north' || edge === 'south' ? terrain.width : terrain.depth;
      return [edge, compressHorizonProfile(buildHorizonEdgeProfile(plan, edge, 0, length), edge)];
    }),
  ));
  const outerWidthCells = terrain.width + extensionCells * 2;
  const outerDepthCells = terrain.depth + extensionCells * 2;
  return Object.freeze({
    ...OVERWORLD_HORIZON_CONTRACT,
    extensionCells,
    extensionMetres,
    innerBounds,
    outerBounds,
    minimumOuterEdgeClearanceFromPlayableCore,
    representedCellCount: outerWidthCells * outerDepthCells - terrain.width * terrain.depth,
    edgeRuns,
  });
}

function addHorizonTopRuns(batches, plan, edge, profile, stripBounds) {
  const terrain = plan.visualTerrain;
  const horizontal = edge === 'north' || edge === 'south';
  for (let index = 0; index < profile.length;) {
    const first = profile[index];
    let end = index + 1;
    while (end < profile.length
      && profile[end].heightLevel === first.heightLevel
      && profile[end].surfaceId === first.surfaceId) end += 1;
    let x0 = stripBounds.minX;
    let x1 = stripBounds.maxX;
    let z0 = stripBounds.minZ;
    let z1 = stripBounds.maxZ;
    if (horizontal) {
      x0 = terrain.originX + first.coordinate * OVERWORLD_CELL_SIZE;
      x1 = x0 + (end - index) * OVERWORLD_CELL_SIZE;
    } else {
      z0 = terrain.originZ + first.coordinate * OVERWORLD_CELL_SIZE;
      z1 = z0 + (end - index) * OVERWORLD_CELL_SIZE;
    }
    addQuad(batches, `${first.surfaceId}:top`, [
      [x0, first.height, z0], [x0, first.height, z1],
      [x1, first.height, z1], [x1, first.height, z0],
    ], [
      [0, 0],
      [0, (z1 - z0) / OVERWORLD_CELL_SIZE],
      [(x1 - x0) / OVERWORLD_CELL_SIZE, (z1 - z0) / OVERWORLD_CELL_SIZE],
      [(x1 - x0) / OVERWORLD_CELL_SIZE, 0],
    ]);
    index = end;
  }
}

function addHorizonProfileCliffs(batches, plan, edge, profile, stripBounds) {
  const horizontal = edge === 'north' || edge === 'south';
  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1];
    const current = profile[index];
    if (previous.height === current.height) continue;
    const higher = previous.height > current.height ? previous : current;
    const lowerHeight = Math.min(previous.height, current.height);
    const verticalRepeats = (higher.height - lowerHeight) / OVERWORLD_CELL_SIZE;
    if (horizontal) {
      const x = plan.visualTerrain.originX + current.coordinate * OVERWORLD_CELL_SIZE;
      const depthRepeats = (stripBounds.maxZ - stripBounds.minZ) / OVERWORLD_CELL_SIZE;
      const vertices = previous.height > current.height
        ? [
          [x, lowerHeight, stripBounds.minZ], [x, higher.height, stripBounds.minZ],
          [x, higher.height, stripBounds.maxZ], [x, lowerHeight, stripBounds.maxZ],
        ]
        : [
          [x, lowerHeight, stripBounds.maxZ], [x, higher.height, stripBounds.maxZ],
          [x, higher.height, stripBounds.minZ], [x, lowerHeight, stripBounds.minZ],
        ];
      addQuad(batches, `${higher.surfaceId}:side`, vertices, [
        [0, 0], [0, verticalRepeats], [depthRepeats, verticalRepeats], [depthRepeats, 0],
      ]);
      continue;
    }
    const z = plan.visualTerrain.originZ + current.coordinate * OVERWORLD_CELL_SIZE;
    const widthRepeats = (stripBounds.maxX - stripBounds.minX) / OVERWORLD_CELL_SIZE;
    const vertices = previous.height > current.height
      ? [
        [stripBounds.maxX, lowerHeight, z], [stripBounds.maxX, higher.height, z],
        [stripBounds.minX, higher.height, z], [stripBounds.minX, lowerHeight, z],
      ]
      : [
        [stripBounds.minX, lowerHeight, z], [stripBounds.minX, higher.height, z],
        [stripBounds.maxX, higher.height, z], [stripBounds.maxX, lowerHeight, z],
      ];
    addQuad(batches, `${higher.surfaceId}:side`, vertices, [
      [0, 0], [0, verticalRepeats], [widthRepeats, verticalRepeats], [widthRepeats, 0],
    ]);
  }
}

/**
 * Builds one non-colliding, material-batched ring around the 192m authored
 * terrain. Each edge profile is extended straight out from its corresponding
 * OverworldPlan edge; corner cells inherit the nearest authored corner.
 */
export function buildTerrainHorizonGeometry(plan) {
  const metadata = createTerrainHorizonMetadata(plan);
  const terrain = plan.visualTerrain;
  const extensionCells = metadata.extensionCells;
  const inner = metadata.innerBounds;
  const outer = metadata.outerBounds;
  const strips = [
    {
      edge: 'north',
      profile: buildHorizonEdgeProfile(plan, 'north', -extensionCells, terrain.width + extensionCells),
      bounds: { minX: outer.minX, maxX: outer.maxX, minZ: outer.minZ, maxZ: inner.minZ },
    },
    {
      edge: 'south',
      profile: buildHorizonEdgeProfile(plan, 'south', -extensionCells, terrain.width + extensionCells),
      bounds: { minX: outer.minX, maxX: outer.maxX, minZ: inner.maxZ, maxZ: outer.maxZ },
    },
    {
      edge: 'west',
      profile: buildHorizonEdgeProfile(plan, 'west', 0, terrain.depth),
      bounds: { minX: outer.minX, maxX: inner.minX, minZ: inner.minZ, maxZ: inner.maxZ },
    },
    {
      edge: 'east',
      profile: buildHorizonEdgeProfile(plan, 'east', 0, terrain.depth),
      bounds: { minX: inner.maxX, maxX: outer.maxX, minZ: inner.minZ, maxZ: inner.maxZ },
    },
  ];
  const batches = new Map();
  for (const strip of strips) {
    addHorizonTopRuns(batches, plan, strip.edge, strip.profile, strip.bounds);
    addHorizonProfileCliffs(batches, plan, strip.edge, strip.profile, strip.bounds);
  }
  const geometry = finalizeGeometry(batches, { width: metadata.representedCellCount, depth: 1 });
  geometry.userData.overworldVisualHorizon = true;
  geometry.userData.nonPlayable = true;
  geometry.userData.collidable = false;
  geometry.userData.horizon = metadata;
  return geometry;
}

function configureTexture(texture, renderer) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.NearestFilter;
  const maximum = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
  texture.anisotropy = Math.max(1, Math.min(16, maximum));
  return texture;
}

function createMaterialLibrary({ manifest, surfaceMaterials, textureLoader = null, renderer = null } = {}) {
  const materialByKey = new Map();
  const voxelPropMaterialByKey = new Map();
  const textureByPath = new Map();
  const loadTexture = (path) => {
    if (!textureLoader) return null;
    if (!textureByPath.has(path)) textureByPath.set(path, configureTexture(textureLoader.load(path), renderer));
    return textureByPath.get(path);
  };
  for (const [materialId, descriptor] of Object.entries(surfaceMaterials)) {
    const faceSet = manifest.families[descriptor.voxelFaceSetId];
    for (const face of ['top', 'side', 'bottom']) {
      const map = loadTexture(faceSet[face]);
      materialByKey.set(`${materialId}:${face}`, new THREE.MeshStandardMaterial({
        name: `overworldVoxelMaterial:${materialId}:${face}`,
        color: map ? 0xffffff : descriptor.fallbackColors[face],
        map,
        roughness: descriptor.roughness,
        metalness: descriptor.metalness,
      }));
      const propMaterial = materialByKey.get(`${materialId}:${face}`).clone();
      propMaterial.name = `overworldVoxelPropMaterial:${materialId}:${face}`;
      configureVoxelPropWorldUv(propMaterial, { familyId: materialId, faceRole: face });
      voxelPropMaterialByKey.set(`${materialId}:${face}`, propMaterial);
    }
  }
  const facadeMaterials = {
    door: new THREE.MeshStandardMaterial({
      name: 'overworldVoxelMaterial:woodenDoor',
      color: 0x795432,
      map: loadTexture(manifest.facades.woodenDoor),
      roughness: 0.78,
    }),
    window: new THREE.MeshStandardMaterial({
      name: 'overworldVoxelMaterial:mullionedWindow',
      color: 0xa8dbe6,
      emissive: 0x183a46,
      emissiveIntensity: 0.18,
      map: loadTexture(manifest.facades.mullionedWindow),
      roughness: 0.42,
    }),
  };
  return {
    materialByKey,
    voxelPropMaterialByKey,
    textureByPath,
    loadTexture,
    facadeMaterials,
    terrainMaterials: TERRAIN_MATERIAL_KEYS.map((key) => materialByKey.get(key)),
    threeFace(familyId) {
      return ['side', 'top', 'bottom'].map((faceRole) => (
        voxelPropMaterialByKey.get(`${familyId}:${faceRole}`)
      ));
    },
    sixFace(materialId) {
      const descriptor = surfaceMaterials[materialId];
      const paths = toSixFaceTexturePaths(manifest.families[descriptor.voxelFaceSetId]);
      return ['side', 'side', 'top', 'bottom', 'side', 'side'].map((face, index) => {
        const path = paths[index];
        const key = `${materialId}:${face}`;
        const material = voxelPropMaterialByKey.get(key);
        if (material?.map?.source?.data || !path) return material;
        return material;
      });
    },
  };
}

function configureMesh(mesh, { castShadow = false, receiveShadow = true } = {}) {
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

/**
 * Builds the shared unit cube used by instanced voxel props. BoxGeometry emits
 * one material group per face, which doubles the forest draw calls even though
 * all four vertical faces intentionally share one seamless side texture. Keep
 * the faces independently indexed so their outward normals and UV seams remain
 * correct, but batch them into the three authored face roles.
 */
export function buildVoxelBoxGeometry() {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const addFace = (vertices, normal) => {
    const offset = positions.length / 3;
    for (const [x, y, z] of vertices) {
      positions.push(x, y, z);
      normals.push(normal[0], normal[1], normal[2]);
    }
    // Preserve BoxGeometry's one-repeat 0..1 UV island per authored face. The
    // separate face seams keep RepeatWrapping usable without an atlas bleed.
    uvs.push(0, 0, 0, 1, 1, 1, 1, 0);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };

  // Four cardinal faces share material group zero.
  addFace([
    [0.5, -0.5, -0.5], [0.5, 0.5, -0.5],
    [0.5, 0.5, 0.5], [0.5, -0.5, 0.5],
  ], [1, 0, 0]);
  addFace([
    [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5],
    [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5],
  ], [-1, 0, 0]);
  addFace([
    [0.5, -0.5, 0.5], [0.5, 0.5, 0.5],
    [-0.5, 0.5, 0.5], [-0.5, -0.5, 0.5],
  ], [0, 0, 1]);
  addFace([
    [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5],
    [0.5, 0.5, -0.5], [0.5, -0.5, -0.5],
  ], [0, 0, -1]);
  geometry.addGroup(0, 24, 0);

  const topIndexOffset = indices.length;
  addFace([
    [-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5], [0.5, 0.5, -0.5],
  ], [0, 1, 0]);
  geometry.addGroup(topIndexOffset, 6, 1);

  const bottomIndexOffset = indices.length;
  addFace([
    [-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5],
    [0.5, -0.5, -0.5], [0.5, -0.5, 0.5],
  ], [0, -1, 0]);
  geometry.addGroup(bottomIndexOffset, 6, 2);

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.voxelFaceGroups = Object.freeze(['side', 'top', 'bottom']);
  geometry.userData.uvFaceRepeat = 1;
  geometry.userData.uvDensityMode = VOXEL_PROP_UV_CONTRACT.projection;
  geometry.userData.uvWorldRepeatMetres = VOXEL_PROP_UV_CONTRACT.repeatWorldMetres;
  return geometry;
}

export function createOverworldSharedGeometryLibrary() {
  const unitVoxelBox = buildVoxelBoxGeometry();
  unitVoxelBox.name = 'overworldSharedUnitVoxelBoxGeometry';
  unitVoxelBox.userData.sharedGeometryContract = OVERWORLD_BUILDING_GEOMETRY_CONTRACT;
  return Object.freeze({
    contract: OVERWORLD_BUILDING_GEOMETRY_CONTRACT,
    unitVoxelBox,
  });
}

function addTerrain(root, plan, library) {
  const terrainRoot = new THREE.Group();
  terrainRoot.name = 'overworldVoxelTerrain';
  const renderCullGroups = [];
  let drawCallUpperBound = 0;
  for (const descriptor of plan.chunkMetadata.coreChunks) {
    const geometry = buildTerrainRangeGeometry(plan, descriptor.range);
    const mesh = configureMesh(new THREE.Mesh(geometry, library.terrainMaterials));
    mesh.name = descriptor.id;
    mesh.userData.overworldTerrainChunk = true;
    mesh.userData.greedyMeshed = true;
    mesh.userData.sourceCellCount = descriptor.sourceCellCount;
    mesh.userData.chunkX = descriptor.chunkX;
    mesh.userData.chunkZ = descriptor.chunkZ;
    mesh.userData.planChunkId = descriptor.id;
    mesh.userData.cullCenter = { ...descriptor.cullCenter };
    mesh.userData.cullRadius = descriptor.cullRadius;
    mesh.userData.cullBounds = { ...descriptor.worldBounds };
    terrainRoot.add(mesh);
    renderCullGroups.push(mesh);
    drawCallUpperBound = Math.max(drawCallUpperBound, geometry.groups.length);
  }

  for (const descriptor of plan.chunkMetadata.apronChunks) {
    const mesh = configureMesh(
      new THREE.Mesh(buildTerrainRangeGeometry(plan, descriptor.range), library.terrainMaterials),
    );
    mesh.name = descriptor.id;
    mesh.userData.overworldVisualApron = true;
    mesh.userData.nonPlayable = true;
    mesh.userData.greedyMeshed = true;
    mesh.userData.planChunkId = descriptor.id;
    mesh.userData.sourceCellCount = descriptor.sourceCellCount;
    mesh.userData.cullCenter = { ...descriptor.cullCenter };
    mesh.userData.cullRadius = descriptor.cullRadius;
    mesh.userData.cullBounds = { ...descriptor.worldBounds };
    terrainRoot.add(mesh);
    renderCullGroups.push(mesh);
  }
  const horizonGeometry = buildTerrainHorizonGeometry(plan);
  const horizonMesh = configureMesh(
    new THREE.Mesh(horizonGeometry, library.terrainMaterials),
    { castShadow: false, receiveShadow: false },
  );
  horizonMesh.name = 'overworldVisualHorizon';
  horizonMesh.userData.overworldVisualHorizon = true;
  horizonMesh.userData.nonPlayable = true;
  horizonMesh.userData.collidable = false;
  horizonMesh.userData.greedyMeshed = true;
  horizonMesh.userData.horizon = horizonGeometry.userData.horizon;
  terrainRoot.add(horizonMesh);
  drawCallUpperBound = Math.max(drawCallUpperBound, horizonGeometry.groups.length);
  root.add(terrainRoot);
  return {
    terrainRoot,
    horizonMesh,
    horizon: horizonGeometry.userData.horizon,
    renderCullGroups,
    terrainChunkCount: plan.chunkMetadata.coreGrid.expectedChunkCount,
    visualTerrainMeshCount: plan.chunkMetadata.expectedTerrainMeshCount,
    drawCallUpperBound,
  };
}

function chunkCoordinate(value, plan, axis) {
  const metadata = plan.chunkMetadata;
  const origin = axis === 'x' ? plan.terrain.originX : plan.terrain.originZ;
  const count = axis === 'x'
    ? metadata.vegetation.cullGridColumns
    : metadata.vegetation.cullGridRows;
  return Math.max(
    0,
    Math.min(count - 1, Math.floor((value - origin) / metadata.vegetation.cullChunkWorldSize)),
  );
}

function addTrees(root, plan, library, occlusionOwners, renderCullGroups, sharedGeometries) {
  const treesRoot = new THREE.Group();
  treesRoot.name = 'overworldForest';
  const treeBatches = new Map();
  for (const tree of plan.trees) {
    const chunkX = chunkCoordinate(tree.x, plan, 'x');
    const chunkZ = chunkCoordinate(tree.z, plan, 'z');
    const key = `${chunkX},${chunkZ}`;
    const batch = treeBatches.get(key) ?? { chunkX, chunkZ, trees: [] };
    batch.trees.push(tree);
    treeBatches.set(key, batch);
  }
  const unitBox = sharedGeometries.unitVoxelBox;
  const treeMaterialCache = new Map();
  const treeMaterials = (familyId) => {
    if (treeMaterialCache.has(familyId)) return treeMaterialCache.get(familyId);
    const materials = ['side', 'top', 'bottom'].map((faceRole) => {
      const source = library.voxelPropMaterialByKey.get(`${familyId}:${faceRole}`);
      const material = new THREE.MeshLambertMaterial({
        name: `overworldVoxelTreeMaterial:${familyId}:${faceRole}`,
        color: source?.color?.clone?.() ?? new THREE.Color(0xffffff),
        map: source?.map ?? null,
        fog: true,
      });
      configureVoxelPropWorldUv(material, { familyId, faceRole });
      return material;
    });
    treeMaterialCache.set(familyId, materials);
    return materials;
  };
  const dummy = new THREE.Object3D();
  for (const [key, batch] of treeBatches) {
    const { chunkX, chunkZ, trees } = batch;
    const group = new THREE.Group();
    group.name = `overworldTreeChunk-${key}`;
    const trunks = new THREE.InstancedMesh(unitBox, treeMaterials('bark'), trees.length);
    trunks.name = `overworldTreeTrunks-${key}`;
    trunks.userData.instanceOwnerIds = trees.map(({ id }) => id);
    // Trunks share one draw-efficient instance batch, but still participate in
    // camera-to-player occlusion. The runtime treats this mesh as its own
    // owner, so a trunk can no longer sit opaque against the follow camera.
    trunks.userData.cameraOcclusionSurface = true;
    trunks.userData.occlusionOwnerId = `forest-trunks-${key}`;
    // Hundreds of instanced trees remain lit and receive shadows, but do not
    // redraw all six forest batches into the moving sun map every frame. The
    // authored houses, ruin mound, camp props and player retain cast shadows.
    trunks.castShadow = false;
    trunks.receiveShadow = false;
    trees.forEach((tree, index) => {
      dummy.position.set(tree.x, tree.y + tree.trunkHeight * 0.5, tree.z);
      dummy.scale.set(tree.trunkWidth, tree.trunkHeight, tree.trunkWidth);
      dummy.rotation.set(0, tree.variant * Math.PI * 0.5, 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(index, dummy.matrix);
    });
    trunks.instanceMatrix.needsUpdate = true;
    trunks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    group.add(trunks);

    // Occlusion ownership is intentionally finer than render culling. Trunks
    // stay in one draw-efficient chunk, while canopy instances are split into
    // two spatial halves. A ray through one tree therefore hides only the
    // local half-chunk owner, never every canopy in a 24m culling chunk.
    const partitionAxis = (chunkX + chunkZ) % 2 === 0 ? 'x' : 'z';
    const chunkOrigin = partitionAxis === 'x'
      ? plan.terrain.originX + chunkX * plan.chunkMetadata.vegetation.cullChunkWorldSize
      : plan.terrain.originZ + chunkZ * plan.chunkMetadata.vegetation.cullChunkWorldSize;
    const split = chunkOrigin + plan.chunkMetadata.vegetation.cullChunkWorldSize * 0.5;
    const partitions = new Map();
    for (const tree of trees) {
      const partitionIndex = tree[partitionAxis] < split ? 0 : 1;
      const partition = partitions.get(partitionIndex) ?? [];
      partition.push(tree);
      partitions.set(partitionIndex, partition);
    }
    for (const [partitionIndex, partitionTrees] of partitions) {
      const canopies = new THREE.InstancedMesh(
        unitBox,
        treeMaterials('leaves'),
        partitionTrees.length * 2,
      );
      canopies.name = `overworldTreeCanopies-${key}-${partitionAxis}${partitionIndex}`;
      canopies.userData.instanceOwnerIds = partitionTrees.flatMap(({ id }) => [id, id]);
      canopies.castShadow = false;
      canopies.receiveShadow = false;
      canopies.userData.cameraOcclusionOwner = true;
      canopies.userData.occlusionOwnerId = `forest-canopy-${key}-${partitionAxis}${partitionIndex}`;
      canopies.userData.parentCullChunkId = group.name;
      canopies.userData.occlusionPartitionAxis = partitionAxis;
      canopies.userData.occlusionPartitionIndex = partitionIndex;
      canopies.userData.occlusionTreeCount = partitionTrees.length;
      let canopyIndex = 0;
      for (const tree of partitionTrees) {
        dummy.position.set(tree.x, tree.y + tree.trunkHeight + tree.canopyHeight * 0.32, tree.z);
        dummy.scale.set(tree.canopyWidth, tree.canopyHeight * 0.68, tree.canopyWidth * 0.82);
        dummy.rotation.set(0, tree.variant * Math.PI * 0.5, 0);
        dummy.updateMatrix();
        canopies.setMatrixAt(canopyIndex, dummy.matrix);
        canopyIndex += 1;
        dummy.position.set(tree.x, tree.y + tree.trunkHeight + tree.canopyHeight * 0.75, tree.z);
        dummy.scale.set(tree.canopyWidth * 0.68, tree.canopyHeight * 0.52, tree.canopyWidth * 0.68);
        dummy.rotation.set(0, (tree.variant + 0.5) * Math.PI * 0.5, 0);
        dummy.updateMatrix();
        canopies.setMatrixAt(canopyIndex, dummy.matrix);
        canopyIndex += 1;
      }
      canopies.instanceMatrix.needsUpdate = true;
      canopies.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      const bounds = {
        minX: Math.min(...partitionTrees.map((tree) => tree.x - tree.canopyWidth * 0.5)),
        maxX: Math.max(...partitionTrees.map((tree) => tree.x + tree.canopyWidth * 0.5)),
        minY: Math.min(...partitionTrees.map((tree) => tree.y + tree.trunkHeight - tree.canopyHeight * 0.02)),
        maxY: Math.max(...partitionTrees.map((tree) => tree.y + tree.trunkHeight + tree.canopyHeight * 1.01)),
        minZ: Math.min(...partitionTrees.map((tree) => tree.z - tree.canopyWidth * 0.5)),
        maxZ: Math.max(...partitionTrees.map((tree) => tree.z + tree.canopyWidth * 0.5)),
      };
      canopies.userData.occlusionOwnerBounds = bounds;
      canopies.userData.occlusionOwnerShortSpanMetres = partitionAxis === 'x'
        ? bounds.maxX - bounds.minX
        : bounds.maxZ - bounds.minZ;
      group.add(canopies);
      occlusionOwners.push(canopies);
    }
    const minX = Math.min(...trees.map((tree) => tree.x - tree.canopyWidth * 0.5));
    const maxX = Math.max(...trees.map((tree) => tree.x + tree.canopyWidth * 0.5));
    const minZ = Math.min(...trees.map((tree) => tree.z - tree.canopyWidth * 0.5));
    const maxZ = Math.max(...trees.map((tree) => tree.z + tree.canopyWidth * 0.5));
    const centerX = (minX + maxX) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    group.userData.overworldTreeChunk = true;
    group.userData.treeCount = trees.length;
    group.userData.cullCenter = { x: centerX, z: centerZ };
    group.userData.cullRadius = Math.hypot(maxX - centerX, maxZ - centerZ);
    treesRoot.add(group);
    renderCullGroups.push(group);
  }
  root.add(treesRoot);
  return treesRoot;
}

function createHouse(planHouse, library, sharedGeometries) {
  const group = new THREE.Group();
  group.name = planHouse.id;
  group.position.set(planHouse.x, planHouse.level * OVERWORLD_LEVEL_HEIGHT, planHouse.z);
  group.rotation.y = planHouse.yawQuarterTurns * Math.PI * 0.5;
  group.userData.cameraOcclusionOwner = true;
  group.userData.occlusionOwnerId = planHouse.id;
  group.userData.houseTopology = planHouse.topology;
  group.userData.houseDistrict = planHouse.district;

  const bodyParts = [
    { x: 0, z: 0, width: planHouse.width, depth: planHouse.depth, height: planHouse.wallHeight },
    ...planHouse.extensions.filter(({ kind }) => !['porch', 'overlook', 'chimney', 'dormer'].includes(kind)),
  ];
  const unitBox = sharedGeometries.unitVoxelBox;
  const bodies = new THREE.InstancedMesh(unitBox, library.threeFace('houseWall'), bodyParts.length);
  bodies.name = `${planHouse.id}-instancedWalls`;
  const dummy = new THREE.Object3D();
  bodyParts.forEach((part, index) => {
    dummy.position.set(part.x ?? 0, (part.height ?? planHouse.wallHeight) * 0.5, part.z ?? 0);
    dummy.scale.set(part.width, part.height ?? planHouse.wallHeight, part.depth);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    bodies.setMatrixAt(index, dummy.matrix);
  });
  bodies.instanceMatrix.needsUpdate = true;
  bodies.castShadow = true;
  bodies.receiveShadow = true;

  const roofs = new THREE.InstancedMesh(unitBox, library.threeFace('roof'), planHouse.roofTiers);
  roofs.name = `${planHouse.id}-instancedRoof`;
  for (let tier = 0; tier < planHouse.roofTiers; tier += 1) {
    const inset = tier * 0.65;
    dummy.position.set(0, planHouse.wallHeight + 0.28 + tier * 0.52, 0);
    dummy.scale.set(
      Math.max(2, planHouse.width + 1 - inset * 2),
      0.55,
      Math.max(2, planHouse.depth + 1 - inset * 1.4),
    );
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    roofs.setMatrixAt(tier, dummy.matrix);
  }
  roofs.instanceMatrix.needsUpdate = true;
  roofs.castShadow = true;
  roofs.receiveShadow = true;

  const door = new THREE.Mesh(unitBox, library.facadeMaterials.door);
  door.name = `${planHouse.id}-closedDoor`;
  door.position.set(0, 1.25, planHouse.depth * 0.5 + 0.07);
  door.scale.set(1.3, 2.5, 0.12);
  door.castShadow = true;
  const windows = new THREE.InstancedMesh(
    unitBox,
    library.facadeMaterials.window,
    2,
  );
  windows.name = `${planHouse.id}-instancedWindows`;
  for (let index = 0; index < 2; index += 1) {
    dummy.position.set((index === 0 ? -1 : 1) * planHouse.width * 0.28, 2.25, planHouse.depth * 0.5 + 0.06);
    dummy.scale.set(1.05, 1.15, 0.1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    windows.setMatrixAt(index, dummy.matrix);
  }
  windows.instanceMatrix.needsUpdate = true;

  const platforms = planHouse.extensions.filter(({ kind }) => ['porch', 'overlook'].includes(kind));
  for (const platform of platforms) {
    const mesh = new THREE.Mesh(
      unitBox,
      library.threeFace('houseWall'),
    );
    mesh.name = `${planHouse.id}-${platform.kind}`;
    // Exterior decks are a visual threshold rather than a separate step.
    // Sink their volume into the authored ground so the visible top remains
    // flush and cannot catch the player's legs without a matching surface.
    mesh.position.set(platform.x, -platform.height * 0.5 + 0.04, platform.z);
    mesh.scale.set(platform.width, platform.height, platform.depth);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const dormer = planHouse.extensions.find(({ kind }) => kind === 'dormer');
  if (dormer) {
    const mesh = new THREE.Mesh(
      unitBox,
      library.threeFace('houseWall'),
    );
    mesh.name = `${planHouse.id}-dormer`;
    mesh.position.set(dormer.x, planHouse.wallHeight + dormer.height * 0.5, dormer.z);
    mesh.scale.set(dormer.width, dormer.height, dormer.depth);
    mesh.castShadow = true;
    group.add(mesh);
  }
  const chimney = planHouse.extensions.find(({ kind }) => kind === 'chimney');
  if (chimney) {
    const mesh = new THREE.Mesh(
      unitBox,
      library.threeFace('stone'),
    );
    mesh.name = `${planHouse.id}-chimney`;
    mesh.position.set(chimney.x, chimney.height * 0.5, chimney.z);
    mesh.scale.set(chimney.width, chimney.height, chimney.depth);
    mesh.castShadow = true;
    group.add(mesh);
  }
  group.add(bodies, roofs, door, windows);
  return group;
}

function addHouses(root, plan, library, occlusionOwners, sharedGeometries) {
  const housesRoot = new THREE.Group();
  housesRoot.name = 'overworldHouses';
  for (const house of plan.houses) {
    const object = createHouse(house, library, sharedGeometries);
    housesRoot.add(object);
    occlusionOwners.push(object);
  }
  root.add(housesRoot);
  return housesRoot;
}

function addCamp(root, plan, library, occlusionOwners) {
  const campRoot = new THREE.Group();
  campRoot.name = 'overworldExpeditionCamp';

  const mound = new THREE.Group();
  mound.name = 'overworldRuinMound';
  const stoneFaces = library.sixFace('stone');
  for (const definition of [
    { x: -4.3, y: 2.5, z: -9, w: 3.2, h: 5, d: 3.4 },
    { x: 4.3, y: 2.5, z: -9, w: 3.2, h: 5, d: 3.4 },
    { x: 0, y: 6.1, z: -9, w: 6.2, h: 2.1, d: 3.4 },
  ]) {
    const stone = new THREE.Mesh(new THREE.BoxGeometry(definition.w, definition.h, definition.d), stoneFaces);
    stone.position.set(definition.x, definition.y, definition.z);
    stone.castShadow = true;
    stone.receiveShadow = true;
    mound.add(stone);
  }
  mound.userData.cameraOcclusionOwner = true;
  mound.userData.occlusionOwnerId = 'overworldRuinMound';
  occlusionOwners.push(mound);

  const doorGroup = new THREE.Group();
  doorGroup.name = 'overworldDungeonDoor';
  doorGroup.position.set(0, 0, -8.45);
  doorGroup.userData.closed = true;
  doorGroup.userData.stableInteractionId = 'overworldDungeonDoor';
  doorGroup.userData.cameraOcclusionOwner = true;
  doorGroup.userData.occlusionOwnerId = 'overworldDungeonDoor';
  occlusionOwners.push(doorGroup);
  const doorFrameMaterial = new THREE.MeshStandardMaterial({
    name: 'overworldLegacyRuinDoorFrame',
    color: 0xd8e0df,
    map: library.loadTexture('/assets/textures/ruins/door_frame.png'),
    emissive: 0x07191d,
    emissiveIntensity: 0.16,
    roughness: 0.54,
    metalness: 0.34,
  });
  const doorMaterial = new THREE.MeshStandardMaterial({
    name: 'overworldLegacyRuinDoorSealed',
    color: 0xd8e0df,
    map: library.loadTexture('/assets/textures/ruins/door_sealed.png'),
    emissive: 0x0a1518,
    emissiveIntensity: 0.12,
    roughness: 0.52,
    metalness: 0.38,
  });
  const door = new THREE.Group();
  door.name = 'overworldDungeonDoorSlab';
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.62, 6.32, 0.42), doorMaterial);
    panel.name = side < 0 ? 'overworldDungeonDoorPanelLeft' : 'overworldDungeonDoorPanelRight';
    panel.position.set(side * 1.34, 3.2, 0);
    panel.castShadow = true;
    panel.receiveShadow = true;
    for (const y of [-1.75, -0.58, 0.58, 1.75]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.12, 0.48), doorFrameMaterial);
      rib.name = 'overworldDungeonDoorReinforcementRib';
      rib.position.set(0, y, 0.04);
      panel.add(rib);
    }
    door.add(panel);
  }
  const seam = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 5.86, 0.5),
    new THREE.MeshStandardMaterial({
      name: 'overworldDungeonDoorSeam',
      color: 0x6bdcff,
      emissive: 0x1f91a8,
      emissiveIntensity: 0.68,
      roughness: 0.3,
      metalness: 0.26,
    }),
  );
  seam.name = 'overworldDungeonDoorCenterSeam';
  seam.position.set(0, 3.2, 0.05);
  door.add(seam);
  const header = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.45, 0.7), doorFrameMaterial);
  header.position.set(0, 6.42, 0);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.45, 6.8, 0.7), doorFrameMaterial);
  left.position.set(-2.93, 3.2, 0);
  const right = left.clone();
  right.position.x = 2.93;
  const signal = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.22, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x6bdcff, emissive: 0x1c7788, emissiveIntensity: 0.85 }),
  );
  signal.position.set(0, 5.4, 0.25);
  doorGroup.add(door, header, left, right, signal);

  const sharedAssets = createSharedCampAssets(plan);
  const { supportCar, roll, workbench } = sharedAssets;

  campRoot.add(mound, doorGroup, sharedAssets.root);
  root.add(campRoot);
  return { campRoot, doorGroup, supportCar, roll, workbench, sharedAssets };
}

function addLighting(root, plan) {
  const lighting = new THREE.Group();
  lighting.name = 'overworldLighting';
  const hemisphere = new THREE.HemisphereLight(0xcce8ef, 0x536a43, 1.15);
  hemisphere.name = 'overworldHemisphereLight';
  const sun = new THREE.DirectionalLight(0xfff0cb, 2.05);
  sun.name = 'overworldSun';
  sun.position.set(-22, 38, 18);
  sun.castShadow = true;
  const radius = plan.environment.shadowRadius;
  Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 1, far: 100 });
  // A 1024px map keeps the player-following shadow footprint inexpensive; it
  // is independent of the longer fog-safe render-culling distance.
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.00035;
  const target = new THREE.Object3D();
  target.name = 'overworldSunTarget';
  sun.target = target;
  lighting.add(hemisphere, sun, target);
  root.add(lighting);
  return { lighting, hemisphere, sun, target };
}

function vectorFromAnchor(anchor) {
  return new THREE.Vector3(anchor.x, anchor.y, anchor.z);
}

function isPersistentHostResource(resource) {
  return resource?.userData?.persistentHostOwned === true
    || resource?.userData?.hostOwnedResource === true;
}

function createDisposableRegistryEntry(kind, resource, id) {
  let disposed = false;
  return {
    kind,
    id,
    resource,
    get disposed() { return disposed; },
    dispose() {
      if (disposed) return false;
      disposed = true;
      resource?.dispose?.();
      return true;
    },
  };
}

function createWorldOwnedResourceRegistry(root, camp, library) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry && !isPersistentHostResource(object.geometry)) geometries.add(object.geometry);
    if (object.skeleton?.boneTexture?.isTexture
      && !isPersistentHostResource(object.skeleton.boneTexture)) textures.add(object.skeleton.boneTexture);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (!material || isPersistentHostResource(material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture && !isPersistentHostResource(value)) textures.add(value);
      }
    }
  });
  for (const texture of library.textureByPath.values()) {
    if (!isPersistentHostResource(texture)) textures.add(texture);
  }
  const entries = [];
  let serial = 0;
  const add = (kind, resources) => {
    for (const resource of resources) {
      serial += 1;
      entries.push(createDisposableRegistryEntry(kind, resource, `${kind}-${serial}`));
    }
  };
  add('geometry', geometries);
  add('material', materials);
  add('texture', textures);
  entries.push(createDisposableRegistryEntry(
    'owner',
    { dispose: camp.sharedAssets.disposeNpcAssets },
    'shared-camp-npc-assets',
  ));
  return {
    entries,
    counts: Object.freeze({
      geometry: geometries.size,
      material: materials.size,
      texture: textures.size,
      owner: 1,
      total: entries.length,
    }),
  };
}

function makeCompatibilityFacade(
  root,
  plan,
  camp,
  terrainAssembly,
  lighting,
  occlusionOwners,
  library,
  textureManifest,
) {
  const objectsByName = new Map();
  root.traverse((object) => {
    if (object.name) objectsByName.set(object.name, object);
  });
  const safeInteractables = plan.interactions.map((interaction) => ({
    ...interaction,
    position: new THREE.Vector3(interaction.x, interaction.y, interaction.z),
    object: objectsByName.get(interaction.ownerId) ?? null,
  }));
  const solidZones = plan.blockers.map((blocker) => ({
    id: blocker.id,
    roomId: 'overworld',
    label: blocker.ownerId,
    position: new THREE.Vector3(blocker.x, blocker.y, blocker.z),
    halfWidth: blocker.kind === 'cylinder' ? blocker.radius : blocker.halfWidth,
    halfDepth: blocker.kind === 'cylinder' ? blocker.radius : blocker.halfDepth,
    verticalHalfHeight: blocker.halfHeight,
    rotationY: blocker.rotationY ?? 0,
    collisionShape: blocker.kind,
  }));
  const tiles = new Map();
  const floorTiles = [];
  for (let z = 0; z < plan.terrain.depth; z += 1) {
    for (let x = 0; x < plan.terrain.width; x += 1) {
      const index = z * plan.terrain.width + x;
      const tile = {
        x,
        z,
        elevation: plan.terrain.heightLevels[index] * OVERWORLD_LEVEL_HEIGHT,
        level: plan.terrain.heightLevels[index],
        surface: plan.terrain.surfaceIds[index],
        roomId: 'overworld',
      };
      tiles.set(`${x},${z}`, tile);
      floorTiles.push(tile);
    }
  }
  const resourceRegistry = createWorldOwnedResourceRegistry(root, camp, library);
  const facade = {
    worldKind: 'overworld',
    dungeonKind: null,
    isOverworld: true,
    group: root,
    root,
    plan,
    planHash: plan.planHash,
    rooms: plan.regions.map((region) => ({ ...region, type: 'overworldRegion' })),
    tiles,
    floorTiles,
    tileSize: OVERWORLD_CELL_SIZE,
    platforms: [],
    doors: [{
      id: 'overworldDungeonDoor',
      label: 'Sealed Ruin Door',
      closed: true,
      locked: true,
      object: camp.doorGroup,
      position: vectorFromAnchor(plan.anchors.dungeonDoorExterior),
    }],
    encounters: [],
    keycards: [],
    chests: [],
    mechanisms: [],
    traps: [],
    conveyors: [],
    safeInteractables,
    safeZones: [{
      id: 'overworldCampSafeZone', roomId: 'camp',
      position: new THREE.Vector3(0, 1.5, 0), halfWidth: 15, halfDepth: 13, verticalHalfHeight: 4,
    }],
    solidZones,
    aerialBoundaryZones: [],
    npcAnimationMixers: camp.sharedAssets.npcAnimationMixers,
    npcAnimators: camp.sharedAssets.npcAnimators,
    playerStart: vectorFromAnchor(plan.anchors.playerStart),
    playerStartFacing: new THREE.Vector3(plan.anchors.playerStart.facingX, 0, plan.anchors.playerStart.facingZ),
    campReturnPosition: vectorFromAnchor(plan.anchors.campReturn),
    campReturnFacing: new THREE.Vector3(plan.anchors.campReturn.facingX, 0, plan.anchors.campReturn.facingZ),
    ruinEntryPosition: vectorFromAnchor(plan.anchors.dungeonDoorExterior),
    ruinEntryFacing: new THREE.Vector3(plan.anchors.dungeonDoorExterior.facingX, 0, plan.anchors.dungeonDoorExterior.facingZ),
    boundsRadius: plan.dimensions.coreSize * 0.5,
    minimap: null,
    progression: null,
    renderCullGroups: terrainAssembly.renderCullGroups,
    occlusionOwners,
    lighting: lighting.lighting,
    fog: new THREE.Fog(plan.environment.fogColor, plan.environment.fogNear, plan.environment.fogFar),
    backgroundColor: new THREE.Color(plan.environment.skyColor),
    terrainChunkCount: terrainAssembly.terrainChunkCount,
    visualTerrainMeshCount: terrainAssembly.visualTerrainMeshCount,
    visualHorizon: terrainAssembly.horizon,
    drawCallUpperBound: terrainAssembly.drawCallUpperBound,
    textureManifestId: textureManifest.id,
    disposableResources: resourceRegistry.entries,
    resourceCounts: resourceRegistry.counts,
    disposed: false,
    updateLighting(playerPosition) {
      if (!playerPosition) return;
      lighting.target.position.set(playerPosition.x, 0, playerPosition.z);
      lighting.sun.position.set(playerPosition.x - 22, 38, playerPosition.z + 18);
    },
    activateNpcAssets: camp.sharedAssets.activateNpcAssets,
    disposeNpcAssets: camp.sharedAssets.disposeNpcAssets,
  };
  facade.diagnostics = Object.freeze({
    worldKind: 'overworld',
    planHash: plan.planHash,
    activeRootId: root.uuid,
    terrainChunkCount: terrainAssembly.terrainChunkCount,
    visualTerrainMeshCount: terrainAssembly.visualTerrainMeshCount,
    horizonExtensionMetres: terrainAssembly.horizon.extensionMetres,
    horizonOuterBounds: terrainAssembly.horizon.outerBounds,
    horizonMinimumPlayableClearance: terrainAssembly.horizon.minimumOuterEdgeClearanceFromPlayableCore,
    horizonDrawCallCount: terrainAssembly.horizonMesh.geometry.groups.length,
    maximumTerrainDrawCallsPerChunk: terrainAssembly.drawCallUpperBound,
    treeCount: plan.trees.length,
    houseCount: plan.houses.length,
    textureCount: library.textureByPath.size,
    disposableResourceCount: resourceRegistry.counts.total,
    disposableResourceCounts: resourceRegistry.counts,
  });
  return facade;
}

export function assembleOverworld(plan = createAuthoredOverworldPlan(), {
  renderer = null,
  textureLoader = typeof document !== 'undefined' ? new THREE.TextureLoader() : null,
} = {}) {
  const planValidation = validateOverworldPlan(plan);
  if (!planValidation.accepted) throw new Error(`Invalid OverworldPlan: ${planValidation.errors.join(', ')}`);
  const textureManifest = plan.voxelFaceSets;
  const textureValidation = validateVoxelFaceTextureManifest(textureManifest);
  if (!textureValidation.accepted) throw new Error(`Invalid voxel texture manifest: ${textureValidation.errors.join(', ')}`);
  const root = new THREE.Group();
  root.name = 'overworldWorldRoot';
  root.userData.worldKind = 'overworld';
  root.userData.overworldPlanHash = plan.planHash;
  const occlusionOwners = [];
  const library = createMaterialLibrary({
    manifest: textureManifest,
    surfaceMaterials: plan.surfaceMaterials,
    textureLoader,
    renderer,
  });
  const sharedGeometries = createOverworldSharedGeometryLibrary();
  const terrainAssembly = addTerrain(root, plan, library);
  addTrees(root, plan, library, occlusionOwners, terrainAssembly.renderCullGroups, sharedGeometries);
  addHouses(root, plan, library, occlusionOwners, sharedGeometries);
  const camp = addCamp(root, plan, library, occlusionOwners);
  const lighting = addLighting(root, plan);
  const facade = makeCompatibilityFacade(
    root,
    plan,
    camp,
    terrainAssembly,
    lighting,
    occlusionOwners,
    library,
    textureManifest,
  );
  root.userData.overworldFacade = facade;
  return facade;
}

export function disposeOverworldFacade(facade) {
  if (!facade?.root || facade.disposed) return Object.freeze({ disposed: false, reason: 'already-disposed' });
  // Detach first so every outstanding V1 loader callback observes a cancelled
  // world and disposes its late result instead of attaching to a stale root.
  facade.root.removeFromParent();
  const registryEntries = facade.disposableResources ?? [];
  const registeredResources = new Set(registryEntries.map(({ resource }) => resource).filter(Boolean));
  for (const entry of registryEntries) entry?.dispose?.();
  if (!registryEntries.some(({ id }) => id === 'shared-camp-npc-assets')) facade.disposeNpcAssets?.();
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const renderTargets = new Set();
  facade.root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton?.boneTexture?.isTexture) textures.add(object.skeleton.boneTexture);
    for (const target of [object.shadow?.map, object.shadow?.mapPass]) {
      if (target?.isWebGLRenderTarget) renderTargets.add(target);
    }
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) if (!registeredResources.has(geometry)) geometry.dispose?.();
  for (const material of materials) if (!registeredResources.has(material)) material.dispose?.();
  for (const texture of textures) if (!registeredResources.has(texture)) texture.dispose?.();
  for (const target of renderTargets) target.dispose?.();
  delete facade.root.userData.overworldFacade;
  facade.disposed = true;
  facade.tiles?.clear?.();
  facade.floorTiles.length = 0;
  facade.renderCullGroups.length = 0;
  facade.occlusionOwners.length = 0;
  facade.disposableResources.length = 0;
  return Object.freeze({
    disposed: true,
    geometryCount: geometries.size,
    materialCount: materials.size,
    textureCount: textures.size,
    renderTargetCount: renderTargets.size,
    registeredResourceCount: registeredResources.size,
  });
}
