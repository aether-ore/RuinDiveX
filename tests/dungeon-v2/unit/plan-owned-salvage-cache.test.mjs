import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonController } from '../../../src/DungeonController.js';

function makeController(generationMode = 'v2') {
  const calls = { salvage: [], refractors: [] };
  const controller = Object.create(DungeonController.prototype);
  controller.dungeon = { generationMode };
  controller.dungeonV2Runtime = null;
  controller.game = {
    lootSystem: {
      createUnidentifiedScrapPickup: (...args) => calls.salvage.push(args),
    },
    refractors: {
      rollChestDrop: (...args) => calls.refractors.push(args),
    },
    addParticleBurst: () => {},
    ui: { showToast: () => {} },
  };
  controller.getFloorElevationAt = () => 3;
  return { controller, calls };
}

function makeChest(overrides = {}) {
  return {
    id: 'reward.cache.alpha',
    seed: 1234,
    position: new THREE.Vector3(2, 3, 4),
    object: { userData: {} },
    rareBoost: true,
    opened: false,
    salvageBundle: {
      unidentifiedScrap: 2,
      recoverableParts: [{ materialId: 'heavyServoFrame', quantity: 1 }],
    },
    ...overrides,
  };
}

test('a plan-owned V2 parts cache creates unidentified Reaverbot salvage, not refractors', () => {
  const { controller, calls } = makeController('v2');
  const chest = makeChest();

  controller._activateChest(chest);

  assert.equal(chest.opened, true);
  assert.equal(calls.refractors.length, 0);
  assert.equal(calls.salvage.length, 1);
  const [quantity, position, recovery] = calls.salvage[0];
  assert.equal(quantity, 2);
  assert.equal(position.y, 3.35);
  assert.equal(recovery.source.rewardId, chest.id);
  assert.equal(recovery.recoverableParts.length, 1);
  assert.equal(recovery.recoverableParts[0].id, 'heavyServoFrame');
  assert.equal(recovery.recoverableParts[0].quantity, 1);
});

test('legacy chests retain their existing refractor reward path', () => {
  const { controller, calls } = makeController('legacy');
  controller._activateChest(makeChest());
  assert.equal(calls.salvage.length, 0);
  assert.equal(calls.refractors.length, 1);
});
