import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { compileEditorProject } from './core/compiler.js';
import { LevelProjectStore } from './core/persistence.js';
import { validateAuthoredDungeon } from './core/validation.js';
import { AssetResolver } from './runtime/AssetResolver.js';
import { assembleAuthoredDungeon } from './runtime/dungeonAssembler.js';

export const LEVEL_EDITOR_BRIDGE_CHANNEL = 'ruindivex-level-editor';
export const LEVEL_EDITOR_BRIDGE_VERSION = 1;

function bridgeMessage(type, detail = {}) {
  return {
    channel: LEVEL_EDITOR_BRIDGE_CHANNEL,
    version: LEVEL_EDITOR_BRIDGE_VERSION,
    type,
    ...detail,
  };
}

function assetAliases(project, records) {
  const aliases = new Map();
  for (const record of records) {
    for (const value of [record.hash, record.name, record.metadata?.relativePath, record.metadata?.path]) {
      if (value) aliases.set(String(value), record.url);
    }
  }
  for (const asset of project?.assets ?? []) {
    const hash = String(asset.hash ?? asset.assetHash ?? asset.id ?? '');
    const url = aliases.get(hash);
    if (!url) continue;
    for (const value of [asset.id, asset.assetId, asset.name, asset.path, asset.relativePath, hash]) {
      if (value) aliases.set(String(value), url);
    }
  }
  return aliases;
}

function aliasForUrl(url, aliases) {
  if (aliases.has(url)) return aliases.get(url);
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { /* Keep the loader URL verbatim. */ }
  if (aliases.has(decoded)) return aliases.get(decoded);
  const withoutQuery = decoded.split(/[?#]/, 1)[0];
  const basename = withoutQuery.split('/').pop();
  return aliases.get(withoutQuery) ?? aliases.get(basename) ?? null;
}

/** Build a resolver for the content-addressed Blob assets shared by both frames. */
export async function createPlaytestAssetResolver(store, project = null) {
  const metadata = await store.listAssets();
  const objectUrls = new Set();
  const records = [];
  for (const entry of metadata) {
    const blob = await store.getAsset(entry.hash);
    if (!blob) continue;
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    records.push({ ...entry, url });
  }
  const aliases = assetAliases(project, records);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => aliasForUrl(url, aliases) ?? url);
  const resolver = new AssetResolver({
    manifest: {
      assets: records.flatMap((record) => {
        const descriptors = [{ id: record.hash, url: record.url, ...record }];
        for (const [id, url] of aliases) {
          if (url === record.url && id !== record.hash) descriptors.push({ id, url, ...record });
        }
        return descriptors;
      }),
    },
    textureLoader: new THREE.TextureLoader(manager),
    gltfLoader: new GLTFLoader(manager),
    resolveUrl(rawUrl, descriptor) {
      const alias = aliasForUrl(String(descriptor?.id ?? rawUrl), aliases)
        ?? aliasForUrl(String(rawUrl ?? ''), aliases);
      if (alias) return alias;
      const value = String(rawUrl ?? '').trim();
      if (!value) return '';
      if (value.startsWith('data:') || value.startsWith('blob:')) return value;
      const resolved = new URL(value, location.href);
      if (resolved.origin !== location.origin) {
        throw new Error(`Remote authored asset URI is not allowed: ${value}`);
      }
      return resolved.toString();
    },
  });
  const disposeResolver = resolver.dispose.bind(resolver);
  resolver.dispose = () => {
    if (resolver.disposed) return;
    disposeResolver();
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
  };
  resolver.objectUrlCount = () => objectUrls.size;
  return resolver;
}

function readableError(error) {
  if (error instanceof AggregateError) {
    return [error.message, ...(error.errors ?? []).map((entry) => entry?.message)].filter(Boolean).join(' ');
  }
  return error?.message ?? String(error);
}

/**
 * Install the same-origin bridge in the dormant real-game iframe. The Game,
 * renderer, canvas, and listeners stay host-owned; only authored worlds swap.
 */
export function installLevelEditorPlaytestHost(game, options = {}) {
  const parentWindow = options.parentWindow ?? window.parent;
  const expectedOrigin = options.origin ?? location.origin;
  const store = options.store ?? new LevelProjectStore();
  let currentSnapshotId = null;
  let currentResolver = null;
  let operationQueue = Promise.resolve();

  const post = (type, detail = {}) => {
    parentWindow.postMessage(bridgeMessage(type, detail), expectedOrigin);
  };

  const releaseAssets = () => {
    currentResolver?.dispose?.();
    currentResolver = null;
  };

  const finish = ({ reason = 'editorReturn', snapshotId = currentSnapshotId } = {}) => {
    game.stop();
    releaseAssets();
    currentSnapshotId = null;
    if (snapshotId) store.deletePlaytestSnapshot(snapshotId).catch(() => null);
    post('playtest:ended', {
      snapshotId,
      reason,
      state: game.getLevelEditorPlaytestState?.() ?? { active: false },
    });
  };

  const stop = async (reason = 'editorStop') => {
    if (game.getLevelEditorPlaytestState?.().active) {
      game.exitLevelEditorPlaytest(reason);
    } else {
      finish({ reason });
    }
  };

  const start = async (snapshotId) => {
    const opaqueId = String(snapshotId ?? '').trim();
    if (!opaqueId) throw new Error('A playtest snapshot ID is required.');
    if (game.getLevelEditorPlaytestState?.().active) await stop('editorRestart');
    releaseAssets();

    const snapshot = await store.readPlaytestSnapshot(opaqueId);
    if (!snapshot) throw new Error('The playtest snapshot is missing or expired. Compile it again.');
    let dungeon = snapshot.dungeon ?? snapshot.compiled ?? snapshot.value ?? null;
    let roomRegistry = snapshot.roomRegistry ?? snapshot.registry ?? null;
    if (!dungeon && snapshot.project) {
      const compiled = compileEditorProject(snapshot.project, { requireSpawn: true });
      if (!compiled.ok) throw new Error(compiled.errors[0]?.message ?? 'The editor project is not playable.');
      dungeon = compiled.dungeon;
      roomRegistry = compiled.registry;
    }
    const validation = validateAuthoredDungeon(dungeon, { roomRegistry });
    if (!validation.ok) throw new Error(validation.errors[0]?.message ?? 'The authored dungeon is invalid.');

    currentResolver = await createPlaytestAssetResolver(store, snapshot.project);
    const facade = await assembleAuthoredDungeon(snapshot, {
      roomRegistry,
      assetResolver: currentResolver,
      strict: true,
    });
    const result = game.enterLevelEditorPlaytest(facade, {
      onExit: ({ reason }) => finish({ reason, snapshotId: opaqueId }),
    });
    if (!result?.ok) {
      facade.dispose?.();
      releaseAssets();
      throw new Error(result?.message ?? 'The authored dungeon could not be mounted.');
    }
    currentSnapshotId = opaqueId;
    game.start();
    game.renderer?.domElement?.focus?.();
    post('playtest:started', {
      snapshotId: opaqueId,
      planHash: facade.planHash ?? dungeon.contentHash ?? null,
      diagnostics: facade.diagnostics ?? null,
    });
  };

  const enqueue = (operation, request = {}) => {
    const run = () => operation().catch((error) => {
      releaseAssets();
      post('playtest:error', {
        snapshotId: request.snapshotId ?? currentSnapshotId,
        requestId: request.requestId ?? null,
        message: readableError(error),
      });
    });
    operationQueue = operationQueue.then(run, run);
    return operationQueue;
  };

  const onMessage = (event) => {
    if (event.source !== parentWindow || event.origin !== expectedOrigin) return;
    const message = event.data;
    if (!message || message.channel !== LEVEL_EDITOR_BRIDGE_CHANNEL
      || message.version !== LEVEL_EDITOR_BRIDGE_VERSION) return;
    if (message.type === 'playtest:start') enqueue(() => start(message.snapshotId), message);
    if (message.type === 'playtest:stop') enqueue(() => stop(message.reason), message);
  };

  window.addEventListener('message', onMessage);
  store.cleanupPlaytestSnapshots().catch(() => null);
  post('playtest:ready', {
    capabilities: ['snapshot-v1', 'authored-room-v1', 'authored-dungeon-v1', 'blob-assets-v1'],
  });

  const api = {
    start: (snapshotId) => enqueue(() => start(snapshotId), { snapshotId }),
    stop: (reason) => enqueue(() => stop(reason)),
    dispose() {
      window.removeEventListener('message', onMessage);
      if (game.getLevelEditorPlaytestState?.().active) game.exitLevelEditorPlaytest('hostDispose');
      releaseAssets();
      store.close();
    },
    getState() {
      return {
        snapshotId: currentSnapshotId,
        queued: operationQueue,
        assets: currentResolver?.objectUrlCount?.() ?? 0,
        game: game.getLevelEditorPlaytestState?.() ?? { active: false },
      };
    },
  };
  window.levelEditorPlaytestHost = api;
  return api;
}

