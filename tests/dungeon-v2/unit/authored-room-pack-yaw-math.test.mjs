import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEMANTIC_ROOM_PACK_V1_ROOM_IDS,
  getSemanticRoomPackV1Descriptor,
} from '../../../src/dungeon-v2/SemanticRoomPackV1Catalog.js';
import {
  rotatePointQuarterTurns,
  transformPointQuarterTurns,
} from '../../../src/dungeon-v2/DungeonSpatialMathV2.js';

const asVector = ([x, y, z]) => ({ x, y, z });
const targetPortal = Object.freeze({ x: 137.25, y: 11.5, z: -83.75 });

function translationForEntrySocket(entrySocket, yawQuarterTurns) {
  const rotated = rotatePointQuarterTurns(asVector(entrySocket.position), yawQuarterTurns);
  return {
    x: targetPortal.x - rotated.x,
    y: targetPortal.y - rotated.y,
    z: targetPortal.z - rotated.z,
  };
}

test('every room aligns its named entry socket at all four quarter-turn yaws', () => {
  for (const roomId of SEMANTIC_ROOM_PACK_V1_ROOM_IDS) {
    const descriptor = getSemanticRoomPackV1Descriptor(roomId);
    const entries = descriptor.sockets.filter(({ nodeName }) => nodeName.startsWith('SOCKET_ENTRY_'));
    assert.equal(entries.length, 1, `${roomId} must have one authored entry socket`);
    const entry = entries[0];
    const observedFacing = [];
    for (const yawQuarterTurns of [0, 1, 2, 3]) {
      const translation = translationForEntrySocket(entry, yawQuarterTurns);
      const placement = { translation, yawQuarterTurns };
      assert.deepEqual(
        transformPointQuarterTurns(asVector(entry.position), placement),
        targetPortal,
        `${roomId} yaw ${yawQuarterTurns} must align the named socket exactly`,
      );
      observedFacing.push(rotatePointQuarterTurns(asVector(entry.forward), yawQuarterTurns));
      assert.equal(translation.y, targetPortal.y - entry.elevation,
        'entry elevation, not aggregate minimum bounds, owns vertical placement');
      assert.notEqual(translation.y, targetPortal.y - descriptor.authoredBounds.min.y,
        'aggregate bounds minimum must never recenter an authored room');

      for (const socket of descriptor.sockets) {
        const worldPosition = transformPointQuarterTurns(asVector(socket.position), placement);
        const worldFacing = rotatePointQuarterTurns(asVector(socket.forward), yawQuarterTurns);
        assert.ok(Object.values(worldPosition).every(Number.isFinite));
        assert.ok(Object.values(worldFacing).every(Number.isFinite));
        assert.equal(Math.hypot(worldFacing.x, worldFacing.y, worldFacing.z), 1);
      }
    }
    assert.equal(new Set(observedFacing.map((facing) => JSON.stringify(facing))).size, 4,
      `${roomId} entry facing must genuinely rotate through four directions`);
  }
});

test('manifest collision centers use the identical authored socket placement transform at every yaw', () => {
  for (const roomId of SEMANTIC_ROOM_PACK_V1_ROOM_IDS) {
    const descriptor = getSemanticRoomPackV1Descriptor(roomId);
    const entry = descriptor.sockets.find(({ nodeName }) => nodeName.startsWith('SOCKET_ENTRY_'));
    for (const yawQuarterTurns of [0, 1, 2, 3]) {
      const placement = {
        translation: translationForEntrySocket(entry, yawQuarterTurns),
        yawQuarterTurns,
      };
      const transformed = descriptor.collisionVolumes.map((volume) => ({
        sourceNodeName: volume.nodeName,
        worldCenter: transformPointQuarterTurns(asVector(volume.center), placement),
        worldRotationY: (Number(volume.rotationY ?? 0) + yawQuarterTurns * Math.PI * 0.5)
          % (Math.PI * 2),
      }));
      assert.equal(transformed.length, descriptor.collisionVolumes.length);
      assert.equal(new Set(transformed.map(({ sourceNodeName }) => sourceNodeName)).size, transformed.length);
      for (let index = 0; index < transformed.length; index += 1) {
        assert.deepEqual(
          transformed[index].worldCenter,
          transformPointQuarterTurns(asVector(descriptor.collisionVolumes[index].center), placement),
        );
        assert.ok(Number.isFinite(transformed[index].worldRotationY));
      }
    }
  }
});
