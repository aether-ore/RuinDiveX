import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = './assets/models/reaverbots/bosses/ruby-optic-oracle/ruby_optic_oracle.glb';
const AUTHORED_BODY_CAPSULE_HEIGHT = 3.85;
const MAIN_EYE = new THREE.Vector3(0, 3.78, -2.18);
const LEFT_PRISM = new THREE.Vector3(-3.5, 3.48, -2.35);
const REAR_WEAK_POINT = new THREE.Vector3(0, 3.74, 2.03);
const ORIGIN = new THREE.Vector3();
const tempBounds = new THREE.Box3();
const tempCenter = new THREE.Vector3();
const tempScale = new THREE.Vector3();
const tempFoldQuaternion = new THREE.Quaternion();
const tempTargetQuaternion = new THREE.Quaternion();

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
  let match = null;
  object?.traverse?.((child) => {
    if (match || !child.material) return;
    match = Array.isArray(child.material) ? child.material[0] : child.material;
  });
  return match ?? fallback;
}

function setEmissiveIntensity(object, intensity) {
  object?.traverse?.((child) => {
    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        if (material?.emissive) material.emissiveIntensity = intensity;
      }
    } else if (child.material?.emissive) {
      child.material.emissiveIntensity = intensity;
    }
  });
}

function createPositionedPivot(scene, name, parts, localPosition = null) {
  const objects = parts.filter(Boolean);
  const pivot = new THREE.Group();
  pivot.name = name;
  if (localPosition) {
    pivot.position.copy(localPosition);
  } else if (objects.length > 0) {
    scene.updateMatrixWorld(true);
    tempBounds.makeEmpty();
    for (const object of objects) tempBounds.expandByObject(object);
    if (!tempBounds.isEmpty()) {
      tempBounds.getCenter(tempCenter);
      scene.worldToLocal(tempCenter);
      pivot.position.copy(tempCenter);
    }
  }
  scene.add(pivot);
  scene.updateMatrixWorld(true);
  for (const object of objects) pivot.attach(object);
  return pivot;
}

function cloneScopedMaterials(root, suffix) {
  const clones = new Map();
  const cloneMaterial = (material) => {
    if (!material) return material;
    if (clones.has(material)) return clones.get(material);
    const clone = material.clone();
    clone.name = `${material.name || 'material'}_${suffix}`;
    clones.set(material, clone);
    return clone;
  };
  root?.traverse?.((object) => {
    if (!object.material) return;
    if (Array.isArray(object.material)) {
      object.material = object.material.map(cloneMaterial);
    } else {
      object.material = cloneMaterial(object.material);
    }
  });
  return new Set(clones.values());
}

function collectOwnedTextures(root) {
  const textures = new Set();
  root?.traverse?.((object) => {
    const visitMaterial = (material) => {
      if (!material) return;
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    };
    if (Array.isArray(object.material)) {
      for (const material of object.material) visitMaterial(material);
    } else {
      visitMaterial(object.material);
    }
  });
  return textures;
}

function buildLegFoldPivots(scene) {
  const layouts = [
    ['fl', new THREE.Euler(-0.72, 0, -0.55)],
    ['fr', new THREE.Euler(-0.72, 0, 0.55)],
    ['bl', new THREE.Euler(0.72, 0, -0.55)],
    ['br', new THREE.Euler(0.72, 0, 0.55)],
  ];
  const legSets = layouts.map(([prefix, foldEuler]) => ({
    prefix,
    foldEuler,
    hip: findNamed(scene, (name) => name === `leg_${prefix}_hip_joint`),
    parts: findAllNamed(scene, (name) => name.startsWith(`leg_${prefix}_`)),
  }));
  const pivots = [];
  scene.updateMatrixWorld(true);
  for (const entry of legSets) {
    if (!entry.hip || entry.parts.length === 0) continue;
    const worldCenter = new THREE.Box3().setFromObject(entry.hip).getCenter(new THREE.Vector3());
    const localCenter = scene.worldToLocal(worldCenter.clone());
    const pivot = new THREE.Group();
    pivot.name = `authoredRubyLegFoldPivot_${entry.prefix.toUpperCase()}`;
    pivot.position.copy(localCenter);
    scene.add(pivot);
    scene.updateMatrixWorld(true);
    for (const part of entry.parts) pivot.attach(part);
    pivot.userData.authoredBaseQuaternion = pivot.quaternion.clone();
    pivot.userData.authoredFoldQuaternion = new THREE.Quaternion().setFromEuler(entry.foldEuler);
    pivots.push(pivot);
  }
  return pivots;
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

  // This authored GLB has placement baked into vertex positions. Its mesh
  // nodes are identity-transform siblings, so their native Object3D origins
  // all sit at model zero. Reconstruct the pivots before animation or combat
  // code samples getWorldPosition(), preserving appearance via attach().
  const eyeRenderParts = findAllNamed(scene, (name) => (
    name === 'oracle_main_ruby_eye' || name === 'oracle_main_eye_highlight'
  ));
  const weakPointRenderParts = findAllNamed(scene, (name) => name === 'rear_oracle_weakpoint');
  const weaponRenderParts = findAllNamed(scene, (name) => (
    name === 'left_beam_prism' || name.startsWith('left_prism_')
  ));
  const irisRenderParts = findAllNamed(scene, (name) => /^oracle_iris_ring_\d+$/.test(name));
  const oracleArrayRenderParts = findAllNamed(scene, (name) => name.startsWith('right_oracle_array_'));
  const shutterRenderParts = Array.from({ length: 8 }, (_, index) => {
    const suffix = String(index).padStart(2, '0');
    return findAllNamed(scene, (name) => (
      name === `eye_shutter_${suffix}`
      || name === `eye_shutter_circuit_${suffix}`
      || name === `eye_shutter_sensor_${suffix}`
    ));
  });

  const eyeGroup = createPositionedPivot(
    scene,
    'authoredRubyMainEyeAnchor',
    eyeRenderParts,
    MAIN_EYE,
  );
  const weakPointCore = createPositionedPivot(
    scene,
    'authoredRubyRearWeakPointAnchor',
    weakPointRenderParts,
    REAR_WEAK_POINT,
  );
  const weaponGroup = createPositionedPivot(
    scene,
    'authoredRubyLeftPrismAnchor',
    weaponRenderParts,
    LEFT_PRISM,
  );
  const muzzle = addAnchor(weaponGroup, 'authoredRubyOpticOracleMuzzle', ORIGIN);

  const shutters = shutterRenderParts
    .map((parts, index) => {
      if (parts.length === 0) return null;
      const pivot = createPositionedPivot(
        scene,
        `authoredRubyEyeShutterPivot_${String(index).padStart(2, '0')}`,
        parts,
      );
      pivot.userData.authoredBaseRotationZ = pivot.rotation.z;
      pivot.userData.authoredShutterSign = index < 4 ? -1 : 1;
      pivot.userData.authoredShutterParts = parts;
      return pivot;
    })
    .filter(Boolean);
  const irisRings = irisRenderParts.map((ring, index) => {
    const pivot = createPositionedPivot(
      scene,
      `authoredRubyIrisPivot_${index}`,
      [ring],
    );
    pivot.userData.authoredBaseScale = pivot.scale.clone();
    pivot.userData.authoredBaseRotationZ = pivot.rotation.z;
    pivot.userData.authoredIrisRenderMesh = ring;
    return pivot;
  });
  const oracleArrayPivot = oracleArrayRenderParts.length > 0
    ? createPositionedPivot(
      scene,
      'authoredRubyRightOracleArrayPivot',
      oracleArrayRenderParts,
    )
    : null;
  const authoredOracleArray = oracleArrayPivot ? [oracleArrayPivot] : [];

  // GLTFLoader shares glTF material instances across every primitive. Isolate
  // only the independently animated scopes so their emissive levels cannot
  // leak into the eye, body trim, shutters, or each other.
  cloneScopedMaterials(eyeGroup, 'authoredMainEye');
  cloneScopedMaterials(weakPointCore, 'authoredWeakPoint');
  if (oracleArrayPivot) cloneScopedMaterials(oracleArrayPivot, 'authoredOracleArray');

  const legFoldPivots = buildLegFoldPivots(scene);
  const defenseGroup = new THREE.Group();
  defenseGroup.name = 'authoredRubyOpticOracleShutterController';
  scene.add(defenseGroup);

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
  root.userData.authoredOwnedTextures = collectOwnedTextures(scene);
  root.userData.authoredOwnedMaterials = new Set([fallbackMaterial]);

  return {
    root,
    frame: { plan: 'authoredRubyOpticOracle', body: scene, gait: null },
    eye: { group: eyeGroup, socket: eyeGroup, lens: eyeGroup },
    weapon: { group: weaponGroup, muzzle, clawDestroyed: false },
    chargeModule: { group: scene, nozzles: [] },
    defense: { group: defenseGroup, shutters, plates: [], shell: null },
    weakPoint: { group: weakPointCore, core: weakPointCore, socket: weakPointCore, sharedWithEye: false },
    materials: { ...allMaterials, eye: eyeMaterial, weapon: weaponMaterial, emissive: eyeMaterial, weakPoint: weakPointMaterial },
    authoredModel: scene,
    authoredShutters: shutters,
    authoredIrisRings: irisRings,
    authoredLegFoldPivots: legFoldPivots,
    authoredEye: eyeGroup,
    authoredWeakPoint: weakPointCore,
    authoredWeapon: weaponGroup,
    authoredEyeRenderParts: eyeRenderParts,
    authoredWeakPointRenderParts: weakPointRenderParts,
    authoredWeaponRenderParts: weaponRenderParts,
    authoredOracleArray,
    authoredOracleArrayRenderParts: oracleArrayRenderParts,
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
  ascensionActive = false, ascensionProgress = 0, pupilIntensity = 0,
} = {}) {
  const alpha = Math.min(1, dt * 10);
  const shutterClosure = defenseActive ? 0.82 : 0;
  for (const shutter of visual.authoredShutters ?? []) {
    const target = shutter.userData.authoredBaseRotationZ
      + shutter.userData.authoredShutterSign * shutterClosure;
    shutter.rotation.z = THREE.MathUtils.lerp(shutter.rotation.z, target, alpha);
  }
  const telegraphing = state === 'telegraph';
  const aperturePower = THREE.MathUtils.clamp(Math.max(pupilIntensity, ascensionProgress), 0, 1);
  setEmissiveIntensity(
    visual.authoredEye,
    ascensionActive ? 4.6 : telegraphing ? 3.2 : 1.8 + Math.sin(time * 4) * 0.25,
  );
  setEmissiveIntensity(visual.authoredWeakPoint, weakPointExposed ? 2.8 : 0.35);
  for (const lens of visual.authoredOracleArray ?? []) {
    lens.rotation.z += dt * (telegraphing ? 3.2 : 0.7);
    setEmissiveIntensity(lens, telegraphing ? 2.2 : 0.8);
  }
  for (let index = 0; index < (visual.authoredIrisRings?.length ?? 0); index += 1) {
    const ring = visual.authoredIrisRings[index];
    const baseScale = ring.userData.authoredBaseScale;
    const expansion = 1 + aperturePower * (0.08 + index * 0.08);
    if (baseScale) ring.scale.lerp(tempScale.copy(baseScale).multiplyScalar(expansion), alpha);
    const baseRotation = ring.userData.authoredBaseRotationZ ?? 0;
    ring.rotation.z = THREE.MathUtils.lerp(
      ring.rotation.z,
      baseRotation + aperturePower * Math.sin(time * (1.6 + index * 0.35)) * 0.42,
      alpha,
    );
  }
  const fold = THREE.MathUtils.clamp(ascensionProgress, 0, 1);
  for (const pivot of visual.authoredLegFoldPivots ?? []) {
    const base = pivot.userData.authoredBaseQuaternion;
    const folded = pivot.userData.authoredFoldQuaternion;
    if (!base || !folded) continue;
    tempFoldQuaternion.identity().slerp(folded, fold);
    tempTargetQuaternion.copy(base).multiply(tempFoldQuaternion);
    pivot.quaternion.slerp(tempTargetQuaternion, Math.min(1, dt * 6));
  }
  visual.authoredModel.position.y = THREE.MathUtils.lerp(
    visual.authoredModel.position.y,
    moving ? Math.sin(time * 7) * 0.035 * Math.max(0.25, speedRatio) : 0,
    alpha,
  );
}

export function disposeVisualTree(root) {
  if (!root || root.userData.authoredVisualDisposed) return;
  root.userData.authoredVisualDisposed = true;
  const geometries = new Set();
  const materials = new Set(root.userData.authoredOwnedMaterials ?? []);
  const textures = new Set(root.userData.authoredOwnedTextures ?? []);
  root?.traverse?.((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) if (material) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose?.());
  materials.forEach((material) => material.dispose?.());
  textures.forEach((texture) => texture.dispose?.());
  root.userData.authoredOwnedMaterials?.clear?.();
  root.userData.authoredOwnedTextures?.clear?.();
  root?.removeFromParent?.();
}
