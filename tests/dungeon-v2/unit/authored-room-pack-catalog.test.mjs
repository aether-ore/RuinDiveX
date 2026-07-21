import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEMANTIC_ROOM_PACK_V1_CATALOG,
  SEMANTIC_ROOM_PACK_V1_COLLISION_POLICY,
  SEMANTIC_ROOM_PACK_V1_ID,
  SEMANTIC_ROOM_PACK_V1_ORIGIN_POLICY,
  SEMANTIC_ROOM_PACK_V1_ROOM_BY_ID,
  SEMANTIC_ROOM_PACK_V1_ROOM_IDS,
  getSemanticRoomPackV1Descriptor,
  validateSemanticRoomPackV1Sources,
} from '../../../src/dungeon-v2/SemanticRoomPackV1Catalog.js';
import { isSerializablePlanValue } from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';
import {
  EXPECTED_PACK_ID,
  EXPECTED_ROOM_REPORTS,
  loadPackAssetFixture,
  sourceSemanticNodeNames,
} from './authored-room-pack-test-support.mjs';

const sources = loadPackAssetFixture();
const expectedRoomIds = Object.keys(EXPECTED_ROOM_REPORTS);
const parsedSemanticNodesByRoomId = Object.fromEntries(Object.entries(sources.gltfs).map(([
  roomId,
  gltf,
]) => [roomId, gltf.nodes.map((node) => ({
  nodeName: node.name,
  position: node.translation ?? [0, 0, 0],
  extras: node.extras ?? {},
}))]));

test('room-pack catalog is immutable serializable source data with exact identity and inventory', () => {
  assert.equal(SEMANTIC_ROOM_PACK_V1_ID, EXPECTED_PACK_ID);
  assert.deepEqual(SEMANTIC_ROOM_PACK_V1_ROOM_IDS, expectedRoomIds);
  assert.equal(Object.isFrozen(SEMANTIC_ROOM_PACK_V1_CATALOG), true);
  assert.equal(Object.isFrozen(SEMANTIC_ROOM_PACK_V1_CATALOG.rooms), true);
  assert.equal(Object.isFrozen(SEMANTIC_ROOM_PACK_V1_ROOM_BY_ID), true);
  assert.equal(isSerializablePlanValue(SEMANTIC_ROOM_PACK_V1_CATALOG), true);
  assert.doesNotThrow(() => JSON.stringify(SEMANTIC_ROOM_PACK_V1_CATALOG));
  assert.deepEqual(SEMANTIC_ROOM_PACK_V1_CATALOG.placementPolicy, {
    alignment: 'named-entry-socket-to-planned-portal',
    allowedYawQuarterTurns: [0, 1, 2, 3],
    translationOnly: true,
    preserveAuthoredOrigin: true,
    preserveAuthoredScale: true,
    aggregateBoundsPlacementForbidden: true,
    visibleMeshBoundsCollisionForbidden: true,
  });
  assert.equal(SEMANTIC_ROOM_PACK_V1_CATALOG.collisionSourcePolicy, 'manifest-collision-volumes-only');
  assert.equal(SEMANTIC_ROOM_PACK_V1_CATALOG.sourceValidation.accepted, true);
  assert.deepEqual(SEMANTIC_ROOM_PACK_V1_CATALOG.sourceValidation.errors, []);
});

test('source validator independently accepts parsed GLB semantic nodes and all four reports', () => {
  const validation = validateSemanticRoomPackV1Sources({
    pack: sources.pack,
    manifests: sources.manifests,
    semanticValidationReport: sources.semanticValidationReport,
    khronosValidationReport: sources.khronosValidationReport,
    semanticNodesByRoomId: parsedSemanticNodesByRoomId,
  });
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.details, {
    packId: EXPECTED_PACK_ID,
    roomCount: 4,
    manifestCount: 4,
    semanticReportCount: 4,
    khronosReportCount: 4,
  });
});

test('every descriptor preserves authored origin/scale and owns manifest collision explicitly', () => {
  for (const roomId of expectedRoomIds) {
    const descriptor = getSemanticRoomPackV1Descriptor(roomId);
    const manifest = sources.manifests[roomId];
    const expected = EXPECTED_ROOM_REPORTS[roomId];
    assert.equal(descriptor, SEMANTIC_ROOM_PACK_V1_ROOM_BY_ID[roomId]);
    assert.equal(Object.isFrozen(descriptor), true);
    assert.equal(descriptor.packId, EXPECTED_PACK_ID);
    assert.equal(descriptor.roomId, roomId);
    assert.equal(descriptor.authoredCoordinateSystem.originPolicy, SEMANTIC_ROOM_PACK_V1_ORIGIN_POLICY);
    assert.deepEqual(descriptor.authoredRootTransform, {
      origin: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      entryTierY: 0,
      recenter: false,
      preserveAuthoredScale: true,
    });
    assert.deepEqual(descriptor.authoredBounds, {
      min: { x: manifest.bounds.min[0], y: manifest.bounds.min[1], z: manifest.bounds.min[2] },
      max: { x: manifest.bounds.max[0], y: manifest.bounds.max[1], z: manifest.bounds.max[2] },
      useForPlacement: false,
      useForCollision: false,
    });
    assert.equal(descriptor.collisionSourcePolicy, SEMANTIC_ROOM_PACK_V1_COLLISION_POLICY);
    assert.match(descriptor.collisionPolicyStatement, /do not derive traversal collision from every visible mesh AABB/u);
    assert.deepEqual(descriptor.sockets, manifest.sockets);
    assert.deepEqual(descriptor.collisionVolumes, manifest.collisionVolumes);
    assert.equal(descriptor.collisionVolumes.length, expected.collisionVolumes);
    assert.equal(descriptor.sourceIntegrity.assetSha256, expected.sha256);
    assert.equal(descriptor.sourceIntegrity.assetBytes, expected.bytes);
    assert.deepEqual(
      new Set(descriptor.semanticNodeNames),
      new Set(sourceSemanticNodeNames(manifest).concat(
        descriptor.semanticMarkers.map(({ nodeName }) => nodeName),
      )),
    );
    assert.ok(descriptor.regions.length >= 4);
    assert.ok(descriptor.regions.every(({ id, localAnchor }) => (
      typeof id === 'string' && Array.isArray(localAnchor) && localAnchor.length === 3
    )));
  }
  assert.throws(
    () => getSemanticRoomPackV1Descriptor('rdx_missing_generic_corridor'),
    /Unknown semantic room pack V1 room/u,
  );
});

test('catalog implementation contains no THREE runtime objects or bounds-derived placement policy', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL('../../../src/dungeon-v2/SemanticRoomPackV1Catalog.js', import.meta.url),
    'utf8',
  ));
  assert.doesNotMatch(source, /from ['"]three(?:\/|['"])/u);
  assert.doesNotMatch(source, /new THREE\./u);
  assert.doesNotMatch(source, /Box3\s*\(.*setFromObject/u);
  assert.doesNotMatch(source, /position\.y\s*=\s*-\s*(?:bounds|box)\.min\.y/u);
});
