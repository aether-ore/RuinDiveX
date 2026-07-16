import * as THREE from 'three';
import { createFixedArmDescriptor } from './equipment/ArmCatalog.js';
import { MEGA_BUSTER_CALIBRATION_CATALOG } from './buster/catalog.js';
import { createMegaCalibrationShadow } from './buster/MegaCalibrationShadow.js';

const SCRAP_PICKUP_SHAPES = Object.freeze(['bolt', 'screw', 'gear']);
const PICKUP_REST_HEIGHT = 0.35;
const PICKUP_FALL_GRAVITY = 18;

const LEGACY_RUNTIME_ARM_TO_FIXED_ID = Object.freeze({
  busterArm: 'megaBuster',
  swordArm: 'laserBeamBlade',
  machineGunArm: 'machineGunArm',
  cannonArm: 'cannonArm',
  grenadeArm: 'grenadeArm',
  missileArm: 'missileArm',
  laserArm: 'shiningLaser',
  liftArm: 'liftArm',
  drillArm: 'drillArm',
});

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
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

  const glow = item.glowColor ?? item.color ?? 0x9aa7ad;
  const isMaterial = item.pickupKind === 'material'
    || item.pickupKind === 'unidentifiedScrap';
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
  halo.name = 'lootPickupHalo';
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

  /**
   * Compatibility bridge for old debug/migration callers. Production loot no
   * longer creates randomized Items: curated arms resolve from the authored
   * catalog, while legacy Buster calibration shadows are deterministic.
   */
  generateItem(level = 1, options = {}) {
    const type = options.type;
    const fixedArmId = options.fixedArmId ?? LEGACY_RUNTIME_ARM_TO_FIXED_ID[type];
    if (fixedArmId) return createFixedArmDescriptor(fixedArmId);

    const calibration = MEGA_BUSTER_CALIBRATION_CATALOG[type];
    if (calibration) {
      return createMegaCalibrationShadow(type, {
        name: options.name ?? calibration.name,
        tags: ['buster', 'calibration'],
        behavior: 'Legacy deterministic Mega Buster calibration shadow.',
        localStats: options.localStats,
        baseStats: options.baseStats,
      });
    }

    return {
      id: `unidentified-scrap-debug-${this.nextMaterialPickupId++}`,
      pickupKind: 'unidentifiedScrap',
      quantity: 1,
      recovery: null,
      name: 'Unidentified Reaverbot Scrap +1',
      category: 'Unidentified Recovery',
      color: '#c7d0d6',
      glowColor: 0x9aa7ad,
      requestedLegacyType: type ?? null,
      requestedLevel: level,
    };
  }

  rollDrop(enemy) {
    const baseChance = enemy?.isElite ? 0.8 : 0.22;
    const levelChance = Math.min((enemy?.level ?? 1) * 0.012, 0.18);

    if (Math.random() > baseChance + levelChance) {
      return null;
    }

    const position = (enemy.deathDropPosition ?? enemy.root.position).clone();
    position.y += 0.35;
    position.x += randomBetween(-0.45, 0.45);
    position.z += randomBetween(-0.45, 0.45);

    return this.createUnidentifiedScrapPickup(1, position, {
      source: {
        enemyName: enemy?.genome?.name ?? enemy?.type?.name ?? enemy?.typeKey ?? 'Reaverbot',
        enemySeed: enemy?.genome?.seed ?? null,
        elite: Boolean(enemy?.isElite),
      },
      recoverableParts: [],
    });
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
      pendingCollection: false,
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
      color: material.color ?? '#c7d0d6',
      glowColor: new THREE.Color(material.color ?? '#c7d0d6').getHex(),
    };
    return this.createPickup(item, position);
  }

  createUnidentifiedScrapPickup(quantity, position, recovery = null) {
    const amount = Math.max(1, Math.trunc(quantity) || 1);
    const pickupIndex = this.nextMaterialPickupId++;
    const item = {
      id: `unidentified-reaverbot-scrap-${pickupIndex}`,
      pickupKind: 'unidentifiedScrap',
      scrapShape: SCRAP_PICKUP_SHAPES[(pickupIndex - 1) % SCRAP_PICKUP_SHAPES.length],
      quantity: amount,
      recovery: recovery ? {
        source: recovery.source ? { ...recovery.source } : null,
        recoverableParts: (recovery.recoverableParts ?? []).map((part) => ({
          ...part,
          source: part.source ? { ...part.source } : null,
        })),
      } : null,
      name: `Unidentified Reaverbot Scrap +${amount}`,
      category: 'Unidentified Recovery',
      color: '#c7d0d6',
      glowColor: 0x9aa7ad,
    };
    return this.createPickup(item, position);
  }

  _finishPickupCollection(pickup) {
    if (!pickup || pickup.collected) return false;
    pickup.collected = true;
    pickup.pendingCollection = false;
    pickup.object.visible = false;
    this.scene.remove(pickup.object);
    disposePickupObject(pickup.object);
    return true;
  }

  update(dt, player, inventory, { collectItem = null, onAsyncCollected = null } = {}) {
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
      if (distance <= pickupRadius && !pickup.pendingCollection) {
        const accepted = pickup.kind === 'material'
          ? Boolean(inventory.addMaterial?.(
            pickup.item.material,
            pickup.item.quantity,
            pickup.item.source,
          ))
          : pickup.kind === 'unidentifiedScrap'
            ? Boolean(inventory.addUnidentifiedScrap?.(
              pickup.item.quantity,
              pickup.item.recovery,
            ))
            : typeof collectItem === 'function'
              ? collectItem(pickup.item)
              : inventory.addItem(pickup.item);
        if (accepted && typeof accepted.then === 'function') {
          pickup.pendingCollection = true;
          Promise.resolve(accepted).then((didAccept) => {
            pickup.pendingCollection = false;
            if (!didAccept || !this.pickups.includes(pickup)) return;
            if (this._finishPickupCollection(pickup)) {
              this.pickups = this.pickups.filter((entry) => !entry.collected);
              onAsyncCollected?.(pickup.item);
            }
          }).catch(() => {
            pickup.pendingCollection = false;
          });
          continue;
        }
        if (accepted) {
          if (this._finishPickupCollection(pickup)) collected.push(pickup.item);
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

}
