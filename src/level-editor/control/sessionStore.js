import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export const LEVEL_FORGE_SESSION_SCHEMA = 'ruindivex-level-forge-session/v1';
export const DEFAULT_SESSION_TTL_MS = 6 * 60 * 60 * 1_000;

const SESSION_ID_PATTERN = /^lf_[a-zA-Z0-9_-]{16,96}$/;
const TICKET_PATTERN = /^[a-zA-Z0-9_-]{43}$/;

function iso(now) {
  return new Date(now).toISOString();
}

function ticketDigest(ticket) {
  return createHash('sha256').update(ticket, 'utf8').digest('base64url');
}

function safeSessionId(value) {
  const id = String(value ?? '');
  if (!SESSION_ID_PATTERN.test(id)) throw new Error('Invalid Level Forge session id.');
  return id;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

/**
 * Small JSON-file session store. Every mutation is written to a sibling file,
 * fsynced, and renamed, so a terminated dev server cannot leave half JSON.
 */
export class LevelForgeSessionStore {
  constructor(options = {}) {
    const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
    this.directory = path.resolve(options.directory ?? path.join(projectRoot, '.level-forge', 'sessions'));
    this.activePath = path.resolve(options.activePath ?? path.join(this.directory, 'active.json'));
    this.now = options.now ?? Date.now;
    this.randomBytes = options.randomBytes ?? randomBytes;
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.ownerPid = options.ownerPid ?? process.pid;
    this.ownerStartedAt = options.ownerStartedAt ?? new Date(Date.now() - (process.uptime() * 1_000)).toISOString();
    this.ownerExecutable = options.ownerExecutable ?? process.execPath;
    this._locks = new Map();
  }

  async init() {
    await mkdir(this.directory, { recursive: true });
    await this._assertPlainPath(this.directory, true);
    return this;
  }

  async _assertPlainPath(target, mustExist = false) {
    const resolved = path.resolve(target);
    const relative = path.relative(this.directory, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Session path escapes the Level Forge store.');
    const parts = relative ? relative.split(path.sep) : [];
    let cursor = this.directory;
    const targets = [cursor, ...parts.map((part) => (cursor = path.join(cursor, part)))];
    for (const candidate of targets) {
      try {
        const stats = await lstat(candidate);
        if (stats.isSymbolicLink()) throw new Error('Symbolic links and reparse-point traversal are forbidden in the session store.');
      } catch (error) {
        if (error?.code === 'ENOENT' && (!mustExist || candidate !== resolved)) continue;
        throw error;
      }
    }
  }

  sessionPath(sessionId) {
    return path.join(this.directory, `${safeSessionId(sessionId)}.json`);
  }

  async _atomicWrite(filePath, value) {
    await this.init();
    await this._assertPlainPath(filePath, false);
    const temporary = `${filePath}.${process.pid}.${this.randomBytes(8).toString('hex')}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, filePath);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }

  async create(input = {}) {
    await this.init();
    await this.cleanup();
    const createdMs = this.now();
    const sessionId = `lf_${this.randomBytes(18).toString('base64url')}`;
    const ticket = this.randomBytes(32).toString('base64url');
    const session = {
      schema: LEVEL_FORGE_SESSION_SCHEMA,
      sessionId,
      createdAt: iso(createdMs),
      updatedAt: iso(createdMs),
      expiresAt: iso(createdMs + this.ttlMs),
      status: input.status ?? 'waiting',
      ownership: input.ownership ?? 'agent',
      ownerPid: this.ownerPid,
      ownerStartedAt: this.ownerStartedAt,
      ownerExecutable: this.ownerExecutable,
      browserAttached: false,
      ticketHash: ticketDigest(ticket),
      ticketClaimedAt: null,
      project: input.project ?? null,
      assets: input.assets ?? [],
      revision: Number(input.revision ?? input.project?.revision ?? 0),
      pausedAtRevision: null,
      pendingCommand: null,
      lastBrowserAck: null,
      lastValidationReceipt: null,
      finalizedAt: null,
    };
    await this._atomicWrite(this.sessionPath(sessionId), session);
    await this.setActive(sessionId);
    return { session: clone(session), ticket };
  }

  async read(sessionId, { allowExpired = false } = {}) {
    let value;
    try {
      const filePath = this.sessionPath(sessionId);
      await this._assertPlainPath(filePath, true);
      value = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    if (value?.schema !== LEVEL_FORGE_SESSION_SCHEMA || value.sessionId !== sessionId) {
      throw new Error('Invalid Level Forge session file.');
    }
    if (!allowExpired && Date.parse(value.expiresAt) <= this.now()) return null;
    return value;
  }

  async update(sessionId, mutate) {
    const id = safeSessionId(sessionId);
    const previous = this._locks.get(id) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const current = await this.read(id, { allowExpired: true });
      if (!current) throw new Error(`Level Forge session ${id} was not found.`);
      const draft = clone(current);
      const replacement = await mutate(draft);
      const next = replacement ?? draft;
      next.schema = LEVEL_FORGE_SESSION_SCHEMA;
      next.sessionId = id;
      next.updatedAt = iso(this.now());
      await this._atomicWrite(this.sessionPath(id), next);
      return clone(next);
    });
    this._locks.set(id, operation);
    try {
      return await operation;
    } finally {
      if (this._locks.get(id) === operation) this._locks.delete(id);
    }
  }

  async setActive(sessionId) {
    const id = safeSessionId(sessionId);
    await this._atomicWrite(this.activePath, { sessionId: id, updatedAt: iso(this.now()) });
  }

  async getActive() {
    try {
      const pointer = JSON.parse(await readFile(this.activePath, 'utf8'));
      return await this.read(pointer.sessionId);
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    const entries = await readdir(this.directory).catch(() => []);
    const candidates = [];
    for (const entry of entries) {
      if (!/^lf_[a-zA-Z0-9_-]{16,96}\.json$/.test(entry)) continue;
      const session = await this.read(entry.slice(0, -5)).catch(() => null);
      if (session) candidates.push(session);
    }
    return candidates.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
  }

  async cleanup() {
    const entries = await readdir(this.directory).catch(() => []);
    let removed = 0;
    for (const entry of entries) {
      if (!/^lf_[a-zA-Z0-9_-]{16,96}\.json$/.test(entry)) continue;
      const filePath = path.join(this.directory, entry);
      let session;
      try {
        await this._assertPlainPath(filePath, true);
        session = JSON.parse(await readFile(filePath, 'utf8'));
      } catch { continue; }
      const expired = Date.parse(session.expiresAt) <= this.now();
      let ownerDead = false;
      if (Number.isInteger(session.ownerPid) && session.ownerPid > 0 && session.ownerPid !== this.ownerPid) {
        try { process.kill(session.ownerPid, 0); } catch (error) { ownerDead = error?.code === 'ESRCH'; }
      }
      if (!expired && !ownerDead) continue;
      await unlink(filePath).catch(() => {});
      removed += 1;
    }
    return removed;
  }

  async claim(ticket) {
    if (!TICKET_PATTERN.test(String(ticket ?? ''))) return null;
    const supplied = Buffer.from(ticketDigest(ticket));
    const entries = await readdir(this.directory).catch(() => []);
    for (const entry of entries) {
      if (!entry.endsWith('.json') || entry === 'active.json') continue;
      const id = entry.slice(0, -5);
      if (!SESSION_ID_PATTERN.test(id)) continue;
      const session = await this.read(id).catch(() => null);
      if (!session || session.ticketClaimedAt || !session.ticketHash) continue;
      const expected = Buffer.from(session.ticketHash);
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) continue;
      return this.update(id, (draft) => {
        // Recheck under the per-session mutation lock: tickets are one-time.
        if (draft.ticketClaimedAt || draft.ticketHash !== ticketDigest(ticket)) {
          throw Object.assign(new Error('Level Forge ticket was already claimed.'), { code: 'TICKET_ALREADY_CLAIMED' });
        }
        draft.ticketClaimedAt = iso(this.now());
        draft.ticketHash = null;
        draft.browserAttached = true;
        draft.status = 'active';
      });
    }
    return null;
  }
}

export function createLevelForgeSessionStore(options) {
  return new LevelForgeSessionStore(options);
}

export const __sessionStoreInternals = Object.freeze({
  SESSION_ID_PATTERN,
  TICKET_PATTERN,
  ticketDigest,
});
