import * as THREE from 'three';
import {
  ModularHumanoid,
  createAlloyChestPlate,
  createShoulderPad,
  createSimpleHelmet,
  createSwordArm,
  createShieldArm,
} from './ModularHumanoid.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171f);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 3.1, 6);
camera.lookAt(0, 1.7, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const hemiLight = new THREE.HemisphereLight(0xbfd7ff, 0x2a1e1a, 1.4);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(3, 6, 4);
keyLight.castShadow = true;
scene.add(keyLight);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(3, 48),
  new THREE.MeshStandardMaterial({ color: 0x222833, roughness: 0.9 }),
);
ground.name = 'groundPreviewDisc';
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const hero = new ModularHumanoid({
  skinColor: 0xc88f68,
  hairColor: 0x24160f,
  eyeColor: 0x72d7ff,
  clothColor: 0x293854,
  armorColor: 0xaeb7c2,
});

scene.add(hero.root);

hero.equip('head', createSimpleHelmet(hero.materials.armor));
hero.equip('chest', createAlloyChestPlate(hero.materials.armor));
hero.equip('leftShoulder', createShoulderPad(hero.materials.armor, 'left'));
hero.equip('rightShoulder', createShoulderPad(hero.materials.armor, 'right'));
hero.equip('rightHand', createSwordArm(hero.materials.armor));
hero.equip('leftHand', createShieldArm(hero.materials.armor));

hero.setSkinColor(0xd19b73);
hero.setHairColor(0x4a2c18);

// Presets can recolor and equip the character in one call.
// hero.applyPreset('ruinGuard');
hero.applyPreset({
  hairStyle: 'short',
  eyeColor: 0x8fffd2,
  equipment: {
    chest: 'alloyChestPlate',
    leftBoot: 'bootArmor',
    rightBoot: 'bootArmor',
    rightHand: 'swordArm',
  },
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);

  hero.root.rotation.y += 0.006;

  const leftShoulder = hero.joints.get('leftShoulder');
  const rightShoulder = hero.joints.get('rightShoulder');
  const t = performance.now() * 0.002;

  leftShoulder.rotation.x = Math.sin(t) * 0.14;
  rightShoulder.rotation.x = -Math.sin(t) * 0.14;

  renderer.render(scene, camera);
}

animate();
