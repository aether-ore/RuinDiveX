import * as THREE from 'three';
import {
  createAlloyChestPlate,
  createBootArmor,
  createShieldArm,
  createShoulderPad,
  createSimpleHelmet,
  createSwordArm,
} from './ModularHumanoid.js';

const ARM_CANNON_TYPES = new Set([
  'busterArm',
  'machineGunArm',
  'cannonArm',
  'mineArm',
  'grenadeArm',
  'missileArm',
  'railBusterArm',
  'scatterBusterArm',
  'homingSeekerArm',
  'laserArm',
  'flameArm',
  'iceSprayerArm',
  'shockCoilArm',
]);

const UTILITY_ARM_TYPES = new Set(['liftArm', 'drillArm']);

const BUSTER_PART_TYPES = new Set([
  'powerRaiser',
  'rangeBooster',
  'rapidFireUnit',
  'energyBattery',
  'sniperScope',
  'heatSinkCore',
]);

const CHEST_ARMOR_TYPES = new Set(['kevlarJacket', 'alloyChestPlate', 'refractorArmor']);
const HELMET_TYPES = new Set(['utilityHelmet', 'lockOnVisor', 'refractorScanner']);
const BOOT_TYPES = new Set(['servoBoots', 'jetSkates', 'magneticSoles']);
const UTILITY_TYPES = new Set(['reactorChip', 'capacitorModule', 'targetingChip', 'energyCartridge', 'adapterPlug']);
const DEFAULT_BEAM_BLADE_COLOR = 0xa8ff8a;

function getItemElementColor(item, fallbackColor) {
  const stats = item?.getStatTotals?.() ?? {};

  if ((stats.fireDamage ?? 0) > 0) return 0xff8a42;
  if ((stats.iceDamage ?? 0) > 0) return 0x8bddff;
  if ((stats.corrosionDamage ?? 0) > 0) return 0xa6e86f;
  if ((stats.chainLightningChance ?? 0) > 0) return 0xa6f7ff;

  return fallbackColor;
}

function getSwordBladeColor(item) {
  if (!item || item.rarity === 'scrap' || item.rarity === 'standard') {
    return DEFAULT_BEAM_BLADE_COLOR;
  }

  return getItemElementColor(item, item.glowColor ?? DEFAULT_BEAM_BLADE_COLOR);
}

export const EQUIPMENT_SLOTS = [
  'weapon',
  'offhand',
  'head',
  'chest',
  'hands',
  'feet',
  'module1',
  'module2',
  'core',
  'back',
];

const VISUAL_ATTACHMENTS = {
  weapon: ['rightHand'],
  offhand: ['leftHand'],
  head: ['head'],
  chest: ['chest', 'leftShoulder', 'rightShoulder'],
  hands: ['leftHand', 'rightHand'],
  feet: ['leftBoot', 'rightBoot'],
  module1: ['leftHand'],
  module2: ['rightHand'],
  core: ['chest'],
  back: ['back'],
};

function makeEquipmentMaterial(item, fallbackColor = 0xaab4bf) {
  const isRelic = item?.rarity === 'legendary' || item?.rarity === 'ancient';

  return new THREE.MeshStandardMaterial({
    color: item?.glowColor ?? fallbackColor,
    emissive: isRelic ? item.glowColor : 0x000000,
    emissiveIntensity: isRelic ? 0.18 : 0,
    roughness: 0.36,
    metalness: 0.45,
  });
}

function createArmCannonVisual(material, type) {
  const cannon = new THREE.Group();
  cannon.name = `equipment_${type}`;

  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.42, 16), material);
  housing.name = `${type}Housing`;
  housing.rotation.x = Math.PI / 2;
  housing.position.z = 0.18;

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.34, 14), material);
  barrel.name = `${type}Barrel`;
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.5;

  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), material);
  core.name = `${type}Core`;
  core.position.set(0, 0.03, 0.08);

  cannon.add(housing, barrel, core);
  return cannon;
}

function createDrillArmVisual(material) {
  const drill = new THREE.Group();
  drill.name = 'equipment_drillArm';

  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.22, 16), material);
  motor.name = 'drillArmMotor';
  motor.rotation.x = Math.PI / 2;
  motor.position.z = 0.16;

  const bit = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.36, 18), material);
  bit.name = 'drillArmBit';
  bit.rotation.x = Math.PI / 2;
  bit.position.z = 0.44;

  drill.add(motor, bit);
  return drill;
}

function createBusterPartVisual(material, side) {
  const module = new THREE.Group();
  module.name = `equipment_${side}BusterPart`;

  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.12), material);
  clamp.name = `${side}BusterPartClamp`;
  clamp.position.y = -0.12;

  const chip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.16), material);
  chip.name = `${side}BusterPartChip`;
  chip.position.set(0, -0.21, 0.08);

  module.add(clamp, chip);
  return module;
}

function createUtilityModuleVisual(material, side) {
  const module = new THREE.Group();
  module.name = `equipment_${side}UtilityModule`;

  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.055, 0.14), material);
  plate.name = `${side}UtilityModulePlate`;
  plate.position.set(side === 'left' ? -0.06 : 0.06, -0.17, 0.06);

  const node = new THREE.Mesh(new THREE.OctahedronGeometry(0.04, 0), material);
  node.name = `${side}UtilityModuleNode`;
  node.position.set(side === 'left' ? -0.06 : 0.06, -0.17, 0.15);

  module.add(plate, node);
  return module;
}

function createCoreVisual(material) {
  const core = new THREE.Group();
  core.name = 'equipment_refractorCore';

  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.08, 16), material);
  socket.name = 'refractorCoreSocket';
  socket.rotation.x = Math.PI / 2;
  socket.position.set(0, 0.02, 0.31);

  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), material);
  crystal.name = 'refractorCoreCrystal';
  crystal.position.set(0, 0.02, 0.37);

  core.add(socket, crystal);
  return core;
}

function createBackBanner(material) {
  const back = new THREE.Group();
  back.name = 'equipment_backBanner';

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 8), material);
  pole.name = 'backBannerPole';
  pole.position.y = 0.28;

  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.48, 0.035),
    new THREE.MeshStandardMaterial({ color: 0x7e2f33, roughness: 0.8 }),
  );
  banner.name = 'backBannerCloth';
  banner.position.set(0, 0.34, -0.06);

  back.add(pole, banner);
  return back;
}

export class EquipmentManager {
  constructor(player, humanoid) {
    this.player = player;
    this.humanoid = humanoid;
    this.equipped = new Map(EQUIPMENT_SLOTS.map((slot) => [slot, null]));
    this.visuals = new Map(EQUIPMENT_SLOTS.map((slot) => [slot, []]));
  }

  equip(item, preferredSlot = null) {
    const slot = this.resolveSlot(item, preferredSlot);
    const previous = this.equipped.get(slot) ?? null;

    this._clearVisual(slot);
    this.equipped.set(slot, item);
    this._attachVisual(slot, item);
    this.player.recalculateStats();
    this.player.updateWeaponVisualState?.();

    return previous;
  }

  unequip(slot) {
    const resolvedSlot = this.resolveSlot({ slot }, slot);
    const previous = this.equipped.get(resolvedSlot) ?? null;

    this._clearVisual(resolvedSlot);
    this.equipped.set(resolvedSlot, null);
    this.player.recalculateStats();
    this.player.updateWeaponVisualState?.();

    return previous;
  }

  get(slot) {
    return this.equipped.get(slot) ?? null;
  }

  getAll() {
    return Object.fromEntries(this.equipped.entries());
  }

  getStatBonuses() {
    const bonuses = {};

    for (const item of this.equipped.values()) {
      if (!item) {
        continue;
      }

      for (const [stat, value] of Object.entries(item.getStatTotals())) {
        bonuses[stat] = (bonuses[stat] ?? 0) + value;
      }
    }

    return bonuses;
  }

  getSummary() {
    const weapon = this.get('weapon');
    return weapon ? weapon.name : 'No Arm Weapon';
  }

  clear() {
    for (const slot of EQUIPMENT_SLOTS) {
      this.unequip(slot);
    }
  }

  resolveSlot(item, preferredSlot = null) {
    if (preferredSlot && this.equipped.has(preferredSlot)) {
      return preferredSlot;
    }

    if (item.slot === 'module') {
      return this.get('module1') ? 'module2' : 'module1';
    }

    if (item.slot === 'feet') {
      return 'feet';
    }

    if (this.equipped.has(item.slot)) {
      return item.slot;
    }

    return 'weapon';
  }

  _attachVisual(slot, item) {
    const visuals = this._createVisualObjects(slot, item);
    const attachmentNames = slot === 'weapon' && item?.type === 'busterArm'
      ? ['leftHand']
      : VISUAL_ATTACHMENTS[slot] ?? [];
    const attached = [];

    for (let i = 0; i < visuals.length; i += 1) {
      const attachmentName = attachmentNames[Math.min(i, attachmentNames.length - 1)];
      const attachment = this.humanoid.getAttachmentPoint(attachmentName);

      if (!attachment) {
        continue;
      }

      const visual = visuals[i];
      attachment.add(visual);
      visual.visible = !this.player.usesExternalCharacterModel?.();
      attached.push(visual);
    }

    this.visuals.set(slot, attached);
  }

  _clearVisual(slot) {
    const visuals = this.visuals.get(slot) ?? [];

    for (const visual of visuals) {
      if (visual.parent) {
        visual.parent.remove(visual);
      }
    }

    this.visuals.set(slot, []);
  }

  _createVisualObjects(slot, item) {
    const material = makeEquipmentMaterial(item);

    if (item.type === 'swordArm') {
      const arm = createSwordArm(material, { bladeColor: getSwordBladeColor(item) });
      arm.name = `equipment_${item.type}`;
      arm.rotation.set(0, 0, -0.15);
      arm.position.set(0.03, -0.03, 0.08);
      return [arm];
    }

    if (item.type === 'drillArm') {
      const drill = createDrillArmVisual(material);
      drill.rotation.set(Math.PI / 2, 0, 0);
      drill.position.set(0.02, -0.08, 0.12);
      return [drill];
    }

    if (ARM_CANNON_TYPES.has(item.type)) {
      const cannon = createArmCannonVisual(material, item.type);
      cannon.rotation.set(Math.PI / 2, 0, 0);
      cannon.position.set(0.02, -0.08, 0.12);
      return [cannon];
    }

    if (UTILITY_ARM_TYPES.has(item.type)) {
      return [];
    }

    if (item.type === 'shieldArm') {
      const shield = createShieldArm(material);
      shield.name = 'equipment_shieldArm';
      shield.position.set(0, -0.08, 0.02);
      return [shield];
    }

    if (HELMET_TYPES.has(item.type)) {
      return [createSimpleHelmet(material)];
    }

    if (CHEST_ARMOR_TYPES.has(item.type)) {
      const chest = createAlloyChestPlate(material);
      const leftShoulder = createShoulderPad(material, 'left');
      const rightShoulder = createShoulderPad(material, 'right');
      return [chest, leftShoulder, rightShoulder];
    }

    if (BUSTER_PART_TYPES.has(item.type)) {
      return [createBusterPartVisual(material, 'left'), createBusterPartVisual(material, 'right')];
    }

    if (BOOT_TYPES.has(item.type)) {
      return [createBootArmor(material, 'left'), createBootArmor(material, 'right')];
    }

    if (slot === 'core' || item.type === 'refractorCore') {
      return [createCoreVisual(material)];
    }

    if (UTILITY_TYPES.has(item.type)) {
      return [createUtilityModuleVisual(material, slot === 'module1' ? 'left' : 'right')];
    }

    return slot === 'back' ? [createBackBanner(material)] : [];
  }
}
