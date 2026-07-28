import assert from 'node:assert/strict';
import test from 'node:test';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
import {
  DUNGEON_AUGMENTATION_OVERLAY_SCHEMA,
  DUNGEON_AUGMENTATION_SAVE_IDENTITY_SCHEMA,
  DUNGEON_AUGMENTATION_PROFILES,
  GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  DungeonAugmentationRandom,
  augmentDungeonDraft,
  canonicalStringify,
  computeDungeonAugmentationPlanHash,
  computeEffectiveDungeonPlanHash,
  createDungeonAugmentationProfile,
  createDungeonAugmentationSaveIdentity,
  createIndustrialAugmentationHost,
  createIndustrialBaseDraft,
  hashCanonicalValue,
  materializeIndustrialOverlay,
  sanitizeDungeonAugmentationSaveIdentity,
  validateCommittedDungeonAugmentationIdentity,
  validateDungeonAugmentationPlan,
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
  materials: ['primary-floor', 'corridor-floor', 'wall', 'ceiling', 'support', 'cap'],
  assets: ['light-fixture', 'transition-frame'],
  connectors: ['service-gallery', 'transition-bay'],
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
      availableDepthMeters: 80,
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
    assert.equal(first.status, 'applied', JSON.stringify(first.diagnostics.errors));
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
  const materialized = materializeIndustrialOverlay({
    rooms,
    connectionPlans,
    overlayPlan: result.overlayPlan,
    extensionRegions: host.extensionRegions,
    tileSize: 2.8,
  });
  assert.equal(materialized.diagnostics.accepted, true, JSON.stringify(materialized.diagnostics.errors));
  assert.equal(materialized.rooms.length, rooms.length + result.overlayPlan.nodes.length);
  assert.deepEqual(connectionPlans[0].fullPath, Array.from({ length: 53 }, (_, index) => ({ x: index - 26, z: 0 })));
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
