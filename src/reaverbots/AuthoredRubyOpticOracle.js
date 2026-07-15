import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = './assets/models/reaverbots/bosses/ruby-optic-oracle/ruby_optic_oracle.glb';
const AUTHORED_BODY_CAPSULE_HEIGHT = 3.85;
const MAIN_EYE = new THREE.Vector3(0, 3.78, -2.18);
const LEFT_PRISM = new THREE.Vector3(-3.5, 3.48, -2.35);
const REAR_WEAK_POINT = new THREE.Vector3(0, 3.74, 2.03);

const normalizedName = (object) => String(object?.name ?? '').toLowerCase();

function findNamed(root, predicate) {
  let match = null;
  root.traverse((object) => {
    if (!match && predicate(normalizedName(object), object)) match = object;
  });
  return match;
}

function findAllNamed(root, predicate) {
  const matches = [];
  root.traverse((object) => {
    if (predicate(normalizedName(object), object)) matches.push(object);
  });
  return matches;
}

function addAnchor(parent, name, position) {
  const anchor = new THREE.Object3D();
  anchor.name = name;
  anchor.position.copy(position);
  parent.add(anchor);
  return anchor;
}

function firstMaterial(object, fallback) {
  const material = Array.isArray(object?.material) ? object.material[0] : object?.material;
  return material ?? fallback;
}

function setEmissiveIntensity(object, intensity) {
  object?.traverse?.((child) => {
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material?.emissive) material.emissiveIntensity = intensity;
    }
  });
}

function buildVisual(scene, enemy) {
  const root = new THREE.Group();
  root.name = 'authoredRubyOpticOracleVisual';
  root.userData.authoredRubyOpticOracle = true;
  scene.name = 'authoredRubyOpticOracleModel';
  scene.rotation.y = Math.PI;
  scene.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  root.add(scene);
  root.scale.setScalar(Math.max(0.1, enemy.collisionHeight / AUTHORED_BODY_CAPSULE_HEIGHT));

  const eyeGroup = findNamed(scene, (name) => name === 'oracle_main_ruby_eye')
    ?? findNamed(scene, (name) => name.includes('ruby_eye'))
    ?? addAnchor(scene, 'oracle_main_ruby_eye_fallback', MAIN_EYE);
  const eyeSocket = findNamed(scene, (name) => name.includes('iris_ring')) ?? eyeGroup;
  const weakPointCore = findNamed(scene, (name) => name.includes('rear_oracle_weakpoint'))
    ?? addAnchor(scene, 'rear_oracle_weakpoint_fallback', REAR_WEAK_POINT);
  const weakPointSocket = weakPointCore.parent ?? scene;
  const weaponGroup = findNamed(scene, (name) => name === 'left_beam_prism')
    ?? findNamed(scene, (name) => name.includes('beam_prism'))
    ?? addAnchor(scene, 'left_beam_prism_fallback', LEFT_PRISM);
  const muzzle = addAnchor(scene, 'authoredRubyOpticOracleMuzzle', LEFT_PRISM);
  const defenseGroup = new THREE.Group();
  defenseGroup.name = 'authoredRubyOpticOracleShutterController';
  scene.add(defenseGroup);
  // Blender exports each shutter pivot plus similarly prefixed mesh children.
  // Animate only the eight authored pivot nodes, not their nested geometry.
  const shutters = findAllNamed(scene, (name) => /^eye_shutter_\d{2}$/.test(name));
  shutters.forEach((shutter, index) => {
    shutter.userData.authoredBaseRotationZ = shutter.rotation.z;
    shutter.userData.authoredShutterSign = index < 4 ? -1 : 1;
  });

  const fallbackMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });
  fallbackMaterial.name = 'material_authoredRubyOpticOracleFallback';
  const allMaterials = {};
  scene.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material) allMaterials[material.name || `material_${Object.keys(allMaterials).length}`] = material;
    }
  });
  const eyeMaterial = firstMaterial(eyeGroup, fallbackMaterial);
  const weakPointMaterial = firstMaterial(weakPointCore, fallbackMaterial);
  const weaponMaterial = firstMaterial(weaponGroup, fallbackMaterial);

  return {
    root,
    frame: { plan: 'authoredRubyOpticOracle', body: scene, gait: null },
    eye: { group: eyeGroup, socket: eyeSocket, lens: eyeGroup },
    weapon: { group: weaponGroup, muzzle, clawDestroyed: false },
    chargeModule: { group: scene, nozzles: [] },
    defense: { group: defenseGroup, shutters, plates: [], shell: null },
    weakPoint: { group: weakPointCore, core: weakPointCore, socket: weakPointSocket, sharedWithEye: false },
    materials: { ...allMaterials, eye: eyeMaterial, weapon: weaponMaterial, emissive: eyeMaterial, weakPoint: weakPointMaterial },
    authoredModel: scene,
    authoredShutters: shutters,
    authoredEye: eyeGroup,
    authoredWeakPoint: weakPointCore,
    authoredOracleArray: findAllNamed(scene, (name) => name.includes('right_oracle_array')),
    forward: new THREE.Vector3(0, 0, 1),
  };
}

export async function loadAuthoredRubyOpticOracleVisual(enemy) {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  return buildVisual(gltf.scene, enemy);
}

export function animateAuthoredRubyOpticOracleVisual(visual, {
  time = 0, dt = 0, moving = false, speedRatio = 0, state = 'position',
  defenseActive = false, weakPointExposed = false,
} = {}) {
  const alpha = Math.min(1, dt * 10);
  const shutterClosure = defenseActive ? 0.82 : 0;
  for (const shutter of visual.authoredShutters ?? []) {
    const target = shutter.userData.authoredBaseRotationZ
      + shutter.userData.authoredShutterSign * shutterClosure;
    shutter.rotation.z = THREE.MathUtils.lerp(shutter.rotation.z, target, alpha);
  }
  const telegraphing = state === 'telegraph';
  setEmissiveIntensity(visual.authoredEye, telegraphing ? 3.2 : 1.8 + Math.sin(time * 4) * 0.25);
  setEmissiveIntensity(visual.authoredWeakPoint, weakPointExposed ? 2.8 : 0.35);
  for (const lens of visual.authoredOracleArray ?? []) {
    lens.rotation.z += dt * (telegraphing ? 3.2 : 0.7);
    setEmissiveIntensity(lens, telegraphing ? 2.2 : 0.8);
  }
  visual.authoredModel.position.y = THREE.MathUtils.lerp(
    visual.authoredModel.position.y,
    moving ? Math.sin(time * 7) * 0.035 * Math.max(0.25, speedRatio) : 0,
    alpha,
  );
}

export function disposeVisualTree(root) {
  const geometries = new Set();
  const materials = new Set();
  root?.traverse?.((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) if (material) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose?.());
  materials.forEach((material) => material.dispose?.());
  root?.removeFromParent?.();
}
