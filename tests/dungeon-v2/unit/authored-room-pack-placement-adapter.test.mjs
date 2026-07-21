import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileSemanticRoomPackPlacementV2,
  validateSemanticRoomPackPlacementV2,
} from '../../../src/dungeon-v2/SemanticRoomPackPlanAdapterV2.js';
import {
  SEMANTIC_ROOM_PACK_V1_ROOM_IDS,
  getSemanticRoomPackV1Descriptor,
} from '../../../src/dungeon-v2/SemanticRoomPackV1Catalog.js';
import {
  rotatePointQuarterTurns,
  transformPointQuarterTurns,
} from '../../../src/dungeon-v2/DungeonSpatialMathV2.js';
import { isSerializablePlanValue } from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';
import { vectorAlmostEqual } from './authored-room-pack-test-support.mjs';

const asVector = ([x, y, z]) => ({ x, y, z });
const targetPosition = Object.freeze({ x: 137.25, y: 11.5, z: -83.75 });

function compileAtYaw(roomId, yawQuarterTurns) {
  const descriptor = getSemanticRoomPackV1Descriptor(roomId);
  const entry = descriptor.sockets.find(({ nodeName }) => nodeName.startsWith('SOCKET_ENTRY_'));
  return compileSemanticRoomPackPlacementV2(roomId, {
    placementId: `pack-placement.${roomId}.yaw-${yawQuarterTurns}`,
    entrySocketId: entry.id,
    targetPortal: {
      position: targetPosition,
      forward: rotatePointQuarterTurns(asVector(entry.forward), yawQuarterTurns),
    },
    yawQuarterTurns,
  });
}

test('adapter compiles every authored room at all four yaws from its named entry socket', () => {
  for (const roomId of SEMANTIC_ROOM_PACK_V1_ROOM_IDS) {
    const descriptor = getSemanticRoomPackV1Descriptor(roomId);
    const entry = descriptor.sockets.find(({ nodeName }) => nodeName.startsWith('SOCKET_ENTRY_'));
    for (const yawQuarterTurns of [0, 1, 2, 3]) {
      const placement = compileAtYaw(roomId, yawQuarterTurns);
      const validation = validateSemanticRoomPackPlacementV2(placement);
      assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
      assert.deepEqual(validation.errors, []);
      assert.equal(Object.isFrozen(placement), true);
      assert.equal(isSerializablePlanValue(placement), true);
      assert.equal(placement.roomId, roomId);
      assert.equal(placement.sourcePlacement.entrySocketNodeName, entry.nodeName);
      assert.equal(placement.placementTransform.yawQuarterTurns, yawQuarterTurns);
      assert.deepEqual(placement.placementTransform.scale, { x: 1, y: 1, z: 1 });
      assert.equal(placement.authoredRootTransform.preserveAuthoredScale, true);
      assert.equal(placement.authoredRootTransform.recenter, false);
      assert.deepEqual(
        transformPointQuarterTurns(asVector(entry.position), placement.placementTransform),
        targetPosition,
        `${roomId} yaw ${yawQuarterTurns} failed exact socket alignment`,
      );
      const entrySocketWorld = placement.sockets.find(({ id }) => id === placement.entrySocketId);
      assert.ok(entrySocketWorld);
      assert.deepEqual(entrySocketWorld.worldPosition, targetPosition);
      assert.ok(vectorAlmostEqual(
        entrySocketWorld.worldForward,
        rotatePointQuarterTurns(asVector(entry.forward), yawQuarterTurns),
      ));
      assert.equal(placement.placementTransform.translation.y, targetPosition.y - entry.elevation);
      assert.notEqual(
        placement.placementTransform.translation.y,
        targetPosition.y - descriptor.authoredBounds.min.y,
        'aggregate bounds minimum cannot own room placement',
      );
      assert.deepEqual(Object.keys(placement.placedRecordIds).sort(), [
        'colliderIds', 'structuralBoundaryIds', 'structuralFixtureIds', 'walkableSurfaceIds',
      ]);
      assert.ok(Object.values(placement.placedRecordIds).every(Array.isArray));
    }
  }
});

test('adapter transforms every and only manifest collision volume with stable source ownership', () => {
  for (const roomId of SEMANTIC_ROOM_PACK_V1_ROOM_IDS) {
    const descriptor = getSemanticRoomPackV1Descriptor(roomId);
    for (const yawQuarterTurns of [0, 1, 2, 3]) {
      const placement = compileAtYaw(roomId, yawQuarterTurns);
      assert.equal(placement.collisionSourcePolicy, 'manifest-collision-volumes-only');
      assert.equal(placement.transformedCollisionVolumes.length, descriptor.collisionVolumes.length);
      assert.equal(
        new Set(placement.transformedCollisionVolumes.map(({ id }) => id)).size,
        descriptor.collisionVolumes.length,
      );
      assert.equal(placement.compiledPhysicalRecords.colliders, placement.transformedCollisionVolumes,
        'compiled colliders must be the frozen manifest-derived records, not a second bounds pass');
      for (let index = 0; index < descriptor.collisionVolumes.length; index += 1) {
        const source = descriptor.collisionVolumes[index];
        const compiled = placement.transformedCollisionVolumes[index];
        assert.equal(compiled.sourceNodeName, source.nodeName);
        assert.equal(compiled.sourceManifestIndex, index);
        assert.equal(compiled.semantic, source.semantic);
        assert.ok(vectorAlmostEqual(
          compiled.worldCenter,
          transformPointQuarterTurns(asVector(source.center), placement.placementTransform),
        ));
      }
    }
  }
});

test('adapter source does not use aggregate bounds or visible-mesh AABBs for placement/collision', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL('../../../src/dungeon-v2/SemanticRoomPackPlanAdapterV2.js', import.meta.url),
    'utf8',
  ));
  assert.doesNotMatch(source, /from ['"]three(?:\/|['"])/u);
  assert.doesNotMatch(source, /new THREE\./u);
  assert.doesNotMatch(source, /setFromObject\s*\(/u);
  assert.doesNotMatch(source, /position\.y\s*=\s*-\s*(?:bounds|box)\.min\.y/u);
});
