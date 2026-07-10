import * as THREE from 'three';
import { PLAYER_TRAVERSAL_ENVELOPE } from './TraversalCapabilities.js';
import {
  getCombatTargetOwner,
  getCombatTargetWorldPosition,
} from './reaverbots/CombatTarget.js';

const DEFAULT_PROJECTILE_COLOR = 0x9fe8ff;
const PROJECTILE_ENEMY_HIT_STOP_DURATION = 0.055;
const DRILL_PROJECTILE_ENEMY_HIT_STOP_DURATION = 0.09;
const PROJECTILE_EXPLOSION_ENEMY_HIT_STOP_DURATION = 0.08;
const BUSTER_SHOT_TEXTURE_SIZE = 128;
const BUSTER_SHOT_ASPECT = 1.76;
const BUSTER_SHOT_WIDTH_SCALE = 3.8;
const BUSTER_SHOT_ROTATION_SPEED = 1.45;
const tempPosition = new THREE.Vector3();
const tempDirection = new THREE.Vector3();
const tempExplosionPosition = new THREE.Vector3();
const tempClusterDirection = new THREE.Vector3();
let busterShotTextures = null;

function getTargetCollisionHeight(target, fallbackHeight = 1.8) {
  return Math.max(
    (target?.radius ?? 0.42) * 2.2,
    target?.collisionHeight ?? target?.type?.modelHeight ?? fallbackHeight,
  );
}

function getProjectileCapsuleDistanceSquared(position, target, height) {
  const radius = target?.radius ?? 0.42;
  const bottom = (target?.root?.position?.y ?? 0) + radius;
  const top = Math.max(bottom, (target?.root?.position?.y ?? 0) + height - radius);
  tempPosition.set(
    target?.root?.position?.x ?? 0,
    THREE.MathUtils.clamp(position.y, bottom, top),
    target?.root?.position?.z ?? 0,
  );
  return position.distanceToSquared(tempPosition);
}

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function createBusterShotTexture(kind) {
  if (typeof document === 'undefined') {
    return null;
  }

  const size = BUSTER_SHOT_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const data = image.data;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5 - size * 0.5) / (size * 0.48);
      const ny = (y + 0.5 - size * 0.5) / (size * 0.28);
      const distance = Math.sqrt(nx * nx + ny * ny);
      const noise = Math.sin(x * 0.18 + y * 0.11) * 0.5
        + Math.sin(x * 0.07 - y * 0.23) * 0.35
        + Math.sin((x + y) * 0.13) * 0.15;
      let alpha = 0;

      if (kind === 'shell') {
        const outer = 1 - smoothstep(0.93, 1.02, distance);
        const centerFade = smoothstep(0.42, 0.72, distance);
        alpha = outer * (0.55 + centerFade * 0.38 + noise * 0.055);
      } else if (kind === 'core') {
        const core = 1 - smoothstep(0.45 + noise * 0.035, 0.84 + noise * 0.025, distance);
        const hotMiddle = 1 - smoothstep(0, 0.45, distance);
        alpha = core * (0.78 + hotMiddle * 0.22);
      } else if (kind === 'rim') {
        const outside = 1 - smoothstep(0.97, 1.02, distance);
        const inside = smoothstep(0.86, 0.95, distance);
        alpha = outside * inside * (0.76 + noise * 0.08);
      }

      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(THREE.MathUtils.clamp(alpha, 0, 1) * 255);
    }
  }

  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `texture_busterShot_${kind}`;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  if ('colorSpace' in texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }

  return texture;
}

function getBusterShotTextures() {
  if (!busterShotTextures) {
    busterShotTextures = {
      shell: createBusterShotTexture('shell'),
      core: createBusterShotTexture('core'),
      rim: createBusterShotTexture('rim'),
    };
  }

  return busterShotTextures;
}

function createBusterShotSprite(name, map, color, opacity, blending = THREE.NormalBlending) {
  const material = new THREE.SpriteMaterial({
    map,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    blending,
    toneMapped: false,
  });
  material.name = `material_${name}`;

  const sprite = new THREE.Sprite(material);
  sprite.name = name;
  sprite.renderOrder = 5;
  return sprite;
}

function ensureBusterShotVisual(projectile) {
  const mesh = projectile.mesh;
  if (mesh.userData.busterShotVisual) {
    return mesh.userData.busterShotVisual;
  }

  const textures = getBusterShotTextures();
  const group = new THREE.Group();
  group.name = 'projectileBusterShotVisual';

  const shell = createBusterShotSprite('busterShotTintedShell', textures.shell, DEFAULT_PROJECTILE_COLOR, 0.96, THREE.AdditiveBlending);
  const core = createBusterShotSprite('busterShotWhiteCore', textures.core, 0xffffff, 0.98, THREE.AdditiveBlending);
  const rim = createBusterShotSprite('busterShotWhiteRim', textures.rim, 0xffffff, 0.82, THREE.NormalBlending);

  group.add(shell, core, rim);
  group.userData.tintMaterials = [shell.material];
  group.userData.sprites = [shell, core, rim];
  mesh.add(group);
  mesh.userData.busterShotVisual = group;
  return group;
}

function setBusterShotRoll(projectile, roll) {
  const visual = projectile.mesh.userData.busterShotVisual;
  if (!visual) {
    return;
  }

  for (const sprite of visual.userData.sprites ?? []) {
    sprite.material.rotation = roll;
  }
}

function configureBusterShotVisual(projectile, radius) {
  const visual = ensureBusterShotVisual(projectile);
  const width = radius * BUSTER_SHOT_WIDTH_SCALE;
  const height = width / BUSTER_SHOT_ASPECT;

  visual.visible = true;
  visual.scale.set(width, height, 1);
  visual.userData.tintMaterials?.forEach((material) => {
    material.color.copy(projectile.mesh.material.color);
  });

  projectile.busterShotRoll = Math.random() * Math.PI * 2;
  setBusterShotRoll(projectile, projectile.busterShotRoll);
}

function setBusterShotVisible(projectile, visible) {
  const visual = projectile.mesh.userData.busterShotVisual;
  if (visual) {
    visual.visible = visible;
  }
}

function setProjectileCoreVisible(mesh, visible) {
  mesh.material.transparent = !visible;
  mesh.material.opacity = visible ? 1 : 0;
  mesh.material.depthWrite = visible;
  mesh.material.needsUpdate = true;
  mesh.castShadow = visible;
}

function usesPlayerBusterShotVisual(projectile, visualType) {
  return projectile.owner === 'player' && visualType === 'buster';
}

function ensureDrillProjectileVisual(projectile) {
  const mesh = projectile.mesh;
  if (mesh.userData.drillHeadVisual) {
    return mesh.userData.drillHeadVisual;
  }

  const group = new THREE.Group();
  group.name = 'projectileDrillHeadVisual';

  const bitMaterial = new THREE.MeshStandardMaterial({
    color: DEFAULT_PROJECTILE_COLOR,
    emissive: DEFAULT_PROJECTILE_COLOR,
    emissiveIntensity: 0.85,
    roughness: 0.34,
    metalness: 0.22,
  });
  bitMaterial.name = 'material_projectileDrillHeadBit';

  const collarMaterial = new THREE.MeshStandardMaterial({
    color: 0x4c6074,
    emissive: 0x17202a,
    emissiveIntensity: 0.14,
    roughness: 0.48,
    metalness: 0.36,
  });
  collarMaterial.name = 'material_projectileDrillHeadCollar';

  const bit = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.58, 18), bitMaterial);
  bit.name = 'projectileDrillHeadCone';
  bit.rotation.x = Math.PI / 2;
  bit.position.z = 0.34;

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 18), collarMaterial);
  collar.name = 'projectileDrillHeadCollar';
  collar.rotation.x = Math.PI / 2;
  collar.position.z = -0.02;

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 8, 18), collarMaterial);
  ring.name = 'projectileDrillHeadCuttingRing';
  ring.position.z = 0.18;

  group.add(bit, collar, ring);
  mesh.add(group);
  mesh.userData.drillHeadVisual = group;
  return group;
}

function tintDrillProjectileVisual(projectile) {
  const visual = ensureDrillProjectileVisual(projectile);
  const color = projectile.mesh.material.color;

  visual.traverse((object) => {
    if (!object.material) {
      return;
    }

    if (object.name === 'projectileDrillHeadCone') {
      object.material.color.copy(color);
      object.material.emissive.copy(color);
    }
  });
}

function applyProjectileVisual(projectile, visualType, radius) {
  const scale = radius / 0.16;
  const mesh = projectile.mesh;
  const playerBusterShot = usesPlayerBusterShotVisual(projectile, visualType);

  setBusterShotVisible(projectile, false);
  setProjectileCoreVisible(mesh, !playerBusterShot);

  if (mesh.userData.drillHeadVisual) {
    mesh.userData.drillHeadVisual.visible = false;
  }

  switch (visualType) {
    case 'buster':
      if (playerBusterShot) {
        projectile.baseVisualScale.set(1, 1, 1);
        mesh.material.emissiveIntensity = 0;
        configureBusterShotVisual(projectile, radius);
        break;
      }
      projectile.baseVisualScale.set(scale, scale, scale);
      mesh.material.emissiveIntensity = 0.65;
      break;
    case 'bullet':
      projectile.baseVisualScale.set(scale * 0.48, scale * 0.48, scale * 1.85);
      mesh.material.emissiveIntensity = 0.85;
      break;
    case 'pellet':
      projectile.baseVisualScale.set(scale * 0.72, scale * 0.72, scale * 1.18);
      mesh.material.emissiveIntensity = 0.7;
      break;
    case 'shell':
      projectile.baseVisualScale.set(scale * 0.9, scale * 0.9, scale * 1.7);
      mesh.material.emissiveIntensity = 0.5;
      break;
    case 'missile':
      projectile.baseVisualScale.set(scale * 0.72, scale * 0.72, scale * 2.2);
      mesh.material.emissiveIntensity = 0.42;
      break;
    case 'grenade':
      projectile.baseVisualScale.set(scale * 1.05, scale * 1.05, scale * 1.05);
      mesh.material.emissiveIntensity = 0.34;
      break;
    case 'seeker':
      projectile.baseVisualScale.set(scale * 1.12, scale * 1.12, scale * 1.12);
      mesh.material.emissiveIntensity = 1;
      break;
    case 'electricOrb':
      projectile.baseVisualScale.set(scale * 1.28, scale * 1.28, scale * 1.28);
      mesh.material.emissiveIntensity = 1.35;
      break;
    case 'drillHead':
      projectile.baseVisualScale.set(scale * 0.62, scale * 0.62, scale * 1.38);
      mesh.material.emissiveIntensity = 0.78;
      ensureDrillProjectileVisual(projectile).visible = true;
      tintDrillProjectileVisual(projectile);
      break;
    default:
      projectile.baseVisualScale.set(scale, scale, scale);
      mesh.material.emissiveIntensity = 0.65;
      break;
  }

  mesh.scale.copy(projectile.baseVisualScale);
}

function getTrailInterval(visualType) {
  switch (visualType) {
    case 'bullet':
    case 'pellet':
      return 0.07;
    case 'shell':
      return 0.045;
    case 'missile':
      return 0.035;
    case 'drillHead':
      return 0.032;
    case 'grenade':
    case 'seeker':
      return 0.06;
    case 'electricOrb':
      return 0.045;
    default:
      return 0;
  }
}

export class ProjectileSystem {
  constructor(game) {
    this.game = game;
    this.active = [];
    this.pool = [];
  }

  spawn({
    owner,
    position,
    direction,
    speed = 8,
    range = 6,
    radius = 0.16,
    damage = 1,
    color = DEFAULT_PROJECTILE_COLOR,
    source = null,
    critical = false,
    element = null,
    pierce = 0,
    explosiveRadius = 0,
    explodeOnExpire = false,
    armorBreakChance = 0,
    armorPierce = 0,
    stagger = 0,
    statusBuildup = 1,
    chainChance = 0,
    chainDamageMultiplier = 0.36,
    arcHeight = 0,
    homingStrength = 0,
    homingRange = 0,
    target = null,
    freeHoming = false,
    endY = position.y,
    visualType = 'buster',
    clusterCount = 0,
    clusterDamageMultiplier = 0.42,
    clusterExplosionRadius = 0.68,
    clusterSpreadRadius = 1.45,
    clusterArcHeight = 0.42,
    lifetime = Infinity,
    collisionRadius = radius,
    persistentOnPlayerHit = false,
    hitInterval = 0.35,
    maxPlayerHits = Infinity,
    landAsMine = false,
    mineLifetime = 5.5,
    mineArmDelay = 0.45,
    mineTriggerRadius = 1.05,
  }) {
    const projectile = this._getProjectile();
    projectile.owner = owner;
    projectile.direction.copy(direction).normalize();
    projectile.speed = speed;
    projectile.range = range;
    projectile.radius = radius;
    projectile.damage = damage;
    projectile.source = source;
    projectile.critical = critical;
    projectile.element = element;
    projectile.pierceRemaining = Math.max(0, Math.floor(pierce));
    projectile.explosiveRadius = explosiveRadius;
    projectile.explodeOnExpire = explodeOnExpire;
    projectile.armorBreakChance = armorBreakChance;
    projectile.armorPierce = armorPierce;
    projectile.stagger = stagger;
    projectile.statusBuildup = statusBuildup;
    projectile.chainChance = chainChance;
    projectile.chainDamageMultiplier = chainDamageMultiplier;
    projectile.arcHeight = arcHeight;
    projectile.homingStrength = homingStrength;
    projectile.homingRange = homingRange;
    projectile.target = target;
    projectile.freeHoming = freeHoming;
    projectile.visualType = visualType;
    projectile.clusterCount = Math.max(0, Math.floor(clusterCount));
    projectile.clusterDamageMultiplier = clusterDamageMultiplier;
    projectile.clusterExplosionRadius = clusterExplosionRadius;
    projectile.clusterSpreadRadius = clusterSpreadRadius;
    projectile.clusterArcHeight = clusterArcHeight;
    projectile.remainingLifetime = Number.isFinite(lifetime) ? Math.max(0.01, lifetime) : Infinity;
    projectile.collisionRadius = Math.max(radius, collisionRadius ?? radius);
    projectile.persistentOnPlayerHit = Boolean(persistentOnPlayerHit);
    projectile.playerHitCooldown = 0;
    projectile.hitInterval = Math.max(0.05, hitInterval);
    projectile.maxPlayerHits = Number.isFinite(maxPlayerHits) ? Math.max(1, Math.floor(maxPlayerHits)) : Infinity;
    projectile.playerHitCount = 0;
    projectile.landAsMine = Boolean(landAsMine);
    projectile.landedMine = false;
    projectile.mineLifetime = Math.max(0.5, mineLifetime);
    projectile.mineArmDelay = Math.max(0.05, mineArmDelay);
    projectile.mineArmTimer = projectile.mineArmDelay;
    projectile.mineTriggerRadius = Math.max(radius, mineTriggerRadius);
    projectile.mineArmed = false;
    projectile.trailTimer = 0;
    projectile.distance = 0;
    projectile.baseY = position.y;
    projectile.endY = endY;
    projectile.hitEnemyIds.clear();
    projectile.mesh.position.copy(position);
    projectile.mesh.visible = true;
    projectile.mesh.material.color.set(color);
    projectile.mesh.material.emissive.set(color);
    applyProjectileVisual(projectile, visualType, radius);
    projectile.mesh.userData.projectile = projectile;

    if (visualType === 'grenade') {
      this._ensureGroundShadow(projectile);
    } else if (projectile.shadow) {
      projectile.shadow.visible = false;
      projectile.shadow.removeFromParent();
    }

    this.game.scene.add(projectile.mesh);
    this.active.push(projectile);
    return projectile;
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const projectile = this.active[i];
      const travel = projectile.speed * dt;

      projectile.playerHitCooldown = Math.max(0, projectile.playerHitCooldown - dt);
      projectile.remainingLifetime -= dt;
      if (projectile.remainingLifetime <= 0) {
        this._deactivate(i, true);
        continue;
      }

      if (projectile.landedMine) {
        projectile.mineArmTimer = Math.max(0, projectile.mineArmTimer - dt);
        projectile.mineArmed = projectile.mineArmTimer <= 0;
        const pulse = projectile.mineArmed
          ? 1 + Math.sin(this.game.elapsedTime * 9) * 0.11
          : 0.82 + (1 - projectile.mineArmTimer / projectile.mineArmDelay) * 0.18;
        projectile.mesh.scale.copy(projectile.baseVisualScale).multiplyScalar(pulse);
        projectile.mesh.material.emissiveIntensity = projectile.mineArmed ? 1.1 : 0.35;
        this._updateGroundShadow(projectile);
        if (projectile.mineArmed
          && projectile.mesh.position.distanceTo(this.game.player.root.position) <= projectile.mineTriggerRadius + this.game.player.radius) {
          this._deactivate(i, true);
        }
        continue;
      }

      this._updateHoming(projectile, dt);
      projectile.mesh.position.addScaledVector(projectile.direction, travel);
      projectile.distance += travel;
      if (projectile.arcHeight > 0) {
        const progress = THREE.MathUtils.clamp(projectile.distance / Math.max(0.001, projectile.range), 0, 1);
        projectile.mesh.position.y = THREE.MathUtils.lerp(projectile.baseY, projectile.endY, progress) + Math.sin(progress * Math.PI) * projectile.arcHeight;
      }
      this._updateProjectileVisual(projectile, dt);

      if (projectile.owner === 'player') {
        if (this._checkEnemyHit(projectile)) {
          this._deactivate(i);
          continue;
        }
        if (projectile.visualType === 'drillHead' && this._checkJunkHit(projectile)) {
          this._deactivate(i);
          continue;
        }
      } else if (this._checkPlayerHit(projectile)) {
        this._deactivate(i);
        continue;
      }

      if (projectile.distance >= projectile.range) {
        if (projectile.landAsMine) {
          this._landMine(projectile);
        } else {
          this._deactivate(i, true);
        }
      }
    }
  }

  clear() {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      this._deactivate(i, false, false);
    }
  }

  _checkEnemyHit(projectile) {
    const position = projectile.mesh.position;

    for (const enemy of this.game.enemies) {
      if (enemy.dead) {
        continue;
      }

      const resolvedPart = enemy.resolveProjectileHit?.(
        position,
        projectile.radius,
        projectile.direction,
      ) ?? null;
      const radius = projectile.radius + enemy.radius;
      const enemyHeight = getTargetCollisionHeight(enemy);
      if (resolvedPart || getProjectileCapsuleDistanceSquared(position, enemy, enemyHeight) <= radius * radius) {
        if (projectile.hitEnemyIds.has(enemy.id)) {
          continue;
        }

        projectile.hitEnemyIds.add(enemy.id);
        this.game.damageEnemy(enemy, projectile.damage, {
          projectileHit: true,
          enemyHitStopDuration: projectile.visualType === 'drillHead'
            ? DRILL_PROJECTILE_ENEMY_HIT_STOP_DURATION
            : PROJECTILE_ENEMY_HIT_STOP_DURATION,
          critical: projectile.critical,
          source: projectile.source,
          element: projectile.element,
          armorBreakChance: projectile.armorBreakChance,
          armorPierce: projectile.armorPierce,
          stagger: projectile.stagger,
          statusBuildup: projectile.statusBuildup,
          chainChance: projectile.chainChance,
          chainDamageMultiplier: projectile.chainDamageMultiplier,
          knockbackDirection: projectile.direction,
          knockback: 2.1,
          hitPartId: resolvedPart?.hitPartId ?? null,
          weakPointHit: Boolean(resolvedPart?.weakPointHit),
          hitPosition: resolvedPart?.hitPosition ?? position.clone(),
        });

        if (projectile.explosiveRadius > 0) {
          tempExplosionPosition.copy(position);
          this.game.addExplosion(tempExplosionPosition, projectile.damage * 0.62, projectile.explosiveRadius, projectile.mesh.material.color.getHex(), {
            source: projectile.source,
            element: projectile.element,
            critical: projectile.critical,
            armorBreakChance: projectile.armorBreakChance,
            armorPierce: projectile.armorPierce,
            statusBuildup: projectile.statusBuildup,
            stagger: projectile.stagger,
            enemyHitStopDuration: PROJECTILE_EXPLOSION_ENEMY_HIT_STOP_DURATION,
            globalHitStopDuration: 0,
          });
        }

        if (projectile.pierceRemaining <= 0) {
          return true;
        }

        projectile.pierceRemaining -= 1;
        return false;
      }
    }

    return false;
  }

  _checkJunkHit(projectile) {
    const hits = this.game.damageJunkAtPosition?.(
      projectile.mesh.position,
      projectile.radius * 1.25,
      projectile.damage * 3.2,
      {
        color: projectile.mesh.material.color.getHex(),
        source: projectile.source,
        tool: 'drill',
      },
    ) ?? 0;

    return hits > 0;
  }

  _checkPlayerHit(projectile) {
    const player = this.game.player;

    if (projectile.persistentOnPlayerHit && projectile.playerHitCooldown > 0) {
      return false;
    }

    const radius = (projectile.collisionRadius ?? projectile.radius) + player.radius;
    if (getProjectileCapsuleDistanceSquared(
      projectile.mesh.position,
      player,
      PLAYER_TRAVERSAL_ENVELOPE.standingHeight,
    ) <= radius * radius) {
      const dealt = player.takeDamage(projectile.damage, projectile.source, {
        impactPosition: projectile.mesh.position,
        attackKind: projectile.visualType,
      });
      projectile.source?.onHitPlayer?.(player, dealt);
      this.game.addDamageNumber(player.root.position, dealt, 0xff6b5e);
      this.game.addHitEffect(player.root.position, 0xff6b5e, 0.45);
      if (dealt > 0) {
        this.game.requestHitStop?.(projectile.visualType === 'drillHead' ? 0.1 : 0.12, {
          timeScale: 0.05,
        });
      }
      if (projectile.explosiveRadius > 0) {
        tempExplosionPosition.copy(projectile.mesh.position);
        this.game.addExplosion(tempExplosionPosition, projectile.damage, projectile.explosiveRadius, projectile.mesh.material.color.getHex(), {
          source: projectile.source,
          element: projectile.element,
          damageEnemies: false,
          damagePlayer: false,
          triggerMines: false,
        });
      }
      projectile.playerHitCount += 1;
      projectile.playerHitCooldown = projectile.hitInterval;
      return !projectile.persistentOnPlayerHit || projectile.playerHitCount >= projectile.maxPlayerHits;
    }

    return false;
  }

  _landMine(projectile) {
    projectile.landedMine = true;
    projectile.mineArmed = false;
    projectile.mineArmTimer = projectile.mineArmDelay;
    projectile.speed = 0;
    projectile.distance = 0;
    projectile.range = Infinity;
    projectile.arcHeight = 0;
    projectile.remainingLifetime = projectile.mineLifetime;
    projectile.mesh.position.y = projectile.endY + Math.max(0.06, projectile.radius * 0.45);
    projectile.mesh.rotation.set(0, 0, 0);
    projectile.mesh.scale.copy(projectile.baseVisualScale).multiplyScalar(0.82);
    this._ensureGroundShadow(projectile);
    this.game.addParticleBurst(projectile.mesh.position, projectile.mesh.material.color.getHex(), 6, projectile.radius * 0.35);
  }

  _getProjectile() {
    const projectile = this.pool.pop();

    if (projectile) {
      return projectile;
    }

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 8),
      new THREE.MeshStandardMaterial({
        color: DEFAULT_PROJECTILE_COLOR,
        emissive: DEFAULT_PROJECTILE_COLOR,
        emissiveIntensity: 0.65,
        roughness: 0.28,
      }),
    );
    mesh.name = 'pooledProjectile';
    mesh.castShadow = true;

    return {
      mesh,
      direction: new THREE.Vector3(),
      owner: null,
      speed: 0,
      range: 0,
      radius: 0,
      damage: 0,
      source: null,
      critical: false,
      element: null,
      explosiveRadius: 0,
      explodeOnExpire: false,
      armorBreakChance: 0,
      armorPierce: 0,
      stagger: 0,
      statusBuildup: 1,
      chainChance: 0,
      chainDamageMultiplier: 0.36,
      arcHeight: 0,
      homingStrength: 0,
      homingRange: 0,
      target: null,
      freeHoming: false,
      visualType: 'buster',
      clusterCount: 0,
      clusterDamageMultiplier: 0.42,
      clusterExplosionRadius: 0.68,
      clusterSpreadRadius: 1.45,
      clusterArcHeight: 0.42,
      remainingLifetime: Infinity,
      collisionRadius: 0,
      persistentOnPlayerHit: false,
      playerHitCooldown: 0,
      hitInterval: 0.35,
      maxPlayerHits: Infinity,
      playerHitCount: 0,
      landAsMine: false,
      landedMine: false,
      mineLifetime: 5.5,
      mineArmDelay: 0.45,
      mineArmTimer: 0.45,
      mineTriggerRadius: 1.05,
      mineArmed: false,
      trailTimer: 0,
      baseVisualScale: new THREE.Vector3(1, 1, 1),
      busterShotRoll: 0,
      shadow: null,
      baseY: 0,
      endY: 0,
      pierceRemaining: 0,
      hitEnemyIds: new Set(),
      distance: 0,
    };
  }

  _updateHoming(projectile, dt) {
    if (projectile.owner !== 'player' || projectile.homingStrength <= 0) {
      return;
    }

    const requestedOwner = getCombatTargetOwner(projectile.target);
    let nearest = projectile.target
      && projectile.target.active !== false
      && !projectile.target.dead
      && !projectile.hitEnemyIds.has(requestedOwner?.id)
      ? projectile.target
      : requestedOwner && !requestedOwner.dead && !projectile.hitEnemyIds.has(requestedOwner.id)
        ? requestedOwner
        : null;

    if (!nearest && !projectile.freeHoming) {
      return;
    }

    let nearestDistanceSq = Math.max(1, projectile.homingRange || projectile.range) ** 2;

    if (!nearest) {
      for (const enemy of this.game.enemies) {
        if (enemy.dead || projectile.hitEnemyIds.has(enemy.id)) {
          continue;
        }

        const enemyHeight = getTargetCollisionHeight(enemy);
        tempPosition.set(
          enemy.root.position.x,
          enemy.root.position.y + enemyHeight * 0.55,
          enemy.root.position.z,
        );
        const distanceSq = projectile.mesh.position.distanceToSquared(tempPosition);

        if (distanceSq < nearestDistanceSq) {
          nearestDistanceSq = distanceSq;
          nearest = enemy;
        }
      }
    }

    if (!nearest) {
      return;
    }

    if (nearest?.isWeakPointTarget) {
      getCombatTargetWorldPosition(nearest, tempDirection).sub(projectile.mesh.position);
    } else {
      const targetHeight = getTargetCollisionHeight(nearest);
      tempDirection.set(
        nearest.root.position.x,
        nearest.root.position.y + targetHeight * 0.55,
        nearest.root.position.z,
      ).sub(projectile.mesh.position);
    }

    if (tempDirection.lengthSq() <= 0.001) {
      return;
    }

    tempDirection.normalize();
    projectile.direction.lerp(tempDirection, THREE.MathUtils.clamp(projectile.homingStrength * dt, 0, 0.28)).normalize();
  }

  _updateProjectileVisual(projectile, dt) {
    const mesh = projectile.mesh;

    if (projectile.visualType === 'grenade') {
      mesh.rotation.x += dt * 9;
      mesh.rotation.y += dt * 4.5;
      this._updateGroundShadow(projectile);
    } else {
      tempPosition.copy(mesh.position).add(projectile.direction);
      mesh.lookAt(tempPosition);

      if (projectile.visualType === 'electricOrb') {
        const pulse = 1 + Math.sin(this.game.elapsedTime * 13 + projectile.distance * 2.5) * 0.18;
        mesh.scale.copy(projectile.baseVisualScale).multiplyScalar(pulse);
        mesh.rotation.x += dt * 2.4;
        mesh.rotation.y -= dt * 3.1;
      } else if (projectile.visualType === 'seeker') {
        const pulse = 1 + Math.sin(this.game.elapsedTime * 18 + projectile.distance * 2) * 0.13;
        mesh.scale.copy(projectile.baseVisualScale).multiplyScalar(pulse);
      } else if (usesPlayerBusterShotVisual(projectile, projectile.visualType)) {
        projectile.busterShotRoll += dt * BUSTER_SHOT_ROTATION_SPEED;
        setBusterShotRoll(projectile, projectile.busterShotRoll);
      } else if (projectile.visualType === 'drillHead') {
        mesh.rotateZ(dt * 34);
      }
    }

    const interval = getTrailInterval(projectile.visualType);
    if (interval <= 0) {
      return;
    }

    projectile.trailTimer -= dt;
    if (projectile.trailTimer <= 0) {
      projectile.trailTimer = interval;
      this._emitTrail(projectile);
    }
  }

  _emitTrail(projectile) {
    tempPosition.copy(projectile.mesh.position).addScaledVector(projectile.direction, -projectile.radius * 1.5);

    switch (projectile.visualType) {
      case 'missile':
        this.game.addParticleBurst(tempPosition, 0xffe2a3, 2, projectile.radius * 0.42);
        break;
      case 'shell':
        this.game.addParticleBurst(tempPosition, 0xff9d4f, 2, projectile.radius * 0.32);
        break;
      case 'grenade':
        this.game.addParticleBurst(tempPosition, 0x7a6a58, 1, projectile.radius * 0.22);
        break;
      case 'seeker':
        this.game.addParticleBurst(tempPosition, projectile.mesh.material.color.getHex(), 1, projectile.radius * 0.34);
        break;
      case 'electricOrb':
        this.game.addParticleBurst(tempPosition, projectile.mesh.material.color.getHex(), 2, projectile.radius * 0.46);
        break;
      case 'drillHead':
        this.game.addParticleBurst(tempPosition, projectile.mesh.material.color.getHex(), 2, projectile.radius * 0.22);
        break;
      case 'bullet':
      case 'pellet':
        this.game.addParticleBurst(tempPosition, projectile.mesh.material.color.getHex(), 1, projectile.radius * 0.18);
        break;
      default:
        break;
    }
  }

  _ensureGroundShadow(projectile) {
    if (!projectile.shadow) {
      projectile.shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.28, 24),
        new THREE.MeshBasicMaterial({
          color: 0x070805,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
        }),
      );
      projectile.shadow.name = 'grenadeProjectileGroundShadow';
      projectile.shadow.rotation.x = -Math.PI / 2;
    }

    projectile.shadow.visible = true;
    this.game.scene.add(projectile.shadow);
    this._updateGroundShadow(projectile);
  }

  _updateGroundShadow(projectile) {
    if (!projectile.shadow?.visible) {
      return;
    }

    const height = Math.max(0, projectile.mesh.position.y - projectile.endY);
    const spread = THREE.MathUtils.clamp(1 + height * 0.18, 1, 1.55);
    const opacity = THREE.MathUtils.clamp(0.24 - height * 0.035, 0.08, 0.24);

    projectile.shadow.position.set(
      projectile.mesh.position.x,
      projectile.endY + 0.026,
      projectile.mesh.position.z,
    );
    projectile.shadow.scale.setScalar((projectile.radius / 0.22) * spread);
    projectile.shadow.material.opacity = opacity;
  }

  _spawnClusterProjectiles(projectile) {
    if (projectile.clusterCount <= 0) {
      return;
    }

    const origin = projectile.mesh.position.clone();
    origin.y = Math.max(0.18, projectile.endY + 0.08);
    const count = projectile.clusterCount;
    const baseAngle = Math.atan2(projectile.direction.x, projectile.direction.z);
    const color = projectile.mesh.material.color.getHex();

    for (let i = 0; i < count; i += 1) {
      const offset = (i / count) * Math.PI * 2;
      const wobble = (Math.random() - 0.5) * 0.22;
      const angle = baseAngle + offset + wobble;
      tempClusterDirection.set(Math.sin(angle), 0, Math.cos(angle)).normalize();

      this.spawn({
        owner: projectile.owner,
        position: origin,
        direction: tempClusterDirection,
        speed: Math.max(2.6, projectile.speed * 0.46),
        range: projectile.clusterSpreadRadius,
        radius: projectile.radius * 0.52,
        damage: projectile.damage * projectile.clusterDamageMultiplier,
        color,
        source: projectile.source,
        critical: projectile.critical,
        element: projectile.element,
        pierce: 0,
        explosiveRadius: projectile.clusterExplosionRadius,
        explodeOnExpire: true,
        armorBreakChance: projectile.armorBreakChance,
        armorPierce: projectile.armorPierce,
        stagger: Math.max(0.08, projectile.stagger * 0.5),
        statusBuildup: projectile.statusBuildup,
        chainChance: projectile.chainChance,
        chainDamageMultiplier: projectile.chainDamageMultiplier,
        arcHeight: projectile.clusterArcHeight,
        endY: projectile.endY + 0.12,
        visualType: 'grenade',
      });
    }

    this.game.addParticleBurst(origin, color, 10, projectile.radius * 0.38);
  }

  _deactivate(index, expired = false, allowCluster = true) {
    const projectile = this.active[index];
    this.active.splice(index, 1);
    if (expired && projectile.explodeOnExpire && projectile.explosiveRadius > 0) {
      tempExplosionPosition.copy(projectile.mesh.position);
      const fromEnemy = projectile.owner !== 'player';
      this.game.addExplosion(tempExplosionPosition, projectile.damage * 0.72, projectile.explosiveRadius, projectile.mesh.material.color.getHex(), {
        source: projectile.source,
        element: projectile.element,
        damageEnemies: !fromEnemy,
        damagePlayer: true,
        playerDamageScale: fromEnemy ? 1 : 0.35,
        enemyHitStopDuration: fromEnemy ? undefined : PROJECTILE_EXPLOSION_ENEMY_HIT_STOP_DURATION,
        globalHitStopDuration: fromEnemy ? undefined : 0,
        triggerMines: !fromEnemy,
      });
    }
    if (allowCluster) {
      this._spawnClusterProjectiles(projectile);
    }
    this.game.addParticleBurst(projectile.mesh.position, projectile.mesh.material.color.getHex(), 10, projectile.radius);
    projectile.mesh.visible = false;
    projectile.mesh.removeFromParent();
    projectile.source = null;
    projectile.target = null;
    projectile.freeHoming = false;
    projectile.visualType = 'buster';
    projectile.clusterCount = 0;
    projectile.clusterDamageMultiplier = 0.42;
    projectile.clusterExplosionRadius = 0.68;
    projectile.clusterSpreadRadius = 1.45;
    projectile.clusterArcHeight = 0.42;
    projectile.remainingLifetime = Infinity;
    projectile.collisionRadius = 0;
    projectile.persistentOnPlayerHit = false;
    projectile.playerHitCooldown = 0;
    projectile.hitInterval = 0.35;
    projectile.maxPlayerHits = Infinity;
    projectile.playerHitCount = 0;
    projectile.landAsMine = false;
    projectile.landedMine = false;
    projectile.mineLifetime = 5.5;
    projectile.mineArmDelay = 0.45;
    projectile.mineArmTimer = 0.45;
    projectile.mineTriggerRadius = 1.05;
    projectile.mineArmed = false;
    projectile.trailTimer = 0;
    projectile.busterShotRoll = 0;
    setBusterShotVisible(projectile, false);
    if (projectile.shadow) {
      projectile.shadow.visible = false;
      projectile.shadow.removeFromParent();
    }
    projectile.hitEnemyIds.clear();
    this.pool.push(projectile);
  }
}
