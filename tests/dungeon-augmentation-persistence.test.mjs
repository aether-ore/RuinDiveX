import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLegacyDungeonBasePlanHash,
  resolveCommittedDungeonGenerationSpec,
  resolveDungeonAugmentationGenerationRequest,
  resolveDungeonAugmentationProfileId,
} from '../src/Game.js';
import {
  INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID,
} from '../src/dungeon-augmentation/IndustrialExtensionHost.js';

test('base-plan identity preserves Industrial V1 while namespacing future parent families', () => {
  const input = {
    layoutSeed: 'layout:family-hash',
    difficulty: 3,
    bossProfileId: 'revolvingFusillade',
  };
  const industrial = createLegacyDungeonBasePlanHash({
    ...input,
    dungeonFamilyId: 'industrial-v1',
  });
  const magma = createLegacyDungeonBasePlanHash({
    ...input,
    dungeonFamilyId: 'magma-refinery-v2',
  });

  assert.equal(industrial, 'v1:layout:family-hash:depth:3:revolvingFusillade');
  assert.equal(
    magma,
    'v1:layout:family-hash:depth:3:revolvingFusillade:family:magma-refinery-v2',
  );
  assert.notEqual(magma, industrial);
});

test('direct committed generation uses the complete persisted parent specification', () => {
  const savedAugmentation = Object.freeze({
    schema: 'ruindivex-dungeon-augmentation-save-identity/v1',
    profileId: INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  });
  const spec = resolveCommittedDungeonGenerationSpec({
    status: 'active',
    bossProfileId: 'saved-boss',
    dungeonLayoutSeed: 'layout:saved-parent',
    depth: 7,
    dungeonFamilyId: 'saved-family-v3',
    dungeonAugmentation: savedAugmentation,
  }, {
    bossProfileId: 'url-boss',
    layoutSeed: 'layout:url',
    difficulty: 1,
    dungeonFamilyId: 'url-family',
    dungeonAugmentation: undefined,
  });

  assert.deepEqual(spec, {
    bossProfileId: 'saved-boss',
    layoutSeed: 'layout:saved-parent',
    difficulty: 7,
    dungeonFamilyId: 'saved-family-v3',
    dungeonAugmentation: savedAugmentation,
  });
});

test('direct committed legacy generation remains augmentation-off despite URL defaults', () => {
  const spec = resolveCommittedDungeonGenerationSpec({
    status: 'victory',
    bossProfileId: 'saved-boss',
    dungeonLayoutSeed: 'layout:saved-legacy',
    depth: 2,
    dungeonFamilyId: 'industrial-v1',
  }, {
    dungeonAugmentation: { profileId: INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID },
  });
  assert.equal(spec.dungeonAugmentation, null);
});

test('new runs may opt into preview while committed legacy runs remain augmentation-off', () => {
  const newRun = resolveDungeonAugmentationGenerationRequest(
    undefined,
    INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  );
  assert.equal(newRun.isCommittedRun, false);
  assert.equal(newRun.augmentationProfileId, INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID);
  assert.equal(newRun.committedAugmentationIdentity, null);

  const committedLegacyRun = resolveDungeonAugmentationGenerationRequest(
    null,
    INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  );
  assert.equal(committedLegacyRun.isCommittedRun, true);
  assert.equal(committedLegacyRun.augmentationProfileId, null);
  assert.equal(committedLegacyRun.committedAugmentationIdentity, null);
});

test('boolean URL opt-ins select the current expanded preview while explicit v1 remains replayable', () => {
  for (const alias of ['1', 'true', 'on', '2', 'preview', 'expanded']) {
    assert.equal(
      resolveDungeonAugmentationProfileId(alias),
      INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID,
      alias,
    );
  }
  assert.equal(
    resolveDungeonAugmentationProfileId(INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID),
    INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  );
  for (const disabled of [null, '', '0', 'off', 'disabled', 'none', 'unknown']) {
    assert.equal(resolveDungeonAugmentationProfileId(disabled), null, String(disabled));
  }
});

test('committed augmentation identity owns its profile instead of the current URL preview choice', () => {
  const committedIdentity = Object.freeze({
    schema: 'ruindivex-dungeon-augmentation-save-identity/v1',
    profileId: 'saved-profile-v1',
  });
  const request = resolveDungeonAugmentationGenerationRequest(
    committedIdentity,
    INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  );
  assert.equal(request.isCommittedRun, true);
  assert.equal(request.augmentationProfileId, 'saved-profile-v1');
  assert.equal(request.committedAugmentationIdentity, committedIdentity);
});

test('a committed v1 expedition remains v1 when new runs default to preview v2', () => {
  const committedIdentity = Object.freeze({
    schema: 'ruindivex-dungeon-augmentation-save-identity/v1',
    profileId: INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  });
  const request = resolveDungeonAugmentationGenerationRequest(
    committedIdentity,
    INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID,
  );
  assert.equal(request.isCommittedRun, true);
  assert.equal(request.augmentationProfileId, INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID);
  assert.equal(request.committedAugmentationIdentity, committedIdentity);
});

test('malformed committed augmentation remains present for compatibility rejection', () => {
  const invalidIdentityMarker = Object.freeze({
    schema: 'ruindivex-dungeon-augmentation-save-invalid/v1',
    resetOrAbandonRequired: true,
  });
  const request = resolveDungeonAugmentationGenerationRequest(
    invalidIdentityMarker,
    INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
  );
  assert.equal(request.isCommittedRun, true);
  assert.equal(request.augmentationProfileId, null);
  assert.equal(request.committedAugmentationIdentity, invalidIdentityMarker);
});
