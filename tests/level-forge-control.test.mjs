import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  __levelForgeControlInternals,
  executeLevelForgeCommand,
  LEVEL_FORGE_CONTROL_SIGNATURE,
} from '../src/level-editor/control/index.js';
import { createLevelForgeSessionStore } from '../src/level-editor/control/sessionStore.js';

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'level-forge-control-'));
  const store = createLevelForgeSessionStore({ directory: path.join(directory, 'sessions') });
  await store.init();
  return store;
}

test('session.start persists an owned session and creates a 256-bit one-time ticket', async () => {
  const store = await fixture();
  const envelope = await executeLevelForgeCommand(null, { jsonrpc: '2.0', id: 'start-1', method: 'session.start', params: {} }, { store });
  assert.equal(envelope.result.signature, LEVEL_FORGE_CONTROL_SIGNATURE);
  assert.match(envelope.result.ticket, /^[A-Za-z0-9_-]{43}$/);
  const claimed = await store.claim(envelope.result.ticket);
  assert.equal(claimed.browserAttached, true);
  assert.equal(await store.claim(envelope.result.ticket), null);
});

test('applyBatch rejects stale and unsafe operations before browser dispatch', async () => {
  const store = await fixture();
  const { session: created, ticket } = await store.create();
  const session = await store.claim(ticket);
  let dispatched = false;
  const stale = await executeLevelForgeCommand(session, { jsonrpc: '2.0', id: 'stale', method: 'project.applyBatch', params: { baseRevision: 9, operations: [{ type: 'room.remove', id: 'a' }] } }, { store, dispatchBrowser: async () => { dispatched = true; } });
  assert.equal(stale.error.data.kind, 'REVISION_CONFLICT');
  assert.equal(dispatched, false);
  const unsafe = await executeLevelForgeCommand(session, { jsonrpc: '2.0', id: 'unsafe', method: 'project.applyBatch', params: { baseRevision: created.revision, operations: [{ type: 'room.update', id: 'a', patch: [] }] } }, { store });
  assert.equal(unsafe.error.data.kind, 'UNSAFE_OPERATION');
});

test('finalize requires a current passing receipt with browser acknowledgement', async () => {
  const store = await fixture();
  const { ticket } = await store.create({ project: { projectId: 'p', revision: 0 } });
  const session = await store.claim(ticket);
  const envelope = await executeLevelForgeCommand(session, { jsonrpc: '2.0', id: 'finish', method: 'project.finalize', params: {} }, { store });
  assert.equal(envelope.error.data.kind, 'FINALIZATION_INCOMPLETE');
});

function sharedAsset(id, name, mimeType, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return {
    id,
    name,
    relativePath: name,
    mimeType,
    hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    contentBase64: bytes.toString('base64'),
  };
}

test('shared assets reject malformed media, traversal paths, remote glTF URIs, and missing companions', () => {
  const { verifySharedAssets } = __levelForgeControlInternals;
  assert.throws(
    () => verifySharedAssets([sharedAsset('bad-image', 'bad.png', 'image/png', 'not a png')]),
    (error) => error.kind === 'ASSET_DECODE_FAILED',
  );
  const traversal = sharedAsset('bad-path', '../outside.bin', 'application/octet-stream', 'bytes');
  assert.throws(
    () => verifySharedAssets([traversal]),
    (error) => error.kind === 'ASSET_INVALID_PATH',
  );
  const remote = sharedAsset('remote-model', 'model.gltf', 'model/gltf+json', JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ uri: 'https://example.com/model.bin', byteLength: 4 }],
  }));
  assert.throws(
    () => verifySharedAssets([remote]),
    (error) => error.kind === 'ASSET_REMOTE_URI',
  );
  const missing = sharedAsset('missing-model', 'model.gltf', 'model/gltf+json', JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ uri: 'model.bin', byteLength: 4 }],
  }));
  assert.throws(
    () => verifySharedAssets([missing]),
    (error) => error.kind === 'ASSET_DEPENDENCY_MISSING',
  );
});

test('shared glTF assets validate complete local dependencies and duplicate IDs', () => {
  const { verifySharedAssets } = __levelForgeControlInternals;
  const model = sharedAsset('model', 'models/model.gltf', 'model/gltf+json', JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ uri: 'model.bin', byteLength: 4 }],
  }));
  const buffer = sharedAsset('buffer', 'models/model.bin', 'application/octet-stream', Buffer.from([0, 1, 2, 3]));
  assert.equal(verifySharedAssets([model, buffer]).length, 2);
  assert.throws(
    () => verifySharedAssets([model, { ...buffer, id: 'model' }]),
    (error) => error.kind === 'ASSET_DUPLICATE_ID',
  );
});
