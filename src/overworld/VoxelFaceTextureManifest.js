export const VOXEL_TEXTURE_BASE_PATH = '/assets/textures/overworld/voxel';

export const VOXEL_FACE_FAMILY_IDS = Object.freeze([
  'meadow',
  'trail',
  'stone',
  'bark',
  'leaves',
  'houseWall',
  'roof',
]);

const FILE_STEMS = Object.freeze({
  meadow: 'meadow-grass',
  trail: 'worn-trail-earth',
  stone: 'exposed-hill-stone',
  bark: 'tree-bark',
  leaves: 'leaf-canopy',
  houseWall: 'weathered-house-wall',
  roof: 'weathered-shingle-roof',
});

function freezeManifest(manifest) {
  for (const faceSet of Object.values(manifest.families)) {
    Object.freeze(faceSet.sixFaces);
    Object.freeze(faceSet);
  }
  Object.freeze(manifest.families);
  Object.freeze(manifest.facades);
  Object.freeze(manifest.sourceArt);
  Object.freeze(manifest.runtime);
  Object.freeze(manifest.boxMaterialOrder);
  return Object.freeze(manifest);
}

export function createVoxelFaceTextureManifest({ basePath = VOXEL_TEXTURE_BASE_PATH } = {}) {
  const cleanBasePath = String(basePath).replace(/\/$/, '');
  const families = {};
  for (const familyId of VOXEL_FACE_FAMILY_IDS) {
    const stem = FILE_STEMS[familyId];
    const top = `${cleanBasePath}/${stem}-top.png`;
    const side = `${cleanBasePath}/${stem}-side.png`;
    const bottom = `${cleanBasePath}/${stem}-bottom.png`;
    families[familyId] = {
      id: familyId,
      top,
      side,
      bottom,
      sixFaces: {
        positiveX: side,
        negativeX: side,
        positiveY: top,
        negativeY: bottom,
        positiveZ: side,
        negativeZ: side,
      },
    };
  }

  return freezeManifest({
    id: 'ruindivex-overworld-voxel-faces-v1',
    revision: 2,
    sourceArt: {
      rawGeneratorArtifactDirectory: 'assets/art-source/overworld/voxel',
      rawGeneratorArtifactPolicy: 'untouched-native-output',
      rawGeneratorMinimumAxisPixels: 1024,
      canonicalSourceDirectory: 'assets/art-source/overworld/voxel/source-1024',
      canonicalSourceSize: 1024,
      canonicalization: 'center-square-crop-and-high-quality-resample',
      runtimeDerivedFrom: 'canonical-source-1024',
      provenanceValidation: 'assets/textures/overworld/voxel/voxel-texture-validation.json',
    },
    runtimeSize: 256,
    boxMaterialOrder: [
      'positiveX',
      'negativeX',
      'positiveY',
      'negativeY',
      'positiveZ',
      'negativeZ',
    ],
    families,
    facades: {
      woodenDoor: `${cleanBasePath}/wooden-door-facade.png`,
      mullionedWindow: `${cleanBasePath}/mullioned-window-facade.png`,
    },
    runtime: {
      colorSpace: 'srgb',
      wrapS: 'repeat',
      wrapT: 'repeat',
      generateMipmaps: true,
      anisotropicFiltering: true,
      repeatWorldMetres: 1.5,
    },
  });
}

export function toSixFaceTexturePaths(faceSet) {
  if (!faceSet) return null;
  // Three.js BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z.
  const sixFaces = faceSet.sixFaces ?? {
    positiveX: faceSet.side,
    negativeX: faceSet.side,
    positiveY: faceSet.top,
    negativeY: faceSet.bottom,
    positiveZ: faceSet.side,
    negativeZ: faceSet.side,
  };
  return Object.freeze([
    sixFaces.positiveX,
    sixFaces.negativeX,
    sixFaces.positiveY,
    sixFaces.negativeY,
    sixFaces.positiveZ,
    sixFaces.negativeZ,
  ]);
}

export function validateVoxelFaceTextureManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') errors.push('manifest-required');
  if (manifest?.runtimeSize !== 256) errors.push('runtime-textures-must-be-256px');
  const sourceArt = manifest?.sourceArt;
  if (sourceArt?.rawGeneratorArtifactPolicy !== 'untouched-native-output') {
    errors.push('raw-generator-artifacts-must-remain-untouched');
  }
  if (sourceArt?.rawGeneratorMinimumAxisPixels !== 1024) {
    errors.push('raw-generator-artifacts-must-be-at-least-1024px');
  }
  if (sourceArt?.canonicalSourceSize !== 1024) errors.push('canonical-source-textures-must-be-1024px');
  if (sourceArt?.canonicalization !== 'center-square-crop-and-high-quality-resample') {
    errors.push('invalid-canonical-source-transform');
  }
  if (sourceArt?.runtimeDerivedFrom !== 'canonical-source-1024') {
    errors.push('runtime-must-derive-from-canonical-source');
  }
  for (const path of [
    sourceArt?.rawGeneratorArtifactDirectory,
    sourceArt?.canonicalSourceDirectory,
    sourceArt?.provenanceValidation,
  ]) {
    if (typeof path !== 'string' || path.length === 0) errors.push('source-provenance-path-required');
  }
  for (const familyId of VOXEL_FACE_FAMILY_IDS) {
    const family = manifest?.families?.[familyId];
    if (!family) {
      errors.push(`missing-family:${familyId}`);
      continue;
    }
    for (const face of ['top', 'side', 'bottom']) {
      if (typeof family[face] !== 'string' || !family[face].endsWith('.png')) {
        errors.push(`missing-face:${familyId}:${face}`);
      }
    }
    if (['top', 'side', 'bottom'].every((face) => typeof family[face] === 'string')) {
      const expected = [
        family.side,
        family.side,
        family.top,
        family.bottom,
        family.side,
        family.side,
      ];
      const actual = toSixFaceTexturePaths(family);
      if (actual.some((path, index) => path !== expected[index])) {
        errors.push(`invalid-six-face-mapping:${familyId}`);
      }
    }
  }
  for (const facade of ['woodenDoor', 'mullionedWindow']) {
    if (typeof manifest?.facades?.[facade] !== 'string') errors.push(`missing-facade:${facade}`);
  }
  if (manifest?.runtime?.colorSpace !== 'srgb') errors.push('runtime-color-space-must-be-srgb');
  if (manifest?.runtime?.wrapS !== 'repeat' || manifest?.runtime?.wrapT !== 'repeat') {
    errors.push('runtime-wrapping-must-repeat');
  }
  if (manifest?.runtime?.generateMipmaps !== true) errors.push('runtime-mipmaps-required');
  if (manifest?.runtime?.anisotropicFiltering !== true) errors.push('runtime-anisotropic-filtering-required');
  if (manifest?.runtime?.repeatWorldMetres !== 1.5) errors.push('invalid-world-texel-density');
  return Object.freeze({
    accepted: errors.length === 0,
    errors: Object.freeze(errors),
    familyCount: Object.keys(manifest?.families ?? {}).length,
  });
}

export const DEFAULT_VOXEL_FACE_TEXTURE_MANIFEST = createVoxelFaceTextureManifest();
