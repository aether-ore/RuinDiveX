import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const SOURCE_DIR = path.join(PROJECT_ROOT, 'assets', 'art-source', 'overworld', 'voxel');
const NORMALIZED_SOURCE_DIR = path.join(SOURCE_DIR, 'source-1024');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'assets', 'textures', 'overworld', 'voxel');
const MANIFEST_PATH = path.join(RUNTIME_DIR, 'voxel-face-manifest.json');
const VALIDATION_PATH = path.join(RUNTIME_DIR, 'voxel-texture-validation.json');
const PREVIEW_PATH = path.join(SOURCE_DIR, 'voxel-runtime-4x4-tiling-preview.png');

const SOURCE_SIZE = 1024;
const RUNTIME_SIZE = 256;
const SEAM_BLEND_WIDTH = 24;
const CHECK_ONLY = process.argv.includes('--check');

const FACE_FAMILIES = Object.freeze([
  {
    id: 'meadow',
    stem: 'meadow-grass',
    source: {
      top: 'meadow-grass-top.png',
      side: 'meadow-grass-side.png',
      bottom: 'meadow-soil-bottom.png',
    },
  },
  {
    id: 'trail',
    stem: 'worn-trail-earth',
    source: {
      top: 'worn-trail-top.png',
      side: 'worn-trail-side.png',
      bottom: 'worn-trail-bottom.png',
    },
  },
  {
    id: 'stone',
    stem: 'exposed-hill-stone',
    source: {
      top: 'hill-stone-top.png',
      side: 'hill-stone-side.png',
      bottom: 'hill-stone-bottom.png',
    },
  },
  {
    id: 'bark',
    stem: 'tree-bark',
    source: {
      top: 'tree-bark-top.png',
      side: 'tree-bark-side.png',
      bottom: 'tree-bark-bottom.png',
    },
  },
  {
    id: 'leaves',
    stem: 'leaf-canopy',
    source: {
      top: 'leaf-canopy-top.png',
      side: 'leaf-canopy-side.png',
      bottom: 'leaf-canopy-bottom.png',
    },
  },
  {
    id: 'houseWall',
    stem: 'weathered-house-wall',
    source: {
      top: 'house-wall-top.png',
      side: 'house-wall-side.png',
      bottom: 'house-wall-bottom.png',
    },
  },
  {
    id: 'roof',
    stem: 'weathered-shingle-roof',
    source: {
      top: 'shingle-roof-top.png',
      side: 'shingle-roof-side.png',
      bottom: 'shingle-roof-bottom.png',
    },
  },
]);

const FACADES = Object.freeze([
  {
    id: 'woodenDoor',
    source: 'wooden-door-facade.png',
    runtime: 'wooden-door-facade.png',
  },
  {
    id: 'mullionedWindow',
    source: 'mullioned-window-facade.png',
    runtime: 'mullioned-window-facade.png',
  },
]);

function runtimeName(family, face) {
  return `${family.stem}-${face}.png`;
}

function expectedAssets() {
  const assets = [];
  for (const family of FACE_FAMILIES) {
    for (const face of ['top', 'side', 'bottom']) {
      assets.push({
        id: `${family.id}:${face}`,
        familyId: family.id,
        face,
        source: family.source[face],
        runtime: runtimeName(family, face),
      });
    }
  }
  for (const facade of FACADES) {
    assets.push({
      id: `facade:${facade.id}`,
      facadeId: facade.id,
      source: facade.source,
      runtime: facade.runtime,
    });
  }
  return assets;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function webPath(fileName) {
  return `/assets/textures/overworld/voxel/${fileName}`;
}

function createManifest() {
  const families = {};
  for (const family of FACE_FAMILIES) {
    const faces = {
      top: webPath(runtimeName(family, 'top')),
      side: webPath(runtimeName(family, 'side')),
      bottom: webPath(runtimeName(family, 'bottom')),
    };
    families[family.id] = {
      id: family.id,
      ...faces,
      sixFaces: {
        positiveX: faces.side,
        negativeX: faces.side,
        positiveY: faces.top,
        negativeY: faces.bottom,
        positiveZ: faces.side,
        negativeZ: faces.side,
      },
    };
  }
  return {
    id: 'ruindivex-overworld-voxel-faces-v1',
    revision: 2,
    sourceArt: {
      rawGeneratorArtifactDirectory: 'assets/art-source/overworld/voxel',
      rawGeneratorArtifactPolicy: 'untouched-native-output',
      rawGeneratorMinimumAxisPixels: SOURCE_SIZE,
      canonicalSourceDirectory: 'assets/art-source/overworld/voxel/source-1024',
      canonicalSourceSize: SOURCE_SIZE,
      canonicalization: 'center-square-crop-and-high-quality-resample',
      runtimeDerivedFrom: 'canonical-source-1024',
      provenanceValidation: 'assets/textures/overworld/voxel/voxel-texture-validation.json',
    },
    runtimeSize: RUNTIME_SIZE,
    boxMaterialOrder: ['positiveX', 'negativeX', 'positiveY', 'negativeY', 'positiveZ', 'negativeZ'],
    families,
    facades: Object.fromEntries(FACADES.map((facade) => [facade.id, webPath(facade.runtime)])),
    runtime: {
      colorSpace: 'srgb',
      wrapS: 'repeat',
      wrapT: 'repeat',
      generateMipmaps: true,
      anisotropicFiltering: true,
      repeatWorldMetres: 1.5,
    },
  };
}

async function processPng(page, buffer, { outputSize = null, seamBlendWidth = 0, encode = false } = {}) {
  return page.evaluate(async ({ sourceBase64, outputSize, seamBlendWidth, encode }) => {
    const sourceUrl = `data:image/png;base64,${sourceBase64}`;
    const sourceBlob = await (await fetch(sourceUrl)).blob();
    const bitmap = await createImageBitmap(sourceBlob);
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;

    const canvas = document.createElement('canvas');
    canvas.width = outputSize ?? sourceWidth;
    canvas.height = outputSize ?? sourceHeight;
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (outputSize) {
      const cropSize = Math.min(sourceWidth, sourceHeight);
      const sourceX = Math.floor((sourceWidth - cropSize) * 0.5);
      const sourceY = Math.floor((sourceHeight - cropSize) * 0.5);
      context.drawImage(bitmap, sourceX, sourceY, cropSize, cropSize, 0, 0, canvas.width, canvas.height);
    } else {
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    }
    bitmap.close();

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    const width = canvas.width;
    const height = canvas.height;
    const pixelOffset = (x, y) => ((y * width) + x) * 4;

    if (seamBlendWidth > 0) {
      const blendPair = (firstOffset, secondOffset, strength) => {
        for (let channel = 0; channel < 3; channel += 1) {
          const first = pixels[firstOffset + channel];
          const second = pixels[secondOffset + channel];
          const average = Math.round((first + second) * 0.5);
          pixels[firstOffset + channel] = Math.round((first * (1 - strength)) + (average * strength));
          pixels[secondOffset + channel] = Math.round((second * (1 - strength)) + (average * strength));
        }
        pixels[firstOffset + 3] = 255;
        pixels[secondOffset + 3] = 255;
      };

      for (let inset = 0; inset < seamBlendWidth; inset += 1) {
        const strength = 1 - (inset / seamBlendWidth);
        for (let y = 0; y < height; y += 1) {
          blendPair(pixelOffset(inset, y), pixelOffset(width - 1 - inset, y), strength);
        }
      }
      for (let inset = 0; inset < seamBlendWidth; inset += 1) {
        const strength = 1 - (inset / seamBlendWidth);
        for (let x = 0; x < width; x += 1) {
          blendPair(pixelOffset(x, inset), pixelOffset(x, height - 1 - inset), strength);
        }
      }
      context.putImageData(imageData, 0, 0);
    }

    let horizontalTotal = 0;
    let verticalTotal = 0;
    let maxChannelDelta = 0;
    let alphaMin = 255;
    let channelSamples = 0;
    for (let y = 0; y < height; y += 1) {
      const left = pixelOffset(0, y);
      const right = pixelOffset(width - 1, y);
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = Math.abs(pixels[left + channel] - pixels[right + channel]);
        horizontalTotal += delta;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
        channelSamples += 1;
      }
    }
    for (let x = 0; x < width; x += 1) {
      const top = pixelOffset(x, 0);
      const bottom = pixelOffset(x, height - 1);
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = Math.abs(pixels[top + channel] - pixels[bottom + channel]);
        verticalTotal += delta;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
      }
    }
    for (let offset = 3; offset < pixels.length; offset += 4) alphaMin = Math.min(alphaMin, pixels[offset]);

    return {
      sourceWidth,
      sourceHeight,
      outputWidth: width,
      outputHeight: height,
      pngBase64: encode ? canvas.toDataURL('image/png').split(',')[1] : null,
      continuity: {
        maxChannelDelta,
        horizontalMeanChannelDelta: horizontalTotal / channelSamples,
        verticalMeanChannelDelta: verticalTotal / channelSamples,
      },
      alphaMin,
    };
  }, {
    sourceBase64: buffer.toString('base64'),
    outputSize,
    seamBlendWidth,
    encode,
  });
}

async function createPreview(page, runtimeEntries) {
  return page.evaluate(async ({ entries, panelSize, columns }) => {
    const labelHeight = 28;
    const rows = Math.ceil(entries.length / columns);
    const canvas = document.createElement('canvas');
    canvas.width = panelSize * columns;
    canvas.height = (panelSize + labelHeight) * rows;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#101820';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = '15px sans-serif';
    context.textBaseline = 'middle';

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${entry.pngBase64}`)).blob());
      const column = index % columns;
      const row = Math.floor(index / columns);
      const originX = column * panelSize;
      const originY = row * (panelSize + labelHeight);
      const tileSize = panelSize / 4;
      for (let tileY = 0; tileY < 4; tileY += 1) {
        for (let tileX = 0; tileX < 4; tileX += 1) {
          context.drawImage(bitmap, originX + (tileX * tileSize), originY + (tileY * tileSize), tileSize, tileSize);
        }
      }
      bitmap.close();
      context.fillStyle = '#101820';
      context.fillRect(originX, originY + panelSize, panelSize, labelHeight);
      context.fillStyle = '#f4f4e8';
      context.fillText(entry.id, originX + 8, originY + panelSize + (labelHeight / 2));
    }
    return canvas.toDataURL('image/png').split(',')[1];
  }, {
    entries: runtimeEntries,
    panelSize: 256,
    columns: 4,
  });
}

async function assertManifestCoverage(manifest) {
  const expectedPaths = new Set(expectedAssets().map((entry) => webPath(entry.runtime)));
  const manifestPaths = new Set();
  for (const family of Object.values(manifest.families)) {
    manifestPaths.add(family.top);
    manifestPaths.add(family.side);
    manifestPaths.add(family.bottom);
    if (family.sixFaces.positiveX !== family.side
      || family.sixFaces.negativeX !== family.side
      || family.sixFaces.positiveZ !== family.side
      || family.sixFaces.negativeZ !== family.side
      || family.sixFaces.positiveY !== family.top
      || family.sixFaces.negativeY !== family.bottom) {
      throw new Error(`Invalid six-face mapping for ${family.id}.`);
    }
  }
  for (const facadePath of Object.values(manifest.facades)) manifestPaths.add(facadePath);
  const missing = [...expectedPaths].filter((entry) => !manifestPaths.has(entry));
  const unexpected = [...manifestPaths].filter((entry) => !expectedPaths.has(entry));
  if (missing.length || unexpected.length) {
    throw new Error(`Manifest coverage mismatch. Missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}.`);
  }
}

async function run() {
  await mkdir(NORMALIZED_SOURCE_DIR, { recursive: true });
  await mkdir(RUNTIME_DIR, { recursive: true });
  const manifest = createManifest();
  await assertManifestCoverage(manifest);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const reportEntries = [];
  const previewEntries = [];

  try {
    for (const asset of expectedAssets()) {
      const sourcePath = path.join(SOURCE_DIR, asset.source);
      const normalizedSourcePath = path.join(NORMALIZED_SOURCE_DIR, asset.source);
      const runtimePath = path.join(RUNTIME_DIR, asset.runtime);
      const sourceBuffer = await readFile(sourcePath);
      const sourceInspection = await processPng(page, sourceBuffer);
      if (sourceInspection.sourceWidth < SOURCE_SIZE || sourceInspection.sourceHeight < SOURCE_SIZE) {
        throw new Error(`${asset.source} must be at least ${SOURCE_SIZE}px on each axis; received ${sourceInspection.sourceWidth}x${sourceInspection.sourceHeight}.`);
      }

      let normalizedSourceBuffer;
      let normalizedSourceInspection;
      if (CHECK_ONLY) {
        normalizedSourceBuffer = await readFile(normalizedSourcePath);
        normalizedSourceInspection = await processPng(page, normalizedSourceBuffer);
      } else {
        const normalized = await processPng(page, sourceBuffer, {
          outputSize: SOURCE_SIZE,
          encode: true,
        });
        normalizedSourceBuffer = Buffer.from(normalized.pngBase64, 'base64');
        await writeFile(normalizedSourcePath, normalizedSourceBuffer);
        normalizedSourceInspection = await processPng(page, normalizedSourceBuffer);
      }
      if (normalizedSourceInspection.sourceWidth !== SOURCE_SIZE || normalizedSourceInspection.sourceHeight !== SOURCE_SIZE) {
        throw new Error(`${asset.source} normalized source must be ${SOURCE_SIZE}x${SOURCE_SIZE}; received ${normalizedSourceInspection.sourceWidth}x${normalizedSourceInspection.sourceHeight}.`);
      }
      if (CHECK_ONLY) {
        const expectedCanonical = await processPng(page, sourceBuffer, {
          outputSize: SOURCE_SIZE,
          encode: true,
        });
        if (sha256(normalizedSourceBuffer) !== sha256(Buffer.from(expectedCanonical.pngBase64, 'base64'))) {
          throw new Error(`${asset.source} canonical 1024px source is not the deterministic center-crop of its untouched generator artifact.`);
        }
      }

      let runtimeBuffer;
      let runtimeInspection;
      if (CHECK_ONLY) {
        runtimeBuffer = await readFile(runtimePath);
        runtimeInspection = await processPng(page, runtimeBuffer);
      } else {
        const processed = await processPng(page, normalizedSourceBuffer, {
          outputSize: RUNTIME_SIZE,
          seamBlendWidth: SEAM_BLEND_WIDTH,
          encode: true,
        });
        runtimeBuffer = Buffer.from(processed.pngBase64, 'base64');
        await writeFile(runtimePath, runtimeBuffer);
        runtimeInspection = await processPng(page, runtimeBuffer);
      }

      if (runtimeInspection.sourceWidth !== RUNTIME_SIZE || runtimeInspection.sourceHeight !== RUNTIME_SIZE) {
        throw new Error(`${asset.runtime} must be ${RUNTIME_SIZE}x${RUNTIME_SIZE}; received ${runtimeInspection.sourceWidth}x${runtimeInspection.sourceHeight}.`);
      }
      if (runtimeInspection.continuity.maxChannelDelta > 0) {
        throw new Error(`${asset.runtime} has a non-seamless opposite edge (max delta ${runtimeInspection.continuity.maxChannelDelta}).`);
      }
      if (runtimeInspection.alphaMin !== 255) {
        throw new Error(`${asset.runtime} contains transparent pixels (minimum alpha ${runtimeInspection.alphaMin}).`);
      }
      if (CHECK_ONLY) {
        const expectedRuntime = await processPng(page, normalizedSourceBuffer, {
          outputSize: RUNTIME_SIZE,
          seamBlendWidth: SEAM_BLEND_WIDTH,
          encode: true,
        });
        if (sha256(runtimeBuffer) !== sha256(Buffer.from(expectedRuntime.pngBase64, 'base64'))) {
          throw new Error(`${asset.runtime} is not the deterministic runtime derivative of its canonical 1024px source.`);
        }
      }

      reportEntries.push({
        id: asset.id,
        source: asset.source,
        runtime: asset.runtime,
        rawGeneratorArtifactSize: [sourceInspection.sourceWidth, sourceInspection.sourceHeight],
        canonicalSourceSize: [normalizedSourceInspection.sourceWidth, normalizedSourceInspection.sourceHeight],
        runtimeSize: [runtimeInspection.sourceWidth, runtimeInspection.sourceHeight],
        rawGeneratorArtifactSha256: sha256(sourceBuffer),
        canonicalSourceSha256: sha256(normalizedSourceBuffer),
        runtimeSha256: sha256(runtimeBuffer),
        sourceOppositeEdgeContinuity: sourceInspection.continuity,
        runtimeOppositeEdgeContinuity: runtimeInspection.continuity,
      });
      previewEntries.push({ id: asset.id, pngBase64: runtimeBuffer.toString('base64') });
    }

    if (CHECK_ONLY) {
      const storedManifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
      if (JSON.stringify(storedManifest) !== JSON.stringify(manifest)) {
        throw new Error('voxel-face-manifest.json does not match the canonical generated manifest. Rebuild the textures.');
      }
      const previewBuffer = await readFile(PREVIEW_PATH);
      const previewInspection = await processPng(page, previewBuffer);
      if (previewInspection.sourceWidth !== 1024 || previewInspection.sourceHeight !== 1704) {
        throw new Error(`The 4x4 preview must be 1024x1704; received ${previewInspection.sourceWidth}x${previewInspection.sourceHeight}.`);
      }
      const expectedPreviewBuffer = Buffer.from(await createPreview(page, previewEntries), 'base64');
      if (sha256(previewBuffer) !== sha256(expectedPreviewBuffer)) {
        throw new Error('The 4x4 tiling preview is stale. Rebuild it from the current runtime textures.');
      }
    } else {
      await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      const previewBuffer = Buffer.from(await createPreview(page, previewEntries), 'base64');
      await writeFile(PREVIEW_PATH, previewBuffer);
    }

    const validationReport = {
      schemaVersion: 2,
      accepted: true,
      manifestId: manifest.id,
      rawGeneratorArtifactDirectory: path.relative(PROJECT_ROOT, SOURCE_DIR).replaceAll('\\', '/'),
      rawGeneratorArtifactPolicy: 'untouched-native-output',
      rawGeneratorMinimumAxisPixels: SOURCE_SIZE,
      canonicalSourceDirectory: path.relative(PROJECT_ROOT, NORMALIZED_SOURCE_DIR).replaceAll('\\', '/'),
      canonicalSourceSize: SOURCE_SIZE,
      canonicalization: 'center-square-crop-and-high-quality-resample',
      runtimeDerivedFrom: 'canonical-source-1024',
      runtimeSize: RUNTIME_SIZE,
      assetCount: reportEntries.length,
      familyCount: FACE_FAMILIES.length,
      facadeCount: FACADES.length,
      oppositeEdgeMaxChannelDelta: Math.max(...reportEntries.map((entry) => entry.runtimeOppositeEdgeContinuity.maxChannelDelta)),
      rawGeneratorArtifactsPreserved: true,
      canonicalAndRuntimeDerivativesVerified: true,
      entries: reportEntries,
    };
    if (CHECK_ONLY) {
      const storedValidation = JSON.parse(await readFile(VALIDATION_PATH, 'utf8'));
      if (JSON.stringify(storedValidation) !== JSON.stringify(validationReport)) {
        throw new Error('voxel-texture-validation.json does not match raw, canonical, and runtime texture provenance. Rebuild the texture artifacts.');
      }
    } else {
      await writeFile(VALIDATION_PATH, `${JSON.stringify(validationReport, null, 2)}\n`, 'utf8');
    }
    console.log(`${CHECK_ONLY ? 'Validated' : 'Built and validated'} ${reportEntries.length} overworld voxel textures.`);
    console.log(`Families: ${FACE_FAMILIES.length}; facades: ${FACADES.length}; runtime edge max delta: ${validationReport.oppositeEdgeMaxChannelDelta}.`);
    console.log(`Manifest: ${path.relative(PROJECT_ROOT, MANIFEST_PATH)}`);
    console.log(`Preview: ${path.relative(PROJECT_ROOT, PREVIEW_PATH)}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
