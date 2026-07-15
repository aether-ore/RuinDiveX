import { sampleBallisticPoint } from './BusterTrajectory.js';

export const BUSTER_PROJECTILE_EVENT_EPSILON = 0.000001;
export const BUSTER_PROJECTILE_GUIDANCE_STEP = 1 / 120;
export const BUSTER_PROJECTILE_MAX_EVENTS_PER_FRAME = 256;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function targetPosition(target = {}) {
  return target?.root?.position ?? target?.position ?? target;
}

function stableId(candidate) {
  return String(
    candidate?.stableId
      ?? candidate?.targetId
      ?? candidate?.enemy?.id
      ?? candidate?.target?.id
      ?? '',
  );
}

export function getBusterTargetCollisionHeight(target, fallbackHeight = 1.8) {
  return Math.max(
    finite(target?.radius, 0.42) * 2.2,
    finite(target?.collisionHeight ?? target?.type?.modelHeight, fallbackHeight),
  );
}

export function getBusterVerticalCapsule(target, height = getBusterTargetCollisionHeight(target)) {
  const root = targetPosition(target);
  const radius = Math.max(0, finite(target?.radius, 0.42));
  const rootY = finite(root?.y);
  const bottomY = rootY + radius;
  return {
    x: finite(root?.x),
    z: finite(root?.z),
    radius,
    bottomY,
    topY: Math.max(bottomY, rootY + Math.max(0, finite(height)) - radius),
  };
}

/** Squared distance from a point to the capsule's vertical center-line segment. */
export function getPointToVerticalCapsuleAxisDistanceSquared(
  point,
  target,
  height = getBusterTargetCollisionHeight(target),
) {
  const root = targetPosition(target);
  const radius = Math.max(0, finite(target?.radius, 0.42));
  const rootY = finite(root?.y);
  const bottomY = rootY + radius;
  const topY = Math.max(bottomY, rootY + Math.max(0, finite(height)) - radius);
  const x = finite(point?.x);
  const y = finite(point?.y);
  const z = finite(point?.z);
  const dx = x - finite(root?.x);
  const dy = y - clamp(y, bottomY, topY);
  const dz = z - finite(root?.z);
  return dx * dx + dy * dy + dz * dz;
}

/** Closest non-negative distance from a point to the capsule surface. */
export function getPointToVerticalCapsuleSurfaceDistance(
  point,
  target,
  height = getBusterTargetCollisionHeight(target),
) {
  const radius = Math.max(0, finite(target?.radius, 0.42));
  return Math.max(
    0,
    Math.sqrt(getPointToVerticalCapsuleAxisDistanceSquared(point, target, height)) - radius,
  );
}

export function sphereIntersectsTargetCapsule({
  center,
  radius,
  target,
  height = getBusterTargetCollisionHeight(target),
  epsilon = BUSTER_PROJECTILE_EVENT_EPSILON,
} = {}) {
  return getPointToVerticalCapsuleSurfaceDistance(center, target, height)
    <= Math.max(0, finite(radius)) + Math.max(0, finite(epsilon));
}

export function findStraightBusterCapsuleHitFraction(
  start,
  end,
  target,
  projectileRadius,
  height = getBusterTargetCollisionHeight(target),
) {
  const collisionRadius = Math.max(0, finite(projectileRadius))
    + Math.max(0, finite(target?.radius, 0.42));
  const radiusSquared = collisionRadius * collisionRadius;
  const samplePosition = (fraction) => ({
    x: finite(start?.x) + (finite(end?.x) - finite(start?.x)) * fraction,
    y: finite(start?.y) + (finite(end?.y) - finite(start?.y)) * fraction,
    z: finite(start?.z) + (finite(end?.z) - finite(start?.z)) * fraction,
  });
  const distanceAt = (fraction) => (
    getPointToVerticalCapsuleAxisDistanceSquared(samplePosition(fraction), target, height)
  );

  if (distanceAt(0) <= radiusSquared) return 0;

  // Squared distance from a line segment to a vertical capsule is convex.
  // Find its minimum, then binary-search the first boundary crossing.
  let minimumLow = 0;
  let minimumHigh = 1;
  for (let iteration = 0; iteration < 28; iteration += 1) {
    const third = (minimumHigh - minimumLow) / 3;
    const left = minimumLow + third;
    const right = minimumHigh - third;
    if (distanceAt(left) <= distanceAt(right)) minimumHigh = right;
    else minimumLow = left;
  }
  const minimum = (minimumLow + minimumHigh) * 0.5;
  if (distanceAt(minimum) > radiusSquared + BUSTER_PROJECTILE_EVENT_EPSILON) return null;

  let low = 0;
  let high = minimum;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const middle = (low + high) * 0.5;
    if (distanceAt(middle) <= radiusSquared) high = middle;
    else low = middle;
  }
  return high;
}

export function findSampledBusterCapsuleHitFraction(
  positionAt,
  target,
  projectileRadius,
  height = getBusterTargetCollisionHeight(target),
) {
  const collisionRadius = Math.max(0, finite(projectileRadius))
    + Math.max(0, finite(target?.radius, 0.42));
  const radiusSquared = collisionRadius * collisionRadius;
  const isInside = (fraction) => (
    getPointToVerticalCapsuleAxisDistanceSquared(positionAt(fraction), target, height)
      <= radiusSquared
  );
  if (isInside(0)) return 0;

  const steps = 64;
  let previous = 0;
  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps;
    if (!isInside(fraction)) {
      previous = fraction;
      continue;
    }
    let low = previous;
    let high = fraction;
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const middle = (low + high) * 0.5;
      if (isInside(middle)) high = middle;
      else low = middle;
    }
    return high;
  }
  return null;
}

export function createBusterSegmentPositionSampler({
  start,
  direction,
  travel,
  previousDistance = 0,
  range = 1,
  baseY = start?.y,
  endY = baseY,
  arcHeight = 0,
} = {}) {
  const startPoint = {
    x: finite(start?.x),
    y: finite(start?.y),
    z: finite(start?.z),
  };
  const normalizedTravel = Math.max(0, finite(travel));
  const normalizedRange = Math.max(0.001, finite(range, 1));
  const height = Math.max(0, finite(arcHeight));
  return (fraction = 0) => {
    const alpha = clamp(finite(fraction), 0, 1);
    const position = {
      x: startPoint.x + finite(direction?.x) * normalizedTravel * alpha,
      y: startPoint.y + finite(direction?.y) * normalizedTravel * alpha,
      z: startPoint.z + finite(direction?.z) * normalizedTravel * alpha,
    };
    if (height > 0) {
      const progress = clamp(
        (finite(previousDistance) + normalizedTravel * alpha) / normalizedRange,
        0,
        1,
      );
      position.y = sampleBallisticPoint({
        start: { x: 0, y: finite(baseY), z: 0 },
        end: { x: 0, y: finite(endY), z: 0 },
        arcHeight: height,
      }, progress).y;
    }
    return position;
  };
}

export function chooseEarlierBusterProjectileEvent(
  current,
  candidate,
  epsilon = BUSTER_PROJECTILE_EVENT_EPSILON,
) {
  if (!candidate) return current;
  if (!current) return candidate;
  if (candidate.time < current.time - epsilon) return candidate;
  if (Math.abs(candidate.time - current.time) <= epsilon) {
    if (candidate.priority < current.priority) return candidate;
    if (candidate.priority === current.priority && stableId(candidate) < stableId(current)) {
      return candidate;
    }
  }
  return current;
}

export function chooseEarlierBusterProjectileImpact(
  current,
  candidate,
  epsilon = BUSTER_PROJECTILE_EVENT_EPSILON,
) {
  if (!candidate) return current;
  if (!current) return candidate;
  if (candidate.fraction < current.fraction - epsilon) return candidate;
  if (Math.abs(candidate.fraction - current.fraction) <= epsilon
    && stableId(candidate) < stableId(current)) return candidate;
  return current;
}

export function chooseStableBusterGuidanceCandidate(
  current,
  candidate,
  { stableTies = true, epsilon = BUSTER_PROJECTILE_EVENT_EPSILON } = {},
) {
  if (!candidate) return current;
  if (!current) return candidate;
  if (!stableTies) {
    return candidate.distanceSquared < current.distanceSquared ? candidate : current;
  }
  if (candidate.distanceSquared < current.distanceSquared - epsilon) return candidate;
  if (Math.abs(candidate.distanceSquared - current.distanceSquared) <= epsilon
    && stableId(candidate) < stableId(current)) return candidate;
  return current;
}

export function steerBusterDirection(
  direction,
  targetDirection,
  strength,
  dt,
  { maxAlpha = 0.28, out = null } = {},
) {
  const result = out ?? {};
  const sourceLength = Math.hypot(
    finite(direction?.x),
    finite(direction?.y),
    finite(direction?.z),
  ) || 1;
  const targetLength = Math.hypot(
    finite(targetDirection?.x),
    finite(targetDirection?.y),
    finite(targetDirection?.z),
  );
  if (targetLength <= 0.000001) {
    result.x = finite(direction?.x) / sourceLength;
    result.y = finite(direction?.y) / sourceLength;
    result.z = finite(direction?.z) / sourceLength;
    return result;
  }

  const alpha = clamp(Math.max(0, finite(strength)) * Math.max(0, finite(dt)), 0, maxAlpha);
  const x = finite(direction?.x) / sourceLength
    + (finite(targetDirection?.x) / targetLength - finite(direction?.x) / sourceLength) * alpha;
  const y = finite(direction?.y) / sourceLength
    + (finite(targetDirection?.y) / targetLength - finite(direction?.y) / sourceLength) * alpha;
  const z = finite(direction?.z) / sourceLength
    + (finite(targetDirection?.z) / targetLength - finite(direction?.z) / sourceLength) * alpha;
  const length = Math.hypot(x, y, z) || 1;
  result.x = x / length;
  result.y = y / length;
  result.z = z / length;
  return result;
}
