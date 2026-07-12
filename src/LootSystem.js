import * as THREE from 'three';
import {
  AFFIX_POOL,
  ITEM_TYPES,
  Item,
  LEGENDARY_ITEMS,
  RARITIES,
} from './Item.js';

const ITEM_TYPE_KEYS = Object.keys(ITEM_TYPES);
const RARITY_KEYS = Object.keys(RARITIES);
const SCRAP_PICKUP_SHAPES = Object.freeze(['bolt', 'screw', 'gear']);
const PICKUP_REST_HEIGHT = 0.35;
const PICKUP_FALL_GRAVITY = 18;
const MATERIAL_PREFIXES = {
  'Arm Weapon': ['Alloy', 'Cobalt', 'Chrome', 'Tungsten', 'Industrial'],
  'Buster Part': ['Refractor', 'Chrome', 'Cobalt', 'Ancient Circuit', 'Composite'],
  Armor: ['Kevlar', 'Alloy', 'Ceramic', 'Carbon-Fiber', 'Reactive Alloy'],
  'Sensor Gear': ['Composite', 'Titanium', 'Refractor', 'Industrial'],
  'Mobility Gear': ['Alloy', 'Hydraulic', 'Servo', 'Magnetic', 'Titanium'],
  'Utility Module': ['Ancient Circuit', 'Composite', 'Chrome', 'Industrial'],
  'Refractor Core': ['Refractor', 'Ancient Circuit', 'Memory-Metal'],
  Cartridge: ['Thermal', 'Cryo', 'Shock', 'Corrosive', 'Explosive'],
};

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomInt(min, max) {
  return Math.floor(randomBetween(min, max + 1));
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function roundStat(stat, value) {
  const integerStats = new Set([
    'maxHealth',
    'maxEnergy',
    'attackDamage',
    'armor',
    'projectileCount',
    'projectilePierce',
    'fireDamage',
    'iceDamage',
    'corrosionDamage',
  ]);
  return integerStats.has(stat) ? Math.round(value) : Number(value.toFixed(3));
}

function weightedPick(entries, weightAccessor) {
  const totalWeight = entries.reduce((total, entry) => total + weightAccessor(entry), 0);
  let roll = Math.random() * totalWeight;

  for (const entry of entries) {
    roll -= weightAccessor(entry);
    if (roll <= 0) {
      return entry;
    }
  }

  return entries[entries.length - 1];
}

function createMechanicalScrapCore(shape, material) {
  const core = new THREE.Group();
  core.name = `mechanicalScrapCore_${shape}`;
  core.userData.scrapShape = shape;

  const addPart = (geometry, name, position = [0, 0, 0], rotation = [0, 0, 0]) => {
    const part = new THREE.Mesh(geometry, material);
    part.name = name;
    part.position.set(...position);
    part.rotation.set(...rotation);
    part.castShadow = true;
    core.add(part);
    return part;
  };

  if (shape === 'bolt') {
    addPart(new THREE.CylinderGeometry(0.052, 0.052, 0.34, 8), 'scrapBoltShaft', [0, 0, 0], [0, 0, Math.PI / 2]);
    addPart(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 6), 'scrapBoltHead', [-0.2, 0, 0], [0, 0, Math.PI / 2]);
    addPart(new THREE.CylinderGeometry(0.09, 0.09, 0.065, 6), 'scrapBoltNut', [0.19, 0, 0], [0, 0, Math.PI / 2]);
    core.rotation.set(0.28, 0.12, -0.34);
    core.scale.setScalar(1.2);
  } else if (shape === 'screw') {
    addPart(new THREE.CylinderGeometry(0.047, 0.047, 0.3, 8), 'scrapScrewShaft', [-0.015, 0, 0], [0, 0, Math.PI / 2]);
    addPart(new THREE.CylinderGeometry(0.115, 0.1, 0.085, 10), 'scrapScrewHead', [-0.2, 0, 0], [0, 0, Math.PI / 2]);
    addPart(new THREE.ConeGeometry(0.062, 0.15, 8), 'scrapScrewTip', [0.205, 0, 0], [0, 0, -Math.PI / 2]);
    for (let index = 0; index < 4; index += 1) {
      addPart(
        new THREE.TorusGeometry(0.064, 0.01, 5, 10),
        'scrapScrewThread',
        [-0.055 + index * 0.065, 0, 0],
        [0, Math.PI / 2, 0],
      );
    }
    core.rotation.set(-0.2, 0.18, 0.4);
    core.scale.setScalar(1.25);
  } else {
    addPart(new THREE.CylinderGeometry(0.105, 0.105, 0.09, 14), 'scrapGearHub', [0, 0, 0], [Math.PI / 2, 0, 0]);
    addPart(new THREE.TorusGeometry(0.17, 0.045, 7, 18), 'scrapGearRing', [0, 0, 0], [0, 0, 0]);
    for (let index = 0; index < 10; index += 1) {
      const angle = index * Math.PI * 2 / 10;
      addPart(
        new THREE.BoxGeometry(0.075, 0.095, 0.08),
        'scrapGearTooth',
        [Math.cos(angle) * 0.225, Math.sin(angle) * 0.225, 0],
        [0, 0, angle],
      );
    }
    core.rotation.set(0.16, -0.22, 0.12);
  }

  return core;
}

function createPickupMesh(item) {
  const group = new THREE.Group();
  group.name = `lootPickup_${item.id}`;
  group.userData.item = item;
  group.userData.pickupKind = item.pickupKind ?? 'item';

  const rarity = RARITIES[item.rarity];
  const glow = item.glowColor ?? rarity.glow;
  const isMaterial = item.pickupKind === 'material';
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: isMaterial ? 0xa7afb2 : glow,
    emissive: glow,
    emissiveIntensity: isMaterial ? 0.14 : 0.55,
    roughness: isMaterial ? 0.42 : 0.35,
    metalness: isMaterial ? 0.72 : 0.08,
  });

  const haloMaterial = new THREE.MeshStandardMaterial({
    color: glow,
    emissive: glow,
    emissiveIntensity: 0.85,
    roughness: 0.5,
    transparent: true,
    opacity: isMaterial ? 0.32 : 0.5,
    side: THREE.DoubleSide,
  });

  const core = isMaterial
    ? createMechanicalScrapCore(item.scrapShape ?? 'bolt', coreMaterial)
    : new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), coreMaterial);
  if (!isMaterial) {
    core.name = 'lootCore';
    core.castShadow = true;
  }

  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.018, 8, 24), haloMaterial);
  halo.name = 'lootRarityHalo';
  halo.rotation.x = Math.PI / 2;

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.32, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 }),
  );
  shadow.name = 'lootSoftShadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.18;

  group.add(core, halo, shadow);
  return group;
}

function disposePickupObject(object) {
  const geometries = new Set();
  const materials = new Set();
  object?.traverse?.((child) => {
    if (child.geometry) geometries.add(child.geometry);
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of childMaterials) {
      if (material) materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) material.dispose?.();
}

export class LootSystem {
  constructor(scene, { getFloorElevation = null } = {}) {
    this.scene = scene;
    this.getFloorElevation = getFloorElevation;
    this.pickups = [];
    this.nextMaterialPickupId = 1;
  }

  rollRarity(enemy = null) {
    const eliteBonus = enemy?.isElite ? 2.8 : 1;
    const timeBonus = enemy?.level ? Math.min(enemy.level * 0.04, 1.25) : 0;

    return weightedPick(RARITY_KEYS, (rarityKey) => {
      const base = RARITIES[rarityKey].weight;
      const boost = rarityKey === 'scrap' ? 1 : eliteBonus + timeBonus;
      return base * boost;
    });
  }

  generateItem(level = 1, options = {}) {
    const type = options.type ?? pickRandom(ITEM_TYPE_KEYS);
    const typeData = ITEM_TYPES[type] ?? ITEM_TYPES.busterArm;
    const rarity = options.rarity ?? this.rollRarity(options.enemy);
    const rarityData = RARITIES[rarity];
    const scaledLevel = Math.max(1, level);

    const legendaryTemplate = this._pickLegendaryTemplate(type, rarity);
    const baseStats = options.baseStats ? { ...options.baseStats } : {};

    if (!options.baseStats) {
      for (const [stat, range] of Object.entries(typeData.baseStats)) {
        const levelScale = 1 + scaledLevel * 0.055;
        baseStats[stat] = roundStat(stat, randomBetween(range[0], range[1]) * rarityData.statMultiplier * levelScale);
      }
    }

    const affixes = [
      ...(legendaryTemplate?.forcedAffixes?.map((affix) => ({ ...affix })) ?? []),
    ];

    const [minAffixes, maxAffixes] = rarityData.affixRange;
    const affixCount = options.affixCount ?? randomInt(minAffixes, maxAffixes);
    const availableAffixes = AFFIX_POOL.filter((affix) => affix.slots.includes(typeData.slot));

    while (affixes.length < affixCount && availableAffixes.length > 0) {
      const affix = pickRandom(availableAffixes);

      if (affixes.some((existing) => existing.id === affix.id)) {
        continue;
      }

      const levelScale = 1 + scaledLevel * 0.035;
      const value = roundStat(
        affix.stat,
        randomBetween(affix.range[0], affix.range[1]) * rarityData.statMultiplier * levelScale,
      );

      affixes.push({
        id: affix.id,
        label: affix.label,
        stat: affix.stat,
        value,
        format: affix.format,
        percent: affix.percent,
        integer: affix.integer,
        suffix: affix.suffix,
      });
    }

    const name = options.name ?? this._generateName(typeData, rarity, affixes, legendaryTemplate);
    const value = Math.max(1, Math.round((scaledLevel * 10 + Object.keys(baseStats).length * 12 + affixes.length * 22) * rarityData.valueMultiplier));

    return new Item({
      name,
      type,
      slot: typeData.slot,
      rarity,
      level: scaledLevel,
      category: typeData.category,
      tags: typeData.tags,
      behavior: typeData.behavior,
      uniqueEffect: legendaryTemplate?.uniqueEffect,
      baseStats,
      affixes,
      value,
      weaponKind: typeData.weaponKind,
    });
  }

  rollDrop(enemy) {
    const baseChance = enemy?.isElite ? 0.8 : 0.22;
    const levelChance = Math.min((enemy?.level ?? 1) * 0.012, 0.18);

    if (Math.random() > baseChance + levelChance) {
      return null;
    }

    const item = this.generateItem(enemy?.level ?? 1, { enemy });
    const position = (enemy.deathDropPosition ?? enemy.root.position).clone();
    position.y += 0.35;
    position.x += randomBetween(-0.45, 0.45);
    position.z += randomBetween(-0.45, 0.45);

    return this.createPickup(item, position);
  }

  createPickup(item, position) {
    const object = createPickupMesh(item);
    object.position.copy(position);
    const floorY = this.getFloorElevation?.(position);
    const restY = Number.isFinite(floorY)
      ? floorY + PICKUP_REST_HEIGHT
      : position.y;
    object.position.y = Math.max(object.position.y, restY);
    object.userData.spawnY = restY;
    object.userData.fallVelocity = 0;
    object.userData.falling = object.position.y > restY + 0.001;
    object.userData.life = 0;

    this.scene.add(object);
    this.pickups.push({
      item,
      object,
      kind: item.pickupKind ?? 'item',
      collected: false,
    });
    return object;
  }

  createMaterialPickup(material, quantity, position, source = null) {
    const amount = Math.max(1, Math.trunc(quantity) || 1);
    const pickupIndex = this.nextMaterialPickupId++;
    const item = {
      id: `reaverbot-material-${material.id}-${pickupIndex}`,
      pickupKind: 'material',
      scrapShape: SCRAP_PICKUP_SHAPES[(pickupIndex - 1) % SCRAP_PICKUP_SHAPES.length],
      material,
      materialId: material.id,
      quantity: amount,
      source: source ? { ...source } : null,
      name: `${material.name}${amount > 1 ? ` +${amount}` : ''}`,
      category: 'Crafting Material',
      rarity: 'scrap',
      color: material.color ?? RARITIES.scrap.color,
      glowColor: new THREE.Color(material.color ?? RARITIES.scrap.color).getHex(),
    };
    return this.createPickup(item, position);
  }

  update(dt, player, inventory) {
    const collected = [];
    const playerPosition = player.root.position;
    const pickupRadius = player.stats.pickupRadius;

    for (const pickup of this.pickups) {
      if (pickup.collected) {
        continue;
      }

      pickup.object.userData.life += dt;
      pickup.object.rotation.y += dt * 1.8;
      pickup.object.children[1].rotation.z += dt * 2.4;
      if (pickup.object.userData.falling) {
        pickup.object.userData.fallVelocity -= PICKUP_FALL_GRAVITY * dt;
        pickup.object.position.y += pickup.object.userData.fallVelocity * dt;
        if (pickup.object.position.y <= pickup.object.userData.spawnY) {
          pickup.object.position.y = pickup.object.userData.spawnY;
          pickup.object.userData.fallVelocity = 0;
          pickup.object.userData.falling = false;
          pickup.object.userData.life = 0;
        }
      } else {
        pickup.object.position.y = pickup.object.userData.spawnY
          + Math.sin(pickup.object.userData.life * 4) * 0.08;
      }

      const distance = pickup.object.position.distanceTo(playerPosition);
      if (distance <= pickupRadius) {
        const accepted = pickup.kind === 'material'
          ? Boolean(inventory.addMaterial(
            pickup.item.material,
            pickup.item.quantity,
            pickup.item.source,
          ))
          : inventory.addItem(pickup.item);
        if (accepted) {
          pickup.collected = true;
          pickup.object.visible = false;
          this.scene.remove(pickup.object);
          disposePickupObject(pickup.object);
          collected.push(pickup.item);
        }
      }
    }

    if (collected.length > 0) {
      this.pickups = this.pickups.filter((pickup) => !pickup.collected);
    }

    return collected;
  }

  clear() {
    for (const pickup of this.pickups) {
      this.scene.remove(pickup.object);
      disposePickupObject(pickup.object);
    }

    this.pickups.length = 0;
    this.nextMaterialPickupId = 1;
  }

  _pickLegendaryTemplate(type, rarity) {
    if (rarity !== 'legendary') {
      return null;
    }

    const matching = LEGENDARY_ITEMS.filter((item) => item.type === type);
    return matching.length > 0 && Math.random() < 0.7 ? pickRandom(matching) : null;
  }

  _generateName(typeData, rarity, affixes, legendaryTemplate) {
    if (legendaryTemplate) {
      return legendaryTemplate.name;
    }

    const rarityData = RARITIES[rarity];
    const strongestAffix = affixes[0] ?? null;
    const prefix = pickRandom(rarityData.namePrefixes ?? [rarityData.label]);
    const materialOptions = MATERIAL_PREFIXES[typeData.category] ?? ['Composite', 'Alloy', 'Refractor'];
    const material = pickRandom(materialOptions);
    const suffix = strongestAffix?.suffix;

    if (suffix && rarity !== 'scrap' && rarity !== 'standard') {
      return `${prefix} ${typeData.label} ${suffix}`;
    }

    if (rarity === 'scrap') {
      return `${prefix} ${typeData.label}`;
    }

    if (rarity === 'standard') {
      return `${material} ${typeData.label}`;
    }

    return `${prefix} ${material} ${typeData.label}`;
  }
}
