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
import {
  normalizeYawQuarterTurns,
  rotatePointQuarterTurns,
  transformBoundsQuarterTurns,
} from './DungeonSpatialMathV2.js';
import {
  SEMANTIC_ROOM_PACK_V1_COLLISION_POLICY,
  SEMANTIC_ROOM_PACK_V1_ID,
  SEMANTIC_ROOM_PACK_V1_REVISION,
  getSemanticRoomPackV1Descriptor,
} from './SemanticRoomPackV1Catalog.js';

export const SEMANTIC_ROOM_PACK_PLAN_ADAPTER_V2_REVISION = 1;

const CARDINAL_FORWARD_VECTORS = Object.freeze([
  Object.freeze({ x: 0, y: 0, z: 1 }),
  Object.freeze({ x: 1, y: 0, z: 0 }),
  Object.freeze({ x: 0, y: 0, z: -1 }),
  Object.freeze({ x: -1, y: 0, z: 0 }),
]);
const WALKABLE_SEMANTICS = new Set(['walkable', 'recoveryCatchment', 'movingSurface']);
const SHELL_SEMANTICS = new Set(['shell']);
const DIRECTION_ORDER = Object.freeze(['NORTH', 'WEST', 'SOUTH', 'EAST']);

function round(value) {
  const rounded = Math.round(Number(value) * 1e9) / 1e9;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function vectorFrom(value, label) {
  const result = Array.isArray(value)
    ? { x: value[0], y: value[1], z: value[2] }
    : { x: value?.x, y: value?.y, z: value?.z };
  if (!Object.values(result).every(Number.isFinite)) {
    throw new TypeError(`${label} must contain finite x, y, and z values.`);
  }
  return { x: round(result.x), y: round(result.y), z: round(result.z) };
}

function sizeFrom(value, label) {
  const result = vectorFrom(value, label);
  if (result.x <= 0 || result.y <= 0 || result.z <= 0) {
    throw new RangeError(`${label} components must be positive.`);
  }
  return result;
}

function rotateVector(value, yawQuarterTurns) {
  const rotated = rotatePointQuarterTurns(vectorFrom(value, 'vector'), yawQuarterTurns);
  return { x: round(rotated.x), y: round(rotated.y), z: round(rotated.z) };
}

function transformPoint(value, translation, yawQuarterTurns) {
  const rotated = rotateVector(value, yawQuarterTurns);
  return {
    x: round(rotated.x + translation.x),
    y: round(rotated.y + translation.y),
    z: round(rotated.z + translation.z),
  };
}

function vectorsEqual(left, right, tolerance = 1e-7) {
  return ['x', 'y', 'z'].every((axis) => Math.abs(left[axis] - right[axis]) <= tolerance);
}

function cardinalForward(value, label) {
  const vector = vectorFrom(value, label);
  const matched = CARDINAL_FORWARD_VECTORS.find((candidate) => vectorsEqual(candidate, vector));
  if (!matched) {
    throw new RangeError(`${label} must be a unit cardinal horizontal vector.`);
  }
  return { ...matched };
}

function stableLocalToken(value) {
  const source = String(value ?? '').trim();
  if (!source || !/^[A-Za-z0-9_.:-]+$/.test(source)) {
    throw new TypeError(`Stable plan identifier contains unsupported characters: ${source || '<empty>'}`);
  }
  return source;
}

function worldId(placementId, category, localId) {
  return `${placementId}:${category}:${stableLocalToken(localId)}`;
}

function directionQuarterTurns(direction, yawQuarterTurns) {
  const index = DIRECTION_ORDER.indexOf(direction);
  if (index < 0) return direction;
  return DIRECTION_ORDER[(index + yawQuarterTurns) % DIRECTION_ORDER.length];
}

function resolveCompileArguments(roomIdOrSpec, options) {
  if (roomIdOrSpec && typeof roomIdOrSpec === 'object') {
    return {
      roomId: roomIdOrSpec.roomId,
      options: { ...roomIdOrSpec },
    };
  }
  return { roomId: roomIdOrSpec, options: options ?? {} };
}

function resolveTargetPortal(options) {
  const targetPortal = options.targetPortal ?? options.portalTransform;
  if (!targetPortal || typeof targetPortal !== 'object') {
    throw new TypeError('A targetPortal with an authored position and forward vector is required.');
  }
  return {
    id: targetPortal.id == null ? null : stableLocalToken(targetPortal.id),
    position: vectorFrom(targetPortal.position ?? targetPortal.center, 'targetPortal.position'),
    forward: cardinalForward(targetPortal.forward, 'targetPortal.forward'),
    connectorType: targetPortal.connectorType ?? targetPortal.type ?? null,
    aperture: targetPortal.aperture == null ? null : [...targetPortal.aperture],
  };
}

function resolveEntrySocket(descriptor, options) {
  const requestedNodeName = options.entrySocketNodeName ?? options.entrySocket?.nodeName ?? null;
  const requestedId = options.entrySocketId ?? options.entrySocket?.id ?? null;
  const defaultEntry = descriptor.sockets.find(({ nodeName }) => /^SOCKET_ENTRY_/.test(nodeName));
  const selected = descriptor.sockets.find((socket) => (
    requestedNodeName ? socket.nodeName === requestedNodeName : requestedId ? socket.id === requestedId : socket === defaultEntry
  ));
  if (!selected) {
    throw new RangeError(`Room ${descriptor.roomId} does not contain the requested entry socket.`);
  }
  if (!/^SOCKET_ENTRY_/.test(selected.nodeName)) {
    throw new RangeError(`Placement must be resolved from a named SOCKET_ENTRY_* node, not ${selected.nodeName}.`);
  }
  return selected;
}

function resolveYawQuarterTurns(entrySocket, targetPortal, requestedYaw) {
  const matching = [0, 1, 2, 3].filter((yawQuarterTurns) => vectorsEqual(
    rotateVector(entrySocket.forward, yawQuarterTurns),
    targetPortal.forward,
  ));
  if (matching.length !== 1) {
    throw new RangeError('The authored entry socket cannot be aligned to the target portal facing with a quarter-turn yaw.');
  }
  if (requestedYaw == null) return matching[0];
  const normalized = normalizeYawQuarterTurns(requestedYaw);
  if (normalized !== matching[0]) {
    throw new RangeError(`yawQuarterTurns ${normalized} does not align the selected entry socket with the target portal.`);
  }
  return normalized;
}

function assertPlacementPolicy(options) {
  for (const forbidden of ['scale', 'authoredScale', 'aggregateBounds', 'meshBounds', 'visibleMeshBounds', 'recenter']) {
    if (options[forbidden] != null) {
      throw new TypeError(`Semantic room-pack placement forbids ${forbidden}; authored origin and scale are immutable.`);
    }
  }
  if (options.translation != null || options.position != null) {
    throw new TypeError('Semantic room-pack translation is resolved only by the selected entry socket and target portal.');
  }
}

function compileCollisionVolume(volume, sourceManifestIndex, placementId, translation, yawQuarterTurns) {
  const id = worldId(placementId, 'collider', volume.nodeName);
  const record = {
    id,
    sourceNodeName: volume.nodeName,
    sourceManifestIndex,
    sourceCollisionIndex: sourceManifestIndex,
    semantic: volume.semantic,
    sourceSemantic: volume.semantic,
    sourcePolicy: 'manifest-collision-volume',
    derivedFromVisibleMeshBounds: false,
    shape: volume.shape,
    localCenter: vectorFrom(volume.center, `${volume.nodeName}.center`),
    worldCenter: transformPoint(volume.center, translation, yawQuarterTurns),
  };
  if (volume.shape === 'box') {
    record.worldSize = sizeFrom(volume.size, `${volume.nodeName}.size`);
    record.localRotationY = round(volume.rotationY ?? 0);
    record.worldYawRadians = round(record.localRotationY + yawQuarterTurns * Math.PI / 2);
  } else if (volume.shape === 'cylinder') {
    record.worldRadius = round(volume.radius);
    record.worldHeight = round(volume.height);
    record.localRotationY = 0;
    record.worldYawRadians = round(yawQuarterTurns * Math.PI / 2);
  } else {
    throw new TypeError(`Unsupported manifest collision shape ${volume.shape} on ${volume.nodeName}.`);
  }
  return record;
}

function categoryPhysicalRecord(volume, placementId, category) {
  const id = worldId(placementId, category, volume.sourceNodeName);
  return {
    id,
    colliderId: volume.id,
    sourceNodeName: volume.sourceNodeName,
    semantic: volume.semantic,
    shape: volume.shape,
    worldCenter: { ...volume.worldCenter },
    ...(volume.worldSize ? { worldSize: { ...volume.worldSize }, worldYawRadians: volume.worldYawRadians } : {}),
    ...(volume.worldRadius != null ? { worldRadius: volume.worldRadius, worldHeight: volume.worldHeight } : {}),
  };
}

function semanticStableId(placementId, marker) {
  const semantic = marker.extras.semantic;
  const localId = marker.extras.regionId
    ?? marker.extras.anchorId
    ?? marker.extras.interactionId
    ?? marker.extras.mechanismId
    ?? marker.extras.discoveryId
    ?? marker.nodeName;
  const category = semantic === 'region' ? 'region'
    : semantic === 'safeAnchor' ? 'safe-anchor'
      : semantic.endsWith('Anchor') ? 'anchor'
        : semantic === 'hazardSurface' ? 'hazard-surface'
          : semantic === 'fluidSurface' ? 'fluid-surface'
            : semantic === 'console' ? 'console'
              : semantic.startsWith('mechanism') || semantic === 'movingSurface' ? 'mechanism-node'
                : 'semantic-node';
  return worldId(placementId, category, localId);
}

function transformSemanticMarkers(descriptor, placementId, translation, yawQuarterTurns) {
  return descriptor.semanticMarkers.map((marker) => ({
    id: semanticStableId(placementId, marker),
    sourceNodeName: marker.nodeName,
    semantic: marker.extras.semantic,
    localPosition: vectorFrom(marker.position, `${marker.nodeName}.position`),
    worldPosition: transformPoint(marker.position, translation, yawQuarterTurns),
    extras: clonePlanData(marker.extras),
  }));
}

function compileTraversalCondition(predicate, placementId, descriptor) {
  if (!predicate) return null;
  const separator = predicate.indexOf(':');
  const namespace = separator < 0 ? predicate : predicate.slice(0, separator);
  const value = separator < 0 ? '' : predicate.slice(separator + 1);
  if (namespace === 'stop') {
    const mechanismId = descriptor.mechanisms[0]?.id ?? 'mechanism';
    return {
      op: 'stateEquals',
      variableId: worldId(placementId, 'mechanism-state', mechanismId),
      value,
    };
  }
  if (namespace === 'water') {
    return {
      op: 'stateEquals',
      variableId: worldId(placementId, 'environment-state', descriptor.fluidNetwork?.id ?? 'water'),
      value,
    };
  }
  if (namespace === 'electric' && value === 'safe_or_timed') {
    const controllerId = descriptor.controller?.id ?? 'electric_cycle';
    return {
      op: 'any',
      conditions: [
        {
          op: 'stateEquals',
          variableId: worldId(placementId, 'mechanism-state', controllerId),
          value: 'grounded',
        },
        {
          op: 'stateEquals',
          variableId: worldId(placementId, 'hazard-phase', descriptor.hazard?.profile ?? 'electric_floor_cycle_v1'),
          value: 'safe',
        },
      ],
    };
  }
  return { op: 'stateEquals', variableId: worldId(placementId, 'source-predicate', namespace), value };
}

function localReferenceWorldId(reference, placementId, regionIds, colliderByNodeName) {
  if (regionIds.has(reference)) return worldId(placementId, 'region', reference);
  if (colliderByNodeName[reference]) return colliderByNodeName[reference].id;
  return worldId(placementId, 'semantic-reference', reference);
}

function compileMechanisms(descriptor, placementId, translation, yawQuarterTurns) {
  const mechanisms = descriptor.mechanisms.map((mechanism) => ({
    id: worldId(placementId, 'mechanism', mechanism.id),
    localId: mechanism.id,
    controller: mechanism.controller,
    stateVariableId: worldId(placementId, 'mechanism-state', mechanism.id),
    stableStates: (mechanism.stableStops ?? []).map((stop) => ({
      id: worldId(placementId, 'mechanism-state-value', stop.id),
      localId: stop.id,
      worldHeight: round(translation.y + stop.height),
      worldYawDegrees: round((stop.yawDegrees + yawQuarterTurns * 90) % 360),
      deployedBridge: directionQuarterTurns(stop.deployedBridge, yawQuarterTurns),
    })),
  }));
  if (descriptor.controller) {
    mechanisms.push({
      id: worldId(placementId, 'mechanism', descriptor.controller.id),
      localId: descriptor.controller.id,
      controller: descriptor.controller.id,
      stateVariableId: worldId(placementId, 'mechanism-state', descriptor.controller.id),
      consoleNodeName: descriptor.controller.consoleNode,
      stableStates: descriptor.controller.stableStates.map((stateId) => ({
        id: worldId(placementId, 'mechanism-state-value', stateId),
        localId: stateId,
      })),
    });
  }
  return mechanisms;
}

function compileEnvironmentContracts(descriptor, placementId, translation, semanticMarkers) {
  const contracts = [];
  if (descriptor.fluidNetwork) {
    const network = descriptor.fluidNetwork;
    contracts.push({
      id: worldId(placementId, 'environment', network.id),
      kind: 'conserved-fluid-network',
      localId: network.id,
      profile: network.profile,
      stateVariableId: worldId(placementId, 'environment-state', network.id),
      basinBottomWorldY: round(translation.y + network.basinBottomY),
      conservedVolumeUnits: network.conservedVolumeUnits,
      masterConsoleNodeName: network.masterConsoleNode,
      stableStates: Object.entries(network.stableStates).map(([stateId, levels]) => ({
        id: stateId,
        levels: Object.fromEntries(Object.entries(levels).map(([key, value]) => [
          key.replace(/Y$/, 'WorldY'),
          value == null ? null : round(translation.y + value),
        ])),
      })),
    });
  }
  if (descriptor.hazard) {
    const hazardMarkers = semanticMarkers.filter(({ semantic }) => semantic === 'hazardSurface');
    contracts.push({
      id: worldId(placementId, 'environment', descriptor.hazard.profile),
      kind: 'environmental-hazard',
      profile: descriptor.hazard.profile,
      parameters: clonePlanData(Object.fromEntries(Object.entries(descriptor.hazard)
        .filter(([key]) => !['profile', 'node', 'panelPrefix'].includes(key)))),
      sourceNodeName: descriptor.hazard.node ?? null,
      sourceNodePrefix: descriptor.hazard.panelPrefix ?? null,
      surfaceIds: hazardMarkers.map(({ id }) => id),
      criticalRouteDamageFree: descriptor.criticalRouteDamageFree === true,
    });
  }
  return contracts;
}

function compileFalls(descriptor, placementId, translation, colliderByNodeName) {
  return descriptor.fallCatchments.map((fall) => ({
    id: worldId(placementId, 'fall', fall.id),
    localId: fall.id,
    source: fall.source ?? null,
    destinationWorldY: fall.destinationY == null ? null : round(translation.y + fall.destinationY),
    destinationNodeName: fall.destinationNode ?? null,
    destinationColliderId: fall.destinationNode ? colliderByNodeName[fall.destinationNode]?.id ?? null : null,
    nominalPadWidth: fall.nominalPadWidth ?? null,
    escapeReference: fall.escape,
    escapeWorldPrefix: typeof fall.escape === 'string'
      ? `${placementId}:${fall.escape.replace(/\*+$/, '')}`
      : null,
    deepWaterCushion: fall.deepWaterCushion === true,
    damageFreeExit: fall.damageFreeExit === true || fall.deepWaterCushion === true || descriptor.criticalRouteDamageFree === true,
  }));
}

function compilePlacementUnchecked(roomIdOrSpec, optionsArg) {
  const { roomId, options } = resolveCompileArguments(roomIdOrSpec, optionsArg);
  const descriptor = getSemanticRoomPackV1Descriptor(roomId);
  assertPlacementPolicy(options);
  const placementId = stableLocalToken(options.placementId ?? `semantic-room.${roomId}`);
  const targetPortal = resolveTargetPortal(options);
  const entrySocket = resolveEntrySocket(descriptor, options);
  const yawQuarterTurns = resolveYawQuarterTurns(entrySocket, targetPortal, options.yawQuarterTurns);
  const rotatedEntryPosition = rotateVector(entrySocket.position, yawQuarterTurns);
  const translation = {
    x: round(targetPortal.position.x - rotatedEntryPosition.x),
    y: round(targetPortal.position.y - rotatedEntryPosition.y),
    z: round(targetPortal.position.z - rotatedEntryPosition.z),
  };
  const worldBounds = transformBoundsQuarterTurns(descriptor.authoredBounds, {
    translation,
    yawQuarterTurns,
  });
  for (const side of ['min', 'max']) {
    for (const axis of ['x', 'y', 'z']) worldBounds[side][axis] = round(worldBounds[side][axis]);
  }

  const transformedCollisionVolumes = descriptor.collisionVolumes.map((volume, index) => (
    compileCollisionVolume(volume, index, placementId, translation, yawQuarterTurns)
  ));
  const colliderByNodeName = Object.fromEntries(transformedCollisionVolumes.map((volume) => [volume.sourceNodeName, volume]));
  const structuralBoundaries = transformedCollisionVolumes
    .filter(({ semantic }) => SHELL_SEMANTICS.has(semantic))
    .map((volume) => categoryPhysicalRecord(volume, placementId, 'boundary'));
  const walkableSurfaces = transformedCollisionVolumes
    .filter(({ semantic }) => WALKABLE_SEMANTICS.has(semantic))
    .map((volume) => categoryPhysicalRecord(volume, placementId, 'surface'));
  const structuralFixtures = transformedCollisionVolumes
    .filter(({ semantic }) => !SHELL_SEMANTICS.has(semantic) && !WALKABLE_SEMANTICS.has(semantic))
    .map((volume) => categoryPhysicalRecord(volume, placementId, 'fixture'));

  const sockets = descriptor.sockets.map((socket) => ({
    id: socket.id,
    worldId: worldId(placementId, 'socket', socket.id),
    localId: socket.id,
    sourceNodeName: socket.nodeName,
    connectorType: socket.type,
    localPosition: vectorFrom(socket.position, `${socket.nodeName}.position`),
    worldPosition: transformPoint(socket.position, translation, yawQuarterTurns),
    localForward: vectorFrom(socket.forward, `${socket.nodeName}.forward`),
    worldForward: rotateVector(socket.forward, yawQuarterTurns),
    worldElevation: round(translation.y + socket.elevation),
    aperture: { width: socket.aperture[0], height: socket.aperture[1] },
    isPlacementEntry: socket.nodeName === entrySocket.nodeName,
  }));
  const semanticMarkers = transformSemanticMarkers(descriptor, placementId, translation, yawQuarterTurns);
  const markerByNodeName = Object.fromEntries(semanticMarkers.map((marker) => [marker.sourceNodeName, marker]));
  const regions = descriptor.regions.map((region) => ({
    id: worldId(placementId, 'region', region.id),
    localId: region.id,
    sourceNodeName: region.nodeName,
    source: region.source,
    localAnchor: region.localAnchor ? vectorFrom(region.localAnchor, `${region.id}.localAnchor`) : null,
    worldAnchor: region.localAnchor ? transformPoint(region.localAnchor, translation, yawQuarterTurns) : null,
  }));
  const regionIds = new Set(descriptor.regions.map(({ id }) => id));
  const traversalLinks = descriptor.traversalEdges.map((edge, index) => ({
    id: worldId(placementId, 'traversal', String(index).padStart(2, '0')),
    localFrom: edge.from,
    localTo: edge.to,
    fromAnchorId: localReferenceWorldId(edge.from, placementId, regionIds, colliderByNodeName),
    toAnchorId: localReferenceWorldId(edge.to, placementId, regionIds, colliderByNodeName),
    viaAnchorIds: (edge.via ?? []).map((reference) => localReferenceWorldId(reference, placementId, regionIds, colliderByNodeName)),
    kind: edge.kind ?? 'authored-traversal',
    optional: edge.optional === true,
    damageFree: edge.damageFree === true,
    movementProfile: edge.profile ?? null,
    sourcePredicate: edge.predicate ?? null,
    condition: compileTraversalCondition(edge.predicate, placementId, descriptor),
  }));
  const mechanisms = compileMechanisms(descriptor, placementId, translation, yawQuarterTurns);
  const environmentContracts = compileEnvironmentContracts(descriptor, placementId, translation, semanticMarkers);
  const falls = compileFalls(descriptor, placementId, translation, colliderByNodeName);
  const anchors = semanticMarkers.filter(({ semantic }) => semantic.endsWith('Anchor') || semantic === 'safeAnchor');
  const safeAnchors = anchors.filter(({ semantic }) => semantic === 'safeAnchor');
  const discoveries = descriptor.discoveries.map((discovery) => ({
    id: worldId(placementId, 'discovery', discovery.id),
    localId: discovery.id,
    availableWhen: discovery.availableWhen,
    condition: descriptor.fluidNetwork ? {
      op: 'stateEquals',
      variableId: worldId(placementId, 'environment-state', descriptor.fluidNetwork.id),
      value: discovery.availableWhen,
    } : null,
    anchorId: semanticMarkers.find(({ extras }) => extras.discoveryId === discovery.id)?.id ?? null,
  }));
  const interactionAnchors = semanticMarkers.filter(({ extras }) => typeof extras.interactionId === 'string');
  const stableSemanticIds = {
    sockets: sockets.map(({ worldId: id }) => id),
    regions: regions.map(({ id }) => id),
    collisionVolumes: transformedCollisionVolumes.map(({ id }) => id),
    mechanisms: mechanisms.map(({ id }) => id),
    anchors: anchors.map(({ id }) => id),
    hazards: semanticMarkers.filter(({ semantic }) => semantic === 'hazardSurface').map(({ id }) => id),
    fluids: semanticMarkers.filter(({ semantic }) => semantic === 'fluidSurface').map(({ id }) => id),
    consoles: interactionAnchors.map(({ id }) => id),
  };
  const worldTransform = {
    translation,
    yawQuarterTurns,
    scale: { x: 1, y: 1, z: 1 },
    authoredScalePreserved: true,
    aggregateBoundsOffsetApplied: false,
  };
  const placementTransform = worldTransform;
  const entrySocketWorld = sockets.find(({ localId }) => localId === entrySocket.id);
  const presentationBinding = {
    schemaVersion: 1,
    packId: SEMANTIC_ROOM_PACK_V1_ID,
    roomId,
    placementId,
    assetPath: descriptor.assetPath,
    manifestPath: descriptor.manifestPath,
    previewPath: descriptor.previewPath,
    manifestRevision: descriptor.revision,
    assetSha256: descriptor.sourceIntegrity.assetSha256,
    manifestContractHash: descriptor.sourceIntegrity.manifestContractHash,
    originPolicy: descriptor.authoredCoordinateSystem.originPolicy,
    authoredRootTransform: clonePlanData(descriptor.authoredRootTransform),
    placementTransform: clonePlanData(placementTransform),
    entrySocket: { id: entrySocket.id, nodeName: entrySocket.nodeName },
    targetPortal: clonePlanData(targetPortal),
    stableSemanticIds: clonePlanData(stableSemanticIds),
  };
  const placedRecordIds = {
    structuralBoundaryIds: structuralBoundaries.map(({ id }) => id),
    walkableSurfaceIds: walkableSurfaces.map(({ id }) => id),
    structuralFixtureIds: structuralFixtures.map(({ id }) => id),
    colliderIds: transformedCollisionVolumes.map(({ id }) => id),
  };

  const placement = {
    schemaVersion: 1,
    revision: SEMANTIC_ROOM_PACK_PLAN_ADAPTER_V2_REVISION,
    kind: 'semantic-room-pack-v1-placement',
    id: placementId,
    placementId,
    packId: SEMANTIC_ROOM_PACK_V1_ID,
    packRevision: SEMANTIC_ROOM_PACK_V1_REVISION,
    roomId,
    archetype: descriptor.archetype,
    topologyVariant: descriptor.topologyVariant,
    districts: [...descriptor.districts],
    gameplayPurpose: descriptor.gameplayPurpose,
    collisionSourcePolicy: SEMANTIC_ROOM_PACK_V1_COLLISION_POLICY,
    authoredRootTransform: clonePlanData(descriptor.authoredRootTransform),
    placementTransform,
    worldTransform,
    sourcePlacement: {
      roomId,
      placementId,
      entrySocketNodeName: entrySocket.nodeName,
      targetPortal: clonePlanData(targetPortal),
      yawQuarterTurns,
    },
    entrySocketId: entrySocket.id,
    entrySocketNodeName: entrySocket.nodeName,
    entrySocketWorldId: worldId(placementId, 'socket', entrySocket.id),
    entrySocketWorld: {
      id: entrySocket.id,
      worldId: entrySocketWorld.worldId,
      nodeName: entrySocket.nodeName,
      position: { ...entrySocketWorld.worldPosition },
      forward: { ...entrySocketWorld.worldForward },
      elevation: entrySocketWorld.worldElevation,
      aperture: { ...entrySocketWorld.aperture },
    },
    worldBounds,
    sockets,
    portals: sockets.map((socket) => ({
      ...socket,
      id: socket.worldId,
      socketId: socket.id,
    })),
    transformedCollisionVolumes,
    compiledPhysicalRecords: {
      colliders: transformedCollisionVolumes,
    },
    structuralBoundaries,
    walkableSurfaces,
    structuralFixtures,
    placedRecordIds,
    collisionPartitions: {
      shellColliderIds: structuralBoundaries.map(({ colliderId }) => colliderId),
      walkableColliderIds: walkableSurfaces.map(({ colliderId }) => colliderId),
      blockingColliderIds: structuralFixtures.map(({ colliderId }) => colliderId),
      dynamicColliderIds: transformedCollisionVolumes.filter(({ semantic }) => semantic === 'movingSurface').map(({ id }) => id),
    },
    regions,
    traversalLinks,
    mechanisms,
    environmentContracts,
    waterContracts: environmentContracts.filter(({ kind }) => kind === 'conserved-fluid-network'),
    hazardContracts: environmentContracts.filter(({ kind }) => kind === 'environmental-hazard'),
    falls,
    anchors,
    safeAnchors,
    discoveries,
    interactionAnchors,
    semanticMarkers,
    semanticNodeNames: [...descriptor.semanticNodeNames],
    visualNodeNames: [...descriptor.semanticNodeNames],
    presentationBinding,
    sourceIntegrity: clonePlanData(descriptor.sourceIntegrity),
  };
  return deepFreezePlan(placement);
}

function addDiagnostic(target, code, message, details = {}) {
  target.push(createPlanDiagnostic(code, message, details));
}

function validationResult(errors, details = {}) {
  const sortedErrors = sortPlanDiagnostics(errors);
  return deepFreezePlan({
    accepted: sortedErrors.length === 0,
    errors: sortedErrors,
    diagnosticHash: hashPlanDiagnostics(sortedErrors),
    details,
  });
}

export function validateSemanticRoomPackPlacementV2(placement) {
  const errors = [];
  if (!placement || typeof placement !== 'object') {
    addDiagnostic(errors, 'room-pack-placement-invalid', 'Semantic room-pack placement must be an object.');
    return validationResult(errors);
  }
  if (placement.packId !== SEMANTIC_ROOM_PACK_V1_ID
    || placement.kind !== 'semantic-room-pack-v1-placement'
    || placement.collisionSourcePolicy !== SEMANTIC_ROOM_PACK_V1_COLLISION_POLICY) {
    addDiagnostic(errors, 'room-pack-placement-policy-violation', 'Placement identity or manifest-only collision policy changed.', {
      placementId: placement.placementId ?? null,
    });
  }
  if (!isSerializablePlanValue(placement)) {
    addDiagnostic(errors, 'room-pack-placement-not-serializable', 'Placement contains non-serializable runtime data.', {
      placementId: placement.placementId ?? null,
    });
  }
  if (!Object.isFrozen(placement)) {
    addDiagnostic(errors, 'room-pack-placement-not-immutable', 'Accepted semantic room-pack placement must be deeply frozen.', {
      placementId: placement.placementId ?? null,
    });
  }
  if (stablePlanStringify(placement.authoredRootTransform?.scale) !== stablePlanStringify({ x: 1, y: 1, z: 1 })
    || placement.authoredRootTransform?.recenter !== false
    || stablePlanStringify(placement.placementTransform?.scale) !== stablePlanStringify({ x: 1, y: 1, z: 1 })) {
    addDiagnostic(errors, 'room-pack-authored-transform-drift', 'Authored origin/scale preservation was violated.', {
      placementId: placement.placementId ?? null,
    });
  }

  let expected = null;
  try {
    expected = compilePlacementUnchecked(placement.sourcePlacement);
  } catch (error) {
    addDiagnostic(errors, 'room-pack-placement-source-invalid', 'Placement source transform can no longer be compiled.', {
      placementId: placement.placementId ?? null,
      message: error.message,
    });
  }
  if (expected) {
    if (stablePlanStringify(placement.sockets) !== stablePlanStringify(expected.sockets)) {
      addDiagnostic(errors, 'room-pack-socket-node-drift', 'Transformed socket anchors/facing no longer match the named entry-socket transform.', {
        placementId: placement.placementId,
      });
    }
    if (stablePlanStringify(placement.transformedCollisionVolumes) !== stablePlanStringify(expected.transformedCollisionVolumes)
      || stablePlanStringify(placement.compiledPhysicalRecords?.colliders) !== stablePlanStringify(expected.transformedCollisionVolumes)) {
      addDiagnostic(errors, 'room-pack-collision-transform-drift', 'Transformed collision records no longer match manifest collisionVolumes.', {
        placementId: placement.placementId,
      });
    }
    for (const key of ['worldBounds', 'regions', 'traversalLinks', 'mechanisms', 'environmentContracts', 'falls', 'anchors', 'presentationBinding']) {
      if (stablePlanStringify(placement[key]) !== stablePlanStringify(expected[key])) {
        addDiagnostic(errors, 'room-pack-placement-contract-drift', 'A compiled authored-room contract no longer matches its source transform.', {
          placementId: placement.placementId,
          field: key,
        });
      }
    }
    if (stablePlanStringify(placement.placedRecordIds) !== stablePlanStringify(expected.placedRecordIds)) {
      addDiagnostic(errors, 'room-pack-physical-ownership-drift', 'Placed physical record IDs no longer own the complete manifest collision set.', {
        placementId: placement.placementId,
      });
    }
  }

  const colliderIds = placement.compiledPhysicalRecords?.colliders?.map(({ id }) => id) ?? [];
  const sourceNodeNames = placement.compiledPhysicalRecords?.colliders?.map(({ sourceNodeName }) => sourceNodeName) ?? [];
  if (new Set(colliderIds).size !== colliderIds.length
    || new Set(sourceNodeNames).size !== sourceNodeNames.length
    || stablePlanStringify(colliderIds) !== stablePlanStringify(placement.placedRecordIds?.colliderIds ?? [])) {
    addDiagnostic(errors, 'room-pack-physical-ownership-drift', 'Collider IDs must be unique and exactly enumerate every transformed manifest volume.', {
      placementId: placement.placementId ?? null,
    });
  }
  const entrySocket = placement.sockets?.find(({ id }) => id === placement.entrySocketId);
  if (!entrySocket
    || !vectorsEqual(entrySocket.worldPosition, placement.presentationBinding?.targetPortal?.position ?? {})
    || !vectorsEqual(entrySocket.worldForward, placement.presentationBinding?.targetPortal?.forward ?? {})) {
    addDiagnostic(errors, 'room-pack-socket-node-drift', 'The selected entry socket is not exactly aligned to its planned portal.', {
      placementId: placement.placementId ?? null,
    });
  }
  if (placement.semanticNodeNames?.some((nodeName) => !placement.visualNodeNames?.includes(nodeName))) {
    addDiagnostic(errors, 'room-pack-semantic-node-missing', 'Presentation binding omits an authored semantic node.', {
      placementId: placement.placementId ?? null,
    });
  }
  return validationResult(errors, {
    placementId: placement.placementId ?? null,
    roomId: placement.roomId ?? null,
    colliderCount: colliderIds.length,
    boundaryCount: placement.structuralBoundaries?.length ?? 0,
    walkableSurfaceCount: placement.walkableSurfaces?.length ?? 0,
    structuralFixtureCount: placement.structuralFixtures?.length ?? 0,
  });
}

export class SemanticRoomPackPlacementErrorV2 extends Error {
  constructor(result) {
    const first = result.errors?.[0];
    super(first
      ? `Semantic room-pack placement rejected: ${first.code}: ${first.message}`
      : 'Semantic room-pack placement rejected.');
    this.name = 'SemanticRoomPackPlacementErrorV2';
    this.code = 'SEMANTIC_ROOM_PACK_PLACEMENT_INVALID';
    this.result = result;
  }
}

export function compileSemanticRoomPackPlacementV2(roomIdOrSpec, options) {
  const placement = compilePlacementUnchecked(roomIdOrSpec, options);
  const validation = validateSemanticRoomPackPlacementV2(placement);
  if (!validation.accepted) throw new SemanticRoomPackPlacementErrorV2(validation);
  return placement;
}

export function recompileSemanticRoomPackPlacementV2(placement) {
  return compileSemanticRoomPackPlacementV2(placement?.sourcePlacement ?? placement);
}

export function validateSemanticRoomPackPlanV2(plan) {
  const errors = [];
  const placements = Array.isArray(plan?.semanticRoomPackPlacements)
    ? plan.semanticRoomPackPlacements
    : [];
  const placementIds = new Set();
  const roomIds = new Set();
  for (const placement of placements) {
    if (placementIds.has(placement?.placementId) || roomIds.has(placement?.roomId)) {
      addDiagnostic(errors, 'room-pack-placement-duplicate', 'An accepted dungeon cannot repeat a semantic room placement ID or authored topology.', {
        placementId: placement?.placementId ?? null,
        roomId: placement?.roomId ?? null,
      });
    }
    placementIds.add(placement?.placementId);
    roomIds.add(placement?.roomId);
    const result = validateSemanticRoomPackPlacementV2(placement);
    errors.push(...result.errors);
  }
  const undercroftRoomIds = placements
    .map(({ roomId }) => roomId)
    .filter((roomId) => roomId === 'rdx_magma_foundry_undercroft' || roomId === 'rdx_electric_transformer_undercroft');
  if (undercroftRoomIds.length > 1) {
    addDiagnostic(errors, 'room-pack-undercroft-exclusive', 'A dungeon plan may select Magma or Electrical Undercroft, never both.', {
      roomIds: undercroftRoomIds,
    });
  }
  return validationResult(errors, {
    placementCount: placements.length,
    roomIds: placements.map(({ roomId }) => roomId),
  });
}

export default compileSemanticRoomPackPlacementV2;
