import { canonicalStringify, hashCanonicalValue } from './canonical.js';

const ROUTE_NETWORK_CONFLICT_SIGNATURE_NAMESPACE =
  'ruindivex-dungeon-route-network-conflict-entity/v2';

// Conflict fingerprints intentionally project only renderer-free physical
// realization. Gameplay/progression identity, presentation, theme selection,
// and search bookkeeping can legitimately change between a raw bounded
// candidate and its finalized overlay without changing the room or path that
// collided at runtime.
const ROUTE_NETWORK_CONFLICT_NONPHYSICAL_NESTED_KEYS = new Set([
  'accessDomainId',
  'anchors',
  'candidateOrdinal',
  'connectionId',
  'grantId',
  'id',
  'nodeId',
  'operationId',
  'parentRegionId',
  'plannedMinimumGraphDegree',
  'planningElapsedMs',
  'planningOnly',
  'planningParentLocalSocketId',
  'planningPhaseTimings',
  'planningStartedAt',
  'presentationRecords',
  'presentationVariantId',
  'progressionBandId',
  'progressionOrder',
  'requiredCredentialIds',
  'requiredKeycardId',
  'requiresEncounterId',
  'roomId',
  'runtimeStateId',
  'runtimeStateIds',
  'searchVariant',
  'segmentId',
  'socketId',
  'socketIdByLocalId',
  'stableRuntimeStateId',
  'stableRuntimeStateIds',
  'stateId',
  'themeBinding',
]);

const ROUTE_NETWORK_NODE_PHYSICAL_KEYS = Object.freeze([
  'kind',
  'grammarId',
  'grammarRevision',
  'blueprintId',
  'blueprintCanonicalRotationQuarterTurns',
  'moduleBlueprintId',
  'physicalBlueprintId',
  'moduleKind',
  'moduleTemplateId',
  'contentRole',
  'placement',
  'size',
  'structure',
  'sockets',
  'occupiedVolumes',
  'clearanceVolumes',
  'junction',
  'junctionKind',
  'junctionContract',
  'isSupplementConnectorJunction',
  'isSupplementConnectorModule',
  'connectorInfrastructure',
  'connectorModuleTraversal',
  'elevationMode',
  'exactParentEndpoint',
  'parentEndpointSocketKind',
  'parentAttachmentLocalSocketId',
  'parentThroughRouteDegreeContribution',
  'graphDegree',
  'realizedConnectorKind',
]);

const ROUTE_NETWORK_SEGMENT_PHYSICAL_KEYS = Object.freeze([
  'kind',
  'connectorFamily',
  'connectorVariant',
  'connectorVariantId',
  'routeRole',
  'from',
  'to',
  'path',
  'centerline',
  'fullPath',
  'polyline',
  'width',
  'widthMeters',
  'height',
  'heightMeters',
  'endpointSeams',
  'landings',
  'landingVolumes',
  'localApproachWitnesses',
  'sharedEndpointFootprint',
  'occupiedVolumes',
  'clearanceVolumes',
  'traversal',
  'verticalTransfer',
  'traversalKind',
  'direction',
  'sourceElevation',
  'destinationElevation',
  'elevationDelta',
  'routeNetworkElevationMode',
  'shortcut',
  'shortcutMode',
  'gateEndpointRole',
  'gatePlacementSide',
]);

function stringValue(value) {
  return value == null ? '' : String(value).trim();
}

function physicalConflictCanonicalSortKey(value) {
  return canonicalStringify(value) ?? 'undefined';
}

function physicalConflictSignatureValue(value) {
  if (Array.isArray(value)) return value.map(physicalConflictSignatureValue);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Map) {
    const entries = [...value.entries()].map(([key, entry]) => ([
      physicalConflictSignatureValue(key),
      physicalConflictSignatureValue(entry),
    ]));
    entries.sort((first, second) => (
      physicalConflictCanonicalSortKey(first)
        .localeCompare(physicalConflictCanonicalSortKey(second))
    ));
    return {
      routeNetworkConflictCollectionKind: 'Map',
      entries,
    };
  }
  if (value instanceof Set) {
    const entries = [...value].map(physicalConflictSignatureValue);
    entries.sort((first, second) => (
      physicalConflictCanonicalSortKey(first)
        .localeCompare(physicalConflictCanonicalSortKey(second))
    ));
    return {
      routeNetworkConflictCollectionKind: 'Set',
      entries,
    };
  }
  const result = {};
  for (const key of Object.keys(value)) {
    if (ROUTE_NETWORK_CONFLICT_NONPHYSICAL_NESTED_KEYS.has(key)) continue;
    result[key] = physicalConflictSignatureValue(value[key]);
  }
  return result;
}

function physicalConflictEntityProjection(entity, entityKind) {
  const keys = entityKind === 'segment'
    ? ROUTE_NETWORK_SEGMENT_PHYSICAL_KEYS
    : ROUTE_NETWORK_NODE_PHYSICAL_KEYS;
  const projected = {};
  for (const key of keys) {
    if (!Object.hasOwn(entity ?? {}, key) || entity[key] === undefined) continue;
    projected[key] = physicalConflictSignatureValue(entity[key]);
  }
  return projected;
}

/**
 * Route-network IDs are ordinal identities and can be reused by a later
 * bounded candidate. Recovery therefore fingerprints the exact module
 * placement or segment path that failed instead of banning an ordinal ID.
 */
export function createRouteNetworkConflictEntitySignature(entity, entityKind) {
  const kind = entityKind === 'segment' ? 'segment' : 'node';
  return hashCanonicalValue({
    kind,
    value: physicalConflictEntityProjection(entity ?? {}, kind),
  }, { namespace: ROUTE_NETWORK_CONFLICT_SIGNATURE_NAMESPACE });
}

export function normalizeRouteNetworkConflictExclusions(entries = []) {
  const byIdentity = new Map();
  for (const raw of Array.isArray(entries) ? entries : []) {
    const grantId = stringValue(raw?.grantId);
    const entityKind = raw?.entityKind === 'segment' || raw?.kind === 'segment'
      ? 'segment'
      : 'node';
    const entityId = stringValue(
      raw?.entityId ?? (entityKind === 'segment' ? raw?.segmentId : raw?.nodeId),
    );
    const signature = stringValue(raw?.signature);
    if (!grantId || !entityId || !signature) continue;
    const reason = stringValue(raw?.reason).slice(0, 128)
      || 'route-network-runtime-physical-conflict';
    const normalized = { grantId, entityKind, entityId, signature, reason };
    // Ordinal IDs are diagnostic evidence from the rejected candidate, not
    // part of the physical ban. A later topology/candidate may assign the
    // exact same room placement or segment path a different ordinal ID.
    const key = `${grantId}\u0000${entityKind}\u0000${signature}`;
    const current = byIdentity.get(key);
    if (!current
      || entityId.localeCompare(current.entityId) < 0
      || (entityId === current.entityId && reason.localeCompare(current.reason) < 0)) {
      byIdentity.set(key, normalized);
    }
  }
  return [...byIdentity.values()].sort((first, second) => (
    first.grantId.localeCompare(second.grantId)
      || first.entityKind.localeCompare(second.entityKind)
      || first.entityId.localeCompare(second.entityId)
      || first.signature.localeCompare(second.signature)
      || first.reason.localeCompare(second.reason)
  ));
}

/**
 * Canonical audit ledger for physical entities removed from an otherwise
 * retained route-network grant.  Unlike conflict exclusions this ledger is
 * operation-specific: it describes the exact node/segment identities absent
 * from the finalized overlay, rather than a reusable physical candidate ban.
 */
export function normalizeRouteNetworkEntityOmissions(entries = []) {
  const byIdentity = new Map();
  for (const raw of Array.isArray(entries) ? entries : []) {
    const grantId = stringValue(raw?.grantId);
    const operationId = stringValue(raw?.operationId);
    const entityKind = raw?.entityKind === 'segment' || raw?.kind === 'segment'
      ? 'segment'
      : raw?.entityKind === 'node' || raw?.kind === 'node'
        ? 'node'
        : '';
    const entityId = stringValue(
      raw?.entityId ?? (entityKind === 'segment' ? raw?.segmentId : raw?.nodeId),
    );
    const ordinal = Number(raw?.ordinal);
    const disposition = raw?.disposition === 'conflict-root'
      ? 'conflict-root'
      : raw?.disposition === 'dependency'
        ? 'dependency'
        : '';
    if (!grantId || !operationId || !entityKind || !entityId
      || !Number.isSafeInteger(ordinal) || ordinal < 0 || !disposition) continue;
    const reason = stringValue(raw?.reason).slice(0, 128)
      || 'route-network-entity-conflict';
    const signature = stringValue(raw?.signature);
    const rootSignature = stringValue(raw?.rootSignature);
    if (!signature || !rootSignature) continue;
    const normalized = {
      grantId,
      operationId,
      entityKind,
      entityId,
      ordinal,
      signature: signature || null,
      disposition,
      reason,
      rootSignature: rootSignature || null,
    };
    const key = `${grantId}\u0000${operationId}\u0000${entityKind}\u0000${entityId}`;
    const current = byIdentity.get(key);
    const sortKey = canonicalStringify(normalized);
    if (!current || sortKey.localeCompare(canonicalStringify(current)) < 0) {
      byIdentity.set(key, normalized);
    }
  }
  return [...byIdentity.values()].sort((first, second) => (
    first.grantId.localeCompare(second.grantId)
      || first.operationId.localeCompare(second.operationId)
      || first.entityKind.localeCompare(second.entityKind)
      || first.ordinal - second.ordinal
      || first.entityId.localeCompare(second.entityId)
      || String(first.signature ?? '').localeCompare(String(second.signature ?? ''))
      || first.disposition.localeCompare(second.disposition)
      || first.reason.localeCompare(second.reason)
      || String(first.rootSignature ?? '').localeCompare(String(second.rootSignature ?? ''))
  ));
}

const ROUTE_NETWORK_SALVAGE_REALIZATION_MODE = 'parent-anchored-forest';
const ROUTE_NETWORK_SUPPLEMENT_ROOM_KIND = 'supplementRoom';
const ROUTE_NETWORK_CONNECTOR_MODULE_KIND = 'supplementConnectorModule';
const ROUTE_NETWORK_CONNECTOR_JUNCTION_KIND = 'supplementConnectorJunction';

function cloneRouteNetworkSalvageValue(value, seen = new Map()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const clone = [];
    seen.set(value, clone);
    clone.push(...value.map((entry) => cloneRouteNetworkSalvageValue(entry, seen)));
    return clone;
  }
  if (value instanceof Map) {
    const clone = new Map();
    seen.set(value, clone);
    for (const [key, entry] of value) {
      clone.set(
        cloneRouteNetworkSalvageValue(key, seen),
        cloneRouteNetworkSalvageValue(entry, seen),
      );
    }
    return clone;
  }
  if (value instanceof Set) {
    const clone = new Set();
    seen.set(value, clone);
    for (const entry of value) {
      clone.add(cloneRouteNetworkSalvageValue(entry, seen));
    }
    return clone;
  }
  const clone = {};
  seen.set(value, clone);
  for (const [key, entry] of Object.entries(value)) {
    clone[key] = cloneRouteNetworkSalvageValue(entry, seen);
  }
  return clone;
}

function routeNetworkSalvageEntityOrdinal(entity, entityKind) {
  const value = entityKind === 'segment'
    ? entity?.physicalOrdinal ?? entity?.ordinal
    : entity?.ordinal;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function compareRouteNetworkSalvageEntities(first, second) {
  return first.ordinal - second.ordinal
    || first.id.localeCompare(second.id);
}

function routeNetworkSalvageEndpointNodeId(endpoint) {
  return stringValue(endpoint?.nodeId ?? endpoint?.roomId);
}

function routeNetworkSalvageEndpointSocketId(endpoint) {
  return stringValue(endpoint?.socketId ?? endpoint?.id ?? endpoint?.sourceSocketId);
}

function routeNetworkSalvageParentThroughContribution(node) {
  return node?.exactParentEndpoint === true
    && node?.parentEndpointSocketKind === 'authored-corridor-station'
    ? Math.min(1, Math.max(0, Number(node?.parentThroughRouteDegreeContribution ?? 0)))
    : 0;
}

function routeNetworkSalvageConnectorMinimumDegree(node) {
  if (node?.kind === ROUTE_NETWORK_CONNECTOR_JUNCTION_KIND
    || node?.isSupplementConnectorJunction === true) {
    return 3;
  }
  if (node?.kind === ROUTE_NETWORK_CONNECTOR_MODULE_KIND
    || node?.isSupplementConnectorModule === true) {
    return 2;
  }
  return 1;
}

function routeNetworkSalvageMinimumIncidentSegmentCount(node) {
  const minimumDegree = routeNetworkSalvageConnectorMinimumDegree(node);
  // An authored corridor's continuation is a real arm of an exact through-T
  // junction, so it can satisfy one of that junction's three approaches. It is
  // not, however, a second attachment to a supplemental connector module. If
  // pruning leaves such a module with only its parent-station attachment, the
  // module is a physical dead end and DungeonGenerator cannot stamp it as a
  // two-arm connector. Require two retained supplement segments for modules;
  // only a junction may use the exact parent-through contribution.
  if (node?.kind === ROUTE_NETWORK_CONNECTOR_MODULE_KIND
    || node?.isSupplementConnectorModule === true) {
    return minimumDegree;
  }
  return Math.max(
    1,
    minimumDegree - routeNetworkSalvageParentThroughContribution(node),
  );
}

function maximumContinuousSalvageLevelDistance(path = []) {
  let current = 0;
  let maximum = 0;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const point = path[index];
    if (Math.abs(Number(point?.y ?? 0) - Number(previous?.y ?? 0)) > 1e-6) {
      maximum = Math.max(maximum, current);
      current = 0;
      continue;
    }
    current += Math.hypot(
      Number(point?.x ?? 0) - Number(previous?.x ?? 0),
      Number(point?.z ?? 0) - Number(previous?.z ?? 0),
    );
  }
  return Math.max(maximum, current);
}

function routeNetworkSalvageFeaturelessSpans(operationId, segments) {
  return segments.map((segment, ordinal) => {
    const verticalTransition = segment?.verticalTransfer === true;
    return {
      id: `${operationId}:physical-featureless-span:${ordinal}`,
      segmentId: String(segment.id),
      ordinal,
      ...(verticalTransition
        ? {
          transitionPath: cloneRouteNetworkSalvageValue(segment.path ?? []),
          meaningfulTransition: true,
        }
        : { path: cloneRouteNetworkSalvageValue(segment.path ?? []) }),
      distanceMeters: maximumContinuousSalvageLevelDistance(segment.path ?? []),
      spanKind: verticalTransition
        ? 'supplement-horizontal-approach-to-elevation-transition'
        : 'supplement-physical-route',
      boundedByMeaningfulStations: true,
    };
  });
}

function routeNetworkSalvageFailure(code, {
  operationId = null,
  grantId = null,
  routeNetworkEntityOmissions = [],
  ...context
} = {}) {
  return {
    error: code,
    context: {
      operationId,
      grantId,
      routeNetworkEntityOmissions,
      ...context,
    },
  };
}

/**
 * Derive a renderer-free, parent-anchored forest from one already-evaluated
 * route-network candidate. This helper does not authorize planner acceptance:
 * callers must keep complete bounded replacements ahead of this fallback.
 *
 * Every retained component is connected to one or more exact parent sockets.
 * Exact physical conflicts seed the removal set; only incident dependencies,
 * unrooted fragments, and invalid connector infrastructure are then removed.
 * Safe cycles and safe multi-root connections remain intact. Source IDs and
 * ordinals are never rewritten.
 */
export function createParentAnchoredRouteNetworkSalvage(
  planned,
  exclusions = [],
  options = {},
) {
  if (!planned?.operation || planned.error) {
    return routeNetworkSalvageFailure(
      'route-network-parent-anchored-salvage-candidate-invalid',
    );
  }
  const operationId = stringValue(planned.operation.id);
  const grantId = stringValue(planned.operation.grantId);
  if (!operationId || !grantId
    || !Array.isArray(planned.nodes)
    || !Array.isArray(planned.segments)) {
    return routeNetworkSalvageFailure(
      'route-network-parent-anchored-salvage-candidate-invalid',
      { operationId: operationId || null, grantId: grantId || null },
    );
  }

  const nodeRecords = planned.nodes.map((entity) => ({
    entity,
    id: stringValue(entity?.id),
    ordinal: routeNetworkSalvageEntityOrdinal(entity, 'node'),
  })).filter(({ id }) => Boolean(id)).sort(compareRouteNetworkSalvageEntities);
  const segmentRecords = planned.segments.map((entity) => ({
    entity,
    id: stringValue(entity?.id),
    ordinal: routeNetworkSalvageEntityOrdinal(entity, 'segment'),
  })).filter(({ id }) => Boolean(id)).sort(compareRouteNetworkSalvageEntities);
  const invalidSourceOrdinals = [
    ...nodeRecords.filter(({ ordinal }) => ordinal == null).map(({ id }) => `node:${id}`),
    ...segmentRecords.filter(({ ordinal }) => ordinal == null).map(({ id }) => `segment:${id}`),
  ];
  const duplicateSourceOrdinals = (records, entityKind) => {
    const seen = new Set();
    return records.flatMap(({ id, ordinal }) => {
      if (!seen.has(ordinal)) {
        seen.add(ordinal);
        return [];
      }
      return [`${entityKind}:${id}:${ordinal}`];
    });
  };
  const duplicateOrdinalEvidence = [
    ...duplicateSourceOrdinals(nodeRecords, 'node'),
    ...duplicateSourceOrdinals(segmentRecords, 'segment'),
  ];
  if (invalidSourceOrdinals.length > 0 || duplicateOrdinalEvidence.length > 0) {
    return routeNetworkSalvageFailure(
      'route-network-parent-anchored-salvage-source-ordinals-invalid',
      {
        operationId,
        grantId,
        invalidSourceOrdinals,
        duplicateSourceOrdinals: duplicateOrdinalEvidence,
      },
    );
  }
  const nodeById = new Map(nodeRecords.map(({ id, entity }) => [id, entity]));
  const nodeRecordById = new Map(nodeRecords.map((record) => [record.id, record]));
  const segmentRecordById = new Map(segmentRecords.map((record) => [record.id, record]));
  const nodeSignatures = new Map(nodeRecords.map(({ id, entity }) => [
    id,
    createRouteNetworkConflictEntitySignature(entity, 'node'),
  ]));
  const segmentSignatures = new Map(segmentRecords.map(({ id, entity }) => [
    id,
    createRouteNetworkConflictEntitySignature(entity, 'segment'),
  ]));
  const segmentInternalNodeIds = (segment) => [segment?.from, segment?.to]
    .map(routeNetworkSalvageEndpointNodeId)
    .filter((nodeId) => nodeById.has(nodeId));
  const originalAdjacency = new Map(nodeRecords.map(({ id }) => [id, []]));
  const originalIncidentSegmentIdsByNodeId = new Map(
    nodeRecords.map(({ id }) => [id, []]),
  );
  for (const { id: segmentId, entity } of segmentRecords) {
    const internalNodeIds = [...new Set(segmentInternalNodeIds(entity))];
    for (const nodeId of internalNodeIds) {
      originalIncidentSegmentIdsByNodeId.get(nodeId)?.push(segmentId);
    }
    if (internalNodeIds.length !== 2) continue;
    originalAdjacency.get(internalNodeIds[0])?.push(internalNodeIds[1]);
    originalAdjacency.get(internalNodeIds[1])?.push(internalNodeIds[0]);
  }
  const originalComponentByNodeId = new Map();
  for (const { id: startNodeId } of nodeRecords) {
    if (originalComponentByNodeId.has(startNodeId)) continue;
    const componentId = startNodeId;
    const queue = [startNodeId];
    originalComponentByNodeId.set(startNodeId, componentId);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const nextNodeId of originalAdjacency.get(queue[cursor]) ?? []) {
        if (originalComponentByNodeId.has(nextNodeId)) continue;
        originalComponentByNodeId.set(nextNodeId, componentId);
        queue.push(nextNodeId);
      }
    }
  }
  const normalizedExclusions = normalizeRouteNetworkConflictExclusions(exclusions)
    .filter((entry) => entry.grantId === grantId);
  const removedNodeIds = new Set();
  const removedSegmentIds = new Set();
  const omissionByIdentity = new Map();
  const matchedRootSignatures = new Set();
  let dependencyRootAssignmentFailed = false;

  const addOmission = (
    entityKind,
    entityId,
    disposition,
    reason,
    rootSignature,
  ) => {
    const record = entityKind === 'segment'
      ? segmentRecordById.get(entityId)
      : nodeRecordById.get(entityId);
    if (!record) return;
    const key = `${entityKind}\u0000${entityId}`;
    if (omissionByIdentity.has(key)) return;
    const signature = entityKind === 'segment'
      ? segmentSignatures.get(entityId)
      : nodeSignatures.get(entityId);
    const normalizedRootSignature = stringValue(rootSignature);
    if (!signature || !normalizedRootSignature) {
      dependencyRootAssignmentFailed = true;
      return;
    }
    omissionByIdentity.set(key, {
      grantId,
      operationId,
      entityKind,
      entityId,
      ordinal: record.ordinal,
      signature,
      disposition,
      reason: stringValue(reason).slice(0, 128)
        || 'route-network-salvage-dependency',
      rootSignature: normalizedRootSignature,
    });
  };

  for (const exclusion of normalizedExclusions) {
    const records = exclusion.entityKind === 'segment' ? segmentRecords : nodeRecords;
    const signatures = exclusion.entityKind === 'segment'
      ? segmentSignatures
      : nodeSignatures;
    for (const { id } of records) {
      if (signatures.get(id) !== exclusion.signature) continue;
      matchedRootSignatures.add(exclusion.signature);
      if (exclusion.entityKind === 'segment') removedSegmentIds.add(id);
      else removedNodeIds.add(id);
      addOmission(
        exclusion.entityKind,
        id,
        'conflict-root',
        exclusion.reason,
        exclusion.signature,
      );
    }
  }
  if (matchedRootSignatures.size === 0) {
    return routeNetworkSalvageFailure(
      'route-network-parent-anchored-salvage-no-matching-conflict',
      { operationId, grantId },
    );
  }
  const rootSignaturesByOriginalComponent = new Map();
  const addRootForOriginalComponent = (componentId, rootSignature) => {
    if (!componentId || !rootSignature) return;
    if (!rootSignaturesByOriginalComponent.has(componentId)) {
      rootSignaturesByOriginalComponent.set(componentId, new Set());
    }
    rootSignaturesByOriginalComponent.get(componentId).add(rootSignature);
  };
  for (const omission of omissionByIdentity.values()) {
    if (omission.disposition !== 'conflict-root') continue;
    const componentIds = omission.entityKind === 'node'
      ? [originalComponentByNodeId.get(omission.entityId)]
      : segmentInternalNodeIds(segmentRecordById.get(omission.entityId)?.entity)
        .map((nodeId) => originalComponentByNodeId.get(nodeId));
    for (const componentId of new Set(componentIds.filter(Boolean))) {
      addRootForOriginalComponent(componentId, omission.rootSignature);
    }
  }
  const connectedConflictRootSignature = (entityKind, entityId) => {
    const componentIds = entityKind === 'node'
      ? [originalComponentByNodeId.get(entityId)]
      : segmentInternalNodeIds(segmentRecordById.get(entityId)?.entity)
        .map((nodeId) => originalComponentByNodeId.get(nodeId));
    const connected = [...new Set(componentIds.filter(Boolean))].flatMap((componentId) => (
      [...(rootSignaturesByOriginalComponent.get(componentId) ?? [])]
    ));
    return [...new Set(connected)].sort()[0] ?? null;
  };
  const directlyIncidentConflictRootSignature = (entityKind, entityId) => {
    const incidentRootOmissions = entityKind === 'node'
      ? (originalIncidentSegmentIdsByNodeId.get(entityId) ?? []).map((segmentId) => (
        omissionByIdentity.get(`segment\u0000${segmentId}`)
      ))
      : segmentInternalNodeIds(segmentRecordById.get(entityId)?.entity).map((nodeId) => (
        omissionByIdentity.get(`node\u0000${nodeId}`)
      ));
    const signatures = incidentRootOmissions
      .filter((omission) => omission?.disposition === 'conflict-root')
      .map((omission) => omission.rootSignature);
    return [...new Set(signatures)].sort()[0] ?? null;
  };
  const dependencyConflictRootSignature = (entityKind, entityId) => (
    directlyIncidentConflictRootSignature(entityKind, entityId)
      ?? connectedConflictRootSignature(entityKind, entityId)
  );
  for (const { id, entity } of segmentRecords) {
    if (removedSegmentIds.has(id)) continue;
    if (!segmentInternalNodeIds(entity).some((nodeId) => removedNodeIds.has(nodeId))) continue;
    removedSegmentIds.add(id);
    addOmission(
      'segment',
      id,
      'dependency',
      'incident-to-omitted-node',
      dependencyConflictRootSignature('segment', id),
    );
  }

  const declaredParentSocketIds = [...new Set((
    Array.isArray(planned.operation.endpointSocketIds)
      ? planned.operation.endpointSocketIds
      : Array.isArray(options.parentSocketIds)
        ? options.parentSocketIds
        : []
  ).map(stringValue).filter(Boolean))];
  const declaredParentSocketIdSet = new Set(declaredParentSocketIds);
  const endpointDescriptor = (endpoint, retainedNodeIds) => {
    const nodeId = routeNetworkSalvageEndpointNodeId(endpoint);
    if (retainedNodeIds.has(nodeId)) return { kind: 'node', id: nodeId };
    if (nodeById.has(nodeId)) return { kind: 'removed-node', id: nodeId };
    const socketId = routeNetworkSalvageEndpointSocketId(endpoint);
    const permitted = socketId && (
      declaredParentSocketIdSet.size === 0
        || declaredParentSocketIdSet.has(socketId)
    );
    return permitted
      ? { kind: 'parent', id: socketId }
      : { kind: 'invalid', id: socketId || nodeId };
  };

  const retainedNodeIds = new Set(nodeRecords
    .map(({ id }) => id)
    .filter((id) => !removedNodeIds.has(id)));
  const retainedSegmentIds = new Set();
  const usedParentSocketIds = new Set();
  for (const { id, entity } of segmentRecords) {
    if (removedSegmentIds.has(id)) continue;
    const descriptors = [entity?.from, entity?.to].map((endpoint) => (
      endpointDescriptor(endpoint, retainedNodeIds)
    ));
    if (descriptors.some(({ kind }) => ['invalid', 'removed-node'].includes(kind))
      || descriptors.filter(({ kind }) => kind === 'node').length === 0
      || descriptors.filter(({ kind }) => kind === 'parent').length > 1) {
      removedSegmentIds.add(id);
      addOmission(
        'segment',
        id,
        'dependency',
        'invalid-salvage-endpoint',
        dependencyConflictRootSignature('segment', id),
      );
      continue;
    }
    const parentDescriptor = descriptors.find(({ kind }) => kind === 'parent');
    if (parentDescriptor && usedParentSocketIds.has(parentDescriptor.id)) {
      removedSegmentIds.add(id);
      addOmission(
        'segment',
        id,
        'dependency',
        'duplicate-parent-socket-edge',
        dependencyConflictRootSignature('segment', id),
      );
      continue;
    }
    if (parentDescriptor) usedParentSocketIds.add(parentDescriptor.id);
    retainedSegmentIds.add(id);
  }

  const inspectComponents = () => {
    const adjacency = new Map([...retainedNodeIds].map((nodeId) => [nodeId, []]));
    for (const segmentId of retainedSegmentIds) {
      const segment = segmentRecordById.get(segmentId)?.entity;
      const descriptors = [segment?.from, segment?.to].map((endpoint) => (
        endpointDescriptor(endpoint, retainedNodeIds)
      ));
      const internal = descriptors.filter(({ kind }) => kind === 'node');
      const parent = descriptors.find(({ kind }) => kind === 'parent') ?? null;
      if (internal.length === 2) {
        adjacency.get(internal[0].id)?.push({ nodeId: internal[1].id, segmentId });
        adjacency.get(internal[1].id)?.push({ nodeId: internal[0].id, segmentId });
      } else if (internal.length === 1) {
        adjacency.get(internal[0].id)?.push({
          nodeId: null,
          parentSocketId: parent?.id ?? null,
          segmentId,
        });
      }
    }
    const visited = new Set();
    const result = [];
    for (const { id: startNodeId } of nodeRecords) {
      if (!retainedNodeIds.has(startNodeId) || visited.has(startNodeId)) continue;
      const queue = [startNodeId];
      const nodeIds = [];
      const segmentIds = new Set();
      const parentSocketIds = new Set();
      visited.add(startNodeId);
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const nodeId = queue[cursor];
        nodeIds.push(nodeId);
        for (const edge of adjacency.get(nodeId) ?? []) {
          segmentIds.add(edge.segmentId);
          if (edge.parentSocketId) parentSocketIds.add(edge.parentSocketId);
          if (!edge.nodeId || visited.has(edge.nodeId)) continue;
          visited.add(edge.nodeId);
          queue.push(edge.nodeId);
        }
      }
      result.push({
        nodeIds: nodeIds.sort((first, second) => (
          nodeRecordById.get(first).ordinal - nodeRecordById.get(second).ordinal
            || first.localeCompare(second)
        )),
        segmentIds: [...segmentIds].sort((first, second) => (
          segmentRecordById.get(first).ordinal - segmentRecordById.get(second).ordinal
            || first.localeCompare(second)
        )),
        parentSocketIds: [...parentSocketIds].sort(),
      });
    }
    return result;
  };

  let closureChanged = true;
  while (closureChanged) {
    closureChanged = false;
    const incidentSegmentCountByNodeId = new Map([...retainedNodeIds].map((nodeId) => [
      nodeId,
      0,
    ]));
    for (const segmentId of retainedSegmentIds) {
      const segment = segmentRecordById.get(segmentId)?.entity;
      for (const nodeId of segmentInternalNodeIds(segment)) {
        if (!retainedNodeIds.has(nodeId)) continue;
        incidentSegmentCountByNodeId.set(
          nodeId,
          (incidentSegmentCountByNodeId.get(nodeId) ?? 0) + 1,
        );
      }
    }
    const underDegreeNodeIds = [...retainedNodeIds].filter((nodeId) => {
      const node = nodeById.get(nodeId);
      return Number(incidentSegmentCountByNodeId.get(nodeId) ?? 0)
        < routeNetworkSalvageMinimumIncidentSegmentCount(node);
    });
    if (underDegreeNodeIds.length > 0) {
      closureChanged = true;
      for (const nodeId of underDegreeNodeIds) {
        retainedNodeIds.delete(nodeId);
        removedNodeIds.add(nodeId);
        const node = nodeById.get(nodeId);
        addOmission(
          'node',
          nodeId,
          'dependency',
          routeNetworkSalvageConnectorMinimumDegree(node) > 1
            ? 'under-degree-connector-infrastructure'
            : 'isolated-node',
          dependencyConflictRootSignature('node', nodeId),
        );
      }
      for (const segmentId of [...retainedSegmentIds]) {
        const segment = segmentRecordById.get(segmentId)?.entity;
        if (!segmentInternalNodeIds(segment).some((nodeId) => (
          underDegreeNodeIds.includes(nodeId)
        ))) continue;
        retainedSegmentIds.delete(segmentId);
        removedSegmentIds.add(segmentId);
        addOmission(
          'segment',
          segmentId,
          'dependency',
          'incident-to-under-degree-node',
          dependencyConflictRootSignature('segment', segmentId),
        );
      }
    }

    for (const component of inspectComponents()) {
      if (component.parentSocketIds.length >= 1) continue;
      closureChanged = true;
      for (const nodeId of component.nodeIds) {
        retainedNodeIds.delete(nodeId);
        removedNodeIds.add(nodeId);
        addOmission(
          'node',
          nodeId,
          'dependency',
          'unrooted-component',
          dependencyConflictRootSignature('node', nodeId),
        );
      }
      for (const segmentId of component.segmentIds) {
        retainedSegmentIds.delete(segmentId);
        removedSegmentIds.add(segmentId);
        addOmission(
          'segment',
          segmentId,
          'dependency',
          'unrooted-component',
          dependencyConflictRootSignature('segment', segmentId),
        );
      }
    }
  }

  const rawComponents = inspectComponents().filter((component) => (
    component.nodeIds.length > 0
      && component.segmentIds.length > 0
      && component.parentSocketIds.length >= 1
  ));
  const retainedComponentNodeIds = new Set(rawComponents.flatMap(({ nodeIds }) => nodeIds));
  const retainedComponentSegmentIds = new Set(
    rawComponents.flatMap(({ segmentIds }) => segmentIds),
  );
  for (const nodeId of [...retainedNodeIds]) {
    if (retainedComponentNodeIds.has(nodeId)) continue;
    retainedNodeIds.delete(nodeId);
    removedNodeIds.add(nodeId);
    addOmission(
      'node',
      nodeId,
      'dependency',
      'empty-component',
      dependencyConflictRootSignature('node', nodeId),
    );
  }
  for (const segmentId of [...retainedSegmentIds]) {
    if (retainedComponentSegmentIds.has(segmentId)) continue;
    retainedSegmentIds.delete(segmentId);
    removedSegmentIds.add(segmentId);
    addOmission(
      'segment',
      segmentId,
      'dependency',
      'empty-component',
      dependencyConflictRootSignature('segment', segmentId),
    );
  }

  if (dependencyRootAssignmentFailed) {
    return routeNetworkSalvageFailure(
      'route-network-parent-anchored-salvage-dependency-root-unavailable',
      { operationId, grantId },
    );
  }

  const routeNetworkEntityOmissions = [...omissionByIdentity.values()].sort(
    (first, second) => (
      first.grantId.localeCompare(second.grantId)
        || first.operationId.localeCompare(second.operationId)
        || first.entityKind.localeCompare(second.entityKind)
        || first.ordinal - second.ordinal
        || first.entityId.localeCompare(second.entityId)
        || first.signature.localeCompare(second.signature)
        || first.reason.localeCompare(second.reason)
    ),
  );
  if (retainedNodeIds.size === 0
    || retainedSegmentIds.size === 0
    || rawComponents.length === 0) {
    return routeNetworkSalvageFailure(
      'route-network-parent-anchored-salvage-empty',
      {
        operationId,
        grantId,
        routeNetworkEntityOmissions,
        matchedConflictRootCount: matchedRootSignatures.size,
      },
    );
  }

  const retainedSegments = segmentRecords
    .filter(({ id }) => retainedSegmentIds.has(id))
    .map(({ entity }) => cloneRouteNetworkSalvageValue(entity));
  const activeSegmentBySocketKey = new Map();
  for (const segment of retainedSegments) {
    for (const endpoint of [segment?.from, segment?.to]) {
      const nodeId = routeNetworkSalvageEndpointNodeId(endpoint);
      const socketId = routeNetworkSalvageEndpointSocketId(endpoint);
      if (!retainedNodeIds.has(nodeId) || !socketId) continue;
      const key = `${nodeId}\u0000${socketId}`;
      if (!activeSegmentBySocketKey.has(key)) {
        activeSegmentBySocketKey.set(key, String(segment.id));
      }
    }
  }
  const retainedDegreeByNodeId = new Map([...retainedNodeIds].map((nodeId) => [
    nodeId,
    routeNetworkSalvageParentThroughContribution(nodeById.get(nodeId)),
  ]));
  for (const segment of retainedSegments) {
    for (const nodeId of segmentInternalNodeIds(segment)) {
      if (!retainedNodeIds.has(nodeId)) continue;
      retainedDegreeByNodeId.set(nodeId, (retainedDegreeByNodeId.get(nodeId) ?? 0) + 1);
    }
  }
  const retainedNodes = nodeRecords.filter(({ id }) => retainedNodeIds.has(id)).map(({
    entity,
    id,
  }) => {
    const node = cloneRouteNetworkSalvageValue(entity);
    node.sockets = (node.sockets ?? []).map((sourceSocket) => {
      const socket = cloneRouteNetworkSalvageValue(sourceSocket);
      const segmentId = activeSegmentBySocketKey.get(
        `${id}\u0000${stringValue(socket.id)}`,
      );
      if (segmentId) {
        socket.state = 'connected';
        socket.segmentId = segmentId;
        socket.capRole = null;
      } else if (socket.state === 'connected' || socket.segmentId != null) {
        socket.state = 'capped';
        socket.segmentId = null;
        socket.capRole = 'cap';
      }
      return socket;
    });
    const graphDegree = Number(retainedDegreeByNodeId.get(id) ?? 0);
    node.graphDegree = graphDegree;
    if (node.junction && typeof node.junction === 'object') {
      const activeSocketIds = node.sockets
        .filter(({ state, segmentId }) => state === 'connected' && segmentId)
        .map(({ id: socketId }) => String(socketId));
      if (routeNetworkSalvageParentThroughContribution(node) > 0
        && node.parentThroughPhysicalArmId) {
        activeSocketIds.push(String(node.parentThroughPhysicalArmId));
      }
      const activeSocketIdSet = new Set(activeSocketIds);
      node.junction.graphDegree = graphDegree;
      node.junction.activeSocketIds = [...activeSocketIdSet];
      if (Array.isArray(node.junction.decisionSocketIds)) {
        node.junction.decisionSocketIds = node.junction.decisionSocketIds
          .map(String)
          .filter((socketId) => activeSocketIdSet.has(socketId));
      }
      if (Array.isArray(node.junction.throughSocketPairs)) {
        node.junction.throughSocketPairs = node.junction.throughSocketPairs.filter((pair) => (
          Array.isArray(pair)
            && pair.length === 2
            && pair.every((socketId) => activeSocketIdSet.has(String(socketId)))
        ));
      }
    }
    return node;
  });

  const retainedParentSocketIdSet = new Set(
    rawComponents.flatMap(({ parentSocketIds }) => parentSocketIds),
  );
  const retainedEndpointSocketIds = [
    ...declaredParentSocketIds.filter((socketId) => retainedParentSocketIdSet.has(socketId)),
    ...[...retainedParentSocketIdSet]
      .filter((socketId) => !declaredParentSocketIdSet.has(socketId))
      .sort(),
  ];
  const omittedEndpointSocketIds = declaredParentSocketIds.filter((socketId) => (
    !retainedParentSocketIdSet.has(socketId)
  ));
  const roomNodeIds = retainedNodes
    .filter(({ kind }) => kind === ROUTE_NETWORK_SUPPLEMENT_ROOM_KIND)
    .map(({ id }) => String(id));
  const connectorModuleNodeIds = retainedNodes
    .filter(({ kind }) => kind === ROUTE_NETWORK_CONNECTOR_MODULE_KIND)
    .map(({ id }) => String(id));
  const connectorJunctionNodeIds = retainedNodes
    .filter(({ kind }) => kind === ROUTE_NETWORK_CONNECTOR_JUNCTION_KIND)
    .map(({ id }) => String(id));
  const connectorInfrastructureNodeIds = retainedNodes
    .filter(({ connectorOwned }) => connectorOwned === true)
    .map(({ id }) => String(id));
  const retainedGraphCycleRank = retainedSegments.length
    - (retainedNodes.length + retainedEndpointSocketIds.length)
    + rawComponents.length;
  if (!Number.isSafeInteger(retainedGraphCycleRank) || retainedGraphCycleRank < 0) {
    return routeNetworkSalvageFailure(
      'route-network-parent-anchored-salvage-cycle-rank-invalid',
      {
        operationId,
        grantId,
        retainedNodeCount: retainedNodes.length,
        retainedSegmentCount: retainedSegments.length,
        retainedEndpointCount: retainedEndpointSocketIds.length,
        retainedComponentCount: rawComponents.length,
        retainedGraphCycleRank,
      },
    );
  }
  const operation = {
    ...cloneRouteNetworkSalvageValue(planned.operation),
    realizationMode: ROUTE_NETWORK_SALVAGE_REALIZATION_MODE,
    endpointSocketIds: retainedEndpointSocketIds,
    omittedEndpointSocketIds,
    nodeIds: retainedNodes.map(({ id }) => String(id)),
    roomNodeIds,
    connectorModuleNodeIds,
    connectorJunctionNodeIds,
    connectorInfrastructureNodeIds,
    moduleCount: roomNodeIds.length + connectorJunctionNodeIds.length,
    substantiveModuleCount: roomNodeIds.length + connectorJunctionNodeIds.length,
    physicalNodeCount: retainedNodes.length,
    roomCount: roomNodeIds.length,
    connectorModuleCount: connectorModuleNodeIds.length,
    connectorJunctionCount: connectorJunctionNodeIds.length,
    connectorInfrastructureCount: connectorInfrastructureNodeIds.length,
    segmentIds: retainedSegments.map(({ id }) => String(id)),
    contentRoles: retainedNodes.map(({ contentRole }) => String(contentRole ?? '')),
    junctionKinds: [...new Set(retainedNodes
      .filter(({ kind }) => kind === ROUTE_NETWORK_CONNECTOR_JUNCTION_KIND)
      .map((node) => stringValue(node?.junction?.junctionKind ?? node?.junctionKind))
      .filter(Boolean))],
    featurelessSpans: routeNetworkSalvageFeaturelessSpans(
      operationId,
      retainedSegments,
    ),
    cycleRankDelta: retainedGraphCycleRank,
    localProgressionArcRealized: false,
    ...(planned.operation.routeNetworkKind === 'objective-route-coverage' ? {
      authoredCoverageRealized: false,
    } : {}),
  };
  const retainedParentSocketOrdinalById = new Map(
    retainedEndpointSocketIds.map((socketId, socketOrdinal) => [socketId, socketOrdinal]),
  );
  const canonicalAttachmentSocketIds = (component) => [
    ...retainedEndpointSocketIds.filter((socketId) => component.parentSocketIds.includes(socketId)),
    ...component.parentSocketIds
      .filter((socketId) => !retainedParentSocketOrdinalById.has(socketId))
      .sort(),
  ];
  const parentAnchoredComponents = rawComponents.map((component) => ({
    ...component,
    attachmentSocketIds: canonicalAttachmentSocketIds(component),
  })).sort((first, second) => (
    Number(retainedParentSocketOrdinalById.get(first.attachmentSocketIds[0]))
      - Number(retainedParentSocketOrdinalById.get(second.attachmentSocketIds[0]))
      || String(first.nodeIds[0] ?? '').localeCompare(String(second.nodeIds[0] ?? ''))
  )).map((component, componentOrdinal) => ({
    id: `${operationId}:parent-anchored-component:${componentOrdinal}`,
    attachmentSocketIds: [...component.attachmentSocketIds],
    attachmentSocketId: component.attachmentSocketIds[0],
    nodeIds: [...component.nodeIds],
    segmentIds: [...component.segmentIds],
    bidirectional: true,
  }));
  operation.parentAnchoredComponents = parentAnchoredComponents;

  return {
    ...planned,
    operation,
    nodes: retainedNodes,
    segments: retainedSegments,
    routeNetworkEntityOmissions,
    parentAnchoredComponents,
  };
}

/**
 * Rejects only the exact previously conflicting physical candidate. The
 * evidence entity ID may change when another topology assigns new ordinals,
 * so enforcement is grant + entity kind + physical signature. The existing
 * bounded solver then tries its next authorized candidate, and the unchanged
 * full V4 planner/validator remains responsible for accepting the replacement
 * graph. No hashed operation is trimmed after validation.
 */
export function rejectRouteNetworkCandidateForConflictExclusions(
  planned,
  exclusions = [],
) {
  if (!planned?.operation || planned.error) return planned;
  const grantId = stringValue(planned.operation.grantId);
  const normalized = normalizeRouteNetworkConflictExclusions(exclusions)
    .filter((entry) => entry.grantId === grantId);
  if (normalized.length === 0) return planned;
  const matchedExclusions = normalized.filter((entry) => {
    const entities = entry.entityKind === 'segment'
      ? planned.segments ?? []
      : planned.nodes ?? [];
    return entities.some((entity) => (
      createRouteNetworkConflictEntitySignature(entity, entry.entityKind)
        === entry.signature
    ));
  });
  if (matchedExclusions.length === 0) return planned;
  return {
    error: 'route-network-conflicting-entity-excluded',
    context: {
      grantId,
      operationId: planned.operation.id ?? null,
      excludedEntities: matchedExclusions,
    },
  };
}
