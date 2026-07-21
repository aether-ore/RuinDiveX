import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.THREE = THREE;

const { DungeonRuntimeV2 } = await import('../../../src/dungeon-v2/DungeonRuntimeV2.js');
const { createGoldenDungeonPlanV2 } = await import('../../../src/dungeon-v2/GoldenDungeonPlansV2.js');

function resources() {
  return {
    dynamicSurfaces: new Map(),
    dynamicSurfaceByController: new Map(),
    mechanismFixtures: new Map(),
    mechanismObjects: new Map(),
    platformSurfaces: new Map(),
    surfaceObjects: new Map(),
    waterObjects: new Map(),
    hazardObjects: new Map(),
  };
}

function makeRuntime(hazard) {
  const surfaceId = `surface.${hazard.id}`;
  const trapId = `trap.${hazard.id}`;
  const hits = [];
  const plan = {
    id: `runtime-${hazard.id}`,
    spatialCells: [{
      id: 'cell.hazard',
      regionId: 'hazard',
      playable: true,
      bounds: { min: { x: -5, y: -1, z: -5 }, max: { x: 5, y: 5, z: 5 } },
    }],
    structuralBoundaries: [],
    walkableSurfaces: [{
      id: surfaceId,
      regionId: 'hazard',
      bounds: { min: { x: -4, y: -0.2, z: -4 }, max: { x: 4, y: 0, z: 4 } },
      gameplayPurpose: 'hazard-traversal',
    }],
    safeAnchors: [],
    anchors: [],
    falls: [],
    actions: [],
    portals: [],
    traversalLinks: [],
    mechanisms: [],
    environmentStates: [{
      ...hazard,
      surfaces: [{ id: trapId, surfaceId, regionId: 'hazard' }],
    }],
  };
  const facade = {
    group: new THREE.Group(),
    encounters: [],
    rewards: [],
    objectives: [],
    doors: [],
    traps: [{
      id: trapId,
      v2HazardId: hazard.id,
      position: new THREE.Vector3(0, 0, 0),
      halfWidth: 4,
      halfDepth: 4,
      verticalHalfHeight: 0.7,
      ambientHazardTags: [...hazard.tags],
      active: true,
    }],
    structuralRegistry: {
      getStructuralRaycastVisuals: () => [],
      auditSnapshot: () => ({ registrations: [] }),
    },
  };
  const player = {
    root: new THREE.Object3D(),
    setEnvironmentalTraversalProfile() {},
    takeIncomingHit(hit) {
      hits.push({
        ...hit,
        source: hit.source?.id ?? null,
        hazardTags: [...(hit.hazardTags ?? [])],
        statusEffects: [...(hit.statusEffects ?? [])],
      });
    },
  };
  const runtime = new DungeonRuntimeV2({ plan, facade, resources: resources() });
  runtime.mount({
    player,
    enemies: [],
    registerDynamicPlatformingSurface() {},
    unregisterDynamicPlatformingSurface() {},
  });
  return { runtime, player, hits };
}

function runChunks(hazard, chunks) {
  const fixture = makeRuntime(hazard);
  try {
    for (const chunk of chunks) fixture.runtime.update(chunk);
    const exposure = fixture.runtime.getDiagnostics('runtime').hazardExposure
      .find(({ actorId }) => actorId === 'player');
    return {
      hits: fixture.hits,
      damage: fixture.hits.reduce((sum, hit) => sum + hit.amount, 0),
      exposure,
      phases: fixture.runtime.getDiagnostics('runtime').hazardPhases,
      events: fixture.runtime.eventLog.filter(({ type }) => type === 'hazard-exposure-pulse'),
    };
  } finally {
    fixture.runtime.dispose();
  }
}

test('mounted magma runtime applies exact entry grace, damage, pulse events, and gear-compatible tags', () => {
  const magma = Object.freeze({
    id: 'environment.unit-magma',
    type: 'magma-floor-v1',
    hazardTag: 'environmental:magma',
    tags: Object.freeze(['environmental:magma', 'environmentalHeat', 'fireFloor']),
    entryGraceSeconds: 0.5,
    pulseSeconds: 0.25,
    damagePerSecond: 12,
  });
  const oneChunk = runChunks(magma, [2]);
  const manyChunks = runChunks(magma, Array.from({ length: 120 }, () => 1 / 60));

  assert.ok(Math.abs(oneChunk.damage - 18) < 1e-8);
  assert.ok(Math.abs(manyChunks.damage - oneChunk.damage) < 1e-8,
    'the production runtime must not change magma damage with browser frame chunking');
  assert.equal(oneChunk.exposure.cumulativePulses, 6);
  assert.equal(manyChunks.exposure.cumulativePulses, 6);
  assert.equal(oneChunk.events.reduce((sum, event) => sum + event.pulses, 0), 6);
  assert.ok(oneChunk.hits.every((hit) => hit.hazardDomain === 'environment'));
  assert.ok(oneChunk.hits.every((hit) => hit.hazardTags.includes('environmentalHeat')),
    'the runtime must forward tags consumed by the current Heat Resist gear hook');
  assert.ok(oneChunk.hits.every((hit) => hit.statusEffects.includes('burn')));
});

test('authored magma fixture forwards current Heat Resist tags through its plan-owned hazard', () => {
  const plan = createGoldenDungeonPlanV2({ undercroftType: 'magma', seed: 'unit-hazard-tags' });
  const magma = plan.environmentStates.find(({ type }) => type === 'magma-floor-v1');
  assert.ok(magma.tags.includes('environmental:magma'));
  assert.ok(magma.tags.includes('environmentalHeat'));
  assert.ok(magma.tags.includes('fireFloor'));
});

test('mounted electrical runtime damages only during energized phases and remains frame-chunk invariant', () => {
  const electrical = Object.freeze({
    id: 'environment.unit-electrical',
    type: 'electric-floor-cycle-v1',
    hazardTag: 'environmental:electrical',
    tags: Object.freeze(['environmental:electrical']),
    phases: Object.freeze([
      Object.freeze({ id: 'safe', durationSeconds: 1.25 }),
      Object.freeze({ id: 'charging', durationSeconds: 0.75 }),
      Object.freeze({ id: 'energized', durationSeconds: 1.5 }),
    ]),
    damagePerSecond: 9,
  });
  const oneChunk = runChunks(electrical, [3.51]);
  const manyChunks = runChunks(electrical, [
    ...Array.from({ length: 210 }, () => 1 / 60),
    0.01,
  ]);

  assert.ok(Math.abs(oneChunk.damage - 13.5) < 1e-8);
  assert.ok(Math.abs(manyChunks.damage - oneChunk.damage) < 1e-8,
    'the production runtime must not change electrical damage with browser frame chunking');
  assert.equal(oneChunk.phases[0].phase, 'safe');
  assert.ok(oneChunk.hits.every((hit) => hit.hazardTags.includes('environmental:electrical')));
  assert.ok(oneChunk.hits.every((hit) => hit.statusEffects.length === 0));
});
