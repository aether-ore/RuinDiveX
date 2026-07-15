import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CombatSystem } from '../src/CombatSystem.js';
import { ProjectileSystem } from '../src/ProjectileSystem.js';
import {
  BusterDiagnosticPlanError,
  BusterRuntime,
} from '../src/buster/BusterRuntime.js';
import {
  consumeBusterExecutionStagger,
  consumeBusterExecutionStaggerContribution,
  createBusterExecutionStaggerLedger,
  resolveBusterStaggerDuration,
} from '../src/buster/BusterStagger.js';
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

function createProjectileHarness(enemies = []) {
  const damage = [];
  const game = {
    scene: new THREE.Scene(),
    enemies,
    elapsedTime: 0,
    player: {
      radius: 0.42,
      root: { position: new THREE.Vector3(100, 0, 100) },
    },
    getProjectileTargets: () => enemies,
    damageEnemy: (enemy, amount, meta) => {
      damage.push({ enemy, amount, meta });
      return amount;
    },
    addExplosion: () => true,
    addParticleBurst: () => {},
  };
  return { game, system: new ProjectileSystem(game), damage };
}

function target(id, x, z, { height = 1.8 } = {}) {
  return {
    id,
    dead: false,
    radius: 0.42,
    collisionHeight: height,
    root: { position: new THREE.Vector3(x, 0, z) },
  };
}

test('held firing uses a magazine, insufficient requests lock, and update never fires stale contexts', () => {
  const shots = [];
  const runtime = new BusterRuntime({ executeShot: (execution) => shots.push(execution) });
  runtime.equip(plan());
  for (let index = 0; index < 3; index += 1) {
    const shot = runtime.fire({ marker: `shot-${index}` });
    assert.equal(shot.ok, true);
    runtime.releaseReservation(shot.execution.reservationToken);
    runtime.update(0.25, { activeWeaponKey: 'build-a', fireHeld: true });
  }
  assert.equal(runtime.getHudState().energy, 0);
  assert.deepEqual(runtime.requestFire(), { ok: false, reason: 'ENERGY', recoveryLocked: true });
  assert.equal(runtime.getHudState().blockReason, 'RECOVERY');

  runtime.update(2.2, { activeWeaponKey: 'build-a', fireHeld: true });
  assert.equal(runtime.getHudState().energy, 6);
  assert.equal(runtime.getHudState().recoveryLocked, false);
  assert.equal(shots.length, 3, 'resource updates never autonomously reuse the last firing context');
});

test('released active batteries recharge at full rate after 0.65 seconds', () => {
  const runtime = new BusterRuntime({ executeShot: () => true });
  runtime.equip(plan());
  const shot = runtime.fire();
  runtime.releaseReservation(shot.execution.reservationToken);

  runtime.update(0.64, { activeWeaponKey: 'build-a', fireHeld: false });
  assert.equal(runtime.getHudState().energy, 4);
  runtime.update(0.06, { activeWeaponKey: 'build-a', fireHeld: false });
  assert.ok(Math.abs(runtime.getHudState().energy - (4 + 6 / 1.8 * 0.05)) < 1e-9);
});

test('inactive registered weapons recharge independently at half speed', () => {
  const runtime = new BusterRuntime({ executeShot: () => true });
  runtime.equip(plan({ weaponKey: 'build-a' }));
  const shotA = runtime.fire();
  runtime.releaseReservation(shotA.execution.reservationToken);
  runtime.equip(plan({ weaponKey: 'build-b', maxEnergy: 8, energyCost: 3 }));
  const shotB = runtime.fire();
  runtime.releaseReservation(shotB.execution.reservationToken);

  runtime.update(1.65, { activeWeaponKey: 'build-b', fireHeld: false });
  assert.ok(Math.abs(runtime.getHudState('build-a').energy - (4 + (6 / 1.8) * 0.5)) < 1e-9);
  assert.ok(Math.abs(runtime.getHudState('build-b').energy - 8) < 1e-9);
});

test('cycling Mega and two Custom weapons preserves three independent batteries', () => {
  const runtime = new BusterRuntime({ executeShot: () => true });
  for (const weaponKey of ['megaBuster', 'build-a', 'build-b']) {
    runtime.equip(plan({ weaponKey, maxEnergy: 6, energyCost: 2, cycleTime: 0.2 }));
    const shot = runtime.fire({ weaponKey });
    runtime.releaseReservation(shot.execution.reservationToken);
  }
  assert.deepEqual(
    ['megaBuster', 'build-a', 'build-b'].map((key) => runtime.getHudState(key).energy),
    [4, 4, 4],
  );

  runtime.update(1.65, { activeWeaponKey: 'megaBuster', fireHeld: true });
  assert.equal(runtime.getHudState('megaBuster').energy, 6);
  assert.ok(Math.abs(runtime.getHudState('build-a').energy - (4 + (6 / 1.8) * 0.5)) < 1e-9);
  assert.ok(Math.abs(runtime.getHudState('build-b').energy - (4 + (6 / 1.8) * 0.5)) < 1e-9);

  for (const weaponKey of ['megaBuster', 'build-a', 'build-b']) {
    runtime.equip(runtime.plans.get(weaponKey));
    const shot = runtime.fire({ weaponKey, pass: 2 });
    assert.equal(shot.ok, true);
    runtime.releaseReservation(shot.execution.reservationToken);
  }
  assert.equal(runtime.getHudState('megaBuster').energy, 4);
  assert.ok(Math.abs(runtime.getHudState('build-a').energy - (2 + (6 / 1.8) * 0.5)) < 1e-9);
  assert.ok(Math.abs(runtime.getHudState('build-b').energy - (2 + (6 / 1.8) * 0.5)) < 1e-9);
});

test('recharge is input-independent and waits for both cycle and delay gates', () => {
  const held = new BusterRuntime({ executeShot: () => true });
  const released = new BusterRuntime({ executeShot: () => true });
  for (const runtime of [held, released]) {
    runtime.equip(plan({ cycleTime: 1, energyCost: 2 }));
    const shot = runtime.fire();
    runtime.releaseReservation(shot.execution.reservationToken);
  }

  held.update(0.8, { activeWeaponKey: 'build-a', fireHeld: true });
  released.update(0.8, { activeWeaponKey: 'build-a', fireHeld: false });
  assert.equal(held.getHudState().energy, 4);
  assert.equal(released.getHudState().energy, 4);

  held.update(0.3, { activeWeaponKey: 'build-a', fireHeld: true });
  released.update(0.3, { activeWeaponKey: 'build-a', fireHeld: false });
  const expected = 4 + (6 / 1.8) * 0.1;
  assert.ok(Math.abs(held.getHudState().energy - expected) < 1e-9);
  assert.ok(Math.abs(released.getHudState().energy - expected) < 1e-9);
});

test('cycle delay cannot create an Energy refund at the next legal release timestamp', () => {
  for (const fireHeld of [false, true]) {
    const runtime = new BusterRuntime({ executeShot: () => true });
    runtime.equip(plan({ cycleTime: 0.95, energyCost: 2 }));
    for (const expectedEnergy of [4, 2, 0]) {
      const shot = runtime.fire();
      assert.equal(shot.ok, true);
      runtime.releaseReservation(shot.execution.reservationToken);
      assert.equal(runtime.getHudState().energy, expectedEnergy);
      runtime.update(0.95, { activeWeaponKey: 'build-a', fireHeld });
      assert.equal(
        runtime.getHudState().energy,
        expectedEnergy,
        'the cycle boundary itself must not include post-cycle recharge time',
      );
    }
  }
});

test('production runtimes reject diagnostic plans unless explicitly authorized', () => {
  const diagnosticPlan = {
    ...plan(),
    diagnostic: { overrideOnly: true, overrides: [] },
  };
  const production = new BusterRuntime();
  assert.throws(
    () => production.equip(diagnosticPlan),
    (error) => error instanceof BusterDiagnosticPlanError && error.code === 'DIAGNOSTIC_PLAN_REJECTED',
  );
  assert.equal(production.plans.size, 0);

  assert.ok(production.equip(diagnosticPlan, { diagnosticContext: true }));
  const diagnosticRuntime = new BusterRuntime({ diagnosticContext: true });
  assert.ok(diagnosticRuntime.equip(diagnosticPlan));
});

test('held and tapped insufficient requests enter the same recovery lock', () => {
  for (const fireHeld of [false, true]) {
    const runtime = new BusterRuntime({ executeShot: () => true });
    runtime.equip(plan({ energyCost: 4, cycleTime: 0 }));
    const shot = runtime.fire();
    runtime.releaseReservation(shot.execution.reservationToken);
    runtime.update(0, { activeWeaponKey: 'build-a', fireHeld });
    assert.deepEqual(runtime.requestFire(), { ok: false, reason: 'ENERGY', recoveryLocked: true });
    assert.equal(runtime.getHudState().recoveryLocked, true);
  }
});

test('a failed Energy request does not restart the successful-shot recharge delay', () => {
  const runtime = new BusterRuntime({ executeShot: () => true });
  runtime.equip(plan({ energyCost: 4, cycleTime: 0 }));
  const shot = runtime.fire();
  runtime.releaseReservation(shot.execution.reservationToken);
  runtime.update(0.3, { activeWeaponKey: 'build-a', fireHeld: false });
  runtime.requestFire();
  assert.ok(Math.abs(runtime.getHudState().rechargeDelayRemaining - 0.35) < 1e-9);
  runtime.update(0.34, { activeWeaponKey: 'build-a', fireHeld: true });
  assert.equal(runtime.getHudState().energy, 2);
  runtime.update(0.02, { activeWeaponKey: 'build-a', fireHeld: true });
  assert.ok(runtime.getHudState().energy > 2);
});

test('recovery lock remains closed at a partial shot threshold and clears only at full', () => {
  const runtime = new BusterRuntime({ executeShot: () => true });
  runtime.equip(plan({ energyCost: 4, cycleTime: 0 }));
  const shot = runtime.fire();
  runtime.releaseReservation(shot.execution.reservationToken);
  runtime.requestFire();
  runtime.update(1.25, { activeWeaponKey: 'build-a', fireHeld: true });
  assert.ok(runtime.getHudState().energy >= 4);
  assert.equal(runtime.canFire(), false);
  assert.equal(runtime.getHudState().blockReason, 'RECOVERY');
  runtime.update(0.6, { activeWeaponKey: 'build-a', fireHeld: true });
  assert.equal(runtime.getHudState().energy, 6);
  assert.equal(runtime.canFire(), true);
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
  assert.equal(runtime.getHudState().recoveryLocked, false);
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
  runtime.equip(plan({ weaponKey: 'megaBuster', maxEnergy: 6, energyCost: 2 }));
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

test('registering a new revision changes future shots without cancelling in-flight executions', () => {
  const cancelled = [];
  const runtime = new BusterRuntime({
    executeShot: () => true,
    cancelExecution: (entry) => cancelled.push(entry),
  });
  runtime.equip(plan({ revision: 1 }));
  const first = runtime.fire({ marker: 'old' });
  runtime.register(plan({ revision: 2 }));
  assert.equal(cancelled.length, 0);
  assert.equal(runtime.getReservedProjectileCount(), 1);
  assert.equal(first.execution.plan.revision, 1);

  runtime.update(0.25, { activeWeaponKey: 'build-a', fireHeld: false });
  const second = runtime.fire({ marker: 'new' });
  assert.equal(second.ok, true);
  assert.equal(second.execution.plan.revision, 2);
  runtime.releaseReservation(first.execution.reservationToken);
  runtime.releaseReservation(second.execution.reservationToken);
});

test('unregistering an invalid future plan can preserve its in-flight execution', () => {
  const cancelled = [];
  const runtime = new BusterRuntime({
    executeShot: () => true,
    cancelExecution: (entry) => cancelled.push(entry),
  });
  runtime.equip(plan());
  const shot = runtime.fire();
  assert.equal(runtime.unregister('build-a'), true);
  assert.equal(runtime.canFire('build-a'), false);
  assert.equal(runtime.getReservedProjectileCount(), 1);
  assert.equal(cancelled.length, 0);
  runtime.releaseReservation(shot.execution.reservationToken);
});

test('execution stagger contributes only increases in the largest packet per target', () => {
  const ledger = createBusterExecutionStaggerLedger('execution-1');
  const first = { id: 'enemy-a' };
  const second = { id: 'enemy-b' };

  assert.equal(consumeBusterExecutionStagger(ledger, first, 0.03, 1), 0.03);
  assert.equal(consumeBusterExecutionStagger(ledger, first, 0.2, 5), 0.17);
  assert.equal(consumeBusterExecutionStagger(ledger, first, 0.12, 3), 0);
  assert.equal(consumeBusterExecutionStagger(ledger, second, 0.2, 5), 0.2);
  assert.equal(consumeBusterExecutionStagger(ledger, first, 0.3, 0), 0);
  assert.ok(Math.abs(consumeBusterExecutionStagger(ledger, first, 0.3, 5) - 0.1) < 1e-9);
  assert.deepEqual(ledger.entriesByTarget.get('target:enemy-a'), {
    largestNominalDuration: 0.3,
    totalGrantedDuration: 0.3,
  });

  const exact = consumeBusterExecutionStaggerContribution(ledger, first, 0.31, 2);
  assert.equal(exact.previousTotalGrantedDuration, 0.3);
  assert.equal(exact.largestNominalDuration, 0.31);
  assert.ok(Math.abs(exact.additionalDuration - 0.01) < 1e-9);
  assert.equal(exact.totalGrantedDuration, 0.31);
});

test('legacy Machine Gun and Cannon have no hidden Range bonus while Missile keeps 1.8', () => {
  const combat = Object.create(CombatSystem.prototype);
  combat.game = { player: { stats: { attackRange: 6 } } };
  assert.equal(combat._getProfileRange({ type: 'machineGunArm' }), 6);
  assert.equal(combat._getProfileRange({ type: 'cannonArm' }), 6);
  assert.equal(combat._getProfileRange({ type: 'missileArm', special: 'missile' }), 7.8);
});

test('stagger resolution leaves legacy packets unchanged and supports shared explosion metadata', () => {
  const target = { id: 'enemy-a' };
  assert.equal(resolveBusterStaggerDuration({ stagger: 0.2 }, target, 5), 0.2);

  const busterExecutionStaggerLedger = createBusterExecutionStaggerLedger('execution-2');
  const direct = { stagger: 0.04, busterExecutionStaggerLedger };
  const explosion = { stagger: 0.3, busterExecutionStaggerLedger };
  assert.equal(resolveBusterStaggerDuration(direct, target, 2), 0.04);
  assert.equal(resolveBusterStaggerDuration(explosion, target, 8), 0.26);
});

test('controlled projectiles use swept collision and choose the earliest target deterministically', () => {
  const farther = target('farther', 0, 8);
  const nearer = target('nearer', 0, 5);
  const { system, damage } = createProjectileHarness([farther, nearer]);
  system.spawn({
    owner: 'player',
    position: new THREE.Vector3(0, 1, 0),
    direction: new THREE.Vector3(0, 0, 1),
    speed: 12,
    range: 20,
    radius: 0.1,
    damage: 7,
    controller: {},
  });

  system.update(1);
  assert.equal(damage.length, 1);
  assert.equal(damage[0].enemy.id, 'nearer');
  assert.equal(system.active.length, 0);
});

test('swept controlled hits preserve exposed geometric weak points ahead of the body capsule', () => {
  const enemy = target('weak', 0, 5);
  const weakPoint = new THREE.Vector3(0, 1, 4.15);
  enemy.resolveProjectileHit = (position, projectileRadius) => (
    position.distanceTo(weakPoint) <= projectileRadius + 0.22
      ? { hitPartId: 'weak-core', weakPointHit: true, hitPosition: position.clone() }
      : null
  );
  const { system, damage } = createProjectileHarness([enemy]);
  system.spawn({
    owner: 'player',
    position: new THREE.Vector3(0, 1, 0),
    direction: new THREE.Vector3(0, 0, 1),
    speed: 12,
    range: 20,
    radius: 0.1,
    damage: 7,
    controller: {},
  });

  system.update(1);
  assert.equal(damage.length, 1);
  assert.equal(damage[0].meta.weakPointHit, true);
  assert.equal(damage[0].meta.hitPartId, 'weak-core');
});

test('Delay advance is chronologically arbitrated before a later swept impact', () => {
  const enemy = target('enemy', 0, 5);
  const { system, damage } = createProjectileHarness([enemy]);
  const events = [];
  const data = { elapsed: 0 };
  system.spawn({
    owner: 'player',
    position: new THREE.Vector3(0, 1, 0),
    direction: new THREE.Vector3(0, 0, 1),
    speed: 10,
    range: 20,
    radius: 0.1,
    damage: 7,
    controllerData: data,
    controller: {
      onAdvance: ({ projectile, dt, travel, previousPosition }) => {
        const before = data.elapsed;
        data.elapsed += dt;
        if (before < 0.3 && data.elapsed >= 0.3) {
          const fraction = dt > 0 ? (0.3 - before) / dt : 0;
          projectile.mesh.position.copy(previousPosition).addScaledVector(projectile.direction, travel * fraction);
          events.push('delay');
          return { dispose: true, reason: 'delayTrigger', consumedTime: dt * fraction };
        }
        return null;
      },
      onEnemyImpact: () => {
        events.push('impact');
        return { dispose: true };
      },
      onDispose: ({ reason }) => events.push(`dispose:${reason}`),
    },
  });

  system.update(1);
  assert.deepEqual(events, ['delay', 'dispose:delayTrigger']);
  assert.equal(damage.length, 0);
});

test('Delay arbitration is frame-rate stable at 30, 60, and 120 Hz', () => {
  for (const hz of [30, 60, 120]) {
    const enemy = target(`enemy-${hz}`, 0, 5);
    const { system, damage } = createProjectileHarness([enemy]);
    const events = [];
    const data = { elapsed: 0 };
    system.spawn({
      owner: 'player',
      position: new THREE.Vector3(0, 1, 0),
      direction: new THREE.Vector3(0, 0, 1),
      speed: 10,
      range: 20,
      radius: 0.1,
      damage: 7,
      controller: {
        onAdvance: ({ projectile, dt, travel, previousPosition }) => {
          const before = data.elapsed;
          data.elapsed += dt;
          if (before < 0.3 && data.elapsed + 1e-9 >= 0.3) {
            const fraction = dt > 0 ? Math.max(0, Math.min(1, (0.3 - before) / dt)) : 0;
            projectile.mesh.position.copy(previousPosition).addScaledVector(projectile.direction, travel * fraction);
            events.push('delay');
            return { dispose: true, reason: 'delayTrigger', consumedTime: dt * fraction };
          }
          return null;
        },
        onEnemyImpact: () => {
          events.push('impact');
          return { dispose: true };
        },
        onDispose: ({ reason }) => events.push(`dispose:${reason}`),
      },
    });
    for (let frame = 0; frame < hz && system.active.length > 0; frame += 1) {
      system.update(1 / hz);
    }
    assert.deepEqual(events, ['delay', 'dispose:delayTrigger'], `${hz} Hz event order`);
    assert.equal(damage.length, 0, `${hz} Hz damage`);
  }
});

test('triggered children consume the carrier remainder in the same production frame', () => {
  const { system } = createProjectileHarness();
  const carrierData = { elapsed: 0 };
  let childElapsed = 0;
  system.spawn({
    owner: 'player',
    position: new THREE.Vector3(0, 1, 0),
    direction: new THREE.Vector3(0, 0, 1),
    speed: 10,
    range: 20,
    radius: 0.1,
    damage: 0,
    executionId: 'same-frame-execution',
    reservationToken: 'same-frame-reservation',
    actionId: 'emit-carrier',
    triggerDepth: 0,
    controller: {
      onAdvance: ({ projectile, dt, travel, previousPosition }) => {
        const before = carrierData.elapsed;
        carrierData.elapsed += dt;
        if (before < 0.01 && carrierData.elapsed >= 0.01) {
          const fraction = (0.01 - before) / dt;
          projectile.mesh.position.copy(previousPosition)
            .addScaledVector(projectile.direction, travel * fraction);
          return { dispose: true, reason: 'delayTrigger', consumedTime: dt * fraction };
        }
        return null;
      },
      onDispose: ({ system: projectileSystem, projectile, reason }) => {
        if (reason !== 'delayTrigger') return;
        projectileSystem.spawn({
          owner: 'player',
          position: projectile.mesh.position.clone(),
          direction: projectile.direction.clone(),
          speed: 10,
          range: 20,
          radius: 0.1,
          damage: 0,
          executionId: 'same-frame-execution',
          reservationToken: 'same-frame-reservation',
          actionId: 'emit-child',
          triggerDepth: 1,
          controller: {
            onAdvance: ({ dt: childDt }) => {
              childElapsed += childDt;
            },
          },
        });
      },
    },
  });

  system.update(0.05);

  assert.ok(Math.abs(childElapsed - 0.04) < 1e-9, `child advanced ${childElapsed} seconds`);
  assert.equal(system.active.length, 1);
  assert.equal(system.active[0].actionId, 'emit-child');
  assert.ok(Math.abs(system.active[0].distance - 0.4) < 1e-9);
});

test('guided range and disposal boundaries survive guidance substeps at every frame rate', () => {
  const boundaryTime = 0.02;
  const frameSteps = [1 / 30, 1 / 60, 1 / 120, 0.35];

  for (const boundary of ['range', 'disposal']) {
    for (const frameStep of frameSteps) {
      const { system } = createProjectileHarness();
      const guidanceTarget = target(`guide-${boundary}-${frameStep}`, 100, 100);
      const events = [];
      let elapsed = 0;
      system.spawn({
        owner: 'player',
        position: new THREE.Vector3(0, 1, 0),
        direction: new THREE.Vector3(0, 0, 1),
        speed: 10,
        range: boundary === 'range' ? boundaryTime * 10 : 100,
        lifetime: boundary === 'disposal' ? boundaryTime : Infinity,
        radius: 0.1,
        damage: 1,
        homingStrength: 4.2,
        target: guidanceTarget,
        controller: {
          onAdvance: ({ dt }) => {
            elapsed += dt;
          },
          onRangeEnd: () => {
            events.push('range');
          },
          onDispose: ({ reason }) => {
            events.push(`dispose:${reason}`);
          },
        },
      });

      for (let frame = 0; frame < 10 && system.active.length > 0; frame += 1) {
        system.update(frameStep);
      }

      assert.ok(
        Math.abs(elapsed - boundaryTime) < 1e-9,
        `${boundary} at dt=${frameStep} advanced ${elapsed} seconds`,
      );
      assert.deepEqual(
        events,
        boundary === 'range'
          ? ['range', 'dispose:rangeEnd']
          : ['dispose:expired'],
        `${boundary} at dt=${frameStep} lifecycle`,
      );
      assert.equal(system.active.length, 0, `${boundary} at dt=${frameStep} deactivated`);
    }
  }
});

test('Apex wins an exact-time tie with enemy impact for controlled projectiles', () => {
  const tangentEnemy = target('tangent', 0.52, 5, { height: 4 });
  const { system, damage } = createProjectileHarness([tangentEnemy]);
  const events = [];
  system.spawn({
    owner: 'player',
    position: new THREE.Vector3(0, 1, 0),
    direction: new THREE.Vector3(0, 0, 1),
    speed: 10,
    range: 10,
    radius: 0.1,
    damage: 7,
    arcHeight: 2,
    endY: 1,
    controller: {
      onApexCrossing: () => {
        events.push('apex');
        return { dispose: true, reason: 'apexTrigger' };
      },
      onEnemyImpact: () => {
        events.push('impact');
        return { dispose: true };
      },
      onDispose: ({ reason }) => events.push(`dispose:${reason}`),
    },
  });

  system.update(1);
  assert.deepEqual(events, ['apex', 'dispose:apexTrigger']);
  assert.equal(damage.length, 0);
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
