const TAU = Math.PI * 2;

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function point(value = {}) {
  return {
    x: finite(value.x),
    y: finite(value.y),
    z: finite(value.z),
  };
}

export function rotateDirectionYaw(direction, radians = 0) {
  const source = point(direction);
  const angle = finite(radians);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const x = source.x * cosine + source.z * sine;
  const z = source.z * cosine - source.x * sine;
  const length = Math.hypot(x, source.y, z) || 1;
  return { x: x / length, y: source.y / length, z: z / length };
}

export function getSpreadDirections(direction, offsets = []) {
  return offsets.map((offset) => rotateDirectionYaw(direction, offset));
}

export function getClusterDirections(direction, count = 5, phase = -Math.PI / 2) {
  const total = Math.max(1, Math.trunc(finite(count, 5)));
  const source = point(direction);
  const forwardLength = Math.hypot(source.x, source.y, source.z);
  const forward = forwardLength > 0.000001
    ? { x: source.x / forwardLength, y: source.y / forwardLength, z: source.z / forwardLength }
    : { x: 0, y: 0, z: 1 };
  const reference = Math.abs(forward.y) < 0.9
    ? { x: 0, y: 1, z: 0 }
    : { x: 1, y: 0, z: 0 };
  const rightRaw = {
    x: reference.y * forward.z - reference.z * forward.y,
    y: reference.z * forward.x - reference.x * forward.z,
    z: reference.x * forward.y - reference.y * forward.x,
  };
  const rightLength = Math.hypot(rightRaw.x, rightRaw.y, rightRaw.z) || 1;
  const right = {
    x: rightRaw.x / rightLength,
    y: rightRaw.y / rightLength,
    z: rightRaw.z / rightLength,
  };
  const up = {
    x: forward.y * right.z - forward.z * right.y,
    y: forward.z * right.x - forward.x * right.z,
    z: forward.x * right.y - forward.y * right.x,
  };

  return Array.from({ length: total }, (_, index) => {
    const angle = finite(phase) + (index / total) * TAU;
    const radialX = Math.cos(angle);
    const radialY = Math.sin(angle);
    const x = forward.x * 0.78 + (right.x * radialX + up.x * radialY) * 0.62;
    const y = forward.y * 0.78 + (right.y * radialX + up.y * radialY) * 0.62;
    const z = forward.z * 0.78 + (right.z * radialX + up.z * radialY) * 0.62;
    const length = Math.hypot(x, y, z) || 1;
    return { x: x / length, y: y / length, z: z / length };
  });
}

export function getBallisticApexProgress({ start, end, arcHeight = 0 } = {}) {
  const from = point(start);
  const to = point(end);
  const height = Math.max(0, finite(arcHeight));
  if (height <= 0) {
    return to.y > from.y ? 1 : 0;
  }

  const ratio = -(to.y - from.y) / (height * Math.PI);
  if (ratio <= -1) return 1;
  if (ratio >= 1) return 0;
  return Math.acos(ratio) / Math.PI;
}

export function sampleBallisticPoint({ start, end, arcHeight = 0 } = {}, progress = 0) {
  const from = point(start);
  const to = point(end);
  const t = Math.max(0, Math.min(1, finite(progress)));
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * Math.max(0, finite(arcHeight)),
    z: from.z + (to.z - from.z) * t,
  };
}

export function sampleBallisticPath(options = {}) {
  const steps = Math.max(2, Math.trunc(finite(options.steps, 24)));
  const apexProgress = getBallisticApexProgress(options);
  const samples = Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps;
    return {
      progress,
      position: sampleBallisticPoint(options, progress),
      apexCrossed: progress >= apexProgress,
    };
  });

  return Object.freeze({
    apexProgress,
    apex: Object.freeze(sampleBallisticPoint(options, apexProgress)),
    samples: Object.freeze(samples.map((sample) => Object.freeze({
      ...sample,
      position: Object.freeze(sample.position),
    }))),
  });
}
