import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOM_PACK_ROOT = fileURLToPath(new URL(
  '../../../assets/models/rooms/ruindivex-room-pack-v1/',
  import.meta.url,
));

export const EXPECTED_PACK_ID = 'ruindivex-threejs-room-pack-v1';

export const EXPECTED_ROOM_REPORTS = Object.freeze({
  rdx_factory_corkscrew_exchange: Object.freeze({
    bytes: 365284,
    sha256: 'a1e1f878319029c1accbbed8913d2a1c3c0b89c3a8db07222c0875cf3831e330',
    nodes: 101,
    meshes: 85,
    materials: 6,
    embeddedImages: 6,
    sockets: 4,
    collisionVolumes: 68,
    traversalEdges: 6,
    bounds: Object.freeze({ min: [-18, -4.2, -17], max: [18, 15.5, 17] }),
  }),
  rdx_waterworks_freight_sump: Object.freeze({
    bytes: 422032,
    sha256: '004ce0d1bfe7e300d0cc6ee087a81a25ff834a3168ffec4b1ed9a26b76a5e122',
    nodes: 124,
    meshes: 110,
    materials: 7,
    embeddedImages: 7,
    sockets: 4,
    collisionVolumes: 106,
    traversalEdges: 5,
    bounds: Object.freeze({ min: [-19, -5.3, -21], max: [19, 14.5, 21] }),
  }),
  rdx_magma_foundry_undercroft: Object.freeze({
    bytes: 375784,
    sha256: '27aef325fc96a7ac0df52ff83e7f30fba402581cea656b0b5dd8e362bb0594f5',
    nodes: 98,
    meshes: 87,
    materials: 6,
    embeddedImages: 6,
    sockets: 3,
    collisionVolumes: 84,
    traversalEdges: 4,
    bounds: Object.freeze({ min: [-17, -4, -18], max: [17, 13, 18] }),
  }),
  rdx_electric_transformer_undercroft: Object.freeze({
    bytes: 525380,
    sha256: 'd6480898dab56e7384d96d5c88118819fd7008a5493a50efeaad95e8aec1553e',
    nodes: 132,
    meshes: 119,
    materials: 8,
    embeddedImages: 8,
    sockets: 3,
    collisionVolumes: 86,
    traversalEdges: 5,
    bounds: Object.freeze({ min: [-17, -3.8, -18], max: [17, 13.5, 18] }),
  }),
});

export const EXPECTED_PACK_INVENTORY = Object.freeze([
  'CURRENT_THREEJS_STATE_REVIEW.md',
  'README.md',
  'glb/rdx_electric_transformer_undercroft.glb',
  'glb/rdx_factory_corkscrew_exchange.glb',
  'glb/rdx_magma_foundry_undercroft.glb',
  'glb/rdx_waterworks_freight_sump.glb',
  'manifests/rdx_electric_transformer_undercroft.json',
  'manifests/rdx_factory_corkscrew_exchange.json',
  'manifests/rdx_magma_foundry_undercroft.json',
  'manifests/rdx_waterworks_freight_sump.json',
  'previews/rdx_electric_transformer_undercroft.png',
  'previews/rdx_factory_corkscrew_exchange.png',
  'previews/rdx_magma_foundry_undercroft.png',
  'previews/rdx_waterworks_freight_sump.png',
  'previews/ruindivex_room_pack_v1_montage.png',
  'room-pack.json',
  'semantic-validation-report.json',
  'textures/electric_coil.png',
  'textures/electric_conduit.png',
  'textures/electric_floor.png',
  'textures/electric_grid.png',
  'textures/electric_insulated.png',
  'textures/electric_wall.png',
  'textures/factory_cyan.png',
  'textures/factory_floor.png',
  'textures/factory_grate.png',
  'textures/factory_hazard.png',
  'textures/factory_rust.png',
  'textures/factory_wall.png',
  'textures/magma_border.png',
  'textures/magma_furnace.png',
  'textures/magma_safe.png',
  'textures/magma_surface.png',
  'textures/magma_wall.png',
  'textures/water_arrow.png',
  'textures/water_control.png',
  'textures/water_pipe.png',
  'textures/water_surface.png',
  'textures/water_wall.png',
  'textures/wet_floor.png',
  'validation-report.json',
]);

export const LEGACY_V1_ROOM_IDS = Object.freeze([
  'v1-room.security-entrance',
  'v1-room.machine-factory',
  'v1-room.server-crypt',
  'v1-room.conveyor-gantry',
  'v1-room.credential-pyramid',
  'v1-room.parts-vault',
  'v1-room.enemy-nest',
  'v1-room.machine-core',
  'v1-room.refractor-shrine',
  'v1-room.coolant-relay',
  'v1-room.hazard-processing',
]);

export const REQUIRED_PACK_ROOM_IDS = Object.freeze([
  'rdx_factory_corkscrew_exchange',
  'rdx_waterworks_freight_sump',
]);

export const UNDERCROFT_PACK_ROOM_IDS = Object.freeze([
  'rdx_magma_foundry_undercroft',
  'rdx_electric_transformer_undercroft',
]);

export const SEMANTIC_NODE_PREFIX = /^(?:SOCKET|REGION|WALK|SHELL|SUPPORT|RAIL|MECH|FLUID|HAZARD|CONSOLE|ANCHOR)_/u;

export function readPackJson(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOM_PACK_ROOT, relativePath), 'utf8'));
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function recursivePackInventory(directory = ROOM_PACK_ROOT, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...recursivePackInventory(absolute, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

export function parseGlb(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('parseGlb requires a Buffer.');
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('Invalid GLB magic/header.');
  }
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  if (version !== 2) throw new Error(`Expected GLB version 2; received ${version}.`);
  if (declaredLength !== buffer.length) {
    throw new Error(`GLB declared ${declaredLength} bytes but contains ${buffer.length}.`);
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > buffer.length) throw new Error('GLB chunk exceeds declared length.');
    if (chunkType === 0x4E4F534A) {
      const jsonText = buffer.subarray(chunkStart, chunkEnd)
        .toString('utf8')
        .replace(/[\0\x20]+$/u, '');
      return JSON.parse(jsonText);
    }
    offset = chunkEnd;
  }
  throw new Error('GLB has no JSON chunk.');
}

export function loadPackAssetFixture() {
  const pack = readPackJson('room-pack.json');
  const semanticValidationReport = readPackJson('semantic-validation-report.json');
  const khronosValidationReport = readPackJson('validation-report.json');
  const manifests = {};
  const gltfs = {};
  const glbBuffers = {};
  for (const room of pack.rooms) {
    manifests[room.roomId] = readPackJson(room.manifest);
    const buffer = readFileSync(path.join(ROOM_PACK_ROOT, room.glb));
    glbBuffers[room.roomId] = buffer;
    gltfs[room.roomId] = parseGlb(buffer);
  }
  return {
    pack,
    manifests,
    gltfs,
    glbBuffers,
    semanticValidationReport,
    khronosValidationReport,
  };
}

export function normalizedQuarterTurns(value) {
  return ((Math.trunc(value) % 4) + 4) % 4;
}

export function rotatePointQuarterTurns(point, yawQuarterTurns) {
  const { x, y, z } = Array.isArray(point)
    ? { x: point[0], y: point[1], z: point[2] }
    : point;
  switch (normalizedQuarterTurns(yawQuarterTurns)) {
    case 0: return { x, y, z };
    case 1: return { x: z, y, z: -x };
    case 2: return { x: -x, y, z: -z };
    case 3: return { x: -z, y, z: x };
    default: throw new Error('Unreachable quarter-turn normalization.');
  }
}

export function expectedSocketPlacement(manifest, {
  entrySocketId,
  entrySocketNodeName,
  targetPortal,
  yawQuarterTurns,
}) {
  const socket = manifest.sockets.find((candidate) => (
    candidate.id === entrySocketId || candidate.nodeName === entrySocketNodeName
  ));
  if (!socket) throw new Error(`Missing entry socket ${entrySocketId ?? entrySocketNodeName}.`);
  const targetPosition = targetPortal.position ?? targetPortal.center;
  const rotatedPosition = rotatePointQuarterTurns(socket.position, yawQuarterTurns);
  const rotatedForward = rotatePointQuarterTurns(socket.forward, yawQuarterTurns);
  return {
    socket,
    translation: {
      x: targetPosition.x - rotatedPosition.x,
      y: targetPosition.y - rotatedPosition.y,
      z: targetPosition.z - rotatedPosition.z,
    },
    socketWorldPosition: { ...targetPosition },
    socketWorldForward: rotatedForward,
  };
}

export function transformPoint(point, transform) {
  const rotated = rotatePointQuarterTurns(point, transform.yawQuarterTurns);
  const translation = transform.translation ?? transform.position;
  return {
    x: rotated.x + translation.x,
    y: rotated.y + translation.y,
    z: rotated.z + translation.z,
  };
}

export function vectorAlmostEqual(actual, expected, epsilon = 1e-9) {
  return actual && expected
    && Math.abs(actual.x - expected.x) <= epsilon
    && Math.abs(actual.y - expected.y) <= epsilon
    && Math.abs(actual.z - expected.z) <= epsilon;
}

export function roomReportById(report, roomId) {
  return report.reports.find((entry) => entry.roomId === roomId);
}

export function khronosReportByRoomId(report, roomId) {
  const filename = `${roomId}.glb`;
  return report.reports.find((entry) => entry.file === filename);
}

export function sourceSemanticNodeNames(manifest) {
  const names = new Set();
  for (const socket of manifest.sockets ?? []) names.add(socket.nodeName);
  for (const collision of manifest.collisionVolumes ?? []) names.add(collision.nodeName);
  for (const nodeName of Object.keys(manifest.platformPurposes ?? {})) names.add(nodeName);
  if (manifest.fluidNetwork?.masterConsoleNode) names.add(manifest.fluidNetwork.masterConsoleNode);
  if (manifest.hazard?.node) names.add(manifest.hazard.node);
  if (manifest.controller?.consoleNode) names.add(manifest.controller.consoleNode);
  for (const fall of manifest.fallCatchments ?? []) {
    if (typeof fall.destinationNode === 'string') names.add(fall.destinationNode);
  }
  return [...names].sort();
}

export function diagnosticCodes(result) {
  return (result?.errors ?? result?.diagnostics ?? [])
    .map((entry) => typeof entry === 'string' ? entry : entry?.code)
    .filter(Boolean);
}

export function assertFrozenSerializable(value, assert) {
  assert.equal(Object.isFrozen(value), true, 'contract root must be frozen');
  assert.doesNotThrow(() => JSON.stringify(value));
  assert.doesNotMatch(JSON.stringify(value), /\[object (?:Function|Object3D|Mesh|Group)\]/u);
}
