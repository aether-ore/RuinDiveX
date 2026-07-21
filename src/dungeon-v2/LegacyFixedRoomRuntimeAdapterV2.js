import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { deepFreezePlan } from './DungeonPlanV2Contract.js';
import { stablePlanStringify } from './DungeonPlanDiagnostics.js';
import { hashSeed } from '../reaverbots/SeededRandom.js';
import {
  LEGACY_CODE_NATIVE_PREFABS_V2,
} from './LegacyAuthoredModuleKitV2.js';
import {
  createLegacyAuthoredRuntimeKitV2,
  LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2,
} from './LegacyAuthoredRuntimeKitV2.js';
import {
  getLegacyFixedRoomModuleV2,
} from './LegacyFixedRoomModuleCatalogV2.js';
import { toLegacyFixedRoomWorldIdV2 } from './LegacyFixedRoomIdsV2.js';
export { toLegacyFixedRoomWorldIdV2 } from './LegacyFixedRoomIdsV2.js';
import {
  rotateBoundarySideQuarterTurns,
  rotatePointQuarterTurns,
  transformBoundsQuarterTurns,
  transformPointQuarterTurns,
} from './DungeonSpatialMathV2.js';

// V1 room geometry remains a presentation consumer of plan-owned contracts.
// Nothing in this file registers collision or derives gameplay behavior from
// mesh names. The planner compiles the structural contract first; assembly
// then renders those exact IDs and bounds.

export const LEGACY_FIXED_ROOM_PRESENTATION_POLICY_V2 = 'presentation-only-plan-contract-authoritative';
export const LEGACY_FIXED_ROOM_FIXTURE_PARITY_TOLERANCE_V2 = 0.18;
export const LEGACY_FIXED_ROOM_DEFAULT_DRAW_CALL_BUDGET_V2 = 24;
// Only physically substantial V1 landmark components need to submit to the
// directional shadow map. Small lights, rails, pistons, feet, and other
// repeated detail still receive the room's shadows and retain their exact
// presentation/collision contracts, but casting each of their static batches
// made every newly integrated V1 room permanently grow the global shadow
// workload. The threshold is evaluated from the component's final authored,
// uniformly-scaled visual bounds (never from its gameplay collider).
export const LEGACY_FIXED_ROOM_LANDMARK_SHADOW_VOLUME_THRESHOLD_V2 = 0.45;

// These are deliberately separate from the earlier generic V2 prefab kit.
// Each recipe below is a direct transcription of a concrete V1 room fixture;
// arbitrary boxes cannot opt into this list and no recipe is fitted to a
// descriptor with independent x/y/z scale values.
export const LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2 = Object.freeze({
  securityScannerArch: 'legacy-fixed-security-scanner-arch',
  chainLinkSecurityFence: 'legacy-fixed-chain-link-security-fence',
  industrialEngine: 'legacy-fixed-industrial-engine',
  serverEnergyCore: 'legacy-fixed-server-energy-core',
  serverEntryConsole: 'legacy-fixed-server-entry-console',
  machinePress: 'legacy-fixed-machine-press',
  machinePressLeg: 'legacy-fixed-machine-press-leg',
  machineRobotArm: 'legacy-fixed-machine-robot-arm',
  coolantMachineBase: 'legacy-fixed-coolant-machine-base',
  coolantPressureCore: 'legacy-fixed-coolant-pressure-core',
  coolantSourceTank: 'legacy-fixed-coolant-source-tank',
  coolantOverflowTank: 'legacy-fixed-coolant-overflow-tank',
  coolantValvePylon: 'legacy-fixed-coolant-valve-pylon',
  coolantValveTerminal: 'legacy-fixed-coolant-valve-terminal',
  coolantMasterConsole: 'legacy-fixed-coolant-master-console',
});

const WALL_THICKNESS = 0.22;
const CEILING_THICKNESS = 0.12;
const EPSILON = 1e-6;
const FIT_EPSILON = 0.001;
// Dungeon V1 authored its structural textures on the same 2.8m tile grid as
// its floor topology.  Native fixed-room panels therefore carry their real
// dimensions in geometry and repeat UVs at this physical scale.  Scaling a
// shared unit cube left one atlas panel stretched across an entire wall or
// ramp and made the supposedly native presentation look like the rejected V2
// graybox shell.
export const LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2 = LEGACY_RUIN_TEXTURE_TILE_SCALE_METRES_V2;

// Exact Dungeon V1 catwalk framing values.  Raised V1 walkable tiles are
// already rendered as 0.12m decks by the native presentation adapter; their
// ordinary support is the sparse post/underbeam frame below, not a solid box
// extruded from the room floor.  Only descriptors that explicitly request
// `support.style === 'solid_mass'` are allowed to compile that latter form.
const LEGACY_CATWALK_POST_WIDTH_V2 = 0.12;
const LEGACY_CATWALK_BEAM_HEIGHT_V2 = 0.08;
const LEGACY_CATWALK_BEAM_WIDTH_V2 = 0.12;
const LEGACY_CATWALK_CORNER_OFFSET_FACTOR_V2 = 0.36;
const LEGACY_CATWALK_BEAM_SPAN_FACTOR_V2 = 0.86;
const LEGACY_CATWALK_RAIL_HEIGHT_V2 = 0.68;
const LEGACY_CATWALK_RAIL_THICKNESS_V2 = 0.07;
const LEGACY_CATWALK_RAIL_SURFACES_V2 = new Set([
  'catwalk',
  'serverUpperCatwalk',
  'machineUpperCatwalk',
  'machineCrossBridge',
  'coolantControlBalcony',
  'coolantPipeBridge',
  'thirdFloorGantry',
  'secondFloorConveyor',
  'conveyorCrossBridge',
  'reveredMezzanine',
  'upperConnectionBridge',
  'upperConnectionApproach',
  'jumpPlatform',
]);
const LEGACY_CARDINAL_TILE_DIRECTIONS_V2 = Object.freeze([
  Object.freeze({ x: 1, z: 0 }),
  Object.freeze({ x: -1, z: 0 }),
  Object.freeze({ x: 0, z: 1 }),
  Object.freeze({ x: 0, z: -1 }),
]);

const PREFAB_BY_ID = new Map(
  Object.values(LEGACY_CODE_NATIVE_PREFABS_V2).map((prefab) => [prefab.id, prefab]),
);

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return Number(value);
}

function point(value, label) {
  if (!value || !['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]))) {
    throw new TypeError(`${label} must contain finite x, y, and z values.`);
  }
  return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
}

function normalizeQuarterTurns(value = 0) {
  if (!Number.isInteger(value)) throw new TypeError('yawQuarterTurns must be an integer.');
  return ((value % 4) + 4) % 4;
}

function normalizeModule(moduleOrId) {
  if (typeof moduleOrId === 'string') {
    const module = getLegacyFixedRoomModuleV2(moduleOrId);
    if (!module) throw new RangeError(`Unknown legacy fixed-room module ${moduleOrId}.`);
    return module;
  }
  if (!moduleOrId || typeof moduleOrId !== 'object') {
    throw new TypeError('A legacy fixed-room module descriptor or stable id is required.');
  }
  return moduleOrId;
}

function boundsFromCenterHalfSize(centerValue, halfSizeValue) {
  const center = point(centerValue, 'bounds.center');
  const halfSize = point(halfSizeValue, 'bounds.halfSize');
  if (['x', 'y', 'z'].some((axis) => halfSize[axis] <= 0)) {
    throw new RangeError('bounds.halfSize must be positive on every axis.');
  }
  return {
    center,
    halfSize,
    min: {
      x: center.x - halfSize.x,
      y: center.y - halfSize.y,
      z: center.z - halfSize.z,
    },
    max: {
      x: center.x + halfSize.x,
      y: center.y + halfSize.y,
      z: center.z + halfSize.z,
    },
  };
}

function serializableBounds(center, size) {
  return {
    center: { ...center },
    halfSize: {
      x: size.x * 0.5,
      y: size.y * 0.5,
      z: size.z * 0.5,
    },
  };
}

function repeatCount(worldExtent) {
  if (!Number.isFinite(worldExtent) || worldExtent <= 0) {
    throw new RangeError('Native fixed-room texture extents must be positive and finite.');
  }
  return worldExtent / LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2;
}

function applyWorldScaleBoxUvs(geometry, dimensions) {
  const uv = geometry.getAttribute('uv');
  const normal = geometry.getAttribute('normal');
  if (!uv || !normal || uv.count !== normal.count) {
    throw new Error('Native fixed-room box texturing requires matching UV and normal attributes.');
  }
  const faceRepeats = {
    x: { u: repeatCount(dimensions.z), v: repeatCount(dimensions.y) },
    y: { u: repeatCount(dimensions.x), v: repeatCount(dimensions.z) },
    z: { u: repeatCount(dimensions.x), v: repeatCount(dimensions.y) },
  };
  for (let index = 0; index < uv.count; index += 1) {
    const absX = Math.abs(normal.getX(index));
    const absY = Math.abs(normal.getY(index));
    const absZ = Math.abs(normal.getZ(index));
    const repeats = absX >= absY && absX >= absZ
      ? faceRepeats.x
      : absY >= absZ
        ? faceRepeats.y
        : faceRepeats.z;
    uv.setXY(index, uv.getX(index) * repeats.u, uv.getY(index) * repeats.v);
  }
  uv.needsUpdate = true;
  geometry.userData.v2TextureTiling = {
    mode: 'per-face-world-dimensions',
    tileScaleMetres: LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2,
    dimensions: { ...dimensions },
    faceRepeats,
  };
}

function applyWorldScaleUvRanges(geometry, uExtent, vExtent) {
  const uv = geometry.getAttribute('uv');
  if (!uv) throw new Error(`${geometry.type} world-scale texturing requires a UV attribute.`);
  const uRepeat = repeatCount(uExtent);
  const vRepeat = repeatCount(vExtent);
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, uv.getX(index) * uRepeat, uv.getY(index) * vRepeat);
  }
  uv.needsUpdate = true;
  geometry.userData.v2TextureTiling = {
    mode: 'world-extent-uv-ranges',
    tileScaleMetres: LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2,
    uExtent,
    vExtent,
    uRepeat,
    vRepeat,
  };
}

export function createInstancedWorldTiledMaterial(baseMaterial) {
  if (!baseMaterial?.map) return baseMaterial;
  const material = baseMaterial.clone();
  material.name = `${baseMaterial.name}:native-world-tiled`;
  material.map.wrapS = THREE.RepeatWrapping;
  material.map.wrapT = THREE.RepeatWrapping;
  material.map.userData.v2WorldScaleTiling = true;
  material.map.userData.v2TextureTileScaleMetres = LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2;
  material.userData.v2WorldScaleTiling = true;
  material.userData.v2TextureTileScaleMetres = LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2;
  const inheritedCompile = material.onBeforeCompile;
  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    inheritedCompile?.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nattribute vec3 instanceV2TextureDimensions;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
  vec3 v2AbsNormal = abs(normal);
  vec2 v2TextureRepeats = v2AbsNormal.x >= v2AbsNormal.y && v2AbsNormal.x >= v2AbsNormal.z
    ? vec2(instanceV2TextureDimensions.z, instanceV2TextureDimensions.y)
    : (v2AbsNormal.y >= v2AbsNormal.z
      ? vec2(instanceV2TextureDimensions.x, instanceV2TextureDimensions.z)
      : vec2(instanceV2TextureDimensions.x, instanceV2TextureDimensions.y));
  v2TextureRepeats /= ${LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2.toFixed(1)};
  vMapUv = (mapTransform * vec3(MAP_UV * v2TextureRepeats, 1)).xy;
#endif`,
      );
  };
  const inheritedProgramKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (
    `${inheritedProgramKey?.() ?? ''}|legacy-fixed-room-world-tiled-instancing-v2`
  );
  return material;
}

export function createInstancedWorldTiledUvRangeMaterial(baseMaterial) {
  if (!baseMaterial?.map) return baseMaterial;
  const material = baseMaterial.clone();
  material.name = `${baseMaterial.name}:native-world-tiled-uv-ranges`;
  material.map.wrapS = THREE.RepeatWrapping;
  material.map.wrapT = THREE.RepeatWrapping;
  material.map.userData.v2WorldScaleTiling = true;
  material.map.userData.v2TextureTileScaleMetres = LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2;
  material.userData.v2WorldScaleTiling = true;
  material.userData.v2TextureTileScaleMetres = LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2;
  const inheritedCompile = material.onBeforeCompile;
  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    inheritedCompile?.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 instanceV2TextureUvRepeats;',
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = (mapTransform * vec3(MAP_UV * instanceV2TextureUvRepeats, 1)).xy;
#endif`,
      );
  };
  const inheritedProgramKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (
    `${inheritedProgramKey?.() ?? ''}|legacy-fixed-room-world-tiled-uv-ranges-v2`
  );
  return material;
}

function matrixAxisLengths(matrix) {
  const elements = matrix.elements;
  return {
    x: Math.hypot(elements[0], elements[1], elements[2]),
    y: Math.hypot(elements[4], elements[5], elements[6]),
    z: Math.hypot(elements[8], elements[9], elements[10]),
  };
}

function textureContractForEntry(shape, dimensions, matrix) {
  const axes = matrixAxisLengths(matrix);
  if (shape === 'box') {
    return {
      dimensions: { x: axes.x, y: axes.y, z: axes.z },
      uvExtents: null,
    };
  }
  if (shape === 'cylinder' || shape === 'open-cylinder') {
    const radialX = axes.x;
    const radialZ = axes.z;
    // Elliptical circumference approximation remains stable under the
    // authored quarter-turn and uniform fixture transforms used by V1.
    const circumference = Math.PI * (
      3 * (radialX + radialZ)
      - Math.sqrt((3 * radialX + radialZ) * (radialX + 3 * radialZ))
    );
    return { dimensions: null, uvExtents: { u: circumference, v: axes.y } };
  }
  if (shape === 'torus') {
    const radialScale = (axes.x + axes.y) * 0.5;
    return {
      dimensions: null,
      uvExtents: {
        u: Math.PI * 2 * dimensions.radius * radialScale,
        v: Math.PI * 2 * dimensions.tube * ((axes.x + axes.y + axes.z) / 3),
      },
    };
  }
  if (shape === 'octahedron') {
    return {
      dimensions: null,
      uvExtents: {
        u: Math.max(axes.x, axes.z) * 2,
        v: axes.y * 2,
      },
    };
  }
  throw new RangeError(`Unsupported fixed-room texture contract shape: ${shape}`);
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => Math.round(value * 100000) / 100000))]
    .sort((left, right) => left - right);
}

function intervalCells(minimum, maximum, preferredStep, mandatoryCuts = []) {
  const cuts = [minimum, maximum, ...mandatoryCuts.filter((value) => (
    Number.isFinite(value) && value > minimum + EPSILON && value < maximum - EPSILON
  ))];
  if (Number.isFinite(preferredStep) && preferredStep > EPSILON) {
    for (let cursor = minimum + preferredStep; cursor < maximum - EPSILON; cursor += preferredStep) {
      cuts.push(cursor);
    }
  }
  const sorted = uniqueSorted(cuts);
  return sorted.slice(0, -1).map((start, index) => ({ start, end: sorted[index + 1] }));
}

function openingForSocket(socket, side) {
  if (socket.boundarySide !== side) return null;
  const anchor = point(socket.anchor, `${socket.id}.anchor`);
  const width = finite(socket.opening?.width, `${socket.id}.opening.width`);
  const height = finite(socket.opening?.height, `${socket.id}.opening.height`);
  const sill = finite(socket.opening?.sillElevation ?? anchor.y, `${socket.id}.opening.sillElevation`);
  const horizontal = side === 'north' || side === 'south' ? anchor.x : anchor.z;
  return {
    id: socket.id,
    uMin: horizontal - width * 0.5,
    uMax: horizontal + width * 0.5,
    vMin: sill,
    vMax: sill + height,
  };
}

function cellInsideOpening(uCell, vCell, opening) {
  const u = (uCell.start + uCell.end) * 0.5;
  const v = (vCell.start + vCell.end) * 0.5;
  return u > opening.uMin + EPSILON
    && u < opening.uMax - EPSILON
    && v > opening.vMin + EPSILON
    && v < opening.vMax - EPSILON;
}

function wallPanelBounds(side, uCell, vCell, moduleBounds) {
  const centerU = (uCell.start + uCell.end) * 0.5;
  const centerY = (vCell.start + vCell.end) * 0.5;
  const spanU = uCell.end - uCell.start;
  const height = vCell.end - vCell.start;
  if (side === 'north' || side === 'south') {
    return serializableBounds({
      x: centerU,
      y: centerY,
      z: side === 'north' ? moduleBounds.min.z : moduleBounds.max.z,
    }, { x: spanU, y: height, z: WALL_THICKNESS });
  }
  return serializableBounds({
    x: side === 'west' ? moduleBounds.min.x : moduleBounds.max.x,
    y: centerY,
    z: centerU,
  }, { x: WALL_THICKNESS, y: height, z: spanU });
}

function createWallBoundaries(module, openSocketIds) {
  const boundaries = [];
  const moduleBounds = module.bounds;
  const tileSize = module.floorTopology.tileSize;
  const wallBottom = moduleBounds.min.y;
  const wallTop = module.enclosure.ceilingHeight;
  const socketsBySide = new Map();
  for (const side of ['north', 'south', 'east', 'west']) {
    socketsBySide.set(side, module.extensionSockets
      .filter((socket) => openSocketIds.has(socket.id))
      .map((socket) => openingForSocket(socket, side))
      .filter(Boolean));
  }

  for (const side of ['north', 'south', 'east', 'west']) {
    const horizontalMin = side === 'north' || side === 'south' ? moduleBounds.min.x : moduleBounds.min.z;
    const horizontalMax = side === 'north' || side === 'south' ? moduleBounds.max.x : moduleBounds.max.z;
    const openings = socketsBySide.get(side);
    const uCells = intervalCells(horizontalMin, horizontalMax, tileSize, openings.flatMap(({ uMin, uMax }) => [uMin, uMax]));
    const vCells = intervalCells(wallBottom, wallTop, (wallTop - wallBottom) / 6, openings.flatMap(({ vMin, vMax }) => [vMin, vMax]));
    let sequence = 0;
    for (const uCell of uCells) {
      for (const vCell of vCells) {
        if (openings.some((opening) => cellInsideOpening(uCell, vCell, opening))) continue;
        const localBounds = wallPanelBounds(side, uCell, vCell, moduleBounds);
        boundaries.push({
          id: `boundary.${module.id}.${side}.${sequence += 1}`,
          side,
          role: 'opaque-enclosure-wall',
          localBounds,
          materialProfileId: 'legacy-wall-industrial',
          collision: {
            mode: 'blocking',
            grounded: true,
            aerial: true,
            camera: true,
            powerKnockback: true,
          },
          portalIds: openings
            .filter((opening) => (
              uCell.end >= opening.uMin - EPSILON
              && uCell.start <= opening.uMax + EPSILON
              && vCell.end >= opening.vMin - EPSILON
              && vCell.start <= opening.vMax + EPSILON
            ))
            .map(({ id }) => id),
        });
      }
    }
  }
  return boundaries;
}

function createCeilingBoundaries(module, openSocketIds) {
  const tileSize = module.floorTopology.tileSize;
  const width = module.sourceRoom.footprintMeters.width;
  const depth = module.sourceRoom.footprintMeters.depth;
  const columns = Math.round(width / tileSize);
  const rows = Math.round(depth / tileSize);
  const minX = module.bounds.min.x + tileSize * 0.5;
  const minZ = module.bounds.min.z + tileSize * 0.5;
  const ceilingOpenings = module.extensionSockets.filter((socket) => (
    openSocketIds.has(socket.id) && socket.boundarySide === 'ceiling'
  ));
  const boundaries = [];
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const x = minX + column * tileSize;
      const z = minZ + row * tileSize;
      const removed = ceilingOpenings.some((socket) => (
        Math.abs(x - socket.anchor.x) < socket.opening.width * 0.5 - EPSILON
        && Math.abs(z - socket.anchor.z) < socket.opening.width * 0.5 - EPSILON
      ));
      if (removed) continue;
      boundaries.push({
        id: `boundary.${module.id}.ceiling.${column}.${row}`,
        side: 'ceiling',
        role: 'opaque-enclosure-ceiling',
        localBounds: serializableBounds({
          x,
          y: module.enclosure.ceilingHeight + CEILING_THICKNESS * 0.5,
          z,
        }, { x: tileSize, y: CEILING_THICKNESS, z: tileSize }),
        materialProfileId: 'legacy-ceiling',
        collision: {
          mode: 'blocking',
          grounded: false,
          aerial: true,
          camera: true,
          powerKnockback: true,
        },
        portalIds: [],
      });
    }
  }
  return boundaries;
}

function createFloorFoundationBoundaries(module, openSocketIds) {
  const openings = module.extensionSockets
    .filter((socket) => (
      openSocketIds.has(socket.id)
      && socket.boundarySide === 'interior-floor'
      && socket.aperture?.mode === 'remove-declared-surfaces'
    ))
    .map((socket) => ({
      id: `opening.${socket.id}`,
      portalId: socket.id,
      center: {
        x: socket.anchor.x,
        y: module.bounds.min.y,
        z: socket.anchor.z,
      },
      dimensions: {
        width: socket.opening.width,
        depth: socket.opening.depth ?? socket.opening.width,
        height: WALL_THICKNESS,
      },
      declarationOnly: true,
    }));
  const record = (id, minX, maxX, minZ, maxZ, declaredOpenings = []) => ({
    id,
    side: 'floor',
    role: 'opaque-enclosure-floor-foundation',
    localBounds: serializableBounds({
      x: (minX + maxX) * 0.5,
      y: module.bounds.min.y - WALL_THICKNESS * 0.5,
      z: (minZ + maxZ) * 0.5,
    }, { x: maxX - minX, y: WALL_THICKNESS, z: maxZ - minZ }),
    materialProfileId: 'legacy-floor',
    collision: {
      mode: 'blocking',
      grounded: true,
      aerial: true,
      camera: true,
      powerKnockback: true,
    },
    portalIds: declaredOpenings.map(({ portalId }) => portalId),
    openings: declaredOpenings,
  });
  if (!openings.length) {
    return [record(
      `boundary.${module.id}.floor.foundation`,
      module.bounds.min.x,
      module.bounds.max.x,
      module.bounds.min.z,
      module.bounds.max.z,
    )];
  }

  const xCuts = uniqueSorted([
    module.bounds.min.x,
    module.bounds.max.x,
    ...openings.flatMap((opening) => [
      opening.center.x - opening.dimensions.width * 0.5,
      opening.center.x + opening.dimensions.width * 0.5,
    ]),
  ]);
  const zCuts = uniqueSorted([
    module.bounds.min.z,
    module.bounds.max.z,
    ...openings.flatMap((opening) => [
      opening.center.z - opening.dimensions.depth * 0.5,
      opening.center.z + opening.dimensions.depth * 0.5,
    ]),
  ]);
  const boundaries = [];
  for (let xIndex = 0; xIndex < xCuts.length - 1; xIndex += 1) {
    for (let zIndex = 0; zIndex < zCuts.length - 1; zIndex += 1) {
      const minX = xCuts[xIndex];
      const maxX = xCuts[xIndex + 1];
      const minZ = zCuts[zIndex];
      const maxZ = zCuts[zIndex + 1];
      const centerX = (minX + maxX) * 0.5;
      const centerZ = (minZ + maxZ) * 0.5;
      const removed = openings.some((opening) => (
        centerX > opening.center.x - opening.dimensions.width * 0.5 + EPSILON
        && centerX < opening.center.x + opening.dimensions.width * 0.5 - EPSILON
        && centerZ > opening.center.z - opening.dimensions.depth * 0.5 + EPSILON
        && centerZ < opening.center.z + opening.dimensions.depth * 0.5 - EPSILON
      ));
      if (removed) continue;
      boundaries.push(record(
        `boundary.${module.id}.floor.foundation.${boundaries.length + 1}`,
        minX,
        maxX,
        minZ,
        maxZ,
      ));
    }
  }
  if (!boundaries.length) throw new Error(`${module.id} floor apertures remove its complete foundation.`);
  // The actual foundation is already segmented. Keep one serializable portal
  // declaration on an adjacent panel so validation/runtime can bind the gap
  // without asking either renderer or collision to split that panel again.
  boundaries[0].openings = openings;
  boundaries[0].portalIds = openings.map(({ portalId }) => portalId);
  return boundaries;
}

function createFixtureContracts(module) {
  return module.fixtures.flatMap((fixture) => {
    const mode = fixture.collision?.mode;
    const presentationRecipeId = fixture.prefabId ?? fixture.presentation?.recipeId ?? null;
    if (mode === 'compound-blocking') {
      const parts = fixture.collision?.parts ?? [];
      if (!parts.length) throw new Error(`${fixture.id} compound-blocking collision requires explicit parts.`);
      return parts.map((part, index) => ({
        id: `collider.${fixture.id}.${part.id ?? `part-${index + 1}`}`,
        fixtureId: fixture.id,
        fixturePartId: part.id ?? `part-${index + 1}`,
        role: 'blocking-fixture-part',
        localBounds: {
          center: point(part.center, `${fixture.id}.collision.parts[${index}].center`),
          halfSize: point(part.halfSize, `${fixture.id}.collision.parts[${index}].halfSize`),
        },
        collision: {
          mode: 'blocking',
          grounded: true,
          aerial: true,
          camera: true,
          powerKnockback: true,
        },
        presentationRecipeId,
      }));
    }
    if (!['blocking', 'walkable'].includes(mode)) return [];
    return [{
      id: `collider.${fixture.id}`,
      fixtureId: fixture.id,
      role: mode === 'walkable' ? 'walkable-fixture' : 'blocking-fixture',
      localBounds: fixture.localBounds,
      collision: {
        mode,
        grounded: true,
        aerial: mode === 'blocking',
        camera: mode === 'blocking',
        powerKnockback: mode === 'blocking',
      },
      presentationRecipeId,
    }];
  });
}

function validateFixturePresentationContracts(module) {
  const knownSurfaceIds = new Set(module.floorTopology.walkableSurfaces.map(({ id }) => id));
  const surfaceCoveredFixtureIds = [];
  for (const fixture of module.fixtures) {
    const recipeId = fixture.prefabId ?? fixture.presentation?.recipeId ?? null;
    const coveredBySurfaceIds = fixture.presentation?.coveredBySurfaceIds ?? [];
    if (recipeId && coveredBySurfaceIds.length) {
      throw new Error(`${fixture.id} cannot declare both a V1 fixture recipe and surface-owned presentation.`);
    }
    if (coveredBySurfaceIds.length) {
      for (const surfaceId of coveredBySurfaceIds) {
        if (!knownSurfaceIds.has(surfaceId)) {
          throw new Error(`${fixture.id} is covered by unknown walkable surface ${surfaceId}.`);
        }
      }
      if (fixture.collision?.mode !== 'reserved-only') {
        throw new Error(`${fixture.id} surface-owned presentation cannot also own fixture collision.`);
      }
      surfaceCoveredFixtureIds.push(fixture.id);
      continue;
    }
    if (!recipeId) {
      throw new Error(`${fixture.id} has no visible native V1 recipe or explicit surface-owned presentation.`);
    }
    if (!['blocking', 'walkable', 'compound-blocking'].includes(fixture.collision?.mode)) {
      throw new Error(`${fixture.id} is reachable presentation but does not declare tight plan-owned collision.`);
    }
  }
  return surfaceCoveredFixtureIds;
}

function createWalkableSurfaceContracts(module, openSocketIds) {
  const interiorOpenings = module.extensionSockets.filter((socket) => (
    openSocketIds.has(socket.id) && socket.boundarySide === 'interior-floor'
  ));
  const removedSurfaceIds = new Set(interiorOpenings
    .filter((socket) => socket.aperture?.mode === 'remove-declared-surfaces')
    .flatMap((socket) => socket.aperture.surfaceIds));
  const surfaces = module.floorTopology.walkableSurfaces.filter(({ id }) => (
    !removedSurfaceIds.has(id)
  ));

  // Dungeon V1 stores a ramp tile at each path point. Its first and last
  // records therefore use half-rises while the interior records use full
  // rises. Rendering those records independently and also exposing one
  // aggregate runtime incline creates two different elevations over the same
  // player path. Normalize each immutable straight run edge-to-edge here so
  // the plan signature, presentation adapter, sampled collider, and grounded
  // controller all consume the same continuous physical slope.
  const normalizedById = new Map();
  const rampRuns = new Map();
  for (const surface of surfaces.filter(({ shape, ramp }) => shape === 'ramp-tile' && ramp)) {
    const runId = surface.ramp.runId ?? surface.ramp.routeId;
    const run = rampRuns.get(runId) ?? [];
    run.push(surface);
    rampRuns.set(runId, run);
  }
  for (const run of rampRuns.values()) {
    const ordered = [...run].sort((left, right) => (
      (left.traversalRoute?.sequenceIndex ?? 0) - (right.traversalRoute?.sequenceIndex ?? 0)
    ));
    const startY = ordered[0].ramp.startY;
    const endY = ordered.at(-1).ramp.endY;
    const count = ordered.length;
    ordered.forEach((surface, index) => {
      const normalizedStartY = startY + (endY - startY) * (index / count);
      const normalizedEndY = startY + (endY - startY) * ((index + 1) / count);
      const topY = (normalizedStartY + normalizedEndY) * 0.5;
      normalizedById.set(surface.id, {
        ...surface,
        center: { ...surface.center, y: topY },
        topY,
        ramp: {
          ...surface.ramp,
          startY: normalizedStartY,
          endY: normalizedEndY,
          collisionProfile: 'continuous-linear-run',
        },
      });
    });
  }
  return surfaces.map((surface) => normalizedById.get(surface.id) ?? surface);
}

/**
 * Compile the serializable structural contract during planning. Runtime must
 * consume this result; it never scans the rendered room to invent collision.
 */
export function compileLegacyFixedRoomStructuralContractV2(moduleOrId, {
  openSocketIds = [],
} = {}) {
  const module = normalizeModule(moduleOrId);
  const knownSocketIds = new Set(module.extensionSockets.map(({ id }) => id));
  const requestedSocketIds = new Set(openSocketIds);
  for (const socketId of requestedSocketIds) {
    if (!knownSocketIds.has(socketId)) {
      throw new RangeError(`${module.id} has no extension socket ${socketId}.`);
    }
  }
  const surfaceCoveredFixtureIds = validateFixturePresentationContracts(module);
  const fixtureColliders = createFixtureContracts(module);
  for (const collider of fixtureColliders) {
    if (!collider.presentationRecipeId) {
      throw new Error(`${collider.fixtureId} requests ${collider.collision.mode} collision without a visible V1 recipe.`);
    }
  }
  const structuralBoundaries = [
    ...createWallBoundaries(module, requestedSocketIds),
    ...createCeilingBoundaries(module, requestedSocketIds),
    ...createFloorFoundationBoundaries(module, requestedSocketIds),
  ];
  const walkableSurfaces = createWalkableSurfaceContracts(module, requestedSocketIds);
  const sortedOpenSocketIds = [...requestedSocketIds].sort();
  const portals = module.extensionSockets.map((socket) => ({
    id: socket.id,
    boundarySide: socket.boundarySide,
    anchor: socket.anchor,
    facing: socket.facing,
    opening: socket.opening,
    approachSurfaceIds: socket.approachSurfaceIds,
    state: requestedSocketIds.has(socket.id) ? 'paired-open' : 'opaque-capped',
  }));
  return deepFreezePlan({
    id: `structural-contract.${module.id}.r${module.revision}.sockets.${sortedOpenSocketIds.join('+') || 'none'}`,
    moduleId: module.id,
    moduleRevision: module.revision,
    collisionAuthority: 'accepted-plan',
    openSocketIds: sortedOpenSocketIds,
    structuralBoundaries,
    portals,
    walkableSurfaces,
    fixtureColliders,
    surfaceCoveredFixtureIds,
  });
}

function contractFor(module, contract) {
  if (!contract || typeof contract !== 'object') {
    throw new TypeError(`Rendering ${module.id} requires its accepted structuralContract.`);
  }
  if (contract.moduleId !== module.id || contract.moduleRevision !== module.revision) {
    throw new Error(`Structural contract ${contract.id ?? '<unknown>'} does not match ${module.id}@${module.revision}.`);
  }
  return contract;
}

function normalizePlacement(placement = {}) {
  const id = String(placement.id ?? '').trim();
  if (!id) throw new TypeError('A fixed-room placement requires a stable id.');
  return {
    id,
    translation: point(placement.translation ?? placement.position ?? { x: 0, y: 0, z: 0 }, 'placement.translation'),
    yawQuarterTurns: normalizeQuarterTurns(placement.yawQuarterTurns ?? 0),
  };
}

function rotateHalfSize(halfSizeValue, yawQuarterTurns) {
  const halfSize = point(halfSizeValue, 'halfSize');
  return yawQuarterTurns % 2 === 0
    ? halfSize
    : { x: halfSize.z, y: halfSize.y, z: halfSize.x };
}

function transformCenterHalfSize(localBounds, placement) {
  const center = transformPointQuarterTurns(localBounds.center, placement);
  const halfSize = rotateHalfSize(localBounds.halfSize, placement.yawQuarterTurns);
  return {
    center,
    halfSize,
    min: {
      x: center.x - halfSize.x,
      y: center.y - halfSize.y,
      z: center.z - halfSize.z,
    },
    max: {
      x: center.x + halfSize.x,
      y: center.y + halfSize.y,
      z: center.z + halfSize.z,
    },
  };
}

function placedId(placementId, localId) {
  return toLegacyFixedRoomWorldIdV2(placementId, localId);
}

function descriptorReference(module, contract, localId) {
  return {
    moduleId: module.id,
    moduleRevision: module.revision,
    structuralContractId: contract.id,
    localId,
  };
}

export function createLegacyFixedRoomStructuralContractSignatureV2({
  descriptorId,
  descriptorRevision,
  structuralContractId,
  transform,
  localOpenSocketIds,
  structuralBoundaries,
  walkableSurfaces,
  fixtureColliders,
  portals = [],
}) {
  const payload = stablePlanStringify({
    schema: 'legacy-fixed-room-structural-signature-v2',
    descriptorId,
    descriptorRevision,
    structuralContractId,
    transform,
    localOpenSocketIds,
    structuralBoundaries,
    walkableSurfaces,
    fixtureColliders,
    portals,
  });
  return `legacy-fixed-room-structural-v2:${hashSeed(payload).toString(16).padStart(8, '0')}`;
}

/**
 * Transform a compiled local structural contract into immutable plan-ready
 * world records. IDs retain an explicit descriptor reference at every level.
 */
export function compileLegacyFixedRoomPlacementV2(moduleOrId, {
  id,
  translation = { x: 0, y: 0, z: 0 },
  yawQuarterTurns = 0,
  structuralContract,
} = {}) {
  const module = normalizeModule(moduleOrId);
  const contract = contractFor(module, structuralContract);
  const placement = normalizePlacement({ id, translation, yawQuarterTurns });
  const presentationOwnerId = placement.id;
  const presentationContractId = `presentation-contract/${placement.id}`;
  const surfaceIdMap = new Map(contract.walkableSurfaces.map(({ id: localId }) => (
    [localId, placedId(placement.id, localId)]
  )));
  const structuralBoundaries = contract.structuralBoundaries.map((boundary) => {
    const worldBounds = transformCenterHalfSize(boundary.localBounds, placement);
    const openings = (boundary.openings ?? []).map((opening) => {
      const center = transformPointQuarterTurns(opening.center, placement);
      const dimensions = { ...opening.dimensions };
      if (placement.yawQuarterTurns % 2 === 1) {
        [dimensions.width, dimensions.depth] = [dimensions.depth, dimensions.width];
      }
      return {
        ...opening,
        id: placedId(placement.id, opening.id),
        localId: opening.id,
        portalId: opening.portalId ? placedId(placement.id, opening.portalId) : null,
        center,
        dimensions,
      };
    });
    return {
      ...boundary,
      id: placedId(placement.id, boundary.id),
      localId: boundary.id,
      side: ['floor', 'ceiling'].includes(boundary.side)
        ? boundary.side
        : rotateBoundarySideQuarterTurns(boundary.side, placement.yawQuarterTurns),
      worldBounds,
      bounds: {
        min: { ...worldBounds.min },
        max: { ...worldBounds.max },
      },
      center: worldBounds.center,
      dimensions: {
        x: worldBounds.halfSize.x * 2,
        y: worldBounds.halfSize.y * 2,
        z: worldBounds.halfSize.z * 2,
      },
      portalIds: boundary.portalIds.map((portalId) => placedId(placement.id, portalId)),
      openings,
      presentationOwnerId,
      presentationContractId,
      descriptorReference: descriptorReference(module, contract, boundary.id),
    };
  });
  const walkableSurfaces = contract.walkableSurfaces.map((surface) => {
    const center = transformPointQuarterTurns(surface.center, placement);
    const size = placement.yawQuarterTurns % 2 === 0
      ? surface.size
      : { x: surface.size.z, y: surface.size.y, z: surface.size.x };
    const direction = surface.ramp?.direction
      ? rotatePointQuarterTurns({ x: surface.ramp.direction.x, y: 0, z: surface.ramp.direction.z }, placement.yawQuarterTurns)
      : null;
    const startY = surface.ramp
      ? surface.ramp.startY + placement.translation.y
      : surface.topY + placement.translation.y;
    const endY = surface.ramp
      ? surface.ramp.endY + placement.translation.y
      : surface.topY + placement.translation.y;
    const bounds = {
      min: {
        x: center.x - size.x * 0.5,
        y: Math.min(startY, endY) - size.y,
        z: center.z - size.z * 0.5,
      },
      max: {
        x: center.x + size.x * 0.5,
        y: Math.max(startY, endY),
        z: center.z + size.z * 0.5,
      },
    };
    return {
      ...surface,
      id: surfaceIdMap.get(surface.id),
      localId: surface.id,
      center,
      size: { ...size },
      topY: surface.topY + placement.translation.y,
      bounds,
      ...(surface.ramp ? {
        ramp: {
          ...surface.ramp,
          startY: surface.ramp.startY + placement.translation.y,
          endY: surface.ramp.endY + placement.translation.y,
          direction: { x: direction.x, z: direction.z },
        },
      } : {}),
      presentationOwnerId,
      presentationContractId,
      descriptorReference: descriptorReference(module, contract, surface.id),
    };
  });
  const fixtureColliders = contract.fixtureColliders.map((collider) => {
    const worldBounds = transformCenterHalfSize(collider.localBounds, placement);
    return {
      ...collider,
      id: placedId(placement.id, collider.id),
      localId: collider.id,
      fixtureId: placedId(placement.id, collider.fixtureId),
      localFixtureId: collider.fixtureId,
      worldBounds,
      bounds: {
        min: { ...worldBounds.min },
        max: { ...worldBounds.max },
      },
      center: worldBounds.center,
      dimensions: {
        x: worldBounds.halfSize.x * 2,
        y: worldBounds.halfSize.y * 2,
        z: worldBounds.halfSize.z * 2,
      },
      presentationOwnerId,
      presentationContractId,
      descriptorReference: descriptorReference(module, contract, collider.id),
    };
  });
  const portals = contract.portals.map((portal) => {
    const facing = rotatePointQuarterTurns(portal.facing, placement.yawQuarterTurns);
    return {
      ...portal,
      id: placedId(placement.id, portal.id),
      localId: portal.id,
      boundarySide: ['ceiling', 'interior-floor'].includes(portal.boundarySide)
        ? portal.boundarySide
        : rotateBoundarySideQuarterTurns(portal.boundarySide, placement.yawQuarterTurns),
      anchor: transformPointQuarterTurns(portal.anchor, placement),
      facing,
      approachSurfaceIds: portal.approachSurfaceIds.map((surfaceId) => {
        const placedSurfaceId = surfaceIdMap.get(surfaceId);
        if (!placedSurfaceId) {
          throw new Error(`${portal.id} references surface ${surfaceId} removed by its own aperture.`);
        }
        return placedSurfaceId;
      }),
      presentationOwnerId,
      presentationContractId,
      descriptorReference: descriptorReference(module, contract, portal.id),
    };
  });
  const structuralContractSignature = createLegacyFixedRoomStructuralContractSignatureV2({
    descriptorId: module.id,
    descriptorRevision: module.revision,
    structuralContractId: contract.id,
    transform: placement,
    localOpenSocketIds: contract.openSocketIds,
    structuralBoundaries,
    walkableSurfaces,
    fixtureColliders,
    portals,
  });
  return deepFreezePlan({
    id: placement.id,
    descriptorId: module.id,
    descriptorRevision: module.revision,
    presentationProfileId: 'legacy-fixed-room-native-v2',
    structuralContractId: contract.id,
    structuralContractSignature,
    transform: placement,
    worldBounds: transformBoundsQuarterTurns(module.bounds, placement),
    localOpenSocketIds: [...contract.openSocketIds],
    presentation: {
      ownerId: presentationOwnerId,
      contractId: presentationContractId,
      adapterId: 'legacy-fixed-room-runtime-v2',
      source: 'dungeon-v1',
    },
    openSocketIds: contract.openSocketIds.map((socketId) => placedId(placement.id, socketId)),
    structuralBoundaries,
    walkableSurfaces,
    fixtureColliders,
    portals,
    placedRecordIds: {
      structuralBoundaryIds: structuralBoundaries.map(({ id: recordId }) => recordId),
      walkableSurfaceIds: walkableSurfaces.map(({ id: recordId }) => recordId),
      fixtureColliderIds: fixtureColliders.map(({ id: recordId }) => recordId),
      portalIds: portals.map(({ id: recordId }) => recordId),
    },
  });
}

function unionWorldBounds(records) {
  return records.reduce((result, record) => ({
    min: {
      x: Math.min(result.min.x, record.bounds.min.x),
      y: Math.min(result.min.y, record.bounds.min.y),
      z: Math.min(result.min.z, record.bounds.min.z),
    },
    max: {
      x: Math.max(result.max.x, record.bounds.max.x),
      y: Math.max(result.max.y, record.bounds.max.y),
      z: Math.max(result.max.z, record.bounds.max.z),
    },
  }), {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  });
}

function contiguousTileRectangles(surfaces) {
  const rows = new Map();
  for (const surface of surfaces) {
    const z = surface.localTile?.z;
    const x = surface.localTile?.x;
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      throw new Error(`${surface.id} cannot compile a native deck mass without local tile coordinates.`);
    }
    const row = rows.get(z) ?? [];
    row.push({ x, surface });
    rows.set(z, row);
  }
  const rectangles = [];
  const active = new Map();
  for (const [z, entries] of [...rows].sort(([left], [right]) => left - right)) {
    const sorted = [...entries].sort((left, right) => left.x - right.x);
    const runs = [];
    let run = null;
    for (const entry of sorted) {
      if (!run || entry.x > run.maxX + 1.001) {
        run = { minX: entry.x, maxX: entry.x, minZ: z, maxZ: z, surfaces: [entry.surface] };
        runs.push(run);
      } else {
        run.maxX = entry.x;
        run.surfaces.push(entry.surface);
      }
    }
    const nextActive = new Map();
    for (const rowRun of runs) {
      const key = `${rowRun.minX}:${rowRun.maxX}`;
      const prior = active.get(key);
      if (prior && Math.abs(prior.maxZ + 1 - z) <= 0.001) {
        prior.maxZ = z;
        prior.surfaces.push(...rowRun.surfaces);
        nextActive.set(key, prior);
      } else {
        rectangles.push(rowRun);
        nextActive.set(key, rowRun);
      }
    }
    active.clear();
    for (const [key, value] of nextActive) active.set(key, value);
  }
  return rectangles;
}

function subtractPlanarBounds(source, cut) {
  const overlap = {
    minX: Math.max(source.min.x, cut.min.x),
    maxX: Math.min(source.max.x, cut.max.x),
    minZ: Math.max(source.min.z, cut.min.z),
    maxZ: Math.min(source.max.z, cut.max.z),
  };
  if (overlap.maxX - overlap.minX <= EPSILON || overlap.maxZ - overlap.minZ <= EPSILON) {
    return [source];
  }
  const pieces = [];
  const append = (minX, maxX, minZ, maxZ) => {
    if (maxX - minX <= EPSILON || maxZ - minZ <= EPSILON) return;
    pieces.push({
      min: { x: minX, y: source.min.y, z: minZ },
      max: { x: maxX, y: source.max.y, z: maxZ },
    });
  };
  append(source.min.x, overlap.minX, source.min.z, source.max.z);
  append(overlap.maxX, source.max.x, source.min.z, source.max.z);
  append(overlap.minX, overlap.maxX, source.min.z, overlap.minZ);
  append(overlap.minX, overlap.maxX, overlap.maxZ, source.max.z);
  return pieces;
}

function nativeRampDeckClearanceCuts(walkableSurfaces) {
  const byRoute = new Map();
  for (const surface of walkableSurfaces.filter(({ shape }) => shape === 'ramp-tile')) {
    const routeId = surface.ramp?.routeId;
    if (!routeId) continue;
    const route = byRoute.get(routeId) ?? [];
    route.push(surface);
    byRoute.set(routeId, route);
  }
  const cuts = [];
  for (const surfaces of byRoute.values()) {
    const ordered = [...surfaces].sort((left, right) => (
      (left.traversalRoute?.sequenceIndex ?? 0) - (right.traversalRoute?.sequenceIndex ?? 0)
    ));
    cuts.push(...ordered.map(({ bounds }) => ({
      min: { x: bounds.min.x, z: bounds.min.z },
      max: { x: bounds.max.x, z: bounds.max.z },
    })));
  }
  return cuts;
}

function boxBoundsAt(center, size) {
  return {
    min: {
      x: center.x - size.x * 0.5,
      y: center.y - size.y * 0.5,
      z: center.z - size.z * 0.5,
    },
    max: {
      x: center.x + size.x * 0.5,
      y: center.y + size.y * 0.5,
      z: center.z + size.z * 0.5,
    },
  };
}

function raisedSurfaceComponents(surfaces) {
  const byTile = new Map(surfaces.map((surface) => [
    `${surface.localTile.x}:${surface.localTile.z}:${surface.topY.toFixed(4)}`,
    surface,
  ]));
  const visited = new Set();
  const components = [];
  for (const seed of surfaces) {
    if (visited.has(seed.id)) continue;
    const component = [];
    const frontier = [seed];
    visited.add(seed.id);
    while (frontier.length) {
      const surface = frontier.pop();
      component.push(surface);
      for (const direction of LEGACY_CARDINAL_TILE_DIRECTIONS_V2) {
        const neighbor = byTile.get([
          surface.localTile.x + direction.x,
          surface.localTile.z + direction.z,
          surface.topY.toFixed(4),
        ].join(':'));
        if (neighbor && !visited.has(neighbor.id)) {
          visited.add(neighbor.id);
          frontier.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function nativeCatwalkPortalRailOpenings(compiledPlacement) {
  const surfaceById = new Map(compiledPlacement.walkableSurfaces.map((surface) => [surface.id, surface]));
  const openings = new Map();
  const add = (surface, direction, portal, reason) => {
    if (!surface || (!direction.x && !direction.z)) return;
    openings.set(`${surface.id}:${direction.x}:${direction.z}`, {
      surfaceId: surface.id,
      localDirection: { x: direction.x, z: direction.z },
      portalId: portal.id,
      reason,
    });
  };
  for (const portal of compiledPlacement.portals ?? []) {
    if (portal.state !== 'paired-open') continue;
    const approaches = portal.approachSurfaceIds
      .map((surfaceId) => surfaceById.get(surfaceId))
      .filter(Boolean);
    if (!approaches.length) continue;
    const landing = [...approaches].sort((left, right) => {
      const leftDistance = Math.hypot(left.center.x - portal.anchor.x, left.center.z - portal.anchor.z);
      const rightDistance = Math.hypot(right.center.x - portal.anchor.x, right.center.z - portal.anchor.z);
      return leftDistance - rightDistance;
    })[0];
    const localFacing = rotatePointQuarterTurns(
      portal.facing,
      (4 - compiledPlacement.transform.yawQuarterTurns) % 4,
    );
    const horizontalDirection = {
      x: Math.sign(localFacing.x),
      z: Math.sign(localFacing.z),
    };
    if (horizontalDirection.x || horizontalDirection.z) {
      const worldFacing = {
        x: Math.sign(portal.facing.x),
        z: Math.sign(portal.facing.z),
      };
      const portalAlongX = Math.abs(worldFacing.z) > 0.5;
      const portalAxis = portalAlongX ? portal.anchor.x : portal.anchor.z;
      const portalHalfWidth = portal.opening.width * 0.5;
      for (const surface of compiledPlacement.walkableSurfaces) {
        if (Math.abs(surface.topY - portal.anchor.y) > 0.3) continue;
        const tileSize = Math.min(surface.size.x, surface.size.z);
        const edgeCenter = {
          x: surface.center.x + worldFacing.x * tileSize * 0.5,
          z: surface.center.z + worldFacing.z * tileSize * 0.5,
        };
        const edgeLine = portalAlongX ? edgeCenter.z : edgeCenter.x;
        const portalLine = portalAlongX ? portal.anchor.z : portal.anchor.x;
        if (Math.abs(edgeLine - portalLine) > 0.05) continue;
        const edgeAxis = portalAlongX ? surface.center.x : surface.center.z;
        const edgeMin = edgeAxis - tileSize * 0.5;
        const edgeMax = edgeAxis + tileSize * 0.5;
        if (edgeMax < portalAxis - portalHalfWidth - EPSILON
          || edgeMin > portalAxis + portalHalfWidth + EPSILON) continue;
        add(surface, horizontalDirection, portal, 'paired-horizontal-portal');
      }
      continue;
    }

    // A ceiling/service ladder is mounted at the first landing tile.  Open
    // the edge opposite its next approach tile so the ladder root/top-out is
    // not fenced off.  This matches the new authored ladder sockets without
    // removing rail from the rest of the exposed catwalk perimeter.
    const orderedLanding = surfaceById.get(portal.approachSurfaceIds[0]) ?? landing;
    const nextApproach = portal.approachSurfaceIds
      .slice(1)
      .map((surfaceId) => surfaceById.get(surfaceId))
      .find(Boolean);
    const ladderDirection = nextApproach
      ? {
          x: Math.sign(orderedLanding.localTile.x - nextApproach.localTile.x),
          z: Math.sign(orderedLanding.localTile.z - nextApproach.localTile.z),
        }
      : Math.abs(orderedLanding.localTile.x) >= Math.abs(orderedLanding.localTile.z)
        ? { x: Math.sign(orderedLanding.localTile.x) || 1, z: 0 }
        : { x: 0, z: Math.sign(orderedLanding.localTile.z) || 1 };
    add(orderedLanding, ladderDirection, portal, 'paired-vertical-ladder-portal');
  }
  return openings;
}

function compileNativeCatwalkFrameParts(compiledPlacement, component, allSurfaceColumns, portalOpenings) {
  const parts = [];
  const railOpenings = [];
  const partKeys = new Set();
  const appendPart = (role, bounds, sourceSurfaceIds) => {
    const key = [
      role,
      bounds.min.x.toFixed(4), bounds.min.y.toFixed(4), bounds.min.z.toFixed(4),
      bounds.max.x.toFixed(4), bounds.max.y.toFixed(4), bounds.max.z.toFixed(4),
    ].join(':');
    if (partKeys.has(key)) return;
    partKeys.add(key);
    parts.push({ role, bounds, sourceSurfaceIds: [...sourceSurfaceIds] });
  };

  let supportTiles = component.filter(({ localTile }) => (
    Math.abs(localTile.x + localTile.z) % 2 === 0
  ));
  let usedParityFallback = false;
  if (!supportTiles.length) {
    // This occurs only for an isolated authored landing.  Keep it visibly
    // supported rather than inventing a full-height slab; connected V1 decks
    // continue to use their exact checkerboard support cadence.
    supportTiles = [component[0]];
    usedParityFallback = true;
  }
  for (const surface of supportTiles) {
    const supportHeight = Math.max(
      LEGACY_CATWALK_POST_WIDTH_V2,
      surface.topY - compiledPlacement.worldBounds.min.y - 0.1,
    );
    const tileSize = Math.min(surface.size.x, surface.size.z);
    const cornerOffset = tileSize * LEGACY_CATWALK_CORNER_OFFSET_FACTOR_V2;
    for (const localOffsetX of [-cornerOffset, cornerOffset]) {
      for (const localOffsetZ of [-cornerOffset, cornerOffset]) {
        const offset = rotatePointQuarterTurns(
          { x: localOffsetX, y: 0, z: localOffsetZ },
          compiledPlacement.transform.yawQuarterTurns,
        );
        appendPart('support-post', boxBoundsAt({
          x: surface.center.x + offset.x,
          y: compiledPlacement.worldBounds.min.y + supportHeight * 0.5,
          z: surface.center.z + offset.z,
        }, {
          x: LEGACY_CATWALK_POST_WIDTH_V2,
          y: supportHeight,
          z: LEGACY_CATWALK_POST_WIDTH_V2,
        }), [surface.id]);
      }
    }
    const xBeamSize = rotatePointQuarterTurns(
      {
        x: tileSize * LEGACY_CATWALK_BEAM_SPAN_FACTOR_V2,
        y: 0,
        z: LEGACY_CATWALK_BEAM_WIDTH_V2,
      },
      compiledPlacement.transform.yawQuarterTurns,
    );
    const zBeamSize = rotatePointQuarterTurns(
      {
        x: LEGACY_CATWALK_BEAM_WIDTH_V2,
        y: 0,
        z: tileSize * LEGACY_CATWALK_BEAM_SPAN_FACTOR_V2,
      },
      compiledPlacement.transform.yawQuarterTurns,
    );
    const positiveSize = (value) => Math.abs(value);
    appendPart('underbeam-x', boxBoundsAt({
      x: surface.center.x,
      y: surface.topY - 0.16,
      z: surface.center.z,
    }, {
      x: positiveSize(xBeamSize.x) || positiveSize(xBeamSize.z),
      y: LEGACY_CATWALK_BEAM_HEIGHT_V2,
      z: positiveSize(xBeamSize.z) || positiveSize(xBeamSize.x),
    }), [surface.id]);
    appendPart('underbeam-z', boxBoundsAt({
      x: surface.center.x,
      y: surface.topY - 0.16,
      z: surface.center.z,
    }, {
      x: positiveSize(zBeamSize.x) || positiveSize(zBeamSize.z),
      y: LEGACY_CATWALK_BEAM_HEIGHT_V2,
      z: positiveSize(zBeamSize.z) || positiveSize(zBeamSize.x),
    }), [surface.id]);
  }

  const railEdges = [];
  for (const surface of component) {
    if (!LEGACY_CATWALK_RAIL_SURFACES_V2.has(surface.sourceSurface)) continue;
    for (const localDirection of LEGACY_CARDINAL_TILE_DIRECTIONS_V2) {
      const adjacentColumn = allSurfaceColumns.get([
        surface.localTile.x + localDirection.x,
        surface.localTile.z + localDirection.z,
      ].join(':')) ?? [];
      const sameTierSurface = adjacentColumn.some((candidate) => (
        candidate.shape !== 'ramp-tile'
        && Math.abs(candidate.topY - surface.topY) <= 0.3
      ));
      if (sameTierSurface) continue;
      const worldDirection = rotatePointQuarterTurns(
        { x: localDirection.x, y: 0, z: localDirection.z },
        compiledPlacement.transform.yawQuarterTurns,
      );
      const realRampOpening = adjacentColumn.some((candidate) => {
        if (candidate.shape !== 'ramp-tile') return false;
        const directionDot = Math.abs(
          candidate.ramp.direction.x * worldDirection.x
          + candidate.ramp.direction.z * worldDirection.z
        );
        const rampLow = Math.min(candidate.ramp.startY, candidate.ramp.endY);
        const rampHigh = Math.max(candidate.ramp.startY, candidate.ramp.endY);
        return directionDot > 0.5
          && surface.topY >= rampLow - 0.3
          && surface.topY <= rampHigh + 0.3;
      });
      if (realRampOpening) {
        railOpenings.push({
          surfaceId: surface.id,
          localDirection: { ...localDirection },
          reason: 'authored-ramp-connection',
        });
        continue;
      }
      const portalOpening = portalOpenings.get(
        `${surface.id}:${localDirection.x}:${localDirection.z}`,
      );
      if (portalOpening) {
        railOpenings.push(portalOpening);
        continue;
      }
      const tileSize = Math.min(surface.size.x, surface.size.z);
      const edgeCenter = {
        x: surface.center.x + worldDirection.x * tileSize * 0.5,
        z: surface.center.z + worldDirection.z * tileSize * 0.5,
      };
      const horizontal = Math.abs(worldDirection.z) > 0.5;
      railEdges.push({
        horizontal,
        worldDirection,
        line: horizontal ? edgeCenter.z : edgeCenter.x,
        axis: horizontal ? surface.center.x : surface.center.z,
        elevation: surface.topY,
        tileSize,
        surfaceId: surface.id,
      });
    }
  }

  const railBuckets = new Map();
  for (const edge of railEdges) {
    const key = [
      edge.horizontal ? 'h' : 'v',
      edge.worldDirection.x,
      edge.worldDirection.z,
      edge.line.toFixed(4),
      edge.elevation.toFixed(4),
      edge.tileSize.toFixed(4),
    ].join(':');
    const bucket = railBuckets.get(key) ?? { ...edge, entries: [] };
    bucket.entries.push(edge);
    railBuckets.set(key, bucket);
  }
  const railPostKeys = new Set();
  for (const bucket of railBuckets.values()) {
    const entries = [...bucket.entries].sort((left, right) => left.axis - right.axis);
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const first = run[0];
      const last = run.at(-1);
      const startEndpoint = first.axis - bucket.tileSize * 0.5;
      const endEndpoint = last.axis + bucket.tileSize * 0.5;
      const length = endEndpoint - startEndpoint;
      const centerAxis = (startEndpoint + endEndpoint) * 0.5;
      const railCenter = {
        x: bucket.horizontal ? centerAxis : bucket.line,
        y: bucket.elevation + LEGACY_CATWALK_RAIL_HEIGHT_V2,
        z: bucket.horizontal ? bucket.line : centerAxis,
      };
      appendPart('rail-run', boxBoundsAt(railCenter, {
        x: bucket.horizontal ? length : LEGACY_CATWALK_RAIL_THICKNESS_V2,
        y: LEGACY_CATWALK_RAIL_THICKNESS_V2,
        z: bucket.horizontal ? LEGACY_CATWALK_RAIL_THICKNESS_V2 : length,
      }), run.map(({ surfaceId }) => surfaceId));

      const postAxes = [];
      for (let axis = startEndpoint; axis <= endEndpoint + EPSILON; axis += bucket.tileSize * 2) {
        postAxes.push(Math.min(axis, endEndpoint));
      }
      if (Math.abs((postAxes.at(-1) ?? startEndpoint) - endEndpoint) > 0.001) {
        postAxes.push(endEndpoint);
      }
      for (const axis of postAxes) {
        const postCenter = {
          x: bucket.horizontal ? axis : bucket.line,
          y: bucket.elevation + LEGACY_CATWALK_RAIL_HEIGHT_V2 * 0.5,
          z: bucket.horizontal ? bucket.line : axis,
        };
        const postKey = [postCenter.x, postCenter.y, postCenter.z]
          .map((value) => value.toFixed(4))
          .join(':');
        if (railPostKeys.has(postKey)) continue;
        railPostKeys.add(postKey);
        appendPart('rail-post', boxBoundsAt(postCenter, {
          x: LEGACY_CATWALK_RAIL_THICKNESS_V2,
          y: LEGACY_CATWALK_RAIL_HEIGHT_V2,
          z: LEGACY_CATWALK_RAIL_THICKNESS_V2,
        }), run.map(({ surfaceId }) => surfaceId));
      }
      run = [];
    };
    for (const entry of entries) {
      if (run.length && entry.axis - run.at(-1).axis > bucket.tileSize + 0.001) flush();
      run.push(entry);
    }
    flush();
  }

  return { parts, railOpenings, usedParityFallback };
}

/**
 * Compile the solid support masses that Dungeon V1 rendered beneath raised
 * authored floors. The result is plan data only: callers add the fixtures to
 * structuralFixtures and copy each binding onto its exact walkable surface.
 */
export function compileLegacyFixedRoomSupportContractsV2(compiledPlacement, {
  regionId,
  cellId,
  floorBoundaryId,
} = {}) {
  if (!compiledPlacement?.id || !compiledPlacement?.worldBounds
    || !Array.isArray(compiledPlacement.walkableSurfaces)) {
    throw new TypeError('Native support compilation requires a compiled fixed-room placement.');
  }
  if (!regionId || !cellId || !floorBoundaryId) {
    throw new TypeError('Native support compilation requires regionId, cellId, and floorBoundaryId.');
  }
  const baseY = compiledPlacement.worldBounds.min.y;
  const rampDeckClearanceCuts = nativeRampDeckClearanceCuts(compiledPlacement.walkableSurfaces);
  const fixtures = [];
  const surfaceSupportFixtureIds = {};
  const bind = (surface, fixtureId) => {
    surfaceSupportFixtureIds[surface.id] = [
      ...new Set([...(surfaceSupportFixtureIds[surface.id] ?? []), fixtureId]),
    ];
  };
  const rampGroups = new Map();
  for (const surface of compiledPlacement.walkableSurfaces.filter(({ shape }) => shape === 'ramp-tile')) {
    const routeId = surface.ramp?.routeId;
    if (!routeId) throw new Error(`${surface.id} cannot compile native ramp support without a routeId.`);
    const group = rampGroups.get(routeId) ?? [];
    group.push(surface);
    rampGroups.set(routeId, group);
  }
  const raisedFlat = compiledPlacement.walkableSurfaces.filter((surface) => (
    surface.shape !== 'ramp-tile' && surface.bounds.min.y > baseY + 0.5
  ));
  const rampLandings = raisedFlat.filter((surface) => (
    surface.traversalRoute?.routeId
    && rampGroups.has(surface.traversalRoute.routeId)
  ));
  const solidRaised = raisedFlat.filter(({ support }) => support?.style === 'solid_mass');
  const solidGroups = new Map();
  for (const surface of solidRaised) {
    const key = surface.topY.toFixed(4);
    const group = solidGroups.get(key) ?? [];
    group.push(surface);
    solidGroups.set(key, group);
  }
  let deckSequence = 0;
  for (const surfaces of solidGroups.values()) {
    for (const rectangle of contiguousTileRectangles(surfaces)) {
      const footprint = unionWorldBounds(rectangle.surfaces);
      const undersideY = Math.min(...rectangle.surfaces.map((surface) => surface.bounds.min.y));
      if (undersideY <= baseY + 0.05) continue;
      const fixtureId = `fixture.${compiledPlacement.id}.native-deck-mass.${deckSequence += 1}`;
      const bounds = {
        min: { x: footprint.min.x, y: baseY, z: footprint.min.z },
        max: { x: footprint.max.x, y: undersideY, z: footprint.max.z },
      };
      const colliderBounds = rampDeckClearanceCuts.reduce(
        (pieces, cut) => pieces.flatMap((piece) => subtractPlanarBounds(piece, cut)),
        [bounds],
      );
      if (!colliderBounds.length) {
        throw new Error(`${fixtureId} is completely consumed by its authored ramp clearance strip.`);
      }
      const colliderIds = colliderBounds.map((_, index) => (
        `collider.${fixtureId}.part.${index + 1}`
      ));
      fixtures.push({
        id: fixtureId,
        type: 'native-v1-solid-deck-mass',
        regionId,
        cellId,
        bounds,
        gameplayPurpose: 'V1 solidArchitecturalDeckMass support beneath contiguous raised native floor tiles',
        collision: 'blocking',
        supportBoundaryIds: [floorBoundaryId],
        visualId: `visual.${fixtureId}`,
        visualIds: [`visual.${fixtureId}`],
        colliderIds,
        colliderBounds,
        materialProfileId: 'legacy-wall-industrial',
        visualProfile: 'legacy-solid-architectural-deck-mass',
        nativeFixedRoomPlacementId: compiledPlacement.id,
        sourceArchitecture: 'DungeonGenerator.solidArchitecturalDeckMass',
        rampClearanceProfile: {
          mode: 'authored-ramp-strip',
        },
        supportedSurfaceIds: rectangle.surfaces.map(({ id }) => id),
      });
      rectangle.surfaces.forEach((surface) => bind(surface, fixtureId));
    }
  }

  const allSurfaceColumns = new Map();
  for (const surface of compiledPlacement.walkableSurfaces) {
    const key = `${surface.localTile.x}:${surface.localTile.z}`;
    const column = allSurfaceColumns.get(key) ?? [];
    column.push(surface);
    allSurfaceColumns.set(key, column);
  }
  const framedRaised = raisedFlat.filter((surface) => (
    surface.support?.style !== 'solid_mass'
    && !rampLandings.some(({ id }) => id === surface.id)
  ));
  const portalRailOpenings = nativeCatwalkPortalRailOpenings(compiledPlacement);
  let frameSequence = 0;
  for (const component of raisedSurfaceComponents(framedRaised)) {
    const fixtureId = `fixture.${compiledPlacement.id}.native-catwalk-frame.${frameSequence += 1}`;
    const { parts, railOpenings, usedParityFallback } = compileNativeCatwalkFrameParts(
      compiledPlacement,
      component,
      allSurfaceColumns,
      portalRailOpenings,
    );
    if (!parts.length) {
      throw new Error(`${fixtureId} has no visible post, beam, or rail parts.`);
    }
    const colliderBounds = parts.map(({ bounds }) => bounds);
    const colliderIds = parts.map((_, index) => `collider.${fixtureId}.part.${index + 1}`);
    fixtures.push({
      id: fixtureId,
      type: 'native-v1-catwalk-frame',
      regionId,
      cellId,
      bounds: unionWorldBounds(parts),
      gameplayPurpose: 'V1 thin raised deck support frame with authored posts, underbeams, rails, and route openings',
      collision: 'blocking',
      supportBoundaryIds: [floorBoundaryId],
      visualId: `visual.${fixtureId}`,
      visualIds: [`visual.${fixtureId}`],
      colliderIds,
      colliderBounds,
      partRoles: parts.map(({ role }) => role),
      partMaterialProfileIds: parts.map(({ role }) => (
        role.startsWith('rail-') ? 'legacy-rail' : 'legacy-support'
      )),
      partSourceSurfaceIds: parts.map(({ sourceSurfaceIds }) => sourceSurfaceIds),
      materialProfileId: 'legacy-support',
      visualProfile: 'legacy-thin-deck-post-beam-rail-frame',
      nativeFixedRoomPlacementId: compiledPlacement.id,
      sourceArchitecture: 'DungeonGenerator._addFactoryTileSupports+_addFactoryRailRuns',
      supportedSurfaceIds: component.map(({ id }) => id),
      catwalkProfile: {
        deckAuthority: 'native-walkable-surface-0.12m',
        postWidth: LEGACY_CATWALK_POST_WIDTH_V2,
        beamHeight: LEGACY_CATWALK_BEAM_HEIGHT_V2,
        beamWidth: LEGACY_CATWALK_BEAM_WIDTH_V2,
        beamSpanFactor: LEGACY_CATWALK_BEAM_SPAN_FACTOR_V2,
        cornerOffsetFactor: LEGACY_CATWALK_CORNER_OFFSET_FACTOR_V2,
        railHeight: LEGACY_CATWALK_RAIL_HEIGHT_V2,
        railThickness: LEGACY_CATWALK_RAIL_THICKNESS_V2,
        supportCadence: 'abs(tileX+tileZ)%2===0',
        usedParityFallback,
        railOpenings,
      },
    });
    component.forEach((surface) => bind(surface, fixtureId));
  }

  let rampSequence = 0;
  for (const [routeId, unsortedSurfaces] of rampGroups) {
    const surfaces = [...unsortedSurfaces].sort((left, right) => (
      (left.traversalRoute?.sequenceIndex ?? 0) - (right.traversalRoute?.sequenceIndex ?? 0)
    ));
    const landingSurfaces = rampLandings.filter((surface) => (
      surface.traversalRoute?.routeId === routeId
    ));
    const routeDirection = surfaces[0].ramp.direction;
    const routeRunLength = Math.abs(routeDirection.x) > 0.5
      ? surfaces[0].bounds.max.x - surfaces[0].bounds.min.x
      : surfaces[0].bounds.max.z - surfaces[0].bounds.min.z;
    const routeStart = {
      x: surfaces[0].center.x - routeDirection.x * routeRunLength * 0.5,
      y: surfaces[0].ramp.startY,
      z: surfaces[0].center.z - routeDirection.z * routeRunLength * 0.5,
    };
    const routeEnd = {
      x: surfaces.at(-1).center.x + routeDirection.x * routeRunLength * 0.5,
      y: surfaces.at(-1).ramp.endY,
      z: surfaces.at(-1).center.z + routeDirection.z * routeRunLength * 0.5,
    };
    const routeDelta = {
      x: routeEnd.x - routeStart.x,
      z: routeEnd.z - routeStart.z,
    };
    const routeLengthSquared = routeDelta.x * routeDelta.x + routeDelta.z * routeDelta.z;
    if (routeLengthSquared <= EPSILON) {
      throw new Error(`${routeId} cannot compile a zero-length aggregate native ramp path.`);
    }
    const aggregateRampY = (point) => {
      const progress = Math.max(0, Math.min(1, (
        (point.x - routeStart.x) * routeDelta.x + (point.z - routeStart.z) * routeDelta.z
      ) / routeLengthSquared));
      return routeStart.y + (routeEnd.y - routeStart.y) * progress;
    };
    const fixtureId = `fixture.${compiledPlacement.id}.native-ramp-support.${rampSequence += 1}`;
    const colliderBounds = [];
    const colliderIds = [];
    const stringers = [];
    for (const [surfaceIndex, surface] of surfaces.entries()) {
      const surfaceRunLength = Math.abs(routeDirection.x) > 0.5
        ? surface.bounds.max.x - surface.bounds.min.x
        : surface.bounds.max.z - surface.bounds.min.z;
      const aggregateSurfaceStart = {
        x: surface.center.x - routeDirection.x * surfaceRunLength * 0.5,
        z: surface.center.z - routeDirection.z * surfaceRunLength * 0.5,
      };
      const undersideY = Math.min(
        Math.min(surface.ramp.startY, surface.ramp.endY),
        aggregateRampY(aggregateSurfaceStart),
      ) - surface.size.y;
      if (undersideY > baseY + 0.05) {
        const alongX = Math.abs(routeDirection.x) > 0.5;
        const crossWidth = alongX
          ? surface.bounds.max.z - surface.bounds.min.z
          : surface.bounds.max.x - surface.bounds.min.x;
        const sideWidth = Math.min(0.22, crossWidth * 0.16);
        const sideFoundations = alongX
          ? [
              {
                min: { x: surface.bounds.min.x, y: baseY, z: surface.bounds.min.z },
                max: { x: surface.bounds.max.x, y: undersideY, z: surface.bounds.min.z + sideWidth },
              },
              {
                min: { x: surface.bounds.min.x, y: baseY, z: surface.bounds.max.z - sideWidth },
                max: { x: surface.bounds.max.x, y: undersideY, z: surface.bounds.max.z },
              },
            ]
          : [
              {
                min: { x: surface.bounds.min.x, y: baseY, z: surface.bounds.min.z },
                max: { x: surface.bounds.min.x + sideWidth, y: undersideY, z: surface.bounds.max.z },
              },
              {
                min: { x: surface.bounds.max.x - sideWidth, y: baseY, z: surface.bounds.min.z },
                max: { x: surface.bounds.max.x, y: undersideY, z: surface.bounds.max.z },
              },
            ];
        for (const [sideIndex, bounds] of sideFoundations.entries()) {
          colliderBounds.push(bounds);
          colliderIds.push(
            `collider.${fixtureId}.foundation-side.${surfaceIndex + 1}.${sideIndex === 0 ? 'left' : 'right'}`,
          );
        }
      }
      const direction = surface.ramp.direction;
      const runLength = Math.abs(direction.x) > 0.5 ? surface.size.x : surface.size.z;
      const crossWidth = Math.abs(direction.x) > 0.5 ? surface.size.z : surface.size.x;
      const tangent = { x: -direction.z, z: direction.x };
      const lateralOffset = Math.max(0.25, crossWidth * 0.36);
      for (const side of [-1, 1]) {
        const offsetX = tangent.x * lateralOffset * side;
        const offsetZ = tangent.z * lateralOffset * side;
        stringers.push({
          id: `stringer.${surfaceIndex + 1}.${side < 0 ? 'left' : 'right'}`,
          start: {
            x: surface.center.x - direction.x * runLength * 0.5 + offsetX,
            y: surface.ramp.startY - surface.size.y - 0.1,
            z: surface.center.z - direction.z * runLength * 0.5 + offsetZ,
          },
          end: {
            x: surface.center.x + direction.x * runLength * 0.5 + offsetX,
            y: surface.ramp.endY - surface.size.y - 0.1,
            z: surface.center.z + direction.z * runLength * 0.5 + offsetZ,
          },
          width: 0.18,
          height: 0.2,
        });
      }
      bind(surface, fixtureId);
    }
    landingSurfaces.forEach((surface) => bind(surface, fixtureId));
    const massRecords = colliderBounds.map((bounds) => ({ bounds }));
    const bounds = massRecords.length
      ? unionWorldBounds(massRecords)
      : unionWorldBounds(surfaces);
    fixtures.push({
      id: fixtureId,
      type: 'native-v1-ramp-support',
      regionId,
      cellId,
      bounds,
      gameplayPurpose: 'V1 contiguous industrial ramp foundation and paired visible stringers',
      collision: 'blocking',
      supportBoundaryIds: [floorBoundaryId],
      visualId: `visual.${fixtureId}`,
      visualIds: [`visual.${fixtureId}`],
      colliderIds,
      colliderBounds,
      materialProfileId: 'legacy-wall-industrial',
      visualProfile: 'legacy-contiguous-industrial-ramp-support',
      nativeFixedRoomPlacementId: compiledPlacement.id,
      sourceArchitecture: 'DungeonGenerator.contiguousIndustrialRampRun',
      foundationProfile: 'paired-edge-foundations-outside-player-lane',
      rampRouteId: routeId,
      supportedSurfaceIds: [...surfaces, ...landingSurfaces].map(({ id }) => id),
      stringers,
    });
  }
  return deepFreezePlan({ fixtures, surfaceSupportFixtureIds });
}

export function createLegacyFixedRoomPlanPlacementRecordV2(compiledPlacement, {
  semanticRegionIds = [],
} = {}) {
  if (!compiledPlacement?.structuralContractSignature || !compiledPlacement?.placedRecordIds) {
    throw new TypeError('A compiled fixed-room placement bundle is required.');
  }
  return deepFreezePlan({
    id: compiledPlacement.id,
    descriptorId: compiledPlacement.descriptorId,
    descriptorRevision: compiledPlacement.descriptorRevision,
    semanticRegionIds: [...semanticRegionIds],
    presentationProfileId: compiledPlacement.presentationProfileId,
    structuralContractId: compiledPlacement.structuralContractId,
    structuralContractSignature: compiledPlacement.structuralContractSignature,
    transform: compiledPlacement.transform,
    worldBounds: compiledPlacement.worldBounds,
    localOpenSocketIds: compiledPlacement.localOpenSocketIds,
    presentation: compiledPlacement.presentation,
    openSocketIds: compiledPlacement.openSocketIds,
    placedRecordIds: compiledPlacement.placedRecordIds,
  });
}

function exactPlacementField(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Accepted legacy fixed-room placement mismatch at ${label}.`);
  }
}

/**
 * Recompile only immutable catalog data at assembly time and prove it is byte-
 * equivalent to the accepted plan records. This avoids storing a duplicate
 * copy of thousands of local tiles in every placement while keeping assembly
 * incapable of inventing sockets, collision, or presentation ownership.
 */
export function recompileAcceptedLegacyFixedRoomPlacementV2(acceptedPlacement) {
  if (!acceptedPlacement || typeof acceptedPlacement !== 'object') {
    throw new TypeError('An accepted legacy fixed-room placement record is required.');
  }
  if (acceptedPlacement.presentationProfileId !== 'legacy-fixed-room-native-v2') {
    throw new Error(`Unsupported fixed-room presentation profile ${acceptedPlacement.presentationProfileId ?? '<missing>'}.`);
  }
  const module = getLegacyFixedRoomModuleV2(acceptedPlacement.descriptorId);
  if (!module || module.revision !== acceptedPlacement.descriptorRevision) {
    throw new Error(`Accepted placement ${acceptedPlacement.id ?? '<unknown>'} references a missing or stale fixed-room descriptor.`);
  }
  const structuralContract = compileLegacyFixedRoomStructuralContractV2(module, {
    openSocketIds: acceptedPlacement.localOpenSocketIds,
  });
  if (structuralContract.id !== acceptedPlacement.structuralContractId) {
    throw new Error(`Accepted placement ${acceptedPlacement.id} has a mismatched structural contract ID.`);
  }
  const expected = compileLegacyFixedRoomPlacementV2(module, {
    id: acceptedPlacement.id,
    translation: acceptedPlacement.transform?.translation,
    yawQuarterTurns: acceptedPlacement.transform?.yawQuarterTurns,
    structuralContract,
  });
  for (const field of [
    'structuralContractSignature',
    'worldBounds',
    'openSocketIds',
    'placedRecordIds',
    'presentation',
  ]) {
    exactPlacementField(acceptedPlacement[field], expected[field], field);
  }
  return Object.freeze({ module, structuralContract, expectedPlacement: expected });
}

function geometryKey(shape, parameters = {}) {
  return `${shape}:${JSON.stringify(parameters)}`;
}

function matrixFromTransform({ position, rotation = {}, scale = { x: 1, y: 1, z: 1 } }) {
  const object = new THREE.Object3D();
  object.position.set(position.x, position.y, position.z);
  object.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
  object.scale.set(scale.x ?? 1, scale.y ?? 1, scale.z ?? 1);
  object.updateMatrix();
  return object.matrix.clone();
}

function transformedBox(box, matrix) {
  return box.clone().applyMatrix4(matrix);
}

function splitLocalBoundaryAroundOpenings(boundary) {
  const normalized = boundsFromCenterHalfSize(
    boundary.localBounds.center,
    boundary.localBounds.halfSize,
  );
  const openings = (boundary.openings ?? []).filter(({ declarationOnly }) => declarationOnly !== true);
  if (!openings.length) return [{ id: boundary.id, bounds: normalized }];
  if (!['floor', 'ceiling'].includes(boundary.side)) {
    throw new Error(`${boundary.id} declares openings after its wall panels were already segmented.`);
  }
  const xCuts = uniqueSorted([
    normalized.min.x,
    normalized.max.x,
    ...openings.flatMap((opening) => [
      opening.center.x - opening.dimensions.width * 0.5,
      opening.center.x + opening.dimensions.width * 0.5,
    ]),
  ].map((value) => Math.max(normalized.min.x, Math.min(normalized.max.x, value))));
  const zCuts = uniqueSorted([
    normalized.min.z,
    normalized.max.z,
    ...openings.flatMap((opening) => [
      opening.center.z - opening.dimensions.depth * 0.5,
      opening.center.z + opening.dimensions.depth * 0.5,
    ]),
  ].map((value) => Math.max(normalized.min.z, Math.min(normalized.max.z, value))));
  const pieces = [];
  for (let xIndex = 0; xIndex < xCuts.length - 1; xIndex += 1) {
    for (let zIndex = 0; zIndex < zCuts.length - 1; zIndex += 1) {
      const minX = xCuts[xIndex];
      const maxX = xCuts[xIndex + 1];
      const minZ = zCuts[zIndex];
      const maxZ = zCuts[zIndex + 1];
      if (maxX - minX <= EPSILON || maxZ - minZ <= EPSILON) continue;
      const centerX = (minX + maxX) * 0.5;
      const centerZ = (minZ + maxZ) * 0.5;
      const removed = openings.some((opening) => (
        centerX > opening.center.x - opening.dimensions.width * 0.5 + EPSILON
        && centerX < opening.center.x + opening.dimensions.width * 0.5 - EPSILON
        && centerZ > opening.center.z - opening.dimensions.depth * 0.5 + EPSILON
        && centerZ < opening.center.z + opening.dimensions.depth * 0.5 - EPSILON
      ));
      if (removed) continue;
      pieces.push({
        id: `${boundary.id}.segment.${pieces.length + 1}`,
        bounds: boundsFromCenterHalfSize({
          x: centerX,
          y: normalized.center.y,
          z: centerZ,
        }, {
          x: (maxX - minX) * 0.5,
          y: normalized.halfSize.y,
          z: (maxZ - minZ) * 0.5,
        }),
      });
    }
  }
  if (!pieces.length) throw new Error(`${boundary.id} openings remove its complete structural face.`);
  return pieces;
}

function box3MaximumFaceDifference(actual, expected) {
  return Math.max(
    Math.abs(actual.min.x - expected.min.x),
    Math.abs(actual.min.y - expected.min.y),
    Math.abs(actual.min.z - expected.min.z),
    Math.abs(actual.max.x - expected.max.x),
    Math.abs(actual.max.y - expected.max.y),
    Math.abs(actual.max.z - expected.max.z),
  );
}

function prefabComponents(prefab) {
  const components = [];
  const appendBox = (primitive, id, center, size) => {
    components.push({
      id,
      shape: 'box',
      dimensions: { x: size[0], y: size[1], z: size[2] },
      center: { x: center[0], y: center[1], z: center[2] },
      rotation: primitive.rotation ?? { x: 0, y: primitive.yaw ?? 0, z: 0 },
      materialProfileId: primitive.materialProfileId,
      castShadow: primitive.castShadow !== false,
      receiveShadow: primitive.receiveShadow !== false,
    });
  };
  for (const primitive of prefab.primitives) {
    if (primitive.shape === 'i-beam' || primitive.shape === 'i-beam-horizontal') {
      const horizontal = primitive.shape === 'i-beam-horizontal';
      const { length, web, flange } = primitive.dimensions;
      const pieces = horizontal
        ? [
          [[0, 0, 0], [length, web, web]],
          [[0, flange * 0.5, 0], [length, web, flange]],
          [[0, -flange * 0.5, 0], [length, web, flange]],
        ]
        : [
          [[0, 0, 0], [web, length, web]],
          [[flange * 0.5, 0, 0], [web, length, flange]],
          [[-flange * 0.5, 0, 0], [web, length, flange]],
        ];
      for (const [index, [pieceCenter, pieceSize]] of pieces.entries()) {
        appendBox(
          primitive,
          `${primitive.id}.piece-${index + 1}`,
          [
            primitive.center.x + pieceCenter[0],
            primitive.center.y + pieceCenter[1],
            primitive.center.z + pieceCenter[2],
          ],
          pieceSize,
        );
      }
      continue;
    }
    components.push({ ...primitive });
  }
  return components;
}

function authoredGirderFrameComponents({ width, height }) {
  const frameWidth = finite(width, 'girder sourceArguments.width');
  const frameHeight = finite(height, 'girder sourceArguments.height');
  if (frameWidth <= 0 || frameHeight <= 0) {
    throw new RangeError('Girder source arguments must be positive.');
  }
  return [
    {
      id: 'left-column',
      shape: 'i-beam',
      center: { x: -frameWidth * 0.5, y: frameHeight * 0.5, z: 0 },
      dimensions: { length: frameHeight, web: 0.18, flange: 0.56 },
      materialProfileId: 'legacy-support',
      castShadow: false,
    },
    {
      id: 'right-column',
      shape: 'i-beam',
      center: { x: frameWidth * 0.5, y: frameHeight * 0.5, z: 0 },
      dimensions: { length: frameHeight, web: 0.18, flange: 0.56 },
      materialProfileId: 'legacy-support',
      castShadow: false,
    },
    {
      id: 'header',
      shape: 'i-beam-horizontal',
      center: { x: 0, y: frameHeight, z: 0 },
      dimensions: { length: frameWidth, web: 0.18, flange: 0.56 },
      materialProfileId: 'legacy-support',
      castShadow: false,
    },
    {
      id: 'brace-west',
      shape: 'box',
      center: { x: 0, y: frameHeight * 0.6, z: -0.18 },
      dimensions: { x: frameWidth * 0.56, y: 0.12, z: 0.16 },
      rotation: { x: 0, y: 0, z: -0.58 },
      materialProfileId: 'legacy-hazard-stripe',
      castShadow: false,
    },
    {
      id: 'brace-east',
      shape: 'box',
      center: { x: 0, y: frameHeight * 0.6, z: 0.18 },
      dimensions: { x: frameWidth * 0.56, y: 0.12, z: 0.16 },
      rotation: { x: 0, y: 0, z: 0.58 },
      materialProfileId: 'legacy-hazard-stripe',
      castShadow: false,
    },
  ];
}

function authoredCylinderArchComponents({ width, height }) {
  const archWidth = finite(width, 'arch sourceArguments.width');
  const archHeight = finite(height, 'arch sourceArguments.height');
  if (archWidth <= 0 || archHeight <= archWidth * 0.5) {
    throw new RangeError('Cylinder-arch source arguments require positive width and room for its columns.');
  }
  const columnHeight = archHeight - archWidth * 0.5;
  return [
    ...[-1, 1].flatMap((sign) => [
      {
        id: `${sign < 0 ? 'west' : 'east'}-column`,
        shape: 'cylinder',
        center: { x: sign * archWidth * 0.5, y: columnHeight * 0.5, z: 0 },
        dimensions: { radiusTop: 0.28, radiusBottom: 0.42, height: columnHeight, radialSegments: 14 },
        materialProfileId: 'legacy-raised-deck',
      },
      {
        id: `${sign < 0 ? 'west' : 'east'}-foot`,
        shape: 'box',
        center: { x: sign * archWidth * 0.5, y: 0.12, z: 0 },
        dimensions: { x: 0.92, y: 0.24, z: 0.92 },
        materialProfileId: 'legacy-support',
      },
    ]),
    {
      id: 'cylinder-arch',
      shape: 'torus',
      center: { x: 0, y: columnHeight, z: 0 },
      dimensions: { radius: archWidth * 0.5, tube: 0.28, radialSegments: 10, tubularSegments: 32, arc: Math.PI },
      materialProfileId: 'legacy-raised-deck',
    },
    {
      id: 'arch-glow-channel',
      shape: 'torus',
      center: { x: 0, y: columnHeight, z: 0.01 },
      dimensions: { radius: archWidth * 0.5 - 0.38, tube: 0.06, radialSegments: 8, tubularSegments: 28, arc: Math.PI },
      materialProfileId: 'legacy-glow-blue',
      castShadow: false,
    },
  ];
}

function recipeArgument(args, key, fallback, { positive = false } = {}) {
  const value = args?.[key] ?? fallback;
  const normalized = finite(value, `native recipe argument ${key}`);
  if (positive && normalized <= 0) {
    throw new RangeError(`Native recipe argument ${key} must be positive.`);
  }
  return normalized;
}

function recipeMaterial(args, key, fallback) {
  const value = args?.[key] ?? fallback;
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Native recipe material argument ${key} must be a stable material profile id.`);
  }
  return value;
}

function nativeSecurityScannerArchComponents(args = {}) {
  const width = recipeArgument(args, 'width', 1.8, { positive: true });
  const height = recipeArgument(args, 'height', 2.1, { positive: true });
  const depth = recipeArgument(args, 'depth', 0.15, { positive: true });
  return [
    ...[-1, 1].map((sign) => ({
      id: `${sign < 0 ? 'west' : 'east'}-scanner-post`,
      shape: 'cylinder',
      center: { x: sign * width * 0.5, y: height * 0.5, z: 0 },
      dimensions: {
        radiusTop: 0.08,
        radiusBottom: 0.08 * 1.18,
        height,
        radialSegments: 16,
      },
      materialProfileId: 'legacy-support',
    })),
    {
      id: 'scanner-header',
      shape: 'box',
      center: { x: 0, y: height + 0.02, z: 0 },
      dimensions: { x: width + 0.3, y: 0.12, z: depth },
      materialProfileId: 'legacy-glow-blue',
    },
  ];
}

function nativeChainLinkFenceComponents(args = {}) {
  const width = recipeArgument(args, 'width', 5.4, { positive: true });
  const height = recipeArgument(args, 'height', 2.7, { positive: true });
  const verticalWireCount = Math.max(4, Math.ceil(width / 0.42));
  const horizontalWireCount = Math.max(3, Math.ceil(height / 0.42));
  const components = [
    {
      id: 'chain-link-top-rail',
      shape: 'box',
      center: { x: 0, y: height, z: 0 },
      dimensions: { x: width, y: 0.1, z: 0.1 },
      materialProfileId: 'legacy-rail',
    },
  ];
  for (const x of [-width * 0.5, 0, width * 0.5]) {
    components.push({
      id: `chain-link-post-${x.toFixed(4)}`,
      shape: 'cylinder',
      center: { x, y: (height + 0.28) * 0.5, z: 0 },
      dimensions: {
        radiusTop: 0.08,
        radiusBottom: 0.1,
        height: height + 0.28,
        radialSegments: 10,
      },
      materialProfileId: 'legacy-rail',
    });
  }
  // The V1 source used a wireframe PlaneGeometry. A thin open grid preserves
  // that readable fence silhouette without a solid opaque panel.
  for (let index = 1; index < verticalWireCount; index += 1) {
    components.push({
      id: `chain-link-vertical-wire-${index}`,
      shape: 'box',
      center: { x: -width * 0.5 + index * (width / verticalWireCount), y: height * 0.5, z: 0 },
      dimensions: { x: 0.018, y: height, z: 0.018 },
      materialProfileId: 'legacy-rail',
      castShadow: false,
    });
  }
  for (let index = 1; index < horizontalWireCount; index += 1) {
    components.push({
      id: `chain-link-horizontal-wire-${index}`,
      shape: 'box',
      center: { x: 0, y: index * (height / horizontalWireCount), z: 0 },
      dimensions: { x: width, y: 0.018, z: 0.018 },
      materialProfileId: 'legacy-rail',
      castShadow: false,
    });
  }
  return components;
}

function nativeIndustrialEngineComponents(args = {}) {
  const accent = recipeMaterial(args, 'accentMaterialProfileId', 'legacy-glow-red');
  const components = [
    {
      id: 'engine-foundation',
      shape: 'box',
      center: { x: 0, y: 0.21, z: 0 },
      dimensions: { x: 5.6, y: 0.42, z: 3.4 },
      materialProfileId: 'legacy-support',
    },
    {
      id: 'engine-main-crankcase',
      shape: 'box',
      center: { x: 0, y: 1.08, z: 0 },
      dimensions: { x: 4.7, y: 1.72, z: 2.65 },
      materialProfileId: 'legacy-machine-floor',
    },
    {
      id: 'engine-control-manifold',
      shape: 'box',
      center: { x: 0, y: 1.65, z: -1.55 },
      dimensions: { x: 2.1, y: 0.58, z: 0.42 },
      materialProfileId: 'legacy-terminal',
    },
    {
      id: 'engine-heartbeat-core',
      shape: 'octahedron',
      center: { x: 0, y: 1.68, z: -1.82 },
      dimensions: { radius: 0.26 },
      materialProfileId: accent,
    },
  ];
  for (const x of [-1.55, -0.52, 0.52, 1.55]) {
    components.push(
      {
        id: `engine-cylinder-${x}`,
        shape: 'cylinder',
        center: { x, y: 2.48, z: 0 },
        dimensions: { radiusTop: 0.38, radiusBottom: 0.48, height: 1.62, radialSegments: 18 },
        materialProfileId: 'legacy-wall-industrial',
      },
      {
        id: `engine-exhaust-${x}`,
        shape: 'cylinder',
        center: { x, y: 3.82, z: -0.48 },
        dimensions: { radiusTop: 0.16, radiusBottom: 0.24, height: 1.2, radialSegments: 16 },
        materialProfileId: 'legacy-rail',
      },
    );
  }
  for (const x of [-2.42, 2.42]) {
    components.push({
      id: `engine-flywheel-${x}`,
      shape: 'torus',
      center: { x, y: 1.42, z: 0 },
      dimensions: { radius: 1.05, tube: 0.16, radialSegments: 10, tubularSegments: 36 },
      rotation: { x: 0, y: Math.PI * 0.5, z: 0 },
      materialProfileId: 'legacy-hazard-stripe',
    });
  }
  return components;
}

function nativeServerEnergyCoreComponents() {
  return [
    {
      id: 'server-octagonal-base',
      shape: 'box',
      center: { x: 0, y: 0.08, z: 0 },
      dimensions: { x: 2.15, y: 0.16, z: 2.15 },
      rotation: { x: 0, y: Math.PI * 0.25, z: 0 },
      materialProfileId: 'legacy-server-floor',
      castShadow: false,
    },
    {
      id: 'server-energy-column',
      shape: 'cylinder',
      center: { x: 0, y: 1.3, z: 0 },
      dimensions: { radiusTop: 0.18, radiusBottom: 0.18 * 1.18, height: 2.6, radialSegments: 16 },
      materialProfileId: 'legacy-glow-blue',
      castShadow: false,
    },
    {
      id: 'server-memory-crystal',
      shape: 'octahedron',
      center: { x: 0, y: 2.85, z: 0 },
      dimensions: { radius: 0.42 },
      materialProfileId: 'legacy-large-refractor',
      castShadow: false,
    },
  ];
}

function nativeServerEntryConsoleComponents(args = {}) {
  const screenOffsetZ = recipeArgument(args, 'screenOffsetZ', -0.28);
  return [
    {
      id: 'server-console-base',
      shape: 'box',
      center: { x: 0, y: 0.37, z: 0 },
      dimensions: { x: 1.12, y: 0.74, z: 0.5 },
      materialProfileId: 'legacy-terminal',
    },
    {
      id: 'server-console-screen',
      shape: 'box',
      center: { x: 0, y: 0.92, z: screenOffsetZ },
      dimensions: { x: 0.82, y: 0.08, z: 0.08 },
      materialProfileId: 'legacy-glow-blue',
    },
    {
      id: 'server-console-button',
      shape: 'octahedron',
      center: { x: 0.38, y: 0.94, z: screenOffsetZ + 0.02 },
      dimensions: { radius: 0.07 },
      materialProfileId: 'legacy-glow-red',
    },
  ];
}

function nativeMachinePressComponents() {
  return [
    ...[-1, 1].map((sign) => ({
      id: `${sign < 0 ? 'west' : 'east'}-press-leg`,
      shape: 'box',
      center: { x: sign * 1.15, y: 0.725, z: 0 },
      dimensions: { x: 0.18, y: 1.45, z: 0.32 },
      materialProfileId: 'legacy-support',
    })),
    {
      id: 'press-top-housing',
      shape: 'box',
      center: { x: 0, y: 1.78, z: 0 },
      dimensions: { x: 3.15, y: 0.5, z: 0.76 },
      materialProfileId: 'legacy-wall-industrial',
    },
    {
      id: 'press-plate',
      shape: 'box',
      center: { x: 0, y: 1.1, z: 0 },
      dimensions: { x: 2.55, y: 0.16, z: 0.7 },
      materialProfileId: 'legacy-hazard-stripe',
    },
    {
      id: 'press-hydraulic-piston',
      shape: 'cylinder',
      center: { x: 0, y: 1.48, z: 0 },
      dimensions: { radiusTop: 0.1, radiusBottom: 0.118, height: 0.78, radialSegments: 16 },
      materialProfileId: 'legacy-support',
    },
    ...[-1, 1].map((sign) => ({
      id: `${sign < 0 ? 'west' : 'east'}-press-status`,
      shape: 'octahedron',
      center: { x: sign * 1.04, y: 2.1, z: -0.34 },
      dimensions: { radius: 0.08 },
      materialProfileId: 'legacy-glow-red',
    })),
  ];
}

function nativeMachinePressLegComponents() {
  return [{
    id: 'press-leg',
    shape: 'box',
    center: { x: 0, y: 0.725, z: 0 },
    dimensions: { x: 0.18, y: 1.45, z: 0.32 },
    materialProfileId: 'legacy-support',
  }];
}

function nativeMachineRobotArmComponents(args = {}) {
  const direction = Math.sign(recipeArgument(args, 'direction', 1)) || 1;
  const zSign = Math.sign(recipeArgument(args, 'zSign', args.zDirection ?? 1)) || 1;
  return [
    {
      id: 'robot-arm-base-column',
      shape: 'cylinder',
      center: { x: 0, y: 0.41, z: 0 },
      dimensions: { radiusTop: 0.13, radiusBottom: 0.13 * 1.18, height: 0.82, radialSegments: 16 },
      materialProfileId: 'legacy-support',
    },
    {
      id: 'robot-arm-shoulder',
      shape: 'octahedron',
      center: { x: 0, y: 1, z: 0 },
      dimensions: { radius: 0.1 },
      materialProfileId: 'legacy-glow-blue',
    },
    {
      id: 'robot-upper-arm',
      shape: 'box',
      center: { x: direction * 0.36, y: 1.12, z: 0 },
      dimensions: { x: 0.78, y: 0.1, z: 0.12 },
      rotation: { x: 0, y: 0, z: direction * 0.28 },
      materialProfileId: 'legacy-support',
    },
    {
      id: 'robot-lower-arm',
      shape: 'box',
      center: { x: direction * 0.84, y: 1, z: zSign * 0.18 },
      dimensions: { x: 0.7, y: 0.09, z: 0.1 },
      rotation: { x: 0, y: 0, z: -direction * 0.36 },
      materialProfileId: 'legacy-hazard-stripe',
    },
    {
      id: 'robot-wrist',
      shape: 'octahedron',
      center: { x: direction * 1.18, y: 0.94, z: zSign * 0.28 },
      dimensions: { radius: 0.08 },
      materialProfileId: 'legacy-glow-red',
    },
  ];
}

function nativeCoolantMachineBaseComponents() {
  return [{
    id: 'coolant-pressure-core-base',
    shape: 'cylinder',
    center: { x: 0, y: 0.17, z: 0 },
    dimensions: { radiusTop: 0.62, radiusBottom: 0.62 * 1.18, height: 0.34, radialSegments: 16 },
    materialProfileId: 'legacy-support',
  }];
}

function nativeCoolantPressureCoreComponents() {
  return [
    {
      id: 'coolant-glass-pressure-chamber',
      shape: 'cylinder',
      center: { x: 0, y: 0.9, z: 0 },
      dimensions: { radiusTop: 0.42, radiusBottom: 0.42 * 1.18, height: 1.8, radialSegments: 16 },
      materialProfileId: 'legacy-large-refractor',
    },
    {
      id: 'coolant-central-regulator-crystal',
      shape: 'octahedron',
      center: { x: 0, y: 2.08, z: 0 },
      dimensions: { radius: 0.32 },
      materialProfileId: 'legacy-glow-green',
    },
  ];
}

function nativeCoolantSourceTankComponents(args = {}) {
  const accent = recipeMaterial(args, 'accentMaterialProfileId', 'legacy-glow-blue');
  return [
    {
      id: 'coolant-source-tank-glass',
      shape: 'cylinder',
      center: { x: 0, y: 0.71, z: 0 },
      dimensions: { radiusTop: 0.34, radiusBottom: 0.34 * 1.18, height: 1.42, radialSegments: 16 },
      materialProfileId: accent,
    },
    {
      id: 'coolant-source-tank-top-cap',
      shape: 'box',
      center: { x: 0, y: 1.5, z: 0 },
      dimensions: { x: 0.82, y: 0.14, z: 0.82 },
      materialProfileId: 'legacy-support',
    },
    {
      id: 'coolant-source-tank-bottom-cap',
      shape: 'box',
      center: { x: 0, y: 0.08, z: 0 },
      dimensions: { x: 0.78, y: 0.12, z: 0.78 },
      materialProfileId: 'legacy-support',
    },
    {
      id: 'coolant-source-tank-status',
      shape: 'octahedron',
      center: { x: 0, y: 1.58, z: -0.38 },
      dimensions: { radius: 0.08 },
      materialProfileId: accent,
    },
  ];
}

function nativeCoolantOverflowTankComponents() {
  return [{
    id: 'coolant-overflow-waste-tank',
    shape: 'cylinder',
    center: { x: 0, y: 0.64, z: 0 },
    dimensions: { radiusTop: 0.32, radiusBottom: 0.32 * 1.18, height: 1.28, radialSegments: 16 },
    materialProfileId: 'legacy-glow-green',
  }];
}

function nativeCoolantValvePylonComponents(args = {}) {
  return [
    {
      id: 'coolant-valve-base',
      shape: 'cylinder',
      center: { x: 0, y: 0.36, z: 0 },
      dimensions: { radiusTop: 0.26, radiusBottom: 0.26 * 1.18, height: 0.72, radialSegments: 16 },
      materialProfileId: 'legacy-wall-industrial',
    },
    {
      id: 'coolant-valve-tower',
      shape: 'cylinder',
      center: { x: 0, y: 0.74, z: 0 },
      dimensions: { radiusTop: 0.16, radiusBottom: 0.16 * 1.18, height: 1.48, radialSegments: 16 },
      materialProfileId: 'legacy-support',
    },
  ];
}

function nativeCoolantValveTerminalComponents(args = {}) {
  const accent = recipeMaterial(args, 'accentMaterialProfileId', 'legacy-glow-blue');
  return [
    {
      id: 'coolant-terminal-base',
      shape: 'box',
      center: { x: 0, y: 0.31, z: 0 },
      dimensions: { x: 0.76, y: 0.62, z: 0.44 },
      materialProfileId: 'legacy-terminal',
    },
    {
      id: 'coolant-terminal-screen',
      shape: 'box',
      center: { x: 0, y: 0.78, z: -0.24 },
      dimensions: { x: 0.54, y: 0.08, z: 0.08 },
      materialProfileId: accent,
    },
    {
      id: 'coolant-terminal-button',
      shape: 'octahedron',
      center: { x: 0.28, y: 0.88, z: -0.18 },
      dimensions: { radius: 0.06 },
      materialProfileId: 'legacy-glow-red',
    },
  ];
}

function nativeCoolantMasterConsoleComponents() {
  return [
    {
      id: 'coolant-master-console-base',
      shape: 'box',
      center: { x: 0, y: 0.36, z: 0 },
      dimensions: { x: 1.18, y: 0.72, z: 0.52 },
      materialProfileId: 'legacy-terminal',
    },
    {
      id: 'coolant-master-console-screen',
      shape: 'box',
      center: { x: 0, y: 0.78, z: -0.3 },
      dimensions: { x: 0.82, y: 0.08, z: 0.08 },
      materialProfileId: 'legacy-glow-green',
    },
  ];
}

const NATIVE_FIXED_RECIPE_BUILDERS = new Map([
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.securityScannerArch, nativeSecurityScannerArchComponents],
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.chainLinkSecurityFence, nativeChainLinkFenceComponents],
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.industrialEngine, nativeIndustrialEngineComponents],
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.serverEnergyCore, nativeServerEnergyCoreComponents],
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.serverEntryConsole, nativeServerEntryConsoleComponents],
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.machinePress, nativeMachinePressComponents],
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.machinePressLeg, nativeMachinePressLegComponents],
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.machineRobotArm, nativeMachineRobotArmComponents],
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.coolantMachineBase, nativeCoolantMachineBaseComponents],
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.coolantPressureCore, nativeCoolantPressureCoreComponents],
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.coolantSourceTank, nativeCoolantSourceTankComponents],
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.coolantOverflowTank, nativeCoolantOverflowTankComponents],
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.coolantValvePylon, nativeCoolantValvePylonComponents],
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.coolantValveTerminal, nativeCoolantValveTerminalComponents],
  [LEGACY_FIXED_ROOM_NATIVE_RECIPE_IDS_V2.coolantMasterConsole, nativeCoolantMasterConsoleComponents],
]);

export function getLegacyFixedRoomNativeRecipeV2(recipeId, sourceArguments = {}) {
  const buildComponents = NATIVE_FIXED_RECIPE_BUILDERS.get(recipeId);
  if (!buildComponents) return null;
  return deepFreezePlan({
    id: recipeId,
    source: 'dungeon-v1',
    scalePolicy: 'source-authored-uniform-only',
    components: buildComponents(sourceArguments),
  });
}

export class LegacyFixedRoomRuntimeAdapterV2 {
  constructor({
    materialKit = null,
    loadBrowserTextures = typeof document !== 'undefined' && typeof Image !== 'undefined',
    textureLoader = null,
    drawCallBudget = LEGACY_FIXED_ROOM_DEFAULT_DRAW_CALL_BUDGET_V2,
  } = {}) {
    this.materialKit = materialKit ?? createLegacyAuthoredRuntimeKitV2({ loadBrowserTextures, textureLoader });
    this.ownsMaterialKit = materialKit == null;
    this.drawCallBudget = drawCallBudget;
    this.geometries = new Map();
    this.generatedGeometries = new Set();
    this.worldTiledMaterials = new Map();
    this.worldTiledUvRangeMaterials = new Map();
    this.disposed = false;
  }

  _assertActive() {
    if (this.disposed) throw new Error('LegacyFixedRoomRuntimeAdapterV2 has been disposed.');
  }

  _worldTiledMaterial(baseMaterial) {
    if (!baseMaterial?.map) return baseMaterial;
    const key = baseMaterial.uuid;
    if (!this.worldTiledMaterials.has(key)) {
      this.worldTiledMaterials.set(key, createInstancedWorldTiledMaterial(baseMaterial));
    }
    return this.worldTiledMaterials.get(key);
  }

  _worldTiledUvRangeMaterial(baseMaterial) {
    if (!baseMaterial?.map) return baseMaterial;
    const key = baseMaterial.uuid;
    if (!this.worldTiledUvRangeMaterials.has(key)) {
      this.worldTiledUvRangeMaterials.set(key, createInstancedWorldTiledUvRangeMaterial(baseMaterial));
    }
    return this.worldTiledUvRangeMaterials.get(key);
  }

  _geometry(shape, dimensions = {}) {
    let key;
    let geometry;
    if (shape === 'box') {
      key = geometryKey('unit-box');
      geometry = this.geometries.get(key) ?? new THREE.BoxGeometry(1, 1, 1);
    } else if (shape === 'cylinder' || shape === 'open-cylinder') {
      const maxRadius = Math.max(dimensions.radiusTop, dimensions.radiusBottom);
      const ratios = {
        top: dimensions.radiusTop / maxRadius,
        bottom: dimensions.radiusBottom / maxRadius,
        segments: dimensions.radialSegments ?? 16,
        open: shape === 'open-cylinder',
      };
      key = geometryKey('unit-cylinder', ratios);
      geometry = this.geometries.get(key) ?? new THREE.CylinderGeometry(
        ratios.top,
        ratios.bottom,
        1,
        ratios.segments,
        1,
        ratios.open,
      );
    } else if (shape === 'octahedron') {
      key = geometryKey('unit-octahedron');
      geometry = this.geometries.get(key) ?? new THREE.OctahedronGeometry(1, 0);
    } else if (shape === 'torus') {
      key = geometryKey('torus', dimensions);
      geometry = this.geometries.get(key) ?? new THREE.TorusGeometry(
        dimensions.radius,
        dimensions.tube,
        dimensions.radialSegments ?? 8,
        dimensions.tubularSegments ?? 16,
        dimensions.arc ?? Math.PI * 2,
      );
    } else {
      throw new RangeError(`Unsupported fixed-room V1 primitive shape: ${shape}`);
    }
    if (!this.geometries.has(key)) {
      geometry.name = `legacy-fixed-room:${key}`;
      geometry.computeBoundingBox();
      this.geometries.set(key, geometry);
    }
    return { key, geometry };
  }

  _componentTransform(component) {
    const dimensions = component.dimensions;
    if (component.shape === 'box') {
      return {
        position: component.center,
        rotation: component.rotation ?? { x: 0, y: component.yaw ?? 0, z: 0 },
        scale: { x: dimensions.x, y: dimensions.y, z: dimensions.z },
      };
    }
    if (component.shape === 'cylinder' || component.shape === 'open-cylinder') {
      const radius = Math.max(dimensions.radiusTop, dimensions.radiusBottom);
      return {
        position: component.center,
        rotation: component.rotation ?? { x: 0, y: component.yaw ?? 0, z: 0 },
        scale: { x: radius, y: dimensions.height, z: radius },
      };
    }
    if (component.shape === 'octahedron') {
      return {
        position: component.center,
        rotation: component.rotation ?? { x: 0, y: component.yaw ?? 0, z: 0 },
        scale: { x: dimensions.radius, y: dimensions.radius, z: dimensions.radius },
      };
    }
    if (component.shape === 'torus') {
      return {
        position: component.center,
        rotation: component.rotation ?? { x: 0, y: component.yaw ?? 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
    }
    throw new RangeError(`Unsupported fixed-room component shape: ${component.shape}`);
  }

  _addBatch(batches, {
    id,
    role,
    shape,
    dimensions,
    materialProfileId,
    matrix,
    castShadow = false,
    receiveShadow = true,
    contractId = null,
    cameraOcclusionClass = null,
  }) {
    const { key: geometryId, geometry } = this._geometry(shape, dimensions);
    const batchKey = [
      geometryId,
      materialProfileId,
      role,
      castShadow ? 'cast' : 'no-cast',
      receiveShadow ? 'receive' : 'no-receive',
      cameraOcclusionClass ?? 'not-camera-occluding',
    ].join('|');
    const batch = batches.get(batchKey) ?? {
      geometry,
      material: this.materialKit.getMaterial(materialProfileId),
      role,
      castShadow,
      receiveShadow,
      cameraOcclusionClass,
      entries: [],
    };
    const textureContract = textureContractForEntry(shape, dimensions, matrix);
    batch.entries.push({
      id,
      contractId,
      matrix,
      textureDimensions: textureContract.dimensions,
      textureUvExtents: textureContract.uvExtents,
    });
    batches.set(batchKey, batch);
  }

  _addSurface(batches, surface) {
    const size = point(surface.size, `${surface.id}.size`);
    const topY = finite(surface.topY, `${surface.id}.topY`);
    const position = {
      x: surface.center.x,
      y: topY - size.y * 0.5,
      z: surface.center.z,
    };
    const rotation = { x: 0, y: 0, z: 0 };
    if (surface.shape === 'ramp-tile') {
      const rise = surface.ramp.endY - surface.ramp.startY;
      const angle = Math.atan2(rise, Math.max(size.x, size.z));
      if (surface.ramp.direction.x) rotation.z = surface.ramp.direction.x * angle;
      if (surface.ramp.direction.z) rotation.x = -surface.ramp.direction.z * angle;
    } else if (surface.shape !== 'tile') {
      throw new RangeError(`Unsupported fixed-room surface shape ${surface.shape} on ${surface.id}.`);
    }
    this._addBatch(batches, {
      id: surface.id,
      contractId: surface.id,
      role: 'walkable-surface',
      shape: 'box',
      dimensions: size,
      materialProfileId: surface.materialProfileId,
      matrix: matrixFromTransform({ position, rotation, scale: size }),
      castShadow: false,
      receiveShadow: true,
      cameraOcclusionClass: topY > 0.5 ? 'elevated-catwalk' : null,
    });
  }

  _addBoundary(batches, boundary) {
    for (const piece of splitLocalBoundaryAroundOpenings(boundary)) {
      const size = {
        x: piece.bounds.halfSize.x * 2,
        y: piece.bounds.halfSize.y * 2,
        z: piece.bounds.halfSize.z * 2,
      };
      this._addBatch(batches, {
        id: piece.id,
        contractId: boundary.id,
        role: boundary.role,
        shape: 'box',
        dimensions: size,
        materialProfileId: boundary.materialProfileId,
        matrix: matrixFromTransform({ position: piece.bounds.center, scale: size }),
        // Opaque enclosure panels are already batched, remain fully lit, and
        // receive landmark/gate shadows. Casting the thousands of wall and
        // foundation instances adds a shadow submission per native room while
        // contributing no route-signalling silhouette.
        castShadow: false,
        receiveShadow: true,
        cameraOcclusionClass: ['north', 'south', 'east', 'west', 'ceiling'].includes(boundary.side)
          ? 'opaque-enclosure'
          : null,
      });
    }
  }

  _fixtureComponents(fixture) {
    const prefabId = fixture.prefabId ?? fixture.presentation?.recipeId;
    if (!prefabId) {
      if (fixture.presentation?.coveredBySurfaceIds?.length) return null;
      throw new Error(`${fixture.id} has no visible native V1 presentation recipe.`);
    }
    const sourceArguments = fixture.presentation?.sourceArguments;
    const nativeRecipe = getLegacyFixedRoomNativeRecipeV2(prefabId, sourceArguments);
    if (nativeRecipe) {
      return { prefabId, components: nativeRecipe.components };
    }
    const prefab = PREFAB_BY_ID.get(prefabId);
    if (!prefab) throw new RangeError(`${fixture.id} references unknown V1 prefab ${prefabId}.`);
    const primitives = prefabId === 'legacy-girder-frame' && sourceArguments
      ? /cylinder-arch/.test(fixture.kind)
        ? authoredCylinderArchComponents(sourceArguments)
        : authoredGirderFrameComponents(sourceArguments)
      : prefab.primitives;
    return { prefabId, components: prefabComponents({ ...prefab, primitives }) };
  }

  _addFixture(batches, fixture, parityDiagnostics) {
    const resolved = this._fixtureComponents(fixture);
    if (!resolved) return;
    const target = boundsFromCenterHalfSize(fixture.localBounds.center, fixture.localBounds.halfSize);
    const authoredScale = finite(fixture.presentation?.authoredUniformScale ?? 1, `${fixture.id}.presentation.authoredUniformScale`);
    if (authoredScale <= 0) throw new RangeError(`${fixture.id} authoredUniformScale must be positive.`);
    const yawQuarterTurns = normalizeQuarterTurns(fixture.presentation?.yawQuarterTurns ?? fixture.yawQuarterTurns ?? 0);
    const localComponents = [];
    const sourceBounds = new THREE.Box3();
    for (const component of resolved.components) {
      const { geometry } = this._geometry(component.shape, component.dimensions);
      const transform = this._componentTransform(component);
      const matrix = matrixFromTransform(transform);
      sourceBounds.union(transformedBox(geometry.boundingBox, matrix));
      localComponents.push({ component, matrix, geometry });
    }
    if (sourceBounds.isEmpty()) throw new Error(`${fixture.id} produced an empty V1 prefab.`);

    const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    const targetSize = new THREE.Vector3(
      target.halfSize.x * 2,
      target.halfSize.y * 2,
      target.halfSize.z * 2,
    );
    const rotation = new THREE.Matrix4().makeRotationY(yawQuarterTurns * Math.PI * 0.5);
    const scale = new THREE.Matrix4().makeScale(authoredScale, authoredScale, authoredScale);
    const centeredSource = new THREE.Matrix4().makeTranslation(-sourceCenter.x, -sourceBounds.min.y, -sourceCenter.z);
    const targetTranslation = new THREE.Matrix4().makeTranslation(
      target.center.x,
      target.min.y,
      target.center.z,
    );
    const fixtureMatrix = targetTranslation.clone().multiply(rotation).multiply(scale).multiply(centeredSource);
    const renderedBounds = transformedBox(sourceBounds, fixtureMatrix);
    const overshoot = Math.max(
      target.min.x - renderedBounds.min.x,
      target.min.y - renderedBounds.min.y,
      target.min.z - renderedBounds.min.z,
      renderedBounds.max.x - target.max.x,
      renderedBounds.max.y - target.max.y,
      renderedBounds.max.z - target.max.z,
      0,
    );
    const faceDifference = box3MaximumFaceDifference(
      renderedBounds,
      new THREE.Box3(
        new THREE.Vector3(target.min.x, target.min.y, target.min.z),
        new THREE.Vector3(target.max.x, target.max.y, target.max.z),
      ),
    );
    const blocking = ['blocking', 'walkable'].includes(fixture.collision?.mode);
    if (fixture.collision?.mode !== 'compound-blocking'
      && overshoot > LEGACY_FIXED_ROOM_FIXTURE_PARITY_TOLERANCE_V2) {
      throw new Error(`${fixture.id} native V1 recipe exceeds its plan bounds by ${overshoot.toFixed(3)}m; non-uniform fitting is forbidden.`);
    }
    if (blocking && faceDifference > LEGACY_FIXED_ROOM_FIXTURE_PARITY_TOLERANCE_V2) {
      throw new Error(`${fixture.id} collision differs from its visible native V1 recipe by ${faceDifference.toFixed(3)}m.`);
    }
    if (fixture.collision?.mode === 'compound-blocking') {
      for (const [index, part] of (fixture.collision.parts ?? []).entries()) {
        const partBounds = boundsFromCenterHalfSize(part.center, part.halfSize);
        const partBox = new THREE.Box3(
          new THREE.Vector3(partBounds.min.x, partBounds.min.y, partBounds.min.z),
          new THREE.Vector3(partBounds.max.x, partBounds.max.y, partBounds.max.z),
        );
        const outside = Math.max(
          renderedBounds.min.x - partBox.min.x,
          renderedBounds.min.y - partBox.min.y,
          renderedBounds.min.z - partBox.min.z,
          partBox.max.x - renderedBounds.max.x,
          partBox.max.y - renderedBounds.max.y,
          partBox.max.z - renderedBounds.max.z,
          0,
        );
        if (outside > LEGACY_FIXED_ROOM_FIXTURE_PARITY_TOLERANCE_V2 || !partBox.intersectsBox(renderedBounds)) {
          throw new Error(`${fixture.id} collision part ${part.id ?? index + 1} is not covered by the visible native V1 recipe.`);
        }
      }
    }
    parityDiagnostics.push({
      fixtureId: fixture.id,
      prefabId: resolved.prefabId,
      authoredUniformScale: authoredScale,
      sourceSize: sourceSize.toArray(),
      targetSize: targetSize.toArray(),
      overshoot,
      faceDifference,
      collisionMode: fixture.collision?.mode ?? 'none',
    });

    for (const { component, matrix, geometry } of localComponents) {
      const componentMatrix = fixtureMatrix.clone().multiply(matrix);
      const renderedComponentSize = transformedBox(geometry.boundingBox, componentMatrix)
        .getSize(new THREE.Vector3());
      const renderedComponentVolume = (
        renderedComponentSize.x * renderedComponentSize.y * renderedComponentSize.z
      );
      const castLandmarkShadow = component.castShadow !== false
        && renderedComponentVolume >= LEGACY_FIXED_ROOM_LANDMARK_SHADOW_VOLUME_THRESHOLD_V2;
      this._addBatch(batches, {
        id: `${fixture.id}.${component.id}`,
        contractId: fixture.id,
        role: 'v1-authored-landmark',
        shape: component.shape,
        dimensions: component.dimensions,
        materialProfileId: component.materialProfileId,
        matrix: componentMatrix,
        castShadow: castLandmarkShadow,
        receiveShadow: component.receiveShadow !== false,
        cameraOcclusionClass: blocking ? 'opaque-fixture' : null,
      });
    }
  }

  _addPortalFrames(batches, module, contract) {
    const openIds = new Set(contract.openSocketIds);
    for (const socket of module.extensionSockets.filter(({ id }) => openIds.has(id))) {
      if (!['north', 'south', 'east', 'west'].includes(socket.boundarySide)) continue;
      const width = socket.opening.width;
      const height = socket.opening.height;
      const sill = socket.opening.sillElevation;
      const horizontalSide = socket.boundarySide === 'north' || socket.boundarySide === 'south';
      const postSize = horizontalSide
        ? { x: 0.22, y: height, z: 0.34 }
        : { x: 0.34, y: height, z: 0.22 };
      const headerSize = horizontalSide
        ? { x: width + 0.44, y: 0.28, z: 0.34 }
        : { x: 0.34, y: 0.28, z: width + 0.44 };
      const tangent = horizontalSide ? { x: 1, z: 0 } : { x: 0, z: 1 };
      for (const sign of [-1, 1]) {
        const position = {
          x: socket.anchor.x + tangent.x * sign * (width * 0.5 + 0.11),
          y: sill + height * 0.5,
          z: socket.anchor.z + tangent.z * sign * (width * 0.5 + 0.11),
        };
        this._addBatch(batches, {
          id: `${socket.id}.frame-post.${sign}`,
          contractId: socket.id,
          role: 'paired-portal-frame',
          shape: 'box',
          dimensions: postSize,
          materialProfileId: 'legacy-support',
          matrix: matrixFromTransform({ position, scale: postSize }),
          castShadow: false,
          receiveShadow: true,
          cameraOcclusionClass: 'portal-frame',
        });
      }
      const headerPosition = {
        x: socket.anchor.x,
        y: sill + height + 0.14,
        z: socket.anchor.z,
      };
      this._addBatch(batches, {
        id: `${socket.id}.frame-header`,
        contractId: socket.id,
        role: 'paired-portal-frame',
        shape: 'box',
        dimensions: headerSize,
        materialProfileId: 'legacy-support',
        matrix: matrixFromTransform({ position: headerPosition, scale: headerSize }),
        castShadow: false,
        receiveShadow: true,
        cameraOcclusionClass: 'portal-frame',
      });
    }
  }

  _flushBatches(group, batches) {
    const shouldMergeStaticLandmarks = batches.size > this.drawCallBudget;
    const flushGroups = new Map();
    for (const [batchKey, batch] of batches) {
      const mergeKey = shouldMergeStaticLandmarks && batch.role === 'v1-authored-landmark'
        ? [
            batch.material.name,
            batch.role,
            batch.castShadow ? 'cast' : 'no-cast',
            batch.receiveShadow ? 'receive' : 'no-receive',
            batch.cameraOcclusionClass ?? 'not-camera-occluding',
          ].join('|')
        : `single:${batchKey}`;
      const flushGroup = flushGroups.get(mergeKey) ?? [];
      flushGroup.push(batch);
      flushGroups.set(mergeKey, flushGroup);
    }
    const drawObjects = [];
    let mergedStaticBatchCount = 0;
    for (const groupedBatches of flushGroups.values()) {
      const batch = groupedBatches[0];
      const entries = groupedBatches.flatMap(({ entries: batchEntries }) => batchEntries);
      let mesh;
      if (groupedBatches.length === 1) {
        const hasBoxTextureDimensions = batch.geometry.type === 'BoxGeometry'
          && entries.every(({ textureDimensions }) => textureDimensions);
        const hasUvRangeExtents = batch.geometry.type !== 'BoxGeometry'
          && entries.every(({ textureUvExtents }) => textureUvExtents);
        let renderGeometry = batch.geometry;
        let renderMaterial = batch.material;
        if (hasBoxTextureDimensions) {
          renderGeometry = batch.geometry.clone();
          const dimensions = new Float32Array(entries.length * 3);
          entries.forEach(({ textureDimensions }, index) => {
            dimensions[index * 3] = textureDimensions.x;
            dimensions[index * 3 + 1] = textureDimensions.y;
            dimensions[index * 3 + 2] = textureDimensions.z;
          });
          renderGeometry.setAttribute(
            'instanceV2TextureDimensions',
            new THREE.InstancedBufferAttribute(dimensions, 3),
          );
          renderGeometry.userData.v2TextureTiling = {
            mode: 'per-instance-world-dimensions',
            tileScaleMetres: LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2,
            attribute: 'instanceV2TextureDimensions',
          };
          this.generatedGeometries.add(renderGeometry);
          renderMaterial = this._worldTiledMaterial(batch.material);
        } else if (hasUvRangeExtents) {
          renderGeometry = batch.geometry.clone();
          const repeats = new Float32Array(entries.length * 2);
          entries.forEach(({ textureUvExtents }, index) => {
            repeats[index * 2] = repeatCount(textureUvExtents.u);
            repeats[index * 2 + 1] = repeatCount(textureUvExtents.v);
          });
          renderGeometry.setAttribute(
            'instanceV2TextureUvRepeats',
            new THREE.InstancedBufferAttribute(repeats, 2),
          );
          renderGeometry.userData.v2TextureTiling = {
            mode: 'per-instance-world-uv-ranges',
            tileScaleMetres: LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2,
            attribute: 'instanceV2TextureUvRepeats',
          };
          this.generatedGeometries.add(renderGeometry);
          renderMaterial = this._worldTiledUvRangeMaterial(batch.material);
        }
        mesh = new THREE.InstancedMesh(renderGeometry, renderMaterial, entries.length);
        entries.forEach(({ matrix }, index) => mesh.setMatrixAt(index, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.v2InstancedStaticBatch = true;
        if (hasBoxTextureDimensions) {
          mesh.userData.v2TextureTiling = {
            mode: 'per-instance-world-dimensions',
            tileScaleMetres: LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2,
            attribute: 'instanceV2TextureDimensions',
          };
        } else if (hasUvRangeExtents) {
          mesh.userData.v2TextureTiling = {
            mode: 'per-instance-world-uv-ranges',
            tileScaleMetres: LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2,
            attribute: 'instanceV2TextureUvRepeats',
          };
        }
      } else {
        const transformedGeometries = [];
        let tiledComponentCount = 0;
        for (const groupedBatch of groupedBatches) {
          for (const { matrix, textureDimensions, textureUvExtents } of groupedBatch.entries) {
            const cloned = groupedBatch.geometry.clone();
            const normalized = cloned.index ? cloned.toNonIndexed() : cloned;
            if (normalized !== cloned) cloned.dispose();
            if (groupedBatch.geometry.type === 'BoxGeometry' && textureDimensions) {
              applyWorldScaleBoxUvs(normalized, textureDimensions);
              tiledComponentCount += 1;
            } else if (textureUvExtents) {
              applyWorldScaleUvRanges(normalized, textureUvExtents.u, textureUvExtents.v);
              tiledComponentCount += 1;
            }
            normalized.applyMatrix4(matrix);
            transformedGeometries.push(normalized);
          }
        }
        const merged = mergeGeometries(transformedGeometries, false);
        transformedGeometries.forEach((geometry) => geometry.dispose());
        if (!merged) {
          throw new Error(`Unable to merge static V1 landmark batches for ${batch.material.name}.`);
        }
        merged.name = `legacy-fixed-room:merged:${batch.material.name}`;
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        this.generatedGeometries.add(merged);
        mesh = new THREE.Mesh(merged, batch.material);
        mesh.userData.v2MergedStaticBatch = true;
        if (batch.material.map) {
          const metadata = {
            mode: 'merged-per-component-world-dimensions',
            tileScaleMetres: LEGACY_FIXED_ROOM_TEXTURE_TILE_SCALE_METRES_V2,
            componentCount: tiledComponentCount,
            bakedIntoUvs: true,
          };
          merged.userData.v2TextureTiling = metadata;
          mesh.userData.v2TextureTiling = { ...metadata };
        }
        mergedStaticBatchCount += 1;
      }
      mesh.name = `legacy-fixed-room-batch:${batch.role}:${batch.material.name}`;
      mesh.castShadow = batch.castShadow;
      mesh.receiveShadow = batch.receiveShadow;
      mesh.userData.v2ShadowPolicy = batch.castShadow
        ? 'legacy-fixed-room-landmark-caster'
        : 'legacy-fixed-room-receiver-only';
      mesh.userData.v2LegacyFixedRoomPresentation = true;
      mesh.userData.v2PresentationOnly = true;
      mesh.userData.v2CollisionPolicy = LEGACY_FIXED_ROOM_PRESENTATION_POLICY_V2;
      mesh.userData.v2BatchRole = batch.role;
      mesh.userData.v2InstanceIds = entries.map(({ id }) => id);
      mesh.userData.v2ContractIds = entries.map(({ contractId }) => contractId);
      const cameraOcclusionMaterialIsOpaque = mesh.material?.transparent !== true
        && (mesh.material?.opacity ?? 1) >= 0.999
        && mesh.material?.depthWrite !== false;
      const destructiveMergedFixtureOwner = mesh.userData.v2MergedStaticBatch === true
        && batch.cameraOcclusionClass === 'opaque-fixture';
      if (batch.cameraOcclusionClass
        && cameraOcclusionMaterialIsOpaque
        && !destructiveMergedFixtureOwner) {
        mesh.userData.cameraOcclusionSurface = true;
        mesh.userData.cameraOcclusionOwner = true;
        mesh.userData.v2CameraOcclusionClass = batch.cameraOcclusionClass;
        if (mesh.isInstancedMesh) {
          // Game resolves Raycaster hit.instanceId and temporarily zero-scales
          // only that one native panel/deck/fixture. Hiding this batch object
          // would erase hundreds of unrelated V1 room instances.
          mesh.userData.v2CameraOcclusionInstanceMode = 'per-instance';
          mesh.userData.v2CameraOcclusionInstanceIds = entries.map(({ id }) => id);
          mesh.userData.v2CameraOcclusionContractIds = entries.map(({ contractId }) => contractId);
        } else {
          mesh.userData.v2CameraOcclusionInstanceMode = 'per-object';
        }
      }
      if (mesh.isInstancedMesh) {
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
      }
      group.add(mesh);
      drawObjects.push(mesh);
    }
    return { drawObjects, mergedStaticBatchCount };
  }

  /** Render one exact V1 fixed-room module. No collision is registered here. */
  buildModule(moduleOrId, {
    structuralContract,
    placement = {},
    parent = null,
  } = {}) {
    this._assertActive();
    const module = normalizeModule(moduleOrId);
    const contract = contractFor(module, structuralContract);
    const translation = point(placement.translation ?? placement.position ?? { x: 0, y: 0, z: 0 }, 'placement.translation');
    const yawQuarterTurns = normalizeQuarterTurns(placement.yawQuarterTurns ?? 0);
    const group = new THREE.Group();
    group.name = `legacy-fixed-room:${module.id}`;
    group.position.set(translation.x, translation.y, translation.z);
    group.rotation.y = yawQuarterTurns * Math.PI * 0.5;
    group.userData.v2LegacyFixedRoomPresentation = true;
    group.userData.v2PresentationOnly = true;
    group.userData.v2CollisionPolicy = LEGACY_FIXED_ROOM_PRESENTATION_POLICY_V2;
    group.userData.v2ModuleId = module.id;
    group.userData.v2ModuleRevision = module.revision;
    group.userData.v2StructuralContractId = contract.id;
    group.userData.v2SourceRoomId = module.sourceRoom.id;
    group.userData.v2AssetFamilyId = module.presentation.assetFamilyId;

    const batches = new Map();
    const parityDiagnostics = [];
    for (const surface of contract.walkableSurfaces) this._addSurface(batches, surface);
    for (const boundary of contract.structuralBoundaries) this._addBoundary(batches, boundary);
    for (const fixture of module.fixtures) this._addFixture(batches, fixture, parityDiagnostics);
    this._addPortalFrames(batches, module, contract);
    const { drawObjects, mergedStaticBatchCount } = this._flushBatches(group, batches);
    if (drawObjects.length > this.drawCallBudget) {
      throw new Error(`${module.id} requires ${drawObjects.length} draw calls; budget is ${this.drawCallBudget}.`);
    }
    group.userData.v2PresentationDiagnostics = {
      drawCalls: drawObjects.length,
      surfaceCount: contract.walkableSurfaces.length,
      boundaryCount: contract.structuralBoundaries.length,
      visibleFixtureCount: parityDiagnostics.length,
      mergedStaticBatchCount,
      fixtureParity: parityDiagnostics,
      nonUniformPrefabScaling: false,
      genericFallbackGeometry: false,
    };
    if (parent) parent.add(group);
    return group;
  }

  getDiagnostics() {
    return Object.freeze({
      disposed: this.disposed,
      geometryCount: this.geometries.size,
      generatedGeometryCount: this.generatedGeometries.size,
      worldTiledMaterialCount: this.worldTiledMaterials.size + this.worldTiledUvRangeMaterials.size,
      drawCallBudget: this.drawCallBudget,
      ownsMaterialKit: this.ownsMaterialKit,
      collisionPolicy: LEGACY_FIXED_ROOM_PRESENTATION_POLICY_V2,
    });
  }

  dispose() {
    if (this.disposed) return;
    for (const geometry of new Set(this.geometries.values())) geometry.dispose();
    this.geometries.clear();
    for (const geometry of this.generatedGeometries) geometry.dispose();
    this.generatedGeometries.clear();
    for (const material of this.worldTiledMaterials.values()) material.dispose();
    this.worldTiledMaterials.clear();
    for (const material of this.worldTiledUvRangeMaterials.values()) material.dispose();
    this.worldTiledUvRangeMaterials.clear();
    if (this.ownsMaterialKit) this.materialKit.dispose();
    this.disposed = true;
  }
}

export function createLegacyFixedRoomRuntimeAdapterV2(options) {
  return new LegacyFixedRoomRuntimeAdapterV2(options);
}

export default LegacyFixedRoomRuntimeAdapterV2;
