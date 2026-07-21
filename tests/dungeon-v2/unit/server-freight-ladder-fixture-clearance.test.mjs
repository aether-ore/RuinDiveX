import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../../src/TraversalCapabilities.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';

const CASES = Object.freeze([
  Object.freeze({ seed: 'm1-golden-magma', undercroftType: 'magma' }),
  Object.freeze({ seed: 'm1-golden-electrical', undercroftType: 'electrical' }),
]);

function overlaps(left, right, tolerance = 0.001) {
  return left.min.x < right.max.x - tolerance
    && left.max.x > right.min.x + tolerance
    && left.min.y < right.max.y - tolerance
    && left.max.y > right.min.y + tolerance
    && left.min.z < right.max.z - tolerance
    && left.max.z > right.min.z + tolerance;
}

function landingClearanceBounds(landing) {
  const halfWidth = Math.min(
    landing.minimumClearWidth * 0.5,
    PLAYER_TRAVERSAL_ENVELOPE.collisionRadius + 0.04,
  );
  const end = {
    x: landing.exit.x + landing.egressDirection.x * landing.minimumClearLength,
    z: landing.exit.z + landing.egressDirection.z * landing.minimumClearLength,
  };
  return {
    min: {
      x: Math.min(landing.exit.x, end.x) - halfWidth,
      y: landing.exit.y + 0.05,
      z: Math.min(landing.exit.z, end.z) - halfWidth,
    },
    max: {
      x: Math.max(landing.exit.x, end.x) + halfWidth,
      y: landing.exit.y + landing.minimumHeadroom - 0.05,
      z: Math.max(landing.exit.z, end.z) + halfWidth,
    },
  };
}

for (const fixtureCase of CASES) {
  test(`${fixtureCase.seed} keeps authored Server and Freight fixtures clear of both ladder landings`, () => {
    const plan = createGoldenDungeonPlanV2(fixtureCase);
    const serverFreightPortal = plan.portals.find(({ id }) => id === 'portal.server-freight');
    const connectorSurfaceIds = new Set(serverFreightPortal?.physicalRoute?.surfaceIds ?? []);
    const serverLadder = plan.walkableSurfaces.find(({ id, geometry }) => (
      connectorSurfaceIds.has(id) && geometry?.type === 'ladder'
    ));
    const cryptBank = plan.structuralFixtures.find(
      ({ authoredDetailId }) => authoredDetailId === 'crypt-bank-southwest',
    );
    const freightLadder = plan.walkableSurfaces.find(
      ({ id }) => id === 'surface.freight.approach-server-freight',
    );
    const freightControlBank = plan.structuralFixtures.find(
      ({ id }) => id === 'fixture.freight.authored-freight-control-bank',
    );

    assert.ok(serverLadder?.geometry?.landings?.top,
      'native Server-side freight route must own its full upper walk-away landing');
    assert.ok(cryptBank, 'native V1 southwest crypt monolith must remain in the Server Crypt');
    assert.equal(cryptBank.collision, 'blocking');
    assert.equal(cryptBank.presentationOwnerId, 'placement.server');
    assert.equal(cryptBank.descriptorReference?.moduleId, 'v1-room.server-crypt');
    assert.equal(cryptBank.assetFamilyId, 'v1.server-crypt');
    assert.match(cryptBank.gameplayPurpose, /data-crypt aisle and combat flank/);
    assert.deepEqual(cryptBank.colliderBounds, [cryptBank.bounds]);

    const serverClearance = landingClearanceBounds(serverLadder.geometry.landings.top);
    assert.equal(overlaps(serverClearance, cryptBank.bounds), false,
      `southwest crypt bank blocks the physical walk-away capsule: ${JSON.stringify({ clearance: serverClearance, fixture: cryptBank.bounds })}`);

    assert.ok(freightLadder?.geometry?.landings?.bottom,
      'Freight-side server ladder must own its bottom landing');
    assert.ok(freightControlBank, 'authored freight control bank must remain in the freight shaft');
    assert.equal(freightControlBank.collision, 'blocking');
    assert.equal(freightControlBank.presentationAsset?.source, 'dungeon-v1');
    assert.equal(freightControlBank.assetFamilyId, 'v1.freight-recovery');
    assert.match(freightControlBank.gameplayPurpose, /collapsed freight line/);
    assert.deepEqual(freightControlBank.colliderBounds, [freightControlBank.bounds]);

    const freightClearance = landingClearanceBounds(freightLadder.geometry.landings.bottom);
    assert.equal(overlaps(freightClearance, freightControlBank.bounds), false,
      `freight control bank blocks the physical walk-away capsule: ${JSON.stringify({ clearance: freightClearance, fixture: freightControlBank.bounds })}`);
  });
}
