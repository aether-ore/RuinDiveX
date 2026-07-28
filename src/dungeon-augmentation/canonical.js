const HASH_LANE_OFFSETS = Object.freeze([
  0x811c9dc5,
  0x9e3779b9,
  0x85ebca6b,
  0xc2b2ae35,
]);

const HASH_LANE_PRIMES = Object.freeze([
  0x01000193,
  0x27d4eb2d,
  0x165667b1,
  0x9e3779b1,
]);

export class DungeonAugmentationSerializationError extends TypeError {
  constructor(message, path = '$') {
    super(`${message} at ${path}`);
    this.name = 'DungeonAugmentationSerializationError';
    this.path = path;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serializePrimitive(value, path, { inArray = false } = {}) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) return 'null';
      return Object.is(value, -0) ? '0' : String(value);
    case 'undefined':
      return inArray ? 'null' : undefined;
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new DungeonAugmentationSerializationError(
        `Unsupported ${typeof value} value`,
        path,
      );
    default:
      return null;
  }
}

/**
 * Produces a deterministic JSON representation for renderer-free plan data.
 * Object keys are sorted, object `undefined` values are omitted, and array
 * `undefined` values follow JSON semantics and become null.
 */
export function canonicalStringify(value, { omitKeys = [] } = {}) {
  const omitted = new Set(omitKeys);
  const ancestors = new Set();

  const visit = (entry, path, inArray = false) => {
    const primitive = serializePrimitive(entry, path, { inArray });
    if (primitive !== null) return primitive;
    if (entry === null || typeof entry !== 'object') return primitive;

    if (ancestors.has(entry)) {
      throw new DungeonAugmentationSerializationError('Circular reference', path);
    }
    ancestors.add(entry);
    try {
      if (Array.isArray(entry)) {
        return `[${entry.map((child, index) => (
          visit(child, `${path}[${index}]`, true) ?? 'null'
        )).join(',')}]`;
      }
      if (!isPlainObject(entry)) {
        throw new DungeonAugmentationSerializationError(
          `Unsupported object type ${entry.constructor?.name ?? 'unknown'}`,
          path,
        );
      }
      const fields = [];
      for (const key of Object.keys(entry).sort()) {
        if (omitted.has(key)) continue;
        const child = visit(entry[key], `${path}.${key}`, false);
        if (child !== undefined) fields.push(`${JSON.stringify(key)}:${child}`);
      }
      return `{${fields.join(',')}}`;
    } finally {
      ancestors.delete(entry);
    }
  };

  return visit(value, '$', false);
}

function avalanche(value) {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * Browser-safe stable hash. Four independently mixed 32-bit lanes make
 * accidental collisions much less likely than the project's legacy 32-bit
 * hashes without importing Node crypto into runtime planning code.
 */
export function stableHashText(text, namespace = 'ruindivex-dungeon-augmentation/v1') {
  const input = `${namespace}\u0000${String(text)}`;
  const lanes = HASH_LANE_OFFSETS.slice();
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    for (let lane = 0; lane < lanes.length; lane += 1) {
      lanes[lane] ^= code + Math.imul(index + 1, lane + 17);
      lanes[lane] = Math.imul(lanes[lane], HASH_LANE_PRIMES[lane]);
      lanes[lane] ^= lanes[lane] >>> (11 + lane);
    }
  }
  return `v1-${lanes
    .map((value, index) => avalanche(value ^ Math.imul(input.length + 1, index + 1)))
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('')}`;
}

export function hashCanonicalValue(value, options = {}) {
  const { namespace = 'ruindivex-dungeon-augmentation/v1', omitKeys = [] } = options;
  return stableHashText(canonicalStringify(value, { omitKeys }), namespace);
}

export function cloneDungeonAugmentationValue(value, path = '$', ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'undefined') return undefined;
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new DungeonAugmentationSerializationError(`Unsupported ${typeof value} value`, path);
  }
  if (ancestors.has(value)) {
    throw new DungeonAugmentationSerializationError('Circular reference', path);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => {
        const clone = cloneDungeonAugmentationValue(entry, `${path}[${index}]`, ancestors);
        return clone === undefined ? null : clone;
      });
    }
    if (!isPlainObject(value)) {
      throw new DungeonAugmentationSerializationError(
        `Unsupported object type ${value.constructor?.name ?? 'unknown'}`,
        path,
      );
    }
    const clone = {};
    for (const key of Object.keys(value)) {
      const child = cloneDungeonAugmentationValue(value[key], `${path}.${key}`, ancestors);
      if (child !== undefined) clone[key] = child;
    }
    return clone;
  } finally {
    ancestors.delete(value);
  }
}

export function deepFreezeDungeonAugmentationValue(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) {
    deepFreezeDungeonAugmentationValue(child, seen);
  }
  return Object.freeze(value);
}

