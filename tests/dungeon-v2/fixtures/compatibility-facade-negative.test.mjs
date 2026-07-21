import test from 'node:test';
import {
  createGoldenDungeonPlanV2,
  createTraversalLabPlanV2,
} from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import {
  assertAcceptanceFailure,
  assertCompatibilityFacadeParity,
} from '../helpers/accepted-fixture.mjs';

function accepted(rawPlan) {
  const validation = validateDungeonPlanV2(rawPlan);
  if (!validation.accepted) throw new Error(JSON.stringify(validation.errors, null, 2));
  return validation.plan;
}

function assertMutationRejected(code, facade, plan, mutate) {
  const restore = mutate();
  try {
    assertAcceptanceFailure(code, () => assertCompatibilityFacadeParity(plan, facade));
  } finally {
    restore();
  }
  assertCompatibilityFacadeParity(plan, facade);
}

test('compatibility facade rejects missing room, surface, and collision projections', () => {
  const plan = accepted(createTraversalLabPlanV2({ seed: 'm1-facade-negative-lab' }));
  const facade = assembleDungeonPlanV2(plan);
  try {
    assertCompatibilityFacadeParity(plan, facade);
    for (const [code, collection] of [
      ['facade-room-parity', facade.rooms],
      ['facade-floor-tile-parity', facade.floorTiles],
      ['facade-platform-parity', facade.platforms],
      ['facade-objective-parity', facade.objectives],
      ['facade-minimap-parity', facade.minimap.rooms],
      ['facade-collision-zone-parity', facade.solidZones],
    ]) {
      assertMutationRejected(code, facade, plan, () => {
        const removed = collection.pop();
        return () => collection.push(removed);
      });
    }
    assertMutationRejected('facade-player-start-parity', facade, plan, () => {
      facade.playerStart.x += 1;
      return () => { facade.playerStart.x -= 1; };
    });
  } finally {
    facade.dispose();
  }
});

test('golden facade rejects gate, progression, minimap marker, and extraction drift', () => {
  const plan = accepted(createGoldenDungeonPlanV2({
    seed: 'm1-facade-negative-golden',
    undercroftType: 'magma',
  }));
  const facade = assembleDungeonPlanV2(plan);
  try {
    assertCompatibilityFacadeParity(plan, facade);
    for (const [code, collection] of [
      ['facade-door-parity', facade.doors],
      ['facade-encounter-parity', facade.encounters],
      ['facade-reward-parity', facade.rewards],
    ]) {
      assertMutationRejected(code, facade, plan, () => {
        const removed = collection.pop();
        return () => collection.push(removed);
      });
    }
    assertMutationRejected('facade-progression-parity', facade, plan, () => {
      const original = facade.progression.objectiveIds[0];
      facade.progression.objectiveIds[0] = 'objective.not-in-plan';
      return () => { facade.progression.objectiveIds[0] = original; };
    });
    assertMutationRejected('facade-minimap-parity', facade, plan, () => {
      const removed = facade.minimap.markers.pop();
      return () => facade.minimap.markers.push(removed);
    });
    assertMutationRejected('facade-extraction-parity', facade, plan, () => {
      facade.extractionPosition.z += 2;
      return () => { facade.extractionPosition.z -= 2; };
    });
    const nativeRampSurfaceIds = new Set(plan.walkableSurfaces
      .filter(({ shape }) => shape === 'ramp-tile')
      .map(({ id }) => id));
    const nativeRampTile = facade.floorTiles.find(({ surfaceId }) => nativeRampSurfaceIds.has(surfaceId));
    if (!nativeRampTile) throw new Error('Golden facade must expose a native ramp-tile projection.');
    assertMutationRejected('facade-floor-tile-parity', facade, plan, () => {
      nativeRampTile.elevation += 0.2;
      return () => { nativeRampTile.elevation -= 0.2; };
    });
  } finally {
    facade.dispose();
  }
});
