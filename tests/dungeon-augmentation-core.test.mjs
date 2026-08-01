import assert from 'node:assert/strict';
import test from 'node:test';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
import {
  DUNGEON_AUGMENTATION_OVERLAY_SCHEMA,
  DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA,
  DUNGEON_EXTENSION_HOST_V2_SCHEMA,
  DUNGEON_PROGRESSION_SNAPSHOT_V2_SCHEMA,
  DUNGEON_ROUTE_NETWORK_GRANT_V2_SCHEMA,
  DUNGEON_SELECTION_BAG_FAMILIES,
  DUNGEON_AUGMENTATION_SAVE_IDENTITY_SCHEMA,
  DUNGEON_AUGMENTATION_PROFILES,
  GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  DungeonAugmentationRandom,
  augmentDungeonDraft,
  canonicalStringify,
  computeDungeonAugmentationPlanHash,
  computeEffectiveDungeonPlanHash,
  createDungeonAugmentationProfile,
  createDungeonSelectionBag,
  createDungeonAugmentationSaveIdentity,
  createDungeonRouteEndpointSeam,
  createIndustrialAugmentationHost,
  createIndustrialBaseDraft,
  dungeonVolumesOverlap,
  dungeonSelectionBagCandidates,
  hashCanonicalValue,
  materializeIndustrialOverlay,
  sanitizeDungeonAugmentationSaveIdentity,
  validateCommittedDungeonAugmentationIdentity,
  validateDungeonExtensionHost,
  validateDungeonAugmentationPlan,
  validateDungeonSelectionBagWitnessSequence,
} from '../src/dungeon-augmentation/index.js';

const SOURCE_THEME = Object.freeze({
  schema: 'ruindivex-dungeon-region-theme/v1',
  parentMapId: 'fixture-map',
  parentMapRevision: 'fixture-map-r1',
  parentRegionId: 'fixture-region',
  themeRef: { id: 'fixture-theme', revision: 'theme-r1', contentHash: 'fixture-content-a' },
  presentationVariantId: 'fixture-main',
  localLightingProfileId: 'fixture-lights',
  soundscapeProfileId: 'fixture-ambience',
});

const DESTINATION_THEME = Object.freeze({
  schema: 'ruindivex-dungeon-region-theme/v1',
  parentMapId: 'fixture-map',
  parentMapRevision: 'fixture-map-r1',
  parentRegionId: 'fixture-magma-region',
  themeRef: { id: 'fixture-magma', revision: 'magma-r3', contentHash: 'fixture-content-b' },
  presentationVariantId: 'fixture-magma-main',
  localLightingProfileId: 'fixture-magma-lights',
  soundscapeProfileId: 'fixture-magma-ambience',
});

const COMPLETE_CAPABILITIES = Object.freeze({
  materials: [
    'primary-floor', 'corridor-floor', 'wall', 'ceiling', 'support', 'cap',
    'catwalk', 'rail', 'ramp', 'warning',
  ],
  assets: ['frame', 'hazard', 'light-fixture', 'transition-frame'],
  connectors: ['service-gallery', 'slope', 'ladder', 'lift', 'transition-bay'],
  transitions: ['level-transition-bay'],
});

const requestedVerificationSeedCount = Number.parseInt(
  process.env.DUNGEON_AUGMENTATION_SEED_COUNT ?? '100',
  10,
);
const VERIFICATION_SEED_COUNT = Number.isFinite(requestedVerificationSeedCount)
  && requestedVerificationSeedCount >= 100
  ? requestedVerificationSeedCount
  : 100;

test('V4 endpoint seams quantize half-grid thresholds once for every cardinal facing', () => {
  const tileSize = 2.8;
  const facings = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
  ];
  const cases = facings.flatMap((facing, facingIndex) => (
    [-1, 1].map((thresholdSign) => {
      const normalAlongX = Math.abs(facing.x) > 0.5;
      return {
        facing,
        facingIndex,
        thresholdSign,
        position: normalAlongX
          ? { x: thresholdSign * 29.4, y: 14, z: thresholdSign * -18.2 }
          : { x: thresholdSign * -18.2, y: 14, z: thresholdSign * 29.4 },
      };
    })
  ));
  for (const [index, {
    facing,
    facingIndex,
    thresholdSign,
    position,
  }] of cases.entries()) {
    const seam = createDungeonRouteEndpointSeam({
      id: `socket-${index}`,
      nodeId: `node-${index}`,
      position,
      facing,
    }, {
      id: `segment-${index}:from-endpoint-seam`,
      segmentId: `segment-${index}`,
      operationId: 'operation-0',
      networkId: 'operation-0',
      role: 'from',
      elevationBand: 2,
    });
    assert.equal(seam.schema, 'ruindivex-dungeon-route-endpoint-seam/v1');
    assert.equal(seam.widthTiles, 3);
    assert.equal(seam.depthTiles, 5);
    assert.equal(seam.orderedCells.length, 15);
    assert.deepEqual(
      [...new Set(seam.orderedCells.map(({ lane }) => lane))],
      [-1, 0, 1],
    );
    assert.deepEqual(
      [...new Set(seam.orderedCells.map(({ signedDepthTiles }) => signedDepthTiles))],
      [-2, -1, 0, 1, 2],
    );
    assert.equal(seam.orderedCells[0].signedDepthTiles, -2);
    assert.equal(seam.orderedCells[0].lane, -1);
    assert.equal(seam.orderedCells.at(-1).signedDepthTiles, 2);
    assert.equal(seam.orderedCells.at(-1).lane, 1);
    const cellKeys = seam.orderedCells.map(({ gridX, gridZ }) => `${gridX},${gridZ}`);
    assert.equal(
      new Set(cellKeys).size,
      15,
      `facing ${facingIndex}, threshold sign ${thresholdSign}: ${cellKeys.join(' ')}`,
    );
    const thresholdGridX = Math.round(position.x / tileSize);
    const thresholdGridZ = Math.round(position.z / tileSize);
    const lateral = { x: -facing.z, z: facing.x };
    const cellsByLocalIdentity = new Map(seam.orderedCells.map((cell) => (
      [`${cell.signedDepthTiles}:${cell.lane}`, cell]
    )));
    for (let signedDepthTiles = -2; signedDepthTiles <= 2; signedDepthTiles += 1) {
      for (let lane = -1; lane <= 1; lane += 1) {
        const cell = cellsByLocalIdentity.get(`${signedDepthTiles}:${lane}`);
        assert.ok(cell);
        assert.deepEqual(
          { gridX: cell.gridX, gridZ: cell.gridZ },
          {
            gridX: thresholdGridX + facing.x * signedDepthTiles + lateral.x * lane,
            gridZ: thresholdGridZ + facing.z * signedDepthTiles + lateral.z * lane,
          },
          `facing ${facingIndex}, threshold sign ${thresholdSign}, cell ${signedDepthTiles}:${lane}`,
        );
        assert.deepEqual(cell.position, {
          x: Number((position.x
            + facing.x * signedDepthTiles * tileSize
            + lateral.x * lane * tileSize).toFixed(6)),
          y: position.y,
          z: Number((position.z
            + facing.z * signedDepthTiles * tileSize
            + lateral.z * lane * tileSize).toFixed(6)),
        });
        if (lane < 1) {
          const nextLane = cellsByLocalIdentity.get(`${signedDepthTiles}:${lane + 1}`);
          assert.equal(
            Math.abs(cell.gridX - nextLane.gridX) + Math.abs(cell.gridZ - nextLane.gridZ),
            1,
          );
        }
        if (signedDepthTiles < 2) {
          const nextDepth = cellsByLocalIdentity.get(`${signedDepthTiles + 1}:${lane}`);
          assert.equal(
            Math.abs(cell.gridX - nextDepth.gridX) + Math.abs(cell.gridZ - nextDepth.gridZ),
            1,
          );
        }
      }
    }
    const normalAlongX = Math.abs(facing.x) > 0.5;
    assert.deepEqual(seam.overlapEnvelope.size, {
      x: normalAlongX ? 14 : 8.4,
      y: 5.6,
      z: normalAlongX ? 8.4 : 14,
    });
    assert.deepEqual(seam.ownerIds, {
      seamId: seam.id,
      segmentId: `segment-${index}`,
      nodeId: `node-${index}`,
      socketId: `socket-${index}`,
    });
  }
});

test('V4 immutable selection bags preserve shuffle order and failed branches', () => {
  const bag = createDungeonSelectionBag({
    shuffle: (ids) => [...ids].reverse(),
  }, ['beta', 'alpha', 'gamma', 'beta']);
  assert.deepEqual(bag, {
    order: ['gamma', 'beta', 'alpha'],
    cycle: 0,
    consumedIds: [],
  });
  const parentSnapshot = structuredClone(bag);
  const candidates = dungeonSelectionBagCandidates(bag, ['alpha', 'gamma']);
  assert.deepEqual(candidates.map(({ id }) => id), ['gamma', 'alpha']);
  assert.deepEqual(bag, parentSnapshot);
  assert.deepEqual(
    dungeonSelectionBagCandidates(bag, ['alpha', 'gamma']).map(({ id }) => id),
    ['gamma', 'alpha'],
  );

  const afterGamma = candidates[0].state;
  const afterAlpha = dungeonSelectionBagCandidates(afterGamma, ['alpha', 'gamma'])
    .find(({ id }) => id === 'alpha').state;
  const refilled = dungeonSelectionBagCandidates(afterAlpha, ['alpha', 'gamma']);
  assert.equal(refilled.every(({ refilled: didRefill }) => didRefill), true);
  assert.equal(refilled[0].state.cycle, 1);
});

test('V4 selection bags isolate overlapping legal compatibility domains', () => {
  const bag = createDungeonSelectionBag({ shuffle: (ids) => ids }, ['a', 'b', 'c']);
  const parentSnapshot = structuredClone(bag);
  const challengeA = dungeonSelectionBagCandidates(bag, ['a', 'b'])[0];
  assert.equal(challengeA.id, 'a');
  // Enumerating and discarding a branch cannot consume its choice.
  assert.deepEqual(bag, parentSnapshot);
  assert.equal(dungeonSelectionBagCandidates(bag, ['a', 'b'])[0].id, 'a');

  const rewardB = dungeonSelectionBagCandidates(challengeA.state, ['b', 'c'])[0];
  assert.equal(rewardB.id, 'b');
  const challengeB = dungeonSelectionBagCandidates(rewardB.state, ['a', 'b'])[0];
  assert.equal(challengeB.id, 'b');
  const rewardC = dungeonSelectionBagCandidates(challengeB.state, ['b', 'c'])[0];
  assert.equal(rewardC.id, 'c');

  const refilledChallenge = dungeonSelectionBagCandidates(
    rewardC.state,
    ['b', 'a'],
  );
  assert.equal(refilledChallenge.every(({ refilled }) => refilled), true);
  assert.deepEqual(refilledChallenge.map(({ id }) => id), ['a', 'b']);
  assert.equal(refilledChallenge[0].state.cycle, 1);
  // Refilling A/B never releases B early in the overlapping B/C domain.
  assert.equal(
    dungeonSelectionBagCandidates(refilledChallenge[0].state, ['b', 'c'])[0].id,
    'b',
  );
});

test('V4 selection bag RNG families are isolated and replayable', () => {
  const root = new DungeonAugmentationRandom('selection-bag-replay');
  const first = createDungeonSelectionBag(root.fork('topology'), ['a', 'b', 'c']);
  root.fork('encounter').next();
  root.fork('encounter').next();
  const replayed = createDungeonSelectionBag(root.fork('topology'), ['a', 'b', 'c']);
  assert.deepEqual(first, replayed);
  assert.notDeepEqual(
    first.order,
    createDungeonSelectionBag(root.fork('room-layout'), ['a', 'b', 'c']).order,
  );
});

function makeFixture({
  profileId = 'industrial-supplement-preview-v1',
  crossTheme = false,
  includeCapabilities = true,
  delegatedProgressionBeats = [],
} = {}) {
  const baseDraft = {
    schema: 'fixture-base-draft/v1',
    basePlanHash: 'fixture-base-plan-v1',
    rooms: [{
      id: 'far-authored-room',
      occupiedVolumes: [{
        id: 'far-authored-room:body',
        center: { x: 0, y: 2.8, z: 160 },
        size: { x: 20, y: 5.6, z: 20 },
      }],
    }],
    occupiedVolumes: [],
    protectedVolumes: [],
    connectionPlans: [{ id: 'legacy-edge-record', untouched: true }],
    progression: { keys: ['alpha'], gates: ['alpha-door'] },
  };
  const extensionRegion = {
    id: 'fixture-region',
    themeBinding: SOURCE_THEME,
    attachmentSockets: [{
      id: 'fixture-branch-socket',
      nodeId: 'authored-side-room',
      position: { x: -80, y: 0, z: -80 },
      facing: { x: 0, y: 0, z: -1 },
      widthMeters: 8.4,
      heightMeters: 5.6,
      availableDepthMeters: 160,
      connectorFamilies: ['service-gallery'],
    }],
    spliceEdges: [{
      id: 'fixture-splice-edge',
      logicalEdgeId: 'authored-a_authored-b',
      gateId: 'alpha-door',
      credentialRequirement: 'alpha',
      progressionTier: 2,
      dominanceBoundary: 'alpha-door:deeper-side',
      connectorFamilies: ['service-gallery'],
      availableLengthMeters: 120,
      path: [
        { x: -60, y: 0, z: 0 },
        { x: 60, y: 0, z: 0 },
      ],
      from: {
        nodeId: 'authored-a',
        socketId: 'authored-a:exit',
        position: { x: -60, y: 0, z: 0 },
        facing: { x: 1, y: 0, z: 0 },
      },
      to: {
        nodeId: 'authored-b',
        socketId: 'authored-b:entry',
        position: { x: 60, y: 0, z: 0 },
        facing: { x: -1, y: 0, z: 0 },
      },
      sourceThemeBinding: SOURCE_THEME,
      destinationThemeBinding: crossTheme ? DESTINATION_THEME : SOURCE_THEME,
    }],
    allowedProfileIds: [profileId],
    delegatedProgressionBeats,
    ...(includeCapabilities ? { themeCapabilities: COMPLETE_CAPABILITIES } : {}),
  };
  return {
    baseDraft,
    extensionRegions: [extensionRegion],
    themeCapabilitiesByRegionId: crossTheme
      ? { 'fixture-magma-region': COMPLETE_CAPABILITIES }
      : {},
  };
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function assertRendererFree(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) {
    assert.notEqual(typeof child, 'function');
    assertRendererFree(child, seen);
  }
}

test('canonical hashing is stable across key order and rejects renderer-owned values', () => {
  const first = { z: 3, nested: { beta: true, alpha: [1, undefined, -0] }, a: 'value' };
  const second = { a: 'value', nested: { alpha: [1, null, 0], beta: true }, z: 3 };
  assert.equal(canonicalStringify(first), canonicalStringify(second));
  assert.equal(hashCanonicalValue(first), hashCanonicalValue(second));
  assert.match(hashCanonicalValue(first), /^v1-[a-f0-9]{32}$/);
  assert.throws(() => canonicalStringify({ assemble() {} }), /Unsupported function/);
});

test('labeled RNG forks are deterministic and isolated from sibling consumption', () => {
  const root = new DungeonAugmentationRandom('fork-isolation');
  const topologyBefore = root.fork('topology').next();
  const dressing = root.fork('dressing');
  for (let index = 0; index < 100; index += 1) dressing.next();
  const topologyAfter = root.fork('topology').next();
  assert.equal(topologyBefore, topologyAfter);
  assert.notEqual(root.fork('topology').next(), root.fork('progression').next());
});

test('an explicit augmentation seed deterministically controls the isolated overlay stream', () => {
  const fixture = makeFixture();
  const options = {
    ...fixture,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'parent-layout-seed',
    difficulty: 2,
  };
  const first = augmentDungeonDraft({
    ...options,
    augmentationSeed: 'explicit-overlay-seed',
  });
  const repeated = augmentDungeonDraft({
    ...options,
    augmentationSeed: 'explicit-overlay-seed',
  });
  const alternate = augmentDungeonDraft({
    ...options,
    augmentationSeed: 'alternate-overlay-seed',
  });

  assert.equal(first.status, 'applied');
  assert.equal(repeated.status, 'applied');
  assert.equal(alternate.status, 'applied');
  assert.equal(first.overlayPlan.augmentationSeed, 'explicit-overlay-seed');
  assert.deepEqual(repeated.overlayPlan, first.overlayPlan);
  assert.notEqual(
    alternate.overlayPlan.augmentationPlanHash,
    first.overlayPlan.augmentationPlanHash,
  );
});

test(`${VERIFICATION_SEED_COUNT} legacy seeds preserve the exact base for absent, disabled, and rejected augmentation`, () => {
  const disabledProfile = createDungeonAugmentationProfile({
    id: 'fixture-disabled-v1',
    enabled: false,
  });
  const legacyRandomSpy = {
    calls: 0,
    next() {
      this.calls += 1;
      return 0.5;
    },
  };
  for (let index = 0; index < VERIFICATION_SEED_COUNT; index += 1) {
    const fixture = makeFixture();
    const baseReference = fixture.baseDraft;
    const roomReference = baseReference.rooms;
    const connectionReference = baseReference.connectionPlans;
    const before = canonicalStringify(baseReference);
    const beforeHash = hashCanonicalValue(baseReference);
    const absent = augmentDungeonDraft({
      baseDraft: baseReference,
      layoutSeed: `legacy:${index}`,
      legacyRandom: legacyRandomSpy,
    });
    const disabled = augmentDungeonDraft({
      baseDraft: baseReference,
      extensionRegions: fixture.extensionRegions,
      profileId: disabledProfile.id,
      profiles: { [disabledProfile.id]: disabledProfile },
      layoutSeed: `legacy:${index}`,
      legacyRandom: legacyRandomSpy,
    });
    const rejectedFixture = makeFixture({ includeCapabilities: false });
    const rejected = augmentDungeonDraft({
      ...rejectedFixture,
      baseDraft: baseReference,
      profileId: 'industrial-supplement-preview-v1',
      layoutSeed: `legacy:${index}`,
      legacyRandom: legacyRandomSpy,
    });
    for (const result of [absent, disabled, rejected]) {
      assert.equal(result.status, 'unchanged');
      assert.equal(result.effectiveDraft, baseReference);
      assert.equal(result.overlayPlan, null);
    }
    assert.equal(absent.diagnostics.reason, 'augmentation-disabled');
    assert.equal(disabled.diagnostics.reason, 'augmentation-disabled');
    assert.equal(rejected.diagnostics.reason, 'validation-failed');
    assert.equal(baseReference.rooms, roomReference);
    assert.equal(baseReference.connectionPlans, connectionReference);
    assert.equal(canonicalStringify(baseReference), before);
    assert.equal(hashCanonicalValue(baseReference), beforeHash);
  }
  assert.equal(legacyRandomSpy.calls, 0);
});

test(`${VERIFICATION_SEED_COUNT} Industrial generator hooks leave the legacy RNG untouched when disabled or rejected`, () => {
  for (let index = 0; index < VERIFICATION_SEED_COUNT; index += 1) {
    const disabledRandom = { calls: 0, next() { this.calls += 1; return 0.5; } };
    const disabledGenerator = new DungeonGenerator({
      random: () => disabledRandom.next(),
      basePlanHash: `industrial-hook:${index}`,
      augmentationSeed: `industrial-hook:${index}`,
    });
    assert.equal(disabledGenerator._planIndustrialDungeonAugmentation({ rooms: [], connectionPlans: [] }), null);
    assert.equal(disabledRandom.calls, 0);

    const rejectedRandom = { calls: 0, next() { this.calls += 1; return 0.5; } };
    const rejectedGenerator = new DungeonGenerator({
      random: () => rejectedRandom.next(),
      basePlanHash: `industrial-hook:${index}`,
      augmentationSeed: `industrial-hook:${index}`,
      augmentationProfileId: 'industrial-supplement-preview-v1',
    });
    const rejected = rejectedGenerator._planIndustrialDungeonAugmentation({
      rooms: [],
      connectionPlans: [],
    });
    assert.equal(rejected.status, 'unchanged');
    assert.equal(rejected.result.effectiveDraft, rejected.baseDraft);
    assert.equal(rejectedRandom.calls, 0);
  }
});

test('missing parent theme capabilities and bindings stop realization after one attempt', () => {
  for (const failureCode of [
    'MISSING_THEME_CAPABILITY',
    'MISSING_PARENT_THEME_SESSION',
    'INVALID_THEME_MATERIAL',
    'THEME_ASSET_CREATION_FAILED',
    'THEME_CONNECTOR_CREATION_FAILED',
    'invalid-theme-binding',
  ]) {
    let realizationCalls = 0;
    const generator = new DungeonGenerator({
      random: () => 0.5,
      basePlanHash: `base:non-retryable-theme:${failureCode}`,
      augmentationSeed: `augmentation:non-retryable-theme:${failureCode}`,
      augmentationProfileId: 'industrial-supplement-preview-v4',
    });
    generator._generateAcceptedIndustrialDungeon = () => ({
      dungeon: {
        basePlanHash: generator.basePlanHash,
        generationAttempts: 1,
        progression: { validation: { accepted: true, errors: [] } },
      },
      randomTape: [],
    });
    generator._generateOnce = () => {
      realizationCalls += 1;
      const error = new Error(`Missing deterministic theme content: ${failureCode}`);
      error.code = failureCode;
      throw error;
    };

    const dungeon = generator._generateIndustrialDungeonWithAugmentationReplay();
    assert.equal(realizationCalls, 1, failureCode);
    assert.equal(dungeon.augmentationStatus, 'unchanged');
    assert.equal(
      dungeon.augmentationDiagnostics.reason,
      'theme-capability-or-binding-unavailable',
    );
    assert.equal(dungeon.augmentationDiagnostics.nonRetryable, true);
    assert.equal(dungeon.augmentationReplayDiagnostics.realizationAttempts, 1);
    assert.equal(
      dungeon.augmentationDiagnostics.rejectedOverlay.attempts[0].failureCode,
      failureCode,
    );
    assert.equal(
      dungeon.augmentationDiagnostics.rejectedOverlay.attempts[0].failureCategory,
      'theme-capability-or-binding',
    );
  }

  let geometryRealizationCalls = 0;
  const retryableGenerator = new DungeonGenerator({
    random: () => 0.5,
    basePlanHash: 'base:retryable-geometry-failure',
    augmentationSeed: 'augmentation:retryable-geometry-failure',
    augmentationProfileId: 'industrial-supplement-preview-v4',
  });
  retryableGenerator._generateAcceptedIndustrialDungeon = () => ({
    dungeon: {
      basePlanHash: retryableGenerator.basePlanHash,
      generationAttempts: 1,
      progression: { validation: { accepted: true, errors: [] } },
    },
    randomTape: [],
  });
  retryableGenerator._generateOnce = () => {
    geometryRealizationCalls += 1;
    const error = new Error('Seed-dependent supplemental geometry collision.');
    error.code = 'INVALID_SUPPLEMENT_STRUCTURE_RAMP';
    throw error;
  };
  const retryableFallback = retryableGenerator
    ._generateIndustrialDungeonWithAugmentationReplay();
  assert.equal(geometryRealizationCalls, 8);
  assert.equal(retryableFallback.augmentationDiagnostics.nonRetryable, false);
  assert.equal(
    retryableFallback.augmentationDiagnostics.reason,
    'physical-validation-fallback',
  );
});

test('invalid augmentation preview acceptance requires both explicit opt-in and the V4 profile', () => {
  const runInvalidReplay = ({
    profileId = 'industrial-supplement-preview-v4',
    allowInvalidAugmentationPreview = false,
  } = {}) => {
    let realizationCalls = 0;
    const collisionDerivedDiagnostics = {
      schema: 'ruindivex-dungeon-augmentation-diagnostics/v1',
      accepted: false,
      errors: [{
        code: 'supplemental-floor-non-returnable',
        message: 'Synthetic collision-derived release failure.',
      }],
      traversal: {
        graphKind: 'collision-derived',
        blockedFloorIds: ['supplement:test:floor:blocked'],
      },
    };
    const generator = new DungeonGenerator({
      random: () => 0.5,
      basePlanHash: `base:explicit-alpha-gate:${profileId}`,
      augmentationSeed: `augmentation:explicit-alpha-gate:${profileId}`,
      augmentationProfileId: profileId,
      allowInvalidAugmentationPreview,
    });
    generator._generateAcceptedIndustrialDungeon = () => ({
      dungeon: {
        basePlanHash: generator.basePlanHash,
        generationAttempts: 1,
        progression: { validation: { accepted: true, errors: [] } },
      },
      randomTape: [],
    });
    generator._generateOnce = () => {
      realizationCalls += 1;
      return {
        augmentationStatus: 'applied',
        augmentationDiagnostics: structuredClone(collisionDerivedDiagnostics),
        progression: {
          validation: {
            accepted: false,
            errors: ['Synthetic collision-derived release failure.'],
          },
        },
      };
    };
    generator._finalizeAcceptedIndustrialDungeon = (dungeon) => dungeon;
    generator._disposeGeneratedDungeonCandidate = () => {};
    return {
      dungeon: generator._generateIndustrialDungeonWithAugmentationReplay(),
      realizationCalls,
      collisionDerivedDiagnostics,
    };
  };

  const ordinaryV4 = runInvalidReplay();
  assert.equal(ordinaryV4.realizationCalls, 8);
  assert.equal(ordinaryV4.dungeon.augmentationStatus, 'unchanged');
  assert.equal(ordinaryV4.dungeon.augmentationReplayDiagnostics.fallbackToAcceptedBase, true);

  const explicitV4Alpha = runInvalidReplay({ allowInvalidAugmentationPreview: true });
  assert.equal(explicitV4Alpha.realizationCalls, 1);
  assert.equal(explicitV4Alpha.dungeon.augmentationStatus, 'applied');
  assert.equal(explicitV4Alpha.dungeon.augmentationPlayableAlpha.accepted, true);
  assert.equal(explicitV4Alpha.dungeon.augmentationReplayDiagnostics.acceptedAsPlayableAlpha, true);
  assert.equal(explicitV4Alpha.dungeon.augmentationReplayDiagnostics.releaseValidationAccepted, false);
  const { warnings: _alphaWarnings, ...alphaValidationDiagnostics } =
    explicitV4Alpha.dungeon.augmentationDiagnostics;
  const ordinaryValidationDiagnostics = ordinaryV4.dungeon
    .augmentationDiagnostics.rejectedOverlay.attempts[0].diagnostics;
  assert.equal(
    JSON.stringify(alphaValidationDiagnostics),
    JSON.stringify(ordinaryValidationDiagnostics),
    'Alpha acceptance may append a warning but must not rewrite release diagnostics.',
  );
  assert.deepEqual(
    alphaValidationDiagnostics,
    explicitV4Alpha.collisionDerivedDiagnostics,
  );

  const legacyProfile = runInvalidReplay({
    profileId: 'industrial-supplement-preview-v3',
    allowInvalidAugmentationPreview: true,
  });
  assert.equal(legacyProfile.realizationCalls, 8);
  assert.equal(legacyProfile.dungeon.augmentationStatus, 'unchanged');
  assert.equal(legacyProfile.dungeon.augmentationPlayableAlpha, undefined);
});

test(`${VERIFICATION_SEED_COUNT} augmentation seeds are deterministic, immutable, namespaced, and within profile budgets`, () => {
  const planHashes = new Set();
  const structuralSignatures = new Set();
  for (let index = 0; index < VERIFICATION_SEED_COUNT; index += 1) {
    const fixture = makeFixture();
    const before = canonicalStringify(fixture.baseDraft);
    const options = {
      ...fixture,
      profileId: 'industrial-supplement-preview-v1',
      layoutSeed: `augmentation:${index}`,
      difficulty: 2,
    };
    const first = augmentDungeonDraft(options);
    const second = augmentDungeonDraft(options);
    assert.equal(first.status, 'applied', JSON.stringify({
      index,
      layoutSeed: options.layoutSeed,
      errors: first.diagnostics.errors,
    }));
    assert.deepEqual(first.overlayPlan, second.overlayPlan);
    assert.equal(first.overlayPlan.schema, DUNGEON_AUGMENTATION_OVERLAY_SCHEMA);
    assert.equal(first.overlayPlan.augmentationPlanHash, computeDungeonAugmentationPlanHash(first.overlayPlan));
    assert.notEqual(first.effectiveDraft, fixture.baseDraft);
    assert.equal(canonicalStringify(fixture.baseDraft), before);
    assert.deepEqual(first.effectiveDraft.rooms, fixture.baseDraft.rooms);
    assert.deepEqual(first.effectiveDraft.connectionPlans, fixture.baseDraft.connectionPlans);
    assert.equal(first.effectiveDraft.dungeonAugmentation.overlayPlan, first.overlayPlan);
    assert.ok(first.overlayPlan.nodes.length >= 2 && first.overlayPlan.nodes.length <= 4);
    assert.equal(first.overlayPlan.operations.some(({ type }) => type === 'optionalBranch'), true);
    assert.equal(first.overlayPlan.operations.some(({ type }) => type === 'edgePadding'), true);
    assert.equal(first.overlayPlan.nodes.every(({ id }) => id.startsWith('supplement:fixture-region:')), true);
    assert.equal(first.overlayPlan.nodes.every((node) => node.sockets.every(({ state }) => (
      state === 'connected' || state === 'capped'
    ))), true);
    assert.equal(first.overlayPlan.operations
      .filter(({ type }) => type === 'edgePadding')
      .every(({ originalEdgePreserved, gateDominancePreserved }) => (
        originalEdgePreserved && gateDominancePreserved
      )), true);
    assertRendererFree(first.overlayPlan);
    assertDeepFrozen(first.overlayPlan);
    assertDeepFrozen(first.effectiveDraft);
    planHashes.add(first.overlayPlan.augmentationPlanHash);
    structuralSignatures.add(canonicalStringify({
      grammars: first.overlayPlan.nodes.map(({ grammarId }) => grammarId),
      operationRoomCounts: first.overlayPlan.operations
        .filter(({ type }) => type !== 'delegatedProgression')
        .map(({ type, nodeIds }) => [type, nodeIds.length]),
    }));
  }
  assert.ok(planHashes.size >= 80, `expected seed diversity, received ${planHashes.size} hashes`);
  assert.ok(structuralSignatures.size >= 10, `expected structural variation, received ${structuralSignatures.size} layouts`);
});

test(`${VERIFICATION_SEED_COUNT} preview-v2 seeds guarantee a perceptible two-room branch plus padding`, () => {
  const profileId = 'industrial-supplement-preview-v2';
  const planHashes = new Set();
  for (let index = 0; index < VERIFICATION_SEED_COUNT; index += 1) {
    const fixture = makeFixture({ profileId });
    const result = augmentDungeonDraft({
      ...fixture,
      profileId,
      layoutSeed: `augmentation-v2:${index}`,
      difficulty: 2,
    });
    assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
    assert.ok(result.overlayPlan.nodes.length >= 3 && result.overlayPlan.nodes.length <= 4);
    const structuralOperations = result.overlayPlan.operations.filter(({ type }) => (
      type === 'optionalBranch' || type === 'edgePadding'
    ));
    assert.deepEqual(structuralOperations.map(({ type }) => type).sort(), [
      'edgePadding',
      'optionalBranch',
    ]);
    assert.equal(
      structuralOperations.find(({ type }) => type === 'optionalBranch').nodeIds.length,
      2,
    );
    assert.ok([
      1,
      2,
    ].includes(structuralOperations.find(({ type }) => type === 'edgePadding').nodeIds.length));
    planHashes.add(result.overlayPlan.augmentationPlanHash);
  }
  assert.ok(planHashes.size >= 80, `expected v2 seed diversity, received ${planHashes.size} hashes`);
});

test(`${VERIFICATION_SEED_COUNT} preview-v3 seeds build a multi-door hallway cluster with varied vertical traversal`, () => {
  const profileId = 'industrial-supplement-preview-v3';
  const observedVerticalFamilies = new Set();
  const observedVerticalDirections = new Set();
  const planHashes = new Set();
  for (let index = 0; index < VERIFICATION_SEED_COUNT; index += 1) {
    const fixture = makeFixture({ profileId });
    const options = {
      ...fixture,
      profileId,
      layoutSeed: `augmentation-v3:${index}`,
      difficulty: 2,
    };
    const result = augmentDungeonDraft(options);
    const repeated = augmentDungeonDraft(options);
    assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
    assert.deepEqual(result.overlayPlan, repeated.overlayPlan);
    assert.equal(result.overlayPlan.nodes.length, 5);
    const branch = result.overlayPlan.operations.find(({ type }) => type === 'optionalBranch');
    const padding = result.overlayPlan.operations.find(({ type }) => type === 'edgePadding');
    assert.ok(branch);
    assert.ok(padding);
    assert.equal(branch.topology, 'hallway-cluster-v1');
    assert.equal(branch.nodeIds.length, 4);
    assert.equal(branch.segmentIds.length, 4);
    assert.equal(padding.nodeIds.length, 1);
    assert.deepEqual(branch.featureSummary, {
      sideRoomCount: 2,
      elevationTransferCount: 1,
      encounterCount: 1,
      rewardCount: 1,
      trapCount: 1,
      platformRoomCount: 2,
      doorwayCount: 4,
      hallwaySpineCount: 1,
    });

    const nodeById = new Map(result.overlayPlan.nodes.map((node) => [node.id, node]));
    const hallway = nodeById.get(branch.hallwayNodeId);
    const terminal = nodeById.get(branch.terminalNodeId);
    assert.ok(hallway);
    assert.ok(terminal);
    assert.deepEqual(
      { x: hallway.size.x, z: hallway.size.z },
      { x: 14, z: 36.4 },
    );
    assert.equal(branch.corridorOriented, true);
    assert.equal(branch.hallwayLengthMeters, 36.4);
    assert.equal(branch.hallwayDoorwayCount, 4);
    assert.equal(branch.sideRoomDoorwayCount, 2);
    assert.deepEqual(branch.hallwayDoorwaySocketIds, hallway.hallwayDoorwaySocketIds);
    assert.deepEqual(branch.sideRoomDoorwaySocketIds, hallway.sideRoomDoorwaySocketIds);
    assert.equal(hallway.layoutRole, 'corridor-hallway-spine');
    assert.equal(hallway.corridorOriented, true);
    const hallwaySocketByLocalId = new Map(
      hallway.sockets.map((candidate) => [candidate.localSocketId, candidate]),
    );
    const hallwayForward = hallway.placement.facing;
    const longitudinalOffset = (candidate) => (
      (candidate.position.x - hallway.placement.center.x) * hallwayForward.x
        + (candidate.position.z - hallway.placement.center.z) * hallwayForward.z
    );
    assert.ok(Math.abs(longitudinalOffset(hallwaySocketByLocalId.get('left')) + 8.4) < 1e-9);
    assert.ok(Math.abs(longitudinalOffset(hallwaySocketByLocalId.get('right')) - 8.4) < 1e-9);
    assert.deepEqual(
      branch.sideRoomNodeIds.map((id) => ({ x: nodeById.get(id).size.x, z: nodeById.get(id).size.z })),
      [{ x: 19.6, z: 19.6 }, { x: 19.6, z: 19.6 }],
    );
    assert.deepEqual(
      { x: terminal.size.x, z: terminal.size.z },
      { x: 25.2, z: 25.2 },
    );
    assert.equal(hallway.sockets.every(({ state }) => state === 'connected'), true);
    for (const sideRoomId of branch.sideRoomNodeIds) {
      const states = Object.fromEntries(nodeById.get(sideRoomId).sockets
        .map(({ localSocketId, state }) => [localSocketId, state]));
      assert.deepEqual(states, { entry: 'connected', exit: 'capped' });
    }
    assert.deepEqual(
      Object.fromEntries(terminal.sockets.map(({ localSocketId, state }) => [localSocketId, state])),
      { entry: 'connected', exit: 'capped' },
    );
    assert.equal(
      nodeById.get(branch.sideRoomNodeIds[0]).anchors.some(({ kind }) => kind === 'encounter'),
      true,
    );
    assert.equal(
      nodeById.get(branch.sideRoomNodeIds[1]).anchors.some(({ kind }) => kind === 'reward'),
      true,
    );
    assert.equal(terminal.anchors.some(({ kind }) => kind === 'trap'), true);
    assert.ok(terminal.structure.platforms.length > 0);
    assert.ok(terminal.structure.ramps.length > 0);
    assert.equal(
      hallway.anchors.filter(({ assetRole }) => assetRole === 'frame').length,
      4,
    );

    const verticalSegment = result.overlayPlan.segments.find(({ id }) => (
      id === branch.verticalConnectorSegmentId
    ));
    assert.ok(verticalSegment);
    assert.ok(['slope', 'ladder', 'lift'].includes(verticalSegment.connectorFamily));
    assert.equal(verticalSegment.connectorFamily, branch.verticalConnectorFamily);
    assert.equal(verticalSegment.verticalTransfer, true);
    assert.equal(Math.abs(verticalSegment.elevationDelta), 14);
    assert.equal(
      verticalSegment.destinationElevation - verticalSegment.sourceElevation,
      verticalSegment.elevationDelta,
    );
    assert.ok(verticalSegment.path[1].z !== verticalSegment.path[0].z
      || verticalSegment.path[1].x !== verticalSegment.path[0].x);
    const verticalConnectorLength = Math.hypot(
      verticalSegment.path[1].x - verticalSegment.path[0].x,
      verticalSegment.path[1].z - verticalSegment.path[0].z,
    );
    assert.ok(
      verticalConnectorLength >= (verticalSegment.connectorFamily === 'slope' ? 50.4 : 44.8),
    );
    observedVerticalFamilies.add(verticalSegment.connectorFamily);
    observedVerticalDirections.add(verticalSegment.direction);
    assert.equal(
      result.overlayPlan.nodes.find(({ id }) => id === padding.nodeIds[0]).grammarId,
      'supplement-padding-through-chamber-v1',
      `seed ${index} must use the dedicated padding grammar`,
    );
    assertRendererFree(result.overlayPlan);
    assertDeepFrozen(result.overlayPlan);
    planHashes.add(result.overlayPlan.augmentationPlanHash);
  }
  assert.deepEqual([...observedVerticalFamilies].sort(), ['ladder', 'lift', 'slope']);
  assert.deepEqual([...observedVerticalDirections].sort(), ['ascending', 'descending']);
  assert.ok(planHashes.size >= 80, `expected v3 seed diversity, received ${planHashes.size} hashes`);
});

test(`${VERIFICATION_SEED_COUNT} preview-v3 seeds keep a corridor hallway when edge padding has no safe insertion`, () => {
  const profileId = 'industrial-supplement-preview-v3';
  const hashes = new Set();
  for (let index = 0; index < VERIFICATION_SEED_COUNT; index += 1) {
    const fixture = makeFixture({ profileId });
    fixture.baseDraft.protectedVolumes.push({
      id: 'fixture-splice-corridor-reserved',
      center: { x: 0, y: 2.8, z: 0 },
      size: { x: 140, y: 5.6, z: 30 },
      purpose: 'force-v3-padding-fallback',
    });
    const options = {
      ...fixture,
      profileId,
      layoutSeed: `augmentation-v3-padding-fallback:${index}`,
      difficulty: 2,
    };
    const result = augmentDungeonDraft(options);
    const repeated = augmentDungeonDraft(options);
    assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
    assert.deepEqual(result.overlayPlan, repeated.overlayPlan);
    assert.deepEqual(result.overlayPlan.operations.map(({ type }) => type), ['optionalBranch']);
    assert.equal(result.overlayPlan.nodes.length, 4);
    assert.equal(result.overlayPlan.segments.length, 4);
    assert.equal(result.diagnostics.decisions.some(({ context }) => (
      context?.optionalEdgePaddingOmitted === true
    )), true);
    const branch = result.overlayPlan.operations[0];
    const hallway = result.overlayPlan.nodes.find(({ id }) => id === branch.hallwayNodeId);
    assert.equal(branch.corridorOriented, true);
    assert.equal(branch.hallwayLengthMeters, 36.4);
    assert.equal(branch.hallwayDoorwayCount, 4);
    assert.equal(branch.sideRoomDoorwayCount, 2);
    assert.equal(hallway.size.z > hallway.size.x * 2, true);
    assert.equal(hallway.sockets.every(({ state }) => state === 'connected'), true);
    assert.deepEqual(
      branch.sideRoomNodeIds.map((nodeId) => (
        result.overlayPlan.nodes.find(({ id }) => id === nodeId).contentRole
      )),
      ['encounter', 'reward'],
    );
    hashes.add(result.overlayPlan.augmentationPlanHash);
  }
  assert.ok(hashes.size >= 80, `expected fallback seed diversity, received ${hashes.size} hashes`);
});

test('edge-padding connector paths follow an L-shaped parent splice instead of cutting a chord', () => {
  const profileId = 'industrial-supplement-preview-v3';
  const fixture = makeFixture({ profileId });
  const splice = fixture.extensionRegions[0].spliceEdges[0];
  splice.path = [
    { x: -60, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 60 },
    { x: 60, y: 0, z: 60 },
  ];
  splice.availableLengthMeters = 180;
  splice.to.position = { x: 60, y: 0, z: 60 };
  const result = augmentDungeonDraft({
    ...fixture,
    profileId,
    layoutSeed: 'l-shaped-padding-splice-regression',
    difficulty: 2,
  });

  assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
  const padding = result.overlayPlan.operations.find(({ type }) => type === 'edgePadding');
  assert.ok(padding, 'the L-shaped fixture should retain its preferred padding room');
  const paddingSegments = result.overlayPlan.segments.filter(({ operationId }) => (
    operationId === padding.id
  ));
  assert.equal(paddingSegments.length, 2);
  assert.equal(paddingSegments.some(({ path }) => path.length > 2), true);
  const pointIsOnSplice = ({ x, z }) => (
    (Math.abs(z) <= 1e-6 && x >= -60 && x <= 0)
      || (Math.abs(x) <= 1e-6 && z >= 0 && z <= 60)
      || (Math.abs(z - 60) <= 1e-6 && x >= 0 && x <= 60)
  );
  assert.equal(
    paddingSegments.every(({ path }) => path.every(pointIsOnSplice)),
    true,
  );
  assert.equal(
    paddingSegments.some(({ path }) => path.some(({ x, z }) => x === 0 && z === 0)),
    true,
  );
});

test('the Industrial adapter forwards authoritative base volumes into route planning', () => {
  const baseVolume = {
    id: 'industrial-wrapper-authoritative-volume',
    ownerId: 'industrial-wrapper-room',
    center: { x: 14, y: 2.8, z: -14 },
    size: { x: 8.4, y: 5.6, z: 8.4 },
  };
  const baseDraft = {
    basePlanHash: 'industrial-wrapper-authoritative-base',
    occupiedVolumes: [baseVolume],
    rooms: [],
    connectionPlans: [],
  };
  const host = createIndustrialAugmentationHost({ baseDraft });

  assert.deepEqual(
    host.extensionRegions[0].routeNetworkPlacementProtectedVolumes,
    [{ ...baseVolume, purpose: 'base-draft-protected' }],
  );
});

test('the pure planner accepts the Industrial adapter world-meter snapshot without replacing its base graph', () => {
  const rooms = [
    { id: 'enemyNest', type: 'combat', x: -30, z: 0, width: 7, depth: 7, baseElevation: 0 },
    { id: 'keycardRoom', type: 'key', x: 30, z: 0, width: 7, depth: 7, baseElevation: 0 },
  ];
  const connectionPlans = [{
    id: 'industrial-fixture-physical-edge',
    logicalConnectionId: 'enemyNest_keycardRoom',
    fromRoomId: 'enemyNest',
    toRoomId: 'keycardRoom',
    doorId: 'enemyNestGate',
    level: 0,
    elevation: 0,
    fullPath: Array.from({ length: 53 }, (_, index) => ({ x: index - 26, z: 0 })),
    fromSocket: { id: 'enemyNest:east', roomId: 'enemyNest', x: -27, z: 0, elevation: 0, facingX: 1, facingZ: 0 },
    toSocket: { id: 'keycardRoom:west', roomId: 'keycardRoom', x: 27, z: 0, elevation: 0, facingX: -1, facingZ: 0 },
  }];
  const baseDraft = createIndustrialBaseDraft({ rooms, connectionPlans, tileSize: 2.8 });
  const host = createIndustrialAugmentationHost({ baseDraft, rooms, connectionPlans, tileSize: 2.8 });
  assert.equal(host.basePlanHash, baseDraft.basePlanHash);
  const before = canonicalStringify(baseDraft);
  const result = augmentDungeonDraft({
    baseDraft,
    extensionRegions: host.extensionRegions,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'industrial-adapter-compatibility',
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
  assert.equal(result.overlayPlan.basePlanHash, baseDraft.basePlanHash);
  assert.equal(canonicalStringify(baseDraft), before);
  assert.deepEqual(result.effectiveDraft.connectionPlans, baseDraft.connectionPlans);
  assert.equal(result.overlayPlan.operations.some(({ type }) => type === 'edgePadding'), true);
  const paddedOperation = result.overlayPlan.operations.find(({ type }) => type === 'edgePadding');
  assert.equal(paddedOperation.originalLogicalEdge.gateId, 'enemyNestGate');
  assert.equal(paddedOperation.originalLogicalEdge.gatePlacementSide, 'source');
  const materialized = materializeIndustrialOverlay({
    rooms,
    connectionPlans,
    overlayPlan: result.overlayPlan,
    extensionRegions: host.extensionRegions,
    tileSize: 2.8,
  });
  assert.equal(materialized.diagnostics.accepted, true, JSON.stringify(materialized.diagnostics.errors));
  assert.equal(materialized.rooms.length, rooms.length + result.overlayPlan.nodes.length);
  const physicalGateHost = materialized.connectionPlans.find((plan) => (
    plan.isPaddedByDungeonSupplement && plan.hostsLogicalGate
  ));
  assert.ok(physicalGateHost);
  assert.equal(physicalGateHost.fromRoomId, 'enemyNest');
  assert.equal(physicalGateHost.gatePlacementSide, 'source');
  assert.deepEqual(connectionPlans[0].fullPath, Array.from({ length: 53 }, (_, index) => ({ x: index - 26, z: 0 })));
});

test('the Industrial host advertises only boundary-socket-to-boundary-socket padding length', () => {
  const rooms = [
    { id: 'entrance', type: 'entrance', x: 0, z: 0, width: 5, depth: 5, baseElevation: 0 },
    { id: 'enemyNest', type: 'combat', x: 0, z: 8, width: 5, depth: 5, baseElevation: 0 },
  ];
  const connectionPlans = [{
    id: 'entrance_enemyNest_ground',
    logicalConnectionId: 'entrance_enemyNest',
    fromRoomId: 'entrance',
    toRoomId: 'enemyNest',
    level: 0,
    elevation: 0,
    fullPath: Array.from({ length: 9 }, (_, z) => ({ x: 0, z })),
    fromSocket: {
      id: 'entrance:south',
      roomId: 'entrance',
      x: 0,
      z: 2,
      elevation: 0,
      facingX: 0,
      facingZ: 1,
    },
    toSocket: {
      id: 'enemyNest:north',
      roomId: 'enemyNest',
      x: 0,
      z: 6,
      elevation: 0,
      facingX: 0,
      facingZ: -1,
    },
  }];
  const baseDraft = createIndustrialBaseDraft({ rooms, connectionPlans, tileSize: 2.8 });
  const host = createIndustrialAugmentationHost({
    baseDraft,
    rooms,
    connectionPlans,
    tileSize: 2.8,
  });
  const splice = host.extensionRegions[0].spliceEdges[0];

  assert.ok(splice);
  assert.equal(splice.pathContract, 'boundary-socket-to-boundary-socket');
  assert.deepEqual(splice.fullPath, Array.from({ length: 5 }, (_, index) => ({
    x: 0,
    z: index + 2,
  })));
  assert.deepEqual(splice.path[0], { x: 0, y: 0, z: 5.6 });
  assert.equal(splice.path.at(-1).x, 0);
  assert.equal(splice.path.at(-1).y, 0);
  assert.ok(Math.abs(splice.path.at(-1).z - 16.8) <= 1e-9);
  assert.ok(Math.abs(splice.availableLengthMeters - 11.2) <= 1e-9);
  assert.equal(splice.availableLengthMeters, splice.measuredPathLengthMeters);
});

test('the Industrial V2 host grants the exact unused keycard walls and tile-aligned long-route stations', () => {
  const tileSize = 2.8;
  const rooms = [
    { id: 'enemyNest', x: -30, z: 0, width: 7, depth: 7, baseElevation: 0 },
    { id: 'keycardRoom', x: 0, z: 0, width: 23, depth: 21, baseElevation: 0 },
    { id: 'trapRoom', x: 0, z: 50, width: 7, depth: 7, baseElevation: 0 },
  ];
  const connectionPlans = [
    {
      id: 'enemyNest_keycardRoom_ground',
      logicalConnectionId: 'enemyNest_keycardRoom',
      fromRoomId: 'enemyNest',
      toRoomId: 'keycardRoom',
      doorId: 'enemyNestGate',
      level: 0,
      elevation: 0,
      fullPath: Array.from({ length: 17 }, (_, index) => ({ x: index - 27, z: 0 })),
      fromSocket: { id: 'enemy:east', roomId: 'enemyNest', x: -27, z: 0, elevation: 0, facingX: 1, facingZ: 0 },
      toSocket: { id: 'keycard:west', roomId: 'keycardRoom', x: -11, z: 0, elevation: 0, facingX: -1, facingZ: 0 },
    },
    {
      id: 'keycardRoom_trapRoom_ground',
      logicalConnectionId: 'keycardRoom_trapRoom',
      fromRoomId: 'keycardRoom',
      toRoomId: 'trapRoom',
      doorId: 'Door_Alpha',
      level: 0,
      elevation: 0,
      fullPath: Array.from({ length: 38 }, (_, index) => ({ x: 0, z: index + 10 })),
      fromSocket: { id: 'keycard:south', roomId: 'keycardRoom', x: 0, z: 10, elevation: 0, facingX: 0, facingZ: 1 },
      toSocket: { id: 'trap:north', roomId: 'trapRoom', x: 0, z: 47, elevation: 0, facingX: 0, facingZ: -1 },
    },
  ];
  const baseDraft = createIndustrialBaseDraft({ rooms, connectionPlans, tileSize });
  const host = createIndustrialAugmentationHost({ baseDraft, rooms, connectionPlans, tileSize });
  const validation = validateDungeonExtensionHost(host);
  const region = host.extensionRegions[0];
  const pyramid = region.routeNetworkGrants.find(({ kind }) => (
    kind === 'landmark-perimeter-loop'
  ));
  const coverage = region.routeNetworkGrants.filter(({ kind }) => (
    kind === 'objective-route-coverage'
  ));

  assert.equal(validation.accepted, true, validation.errors.join(', '));
  assert.equal(host.schema, DUNGEON_EXTENSION_HOST_V2_SCHEMA);
  assert.equal(region.progressionSnapshot.schema, DUNGEON_PROGRESSION_SNAPSHOT_V2_SCHEMA);
  assert.ok(pyramid);
  assert.equal(pyramid.schema, DUNGEON_ROUTE_NETWORK_GRANT_V2_SCHEMA);
  assert.deepEqual(pyramid.occupiedCriticalWallSides, ['south', 'west']);
  assert.deepEqual(pyramid.openedWallSides, ['east', 'north']);
  assert.deepEqual(
    pyramid.endpointSockets.map(({ wallSide }) => wallSide).sort(),
    ['east', 'north'],
  );
  assert.equal(pyramid.endpointSockets.every(({ roomId, widthMeters }) => (
    roomId === 'keycardRoom' && Math.abs(widthMeters - 8.4) <= 1e-9
  )), true);
  assert.equal(coverage.length, 2);
  assert.equal(coverage.every(({ coverage: contract }) => (
    contract.coverageComplete
      && Math.max(...contract.featurelessSpansMeters) <= 33.6 + 1e-6
      && contract.stationDistancesMeters.every((distance) => (
        Math.abs(distance / tileSize - Math.round(distance / tileSize)) <= 1e-9
      ))
  )), true);
  assert.equal(coverage.every((grant) => (
    grant.minimumModules === 3
      && grant.maximumModules === 6
      && !('minimumTrueRoomCount' in grant)
      && grant.planningReservationRectangles.every((rectangle) => {
        const spans = [
          rectangle.maxX - rectangle.minX,
          rectangle.maxZ - rectangle.minZ,
        ].sort((first, second) => first - second);
        return Math.abs(spans[0] - tileSize) <= 1e-6
          && Math.abs(spans[1] - tileSize * 3) <= 1e-6;
      })
      && grant.endpointSockets.every(({ endpointModuleOverlapRequired }) => (
        endpointModuleOverlapRequired === true
      ))
      && grant.socketModuleOverlapGrants.length === grant.endpointSockets.length * 2
  )), true);
  const alphaCoverage = coverage.find(({ coverage: contract }) => (
    contract.logicalEdgeId === 'keycardRoom_trapRoom'
  ));
  assert.deepEqual(alphaCoverage.requiredCredentialIds, ['Keycard_Alpha']);
  assert.equal(alphaCoverage.sourceGate.gatePlacementSide, 'source');
  assert.equal(alphaCoverage.endpointSockets.every(({ roomId }) => roomId === 'trapRoom'), true);
});

test(`${VERIFICATION_SEED_COUNT} pure V4 seeds realize a deterministic, active pyramid route network`, () => {
  const tileSize = 2.8;
  const accessDomainId = 'fixture-region:band-0';
  const endpointSockets = [
    {
      id: 'fixture:keycard:north',
      nodeId: 'keycardRoom',
      roomId: 'keycardRoom',
      position: { x: 0, y: 0, z: -30 },
      facing: { x: 0, y: 0, z: -1 },
      wallSide: 'north',
    },
    {
      id: 'fixture:keycard:east',
      nodeId: 'keycardRoom',
      roomId: 'keycardRoom',
      position: { x: 32, y: 0, z: 0 },
      facing: { x: 1, y: 0, z: 0 },
      wallSide: 'east',
    },
  ].map((socket) => ({
    ...socket,
    widthMeters: 8.4,
    heightMeters: 3.6,
    landingWidthTiles: 3,
    clearanceHeightMeters: 3.6,
    connectorFamilies: ['service-gallery'],
    progressionBandId: 0,
    accessDomainId,
  }));
  const grant = {
    schema: DUNGEON_ROUTE_NETWORK_GRANT_V2_SCHEMA,
    id: 'fixture:keycard-pyramid-loop-grant',
    required: true,
    kind: 'landmark-perimeter-loop',
    landmarkRoomId: 'keycardRoom',
    endpointSockets,
    occupiedCriticalWallSides: ['south', 'west'],
    openedWallSides: ['north', 'east'],
    progressionBandId: 0,
    accessDomainId,
    dominanceRegionId: 'fixture:post-encounter:pre-alpha',
    crossedBoundaryIds: [],
    requiredCredentialIds: [],
    sourceGate: null,
    protectedVolumes: [{
      id: 'fixture:keycard-pyramid-protected',
      center: { x: 0, y: 4, z: 0 },
      size: { x: 20, y: 8, z: 20 },
    }],
    socketLandingOverlapGrants: endpointSockets.map((socket) => {
      const horizontal = Math.abs(socket.facing.x) > 0;
      return {
        id: `${socket.id}:landing-overlap`,
        socketId: socket.id,
        center: { ...socket.position, y: 1.8 },
        size: { x: horizontal ? 14 : 8.4, y: 3.6, z: horizontal ? 8.4 : 14 },
        widthTiles: 3,
        insideDepthTiles: 2,
        outsideDepthTiles: 2,
        maximumBoundaryDepthTiles: 2,
      };
    }),
    mustPreserveBeatIds: ['enemyNestGate', 'keycardGuard', 'Keycard_Alpha', 'Door_Alpha'],
    minimumModules: 3,
    maximumModules: 5,
    requiredCycleRankDelta: 1,
  };
  const extensionRegion = {
    id: 'fixture-region',
    themeBinding: SOURCE_THEME,
    attachmentSockets: [],
    spliceEdges: [],
    allowedProfileIds: ['industrial-supplement-preview-v4'],
    delegatedProgressionBeats: [],
    routeNetworkGrants: [grant],
    progressionSnapshot: {
      schema: DUNGEON_PROGRESSION_SNAPSHOT_V2_SCHEMA,
      startRoomId: 'keycardRoom',
      rooms: [{ id: 'keycardRoom', progressionBandId: 0, accessDomainId }],
      connections: [],
      bands: [{ progressionBandId: 0, accessDomainId, roomIds: ['keycardRoom'] }],
      keycards: [],
      doors: [],
      objectiveRouteIds: [],
      protectedBeatIds: ['enemyNestGate', 'keycardGuard', 'Keycard_Alpha', 'Door_Alpha'],
    },
    themeCapabilities: COMPLETE_CAPABILITIES,
  };
  const baseDraft = {
    basePlanHash: 'fixture-v4-base-plan',
    rooms: [],
    occupiedVolumes: [],
    protectedVolumes: [],
    connectionPlans: [],
  };
  const topologyKinds = new Set();
  const junctionKinds = new Set();
  const elevationModes = new Set();
  const v4Profile = DUNGEON_AUGMENTATION_PROFILES['industrial-supplement-preview-v4'];
  const singleNetworkProfile = {
    ...v4Profile,
    // A single-network fixture exercises the planner's per-dungeon default.
    // Corpus-wide family diversity is enforced by the 100-seed verifier.
    requiredVariety: undefined,
  };
  const metersFromTiles = (tiles) => Number((tiles * tileSize).toFixed(6));
  const expectedJunctionFootprints = new Map([
    ['through-t', [metersFromTiles(5), metersFromTiles(7)]],
    ['crossroads', [metersFromTiles(7), metersFromTiles(7)]],
    ['staggered-cross', [metersFromTiles(5), metersFromTiles(13)]],
    ['stacked-interchange', [metersFromTiles(9), metersFromTiles(13)]],
    ['over-under-crossover', [metersFromTiles(7), metersFromTiles(7)]],
  ]);
  const v4Grammars = v4Profile.grammarPool.map(({ id }) => (
    GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[id]
  ));
  const connectorGrammars = v4Grammars.filter((grammar) => (
    grammar?.selectionConstraints?.routeNetworkModuleKind === 'connector-module'
  ));
  const contentGrammars = v4Grammars.filter((grammar) => (
    grammar?.selectionConstraints?.routeNetworkModuleKind !== 'connector-module'
  ));
  assert.equal(v4Profile.revision, 5);
  assert.equal(v4Grammars.length, v4Profile.grammarPool.length);
  assert.equal(v4Grammars.every((grammar) => Boolean(grammar?.blueprintId)), true);
  assert.equal(connectorGrammars.length, 6);
  assert.equal(contentGrammars.length, v4Grammars.length - connectorGrammars.length);
  assert.equal(contentGrammars.every((grammar) => (
    grammar?.selectionConstraints?.connectorOwned !== true
  )), true);
  for (const grammar of connectorGrammars) {
    const kind = grammar.selectionConstraints.routeNetworkJunctionKind;
    const expected = [...expectedJunctionFootprints.get(kind)]
      .sort((left, right) => left - right);
    const actual = [Number(grammar.size.width), Number(grammar.size.depth)]
      .sort((left, right) => left - right);
    assert.deepEqual(actual, expected, kind);
    assert.equal(grammar.selectionConstraints.connectorOwned, true);
    assert.equal(grammar.selectionConstraints.substantiveRoom, false);
    assert.equal(
      grammar.selectionConstraints.supportsJunctionPromotion,
      kind !== 'over-under-crossover',
    );
  }
  for (let index = 0; index < VERIFICATION_SEED_COUNT; index += 1) {
    const options = {
      baseDraft,
      extensionRegions: [extensionRegion],
      profileId: singleNetworkProfile.id,
      profiles: { [singleNetworkProfile.id]: singleNetworkProfile },
      layoutSeed: `pure-v4:${index}`,
    };
    const first = augmentDungeonDraft(options);
    const repeated = augmentDungeonDraft(options);
    assert.equal(first.status, 'applied', JSON.stringify(first.diagnostics.errors));
    assert.deepEqual(first.overlayPlan, repeated.overlayPlan);
    assert.equal(first.overlayPlan.schema, DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA);
    assert.equal(first.overlayPlan.operations.length, 1);
    const operation = first.overlayPlan.operations[0];
    const roomNodes = first.overlayPlan.nodes.filter(({ kind }) => (
      kind === 'supplementRoom'
    ));
    const connectorModuleNodes = first.overlayPlan.nodes.filter(({ kind }) => (
      kind === 'supplementConnectorModule'
    ));
    const connectorJunctionNodes = first.overlayPlan.nodes.filter(({ kind }) => (
      kind === 'supplementConnectorJunction'
    ));
    assert.ok(roomNodes.length >= 2);
    assert.ok(connectorJunctionNodes.length >= 1);
    assert.equal(first.overlayPlan.nodes.every(({ kind }) => (
      kind === 'supplementRoom'
        || kind === 'supplementConnectorModule'
        || kind === 'supplementConnectorJunction'
    )), true);
    for (const node of connectorJunctionNodes) {
      const expected = [...expectedJunctionFootprints.get(node.junction.junctionKind)]
        .sort((left, right) => left - right);
      const spans = [Number(node.size?.x ?? 0), Number(node.size?.z ?? 0)]
        .sort((left, right) => left - right);
      assert.deepEqual(spans, expected);
      assert.ok(Number(node.graphDegree ?? 0) >= 3);
      assert.equal(node.junction.countsAsMeaningfulStation, true);
    }
    assert.equal(connectorModuleNodes.every((node) => (
      Number(node.graphDegree ?? 0) < 3
        && node.junction?.countsAsMeaningfulStation !== true
    )), true);
    assert.equal(first.overlayPlan.nodes.every((node) => (
      Number(node.graphDegree ?? 0) >= 1
        && node.sockets.some(({ segmentId }) => Boolean(segmentId))
    )), true);
    assert.deepEqual(
      [...(operation.connectorModuleNodeIds ?? [])].sort(),
      connectorModuleNodes.map(({ id }) => id).sort(),
    );
    assert.deepEqual(
      [...(operation.connectorJunctionNodeIds ?? [])].sort(),
      connectorJunctionNodes.map(({ id }) => id).sort(),
    );
    assert.equal(operation.type, 'routeNetwork');
    assert.equal(operation.routeNetworkKind, 'landmark-perimeter-loop');
    assert.equal(
      operation.selectionManifest.schema,
      'ruindivex-dungeon-route-network-selection-manifest/v1',
    );
    assert.equal(operation.selectionManifest.topology.id, operation.topologyTemplateId);
    assert.equal(operation.selectionManifest.elevation.id, operation.elevationModes[0]);
    assert.equal(
      operation.selectionManifest.normalizedSemanticSignature,
      operation.normalizedSemanticSignature,
    );
    for (const family of DUNGEON_SELECTION_BAG_FAMILIES) {
      const witnessValidation = validateDungeonSelectionBagWitnessSequence(
        operation.selectionManifest.bagWitnesses?.[family],
        { family, requireNonEmpty: true },
      );
      assert.equal(
        witnessValidation.accepted,
        true,
        `${family}: ${JSON.stringify(witnessValidation.errors)}`,
      );
    }
    assert.deepEqual(
      operation.selectionManifest.roomLayouts.map(({ grammarId }) => grammarId).sort(),
      roomNodes.map(({ grammarId }) => grammarId).sort(),
    );
    assert.deepEqual([...operation.endpointSocketIds].sort(), endpointSockets.map(({ id }) => id).sort());
    assert.equal(operation.cycleRankDelta, 1);
    assert.ok(operation.moduleCount >= 3 && operation.moduleCount <= 5);
    assert.equal(operation.substantiveModuleCount, operation.moduleCount);
    assert.equal(
      operation.moduleCount,
      roomNodes.length + connectorJunctionNodes.length,
    );
    assert.equal(operation.physicalNodeCount, first.overlayPlan.nodes.length);
    assert.equal(operation.connectorModuleCount, connectorModuleNodes.length);
    assert.equal(operation.featurelessSpans.every(({ distanceMeters }) => distanceMeters <= 33.6 + 1e-6), true);
    const physicalNodeIds = new Set(first.overlayPlan.nodes.map(({ id }) => id));
    const adjacency = new Map([...physicalNodeIds].map((id) => [id, new Set()]));
    const parentAnchoredNodeIds = new Set();
    for (const segment of first.overlayPlan.segments) {
      assert.ok(Array.isArray(segment.path) && segment.path.length >= 2);
      if (segment.sharedEndpointFootprint?.kind !== 'shared-junction-threshold') {
        assert.deepEqual(segment.endpointSeams.map(({ role }) => role), ['from', 'to']);
        assert.equal(segment.endpointSeams.every(({ orderedCells }) => (
          orderedCells.length === 15
        )), true);
      }
      for (const landing of segment.landingVolumes ?? []) {
        assert.deepEqual(
          [Number(landing.size.x), Number(landing.size.z)]
            .sort((left, right) => left - right),
          [5.6, 8.4],
          'V4 route-network landings use the bounded three-by-two-tile doorway footprint',
        );
      }
      const supplementalEndpointIds = [segment.from, segment.to]
        .map(({ nodeId }) => String(nodeId ?? ''))
        .filter((nodeId) => physicalNodeIds.has(nodeId));
      if (supplementalEndpointIds.length === 2) {
        adjacency.get(supplementalEndpointIds[0]).add(supplementalEndpointIds[1]);
        adjacency.get(supplementalEndpointIds[1]).add(supplementalEndpointIds[0]);
      } else if (supplementalEndpointIds.length === 1
        && [segment.from, segment.to].some(({ kind }) => kind === 'parentSocket')) {
        parentAnchoredNodeIds.add(supplementalEndpointIds[0]);
      }
    }
    assert.equal(parentAnchoredNodeIds.size, 2);
    const physicallyReachableNodeIds = new Set(parentAnchoredNodeIds);
    const pendingReachability = [...parentAnchoredNodeIds];
    while (pendingReachability.length > 0) {
      const nodeId = pendingReachability.pop();
      for (const adjacentNodeId of adjacency.get(nodeId) ?? []) {
        if (physicallyReachableNodeIds.has(adjacentNodeId)) continue;
        physicallyReachableNodeIds.add(adjacentNodeId);
        pendingReachability.push(adjacentNodeId);
      }
    }
    assert.deepEqual(
      [...physicallyReachableNodeIds].sort(),
      [...physicalNodeIds].sort(),
      'every physical route module must connect to an exact parent aperture',
    );
    topologyKinds.add(operation.topologyTemplateId);
    operation.junctionKinds.forEach((kind) => junctionKinds.add(kind));
    operation.elevationModes.forEach((mode) => elevationModes.add(mode));
  }
  assert.deepEqual([...topologyKinds].sort(), [
    'fork-merge-h-loop',
    'multi-door-room-chain',
    'over-under-loop',
    'parallel-gallery-loop',
    'split-level-ring',
    'stacked-interchange',
  ]);
  assert.ok(junctionKinds.size >= 3);
  assert.deepEqual(
    [...elevationModes].sort(),
    ['split-level-platform'],
    'the keycard-pyramid loop remains in band 0 and uses only its internal split level',
  );
});

test('the Industrial host excludes special-surface conveyor routes from generic edge padding', () => {
  const rooms = [
    { id: 'enemyNest', x: -30, z: 0, width: 7, depth: 7, baseElevation: 0 },
    { id: 'keycardRoom', x: 30, z: 0, width: 7, depth: 7, baseElevation: 0 },
    { id: 'trapRoom', x: -30, z: 30, width: 7, depth: 7, baseElevation: 0 },
    { id: 'conveyorRoom', x: 30, z: 30, width: 7, depth: 7, baseElevation: 0 },
  ];
  const connection = ({ id, logicalConnectionId, fromRoomId, toRoomId, z }) => ({
    id,
    logicalConnectionId,
    fromRoomId,
    toRoomId,
    level: 0,
    elevation: 0,
    fullPath: Array.from({ length: 55 }, (_, index) => ({ x: index - 27, z })),
    fromSocket: { id: `${id}:from`, roomId: fromRoomId, x: -27, z, elevation: 0, facingX: 1, facingZ: 0 },
    toSocket: { id: `${id}:to`, roomId: toRoomId, x: 27, z, elevation: 0, facingX: -1, facingZ: 0 },
  });
  const connectionPlans = [
    connection({
      id: 'enemyNest_keycardRoom_ground',
      logicalConnectionId: 'enemyNest_keycardRoom',
      fromRoomId: 'enemyNest',
      toRoomId: 'keycardRoom',
      z: 0,
    }),
    connection({
      id: 'trapRoom_conveyorRoom_ground',
      logicalConnectionId: 'trapRoom_conveyorRoom',
      fromRoomId: 'trapRoom',
      toRoomId: 'conveyorRoom',
      z: 30,
    }),
  ];
  const baseDraft = createIndustrialBaseDraft({ rooms, connectionPlans, tileSize: 2.8 });
  const host = createIndustrialAugmentationHost({ baseDraft, rooms, connectionPlans, tileSize: 2.8 });

  assert.deepEqual(
    host.extensionRegions[0].spliceEdges.map(({ logicalEdgeId }) => logicalEdgeId),
    ['enemyNest_keycardRoom'],
  );
});

test('the Industrial host protects every authored gallery footprint cell', () => {
  const rooms = [
    { id: 'enemyNest', x: -10, z: 0, width: 7, depth: 7, baseElevation: 0 },
    { id: 'keycardRoom', x: 10, z: 0, width: 7, depth: 7, baseElevation: 0 },
  ];
  const connectionPlans = [{
    id: 'enemyNest_keycardRoom_ground',
    logicalConnectionId: 'enemyNest_keycardRoom',
    fromRoomId: 'enemyNest',
    toRoomId: 'keycardRoom',
    level: 0,
    elevation: 0,
    fullPath: [{ x: -7, z: 0 }, { x: 7, z: 0 }],
    fromSocket: { id: 'gallery:from', roomId: 'enemyNest', x: -7, z: 0, elevation: 0, facingX: 1, facingZ: 0 },
    toSocket: { id: 'gallery:to', roomId: 'keycardRoom', x: 7, z: 0, elevation: 0, facingX: -1, facingZ: 0 },
    galleryFootprintTiles: [
      { x: 0, z: -2, elevation: 0 },
      { x: 0, z: -1, elevation: 0 },
      { x: 0, z: 0, elevation: 0 },
      { x: 0, z: 1, elevation: 0 },
      { x: 0, z: 2, elevation: 0 },
      { x: 0, z: 2, elevation: 0 },
    ],
  }];
  const baseDraft = createIndustrialBaseDraft({ rooms, connectionPlans, tileSize: 2.8 });
  const host = createIndustrialAugmentationHost({ baseDraft, rooms, connectionPlans, tileSize: 2.8 });
  const galleryVolumes = host.extensionRegions[0].protectedVolumes.filter(({ purpose }) => (
    purpose === 'industrial-authored-gallery-footprint-column'
  ));

  assert.equal(galleryVolumes.length, 5);
  assert.deepEqual(galleryVolumes.map(({ center }) => center.z).sort((a, b) => a - b), [
    -5.6, -2.8, 0, 2.8, 5.6,
  ]);
  assert.equal(galleryVolumes.every((volume) => (
    volume.ownerId === 'enemyNest_keycardRoom'
      && volume.physicalConnectionId === 'enemyNest_keycardRoom_ground'
      && volume.size.x === 2.8
      && volume.size.z === 2.8
      && volume.size.y === 2048
  )), true);
});

test('the Industrial host and base draft preserve exact family-reserved connector heights', () => {
  const rooms = [
    { id: 'enemyNest', x: -10, z: 0, width: 7, depth: 7, baseElevation: 0 },
    { id: 'keycardRoom', x: 10, z: 0, width: 7, depth: 7, baseElevation: 0 },
  ];
  const connectionPlans = [{
    id: 'enemyNest_keycardRoom_ground',
    logicalConnectionId: 'enemyNest_keycardRoom',
    fromRoomId: 'enemyNest',
    toRoomId: 'keycardRoom',
    level: 0,
    elevation: 14,
    fullPath: [{ x: -7, z: 0 }, { x: 7, z: 0 }],
    fromSocket: { id: 'gallery:from', roomId: 'enemyNest', x: -7, z: 0, elevation: 14, facingX: 1, facingZ: 0 },
    toSocket: { id: 'gallery:to', roomId: 'keycardRoom', x: 7, z: 0, elevation: 14, facingX: -1, facingZ: 0 },
    familyReservedFootprintColumns: [
      { x: 0, z: 0, minY: 13.4, maxY: 17.6, purposes: ['gallery-envelope'] },
      { x: 0, z: 0, minY: 27.4, maxY: 31.6, purposes: ['gallery-envelope'] },
      { x: 1, z: 0, minY: 13.4, maxY: 17.6, purposes: ['gallery-envelope'] },
    ],
  }];
  const baseDraft = createIndustrialBaseDraft({ rooms, connectionPlans, tileSize: 2.8 });
  const host = createIndustrialAugmentationHost({ baseDraft, rooms, connectionPlans, tileSize: 2.8 });
  const hostColumns = host.extensionRegions[0].protectedVolumes.filter(({ purpose }) => (
    purpose === 'industrial-authored-gallery-footprint-column'
  ));
  const baseColumns = baseDraft.protectedVolumes.filter(({ purpose }) => (
    purpose === 'industrial-single-owner-xz-connector-column'
  ));

  assert.equal(hostColumns.length, 3);
  assert.equal(baseColumns.length, 3);
  for (const columns of [hostColumns, baseColumns]) {
    const originIntervals = columns
      .filter(({ center }) => center.x === 0 && center.z === 0)
      .sort((first, second) => first.center.y - second.center.y);
    assert.equal(originIntervals.length, 2);
    assert.deepEqual(
      originIntervals.map(({ center }) => Number(center.y.toFixed(6))),
      [15.5, 29.5],
    );
    assert.deepEqual(
      originIntervals.map(({ size }) => Number(size.y.toFixed(6))),
      [4.2, 4.2],
    );
    assert.equal(dungeonVolumesOverlap(originIntervals[0], {
      center: { x: 0, y: 15.5, z: 0 },
      size: { x: 2, y: 2, z: 2 },
    }), true);
    assert.equal(dungeonVolumesOverlap(originIntervals[0], {
      center: { x: 0, y: 23, z: 0 },
      size: { x: 2, y: 2, z: 2 },
    }), false);
  }
});

test('the Industrial adapter rejects supplemental rooms stacked over authored connector columns', () => {
  const rooms = [
    { id: 'enemyNest', type: 'combat', x: -30, z: 0, width: 7, depth: 7, baseElevation: 0 },
    { id: 'keycardRoom', type: 'key', x: 30, z: 0, width: 7, depth: 7, baseElevation: 0 },
  ];
  const connectionPlans = [{
    id: 'industrial-projected-column-edge',
    logicalConnectionId: 'enemyNest_keycardRoom',
    fromRoomId: 'enemyNest',
    toRoomId: 'keycardRoom',
    level: 0,
    elevation: 0,
    fullPath: Array.from({ length: 53 }, (_, index) => ({ x: index - 26, z: 0 })),
    fromSocket: { id: 'enemyNest:east', roomId: 'enemyNest', x: -27, z: 0, elevation: 0, facingX: 1, facingZ: 0 },
    toSocket: { id: 'keycardRoom:west', roomId: 'keycardRoom', x: 27, z: 0, elevation: 0, facingX: -1, facingZ: 0 },
  }];
  const baseDraft = createIndustrialBaseDraft({ rooms, connectionPlans, tileSize: 2.8 });
  const host = createIndustrialAugmentationHost({ baseDraft, rooms, connectionPlans, tileSize: 2.8 });
  const result = augmentDungeonDraft({
    baseDraft,
    extensionRegions: host.extensionRegions,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'industrial-projected-column-fixture',
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));

  const invalidPlan = structuredClone(result.overlayPlan);
  const branchOperation = invalidPlan.operations.find(({ type }) => type === 'optionalBranch');
  const branchNode = invalidPlan.nodes.find(({ operationId }) => (
    operationId === branchOperation.id
  ));
  const projectedColumn = baseDraft.protectedVolumes.find(({ purpose }) => (
    purpose === 'industrial-single-owner-xz-connector-column'
  ));
  assert.ok(projectedColumn);
  for (const volume of [...branchNode.occupiedVolumes, ...branchNode.clearanceVolumes]) {
    volume.center = {
      x: projectedColumn.center.x,
      y: 64 + volume.size.y * 0.5,
      z: projectedColumn.center.z,
    };
  }
  invalidPlan.augmentationPlanHash = computeDungeonAugmentationPlanHash(invalidPlan);
  invalidPlan.effectivePlanHash = computeEffectiveDungeonPlanHash(
    invalidPlan.basePlanHash,
    invalidPlan.augmentationPlanHash,
  );
  const validation = validateDungeonAugmentationPlan(invalidPlan, {
    baseDraft,
    extensionRegions: host.extensionRegions,
    profiles: DUNGEON_AUGMENTATION_PROFILES,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  });

  assert.equal(validation.accepted, false);
  assert.equal(validation.errors.some(({ code, context }) => (
    code === 'supplement-overlaps-base-draft'
      && context.nodeId === branchNode.id
      && context.baseVolumeId.endsWith(':industrial-projected-column')
  )), true);
});

test('cross-theme padding splits at a flat midpoint and propagates each exact parent binding', () => {
  const fixture = makeFixture({ crossTheme: true });
  const result = augmentDungeonDraft({
    ...fixture,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'cross-theme-fixture',
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
  assert.equal(result.overlayPlan.transitionBays.length, 1);
  const transition = result.overlayPlan.transitionBays[0];
  assert.equal(transition.splitRatio, 0.5);
  assert.deepEqual(transition.placement.center, { x: 0, y: 0, z: 0 });
  assert.equal(transition.gatesAllowed, false);
  assert.equal(transition.hazardsAllowed, false);
  assert.equal(transition.encountersAllowed, false);
  assert.equal(transition.elevationTransfersAllowed, false);
  assert.deepEqual(transition.sourceThemeBinding, SOURCE_THEME);
  assert.deepEqual(transition.destinationThemeBinding, DESTINATION_THEME);
  const paddingNodes = result.overlayPlan.nodes.filter(({ operationId }) => operationId === transition.operationId);
  assert.equal(paddingNodes.length, 2);
  assert.deepEqual(paddingNodes[0].themeBinding, SOURCE_THEME);
  assert.deepEqual(paddingNodes[1].themeBinding, DESTINATION_THEME);
  const paddingSegments = result.overlayPlan.segments
    .filter(({ operationId }) => operationId === transition.operationId)
    .sort((left, right) => left.physicalOrdinal - right.physicalOrdinal);
  assert.equal(paddingSegments.length, 4);
  assert.deepEqual(
    paddingSegments.map(({ themeBinding }) => themeBinding),
    [SOURCE_THEME, SOURCE_THEME, DESTINATION_THEME, DESTINATION_THEME],
  );
});

test('cross-theme padding rejects descriptive seam labels that runtime cannot assemble', () => {
  const fixture = makeFixture({ crossTheme: true });
  const descriptiveOnly = {
    ...COMPLETE_CAPABILITIES,
    assets: ['light-fixture'],
    connectors: ['service-gallery'],
    transitions: ['flat-threshold', 'architectural-seam'],
  };
  fixture.extensionRegions[0].themeCapabilities = descriptiveOnly;
  fixture.themeCapabilitiesByRegionId = {
    'fixture-magma-region': descriptiveOnly,
  };
  const result = augmentDungeonDraft({
    ...fixture,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'descriptive-seam-is-not-runtime-capability',
  });
  assert.equal(result.status, 'unchanged');
  assert.equal(result.effectiveDraft, fixture.baseDraft);
  assert.ok(result.diagnostics.errors.some(({ code }) => (
    code === 'transition-theme-capabilities-missing'
  )));
});

test('cross-theme padding rejects the overlay rather than using a foreign fallback', () => {
  const fixture = makeFixture({ crossTheme: true });
  fixture.themeCapabilitiesByRegionId = {};
  const result = augmentDungeonDraft({
    ...fixture,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'missing-magma-theme',
  });
  assert.equal(result.status, 'unchanged');
  assert.equal(result.effectiveDraft, fixture.baseDraft);
  assert.equal(result.overlayPlan, null);
  assert.equal(result.diagnostics.errors.some(({ code }) => (
    code === 'theme-capabilities-missing' || code === 'transition-theme-capabilities-missing'
  )), true);
});

test('validation rejects node clearance and connector landing collisions', () => {
  const fixture = makeFixture();
  const result = augmentDungeonDraft({
    ...fixture,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'clearance-and-landing-collisions',
  });
  assert.equal(result.status, 'applied');
  const invalidPlan = structuredClone(result.overlayPlan);
  const baseVolume = fixture.baseDraft.rooms[0].occupiedVolumes[0];
  invalidPlan.nodes[0].clearanceVolumes[0].center = { ...baseVolume.center };
  invalidPlan.nodes[0].clearanceVolumes[0].size = { ...baseVolume.size };
  invalidPlan.segments[0].landingVolumes[0].center = { ...baseVolume.center };
  invalidPlan.segments[0].landingVolumes[0].size = { ...baseVolume.size };
  invalidPlan.segments[0].landingVolumes[0].endpointParentNodeIds = [];
  const validation = validateDungeonAugmentationPlan(invalidPlan, {
    baseDraft: fixture.baseDraft,
    extensionRegions: fixture.extensionRegions,
    profiles: DUNGEON_AUGMENTATION_PROFILES,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  });
  assert.equal(validation.accepted, false);
  assert.equal(validation.errors.some(({ code, context }) => (
    code === 'supplement-overlaps-base-draft'
      && context.nodeId === invalidPlan.nodes[0].id
  )), true);
  assert.equal(validation.errors.some(({ code, context }) => (
    code === 'supplement-segment-overlaps-base-draft'
      && context.volumePurpose === 'supplement-connector-landing-clearance'
  )), true);
});

test('delegated progression assigns only parent-authorized beats in prerequisite order', () => {
  const profile = createDungeonAugmentationProfile({
    id: 'fixture-delegated-progression-v1',
    operationBudget: {
      optionalBranchCount: 1,
      optionalBranchRooms: [2, 2],
      edgePaddingCount: 0,
      edgePaddingRooms: [0, 0],
      minimumTotalRooms: 2,
      maximumTotalRooms: 2,
    },
    requiredOperations: { optionalBranch: true, edgePadding: false },
    allowDelegatedProgression: true,
  });
  const fixture = makeFixture({
    profileId: profile.id,
    delegatedProgressionBeats: [
      { id: 'delegated-alpha-key', kind: 'key', required: true, unlocksBeatId: 'delegated-alpha-gate' },
      { id: 'delegated-alpha-gate', kind: 'gate', required: true },
    ],
  });
  const profiles = { ...DUNGEON_AUGMENTATION_PROFILES, [profile.id]: profile };
  const result = augmentDungeonDraft({
    ...fixture,
    profileId: profile.id,
    profiles,
    layoutSeed: 'delegated-progression',
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
  assert.deepEqual(
    result.overlayPlan.progressionAssignments.map(({ beatId }) => beatId),
    ['delegated-alpha-key', 'delegated-alpha-gate'],
  );
  assert.ok(
    result.overlayPlan.progressionAssignments[0].progressionOrder
      < result.overlayPlan.progressionAssignments[1].progressionOrder,
  );
  const [keyAssignment, gateAssignment] = result.overlayPlan.progressionAssignments;
  assert.equal(keyAssignment.gatedSegmentId, null);
  assert.ok(gateAssignment.gatedSegmentId);
  assert.ok(result.overlayPlan.segments.some((segment) => (
    segment.id === gateAssignment.gatedSegmentId
      && [segment.from.nodeId, segment.to.nodeId].includes(gateAssignment.nodeId)
  )));
  assert.equal(result.overlayPlan.operations.filter(({ type }) => type === 'delegatedProgression').length, 2);
  const validation = validateDungeonAugmentationPlan(result.overlayPlan, {
    baseDraft: fixture.baseDraft,
    extensionRegions: fixture.extensionRegions,
    profiles,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  });
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors));

  const unsolvable = structuredClone(result.overlayPlan);
  const invalidKey = unsolvable.progressionAssignments[0];
  const invalidGate = unsolvable.progressionAssignments[1];
  const originalKeyNodeId = invalidKey.nodeId;
  const originalKeyAnchorId = invalidKey.anchorId;
  invalidKey.nodeId = invalidGate.nodeId;
  invalidKey.anchorId = invalidGate.anchorId;
  invalidGate.nodeId = originalKeyNodeId;
  invalidGate.anchorId = originalKeyAnchorId;
  invalidGate.gatedSegmentId = unsolvable.nodes
    .find(({ id }) => id === originalKeyNodeId)
    .sockets.find(({ localSocketId }) => localSocketId === 'entry')
    .segmentId;
  const unsolvableValidation = validateDungeonAugmentationPlan(unsolvable, {
    baseDraft: fixture.baseDraft,
    extensionRegions: fixture.extensionRegions,
    profiles,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  });
  assert.equal(unsolvableValidation.accepted, false);
  assert.ok(unsolvableValidation.errors.some(({ code }) => (
    code === 'delegated-progression-unsolvable'
  )));
});

test('committed augmentation identity requires exact plans, themes, and stable progression IDs', () => {
  const fixture = makeFixture();
  const result = augmentDungeonDraft({
    ...fixture,
    profileId: 'industrial-supplement-preview-v1',
    layoutSeed: 'save-identity',
  });
  assert.equal(result.status, 'applied');
  const identity = createDungeonAugmentationSaveIdentity(result.overlayPlan);
  assert.equal(identity.schema, DUNGEON_AUGMENTATION_SAVE_IDENTITY_SCHEMA);
  assert.ok(identity.progressionStateIds.length > 0);
  assert.deepEqual(sanitizeDungeonAugmentationSaveIdentity(identity), identity);
  assert.equal(validateCommittedDungeonAugmentationIdentity(identity, identity).compatible, true);
  assert.equal(validateCommittedDungeonAugmentationIdentity(null, null).status, 'legacy-unaugmented');
  const changed = JSON.parse(JSON.stringify(identity));
  changed.themeRevisions[0].revision = 'missing-theme-revision';
  const incompatible = validateCommittedDungeonAugmentationIdentity(identity, changed);
  assert.equal(incompatible.compatible, false);
  assert.equal(incompatible.resetOrAbandonRequired, true);
  assert.equal(incompatible.errors.some(({ code }) => code === 'augmentation-theme-revisions-mismatch'), true);
  const unavailable = validateCommittedDungeonAugmentationIdentity(identity, null);
  assert.equal(unavailable.compatible, false);
  assert.equal(unavailable.errors.some(({ code }) => code === 'committed-augmentation-content-unavailable'), true);
});
