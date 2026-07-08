import * as THREE from 'three';

const tempVector = new THREE.Vector3();

function colorToHex(color) {
  return `#${new THREE.Color(color).getHexString()}`;
}

function randomChoice(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const PYLON_VARIANTS = [
  {
    label: 'Thermal Pylon',
    color: 0xff7842,
    bonuses: { fireDamage: 7 },
  },
  {
    label: 'Cryo Pylon',
    color: 0x8bddff,
    bonuses: { iceDamage: 6 },
  },
  {
    label: 'Shock Pylon',
    color: 0xa6f7ff,
    bonuses: { chainLightningChance: 0.22 },
  },
  {
    label: 'Corrosive Pylon',
    color: 0xa6e86f,
    bonuses: { corrosionDamage: 6 },
  },
];

export const MAP_EVENT_TYPES = {
  refractorSurge: {
    label: 'Refractor Surge',
    color: 0x65d5ff,
    duration: 14,
    cooldown: 34,
    activationRadius: 1.85,
    bonuses: {
      maxEnergy: 4,
      energyRecharge: 0.38,
    },
  },
  overclockTerminal: {
    label: 'Overclock Terminal',
    color: 0xff72df,
    duration: 12,
    cooldown: 38,
    activationRadius: 1.7,
    bonuses: {
      attackSpeed: 0.46,
      cooldownReduction: 0.12,
      armor: -4,
    },
  },
  repairStation: {
    label: 'Repair Station',
    color: 0x6fffa7,
    duration: 0,
    cooldown: 42,
    activationRadius: 1.65,
  },
  coolingVent: {
    label: 'Cooling Vent',
    color: 0xbff5ff,
    duration: 16,
    cooldown: 36,
    activationRadius: 1.9,
    bonuses: {
      energyRecharge: 0.62,
      cooldownReduction: 0.24,
    },
  },
  refractorPylon: {
    label: 'Refractor Pylon',
    color: 0xffcf66,
    duration: 13,
    cooldown: 36,
    activationRadius: 1.8,
  },
  salvageCache: {
    label: 'Salvage Cache',
    color: 0xd4a84e,
    duration: 0,
    cooldown: 46,
    activationRadius: 1.55,
  },
};

const EVENT_LAYOUT = [
  { type: 'refractorSurge', position: [-8, 0, -9] },
  { type: 'overclockTerminal', position: [9, 0, -7] },
  { type: 'repairStation', position: [-11, 0, 8] },
  { type: 'coolingVent', position: [11, 0, 9] },
  { type: 'refractorPylon', position: [0, 0, -14] },
  { type: 'salvageCache', position: [0, 0, 13] },
];

function createEventDevice(config, variant = null) {
  const color = variant?.color ?? config.color;
  const group = new THREE.Group();
  group.name = `mapEvent_${config.label.replace(/\s+/g, '')}`;

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d3440,
    roughness: 0.55,
    metalness: 0.55,
  });
  const glowMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.85,
    roughness: 0.28,
    metalness: 0.1,
  });
  const fieldMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.86, 0.18, 28), baseMaterial);
  pad.name = 'mapEventPad';
  pad.position.y = 0.09;
  pad.castShadow = true;
  pad.receiveShadow = true;

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.92, 18), baseMaterial);
  post.name = 'mapEventPost';
  post.position.y = 0.62;
  post.castShadow = true;
  post.receiveShadow = true;

  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), glowMaterial);
  core.name = 'mapEventCore';
  core.position.y = 1.24;
  core.castShadow = true;

  const field = new THREE.Mesh(new THREE.RingGeometry(config.activationRadius * 0.86, config.activationRadius, 42), fieldMaterial);
  field.name = 'mapEventActivationField';
  field.rotation.x = -Math.PI / 2;
  field.position.y = 0.035;

  const antenna = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.44, 0.1), glowMaterial);
  antenna.name = 'mapEventAntenna';
  antenna.position.y = 1.72;

  group.add(pad, post, core, field, antenna);
  group.userData.core = core;
  group.userData.field = field;
  group.userData.glowMaterial = glowMaterial;
  group.userData.fieldMaterial = fieldMaterial;
  group.userData.baseMaterial = baseMaterial;
  return group;
}

export class MapEventSystem {
  constructor(game) {
    this.game = game;
    this.events = [];
    this.nearestEvent = null;

    this._spawnInitialEvents();
  }

  update(dt) {
    const safeArea = Boolean(this.game.isPlayerInSafeArea?.());
    let nearest = null;
    let nearestDistanceSq = Infinity;

    for (const event of this.events) {
      this._updateEventVisual(event, dt);

      if (event.cooldownRemaining > 0) {
        event.cooldownRemaining = Math.max(0, event.cooldownRemaining - dt);
        continue;
      }

      if (safeArea) {
        continue;
      }

      const distanceSq = event.object.position.distanceToSquared(this.game.player.root.position);
      const radius = event.config.activationRadius;

      if (distanceSq <= radius * radius && distanceSq < nearestDistanceSq) {
        nearest = event;
        nearestDistanceSq = distanceSq;
      }
    }

    this.nearestEvent = nearest;
  }

  getNearestInteractable() {
    return this.nearestEvent;
  }

  activateNearest() {
    const event = this.getNearestInteractable();

    if (!event || event.cooldownRemaining > 0) {
      return false;
    }

    event.cooldownRemaining = event.config.cooldown;
    event.activationPulse = 0.55;
    this._applyEventEffect(event);
    this.game.addParticleBurst(event.object.position, event.variant?.color ?? event.config.color, 20, 0.22);
    return true;
  }

  _spawnInitialEvents() {
    for (const layout of EVENT_LAYOUT) {
      const config = MAP_EVENT_TYPES[layout.type];
      const variant = layout.type === 'refractorPylon' ? randomChoice(PYLON_VARIANTS) : null;
      const object = createEventDevice(config, variant);
      object.position.set(...layout.position);
      object.userData.mapEvent = true;

      const event = {
        type: layout.type,
        config,
        variant,
        object,
        cooldownRemaining: 0,
        activationPulse: 0,
        time: Math.random() * 10,
      };

      this.events.push(event);
      this.game.scene.add(object);
    }
  }

  _applyEventEffect(event) {
    const config = event.config;
    const label = event.variant?.label ?? config.label;
    const color = event.variant?.color ?? config.color;
    const colorHex = colorToHex(color);

    if (config.bonuses) {
      this.game.player.addTemporaryStatBonus(`mapEvent:${event.type}`, label, config.bonuses, config.duration, colorHex);
    }

    if (event.type === 'refractorSurge') {
      this.game.combat.refillAllEnergy();
      this.game.inventory.gold += 18 + Math.floor(this.game.player.level * 4);
      if (Math.random() < 0.48) {
        this._spawnGuardian(event, 'fast', false);
      }
    } else if (event.type === 'overclockTerminal') {
      this.game.combat.reduceReloadTimers(0.35);
      this._spawnDefenseWave(event, 3);
    } else if (event.type === 'repairStation') {
      this.game.player.heal(this.game.player.stats.maxHealth * 0.48);
      if (Math.random() < 0.35) {
        this._spawnDefenseWave(event, 2);
      }
    } else if (event.type === 'coolingVent') {
      this.game.combat.refillAllEnergy(3);
      this.game.combat.reduceReloadTimers(0.25);
      this._addCoolingField(event, color);
    } else if (event.type === 'refractorPylon') {
      this.game.player.addTemporaryStatBonus(`mapEvent:${event.type}`, label, event.variant.bonuses, config.duration, colorHex);
      if (Math.random() < 0.34) {
        this._spawnGuardian(event, 'ranged', true);
      }
    } else if (event.type === 'salvageCache') {
      this._dropSalvage(event);
      if (Math.random() < 0.44) {
        this._spawnGuardian(event, 'tank', true);
      }
    }

    this.game.ui?.showToast?.(`${label} online`, colorHex);
  }

  _addCoolingField(event, color) {
    const field = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 36),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );

    field.name = 'coolingVentField';
    field.position.copy(event.object.position);
    field.position.y = 0.04;
    field.rotation.x = -Math.PI / 2;
    this.game.scene.add(field);
    this.game.timedEffects.push({ object: field, life: 5.5, maxLife: 5.5, grow: true });
  }

  _dropSalvage(event) {
    const item = this.game.lootSystem.generateItem(this.game.player.level + 1);
    tempVector.copy(event.object.position);
    tempVector.y = 0.35;
    tempVector.x += (Math.random() - 0.5) * 0.8;
    tempVector.z += (Math.random() - 0.5) * 0.8;
    this.game.lootSystem.createPickup(item, tempVector);
  }

  _spawnDefenseWave(event, count) {
    for (let i = 0; i < count; i += 1) {
      this._spawnGuardian(event, i === 0 ? 'ranged' : 'basic', false);
    }
  }

  _spawnGuardian(event, typeKey, elite = false) {
    const enemy = this.game.spawnEnemy(typeKey, elite);
    const angle = Math.random() * Math.PI * 2;
    const radius = 2.8 + Math.random() * 1.5;
    enemy.root.position.copy(event.object.position);
    enemy.root.position.x += Math.cos(angle) * radius;
    enemy.root.position.z += Math.sin(angle) * radius;
    enemy.root.position.y = 0;
    return enemy;
  }

  _updateEventVisual(event, dt) {
    event.time += dt;
    event.activationPulse = Math.max(0, event.activationPulse - dt);

    const core = event.object.userData.core;
    const field = event.object.userData.field;
    const glowMaterial = event.object.userData.glowMaterial;
    const fieldMaterial = event.object.userData.fieldMaterial;
    const ready = event.cooldownRemaining <= 0;
    const selected = event === this.nearestEvent;
    const pulse = selected ? 0.18 : event.activationPulse * 0.34;

    if (core) {
      core.rotation.y += dt * (ready ? 1.9 : 0.55);
      core.position.y = 1.24 + Math.sin(event.time * 3) * 0.06;
      core.scale.setScalar(ready ? 1 + pulse : 0.72);
    }

    if (field) {
      field.rotation.z += dt * (ready ? 0.8 : 0.22);
      field.scale.setScalar(ready ? 1 + pulse : 0.82);
    }

    if (glowMaterial) {
      glowMaterial.emissiveIntensity = ready ? 0.78 + pulse * 2.4 : 0.16;
    }

    if (fieldMaterial) {
      fieldMaterial.opacity = ready ? 0.16 + pulse * 0.45 : 0.04;
    }
  }
}

export default MapEventSystem;
