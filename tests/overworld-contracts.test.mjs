import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  OVERWORLD_APRON_CELLS,
  OVERWORLD_CELL_SIZE,
  OVERWORLD_CORE_CELLS,
  OVERWORLD_LEVEL_HEIGHT,
  OVERWORLD_TRAIL_CORRIDOR_WIDTH,
  OVERWORLD_VISUAL_CELLS,
  computeOverworldPlanHash,
  createAuthoredOverworldPlan,
  getTerrainCell,
  validateOverworldPlan,
} from '../src/overworld/OverworldPlan.js';
import {
  VOXEL_FACE_FAMILY_IDS,
  createVoxelFaceTextureManifest,
  toSixFaceTexturePaths,
  validateVoxelFaceTextureManifest,
} from '../src/overworld/VoxelFaceTextureManifest.js';
import {
  OverworldController,
  SpatialBlockerHash,
  isInteractionActivationSideSatisfied,
} from '../src/overworld/OverworldController.js';
import {
  BusterLabStorage,
} from '../src/buster/BusterLabStorage.js';
import { MemoryLockManager } from '../src/buster/BusterLabPersistence.js';
import {
  REAVERBOT_BOSS_PROFILE_IDS,
  createBossExpeditionSpec,
  generateReaverbotBossGenome,
  resolveBossRewardMaterial,
} from '../src/reaverbots/ReaverbotBossCatalog.js';
import {
  BUNDLE_LOCAL_STATE_OWNERSHIP,
  MOUNTED_RUNTIME_LOCAL_STATE_OWNERSHIP,
  PERSISTENT_HOST_STATE_OWNERSHIP,
  WORLD_LIFECYCLE_TRANSITIONS,
  WORLD_STATE_OWNERSHIP,
  WorldLifecycleTransitionError,
  createLoadedWorldBundle,
  createWorldLifecycleState,
  getWorldStateOwner,
  validateLoadedWorldBundle,
  validateMountedRuntimeStateHost,
  validateWorldLifecycleTransition,
} from '../src/overworld/WorldLifecycleContracts.js';
import {
  OVERWORLD_BUILDING_GEOMETRY_CONTRACT,
  OVERWORLD_HORIZON_CAMERA_RANGE_METRES,
  OVERWORLD_HORIZON_CONTRACT,
  OVERWORLD_HORIZON_EXTENSION_METRES,
  OVERWORLD_HORIZON_MINIMUM_EXTENSION_METRES,
  VOXEL_PROP_UV_CONTRACT,
  assembleOverworld,
  buildTerrainChunkGeometry,
  buildTerrainHorizonGeometry,
  buildTerrainRangeGeometry,
  buildVoxelBoxGeometry,
  createOverworldSharedGeometryLibrary,
  createTerrainHorizonMetadata,
  disposeOverworldFacade,
  projectVoxelPropUv,
} from '../src/overworld/VoxelTerrainAssembler.js';
import {
  LEGACY_CAMP_ASSET_ADAPTER_ID,
  createLegacyCampAssetAdapter,
  validateLegacyCampAssetAdapter,
} from '../src/overworld/LegacyCampAssetAdapter.js';
import { DIRECT_DUNGEON_URL, directDungeonUrl } from './helpers/world-test-urls.js';
import {
  OVERWORLD_BUILD_FINGERPRINT_BASE_INPUTS,
  collectOverworldBuildFingerprintInputs,
  createBuildFingerprint,
} from './helpers/overworld-global-setup.js';

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const distanceToSegment = (point, start, end) => {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const denominator = dx * dx + dz * dz;
  const amount = denominator > 0
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / denominator))
    : 0;
  return Math.hypot(point.x - (start.x + dx * amount), point.z - (start.z + dz * amount));
};

const minimumTrailDistance = (point, trails) => Math.min(...trails.flatMap((trail) => (
  trail.points.slice(0, -1).map((start, index) => (
    distanceToSegment(point, start, trail.points[index + 1])
  ))
)));

const freezeDeep = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeDeep(child, seen);
  return Object.freeze(value);
};

test('legacy component regressions have one explicit direct-dungeon URL convention', () => {
  assert.equal(DIRECT_DUNGEON_URL, '/?startupWorld=dungeon');
  assert.equal(
    directDungeonUrl({
      seed: 'legacy-contract',
      room: 'pyramid',
      bossProfileId: 'pursuitRegent',
      extra: { difficulty: 1, omitted: null },
    }),
    '/?startupWorld=dungeon&dungeonSeed=legacy-contract&roomPreview=pyramid&bossProfile=pursuitRegent&difficulty=1',
  );
});

test('the isolated browser build fingerprint covers runtime code, boss data, CSS, V1, and every voxel asset', async () => {
  const inputs = await collectOverworldBuildFingerprintInputs();
  const requiredCodeInputs = [
    ...OVERWORLD_BUILD_FINGERPRINT_BASE_INPUTS,
    'src/overworld/OverworldPlan.js',
    'src/overworld/VoxelTerrainAssembler.js',
  ];
  for (const relativePath of requiredCodeInputs) {
    assert.equal(inputs.includes(relativePath), true, `${relativePath} must affect the isolated build identity`);
  }

  const manifest = createVoxelFaceTextureManifest();
  const runtimeTexturePaths = [
    ...Object.values(manifest.families).flatMap(({ top, side, bottom }) => [top, side, bottom]),
    ...Object.values(manifest.facades),
    '/assets/textures/overworld/voxel/voxel-face-manifest.json',
    '/assets/textures/overworld/voxel/voxel-texture-validation.json',
  ].map((assetPath) => assetPath.replace(/^\//, ''));
  for (const relativePath of runtimeTexturePaths) {
    assert.equal(inputs.includes(relativePath), true, `${relativePath} must affect the isolated build identity`);
  }

  const build = await createBuildFingerprint();
  assert.match(build.digest, /^[a-f0-9]{64}$/);
  assert.equal(build.inputCount, inputs.length);
  assert.deepEqual(build.inputs, inputs);
});

test('every staged Boss Hunt profile has deterministic generation and its canonical first-clear recovery', async () => {
  const lab = await BusterLabStorage.open({
    storage: new MemoryStorage(),
    lockManager: new MemoryLockManager(),
    saveContextId: 'overworld-boss-contract-coverage',
  });

  for (const [index, profileId] of REAVERBOT_BOSS_PROFILE_IDS.entries()) {
    assert.equal((await lab.selectBossHunt(profileId)).ok, true, `${profileId} must be selectable`);
    const expedition = createBossExpeditionSpec({
      id: `overworld-contract:${profileId}`,
      seed: `overworld-contract:${index}`,
      depth: 1,
      bossProfileId: profileId,
    });
    assert.equal(expedition.bossProfileId, profileId);
    const genome = generateReaverbotBossGenome({
      bossProfileId: expedition.bossProfileId,
      seed: expedition.seed,
      threatTier: 1,
    });
    assert.equal(genome.bossProfileId, profileId, `${profileId} must reach constrained generation`);
    assert.equal((await lab.lockBossHuntForExpedition(expedition)).ok, true);

    if (profileId === 'ascensionEngine') {
      for (const [securedCheckpointIndex, securedCheckpointId, brokenSealIndex] of [
        [1, 'ascensionCheckpoint:compressionFoundry', 0],
        [2, 'ascensionCheckpoint:brokenElevatorSpine', 1],
        [3, 'ascensionCheckpoint:suspendedMachinerySea', 2],
      ]) {
        assert.equal((await lab.recordBossCheckpoint({
          expeditionId: expedition.id,
          bossProfileId: profileId,
          securedCheckpointIndex,
          securedCheckpointId,
          brokenSealIndex,
        })).ok, true);
      }
    }

    const victory = profileId === 'ascensionEngine'
      ? await lab.recordAscensionBossVictory({ expeditionId: expedition.id })
      : await lab.recordBossVictory({
        expeditionId: expedition.id,
        bossProfileId: profileId,
        signaturePartOverloaded: false,
      });
    assert.equal(victory.ok, true, `${profileId} victory must commit`);
    assert.equal(victory.firstClear, true, `${profileId} first clear must retain its guarantee`);
    assert.equal(victory.rewardQueued, true, `${profileId} first clear must queue recovery`);
    const recovery = lab.state.bossHunts.pendingRecoveries.find(
      ({ expeditionId }) => expeditionId === expedition.id,
    );
    assert.equal(recovery?.part?.id, resolveBossRewardMaterial(profileId)?.id, profileId);
    assert.equal(
      (await lab.completeBossExpedition(expedition.id, { outcome: 'extracted' })).ok,
      true,
      `${profileId} extraction must release the durable expedition before selecting another hunt`,
    );
  }
});

test('loaded world bundles expose one validated bundle-local ownership boundary', () => {
  const root = { name: 'testWorldRoot' };
  const lighting = { name: 'testLighting' };
  const controller = { update() {} };
  const npcAnimators = [{ update() {}, dispose() {} }];
  const collisionData = [{ id: 'testCollision' }];
  const cullingData = [{ id: 'testCullGroup' }];
  const disposableResources = [{ dispose() {} }];
  const facade = { npcAnimators, solidZones: collisionData, renderCullGroups: cullingData };
  const bundle = createLoadedWorldBundle({
    worldKind: 'overworld',
    root,
    lighting,
    controller,
    facade,
    npcAnimators,
    collisionData,
    cullingData,
    disposableResources,
    planHash: 'test-plan',
  });

  assert.equal(validateLoadedWorldBundle(bundle, { requireController: true }).accepted, true);
  assert.equal(bundle.kind, 'loadedWorldBundle');
  assert.equal(bundle.root, root);
  assert.equal(bundle.lighting, lighting);
  assert.equal(bundle.controller, controller);
  assert.equal(bundle.facade, facade);
  assert.equal(bundle.npcAnimators, npcAnimators);
  assert.equal(bundle.collisionData, collisionData);
  assert.equal(bundle.cullingData, cullingData);
  assert.equal(bundle.disposableResources, disposableResources);
  assert.equal(bundle.ownership, BUNDLE_LOCAL_STATE_OWNERSHIP);

  const incomplete = { ...bundle };
  delete incomplete.collisionData;
  const invalid = validateLoadedWorldBundle(incomplete);
  assert.equal(invalid.accepted, false);
  assert.ok(invalid.errors.includes('missing-owned-field:collisionData'));
});

test('world lifecycle guard accepts commits and rollbacks but rejects skipped states', () => {
  const lifecycle = createWorldLifecycleState('overworld');
  assert.deepEqual(lifecycle.legalNextStates, ['enteringDungeon']);
  assert.equal(lifecycle.transitionTo('enteringDungeon'), 'enteringDungeon');
  assert.equal(lifecycle.transitionTo('dungeon'), 'dungeon');
  assert.equal(lifecycle.transitionTo('returningOverworld'), 'returningOverworld');
  assert.equal(lifecycle.transitionTo('overworld'), 'overworld');
  assert.equal(lifecycle.sequence, 4);

  const failedEntry = createWorldLifecycleState('overworld');
  failedEntry.transitionTo('enteringDungeon');
  assert.equal(failedEntry.transitionTo('overworld'), 'overworld');
  const failedReturn = createWorldLifecycleState('dungeon');
  failedReturn.transitionTo('returningOverworld');
  assert.equal(failedReturn.transitionTo('dungeon'), 'dungeon');

  assert.equal(validateWorldLifecycleTransition('overworld', 'dungeon').accepted, false);
  assert.equal(validateWorldLifecycleTransition('dungeon', 'overworld').accepted, false);
  assert.throws(
    () => createWorldLifecycleState('overworld').transitionTo('returningOverworld'),
    WorldLifecycleTransitionError,
  );
  assert.throws(() => createWorldLifecycleState('unknown'), TypeError);
  assert.deepEqual(WORLD_LIFECYCLE_TRANSITIONS.returningOverworld, ['overworld', 'dungeon']);
});

test('persistent host and bundle-local ownership descriptors are explicit and disjoint', () => {
  assert.equal(PERSISTENT_HOST_STATE_OWNERSHIP.scope, 'persistent-host');
  assert.equal(BUNDLE_LOCAL_STATE_OWNERSHIP.scope, 'bundle-local');
  assert.equal(Object.isFrozen(PERSISTENT_HOST_STATE_OWNERSHIP), true);
  assert.equal(Object.isFrozen(BUNDLE_LOCAL_STATE_OWNERSHIP.fields), true);
  assert.equal(getWorldStateOwner('player'), 'persistent-host');
  assert.equal(getWorldStateOwner('inventory'), 'persistent-host');
  assert.equal(getWorldStateOwner('equipment'), 'persistent-host');
  assert.equal(getWorldStateOwner('largeRefractorsSecured'), 'persistent-host');
  assert.equal(getWorldStateOwner('root'), 'bundle-local');
  assert.equal(getWorldStateOwner('disposableResources'), 'bundle-local');
  assert.equal(MOUNTED_RUNTIME_LOCAL_STATE_OWNERSHIP.scope, 'mounted-runtime-local');
  assert.equal(getWorldStateOwner('enemies'), 'mounted-runtime-local');
  assert.equal(getWorldStateOwner('hazards'), 'mounted-runtime-local');
  assert.equal(getWorldStateOwner('projectiles'), 'mounted-runtime-local');
  assert.equal(getWorldStateOwner('lootSystem'), 'mounted-runtime-local');
  assert.equal(getWorldStateOwner('spawner'), 'mounted-runtime-local');
  assert.equal(getWorldStateOwner('mapEvents'), 'mounted-runtime-local');
  assert.equal(getWorldStateOwner('notAWorldField'), null);
  assert.deepEqual(
    WORLD_STATE_OWNERSHIP.persistentHost.filter((field) => (
      WORLD_STATE_OWNERSHIP.bundleLocal.includes(field)
    )),
    [],
  );
  assert.deepEqual(
    WORLD_STATE_OWNERSHIP.persistentHost.filter((field) => (
      WORLD_STATE_OWNERSHIP.mountedRuntimeLocal.includes(field)
    )),
    [],
  );
});

test('mounted V1 compatibility systems have an enforced world-local lifetime contract', () => {
  const host = {
    enemies: [],
    hazards: [],
    projectiles: { clear() {} },
    combat: { activeMines: [] },
    lootSystem: { clear() {} },
    refractors: { clear() {} },
    spawner: { spawnInitialPack() {} },
    mapEvents: { update() {} },
    bossStageRuntime: null,
    cameraOcclusionEntries: [],
    dungeonRenderCullGroups: [],
  };
  assert.equal(validateMountedRuntimeStateHost(host).accepted, true);
  delete host.mapEvents;
  const invalid = validateMountedRuntimeStateHost(host);
  assert.equal(invalid.accepted, false);
  assert.ok(invalid.errors.includes('map-events-required'));
});

test('the authored overworld plan is deterministic, immutable, serializable, and accepted', () => {
  const first = createAuthoredOverworldPlan();
  const second = createAuthoredOverworldPlan();
  const validation = validateOverworldPlan(first);

  assert.equal(validation.accepted, true, validation.errors.join('\n'));
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.terrain.heightLevels), true);
  assert.equal(Object.isFrozen(first.houses[0].extensions), true);
  assert.equal(Object.isFrozen(first.chunkMetadata.coreChunks), true);
  assert.equal(Object.isFrozen(first.chunkMetadata.coreChunks[0].worldBounds), true);
  assert.equal(Object.isFrozen(first.interactions[0]), true);
  assert.equal(Object.isFrozen(first.voxelFaceSets), true);
  assert.equal(Object.isFrozen(first.voxelFaceSets.families.meadow.sixFaces), true);
  assert.equal(Object.isFrozen(first.surfaceMaterials), true);
  assert.equal(Object.isFrozen(first.surfaceMaterials.meadow.fallbackColors), true);
  assert.deepEqual(first, second);
  assert.equal(first.planHash, second.planHash);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.doesNotMatch(JSON.stringify(first), /"(?:isObject3D|isVector3|uuid)"/);
  assert.throws(() => {
    first.houses.push({ id: 'mutation' });
  }, TypeError);

  assert.deepEqual(validation.diagnostics, {
    planHash: first.planHash,
    coreCellCount: OVERWORLD_CORE_CELLS ** 2,
    visualCellCount: OVERWORLD_VISUAL_CELLS ** 2,
    trailCellCount: first.trailCellIndices.length,
    treeCount: 240,
    houseCount: 6,
    coreChunkCount: 36,
    apronChunkCount: 4,
    minimumTrailGeometryClearance: 4.5,
  });
});

test('the plan hash covers every authored contract and ignores only its own output field', () => {
  const plan = createAuthoredOverworldPlan();
  assert.equal(computeOverworldPlanHash(plan), plan.planHash);
  const hashAfter = (mutate) => {
    const candidate = JSON.parse(JSON.stringify(plan));
    mutate(candidate);
    return computeOverworldPlanHash(candidate);
  };
  for (const [label, mutate] of [
    ['dimensions', (candidate) => { candidate.dimensions.coreSize += 1; }],
    ['visual terrain', (candidate) => { candidate.visualTerrain.heightLevels[0] += 1; }],
    ['regions', (candidate) => { candidate.regions[0].label = 'Changed'; }],
    ['landmarks', (candidate) => { candidate.landmarks[0].x += 1; }],
    ['environment', (candidate) => { candidate.environment.fogFar += 1; }],
    ['chunk metadata', (candidate) => { candidate.chunkMetadata.coreChunks[0].cullRadius += 1; }],
    ['voxel face set', (candidate) => { candidate.voxelFaceSets.families.meadow.top = '/changed.png'; }],
    ['surface material binding', (candidate) => { candidate.surfaceMaterials.meadow.voxelFaceSetId = 'trail'; }],
    ['new plan-owned field', (candidate) => { candidate.futureContract = { enabled: true }; }],
  ]) {
    assert.notEqual(hashAfter(mutate), plan.planHash, `${label} must affect the plan hash`);
  }
  assert.equal(hashAfter((candidate) => { candidate.planHash = 'ignored-output'; }), plan.planHash);

  const staleHash = JSON.parse(JSON.stringify(plan));
  staleHash.environment.fogFar += 1;
  freezeDeep(staleHash);
  assert.ok(validateOverworldPlan(staleHash).errors.includes('plan-hash-mismatch'));
});

test('terrain dimensions and world-space sampling preserve the playable core and visual apron', () => {
  const plan = createAuthoredOverworldPlan();
  assert.equal(plan.dimensions.coreCells, 96);
  assert.equal(plan.dimensions.visualCells, 128);
  assert.equal(plan.dimensions.apronCells, 16);
  assert.equal(plan.dimensions.cellSize, 1.5);
  assert.equal(plan.dimensions.levelHeight, 0.5);
  assert.equal(plan.dimensions.groundedStepAllowance, 0.55);
  assert.equal(plan.dimensions.minimumTrailCorridorWidth, 4.5);
  assert.equal(OVERWORLD_APRON_CELLS, 16);
  assert.equal(OVERWORLD_CELL_SIZE, 1.5);
  assert.equal(OVERWORLD_LEVEL_HEIGHT, 0.5);

  const origin = getTerrainCell(plan, 0, 0, { world: true });
  assert.ok(origin);
  assert.equal(origin.surfaceId, 'trail');
  assert.equal(origin.height, 0);
  assert.equal(getTerrainCell(plan, -72.1, 0, { world: true }), null);
  assert.ok(getTerrainCell(plan, -72.1, 0, { world: true, visual: true }));
  assert.equal(getTerrainCell(plan, 96.1, 0, { world: true, visual: true }), null);
});

test('plan-owned core and apron chunk ranges cover the visual grid exactly once', () => {
  const plan = createAuthoredOverworldPlan();
  const metadata = plan.chunkMetadata;
  assert.deepEqual(metadata.coreGrid, {
    columns: 6, rows: 6, chunkCells: 16,
    originCellX: 16, originCellZ: 16, expectedChunkCount: 36,
  });
  assert.equal(metadata.coreChunks.length, 36);
  assert.equal(metadata.apronChunks.length, 4);
  assert.equal(metadata.apron.expectedCoveredCellCount, 7_168);
  assert.equal(metadata.expectedTerrainMeshCount, 41);

  const cells = new Map();
  for (const descriptor of [...metadata.coreChunks, ...metadata.apronChunks]) {
    assert.ok(descriptor.cullRadius > 0);
    assert.ok(Number.isFinite(descriptor.cullCenter.x));
    assert.ok(Number.isFinite(descriptor.cullCenter.z));
    assert.equal(descriptor.sourceCellCount, descriptor.range.width * descriptor.range.depth);
    for (let z = descriptor.range.minZ; z < descriptor.range.minZ + descriptor.range.depth; z += 1) {
      for (let x = descriptor.range.minX; x < descriptor.range.minX + descriptor.range.width; x += 1) {
        const key = `${x},${z}`;
        assert.equal(cells.has(key), false, `chunk overlap at ${key}`);
        cells.set(key, descriptor.id);
      }
    }
  }
  assert.equal(cells.size, OVERWORLD_VISUAL_CELLS ** 2);
});

test('all three trails form one connected walkable network with no half-metre step violation', () => {
  const plan = createAuthoredOverworldPlan();
  const { visualTerrain: terrain } = plan;
  const remaining = new Set(plan.trailCellIndices);
  const frontier = [remaining.values().next().value];
  remaining.delete(frontier[0]);
  let maximumLevelDelta = 0;

  while (frontier.length > 0) {
    const index = frontier.pop();
    const x = index % terrain.width;
    const z = Math.floor(index / terrain.width);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= terrain.width || nz >= terrain.depth) continue;
      const neighbor = nz * terrain.width + nx;
      if (!plan.trailCellIndices.includes(neighbor)) continue;
      maximumLevelDelta = Math.max(
        maximumLevelDelta,
        Math.abs(terrain.heightLevels[index] - terrain.heightLevels[neighbor]),
      );
      if (remaining.delete(neighbor)) frontier.push(neighbor);
    }
  }

  assert.equal(remaining.size, 0, 'Every authored trail cell must connect to the camp network.');
  assert.ok(maximumLevelDelta <= 1, `Trail level delta was ${maximumLevelDelta}`);
  assert.ok(maximumLevelDelta * terrain.levelHeight <= plan.dimensions.groundedStepAllowance);
  assert.equal(plan.trails.length, 3);
  assert.ok(plan.trails.every(({ points }) => points.length >= 6));
  assert.ok(plan.trails.every(({ corridorWidth }) => corridorWidth === OVERWORLD_TRAIL_CORRIDOR_WIDTH));
  assert.ok(validateOverworldPlan(plan).diagnostics.minimumTrailGeometryClearance >= 2.25);
});

test('trail acceptance measures the full 4.5m corridor against blocker geometry', () => {
  const plan = createAuthoredOverworldPlan();
  const obstructed = JSON.parse(JSON.stringify(plan));
  const car = obstructed.blockers.find(({ id }) => id === 'expeditionSupportCarCollision');
  car.x = 7;
  car.z = 1.8;
  obstructed.planHash = computeOverworldPlanHash(obstructed);
  freezeDeep(obstructed);
  const validation = validateOverworldPlan(obstructed);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some((error) => (
    error === 'trail-corridor-overlaps-blocker:village-meadow-loop:expeditionSupportCarCollision'
  )));
});

test('trees respect trail and house clearances while all houses have unique authored topology', () => {
  const plan = createAuthoredOverworldPlan();
  assert.equal(plan.houses.length, 6);
  assert.equal(new Set(plan.houses.map(({ topology }) => topology)).size, 6);
  assert.deepEqual(
    plan.houses.map(({ id }) => id).sort(),
    ['forest-cabin', 'hill-lodge', 'village-house-a', 'village-house-b', 'village-house-c', 'village-house-d'],
  );

  for (const tree of plan.trees) {
    assert.ok(
      minimumTrailDistance(tree, plan.trails) >= 4.5 - 1e-6,
      `${tree.id} overlaps a 4.5m trail clearance`,
    );
    const treeRadius = Math.max(0.38, tree.trunkWidth * 0.7);
    for (const house of plan.houses) {
      const houseBlockers = plan.blockers.filter(({ ownerId, kind }) => (
        ownerId === house.id && kind === 'box'
      ));
      for (const blocker of houseBlockers) {
        const angle = blocker.rotationY ?? 0;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const dx = tree.x - blocker.x;
        const dz = tree.z - blocker.z;
        const localX = dx * cos + dz * sin;
        const localZ = -dx * sin + dz * cos;
        const edgeDistance = Math.hypot(
          Math.max(Math.abs(localX) - blocker.halfWidth, 0),
          Math.max(Math.abs(localZ) - blocker.halfDepth, 0),
        ) - treeRadius;
      assert.ok(
          edgeDistance >= 4.5 - 1e-6,
          `${tree.id} overlaps ${blocker.id}'s clearance`,
      );
      }
    }
  }
});

test('every visible solid landmark owns collision and every trail cell is blocker-free', () => {
  const plan = createAuthoredOverworldPlan();
  const blockerOwners = new Set(plan.blockers.map(({ ownerId }) => ownerId));
  for (const ownerId of [
    ...plan.trees.map(({ id }) => id),
    ...plan.houses.map(({ id }) => id),
    'expeditionSupportCar',
    'rollWorkshopWorkbench',
    'overworldDungeonDoor',
    'overworldRuinMound',
    'overworldMapBoundary',
  ]) {
    assert.equal(blockerOwners.has(ownerId), true, `${ownerId} needs a physical blocker`);
  }

  const controller = new OverworldController({ plan });
  assert.deepEqual(
    controller.queryBlockers({ x: 72, z: 0 }, 0.5)
      .filter(({ ownerId }) => ownerId === 'overworldMapBoundary')
      .map(({ boundarySide }) => boundarySide),
    ['east'],
  );
  for (const index of plan.trailCellIndices) {
    const x = index % plan.visualTerrain.width;
    const z = Math.floor(index / plan.visualTerrain.width);
    const worldX = plan.visualTerrain.originX + (x + 0.5) * plan.visualTerrain.cellSize;
    const worldZ = plan.visualTerrain.originZ + (z + 0.5) * plan.visualTerrain.cellSize;
    assert.equal(
      controller.isPositionBlocked({ x: worldX, y: 0, z: worldZ }),
      false,
      `trail cell ${x},${z} overlaps authored collision`,
    );
  }
  controller.dispose();
});

test('rotated landmark blockers use the same world transform as their rendered owners', () => {
  const plan = createAuthoredOverworldPlan();
  for (const house of plan.houses) {
    const visualYaw = house.yawQuarterTurns * Math.PI * 0.5;
    const collisionYaw = visualYaw === 0 ? 0 : -visualYaw;
    const main = plan.blockers.find(({ id }) => id === `${house.id}-collision`);
    assert.ok(main, `${house.id} is missing its main blocker`);
    assert.equal(main.rotationY, collisionYaw);

    const cos = Math.cos(visualYaw);
    const sin = Math.sin(visualYaw);
    house.extensions.forEach((extension, extensionIndex) => {
      if (['porch', 'overlook', 'dormer'].includes(extension.kind)) return;
      const blocker = plan.blockers.find(({ id }) => (
        id === `${house.id}-extension-${extensionIndex}-collision`
      ));
      assert.ok(blocker, `${house.id}/${extension.kind} is missing collision`);
      assert.ok(Math.abs(blocker.x - (
        house.x + (extension.x ?? 0) * cos + (extension.z ?? 0) * sin
      )) < 1e-9);
      assert.ok(Math.abs(blocker.z - (
        house.z - (extension.x ?? 0) * sin + (extension.z ?? 0) * cos
      )) < 1e-9);
      assert.equal(blocker.rotationY, collisionYaw);
    });
  }

  for (const landmarkId of ['expeditionSupportCar', 'rollWorkshopWorkbench']) {
    const landmark = plan.landmarks.find(({ id }) => id === landmarkId);
    const blocker = plan.blockers.find(({ ownerId }) => ownerId === landmarkId);
    assert.ok(landmark && blocker);
    assert.equal(blocker.rotationY, -landmark.yaw);
  }
  assert.equal(
    plan.blockers.find(({ id }) => id === 'overworldDungeonDoorCollision')?.halfDepth,
    0.35,
  );
});

test('voxel texture families are immutable and cover the Three.js six-face material order', () => {
  const manifest = createVoxelFaceTextureManifest();
  const validation = validateVoxelFaceTextureManifest(manifest);
  assert.equal(validation.accepted, true, validation.errors.join('\n'));
  assert.equal(validation.familyCount, 7);
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.families), true);
  assert.equal(Object.isFrozen(manifest.families.meadow), true);
  assert.equal(Object.isFrozen(manifest.families.meadow.sixFaces), true);
  assert.equal(Object.isFrozen(manifest.boxMaterialOrder), true);
  assert.deepEqual(Object.keys(manifest.families), [...VOXEL_FACE_FAMILY_IDS]);
  assert.deepEqual(toSixFaceTexturePaths(manifest.families.meadow), [
    manifest.families.meadow.side,
    manifest.families.meadow.side,
    manifest.families.meadow.top,
    manifest.families.meadow.bottom,
    manifest.families.meadow.side,
    manifest.families.meadow.side,
  ]);
  assert.equal(manifest.sourceArt.canonicalSourceSize, 1024);
  assert.equal(manifest.sourceArt.rawGeneratorArtifactPolicy, 'untouched-native-output');
  assert.equal(manifest.sourceArt.runtimeDerivedFrom, 'canonical-source-1024');
  assert.equal(manifest.runtimeSize, 256);
  assert.deepEqual(manifest.runtime, {
    colorSpace: 'srgb',
    wrapS: 'repeat',
    wrapT: 'repeat',
    generateMipmaps: true,
    anisotropicFiltering: true,
    repeatWorldMetres: 1.5,
  });

  const invalidSixFace = JSON.parse(JSON.stringify(manifest));
  invalidSixFace.families.meadow.sixFaces.positiveY = invalidSixFace.families.meadow.side;
  assert.ok(
    validateVoxelFaceTextureManifest(invalidSixFace).errors.includes('invalid-six-face-mapping:meadow'),
  );

  const incomplete = JSON.parse(JSON.stringify(manifest));
  delete incomplete.families.roof.side;
  assert.deepEqual(
    validateVoxelFaceTextureManifest(incomplete).errors,
    ['missing-face:roof:side'],
  );
});

test('the plan owns complete surface-material to VoxelFaceSet bindings', () => {
  const plan = createAuthoredOverworldPlan();
  assert.equal(validateVoxelFaceTextureManifest(plan.voxelFaceSets).accepted, true);
  assert.deepEqual(Object.keys(plan.surfaceMaterials), [...VOXEL_FACE_FAMILY_IDS]);
  for (const [materialId, descriptor] of Object.entries(plan.surfaceMaterials)) {
    assert.equal(descriptor.id, materialId);
    assert.ok(plan.voxelFaceSets.families[descriptor.voxelFaceSetId]);
    assert.deepEqual(Object.keys(descriptor.fallbackColors), ['top', 'side', 'bottom']);
  }

  const brokenBinding = JSON.parse(JSON.stringify(plan));
  brokenBinding.surfaceMaterials.meadow.voxelFaceSetId = 'missing-face-set';
  brokenBinding.planHash = computeOverworldPlanHash(brokenBinding);
  freezeDeep(brokenBinding);
  assert.ok(
    validateOverworldPlan(brokenBinding).errors.includes('missing-voxel-face-set-binding:meadow'),
  );
});

test('assembly resolves textures through the plan-owned material mapping', () => {
  const plan = JSON.parse(JSON.stringify(createAuthoredOverworldPlan()));
  plan.surfaceMaterials.meadow.voxelFaceSetId = 'trail';
  plan.planHash = computeOverworldPlanHash(plan);
  freezeDeep(plan);
  const loadedPaths = [];
  const facade = assembleOverworld(plan, {
    textureLoader: {
      load(path) {
        loadedPaths.push(path);
        const texture = new THREE.Texture();
        texture.userData.loadedPath = path;
        return texture;
      },
    },
  });
  const terrainChunk = facade.root.getObjectByName('overworldTerrainChunk-0-0');
  const meadowTop = terrainChunk.material.find(({ name }) => name === 'overworldVoxelMaterial:meadow:top');
  assert.equal(meadowTop.map.userData.loadedPath, plan.voxelFaceSets.families.trail.top);
  assert.equal(loadedPaths.includes(plan.voxelFaceSets.families.meadow.top), false);
  disposeOverworldFacade(facade);
});

test('the spatial blocker hash supports stable insertion, replacement, query, and removal', () => {
  const hash = new SpatialBlockerHash(4);
  const trunk = {
    id: 'trunk', kind: 'cylinder', x: 1, y: 2, z: 1, radius: 0.5, halfHeight: 2,
  };
  const house = {
    id: 'house', kind: 'box', x: 8, y: 2, z: -2,
    halfWidth: 3, halfDepth: 2, halfHeight: 2, rotationY: Math.PI * 0.25,
  };
  hash.insertMany([trunk, house]);
  assert.equal(hash.size, 2);
  assert.equal(hash.has('trunk'), true);
  assert.deepEqual(hash.query({ x: 1, z: 1 }).map(({ id }) => id), ['trunk']);
  assert.ok(hash.query({ x: 5, z: -2 }, 1).some(({ id }) => id === 'house'));

  const movedTrunk = { ...trunk, x: -10, z: -10 };
  hash.insert(movedTrunk);
  assert.equal(hash.size, 2);
  assert.equal(hash.query({ x: 1, z: 1 }).some(({ id }) => id === 'trunk'), false);
  assert.equal(hash.query({ x: -10, z: -10 }).some(({ id }) => id === 'trunk'), true);
  assert.equal(hash.remove('trunk'), true);
  assert.equal(hash.remove('trunk'), false);
  hash.clear();
  assert.equal(hash.size, 0);
});

test('the overworld controller resolves ground, bounds, blocking, and nearest interactions from the plan', () => {
  const plan = createAuthoredOverworldPlan();
  const controller = new OverworldController({ plan });
  assert.equal(controller.getHeightAt(0, 0), 0);
  assert.equal(controller.getSurfaceAt(0, 0), 'trail');
  assert.equal(controller.isWithinPlayableCore({ x: 0, z: 0 }, undefined, 0.42), true);
  assert.equal(controller.isWithinPlayableCore({ x: -72, z: 0 }, undefined, 0.42), false);
  assert.equal(controller.isPositionBlocked({ x: 0, y: 0, z: -8.45 }), true);

  const interaction = controller.getNearestInteractable(plan.anchors.dungeonDoorExterior);
  assert.equal(interaction?.id, 'overworldDungeonDoor');
  assert.equal(interaction?.action, 'openBossHuntSelection');
  assert.deepEqual(interaction?.activationSide, { axis: 'z', sign: 1 });
  assert.equal(isInteractionActivationSideSatisfied(
    interaction,
    { x: interaction.x, y: interaction.y, z: interaction.z + 0.5 },
  ), true);
  assert.equal(isInteractionActivationSideSatisfied(
    interaction,
    { x: interaction.x, y: interaction.y, z: interaction.z - 0.5 },
  ), false);
  assert.equal(controller.getNearestInteractable({
    x: interaction.x,
    y: interaction.y,
    z: interaction.z - 0.5,
  }), null, 'the sealed door cannot activate from its dungeon-facing side');
  assert.equal(isInteractionActivationSideSatisfied(
    { ...interaction, activationSide: { axis: 'invalid', sign: 1 } },
    plan.anchors.dungeonDoorExterior,
  ), false);

  const blocked = controller.resolveMovement(
    { x: 0, y: 0, z: -7 },
    { x: 0, y: 0, z: -8.45 },
    { allowSlide: false },
  );
  assert.equal(blocked.blocked, true);
  assert.deepEqual(blocked.position, { x: 0, y: 0, z: -7 });
  assert.ok(blocked.blockers.some(({ id }) => id === 'overworldDungeonDoorCollision'));

  const walked = controller.resolveMovement(
    { x: 0, y: 0, z: 1 },
    { x: 0.25, y: 0, z: 1.25 },
  );
  assert.equal(walked.blocked, false);
  assert.equal(walked.position.y, controller.getHeightAt(0.25, 1.25));
  controller.dispose();
  assert.equal(controller.blockerHash.size, 0);
});

test('all 36 core chunks are greedy meshes with at most six material draws', () => {
  const plan = createAuthoredOverworldPlan();
  let maximumQuadCount = 0;
  let totalQuadCount = 0;
  for (let chunkZ = 0; chunkZ < 6; chunkZ += 1) {
    for (let chunkX = 0; chunkX < 6; chunkX += 1) {
      const geometry = buildTerrainChunkGeometry(plan, chunkX, chunkZ);
      assert.equal(geometry.userData.greedyMeshed, true);
      assert.equal(geometry.userData.sourceCellCount, 256);
      assert.equal(geometry.userData.uvWorldRepeatMetres, 1.5);
      assert.ok(geometry.groups.length > 0 && geometry.groups.length <= 6);
      assert.equal(geometry.userData.materialKeys.length, geometry.groups.length);
      assert.ok(geometry.userData.greedyQuadCount < 512);
      assert.equal(geometry.attributes.position.count, geometry.userData.greedyQuadCount * 4);
      maximumQuadCount = Math.max(maximumQuadCount, geometry.userData.greedyQuadCount);
      totalQuadCount += geometry.userData.greedyQuadCount;
      geometry.dispose();
    }
  }
  assert.ok(maximumQuadCount < 320);
  assert.ok(totalQuadCount < 3_200, `Greedy terrain emitted ${totalQuadCount} quads.`);
  assert.throws(() => buildTerrainChunkGeometry(plan, 6, 0), RangeError);
});

test('the batched visual horizon derives its profile from the plan and hides every outer edge past camera range', () => {
  const plan = createAuthoredOverworldPlan();
  const metadata = createTerrainHorizonMetadata(plan);
  assert.equal(metadata.id, OVERWORLD_HORIZON_CONTRACT.id);
  assert.equal(metadata.extensionMetres, OVERWORLD_HORIZON_EXTENSION_METRES);
  assert.ok(metadata.extensionMetres >= OVERWORLD_HORIZON_MINIMUM_EXTENSION_METRES);
  assert.equal(metadata.extensionCells, 84);
  assert.deepEqual(metadata.innerBounds, { minX: -96, maxX: 96, minZ: -96, maxZ: 96 });
  assert.deepEqual(metadata.outerBounds, { minX: -222, maxX: 222, minZ: -222, maxZ: 222 });
  assert.equal(metadata.minimumOuterEdgeClearanceFromPlayableCore, 150);
  assert.ok(metadata.minimumOuterEdgeClearanceFromPlayableCore > OVERWORLD_HORIZON_CAMERA_RANGE_METRES);
  assert.equal(metadata.representedCellCount, 71_232);
  assert.equal(Object.isFrozen(metadata), true);
  assert.equal(Object.isFrozen(metadata.edgeRuns), true);

  for (const edge of ['north', 'south', 'west', 'east']) {
    const runs = metadata.edgeRuns[edge];
    assert.equal(Object.isFrozen(runs), true);
    let cursor = 0;
    for (const run of runs) {
      assert.equal(run.startCell, cursor);
      assert.ok(run.cellCount > 0);
      for (let offset = 0; offset < run.cellCount; offset += 1) {
        const coordinate = run.startCell + offset;
        const horizontal = edge === 'north' || edge === 'south';
        const x = horizontal ? coordinate : (edge === 'west' ? 0 : plan.visualTerrain.width - 1);
        const z = horizontal ? (edge === 'north' ? 0 : plan.visualTerrain.depth - 1) : coordinate;
        const index = z * plan.visualTerrain.width + x;
        assert.equal(run.heightLevel, plan.visualTerrain.heightLevels[index]);
        assert.equal(run.surfaceId, plan.visualTerrain.surfaceIds[index]);
      }
      cursor += run.cellCount;
    }
    assert.equal(cursor, 128);
  }

  const geometry = buildTerrainHorizonGeometry(plan);
  assert.equal(geometry.userData.overworldVisualHorizon, true);
  assert.equal(geometry.userData.nonPlayable, true);
  assert.equal(geometry.userData.collidable, false);
  assert.equal(geometry.userData.sourceCellCount, metadata.representedCellCount);
  assert.equal(geometry.userData.uvWorldRepeatMetres, 1.5);
  assert.ok(geometry.groups.length > 0 && geometry.groups.length <= OVERWORLD_HORIZON_CONTRACT.maximumDrawCalls);
  assert.equal(geometry.attributes.position.count, geometry.userData.greedyQuadCount * 4);
  assert.equal(geometry.boundingBox.min.x, metadata.outerBounds.minX);
  assert.equal(geometry.boundingBox.max.x, metadata.outerBounds.maxX);
  assert.equal(geometry.boundingBox.min.z, metadata.outerBounds.minZ);
  assert.equal(geometry.boundingBox.max.z, metadata.outerBounds.maxZ);

  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  for (let offset = 0; offset < positions.count; offset += 4) {
    for (const [start, end] of [[0, 1], [1, 2]]) {
      const a = offset + start;
      const b = offset + end;
      const worldLength = Math.hypot(
        positions.getX(b) - positions.getX(a),
        positions.getY(b) - positions.getY(a),
        positions.getZ(b) - positions.getZ(a),
      );
      const uvLength = Math.hypot(uvs.getX(b) - uvs.getX(a), uvs.getY(b) - uvs.getY(a));
      assert.ok(Math.abs(worldLength / OVERWORLD_CELL_SIZE - uvLength) < 1e-5);
    }
  }
  geometry.dispose();
});

test('merged terrain faces retain one texture repeat per 1.5 world metres', () => {
  const plan = createAuthoredOverworldPlan();
  const geometry = buildTerrainRangeGeometry(plan, {
    minX: 48,
    minZ: 0,
    width: 32,
    depth: 32,
  });
  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  assert.equal(positions.count % 4, 0);

  for (let offset = 0; offset < positions.count; offset += 4) {
    for (const [start, end] of [[0, 1], [1, 2]]) {
      const a = offset + start;
      const b = offset + end;
      const worldLength = Math.hypot(
        positions.getX(b) - positions.getX(a),
        positions.getY(b) - positions.getY(a),
        positions.getZ(b) - positions.getZ(a),
      );
      const uvLength = Math.hypot(
        uvs.getX(b) - uvs.getX(a),
        uvs.getY(b) - uvs.getY(a),
      );
      assert.ok(
        Math.abs(worldLength / 1.5 - uvLength) < 1e-5,
        `Texture stretch detected: ${worldLength}m edge has ${uvLength} repeats`,
      );
    }
  }
  geometry.dispose();
});

test('instanced voxel boxes batch cardinal faces without corrupting normals or UVs', () => {
  const geometry = buildVoxelBoxGeometry();
  assert.equal(geometry.groups.length, 3);
  assert.deepEqual(
    geometry.groups.map(({ start, count, materialIndex }) => ({ start, count, materialIndex })),
    [
      { start: 0, count: 24, materialIndex: 0 },
      { start: 24, count: 6, materialIndex: 1 },
      { start: 30, count: 6, materialIndex: 2 },
    ],
  );
  assert.deepEqual(geometry.userData.voxelFaceGroups, ['side', 'top', 'bottom']);
  assert.equal(geometry.userData.uvDensityMode, 'local-face-axes-scaled-to-world-metres');
  assert.equal(geometry.userData.uvWorldRepeatMetres, 1.5);
  assert.equal(geometry.attributes.position.count, 24);
  assert.equal(geometry.attributes.normal.count, 24);
  assert.equal(geometry.attributes.uv.count, 24);
  for (let index = 0; index < geometry.attributes.position.count; index += 1) {
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const outwardDot = position.getX(index) * normal.getX(index)
      + position.getY(index) * normal.getY(index)
      + position.getZ(index) * normal.getZ(index);
    assert.ok(outwardDot > 0, `Vertex ${index} must face out of the voxel`);
    assert.ok(geometry.attributes.uv.getX(index) >= 0 && geometry.attributes.uv.getX(index) <= 1);
    assert.ok(geometry.attributes.uv.getY(index) >= 0 && geometry.attributes.uv.getY(index) <= 1);
  }
  geometry.dispose();
});

test('all six authored house topologies share one building geometry allocation', () => {
  const plan = createAuthoredOverworldPlan();
  const facade = assembleOverworld(plan, { textureLoader: { load: () => new THREE.Texture() } });
  const houseGeometryReferences = new Set();
  const topologySignatures = new Set();
  for (const house of plan.houses) {
    const owner = facade.root.getObjectByName(house.id);
    assert.ok(owner, `${house.id} must be assembled`);
    assert.equal(owner.userData.houseTopology, house.topology);
    topologySignatures.add(owner.userData.houseTopology);
    owner.traverse((object) => {
      if (object.isMesh || object.isInstancedMesh) {
        assert.equal(
          object.geometry.userData.sharedGeometryContract,
          OVERWORLD_BUILDING_GEOMETRY_CONTRACT,
          `${object.name} must use the shared building primitive`,
        );
        houseGeometryReferences.add(object.geometry);
      }
    });
  }
  assert.equal(topologySignatures.size, 6, 'geometry sharing must not collapse authored topology');
  assert.equal(houseGeometryReferences.size, 1, 'houses must allocate one shared geometry, not one per part');

  const treeGeometryReferences = new Set();
  facade.root.traverse((object) => {
    if (object.isInstancedMesh && object.parent?.userData?.overworldTreeChunk) {
      treeGeometryReferences.add(object.geometry);
    }
  });
  assert.deepEqual(treeGeometryReferences, houseGeometryReferences);
  disposeOverworldFacade(facade);
});

test('shared camp construction uses a validated public V1 compatibility adapter', () => {
  const calls = [];
  const result = { isObject3D: true };
  const adapter = createLegacyCampAssetAdapter({
    legacyGenerator: {
      _createSupportCarFallback() { calls.push('support-fallback'); return result; },
      _createRollWorkshopWorkbench() { calls.push('workbench'); return result; },
      _loadSupportCar(anchor) { calls.push(['support-load', anchor]); },
      _loadRollWorkbenchTextures(workbench) { calls.push(['workbench-textures', workbench]); },
      _loadRollNpc(anchor, mixers, animators) { calls.push(['roll-load', anchor, mixers, animators]); },
    },
  });
  assert.equal(adapter.id, LEGACY_CAMP_ASSET_ADAPTER_ID);
  assert.deepEqual(validateLegacyCampAssetAdapter(adapter), { accepted: true, errors: [] });
  assert.equal(adapter.createSupportCarFallback(), result);
  assert.equal(adapter.createRollWorkshopWorkbench(), result);
  adapter.loadSupportCar('support');
  adapter.loadRollWorkshopTextures('bench');
  adapter.loadRollNpc('roll', 'mixers', 'animators');
  assert.deepEqual(calls, [
    'support-fallback',
    'workbench',
    ['support-load', 'support'],
    ['workbench-textures', 'bench'],
    ['roll-load', 'roll', 'mixers', 'animators'],
  ]);
  assert.equal(validateLegacyCampAssetAdapter({}).accepted, false);
});

test('scaled and instanced voxel props retain one texture repeat per 1.5 world metres', () => {
  assert.equal(Object.isFrozen(VOXEL_PROP_UV_CONTRACT), true);
  assert.deepEqual(VOXEL_PROP_UV_CONTRACT, {
    id: 'overworld-voxel-prop-world-density',
    revision: 1,
    repeatWorldMetres: 1.5,
    projection: 'local-face-axes-scaled-to-world-metres',
    supportsInstancing: true,
    supportsQuarterTurnYaw: true,
    terrainUvPath: 'geometry-authored',
  });

  const repeatDistance = (start, end, normal, axisWorldLengths) => {
    const a = projectVoxelPropUv(start, normal, axisWorldLengths);
    const b = projectVoxelPropUv(end, normal, axisWorldLengths);
    return Math.hypot(b.u - a.u, b.v - a.v);
  };

  // A unit trunk instanced to 7.5m tall must show five vertical repeats.
  assert.equal(
    repeatDistance(
      { x: -0.5, y: -0.5, z: 0.5 },
      { x: -0.5, y: 0.5, z: 0.5 },
      { x: 0, y: 0, z: 1 },
      [0.9, 7.5, 0.9],
    ),
    5,
  );
  // A 4.5m building span uses three repeats on its vertical face.
  assert.equal(
    repeatDistance(
      { x: -0.5, y: 0.5, z: 0.5 },
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: 0, y: 0, z: 1 },
      [4.5, 3, 6],
    ),
    3,
  );
  // Top/bottom projection uses X/Z and is independent of world yaw.
  assert.equal(
    repeatDistance(
      { x: -0.5, y: 0.5, z: -0.5 },
      { x: -0.5, y: 0.5, z: 0.5 },
      { x: 0, y: 1, z: 0 },
      [3, 0.55, 9],
    ),
    6,
  );
  assert.throws(
    () => projectVoxelPropUv({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, [1, -1, 1]),
    TypeError,
  );
});

test('assembly derives the compatibility facade, collisions, and occlusion owners from one plan', () => {
  const plan = createAuthoredOverworldPlan();
  const facade = assembleOverworld(plan, { textureLoader: { load: () => new THREE.Texture() } });
  assert.equal(facade.worldKind, 'overworld');
  assert.equal(facade.isOverworld, true);
  assert.equal(facade.group, facade.root);
  assert.equal(facade.root.name, 'overworldWorldRoot');
  assert.equal(facade.root.userData.overworldPlanHash, plan.planHash);
  assert.equal(facade.plan, plan);
  assert.equal(facade.planHash, plan.planHash);
  assert.equal(facade.terrainChunkCount, 36);
  assert.equal(facade.visualTerrainMeshCount, 41);
  assert.equal(facade.visualHorizon.extensionMetres, 126);
  assert.equal(facade.visualHorizon.minimumOuterEdgeClearanceFromPlayableCore, 150);
  assert.ok(facade.drawCallUpperBound <= 6);
  let horizonCount = 0;
  facade.root.traverse((object) => {
    if (object.userData.overworldVisualHorizon) {
      horizonCount += 1;
      assert.equal(object.userData.nonPlayable, true);
      assert.equal(object.userData.collidable, false);
      assert.ok(object.geometry.groups.length <= 6);
    }
  });
  assert.equal(horizonCount, 1);
  assert.equal(facade.renderCullGroups.some((object) => object.userData.overworldVisualHorizon), false);
  assert.equal(facade.solidZones.some(({ id }) => id.includes('Horizon')), false);
  for (const descriptor of [...plan.chunkMetadata.coreChunks, ...plan.chunkMetadata.apronChunks]) {
    const mesh = facade.root.getObjectByName(descriptor.id);
    assert.ok(mesh, `${descriptor.id} must be assembled from plan metadata`);
    assert.equal(mesh.userData.planChunkId, descriptor.id);
    assert.deepEqual(mesh.userData.cullCenter, descriptor.cullCenter);
    assert.equal(mesh.userData.cullRadius, descriptor.cullRadius);
    assert.deepEqual(mesh.userData.cullBounds, descriptor.worldBounds);
    assert.ok(facade.renderCullGroups.includes(mesh));
  }
  const treeChunks = [];
  facade.root.traverse((object) => {
    if (object.userData.overworldTreeChunk) treeChunks.push(object);
  });
  assert.ok(treeChunks.length > 1);
  assert.equal(
    facade.renderCullGroups.filter((object) => object.userData.overworldTreeChunk).length,
    treeChunks.length,
  );
  const canopyOwners = facade.occlusionOwners.filter((owner) => (
    owner.userData.occlusionPartitionAxis
  ));
  assert.ok(canopyOwners.length > treeChunks.length);
  assert.ok(canopyOwners.length <= treeChunks.length * 2);
  const canopyTreeIds = new Set();
  const canopyOwnerIds = new Set();
  for (const owner of canopyOwners) {
    const bounds = owner.userData.occlusionOwnerBounds;
    assert.ok(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY && bounds.maxZ > bounds.minZ);
    assert.ok(owner.userData.occlusionOwnerShortSpanMetres
      <= plan.chunkMetadata.vegetation.maximumOcclusionOwnerShortSpanMetres);
    assert.equal(canopyOwnerIds.has(owner.userData.occlusionOwnerId), false);
    canopyOwnerIds.add(owner.userData.occlusionOwnerId);
    const localTreeIds = new Set(owner.userData.instanceOwnerIds);
    assert.equal(localTreeIds.size, owner.userData.occlusionTreeCount);
    for (const id of localTreeIds) {
      assert.equal(canopyTreeIds.has(id), false, `${id} belongs to only one local canopy owner`);
      canopyTreeIds.add(id);
    }
  }
  assert.equal(canopyTreeIds.size, plan.trees.length);
  for (const chunk of treeChunks) {
    assert.ok(Number.isFinite(chunk.userData.cullCenter.x));
    assert.ok(Number.isFinite(chunk.userData.cullCenter.z));
    assert.ok(chunk.userData.cullRadius > 0);
    assert.ok(chunk.children.length >= 2 && chunk.children.length <= 3);
    for (const instances of chunk.children) {
      assert.equal(instances.geometry.groups.length, 3);
      assert.equal(instances.material.length, 3);
      for (const material of instances.material) {
        assert.equal(Object.isFrozen(material.userData.voxelPropUvContract), true);
        assert.equal(material.userData.voxelPropUvContract.repeatWorldMetres, 1.5);
        assert.equal(material.userData.voxelPropUvContract.supportsInstancing, true);
      }
    }
    const localOwners = chunk.children.filter(({ userData }) => userData.cameraOcclusionOwner);
    if (localOwners.length > 1) {
      assert.ok(localOwners.every(({ userData }) => userData.occlusionTreeCount < chunk.userData.treeCount));
    }
  }
  const terrainChunk = facade.root.getObjectByName('overworldTerrainChunk-0-0');
  assert.ok(terrainChunk);
  assert.ok(terrainChunk.material.every((material) => !material.userData.voxelPropUvContract));
  const trunkMaterial = treeChunks[0].children[0].material[0];
  const shaderProbe = { vertexShader: '#include <project_vertex>', uniforms: {} };
  trunkMaterial.onBeforeCompile(shaderProbe, null);
  assert.match(shaderProbe.vertexShader, /length\( voxelObjectToWorld\[ 0 \] \)/);
  assert.match(shaderProbe.vertexShader, /voxelMetricUv \/ 1\.50000000/);
  assert.equal(shaderProbe.vertexShader.match(/#include <project_vertex>/g)?.length, 1);
  assert.ok(facade.floorTiles.length > 0);
  assert.ok(facade.occlusionOwners.length >= plan.houses.length);
  assert.ok(facade.solidZones.some(({ id }) => id === 'overworldDungeonDoorCollision'));
  assert.ok(facade.safeInteractables.some(({ id }) => id === 'overworldDungeonDoor'));
  assert.ok(facade.resourceCounts.geometry > 0);
  assert.ok(facade.resourceCounts.material > 0);
  assert.ok(facade.resourceCounts.texture > 0);
  assert.equal(facade.resourceCounts.owner, 1);
  assert.equal(facade.resourceCounts.total, facade.disposableResources.length);
  assert.equal(facade.diagnostics.disposableResourceCount, facade.disposableResources.length);
  assert.equal(
    new Set(facade.disposableResources.map(({ resource }) => resource)).size,
    facade.disposableResources.length,
    'world resource registry must be identity-deduplicated',
  );
  assert.ok(facade.disposableResources.every(({ resource }) => (
    resource?.userData?.persistentHostOwned !== true && resource?.userData?.hostOwnedResource !== true
  )));
  for (const stableId of [
    'overworldDungeonDoor',
    'rollCaskettNpc',
    'expeditionSupportCar',
    'rollWorkshopWorkbench',
    'forest-cabin',
    'hill-lodge',
  ]) {
    let count = 0;
    facade.root.traverse((object) => {
      if (object.name === stableId) count += 1;
    });
    assert.equal(count, 1, `${stableId} must be assembled exactly once`);
  }

  const registeredResources = [...facade.disposableResources];
  const probes = registeredResources.filter(({ kind }) => ['geometry', 'material', 'texture'].includes(kind));
  const disposalEvents = new Map();
  for (const entry of probes.slice(0, 3)) {
    disposalEvents.set(entry.id, 0);
    entry.resource.addEventListener('dispose', () => {
      disposalEvents.set(entry.id, disposalEvents.get(entry.id) + 1);
    });
  }
  // This is the same order used by the host bundle: registry first, then the
  // facade's idempotent traversal catches resources attached asynchronously.
  for (const entry of registeredResources) entry.dispose();
  const disposal = disposeOverworldFacade(facade);
  assert.equal(disposal.disposed, true);
  assert.ok(disposal.geometryCount > 0);
  assert.ok(disposal.materialCount > 0);
  assert.equal(disposal.registeredResourceCount, registeredResources.length);
  assert.ok(registeredResources.every(({ disposed }) => disposed));
  assert.ok([...disposalEvents.values()].every((count) => count === 1));
  assert.equal(facade.disposed, true);
  assert.equal(facade.floorTiles.length, 0);
  assert.deepEqual(disposeOverworldFacade(facade), { disposed: false, reason: 'already-disposed' });
});
