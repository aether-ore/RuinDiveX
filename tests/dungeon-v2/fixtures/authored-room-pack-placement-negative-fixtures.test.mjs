import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileSemanticRoomPackPlacementV2,
  validateSemanticRoomPackPlacementV2,
  validateSemanticRoomPackPlanV2,
} from '../../../src/dungeon-v2/SemanticRoomPackPlanAdapterV2.js';
import { getSemanticRoomPackV1Descriptor } from '../../../src/dungeon-v2/SemanticRoomPackV1Catalog.js';
import { diagnosticCodes } from '../unit/authored-room-pack-test-support.mjs';

function compile(roomId, placementId, offset = 0) {
  const descriptor = getSemanticRoomPackV1Descriptor(roomId);
  const entry = descriptor.sockets.find(({ nodeName }) => nodeName.startsWith('SOCKET_ENTRY_'));
  return compileSemanticRoomPackPlacementV2(roomId, {
    placementId,
    entrySocketNodeName: entry.nodeName,
    targetPortal: {
      center: { x: 40 + offset, y: 3, z: -70 - offset },
      forward: { x: entry.forward[0], y: entry.forward[1], z: entry.forward[2] },
    },
    yawQuarterTurns: 0,
  });
}

function baselinePlacements(undercroftType = 'magma') {
  return [
    compile('rdx_factory_corkscrew_exchange', 'pack-placement.factory', 0),
    compile('rdx_waterworks_freight_sump', 'pack-placement.waterworks', 100),
    compile(
      undercroftType === 'magma'
        ? 'rdx_magma_foundry_undercroft'
        : 'rdx_electric_transformer_undercroft',
      `pack-placement.undercroft.${undercroftType}`,
      200,
    ),
  ];
}

test('negative fixture rejects transformed manifest collision drift', () => {
  const placement = structuredClone(compile(
    'rdx_factory_corkscrew_exchange',
    'pack-placement.collision-drift',
  ));
  placement.transformedCollisionVolumes[0].worldCenter.x += 0.25;
  // Keep the alias synchronized so this proves authored transform parity,
  // rather than merely detecting two divergent arrays.
  if (placement.compiledPhysicalRecords.colliders !== placement.transformedCollisionVolumes) {
    placement.compiledPhysicalRecords.colliders[0].worldCenter.x += 0.25;
  }
  const validation = validateSemanticRoomPackPlacementV2(placement);
  assert.equal(validation.accepted, false);
  assert.ok(diagnosticCodes(validation).includes('room-pack-collision-transform-drift'),
    JSON.stringify(validation.errors, null, 2));
});

test('negative fixture rejects placing the same authored pack room twice', () => {
  const placements = baselinePlacements('magma').map((placement) => structuredClone(placement));
  const duplicate = structuredClone(placements[0]);
  duplicate.placementId = 'pack-placement.factory-duplicate';
  const validation = validateSemanticRoomPackPlanV2({
    undercroftType: 'magma',
    semanticRoomPackPlacements: [...placements, duplicate],
  });
  assert.equal(validation.accepted, false);
  assert.ok(diagnosticCodes(validation).includes('room-pack-placement-duplicate'),
    JSON.stringify(validation.errors, null, 2));
});

test('negative fixture rejects Magma and Electrical Undercrofts in the same dungeon', () => {
  const placements = baselinePlacements('magma').map((placement) => structuredClone(placement));
  placements.push(compile(
    'rdx_electric_transformer_undercroft',
    'pack-placement.undercroft.electrical',
    300,
  ));
  const validation = validateSemanticRoomPackPlanV2({
    undercroftType: 'magma',
    semanticRoomPackPlacements: placements,
  });
  assert.equal(validation.accepted, false);
  assert.ok(diagnosticCodes(validation).includes('room-pack-undercroft-exclusive'),
    JSON.stringify(validation.errors, null, 2));
});
