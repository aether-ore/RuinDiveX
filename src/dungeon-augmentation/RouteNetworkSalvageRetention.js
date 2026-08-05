export const MAX_ROUTE_NETWORK_REALIZATION_ATTEMPT = 7;
export const MAX_RETAINED_ROUTE_NETWORK_SALVAGE_CACHE_ENTRIES = 2_048;
export const MAX_RETAINED_ROUTE_NETWORK_SALVAGE_WITNESSES_PER_ENTRY = 64;
export const MAX_RETAINED_ROUTE_NETWORK_SALVAGE_WITNESSES_TOTAL = 4_096;
export const MAX_RETAINED_ROUTE_NETWORK_SALVAGE_ENTITIES_TOTAL = 131_072;
export const MAX_RETAINED_ROUTE_NETWORK_SALVAGE_ESTIMATED_BYTES = 32 * 1024 * 1024;

const RETENTION_ERROR =
  'Dungeon augmentation salvage witness retention exceeded its bound.';

function retentionError(cause = null) {
  const error = new Error(RETENTION_ERROR);
  if (cause) error.cause = cause;
  return error;
}

export function normalizeRouteNetworkRealizationAttempt(value) {
  const attempt = Number(value);
  if (!Number.isSafeInteger(attempt)
    || attempt < 0
    || attempt > MAX_ROUTE_NETWORK_REALIZATION_ATTEMPT) {
    throw new RangeError(
      `Dungeon augmentation realization attempt must be an integer from 0 to ${
        MAX_ROUTE_NETWORK_REALIZATION_ATTEMPT
      }.`,
    );
  }
  return attempt;
}

function isCompleteSalvageWitness(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && !Array.isArray(value)
      && !value.error
      && value.operation
      && typeof value.operation === 'object'
      && Array.isArray(value.nodes)
      && Array.isArray(value.segments),
  );
}

function assertRetainedGraphBudget(entries) {
  let estimatedBytes = 0;
  let retainedEntityCount = 0;
  const visited = new WeakSet();
  const pendingValues = [];
  const charge = (bytes) => {
    estimatedBytes += Math.max(0, Number(bytes) || 0);
    if (estimatedBytes > MAX_RETAINED_ROUTE_NETWORK_SALVAGE_ESTIMATED_BYTES) {
      throw retentionError();
    }
  };
  const enqueueEnumerableDataProperties = (value, { arrayLength = null } = {}) => {
    charge(32 + (arrayLength == null ? 0 : arrayLength * 8));
    const keys = Object.keys(value);
    charge(keys.length * 8);
    if (Object.getOwnPropertySymbols(value).length > 0) throw retentionError();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw retentionError();
      charge(8 + key.length * 2);
      pendingValues.push(descriptor.value);
    }
  };
  const visit = (value) => {
    if (value == null || typeof value === 'undefined') {
      charge(8);
      return;
    }
    if (typeof value === 'string') {
      charge(16 + value.length * 2);
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      charge(16);
      return;
    }
    if (typeof value !== 'object') throw retentionError();
    if (visited.has(value)) return;
    visited.add(value);
    if (ArrayBuffer.isView(value)) {
      if (!(value.buffer instanceof ArrayBuffer)) throw retentionError();
      // Structured cloning a view clones its backing buffer, not just the
      // exposed slice. Charge that complete allocation so tiny subviews cannot
      // smuggle an oversized buffer through the retention budget.
      charge(32 + value.buffer.byteLength);
      return;
    }
    if (value instanceof ArrayBuffer) {
      charge(32 + value.byteLength);
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Map.prototype) {
      charge(48 + value.size * 24);
      if (Object.keys(value).length > 0
        || Object.getOwnPropertySymbols(value).length > 0) throw retentionError();
      for (const [key, child] of value) pendingValues.push(key, child);
      return;
    }
    if (prototype === Set.prototype) {
      charge(48 + value.size * 16);
      if (Object.keys(value).length > 0
        || Object.getOwnPropertySymbols(value).length > 0) throw retentionError();
      for (const child of value) pendingValues.push(child);
      return;
    }
    if (Array.isArray(value)) {
      enqueueEnumerableDataProperties(value, { arrayLength: value.length });
      return;
    }
    if (prototype !== Object.prototype && prototype !== null) throw retentionError();
    enqueueEnumerableDataProperties(value);
  };

  for (const [key, witnesses] of entries) {
    if (key.length > 512) throw retentionError();
    charge(16 + key.length * 2);
    for (const witness of witnesses) {
      retainedEntityCount += witness.nodes.length + witness.segments.length;
      if (retainedEntityCount > MAX_RETAINED_ROUTE_NETWORK_SALVAGE_ENTITIES_TOTAL) {
        throw retentionError();
      }
      pendingValues.push(witness);
    }
  }
  while (pendingValues.length > 0) visit(pendingValues.pop());
}

function retainedEntryIterable(entries) {
  if (Array.isArray(entries) || entries instanceof Map) return entries;
  if (entries == null) return [];
  throw retentionError();
}

export function normalizeRouteNetworkSalvageWitnessCacheEntries(entries) {
  const normalized = [];
  let totalWitnessCount = 0;
  for (const entry of retainedEntryIterable(entries)) {
    if (!Array.isArray(entry)
      || typeof entry[0] !== 'string'
      || !Array.isArray(entry[1])) continue;
    const [key, witnesses] = entry;
    if (witnesses.length === 0) continue;
    if (witnesses.length > MAX_RETAINED_ROUTE_NETWORK_SALVAGE_WITNESSES_PER_ENTRY
      || witnesses.some((witness) => !isCompleteSalvageWitness(witness))) {
      throw retentionError();
    }
    totalWitnessCount += witnesses.length;
    if (totalWitnessCount > MAX_RETAINED_ROUTE_NETWORK_SALVAGE_WITNESSES_TOTAL) {
      throw retentionError();
    }
    normalized.push([key, witnesses]);
    if (normalized.length > MAX_RETAINED_ROUTE_NETWORK_SALVAGE_CACHE_ENTRIES) {
      throw retentionError();
    }
  }
  assertRetainedGraphBudget(normalized);
  return normalized;
}

export function cloneRouteNetworkSalvageWitnessCacheEntries(entries) {
  if (typeof globalThis.structuredClone !== 'function') throw retentionError();
  const normalized = normalizeRouteNetworkSalvageWitnessCacheEntries(entries);
  try {
    return globalThis.structuredClone(normalized);
  } catch (error) {
    throw retentionError(error);
  }
}

export function retainRouteNetworkSalvageWitnessCache(cache) {
  if (!(cache instanceof Map)) return 0;
  const retainedEntries = cloneRouteNetworkSalvageWitnessCacheEntries(cache);
  cache.clear();
  for (const [key, witnesses] of retainedEntries) cache.set(key, witnesses);
  return cache.size;
}
