import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DungeonConnectorLiftRuntime } from '../src/DungeonConnectorLiftRuntime.js';

function createFixture({ playerOnLift = true } = {}) {
  const platformObject = new THREE.Object3D();
  platformObject.position.set(2, -0.14, 3);
  const surface = {
    id: 'freight-lift:surface',
    center: new THREE.Vector3(2, 0, 3),
    halfWidth: 1.4,
    halfDepth: 1.2,
    topY: 0,
    baseY: -0.28,
    dynamic: true,
  };
  const descriptor = {
    id: 'freight-lift',
    bottomElevation: 0,
    topElevation: 4,
    speedMetersPerSecond: 2,
    dwellSeconds: 1,
    platformObject,
    surface,
    controls: [
      { id: 'freight-lift:call:bottom', endpoint: 'bottom' },
      { id: 'freight-lift:call:top', endpoint: 'top' },
    ],
    currentElevation: 0,
    phase: 'dwelling-bottom',
    dwellRemaining: 1,
  };
  const registered = [];
  const playerPosition = playerOnLift
    ? new THREE.Vector3(2, 0, 3)
    : new THREE.Vector3(8, 0, 8);
  const game = {
    player: {
      root: { position: playerPosition },
      dead: false,
      isJumpAirborne: () => false,
    },
    dungeonController: { lastSafePlayerPosition: playerPosition.clone() },
    registerDynamicPlatformingSurface(candidate) {
      if (!registered.includes(candidate)) registered.push(candidate);
      return true;
    },
    unregisterDynamicPlatformingSurface(candidate) {
      const index = registered.indexOf(candidate);
      if (index >= 0) registered.splice(index, 1);
      return index >= 0;
    },
  };
  return { descriptor, surface, platformObject, registered, game };
}

test('automatic connector lift registers, dwells, moves its visual, and carries a rider', () => {
  const fixture = createFixture();
  const runtime = new DungeonConnectorLiftRuntime(fixture.game, [fixture.descriptor]);
  runtime.mount();
  assert.deepEqual(fixture.registered, [fixture.surface]);

  runtime.prePlayerUpdate(1);
  assert.equal(fixture.surface.topY, 0, 'initial dwell should complete before movement');
  runtime.prePlayerUpdate(0.5);
  assert.equal(fixture.surface.topY, 1);
  assert.equal(fixture.platformObject.position.y, 0.86);
  assert.equal(fixture.game.player.root.position.y, 1);
  assert.equal(fixture.game.dungeonController.lastSafePlayerPosition.y, 1);

  const diagnostics = runtime.getDiagnostics();
  assert.equal(diagnostics.lifts[0].phase, 'moving');
  assert.equal(diagnostics.lifts[0].lastRiderCarried, true);
  assert.equal(diagnostics.lifts[0].carriedDistanceMeters, 1);
});

test('automatic connector lift motion is invariant under frame chunking', () => {
  const coarseFixture = createFixture({ playerOnLift: false });
  const fineFixture = createFixture({ playerOnLift: false });
  const coarse = new DungeonConnectorLiftRuntime(coarseFixture.game, [coarseFixture.descriptor]);
  const fine = new DungeonConnectorLiftRuntime(fineFixture.game, [fineFixture.descriptor]);
  coarse.mount();
  fine.mount();

  coarse.prePlayerUpdate(6.35);
  for (let elapsed = 0; elapsed < 6.35 - 1e-9; elapsed += 0.05) {
    fine.prePlayerUpdate(Math.min(0.05, 6.35 - elapsed));
  }

  const coarseLift = coarse.getDiagnostics().lifts[0];
  const fineLift = fine.getDiagnostics().lifts[0];
  assert.ok(Math.abs(coarseLift.currentElevation - fineLift.currentElevation) < 1e-8);
  assert.equal(coarseLift.phase, fineLift.phase);
  assert.equal(coarseLift.targetEndpoint, fineLift.targetEndpoint);
  assert.ok(Math.abs(coarseLift.dwellRemaining - fineLift.dwellRemaining) < 1e-8);
});

test('lift requests accept lift IDs and authored control IDs, including reversal', () => {
  const fixture = createFixture({ playerOnLift: false });
  const runtime = new DungeonConnectorLiftRuntime(fixture.game, [fixture.descriptor]);
  runtime.mount();
  runtime.prePlayerUpdate(1.5);
  assert.equal(fixture.surface.topY, 1);

  assert.deepEqual(runtime.requestLift('freight-lift', 'bottom'), {
    ok: true,
    liftId: 'freight-lift',
    endpoint: 'bottom',
    alreadyPresent: false,
  });
  runtime.prePlayerUpdate(0.5);
  assert.equal(fixture.surface.topY, 0);

  const present = runtime.requestLift('freight-lift:call:bottom');
  assert.equal(present.ok, true);
  assert.equal(present.alreadyPresent, true);
  runtime.prePlayerUpdate(0.5);
  assert.equal(fixture.surface.topY, 0, 'a call at the current landing refreshes its dwell');

  const topCall = runtime.requestLift('freight-lift:call:top');
  assert.equal(topCall.ok, true);
  runtime.prePlayerUpdate(0.5);
  assert.equal(fixture.surface.topY, 1, 'opposite call dispatches immediately during dwell');
});

test('unmount preserves state for rollback while dispose unregisters permanently', () => {
  const fixture = createFixture({ playerOnLift: false });
  const runtime = new DungeonConnectorLiftRuntime(fixture.game, [fixture.descriptor]);
  runtime.mount();
  runtime.prePlayerUpdate(1.75);
  const elevation = fixture.surface.topY;

  assert.equal(runtime.unmount(), true);
  assert.equal(fixture.registered.length, 0);
  assert.equal(fixture.surface.topY, elevation);
  assert.equal(runtime.mount(), true);
  assert.deepEqual(fixture.registered, [fixture.surface]);
  assert.equal(runtime.dispose(), true);
  assert.equal(fixture.registered.length, 0);
  assert.equal(runtime.mount(), false);
});

test('shortcut lifts remain parked until their far-side mechanism is activated', () => {
  const fixture = createFixture({ playerOnLift: false });
  fixture.descriptor.shortcutMechanismId = 'supplement:shortcut:control';
  fixture.descriptor.shortcutUnlocked = false;
  let activated = false;
  fixture.game.dungeonController._isMechanismActivated = (id) => (
    id === 'supplement:shortcut:control' && activated
  );
  const runtime = new DungeonConnectorLiftRuntime(fixture.game, [fixture.descriptor]);
  runtime.mount();

  runtime.prePlayerUpdate(4);
  assert.equal(fixture.surface.topY, 0);
  assert.equal(runtime.requestLift('freight-lift', 'top').reason, 'shortcut-locked');
  assert.equal(runtime.getDiagnostics().lifts[0].shortcutUnlocked, false);

  activated = true;
  runtime.prePlayerUpdate(0);
  assert.equal(runtime.getDiagnostics().lifts[0].shortcutUnlocked, true);
  assert.equal(runtime.requestLift('freight-lift', 'top').ok, true);
  runtime.prePlayerUpdate(0.5);
  assert.equal(fixture.surface.topY, 1);
});
