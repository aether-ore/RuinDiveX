/**
 * Deterministic, renderer-free serialization helpers for authored level data.
 * The editor contract deliberately accepts JSON-safe values only. Rejecting
 * undefined, class instances, non-finite numbers, and cycles here keeps hashes,
 * IndexedDB records, module exports, and playtest snapshots identical.
 */

export class LevelDataSerializationError extends TypeError {
  constructor(message, path = '$') {
    super(`${message} at ${path}`);
    this.name = 'LevelDataSerializationError';
    this.path = path;
  }
}

export function isPlainJsonObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function visitJson(value, path, ancestors, visitor) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return visitor.primitive(value, path);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new LevelDataSerializationError('Non-finite numbers are not JSON-safe', path);
    }
    return visitor.primitive(Object.is(value, -0) ? 0 : value, path);
  }
  if (typeof value !== 'object') {
    throw new LevelDataSerializationError(`Unsupported ${typeof value} value`, path);
  }
  if (ancestors.has(value)) {
    throw new LevelDataSerializationError('Circular reference', path);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return visitor.array(value, path, (child, index) => (
        visitJson(child, `${path}[${index}]`, ancestors, visitor)
      ));
    }
    if (!isPlainJsonObject(value)) {
      throw new LevelDataSerializationError(
        `Unsupported object type ${value?.constructor?.name ?? 'unknown'}`,
        path,
      );
    }
    return visitor.object(value, path, (child, key) => (
      visitJson(child, `${path}.${key}`, ancestors, visitor)
    ));
  } finally {
    ancestors.delete(value);
  }
}

export function assertJsonSafe(value) {
  visitJson(value, '$', new Set(), {
    primitive: () => undefined,
    array: (array, _path, visit) => array.forEach((entry, index) => visit(entry, index)),
    object: (object, _path, visit) => Object.keys(object).forEach((key) => visit(object[key], key)),
  });
  return value;
}

export function cloneJsonValue(value) {
  return visitJson(value, '$', new Set(), {
    primitive: (entry) => entry,
    array: (array, _path, visit) => array.map((entry, index) => visit(entry, index)),
    object: (object, _path, visit) => {
      const clone = {};
      for (const key of Object.keys(object)) clone[key] = visit(object[key], key);
      return clone;
    },
  });
}

export function canonicalStringify(value, { omitKeys = [] } = {}) {
  const omitted = new Set(omitKeys.map(String));
  return visitJson(value, '$', new Set(), {
    primitive: (entry) => JSON.stringify(entry),
    array: (array, _path, visit) => (
      `[${array.map((entry, index) => visit(entry, index)).join(',')}]`
    ),
    object: (object, _path, visit) => {
      const fields = [];
      for (const key of Object.keys(object).sort()) {
        if (omitted.has(key)) continue;
        fields.push(`${JSON.stringify(key)}:${visit(object[key], key)}`);
      }
      return `{${fields.join(',')}}`;
    },
  });
}

export const canonicalJson = canonicalStringify;
export const canonicalJSONStringify = canonicalStringify;
export const canonicalizeJson = canonicalStringify;

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

// A small synchronous SHA-256 implementation keeps canonical document hashes
// available in browser render paths without importing Node's crypto module.
export function sha256Text(text) {
  const bytes = new TextEncoder().encode(String(text));
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const highBits = Math.floor(bitLength / 0x100000000);
  const lowBits = bitLength >>> 0;
  view.setUint32(paddedLength - 8, highBits, false);
  view.setUint32(paddedLength - 4, lowBits, false);

  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15];
      const b = words[index - 2];
      const s0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
      const s1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, '0')).join('');
}

export function canonicalHash(value, options = {}) {
  const { namespace = 'ruindivex-level-data/v1', omitKeys = [] } = options;
  const text = `${namespace}\u0000${canonicalStringify(value, { omitKeys })}`;
  return `sha256:${sha256Text(text)}`;
}

export const hashCanonicalValue = canonicalHash;
export const computeCanonicalHash = canonicalHash;

export function deepFreezeJsonValue(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreezeJsonValue(child, seen);
  return Object.freeze(value);
}

export function canonicalClone(value) {
  return JSON.parse(canonicalStringify(value));
}
