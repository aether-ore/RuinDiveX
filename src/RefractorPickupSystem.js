import * as THREE from 'three';

const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();

const REFRACTOR_TIERS = [
  {
    id: 'tiny',
    label: 'Tiny Refractor',
    value: [3, 7],
    weight: 56,
    color: 0x65d5ff,
    scale: 0.18,
    glow: 0.65,
  },
  {
    id: 'small',
    label: 'Small Refractor',
    value: [8, 16],
    weight: 30,
    color: 0x52ff9b,
    scale: 0.24,
    glow: 0.82,
  },
  {
    id: 'medium',
    label: 'Medium Refractor',
    value: [18, 34],
    weight: 11,
    color: 0xffd66b,
    scale: 0.31,
    glow: 1.0,
  },
  {
    id: 'largeShard',
    label: 'Large Refractor Shard',
    value: [42, 78],
    weight: 3,
    color: 0x9f7dff,
    scale: 0.42,
    glow: 1.25,
  },
];

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomInt(min, max) {
  return Math.floor(randomBetween(min, max + 1));
}

function weightedTier(elite = false) {
  const total = REFRACTOR_TIERS.reduce((sum, tier, index) => {
    const eliteBoost = elite ? 1 + index * 0.42 : 1;
    return sum + tier.weight * eliteBoost;
  }, 0);
  let roll = Math.random() * total;

  for (let index = 0; index < REFRACTOR_TIERS.length; index += 1) {
    const tier = REFRACTOR_TIERS[index];
    const eliteBoost = elite ? 1 + index * 0.42 : 1;
    roll -= tier.weight * eliteBoost;
    if (roll <= 0) {
      return tier;
    }
  }

  return REFRACTOR_TIERS[0];
}

function createRefractorObject(tier) {
  const group = new THREE.Group();
  group.name = `refractorPickup_${tier.id}`;

  const coreMaterial = new THREE.MeshStandardMaterial({
    color: tier.color,
    emissive: tier.color,
    emissiveIntensity: tier.glow,
    roughness: 0.18,
    metalness: 0.06,
    transparent: true,
    opacity: 0.9,
  });

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: tier.color,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const core = new THREE.Mesh(new THREE.OctahedronGeometry(tier.scale, 0), coreMaterial);
  core.name = 'refractorCore';
  core.scale.y = 1.82;
  core.castShadow = true;

  const halo = new THREE.Mesh(new THREE.RingGeometry(tier.scale * 1.45, tier.scale * 1.7, 32), glowMaterial);
  halo.name = 'refractorGlowHalo';
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -tier.scale * 0.85;

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(tier.scale * 1.45, 24),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    }),
  );
  shadow.name = 'refractorSoftShadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -tier.scale * 1.2;

  group.add(core, halo, shadow);
  group.userData.core = core;
  group.userData.halo = halo;
  group.userData.coreMaterial = coreMaterial;
  group.userData.glowMaterial = glowMaterial;
  return group;
}

export class RefractorPickupSystem {
  constructor(scene) {
    this.scene = scene;
    this.pickups = [];
  }

  rollEnemyDrop(enemy) {
    const baseCount = enemy?.isElite ? 4 : 2;
    const levelBonus = Math.min(3, Math.floor((enemy?.level ?? 1) / 3));
    const count = baseCount + levelBonus + (Math.random() < 0.38 ? 1 : 0);

    for (let i = 0; i < count; i += 1) {
      const tier = weightedTier(enemy?.isElite);
      const value = randomInt(tier.value[0], tier.value[1]) + Math.floor((enemy?.level ?? 1) * (tier.scale * 2.4));
      const position = enemy.root.position.clone();
      const angle = Math.random() * Math.PI * 2;
      const distance = randomBetween(0.22, 0.88);
      position.x += Math.cos(angle) * distance;
      position.z += Math.sin(angle) * distance;
      position.y += 0.42 + Math.random() * 0.18;
      this.createPickup({ tier, value, position });
    }
  }

  rollChestDrop(position, { count = 4, bonusValue = 0, rareBoost = false } = {}) {
    for (let i = 0; i < count; i += 1) {
      const tier = weightedTier(rareBoost);
      const value = randomInt(tier.value[0], tier.value[1]) + bonusValue;
      const dropPosition = position.clone();
      const angle = Math.random() * Math.PI * 2;
      const distance = randomBetween(0.25, 1.05);
      dropPosition.x += Math.cos(angle) * distance;
      dropPosition.z += Math.sin(angle) * distance;
      dropPosition.y += 0.46 + Math.random() * 0.22;
      this.createPickup({ tier, value, position: dropPosition });
    }
  }

  createPickup({ tier = REFRACTOR_TIERS[0], value = tier.value[0], position }) {
    const object = createRefractorObject(tier);
    object.position.copy(position);
    object.userData.spawnY = position.y;
    object.userData.life = Math.random() * 10;

    this.scene.add(object);
    this.pickups.push({
      tier,
      value,
      object,
      collected: false,
      magnetized: false,
    });
    return object;
  }

  update(dt, player, inventory) {
    const collected = [];
    const playerPosition = player.root.position;
    const pickupRadius = player.stats.pickupRadius;
    const magnetRadius = pickupRadius * 2.35;

    for (const pickup of this.pickups) {
      if (pickup.collected) {
        continue;
      }

      pickup.object.userData.life += dt;
      const life = pickup.object.userData.life;
      const core = pickup.object.userData.core;
      const halo = pickup.object.userData.halo;

      pickup.object.rotation.y += dt * (pickup.magnetized ? 5.2 : 2.1);
      if (core) {
        core.rotation.x += dt * 0.9;
      }
      if (halo) {
        halo.rotation.z += dt * 2.8;
        halo.material.opacity = 0.2 + Math.sin(life * 5) * 0.05;
      }

      tempVectorA.copy(playerPosition).add(new THREE.Vector3(0, 0.95, 0));
      const distance = pickup.object.position.distanceTo(playerPosition);

      if (distance <= magnetRadius) {
        pickup.magnetized = true;
      }

      if (pickup.magnetized) {
        pickup.object.position.lerp(tempVectorA, Math.min(1, dt * 8));
      } else {
        pickup.object.position.y = pickup.object.userData.spawnY + Math.sin(life * 4.5) * 0.1;
      }

      tempVectorB.copy(pickup.object.position).sub(tempVectorA);
      if (pickup.magnetized && tempVectorB.lengthSq() <= 0.42 * 0.42) {
        pickup.collected = true;
        inventory.gold += pickup.value;
        pickup.object.visible = false;
        this.scene.remove(pickup.object);
        collected.push({
          label: pickup.tier.label,
          value: pickup.value,
          color: `#${new THREE.Color(pickup.tier.color).getHexString()}`,
        });
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
}

export default RefractorPickupSystem;
