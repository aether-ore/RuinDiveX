import * as THREE from 'three';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { AnimationController } from './AnimationController.js';
import { ModularHumanoid } from './ModularHumanoid.js';

const REAVERBOT_ASSET_PATH = './assets/models/reaverbots/';
const HOROKKO_MTL = 'Horokko.mtl';
const HOROKKO_OBJ = 'Horokko.obj';
const HOROKKO_TEXTURE = 'Horokko.png';
const HOROKKO_TARGET_HEIGHT = 2.05;
const GORUBESSHU_MTL = 'Gorubesshu.mtl';
const GORUBESSHU_OBJ = 'Gorubesshu.obj';
const GORUBESSHU_TARGET_HEIGHT = 2.35;
const SHARUKURUSU_TARGET_HEIGHT = 2.42;
const GORUBESSHU_RIG_ROOT = 'gorubesshuRigRoot';
const DEATH_SEQUENCE_DURATION = 1.25;
const DEATH_LIMP_FALL_DURATION = 0.44;
const DEATH_BODY_FADE_DURATION = 0.18;
const GORUBESSHU_PART_GROUPS = {
  torso: 'gorubesshuTorsoPivot',
  head: 'gorubesshuHeadPivot',
  shieldArm: 'gorubesshuShieldArmPivot',
  flameArm: 'gorubesshuFlamethrowerArmPivot',
  leftLeg: 'gorubesshuLeftLegPivot',
  rightLeg: 'gorubesshuRightLegPivot',
};
const textureLoader = new THREE.TextureLoader();
let reaverbotPanelTexture = null;
let horokkoModelPromise = null;
let gorubesshuModelPromise = null;

export const ENEMY_TYPES = {
  basic: {
    label: 'Servitor Reaverbot',
    skinColor: 0x87935f,
    clothColor: 0x4d5532,
    hairColor: 0x1f2416,
    eyeColor: 0xff245b,
    scale: 0.86,
    maxHealth: 24,
    damage: 5,
    moveSpeed: 2.45,
    attackRange: 0.75,
    attackCooldown: 1.2,
    experience: 5,
  },
  fast: {
    label: 'Skitter Reaverbot',
    skinColor: 0x9aa76a,
    clothColor: 0x465032,
    hairColor: 0x161616,
    eyeColor: 0xff245b,
    scale: 0.76,
    maxHealth: 16,
    damage: 4,
    moveSpeed: 3.7,
    attackRange: 0.7,
    attackCooldown: 0.9,
    experience: 6,
  },
  tank: {
    label: 'Armored Reaverbot',
    skinColor: 0x8d8f68,
    clothColor: 0x56583a,
    hairColor: 0x241b16,
    eyeColor: 0xff245b,
    scale: 1.06,
    maxHealth: 58,
    damage: 9,
    moveSpeed: 1.8,
    attackRange: 0.85,
    attackCooldown: 1.7,
    armor: 12,
    experience: 12,
  },
  ranged: {
    label: 'Pulse Sentry',
    skinColor: 0x7e875b,
    clothColor: 0x343f2d,
    hairColor: 0x1b2317,
    eyeColor: 0xff245b,
    scale: 0.84,
    maxHealth: 21,
    damage: 5,
    moveSpeed: 2.25,
    attackRange: 5.8,
    attackCooldown: 1.9,
    ranged: true,
    projectileSpeed: 6.5,
    experience: 9,
  },
  horokko: {
    label: 'Horokko Reaverbot',
    skinColor: 0x87935f,
    clothColor: 0x4b5630,
    hairColor: 0x1c2115,
    eyeColor: 0xff245b,
    scale: 0.82,
    radius: 0.54,
    maxHealth: 32,
    damage: 6,
    moveSpeed: 2.6,
    attackRange: 6.1,
    attackCooldown: 2.25,
    armor: 4,
    experience: 8,
    ranged: true,
    projectileSpeed: 5.4,
    lobbedExplosive: true,
    lobArcHeight: 1.35,
    explosiveRadius: 1.05,
    modelAsset: 'horokko',
    modelHeight: HOROKKO_TARGET_HEIGHT,
    modelYawOffset: Math.PI,
  },
  gorubesshu: {
    label: 'Gorubesshu Reaverbot',
    skinColor: 0x7f7669,
    clothColor: 0x4f463f,
    hairColor: 0x191513,
    eyeColor: 0xff245b,
    scale: 0.96,
    radius: 0.72,
    maxHealth: 82,
    damage: 7,
    moveSpeed: 1.65,
    attackRange: 4.65,
    attackCooldown: 2.55,
    armor: 18,
    experience: 16,
    ranged: true,
    flamethrower: true,
    shieldBlockMultiplier: 0.24,
    modelAsset: 'gorubesshu',
    modelHeight: GORUBESSHU_TARGET_HEIGHT,
    modelYawOffset: Math.PI,
  },
  sharukurusu: {
    label: 'Sharukurusu Reaverbot',
    skinColor: 0x687b48,
    clothColor: 0x313c27,
    hairColor: 0x171d13,
    eyeColor: 0xff245b,
    scale: 0.9,
    radius: 0.78,
    maxHealth: 68,
    damage: 12,
    moveSpeed: 5.65,
    chargeSpeed: 9.4,
    attackRange: 7.8,
    attackCooldown: 1.45,
    armor: 11,
    experience: 18,
    modelAsset: 'sharukurusu',
    modelHeight: SHARUKURUSU_TARGET_HEIGHT,
    // The authored red-eye face and drill-ready stance point down local +Z,
    // which is also the enemy root's combat-forward axis.
    modelYawOffset: 0,
  },
};

const tempDirection = new THREE.Vector3();
const tempNavigationDirection = new THREE.Vector3();
const tempPosition = new THREE.Vector3();
const tempForward = new THREE.Vector3();
const tempHitVector = new THREE.Vector3();
const tempPoseOffset = new THREE.Vector3();
const tempPoseRotation = new THREE.Euler();
const statusColor = new THREE.Color();

let nextEnemyId = 1;
const defaultEnemyIdAllocator = {
  allocate() {
    return `enemy-${nextEnemyId++}`;
  },
};
let activeEnemyIdAllocator = defaultEnemyIdAllocator;

export function createEnemyIdAllocator(prefix = 'enemy', start = 1) {
  let nextId = Math.max(1, Math.trunc(Number(start)) || 1);
  return {
    prefix: String(prefix || 'enemy'),
    allocate() {
      return `${this.prefix}-${nextId++}`;
    },
    snapshot() {
      return nextId;
    },
  };
}

export function setActiveEnemyIdAllocator(allocator = null) {
  activeEnemyIdAllocator = typeof allocator?.allocate === 'function'
    ? allocator
    : defaultEnemyIdAllocator;
  return activeEnemyIdAllocator;
}

export function getActiveEnemyIdAllocator() {
  return activeEnemyIdAllocator;
}

function getReaverbotPanelTexture() {
  if (!reaverbotPanelTexture) {
    reaverbotPanelTexture = textureLoader.load(`${REAVERBOT_ASSET_PATH}${HOROKKO_TEXTURE}`);
    reaverbotPanelTexture.name = 'texture_horokkoReaverbotPanelSheet';
    reaverbotPanelTexture.colorSpace = THREE.SRGBColorSpace;
    reaverbotPanelTexture.wrapS = THREE.RepeatWrapping;
    reaverbotPanelTexture.wrapT = THREE.RepeatWrapping;
    reaverbotPanelTexture.repeat.set(1.6, 1.2);
    reaverbotPanelTexture.magFilter = THREE.NearestFilter;
    reaverbotPanelTexture.minFilter = THREE.NearestMipmapNearestFilter;
  }

  return reaverbotPanelTexture;
}

function prepareHorokkoModelTemplate(model) {
  model.name = 'horokkoReaverbotTemplate';
  model.traverse((object) => {
    if (!object.isMesh) {
      return;
    }

    object.name ||= 'horokkoReaverbotMesh';
    object.castShadow = true;
    object.receiveShadow = true;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) {
        continue;
      }

      material.side = THREE.FrontSide;
      material.roughness = Math.max(material.roughness ?? 0.55, 0.58);
      if (material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.magFilter = THREE.NearestFilter;
        material.map.minFilter = THREE.NearestMipmapNearestFilter;
      }
      material.needsUpdate = true;
    }
  });

  return model;
}

function createGorubesshuPartBucket(material) {
  return {
    material,
    positions: [],
    normals: [],
    uvs: [],
  };
}

function getGorubesshuNormalizedY(point, bounds, height) {
  return height > 0 ? (point.y - bounds.min.y) / height : 0;
}

function classifyGorubesshuTriangle(centroid, bounds, height) {
  const normalizedY = getGorubesshuNormalizedY(centroid, bounds, height);
  const armThreshold = height * 0.16;

  if (normalizedY > 0.6) {
    return 'head';
  }

  if (centroid.x < -armThreshold && normalizedY > 0.08) {
    return 'shieldArm';
  }

  if (centroid.x > height * 0.13 && normalizedY > 0.11) {
    return 'flameArm';
  }

  if (normalizedY < 0.31) {
    return centroid.x < 0 ? 'leftLeg' : 'rightLeg';
  }

  if (normalizedY < 0.48 && Math.abs(centroid.x) > height * 0.05) {
    return centroid.x < 0 ? 'leftLeg' : 'rightLeg';
  }

  return 'torso';
}

function getGorubesshuPartPivot(partName, bounds, height) {
  const centerZ = (bounds.min.z + bounds.max.z) * 0.5;

  switch (partName) {
    case 'head':
      return new THREE.Vector3(0, bounds.min.y + height * 0.72, centerZ);
    case 'shieldArm':
      return new THREE.Vector3(-height * 0.21, bounds.min.y + height * 0.48, centerZ);
    case 'flameArm':
      return new THREE.Vector3(height * 0.19, bounds.min.y + height * 0.49, centerZ);
    case 'leftLeg':
      return new THREE.Vector3(-height * 0.085, bounds.min.y + height * 0.31, centerZ);
    case 'rightLeg':
      return new THREE.Vector3(height * 0.085, bounds.min.y + height * 0.31, centerZ);
    case 'torso':
    default:
      return new THREE.Vector3(0, bounds.min.y + height * 0.47, centerZ);
  }
}

function appendGorubesshuVertex(bucket, positionAttribute, normalAttribute, uvAttribute, vertexIndex, transform, normalMatrix) {
  const point = new THREE.Vector3().fromBufferAttribute(positionAttribute, vertexIndex).applyMatrix4(transform);
  bucket.positions.push(point.x, point.y, point.z);

  if (normalAttribute) {
    const normal = new THREE.Vector3().fromBufferAttribute(normalAttribute, vertexIndex).applyMatrix3(normalMatrix).normalize();
    bucket.normals.push(normal.x, normal.y, normal.z);
  }

  if (uvAttribute) {
    bucket.uvs.push(uvAttribute.getX(vertexIndex), uvAttribute.getY(vertexIndex));
  } else {
    bucket.uvs.push(0, 0);
  }
}

function collectGorubesshuMeshTriangles(model, buckets, bounds, height) {
  model.updateMatrixWorld(true);
  const inverseModelMatrix = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const vertexA = new THREE.Vector3();
  const vertexB = new THREE.Vector3();
  const vertexC = new THREE.Vector3();
  const centroid = new THREE.Vector3();

  model.traverse((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) {
      return;
    }

    const geometry = object.geometry;
    const positionAttribute = geometry.attributes.position;
    const normalAttribute = geometry.attributes.normal ?? null;
    const uvAttribute = geometry.attributes.uv ?? null;
    const transform = new THREE.Matrix4().multiplyMatrices(inverseModelMatrix, object.matrixWorld);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(transform);
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    const indexAttribute = geometry.index;
    const triangleCount = indexAttribute ? indexAttribute.count / 3 : positionAttribute.count / 3;

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      const i0 = indexAttribute ? indexAttribute.getX(triangleIndex * 3) : triangleIndex * 3;
      const i1 = indexAttribute ? indexAttribute.getX(triangleIndex * 3 + 1) : triangleIndex * 3 + 1;
      const i2 = indexAttribute ? indexAttribute.getX(triangleIndex * 3 + 2) : triangleIndex * 3 + 2;

      vertexA.fromBufferAttribute(positionAttribute, i0).applyMatrix4(transform);
      vertexB.fromBufferAttribute(positionAttribute, i1).applyMatrix4(transform);
      vertexC.fromBufferAttribute(positionAttribute, i2).applyMatrix4(transform);
      centroid.copy(vertexA).add(vertexB).add(vertexC).multiplyScalar(1 / 3);

      const partName = classifyGorubesshuTriangle(centroid, bounds, height);
      const bucket = buckets.get(partName);
      appendGorubesshuVertex(bucket, positionAttribute, normalAttribute, uvAttribute, i0, transform, normalMatrix);
      appendGorubesshuVertex(bucket, positionAttribute, normalAttribute, uvAttribute, i1, transform, normalMatrix);
      appendGorubesshuVertex(bucket, positionAttribute, normalAttribute, uvAttribute, i2, transform, normalMatrix);

      if (!bucket.material) {
        bucket.material = material;
      }
    }
  });
}

function createGorubesshuRiggedModel(model) {
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const height = size.y;

  if (height <= 0) {
    return model;
  }

  const sourceMaterial = model.getObjectByProperty('isMesh', true)?.material;
  const defaultMaterial = Array.isArray(sourceMaterial) ? sourceMaterial[0] : sourceMaterial;
  const buckets = new Map();

  for (const partName of Object.keys(GORUBESSHU_PART_GROUPS)) {
    buckets.set(partName, createGorubesshuPartBucket(defaultMaterial));
  }

  collectGorubesshuMeshTriangles(model, buckets, bounds, height);

  const rig = new THREE.Group();
  rig.name = GORUBESSHU_RIG_ROOT;

  for (const [partName, bucket] of buckets.entries()) {
    if (bucket.positions.length < 9) {
      continue;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2));

    if (bucket.normals.length === bucket.positions.length) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3));
    } else {
      geometry.computeVertexNormals();
    }

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const pivot = getGorubesshuPartPivot(partName, bounds, height);
    const group = new THREE.Group();
    group.name = GORUBESSHU_PART_GROUPS[partName];
    group.position.copy(pivot);

    const mesh = new THREE.Mesh(geometry, bucket.material ?? defaultMaterial);
    mesh.name = `gorubesshu_${partName}_mesh`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(pivot).multiplyScalar(-1);
    group.add(mesh);
    rig.add(group);
  }

  const flameArm = rig.getObjectByName(GORUBESSHU_PART_GROUPS.flameArm);
  if (flameArm) {
    const muzzle = new THREE.Group();
    muzzle.name = 'gorubesshuFlamethrowerMuzzle';
    muzzle.position.set(height * 0.18, -height * 0.08, -height * 0.12);
    flameArm.add(muzzle);
  }

  return rig;
}

function bindGorubesshuRig(visual) {
  const rig = visual.getObjectByName(GORUBESSHU_RIG_ROOT)
    ?? (visual.getObjectByName(GORUBESSHU_PART_GROUPS.torso) ? visual : null);

  if (!rig) {
    return null;
  }

  const parts = {
    root: rig,
    torso: visual.getObjectByName(GORUBESSHU_PART_GROUPS.torso),
    head: visual.getObjectByName(GORUBESSHU_PART_GROUPS.head),
    shieldArm: visual.getObjectByName(GORUBESSHU_PART_GROUPS.shieldArm),
    flameArm: visual.getObjectByName(GORUBESSHU_PART_GROUPS.flameArm),
    leftLeg: visual.getObjectByName(GORUBESSHU_PART_GROUPS.leftLeg),
    rightLeg: visual.getObjectByName(GORUBESSHU_PART_GROUPS.rightLeg),
    muzzle: visual.getObjectByName('gorubesshuFlamethrowerMuzzle'),
  };

  for (const part of Object.values(parts)) {
    if (!part) {
      continue;
    }

    part.userData.basePosition = part.position.clone();
    part.userData.baseRotation = part.rotation.clone();
  }

  return parts;
}

function applyGorubesshuPartPose(part, positionOffset, rotation) {
  if (!part?.userData.basePosition || !part.userData.baseRotation) {
    return;
  }

  part.position.copy(part.userData.basePosition).add(positionOffset);
  part.rotation.set(
    part.userData.baseRotation.x + rotation.x,
    part.userData.baseRotation.y + rotation.y,
    part.userData.baseRotation.z + rotation.z,
  );
}

function setGorubesshuPartPose(part, offsetX, offsetY, offsetZ, rotationX, rotationY, rotationZ) {
  tempPoseOffset.set(offsetX, offsetY, offsetZ);
  tempPoseRotation.set(rotationX, rotationY, rotationZ);
  applyGorubesshuPartPose(part, tempPoseOffset, tempPoseRotation);
}

function loadHorokkoModelTemplate() {
  if (!horokkoModelPromise) {
    const materialLoader = new MTLLoader();
    materialLoader.setPath(REAVERBOT_ASSET_PATH);
    materialLoader.setResourcePath(REAVERBOT_ASSET_PATH);

    horokkoModelPromise = materialLoader.loadAsync(HOROKKO_MTL)
      .then((materials) => {
        materials.preload();
        const objectLoader = new OBJLoader();
        objectLoader.setPath(REAVERBOT_ASSET_PATH);
        objectLoader.setMaterials(materials);
        return objectLoader.loadAsync(HOROKKO_OBJ);
      })
      .then((model) => prepareHorokkoModelTemplate(model))
      .catch((error) => {
        console.warn('Could not load Horokko Reaverbot model. Using procedural enemy fallback.', error);
        return null;
      });
  }

  return horokkoModelPromise;
}

function prepareGorubesshuModelTemplate(model) {
  model.name = 'gorubesshuReaverbotTemplate';
  model.traverse((object) => {
    if (!object.isMesh) {
      return;
    }

    object.name ||= 'gorubesshuReaverbotMesh';
    object.castShadow = true;
    object.receiveShadow = true;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) {
        continue;
      }

      material.side = THREE.FrontSide;
      material.roughness = Math.max(material.roughness ?? 0.55, 0.62);
      material.metalness = Math.max(material.metalness ?? 0, 0.08);
      if (material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.magFilter = THREE.NearestFilter;
        material.map.minFilter = THREE.NearestMipmapNearestFilter;
      }
      material.needsUpdate = true;
    }
  });

  const riggedModel = createGorubesshuRiggedModel(model);
  riggedModel.name = 'gorubesshuReaverbotTemplate';
  return riggedModel;
}

function loadGorubesshuModelTemplate() {
  if (!gorubesshuModelPromise) {
    const materialLoader = new MTLLoader();
    materialLoader.setPath(REAVERBOT_ASSET_PATH);
    materialLoader.setResourcePath(REAVERBOT_ASSET_PATH);

    gorubesshuModelPromise = materialLoader.loadAsync(GORUBESSHU_MTL)
      .then((materials) => {
        materials.preload();
        const objectLoader = new OBJLoader();
        objectLoader.setPath(REAVERBOT_ASSET_PATH);
        objectLoader.setMaterials(materials);
        return objectLoader.loadAsync(GORUBESSHU_OBJ);
      })
      .then((model) => prepareGorubesshuModelTemplate(model))
      .catch((error) => {
        console.warn('Could not load Gorubesshu Reaverbot model. Using procedural enemy fallback.', error);
        return null;
      });
  }

  return gorubesshuModelPromise;
}

function createEnemyHealthBar(scale = 1) {
  const group = new THREE.Group();
  group.name = 'enemyHealthBar';
  group.position.set(0, 2.95 * scale, 0);

  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(0.82, 0.1),
    new THREE.MeshBasicMaterial({
      color: 0x1d1110,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
  );
  background.name = 'enemyHealthBarBackground';

  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.76, 0.055),
    new THREE.MeshBasicMaterial({
      color: 0xd94b43,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
  );
  fill.name = 'enemyHealthBarFill';
  fill.position.z = 0.004;

  group.add(background, fill);
  group.userData.fill = fill;
  group.visible = false;
  return group;
}

function setObjectOpacity(root, opacity) {
  root.traverse((object) => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];

    for (const material of materials) {
      if (!material) {
        continue;
      }

      material.transparent = true;
      material.opacity = opacity;
    }
  });
}

function scaledStat(value, level, factor) {
  return value * (1 + Math.max(0, level - 1) * factor);
}

function createStatusState() {
  return {
    burning: { duration: 0, dps: 0, tickTimer: 0 },
    chill: { duration: 0, slow: 0, buildup: 0 },
    freeze: { duration: 0 },
    shock: { duration: 0 },
    corrosion: { duration: 0, dps: 0, armorReduction: 0, tickTimer: 0 },
    armorBreak: { duration: 0, armorReduction: 0 },
    stagger: { duration: 0 },
  };
}

export class Enemy {
  constructor(typeKey = 'basic', level = 1, overrides = {}) {
    this.typeKey = typeKey;
    this.type = { ...ENEMY_TYPES[typeKey], ...overrides };
    this.level = level;
    this.id = activeEnemyIdAllocator.allocate();
    this.isElite = false;
    this.dead = false;
    this.disposed = false;
    this.radius = (this.type.radius ?? 0.42) * this.type.scale;
    this.attackCooldown = Math.random() * this.type.attackCooldown;
    this.postAttackRetreatTimer = 0;
    this.flashTimer = 0;
    this.flashDuration = 0.16;
    this.flashColor = new THREE.Color(0xe61f18);
    this.flashIntensity = 0.85;
    this.hitReactTimer = 0;
    this.hitReactDuration = 0.16;
    this.hitStopTimer = 0;
    this.hitWobbleStrength = 0;
    this.hitWobbleSeed = Math.random() * Math.PI * 2;
    this.deathTimer = DEATH_SEQUENCE_DURATION;
    this.deathFallAxis = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this.deathStartRotation = new THREE.Euler();
    this.deathStartPosition = new THREE.Vector3();
    this.deathLandingPosition = null;
    this.deathDropPosition = null;
    this.deathEffectTriggered = false;
    this.deathPhase = 'alive';
    this.deathLimpParts = [];
    this.deathLimpSettled = false;
    this.deathLastOpacity = null;
    this.knockback = new THREE.Vector3();
    this.statusEffects = createStatusState();
    // External control is an exclusive, short-lived ownership claim used by
    // systems such as the Lift Arm and tractor-beam Reaverbots. Ballistic
    // motion is stored separately so a launched enemy owns the rest of its
    // trajectory even if the original carrier is destroyed.
    this.externalControl = null;
    this.externalBallisticMotion = null;
    // Encounter ownership also carries a soft movement envelope. Dungeon
    // navigation uses it to keep enemies participating in their fight instead
    // of camping doorways or endlessly pressing against room geometry.
    this.encounterArena = null;
    this.navigationRecoveryTarget = null;
    this.navigationRecoveryTimer = 0;
    this.wallContactCount = 0;

    this.stats = {
      maxHealth: scaledStat(this.type.maxHealth, level, 0.16),
      damage: scaledStat(this.type.damage, level, 0.09),
      moveSpeed: scaledStat(this.type.moveSpeed, level, 0.015),
      attackRange: this.type.attackRange,
      attackCooldown: Math.max(0.35, this.type.attackCooldown * (1 - Math.min(level * 0.006, 0.18))),
      armor: scaledStat(this.type.armor ?? 0, level, 0.08),
      experience: Math.round(scaledStat(this.type.experience, level, 0.12)),
    };

    this.health = this.stats.maxHealth;

    this.humanoid = new ModularHumanoid({
      skinColor: this.type.skinColor,
      hairColor: this.type.hairColor,
      eyeColor: this.type.eyeColor,
      clothColor: this.type.clothColor,
      armorColor: 0x665c57,
      scale: this.type.scale,
      hairStyle: 'none',
    });

    this.root = this.humanoid.root;
    this.root.name = this.id;
    this.root.userData.enemy = this;
    this.animation = new AnimationController(this.humanoid);
    this.healthBar = createEnemyHealthBar(this.type.scale);
    this.root.add(this.healthBar);
    this.externalModelGroup = null;
    this.externalModelVisual = null;
    this.externalModelBaseY = 0;
    this.gorubesshuRig = null;
    this.gorubesshuBlockTimer = 0;
    this.gorubesshuBlockDuration = 0.24;
    this._externalModelTime = Math.random() * Math.PI * 2;
    this.horokkoAttack = {
      active: false,
      timer: 0,
      duration: 0.86,
      fireTime: 0.54,
      fired: false,
      direction: new THREE.Vector3(0, 0, 1),
      targetPosition: new THREE.Vector3(),
    };
    this.gorubesshuAttack = {
      active: false,
      timer: 0,
      duration: 1.75,
      flameStart: 0.34,
      flameEnd: 1.36,
      tickTimer: 0,
      particleTimer: 0,
      telegraphTimer: 0,
      direction: new THREE.Vector3(0, 0, 1),
    };

    this._applyReaverbotProceduralStyle();
    this._loadModelVisualIfNeeded();
    this._materialStates = [];
    this._captureMaterialStates();
  }

  setEncounterArena(encounter, resolvedCenter = null) {
    const zone = encounter?.zone;
    if (!zone?.position
      || !Number.isFinite(zone.halfWidth)
      || !Number.isFinite(zone.halfDepth)) {
      this.encounterArena = null;
      this.navigationRecoveryTarget = null;
      this.navigationRecoveryTimer = 0;
      return null;
    }

    const center = resolvedCenter?.clone?.() ?? zone.position.clone();
    const edgeMargin = Math.max(1.25, this.radius * 2.2);
    this.encounterArena = {
      encounterId: encounter.id ?? this.encounterId ?? null,
      center,
      zoneCenter: zone.position.clone(),
      halfWidth: zone.halfWidth,
      halfDepth: zone.halfDepth,
      softHalfWidth: Math.max(1.1, zone.halfWidth - edgeMargin),
      softHalfDepth: Math.max(1.1, zone.halfDepth - edgeMargin),
    };
    this.navigationRecoveryTarget = null;
    this.navigationRecoveryTimer = 0;
    this.wallContactCount = 0;
    return this.encounterArena;
  }

  setNavigationRecoveryTarget(position, duration = 1.4) {
    if (!position?.isVector3) {
      return false;
    }
    this.navigationRecoveryTarget = position.clone();
    this.navigationRecoveryTimer = Math.max(this.navigationRecoveryTimer, duration);
    return true;
  }

  clearNavigationRecoveryTarget() {
    this.navigationRecoveryTarget = null;
    this.navigationRecoveryTimer = 0;
  }

  update(dt, game) {
    if (this.dead) {
      this._updateDeath(dt, game);
      this._updateHealthBar(game.camera);
      return;
    }

    if (this.navigationRecoveryTimer > 0) {
      this.navigationRecoveryTimer = Math.max(0, this.navigationRecoveryTimer - dt);
      if (this.navigationRecoveryTimer <= 0) {
        this.navigationRecoveryTarget = null;
      }
    }

    this._updateStatusEffects(dt, game);
    if (this.dead) {
      this._updateHealthBar(game.camera);
      return;
    }

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const flash = Math.max(0, this.flashTimer / this.flashDuration);
      for (const state of this._materialStates) {
        statusColor.copy(this.flashColor).multiplyScalar(flash);
        state.material.emissive.copy(statusColor);
        state.material.emissiveIntensity = Math.max(state.intensity, flash * this.flashIntensity);
      }
    } else {
      this._applyStatusVisuals();
    }

    if (this.hitReactTimer > 0) {
      this.hitReactTimer -= dt;
      const hitRatio = THREE.MathUtils.clamp(this.hitReactTimer / this.hitReactDuration, 0, 1);
      const hitProgress = 1 - hitRatio;
      const recoil = Math.sin(hitProgress * Math.PI) * 0.13;
      const wobble = Math.sin(hitProgress * Math.PI * 5 + this.hitWobbleSeed) * this.hitWobbleStrength * hitRatio;
      this.root.rotation.x = -recoil;
      this.root.rotation.z = wobble;
    } else {
      this.root.rotation.x = THREE.MathUtils.lerp(this.root.rotation.x, 0, Math.min(1, dt * 10));
      this.root.rotation.z = THREE.MathUtils.lerp(this.root.rotation.z, 0, Math.min(1, dt * 12));
    }

    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);
    }

    if (this.gorubesshuBlockTimer > 0) {
      this.gorubesshuBlockTimer = Math.max(0, this.gorubesshuBlockTimer - dt);
    }

    if (this._updateExternalMotion(dt, game)) {
      this.animation.update(dt, { moving: false, moveAmount: 0 });
      this._updateExternalModelVisual(dt, false);
      this._updateHealthBar(game.camera);
      return;
    }

    if (this.knockback.lengthSq() > 0.0001) {
      this.root.position.addScaledVector(this.knockback, dt);
      this.knockback.multiplyScalar(Math.pow(0.08, dt));
    }

    const customBehavior = this._updateCustomBehavior?.(dt, game);
    if (customBehavior?.handled) {
      this.animation.update(dt, {
        moving: Boolean(customBehavior.moving),
        moveAmount: customBehavior.moveAmount ?? (customBehavior.moving ? 1 : 0),
      });
      this._updateExternalModelVisual(dt, Boolean(customBehavior.moving));
      this._updateHealthBar(game.camera);
      return;
    }

    const player = game.player;
    const verticalGap = Math.abs(player.root.position.y - this.root.position.y);
    tempDirection.copy(player.root.position).sub(this.root.position);
    tempDirection.y = 0;
    const distance = tempDirection.length();

    if (distance > 0.001) {
      tempDirection.divideScalar(distance);
      this.root.rotation.y = Math.atan2(tempDirection.x, tempDirection.z);
    }

    if (this._updateHorokkoAttack(dt, game, tempDirection)) {
      this.animation.update(dt, { moving: false, moveAmount: 0 });
      this._updateExternalModelVisual(dt, false);
      this._updateHealthBar(game.camera);
      return;
    }

    if (this._updateGorubesshuAttack(dt, game, tempDirection)) {
      this.animation.update(dt, { moving: false, moveAmount: 0 });
      this._updateExternalModelVisual(dt, false);
      this._updateHealthBar(game.camera);
      return;
    }

    if (game.dungeonController?.isPlayerInSafeZone?.()) {
      this.animation.update(dt, { moving: false, moveAmount: 0 });
      this._updateExternalModelVisual(dt, false);
      this._updateHealthBar(game.camera);
      return;
    }

    const controlLocked = this._isControlLocked();
    const attackRateMultiplier = this._getStatusAttackRateMultiplier();

    this.attackCooldown -= dt * attackRateMultiplier;
    this.postAttackRetreatTimer = Math.max(0, this.postAttackRetreatTimer - dt);

    const desiredDistance = this.type.ranged ? this.stats.attackRange * 0.72 : this.stats.attackRange;
    const hasVerticalAttackAccess = this.type.ranged || verticalGap <= 1.35;
    const hitStopped = this.hitStopTimer > 0;
    const shouldRecenter = game.dungeonController?.shouldEnemyRecenter?.(this) ?? false;
    const retreating = this.postAttackRetreatTimer > 0 && hasVerticalAttackAccess;
    const moving = !controlLocked
      && !hitStopped
      && (retreating || distance > desiredDistance || !hasVerticalAttackAccess || shouldRecenter);

    if (moving) {
      const navigationTarget = retreating
        ? tempPosition.copy(this.root.position).addScaledVector(tempDirection, -3)
        : player.root.position;
      const navigationDirection = game.dungeonController?.getEnemyNavigationDirection?.(
        this,
        navigationTarget,
      ) ?? game.dungeonController?.getNavigationDirection?.(this.root.position, navigationTarget);
      tempNavigationDirection.copy(navigationDirection ?? tempDirection);
      if (retreating && !navigationDirection) tempNavigationDirection.multiplyScalar(-1);
      if (tempNavigationDirection.lengthSq() > 0.0001) {
        tempNavigationDirection.normalize();
      }
      this.root.position.addScaledVector(tempNavigationDirection, this.stats.moveSpeed * this._getStatusMoveMultiplier() * dt);
    }

    if (!controlLocked
      && !hitStopped
      && hasVerticalAttackAccess
      && distance <= this.stats.attackRange
      && this.attackCooldown <= 0
      && (game.requestEnemyAttack?.(this) ?? true)) {
      this._attack(game, tempDirection);
      this.attackCooldown = this.stats.attackCooldown;
      this.postAttackRetreatTimer = Math.max(this.postAttackRetreatTimer, 0.62);
      if (!this.isAttackLeaseActive()) game.completeEnemyAttack?.(this);
    }

    this.animation.update(dt, { moving, moveAmount: moving ? 1 : 0 });
    this._updateExternalModelVisual(dt, moving);
    this._updateHealthBar(game.camera);
  }

  tryClaimExternalControl(owner, kind = 'external', options = {}) {
    if (!owner || this.dead || this.externalBallisticMotion) {
      return false;
    }

    if (this.externalControl && this.externalControl.owner !== owner) {
      return false;
    }

    const freeze = options.freeze ?? true;
    const previous = this.externalControl;
    this.externalControl = {
      owner,
      kind,
      freeze,
      ignoreGroundConstraint: options.ignoreGroundConstraint ?? freeze,
      releasePosition: options.releasePosition?.clone?.()
        ?? previous?.releasePosition
        ?? this.root.position.clone(),
      onRelease: options.onRelease ?? previous?.onRelease ?? null,
    };

    if (freeze) {
      this.knockback.set(0, 0, 0);
    }
    return true;
  }

  hasExternalControl(owner = null) {
    if (!this.externalControl) {
      return false;
    }
    return owner ? this.externalControl.owner === owner : true;
  }

  releaseExternalControl(owner, reason = 'released', options = {}) {
    const control = this.externalControl;
    if (!control || control.owner !== owner) {
      return false;
    }

    this.externalControl = null;
    this.knockback.set(0, 0, 0);
    if (options.snapToReleasePosition && control.releasePosition) {
      this.root.position.copy(control.releasePosition);
    }
    control.onRelease?.(this, owner, reason);
    return true;
  }

  startExternalBallisticMotion(owner, {
    targetPosition,
    duration = 0.9,
    arcHeight = 1.6,
    spinRate = 8,
    onLand = null,
  } = {}) {
    const control = this.externalControl;
    if (!control || control.owner !== owner || this.dead || this.externalBallisticMotion) {
      return false;
    }
    if (!targetPosition?.isVector3 && !(
      Number.isFinite(targetPosition?.x)
      && Number.isFinite(targetPosition?.y)
      && Number.isFinite(targetPosition?.z)
    )) {
      return false;
    }

    const resolvedDuration = Number.isFinite(duration) ? Math.max(0.05, duration) : 0.9;
    const resolvedArcHeight = Number.isFinite(arcHeight) ? Math.max(0, arcHeight) : 1.6;
    const spin = new THREE.Vector3();
    if (Number.isFinite(spinRate)) {
      spin.set(0, spinRate, 0);
    } else {
      spin.set(
        Number.isFinite(spinRate?.x) ? spinRate.x : 0,
        Number.isFinite(spinRate?.y) ? spinRate.y : 8,
        Number.isFinite(spinRate?.z) ? spinRate.z : 0,
      );
    }

    this.externalControl = null;
    control.onRelease?.(this, owner, 'thrown');
    this.knockback.set(0, 0, 0);
    this.externalBallisticMotion = {
      owner,
      startPosition: this.root.position.clone(),
      targetPosition: new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z),
      startRotation: this.root.rotation.clone(),
      duration: resolvedDuration,
      elapsed: 0,
      arcHeight: resolvedArcHeight,
      spinRate: spin,
      onLand: typeof onLand === 'function' ? onLand : null,
    };
    return true;
  }

  cancelExternalBallisticMotion(reason = 'cancelled', game = null, options = {}) {
    const motion = this.externalBallisticMotion;
    if (!motion) {
      return false;
    }

    this.externalBallisticMotion = null;
    this.knockback.set(0, 0, 0);
    if (options.snapToTarget) {
      this.root.position.copy(motion.targetPosition);
      this.root.rotation.x = 0;
      this.root.rotation.z = 0;
    }
    motion.onLand?.(this, game, reason);
    return true;
  }

  clearExternalMotion(reason = 'cleared', game = null) {
    let cleared = false;
    if (this.externalBallisticMotion) {
      cleared = this.cancelExternalBallisticMotion(reason, game, {
        // Death must resolve where the enemy was actually struck. Snapping a
        // carried or thrown target to an old acquisition/landing point causes
        // visible warps and misplaced loot.
        snapToTarget: reason === 'dispose' || reason === 'reset',
      }) || cleared;
    }
    if (this.externalControl) {
      const { owner } = this.externalControl;
      cleared = this.releaseExternalControl(owner, reason, {
        snapToReleasePosition: reason === 'dispose' || reason === 'reset',
      }) || cleared;
    }
    return cleared;
  }

  isExternalMotionActive() {
    return Boolean(this.externalBallisticMotion || this.externalControl?.freeze);
  }

  shouldIgnoreGroundConstraint() {
    return Boolean(this.externalBallisticMotion || this.externalControl?.ignoreGroundConstraint);
  }

  _updateExternalMotion(dt, game) {
    const motion = this.externalBallisticMotion;
    if (motion) {
      motion.elapsed = Math.min(motion.duration, motion.elapsed + Math.max(0, dt));
      const progress = THREE.MathUtils.clamp(motion.elapsed / motion.duration, 0, 1);
      this.root.position.lerpVectors(motion.startPosition, motion.targetPosition, progress);
      this.root.position.y += Math.sin(progress * Math.PI) * motion.arcHeight;
      this.root.rotation.set(
        motion.startRotation.x + motion.spinRate.x * motion.elapsed,
        motion.startRotation.y + motion.spinRate.y * motion.elapsed,
        motion.startRotation.z + motion.spinRate.z * motion.elapsed,
      );
      this.knockback.set(0, 0, 0);

      if (progress >= 1) {
        this.externalBallisticMotion = null;
        this.root.position.copy(motion.targetPosition);
        this.root.rotation.x = 0;
        this.root.rotation.z = 0;
        motion.onLand?.(this, game, 'landed');
      }
      return true;
    }

    if (this.externalControl?.freeze) {
      this.knockback.set(0, 0, 0);
      return true;
    }
    return false;
  }

  takeDamage(amount, meta = {}) {
    const adjustedDamage = this.modifyDamageTaken(amount, meta);
    const effectiveArmor = Math.max(0, this.stats.armor - this._getArmorReduction() - (meta.armorPierce ?? 0));
    const mitigated = adjustedDamage * (100 / (100 + effectiveArmor));

    this.health = Math.max(0, this.health - mitigated);
    if (meta.shieldBlocked) {
      meta.hitPosition = meta.hitPosition ?? this._getGorubesshuShieldImpactPosition();
      this.gorubesshuBlockTimer = this.gorubesshuBlockDuration;
      this.hitStopTimer = Math.max(this.hitStopTimer, 0.06);
      this.hitReactDuration = 0;
      this.hitWobbleStrength = 0;
    } else if (meta.projectileHit) {
      this.flashColor.set(0xffffff);
      this.flashDuration = 0.12;
      this.flashIntensity = 1.25;
      this.hitReactDuration = 0.22;
      this.hitWobbleStrength = 0.095;
      this.hitStopTimer = Math.max(
        this.hitStopTimer,
        meta.enemyHitStopDuration ?? meta.hitStopDuration ?? 0.18,
      );
      this.hitWobbleSeed = Math.random() * Math.PI * 2;
      this.animation.playHurt(0.18);
    } else {
      this.flashColor.set(0xe61f18);
      this.flashDuration = 0.16;
      this.flashIntensity = 0.85;
      this.hitReactDuration = 0.16;
      this.hitWobbleStrength = 0;
      if ((meta.enemyHitStopDuration ?? 0) > 0) {
        this.hitStopTimer = Math.max(this.hitStopTimer, meta.enemyHitStopDuration);
      }
      this.animation.playHurt(0.14);
    }

    if (meta.shieldBlocked) {
      this.flashTimer = 0;
      this.hitReactTimer = 0;
      this._applyStatusVisuals();
    } else {
      this.flashTimer = this.flashDuration;
      this.hitReactTimer = this.hitReactDuration;
    }
    this._updateHealthBar();

    if (meta.knockbackDirection) {
      this.knockback.addScaledVector(meta.knockbackDirection, meta.knockback ?? 2.5);
    }

    if (this.health <= 0 && !this.dead) {
      this.dead = true;
      // Mark death before releasing external controllers. Release callbacks are
      // allowed to deal damage, so this prevents a lethal callback from
      // re-entering takeDamage and initializing the same death twice.
      this.clearExternalMotion('death');
      this.deathTimer = DEATH_SEQUENCE_DURATION;
      this.deathFloorY = this.root.position.y;
      this.deathStartRotation.copy(this.root.rotation);
      this.deathStartPosition.copy(this.root.position);
      this.deathLandingPosition = null;
      this.deathDropPosition = null;
      this.deathEffectTriggered = false;
      this.deathPhase = 'fall';
      this.deathLimpSettled = false;
      this.deathLastOpacity = null;
      this.healthBar.visible = false;
      this._applyRagdollPose();
      this._captureDeathLimpParts();
      this.animation.playDead();
    }

    return mitigated;
  }

  applyStatus(type, options = {}) {
    if (this.dead || !this.statusEffects[type]) {
      return false;
    }

    const eliteDurationScale = this.isElite ? 0.58 : 1;
    const effect = this.statusEffects[type];
    const duration = Math.max(0, options.duration ?? 0) * eliteDurationScale;

    if (type === 'burning') {
      effect.duration = Math.max(effect.duration, duration);
      effect.dps = Math.max(effect.dps, options.dps ?? 0);
      return true;
    }

    if (type === 'chill') {
      effect.duration = Math.max(effect.duration, duration);
      effect.slow = Math.max(effect.slow, options.slow ?? 0.35);
      effect.buildup = Math.max(0, effect.buildup + (options.buildup ?? 1));

      const threshold = this.isElite ? 4.6 : 2.8;
      if (effect.buildup >= threshold) {
        const freezeDuration = (options.freezeDuration ?? 0.9) * eliteDurationScale;
        this.statusEffects.freeze.duration = Math.max(this.statusEffects.freeze.duration, freezeDuration);
        effect.buildup *= 0.35;
      }
      return true;
    }

    if (type === 'corrosion') {
      effect.duration = Math.max(effect.duration, duration);
      effect.dps = Math.max(effect.dps, options.dps ?? 0);
      effect.armorReduction = Math.max(effect.armorReduction, options.armorReduction ?? 0);
      return true;
    }

    if (type === 'armorBreak') {
      effect.duration = Math.max(effect.duration, duration);
      effect.armorReduction = Math.max(effect.armorReduction, options.armorReduction ?? 0);
      return true;
    }

    if (type === 'shock') {
      effect.duration = Math.max(effect.duration, duration);
      this.attackCooldown = Math.max(this.attackCooldown, options.interruptTime ?? 0.18);
      return true;
    }

    if (type === 'stagger' || type === 'freeze') {
      effect.duration = Math.max(effect.duration, duration);
      return true;
    }

    return false;
  }

  hasStatus(type) {
    return (this.statusEffects[type]?.duration ?? 0) > 0;
  }

  _updateHealthBar(camera = null) {
    if (!this.healthBar) {
      return;
    }

    const healthPercent = THREE.MathUtils.clamp(this.health / this.stats.maxHealth, 0, 1);
    const fill = this.healthBar.userData.fill;

    this.healthBar.visible = !this.dead;
    fill.scale.x = healthPercent;
    fill.position.x = -0.38 * (1 - healthPercent);

    if (healthPercent < 0.3) {
      fill.material.color.set(0xff453f);
    } else if (healthPercent < 0.65) {
      fill.material.color.set(0xffa33f);
    } else {
      fill.material.color.set(0xd94b43);
    }

    if (camera) {
      this.healthBar.lookAt(camera.position);
    }
  }

  _captureMaterialStates() {
    this._materialStates.length = 0;
    this.root.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];

      for (const material of materials) {
        if (material?.emissive && !this._materialStates.some((state) => state.material === material)) {
          this._materialStates.push({
            material,
            emissive: material.emissive.clone(),
            intensity: material.emissiveIntensity ?? 0,
          });
        }
      }
    });
  }

  _applyReaverbotProceduralStyle() {
    const panelTexture = getReaverbotPanelTexture();
    const panelMaterials = [
      this.humanoid.materials.cloth,
      this.humanoid.materials.armor,
    ];

    for (const material of panelMaterials) {
      material.map = panelTexture;
      material.color.set(this.type.clothColor ?? 0x4d5532);
      material.roughness = Math.max(material.roughness ?? 0.62, 0.68);
      material.metalness = Math.max(material.metalness ?? 0.04, 0.12);
      material.needsUpdate = true;
    }

    this.humanoid.materials.skin.color.set(this.type.skinColor ?? 0x87935f);
    this.humanoid.materials.skin.map = panelTexture;
    this.humanoid.materials.skin.roughness = 0.72;
    this.humanoid.materials.skin.needsUpdate = true;

    const leftEye = this.root.getObjectByName('leftEye');
    const rightEye = this.root.getObjectByName('rightEye');
    if (leftEye) leftEye.visible = false;
    if (rightEye) rightEye.visible = false;

    const socketMaterial = new THREE.MeshStandardMaterial({
      color: 0x171412,
      emissive: 0x050000,
      roughness: 0.42,
      metalness: 0.38,
    });
    socketMaterial.name = 'material_reaverbotEyeSocket';

    const eyeMaterial = new THREE.MeshStandardMaterial({
      color: this.type.eyeColor ?? 0xff245b,
      emissive: this.type.eyeColor ?? 0xff245b,
      emissiveIntensity: 1.35,
      roughness: 0.18,
      metalness: 0.08,
    });
    eyeMaterial.name = 'material_reaverbotRedEye';

    const glintMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd9a6,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    glintMaterial.name = 'material_reaverbotEyeGlint';

    const eyeGroup = new THREE.Group();
    eyeGroup.name = 'reaverbotRedEyeMotif';
    eyeGroup.position.set(0, 0.07, 0.36);

    const socket = new THREE.Mesh(new THREE.CircleGeometry(0.105, 24), socketMaterial);
    socket.name = 'reaverbotRedEyeSocket';

    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.066, 24), eyeMaterial);
    lens.name = 'reaverbotRedEyeLens';
    lens.position.z = 0.006;

    const glint = new THREE.Mesh(new THREE.CircleGeometry(0.014, 10), glintMaterial);
    glint.name = 'reaverbotRedEyeGlint';
    glint.position.set(0.024, 0.024, 0.012);

    eyeGroup.add(socket, lens, glint);
    this.humanoid.headGroup.add(eyeGroup);

    const panelMaterial = new THREE.MeshStandardMaterial({
      color: 0x30391f,
      map: panelTexture,
      roughness: 0.7,
      metalness: 0.14,
    });
    panelMaterial.name = 'material_reaverbotChestPanel';

    const lineMaterial = new THREE.MeshBasicMaterial({
      color: 0x9aa06a,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    lineMaterial.name = 'material_reaverbotCircuitLines';

    const chestPanel = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.34, 0.026), panelMaterial);
    chestPanel.name = 'reaverbotTextureSheetChestPanel';
    chestPanel.position.set(0, 2.1, 0.235);
    chestPanel.castShadow = true;

    const horizontalLine = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.018, 0.008), lineMaterial);
    horizontalLine.name = 'reaverbotCircuitLineHorizontal';
    horizontalLine.position.set(0, 2.15, 0.253);

    const verticalLine = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.22, 0.008), lineMaterial);
    verticalLine.name = 'reaverbotCircuitLineVertical';
    verticalLine.position.set(-0.14, 2.06, 0.256);

    this.humanoid.bodyGroup.add(chestPanel, horizontalLine, verticalLine);
  }

  _loadModelVisualIfNeeded() {
    const loaders = {
      horokko: loadHorokkoModelTemplate,
      gorubesshu: loadGorubesshuModelTemplate,
    };
    const loadModel = loaders[this.type.modelAsset];

    if (!loadModel) {
      return;
    }

    loadModel().then((template) => {
      if (!template || this.dead || this.disposed) {
        return;
      }

      const visual = template.clone(true);
      visual.name = `${this.type.modelAsset}ReaverbotModel`;
      visual.traverse((object) => {
        if (!object.isMesh || !object.material) {
          return;
        }

        if (Array.isArray(object.material)) {
          object.material = object.material.map((material) => material.clone());
        } else {
          object.material = object.material.clone();
        }
      });

      this.gorubesshuRig = this.type.modelAsset === 'gorubesshu'
        ? bindGorubesshuRig(visual)
        : null;
      this._fitExternalModelVisual(visual, this.type.modelHeight ?? HOROKKO_TARGET_HEIGHT);
      this._setProceduralHumanoidVisible(false);
      this._captureMaterialStates();
    });
  }

  _fitExternalModelVisual(visual, targetHeight) {
    if (this.externalModelGroup) {
      this.externalModelGroup.removeFromParent();
    }

    const group = new THREE.Group();
    group.name = 'enemyExternalModelGroup';
    visual.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(visual);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = size.y > 0 ? targetHeight / size.y : 1;
    visual.scale.setScalar(scale);
    visual.updateMatrixWorld(true);

    const scaledBounds = new THREE.Box3().setFromObject(visual);
    const center = scaledBounds.getCenter(new THREE.Vector3());
    visual.position.set(-center.x, -scaledBounds.min.y, -center.z);

    group.rotation.y = this.type.modelYawOffset ?? Math.PI;
    group.add(visual);
    this.root.add(group);
    this.externalModelGroup = group;
    this.externalModelVisual = visual;
    this.externalModelBaseY = group.position.y;
  }

  _setProceduralHumanoidVisible(visible) {
    const groups = [
      this.humanoid.bodyGroup,
      this.humanoid.headGroup,
      this.humanoid.hairGroup,
      this.humanoid.armorGroup,
      this.humanoid.equipmentGroup,
    ];

    for (const group of groups) {
      if (group) {
        group.visible = visible;
      }
    }
  }

  _updateExternalModelVisual(dt, moving) {
    if (!this.externalModelGroup) {
      return;
    }

    this._externalModelTime += dt * (moving ? 8.4 : 2.4);
    const bob = Math.sin(this._externalModelTime) * (moving ? 0.045 : 0.018);
    const tilt = Math.sin(this._externalModelTime * 0.55) * (moving ? 0.08 : 0.025);
    const attackPose = this.type.modelAsset === 'gorubesshu'
      ? this._getGorubesshuAttackPose()
      : this._getHorokkoAttackPose();
    const yawOffset = this.type.modelYawOffset ?? Math.PI;
    this.externalModelGroup.position.y = this.externalModelBaseY + bob + attackPose.lift;
    this.externalModelGroup.rotation.x = attackPose.rear;
    this.externalModelGroup.rotation.y = yawOffset + (attackPose.yaw ?? 0);
    this.externalModelGroup.rotation.z = tilt + attackPose.shake + (attackPose.roll ?? 0);

    if (this.type.modelAsset === 'gorubesshu') {
      this._updateGorubesshuRigPose(moving);
    }
  }

  _getHorokkoAttackPose() {
    if (this.type.modelAsset !== 'horokko' || !this.horokkoAttack.active) {
      return { rear: 0, shake: 0, lift: 0 };
    }

    const attack = this.horokkoAttack;
    const progress = THREE.MathUtils.clamp(attack.timer / attack.duration, 0, 1);
    const rearUp = THREE.MathUtils.smoothstep(progress, 0.16, 0.42);
    const settle = 1 - THREE.MathUtils.smoothstep(progress, 0.7, 1);
    const shakeWindow = 1 - THREE.MathUtils.smoothstep(progress, 0.04, 0.34);
    const rearPose = rearUp * settle;

    return {
      rear: -1.55 * rearPose,
      lift: 0.28 * rearPose,
      shake: Math.sin(attack.timer * 82) * 0.2 * shakeWindow,
    };
  }

  _resetHorokkoAttackPose() {
    if (!this.externalModelGroup) {
      return;
    }

    this.externalModelGroup.rotation.x = 0;
    this.externalModelGroup.rotation.y = this.type.modelYawOffset ?? Math.PI;
    this.externalModelGroup.rotation.z = 0;
    this.externalModelGroup.position.y = this.externalModelBaseY;
  }

  _getGorubesshuAttackPose() {
    if (this.type.modelAsset !== 'gorubesshu') {
      return { rear: 0, shake: 0, lift: 0, yaw: 0, roll: 0 };
    }

    const attack = this.gorubesshuAttack;
    if (!attack.active) {
      return {
        rear: -0.08,
        shake: 0,
        lift: 0,
        yaw: 0,
        roll: Math.sin(this._externalModelTime * 0.7) * 0.02,
      };
    }

    const progress = THREE.MathUtils.clamp(attack.timer / attack.duration, 0, 1);
    const open = THREE.MathUtils.smoothstep(progress, 0.08, 0.22)
      * (1 - THREE.MathUtils.smoothstep(progress, 0.78, 1));
    const flameWindow = progress >= attack.flameStart / attack.duration
      && progress <= attack.flameEnd / attack.duration
      ? 1
      : 0;

    return {
      rear: THREE.MathUtils.lerp(-0.1, 0.18, open),
      lift: 0.02 * open,
      yaw: Math.sin(attack.timer * 5.2) * 0.16 * flameWindow,
      roll: Math.sin(attack.timer * 9) * 0.045 * flameWindow,
      shake: Math.sin(attack.timer * 64) * 0.035 * flameWindow,
    };
  }

  _updateGorubesshuRigPose(moving) {
    const rig = this.gorubesshuRig;

    if (!rig) {
      return;
    }

    const attack = this.gorubesshuAttack;
    const progress = attack.active ? THREE.MathUtils.clamp(attack.timer / attack.duration, 0, 1) : 0;
    const flameStartProgress = attack.flameStart / attack.duration;
    const flameEndProgress = attack.flameEnd / attack.duration;
    const shieldAside = attack.active
      ? THREE.MathUtils.smoothstep(progress, 0.08, 0.24) * (1 - THREE.MathUtils.smoothstep(progress, 0.76, 0.98))
      : 0;
    const flameExtend = attack.active
      ? THREE.MathUtils.smoothstep(progress, flameStartProgress - 0.06, flameStartProgress + 0.08)
        * (1 - THREE.MathUtils.smoothstep(progress, flameEndProgress - 0.04, flameEndProgress + 0.1))
      : 0;
    const blockRatio = this.gorubesshuBlockDuration > 0
      ? THREE.MathUtils.clamp(this.gorubesshuBlockTimer / this.gorubesshuBlockDuration, 0, 1)
      : 0;
    const blockPop = Math.sin(blockRatio * Math.PI);
    const guard = Math.max(blockRatio, 1 - shieldAside * 0.9);
    const idleSway = Math.sin(this._externalModelTime * (moving ? 1.7 : 0.8));
    const flameShake = flameExtend * Math.sin(attack.timer * 52) * 0.035;

    setGorubesshuPartPose(
      rig.torso,
      0,
      0,
      0,
      -0.04 + flameExtend * 0.06,
      flameExtend * 0.18,
      idleSway * 0.018 + flameShake,
    );
    setGorubesshuPartPose(
      rig.head,
      0,
      0,
      0,
      -0.02,
      flameExtend * -0.08,
      idleSway * 0.012,
    );
    setGorubesshuPartPose(
      rig.shieldArm,
      guard * 7.2 - shieldAside * 10.5,
      guard * 1.7 + blockPop * 1.35,
      -guard * 11.8 + shieldAside * 5.8 - blockPop * 1.8,
      guard * 0.16 - shieldAside * 0.24,
      -guard * 1.05 + shieldAside * 1.35,
      guard * 0.42 - shieldAside * 0.62 + blockPop * 0.18,
    );
    setGorubesshuPartPose(
      rig.flameArm,
      -flameExtend * 2.5,
      flameExtend * 1.6,
      -flameExtend * 14.5,
      -flameExtend * 0.22,
      flameExtend * -0.24,
      flameExtend * -0.28 + flameShake,
    );
    setGorubesshuPartPose(
      rig.leftLeg,
      0,
      0,
      0,
      flameExtend * 0.08,
      0,
      flameExtend * 0.05,
    );
    setGorubesshuPartPose(
      rig.rightLeg,
      0,
      0,
      0,
      flameExtend * -0.05,
      0,
      flameExtend * -0.04,
    );
  }

  _updateStatusEffects(dt, game) {
    const burn = this.statusEffects.burning;
    if (burn.duration > 0) {
      burn.duration = Math.max(0, burn.duration - dt);
      burn.tickTimer += dt;

      if (burn.tickTimer >= 0.38 && burn.dps > 0) {
        const tickDamage = burn.dps * burn.tickTimer;
        burn.tickTimer = 0;
        game.damageEnemy(this, tickDamage, {
          source: game.player,
          element: 'fire',
          statusTick: true,
        });
      }
    } else {
      burn.dps = 0;
      burn.tickTimer = 0;
    }

    const corrosion = this.statusEffects.corrosion;
    if (corrosion.duration > 0) {
      corrosion.duration = Math.max(0, corrosion.duration - dt);
      corrosion.tickTimer += dt;

      if (corrosion.tickTimer >= 0.45 && corrosion.dps > 0) {
        const tickDamage = corrosion.dps * corrosion.tickTimer;
        corrosion.tickTimer = 0;
        game.damageEnemy(this, tickDamage, {
          source: game.player,
          element: 'corrosion',
          statusTick: true,
        });
      }
    } else {
      corrosion.dps = 0;
      corrosion.armorReduction = 0;
      corrosion.tickTimer = 0;
    }

    const chill = this.statusEffects.chill;
    if (chill.duration > 0) {
      chill.duration = Math.max(0, chill.duration - dt);
    } else {
      chill.slow = 0;
      chill.buildup = Math.max(0, chill.buildup - dt * 0.9);
    }

    for (const key of ['freeze', 'shock', 'armorBreak', 'stagger']) {
      const effect = this.statusEffects[key];
      if (effect.duration > 0) {
        effect.duration = Math.max(0, effect.duration - dt);
      }

      if (key === 'armorBreak' && effect.duration <= 0) {
        effect.armorReduction = 0;
      }
    }
  }

  _getStatusMoveMultiplier() {
    if (this.statusEffects.freeze.duration > 0) {
      return 0;
    }

    const chillSlow = this.statusEffects.chill.duration > 0 ? this.statusEffects.chill.slow : 0;
    return THREE.MathUtils.clamp(1 - chillSlow, 0.24, 1);
  }

  _getStatusAttackRateMultiplier() {
    if (this.statusEffects.freeze.duration > 0 || this.statusEffects.shock.duration > 0) {
      return 0;
    }

    const chillSlow = this.statusEffects.chill.duration > 0 ? this.statusEffects.chill.slow * 0.65 : 0;
    return THREE.MathUtils.clamp(1 - chillSlow, 0.35, 1);
  }

  _isControlLocked() {
    return this.statusEffects.freeze.duration > 0
      || this.statusEffects.shock.duration > 0
      || this.statusEffects.stagger.duration > 0;
  }

  _updateHorokkoAttack(dt, game, facingDirection) {
    const attack = this.horokkoAttack;

    if (this.type.modelAsset !== 'horokko' || !attack.active) {
      return false;
    }

    attack.timer += dt;

    if (facingDirection?.lengthSq?.() > 0.001) {
      attack.direction.copy(facingDirection);
    }

    if (!attack.fired && attack.timer >= attack.fireTime) {
      attack.fired = true;
      this._fireHorokkoLob(game, attack.direction, attack.targetPosition);
    }

    if (attack.timer >= attack.duration) {
      attack.active = false;
      attack.timer = 0;
      attack.fired = false;
      this._resetHorokkoAttackPose();
      game.completeEnemyAttack?.(this);
    }

    return true;
  }

  _startHorokkoAttack(game, direction) {
    const attack = this.horokkoAttack;
    attack.active = true;
    attack.timer = 0;
    attack.fired = false;
    attack.direction.copy(direction).normalize();
    attack.targetPosition.copy(game.player.root.position);
    this.animation.playAttack(attack.duration);
    game.addParticleBurst(this.root.position.clone().add(new THREE.Vector3(0, 0.45, 0)), 0xff365f, 4, 0.08);
  }

  _fireHorokkoLob(game, direction, targetPosition) {
    tempPosition.copy(this.root.position).add(new THREE.Vector3(0, 0.72, 0));
    const target = targetPosition.clone();
    target.y += 0.12;

    tempDirection.copy(target).sub(tempPosition);
    tempDirection.y = 0;
    const distance = Math.max(1.2, tempDirection.length());

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.copy(direction);
    }

    tempDirection.normalize();

    game.projectiles.spawn({
      owner: 'enemy',
      position: tempPosition,
      direction: tempDirection.clone(),
      speed: this.type.projectileSpeed ?? 5.4,
      range: distance + 0.35,
      radius: 0.22,
      damage: this.stats.damage,
      color: 0xff3b5d,
      source: this,
      explosiveRadius: this.type.explosiveRadius ?? 1.05,
      explodeOnExpire: true,
      arcHeight: (this.type.lobArcHeight ?? 1.35) + Math.min(distance * 0.08, 0.65),
      endY: target.y,
      visualType: 'grenade',
    });
    game.addParticleBurst(tempPosition, 0xff365f, 9, 0.11);
  }

  _updateGorubesshuAttack(dt, game, facingDirection) {
    const attack = this.gorubesshuAttack;

    if (this.type.modelAsset !== 'gorubesshu' || !attack.active) {
      return false;
    }

    attack.timer += dt;

    if (facingDirection?.lengthSq?.() > 0.001) {
      attack.direction.copy(facingDirection).normalize();
    }

    const flameActive = attack.timer >= attack.flameStart && attack.timer <= attack.flameEnd;
    const telegraphActive = attack.timer >= Math.max(0, attack.flameStart - 0.22) && attack.timer <= attack.flameEnd;

    if (telegraphActive) {
      this._getGorubesshuFlameOrigin(tempPosition, attack.direction);

      attack.telegraphTimer -= dt;
      if (attack.telegraphTimer <= 0) {
        attack.telegraphTimer = flameActive ? 0.065 : 0.08;
        game.addGroundConeTelegraph(tempPosition, attack.direction, this.stats.attackRange * 1.04, 0.82, 0xff6a2e, {
          duration: flameActive ? 0.18 : 0.12,
          opacity: flameActive ? 0.34 : 0.18,
          startDistance: 0.12,
          name: 'gorubesshuFlamethrowerCone',
        });
      }
    }

    if (flameActive) {
      attack.particleTimer -= dt;
      if (attack.particleTimer <= 0) {
        attack.particleTimer = 0.03;
        game.addDirectedParticleSpray(tempPosition, attack.direction, 0xff6a2e, {
          count: 14,
          range: this.stats.attackRange * 1.04,
          halfAngle: 0.86,
          baseScale: 0.32,
          pressure: 1,
        });
        game.addDirectedParticleSpray(tempPosition, attack.direction, 0xffd36f, {
          count: 5,
          range: this.stats.attackRange * 0.82,
          halfAngle: 0.62,
          baseScale: 0.2,
          pressure: 1,
        });
      }

      attack.tickTimer -= dt;
      if (attack.tickTimer <= 0) {
        attack.tickTimer = 0.15;
        this._damagePlayerInFlameCone(game, tempPosition, attack.direction);
      }
    }

    if (attack.timer >= attack.duration) {
      attack.active = false;
      attack.timer = 0;
      attack.tickTimer = 0;
      attack.particleTimer = 0;
      attack.telegraphTimer = 0;
      this._resetHorokkoAttackPose();
      game.completeEnemyAttack?.(this);
    }

    return true;
  }

  _startGorubesshuAttack(game, direction) {
    const attack = this.gorubesshuAttack;
    attack.active = true;
    attack.timer = 0;
    attack.tickTimer = 0;
    attack.particleTimer = 0;
    attack.telegraphTimer = 0;
    attack.direction.copy(direction).normalize();
    this.animation.playAttack(attack.duration);
    game.addParticleBurst(this.root.position.clone().add(new THREE.Vector3(0, 0.75, 0)), 0xff9d4f, 8, 0.12);
  }

  _getGorubesshuFlameOrigin(target, direction) {
    if (this.gorubesshuRig?.muzzle) {
      this.gorubesshuRig.muzzle.getWorldPosition(target);
      target.y = Math.max(target.y, 0.52);
      return target;
    }

    target.copy(this.root.position).addScaledVector(direction, 0.72);
    target.y = 0.58;
    return target;
  }

  _damagePlayerInFlameCone(game, origin, direction) {
    const player = game.player;
    if (player.dead) {
      return;
    }

    tempHitVector.copy(player.root.position).sub(origin);
    tempHitVector.y = 0;
    const distance = tempHitVector.length();
    const range = this.stats.attackRange * 1.02 + player.radius;

    if (distance <= 0.001 || distance > range) {
      return;
    }

    tempHitVector.divideScalar(distance);
    if (tempHitVector.dot(direction) < Math.cos(0.82)) {
      return;
    }

    const dealt = player.takeDamage(this.stats.damage * 0.22, this);
    this.onHitPlayer(player, dealt);
    game.addHitEffect(player.root.position, 0xff6a2e, 0.42);
  }

  _getArmorReduction() {
    let reduction = 0;

    if (this.statusEffects.corrosion.duration > 0) {
      reduction += this.statusEffects.corrosion.armorReduction;
    }

    if (this.statusEffects.armorBreak.duration > 0) {
      reduction += this.statusEffects.armorBreak.armorReduction;
    }

    return reduction;
  }

  isAttackLeaseActive() {
    return Boolean(this.horokkoAttack?.active || this.gorubesshuAttack?.active);
  }

  _applyStatusVisuals() {
    const color = this._getStatusVisualColor();

    for (const state of this._materialStates) {
      if (!color) {
        state.material.emissive.copy(state.emissive);
        state.material.emissiveIntensity = state.intensity;
        continue;
      }

      state.material.emissive.copy(color);
      state.material.emissiveIntensity = Math.max(state.intensity, 0.16);
    }
  }

  _getStatusVisualColor() {
    if (this.statusEffects.freeze.duration > 0 || this.statusEffects.chill.duration > 0) {
      return statusColor.set(0x78d8ff);
    }

    if (this.statusEffects.shock.duration > 0) {
      return statusColor.set(0xa6f7ff);
    }

    if (this.statusEffects.burning.duration > 0) {
      return statusColor.set(0xff6a2e);
    }

    if (this.statusEffects.corrosion.duration > 0) {
      return statusColor.set(0xa6e86f);
    }

    if (this.statusEffects.armorBreak.duration > 0) {
      return statusColor.set(0xffd36f);
    }

    return null;
  }

  _applyRagdollPose() {
    const joints = this.humanoid.joints;
    const limp = [
      ['leftShoulder', -0.6, 0.15, 0.75],
      ['rightShoulder', -0.6, -0.15, -0.75],
      ['leftElbow', 0.75, 0.2, 0.15],
      ['rightElbow', 0.75, -0.2, -0.15],
      ['leftHip', 0.45, 0.15, 0.2],
      ['rightHip', -0.25, -0.15, -0.2],
      ['leftKnee', 0.8, 0, 0.1],
      ['rightKnee', 0.55, 0, -0.1],
      ['neck', -0.35, 0, 0.18],
    ];

    for (const [name, x, y, z] of limp) {
      const joint = joints.get(name);
      if (joint) {
        joint.rotation.set(
          x + (Math.random() - 0.5) * 0.35,
          y + (Math.random() - 0.5) * 0.25,
          z + (Math.random() - 0.5) * 0.35,
        );
      }
    }
  }

  _captureDeathLimpParts() {
    const candidates = [];
    const seen = new Set();
    const addCandidate = (object) => {
      if (!object || object === this.root || seen.has(object)) return;
      seen.add(object);
      candidates.push(object);
    };

    if (this.visual?.frame) {
      for (const limb of this.visual.frame.limbs ?? []) addCandidate(limb.pivot);
      for (const wing of this.visual.frame.wings ?? []) addCandidate(wing.pivot);
      addCandidate(this.visual.frame.headAssembly ?? this.visual.frame.head);
      addCandidate(this.visual.frame.tailPivot);
    } else {
      const limpJointNames = [
        'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
        'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'neck',
      ];
      for (const name of limpJointNames) addCandidate(this.humanoid?.joints?.get(name));
    }

    this.deathLimpParts = candidates.slice(0, 10).map((object, index) => {
      const side = index % 2 === 0 ? -1 : 1;
      return {
        object,
        baseRotation: object.rotation.clone(),
        phase: this.hitWobbleSeed + index * 1.37,
        sagX: 0.2 + (index % 3) * 0.075,
        sagY: side * (0.04 + (index % 2) * 0.035),
        sagZ: side * (0.16 + (index % 4) * 0.045),
      };
    });
  }

  _updateDeathLimpPose(progress) {
    if (progress >= 1 && this.deathLimpSettled) return;
    const settle = THREE.MathUtils.smoothstep(progress, 0, 1);
    const looseSwing = Math.sin(progress * Math.PI * 2.4) * (1 - settle);
    for (const part of this.deathLimpParts) {
      if (!part.object?.parent) continue;
      const flutter = Math.sin(progress * Math.PI * 3.2 + part.phase) * (1 - settle) * 0.12;
      part.object.rotation.set(
        part.baseRotation.x + part.sagX * settle + looseSwing * 0.08 + flutter,
        part.baseRotation.y + part.sagY * settle,
        part.baseRotation.z + part.sagZ * settle + flutter * 0.8,
      );
    }
    if (progress >= 1) this.deathLimpSettled = true;
  }

  _updateDeath(dt, game) {
    this.deathTimer = Math.max(0, this.deathTimer - dt);
    const elapsed = DEATH_SEQUENCE_DURATION - this.deathTimer;
    const fallProgress = THREE.MathUtils.clamp(elapsed / DEATH_LIMP_FALL_DURATION, 0, 1);
    const fallEase = 1 - Math.pow(1 - fallProgress, 3);
    const postFallElapsed = Math.max(0, elapsed - DEATH_LIMP_FALL_DURATION);
    const fadeProgress = THREE.MathUtils.clamp(postFallElapsed / DEATH_BODY_FADE_DURATION, 0, 1);
    const fade = 1 - THREE.MathUtils.smoothstep(fadeProgress, 0, 1);

    const limpTumble = Math.sin(fallProgress * Math.PI * 2.2 + this.hitWobbleSeed)
      * (1 - fallProgress) * 0.12;
    this.root.rotation.x = THREE.MathUtils.lerp(this.deathStartRotation.x, this.deathFallAxis.z * Math.PI * 0.5, fallEase) + limpTumble;
    this.root.rotation.z = THREE.MathUtils.lerp(this.deathStartRotation.z, -this.deathFallAxis.x * Math.PI * 0.5, fallEase) - limpTumble * 0.7;
    this._updateDeathLimpPose(fallProgress);
    if (this.deathLandingPosition) {
      tempPosition.copy(this.deathLandingPosition);
      tempPosition.y -= 0.08;
      this.root.position.lerpVectors(this.deathStartPosition, tempPosition, fallEase);
    } else {
      const deathFloorY = this.deathFloorY ?? this.root.position.y;
      this.root.position.y = THREE.MathUtils.lerp(this.root.position.y, deathFloorY - 0.08, Math.min(1, dt * 5));
    }

    if (fallProgress >= 1 && !this.deathEffectTriggered && game?.addEnemyDeathEffect) {
      this.deathEffectTriggered = game.addEnemyDeathEffect(this) !== false;
      this.deathPhase = 'burst';
    } else if (fallProgress < 1) {
      this.deathPhase = 'fall';
    } else if (fadeProgress >= 1) {
      this.deathPhase = 'debris';
    }

    if (this.deathLastOpacity === null
      || Math.abs(fade - this.deathLastOpacity) >= 0.012
      || (fade === 0 && this.deathLastOpacity !== 0)) {
      setObjectOpacity(this.root, fade);
      this.deathLastOpacity = fade;
    }
  }

  modifyDamageTaken(amount, meta = {}) {
    if (this._isGorubesshuBlocking(meta)) {
      meta.shieldBlocked = true;
      return amount * (this.type.shieldBlockMultiplier ?? 0.24);
    }

    return amount;
  }

  _isGorubesshuBlocking(meta = {}) {
    if (this.type.modelAsset !== 'gorubesshu' || this.dead || this.gorubesshuAttack.active || meta.unblockable) {
      return false;
    }

    if (!meta.knockbackDirection || meta.knockbackDirection.lengthSq?.() <= 0.001) {
      return true;
    }

    tempForward.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y)).normalize();
    tempHitVector.copy(meta.knockbackDirection).setY(0);
    if (tempHitVector.lengthSq() <= 0.001) {
      return true;
    }

    tempHitVector.normalize();
    return tempForward.dot(tempHitVector) < -0.2;
  }

  _getGorubesshuShieldImpactPosition() {
    const impact = new THREE.Vector3();

    if (this.gorubesshuRig?.shieldArm) {
      this.gorubesshuRig.shieldArm.getWorldPosition(impact);
      tempForward.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y)).normalize();
      impact.addScaledVector(tempForward, 0.34);
      impact.y = Math.max(impact.y, 0.78);
      return impact;
    }

    impact.copy(this.root.position);
    impact.y += 0.82;
    tempForward.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y)).normalize();
    impact.addScaledVector(tempForward, 0.42);
    return impact;
  }

  onHitPlayer(player) {
    return player;
  }

  onDeath(game) {
    game?.cancelEnemyAttackRequest?.(this);
    return game;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.dead = true;
    this._runtimeGame?.cancelEnemyAttackRequest?.(this);
    this.clearExternalMotion?.('dispose');

    const geometries = new Set();
    const materials = new Set();
    this.root?.traverse?.((object) => {
      let current = object;
      let belongsToCachedExternalModel = false;
      while (current) {
        if (current === this.externalModelGroup) {
          belongsToCachedExternalModel = true;
          break;
        }
        if (current === this.root) break;
        current = current.parent;
      }
      if (object.geometry && !belongsToCachedExternalModel) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) {
        if (material) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose?.();
    for (const material of materials) material.dispose?.();
    this._materialStates.length = 0;
  }

  _attack(game, direction) {
    if (this.type.modelAsset === 'horokko') {
      if (!this.horokkoAttack.active) {
        this._startHorokkoAttack(game, direction);
      }
      return;
    }

    if (this.type.modelAsset === 'gorubesshu') {
      if (!this.gorubesshuAttack.active) {
        this._startGorubesshuAttack(game, direction);
      }
      return;
    }

    this.animation.playAttack(this.type.ranged ? 0.42 : 0.32);

    if (this.type.ranged) {
      tempPosition.copy(this.root.position).add(new THREE.Vector3(0, 1.1, 0));
      tempHitVector.copy(game.player.root.position);
      tempHitVector.y += 1.25;
      tempHitVector.sub(tempPosition).normalize();
      game.projectiles.spawn({
        owner: 'enemy',
        position: tempPosition,
        direction: tempHitVector,
        speed: this.type.projectileSpeed ?? 6,
        range: this.stats.attackRange + 1.5,
        radius: 0.18,
        damage: this.stats.damage,
        color: 0xd464ff,
        source: this,
      });
      return;
    }

    const dealt = game.player.takeDamage(this.stats.damage, this);
    this.onHitPlayer(game.player, dealt);
    game.addHitEffect(game.player.root.position, 0xff695c, 0.55);
    if (dealt > 0) {
      game.requestHitStop?.(0.08, { timeScale: 0.05 });
    }
  }
}
