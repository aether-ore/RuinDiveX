import * as THREE from 'three';

const DEFAULT_BLADE_COLOR = 0xa8ff8a;
const WHITE = new THREE.Color(0xffffff);

function makeStandardMaterial(name, color, options = {}) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.36,
    metalness: options.metalness ?? 0.58,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
  material.name = name;
  return material;
}

function makeBladeMaterial(name, color, opacity) {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.name = name;
  return material;
}

function makeCapsule(radius, cylinderLength, segments = 18) {
  if (THREE.CapsuleGeometry) {
    return new THREE.CapsuleGeometry(radius, cylinderLength, 8, segments);
  }
  return new THREE.CylinderGeometry(radius, radius, cylinderLength + radius * 2, segments);
}

function makeAxialCylinder(name, radiusTop, radiusBottom, length, material, z) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 18),
    material,
  );
  mesh.name = name;
  mesh.rotation.x = Math.PI / 2;
  mesh.position.z = z;
  mesh.castShadow = true;
  return mesh;
}

/**
 * Creates a compact hand-held beam saber. Local +Z runs from pommel to blade
 * tip, and `bladeGroup` remains rooted at the emitter for legacy trail samples.
 */
export function createHeldBeamSaber(bladeColor = DEFAULT_BLADE_COLOR) {
  const color = new THREE.Color(bladeColor);
  const weaponGroup = new THREE.Group();
  weaponGroup.name = 'rigHeldBeamSaber';
  weaponGroup.visible = false;
  weaponGroup.userData.weaponVisualKind = 'heldBeamSaber';

  const hilt = new THREE.Group();
  hilt.name = 'rigBeamSaberHilt';

  const gripMaterial = makeStandardMaterial('material_rigBeamSaberGrip', 0x17202a, {
    roughness: 0.6,
    metalness: 0.38,
  });
  const metalMaterial = makeStandardMaterial('material_rigBeamSaberMetal', 0xb7c4cc, {
    roughness: 0.24,
    metalness: 0.82,
  });
  const trimMaterial = makeStandardMaterial('material_rigBeamSaberTrim', 0xc7a85b, {
    roughness: 0.28,
    metalness: 0.76,
  });
  const switchMaterial = makeStandardMaterial('material_rigBeamSaberSwitch', 0xa61f2b, {
    roughness: 0.28,
    metalness: 0.34,
    emissive: 0x4d050b,
    emissiveIntensity: 0.62,
  });
  const apertureMaterial = makeStandardMaterial('material_rigBeamSaberAperture', color, {
    roughness: 0.25,
    metalness: 0.42,
    emissive: color,
    emissiveIntensity: 0.72,
  });
  apertureMaterial.userData.beamSaberTintRole = 'accent';

  const grip = makeAxialCylinder(
    'rigBeamSaberGrip',
    0.047,
    0.052,
    0.235,
    gripMaterial,
    0.095,
  );
  const pommel = makeAxialCylinder(
    'rigBeamSaberPommel',
    0.058,
    0.052,
    0.052,
    metalMaterial,
    -0.052,
  );
  const lowerCollar = makeAxialCylinder(
    'rigBeamSaberLowerCollar',
    0.061,
    0.061,
    0.032,
    trimMaterial,
    -0.006,
  );
  const upperCollar = makeAxialCylinder(
    'rigBeamSaberUpperCollar',
    0.064,
    0.058,
    0.042,
    metalMaterial,
    0.224,
  );
  const emitterShroud = makeAxialCylinder(
    'rigBeamSaberEmitterShroud',
    0.072,
    0.061,
    0.075,
    trimMaterial,
    0.278,
  );

  for (let index = 0; index < 4; index += 1) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.051, 0.006, 6, 18), metalMaterial);
    rib.name = `rigBeamSaberGripRib_${index + 1}`;
    rib.position.z = 0.025 + index * 0.047;
    rib.castShadow = true;
    hilt.add(rib);
  }

  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.012, 8, 22), metalMaterial);
  guard.name = 'rigBeamSaberEmitterGuard';
  guard.position.z = 0.314;
  guard.castShadow = true;

  const switchHousing = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.052, 0.06), metalMaterial);
  switchHousing.name = 'rigBeamSaberSwitchHousing';
  switchHousing.position.set(0.052, 0, 0.105);
  switchHousing.castShadow = true;

  const activationSwitch = new THREE.Mesh(new THREE.SphereGeometry(0.015, 10, 8), switchMaterial);
  activationSwitch.name = 'rigBeamSaberActivationSwitch';
  activationSwitch.position.set(0.068, 0, 0.108);

  const emitter = new THREE.Group();
  emitter.name = 'rigBeamSaberEmitter';
  emitter.position.z = 0.326;

  const aperture = makeAxialCylinder(
    'rigBeamSaberEmitterAperture',
    0.052,
    0.052,
    0.024,
    apertureMaterial,
    0,
  );
  emitter.add(aperture);

  const bladeGroup = new THREE.Group();
  bladeGroup.name = 'rigLaserBeamBlade';
  bladeGroup.visible = false;
  bladeGroup.userData.bladeAxis = '+Z';
  bladeGroup.userData.emitterRelative = true;

  const glowMaterial = makeBladeMaterial('material_rigLaserBeamBladeGlow', color, 0.38);
  glowMaterial.userData.beamSaberTintRole = 'glow';
  const coreColor = color.clone().lerp(WHITE, 0.78);
  const coreMaterial = makeBladeMaterial('material_rigLaserBeamBladeCore', coreColor, 0.96);
  coreMaterial.userData.beamSaberTintRole = 'core';

  const glow = new THREE.Mesh(makeCapsule(0.077, 1.27, 20), glowMaterial);
  glow.name = 'rigLaserBeamBladeGlow';
  glow.rotation.x = Math.PI / 2;
  glow.position.z = 0.712;
  glow.renderOrder = 6;

  const core = new THREE.Mesh(makeCapsule(0.027, 1.31, 16), coreMaterial);
  core.name = 'rigLaserBeamBladeCore';
  core.rotation.x = Math.PI / 2;
  core.position.z = 0.682;
  core.renderOrder = 7;

  bladeGroup.add(glow, core);
  emitter.add(bladeGroup);
  hilt.add(
    grip,
    pommel,
    lowerCollar,
    upperCollar,
    emitterShroud,
    guard,
    switchHousing,
    activationSwitch,
    emitter,
  );
  weaponGroup.add(hilt);

  return {
    weaponGroup,
    hilt,
    emitter,
    bladeGroup,
  };
}

export function tintHeldBeamSaber(weaponGroup, bladeColor = DEFAULT_BLADE_COLOR) {
  if (!weaponGroup) {
    return;
  }
  const color = new THREE.Color(bladeColor);
  weaponGroup.traverse((object) => {
    const material = object.material;
    const role = material?.userData?.beamSaberTintRole;
    if (!role || !material.color) {
      return;
    }
    material.color.copy(role === 'core' ? color.clone().lerp(WHITE, 0.78) : color);
    if (role === 'accent' && material.emissive) {
      material.emissive.copy(color);
    }
  });
}

