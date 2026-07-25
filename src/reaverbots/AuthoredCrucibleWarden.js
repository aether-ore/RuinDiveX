import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = '/assets/models/magma-refinery/boss/crucible-warden.glb';

function collectMaterials(root) {
  const materials = {};
  root.traverse((object) => {
    if (!object.isMesh) return;
    const entries = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of entries) {
      if (material) materials[material.name || `material_${Object.keys(materials).length}`] = material;
    }
  });
  return materials;
}

function firstObject(root, pattern) {
  let result = null;
  root.traverse((object) => {
    if (!result && pattern.test(object.name ?? '')) result = object;
  });
  return result;
}

function matchingObjects(root, pattern) {
  const result = [];
  root.traverse((object) => {
    if (pattern.test(object.name ?? '')) result.push(object);
  });
  return result;
}

function setEmissive(root, intensity) {
  root?.traverse?.((object) => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material?.emissive) material.emissiveIntensity = intensity;
    }
  });
}

function buildVisual(scene, enemy) {
  const root = new THREE.Group();
  root.name = 'authoredCrucibleWardenVisual';
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = Math.max(0.01, (enemy.radius * 4.8) / Math.max(size.x, size.z, 0.01));
  scene.scale.setScalar(scale);
  scene.position.y = -bounds.min.y * scale;
  root.add(scene);
  const nozzle = firstObject(scene, /PerfectedCrucibleNozzle/i) ?? scene;
  const muzzle = firstObject(scene, /anchor_flame_origin/i) ?? nozzle;
  const vents = matchingObjects(scene, /CoolingVent_/i);
  const armor = matchingObjects(scene, /RotatingArmor_/i);
  const materials = collectMaterials(scene);
  const fallbackMaterial = Object.values(materials)[0] ?? new THREE.MeshStandardMaterial({ color: 0x4d3024 });
  root.userData.authoredOwnedMaterials = new Set(Object.values(materials));
  return {
    root,
    frame: { plan: 'authoredCrucibleWarden', body: scene, gait: null },
    eye: { group: vents[0] ?? scene, socket: vents[0] ?? scene, lens: vents[0] ?? scene },
    weapon: { group: nozzle, muzzle, clawDestroyed: false },
    chargeModule: { group: scene, nozzles: [] },
    defense: { group: scene, shutters: [], plates: armor, shell: null },
    weakPoint: { group: vents[0] ?? scene, core: vents[0] ?? scene, socket: vents[0] ?? scene, sharedWithEye: false },
    materials: { ...materials, eye: fallbackMaterial, weapon: fallbackMaterial, emissive: fallbackMaterial, weakPoint: fallbackMaterial },
    authoredModel: scene,
    authoredCoolingVents: vents,
    authoredRotatingArmor: armor,
    authoredNozzle: nozzle,
    forward: new THREE.Vector3(0, 0, 1),
  };
}

export async function loadAuthoredCrucibleWardenVisual(enemy) {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  return buildVisual(gltf.scene, enemy);
}

export function animateAuthoredCrucibleWardenVisual(visual, {
  time = 0,
  dt = 0,
  state = 'position',
  defenseActive = false,
  weakPointExposed = false,
} = {}) {
  const armorSpeed = state === 'attack' || state === 'telegraph' ? 1.8 : 0.55;
  for (const [index, plate] of (visual.authoredRotatingArmor ?? []).entries()) {
    plate.rotation.z += dt * armorSpeed * (index % 2 ? -1 : 1);
    plate.visible = !weakPointExposed || index % 2 === 0;
  }
  for (const vent of visual.authoredCoolingVents ?? []) {
    const pulse = weakPointExposed ? 4.2 + Math.sin(time * 12) * 0.7 : 0.7;
    setEmissive(vent, pulse);
  }
  if (visual.authoredNozzle) {
    setEmissive(visual.authoredNozzle, state === 'attack' ? 3.8 : state === 'telegraph' ? 2.6 : 0.45);
  }
  if (visual.defense?.group) visual.defense.group.userData.rotatingArmorActive = defenseActive;
}
