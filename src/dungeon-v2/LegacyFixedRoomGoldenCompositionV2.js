import {
  deepFreezePlan,
  isSerializablePlanValue,
} from './DungeonPlanV2Contract.js';
import {
  LEGACY_FIXED_ROOM_MODULE_CATALOG_V2,
  getLegacyFixedRoomModuleV2,
} from './LegacyFixedRoomModuleCatalogV2.js';
import {
  compileLegacyFixedRoomPlacementV2,
  compileLegacyFixedRoomStructuralContractV2,
  createLegacyFixedRoomPlanPlacementRecordV2,
  recompileAcceptedLegacyFixedRoomPlacementV2,
} from './LegacyFixedRoomRuntimeAdapterV2.js';
import { rotatePointQuarterTurns } from './DungeonSpatialMathV2.js';

export const LEGACY_FIXED_ROOM_GOLDEN_COMPOSITION_REVISION_V2 = 2;

const BODY_CLEARANCE = 0.4;
const EPSILON = 1e-6;

export const LEGACY_FIXED_ROOM_GOLDEN_PLACEMENT_SPECS_V2 = deepFreezePlan([
  placement('security', 'v1-room.security-entrance', 0, 0, 0, 0),
  placement('machine', 'v1-room.machine-factory', 0, 0, -75, 0),
  placement('server', 'v1-room.server-crypt', 70, 0, 0, 3),
  placement('coolant', 'v1-room.coolant-relay', 70, 0, -75, 2),
  placement('conveyor', 'v1-room.conveyor-gantry', 0, 0, -150, 0),
  placement('credential', 'v1-room.credential-pyramid', 80, 3, -150, 1),
  placement('parts', 'v1-room.parts-vault', 80, 0, -230, 2),
  placement('nest', 'v1-room.enemy-nest', 150, 0, -230, 3, { optional: true }),
  placement('core', 'v1-room.machine-core', 150, 3, -150, 0),
  placement('shrine', 'v1-room.refractor-shrine', 240, 0, -150, 2),
  placement('hazard', 'v1-room.hazard-processing', 0, 0, -230, 0),
]);

export const LEGACY_FIXED_ROOM_GOLDEN_CONNECTION_SPECS_V2 = deepFreezePlan([
  connection('security-machine-entry', 'security', 'ground.south-center', 'machine', 'ground.south-east-bucket', {
    connectorProfileId: 'enclosed-double-elbow-bulkhead-v2',
  }),
  connection('machine-coolant-upper-loop', 'machine', 'catwalk.north-center', 'coolant', 'catwalk.north-east-bucket'),
  connection('coolant-security-recall-loop', 'security', 'lift.west-south-bucket', 'coolant', 'lift.west-center'),
  connection('security-server-branch', 'security', 'ground.east-south-bucket', 'server', 'ground.south-east-bucket'),
  connection('server-conveyor-upper-route', 'server', 'catwalk.north-center', 'conveyor', 'catwalk.west-south-bucket'),
  connection('machine-coolant-pipe-route', 'machine', 'pipe.east-center', 'coolant', 'pipe.east-center'),
  connection('conveyor-credential-lift', 'conveyor', 'lift.south-west-bucket', 'credential', 'lift.east-north-bucket'),
  connection('credential-core-forward-gate', 'credential', 'ground.south-east-bucket', 'core', 'ground.west-south-bucket'),
  connection('core-shrine-gear-bridge', 'core', 'gear.north-upper', 'shrine', 'catwalk.north-east-bucket'),
  connection('conveyor-hazard-pipe', 'conveyor', 'pipe.east-north-bucket', 'hazard', 'pipe.west-south-bucket'),
  connection('hazard-parts-ground-return', 'parts', 'ground.south-east-bucket', 'hazard', 'ground.south-east-bucket'),
  connection('hazard-parts-lift-return', 'parts', 'lift.east-south-bucket', 'hazard', 'lift.east-center'),
  connection('core-credential-shortcut-loop', 'core', 'ground.east-north-bucket', 'credential', 'ground.north-west-bucket'),
  connection('parts-nest-overhead-service', 'parts', 'ladder.ceiling-west-north', 'nest', 'ladder.ceiling-rear', {
    connectorProfileId: 'dual-service-ladder-overhead-gallery-v2',
    optionalBranch: true,
    ladderFacing: {
      from: { x: 0, y: 0, z: 1 },
      to: { x: 0, y: 0, z: -1 },
    },
  }),
]);

export const LEGACY_FIXED_ROOM_GOLDEN_INTERNAL_BINDINGS_V2 = deepFreezePlan([
  internalBinding(
    'machine-freight-catchment',
    'machine',
    'lower.freight-catchment',
    'freight',
    'damage-free intentional descent into a playable freight catchment with a permanent return',
  ),
  internalBinding(
    'hazard-core-catchment',
    'hazard',
    'lower.intentional-west',
    'hazard-core',
    'damage-free intentional descent into the purpose-built lower cavern and flush stair return',
  ),
]);

export const LEGACY_FIXED_ROOM_GOLDEN_EXPLICIT_CAPS_V2 = deepFreezePlan([
  cap('security', 'ground.north-center'),
  cap('coolant', 'ground.south-west-bucket'),
  cap('server', 'ladder.ceiling-east-catwalk'),
  cap('conveyor', 'ground.north-east-bucket'),
  cap('nest', 'ground.west-center'),
  cap('nest', 'catwalk.east-rear'),
  cap('core', 'lower.undercroft-mouth'),
  cap('shrine', 'ground.south-west-bucket'),
]);

function placement(id, descriptorId, x, y, z, yawQuarterTurns, options = {}) {
  return {
    id: `placement.${id}`,
    key: id,
    descriptorId,
    translation: { x, y, z },
    yawQuarterTurns,
    optional: options.optional === true,
  };
}

function connection(id, fromPlacementKey, fromSocketSuffix, toPlacementKey, toSocketSuffix, options = {}) {
  return {
    id: `connection.${id}`,
    from: { placementKey: fromPlacementKey, socketSuffix: fromSocketSuffix },
    to: { placementKey: toPlacementKey, socketSuffix: toSocketSuffix },
    optionalBranch: options.optionalBranch === true,
    connectorProfileId: options.connectorProfileId ?? null,
    ladderFacing: options.ladderFacing ?? null,
  };
}

function internalBinding(id, placementKey, socketSuffix, destinationRegionId, purpose) {
  return {
    id: `internal-binding.${id}`,
    placementKey,
    socketSuffix,
    destinationRegionId,
    purpose,
    damageFree: true,
    playableDestination: true,
    permanentReturn: true,
  };
}

function cap(placementKey, socketSuffix) {
  return { placementKey, socketSuffix };
}

function socketBySuffix(module, suffix) {
  const matches = module.extensionSockets.filter(({ id }) => id.endsWith(`.${suffix}`));
  if (matches.length !== 1) {
    throw new Error(`${module.id} expected exactly one socket ending .${suffix}; received ${matches.length}.`);
  }
  return matches[0];
}

function boxesOverlap(left, right) {
  return left.min.x < right.max.x - EPSILON && left.max.x > right.min.x + EPSILON
    && left.min.y < right.max.y - EPSILON && left.max.y > right.min.y + EPSILON
    && left.min.z < right.max.z - EPSILON && left.max.z > right.min.z + EPSILON;
}

function connectorMode(form) {
  if (form === 'ground-bulkhead') return 'enclosed-bulkhead';
  if (form === 'elevated-catwalk') return 'supported-enclosed-catwalk';
  if (form === 'cargo-lift') return 'recallable-automatic-cargo-lift';
  if (form === 'pipe-water-breach') return 'enclosed-pipe-tunnel';
  if (form === 'service-ladder') return 'dual-service-ladder-overhead-gallery';
  throw new Error(`No golden connector mode exists for ${form}.`);
}

function endpointFor(bundle, socketSuffix) {
  const localSocket = socketBySuffix(bundle.module, socketSuffix);
  const socket = bundle.compiled.portals.find(({ localId }) => localId === localSocket.id);
  if (!socket) throw new Error(`${bundle.spec.id} did not compile socket ${localSocket.id}.`);
  const approachSurfaces = socket.approachSurfaceIds.map((surfaceId) => (
    bundle.compiled.walkableSurfaces.find(({ id }) => id === surfaceId)
  ));
  if (approachSurfaces.some((surface) => !surface)) {
    throw new Error(`${socket.id} has an uncompiled approach surface.`);
  }
  const approachElevations = [...new Set(approachSurfaces.map((surface) => surface.topY))].sort((a, b) => a - b);
  return {
    placementId: bundle.spec.id,
    descriptorId: bundle.module.id,
    localSocketId: localSocket.id,
    socketId: socket.id,
    form: localSocket.form,
    boundarySide: socket.boundarySide,
    anchor: { ...socket.anchor },
    facing: { ...socket.facing },
    opening: { ...socket.opening },
    clearance: { ...localSocket.clearance },
    approachSurfaceIds: [...socket.approachSurfaceIds],
    approachElevations,
    semanticRegionIds: [...localSocket.semanticRegionIds],
    descriptorReference: { ...socket.descriptorReference },
  };
}

function createLadderShaft(endpoint, localFacing, yawQuarterTurns) {
  const facing = rotatePointQuarterTurns(localFacing, yawQuarterTurns);
  const length = Math.hypot(facing.x, facing.z);
  if (length <= EPSILON) throw new Error(`${endpoint.socketId} has no horizontal ladder facing.`);
  const climbFacing = { x: facing.x / length, y: 0, z: facing.z / length };
  const planeNormal = { x: -climbFacing.x, y: 0, z: -climbFacing.z };
  const bottomY = Math.max(...endpoint.approachElevations) + 0.3;
  const topY = endpoint.anchor.y + 0.3;
  const planePath = [
    { x: endpoint.anchor.x, y: bottomY, z: endpoint.anchor.z },
    { x: endpoint.anchor.x, y: topY, z: endpoint.anchor.z },
  ];
  const rootPath = planePath.map((point) => ({
    x: point.x + planeNormal.x * BODY_CLEARANCE,
    y: point.y,
    z: point.z + planeNormal.z * BODY_CLEARANCE,
  }));
  return {
    socketId: endpoint.socketId,
    climbFacing,
    planeNormal,
    bodyClearance: BODY_CLEARANCE,
    planePath,
    rootPath,
    bottomExit: { ...rootPath[0] },
    topExit: { ...rootPath[1] },
    width: endpoint.opening.width,
    mountRadius: 1.4,
  };
}

function buildGraph(placements, connections) {
  const adjacency = Object.fromEntries(placements.map(({ id }) => [id, []]));
  for (const connectionRecord of connections) {
    adjacency[connectionRecord.from.placementId].push(connectionRecord.to.placementId);
    adjacency[connectionRecord.to.placementId].push(connectionRecord.from.placementId);
  }
  for (const values of Object.values(adjacency)) values.sort();
  const start = placements.find(({ id }) => id === 'placement.security')?.id ?? placements[0]?.id;
  const visited = new Set(start ? [start] : []);
  const queue = start ? [start] : [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const next of adjacency[queue[cursor]] ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return {
    startPlacementId: start,
    adjacency,
    connectedPlacementIds: [...visited].sort(),
    connected: visited.size === placements.length,
    cycleRank: connections.length - placements.length + (placements.length ? 1 : 0),
    optionalBranchPlacementId: 'placement.nest',
  };
}

function compileComposition() {
  const specByKey = new Map(LEGACY_FIXED_ROOM_GOLDEN_PLACEMENT_SPECS_V2.map((spec) => [spec.key, spec]));
  const openSuffixes = new Map([...specByKey.keys()].map((key) => [key, new Set()]));
  for (const connectionSpec of LEGACY_FIXED_ROOM_GOLDEN_CONNECTION_SPECS_V2) {
    openSuffixes.get(connectionSpec.from.placementKey)?.add(connectionSpec.from.socketSuffix);
    openSuffixes.get(connectionSpec.to.placementKey)?.add(connectionSpec.to.socketSuffix);
  }
  for (const binding of LEGACY_FIXED_ROOM_GOLDEN_INTERNAL_BINDINGS_V2) {
    openSuffixes.get(binding.placementKey)?.add(binding.socketSuffix);
  }

  const bundles = new Map();
  for (const spec of LEGACY_FIXED_ROOM_GOLDEN_PLACEMENT_SPECS_V2) {
    const module = getLegacyFixedRoomModuleV2(spec.descriptorId);
    if (!module) throw new Error(`Missing fixed-room descriptor ${spec.descriptorId}.`);
    const localOpenSocketIds = [...openSuffixes.get(spec.key)]
      .map((suffix) => socketBySuffix(module, suffix).id)
      .sort();
    const structuralContract = compileLegacyFixedRoomStructuralContractV2(module, {
      openSocketIds: localOpenSocketIds,
    });
    const compiled = compileLegacyFixedRoomPlacementV2(module, {
      id: spec.id,
      translation: spec.translation,
      yawQuarterTurns: spec.yawQuarterTurns,
      structuralContract,
    });
    bundles.set(spec.key, { spec, module, structuralContract, compiled });
  }

  const placements = [...bundles.values()].map(({ spec, module, compiled }) => ({
    ...createLegacyFixedRoomPlanPlacementRecordV2(compiled, {
      semanticRegionIds: module.semanticRegions.map(({ id }) => id),
    }),
    key: spec.key,
    optional: spec.optional,
  }));
  const connections = LEGACY_FIXED_ROOM_GOLDEN_CONNECTION_SPECS_V2.map((spec) => {
    const fromBundle = bundles.get(spec.from.placementKey);
    const toBundle = bundles.get(spec.to.placementKey);
    const from = endpointFor(fromBundle, spec.from.socketSuffix);
    const to = endpointFor(toBundle, spec.to.socketSuffix);
    if (from.form !== to.form) throw new Error(`${spec.id} pairs incompatible forms ${from.form} and ${to.form}.`);
    const verticalDelta = to.anchor.y - from.anchor.y;
    const horizontalDistance = Math.hypot(to.anchor.x - from.anchor.x, to.anchor.z - from.anchor.z);
    const traversal = {
      mode: connectorMode(from.form),
      enclosed: true,
      supported: true,
      minimumWidth: Math.min(from.opening.width, to.opening.width),
      minimumHeadroom: Math.min(from.clearance.headroom, to.clearance.headroom),
      verticalDelta,
      horizontalDistance,
      automaticTravel: from.form === 'cargo-lift',
      recallable: from.form === 'cargo-lift',
      controlsBesideWalkway: from.form === 'cargo-lift',
      connectorProfileId: spec.connectorProfileId ?? `${from.form}-connector-v2`,
    };
    if (spec.connectorProfileId === 'enclosed-double-elbow-bulkhead-v2') {
      traversal.endpointFacingPolicy = 'parallel-outward-double-elbow';
      traversal.minimumElbows = 2;
    }
    if (from.form === 'service-ladder') {
      traversal.ladderShafts = {
        from: createLadderShaft(from, spec.ladderFacing.from, fromBundle.spec.yawQuarterTurns),
        to: createLadderShaft(to, spec.ladderFacing.to, toBundle.spec.yawQuarterTurns),
      };
      traversal.overheadGallery = {
        enclosed: true,
        supported: true,
        floorY: Math.max(from.anchor.y, to.anchor.y) + 0.3,
        minimumWidth: Math.min(from.opening.width, to.opening.width),
      };
    }
    return {
      id: spec.id,
      from,
      to,
      form: from.form,
      optionalBranch: spec.optionalBranch,
      traversal,
    };
  });
  const internalBindings = LEGACY_FIXED_ROOM_GOLDEN_INTERNAL_BINDINGS_V2.map((binding) => {
    const endpoint = endpointFor(bundles.get(binding.placementKey), binding.socketSuffix);
    return { ...binding, endpoint };
  });
  const caps = LEGACY_FIXED_ROOM_GOLDEN_EXPLICIT_CAPS_V2.map((capSpec) => {
    const bundle = bundles.get(capSpec.placementKey);
    const endpoint = endpointFor(bundle, capSpec.socketSuffix);
    return {
      placementId: bundle.spec.id,
      descriptorId: bundle.module.id,
      localSocketId: endpoint.localSocketId,
      socketId: endpoint.socketId,
      form: endpoint.form,
      state: 'opaque-capped',
    };
  });
  const graph = buildGraph(placements, connections);
  const forms = connections.map(({ form }) => form);
  const formCounts = Object.fromEntries([...new Set(forms)].sort().map((form) => [
    form,
    forms.filter((candidate) => candidate === form).length,
  ]));
  return deepFreezePlan({
    schemaVersion: 'dungeon-v2-native-room-composition/1',
    id: 'composition.golden.native-v1-rooms',
    revision: LEGACY_FIXED_ROOM_GOLDEN_COMPOSITION_REVISION_V2,
    source: 'dungeon-v1-authored-room-modules',
    status: 'composition-contract-only',
    fullDungeonPlanReady: false,
    genericFallbackGeometry: false,
    fixedChainReused: false,
    placements,
    connections,
    internalBindings,
    cappedSockets: caps,
    graph,
    diagnostics: {
      placementCount: placements.length,
      descriptorCount: new Set(placements.map(({ descriptorId }) => descriptorId)).size,
      connectionCount: connections.length,
      internalBindingCount: internalBindings.length,
      cappedSocketCount: caps.length,
      formCounts,
      elevationBands: [...new Set(connections.flatMap(({ from, to }) => [
        ...from.approachElevations,
        ...to.approachElevations,
        from.anchor.y,
        to.anchor.y,
      ]))].sort((a, b) => a - b),
    },
  });
}

export function validateLegacyFixedRoomGoldenCompositionV2(composition) {
  const errors = [];
  const fail = (code, message) => errors.push({ code, message });
  if (!isSerializablePlanValue(composition)) fail('composition-not-serializable', 'Composition must contain data only.');
  const placements = composition?.placements ?? [];
  const connections = composition?.connections ?? [];
  const bindings = composition?.internalBindings ?? [];
  const caps = composition?.cappedSockets ?? [];
  const descriptorIds = new Set(placements.map(({ descriptorId }) => descriptorId));
  if (placements.length !== 11 || descriptorIds.size !== 11
    || LEGACY_FIXED_ROOM_MODULE_CATALOG_V2.some(({ id }) => !descriptorIds.has(id))) {
    fail('composition-descriptor-coverage', 'Composition must place every native V1 room descriptor exactly once.');
  }
  const rebuilt = new Map();
  for (const placementRecord of placements) {
    try {
      rebuilt.set(placementRecord.id, recompileAcceptedLegacyFixedRoomPlacementV2(placementRecord));
    } catch (error) {
      fail('composition-placement-signature', `${placementRecord.id}: ${error.message}`);
    }
  }
  for (let left = 0; left < placements.length; left += 1) {
    for (let right = left + 1; right < placements.length; right += 1) {
      if (boxesOverlap(placements[left].worldBounds, placements[right].worldBounds)) {
        fail('composition-placement-overlap', `${placements[left].id} overlaps ${placements[right].id}.`);
      }
    }
  }
  if (connections.length !== 14) fail('composition-connection-count', 'Golden composition requires fourteen authored connections.');
  const usedSocketIds = new Set();
  for (const connectionRecord of connections) {
    const { from, to } = connectionRecord;
    if (from.form !== to.form || connectionRecord.form !== from.form) {
      fail('composition-socket-form-mismatch', `${connectionRecord.id} pairs incompatible socket forms.`);
    }
    for (const endpoint of [from, to]) {
      if (usedSocketIds.has(endpoint.socketId)) fail('composition-socket-reused', `${endpoint.socketId} is paired more than once.`);
      usedSocketIds.add(endpoint.socketId);
      const compiled = rebuilt.get(endpoint.placementId)?.expectedPlacement;
      if (!compiled?.openSocketIds.includes(endpoint.socketId)) {
        fail('composition-socket-not-open', `${endpoint.socketId} is not open in its placement contract.`);
      }
    }
    const dot = from.facing.x * to.facing.x + from.facing.y * to.facing.y + from.facing.z * to.facing.z;
    if (connectionRecord.form === 'service-ladder') {
      if (dot < 0.999 || !connectionRecord.traversal?.overheadGallery?.enclosed) {
        fail('composition-ladder-gallery-invalid', `${connectionRecord.id} requires parallel ceiling hatches and an enclosed gallery.`);
      }
      for (const shaft of Object.values(connectionRecord.traversal?.ladderShafts ?? {})) {
        const planeDelta = shaft?.planePath?.[0] && shaft?.rootPath?.[0]
          ? {
              x: shaft.rootPath[0].x - shaft.planePath[0].x,
              z: shaft.rootPath[0].z - shaft.planePath[0].z,
            }
          : null;
        const signed = planeDelta
          ? planeDelta.x * shaft.planeNormal.x + planeDelta.z * shaft.planeNormal.z
          : NaN;
        if (!Number.isFinite(signed) || Math.abs(signed - BODY_CLEARANCE) > EPSILON
          || shaft.climbFacing.x * shaft.planeNormal.x + shaft.climbFacing.z * shaft.planeNormal.z > -0.999) {
          fail('composition-ladder-alignment-invalid', `${connectionRecord.id} has an invalid ladder root/plane contract.`);
        }
      }
    } else {
      const acceptedDoubleElbow = connectionRecord.form === 'ground-bulkhead'
        && dot > 0.999
        && connectionRecord.traversal?.connectorProfileId === 'enclosed-double-elbow-bulkhead-v2'
        && connectionRecord.traversal?.endpointFacingPolicy === 'parallel-outward-double-elbow'
        && connectionRecord.traversal?.minimumElbows >= 2;
      if (dot > -0.999 && !acceptedDoubleElbow) {
        fail('composition-facing-mismatch', `${connectionRecord.id} endpoints do not face each other and lack an explicit enclosed double-elbow route.`);
      }
      if (connectionRecord.form !== 'cargo-lift'
        && Math.abs(connectionRecord.traversal.verticalDelta) > 0.001) {
        fail('composition-elevation-mismatch', `${connectionRecord.id} requires a level connector.`);
      }
    }
    if (!connectionRecord.traversal?.enclosed || !connectionRecord.traversal?.supported) {
      fail('composition-connector-unenclosed', `${connectionRecord.id} lacks enclosure/support ownership.`);
    }
  }
  for (const binding of bindings) {
    if (usedSocketIds.has(binding.endpoint.socketId)) fail('composition-socket-reused', `${binding.endpoint.socketId} has two owners.`);
    usedSocketIds.add(binding.endpoint.socketId);
    if (!binding.damageFree || !binding.playableDestination || !binding.permanentReturn) {
      fail('composition-internal-fall-unsafe', `${binding.id} is not a playable damage-free return contract.`);
    }
  }
  const cappedIds = new Set();
  for (const capRecord of caps) {
    if (usedSocketIds.has(capRecord.socketId)) fail('composition-cap-open-conflict', `${capRecord.socketId} is both open and capped.`);
    if (cappedIds.has(capRecord.socketId)) fail('composition-cap-duplicate', `${capRecord.socketId} is capped twice.`);
    cappedIds.add(capRecord.socketId);
    const compiledPortal = rebuilt.get(capRecord.placementId)?.expectedPlacement.portals
      .find(({ id }) => id === capRecord.socketId);
    if (compiledPortal?.state !== 'opaque-capped') fail('composition-cap-not-physical', `${capRecord.socketId} lacks its opaque cap.`);
  }
  const allSocketCount = LEGACY_FIXED_ROOM_MODULE_CATALOG_V2
    .reduce((total, module) => total + module.extensionSockets.length, 0);
  if (usedSocketIds.size + cappedIds.size !== allSocketCount) {
    fail('composition-socket-partition-incomplete', 'Every catalog socket must be paired, internally bound, or physically capped.');
  }
  if (!composition?.graph?.connected || composition.graph.connectedPlacementIds.length !== placements.length) {
    fail('composition-graph-disconnected', 'Every placed room must belong to the golden exploration graph.');
  }
  if (composition?.graph?.cycleRank < 2) fail('composition-graph-linear', 'Golden exploration requires multiple loops.');
  if ((composition?.graph?.adjacency?.['placement.nest'] ?? []).length !== 1) {
    fail('composition-optional-branch-invalid', 'Nest must remain a real optional branch.');
  }
  const forms = connections.map(({ form }) => form);
  const maximumFormCount = Math.max(0, ...Object.values(composition?.diagnostics?.formCounts ?? {}));
  if (new Set(forms).size < 5 || maximumFormCount / Math.max(1, forms.length) > 0.4 + EPSILON) {
    fail('composition-connector-variety', 'Connector forms are not sufficiently varied.');
  }
  for (let index = 1; index < forms.length; index += 1) {
    if (forms[index] === forms[index - 1]) fail('composition-connector-repeated', `Connections ${index} and ${index + 1} repeat ${forms[index]}.`);
  }
  return deepFreezePlan({
    accepted: errors.length === 0,
    errors,
    stats: {
      placements: placements.length,
      connections: connections.length,
      pairedOrBoundSockets: usedSocketIds.size,
      cappedSockets: cappedIds.size,
      cycleRank: composition?.graph?.cycleRank ?? null,
    },
  });
}

export function createLegacyFixedRoomGoldenCompositionV2() {
  const composition = compileComposition();
  const validation = validateLegacyFixedRoomGoldenCompositionV2(composition);
  if (!validation.accepted) {
    const error = new Error(`Native fixed-room golden composition rejected: ${validation.errors.map(({ code }) => code).join(', ')}`);
    error.code = 'DUNGEON_V2_NATIVE_COMPOSITION_REJECTED';
    error.validation = validation;
    throw error;
  }
  return composition;
}
