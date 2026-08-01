import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  augmentDungeonDraft,
  canonicalStringify,
  hashCanonicalValue,
} from '../src/dungeon-augmentation/index.js';

const SOURCE_THEME = Object.freeze({
  schema: 'ruindivex-dungeon-region-theme/v1',
  parentMapId: 'fixture-map',
  parentMapRevision: 'fixture-map-r1',
  parentRegionId: 'fixture-region',
  themeRef: {
    id: 'fixture-theme',
    revision: 'theme-r1',
    contentHash: 'fixture-content-a',
  },
  presentationVariantId: 'fixture-main',
  localLightingProfileId: 'fixture-lights',
  soundscapeProfileId: 'fixture-ambience',
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

const golden = JSON.parse(await readFile(
  new URL('./dungeon-augmentation-legacy-applied-overlays.fixture.json', import.meta.url),
  'utf8',
));

function createLegacyAppliedFixture(profileId, basePlanHash) {
  const baseDraft = {
    schema: 'fixture-base-draft/v1',
    basePlanHash,
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
  const extensionRegions = [{
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
      destinationThemeBinding: SOURCE_THEME,
    }],
    allowedProfileIds: [profileId],
    delegatedProgressionBeats: [],
    themeCapabilities: COMPLETE_CAPABILITIES,
  }];
  return { baseDraft, extensionRegions, themeCapabilitiesByRegionId: {} };
}

test('applied V1-V3 overlays retain their committed canonical replay hashes', () => {
  assert.equal(
    golden.schema,
    'ruindivex-dungeon-augmentation-legacy-applied-overlay-fixtures/v1',
  );
  assert.deepEqual(
    golden.fixtures.map(({ profileId }) => profileId),
    [
      'industrial-supplement-preview-v1',
      'industrial-supplement-preview-v2',
      'industrial-supplement-preview-v3',
    ],
  );

  for (const fixture of golden.fixtures) {
    const input = {
      ...createLegacyAppliedFixture(fixture.profileId, golden.basePlanHash),
      profileId: fixture.profileId,
      layoutSeed: fixture.layoutSeed,
      augmentationSeed: fixture.augmentationSeed,
      difficulty: golden.difficulty,
    };
    const first = augmentDungeonDraft(input);
    const replayed = augmentDungeonDraft(input);
    assert.equal(first.status, 'applied', JSON.stringify(first.diagnostics?.errors ?? []));
    assert.equal(replayed.status, 'applied', JSON.stringify(replayed.diagnostics?.errors ?? []));
    assert.equal(first.overlayPlan.profileRevision, fixture.profileRevision);
    assert.equal(first.overlayPlan.augmentationPlanHash, fixture.augmentationPlanHash);
    assert.equal(first.overlayPlan.effectivePlanHash, fixture.effectivePlanHash);
    assert.equal(
      hashCanonicalValue(first.overlayPlan, {
        namespace: golden.canonicalHashNamespace,
      }),
      fixture.canonicalOverlayHash,
    );
    assert.equal(
      canonicalStringify(replayed.overlayPlan),
      canonicalStringify(first.overlayPlan),
      `${fixture.profileId} no longer replays byte-for-byte`,
    );
  }
});
