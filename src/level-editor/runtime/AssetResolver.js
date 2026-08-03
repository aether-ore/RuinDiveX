import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cloneData, normalizeId } from './utils.js';

const TEXTURE_KINDS = new Set(['texture', 'image', 'albedo', 'normal', 'roughness', 'metalness', 'emissive', 'ao']);
const MODEL_KINDS = new Set(['model', 'mesh', 'gltf', 'glb']);

function browserBaseUrl() {
  return typeof document !== 'undefined'
    ? document.baseURI
    : typeof location !== 'undefined' ? location.href : null;
}

function joinUrl(baseUrl, value) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (/^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;
  const base = String(baseUrl ?? '').trim();
  try {
    if (base) return new URL(url, base).toString();
    const browserBase = browserBaseUrl();
    if (browserBase) return new URL(url, browserBase).toString();
  } catch {
    // A root-relative browser URL is already a valid loader input.
  }
  if (!base || url.startsWith('/')) return url;
  return `${base.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
}

function manifestBuckets(manifest, kind) {
  if (!manifest || typeof manifest !== 'object') return [];
  if (TEXTURE_KINDS.has(kind)) {
    return [manifest.textures, manifest.images, manifest.assets, manifest];
  }
  if (MODEL_KINDS.has(kind)) {
    return [manifest.models, manifest.meshes, manifest.assets, manifest];
  }
  return [manifest.assets, manifest];
}

function lookupRecord(manifest, id, kind) {
  for (const bucket of manifestBuckets(manifest, kind)) {
    if (!bucket) continue;
    if (Array.isArray(bucket)) {
      const match = bucket.find((entry) => (
        String(entry?.id ?? entry?.assetId ?? entry?.key ?? '') === id
      ));
      if (match) return match;
    } else if (Object.hasOwn(bucket, id)) {
      return bucket[id];
    }
  }
  return null;
}

function normalizeAssetSpec(spec, kind, manifest) {
  if (typeof Blob !== 'undefined' && spec instanceof Blob) return { id: '', blob: spec, kind };
  if (typeof spec === 'string') {
    const record = lookupRecord(manifest, spec, kind);
    if (typeof record === 'string') return { id: spec, url: record, kind };
    if (typeof Blob !== 'undefined' && record instanceof Blob) return { id: spec, blob: record, kind };
    if (record && typeof record === 'object') return { id: spec, kind, ...record };
    return { id: spec, url: spec, kind };
  }
  if (!spec || typeof spec !== 'object') return { id: '', url: '', kind };
  const id = normalizeId(spec.assetId ?? spec.id ?? spec.key);
  const record = id ? lookupRecord(manifest, id, kind) : null;
  const inherited = typeof record === 'string' ? { url: record } : record ?? {};
  return { id, kind, ...inherited, ...spec };
}

function configureTexture(texture, spec) {
  const repeat = spec.repeat ?? spec.tileRepeat;
  if (repeat != null) {
    const x = Number(Array.isArray(repeat) ? repeat[0] : repeat.x ?? repeat.u ?? repeat) || 1;
    const y = Number(Array.isArray(repeat) ? repeat[1] : repeat.y ?? repeat.v ?? repeat) || 1;
    texture.repeat.set(x, y);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  if (spec.wrap === 'repeat' || spec.wrapS === 'repeat') texture.wrapS = THREE.RepeatWrapping;
  if (spec.wrap === 'repeat' || spec.wrapT === 'repeat') texture.wrapT = THREE.RepeatWrapping;
  if (spec.wrap === 'mirror' || spec.wrapS === 'mirror') texture.wrapS = THREE.MirroredRepeatWrapping;
  if (spec.wrap === 'mirror' || spec.wrapT === 'mirror') texture.wrapT = THREE.MirroredRepeatWrapping;
  const offset = spec.offset ?? spec.uvOffset;
  if (offset != null) {
    texture.offset.set(
      Number(Array.isArray(offset) ? offset[0] : offset.x ?? offset.u ?? 0) || 0,
      Number(Array.isArray(offset) ? offset[1] : offset.y ?? offset.v ?? 0) || 0,
    );
  }
  const center = spec.center ?? spec.rotationCenter;
  if (center != null) {
    texture.center.set(
      Number(Array.isArray(center) ? center[0] : center.x ?? center.u ?? 0.5),
      Number(Array.isArray(center) ? center[1] : center.y ?? center.v ?? 0.5),
    );
  }
  if (Number.isFinite(Number(spec.rotation))) texture.rotation = Number(spec.rotation);
  if (spec.flipY != null) texture.flipY = Boolean(spec.flipY);
  if (spec.colorSpace === 'srgb' || spec.srgb === true) texture.colorSpace = THREE.SRGBColorSpace;
  if (spec.colorSpace === 'linear' || spec.srgb === false) texture.colorSpace = THREE.LinearSRGBColorSpace;
  if (Number.isFinite(Number(spec.anisotropy))) texture.anisotropy = Number(spec.anisotropy);
  texture.needsUpdate = true;
  texture.userData = { ...texture.userData, authoredAssetId: spec.id || null };
  return texture;
}

function cloneModelObject(source, { cloneMaterials = false, cloneGeometry = false, resources = null } = {}) {
  const clone = source.clone(true);
  clone.traverse((object) => {
    if (!object.isMesh && !object.isLine && !object.isPoints) return;
    if (cloneGeometry && object.geometry?.clone) {
      object.geometry = object.geometry.clone();
      resources?.own?.(object.geometry);
    }
    if (cloneMaterials) {
      const cloneMaterial = (material) => {
        const result = material?.clone?.() ?? material;
        if (result !== material) resources?.own?.(result);
        return result;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(cloneMaterial)
        : cloneMaterial(object.material);
    }
  });
  return clone;
}

/**
 * Resolves JSON-safe asset references into Three.js resources. Loaders and
 * resolveUrl are injectable so editor previews, production bundles, and tests
 * can use the same authored documents without embedding browser globals.
 */
export class AssetResolver {
  constructor({
    baseUrl = '',
    manifest = {},
    textureLoader = null,
    modelLoader = null,
    gltfLoader = null,
    resolveUrl = null,
    loadTexture = null,
    loadModel = null,
    cloneModels = true,
  } = {}) {
    this.baseUrl = baseUrl;
    this.manifest = manifest ?? {};
    this.textureLoader = textureLoader ?? new THREE.TextureLoader();
    this.modelLoader = modelLoader ?? gltfLoader ?? new GLTFLoader();
    this.resolveUrlHook = resolveUrl;
    this.loadTextureHook = loadTexture;
    this.loadModelHook = loadModel;
    this.cloneModels = cloneModels;
    this.textureCache = new Map();
    this.modelCache = new Map();
    this.objectUrls = new Set();
    this.blobUrls = new WeakMap();
    this.disposed = false;
  }

  describe(spec, kind = 'asset') {
    return normalizeAssetSpec(spec, String(kind).toLowerCase(), this.manifest);
  }

  resolveUrl(spec, kind = 'asset') {
    const descriptor = this.describe(spec, kind);
    const blob = descriptor.blob ?? descriptor.dataBlob ?? descriptor.file ?? descriptor.data;
    if (typeof Blob !== 'undefined' && blob instanceof Blob) {
      if (this.blobUrls.has(blob)) return this.blobUrls.get(blob);
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const objectUrl = URL.createObjectURL(blob);
        this.blobUrls.set(blob, objectUrl);
        this.objectUrls.add(objectUrl);
        return objectUrl;
      }
      throw new Error('Blob assets require URL.createObjectURL support or an injected loader hook.');
    }
    const rawUrl = descriptor.url ?? descriptor.src ?? descriptor.path ?? descriptor.uri ?? descriptor.id;
    if (this.resolveUrlHook) {
      return this.resolveUrlHook(rawUrl, descriptor, kind);
    }
    return joinUrl(descriptor.baseUrl ?? this.baseUrl, rawUrl);
  }

  async loadTexture(spec, options = {}) {
    if (this.disposed) throw new Error('Cannot load from a disposed AssetResolver.');
    if (spec?.isTexture) return spec;
    const descriptor = { ...this.describe(spec, 'texture'), ...options };
    const url = this.resolveUrl(descriptor, 'texture');
    if (!url) return null;
    const cacheKey = descriptor.cacheKey ?? url;
    if (!this.textureCache.has(cacheKey)) {
      const pending = Promise.resolve(this.loadTextureHook
        ? this.loadTextureHook(url, descriptor, this)
        : this.textureLoader.loadAsync(url))
        .then((texture) => configureTexture(texture, descriptor))
        .catch((error) => {
          this.textureCache.delete(cacheKey);
          throw error;
        });
      this.textureCache.set(cacheKey, pending);
    }
    return this.textureCache.get(cacheKey);
  }

  async loadModel(spec, options = {}) {
    if (this.disposed) throw new Error('Cannot load from a disposed AssetResolver.');
    if (spec?.isObject3D) {
      return this.cloneModels === false || options.clone === false
        ? spec
        : cloneModelObject(spec, options);
    }
    const descriptor = { ...this.describe(spec, 'model'), ...options };
    const url = this.resolveUrl(descriptor, 'model');
    if (!url) return null;
    const cacheKey = descriptor.cacheKey ?? url;
    if (!this.modelCache.has(cacheKey)) {
      const pending = Promise.resolve(this.loadModelHook
        ? this.loadModelHook(url, descriptor, this)
        : this.modelLoader.loadAsync(url))
        .then((result) => result?.scene ?? result?.object ?? result)
        .then((object) => {
          if (!object?.isObject3D) throw new TypeError(`Model ${url} did not resolve to a THREE.Object3D.`);
          object.userData = {
            ...object.userData,
            authoredAsset: cloneData({ id: descriptor.id, url }),
          };
          return object;
        })
        .catch((error) => {
          this.modelCache.delete(cacheKey);
          throw error;
        });
      this.modelCache.set(cacheKey, pending);
    }
    const source = await this.modelCache.get(cacheKey);
    if (this.cloneModels === false || descriptor.clone === false) return source;
    return cloneModelObject(source, descriptor);
  }

  async resolve(spec, kind = null, options = {}) {
    const normalizedKind = String(kind ?? spec?.kind ?? spec?.type ?? '').toLowerCase();
    if (TEXTURE_KINDS.has(normalizedKind)) return this.loadTexture(spec, options);
    if (MODEL_KINDS.has(normalizedKind)) return this.loadModel(spec, options);
    const descriptor = this.describe(spec, normalizedKind || 'asset');
    return { ...descriptor, url: this.resolveUrl(descriptor, normalizedKind || 'asset') };
  }

  getTexture(spec, options = {}) {
    return this.loadTexture(spec, options);
  }

  getModel(spec, options = {}) {
    return this.loadModel(spec, options);
  }

  clear({ dispose = true } = {}) {
    if (dispose) {
      for (const pending of this.textureCache.values()) {
        Promise.resolve(pending).then((texture) => texture?.dispose?.()).catch(() => {});
      }
      for (const pending of this.modelCache.values()) {
        Promise.resolve(pending).then((model) => {
          model?.traverse?.((object) => {
            object.geometry?.dispose?.();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            for (const material of materials) material?.dispose?.();
          });
        }).catch(() => {});
      }
    }
    this.textureCache.clear();
    this.modelCache.clear();
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const objectUrl of this.objectUrls) URL.revokeObjectURL(objectUrl);
    }
    this.objectUrls.clear();
    this.blobUrls = new WeakMap();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear({ dispose: true });
  }
}

export function createAssetResolver(options = {}) {
  return options instanceof AssetResolver ? options : new AssetResolver(options);
}

export { normalizeAssetSpec };
