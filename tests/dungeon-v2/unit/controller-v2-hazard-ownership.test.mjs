import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonController } from '../../../src/DungeonController.js';

function controllerWithTrap(trap) {
  const incomingHits = [];
  const controller = Object.create(DungeonController.prototype);
  controller.traps = [trap];
  controller.trapPulseTimer = 0;
  controller.game = {
    elapsedTime: 0,
    player: {
      root: { position: new THREE.Vector3(0, 0, 0) },
      takeIncomingHit(hit) { incomingHits.push(hit); },
    },
    enemies: [],
    addParticleBurst() {},
    damageEnemy() {},
  };
  return { controller, incomingHits };
}

test('plan-owned V2 hazards are not damaged again by the legacy trap loop', () => {
  const { controller, incomingHits } = controllerWithTrap({
    id: 'hazard.v2',
    v2HazardId: 'environment.undercroft-hazard',
    active: true,
    position: new THREE.Vector3(0, 0, 0),
    halfWidth: 4,
    halfDepth: 4,
    verticalHalfHeight: 2,
    damagePerSecond: 99,
  });
  controller._updateTraps(0.5);
  assert.equal(incomingHits.length, 0);
});

test('legacy trap damage remains owned by the legacy controller path', () => {
  const { controller, incomingHits } = controllerWithTrap({
    id: 'trap.legacy',
    active: true,
    position: new THREE.Vector3(0, 0, 0),
    halfWidth: 4,
    halfDepth: 4,
    verticalHalfHeight: 2,
    damagePerSecond: 10,
    ambientHazardTags: ['fireFloor'],
  });
  controller._updateTraps(0.5);
  assert.equal(incomingHits.length, 1);
  assert.equal(incomingHits[0].amount, 5);
});
