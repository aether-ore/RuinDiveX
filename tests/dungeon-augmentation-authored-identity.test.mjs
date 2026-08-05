import assert from 'node:assert/strict';
import test from 'node:test';

import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';
import {
  DUNGEON_AUGMENTATION_SAVE_IDENTITY_SCHEMA,
  DUNGEON_AUGMENTATION_SAVE_IDENTITY_V1_SCHEMA,
} from '../src/dungeon-augmentation/contracts.js';
import {
  createDungeonAugmentationSaveIdentity,
  createLegacyDungeonAugmentationSaveIdentity,
  sanitizeDungeonAugmentationSaveIdentity,
  validateCommittedDungeonAugmentationIdentity,
  withDungeonAugmentationMutableState,
} from '../src/dungeon-augmentation/identity.js';
import { computeEffectiveDungeonPlanHash } from '../src/dungeon-augmentation/validation.js';

const PROFILE_ID = 'industrial-supplement-preview-v4';
const ARTIFACT_ID = 'industrial-v4-authored-r1';
const RESOLVED_LAYOUT_SEED = 'layout:industrial-v4-authored-r1';

function authoredIdentityInput(overrides = {}) {
  const basePlanHash = overrides.basePlanHash ?? 'base:authored-v4';
  const augmentationPlanHash = overrides.augmentationPlanHash ?? 'overlay:authored-v4';
  return {
    generationMode: 'authored-artifact',
    artifactId: ARTIFACT_ID,
    artifactRevision: 1,
    profileId: PROFILE_ID,
    profileRevision: 6,
    gameplayTuningRevision: 1,
    resolvedLayoutSeed: RESOLVED_LAYOUT_SEED,
    seed: RESOLVED_LAYOUT_SEED,
    basePlanHash,
    augmentationPlanHash,
    effectivePlanHash: computeEffectiveDungeonPlanHash(basePlanHash, augmentationPlanHash),
    themeRevisions: [],
    progressionStateIds: ['state:encounter', 'state:reward'],
    ...overrides,
  };
}

test('Industrial V4 catalog selects the authored revision-6 generation contract', () => {
  const profile = DUNGEON_AUGMENTATION_PROFILES[PROFILE_ID];
  assert.equal(profile.revision, 6);
  assert.equal(profile.generationMode, 'authored-artifact');
});

test('authored save identity v2 pins canonical geometry and omits the requested seed', () => {
  const identity = createDungeonAugmentationSaveIdentity({
    ...authoredIdentityInput(),
    requestedLayoutSeed: 'layout:user-request-that-must-not-affect-identity',
  });

  assert.equal(identity.schema, DUNGEON_AUGMENTATION_SAVE_IDENTITY_SCHEMA);
  assert.equal(identity.generationMode, 'authored-artifact');
  assert.equal(identity.artifactId, ARTIFACT_ID);
  assert.equal(identity.artifactRevision, 1);
  assert.equal(identity.profileRevision, 6);
  assert.equal(identity.gameplayTuningRevision, 1);
  assert.equal(identity.resolvedLayoutSeed, RESOLVED_LAYOUT_SEED);
  assert.equal(identity.seed, RESOLVED_LAYOUT_SEED);
  assert.equal(Object.hasOwn(identity, 'requestedLayoutSeed'), false);
  assert.deepEqual(sanitizeDungeonAugmentationSaveIdentity(identity), identity);
});

test('an authored artifact can be projected directly into the canonical v2 identity', () => {
  const basePlanHash = 'base:artifact-projection';
  const augmentationPlanHash = 'overlay:artifact-projection';
  const identity = createDungeonAugmentationSaveIdentity({
    schema: 'ruindivex-dungeon-augmentation-authored-artifact/v1',
    generationMode: 'authored-artifact',
    artifactId: ARTIFACT_ID,
    artifactRevision: 1,
    profileId: PROFILE_ID,
    profileRevision: 6,
    gameplayTuningRevision: 1,
    canonicalLayoutSeed: RESOLVED_LAYOUT_SEED,
    baseGeometryHash: basePlanHash,
    overlayPlanHash: augmentationPlanHash,
    effectiveLayoutHash: computeEffectiveDungeonPlanHash(
      basePlanHash,
      augmentationPlanHash,
    ),
    overlayPlan: {
      profileId: PROFILE_ID,
      themeBindings: [{
        binding: {
          parentRegionId: 'industrial-v1:main-region',
          themeRef: {
            id: 'industrial-v1',
            revision: 'industrial-v1-presentation-r1',
            contentHash: 'industrial-v1-assets-r1',
          },
        },
      }],
      operations: [{ runtimeStateIds: ['state:artifact-operation'] }],
    },
    materializedLayout: {
      connectionPlans: [{ runtimeStateIds: ['state:artifact-connection'] }],
    },
  });

  assert.equal(identity.basePlanHash, basePlanHash);
  assert.equal(identity.augmentationPlanHash, augmentationPlanHash);
  assert.deepEqual(identity.progressionStateIds, [
    'state:artifact-connection',
    'state:artifact-operation',
  ]);
  assert.equal(identity.themeRevisions.length, 1);
});

test('authored identity construction rejects seed drift and procedural repair evidence', () => {
  assert.throws(
    () => createDungeonAugmentationSaveIdentity({
      ...authoredIdentityInput(),
      seed: 'layout:requested-seed-is-not-canonical',
    }),
    /seed must equal its resolved layout seed/u,
  );
  assert.throws(
    () => createDungeonAugmentationSaveIdentity({
      ...authoredIdentityInput(),
      routeNetworkPruningOverrides: [{ grantId: 'grant:a', reason: 'repair' }],
    }),
    /cannot contain procedural repair evidence/u,
  );
});

test('v1 identities remain readable only as explicit offline-only incompatibilities', () => {
  const basePlanHash = 'base:legacy-procedural';
  const augmentationPlanHash = 'overlay:legacy-procedural';
  const legacy = createLegacyDungeonAugmentationSaveIdentity({
    profileId: 'industrial-supplement-preview-v3',
    seed: 'layout:legacy-procedural',
    basePlanHash,
    augmentationPlanHash,
    effectivePlanHash: computeEffectiveDungeonPlanHash(basePlanHash, augmentationPlanHash),
    themeRevisions: [],
    progressionStateIds: [],
  });

  assert.equal(legacy.schema, DUNGEON_AUGMENTATION_SAVE_IDENTITY_V1_SCHEMA);
  assert.equal(sanitizeDungeonAugmentationSaveIdentity(legacy), null);
  const compatibility = validateCommittedDungeonAugmentationIdentity(
    legacy,
    createDungeonAugmentationSaveIdentity(authoredIdentityInput()),
  );
  assert.equal(compatibility.compatible, false);
  assert.equal(compatibility.status, 'legacy-profile-offline-only');
  assert.equal(compatibility.resetOrAbandonRequired, true);
  assert.equal(compatibility.savedIdentity.profileId, 'industrial-supplement-preview-v3');
  assert.equal(compatibility.errors.some(({ code }) => (
    code === 'saved-augmentation-identity-legacy-procedural'
  )), true);
});

test('v2 compatibility compares authored revisions while mutable state remains allow-listed', () => {
  const generic = createDungeonAugmentationSaveIdentity({
    ...authoredIdentityInput(),
    profileId: 'fixture-authored-profile',
    artifactId: 'fixture-authored-artifact',
    resolvedLayoutSeed: 'layout:fixture-authored',
    seed: 'layout:fixture-authored',
  });
  const changed = createDungeonAugmentationSaveIdentity({
    ...generic,
    gameplayTuningRevision: 2,
  });
  const compatibility = validateCommittedDungeonAugmentationIdentity(generic, changed);
  assert.equal(compatibility.compatible, false);
  assert.equal(compatibility.errors.some(({ code }) => (
    code === 'augmentation-gameplayTuningRevision-mismatch'
  )), true);

  const stateful = withDungeonAugmentationMutableState(generic, {
    'state:reward': 'claimed',
    'state:not-advertised': true,
  });
  assert.deepEqual(stateful.mutableState, { 'state:reward': 'claimed' });
  assert.equal(validateCommittedDungeonAugmentationIdentity(generic, stateful).compatible, true);
});
