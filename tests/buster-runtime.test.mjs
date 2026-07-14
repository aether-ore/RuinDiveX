import assert from 'node:assert/strict';
import test from 'node:test';

import { BusterRuntime } from '../src/buster/BusterRuntime.js';
import {
  getBallisticApexProgress,
  getClusterDirections,
  getSpreadDirections,
  sampleBallisticPoint,
} from '../src/buster/BusterTrajectory.js';

function plan(overrides = {}) {
  return {
    weaponKey: overrides.weaponKey ?? 'build-a',
    buildId: overrides.weaponKey ?? 'build-a',
    revision: overrides.revision ?? 1,
    peakProjectileReservation: overrides.peakProjectileReservation ?? 1,
    stats: {
      maxEnergy: overrides.maxEnergy ?? 6,
      energyCost: overrides.energyCost ?? 2,
      cycleTime: overrides.cycleTime ?? 0.25,
    },
  };
}

test('battery waits 0.65 seconds, recharges at maxEnergy / 1.8, and resumes held fire', () => {
  const shots = [];
  const runtime = new BusterRuntime({ executeShot: (execution) => shots.push(execution) });
  runtime.equip(plan());
  const first = runtime.fire({ marker: 'first' });
  assert.equal(first.ok, true);
  runtime.releaseReservation(first.execution.reservationToken);
  assert.equal(runtime.getHudState().energy, 4);

  runtime.update(0.64);
  assert.equal(runtime.getHudState().energy, 4);
  runtime.update(0.06);
  assert.ok(Math.abs(runtime.getHudState().energy - (4 + 6 / 1.8 * 0.05)) < 1e-9);

  runtime.update(1, { fireHeld: true, context: { marker: 'held' } });
  assert.equal(shots.length, 2);
  assert.equal(shots[1].context.marker, 'held');
});

test('inactive registered weapons recharge independently', () => {
  const runtime = new BusterRuntime({ executeShot: () => true });
  runtime.equip(plan({ weaponKey: 'build-a' }));
  const shotA = runtime.fire();
  runtime.releaseReservation(shotA.execution.reservationToken);
  runtime.equip(plan({ weaponKey: 'build-b', maxEnergy: 8, energyCost: 3 }));
  const shotB = runtime.fire();
  runtime.releaseReservation(shotB.execution.reservationToken);

  runtime.update(1.65);
  assert.ok(runtime.getHudState('build-a').energy > 4);
  assert.ok(runtime.getHudState('build-b').energy > 5);
});

test('peak projectile reservation is atomic and rejected shots spend no energy', () => {
  const runtime = new BusterRuntime({ projectileCapacity: 5, executeShot: () => true });
  runtime.equip(plan({ peakProjectileReservation: 5 }));
  const first = runtime.fire();
  assert.equal(first.ok, true);
  assert.equal(runtime.getReservedProjectileCount(), 5);
  runtime.update(1);
  const before = runtime.getHudState().energy;
  const second = runtime.fire();
  assert.deepEqual(second, { ok: false, reason: 'PROJECTILE_CAP' });
  assert.equal(runtime.getHudState().energy, before);
  runtime.releaseReservation(first.execution.reservationToken);
  assert.equal(runtime.getReservedProjectileCount(), 0);
});

test('execute callback cannot re-enter fire before the first shot commits', () => {
  let nested = null;
  const runtime = new BusterRuntime({
    executeShot: () => {
      nested = runtime.fire();
      return true;
    },
  });
  runtime.equip(plan({ energyCost: 1, cycleTime: 0 }));
  const result = runtime.fire();
  assert.equal(result.ok, true);
  assert.deepEqual(nested, { ok: false, reason: 'FIRING' });
  assert.equal(runtime.getHudState().energy, 5);
});

test('spawn rejection and thrown callbacks roll battery and reservation back', () => {
  const rejected = new BusterRuntime({ executeShot: () => false });
  rejected.equip(plan());
  assert.equal(rejected.fire().reason, 'SPAWN_REJECTED');
  assert.equal(rejected.getHudState().energy, 6);
  assert.equal(rejected.getReservedProjectileCount(), 0);

  const failed = new BusterRuntime({ executeShot: () => { throw new Error('spawn failed'); } });
  failed.equip(plan());
  assert.throws(() => failed.fire(), /spawn failed/);
  assert.equal(failed.getHudState().energy, 6);
  assert.equal(failed.getReservedProjectileCount(), 0);
});

test('resource snapshots restore every independent battery after a temporary range plan', () => {
  const runtime = new BusterRuntime({ executeShot: () => true });
  runtime.equip(plan({ weaponKey: 'megaBuster', energyCost: 2 }));
  const megaShot = runtime.fire({ marker: 'mega' });
  runtime.releaseReservation(megaShot.execution.reservationToken);
  runtime.equip(plan({ weaponKey: 'build-a', energyCost: 1 }));
  const customShot = runtime.fire({ marker: 'custom' });
  runtime.releaseReservation(customShot.execution.reservationToken);
  const before = runtime.createResourceSnapshot();

  runtime.equip(plan({ weaponKey: 'test:build-a:2', energyCost: 1 }));
  runtime.update(2);
  runtime.resetWeapon('test:build-a:2', { remove: true });
  assert.equal(runtime.restoreResourceSnapshot(before), true);

  assert.equal(runtime.activeKey, 'build-a');
  assert.equal(runtime.getHudState('megaBuster').energy, 4);
  assert.equal(runtime.getHudState('build-a').energy, 5);
  assert.equal(runtime.states.get('build-a').lastContext.marker, 'custom');
});

test('spread, cluster, and ballistic samples are deterministic and elevation-aware', () => {
  const direction = { x: 0, y: 0, z: 1 };
  assert.deepEqual(getSpreadDirections(direction, [-0.14, 0, 0.14]), getSpreadDirections(direction, [-0.14, 0, 0.14]));
  const cluster = getClusterDirections({ x: 0, y: 1, z: 0 }, 5);
  assert.equal(cluster.length, 5);
  assert.equal(new Set(cluster.map((entry) => `${entry.x.toFixed(5)},${entry.y.toFixed(5)},${entry.z.toFixed(5)}`)).size, 5);
  for (const entry of cluster) assert.ok(Math.abs(Math.hypot(entry.x, entry.y, entry.z) - 1) < 1e-9);

  const options = { start: { x: 0, y: 1, z: 0 }, end: { x: 6, y: 3, z: 0 }, arcHeight: 2 };
  const apex = getBallisticApexProgress(options);
  assert.ok(apex > 0.5 && apex < 1);
  const apexPoint = sampleBallisticPoint(options, apex);
  assert.ok(apexPoint.y > 3);
  assert.deepEqual(sampleBallisticPoint(options, 1), { x: 6, y: 3.0000000000000004, z: 0 });
});
