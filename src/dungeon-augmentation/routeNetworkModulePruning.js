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
