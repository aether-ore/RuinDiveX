import { cloneDungeonAugmentationValue } from './canonical.js';

const EPSILON = 1e-6;

export function toDungeonPoint(value = {}, fallbackY = 0) {
  const source = value?.position ?? value?.center ?? value ?? {};
  return {
    x: Number(source.x ?? 0),
    y: Number(source.y ?? source.elevation ?? value?.elevation ?? fallbackY ?? 0),
    z: Number(source.z ?? 0),
  };
}

export function toDungeonFacing(value = {}) {
  const source = value?.facing ?? value ?? {};
  const rawX = Number(source.x ?? source.facingX ?? value?.facingX ?? 0);
  const rawY = Number(source.y ?? source.facingY ?? value?.facingY ?? 0);
  const rawZ = Number(source.z ?? source.facingZ ?? value?.facingZ ?? 1);
  const horizontalLength = Math.hypot(rawX, rawZ);
  if (horizontalLength <= EPSILON) return { x: 0, y: rawY, z: 1 };
  return { x: rawX / horizontalLength, y: rawY, z: rawZ / horizontalLength };
}

export function addDungeonPoints(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scaleDungeonPoint(point, scalar) {
  return { x: point.x * scalar, y: point.y * scalar, z: point.z * scalar };
}

export function dungeonPointDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function rotationQuarterTurnsForFacing(facing) {
  const normalized = toDungeonFacing(facing);
  if (Math.abs(normalized.x) > Math.abs(normalized.z)) return normalized.x >= 0 ? 1 : 3;
  return normalized.z >= 0 ? 0 : 2;
}

export function rotateDungeonLocalPoint(point, quarterTurns = 0) {
  const normalized = ((Math.round(quarterTurns) % 4) + 4) % 4;
  const local = toDungeonPoint(point);
  if (normalized === 1) return { x: local.z, y: local.y, z: -local.x };
  if (normalized === 2) return { x: -local.x, y: local.y, z: -local.z };
  if (normalized === 3) return { x: -local.z, y: local.y, z: local.x };
  return local;
}

export function transformDungeonLocalPoint(localPoint, placement) {
  return addDungeonPoints(
    toDungeonPoint(placement?.center),
    rotateDungeonLocalPoint(localPoint, placement?.rotationQuarterTurns),
  );
}

export function transformDungeonLocalFacing(localFacing, placement) {
  return toDungeonFacing(rotateDungeonLocalPoint(localFacing, placement?.rotationQuarterTurns));
}

export function transformDungeonVolume(volume, placement, idPrefix = '') {
  const turns = ((Math.round(placement?.rotationQuarterTurns ?? 0) % 4) + 4) % 4;
  const sourceSize = volume?.size ?? {};
  const size = {
    x: Number(turns % 2 === 0 ? sourceSize.x ?? 0 : sourceSize.z ?? 0),
    y: Number(sourceSize.y ?? 0),
    z: Number(turns % 2 === 0 ? sourceSize.z ?? 0 : sourceSize.x ?? 0),
  };
  return {
    ...cloneDungeonAugmentationValue(volume),
    id: `${idPrefix}${volume?.id ?? 'volume'}`,
    center: transformDungeonLocalPoint(volume?.center, placement),
    size,
  };
}

function volumeFromBounds(bounds, fallbackId) {
  const minimum = bounds?.min ?? bounds?.minimum;
  const maximum = bounds?.max ?? bounds?.maximum;
  if (!minimum || !maximum) return null;
  const min = toDungeonPoint(minimum);
  const max = toDungeonPoint(maximum);
  return {
    id: String(bounds.id ?? fallbackId),
    ownerId: bounds.ownerId ?? null,
    center: { x: (min.x + max.x) * 0.5, y: (min.y + max.y) * 0.5, z: (min.z + max.z) * 0.5 },
    size: { x: Math.abs(max.x - min.x), y: Math.abs(max.y - min.y), z: Math.abs(max.z - min.z) },
    purpose: String(bounds.purpose ?? 'base-draft-protected'),
  };
}

export function normalizeDungeonVolume(volume, fallbackId = 'volume') {
  if (!volume || typeof volume !== 'object') return null;
  if (volume.min || volume.minimum) return volumeFromBounds(volume, fallbackId);
  const sizeSource = volume.size ?? volume.halfSize;
  if (!sizeSource) return null;
  const multiplier = volume.halfSize && !volume.size ? 2 : 1;
  const normalized = {
    id: String(volume.id ?? fallbackId),
    ownerId: volume.ownerId ?? null,
    center: toDungeonPoint(volume.center ?? volume),
    size: {
      x: Math.max(0, Number(sizeSource.x ?? sizeSource.width ?? 0) * multiplier),
      y: Math.max(0, Number(sizeSource.y ?? sizeSource.height ?? 0) * multiplier),
      z: Math.max(0, Number(sizeSource.z ?? sizeSource.depth ?? 0) * multiplier),
    },
    purpose: String(volume.purpose ?? 'base-draft-protected'),
  };
  return Object.values(normalized.size).every(Number.isFinite) ? normalized : null;
}

function collectVolumeArray(target, values, prefix) {
  for (const [index, value] of (Array.isArray(values) ? values : []).entries()) {
    const volume = normalizeDungeonVolume(value, `${prefix}:${index}`);
    if (volume) target.push(volume);
  }
}

export function collectBaseDraftVolumes(baseDraft = {}, extensionRegions = []) {
  const volumes = [];
  collectVolumeArray(volumes, baseDraft.occupiedVolumes, 'base:occupied');
  collectVolumeArray(volumes, baseDraft.connectionOccupiedVolumes, 'base:connection:occupied');
  collectVolumeArray(volumes, baseDraft.connectionClearanceVolumes, 'base:connection:clearance');
  collectVolumeArray(volumes, baseDraft.connectionLandingVolumes, 'base:connection:landing');
  collectVolumeArray(volumes, baseDraft.protectedVolumes, 'base:protected');
  for (const [roomIndex, room] of (baseDraft.rooms ?? baseDraft.nodes ?? []).entries()) {
    collectVolumeArray(volumes, room?.occupiedVolumes, `room:${room?.id ?? roomIndex}:occupied`);
    const singular = normalizeDungeonVolume(
      room?.occupiedVolume ?? room?.bounds,
      `room:${room?.id ?? roomIndex}:body`,
    );
    if (singular) volumes.push(singular);
  }
  for (const [regionIndex, region] of (Array.isArray(extensionRegions) ? extensionRegions : []).entries()) {
    collectVolumeArray(volumes, region?.protectedVolumes, `region:${region?.id ?? regionIndex}:protected`);
  }
  return volumes;
}

export function dungeonVolumesOverlap(first, second, tolerance = 1e-4) {
  if (!first?.center || !first?.size || !second?.center || !second?.size) return false;
  return ['x', 'y', 'z'].every((axis) => (
    Math.abs(first.center[axis] - second.center[axis])
      < (first.size[axis] + second.size[axis]) * 0.5 - tolerance
  ));
}

export function createDungeonPolyline(rawPoints = [], fallbackStart = null, fallbackEnd = null) {
  const points = (Array.isArray(rawPoints) ? rawPoints : []).map((point) => toDungeonPoint(point));
  if (points.length < 2 && fallbackStart && fallbackEnd) {
    return [toDungeonPoint(fallbackStart), toDungeonPoint(fallbackEnd)];
  }
  return points;
}

export function measureDungeonPolyline(points = []) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += dungeonPointDistance(points[index - 1], points[index]);
  }
  return length;
}

export function sampleDungeonPolyline(points, ratio) {
  if (!Array.isArray(points) || points.length === 0) {
    return { point: { x: 0, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 }, distance: 0 };
  }
  if (points.length === 1) {
    return { point: { ...points[0] }, facing: { x: 0, y: 0, z: 1 }, distance: 0 };
  }
  const total = measureDungeonPolyline(points);
  const target = Math.max(0, Math.min(1, Number(ratio) || 0)) * total;
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = dungeonPointDistance(start, end);
    if (target <= traversed + segmentLength || index === points.length - 1) {
      const amount = segmentLength > EPSILON ? (target - traversed) / segmentLength : 0;
      const point = {
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
        z: start.z + (end.z - start.z) * amount,
      };
      return { point, facing: toDungeonFacing({ x: end.x - start.x, z: end.z - start.z }), distance: target };
    }
    traversed += segmentLength;
  }
  const end = points.at(-1);
  const before = points.at(-2);
  return {
    point: { ...end },
    facing: toDungeonFacing({ x: end.x - before.x, z: end.z - before.z }),
    distance: total,
  };
}
