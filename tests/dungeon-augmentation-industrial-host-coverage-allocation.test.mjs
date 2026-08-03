import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import {
  createIndustrialAugmentationHost,
  createIndustrialBaseDraft,
} from '../src/dungeon-augmentation/IndustrialDraftAdapter.js';
import { hashCanonicalValue } from '../src/dungeon-augmentation/canonical.js';
import { validateDungeonExtensionHost } from '../src/dungeon-augmentation/contracts.js';
import { normalizeRouteNetworkConflictExclusions } from '../src/dungeon-augmentation/routeNetworkModulePruning.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';

const TILE_SIZE = 2.8;
const SEED_ZERO = 'layout:augmentation-realized-v4-000';
const SEED_ONE = 'layout:augmentation-realized-v4-001';
const V4_PROFILE_ID = 'industrial-supplement-preview-v4';
const OBJECTIVE_ROUTE_IDS = [
  'enemyNest_keycardRoom',
  'keycardRoom_trapRoom',
  'trapRoom_conveyorRoom',
  'conveyorRoom_bossRoom',
  'bossRoom_shrineRoom',
];

function rounded(value) {
  return Number(Number(value).toFixed(6));
}

function endpointLayout(socket) {
  return {
    distanceMeters: rounded(socket.distanceMeters),
    position: [socket.position.x, socket.position.y, socket.position.z].map(rounded),
    facing: [socket.facing.x, socket.facing.z].map(rounded),
    planningModuleCenter: socket.planningModuleCenter
      ? [socket.planningModuleCenter.x, socket.planningModuleCenter.z].map(rounded)
      : null,
    planningContinuationCenter: socket.planningContinuationCenter
      ? [socket.planningContinuationCenter.x, socket.planningContinuationCenter.z].map(rounded)
      : null,
  };
}

function coverageGrants(host) {
  return host.extensionRegions[0].routeNetworkGrants.filter(({ kind }) => (
    kind === 'objective-route-coverage'
  ));
}

function rectangleOverlapArea(first, second) {
  return Math.max(0, Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX))
    * Math.max(0, Math.min(first.maxZ, second.maxZ) - Math.max(first.minZ, second.minZ));
}

function createCanonicalBase(seed) {
  const seeded = new SeededRandom(hashSeed(seed));
  const sourceRandomCounter = { calls: 0 };
  const sourceRandom = () => {
    sourceRandomCounter.calls += 1;
    return seeded.next();
  };
  const generator = new DungeonGenerator({
    random: sourceRandom,
    difficulty: 1,
    augmentationProfileId: V4_PROFILE_ID,
    augmentationSeed: seed,
    basePlanHash: `v1:${seed}:depth:1:revolvingFusillade`,
  });
  const texture = new THREE.Texture();
  generator.textureCache.set('coverage-allocation-test', texture);
  generator._loadRuinTexture = () => texture;
  generator.augmentationProfileId = null;
  const base = generator._generateAcceptedIndustrialDungeon({
    captureAcceptedRandomTape: true,
  });
  const baseDraft = createIndustrialBaseDraft({
    rooms: base.dungeon.rooms,
    connectionPlans: base.dungeon.connectionPlans,
    basePlanHash: generator.basePlanHash,
    tileSize: generator.tileSize,
    difficulty: generator.difficulty,
  });
  return {
    generator,
    texture,
    base,
    baseDraft,
    sourceRandom,
    sourceRandomCounter,
  };
}

function createPlanningParityWitness(generator, planningSnapshot) {
  const baseDraft = createIndustrialBaseDraft({
    rooms: planningSnapshot.rooms,
    connectionPlans: planningSnapshot.connectionPlans,
    basePlanHash: generator.basePlanHash,
    tileSize: generator.tileSize,
    difficulty: generator.difficulty,
  });
  const host = createIndustrialAugmentationHost({
    basePlanHash: baseDraft.basePlanHash,
    baseDraft,
    rooms: planningSnapshot.rooms,
    connectionPlans: planningSnapshot.connectionPlans,
    tileSize: generator.tileSize,
  });
  return {
    snapshotHash: hashCanonicalValue(JSON.parse(JSON.stringify(planningSnapshot)), {
      namespace: 'industrial-direct-full-planning-snapshot-parity/v1',
    }),
    baseDraftHash: hashCanonicalValue(baseDraft, {
      namespace: 'industrial-direct-full-base-draft-parity/v1',
    }),
    hostHash: hashCanonicalValue(host.extensionRegions, {
      namespace: 'industrial-direct-full-host-parity/v1',
    }),
  };
}

function capturePlannerCandidateTrace(run) {
  const flagName = '__DUNGEON_AUGMENTATION_ROUTE_CANDIDATE_DEBUG__';
  const hadOwnFlag = Object.hasOwn(globalThis, flagName);
  const previousFlag = globalThis[flagName];
  const originalConsoleError = console.error;
  const candidateTrace = [];
  let value = null;
  let error = null;

  globalThis[flagName] = true;
  console.error = (...args) => {
    if (args.length === 1 && typeof args[0] === 'string') {
      try {
        const record = JSON.parse(args[0]);
        if (Number.isInteger(record?.candidateOrdinal)
          && typeof record?.grantId === 'string') {
          const exhaustionSignals = [...new Set(
            JSON.stringify(record).match(
              /(?:route-network-(?:global-search-budget|adjacent-domain|forward-check-endpoint-domain)-exhausted|(?:cheap|exact)-budget-exhausted)/gi,
            ) ?? [],
          )].sort();
          candidateTrace.push({
            operationOrdinal: Number(record.operationOrdinal),
            candidateOrdinal: Number(record.candidateOrdinal),
            grantId: record.grantId,
            moduleCount: Number(record.moduleCount),
            elevationMode: record.elevationMode ?? null,
            topologyTemplateId: record.topologyTemplateId ?? null,
            junctionKind: record.junctionKind ?? null,
            searchVariant: Number(record.searchVariant),
            status: record.status ?? null,
            error: record.error ?? null,
            reason: record.reason ?? null,
            exhaustionSignals,
          });
          return;
        }
      } catch {
        // Forward unrelated diagnostics to the original sink below.
      }
    }
    originalConsoleError(...args);
  };

  try {
    value = run();
  } catch (caughtError) {
    error = caughtError;
  } finally {
    console.error = originalConsoleError;
    if (hadOwnFlag) globalThis[flagName] = previousFlag;
    else delete globalThis[flagName];
  }

  return { value, error, candidateTrace };
}

function routeNetworkOperations(planningResult) {
  return (planningResult?.result?.overlayPlan?.operations ?? []).filter(({ type }) => (
    type === 'routeNetwork'
  ));
}

function omitNondeterministicPlanningTimings(value) {
  if (Array.isArray(value)) return value.map(omitNondeterministicPlanningTimings);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !(
      key === 'planningPhaseTimings'
        || key === 'generatorPhaseTimings'
        || /(?:elapsed|duration|time)Ms$/i.test(key)
    ))
    .map(([key, entry]) => [key, omitNondeterministicPlanningTimings(entry)]));
}

function createAcceptedPlanningEvidence(planningResult, candidateTrace) {
  assert.ok(planningResult, 'The real planner must return an integration result.');
  assert.ok(planningResult.result, 'The generator result must retain the sidecar planner result.');
  assert.ok(
    candidateTrace.length > 0,
    'The real planner must expose at least one deterministic candidate-order record.',
  );

  const plannerResult = planningResult.result;
  if (plannerResult.status !== 'applied') {
    const rejection = {
      status: plannerResult.status,
      reason: plannerResult.diagnostics?.reason ?? null,
      errors: omitNondeterministicPlanningTimings(
        plannerResult.diagnostics?.errors ?? [],
      ),
      decisions: omitNondeterministicPlanningTimings(
        plannerResult.diagnostics?.decisions ?? [],
      ),
      candidateTrace,
    };
    return {
      status: plannerResult.status,
      rejection,
      rejectionHash: hashCanonicalValue(rejection, {
        namespace: 'industrial-direct-replay-stable-rejection/v1',
      }),
    };
  }

  const overlayPlan = plannerResult.overlayPlan;
  const operations = routeNetworkOperations(planningResult);
  assert.match(
    overlayPlan?.augmentationPlanHash ?? '',
    /^v1-[0-9a-f]+$/,
    'An accepted integration plan must retain its canonical plan hash.',
  );
  assert.ok(
    typeof overlayPlan?.augmentationSeed === 'string'
      && overlayPlan.augmentationSeed.length > 0,
    'An accepted integration plan must retain its exact isolated plan seed.',
  );
  assert.ok(operations.length > 0, 'An accepted V4 plan must contain route networks.');
  assert.equal(
    operations.every(({ selectionManifest }) => (
      selectionManifest?.schema === 'ruindivex-dungeon-route-network-selection-manifest/v1'
    )),
    true,
    'Every accepted route network must retain its selection manifest.',
  );
  for (const operation of operations) {
    assert.equal(
      candidateTrace.some((candidate) => (
        candidate.status === 'planned'
          && candidate.grantId === operation.grantId
          && candidate.topologyTemplateId === operation.topologyTemplateId
          && candidate.elevationMode === operation.elevationModes?.[0]
      )),
      true,
      `The candidate trace must bind accepted operation ${operation.id} to its selected families.`,
    );
  }

  const selectionEvidence = operations.map(({
    id,
    grantId,
    selectionManifest,
  }) => ({ id, grantId, selectionManifest }));
  const hostReservationEvidence = (planningResult.host?.extensionRegions ?? []).map((region) => ({
    regionId: region.id,
    grants: (region.routeNetworkGrants ?? []).map((grant) => ({
      id: grant.id,
      kind: grant.kind,
      required: grant.required,
      endpointSocketIds: (grant.endpointSockets ?? []).map(({ id }) => id),
      protectedVolumes: grant.protectedVolumes ?? [],
      planningReservationRectangles: grant.planningReservationRectangles ?? [],
      planningRoomReservationRectangles: grant.planningRoomReservationRectangles ?? [],
      socketLandingOverlapGrants: grant.socketLandingOverlapGrants ?? [],
      socketModuleOverlapGrants: grant.socketModuleOverlapGrants ?? [],
    })),
  }));
  const acceptedPhysicalReservationEvidence = {
    nodes: (overlayPlan.nodes ?? []).map((node) => ({
      id: node.id,
      operationId: node.operationId,
      occupiedVolumes: node.occupiedVolumes ?? [],
      clearanceVolumes: node.clearanceVolumes ?? [],
    })),
    segments: (overlayPlan.segments ?? []).map((segment) => ({
      id: segment.id,
      operationId: segment.operationId,
      occupiedVolumes: segment.occupiedVolumes ?? [],
      clearanceVolumes: segment.clearanceVolumes ?? [],
      landingVolumes: segment.landingVolumes ?? [],
    })),
  };
  assert.ok(
    hostReservationEvidence.some(({ grants }) => grants.some((grant) => (
      grant.endpointSocketIds.length > 0
        && (
          grant.protectedVolumes.length > 0
            || grant.planningReservationRectangles.length > 0
            || grant.planningRoomReservationRectangles.length > 0
        )
    ))),
    'The accepted host must retain nonempty grant reservation evidence.',
  );
  assert.ok(
    acceptedPhysicalReservationEvidence.nodes.some(({ occupiedVolumes, clearanceVolumes }) => (
      occupiedVolumes.length > 0 || clearanceVolumes.length > 0
    )),
    'The accepted overlay must retain physical reservation volumes.',
  );

  return {
    status: plannerResult.status,
    augmentationSeed: overlayPlan.augmentationSeed,
    augmentationPlanHash: overlayPlan.augmentationPlanHash,
    selectionManifestHash: hashCanonicalValue(selectionEvidence, {
      namespace: 'industrial-direct-replay-selection-manifests/v1',
    }),
    hostReservationHash: hashCanonicalValue(hostReservationEvidence, {
      namespace: 'industrial-direct-replay-host-reservations/v1',
    }),
    acceptedPhysicalReservationHash: hashCanonicalValue(
      acceptedPhysicalReservationEvidence,
      { namespace: 'industrial-direct-replay-accepted-physical-reservations/v1' },
    ),
    candidateOrderHash: hashCanonicalValue(candidateTrace, {
      namespace: 'industrial-direct-replay-candidate-order/v1',
    }),
    selectionEvidence,
    hostReservationEvidence,
    acceptedPhysicalReservationEvidence,
    candidateTrace,
  };
}

function assertCanonicalReplayPlanningParity({
  generator,
  base,
  sourceRandom,
  sourceRandomCounter,
}) {
  assert.equal(Object.hasOwn(generator, 'augmentationPlanSeedOverride'), false);
  assert.equal(
    Object.hasOwn(generator, '_augmentationReplayPlanningSnapshotOverride'),
    false,
  );
  const directPlanningSnapshot =
    generator._createIndustrialDungeonAugmentationPlanningSnapshot({
      rooms: base.dungeon.rooms,
      connectionPlans: base.dungeon.connectionPlans,
    });
  const directPlanningSnapshotAtEntry = JSON.parse(JSON.stringify(directPlanningSnapshot));
  const directWitness = createPlanningParityWitness(
    generator,
    directPlanningSnapshot,
  );
  const sourceRandomCallsBeforePlanning = sourceRandomCounter.calls;
  const originalGenerateAcceptedIndustrialDungeon =
    generator._generateAcceptedIndustrialDungeon;
  const originalPlanIndustrialDungeonAugmentation =
    generator._planIndustrialDungeonAugmentation;
  const originalProfileId = generator.augmentationProfileId;
  const originalRealizationAttemptLimit = generator.augmentationRealizationAttemptLimit;
  let replayPlanningSnapshotAtEntry = null;
  let replayWitnessAtEntry = null;
  let replayPlanningResult = null;
  let directCapture = null;
  let replayCapture = null;
  generator.augmentationProfileId = V4_PROFILE_ID;
  generator.augmentationRealizationAttemptLimit = 1;
  generator._generateAcceptedIndustrialDungeon = () => base;
  generator._planIndustrialDungeonAugmentation = (planningInput) => {
    assert.equal(
      Object.hasOwn(generator, '_augmentationReplayPlanningSnapshotOverride'),
      true,
    );
    replayPlanningSnapshotAtEntry = JSON.parse(JSON.stringify(
      planningInput.planningSnapshotOverride,
    ));
    replayWitnessAtEntry = createPlanningParityWitness(
      generator,
      planningInput.planningSnapshotOverride,
    );
    replayPlanningResult = originalPlanIndustrialDungeonAugmentation.call(
      generator,
      planningInput,
    );
    const error = new Error('Captured canonical replay planning result.');
    error.code = 'DUNGEON_AUGMENTATION_PLANNING_UNCHANGED';
    error.augmentationDiagnostics = {
      status: 'unchanged',
      reason: 'canonical-planning-parity-capture',
      errors: [],
    };
    throw error;
  };
  try {
    directCapture = capturePlannerCandidateTrace(() => (
      originalPlanIndustrialDungeonAugmentation.call(generator, {
        rooms: directPlanningSnapshot.rooms,
        connectionPlans: directPlanningSnapshot.connectionPlans,
        planningSnapshotOverride: directPlanningSnapshot,
      })
    ));
    assert.ifError(directCapture.error);
    assert.equal(sourceRandomCounter.calls, sourceRandomCallsBeforePlanning);

    replayCapture = capturePlannerCandidateTrace(() => (
      generator._generateIndustrialDungeonWithAugmentationReplay()
    ));
    assert.ifError(replayCapture.error);
    assert.equal(
      replayCapture.value,
      base.dungeon,
    );
  } finally {
    generator._generateAcceptedIndustrialDungeon =
      originalGenerateAcceptedIndustrialDungeon;
    generator._planIndustrialDungeonAugmentation =
      originalPlanIndustrialDungeonAugmentation;
    generator.augmentationProfileId = originalProfileId;
    generator.augmentationRealizationAttemptLimit = originalRealizationAttemptLimit;
  }

  assert.ok(replayPlanningSnapshotAtEntry);
  assert.deepEqual(replayPlanningSnapshotAtEntry, directPlanningSnapshotAtEntry);
  assert.deepEqual(replayWitnessAtEntry, directWitness);
  const directEvidence = createAcceptedPlanningEvidence(
    directCapture.value,
    directCapture.candidateTrace,
  );
  const replayEvidence = createAcceptedPlanningEvidence(
    replayPlanningResult,
    replayCapture.candidateTrace,
  );
  assert.deepEqual(replayEvidence, directEvidence);
  assert.equal(directEvidence.status, 'applied');
  assert.equal(replayEvidence.status, 'applied');
  assert.equal(sourceRandomCounter.calls, sourceRandomCallsBeforePlanning);
  assert.equal(generator.random, sourceRandom);
  assert.equal(Object.hasOwn(generator, 'augmentationPlanSeedOverride'), false);
  assert.equal(
    Object.hasOwn(generator, '_augmentationReplayPlanningSnapshotOverride'),
    false,
  );
  assert.equal(base.dungeon.basePlanHash, generator.basePlanHash);
  assert.equal(base.dungeon.effectivePlanHash, generator.basePlanHash);
}

test('Industrial coverage allocation recovers every seed1 objective route in canonical order', {
  timeout: 30_000,
}, () => {
  const {
    generator,
    texture,
    base,
    baseDraft,
  } = createCanonicalBase(SEED_ONE);
  try {
    const input = {
      baseDraft,
      rooms: base.dungeon.rooms,
      connectionPlans: base.dungeon.connectionPlans,
      tileSize: generator.tileSize,
    };
    const host = createIndustrialAugmentationHost(input);
    const repeatedHost = createIndustrialAugmentationHost(input);
    const grants = coverageGrants(host);

    assert.deepEqual(
      grants.map(({ coverage }) => coverage.logicalEdgeId),
      OBJECTIVE_ROUTE_IDS,
    );
    assert.equal(grants.every(({ required }) => required === true), true);
    assert.equal(grants.every(({ coverage }) => (
      coverage.coverageComplete === true
        && Math.max(...coverage.featurelessSpansMeters) <= 33.6 + 1e-6
    )), true);
    for (let firstIndex = 0; firstIndex < grants.length; firstIndex += 1) {
      const firstHardReservations = [
        ...grants[firstIndex].planningReservationRectangles,
        ...grants[firstIndex].planningRoomReservationRectangles,
      ];
      for (let secondIndex = firstIndex + 1; secondIndex < grants.length; secondIndex += 1) {
        const secondHardReservations = [
          ...grants[secondIndex].planningReservationRectangles,
          ...grants[secondIndex].planningRoomReservationRectangles,
        ];
        assert.equal(firstHardReservations.some((first) => (
          secondHardReservations.some((second) => rectangleOverlapArea(first, second) > 1e-6)
        )), false, `${grants[firstIndex].coverage.logicalEdgeId} overlaps ${grants[secondIndex].coverage.logicalEdgeId}`);
      }
    }
    assert.deepEqual(coverageGrants(repeatedHost), grants);
    assert.deepEqual(
      repeatedHost.extensionRegions[0].progressionSnapshot,
      host.extensionRegions[0].progressionSnapshot,
    );
    assert.equal(validateDungeonExtensionHost(host).accepted, true);

    const grantByEdgeId = new Map(grants.map((grant) => [
      grant.coverage.logicalEdgeId,
      grant,
    ]));
    const legacyLayouts = Object.fromEntries([
      'enemyNest_keycardRoom',
      'keycardRoom_trapRoom',
      'trapRoom_conveyorRoom',
      'bossRoom_shrineRoom',
    ].map((edgeId) => [
      edgeId,
      grantByEdgeId.get(edgeId).endpointSockets.map(endpointLayout),
    ]));
    assert.deepEqual(legacyLayouts, {
      enemyNest_keycardRoom: [{
        distanceMeters: 33.6,
        position: [63, -14, 47.6],
        facing: [1, 0],
        planningModuleCenter: [75.6, 47.6],
        planningContinuationCenter: [100.8, 47.6],
      }, {
        distanceMeters: 50.4,
        position: [63, -14, 64.4],
        facing: [1, 0],
        planningModuleCenter: [75.6, 64.4],
        planningContinuationCenter: [106.4, 70],
      }],
      keycardRoom_trapRoom: [{
        distanceMeters: 95.2,
        position: [-54.6, 0, 114.8],
        facing: [1, 0],
        planningModuleCenter: [-42, 114.8],
        planningContinuationCenter: [-11.2, 120.4],
      }, {
        distanceMeters: 112,
        position: [-54.6, 0, 131.6],
        facing: [1, 0],
        planningModuleCenter: [-42, 131.6],
        planningContinuationCenter: [-11.2, 142.8],
      }],
      trapRoom_conveyorRoom: [{
        distanceMeters: 78.4,
        position: [46.2, -14, 170.8],
        facing: [1, 0],
        planningModuleCenter: [58.8, 170.8],
        planningContinuationCenter: [84, 170.8],
      }, {
        distanceMeters: 112,
        position: [46.2, -14, 204.4],
        facing: [1, 0],
        planningModuleCenter: [58.8, 204.4],
        planningContinuationCenter: [84, 204.4],
      }],
      bossRoom_shrineRoom: [{
        distanceMeters: 30.8,
        position: [8.4, 0, 331.8],
        facing: [0, 1],
        planningModuleCenter: [8.4, 344.4],
        planningContinuationCenter: [-8.4, 375.2],
      }, {
        distanceMeters: 64.4,
        position: [46.2, 0, 327.6],
        facing: [1, 0],
        planningModuleCenter: [58.8, 327.6],
        planningContinuationCenter: [84, 327.6],
      }, {
        distanceMeters: 81.2,
        position: [46.2, 0, 344.4],
        facing: [1, 0],
        planningModuleCenter: [58.8, 344.4],
        planningContinuationCenter: [89.6, 350],
      }],
    });

    const recoveredGrant = grantByEdgeId.get('conveyorRoom_bossRoom');
    const recoveredSnapshotConnection = host.extensionRegions[0].progressionSnapshot.connections
      .find(({ logicalEdgeId }) => logicalEdgeId === 'conveyorRoom_bossRoom');
    assert.equal(rounded(recoveredGrant.coverage.pathLengthMeters), 104.690993);
    assert.equal(
      rounded(recoveredSnapshotConnection.pathLengthMeters),
      rounded(recoveredGrant.coverage.pathLengthMeters),
    );
    assert.deepEqual(recoveredGrant.endpointSockets.map(endpointLayout), [{
      distanceMeters: 33.6,
      position: [-2.8, -14, 292.6],
      facing: [0, 1],
      planningModuleCenter: null,
      planningContinuationCenter: null,
    }, {
      distanceMeters: 84,
      position: [-54.6, 0, 291.2],
      facing: [-1, 0],
      planningModuleCenter: [-67.2, 291.2],
      planningContinuationCenter: [-92.4, 291.2],
    }]);
    assert.equal(recoveredGrant.planningRoomReservationRectangles.some(({ purpose }) => (
      purpose === 'industrial-supplement-coverage-module-egress-reservation'
    )), true);
    assert.equal(
      Object.hasOwn(recoveredGrant.endpointSockets[0], 'planningContinuationRoute'),
      false,
    );
  } finally {
    generator._disposeGeneratedDungeonCandidate(base.dungeon);
    texture.dispose();
  }
});

test('canonical seed0 direct and full replay execute the same planner search and retain accepted evidence', {
  timeout: 180_000,
}, () => {
  const {
    generator,
    texture,
    base,
    sourceRandom,
    sourceRandomCounter,
  } = createCanonicalBase(SEED_ZERO);
  try {
    assertCanonicalReplayPlanningParity({
      generator,
      base,
      sourceRandom,
      sourceRandomCounter,
    });
  } finally {
    generator._disposeGeneratedDungeonCandidate(base.dungeon);
    texture.dispose();
  }
});

test('canonical seed1 keeps a useful landmark+objective coverage partial on realization attempt one', {
  timeout: 180_000,
}, () => {
  const seeded = new SeededRandom(hashSeed(SEED_ONE));
  const sourceRandomCounter = { calls: 0 };
  const sourceRandom = () => {
    sourceRandomCounter.calls += 1;
    return seeded.next();
  };
  const generator = new DungeonGenerator({
    random: sourceRandom,
    difficulty: 1,
    augmentationProfileId: V4_PROFILE_ID,
    augmentationSeed: SEED_ONE,
    basePlanHash: `v1:${SEED_ONE}:depth:1:revolvingFusillade`,
    augmentationRealizationAttemptLimit: 1,
  });
  const texture = new THREE.Texture();
  generator.textureCache.set('seed1-attempt-one-integration-test', texture);
  generator._loadRuinTexture = () => texture;
  const originalPlanIndustrialDungeonAugmentation =
    generator._planIndustrialDungeonAugmentation;
  const originalGenerateAcceptedIndustrialDungeon =
    generator._generateAcceptedIndustrialDungeon;
  const planningResults = [];
  let sourceRandomCallsAfterParent = null;
  let dungeon = null;
  generator._generateAcceptedIndustrialDungeon = function captureParentRandomCalls(options) {
    const result = originalGenerateAcceptedIndustrialDungeon.call(this, options);
    sourceRandomCallsAfterParent = sourceRandomCounter.calls;
    return result;
  };
  generator._planIndustrialDungeonAugmentation = function capturePlanningResult(input) {
    const result = originalPlanIndustrialDungeonAugmentation.call(this, input);
    // The accepted-parent pass invokes the method with augmentation disabled;
    // its deliberate null fast path is not a planner execution.
    if (result) planningResults.push(result);
    return result;
  };

  try {
    const generationCapture = capturePlannerCandidateTrace(() => generator.generate());
    assert.ifError(generationCapture.error);
    dungeon = generationCapture.value;
    assert.ok(dungeon, 'Canonical seed1 must produce a dungeon facade.');
    assert.equal(dungeon.augmentationStatus, 'applied');
    assert.equal(dungeon.augmentationReplayDiagnostics?.accepted, true);
    assert.equal(dungeon.augmentationReplayDiagnostics?.realizationAttempts, 1);
    const runtimePruningRecords =
      dungeon.augmentationReplayDiagnostics?.runtimePruningRecords ?? [];
    assert.ok(
      runtimePruningRecords.length > 0,
      'Canonical seed1 must exercise exact same-seed conflict exclusion.',
    );
    assert.equal(
      dungeon.augmentationReplayDiagnostics?.runtimePruningPasses,
      runtimePruningRecords.length,
      'Every runtime repair pass must retain one evidence record.',
    );
    assert.equal(
      planningResults.length,
      1 + runtimePruningRecords.length,
      'Attempt one must fully replan once for each same-seed physical pruning pass.',
    );
    assert.equal(dungeon.augmentationReplayDiagnostics?.releaseValidationAccepted, true);
    assert.equal(
      dungeon.augmentationReplayDiagnostics?.consumedRandomCallCount,
      dungeon.augmentationReplayDiagnostics?.randomCallCount,
    );
    assert.equal(dungeon.progression?.validation?.accepted, true);
    assert.equal(generator.random, sourceRandom);
    assert.ok(sourceRandomCounter.calls > 0, 'Parent generation must consume the source RNG.');
    assert.equal(
      sourceRandomCounter.calls,
      sourceRandomCallsAfterParent,
      'Replay planning and realization must consume only the accepted parent tape.',
    );
    assert.equal(Object.hasOwn(generator, 'augmentationPlanSeedOverride'), false);
    assert.equal(
      Object.hasOwn(generator, 'augmentationRouteNetworkPruningOverrides'),
      false,
    );
    assert.equal(
      Object.hasOwn(generator, 'augmentationRouteNetworkConflictExclusions'),
      false,
      'The temporary exact-conflict exclusion property must be restored after replay.',
    );
    assert.equal(
      Object.hasOwn(generator, '_augmentationReplayPlanningSnapshotOverride'),
      false,
    );

    const planningResult = planningResults.at(-1);
    assert.equal(planningResult.status, 'applied');
    const acceptedEvidence = createAcceptedPlanningEvidence(
      planningResult,
      generationCapture.candidateTrace,
    );
    assert.equal(acceptedEvidence.status, 'applied');
    assert.equal(acceptedEvidence.augmentationPlanHash, dungeon.augmentationPlanHash);

    const overlayPlan = planningResult.result.overlayPlan;
    const realizedOperations = routeNetworkOperations(planningResult);
    const prunedGrants = overlayPlan.prunedRouteNetworkGrants ?? [];
    assert.deepEqual(
      overlayPlan.routeNetworkPruningOverrides ?? [],
      [],
      'Exact entity repair must not serialize a whole-grant pruning override.',
    );
    const normalizedRuntimeExclusions = normalizeRouteNetworkConflictExclusions(
      runtimePruningRecords.flatMap(({ excludedRouteNetworkEntities }) => (
        excludedRouteNetworkEntities ?? []
      )),
    );
    for (const record of runtimePruningRecords) {
      assert.equal(record.recoveryKind, 'exact-conflict-entity-exclusion');
      assert.deepEqual(record.prunedRouteNetworkGrantIds ?? [], []);
      const rawExclusions = record.excludedRouteNetworkEntities ?? [];
      const normalizedExclusions = normalizeRouteNetworkConflictExclusions(rawExclusions);
      assert.ok(
        normalizedExclusions.length > 0,
        'Every exact repair pass must identify at least one conflicting entity.',
      );
      assert.equal(
        normalizedExclusions.length,
        rawExclusions.length,
        'Every runtime exclusion must carry a valid grant, entity, and signature.',
      );
      for (const exclusion of normalizedExclusions) {
        assert.ok(['node', 'segment'].includes(exclusion.entityKind));
        assert.ok(exclusion.grantId.length > 0);
        assert.ok(exclusion.entityId.length > 0);
        assert.match(exclusion.signature, /^v1-[0-9a-f]+$/);
        assert.ok(exclusion.reason.length > 0);
      }
    }
    const normalizedOverlayExclusions = normalizeRouteNetworkConflictExclusions(
      overlayPlan.routeNetworkConflictExclusions ?? [],
    );
    assert.deepEqual(
      normalizedRuntimeExclusions,
      normalizedOverlayExclusions,
      'The accepted overlay must serialize exactly the normalized runtime exclusions.',
    );
    assert.ok(
      realizedOperations.length >= 2 && realizedOperations.length <= 8,
      'The accepted partial must retain a useful bounded set of route networks.',
    );
    assert.ok(realizedOperations.some(({ routeNetworkKind }) => (
      routeNetworkKind === 'landmark-perimeter-loop'
    )));
    assert.ok(realizedOperations.some(({ routeNetworkKind }) => (
      routeNetworkKind === 'objective-route-coverage'
    )));
    const requiredGrants = planningResult.host.extensionRegions.flatMap((region) => (
      (region.routeNetworkGrants ?? []).map((grant) => ({ region, grant }))
    )).filter(({ grant }) => grant.required === true);
    const requiredGrantIds = new Set(requiredGrants.map(({ grant }) => grant.id));
    const realizedRequiredOperations = realizedOperations.filter(({ grantId }) => (
      requiredGrantIds.has(grantId)
    ));

    assert.equal(overlayPlan.completionMode, 'best-effort-partial');
    assert.ok(prunedGrants.length > 0, 'Seed1 must exercise the partial-pruning ledger.');
    assert.equal(
      new Set(prunedGrants.map(({ grantId }) => grantId)).size,
      prunedGrants.length,
      'A pruned required grant must appear in the ledger exactly once.',
    );
    assert.equal(
      realizedRequiredOperations.length + prunedGrants.length,
      requiredGrants.length,
      'Required grants must be completely partitioned between realization and pruning.',
    );
    for (const { region, grant } of requiredGrants) {
      const realizedMatches = realizedRequiredOperations.filter(({ grantId }) => (
        grantId === grant.id
      ));
      const prunedMatches = prunedGrants.filter(({ grantId }) => grantId === grant.id);
      assert.equal(
        realizedMatches.length + prunedMatches.length,
        1,
        `Required grant ${grant.id} must be realized or pruned, never both or neither.`,
      );
      if (prunedMatches.length === 1) {
        assert.equal(prunedMatches[0].parentRegionId, region.id);
        assert.equal(prunedMatches[0].routeNetworkKind, grant.kind);
        assert.ok(
          typeof prunedMatches[0].reason === 'string' && prunedMatches[0].reason.length > 0,
          `Pruned grant ${grant.id} must retain its deterministic conflict reason.`,
        );
      }
    }
    assert.equal(
      prunedGrants.every(({ grantId }) => requiredGrantIds.has(grantId)),
      true,
      'The pruning ledger must not contain grants outside the required host contract.',
    );
    const prunedGrantIds = new Set(prunedGrants.map(({ grantId }) => grantId));
    const exactExclusionGrantIds = new Set(normalizedRuntimeExclusions.map(({ grantId }) => (
      grantId
    )));
    for (const grantId of exactExclusionGrantIds) {
      assert.equal(
        prunedGrantIds.has(grantId),
        false,
        `Exact entity exclusion for ${grantId} must not remove its entire network.`,
      );
    }
    const conveyorBossGrant = requiredGrants.find(({ grant }) => (
      grant.coverage?.logicalEdgeId === 'conveyorRoom_bossRoom'
    ))?.grant;
    assert.ok(conveyorBossGrant, 'The canonical host must retain its conveyor-to-boss grant.');
    assert.ok(
      realizedRequiredOperations.some(({ grantId }) => grantId === conveyorBossGrant.id),
      'The conveyor-to-boss objective coverage network must remain realized.',
    );
    assert.equal(
      prunedGrantIds.has(conveyorBossGrant.id),
      false,
      'The conveyor-to-boss objective coverage grant must be absent from the prune ledger.',
    );

    const retainedLandmark = realizedOperations.find(({ routeNetworkKind }) => (
      routeNetworkKind === 'landmark-perimeter-loop'
    ));
    assert.ok(
      retainedLandmark,
      'A conflicting coverage module must not discard the valid pyramid landmark network.',
    );
    assert.ok(
      overlayPlan.nodes.some(({ operationId }) => operationId === retainedLandmark.id),
      'The retained pyramid network must keep its physical module nodes.',
    );
    assert.ok(
      overlayPlan.segments.some(({ operationId }) => operationId === retainedLandmark.id),
      'The retained pyramid network must keep its physical connector segments.',
    );

    assert.equal(planningResult.baseDraft.basePlanHash, generator.basePlanHash);
    assert.equal(overlayPlan.basePlanHash, planningResult.baseDraft.basePlanHash);
    assert.equal(dungeon.basePlanHash, overlayPlan.basePlanHash);
    assert.equal(dungeon.augmentationPlanHash, overlayPlan.augmentationPlanHash);
    assert.equal(dungeon.effectivePlanHash, overlayPlan.effectivePlanHash);
    assert.match(dungeon.augmentationPlanHash, /^v1-[0-9a-f]+$/);
    assert.match(dungeon.effectivePlanHash, /^v1-[0-9a-f]+$/);
    assert.notEqual(dungeon.effectivePlanHash, dungeon.basePlanHash);

    assert.equal(dungeon.augmentationPhysicalShell?.authoritative, true);
    assert.equal(dungeon.augmentationPhysicalShell?.preRender, true);
    assert.ok(dungeon.dungeonSupplementRoot, 'Applied partial geometry must keep its supplement root.');
    assert.equal(dungeon.augmentationMetrics?.operationCount, realizedOperations.length);
    assert.ok(dungeon.augmentationMetrics?.roomCount > 0);
    assert.ok(dungeon.augmentationMetrics?.physicalConnectionCount > 0);
    assert.ok(dungeon.augmentationMetrics?.tileCount > 0);
    assert.ok(dungeon.augmentationMetrics?.meshCount > 0);
  } finally {
    generator._generateAcceptedIndustrialDungeon =
      originalGenerateAcceptedIndustrialDungeon;
    generator._planIndustrialDungeonAugmentation =
      originalPlanIndustrialDungeonAugmentation;
    generator._disposeGeneratedDungeonCandidate(dungeon);
    texture.dispose();
  }
});

test('Industrial coverage allocation rejects an independently empty route domain with evidence', () => {
  const rooms = [{
    id: 'conveyorRoom', x: 0, z: 0, width: 5, depth: 5, baseElevation: 0,
  }, {
    id: 'bossRoom', x: 40, z: 0, width: 5, depth: 5, baseElevation: 0,
  }, {
    id: 'authoredBlocker', x: 20, z: 0, width: 200, depth: 200, baseElevation: 0,
  }];
  const connectionPlans = [{
    id: 'conveyorRoom_bossRoom_ground',
    logicalConnectionId: 'conveyorRoom_bossRoom',
    fromRoomId: 'conveyorRoom',
    toRoomId: 'bossRoom',
    level: 0,
    elevation: 0,
    fromSocket: { x: 0, z: 0, elevation: 0, facingX: 1, facingZ: 0 },
    toSocket: { x: 40, z: 0, elevation: 0, facingX: -1, facingZ: 0 },
    fullPath: Array.from({ length: 41 }, (_, x) => ({ x, z: 0 })),
  }];
  const baseDraft = createIndustrialBaseDraft({
    rooms,
    connectionPlans,
    basePlanHash: 'coverage-allocation-empty-domain',
    tileSize: TILE_SIZE,
  });

  assert.throws(() => createIndustrialAugmentationHost({
    baseDraft,
    rooms,
    connectionPlans,
    tileSize: TILE_SIZE,
  }), (error) => {
    assert.equal(error.code, 'industrial-objective-route-coverage-allocation-failed');
    assert.equal(error.name, 'IndustrialCoverageGrantAllocationError');
    assert.deepEqual(error.coverageGrantAllocationEvidence.missingRouteIds, [
      'conveyorRoom_bossRoom',
    ]);
    const [routeEvidence] = error.coverageGrantAllocationEvidence.requiredRoutes;
    assert.equal(routeEvidence.edgeId, 'conveyorRoom_bossRoom');
    assert.equal(routeEvidence.independentGrantDomainSize, 0);
    assert.equal(
      routeEvidence.independentFailureEvidence.reason,
      'coverage-route-station-layout-domain-empty',
    );
    return true;
  });
});
