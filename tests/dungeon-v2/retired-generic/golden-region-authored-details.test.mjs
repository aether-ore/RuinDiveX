// RETIRED: documents the rejected generic Golden-region detail approach; not acceptance coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GOLDEN_REGION_AUTHORED_DETAILS_V2 } from '../../../src/dungeon-v2/GoldenRegionAuthoredDetailsV2.js';

const EXPECTED_REGION_IDS = [
  'security', 'assembly', 'server', 'freight', 'sorting', 'credential', 'parts',
  'nest', 'corkscrew', 'machine-core', 'extraction', 'freight-sump', 'reservoir',
  'gantry-sump', 'salvage-tunnel', 'hazard-intake', 'hazard-core',
];

const EXPECTED_V1_ASSET_FAMILIES = new Set([
  'v1.security-checkpoint', 'v1.factory-assembly', 'v1.server-crypt',
  'v1.freight-recovery', 'v1.factory-conveyor', 'v1.credential-pyramid',
  'v1.parts-warehouse', 'v1.nest-warehouse', 'v1.machine-platforms',
  'v1.machine-core', 'v1.refractor-shrine', 'v1.coolant-relay',
  'v1.coolant-control', 'v1.coolant-conveyor', 'v1.salvage-service',
  'v1.reactor-supports', 'v1.reactor-machine',
]);

const SUPPORTED_DETAIL_TYPES = new Set([
  'cargo-track', 'conduit', 'control-bank', 'conveyor', 'coolant-pipe',
  'functional-machine', 'generator', 'pressure-pipe', 'pressure-vessel',
  'processing-tank', 'pump-array', 'reservoir', 'server-bank', 'traversal-pipe',
]);

test('all 17 golden regions have immutable, data-only authored functional detail profiles', () => {
  assert.deepEqual(Object.keys(GOLDEN_REGION_AUTHORED_DETAILS_V2).sort(), [...EXPECTED_REGION_IDS].sort());
  assert.equal(Object.isFrozen(GOLDEN_REGION_AUTHORED_DETAILS_V2), true);
  assert.doesNotThrow(() => JSON.stringify(GOLDEN_REGION_AUTHORED_DETAILS_V2));

  for (const regionId of EXPECTED_REGION_IDS) {
    const profile = GOLDEN_REGION_AUTHORED_DETAILS_V2[regionId];
    assert.equal(Object.isFrozen(profile), true, `${regionId} profile must be immutable`);
    assert.ok(EXPECTED_V1_ASSET_FAMILIES.has(profile.assetFamilyId),
      `${regionId} must resolve to a concrete Dungeon V1 asset family`);
    assert.match(profile.sourceMaterial, /v1|V1|new/i, `${regionId} must document its V1/new source material`);
    assert.ok(profile.fixtures.length >= 3, `${regionId} requires at least three functional authored fixtures`);
    assert.equal(new Set(profile.fixtures.map(({ id }) => id)).size, profile.fixtures.length);
    for (const fixture of profile.fixtures) {
      assert.ok(SUPPORTED_DETAIL_TYPES.has(fixture.type), `${regionId}:${fixture.id} uses unsupported ${fixture.type}`);
      assert.ok(Math.abs(fixture.offset.x) <= 0.4 && Math.abs(fixture.offset.z) <= 0.4,
        `${regionId}:${fixture.id} must remain inside the authored chamber profile`);
      assert.ok(['x', 'y', 'z'].every((axis) => Number.isFinite(fixture.size[axis]) && fixture.size[axis] > 0));
      assert.ok(fixture.purpose.length >= 24, `${regionId}:${fixture.id} needs a concrete functional purpose`);
    }
  }
  assert.equal(new Set(EXPECTED_REGION_IDS.map((regionId) => (
    GOLDEN_REGION_AUTHORED_DETAILS_V2[regionId].assetFamilyId
  ))).size, EXPECTED_REGION_IDS.length,
  'Every golden chamber must choose its own V1-derived presentation family.');
});

test('authored functional fixture layouts are not duplicated between golden regions', () => {
  const signatures = EXPECTED_REGION_IDS.map((regionId) => {
    const profile = GOLDEN_REGION_AUTHORED_DETAILS_V2[regionId];
    return JSON.stringify(profile.fixtures.map((fixture) => ({
      type: fixture.type,
      offset: fixture.offset,
      size: fixture.size,
    })));
  });
  assert.equal(new Set(signatures).size, EXPECTED_REGION_IDS.length);
});
