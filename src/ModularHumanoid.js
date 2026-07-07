import * as THREE from 'three';

const DEFAULT_COLORS = {
  skin: 0xc98f67,
  hair: 0x2b1d16,
  eyes: 0x66c7ff,
  cloth: 0x33415c,
  armor: 0x9aa3ad,
  accent: 0x66f2ff,
};

const SLOT_NAMES = [
  'head',
  'chest',
  'back',
  'waist',
  'leftShoulder',
  'rightShoulder',
  'leftHand',
  'rightHand',
  'leftBoot',
  'rightBoot',
];

const SLOT_ALIASES = {
  helmet: 'head',
  headarmor: 'head',
  chestarmor: 'chest',
  chestplate: 'chest',
  bodyarmor: 'chest',
  cape: 'back',
  backpack: 'back',
  belt: 'waist',
  leftshoulderpad: 'leftShoulder',
  rightshoulderpad: 'rightShoulder',
  leftgauntlet: 'leftHand',
  rightgauntlet: 'rightHand',
  mainhand: 'rightHand',
  offhand: 'leftHand',
  leftweapon: 'leftHand',
  rightweapon: 'rightHand',
  leftbootarmor: 'leftBoot',
  rightbootarmor: 'rightBoot',
};

const SLOT_LOOKUP = SLOT_NAMES.reduce((lookup, slotName) => {
  lookup[slotName.toLowerCase()] = slotName;
  return lookup;
}, {});

function normalizeKey(value) {
  return String(value).replace(/[\s_-]/g, '').toLowerCase();
}

function makeMaterial(name, color, options = {}) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.62,
    metalness: options.metalness ?? 0.04,
    flatShading: options.flatShading ?? false,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });

  material.name = name;
  return material;
}

function capsuleGeometry(radius, length, capSegments = 5, radialSegments = 14) {
  if (THREE.CapsuleGeometry) {
    return new THREE.CapsuleGeometry(radius, length, capSegments, radialSegments);
  }

  return new THREE.CylinderGeometry(radius, radius, length + radius * 2, radialSegments);
}

function createMesh(name, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.scale.set(...scale);
  return mesh;
}

function createGroup(name, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  group.rotation.set(...rotation);
  return group;
}

function sideSign(side) {
  return side === 'left' ? -1 : 1;
}

function standardizeSide(sideOrSlotName = '') {
  return String(sideOrSlotName).toLowerCase().includes('left') ? 'left' : 'right';
}

/**
 * Procedural, modular, animation-ready humanoid made from Three.js primitives.
 *
 * Scene usage:
 *   const character = new ModularHumanoid();
 *   scene.add(character.root);
 */
export class ModularHumanoid {
  static PRESETS = {
    digger: {
      skinColor: 0xc98f67,
      hairColor: 0x3a2417,
      eyeColor: 0x68c4ff,
      clothColor: 0x2f405d,
      armorColor: 0x9aa3ad,
      equipment: {
        chest: 'alloyChestPlate',
        leftShoulder: 'shoulderPad',
        rightShoulder: 'shoulderPad',
        leftBoot: 'bootArmor',
        rightBoot: 'bootArmor',
        rightHand: 'swordArm',
        leftHand: 'shieldArm',
      },
    },
    scout: {
      skinColor: 0xb57c58,
      hairColor: 0x101014,
      eyeColor: 0xb8ff75,
      clothColor: 0x26312a,
      armorColor: 0x3d4653,
      equipment: {
        chest: 'alloyChestPlate',
        waist: 'belt',
        rightHand: 'swordArm',
      },
    },
    ruinGuard: {
      skinColor: 0xd0a07d,
      hairColor: 0x6e4c2e,
      eyeColor: 0x7097ff,
      clothColor: 0x202b44,
      armorColor: 0xb9c2cb,
      equipment: {
        head: 'simpleHelmet',
        chest: 'alloyChestPlate',
        leftShoulder: 'shoulderPad',
        rightShoulder: 'shoulderPad',
        leftBoot: 'bootArmor',
        rightBoot: 'bootArmor',
        rightHand: 'swordArm',
        leftHand: 'shieldArm',
      },
    },
  };

  constructor(options = {}) {
    this.options = {
      scale: options.scale ?? 1,
      hairStyle: options.hairStyle ?? 'short',
      colors: {
        skin: options.skinColor ?? options.colors?.skin ?? DEFAULT_COLORS.skin,
        hair: options.hairColor ?? options.colors?.hair ?? DEFAULT_COLORS.hair,
        eyes: options.eyeColor ?? options.colors?.eyes ?? DEFAULT_COLORS.eyes,
        cloth: options.clothColor ?? options.colors?.cloth ?? DEFAULT_COLORS.cloth,
        armor: options.armorColor ?? options.colors?.armor ?? DEFAULT_COLORS.armor,
        accent: options.accentColor ?? options.colors?.accent ?? DEFAULT_COLORS.accent,
      },
    };

    this.root = createGroup('characterRoot');
    this.root.scale.setScalar(this.options.scale);
    this.root.userData.modularHumanoid = this;

    this.bodyGroup = createGroup('bodyGroup');
    this.headGroup = createGroup('headGroup');
    this.hairGroup = createGroup('hairGroup');
    this.armorGroup = createGroup('armorGroup');
    this.equipmentGroup = createGroup('equipmentGroup');
    this.attachmentPointsGroup = createGroup('attachmentPoints');

    this.root.add(this.bodyGroup);
    this.root.add(this.armorGroup);
    this.root.add(this.equipmentGroup);
    this.root.add(this.attachmentPointsGroup);

    this.materials = {
      skin: makeMaterial('material_skin', this.options.colors.skin, { roughness: 0.58 }),
      hair: makeMaterial('material_hair', this.options.colors.hair, { roughness: 0.7 }),
      eyes: makeMaterial('material_eyes', this.options.colors.eyes, {
        roughness: 0.22,
        emissive: this.options.colors.eyes,
        emissiveIntensity: 0.08,
      }),
      cloth: makeMaterial('material_cloth', this.options.colors.cloth, { roughness: 0.82 }),
      armor: makeMaterial('material_armor', this.options.colors.armor, { roughness: 0.38, metalness: 0.45 }),
      accent: makeMaterial('material_accent', this.options.colors.accent, {
        roughness: 0.35,
        emissive: this.options.colors.accent,
        emissiveIntensity: 0.45,
      }),
    };

    this.bodyParts = new Map();
    this.joints = new Map();
    this.attachmentPoints = new Map();
    this.equipped = new Map();

    this._buildBody();
    this.setHairStyle(this.options.hairStyle);

    if (options.preset) {
      this.applyPreset(options.preset);
    }
  }

  /**
   * Build the humanoid as a nested hierarchy:
   * characterRoot
   *   bodyGroup
   *     torso/chest, pelvis/hips
   *     joint_neck -> headGroup -> head, eyes, hairGroup, head slot
   *     joint_*Shoulder -> upper arm -> joint_*Elbow -> forearm -> joint_*Wrist -> hand/fingers/hand slot
   *     joint_*Hip -> thigh -> joint_*Knee -> shin -> joint_*Ankle -> foot/boot slot
   *   armorGroup, equipmentGroup, attachmentPoints are top-level registries.
   */
  _buildBody() {
    this._createTorso();
    this._createHead();
    this._createArm('left');
    this._createArm('right');
    this._createLeg('left');
    this._createLeg('right');
    this._createCoreAttachmentPoints();

    this.attachmentPointsGroup.userData.slots = this.attachmentPoints;
  }

  _registerPart(object, aliases = []) {
    this.bodyParts.set(object.name, object);
    for (const alias of aliases) {
      this.bodyParts.set(alias, object);
    }
    return object;
  }

  _registerJoint(name, position, parent = this.bodyGroup) {
    const joint = createGroup(`joint_${name}`, position);
    parent.add(joint);
    this.joints.set(name, joint);
    this.joints.set(`joint_${name}`, joint);
    return joint;
  }

  _registerAttachmentPoint(slotName, parent, position = [0, 0, 0], rotation = [0, 0, 0]) {
    const slot = createGroup(`attachment_${slotName}`, position, rotation);
    slot.userData.slotName = slotName;
    parent.add(slot);
    this.attachmentPoints.set(slotName, slot);
    this.equipped.set(slotName, null);
    return slot;
  }

  _createTorso() {
    const chest = createMesh(
      'torsoChest',
      new THREE.BoxGeometry(0.82, 0.86, 0.44),
      this.materials.cloth,
      [0, 2.02, 0],
    );
    this.bodyGroup.add(chest);
    this._registerPart(chest, ['torso', 'chest']);

    const chestTop = createMesh(
      'upperChestShape',
      new THREE.BoxGeometry(0.92, 0.18, 0.48),
      this.materials.cloth,
      [0, 2.42, 0.01],
      [0, 0, 0],
      [1, 1, 0.96],
    );
    this.bodyGroup.add(chestTop);
    this._registerPart(chestTop);

    const pelvis = createMesh(
      'pelvisHips',
      new THREE.BoxGeometry(0.68, 0.34, 0.42),
      this.materials.cloth,
      [0, 1.38, 0],
    );
    this.bodyGroup.add(pelvis);
    this._registerPart(pelvis, ['pelvis', 'hips']);

    const waist = createMesh(
      'waistSeparation',
      new THREE.CylinderGeometry(0.37, 0.33, 0.12, 16),
      this.materials.skin,
      [0, 1.61, 0],
    );
    this.bodyGroup.add(waist);
    this._registerPart(waist);
  }

  _createHead() {
    const neckPivot = this._registerJoint('neck', [0, 2.52, 0]);

    const neck = createMesh(
      'neck',
      new THREE.CylinderGeometry(0.14, 0.16, 0.26, 16),
      this.materials.skin,
      [0, 0.12, 0],
    );
    neckPivot.add(neck);
    this._registerPart(neck);

    this.headGroup.position.set(0, 0.52, 0);
    neckPivot.add(this.headGroup);

    const head = createMesh(
      'head',
      new THREE.SphereGeometry(0.38, 24, 16),
      this.materials.skin,
      [0, 0, 0],
      [0, 0, 0],
      [0.92, 1.05, 0.86],
    );
    this.headGroup.add(head);
    this._registerPart(head);

    const leftEye = createMesh(
      'leftEye',
      new THREE.SphereGeometry(0.045, 12, 8),
      this.materials.eyes,
      [-0.13, 0.05, 0.32],
      [0, 0, 0],
      [1.15, 0.9, 0.35],
    );
    const rightEye = createMesh(
      'rightEye',
      new THREE.SphereGeometry(0.045, 12, 8),
      this.materials.eyes,
      [0.13, 0.05, 0.32],
      [0, 0, 0],
      [1.15, 0.9, 0.35],
    );
    this.headGroup.add(leftEye, rightEye);
    this._registerPart(leftEye, ['eyeLeft']);
    this._registerPart(rightEye, ['eyeRight']);

    this.headGroup.add(this.hairGroup);
    this._registerPart(this.headGroup, ['headGroup']);
    this._registerPart(this.hairGroup, ['hair']);

    this._registerAttachmentPoint('head', this.headGroup, [0, 0.05, 0]);
  }

  _createArm(side) {
    const sign = sideSign(side);
    const shoulder = this._registerJoint(`${side}Shoulder`, [sign * 0.58, 2.38, 0]);

    const upperArm = createMesh(
      `${side}UpperArm`,
      capsuleGeometry(0.105, 0.42),
      this.materials.skin,
      [0, -0.32, 0],
    );
    shoulder.add(upperArm);
    this._registerPart(upperArm, [`${side}Arm`]);

    const elbow = this._registerJoint(`${side}Elbow`, [0, -0.64, 0], shoulder);

    const forearm = createMesh(
      `${side}Forearm`,
      capsuleGeometry(0.095, 0.38),
      this.materials.skin,
      [0, -0.3, 0],
    );
    elbow.add(forearm);
    this._registerPart(forearm);

    const wrist = this._registerJoint(`${side}Wrist`, [0, -0.58, 0], elbow);

    const handGroup = createGroup(`${side}HandGroup`, [0, -0.08, 0.02]);
    wrist.add(handGroup);
    this._registerPart(handGroup);

    const palm = createMesh(
      `${side}Hand`,
      new THREE.BoxGeometry(0.22, 0.22, 0.1),
      this.materials.skin,
      [0, -0.05, 0],
    );
    handGroup.add(palm);
    this._registerPart(palm, [`${side}Palm`]);

    const fingerNames = ['Index', 'Middle', 'Ring', 'Pinky'];
    const fingerOffsets = [-0.072, -0.024, 0.024, 0.072];

    for (let i = 0; i < fingerNames.length; i += 1) {
      const finger = createMesh(
        `${side}Finger${fingerNames[i]}`,
        capsuleGeometry(0.018, 0.12, 3, 8),
        this.materials.skin,
        [fingerOffsets[i], -0.205, 0.018],
        [0, 0, 0],
        [0.8, 1, 0.8],
      );
      handGroup.add(finger);
      this._registerPart(finger, [`${side.toLowerCase()}${fingerNames[i].toLowerCase()}Finger`]);
    }

    const thumbPivot = createGroup(`${side}ThumbPivot`, [sign * 0.125, -0.08, 0.02], [0, 0, sign * 0.75]);
    const thumb = createMesh(
      `${side}Thumb`,
      capsuleGeometry(0.027, 0.13, 3, 8),
      this.materials.skin,
      [0, -0.08, 0],
    );
    thumbPivot.add(thumb);
    handGroup.add(thumbPivot);
    this._registerPart(thumbPivot);
    this._registerPart(thumb);

    this._registerAttachmentPoint(`${side}Hand`, wrist, [0, -0.2, 0.12]);
    this._registerAttachmentPoint(`${side}Shoulder`, shoulder, [sign * 0.04, -0.04, 0.02]);
  }

  _createLeg(side) {
    const sign = sideSign(side);
    const hip = this._registerJoint(`${side}Hip`, [sign * 0.23, 1.24, 0]);

    const thigh = createMesh(
      `${side}Thigh`,
      capsuleGeometry(0.13, 0.42),
      this.materials.cloth,
      [0, -0.31, 0],
    );
    hip.add(thigh);
    this._registerPart(thigh);

    const knee = this._registerJoint(`${side}Knee`, [0, -0.61, 0], hip);

    const shin = createMesh(
      `${side}ShinCalf`,
      capsuleGeometry(0.11, 0.36),
      this.materials.skin,
      [0, -0.28, 0],
    );
    knee.add(shin);
    this._registerPart(shin, [`${side}Shin`, `${side}Calf`]);

    const ankle = this._registerJoint(`${side}Ankle`, [0, -0.55, 0], knee);

    const foot = createMesh(
      `${side}Foot`,
      new THREE.BoxGeometry(0.24, 0.16, 0.42),
      this.materials.skin,
      [0, -0.08, 0.12],
    );
    ankle.add(foot);
    this._registerPart(foot);

    this._registerAttachmentPoint(`${side}Boot`, ankle, [0, -0.08, 0.12]);
  }

  _createCoreAttachmentPoints() {
    this._registerAttachmentPoint('chest', this.bodyGroup, [0, 2.04, 0.04]);
    this._registerAttachmentPoint('back', this.bodyGroup, [0, 2.08, -0.27], [0, Math.PI, 0]);
    this._registerAttachmentPoint('waist', this.bodyGroup, [0, 1.48, 0.03]);
  }

  _normalizeSlotName(slotName) {
    const key = normalizeKey(slotName);
    return SLOT_LOOKUP[key] ?? SLOT_ALIASES[key] ?? slotName;
  }

  getAttachmentPoint(slotName) {
    return this.attachmentPoints.get(this._normalizeSlotName(slotName)) ?? null;
  }

  equip(slotName, object3D) {
    const normalizedSlot = this._normalizeSlotName(slotName);
    const slot = this.getAttachmentPoint(normalizedSlot);

    if (!slot) {
      throw new Error(`Unknown equipment slot "${slotName}".`);
    }

    if (!object3D || !object3D.isObject3D) {
      throw new Error('equip(slotName, object3D) expects a THREE.Object3D.');
    }

    this.unequip(normalizedSlot);

    object3D.userData.equipmentSlot = normalizedSlot;
    slot.add(object3D);
    this.equipped.set(normalizedSlot, object3D);
    return object3D;
  }

  unequip(slotName) {
    const normalizedSlot = this._normalizeSlotName(slotName);
    const item = this.equipped.get(normalizedSlot);

    if (item?.parent) {
      item.parent.remove(item);
    }

    this.equipped.set(normalizedSlot, null);
    return item ?? null;
  }

  getEquipped(slotName) {
    return this.equipped.get(this._normalizeSlotName(slotName)) ?? null;
  }

  clearEquipment() {
    for (const slotName of this.equipped.keys()) {
      this.unequip(slotName);
    }
  }

  equipArmor(slotName, armorObject) {
    armorObject.userData.equipmentCategory = 'armor';
    return this.equip(slotName, armorObject);
  }

  unequipArmor(slotName) {
    return this.unequip(slotName);
  }

  equipItem(slotName, itemObject) {
    itemObject.userData.equipmentCategory = 'item';
    return this.equip(slotName, itemObject);
  }

  unequipItem(slotName) {
    return this.unequip(slotName);
  }

  setSkinColor(color) {
    this.materials.skin.color.set(color);
    return this;
  }

  setHairColor(color) {
    this.materials.hair.color.set(color);
    return this;
  }

  setEyeColor(color) {
    this.materials.eyes.color.set(color);
    this.materials.eyes.emissive.set(color);
    return this;
  }

  setClothColor(color) {
    this.materials.cloth.color.set(color);
    return this;
  }

  setClothingColor(color) {
    return this.setClothColor(color);
  }

  setArmorColor(color) {
    this.materials.armor.color.set(color);
    return this;
  }

  setAccentColor(color) {
    this.materials.accent.color.set(color);
    this.materials.accent.emissive.set(color);
    return this;
  }

  setBodyPartVisible(partName, visible) {
    const object = this.bodyParts.get(partName) ?? this.root.getObjectByName(partName);

    if (!object) {
      return false;
    }

    object.visible = visible;
    return true;
  }

  setHairStyle(style = 'short') {
    if (style?.isObject3D) {
      return this.replaceHair(style);
    }

    this.hairGroup.clear();

    if (style === 'none') {
      return this;
    }

    const factory = ModularHumanoid.HAIR_STYLES[style] ?? ModularHumanoid.HAIR_STYLES.short;
    this.hairGroup.add(factory(this.materials.hair));
    return this;
  }

  replaceHair(hairObject3D) {
    this.hairGroup.clear();
    hairObject3D.name ||= 'customHair';
    this.hairGroup.add(hairObject3D);
    return this;
  }

  createEquipmentByType(type, slotName = '') {
    const normalizedType = normalizeKey(type);
    const side = standardizeSide(slotName);

    switch (normalizedType) {
      case 'helmet':
      case 'simplehelmet':
        return createSimpleHelmet(this.materials.armor);

      case 'chest':
      case 'chestplate':
      case 'alloychestplate':
      case 'chestarmor':
        return createAlloyChestPlate(this.materials.armor);

      case 'shoulder':
      case 'shoulderpad':
        return createShoulderPad(this.materials.armor, side);

      case 'boot':
      case 'boots':
      case 'bootarmor':
        return createBootArmor(this.materials.armor, side);

      case 'swordarm':
        return createSwordArm(this.materials.armor);

      case 'shieldarm':
        return createShieldArm(this.materials.armor);

      case 'belt':
        return createUtilityBelt(this.materials.armor);

      default:
        throw new Error(`Unknown equipment type "${type}".`);
    }
  }

  applyPreset(preset) {
    const resolvedPreset = typeof preset === 'string' ? ModularHumanoid.PRESETS[preset] : preset;

    if (!resolvedPreset) {
      throw new Error(`Unknown character preset "${preset}".`);
    }

    if (resolvedPreset.skinColor !== undefined) this.setSkinColor(resolvedPreset.skinColor);
    if (resolvedPreset.hairColor !== undefined) this.setHairColor(resolvedPreset.hairColor);
    if (resolvedPreset.eyeColor !== undefined) this.setEyeColor(resolvedPreset.eyeColor);
    if (resolvedPreset.clothColor !== undefined) this.setClothColor(resolvedPreset.clothColor);
    if (resolvedPreset.armorColor !== undefined) this.setArmorColor(resolvedPreset.armorColor);
    if (resolvedPreset.accentColor !== undefined) this.setAccentColor(resolvedPreset.accentColor);
    if (resolvedPreset.hairStyle !== undefined) this.setHairStyle(resolvedPreset.hairStyle);

    if (resolvedPreset.visibleParts) {
      for (const [partName, visible] of Object.entries(resolvedPreset.visibleParts)) {
        this.setBodyPartVisible(partName, visible);
      }
    }

    if (resolvedPreset.equipment) {
      if (resolvedPreset.replaceEquipment !== false) {
        this.clearEquipment();
      }

      for (const [slotName, equipmentType] of Object.entries(resolvedPreset.equipment)) {
        const equipment = this.createEquipmentByType(equipmentType, slotName);
        this.equip(slotName, equipment);
      }
    }

    return this;
  }

  applyCharacterPreset(preset) {
    return this.applyPreset(preset);
  }

  dispose() {
    const disposedGeometries = new Set();
    const disposedMaterials = new Set();

    this.root.traverse((object) => {
      if (object.geometry && !disposedGeometries.has(object.geometry)) {
        object.geometry.dispose();
        disposedGeometries.add(object.geometry);
      }

      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material && !disposedMaterials.has(material)) {
          material.dispose();
          disposedMaterials.add(material);
        }
      }
    });
  }
}

ModularHumanoid.HAIR_STYLES = {
  short(material) {
    const hair = createGroup('hairStyle_short');

    const cap = createMesh(
      'shortHairCap',
      new THREE.SphereGeometry(0.43, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.68),
      material,
      [0, 0.13, 0],
      [0, 0, 0],
      [0.98, 0.82, 0.94],
    );

    const crown = createMesh(
      'shortHairCrown',
      new THREE.SphereGeometry(0.32, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.46),
      material,
      [0, 0.22, 0.02],
      [0, 0, 0],
      [1.05, 0.48, 0.95],
    );

    const fringe = createMesh(
      'shortHairFringe',
      new THREE.BoxGeometry(0.48, 0.14, 0.14),
      material,
      [0, 0.12, 0.33],
      [0.15, 0, 0],
    );

    const frontLocks = createMesh(
      'shortHairFrontLocks',
      new THREE.BoxGeometry(0.34, 0.16, 0.1),
      material,
      [-0.08, 0.04, 0.36],
      [0.45, 0.08, -0.18],
    );

    const leftSide = createMesh(
      'shortHairLeftSide',
      new THREE.BoxGeometry(0.13, 0.34, 0.2),
      material,
      [-0.32, -0.03, 0.08],
      [0, 0, -0.1],
    );

    const rightSide = createMesh(
      'shortHairRightSide',
      new THREE.BoxGeometry(0.13, 0.34, 0.2),
      material,
      [0.32, -0.03, 0.08],
      [0, 0, 0.1],
    );

    const back = createMesh(
      'shortHairBack',
      new THREE.BoxGeometry(0.48, 0.32, 0.16),
      material,
      [0, -0.03, -0.3],
      [-0.16, 0, 0],
    );

    hair.add(cap, crown, fringe, frontLocks, leftSide, rightSide, back);
    return hair;
  },

  spiky(material) {
    const hair = createGroup('hairStyle_spiky');

    const cap = createMesh(
      'spikyHairCap',
      new THREE.SphereGeometry(0.43, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.66),
      material,
      [0, 0.12, 0],
      [0, 0, 0],
      [1, 0.78, 0.95],
    );

    const crown = createMesh(
      'spikyHairCrown',
      new THREE.SphereGeometry(0.34, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.45),
      material,
      [0, 0.2, 0],
      [0, 0, 0],
      [1.08, 0.5, 0.95],
    );

    const spikeSpecs = [
      ['spikyHairFrontCenter', [0, 0.28, 0.32], [-0.55, 0, 0], [0.12, 0.34, 0.12]],
      ['spikyHairFrontLeft', [-0.16, 0.23, 0.29], [-0.5, -0.18, 0.28], [0.1, 0.3, 0.1]],
      ['spikyHairFrontRight', [0.16, 0.23, 0.29], [-0.5, 0.18, -0.28], [0.1, 0.3, 0.1]],
      ['spikyHairTopCenter', [0, 0.4, 0.02], [-0.08, 0, 0.08], [0.13, 0.42, 0.13]],
      ['spikyHairTopLeft', [-0.18, 0.34, 0], [-0.12, -0.2, 0.34], [0.11, 0.36, 0.11]],
      ['spikyHairTopRight', [0.18, 0.34, 0], [-0.12, 0.2, -0.34], [0.11, 0.36, 0.11]],
      ['spikyHairBackCenter', [0, 0.28, -0.28], [0.55, 0, Math.PI], [0.1, 0.28, 0.1]],
      ['spikyHairBackLeft', [-0.16, 0.22, -0.25], [0.45, 0.24, -2.8], [0.09, 0.24, 0.09]],
      ['spikyHairBackRight', [0.16, 0.22, -0.25], [0.45, -0.24, 2.8], [0.09, 0.24, 0.09]],
    ];

    const spikes = spikeSpecs.map(([name, position, rotation, scale]) => createMesh(
      name,
      new THREE.ConeGeometry(0.13, 0.36, 5),
      material,
      position,
      rotation,
      scale,
    ));

    const leftSide = createMesh(
      'spikyHairLeftSide',
      new THREE.BoxGeometry(0.14, 0.3, 0.2),
      material,
      [-0.32, -0.02, 0.08],
      [0, 0, -0.18],
    );

    const rightSide = createMesh(
      'spikyHairRightSide',
      new THREE.BoxGeometry(0.14, 0.3, 0.2),
      material,
      [0.32, -0.02, 0.08],
      [0, 0, 0.18],
    );

    hair.add(cap, crown, leftSide, rightSide, ...spikes);
    return hair;
  },
};

export function createSimpleHelmet(material = makeMaterial('material_simpleHelmet', 0x9aa3ad, { metalness: 0.5 })) {
  const helmet = createGroup('equipment_simpleHelmet');

  const cap = createMesh(
    'helmetCap',
    new THREE.SphereGeometry(0.43, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    material,
    [0, 0.08, 0],
    [0, 0, 0],
    [0.95, 0.8, 0.92],
  );

  const brow = createMesh(
    'helmetBrowBand',
    new THREE.BoxGeometry(0.72, 0.09, 0.1),
    material,
    [0, 0.03, 0.32],
  );

  const leftGuard = createMesh(
    'helmetLeftCheekGuard',
    new THREE.BoxGeometry(0.08, 0.2, 0.08),
    material,
    [-0.28, -0.12, 0.23],
  );

  const rightGuard = createMesh(
    'helmetRightCheekGuard',
    new THREE.BoxGeometry(0.08, 0.2, 0.08),
    material,
    [0.28, -0.12, 0.23],
  );

  helmet.add(cap, brow, leftGuard, rightGuard);
  helmet.userData.equipmentCategory = 'armor';
  return helmet;
}

export function createAlloyChestPlate(material = makeMaterial('material_alloyChestPlate', 0x9aa3ad, { metalness: 0.5 })) {
  const chestplate = createGroup('equipment_alloyChestPlate');

  const front = createMesh(
    'alloyChestPlateFront',
    new THREE.BoxGeometry(0.9, 0.74, 0.12),
    material,
    [0, 0, 0.25],
  );

  const back = createMesh(
    'alloyChestPlateBack',
    new THREE.BoxGeometry(0.84, 0.68, 0.1),
    material,
    [0, 0, -0.24],
  );

  const collar = createMesh(
    'alloyChestPlateCollar',
    new THREE.CylinderGeometry(0.32, 0.38, 0.1, 18, 1, true),
    material,
    [0, 0.42, 0],
    [Math.PI / 2, 0, 0],
  );

  chestplate.add(front, back, collar);
  chestplate.userData.equipmentCategory = 'armor';
  return chestplate;
}

export function createShoulderPad(material = makeMaterial('material_shoulderPad', 0x9aa3ad, { metalness: 0.5 }), side = 'left') {
  const sign = sideSign(side);
  const shoulderPad = createGroup(`equipment_${side}ShoulderPad`);

  const pad = createMesh(
    `${side}ShoulderPad`,
    new THREE.SphereGeometry(0.24, 16, 10),
    material,
    [sign * 0.04, -0.02, 0.02],
    [0, 0, sign * 0.22],
    [1.25, 0.55, 0.9],
  );

  const trim = createMesh(
    `${side}ShoulderPadTrim`,
    new THREE.BoxGeometry(0.32, 0.05, 0.28),
    material,
    [sign * 0.04, -0.12, 0.03],
    [0, 0, sign * 0.18],
  );

  shoulderPad.add(pad, trim);
  shoulderPad.userData.equipmentCategory = 'armor';
  return shoulderPad;
}

export function createBootArmor(material = makeMaterial('material_bootArmor', 0x9aa3ad, { metalness: 0.5 }), side = 'left') {
  const boot = createGroup(`equipment_${side}BootArmor`);

  const footCover = createMesh(
    `${side}BootFootCover`,
    new THREE.BoxGeometry(0.29, 0.18, 0.48),
    material,
    [0, 0, 0.01],
  );

  const ankleCuff = createMesh(
    `${side}BootAnkleCuff`,
    new THREE.CylinderGeometry(0.16, 0.15, 0.16, 14),
    material,
    [0, 0.12, -0.04],
  );

  boot.add(footCover, ankleCuff);
  boot.userData.equipmentCategory = 'armor';
  return boot;
}

export function createSwordArm(material = makeMaterial('material_swordArmEmitter', 0x5f6a78, { metalness: 0.45 }), options = {}) {
  const swordArm = createGroup('equipment_swordArm');
  const bladeColor = options.bladeColor ?? material.color?.getHex?.() ?? 0x8ee8ff;
  const bladeGlowMaterial = new THREE.MeshBasicMaterial({
    color: bladeColor,
    transparent: true,
    opacity: 0.48,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  bladeGlowMaterial.name = 'material_laserBeamBladeGlow';
  const bladeCoreMaterial = new THREE.MeshBasicMaterial({
    color: bladeColor,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  bladeCoreMaterial.name = 'material_laserBeamBladeCore';

  const blade = createMesh(
    'laserBeamBladeGlow',
    new THREE.BoxGeometry(0.15, 0.9, 0.055),
    bladeGlowMaterial,
    [0, -0.46, 0],
  );

  const core = createMesh(
    'laserBeamBladeCore',
    new THREE.BoxGeometry(0.045, 0.88, 0.018),
    bladeCoreMaterial,
    [0, -0.46, 0],
  );

  const tip = createMesh(
    'laserBeamBladeTip',
    new THREE.ConeGeometry(0.075, 0.16, 4),
    bladeGlowMaterial,
    [0, -0.96, 0],
    [0, Math.PI / 4, Math.PI],
  );

  const guardMaterial = material;
  const guard = createMesh(
    'laserBeamBladeEmitterGuard',
    new THREE.BoxGeometry(0.32, 0.06, 0.06),
    guardMaterial,
    [0, -0.02, 0],
  );

  const grip = createMesh(
    'laserBeamBladeEmitterSocket',
    new THREE.CylinderGeometry(0.035, 0.035, 0.24, 10),
    makeMaterial('material_swordArmSocket', 0x2c1c13, { roughness: 0.8 }),
    [0, 0.12, 0],
  );

  swordArm.add(blade, core, tip, guard, grip);
  swordArm.userData.equipmentCategory = 'armWeapon';
  return swordArm;
}

export function createShieldArm(material = makeMaterial('material_shieldArm', 0x9aa3ad, { metalness: 0.45 })) {
  const shieldArm = createGroup('equipment_shieldArm');

  const face = createMesh(
    'shieldArmFace',
    new THREE.CylinderGeometry(0.34, 0.28, 0.08, 18),
    material,
    [0, -0.04, 0.13],
    [Math.PI / 2, 0, 0],
    [0.9, 1.18, 1],
  );

  const boss = createMesh(
    'shieldArmEmitterBoss',
    new THREE.SphereGeometry(0.11, 12, 8),
    material,
    [0, -0.04, 0.19],
    [0, 0, 0],
    [1, 1, 0.45],
  );

  shieldArm.add(face, boss);
  shieldArm.userData.equipmentCategory = 'offhandArm';
  return shieldArm;
}

export function createUtilityBelt(material = makeMaterial('material_utilityBelt', 0x6a4a2d, { roughness: 0.65 })) {
  const belt = createGroup('equipment_utilityBelt');

  const band = createMesh(
    'utilityBeltBand',
    new THREE.CylinderGeometry(0.39, 0.36, 0.12, 18, 1, true),
    material,
    [0, 0, 0],
  );

  const buckle = createMesh(
    'utilityBeltBuckle',
    new THREE.BoxGeometry(0.16, 0.1, 0.06),
    material,
    [0, 0, 0.34],
  );

  belt.add(band, buckle);
  belt.userData.equipmentCategory = 'armor';
  return belt;
}

export function createModularHumanoidCharacter(options = {}) {
  return new ModularHumanoid(options);
}

export default ModularHumanoid;
