import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const ASSET_ROOT = './assets/models/props/rotating-trap/';
const MODEL_FILE = 'Rotating_Trap.obj';
const TEXTURE_FILE = 'Rotating_Trap.png';
const TARGET_ROTOR_DIAMETER_METERS = 2.2;
const AUTHORED_ROTOR_CENTER_Y = 0.975000381469725;

function disposeMaterial(material) {
  if (Array.isArray(material)) {
    for (const entry of material) entry?.dispose?.();
    return;
  }
  material?.dispose?.();
}

function disposeTemplate(root, material, texture) {
  const geometries = new Set();
  root?.traverse?.((object) => {
    if (object.isMesh && object.geometry) geometries.add(object.geometry);
  });
  for (const geometry of geometries) geometry.dispose?.();
  material?.dispose?.();
  texture?.dispose?.();
}

function disposeUnpreparedSource(root) {
  const geometries = new Set();
  const materials = new Set();
  root?.traverse?.((object) => {
    if (!object.isMesh) return;
    if (object.geometry) geometries.add(object.geometry);
    if (Array.isArray(object.material)) {
      for (const material of object.material) {
        if (material) materials.add(material);
      }
    } else if (object.material) {
      materials.add(object.material);
    }
  });
  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) material.dispose?.();
}

export function createRotatingTrapMaterial(texture) {
  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapNearestFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }
  return new THREE.MeshStandardMaterial({
    name: 'Rotating ceiling-track trap material',
    color: 0xffffff,
    map: texture ?? null,
    alphaTest: 0.5,
    transparent: false,
    roughness: 0.56,
    metalness: 0.24,
    side: THREE.FrontSide,
  });
}

/**
 * Normalizes the supplied Cinema 4D OBJ around a ceiling-mount origin. Its X/Z
 * extent is the rotating head diameter; source maximum Y is pinned to y=0 so
 * connector tracks can place the mount directly against their carrier rail.
 */
export function prepareRotatingTrapTemplate(source, texture, {
  targetRotorDiameterMeters = TARGET_ROTOR_DIAMETER_METERS,
} = {}) {
  if (!source?.isObject3D) throw new Error('rotating-trap-source-must-be-an-object3d');
  source.updateMatrixWorld(true);
  const sourceBounds = new THREE.Box3().setFromObject(source);
  if (sourceBounds.isEmpty()) throw new Error('rotating-trap-source-has-no-geometry');
  const sourceSize = sourceBounds.getSize(new THREE.Vector3());
  const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
  const sourceRotorDiameter = Math.max(sourceSize.x, sourceSize.z);
  if (sourceRotorDiameter <= 0.000001) {
    throw new Error('rotating-trap-source-has-zero-rotor-diameter');
  }
  const scale = targetRotorDiameterMeters / sourceRotorDiameter;
  const contactOffsetMeters = Object.freeze({
    x: 0,
    y: (AUTHORED_ROTOR_CENTER_Y - sourceBounds.max.y) * scale,
    z: 0,
  });
  const material = createRotatingTrapMaterial(texture);

  source.traverse((object) => {
    if (!object.isMesh) return;
    const previousMaterial = object.material;
    object.material = material;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = true;
    if (previousMaterial !== material) disposeMaterial(previousMaterial);
  });
  source.scale.setScalar(scale);
  source.position.set(
    -sourceCenter.x * scale,
    -sourceBounds.max.y * scale,
    -sourceCenter.z * scale,
  );
  source.updateMatrixWorld(true);

  const rotor = new THREE.Group();
  rotor.name = 'rotatingCeilingTrackTrapTemplateRotor';
  rotor.add(source);
  rotor.userData.rotatingTrapAsset = 'Rotating_Trap.obj';
  rotor.userData.rotorDiameterMeters = targetRotorDiameterMeters;
  rotor.userData.sourceBounds = Object.freeze({
    min: Object.freeze(sourceBounds.min.toArray()),
    max: Object.freeze(sourceBounds.max.toArray()),
  });
  rotor.userData.normalizationScale = scale;
  rotor.userData.sourceRotorDiameter = sourceRotorDiameter;
  rotor.userData.normalizedHeightMeters = sourceSize.y * scale;
  rotor.userData.ceilingMountY = 0;
  rotor.userData.contactOffsetMeters = contactOffsetMeters;
  return { rotor, material, texture };
}

export class DungeonConnectorTrapVisualFactory {
  constructor({
    assetRoot = ASSET_ROOT,
    modelFile = MODEL_FILE,
    textureFile = TEXTURE_FILE,
    objLoader = null,
    textureLoader = null,
  } = {}) {
    this.assetRoot = assetRoot;
    this.modelFile = modelFile;
    this.textureFile = textureFile;
    this.objLoader = objLoader ?? new OBJLoader();
    this.textureLoader = textureLoader ?? new THREE.TextureLoader();
    this.templatePromise = null;
    this.template = null;
    this.instances = new Set();
    this.loadCount = 0;
    this.instanceCount = 0;
    this.releasedCount = 0;
    this.loadError = null;
    this.disposed = false;
    this.resourcesDisposed = false;
  }

  _loadTemplate() {
    if (this.disposed) return Promise.reject(new Error('rotating-trap-visual-factory-disposed'));
    if (!this.templatePromise) {
      this.loadCount += 1;
      const modelUrl = `${this.assetRoot}${this.modelFile}`;
      const textureUrl = `${this.assetRoot}${this.textureFile}`;
      // Wait for both loaders so an asymmetric failure cannot strand the
      // successful peer resource after Promise.all rejects early.
      this.templatePromise = Promise.allSettled([
        this.objLoader.loadAsync(modelUrl),
        this.textureLoader.loadAsync(textureUrl),
      ])
        .then(([modelResult, textureResult]) => {
          const source = modelResult.status === 'fulfilled' ? modelResult.value : null;
          const texture = textureResult.status === 'fulfilled' ? textureResult.value : null;
          if (modelResult.status === 'rejected' || textureResult.status === 'rejected') {
            if (source) disposeUnpreparedSource(source);
            texture?.dispose?.();
            this.resourcesDisposed = Boolean(source || texture);
            const failures = [];
            if (modelResult.status === 'rejected') {
              failures.push(`obj:${modelResult.reason?.message ?? modelResult.reason}`);
            }
            if (textureResult.status === 'rejected') {
              failures.push(`png:${textureResult.reason?.message ?? textureResult.reason}`);
            }
            throw new Error(`rotating-trap-asset-load-failed:${failures.join(',')}`);
          }

          let prepared;
          try {
            prepared = prepareRotatingTrapTemplate(source, texture);
          } catch (error) {
            disposeUnpreparedSource(source);
            texture?.dispose?.();
            this.resourcesDisposed = true;
            throw error;
          }
          this.template = prepared;
          if (this.disposed) {
            this._disposeResources();
            throw new Error('rotating-trap-visual-factory-disposed-during-load');
          }
          return prepared;
        })
        .catch((error) => {
          this.loadError = String(error?.message ?? error);
          throw error;
        });
    }
    return this.templatePromise;
  }

  async createInstance(descriptor = {}) {
    if (this.disposed) throw new Error('rotating-trap-visual-factory-disposed');
    const template = await this._loadTemplate();
    if (this.disposed) throw new Error('rotating-trap-visual-factory-disposed');
    const instance = new THREE.Group();
    instance.name = `${String(descriptor.id ?? 'connector-track-trap')}:visual`;
    const rotor = template.rotor.clone(true);
    rotor.name = `${String(descriptor.id ?? 'connector-track-trap')}:rotor`;
    instance.add(rotor);
    instance.userData.rotatingTrapRotor = rotor;
    instance.userData.rotatingTrapId = String(descriptor.id ?? 'connector-track-trap');
    instance.userData.rotatingTrapAsset = MODEL_FILE;
    instance.userData.rotorDiameterMeters = TARGET_ROTOR_DIAMETER_METERS;
    instance.userData.contactOffsetMeters = template.rotor.userData.contactOffsetMeters;
    if (Number.isFinite(Number(descriptor.mountYawRadians))) {
      instance.rotation.y = Number(descriptor.mountYawRadians);
    }
    this.instances.add(instance);
    this.instanceCount += 1;
    return instance;
  }

  releaseInstance(instance) {
    if (!instance) return false;
    instance.parent?.remove?.(instance);
    const removed = this.instances.delete(instance);
    if (removed) this.releasedCount += 1;
    return removed;
  }

  _disposeResources() {
    if (this.resourcesDisposed || !this.template) return false;
    disposeTemplate(this.template.rotor, this.template.material, this.template.texture);
    this.resourcesDisposed = true;
    return true;
  }

  getDiagnostics() {
    return Object.freeze({
      assetRoot: this.assetRoot,
      modelFile: this.modelFile,
      textureFile: this.textureFile,
      loadCount: this.loadCount,
      instanceCount: this.instanceCount,
      activeInstanceCount: this.instances.size,
      releasedCount: this.releasedCount,
      loaded: Boolean(this.template),
      loadError: this.loadError,
      disposed: this.disposed,
      resourcesDisposed: this.resourcesDisposed,
    });
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    for (const instance of [...this.instances]) this.releaseInstance(instance);
    if (!this._disposeResources() && this.templatePromise) {
      this.templatePromise.then(() => this._disposeResources()).catch(() => {});
    }
    return true;
  }
}

export const ROTATING_CEILING_TRACK_TRAP_ASSET = Object.freeze({
  assetRoot: ASSET_ROOT,
  runtimeModel: MODEL_FILE,
  runtimeTexture: TEXTURE_FILE,
  sourceModel: 'Rotating_Trap.dae',
  sourceMaterial: 'Rotating_Trap.mtl',
  targetRotorDiameterMeters: TARGET_ROTOR_DIAMETER_METERS,
  contactOffsetMeters: Object.freeze({ x: 0, y: -6.165572557081793, z: 0 }),
});
