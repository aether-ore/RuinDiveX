import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import Game from '../../../src/Game.js';
import { DungeonController } from '../../../src/DungeonController.js';
import { createTraversalLabPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';

function createGroundingHarness(facade) {
  const game = Object.create(Game.prototype);
  game.player = { root: new THREE.Group() };
  game.dungeon = facade;
  game.platformingPlatforms = [...facade.platforms];
  game.dynamicPlatformingPlatforms = [];
  game.debugSpawnedPlatforms = [];
  game.debugLedgePlatform = null;
  game.bossStageRuntime = null;
  game.enemies = [];
  game.elapsedTime = 0;
  game.ruinCompleted = false;
  game.ui = { showToast: () => {} };
  game.scene = new THREE.Scene();
  game.dungeonController = new DungeonController(game, facade);
  return game;
}

test('stacked stairs cannot capture grounded support from another playable elevation', () => {
  const validation = validateDungeonPlanV2(createTraversalLabPlanV2({
    seed: 'stacked-stair-support-no-warp',
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const facade = assembleDungeonPlanV2(validation.plan);
  try {
    const game = createGroundingHarness(facade);
    const cases = [
      {
        label: 'upper gear floor above the recovery stair',
        position: new THREE.Vector3(134, 0.35, 5),
        remoteStairId: 'surface.lab-recovery.catchment-return-stairs',
      },
      {
        label: 'lower recovery floor beneath the gear stair',
        position: new THREE.Vector3(120, -9.65, 9.5),
        remoteStairId: 'surface.lab-gear.landmark-stairs',
      },
    ];

    for (const fixture of cases) {
      game.player.root.position.copy(fixture.position);
      assert.equal(
        facade.isPositionOnExactStairSurface(
          fixture.remoteStairId,
          game.player.root.position,
          0.001,
        ),
        true,
        `${fixture.label} must retain the deliberately stacked X/Z fixture`,
      );

      const resolvedGroundY = Game.prototype._getPlayerGroundY.call(game);
      assert.ok(
        Math.abs(resolvedGroundY - fixture.position.y) <= 0.05,
        `${fixture.label} warped support from y=${fixture.position.y} to y=${resolvedGroundY}`,
      );
    }
  } finally {
    facade.dispose();
  }
});
