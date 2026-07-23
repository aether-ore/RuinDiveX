import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../src/TraversalCapabilities.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';

const REAL_SEED = 'v1-bidirectional-connector-sweep-0000';
const EPSILON = 0.001;
const DEFAULT_RUIN_WALL_HEIGHT = 15.6;
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function tileKey(x, z) {
  return `${x},${z}`;
}

function getVerticalEnvelope(tile, roomById = new Map()) {
  const room = roomById.get(tile.roomId);
  const bottom = Number(
    room?.baseElevation
      ?? tile.connectorMinY
      ?? tile.elevation
      ?? 0,
  );
  const authoredTop = Number(
    room?.ceilingY
      ?? tile.connectorCeilingY
      ?? (bottom + DEFAULT_RUIN_WALL_HEIGHT),
  );
  return {
    bottom,
    top: Math.max(bottom + PLAYER_TRAVERSAL_ENVELOPE.headClearance, authoredTop),
  };
}

function collectConnectorEnvelopeDiscontinuities({
  tiles,
  rooms = [],
  openAirTileKeys = new Set(),
}) {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const discontinuities = [];

  for (const tile of tiles.values()) {
    if (openAirTileKeys.has(tileKey(tile.x, tile.z))) continue;
    const envelope = getVerticalEnvelope(tile, roomById);

    for (const [dx, dz] of DIRECTIONS) {
      const neighborKey = tileKey(tile.x + dx, tile.z + dz);
      if (openAirTileKeys.has(neighborKey)) continue;
      const neighbor = tiles.get(neighborKey);
      if (!neighbor) continue;
      if (!(tile.connectorId || tile.connectionId || neighbor.connectorId || neighbor.connectionId)) {
        continue;
      }

      const neighborEnvelope = getVerticalEnvelope(neighbor, roomById);
      const horizontal = dz !== 0;
      const face = {
        horizontal,
        dx,
        dz,
        line: horizontal ? tile.z + dz * 0.5 : tile.x + dx * 0.5,
        axis: horizontal ? tile.x : tile.z,
        tile: { x: tile.x, z: tile.z },
        neighbor: { x: neighbor.x, z: neighbor.z },
      };

      if (neighborEnvelope.bottom > envelope.bottom + EPSILON) {
        const top = Math.min(envelope.top, neighborEnvelope.bottom);
        if (top - envelope.bottom > EPSILON) {
          discontinuities.push({
            ...face,
            kind: 'raised-neighbor-floor',
            bottom: envelope.bottom,
            top,
          });
        }
      }
      if (neighborEnvelope.top < envelope.top - EPSILON) {
        const bottom = Math.max(envelope.bottom, neighborEnvelope.top);
        if (envelope.top - bottom > EPSILON) {
          discontinuities.push({
            ...face,
            kind: 'lower-neighbor-ceiling',
            bottom,
            top: envelope.top,
          });
        }
      }
    }
  }

  return discontinuities;
}

function wallRunCovers(discontinuity, run) {
  return run.horizontal === discontinuity.horizontal
    && run.dx === discontinuity.dx
    && run.dz === discontinuity.dz
    && Math.abs(run.line - discontinuity.line) <= EPSILON
    && run.start <= discontinuity.axis
    && run.end >= discontinuity.axis
    && run.wallBottomY <= discontinuity.bottom + EPSILON
    && run.wallTopY >= discontinuity.top - EPSILON;
}

function disposeDungeon(dungeon) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  dungeon?.group?.traverse?.((object) => {
    if (object.geometry?.isBufferGeometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (!material?.isMaterial) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  dungeon?.group?.clear?.();
}

test('adjacent vertical envelopes emit fascia above a lower roof and below a raised floor', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const tiles = new Map([
    ['0,0', {
      x: 0,
      z: 0,
      connectorId: 'synthetic-connector',
      connectorMinY: 0,
      connectorCeilingY: 8.4,
    }],
    ['1,0', {
      x: 1,
      z: 0,
      connectorId: 'synthetic-connector',
      connectorMinY: 2,
      connectorCeilingY: 12.2,
    }],
  ]);

  const sharedFaceRuns = generator
    ._collectBoundaryWallRuns(tiles, new Set(), [])
    .filter((run) => !run.horizontal && Math.abs(run.line - 0.5) <= EPSILON);
  const intervals = sharedFaceRuns
    .map((run) => ({
      dx: run.dx,
      bottom: run.wallBottomY,
      top: run.wallTopY,
    }))
    .sort((first, second) => first.bottom - second.bottom);

  assert.deepEqual(intervals, [
    { dx: 1, bottom: 0, top: 2 },
    { dx: -1, bottom: 8.4, top: 12.2 },
  ]);
});

test('a browser-identical accepted seed seals every connector-adjacent envelope discontinuity', { timeout: 60_000 }, () => {
  const browserRandom = new SeededRandom(hashSeed(`layout:${REAL_SEED}`));
  const generator = new DungeonGenerator({
    random: () => browserRandom.next(),
    difficulty: 1,
  });
  const inertTexture = new THREE.Texture();
  inertTexture.name = `connectorEnclosureTexture_${REAL_SEED}`;
  generator._loadRuinTexture = () => inertTexture;

  let captured = null;
  const collectBoundaryWallRuns = generator._collectBoundaryWallRuns.bind(generator);
  generator._collectBoundaryWallRuns = (tiles, openAirTileKeys, rooms) => {
    const runs = collectBoundaryWallRuns(tiles, openAirTileKeys, rooms);
    captured = { tiles, openAirTileKeys, rooms, runs };
    return runs;
  };

  let dungeon = null;
  try {
    dungeon = generator.generate();
    assert.equal(
      dungeon.progression.validation.accepted,
      true,
      dungeon.progression.validation.errors.join('\n'),
    );
    assert.ok(captured, 'standard dungeon assembly never collected its structural wall shell');

    const slopePlans = dungeon.connectionPlans.filter((plan) => (
      plan.connectorVariant?.traversalKind === 'slope'
    ));
    assert.ok(slopePlans.length > 0, 'the real witness seed must include a signed slope');

    const discontinuities = collectConnectorEnvelopeDiscontinuities(captured);
    assert.ok(
      discontinuities.length > 0,
      'the real witness seed did not exercise adjacent connector envelope discontinuities',
    );
    assert.ok(
      discontinuities.some(({ kind }) => kind === 'lower-neighbor-ceiling'),
      'the real witness seed did not exercise a roof-height fascia',
    );

    const assembledWallRuns = [];
    const assembledCeilings = [];
    dungeon.group.traverse((object) => {
      if (object.name === 'dungeonBoundaryWall' && object.userData?.wallRun) {
        assembledWallRuns.push(object.userData.wallRun);
      }
      if (object.name === 'dungeonRoomCeiling') assembledCeilings.push(object);
    });
    assert.equal(
      assembledWallRuns.length,
      captured.runs.length,
      'a planned wall run was not represented by an assembled boundary mesh',
    );

    const uncovered = discontinuities.filter((discontinuity) => (
      !assembledWallRuns.some((run) => wallRunCovers(discontinuity, run))
    ));
    assert.deepEqual(uncovered, [], `unsealed connector envelope intervals: ${JSON.stringify(uncovered, null, 2)}`);

    const roomById = new Map(captured.rooms.map((room) => [room.id, room]));
    const expectedCeilingCells = [...captured.tiles.values()].filter((tile) => (
      !captured.openAirTileKeys.has(tileKey(tile.x, tile.z))
      && !roomById.get(tile.roomId)?.specialEnvironmentId
    ));
    assert.equal(
      assembledCeilings.length,
      expectedCeilingCells.length,
      'every enclosed spatial cell must have exactly one rendered ceiling',
    );
    for (const tile of expectedCeilingCells) {
      const room = roomById.get(tile.roomId);
      const floorY = Number(room?.baseElevation ?? tile.connectorMinY ?? tile.elevation ?? 0);
      const ceilingY = Number(room?.ceilingY ?? tile.connectorCeilingY ?? (floorY + 8.4));
      const matches = assembledCeilings.filter((ceiling) => (
        Math.abs(ceiling.position.x - tile.x * dungeon.tileSize) <= EPSILON
        && Math.abs(ceiling.position.z - tile.z * dungeon.tileSize) <= EPSILON
        && Math.abs(Number(ceiling.userData.ceilingHeight) - ceilingY) <= EPSILON
        && Math.abs(Number(ceiling.userData.floorElevation) - floorY) <= EPSILON
      ));
      assert.equal(matches.length, 1, `missing/multiple ceiling meshes at ${tile.x},${tile.z}`);
    }

    const collisionByFacadeId = new Map((dungeon.aerialBoundaryZones ?? [])
      .filter((zone) => zone.wallFacadeId)
      .map((zone) => [zone.wallFacadeId, zone]));
    assert.equal(
      collisionByFacadeId.size,
      captured.runs.length,
      'every rendered boundary run must have one exact collision zone',
    );
    for (const run of captured.runs) {
      const zone = collisionByFacadeId.get(run.facadeId);
      assert.ok(zone, `missing boundary collision for ${run.facadeId}`);
      const expectedLength = run.lengthTiles * dungeon.tileSize;
      assert.ok(Math.abs(zone.position.y - (run.wallBottomY + run.wallHeight * 0.5)) <= EPSILON);
      assert.ok(Math.abs(zone.verticalHalfHeight - run.wallHeight * 0.5) <= EPSILON);
      assert.ok(Math.abs(
        (run.horizontal ? zone.halfWidth : zone.halfDepth) - expectedLength * 0.5,
      ) <= EPSILON);
      assert.ok(Math.abs(
        (run.horizontal ? zone.halfDepth : zone.halfWidth) - 0.11,
      ) <= EPSILON);
      assert.equal(zone.allowFlyOver, false);
    }
  } finally {
    disposeDungeon(dungeon);
    inertTexture.dispose();
  }
});
