import assert from 'node:assert/strict';
import test from 'node:test';

import { GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS } from '../src/dungeon-augmentation/catalog.js';
import {
  INDUSTRIAL_SUPPLEMENT_ENCOUNTER_PROFILE_IDS,
  INDUSTRIAL_SUPPLEMENT_ENCOUNTER_RECIPES,
  INDUSTRIAL_SUPPLEMENT_ENEMY_KEYS,
  INDUSTRIAL_SUPPLEMENT_HAZARD_PROFILE_IDS,
  INDUSTRIAL_SUPPLEMENT_MECHANISM_PROFILE_IDS,
  INDUSTRIAL_SUPPLEMENT_MODULE_IDS,
  INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS,
  INDUSTRIAL_SUPPLEMENT_REWARD_PROFILE_IDS,
  resolveIndustrialSupplementEncounterRecipe,
  resolveIndustrialSupplementHazardRecipe,
  resolveIndustrialSupplementMechanismRecipe,
  resolveIndustrialSupplementModuleManifest,
  resolveIndustrialSupplementRewardRecipe,
  resolveIndustrialSupplementTopologyClass,
} from '../src/dungeon-augmentation/IndustrialSupplementContent.js';
import {
  inspectIndustrialSupplementManifestStructuralQuality,
} from '../src/dungeon-augmentation/IndustrialSupplementStructuralQuality.js';
import {
  createDungeonAugmentationCompleteLayoutSignature,
} from '../src/dungeon-augmentation/varietySignature.js';

const EXPECTED_MODULE_IDS = [
  'challenge',
  'hazard-control',
  'vertical-maintenance',
  'reward-vault',
  'calm-discovery',
];

const EXPECTED_ENCOUNTER_PROFILE_IDS = [
  'supplement-route-network-defense',
  'supplement-lateral-defense',
];

const EXPECTED_FOOTPRINTS = {
  challenge: { width: 7, depth: 7 },
  'hazard-control': { width: 9, depth: 9 },
  'vertical-maintenance': { width: 9, depth: 9 },
  'reward-vault': { width: 7, depth: 7 },
  'calm-discovery': { width: 7, depth: 7 },
};

test('Industrial V4 content exposes five renderer-free authored module manifests', () => {
  assert.deepEqual(INDUSTRIAL_SUPPLEMENT_MODULE_IDS, EXPECTED_MODULE_IDS);

  for (const moduleId of INDUSTRIAL_SUPPLEMENT_MODULE_IDS) {
    const manifest = INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS[moduleId];
    assert.equal(manifest.id, moduleId);
    assert.equal(manifest.moduleKind, moduleId);
    assert.equal(manifest.profileId, 'industrial-supplement-preview-v4');
    assert.ok(manifest.purpose.length > 20);
    assert.ok(manifest.story.length > 20);
    assert.ok(manifest.layout.topology);
    const footprint = EXPECTED_FOOTPRINTS[moduleId];
    assert.deepEqual(manifest.layout.dimensionsTiles, footprint);
    assert.equal(manifest.floorMask.length, footprint.depth);
    assert.ok(manifest.floorMask.every((row) => row.length === footprint.width));
    assert.deepEqual(manifest.compatibleModuleKinds, ['room']);
    assert.equal(manifest.compatibleGrammarIds.length, 1);
    assert.ok(manifest.zones.length >= 3);
    assert.ok(manifest.cover.length >= 2);
    assert.ok(manifest.landmarks.length >= 2);
    assert.ok(Array.isArray(manifest.lighting));
    assert.ok(manifest.lighting.length >= 2);
    assert.ok(manifest.anchors.length >= 3);
    assert.ok(manifest.floorTiers.length >= 1);
    assert.ok(manifest.clearRoutes.length >= 2);

    const zoneIds = new Set(manifest.zones.map(({ id }) => id));
    const anchorIds = new Set(manifest.anchors.map(({ id }) => id));
    const floorTierIds = new Set(manifest.floorTiers.map(({ id }) => id));
    const clearRouteIds = new Set(manifest.clearRoutes.map(({ id }) => id));
    const lightingIds = new Set(manifest.lighting.map(({ id }) => id));
    assert.equal(lightingIds.size, manifest.lighting.length);
    const halfWidth = Math.floor(footprint.width / 2);
    const halfDepth = Math.floor(footprint.depth / 2);
    for (const zone of manifest.zones) {
      assert.ok(zone.tileBounds.minX >= -halfWidth);
      assert.ok(zone.tileBounds.maxX <= halfWidth);
      assert.ok(zone.tileBounds.minZ >= -halfDepth);
      assert.ok(zone.tileBounds.maxZ <= halfDepth);
    }
    for (const cover of manifest.cover) {
      for (const zoneId of cover.validFloorZoneIds) assert.ok(zoneIds.has(zoneId));
    }
    for (const positioned of [
      ...manifest.cover,
      ...manifest.landmarks,
      ...manifest.lighting,
      ...manifest.anchors,
    ]) {
      assert.ok(positioned.localTile.x >= -halfWidth && positioned.localTile.x <= halfWidth);
      assert.ok(positioned.localTile.z >= -halfDepth && positioned.localTile.z <= halfDepth);
    }
    for (const light of manifest.lighting) {
      assert.ok(light.id.length > 0);
      assert.ok(light.kind.length > 0);
      assert.ok(light.purpose.length > 20);
      assert.match(light.color, /^#[0-9a-f]{6}$/i);
      assert.ok(Number.isFinite(light.intensity) && light.intensity > 0);
      assert.ok(Number.isFinite(light.rangeTiles) && light.rangeTiles > 0);
      assert.ok(Number.isFinite(light.localTile.elevation));
      assert.equal(typeof light.castsShadow, 'boolean');
      assert.ok(light.floorZoneIds.length > 0);
      for (const zoneId of light.floorZoneIds) assert.ok(zoneIds.has(zoneId));
    }
    for (const anchor of manifest.anchors) {
      if (anchor.floorZoneId) assert.ok(zoneIds.has(anchor.floorZoneId));
    }

    const baseTier = manifest.floorTiers.find(({ elevation }) => elevation === 0);
    assert.ok(baseTier);
    assert.deepEqual(baseTier.floorMask, manifest.floorMask);
    for (const tier of manifest.floorTiers) {
      assert.equal(tier.floorMask.length, footprint.depth);
      assert.ok(tier.floorMask.every((row) => row.length === footprint.width));
      assert.ok(tier.accessRouteIds.length > 0);
      for (const zoneId of tier.zoneIds) assert.ok(zoneIds.has(zoneId));
      for (const routeId of tier.accessRouteIds) assert.ok(clearRouteIds.has(routeId));
    }
    for (const raisedZone of manifest.zones.filter(({ elevation }) => elevation > 0)) {
      assert.ok(manifest.floorTiers.some((tier) => (
        tier.elevation === raisedZone.elevation && tier.zoneIds.includes(raisedZone.id)
      )));
    }
    for (const route of manifest.clearRoutes) {
      assert.ok(route.fromSocketIds?.length || route.fromZoneId);
      if (route.fromZoneId) assert.ok(zoneIds.has(route.fromZoneId));
      if (route.toZoneId) assert.ok(zoneIds.has(route.toZoneId));
      if (route.toAnchorId) assert.ok(anchorIds.has(route.toAnchorId));
      for (const zoneId of route.viaZoneIds ?? []) assert.ok(zoneIds.has(zoneId));
      for (const zoneId of route.excludedZoneIds ?? []) assert.ok(zoneIds.has(zoneId));
      for (const tierId of route.floorTierIds) assert.ok(floorTierIds.has(tierId));
      assert.ok(route.minimumClearWidthTiles >= 1);
    }
  }
});

test('module resolvers return independent deeply immutable clones and reject unknown IDs', () => {
  const first = resolveIndustrialSupplementModuleManifest('challenge');
  const second = resolveIndustrialSupplementModuleManifest('challenge');

  assert.notEqual(first, INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS.challenge);
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.layout));
  assert.ok(Object.isFrozen(first.anchors));
  assert.ok(Object.isFrozen(first.anchors[0].localTile));
  assert.ok(Object.isFrozen(first.lighting));
  assert.ok(Object.isFrozen(first.lighting[0]));
  assert.ok(Object.isFrozen(first.lighting[0].localTile));
  assert.throws(() => {
    first.layout.topology = 'mutated';
  }, TypeError);
  assert.equal(INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS.challenge.layout.topology, 'cross-lane-arena');

  for (const unknownId of [undefined, null, '', 'unknown', '__proto__']) {
    assert.equal(resolveIndustrialSupplementModuleManifest(unknownId), null);
  }
});

test('module resolution selects only room manifests compatible with the chosen V4 grammar', () => {
  const challenge = resolveIndustrialSupplementModuleManifest({
    grammarId: 'supplement-hall-cluster-encounter-v1',
    moduleKind: 'room',
    contentRole: 'challenge',
  });
  const vertical = resolveIndustrialSupplementModuleManifest({
    grammarId: 'supplement-hall-cluster-terminal-v1',
    moduleKind: 'room',
    contentRole: 'elevation',
  });
  const discovery = resolveIndustrialSupplementModuleManifest({
    grammarId: 'supplement-hall-cluster-reward-v1',
    moduleKind: 'room',
    contentRole: 'discovery',
  });

  assert.equal(challenge.id, 'challenge');
  assert.equal(vertical.id, 'vertical-maintenance');
  assert.equal(discovery.id, 'calm-discovery');
  assert.equal(
    resolveIndustrialSupplementModuleManifest('supplement-hall-cluster-reward-v1').id,
    'reward-vault',
  );
  assert.equal(resolveIndustrialSupplementModuleManifest({
    grammarId: 'supplement-hall-cluster-encounter-v1',
    moduleKind: 'connector-module',
    contentRole: 'challenge',
  }), null);
  assert.equal(resolveIndustrialSupplementModuleManifest({
    grammarId: 'supplement-hall-cluster-reward-v1',
    moduleKind: 'room',
    contentRole: 'elevation',
  }), null);
  assert.equal(resolveIndustrialSupplementModuleManifest({
    grammarId: 'supplement-route-connector-through-t-v1',
    moduleKind: 'connector-module',
    contentRole: 'challenge',
  }), null);
});

test('encounter catalogs are keyed by live anchor profile IDs and use only current enemy keys', () => {
  assert.deepEqual(INDUSTRIAL_SUPPLEMENT_ENCOUNTER_PROFILE_IDS, EXPECTED_ENCOUNTER_PROFILE_IDS);
  const allowedEnemyKeys = new Set(INDUSTRIAL_SUPPLEMENT_ENEMY_KEYS);
  assert.deepEqual([...allowedEnemyKeys], ['basic', 'fast', 'ranged', 'horokko']);

  for (const profileId of INDUSTRIAL_SUPPLEMENT_ENCOUNTER_PROFILE_IDS) {
    const profile = INDUSTRIAL_SUPPLEMENT_ENCOUNTER_RECIPES[profileId];
    assert.equal(profile.encounterProfileId, profileId);

    for (const [moduleKind, moduleRecipe] of Object.entries(profile.moduleRecipes)) {
      const manifestZoneIds = new Set(
        INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS[moduleKind].zones.map(({ id }) => id),
      );
      for (const topologyClass of ['through', 'junction', 'vertical']) {
        const recipe = moduleRecipe.topologies[topologyClass];
        assert.ok(recipe.roster.length > 0);
        assert.equal(recipe.roster.length, recipe.spatialRoles.length);
        assert.equal(
          recipe.threat.budget,
          recipe.roster.reduce(
            (sum, enemyKey) => sum + recipe.threat.enemyWeights[enemyKey],
            0,
          ),
        );
        assert.equal(recipe.difficultyScaling.rosterPolicy, 'fixed-authored-roster');
        assert.equal(recipe.difficultyScaling.baseThreatBudget, recipe.threat.budget);
        assert.ok(['none', 'controlled-local-hazard'].includes(
          recipe.hazardInteraction.mode,
        ));
        assert.deepEqual(
          recipe.clearState.requiredSpatialRoleIds,
          recipe.spatialRoles.map(({ id }) => id),
        );
        assert.equal(recipe.clearState.completionRule, 'defeat-required-spawn-slots');
        for (const enemyKey of recipe.roster) assert.ok(allowedEnemyKeys.has(enemyKey));
        for (const role of recipe.spatialRoles) {
          assert.ok(allowedEnemyKeys.has(role.enemyKey));
          assert.ok(['frontline', 'flank', 'perch'].includes(role.role));
          assert.ok(role.validFloorZoneIds.length > 0);
          assert.deepEqual(role.validFloors, role.validFloorZoneIds);
          for (const zoneId of role.validFloorZoneIds) assert.ok(manifestZoneIds.has(zoneId));
        }
      }
    }
  }
});

test('encounter resolution is deterministic and varies by topology, module kind, and content role', () => {
  const profileId = 'supplement-route-network-defense';
  const throughChallenge = resolveIndustrialSupplementEncounterRecipe(profileId, {
    moduleKind: 'challenge',
    contentRole: 'challenge',
    topology: 'multi-door-room-chain',
  });
  const junctionChallenge = resolveIndustrialSupplementEncounterRecipe(profileId, {
    moduleKind: 'challenge',
    contentRole: 'challenge',
    junctionKind: 'crossroads',
  });
  const verticalMaintenance = resolveIndustrialSupplementEncounterRecipe(profileId, {
    moduleKind: 'room',
    contentRole: 'elevation',
    grammarId: 'supplement-hall-cluster-terminal-v1',
    topologyTemplateId: 'split-level-ring',
  });
  const hazardControl = resolveIndustrialSupplementEncounterRecipe(profileId, {
    moduleKind: 'hazard-control',
    contentRole: 'mechanism',
    topology: 'through-t-junction',
    difficulty: 4,
  });

  assert.equal(throughChallenge.topologyClass, 'through');
  assert.equal(junctionChallenge.topologyClass, 'junction');
  assert.equal(verticalMaintenance.topologyClass, 'vertical');
  assert.equal(hazardControl.topologyClass, 'junction');
  assert.notDeepEqual(throughChallenge.roster, junctionChallenge.roster);
  assert.notDeepEqual(junctionChallenge.roster, verticalMaintenance.roster);
  assert.notDeepEqual(
    junctionChallenge.spatialRoles.map(({ validFloorZoneIds }) => validFloorZoneIds),
    hazardControl.spatialRoles.map(({ validFloorZoneIds }) => validFloorZoneIds),
  );
  assert.equal(hazardControl.difficultyScaling.resolvedDifficulty, 4);
  assert.equal(
    hazardControl.difficultyScaling.scaledThreatBudget,
    hazardControl.threat.baseBudget + 3,
  );
  assert.equal(hazardControl.threat.scaledBudget, hazardControl.difficultyScaling.scaledThreatBudget);
  assert.equal(hazardControl.hazardInteraction.mode, 'controlled-local-hazard');
  assert.ok(hazardControl.hazardInteraction.excludedSpawnFloorZoneIds.includes('hazard-field'));
  assert.equal(hazardControl.clearState.completeState, 'cleared');
  assert.deepEqual(
    hazardControl.clearState.requiredSpatialRoleIds,
    hazardControl.spatialRoles.map(({ id }) => id),
  );
  assert.ok(Object.isFrozen(hazardControl.difficultyScaling));
  assert.ok(Object.isFrozen(hazardControl.hazardInteraction.hazardProfileIds));
  assert.ok(Object.isFrozen(hazardControl.clearState.requiredSpatialRoleIds));
  assert.ok(verticalMaintenance.spatialRoles.some(({ role }) => role === 'perch'));
  assert.ok(verticalMaintenance.spatialRoles.some(
    ({ validFloorZoneIds }) => validFloorZoneIds.includes('upper-catwalk'),
  ));

  const repeat = resolveIndustrialSupplementEncounterRecipe(profileId, {
    moduleKind: 'room',
    contentRole: 'elevation',
    grammarId: 'supplement-hall-cluster-terminal-v1',
    topologyTemplateId: 'split-level-ring',
  });
  assert.deepEqual(repeat, verticalMaintenance);
  assert.notEqual(repeat, verticalMaintenance);
  assert.ok(Object.isFrozen(repeat));
  assert.ok(Object.isFrozen(repeat.spatialRoles[0].validFloors));
});

test('encounter resolver fails closed for unknown or incompatible selectors', () => {
  const profileId = 'supplement-route-network-defense';
  assert.equal(resolveIndustrialSupplementEncounterRecipe('unknown-profile'), null);
  assert.equal(resolveIndustrialSupplementEncounterRecipe(profileId, { moduleKind: 'unknown' }), null);
  assert.equal(resolveIndustrialSupplementEncounterRecipe(profileId, { contentRole: 'unknown' }), null);
  assert.equal(resolveIndustrialSupplementEncounterRecipe(profileId, { topology: 'unknown' }), null);
  assert.equal(resolveIndustrialSupplementEncounterRecipe(profileId, { difficulty: 0 }), null);
  assert.equal(resolveIndustrialSupplementEncounterRecipe(profileId, {
    moduleKind: 'reward-vault',
    contentRole: 'challenge',
  }), null);
  assert.equal(resolveIndustrialSupplementTopologyClass('unknown'), null);
  assert.equal(resolveIndustrialSupplementTopologyClass('__proto__'), null);
});

test('reward, mechanism, and hazard recipes clone immutable data and fail closed', () => {
  assert.deepEqual(INDUSTRIAL_SUPPLEMENT_REWARD_PROFILE_IDS, [
    'supplement-route-network-cache',
    'supplement-treasure-cache',
  ]);
  assert.deepEqual(INDUSTRIAL_SUPPLEMENT_MECHANISM_PROFILE_IDS, [
    'supplement-route-network-control',
  ]);
  assert.deepEqual(INDUSTRIAL_SUPPLEMENT_HAZARD_PROFILE_IDS, [
    'supplement-route-network-floor-trap',
    'supplement-terminal-pulse-field',
  ]);

  const reward = resolveIndustrialSupplementRewardRecipe('supplement-treasure-cache');
  const rewardAgain = resolveIndustrialSupplementRewardRecipe('supplement-treasure-cache');
  assert.deepEqual(reward, rewardAgain);
  assert.notEqual(reward, rewardAgain);
  assert.ok(Object.isFrozen(reward.delivery.rewardTags));
  assert.equal(reward.delivery.rareBoost, true);
  assert.equal(reward.progressionCritical, false);
  assert.deepEqual(reward.collectibleSafety, {
    requiresReachableFloor: true,
    requiresReturnPath: true,
    mayGrantCredential: false,
    mayUnlockAuthoredProgression: false,
  });

  const mechanism = resolveIndustrialSupplementMechanismRecipe(
    'supplement-route-network-control',
  );
  assert.ok(Object.isFrozen(mechanism.effects[0].targetProfileIds));
  assert.equal(mechanism.stateMachine.transition.to, 'isolated');

  const hazard = resolveIndustrialSupplementHazardRecipe(
    'supplement-route-network-floor-trap',
  );
  assert.ok(Object.isFrozen(hazard.safeFloorZoneIds));
  assert.equal(
    hazard.controlledByMechanismProfileId,
    'supplement-route-network-control',
  );

  assert.equal(resolveIndustrialSupplementRewardRecipe('unknown'), null);
  assert.equal(resolveIndustrialSupplementMechanismRecipe('unknown'), null);
  assert.equal(resolveIndustrialSupplementHazardRecipe('unknown'), null);
});

test('curated manifests pass deterministic structural-quality acceptance', () => {
  for (const manifest of Object.values(INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS)) {
    const grammar = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[manifest.compatibleGrammarIds[0]];
    const report = inspectIndustrialSupplementManifestStructuralQuality(manifest, {
      structure: grammar.structure,
      clearanceVolumes: grammar.clearanceVolumes,
    });
    assert.equal(report.accepted, true, `${manifest.id}: ${report.errors.join(', ')}`);
    assert.ok(report.metrics.coverCount >= 2);
    assert.ok(report.metrics.landmarkCount >= 2);
    assert.ok(report.metrics.nonBlockingCoverCount >= 1);
    assert.ok(report.metrics.distinctPresentationTileCount >= 3);
    assert.ok(report.metrics.coverSpanTiles >= 2);
    assert.ok(report.metrics.landmarkSpanTiles >= 2);
    assert.deepEqual(
      report.metrics.accessibleExitSocketIds,
      report.metrics.requiredExitSocketIds,
    );
    assert.ok(report.metrics.zoneFloorCoverage.every(({ accepted }) => accepted));
    assert.ok(report.metrics.sightlines.length >= 2);
    assert.ok(report.metrics.sightlines.every(({ accepted }) => accepted));
    assert.ok(
      report.metrics.maximumDistanceToFeatureTiles
        <= report.metrics.maximumAllowedDistanceToFeatureTiles,
    );
    assert.deepEqual(report.metrics.unsupportedRecords, []);
    assert.deepEqual(report.metrics.enclosureAndCamera, {
      metadataAccepted: true,
      structureAccepted: true,
      cameraMetadataAccepted: true,
      clearanceAccepted: true,
    });
  }
});

test('structural-quality acceptance rejects deterministic spatial regressions', () => {
  const source = INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS.challenge;
  const inspectChanged = (mutate) => {
    const manifest = structuredClone(source);
    mutate(manifest);
    return inspectIndustrialSupplementManifestStructuralQuality(manifest);
  };

  const undistributed = inspectChanged((manifest) => {
    manifest.landmarks = [manifest.landmarks[0]];
  });
  assert.ok(undistributed.errors.includes('insufficient-landmark-count'));

  const unsupportedCover = inspectChanged((manifest) => {
    manifest.cover[0].localTile = { x: 99, z: 99, elevation: 0 };
  });
  assert.ok(unsupportedCover.errors.includes(
    'unsupported-local-record:cover:press-column-west',
  ));

  const blockedSightline = inspectChanged((manifest) => {
    manifest.cover.push({
      id: 'entry-sightline-blocker',
      kind: 'full-height-bulkhead',
      localTile: { x: 0, z: -1, elevation: 0 },
      validFloorZoneIds: ['combat-floor'],
      blocksLineOfSight: true,
    });
  });
  assert.ok(blockedSightline.errors.includes(
    'required-sightline-blocked:entry-to-warning-cross',
  ));

  const inaccessibleExit = inspectChanged((manifest) => {
    manifest.clearRoutes[0].fromSocketIds = ['entry'];
  });
  assert.ok(inaccessibleExit.errors.includes('required-exit-route-missing:exit'));
  assert.ok(inaccessibleExit.errors.includes('required-exit-coverage-incomplete'));

  const emptyFloor = inspectChanged((manifest) => {
    manifest.cover = [];
    manifest.landmarks = [];
    manifest.lighting = [];
  });
  assert.ok(emptyFloor.errors.includes('empty-floor-radius-exceeded'));

  const missingEnclosure = inspectChanged((manifest) => {
    delete manifest.structuralQuality.enclosure;
  });
  assert.ok(missingEnclosure.errors.includes('invalid-enclosure-metadata'));

  const cameraContext = inspectIndustrialSupplementManifestStructuralQuality(source, {
    structure: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[
      source.compatibleGrammarIds[0]
    ].structure,
    clearanceVolumes: [{
      purpose: 'decorative-volume',
      size: { x: 1, y: 1, z: 1 },
    }],
  });
  assert.ok(cameraContext.errors.includes('camera-clearance-volume-missing'));
});

test('complete variety signatures retain authored choices but ignore runtime projections', () => {
  const legacyFields = {
    topologyTemplateId: 'split-level-ring',
    degreeSequence: [1, 2, 3],
    elevationModes: ['lift', 'split-level-platform'],
    contentRoles: ['challenge', 'reward'],
  };
  const primaryRoom = {
    ordinal: 1,
    contentRole: 'challenge',
    moduleManifestId: 'challenge',
    moduleTemplateId: 'supplement-hall-cluster-terminal-v1',
    moduleKind: 'challenge',
    physicalModuleKind: 'room',
    geometry: {
      dimensionsTiles: { width: 7, depth: 7 },
      rotationQuarterTurns: 1,
      layout: { topology: 'split-platform', dimensionsTiles: { width: 7, depth: 7 } },
      floorCellMeters: 2.8,
      floorMask: ['###', '#.#', '###'],
      floorTiers: [{
        id: 'runtime-room:tier:main',
        localTierId: 'main',
        elevation: 0,
        runtimeId: 'runtime-room:tier:main',
        roomId: 'runtime-room',
        worldElevation: 14,
        worldCells: [{ id: 'runtime-room:tier:main:cell:0', position: { x: 80, y: 14, z: -20 } }],
      }],
      clearRoutes: [{
        id: 'runtime-room:route:entry-exit',
        localRouteId: 'entry-exit',
        fromSocketIds: ['entry'],
        toSocketIds: ['exit'],
        runtimeId: 'runtime-room:route:entry-exit',
        worldCellIds: ['runtime-cell'],
      }],
      zones: [{
        id: 'runtime-room:zone:safe-floor',
        localZoneId: 'safe-floor',
        tileBounds: { minX: -2, maxX: 2, minZ: -1, maxZ: 1 },
        runtimeId: 'runtime-room:zone:safe-floor',
        worldBoundsByElevation: [{ minGridX: 27, maxGridX: 31 }],
      }],
    },
    furnishing: [{
      id: 'runtime-room:content-anchor:hazard-grid',
      localAnchorId: 'hazard-grid',
      kind: 'hazard',
      localTile: { x: 1, z: 0, elevation: 0 },
      position: { x: 82.8, y: 14, z: -20 },
      runtimeId: 'runtime-room:content-anchor:hazard-grid',
      hazardRecipe: { id: 'duplicated-on-anchor' },
    }, {
      id: 'runtime-room:content-anchor:control-console',
      localAnchorId: 'control-console',
      kind: 'mechanism',
      localTile: { x: -1, z: 0, elevation: 0 },
      position: { x: 77.2, y: 14, z: -20 },
      runtimeStateId: 'runtime-room:state:control',
    }],
    cover: [{
      id: 'runtime-room:cover:barrier',
      localCoverId: 'barrier',
      kind: 'waist-high-barrier',
      localTile: { x: 0, z: 1 },
      blocksLineOfSight: true,
      worldPosition: { x: 80, y: 14, z: -17.2 },
    }],
    landmarks: [{
      id: 'runtime-room:landmark:gantry',
      localLandmarkId: 'gantry',
      kind: 'overhead-gantry',
      localTile: { x: 0, z: -2 },
      grid: { x: 29, z: -9 },
    }],
    lighting: [{
      id: 'runtime-room:lighting:warning-strip',
      localLightingId: 'warning-strip',
      kind: 'warning-strip',
      localTile: { x: 0, z: 0, elevation: 2.2 },
      intensity: 1.4,
      position: { x: 80, y: 16.2, z: -20 },
    }],
    hazardRecipes: [{
      id: 'supplement-route-network-floor-trap:challenge',
      hazardProfileId: 'supplement-route-network-floor-trap',
      damagePerPulse: 6,
      recipeInstanceId: 'runtime-room:recipe:hazard',
      nodeId: 'runtime-room',
      anchorId: 'runtime-room:content-anchor:hazard-grid',
    }],
    encounterChoices: [{
      encounterProfileId: 'supplement-route-network-defense',
      encounterRecipe: {
        id: 'supplement-route-network-defense:challenge:split-level',
        encounterProfileId: 'supplement-route-network-defense',
        threat: { rating: 'high' },
        roster: ['basic', 'ranged'],
        spatialRoles: [{ id: 'frontline-1', role: 'frontline' }],
        recipeInstanceId: 'runtime-room:recipe:encounter',
      },
      roster: ['basic', 'ranged'],
      spatialRoles: [{
        id: 'frontline-1',
        role: 'frontline',
        anchorIds: ['encounter-frontline'],
        spawnPosition: { x: 82.8, y: 14, z: -17.2 },
      }],
    }],
    rewardRecipes: [{
      id: 'supplement-route-network-cache',
      rewardProfileId: 'supplement-route-network-cache',
      delivery: { rareBoost: false, rewardTags: ['route-cache'] },
      recipeInstanceId: 'runtime-room:recipe:reward',
      runtimeStateId: 'runtime-room:state:reward',
    }],
  };
  const secondaryRoom = {
    ordinal: 0,
    contentRole: 'reward',
    moduleManifestId: 'reward-vault',
    geometry: {
      dimensionsTiles: { width: 5, depth: 5 },
      floorMask: ['###', '###', '###'],
    },
  };
  const input = {
    legacyFields,
    rooms: [primaryRoom, secondaryRoom],
  };
  const signature = createDungeonAugmentationCompleteLayoutSignature(input);

  const translated = structuredClone(input);
  translated.rooms.reverse();
  const translatedPrimary = translated.rooms.find(({ moduleManifestId }) => (
    moduleManifestId === 'challenge'
  ));
  translatedPrimary.furnishing.reverse();
  translatedPrimary.geometry.floorTiers[0].id = 'other-room:tier:main';
  translatedPrimary.geometry.floorTiers[0].runtimeId = 'other-room:tier:main';
  translatedPrimary.geometry.floorTiers[0].roomId = 'other-room';
  translatedPrimary.geometry.floorTiers[0].worldElevation = -70;
  translatedPrimary.geometry.floorTiers[0].worldCells = [{
    id: 'other-room:tier:main:cell:0',
    position: { x: -999, y: -70, z: 555 },
  }];
  translatedPrimary.geometry.clearRoutes[0].id = 'other-room:route:entry-exit';
  translatedPrimary.geometry.clearRoutes[0].runtimeId = 'other-room:route:entry-exit';
  translatedPrimary.geometry.clearRoutes[0].worldCellIds = ['other-runtime-cell'];
  translatedPrimary.geometry.zones[0].id = 'other-room:zone:safe-floor';
  translatedPrimary.geometry.zones[0].runtimeId = 'other-room:zone:safe-floor';
  translatedPrimary.geometry.zones[0].worldBoundsByElevation = [{
    minGridX: -400,
    maxGridX: -396,
  }];
  for (const collectionName of ['furnishing', 'cover', 'landmarks', 'lighting']) {
    for (const record of translatedPrimary[collectionName]) {
      record.id = `other-room:${collectionName}:${record.id}`;
      record.nodeId = 'other-room';
      record.operationId = 'other-operation';
      record.runtimeId = `other-runtime:${collectionName}`;
      record.position = { x: -999, y: -70, z: 555 };
      record.worldPosition = { x: -999, y: -70, z: 555 };
      record.grid = { x: -357, z: 198 };
    }
  }
  translatedPrimary.encounterChoices[0].spatialRoles[0].spawnPosition = {
    x: -999,
    y: -70,
    z: 555,
  };
  for (const recipe of [
    ...translatedPrimary.hazardRecipes,
    translatedPrimary.encounterChoices[0].encounterRecipe,
    ...translatedPrimary.rewardRecipes,
  ]) {
    recipe.recipeInstanceId = 'other-runtime-recipe';
    recipe.runtimeStateId = 'other-runtime-state';
    recipe.nodeId = 'other-room';
    recipe.anchorId = 'other-runtime-anchor';
  }

  assert.equal(
    createDungeonAugmentationCompleteLayoutSignature(translated),
    signature,
  );
  const parsed = JSON.parse(signature);
  assert.deepEqual(parsed.topologyTemplateId, legacyFields.topologyTemplateId);
  assert.deepEqual(parsed.degreeSequence, legacyFields.degreeSequence);
  assert.deepEqual(parsed.elevationModes, legacyFields.elevationModes);
  assert.deepEqual(parsed.contentRoles, legacyFields.contentRoles);
  assert.deepEqual(
    parsed.roomContent.map(({ moduleManifestId }) => moduleManifestId),
    ['reward-vault', 'challenge'],
  );
  const normalizedPrimary = parsed.roomContent[1];
  assert.equal(normalizedPrimary.geometry.floorTiers[0].id, 'main');
  assert.equal(normalizedPrimary.furnishing.length, 2);
  assert.equal(normalizedPrimary.cover[0].id, 'barrier');
  assert.equal(normalizedPrimary.landmarks[0].id, 'gantry');
  assert.equal(normalizedPrimary.lighting[0].id, 'warning-strip');
  assert.equal(normalizedPrimary.hazardRecipes[0].damagePerPulse, 6);
  assert.deepEqual(normalizedPrimary.encounterChoices[0].roster, ['basic', 'ranged']);
  assert.equal(normalizedPrimary.encounterChoices[0].spatialRoles[0].role, 'frontline');
  assert.equal(normalizedPrimary.rewardRecipes[0].delivery.rareBoost, false);
  assert.doesNotMatch(signature, /runtime-room|other-room|other-operation|-999|555/);

  const authoredMutations = [
    ['geometry', (room) => { room.geometry.floorMask[1] = '###'; }],
    ['furnishing', (room) => { room.furnishing[0].kind = 'mechanism'; }],
    ['cover', (room) => { room.cover[0].blocksLineOfSight = false; }],
    ['landmark', (room) => { room.landmarks[0].kind = 'warning-totem'; }],
    ['lighting', (room) => { room.lighting[0].intensity = 2.1; }],
    ['hazard recipe', (room) => { room.hazardRecipes[0].damagePerPulse = 12; }],
    ['encounter recipe', (room) => {
      room.encounterChoices[0].encounterRecipe.threat.rating = 'severe';
    }],
    ['encounter roster', (room) => { room.encounterChoices[0].roster[1] = 'fast'; }],
    ['encounter spatial role', (room) => {
      room.encounterChoices[0].spatialRoles[0].role = 'perch';
    }],
    ['reward recipe', (room) => {
      room.rewardRecipes[0].delivery.rareBoost = true;
    }],
  ];
  for (const [label, mutate] of authoredMutations) {
    const changed = structuredClone(input);
    mutate(changed.rooms[0]);
    assert.notEqual(
      createDungeonAugmentationCompleteLayoutSignature(changed),
      signature,
      `${label} must contribute to the complete signature`,
    );
  }
});
