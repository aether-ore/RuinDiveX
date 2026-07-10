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

function createPickupMesh(item) {
  const group = new THREE.Group();
  group.name = `lootPickup_${item.id}`;
  group.userData.item = item;

  const rarity = RARITIES[item.rarity];
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: rarity.glow,
    emissive: rarity.glow,
    emissiveIntensity: 0.55,
    roughness: 0.35,
    metalness: 0.08,
  });

  const haloMaterial = new THREE.MeshStandardMaterial({
    color: rarity.glow,
    emissive: rarity.glow,
    emissiveIntensity: 0.85,
    roughness: 0.5,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });

  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), coreMaterial);
  core.name = 'lootCore';
  core.castShadow = true;

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

export class LootSystem {
  constructor(scene) {
    this.scene = scene;
    this.pickups = [];
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
    const position = enemy.root.position.clone();
    position.y += 0.35;
    position.x += randomBetween(-0.45, 0.45);
    position.z += randomBetween(-0.45, 0.45);

    return this.createPickup(item, position);
  }

  createPickup(item, position) {
    const object = createPickupMesh(item);
    object.position.copy(position);
    object.userData.spawnY = position.y;
    object.userData.life = 0;

    this.scene.add(object);
    this.pickups.push({ item, object, collected: false });
    return object;
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
      pickup.object.position.y = pickup.object.userData.spawnY + Math.sin(pickup.object.userData.life * 4) * 0.08;

      const distance = pickup.object.position.distanceTo(playerPosition);
      if (distance <= pickupRadius) {
        if (inventory.addItem(pickup.item)) {
          pickup.collected = true;
          pickup.object.visible = false;
          this.scene.remove(pickup.object);
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
    }

    this.pickups.length = 0;
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
