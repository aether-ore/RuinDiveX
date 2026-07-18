import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unityRoot = path.join(repositoryRoot, 'unity', 'RuinCrawler');
const manifestPath = path.join(
  unityRoot,
  'Assets',
  'RuinCrawler',
  'Art',
  'DungeonV2',
  'Textures',
  'dungeon_v2_texture_manifest.json',
);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function absoluteAssetPath(assetPath) {
  assert.match(assetPath, /^Assets\//u, `Expected an Assets-relative path: ${assetPath}`);
  return path.join(unityRoot, ...assetPath.split('/'));
}

function readPngHeader(bytes) {
  assert.ok(
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'Expected a PNG signature.',
  );
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

function assertUnique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique.`);
}

test('Dungeon V2 texture manifest is complete, hashed, and runtime-sized', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.profileId, 'industrial-factory-v2');
  assert.equal(manifest.runtimeSize, 256);
  assert.equal(manifest.shippingStatus, 'development-only-pending-provenance-clearance');
  assert.equal(manifest.sources.length, 5);
  assert.equal(manifest.maps.length, 36);
  assert.equal(manifest.materials.length, 18);

  assertUnique(manifest.sources.map((source) => source.id), 'Source IDs');
  assertUnique(manifest.maps.map((map) => map.id), 'Map IDs');
  assertUnique(manifest.maps.map((map) => map.output), 'Map outputs');
  assertUnique(manifest.maps.map((map) => map.guid), 'Map GUIDs');
  assertUnique(manifest.materials.map((material) => material.id), 'Material IDs');
  assertUnique(manifest.materials.map((material) => material.output), 'Material outputs');
  assertUnique(manifest.materials.map((material) => material.guid), 'Material GUIDs');

  for (const source of manifest.sources) {
    const bytes = readFileSync(absoluteAssetPath(source.path));
    assert.equal(sha256(bytes), source.sha256);
    const header = readPngHeader(bytes);
    assert.equal(header.width, source.width);
    assert.equal(header.height, source.height);
    assert.ok(source.provenance.length > 40);
  }

  const sourceIds = new Set(manifest.sources.map((source) => source.id));
  for (const map of manifest.maps) {
    assert.ok(sourceIds.has(map.sourceId), `${map.id} references an unknown source.`);
    assert.doesNotMatch(map.output, /SourceMasters/u);
    assert.match(map.output, /^Assets\/RuinCrawler\/Art\/DungeonV2\/Textures\//u);
    assert.match(map.guid, /^[0-9a-f]{32}$/u);
    assert.equal(map.width, 256);
    assert.equal(map.height, 256);

    const bytes = readFileSync(absoluteAssetPath(map.output));
    assert.equal(sha256(bytes), map.sha256, `${map.id} has stale output bytes.`);
    const header = readPngHeader(bytes);
    assert.deepEqual(
      { width: header.width, height: header.height, bitDepth: header.bitDepth, colorType: header.colorType },
      { width: 256, height: 256, bitDepth: 8, colorType: 6 },
      `${map.id} must be 256x256 RGBA8.`,
    );

    const meta = readFileSync(`${absoluteAssetPath(map.output)}.meta`, 'utf8');
    assert.match(meta, new RegExp(`^guid: ${map.guid}$`, 'mu'));
    assert.match(meta, /filterMode: 2/u);
    assert.match(meta, /aniso: 4/u);
    assert.match(meta, /maxTextureSize: 256/u);
  }
});

test('Dungeon V2 masks and transparent decals use explicit import semantics', () => {
  const linearMasks = manifest.maps.filter((map) => map.colorSpace === 'Linear');
  assert.deepEqual(
    linearMasks.map((map) => map.alphaMode).sort(),
    ['CyanEmissionMask', 'CyanEmissionMask', 'HeatEmissionMask'],
  );
  for (const map of linearMasks) {
    const meta = readFileSync(`${absoluteAssetPath(map.output)}.meta`, 'utf8');
    assert.match(meta, /sRGBTexture: 0/u);
    assert.match(meta, /alphaIsTransparency: 0/u);
  }

  const decals = manifest.maps.filter((map) => map.alphaMode === 'GrayBackgroundToAlpha');
  assert.equal(decals.length, 6);
  for (const map of decals) {
    assert.equal(map.wrapMode, 'Clamp');
    const meta = readFileSync(`${absoluteAssetPath(map.output)}.meta`, 'utf8');
    assert.match(meta, /wrapU: 1/u);
    assert.match(meta, /alphaIsTransparency: 1/u);
  }
});

test('Dungeon V2 shared materials reference only derived maps and requested shaders', () => {
  const expectedShaders = new Set([
    'Ruin/IndustrialLit',
    'Ruin/WaterSurface',
    'Ruin/MagmaSurface',
    'Ruin/ElectricPanel',
  ]);
  const mapIds = new Set(manifest.maps.map((map) => map.id));
  for (const material of manifest.materials) {
    assert.ok(expectedShaders.has(material.shader), `${material.id} uses ${material.shader}.`);
    assert.ok(mapIds.has(material.mainMapId));
    if (material.emissionMapId) assert.ok(mapIds.has(material.emissionMapId));
    if (material.detailMapId) assert.ok(mapIds.has(material.detailMapId));

    const bytes = readFileSync(absoluteAssetPath(material.output));
    assert.equal(sha256(bytes), material.sha256, `${material.id} has stale material YAML.`);
    const text = bytes.toString('utf8');
    assert.doesNotMatch(text, /SourceMasters/u);
    assert.doesNotMatch(text, /Universal Render Pipeline/u);
    const meta = readFileSync(`${absoluteAssetPath(material.output)}.meta`, 'utf8');
    assert.match(meta, new RegExp(`^guid: ${material.guid}$`, 'mu'));
  }

  assert.equal(manifest.materialCatalog.entryCount, manifest.materials.length);
  const catalogBytes = readFileSync(absoluteAssetPath(manifest.materialCatalog.output));
  assert.equal(sha256(catalogBytes), manifest.materialCatalog.sha256);
  const catalogText = catalogBytes.toString('utf8');
  assert.equal((catalogText.match(/^  - roleId:/gmu) ?? []).length, manifest.materials.length);
  for (const material of manifest.materials) {
    assert.match(catalogText, new RegExp(`^  - roleId: ${material.role}$`, 'mu'));
    assert.match(catalogText, new RegExp(`guid: ${material.guid}`, 'u'));
  }
  const catalogMeta = readFileSync(`${absoluteAssetPath(manifest.materialCatalog.output)}.meta`, 'utf8');
  assert.match(catalogMeta, new RegExp(`^guid: ${manifest.materialCatalog.guid}$`, 'mu'));
});
