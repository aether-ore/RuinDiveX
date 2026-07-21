import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  EnemySpawner,
  EXACT_PLAN_OWNED_SPAWN_MODE,
  PLAN_Y_SPAWN_GROUNDING_MODE,
} from '../../../src/EnemySpawner.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';

function vectorRecord(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function createSpawnerHarness(runSeed, {
  clearPosition = new THREE.Vector3(-123, 47, 321),
  surfaceElevation = 47,
} = {}) {
  const calls = [];
  const marked = [];
  const controllerCalls = { surface: 0, clear: 0 };
  const spawner = Object.create(EnemySpawner.prototype);
  spawner.runSeed = runSeed;
  spawner.spawnSerial = 0;
  spawner.getDifficulty = () => 1;
  spawner.game = {
    setBusterCombatDepthLevel: () => {},
    dungeonController: {
      getSurfaceElevationAt(position) {
        controllerCalls.surface += 1;
        return surfaceElevation ?? position.y;
      },
      findNearestEnemyClearPosition() {
        controllerCalls.clear += 1;
        return clearPosition.clone();
      },
      markEncounterSpawned(id, enemies) {
        marked.push({ id, count: enemies.length });
      },
    },
  };
  spawner.spawnEnemy = (intent, forceElite, position, options) => {
    const enemy = {
      id: `enemy-${calls.length}`,
      root: new THREE.Group(),
      navigationMode: 'ground',
      genome: { archetypeId: 'pursuer' },
      setEncounterArena: () => {},
    };
    enemy.root.position.copy(position);
    calls.push({
      intent,
      forceElite,
      requestedPosition: position.clone(),
      options,
      enemy,
    });
    return enemy;
  };
  return { spawner, calls, marked, controllerCalls };
}

function encounterFixture(overrides = {}) {
  return {
    id: 'encounter.exact-test',
    seed: 0x54ab219,
    zone: {
      position: new THREE.Vector3(0, 0, 0),
      halfWidth: 10,
      halfDepth: 10,
    },
    roster: ['ranged'],
    spawnPoints: [new THREE.Vector3(9.45, 3.75, 9.35)],
    eliteSlots: [],
    ...overrides,
  };
}

test('exact V2 spawn policy preserves plan X/Y/Z through jitter, corner, grounding, and clear-position stages', () => {
  const encounter = encounterFixture({
    spawnPlacementMode: EXACT_PLAN_OWNED_SPAWN_MODE,
    spawnGroundingMode: PLAN_Y_SPAWN_GROUNDING_MODE,
    spawnSurfaceIds: ['surface.test.upper-deck'],
  });
  const first = createSpawnerHarness('ambient-run-a');
  const second = createSpawnerHarness('unrelated-ambient-run-b');

  const [firstEnemy] = first.spawner.spawnEncounter(encounter);
  const [secondEnemy] = second.spawner.spawnEncounter(encounter);
  const expected = vectorRecord(encounter.spawnPoints[0]);

  assert.deepEqual(vectorRecord(first.calls[0].requestedPosition), expected,
    'seeded runtime jitter or corner pulling rewrote the accepted point before spawn');
  assert.deepEqual(vectorRecord(firstEnemy.root.position), expected,
    'grounding or nearest-clear relocation rewrote the accepted point after spawn');
  assert.deepEqual(vectorRecord(secondEnemy.root.position), expected,
    'an unrelated ambient run seed perturbed an exact plan-owned spawn');
  assert.equal(first.calls[0].options.seed, second.calls[0].options.seed,
    'the exact encounter slot must derive from its plan-owned seed');
  assert.deepEqual(firstEnemy.planOwnedSpawn, {
    encounterId: encounter.id,
    spawnPointIndex: 0,
    surfaceId: 'surface.test.upper-deck',
    position: expected,
  });
  assert.equal(Object.isFrozen(firstEnemy.planOwnedSpawn), true);
  assert.equal(Object.isFrozen(firstEnemy.planOwnedSpawn.position), true);
  assert.deepEqual(first.marked, [{ id: encounter.id, count: 1 }]);
});

test('exact V2 policy fails closed instead of silently falling back to legacy placement', () => {
  const { spawner } = createSpawnerHarness('ambient-run');
  assert.throws(() => spawner.spawnEncounter(encounterFixture({
    seed: null,
    spawnPlacementMode: EXACT_PLAN_OWNED_SPAWN_MODE,
    spawnGroundingMode: PLAN_Y_SPAWN_GROUNDING_MODE,
    spawnSurfaceIds: ['surface.test.upper-deck'],
  })), /deterministic encounter seed/);
  assert.throws(() => spawner.spawnEncounter(encounterFixture({
    spawnPlacementMode: EXACT_PLAN_OWNED_SPAWN_MODE,
    spawnGroundingMode: 'nearest-runtime-floor',
    spawnSurfaceIds: ['surface.test.upper-deck'],
  })), /spawnGroundingMode "plan-y"/);
  assert.throws(() => spawner.spawnEncounter(encounterFixture({
    spawnPlacementMode: EXACT_PLAN_OWNED_SPAWN_MODE,
    spawnGroundingMode: PLAN_Y_SPAWN_GROUNDING_MODE,
    spawnSurfaceIds: [],
  })), /one declared surface ID per spawn point/);
});

test('legacy encounters retain seeded jitter, corner pulling, grounding, and clear-position relocation', () => {
  const cornerEncounter = encounterFixture();
  const legacyClearPosition = new THREE.Vector3(1, 47, 1);
  const first = createSpawnerHarness('legacy-run-a', { clearPosition: legacyClearPosition });
  const second = createSpawnerHarness('legacy-run-a', { clearPosition: legacyClearPosition });

  const [enemy] = first.spawner.spawnEncounter(cornerEncounter);
  second.spawner.spawnEncounter(cornerEncounter);

  assert.notDeepEqual(vectorRecord(first.calls[0].requestedPosition),
    vectorRecord(cornerEncounter.spawnPoints[0]),
    'legacy corner sanitization unexpectedly stopped moving a corner spawn');
  assert.deepEqual(vectorRecord(first.calls[0].requestedPosition),
    vectorRecord(second.calls[0].requestedPosition),
    'legacy positional jitter stopped being deterministic for a fixed run seed');
  assert.deepEqual(vectorRecord(enemy.root.position), vectorRecord(legacyClearPosition),
    'legacy nearest-clear relocation no longer owns the final spawn position');
  assert.ok(first.controllerCalls.surface > 0, 'legacy grounding was not consulted');
  assert.ok(first.controllerCalls.clear > 0, 'legacy clear-position search was not consulted');
  assert.equal(enemy.planOwnedSpawn, undefined,
    'legacy enemies must not be mislabeled as plan-owned exact spawns');
});

test('accepted golden-plan encounter policy survives assembly and drives exact runtime points', () => {
  const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
    seed: 'm1-golden-magma',
    undercroftType: 'magma',
    deferSemanticRoomPackIntegration: true,
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const plan = validation.plan;
  const facade = assembleDungeonPlanV2(plan, { difficulty: 1 });
  try {
    const planned = plan.encounters.find(({ id }) => id === 'encounter.assembly');
    const runtime = facade.encounters.find(({ id }) => id === planned.id);
    assert.equal(runtime.spawnPlacementMode, EXACT_PLAN_OWNED_SPAWN_MODE);
    assert.equal(runtime.spawnGroundingMode, PLAN_Y_SPAWN_GROUNDING_MODE);
    assert.deepEqual(runtime.spawnSurfaceIds, planned.spawnSurfaceIds);
    assert.deepEqual(runtime.spawnPoints.map(vectorRecord), planned.spawnPoints.map(vectorRecord),
      'the assembler did not preserve the accepted plan points exactly');

    const first = createSpawnerHarness('unrelated-run-a');
    const second = createSpawnerHarness('unrelated-run-b');
    const firstEnemies = first.spawner.spawnEncounter(runtime);
    const secondEnemies = second.spawner.spawnEncounter(runtime);
    for (let index = 0; index < firstEnemies.length; index += 1) {
      const pointIndex = index % planned.spawnPoints.length;
      assert.deepEqual(vectorRecord(firstEnemies[index].root.position), planned.spawnPoints[pointIndex]);
      assert.deepEqual(vectorRecord(secondEnemies[index].root.position), planned.spawnPoints[pointIndex]);
      assert.equal(firstEnemies[index].planOwnedSpawn.surfaceId, planned.spawnSurfaceIds[pointIndex]);
      assert.equal(first.calls[index].options.seed, second.calls[index].options.seed);
    }
  } finally {
    facade.dispose();
  }
});
