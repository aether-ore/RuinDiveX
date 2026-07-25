import { SeededRandom, hashSeed } from '../reaverbots/SeededRandom.js';
import {
  createVoxelFaceTextureManifest,
  validateVoxelFaceTextureManifest,
} from './VoxelFaceTextureManifest.js';

export const OVERWORLD_PLAN_VERSION = 1;
export const OVERWORLD_PLAN_ID = 'ruindivex-expedition-overworld-v1';
export const OVERWORLD_CELL_SIZE = 1.5;
export const OVERWORLD_LEVEL_HEIGHT = 0.5;
export const OVERWORLD_CORE_CELLS = 96;
export const OVERWORLD_APRON_CELLS = 16;
export const OVERWORLD_VISUAL_CELLS = OVERWORLD_CORE_CELLS + OVERWORLD_APRON_CELLS * 2;
export const OVERWORLD_CHUNK_CELLS = 16;
export const OVERWORLD_CORE_SIZE = OVERWORLD_CORE_CELLS * OVERWORLD_CELL_SIZE;
export const OVERWORLD_VISUAL_SIZE = OVERWORLD_VISUAL_CELLS * OVERWORLD_CELL_SIZE;
export const OVERWORLD_TRAIL_CORRIDOR_WIDTH = 4.5;

const TRAIL_HALF_WIDTH = OVERWORLD_TRAIL_CORRIDOR_WIDTH * 0.5;
const TREE_TRAIL_CLEARANCE = 4.5;
const HOUSE_CLEARANCE = 4.5;
const FIXED_LAYOUT_SEED = 'ruindivex-authored-overworld-20260721';

/**
 * Serializable material identities used by terrain and authored voxel props.
 * The renderer resolves every material through these plan-owned descriptors;
 * changing a face-set binding or material profile therefore changes the plan
 * hash instead of silently changing presentation at assembly time.
 */
export const OVERWORLD_SURFACE_MATERIALS = Object.freeze({
  meadow: Object.freeze({
    id: 'meadow', voxelFaceSetId: 'meadow', terrain: true,
    fallbackColors: Object.freeze({ top: 0x579047, side: 0x70563a, bottom: 0x4d3928 }),
    roughness: 0.92, metalness: 0,
  }),
  trail: Object.freeze({
    id: 'trail', voxelFaceSetId: 'trail', terrain: true,
    fallbackColors: Object.freeze({ top: 0xa37d50, side: 0x785737, bottom: 0x4e3826 }),
    roughness: 0.92, metalness: 0,
  }),
  stone: Object.freeze({
    id: 'stone', voxelFaceSetId: 'stone', terrain: true,
    fallbackColors: Object.freeze({ top: 0x85877f, side: 0x666b68, bottom: 0x484b49 }),
    roughness: 0.88, metalness: 0,
  }),
  bark: Object.freeze({
    id: 'bark', voxelFaceSetId: 'bark', terrain: false,
    fallbackColors: Object.freeze({ top: 0x83633f, side: 0x5a402b, bottom: 0x3d2b20 }),
    roughness: 0.92, metalness: 0,
  }),
  leaves: Object.freeze({
    id: 'leaves', voxelFaceSetId: 'leaves', terrain: false,
    fallbackColors: Object.freeze({ top: 0x3f7f3b, side: 0x326d35, bottom: 0x28572c }),
    roughness: 0.92, metalness: 0,
  }),
  houseWall: Object.freeze({
    id: 'houseWall', voxelFaceSetId: 'houseWall', terrain: false,
    fallbackColors: Object.freeze({ top: 0xbca77f, side: 0xa18868, bottom: 0x75634f }),
    roughness: 0.92, metalness: 0,
  }),
  roof: Object.freeze({
    id: 'roof', voxelFaceSetId: 'roof', terrain: false,
    fallbackColors: Object.freeze({ top: 0x6f5548, side: 0x5b4239, bottom: 0x3d302c }),
    roughness: 0.92, metalness: 0,
  }),
});
const FOREST_CAMERA_ROUTE = Object.freeze([
  { x: -43, z: -31 },
  { x: -50, z: -31 },
  { x: -50, z: -41 },
  { x: -43, z: -41 },
  { x: -43, z: -52 },
]);

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function visualCellIndex(x, z) {
  return z * OVERWORLD_VISUAL_CELLS + x;
}

function coreCellIndex(x, z) {
  return z * OVERWORLD_CORE_CELLS + x;
}

function visualCellCenter(index) {
  return (index + 0.5 - OVERWORLD_VISUAL_CELLS * 0.5) * OVERWORLD_CELL_SIZE;
}

function worldToVisualCell(value) {
  return Math.floor(value / OVERWORLD_CELL_SIZE + OVERWORLD_VISUAL_CELLS * 0.5);
}

function distanceToSegmentSquared(px, pz, start, end) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  const amount = lengthSq > 0
    ? clamp(((px - start.x) * dx + (pz - start.z) * dz) / lengthSq, 0, 1)
    : 0;
  const x = start.x + dx * amount;
  const z = start.z + dz * amount;
  return {
    distanceSq: (px - x) ** 2 + (pz - z) ** 2,
    amount,
  };
}

function distanceToTrailSquared(x, z, trails) {
  let nearest = Infinity;
  for (const trail of trails) {
    for (let index = 0; index < trail.points.length - 1; index += 1) {
      nearest = Math.min(
        nearest,
        distanceToSegmentSquared(x, z, trail.points[index], trail.points[index + 1]).distanceSq,
      );
    }
  }
  return nearest;
}

function distanceToPolylineSquared(x, z, points) {
  let nearest = Infinity;
  for (let index = 0; index < points.length - 1; index += 1) {
    nearest = Math.min(nearest, distanceToSegmentSquared(x, z, points[index], points[index + 1]).distanceSq);
  }
  return nearest;
}

function pointToAxisAlignedBoxDistance(x, z, halfWidth, halfDepth) {
  return Math.hypot(
    Math.max(Math.abs(x) - halfWidth, 0),
    Math.max(Math.abs(z) - halfDepth, 0),
  );
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  const epsilon = 1e-9;
  const onSegment = (start, end, point) => (
    Math.abs(orientation(start, end, point)) <= epsilon
    && point.x >= Math.min(start.x, end.x) - epsilon
    && point.x <= Math.max(start.x, end.x) + epsilon
    && point.z >= Math.min(start.z, end.z) - epsilon
    && point.z <= Math.max(start.z, end.z) + epsilon
  );
  if (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) return true;
  return (Math.abs(abC) <= epsilon && onSegment(a, b, c))
    || (Math.abs(abD) <= epsilon && onSegment(a, b, d))
    || (Math.abs(cdA) <= epsilon && onSegment(c, d, a))
    || (Math.abs(cdB) <= epsilon && onSegment(c, d, b));
}

function segmentToSegmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.sqrt(Math.min(
    distanceToSegmentSquared(a.x, a.z, c, d).distanceSq,
    distanceToSegmentSquared(b.x, b.z, c, d).distanceSq,
    distanceToSegmentSquared(c.x, c.z, a, b).distanceSq,
    distanceToSegmentSquared(d.x, d.z, a, b).distanceSq,
  ));
}

function segmentToBlockerDistance(start, end, blocker) {
  if (blocker.kind === 'cylinder') {
    return Math.max(
      0,
      Math.sqrt(distanceToSegmentSquared(blocker.x, blocker.z, start, end).distanceSq)
        - (blocker.radius ?? 0),
    );
  }
  const angle = blocker.rotationY ?? 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const intoLocal = (point) => {
    const dx = point.x - blocker.x;
    const dz = point.z - blocker.z;
    return { x: dx * cos + dz * sin, z: -dx * sin + dz * cos };
  };
  const localStart = intoLocal(start);
  const localEnd = intoLocal(end);
  const halfWidth = blocker.halfWidth ?? 0;
  const halfDepth = blocker.halfDepth ?? 0;
  const corners = [
    { x: -halfWidth, z: -halfDepth },
    { x: halfWidth, z: -halfDepth },
    { x: halfWidth, z: halfDepth },
    { x: -halfWidth, z: halfDepth },
  ];
  let distance = Math.min(
    pointToAxisAlignedBoxDistance(localStart.x, localStart.z, halfWidth, halfDepth),
    pointToAxisAlignedBoxDistance(localEnd.x, localEnd.z, halfWidth, halfDepth),
  );
  for (let index = 0; index < corners.length; index += 1) {
    distance = Math.min(
      distance,
      segmentToSegmentDistance(
        localStart,
        localEnd,
        corners[index],
        corners[(index + 1) % corners.length],
      ),
    );
  }
  return distance;
}

function createTrailDefinitions() {
  return [
    {
      id: 'village-meadow-loop',
      label: 'Village Meadow Loop',
      corridorWidth: OVERWORLD_TRAIL_CORRIDOR_WIDTH,
      points: [
        { x: 0, z: 1, level: 0 },
        { x: 17, z: 3, level: 0 },
        { x: 31, z: 5, level: 0 },
        { x: 29, z: 16, level: 1 },
        { x: 37, z: 16, level: 1 },
        { x: 42, z: 19, level: 1 },
        { x: 27, z: 31, level: 1 },
        { x: 4, z: 25, level: 0 },
        { x: 0, z: 1, level: 0 },
      ],
    },
    {
      id: 'forest-cabin-loop',
      label: 'Old Forester Loop',
      corridorWidth: OVERWORLD_TRAIL_CORRIDOR_WIDTH,
      points: [
        { x: 0, z: 1, level: 0 },
        { x: -17, z: -8, level: 0 },
        { x: -30, z: -20, level: 1 },
        { x: -38, z: -28, level: 1 },
        { x: -58, z: -18, level: 1 },
        { x: -43, z: 2, level: 0 },
        { x: -20, z: 13, level: 0 },
        { x: 0, z: 1, level: 0 },
      ],
    },
    {
      id: 'highland-switchback-loop',
      label: 'Highland Switchback',
      corridorWidth: OVERWORLD_TRAIL_CORRIDOR_WIDTH,
      points: [
        { x: 31, z: 5, level: 0 },
        { x: 36, z: -17, level: 2 },
        { x: 57, z: -17, level: 4 },
        { x: 57, z: -27, level: 6 },
        { x: 38, z: -27, level: 8 },
        { x: 38, z: -37, level: 10 },
        { x: 59, z: -37, level: 12 },
        { x: 59, z: -46, level: 14 },
        { x: 42, z: -46, level: 16 },
        { x: 42, z: -55, level: 18 },
        { x: 50, z: -55, level: 20 },
        { x: 50, z: -67.5, level: 24 },
        // Reach the lodge's level-24 south apron without crossing its 4.5m
        // blocker clearance. At x=58 the trail and pad were separated by one
        // base-terrain column, producing an impassable vertical step.
        { x: 60.75, z: -67.5, level: 24 },
        { x: 50, z: -67.5, level: 24 },
        { x: 48, z: -63, level: 22 },
        { x: 27, z: -58, level: 14 },
        { x: 8, z: -43, level: 6 },
        { x: -17, z: -8, level: 0 },
      ],
    },
  ];
}

function createHouseDefinitions() {
  return [
    {
      id: 'village-house-a', label: 'Trailkeeper Cottage', district: 'village',
      x: 24, z: -5, level: 0, yawQuarterTurns: 1,
      width: 8, depth: 6, wallHeight: 4, roofTiers: 2,
      topology: 'front-gable-porch', facade: 'timber-light',
      extensions: [{ kind: 'porch', x: 0, z: 3.8, width: 4.5, depth: 1.8, height: 0.4 }],
    },
    {
      id: 'village-house-b', label: 'Surveyor House', district: 'village',
      x: 39.5, z: 8, level: 1, yawQuarterTurns: 0,
      width: 7, depth: 7, wallHeight: 5.5, roofTiers: 3,
      topology: 'tall-square-dormer', facade: 'plaster-blue',
      extensions: [{ kind: 'dormer', x: 0, z: -2.8, width: 2.5, depth: 1.2, height: 1.4 }],
    },
    {
      id: 'village-house-c', label: 'Twin Workshop', district: 'village',
      x: 51.5, z: 18, level: 1, yawQuarterTurns: 1,
      width: 10, depth: 6, wallHeight: 4.5, roofTiers: 2,
      topology: 'offset-l-workshop', facade: 'timber-red',
      extensions: [{ kind: 'wing', x: -4, z: 3.5, width: 5, depth: 4, height: 3.5 }],
    },
    {
      id: 'village-house-d', label: 'Wayfarer Longhouse', district: 'village',
      x: 17.5, z: 19.5, level: 0, yawQuarterTurns: 0,
      width: 12, depth: 5.5, wallHeight: 3.8, roofTiers: 2,
      topology: 'longhouse-side-entry', facade: 'plaster-gold',
      extensions: [{ kind: 'side-entry', x: 6.4, z: 0, width: 1.8, depth: 3, height: 2.8 }],
    },
    {
      id: 'forest-cabin', label: 'Forester Cabin', district: 'forest',
      x: -43.5, z: -36.5, level: 1, yawQuarterTurns: 3,
      width: 7, depth: 5.5, wallHeight: 3.5, roofTiers: 2,
      topology: 'cabin-chimney-lean-to', facade: 'timber-dark',
      extensions: [
        { kind: 'lean-to', x: 4, z: 0, width: 2, depth: 4, height: 2.2 },
        { kind: 'chimney', x: -2.2, z: -1.5, width: 1, depth: 1, height: 5.8 },
      ],
    },
    {
      id: 'hill-lodge', label: 'Highland Lodge', district: 'highlands',
      x: 60.25, z: -58.75, level: 24, yawQuarterTurns: 2,
      width: 11, depth: 8, wallHeight: 5, roofTiers: 3,
      topology: 'split-lodge-overlook', facade: 'stone-timber',
      extensions: [
        { kind: 'overlook', x: 0, z: 5, width: 8, depth: 2.5, height: 0.4 },
        { kind: 'side-wing', x: -7, z: 0, width: 4, depth: 6, height: 3.8 },
      ],
    },
  ];
}

function createLandmarks({ magmaRefineryGroundY = 12 } = {}) {
  return [
    { id: 'camp-clearing', kind: 'camp', label: 'Expedition Camp', x: 0, y: 0, z: 0 },
    { id: 'overworldDungeonDoor', kind: 'dungeonDoor', label: 'Sealed Ruin Door', x: 0, y: 0, z: -8 },
    { id: 'highlandMagmaRefinery', kind: 'sealedRefineryLandmark', label: 'Ancient Refinery — Sealed', x: 50, y: magmaRefineryGroundY, z: -52 },
    { id: 'expeditionSupportCar', kind: 'supportCar', label: 'Support Car', x: 7.5, y: 0, z: -5.6, yaw: Math.PI * 0.25 },
    { id: 'rollCaskettNpc', kind: 'npc', label: 'Roll', x: 4.2, y: 0, z: -4.2, yaw: -Math.PI * 0.5 },
    { id: 'rollWorkshopWorkbench', kind: 'workbench', label: 'Roll Workshop', x: 5.7, y: 0, z: -4, yaw: -Math.PI * 0.25 },
    { id: 'forest-overlook', kind: 'viewpoint', label: 'Forest Outlook', x: -59, y: 0.5, z: -18 },
    { id: 'hill-overlook', kind: 'viewpoint', label: 'Highland Overlook', x: 48, y: 11, z: -63 },
  ];
}

function createRegions() {
  return [
    { id: 'camp', label: 'Expedition Camp', bounds: { minX: -14, maxX: 14, minZ: -12, maxZ: 12 } },
    { id: 'village', label: 'Trailside Village', bounds: { minX: 14, maxX: 58, minZ: -10, maxZ: 35 } },
    { id: 'forest', label: 'Old Growth Forest', bounds: { minX: -70, maxX: -10, minZ: -67, maxZ: 12 } },
    { id: 'highlands', label: 'Northeast Highlands', bounds: { minX: 25, maxX: 70, minZ: -70, maxZ: -14 } },
    { id: 'meadow', label: 'South Meadow', bounds: { minX: -36, maxX: 62, minZ: 12, maxZ: 70 } },
  ];
}

function createBaseTerrain() {
  const heightLevels = new Array(OVERWORLD_VISUAL_CELLS ** 2);
  const surfaceIds = new Array(OVERWORLD_VISUAL_CELLS ** 2);

  for (let zIndex = 0; zIndex < OVERWORLD_VISUAL_CELLS; zIndex += 1) {
    const z = visualCellCenter(zIndex);
    for (let xIndex = 0; xIndex < OVERWORLD_VISUAL_CELLS; xIndex += 1) {
      const x = visualCellCenter(xIndex);
      const hillDistance = Math.hypot((x - 50) / 38, (z + 48) / 34);
      const highland = Math.max(0, 1 - hillDistance) ** 1.35 * 24;
      const westRidge = Math.max(0, 1 - Math.hypot((x + 55) / 32, (z + 42) / 38)) * 5;
      const southHill = Math.max(0, 1 - Math.hypot((x - 33) / 29, (z - 48) / 25)) * 5;
      const authoredRipple = Math.sin(x * 0.075) * 0.7 + Math.cos(z * 0.066) * 0.65;
      let level = Math.max(0, Math.round(highland + westRidge + southHill + authoredRipple));

      if (Math.abs(x) <= 14 && z >= -12 && z <= 12) level = 0;
      const index = visualCellIndex(xIndex, zIndex);
      heightLevels[index] = level;
      surfaceIds[index] = level >= 8 ? 'stone' : 'meadow';
    }
  }

  return { heightLevels, surfaceIds };
}

function stampHousePads(terrain, houses) {
  for (const house of houses) {
    const halfWidth = house.width * 0.5 + 1.5;
    const halfDepth = house.depth * 0.5 + 1.5;
    const yaw = house.yawQuarterTurns * Math.PI * 0.5;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const searchRadius = Math.hypot(halfWidth, halfDepth);
    for (let zIndex = 0; zIndex < OVERWORLD_VISUAL_CELLS; zIndex += 1) {
      const z = visualCellCenter(zIndex);
      if (Math.abs(z - house.z) > searchRadius) continue;
      for (let xIndex = 0; xIndex < OVERWORLD_VISUAL_CELLS; xIndex += 1) {
        const x = visualCellCenter(xIndex);
        if (Math.abs(x - house.x) > searchRadius) continue;
        const dx = x - house.x;
        const dz = z - house.z;
        const localX = dx * cos - dz * sin;
        const localZ = dx * sin + dz * cos;
        if (Math.abs(localX) > halfWidth || Math.abs(localZ) > halfDepth) continue;
        const index = visualCellIndex(xIndex, zIndex);
        terrain.heightLevels[index] = house.level;
        terrain.surfaceIds[index] = house.level >= 8 ? 'stone' : 'meadow';
      }
    }
  }
}

function stampTrails(terrain, trails) {
  const trailCellIndices = new Set();
  const desiredLevels = new Map();

  for (const trail of trails) {
    for (let pointIndex = 0; pointIndex < trail.points.length - 1; pointIndex += 1) {
      const start = trail.points[pointIndex];
      const end = trail.points[pointIndex + 1];
      const minX = worldToVisualCell(Math.min(start.x, end.x) - TRAIL_HALF_WIDTH) - 1;
      const maxX = worldToVisualCell(Math.max(start.x, end.x) + TRAIL_HALF_WIDTH) + 1;
      const minZ = worldToVisualCell(Math.min(start.z, end.z) - TRAIL_HALF_WIDTH) - 1;
      const maxZ = worldToVisualCell(Math.max(start.z, end.z) + TRAIL_HALF_WIDTH) + 1;
      for (let zIndex = clamp(minZ, 0, OVERWORLD_VISUAL_CELLS - 1); zIndex <= clamp(maxZ, 0, OVERWORLD_VISUAL_CELLS - 1); zIndex += 1) {
        const z = visualCellCenter(zIndex);
        for (let xIndex = clamp(minX, 0, OVERWORLD_VISUAL_CELLS - 1); xIndex <= clamp(maxX, 0, OVERWORLD_VISUAL_CELLS - 1); xIndex += 1) {
          const x = visualCellCenter(xIndex);
          const projection = distanceToSegmentSquared(x, z, start, end);
          if (projection.distanceSq > TRAIL_HALF_WIDTH ** 2) continue;
          const index = visualCellIndex(xIndex, zIndex);
          const level = Math.round(start.level + (end.level - start.level) * projection.amount);
          trailCellIndices.add(index);
          const existing = desiredLevels.get(index);
          desiredLevels.set(index, existing === undefined ? level : Math.min(existing, level));
        }
      }
    }
  }

  for (const index of trailCellIndices) {
    terrain.heightLevels[index] = desiredLevels.get(index) ?? terrain.heightLevels[index];
    terrain.surfaceIds[index] = 'trail';
  }

  // Ensure every pair of orthogonally adjacent trail cells respects the
  // grounded 0.5 m step envelope, even where two authored routes merge.
  for (let pass = 0; pass < 64; pass += 1) {
    let changed = false;
    for (const index of trailCellIndices) {
      const x = index % OVERWORLD_VISUAL_CELLS;
      const z = Math.floor(index / OVERWORLD_VISUAL_CELLS);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= OVERWORLD_VISUAL_CELLS || nz >= OVERWORLD_VISUAL_CELLS) continue;
        const neighborIndex = visualCellIndex(nx, nz);
        if (!trailCellIndices.has(neighborIndex)) continue;
        const difference = terrain.heightLevels[index] - terrain.heightLevels[neighborIndex];
        if (difference > 1) {
          terrain.heightLevels[index] = terrain.heightLevels[neighborIndex] + 1;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  return [...trailCellIndices].sort((a, b) => a - b);
}

function isInsideHouseClearance(x, z, houses, objectRadius = 0) {
  return houses.some((house) => {
    const yaw = house.yawQuarterTurns * Math.PI * 0.5;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const dx = x - house.x;
    const dz = z - house.z;
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const collisionParts = [
      { x: 0, z: 0, width: house.width, depth: house.depth },
      ...house.extensions.filter(({ kind }) => !['porch', 'overlook', 'dormer'].includes(kind)),
    ];
    return collisionParts.some((part) => (
      Math.abs(localX - (part.x ?? 0)) <= part.width * 0.5 + HOUSE_CLEARANCE + objectRadius
      && Math.abs(localZ - (part.z ?? 0)) <= part.depth * 0.5 + HOUSE_CLEARANCE + objectRadius
    ));
  });
}

function getVisualHeight(terrain, x, z) {
  const cellX = clamp(worldToVisualCell(x), 0, OVERWORLD_VISUAL_CELLS - 1);
  const cellZ = clamp(worldToVisualCell(z), 0, OVERWORLD_VISUAL_CELLS - 1);
  return terrain.heightLevels[visualCellIndex(cellX, cellZ)] * OVERWORLD_LEVEL_HEIGHT;
}

function createTrees(terrain, trails, houses) {
  const random = new SeededRandom(`${FIXED_LAYOUT_SEED}:forest`);
  const trees = [];
  const minimumSpacingSq = 2.55 ** 2;

  for (let attempt = 0; attempt < 18000 && trees.length < 240; attempt += 1) {
    const x = random.float(-69, -9);
    const z = random.float(-67, 11);
    const trunkWidth = random.float(0.48, 0.78);
    const trunkRadius = Math.max(0.38, trunkWidth * 0.7);
    const inPrimaryForest = x < -17 || z < -24;
    if (!inPrimaryForest) continue;
    if (Math.abs(x) < 17 && z > -15 && z < 14) continue;
    if (distanceToTrailSquared(x, z, trails) < (TREE_TRAIL_CLEARANCE + trunkRadius) ** 2) continue;
    // Keep a narrow natural gap behind the forester cabin. Besides preventing
    // an accidental tree wall, this gives the follow camera a deterministic
    // route for validating house occlusion without teleport-only probes.
    if (distanceToPolylineSquared(x, z, FOREST_CAMERA_ROUTE) < 1.8 ** 2) continue;
    if (isInsideHouseClearance(x, z, houses, trunkRadius)) continue;
    if (trees.some((tree) => (tree.x - x) ** 2 + (tree.z - z) ** 2 < minimumSpacingSq)) continue;

    const trunkHeight = random.float(4.2, 7.4);
    trees.push({
      id: `forest-tree-${String(trees.length + 1).padStart(3, '0')}`,
      kind: 'tree',
      x: Number(x.toFixed(3)),
      y: Number(getVisualHeight(terrain, x, z).toFixed(3)),
      z: Number(z.toFixed(3)),
      trunkWidth: Number(trunkWidth.toFixed(3)),
      trunkHeight: Number(trunkHeight.toFixed(3)),
      canopyWidth: Number(random.float(2.7, 4.2).toFixed(3)),
      canopyHeight: Number(random.float(2.5, 4.1).toFixed(3)),
      variant: random.int(0, 3),
    });
  }

  return trees;
}

function createBlockers(houses, trees) {
  const blockers = trees.map((tree) => ({
    id: `${tree.id}-collision`,
    ownerId: tree.id,
    kind: 'cylinder',
    x: tree.x,
    y: tree.y + tree.trunkHeight * 0.5,
    z: tree.z,
    radius: Math.max(0.38, tree.trunkWidth * 0.7),
    halfHeight: tree.trunkHeight * 0.5,
  }));

  for (const house of houses) {
    const visualYaw = house.yawQuarterTurns * Math.PI * 0.5;
    const collisionYaw = visualYaw === 0 ? 0 : -visualYaw;
    blockers.push({
      id: `${house.id}-collision`,
      ownerId: house.id,
      kind: 'box',
      x: house.x,
      y: house.level * OVERWORLD_LEVEL_HEIGHT + house.wallHeight * 0.5,
      z: house.z,
      halfWidth: house.width * 0.5,
      halfDepth: house.depth * 0.5,
      halfHeight: house.wallHeight * 0.5 + house.roofTiers * 0.55,
      rotationY: collisionYaw,
    });
    const yaw = visualYaw;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (const [extensionIndex, extension] of house.extensions.entries()) {
      if (['porch', 'overlook', 'dormer'].includes(extension.kind)) continue;
      const localX = extension.x ?? 0;
      const localZ = extension.z ?? 0;
      blockers.push({
        id: `${house.id}-extension-${extensionIndex}-collision`,
        ownerId: house.id,
        kind: 'box',
        x: house.x + localX * cos + localZ * sin,
        y: house.level * OVERWORLD_LEVEL_HEIGHT + extension.height * 0.5,
        z: house.z - localX * sin + localZ * cos,
        halfWidth: extension.width * 0.5,
        halfDepth: extension.depth * 0.5,
        halfHeight: extension.height * 0.5,
        rotationY: collisionYaw,
      });
    }
  }

  blockers.push(
    {
      id: 'expeditionSupportCarCollision', ownerId: 'expeditionSupportCar', kind: 'box',
      x: 7.5, y: 1.8, z: -5.6, halfWidth: 1.55, halfDepth: 2.4, halfHeight: 1.8,
      rotationY: -Math.PI * 0.25,
    },
    {
      id: 'rollWorkshopWorkbenchCollision', ownerId: 'rollWorkshopWorkbench', kind: 'box',
      x: 5.7, y: 0.55, z: -4, halfWidth: 1.1, halfDepth: 0.41, halfHeight: 0.55,
      rotationY: Math.PI * 0.25,
    },
    {
      id: 'overworldDungeonDoorCollision', ownerId: 'overworldDungeonDoor', kind: 'box',
      x: 0, y: 3.2, z: -8.45, halfWidth: 2.7, halfDepth: 0.35, halfHeight: 3.2,
      rotationY: 0,
    },
    {
      id: 'overworldRuinMoundLeftCollision', ownerId: 'overworldRuinMound', kind: 'box',
      x: -4.3, y: 2.5, z: -9, halfWidth: 1.6, halfDepth: 1.7, halfHeight: 2.5,
      rotationY: 0,
    },
    {
      id: 'overworldRuinMoundRightCollision', ownerId: 'overworldRuinMound', kind: 'box',
      x: 4.3, y: 2.5, z: -9, halfWidth: 1.6, halfDepth: 1.7, halfHeight: 2.5,
      rotationY: 0,
    },
    {
      id: 'overworldRuinMoundHeaderCollision', ownerId: 'overworldRuinMound', kind: 'box',
      x: 0, y: 6.1, z: -9, halfWidth: 3.1, halfDepth: 1.7, halfHeight: 1.05,
      rotationY: 0,
    },
    {
      id: 'overworldMapBoundaryNorthCollision', ownerId: 'overworldMapBoundary', kind: 'box',
      boundarySide: 'north', x: 0, y: 64, z: -72.75,
      halfWidth: 72.75, halfDepth: 0.75, halfHeight: 64, rotationY: 0,
    },
    {
      id: 'overworldMapBoundarySouthCollision', ownerId: 'overworldMapBoundary', kind: 'box',
      boundarySide: 'south', x: 0, y: 64, z: 72.75,
      halfWidth: 72.75, halfDepth: 0.75, halfHeight: 64, rotationY: 0,
    },
    {
      id: 'overworldMapBoundaryWestCollision', ownerId: 'overworldMapBoundary', kind: 'box',
      boundarySide: 'west', x: -72.75, y: 64, z: 0,
      halfWidth: 0.75, halfDepth: 72.75, halfHeight: 64, rotationY: 0,
    },
    {
      id: 'overworldMapBoundaryEastCollision', ownerId: 'overworldMapBoundary', kind: 'box',
      boundarySide: 'east', x: 72.75, y: 64, z: 0,
      halfWidth: 0.75, halfDepth: 72.75, halfHeight: 64, rotationY: 0,
    },
  );

  return blockers;
}

function createInteractions() {
  return [
    {
      id: 'overworldDungeonDoor', label: 'Choose Boss Hunt', action: 'openBossHuntSelection',
      x: 0, y: 0.9, z: -6.65, interactionRadius: 2.6, color: 0x7df8ff,
      activationSide: { axis: 'z', sign: 1 }, ownerId: 'overworldDungeonDoor',
    },
    {
      id: 'rollCaskett', label: 'Roll', action: 'roll',
      x: 4.2, y: 0.9, z: -4.2, interactionRadius: 2.4, color: 0xffd66b,
      activationSide: null, ownerId: 'rollCaskettNpc',
    },
    {
      id: 'rollWorkshopWorkbench', label: 'Roll Workshop', action: 'roll',
      x: 5.1, y: 0.8, z: -2.3, interactionRadius: 2.2, color: 0x6bdcff,
      activationSide: null, ownerId: 'rollWorkshopWorkbench',
    },
  ];
}

function copyCoreTerrain(visualTerrain) {
  const heightLevels = new Array(OVERWORLD_CORE_CELLS ** 2);
  const surfaceIds = new Array(OVERWORLD_CORE_CELLS ** 2);
  for (let z = 0; z < OVERWORLD_CORE_CELLS; z += 1) {
    for (let x = 0; x < OVERWORLD_CORE_CELLS; x += 1) {
      const sourceIndex = visualCellIndex(x + OVERWORLD_APRON_CELLS, z + OVERWORLD_APRON_CELLS);
      const targetIndex = coreCellIndex(x, z);
      heightLevels[targetIndex] = visualTerrain.heightLevels[sourceIndex];
      surfaceIds[targetIndex] = visualTerrain.surfaceIds[sourceIndex];
    }
  }
  return {
    width: OVERWORLD_CORE_CELLS,
    depth: OVERWORLD_CORE_CELLS,
    cellSize: OVERWORLD_CELL_SIZE,
    levelHeight: OVERWORLD_LEVEL_HEIGHT,
    originX: -OVERWORLD_CORE_SIZE * 0.5,
    originZ: -OVERWORLD_CORE_SIZE * 0.5,
    heightLevels,
    surfaceIds,
  };
}

function createChunkDescriptor(id, kind, range, visualTerrain, extra = {}) {
  const minX = visualTerrain.originX + range.minX * visualTerrain.cellSize;
  const minZ = visualTerrain.originZ + range.minZ * visualTerrain.cellSize;
  const maxX = minX + range.width * visualTerrain.cellSize;
  const maxZ = minZ + range.depth * visualTerrain.cellSize;
  const center = { x: (minX + maxX) * 0.5, z: (minZ + maxZ) * 0.5 };
  const cullRadius = Number((Math.hypot(maxX - center.x, maxZ - center.z) + 2).toFixed(3));
  return {
    id,
    kind,
    range: { ...range },
    worldBounds: { minX, maxX, minZ, maxZ },
    cullCenter: center,
    cullRadius,
    sourceCellCount: range.width * range.depth,
    ...extra,
  };
}

function createChunkMetadata(visualTerrain) {
  const columns = OVERWORLD_CORE_CELLS / OVERWORLD_CHUNK_CELLS;
  const rows = columns;
  const coreChunks = [];
  for (let chunkZ = 0; chunkZ < rows; chunkZ += 1) {
    for (let chunkX = 0; chunkX < columns; chunkX += 1) {
      coreChunks.push(createChunkDescriptor(
        `overworldTerrainChunk-${chunkX}-${chunkZ}`,
        'playable-core',
        {
          minX: OVERWORLD_APRON_CELLS + chunkX * OVERWORLD_CHUNK_CELLS,
          minZ: OVERWORLD_APRON_CELLS + chunkZ * OVERWORLD_CHUNK_CELLS,
          width: OVERWORLD_CHUNK_CELLS,
          depth: OVERWORLD_CHUNK_CELLS,
        },
        visualTerrain,
        { chunkX, chunkZ, collidable: true, playable: true },
      ));
    }
  }
  const apronRanges = [
    { id: 'north', minX: 0, minZ: 0, width: OVERWORLD_VISUAL_CELLS, depth: OVERWORLD_APRON_CELLS },
    {
      id: 'south', minX: 0, minZ: OVERWORLD_VISUAL_CELLS - OVERWORLD_APRON_CELLS,
      width: OVERWORLD_VISUAL_CELLS, depth: OVERWORLD_APRON_CELLS,
    },
    {
      id: 'west', minX: 0, minZ: OVERWORLD_APRON_CELLS,
      width: OVERWORLD_APRON_CELLS, depth: OVERWORLD_CORE_CELLS,
    },
    {
      id: 'east', minX: OVERWORLD_VISUAL_CELLS - OVERWORLD_APRON_CELLS,
      minZ: OVERWORLD_APRON_CELLS, width: OVERWORLD_APRON_CELLS, depth: OVERWORLD_CORE_CELLS,
    },
  ];
  const apronChunks = apronRanges.map((range) => createChunkDescriptor(
    `overworldVisualApron-${range.id}`,
    'visual-apron',
    { minX: range.minX, minZ: range.minZ, width: range.width, depth: range.depth },
    visualTerrain,
    { side: range.id, collidable: false, playable: false },
  ));
  return {
    id: 'overworld-chunk-layout-v1',
    revision: 1,
    coreGrid: {
      columns,
      rows,
      chunkCells: OVERWORLD_CHUNK_CELLS,
      originCellX: OVERWORLD_APRON_CELLS,
      originCellZ: OVERWORLD_APRON_CELLS,
      expectedChunkCount: columns * rows,
    },
    coreChunks,
    apron: {
      expectedChunkCount: apronChunks.length,
      expectedCoveredCellCount: OVERWORLD_VISUAL_CELLS ** 2 - OVERWORLD_CORE_CELLS ** 2,
    },
    apronChunks,
    horizon: { expectedMeshCount: 1, cull: false, collidable: false, playable: false },
    expectedTerrainMeshCount: coreChunks.length + apronChunks.length + 1,
    vegetation: {
      cullChunkWorldSize: OVERWORLD_CHUNK_CELLS * OVERWORLD_CELL_SIZE,
      cullGridColumns: columns,
      cullGridRows: rows,
      occlusionPartitionsPerChunk: 2,
      occlusionPartitionStrategy: 'alternating-axis-halves',
      maximumOcclusionOwnerShortSpanMetres: 18,
    },
  };
}

export function computeOverworldPlanHash(plan) {
  const text = JSON.stringify(plan, (key, value) => (key === 'planHash' ? undefined : value));
  return hashSeed(text).toString(16).padStart(8, '0');
}

export function createAuthoredOverworldPlan() {
  const trails = createTrailDefinitions();
  const houses = createHouseDefinitions();
  const visualTerrainData = createBaseTerrain();
  stampHousePads(visualTerrainData, houses);
  const trailCellIndices = stampTrails(visualTerrainData, trails);
  // Seat the refinery's gate on the switchback approach, not the higher rock
  // beneath the landmark's rear center. This embeds the mound into the slope
  // while keeping the visible threshold and player interaction grounded.
  const magmaRefineryGroundY = getVisualHeight(visualTerrainData, 50, -47.8);
  const landmarks = createLandmarks({ magmaRefineryGroundY });
  const trees = createTrees(visualTerrainData, trails, houses);
  const terrain = copyCoreTerrain(visualTerrainData);
  const visualTerrain = {
    width: OVERWORLD_VISUAL_CELLS,
    depth: OVERWORLD_VISUAL_CELLS,
    cellSize: OVERWORLD_CELL_SIZE,
    levelHeight: OVERWORLD_LEVEL_HEIGHT,
    apronCells: OVERWORLD_APRON_CELLS,
    originX: -OVERWORLD_VISUAL_SIZE * 0.5,
    originZ: -OVERWORLD_VISUAL_SIZE * 0.5,
    heightLevels: visualTerrainData.heightLevels,
    surfaceIds: visualTerrainData.surfaceIds,
  };
  const chunkMetadata = createChunkMetadata(visualTerrain);
  const anchors = {
    playerStart: { id: 'overworld-player-start', x: 0, y: 0, z: -0.75, facingX: 0, facingZ: -1 },
    campReturn: { id: 'overworld-camp-return', x: 0, y: 0, z: 0.75, facingX: 0, facingZ: -1 },
    dungeonDoorExterior: { id: 'overworld-door-exterior', x: 0, y: 0, z: -6.65, facingX: 0, facingZ: -1 },
    magmaRefineryExterior: { id: 'magma-refinery-exterior', x: 50, y: magmaRefineryGroundY, z: -47.8, facingX: 0, facingZ: -1 },
    roll: { id: 'overworld-roll-anchor', x: 4.2, y: 0, z: -4.2, facingX: -1, facingZ: 0 },
    supportCar: { id: 'overworld-support-car-anchor', x: 7.5, y: 0, z: -4.1, facingX: -0.707, facingZ: -0.707 },
  };
  const plan = {
    id: OVERWORLD_PLAN_ID,
    version: OVERWORLD_PLAN_VERSION,
    kind: 'authoredVoxelOverworld',
    fixedLayoutSeed: FIXED_LAYOUT_SEED,
    voxelFaceSets: createVoxelFaceTextureManifest(),
    surfaceMaterials: OVERWORLD_SURFACE_MATERIALS,
    dimensions: {
      coreCells: OVERWORLD_CORE_CELLS,
      coreSize: OVERWORLD_CORE_SIZE,
      visualCells: OVERWORLD_VISUAL_CELLS,
      visualSize: OVERWORLD_VISUAL_SIZE,
      apronCells: OVERWORLD_APRON_CELLS,
      chunkCells: OVERWORLD_CHUNK_CELLS,
      cellSize: OVERWORLD_CELL_SIZE,
      levelHeight: OVERWORLD_LEVEL_HEIGHT,
      groundedStepAllowance: 0.55,
      minimumTrailCorridorWidth: OVERWORLD_TRAIL_CORRIDOR_WIDTH,
    },
    terrain,
    visualTerrain,
    chunkMetadata,
    trailCellIndices,
    trails,
    trees,
    houses,
    landmarks,
    regions: createRegions(),
    anchors,
    blockers: createBlockers(houses, trees),
    interactions: createInteractions(),
    environment: {
      skyColor: 0x9bc9dc,
      fogColor: 0xb9d4d2,
      fogNear: 80,
      fogFar: 115,
      shadowRadius: 34,
    },
  };
  plan.planHash = computeOverworldPlanHash(plan);
  return deepFreeze(plan);
}

export function getTerrainCell(plan, x, z, { visual = false, world = false } = {}) {
  const terrain = visual ? plan?.visualTerrain : plan?.terrain;
  if (!terrain) return null;
  let cellX = x;
  let cellZ = z;
  if (world) {
    cellX = Math.floor((x - terrain.originX) / terrain.cellSize);
    cellZ = Math.floor((z - terrain.originZ) / terrain.cellSize);
  }
  if (!Number.isInteger(cellX) || !Number.isInteger(cellZ)
    || cellX < 0 || cellZ < 0 || cellX >= terrain.width || cellZ >= terrain.depth) {
    return null;
  }
  const index = cellZ * terrain.width + cellX;
  return {
    x: cellX,
    z: cellZ,
    worldX: terrain.originX + (cellX + 0.5) * terrain.cellSize,
    worldZ: terrain.originZ + (cellZ + 0.5) * terrain.cellSize,
    heightLevel: terrain.heightLevels[index],
    height: terrain.heightLevels[index] * terrain.levelHeight,
    surfaceId: terrain.surfaceIds[index],
    index,
  };
}

export function validateOverworldPlan(plan) {
  const errors = [];
  const warnings = [];
  let minimumTrailGeometryClearance = Infinity;
  if (!plan || plan.kind !== 'authoredVoxelOverworld') errors.push('invalid-plan-kind');
  const voxelFaceSetValidation = validateVoxelFaceTextureManifest(plan?.voxelFaceSets);
  if (!voxelFaceSetValidation.accepted) {
    errors.push(...voxelFaceSetValidation.errors.map((error) => `voxel-face-sets:${error}`));
  }
  const surfaceMaterials = plan?.surfaceMaterials;
  for (const materialId of ['meadow', 'trail', 'stone', 'bark', 'leaves', 'houseWall', 'roof']) {
    const descriptor = surfaceMaterials?.[materialId];
    if (!descriptor || descriptor.id !== materialId) {
      errors.push(`missing-surface-material:${materialId}`);
      continue;
    }
    if (!plan?.voxelFaceSets?.families?.[descriptor.voxelFaceSetId]) {
      errors.push(`missing-voxel-face-set-binding:${materialId}`);
    }
    if (!['top', 'side', 'bottom'].every((face) => Number.isInteger(descriptor.fallbackColors?.[face]))) {
      errors.push(`invalid-surface-fallback-colors:${materialId}`);
    }
    if (!Number.isFinite(descriptor.roughness) || !Number.isFinite(descriptor.metalness)) {
      errors.push(`invalid-surface-material-profile:${materialId}`);
    }
  }
  for (const terrainSurfaceId of new Set(plan?.visualTerrain?.surfaceIds ?? [])) {
    if (surfaceMaterials?.[terrainSurfaceId]?.terrain !== true) {
      errors.push(`unmapped-terrain-surface:${terrainSurfaceId}`);
    }
  }
  if (plan?.terrain?.width !== OVERWORLD_CORE_CELLS || plan?.terrain?.depth !== OVERWORLD_CORE_CELLS) {
    errors.push('core-terrain-must-be-96x96');
  }
  if (plan?.visualTerrain?.width !== OVERWORLD_VISUAL_CELLS
    || plan?.visualTerrain?.depth !== OVERWORLD_VISUAL_CELLS) {
    errors.push('visual-terrain-must-include-16-cell-apron');
  }
  if (plan?.terrain?.heightLevels?.length !== OVERWORLD_CORE_CELLS ** 2
    || plan?.terrain?.surfaceIds?.length !== OVERWORLD_CORE_CELLS ** 2) {
    errors.push('invalid-core-terrain-cell-count');
  }
  const chunkMetadata = plan?.chunkMetadata;
  const coreChunks = chunkMetadata?.coreChunks ?? [];
  const apronChunks = chunkMetadata?.apronChunks ?? [];
  const expectedGridCount = chunkMetadata?.coreGrid?.columns * chunkMetadata?.coreGrid?.rows;
  if (chunkMetadata?.id !== 'overworld-chunk-layout-v1') errors.push('missing-plan-owned-chunk-layout');
  if (chunkMetadata?.coreGrid?.columns !== 6 || chunkMetadata?.coreGrid?.rows !== 6
    || chunkMetadata?.coreGrid?.chunkCells !== OVERWORLD_CHUNK_CELLS
    || chunkMetadata?.coreGrid?.originCellX !== OVERWORLD_APRON_CELLS
    || chunkMetadata?.coreGrid?.originCellZ !== OVERWORLD_APRON_CELLS
    || chunkMetadata?.coreGrid?.expectedChunkCount !== 36) {
    errors.push('invalid-core-chunk-grid');
  }
  if (coreChunks.length !== expectedGridCount || coreChunks.length !== 36) {
    errors.push('invalid-core-chunk-count');
  }
  if (apronChunks.length !== chunkMetadata?.apron?.expectedChunkCount || apronChunks.length !== 4) {
    errors.push('invalid-apron-chunk-count');
  }
  if (chunkMetadata?.apron?.expectedCoveredCellCount
    !== OVERWORLD_VISUAL_CELLS ** 2 - OVERWORLD_CORE_CELLS ** 2) {
    errors.push('invalid-apron-cell-contract');
  }
  if (chunkMetadata?.expectedTerrainMeshCount !== coreChunks.length + apronChunks.length + 1
    || chunkMetadata?.expectedTerrainMeshCount !== 41) {
    errors.push('invalid-terrain-mesh-count-contract');
  }
  if (chunkMetadata?.vegetation?.cullChunkWorldSize !== OVERWORLD_CHUNK_CELLS * OVERWORLD_CELL_SIZE
    || chunkMetadata?.vegetation?.occlusionPartitionsPerChunk !== 2
    || chunkMetadata?.vegetation?.maximumOcclusionOwnerShortSpanMetres < 12) {
    errors.push('invalid-vegetation-chunk-contract');
  }
  const coreCoverage = new Set();
  const apronCoverage = new Set();
  const validateChunkDescriptor = (descriptor, expectedKind, coverage) => {
    const range = descriptor?.range;
    if (!descriptor?.id || descriptor?.kind !== expectedKind || !range
      || ![range.minX, range.minZ, range.width, range.depth].every(Number.isInteger)
      || range.width <= 0 || range.depth <= 0
      || range.minX < 0 || range.minZ < 0
      || range.minX + range.width > OVERWORLD_VISUAL_CELLS
      || range.minZ + range.depth > OVERWORLD_VISUAL_CELLS) {
      errors.push(`invalid-chunk-range:${descriptor?.id ?? 'unknown'}`);
      return;
    }
    const expectedBounds = {
      minX: plan.visualTerrain.originX + range.minX * plan.visualTerrain.cellSize,
      maxX: plan.visualTerrain.originX + (range.minX + range.width) * plan.visualTerrain.cellSize,
      minZ: plan.visualTerrain.originZ + range.minZ * plan.visualTerrain.cellSize,
      maxZ: plan.visualTerrain.originZ + (range.minZ + range.depth) * plan.visualTerrain.cellSize,
    };
    if (JSON.stringify(descriptor.worldBounds) !== JSON.stringify(expectedBounds)
      || descriptor.cullCenter?.x !== (expectedBounds.minX + expectedBounds.maxX) * 0.5
      || descriptor.cullCenter?.z !== (expectedBounds.minZ + expectedBounds.maxZ) * 0.5
      || !Number.isFinite(descriptor.cullRadius) || descriptor.cullRadius <= 0
      || descriptor.sourceCellCount !== range.width * range.depth) {
      errors.push(`invalid-chunk-cull-contract:${descriptor.id}`);
    }
    for (let z = range.minZ; z < range.minZ + range.depth; z += 1) {
      for (let x = range.minX; x < range.minX + range.width; x += 1) {
        const key = `${x},${z}`;
        if (coverage.has(key)) errors.push(`overlapping-chunk-range:${descriptor.id}:${key}`);
        coverage.add(key);
      }
    }
  };
  for (const descriptor of coreChunks) validateChunkDescriptor(descriptor, 'playable-core', coreCoverage);
  for (const descriptor of apronChunks) validateChunkDescriptor(descriptor, 'visual-apron', apronCoverage);
  if (coreCoverage.size !== OVERWORLD_CORE_CELLS ** 2) errors.push('incomplete-core-chunk-coverage');
  if (apronCoverage.size !== OVERWORLD_VISUAL_CELLS ** 2 - OVERWORLD_CORE_CELLS ** 2) {
    errors.push('incomplete-apron-chunk-coverage');
  }
  for (const key of coreCoverage) if (apronCoverage.has(key)) errors.push(`core-apron-overlap:${key}`);
  if (plan?.houses?.length !== 6) errors.push('exactly-six-houses-required');
  if ((plan?.trees?.length ?? 0) < 220 || (plan?.trees?.length ?? 0) > 260) {
    errors.push('forest-tree-count-outside-authored-range');
  }
  const topologySignatures = new Set((plan?.houses ?? []).map((house) => house.topology));
  if (topologySignatures.size !== plan?.houses?.length) errors.push('house-topologies-must-be-unique');

  const allIds = [
    ...(plan?.houses ?? []).map(({ id }) => id),
    ...(plan?.trees ?? []).map(({ id }) => id),
    ...(plan?.landmarks ?? []).map(({ id }) => id),
    ...(plan?.blockers ?? []).map(({ id }) => id),
    ...(plan?.interactions ?? []).map(({ id }) => `interaction:${id}`),
  ];
  if (new Set(allIds).size !== allIds.length) errors.push('duplicate-stable-id');

  const terrain = plan?.visualTerrain;
  const trailCells = new Set(plan?.trailCellIndices ?? []);
  for (const trail of plan?.trails ?? []) {
    const corridorWidth = trail.corridorWidth ?? 0;
    if (corridorWidth < OVERWORLD_TRAIL_CORRIDOR_WIDTH) {
      errors.push(`trail-corridor-too-narrow:${trail.id}`);
      continue;
    }
    for (const blocker of plan?.blockers ?? []) {
      let clearance = Infinity;
      for (let index = 0; index < trail.points.length - 1; index += 1) {
        clearance = Math.min(
          clearance,
          segmentToBlockerDistance(trail.points[index], trail.points[index + 1], blocker),
        );
      }
      minimumTrailGeometryClearance = Math.min(minimumTrailGeometryClearance, clearance);
      if (clearance + 1e-6 < OVERWORLD_TRAIL_CORRIDOR_WIDTH) {
        errors.push(`trail-corridor-overlaps-blocker:${trail.id}:${blocker.id}`);
      }
    }
  }
  if (terrain) {
    for (const index of trailCells) {
      const x = index % terrain.width;
      const z = Math.floor(index / terrain.width);
      const worldX = terrain.originX + (x + 0.5) * terrain.cellSize;
      const worldZ = terrain.originZ + (z + 0.5) * terrain.cellSize;
      for (const blocker of plan?.blockers ?? []) {
        let blocked = false;
        if (blocker.kind === 'cylinder') {
          blocked = Math.hypot(worldX - blocker.x, worldZ - blocker.z)
            <= (blocker.radius ?? 0) + 0.42;
        } else {
          const yaw = blocker.rotationY ?? 0;
          const dx = worldX - blocker.x;
          const dz = worldZ - blocker.z;
          const localX = dx * Math.cos(yaw) + dz * Math.sin(yaw);
          const localZ = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
          blocked = Math.abs(localX) <= (blocker.halfWidth ?? 0) + 0.42
            && Math.abs(localZ) <= (blocker.halfDepth ?? 0) + 0.42;
        }
        if (blocked) {
          errors.push(`trail-cell-overlaps-blocker:${x},${z}:${blocker.id}`);
          break;
        }
      }
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const nx = x + dx;
        const nz = z + dz;
        const neighbor = nz * terrain.width + nx;
        if (nx >= terrain.width || nz >= terrain.depth || !trailCells.has(neighbor)) continue;
        const delta = Math.abs(terrain.heightLevels[index] - terrain.heightLevels[neighbor]);
        if (delta > 1) errors.push(`trail-step-exceeds-0.5m:${x},${z}`);
      }
    }
  }

  for (const requiredAnchor of ['playerStart', 'campReturn', 'dungeonDoorExterior', 'magmaRefineryExterior', 'roll', 'supportCar']) {
    if (!plan?.anchors?.[requiredAnchor]) errors.push(`missing-anchor:${requiredAnchor}`);
  }
  for (const requiredInteraction of ['overworldDungeonDoor', 'rollCaskett', 'rollWorkshopWorkbench']) {
    if (!plan?.interactions?.some(({ id }) => id === requiredInteraction)) {
      errors.push(`missing-interaction:${requiredInteraction}`);
    }
  }
  for (const interaction of plan?.interactions ?? []) {
    const side = interaction.activationSide;
    if (side == null) continue;
    if (!['x', 'y', 'z'].includes(side.axis)
      || ![-1, 1].includes(side.sign)
      || !Number.isFinite(interaction[side.axis])) {
      errors.push(`invalid-interaction-activation-side:${interaction.id}`);
    }
  }
  const boundarySides = new Set((plan?.blockers ?? [])
    .filter(({ ownerId }) => ownerId === 'overworldMapBoundary')
    .map(({ boundarySide }) => boundarySide));
  if (boundarySides.size !== 4
    || !['north', 'south', 'west', 'east'].every((side) => boundarySides.has(side))) {
    errors.push('four-map-boundary-blockers-required');
  }
  if (plan?.planHash !== computeOverworldPlanHash(plan)) errors.push('plan-hash-mismatch');
  if (!Object.isFrozen(plan)) errors.push('plan-must-be-immutable');

  return Object.freeze({
    accepted: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    diagnostics: Object.freeze({
      planHash: plan?.planHash ?? null,
      coreCellCount: plan?.terrain?.heightLevels?.length ?? 0,
      visualCellCount: plan?.visualTerrain?.heightLevels?.length ?? 0,
      trailCellCount: plan?.trailCellIndices?.length ?? 0,
      treeCount: plan?.trees?.length ?? 0,
      houseCount: plan?.houses?.length ?? 0,
      coreChunkCount: coreChunks.length,
      apronChunkCount: apronChunks.length,
      minimumTrailGeometryClearance: Number.isFinite(minimumTrailGeometryClearance)
        ? Number(minimumTrailGeometryClearance.toFixed(3))
        : null,
    }),
  });
}
