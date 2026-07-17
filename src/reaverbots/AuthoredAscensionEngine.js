import * as THREE from 'three';

const AUTHORED_HEIGHT = 6.25;
const tempScale = new THREE.Vector3();

function standard(name, color, options = {}) {
  const result = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.68,
    metalness: 0.54,
    flatShading: true,
    ...options,
  });
  result.name = name;
  return result;
}

function addMesh(parent, name, geometry, material, position = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addBox(parent, name, size, material, position) {
  return addMesh(parent, name, new THREE.BoxGeometry(...size), material, position);
}

function addCylinder(parent, name, radii, height, material, position, segments = 10) {
  return addMesh(
    parent,
    name,
    new THREE.CylinderGeometry(radii[0], radii[1], height, segments),
    material,
    position,
  );
}

function setTreeEmissive(root, intensity) {
  root?.traverse?.((object) => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material?.emissive) material.emissiveIntensity = intensity;
    }
  });
}

function createShrineTower(parent, x, z, height, materials, index) {
  const tower = new THREE.Group();
  tower.name = `authoredAscensionShrineTower_${index}`;
  tower.position.set(x, 5.08, z);
  addBox(tower, 'authoredAscensionShrineTowerBase', [0.46, 0.26, 0.46], materials.gold, [0, 0, 0]);
  addBox(tower, 'authoredAscensionShrineTowerBody', [0.34, height, 0.34], materials.primary, [0, height * 0.5 + 0.13, 0]);
  const roof = addMesh(tower, 'authoredAscensionShrineTowerRoof', new THREE.ConeGeometry(0.31, 0.42, 4), materials.trim, [0, height + 0.34, 0]);
  roof.rotation.y = Math.PI * 0.25;
  parent.add(tower);
  return tower;
}

function createArm(parent, side, materials) {
  const direction = side < 0 ? -1 : 1;
  const shoulder = new THREE.Group();
  shoulder.name = `authoredAscension${side < 0 ? 'Left' : 'Right'}ShoulderPivot`;
  shoulder.position.set(direction * 0.92, 4.65, 0);
  parent.add(shoulder);
  addCylinder(shoulder, 'authoredAscensionShoulderBearing', [0.24, 0.24], 0.34, materials.dark, [0, 0, 0], 12).rotation.z = Math.PI * 0.5;
  const upper = addBox(shoulder, 'authoredAscensionStabilizerUpperArm', [0.92, 0.23, 0.28], materials.secondary, [direction * 0.5, -0.12, 0]);
  upper.rotation.z = direction * -0.2;
  const elbow = new THREE.Group();
  elbow.name = `authoredAscension${side < 0 ? 'Left' : 'Right'}ElbowPivot`;
  elbow.position.set(direction * 0.96, -0.28, 0);
  shoulder.add(elbow);
  addCylinder(elbow, 'authoredAscensionElbowBearing', [0.18, 0.18], 0.28, materials.gold, [0, 0, 0], 10).rotation.z = Math.PI * 0.5;
  const forearm = addBox(elbow, 'authoredAscensionStabilizerForearm', [0.7, 0.2, 0.22], materials.primary, [direction * 0.38, -0.24, 0]);
  forearm.rotation.z = direction * -0.48;
  const hand = new THREE.Group();
  hand.name = 'authoredAscensionStabilizerHand';
  hand.position.set(direction * 0.76, -0.5, 0);
  elbow.add(hand);
  for (let index = -1; index <= 1; index += 1) {
    const finger = addBox(hand, 'authoredAscensionStabilizerFinger', [0.1, 0.34, 0.08], materials.trim, [direction * 0.04, -0.18, index * 0.11]);
    finger.rotation.z = direction * 0.18;
  }
  return { shoulder, elbow, hand };
}

function createClaw(parent, angle, materials, index) {
  const pivot = new THREE.Group();
  pivot.name = `authoredAscensionLandingClawPivot_${index}`;
  pivot.position.set(0, 0.34, 0);
  pivot.rotation.y = angle;
  parent.add(pivot);
  const toe = addBox(pivot, 'authoredAscensionLandingClawArmor', [0.62, 0.38, 1.48], materials.primary, [0, 0.05, 0.78]);
  toe.rotation.x = -0.12;
  const tip = addMesh(pivot, 'authoredAscensionLandingClawTip', new THREE.ConeGeometry(0.33, 0.8, 4), materials.trim, [0, 0.02, 1.55]);
  tip.rotation.x = Math.PI * 0.5;
  tip.rotation.y = Math.PI * 0.25;
  addBox(pivot, 'authoredAscensionLandingClawCircuitPlate', [0.42, 0.06, 0.72], materials.secondary, [0, 0.26, 0.72]);
  return pivot;
}

function createBooster(parent, side, materials) {
  const direction = side < 0 ? -1 : 1;
  const group = new THREE.Group();
  group.name = `authoredAscension${side < 0 ? 'Left' : 'Right'}Booster`;
  group.position.set(direction * 0.92, 1.05, 0.08);
  parent.add(group);
  addCylinder(group, 'authoredAscensionBoosterHousing', [0.34, 0.42], 1.35, materials.weapon, [0, 0.15, 0], 12);
  addCylinder(group, 'authoredAscensionBoosterNozzle', [0.27, 0.39], 0.38, materials.dark, [0, -0.72, 0], 12);
  const flameMaterial = new THREE.MeshBasicMaterial({
    color: 0xffdf9a,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  flameMaterial.name = `material_authoredAscensionBoosterFlame_${side}`;
  const flame = addMesh(group, 'authoredAscensionBoosterFlame', new THREE.ConeGeometry(0.23, 1.4, 8, 1, true), flameMaterial, [0, -1.55, 0]);
  flame.rotation.x = Math.PI;
  flame.visible = false;
  return { group, flame, flameMaterial };
}

function createSeal(parent, index, y, materials) {
  const group = new THREE.Group();
  group.name = `authoredAscensionCompressionSeal_${index}`;
  group.position.y = y;
  parent.add(group);
  const material = materials.seal.clone();
  material.name = `material_authoredAscensionCompressionSeal_${index}`;
  const ring = addMesh(group, 'authoredAscensionCompressionSealRing', new THREE.TorusGeometry(0.66, 0.1, 8, 28), material, [0, 0, 0]);
  ring.rotation.x = Math.PI * 0.5;
  const segments = [];
  for (let segment = 0; segment < 8; segment += 1) {
    const angle = segment / 8 * Math.PI * 2;
    const plate = addBox(group, 'authoredAscensionCompressionSealPlate', [0.23, 0.18, 0.08], material, [Math.cos(angle) * 0.66, 0, Math.sin(angle) * 0.66]);
    plate.rotation.y = -angle;
    segments.push(plate);
  }
  return { index, group, ring, segments, material };
}

export function createAuthoredAscensionEngineVisual(enemy) {
  const root = new THREE.Group();
  root.name = 'authoredAscensionEngineVisual';
  root.userData.authoredAscensionEngine = true;
  const authoredScale = Math.max(0.1, enemy.collisionHeight / AUTHORED_HEIGHT);
  root.scale.setScalar(authoredScale);

  const materials = {
    primary: standard('material_ascensionEnginePrimary', 0xa99d7e),
    secondary: standard('material_ascensionEngineSecondary', 0x344a3f, { metalness: 0.42 }),
    trim: standard('material_ascensionEngineTrim', 0xc29a4e, { roughness: 0.38, metalness: 0.82 }),
    dark: standard('material_ascensionEngineJoint', 0x17191b, { roughness: 0.5, metalness: 0.78 }),
    weapon: standard('material_ascensionEngineWeapon', 0x4d514d, { roughness: 0.44, metalness: 0.75 }),
    eye: standard('material_ascensionEngineEye', 0xff3153, { emissive: 0xff102f, emissiveIntensity: 2.3, roughness: 0.16, metalness: 0.12 }),
    seal: standard('material_ascensionEngineSeal', 0xff9b3d, { emissive: 0xff4a14, emissiveIntensity: 1.55, roughness: 0.25, metalness: 0.25 }),
  };

  const foot = new THREE.Group();
  foot.name = 'authoredAscensionEngineFoot';
  root.add(foot);
  addCylinder(foot, 'authoredAscensionCentralPogoPoint', [0.22, 0.42], 0.8, materials.dark, [0, 0.38, 0], 10);
  const claws = [0, Math.PI * 2 / 3, Math.PI * 4 / 3].map((angle, index) => createClaw(foot, angle, materials, index));

  const compressionPivot = new THREE.Group();
  compressionPivot.name = 'authoredAscensionCompressionStack';
  compressionPivot.position.y = 0.75;
  root.add(compressionPivot);
  addCylinder(compressionPivot, 'authoredAscensionTelescopingPiston', [0.38, 0.46], 3.25, materials.dark, [0, 1.62, 0], 12);
  for (let index = 0; index < 7; index += 1) {
    const collar = addMesh(
      compressionPivot,
      'authoredAscensionCompressionCollar',
      new THREE.TorusGeometry(0.52 + (index % 2) * 0.04, 0.095, 8, 24),
      index % 2 === 0 ? materials.trim : materials.weapon,
      [0, 0.28 + index * 0.46, 0],
    );
    collar.rotation.x = Math.PI * 0.5;
  }
  const seals = [0.68, 1.38, 2.08, 2.78].map((y, index) => createSeal(compressionPivot, index, y, materials));

  const upperAssembly = new THREE.Group();
  upperAssembly.name = 'authoredAscensionUpperAssembly';
  root.add(upperAssembly);
  const hip = new THREE.Group();
  hip.name = 'authoredAscensionHipShrine';
  hip.position.y = 3.75;
  upperAssembly.add(hip);
  addCylinder(hip, 'authoredAscensionHipArmorDrum', [0.92, 1.05], 0.9, materials.secondary, [0, 0.2, 0], 12);
  addMesh(hip, 'authoredAscensionHipGoldBand', new THREE.TorusGeometry(0.92, 0.1, 8, 30), materials.trim, [0, -0.08, 0]).rotation.x = Math.PI * 0.5;

  const torso = new THREE.Group();
  torso.name = 'authoredAscensionShrineTorso';
  upperAssembly.add(torso);
  addBox(torso, 'authoredAscensionTorsoCore', [1.75, 1.35, 1.3], materials.primary, [0, 4.72, 0]);
  addBox(torso, 'authoredAscensionTorsoCircuitPanel', [1.38, 0.54, 0.08], materials.secondary, [0, 4.82, 0.69]);
  addBox(torso, 'authoredAscensionTorsoCornice', [2.2, 0.22, 1.62], materials.trim, [0, 5.32, 0]);
  for (const [index, [x, z, height]] of [[-0.68, 0, 0.75], [0, -0.12, 1.02], [0.68, 0, 0.75]].entries()) {
    createShrineTower(torso, x, z, height, materials, index);
  }

  const eyeGroup = new THREE.Group();
  eyeGroup.name = 'authoredAscensionHipRubyEyeAnchor';
  eyeGroup.position.set(0, 4.68, 0.78);
  torso.add(eyeGroup);
  const eyeSocket = addCylinder(eyeGroup, 'authoredAscensionRubyEyeSocket', [0.53, 0.62], 0.24, materials.dark, [0, 0, 0], 12);
  eyeSocket.rotation.x = Math.PI * 0.5;
  const eye = addMesh(eyeGroup, 'authoredAscensionRubyEye', new THREE.IcosahedronGeometry(0.43, 2), materials.eye, [0, 0, 0.18]);

  const arms = [createArm(upperAssembly, -1, materials), createArm(upperAssembly, 1, materials)];
  const boosters = [createBooster(root, -1, materials), createBooster(root, 1, materials)];

  const muzzle = new THREE.Object3D();
  muzzle.name = 'authoredAscensionEngineMuzzle';
  muzzle.position.set(0, 4.45, 0.9);
  root.add(muzzle);

  const allMaterials = { ...materials, emissive: materials.seal, weakPoint: materials.seal };
  root.userData.authoredOwnedMaterials = new Set([
    ...Object.values(materials),
    ...seals.map((seal) => seal.material),
    ...boosters.map((booster) => booster.flameMaterial),
  ]);
  root.userData.authoredOwnedTextures = new Set();

  return {
    root,
    frame: { plan: 'authoredAscensionEngine', body: upperAssembly, gait: null },
    eye: { group: eyeGroup, socket: eyeSocket, lens: eye },
    weapon: { group: compressionPivot, muzzle, clawDestroyed: false },
    chargeModule: { group: root, nozzles: boosters.map((booster) => booster.group) },
    defense: { group: torso, shutters: [], plates: [], shell: null },
    weakPoint: { group: seals[0].group, core: seals[0].ring, socket: seals[0].group, sharedWithEye: false },
    materials: allMaterials,
    size: {
      x: 4.8 * authoredScale,
      y: 6.65 * authoredScale,
      z: 4.1 * authoredScale,
    },
    authoredModel: root,
    authoredUpperAssembly: upperAssembly,
    authoredCompressionPivot: compressionPivot,
    authoredClaws: claws,
    authoredArms: arms,
    authoredBoosters: boosters,
    authoredSeals: seals,
    authoredEye: eyeGroup,
    forward: new THREE.Vector3(0, 0, 1),
  };
}

export function animateAuthoredAscensionEngineVisual(visual, {
  time = 0,
  dt = 0,
  compression = 0,
  airborne = false,
  boosterPower = 0,
  landingImpact = 0,
  sweep = 0,
  activeSealIndex = null,
  brokenSeals = [],
  finalCharge = 0,
} = {}) {
  const alpha = Math.min(1, Math.max(0, dt) * 10);
  const clampedCompression = THREE.MathUtils.clamp(compression, 0, 1);
  visual.authoredUpperAssembly.position.y = THREE.MathUtils.lerp(
    visual.authoredUpperAssembly.position.y,
    -clampedCompression * 0.72 + Math.sin(time * 3.1) * (airborne ? 0.025 : 0.008),
    alpha,
  );
  tempScale.set(1, 1 - clampedCompression * 0.17, 1);
  visual.authoredCompressionPivot.scale.lerp(tempScale, alpha);
  for (const [index, claw] of (visual.authoredClaws ?? []).entries()) {
    const target = (index / 3) * Math.PI * 2 + (landingImpact > 0 ? Math.sin(time * 18 + index) * 0.035 : 0);
    claw.rotation.y = THREE.MathUtils.lerp(claw.rotation.y, target, alpha);
    claw.rotation.z = THREE.MathUtils.lerp(claw.rotation.z, landingImpact * (index === 1 ? -0.1 : 0.08), alpha);
  }
  for (const [index, arm] of (visual.authoredArms ?? []).entries()) {
    const direction = index === 0 ? -1 : 1;
    arm.shoulder.rotation.y = THREE.MathUtils.lerp(arm.shoulder.rotation.y, direction * sweep * 1.1, alpha);
    arm.shoulder.rotation.z = THREE.MathUtils.lerp(arm.shoulder.rotation.z, direction * (airborne ? -0.42 : 0.08), alpha);
  }
  for (const [index, booster] of (visual.authoredBoosters ?? []).entries()) {
    const power = THREE.MathUtils.clamp(Math.max(airborne ? 0.65 : 0, boosterPower, finalCharge), 0, 1);
    booster.flame.visible = power > 0.02;
    booster.flame.scale.set(
      0.75 + power * 0.45,
      0.55 + power * 0.75 + Math.sin(time * 24 + index) * 0.08,
      0.75 + power * 0.45,
    );
    booster.flame.material.opacity = 0.58 + power * 0.38;
  }
  for (const seal of visual.authoredSeals ?? []) {
    const broken = Boolean(brokenSeals[seal.index]);
    const active = seal.index === activeSealIndex;
    seal.group.visible = true;
    seal.group.rotation.y += dt * (active ? 1.9 : 0.22);
    seal.material.color.setHex(broken ? 0x332d27 : active ? 0xffffff : 0x7b4b2d);
    seal.material.emissive.setHex(broken ? 0x000000 : active ? 0xff5a1f : 0x4a1408);
    seal.material.emissiveIntensity = broken ? 0 : active ? 2.8 + Math.sin(time * 8) * 0.5 : 0.38;
    for (const segment of seal.segments) {
      segment.rotation.z = THREE.MathUtils.lerp(segment.rotation.z, broken ? (segment.position.x >= 0 ? 0.35 : -0.35) : 0, alpha);
    }
  }
  setTreeEmissive(visual.authoredEye, 2.1 + Math.sin(time * 4.2) * 0.3 + finalCharge * 2.4);
}

export default createAuthoredAscensionEngineVisual;
