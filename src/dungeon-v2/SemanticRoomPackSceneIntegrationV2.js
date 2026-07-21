import {
  getCachedSemanticRoomTemplateV1,
  instantiateCachedSemanticRoomPresentationV1,
} from './SemanticRoomPackPresentationV1.js';

const COLLECTION_SPECS = Object.freeze([
  {
    kind: 'boundary',
    planKey: 'structuralBoundaries',
    ownershipKey: 'structuralBoundaryIds',
    diagnosticsKey: 'boundaryCount',
  },
  {
    kind: 'surface',
    planKey: 'walkableSurfaces',
    ownershipKey: 'walkableSurfaceIds',
    diagnosticsKey: 'surfaceCount',
  },
  {
    kind: 'fixture',
    planKey: 'structuralFixtures',
    ownershipKey: 'structuralFixtureIds',
    diagnosticsKey: 'fixtureCount',
  },
]);

function clonePlain(value) {
  return value == null ? value : structuredClone(value);
}

function sorted(values) {
  return [...values].sort((left, right) => String(left).localeCompare(String(right)));
}

function fail(code, message, details = {}) {
  throw new SemanticRoomPackSceneIntegrationErrorV2(code, message, details);
}

function requireArray(value, code, message, details = {}) {
  if (!Array.isArray(value)) fail(code, message, details);
  return value;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return sorted(duplicates);
}

function equalIdSets(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

function transformMatches(instance, binding) {
  const expected = binding?.placementTransform;
  const actual = instance?.appliedPlacement;
  if (!expected || !actual) return false;
  const translation = expected.translation;
  const scale = expected.scale;
  return ['x', 'y', 'z'].every((axis) => (
    Number(actual.translation?.[axis]) === Number(translation?.[axis])
  ))
    && actual.yawQuarterTurns === ((expected.yawQuarterTurns % 4) + 4) % 4
    && ['x', 'y', 'z'].every((axis) => Number(scale?.[axis] ?? 1) === 1)
    && actual.authoredScale === 1;
}

function normalizeCompiledCollections(placement) {
  const compiled = placement.compiledPhysicalRecords;
  if (!compiled || typeof compiled !== 'object') {
    fail(
      'semantic-room-pack-compiled-physical-records-missing',
      `Semantic room placement ${placement.id} has no compiledPhysicalRecords contract.`,
      { placementId: placement.id },
    );
  }
  const collections = {};
  for (const spec of COLLECTION_SPECS) {
    const records = placement[spec.planKey];
    collections[spec.planKey] = requireArray(
      records,
      'semantic-room-pack-compiled-record-collection-missing',
      `${placement.id}.${spec.planKey} must be an array.`,
      { placementId: placement.id, collection: spec.planKey },
    );
  }
  collections.colliders = requireArray(
    compiled.colliders,
    'semantic-room-pack-compiled-colliders-missing',
    `${placement.id} compiledPhysicalRecords.colliders must be an array.`,
    { placementId: placement.id },
  );
  return collections;
}

function validateOwnershipIds(plan, placement, collections) {
  const ownership = placement.placedRecordIds;
  if (!ownership || typeof ownership !== 'object') {
    fail(
      'semantic-room-pack-placement-ownership-missing',
      `${placement.id} has no placedRecordIds ownership contract.`,
      { placementId: placement.id },
    );
  }
  const result = {};
  for (const spec of COLLECTION_SPECS) {
    const ids = requireArray(
      ownership[spec.ownershipKey],
      'semantic-room-pack-placement-ownership-collection-missing',
      `${placement.id} placedRecordIds.${spec.ownershipKey} must be an array.`,
      { placementId: placement.id, collection: spec.ownershipKey },
    );
    const duplicates = duplicateValues(ids);
    if (duplicates.length) {
      fail(
        'semantic-room-pack-placement-ownership-duplicated',
        `${placement.id} owns duplicate ${spec.kind} IDs.`,
        { placementId: placement.id, collection: spec.ownershipKey, duplicates },
      );
    }
    const planRecords = requireArray(
      plan[spec.planKey],
      'semantic-room-pack-plan-physical-collection-missing',
      `DungeonPlanV2.${spec.planKey} must be an array.`,
      { collection: spec.planKey },
    );
    const planIds = new Set(planRecords.map(({ id }) => id));
    const missingPlanIds = ids.filter((id) => !planIds.has(id));
    if (missingPlanIds.length) {
      fail(
        'semantic-room-pack-owned-plan-id-missing',
        `${placement.id} owns IDs absent from plan.${spec.planKey}.`,
        { placementId: placement.id, collection: spec.planKey, missingPlanIds: sorted(missingPlanIds) },
      );
    }
    const compiledIds = collections[spec.planKey].map(({ id }) => id);
    if (!equalIdSets(ids, compiledIds)) {
      fail(
        'semantic-room-pack-compiled-ownership-mismatch',
        `${placement.id} compiled ${spec.kind} records do not exactly match placedRecordIds.`,
        {
          placementId: placement.id,
          collection: spec.planKey,
          ownedIds: sorted(ids),
          compiledIds: sorted(compiledIds),
        },
      );
    }
    result[spec.planKey] = new Set(ids);
  }
  return result;
}

function pointsMatch(left, right, tolerance = 0.01) {
  return left && right && ['x', 'y', 'z'].every((axis) => (
    Math.abs(Number(left[axis]) - Number(right[axis])) <= tolerance
  ));
}

function endpointPosition(endpoint) {
  if (!endpoint?.center) return null;
  const y = Number.isFinite(endpoint.elevation) ? endpoint.elevation : endpoint.center.y;
  return { x: endpoint.center.x, y, z: endpoint.center.z };
}

/**
 * Authored `placement.portals` are socket descriptors, not DungeonPlanV2
 * connections. Only the explicit socket binding contract may suppress a real
 * plan portal endpoint.
 */
function validateBoundPortalOwnership(plan, placement) {
  const sockets = requireArray(
    placement.sockets,
    'semantic-room-pack-sockets-missing',
    `${placement.id}.sockets must be an array.`,
    { placementId: placement.id },
  );
  const bindings = requireArray(
    placement.socketBindings,
    'semantic-room-pack-socket-bindings-missing',
    `${placement.id}.socketBindings must explicitly bind or cap every authored socket.`,
    { placementId: placement.id },
  );
  const bindingIds = bindings.map(({ socketId }) => socketId);
  const duplicates = duplicateValues(bindingIds);
  const socketIds = sockets.map(({ id }) => id);
  if (duplicates.length || !equalIdSets(bindingIds, socketIds)) {
    fail(
      'semantic-room-pack-socket-binding-coverage-invalid',
      `${placement.id}.socketBindings must cover every authored socket exactly once.`,
      { placementId: placement.id, socketIds: sorted(socketIds), bindingIds: sorted(bindingIds), duplicates },
    );
  }

  const portalById = new Map(requireArray(
    plan.portals,
    'semantic-room-pack-plan-physical-collection-missing',
    'DungeonPlanV2.portals must be an array.',
  ).map((portal) => [portal.id, portal]));
  const socketById = new Map(sockets.map((socket) => [socket.id, socket]));
  const portalIds = new Set();
  const endpointKeys = new Set();
  const details = [];
  for (const binding of bindings) {
    const socket = socketById.get(binding.socketId);
    if (!socket || binding.sourceNodeName !== socket.sourceNodeName) {
      fail(
        'semantic-room-pack-socket-binding-source-mismatch',
        `${placement.id} socket binding ${binding.socketId} does not match its authored source node.`,
        { placementId: placement.id, binding: clonePlain(binding) },
      );
    }
    if (binding.status === 'capped') {
      if (binding.portalId != null || !binding.capId) {
        fail(
          'semantic-room-pack-socket-cap-invalid',
          `${placement.id} capped socket ${binding.socketId} requires a capId and no portalId.`,
          { placementId: placement.id, binding: clonePlain(binding) },
        );
      }
      continue;
    }
    if (binding.status !== 'bound' || !binding.portalId || binding.capId != null) {
      fail(
        'semantic-room-pack-bound-socket-invalid',
        `${placement.id} socket ${binding.socketId} must be explicitly bound or capped.`,
        { placementId: placement.id, binding: clonePlain(binding) },
      );
    }
    const portal = portalById.get(binding.portalId);
    if (!portal) {
      fail(
        'semantic-room-pack-owned-plan-id-missing',
        `${placement.id} binds missing plan portal ${binding.portalId}.`,
        { placementId: placement.id, collection: 'portals', missingPlanIds: [binding.portalId] },
      );
    }
    if (portalIds.has(portal.id)) {
      fail(
        'semantic-room-pack-placement-ownership-duplicated',
        `${placement.id} binds plan portal ${portal.id} more than once.`,
        { placementId: placement.id, collection: 'portals', duplicates: [portal.id] },
      );
    }
    const endpointMatches = ['from', 'to'].filter((endpointName) => (
      pointsMatch(socket.worldPosition, endpointPosition(portal[endpointName]))
    ));
    if (endpointMatches.length !== 1) {
      fail(
        'semantic-room-pack-socket-portal-endpoint-mismatch',
        `${placement.id} socket ${binding.socketId} must match exactly one endpoint of ${portal.id}.`,
        {
          placementId: placement.id,
          socketId: binding.socketId,
          portalId: portal.id,
          socketWorldPosition: clonePlain(socket.worldPosition),
          endpointMatches,
        },
      );
    }
    const endpointName = endpointMatches[0];
    portalIds.add(portal.id);
    endpointKeys.add(`${portal.id}:${endpointName}`);
    details.push({
      socketId: binding.socketId,
      sourceNodeName: binding.sourceNodeName,
      portalId: portal.id,
      endpoint: endpointName,
      regionId: portal[endpointName]?.regionId ?? null,
    });
  }
  const declaredBoundPortalIds = placement.boundPortalIds;
  if (declaredBoundPortalIds != null
    && (!Array.isArray(declaredBoundPortalIds)
      || !equalIdSets(declaredBoundPortalIds, [...portalIds]))) {
    fail(
      'semantic-room-pack-bound-portal-ledger-mismatch',
      `${placement.id}.boundPortalIds disagrees with its explicit socketBindings.`,
      {
        placementId: placement.id,
        declaredBoundPortalIds: clonePlain(declaredBoundPortalIds),
        derivedBoundPortalIds: sorted(portalIds),
      },
    );
  }
  return { portalIds, endpointKeys, details };
}

function globalWaterBasinMap(plan) {
  const water = (plan.environmentStates ?? []).find((entry) => (
    entry?.type === 'conserved-water-unit'
  ));
  return new Map((water?.basins ?? []).map((basin) => [basin.id, basin]));
}

function runtimeWaterBindingDescriptors(plan, placement) {
  const records = placement.runtimePresentationBindings?.waterBasins ?? [];
  if (!Array.isArray(records)) {
    fail(
      'semantic-room-pack-water-bindings-invalid',
      `${placement.id}.runtimePresentationBindings.waterBasins must be an array.`,
      { placementId: placement.id },
    );
  }
  const basinById = globalWaterBasinMap(plan);
  const fluidMarkerByName = new Map((placement.semanticMarkers ?? [])
    .filter(({ semantic }) => semantic === 'fluidSurface')
    .map((marker) => [marker.sourceNodeName, marker]));
  const seenBasinIds = new Set();
  const seenSourceNodeNames = new Set();
  return records.map((record) => {
    if (!record?.basinId || !record.sourceNodeName
      || record.presentationMode !== 'authored-fluid-volume') {
      fail(
        'semantic-room-pack-water-binding-invalid',
        `${placement.id} contains an incomplete authored water-basin presentation binding.`,
        { placementId: placement.id, binding: clonePlain(record) },
      );
    }
    if (seenBasinIds.has(record.basinId) || seenSourceNodeNames.has(record.sourceNodeName)) {
      fail(
        'semantic-room-pack-water-binding-duplicated',
        `${placement.id} repeats an authored water basin or FLUID source binding.`,
        { placementId: placement.id, binding: clonePlain(record) },
      );
    }
    if (!basinById.has(record.basinId)) {
      fail(
        'semantic-room-pack-global-water-basin-missing',
        `${placement.id} binds missing global water basin ${record.basinId}.`,
        { placementId: placement.id, basinId: record.basinId },
      );
    }
    if (!fluidMarkerByName.has(record.sourceNodeName)) {
      fail(
        'semantic-room-pack-fluid-source-missing',
        `${placement.id} water basin ${record.basinId} does not resolve an explicit FLUID semantic source.`,
        { placementId: placement.id, basinId: record.basinId, sourceNodeName: record.sourceNodeName },
      );
    }
    seenBasinIds.add(record.basinId);
    seenSourceNodeNames.add(record.sourceNodeName);
    return {
      placementId: placement.id,
      roomId: placement.roomId,
      basinId: record.basinId,
      sourceNodeName: record.sourceNodeName,
      presentationMode: record.presentationMode,
    };
  });
}

function resolveRuntimeWaterBindings(plan, placement, instance) {
  return runtimeWaterBindingDescriptors(plan, placement).map((descriptor) => {
    const node = instance.dynamicNodes.fluids.get(descriptor.sourceNodeName);
    if (!node) {
      fail(
        'semantic-room-pack-fluid-source-missing',
        `${placement.id} cannot resolve live FLUID source ${descriptor.sourceNodeName}.`,
        descriptor,
      );
    }
    return {
      ...descriptor,
      node,
      placementGroup: instance.group,
    };
  });
}

function validateColliderCollections(placement, collections) {
  const transformed = requireArray(
    placement.transformedCollisionVolumes,
    'semantic-room-pack-transformed-colliders-missing',
    `${placement.id} transformedCollisionVolumes must be an array.`,
    { placementId: placement.id },
  );
  const colliderIds = collections.colliders.map(({ id }) => id);
  const transformedIds = transformed.map(({ id }) => id);
  for (const [label, ids] of [['compiled', colliderIds], ['transformed', transformedIds]]) {
    const duplicates = duplicateValues(ids);
    if (duplicates.length) {
      fail(
        'semantic-room-pack-collider-id-duplicated',
        `${placement.id} has duplicate ${label} collider IDs.`,
        { placementId: placement.id, source: label, duplicates },
      );
    }
  }
  if (!equalIdSets(colliderIds, transformedIds)) {
    fail(
      'semantic-room-pack-collider-contract-mismatch',
      `${placement.id} compiled and transformed collider inventories differ.`,
      { placementId: placement.id, compiledIds: sorted(colliderIds), transformedIds: sorted(transformedIds) },
    );
  }
  const ownedColliderIds = requireArray(
    placement.placedRecordIds?.colliderIds,
    'semantic-room-pack-placement-ownership-collection-missing',
    `${placement.id} placedRecordIds.colliderIds must be an array.`,
    { placementId: placement.id },
  );
  if (!equalIdSets(colliderIds, ownedColliderIds)) {
    fail(
      'semantic-room-pack-collider-ownership-mismatch',
      `${placement.id} collider records do not exactly match placedRecordIds.colliderIds.`,
      { placementId: placement.id, colliderIds: sorted(colliderIds), ownedColliderIds: sorted(ownedColliderIds) },
    );
  }
  const transformedById = new Map(transformed.map((record) => [record.id, record]));
  for (const record of collections.colliders) {
    const transformedRecord = transformedById.get(record.id);
    for (const key of ['sourceNodeName', 'sourceManifestIndex', 'semantic', 'shape']) {
      if (record[key] !== transformedRecord[key]) {
        fail(
          'semantic-room-pack-collider-record-mismatch',
          `${placement.id} collider ${record.id} disagrees with its transformed collision volume.`,
          { placementId: placement.id, colliderId: record.id, field: key },
        );
      }
    }
  }
  return transformedById;
}

function manifestColliderFor(instance, collider, placementId) {
  const records = instance.manifestCollisionVolumes;
  const index = collider.sourceManifestIndex;
  if (!Number.isInteger(index) || index < 0 || index >= records.length) {
    fail(
      'semantic-room-pack-manifest-collider-index-invalid',
      `${placementId} collider ${collider.id} has an invalid sourceManifestIndex.`,
      { placementId, colliderId: collider.id, sourceManifestIndex: index },
    );
  }
  const manifestRecord = records[index];
  for (const [manifestKey, colliderKey] of [
    ['nodeName', 'sourceNodeName'],
    ['semantic', 'semantic'],
    ['shape', 'shape'],
  ]) {
    if (manifestRecord[manifestKey] !== collider[colliderKey]) {
      fail(
        'semantic-room-pack-manifest-collider-mismatch',
        `${placementId} collider ${collider.id} no longer matches its immutable manifest record.`,
        { placementId, colliderId: collider.id, field: manifestKey },
      );
    }
  }
  return manifestRecord;
}

function resolveVisualNode(instance, sourceNode, placementId, planId) {
  const mergedName = sourceNode.userData?.semanticVisualMergedInto;
  if (!mergedName) {
    if (!sourceNode.isMesh) {
      fail(
        'semantic-room-pack-record-node-not-renderable',
        `${placementId} physical record ${planId} resolves to non-renderable node ${sourceNode.name}.`,
        { placementId, planId, sourceNodeName: sourceNode.name },
      );
    }
    return { visualNode: sourceNode, merged: false, mergedVisualName: null };
  }
  const mergedVisual = instance.getNodeByName(mergedName);
  const sources = mergedVisual?.userData?.sourceNodeNames;
  if (!mergedVisual?.isMesh || !Array.isArray(sources) || !sources.includes(sourceNode.name)) {
    fail(
      'semantic-room-pack-merged-source-mapping-invalid',
      `${placementId} merged semantic visual does not own ${sourceNode.name}.`,
      { placementId, planId, sourceNodeName: sourceNode.name, mergedVisualName: mergedName },
    );
  }
  return { visualNode: mergedVisual, merged: true, mergedVisualName: mergedName };
}

function markSemanticBoundaryCameraOcclusionSurface(visual, acceptedRecord) {
  if (!visual?.isMesh || acceptedRecord?.side === 'floor') return false;
  const materials = (Array.isArray(visual.material) ? visual.material : [visual.material]).filter(Boolean);
  const opaque = materials.length > 0 && materials.every((material) => (
    material.transparent !== true
    && (Number.isFinite(material.opacity) ? material.opacity : 1) >= 0.999
    && material.depthWrite !== false
    && material.colorWrite !== false
  ));
  if (!opaque) return false;
  // Authored SHELL pieces stay separate specifically so the camera can hide
  // only the wall or ceiling between itself and the player. Never mark the
  // placement root, which would make an entire macro chamber disappear.
  visual.userData.cameraOcclusionSurface = true;
  visual.userData.cameraOcclusionOwner = true;
  visual.userData.v2CameraOcclusionClass = 'opaque-enclosure';
  visual.userData.v2CameraOcclusionInstanceMode = 'per-object';
  visual.userData.v2CameraOcclusionPlanId = acceptedRecord.id;
  return true;
}

function registerVisual(registry, registrations, planId, visual, {
  role,
  regionId = null,
  visualId,
}) {
  const record = registry.register(planId, { visual, role, regionId, visualId });
  registrations.push({ planId, visualId, role });
  return record;
}

function unregisterVisuals(registry, registrations) {
  for (const { planId, visualId } of [...registrations].reverse()) {
    if (typeof registry.unregisterVisual === 'function') {
      registry.unregisterVisual(planId, visualId);
      continue;
    }
    registry.visuals?.delete?.(visualId);
    registry.visualMetadata?.delete?.(visualId);
    const record = registry.byPlanId?.get?.(planId);
    if (!record) continue;
    record.visualIds = (record.visualIds ?? []).filter((id) => id !== visualId);
    if (!record.visualIds.length && !(record.colliderIds ?? []).length) registry.byPlanId.delete(planId);
  }
  registrations.length = 0;
}

function disposeInstanceMaterials(instance, disposedMaterials) {
  instance.group?.traverse?.((object) => {
    if (!object?.isMesh || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material || disposedMaterials.has(material)) continue;
      disposedMaterials.add(material);
      material.dispose?.();
    }
  });
}

function mapPhysicalRecords({
  plan,
  placement,
  collections,
  transformedById,
  instance,
  registry,
  registrations,
  physicalNodeBindings,
  visualMappings,
}) {
  const structuralRoleFor = (kind, acceptedRecord) => {
    if (kind === 'boundary') return `boundary:${acceptedRecord.side ?? 'authored-shell'}`;
    if (kind === 'fixture') return `structural-fixture:${acceptedRecord.type ?? acceptedRecord.semantic ?? 'authored'}`;
    const stairLike = Boolean(
      acceptedRecord.stairs
      || acceptedRecord.form === 'stairs'
      || ['stairs', 'walkable-stairs'].includes(acceptedRecord.geometry?.type)
      || acceptedRecord.shape === 'ramp-tile'
    );
    if (stairLike) return 'walkable-surface:stairs';
    if (acceptedRecord.geometry?.type === 'ladder') return 'walkable-surface:ladder';
    if (acceptedRecord.collision === 'dynamic') return 'walkable-surface:dynamic';
    return 'walkable-surface:static';
  };
  const planByCollection = Object.fromEntries(COLLECTION_SPECS.map((spec) => [
    spec.planKey,
    new Map(plan[spec.planKey].map((record) => [record.id, record])),
  ]));
  for (const spec of COLLECTION_SPECS.filter(({ kind }) => kind !== 'portal')) {
    for (const compiledRecord of collections[spec.planKey]) {
      if (!compiledRecord?.id || !compiledRecord.colliderId || !compiledRecord.sourceNodeName) {
        fail(
          'semantic-room-pack-compiled-record-invalid',
          `${placement.id} has an incomplete compiled ${spec.kind} record.`,
          { placementId: placement.id, collection: spec.planKey, record: clonePlain(compiledRecord) },
        );
      }
      if (physicalNodeBindings.has(compiledRecord.id)) {
        fail(
          'semantic-room-pack-physical-plan-id-duplicated',
          `Physical plan ID ${compiledRecord.id} is mapped by more than one semantic room record.`,
          { placementId: placement.id, planId: compiledRecord.id },
        );
      }
      const acceptedRecord = planByCollection[spec.planKey].get(compiledRecord.id);
      const collider = transformedById.get(compiledRecord.colliderId);
      if (!acceptedRecord || !collider) {
        fail(
          'semantic-room-pack-compiled-record-reference-missing',
          `${placement.id} ${compiledRecord.id} has no accepted plan record or collider.`,
          { placementId: placement.id, planId: compiledRecord.id, colliderId: compiledRecord.colliderId },
        );
      }
      if (collider.sourceNodeName !== compiledRecord.sourceNodeName
        || (acceptedRecord.colliderId && acceptedRecord.colliderId !== compiledRecord.colliderId)
        || (acceptedRecord.sourceNodeName && acceptedRecord.sourceNodeName !== compiledRecord.sourceNodeName)) {
        fail(
          'semantic-room-pack-plan-record-mismatch',
          `${placement.id} ${compiledRecord.id} does not match its accepted plan/collider contract.`,
          { placementId: placement.id, planId: compiledRecord.id, colliderId: compiledRecord.colliderId },
        );
      }
      manifestColliderFor(instance, collider, placement.id);
      const semanticNode = instance.getNodeByName(compiledRecord.sourceNodeName);
      if (!semanticNode) {
        fail(
          'semantic-room-pack-source-node-missing',
          `${placement.id} cannot resolve ${compiledRecord.sourceNodeName} exactly once.`,
          { placementId: placement.id, planId: compiledRecord.id, sourceNodeName: compiledRecord.sourceNodeName },
        );
      }
      const resolved = resolveVisualNode(instance, semanticNode, placement.id, compiledRecord.id);
      const visualId = `${placement.id}:semantic-record:${compiledRecord.id}`;
      const role = structuralRoleFor(spec.kind, acceptedRecord);
      if (spec.kind === 'boundary') {
        markSemanticBoundaryCameraOcclusionSurface(resolved.visualNode, acceptedRecord);
      }
      registerVisual(registry, registrations, compiledRecord.id, resolved.visualNode, {
        role,
        regionId: acceptedRecord.regionId ?? placement.regionIds?.[0] ?? null,
        visualId,
      });
      const runtimeBinding = {
        placementId: placement.id,
        roomId: placement.roomId,
        kind: spec.kind,
        planId: compiledRecord.id,
        colliderId: compiledRecord.colliderId,
        sourceNodeName: compiledRecord.sourceNodeName,
        sourceManifestIndex: collider.sourceManifestIndex,
        semanticNode,
        visualNode: resolved.visualNode,
        role,
        merged: resolved.merged,
        mergedVisualName: resolved.mergedVisualName,
        visualId,
      };
      physicalNodeBindings.set(compiledRecord.id, runtimeBinding);
      visualMappings.push({
        placementId: placement.id,
        roomId: placement.roomId,
        kind: spec.kind,
        planId: compiledRecord.id,
        colliderId: compiledRecord.colliderId,
        sourceNodeName: compiledRecord.sourceNodeName,
        mergedVisualName: resolved.mergedVisualName,
        role,
        visualId,
      });
    }
  }
}

function buildPlanSemanticNodeBindings(placement, instance) {
  const result = new Map();
  const bind = (stableId, sourceNodeName, kind) => {
    if (!stableId || !sourceNodeName) return;
    if (result.has(stableId)) {
      const existing = result.get(stableId);
      if (existing.sourceNodeNames.includes(sourceNodeName)) return;
      // A mechanism's semantic stable ID intentionally owns its platform,
      // bridges, indicators, and controls as one runtime aggregate. Preserve
      // all exact authored nodes instead of pretending that aggregate is a
      // singleton.
      if (existing.kind === 'mechanism-node' && kind === 'mechanism-node') {
        const node = instance.getNodeByName(sourceNodeName);
        if (!node) {
          fail(
            'semantic-room-pack-stable-semantic-node-missing',
            `${placement.id} semantic ID ${stableId} cannot resolve ${sourceNodeName} exactly once.`,
            { placementId: placement.id, stableId, sourceNodeName, kind },
          );
        }
        existing.sourceNodeNames.push(sourceNodeName);
        existing.nodes.push(node);
        return;
      }
      fail(
        'semantic-room-pack-stable-semantic-id-duplicated',
        `${placement.id} semantic ID ${stableId} is declared more than once.`,
        { placementId: placement.id, stableId },
      );
    }
    const node = instance.getNodeByName(sourceNodeName);
    if (!node) {
      fail(
        'semantic-room-pack-stable-semantic-node-missing',
        `${placement.id} semantic ID ${stableId} cannot resolve ${sourceNodeName} exactly once.`,
        { placementId: placement.id, stableId, sourceNodeName, kind },
      );
    }
    result.set(stableId, {
      stableId,
      sourceNodeName,
      sourceNodeNames: [sourceNodeName],
      kind,
      node,
      nodes: [node],
    });
  };
  for (const socket of placement.sockets ?? []) bind(socket.worldId ?? socket.id, socket.sourceNodeName, 'socket');
  for (const region of placement.regions ?? []) bind(region.id, region.sourceNodeName, 'region');
  for (const marker of placement.semanticMarkers ?? []) bind(
    marker.id,
    marker.sourceNodeName,
    String(marker.id).includes(':mechanism-node:') ? 'mechanism-node' : marker.semantic,
  );
  for (const collider of placement.transformedCollisionVolumes ?? []) bind(collider.id, collider.sourceNodeName, 'collision-volume');
  return result;
}

export function integrateSemanticRoomPackSceneV2({
  plan,
  parent,
  structuralRegistry,
  presentationRuntime = null,
  instantiateCached = null,
} = {}) {
  if (!plan || typeof plan !== 'object') {
    fail('semantic-room-pack-plan-missing', 'Semantic room scene integration requires DungeonPlanV2.');
  }
  const placements = requireArray(
    plan.semanticRoomPackPlacements,
    'semantic-room-pack-placement-collection-missing',
    'DungeonPlanV2.semanticRoomPackPlacements must be an array.',
  );
  if (!parent?.add) fail('semantic-room-pack-parent-missing', 'Semantic room scene integration requires a THREE.Object3D parent.');
  if (!structuralRegistry?.register) {
    fail('semantic-room-pack-structural-registry-missing', 'Semantic room scene integration requires a structural registry.');
  }
  const instantiate = instantiateCached
    ?? (presentationRuntime?.instantiateSync
      ? presentationRuntime.instantiateSync.bind(presentationRuntime)
      : instantiateCachedSemanticRoomPresentationV1);
  const placementIds = placements.map(({ id }) => id);
  const duplicatePlacementIds = duplicateValues(placementIds);
  if (placementIds.some((id) => !id) || duplicatePlacementIds.length) {
    fail(
      'semantic-room-pack-placement-id-invalid',
      'Semantic room placement IDs must be present and unique.',
      { duplicatePlacementIds },
    );
  }

  const groups = [];
  const instances = [];
  const registrations = [];
  const disposedMaterials = new Set();
  const physicalNodeBindings = new Map();
  const dynamicBindingsByPlacementId = new Map();
  const waterBasinBindings = new Map();
  const visualMappings = [];
  const ownership = {
    structuralBoundaries: new Set(),
    walkableSurfaces: new Set(),
    structuralFixtures: new Set(),
    portals: new Set(),
    portalEndpoints: new Set(),
  };
  const placementDiagnostics = [];
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unregisterVisuals(structuralRegistry, registrations);
    for (const instance of instances) {
      instance.group?.removeFromParent?.();
      disposeInstanceMaterials(instance, disposedMaterials);
    }
    groups.length = 0;
    instances.length = 0;
    physicalNodeBindings.clear();
    dynamicBindingsByPlacementId.clear();
    waterBasinBindings.clear();
  };

  try {
    for (const placement of placements) {
      const binding = placement.presentationBinding;
      if (!binding || binding.placementId !== placement.id || binding.roomId !== placement.roomId) {
        fail(
          'semantic-room-pack-presentation-binding-mismatch',
          `${placement.id} presentationBinding identity does not match its placement.`,
          { placementId: placement.id, roomId: placement.roomId ?? null },
        );
      }
      const collections = normalizeCompiledCollections(placement);
      const placementOwnership = validateOwnershipIds(plan, placement, collections);
      const boundPortalOwnership = validateBoundPortalOwnership(plan, placement);
      for (const spec of COLLECTION_SPECS) {
        for (const id of placementOwnership[spec.planKey]) {
          if (ownership[spec.planKey].has(id)) {
            fail(
              'semantic-room-pack-plan-id-owned-twice',
              `${id} is owned by more than one semantic room placement.`,
              { placementId: placement.id, planId: id, collection: spec.planKey },
            );
          }
          ownership[spec.planKey].add(id);
        }
      }
      for (const portalId of boundPortalOwnership.portalIds) {
        ownership.portals.add(portalId);
      }
      for (const endpointKey of boundPortalOwnership.endpointKeys) {
        if (ownership.portalEndpoints.has(endpointKey)) {
          fail(
            'semantic-room-pack-plan-id-owned-twice',
            `${endpointKey} is owned by more than one semantic room placement.`,
            { placementId: placement.id, planId: endpointKey, collection: 'portalEndpoints' },
          );
        }
        ownership.portalEndpoints.add(endpointKey);
      }
      const transformedById = validateColliderCollections(placement, collections);
      const instance = instantiate(binding);
      if (!instance?.group || instance.roomId !== placement.roomId || !transformMatches(instance, binding)) {
        fail(
          'semantic-room-pack-runtime-instance-mismatch',
          `${placement.id} cached authored instance does not match the accepted plan transform.`,
          { placementId: placement.id, roomId: placement.roomId },
        );
      }
      instance.group.userData.v2SemanticRoomPackPresentation = true;
      instance.group.userData.v2PlacementId = placement.id;
      instance.group.userData.v2RoomId = placement.roomId;
      instance.group.userData.v2GenericVisualReplacement = true;
      instance.group.userData.v2CollisionAuthority = 'accepted-plan-semantic-room-pack-records';
      instance.group.userData.v2CollisionDerivedFromMeshBounds = false;
      const placementWaterBindings = resolveRuntimeWaterBindings(plan, placement, instance);
      for (const bindingRecord of placementWaterBindings) {
        if (waterBasinBindings.has(bindingRecord.basinId)) {
          fail(
            'semantic-room-pack-global-water-basin-owned-twice',
            `Global water basin ${bindingRecord.basinId} has more than one authored presentation owner.`,
            { placementId: placement.id, basinId: bindingRecord.basinId },
          );
        }
        waterBasinBindings.set(bindingRecord.basinId, bindingRecord);
      }
      parent.add(instance.group);
      groups.push(instance.group);
      instances.push(instance);
      const placementVisualId = `${placement.id}:semantic-room-pack-placement`;
      registerVisual(structuralRegistry, registrations, placement.id, instance.group, {
        role: 'semantic-room-pack:placement',
        regionId: placement.regionIds?.[0] ?? null,
        visualId: placementVisualId,
      });
      mapPhysicalRecords({
        plan,
        placement,
        collections,
        transformedById,
        instance,
        registry: structuralRegistry,
        registrations,
        physicalNodeBindings,
        visualMappings,
      });
      const planSemanticNodes = buildPlanSemanticNodeBindings(placement, instance);
      dynamicBindingsByPlacementId.set(placement.id, {
        mechanisms: instance.dynamicNodes.mechanisms,
        fluids: instance.dynamicNodes.fluids,
        hazards: instance.dynamicNodes.hazards,
        consoles: instance.dynamicNodes.consoles,
        stableSemanticIds: planSemanticNodes,
        loaderStableSemanticIds: instance.stableSemanticIds,
      });
      placementDiagnostics.push({
        placementId: placement.id,
        roomId: placement.roomId,
        placementVisualId,
        mappedPhysicalRecordCount: COLLECTION_SPECS
          .filter(({ kind }) => kind !== 'portal')
          .reduce((sum, spec) => sum + collections[spec.planKey].length, 0),
        boundaryCount: placementOwnership.structuralBoundaries.size,
        surfaceCount: placementOwnership.walkableSurfaces.size,
        fixtureCount: placementOwnership.structuralFixtures.size,
        portalCount: boundPortalOwnership.portalIds.size,
        boundPortalEndpoints: clonePlain(boundPortalOwnership.details),
        mechanismNodeCount: instance.dynamicNodes.mechanisms.size,
        fluidNodeCount: instance.dynamicNodes.fluids.size,
        hazardNodeCount: instance.dynamicNodes.hazards.size,
        consoleNodeCount: instance.dynamicNodes.consoles.size,
        waterBasinPresentationCount: placementWaterBindings.length,
      });
    }
  } catch (error) {
    dispose();
    if (error instanceof SemanticRoomPackSceneIntegrationErrorV2) throw error;
    throw new SemanticRoomPackSceneIntegrationErrorV2(
      'semantic-room-pack-live-integration-failed',
      `Semantic room pack live integration failed: ${error.message}`,
      { causeName: error.name ?? 'Error', causeCode: error.code ?? null },
      { cause: error },
    );
  }

  const diagnostics = Object.freeze({
    schemaVersion: 'semantic-room-pack-scene-integration/2',
    accepted: true,
    active: placements.length > 0,
    placementCount: placements.length,
    mappedPhysicalRecordCount: physicalNodeBindings.size,
    boundaryCount: ownership.structuralBoundaries.size,
    surfaceCount: ownership.walkableSurfaces.size,
    fixtureCount: ownership.structuralFixtures.size,
    portalCount: ownership.portals.size,
    waterBasinPresentationCount: waterBasinBindings.size,
    collisionAuthority: 'accepted-plan-semantic-room-pack-records',
    collisionDerivedFromMeshBounds: false,
    cachedAuthoredTemplatesRequired: true,
    genericFallbackGeometry: false,
    placements: clonePlain(placementDiagnostics),
  });
  return {
    groups,
    instances,
    physicalNodeBindings,
    dynamicBindingsByPlacementId,
    waterBasinBindings,
    visualMappings: clonePlain(visualMappings),
    ownedBoundaryIds: ownership.structuralBoundaries,
    ownedSurfaceIds: ownership.walkableSurfaces,
    ownedFixtureIds: ownership.structuralFixtures,
    ownedPortalIds: ownership.portals,
    ownedPortalEndpointKeys: ownership.portalEndpoints,
    genericVisualSuppression: {
      structuralBoundaries: ownership.structuralBoundaries,
      walkableSurfaces: ownership.walkableSurfaces,
      structuralFixtures: ownership.structuralFixtures,
      portals: ownership.portals,
      portalEndpoints: ownership.portalEndpoints,
    },
    diagnostics,
    dispose,
  };
}

export function prepareSemanticRoomPackSceneIntegrationV2({
  plan,
  presentationRuntime = null,
} = {}) {
  if (!plan || typeof plan !== 'object') {
    fail('semantic-room-pack-plan-missing', 'Semantic room scene preparation requires DungeonPlanV2.');
  }
  const placements = requireArray(
    plan.semanticRoomPackPlacements,
    'semantic-room-pack-placement-collection-missing',
    'DungeonPlanV2.semanticRoomPackPlacements must be an array.',
  );
  const getTemplate = presentationRuntime?.getTemplateSync
    ? presentationRuntime.getTemplateSync.bind(presentationRuntime)
    : getCachedSemanticRoomTemplateV1;
  const ownership = {
    structuralBoundaries: new Set(),
    walkableSurfaces: new Set(),
    structuralFixtures: new Set(),
    portals: new Set(),
    portalEndpoints: new Set(),
  };
  const waterBasinBindingDescriptors = new Map();
  const placementIds = new Set();
  for (const placement of placements) {
    if (!placement?.id || placementIds.has(placement.id)) {
      fail(
        'semantic-room-pack-placement-id-invalid',
        'Semantic room placement IDs must be present and unique.',
        { placementId: placement?.id ?? null },
      );
    }
    placementIds.add(placement.id);
    if (!placement.presentationBinding
      || placement.presentationBinding.placementId !== placement.id
      || placement.presentationBinding.roomId !== placement.roomId) {
      fail(
        'semantic-room-pack-presentation-binding-mismatch',
        `${placement.id} presentationBinding identity does not match its placement.`,
        { placementId: placement.id, roomId: placement.roomId ?? null },
      );
    }
    const template = getTemplate(placement.presentationBinding);
    if (!template || template.roomId !== placement.roomId) {
      fail(
        'semantic-room-pack-cached-template-mismatch',
        `${placement.id} does not have its exact cached authored GLB template.`,
        { placementId: placement.id, roomId: placement.roomId },
      );
    }
    for (const descriptor of runtimeWaterBindingDescriptors(plan, placement)) {
      if (waterBasinBindingDescriptors.has(descriptor.basinId)) {
        fail(
          'semantic-room-pack-global-water-basin-owned-twice',
          `Global water basin ${descriptor.basinId} has more than one authored presentation owner.`,
          { placementId: placement.id, basinId: descriptor.basinId },
        );
      }
      if (!template.templateRoot?.getObjectByName?.(descriptor.sourceNodeName)) {
        fail(
          'semantic-room-pack-fluid-source-missing',
          `${placement.id} cached template lacks FLUID source ${descriptor.sourceNodeName}.`,
          descriptor,
        );
      }
      waterBasinBindingDescriptors.set(descriptor.basinId, descriptor);
    }
    const collections = normalizeCompiledCollections(placement);
    const owned = validateOwnershipIds(plan, placement, collections);
    const boundPortalOwnership = validateBoundPortalOwnership(plan, placement);
    validateColliderCollections(placement, collections);
    for (const spec of COLLECTION_SPECS) {
      for (const id of owned[spec.planKey]) {
        if (ownership[spec.planKey].has(id)) {
          fail(
            'semantic-room-pack-plan-id-owned-twice',
            `${id} is owned by more than one semantic room placement.`,
            { placementId: placement.id, planId: id, collection: spec.planKey },
          );
        }
        ownership[spec.planKey].add(id);
      }
    }
    for (const portalId of boundPortalOwnership.portalIds) {
      ownership.portals.add(portalId);
    }
    for (const endpointKey of boundPortalOwnership.endpointKeys) {
      if (ownership.portalEndpoints.has(endpointKey)) {
        fail(
          'semantic-room-pack-plan-id-owned-twice',
          `${endpointKey} is owned by more than one semantic room placement.`,
          { placementId: placement.id, planId: endpointKey, collection: 'portalEndpoints' },
        );
      }
      ownership.portalEndpoints.add(endpointKey);
    }
  }
  return {
    schemaVersion: 'semantic-room-pack-scene-preparation/2',
    plan,
    placements,
    presentationRuntime,
    ownedBoundaryIds: ownership.structuralBoundaries,
    ownedSurfaceIds: ownership.walkableSurfaces,
    ownedFixtureIds: ownership.structuralFixtures,
    ownedPortalIds: ownership.portals,
    ownedPortalEndpointKeys: ownership.portalEndpoints,
    waterBasinBindingDescriptors,
    genericVisualSuppression: {
      structuralBoundaries: ownership.structuralBoundaries,
      walkableSurfaces: ownership.walkableSurfaces,
      structuralFixtures: ownership.structuralFixtures,
      portals: ownership.portals,
      portalEndpoints: ownership.portalEndpoints,
    },
    diagnostics: Object.freeze({
      accepted: true,
      cachedAuthoredTemplatesReady: true,
      placementCount: placements.length,
      boundaryCount: ownership.structuralBoundaries.size,
      surfaceCount: ownership.walkableSurfaces.size,
      fixtureCount: ownership.structuralFixtures.size,
      portalCount: ownership.portals.size,
      waterBasinPresentationCount: waterBasinBindingDescriptors.size,
    }),
  };
}

export function renderSemanticRoomPackSceneIntegrationV2({
  prepared,
  parent,
  structuralRegistry,
} = {}) {
  if (!prepared || prepared.schemaVersion !== 'semantic-room-pack-scene-preparation/2') {
    fail(
      'semantic-room-pack-scene-preparation-missing',
      'Rendering semantic room presentation requires accepted scene preparation.',
    );
  }
  return integrateSemanticRoomPackSceneV2({
    plan: prepared.plan,
    parent,
    structuralRegistry,
    presentationRuntime: prepared.presentationRuntime,
  });
}

export function disposeSemanticRoomPackSceneIntegrationV2(integration) {
  integration?.dispose?.();
}

export class SemanticRoomPackSceneIntegrationErrorV2 extends Error {
  constructor(code, message, details = {}, options = undefined) {
    super(message, options);
    this.name = 'SemanticRoomPackSceneIntegrationErrorV2';
    this.code = code;
    this.details = Object.freeze(clonePlain(details));
  }
}

export default integrateSemanticRoomPackSceneV2;
