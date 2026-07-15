import * as THREE from 'three';
import { REAVERBOT_EYE_COLOR } from './ReaverbotCatalog.js';
import { resolveReaverbotTextureProfile } from './ReaverbotTextureCatalog.js';
import {
  getReaverbotTexture,
  getReaverbotTextureAsset,
} from './ReaverbotTextureLibrary.js';
import {
  applyReaverbotSemanticUv,
  inferReaverbotSurfaceRole,
} from './ReaverbotSurfaceCatalog.js';

const FORWARD = new THREE.Vector3(0, 0, 1);
const TRACTOR_BEAM_AXIS = new THREE.Vector3(0, -1, 0);
const TRACTOR_RING_AXIS = new THREE.Vector3(0, 0, 1);
const TRACTOR_TEMP_DIRECTION = new THREE.Vector3();
const GAIT_TEMP_WORLD = new THREE.Vector3();
const GAIT_TEMP_DELTA = new THREE.Vector3();
const GAIT_TEMP_QUATERNION = new THREE.Quaternion();
const GAIT_TAU = Math.PI * 2;
const ANIMAL_SIDE_MOUNT_WEAPONS = new Set([
  'clawArm',
  'pulseCannon',
  'mortarPod',
  'clusterMortar',
  'arcEmitter',
  'flameNozzle',
  'beamPrism',
  'mineDispenser',
  'shockPiston',
]);

function clawMountSideFromGenome(genome) {
  return Math.sign(genome?.modules?.weapon?.mountSide || 1);
}

function standardMaterial(name, color, options = {}) {
  const material = new THREE.MeshStandardMaterial({
    color,
    map: options.map ?? null,
    emissiveMap: options.emissiveMap ?? null,
    alphaMap: options.alphaMap ?? null,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0.16,
    flatShading: options.flatShading ?? true,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
    depthWrite: options.depthWrite ?? true,
    blending: options.blending ?? THREE.NormalBlending,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
  material.name = name;
  if (options.textureAssignment) {
    material.userData.reaverbotTexture = options.textureAssignment;
  }
  if (options.textureExempt) {
    material.userData.reaverbotTextureExempt = options.textureExempt;
  }
  return material;
}

function mappedMaterial(name, color, {
  scope,
  moduleId,
  slot,
  mapKey,
  emissiveMapKey = null,
  alphaMapKey = null,
  ...options
}) {
  const referencedKeys = [...new Set([mapKey, emissiveMapKey, alphaMapKey].filter(Boolean))];
  const textures = Object.fromEntries(referencedKeys.map((assetKey) => [
    assetKey,
    getReaverbotTexture(assetKey),
  ]));
  const assetPaths = Object.fromEntries(referencedKeys.map((assetKey) => [
    assetKey,
    getReaverbotTextureAsset(assetKey).path,
  ]));
  return standardMaterial(name, color, {
    ...options,
    map: mapKey ? textures[mapKey] : null,
    emissiveMap: emissiveMapKey ? textures[emissiveMapKey] : null,
    alphaMap: alphaMapKey ? textures[alphaMapKey] : null,
    textureAssignment: {
      scope,
      moduleId,
      slot,
      mapKey,
      emissiveMapKey,
      alphaMapKey,
      assetPaths,
      fallbackUsed: referencedKeys.some((assetKey) => (
        textures[assetKey].userData.reaverbotTexture?.fallbackUsed
      )),
    },
  });
}

function textureSlot(profile, fallback, slot) {
  return profile?.[slot] ?? fallback[slot];
}

function liftedPaletteColor(color, lift = 0) {
  return new THREE.Color(color).lerp(new THREE.Color(0xffffff), THREE.MathUtils.clamp(lift, 0, 1));
}

function canonicalSurfaceRole(partName, inferredRole) {
  const name = String(partName).toLowerCase();
  if (/darkworkingend|workingend|toecap|landingpad|poleworkingend/.test(name)) return 'workingEnd';
  if (/hinge/.test(name)) return 'hinge';
  if (/bearing|\bjoint\b/.test(name)) return 'bearing';
  if (/circuit|trace|glyph/.test(name)) return 'circuitPanel';
  if (/underside|under-shell|darkinterior/.test(name)) return 'underside';
  if (/vent|grille|slot/.test(name)) return 'vent';
  if (/muzzle|aperture|recess|well|chute|mouth/.test(name)) return 'recess';
  if (/emitter|powered|core|node|coil|battery|terminal|storedmine/.test(name)) return 'emitter';
  if (/endcap|cap$/.test(name)) return 'endCap';
  if (/band|ring|rim|rail|collar|edge/.test(name)) return 'band';
  if (/blade|tooth|talon|razor|horn|spike|shard/.test(name)) return 'bladeEdge';
  if (inferredRole === 'joint') return 'bearing';
  if (inferredRole === 'circuit') return 'circuitPanel';
  if (inferredRole === 'emissive') return 'emitter';
  if (inferredRole === 'trim') return 'band';
  if (inferredRole === 'workingEdge') return 'bladeEdge';
  if (inferredRole === 'energy') return 'energyField';
  if (inferredRole === 'eye') return 'eye';
  return 'armorFace';
}

function uvRoleForSurface(canonicalRole, inferredRole, assignment) {
  if (assignment.scope === 'eye') return 'eye';
  if (assignment.slot === 'energyField'
    || assignment.mapKey === 'energyFieldMask'
    || assignment.alphaMapKey === 'energyFieldMask') return 'energy';
  if (canonicalRole === 'workingEnd' || canonicalRole === 'bladeEdge') return 'workingEdge';
  if (canonicalRole === 'circuitPanel') return 'circuit';
  if (canonicalRole === 'emitter') return 'emissive';
  if (canonicalRole === 'band' || canonicalRole === 'endCap') return 'trim';
  if (canonicalRole === 'bearing'
    || canonicalRole === 'hinge'
    || canonicalRole === 'recess'
    || canonicalRole === 'underside'
    || canonicalRole === 'vent') return 'joint';
  return inferredRole === 'housing' ? 'housing' : 'armor';
}

function surfaceValueClass(role) {
  if (role === 'workingEnd') return 'dark';
  if (role === 'bearing' || role === 'hinge' || role === 'recess' || role === 'underside' || role === 'vent') return 'darkMechanical';
  if (role === 'circuitPanel') return 'circuit';
  if (role === 'emitter' || role === 'energyField' || role === 'eye') return 'emissive';
  if (role === 'bladeEdge') return 'blade';
  if (role === 'band' || role === 'endCap') return 'trim';
  return 'armor';
}

function mesh(parent, geometry, material, name, position = null, rotation = null, scale = null) {
  const assignment = material?.userData?.reaverbotTexture;
  let mappedGeometry = geometry;
  let surface = null;
  if (assignment && geometry?.getAttribute?.('uv')) {
    const partName = `${parent?.name || 'generatedReaverbot'}/${name}`;
    const inferredRole = assignment.scope === 'eye'
      ? 'eye'
      : inferReaverbotSurfaceRole(partName, assignment.slot);
    const role = assignment.scope === 'eye'
      ? 'eye'
      : canonicalSurfaceRole(partName, inferredRole);
    const uvRole = uvRoleForSurface(role, inferredRole, assignment);
    const semanticUv = applyReaverbotSemanticUv(geometry, {
      scope: assignment.scope,
      moduleId: assignment.moduleId,
      partName,
      role: uvRole,
      slot: assignment.slot,
      mirror: /left/i.test(partName) && !/right/i.test(partName),
      workingEnd: 'vMax',
    });
    mappedGeometry = semanticUv.geometry;
    surface = {
      scope: assignment.scope,
      moduleId: assignment.moduleId,
      partName,
      role,
      valueClass: surfaceValueClass(role),
      mappingMode: uvRole === 'eye' || uvRole === 'energy' ? 'fullMap' : 'region',
      regionIds: [...semanticUv.regionIds],
      uvRects: semanticUv.uvRects.map((rect) => [...rect]),
      sourceMappingMode: semanticUv.mappingMode,
      mirrored: /left/i.test(partName) && !/right/i.test(partName),
    };
  }
  const object = new THREE.Mesh(mappedGeometry, material);
  object.name = name;
  object.castShadow = !material.transparent;
  object.receiveShadow = !material.transparent;
  if (surface) object.userData.reaverbotSurface = surface;
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
  const joint = mesh(
    parent,
    new THREE.SphereGeometry(radius, 8, 5),
    materials.dark,
    `${name}Joint`,
    position,
  );
  mesh(
    joint,
    new THREE.TorusGeometry(radius * 0.8, radius * 0.14, 5, 10),
    materials.trim,
    `${name}BearingRing`,
    [0, 0, radius * 0.72],
  );
  return joint;
}

function addBearingAssembly(parent, materials, name, position, {
  radius = 0.22,
  width = 0.24,
  rotation = [0, 0, Math.PI / 2],
} = {}) {
  const bearing = group(parent, `${name}BearingAssembly`, position);
  const barrel = mesh(
    bearing,
    new THREE.CylinderGeometry(radius, radius, width, 10),
    materials.dark,
    `${name}DarkBearingBarrel`,
    [0, 0, 0],
    rotation,
  );
  const axisIsX = Math.abs(rotation[2] ?? 0) > 1;
  const axisIsZ = Math.abs(rotation[0] ?? 0) > 1;
  for (const side of [-1, 1]) {
    const capPosition = axisIsX
      ? [side * width * 0.52, 0, 0]
      : axisIsZ
        ? [0, 0, side * width * 0.52]
        : [0, side * width * 0.52, 0];
    mesh(
      bearing,
      new THREE.CylinderGeometry(radius * 1.08, radius * 1.08, width * 0.12, 10),
      materials.trim,
      `${name}BearingEndCap`,
      capPosition,
      rotation,
    );
  }
  barrel.userData.reaverbotMechanicalBearing = true;
  return bearing;
}

function addCircuitPanel(parent, materials, name, {
  position = [0, 0, 0],
  rotation = null,
  width = 0.5,
  height = 0.58,
  mirror = false,
  powered = true,
} = {}) {
  const panel = group(parent, `${name}CircuitPanel`, position);
  if (rotation) panel.rotation.set(rotation[0], rotation[1], rotation[2]);
  panel.userData.reaverbotCircuitPanel = true;
  panel.userData.mirroredCircuitLayout = mirror;

  box(
    panel,
    materials.dark,
    `${name}CircuitRecess`,
    [width, height, 0.025],
    [0, 0, 0],
  );
  box(
    panel,
    materials.secondary ?? materials.weapon ?? materials.primary,
    `${name}QuietArmorFace`,
    [width * 0.9, height * 0.9, 0.025],
    [0, 0, 0.022],
  );

  const direction = mirror ? -1 : 1;
  const traceWidth = Math.max(0.025, Math.min(width, height) * 0.055);
  const segments = [
    { size: [width * 0.48, traceWidth, 0.025], at: [direction * width * -0.14, height * -0.26, 0.052] },
    { size: [traceWidth, height * 0.34, 0.025], at: [direction * width * 0.1, height * -0.1, 0.052] },
    { size: [width * 0.38, traceWidth, 0.025], at: [direction * width * 0.27, height * 0.07, 0.052] },
    { size: [traceWidth, height * 0.3, 0.025], at: [direction * width * 0.08, height * 0.22, 0.052] },
    { size: [width * 0.3, traceWidth, 0.025], at: [direction * width * -0.07, height * 0.36, 0.052] },
  ];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    box(
      panel,
      materials.trim,
      `${name}AncientCircuitTrace${index}`,
      segment.size,
      segment.at,
    );
  }

  if (powered && materials.emissive) {
    for (const [index, node] of [
      [0, [direction * width * -0.38, height * -0.26, 0.062]],
      [1, [direction * width * 0.45, height * 0.07, 0.062]],
      [2, [direction * width * -0.22, height * 0.36, 0.062]],
    ]) {
      mesh(
        panel,
        new THREE.CylinderGeometry(traceWidth * 1.55, traceWidth * 1.55, 0.03, 7),
        materials.emissive,
        `${name}CircuitEmitterNode${index}`,
        node,
        [Math.PI / 2, 0, 0],
      );
    }
  }
  return panel;
}

function addDarkFootEnd(parent, materials, name, {
  size,
  position,
  rotation = null,
} = {}) {
  const end = box(
    parent,
    materials.dark,
    `${name}DarkWorkingEnd`,
    size,
    position,
    rotation,
  );
  end.userData.reaverbotWorkingEnd = true;
  end.userData.contactSurface = true;
  return end;
}

function solveCanineLegPose(limb, {
  forward = limb.restForward,
  down = limb.restDown,
  lateral = 0,
  swing = 0,
} = {}) {
  const hockX = limb.restHockX + limb.hockSwingDirection * swing;
  const lowerReachX = limb.metapodLength * Math.sin(hockX);
  const lowerReachY = limb.lowerLength + limb.metapodLength * Math.cos(hockX);
  const effectiveLowerLength = Math.max(0.001, Math.hypot(lowerReachX, lowerReachY));
  const hockDirectionOffset = Math.atan2(lowerReachX, lowerReachY);
  const unclampedDistance = Math.hypot(forward, down);
  const distance = THREE.MathUtils.clamp(
    unclampedDistance,
    Math.abs(limb.upperLength - effectiveLowerLength) + 0.002,
    limb.upperLength + effectiveLowerLength - 0.002,
  );
  const aimFromDown = -Math.atan2(forward, Math.max(0.001, down));
  const shoulderOffset = Math.acos(THREE.MathUtils.clamp(
    (limb.upperLength ** 2 + distance ** 2 - effectiveLowerLength ** 2)
      / (2 * limb.upperLength * distance),
    -1,
    1,
  ));
  const innerKnee = Math.acos(THREE.MathUtils.clamp(
    (limb.upperLength ** 2 + effectiveLowerLength ** 2 - distance ** 2)
      / (2 * limb.upperLength * effectiveLowerLength),
    -1,
    1,
  ));
  const upperX = aimFromDown + limb.bendDirection * shoulderOffset;
  const effectiveKneeX = -limb.bendDirection * (Math.PI - innerKnee);
  const kneeX = effectiveKneeX - hockDirectionOffset;
  const pawX = -(upperX + kneeX + hockX);
  const upperZ = limb.restUpperZ + Math.atan2(lateral, Math.max(0.1, down)) * 0.88;

  return {
    upperX,
    upperZ,
    kneeX,
    hockX,
    pawX,
    pawZ: -upperZ,
  };
}

function applyCanineLegPose(limb, pose, response = 1, planted = false) {
  limb.hipPivot.rotation.x = THREE.MathUtils.lerp(limb.hipPivot.rotation.x, pose.upperX, response);
  limb.hipPivot.rotation.z = THREE.MathUtils.lerp(limb.hipPivot.rotation.z, pose.upperZ, response);
  limb.kneePivot.rotation.x = THREE.MathUtils.lerp(limb.kneePivot.rotation.x, pose.kneeX, response);
  limb.hockPivot.rotation.x = THREE.MathUtils.lerp(limb.hockPivot.rotation.x, pose.hockX, response);
  limb.pawPivot.rotation.x = THREE.MathUtils.lerp(limb.pawPivot.rotation.x, pose.pawX, response);
  limb.pawPivot.rotation.z = THREE.MathUtils.lerp(limb.pawPivot.rotation.z, pose.pawZ, response);
  limb.planted = planted;
  limb.contactAnchor.userData.planted = planted;
}

function createCompressionSpring(parent, materials, name, {
  length,
  radius,
  ringCount = 4,
  mobilityWeaponId = 'pounceActuator',
} = {}) {
  const spring = group(parent, `${name}SpringAssembly`);
  spring.userData.springLoaded = true;
  spring.userData.replacesStandardLocomotion = true;
  spring.userData.mobilityWeaponId = mobilityWeaponId;
  const weaponName = mobilityWeaponId === 'shockPiston' ? 'ShockPiston' : 'PounceActuator';
  const rings = [];

  taperedColumn(
    spring,
    materials.dark,
    `${name}SpringGuideRod`,
    radius * 0.22,
    radius * 0.22,
    length * 0.9,
    [0, -length * 0.5, 0],
    8,
  );
  for (let index = 0; index < ringCount; index += 1) {
    const progress = ringCount <= 1 ? 0.5 : index / (ringCount - 1);
    const ring = mesh(
      spring,
      new THREE.TorusGeometry(radius, Math.max(0.024, radius * 0.18), 6, 12),
      index % 2 === 0 ? materials.trim : (materials.mobilityEmissive ?? materials.emissive),
      `generated${weaponName}LegCompressionCoil`,
      [0, -THREE.MathUtils.lerp(length * 0.14, length * 0.84, progress), 0],
      [Math.PI / 2, 0, 0],
    );
    ring.userData.springMobilityPart = true;
    rings.push(ring);
  }
  for (const [suffix, y] of [['Upper', -length * 0.04], ['Lower', -length * 0.94]]) {
    const receiver = mesh(
      spring,
      new THREE.CylinderGeometry(radius * 1.25, radius * 1.25, Math.max(0.08, length * 0.16), 10),
      materials.mobilityWeapon ?? materials.primary,
      `generated${weaponName}${suffix}LegReceiver`,
      [0, y, 0],
    );
    receiver.userData.springMobilityPart = true;
    receiver.userData.integratedMobilityWeapon = true;
  }
  return { group: spring, rings };
}

function createLaunchLegModule(parent, materials, {
  mountSide = 1,
  authoredLength = 4.35,
} = {}) {
  const sideName = mountSide < 0 ? 'Left' : 'Right';
  const assembly = group(parent, `generated${sideName}LaunchLegAssembly`);
  assembly.userData.massiveWeaponPart = true;
  assembly.userData.integratedMobilityWeapon = true;
  assembly.userData.launchLegModule = true;

  // The rig follows a kangaroo silhouette: a long armored femur pitches
  // forward, the shock-stack shin folds back underneath it, and the extended
  // metatarsal returns to a broad three-clawed foot. It is authored as a
  // reusable one-leg assembly so a later machine can mount a mirrored pair.
  const hipPivot = group(assembly, 'generatedLaunchLegHipPivot');
  hipPivot.userData.launchLegRigRole = 'rocketHip';
  hipPivot.rotation.x = -0.48;
  addBearingAssembly(hipPivot, materials, 'generatedLaunchLegHip', [0, 0, 0], {
    radius: 0.46,
    width: 1.18,
  });
  box(
    hipPivot,
    materials.weapon,
    'generatedLaunchLegHipCradleArmor',
    [1.18, 0.72, 0.92],
    [0, -0.05, 0.12],
  ).userData.massiveWeaponPart = true;

  const upperLength = 1.45;
  const thigh = box(
    hipPivot,
    materials.weapon,
    'generatedLaunchLegMassiveUpperThigh',
    [0.88, upperLength, 0.78],
    [0, -upperLength * 0.5, 0.04],
  );
  thigh.userData.massiveWeaponPart = true;
  box(
    hipPivot,
    materials.dark,
    'generatedLaunchLegUpperThighDarkUnderside',
    [0.42, upperLength * 0.82, 0.82],
    [0, -upperLength * 0.54, -0.03],
  );
  for (const side of [-1, 1]) {
    box(
      hipPivot,
      materials.trim,
      'generatedLaunchLegUpperThighRazorRail',
      [0.11, upperLength * 0.86, 0.84],
      [side * 0.45, -upperLength * 0.52, 0.04],
    );
  }
  addCircuitPanel(hipPivot, materials, 'generatedLaunchLegUpperThigh', {
    position: [0, -upperLength * 0.5, 0.445],
    width: 0.58,
    height: 0.94,
    mirror: mountSide < 0,
  });

  const flameMaterial = standardMaterial('material_generatedLaunchLegRocketFlame', 0xffa12b, {
    emissive: 0xff3b08,
    emissiveIntensity: 3.2,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    textureExempt: 'animated additive Launch Leg exhaust flame',
  });
  const boosters = [];
  const boosterNozzles = [];
  const boosterFlames = [];
  for (const side of [-1, 1]) {
    const booster = group(
      hipPivot,
      `generatedLaunchLeg${side < 0 ? 'Left' : 'Right'}UpperRocketBooster`,
      [side * 0.42, 0.12, -0.38],
    );
    booster.rotation.x = -0.18;
    booster.userData.launchLegBooster = true;
    mesh(
      booster,
      new THREE.CylinderGeometry(0.24, 0.2, 0.72, 10),
      materials.weapon,
      'generatedLaunchLegUpperRocketHousing',
      [0, -0.28, 0],
    );
    mesh(
      booster,
      new THREE.TorusGeometry(0.245, 0.055, 6, 12),
      materials.emissive,
      'generatedLaunchLegUpperRocketPoweredBand',
      [0, -0.2, 0],
      [Math.PI / 2, 0, 0],
    );
    mesh(
      booster,
      new THREE.CylinderGeometry(0.16, 0.22, 0.22, 10),
      materials.dark,
      'generatedLaunchLegUpperRocketDarkNozzle',
      [0, -0.72, 0],
    );
    const nozzle = new THREE.Object3D();
    nozzle.name = 'generatedLaunchLegUpperRocketExhaustNozzle';
    nozzle.position.set(0, -0.84, 0);
    booster.add(nozzle);
    const flame = mesh(
      nozzle,
      new THREE.ConeGeometry(0.13, 0.9, 8),
      flameMaterial.clone(),
      'generatedLaunchLegUpperRocketFlame',
      [0, -0.43, 0],
    );
    flame.material.name = `${flameMaterial.name}_${sideName}_${side}`;
    flame.material.userData.reaverbotTextureExempt = flameMaterial.userData.reaverbotTextureExempt;
    flame.visible = false;
    boosters.push(booster);
    boosterNozzles.push(nozzle);
    boosterFlames.push(flame);
  }
  flameMaterial.dispose();

  const kneePivot = group(hipPivot, 'generatedLaunchLegKneePivot', [0, -upperLength, 0]);
  kneePivot.userData.launchLegRigRole = 'compressionKnee';
  kneePivot.rotation.x = 1.28;
  addBearingAssembly(kneePivot, materials, 'generatedLaunchLegKnee', [0, 0, 0], {
    radius: 0.39,
    width: 1.02,
  });
  for (const side of [-1, 1]) {
    box(
      kneePivot,
      materials.weapon,
      'generatedLaunchLegKneeGuard',
      [0.2, 0.7, 0.76],
      [side * 0.43, -0.18, 0.08],
      [0, 0, side * 0.14],
    );
  }

  const lowerLength = 1.35;
  const shockStack = group(kneePivot, 'generatedLaunchLegTelescopingShockStack');
  shockStack.userData.springLoaded = true;
  shockStack.userData.launchLegShockStack = true;
  taperedColumn(
    shockStack,
    materials.dark,
    'generatedLaunchLegCentralShockRam',
    0.14,
    0.18,
    lowerLength * 0.94,
    [0, -lowerLength * 0.49, 0],
    10,
  );
  for (const side of [-1, 1]) {
    taperedColumn(
      shockStack,
      materials.weapon,
      'generatedLaunchLegParallelHydraulicPiston',
      0.12,
      0.18,
      lowerLength * 0.82,
      [side * 0.28, -lowerLength * 0.48, 0],
      8,
    );
    box(
      shockStack,
      materials.trim,
      'generatedLaunchLegShockRail',
      [0.09, lowerLength * 0.9, 0.42],
      [side * 0.44, -lowerLength * 0.5, 0],
    );
  }
  const shockBands = [];
  for (let index = 0; index < 6; index += 1) {
    const band = mesh(
      shockStack,
      new THREE.TorusGeometry(0.34, 0.06, 6, 12),
      index % 2 === 0 ? materials.trim : materials.emissive,
      'generatedLaunchLegShockCompressionBand',
      [0, -THREE.MathUtils.lerp(0.18, lowerLength * 0.88, index / 5), 0],
      [Math.PI / 2, 0, 0],
    );
    band.userData.springMobilityPart = true;
    band.userData.integratedMobilityWeapon = true;
    shockBands.push(band);
  }

  const anklePivot = group(kneePivot, 'generatedLaunchLegAnklePivot', [0, -lowerLength, 0]);
  anklePivot.userData.launchLegRigRole = 'reversedHock';
  anklePivot.rotation.x = -0.74;
  addBearingAssembly(anklePivot, materials, 'generatedLaunchLegAnkle', [0, 0, 0], {
    radius: 0.29,
    width: 0.82,
  });
  const hockLength = 0.62;
  taperedColumn(
    anklePivot,
    materials.weapon,
    'generatedLaunchLegLongKangarooMetatarsal',
    0.18,
    0.28,
    hockLength,
    [0, -hockLength * 0.5, 0],
    7,
  );
  box(
    anklePivot,
    materials.trim,
    'generatedLaunchLegHockArmorBlade',
    [0.58, hockLength * 0.72, 0.34],
    [0, -hockLength * 0.48, 0],
  );

  const footPivot = group(anklePivot, 'generatedLaunchLegFootPivot', [0, -hockLength, 0]);
  footPivot.userData.launchLegRigRole = 'clawedLandingFoot';
  footPivot.rotation.x = -0.06;
  const foot = box(
    footPivot,
    materials.weapon,
    'generatedLaunchLegMassiveKangarooFoot',
    [1.42, 0.34, 1.5],
    [0, 0.04, 0.42],
  );
  foot.userData.massiveWeaponPart = true;
  const sole = addDarkFootEnd(footPivot, materials, 'generatedLaunchLegLandingSole', {
    size: [1.3, 0.12, 1.34],
    position: [0, -0.16, 0.42],
  });
  box(
    footPivot,
    materials.trim,
    'generatedLaunchLegHeelCounterweight',
    [0.86, 0.28, 0.5],
    [0, 0.08, -0.48],
  );

  const claws = [];
  for (const [index, x] of [-0.44, 0, 0.44].entries()) {
    const clawPivot = group(footPivot, `generatedLaunchLegToeClaw${index + 1}Pivot`, [x, 0.08, 1.03]);
    clawPivot.rotation.y = x * -0.16;
    const claw = mesh(
      clawPivot,
      new THREE.ConeGeometry(index === 1 ? 0.18 : 0.15, index === 1 ? 0.92 : 0.78, 5),
      materials.trim,
      'generatedLaunchLegRazorToeClaw',
      [0, 0, 0.4],
      [Math.PI / 2, 0, 0],
    );
    const darkTip = mesh(
      clawPivot,
      new THREE.ConeGeometry(index === 1 ? 0.13 : 0.11, index === 1 ? 0.52 : 0.44, 5),
      materials.dark,
      'generatedLaunchLegToeClawDarkWorkingEnd',
      [0, 0, index === 1 ? 0.95 : 0.84],
      [Math.PI / 2, 0, 0],
    );
    claw.userData.massiveWeaponPart = true;
    darkTip.userData.reaverbotWorkingEnd = true;
    darkTip.userData.launchLegClaw = true;
    claws.push(darkTip);
  }

  const contactAnchor = new THREE.Object3D();
  contactAnchor.name = 'generatedLaunchLegSoleContact';
  contactAnchor.position.set(0, -0.17, 0.42);
  contactAnchor.userData.contactSurface = true;
  footPivot.add(contactAnchor);

  const limb = {
    role: 'launchLeg',
    launchLeg: true,
    side: mountSide,
    pivot: hipPivot,
    hipPivot,
    kneePivot,
    hockPivot: anklePivot,
    anklePivot,
    pawPivot: footPivot,
    footPivot,
    foot,
    sole,
    contactAnchor,
    springLoaded: true,
    springGroup: shockStack,
    springCoils: shockBands,
    springEndpoint: anklePivot,
    springEndpointBaseY: anklePivot.position.y,
    springCompressionTravel: lowerLength * 0.42,
    restHipX: -0.48,
    restKneeX: 1.28,
    restAnkleX: -0.74,
    restFootX: -0.06,
  };

  assembly.userData.launchLegRig = {
    articulated: true,
    segmentCount: 3,
    authoredLength,
    rocketAssisted: true,
    boosterCount: boosters.length,
    clawCount: claws.length,
    mountSide,
  };

  return {
    assembly,
    hipPivot,
    kneePivot,
    anklePivot,
    footPivot,
    foot,
    sole,
    contactAnchor,
    shockStack,
    shockBands,
    boosters,
    boosterNozzles,
    boosterFlames,
    claws,
    limb,
  };
}

function createCanineLeg(root, materials, {
  side,
  front,
  bodyWidth,
  bodyLength,
  bodyY,
  limbScale,
  springLoaded = false,
  mobilityWeaponId = null,
}) {
  const sideName = side < 0 ? 'Left' : 'Right';
  const endName = front ? 'Front' : 'Rear';
  const slot = `${side < 0 ? 'left' : 'right'}${endName}`;
  const upperLength = (front ? 0.38 : 0.42) * limbScale;
  const lowerLength = (front ? 0.36 : 0.34) * limbScale;
  const metapodLength = (front ? 0.18 : 0.22) * limbScale;
  const hipPivot = group(
    root,
    `generated${sideName}${endName}CanineHipPivot`,
    [side * bodyWidth * 0.53, bodyY - 0.06, (front ? 0.32 : -0.34) * bodyLength],
  );
  hipPivot.userData.articulatedCanineJoint = true;
  hipPivot.userData.jointRole = front ? 'shoulder' : 'hip';
  hipPivot.userData.legSlot = slot;
  addBearingAssembly(hipPivot, materials, `generated${sideName}${endName}CanineHip`, [0, 0, 0], {
    radius: front ? 0.18 : 0.19,
    width: 0.34,
  });
  box(
    hipPivot,
    materials.primary,
    `generated${sideName}${endName}CanineUpperArmor`,
    [0.28, upperLength * 0.58, 0.24],
    [0, -upperLength * 0.32, 0],
  );
  taperedColumn(
    hipPivot,
    materials.secondary,
    `generated${sideName}${endName}CanineUpperLink`,
    0.105,
    0.145,
    upperLength,
    [0, -upperLength * 0.5, 0],
    5,
  );

  const kneePivot = group(
    hipPivot,
    `generated${sideName}${endName}CanineKneePivot`,
    [0, -upperLength, 0],
  );
  kneePivot.userData.articulatedCanineJoint = true;
  kneePivot.userData.jointRole = front ? 'elbow' : 'stifle';
  kneePivot.userData.legSlot = slot;
  addBearingAssembly(kneePivot, materials, `generated${sideName}${endName}CanineKnee`, [0, 0, 0], {
    radius: 0.145,
    width: 0.29,
  });
  const spring = springLoaded
    ? createCompressionSpring(kneePivot, materials, `generated${sideName}${endName}Canine`, {
      length: lowerLength,
      radius: front ? 0.125 : 0.135,
      ringCount: 4,
      mobilityWeaponId,
    })
    : null;
  if (!springLoaded) {
    taperedColumn(
      kneePivot,
      materials.primary,
      `generated${sideName}${endName}CanineLowerLink`,
      0.085,
      0.125,
      lowerLength,
      [0, -lowerLength * 0.5, 0],
      5,
    );
    box(
      kneePivot,
      materials.secondary,
      `generated${sideName}${endName}CanineLowerArmor`,
      [0.22, lowerLength * 0.48, 0.19],
      [0, -lowerLength * 0.38, 0],
    );
  }

  const hockPivot = group(
    kneePivot,
    `generated${sideName}${endName}CanineHockPivot`,
    [0, -lowerLength, 0],
  );
  hockPivot.userData.articulatedCanineJoint = true;
  hockPivot.userData.jointRole = front ? 'wrist' : 'hock';
  hockPivot.userData.legSlot = slot;
  addBearingAssembly(hockPivot, materials, `generated${sideName}${endName}CanineHock`, [0, 0, 0], {
    radius: 0.105,
    width: 0.23,
  });
  taperedColumn(
    hockPivot,
    materials.secondary,
    `generated${sideName}${endName}CanineMetapod`,
    0.07,
    0.1,
    metapodLength,
    [0, -metapodLength * 0.5, 0],
    5,
  );
  box(
    hockPivot,
    materials.trim,
    `generated${sideName}${endName}CanineAnkleGuard`,
    [0.2, 0.11, 0.18],
    [0, -metapodLength * 0.62, 0],
  );

  const pawPivot = group(
    hockPivot,
    `generated${sideName}${endName}CaninePawPivot`,
    [0, -metapodLength, 0],
  );
  pawPivot.userData.articulatedCanineJoint = true;
  pawPivot.userData.jointRole = 'paw';
  pawPivot.userData.legSlot = slot;
  const paw = box(
    pawPivot,
    materials.primary,
    `generated${sideName}${endName}CanineArmoredPaw`,
    [0.36, 0.16, 0.46],
    [0, 0.08, 0.14],
  );
  paw.userData.articulatedCaninePaw = true;
  const sole = addDarkFootEnd(pawPivot, materials, `generated${sideName}${endName}CaninePawSole`, {
    size: [0.32, 0.055, 0.35],
    position: [0, 0.018, 0.14],
  });
  sole.userData.articulatedCaninePaw = true;
  for (const [toeIndex, toeX] of [-0.105, 0, 0.105].entries()) {
    const toe = mesh(
      pawPivot,
      new THREE.ConeGeometry(0.045, 0.22, 5),
      materials.dark,
      `generated${sideName}${endName}CanineToeClaw${toeIndex + 1}`,
      [toeX, 0.075, 0.42],
      [Math.PI / 2, 0, 0],
    );
    toe.userData.reaverbotWorkingEnd = true;
  }
  const contactAnchor = new THREE.Object3D();
  contactAnchor.name = `generated${sideName}${endName}CanineSoleContact`;
  contactAnchor.position.set(0, 0, 0.14);
  contactAnchor.userData.contactSurface = true;
  pawPivot.add(contactAnchor);

  const limb = {
    role: 'quadrupedLeg',
    slot,
    side,
    front,
    canine: true,
    springLoaded,
    springGroup: spring?.group ?? null,
    springCoils: spring?.rings ?? [],
    pivot: hipPivot,
    hipPivot,
    kneePivot,
    hockPivot,
    anklePivot: hockPivot,
    pawPivot,
    paw,
    sole,
    contactAnchor,
    phase: side * (front ? 1 : -1),
    gaitPhase: side * (front ? 1 : -1) < 0 ? 0 : Math.PI,
    upperLength,
    lowerLength,
    metapodLength,
    bendDirection: front ? 1 : -1,
    restForward: front ? 0.015 : -0.02,
    restDown: (upperLength + lowerLength + metapodLength) * 0.91,
    restHockX: front ? 0.22 : -0.38,
    hockSwingDirection: front ? 0.26 : -0.34,
    restUpperZ: side * 0.055,
    planted: true,
  };
  if (springLoaded) {
    limb.springEndpoint = hockPivot;
    limb.springEndpointBaseY = hockPivot.position.y;
    limb.springCompressionTravel = lowerLength * 0.3;
  }
  applyCanineLegPose(limb, solveCanineLegPose(limb), 1, true);
  return limb;
}

function createCrawlerArticulatedLeg(root, materials, {
  side,
  row,
  bodyWidth,
  bodyLength,
  bodyY,
  limbScale,
}) {
  const sideName = side < 0 ? 'Left' : 'Right';
  const rowName = row > 0 ? 'Front' : row < 0 ? 'Rear' : 'Middle';
  const rowIndex = row > 0 ? 1 : row < 0 ? -1 : 0;
  const upperLength = 0.48 * limbScale;
  const lowerLength = 0.5 * limbScale;
  // The leg is a nested hierarchy, so every vertical offset accumulates.
  // Derive the hip height from those generated links to keep the skid just
  // above the floor across the full limb-length range instead of burying long
  // crawler legs beneath the room surface.
  const groundedHipY = Math.max(
    bodyY - 0.04,
    upperLength * 0.8 + lowerLength * 0.9 + 0.145,
  );
  const hipPivot = group(
    root,
    `generatedCrawler${sideName}${rowName}HipPivot`,
    [side * bodyWidth * 0.48, groundedHipY, rowIndex * bodyLength * 0.34],
  );
  hipPivot.userData.articulatedCrawlerJoint = true;
  hipPivot.userData.jointRole = 'hip';
  addBearingAssembly(hipPivot, materials, `generatedCrawler${sideName}${rowName}Hip`, [0, 0, 0], {
    radius: 0.145,
    width: 0.28,
  });
  taperedColumn(
    hipPivot,
    materials.secondary,
    `generatedCrawler${sideName}${rowName}CantedUpperStrut`,
    0.085,
    0.135,
    upperLength,
    [side * upperLength * 0.29, -upperLength * 0.4, 0],
    5,
    [0, 0, side * 0.62],
  );
  box(
    hipPivot,
    materials.primary,
    `generatedCrawler${sideName}${rowName}UpperArmorBlade`,
    [0.16, upperLength * 0.54, 0.22],
    [side * upperLength * 0.23, -upperLength * 0.33, 0],
    [0, 0, side * 0.62],
  );

  const kneePivot = group(
    hipPivot,
    `generatedCrawler${sideName}${rowName}KneePivot`,
    [side * upperLength * 0.58, -upperLength * 0.8, 0],
  );
  kneePivot.userData.articulatedCrawlerJoint = true;
  kneePivot.userData.jointRole = 'knee';
  addBearingAssembly(kneePivot, materials, `generatedCrawler${sideName}${rowName}Knee`, [0, 0, 0], {
    radius: 0.115,
    width: 0.24,
  });
  taperedColumn(
    kneePivot,
    materials.primary,
    `generatedCrawler${sideName}${rowName}LowerScissorStrut`,
    0.065,
    0.11,
    lowerLength,
    [side * lowerLength * 0.16, -lowerLength * 0.45, 0],
    5,
    [0, 0, side * 0.34],
  );
  box(
    kneePivot,
    materials.trim,
    `generatedCrawler${sideName}${rowName}HockGuard`,
    [0.18, 0.16, 0.2],
    [side * lowerLength * 0.31, -lowerLength * 0.84, 0],
    [0, 0, side * 0.18],
  );

  const footPivot = group(
    kneePivot,
    `generatedCrawler${sideName}${rowName}FootPivot`,
    [side * lowerLength * 0.33, -lowerLength * 0.9, 0],
  );
  footPivot.userData.articulatedCrawlerJoint = true;
  footPivot.userData.jointRole = 'foot';
  const foot = mesh(
    footPivot,
    new THREE.OctahedronGeometry(0.18, 0),
    materials.secondary,
    `generatedCrawler${sideName}${rowName}FacetedFoot`,
    [0, 0.02, 0.08],
    null,
    [1.25, 0.62, 1.45],
  );
  foot.userData.articulatedCrawlerFoot = true;
  const skid = addDarkFootEnd(footPivot, materials, `generatedCrawler${sideName}${rowName}GroundSkid`, {
    size: [0.3, 0.055, 0.38],
    position: [0, -0.09, 0.08],
  });
  for (const [talonIndex, x] of [-0.09, 0.09].entries()) {
    const talon = mesh(
      footPivot,
      new THREE.ConeGeometry(0.04, 0.22, 5),
      materials.dark,
      `generatedCrawler${sideName}${rowName}GroundTalon${talonIndex + 1}`,
      [x, 0, 0.31],
      [Math.PI / 2, 0, 0],
    );
    talon.userData.reaverbotWorkingEnd = true;
  }

  return {
    role: 'articulatedCrawlerLeg',
    side,
    row,
    crawlerArticulated: true,
    pivot: hipPivot,
    hipPivot,
    kneePivot,
    footPivot,
    foot,
    contactAnchor: skid,
    phase: rowIndex * 1.7 + (side < 0 ? Math.PI : 0),
    restKneeX: row === 0 ? -0.08 : row > 0 ? 0.12 : -0.16,
  };
}

function createCrawlerWheelBogy(root, materials, {
  side,
  front,
  bodyWidth,
  bodyLength,
  bodyY,
}) {
  const sideName = side < 0 ? 'Left' : 'Right';
  const endName = front ? 'Front' : 'Rear';
  const wheelRadius = front ? 0.36 : 0.4;
  const assembly = group(
    root,
    `generatedCrawler${sideName}${endName}WheelBogy`,
    [side * bodyWidth * 0.58, bodyY - 0.34, (front ? 0.31 : -0.31) * bodyLength],
  );
  assembly.userData.wheelMobilityPart = true;
  const suspension = group(assembly, `generatedCrawler${sideName}${endName}SuspensionFork`);
  taperedColumn(
    suspension,
    materials.secondary,
    `generatedCrawler${sideName}${endName}SuspensionStrut`,
    0.075,
    0.11,
    0.46,
    [side * -0.08, 0.2, 0],
    6,
    [0, 0, side * -0.34],
  );
  addBearingAssembly(suspension, materials, `generatedCrawler${sideName}${endName}Axle`, [0, 0, 0], {
    radius: 0.13,
    width: 0.34,
  });

  const steerPivot = group(assembly, `generatedCrawler${sideName}${endName}WheelSteerPivot`);
  const spinPivot = group(steerPivot, `generatedCrawler${sideName}${endName}WheelSpinPivot`);
  const tire = mesh(
    spinPivot,
    new THREE.TorusGeometry(wheelRadius * 0.78, wheelRadius * 0.22, 8, 18),
    materials.dark,
    `generatedCrawler${sideName}${endName}WheelTireDarkWorkingEnd`,
    [0, 0, 0],
    [0, Math.PI / 2, 0],
  );
  tire.userData.reaverbotWorkingEnd = true;
  tire.userData.contactSurface = true;
  mesh(
    spinPivot,
    new THREE.CylinderGeometry(wheelRadius * 0.32, wheelRadius * 0.32, 0.28, 12),
    materials.trim,
    `generatedCrawler${sideName}${endName}WheelHubBearing`,
    [0, 0, 0],
    [0, 0, Math.PI / 2],
  );
  for (let spokeIndex = 0; spokeIndex < 6; spokeIndex += 1) {
    const spoke = box(
      spinPivot,
      materials.primary,
      `generatedCrawler${sideName}${endName}WheelSpoke${spokeIndex + 1}`,
      [0.12, wheelRadius * 1.24, 0.075],
      [0, 0, 0],
    );
    spoke.rotation.x = spokeIndex * Math.PI / 3;
  }
  mesh(
    assembly,
    new THREE.CylinderGeometry(wheelRadius * 0.92, wheelRadius * 0.92, 0.12, 10, 1, false, 0, Math.PI),
    materials.primary,
    `generatedCrawler${sideName}${endName}WheelFender`,
    [side * -0.02, wheelRadius * 0.36, 0],
    [0, 0, Math.PI / 2],
  );

  return {
    role: 'crawlerWheel',
    side,
    front,
    assembly,
    suspension,
    steerPivot,
    spinPivot,
    tire,
    radius: wheelRadius,
    baseSuspensionY: suspension.position.y,
  };
}

function createMaterials(genome) {
  const palette = genome.palette;
  const profile = resolveReaverbotTextureProfile(genome);
  const bodyId = genome.body.planId;
  const weaponId = genome.modules.weapon.id;
  const chargeId = genome.modules.charge?.id ?? null;
  const defenseId = genome.modules.defense?.id ?? 'integratedClawGuard';
  const weakPointId = genome.modules.weakPoint.id;
  const eyeId = genome.modules.eye.id;
  const bodyPrimary = mappedMaterial('material_generatedReaverbotPrimary', liftedPaletteColor(palette.primary, 0.32), {
    scope: 'body', moduleId: bodyId, slot: 'primary', mapKey: profile.body.primary,
  });
  const bodySecondary = mappedMaterial('material_generatedReaverbotSecondary', liftedPaletteColor(palette.secondary, 0.42), {
    scope: 'body', moduleId: bodyId, slot: 'secondary', mapKey: profile.body.secondary,
  });
  const bodyTrim = mappedMaterial('material_generatedReaverbotTrim', 0xffffff, {
    scope: 'body', moduleId: bodyId, slot: 'trim', mapKey: profile.body.trim,
    roughness: 0.66, metalness: 0.22,
  });
  const bodyJoint = mappedMaterial('material_generatedReaverbotSeam', liftedPaletteColor(palette.dark, 0.1), {
    scope: 'body', moduleId: bodyId, slot: 'joint', mapKey: profile.body.dark,
    roughness: 0.5, metalness: 0.34,
  });

  const weaponHull = mappedMaterial('material_generatedReaverbotWeapon', liftedPaletteColor(palette.secondary, 0.34), {
    scope: 'weapon', moduleId: weaponId, slot: 'housing',
    mapKey: textureSlot(profile.weapon, profile.decor, 'weapon'),
    roughness: 0.48, metalness: 0.42,
  });
  const weaponTrim = mappedMaterial('material_generatedReaverbotWeaponTrim', 0xffffff, {
    scope: 'weapon', moduleId: weaponId, slot: 'workingSurface',
    mapKey: textureSlot(profile.weapon, profile.decor, 'trim'),
    roughness: 0.4, metalness: 0.52,
  });
  const weaponJoint = mappedMaterial('material_generatedReaverbotWeaponJoint', liftedPaletteColor(palette.dark, 0.1), {
    scope: 'weapon', moduleId: weaponId, slot: 'joint',
    mapKey: textureSlot(profile.weapon, profile.decor, 'dark'),
    roughness: 0.48, metalness: 0.42,
  });
  const bodyGlowKey = textureSlot(profile.body, profile.decor, 'emissive');
  const bodyGlow = mappedMaterial('material_generatedReaverbotBodyGlow', palette.emissive, {
    scope: 'body', moduleId: bodyId, slot: 'emissive',
    mapKey: bodyGlowKey,
    emissiveMapKey: bodyGlowKey,
    emissive: palette.emissive,
    emissiveIntensity: 0.65,
    roughness: 0.26,
    metalness: 0.18,
  });
  const weaponGlowKey = textureSlot(profile.weapon, profile.decor, 'emissive');
  const weaponGlow = mappedMaterial('material_generatedReaverbotWeaponGlow', palette.emissive, {
    scope: 'weapon', moduleId: weaponId, slot: 'emissive',
    mapKey: weaponGlowKey,
    emissiveMapKey: weaponGlowKey,
    emissive: palette.emissive,
    emissiveIntensity: 0.65,
    roughness: 0.26,
    metalness: 0.18,
  });
  const bodyEnergyKey = textureSlot(profile.body, profile.decor, 'shieldEnergy');
  const bodyEnergy = mappedMaterial('material_generatedReaverbotBodyEnergy', palette.emissive, {
    scope: 'body', moduleId: bodyId, slot: 'energyField',
    mapKey: bodyEnergyKey,
    emissiveMapKey: bodyEnergyKey,
    alphaMapKey: bodyEnergyKey,
    emissive: palette.emissive,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.32,
    roughness: 0.2,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const weaponEnergyKey = textureSlot(profile.weapon, profile.decor, 'shieldEnergy');
  const weaponEnergy = mappedMaterial('material_generatedReaverbotWeaponEnergy', palette.emissive, {
    scope: 'weapon', moduleId: weaponId, slot: 'energyField',
    mapKey: weaponEnergyKey,
    emissiveMapKey: weaponEnergyKey,
    alphaMapKey: weaponEnergyKey,
    emissive: palette.emissive,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.32,
    roughness: 0.2,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const chargeProfile = profile.charge ?? profile.weapon;
  const chargeHull = chargeId ? mappedMaterial('material_generatedReaverbotChargeHull', liftedPaletteColor(palette.secondary, 0.34), {
    scope: 'charge', moduleId: chargeId, slot: 'housing',
    mapKey: textureSlot(chargeProfile, profile.decor, 'weapon'),
    roughness: 0.46, metalness: 0.44,
  }) : weaponHull;
  const chargeTrim = chargeId ? mappedMaterial('material_generatedReaverbotChargeTrim', 0xffffff, {
    scope: 'charge', moduleId: chargeId, slot: 'workingSurface',
    mapKey: textureSlot(chargeProfile, profile.decor, 'trim'),
    roughness: 0.38, metalness: 0.54,
  }) : weaponTrim;
  const chargeJoint = chargeId ? mappedMaterial('material_generatedReaverbotChargeJoint', liftedPaletteColor(palette.dark, 0.1), {
    scope: 'charge', moduleId: chargeId, slot: 'joint',
    mapKey: textureSlot(chargeProfile, profile.decor, 'dark'),
    roughness: 0.46, metalness: 0.44,
  }) : weaponJoint;
  const chargeGlowKey = textureSlot(chargeProfile, profile.decor, 'emissive');
  const chargeGlow = chargeId ? mappedMaterial('material_generatedReaverbotChargeGlow', palette.emissive, {
    scope: 'charge', moduleId: chargeId, slot: 'emissive',
    mapKey: chargeGlowKey,
    emissiveMapKey: chargeGlowKey,
    emissive: palette.emissive,
    emissiveIntensity: 0.8,
    roughness: 0.24,
    metalness: 0.2,
  }) : weaponGlow;

  const defenseProfile = profile.defense ?? profile.body;
  const defensePrimary = mappedMaterial('material_generatedReaverbotDefenseHull', liftedPaletteColor(palette.primary, 0.32), {
    scope: 'defense', moduleId: defenseId, slot: 'primary',
    mapKey: textureSlot(defenseProfile, profile.decor, 'primary'),
  });
  const defenseSecondary = mappedMaterial('material_generatedReaverbotDefenseSecondary', liftedPaletteColor(palette.secondary, 0.42), {
    scope: 'defense', moduleId: defenseId, slot: 'secondary',
    mapKey: textureSlot(defenseProfile, profile.decor, 'secondary'),
  });
  const defenseTrim = mappedMaterial('material_generatedReaverbotDefenseTrim', 0xffffff, {
    scope: 'defense', moduleId: defenseId, slot: 'trim',
    mapKey: textureSlot(defenseProfile, profile.decor, 'trim'),
    roughness: 0.58, metalness: 0.28,
  });
  const defenseJoint = mappedMaterial('material_generatedReaverbotDefenseJoint', liftedPaletteColor(palette.dark, 0.1), {
    scope: 'defense', moduleId: defenseId, slot: 'joint',
    mapKey: textureSlot(defenseProfile, profile.decor, 'dark'),
    roughness: 0.5, metalness: 0.34,
  });
  const defenseEnergyKey = textureSlot(defenseProfile, profile.decor, 'shieldEnergy');
  const shieldEnergy = mappedMaterial('material_generatedReaverbotEnergyDefense', palette.emissive, {
    scope: 'defense', moduleId: defenseId, slot: 'energyField',
    mapKey: defenseEnergyKey,
    emissiveMapKey: defenseEnergyKey,
    alphaMapKey: defenseEnergyKey,
    emissive: palette.emissive,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.32,
    roughness: 0.2,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const defenseGlowKey = textureSlot(defenseProfile, profile.decor, 'emissive');
  const defenseGlow = mappedMaterial('material_generatedReaverbotDefenseGlow', palette.emissive, {
    scope: 'defense', moduleId: defenseId, slot: 'emissive',
    mapKey: defenseGlowKey,
    emissiveMapKey: defenseGlowKey,
    emissive: palette.emissive,
    emissiveIntensity: 0.65,
    roughness: 0.26,
    metalness: 0.18,
  });

  const weakPointKey = textureSlot(profile.weakPoint, profile.decor, 'weakPoint');
  const weakPointCore = mappedMaterial('material_generatedReaverbotWeakPoint', palette.emissive, {
    scope: 'weakPoint', moduleId: weakPointId, slot: 'core',
    mapKey: weakPointKey,
    emissiveMapKey: weakPointKey,
    emissive: palette.emissive,
    emissiveIntensity: 1.2,
    roughness: 0.2,
    metalness: 0.08,
  });
  const weakPointJoint = mappedMaterial('material_generatedReaverbotWeakPointSocket', liftedPaletteColor(palette.dark, 0.1), {
    scope: 'weakPoint', moduleId: weakPointId, slot: 'socket',
    mapKey: textureSlot(profile.weakPoint, profile.decor, 'dark'),
    roughness: 0.46, metalness: 0.38,
  });
  const weakPointTrim = mappedMaterial('material_generatedReaverbotWeakPointTrim', 0xffffff, {
    scope: 'weakPoint', moduleId: weakPointId, slot: 'ring',
    mapKey: textureSlot(profile.weakPoint, profile.decor, 'trim'),
    roughness: 0.48, metalness: 0.36,
  });
  const weakPointGlowKey = textureSlot(profile.weakPoint, profile.decor, 'emissive');
  const weakPointGlow = mappedMaterial('material_generatedReaverbotWeakPointGlow', palette.emissive, {
    scope: 'weakPoint', moduleId: weakPointId, slot: 'emissive',
    mapKey: weakPointGlowKey,
    emissiveMapKey: weakPointGlowKey,
    emissive: palette.emissive,
    emissiveIntensity: 0.65,
    roughness: 0.26,
    metalness: 0.18,
  });
  const weakPointEnergyKey = textureSlot(profile.weakPoint, profile.decor, 'shieldEnergy');
  const weakPointEnergy = mappedMaterial('material_generatedReaverbotWeakPointEnergy', palette.emissive, {
    scope: 'weakPoint', moduleId: weakPointId, slot: 'energyField',
    mapKey: weakPointEnergyKey,
    emissiveMapKey: weakPointEnergyKey,
    alphaMapKey: weakPointEnergyKey,
    emissive: palette.emissive,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.32,
    roughness: 0.2,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const eyeSocketKey = textureSlot(profile.eye, profile.decor, 'eyeSocket');
  const eyeLensKey = textureSlot(profile.eye, profile.decor, 'eye');
  const eyeSocket = mappedMaterial('material_generatedReaverbotEyeSocket', 0x353535, {
    scope: 'eye', moduleId: eyeId, slot: 'socket', mapKey: eyeSocketKey,
    emissive: 0x090002, emissiveIntensity: 0.35, roughness: 0.34, metalness: 0.42,
  });
  const eyeLens = mappedMaterial('material_generatedReaverbotRedEye', REAVERBOT_EYE_COLOR, {
    scope: 'eye', moduleId: eyeId, slot: 'lens',
    mapKey: eyeLensKey,
    emissiveMapKey: eyeLensKey,
    emissive: REAVERBOT_EYE_COLOR,
    emissiveIntensity: 1.8,
    roughness: 0.14,
    metalness: 0.05,
  });
  const glint = new THREE.MeshBasicMaterial({
    color: 0xffe3c6,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  glint.name = 'material_generatedReaverbotEyeGlint';
  glint.userData.reaverbotTextureExempt = 'tiny procedural eye highlight';

  const decorPrimary = mappedMaterial('material_generatedReaverbotDecorArmor', liftedPaletteColor(palette.primary, 0.32), {
    scope: 'decor', moduleId: bodyId, slot: 'armor', mapKey: profile.decor.primary,
  });
  const decorSecondary = mappedMaterial('material_generatedReaverbotDecorSecondary', liftedPaletteColor(palette.secondary, 0.42), {
    scope: 'decor', moduleId: bodyId, slot: 'secondary', mapKey: profile.decor.secondary,
  });
  const decorTrim = mappedMaterial('material_generatedReaverbotDecorBlade', 0xffffff, {
    scope: 'decor', moduleId: bodyId, slot: 'spike', mapKey: 'bladeMetal',
    roughness: 0.42, metalness: 0.48,
  });
  const decorDark = mappedMaterial('material_generatedReaverbotDecorInlay', liftedPaletteColor(palette.dark, 0.1), {
    scope: 'decor', moduleId: bodyId, slot: 'inlay', mapKey: profile.decor.dark,
    roughness: 0.46, metalness: 0.36,
  });
  const bossDecor = profile.boss ? {
    primary: mappedMaterial('material_generatedReaverbotBossDecorArmor', liftedPaletteColor(palette.primary, 0.32), {
      scope: 'bossDecor', moduleId: genome.bossProfileId, slot: 'armor', mapKey: profile.boss.primary,
    }),
    secondary: mappedMaterial('material_generatedReaverbotBossDecorSecondary', liftedPaletteColor(palette.secondary, 0.42), {
      scope: 'bossDecor', moduleId: genome.bossProfileId, slot: 'secondary', mapKey: profile.boss.secondary,
    }),
    trim: mappedMaterial('material_generatedReaverbotBossOrnateTrim', 0xffffff, {
      scope: 'bossDecor', moduleId: genome.bossProfileId, slot: 'ornateTrim', mapKey: profile.boss.trim,
      roughness: 0.42, metalness: 0.48,
    }),
    dark: decorDark,
    emissive: mappedMaterial('material_generatedReaverbotBossDecorEmissive', palette.emissive, {
      scope: 'bossDecor', moduleId: genome.bossProfileId, slot: 'emissive',
      mapKey: profile.boss.emissive,
      emissiveMapKey: profile.boss.emissive,
      emissive: palette.emissive,
      emissiveIntensity: 0.9,
      roughness: 0.24,
      metalness: 0.2,
    }),
  } : null;

  const materials = {
    primary: bodyPrimary,
    secondary: bodySecondary,
    trim: bodyTrim,
    dark: bodyJoint,
    weapon: weaponHull,
    emissive: weaponGlow,
    weakPoint: weakPointCore,
    eyeSocket,
    eye: eyeLens,
    glint,
    shieldEnergy,
    textureProfile: profile,
    scopes: {
      body: { primary: bodyPrimary, secondary: bodySecondary, trim: bodyTrim, dark: bodyJoint, emissive: bodyGlow, shieldEnergy: bodyEnergy },
      eye: { eyeSocket, eye: eyeLens, glint },
      weapon: { weapon: weaponHull, trim: weaponTrim, dark: weaponJoint, emissive: weaponGlow, shieldEnergy: weaponEnergy },
      charge: { weapon: chargeHull, trim: chargeTrim, dark: chargeJoint, emissive: chargeGlow },
      defense: {
        primary: defensePrimary,
        secondary: defenseSecondary,
        trim: defenseTrim,
        dark: defenseJoint,
        emissive: defenseGlow,
        shieldEnergy,
      },
      weakPoint: {
        weakPoint: weakPointCore,
        dark: weakPointJoint,
        trim: weakPointTrim,
        eyeSocket,
        eye: eyeLens,
        glint,
        emissive: weakPointGlow,
        shieldEnergy: weakPointEnergy,
      },
      decor: {
        primary: decorPrimary,
        secondary: decorSecondary,
        trim: decorTrim,
        dark: decorDark,
        emissive: bodyGlow,
      },
      bossDecor,
    },
  };
  return materials;
}

function createBodyFrame(root, genome, materials) {
  const plan = genome.body.planId;
  const p = genome.body.proportions;
  const mobilityId = genome.body.mobilityId ?? (plan === 'hopper' ? 'pairedSprings' : 'standard');
  const springLoaded = genome.body.movementModel === 'springBounce'
    || ['springQuadruped', 'pairedSprings', 'monoPogo'].includes(mobilityId);
  const mobilityWeaponId = genome.modules.weapon.integratedIntoMobility
    ? genome.modules.weapon.id
    : 'pounceActuator';
  const frame = {
    plan,
    limbs: [],
    wings: [],
    body: null,
    head: null,
    headAssembly: null,
    tailPivot: null,
    gait: null,
    mobilityId,
    springLimbs: [],
    springMobility: null,
    wheels: [],
    wheelMobility: null,
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
      addDarkFootEnd(foot, materials, side < 0 ? 'generatedLeftToeCap' : 'generatedRightToeCap', {
        size: [0.32, 0.15, 0.2],
        position: [0, -0.025, 0.28],
      });
      box(hip, materials.trim, side < 0 ? 'generatedLeftAnkleBand' : 'generatedRightAnkleBand', [0.27, 0.1, 0.25], [0, -1.03 * p.limbLength, 0.04]);
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
  } else if (plan === 'quadruped') {
    const bodyY = 1.08;
    const bodyWidth = 0.9 * p.torsoWidth;
    const bodyLength = 1.58 * p.torsoLength;
    const chestLength = bodyLength * 0.58;
    const pelvisLength = bodyLength * 0.34;
    frame.body = group(root, 'generatedCanineTorsoAssembly', [0, bodyY, 0]);
    frame.body.userData.articulatedCanineChassis = true;
    box(
      frame.body,
      materials.primary,
      'generatedReaverbotAnimalTorso',
      [bodyWidth, 0.62, chestLength],
      [0, 0.02, bodyLength * 0.17],
    );
    box(
      frame.body,
      materials.secondary,
      'generatedCaninePelvisArmor',
      [bodyWidth * 0.8, 0.48, pelvisLength],
      [0, -0.05, -bodyLength * 0.35],
    );
    box(
      frame.body,
      materials.dark,
      'generatedCanineDarkSpineBridge',
      [bodyWidth * 0.48, 0.22, bodyLength * 0.34],
      [0, 0.04, -bodyLength * 0.08],
    );
    box(
      frame.body,
      materials.primary,
      'generatedCanineShoulderYoke',
      [bodyWidth * 1.08, 0.26, bodyLength * 0.22],
      [0, 0.23, bodyLength * 0.32],
    );
    box(
      frame.body,
      materials.primary,
      'generatedCanineHipYoke',
      [bodyWidth * 0.9, 0.23, bodyLength * 0.2],
      [0, 0.18, -bodyLength * 0.34],
    );
    for (const side of [-1, 1]) {
      box(
        frame.body,
        materials.trim,
        side < 0 ? 'generatedCanineLeftRibArmorBand' : 'generatedCanineRightRibArmorBand',
        [0.08, 0.48, chestLength * 0.72],
        [side * bodyWidth * 0.51, 0.02, bodyLength * 0.16],
        [0, 0, side * 0.06],
      );
    }

    const neck = group(root, 'generatedReaverbotNeck', [0, bodyY + 0.08, bodyLength * 0.45]);
    taperedColumn(
      neck,
      materials.dark,
      'generatedCanineLowerNeckLink',
      0.18,
      0.24,
      0.52,
      [0, 0.12, 0.18],
      6,
      [Math.PI * 0.3, 0, 0],
    );
    const headPivot = group(neck, 'generatedCanineHeadPivot', [0, 0.28, 0.34]);
    headPivot.userData.articulatedCanineJoint = true;
    headPivot.userData.jointRole = 'neck';
    frame.headAssembly = headPivot;
    addBearingAssembly(headPivot, materials, 'generatedCanineNeckBearing', [0, 0, 0], {
      radius: 0.18,
      width: bodyWidth * 0.58,
    });
    frame.head = box(
      headPivot,
      materials.secondary,
      'generatedReaverbotAnimalHead',
      [bodyWidth * 0.74, 0.48 * p.headScale, 0.76 * p.headScale],
      [0, 0.06, 0.38],
    );
    box(
      headPivot,
      materials.primary,
      'generatedCanineBrowArmor',
      [bodyWidth * 0.82, 0.2, 0.46 * p.headScale],
      [0, 0.24 * p.headScale, 0.32],
    );
    box(
      headPivot,
      materials.dark,
      'generatedCanineMuzzleRecess',
      [bodyWidth * 0.48, 0.22, 0.34 * p.headScale],
      [0, -0.05, 0.72 * p.headScale],
    );

    for (const side of [-1, 1]) {
      const frontLeg = createCanineLeg(root, materials, {
        side,
        front: true,
        bodyWidth,
        bodyLength,
        bodyY,
        limbScale: p.limbLength,
        springLoaded,
        mobilityWeaponId,
      });
      const rearLeg = createCanineLeg(root, materials, {
        side,
        front: false,
        bodyWidth,
        bodyLength,
        bodyY,
        limbScale: p.limbLength,
        springLoaded,
        mobilityWeaponId,
      });
      frame.limbs.push(frontLeg, rearLeg);
      if (springLoaded) frame.springLimbs.push(frontLeg, rearLeg);
    }

    if (springLoaded) {
      frame.springMobility = {
        id: mobilityId,
        movementModel: 'springBounce',
        legCount: frame.springLimbs.length,
        integratedWeaponId: mobilityWeaponId,
      };
    }

    frame.tailPivot = group(
      root,
      'generatedCanineTailPivot',
      [0, bodyY + 0.06, -bodyLength * 0.53],
    );
    frame.tailPivot.userData.articulatedCanineJoint = true;
    frame.tailPivot.userData.jointRole = 'tail';
    taperedColumn(
      frame.tailPivot,
      materials.secondary,
      'generatedReaverbotTail',
      0.055,
      0.16,
      0.76,
      [0, 0, -0.36],
      6,
      [Math.PI * 0.5, 0, 0],
    );
    mesh(
      frame.tailPivot,
      new THREE.ConeGeometry(0.09, 0.32, 5),
      materials.dark,
      'generatedCanineTailDarkWorkingEnd',
      [0, 0, -0.82],
      [-Math.PI * 0.5, 0, 0],
    );
    frame.gait = {
      phase: 0,
      activity: 0,
      initialized: false,
      lastWorldPosition: new THREE.Vector3(),
      direction: new THREE.Vector2(0, 1),
      targetDirection: new THREE.Vector2(0, 1),
      strideLength: 0.62,
      stanceFraction: 0.58,
      stanceDiagonal: 'leftFront+rightRear',
      bodyRoll: 0,
      bob: 0,
    };
    const eyeZ = bodyLength * 0.45 + 0.72 + 0.38 * p.headScale;
    const frontMountZ = bodyLength * 0.45 + 0.7;
    frame.anchors = {
      eye: [0, bodyY + 0.54, eyeZ],
      weapon: [0, bodyY + 0.28, frontMountZ],
      defense: [-bodyWidth * 0.56, bodyY + 0.14, bodyLength * 0.2],
      center: [0, bodyY, 0],
      rear: [0, bodyY + 0.02, -bodyLength * 0.54],
      rearHigh: [0, bodyY + 0.32, -bodyLength * 0.42],
      belly: [0, bodyY - 0.35, -bodyLength * 0.02],
      leg: [-bodyWidth * 0.53, 0.52, bodyLength * 0.32],
      side: [bodyWidth * 0.56, bodyY, 0],
      frontLow: [0, bodyY - 0.08, bodyLength * 0.56],
      frontSide: [-bodyWidth * 0.5, bodyY + 0.12, bodyLength * 0.48],
    };
  } else if (plan === 'crawler') {
    const bodyY = 0.78;
    const bodyWidth = 1.2 * p.torsoWidth;
    const bodyLength = 1.48 * p.torsoLength;
    const wheeled = mobilityId === 'wheelBogies';
    frame.body = group(root, 'generatedCrawlerChassisAssembly', [0, bodyY, 0]);
    frame.body.userData.layeredCrawlerChassis = true;
    frame.body.userData.mobilityId = mobilityId;
    mesh(
      frame.body,
      new THREE.CylinderGeometry(0.48, 0.6, bodyLength * 0.74, 6),
      materials.primary,
      'generatedCrawlerFacetedCentralKeel',
      [0, 0.01, 0.02],
      [Math.PI / 2, 0, 0],
      [bodyWidth * 0.9, 1, 0.64],
    );
    mesh(
      frame.body,
      new THREE.DodecahedronGeometry(0.5, 0),
      materials.secondary,
      'generatedCrawlerFrontCarapace',
      [0, 0.1, bodyLength * 0.28],
      null,
      [bodyWidth * 1.04, 0.68, bodyLength * 0.72],
    );
    const rearEngine = taperedColumn(
      frame.body,
      materials.secondary,
      'generatedCrawlerRearEnginePod',
      0.34,
      0.48,
      bodyLength * 0.46,
      [0, 0.03, -bodyLength * 0.34],
      8,
      [Math.PI / 2, 0, 0],
    );
    rearEngine.scale.x = bodyWidth * 0.9;
    rearEngine.scale.z = 0.72;
    box(
      frame.body,
      materials.dark,
      'generatedCrawlerDarkUndershell',
      [bodyWidth * 0.68, 0.2, bodyLength * 0.76],
      [0, -0.31, -bodyLength * 0.02],
    );
    box(
      frame.body,
      materials.dark,
      'generatedCrawlerDorsalSpineChannel',
      [bodyWidth * 0.22, 0.16, bodyLength * 0.68],
      [0, 0.35, -bodyLength * 0.02],
    );
    taperedColumn(
      frame.body,
      materials.trim,
      'generatedCrawlerWeaponSaddle',
      bodyWidth * 0.2,
      bodyWidth * 0.28,
      0.24,
      [0, 0.4, bodyLength * 0.06],
      6,
    );
    for (const side of [-1, 1]) {
      const sideName = side < 0 ? 'Left' : 'Right';
      box(
        frame.body,
        materials.primary,
        `generatedCrawler${sideName}LayeredFlankArmor`,
        [0.16, 0.44, bodyLength * 0.62],
        [side * bodyWidth * 0.46, 0.01, -bodyLength * 0.02],
        [0, side * 0.05, side * 0.08],
      );
      addCircuitPanel(frame.body, materials, `generatedCrawler${sideName}Drive`, {
        position: [side * bodyWidth * 0.55, 0.04, -bodyLength * 0.08],
        rotation: [0, side * Math.PI / 2, 0],
        width: bodyLength * 0.34,
        height: 0.28,
        mirror: side < 0,
        powered: wheeled,
      });
    }

    const neck = group(root, 'generatedCrawlerNeckAssembly', [0, bodyY + 0.08, bodyLength * 0.43]);
    frame.headAssembly = neck;
    taperedColumn(
      neck,
      materials.dark,
      'generatedCrawlerAngledNeckLink',
      0.16,
      0.24,
      0.46,
      [0, 0.12, 0.16],
      6,
      [Math.PI * 0.3, 0, 0],
    );
    addBearingAssembly(neck, materials, 'generatedCrawlerNeck', [0, 0.25, 0.28], {
      radius: 0.17,
      width: bodyWidth * 0.52,
    });
    frame.head = group(neck, 'generatedCrawlerHeadAssembly', [0, 0.28, 0.32]);
    frame.head.userData.layeredCrawlerHead = true;
    mesh(
      frame.head,
      new THREE.DodecahedronGeometry(0.4, 0),
      materials.secondary,
      'generatedCrawlerFacetedCranium',
      [0, 0.08, 0.16],
      null,
      [bodyWidth * 0.84, 0.68 * p.headScale, 0.9 * p.headScale],
    );
    const snout = taperedColumn(
      frame.head,
      materials.primary,
      'generatedCrawlerTaperedSensorSnout',
      0.24,
      0.34,
      0.58 * p.headScale,
      [0, -0.02, 0.48 * p.headScale],
      5,
      [Math.PI / 2, 0, 0],
    );
    snout.scale.x = bodyWidth * 0.86;
    snout.scale.z = 0.62;
    box(
      frame.head,
      materials.dark,
      'generatedCrawlerMuzzleRecess',
      [bodyWidth * 0.38, 0.16, 0.12],
      [0, -0.06, 0.79 * p.headScale],
    );
    for (const side of [-1, 1]) {
      const sideName = side < 0 ? 'Left' : 'Right';
      const brow = box(
        frame.head,
        materials.primary,
        `generatedCrawler${sideName}AngledBrowArmor`,
        [bodyWidth * 0.43, 0.16, 0.38],
        [side * bodyWidth * 0.2, 0.26 * p.headScale, 0.27],
        [0, side * 0.16, side * 0.08],
      );
      brow.userData.crawlerHeadComponent = true;
      mesh(
        frame.head,
        new THREE.OctahedronGeometry(0.18, 0),
        materials.trim,
        `generatedCrawler${sideName}CheekPod`,
        [side * bodyWidth * 0.4, -0.04, 0.28],
        null,
        [0.78, 1.15, 1.1],
      );
    }

    if (wheeled) {
      for (const side of [-1, 1]) {
        for (const front of [true, false]) {
          frame.wheels.push(createCrawlerWheelBogy(root, materials, {
            side,
            front,
            bodyWidth,
            bodyLength,
            bodyY,
          }));
        }
      }
      frame.wheelMobility = {
        id: mobilityId,
        movementModel: 'wheelDrive',
        wheelCount: frame.wheels.length,
        initialized: false,
        lastWorldPosition: new THREE.Vector3(),
        steering: 0,
        distanceTravelled: 0,
      };
    } else {
      for (const side of [-1, 1]) {
        for (const row of [1, 0, -1]) {
          frame.limbs.push(createCrawlerArticulatedLeg(root, materials, {
            side,
            row,
            bodyWidth,
            bodyLength,
            bodyY,
            limbScale: p.limbLength,
          }));
        }
      }
    }

    frame.tailPivot = group(root, 'generatedCrawlerTailPivot', [0, bodyY + 0.05, -bodyLength * 0.52]);
    addJoint(frame.tailPivot, materials, 'crawlerTail', [0, 0, 0], 0.12);
    taperedColumn(
      frame.tailPivot,
      materials.secondary,
      'generatedCrawlerSegmentedTail',
      0.05,
      0.16,
      0.72,
      [0, 0, -0.34],
      6,
      [Math.PI / 2, 0, 0],
    );
    mesh(
      frame.tailPivot,
      new THREE.ConeGeometry(0.08, 0.28, 5),
      materials.dark,
      'generatedCrawlerTailSpike',
      [0, 0, -0.82],
      [-Math.PI / 2, 0, 0],
    );

    const eyeZ = bodyLength * 0.43 + 0.32 + 0.79 * p.headScale;
    frame.anchors = {
      eye: [0, bodyY + 0.51, eyeZ],
      weapon: [0, bodyY + 0.34, bodyLength * 0.68],
      defense: [-bodyWidth * 0.54, bodyY + 0.12, bodyLength * 0.18],
      center: [0, bodyY, 0],
      rear: [0, bodyY + 0.03, -bodyLength * 0.58],
      rearHigh: [0, bodyY + 0.36, -bodyLength * 0.4],
      belly: [0, bodyY - 0.36, 0],
      leg: [-bodyWidth * 0.56, wheeled ? bodyY - 0.34 : 0.34, bodyLength * 0.31],
      side: [bodyWidth * 0.58, bodyY, 0],
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
      addBearingAssembly(leg, materials, 'generatedTripodLegSocket', [0, 0, 0], {
        radius: 0.17,
        width: 0.26,
        rotation: [0, 0, Math.PI / 2],
      });
      taperedColumn(leg, materials.secondary, 'generatedTripodUpperLeg', 0.11, 0.18, 0.74 * p.limbLength, [0, -0.34, 0.12], 5, [-0.16, 0, 0]);
      const foot = box(leg, materials.primary, 'generatedTripodFoot', [0.42, 0.18, 0.58], [0, -0.75 * p.limbLength, 0.26]);
      addDarkFootEnd(foot, materials, 'generatedTripodToeCap', {
        size: [0.37, 0.13, 0.2],
        position: [0, -0.02, 0.29],
      });
      frame.limbs.push({ pivot: leg, phase: index - 1 });
    }
    frame.anchors = {
      eye: [0, bodyY + 0.63, 0.31], weapon: [0.45, bodyY + 0.3, 0.14], defense: [-0.55, bodyY + 0.12, 0.3],
      center: [0, bodyY, 0], rear: [0, bodyY, -0.62], rearHigh: [0, bodyY + 0.32, -0.5], belly: [0, bodyY - 0.34, 0.05],
      leg: [-0.5, 0.62, 0.2], side: [0.64, bodyY, 0], frontLow: [0, bodyY - 0.18, 0.58], frontSide: [-0.5, bodyY, 0.42],
    };
  } else if (plan === 'hopper') {
    const launchLeg = mobilityId === 'launchLeg';
    const bodyY = launchLeg ? 3.18 : 1.08;
    const monoPogo = mobilityId === 'monoPogo';
    frame.body = mesh(
      root,
      new THREE.OctahedronGeometry(0.62, 0),
      materials.primary,
      'generatedReaverbotHopperBody',
      [0, bodyY, 0],
      null,
      launchLeg
        ? [p.torsoWidth * 1.24, 1.08, p.torsoLength * 1.16]
        : [p.torsoWidth, 0.9, p.torsoLength],
    );
    frame.head = taperedColumn(
      root,
      materials.secondary,
      'generatedReaverbotHopperHead',
      launchLeg ? 0.26 : 0.22,
      launchLeg ? 0.38 : 0.32,
      launchLeg ? 0.68 : 0.6,
      [0, bodyY + (launchLeg ? 0.68 : 0.6), 0.05],
      6,
    );
    if (launchLeg) {
      box(
        root,
        materials.primary,
        'generatedLaunchLegChassisHipYoke',
        [1.32, 0.38, 0.84],
        [0, bodyY - 0.36, -0.05],
      );
      box(
        root,
        materials.dark,
        'generatedLaunchLegChassisDarkUnderside',
        [0.82, 0.26, 0.72],
        [0, bodyY - 0.5, -0.02],
      );
    }
    const springSlots = launchLeg ? [] : monoPogo ? [0] : [-1, 1];
    for (const side of springSlots) {
      const legName = monoPogo
        ? 'generatedHopperMonoPogoLeg'
        : side < 0 ? 'generatedHopperLeftSpringLeg' : 'generatedHopperRightSpringLeg';
      const leg = group(root, legName, [monoPogo ? 0 : side * 0.34, bodyY - 0.34, 0]);
      leg.userData.springLoaded = true;
      leg.userData.replacesStandardLocomotion = true;
      addBearingAssembly(leg, materials, 'generatedHopperSpringBearing', [0, 0, 0], {
        radius: monoPogo ? 0.23 : 0.17,
        width: monoPogo ? 0.34 : 0.22,
        rotation: [0, 0, Math.PI / 2],
      });
      const springLength = monoPogo ? 0.72 : 0.64;
      const spring = createCompressionSpring(leg, materials, `generatedHopper${monoPogo ? 'MonoPogo' : side < 0 ? 'Left' : 'Right'}`, {
        length: springLength,
        radius: monoPogo ? 0.24 : 0.16,
        ringCount: monoPogo ? 5 : 4,
        mobilityWeaponId,
      });
      const foot = box(
        leg,
        materials.primary,
        monoPogo ? 'generatedHopperMonoPogoLandingPad' : 'generatedHopperFoot',
        monoPogo ? [0.78, 0.22, 0.76] : [0.38, 0.2, 0.54],
        [0, -springLength, 0.14],
      );
      addDarkFootEnd(foot, materials, 'generatedHopperLandingPad', {
        size: monoPogo ? [0.7, 0.12, 0.68] : [0.34, 0.12, 0.48],
        position: [0, -0.1, 0],
      });
      const limb = {
        role: monoPogo ? 'monoPogoLeg' : 'hopperSpringLeg',
        pivot: leg,
        phase: side || 1,
        springLoaded: true,
        springGroup: spring.group,
        springCoils: spring.rings,
        springEndpoint: foot,
        springEndpointBaseY: foot.position.y,
        springCompressionTravel: springLength * 0.3,
        contactAnchor: foot,
      };
      frame.limbs.push(limb);
      frame.springLimbs.push(limb);
    }
    frame.springMobility = {
      id: mobilityId,
      movementModel: 'springBounce',
      legCount: launchLeg ? genome.body.mobilityLegCount : frame.springLimbs.length,
      integratedWeaponId: mobilityWeaponId,
    };
    const launchMountSide = Math.sign(genome.modules.weapon.mountSide || 1);
    frame.anchors = {
      eye: [0, bodyY + (launchLeg ? 0.7 : 0.63), launchLeg ? 0.34 : 0.3],
      weapon: [0, bodyY + 0.15, 0.52],
      defense: [-0.46, bodyY + 0.05, 0.24],
      center: [0, bodyY, 0], rear: [0, bodyY, -0.58], rearHigh: [0, bodyY + 0.3, -0.42], belly: [0, bodyY - 0.47, 0],
      leg: launchLeg
        ? [launchMountSide * 0.42, bodyY - 0.12, -0.08]
        : [monoPogo ? 0 : -0.34, 0.48, 0],
      side: [launchLeg ? 0.68 : 0.52, bodyY, 0],
      frontLow: [0, bodyY - 0.18, 0.5],
      frontSide: [launchLeg ? -0.56 : -0.42, bodyY, 0.36],
    };
  } else {
    const flyer = plan === 'flyer';
    const bodyY = flyer ? 0.48 : 0.62;
    frame.body = flyer
      ? mesh(root, new THREE.DodecahedronGeometry(0.52, 0), materials.primary, 'generatedReaverbotFlyerArmorFace', [0, bodyY, 0], null, [1.2 * p.torsoWidth, 0.82, 1])
      : taperedColumn(root, materials.primary, 'generatedReaverbotHoverBell', 0.46 * p.torsoWidth, 0.72 * p.torsoWidth, 0.88, [0, bodyY, 0], 8);
    frame.head = taperedColumn(root, materials.secondary, 'generatedReaverbotHoverHead', 0.2, 0.3, 0.55, [0, bodyY + 0.64, 0], 6);

    const wingCount = flyer ? 4 : 3;
    for (let index = 0; index < wingCount; index += 1) {
      const angle = index * Math.PI * 2 / wingCount;
      const wing = group(root, `generatedHoverFin${index}`, [Math.sin(angle) * 0.36, bodyY + 0.05, Math.cos(angle) * 0.36]);
      wing.rotation.y = angle;
      const blade = box(wing, index % 2 ? materials.primary : materials.trim, 'generatedHoverBlade', [flyer ? 0.42 : 0.3, 0.1, flyer ? 1.25 : 0.82], [0, 0, flyer ? 0.58 : 0.4]);
      blade.rotation.x = flyer ? (index % 2 ? 0.13 : -0.13) : 0;
      addDarkFootEnd(blade, materials, 'generatedHoverBladeTip', {
        size: [flyer ? 0.38 : 0.27, 0.12, flyer ? 0.25 : 0.2],
        position: [0, 0, flyer ? 0.61 : 0.39],
      });
      addBearingAssembly(wing, materials, 'generatedHoverFinRoot', [0, 0, 0], {
        radius: flyer ? 0.16 : 0.13,
        width: 0.16,
        rotation: [Math.PI / 2, 0, 0],
      });
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
  const integratedMobility = id === 'pounceActuator'
    || genome.modules.weapon.integratedIntoMobility === true;
  const anchor = id === 'launchLeg'
    ? frame.anchors.leg
    : id === 'tractorMagnet' || integratedMobility
      ? frame.anchors.belly
      : frame.anchors.weapon;
  const weapon = group(root, `generatedWeapon_${id}`, anchor);
  if (!integratedMobility
    && (frame.plan === 'quadruped' || frame.plan === 'crawler')
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
    clawPalmBackAnchor: null,
    clawTalonPivots: [],
    clawReachSocket: null,
    clawArmAssembly: null,
    clawBrokenStump: null,
    clawMountSide: 1,
    clawBaseReach: 0,
    clawMaxReach: 0,
    launchLegAssembly: null,
    launchLegHipPivot: null,
    launchLegKneePivot: null,
    launchLegAnklePivot: null,
    launchLegFootPivot: null,
    launchLegFoot: null,
    launchLegContactAnchor: null,
    launchLegShockStack: null,
    launchLegShockBands: [],
    launchLegBoosters: [],
    launchLegBoosterNozzles: [],
    launchLegFlames: [],
    launchLegClaws: [],
    launchLegMountSide: 1,
    jawUpperPivot: null,
    jawLowerPivot: null,
    jawVariant: null,
    tractorBeam: null,
    tractorBeamMaterial: null,
    tractorRings: [],
    tractorDirection: new THREE.Vector3(0, -1, 0),
    integratedIntoMobility: integratedMobility,
  };

  if (id === 'rocketLance') {
    if (frame.plan === 'biped' || frame.plan === 'lowBiped') {
      weapon.position.set(0, frame.anchors.center[1] + 0.08, frame.anchors.frontLow[2]);
    }
    addBearingAssembly(weapon, materials, 'generatedRocketLanceMount', [0, 0, 0.02], {
      radius: 0.26,
      width: 0.28,
      rotation: [0, 0, Math.PI / 2],
    });
    mesh(weapon, new THREE.ConeGeometry(0.2, 1.02, 7), materials.weapon, 'generatedRocketLanceArmorShaft', [0, 0, 0.55], [Math.PI / 2, 0, 0]);
    mesh(weapon, new THREE.ConeGeometry(0.12, 0.52, 7), materials.dark, 'generatedRocketLanceDarkWorkingTip', [0, 0, 1.28], [Math.PI / 2, 0, 0]);
    mesh(weapon, new THREE.TorusGeometry(0.23, 0.045, 6, 12), materials.trim, 'generatedRocketLanceMechanicalBand', [0, 0, 0.24]);
    muzzle.position.set(0, 0, 1.55);
  } else if (id === 'crusherJaw') {
    // A huge two-piece bear-trap mouth. Each half hinges at the skull instead
    // of being a small decorative box fixed in front of it. The canine cage
    // mutation keeps the same gameplay pivots while changing the authored
    // silhouette to a long, spike-lined mechanical hound muzzle.
    const jawVariant = genome.modules.weapon.jawVariant ?? 'crusherTrap';
    const canineFangCage = jawVariant === 'canineFangCage';
    const jawLength = canineFangCage ? 1.92 : 1.62;
    const jawHalfWidth = canineFangCage ? 0.67 : 0.6;
    const hingeWidth = canineFangCage ? 1.76 : 1.58;
    const jawTipZ = jawLength - 0.05;
    weapon.position.y -= canineFangCage ? 0.13 : 0.16;
    weapon.userData.jawVariant = jawVariant;
    parts.jawVariant = jawVariant;
    const hinge = mesh(
      weapon,
      new THREE.CylinderGeometry(
        canineFangCage ? 0.22 : 0.19,
        canineFangCage ? 0.22 : 0.19,
        hingeWidth,
        10,
      ),
      materials.dark,
      'generatedCrusherJawHinge',
      [0, 0, -0.02],
      [0, 0, Math.PI / 2],
    );
    hinge.userData.massiveWeaponPart = true;
    for (const side of [-1, 1]) {
      mesh(
        weapon,
        new THREE.CylinderGeometry(0.25, 0.25, 0.1, 10),
        materials.trim,
        'generatedCrusherJawHingeEndCap',
        [side * (hingeWidth * 0.52), 0, -0.02],
        [0, 0, Math.PI / 2],
      );
    }
    const upperPivot = group(weapon, 'generatedCrusherUpperJawPivot', [0, 0.04, 0]);
    const lowerPivot = group(weapon, 'generatedCrusherLowerJawPivot', [0, -0.04, 0]);
    const upper = group(upperPivot, 'generatedCrusherUpperJawBlade');
    const lower = group(lowerPivot, 'generatedCrusherLowerJawBlade');
    for (const side of [-1, 1]) {
      box(
        upper,
        materials.weapon,
        'generatedCrusherUpperJawSideBlade',
        [canineFangCage ? 0.32 : 0.28, canineFangCage ? 0.27 : 0.24, jawLength],
        [side * jawHalfWidth, 0.08, jawLength * 0.5],
      );
      box(
        lower,
        materials.weapon,
        'generatedCrusherLowerJawSideBlade',
        [canineFangCage ? 0.32 : 0.28, canineFangCage ? 0.27 : 0.24, jawLength],
        [side * jawHalfWidth, -0.08, jawLength * 0.5],
      );
      box(upper, materials.dark, 'generatedCrusherUpperJawDarkInterior', [0.13, 0.14, jawLength * 0.82], [side * jawHalfWidth, -0.06, jawLength * 0.52]);
      box(lower, materials.dark, 'generatedCrusherLowerJawDarkInterior', [0.13, 0.14, jawLength * 0.82], [side * jawHalfWidth, 0.06, jawLength * 0.52]);
      box(upper, materials.dark, 'generatedCrusherUpperJawDarkWorkingEnd', [0.34, 0.29, 0.22], [side * jawHalfWidth, 0.08, jawTipZ]);
      box(lower, materials.dark, 'generatedCrusherLowerJawDarkWorkingEnd', [0.34, 0.29, 0.22], [side * jawHalfWidth, -0.08, jawTipZ]);
      addCircuitPanel(upper, materials, `generatedCrusherUpperJaw${side < 0 ? 'Left' : 'Right'}`, {
        position: [side * (jawHalfWidth + 0.15), 0.14, jawLength * 0.44],
        rotation: [0, side * Math.PI / 2, 0],
        width: canineFangCage ? 0.72 : 0.62,
        height: 0.18,
        mirror: side < 0,
        powered: false,
      });
    }
    const crossbarWidth = jawHalfWidth * 2 + 0.28;
    box(upper, materials.weapon, 'generatedCrusherUpperJawHingeBlade', [crossbarWidth, 0.24, 0.24], [0, 0.08, 0.1]);
    box(lower, materials.weapon, 'generatedCrusherLowerJawHingeBlade', [crossbarWidth, 0.24, 0.24], [0, -0.08, 0.1]);
    upper.userData.massiveWeaponPart = true;
    lower.userData.massiveWeaponPart = true;
    box(upperPivot, materials.trim, 'generatedCrusherUpperRazorEdge', [crossbarWidth + 0.14, 0.1, 0.16], [0, -0.1, jawTipZ]);
    box(lowerPivot, materials.trim, 'generatedCrusherLowerRazorEdge', [crossbarWidth + 0.14, 0.1, 0.16], [0, 0.1, jawTipZ]);

    if (canineFangCage) {
      const eyeSightlineGap = 0.38;
      const snoutPanelWidth = (crossbarWidth - eyeSightlineGap) * 0.5;
      for (const side of [-1, 1]) {
        box(
          upper,
          materials.weapon,
          'generatedCanineFangCageUpperSnoutArmor',
          [snoutPanelWidth, 0.3, 0.74],
          [side * (eyeSightlineGap + snoutPanelWidth) * 0.5, 0.22, 0.43],
        );
      }
      box(
        lower,
        materials.weapon,
        'generatedCanineFangCageLowerChinArmor',
        [crossbarWidth, 0.28, 0.62],
        [0, -0.2, 0.5],
      );
      for (const side of [-1, 1]) {
        box(
          upper,
          materials.trim,
          'generatedCanineFangCageCheekPlate',
          [0.12, 0.48, 0.66],
          [side * (jawHalfWidth + 0.19), 0.02, 0.46],
        );
        for (const [fangIndex, fangZ] of [0.62, jawLength * 0.78].entries()) {
          const upperFang = mesh(
            upperPivot,
            new THREE.ConeGeometry(0.105, fangIndex === 0 ? 0.52 : 0.44, 5),
            materials.trim,
            'generatedCanineFangCageUpperOuterFang',
            [side * (jawHalfWidth + 0.02), -0.24, fangZ],
            [0, 0, Math.PI],
          );
          const lowerFang = mesh(
            lowerPivot,
            new THREE.ConeGeometry(0.105, fangIndex === 0 ? 0.52 : 0.44, 5),
            materials.trim,
            'generatedCanineFangCageLowerOuterFang',
            [side * (jawHalfWidth + 0.02), 0.24, fangZ],
          );
          upperFang.userData.razorJawTooth = true;
          lowerFang.userData.razorJawTooth = true;
        }
      }
    }

    const toothCount = canineFangCage ? 8 : 7;
    const toothCenter = (toothCount - 1) * 0.5;
    for (let tooth = 0; tooth < toothCount; tooth += 1) {
      // Preserve a narrow sightline through the open mouth to the mandatory
      // red eye instead of placing a tooth directly on the focal axis.
      if (!canineFangCage && tooth === toothCenter) continue;
      const fromCenter = tooth - toothCenter;
      const x = fromCenter * (canineFangCage ? 0.19 : 0.205);
      const toothLength = canineFangCage && tooth % 2 === 0 ? 0.46 : 0.39;
      const upperTooth = mesh(
        upperPivot,
        new THREE.ConeGeometry(canineFangCage ? 0.095 : 0.085, toothLength, 5),
        materials.trim,
        'generatedCrusherUpperRazorTooth',
        [x, -0.19, jawLength * 0.83 - Math.abs(fromCenter) * 0.025],
        [0, 0, Math.PI],
      );
      const lowerTooth = mesh(
        lowerPivot,
        new THREE.ConeGeometry(canineFangCage ? 0.095 : 0.085, toothLength, 5),
        materials.trim,
        'generatedCrusherLowerRazorTooth',
        [x, 0.19, jawLength * 0.78 + Math.abs(fromCenter) * 0.025],
      );
      upperTooth.userData.razorJawTooth = true;
      lowerTooth.userData.razorJawTooth = true;
    }
    upperPivot.rotation.x = -0.46;
    lowerPivot.rotation.x = 0.46;
    muzzle.position.set(0, -0.02, jawLength + 0.1);
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
    for (const side of [-1, 1]) {
      mesh(
        swingPivot,
        new THREE.CylinderGeometry(0.46, 0.46, 0.09, 12),
        materials.trim,
        'generatedConstructorClawShoulderBearingEndCap',
        [side * 0.48, 0, 0.02],
        [0, 0, Math.PI / 2],
      );
    }

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
    addCircuitPanel(upperBoom, materials, 'generatedConstructorClawUpperBoom', {
      position: [0, 0.325, 0.83],
      rotation: [Math.PI / 2, 0, 0],
      width: 0.5,
      height: 1.08,
      mirror: clawMountSideFromGenome(genome) < 0,
    });

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
    for (const side of [-1, 1]) {
      mesh(
        elbowPivot,
        new THREE.CylinderGeometry(0.35, 0.35, 0.08, 10),
        materials.trim,
        'generatedConstructorClawElbowHingeEndCap',
        [side * 0.52, 0, 0],
        [0, 0, Math.PI / 2],
      );
    }

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
    addCircuitPanel(elbowPivot, materials, 'generatedConstructorClawForearm', {
      position: [0, 0.285, 1.05],
      rotation: [Math.PI / 2, 0, 0],
      width: 0.42,
      height: 1.32,
      mirror: clawMountSideFromGenome(genome) > 0,
    });

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
    addCircuitPanel(wristPivot, materials, 'generatedConstructorClawPalmBack', {
      position: [0, 0, -0.395],
      rotation: [0, Math.PI, 0],
      width: 0.94,
      height: 0.38,
      mirror: clawMountSideFromGenome(genome) < 0,
    });
    const palmAnchor = group(wristPivot, 'generatedClawPalmWeakPointAnchor', [0, 0, 0.43]);
    palmAnchor.userData.clawRigRole = 'palmWeakPointAnchor';
    const palmBackAnchor = group(wristPivot, 'generatedClawPalmBackArmorAnchor', [0, 0, -0.39]);
    palmBackAnchor.userData.clawRigRole = 'palmBackArmorAnchor';
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
        new THREE.ConeGeometry(0.16, 0.9, 5),
        materials.trim,
        'generatedConstructorClawRazorTalon',
        [side * 0.1, -0.045, 0.8],
        [Math.PI / 2, clawMountSide * 0.2 + side * 0.04, side * 0.13],
      );
      talonTip.userData.massiveWeaponPart = true;
      talonTip.userData.razorClawTalon = true;
      const darkTip = mesh(
        talonPivot,
        new THREE.ConeGeometry(0.125, 0.48, 5),
        materials.dark,
        'generatedConstructorClawDarkWorkingEnd',
        [side * 0.17, -0.075, 1.46],
        [Math.PI / 2, clawMountSide * 0.2 + side * 0.04, side * 0.13],
      );
      darkTip.userData.massiveWeaponPart = true;
      darkTip.userData.razorClawTalon = true;
      darkTip.userData.reaverbotWorkingEnd = true;
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
      guardStyle: 'crossBodyElbowBrace',
    };
    weapon.userData.clawBasePosition = weapon.position.clone();
    parts.clawSwingPivot = swingPivot;
    parts.clawUpperBoom = upperBoom;
    parts.clawElbowPivot = elbowPivot;
    parts.clawForearm = forearm;
    parts.clawWristPivot = wristPivot;
    parts.clawPalm = palm;
    parts.clawPalmAnchor = palmAnchor;
    parts.clawPalmBackAnchor = palmBackAnchor;
    parts.clawTalonPivots = talonPivots;
    parts.clawReachSocket = reachSocket;
    parts.clawArmAssembly = swingPivot;
    parts.clawBrokenStump = brokenStump;
    parts.clawMountSide = clawMountSide;
    parts.clawBaseReach = weapon.userData.clawRig.baseReach;
    parts.clawMaxReach = weapon.userData.clawRig.maxReach;
  } else if (id === 'launchLeg') {
    const mountSide = Math.sign(genome.modules.weapon.mountSide || 1);
    const rig = createLaunchLegModule(weapon, materials, {
      mountSide,
      authoredLength: genome.modules.weapon.authoredLength ?? 4.35,
    });
    rig.contactAnchor.add(muzzle);
    muzzle.position.set(0, 0.08, 0.72);
    rig.limb.impactSocket = muzzle;
    frame.limbs.push(rig.limb);
    frame.springLimbs.push(rig.limb);
    if (frame.springMobility) {
      frame.springMobility.legCount = frame.springLimbs.length;
      frame.springMobility.integratedWeaponId = id;
    }
    weapon.userData.integratedIntoMobility = true;
    weapon.userData.mountRole = 'locomotion';
    weapon.userData.mobilityId = frame.mobilityId;
    weapon.userData.mobilityLegCount = frame.springLimbs.length;
    weapon.userData.launchLegBasePosition = weapon.position.clone();
    weapon.userData.launchLegRig = { ...rig.assembly.userData.launchLegRig };
    parts.launchLegAssembly = rig.assembly;
    parts.launchLegHipPivot = rig.hipPivot;
    parts.launchLegKneePivot = rig.kneePivot;
    parts.launchLegAnklePivot = rig.anklePivot;
    parts.launchLegFootPivot = rig.footPivot;
    parts.launchLegFoot = rig.foot;
    parts.launchLegContactAnchor = rig.contactAnchor;
    parts.launchLegShockStack = rig.shockStack;
    parts.launchLegShockBands = rig.shockBands;
    parts.launchLegBoosters = rig.boosters;
    parts.launchLegBoosterNozzles = rig.boosterNozzles;
    parts.launchLegFlames = rig.boosterFlames;
    parts.launchLegClaws = rig.claws;
    parts.launchLegMountSide = mountSide;
  } else if (id === 'pounceActuator' || (id === 'shockPiston' && integratedMobility)) {
    // Pounce hardware is part of the generated spring legs, never a forward
    // facial weapon. Keep only a belly-space logical muzzle for warnings and
    // impact particles; visible weapon-scoped receivers/coils live on the legs.
    weapon.userData.integratedIntoMobility = true;
    weapon.userData.mountRole = 'locomotion';
    weapon.userData.mobilityId = frame.mobilityId;
    weapon.userData.mobilityLegCount = frame.springLimbs.length;
    muzzle.position.set(0, -0.08, 0);
  } else if (id === 'shockPiston') {
    box(weapon, materials.weapon, 'generatedShockPistonBracedHousing', [0.72, 0.58, 0.62], [0, 0, 0.18]);
    addBearingAssembly(weapon, materials, 'generatedShockPistonMount', [0, 0, -0.08], {
      radius: 0.27,
      width: 0.78,
      rotation: [0, 0, Math.PI / 2],
    });
    taperedColumn(weapon, materials.dark, 'generatedShockPistonCentralRam', 0.12, 0.12, 0.68, [0, 0, 0.68], 8, [Math.PI / 2, 0, 0]);
    for (const side of [-1, 1]) {
      for (let vent = -1; vent <= 1; vent += 1) {
        box(weapon, materials.dark, 'generatedShockPistonVent', [0.1, 0.055, 0.3], [side * 0.31, vent * 0.14, 0.2]);
      }
    }
    mesh(weapon, new THREE.TorusGeometry(0.36, 0.065, 7, 14), materials.emissive, 'generatedShockPistonEmitterBand', [0, 0, 0.92]);
    mesh(weapon, new THREE.CylinderGeometry(0.42, 0.42, 0.18, 10), materials.dark, 'generatedShockPistonDarkWorkingEnd', [0, 0, 1.02], [Math.PI / 2, 0, 0]);
    muzzle.position.set(0, 0, 1.12);
  } else if (id === 'pulseCannon') {
    taperedColumn(weapon, materials.weapon, 'generatedPulseCannonBody', 0.24, 0.3, 0.72, [0, 0, 0.3], 8, [Math.PI / 2, 0, 0]);
    taperedColumn(weapon, materials.dark, 'generatedPulseCannonBarrel', 0.13, 0.18, 0.62, [0, 0, 0.86], 8, [Math.PI / 2, 0, 0]);
    mesh(weapon, new THREE.TorusGeometry(0.19, 0.045, 6, 12), materials.emissive, 'generatedPulseCannonRing', [0, 0, 0.62]);
    addBearingAssembly(weapon, materials, 'generatedPulseCannonBreech', [0, 0, 0.02], {
      radius: 0.28,
      width: 0.44,
      rotation: [0, 0, Math.PI / 2],
    });
    addCircuitPanel(weapon, materials, 'generatedPulseCannonSide', {
      position: [0.29, 0, 0.33],
      rotation: [0, Math.PI / 2, 0],
      width: 0.42,
      height: 0.28,
    });
    mesh(weapon, new THREE.CylinderGeometry(0.125, 0.125, 0.055, 10), materials.dark, 'generatedPulseCannonDarkMuzzleRecess', [0, 0, 1.19], [Math.PI / 2, 0, 0]);
    muzzle.position.set(0, 0, 1.2);
  } else if (id === 'mortarPod') {
    weapon.rotation.x = -0.62;
    box(weapon, materials.weapon, 'generatedMortarBreech', [0.58, 0.52, 0.62], [0, 0, 0.16]);
    taperedColumn(weapon, materials.weapon, 'generatedMortarTubeArmorFace', 0.15, 0.24, 0.9, [0, 0, 0.76], 8, [Math.PI / 2, 0, 0]);
    addBearingAssembly(weapon, materials, 'generatedMortarElevationTrunnion', [0, 0, 0.25], {
      radius: 0.24,
      width: 0.72,
      rotation: [0, 0, Math.PI / 2],
    });
    addCircuitPanel(weapon, materials, 'generatedMortarFireControl', {
      position: [0.31, 0, 0.2],
      rotation: [0, Math.PI / 2, 0],
      width: 0.38,
      height: 0.3,
    });
    mesh(weapon, new THREE.CylinderGeometry(0.15, 0.15, 0.06, 10), materials.dark, 'generatedMortarDarkMuzzleRecess', [0, 0, 1.21], [Math.PI / 2, 0, 0]);
    muzzle.position.set(0, 0, 1.23);
  } else if (id === 'clusterMortar') {
    weapon.rotation.x = -0.55;
    box(weapon, materials.weapon, 'generatedClusterMortarFeedDrum', [0.92, 0.58, 0.58], [0, 0, 0.12]);
    addBearingAssembly(weapon, materials, 'generatedClusterMortarIndexBearing', [0, 0, 0.08], {
      radius: 0.3,
      width: 0.98,
      rotation: [0, 0, Math.PI / 2],
    });
    for (const x of [-0.24, 0, 0.24]) {
      taperedColumn(weapon, materials.weapon, 'generatedClusterMortarTubeArmorFace', 0.11, 0.16, 0.82, [x, 0, 0.72], 8, [Math.PI / 2, 0, 0]);
      mesh(weapon, new THREE.CylinderGeometry(0.11, 0.11, 0.055, 9), materials.dark, 'generatedClusterMortarDarkMuzzleRecess', [x, 0, 1.12], [Math.PI / 2, 0, 0]);
    }
    addCircuitPanel(weapon, materials, 'generatedClusterMortarMagazine', {
      position: [0, 0.31, 0.14],
      rotation: [Math.PI / 2, 0, 0],
      width: 0.68,
      height: 0.3,
      mirror: true,
    });
    muzzle.position.set(0, 0, 1.16);
  } else if (id === 'arcEmitter') {
    addBearingAssembly(weapon, materials, 'generatedArcEmitterInsulatedMount', [0, 0, -0.02], {
      radius: 0.25,
      width: 0.32,
      rotation: [0, 0, Math.PI / 2],
    });
    const coil = mesh(weapon, new THREE.TorusGeometry(0.3, 0.07, 6, 14), materials.weapon, 'generatedArcEmitterCoil', [0, 0, 0.24]);
    coil.rotation.y = Math.PI / 2;
    mesh(weapon, new THREE.SphereGeometry(0.2, 8, 6), materials.emissive, 'generatedArcEmitterCore', [0, 0, 0.32]);
    for (const side of [-1, 1]) {
      const prong = taperedColumn(weapon, materials.trim, 'generatedArcEmitterProng', 0.025, 0.07, 0.62, [side * 0.2, 0, 0.52], 5, [Math.PI / 2, 0, side * 0.1]);
      prong.rotation.z = side * -0.15;
      mesh(weapon, new THREE.ConeGeometry(0.055, 0.22, 5), materials.dark, 'generatedArcEmitterDarkElectrodeWorkingEnd', [side * 0.23, 0, 0.84], [Math.PI / 2, 0, side * -0.15]);
    }
    addCircuitPanel(weapon, materials, 'generatedArcEmitterFeed', {
      position: [0, 0.19, 0.12],
      rotation: [Math.PI / 2, 0, 0],
      width: 0.34,
      height: 0.25,
    });
    muzzle.position.set(0, 0, 0.78);
  } else if (id === 'flameNozzle') {
    taperedColumn(weapon, materials.weapon, 'generatedFlameNozzleBody', 0.16, 0.28, 0.72, [0, 0, 0.3], 7, [Math.PI / 2, 0, 0]);
    taperedColumn(weapon, materials.dark, 'generatedFlameNozzleMouth', 0.24, 0.14, 0.35, [0, 0, 0.8], 7, [Math.PI / 2, 0, 0]);
    mesh(weapon, new THREE.CylinderGeometry(0.22, 0.22, 0.055, 9), materials.dark, 'generatedFlameNozzleBlackenedMuzzleRecess', [0, 0, 0.98], [Math.PI / 2, 0, 0]);
    for (let band = 0; band < 2; band += 1) {
      mesh(weapon, new THREE.TorusGeometry(0.23 - band * 0.025, 0.035, 6, 12), materials.trim, 'generatedFlameNozzleHeatBand', [0, 0, 0.48 + band * 0.2]);
    }
    for (let vent = -1; vent <= 1; vent += 1) {
      box(weapon, materials.dark, 'generatedFlameNozzleVent', [0.05, 0.12, 0.24], [0.24, vent * 0.14, 0.36], [0, 0.1, 0]);
    }
    muzzle.position.set(0, 0, 1.02);
  } else if (id === 'beamPrism') {
    addBearingAssembly(weapon, materials, 'generatedBeamPrismGimbal', [0, 0, 0.02], {
      radius: 0.25,
      width: 0.68,
      rotation: [0, 0, Math.PI / 2],
    });
    mesh(weapon, new THREE.OctahedronGeometry(0.32, 0), materials.emissive, 'generatedBeamPrism', [0, 0, 0.32], [0, 0, Math.PI / 4]);
    for (const side of [-1, 1]) {
      box(weapon, materials.weapon, 'generatedBeamPrismRail', [0.12, 0.12, 0.72], [side * 0.27, 0, 0.36]);
      box(weapon, materials.trim, 'generatedBeamPrismCircuitStrip', [0.035, 0.035, 0.5], [side * 0.275, 0.07, 0.36]);
    }
    mesh(weapon, new THREE.CylinderGeometry(0.13, 0.13, 0.06, 10), materials.dark, 'generatedBeamPrismDarkFocusingAperture', [0, 0, 0.82], [Math.PI / 2, 0, 0]);
    muzzle.position.set(0, 0, 0.84);
  } else if (id === 'mineDispenser') {
    box(weapon, materials.weapon, 'generatedMineDispenserRack', [0.68, 0.5, 0.58], [0, 0, 0.2]);
    addBearingAssembly(weapon, materials, 'generatedMineDispenserDoorHinge', [-0.38, 0, 0.18], {
      radius: 0.12,
      width: 0.5,
      rotation: [Math.PI / 2, 0, 0],
    });
    for (const side of [-1, 1]) {
      mesh(weapon, new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), materials.emissive, 'generatedStoredMine', [side * 0.2, 0, 0.52], [Math.PI / 2, 0, 0]);
    }
    addCircuitPanel(weapon, materials, 'generatedMineDispenserMagazineDoor', {
      position: [0, 0.26, 0.16],
      rotation: [Math.PI / 2, 0, 0],
      width: 0.48,
      height: 0.3,
      mirror: true,
    });
    box(weapon, materials.dark, 'generatedMineDispenserDarkEjectionChute', [0.45, 0.18, 0.26], [0, -0.3, 0.55], [0.18, 0, 0]);
    muzzle.position.set(0, -0.15, 0.7);
  } else if (id === 'rotorBlade') {
    box(weapon, materials.dark, 'generatedRotorBladeCrossbar', [2.08, 0.14, 0.18], [0, 0, 0]);
    addBearingAssembly(weapon, materials, 'generatedRotorCentralSpindle', [0, 0, 0], {
      radius: 0.31,
      width: 0.32,
      rotation: [Math.PI / 2, 0, 0],
    });
    for (const side of [-1, 1]) {
      const blade = mesh(
        weapon,
        new THREE.ConeGeometry(0.2, 0.58, 5),
        materials.weapon,
        'generatedRotorBlade',
        [side * 1.02, 0, 0],
        [0, 0, side * -Math.PI / 2],
      );
      blade.userData.rotorSide = side;
      const tip = mesh(
        weapon,
        new THREE.ConeGeometry(0.15, 0.34, 5),
        materials.dark,
        'generatedRotorBladeDarkWorkingEnd',
        [side * 1.45, 0, 0],
        [0, 0, side * -Math.PI / 2],
      );
      tip.userData.rotorSide = side;
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
    addBearingAssembly(weapon, materials, 'generatedTractorMagnetSwivel', [0, 0.16, 0], {
      radius: 0.25,
      width: 0.34,
      rotation: [0, 0, Math.PI / 2],
    });
    addCircuitPanel(magnet, materials, 'generatedTractorMagnetOuterArch', {
      position: [0, 0.13, 0.15],
      width: 0.58,
      height: 0.2,
      mirror: true,
    });
    for (const side of [-1, 1]) {
      box(magnet, materials.weapon, 'generatedTractorMagnetProng', [0.28, 0.75, 0.3], [side * 0.52, -0.36, 0]);
      box(magnet, materials.dark, 'generatedTractorMagnetDarkInnerRecess', [0.12, 0.62, 0.32], [side * 0.39, -0.37, 0]);
      box(magnet, side < 0 ? materials.emissive : materials.trim, 'generatedTractorMagnetPoleWorkingEnd', [0.34, 0.22, 0.36], [side * 0.52, -0.78, 0]);
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
    beamMaterial.userData.reaverbotTextureExempt = 'animated additive tractor field';
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
    mesh(weapon, new THREE.IcosahedronGeometry(0.34, 0), materials.emissive, 'generatedOverloadWeaponEmitterCore', [0, 0, 0.16]);
    addBearingAssembly(weapon, materials, 'generatedOverloadCoreSocket', [0, 0, -0.08], {
      radius: 0.31,
      width: 0.3,
      rotation: [0, 0, Math.PI / 2],
    });
    for (let rib = 0; rib < 4; rib += 1) {
      const cage = mesh(weapon, new THREE.TorusGeometry(0.42, 0.045, 6, 16), materials.weapon, 'generatedOverloadCoreCageBand', [0, 0, 0.16], [Math.PI / 2, rib * Math.PI / 4, 0]);
      cage.userData.overloadCageRib = rib;
    }
    for (let vent = 0; vent < 3; vent += 1) {
      box(weapon, materials.dark, 'generatedOverloadHousingVent', [0.08, 0.22, 0.06], [(vent - 1) * 0.18, -0.34, 0.12]);
    }
    muzzle.position.set(0, 0, 0.45);
  }

  return parts;
}

function createChargeModule(root, genome, frame, materials) {
  const definition = genome.modules.charge;
  const chargeModule = group(root, `generatedChargeModule_${definition?.id ?? 'none'}`);
  const parts = {
    id: definition?.id ?? null,
    variant: definition?.id ?? null,
    group: chargeModule,
    gimbal: chargeModule,
    nozzles: [],
    flames: [],
    thrustScale: definition?.thrustScale ?? 1,
  };
  if (!definition) {
    chargeModule.visible = false;
    return parts;
  }

  chargeModule.userData.chargeModuleId = definition.id;
  chargeModule.userData.mountRole = definition.mountRole;
  const flameMaterial = standardMaterial('material_generatedRocketJetFlame', 0xff8a25, {
    emissive: 0xff3a08,
    emissiveIntensity: 2.8,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    textureExempt: 'animated additive rocket exhaust flame',
  });

  const addRocketPod = (parent, name, position, { radius = 0.18, length = 0.68 } = {}) => {
    const pod = group(parent, `${name}Assembly`, position);
    mesh(pod, new THREE.CylinderGeometry(radius, radius * 0.82, length, 10), materials.weapon, `${name}Housing`, [0, 0, 0], [Math.PI / 2, 0, 0]);
    mesh(pod, new THREE.TorusGeometry(radius * 1.02, radius * 0.16, 6, 12), materials.trim, `${name}ThrustBand`, [0, 0, -length * 0.25]);
    mesh(pod, new THREE.CylinderGeometry(radius * 0.78, radius * 0.98, 0.18, 10), materials.dark, `${name}DarkNozzle`, [0, 0, -length * 0.57], [Math.PI / 2, 0, 0]);
    const nozzle = new THREE.Object3D();
    nozzle.name = `${name}ExhaustNozzle`;
    nozzle.position.set(0, 0, -length * 0.72);
    pod.add(nozzle);
    const flame = mesh(
      nozzle,
      new THREE.ConeGeometry(radius * 0.68, length * 1.15, 8),
      flameMaterial.clone(),
      `${name}RocketFlame`,
      [0, 0, -length * 0.52],
      [-Math.PI / 2, 0, 0],
    );
    flame.material.name = `${flameMaterial.name}_${name}`;
    flame.material.userData.reaverbotTextureExempt = flameMaterial.userData.reaverbotTextureExempt;
    flame.visible = false;
    parts.nozzles.push(nozzle);
    parts.flames.push(flame);
    return pod;
  };

  if (definition.id === 'spineJet') {
    chargeModule.position.set(0, frame.anchors.rearHigh[1] + 0.18, frame.anchors.center[2] - 0.12);
    chargeModule.rotation.x = -0.06;
    addRocketPod(chargeModule, 'generatedDorsalSpineJet', [0, 0, 0], { radius: 0.2, length: 0.76 });
  } else if (definition.id === 'vectorRocket') {
    chargeModule.position.set(frame.anchors.belly[0], frame.anchors.belly[1] - 0.28, frame.anchors.belly[2] - 0.08);
    parts.gimbal = group(chargeModule, 'generatedVectorRocketGimbal');
    addBearingAssembly(chargeModule, materials, 'generatedVectorRocketSwivel', [0, 0.18, 0], {
      radius: 0.2,
      width: 0.34,
      rotation: [0, 0, Math.PI / 2],
    });
    addRocketPod(parts.gimbal, 'generatedAerialVectorRocket', [0, 0, 0], { radius: 0.28, length: 1.18 });
  } else {
    chargeModule.position.set(0, frame.anchors.rearHigh[1], frame.anchors.rear[2] + 0.08);
    const podOffset = frame.plan === 'tripod' ? 0.27 : 0.48;
    for (const side of [-1, 1]) {
      addRocketPod(
        chargeModule,
        side < 0 ? 'generatedJetpackLeftRocket' : 'generatedJetpackRightRocket',
        [side * podOffset, 0, 0],
        { radius: frame.plan === 'tripod' ? 0.16 : 0.18, length: 0.7 },
      );
    }
  }
  flameMaterial.dispose();
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
    addBearingAssembly(defense, materials, 'generatedDirectionalShieldRearHinge', [0, 0, -0.16], {
      radius: 0.23,
      width: 0.46,
      rotation: [0, 0, Math.PI / 2],
    });
    addCircuitPanel(defense, materials, 'generatedDirectionalShieldFace', {
      position: [0, 0, 0.105],
      width: 0.78,
      height: 0.7,
      mirror: Math.sign(anchor[0] || -1) > 0,
    });
    parts.plates.push(plate);
    parts.primaryPlate = plate;
  } else if (id === 'guardArms') {
    for (const side of [-1, 1]) {
      const arm = box(defense, defenseMaterial, 'generatedGuardArm', [0.32, 0.9, 0.28], [side * 0.2, 0, 0], [0, 0, side * 0.58]);
      arm.userData.guardSide = side;
      box(arm, materials.dark, 'generatedGuardArmDarkInsideMechanism', [0.26, 0.66, 0.06], [0, 0, -0.17]);
      addBearingAssembly(arm, materials, 'generatedGuardArmElbow', [0, -0.44, 0], {
        radius: 0.15,
        width: 0.36,
        rotation: [0, 0, Math.PI / 2],
      });
      parts.plates.push(arm);
    }
  } else if (id === 'armorShutters') {
    if (frame.plan === 'quadruped') {
      for (const verticalSide of [-1, 1]) {
        const shutter = box(
          defense,
          defenseMaterial,
          'generatedQuadrupedEyeArmorEyelid',
          [0.64, 0.26, 0.12],
          [0, verticalSide * 0.23, 0.13],
          [0, 0, verticalSide * 0.05],
        );
        shutter.userData.eyelidSide = verticalSide;
        shutter.userData.openY = verticalSide * 0.43;
        shutter.userData.closedY = verticalSide * 0.12;
        box(shutter, materials.dark, 'generatedQuadrupedEyeShutterDarkMeetingEdge', [0.58, 0.055, 0.14], [0, verticalSide * -0.12, 0]);
        addBearingAssembly(shutter, materials, 'generatedQuadrupedEyeShutterHinge', [0, verticalSide * 0.16, -0.04], {
          radius: 0.1,
          width: 0.5,
          rotation: [0, 0, Math.PI / 2],
        });
        parts.shutters.push(shutter);
      }
      defense.userData.quadrupedEyelids = true;
    } else {
      for (const side of [-1, 1]) {
        const shutter = box(defense, defenseMaterial, 'generatedEyeArmorShutter', [0.28, 0.54, 0.12], [side * 0.42, 0, 0.13], [0, 0, side * 0.28]);
        shutter.userData.openX = side * 0.42;
        shutter.userData.closedX = side * 0.16;
        box(shutter, materials.dark, 'generatedEyeShutterDarkMeetingEdge', [0.055, 0.45, 0.14], [side * -0.13, 0, 0]);
        addBearingAssembly(shutter, materials, 'generatedEyeShutterHinge', [side * 0.12, 0, -0.04], {
          radius: 0.1,
          width: 0.42,
          rotation: [Math.PI / 2, 0, 0],
        });
        parts.shutters.push(shutter);
      }
    }
  } else if (id === 'rotatingPlates') {
    defense.position.copy(new THREE.Vector3(...frame.anchors.center));
    box(defense, materials.dark, 'generatedRotorGuardSpine', [0.16, 0.16, 1.72], [0, 0, 0]);
    const plate = box(defense, defenseMaterial, 'generatedRotatingDefensePlate', [0.96, 1.02, 0.18], [0, 0, 0.86]);
    box(plate, materials.trim, 'generatedRotatingDefensePlateInset', [0.68, 0.72, 0.04], [0, 0, 0.11]);
    mesh(plate, new THREE.CylinderGeometry(0.15, 0.15, 0.2, 8), materials.emissive, 'generatedRotatingDefenseNode', [0, 0, 0.14], [Math.PI / 2, 0, 0]);
    addBearingAssembly(defense, materials, 'generatedRotorGuardSpindle', [0, 0, 0], {
      radius: 0.22,
      width: 0.36,
      rotation: [Math.PI / 2, 0, 0],
    });
    addCircuitPanel(plate, materials, 'generatedRotatingDefensePlateFace', {
      position: [0, 0, 0.13],
      width: 0.62,
      height: 0.62,
    });
    box(plate, materials.dark, 'generatedRotatingDefenseDarkWorkingEdge', [0.98, 0.1, 0.24], [0, -0.5, 0]);
    guardNormal.position.set(0, 0, 0.95);
    parts.plates.push(plate);
    parts.primaryPlate = plate;
  } else if (id === 'energyMembrane' || id === 'phaseShell') {
    defense.position.copy(new THREE.Vector3(...frame.anchors.center));
    const shellMaterial = materials.shieldEnergy.clone();
    shellMaterial.name = id === 'phaseShell' ? 'material_generatedPhaseShell' : 'material_generatedEnergyMembrane';
    parts.shell = mesh(defense, new THREE.IcosahedronGeometry(0.98, 1), shellMaterial, id === 'phaseShell' ? 'generatedPhaseShell' : 'generatedEnergyMembrane', [0, 0, 0], null, [1.1, 1.05, 1.1]);
    const emitterCount = id === 'phaseShell' ? 4 : 3;
    for (let index = 0; index < emitterCount; index += 1) {
      const angle = index * Math.PI * 2 / emitterCount + (id === 'phaseShell' ? 0.35 : 0);
      const emitter = group(defense, id === 'phaseShell' ? 'generatedPhaseProjectorAssembly' : 'generatedMembraneEmitterAssembly', [Math.sin(angle) * 0.72, -0.42 + (index % 2) * 0.14, Math.cos(angle) * 0.72]);
      emitter.rotation.y = angle;
      box(emitter, materials.dark, id === 'phaseShell' ? 'generatedPhaseProjectorDarkBracket' : 'generatedMembraneEmitterDarkBracket', [0.25, 0.18, 0.3], [0, 0, 0]);
      mesh(emitter, new THREE.CylinderGeometry(0.09, 0.09, 0.12, 8), materials.emissive, id === 'phaseShell' ? 'generatedPhaseProjectorEmitter' : 'generatedMembraneEmitter', [0, 0, 0.18], [Math.PI / 2, 0, 0]);
      if (id === 'phaseShell') {
        mesh(emitter, new THREE.TorusGeometry(0.16, 0.025, 5, 10), materials.trim, 'generatedPhaseProjectorGimbalBand', [0, 0, 0.1]);
      }
    }
  } else if (id === 'armoredSkull') {
    for (const side of [-1, 1]) {
      const plate = box(defense, defenseMaterial, 'generatedArmoredSkullCheek', [0.32, 0.52, 0.18], [side * 0.3, -0.03, 0.08], [0, side * 0.12, side * 0.08]);
      box(plate, materials.dark, 'generatedArmoredSkullDarkInnerEdge', [0.07, 0.44, 0.12], [side * -0.14, 0, 0.05]);
      addBearingAssembly(plate, materials, 'generatedArmoredSkullCheekHinge', [side * 0.12, -0.2, -0.02], {
        radius: 0.09,
        width: 0.24,
        rotation: [Math.PI / 2, 0, 0],
      });
      parts.plates.push(plate);
    }
  } else if (id === 'sidePlates') {
    for (const side of [-1, 1]) {
      const plate = box(defense, defenseMaterial, 'generatedSideArmorPlate', [0.54, 1.18, 0.16], [side * 0.34, -0.18, 0], [0, side * -0.06, side * 0.04]);
      plate.userData.guardSide = side;
      plate.userData.closedPosition = plate.position.clone();
      plate.userData.openPosition = new THREE.Vector3(side * 0.72, 0.26, -0.08);
      addBearingAssembly(plate, materials, 'generatedSideArmorPlateHinge', [0, -0.48, -0.12], {
        radius: 0.13,
        width: 0.42,
        rotation: [0, 0, Math.PI / 2],
      });
      addCircuitPanel(plate, materials, `generatedSideArmor${side < 0 ? 'Left' : 'Right'}Face`, {
        position: [0, 0, 0.095],
        width: 0.36,
        height: 0.82,
        mirror: side < 0,
        powered: false,
      });
      parts.plates.push(plate);
    }
  } else if (id === 'armoredBack') {
    defense.position.copy(new THREE.Vector3(...frame.anchors.rearHigh));
    box(defense, materials.dark, 'generatedArmoredBackSpinalHinge', [1.18, 0.14, 0.16], [0, -0.16, 0]);
    for (let index = -1; index <= 1; index += 1) {
      const plate = box(defense, defenseMaterial, 'generatedCarapacePlate', [0.46, 0.24, 0.48], [index * 0.38, 0, 0], [0.22, 0, index * 0.05]);
      parts.plates.push(plate);
    }
    addCircuitPanel(defense, materials, 'generatedArmoredBackSpine', {
      position: [0, 0.14, 0.03],
      rotation: [-Math.PI / 2, 0, 0],
      width: 0.88,
      height: 0.24,
      powered: false,
    });
  } else if (id === 'armoredCarapace') {
    defense.position.copy(new THREE.Vector3(...frame.anchors.rearHigh));
    const shell = mesh(defense, new THREE.CylinderGeometry(0.72, 0.84, 0.58, 8, 1, false, 0, Math.PI), defenseMaterial, 'generatedArmoredCarapaceArchedArmorFace', [0, 0.08, 0], [0, 0, Math.PI / 2], [1.15, 1, 1]);
    box(shell, materials.dark, 'generatedArmoredCarapaceDarkUnderside', [1.25, 0.12, 0.5], [0, -0.38, 0]);
    box(defense, materials.trim, 'generatedArmoredCarapaceCentralRidge', [0.16, 0.28, 1.2], [0, 0.36, 0]);
    addCircuitPanel(defense, materials, 'generatedArmoredCarapaceCenter', {
      position: [0, 0.44, 0.02],
      rotation: [-Math.PI / 2, 0, 0],
      width: 0.58,
      height: 0.68,
      mirror: true,
    });
    parts.plates.push(shell);
  } else {
    const plate = box(defense, defenseMaterial, 'generatedReactivePlate', [0.8, 1.06, 0.18], [0, 0, 0], [0, 0, -0.1]);
    for (const x of [-0.23, 0.23]) {
      for (const y of [-0.34, 0, 0.34]) {
        box(plate, materials.secondary, 'generatedReactiveArmorCell', [0.3, 0.25, 0.06], [x, y, 0.12]);
      }
    }
    box(plate, materials.emissive, 'generatedReactiveResponseCircuitStrip', [0.08, 0.82, 0.05], [0, 0, 0.16]);
    addBearingAssembly(plate, materials, 'generatedReactivePlateRearHinge', [0, -0.48, -0.12], {
      radius: 0.14,
      width: 0.56,
      rotation: [0, 0, Math.PI / 2],
    });
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

  const linkedToLaunchLeg = definition.id === 'legJoint'
    && genome.modules.weapon.id === 'launchLeg'
    && weapon.launchLegKneePivot;
  const linkedToRotor = definition.location === 'rotorOpposite'
    && genome.modules.defense?.id === 'rotatingPlates';
  const launchMountSide = Math.sign(weapon.launchLegMountSide || 1);
  const anchor = linkedToLaunchLeg
    ? [launchMountSide * 0.54, 0, 0]
    : linkedToRotor
      ? [0, -0.05, -0.86]
      : weakPointAnchor(frame, definition.location);
  const weakPoint = group(
    linkedToLaunchLeg ? weapon.launchLegKneePivot : linkedToRotor ? defense.group : root,
    `generatedWeakPoint_${definition.id}`,
    anchor,
  );
  if (linkedToLaunchLeg) {
    weakPoint.rotation.y = launchMountSide * Math.PI / 2;
    weakPoint.userData.linkedWeaponId = 'launchLeg';
  } else if (linkedToRotor) {
    weakPoint.rotation.y = Math.PI;
    weakPoint.userData.linkedDefenseId = 'rotatingPlates';
  } else if (definition.location === 'leg') {
    weakPoint.position.y += 0.12;
    weakPoint.rotation.y = anchor[0] < 0 ? -Math.PI / 2 : Math.PI / 2;
  } else if (definition.location === 'side') {
    weakPoint.rotation.y = anchor[0] < 0 ? -Math.PI / 2 : Math.PI / 2;
  }
  const radius = definition.radius ?? 0.22;
  let socket;
  let core;

  if (definition.id === 'rearBattery') {
    socket = box(weakPoint, materials.dark, 'generatedRearBatteryDarkMountingBracket', [radius * 3.2, radius * 2.5, 0.18], [0, 0, 0]);
    box(weakPoint, materials.trim, 'generatedRearBatteryCanister', [radius * 2.7, radius * 2, 0.16], [0, 0, 0.11]);
    core = box(weakPoint, materials.weakPoint, 'generatedRearBatteryEmitterChargeWindow', [radius * 1.9, radius * 1.2, 0.08], [0, 0, 0.22]);
    for (const side of [-1, 1]) {
      mesh(weakPoint, new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, 0.18, 7), materials.weakPoint, 'generatedRearBatteryTerminal', [side * radius * 0.95, radius * 1.16, 0.11], [Math.PI / 2, 0, 0]);
    }
    for (let bar = -1; bar <= 1; bar += 1) {
      box(weakPoint, materials.dark, 'generatedRearBatteryChargeBand', [radius * 0.18, radius * 1.4, 0.04], [bar * radius * 0.48, 0, 0.27]);
    }
  } else if (definition.id === 'bellyCore') {
    socket = mesh(weakPoint, new THREE.CylinderGeometry(radius * 1.6, radius * 1.72, 0.16, 8), materials.dark, 'generatedBellyCoreDarkReactorWell', [0, 0, 0], [Math.PI / 2, 0, 0]);
    core = mesh(weakPoint, new THREE.IcosahedronGeometry(radius, 1), materials.weakPoint, 'generatedBellyCoreEmitterReactor', [0, 0, 0.1], null, [1, 1, 0.55]);
    mesh(weakPoint, new THREE.TorusGeometry(radius * 1.28, radius * 0.13, 6, 10), materials.trim, 'generatedBellyCoreMechanicalBand', [0, 0, 0.13]);
    for (const side of [-1, 1]) {
      box(weakPoint, materials.dark, 'generatedBellyCoreGrille', [radius * 0.18, radius * 1.2, 0.05], [side * radius * 1.25, 0, 0.12], [0, 0, side * 0.2]);
    }
  } else if (definition.id === 'shieldHinge') {
    socket = mesh(weakPoint, new THREE.CylinderGeometry(radius * 1.35, radius * 1.35, radius * 3.1, 10), materials.dark, 'generatedShieldWeakPointDarkHingeBarrel', [0, 0, 0], [0, 0, Math.PI / 2]);
    for (const side of [-1, 1]) {
      mesh(weakPoint, new THREE.CylinderGeometry(radius * 1.48, radius * 1.48, radius * 0.2, 10), materials.trim, 'generatedShieldWeakPointBearingEndCap', [side * radius * 1.62, 0, 0], [0, 0, Math.PI / 2]);
    }
    core = mesh(weakPoint, new THREE.SphereGeometry(radius * 0.8, 10, 7), materials.weakPoint, 'generatedShieldHingeEmitterPin', [0, 0, radius * 0.58], null, [1, 1, 0.48]);
  } else if (definition.id === 'ammoDrum') {
    socket = mesh(weakPoint, new THREE.CylinderGeometry(radius * 1.5, radius * 1.5, radius * 1.4, 10), materials.dark, 'generatedAmmoDrumDarkAxle', [0, 0, 0], [0, 0, Math.PI / 2]);
    core = mesh(weakPoint, new THREE.CylinderGeometry(radius * 1.15, radius * 1.15, radius * 1.7, 10), materials.weakPoint, 'generatedAmmoDrumEmitterIndexWindow', [0, 0, 0.12], [0, 0, Math.PI / 2]);
    for (const side of [-1, 1]) {
      mesh(weakPoint, new THREE.TorusGeometry(radius * 1.2, radius * 0.12, 6, 10), materials.trim, 'generatedAmmoDrumFeedBand', [side * radius * 0.72, 0, 0.12], [0, Math.PI / 2, 0]);
    }
    for (let index = 0; index < 5; index += 1) {
      const angle = index * Math.PI * 2 / 5;
      box(weakPoint, materials.dark, 'generatedAmmoDrumCartridgeSeam', [radius * 0.14, radius * 0.7, 0.04], [Math.sin(angle) * radius * 0.7, Math.cos(angle) * radius * 0.7, radius * 0.98], [0, 0, -angle]);
    }
  } else if (definition.id === 'coolingVents') {
    socket = box(weakPoint, materials.dark, 'generatedCoolingVentDarkRecess', [radius * 3.4, radius * 2.5, 0.14], [0, 0, 0]);
    core = box(weakPoint, materials.weakPoint, 'generatedCoolingVentEmitterBacking', [radius * 2.9, radius * 2, 0.08], [0, 0, 0.1]);
    for (let slot = -2; slot <= 2; slot += 1) {
      box(weakPoint, materials.dark, 'generatedCoolingVentGrilleSlot', [radius * 0.28, radius * 2.1, 0.09], [slot * radius * 0.58, 0, 0.17]);
    }
    for (const side of [-1, 1]) {
      box(weakPoint, materials.trim, 'generatedCoolingVentMechanicalBand', [radius * 0.16, radius * 2.5, 0.1], [side * radius * 1.58, 0, 0.14]);
    }
  } else if (definition.id === 'emitterCore') {
    socket = mesh(weakPoint, new THREE.CylinderGeometry(radius * 1.55, radius * 1.7, 0.18, 10), materials.dark, 'generatedEmitterCoreDarkSocket', [0, 0, 0], [Math.PI / 2, 0, 0]);
    core = mesh(weakPoint, new THREE.SphereGeometry(radius, 10, 7), materials.weakPoint, 'generatedEmitterCorePoweredEmitter', [0, 0, 0.11], null, [1, 1, 0.55]);
    mesh(weakPoint, new THREE.TorusGeometry(radius * 1.22, radius * 0.13, 6, 12), materials.trim, 'generatedEmitterCoreConductorBand', [0, 0, 0.14]);
    for (const side of [-1, 1]) {
      taperedColumn(weakPoint, materials.trim, 'generatedEmitterCoreProng', radius * 0.08, radius * 0.18, radius * 1.1, [side * radius * 1.2, 0, radius * 0.42], 5, [Math.PI / 2, 0, side * 0.14]);
    }
  } else if (definition.id === 'overloadCore') {
    socket = mesh(weakPoint, new THREE.CylinderGeometry(radius * 1.5, radius * 1.65, 0.2, 9), materials.dark, 'generatedOverloadWeakPointDarkSocket', [0, 0, 0], [Math.PI / 2, 0, 0]);
    core = mesh(weakPoint, new THREE.IcosahedronGeometry(radius * 1.08, 1), materials.weakPoint, 'generatedOverloadWeakPointEmitterCore', [0, 0, 0.12], null, [1, 1, 0.62]);
    for (let rib = 0; rib < 3; rib += 1) {
      mesh(weakPoint, new THREE.TorusGeometry(radius * 1.33, radius * 0.09, 5, 10), materials.trim, 'generatedOverloadWeakPointCageBand', [0, 0, 0.15], [rib * Math.PI / 3, 0, 0]);
    }
  } else if (definition.id === 'legJoint') {
    socket = mesh(weakPoint, new THREE.CylinderGeometry(radius * 1.5, radius * 1.5, radius * 0.65, 10), materials.dark, 'generatedLegJointDarkBearing', [0, 0, 0], [Math.PI / 2, 0, 0]);
    core = mesh(weakPoint, new THREE.CylinderGeometry(radius * 0.82, radius * 0.82, radius * 0.72, 10), materials.weakPoint, 'generatedLegJointEmitterPin', [0, 0, 0.12], [Math.PI / 2, 0, 0]);
    mesh(weakPoint, new THREE.TorusGeometry(radius * 1.18, radius * 0.12, 6, 10), materials.trim, 'generatedLegJointMechanicalBearingRing', [0, 0, radius * 0.34]);
    box(weakPoint, materials.trim, 'generatedLegJointCircuitLead', [radius * 0.18, radius * 1.45, 0.05], [radius * 1.28, radius * 0.48, radius * 0.32], [0, 0, -0.5]);
  } else if (definition.id === 'counterweightCore') {
    socket = box(weakPoint, materials.dark, 'generatedCounterweightDarkAttachmentFork', [radius * 3.2, radius * 2.7, 0.2], [0, 0, 0]);
    box(weakPoint, materials.trim, 'generatedCounterweightArmorFace', [radius * 2.8, radius * 2.25, 0.18], [0, 0, 0.12]);
    core = box(weakPoint, materials.weakPoint, 'generatedCounterweightRecessedEmitterCore', [radius * 1.35, radius * 1.25, 0.09], [0, 0, 0.24]);
    for (const side of [-1, 1]) {
      box(weakPoint, materials.dark, 'generatedCounterweightTerminalBand', [radius * 0.34, radius * 2.4, 0.1], [side * radius * 1.32, 0, 0.21]);
    }
  } else {
    socket = mesh(weakPoint, new THREE.CylinderGeometry(radius * 1.28, radius * 1.4, 0.11, 10), materials.dark, 'generatedWeakPointDarkSocket', [0, 0, 0], [Math.PI / 2, 0, 0]);
    core = mesh(weakPoint, new THREE.SphereGeometry(radius, 10, 7), materials.weakPoint, 'generatedWeakPointEmitterCore', [0, 0, 0.07], null, [1, 1, 0.5]);
  }
  core.userData.weakPoint = true;
  core.userData.weakPointId = definition.id;
  if (!weakPoint.children.some((child) => child.name.includes('Band') || child.name.includes('Ring'))) {
    mesh(weakPoint, new THREE.TorusGeometry(radius * 1.18, radius * 0.1, 5, 10), materials.trim, 'generatedWeakPointMechanicalBand', [0, 0, 0.1]);
  }
  weakPoint.userData.weakPointGeometryId = definition.id;
  weakPoint.userData.idSpecificGeometry = true;
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
    const sideCircuit = addCircuitPanel(sidePlate, materials, `generatedMeleeSideArmor${side < 0 ? 'Left' : 'Right'}`, {
      position: [side * (sidePlateSize[0] * 0.58), 0, 0.04],
      rotation: [0, side * Math.PI / 2, 0],
      width: sidePlateSize[2] * 0.56,
      height: sidePlateSize[1] * 0.48,
      mirror: side < 0,
      powered: false,
    });
    markDecorativeMeleeArmor(sideCircuit, 'sideCircuitPanel');

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
      const darkSpikeTip = mesh(
        armor,
        new THREE.ConeGeometry(0.085, length * 0.34, 5),
        materials.dark,
        'generatedMeleeFlankSpikeDarkWorkingEnd',
        [
          side * (sidePlateX + sidePlateSize[0] * 0.5 + length * 0.83),
          sidePlateY + (animal ? 0.08 : 0.1),
          sidePlateZ + spikeOffset,
        ],
        [0, 0, side * -Math.PI / 2],
      );
      markDecorativeMeleeArmor(darkSpikeTip, 'flankSpikeDarkTip');
      darkSpikeTip.userData.contactDamage = false;
      darkSpikeTip.userData.reaverbotWorkingEnd = true;
      parts.spikes.push(darkSpikeTip);
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
      const dorsalTip = mesh(
        armor,
        new THREE.ConeGeometry(0.075, dorsalLength * 0.34, 5),
        materials.dark,
        animal ? 'generatedMeleeDorsalSpikeDarkWorkingEnd' : 'generatedMeleeShoulderSpikeDarkWorkingEnd',
        [side * topPlateX, topPlateY + topPlateSize[1] * 0.5 + dorsalLength * 0.83, animal ? -0.18 : -0.1],
      );
      markDecorativeMeleeArmor(dorsalTip, animal ? 'dorsalSpikeDarkTip' : 'shoulderSpikeDarkTip');
      dorsalTip.userData.contactDamage = false;
      dorsalTip.userData.reaverbotWorkingEnd = true;
      parts.spikes.push(dorsalTip);
    }
  }

  armor.userData.plateCount = parts.plates.length;
  armor.userData.spikeCount = parts.spikes.length;
  return parts;
}

function addSurfaceGrammar(root, genome, frame, materials) {
  const rhythm = genome.body.proportions.panelRhythm;
  const center = frame.anchors.center;
  const plan = frame.plan;
  const animal = plan === 'quadruped' || plan === 'crawler';
  const aerial = plan === 'hoverBell' || plan === 'flyer';
  const frontZ = frame.anchors.frontLow[2] + (animal ? 0.08 : 0.06);
  const panelWidth = plan === 'tripod'
    ? 0.58
    : animal
      ? 0.66
      : aerial
        ? 0.54
        : 0.48;
  const panelHeight = animal ? 0.3 : plan === 'hopper' ? 0.46 : 0.5;
  const panelY = center[1] + (animal ? 0.12 : plan === 'hopper' ? 0.08 : 0.05);
  addCircuitPanel(root, materials, `generated${plan}Body`, {
    position: [0, panelY, frontZ],
    width: panelWidth,
    height: panelHeight,
    mirror: (rhythm + genome.body.proportions.spikeCount) % 2 === 0,
  });

  if (animal || aerial || plan === 'hopper') {
    const undersideSize = animal
      ? [Math.max(0.62, Math.abs(frame.anchors.side[0]) * 1.35), 0.13, Math.max(0.78, Math.abs(frame.anchors.rear[2] - frontZ) * 0.7)]
      : aerial
        ? [0.72, 0.12, 0.72]
        : [0.62, 0.12, 0.58];
    box(
      root,
      materials.dark,
      `generated${plan}DarkUnderside`,
      undersideSize,
      [center[0], frame.anchors.belly[1] + 0.02, center[2]],
    );
  }

  if (plan === 'biped' || plan === 'lowBiped') {
    mesh(root, new THREE.TorusGeometry(0.44, 0.055, 6, 12), materials.trim, `generated${plan}WaistMechanicalBand`, [0, center[1] - 0.34, 0], [Math.PI / 2, 0, 0]);
  } else if (animal) {
    mesh(root, new THREE.TorusGeometry(0.3, 0.045, 6, 12), materials.trim, `generated${plan}NeckMechanicalBand`, [0, frame.anchors.eye[1] - 0.38, frame.anchors.frontLow[2] - 0.08], [Math.PI / 2, 0, 0]);
  } else if (aerial) {
    mesh(root, new THREE.TorusGeometry(0.48, 0.055, 6, 14), materials.dark, `generated${plan}DarkBellLipBand`, [0, frame.anchors.belly[1] + 0.06, 0], [Math.PI / 2, 0, 0]);
  }

  const spikeCount = genome.body.proportions.spikeCount;
  for (let index = 0; index < spikeCount; index += 1) {
    const offset = (index - (spikeCount - 1) * 0.5) * 0.24;
    const length = 0.28 + index * 0.025;
    mesh(root, new THREE.ConeGeometry(0.07, length, 5), materials.secondary, 'generatedReaverbotSilhouetteSpire', [offset, center[1] + 0.61, center[2] - 0.08]);
    mesh(root, new THREE.ConeGeometry(0.052, 0.16, 5), materials.dark, 'generatedReaverbotSilhouetteSpireDarkWorkingEnd', [offset, center[1] + 0.84 + index * 0.025, center[2] - 0.08]);
  }
}

function createBossOrnaments(root, genome, frame, materials) {
  if (!genome?.bossProfileId || !genome?.boss) return null;
  const group = new THREE.Group();
  group.name = `generatedReaverbotBossOrnaments_${genome.bossProfileId}`;
  group.userData.bossProfileId = genome.bossProfileId;
  const placements = genome.boss.ornamentPlacement ?? ['crown', 'weaponCollar', 'dorsalArch'];
  const center = frame.anchors.center;
  const eye = frame.anchors.eye;
  const rear = frame.anchors.rearHigh ?? frame.anchors.rear;
  for (const placement of placements) {
    if (placement === 'crown') {
      for (let index = -2; index <= 2; index += 1) {
        const height = 0.24 + (2 - Math.abs(index)) * 0.08;
        mesh(group, new THREE.ConeGeometry(0.055, height, 5), materials.trim,
          'generatedReaverbotBossCeremonialCrownSpire',
          [eye[0] + index * 0.16, eye[1] + 0.42 + height * 0.5, eye[2] - 0.04]);
      }
    } else if (placement === 'weaponCollar') {
      mesh(group, new THREE.TorusGeometry(0.48, 0.055, 7, 24), materials.trim,
        'generatedReaverbotBossWeaponCeremonialCollar',
        [center[0], center[1] + 0.18, center[2] + 0.34], [Math.PI / 2, 0, 0]);
    } else if (placement === 'dorsalArch') {
      mesh(group, new THREE.TorusGeometry(0.62, 0.055, 7, 28, Math.PI), materials.trim,
        'generatedReaverbotBossDorsalRuinArch',
        [rear[0], rear[1] + 0.34, rear[2]], [0, 0, Math.PI / 2]);
    } else if (placement === 'flankShrine') {
      for (const side of [-1, 1]) {
        box(group, materials.secondary, 'generatedReaverbotBossFlankShrine',
          [0.12, 0.46, 0.22], [center[0] + side * 0.72, center[1] + 0.12, center[2]]);
        mesh(group, new THREE.OctahedronGeometry(0.075), materials.emissive,
          'generatedReaverbotBossFlankShrineRuby',
          [center[0] + side * 0.72, center[1] + 0.18, center[2] - 0.13]);
      }
    } else if (placement === 'baseSkirt') {
      mesh(group, new THREE.CylinderGeometry(0.78, 0.92, 0.16, 10, 1, true), materials.trim,
        'generatedReaverbotBossCeremonialBaseSkirt',
        [center[0], Math.max(0.18, center[1] - 0.62), center[2]]);
    } else if (placement === 'shoulderFin') {
      for (const side of [-1, 1]) {
        mesh(group, new THREE.ConeGeometry(0.11, 0.52, 5), materials.primary,
          'generatedReaverbotBossShoulderFin',
          [center[0] + side * 0.68, center[1] + 0.38, center[2]], [0, 0, side * -0.42]);
      }
    }
  }
  root.add(group);
  return group;
}

export function createReaverbotVisual(genome) {
  const materials = createMaterials(genome);
  const visualRoot = new THREE.Group();
  visualRoot.name = `generatedReaverbotVisual_${genome.seed}`;
  visualRoot.userData.reaverbotGenome = genome;
  visualRoot.position.y = genome.body.hoverHeight ?? 0;

  const frame = createBodyFrame(visualRoot, genome, {
    ...materials.scopes.body,
    mobilityWeapon: materials.scopes.weapon.weapon,
    mobilityEmissive: materials.scopes.weapon.emissive,
  });
  const eye = createEye(
    visualRoot,
    frame.anchors.eye,
    materials.scopes.eye,
    genome.body.proportions.headScale,
  );
  const weapon = createWeapon(visualRoot, genome, frame, materials.scopes.weapon);
  const chargeModule = createChargeModule(visualRoot, genome, frame, materials.scopes.charge);
  if (genome.modules.weapon.id === 'crusherJaw' && frame.headAssembly) {
    // The eye and bear-trap mouth are the face. Attaching them to the animal's
    // neck assembly makes each dog-like head tilt move the whole readable face.
    visualRoot.updateMatrixWorld(true);
    frame.headAssembly.attach(eye.group);
    frame.headAssembly.attach(weapon.group);
  }
  const defense = createDefense(visualRoot, genome, frame, materials.scopes.defense);
  if (genome.modules.defense?.id === 'armorShutters') {
    visualRoot.updateMatrixWorld(true);
    eye.group.attach(defense.group);
    defense.group.userData.basePosition = defense.group.position.clone();
  }
  if (genome.modules.weapon.id === 'rotorBlade') {
    defense.group.add(weapon.group);
    weapon.group.position.set(0, 0, 0);
    weapon.group.rotation.set(0, 0, 0);
    weapon.group.userData.linkedDefenseId = 'rotatingPlates';
  }
  const weakPoint = createWeakPoint(
    visualRoot,
    genome,
    frame,
    materials.scopes.weakPoint,
    eye,
    defense,
    weapon,
  );
  const meleeArmor = createMeleeSilhouetteArmor(
    visualRoot,
    genome,
    frame,
    materials.scopes.decor,
  );
  addSurfaceGrammar(visualRoot, genome, frame, materials.scopes.body);
  const bossOrnaments = createBossOrnaments(
    visualRoot,
    genome,
    frame,
    materials.scopes.bossDecor ?? materials.scopes.decor,
  );
  visualRoot.userData.meleeSilhouetteArmored = meleeArmor.enabled;
  visualRoot.scale.setScalar(
    genome.body.proportions.overallScale * (genome.boss?.visualScale ?? 1),
  );
  visualRoot.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(visualRoot);
  const size = bounds.getSize(new THREE.Vector3());

  return {
    root: visualRoot,
    frame,
    eye,
    weapon,
    chargeModule,
    defense,
    weakPoint,
    meleeArmor,
    bossOrnaments,
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
    if (Number.isFinite(shutter.userData.openY)) {
      const side = shutter.userData.eyelidSide ?? Math.sign(shutter.position.y || 1);
      shutter.position.y = THREE.MathUtils.lerp(shutter.userData.closedY, shutter.userData.openY, easedOpen);
      shutter.rotation.z = side * THREE.MathUtils.lerp(0.05, 0.2, easedOpen);
    } else {
      const side = Math.sign(shutter.userData.openX || shutter.position.x || 1);
      shutter.position.x = THREE.MathUtils.lerp(shutter.userData.closedX, shutter.userData.openX, easedOpen);
      shutter.rotation.z = side * THREE.MathUtils.lerp(0.05, 0.34, easedOpen);
    }
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

function updateCanineGait(visual, {
  dt,
  moving,
  speedRatio,
  state,
  stateProgress,
  attackKind,
  comboLocalProgress,
  springBounceActive,
  springBounceProgress,
}) {
  const { frame } = visual;
  const gait = frame.gait;
  if (frame.plan !== 'quadruped' || !gait) {
    return null;
  }

  visual.root.updateWorldMatrix(true, false);
  visual.root.getWorldPosition(GAIT_TEMP_WORLD);
  if (!gait.initialized) {
    gait.lastWorldPosition.copy(GAIT_TEMP_WORLD);
    gait.initialized = true;
  }
  GAIT_TEMP_DELTA.copy(GAIT_TEMP_WORLD).sub(gait.lastWorldPosition);
  gait.lastWorldPosition.copy(GAIT_TEMP_WORLD);
  GAIT_TEMP_DELTA.y = 0;
  const travelled = GAIT_TEMP_DELTA.length();
  const jawHop = state === 'commit' && attackKind === 'jawCombo';
  const pounce = state === 'commit' && attackKind === 'pounce';
  const attackOverride = jawHop || pounce || springBounceActive;
  const locomoting = moving && travelled > 0.0001 && !attackOverride;

  if (locomoting) {
    visual.root.getWorldQuaternion(GAIT_TEMP_QUATERNION).invert();
    GAIT_TEMP_DELTA.applyQuaternion(GAIT_TEMP_QUATERNION);
    if (Math.hypot(GAIT_TEMP_DELTA.x, GAIT_TEMP_DELTA.z) > 0.0001) {
      gait.targetDirection.set(GAIT_TEMP_DELTA.x, GAIT_TEMP_DELTA.z).normalize();
      gait.direction.lerp(gait.targetDirection, Math.min(1, dt * 12)).normalize();
    }
    const strideLength = THREE.MathUtils.lerp(0.68, 0.54, THREE.MathUtils.clamp(speedRatio, 0, 1.5) / 1.5);
    gait.strideLength = strideLength;
    gait.phase = (gait.phase + GAIT_TAU * Math.min(travelled, 0.35) / strideLength) % GAIT_TAU;
  }

  const activityTarget = locomoting ? 1 : 0;
  gait.activity = THREE.MathUtils.lerp(
    gait.activity,
    activityTarget,
    Math.min(1, dt * (activityTarget > gait.activity ? 12 : 8)),
  );
  const stepSpan = gait.strideLength * gait.stanceFraction
    / Math.max(0.1, visual.root.scale.x || 1);
  const swingHeight = THREE.MathUtils.lerp(0.13, 0.2, THREE.MathUtils.clamp(speedRatio, 0, 1.4) / 1.4);
  const response = Math.min(1, dt * (attackOverride ? 18 : 15));
  gait.stanceDiagonal = Math.cos(gait.phase) >= 0
    ? 'leftFront+rightRear'
    : 'rightFront+leftRear';
  gait.bodyRoll = attackOverride ? 0 : Math.sin(gait.phase) * 0.035 * gait.activity;
  gait.bob = attackOverride ? 0 : Math.cos(gait.phase * 2) * 0.026 * gait.activity;

  for (const limb of frame.limbs.filter((entry) => entry.canine)) {
    let forward = limb.restForward;
    let down = limb.restDown;
    let lateral = 0;
    let swing = 0;
    let planted = gait.activity < 0.05;

    if (springBounceActive) {
      const tuck = Math.sin(THREE.MathUtils.clamp(springBounceProgress, 0, 1) * Math.PI);
      down -= tuck * (limb.front ? 0.18 : 0.22);
      forward += tuck * (limb.front ? 0.1 : -0.07);
      swing = tuck;
      planted = springBounceProgress < 0.05 || springBounceProgress > 0.95;
    } else if (jawHop) {
      const tuck = Math.sin(THREE.MathUtils.clamp(comboLocalProgress, 0, 1) * Math.PI);
      down -= tuck * (limb.front ? 0.17 : 0.2);
      forward += tuck * (limb.front ? 0.11 : -0.055);
      swing = tuck;
      planted = comboLocalProgress < 0.05 || comboLocalProgress > 0.9;
    } else if (pounce) {
      const tuck = Math.sin(THREE.MathUtils.clamp(stateProgress, 0, 1) * Math.PI);
      down -= tuck * (limb.front ? 0.2 : 0.24);
      forward += tuck * (limb.front ? 0.13 : -0.08);
      swing = tuck;
      planted = stateProgress < 0.04 || stateProgress > 0.94;
    } else if (gait.activity > 0.001) {
      const cycle = ((gait.phase + limb.gaitPhase) % GAIT_TAU + GAIT_TAU) % GAIT_TAU;
      const normalized = cycle / GAIT_TAU;
      let strideOffset;
      let lift = 0;
      if (normalized < gait.stanceFraction) {
        const stanceProgress = normalized / gait.stanceFraction;
        strideOffset = THREE.MathUtils.lerp(stepSpan * 0.5, -stepSpan * 0.5, stanceProgress);
        planted = gait.activity > 0.35;
      } else {
        const swingProgress = (normalized - gait.stanceFraction) / (1 - gait.stanceFraction);
        const easedSwing = THREE.MathUtils.smoothstep(swingProgress, 0, 1);
        strideOffset = THREE.MathUtils.lerp(-stepSpan * 0.5, stepSpan * 0.5, easedSwing);
        lift = Math.sin(swingProgress * Math.PI) * swingHeight;
        swing = lift / Math.max(0.001, swingHeight);
      }
      forward += strideOffset * gait.direction.y * gait.activity;
      lateral += strideOffset * gait.direction.x * gait.activity;
      down -= lift * gait.activity;
    }
    down += gait.bob;

    const pose = solveCanineLegPose(limb, { forward, down, lateral, swing });
    applyCanineLegPose(limb, pose, response, planted);
  }

  frame.body.rotation.z = THREE.MathUtils.lerp(
    frame.body.rotation.z,
    gait.bodyRoll,
    Math.min(1, dt * 9),
  );
  if (frame.tailPivot) {
    frame.tailPivot.rotation.y = THREE.MathUtils.lerp(
      frame.tailPivot.rotation.y,
      Math.sin(gait.phase) * 0.18 * gait.activity,
      Math.min(1, dt * 8),
    );
    frame.tailPivot.rotation.x = THREE.MathUtils.lerp(
      frame.tailPivot.rotation.x,
      0.08 + Math.cos(gait.phase * 2) * 0.04 * gait.activity,
      Math.min(1, dt * 8),
    );
  }
  return gait;
}

function updateSpringMobilityVisual(visual, {
  state,
  stateProgress,
  attackKind,
  springBounceActive,
  springBounceProgress,
}) {
  const springMobility = visual.frame.springMobility;
  if (!springMobility || visual.frame.springLimbs.length === 0) return 0;

  let compression = 0;
  if (state === 'telegraph' && attackKind === 'pounce') {
    compression = THREE.MathUtils.smoothstep(stateProgress, 0.08, 0.86) * 0.46;
  } else if (state === 'commit' && attackKind === 'pounce') {
    const takeoff = 1 - THREE.MathUtils.smoothstep(stateProgress, 0.02, 0.2);
    const landing = THREE.MathUtils.smoothstep(stateProgress, 0.78, 1);
    compression = Math.max(takeoff * 0.22, landing * 0.42);
  } else if (springBounceActive) {
    const progress = THREE.MathUtils.clamp(springBounceProgress, 0, 1);
    const takeoff = 1 - THREE.MathUtils.smoothstep(progress, 0.02, 0.18);
    const landing = THREE.MathUtils.smoothstep(progress, 0.8, 1);
    compression = Math.max(takeoff * 0.2, landing * 0.34);
  }

  for (const limb of visual.frame.springLimbs) {
    if (limb.springGroup) {
      limb.springGroup.scale.y = 1 - compression * 0.42;
    }
    if (limb.springEndpoint && Number.isFinite(limb.springEndpointBaseY)) {
      limb.springEndpoint.position.y = limb.springEndpointBaseY
        + compression * (limb.springCompressionTravel ?? 0.12);
    }
  }
  springMobility.compression = compression;
  springMobility.airborne = springBounceActive
    || (state === 'commit' && attackKind === 'pounce');
  return compression;
}

function updateLaunchLegVisual(visual, {
  time,
  dt,
  state,
  stateProgress,
  attackKind,
  springBounceActive,
  springBounceProgress,
}) {
  const weapon = visual.weapon;
  if (!weapon.launchLegAssembly) return;

  const restHip = -0.48;
  const restKnee = 1.28;
  const restAnkle = -0.74;
  const crouched = { hip: -0.86, knee: 1.76, ankle: -1.02 };
  const extended = { hip: -0.12, knee: 0.34, ankle: -0.26 };
  const tucked = { hip: -0.36, knee: 1.5, ankle: -0.84 };
  const progress = THREE.MathUtils.clamp(stateProgress, 0, 1);
  let hip = restHip;
  let knee = restKnee;
  let ankle = restAnkle;
  let rocketThrust = 0;

  const interpolatePose = (from, to, amount) => ({
    hip: THREE.MathUtils.lerp(from.hip, to.hip, amount),
    knee: THREE.MathUtils.lerp(from.knee, to.knee, amount),
    ankle: THREE.MathUtils.lerp(from.ankle, to.ankle, amount),
  });

  if (state === 'telegraph' && attackKind === 'pounce') {
    const compression = THREE.MathUtils.smoothstep(progress, 0.06, 0.9);
    ({ hip, knee, ankle } = interpolatePose(
      { hip: restHip, knee: restKnee, ankle: restAnkle },
      crouched,
      compression,
    ));
    // The high hip rockets sputter on during the final warning without yet
    // producing full exhaust, making their role readable before takeoff.
    rocketThrust = THREE.MathUtils.smoothstep(progress, 0.82, 1) * 0.18;
  } else if (state === 'commit' && attackKind === 'pounce') {
    let pose;
    if (progress < 0.3) {
      pose = interpolatePose(crouched, extended, THREE.MathUtils.smoothstep(progress / 0.3, 0, 1));
    } else if (progress < 0.7) {
      pose = interpolatePose(extended, tucked, THREE.MathUtils.smoothstep((progress - 0.3) / 0.4, 0, 1));
    } else {
      pose = interpolatePose(tucked, extended, THREE.MathUtils.smoothstep((progress - 0.7) / 0.3, 0, 1));
    }
    ({ hip, knee, ankle } = pose);
    rocketThrust = 0.88 + Math.sin(time * 37) * 0.12;
  } else if (springBounceActive) {
    const bounceProgress = THREE.MathUtils.clamp(springBounceProgress, 0, 1);
    const launch = THREE.MathUtils.smoothstep(bounceProgress, 0, 0.24);
    const landing = THREE.MathUtils.smoothstep(bounceProgress, 0.72, 1);
    const airbornePose = interpolatePose(crouched, tucked, launch);
    const pose = interpolatePose(airbornePose, extended, landing);
    ({ hip, knee, ankle } = pose);
    rocketThrust = (1 - landing) * (0.72 + Math.sin(time * 31) * 0.12);
  } else if (state === 'recovery' && attackKind === 'pounce') {
    ({ hip, knee, ankle } = interpolatePose(
      extended,
      { hip: restHip, knee: restKnee, ankle: restAnkle },
      THREE.MathUtils.smoothstep(progress, 0.06, 0.88),
    ));
  }

  const response = Math.min(1, dt * (state === 'commit' ? 24 : 13));
  weapon.launchLegHipPivot.rotation.x = THREE.MathUtils.lerp(
    weapon.launchLegHipPivot.rotation.x,
    hip,
    response,
  );
  weapon.launchLegKneePivot.rotation.x = THREE.MathUtils.lerp(
    weapon.launchLegKneePivot.rotation.x,
    knee,
    response,
  );
  weapon.launchLegAnklePivot.rotation.x = THREE.MathUtils.lerp(
    weapon.launchLegAnklePivot.rotation.x,
    ankle,
    response,
  );
  weapon.launchLegFootPivot.rotation.x = THREE.MathUtils.lerp(
    weapon.launchLegFootPivot.rotation.x,
    -(hip + knee + ankle),
    response,
  );
  weapon.launchLegAssembly.userData.pose = {
    hip,
    knee,
    ankle,
    rocketThrust,
  };

  for (let index = 0; index < weapon.launchLegFlames.length; index += 1) {
    const flame = weapon.launchLegFlames[index];
    const visible = rocketThrust > 0.035;
    const pulse = Math.max(0.05, rocketThrust) * (0.92 + Math.sin(time * 43 + index) * 0.08);
    flame.visible = visible;
    flame.scale.set(0.82 + pulse * 0.18, 0.2 + pulse * 1.18, 0.82 + pulse * 0.18);
    flame.material.opacity = visible ? THREE.MathUtils.clamp(0.34 + pulse * 0.62, 0, 0.96) : 0;
  }
}

function updateCrawlerArticulatedVisual(visual, {
  time,
  dt,
  moving,
  speedRatio,
}) {
  const crawlerLimbs = visual.frame.limbs.filter((limb) => limb.crawlerArticulated);
  if (crawlerLimbs.length === 0) return;
  const activity = moving ? THREE.MathUtils.clamp(speedRatio, 0.35, 1.5) : 0;
  const response = Math.min(1, dt * 12);
  for (const limb of crawlerLimbs) {
    const phase = time * (5.2 + activity * 2.2) + limb.phase;
    const stride = Math.sin(phase) * 0.27 * activity;
    const lift = Math.max(0, Math.cos(phase)) * 0.24 * activity;
    limb.hipPivot.rotation.x = THREE.MathUtils.lerp(
      limb.hipPivot.rotation.x,
      stride,
      response,
    );
    limb.kneePivot.rotation.x = THREE.MathUtils.lerp(
      limb.kneePivot.rotation.x,
      limb.restKneeX - stride * 0.48 + lift,
      response,
    );
    limb.footPivot.rotation.x = THREE.MathUtils.lerp(
      limb.footPivot.rotation.x,
      -stride * 0.36 - lift * 0.55,
      response,
    );
    limb.contactAnchor.userData.planted = !moving || Math.cos(phase) <= 0;
  }
}

function updateWheelMobilityVisual(visual, { dt }) {
  const wheelMobility = visual.frame.wheelMobility;
  if (!wheelMobility || visual.frame.wheels.length === 0) return;

  visual.root.updateWorldMatrix(true, false);
  visual.root.getWorldPosition(GAIT_TEMP_WORLD);
  if (!wheelMobility.initialized) {
    wheelMobility.lastWorldPosition.copy(GAIT_TEMP_WORLD);
    wheelMobility.initialized = true;
    return;
  }

  GAIT_TEMP_DELTA.copy(GAIT_TEMP_WORLD).sub(wheelMobility.lastWorldPosition);
  wheelMobility.lastWorldPosition.copy(GAIT_TEMP_WORLD);
  GAIT_TEMP_DELTA.y = 0;
  const travel = GAIT_TEMP_DELTA.length();
  let signedTravel = 0;
  let steeringTarget = 0;
  if (travel > 0.0001) {
    visual.root.getWorldQuaternion(GAIT_TEMP_QUATERNION).invert();
    GAIT_TEMP_DELTA.applyQuaternion(GAIT_TEMP_QUATERNION);
    signedTravel = Math.sign(GAIT_TEMP_DELTA.z || 1) * travel;
    steeringTarget = THREE.MathUtils.clamp(
      Math.atan2(GAIT_TEMP_DELTA.x, Math.max(0.08, Math.abs(GAIT_TEMP_DELTA.z))),
      -0.48,
      0.48,
    );
    wheelMobility.distanceTravelled += travel;
  }
  wheelMobility.steering = THREE.MathUtils.lerp(
    wheelMobility.steering,
    steeringTarget,
    Math.min(1, dt * 8),
  );

  for (const wheel of visual.frame.wheels) {
    if (signedTravel !== 0) {
      wheel.spinPivot.rotation.x += signedTravel / Math.max(0.08, wheel.radius);
    }
    wheel.steerPivot.rotation.y = THREE.MathUtils.lerp(
      wheel.steerPivot.rotation.y,
      wheel.front ? wheelMobility.steering : wheelMobility.steering * -0.18,
      Math.min(1, dt * 9),
    );
    wheel.suspension.position.y = wheel.baseSuspensionY
      + Math.sin(wheelMobility.distanceTravelled / Math.max(0.08, wheel.radius) + (wheel.front ? 0 : Math.PI)) * 0.018;
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
  defenseDisabled = false,
  weakPointExposed = false,
  weakPointLocation = null,
  tractorBeamActive = false,
  tractorBeamIntensity = 0,
  tractorBeamLength = 3.4,
  springBounceActive = false,
  springBounceProgress = 0,
  chargeDirection = null,
} = {}) {
  const eyeRefocusActive = state === 'eyeRefocus';
  const eyeRefocusProgress = eyeRefocusActive
    ? THREE.MathUtils.clamp(stateProgress, 0, 1)
    : 0;
  const refocusShakeEnvelope = eyeRefocusActive
    ? THREE.MathUtils.smoothstep(eyeRefocusProgress, 0.08, 0.2)
      * (1 - THREE.MathUtils.smoothstep(eyeRefocusProgress, 0.68, 1))
    : 0;
  const refocusShake = eyeRefocusActive
    ? Math.sin((eyeRefocusProgress - 0.08) * Math.PI * 8) * refocusShakeEnvelope
    : 0;
  const refocusImpactDip = eyeRefocusActive
    ? -Math.sin(Math.min(1, eyeRefocusProgress / 0.32) * Math.PI) * 0.09
      - Math.abs(refocusShake) * 0.018
    : 0;
  const comboCycle = Math.min(2, Math.floor(stateProgress * 3));
  const comboLocalProgress = stateProgress >= 1
    ? 1
    : (stateProgress * 3) - comboCycle;
  const canineGait = updateCanineGait(visual, {
    dt,
    moving,
    speedRatio,
    state,
    stateProgress,
    attackKind,
    comboLocalProgress,
    springBounceActive,
    springBounceProgress,
  });
  updateSpringMobilityVisual(visual, {
    state,
    stateProgress,
    attackKind,
    springBounceActive,
    springBounceProgress,
  });
  updateLaunchLegVisual(visual, {
    time,
    dt,
    state,
    stateProgress,
    attackKind,
    springBounceActive,
    springBounceProgress,
  });
  updateCrawlerArticulatedVisual(visual, {
    time,
    dt,
    moving,
    speedRatio,
  });
  updateWheelMobilityVisual(visual, { dt });
  const locomotion = moving ? Math.sin(time * (7 + speedRatio * 3)) : Math.sin(time * 1.8) * 0.08;
  for (const limb of visual.frame.limbs) {
    if (limb.canine || limb.springLoaded || limb.crawlerArticulated) continue;
    const amplitude = limb.arm ? 0.18 : 0.32;
    const target = moving ? locomotion * amplitude * (limb.phase || 1) : 0;
    limb.pivot.rotation.x = THREE.MathUtils.lerp(limb.pivot.rotation.x, target, Math.min(1, dt * 10));
  }
  for (const wing of visual.frame.wings) {
    wing.pivot.rotation.z = Math.sin(time * 5.5 + wing.phase) * 0.16;
    wing.pivot.rotation.y += dt * (visual.frame.plan === 'flyer' ? 0.45 : 1.7);
  }

  if (visual.chargeModule?.id) {
    const thrusting = state === 'commit' && attackKind === 'charge';
    const pulse = 0.82 + Math.sin(time * 38) * 0.16;
    for (let index = 0; index < visual.chargeModule.flames.length; index += 1) {
      const flame = visual.chargeModule.flames[index];
      flame.visible = thrusting;
      flame.scale.set(
        0.86 + index * 0.04,
        thrusting ? pulse * visual.chargeModule.thrustScale : 0.01,
        0.86 + index * 0.04,
      );
      flame.material.opacity = thrusting ? 0.76 + Math.sin(time * 31 + index) * 0.12 : 0;
    }
    if (visual.chargeModule.id === 'vectorRocket') {
      const horizontal = chargeDirection
        ? Math.hypot(chargeDirection.x, chargeDirection.z)
        : 1;
      const pitch = chargeDirection
        ? -Math.atan2(chargeDirection.y, Math.max(0.001, horizontal))
        : 0;
      visual.chargeModule.gimbal.rotation.x = THREE.MathUtils.lerp(
        visual.chargeModule.gimbal.rotation.x,
        thrusting ? pitch : 0,
        Math.min(1, dt * 8),
      );
    }
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
      // Fold the real two-link arm across the chest: the upper boom holds the
      // elbow high on its mounted side, the forearm crosses to the opposite
      // hip, and the wrist turns only enough to present the reinforced back.
      // The shoulder remains visibly attached throughout the brace.
      targetX = 0.18 * brace;
      targetY = -mountSide * 0.08 * brace;
      targetZ = mountSide * 0.12 * brace;
      elbowAngle = THREE.MathUtils.lerp(0.42, 0.04, brace);
      // Swing past ninety degrees so the long forearm returns toward the
      // chassis instead of becoming a detached-looking bar far in front of it.
      elbowYaw = -mountSide * 2.18 * brace;
      wristX = -0.12 * brace;
      // Counter-rotate at the wrist: the broad armored back stays aimed at the
      // attacker while the hidden palm eye faces inward against the torso.
      wristY = -mountSide * 0.96 * brace;
      talonOpen = THREE.MathUtils.lerp(0.04, 0.02, brace);
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
      // A stale reach value can survive from an interrupted strike. Guarding
      // owns the complete elbow pose so the forearm cannot be pulled back out
      // of its cross-body brace by that previous extension request.
      if (Number.isFinite(clawExtension) && guardProgress <= 0.001) {
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
        const guarding = guardProgress > 0.001;
        const talonPitch = guarding ? -0.02 : -talonOpen;
        const talonYaw = guarding
          ? mountSide * (Math.PI / 2 + 0.08) + fanDirection * 0.06
          : (talon.userData.baseYaw ?? 0) + fanDirection * talonOpen * 0.58;
        talon.rotation.x = THREE.MathUtils.lerp(talon.rotation.x, talonPitch, hingeResponse);
        talon.rotation.y = THREE.MathUtils.lerp(
          talon.rotation.y,
          talonYaw,
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

    visual.materials.weapon.emissive.setHex(clawWarning > 0.01 ? 0xff1010 : 0x000000);
    visual.materials.weapon.emissiveIntensity = clawWarning;
  }

  let jawWarning = 0;
  let headTilt = refocusShake * 0.28;
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
    if (state === 'commit') {
      headTilt += (comboCycle % 2 === 0 ? -1 : 1)
        * Math.sin(comboLocalProgress * Math.PI)
        * 0.24;
    }
  }
  const headAssembly = visual.frame.headAssembly ?? visual.frame.head;
  headAssembly.rotation.z = THREE.MathUtils.lerp(
    headAssembly.rotation.z,
    headTilt,
    Math.min(1, dt * (eyeRefocusActive ? 26 : visual.weapon.jawUpperPivot ? 15 : 10)),
  );

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
  const attackLift = state === 'commit' && attackKind === 'pounce' && !visual.frame.springMobility
    ? Math.sin(stateProgress * Math.PI) * 1.25
    : state === 'commit' && attackKind === 'charge'
      ? Math.sin(stateProgress * Math.PI) * 0.12
      : state === 'commit' && attackKind === 'jawCombo'
        ? Math.sin(comboLocalProgress * Math.PI) * 0.34
        : state === 'position' && attackKind === 'jawCombo' && moving
          ? Math.max(0, Math.sin(time * 6.2)) * 0.19
      : 0;
  const canineBob = state === 'commit' && (attackKind === 'jawCombo' || attackKind === 'pounce')
    ? 0
    : canineGait?.bob ?? 0;
  const refocusOffsetResponse = Math.min(1, dt * (eyeRefocusActive ? 30 : 18));
  visual.root.userData.eyeRefocusVisualYOffset = THREE.MathUtils.lerp(
    visual.root.userData.eyeRefocusVisualYOffset ?? 0,
    refocusImpactDip,
    refocusOffsetResponse,
  );
  visual.root.position.x = THREE.MathUtils.lerp(
    visual.root.position.x,
    refocusShake * 0.08,
    refocusOffsetResponse,
  );
  visual.root.position.y = hoverHeight
    + hover
    + attackLift
    + recoveryReveal * 0.28
    + canineBob
    + visual.root.userData.eyeRefocusVisualYOffset;
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
  const baseEyeIntensity = weakPointExposed ? Math.max(eyePulse, 2) : eyePulse;
  let eyeIntensity = baseEyeIntensity;
  if (eyeRefocusActive) {
    const reacquired = THREE.MathUtils.smoothstep(eyeRefocusProgress, 0.38, 0.94);
    const flickerEnvelope = THREE.MathUtils.smoothstep(eyeRefocusProgress, 0.14, 0.28)
      * (1 - THREE.MathUtils.smoothstep(eyeRefocusProgress, 0.72, 0.9));
    const flicker = THREE.MathUtils.smoothstep(
      Math.sin(eyeRefocusProgress * Math.PI * 14) * 0.5 + 0.5,
      0.3,
      0.72,
    );
    const lockOnProgress = THREE.MathUtils.smoothstep(eyeRefocusProgress, 0.7, 0.94);
    const lockOnFlash = Math.sin(lockOnProgress * Math.PI) * 0.72;
    eyeIntensity = THREE.MathUtils.lerp(0.12, baseEyeIntensity, reacquired)
      * (1 - flickerEnvelope * (1 - flicker) * 0.76)
      + lockOnFlash;
  }
  visual.eye.lens.material.emissiveIntensity = Math.max(0.08, eyeIntensity);
  visual.weapon.group.scale.setScalar(
    visual.weapon.launchLegAssembly
      ? 1
      : state === 'telegraph'
        ? 1 + Math.sin(stateProgress * Math.PI) * 0.12
        : 1,
  );
  visual.materials.emissive.emissiveIntensity = state === 'telegraph' ? 1.15 : 0.65;
  if (visual.weapon.jawUpperPivot) {
    visual.materials.weapon.emissive.setHex(jawWarning > 0.01 ? 0xff1010 : 0x000000);
    visual.materials.weapon.emissiveIntensity = jawWarning;
  }

  let defenseOpenness = defenseActive ? 0 : 1;
  if (visual.defense.group.userData.quadrupedEyelids
    && state === 'telegraph'
    && !defenseDisabled) {
    defenseOpenness = THREE.MathUtils.smoothstep(stateProgress, 0, 0.24);
  }
  setReaverbotDefenseVisualActive(visual, defenseActive, defenseOpenness);
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
