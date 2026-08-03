import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import { generateLevelForgeProject } from '../automation/generation.js';
import { validateGeneratedDungeon, VALIDATION_RECEIPT_SCHEMA } from '../automation/validation.js';
import { createLevelForgeSessionStore } from './sessionStore.js';

export const LEVEL_FORGE_CONTROL_PREFIX = '/__level-forge/v1';
export const LEVEL_FORGE_CONTROL_SIGNATURE = 'ruindivex-level-forge-control/v1';
export const LEVEL_FORGE_BROWSER_SIGNATURE = 'ruindivex-level-forge-browser/v1';

function openSystemBrowser(url) {
  const target = String(url);
  let executable;
  let args;
  if (process.platform === 'win32') {
    executable = 'powershell.exe';
    const script = `Start-Process -FilePath ${JSON.stringify(target)}`;
    args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  } else if (process.platform === 'darwin') { executable = 'open'; args = [target]; }
  else { executable = 'xdg-open'; args = [target]; }
  const child = spawn(executable, args, { detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
}

const MAX_RPC_BYTES = 2 * 1024 * 1024;
const MAX_SHARE_BYTES = 66 * 1024 * 1024;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const MAX_OPERATIONS = 256;
const MAX_PATH_LENGTH = 2_048;
const OP_TYPES = Object.freeze([
  'room.add', 'room.update', 'room.remove',
  'primitive.add', 'primitive.update', 'primitive.remove',
  'socket.add', 'socket.update', 'socket.remove',
  'connection.add', 'connection.update', 'connection.remove',
  'entity.add', 'entity.update', 'entity.remove',
  'material.add', 'material.update', 'material.remove',
  'asset.add', 'asset.remove',
]);
const OP_SET = new Set(OP_TYPES);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor', 'patch', 'script', 'eval', 'code']);

class RpcError extends Error {
  constructor(code, kind, message, data = {}) {
    super(message);
    this.rpcCode = code;
    this.kind = kind;
    this.data = data;
  }
}

function fail(code, kind, message, data) { throw new RpcError(code, kind, message, data); }
function result(id, value) { return { jsonrpc: '2.0', id, result: value }; }
function failure(id, error) {
  return { jsonrpc: '2.0', id: id ?? null, error: {
    code: error.rpcCode ?? -32603,
    message: error.message || 'Internal Level Forge error.',
    data: { kind: error.kind ?? 'INTERNAL_ERROR', ...(error.data ?? {}) },
  } };
}

function assertJson(value, label = '$', depth = 0) {
  if (depth > 80) fail(-32602, 'LIMIT_EXCEEDED', `${label} is nested too deeply.`);
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(-32602, 'INVALID_PARAMS', `${label} contains a non-finite number.`);
    return;
  }
  if (typeof value !== 'object') fail(-32602, 'UNSAFE_OPERATION', `${label} must contain JSON data only.`);
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) fail(-32602, 'UNSAFE_OPERATION', `${label}.${key} is forbidden.`);
    assertJson(entry, `${label}.${key}`, depth + 1);
  }
}

function sessionView(session, { includeProject = false, includeAssets = false } = {}) {
  const view = {
    schema: session.schema,
    sessionId: session.sessionId,
    status: session.status,
    ownership: session.ownership,
    revision: session.revision,
    browserAttached: Boolean(session.browserAttached),
    pausedAtRevision: session.pausedAtRevision,
    pendingCommand: session.pendingCommand,
    expiresAt: session.expiresAt,
    lastValidationReceipt: session.lastValidationReceipt,
    finalizedAt: session.finalizedAt,
  };
  if (includeProject) view.project = session.project;
  if (includeAssets) view.assets = session.assets;
  return view;
}

async function resolveSession(session, params, store, required = true) {
  let resolved = session && typeof session === 'object' ? session : null;
  if (!resolved && typeof session === 'string') resolved = await store?.read(session);
  if (!resolved && params?.sessionId) resolved = await store?.read(params.sessionId);
  if (!resolved) resolved = await store?.getActive();
  if (!resolved && required) fail(-32004, 'SESSION_NOT_FOUND', 'No active Level Forge session was found.');
  return resolved;
}

function assertMutable(session, baseRevision) {
  if (!session.browserAttached) fail(-32005, 'BROWSER_NOT_ATTACHED', 'The Level Forge browser is not attached.');
  if (['manual', 'paused'].includes(session.status)) fail(-32011, 'SESSION_PAUSED', 'The session paused after a manual edit.', { revision: session.revision });
  if (Number(baseRevision) !== Number(session.revision) || !Number.isInteger(Number(baseRevision))) {
    fail(-32009, 'REVISION_CONFLICT', 'The requested base revision is stale.', { baseRevision, currentRevision: session.revision });
  }
}

function validateOperations(operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > MAX_OPERATIONS) {
    fail(-32602, 'INVALID_PARAMS', `operations must contain between 1 and ${MAX_OPERATIONS} typed operations.`);
  }
  operations.forEach((operation, index) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) fail(-32602, 'INVALID_PARAMS', `operations[${index}] must be an object.`);
    const type = operation.type ?? operation.op ?? operation.method;
    if (!OP_SET.has(type)) fail(-32601, 'METHOD_NOT_FOUND', `Unsupported typed operation "${type ?? ''}".`);
    assertJson(operation, `operations[${index}]`);
  });
}

async function dispatchBrowser(session, request, options) {
  if (!session.browserAttached) fail(-32005, 'BROWSER_NOT_ATTACHED', 'The Level Forge browser is not attached.');
  const response = options.dispatchBrowser
    ? await options.dispatchBrowser(session, request)
    : await options.enqueueBrowserCommand?.(session, request);
  if (!response) fail(-32006, 'BROWSER_ACK_TIMEOUT', 'The attached browser did not acknowledge the command.');
  if (response.error) throw new RpcError(response.error.code, response.error.data?.kind ?? 'BROWSER_COMMAND_FAILED', response.error.message, response.error.data);
  return response.result;
}

const CATALOG = Object.freeze({
  operations: OP_TYPES,
  geometryKinds: ['box', 'cylinder', 'sphere', 'plane', 'ramp', 'gltf-model'],
  socketKinds: ['door', 'corridor', 'lift'],
  connectorKinds: ['door', 'corridor', 'lift'],
  entityKinds: ['player-start', 'extraction', 'enemy-spawn', 'objective', 'pickup', 'checkpoint', 'gate', 'credential'],
  materialKinds: ['standard', 'physical', 'basic'],
  assetKinds: ['png', 'jpg', 'jpeg', 'webp', 'glb', 'gltf'],
  limits: { operationsPerBatch: MAX_OPERATIONS, assetBytes: MAX_ASSET_BYTES, consentBundleBytes: MAX_BUNDLE_BYTES },
});

/** Execute one Level Forge JSON-RPC request and always return a JSON-RPC envelope. */
export async function executeLevelForgeCommand(session, request, options = {}) {
  const id = request?.id ?? null;
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || typeof request.id !== 'string') {
      fail(-32600, 'INVALID_REQUEST', 'A unique string id and a JSON-RPC 2.0 method are required.');
    }
    const params = request.params ?? {};
    assertJson(params, 'params');
    const store = options.store;
    const origin = options.origin ?? 'http://127.0.0.1:5174';
    let active;

    switch (request.method) {
      case 'session.start': {
        if (!store) fail(-32603, 'STORE_UNAVAILABLE', 'Session storage is unavailable.');
        // A freshly initialized editor project starts at revision 1.
        const created = await store.create({ status: 'waiting', ownership: 'agent', revision: 1 });
        const url = `${origin}/level-editor.html#levelForgeTicket=${created.ticket}`;
        return result(id, { signature: LEVEL_FORGE_CONTROL_SIGNATURE, ...sessionView(created.session), ticket: created.ticket, url });
      }
      case 'session.attach':
        active = await resolveSession(session, params, store);
        if (!active.browserAttached || !['shared', 'active', 'manual', 'paused'].includes(active.status)) fail(-32005, 'BROWSER_NOT_ATTACHED', 'No browser-consented project is available.');
        return result(id, sessionView(active, { includeProject: true, includeAssets: true }));
      case 'session.status':
        active = await resolveSession(session, params, store);
        return result(id, sessionView(active));
      case 'session.inspect':
        active = await resolveSession(session, params, store);
        if (params.resume === true && ['manual', 'paused'].includes(active.status)) {
          active = await store.update(active.sessionId, (draft) => { draft.status = 'active'; draft.pausedAtRevision = null; });
        }
        return result(id, sessionView(active, { includeProject: true, includeAssets: true }));
      case 'catalog.get':
        return result(id, { signature: LEVEL_FORGE_CONTROL_SIGNATURE, ...CATALOG });
      case 'project.create': {
        active = await resolveSession(session, params, store);
        assertMutable(active, params.baseRevision ?? active.revision);
        const generated = await generateLevelForgeProject(params.spec ?? params.prompt ?? params, { validate: true, strictAssembly: true });
        if (!generated.ok) fail(-32030, generated.errors?.[0]?.code ?? 'VALIDATION_FAILED', generated.errors?.[0]?.message ?? 'Project generation failed.', { diagnostics: generated.diagnostics });
        generated.project.revision = active.revision;
        const browser = await dispatchBrowser(active, { jsonrpc: '2.0', id: `browser_${request.id}`, method: 'levelForge.project.replace', params: { project: generated.project, baseRevision: active.revision, label: 'Codex created project' } }, options);
        active = await store.update(active.sessionId, (draft) => {
          draft.project = browser?.project ?? browser ?? generated.project;
          draft.revision = Number(draft.project?.revision ?? browser?.revision ?? draft.revision);
          draft.lastValidationReceipt = null;
        });
        return result(id, { project: active.project, revision: active.revision, spec: generated.spec, generationReceipt: generated.receipt });
      }
      case 'project.applyBatch': {
        active = await resolveSession(session, params, store);
        assertMutable(active, params.baseRevision);
        validateOperations(params.operations);
        const browser = await dispatchBrowser(active, { jsonrpc: '2.0', id: `browser_${request.id}`, method: 'levelForge.project.applyOperations', params: { baseRevision: active.revision, operations: params.operations, label: params.label ?? 'Codex edit' } }, options);
        active = await store.update(active.sessionId, (draft) => {
          draft.project = browser.project ?? draft.project;
          draft.revision = Number(browser.revision ?? browser.project?.revision ?? draft.revision);
          draft.lastValidationReceipt = null;
        });
        return result(id, { ...browser, revision: active.revision, project: active.project });
      }
      case 'project.validate': {
        active = await resolveSession(session, params, store);
        if (!active.project) fail(-32004, 'PROJECT_NOT_FOUND', 'The session has no shared project.');
        const validation = await validateGeneratedDungeon(active.project, { strictAssembly: true, warningsAsErrors: true, spec: params.spec });
        const browser = await dispatchBrowser(active, { jsonrpc: '2.0', id: `browser_${request.id}`, method: 'levelForge.preflight', params: {} }, options);
        const browserOk = browser?.signature === LEVEL_FORGE_BROWSER_SIGNATURE && browser.ok === true && Number(browser.revision) === Number(active.revision);
        const receipt = { ...(validation.receipt ?? {}), schema: VALIDATION_RECEIPT_SCHEMA, ok: validation.ok && browserOk, revision: active.revision, browserAck: browserOk, requiredGates: { staticAndAssembly: validation.ok, browserPreflight: browserOk } };
        active = await store.update(active.sessionId, (draft) => { draft.lastValidationReceipt = receipt; });
        if (!receipt.ok) fail(-32030, 'VALIDATION_FAILED', 'The project did not pass every validation gate.', { diagnostics: validation.diagnostics, receipt });
        return result(id, { ok: true, receipt, diagnostics: validation.diagnostics });
      }
      case 'preview.capture': {
        active = await resolveSession(session, params, store);
        const view = params.view === 'top-down' ? 'top-down' : 'perspective';
        const capture = await dispatchBrowser(active, { jsonrpc: '2.0', id: `browser_${request.id}`, method: 'levelForge.preview.capture', params: { view } }, options);
        return result(id, capture);
      }
      case 'project.finalize': {
        active = await resolveSession(session, params, store);
        const receipt = active.lastValidationReceipt;
        if (!receipt?.ok || !receipt.browserAck || Number(receipt.revision) !== Number(active.revision)) fail(-32031, 'FINALIZATION_INCOMPLETE', 'A current passing validation receipt and browser acknowledgement are required.');
        const browser = await dispatchBrowser(active, { jsonrpc: '2.0', id: `browser_${request.id}`, method: 'levelForge.project.finalize', params: { baseRevision: active.revision, playtest: true } }, options);
        if (!browser?.ok || !browser?.persisted || !browser?.playtest?.ok || Number(browser.revision) !== Number(active.revision)) fail(-32031, 'FINALIZATION_INCOMPLETE', 'The browser did not persist and pass the real-Game smoke gate for the finalized revision.');
        const finalReceipt = { ...receipt, requiredGates: { ...(receipt.requiredGates ?? {}), persisted: true, realGameSmoke: true } };
        active = await store.update(active.sessionId, (draft) => { draft.status = 'finalized'; draft.finalizedAt = new Date().toISOString(); draft.lastValidationReceipt = finalReceipt; });
        return result(id, { ok: true, projectId: active.project?.projectId, revision: active.revision, receipt: finalReceipt, playtest: browser.playtest });
      }
      case 'project.open': {
        active = await resolveSession(session, params, store);
        if (active.status !== 'finalized' || !active.lastValidationReceipt?.ok) fail(-32031, 'FINALIZATION_INCOMPLETE', 'Only a finalized validated project can be opened.');
        await dispatchBrowser(active, { jsonrpc: '2.0', id: `browser_${request.id}`, method: 'levelForge.project.focus', params: {} }, options);
        const openUrl = `${origin}/level-editor.html?project=${encodeURIComponent(active.project.projectId)}`;
        active = await store.update(active.sessionId, (draft) => { draft.status = 'complete'; draft.ownership = 'browser'; });
        await options.openBrowser?.(openUrl);
        return result(id, { ok: true, projectId: active.project.projectId, revision: active.revision, openUrl, detached: true });
      }
      default:
        fail(-32601, 'METHOD_NOT_FOUND', `Method "${request.method}" is not allowed.`);
    }
  } catch (error) {
    return failure(id, error);
  }
}

function loopbackHost(hostHeader) {
  try {
    const host = new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch { return false; }
}

function validOrigin(request, hostHeader) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && parsed.host.toLowerCase() === String(hostHeader).toLowerCase() && loopbackHost(parsed.host);
  } catch { return false; }
}

async function jsonBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) fail(-32600, 'BODY_TOO_LARGE', 'Request body exceeds the endpoint limit.');
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(-32700, 'PARSE_ERROR', 'Request body is not valid JSON.'); }
}

function cookieSession(request) {
  const match = String(request.headers.cookie ?? '').match(/(?:^|;\s*)levelForgeSession=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function send(response, status, payload, headers = {}) {
  const body = payload == null ? '' : JSON.stringify(payload);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  response.end(body);
}

const ASSET_MIME_BY_EXTENSION = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  bin: 'application/octet-stream',
});

function normalizedAssetPath(asset) {
  const raw = String(asset.relativePath ?? asset.name ?? '').replace(/\\/g, '/');
  let decoded;
  try { decoded = decodeURIComponent(raw); }
  catch { fail(-32012, 'ASSET_INVALID_PATH', `Asset path is not valid URI text: "${raw}".`); }
  if (!decoded || decoded.includes('\0') || decoded.startsWith('/') || /^[a-z]:/i.test(decoded)) {
    fail(-32012, 'ASSET_INVALID_PATH', `Asset path must be relative: "${raw}".`);
  }
  const parts = [];
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') fail(-32012, 'ASSET_INVALID_PATH', `Asset path escapes the bundle: "${raw}".`);
    parts.push(part);
  }
  if (!parts.length) fail(-32012, 'ASSET_INVALID_PATH', `Asset path is empty: "${raw}".`);
  return parts.join('/');
}

function expectedAssetMime(asset, assetPath) {
  const extension = assetPath.split('.').pop().toLowerCase();
  const expected = ASSET_MIME_BY_EXTENSION[extension];
  if (!expected) fail(-32012, 'ASSET_UNSUPPORTED', `Unsupported asset extension ".${extension}".`);
  const supplied = String(asset.mimeType ?? expected).split(';', 1)[0].toLowerCase();
  const compatible = supplied === expected
    || (extension === 'gltf' && supplied === 'application/json')
    || (extension === 'bin' && supplied === 'application/octet-stream');
  if (!compatible) fail(-32012, 'ASSET_MIME_MISMATCH', `Asset MIME ${supplied} does not match ${assetPath}.`);
  return { extension, mimeType: expected };
}

function gltfDependencyPath(basePath, uri) {
  let decoded;
  try { decoded = decodeURIComponent(String(uri).split(/[?#]/, 1)[0]); }
  catch { fail(-32012, 'ASSET_INVALID_PATH', `Invalid encoded glTF URI: ${uri}`); }
  if (!decoded || decoded.startsWith('data:')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('//') || decoded.startsWith('/')) {
    fail(-32012, 'ASSET_REMOTE_URI', `Remote or absolute glTF URI is forbidden: ${uri}`);
  }
  const parts = basePath.split('/').slice(0, -1);
  for (const part of decoded.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) fail(-32012, 'ASSET_INVALID_PATH', `glTF URI escapes the bundle: ${uri}`);
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

function validateGltfJson(document, assetPath) {
  if (!String(document?.asset?.version ?? '').startsWith('2.')) fail(-32012, 'ASSET_DECODE_FAILED', `${assetPath} must use glTF 2.x.`);
  const forbiddenExtensions = new Set(['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression']);
  const used = [...(document.extensionsRequired ?? []), ...(document.extensionsUsed ?? [])];
  const unsupported = [...new Set(used)].filter((entry) => forbiddenExtensions.has(entry));
  if (unsupported.length) fail(-32012, 'ASSET_UNSUPPORTED', `${assetPath} uses unsupported compressed extensions: ${unsupported.join(', ')}.`);
  return [...(document.buffers ?? []), ...(document.images ?? [])]
    .map((entry) => entry?.uri)
    .filter(Boolean)
    .map((uri) => gltfDependencyPath(assetPath, uri))
    .filter(Boolean);
}

function decodeAssetRecord(asset, bytes, assetPath, extension) {
  if (extension === 'png') {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) fail(-32012, 'ASSET_DECODE_FAILED', `${assetPath} is not a decodable PNG container.`);
  } else if (extension === 'jpg' || extension === 'jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) fail(-32012, 'ASSET_DECODE_FAILED', `${assetPath} is not a complete JPEG container.`);
  } else if (extension === 'webp') {
    if (bytes.length < 16 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) fail(-32012, 'ASSET_DECODE_FAILED', `${assetPath} is not a complete WebP container.`);
  } else if (extension === 'glb') {
    if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) fail(-32012, 'ASSET_DECODE_FAILED', `${assetPath} is not a complete uncompressed GLB 2 container.`);
    const jsonLength = bytes.readUInt32LE(12);
    if (20 + jsonLength > bytes.length) fail(-32012, 'ASSET_DECODE_FAILED', `${assetPath} has a truncated GLB JSON chunk.`);
    try { return validateGltfJson(JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).replace(/[\u0000\s]+$/g, '')), assetPath); }
    catch (error) { if (error instanceof RpcError) throw error; fail(-32012, 'ASSET_DECODE_FAILED', `${assetPath} contains invalid GLB JSON.`); }
  } else if (extension === 'gltf') {
    try { return validateGltfJson(JSON.parse(bytes.toString('utf8')), assetPath); }
    catch (error) { if (error instanceof RpcError) throw error; fail(-32012, 'ASSET_DECODE_FAILED', `${assetPath} is not valid glTF JSON.`); }
  }
  return [];
}

function verifySharedAssets(assets, previouslyVerified = []) {
  if (!Array.isArray(assets)) fail(-32602, 'INVALID_PARAMS', 'assets must be an array.');
  const priorByHash = new Map(previouslyVerified.map((asset) => [String(asset.hash), asset]));
  let total = 0;
  const merged = [];
  const ids = new Set();
  const paths = new Set(previouslyVerified.map(normalizedAssetPath));
  const dependencies = [];
  for (const asset of assets) {
    const assetId = String(asset.id ?? asset.hash ?? '');
    const hash = String(asset.hash ?? '');
    if (!assetId || ids.has(assetId)) fail(-32012, 'ASSET_DUPLICATE_ID', `Duplicate or missing asset id "${assetId}".`);
    if (!hash) fail(-32012, 'ASSET_INVALID', 'Every asset requires a SHA-256 hash.');
    ids.add(assetId);
    if (!asset.contentBase64 && priorByHash.has(hash)) { const prior = priorByHash.get(hash); paths.add(normalizedAssetPath(prior)); merged.push(prior); continue; }
    if (!asset.contentBase64) fail(-32012, 'ASSET_BYTES_MISSING', `New asset bytes are missing for "${asset.id ?? asset.name ?? 'asset'}".`);
    const encoded = String(asset.contentBase64);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail(-32012, 'ASSET_INVALID', `Asset base64 is malformed for "${assetId}".`);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length > MAX_ASSET_BYTES || (total += bytes.length) > MAX_BUNDLE_BYTES) fail(-32012, 'ASSET_BUNDLE_TOO_LARGE', 'The consent asset bundle exceeds its byte limit.');
    const expected = hash.replace(/^sha256:/, '').toLowerCase();
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (!expected || expected !== actual) fail(-32012, 'ASSET_INVALID', `Asset hash mismatch for "${asset.id ?? asset.name ?? 'asset'}".`);
    const assetPath = normalizedAssetPath(asset);
    const { extension, mimeType } = expectedAssetMime(asset, assetPath);
    dependencies.push(...decodeAssetRecord(asset, bytes, assetPath, extension).map((dependency) => ({ assetPath, dependency })));
    paths.add(assetPath);
    merged.push({ ...asset, mimeType, relativePath: assetPath });
  }
  for (const { assetPath, dependency } of dependencies) if (!paths.has(dependency)) fail(-32012, 'ASSET_DEPENDENCY_MISSING', `${assetPath} is missing companion ${dependency}.`);
  return merged;
}

/** Create an HTTP handler which returns true when it handled a control route. */
export function createLevelForgeControlHandler(options = {}) {
  const store = options.store ?? createLevelForgeSessionStore({ projectRoot: options.projectRoot });
  const origin = options.origin ?? 'http://127.0.0.1:5174';
  const commandTimeoutMs = options.commandTimeoutMs ?? 45_000;

  const enqueueBrowserCommand = async (session, request) => {
    const commandId = `cmd_${randomBytes(12).toString('base64url')}`;
    await store.update(session.sessionId, (draft) => {
      if (draft.pendingCommand) fail(-32007, 'COMMAND_PENDING', 'The browser already has a pending command.');
      draft.pendingCommand = { commandId, request, createdAt: new Date().toISOString() };
    });
    const deadline = Date.now() + commandTimeoutMs;
    while (Date.now() < deadline) {
      const current = await store.read(session.sessionId, { allowExpired: true });
      if (current?.lastBrowserAck?.commandId === commandId) return current.lastBrowserAck.response;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await store.update(session.sessionId, (draft) => { if (draft.pendingCommand?.commandId === commandId) draft.pendingCommand = null; });
    return null;
  };

  return async function handleLevelForgeControl(request, response) {
    if (!String(request.url ?? '').startsWith(LEVEL_FORGE_CONTROL_PREFIX)) return false;
    try {
      if (request.url.length > MAX_PATH_LENGTH) { send(response, 414, { ok: false, error: { kind: 'PATH_TOO_LONG', message: 'Request path is too long.' } }); return true; }
      const host = request.headers.host;
      if (!loopbackHost(host) || !validOrigin(request, host)) { send(response, 403, { ok: false, error: { kind: 'LOOPBACK_REQUIRED', message: 'Level Forge control accepts same-origin loopback requests only.' } }); return true; }
      const url = new URL(request.url, `http://${host}`);
      const route = url.pathname.slice(LEVEL_FORGE_CONTROL_PREFIX.length) || '/';
      const method = request.method ?? 'GET';
      if (route === '/health' && method === 'GET') { send(response, 200, { ok: true, signature: LEVEL_FORGE_CONTROL_SIGNATURE, prefix: LEVEL_FORGE_CONTROL_PREFIX }); return true; }

      if (route === '/session/claim' && method === 'POST') {
        const body = await jsonBody(request, MAX_RPC_BYTES);
        const claimed = await store.claim(body.ticket);
        if (!claimed) { send(response, 401, { ok: false, error: { kind: 'INVALID_TICKET', message: 'The one-time ticket is invalid or expired.' } }); return true; }
        send(response, 200, { ok: true, session: sessionView(claimed) }, { 'Set-Cookie': `levelForgeSession=${encodeURIComponent(claimed.sessionId)}; HttpOnly; SameSite=Strict; Path=${LEVEL_FORGE_CONTROL_PREFIX}` });
        return true;
      }

      if (route === '/session/share' && method === 'POST') {
        const body = await jsonBody(request, MAX_SHARE_BYTES);
        if (body.consent !== true || !body.project || typeof body.project !== 'object') fail(-32602, 'CONSENT_REQUIRED', 'Explicit consent and a project are required.');
        assertJson(body.project, 'project');
        const verifiedAssets = verifySharedAssets(body.assets ?? []);
        const existingId = cookieSession(request);
        let shared = existingId ? await store.read(existingId) : null;
        if (shared) shared = await store.update(shared.sessionId, (draft) => {
          draft.project = body.project; draft.assets = verifiedAssets; draft.revision = Number(body.project.revision ?? 0); draft.browserAttached = true; draft.status = 'active'; draft.ownership = 'shared';
        });
        else {
          const created = await store.create({ project: body.project, assets: verifiedAssets, revision: body.project.revision, status: 'active', ownership: 'shared' });
          shared = await store.update(created.session.sessionId, (draft) => { draft.browserAttached = true; draft.ticketHash = null; });
        }
        send(response, 200, { ok: true, session: sessionView(shared) }, { 'Set-Cookie': `levelForgeSession=${encodeURIComponent(shared.sessionId)}; HttpOnly; SameSite=Strict; Path=${LEVEL_FORGE_CONTROL_PREFIX}` });
        return true;
      }

      const browserId = cookieSession(request);
      if (route === '/session' && method === 'GET') {
        const browserSession = browserId ? await store.read(browserId) : null;
        if (!browserSession) { send(response, 401, { ok: false, error: { kind: 'SESSION_NOT_FOUND', message: 'Browser session cookie is missing or expired.' } }); return true; }
        send(response, 200, { ok: true, session: sessionView(browserSession), pendingCommand: browserSession.pendingCommand });
        return true;
      }

      if (route === '/browser/ack' && method === 'POST') {
        const body = await jsonBody(request, MAX_RPC_BYTES);
        const browserSession = browserId ? await store.read(browserId) : null;
        if (!browserSession) { send(response, 401, { ok: false, error: { kind: 'SESSION_NOT_FOUND', message: 'Browser session cookie is missing or expired.' } }); return true; }
        const updated = await store.update(browserId, (draft) => {
          if (!draft.pendingCommand || draft.pendingCommand.commandId !== String(body.commandId ?? '')) fail(-32008, 'ACK_MISMATCH', 'Acknowledgement does not match the pending command.');
          draft.lastBrowserAck = { commandId: draft.pendingCommand.commandId, response: body.response, revision: Number(body.revision), acknowledgedAt: new Date().toISOString() };
          draft.pendingCommand = null;
          const browserResult = body.response?.result;
          if (!body.response?.error && browserResult?.project) draft.project = browserResult.project;
          if (!body.response?.error && Number.isInteger(Number(body.revision))) draft.revision = Number(body.revision);
        });
        send(response, 200, { ok: true, revision: updated.revision }); return true;
      }

      if (route === '/browser/manual' && method === 'POST') {
        const body = await jsonBody(request, MAX_SHARE_BYTES);
        const browserSession = browserId ? await store.read(browserId) : null;
        if (!browserSession) { send(response, 401, { ok: false, error: { kind: 'SESSION_NOT_FOUND', message: 'Browser session cookie is missing or expired.' } }); return true; }
        assertJson(body.project, 'project');
        const mergedAssets = verifySharedAssets(body.assets ?? [], browserSession.assets ?? []);
        const updated = await store.update(browserId, (draft) => {
          draft.project = body.project; draft.assets = mergedAssets; draft.revision = Number(body.revision ?? body.project?.revision ?? draft.revision); draft.lastValidationReceipt = null;
          if (body.resume === true) { draft.status = 'active'; draft.pausedAtRevision = null; }
          else { draft.status = 'manual'; draft.pausedAtRevision = draft.revision; draft.pendingCommand = null; }
        });
        send(response, 200, { ok: true, status: updated.status, revision: updated.revision }); return true;
      }

      if (route === '/rpc' && method === 'POST') {
        const body = await jsonBody(request, MAX_RPC_BYTES);
        if (body.type === 'browser.ack') {
          // Compatibility fallback used by older Forge pages.
          request.url = `${LEVEL_FORGE_CONTROL_PREFIX}/browser/ack`;
          fail(-32600, 'USE_BROWSER_ACK', 'Use the browser acknowledgement endpoint.');
        }
        const explicit = body.params?.sessionId ? await store.read(body.params.sessionId) : null;
        const active = explicit ?? await store.getActive();
        const envelope = await executeLevelForgeCommand(active, body, { ...options, store, origin, enqueueBrowserCommand, openBrowser: options.openBrowser ?? openSystemBrowser });
        send(response, envelope.error ? 400 : 200, envelope); return true;
      }
      send(response, 404, { ok: false, error: { kind: 'NOT_FOUND', message: 'Unknown Level Forge endpoint.' } });
    } catch (error) {
      send(response, error.kind === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: { code: error.rpcCode ?? -32603, kind: error.kind ?? 'CONTROL_ERROR', message: error.message } });
    }
    return true;
  };
}

export { createLevelForgeSessionStore } from './sessionStore.js';
export const LEVEL_FORGE_CATALOG = CATALOG;
export const __levelForgeControlInternals = Object.freeze({
  normalizedAssetPath,
  verifySharedAssets,
});
