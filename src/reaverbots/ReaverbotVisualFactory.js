import * as THREE from 'three';
import { REAVERBOT_EYE_COLOR } from './ReaverbotCatalog.js';

const FORWARD = new THREE.Vector3(0, 0, 1);
const ANIMAL_SIDE_MOUNT_WEAPONS = new Set([
  'pulseCannon',
  'mortarPod',
  'clusterMortar',
  'arcEmitter',
  'flameNozzle',
  'beamPrism',
  'mineDispenser',
]);

function standardMaterial(name, color, options = {}) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0.16,
    flatShading: options.flatShading ?? true,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
    depthWrite: options.depthWrite ?? true,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
  material.name = name;
  return material;
}

function mesh(parent, geometry, material, name, position = null, rotation = null, scale = null) {
  const object = new THREE.Mesh(geometry, material);
  object.name = name;
  object.castShadow = !material.transparent;
  object.receiveShadow = !material.transparent;
  if (position) object.position.set(position[0], position[1], position[2]);
  if (rotation) object.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (scale) object.scale.set(scale[0], scale[1], scale[2]);
  parent.add(object);
  return object;
}

function group(parent, name, position = null) {
  const object = new THREE.Group();
  object.name = name;
  if (position) object.position.set(position[0], position[1], position[2]);
  parent.add(object);
  return object;
}

function box(parent, material, name, size, position, rotation = null) {
  return mesh(parent, new THREE.BoxGeometry(size[0], size[1], size[2]), material, name, position, rotation);
}

function taperedColumn(parent, material, name, topRadius, bottomRadius, height, position, sides = 6, rotation = null) {
  return mesh(
    parent,
    new THREE.CylinderGeometry(topRadius, bottomRadius, height, sides, 1, false),
    material,
    name,
    position,
    rotation,
  );
}

function addJoint(parent, materials, name, position, radius = 0.14) {
  return mesh(
    parent,
    new THREE.SphereGeometry(radius, 8, 5),
    materials.dark,
    `${name}Joint`,
    position,
  );
}

function createMaterials(genome) {
  const palette = genome.palette;
  const materials = {
    primary: standardMaterial('material_generatedReaverbotPrimary', palette.primary),
    secondary: standardMaterial('material_generatedReaverbotSecondary', palette.secondary),
    trim: standardMaterial('material_generatedReaverbotTrim', palette.trim, { roughness: 0.66, metalness: 0.22 }),
    dark: standardMaterial('material_generatedReaverbotSeam', palette.dark, { roughness: 0.5, metalness: 0.34 }),
    weapon: standardMaterial('material_generatedReaverbotWeapon', palette.secondary, { roughness: 0.48, metalness: 0.42 }),
    emissive: standardMaterial('material_generatedReaverbotModuleGlow', palette.emissive, {
      emissive: palette.emissive,
      emissiveIntensity: 0.65,
      roughness: 0.26,
      metalness: 0.18,
    }),
    weakPoint: standardMaterial('material_generatedReaverbotWeakPoint', palette.emissive, {
      emissive: palette.emissive,
      emissiveIntensity: 1.2,
      roughness: 0.2,
      metalness: 0.08,
    }),
    eyeSocket: standardMaterial('material_generatedReaverbotEyeSocket', 0x171214, {
      emissive: 0x090002,
      emissiveIntensity: 0.35,
      roughness: 0.34,
      metalness: 0.42,
    }),
    eye: standardMaterial('material_generatedReaverbotRedEye', REAVERBOT_EYE_COLOR, {
      emissive: REAVERBOT_EYE_COLOR,
      emissiveIntensity: 1.8,
      roughness: 0.14,
      metalness: 0.05,
    }),
    glint: new THREE.MeshBasicMaterial({ color: 0xffe3c6, transparent: true, opacity: 0.95, depthWrite: false }),
    shieldEnergy: standardMaterial('material_generatedReaverbotEnergyDefense', palette.emissive, {
      emissive: palette.emissive,
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.14,
      roughness: 0.2,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  };
  materials.glint.name = 'material_generatedReaverbotEyeGlint';
  return materials;
}

function createBodyFrame(root, genome, materials) {
  const plan = genome.body.planId;
  const p = genome.body.proportions;
  const frame = {
    plan,
    limbs: [],
    wings: [],
    body: null,
    head: null,
    anchors: {},
    nominalHeight: genome.stats.collisionHeight,
  };

  if (plan === 'biped' || plan === 'lowBiped') {
    const low = plan === 'lowBiped';
    const torsoY = low ? 1.28 : 1.55;
    const torsoWidth = (low ? 0.78 : 1.05) * p.torsoWidth;
    const torsoHeight = low ? 0.78 : 0.98;
    const torsoDepth = (low ? 0.58 : 0.72) * p.torsoLength;
    frame.body = taperedColumn(root, materials.primary, 'generatedReaverbotTorso', torsoWidth * 0.48, torsoWidth * 0.58, torsoHeight, [0, torsoY, 0], 6);
    frame.body.scale.z = torsoDepth / torsoWidth;
    const headY = torsoY + torsoHeight * 0.62;
    frame.head = taperedColumn(root, materials.secondary, 'generatedReaverbotHead', 0.3 * p.headScale, 0.38 * p.headScale, low ? 0.55 : 0.64, [0, headY, 0.04], 6);

    for (const side of [-1, 1]) {
      const hip = group(root, side < 0 ? 'generatedLeftHip' : 'generatedRightHip', [side * torsoWidth * 0.3, torsoY - 0.4, 0]);
      addJoint(hip, materials, side < 0 ? 'leftHip' : 'rightHip', [0, 0, 0], 0.15);
      const upper = taperedColumn(hip, materials.secondary, side < 0 ? 'generatedLeftThigh' : 'generatedRightThigh', 0.13, 0.18, 0.58 * p.limbLength, [0, -0.28 * p.limbLength, 0], 5);
      const knee = addJoint(hip, materials, side < 0 ? 'leftKnee' : 'rightKnee', [0, -0.58 * p.limbLength, 0], 0.13);
      const lower = taperedColumn(hip, materials.primary, side < 0 ? 'generatedLeftShin' : 'generatedRightShin', 0.12, 0.19, 0.58 * p.limbLength, [0, -0.86 * p.limbLength, 0.02], 5);
      const foot = box(hip, materials.primary, side < 0 ? 'generatedLeftWedgeFoot' : 'generatedRightWedgeFoot', [0.36, 0.22, 0.58], [0, -1.16 * p.limbLength, 0.13]);
      foot.geometry.translate(0, 0, 0.06);
      frame.limbs.push({ pivot: hip, upper, lower, knee, phase: side });

      const shoulder = group(root, side < 0 ? 'generatedLeftShoulder' : 'generatedRightShoulder', [side * torsoWidth * 0.61, torsoY + 0.23, 0]);
      addJoint(shoulder, materials, side < 0 ? 'leftShoulder' : 'rightShoulder', [0, 0, 0], 0.18);
      taperedColumn(shoulder, materials.primary, side < 0 ? 'generatedLeftArm' : 'generatedRightArm', 0.13, 0.18, 0.65, [0, -0.31, 0], 5);
      box(shoulder, materials.secondary, side < 0 ? 'generatedLeftFist' : 'generatedRightFist', [0.32, 0.35, 0.32], [0, -0.68, 0.02]);
      frame.limbs.push({ pivot: shoulder, phase: -side, arm: true });
    }

    frame.anchors = {
      eye: [0, headY + 0.02, 0.35 * p.headScale],
      weapon: [torsoWidth * 0.62, torsoY + 0.2, 0.15],
      defense: [-torsoWidth * 0.62, torsoY + 0.15, 0.26],
      center: [0, torsoY, 0],
      rear: [0, torsoY, -torsoDepth * 0.56],
      rearHigh: [0, torsoY + 0.28, -torsoDepth * 0.58],
      belly: [0, torsoY - 0.22, torsoDepth * 0.36],
      leg: [-torsoWidth * 0.3, Math.max(0.42, torsoY - 0.95 * p.limbLength), 0.08],
      side: [torsoWidth * 0.58, torsoY, 0],
      frontLow: [0, torsoY - 0.22, torsoDepth * 0.55],
      frontSide: [-torsoWidth * 0.55, torsoY + 0.1, torsoDepth * 0.45],
    };
  } else if (plan === 'quadruped' || plan === 'crawler') {
    const crawler = plan === 'crawler';
    const bodyY = crawler ? 0.72 : 0.92;
    const bodyWidth = (crawler ? 1.2 : 0.86) * p.torsoWidth;
    const bodyLength = (crawler ? 1.48 : 1.34) * p.torsoLength;
    frame.body = box(root, materials.primary, 'generatedReaverbotAnimalTorso', [bodyWidth, crawler ? 0.62 : 0.68, bodyLength], [0, bodyY, 0]);
    frame.body.geometry.rotateY(Math.PI / 4);
    const neck = group(root, 'generatedReaverbotNeck', [0, bodyY + 0.12, bodyLength * 0.5]);
    taperedColumn(neck, materials.secondary, 'generatedReaverbotNeckColumn', 0.25, 0.32, 0.54, [0, 0.12, 0.18], 5, [Math.PI * 0.28, 0, 0]);
    frame.head = box(neck, materials.secondary, 'generatedReaverbotAnimalHead', [bodyWidth * 0.72, 0.5 * p.headScale, 0.68 * p.headScale], [0, 0.38, 0.48]);

    const legZ = bodyLength * 0.34;
    for (const side of [-1, 1]) {
      for (const front of [-1, 1]) {
        const leg = group(root, `generated${side < 0 ? 'Left' : 'Right'}${front > 0 ? 'Front' : 'Rear'}Leg`, [side * bodyWidth * 0.42, bodyY - 0.18, front * legZ]);
        addJoint(leg, materials, 'quadrupedHip', [0, 0, 0], 0.13);
        taperedColumn(leg, materials.secondary, 'generatedQuadrupedUpperLeg', 0.1, 0.16, crawler ? 0.42 : 0.56 * p.limbLength, [0, -0.22, 0], 5);
        taperedColumn(leg, materials.primary, 'generatedQuadrupedLowerLeg', 0.08, 0.13, crawler ? 0.34 : 0.48 * p.limbLength, [0, crawler ? -0.47 : -0.62 * p.limbLength, front * 0.05], 5);
        box(leg, materials.primary, 'generatedQuadrupedWedgeFoot', [0.28, 0.16, 0.4], [0, crawler ? -0.68 : -0.9 * p.limbLength, 0.12]);
        frame.limbs.push({ pivot: leg, phase: side * front, front });
      }
    }

    const tail = taperedColumn(root, materials.secondary, 'generatedReaverbotTail', 0.06, 0.18, 0.86, [0, bodyY + 0.04, -bodyLength * 0.72], 6, [Math.PI * 0.5, 0, 0]);
    tail.rotation.x = -Math.PI * 0.5;
    frame.anchors = {
      eye: [0, bodyY + 0.5, bodyLength * 0.5 + 0.52 + 0.34 * p.headScale],
      weapon: [0, bodyY + 0.28, bodyLength * 0.72],
      defense: [-bodyWidth * 0.54, bodyY + 0.12, bodyLength * 0.18],
      center: [0, bodyY, 0],
      rear: [0, bodyY + 0.03, -bodyLength * 0.56],
      rearHigh: [0, bodyY + 0.34, -bodyLength * 0.42],
      belly: [0, bodyY - 0.34, 0],
      leg: [-bodyWidth * 0.43, crawler ? 0.38 : 0.5, legZ],
      side: [bodyWidth * 0.54, bodyY, 0],
      frontLow: [0, bodyY - 0.08, bodyLength * 0.54],
      frontSide: [-bodyWidth * 0.45, bodyY + 0.12, bodyLength * 0.46],
    };
  } else if (plan === 'tripod') {
    const bodyY = 1.42;
    const radius = 0.68 * p.torsoWidth;
    frame.body = taperedColumn(root, materials.primary, 'generatedReaverbotTripodChassis', radius * 0.82, radius, 0.68, [0, bodyY, 0], 6);
    frame.head = taperedColumn(root, materials.secondary, 'generatedReaverbotTripodHead', 0.26, 0.34, 0.64, [0, bodyY + 0.6, 0], 6);
    for (let index = 0; index < 3; index += 1) {
      const angle = index * Math.PI * 2 / 3;
      const leg = group(root, `generatedTripodLeg${index}`, [Math.sin(angle) * radius * 0.7, bodyY - 0.28, Math.cos(angle) * radius * 0.7]);
      leg.rotation.y = angle;
      taperedColumn(leg, materials.secondary, 'generatedTripodUpperLeg', 0.11, 0.18, 0.74 * p.limbLength, [0, -0.34, 0.12], 5, [-0.16, 0, 0]);
      box(leg, materials.primary, 'generatedTripodFoot', [0.42, 0.18, 0.58], [0, -0.75 * p.limbLength, 0.26]);
      frame.limbs.push({ pivot: leg, phase: index - 1 });
    }
    frame.anchors = {
      eye: [0, bodyY + 0.63, 0.31], weapon: [0.45, bodyY + 0.3, 0.14], defense: [-0.55, bodyY + 0.12, 0.3],
      center: [0, bodyY, 0], rear: [0, bodyY, -0.62], rearHigh: [0, bodyY + 0.32, -0.5], belly: [0, bodyY - 0.34, 0.05],
      leg: [-0.5, 0.62, 0.2], side: [0.64, bodyY, 0], frontLow: [0, bodyY - 0.18, 0.58], frontSide: [-0.5, bodyY, 0.42],
    };
  } else if (plan === 'hopper') {
    const bodyY = 1.08;
    frame.body = mesh(root, new THREE.OctahedronGeometry(0.62, 0), materials.primary, 'generatedReaverbotHopperBody', [0, bodyY, 0], null, [p.torsoWidth, 0.9, p.torsoLength]);
    frame.head = taperedColumn(root, materials.secondary, 'generatedReaverbotHopperHead', 0.22, 0.32, 0.6, [0, bodyY + 0.6, 0.05], 6);
    for (const side of [-1, 1]) {
      const leg = group(root, side < 0 ? 'generatedHopperLeftSpringLeg' : 'generatedHopperRightSpringLeg', [side * 0.34, bodyY - 0.34, 0]);
      for (let ring = 0; ring < 3; ring += 1) {
        mesh(leg, new THREE.TorusGeometry(0.16, 0.035, 5, 10), materials.dark, 'generatedHopperSpringCoil', [0, -ring * 0.18, 0], [Math.PI / 2, 0, 0]);
      }
      box(leg, materials.primary, 'generatedHopperFoot', [0.38, 0.2, 0.54], [0, -0.64, 0.14]);
      frame.limbs.push({ pivot: leg, phase: side });
    }
    frame.anchors = {
      eye: [0, bodyY + 0.63, 0.3], weapon: [0, bodyY + 0.15, 0.52], defense: [-0.46, bodyY + 0.05, 0.24],
      center: [0, bodyY, 0], rear: [0, bodyY, -0.58], rearHigh: [0, bodyY + 0.3, -0.42], belly: [0, bodyY - 0.47, 0],
      leg: [-0.34, 0.48, 0], side: [0.52, bodyY, 0], frontLow: [0, bodyY - 0.18, 0.5], frontSide: [-0.42, bodyY, 0.36],
    };
  } else {
    const flyer = plan === 'flyer';
    const bodyY = flyer ? 0.48 : 0.62;
    frame.body = flyer
      ? mesh(root, new THREE.DodecahedronGeometry(0.52, 0), materials.primary, 'generatedReaverbotFlyerCore', [0, bodyY, 0], null, [1.2 * p.torsoWidth, 0.82, 1])
      : taperedColumn(root, materials.primary, 'generatedReaverbotHoverBell', 0.46 * p.torsoWidth, 0.72 * p.torsoWidth, 0.88, [0, bodyY, 0], 8);
    frame.head = taperedColumn(root, materials.secondary, 'generatedReaverbotHoverHead', 0.2, 0.3, 0.55, [0, bodyY + 0.64, 0], 6);

    const wingCount = flyer ? 4 : 3;
    for (let index = 0; index < wingCount; index += 1) {
      const angle = index * Math.PI * 2 / wingCount;
      const wing = group(root, `generatedHoverFin${index}`, [Math.sin(angle) * 0.36, bodyY + 0.05, Math.cos(angle) * 0.36]);
      wing.rotation.y = angle;
      const blade = box(wing, index % 2 ? materials.primary : materials.trim, 'generatedHoverBlade', [flyer ? 0.42 : 0.3, 0.1, flyer ? 1.25 : 0.82], [0, 0, flyer ? 0.58 : 0.4]);
      blade.rotation.x = flyer ? (index % 2 ? 0.13 : -0.13) : 0;
      frame.wings.push({ pivot: wing, blade, phase: index });
    }
    frame.anchors = {
      eye: [0, bodyY + 0.64, 0.29], weapon: [0, bodyY + 0.05, 0.55], defense: [-0.5, bodyY, 0.18],
      center: [0, bodyY, 0], rear: [0, bodyY, -0.52], rearHigh: [0, bodyY + 0.28, -0.42], belly: [0, bodyY - 0.45, 0],
      leg: [-0.42, bodyY - 0.22, 0], side: [0.55, bodyY, 0], frontLow: [0, bodyY - 0.18, 0.48], frontSide: [-0.44, bodyY, 0.34],
    };
  }

  return frame;
}

function createEye(root, anchor, materials, headScale) {
  const eye = group(root, 'generatedReaverbotEyeMotif', anchor);
  const size = 0.21 * headScale;
  const socket = mesh(eye, new THREE.CylinderGeometry(size * 1.08, size * 1.18, 0.075, 12), materials.eyeSocket, 'generatedReaverbotEyeSocket', [0, 0, 0], [Math.PI / 2, 0, 0]);
  const lens = mesh(eye, new THREE.SphereGeometry(size * 0.68, 12, 7), materials.eye, 'generatedReaverbotRedEye', [0, 0, 0.055], null, [1, 1, 0.38]);
  lens.userData.reaverbotEye = true;
  lens.userData.dominantFocalPoint = true;
  const glint = mesh(eye, new THREE.SphereGeometry(size * 0.13, 6, 4), materials.glint, 'generatedReaverbotEyeGlint', [size * 0.2, size * 0.22, size * 0.115]);
  return { group: eye, socket, lens, glint };
}

function createWeapon(root, genome, frame, materials) {
  const id = genome.modules.weapon.id;
  const anchor = frame.anchors.weapon;
  const weapon = group(root, `generatedWeapon_${id}`, anchor);
  if ((frame.plan === 'quadruped' || frame.plan === 'crawler')
    && ANIMAL_SIDE_MOUNT_WEAPONS.has(id)
    && Math.abs(weapon.position.x - frame.anchors.eye[0]) < 0.28) {
    weapon.position.x += 0.52;
    weapon.position.y += 0.16;
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = 'generatedReaverbotWeaponMuzzle';
  weapon.add(muzzle);

  if (id === 'ramHorn') {
    mesh(weapon, new THREE.ConeGeometry(0.22, 0.94, 6), materials.weapon, 'generatedRamHorn', [0, 0, 0.42], [Math.PI / 2, 0, 0]);
    muzzle.position.set(0, 0, 0.92);
  } else if (id === 'crusherJaw') {
    const upper = box(weapon, materials.weapon, 'generatedCrusherUpperJaw', [0.65, 0.16, 0.58], [0, 0.13, 0.28], [-0.08, 0, 0]);
    const lower = box(weapon, materials.primary, 'generatedCrusherLowerJaw', [0.65, 0.13, 0.58], [0, -0.13, 0.28], [0.12, 0, 0]);
    for (const side of [-1, 0, 1]) {
      mesh(upper, new THREE.ConeGeometry(0.045, 0.16, 5), materials.trim, 'generatedCrusherTooth', [side * 0.2, -0.12, 0.17], [0, 0, Math.PI]);
      mesh(lower, new THREE.ConeGeometry(0.045, 0.14, 5), materials.trim, 'generatedCrusherTooth', [side * 0.2, 0.1, 0.12]);
    }
    muzzle.position.set(0, 0, 0.68);
    weapon.userData.jawUpper = upper;
    weapon.userData.jawLower = lower;
  } else if (id === 'clawArm') {
    box(weapon, materials.weapon, 'generatedClawForearm', [0.34, 0.34, 0.72], [0, 0, 0.28]);
    for (const side of [-1, 0, 1]) {
      const claw = mesh(weapon, new THREE.ConeGeometry(0.08, 0.48, 5), materials.trim, 'generatedClawTalon', [side * 0.16, 0, 0.78], [Math.PI / 2, 0, 0]);
      claw.rotation.z = side * 0.18;
    }
    muzzle.position.set(0, 0, 0.96);
  } else if (id === 'pounceActuator' || id === 'shockPiston') {
    const core = taperedColumn(weapon, materials.weapon, `generated${id === 'pounceActuator' ? 'PounceActuator' : 'ShockPiston'}`, 0.16, 0.24, 0.58, [0, 0, 0.18], 7, [Math.PI / 2, 0, 0]);
    for (let index = 0; index < 3; index += 1) {
      mesh(core, new THREE.TorusGeometry(0.2, 0.035, 5, 10), materials.emissive, 'generatedActuatorCoil', [0, -0.18 + index * 0.18, 0], [Math.PI / 2, 0, 0]);
    }
    muzzle.position.set(0, -0.15, 0.64);
  } else if (id === 'pulseCannon') {
    taperedColumn(weapon, materials.weapon, 'generatedPulseCannonBody', 0.24, 0.3, 0.72, [0, 0, 0.3], 8, [Math.PI / 2, 0, 0]);
    taperedColumn(weapon, materials.dark, 'generatedPulseCannonBarrel', 0.13, 0.18, 0.62, [0, 0, 0.86], 8, [Math.PI / 2, 0, 0]);
    mesh(weapon, new THREE.TorusGeometry(0.19, 0.045, 6, 12), materials.emissive, 'generatedPulseCannonRing', [0, 0, 0.62]);
    muzzle.position.set(0, 0, 1.2);
  } else if (id === 'mortarPod' || id === 'clusterMortar') {
    weapon.rotation.x = -0.62;
    box(weapon, materials.weapon, 'generatedMortarBreech', [0.58, 0.52, 0.62], [0, 0, 0.16]);
    taperedColumn(weapon, materials.dark, 'generatedMortarTube', id === 'clusterMortar' ? 0.19 : 0.15, 0.24, 0.9, [0, 0, 0.76], 8, [Math.PI / 2, 0, 0]);
    muzzle.position.set(0, 0, 1.23);
  } else if (id === 'arcEmitter') {
    const coil = mesh(weapon, new THREE.TorusGeometry(0.3, 0.07, 6, 14), materials.weapon, 'generatedArcEmitterCoil', [0, 0, 0.24]);
    coil.rotation.y = Math.PI / 2;
    mesh(weapon, new THREE.SphereGeometry(0.2, 8, 6), materials.emissive, 'generatedArcEmitterCore', [0, 0, 0.32]);
    for (const side of [-1, 1]) {
      const prong = taperedColumn(weapon, materials.trim, 'generatedArcEmitterProng', 0.025, 0.07, 0.62, [side * 0.2, 0, 0.52], 5, [Math.PI / 2, 0, side * 0.1]);
      prong.rotation.z = side * -0.15;
    }
    muzzle.position.set(0, 0, 0.78);
  } else if (id === 'flameNozzle') {
    taperedColumn(weapon, materials.weapon, 'generatedFlameNozzleBody', 0.16, 0.28, 0.72, [0, 0, 0.3], 7, [Math.PI / 2, 0, 0]);
    taperedColumn(weapon, materials.dark, 'generatedFlameNozzleMouth', 0.24, 0.14, 0.35, [0, 0, 0.8], 7, [Math.PI / 2, 0, 0]);
    muzzle.position.set(0, 0, 1.02);
  } else if (id === 'beamPrism') {
    mesh(weapon, new THREE.OctahedronGeometry(0.32, 0), materials.emissive, 'generatedBeamPrism', [0, 0, 0.32], [0, 0, Math.PI / 4]);
    for (const side of [-1, 1]) {
      box(weapon, materials.weapon, 'generatedBeamPrismRail', [0.12, 0.12, 0.72], [side * 0.27, 0, 0.36]);
    }
    muzzle.position.set(0, 0, 0.84);
  } else if (id === 'mineDispenser') {
    box(weapon, materials.weapon, 'generatedMineDispenserRack', [0.68, 0.5, 0.58], [0, 0, 0.2]);
    for (const side of [-1, 1]) {
      mesh(weapon, new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), materials.emissive, 'generatedStoredMine', [side * 0.2, 0, 0.52], [Math.PI / 2, 0, 0]);
    }
    muzzle.position.set(0, -0.15, 0.7);
  } else if (id === 'rotorBlade') {
    box(weapon, materials.dark, 'generatedRotorBladeCrossbar', [2.08, 0.14, 0.18], [0, 0, 0]);
    for (const side of [-1, 1]) {
      const blade = mesh(
        weapon,
        new THREE.ConeGeometry(0.2, 0.78, 5),
        materials.weapon,
        'generatedRotorBlade',
        [side * 1.12, 0, 0],
        [0, 0, side * -Math.PI / 2],
      );
      blade.userData.rotorSide = side;
      for (let link = 0; link < 3; link += 1) {
        mesh(
          weapon,
          new THREE.TorusGeometry(0.07, 0.018, 5, 8),
          materials.trim,
          'generatedRotorFlailLink',
          [side * (0.72 + link * 0.13), 0, 0],
          [Math.PI / 2, 0, 0],
        );
      }
    }
    muzzle.position.set(0, 0, 0.2);
  } else {
    mesh(weapon, new THREE.IcosahedronGeometry(0.34, 0), materials.emissive, 'generatedOverloadWeaponCore', [0, 0, 0.16]);
    mesh(weapon, new THREE.TorusGeometry(0.42, 0.045, 6, 16), materials.weapon, 'generatedOverloadCoreCage', [0, 0, 0.16], [Math.PI / 2, 0, 0]);
    muzzle.position.set(0, 0, 0.45);
  }

  return { group: weapon, muzzle };
}

function createDefense(root, genome, frame, materials) {
  const id = genome.modules.defense.id;
  const defenseMaterial = materials.primary.clone();
  defenseMaterial.name = `material_generatedDefense_${id}`;
  let anchor = frame.anchors.defense;
  if (id === 'armorShutters' || id === 'armoredSkull') {
    anchor = frame.anchors.eye;
  } else if (id === 'directionalShield' || id === 'reactivePlate') {
    anchor = [...frame.anchors.frontSide];
    const side = Math.sign(anchor[0] || -1);
    anchor[0] = side * (id === 'directionalShield' ? 0.82 : 0.58);
    anchor[1] += 0.08;
    anchor[2] += 0.3;
  } else if (id === 'guardArms') {
    anchor = [...frame.anchors.center];
    anchor[2] += 0.42;
  } else if (id === 'sidePlates') {
    anchor = [...frame.anchors.center];
    anchor[1] -= 0.14;
    anchor[2] = frame.anchors.frontSide[2] + 0.18;
  }
  const defense = group(root, `generatedDefense_${id}`, anchor);
  const guardNormal = new THREE.Object3D();
  guardNormal.name = 'generatedDefenseGuardNormal';
  defense.add(guardNormal);
  const parts = {
    group: defense,
    shell: null,
    shutters: [],
    plates: [],
    guardNormal,
    primaryPlate: null,
  };

  if (id === 'directionalShield') {
    const plate = mesh(defense, new THREE.CylinderGeometry(0.82, 0.9, 0.16, 6), defenseMaterial, 'generatedDirectionalShield', [0, 0, 0], [Math.PI / 2, 0, 0], [0.9, 1.08, 1]);
    mesh(plate, new THREE.TorusGeometry(0.64, 0.065, 5, 6), materials.trim, 'generatedDirectionalShieldRim', [0, -0.09, 0], [Math.PI / 2, 0, 0]);
    mesh(plate, new THREE.CylinderGeometry(0.17, 0.17, 0.19, 8), materials.emissive, 'generatedDirectionalShieldNode', [0, -0.12, 0], [Math.PI / 2, 0, 0]);
    parts.plates.push(plate);
    parts.primaryPlate = plate;
  } else if (id === 'guardArms') {
    for (const side of [-1, 1]) {
      const arm = box(defense, defenseMaterial, 'generatedGuardArm', [0.32, 0.9, 0.28], [side * 0.2, 0, 0], [0, 0, side * 0.58]);
      arm.userData.guardSide = side;
      parts.plates.push(arm);
    }
  } else if (id === 'armorShutters') {
    for (const side of [-1, 1]) {
      const shutter = box(defense, defenseMaterial, 'generatedEyeArmorShutter', [0.28, 0.54, 0.12], [side * 0.42, 0, 0.13], [0, 0, side * 0.28]);
      shutter.userData.openX = side * 0.42;
      shutter.userData.closedX = side * 0.16;
      parts.shutters.push(shutter);
    }
  } else if (id === 'rotatingPlates') {
    defense.position.copy(new THREE.Vector3(...frame.anchors.center));
    box(defense, materials.dark, 'generatedRotorGuardSpine', [0.16, 0.16, 1.72], [0, 0, 0]);
    const plate = box(defense, defenseMaterial, 'generatedRotatingDefensePlate', [0.96, 1.02, 0.18], [0, 0, 0.86]);
    box(plate, materials.trim, 'generatedRotatingDefensePlateInset', [0.68, 0.72, 0.04], [0, 0, 0.11]);
    mesh(plate, new THREE.CylinderGeometry(0.15, 0.15, 0.2, 8), materials.emissive, 'generatedRotatingDefenseNode', [0, 0, 0.14], [Math.PI / 2, 0, 0]);
    guardNormal.position.set(0, 0, 0.95);
    parts.plates.push(plate);
    parts.primaryPlate = plate;
  } else if (id === 'energyMembrane' || id === 'phaseShell') {
    defense.position.copy(new THREE.Vector3(...frame.anchors.center));
    const shellMaterial = materials.shieldEnergy.clone();
    shellMaterial.name = id === 'phaseShell' ? 'material_generatedPhaseShell' : 'material_generatedEnergyMembrane';
    parts.shell = mesh(defense, new THREE.IcosahedronGeometry(0.98, 1), shellMaterial, id === 'phaseShell' ? 'generatedPhaseShell' : 'generatedEnergyMembrane', [0, 0, 0], null, [1.1, 1.05, 1.1]);
  } else if (id === 'armoredSkull') {
    for (const side of [-1, 1]) {
      const plate = box(defense, defenseMaterial, 'generatedArmoredSkullCheek', [0.32, 0.52, 0.18], [side * 0.3, -0.03, 0.08], [0, side * 0.12, side * 0.08]);
      parts.plates.push(plate);
    }
  } else if (id === 'sidePlates') {
    for (const side of [-1, 1]) {
      const plate = box(defense, defenseMaterial, 'generatedSideArmorPlate', [0.54, 1.18, 0.16], [side * 0.34, -0.18, 0], [0, side * -0.06, side * 0.04]);
      plate.userData.guardSide = side;
      plate.userData.closedPosition = plate.position.clone();
      plate.userData.openPosition = new THREE.Vector3(side * 0.72, 0.26, -0.08);
      parts.plates.push(plate);
    }
  } else if (id === 'armoredBack' || id === 'armoredCarapace') {
    defense.position.copy(new THREE.Vector3(...frame.anchors.rearHigh));
    for (let index = -1; index <= 1; index += 1) {
      const plate = box(defense, defenseMaterial, 'generatedCarapacePlate', [0.46, 0.24, 0.48], [index * 0.38, 0, 0], [0.22, 0, index * 0.05]);
      parts.plates.push(plate);
    }
  } else {
    const plate = box(defense, defenseMaterial, 'generatedReactivePlate', [0.8, 1.06, 0.18], [0, 0, 0], [0, 0, -0.1]);
    parts.plates.push(plate);
    parts.primaryPlate = plate;
  }

  defense.userData.defenseId = id;
  defense.userData.basePosition = defense.position.clone();
  parts.primaryPlate ??= parts.plates[0] ?? null;

  return parts;
}

function weakPointAnchor(frame, location) {
  switch (location) {
    case 'eye': return frame.anchors.eye;
    case 'rearHigh': return frame.anchors.rearHigh;
    case 'belly': return frame.anchors.belly;
    case 'leg': return frame.anchors.leg;
    case 'side': return frame.anchors.side;
    case 'frontLow': return frame.anchors.frontLow;
    case 'frontSide': return frame.anchors.frontSide;
    case 'center': return frame.anchors.center;
    case 'rotorOpposite': return frame.anchors.center;
    case 'rear':
    default: return frame.anchors.rear;
  }
}

function createWeakPoint(root, genome, frame, materials, eye, defense) {
  const definition = genome.modules.weakPoint;
  if (definition.location === 'eye') {
    eye.lens.userData.weakPoint = true;
    eye.lens.userData.weakPointId = definition.id;
    return { group: eye.group, core: eye.lens, socket: eye.socket, sharedWithEye: true };
  }

  const linkedToRotor = definition.location === 'rotorOpposite'
    && genome.modules.defense.id === 'rotatingPlates';
  const anchor = linkedToRotor ? [0, -0.05, -0.86] : weakPointAnchor(frame, definition.location);
  const weakPoint = group(
    linkedToRotor ? defense.group : root,
    `generatedWeakPoint_${definition.id}`,
    anchor,
  );
  if (linkedToRotor) {
    weakPoint.rotation.y = Math.PI;
    weakPoint.userData.linkedDefenseId = 'rotatingPlates';
  } else if (definition.location === 'leg') {
    weakPoint.position.y += 0.12;
    weakPoint.rotation.y = anchor[0] < 0 ? -Math.PI / 2 : Math.PI / 2;
  } else if (definition.location === 'side') {
    weakPoint.rotation.y = anchor[0] < 0 ? -Math.PI / 2 : Math.PI / 2;
  }
  const radius = definition.radius ?? 0.22;
  const socket = mesh(weakPoint, new THREE.CylinderGeometry(radius * 1.28, radius * 1.4, 0.11, 10), materials.dark, 'generatedWeakPointSocket', [0, 0, 0], [Math.PI / 2, 0, 0]);
  const core = mesh(weakPoint, new THREE.SphereGeometry(radius, 10, 7), materials.weakPoint, 'generatedWeakPointCore', [0, 0, 0.07], null, [1, 1, 0.5]);
  core.userData.weakPoint = true;
  core.userData.weakPointId = definition.id;
  mesh(weakPoint, new THREE.TorusGeometry(radius * 1.18, radius * 0.1, 5, 10), materials.trim, 'generatedWeakPointRing', [0, 0, 0.1]);
  return { group: weakPoint, core, socket, sharedWithEye: false };
}

function addSurfaceGrammar(root, genome, frame, materials) {
  const rhythm = genome.body.proportions.panelRhythm;
  const center = frame.anchors.center;
  for (let index = 0; index < rhythm; index += 1) {
    const offset = (index - (rhythm - 1) * 0.5) * 0.16;
    box(root, index % 2 ? materials.dark : materials.trim, 'generatedReaverbotCircuitInlay', [0.055, 0.32, 0.035], [offset, center[1] + 0.03, center[2] + 0.56]);
  }

  const spikeCount = genome.body.proportions.spikeCount;
  for (let index = 0; index < spikeCount; index += 1) {
    const offset = (index - (spikeCount - 1) * 0.5) * 0.24;
    mesh(root, new THREE.ConeGeometry(0.07, 0.34 + index * 0.03, 5), materials.secondary, 'generatedReaverbotSilhouetteSpire', [offset, center[1] + 0.66, center[2] - 0.08]);
  }
}

export function createReaverbotVisual(genome) {
  const materials = createMaterials(genome);
  const visualRoot = new THREE.Group();
  visualRoot.name = `generatedReaverbotVisual_${genome.seed}`;
  visualRoot.userData.reaverbotGenome = genome;
  visualRoot.position.y = genome.body.hoverHeight ?? 0;

  const frame = createBodyFrame(visualRoot, genome, materials);
  const eye = createEye(visualRoot, frame.anchors.eye, materials, genome.body.proportions.headScale);
  const weapon = createWeapon(visualRoot, genome, frame, materials);
  const defense = createDefense(visualRoot, genome, frame, materials);
  if (genome.modules.weapon.id === 'rotorBlade') {
    defense.group.add(weapon.group);
    weapon.group.position.set(0, 0, 0);
    weapon.group.rotation.set(0, 0, 0);
    weapon.group.userData.linkedDefenseId = 'rotatingPlates';
  }
  const weakPoint = createWeakPoint(visualRoot, genome, frame, materials, eye, defense);
  addSurfaceGrammar(visualRoot, genome, frame, materials);
  visualRoot.scale.setScalar(genome.body.proportions.overallScale);
  visualRoot.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(visualRoot);
  const size = bounds.getSize(new THREE.Vector3());

  return {
    root: visualRoot,
    frame,
    eye,
    weapon,
    defense,
    weakPoint,
    materials,
    bounds,
    size,
    forward: FORWARD.clone(),
  };
}

export function setReaverbotDefenseVisualActive(visual, active, openness = active ? 0 : 1) {
  const defense = visual.defense;
  const easedOpen = THREE.MathUtils.smoothstep(openness, 0, 1);
  const defenseId = defense.group.userData.defenseId;
  const basePosition = defense.group.userData.basePosition;

  defense.group.userData.active = active;
  if (basePosition) {
    defense.group.position.copy(basePosition);
  }
  if (defenseId === 'directionalShield' || defenseId === 'reactivePlate') {
    defense.group.position.y -= easedOpen * 0.52;
    defense.group.rotation.z = THREE.MathUtils.lerp(
      0,
      defenseId === 'directionalShield' ? -0.82 : -0.58,
      easedOpen,
    );
  }
  for (const shutter of defense.shutters) {
    const side = Math.sign(shutter.userData.openX || shutter.position.x || 1);
    shutter.position.x = THREE.MathUtils.lerp(shutter.userData.closedX, shutter.userData.openX, easedOpen);
    shutter.rotation.z = side * THREE.MathUtils.lerp(0.05, 0.34, easedOpen);
  }
  if (defense.shell) {
    defense.shell.material.opacity = active ? 0.18 : 0.035;
    defense.shell.material.emissiveIntensity = active ? 0.68 : 0.12;
  }
  for (const plate of defense.plates) {
    if (defenseId === 'guardArms') {
      const side = plate.userData.guardSide ?? Math.sign(plate.position.x || 1);
      plate.position.x = side * THREE.MathUtils.lerp(0.2, 0.56, easedOpen);
      plate.rotation.z = side * THREE.MathUtils.lerp(0.58, 0.12, easedOpen);
    } else if (defenseId === 'sidePlates') {
      const closed = plate.userData.closedPosition;
      const open = plate.userData.openPosition;
      if (closed && open) {
        plate.position.lerpVectors(closed, open, easedOpen);
      }
      const side = plate.userData.guardSide ?? Math.sign(plate.position.x || 1);
      plate.rotation.y = side * THREE.MathUtils.lerp(-0.06, -0.72, easedOpen);
    }
    plate.material.emissive?.set(active ? visual.materials.emissive.color : 0x000000);
    plate.material.emissiveIntensity = active ? 0.12 : 0;
  }
}

export function setReaverbotWeakPointExposed(visual, exposed) {
  const { core, socket } = visual.weakPoint;
  core.userData.exposed = exposed;
  core.material.emissiveIntensity = exposed ? (visual.weakPoint.sharedWithEye ? 2.1 : 1.75) : (visual.weakPoint.sharedWithEye ? 1.45 : 0.18);
  if (!visual.weakPoint.sharedWithEye) {
    core.scale.setScalar(exposed ? 1.08 : 0.82);
    socket.material.emissive?.set(exposed ? visual.materials.emissive.color : 0x000000);
    socket.material.emissiveIntensity = exposed ? 0.3 : 0;
  }
}

export function animateReaverbotVisual(visual, {
  time = 0,
  dt = 0,
  moving = false,
  speedRatio = 0,
  state = 'position',
  stateProgress = 0,
  attackKind = null,
  defenseActive = false,
  weakPointExposed = false,
  weakPointLocation = null,
} = {}) {
  const locomotion = moving ? Math.sin(time * (7 + speedRatio * 3)) : Math.sin(time * 1.8) * 0.08;
  for (const limb of visual.frame.limbs) {
    const amplitude = limb.arm ? 0.18 : 0.32;
    const target = moving ? locomotion * amplitude * (limb.phase || 1) : 0;
    limb.pivot.rotation.x = THREE.MathUtils.lerp(limb.pivot.rotation.x, target, Math.min(1, dt * 10));
  }
  for (const wing of visual.frame.wings) {
    wing.pivot.rotation.z = Math.sin(time * 5.5 + wing.phase) * 0.16;
    wing.pivot.rotation.y += dt * (visual.frame.plan === 'flyer' ? 0.45 : 1.7);
  }

  if (visual.defense.group.name.includes('rotatingPlates')) {
    const rotorWeapon = visual.weapon.group.name.includes('rotorBlade');
    const rotorSpeed = rotorWeapon
      ? state === 'commit'
        ? 7.2
        : moving
          ? 3.4
          : state === 'recovery'
            ? 1.5
            : 2.2
      : defenseActive ? 2.6 : 0.8;
    visual.defense.group.rotation.y += dt * rotorSpeed;
  }
  if (visual.defense.shell) {
    visual.defense.shell.rotation.y += dt * (defenseActive ? 0.9 : 0.25);
  }

  const hoverHeight = visual.root.userData.baseHoverHeight ?? visual.root.position.y;
  visual.root.userData.baseHoverHeight = hoverHeight;
  const hover = visual.frame.plan === 'flyer' || visual.frame.plan === 'hoverBell'
    ? Math.sin(time * 2.2) * 0.12
    : 0;
  const recoveryReveal = state === 'recovery' && weakPointLocation === 'belly'
    ? THREE.MathUtils.smoothstep(stateProgress, 0, 0.28)
      * (1 - THREE.MathUtils.smoothstep(stateProgress, 0.86, 1))
    : 0;
  const attackLift = state === 'commit' && attackKind === 'pounce'
    ? Math.sin(stateProgress * Math.PI) * 1.25
    : state === 'commit' && attackKind === 'charge'
      ? Math.sin(stateProgress * Math.PI) * 0.12
      : 0;
  visual.root.position.y = hoverHeight + hover + attackLift + recoveryReveal * 0.28;

  let pitch = 0;
  let squashY = 1;
  if (state === 'telegraph') {
    squashY = 1 - Math.sin(stateProgress * Math.PI) * 0.12;
    pitch = -Math.sin(stateProgress * Math.PI) * 0.12;
  } else if (state === 'commit' || state === 'pounce') {
    pitch = -0.22;
  } else if (state === 'recovery') {
    pitch = weakPointLocation === 'belly'
      ? recoveryReveal * 0.52
      : Math.sin(stateProgress * Math.PI) * 0.1;
  }
  visual.frame.body.rotation.x = THREE.MathUtils.lerp(visual.frame.body.rotation.x, pitch, Math.min(1, dt * 9));
  visual.root.scale.y = genomeSafeScale(visual.root.scale.x * squashY);

  const eyePulse = 1.55 + Math.sin(time * (state === 'telegraph' ? 18 : 4.5)) * (state === 'telegraph' ? 0.7 : 0.22);
  visual.eye.lens.material.emissiveIntensity = weakPointExposed ? Math.max(eyePulse, 2) : eyePulse;
  visual.weapon.group.scale.setScalar(state === 'telegraph' ? 1 + Math.sin(stateProgress * Math.PI) * 0.12 : 1);
  visual.materials.emissive.emissiveIntensity = state === 'telegraph' ? 1.15 : 0.65;

  setReaverbotDefenseVisualActive(visual, defenseActive, defenseActive ? 0 : 1);
  setReaverbotWeakPointExposed(visual, weakPointExposed);
}

function genomeSafeScale(value) {
  return Number.isFinite(value) ? Math.max(0.1, value) : 1;
}
