import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Enemy } from '../src/Enemy.js';

const SIGNED_ROOM_ELEVATIONS = Object.freeze([-28, -14, 0, 14]);

function createEnemyFixture(baseElevation, { withRig = true } = {}) {
  const root = new THREE.Group();
  root.position.set(3, baseElevation, -5);

  const fixture = {
    root,
    gorubesshuRig: null,
  };

  if (withRig) {
    const muzzle = new THREE.Group();
    muzzle.position.set(0.2, 0.08, 0.3);
    root.add(muzzle);

    const shieldArm = new THREE.Group();
    shieldArm.position.set(-0.25, 0.12, 0.2);
    root.add(shieldArm);

    root.updateMatrixWorld(true);
    fixture.gorubesshuRig = { muzzle, shieldArm };
  }

  return fixture;
}

test('Gorubesshu flame origins preserve local muzzle height at signed room elevations', () => {
  const direction = new THREE.Vector3(0, 0, 1);

  for (const baseElevation of SIGNED_ROOM_ELEVATIONS) {
    const rigged = createEnemyFixture(baseElevation);
    const riggedOrigin = Enemy.prototype._getGorubesshuFlameOrigin.call(
      rigged,
      new THREE.Vector3(),
      direction,
    );
    assert.equal(riggedOrigin.y, baseElevation + 0.52);

    const fallback = createEnemyFixture(baseElevation, { withRig: false });
    const fallbackOrigin = Enemy.prototype._getGorubesshuFlameOrigin.call(
      fallback,
      new THREE.Vector3(),
      direction,
    );
    assert.equal(fallbackOrigin.y, baseElevation + 0.58);
    assert.equal(fallbackOrigin.x, fallback.root.position.x);
    assert.equal(fallbackOrigin.z, fallback.root.position.z + 0.72);
  }
});

test('Gorubesshu shield impacts preserve local guard height at signed room elevations', () => {
  for (const baseElevation of SIGNED_ROOM_ELEVATIONS) {
    const rigged = createEnemyFixture(baseElevation);
    const riggedImpact = Enemy.prototype._getGorubesshuShieldImpactPosition.call(rigged);
    assert.equal(riggedImpact.y, baseElevation + 0.78);

    const fallback = createEnemyFixture(baseElevation, { withRig: false });
    const fallbackImpact = Enemy.prototype._getGorubesshuShieldImpactPosition.call(fallback);
    assert.equal(fallbackImpact.y, baseElevation + 0.82);
  }
});
