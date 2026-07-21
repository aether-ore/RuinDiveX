import * as THREE from 'three';
import { EliteEnemy, ELITE_AFFIXES } from './EliteEnemy.js';
import { Enemy } from './Enemy.js';
import { ReaverbotEnemy } from './reaverbots/ReaverbotEnemy.js';
import { ReaverbotBossEnemy } from './reaverbots/ReaverbotBossEnemy.js';
import { SharukurusuEnemy } from './reaverbots/SharukurusuEnemy.js';
import {
  createBossExpeditionSpec,
  generateReaverbotBossGenome,
  getReaverbotBossProfile,
  normalizeBossProfileId,
} from './reaverbots/ReaverbotBossCatalog.js';
import {
  createEncounterSlotSeed,
  generateReaverbotGenome,
  validateReaverbotGenomeAgainstGenerationPolicy,
} from './reaverbots/ReaverbotGenerator.js';
import { hashSeed, SeededRandom } from './reaverbots/SeededRandom.js';

const TYPE_WEIGHTS = [
  ['basic', 42],
  ['fast', 22],
  ['tank', 14],
  ['ranged', 16],
  ['horokko', 10],
  ['gorubesshu', 7],
  ['sharukurusu', 5],
];
const MIN_ENCOUNTER_CORNER_BAND = 2.4;
const ENCOUNTER_CORNER_BAND_RATIO = 0.22;
const ENCOUNTER_CORNER_ESCAPE_MARGIN = 0.85;
export const EXACT_PLAN_OWNED_SPAWN_MODE = 'exact-plan-owned';
export const PLAN_Y_SPAWN_GROUNDING_MODE = 'plan-y';

function isFinitePosition(position) {
  return position
    && Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Number.isFinite(position.z);
}

function assertExactPlanOwnedSpawnContract(encounter, spawnPoints) {
  if (encounter?.spawnPlacementMode !== EXACT_PLAN_OWNED_SPAWN_MODE) return false;
  if (!((typeof encounter.seed === 'number' && Number.isFinite(encounter.seed))
    || (typeof encounter.seed === 'string' && encounter.seed.length > 0))) {
    throw new Error(`Encounter ${encounter.id ?? '(unknown)'} exact plan-owned spawns require a deterministic encounter seed.`);
  }
  if (encounter.spawnGroundingMode !== PLAN_Y_SPAWN_GROUNDING_MODE) {
    throw new Error(
      `Encounter ${encounter.id ?? '(unknown)'} exact plan-owned spawns require spawnGroundingMode "${PLAN_Y_SPAWN_GROUNDING_MODE}".`,
    );
  }
  if (!Array.isArray(spawnPoints) || spawnPoints.length === 0
    || spawnPoints.some((point) => !isFinitePosition(point))) {
    throw new Error(`Encounter ${encounter.id ?? '(unknown)'} exact plan-owned spawns require finite authored spawn points.`);
  }
  if (!Array.isArray(encounter.spawnSurfaceIds)
    || encounter.spawnSurfaceIds.length !== spawnPoints.length
    || encounter.spawnSurfaceIds.some((surfaceId) => typeof surfaceId !== 'string' || !surfaceId)) {
    throw new Error(
      `Encounter ${encounter.id ?? '(unknown)'} exact plan-owned spawns require one declared surface ID per spawn point.`,
    );
  }
  return true;
}

function getEncounterCornerBand(zone) {
  if (!zone?.position) return 0;
  const halfWidth = Math.max(0.01, Number(zone.halfWidth) || 0.01);
  const halfDepth = Math.max(0.01, Number(zone.halfDepth) || 0.01);
  return Math.min(
    Math.max(
      MIN_ENCOUNTER_CORNER_BAND,
      Math.min(halfWidth, halfDepth) * ENCOUNTER_CORNER_BAND_RATIO,
    ),
    halfWidth * 0.44,
    halfDepth * 0.44,
  );
}

export function isEncounterCornerPosition(position, zone) {
  if (!position || !zone?.position) return false;
  const band = getEncounterCornerBand(zone);
  const xWallClearance = (Number(zone.halfWidth) || 0)
    - Math.abs(position.x - zone.position.x);
  const zWallClearance = (Number(zone.halfDepth) || 0)
    - Math.abs(position.z - zone.position.z);
  return xWallClearance <= band && zWallClearance <= band;
}

export function pullEncounterSpawnFromCorner(position, zone, target = new THREE.Vector3()) {
  target.copy(position);
  if (!isEncounterCornerPosition(position, zone)) return target;

  const band = getEncounterCornerBand(zone);
  const safeHalfWidth = Math.max(
    0,
    (Number(zone.halfWidth) || 0) - band - ENCOUNTER_CORNER_ESCAPE_MARGIN,
  );
  const safeHalfDepth = Math.max(
    0,
    (Number(zone.halfDepth) || 0) - band - ENCOUNTER_CORNER_ESCAPE_MARGIN,
  );
  const xDirection = Math.sign(position.x - zone.position.x) || 1;
  const zDirection = Math.sign(position.z - zone.position.z) || 1;
  target.x = zone.position.x + xDirection * safeHalfWidth;
  target.z = zone.position.z + zDirection * safeHalfDepth;
  return target;
}

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
    const generationPolicy = options.generationPolicy ?? null;
    if (generationPolicy?.elitePolicy === 'forbid' && forceElite) {
      throw new Error(`Encounter generation policy ${generationPolicy.id ?? '<missing>'} forbids an elite override.`);
    }
    const spawnSerial = this.spawnSerial++;
    const seed = options.seed
      ?? hashSeed(`${this.runSeed}:ambient:${spawnSerial}`);
    const rng = new SeededRandom(`${seed}:spawn`);
    typeKey = typeKey ?? weightedType(() => rng.next());
    const allowRandomElite = generationPolicy?.elitePolicy === 'forbid'
      ? false
      : options.allowRandomElite !== false;
    const isElite = forceElite || (allowRandomElite && rng.chance(eliteChance));
    const curatedType = String(typeKey).startsWith('legacy:')
      ? String(typeKey).slice('legacy:'.length)
      : typeKey;
    const useCurated = options.curated === true
      || String(typeKey).startsWith('legacy:')
      || curatedType === 'sharukurusu';
    const generationContext = generationPolicy?.generationContext ?? {};
    let generationPolicyValidation = null;
    let enemy;

    if (useCurated) {
      if (generationPolicy) {
        throw new Error(`Encounter generation policy ${generationPolicy.id ?? '<missing>'} cannot target a curated enemy.`);
      }
      enemy = curatedType === 'sharukurusu'
        ? new SharukurusuEnemy(level, {
          eliteAffix: isElite
            ? ELITE_AFFIXES[rng.int(0, ELITE_AFFIXES.length - 1)]
            : null,
        })
        : isElite
        ? new EliteEnemy(curatedType, level, ELITE_AFFIXES[rng.int(0, ELITE_AFFIXES.length - 1)])
        : new Enemy(curatedType, level);
    } else {
      const genome = generateReaverbotGenome({
        seed,
        threatTier: Math.max(1, Math.min(8, level)),
        intent: typeKey,
        archetypeId: generationContext.archetypeId ?? options.archetypeId,
        bodyPlanId: generationContext.bodyPlanId ?? options.bodyPlanId,
        weaponId: generationContext.weaponId ?? options.weaponId,
        defenseId: generationContext.defenseId ?? options.defenseId,
        weakPointId: generationContext.weakPointId ?? options.weakPointId,
        biome: options.biome ?? 'industrial ruin',
        roomArchetypeId: options.roomArchetypeId,
        roomFlavorId: options.roomFlavorId,
        favoredTags: options.favoredTags,
        suppressedTags: options.suppressedTags,
        behaviorModifiers: options.behaviorModifiers,
        excludedArchetypes: options.excludedArchetypes,
        encounterSize: options.encounterSize ?? 1,
        healthMultiplier: options.healthMultiplier ?? 1,
        elite: isElite,
        isBoss: Boolean(options.isBoss),
        keycardCarrier: Boolean(options.keycardCarrier),
      });
      if (generationPolicy) {
        generationPolicyValidation = validateReaverbotGenomeAgainstGenerationPolicy(genome, generationPolicy);
        if (!generationPolicyValidation.valid) {
          throw new Error(`Encounter generation policy ${generationPolicy.id ?? '<missing>'} produced an unsafe Reaverbot: ${generationPolicyValidation.errors.join(', ')}`);
        }
      }
      const affix = isElite ? ELITE_AFFIXES[rng.int(0, ELITE_AFFIXES.length - 1)] : null;
      enemy = new ReaverbotEnemy(genome, level, { eliteAffix: affix });
    }

    if (generationPolicy && generationPolicyValidation) {
      enemy.planOwnedGenerationPolicy = Object.freeze({
        id: generationPolicy.id,
        slotIndex: generationPolicy.slotIndex,
        elitePolicy: generationPolicy.elitePolicy,
        protectedTraversalLinkIds: Object.freeze([
          ...(generationPolicy.protectedTraversalLinkIds ?? []),
        ]),
        generationContext: Object.freeze({ ...generationContext }),
        capabilities: generationPolicyValidation.capabilities,
        verified: true,
      });
      enemy.root.userData.planOwnedGenerationPolicyId = generationPolicy.id;
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
    const encounterDepth = encounter?.isBoss
      ? Number(encounter?.expeditionSpec?.depth) || this.getDifficulty()
      : this.getDifficulty();
    this.game.setBusterCombatDepthLevel?.(Math.round(encounterDepth), {
      encounterId: encounter?.id ?? null,
    });
    if (encounter?.isBoss) {
      return this._spawnBossEncounter(encounter);
    }
    const enemies = [];
    let tractorControllerCount = 0;
    const spawnPoints = encounter.spawnPoints?.length
      ? encounter.spawnPoints
      : [encounter.zone.position];
    const exactPlanOwnedSpawns = assertExactPlanOwnedSpawnContract(encounter, spawnPoints);
    const roster = encounter.roster?.length ? encounter.roster : ['basic', 'fast', 'ranged'];
    const eliteSlots = new Set(
      Array.isArray(encounter.eliteSlots)
        ? encounter.eliteSlots.filter((index) => Number.isInteger(index) && index >= 0)
        : [],
    );
    // Legacy encounters retain their run-seed behavior. Accepted V2 plans own
    // their encounter seed so unrelated ambient spawning cannot perturb them.
    const encounterSeed = exactPlanOwnedSpawns ? encounter.seed : this.runSeed;
    const slotGenerationPolicies = exactPlanOwnedSpawns && Array.isArray(encounter.slotGenerationPolicies)
      ? encounter.slotGenerationPolicies
      : [];

    for (let i = 0; i < roster.length; i += 1) {
      const seed = createEncounterSlotSeed(encounterSeed, encounter.id, i);
      const spawnPointIndex = i % spawnPoints.length;
      const authoredSpawnPoint = spawnPoints[spawnPointIndex].clone();
      let spawnPoint = authoredSpawnPoint;
      if (!exactPlanOwnedSpawns) {
        const slotRandom = new SeededRandom(`${seed}:position`);
        authoredSpawnPoint.x += (slotRandom.next() - 0.5) * 0.65;
        authoredSpawnPoint.z += (slotRandom.next() - 0.5) * 0.65;
        spawnPoint = pullEncounterSpawnFromCorner(authoredSpawnPoint, encounter.zone);
      }
      const forceElite = encounter.forceEliteAll === true
        || eliteSlots.has(i)
        || (encounter.keycardDropId && i === 0)
        || (encounter.isBoss && i === 0);
      const keycardCarrier = Boolean(encounter.keycardDropId && i === 0);
      const generationPolicy = slotGenerationPolicies.find((policy) => policy?.slotIndex === i) ?? null;
      const enemy = this.spawnEnemy(roster[i], forceElite, spawnPoint, {
        seed,
        encounterSize: roster.length,
        roomArchetypeId: encounter.roomArchetypeId,
        roomFlavorId: encounter.roomFlavorId,
        behaviorModifiers: encounter.enemyBehaviorModifiers,
        favoredTags: encounter.enemyTags,
        suppressedTags: encounter.enemySuppressedTags,
        healthMultiplier: encounter.enemyHealthMultiplier ?? 1,
        excludedArchetypes: tractorControllerCount > 0 ? ['tractorController'] : [],
        isBoss: Boolean(encounter.isBoss && i === 0),
        keycardCarrier,
        generationPolicy,
      });
      enemy.encounterId = encounter.id;
      const controller = this.game.dungeonController;
      enemy.root.position.copy(this._resolveEncounterSpawnPosition(
        encounter,
        enemy,
        spawnPoint,
      ));
      if (exactPlanOwnedSpawns) {
        enemy.planOwnedSpawn = Object.freeze({
          encounterId: encounter.id,
          spawnPointIndex,
          surfaceId: encounter.spawnSurfaceIds[spawnPointIndex],
          position: Object.freeze({
            x: spawnPoint.x,
            y: spawnPoint.y,
            z: spawnPoint.z,
          }),
        });
      }
      const rawArenaCenter = encounter.zone?.position?.clone?.();
      if (rawArenaCenter) {
        rawArenaCenter.y = enemy.navigationMode === 'air'
          ? enemy.root.position.y
          : (controller?.getSurfaceElevationAt?.(rawArenaCenter) ?? rawArenaCenter.y);
      }
      const resolvedArenaCenter = rawArenaCenter
        ? controller?.findNearestEnemyClearPosition?.(enemy, rawArenaCenter, {
          preferredPosition: rawArenaCenter,
          maximumRadius: Math.max(
            1.4,
            Math.min(encounter.zone.halfWidth ?? 5, encounter.zone.halfDepth ?? 5) * 0.72,
          ),
        }) ?? rawArenaCenter
        : null;
      enemy.setEncounterArena?.(encounter, resolvedArenaCenter);
      if (enemy.genome?.archetypeId === 'tractorController') {
        tractorControllerCount += 1;
      }
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

  _spawnBossEncounter(encounter) {
    const difficulty = this.getDifficulty();
    const fallbackLevel = Math.max(1, Math.min(10, Math.round(difficulty)));
    const profileId = normalizeBossProfileId(
      encounter.bossProfileId
        ?? encounter.expeditionSpec?.bossProfileId
        ?? this.game.getSelectedBossProfileId?.(),
    );
    const authoredSpawn = encounter.spawnPoints?.[0]?.clone?.()
      ?? encounter.zone?.position?.clone?.()
      ?? this.game.player.root.position.clone();
    const exactPlanOwnedSpawns = assertExactPlanOwnedSpawnContract(encounter, [authoredSpawn]);
    const encounterSeed = exactPlanOwnedSpawns ? encounter.seed : this.runSeed;
    const seed = createEncounterSlotSeed(encounterSeed, encounter.id, 0);
    const expeditionSpec = encounter.expeditionSpec
      ?? this.game.getActiveBossExpeditionSpec?.()
      ?? createBossExpeditionSpec({
        bossProfileId: profileId,
        seed,
        depth: fallbackLevel,
        id: `${this.runSeed}:${encounter.id}`,
      });
    const level = Math.max(1, Math.min(10, Math.round(
      Number(expeditionSpec.depth) || fallbackLevel,
    )));
    const bossProfile = getReaverbotBossProfile(profileId);
    const genome = generateReaverbotBossGenome({
      bossProfileId: profileId,
      seed: expeditionSpec.seed ?? seed,
      threatTier: Math.max(1, Math.min(10, level)),
      context: {
        biome: 'industrial ruin',
        roomArchetypeId: encounter.roomArchetypeId,
        roomFlavorId: encounter.roomFlavorId,
        favoredTags: encounter.enemyTags,
        suppressedTags: encounter.enemySuppressedTags,
        behaviorModifiers: encounter.enemyBehaviorModifiers,
      },
    });
    const spawnPoint = exactPlanOwnedSpawns
      ? authoredSpawn
      : pullEncounterSpawnFromCorner(authoredSpawn, encounter.zone);
    const boss = new ReaverbotBossEnemy(genome, level, { bossProfile, expeditionSpec });
    boss.root.position.copy(spawnPoint);
    boss.root.rotation.y = new SeededRandom(`${seed}:boss-facing`).float(-Math.PI, Math.PI);
    boss.encounterId = encounter.id;
    boss.expeditionSpec = expeditionSpec;
    this.game.addEnemy(boss);
    boss.root.position.copy(this._resolveEncounterSpawnPosition(encounter, boss, spawnPoint));
    if (exactPlanOwnedSpawns) {
      boss.planOwnedSpawn = Object.freeze({
        encounterId: encounter.id,
        spawnPointIndex: 0,
        surfaceId: encounter.spawnSurfaceIds[0],
        position: Object.freeze({ x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z }),
      });
    }

    const controller = this.game.dungeonController;
    const arenaCenter = encounter.zone?.position?.clone?.() ?? boss.root.position.clone();
    arenaCenter.y = controller?.getSurfaceElevationAt?.(arenaCenter) ?? arenaCenter.y;
    boss.setEncounterArena?.(encounter, arenaCenter);
    this.game.activeReaverbotBoss = boss;
    encounter.bossProfileId = profileId;
    encounter.expeditionSpec = expeditionSpec;
    this.game.dungeonController?.markEncounterSpawned?.(encounter.id, [boss]);
    return [boss];
  }

  _resolveEncounterSpawnPosition(encounter, enemy, requestedPosition) {
    if (encounter?.spawnPlacementMode === EXACT_PLAN_OWNED_SPAWN_MODE) {
      // Clearance and surface ownership were already proven by the V2 plan
      // validator. Runtime sanitizers must not silently rewrite accepted plan
      // coordinates; plan-y also forbids an implicit vertical re-grounding.
      assertExactPlanOwnedSpawnContract(encounter, encounter.spawnPoints);
      if (!isFinitePosition(requestedPosition)) {
        throw new Error(`Encounter ${encounter.id ?? '(unknown)'} supplied a non-finite exact spawn position.`);
      }
      return requestedPosition.clone();
    }
    const zone = encounter?.zone;
    const controller = this.game.dungeonController;
    const safeRequest = pullEncounterSpawnFromCorner(requestedPosition, zone);
    if (enemy.navigationMode !== 'air') {
      safeRequest.y = controller?.getSurfaceElevationAt?.(safeRequest) ?? safeRequest.y;
    }
    if (!controller?.findNearestEnemyClearPosition) {
      return safeRequest;
    }

    const localSearchRadius = Math.max(1.4, getEncounterCornerBand(zone) * 0.72);
    const resolved = controller.findNearestEnemyClearPosition(enemy, safeRequest, {
      preferredPosition: zone?.position,
      maximumRadius: localSearchRadius,
    });
    if (resolved && !isEncounterCornerPosition(resolved, zone)) {
      return resolved;
    }

    const center = zone?.position?.clone?.() ?? safeRequest.clone();
    center.y = enemy.navigationMode === 'air'
      ? safeRequest.y
      : (controller.getSurfaceElevationAt?.(center) ?? center.y);
    const centerResolved = controller.findNearestEnemyClearPosition(enemy, center, {
      preferredPosition: center,
      maximumRadius: Math.max(
        1.4,
        Math.min(Number(zone?.halfWidth) || 5, Number(zone?.halfDepth) || 5) * 0.58,
      ),
    });
    if (centerResolved && !isEncounterCornerPosition(centerResolved, zone)) {
      return centerResolved;
    }

    // The clear-position search is allowed to explore broadly for unusual
    // room geometry, so sanitize its final fallback one more time.
    return pullEncounterSpawnFromCorner(centerResolved ?? resolved ?? safeRequest, zone);
  }

  spawnInitialPack() {
    // Encounters now spawn when the player enters dungeon rooms.
  }
}
