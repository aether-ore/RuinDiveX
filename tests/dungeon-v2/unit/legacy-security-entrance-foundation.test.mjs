import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_FIXED_ROOM_MODULE_CATALOG_V2,
  getLegacyFixedRoomModuleV2,
  validateLegacyFixedRoomModuleCatalogV2,
} from '../../../src/dungeon-v2/LegacyFixedRoomModuleCatalogV2.js';
import {
  compileLegacyFixedRoomPlacementV2,
  compileLegacyFixedRoomStructuralContractV2,
  compileLegacyFixedRoomSupportContractsV2,
} from '../../../src/dungeon-v2/LegacyFixedRoomRuntimeAdapterV2.js';
import {
  transformPointQuarterTurns,
} from '../../../src/dungeon-v2/DungeonSpatialMathV2.js';

const MODULE_ID = 'v1-room.security-entrance';
const ROUTE_ID = 'ramp.security-entrance.west-catwalk-access';
const NORTH_SOCKET_ID = `socket.${MODULE_ID}.ground.north-center`;
const SOUTH_SOCKET_ID = `socket.${MODULE_ID}.ground.south-center`;
const WEST_SOCKET_ID = `socket.${MODULE_ID}.lift.west-south-bucket`;
const FACTORY_ELEVATION = 1.05;
const EPSILON = 1e-9;

const cloneCatalog = () => structuredClone(LEGACY_FIXED_ROOM_MODULE_CATALOG_V2);

function byId(records, id) {
  const result = records.find((record) => record.id === id || record.localId === id);
  assert.ok(result, `missing ${id}`);
  return result;
}

function boxesOverlap(left, right) {
  return left.min.x < right.max.x - EPSILON && left.max.x > right.min.x + EPSILON
    && left.min.y < right.max.y - EPSILON && left.max.y > right.min.y + EPSILON
    && left.min.z < right.max.z - EPSILON && left.max.z > right.min.z + EPSILON;
}

test('Security descriptor owns exact raised socket sills, a clear south Assembly socket, and one V1-tiled continuous access ramp', () => {
  const module = getLegacyFixedRoomModuleV2(MODULE_ID);
  assert.equal(module.revision, 2);
  assert.equal(module.extensionSockets.length, 4);

  const surfaceById = new Map(module.floorTopology.walkableSurfaces.map((surface) => [surface.id, surface]));
  const north = byId(module.extensionSockets, NORTH_SOCKET_ID);
  const west = byId(module.extensionSockets, WEST_SOCKET_ID);
  const south = byId(module.extensionSockets, SOUTH_SOCKET_ID);
  for (const socket of [north, west]) {
    assert.equal(socket.anchor.y, FACTORY_ELEVATION);
    assert.equal(socket.opening.sillElevation, FACTORY_ELEVATION);
    assert.equal(surfaceById.get(socket.approachSurfaceIds[0]).topY, FACTORY_ELEVATION);
    assert.ok(socket.approachSurfaceIds.some((id) => (
      surfaceById.get(id)?.traversalRoute?.routeId === ROUTE_ID
    )), `${socket.id} physically owns the authored floor return`);
  }
  assert.deepEqual(south.anchor, { x: 0, y: 0, z: 12.6 });
  assert.deepEqual(south.facing, { x: 0, y: 0, z: 1 });
  assert.deepEqual(south.opening, { width: 3.2, height: 4.8, sillElevation: 0 });
  assert.deepEqual(
    south.approachSurfaceIds.map((id) => surfaceById.get(id).localTile),
    [
      { x: 0, z: 4, level: 0 },
      { x: 0, z: 3, level: 0 },
      { x: 0, z: 2, level: 0 },
    ],
  );

  const ruinEntry = byId(module.landmarkAnchors, 'anchor.ruin-entry');
  assert.deepEqual(ruinEntry.localPosition, { x: 0, y: 0, z: -2.8 });
  assert.equal(ruinEntry.surfaceId, `surface.${MODULE_ID}.0.-1.0`);
  assert.deepEqual(ruinEntry.spawnClearance, {
    capsuleRadius: 0.56,
    capsuleHeight: 3.2,
    cameraRadius: 0.34,
    cameraFollowDistance: 6.8,
    cameraHeight: 3.25,
    nonCollidingVisualOverlapAllowed: false,
  });
  const scanner = byId(module.fixtures, `fixture.${MODULE_ID}.scanner-arch`);
  assert.equal(scanner.presentation.recipeId, 'legacy-fixed-security-scanner-arch');
  assert.deepEqual(scanner.collision.parts.map(({ id }) => id), ['west-post', 'east-post']);
  assert.ok(Math.abs(ruinEntry.localPosition.z - scanner.localBounds.center.z)
    > ruinEntry.spawnClearance.capsuleRadius + scanner.localBounds.halfSize.z,
  'the descriptor start is physically separated from the complete scanner presentation envelope');

  const ramp = module.floorTopology.walkableSurfaces
    .filter((surface) => surface.traversalRoute?.routeId === ROUTE_ID)
    .sort((left, right) => left.traversalRoute.sequenceIndex - right.traversalRoute.sequenceIndex);
  assert.deepEqual(ramp.map(({ localTile }) => [localTile.x, localTile.z]), [[-3, 3], [-2, 3], [-1, 3]]);
  assert.equal(ramp[0].ramp.startY, FACTORY_ELEVATION);
  assert.equal(ramp.at(-1).ramp.endY, 0);
  assert.ok(ramp.every(({ sourceSurface }) => sourceSurface === 'securityCatwalkAccessRamp'));
  assert.ok(ramp.every(({ materialProfileId }) => materialProfileId === 'legacy-raised-deck'));
  assert.ok(ramp.every(({ support }) => (
    support.visible && support.style === 'v1-authored-ramp-stringers'
  )));
  assert.ok(ramp.every(({ collision }) => (
    collision.supportsGroundedTraversal
    && collision.ledgeClimbDisabled
    && collision.maximumEndpointGap === 0
  )));
  assert.deepEqual(validateLegacyFixedRoomModuleCatalogV2().errors, []);
});

test('Security access ramp and socket foundation compile identically at all four quarter-turn yaws', () => {
  const module = getLegacyFixedRoomModuleV2(MODULE_ID);
  const openSocketIds = module.extensionSockets.map(({ id }) => id);
  const structuralContract = compileLegacyFixedRoomStructuralContractV2(module, { openSocketIds });
  const translation = { x: 17, y: 3, z: -11 };
  const signatures = [];

  for (let yawQuarterTurns = 0; yawQuarterTurns < 4; yawQuarterTurns += 1) {
    const placement = compileLegacyFixedRoomPlacementV2(module, {
      id: `security-foundation-yaw-${yawQuarterTurns}`,
      translation,
      yawQuarterTurns,
      structuralContract,
    });
    signatures.push(placement.structuralContractSignature);

    for (const localSocket of [
      byId(module.extensionSockets, NORTH_SOCKET_ID),
      byId(module.extensionSockets, WEST_SOCKET_ID),
      byId(module.extensionSockets, SOUTH_SOCKET_ID),
    ]) {
      const placedSocket = byId(placement.portals, localSocket.id);
      assert.deepEqual(
        placedSocket.anchor,
        transformPointQuarterTurns(localSocket.anchor, { translation, yawQuarterTurns }),
      );
      const boundaryApproach = byId(placement.walkableSurfaces, localSocket.approachSurfaceIds[0]);
      assert.equal(boundaryApproach.topY, translation.y + localSocket.opening.sillElevation);
    }

    const ramp = placement.walkableSurfaces
      .filter((surface) => surface.ramp?.routeId === ROUTE_ID)
      .sort((left, right) => left.traversalRoute.sequenceIndex - right.traversalRoute.sequenceIndex);
    assert.equal(ramp.length, 3);
    assert.equal(ramp[0].ramp.startY, translation.y + FACTORY_ELEVATION);
    assert.equal(ramp.at(-1).ramp.endY, translation.y);
    assert.ok(ramp.every(({ ramp: contract }) => contract.collisionProfile === 'continuous-linear-run'));
    for (let index = 1; index < ramp.length; index += 1) {
      assert.equal(ramp[index - 1].ramp.endY, ramp[index].ramp.startY);
    }

    const floorBoundary = placement.structuralBoundaries.find(({ side }) => side === 'floor');
    const support = compileLegacyFixedRoomSupportContractsV2(placement, {
      regionId: 'security',
      cellId: 'cell.security.native-foundation-proof',
      floorBoundaryId: floorBoundary.id,
    });
    assert.equal(support.fixtures.some(({ type }) => type === 'native-v1-solid-deck-mass'), false,
      'the Security perimeter remains a thin V1 catwalk rather than a floor-to-deck wall');
    const catwalkFrame = support.fixtures.find(({ type }) => type === 'native-v1-catwalk-frame');
    assert.ok(catwalkFrame);
    assert.equal(catwalkFrame.supportedSurfaceIds.length, 17);
    assert.equal(catwalkFrame.colliderBounds.length, catwalkFrame.partRoles.length);
    assert.equal(catwalkFrame.partRoles.every((role, index) => (
      catwalkFrame.partMaterialProfileIds[index]
        === (role.startsWith('rail-') ? 'legacy-rail' : 'legacy-support')
    )), true, 'factoryRail and supportMetal retain their exact V1 material roles');
    assert.ok(catwalkFrame.catwalkProfile.railOpenings.some(({ reason }) => (
      reason === 'authored-ramp-connection'
    )));
    assert.ok(catwalkFrame.catwalkProfile.railOpenings.some(({ reason }) => (
      reason === 'paired-horizontal-portal'
    )));
    const rampSupport = support.fixtures.filter(({ rampRouteId }) => rampRouteId === ROUTE_ID);
    assert.equal(rampSupport.length, 1);
    assert.equal(rampSupport[0].visualProfile, 'legacy-contiguous-industrial-ramp-support');
    assert.equal(rampSupport[0].foundationProfile, 'paired-edge-foundations-outside-player-lane');
    assert.deepEqual(rampSupport[0].supportedSurfaceIds, ramp.map(({ id }) => id));
    assert.equal(rampSupport[0].stringers.length, ramp.length * 2);
    assert.deepEqual(
      rampSupport[0].colliderBounds.flatMap((supportBounds) => (
        placement.fixtureColliders.filter(({ bounds }) => boxesOverlap(supportBounds, bounds)).map(({ id }) => id)
      )),
      [],
      `yaw ${yawQuarterTurns} keeps the authored ramp support clear of every V1 fixture collider`,
    );
  }

  assert.equal(new Set(signatures).size, 4, 'yaw belongs to each deterministic structural signature');
  assert.deepEqual(signatures, [
    'legacy-fixed-room-structural-v2:3154d469',
    'legacy-fixed-room-structural-v2:673b7109',
    'legacy-fixed-room-structural-v2:b8efaad7',
    'legacy-fixed-room-structural-v2:5abb1aa4',
  ]);
});

test('catalog validation rejects a socket sill that disagrees with its boundary approach', () => {
  const catalog = cloneCatalog();
  const security = catalog.find(({ id }) => id === MODULE_ID);
  byId(security.extensionSockets, NORTH_SOCKET_ID).opening.sillElevation = 0;
  const validation = validateLegacyFixedRoomModuleCatalogV2(catalog);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some((message) => (
    message.includes(NORTH_SOCKET_ID)
    && message.includes('does not match boundary approach')
  )));
});

test('catalog validation rejects an elevation-changing socket approach without authored traversal', () => {
  const catalog = cloneCatalog();
  const security = catalog.find(({ id }) => id === MODULE_ID);
  for (const surface of security.floorTopology.walkableSurfaces) {
    if (surface.traversalRoute?.routeId !== ROUTE_ID) continue;
    delete surface.traversalRoute;
  }
  const validation = validateLegacyFixedRoomModuleCatalogV2(catalog);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some((message) => (
    message.includes(WEST_SOCKET_ID)
    && message.includes('without an authored traversal surface')
  )));
});

test('catalog validation rejects a non-adjacent socket approach and a fixture-obstructed authored ramp', () => {
  const catalog = cloneCatalog();
  const security = catalog.find(({ id }) => id === MODULE_ID);
  const south = byId(security.extensionSockets, SOUTH_SOCKET_ID);
  south.approachSurfaceIds[1] = security.floorTopology.walkableSurfaces
    .find(({ localTile }) => localTile.x === 3 && localTile.z === 3 && localTile.level === 0).id;
  const rampCenter = security.floorTopology.walkableSurfaces
    .find((surface) => surface.traversalRoute?.routeId === ROUTE_ID && surface.localTile.x === -2).center;
  const scanner = security.fixtures.find(({ id }) => id.endsWith('.scanner-arch'));
  scanner.collision.parts[0].center = { ...rampCenter, y: 1.05 };

  const validation = validateLegacyFixedRoomModuleCatalogV2(catalog);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some((message) => (
    message.includes(SOUTH_SOCKET_ID) && message.includes('non-adjacent')
  )));
  assert.ok(validation.errors.some((message) => (
    message.includes(ROUTE_ID) && message.includes('is obstructed')
  )));
});
