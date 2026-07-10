import * as THREE from 'three';
import { EliteEnemy, ELITE_AFFIXES } from './EliteEnemy.js';
import { Enemy } from './Enemy.js';
import { ReaverbotEnemy } from './reaverbots/ReaverbotEnemy.js';
import {
  createEncounterSlotSeed,
  generateReaverbotGenome,
} from './reaverbots/ReaverbotGenerator.js';
import { hashSeed, SeededRandom } from './reaverbots/SeededRandom.js';

const TYPE_WEIGHTS = [
  ['basic', 42],
  ['fast', 22],
  ['tank', 14],
  ['ranged', 16],
  ['horokko', 10],
  ['gorubesshu', 7],
];

function weightedType(random = Math.random) {
  const total = TYPE_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;

  for (const [type, weight] of TYPE_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) {
      return type;
    }
  }

  return 'basic';
}

function randomPointAround(center, minRadius, maxRadius, random = Math.random) {
  const angle = random() * Math.PI * 2;
  const radius = THREE.MathUtils.lerp(minRadius, maxRadius, random());
  return new THREE.Vector3(
    center.x + Math.cos(angle) * radius,
    0,
    center.z + Math.sin(angle) * radius,
  );
}

function randomDungeonSpawnPoint(game, center, minDistance = 9, random = Math.random) {
  const points = game.dungeon?.enemySpawnPoints;

  if (!points?.length) {
    return null;
  }

  const minDistanceSq = minDistance * minDistance;
  const candidates = points.filter((point) => point.distanceToSquared(center) >= minDistanceSq);
  const pool = candidates.length > 0 ? candidates : points;
  const point = pool[Math.floor(random() * pool.length)].clone();
  point.x += (random() - 0.5) * 1.25;
  point.z += (random() - 0.5) * 1.25;
  return point;
}

export class EnemySpawner {
  constructor(game) {
    this.game = game;
    this.elapsed = 0;
    this.wave = 1;
    this.spawnSerial = 0;
    const urlSeedLabel = new URLSearchParams(globalThis.location?.search ?? '').get('reaverbotSeed');
    const baseSeed = game.reaverbotBaseSeed
      ?? (urlSeedLabel ? hashSeed(urlSeedLabel) : hashSeed(`ruin:${Date.now()}:${Math.random()}`));
    const generation = game.reaverbotGeneration ?? 0;
    game.reaverbotBaseSeed = baseSeed;
    game.reaverbotSeedLabel = urlSeedLabel ?? game.reaverbotSeedLabel ?? String(baseSeed);
    game.reaverbotGeneration = generation + 1;
    this.runSeed = hashSeed(`${baseSeed}:floor:${game.ruinFloor ?? 1}:generation:${generation}`);
    game.reaverbotRunSeed = this.runSeed;
  }

  update(dt) {
    if (this.game.isPlayerInSafeArea?.()) {
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

  spawnEnemy(typeKey = null, forceElite = false, position = null, options = {}) {
    const difficulty = this.getDifficulty();
    const level = Math.max(1, Math.floor(difficulty));
    const eliteChance = Math.min(0.26, 0.035 + difficulty * 0.015);
    const spawnSerial = this.spawnSerial++;
    const seed = options.seed
      ?? hashSeed(`${this.runSeed}:ambient:${spawnSerial}`);
    const rng = new SeededRandom(`${seed}:spawn`);
    typeKey = typeKey ?? weightedType(() => rng.next());
    const isElite = forceElite || (options.allowRandomElite !== false && rng.chance(eliteChance));
    const curatedType = String(typeKey).startsWith('legacy:')
      ? String(typeKey).slice('legacy:'.length)
      : typeKey;
    const useCurated = options.curated === true || String(typeKey).startsWith('legacy:');
    let enemy;

    if (useCurated) {
      enemy = isElite
        ? new EliteEnemy(curatedType, level, ELITE_AFFIXES[rng.int(0, ELITE_AFFIXES.length - 1)])
        : new Enemy(curatedType, level);
    } else {
      const genome = generateReaverbotGenome({
        seed,
        threatTier: Math.max(1, Math.min(8, level)),
        intent: typeKey,
        archetypeId: options.archetypeId,
        biome: options.biome ?? 'industrial ruin',
        roomArchetypeId: options.roomArchetypeId,
        roomFlavorId: options.roomFlavorId,
        favoredTags: options.favoredTags,
        suppressedTags: options.suppressedTags,
        behaviorModifiers: options.behaviorModifiers,
        encounterSize: options.encounterSize ?? 1,
        healthMultiplier: options.healthMultiplier ?? 1,
        elite: isElite,
        isBoss: Boolean(options.isBoss),
        keycardCarrier: Boolean(options.keycardCarrier),
      });
      const affix = isElite ? ELITE_AFFIXES[rng.int(0, ELITE_AFFIXES.length - 1)] : null;
      enemy = new ReaverbotEnemy(genome, level, { eliteAffix: affix });
    }

    enemy.root.position.copy(position
      ?? randomDungeonSpawnPoint(this.game, this.game.player.root.position, 9, () => rng.next())
      ?? randomPointAround(this.game.player.root.position, 13, 19, () => rng.next()));
    enemy.root.rotation.y = rng.float(-Math.PI, Math.PI);
    this.game.addEnemy(enemy);
    return enemy;
  }

  spawnCuratedEnemy(typeKey = 'horokko', forceElite = false, position = null) {
    return this.spawnEnemy(typeKey, forceElite, position, { curated: true });
  }

  spawnEncounter(encounter) {
    const enemies = [];
    const spawnPoints = encounter.spawnPoints?.length
      ? encounter.spawnPoints
      : [encounter.zone.position];
    const roster = encounter.roster?.length ? encounter.roster : ['basic', 'fast', 'ranged'];

    for (let i = 0; i < roster.length; i += 1) {
      const seed = createEncounterSlotSeed(this.runSeed, encounter.id, i);
      const slotRandom = new SeededRandom(`${seed}:position`);
      const spawnPoint = spawnPoints[i % spawnPoints.length].clone();
      spawnPoint.x += (slotRandom.next() - 0.5) * 0.65;
      spawnPoint.z += (slotRandom.next() - 0.5) * 0.65;
      const forceElite = (encounter.keycardDropId && i === 0) || (encounter.isBoss && i === 0);
      const keycardCarrier = Boolean(encounter.keycardDropId && i === 0);
      const enemy = this.spawnEnemy(roster[i], forceElite, spawnPoint, {
        seed,
        encounterSize: roster.length,
        roomArchetypeId: encounter.roomArchetypeId,
        roomFlavorId: encounter.roomFlavorId,
        behaviorModifiers: encounter.enemyBehaviorModifiers,
        favoredTags: encounter.enemyTags,
        suppressedTags: encounter.enemySuppressedTags,
        healthMultiplier: encounter.enemyHealthMultiplier ?? 1,
        isBoss: Boolean(encounter.isBoss && i === 0),
        keycardCarrier,
      });
      enemy.encounterId = encounter.id;
      if (keycardCarrier) {
        enemy.guaranteedKeycardDropId = encounter.keycardDropId;
        enemy.isKeyHoldingElite = true;
      }
      if (encounter.isBoss && i === 0) {
        enemy.isBoss = true;
      }
      enemies.push(enemy);
    }

    this.game.dungeonController?.markEncounterSpawned?.(encounter.id, enemies);
    return enemies;
  }

  spawnInitialPack() {
    // Encounters now spawn when the player enters dungeon rooms.
  }
}
