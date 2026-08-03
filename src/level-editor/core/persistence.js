import { assertJsonSafe, cloneJsonValue } from './canonical.js';
import { migrateLevelEditorProject, normalizeLevelEditorProject } from './contracts.js';
import { LevelDataValidationError, validateLevelEditorProject } from './validation.js';

export const LEVEL_PROJECT_DB_NAME = 'ruindivex-level-editor';
export const LEVEL_PROJECT_DB_VERSION = 1;
export const LEVEL_PROJECT_STORES = Object.freeze({
  PROJECTS: 'projects',
  ASSETS: 'assets',
  SNAPSHOTS: 'playtestSnapshots',
});

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function isoNow(clock) {
  const value = typeof clock === 'function' ? clock() : new Date().toISOString();
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  throw new TypeError('clock must return an ISO string or Date.');
}

function snapshotId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `snapshot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function normalizeSha256Hash(value) {
  const hash = String(value ?? '');
  if (/^[0-9a-f]{64}$/i.test(hash)) return `sha256:${hash.toLowerCase()}`;
  if (/^sha256:[0-9a-f]{64}$/i.test(hash)) return hash.toLowerCase();
  return hash;
}

export async function hashBlobSha256(blob, { crypto = globalThis.crypto } = {}) {
  if (!blob || typeof blob.arrayBuffer !== 'function') {
    throw new TypeError('Asset must be a Blob or Blob-like value with arrayBuffer().');
  }
  if (!crypto?.subtle?.digest) {
    throw new Error('SHA-256 asset hashing requires Web Crypto subtle.digest.');
  }
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

function projectRecord(project) {
  return {
    projectId: project.projectId,
    name: project.name,
    revision: project.revision,
    updatedAt: project.updatedAt,
    project,
  };
}

function ensureStore(database, name, options, indexes = []) {
  const store = database.objectStoreNames.contains(name)
    ? null
    : database.createObjectStore(name, options);
  if (!store) return;
  for (const [indexName, keyPath, indexOptions] of indexes) {
    store.createIndex(indexName, keyPath, indexOptions);
  }
}

export class LevelProjectStore {
  constructor(options = {}) {
    if (typeof options === 'string') options = { dbName: options };
    this.indexedDB = options.indexedDB ?? globalThis.indexedDB;
    this.dbName = options.dbName ?? options.namespace ?? LEVEL_PROJECT_DB_NAME;
    this.version = options.version ?? LEVEL_PROJECT_DB_VERSION;
    this.crypto = options.crypto ?? globalThis.crypto;
    this.clock = options.clock;
    this._openPromise = null;
    this._database = null;
  }

  async open() {
    if (this._database) return this._database;
    if (this._openPromise) return this._openPromise;
    if (!this.indexedDB?.open) {
      throw new Error('IndexedDB is unavailable; inject an indexedDB implementation into LevelProjectStore.');
    }
    this._openPromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.dbName, this.version);
      request.onupgradeneeded = () => {
        const database = request.result;
        ensureStore(database, LEVEL_PROJECT_STORES.PROJECTS, { keyPath: 'projectId' }, [
          ['updatedAt', 'updatedAt', { unique: false }],
          ['name', 'name', { unique: false }],
        ]);
        ensureStore(database, LEVEL_PROJECT_STORES.ASSETS, { keyPath: 'hash' }, [
          ['createdAt', 'createdAt', { unique: false }],
        ]);
        ensureStore(database, LEVEL_PROJECT_STORES.SNAPSHOTS, { keyPath: 'snapshotId' }, [
          ['projectId', 'projectId', { unique: false }],
          ['expiresAt', 'expiresAt', { unique: false }],
          ['createdAt', 'createdAt', { unique: false }],
        ]);
      };
      request.onsuccess = () => {
        this._database = request.result;
        this._database.onversionchange = () => this.close();
        resolve(this._database);
      };
      request.onerror = () => {
        this._openPromise = null;
        reject(request.error ?? new Error('Could not open the level project database.'));
      };
      request.onblocked = () => {
        // The request may still succeed once another tab closes its old handle.
      };
    });
    return this._openPromise;
  }

  close() {
    this._database?.close();
    this._database = null;
    this._openPromise = null;
  }

  async saveProject(input, options = {}) {
    const project = migrateLevelEditorProject(input, { clock: this.clock });
    if (options.touch !== false) project.updatedAt = isoNow(this.clock);
    const validation = validateLevelEditorProject(project, {
      ...options,
      requireSpawn: options.requireSpawn ?? false,
    });
    if (!validation.ok && options.allowInvalid !== true) {
      throw new LevelDataValidationError('Refusing to save an invalid level editor project.', validation);
    }
    const database = await this.open();
    const transaction = database.transaction(LEVEL_PROJECT_STORES.PROJECTS, 'readwrite');
    transaction.objectStore(LEVEL_PROJECT_STORES.PROJECTS).put(projectRecord(project));
    await transactionDone(transaction);
    return cloneJsonValue(project);
  }

  async getProject(projectId) {
    const database = await this.open();
    const transaction = database.transaction(LEVEL_PROJECT_STORES.PROJECTS, 'readonly');
    const done = transactionDone(transaction);
    const record = await requestResult(
      transaction.objectStore(LEVEL_PROJECT_STORES.PROJECTS).get(String(projectId)),
    );
    await done;
    return record?.project ? cloneJsonValue(record.project) : null;
  }

  async listProjects({ includeDocuments = false } = {}) {
    const database = await this.open();
    const transaction = database.transaction(LEVEL_PROJECT_STORES.PROJECTS, 'readonly');
    const done = transactionDone(transaction);
    const records = await requestResult(transaction.objectStore(LEVEL_PROJECT_STORES.PROJECTS).getAll());
    await done;
    return records
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .map((record) => includeDocuments ? cloneJsonValue(record) : ({
        projectId: record.projectId,
        name: record.name,
        revision: record.revision,
        updatedAt: record.updatedAt,
      }));
  }

  async deleteProject(projectId, { snapshots = false } = {}) {
    const database = await this.open();
    const stores = snapshots
      ? [LEVEL_PROJECT_STORES.PROJECTS, LEVEL_PROJECT_STORES.SNAPSHOTS]
      : [LEVEL_PROJECT_STORES.PROJECTS];
    const transaction = database.transaction(stores, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(LEVEL_PROJECT_STORES.PROJECTS).delete(String(projectId));
    if (snapshots) {
      const store = transaction.objectStore(LEVEL_PROJECT_STORES.SNAPSHOTS);
      const records = await requestResult(store.getAll());
      records.filter((record) => record.projectId === String(projectId))
        .forEach((record) => store.delete(record.snapshotId));
    }
    await done;
    return true;
  }

  async putAsset(blob, metadata = {}) {
    const hash = await hashBlobSha256(blob, { crypto: this.crypto });
    if (metadata.hash !== undefined && normalizeSha256Hash(metadata.hash) !== hash) {
      throw new Error(`Asset hash mismatch: expected ${metadata.hash}, calculated ${hash}.`);
    }
    const createdAt = metadata.createdAt ?? isoNow(this.clock);
    const record = {
      hash,
      blob,
      size: Number(blob.size ?? 0),
      mimeType: String(metadata.mimeType ?? blob.type ?? 'application/octet-stream'),
      name: String(metadata.name ?? hash),
      createdAt: String(createdAt),
      metadata: cloneJsonValue(metadata.metadata ?? {}),
    };
    const database = await this.open();
    const transaction = database.transaction(LEVEL_PROJECT_STORES.ASSETS, 'readwrite');
    transaction.objectStore(LEVEL_PROJECT_STORES.ASSETS).put(record);
    await transactionDone(transaction);
    return {
      hash: record.hash,
      size: record.size,
      mimeType: record.mimeType,
      name: record.name,
      createdAt: record.createdAt,
      metadata: record.metadata,
    };
  }

  async getAssetRecord(hash) {
    const database = await this.open();
    const transaction = database.transaction(LEVEL_PROJECT_STORES.ASSETS, 'readonly');
    const done = transactionDone(transaction);
    const record = await requestResult(
      transaction.objectStore(LEVEL_PROJECT_STORES.ASSETS).get(normalizeSha256Hash(hash)),
    );
    await done;
    return record ?? null;
  }

  async getAsset(hash) {
    return (await this.getAssetRecord(hash))?.blob ?? null;
  }

  async hasAsset(hash) {
    const database = await this.open();
    const transaction = database.transaction(LEVEL_PROJECT_STORES.ASSETS, 'readonly');
    const done = transactionDone(transaction);
    const count = await requestResult(
      transaction.objectStore(LEVEL_PROJECT_STORES.ASSETS).count(normalizeSha256Hash(hash)),
    );
    await done;
    return count > 0;
  }

  async listAssets() {
    const database = await this.open();
    const transaction = database.transaction(LEVEL_PROJECT_STORES.ASSETS, 'readonly');
    const done = transactionDone(transaction);
    const records = await requestResult(transaction.objectStore(LEVEL_PROJECT_STORES.ASSETS).getAll());
    await done;
    return records.map(({ blob: _blob, ...metadata }) => cloneJsonValue(metadata));
  }

  async deleteAsset(hash) {
    const database = await this.open();
    const transaction = database.transaction(LEVEL_PROJECT_STORES.ASSETS, 'readwrite');
    transaction.objectStore(LEVEL_PROJECT_STORES.ASSETS).delete(normalizeSha256Hash(hash));
    await transactionDone(transaction);
    return true;
  }

  /**
   * Store the complete playtest payload as one IndexedDB value. Readers can
   * therefore never observe half of a compiled dungeon/registry pair.
   */
  async writePlaytestSnapshot(payload, options = {}) {
    assertJsonSafe(payload);
    const id = String(options.snapshotId ?? snapshotId());
    const createdAt = String(options.createdAt ?? isoNow(this.clock));
    const ttlMs = Number(options.ttlMs ?? 24 * 60 * 60 * 1000);
    const expiresAt = options.expiresAt === null
      ? null
      : String(options.expiresAt ?? new Date(Date.parse(createdAt) + ttlMs).toISOString());
    const project = payload?.project ? normalizeLevelEditorProject(payload.project, { clock: this.clock }) : null;
    const record = {
      snapshotId: id,
      projectId: String(options.projectId ?? payload?.projectId ?? project?.projectId ?? ''),
      createdAt,
      expiresAt,
      payload: cloneJsonValue(payload),
    };
    const database = await this.open();
    const storeNames = options.saveProject === true && project
      ? [LEVEL_PROJECT_STORES.SNAPSHOTS, LEVEL_PROJECT_STORES.PROJECTS]
      : [LEVEL_PROJECT_STORES.SNAPSHOTS];
    const transaction = database.transaction(storeNames, 'readwrite');
    transaction.objectStore(LEVEL_PROJECT_STORES.SNAPSHOTS).put(record);
    if (options.saveProject === true && project) {
      transaction.objectStore(LEVEL_PROJECT_STORES.PROJECTS).put(projectRecord(project));
    }
    await transactionDone(transaction);
    return id;
  }

  async readPlaytestSnapshot(snapshotIdValue, { includeRecord = false, allowExpired = false } = {}) {
    const database = await this.open();
    const transaction = database.transaction(LEVEL_PROJECT_STORES.SNAPSHOTS, 'readonly');
    const done = transactionDone(transaction);
    const record = await requestResult(
      transaction.objectStore(LEVEL_PROJECT_STORES.SNAPSHOTS).get(String(snapshotIdValue)),
    );
    await done;
    if (!record) return null;
    if (!allowExpired && record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) return null;
    return includeRecord ? cloneJsonValue(record) : cloneJsonValue(record.payload);
  }

  async deletePlaytestSnapshot(snapshotIdValue) {
    const database = await this.open();
    const transaction = database.transaction(LEVEL_PROJECT_STORES.SNAPSHOTS, 'readwrite');
    transaction.objectStore(LEVEL_PROJECT_STORES.SNAPSHOTS).delete(String(snapshotIdValue));
    await transactionDone(transaction);
    return true;
  }

  async listPlaytestSnapshots({ projectId, includeExpired = false } = {}) {
    const database = await this.open();
    const transaction = database.transaction(LEVEL_PROJECT_STORES.SNAPSHOTS, 'readonly');
    const done = transactionDone(transaction);
    const records = await requestResult(transaction.objectStore(LEVEL_PROJECT_STORES.SNAPSHOTS).getAll());
    await done;
    const now = Date.now();
    return records.filter((record) => (
      (projectId === undefined || record.projectId === String(projectId))
      && (includeExpired || !record.expiresAt || Date.parse(record.expiresAt) > now)
    )).map(({ payload: _payload, ...metadata }) => cloneJsonValue(metadata));
  }

  async cleanupPlaytestSnapshots({ now = Date.now(), projectId } = {}) {
    const timestamp = now instanceof Date ? now.getTime() : Number(now);
    const database = await this.open();
    const transaction = database.transaction(LEVEL_PROJECT_STORES.SNAPSHOTS, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(LEVEL_PROJECT_STORES.SNAPSHOTS);
    const records = await requestResult(store.getAll());
    const expired = records.filter((record) => (
      record.expiresAt
      && Date.parse(record.expiresAt) <= timestamp
      && (projectId === undefined || record.projectId === String(projectId))
    ));
    expired.forEach((record) => store.delete(record.snapshotId));
    await done;
    return expired.length;
  }

  // Familiar aliases for UI adapters.
  putProject(project, options) { return this.saveProject(project, options); }
  loadProject(projectId) { return this.getProject(projectId); }
  saveAsset(blob, metadata) { return this.putAsset(blob, metadata); }
  savePlaytestSnapshot(payload, options) { return this.writePlaytestSnapshot(payload, options); }
  getPlaytestSnapshot(id, options) { return this.readPlaytestSnapshot(id, options); }
  removePlaytestSnapshot(id) { return this.deletePlaytestSnapshot(id); }
  cleanupSnapshots(options) { return this.cleanupPlaytestSnapshots(options); }
}

export function createLevelProjectStore(options) {
  return new LevelProjectStore(options);
}

export function createTransientPlaytestSnapshotApi(options = {}) {
  const store = options instanceof LevelProjectStore ? options : new LevelProjectStore(options);
  return {
    store,
    write: (payload, writeOptions) => store.writePlaytestSnapshot(payload, writeOptions),
    read: (id, readOptions) => store.readPlaytestSnapshot(id, readOptions),
    delete: (id) => store.deletePlaytestSnapshot(id),
    cleanup: (cleanupOptions) => store.cleanupPlaytestSnapshots(cleanupOptions),
    close: () => store.close(),
  };
}

export function createPlaytestSnapshotPayload({ project, compiled, dungeon, roomRegistry, metadata = {} }) {
  const value = compiled?.value ?? compiled?.dungeon ?? dungeon ?? compiled;
  const registry = roomRegistry ?? compiled?.roomRegistry ?? compiled?.registry ?? null;
  const payload = {
    schema: 'ruindivex-playtest-snapshot/v1',
    projectId: project?.projectId ?? value?.metadata?.sourceProjectId ?? '',
    project: project ? cloneJsonValue(project) : null,
    dungeon: value ? cloneJsonValue(value) : null,
    roomRegistry: registry ? cloneJsonValue(registry) : null,
    metadata: cloneJsonValue(metadata),
  };
  assertJsonSafe(payload);
  return payload;
}
