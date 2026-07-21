import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EnemySpawner } from '../../../src/EnemySpawner.js';

function runEncounter(runSeed) {
  const calls = [];
  const marked = [];
  const spawner = Object.create(EnemySpawner.prototype);
  spawner.runSeed = runSeed;
  spawner.getDifficulty = () => 1;
  spawner.game = {
    setBusterCombatDepthLevel: () => {},
    dungeonController: {
      getSurfaceElevationAt: (position) => position.y,
      findNearestEnemyClearPosition: (_enemy, position) => position,
      markEncounterSpawned: (id, enemies) => marked.push({ id, count: enemies.length }),
    },
  };
  spawner._resolveEncounterSpawnPosition = (_encounter, _enemy, position) => position;
  spawner.spawnEnemy = (intent, forceElite, position, options) => {
    calls.push({ intent, forceElite, position: position.toArray(), options });
    return {
      id: `enemy-${calls.length}`,
      root: new THREE.Group(),
      navigationMode: 'ground',
      genome: { archetypeId: 'pursuer' },
      setEncounterArena: () => {},
    };
  };
  spawner.spawnEncounter({
    id: 'encounter.machine-core',
    seed: 123456789,
    spawnPlacementMode: 'exact-plan-owned',
    spawnGroundingMode: 'plan-y',
    spawnSurfaceIds: ['surface.machine-core.floor'],
    zone: { position: new THREE.Vector3(0, 0, 0), halfWidth: 8, halfDepth: 8 },
    roster: ['tank'],
    spawnPoints: [new THREE.Vector3(2, 0, 2)],
    eliteSlots: [0],
  });
  return { calls, marked };
}

test('plan-owned encounter seeds and elite slots drive the existing Reaverbot spawner', () => {
  const first = runEncounter('unrelated-run-seed-a');
  const second = runEncounter('unrelated-run-seed-b');
  assert.equal(first.calls.length, 1);
  assert.equal(first.calls[0].intent, 'tank');
  assert.equal(first.calls[0].forceElite, true);
  assert.equal(first.calls[0].options.seed, second.calls[0].options.seed);
  assert.deepEqual(first.marked, [{ id: 'encounter.machine-core', count: 1 }]);
});
