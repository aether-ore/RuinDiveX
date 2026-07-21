const QUARTER_TURN_COUNT = 4;

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return Number(value);
}

function vector3(value, label) {
  if (!value || !['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]))) {
    throw new TypeError(`${label} must contain finite x, y, and z values.`);
  }
  return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
}

export function normalizeYawQuarterTurns(value = 0) {
  if (!Number.isInteger(value)) {
    throw new TypeError('yawQuarterTurns must be an integer.');
  }
  return ((value % QUARTER_TURN_COUNT) + QUARTER_TURN_COUNT) % QUARTER_TURN_COUNT;
}

export function rotatePointQuarterTurns(point, yawQuarterTurns = 0) {
  const source = vector3(point, 'point');
  switch (normalizeYawQuarterTurns(yawQuarterTurns)) {
    case 0: return source;
    case 1: return { x: source.z, y: source.y, z: -source.x };
    case 2: return { x: -source.x, y: source.y, z: -source.z };
    case 3: return { x: -source.z, y: source.y, z: source.x };
    default: throw new RangeError('Unreachable quarter-turn value.');
  }
}

export function transformPointQuarterTurns(point, placement = {}) {
  const rotated = rotatePointQuarterTurns(point, placement.yawQuarterTurns ?? 0);
  const translation = placement.translation ?? placement.position ?? { x: 0, y: 0, z: 0 };
  return {
    x: rotated.x + finite(translation.x ?? 0, 'placement.translation.x'),
    y: rotated.y + finite(translation.y ?? 0, 'placement.translation.y'),
    z: rotated.z + finite(translation.z ?? 0, 'placement.translation.z'),
  };
}

export function transformBoundsQuarterTurns(bounds, placement = {}) {
  const min = vector3(bounds?.min, 'bounds.min');
  const max = vector3(bounds?.max, 'bounds.max');
  if (!['x', 'y', 'z'].every((axis) => max[axis] >= min[axis])) {
    throw new RangeError('bounds.max must not be less than bounds.min.');
  }
  const corners = [];
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        corners.push(transformPointQuarterTurns({ x, y, z }, placement));
      }
    }
  }
  return {
    min: {
      x: Math.min(...corners.map(({ x }) => x)),
      y: Math.min(...corners.map(({ y }) => y)),
      z: Math.min(...corners.map(({ z }) => z)),
    },
    max: {
      x: Math.max(...corners.map(({ x }) => x)),
      y: Math.max(...corners.map(({ y }) => y)),
      z: Math.max(...corners.map(({ z }) => z)),
    },
  };
}

export function rotateBoundarySideQuarterTurns(side, yawQuarterTurns = 0) {
  if (side === 'floor' || side === 'ceiling') return side;
  // rotatePointQuarterTurns maps +X to -Z for yaw 1, so a north (-Z) face
  // becomes west (-X).  Keep face labels and transformed bounds in the same
  // handed coordinate convention; otherwise a valid quarter-turn assembles
  // its wall on one face while claiming the opposite face.
  const sides = ['north', 'west', 'south', 'east'];
  const index = sides.indexOf(side);
  if (index < 0) throw new TypeError(`Unsupported boundary side ${side}.`);
  return sides[(index + normalizeYawQuarterTurns(yawQuarterTurns)) % sides.length];
}

export default transformPointQuarterTurns;
