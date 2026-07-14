export const BUSTER_LAB_LEGACY_STORAGE_KEY = 'ruinDigger.busterLab.v1';
export const BUSTER_LAB_STORAGE_PREFIX = 'ruinDigger.busterLab.v2';
export const BUSTER_SAVE_CONTEXT_KEY = 'ruinDigger.saveContext.v1';
export const BUSTER_LAB_V1_IMPORT_CLAIM_KEY = 'ruinDigger.busterLab.v1.importClaim';
export const BUSTER_LAB_ENVELOPE_VERSION = 2;
export const BUSTER_LAB_LOCK_TIMEOUT_MS = 5_000;

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function randomToken() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    // Fall through to the deterministic-enough local fallback below.
  }
  const random = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${random || 'local'}`;
}

export function sanitizeSaveContextId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) return null;
  return /^[a-zA-Z0-9._:-]+$/.test(trimmed) ? trimmed : null;
}

export function createSaveContextId(idFactory = null) {
  const supplied = typeof idFactory === 'function' ? idFactory('saveContext') : null;
  return sanitizeSaveContextId(supplied) ?? `campaign-${randomToken()}`;
}

export function readSaveContext(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(BUSTER_SAVE_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return sanitizeSaveContextId(parsed?.saveContextId ?? parsed);
  } catch {
    return null;
  }
}

export function resolveSaveContext(storage, {
  saveContextId = null,
  idFactory = null,
  create = true,
} = {}) {
  const explicit = sanitizeSaveContextId(saveContextId);
  if (explicit) return { saveContextId: explicit, created: false, persisted: false };

  const existing = readSaveContext(storage);
  if (existing) return { saveContextId: existing, created: false, persisted: true };
  if (!create) return { saveContextId: null, created: false, persisted: false };

  const next = createSaveContextId(idFactory);
  let persisted = false;
  try {
    storage?.setItem(BUSTER_SAVE_CONTEXT_KEY, JSON.stringify({
      storageVersion: 1,
      saveContextId: next,
      createdAt: new Date().toISOString(),
    }));
    persisted = Boolean(storage);
  } catch {
    // The caller can still use an ephemeral context and surface its own warning.
  }
  return { saveContextId: next, created: true, persisted };
}

export function rotateSaveContext(storage, { idFactory = null } = {}) {
  const saveContextId = createSaveContextId(idFactory);
  storage?.setItem(BUSTER_SAVE_CONTEXT_KEY, JSON.stringify({
    storageVersion: 1,
    saveContextId,
    createdAt: new Date().toISOString(),
  }));
  return saveContextId;
}

export function getBusterLabStorageKeys(saveContextId) {
  const contextId = sanitizeSaveContextId(saveContextId);
  if (!contextId) throw new TypeError('A valid saveContextId is required.');
  const encoded = encodeURIComponent(contextId);
  const main = `${BUSTER_LAB_STORAGE_PREFIX}.${encoded}`;
  return Object.freeze({
    main,
    backup: `${main}.backup`,
    corrupt: `${main}.corrupt`,
  });
}

export function getBusterLabLockName(saveContextId) {
  const contextId = sanitizeSaveContextId(saveContextId);
  if (!contextId) throw new TypeError('A valid saveContextId is required.');
  return `ruinDigger:busterLab:${contextId}`;
}

export function createBusterLabEnvelope({
  saveContextId,
  state,
  revision = 0,
  writeId = null,
  updatedAt = null,
} = {}) {
  const contextId = sanitizeSaveContextId(saveContextId);
  if (!contextId) throw new TypeError('A valid saveContextId is required.');
  const safeRevision = Math.max(0, Math.trunc(Number(revision)) || 0);
  return {
    storageVersion: BUSTER_LAB_ENVELOPE_VERSION,
    saveContextId: contextId,
    revision: safeRevision,
    writeId: typeof writeId === 'string' && writeId ? writeId : `write-${randomToken()}`,
    updatedAt: typeof updatedAt === 'string' && updatedAt ? updatedAt : new Date().toISOString(),
    state: cloneJson(state, {}),
  };
}

export function parseBusterLabEnvelope(value, { expectedSaveContextId = null } = {}) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : cloneJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Buster Lab envelope is not an object.');
  }
  if (Number(parsed.storageVersion) !== BUSTER_LAB_ENVELOPE_VERSION || !parsed.state) {
    throw new TypeError('Buster Lab payload is not a v2 storage envelope.');
  }
  const contextId = sanitizeSaveContextId(parsed.saveContextId);
  if (!contextId) throw new TypeError('Buster Lab envelope has no valid save context.');
  if (expectedSaveContextId && contextId !== expectedSaveContextId) {
    throw new RangeError(`Buster Lab save belongs to ${contextId}, not ${expectedSaveContextId}.`);
  }
  const revision = Math.trunc(Number(parsed.revision));
  if (!Number.isFinite(revision) || revision < 0) {
    throw new TypeError('Buster Lab envelope has an invalid revision.');
  }
  if (typeof parsed.writeId !== 'string' || !parsed.writeId) {
    throw new TypeError('Buster Lab envelope has no write id.');
  }
  return createBusterLabEnvelope({
    saveContextId: contextId,
    state: parsed.state,
    revision,
    writeId: parsed.writeId,
    updatedAt: parsed.updatedAt,
  });
}

/**
 * Classifies a browser `storage` event for one context-scoped Buster Lab key.
 * Keeping this parser pure makes the cross-tab detector straightforward to
 * exercise without a browser and ensures malformed foreign writes are never
 * mistaken for a harmless update.
 */
export function inspectBusterLabStorageEvent(event, {
  storageKey,
  saveContextId,
} = {}) {
  if (!event || event.key !== storageKey) return { relevant: false };
  if (event.newValue == null) {
    return { relevant: true, removed: true, envelope: null, error: null };
  }
  try {
    return {
      relevant: true,
      removed: false,
      envelope: parseBusterLabEnvelope(event.newValue, {
        expectedSaveContextId: saveContextId,
      }),
      error: null,
    };
  } catch (error) {
    return { relevant: true, removed: false, envelope: null, error };
  }
}

/** Creates a portable, read-only recovery bundle without mutating storage. */
export function createBusterLabRecoveryBundle({
  saveContextId,
  activeEnvelope = null,
  main = null,
  backup = null,
  corrupt = null,
  exportedAt = null,
} = {}) {
  const contextId = sanitizeSaveContextId(saveContextId);
  if (!contextId) throw new TypeError('A valid saveContextId is required.');
  return {
    format: 'ruin-digger-buster-lab-recovery',
    formatVersion: 1,
    saveContextId: contextId,
    exportedAt: typeof exportedAt === 'string' && exportedAt
      ? exportedAt
      : new Date().toISOString(),
    activeEnvelope: cloneJson(activeEnvelope),
    durablePayloads: {
      main: typeof main === 'string' ? main : null,
      backup: typeof backup === 'string' ? backup : null,
      corrupt: typeof corrupt === 'string' ? corrupt : null,
    },
  };
}

export class BusterLabConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BusterLabConflictError';
    this.code = 'BUSTER_LAB_CONFLICT';
    Object.assign(this, details);
  }
}

export class BusterLabLockTimeoutError extends Error {
  constructor(lockName, timeoutMs) {
    super(`Timed out waiting ${timeoutMs}ms for ${lockName}.`);
    this.name = 'BusterLabLockTimeoutError';
    this.code = 'BUSTER_LAB_LOCK_TIMEOUT';
    this.lockName = lockName;
    this.timeoutMs = timeoutMs;
  }
}

/** A small Web Locks-compatible queue used by Node/unit tests and memory stores. */
export class MemoryLockManager {
  constructor() {
    this.tails = new Map();
  }

  async request(name, optionsOrCallback, maybeCallback) {
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback ?? {};
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    if (typeof callback !== 'function') throw new TypeError('A lock callback is required.');
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('Lock request aborted.');

    const prior = this.tails.get(name) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const tail = prior.catch(() => {}).then(() => current);
    this.tails.set(name, tail);

    let abortReject = null;
    const aborted = options.signal
      ? new Promise((_, reject) => { abortReject = reject; })
      : null;
    const onAbort = () => abortReject?.(options.signal.reason ?? new Error('Lock request aborted.'));
    options.signal?.addEventListener?.('abort', onAbort, { once: true });
    let acquired = false;
    try {
      if (aborted) await Promise.race([prior.catch(() => {}), aborted]);
      else await prior.catch(() => {});
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('Lock request aborted.');
      acquired = true;
      return await callback({ name, mode: options.mode ?? 'exclusive' });
    } finally {
      options.signal?.removeEventListener?.('abort', onAbort);
      if (acquired) release();
      else prior.catch(() => {}).finally(release);
      tail.finally(() => {
        if (this.tails.get(name) === tail) this.tails.delete(name);
      });
    }
  }
}

const nodeMemoryLocks = new MemoryLockManager();

export function resolveBusterLabLockManager(explicit = undefined) {
  if (explicit !== undefined) return explicit;
  try {
    if (globalThis.navigator?.locks?.request) return globalThis.navigator.locks;
  } catch {
    // Treat a browser that denies lock access as unsupported/read-only.
  }
  // A process-local queue is safe for unit tests and non-browser memory stores.
  return typeof globalThis.window === 'undefined' ? nodeMemoryLocks : null;
}

export async function withBusterLabLock(lockManager, lockName, callback, {
  timeoutMs = BUSTER_LAB_LOCK_TIMEOUT_MS,
} = {}) {
  if (!lockManager?.request) {
    throw new TypeError('A Web Locks-compatible lock manager is required for durable writes.');
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  if (controller && timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(new BusterLabLockTimeoutError(lockName, timeoutMs));
    }, timeoutMs);
  }
  try {
    return await lockManager.request(lockName, {
      mode: 'exclusive',
      signal: controller?.signal,
    }, callback);
  } catch (error) {
    if (controller?.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new BusterLabLockTimeoutError(lockName, timeoutMs);
    }
    throw error;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
