import assert from 'node:assert/strict';
import test from 'node:test';

import { DungeonGenerator } from '../src/DungeonGenerator.js';

function createProgressionAccessFixture() {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const supplementalConnectionId = 'supplement:fixture:route-network:segment:0';
  const rooms = [{
    id: 'conveyorRoom',
    type: 'industrial',
    x: 0,
    z: 0,
    width: 1,
    depth: 1,
    baseElevation: -14,
    exitSockets: [],
  }, {
    id: 'bossRoom',
    type: 'industrial',
    x: 4,
    z: 0,
    width: 1,
    depth: 1,
    baseElevation: -14,
    exitSockets: [],
  }];
  const authoredConnection = {
    id: 'conveyorRoom_bossRoom_ground',
    fromRoomId: 'conveyorRoom',
    toRoomId: 'bossRoom',
    level: 0,
    fullPath: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 2, z: 0 },
      { x: 3, z: 0 },
      { x: 4, z: 0 },
    ],
  };
  const supplementalConnection = {
    id: supplementalConnectionId,
    fromRoomId: 'supplement:fixture:node:0',
    toRoomId: 'supplement:fixture:node:1',
    level: 0,
    isDungeonSupplement: true,
  };
  const tiles = new Map([
    ['0,0', { x: 0, z: 0, type: 'industrial', roomId: 'conveyorRoom' }],
    ['1,0', {
      x: 1,
      z: 0,
      type: 'connectorEnvelope',
      structuralEnvelopeOnly: true,
      connectionId: supplementalConnectionId,
    }],
    ['2,0', {
      x: 2,
      z: 0,
      type: 'connectorEnvelope',
      structuralEnvelopeOnly: true,
      connectionId: supplementalConnectionId,
    }],
    ['3,0', {
      x: 3,
      z: 0,
      type: 'connectorEnvelope',
      structuralEnvelopeOnly: true,
      connectionId: supplementalConnectionId,
    }],
    ['4,0', { x: 4, z: 0, type: 'industrial', roomId: 'bossRoom' }],
  ]);
  const floorTiles = [
    { x: 0, z: 0, elevation: -14, surface: 'floor', roomId: 'conveyorRoom' },
    ...[1, 2, 3].map((x) => ({
      x,
      z: 0,
      elevation: -14,
      surface: 'connectorGalleryFloor',
      connectionId: supplementalConnectionId,
    })),
    { x: 4, z: 0, elevation: -14, surface: 'floor', roomId: 'bossRoom' },
  ];
  return {
    generator,
    rooms,
    authoredConnection,
    supplementalConnection,
    tiles,
    floorTiles,
  };
}

test('progression access accepts only floors owned by a realized physical supplement connector', () => {
  const fixture = createProgressionAccessFixture();
  const withoutPhysicalOwner = fixture.generator._validateProgressionAccess(
    fixture.floorTiles,
    fixture.tiles,
    fixture.rooms,
    [fixture.authoredConnection],
    [fixture.authoredConnection],
  );
  assert.equal(
    withoutPhysicalOwner.errors.filter((error) => error.includes('base-floor footing')).length,
    3,
    'an unregistered supplemental-looking floor must not bypass the base-footing audit',
  );

  const withGraphOnlyOwner = fixture.generator._validateProgressionAccess(
    fixture.floorTiles,
    fixture.tiles,
    fixture.rooms,
    [fixture.authoredConnection],
    [fixture.authoredConnection, {
      ...fixture.supplementalConnection,
      connectorVariantConstraints: { graphOnly: true },
    }],
  );
  assert.equal(
    withGraphOnlyOwner.errors.filter((error) => error.includes('base-floor footing')).length,
    3,
    'a graph-only supplement record is not physical footing',
  );

  const withPhysicalOwner = fixture.generator._validateProgressionAccess(
    fixture.floorTiles,
    fixture.tiles,
    fixture.rooms,
    [fixture.authoredConnection],
    [fixture.authoredConnection, fixture.supplementalConnection],
  );
  assert.deepEqual(withPhysicalOwner.errors, []);
  assert.equal(withPhysicalOwner.accepted, true);
});

test('authored room vertical plans do not claim explicitly foreign supplemental platforms', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const supplementRoomId = 'supplement:fixture:route-network:node:2';
  const bossRoom = {
    id: 'bossRoom',
    type: 'boss',
    x: 0,
    z: 0,
    width: 5,
    depth: 5,
    baseElevation: 0,
    exitSockets: [],
  };
  const supplementRoom = {
    id: supplementRoomId,
    type: 'industrial',
    x: 0,
    z: 1,
    width: 1,
    depth: 1,
    baseElevation: -14,
    isDungeonSupplement: true,
    exitSockets: [],
  };
  const bossPlatform = {
    x: 0,
    z: 0,
    elevation: 1.35,
    level: 0.5,
    roomId: 'bossRoom',
    isPlatformingSurface: true,
    platformPurpose: 'tactical_relocation',
  };
  const supplementalPlatform = {
    x: 0,
    z: 1,
    elevation: -11.2,
    level: 1,
    roomId: supplementRoomId,
    isPlatformingSurface: true,
    platformPurpose: 'supplement_authored_floor_tier',
  };
  const unownedLegacyPlatform = {
    x: 1,
    z: 0,
    elevation: 2.7,
    level: 1,
    isPlatformingSurface: true,
    platformPurpose: 'legacy_geometric_platform',
  };

  generator._finalizeRoomVerticalPlans(
    [bossRoom, supplementRoom],
    [bossPlatform, supplementalPlatform, unownedLegacyPlatform],
    [],
  );

  assert.deepEqual(
    bossRoom.platformNodes.map(({ floorKey }) => floorKey).sort(),
    ['0,0@y1.350', '1,0@y2.700'],
    'unowned legacy geometry remains eligible, but a foreign owned supplement floor does not',
  );
  assert.deepEqual(
    supplementRoom.platformNodes.map(({ floorKey }) => floorKey),
    ['0,1@y-11.200'],
    'the supplemental platform remains attached to its actual owner',
  );
});
