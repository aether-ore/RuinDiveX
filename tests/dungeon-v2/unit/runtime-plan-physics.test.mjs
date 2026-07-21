import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.THREE = THREE;

const { DungeonRuntimeV2 } = await import('../../../src/dungeon-v2/DungeonRuntimeV2.js');
const { Game } = await import('../../../src/Game.js');

function emptyResources() {
  return {
    dynamicSurfaces: new Map(),
    dynamicSurfaceByController: new Map(),
    mechanismObjects: new Map(),
    platformSurfaces: new Map(),
    surfaceObjects: new Map(),
    waterObjects: new Map(),
    hazardObjects: new Map(),
  };
}

function baseFacade() {
  return {
    encounters: [],
    rewards: [],
    objectives: [],
    doors: [],
    traps: [],
    group: new THREE.Group(),
    structuralRegistry: {
      getStructuralRaycastVisuals: () => [],
      auditSnapshot: () => ({ registrations: [] }),
    },
  };
}

function surface(id, min, max) {
  return { id, bounds: { min, max }, gameplayPurpose: 'traversal' };
}

test('finite V2 platform slabs do not create invisible collision columns beneath them', () => {
  const game = Object.create(Game.prototype);
  const platform = {
    id: 'surface.unit.upper-catwalk',
    center: new THREE.Vector3(0, 10.15, 0),
    halfWidth: 4,
    halfDepth: 2,
    baseY: 10,
    topY: 10.3,
    blocksBelow: true,
    enabled: true,
  };

  assert.equal(game._isPositionInsidePlatformBlock(platform, { x: 0, y: 4, z: 0 }), false,
    'a lower playable landing must not collide with an unrelated overhead catwalk');
  assert.equal(game._isPositionInsidePlatformBlock(platform, { x: 0, y: 10.1, z: 0 }), true,
    'the authored finite slab remains solid inside its real vertical bounds');

  const legacyPlatform = { ...platform };
  delete legacyPlatform.baseY;
  assert.equal(game._isPositionInsidePlatformBlock(legacyPlatform, { x: 0, y: 4, z: 0 }), true,
    'legacy platforms without a finite base retain their historical blocking behavior');
});

test('real region traversal applies serializable portal effects before a protected pickup', () => {
  const plan = {
    id: 'runtime-region-effect',
    spatialCells: [
      { id: 'cell.server', regionId: 'server', playable: true, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 5, z: 10 } } },
      { id: 'cell.freight', regionId: 'freight', playable: true, bounds: { min: { x: 10, y: 0, z: 0 }, max: { x: 20, y: 5, z: 10 } } },
    ],
    walkableSurfaces: [surface('surface.server', { x: 0, y: -0.2, z: 0 }, { x: 10, y: 0, z: 10 })],
    structuralBoundaries: [],
    safeAnchors: [],
    anchors: [],
    falls: [],
    environmentStates: [],
    mechanisms: [],
    actions: [],
    portals: [{
      id: 'portal.server-freight',
      direction: 'bidirectional',
      from: { regionId: 'server', center: { x: 9.5, y: 0, z: 5 } },
      to: { regionId: 'freight', center: { x: 10.5, y: 0, z: 5 } },
      traversalEffects: [{ op: 'setState', variableId: 'progression.server-route-entered', value: true }],
    }],
    traversalLinks: [],
  };
  const facade = baseFacade();
  const runtime = new DungeonRuntimeV2({ plan, facade, resources: emptyResources() });
  const player = {
    root: { position: new THREE.Vector3(5, 0, 5) },
    setEnvironmentalTraversalProfile() {},
  };
  runtime.mount({ player, registerDynamicPlatformingSurface() {} });
  runtime.update(0.05);
  assert.equal(runtime.variables.get('progression.server-route-entered'), undefined);

  player.root.position.set(15, 0, 5);
  runtime.update(0.05);
  assert.equal(runtime.variables.get('progression.server-route-entered'), true);
  assert.deepEqual([...runtime.traversedPortalIds], ['portal.server-freight']);
  assert.equal(runtime.eventLog.at(-1).type, 'portal-traversed');
});

test('authorized fall resolves only to its authored playable catchment', () => {
  const source = surface(
    'surface.crumble-source',
    { x: 2, y: 3.8, z: 2 },
    { x: 5, y: 4, z: 5 },
  );
  const catchment = surface(
    'surface.catchment',
    { x: 2, y: -6.2, z: 2 },
    { x: 5, y: -6, z: 5 },
  );
  const returnLanding = surface(
    'surface.return-landing',
    { x: 5, y: 3.8, z: 2 },
    { x: 8, y: 4, z: 5 },
  );
  const plan = {
    id: 'runtime-authored-fall',
    spatialCells: [],
    walkableSurfaces: [source, catchment, returnLanding],
    structuralBoundaries: [],
    safeAnchors: [],
    anchors: [],
    environmentStates: [],
    mechanisms: [],
    actions: [],
    portals: [{
      id: 'portal.drop',
      direction: 'forward-only',
      from: { regionId: 'upper', center: { x: 3.5, y: 4, z: 3.5 } },
      to: { regionId: 'lower', center: { x: 3.5, y: -6, z: 3.5 } },
      physicalRoute: {
        endpointSurfaceIds: { from: source.id, to: catchment.id },
      },
    }],
    traversalLinks: [{
      id: 'traversal.catchment-return',
      regionId: 'lower',
      fromSurfaceId: catchment.id,
      toSurfaceId: returnLanding.id,
      mode: 'walkable-stairs',
      bidirectional: true,
      damageFree: true,
      waypoints: [
        { x: 3.5, y: -6, z: 3.5 },
        { x: 6.5, y: 4, z: 3.5 },
      ],
    }],
    falls: [{
      id: 'fall.crumble',
      sourcePortalId: 'portal.drop',
      catchmentSurfaceId: catchment.id,
      trajectoryBounds: { min: { x: 2, y: -6.2, z: 2 }, max: { x: 5, y: 4, z: 5 } },
      damageFree: true,
      playableDestination: true,
    }],
  };
  const runtime = new DungeonRuntimeV2({ plan, facade: baseFacade(), resources: emptyResources() });
  assert.equal(runtime.isAuthorizedFallTrajectory(new THREE.Vector3(3, 1, 3)), true);
  assert.equal(runtime.getAuthorizedFallGroundY(new THREE.Vector3(3, 1, 3)), -6);
  assert.equal(runtime.getAuthorizedFallGroundY(new THREE.Vector3(8, 1, 8)), null);
});

test('diagnostics profiles keep movement polling small without exposing mutable runtime state', () => {
  const plan = {
    id: 'runtime-diagnostics-profiles',
    fixtureId: 'unit-diagnostics',
    spatialCells: [{
      id: 'cell.entry', regionId: 'entry', playable: true,
      bounds: { min: { x: -5, y: -1, z: -5 }, max: { x: 5, y: 5, z: 5 } },
    }],
    walkableSurfaces: [surface('surface.entry', { x: -5, y: -0.2, z: -5 }, { x: 5, y: 0, z: 5 })],
    structuralBoundaries: [],
    safeAnchors: [],
    anchors: [],
    falls: [],
    environmentStates: [],
    mechanisms: [],
    actions: [],
    portals: [{
      id: 'portal.unit-diagnostics',
      from: {
        regionId: 'entry',
        center: { x: 0, y: 2, z: 5 },
        dimensions: { width: 4.8, height: 4.2, depth: 1.2 },
      },
      to: {
        regionId: 'entry',
        center: { x: 0, y: 2, z: -5 },
        dimensions: { width: 4.8, height: 4.2, depth: 1.2 },
      },
      physicalRoute: {
        endpointSurfaceIds: { from: 'surface.entry', to: 'surface.entry' },
        routePoints: [],
      },
    }],
    traversalLinks: [],
  };
  const facade = baseFacade();
  const runtime = new DungeonRuntimeV2({ plan, facade, resources: emptyResources() });
  const player = {
    root: new THREE.Object3D(),
    health: 10,
    activeArmIndex: 0,
    armHotbar: [{ fixedArmId: 'megaBuster', weaponKind: 'projectile' }],
    armLoadout: {
      snapshot: () => ({
        ownedArmIds: ['laserBeamBlade', 'liftArm'],
        slots: {
          megaBuster: { kind: 'megaBuster' },
          special1: { kind: 'fixedArm', armId: 'laserBeamBlade' },
          special2: null,
          utility: { kind: 'fixedArm', armId: 'liftArm' },
        },
      }),
    },
    gearLoadout: {
      snapshot: () => ({
        records: [
          { gearId: 'reinforcedArmorFrame', unlocked: true },
          { gearId: 'jumpSprings', unlocked: false },
        ],
        unlockedSlots: ['armor', 'mobility'],
        slots: { armor: 'reinforcedArmorFrame', mobility: null },
      }),
    },
    getActiveArmWeapon() { return this.armHotbar[this.activeArmIndex]; },
    jumpState: 'Rising',
    velocity: { y: 4.25 },
    setEnvironmentalTraversalProfile() {},
  };
  runtime.mount({
    player,
    ruinFloor: 1,
    busterSandboxSession: null,
    busterTestRange: null,
    enemies: [{
      id: 'enemy.unit-diagnostics',
      encounterId: 'encounter.unit-diagnostics',
      root: new THREE.Object3D(),
      health: 5,
      dead: false,
    }],
    combat: { getMovementLockTarget: () => ({ id: 'target.unit-lock' }) },
    registerDynamicPlatformingSurface() {},
    dungeonController: { getNearestInteractable: () => null },
  });
  runtime.update(0.05);

  const movement = runtime.getDiagnostics('movement');
  assert.equal(movement.currentRegionId, 'entry');
  assert.deepEqual(movement.playerPosition, { x: 0, y: 0, z: 0 });
  assert.equal(movement.jumpState, 'Rising');
  assert.equal(movement.verticalVelocity, 4.25);
  assert.equal('navigation' in movement, false);
  assert.equal('structuralRegistry' in movement, false);
  assert.equal('eventLog' in movement, false);

  const navigation = runtime.getDiagnostics({ profile: 'navigation' });
  assert.ok(navigation.navigation);
  assert.deepEqual(navigation.navigation.portals[0].from.dimensions, {
    width: 4.8,
    height: 4.2,
    depth: 1.2,
  });
  assert.equal(navigation.navigation.portals[0].from.surfaceId, 'surface.entry');
  assert.equal(navigation.navigation.portals[0].from.groundY, 0);
  assert.deepEqual(navigation.navigation.portals[0].from.surfaceBounds, {
    min: { x: -5, y: -0.2, z: -5 },
    max: { x: 5, y: 0, z: 5 },
  });
  assert.deepEqual(
    navigation.navigation.portals[0].to.surfaceBounds,
    navigation.navigation.portals[0].from.surfaceBounds,
    'both endpoint diagnostics must expose their declared landing geometry',
  );
  assert.equal('eventLog' in navigation, false);
  assert.equal('structuralRegistry' in navigation, false);

  const runtimeProfile = runtime.getDiagnostics({ profile: 'runtime' });
  assert.equal('navigation' in runtimeProfile, false);
  assert.equal('eventLog' in runtimeProfile, false);
  assert.equal('structuralRegistry' in runtimeProfile, false);
  assert.equal('structuralRayAudits' in runtimeProfile, false);
  assert.equal(runtimeProfile.lockOnTargetId, 'target.unit-lock');
  assert.equal(runtimeProfile.activeEnemies[0].encounterId, 'encounter.unit-diagnostics');
  assert.deepEqual(runtimeProfile.expeditionConfiguration, {
    difficulty: 1,
    sandboxActive: false,
    testRangeActive: false,
    activeArmIndex: 0,
    activeArm: { id: 'megaBuster', kind: 'megaBuster', weaponKind: 'projectile' },
    arms: {
      ownedArmIds: ['laserBeamBlade', 'liftArm'],
      slots: {
        megaBuster: { kind: 'megaBuster' },
        special1: { kind: 'fixedArm', armId: 'laserBeamBlade' },
        special2: null,
        utility: { kind: 'fixedArm', armId: 'liftArm' },
      },
    },
    gear: {
      unlockedGearIds: ['reinforcedArmorFrame'],
      unlockedSlots: ['armor', 'mobility'],
      slots: { armor: 'reinforcedArmorFrame', mobility: null },
    },
  });

  const full = runtime.getDiagnostics('full');
  assert.ok(full.navigation);
  assert.ok(Array.isArray(full.eventLog));
  assert.deepEqual(full.structuralRegistry, { registrations: [] });
  assert.ok(Array.isArray(full.structuralRayAudits));
  movement.errors.push({ code: 'test-only-mutation' });
  runtimeProfile.expeditionConfiguration.arms.slots.megaBuster.kind = 'cheat';
  assert.deepEqual(runtime.errors, [], 'returned diagnostics are detached from runtime state');
  assert.equal(
    runtime.getDiagnostics('runtime').expeditionConfiguration.arms.slots.megaBuster.kind,
    'megaBuster',
    'returned loadout diagnostics are detached from the live loadout snapshot',
  );
  assert.throws(() => runtime.getDiagnostics('unknown'), /Unknown Dungeon V2 diagnostics profile/);
});

test('system objective actions complete from live mechanism state and appear in diagnostics', () => {
  const objective = { id: 'objective.unit-low-gear', complete: false };
  const plan = {
    id: 'runtime-system-objective',
    spatialCells: [],
    walkableSurfaces: [],
    structuralBoundaries: [],
    safeAnchors: [],
    anchors: [],
    falls: [],
    environmentStates: [],
    portals: [],
    traversalLinks: [],
    mechanisms: [{
      id: 'mechanism.unit-gear',
      type: 'corkscrew-gear',
      initialStateId: 'LowLanding',
      states: [
        { id: 'LowLanding', stable: true },
        { id: 'HighLanding', stable: true },
      ],
      transitions: [],
    }],
    actions: [{
      id: 'action.complete.unit-low-gear',
      type: 'objective-complete',
      anchorId: null,
      interaction: { radius: 0, activationSide: 'system' },
      conditions: [{
        op: 'stateEquals',
        variableId: 'mechanism.unit-gear.state',
        value: 'LowLanding',
      }],
      effects: [{ op: 'completeObjective', objectiveId: objective.id }],
      barrierIds: [],
    }],
  };
  const facade = baseFacade();
  facade.objectives.push(objective);
  const runtime = new DungeonRuntimeV2({ plan, facade, resources: emptyResources() });
  runtime.mount({ registerDynamicPlatformingSurface() {} });
  runtime.update(0.05);

  assert.equal(objective.complete, true);
  assert.deepEqual(runtime.getDiagnostics('runtime').completedObjectiveIds, [objective.id]);
  assert.equal(runtime.operatedActionIds.has('action.complete.unit-low-gear'), true);
  assert.equal(runtime.eventLog.some(({ type }) => type === 'system-action-activated'), true);
});

test('automatic transit consumes authored automatic-dwell semantics without a boarding trigger', () => {
  const mechanism = {
    id: 'mechanism.unit-auto-lift',
    type: 'cargo-lift',
    initialStateId: 'LowerLanding',
    automaticTravel: true,
    states: [
      { id: 'LowerLanding', stable: true, surfaceY: 0, position: { x: 0, y: 0, z: 0 } },
      { id: 'UpperLanding', stable: true, surfaceY: 2, position: { x: 0, y: 2, z: 0 } },
    ],
    transitions: [
      { fromStateId: 'LowerLanding', toStateId: 'UpperLanding', automatic: true, trigger: 'automatic-dwell' },
      { fromStateId: 'UpperLanding', toStateId: 'LowerLanding', automatic: true, trigger: 'automatic-dwell' },
    ],
    runtimeProfile: {
      dynamicSurfaceId: 'surface.unit-auto-lift',
      dwellSeconds: 0.2,
      speed: 20,
    },
  };
  assert.equal(mechanism.transitions.every(({ trigger }) => trigger === 'automatic-dwell'), true);
  assert.equal(mechanism.transitions.some(({ trigger }) => trigger === 'player-boarded'), false);

  const dynamicSurface = {
    id: 'surface.unit-auto-lift',
    center: new THREE.Vector3(0, 0.175, 0),
    baseY: 0,
    topY: 0.35,
    height: 0.35,
    halfWidth: 2,
    halfDepth: 2,
    active: true,
    enabled: true,
  };
  const mechanismObject = new THREE.Object3D();
  mechanismObject.position.copy(dynamicSurface.center);
  const resources = emptyResources();
  resources.dynamicSurfaces.set(dynamicSurface.id, dynamicSurface);
  resources.dynamicSurfaceByController.set(mechanism.id, dynamicSurface);
  resources.mechanismObjects.set(mechanism.id, mechanismObject);
  const plan = {
    id: 'runtime-automatic-dwell',
    spatialCells: [],
    structuralBoundaries: [],
    walkableSurfaces: [surface('surface.floor', { x: -4, y: -0.2, z: -4 }, { x: 4, y: 0, z: 4 })],
    safeAnchors: [],
    anchors: [],
    falls: [],
    environmentStates: [],
    actions: [],
    portals: [],
    traversalLinks: [],
    mechanisms: [mechanism],
  };
  const runtime = new DungeonRuntimeV2({ plan, facade: baseFacade(), resources });
  const player = {
    root: new THREE.Object3D(),
    setEnvironmentalTraversalProfile() {},
  };
  player.root.position.set(30, 0, 30);
  runtime.mount({
    player,
    enemies: [],
    registerDynamicPlatformingSurface() {},
    unregisterDynamicPlatformingSurface() {},
  });
  try {
    runtime.update(0.19);
    assert.equal(runtime.eventLog.some(({ type }) => type === 'mechanism-transit-started'), false);
    runtime.update(0.02);
    const started = runtime.eventLog.find(({ type }) => type === 'mechanism-transit-started');
    assert.deepEqual({
      actionId: started?.actionId,
      fromStateId: started?.fromStateId,
      toStateId: started?.toStateId,
    }, {
      actionId: 'automatic-dwell',
      fromStateId: 'LowerLanding',
      toStateId: 'UpperLanding',
    });
    runtime.update(0.2);
    assert.equal(runtime.controllerById.get(mechanism.id).stateId, 'UpperLanding');
    assert.equal(runtime.eventLog.some(({ type, toStateId }) => (
      type === 'mechanism-transit-arrived' && toStateId === 'UpperLanding'
    )), true);
  } finally {
    runtime.dispose();
  }
});
