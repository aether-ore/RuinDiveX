const V4_OVERLAY_SCHEMA = 'ruindivex-dungeon-augmentation-overlay/v2';
const PARENT_ANCHORED_FOREST_MODE = 'parent-anchored-forest';

function strings(values) {
  return Array.isArray(values) ? values.map(String) : [];
}

function uniqueStrings(values) {
  const normalized = strings(values);
  return normalized.length === new Set(normalized).size ? normalized : null;
}

function sameStringSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function sameStringSequence(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function operationType(operation) {
  return operation?.type ?? operation?.operationType ?? operation?.kind ?? null;
}

function ownerOperationId(entity) {
  return entity?.operationId ?? entity?.parentOperationId ?? entity?.operation?.id ?? null;
}

function endpointNodeId(endpoint) {
  return endpoint?.nodeId ?? endpoint?.roomId ?? null;
}

function endpointSocketId(endpoint) {
  return endpoint?.socketId ?? endpoint?.id ?? endpoint?.sourceSocketId ?? null;
}

function endpointHasPosition(endpoint) {
  const position = endpoint?.position ?? endpoint?.worldPosition ?? endpoint;
  return Number.isFinite(Number(position?.x)) && Number.isFinite(Number(position?.z));
}

function exactIdMap(records) {
  const result = new Map();
  for (const record of records) {
    const id = String(record?.id ?? '');
    if (!id || result.has(id)) return null;
    result.set(id, record);
  }
  return result;
}

function validConnectorOnlyParentAnchoredOperation({
  operation,
  nodes,
  segments,
  nodeById,
  segmentById,
  isConnectorNode,
}) {
  if (operationType(operation) !== 'routeNetwork'
    || operation?.realizationMode !== PARENT_ANCHORED_FOREST_MODE
    || operation?.localProgressionArcRealized !== false
    || operation?.returnRouteGuaranteed !== true) {
    return null;
  }

  const operationId = String(operation?.id ?? '');
  const nodeIds = uniqueStrings(operation?.nodeIds);
  const segmentIds = uniqueStrings(operation?.segmentIds);
  const endpointSocketIds = uniqueStrings(operation?.endpointSocketIds);
  const components = Array.isArray(operation?.parentAnchoredComponents)
    ? operation.parentAnchoredComponents
    : [];
  if (!operationId || !nodeIds?.length || !segmentIds?.length
    || !endpointSocketIds?.length || components.length === 0) {
    return null;
  }

  const nodeSet = new Set(nodeIds);
  const segmentSet = new Set(segmentIds);
  const ownedNodeIds = new Set(nodes.filter((node) => (
    String(ownerOperationId(node)) === operationId
  )).map(({ id }) => String(id)));
  const ownedSegmentIds = new Set(segments.filter((segment) => (
    String(ownerOperationId(segment)) === operationId
  )).map(({ id }) => String(id)));
  if (!sameStringSet(nodeSet, ownedNodeIds)
    || !sameStringSet(segmentSet, ownedSegmentIds)
    || nodeIds.some((id) => !nodeById.has(id))
    || segmentIds.some((id) => !segmentById.has(id))) {
    return null;
  }

  const globallyAssignedNodeIds = [];
  const globallyAssignedSegmentIds = [];
  const globallyAssignedAttachmentIds = [];
  const connectorOnlyProxyIds = [];
  const collapseRoomIdBySegmentId = new Map();
  for (const [componentOrdinal, component] of components.entries()) {
    const componentNodeIds = uniqueStrings(component?.nodeIds);
    const componentSegmentIds = uniqueStrings(component?.segmentIds);
    const attachmentSocketIds = uniqueStrings(component?.attachmentSocketIds);
    if (String(component?.id ?? '')
        !== `${operationId}:parent-anchored-component:${componentOrdinal}`
      || component?.bidirectional !== true
      || !componentNodeIds?.length
      || !componentSegmentIds?.length
      || !attachmentSocketIds?.length
      || String(component?.attachmentSocketId ?? '') !== attachmentSocketIds[0]
      || !sameStringSequence(
        componentNodeIds,
        nodeIds.filter((id) => componentNodeIds.includes(id)),
      )
      || !sameStringSequence(
        componentSegmentIds,
        segmentIds.filter((id) => componentSegmentIds.includes(id)),
      )
      || componentNodeIds.some((id) => !nodeSet.has(id))
      || componentSegmentIds.some((id) => !segmentSet.has(id))
      || attachmentSocketIds.some((id) => !endpointSocketIds.includes(id))) {
      return null;
    }

    const componentNodeSet = new Set(componentNodeIds);
    const externalKeys = attachmentSocketIds.map((id) => `external:${id}`);
    const allowedVertices = new Set([...componentNodeIds, ...externalKeys]);
    const adjacency = new Map([...allowedVertices].map((id) => [id, []]));
    const actualExternalSocketIds = [];
    const externalRoomIdBySocketId = new Map();
    for (const segmentId of componentSegmentIds) {
      const segment = segmentById.get(segmentId);
      if (!segment || segment?.bidirectional !== true) return null;
      const endpoints = [segment?.from, segment?.to];
      const graphVertices = [];
      for (const endpoint of endpoints) {
        const rawNodeId = String(endpointNodeId(endpoint) ?? '');
        if (componentNodeSet.has(rawNodeId)) {
          graphVertices.push(rawNodeId);
          continue;
        }
        if (!rawNodeId || nodeSet.has(rawNodeId) || nodeById.has(rawNodeId)) return null;
        const socketId = String(endpointSocketId(endpoint) ?? '');
        if (!socketId || !endpointHasPosition(endpoint)) return null;
        actualExternalSocketIds.push(socketId);
        externalRoomIdBySocketId.set(socketId, rawNodeId);
        graphVertices.push(`external:${socketId}`);
      }
      if (graphVertices.some((id) => !allowedVertices.has(id))) return null;
      adjacency.get(graphVertices[0]).push(graphVertices[1]);
      adjacency.get(graphVertices[1]).push(graphVertices[0]);
    }

    if (!sameStringSet(new Set(actualExternalSocketIds), new Set(attachmentSocketIds))
      || actualExternalSocketIds.length !== attachmentSocketIds.length
      || componentNodeIds.some((id) => (adjacency.get(id)?.length ?? 0) === 0)) {
      return null;
    }
    const reachable = new Set([externalKeys[0]]);
    const queue = [externalKeys[0]];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const next of adjacency.get(queue[cursor]) ?? []) {
        if (reachable.has(next)) continue;
        reachable.add(next);
        queue.push(next);
      }
    }
    if ([...allowedVertices].some((id) => !reachable.has(id))) return null;

    if (componentNodeIds.every((id) => isConnectorNode(nodeById.get(id)))) {
      const collapseRoomId = externalRoomIdBySocketId.get(attachmentSocketIds[0]);
      if (!collapseRoomId) return null;
      connectorOnlyProxyIds.push(...componentNodeIds);
      for (const segmentId of componentSegmentIds) {
        collapseRoomIdBySegmentId.set(segmentId, collapseRoomId);
      }
    }

    globallyAssignedNodeIds.push(...componentNodeIds);
    globallyAssignedSegmentIds.push(...componentSegmentIds);
    globallyAssignedAttachmentIds.push(...attachmentSocketIds);
  }

  if (!sameStringSequence(globallyAssignedAttachmentIds, endpointSocketIds)
    || globallyAssignedAttachmentIds.length !== new Set(globallyAssignedAttachmentIds).size
    || !sameStringSet(new Set(globallyAssignedNodeIds), nodeSet)
    || globallyAssignedNodeIds.length !== nodeIds.length
    || !sameStringSet(new Set(globallyAssignedSegmentIds), segmentSet)
    || globallyAssignedSegmentIds.length !== segmentIds.length) {
    return null;
  }
  return { connectorOnlyProxyIds, collapseRoomIdBySegmentId };
}

/**
 * A validated parent-anchored forest may intentionally retain only physical
 * connector infrastructure. Such a forest has no supplemental room to serve
 * as a progression facade, but every retained proxy must still belong to one
 * exact, bidirectional component rooted at its declared parent socket(s).
 */
export function inspectConnectorOnlyParentAnchoredProjection({
  overlayPlan,
  nodes = [],
  segments = [],
  isConnectorNode,
} = {}) {
  const result = {
    proxyIds: new Set(),
    collapseRoomIdBySegmentId: new Map(),
  };
  if (overlayPlan?.schema !== V4_OVERLAY_SCHEMA
    || Number(overlayPlan?.profileRevision) !== 5
    || typeof isConnectorNode !== 'function') {
    return result;
  }
  const nodeById = exactIdMap(nodes);
  const segmentById = exactIdMap(segments);
  if (!nodeById || !segmentById) return result;
  for (const operation of overlayPlan?.operations ?? []) {
    const inspection = validConnectorOnlyParentAnchoredOperation({
      operation,
      nodes,
      segments,
      nodeById,
      segmentById,
      isConnectorNode,
    });
    if (!inspection) continue;
    for (const nodeId of inspection.connectorOnlyProxyIds) result.proxyIds.add(nodeId);
    for (const [segmentId, roomId] of inspection.collapseRoomIdBySegmentId) {
      result.collapseRoomIdBySegmentId.set(segmentId, roomId);
    }
  }
  return result;
}
