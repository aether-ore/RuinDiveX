import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { stablePlanStringify } from '../../../src/dungeon-v2/DungeonPlanDiagnostics.js';
import { validateSemanticRoomPackPlanV2 } from '../../../src/dungeon-v2/SemanticRoomPackPlanAdapterV2.js';
import { assertAcceptedDungeonFixture } from '../helpers/accepted-fixture.mjs';
import {
  LEGACY_V1_ROOM_IDS,
  REQUIRED_PACK_ROOM_IDS,
  UNDERCROFT_PACK_ROOM_IDS,
} from '../unit/authored-room-pack-test-support.mjs';

const SEEDED_VARIANTS = Object.freeze([
  Object.freeze({
    seed: 'room-pack-seed-0',
    undercroftType: 'electrical',
    roomId: 'rdx_electric_transformer_undercroft',
  }),
  Object.freeze({
    seed: 'room-pack-seed-1',
    undercroftType: 'magma',
    roomId: 'rdx_magma_foundry_undercroft',
  }),
]);

function acceptedPlanForSeed(seed) {
  const first = createGoldenDungeonPlanV2({ seed });
  const second = createGoldenDungeonPlanV2({ seed });
  assert.equal(stablePlanStringify(first), stablePlanStringify(second),
    `${seed} must compile the identical plan twice`);
  const validation = validateDungeonPlanV2(first);
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  assert.ok(validation.plan, 'validator must return its frozen accepted plan');
  assert.equal(validation.plan.accepted, true);
  assert.equal(validation.plan.validation?.accepted, true);
  return validation.plan;
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function assertIdsResolve(ids, records, label) {
  assert.ok(Array.isArray(ids) && ids.length > 0, `${label} must own live physical records`);
  const available = new Set(records.map(({ id }) => id));
  assert.equal(new Set(ids).size, ids.length, `${label} IDs must be unique`);
  for (const id of ids) assert.ok(available.has(id), `${label} cannot resolve physical record ${id}`);
}

function assertFinalAuthoredComposition(plan, expectedVariant) {
  const legacyCounts = countBy(plan.modulePlacements
    .map(({ descriptorId }) => descriptorId)
    .filter((descriptorId) => LEGACY_V1_ROOM_IDS.includes(descriptorId)));
  assert.equal(legacyCounts.size, 11, 'all eleven distinct V1 authored descriptors must be physically placed');
  for (const descriptorId of LEGACY_V1_ROOM_IDS) {
    assert.equal(legacyCounts.get(descriptorId), 1, `${descriptorId} must be placed exactly once`);
  }

  const packPlacements = plan.semanticRoomPackPlacements;
  assert.ok(Array.isArray(packPlacements), 'accepted plan must own semanticRoomPackPlacements');
  assert.equal(packPlacements.length, 3, 'accepted plan must own exactly three authored pack placements');
  assert.equal(new Set(packPlacements.map(({ placementId }) => placementId)).size, 3);
  assert.deepEqual(
    new Set(packPlacements.map(({ roomId }) => roomId)),
    new Set([...REQUIRED_PACK_ROOM_IDS, expectedVariant.roomId]),
  );
  assert.equal(packPlacements.filter(({ roomId }) => UNDERCROFT_PACK_ROOM_IDS.includes(roomId)).length, 1);
  assert.equal(plan.undercroftType, expectedVariant.undercroftType);

  const moduleById = new Map(plan.modulePlacements.map((placement) => [placement.id, placement]));
  assert.equal(moduleById.size, plan.modulePlacements.length, 'module placement IDs must remain unique');
  assert.equal(plan.modulePlacements.length, 14,
    'the final composition is eleven V1 rooms plus three physical room-pack placements');

  for (const placement of packPlacements) {
    const modulePlacement = moduleById.get(placement.placementId);
    assert.ok(modulePlacement, `${placement.placementId} must be a live module placement, not metadata`);
    assert.equal(modulePlacement.roomId, placement.roomId);
    assert.equal(modulePlacement.packId, placement.packId);
    assert.ok(Array.isArray(modulePlacement.regionIds) && modulePlacement.regionIds.length > 0,
      `${placement.placementId} must own playable regions`);
    const recordIds = placement.placedRecordIds;
    assert.deepEqual(Object.keys(recordIds).sort(), [
      'colliderIds', 'structuralBoundaryIds', 'structuralFixtureIds', 'walkableSurfaceIds',
    ]);
    assertIdsResolve(recordIds.structuralBoundaryIds, plan.structuralBoundaries,
      `${placement.placementId}.structuralBoundaries`);
    assertIdsResolve(recordIds.walkableSurfaceIds, plan.walkableSurfaces,
      `${placement.placementId}.walkableSurfaces`);
    assertIdsResolve(recordIds.structuralFixtureIds, plan.structuralFixtures,
      `${placement.placementId}.structuralFixtures`);
    assertIdsResolve(recordIds.colliderIds, placement.compiledPhysicalRecords.colliders,
      `${placement.placementId}.colliders`);
    assert.equal(recordIds.colliderIds.length, placement.transformedCollisionVolumes.length,
      `${placement.placementId} must register every manifest collision volume`);
    assert.equal(placement.compiledPhysicalRecords.colliders, placement.transformedCollisionVolumes);
    assert.equal(placement.collisionSourcePolicy, 'manifest-collision-volumes-only');
    assert.ok(placement.transformedCollisionVolumes.every(({ sourceNodeName, sourceManifestIndex }) => (
      typeof sourceNodeName === 'string' && sourceNodeName.length > 0
      && Number.isInteger(sourceManifestIndex) && sourceManifestIndex >= 0
    )));
  }

  const packValidation = validateSemanticRoomPackPlanV2(plan);
  assert.equal(packValidation.accepted, true, JSON.stringify(packValidation.errors, null, 2));
}

for (const expectedVariant of SEEDED_VARIANTS) {
  test(`accepted ${expectedVariant.undercroftType} seed physically places all V1 and selected pack rooms`, () => {
    const plan = acceptedPlanForSeed(expectedVariant.seed);
    assertFinalAuthoredComposition(plan, expectedVariant);
    assertAcceptedDungeonFixture(plan, { stage: 'plan', profile: 'golden' });
  });
}
