import * as THREE from 'three';

const DEFAULT_PROJECTILE_COLOR = 0x9fe8ff;
const PROJECTILE_ENEMY_HIT_STOP_DURATION = 0.055;
const DRILL_PROJECTILE_ENEMY_HIT_STOP_DURATION = 0.09;
const PROJECTILE_EXPLOSION_ENEMY_HIT_STOP_DURATION = 0.08;
const tempPosition = new THREE.Vector3();
const tempDirection = new THREE.Vector3();
const tempExplosionPosition = new THREE.Vector3();
const tempClusterDirection = new THREE.Vector3();

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

  if (mesh.userData.drillHeadVisual) {
    mesh.userData.drillHeadVisual.visible = false;
  }

  switch (visualType) {
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
        this._deactivate(i, true);
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

      tempPosition.copy(enemy.root.position);
      tempPosition.y = position.y;

      const radius = projectile.radius + enemy.radius;
      if (position.distanceToSquared(tempPosition) <= radius * radius) {
        if (projectile.hitEnemyIds.has(enemy.id)) {
          continue;
        }

        projectile.hitEnemyIds.add(enemy.id);
        this.game.damageEnemy(enemy, projectile.damage, {
          projectileHit: true,
          hitPosition: position.clone(),
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
        });

        if (projectile.explosiveRadius > 0) {
          tempExplosionPosition.copy(position);
          tempExplosionPosition.y = 0.08;
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

    tempPosition.copy(player.root.position);
    tempPosition.y = projectile.mesh.position.y;

    const radius = projectile.radius + player.radius;
    if (projectile.mesh.position.distanceToSquared(tempPosition) <= radius * radius) {
      const dealt = player.takeDamage(projectile.damage, projectile.source);
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
        tempExplosionPosition.y = 0.08;
        this.game.addExplosion(tempExplosionPosition, projectile.damage, projectile.explosiveRadius, projectile.mesh.material.color.getHex(), {
          source: projectile.source,
          element: projectile.element,
          damageEnemies: false,
          damagePlayer: false,
          triggerMines: false,
        });
      }
      return true;
    }

    return false;
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
      trailTimer: 0,
      baseVisualScale: new THREE.Vector3(1, 1, 1),
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

    let nearest = projectile.target && !projectile.target.dead && !projectile.hitEnemyIds.has(projectile.target.id)
      ? projectile.target
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

        tempPosition.copy(enemy.root.position);
        tempPosition.y = projectile.mesh.position.y;
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

    tempDirection.copy(nearest.root.position).sub(projectile.mesh.position);
    tempDirection.y = 0;

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

      if (projectile.visualType === 'seeker') {
        const pulse = 1 + Math.sin(this.game.elapsedTime * 18 + projectile.distance * 2) * 0.13;
        mesh.scale.copy(projectile.baseVisualScale).multiplyScalar(pulse);
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

    projectile.shadow.position.set(projectile.mesh.position.x, 0.026, projectile.mesh.position.z);
    projectile.shadow.scale.setScalar((projectile.radius / 0.22) * spread);
    projectile.shadow.material.opacity = opacity;
  }

  _spawnClusterProjectiles(projectile) {
    if (projectile.clusterCount <= 0 || projectile.owner !== 'player') {
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
        endY: 0.12,
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
      tempExplosionPosition.y = 0.08;
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
    projectile.trailTimer = 0;
    if (projectile.shadow) {
      projectile.shadow.visible = false;
      projectile.shadow.removeFromParent();
    }
    projectile.hitEnemyIds.clear();
    this.pool.push(projectile);
  }
}
