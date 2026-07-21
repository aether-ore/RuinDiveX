import {
  normalizeYawQuarterTurns,
  rotateBoundarySideQuarterTurns,
  rotatePointQuarterTurns,
  transformBoundsQuarterTurns,
} from '../../../src/dungeon-v2/DungeonSpatialMathV2.js';

export const ASSEMBLED_MODULE_YAW_COVERAGE = Object.freeze([0, 1, 2, 3]);

function isPoint3(value) {
  return value && typeof value === 'object'
    && ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]));
}

function isPoint2(value) {
  return value && typeof value === 'object'
    && Number.isFinite(value.x) && Number.isFinite(value.z)
    && !Object.hasOwn(value, 'y');
}

function isBounds(value) {
  return value && typeof value === 'object' && isPoint3(value.min) && isPoint3(value.max);
}

function rotateSerializableSpatialValue(value, yawQuarterTurns, key = null) {
  if (!value || typeof value !== 'object') return value;
  if (isBounds(value)) {
    const transformed = transformBoundsQuarterTurns(value, { yawQuarterTurns });
    for (const [childKey, child] of Object.entries(value)) {
      if (childKey !== 'min' && childKey !== 'max') {
        transformed[childKey] = rotateSerializableSpatialValue(child, yawQuarterTurns, childKey);
      }
    }
    return transformed;
  }
  if (isPoint3(value)) return rotatePointQuarterTurns(value, yawQuarterTurns);
  if (key === 'offset'
    && (Number.isFinite(value.x) || Number.isFinite(value.z))
    && (value.y === undefined || Number.isFinite(value.y))) {
    const rotated = rotatePointQuarterTurns({
      x: Number(value.x ?? 0),
      y: Number(value.y ?? 0),
      z: Number(value.z ?? 0),
    }, yawQuarterTurns);
    return value.y === undefined
      ? { x: rotated.x, z: rotated.z }
      : rotated;
  }
  if (isPoint2(value) && key === 'size') {
    return yawQuarterTurns % 2 === 0
      ? { ...value }
      : { ...value, x: value.z, z: value.x };
  }
  if (isPoint2(value)) {
    const rotated = rotatePointQuarterTurns({ x: value.x, y: 0, z: value.z }, yawQuarterTurns);
    return { ...value, x: rotated.x, z: rotated.z };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rotateSerializableSpatialValue(entry, yawQuarterTurns, key));
  }
  const transformed = {};
  for (const [childKey, child] of Object.entries(value)) {
    if (childKey === 'side' && ['north', 'south', 'east', 'west', 'floor', 'ceiling'].includes(child)) {
      transformed[childKey] = rotateBoundarySideQuarterTurns(child, yawQuarterTurns);
    } else if (childKey === 'yawQuarterTurns' && Number.isInteger(child)) {
      transformed[childKey] = normalizeYawQuarterTurns(child + yawQuarterTurns);
    } else if (childKey === 'axis' && (child === 'x' || child === 'z')) {
      transformed[childKey] = yawQuarterTurns % 2 === 0 ? child : (child === 'x' ? 'z' : 'x');
    } else {
      transformed[childKey] = rotateSerializableSpatialValue(child, yawQuarterTurns, childKey);
    }
  }
  return transformed;
}

/**
 * Rotates a complete authored plan as a rigid D4 fixture.  This is test-only:
 * it lets the real validator and assembler prove every descriptor placement
 * at every supported yaw without inventing a reduced primitive room.
 */
export function rotateAuthoredDungeonFixturePlan(rawPlan, yawQuarterTurns) {
  const yaw = normalizeYawQuarterTurns(yawQuarterTurns);
  const rotated = rotateSerializableSpatialValue(structuredClone(rawPlan), yaw);
  rotated.id = `${rawPlan.id}.assembled-yaw-${yaw}`;
  if (rawPlan.planId) rotated.planId = `${rawPlan.planId}.assembled-yaw-${yaw}`;
  rotated.seed = `${rawPlan.seed}:assembled-yaw-${yaw}`;
  rotated.moduleYawAcceptance = {
    sourcePlanId: rawPlan.id,
    yawQuarterTurns: yaw,
    rigidD4Transform: true,
  };
  return rotated;
}
