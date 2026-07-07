import * as THREE from 'three';
import { EliteEnemy, ELITE_AFFIXES } from './EliteEnemy.js';
import { Enemy } from './Enemy.js';

const TYPE_WEIGHTS = [
  ['basic', 42],
  ['fast', 22],
  ['tank', 14],
  ['ranged', 16],
  ['horokko', 10],
  ['gorubesshu', 7],
];

function weightedType() {
  const total = TYPE_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;

  for (const [type, weight] of TYPE_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) {
      return type;
    }
  }

  return 'basic';
}

function randomPointAround(center, minRadius, maxRadius) {
  const angle = Math.random() * Math.PI * 2;
  const radius = THREE.MathUtils.lerp(minRadius, maxRadius, Math.random());
  return new THREE.Vector3(
    center.x + Math.cos(angle) * radius,
    0,
    center.z + Math.sin(angle) * radius,
  );
}

export class EnemySpawner {
  constructor(game) {
    this.game = game;
    this.spawnTimer = 0.25;
    this.waveTimer = 8;
    this.elapsed = 0;
    this.wave = 1;
  }

  update(dt) {
    this.elapsed += dt;
    this.spawnTimer -= dt;
    this.waveTimer -= dt;

    const difficulty = this.getDifficulty();
    const maxEnemies = Math.min(90, 16 + Math.floor(difficulty * 6));

    if (this.game.enemies.length < maxEnemies && this.spawnTimer <= 0) {
      this.spawnEnemy();
      this.spawnTimer = Math.max(0.22, 1.65 - difficulty * 0.07);
    }

    if (this.waveTimer <= 0) {
      this.spawnWave();
      this.wave += 1;
      this.waveTimer = Math.max(10, 18 - difficulty * 0.4);
    }
  }

  getDifficulty() {
    return 1 + this.elapsed / 45 + this.wave * 0.08;
  }

  spawnWave(count = null) {
    const difficulty = this.getDifficulty();
    const waveCount = count ?? Math.min(16, 3 + Math.floor(difficulty * 1.8));

    for (let i = 0; i < waveCount; i += 1) {
      this.spawnEnemy();
    }
  }

  spawnEnemy(typeKey = weightedType(), forceElite = false) {
    const difficulty = this.getDifficulty();
    const level = Math.max(1, Math.floor(difficulty));
    const eliteChance = Math.min(0.26, 0.035 + difficulty * 0.015);
    const isElite = forceElite || Math.random() < eliteChance;
    const enemy = isElite
      ? new EliteEnemy(typeKey, level, ELITE_AFFIXES[Math.floor(Math.random() * ELITE_AFFIXES.length)])
      : new Enemy(typeKey, level);

    enemy.root.position.copy(randomPointAround(this.game.player.root.position, 13, 19));
    this.game.addEnemy(enemy);
    return enemy;
  }

  spawnInitialPack() {
    this.spawnEnemy('basic', false);
    this.spawnEnemy('fast', false);
    this.spawnEnemy('ranged', false);
    if (Math.random() < 0.65) {
      this.spawnEnemy('horokko', false);
    }
    if (Math.random() < 0.35) {
      this.spawnEnemy('gorubesshu', false);
    }

    for (let i = 0; i < 2; i += 1) {
      this.spawnEnemy('basic', false);
    }
  }
}
