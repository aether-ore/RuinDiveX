import roomPackSource from '../../assets/models/rooms/ruindivex-room-pack-v1/room-pack.json' with { type: 'json' };
import semanticValidationSource from '../../assets/models/rooms/ruindivex-room-pack-v1/semantic-validation-report.json' with { type: 'json' };
import khronosValidationSource from '../../assets/models/rooms/ruindivex-room-pack-v1/validation-report.json' with { type: 'json' };
import factoryManifestSource from '../../assets/models/rooms/ruindivex-room-pack-v1/manifests/rdx_factory_corkscrew_exchange.json' with { type: 'json' };
import waterworksManifestSource from '../../assets/models/rooms/ruindivex-room-pack-v1/manifests/rdx_waterworks_freight_sump.json' with { type: 'json' };
import magmaManifestSource from '../../assets/models/rooms/ruindivex-room-pack-v1/manifests/rdx_magma_foundry_undercroft.json' with { type: 'json' };
import electricManifestSource from '../../assets/models/rooms/ruindivex-room-pack-v1/manifests/rdx_electric_transformer_undercroft.json' with { type: 'json' };
import {
  clonePlanData,
  deepFreezePlan,
  isSerializablePlanValue,
} from './DungeonPlanV2Contract.js';
import {
  createPlanDiagnostic,
  hashPlanDiagnostics,
  sortPlanDiagnostics,
  stablePlanStringify,
} from './DungeonPlanDiagnostics.js';

export const SEMANTIC_ROOM_PACK_V1_ID = 'ruindivex-threejs-room-pack-v1';
export const SEMANTIC_ROOM_PACK_V1_REVISION = 1;
export const SEMANTIC_ROOM_PACK_V1_ORIGIN_POLICY = 'entry-tier origin; do not recenter from aggregate bounds';
export const SEMANTIC_ROOM_PACK_V1_COLLISION_POLICY = 'manifest-collision-volumes-only';

const ROOM_PACK_ROOT = 'assets/models/rooms/ruindivex-room-pack-v1';
const EXPECTED_ROOM_IDS = Object.freeze([
  'rdx_factory_corkscrew_exchange',
  'rdx_waterworks_freight_sump',
  'rdx_magma_foundry_undercroft',
  'rdx_electric_transformer_undercroft',
]);

const EXPECTED_SOURCE_INTEGRITY = deepFreezePlan({
  packContractHash: '7c89a21c',
  semanticValidationContractHash: '621d211f',
  khronosValidationContractHash: '960e621e',
  rooms: {
    rdx_factory_corkscrew_exchange: {
      manifestContractHash: '38cfa45c',
      assetSha256: 'a1e1f878319029c1accbbed8913d2a1c3c0b89c3a8db07222c0875cf3831e330',
      bytes: 365284,
      nodes: 101,
      meshes: 85,
      materials: 6,
      embeddedImages: 6,
      sockets: 4,
      collisionVolumes: 68,
      traversalEdges: 6,
    },
    rdx_waterworks_freight_sump: {
      manifestContractHash: '424560db',
      assetSha256: '004ce0d1bfe7e300d0cc6ee087a81a25ff834a3168ffec4b1ed9a26b76a5e122',
      bytes: 422032,
      nodes: 124,
      meshes: 110,
      materials: 7,
      embeddedImages: 7,
      sockets: 4,
      collisionVolumes: 106,
      traversalEdges: 5,
    },
    rdx_magma_foundry_undercroft: {
      manifestContractHash: '75f59899',
      assetSha256: '27aef325fc96a7ac0df52ff83e7f30fba402581cea656b0b5dd8e362bb0594f5',
      bytes: 375784,
      nodes: 98,
      meshes: 87,
      materials: 6,
      embeddedImages: 6,
      sockets: 3,
      collisionVolumes: 84,
      traversalEdges: 4,
    },
    rdx_electric_transformer_undercroft: {
      manifestContractHash: 'e5f164b3',
      assetSha256: 'd6480898dab56e7384d96d5c88118819fd7008a5493a50efeaad95e8aec1553e',
      bytes: 525380,
      nodes: 132,
      meshes: 119,
      materials: 8,
      embeddedImages: 8,
      sockets: 3,
      collisionVolumes: 86,
      traversalEdges: 5,
    },
  },
});

function semanticNode(nodeName, position, extras) {
  return { nodeName, position: [...position], extras: { ...extras } };
}

function electricPanelNodes() {
  const records = [];
  let index = 0;
  for (const x of [-8.8, -4.4, 0, 4.4, 8.8]) {
    for (const z of [-8.8, -4.4, 0, 4.4, 8.8]) {
      records.push(semanticNode(
        `HAZARD_ELECTRIC_PANEL_${String(index).padStart(2, '0')}`,
        [x, -3.42, z],
        {
          semantic: 'hazardSurface',
          collidable: false,
          hazardProfile: 'electric_floor_cycle_v1',
          phaseGroup: index % 3,
        },
      ));
      index += 1;
    }
  }
  return records;
}

// The marker records are a compact transcription of the authored semantic GLB
// nodes.  They are not inferred from render-mesh bounds.  Collision is supplied
// separately and exclusively by each manifest's collisionVolumes collection.
const AUTHORED_SEMANTIC_MARKERS = deepFreezePlan({
  rdx_factory_corkscrew_exchange: [
    semanticNode('ANCHOR_SAFE_LOWER', [0, -3.65, 3], { semantic: 'safeAnchor', anchorId: 'lower_catchment' }),
    semanticNode('MECH_SCREW_COLUMN', [0, 4.7, 0], { semantic: 'mechanismSupport', collidable: true, mechanismId: 'corkscrew_exchange' }),
    semanticNode('MECH_GEAR_PLATFORM', [0, 0.7, 0], { semantic: 'movingSurface', collidable: true, mechanismId: 'corkscrew_exchange', platformPurpose: 'CriticalTraverse' }),
    semanticNode('MECH_GEAR_ALIGNMENT_RING', [0, 1.08, 0], { semantic: 'mechanismIndicator', collidable: false, mechanismId: 'corkscrew_exchange' }),
    semanticNode('MECH_CONTROL_PEDESTAL', [0, 1.65, 0], { semantic: 'console', collidable: true, mechanismId: 'corkscrew_exchange', interactionId: 'corkscrew_pedestal' }),
    semanticNode('MECH_PEDESTAL_HANDWHEEL', [0, 2.4, 0.72], { semantic: 'mechanism', collidable: false, mechanismId: 'corkscrew_exchange' }),
    semanticNode('MECH_BRIDGE_SOUTH', [0, 1.05, 7.5], { semantic: 'movingSurface', collidable: true, mechanismId: 'corkscrew_exchange', bridgeDirection: 'SOUTH', pivotNode: 'PIVOT_BRIDGE_SOUTH' }),
    semanticNode('MECH_BRIDGE_EAST', [7.5, 1.05, 0], { semantic: 'movingSurface', collidable: true, mechanismId: 'corkscrew_exchange', bridgeDirection: 'EAST', pivotNode: 'PIVOT_BRIDGE_EAST' }),
    semanticNode('MECH_BRIDGE_NORTH', [0, 1.05, -7.5], { semantic: 'movingSurface', collidable: true, mechanismId: 'corkscrew_exchange', bridgeDirection: 'NORTH', pivotNode: 'PIVOT_BRIDGE_NORTH' }),
    semanticNode('MECH_BRIDGE_WEST', [-7.5, 1.05, 0], { semantic: 'movingSurface', collidable: true, mechanismId: 'corkscrew_exchange', bridgeDirection: 'WEST', pivotNode: 'PIVOT_BRIDGE_WEST' }),
    semanticNode('ANCHOR_MECHANISM_CONSOLE', [0, 2.65, 1.4], { semantic: 'interactionAnchor', interactionId: 'corkscrew_pedestal' }),
    semanticNode('ANCHOR_REWARD_TOP', [-13.5, 10, -2], { semantic: 'rewardAnchor', rewardTier: 'high' }),
    semanticNode('ANCHOR_ENCOUNTER_LOWER', [4.5, -3.55, -3], { semantic: 'encounterAnchor', clearanceRadius: 3 }),
    semanticNode('REGION_ENTRY', [0, 0, 10.5], { semantic: 'region', regionId: 'entry_apron' }),
    semanticNode('REGION_GEAR', [0, 0.7, 0], { semantic: 'region', regionId: 'corkscrew_platform' }),
    semanticNode('REGION_LOWER', [0, -3.6, 0], { semantic: 'region', regionId: 'recovery_floor' }),
  ],
  rdx_waterworks_freight_sump: [
    semanticNode('FLUID_FACTORY_WATER_LEVEL_FREIGHT', [0, -1.55, 0], { semantic: 'fluidSurface', collidable: false, fluidProfile: 'factory_water_v1', basinId: 'freight_sump', stableState: 'FreightSumpFilled' }),
    semanticNode('CONSOLE_MASTER_ROUTING', [0, 0.85, -12.9], { semantic: 'console', collidable: true, interactionId: 'master_water_routing' }),
    semanticNode('CONSOLE_VALVE_0', [-3.3, 0.9, -10.2], { semantic: 'console', collidable: true, interactionId: 'routing_valve_0' }),
    semanticNode('CONSOLE_VALVE_1', [0, 0.9, -10.2], { semantic: 'console', collidable: true, interactionId: 'routing_valve_1' }),
    semanticNode('CONSOLE_VALVE_2', [3.3, 0.9, -10.2], { semantic: 'console', collidable: true, interactionId: 'routing_valve_2' }),
    semanticNode('ANCHOR_REWARD_SUBMERGED', [-8, -3.35, 6], { semantic: 'rewardAnchor', discoveryId: 'submerged_salvage_cache' }),
    semanticNode('ANCHOR_REWARD_DRAINED', [16.2, -4.35, 7], { semantic: 'rewardAnchor', discoveryId: 'drained_tunnel_cache' }),
    semanticNode('ANCHOR_MASTER_CONSOLE', [0, 1.9, -11.8], { semantic: 'interactionAnchor', interactionId: 'master_water_routing' }),
    semanticNode('ANCHOR_SAFE_BASIN', [0, -4.6, 12], { semantic: 'safeAnchor', anchorId: 'sump_bottom' }),
    semanticNode('REGION_ENTRY_CATWALK', [0, 0, 15], { semantic: 'region', regionId: 'entry_catwalk' }),
    semanticNode('REGION_FREIGHT_SUMP', [0, -4.6, 0], { semantic: 'region', regionId: 'freight_sump' }),
    semanticNode('REGION_PUMP_DECK', [0, 0, -15], { semantic: 'region', regionId: 'pump_deck' }),
    semanticNode('REGION_DRAIN_TUNNEL', [16, -4.6, 7], { semantic: 'region', regionId: 'drain_tunnel' }),
    semanticNode('REGION_UPPER_GANTRY', [-15, 5.2, -7], { semantic: 'region', regionId: 'upper_gantry' }),
  ],
  rdx_magma_foundry_undercroft: [
    semanticNode('HAZARD_MAGMA_BASIN', [0, -3.7, 0], { semantic: 'hazardSurface', collidable: false, hazardProfile: 'magma_floor_v1' }),
    semanticNode('CONSOLE_COOLING_BYPASS', [0, 0.95, -12.2], { semantic: 'console', collidable: true, interactionId: 'foundry_cooling_bypass' }),
    semanticNode('ANCHOR_SAFE_LANDING', [-7.5, -2.65, 8], { semantic: 'safeAnchor', anchorId: 'magma_nominal_landing' }),
    semanticNode('ANCHOR_REWARD_HEAT_BRANCH', [-11, -0.9, -8], { semantic: 'rewardAnchor', rewardTier: 'high', suggestedUtility: 'heat_resist_chip' }),
    semanticNode('ANCHOR_ENCOUNTER_LOWER', [5.5, -1, -7], { semantic: 'encounterAnchor', clearanceRadius: 3, hazardAvoidance: true }),
    semanticNode('REGION_ENTRY_DECK', [0, 0, 13], { semantic: 'region', regionId: 'entry_deck' }),
    semanticNode('REGION_MAGMA_BASIN', [0, -2.6, 0], { semantic: 'region', regionId: 'magma_basin' }),
    semanticNode('REGION_HEAT_REWARD_BRANCH', [-10, -1, -6], { semantic: 'region', regionId: 'heat_reward_branch' }),
    semanticNode('REGION_CONTROL_DECK', [0, 0, -13], { semantic: 'region', regionId: 'control_deck' }),
  ],
  rdx_electric_transformer_undercroft: [
    ...electricPanelNodes(),
    semanticNode('CONSOLE_GROUNDING_ARRAY', [0, 0.95, -12], { semantic: 'console', collidable: true, interactionId: 'grounding_array' }),
    semanticNode('ANCHOR_SAFE_LANDING', [-8.8, -2.65, 8.8], { semantic: 'safeAnchor', anchorId: 'electric_nominal_landing' }),
    semanticNode('ANCHOR_REWARD_TIMING_BRANCH', [-4.4, -2.55, -8.8], { semantic: 'rewardAnchor', rewardTier: 'high' }),
    semanticNode('ANCHOR_GROUNDING_CONSOLE', [0, 2, -11], { semantic: 'interactionAnchor', interactionId: 'grounding_array' }),
    semanticNode('ANCHOR_ENCOUNTER_LOWER', [4.4, -2.5, 0], { semantic: 'encounterAnchor', clearanceRadius: 2.8, hazardAvoidance: true }),
    semanticNode('REGION_ENTRY_DECK', [0, 0, 13], { semantic: 'region', regionId: 'entry_deck' }),
    semanticNode('REGION_CYCLING_FLOOR', [0, -2.8, 0], { semantic: 'region', regionId: 'cycling_floor' }),
    semanticNode('REGION_TIMING_REWARD_BRANCH', [-7, -2.7, -7], { semantic: 'region', regionId: 'timing_reward_branch' }),
    semanticNode('REGION_SWITCH_DECK', [0, 0, -13], { semantic: 'region', regionId: 'switch_deck' }),
    semanticNode('REGION_UPPER_GALLERY', [14, 4.5, -5], { semantic: 'region', regionId: 'upper_gallery' }),
  ],
});

const SOURCE_MANIFESTS = deepFreezePlan([
  clonePlanData(factoryManifestSource),
  clonePlanData(waterworksManifestSource),
  clonePlanData(magmaManifestSource),
  clonePlanData(electricManifestSource),
]);

function finiteArray(value, count) {
  return Array.isArray(value)
    && value.length === count
    && value.every((entry) => Number.isFinite(entry));
}

function normalizeObjectCollection(value, identityKey) {
  if (Array.isArray(value)) {
    return Object.fromEntries(value
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => [entry[identityKey], entry]));
  }
  return value && typeof value === 'object' ? value : {};
}

function canonicalHash(value) {
  const source = stablePlanStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]));
}

function normalizeSemanticNodeRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.map((record) => {
    if (typeof record === 'string') return { nodeName: record };
    return {
      nodeName: record?.nodeName ?? record?.name ?? null,
      position: record?.position ?? record?.translation ?? null,
      extras: record?.extras ?? null,
    };
  }).filter(({ nodeName }) => typeof nodeName === 'string' && nodeName.length > 0);
}

function addDiagnostic(target, code, message, details = {}) {
  target.push(createPlanDiagnostic(code, message, details));
}

export function validateSemanticRoomPackV1Sources({
  pack = roomPackSource,
  manifests = SOURCE_MANIFESTS,
  semanticValidationReport = semanticValidationSource,
  khronosValidationReport = khronosValidationSource,
  semanticNodesByRoomId = null,
} = {}) {
  const errors = [];
  const manifestByRoomId = normalizeObjectCollection(manifests, 'roomId');
  const semanticReportByRoomId = normalizeObjectCollection(semanticValidationReport?.reports, 'roomId');
  const khronosByFile = normalizeObjectCollection(khronosValidationReport?.reports, 'file');
  const roomRecords = Array.isArray(pack?.rooms) ? pack.rooms : [];

  if (pack?.schemaVersion !== 1 || pack?.packId !== SEMANTIC_ROOM_PACK_V1_ID) {
    addDiagnostic(errors, 'room-pack-identity-drift', 'The semantic room pack identity or schema changed.', {
      actualPackId: pack?.packId ?? null,
      actualSchemaVersion: pack?.schemaVersion ?? null,
    });
  }
  if (canonicalHash(pack) !== EXPECTED_SOURCE_INTEGRITY.packContractHash) {
    addDiagnostic(errors, 'room-pack-index-integrity-drift', 'room-pack.json no longer matches the reviewed room pack contract.', {
      actual: canonicalHash(pack),
      expected: EXPECTED_SOURCE_INTEGRITY.packContractHash,
    });
  }
  if (canonicalHash(semanticValidationReport) !== EXPECTED_SOURCE_INTEGRITY.semanticValidationContractHash) {
    addDiagnostic(errors, 'room-pack-semantic-report-integrity-drift', 'The semantic validation report changed after review.', {
      actual: canonicalHash(semanticValidationReport),
      expected: EXPECTED_SOURCE_INTEGRITY.semanticValidationContractHash,
    });
  }
  if (canonicalHash(khronosValidationReport) !== EXPECTED_SOURCE_INTEGRITY.khronosValidationContractHash) {
    addDiagnostic(errors, 'room-pack-khronos-report-integrity-drift', 'The Khronos validation report changed after review.', {
      actual: canonicalHash(khronosValidationReport),
      expected: EXPECTED_SOURCE_INTEGRITY.khronosValidationContractHash,
    });
  }

  const actualRoomIds = roomRecords.map(({ roomId }) => roomId);
  if (!sameArray(actualRoomIds, EXPECTED_ROOM_IDS) || new Set(actualRoomIds).size !== actualRoomIds.length) {
    addDiagnostic(errors, 'room-pack-room-inventory-drift', 'The semantic room pack must contain the four reviewed rooms in stable order.', {
      actualRoomIds,
      expectedRoomIds: EXPECTED_ROOM_IDS,
    });
  }
  if (semanticValidationReport?.packId !== SEMANTIC_ROOM_PACK_V1_ID || semanticValidationReport?.status !== 'passed') {
    addDiagnostic(errors, 'room-pack-semantic-report-rejected', 'The room pack semantic validation report is not a passing report.', {
      packId: semanticValidationReport?.packId ?? null,
      status: semanticValidationReport?.status ?? null,
    });
  }
  if (khronosValidationReport?.validator !== 'Khronos glTF Validator') {
    addDiagnostic(errors, 'room-pack-khronos-validator-drift', 'The GLB report was not produced by the required Khronos validator.', {
      validator: khronosValidationReport?.validator ?? null,
    });
  }

  for (const roomRecord of roomRecords) {
    const roomId = roomRecord?.roomId;
    const manifest = manifestByRoomId[roomId];
    const expected = EXPECTED_SOURCE_INTEGRITY.rooms[roomId];
    const semanticReport = semanticReportByRoomId[roomId];
    const glbFile = typeof roomRecord?.glb === 'string' ? roomRecord.glb.split('/').at(-1) : null;
    const khronosReport = glbFile ? khronosByFile[glbFile] : null;
    const defaultSemanticNodes = manifest ? [
      ...manifest.sockets.map((socket) => ({
        nodeName: socket.nodeName,
        position: socket.position,
        extras: { socketId: socket.id },
      })),
      ...manifest.collisionVolumes.map((volume) => ({
        nodeName: volume.nodeName,
        position: volume.center,
        extras: { semantic: volume.semantic },
      })),
      ...(AUTHORED_SEMANTIC_MARKERS[roomId] ?? []),
    ] : [];
    const parsedSemanticNodes = normalizeSemanticNodeRecords(
      semanticNodesByRoomId?.[roomId] ?? defaultSemanticNodes,
    );
    const parsedSemanticNodeByName = Object.fromEntries(parsedSemanticNodes.map((record) => [record.nodeName, record]));

    if (!manifest || !expected) {
      addDiagnostic(errors, 'room-pack-manifest-missing', 'A reviewed room has no matching manifest.', { roomId: roomId ?? null });
      continue;
    }
    if (canonicalHash(manifest) !== expected.manifestContractHash) {
      addDiagnostic(errors, 'room-pack-manifest-integrity-drift', 'A room manifest changed after review.', {
        roomId,
        actual: canonicalHash(manifest),
        expected: expected.manifestContractHash,
      });
    }
    if (manifest.schemaVersion !== 1
      || manifest.roomId !== roomId
      || manifest.units !== 'meters'
      || manifest.upAxis !== 'Y'
      || manifest.forwardAxis !== '-Z'
      || manifest.originPolicy !== SEMANTIC_ROOM_PACK_V1_ORIGIN_POLICY) {
      addDiagnostic(errors, 'room-pack-coordinate-contract-drift', 'A room no longer uses the reviewed Y-up, metre, entry-tier coordinate contract.', {
        roomId,
        schemaVersion: manifest.schemaVersion ?? null,
        units: manifest.units ?? null,
        upAxis: manifest.upAxis ?? null,
        forwardAxis: manifest.forwardAxis ?? null,
        originPolicy: manifest.originPolicy ?? null,
      });
    }
    const normalizedManifestGlb = String(manifest.glb ?? '').replace(/^\.\.\//, '');
    if (normalizedManifestGlb !== roomRecord.glb
      || manifest.archetype !== roomRecord.archetype
      || !sameArray(manifest.districts, roomRecord.districts)) {
      addDiagnostic(errors, 'room-pack-index-manifest-drift', 'room-pack.json and its room manifest disagree.', {
        roomId,
        packGlb: roomRecord.glb ?? null,
        manifestGlb: manifest.glb ?? null,
      });
    }
    if (!finiteArray(manifest.bounds?.min, 3)
      || !finiteArray(manifest.bounds?.max, 3)
      || !manifest.bounds.min.every((value, index) => value <= manifest.bounds.max[index])) {
      addDiagnostic(errors, 'room-pack-bounds-invalid', 'Authored aggregate bounds must be finite metadata.', { roomId });
    }

    const sockets = Array.isArray(manifest.sockets) ? manifest.sockets : [];
    const socketIds = new Set();
    const socketNodeNames = new Set();
    for (const socket of sockets) {
      const duplicate = socketIds.has(socket.id) || socketNodeNames.has(socket.nodeName);
      socketIds.add(socket.id);
      socketNodeNames.add(socket.nodeName);
      if (duplicate
        || !finiteArray(socket.position, 3)
        || !finiteArray(socket.forward, 3)
        || !finiteArray(socket.aperture, 2)
        || socket.position[1] !== socket.elevation) {
        addDiagnostic(errors, 'room-pack-socket-invalid', 'A socket is duplicate or has invalid authored geometry.', {
          roomId,
          socketId: socket?.id ?? null,
          nodeName: socket?.nodeName ?? null,
        });
      }
      const parsedNode = parsedSemanticNodeByName[socket.nodeName];
      if (!parsedNode) {
        addDiagnostic(errors, 'room-pack-semantic-node-missing', 'A manifest socket has no matching authored GLB semantic node.', {
          roomId,
          nodeName: socket.nodeName,
        });
      } else if ((parsedNode.position && !sameArray(parsedNode.position, socket.position))
        || (parsedNode.extras?.socketId && parsedNode.extras.socketId !== socket.id)) {
        addDiagnostic(errors, 'room-pack-socket-node-drift', 'A manifest socket disagrees with its authored GLB semantic node.', {
          roomId,
          socketId: socket.id,
          nodeName: socket.nodeName,
        });
      }
    }
    if (sockets.filter(({ nodeName }) => /^SOCKET_ENTRY_/.test(nodeName)).length !== 1) {
      addDiagnostic(errors, 'room-pack-entry-socket-invalid', 'Every authored room requires exactly one named SOCKET_ENTRY_* socket.', { roomId });
    }

    const collisionVolumes = Array.isArray(manifest.collisionVolumes) ? manifest.collisionVolumes : [];
    const collisionNodeNames = new Set();
    for (const volume of collisionVolumes) {
      const shapeValid = volume.shape === 'box'
        ? finiteArray(volume.center, 3) && finiteArray(volume.size, 3) && Number.isFinite(volume.rotationY)
        : volume.shape === 'cylinder'
          && finiteArray(volume.center, 3)
          && Number.isFinite(volume.radius)
          && Number.isFinite(volume.height);
      if (collisionNodeNames.has(volume.nodeName) || !shapeValid || typeof volume.semantic !== 'string') {
        addDiagnostic(errors, 'room-pack-collision-volume-invalid', 'Manifest collision volumes must be unique, finite boxes or cylinders.', {
          roomId,
          nodeName: volume?.nodeName ?? null,
          shape: volume?.shape ?? null,
        });
      }
      collisionNodeNames.add(volume.nodeName);
      if (!parsedSemanticNodeByName[volume.nodeName]) {
        addDiagnostic(errors, 'room-pack-semantic-node-missing', 'A manifest collision volume has no matching authored GLB semantic node.', {
          roomId,
          nodeName: volume.nodeName,
        });
      }
    }

    const requiredReferences = [
      manifest.fluidNetwork?.masterConsoleNode,
      manifest.hazard?.node,
      manifest.controller?.consoleNode,
      ...AUTHORED_SEMANTIC_MARKERS[roomId]
        .filter(({ extras }) => ['safeAnchor', 'rewardAnchor', 'encounterAnchor', 'interactionAnchor', 'region', 'hazardSurface', 'fluidSurface'].includes(extras.semantic))
        .map(({ nodeName }) => nodeName),
    ].filter(Boolean);
    for (const nodeName of requiredReferences) {
      if (!parsedSemanticNodeByName[nodeName]) {
        addDiagnostic(errors, 'room-pack-semantic-node-missing', 'A required gameplay semantic node is absent from the authored GLB contract.', {
          roomId,
          nodeName,
        });
      }
    }

    if (!semanticReport) {
      addDiagnostic(errors, 'room-pack-semantic-report-room-missing', 'A room has no semantic validation report entry.', { roomId });
    } else {
      const reportFields = ['bytes', 'nodes', 'meshes', 'materials', 'embeddedImages', 'sockets', 'collisionVolumes', 'traversalEdges'];
      const mismatchedFields = reportFields.filter((field) => semanticReport[field] !== expected[field]);
      if (semanticReport.sha256 !== expected.assetSha256
        || mismatchedFields.length > 0
        || !sameArray(semanticReport.bounds?.min, manifest.bounds?.min)
        || !sameArray(semanticReport.bounds?.max, manifest.bounds?.max)
        || semanticReport.sockets !== sockets.length
        || semanticReport.collisionVolumes !== collisionVolumes.length
        || semanticReport.traversalEdges !== (manifest.traversalEdges?.length ?? 0)) {
        addDiagnostic(errors, 'room-pack-semantic-report-parity-failed', 'A semantic validation report no longer matches its manifest and reviewed GLB fingerprint.', {
          roomId,
          mismatchedFields,
        });
      }
    }
    if (!khronosReport
      || khronosReport.bytes !== expected.bytes
      || ['errors', 'warnings', 'infos', 'hints'].some((key) => khronosReport[key] !== 0)
      || !Array.isArray(khronosReport.messages)
      || khronosReport.messages.length !== 0) {
      addDiagnostic(errors, 'room-pack-khronos-validation-failed', 'A room GLB lacks a clean Khronos validation report.', {
        roomId,
        file: glbFile,
      });
    }
  }

  const sortedErrors = sortPlanDiagnostics(errors);
  return deepFreezePlan({
    accepted: sortedErrors.length === 0,
    errors: sortedErrors,
    diagnosticHash: hashPlanDiagnostics(sortedErrors),
    details: {
      packId: pack?.packId ?? null,
      roomCount: roomRecords.length,
      manifestCount: Object.keys(manifestByRoomId).length,
      semanticReportCount: Object.keys(semanticReportByRoomId).length,
      khronosReportCount: Object.keys(khronosByFile).length,
    },
  });
}

function regionRecordsForManifest(manifest, markers) {
  const markerRegions = markers.filter(({ extras }) => extras.semantic === 'region');
  const declaredRegionIds = Array.isArray(manifest.regions)
    ? manifest.regions
    : markerRegions.map(({ extras }) => extras.regionId);
  const markerByRegionId = Object.fromEntries(markerRegions.map((marker) => [marker.extras.regionId, marker]));
  const walkableByName = Object.fromEntries(manifest.collisionVolumes
    .filter(({ semantic }) => semantic === 'walkable' || semantic === 'recoveryCatchment')
    .map((volume) => [volume.nodeName, volume]));
  const fallbackNodeByRegionId = {
    east_mid_ledge: 'WALK_EAST_MID_LEDGE',
    north_high_ledge: 'WALK_NORTH_HIGH_LEDGE',
    west_top_ledge: 'WALK_WEST_TOP_LEDGE',
  };
  return declaredRegionIds.map((regionId) => {
    const marker = markerByRegionId[regionId];
    const fallback = walkableByName[fallbackNodeByRegionId[regionId]];
    return {
      id: regionId,
      nodeName: marker?.nodeName ?? fallback?.nodeName ?? null,
      localAnchor: marker?.position ?? fallback?.center ?? null,
      source: marker ? 'authored-semantic-region-node' : 'authored-manifest-walkable-volume',
    };
  });
}

function createRoomDescriptor(roomRecord, manifest, semanticReport) {
  const markers = AUTHORED_SEMANTIC_MARKERS[roomRecord.roomId];
  const semanticNodeNames = [...new Set([
    ...manifest.sockets.map(({ nodeName }) => nodeName),
    ...manifest.collisionVolumes.map(({ nodeName }) => nodeName),
    ...markers.map(({ nodeName }) => nodeName),
  ])].sort();
  const integrity = EXPECTED_SOURCE_INTEGRITY.rooms[roomRecord.roomId];
  return {
    schemaVersion: 1,
    revision: SEMANTIC_ROOM_PACK_V1_REVISION,
    packId: SEMANTIC_ROOM_PACK_V1_ID,
    roomId: roomRecord.roomId,
    archetype: manifest.archetype,
    topologyVariant: manifest.topologyVariant,
    districts: [...manifest.districts],
    gameplayPurpose: manifest.gameplayPurpose,
    assetPath: `${ROOM_PACK_ROOT}/${roomRecord.glb}`,
    manifestPath: `${ROOM_PACK_ROOT}/${roomRecord.manifest}`,
    previewPath: `${ROOM_PACK_ROOT}/${roomRecord.preview}`,
    authoredCoordinateSystem: {
      units: manifest.units,
      upAxis: manifest.upAxis,
      forwardAxis: manifest.forwardAxis,
      originPolicy: manifest.originPolicy,
    },
    authoredRootTransform: {
      origin: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      entryTierY: 0,
      recenter: false,
      preserveAuthoredScale: true,
    },
    authoredBounds: {
      min: { x: manifest.bounds.min[0], y: manifest.bounds.min[1], z: manifest.bounds.min[2] },
      max: { x: manifest.bounds.max[0], y: manifest.bounds.max[1], z: manifest.bounds.max[2] },
      useForPlacement: false,
      useForCollision: false,
    },
    collisionSourcePolicy: SEMANTIC_ROOM_PACK_V1_COLLISION_POLICY,
    collisionPolicyStatement: manifest.collisionPolicy,
    sockets: clonePlanData(manifest.sockets),
    collisionVolumes: clonePlanData(manifest.collisionVolumes),
    regions: regionRecordsForManifest(manifest, markers),
    traversalEdges: clonePlanData(manifest.traversalEdges ?? []),
    mechanisms: clonePlanData(manifest.mechanisms ?? []),
    controller: clonePlanData(manifest.controller ?? null),
    fluidNetwork: clonePlanData(manifest.fluidNetwork ?? null),
    hazard: clonePlanData(manifest.hazard ?? null),
    criticalRouteDamageFree: manifest.criticalRouteDamageFree ?? null,
    discoveries: clonePlanData(manifest.discoveries ?? []),
    fallCatchments: clonePlanData(manifest.fallCatchments ?? []),
    platformPurposes: clonePlanData(manifest.platformPurposes ?? {}),
    semanticMarkers: clonePlanData(markers),
    semanticNodeNames,
    sourceManifest: clonePlanData(manifest),
    sourceIntegrity: {
      assetSha256: integrity.assetSha256,
      assetBytes: integrity.bytes,
      manifestContractHash: integrity.manifestContractHash,
      semanticReport: clonePlanData(semanticReport),
    },
  };
}

const sourceValidation = validateSemanticRoomPackV1Sources();
if (!sourceValidation.accepted) {
  const first = sourceValidation.errors[0];
  throw new Error(`Semantic room pack V1 source rejected: ${first.code}: ${first.message}`);
}

const sourcePack = clonePlanData(roomPackSource);
const semanticReportsByRoomId = normalizeObjectCollection(semanticValidationSource.reports, 'roomId');
const manifestsByRoomId = normalizeObjectCollection(SOURCE_MANIFESTS, 'roomId');

export const SEMANTIC_ROOM_PACK_V1_CATALOG = deepFreezePlan({
  schemaVersion: 1,
  revision: SEMANTIC_ROOM_PACK_V1_REVISION,
  packId: SEMANTIC_ROOM_PACK_V1_ID,
  sourceRoot: ROOM_PACK_ROOT,
  collisionSourcePolicy: SEMANTIC_ROOM_PACK_V1_COLLISION_POLICY,
  placementPolicy: {
    alignment: 'named-entry-socket-to-planned-portal',
    allowedYawQuarterTurns: [0, 1, 2, 3],
    translationOnly: true,
    preserveAuthoredOrigin: true,
    preserveAuthoredScale: true,
    aggregateBoundsPlacementForbidden: true,
    visibleMeshBoundsCollisionForbidden: true,
  },
  rooms: sourcePack.rooms.map((roomRecord) => createRoomDescriptor(
    roomRecord,
    manifestsByRoomId[roomRecord.roomId],
    semanticReportsByRoomId[roomRecord.roomId],
  )),
  sourceValidation,
});

export const SEMANTIC_ROOM_PACK_V1_ROOM_IDS = deepFreezePlan(
  SEMANTIC_ROOM_PACK_V1_CATALOG.rooms.map(({ roomId }) => roomId),
);

export const SEMANTIC_ROOM_PACK_V1_ROOM_BY_ID = deepFreezePlan(Object.fromEntries(
  SEMANTIC_ROOM_PACK_V1_CATALOG.rooms.map((room) => [room.roomId, room]),
));

if (!isSerializablePlanValue(SEMANTIC_ROOM_PACK_V1_CATALOG)) {
  throw new TypeError('SemanticRoomPackV1 catalog must remain serializable plan data.');
}

export function getSemanticRoomPackV1Descriptor(roomId) {
  const descriptor = SEMANTIC_ROOM_PACK_V1_ROOM_BY_ID[roomId];
  if (!descriptor) {
    throw new RangeError(`Unknown semantic room pack V1 room: ${roomId}`);
  }
  return descriptor;
}

export function cloneSemanticRoomPackV1Descriptor(roomId) {
  return clonePlanData(getSemanticRoomPackV1Descriptor(roomId));
}

export default SEMANTIC_ROOM_PACK_V1_CATALOG;
