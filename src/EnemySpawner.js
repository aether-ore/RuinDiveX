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

function randomDungeonSpawnPoint(game, center, minDistance = 9) {
  const points = game.dungeon?.enemySpawnPoints;

  if (!points?.length) {
    return null;
  }

  const minDistanceSq = minDistance * minDistance;
  const candidates = points.filter((point) => point.distanceToSquared(center) >= minDistanceSq);
  const pool = candidates.length > 0 ? candidates : points;
  const point = pool[Math.floor(Math.random() * pool.length)].clone();
  point.x += (Math.random() - 0.5) * 1.25;
  point.z += (Math.random() - 0.5) * 1.25;
  point.y = 0;
  return point;
}

export class EnemySpawner {
  constructor(game) {
    this.game = game;
    this.elapsed = 0;
    this.wave = 1;
  }

  update(dt) {
    if (this.game.dungeonController?.isPlayerInSafeZone?.()) {
      return;
    }

    this.elapsed += dt;

    const encounter = this.game.dungeonController?.getUnspawnedEncounterAt?.(this.game.player.root.position);
    if (encounter) {
      this.spawnEncounter(encounter);
    }
  }

  getDifficulty() {
    return Math.max(1, this.game.ruinFloor ?? 1) + this.elapsed / 120 + this.wave * 0.08;
  }

  spawnWave(count = null) {
    const difficulty = this.getDifficulty();
    const waveCount = count ?? Math.min(16, 3 + Math.floor(difficulty * 1.8));

    for (let i = 0; i < waveCount; i += 1) {
      this.spawnEnemy();
    }
  }

  spawnEnemy(typeKey = weightedType(), forceElite = false, position = null) {
    const difficulty = this.getDifficulty();
    const level = Math.max(1, Math.floor(difficulty));
    const eliteChance = Math.min(0.26, 0.035 + difficulty * 0.015);
    const isElite = forceElite || Math.random() < eliteChance;
    const enemy = isElite
      ? new EliteEnemy(typeKey, level, ELITE_AFFIXES[Math.floor(Math.random() * ELITE_AFFIXES.length)])
      : new Enemy(typeKey, level);

    enemy.root.position.copy(position
      ?? randomDungeonSpawnPoint(this.game, this.game.player.root.position)
      ?? randomPointAround(this.game.player.root.position, 13, 19));
    this.game.addEnemy(enemy);
    return enemy;
  }

  spawnEncounter(encounter) {
    const enemies = [];
    const spawnPoints = encounter.spawnPoints?.length
      ? encounter.spawnPoints
      : [encounter.zone.position];
    const roster = encounter.roster?.length ? encounter.roster : ['basic', 'fast', 'ranged'];

    for (let i = 0; i < roster.length; i += 1) {
      const spawnPoint = spawnPoints[i % spawnPoints.length].clone();
      spawnPoint.x += (Math.random() - 0.5) * 0.65;
      spawnPoint.z += (Math.random() - 0.5) * 0.65;
      const forceElite = encounter.id === 'shrineDefense' && i === 0;
      const enemy = this.spawnEnemy(roster[i], forceElite, spawnPoint);
      enemy.encounterId = encounter.id;
      enemies.push(enemy);
    }

    this.game.dungeonController?.markEncounterSpawned?.(encounter.id, enemies);
    return enemies;
  }

  spawnInitialPack() {
    // Encounters now spawn when the player enters dungeon rooms.
  }
}
