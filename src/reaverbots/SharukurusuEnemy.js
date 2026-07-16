import * as THREE from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js';
import { Enemy } from '../Enemy.js';

const ASSET_PATH = './assets/models/reaverbots/';
const MODEL_FILE = 'Sharukurusu.dae';
const TARGET_HEIGHT = 2.42;
const CHARGE_WINDUP_TIME = 0.34;
const CHARGE_TIME = 0.9;
const DIVE_WINDUP_TIME = 0.32;
const DIVE_TIME = 0.78;
const KNOCKDOWN_TIME = 1.05;
const BACKFLIP_TIME = 0.72;
const DIVE_HEIGHT = 2.35;
const BACKFLIP_HEIGHT = 1.15;
const AUTHORED_HALF_WIDTH = 1.32;
const HEAD_BONE_NAME = 'SharukurusuHeadPivot';
const HEAD_PIVOT_Y = 19.9;
const DIVE_BODY_PITCH = 0.78;
const HEAD_TRACK_YAW_LIMIT = 0.62;
const HEAD_VERTEX_KEYS = new Set([
  '4.30|48.15|5.90',
  '-4.30|48.15|5.90',
  '0.00|58.80|0.10',
  '0.00|48.15|-7.30',
  '6.95|48.15|-2.25',
  '-6.95|48.15|-2.25',
  '-10.60|19.90|-3.45',
  '-6.55|19.90|9.05',
  '0.00|19.90|-11.15',
  '10.60|19.90|-3.45',
  '6.55|19.90|9.05',
]);
const CHARGE_ARM_LUNGE_ANGLE = -1.38;
const CHARGE_LEAD_THIGH_ANGLE = -0.38;
const CHARGE_LEAD_SHIN_ANGLE = 0.78;
const CHARGE_LEAD_FOOT_ANGLE = -0.26;
const CHARGE_TRAIL_THIGH_ANGLE = 0.72;
const CHARGE_TRAIL_SHIN_ANGLE = -0.18;
const CHARGE_TRAIL_FOOT_ANGLE = -0.12;
// The airborne flip pivot and abdomen together pitch the skeleton forward by
// 1.10 radians, so these values intentionally counter-rotate past that pose.
const DIVE_WINDUP_ARM_LUNGE_ANGLE = -1.72;
const DIVE_AIRBORNE_ARM_LUNGE_ANGLE = -2.5;
const DIVE_TRAIL_THIGH_ANGLE = 0.17;
const DIVE_TRAIL_SHIN_ANGLE = -0.18;
const DIVE_TRAIL_FOOT_ANGLE = -0.08;

export const SHARUKURUSU_STATES = Object.freeze({
  NinjaRun: 'ninjaRun',
  ChargeWindup: 'chargeWindup',
  DrillCharge: 'drillCharge',
  DiveWindup: 'diveWindup',
  DiveAirborne: 'diveAirborne',
  KnockedDown: 'knockedDown',
  Backflip: 'backflip',
});

const BONE_NAMES = Object.freeze({
  abdomen: ['Bone000', 'joint1'],
  head: [HEAD_BONE_NAME],
  leftThigh: ['Bone008', 'joint2'],
  leftShin: ['Bone009', 'joint3'],
  leftFoot: ['Bone010', 'joint4'],
  rightThigh: ['Bone005', 'joint5'],
  rightShin: ['Bone006', 'joint6'],
  rightFoot: ['Bone007', 'joint7'],
  leftUpperArm: ['Bone003', 'joint8'],
  leftDrill: ['Bone004', 'joint9'],
  rightUpperArm: ['Bone001', 'joint10'],
  rightDrill: ['Bone002', 'joint11'],
});

const tempDirection = new THREE.Vector3();
const tempPerpendicular = new THREE.Vector3();
const tempTarget = new THREE.Vector3();
const tempCandidate = new THREE.Vector3();
const tempAirborneStart = new THREE.Vector3();
const tempAirborneEnd = new THREE.Vector3();
const tempAttackOrigin = new THREE.Vector3();
const tempAttackTarget = new THREE.Vector3();
const tempAttackBodyAnchor = new THREE.Vector3();
const tempLeftDrillWorld = new THREE.Vector3();
const tempRightDrillWorld = new THREE.Vector3();
const tempLeftShoulderWorld = new THREE.Vector3();
const tempLeftElbowWorld = new THREE.Vector3();
const tempRightShoulderWorld = new THREE.Vector3();
const tempRightElbowWorld = new THREE.Vector3();
const tempSegmentDelta = new THREE.Vector3();

function isResolvedPlayerContact(result) {
  return Boolean(result?.contacted && !result.dodged && !result.immune);
}
const tempPointDelta = new THREE.Vector3();
const tempLineSample = new THREE.Vector3();
const tempLineDirection = new THREE.Vector3();
const tempLineEnd = new THREE.Vector3();
const tempClosestFirstDelta = new THREE.Vector3();
const tempClosestSecondDelta = new THREE.Vector3();
const tempClosestOriginDelta = new THREE.Vector3();
const tempClosestFirstPoint = new THREE.Vector3();
const tempClosestSecondPoint = new THREE.Vector3();
const tempClosestSegmentResult = { distanceSquared: Infinity, firstRatio: 0, secondRatio: 0 };
const tempChargeDelta = new THREE.Vector3();
const tempChargeTipEnd = new THREE.Vector3();
const tempHeadLookDirection = new THREE.Vector3();
const tempSharukurusuArmSegments = [
  { id: 'leftDrill', start: tempLeftElbowWorld, end: tempLeftDrillWorld, radius: 0.34 },
  { id: 'leftUpperArm', start: tempLeftShoulderWorld, end: tempLeftElbowWorld, radius: 0.42 },
  { id: 'rightDrill', start: tempRightElbowWorld, end: tempRightDrillWorld, radius: 0.34 },
  { id: 'rightUpperArm', start: tempRightShoulderWorld, end: tempRightElbowWorld, radius: 0.42 },
];
let sharukurusuTemplatePromise = null;

function findNamedObject(root, names) {
  for (const name of names) {
    const object = root.getObjectByName(name);
    if (object) return object;
  }
  return null;
}

function createSharukurusuMaterial(source) {
  const material = new THREE.MeshStandardMaterial({
    name: source?.name ?? 'Sharukurusu metal',
    color: source?.color?.clone?.() ?? new THREE.Color(0xffffff),
    map: source?.map ?? null,
    emissive: source?.emissive?.clone?.() ?? new THREE.Color(0x000000),
    emissiveMap: source?.emissiveMap ?? null,
    opacity: source?.opacity ?? 1,
    transparent: Boolean(source?.transparent),
    alphaTest: source?.map ? Math.max(0.02, source.alphaTest ?? 0) : (source?.alphaTest ?? 0),
    side: THREE.FrontSide,
    roughness: 0.58,
    metalness: 0.18,
    vertexColors: Boolean(source?.vertexColors),
    flatShading: Boolean(source?.flatShading),
    depthWrite: source?.depthWrite ?? true,
    depthTest: source?.depthTest ?? true,
  });
  return material;
}

function getAuthoredVertexKey(position, vertex) {
  return [position.getX(vertex), position.getY(vertex), position.getZ(vertex)]
    .map((value) => value.toFixed(2))
    .join('|');
}

function addSharukurusuHeadPivot(model) {
  const abdomen = findNamedObject(model, BONE_NAMES.abdomen);
  if (!abdomen || findNamedObject(model, BONE_NAMES.head)) return;

  // The source rig gives the disconnected ruby-eye head island and the lower
  // body one root joint. Add a runtime-only hinge at the head island's base
  // ring so the ruby eye can turn toward MegaMan while inheriting body pitch.
  const head = new THREE.Bone();
  head.name = HEAD_BONE_NAME;
  head.position.set(0, HEAD_PIVOT_Y, 0);
  abdomen.add(head);
  model.updateMatrixWorld(true);

  const remappedGeometries = new WeakSet();
  let remappedVertexCount = 0;
  model.traverse((object) => {
    if (!object.isSkinnedMesh || !object.skeleton) return;
    const abdomenIndex = object.skeleton.bones.indexOf(abdomen);
    if (abdomenIndex < 0) return;
    const headIndex = object.skeleton.bones.length;
    const position = object.geometry.getAttribute('position');
    const skinIndex = object.geometry.getAttribute('skinIndex');
    const skinWeight = object.geometry.getAttribute('skinWeight');
    if (!position || !skinIndex || !skinWeight) return;

    if (!remappedGeometries.has(object.geometry)) {
      for (let vertex = 0; vertex < position.count; vertex += 1) {
        if (skinIndex.getX(vertex) !== abdomenIndex
          || skinWeight.getX(vertex) < 0.99
          || !HEAD_VERTEX_KEYS.has(getAuthoredVertexKey(position, vertex))) continue;
        skinIndex.setX(vertex, headIndex);
        remappedVertexCount += 1;
      }
      skinIndex.needsUpdate = true;
      remappedGeometries.add(object.geometry);
    }

    const extendedSkeleton = new THREE.Skeleton(
      [...object.skeleton.bones, head],
      [...object.skeleton.boneInverses, head.matrixWorld.clone().invert()],
    );
    object.bind(extendedSkeleton, object.bindMatrix.clone());
  });
  model.userData.runtimeRigJointCount = 12;
  model.userData.runtimeHeadVertexCount = remappedVertexCount;
}

function prepareSharukurusuTemplate(model) {
  model.name = 'sharukurusuReaverbotTemplate';
  model.userData.authoredReaverbotAsset = 'Sharukurusu';
  model.userData.authoredRigJointCount = 11;
  addSharukurusuHeadPivot(model);
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = true;

    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const materials = sourceMaterials.map((source) => createSharukurusuMaterial(source));
    object.material = Array.isArray(object.material) ? materials : materials[0];
    for (const material of materials) {
      if (!material) continue;
      material.side = THREE.FrontSide;
      if (material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.magFilter = THREE.NearestFilter;
        material.map.minFilter = THREE.NearestMipmapNearestFilter;
        material.map.generateMipmaps = true;
      }
      material.needsUpdate = true;
    }
    for (const source of sourceMaterials) source?.dispose?.();
  });
  return model;
}

function normalizeSharukurusuCollada(source) {
  // Cinema 4D exported this as COLLADA 1.5. Three's ColladaLoader expects the
  // equivalent 1.4-style image/surface graph and a skeleton rooted at a JOINT.
  // Normalize those references in memory so the supplied source asset and its
  // exact rigid skin weights remain untouched on disk.
  return source
    .replace(
      /<init_from>\s*<ref>([^<]+)<\/ref>\s*<\/init_from>/,
      '<init_from>$1</init_from>',
    )
    .replace(
      /<newparam sid="([^"]+)">\s*<sampler2D>\s*<instance_image url="#([^"]+)"\s*\/>\s*<\/sampler2D>\s*<\/newparam>/,
      [
        '<newparam sid="$1-surface">',
        '<surface type="2D"><init_from>$2</init_from></surface>',
        '</newparam>',
        '<newparam sid="$1">',
        '<sampler2D><source>$1-surface</source></sampler2D>',
        '</newparam>',
      ].join(''),
    )
    .replace('<skeleton>#ID5</skeleton>', '<skeleton>#ID8</skeleton>');
}

function loadSharukurusuTemplate() {
  if (!sharukurusuTemplatePromise) {
    const loader = new ColladaLoader();
    loader.setResourcePath(ASSET_PATH);
    sharukurusuTemplatePromise = fetch(`${ASSET_PATH}${MODEL_FILE}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Sharukurusu model request failed (${response.status})`);
        }
        return response.text();
      })
      .then((source) => loader.parse(normalizeSharukurusuCollada(source), ASSET_PATH))
      .then((collada) => prepareSharukurusuTemplate(collada.scene))
      .catch((error) => {
        console.warn('Could not load Sharukurusu Reaverbot model. Using procedural enemy fallback.', error);
        return null;
      });
  }
  return sharukurusuTemplatePromise;
}

function captureBaseTransform(part) {
  if (!part) return;
  part.userData.sharukurusuBasePosition = part.position.clone();
  part.userData.sharukurusuBaseRotation = part.rotation.clone();
}

function createDrillTip(drill, side) {
  if (!drill) return null;
  const tip = new THREE.Group();
  tip.name = `sharukurusu${side}DrillTip`;
  // The supplied skeleton uses Cinema 4D source units. The external model's
  // normalization scale carries this authored elbow-to-tip distance into play.
  tip.position.set(0, -44, 0);
  drill.add(tip);
  return tip;
}

function bindSharukurusuRig(visual) {
  const rig = {
    root: visual.getObjectByName('Armature') ?? visual,
    skinnedMeshes: [],
  };
  for (const [partName, names] of Object.entries(BONE_NAMES)) {
    rig[partName] = findNamedObject(visual, names);
  }
  rig.leftDrillTip = createDrillTip(rig.leftDrill, 'Left');
  rig.rightDrillTip = createDrillTip(rig.rightDrill, 'Right');
  visual.traverse((object) => {
    if (object.isSkinnedMesh) rig.skinnedMeshes.push(object);
  });

  for (const part of Object.values(rig)) {
    if (part?.isObject3D) captureBaseTransform(part);
  }
  rig.ready = Object.keys(BONE_NAMES).every((name) => Boolean(rig[name]));
  visual.userData.sharukurusuRigReady = rig.ready;
  visual.userData.sharukurusuSemanticParts = Object.keys(BONE_NAMES);
  return rig;
}

function setPartRotation(part, x = 0, y = 0, z = 0) {
  const base = part?.userData?.sharukurusuBaseRotation;
  if (!part || !base) return;
  part.rotation.set(base.x + x, base.y + y, base.z + z);
}

function pointToSegmentDistanceSquared(point, start, end) {
  tempSegmentDelta.copy(end).sub(start);
  const lengthSquared = tempSegmentDelta.lengthSq();
  if (lengthSquared <= 0.000001) return point.distanceToSquared(start);
  const ratio = THREE.MathUtils.clamp(
    tempPointDelta.copy(point).sub(start).dot(tempSegmentDelta) / lengthSquared,
    0,
    1,
  );
  tempLineSample.copy(start).addScaledVector(tempSegmentDelta, ratio);
  return point.distanceToSquared(tempLineSample);
}

function closestSegmentDistanceSquared(firstStart, firstEnd, secondStart, secondEnd) {
  const epsilon = 0.000001;
  tempClosestFirstDelta.copy(firstEnd).sub(firstStart);
  tempClosestSecondDelta.copy(secondEnd).sub(secondStart);
  tempClosestOriginDelta.copy(firstStart).sub(secondStart);
  const firstLengthSquared = tempClosestFirstDelta.lengthSq();
  const secondLengthSquared = tempClosestSecondDelta.lengthSq();
  const secondOriginDot = tempClosestSecondDelta.dot(tempClosestOriginDelta);
  let firstRatio = 0;
  let secondRatio = 0;

  if (firstLengthSquared <= epsilon && secondLengthSquared <= epsilon) {
    firstRatio = 0;
    secondRatio = 0;
  } else if (firstLengthSquared <= epsilon) {
    secondRatio = THREE.MathUtils.clamp(secondOriginDot / secondLengthSquared, 0, 1);
  } else {
    const firstOriginDot = tempClosestFirstDelta.dot(tempClosestOriginDelta);
    if (secondLengthSquared <= epsilon) {
      firstRatio = THREE.MathUtils.clamp(-firstOriginDot / firstLengthSquared, 0, 1);
    } else {
      const directionsDot = tempClosestFirstDelta.dot(tempClosestSecondDelta);
      const denominator = firstLengthSquared * secondLengthSquared - directionsDot * directionsDot;
      if (Math.abs(denominator) > epsilon) {
        firstRatio = THREE.MathUtils.clamp(
          (directionsDot * secondOriginDot - firstOriginDot * secondLengthSquared) / denominator,
          0,
          1,
        );
      }
      secondRatio = (directionsDot * firstRatio + secondOriginDot) / secondLengthSquared;
      if (secondRatio < 0) {
        secondRatio = 0;
        firstRatio = THREE.MathUtils.clamp(-firstOriginDot / firstLengthSquared, 0, 1);
      } else if (secondRatio > 1) {
        secondRatio = 1;
        firstRatio = THREE.MathUtils.clamp(
          (directionsDot - firstOriginDot) / firstLengthSquared,
          0,
          1,
        );
      }
    }
  }

  tempClosestFirstPoint.copy(firstStart).addScaledVector(tempClosestFirstDelta, firstRatio);
  tempClosestSecondPoint.copy(secondStart).addScaledVector(tempClosestSecondDelta, secondRatio);
  tempClosestSegmentResult.distanceSquared = tempClosestFirstPoint.distanceToSquared(tempClosestSecondPoint);
  tempClosestSegmentResult.firstRatio = firstRatio;
  tempClosestSegmentResult.secondRatio = secondRatio;
  return tempClosestSegmentResult;
}

export class SharukurusuEnemy extends Enemy {
  constructor(level = 1, overrides = {}) {
    const { eliteAffix = null, ...typeOverrides } = overrides ?? {};
    super('sharukurusu', eliteAffix ? level + 1 : level, typeOverrides);
    this.navigationMode = 'ground';
    this.collisionHeight = this.type.modelHeight ?? TARGET_HEIGHT;
    this.liftable = false;
    this.sharukurusuRig = null;
    this.sharukurusuFlipPivot = null;
    this.sharukurusuLocalModelHeight = TARGET_HEIGHT;
    this.sharukurusuDiveInterruptions = 0;
    this.sharukurusuState = {
      mode: SHARUKURUSU_STATES.NinjaRun,
      timer: 0,
      duration: 0,
      attackSequence: 0,
      hitPlayer: false,
      orbitSign: Math.random() < 0.5 ? -1 : 1,
      runPhase: Math.random() * Math.PI * 2,
      runHop: 0,
      bladeSpin: 0,
      headYaw: 0,
      startPosition: this.root.position.clone(),
      targetPosition: this.root.position.clone(),
      direction: new THREE.Vector3(0, 0, 1),
      groundY: this.root.position.y,
      lastAttackKind: null,
      diveInterruptible: false,
      backflipRotation: 0,
    };
    this.attackCooldown = 0.55;
    this._sharukurusuLastGame = null;
    this.sharukurusuDisposed = false;
    this.affix = eliteAffix;
    this.affixTimers = { burn: 0.8, surge: 1.1 };
    if (eliteAffix) this._applySharukurusuEliteAffix(eliteAffix);
    this._loadSharukurusuVisual();
  }

  _loadSharukurusuVisual() {
    loadSharukurusuTemplate().then((template) => {
      if (!template || this.dead || this.sharukurusuDisposed) return;
      const visual = cloneSkinnedModel(template);
      visual.name = 'sharukurusuReaverbotModel';
      visual.traverse((object) => {
        if (!object.isMesh || !object.material) return;
        object.material = Array.isArray(object.material)
          ? object.material.map((material) => material.clone())
          : object.material.clone();
      });
      this.sharukurusuRig = bindSharukurusuRig(visual);
      const modelHeight = this.type.modelHeight ?? TARGET_HEIGHT;
      const authoredRootScale = Math.max(0.001, Math.abs(this.type.scale ?? 1));
      const localModelHeight = modelHeight / authoredRootScale;
      this.sharukurusuLocalModelHeight = localModelHeight;
      this._fitExternalModelVisual(visual, localModelHeight);
      const flipPivot = new THREE.Group();
      flipPivot.name = 'sharukurusuFlipPivot';
      flipPivot.position.y = localModelHeight * 0.5;
      visual.removeFromParent();
      visual.position.y -= localModelHeight * 0.5;
      flipPivot.add(visual);
      this.externalModelGroup.add(flipPivot);
      this.sharukurusuFlipPivot = flipPivot;
      this.root.updateMatrixWorld(true);
      this._setProceduralHumanoidVisible(false);
      this._tintSharukurusuEliteMaterials();
      this._captureMaterialStates();
    });
  }

  _applySharukurusuEliteAffix(affix) {
    this.isElite = true;
    this.id = `elite-${affix.id}-${this.id}`;
    this.root.name = this.id;
    this.root.userData.enemy = this;
    this.root.scale.multiplyScalar(1.16);
    this.radius *= 1.18;
    this.collisionHeight *= 1.16;
    this.stats.maxHealth *= 2.25;
    this.stats.damage *= 1.45;
    this.stats.experience = Math.round(this.stats.experience * 3.2);

    if (affix.id === 'swift') {
      this.stats.moveSpeed *= 1.38;
      this.stats.attackCooldown *= 0.82;
    } else if (affix.id === 'armored') {
      this.stats.armor += 35;
    } else if (affix.id === 'overcharged') {
      this.stats.attackCooldown *= 0.88;
    } else if (affix.id === 'refractorRich') {
      this.stats.maxHealth *= 1.18;
      this.stats.experience = Math.round(this.stats.experience * 1.35);
    }
    this.health = this.stats.maxHealth;

    const auraMaterial = new THREE.MeshStandardMaterial({
      color: affix.color,
      emissive: affix.color,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
      roughness: 0.45,
      metalness: 0.2,
    });
    const aura = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.76, 32), auraMaterial);
    aura.name = 'eliteAuraRing';
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.04;
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.025, 8, 24), auraMaterial);
    crown.name = 'eliteGlowCrown';
    crown.position.y = 2.75;
    crown.rotation.x = Math.PI / 2;
    this.root.add(aura, crown);
    this._captureMaterialStates();
  }

  _tintSharukurusuEliteMaterials() {
    if (!this.affix || !this.externalModelVisual) return;
    this.externalModelVisual.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material?.emissive) continue;
        material.emissive.set(this.affix.color);
        material.emissiveIntensity = Math.max(material.emissiveIntensity ?? 0, 0.1);
      }
    });
  }

  update(dt, game) {
    super.update(dt, game);
    if (!this.isElite || this.dead || game.player.dead
      || this.isExternalMotionActive?.()
      || game.dungeonController?.isPlayerInSafeZone?.()) return;

    if (this.affix.id === 'burningCore') {
      this.affixTimers.burn -= dt;
      if (this.affixTimers.burn <= 0) {
        game.addFireZone(this.root.position, this.stats.damage * 0.45, 2.4, 1.15, { source: this });
        this.affixTimers.burn = 1.35;
      }
    }
    if (this.affix.id === 'overcharged') {
      this.affixTimers.surge -= dt;
      if (this.affixTimers.surge <= 0) {
        if (this.root.position.distanceTo(game.player.root.position) <= 2.1) {
          const hitResult = game.player.takeIncomingHit({
            amount: this.stats.damage * 0.22,
            source: this,
            guardable: true,
            reactionTier: 1,
          });
          if (hitResult.healthDamage > 0) {
            game.player.applySlow(0.78, 0.5);
          }
          if (isResolvedPlayerContact(hitResult)) {
            game.addHitEffect(game.player.root.position, this.affix.color, 0.48);
          }
        }
        this.affixTimers.surge = 1.15;
      }
    }
    const aura = this.root.getObjectByName('eliteAuraRing');
    if (aura) {
      aura.rotation.z += dt * 1.8;
      aura.scale.setScalar(1 + Math.sin(performance.now() * 0.004) * 0.05);
    }
  }

  modifyDamageTaken(amount, meta = {}) {
    const baseAmount = super.modifyDamageTaken(amount, meta);
    if (!this.affix) return baseAmount;
    if (this.affix.id === 'armored') {
      return baseAmount * (this.hasStatus('armorBreak') ? 0.95 : 0.72);
    }
    if (this.affix.id === 'burningCore' && meta.element === 'fire') return baseAmount * 0.72;
    if (this.affix.id === 'frostCore') {
      if (meta.element === 'ice') return baseAmount * 0.7;
      if (meta.element === 'fire') return baseAmount * 1.12;
    }
    if (this.affix.id === 'overcharged' && meta.element === 'shock') return baseAmount * 0.66;
    return baseAmount;
  }

  onHitPlayer(player, dealt = 0) {
    if (this.affix?.id === 'frostCore' && dealt > 0) player.applySlow(0.55, 1.5);
    if (this.affix?.id === 'corrosive' && dealt > 0) {
      player.takeIncomingHit({
        amount: Math.max(1, dealt * 0.22),
        source: this,
        guardable: false,
        reactionTier: 0,
      });
    }
    return player;
  }

  onDeath(game, meta = {}) {
    game?.cancelEnemyAttackRequest?.(this);
    if (this.affix?.id === 'explosiveCore' && !meta.selfDestruct) {
      game.addExplosion(this.root.position, this.stats.damage * 2.2, 2.25, this.affix.color, { source: this });
    }
    if (this.affix?.id === 'burningCore') {
      game.addFireZone(this.root.position, this.stats.damage * 0.5, 2.4, 1.25, { source: this });
    }
    if (this.affix?.id === 'refractorRich') {
      game.addParticleBurst(this.root.position, this.affix.color, 24, 0.22);
    }
  }

  dispose() {
    this._sharukurusuLastGame?.cancelEnemyAttackRequest?.(this);
    this.sharukurusuDisposed = true;
    this.clearExternalMotion?.('dispose');
    const instanceMaterials = new Set();
    const instanceSkeletons = new Set();
    this.externalModelVisual?.traverse?.((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material) instanceMaterials.add(material);
      }
      if (object.isSkinnedMesh && object.skeleton) instanceSkeletons.add(object.skeleton);
    });
    for (const material of instanceMaterials) material.dispose?.();
    for (const skeleton of instanceSkeletons) skeleton.dispose?.();

    const eliteMaterials = new Set();
    const eliteObjects = [];
    for (const name of ['eliteAuraRing', 'eliteGlowCrown']) {
      const object = this.root.getObjectByName(name);
      if (object) eliteObjects.push(object);
      object?.geometry?.dispose?.();
      const materials = Array.isArray(object?.material) ? object.material : [object?.material];
      for (const material of materials) {
        if (material) eliteMaterials.add(material);
      }
    }
    for (const material of eliteMaterials) material.dispose?.();
    this.externalModelGroup?.removeFromParent?.();
    for (const object of eliteObjects) object.removeFromParent?.();
    // ModularHumanoid owns the procedural fallback and enemy health bar. With
    // the shared authored model detached, its disposer can safely release all
    // remaining per-instance geometry and materials.
    this.humanoid?.dispose?.();
  }

  _setSharukurusuState(mode, duration = 0) {
    const state = this.sharukurusuState;
    state.mode = mode;
    state.timer = 0;
    state.duration = Math.max(0, duration);
    state.hitPlayer = false;
    state.diveInterruptible = mode === SHARUKURUSU_STATES.DiveAirborne;
    if (mode !== SHARUKURUSU_STATES.NinjaRun) state.runHop = 0;
    if (mode !== SHARUKURUSU_STATES.Backflip) state.backflipRotation = 0;
    return mode;
  }

  _getGroundY(game, position = this.root.position) {
    const elevation = game?.dungeonController?.getSurfaceElevationAt?.(position);
    return Number.isFinite(elevation) ? elevation : this.sharukurusuState.groundY;
  }

  _isSharukurusuAirborneStepClear(game, nextRootPosition) {
    const controller = game?.dungeonController;
    if (!controller?.isAerialPathClear) return true;
    const collisionHeight = Math.max(1, this.collisionHeight ?? TARGET_HEIGHT);
    const centerOffset = collisionHeight * 0.5;
    const authoredScale = this.isElite ? 1.16 : 1;
    tempAirborneStart.copy(this.root.position).addScaledVector(THREE.Object3D.DEFAULT_UP, centerOffset);
    tempAirborneEnd.copy(nextRootPosition).addScaledVector(THREE.Object3D.DEFAULT_UP, centerOffset);
    return controller.isAerialPathClear(tempAirborneStart, tempAirborneEnd, {
      radius: Math.max(AUTHORED_HALF_WIDTH * authoredScale, this.radius ?? 0.7),
      verticalRadius: Math.max(TARGET_HEIGHT * 0.5 * authoredScale, collisionHeight * 0.47),
      sampleSpacing: 0.12,
    });
  }

  _isSharukurusuChargeStepClear(game, nextRootPosition) {
    const controller = game?.dungeonController;
    if (!controller?.isAerialPathClear) return true;
    const collisionHeight = Math.max(1, this.collisionHeight ?? TARGET_HEIGHT);
    const centerOffset = collisionHeight * 0.5;
    tempAirborneStart.copy(this.root.position).addScaledVector(THREE.Object3D.DEFAULT_UP, centerOffset);
    tempAirborneEnd.copy(nextRootPosition).addScaledVector(THREE.Object3D.DEFAULT_UP, centerOffset);
    if (!controller.isAerialPathClear(tempAirborneStart, tempAirborneEnd, {
      radius: Math.max(0.42, this.radius ?? 0.7),
      verticalRadius: collisionHeight * 0.47,
      sampleSpacing: 0.1,
    })) {
      return false;
    }

    tempChargeDelta.copy(nextRootPosition).sub(this.root.position);
    for (const tip of [this.sharukurusuRig?.leftDrillTip, this.sharukurusuRig?.rightDrillTip]) {
      if (!tip) continue;
      tip.getWorldPosition(tempAttackOrigin);
      tempChargeTipEnd.copy(tempAttackOrigin).add(tempChargeDelta);
      if (!controller.isAerialPathClear(tempAttackOrigin, tempChargeTipEnd, {
        radius: 0.3,
        verticalRadius: 0.3,
        sampleSpacing: 0.08,
      })) {
        return false;
      }
    }
    return true;
  }

  _abortBlockedSharukurusuAirMove(game) {
    const state = this.sharukurusuState;
    state.groundY = this._getGroundY(game, this.root.position);
    this.root.position.y = state.groundY;
    this.knockback.set(0, 0, 0);
    this.attackCooldown = this.stats.attackCooldown;
    this._startSharukurusuBackflip(game, state.direction);
  }

  _isSharukurusuChargeCandidateInsideArena(candidate) {
    const arena = this.encounterArena;
    if (!arena?.center || !candidate) return true;
    const zoneCenter = arena.zoneCenter ?? arena.center;
    const halfWidth = Math.max(0.5, arena.softHalfWidth ?? arena.halfWidth ?? 1);
    const halfDepth = Math.max(0.5, arena.softHalfDepth ?? arena.halfDepth ?? 1);
    return Math.abs(candidate.x - zoneCenter.x) <= halfWidth
      && Math.abs(candidate.z - zoneCenter.z) <= halfDepth;
  }

  _faceDirection(direction) {
    if (direction?.lengthSq?.() > 0.0001) {
      this.root.rotation.y = Math.atan2(direction.x, direction.z);
    }
  }

  _moveSharukurusuGrounded(game, direction, speed, dt) {
    if (!direction || direction.lengthSq() <= 0.0001) return false;
    const resolvedSpeed = speed * this._getStatusMoveMultiplier();
    tempDirection.copy(direction).setY(0).normalize();
    tempTarget.copy(this.root.position).addScaledVector(tempDirection, Math.max(2, resolvedSpeed * 0.5));
    const navigation = this.sharukurusuState.mode === SHARUKURUSU_STATES.DrillCharge
      ? tempDirection
      : game.dungeonController?.getEnemyNavigationDirection?.(this, tempTarget)
        ?? game.dungeonController?.getNavigationDirection?.(this.root.position, tempTarget)
        ?? tempDirection;
    tempCandidate.copy(this.root.position).addScaledVector(navigation, resolvedSpeed * dt);
    tempCandidate.y = this._getGroundY(game, tempCandidate);
    if (this.sharukurusuState.mode === SHARUKURUSU_STATES.DrillCharge
      && (!this._isSharukurusuChargeCandidateInsideArena(tempCandidate)
        || !this._isSharukurusuChargeStepClear(game, tempCandidate))) {
      return false;
    }
    if (game.dungeonController?.isPositionWalkable
      && !game.dungeonController.isPositionWalkable(tempCandidate)) {
      return false;
    }
    this.root.position.copy(tempCandidate);
    this.sharukurusuState.groundY = tempCandidate.y;
    this._faceDirection(navigation);
    return true;
  }

  _startSharukurusuCharge(game, direction = null) {
    const state = this.sharukurusuState;
    tempDirection.copy(direction ?? game.player.root.position.clone().sub(this.root.position)).setY(0);
    if (tempDirection.lengthSq() <= 0.0001) tempDirection.set(0, 0, 1);
    state.direction.copy(tempDirection).normalize();
    state.lastAttackKind = 'sharukurusuDrillCharge';
    this._faceDirection(state.direction);
    this._setSharukurusuState(SHARUKURUSU_STATES.ChargeWindup, CHARGE_WINDUP_TIME);
    game.addParticleBurst?.(this.root.position.clone().add(new THREE.Vector3(0, 0.72, 0)), 0xff315a, 7, 0.1);
    return true;
  }

  _startSharukurusuDive(game, direction = null) {
    const state = this.sharukurusuState;
    tempDirection.copy(direction ?? game.player.root.position.clone().sub(this.root.position)).setY(0);
    if (tempDirection.lengthSq() <= 0.0001) tempDirection.set(0, 0, 1);
    state.direction.copy(tempDirection).normalize();
    state.lastAttackKind = 'sharukurusuDivingBlades';
    this._faceDirection(state.direction);
    this._setSharukurusuState(SHARUKURUSU_STATES.DiveWindup, DIVE_WINDUP_TIME);
    game.addParticleBurst?.(this.root.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xff496a, 5, 0.08);
    return true;
  }

  _enterSharukurusuDiveAirborne(game) {
    const state = this.sharukurusuState;
    state.startPosition.copy(this.root.position);
    state.groundY = this._getGroundY(game, this.root.position);
    tempTarget.copy(game.player.root.position).addScaledVector(state.direction, 0.45);
    tempTarget.y = this._getGroundY(game, tempTarget);
    const resolved = game.dungeonController?.findNearestEnemyClearPosition?.(this, tempTarget, {
      preferredPosition: tempTarget,
      maximumRadius: 2.4,
    });
    state.targetPosition.copy(resolved ?? tempTarget);
    tempDirection.copy(state.targetPosition).sub(state.startPosition).setY(0);
    if (tempDirection.lengthSq() > 0.0001) {
      state.direction.copy(tempDirection).normalize();
      this._faceDirection(state.direction);
    }
    this._setSharukurusuState(SHARUKURUSU_STATES.DiveAirborne, DIVE_TIME);
  }

  _startSharukurusuBackflip(game, direction = null) {
    game?.completeEnemyAttack?.(this);
    const state = this.sharukurusuState;
    state.startPosition.copy(this.root.position);
    state.groundY = this._getGroundY(game, this.root.position);
    tempDirection.copy(direction ?? state.direction).setY(0);
    if (tempDirection.lengthSq() <= 0.0001) tempDirection.set(0, 0, 1);
    tempDirection.normalize();
    tempTarget.copy(tempDirection).multiplyScalar(-1);
    const safeLanding = this.resolveContactRetreatLanding(game, game.player, {
      awayDirection: tempTarget,
      distance: 2.6,
      arcHeight: BACKFLIP_HEIGHT,
    });
    if (safeLanding) {
      tempTarget.copy(safeLanding);
    } else {
      tempTarget.copy(this.root.position);
      tempTarget.y = state.groundY;
    }
    state.direction.copy(tempDirection);
    state.targetPosition.copy(tempTarget);
    this._setSharukurusuState(SHARUKURUSU_STATES.Backflip, BACKFLIP_TIME);
    return true;
  }

  beginContactRetreat(game = this._runtimeGame, player = game?.player) {
    if (this.dead
      || !game
      || !player
      || !this.sharukurusuState
      || this.sharukurusuState.mode === SHARUKURUSU_STATES.Backflip) {
      return false;
    }
    this.attackCooldown = Math.max(this.attackCooldown, this.stats.attackCooldown);
    return this._startSharukurusuBackflip(game, this.sharukurusuState.direction);
  }

  _getSharukurusuDrillContact(game) {
    const player = game.player;
    const playerRoot = player.root.position;
    const playerHeight = 2.85;
    const contactRadius = (player.radius ?? 0.42) + 0.55;
    const controller = game.dungeonController;
    const origins = [];
    const leftTip = this.sharukurusuRig?.leftDrillTip;
    const rightTip = this.sharukurusuRig?.rightDrillTip;
    if (leftTip && rightTip) {
      leftTip.getWorldPosition(tempLeftDrillWorld);
      rightTip.getWorldPosition(tempRightDrillWorld);
      origins.push(tempLeftDrillWorld, tempRightDrillWorld);
    } else {
      tempAttackOrigin.copy(this.root.position)
        .addScaledVector(this.sharukurusuState.direction, 0.82);
      tempAttackOrigin.y += 0.82;
      origins.push(tempAttackOrigin);
    }

    for (const origin of origins) {
      const closestY = THREE.MathUtils.clamp(origin.y, playerRoot.y + 0.12, playerRoot.y + playerHeight);
      const dx = origin.x - playerRoot.x;
      const dy = origin.y - closestY;
      const dz = origin.z - playerRoot.z;
      if (dx * dx + dy * dy + dz * dz > contactRadius * contactRadius) continue;

      tempAttackTarget.set(playerRoot.x, closestY, playerRoot.z);
      if (controller?.isAerialPathClear) {
        tempAttackBodyAnchor.copy(this.root.position);
        tempAttackBodyAnchor.y += (this.collisionHeight ?? TARGET_HEIGHT) * 0.45;
        const armConnectedToBody = controller.isAerialPathClear(
          tempAttackBodyAnchor,
          origin,
          { radius: 0.16, verticalRadius: 0.18, sampleSpacing: 0.08 },
        );
        const clearToPlayer = controller.isAerialPathClear(origin, tempAttackTarget, {
          radius: 0.1,
          verticalRadius: 0.12,
          sampleSpacing: 0.08,
        });
        if (!armConnectedToBody || !clearToPlayer) continue;
      }
      return origin;
    }
    return null;
  }

  _getSharukurusuArmSegments() {
    const rig = this.sharukurusuRig;
    if (!rig?.ready || !rig.leftDrillTip || !rig.rightDrillTip) return [];
    rig.leftUpperArm.getWorldPosition(tempLeftShoulderWorld);
    rig.leftDrill.getWorldPosition(tempLeftElbowWorld);
    rig.leftDrillTip.getWorldPosition(tempLeftDrillWorld);
    rig.rightUpperArm.getWorldPosition(tempRightShoulderWorld);
    rig.rightDrill.getWorldPosition(tempRightElbowWorld);
    rig.rightDrillTip.getWorldPosition(tempRightDrillWorld);
    return tempSharukurusuArmSegments;
  }

  resolveProjectileHit(position, projectileRadius = 0.1) {
    if (this.dead || !position) return null;
    const eliteScale = this.isElite ? 1.16 : 1;
    for (const segment of this._getSharukurusuArmSegments()) {
      const hitRadius = segment.radius * eliteScale + projectileRadius;
      if (pointToSegmentDistanceSquared(position, segment.start, segment.end) <= hitRadius * hitRadius) {
        return {
          hitPartId: segment.id,
          weakPointHit: false,
          hitPosition: position.clone(),
        };
      }
    }
    return null;
  }

  resolveLineHit(start, direction, range, width = 0.1) {
    if (this.dead || !start || !direction) return null;
    tempLineDirection.copy(direction);
    if (tempLineDirection.lengthSq() <= 0.000001 || range <= 0) return null;
    tempLineDirection.normalize();
    tempLineEnd.copy(start).addScaledVector(tempLineDirection, range);
    const eliteScale = this.isElite ? 1.16 : 1;
    let best = null;
    for (const segment of this._getSharukurusuArmSegments()) {
      const closest = closestSegmentDistanceSquared(
        start,
        tempLineEnd,
        segment.start,
        segment.end,
      );
      const hitRadius = width + segment.radius * eliteScale;
      if (closest.distanceSquared > hitRadius * hitRadius) continue;
      const along = closest.firstRatio * range;
      if (!best || along < best.along) {
        best = {
          along,
          hitPartId: segment.id,
          weakPointHit: false,
          hitPosition: tempClosestSecondPoint.clone(),
        };
      }
    }
    return best;
  }

  _damagePlayerWithSharukurusuAttack(game, attackKind, damageScale, powerfulKnockback = true) {
    const state = this.sharukurusuState;
    if (state.hitPlayer || game.player.dead) return 0;
    const contactPoint = this._getSharukurusuDrillContact(game);
    if (!contactPoint) return 0;
    tempDirection.copy(game.player.root.position).sub(this.root.position).setY(0);
    if (tempDirection.lengthSq() <= 0.0001) tempDirection.copy(state.direction);
    tempDirection.normalize();
    const hitResult = game.player.takeIncomingHit({
      amount: this.stats.damage * damageScale,
      source: this,
      attackKind,
      guardable: true,
      reactionTier: powerfulKnockback ? 2 : 1,
      knockbackDirection: tempDirection,
      knockbackStrength: attackKind === 'sharukurusuDivingBlades' ? 1.24 : 1.08,
    });
    state.hitPlayer = true;
    const resolvedContact = isResolvedPlayerContact(hitResult);
    if (hitResult.healthDamage > 0) {
      this.onHitPlayer(game.player, hitResult.healthDamage);
    }
    if (resolvedContact) {
      this.beginContactRetreat(game, game.player);
      game.addHitEffect?.(contactPoint, 0xff365f, 0.82, { absolute: true });
      game.requestHitStop?.(0.1, { timeScale: 0.05 });
    }
    return hitResult;
  }

  _interruptSharukurusuDive(game, meta = {}) {
    if (this.dead || this.sharukurusuState.mode !== SHARUKURUSU_STATES.DiveAirborne) return false;
    const state = this.sharukurusuState;
    state.groundY = this._getGroundY(game, this.root.position);
    this.root.position.y = state.groundY;
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
    this.knockback.set(0, 0, 0);
    this.hitStopTimer = Math.max(this.hitStopTimer, 0.1);
    this.sharukurusuDiveInterruptions += 1;
    meta.sharukurusuDiveInterrupted = true;
    this._setSharukurusuState(SHARUKURUSU_STATES.KnockedDown, KNOCKDOWN_TIME);
    game?.addParticleBurst?.(this.root.position.clone().add(new THREE.Vector3(0, 0.22, 0)), 0xff365f, 10, 0.12);
    return true;
  }

  takeDamage(amount, meta = {}) {
    const interruptibleDive = meta.projectileHit === true
      && this.sharukurusuState?.mode === SHARUKURUSU_STATES.DiveAirborne;
    const dealt = super.takeDamage(amount, meta);
    if (interruptibleDive && !this.dead) {
      this._interruptSharukurusuDive(this._sharukurusuLastGame, meta);
    } else if (this.sharukurusuState?.mode === SHARUKURUSU_STATES.KnockedDown) {
      // Follow-up fire may still deal damage, but cannot slide or relaunch the
      // body while it is visibly prone on the floor.
      this.knockback.set(0, 0, 0);
    }
    return dealt;
  }

  shouldIgnoreGroundConstraint() {
    return super.shouldIgnoreGroundConstraint()
      || this.sharukurusuState?.mode === SHARUKURUSU_STATES.DiveAirborne
      || this.sharukurusuState?.mode === SHARUKURUSU_STATES.Backflip;
  }

  _updateSharukurusuRun(dt, game) {
    const state = this.sharukurusuState;
    const player = game.player;
    tempDirection.copy(player.root.position).sub(this.root.position).setY(0);
    const distance = tempDirection.length();
    if (distance > 0.0001) tempDirection.divideScalar(distance);
    else tempDirection.set(0, 0, 1);
    tempPerpendicular.set(-tempDirection.z * state.orbitSign, 0, tempDirection.x * state.orbitSign);

    if (distance > 5.4) {
      tempTarget.copy(tempDirection).addScaledVector(tempPerpendicular, 0.28).normalize();
    } else if (distance < 2.5) {
      tempTarget.copy(tempDirection).multiplyScalar(-0.75).add(tempPerpendicular).normalize();
    } else {
      tempTarget.copy(tempPerpendicular).addScaledVector(tempDirection, 0.18).normalize();
    }

    const moved = this._moveSharukurusuGrounded(game, tempTarget, this.stats.moveSpeed, dt);
    state.runPhase += dt * (moved ? 12.5 : 4);
    // Keep the collision root grounded while the authored model performs
    // quick ninja-like bounds. Dungeon constraints can then remain authoritative.
    state.runHop = Math.max(0, Math.sin(state.runPhase)) * 0.14;

    if (this.attackCooldown <= 0
      && distance <= 8.5
      && (game.requestEnemyAttack?.(this) ?? true)) {
      state.attackSequence += 1;
      if (state.attackSequence % 2 === 0) this._startSharukurusuDive(game, tempDirection);
      else this._startSharukurusuCharge(game, tempDirection);
    }
    return { handled: true, moving: moved, moveAmount: moved ? 1.45 : 0 };
  }

  _updateCustomBehavior(dt, game) {
    this._sharukurusuLastGame = game;
    const state = this.sharukurusuState;
    if (!state || this.dead) return null;

    if (game.dungeonController?.isPlayerInSafeZone?.()) {
      game.cancelEnemyAttackRequest?.(this);
      if (state.mode !== SHARUKURUSU_STATES.NinjaRun) {
        this.root.position.y = this._getGroundY(game, this.root.position);
        this._setSharukurusuState(SHARUKURUSU_STATES.NinjaRun);
      }
      return { handled: true, moving: false, moveAmount: 0 };
    }
    if (this._isControlLocked() || this.hitStopTimer > 0) {
      return { handled: true, moving: false, moveAmount: 0 };
    }

    state.timer += dt;
    const intenseBladeState = state.mode === SHARUKURUSU_STATES.DrillCharge
      || state.mode === SHARUKURUSU_STATES.DiveAirborne;
    state.bladeSpin += dt * (intenseBladeState ? 42 : 7.5);
    this.attackCooldown -= dt * this._getStatusAttackRateMultiplier();

    if (state.mode === SHARUKURUSU_STATES.NinjaRun) {
      return this._updateSharukurusuRun(dt, game);
    }

    if (state.mode === SHARUKURUSU_STATES.ChargeWindup) {
      this._faceDirection(state.direction);
      if (state.timer >= state.duration) {
        this._setSharukurusuState(SHARUKURUSU_STATES.DrillCharge, CHARGE_TIME);
      }
      return { handled: true, moving: false, moveAmount: 0 };
    }

    if (state.mode === SHARUKURUSU_STATES.DrillCharge) {
      const moved = this._moveSharukurusuGrounded(
        game,
        state.direction,
        (this.type.chargeSpeed ?? 9.4) * 0.78,
        dt,
      );
      this._damagePlayerWithSharukurusuAttack(game, 'sharukurusuDrillCharge', 0.82, true);
      if (state.mode === SHARUKURUSU_STATES.Backflip) {
        return { handled: true, moving: moved, moveAmount: moved ? 1.8 : 0 };
      }
      if (!moved || state.timer >= state.duration) {
        this.attackCooldown = this.stats.attackCooldown;
        this._startSharukurusuBackflip(game, state.direction);
      }
      return { handled: true, moving: moved, moveAmount: moved ? 1.8 : 0 };
    }

    if (state.mode === SHARUKURUSU_STATES.DiveWindup) {
      this._faceDirection(state.direction);
      if (state.timer >= state.duration) this._enterSharukurusuDiveAirborne(game);
      return { handled: true, moving: false, moveAmount: 0 };
    }

    if (state.mode === SHARUKURUSU_STATES.DiveAirborne) {
      const progress = THREE.MathUtils.clamp(state.timer / state.duration, 0, 1);
      tempCandidate.lerpVectors(state.startPosition, state.targetPosition, progress);
      tempCandidate.y = THREE.MathUtils.lerp(
        state.startPosition.y,
        state.targetPosition.y,
        progress,
      ) + Math.sin(progress * Math.PI) * DIVE_HEIGHT;
      if (!this._isSharukurusuAirborneStepClear(game, tempCandidate)) {
        this._abortBlockedSharukurusuAirMove(game);
        return { handled: true, moving: false, moveAmount: 0 };
      }
      this.root.position.copy(tempCandidate);
      this._faceDirection(state.direction);
      if (progress >= 0.42) {
        this._damagePlayerWithSharukurusuAttack(game, 'sharukurusuDivingBlades', 1.18, true);
        if (state.mode === SHARUKURUSU_STATES.Backflip) {
          return { handled: true, moving: true, moveAmount: 1.8 };
        }
      }
      if (progress >= 1) {
        this.root.position.copy(state.targetPosition);
        state.groundY = state.targetPosition.y;
        this.attackCooldown = this.stats.attackCooldown;
        this._startSharukurusuBackflip(game, state.direction);
      }
      return { handled: true, moving: true, moveAmount: 1.8 };
    }

    if (state.mode === SHARUKURUSU_STATES.KnockedDown) {
      this.root.position.y = state.groundY;
      if (state.timer >= state.duration) {
        this.attackCooldown = this.stats.attackCooldown * 0.85;
        this._startSharukurusuBackflip(game, state.direction);
      }
      return { handled: true, moving: false, moveAmount: 0 };
    }

    if (state.mode === SHARUKURUSU_STATES.Backflip) {
      const progress = THREE.MathUtils.clamp(state.timer / state.duration, 0, 1);
      tempCandidate.lerpVectors(state.startPosition, state.targetPosition, progress);
      tempCandidate.y = THREE.MathUtils.lerp(
        state.startPosition.y,
        state.targetPosition.y,
        progress,
      ) + Math.sin(progress * Math.PI) * BACKFLIP_HEIGHT;
      if (!this._isSharukurusuAirborneStepClear(game, tempCandidate)) {
        this.root.position.y = this._getGroundY(game, this.root.position);
        this.knockback.set(0, 0, 0);
        this._setSharukurusuState(SHARUKURUSU_STATES.NinjaRun);
        return { handled: true, moving: false, moveAmount: 0 };
      }
      this.root.position.copy(tempCandidate);
      state.backflipRotation = progress * Math.PI * 2;
      if (progress >= 1) {
        this.root.position.copy(state.targetPosition);
        state.groundY = state.targetPosition.y;
        this._setSharukurusuState(SHARUKURUSU_STATES.NinjaRun);
      }
      return { handled: true, moving: true, moveAmount: 1.25 };
    }

    this._setSharukurusuState(SHARUKURUSU_STATES.NinjaRun);
    return { handled: true, moving: false, moveAmount: 0 };
  }

  isAttackLeaseActive() {
    return [
      SHARUKURUSU_STATES.ChargeWindup,
      SHARUKURUSU_STATES.DrillCharge,
      SHARUKURUSU_STATES.DiveWindup,
      SHARUKURUSU_STATES.DiveAirborne,
    ].includes(this.sharukurusuState?.mode);
  }

  _updateExternalModelVisual(dt, moving) {
    super._updateExternalModelVisual(dt, moving);
    const rig = this.sharukurusuRig;
    const state = this.sharukurusuState;
    if (!this.externalModelGroup || !rig || !state) return;

    const run = state.mode === SHARUKURUSU_STATES.NinjaRun && moving ? 1 : 0;
    const runSwing = Math.sin(state.runPhase) * run;
    const charge = state.mode === SHARUKURUSU_STATES.ChargeWindup
      || state.mode === SHARUKURUSU_STATES.DrillCharge ? 1 : 0;
    const diveWindup = state.mode === SHARUKURUSU_STATES.DiveWindup ? 1 : 0;
    const diveAirborne = state.mode === SHARUKURUSU_STATES.DiveAirborne ? 1 : 0;
    const knockedDown = state.mode === SHARUKURUSU_STATES.KnockedDown;
    const backflip = state.mode === SHARUKURUSU_STATES.Backflip;
    const canTrackHead = !knockedDown && !backflip && Boolean(this._sharukurusuLastGame?.player);
    let targetHeadYaw = 0;
    if (canTrackHead) {
      tempHeadLookDirection.copy(this._sharukurusuLastGame.player.root.position)
        .sub(this.root.position)
        .setY(0);
      if (tempHeadLookDirection.lengthSq() > 0.0001) {
        const desiredYaw = Math.atan2(tempHeadLookDirection.x, tempHeadLookDirection.z);
        const yawDelta = desiredYaw - this.root.rotation.y;
        targetHeadYaw = THREE.MathUtils.clamp(
          Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta)),
          -HEAD_TRACK_YAW_LIMIT,
          HEAD_TRACK_YAW_LIMIT,
        );
      }
    }
    state.headYaw = dt > 0
      ? THREE.MathUtils.damp(state.headYaw ?? 0, targetHeadYaw, 14, dt)
      : targetHeadYaw;
    const chargeLeadsLeft = state.attackSequence % 2 !== 0;
    const leftChargeThigh = chargeLeadsLeft
      ? CHARGE_LEAD_THIGH_ANGLE
      : CHARGE_TRAIL_THIGH_ANGLE;
    const rightChargeThigh = chargeLeadsLeft
      ? CHARGE_TRAIL_THIGH_ANGLE
      : CHARGE_LEAD_THIGH_ANGLE;
    const leftChargeShin = chargeLeadsLeft
      ? CHARGE_LEAD_SHIN_ANGLE
      : CHARGE_TRAIL_SHIN_ANGLE;
    const rightChargeShin = chargeLeadsLeft
      ? CHARGE_TRAIL_SHIN_ANGLE
      : CHARGE_LEAD_SHIN_ANGLE;
    const leftChargeFoot = chargeLeadsLeft
      ? CHARGE_LEAD_FOOT_ANGLE
      : CHARGE_TRAIL_FOOT_ANGLE;
    const rightChargeFoot = chargeLeadsLeft
      ? CHARGE_TRAIL_FOOT_ANGLE
      : CHARGE_LEAD_FOOT_ANGLE;

    setPartRotation(
      rig.abdomen,
      charge * -0.28 + diveWindup * -0.48 + diveAirborne * DIVE_BODY_PITCH,
      0,
      runSwing * 0.035,
    );
    setPartRotation(
      rig.head,
      0,
      state.headYaw,
      0,
    );
    // The charge reads as a held sprinting lunge: one bent lead knee and one
    // long trailing leg. Alternate the leading side between attack cycles so
    // repeated charges retain the authored ninja-like rhythm.
    setPartRotation(
      rig.leftThigh,
      runSwing * 0.72 + charge * leftChargeThigh - diveWindup * 0.3
        + diveAirborne * DIVE_TRAIL_THIGH_ANGLE,
      0,
      0,
    );
    setPartRotation(
      rig.rightThigh,
      -runSwing * 0.72 + charge * rightChargeThigh - diveWindup * 0.3
        + diveAirborne * DIVE_TRAIL_THIGH_ANGLE,
      0,
      0,
    );
    setPartRotation(
      rig.leftShin,
      Math.max(0, -runSwing) * 0.82 + charge * leftChargeShin
        + diveWindup * 0.88 + diveAirborne * DIVE_TRAIL_SHIN_ANGLE,
      0,
      0,
    );
    setPartRotation(
      rig.rightShin,
      Math.max(0, runSwing) * 0.82 + charge * rightChargeShin
        + diveWindup * 0.88 + diveAirborne * DIVE_TRAIL_SHIN_ANGLE,
      0,
      0,
    );
    setPartRotation(
      rig.leftFoot,
      Math.max(0, runSwing) * -0.32 + charge * leftChargeFoot
        + diveWindup * -0.22 + diveAirborne * DIVE_TRAIL_FOOT_ANGLE,
      0,
      0,
    );
    setPartRotation(
      rig.rightFoot,
      Math.max(0, -runSwing) * -0.32 + charge * rightChargeFoot
        + diveWindup * -0.22 + diveAirborne * DIVE_TRAIL_FOOT_ANGLE,
      0,
      0,
    );
    // The authored arm bones extend down local -Y. With the model's facial
    // +Z side aligned to combat forward, negative X rotation leads both the
    // charge and dive with the drill tips instead of sweeping them rearward.
    setPartRotation(
      rig.leftUpperArm,
      -runSwing * 0.4 + charge * CHARGE_ARM_LUNGE_ANGLE
        + diveWindup * DIVE_WINDUP_ARM_LUNGE_ANGLE
        + diveAirborne * DIVE_AIRBORNE_ARM_LUNGE_ANGLE,
      0,
      -0.08,
    );
    setPartRotation(
      rig.rightUpperArm,
      runSwing * 0.4 + charge * CHARGE_ARM_LUNGE_ANGLE
        + diveWindup * DIVE_WINDUP_ARM_LUNGE_ANGLE
        + diveAirborne * DIVE_AIRBORNE_ARM_LUNGE_ANGLE,
      0,
      0.08,
    );
    setPartRotation(rig.leftDrill, 0, state.bladeSpin, 0);
    setPartRotation(rig.rightDrill, 0, -state.bladeSpin, 0);

    const yawOffset = this.type.modelYawOffset ?? 0;
    this.externalModelGroup.rotation.y = yawOffset;
    if (run) this.externalModelGroup.position.y += state.runHop;
    const flipPivot = this.sharukurusuFlipPivot;
    if (flipPivot) {
      flipPivot.rotation.set(0, 0, 0);
      if (knockedDown) {
        const halfHeight = this.sharukurusuLocalModelHeight * 0.5;
        this.externalModelGroup.position.y = this.externalModelBaseY - halfHeight + 0.42;
        this.externalModelGroup.rotation.x = 0;
        this.externalModelGroup.rotation.z = 0;
        flipPivot.rotation.x = Math.PI * 0.5;
        flipPivot.rotation.z = 0.08;
      } else if (backflip) {
        this.externalModelGroup.rotation.x = 0;
        this.externalModelGroup.rotation.z = 0;
        flipPivot.rotation.x = -state.backflipRotation;
      } else if (state.mode === SHARUKURUSU_STATES.DiveAirborne) {
        this.externalModelGroup.rotation.x = 0;
        this.externalModelGroup.rotation.z = 0;
        flipPivot.rotation.x = 0;
        flipPivot.rotation.z = Math.sin(state.timer * 18) * 0.06;
      }
    } else if (knockedDown) {
      this.externalModelGroup.position.y = this.externalModelBaseY + 0.26;
      this.externalModelGroup.rotation.x = Math.PI * 0.5;
      this.externalModelGroup.rotation.z = 0.08;
    } else if (backflip) {
      this.externalModelGroup.rotation.x = -state.backflipRotation;
      this.externalModelGroup.rotation.z = 0;
    } else if (state.mode === SHARUKURUSU_STATES.DiveAirborne) {
      this.externalModelGroup.rotation.x = 0;
      this.externalModelGroup.rotation.z = Math.sin(state.timer * 18) * 0.06;
    }
  }
}
