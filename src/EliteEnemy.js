import * as THREE from 'three';
import { Enemy } from './Enemy.js';

export const ELITE_AFFIXES = [
  {
    id: 'burningCore',
    label: 'Burning Core',
    color: 0xff5b2d,
    description: 'Leaves damaging fire zones.',
  },
  {
    id: 'frostCore',
    label: 'Frost Core',
    color: 0x7ed8ff,
    description: 'Slows the player on hit.',
  },
  {
    id: 'overcharged',
    label: 'Overcharged',
    color: 0x9df7ff,
    description: 'Emits interrupting shock surges.',
  },
  {
    id: 'armored',
    label: 'Armored',
    color: 0xbec8d6,
    description: 'Takes reduced damage.',
  },
  {
    id: 'swift',
    label: 'Swift Servo',
    color: 0xb8ff7a,
    description: 'Moves faster.',
  },
  {
    id: 'corrosive',
    label: 'Corrosive',
    color: 0xa6e86f,
    description: 'Applies armor-reducing acid damage.',
  },
  {
    id: 'explosiveCore',
    label: 'Explosive Core',
    color: 0xffb347,
    description: 'Explodes on death.',
  },
  {
    id: 'refractorRich',
    label: 'Refractor-Rich',
    color: 0xffcf66,
    description: 'Carries better salvage and extra refractor shards.',
  },
];

function pickEliteAffix() {
  return ELITE_AFFIXES[Math.floor(Math.random() * ELITE_AFFIXES.length)];
}

export class EliteEnemy extends Enemy {
  constructor(typeKey = 'basic', level = 1, affix = pickEliteAffix()) {
    super(typeKey, level + 1, {});

    this.isElite = true;
    this.affix = affix;
    this.id = `elite-${affix.id}-${this.id}`;
    this.root.name = this.id;
    this.root.userData.enemy = this;
    this.root.scale.multiplyScalar(1.16);
    this.radius *= 1.18;
    this.burnTimer = 0.8;
    this.surgeTimer = 1.1;

    this.stats.maxHealth *= 2.25;
    this.stats.damage *= 1.45;
    this.stats.experience = Math.round(this.stats.experience * 3.2);
    this.health = this.stats.maxHealth;

    if (affix.id === 'swift') {
      this.stats.moveSpeed *= 1.38;
      this.stats.attackCooldown *= 0.82;
    }

    if (affix.id === 'armored') {
      this.stats.armor += 35;
    }

    if (affix.id === 'overcharged') {
      this.stats.attackCooldown *= 0.88;
    }

    if (affix.id === 'refractorRich') {
      this.stats.maxHealth *= 1.18;
      this.stats.experience = Math.round(this.stats.experience * 1.35);
      this.health = this.stats.maxHealth;
    }

    this._addEliteVisuals();
    this._captureMaterialStates();
  }

  update(dt, game) {
    super.update(dt, game);

    if (this.dead) {
      return;
    }

    if (this.affix.id === 'burningCore') {
      this.burnTimer -= dt;

      if (this.burnTimer <= 0) {
        game.addFireZone(this.root.position, this.stats.damage * 0.45, 2.4, 1.15);
        this.burnTimer = 1.35;
      }
    }

    if (this.affix.id === 'overcharged') {
      this.surgeTimer -= dt;

      if (this.surgeTimer <= 0) {
        if (this.root.position.distanceTo(game.player.root.position) <= 2.1) {
          game.player.takeDamage(this.stats.damage * 0.22, this);
          game.player.applySlow(0.78, 0.5);
          game.addHitEffect(game.player.root.position, this.affix.color, 0.48);
        }
        this.surgeTimer = 1.15;
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

    if (this.affix.id === 'armored') {
      return baseAmount * (this.hasStatus('armorBreak') ? 0.95 : 0.72);
    }

    if (this.affix.id === 'burningCore' && meta.element === 'fire') {
      return baseAmount * 0.72;
    }

    if (this.affix.id === 'frostCore') {
      if (meta.element === 'ice') return baseAmount * 0.7;
      if (meta.element === 'fire') return baseAmount * 1.12;
    }

    if (this.affix.id === 'overcharged' && meta.element === 'shock') {
      return baseAmount * 0.66;
    }

    return baseAmount;
  }

  onHitPlayer(player, dealt = 0) {
    if (this.affix.id === 'frostCore') {
      player.applySlow(0.55, 1.5);
    }

    if (this.affix.id === 'corrosive') {
      player.takeDamage(Math.max(1, dealt * 0.22), this);
    }

    return player;
  }

  onDeath(game, meta = {}) {
    super.onDeath(game);
    if (this.affix.id === 'explosiveCore' && !meta.selfDestruct) {
      game.addExplosion(this.root.position, this.stats.damage * 2.2, 2.25, this.affix.color, { source: this });
    }

    if (this.affix.id === 'burningCore') {
      game.addFireZone(this.root.position, this.stats.damage * 0.5, 2.4, 1.25, { source: this });
    }

    if (this.affix.id === 'refractorRich') {
      game.addParticleBurst(this.root.position, this.affix.color, 24, 0.22);
    }
  }

  _addEliteVisuals() {
    const auraMaterial = new THREE.MeshStandardMaterial({
      color: this.affix.color,
      emissive: this.affix.color,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
      roughness: 0.45,
    });

    const aura = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.64, 32), auraMaterial);
    aura.name = 'eliteAuraRing';
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.04;

    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 8, 24), auraMaterial);
    crown.name = 'eliteGlowCrown';
    crown.position.y = 3.25;
    crown.rotation.x = Math.PI / 2;

    this.root.add(aura, crown);

    this.root.traverse((object) => {
      if (object.material?.emissive) {
        object.material.emissive.set(this.affix.color);
        object.material.emissiveIntensity = Math.max(object.material.emissiveIntensity ?? 0, 0.08);
      }
    });
  }
}
