import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  AuthoredV4AssetPreparationError,
  prepareIndustrialV4AuthoredAssets,
} from '../src/dungeon-augmentation/authored/AuthoredV4AssetPreparation.js';
import {
  evaluateAuthoredV4AssetDecodeReceipt,
} from '../src/dungeon-augmentation/authored/AuthoredV4ReleaseEvidence.js';
import {
  INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
  INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
  INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
  INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
  INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
  INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
  INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
} from '../src/dungeon-augmentation/authored/AuthoredArtifactCompiler.js';

const MANIFEST_SCHEMA = 'ruindivex-dungeon-augmentation-asset-manifest/v1';

function contentHash(bytes) {
  return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}

async function digestSha256(bytes) {
  return contentHash(bytes);
}

function asset(id, uri, bytes, overrides = {}) {
  return {
    id,
    uri,
    kind: 'texture',
    byteLength: bytes.byteLength,
    contentHash: contentHash(bytes),
    ...overrides,
  };
}

function artifact(assets) {
  return {
    artifactId: INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
    artifactRevision: INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
    profileId: INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
    profileRevision: INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
    gameplayTuningRevision: INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
    generationMode: INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
    canonicalLayoutSeed: INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
    artifactHash: 'v1-fixture-artifact',
    sourceContentHash: 'v1-fixture-source',
    baseGeometryHash: 'v1-fixture-base',
    overlayPlanHash: 'v1-fixture-overlay',
    effectiveLayoutHash: 'v1-fixture-effective',
    materializedLayoutHash: 'v1-fixture-materialized',
    assetManifestHash: 'v1-fixture-assets',
    assetManifest: { schema: MANIFEST_SCHEMA, assets },
  };
}

function dependencies(bytesByUri, decodeTexture) {
  let clock = 0;
  return {
    fetchAsset: async (uri) => {
      const bytes = bytesByUri.get(uri);
      if (!bytes) throw new Error(`Unexpected URI ${uri}`);
      return bytes;
    },
    decodeTexture,
    digestSha256,
    now: () => ++clock,
  };
}

test('authored V4 asset preparation verifies and completion-decodes with bounded concurrency', async () => {
  const bytesByUri = new Map([
    ['/a.png', new Uint8Array([1, 2, 3])],
    ['/b.png', new Uint8Array([4, 5, 6, 7])],
    ['/c.png', new Uint8Array([8, 9])],
  ]);
  const manifestAssets = [...bytesByUri].map(([uri, bytes], index) => (
    asset(`texture:${index}`, uri, bytes)
  ));
  let activeDecodes = 0;
  let maximumActiveDecodes = 0;
  const disposeCounts = new Map();
  const decodeTexture = async ({ asset: entry, bytes }) => {
    activeDecodes += 1;
    maximumActiveDecodes = Math.max(maximumActiveDecodes, activeDecodes);
    await new Promise((resolve) => setImmediate(resolve));
    activeDecodes -= 1;
    assert.equal(bytes.byteLength, bytesByUri.get(entry.uri).byteLength);
    return {
      handle: { textureId: entry.id },
      dispose: () => disposeCounts.set(entry.id, (disposeCounts.get(entry.id) ?? 0) + 1),
    };
  };

  const prepared = await prepareIndustrialV4AuthoredAssets({
    artifact: artifact(manifestAssets),
    ...dependencies(bytesByUri, decodeTexture),
    concurrency: 2,
  });

  assert.equal(prepared.receipt.accepted, true);
  assert.equal(evaluateAuthoredV4AssetDecodeReceipt(prepared.receipt).accepted, true);
  assert.equal(prepared.receipt.declaredAssetCount, 3);
  assert.equal(prepared.receipt.assets.every((entry) => (
    entry.fetched && entry.decoded && entry.error == null
  )), true);
  assert.equal(maximumActiveDecodes <= 2, true);
  assert.deepEqual(prepared.get('texture:1'), { textureId: 'texture:1' });
  assert.equal(prepared.metrics.concurrency, 2);
  assert.equal(prepared.metrics.declaredAssetCount, 3);
  assert.equal(prepared.metrics.decodedTextureCount, 3);
  assert.equal(prepared.metrics.totalTimeMs > 0, true);
  assert.equal(prepared.disposed, false);

  const previousImage = { textureId: 'previous' };
  const cache = {
    enabled: false,
    files: new Map([['/b.png', previousImage]]),
    get(uri) { return this.enabled ? this.files.get(uri) : undefined; },
    add(uri, handle) { if (this.enabled) this.files.set(uri, handle); },
    remove(uri) { this.files.delete(uri); },
  };
  const cacheLease = prepared.installIntoCache(cache);
  assert.equal(cacheLease.installedCount, 3);
  assert.equal(cache.enabled, true);
  assert.equal(cache.get('/a.png'), prepared.get('texture:0'));
  assert.equal(cache.get('/b.png'), prepared.get('texture:1'));
  assert.equal(cacheLease.dispose(), true);
  assert.equal(cacheLease.dispose(), false);
  assert.equal(cache.enabled, false);
  assert.equal(cache.files.has('/a.png'), false);
  assert.equal(cache.files.get('/b.png'), previousImage);

  const firstDisposal = prepared.dispose();
  const secondDisposal = prepared.dispose();
  assert.strictEqual(firstDisposal, secondDisposal);
  assert.deepEqual(await firstDisposal, { disposedCount: 3 });
  assert.equal(prepared.disposed, true);
  assert.deepEqual([...disposeCounts.values()], [1, 1, 1]);
});

test('byte-length mismatch fails closed after hashing and disposes prior decoded handles', async () => {
  const goodBytes = new Uint8Array([10, 11]);
  const badBytes = new Uint8Array([12, 13, 14]);
  const bytesByUri = new Map([
    ['/good.png', goodBytes],
    ['/bad.png', badBytes],
  ]);
  const manifestAssets = [
    asset('texture:good', '/good.png', goodBytes),
    asset('texture:bad', '/bad.png', badBytes, { byteLength: badBytes.byteLength + 1 }),
  ];
  let disposed = 0;
  let decoded = 0;

  await assert.rejects(
    prepareIndustrialV4AuthoredAssets({
      artifact: artifact(manifestAssets),
      ...dependencies(bytesByUri, async () => {
        decoded += 1;
        return { handle: {}, dispose: () => { disposed += 1; } };
      }),
      concurrency: 1,
    }),
    (error) => {
      assert.equal(error instanceof AuthoredV4AssetPreparationError, true);
      assert.equal(error.code, 'AUTHORED_V4_ASSET_BYTE_LENGTH_MISMATCH');
      assert.equal(error.assetId, 'texture:bad');
      assert.equal(error.partialReceipt.accepted, false);
      assert.equal(error.partialReceipt.complete, false);
      const failed = error.partialReceipt.assets.find(({ id }) => id === 'texture:bad');
      assert.equal(failed.fetched, true);
      assert.equal(failed.contentHash, contentHash(badBytes));
      return true;
    },
  );
  assert.equal(decoded, 1);
  assert.equal(disposed, 1);
});

test('content-hash mismatch fails before decode with the actual digest in its partial receipt', async () => {
  const bytes = new Uint8Array([20, 21, 22]);
  const bytesByUri = new Map([['/hash.png', bytes]]);
  const manifestAssets = [asset('texture:hash', '/hash.png', bytes, {
    contentHash: `sha256-${'0'.repeat(64)}`,
  })];
  let decodeCalls = 0;

  await assert.rejects(
    prepareIndustrialV4AuthoredAssets({
      artifact: artifact(manifestAssets),
      ...dependencies(bytesByUri, async () => {
        decodeCalls += 1;
        return {};
      }),
    }),
    (error) => {
      assert.equal(error.code, 'AUTHORED_V4_ASSET_HASH_MISMATCH');
      assert.equal(error.partialReceipt.assets[0].contentHash, contentHash(bytes));
      assert.equal(error.partialReceipt.assets[0].decoded, false);
      return true;
    },
  );
  assert.equal(decodeCalls, 0);
});

test('decode failure disposes every texture completed earlier in the bounded queue', async () => {
  const firstBytes = new Uint8Array([30]);
  const secondBytes = new Uint8Array([31]);
  const bytesByUri = new Map([
    ['/first.png', firstBytes],
    ['/second.png', secondBytes],
  ]);
  const manifestAssets = [
    asset('texture:first', '/first.png', firstBytes),
    asset('texture:second', '/second.png', secondBytes),
  ];
  let disposed = 0;

  await assert.rejects(
    prepareIndustrialV4AuthoredAssets({
      artifact: artifact(manifestAssets),
      ...dependencies(bytesByUri, async ({ asset: entry }) => {
        if (entry.id === 'texture:second') {
          throw Object.assign(new Error('decoder rejected corrupt PNG'), {
            code: 'AUTHORED_V4_TEXTURE_DECODE_FAILED',
          });
        }
        return { handle: {}, dispose: () => { disposed += 1; } };
      }),
      concurrency: 1,
    }),
    (error) => {
      assert.equal(error.code, 'AUTHORED_V4_TEXTURE_DECODE_FAILED');
      assert.equal(error.assetId, 'texture:second');
      assert.equal(error.partialReceipt.assets[0].decoded, true);
      assert.equal(error.partialReceipt.assets[1].decoded, false);
      return true;
    },
  );
  assert.equal(disposed, 1);
});

test('external cancellation returns a cancelled partial receipt and tears down decoded handles', async () => {
  const firstBytes = new Uint8Array([40]);
  const secondBytes = new Uint8Array([41]);
  const bytesByUri = new Map([
    ['/first.png', firstBytes],
    ['/second.png', secondBytes],
  ]);
  const manifestAssets = [
    asset('texture:first', '/first.png', firstBytes),
    asset('texture:second', '/second.png', secondBytes),
  ];
  const controller = new AbortController();
  let disposed = 0;

  await assert.rejects(
    prepareIndustrialV4AuthoredAssets({
      artifact: artifact(manifestAssets),
      ...dependencies(bytesByUri, async ({ asset: entry }) => {
        if (entry.id === 'texture:second') {
          controller.abort();
          throw Object.assign(new Error('cancelled by caller'), {
            code: 'AUTHORED_V4_ASSET_PREPARATION_ABORTED',
          });
        }
        return { handle: {}, dispose: () => { disposed += 1; } };
      }),
      concurrency: 1,
      signal: controller.signal,
    }),
    (error) => {
      assert.equal(error.name, 'AbortError');
      assert.equal(error.code, 'AUTHORED_V4_ASSET_PREPARATION_ABORTED');
      assert.equal(error.partialReceipt.cancelled, true);
      assert.equal(error.partialReceipt.complete, false);
      assert.equal(error.partialReceipt.accepted, false);
      return true;
    },
  );
  assert.equal(disposed, 1);
});

test('manifest validation rejects duplicate identities, duplicate URIs, malformed hashes, and lengths', async () => {
  const bytes = new Uint8Array([50]);
  const invalidAssets = [
    asset('texture:duplicate', '/same.png', bytes),
    asset('texture:duplicate', '/same.png', bytes, {
      byteLength: 0,
      contentHash: 'sha256-not-a-digest',
    }),
  ];

  await assert.rejects(
    prepareIndustrialV4AuthoredAssets({
      artifact: artifact(invalidAssets),
      ...dependencies(new Map([['/same.png', bytes]]), async () => ({})),
    }),
    (error) => {
      assert.equal(error instanceof AuthoredV4AssetPreparationError, true);
      const codes = error.details.diagnostics.map(({ code }) => code);
      assert.equal(codes.includes('AUTHORED_V4_ASSET_ID_DUPLICATED'), true);
      assert.equal(codes.includes('AUTHORED_V4_ASSET_URI_DUPLICATED'), true);
      assert.equal(codes.includes('AUTHORED_V4_ASSET_HASH_INVALID'), true);
      assert.equal(codes.includes('AUTHORED_V4_ASSET_BYTE_LENGTH_INVALID'), true);
      assert.equal(error.partialReceipt.accepted, false);
      return true;
    },
  );
});
