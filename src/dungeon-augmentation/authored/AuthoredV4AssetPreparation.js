import {
  createAuthoredV4AssetDecodeReceipt,
  createAuthoredV4ReleaseArtifactIdentity,
} from './AuthoredV4ReleaseEvidence.js';

export const DUNGEON_AUGMENTATION_AUTHORED_PREPARED_ASSETS_SCHEMA =
  'ruindivex-dungeon-augmentation-authored-prepared-assets/v1';
export const DUNGEON_AUGMENTATION_AUTHORED_ASSET_MANIFEST_SCHEMA =
  'ruindivex-dungeon-augmentation-asset-manifest/v1';

const SHA256_PATTERN = /^sha256-[0-9a-f]{64}$/u;
const DEFAULT_CONCURRENCY = 8;

function abortError(message = 'Authored V4 asset preparation was cancelled.') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'AUTHORED_V4_ASSET_PREPARATION_ABORTED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted === true) throw abortError();
}

function errorSummary(error, fallbackCode = 'AUTHORED_V4_ASSET_PREPARATION_FAILED') {
  return Object.freeze({
    code: typeof error?.code === 'string' ? error.code : fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  });
}

export class AuthoredV4AssetPreparationError extends Error {
  constructor(code, message, {
    assetId = null,
    cause = null,
    details = {},
    partialReceipt = null,
  } = {}) {
    super(message, cause == null ? undefined : { cause });
    this.name = code === 'AUTHORED_V4_ASSET_PREPARATION_ABORTED'
      ? 'AbortError'
      : 'AuthoredV4AssetPreparationError';
    this.code = code;
    this.assetId = assetId;
    this.details = Object.freeze({ ...details });
    this.partialReceipt = partialReceipt;
  }
}

function validateManifest(artifact) {
  const manifest = artifact?.assetManifest;
  const diagnostics = [];
  if (manifest?.schema !== DUNGEON_AUGMENTATION_AUTHORED_ASSET_MANIFEST_SCHEMA
    || !Array.isArray(manifest?.assets)) {
    diagnostics.push({
      code: 'AUTHORED_V4_ASSET_MANIFEST_INVALID',
      message: 'The verified authored artifact does not contain a supported asset manifest.',
    });
    return { assets: [], diagnostics };
  }

  const ids = new Set();
  const uris = new Set();
  for (const [index, asset] of manifest.assets.entries()) {
    const id = typeof asset?.id === 'string' ? asset.id.trim() : '';
    const uri = typeof asset?.uri === 'string' ? asset.uri.trim() : '';
    if (!id) {
      diagnostics.push({
        code: 'AUTHORED_V4_ASSET_ID_INVALID',
        message: `Asset manifest entry ${index} has no stable id.`,
        assetId: null,
      });
    } else if (ids.has(id)) {
      diagnostics.push({
        code: 'AUTHORED_V4_ASSET_ID_DUPLICATED',
        message: `Asset id ${id} is duplicated.`,
        assetId: id,
      });
    }
    if (!uri) {
      diagnostics.push({
        code: 'AUTHORED_V4_ASSET_URI_INVALID',
        message: `Asset ${id || index} has no fetch URI.`,
        assetId: id || null,
      });
    } else if (uris.has(uri)) {
      diagnostics.push({
        code: 'AUTHORED_V4_ASSET_URI_DUPLICATED',
        message: `Asset URI ${uri} is duplicated.`,
        assetId: id || null,
      });
    }
    if (!SHA256_PATTERN.test(asset?.contentHash ?? '')) {
      diagnostics.push({
        code: 'AUTHORED_V4_ASSET_HASH_INVALID',
        message: `Asset ${id || index} does not declare a lowercase SHA-256 content hash.`,
        assetId: id || null,
      });
    }
    if (!Number.isSafeInteger(asset?.byteLength) || asset.byteLength <= 0) {
      diagnostics.push({
        code: 'AUTHORED_V4_ASSET_BYTE_LENGTH_INVALID',
        message: `Asset ${id || index} does not declare a positive byte length.`,
        assetId: id || null,
      });
    }
    if (typeof asset?.kind !== 'string' || asset.kind.trim().length === 0) {
      diagnostics.push({
        code: 'AUTHORED_V4_ASSET_KIND_INVALID',
        message: `Asset ${id || index} does not declare an asset kind.`,
        assetId: id || null,
      });
    }
    if (id) ids.add(id);
    if (uri) uris.add(uri);
  }
  return { assets: manifest.assets, diagnostics };
}

function asBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

async function readFetchResult(result, asset) {
  const direct = asBytes(result);
  if (direct) return direct;
  if (!result || typeof result.arrayBuffer !== 'function') {
    throw Object.assign(
      new Error(`Fetch dependency returned no bytes for ${asset.id}.`),
      { code: 'AUTHORED_V4_ASSET_FETCH_RESULT_INVALID' },
    );
  }
  if (result.ok === false) {
    throw Object.assign(
      new Error(`Asset fetch failed for ${asset.id} with status ${result.status ?? 'unknown'}.`),
      {
        code: 'AUTHORED_V4_ASSET_FETCH_FAILED',
        status: result.status ?? null,
      },
    );
  }
  const bytes = asBytes(await result.arrayBuffer());
  if (!bytes) {
    throw Object.assign(
      new Error(`Asset fetch returned an invalid body for ${asset.id}.`),
      { code: 'AUTHORED_V4_ASSET_FETCH_RESULT_INVALID' },
    );
  }
  return bytes;
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function normalizeDigest(value) {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (SHA256_PATTERN.test(normalized)) return normalized;
    if (/^[0-9a-f]{64}$/u.test(normalized)) return `sha256-${normalized}`;
  }
  const bytes = asBytes(value);
  if (bytes?.byteLength === 32) return `sha256-${bytesToHex(bytes)}`;
  throw Object.assign(
    new Error('SHA-256 digest dependency returned an invalid digest.'),
    { code: 'AUTHORED_V4_ASSET_DIGEST_INVALID' },
  );
}

async function defaultDigestSha256(bytes) {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw Object.assign(
      new Error('Web Crypto SHA-256 is unavailable.'),
      { code: 'AUTHORED_V4_ASSET_DIGEST_UNAVAILABLE' },
    );
  }
  return globalThis.crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

async function defaultFetchAsset(uri, { signal }) {
  if (typeof globalThis.fetch !== 'function') {
    throw Object.assign(
      new Error('Browser fetch is unavailable.'),
      { code: 'AUTHORED_V4_ASSET_FETCH_UNAVAILABLE' },
    );
  }
  return globalThis.fetch(uri, { signal });
}

function textureMimeType(uri) {
  if (/\.jpe?g(?:$|[?#])/iu.test(uri)) return 'image/jpeg';
  if (/\.webp(?:$|[?#])/iu.test(uri)) return 'image/webp';
  return 'image/png';
}

async function defaultDecodeTexture({ asset, bytes, signal }) {
  if (typeof globalThis.createImageBitmap !== 'function') {
    throw Object.assign(
      new Error('createImageBitmap is unavailable for authored texture decoding.'),
      { code: 'AUTHORED_V4_ASSET_DECODER_UNAVAILABLE' },
    );
  }
  throwIfAborted(signal);
  const bitmap = await globalThis.createImageBitmap(new Blob(
    [bytes],
    { type: textureMimeType(asset.uri) },
  ));
  if (signal?.aborted === true) {
    bitmap.close?.();
    throw abortError();
  }
  return {
    handle: bitmap,
    dispose: () => bitmap.close?.(),
  };
}

function createOperationSignal(externalSignal) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted === true) forwardAbort();
  else externalSignal?.addEventListener?.('abort', forwardAbort, { once: true });
  return {
    controller,
    cleanup: () => externalSignal?.removeEventListener?.('abort', forwardAbort),
  };
}

function createDecodedResource(asset, decoded) {
  const handle = decoded && typeof decoded === 'object' && 'handle' in decoded
    ? decoded.handle
    : decoded;
  let dispose = null;
  if (typeof decoded?.dispose === 'function') dispose = () => decoded.dispose();
  else if (typeof handle?.dispose === 'function') dispose = () => handle.dispose();
  else if (typeof handle?.close === 'function') dispose = () => handle.close();
  return { asset, handle, dispose };
}

function createIdempotentDisposer(resources) {
  let disposalPromise = null;
  const dispose = () => {
    if (disposalPromise) return disposalPromise;
    disposalPromise = (async () => {
      const errors = [];
      let disposedCount = 0;
      for (const resource of [...resources].reverse()) {
        if (typeof resource.dispose !== 'function') continue;
        try {
          await resource.dispose();
          disposedCount += 1;
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, 'One or more authored asset handles failed to dispose.');
      }
      return Object.freeze({ disposedCount });
    })();
    return disposalPromise;
  };
  return {
    dispose,
    get disposed() {
      return disposalPromise != null;
    },
  };
}

function installPreparedTexturesIntoCache(preparedAssets, cache) {
  if (!cache
    || typeof cache.get !== 'function'
    || typeof cache.add !== 'function'
    || typeof cache.remove !== 'function') {
    throw new AuthoredV4AssetPreparationError(
      'AUTHORED_V4_ASSET_CACHE_INVALID',
      'The authored texture cache handoff requires get, add, and remove operations.',
    );
  }
  const previousEnabled = cache.enabled === true;
  const installed = [];
  cache.enabled = true;
  const restore = () => {
    for (const entry of [...installed].reverse()) {
      if (cache.get(entry.uri) !== entry.handle) continue;
      if (entry.previous === undefined) cache.remove(entry.uri);
      else cache.add(entry.uri, entry.previous);
    }
    cache.enabled = previousEnabled;
  };
  try {
    for (const entry of preparedAssets) {
      if (entry.kind !== 'texture' || entry.handle == null) continue;
      const previous = cache.get(entry.uri);
      cache.add(entry.uri, entry.handle);
      installed.push({ uri: entry.uri, handle: entry.handle, previous });
    }
  } catch (error) {
    restore();
    throw new AuthoredV4AssetPreparationError(
      'AUTHORED_V4_ASSET_CACHE_INSTALL_FAILED',
      'Decoded authored textures could not be handed to the renderer cache.',
      { cause: error },
    );
  }
  let released = false;
  const dispose = () => {
    if (released) return false;
    released = true;
    restore();
    return true;
  };
  return Object.freeze({
    installedCount: installed.length,
    dispose,
    get disposed() { return released; },
  });
}

function receiptRecord(asset) {
  return {
    id: typeof asset?.id === 'string' ? asset.id : null,
    uri: typeof asset?.uri === 'string' ? asset.uri : null,
    kind: typeof asset?.kind === 'string' ? asset.kind : null,
    byteLength: null,
    declaredByteLength: Number.isSafeInteger(asset?.byteLength) ? asset.byteLength : null,
    contentHash: null,
    declaredContentHash: typeof asset?.contentHash === 'string' ? asset.contentHash : null,
    fetched: false,
    decoded: false,
    fetchDurationMs: null,
    decodeDurationMs: null,
    error: null,
  };
}

function createReceipt(artifact, records, { complete, cancelled }) {
  return createAuthoredV4AssetDecodeReceipt({
    artifactIdentity: createAuthoredV4ReleaseArtifactIdentity(artifact),
    assetManifestHash: artifact?.assetManifestHash,
    declaredAssetCount: records.length,
    completionAware: true,
    complete,
    cancelled,
    assets: records,
  });
}

function duration(now, startedAt) {
  const value = Number(now()) - startedAt;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Fetches, verifies, and fully decodes every texture declared by a verified
 * Industrial V4 authored artifact. The returned handles are owned by the
 * result and must be released with its idempotent dispose() function.
 */
export async function prepareIndustrialV4AuthoredAssets({
  artifact,
  fetchAsset = defaultFetchAsset,
  decodeTexture = defaultDecodeTexture,
  digestSha256 = defaultDigestSha256,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  signal = null,
  concurrency = DEFAULT_CONCURRENCY,
} = {}) {
  const { assets, diagnostics } = validateManifest(artifact);
  const records = assets.map(receiptRecord);
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    throw new AuthoredV4AssetPreparationError(first.code, first.message, {
      assetId: first.assetId ?? null,
      details: { diagnostics },
      partialReceipt: createReceipt(artifact, records, {
        complete: false,
        cancelled: signal?.aborted === true,
      }),
    });
  }
  if (assets.length === 0) {
    throw new AuthoredV4AssetPreparationError(
      'AUTHORED_V4_ASSET_MANIFEST_EMPTY',
      'The authored V4 asset manifest must declare at least one asset.',
      {
        partialReceipt: createReceipt(artifact, records, {
          complete: false,
          cancelled: signal?.aborted === true,
        }),
      },
    );
  }
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new AuthoredV4AssetPreparationError(
      'AUTHORED_V4_ASSET_CONCURRENCY_INVALID',
      'Authored asset preparation concurrency must be an integer from 1 through 32.',
      {
        details: { concurrency },
        partialReceipt: createReceipt(artifact, records, {
          complete: false,
          cancelled: signal?.aborted === true,
        }),
      },
    );
  }
  if (typeof fetchAsset !== 'function'
    || typeof decodeTexture !== 'function'
    || typeof digestSha256 !== 'function'
    || typeof now !== 'function') {
    throw new AuthoredV4AssetPreparationError(
      'AUTHORED_V4_ASSET_DEPENDENCY_INVALID',
      'Asset preparation dependencies must be callable.',
      {
        partialReceipt: createReceipt(artifact, records, {
          complete: false,
          cancelled: signal?.aborted === true,
        }),
      },
    );
  }

  const preparationStartedAt = Number(now());
  const resources = [];
  const disposer = createIdempotentDisposer(resources);
  const operation = createOperationSignal(signal);
  let nextIndex = 0;
  let firstFailure = null;

  const processAsset = async (asset, record) => {
    throwIfAborted(operation.controller.signal);
    const fetchStartedAt = Number(now());
    const response = await fetchAsset(asset.uri, {
      asset,
      signal: operation.controller.signal,
    });
    const bytes = await readFetchResult(response, asset);
    record.fetched = true;
    record.byteLength = bytes.byteLength;
    record.fetchDurationMs = duration(now, fetchStartedAt);
    throwIfAborted(operation.controller.signal);

    const actualHash = normalizeDigest(await digestSha256(bytes, {
      asset,
      signal: operation.controller.signal,
    }));
    record.contentHash = actualHash;
    throwIfAborted(operation.controller.signal);
    if (bytes.byteLength !== asset.byteLength) {
      throw Object.assign(
        new Error(
          `Asset ${asset.id} byte length ${bytes.byteLength} does not match ${asset.byteLength}.`,
        ),
        {
          code: 'AUTHORED_V4_ASSET_BYTE_LENGTH_MISMATCH',
          details: { actualByteLength: bytes.byteLength, expectedByteLength: asset.byteLength },
        },
      );
    }
    if (actualHash !== asset.contentHash) {
      throw Object.assign(
        new Error(`Asset ${asset.id} failed SHA-256 content verification.`),
        {
          code: 'AUTHORED_V4_ASSET_HASH_MISMATCH',
          details: { actualHash, expectedHash: asset.contentHash },
        },
      );
    }

    if (asset.kind !== 'texture') {
      record.decoded = true;
      record.decodeDurationMs = 0;
      return;
    }
    const decodeStartedAt = Number(now());
    const decoded = await decodeTexture({
      asset,
      bytes,
      signal: operation.controller.signal,
    });
    const resource = createDecodedResource(asset, decoded);
    if (resource.handle == null) {
      throw Object.assign(
        new Error(`Texture decoder returned no handle for ${asset.id}.`),
        { code: 'AUTHORED_V4_ASSET_DECODE_RESULT_INVALID' },
      );
    }
    resources.push(resource);
    if (operation.controller.signal.aborted) {
      await resource.dispose?.();
      resources.splice(resources.indexOf(resource), 1);
      throw abortError();
    }
    record.decoded = true;
    record.decodeDurationMs = duration(now, decodeStartedAt);
  };

  const worker = async () => {
    while (!firstFailure) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= assets.length) return;
      const asset = assets[index];
      const record = records[index];
      try {
        await processAsset(asset, record);
      } catch (error) {
        record.error = errorSummary(error);
        if (!firstFailure) {
          firstFailure = { asset, error };
          operation.controller.abort(error);
        }
      }
    }
  };

  try {
    throwIfAborted(operation.controller.signal);
    await Promise.all(
      Array.from({ length: Math.min(concurrency, assets.length) }, () => worker()),
    );
    if (firstFailure) throw firstFailure.error;
    throwIfAborted(operation.controller.signal);
  } catch (error) {
    const cancelled = signal?.aborted === true
      || (error?.code === 'AUTHORED_V4_ASSET_PREPARATION_ABORTED' && !firstFailure);
    const summary = errorSummary(error, cancelled
      ? 'AUTHORED_V4_ASSET_PREPARATION_ABORTED'
      : 'AUTHORED_V4_ASSET_PREPARATION_FAILED');
    for (const record of records) {
      if (record.error == null && record.decoded !== true) {
        record.error = cancelled
          ? { code: 'AUTHORED_V4_ASSET_PREPARATION_ABORTED', message: 'Cancelled.' }
          : { code: 'AUTHORED_V4_ASSET_NOT_PREPARED', message: 'Not prepared.' };
      }
    }
    let cleanupError = null;
    try {
      await disposer.dispose();
    } catch (disposalError) {
      cleanupError = errorSummary(disposalError, 'AUTHORED_V4_ASSET_DISPOSAL_FAILED');
    }
    const failedAsset = firstFailure?.asset ?? null;
    throw new AuthoredV4AssetPreparationError(
      cancelled ? 'AUTHORED_V4_ASSET_PREPARATION_ABORTED' : summary.code,
      cancelled ? 'Authored V4 asset preparation was cancelled.' : summary.message,
      {
        assetId: failedAsset?.id ?? null,
        cause: error,
        details: {
          ...(error?.details ?? {}),
          cleanupError,
        },
        partialReceipt: createReceipt(artifact, records, {
          complete: false,
          cancelled,
        }),
      },
    );
  } finally {
    operation.cleanup();
  }

  const receipt = createReceipt(artifact, records, {
    complete: true,
    cancelled: false,
  });
  if (receipt.accepted !== true) {
    await disposer.dispose();
    throw new AuthoredV4AssetPreparationError(
      'AUTHORED_V4_ASSET_RECEIPT_REJECTED',
      'Completed asset preparation did not produce an accepted decode receipt.',
      { partialReceipt: receipt },
    );
  }

  const preparedAssetEntries = resources.map((resource) => Object.freeze({
    id: resource.asset.id,
    uri: resource.asset.uri,
    kind: resource.asset.kind,
    handle: resource.handle,
  }));
  const resourcesById = new Map(resources.map((resource) => [resource.asset.id, resource]));
  const metrics = Object.freeze({
    totalTimeMs: duration(now, preparationStartedAt),
    fetchAndHashWorkTimeMs: records.reduce(
      (sum, record) => sum + Math.max(0, Number(record.fetchDurationMs) || 0),
      0,
    ),
    decodeWorkTimeMs: records.reduce(
      (sum, record) => sum + Math.max(0, Number(record.decodeDurationMs) || 0),
      0,
    ),
    declaredAssetCount: records.length,
    decodedTextureCount: preparedAssetEntries.length,
    concurrency,
  });
  return Object.freeze({
    schema: DUNGEON_AUGMENTATION_AUTHORED_PREPARED_ASSETS_SCHEMA,
    artifactIdentity: createAuthoredV4ReleaseArtifactIdentity(artifact),
    receipt,
    metrics,
    assets: Object.freeze(preparedAssetEntries),
    get: (assetId) => resourcesById.get(assetId)?.handle ?? null,
    installIntoCache: (cache) => installPreparedTexturesIntoCache(
      preparedAssetEntries,
      cache,
    ),
    dispose: disposer.dispose,
    get disposed() {
      return disposer.disposed;
    },
  });
}
