import * as THREE from 'three';
import { REAVERBOT_TEXTURE_ASSETS } from './ReaverbotTextureCatalog.js';

const textureCache = new Map();
const canLoadBrowserImages = typeof document !== 'undefined' && typeof Image !== 'undefined';
const textureLoader = canLoadBrowserImages ? new THREE.TextureLoader() : null;

const WRAP_MODES = Object.freeze({
  repeat: THREE.RepeatWrapping,
  mirroredRepeat: THREE.MirroredRepeatWrapping,
  clampToEdge: THREE.ClampToEdgeWrapping,
});

const MIN_FILTERS = Object.freeze({
  nearest: THREE.NearestFilter,
  nearestMipmapNearest: THREE.NearestMipmapNearestFilter,
  nearestMipmapLinear: THREE.NearestMipmapLinearFilter,
  linear: THREE.LinearFilter,
  linearMipmapNearest: THREE.LinearMipmapNearestFilter,
  linearMipmapLinear: THREE.LinearMipmapLinearFilter,
});

const MAG_FILTERS = Object.freeze({
  nearest: THREE.NearestFilter,
  linear: THREE.LinearFilter,
});

function requireTextureAsset(assetKey) {
  const asset = REAVERBOT_TEXTURE_ASSETS[assetKey];
  if (!asset) {
    throw new Error(`Unknown Reaverbot texture asset: ${String(assetKey)}`);
  }
  return asset;
}

function configureTexture(texture, asset, loadState, fallbackUsed = false) {
  texture.name = `texture_generatedReaverbot_${asset.id}`;
  texture.colorSpace = asset.colorSpace === 'srgb'
    ? THREE.SRGBColorSpace
    : THREE.NoColorSpace;
  texture.wrapS = WRAP_MODES[asset.wrapS] ?? THREE.ClampToEdgeWrapping;
  texture.wrapT = WRAP_MODES[asset.wrapT] ?? THREE.ClampToEdgeWrapping;
  texture.minFilter = MIN_FILTERS[asset.minFilter] ?? THREE.NearestMipmapNearestFilter;
  texture.magFilter = MAG_FILTERS[asset.magFilter] ?? THREE.NearestFilter;
  texture.repeat.set(asset.repeat[0], asset.repeat[1]);
  texture.anisotropy = asset.anisotropy;
  texture.generateMipmaps = asset.generateMipmaps;
  texture.userData.reaverbotTexture = {
    assetKey: asset.id,
    assetPath: asset.path,
    assetType: asset.type,
    loadState,
    fallbackUsed,
    shared: true,
  };
  return texture;
}

function createNodePlaceholder(asset) {
  const data = new Uint8Array([255, 255, 255, 255]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  configureTexture(texture, asset, 'placeholder', true);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Return one shared texture instance per generated asset. Browser callers load
 * the authored PNG; deterministic Node visual tests receive an annotated white
 * DataTexture so visual construction remains DOM-independent.
 */
export function getReaverbotTexture(assetKey) {
  const asset = requireTextureAsset(assetKey);
  const cached = textureCache.get(assetKey);
  if (cached) return cached;

  if (!textureLoader) {
    const placeholder = createNodePlaceholder(asset);
    textureCache.set(assetKey, placeholder);
    return placeholder;
  }

  const texture = textureLoader.load(
    asset.path,
    () => {
      texture.userData.reaverbotTexture.loadState = 'loaded';
      texture.userData.reaverbotTexture.naturalWidth = texture.image?.naturalWidth
        ?? texture.image?.width
        ?? 0;
      texture.userData.reaverbotTexture.naturalHeight = texture.image?.naturalHeight
        ?? texture.image?.height
        ?? 0;
    },
    undefined,
    (error) => {
      texture.userData.reaverbotTexture.loadState = 'error';
      texture.userData.reaverbotTexture.error = String(error?.message ?? error ?? 'texture-load-failed');
    },
  );
  configureTexture(texture, asset, 'loading', false);
  textureCache.set(assetKey, texture);
  return texture;
}

export function getReaverbotTextureDiagnostics() {
  return Object.fromEntries([...textureCache.entries()].map(([assetKey, texture]) => [
    assetKey,
    {
      ...texture.userData.reaverbotTexture,
      imageWidth: texture.image?.naturalWidth ?? texture.image?.width ?? 0,
      imageHeight: texture.image?.naturalHeight ?? texture.image?.height ?? 0,
    },
  ]));
}

export function getReaverbotTextureAsset(assetKey) {
  return requireTextureAsset(assetKey);
}
