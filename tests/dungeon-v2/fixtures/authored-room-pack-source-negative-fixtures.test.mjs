import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSemanticRoomPackV1Sources } from '../../../src/dungeon-v2/SemanticRoomPackV1Catalog.js';
import {
  diagnosticCodes,
  loadPackAssetFixture,
} from '../unit/authored-room-pack-test-support.mjs';

const sources = loadPackAssetFixture();

function parsedSemanticNodes() {
  return Object.fromEntries(Object.entries(sources.gltfs).map(([roomId, gltf]) => [
    roomId,
    gltf.nodes.map((node) => ({
      nodeName: node.name,
      position: node.translation ?? [0, 0, 0],
      extras: node.extras ?? {},
    })),
  ]));
}

function validateWithNodes(semanticNodesByRoomId) {
  return validateSemanticRoomPackV1Sources({
    pack: sources.pack,
    manifests: sources.manifests,
    semanticValidationReport: sources.semanticValidationReport,
    khronosValidationReport: sources.khronosValidationReport,
    semanticNodesByRoomId,
  });
}

test('negative fixture rejects a manifest socket that drifts from its authored GLB node', () => {
  const nodes = parsedSemanticNodes();
  const entry = nodes.rdx_factory_corkscrew_exchange.find(({ nodeName }) => (
    nodeName === 'SOCKET_ENTRY_SOUTH'
  ));
  entry.position[0] += 0.25;
  const validation = validateWithNodes(nodes);
  assert.equal(validation.accepted, false);
  assert.ok(diagnosticCodes(validation).includes('room-pack-socket-node-drift'),
    JSON.stringify(validation.errors, null, 2));
});

test('negative fixture rejects a required semantic node absent from the parsed GLB contract', () => {
  const nodes = parsedSemanticNodes();
  nodes.rdx_waterworks_freight_sump = nodes.rdx_waterworks_freight_sump.filter(({ nodeName }) => (
    nodeName !== 'CONSOLE_MASTER_ROUTING'
  ));
  const validation = validateWithNodes(nodes);
  assert.equal(validation.accepted, false);
  assert.ok(diagnosticCodes(validation).includes('room-pack-semantic-node-missing'),
    JSON.stringify(validation.errors, null, 2));
});
