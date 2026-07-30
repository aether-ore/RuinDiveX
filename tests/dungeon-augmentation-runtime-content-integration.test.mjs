import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { EnemySpawner } from '../src/EnemySpawner.js';
import {
  resolveIndustrialSupplementEncounterRecipe,
} from '../src/dungeon-augmentation/IndustrialSupplementContent.js';
import {
  INDUSTRIAL_THEME_MATERIAL_ROLE_MAP,
} from '../src/dungeon-augmentation/ThemeAdapters.js';

const TILE_SIZE = 2.8;

function authoredEncounterRoom(recipe) {
  const spatialAnchorIds = [...new Set(recipe.spatialRoles.flatMap((role) => (
    role.anchorIds ?? []
  )))];
  return {
    id: `runtime-content-room:${recipe.contentRole}`,
    x: 0,
    z: 0,
    width: 7,
    depth: 7,
    baseElevation: 0,
    archetypeId: recipe.grammarId,
    augmentationOperationId: 'runtime-content-operation',
    augmentationContentRole: recipe.contentRole,
    augmentationTopologyTemplateId: recipe.requestedTopologyId,
    augmentationAnchors: [
      {
        id: 'runtime-content-encounter',
        kind: 'encounter',
        position: { x: 0, y: 0, z: 0 },
        runtimeStateId: 'runtime-content-encounter-state',
        encounterProfileId: recipe.encounterProfileId,
        encounterRecipe: recipe,
      },
      ...spatialAnchorIds.map((localAnchorId, index) => ({
        id: `runtime-content-spatial-anchor:${localAnchorId}`,
        localAnchorId,
        kind: 'spatial-role',
        position: {
          x: (index - Math.floor(spatialAnchorIds.length / 2)) * TILE_SIZE,
          y: 0,
          z: TILE_SIZE,
        },
      })),
    ],
  };
}

test('authored encounter recipes preserve fixed rosters and aligned spatial contracts', () => {
  for (const difficulty of [1, 4]) {
    const recipe = resolveIndustrialSupplementEncounterRecipe(
      'supplement-route-network-defense',
      {
        grammarId: 'supplement-hall-cluster-encounter-v1',
        moduleKind: 'room',
        contentRole: 'challenge',
        topology: 'parallel-gallery-loop',
        difficulty,
      },
    );
    assert.ok(recipe);
    assert.equal(recipe.difficultyScaling.rosterPolicy, 'fixed-authored-roster');

    const generator = new DungeonGenerator({
      difficulty,
      tileSize: TILE_SIZE,
      random: () => 0.5,
    });
    const [encounter] = generator._createDungeonSupplementEncounterDefinitions(
      [authoredEncounterRoom(recipe)],
      null,
      [],
    );

    assert.ok(encounter);
    assert.deepEqual(encounter.roster, recipe.roster);
    assert.equal(encounter.roster.length, encounter.spatialRoles.length);
    assert.equal(
      encounter.roster.length,
      encounter.clearState.requiredSpatialRoleIds.length,
    );
    assert.deepEqual(
      encounter.spatialRoles.map(({ id }) => id),
      recipe.spatialRoles.map(({ id }) => id),
    );
    assert.equal(
      encounter.enemyHealthMultiplier,
      recipe.difficultyScaling.healthMultiplier,
    );
    assert.equal(
      encounter.enemyDamageMultiplier,
      recipe.difficultyScaling.damageMultiplier,
    );
  }
});

test('recipe-less legacy supplement encounters retain legacy roster adjustment', () => {
  const legacyRoom = {
    id: 'legacy-runtime-content-room',
    x: 0,
    z: 0,
    width: 7,
    depth: 7,
    baseElevation: 0,
    archetypeId: 'legacy-unknown-grammar',
    augmentationContentRole: 'challenge',
    augmentationAnchors: [{
      id: 'legacy-runtime-content-encounter',
      kind: 'encounter',
      position: { x: 0, y: 0, z: 0 },
      encounterProfileId: 'legacy-unknown-profile',
      roster: ['basic', 'fast', 'ranged'],
    }],
  };

  const easyGenerator = new DungeonGenerator({ difficulty: 1, random: () => 0.5 });
  const hardGenerator = new DungeonGenerator({ difficulty: 4, random: () => 0.5 });
  const [easy] = easyGenerator._createDungeonSupplementEncounterDefinitions(
    [legacyRoom],
    null,
    [],
  );
  const [hard] = hardGenerator._createDungeonSupplementEncounterDefinitions(
    [legacyRoom],
    null,
    [],
  );

  assert.deepEqual(easy.roster, ['basic', 'fast']);
  assert.deepEqual(hard.roster, ['basic', 'fast', 'ranged', 'horokko']);
  assert.equal(easy.enemyHealthMultiplier, 1);
  assert.equal(easy.enemyDamageMultiplier, 1);
});

test('authored encounter damage scaling reaches every spawned Reaverbot slot', () => {
  const spawnOptions = [];
  const spawner = Object.create(EnemySpawner.prototype);
  spawner.runSeed = 12345;
  spawner.game = {
    ruinFloor: 1,
    setBusterCombatDepthLevel() {},
    dungeonController: {
      markEncounterSpawned() {},
    },
  };
  spawner.getDifficulty = () => 1;
  spawner.spawnEnemy = (_typeKey, _forceElite, position, options) => {
    spawnOptions.push(options);
    return {
      root: { position: position.clone() },
      navigationMode: 'ground',
    };
  };

  spawner.spawnEncounter({
    id: 'runtime-content-scaled-encounter',
    roster: ['basic', 'fast'],
    spawnPoints: [new THREE.Vector3(-2, 0, 0), new THREE.Vector3(2, 0, 0)],
    zone: {
      position: new THREE.Vector3(0, 0, 0),
      halfWidth: 6,
      halfDepth: 6,
    },
    enemyHealthMultiplier: 1.24,
    enemyDamageMultiplier: 1.15,
  });

  assert.equal(spawnOptions.length, 2);
  assert.ok(spawnOptions.every(({ healthMultiplier }) => healthMultiplier === 1.24));
  assert.ok(spawnOptions.every(({ damageMultiplier }) => damageMultiplier === 1.15));
});

function industrialThemeBinding() {
  return {
    schema: 'ruindivex-dungeon-region-theme/v1',
    parentMapId: 'runtime-content-map',
    parentMapRevision: '1',
    parentRegionId: 'runtime-content-region',
    themeRef: {
      id: 'runtime-content-theme',
      revision: '1',
      contentHash: 'runtime-content-theme-hash',
    },
    presentationVariantId: 'runtime-content-variant',
    localLightingProfileId: 'runtime-content-lights',
    soundscapeProfileId: 'runtime-content-sound',
  };
}

function industrialTestMaterials() {
  return Object.fromEntries([...new Set(
    Object.values(INDUSTRIAL_THEME_MATERIAL_ROLE_MAP),
  )].map((key) => [key, new THREE.MeshBasicMaterial({ name: key })]));
}

function fixtureLight(root) {
  return root.getObjectByName('industrialSupplementLocalLight');
}

test('industrial supplement light fixtures honor authored photometric specifications', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const materials = industrialTestMaterials();
  const session = generator._createIndustrialDungeonThemeSession(
    materials,
    industrialThemeBinding(),
  );

  try {
    const tiledFixture = session.assets.create('lightFixture', {
      position: { x: 5, y: 6, z: 7 },
      color: '#ff8a3d',
      intensity: 0.9,
      rangeTiles: 3,
      castsShadow: true,
    });
    const tiledLight = fixtureLight(tiledFixture);
    assert.ok(tiledLight?.isPointLight);
    assert.equal(tiledLight.color.getHexString(), 'ff8a3d');
    assert.equal(tiledLight.intensity, 0.9);
    assert.equal(tiledLight.distance, 3 * TILE_SIZE);
    assert.equal(tiledLight.castShadow, true);
    assert.deepEqual(tiledFixture.position.toArray(), [5, 6, 7]);

    const meterFixture = session.assets.create('lightFixture', {
      rangeMeters: 13.5,
      rangeTiles: 99,
      castShadow: true,
    });
    assert.equal(fixtureLight(meterFixture).distance, 13.5);
    assert.equal(fixtureLight(meterFixture).castShadow, true);

    const rangeFixture = session.assets.create('lightFixture', { range: 7.25 });
    assert.equal(fixtureLight(rangeFixture).distance, 7.25);

    const defaultFixture = session.assets.create('lightFixture');
    const defaultLight = fixtureLight(defaultFixture);
    assert.equal(defaultLight.color.getHexString(), '6bdcff');
    assert.equal(defaultLight.intensity, 1.25);
    assert.equal(defaultLight.distance, 10);
    assert.equal(defaultLight.decay, 2);
    assert.equal(defaultLight.castShadow, false);
  } finally {
    session.resources.disposeOwned();
    for (const material of Object.values(materials)) material.dispose();
  }
});
