import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../../src/Game.js';
import {
  DUNGEON_GENERATION_MODE,
  DUNGEON_V2_FIXTURE,
} from '../../../src/DungeonGeneratorFactory.js';
import { getSemanticRoomPackV1Descriptor } from '../../../src/dungeon-v2/SemanticRoomPackV1Catalog.js';
import { compileSemanticRoomPackPlacementV2 } from '../../../src/dungeon-v2/SemanticRoomPackPlanAdapterV2.js';
import { rotatePointQuarterTurns } from '../../../src/dungeon-v2/DungeonSpatialMathV2.js';

function constructionStopStorage(error, onAccess = () => {}) {
  return Object.defineProperty({}, 'lastWarning', {
    configurable: false,
    enumerable: true,
    get() {
      onAccess();
      throw error;
    },
  });
}

function request(mode, fixture) {
  return Object.freeze({ mode, fixture, undercroftType: null });
}

test('Game V2 golden construction awaits the injected semantic-room preloader', async () => {
  const constructionStop = new Error('stop-after-preload');
  let releasePreload;
  let preloadCalls = 0;
  let storageAccesses = 0;
  let settled = false;
  const preloadBarrier = new Promise((resolve) => {
    releasePreload = resolve;
  });
  const creation = Game.create({
    dungeonGenerationRequest: request(DUNGEON_GENERATION_MODE.V2, DUNGEON_V2_FIXTURE.Golden),
    semanticRoomPackPreloader: async () => {
      preloadCalls += 1;
      await preloadBarrier;
    },
    busterLabStorage: constructionStopStorage(constructionStop, () => {
      storageAccesses += 1;
    }),
  });
  creation.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  await Promise.resolve();
  assert.equal(preloadCalls, 1, 'the golden path starts the injected authored-room preload once');
  assert.equal(settled, false, 'Game construction remains pending while authored rooms are loading');
  assert.equal(storageAccesses, 0, 'construction cannot advance beyond the preload barrier');

  releasePreload();
  await assert.rejects(creation, (error) => error === constructionStop);
  assert.equal(storageAccesses, 1, 'construction advances only after the preload resolves');
});

for (const [label, dungeonGenerationRequest] of [
  [
    'V2 traversal lab',
    request(DUNGEON_GENERATION_MODE.V2, DUNGEON_V2_FIXTURE.TraversalLab),
  ],
  [
    'legacy V1',
    request(DUNGEON_GENERATION_MODE.Legacy, DUNGEON_V2_FIXTURE.Golden),
  ],
]) {
  test(`${label} construction does not preload semantic golden rooms`, async () => {
    const constructionStop = new Error(`stop-${label}`);
    let preloadCalls = 0;
    let storageAccesses = 0;
    await assert.rejects(Game.create({
      dungeonGenerationRequest,
      semanticRoomPackPreloader: async () => {
        preloadCalls += 1;
        throw new Error('semantic preloader must not run');
      },
      busterLabStorage: constructionStopStorage(constructionStop, () => {
        storageAccesses += 1;
      }),
    }), (error) => error === constructionStop);
    assert.equal(preloadCalls, 0);
    assert.equal(storageAccesses, 1);
  });
}

test('semantic-room preload rejection fail-closes golden construction before runtime setup', async () => {
  const preloadFailure = new Error('authored-room-pack-preload-failed');
  let storageAccesses = 0;
  await assert.rejects(Game.create({
    dungeonGenerationRequest: request(DUNGEON_GENERATION_MODE.V2, DUNGEON_V2_FIXTURE.Golden),
    semanticRoomPackPreloader: async () => {
      throw preloadFailure;
    },
    busterLabStorage: constructionStopStorage(new Error('construction must not continue'), () => {
      storageAccesses += 1;
    }),
  }), (error) => error === preloadFailure);
  assert.equal(storageAccesses, 0, 'failed authored presentation cannot fall through to Game/V1 construction');
});

test('semantic roomPreview stands inside the named entry socket and faces inward', () => {
  const roomId = 'rdx_factory_corkscrew_exchange';
  const descriptor = getSemanticRoomPackV1Descriptor(roomId);
  const entry = descriptor.sockets.find(({ nodeName }) => nodeName.startsWith('SOCKET_ENTRY_'));
  const yawQuarterTurns = 1;
  const targetPosition = { x: 42.5, y: 7.25, z: -31.75 };
  const targetForward = rotatePointQuarterTurns({
    x: entry.forward[0],
    y: entry.forward[1],
    z: entry.forward[2],
  }, yawQuarterTurns);
  const placement = compileSemanticRoomPackPlacementV2(roomId, {
    placementId: 'semantic-preview.factory-corkscrew',
    entrySocketNodeName: entry.nodeName,
    targetPortal: { position: targetPosition, forward: targetForward },
    yawQuarterTurns,
  });
  const context = {
    roomPreview: { roomId, facingX: undefined, facingZ: undefined, level: null },
    dungeon: {
      plan: { semanticRoomPackPlacements: [placement] },
      rooms: [],
      floorTiles: [],
      connectionPlans: [],
    },
  };

  const previewPosition = Game.prototype._getRoomPreviewPosition.call(context);
  const entrySocket = placement.sockets.find(({ isPlacementEntry }) => isPlacementEntry);
  assert.ok(entrySocket, 'preview resolves the authored named entry socket');
  assert.deepEqual(previewPosition.toArray(), [
    entrySocket.worldPosition.x - entrySocket.worldForward.x * 1.6,
    entrySocket.worldPosition.y + 0.05,
    entrySocket.worldPosition.z - entrySocket.worldForward.z * 1.6,
  ]);
  assert.equal(context.roomPreview.facingX, -entrySocket.worldForward.x);
  assert.equal(context.roomPreview.facingZ, -entrySocket.worldForward.z);
  const inwardOffset = {
    x: previewPosition.x - entrySocket.worldPosition.x,
    z: previewPosition.z - entrySocket.worldPosition.z,
  };
  assert.ok(
    inwardOffset.x * entrySocket.worldForward.x + inwardOffset.z * entrySocket.worldForward.z < 0,
    'preview position is on the room-interior side of the socket plane',
  );
});
