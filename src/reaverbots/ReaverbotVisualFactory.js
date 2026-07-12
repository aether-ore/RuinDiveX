import * as THREE from 'three';
import { REAVERBOT_EYE_COLOR } from './ReaverbotCatalog.js';

const FORWARD = new THREE.Vector3(0, 0, 1);
const TRACTOR_BEAM_AXIS = new THREE.Vector3(0, -1, 0);
const TRACTOR_RING_AXIS = new THREE.Vector3(0, 0, 1);
const TRACTOR_TEMP_DIRECTION = new THREE.Vector3();
const CLAW_TEMP_WORLD = new THREE.Vector3();
const CLAW_TEMP_LOCAL = new THREE.Vector3();
const CLAW_TEMP_TARGET = new THREE.Vector3();
const ANIMAL_SIDE_MOUNT_WEAPONS = new Set([
  'clawArm',
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
    headAssembly: null,
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
    frame.headAssembly = neck;
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
  const anchor = id === 'tractorMagnet' ? frame.anchors.belly : frame.anchors.weapon;
  const weapon = group(root, `generatedWeapon_${id}`, anchor);
  if ((frame.plan === 'quadruped' || frame.plan === 'crawler')
    && ANIMAL_SIDE_MOUNT_WEAPONS.has(id)
    && Math.abs(weapon.position.x - frame.anchors.eye[0]) < 0.28) {
    weapon.position.x += id === 'clawArm' ? 1.16 : 0.52;
    weapon.position.y += id === 'clawArm' ? 0.04 : 0.16;
  } else if (id === 'clawArm') {
    weapon.position.x += Math.sign(weapon.position.x || 1) * 0.72;
    weapon.position.y -= 0.08;
  }
  if (id === 'clawArm') {
    weapon.position.x = Math.abs(weapon.position.x) * (genome.modules.weapon.mountSide ?? 1);
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = 'generatedReaverbotWeaponMuzzle';
  weapon.add(muzzle);

  const parts = {
    group: weapon,
    muzzle,
    clawSwingPivot: null,
    clawUpperBoom: null,
    clawElbowPivot: null,
    clawForearm: null,
    clawWristPivot: null,
    clawPalm: null,
    clawPalmAnchor: null,
    clawTalonPivots: [],
    clawReachSocket: null,
    clawArmAssembly: null,
    clawBrokenStump: null,
    clawMountSide: 1,
    clawBaseReach: 0,
    clawMaxReach: 0,
    jawUpperPivot: null,
    jawLowerPivot: null,
    tractorBeam: null,
    tractorBeamMaterial: null,
    tractorRings: [],
    tractorDirection: new THREE.Vector3(0, -1, 0),
  };

  if (id === 'ramHorn') {
    mesh(weapon, new THREE.ConeGeometry(0.22, 0.94, 6), materials.weapon, 'generatedRamHorn', [0, 0, 0.42], [Math.PI / 2, 0, 0]);
    muzzle.position.set(0, 0, 0.92);
  } else if (id === 'crusherJaw') {
    // A huge two-piece bear-trap mouth. Each half hinges at the skull instead
    // of being a small decorative box fixed in front of it.
    weapon.position.y -= 0.16;
    const hinge = mesh(
      weapon,
      new THREE.CylinderGeometry(0.19, 0.19, 1.58, 10),
      materials.dark,
      'generatedCrusherJawHinge',
      [0, 0, -0.02],
      [0, 0, Math.PI / 2],
    );
    hinge.userData.massiveWeaponPart = true;
    const upperPivot = group(weapon, 'generatedCrusherUpperJawPivot', [0, 0.04, 0]);
    const lowerPivot = group(weapon, 'generatedCrusherLowerJawPivot', [0, -0.04, 0]);
    const upper = group(upperPivot, 'generatedCrusherUpperJawBlade');
    const lower = group(lowerPivot, 'generatedCrusherLowerJawBlade');
    for (const side of [-1, 1]) {
      box(upper, materials.weapon, 'generatedCrusherUpperJawSideBlade', [0.28, 0.24, 1.62], [side * 0.6, 0.08, 0.8]);
      box(lower, materials.weapon, 'generatedCrusherLowerJawSideBlade', [0.28, 0.24, 1.62], [side * 0.6, -0.08, 0.8]);
    }
    box(upper, materials.weapon, 'generatedCrusherUpperJawHingeBlade', [1.48, 0.24, 0.24], [0, 0.08, 0.1]);
    box(lower, materials.weapon, 'generatedCrusherLowerJawHingeBlade', [1.48, 0.24, 0.24], [0, -0.08, 0.1]);
    upper.userData.massiveWeaponPart = true;
    lower.userData.massiveWeaponPart = true;
    box(upperPivot, materials.trim, 'generatedCrusherUpperRazorEdge', [1.62, 0.1, 0.16], [0, -0.1, 1.57]);
    box(lowerPivot, materials.trim, 'generatedCrusherLowerRazorEdge', [1.62, 0.1, 0.16], [0, 0.1, 1.57]);
    for (let tooth = 0; tooth < 7; tooth += 1) {
      // Preserve a narrow sightline through the open mouth to the mandatory
      // red eye instead of placing a tooth directly on the focal axis.
      if (tooth === 3) continue;
      const x = (tooth - 3) * 0.205;
      const upperTooth = mesh(
        upperPivot,
        new THREE.ConeGeometry(0.085, 0.39, 5),
        materials.trim,
        'generatedCrusherUpperRazorTooth',
        [x, -0.19, 1.38 - Math.abs(tooth - 3) * 0.025],
        [0, 0, Math.PI],
      );
      const lowerTooth = mesh(
        lowerPivot,
        new THREE.ConeGeometry(0.085, 0.39, 5),
        materials.trim,
        'generatedCrusherLowerRazorTooth',
        [x, 0.19, 1.31 + Math.abs(tooth - 3) * 0.025],
      );
      upperTooth.userData.razorJawTooth = true;
      lowerTooth.userData.razorJawTooth = true;
    }
    upperPivot.rotation.x = -0.46;
    lowerPivot.rotation.x = 0.46;
    muzzle.position.set(0, -0.02, 1.72);
    weapon.userData.jawUpper = upper;
    weapon.userData.jawLower = lower;
    weapon.userData.jawUpperPivot = upperPivot;
    weapon.userData.jawLowerPivot = lowerPivot;
    parts.jawUpperPivot = upperPivot;
    parts.jawLowerPivot = lowerPivot;
  } else if (id === 'clawArm') {
    // A genuine two-link constructor boom rather than a single rigid club.
    // The shoulder authors the broad sweep while the elbow folds for the
    // warning and then straightens so the talons reach MegaMan's lane.
    const swingPivot = group(weapon, 'generatedMassiveClawSwingPivot');
    swingPivot.userData.clawRigRole = 'shoulderSweep';
    const shoulder = mesh(
      swingPivot,
      new THREE.SphereGeometry(0.43, 10, 7),
      materials.dark,
      'generatedConstructorClawShoulderBearing',
      [0, 0, 0.02],
    );
    shoulder.userData.massiveWeaponPart = true;
    box(swingPivot, materials.weapon, 'generatedConstructorClawShoulderCradle', [0.92, 0.68, 0.62], [0, 0, 0.18]);

    const upperBoom = group(swingPivot, 'generatedConstructorClawUpperBoomPivot', [0, 0.02, 0.2]);
    upperBoom.rotation.x = -0.1;
    upperBoom.userData.clawRigRole = 'upperBoom';
    const upperBoomBeam = box(
      upperBoom,
      materials.weapon,
      'generatedConstructorClawUpperBoom',
      [0.72, 0.62, 1.52],
      [0, 0, 0.76],
    );
    upperBoomBeam.userData.massiveWeaponPart = true;
    for (const side of [-1, 1]) {
      box(
        upperBoom,
        materials.trim,
        'generatedConstructorClawUpperBoomRazorRail',
        [0.1, 0.72, 1.38],
        [side * 0.35, 0, 0.78],
      );
      taperedColumn(
        upperBoom,
        materials.dark,
        'generatedConstructorClawHydraulicRam',
        0.065,
        0.09,
        1.1,
        [side * 0.25, 0.36, 0.92],
        7,
        [Math.PI / 2, 0, 0],
      );
    }

    const elbowPivot = group(upperBoom, 'generatedConstructorClawElbowPivot', [0, 0, 1.5]);
    elbowPivot.rotation.x = 0.42;
    elbowPivot.userData.clawRigRole = 'extensionHinge';
    const elbowHinge = mesh(
      elbowPivot,
      new THREE.CylinderGeometry(0.31, 0.31, 0.98, 10),
      materials.dark,
      'generatedConstructorClawElbowHinge',
      [0, 0, 0],
      [0, 0, Math.PI / 2],
    );
    elbowHinge.userData.massiveWeaponPart = true;

    const forearm = box(
      elbowPivot,
      materials.weapon,
      'generatedConstructorClawForearm',
      [0.58, 0.52, 1.92],
      [0, 0, 0.96],
    );
    forearm.userData.massiveWeaponPart = true;
    box(elbowPivot, materials.dark, 'generatedConstructorClawForearmSpine', [0.22, 0.62, 1.68], [0, 0.02, 1]);
    for (const side of [-1, 1]) {
      box(
        elbowPivot,
        materials.trim,
        'generatedConstructorClawForearmRazorRail',
        [0.09, 0.58, 1.72],
        [side * 0.29, 0, 1],
      );
    }

    // The hand has its own wrist so the arm may stretch sideways or overhead
    // while the open palm (and its counterplay target) continues to face the
    // player.  Keeping the palm target below this node also gives gameplay a
    // stable world-space hit anchor throughout every pose.
    const wristPivot = group(elbowPivot, 'generatedConstructorClawWristPivot', [0, 0, 2.08]);
    wristPivot.userData.clawRigRole = 'palmFacingWrist';
    const palm = box(
      wristPivot,
      materials.weapon,
      'generatedConstructorClawPalm',
      [1.32, 0.6, 0.76],
      [0, 0, 0],
    );
    palm.userData.massiveWeaponPart = true;
    palm.userData.breakableWeaponPart = 'clawArm';
    const palmAnchor = group(wristPivot, 'generatedClawPalmWeakPointAnchor', [0, 0, 0.43]);
    palmAnchor.userData.clawRigRole = 'palmWeakPointAnchor';
    const talonPivots = [];
    const clawMountSide = Math.sign(genome.modules.weapon.mountSide || 1);
    for (const side of [-1, 0, 1]) {
      const talonPivot = group(wristPivot, 'generatedConstructorClawTalonPivot', [side * 0.43, -0.03, 0.22]);
      // Fan the blades toward the mounted side. A symmetric inner talon on
      // the old oversized claw could point back across the centerline and
      // eclipse the red eye during a vertical wind-up.
      const talonYaw = clawMountSide * 0.2 + side * 0.06;
      talonPivot.rotation.y = talonYaw;
      talonPivot.userData.clawRigRole = 'razorTalonHinge';
      talonPivot.userData.baseYaw = talonYaw;
      addJoint(talonPivot, materials, 'generatedConstructorClawTalon', [0, 0, 0], 0.15);
      const talonRoot = box(
        talonPivot,
        materials.trim,
        'generatedConstructorClawTalonRootBlade',
        [0.24, 0.22, 0.72],
        [side * 0.05, 0, 0.32],
        [0, clawMountSide * 0.08 + side * 0.04, side * -0.08],
      );
      talonRoot.userData.massiveWeaponPart = true;
      const talonTip = mesh(
        talonPivot,
        new THREE.ConeGeometry(0.16, 1.22, 5),
        materials.trim,
        'generatedConstructorClawRazorTalon',
        [side * 0.13, -0.06, 0.96],
        [Math.PI / 2, clawMountSide * 0.2 + side * 0.04, side * 0.13],
      );
      talonTip.userData.massiveWeaponPart = true;
      talonTip.userData.razorClawTalon = true;
      talonPivots.push(talonPivot);
    }

    const reachSocket = group(wristPivot, 'generatedConstructorClawReachSocket', [0, -0.05, 1.4]);
    reachSocket.userData.clawRigRole = 'impactSocket';
    muzzle.position.set(0, 0, 0);
    reachSocket.add(muzzle);

    // When the weapon is broken the articulated assembly disappears, but a
    // chunky fractured shoulder socket remains so the loss reads at distance.
    const brokenStump = group(weapon, 'generatedDestroyedClawShoulderStump', [0, 0, 0.08]);
    const stumpSocket = mesh(
      brokenStump,
      new THREE.CylinderGeometry(0.38, 0.46, 0.42, 8),
      materials.dark,
      'generatedDestroyedClawSocket',
      [0, 0, 0],
      [0, 0, Math.PI / 2],
    );
    stumpSocket.userData.destroyedWeaponRemnant = true;
    for (let index = -1; index <= 1; index += 1) {
      const shard = mesh(
        brokenStump,
        new THREE.ConeGeometry(0.1, 0.38 + Math.abs(index) * 0.08, 5),
        materials.trim,
        'generatedDestroyedClawJaggedShard',
        [index * 0.21, 0.02, 0.28 + Math.abs(index) * 0.04],
        [Math.PI / 2, 0, index * 0.18],
      );
      shard.userData.destroyedWeaponRemnant = true;
    }
    brokenStump.visible = false;
    swingPivot.userData.breakableWeaponPart = 'clawArm';
    weapon.userData.clawRig = {
      articulated: true,
      baseReach: genome.modules.weapon.baseReach ?? 2.95,
      maxReach: genome.modules.weapon.extendedReach ?? 4.55,
      segmentCount: 2,
      palmCounter: true,
    };
    weapon.userData.clawBasePosition = weapon.position.clone();
    parts.clawSwingPivot = swingPivot;
    parts.clawUpperBoom = upperBoom;
    parts.clawElbowPivot = elbowPivot;
    parts.clawForearm = forearm;
    parts.clawWristPivot = wristPivot;
    parts.clawPalm = palm;
    parts.clawPalmAnchor = palmAnchor;
    parts.clawTalonPivots = talonPivots;
    parts.clawReachSocket = reachSocket;
    parts.clawArmAssembly = swingPivot;
    parts.clawBrokenStump = brokenStump;
    parts.clawMountSide = clawMountSide;
    parts.clawBaseReach = weapon.userData.clawRig.baseReach;
    parts.clawMaxReach = weapon.userData.clawRig.maxReach;
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
  } else if (id === 'tractorMagnet') {
    // A readable horseshoe magnet mounted beneath the flyer. The widening
    // additive cone remains hidden until an enemy is being acquired/carried.
    weapon.position.x = 0;
    weapon.position.z = 0;
    const magnet = group(weapon, 'generatedTractorHorseshoeMagnet', [0, -0.1, 0]);
    mesh(
      magnet,
      new THREE.TorusGeometry(0.52, 0.14, 8, 20, Math.PI),
      materials.weapon,
      'generatedTractorMagnetArch',
      [0, 0, 0],
      [0, 0, 0],
    );
    for (const side of [-1, 1]) {
      box(magnet, materials.weapon, 'generatedTractorMagnetProng', [0.28, 0.75, 0.3], [side * 0.52, -0.36, 0]);
      box(magnet, side < 0 ? materials.emissive : materials.trim, 'generatedTractorMagnetPole', [0.34, 0.22, 0.36], [side * 0.52, -0.78, 0]);
    }
    for (let ringIndex = 0; ringIndex < 3; ringIndex += 1) {
      const ringMaterial = materials.emissive.clone();
      ringMaterial.name = `material_generatedTractorRing${ringIndex}`;
      ringMaterial.transparent = true;
      ringMaterial.opacity = 0;
      ringMaterial.depthWrite = false;
      const ring = mesh(
        weapon,
        new THREE.TorusGeometry(0.3 + ringIndex * 0.13, 0.025, 5, 18),
        ringMaterial,
        'generatedTractorFieldRing',
        [0, -1.0 - ringIndex * 0.48, 0],
        [Math.PI / 2, 0, 0],
      );
      ring.visible = false;
      parts.tractorRings.push(ring);
    }
    const beamMaterial = new THREE.MeshBasicMaterial({
      color: genome.palette.emissive,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    beamMaterial.name = 'material_generatedTractorBeam';
    const beam = mesh(
      weapon,
      new THREE.ConeGeometry(0.9, 3.4, 18, 1, true),
      beamMaterial,
      'generatedTractorBeam',
      [0, -2.5, 0],
    );
    beam.visible = false;
    muzzle.position.set(0, -0.92, 0);
    parts.tractorBeam = beam;
    parts.tractorBeamMaterial = beamMaterial;
  } else {
    mesh(weapon, new THREE.IcosahedronGeometry(0.34, 0), materials.emissive, 'generatedOverloadWeaponCore', [0, 0, 0.16]);
    mesh(weapon, new THREE.TorusGeometry(0.42, 0.045, 6, 16), materials.weapon, 'generatedOverloadCoreCage', [0, 0, 0.16], [Math.PI / 2, 0, 0]);
    muzzle.position.set(0, 0, 0.45);
  }

  return parts;
}

function createDefense(root, genome, frame, materials) {
  const definition = genome.modules.defense;
  if (!definition) {
    // Claw carriers guard with their weapon and intentionally have no authored
    // defense module. Return the usual shape so animation/UI callers remain
    // simple, but keep the wrapper completely free of defensive geometry.
    const defense = group(root, 'generatedDefense_none', frame.anchors.defense);
    const guardNormal = new THREE.Object3D();
    guardNormal.name = 'generatedDefenseGuardNormal';
    defense.add(guardNormal);
    defense.userData.defenseId = null;
    defense.userData.emptyDefenseWrapper = true;
    defense.userData.basePosition = defense.position.clone();
    return {
      group: defense,
      shell: null,
      shutters: [],
      plates: [],
      guardNormal,
      primaryPlate: null,
    };
  }

  const id = definition.id;
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
    anchor[2] += id === 'directionalShield' ? 0.5 : 0.44;
  } else if (id === 'guardArms') {
    anchor = [...frame.anchors.center];
    anchor[2] += 0.6;
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

function createWeakPoint(root, genome, frame, materials, eye, defense, weapon) {
  const definition = genome.modules.weakPoint;
  if (definition.location === 'eye') {
    eye.lens.userData.weakPoint = true;
    eye.lens.userData.weakPointId = definition.id;
    return { group: eye.group, core: eye.lens, socket: eye.socket, sharedWithEye: true };
  }

  if (definition.id === 'clawPalm' || definition.location === 'clawPalm') {
    const anchor = weapon.clawPalmAnchor;
    if (!anchor) {
      throw new Error('clawPalm weak point requires an articulated claw palm anchor');
    }
    const radius = definition.radius ?? 0.3;
    const weakPoint = group(anchor, `generatedWeakPoint_${definition.id}`);
    weakPoint.userData.clawPalmWeakPoint = true;
    const socket = mesh(
      weakPoint,
      new THREE.CylinderGeometry(radius * 1.3, radius * 1.42, 0.13, 12),
      materials.eyeSocket,
      'generatedClawPalmEyeSocket',
      [0, 0, 0],
      [Math.PI / 2, 0, 0],
    );
    const palmEyeMaterial = materials.eye.clone();
    palmEyeMaterial.name = 'material_generatedClawPalmRedEye';
    const core = mesh(
      weakPoint,
      new THREE.SphereGeometry(radius, 12, 8),
      palmEyeMaterial,
      'generatedClawPalmRedEye',
      [0, 0, 0.075],
      null,
      [1, 1, 0.42],
    );
    core.userData.weakPoint = true;
    core.userData.weakPointId = definition.id;
    core.userData.reaverbotEye = true;
    core.userData.clawPalmEye = true;
    core.userData.dominantFocalPoint = false;
    core.userData.exposed = false;
    mesh(
      weakPoint,
      new THREE.TorusGeometry(radius * 1.16, radius * 0.09, 5, 12),
      materials.trim,
      'generatedClawPalmEyeRing',
      [0, 0, 0.11],
    );
    weakPoint.visible = false;
    return {
      group: weakPoint,
      core,
      socket,
      sharedWithEye: false,
      palmMounted: true,
    };
  }

  const linkedToRotor = definition.location === 'rotorOpposite'
    && genome.modules.defense?.id === 'rotatingPlates';
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

function markDecorativeMeleeArmor(object, kind) {
  object.userData.decorativeArmor = true;
  object.userData.gameplayDefense = false;
  object.userData.meleeSilhouetteKind = kind;
  return object;
}

function createMeleeSilhouetteArmor(root, genome, frame, materials) {
  const enabled = genome.modules.weapon.tags.includes('melee');
  const parts = {
    enabled,
    group: null,
    plates: [],
    sidePlates: [],
    topPlates: [],
    spikes: [],
  };
  if (!enabled) return parts;

  const center = frame.anchors.center;
  const sideExtent = Math.max(0.46, Math.abs(frame.anchors.side[0] - center[0]));
  const animal = frame.plan === 'quadruped' || frame.plan === 'crawler';
  const upright = frame.plan === 'biped' || frame.plan === 'lowBiped';
  const compact = frame.plan === 'hopper' || frame.plan === 'hoverBell';
  const lowUpright = frame.plan === 'lowBiped';
  const armor = group(root, 'generatedMeleeSilhouetteArmor', center);
  markDecorativeMeleeArmor(armor, 'assembly');
  armor.userData.authoredDefenseId = null;
  armor.userData.keepsEyeSightlineClear = true;
  parts.group = armor;

  const sidePlateSize = animal
    ? [0.2, 0.52, 1.08]
    : upright
      ? [0.2, lowUpright ? 0.66 : 0.82, 0.62]
      : compact
        ? [0.18, 0.56, 0.74]
        : [0.2, 0.66, 0.72];
  const sidePlateX = sideExtent + (animal ? 0.14 : 0.12);
  const sidePlateY = animal ? 0.02 : upright ? -0.02 : -0.04;
  const sidePlateZ = animal ? -0.12 : -0.08;
  const topPlateY = animal ? 0.43 : upright ? (lowUpright ? 0.38 : 0.5) : 0.38;
  const topPlateSize = animal
    ? [0.38, 0.16, 0.92]
    : upright
      ? [0.48, 0.17, 0.56]
      : [0.4, 0.16, 0.62];
  const topPlateX = Math.max(0.24, sideExtent * (animal ? 0.48 : 0.58));

  for (const side of [-1, 1]) {
    const sidePlate = box(
      armor,
      materials.primary,
      'generatedMeleeDecorativeSidePlate',
      sidePlateSize,
      [side * sidePlateX, sidePlateY, sidePlateZ],
      [0, side * 0.08, side * (animal ? 0.04 : 0.08)],
    );
    markDecorativeMeleeArmor(sidePlate, 'sidePlate');
    sidePlate.userData.decorativeSidePlate = true;
    sidePlate.userData.guardSide = side;
    parts.plates.push(sidePlate);
    parts.sidePlates.push(sidePlate);

    const sideInset = box(
      sidePlate,
      materials.trim,
      'generatedMeleeDecorativeSidePlateInset',
      [0.035, sidePlateSize[1] * 0.62, sidePlateSize[2] * 0.7],
      [side * (sidePlateSize[0] * 0.56), 0, 0.02],
    );
    markDecorativeMeleeArmor(sideInset, 'sidePlateInset');

    const topPlate = box(
      armor,
      materials.secondary,
      animal ? 'generatedMeleeDorsalArmorPlate' : 'generatedMeleeShoulderArmorPlate',
      topPlateSize,
      [side * topPlateX, topPlateY, animal ? -0.14 : -0.08],
      [0, side * 0.05, side * 0.08],
    );
    markDecorativeMeleeArmor(topPlate, animal ? 'dorsalPlate' : 'shoulderPlate');
    topPlate.userData.guardSide = side;
    parts.plates.push(topPlate);
    parts.topPlates.push(topPlate);

    // Paired flank spikes make the close-range threat readable in silhouette.
    // They sit above the leg-joint band and behind front-side weak points.
    for (const spikeOffset of [-0.2, 0.2]) {
      const length = 0.52 + (genome.body.proportions.spikeCount % 2) * 0.07;
      const spike = mesh(
        armor,
        new THREE.ConeGeometry(0.11, length, 5),
        materials.trim,
        'generatedMeleeFlankSpike',
        [
          side * (sidePlateX + sidePlateSize[0] * 0.5 + length * 0.34),
          sidePlateY + (animal ? 0.08 : 0.1),
          sidePlateZ + spikeOffset,
        ],
        [0, 0, side * -Math.PI / 2],
      );
      markDecorativeMeleeArmor(spike, 'flankSpike');
      spike.userData.contactDamage = false;
      parts.spikes.push(spike);
    }

    // Dorsal/shoulder spikes stay laterally offset so the single ruby eye
    // remains the unobstructed focal point from the standard combat camera.
    if (genome.body.proportions.spikeCount >= 2) {
      const dorsalLength = animal ? 0.56 : 0.48;
      const dorsalSpike = mesh(
        armor,
        new THREE.ConeGeometry(0.105, dorsalLength, 5),
        materials.trim,
        animal ? 'generatedMeleeDorsalSpike' : 'generatedMeleeShoulderSpike',
        [side * topPlateX, topPlateY + topPlateSize[1] * 0.5 + dorsalLength * 0.38, animal ? -0.18 : -0.1],
      );
      markDecorativeMeleeArmor(dorsalSpike, animal ? 'dorsalSpike' : 'shoulderSpike');
      dorsalSpike.userData.contactDamage = false;
      parts.spikes.push(dorsalSpike);
    }
  }

  armor.userData.plateCount = parts.plates.length;
  armor.userData.spikeCount = parts.spikes.length;
  return parts;
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
  if (genome.modules.weapon.id === 'crusherJaw' && frame.headAssembly) {
    // The eye and bear-trap mouth are the face. Attaching them to the animal's
    // neck assembly makes each dog-like head tilt move the whole readable face.
    visualRoot.updateMatrixWorld(true);
    frame.headAssembly.attach(eye.group);
    frame.headAssembly.attach(weapon.group);
  }
  const defense = createDefense(visualRoot, genome, frame, materials);
  if (genome.modules.weapon.id === 'rotorBlade') {
    defense.group.add(weapon.group);
    weapon.group.position.set(0, 0, 0);
    weapon.group.rotation.set(0, 0, 0);
    weapon.group.userData.linkedDefenseId = 'rotatingPlates';
  }
  const weakPoint = createWeakPoint(visualRoot, genome, frame, materials, eye, defense, weapon);
  const meleeArmor = createMeleeSilhouetteArmor(visualRoot, genome, frame, materials);
  addSurfaceGrammar(visualRoot, genome, frame, materials);
  visualRoot.userData.meleeSilhouetteArmored = meleeArmor.enabled;
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
    meleeArmor,
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
  const actuallyExposed = exposed && !visual.weapon.clawDestroyed;
  core.userData.exposed = actuallyExposed;
  core.material.emissiveIntensity = actuallyExposed ? (visual.weakPoint.sharedWithEye ? 2.1 : 1.75) : (visual.weakPoint.sharedWithEye ? 1.45 : 0.18);
  if (!visual.weakPoint.sharedWithEye) {
    core.userData.baseWeakPointScale ??= core.scale.clone();
    core.scale.copy(core.userData.baseWeakPointScale).multiplyScalar(actuallyExposed ? 1.08 : 0.82);
    socket.material.emissive?.set(actuallyExposed ? visual.materials.emissive.color : 0x000000);
    socket.material.emissiveIntensity = actuallyExposed ? 0.3 : 0;
  }
  if (visual.weakPoint.palmMounted) {
    // The palm eye is physically present throughout the rig, but the talons
    // conceal it outside a counterable wind-up.
    visual.weakPoint.group.visible = actuallyExposed;
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
  comboOrientation = 'horizontal',
  comboMountSide = 1,
  comboInitialDirection = 1,
  clawExtension = null,
  clawAttackVariant = null,
  clawGuardProgress = 0,
  clawRecoilProgress = 0,
  clawDestroyedProgress = 0,
  clawSpinProgress = 0,
  defenseActive = false,
  weakPointExposed = false,
  weakPointLocation = null,
  tractorBeamActive = false,
  tractorBeamIntensity = 0,
  tractorBeamLength = 3.4,
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

  const comboCycle = Math.min(2, Math.floor(stateProgress * 3));
  const comboLocalProgress = stateProgress >= 1
    ? 1
    : (stateProgress * 3) - comboCycle;
  let clawWarning = 0;
  let clawRecoilChassisAmount = 0;
  if (visual.weapon.clawSwingPivot) {
    const weapon = visual.weapon;
    const pivot = visual.weapon.clawSwingPivot;
    const elbow = visual.weapon.clawElbowPivot;
    const wrist = visual.weapon.clawWristPivot;
    const mountSide = Math.sign(visual.weapon.clawMountSide || comboMountSide || 1);
    const progress = THREE.MathUtils.clamp(stateProgress, 0, 1);
    const guardProgress = THREE.MathUtils.clamp(clawGuardProgress, 0, 1);
    const recoilProgress = THREE.MathUtils.clamp(clawRecoilProgress, 0, 1);
    const recoilAmount = Math.sin(recoilProgress * Math.PI);
    clawRecoilChassisAmount = recoilAmount;
    const destroyedProgress = THREE.MathUtils.clamp(clawDestroyedProgress, 0, 1);
    const vertical = clawAttackVariant === 'verticalSlam'
      || clawAttackVariant === 'vertical'
      || (!clawAttackVariant && comboOrientation === 'vertical');

    weapon.clawDestroyed = destroyedProgress > 0.001;
    if (weapon.clawArmAssembly) {
      weapon.clawArmAssembly.visible = destroyedProgress < 0.76;
      weapon.clawArmAssembly.position.y = -destroyedProgress * 1.35;
      weapon.clawArmAssembly.rotation.z = -mountSide * destroyedProgress * 1.12;
      weapon.clawArmAssembly.scale.setScalar(Math.max(0.12, 1 - destroyedProgress * 0.38));
    }
    if (weapon.clawBrokenStump) {
      weapon.clawBrokenStump.visible = destroyedProgress > 0.12;
      weapon.clawBrokenStump.scale.setScalar(THREE.MathUtils.smoothstep(destroyedProgress, 0.08, 0.42));
    }

    // Only the visual child rotates; logical facing and attack vectors remain
    // untouched. At the end of a sweep the modulo snaps back to the identical
    // facing so recovery never inherits a full Euler revolution.
    visual.root.userData.baseClawVisualYaw ??= visual.root.rotation.y;
    visual.root.userData.baseClawVisualPitch ??= visual.root.rotation.x;
    visual.root.userData.baseClawVisualRoll ??= visual.root.rotation.z;
    const requestedSpin = state === 'commit' && !vertical
      ? THREE.MathUtils.clamp(clawSpinProgress || progress, 0, 1)
      : 0;
    const visibleSpin = requestedSpin >= 0.999 ? 0 : requestedSpin * Math.PI * 2 * mountSide;
    visual.root.rotation.y = visual.root.userData.baseClawVisualYaw + visibleSpin;

    const basePosition = weapon.group.userData.clawBasePosition;
    if (basePosition) weapon.group.position.copy(basePosition);

    let targetX = 0;
    let targetY = 0;
    let targetZ = 0;
    let elbowAngle = 0.42;
    let elbowYaw = 0;
    let wristX = 0;
    let wristY = 0;
    let talonOpen = 0.04;

    if (guardProgress > 0) {
      const brace = THREE.MathUtils.smoothstep(guardProgress, 0, 1);
      targetX = -0.18 * brace;
      targetY = -mountSide * 0.68 * brace;
      targetZ = mountSide * 0.18 * brace;
      elbowAngle = THREE.MathUtils.lerp(0.42, 0.68, brace);
      elbowYaw = mountSide * 0.72 * brace;
      wristY = mountSide * 0.12 * brace;
      talonOpen = THREE.MathUtils.lerp(0.04, 0.22, brace);
    } else if (state === 'telegraph') {
      const cock = THREE.MathUtils.smoothstep(progress, 0.06, 0.88);
      const urgency = THREE.MathUtils.smoothstep(progress, 0.08, 1);
      if (vertical) {
        targetX = -1.48 * cock;
        targetZ = -0.08 * cock;
        wristX = 1.48 * cock;
      } else {
        targetY = mountSide * 1.48 * cock;
        targetZ = -mountSide * 0.2 * cock;
        wristY = -mountSide * 1.48 * cock;
      }
      elbowAngle = THREE.MathUtils.lerp(0.42, 0.055, cock);
      talonOpen = THREE.MathUtils.lerp(0.04, 0.62, cock);
      const blinkFrequency = 8 + urgency * 28;
      clawWarning = (0.45 + urgency * 2.35)
        * THREE.MathUtils.smoothstep(Math.sin(time * blinkFrequency) * 0.5 + 0.5, 0.18, 0.75);
    } else if (state === 'commit') {
      const strike = THREE.MathUtils.smoothstep(progress, 0.04, 0.78);
      elbowAngle = 0.035;
      if (vertical) {
        targetX = THREE.MathUtils.lerp(-1.48, 0.72, strike);
        wristX = THREE.MathUtils.lerp(1.48, 0.04, THREE.MathUtils.smoothstep(progress, 0.06, 0.68));
        talonOpen = THREE.MathUtils.lerp(0.62, 0.28, THREE.MathUtils.smoothstep(progress, 0.52, 0.92));
      } else {
        // The arm stays exaggeratedly long as the complete visual chassis
        // swivels through its circular slash.
        targetY = mountSide * (1.48 - Math.sin(progress * Math.PI) * 0.2);
        targetZ = -mountSide * 0.2;
        wristY = -targetY;
        talonOpen = THREE.MathUtils.lerp(0.62, 0.18, THREE.MathUtils.smoothstep(progress, 0.64, 0.95));
      }
    } else if (state === 'recovery') {
      const settle = 1 - THREE.MathUtils.smoothstep(progress, 0.05, 0.9);
      targetX = vertical ? 0.38 * settle : 0;
      targetY = vertical ? 0 : mountSide * 0.42 * settle;
      elbowAngle = THREE.MathUtils.lerp(0.5, 0.42, 1 - settle);
      talonOpen = THREE.MathUtils.lerp(0.18, 0.04, 1 - settle);
    }

    if (recoilAmount > 0.001) {
      targetX = -0.48 * recoilAmount;
      targetY = -mountSide * 0.72 * recoilAmount;
      targetZ = mountSide * 0.76 * recoilAmount;
      elbowAngle = THREE.MathUtils.lerp(elbowAngle, 0.92, recoilAmount);
      elbowYaw = -mountSide * 0.24 * recoilAmount;
      wristX = 0.22 * recoilAmount;
      wristY = mountSide * 0.58 * recoilAmount;
      talonOpen = Math.max(talonOpen, 0.68 * recoilAmount);
    }

    const response = Math.min(1, dt * (state === 'commit' ? 28 : 13));
    pivot.rotation.x = THREE.MathUtils.lerp(pivot.rotation.x, targetX, response);
    pivot.rotation.y = THREE.MathUtils.lerp(pivot.rotation.y, targetY, response);
    pivot.rotation.z = THREE.MathUtils.lerp(pivot.rotation.z, targetZ, response);

    if (elbow) {
      if (Number.isFinite(clawExtension)) {
        elbowAngle = THREE.MathUtils.lerp(
          0.78,
          0.035,
          THREE.MathUtils.clamp(clawExtension, 0, 1),
        );
      }
      const hingeResponse = Math.min(1, dt * (state === 'commit' ? 24 : 12));
      elbow.rotation.x = THREE.MathUtils.lerp(elbow.rotation.x, elbowAngle, hingeResponse);
      elbow.rotation.y = THREE.MathUtils.lerp(elbow.rotation.y, elbowYaw, hingeResponse);
      if (wrist) {
        wrist.rotation.x = THREE.MathUtils.lerp(wrist.rotation.x, wristX, hingeResponse);
        wrist.rotation.y = THREE.MathUtils.lerp(wrist.rotation.y, wristY, hingeResponse);
        wrist.rotation.z = THREE.MathUtils.lerp(wrist.rotation.z, 0, hingeResponse);
      }
      for (const talon of visual.weapon.clawTalonPivots) {
        const fanDirection = Math.sign(talon.position.x);
        talon.rotation.x = THREE.MathUtils.lerp(talon.rotation.x, -talonOpen, hingeResponse);
        talon.rotation.y = THREE.MathUtils.lerp(
          talon.rotation.y,
          (talon.userData.baseYaw ?? 0) + fanDirection * talonOpen * 0.58,
          hingeResponse,
        );
      }
      if (visual.weapon.clawReachSocket) {
        visual.weapon.clawReachSocket.userData.extension = THREE.MathUtils.clamp(
          (0.78 - elbow.rotation.x) / (0.78 - 0.035),
          0,
          1,
        );
      }
    }

    if (guardProgress > 0.001 && weapon.clawPalmAnchor) {
      // Translate the posed arm just enough that its actual palm—not an
      // invisible substitute—sits in front of the torso while bracing.
      visual.root.updateMatrixWorld(true);
      weapon.clawPalmAnchor.getWorldPosition(CLAW_TEMP_WORLD);
      CLAW_TEMP_LOCAL.copy(CLAW_TEMP_WORLD);
      visual.root.worldToLocal(CLAW_TEMP_LOCAL);
      CLAW_TEMP_TARGET.set(
        visual.frame.anchors.center[0],
        visual.frame.anchors.center[1] + 0.08,
        visual.frame.anchors.center[2] + 0.58,
      );
      weapon.group.position.addScaledVector(
        CLAW_TEMP_TARGET.sub(CLAW_TEMP_LOCAL),
        THREE.MathUtils.smoothstep(guardProgress, 0, 1),
      );
    }

    visual.materials.weapon.emissive.setHex(clawWarning > 0.01 ? 0xff1010 : 0x000000);
    visual.materials.weapon.emissiveIntensity = clawWarning;
  }

  let jawWarning = 0;
  if (visual.weapon.jawUpperPivot && visual.weapon.jawLowerPivot) {
    let openness = 0.46;
    if (state === 'telegraph') {
      openness = THREE.MathUtils.lerp(0.46, 1, THREE.MathUtils.smoothstep(stateProgress, 0.04, 0.68));
      const urgency = THREE.MathUtils.smoothstep(stateProgress, 0.12, 1);
      jawWarning = (0.35 + urgency * 1.8)
        * THREE.MathUtils.smoothstep(Math.sin(time * (10 + urgency * 18)) * 0.5 + 0.5, 0.2, 0.78);
    } else if (state === 'commit') {
      const snapProgress = THREE.MathUtils.smoothstep(comboLocalProgress, 0.57, 0.73);
      const reopenProgress = THREE.MathUtils.smoothstep(comboLocalProgress, 0.76, 1);
      openness = THREE.MathUtils.lerp(1, 0.035, snapProgress);
      openness = THREE.MathUtils.lerp(openness, comboCycle === 2 ? 0.25 : 0.88, reopenProgress);
      const preSnap = 1 - THREE.MathUtils.smoothstep(comboLocalProgress, 0.48, 0.64);
      jawWarning = preSnap * (0.45 + Math.max(0, Math.sin(time * 31)) * 2.4);
    } else if (state === 'recovery') {
      openness = THREE.MathUtils.lerp(0.25, 0.46, THREE.MathUtils.smoothstep(stateProgress, 0.05, 0.85));
    }
    const jawAngle = THREE.MathUtils.lerp(0.035, 0.92, openness);
    visual.weapon.jawUpperPivot.rotation.x = -jawAngle;
    visual.weapon.jawLowerPivot.rotation.x = jawAngle;
    const headTilt = state === 'commit'
      ? (comboCycle % 2 === 0 ? -1 : 1) * Math.sin(comboLocalProgress * Math.PI) * 0.24
      : 0;
    const jawHeadAssembly = visual.frame.headAssembly ?? visual.frame.head;
    jawHeadAssembly.rotation.z = THREE.MathUtils.lerp(
      jawHeadAssembly.rotation.z,
      headTilt,
      Math.min(1, dt * 15),
    );
  } else {
    const headAssembly = visual.frame.headAssembly ?? visual.frame.head;
    headAssembly.rotation.z = THREE.MathUtils.lerp(headAssembly.rotation.z, 0, Math.min(1, dt * 10));
  }

  if (visual.weapon.tractorBeam) {
    const intensity = tractorBeamActive ? THREE.MathUtils.clamp(tractorBeamIntensity, 0.08, 1) : 0;
    const length = THREE.MathUtils.clamp(tractorBeamLength, 1.1, 6.2);
    const direction = visual.weapon.tractorDirection.lengthSq() > 0.0001
      ? TRACTOR_TEMP_DIRECTION.copy(visual.weapon.tractorDirection).normalize()
      : TRACTOR_BEAM_AXIS;
    visual.weapon.tractorBeam.visible = tractorBeamActive;
    visual.weapon.tractorBeam.scale.y = length / 3.4;
    visual.weapon.tractorBeam.position.copy(visual.weapon.muzzle.position).addScaledVector(direction, length * 0.5);
    visual.weapon.tractorBeam.quaternion.setFromUnitVectors(TRACTOR_BEAM_AXIS, direction);
    visual.weapon.tractorBeamMaterial.opacity = intensity * (0.16 + Math.sin(time * 15) * 0.035);
    for (let index = 0; index < visual.weapon.tractorRings.length; index += 1) {
      const ring = visual.weapon.tractorRings[index];
      ring.visible = tractorBeamActive;
      const ringDistance = ((time * 1.65 + index / visual.weapon.tractorRings.length) % 1) * length;
      ring.position.copy(visual.weapon.muzzle.position).addScaledVector(direction, ringDistance);
      ring.quaternion.setFromUnitVectors(TRACTOR_RING_AXIS, direction);
      ring.scale.setScalar(0.72 + intensity * 0.35);
      ring.material.opacity = intensity * (0.35 + 0.22 * Math.sin(time * 11 + index));
    }
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
      : state === 'commit' && attackKind === 'jawCombo'
        ? Math.sin(comboLocalProgress * Math.PI) * 0.34
        : state === 'position' && attackKind === 'jawCombo' && moving
          ? Math.max(0, Math.sin(time * 6.2)) * 0.19
      : 0;
  visual.root.position.y = hoverHeight + hover + attackLift + recoveryReveal * 0.28;
  if (visual.weapon.clawSwingPivot) {
    // Palm counters knock the visible chassis off its feet while the enemy's
    // collision/navigation root remains fixed. The sine curve completes the
    // fall-and-rise within recoil and returns exactly to its authored pose.
    visual.root.rotation.x = (visual.root.userData.baseClawVisualPitch ?? 0)
      - clawRecoilChassisAmount * 0.68;
    visual.root.rotation.z = (visual.root.userData.baseClawVisualRoll ?? 0)
      - visual.weapon.clawMountSide * clawRecoilChassisAmount * 0.84;
    visual.root.position.y -= clawRecoilChassisAmount * 0.38;
  }

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
  if (visual.weapon.jawUpperPivot) {
    visual.materials.weapon.emissive.setHex(jawWarning > 0.01 ? 0xff1010 : 0x000000);
    visual.materials.weapon.emissiveIntensity = jawWarning;
  }

  setReaverbotDefenseVisualActive(visual, defenseActive, defenseActive ? 0 : 1);
  setReaverbotWeakPointExposed(visual, weakPointExposed);
  if (visual.weakPoint.palmMounted && visual.weakPoint.core.userData.exposed) {
    visual.weakPoint.core.material.emissiveIntensity = Math.max(
      visual.weakPoint.core.material.emissiveIntensity,
      1.8 + clawWarning,
    );
  }
}

function genomeSafeScale(value) {
  return Number.isFinite(value) ? Math.max(0.1, value) : 1;
}
