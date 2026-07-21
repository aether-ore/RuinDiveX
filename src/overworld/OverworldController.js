import { getTerrainCell } from './OverworldPlan.js';

function blockerBounds(blocker) {
  if (blocker.kind === 'cylinder') {
    return {
      minX: blocker.x - blocker.radius,
      maxX: blocker.x + blocker.radius,
      minZ: blocker.z - blocker.radius,
      maxZ: blocker.z + blocker.radius,
    };
  }
  const angle = blocker.rotationY ?? 0;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const halfWidth = (blocker.halfWidth ?? 0) * cos + (blocker.halfDepth ?? 0) * sin;
  const halfDepth = (blocker.halfWidth ?? 0) * sin + (blocker.halfDepth ?? 0) * cos;
  return {
    minX: blocker.x - halfWidth,
    maxX: blocker.x + halfWidth,
    minZ: blocker.z - halfDepth,
    maxZ: blocker.z + halfDepth,
  };
}

function spatialKey(x, z) {
  return `${x},${z}`;
}

export class SpatialBlockerHash {
  constructor(cellSize = 6) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('SpatialBlockerHash cellSize must be positive');
    this.cellSize = cellSize;
    this.buckets = new Map();
    this.blockers = new Map();
    this.keysById = new Map();
  }

  get size() {
    return this.blockers.size;
  }

  _cell(value) {
    return Math.floor(value / this.cellSize);
  }

  insert(blocker) {
    if (!blocker?.id) throw new Error('Spatial blockers require stable IDs');
    this.remove(blocker.id);
    const bounds = blockerBounds(blocker);
    const keys = [];
    for (let z = this._cell(bounds.minZ); z <= this._cell(bounds.maxZ); z += 1) {
      for (let x = this._cell(bounds.minX); x <= this._cell(bounds.maxX); x += 1) {
        const key = spatialKey(x, z);
        const bucket = this.buckets.get(key) ?? new Set();
        bucket.add(blocker.id);
        this.buckets.set(key, bucket);
        keys.push(key);
      }
    }
    this.blockers.set(blocker.id, blocker);
    this.keysById.set(blocker.id, keys);
    return blocker;
  }

  insertMany(blockers = []) {
    for (const blocker of blockers) this.insert(blocker);
    return this;
  }

  remove(blockerOrId) {
    const id = typeof blockerOrId === 'string' ? blockerOrId : blockerOrId?.id;
    if (!id || !this.blockers.has(id)) return false;
    for (const key of this.keysById.get(id) ?? []) {
      const bucket = this.buckets.get(key);
      bucket?.delete(id);
      if (bucket?.size === 0) this.buckets.delete(key);
    }
    this.keysById.delete(id);
    return this.blockers.delete(id);
  }

  clear() {
    this.buckets.clear();
    this.blockers.clear();
    this.keysById.clear();
  }

  has(id) {
    return this.blockers.has(id);
  }

  query(position, radius = 0) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return [];
    const safeRadius = Math.max(0, Number(radius) || 0);
    const ids = new Set();
    for (let z = this._cell(position.z - safeRadius); z <= this._cell(position.z + safeRadius); z += 1) {
      for (let x = this._cell(position.x - safeRadius); x <= this._cell(position.x + safeRadius); x += 1) {
        for (const id of this.buckets.get(spatialKey(x, z)) ?? []) ids.add(id);
      }
    }
    return [...ids].map((id) => this.blockers.get(id)).filter(Boolean);
  }
}

function rotateIntoBlocker(position, blocker) {
  const dx = position.x - blocker.x;
  const dz = position.z - blocker.z;
  const angle = blocker.rotationY ?? 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: dx * cos + dz * sin,
    z: -dx * sin + dz * cos,
  };
}

function intersectsBlocker(position, blocker, radius, height) {
  const feetY = Number(position.y) || 0;
  const bodyMinimum = feetY;
  const bodyMaximum = feetY + height;
  const blockerMinimum = (blocker.y ?? 0) - (blocker.halfHeight ?? Infinity);
  const blockerMaximum = (blocker.y ?? 0) + (blocker.halfHeight ?? Infinity);
  if (bodyMaximum <= blockerMinimum || bodyMinimum >= blockerMaximum) return false;

  if (blocker.kind === 'cylinder') {
    return (position.x - blocker.x) ** 2 + (position.z - blocker.z) ** 2
      < ((blocker.radius ?? 0) + radius) ** 2;
  }
  const local = rotateIntoBlocker(position, blocker);
  return Math.abs(local.x) < (blocker.halfWidth ?? 0) + radius
    && Math.abs(local.z) < (blocker.halfDepth ?? 0) + radius;
}

export function isInteractionActivationSideSatisfied(interaction, position, tolerance = 0.05) {
  const side = interaction?.activationSide;
  if (side == null) return true;
  if (!position || !['x', 'y', 'z'].includes(side.axis) || ![-1, 1].includes(side.sign)) {
    return false;
  }
  const anchor = Number(interaction?.[side.axis]);
  const coordinate = Number(position?.[side.axis]);
  if (!Number.isFinite(anchor) || !Number.isFinite(coordinate)) return false;
  return (coordinate - anchor) * side.sign >= -Math.max(0, Number(tolerance) || 0);
}

export class OverworldController {
  constructor({ plan, facade = null, blockerCellSize = 6 } = {}) {
    if (!plan?.terrain) throw new Error('OverworldController requires an OverworldPlan');
    this.plan = plan;
    this.facade = facade;
    this.blockerHash = new SpatialBlockerHash(blockerCellSize).insertMany(plan.blockers);
    this.nearestInteractable = null;
    this.lastSafePosition = { ...plan.anchors.playerStart };
  }

  worldToCell(x, z) {
    const terrain = this.plan.terrain;
    return {
      x: Math.floor((x - terrain.originX) / terrain.cellSize),
      z: Math.floor((z - terrain.originZ) / terrain.cellSize),
    };
  }

  isWithinPlayableCore(positionOrX, maybeZ, radius = 0) {
    const x = typeof positionOrX === 'object' ? positionOrX?.x : positionOrX;
    const z = typeof positionOrX === 'object' ? positionOrX?.z : maybeZ;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const terrain = this.plan.terrain;
    const maxX = terrain.originX + terrain.width * terrain.cellSize;
    const maxZ = terrain.originZ + terrain.depth * terrain.cellSize;
    return x - radius >= terrain.originX && x + radius <= maxX
      && z - radius >= terrain.originZ && z + radius <= maxZ;
  }

  getFloorInfo(x, z) {
    return getTerrainCell(this.plan, x, z, { world: true });
  }

  getHeightAt(x, z) {
    return this.getFloorInfo(x, z)?.height ?? null;
  }

  getSurfaceAt(x, z) {
    return this.getFloorInfo(x, z)?.surfaceId ?? null;
  }

  isPositionWalkable(position, { radius = 0.42 } = {}) {
    return this.isWithinPlayableCore(position, undefined, radius)
      && this.getHeightAt(position.x, position.z) !== null
      && !this.isPositionBlocked(position, { radius });
  }

  queryBlockers(position, radius = 0) {
    return this.blockerHash.query(position, radius);
  }

  getBlockingObjects(position, { radius = 0.42, height = 1.8 } = {}) {
    return this.queryBlockers(position, radius)
      .filter((blocker) => intersectsBlocker(position, blocker, radius, height));
  }

  isPositionBlocked(position, options = {}) {
    const radius = options.radius ?? 0.42;
    if (!this.isWithinPlayableCore(position, undefined, radius)) return true;
    return this.getBlockingObjects(position, options).length > 0;
  }

  resolveMovement(fromPosition, targetPosition, {
    radius = 0.42,
    height = 1.8,
    maximumStep = this.plan.dimensions.groundedStepAllowance,
    allowSlide = true,
  } = {}) {
    const fromHeight = this.getHeightAt(fromPosition.x, fromPosition.z);
    const candidates = [
      { x: targetPosition.x, z: targetPosition.z },
      ...(allowSlide ? [
        { x: targetPosition.x, z: fromPosition.z },
        { x: fromPosition.x, z: targetPosition.z },
      ] : []),
    ];

    for (const candidate of candidates) {
      const candidateIsOrigin = Math.abs(candidate.x - fromPosition.x) < 0.000001
        && Math.abs(candidate.z - fromPosition.z) < 0.000001;
      const targetDiffersFromOrigin = Math.abs(targetPosition.x - fromPosition.x) >= 0.000001
        || Math.abs(targetPosition.z - fromPosition.z) >= 0.000001;
      if (candidateIsOrigin && targetDiffersFromOrigin) continue;
      const groundY = this.getHeightAt(candidate.x, candidate.z);
      if (groundY === null || (fromHeight !== null && Math.abs(groundY - fromHeight) > maximumStep)) continue;
      const position = { x: candidate.x, y: groundY, z: candidate.z };
      if (!this.isPositionBlocked(position, { radius, height })) {
        this.lastSafePosition = { ...position };
        return Object.freeze({
          blocked: false,
          slid: candidate.x !== targetPosition.x || candidate.z !== targetPosition.z,
          position: Object.freeze(position),
          blockers: Object.freeze([]),
        });
      }
    }

    const fallback = {
      x: fromPosition.x,
      y: fromHeight ?? fromPosition.y ?? 0,
      z: fromPosition.z,
    };
    return Object.freeze({
      blocked: true,
      slid: false,
      position: Object.freeze(fallback),
      blockers: Object.freeze(this.getBlockingObjects(
        { x: targetPosition.x, y: targetPosition.y ?? fallback.y, z: targetPosition.z },
        { radius, height },
      )),
    });
  }

  getNearestInteractable(position, maximumRadius = Infinity) {
    if (!position) return null;
    let nearest = null;
    let nearestDistanceSq = Number.isFinite(maximumRadius) ? maximumRadius ** 2 : Infinity;
    for (const interaction of this.plan.interactions) {
      if (!isInteractionActivationSideSatisfied(interaction, position)) continue;
      const distanceSq = (position.x - interaction.x) ** 2
        + (position.y - interaction.y) ** 2
        + (position.z - interaction.z) ** 2;
      const radius = Math.min(interaction.interactionRadius, maximumRadius);
      if (distanceSq > radius ** 2 || distanceSq >= nearestDistanceSq) continue;
      nearest = interaction;
      nearestDistanceSq = distanceSq;
    }
    return nearest;
  }

  update(playerPosition) {
    this.nearestInteractable = this.getNearestInteractable(playerPosition);
    return this.nearestInteractable;
  }

  getDiagnostics() {
    return Object.freeze({
      worldKind: 'overworld',
      planHash: this.plan.planHash,
      blockerCount: this.blockerHash.size,
      nearestInteractableId: this.nearestInteractable?.id ?? null,
      lastSafePosition: Object.freeze({ ...this.lastSafePosition }),
    });
  }

  dispose() {
    this.blockerHash.clear();
    this.facade = null;
    this.nearestInteractable = null;
  }
}
