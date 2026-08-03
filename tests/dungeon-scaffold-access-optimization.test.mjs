import assert from 'node:assert/strict';
import test from 'node:test';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { hashCanonicalValue } from '../src/dungeon-augmentation/canonical.js';

const tileKey = (x, z) => `${x},${z}`;

const createBaseFloor = (roomId, radius = 12) => {
  const tiles = new Map();
  for (let x = -radius; x <= radius; x += 1) {
    for (let z = -radius; z <= radius; z += 1) {
      tiles.set(tileKey(x, z), {
        type: 'floor',
        surface: 'floor',
        x,
        z,
        elevation: 0,
        level: 0,
        roomId,
      });
    }
  }
  return tiles;
};

const createScaffoldFixtureRoom = ({ authoritative }) => ({
  id: authoritative ? 'v4Supplement' : 'legacySupplement',
  type: 'hub',
  x: 0,
  z: 0,
  width: 25,
  depth: 25,
  baseElevation: 0,
  floorElevation: 0,
  ceilingY: 8.4,
  isDungeonSupplement: authoritative,
  augmentationBlueprintId: authoritative ? 'v4-authoritative-scaffold-fixture' : null,
  augmentationStructure: {},
  augmentationFloorTiers: authoritative ? [{
    id: 'raised-tier',
    runtimeId: 'raised-tier-runtime',
    authoritative,
    elevation: 2.8,
    worldElevation: 2.8,
    level: 1,
    surface: 'industrialSupplementTier',
    floorMask: ['#...........#'],
    maskOriginTile: { x: -6, z: 0 },
    worldCells: [{
      id: 'raised-tier:left',
      grid: { x: -6, z: 0 },
      elevation: 2.8,
    }, {
      id: 'raised-tier:right',
      grid: { x: 6, z: 0 },
      elevation: 2.8,
    }],
  }] : [],
});

const generateFixture = ({ authoritative }) => {
  const room = createScaffoldFixtureRoom({ authoritative });
  const tiles = createBaseFloor(room.id);
  if (!authoritative) {
    for (const x of [-6, 6]) {
      Object.assign(tiles.get(tileKey(x, 0)), {
        surface: 'secondFloor',
        elevation: 2.8,
        level: 1,
      });
    }
  }
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const createBlockingPlatformColumnMap = generator._createBlockingPlatformColumnMap;
  let blockingPlatformMapBuildCount = 0;
  generator._createBlockingPlatformColumnMap = function countedBlockingPlatformMap(...args) {
    blockingPlatformMapBuildCount += 1;
    return createBlockingPlatformColumnMap.apply(this, args);
  };
  const extraTiles = generator._createFactoryLevelTiles(tiles, [room], [], []);
  const allTiles = [...tiles.values(), ...extraTiles];
  const canonicalTiles = allTiles.map((tile) => ({
    x: tile.x,
    z: tile.z,
    elevation: tile.elevation,
    level: tile.level,
    surface: tile.surface,
    roomId: tile.roomId ?? null,
    rampRouteId: tile.rampRouteId ?? null,
    rampRunId: tile.rampRunId ?? null,
    rampPointIndex: tile.rampPointIndex ?? null,
    rampPointCount: tile.rampPointCount ?? null,
  }));
  return {
    extraTiles,
    allTiles,
    blockingPlatformMapBuildCount,
    hash: hashCanonicalValue(canonicalTiles, {
      namespace: 'ruindivex-test-legacy-scaffold-output/v1',
    }),
  };
};

test('authoritative V4 scaffold chains bypass legacy access-ramp broadphase', () => {
  const result = generateFixture({ authoritative: true });

  assert.equal(result.blockingPlatformMapBuildCount, 0);
  assert.equal(
    result.extraTiles.filter((tile) => tile.surface === 'industrialSupplementTier').length,
    2,
  );
  assert.equal(
    result.extraTiles.some((tile) => tile.surface === 'industrialRamp'),
    false,
  );
});

test('legacy scaffold ordering stays deterministic and invalidates state after each ramp run', () => {
  const first = generateFixture({ authoritative: false });
  const replay = generateFixture({ authoritative: false });

  assert.equal(first.blockingPlatformMapBuildCount, 2);
  assert.equal(replay.blockingPlatformMapBuildCount, 2);
  assert.equal(first.hash, replay.hash);
  assert.equal(first.hash, 'v1-10a6a92bd8e5823ab5376534dc4bf5bb');
  assert.equal(
    new Set(first.allTiles
      .filter((tile) => tile.surface === 'industrialRamp')
      .map((tile) => tile.rampRouteId)).size,
    2,
  );
});
