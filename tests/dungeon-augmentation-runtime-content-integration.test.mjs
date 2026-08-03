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
import {
  createIndustrialSupplementRewardTiles,
} from '../src/dungeon-augmentation/IndustrialOverlayMaterializer.js';

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

test('V4 encounters reject missing accepted role placements instead of using legacy room spawns', () => {
  const recipe = resolveIndustrialSupplementEncounterRecipe(
    'supplement-route-network-defense',
    {
      grammarId: 'supplement-hall-cluster-encounter-v1',
      moduleKind: 'room',
      contentRole: 'challenge',
      topology: 'parallel-gallery-loop',
      difficulty: 2,
    },
  );
  const room = {
    ...authoredEncounterRoom(recipe),
    isDungeonSupplement: true,
    augmentationAnchorPlacements: [],
  };
  const generator = new DungeonGenerator({
    difficulty: 2,
    tileSize: TILE_SIZE,
    random: () => 0.5,
  });
  const floors = [{
    x: 0,
    z: 0,
    elevation: 0,
    roomId: room.id,
    augmentationFloorCellId: `${room.id}:floor:tempting-fallback`,
    walkabilityIntent: 'required-clear',
  }];

  assert.throws(
    () => generator._createDungeonSupplementEncounterDefinitions([room], floors, []),
    (error) => error?.compatibility?.code
      === 'DUNGEON_AUGMENTATION_ENCOUNTER_PLACEMENT_MISSING',
  );
});

test('V4 encounters consume only their accepted unique support-floor identities', () => {
  const recipe = resolveIndustrialSupplementEncounterRecipe(
    'supplement-route-network-defense',
    {
      grammarId: 'supplement-hall-cluster-encounter-v1',
      moduleKind: 'room',
      contentRole: 'challenge',
      topology: 'parallel-gallery-loop',
      difficulty: 2,
    },
  );
  const room = authoredEncounterRoom(recipe);
  const spatialAnchors = room.augmentationAnchors.filter(({ kind }) => kind === 'spatial-role');
  const floors = spatialAnchors.map((anchor, index) => {
    const supportFloorCellId = `${room.id}:floor:spawn:${index}`;
    anchor.authoritativePlacement = {
      id: `${anchor.id}:placement`,
      supportFloorCellId,
    };
    return {
      x: index * 2,
      z: 0,
      elevation: 0,
      roomId: room.id,
      augmentationFloorCellId: supportFloorCellId,
      walkabilityIntent: 'required-clear',
      // Transfer and elevated authored surfaces carry this blanket legacy
      // sampler exclusion. Their exact V4 role placement remains authoritative.
      noEnemySpawn: true,
    };
  });
  room.isDungeonSupplement = true;
  room.augmentationAnchorPlacements = spatialAnchors.map((anchor) => ({
    ...anchor.authoritativePlacement,
    anchorId: anchor.id,
  }));
  const generator = new DungeonGenerator({
    difficulty: 2,
    tileSize: TILE_SIZE,
    random: () => 0.5,
  });
  generator._roomSpawnPoints = () => {
    throw new Error('legacy room spawn fallback must not run for V4');
  };
  const encounterAnchor = room.augmentationAnchors.find(({ kind }) => kind === 'encounter');
  encounterAnchor.runtimeConsumerDescriptor = {
    id: `${room.id}:encounter`,
    kind: 'encounter-cleared-runtime',
    runtimeStateIds: [encounterAnchor.runtimeStateId],
  };
  encounterAnchor.liveStateConsumers = [{
    id: 'live-encounter-consumer',
    runtimeStateId: encounterAnchor.runtimeStateId,
  }];

  const [encounter] = generator._createDungeonSupplementEncounterDefinitions(
    [room],
    floors,
    [],
  );
  assert.equal(encounter.spawnPoints.length, recipe.roster.length);
  assert.equal(new Set(encounter.spatialRoles.map(({ supportFloorCellId }) => (
    supportFloorCellId
  ))).size, recipe.roster.length);
  assert.equal(encounter.spatialRoles.every(({ spawnPlacementSource }) => (
    spawnPlacementSource === 'accepted-authoritative-anchor-placement'
  )), true);
  assert.equal(encounter.spatialRoles.every(({ spawnFloorKey }) => Boolean(spawnFloorKey)), true);
  assert.equal(encounter.runtimeConsumerDescriptor.id, `${room.id}:encounter`);
  assert.deepEqual(encounter.liveStateConsumers.map(({ id }) => id), [
    'live-encounter-consumer',
  ]);
});

test('discovery rewards become concrete collectible records with accepted live state', () => {
  const [reward] = createIndustrialSupplementRewardTiles([{
    id: 'discovery-room',
    x: 0,
    z: 0,
    baseElevation: 0,
    augmentationAnchors: [{
      id: 'discovery-room:shift-log',
      kind: 'discovery',
      position: { x: 2.8, y: 0, z: -2.8 },
      runtimeStateId: 'discovery-room:shift-log:state:reward-claimed',
      discoveryRecipe: { id: 'industrial-shift-route-log' },
      stateRecords: [{ id: 'discovery-state-record' }],
      runtimeConsumerDescriptor: {
        id: 'discovery-room:shift-log',
        kind: 'reward-claimed-runtime',
      },
      liveStateConsumers: [{ id: 'discovery-live-consumer' }],
    }],
  }], TILE_SIZE);

  assert.equal(reward.kind, 'discovery');
  assert.equal(reward.id, 'discovery-room:shift-log');
  assert.equal(reward.rewardRecipe.id, 'industrial-shift-route-log');
  assert.deepEqual(reward.stateRecords.map(({ id }) => id), ['discovery-state-record']);
  assert.equal(reward.runtimeConsumerDescriptor.id, 'discovery-room:shift-log');
  assert.deepEqual(reward.liveStateConsumers.map(({ id }) => id), [
    'discovery-live-consumer',
  ]);
});

test('final collision parity rejects a late relocation of an accepted V4 anchor', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const roomId = 'final-collision-room';
  const floors = ['a', 'b'].map((suffix, index) => ({
    x: index,
    z: 0,
    elevation: 0,
    roomId,
    augmentationFloorCellId: `${roomId}:floor:${suffix}`,
    augmentationFloorTierId: 'base',
    augmentationFloorTierRuntimeId: `${roomId}:tier:base`,
    walkabilityIntent: 'required-clear',
  }));
  const request = {
    id: `${roomId}:reward:placement-request`,
    requestId: `${roomId}:reward:placement-request`,
    anchorId: `${roomId}:reward`,
    ownerKind: 'supplemental-anchor',
    ownerId: `${roomId}:reward`,
    roomId,
    placementKind: 'reward',
    requestedPosition: { x: 0, y: 0, z: 0 },
    exactSupportCellId: `${roomId}:floor:a`,
    allowedSupportCellIds: [`${roomId}:floor:a`, `${roomId}:floor:b`],
    allowedZoneIds: [],
    requiredTierId: 'base',
    requiredTierRuntimeId: `${roomId}:tier:base`,
    requiredElevation: 0,
    elevationToleranceMeters: 0.08,
    forbiddenFootprints: [],
    reservationRadiusMeters: 0,
    reselectWithinDeclaredZoneAndTier: true,
  };
  const contract = {
    active: true,
    accepted: true,
    requests: [request],
    placements: [{
      id: `${request.id}:placement`,
      requestId: request.id,
      anchorId: request.anchorId,
      supportFloorCellId: `${roomId}:floor:a`,
    }],
  };
  const rooms = [{ id: roomId, isDungeonSupplement: true, augmentationZones: [] }];

  const unchanged = generator
    ._validateDungeonSupplementAnchorPlacementsAgainstFinalCollision({
      contract,
      floorTiles: floors,
      solidZones: [],
      rooms,
    });
  assert.equal(unchanged.accepted, true);

  const relocated = generator
    ._validateDungeonSupplementAnchorPlacementsAgainstFinalCollision({
      contract,
      floorTiles: floors,
      solidZones: [{
        id: 'late-solid',
        position: new THREE.Vector3(0, 0, 0),
        halfWidth: 0.6,
        halfDepth: 0.6,
        verticalHalfHeight: 1,
        blocking: true,
      }],
      rooms,
    });
  assert.equal(relocated.accepted, false);
  assert.equal(relocated.errors.some(({ code }) => (
    code === 'v4-anchor-placement-final-collision-parity-mismatch'
  )), true);
});

test('runtime factories must carry every accepted live owner and consumer exactly once', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const owner = {
    schema: 'ruindivex-industrial-supplement-live-state-participant/v1',
    id: 'live-owner-record',
    runtimeStateId: 'live-runtime-state',
    stateKind: 'reward-claimed',
    participantRole: 'owner',
    participantKind: 'supplemental-anchor',
    participantId: 'reward-anchor',
    authoritative: true,
    rendererFree: true,
  };
  const consumer = {
    schema: 'ruindivex-industrial-supplement-live-state-participant/v1',
    id: 'live-consumer-record',
    runtimeStateId: 'live-runtime-state',
    stateKind: 'reward-claimed',
    participantRole: 'consumer',
    participantKind: 'reward-claimed-runtime',
    participantId: 'reward-anchor',
    authoritative: true,
    rendererFree: true,
  };
  const contract = {
    active: true,
    liveOwners: [owner],
    liveConsumers: [consumer],
  };
  const common = {
    contract,
    rooms: [{
      augmentationAnchors: [{ liveStateOwners: [{ ...owner }] }],
    }],
    connectionPlans: [{ liveStateConsumers: [{ ...consumer }] }],
  };

  const accepted = generator._validateDungeonSupplementRuntimeFactoryStateBindings(common);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.ownerCount, 1);
  assert.equal(accepted.consumerCount, 1);

  const duplicated = generator._validateDungeonSupplementRuntimeFactoryStateBindings({
    ...common,
    encounters: [{ liveStateConsumers: [{ ...consumer }] }],
  });
  assert.equal(duplicated.accepted, false);
  assert.equal(duplicated.errors.some(({ participantRole, actualCount }) => (
    participantRole === 'consumer' && actualCount === 2
  )), true);

  const missing = generator._validateDungeonSupplementRuntimeFactoryStateBindings({
    ...common,
    connectionPlans: [],
  });
  assert.equal(missing.accepted, false);
  assert.equal(missing.errors.some(({ participantRole, actualCount }) => (
    participantRole === 'consumer' && actualCount === 0
  )), true);

  const identityDrift = structuredClone(common);
  identityDrift.connectionPlans[0].liveStateConsumers[0].runtimeStateId = 'wrong-state';
  assert.equal(generator._validateDungeonSupplementRuntimeFactoryStateBindings(
    identityDrift,
  ).accepted, false);
});

test('blueprint transfer fixtures reject missing accepted live state before rendering', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  assert.throws(
    () => generator._addConnectorTraversalPrefabs(
      new THREE.Group(),
      [{
        id: 'blueprint-transfer-wrapper',
        isDungeonSupplementBlueprintTransferFixture: true,
        ladderContracts: [{
          id: 'blueprint-ladder',
          connectionId: 'blueprint-room',
          authoritativeV4StateContract: true,
          stateBindings: [],
          stateRecords: [],
          liveStateConsumers: [],
        }],
        liftContracts: [],
      }],
      {},
      [],
    ),
    (error) => error?.compatibility?.code
      === 'DUNGEON_AUGMENTATION_TRANSFER_LIVE_STATE_CONTRACT_MISSING',
  );
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

test('industrial presentation assets preserve exact authored transforms and body dimensions', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const materials = industrialTestMaterials();
  const session = generator._createIndustrialDungeonThemeSession(
    materials,
    industrialThemeBinding(),
  );
  const cases = [{
    role: 'gameplayCover',
    meshName: 'industrialAuthoredCoverBody',
    dimensions: [1.37, 0.83, 0.61],
  }, {
    role: 'machineryLandmark',
    meshName: 'industrialAuthoredMachineryBody',
    dimensions: [2.43, 1.71, 1.19],
  }, {
    role: 'storyMarking',
    meshName: 'industrialOptionalStoryMarking',
    dimensions: [0.83, 0.037, 0.29],
  }];

  try {
    for (const [index, entry] of cases.entries()) {
      const [width, height, depth] = entry.dimensions;
      const root = session.assets.create(entry.role, {
        position: { x: 3 + index, y: 4 + index, z: 5 + index },
        rotationY: 0.37 + index * 0.1,
        width,
        height,
        depth,
      });
      const body = root.getObjectByName(entry.meshName);
      assert.ok(body?.isMesh, entry.role);
      body.geometry.computeBoundingBox();
      const size = body.geometry.boundingBox.getSize(new THREE.Vector3());
      assert.deepEqual(
        size.toArray().map((value) => Number(value.toFixed(6))),
        entry.dimensions.map((value) => Number(value.toFixed(6))),
        `${entry.role} body footprint`,
      );
      assert.deepEqual(root.position.toArray(), [3 + index, 4 + index, 5 + index]);
      assert.equal(root.rotation.y, 0.37 + index * 0.1);
    }
    assert.throws(
      () => session.assets.create('gameplayCover', { width: 1, height: 0, depth: 1 }),
      /exact positive authored dimensions/,
    );
  } finally {
    session.resources.disposeOwned();
    for (const material of Object.values(materials)) material.dispose();
  }
});
