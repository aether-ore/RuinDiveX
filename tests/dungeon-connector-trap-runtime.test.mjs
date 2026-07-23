import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceReflectedTrack,
  DungeonConnectorTrapRuntime,
  sweptTrapIntersectsPlayer,
} from '../src/DungeonConnectorTrapRuntime.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function createDescriptor(overrides = {}) {
  return {
    id: 'gallery-track-trap-1',
    trackStart: { x: -5, y: 2.15, z: 0 },
    trackEnd: { x: 5, y: 2.15, z: 0 },
    warningVolume: {
      center: { x: 0, y: 1.5, z: 0 },
      halfSize: { x: 5, y: 1.75, z: 1.4 },
    },
    initialTrackRatio: 0,
    initialDirection: 'toward-end',
    contactOffsetMeters: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

function createGame({ position = { x: 0, y: 0, z: 8 }, hitResult = null } = {}) {
  const incomingHits = [];
  const player = {
    root: { position: { ...position } },
    radius: 0.42,
    collisionHeight: 2.85,
    dead: false,
    takeIncomingHit(context) {
      incomingHits.push(context);
      return hitResult ?? {
        contacted: true,
        dodged: false,
        immune: false,
        healthDamage: context.amount,
      };
    },
  };
  return { player, incomingHits };
}

test('reflected motion reverses only at physical endpoints', () => {
  const beforeEndpoint = advanceReflectedTrack({
    position: 2,
    direction: 1,
    distance: 7.5,
    length: 10,
  });
  assert.equal(beforeEndpoint.position, 9.5);
  assert.equal(beforeEndpoint.direction, 1);
  assert.equal(beforeEndpoint.bounceCount, 0);

  const afterEndpoint = advanceReflectedTrack({
    position: 2,
    direction: 1,
    distance: 9,
    length: 10,
  });
  assert.equal(afterEndpoint.position, 9);
  assert.equal(afterEndpoint.direction, -1);
  assert.equal(afterEndpoint.bounceCount, 1);
  assert.deepEqual(afterEndpoint.segments, [
    { start: 2, end: 10, direction: 1 },
    { start: 10, end: 9, direction: -1 },
  ]);
});

test('entering the warning band accelerates the current direction without reversing it', () => {
  const game = createGame({ position: { x: 0, y: 0, z: 9 } });
  const descriptor = deepFreeze(createDescriptor({
    initialTrackRatio: 0.5,
    initialDirection: 'toward-start',
  }));
  const snapshot = JSON.stringify(descriptor);
  const runtime = new DungeonConnectorTrapRuntime(game, [descriptor]);
  runtime.mount();

  runtime.prePlayerUpdate(1);
  let diagnostics = runtime.getDiagnostics().traps[0];
  assert.equal(diagnostics.alerted, false);
  assert.equal(diagnostics.speedMetersPerSecond, 0.7);
  assert.ok(Math.abs(diagnostics.currentTrackDistance - 4.3) < 1e-9);
  assert.equal(diagnostics.currentDirection, -1);

  game.player.root.position.z = 0;
  runtime.prePlayerUpdate(1);
  diagnostics = runtime.getDiagnostics().traps[0];
  assert.equal(diagnostics.alerted, true);
  assert.equal(diagnostics.speedMetersPerSecond, 3.2);
  assert.ok(Math.abs(diagnostics.currentTrackDistance - 1.1) < 1e-9);
  assert.equal(diagnostics.currentDirection, -1, 'alert may not reverse track direction');
  assert.equal(JSON.stringify(descriptor), snapshot, 'runtime must not mutate the frozen plan record');
});

test('enemies neither activate nor receive connector trap contact', () => {
  const game = createGame({ position: { x: 0, y: 0, z: 9 } });
  let enemyHits = 0;
  game.enemies = [{
    root: { position: { x: 0, y: 0, z: 0 } },
    takeIncomingHit() { enemyHits += 1; },
  }];
  const runtime = new DungeonConnectorTrapRuntime(game, [createDescriptor({
    patrolSpeedMetersPerSecond: 10,
    alertSpeedMetersPerSecond: 30,
  })]);
  runtime.mount();
  runtime.prePlayerUpdate(0.5);

  const trap = runtime.getDiagnostics().traps[0];
  assert.equal(trap.alerted, false);
  assert.equal(trap.speedMetersPerSecond, 10);
  assert.equal(enemyHits, 0);
  assert.equal(game.incomingHits.length, 0);
});

test('the dungeon facade exposes detached runtime diagnostics throughout its lifecycle', () => {
  const game = createGame({ position: { x: 0, y: 0, z: 9 } });
  const facade = { connectorTrackTraps: [createDescriptor()] };
  const runtime = new DungeonConnectorTrapRuntime(game, facade);

  assert.equal(facade.connectorTrackTrapRuntimeDiagnostics.mounted, false);
  assert.equal(facade.connectorTrackTrapRuntimeDiagnostics.trapCount, 1);
  runtime.mount();
  assert.equal(facade.connectorTrackTrapRuntimeDiagnostics.mounted, true);

  const before = facade.connectorTrackTrapRuntimeDiagnostics;
  runtime.prePlayerUpdate(1);
  const after = facade.connectorTrackTrapRuntimeDiagnostics;
  assert.notEqual(after, before);
  assert.equal(after.traps[0].distanceTravelledMeters, 0.7);
  assert.equal(Object.isFrozen(after), true);
  assert.equal(Object.isFrozen(after.traps[0]), true);

  runtime.dispose();
  assert.equal(facade.connectorTrackTrapRuntimeDiagnostics.mounted, false);
  assert.equal(facade.connectorTrackTrapRuntimeDiagnostics.disposed, true);
  assert.equal(facade.connectorTrackTrapRuntimeDiagnostics.trapCount, 1);
  assert.equal(facade.connectorTrackTrapRuntimeDiagnostics.game, undefined);
});

test('analytic patrol position, direction, and spin are invariant under frame chunking', () => {
  const coarseGame = createGame();
  const fineGame = createGame();
  const descriptor = createDescriptor({ initialTrackRatio: 0.37 });
  const coarse = new DungeonConnectorTrapRuntime(coarseGame, [descriptor]);
  const fine = new DungeonConnectorTrapRuntime(fineGame, [descriptor]);
  coarse.mount();
  fine.mount();

  coarse.prePlayerUpdate(47.35);
  for (let elapsed = 0; elapsed < 47.35 - 1e-9; elapsed += 0.05) {
    fine.prePlayerUpdate(Math.min(0.05, 47.35 - elapsed));
  }

  const coarseTrap = coarse.getDiagnostics().traps[0];
  const fineTrap = fine.getDiagnostics().traps[0];
  assert.ok(Math.abs(coarseTrap.currentTrackDistance - fineTrap.currentTrackDistance) < 1e-8);
  assert.equal(coarseTrap.currentDirection, fineTrap.currentDirection);
  assert.ok(Math.abs(coarseTrap.spinRadians - fineTrap.spinRadians) < 1e-8);
  assert.ok(Math.abs(coarseTrap.distanceTravelledMeters - fineTrap.distanceTravelledMeters) < 1e-8);
});

test('swept player capsule contact cannot tunnel and emits the authored damage contract', () => {
  assert.equal(sweptTrapIntersectsPlayer({
    sweepStart: { x: -5, y: 2.15, z: 0 },
    sweepEnd: { x: 5, y: 2.15, z: 0 },
    playerRoot: { x: 0, y: 0, z: 0 },
  }), true);

  const game = createGame({ position: { x: 0, y: 0, z: 0 } });
  const runtime = new DungeonConnectorTrapRuntime(game, [createDescriptor({
    patrolSpeedMetersPerSecond: 10,
    alertSpeedMetersPerSecond: 10,
  })]);
  runtime.mount();
  runtime.prePlayerUpdate(1);

  assert.equal(game.incomingHits.length, 1);
  const hit = game.incomingHits[0];
  assert.equal(hit.amount, 12);
  assert.equal(hit.guardable, false);
  assert.equal(hit.unblockable, true);
  assert.equal(hit.reactionTier, 2);
  assert.equal(hit.knockbackStrength, 0.72);
  assert.equal(hit.attackKind, 'rotatingCeilingTrackTrap');
  assert.deepEqual(hit.hazardTags, ['mechanical', 'rotating-track-trap']);
  assert.deepEqual(hit.direction, { x: 1, y: 0, z: 0 });
  assert.equal(runtime.getDiagnostics().traps[0].cooldownRemaining, 0.8);

  runtime.prePlayerUpdate(0.1);
  assert.equal(game.incomingHits.length, 1, 'a trap cannot hit again during its rearm cooldown');
  runtime.prePlayerUpdate(0.7);
  assert.equal(game.incomingHits.length, 2, 'contact can resolve again once the cooldown expires');
});

test('dodge invulnerability remains authoritative while contact still rearms the trap', () => {
  const game = createGame({
    position: { x: 0, y: 0, z: 0 },
    hitResult: { contacted: true, dodged: true, immune: false, healthDamage: 0 },
  });
  const runtime = new DungeonConnectorTrapRuntime(game, [createDescriptor({
    patrolSpeedMetersPerSecond: 10,
    alertSpeedMetersPerSecond: 10,
  })]);
  runtime.mount();
  runtime.prePlayerUpdate(1);
  const diagnostics = runtime.getDiagnostics();
  assert.equal(game.incomingHits.length, 1);
  assert.equal(diagnostics.totalDodges, 1);
  assert.equal(diagnostics.totalResolvedHits, 0);
  assert.equal(diagnostics.traps[0].cooldownRemaining, 0.8);
});

test('late visual attachment is rejected after disposal', async () => {
  let resolveVisual;
  const released = [];
  const visualFactory = {
    createInstance: () => new Promise((resolve) => { resolveVisual = resolve; }),
    releaseInstance: (visual) => released.push(visual),
  };
  const root = {
    add(visual) {
      visual.parent = this;
    },
    remove(visual) {
      visual.parent = null;
    },
  };
  const visual = {
    position: { set() {} },
    rotation: { y: 0 },
    userData: {},
    updateMatrixWorld() {},
    parent: null,
  };
  const runtime = new DungeonConnectorTrapRuntime(null, [createDescriptor()], {
    visualFactory,
    visualRoot: root,
  });
  runtime.mount();
  runtime.dispose();
  resolveVisual(visual);
  await runtime.whenVisualsReady();

  assert.equal(visual.parent, null);
  assert.deepEqual(released, [visual]);
  assert.equal(runtime.getDiagnostics().disposed, true);
});

test('visual asset failure fails acceptance and cannot leave an invisible damaging trap', async () => {
  const game = createGame({ position: { x: 0, y: 0, z: 0 } });
  const visualFactory = {
    createInstance: async () => {
      throw new Error('supplied-rotor-asset-missing');
    },
    releaseInstance() {},
  };
  const runtime = new DungeonConnectorTrapRuntime(game, [createDescriptor({
    patrolSpeedMetersPerSecond: 10,
    alertSpeedMetersPerSecond: 10,
  })], { visualFactory });
  runtime.mount();

  await assert.rejects(
    runtime.whenVisualsReady(),
    /connector-track-trap-visual-acceptance-failed:gallery-track-trap-1:supplied-rotor-asset-missing/,
  );
  runtime.prePlayerUpdate(1);

  const diagnostics = runtime.getDiagnostics();
  assert.equal(diagnostics.visualAcceptanceRequired, true);
  assert.equal(diagnostics.visualAcceptancePassed, false);
  assert.deepEqual(diagnostics.visualAcceptanceErrors, [{
    id: 'gallery-track-trap-1',
    reason: 'supplied-rotor-asset-missing',
  }]);
  assert.ok(diagnostics.traps[0].distanceTravelledMeters > 0,
    'analytic patrol diagnostics remain active after a visual failure');
  assert.equal(diagnostics.traps[0].damageEnabled, false);
  assert.equal(game.incomingHits.length, 0,
    'a failed OBJ/PNG load may not create an invisible damaging hazard');
});

test('a visual detached from the active dungeon root immediately disables trap damage', async () => {
  const game = createGame({ position: { x: 0, y: 0, z: 0 } });
  const root = {
    add(visual) { visual.parent = this; },
    remove(visual) { if (visual.parent === this) visual.parent = null; },
  };
  const visual = {
    parent: null,
    position: { set() {} },
    rotation: { y: 0 },
    userData: {},
    updateMatrixWorld() {},
  };
  const runtime = new DungeonConnectorTrapRuntime(game, [createDescriptor({
    patrolSpeedMetersPerSecond: 10,
    alertSpeedMetersPerSecond: 10,
  })], {
    visualRoot: root,
    visualFactory: {
      async createInstance() { return visual; },
      releaseInstance(instance) { instance.parent = null; },
    },
  });
  runtime.mount();
  await runtime.whenVisualsReady();
  assert.equal(runtime.getDiagnostics().traps[0].damageEnabled, true);

  root.remove(visual);
  runtime.prePlayerUpdate(1);
  const diagnostics = runtime.getDiagnostics().traps[0];
  assert.equal(diagnostics.visualAttached, false);
  assert.equal(diagnostics.damageEnabled, false);
  assert.equal(game.incomingHits.length, 0);
});

test('malformed descriptors are excluded with stable diagnostics', () => {
  const runtime = new DungeonConnectorTrapRuntime(null, [
    { id: 'missing-end' },
    { id: 'zero-track', trackStart: { x: 1, y: 2, z: 3 }, trackEnd: { x: 1, y: 2, z: 3 } },
  ]);
  const diagnostics = runtime.getDiagnostics();
  assert.equal(diagnostics.trapCount, 0);
  assert.equal(diagnostics.invalidDescriptorCount, 2);
  assert.deepEqual(diagnostics.invalidDescriptors.map((entry) => entry.reason), [
    'missing-track-endpoints',
    'zero-length-track',
  ]);
});
