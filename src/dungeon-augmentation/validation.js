import {
  DUNGEON_AUGMENTATION_OPERATION_SCHEMA,
  DUNGEON_AUGMENTATION_OVERLAY_SCHEMA,
  DUNGEON_AUGMENTATION_SCHEMA_REVISION,
  DUNGEON_REGION_THEME_SCHEMA,
  DUNGEON_TRANSITION_BAY_SCHEMA,
  validateDungeonRegionThemeBinding,
} from './contracts.js';
import {
  canonicalStringify,
  deepFreezeDungeonAugmentationValue,
  hashCanonicalValue,
} from './canonical.js';
import {
  collectBaseDraftVolumes,
  dungeonVolumesOverlap,
} from './geometry.js';
import { isDungeonSupplementIdForRegion } from './ids.js';

function diagnostic(code, message, context = {}) {
  return { code, message, context };
}

function finitePoint(point) {
  return point && ['x', 'y', 'z'].every((axis) => Number.isFinite(Number(point[axis])));
}

function positiveSize(size) {
  return size && ['x', 'y', 'z'].every((axis) => Number(size[axis]) > 0 && Number.isFinite(Number(size[axis])));
}

function asSet(value) {
  return new Set((Array.isArray(value) ? value : []).map((entry) => (
    String(entry).trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
  )).filter(Boolean));
}

function capabilitySourceForRegion(region, themeCapabilitiesByRegionId) {
  return themeCapabilitiesByRegionId?.[region?.id]
    ?? themeCapabilitiesByRegionId?.[region?.themeBinding?.parentRegionId]
    ?? region?.themeCapabilities
    ?? null;
}

function capabilitySourceForBinding(binding, regions, themeCapabilitiesByRegionId) {
  const matchingRegion = regions.find((region) => (
    region?.id === binding?.parentRegionId
      || region?.themeBinding?.parentRegionId === binding?.parentRegionId
  ));
  return capabilitySourceForRegion(matchingRegion, themeCapabilitiesByRegionId)
    ?? themeCapabilitiesByRegionId?.[binding?.parentRegionId]
    ?? null;
}

export function getMissingDungeonThemeCapabilities(required = {}, available = {}) {
  const missing = [];
  for (const kind of ['materials', 'assets', 'connectors', 'transitions']) {
    const provided = asSet(available?.[kind]);
    for (const id of (required?.[kind] ?? [])) {
      const normalized = String(id).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (!provided.has(normalized)) missing.push(`${kind}:${id}`);
    }
  }
  return missing.sort();
}

export function computeDungeonAugmentationPlanHash(plan) {
  return hashCanonicalValue(plan, {
    namespace: 'ruindivex-dungeon-augmentation-overlay-hash/v1',
    omitKeys: ['augmentationPlanHash', 'effectivePlanHash'],
  });
}

export function computeEffectiveDungeonPlanHash(basePlanHash, augmentationPlanHash) {
  if (!augmentationPlanHash) return String(basePlanHash ?? '');
  return hashCanonicalValue({
    schema: 'ruindivex-effective-dungeon-plan-hash/v1',
    basePlanHash: String(basePlanHash ?? ''),
    augmentationPlanHash: String(augmentationPlanHash),
  }, { namespace: 'ruindivex-effective-dungeon-plan-hash/v1' });
}

function validateThemeBinding(binding, errors, ownerId) {
  const result = validateDungeonRegionThemeBinding(binding);
  for (const code of result.errors) {
    errors.push(diagnostic(code, `Invalid theme binding on ${ownerId}.`, { ownerId }));
  }
}

function validateNode({
  node,
  operationById,
  segmentById,
  grammarById,
  regionById,
  regions,
  themeCapabilitiesByRegionId,
  errors,
  warnings,
}) {
  const operation = operationById.get(node?.operationId);
  const regionId = node?.parentRegionId ?? operation?.parentRegionId;
  if (!operation) errors.push(diagnostic('node-operation-missing', `Node ${node?.id} has no operation.`, { nodeId: node?.id }));
  if (!isDungeonSupplementIdForRegion(node?.id, regionId)) {
    errors.push(diagnostic('node-id-not-namespaced', `Node ${node?.id} is outside its parent region namespace.`, { nodeId: node?.id, regionId }));
  }
  if (!grammarById[node?.grammarId]) {
    errors.push(diagnostic('node-grammar-missing', `Node ${node?.id} uses unknown grammar ${node?.grammarId}.`, { nodeId: node?.id }));
  } else if (Number(grammarById[node.grammarId].revision) !== Number(node.grammarRevision)) {
    errors.push(diagnostic('node-grammar-revision-mismatch', `Node ${node?.id} grammar revision does not match.`, { nodeId: node?.id }));
  }
  if (!finitePoint(node?.placement?.center)) {
    errors.push(diagnostic('node-placement-invalid', `Node ${node?.id} has an invalid placement.`, { nodeId: node?.id }));
  }
  if (!positiveSize(node?.size)) {
    errors.push(diagnostic('node-size-invalid', `Node ${node?.id} has an invalid size.`, { nodeId: node?.id }));
  }
  validateThemeBinding(node?.themeBinding, errors, node?.id);
  if (operation?.type === 'optionalBranch'
    && canonicalStringify(node?.themeBinding) !== canonicalStringify(operation?.themeBinding)) {
    errors.push(diagnostic('branch-theme-binding-not-propagated', `Branch node ${node?.id} did not inherit its attachment theme.`, { nodeId: node?.id }));
  }

  const region = regionById.get(regionId);
  const available = capabilitySourceForBinding(node?.themeBinding, regions, themeCapabilitiesByRegionId)
    ?? capabilitySourceForRegion(region, themeCapabilitiesByRegionId);
  const missing = getMissingDungeonThemeCapabilities(node?.requiredThemeCapabilities, available);
  if (missing.length > 0) {
    errors.push(diagnostic('theme-capabilities-missing', `Node ${node?.id} cannot be rendered by its parent theme.`, { nodeId: node?.id, missing }));
  }

  const socketIds = new Set();
  for (const socket of node?.sockets ?? []) {
    if (socketIds.has(socket?.id)) {
      errors.push(diagnostic('duplicate-node-socket-id', `Node ${node?.id} repeats socket ${socket?.id}.`, { nodeId: node?.id, socketId: socket?.id }));
    }
    socketIds.add(socket?.id);
    if (!finitePoint(socket?.position) || !finitePoint(socket?.facing)) {
      errors.push(diagnostic('node-socket-transform-invalid', `Node ${node?.id} socket ${socket?.id} has invalid coordinates.`, { nodeId: node?.id, socketId: socket?.id }));
    }
    if (socket?.state === 'connected') {
      const segment = segmentById.get(socket?.segmentId);
      if (!segment) {
        errors.push(diagnostic('connected-socket-segment-missing', `Connected socket ${socket?.id} has no segment.`, { nodeId: node?.id, socketId: socket?.id }));
      } else if (![segment.from, segment.to].some((endpoint) => endpoint?.socketId === socket.id)) {
        errors.push(diagnostic('connected-socket-segment-mismatch', `Socket ${socket?.id} is not an endpoint of ${segment.id}.`, { nodeId: node?.id, socketId: socket?.id, segmentId: segment.id }));
      }
    } else if (socket?.state !== 'capped') {
      errors.push(diagnostic('socket-not-paired-or-capped', `Socket ${socket?.id} is neither paired nor capped.`, { nodeId: node?.id, socketId: socket?.id }));
    }
  }
  if ((node?.anchors ?? []).length === 0) {
    warnings.push(diagnostic('node-has-no-gameplay-anchors', `Node ${node?.id} has no gameplay anchors.`, { nodeId: node?.id }));
  }
}

function validateTransition(transition, context) {
  const { operationById, regions, themeCapabilitiesByRegionId, errors } = context;
  const operation = operationById.get(transition?.operationId);
  if (transition?.schema !== DUNGEON_TRANSITION_BAY_SCHEMA) {
    errors.push(diagnostic('invalid-transition-schema', `Transition ${transition?.id} has an invalid schema.`, { transitionId: transition?.id }));
  }
  if (!operation || operation.type !== 'edgePadding') {
    errors.push(diagnostic('transition-edge-operation-missing', `Transition ${transition?.id} is not owned by edge padding.`, { transitionId: transition?.id }));
  }
  if (Number(transition?.splitRatio) !== 0.5) {
    errors.push(diagnostic('transition-midpoint-required', `Transition ${transition?.id} must split the edge at its midpoint.`, { transitionId: transition?.id }));
  }
  if (transition?.gatesAllowed !== false || transition?.hazardsAllowed !== false
    || transition?.encountersAllowed !== false || transition?.elevationTransfersAllowed !== false) {
    errors.push(diagnostic('transition-must-remain-flat-and-unobstructed', `Transition ${transition?.id} permits forbidden content.`, { transitionId: transition?.id }));
  }
  if (!transition?.flatThresholds?.source || !transition?.flatThresholds?.destination) {
    errors.push(diagnostic('transition-flat-thresholds-required', `Transition ${transition?.id} lacks both flat thresholds.`, { transitionId: transition?.id }));
  }
  for (const [side, binding] of [
    ['source', transition?.sourceThemeBinding],
    ['destination', transition?.destinationThemeBinding],
  ]) {
    validateThemeBinding(binding, errors, `${transition?.id}:${side}`);
    const available = capabilitySourceForBinding(binding, regions, themeCapabilitiesByRegionId);
    // Match the exact runtime contract. Accepting descriptive seam labels
    // here would let planning succeed even though assembly unconditionally
    // asks both parents for these three concrete presentation products.
    const missing = getMissingDungeonThemeCapabilities({
      materials: ['corridor-floor', 'wall', 'ceiling'],
      assets: ['transition-frame'],
      connectors: ['transition-bay'],
      transitions: ['level-transition-bay'],
    }, available);
    if (missing.length > 0) {
      errors.push(diagnostic('transition-theme-capabilities-missing', `Transition ${transition?.id} ${side} theme cannot create a seam.`, { transitionId: transition?.id, side, missing }));
    }
  }
}

function delegatedBeatRecords(regions) {
  const records = new Map();
  for (const region of regions) {
    for (const rawBeat of region?.delegatedProgressionBeats ?? []) {
      const beat = typeof rawBeat === 'string' ? { id: rawBeat, required: true } : rawBeat;
      const requiresBeatIds = [
        ...(beat?.requiresBeatIds ?? []),
        ...(beat?.requiredBeatIds ?? []),
        ...(beat?.prerequisiteBeatIds ?? []),
        ...(beat?.credentialBeatId ? [beat.credentialBeatId] : []),
        ...(beat?.keyBeatId ? [beat.keyBeatId] : []),
      ].map(String);
      if (beat?.id) records.set(String(beat.id), {
        ...beat,
        parentRegionId: region.id,
        requiresBeatIds: [...new Set(requiresBeatIds)],
      });
    }
  }
  for (const beat of records.values()) {
    const unlocked = records.get(String(beat.unlocksBeatId ?? ''));
    if (unlocked && !unlocked.requiresBeatIds.includes(String(beat.id))) {
      unlocked.requiresBeatIds.push(String(beat.id));
      unlocked.requiresBeatIds.sort();
    }
  }
  return records;
}

function validateProgression(
  plan,
  profile,
  regions,
  nodeById,
  segmentById,
  operationById,
  errors,
) {
  const delegated = delegatedBeatRecords(regions);
  const assignments = new Map();
  const gateAssignmentBySegmentId = new Map();
  for (const assignment of plan?.progressionAssignments ?? []) {
    if (!profile?.allowDelegatedProgression) {
      errors.push(diagnostic('delegated-progression-disabled', `Profile ${profile?.id} does not permit ${assignment?.beatId}.`, { beatId: assignment?.beatId }));
    }
    const beat = delegated.get(String(assignment?.beatId));
    if (!beat) {
      errors.push(diagnostic('progression-beat-not-delegated', `Beat ${assignment?.beatId} was not delegated by its parent.`, { beatId: assignment?.beatId }));
    }
    const node = nodeById.get(assignment?.nodeId);
    if (!node) {
      errors.push(diagnostic('progression-assignment-node-missing', `Beat ${assignment?.beatId} targets an unknown node.`, { beatId: assignment?.beatId, nodeId: assignment?.nodeId }));
    } else if (!(node.anchors ?? []).some((anchor) => anchor.id === assignment?.anchorId && anchor.kind === 'progression')) {
      errors.push(diagnostic('progression-assignment-anchor-invalid', `Beat ${assignment?.beatId} targets an invalid progression anchor.`, { beatId: assignment?.beatId, nodeId: assignment?.nodeId }));
    }
    if (assignments.has(String(assignment?.beatId))) {
      errors.push(diagnostic('progression-beat-assigned-more-than-once', `Beat ${assignment?.beatId} has multiple assignments.`, { beatId: assignment?.beatId }));
    }
    assignments.set(String(assignment?.beatId), assignment);
    if (/gate|door/i.test(String(assignment?.beatKind ?? beat?.kind ?? ''))) {
      const segment = segmentById.get(assignment?.gatedSegmentId);
      const structuralOperation = operationById.get(segment?.operationId);
      if (!segment
        || ![segment.from?.nodeId, segment.to?.nodeId].includes(assignment?.nodeId)
        || structuralOperation?.type !== 'optionalBranch') {
        errors.push(diagnostic(
          'delegated-gate-segment-invalid',
          `Delegated gate ${assignment?.beatId} does not dominate a valid single-entry branch segment.`,
          { beatId: assignment?.beatId, segmentId: assignment?.gatedSegmentId },
        ));
      } else if (gateAssignmentBySegmentId.has(segment.id)) {
        errors.push(diagnostic(
          'delegated-gate-segment-reused',
          `Delegated gates ${gateAssignmentBySegmentId.get(segment.id)?.beatId} and ${assignment?.beatId} share ${segment.id}.`,
          { beatId: assignment?.beatId, segmentId: segment.id },
        ));
      } else {
        gateAssignmentBySegmentId.set(segment.id, assignment);
      }
    }
  }
  for (const beat of delegated.values()) {
    if (beat.required !== false && !assignments.has(String(beat.id))) {
      errors.push(diagnostic('required-delegated-beat-unassigned', `Required delegated beat ${beat.id} was not assigned.`, { beatId: beat.id }));
    }
    const assignment = assignments.get(String(beat.id));
    if (!assignment) continue;
    for (const prerequisite of beat.requiresBeatIds ?? []) {
      const prerequisiteAssignment = assignments.get(String(prerequisite));
      if (!prerequisiteAssignment
        || Number(prerequisiteAssignment.progressionOrder) >= Number(assignment.progressionOrder)) {
        errors.push(diagnostic('delegated-progression-order-invalid', `Beat ${beat.id} does not follow ${prerequisite}.`, { beatId: beat.id, prerequisite }));
      }
    }
  }

  // Prove the delegated beats are obtainable on the effective supplement
  // graph. Parent endpoints are the roots granted by the host. A gated branch
  // segment opens only after all explicitly delegated prerequisites have been
  // collected, so a key behind its own gate or a disconnected objective is
  // rejected even when synthetic assignment indices appear ordered.
  const reachableNodeIds = new Set();
  for (const segment of segmentById.values()) {
    for (const endpoint of [segment.from, segment.to]) {
      if (endpoint?.nodeId && !nodeById.has(endpoint.nodeId)) {
        reachableNodeIds.add(endpoint.nodeId);
      }
    }
  }
  const completedBeatIds = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const assignment of assignments.values()) {
      const beatId = String(assignment?.beatId ?? '');
      if (!beatId || completedBeatIds.has(beatId)) continue;
      const isGate = /gate|door/i.test(String(
        assignment?.beatKind ?? delegated.get(beatId)?.kind ?? '',
      ));
      if (isGate || !reachableNodeIds.has(assignment?.nodeId)) continue;
      if ((assignment?.requiresBeatIds ?? []).every((id) => completedBeatIds.has(String(id)))) {
        completedBeatIds.add(beatId);
        changed = true;
      }
    }
    for (const segment of segmentById.values()) {
      const fromId = segment.from?.nodeId;
      const toId = segment.to?.nodeId;
      if (!fromId || !toId) continue;
      const gate = gateAssignmentBySegmentId.get(segment.id);
      if (gate && !completedBeatIds.has(String(gate.beatId))) {
        const gateReachable = reachableNodeIds.has(fromId) || reachableNodeIds.has(toId);
        const prerequisitesMet = (gate.requiresBeatIds ?? [])
          .every((id) => completedBeatIds.has(String(id)));
        if (gateReachable && prerequisitesMet) {
          completedBeatIds.add(String(gate.beatId));
          changed = true;
        } else {
          continue;
        }
      }
      if (reachableNodeIds.has(fromId) && !reachableNodeIds.has(toId)) {
        reachableNodeIds.add(toId);
        changed = true;
      }
      if (reachableNodeIds.has(toId) && !reachableNodeIds.has(fromId)) {
        reachableNodeIds.add(fromId);
        changed = true;
      }
    }
  }
  for (const beat of delegated.values()) {
    if (beat.required !== false && !completedBeatIds.has(String(beat.id))) {
      errors.push(diagnostic(
        'delegated-progression-unsolvable',
        `Required delegated beat ${beat.id} is not reachable with its gate prerequisites.`,
        { beatId: beat.id },
      ));
    }
  }
}

/**
 * Validates the pure overlay before any Three.js resources can be created.
 */
export function validateDungeonAugmentationPlan(plan, {
  baseDraft = {},
  extensionRegions = [],
  profiles = {},
  grammars = {},
  themeCapabilitiesByRegionId = {},
} = {}) {
  const errors = [];
  const warnings = [];
  try {
    canonicalStringify(plan);
  } catch (error) {
    errors.push(diagnostic('plan-not-serializable', error.message, { path: error.path ?? null }));
  }
  if (plan?.schema !== DUNGEON_AUGMENTATION_OVERLAY_SCHEMA) {
    errors.push(diagnostic('invalid-overlay-schema', 'The overlay schema is not supported.'));
  }
  if (Number(plan?.revision) !== DUNGEON_AUGMENTATION_SCHEMA_REVISION) {
    errors.push(diagnostic('invalid-overlay-revision', 'The overlay revision is not supported.'));
  }
  const profile = profiles?.[plan?.profileId];
  if (!profile) errors.push(diagnostic('profile-not-found', `Unknown augmentation profile ${plan?.profileId}.`));
  const basePlanHash = String(baseDraft?.basePlanHash ?? baseDraft?.planHash ?? plan?.basePlanHash ?? '');
  if (String(plan?.basePlanHash ?? '') !== basePlanHash) {
    errors.push(diagnostic('base-plan-hash-mismatch', 'The overlay does not target this base plan.', { expected: basePlanHash, actual: plan?.basePlanHash }));
  }

  const regionById = new Map(extensionRegions.map((region) => [region.id, region]));
  const operationById = new Map();
  const nodeById = new Map();
  const segmentById = new Map();
  const allIds = new Set();
  const register = (entry, kind) => {
    if (!entry?.id) {
      errors.push(diagnostic(`${kind}-id-missing`, `${kind} is missing an ID.`));
      return;
    }
    if (allIds.has(entry.id)) errors.push(diagnostic('duplicate-overlay-id', `Overlay ID ${entry.id} is duplicated.`, { id: entry.id }));
    allIds.add(entry.id);
  };

  for (const operation of plan?.operations ?? []) {
    register(operation, 'operation');
    operationById.set(operation.id, operation);
    if (operation.schema !== DUNGEON_AUGMENTATION_OPERATION_SCHEMA) {
      errors.push(diagnostic('invalid-operation-schema', `Operation ${operation.id} has an invalid schema.`, { operationId: operation.id }));
    }
    if (!['optionalBranch', 'edgePadding', 'delegatedProgression'].includes(operation.type)) {
      errors.push(diagnostic('unsupported-operation-type', `Operation ${operation.id} has unsupported type ${operation.type}.`, { operationId: operation.id }));
    }
    if (!regionById.has(operation.parentRegionId)) {
      errors.push(diagnostic('operation-region-missing', `Operation ${operation.id} has no parent extension region.`, { operationId: operation.id }));
    }
    if (!isDungeonSupplementIdForRegion(operation.id, operation.parentRegionId)) {
      errors.push(diagnostic('operation-id-not-namespaced', `Operation ${operation.id} is outside its parent namespace.`, { operationId: operation.id }));
    }
    if (operation.type === 'optionalBranch') {
      if (operation.returnRouteGuaranteed !== true || operation.bidirectional !== true) {
        errors.push(diagnostic('optional-branch-return-route-required', `Branch ${operation.id} can strand the player.`, { operationId: operation.id }));
      }
    }
    if (operation.type === 'edgePadding') {
      if (operation.originalEdgePreserved !== true || operation.gateDominancePreserved !== true) {
        errors.push(diagnostic('edge-padding-parent-identity-not-preserved', `Padding ${operation.id} changes its parent logical edge.`, { operationId: operation.id }));
      }
      if (!operation.originalLogicalEdge?.id) {
        errors.push(diagnostic('edge-padding-logical-edge-missing', `Padding ${operation.id} has no logical edge identity.`, { operationId: operation.id }));
      }
    }
  }
  for (const node of plan?.nodes ?? []) {
    register(node, 'node');
    nodeById.set(node.id, node);
  }
  for (const segment of plan?.segments ?? []) {
    register(segment, 'segment');
    segmentById.set(segment.id, segment);
    if (!operationById.has(segment?.operationId)) {
      errors.push(diagnostic('segment-operation-missing', `Segment ${segment?.id} has no operation.`, { segmentId: segment?.id }));
    }
    if (!finitePoint(segment?.from?.position) || !finitePoint(segment?.to?.position)) {
      errors.push(diagnostic('segment-endpoint-invalid', `Segment ${segment?.id} has invalid endpoints.`, { segmentId: segment?.id }));
    }
    if (!Array.isArray(segment?.path) || segment.path.length < 2 || !segment.path.every(finitePoint)) {
      errors.push(diagnostic('segment-path-invalid', `Segment ${segment?.id} has no valid path.`, { segmentId: segment?.id }));
    }
    if (segment?.bidirectional !== true) {
      errors.push(diagnostic('segment-must-be-bidirectional', `Segment ${segment?.id} does not preserve a return route.`, { segmentId: segment?.id }));
    }
    validateThemeBinding(segment?.themeBinding, errors, segment?.id);
    const segmentCapabilities = capabilitySourceForBinding(
      segment?.themeBinding,
      extensionRegions,
      themeCapabilitiesByRegionId,
    );
    const missingSegmentCapabilities = getMissingDungeonThemeCapabilities(
      segment?.requiredThemeCapabilities,
      segmentCapabilities,
    );
    if (missingSegmentCapabilities.length > 0) {
      errors.push(diagnostic('theme-capabilities-missing', `Segment ${segment?.id} cannot be rendered by its parent theme.`, {
        segmentId: segment?.id,
        missing: missingSegmentCapabilities,
      }));
    }
    if (!Array.isArray(segment?.landings)
      || segment.landings.length !== 2
      || !segment.landings.every((landing) => finitePoint(landing?.position))) {
      errors.push(diagnostic('segment-landings-invalid', `Segment ${segment?.id} lacks endpoint landing records.`, { segmentId: segment?.id }));
    }
    if (!Array.isArray(segment?.landingVolumes)
      || segment.landingVolumes.length !== 2
      || !segment.landingVolumes.every((volume) => finitePoint(volume?.center) && positiveSize(volume?.size))) {
      errors.push(diagnostic('segment-landing-volumes-invalid', `Segment ${segment?.id} lacks valid endpoint landing volumes.`, { segmentId: segment?.id }));
    }
  }
  for (const node of plan?.nodes ?? []) {
    validateNode({
      node, operationById, segmentById, grammarById: grammars, regionById,
      regions: extensionRegions, themeCapabilitiesByRegionId, errors, warnings,
    });
  }
  for (const transition of plan?.transitionBays ?? []) {
    register(transition, 'transition');
    validateTransition(transition, {
      operationById, regions: extensionRegions, themeCapabilitiesByRegionId, errors,
    });
  }

  const baseVolumes = collectBaseDraftVolumes(baseDraft, extensionRegions);
  const nodeVolumes = (plan?.nodes ?? []).flatMap((node) => ([
    ...(node.occupiedVolumes ?? []).map((volume) => ({ ...volume, volumeClass: 'occupied' })),
    ...(node.clearanceVolumes ?? []).map((volume) => ({ ...volume, volumeClass: 'clearance' })),
  ].map((volume) => ({ ...volume, nodeId: node.id }))));
  for (const volume of nodeVolumes) {
    const operation = operationById.get(nodeById.get(volume.nodeId)?.operationId);
    const replacedEdgeIds = new Set([
      operation?.originalEdgeId,
      operation?.originalLogicalEdge?.id,
      operation?.originalEdgeSnapshot?.id,
      operation?.originalEdgeSnapshot?.logicalEdgeId,
    ].filter(Boolean).map(String));
    for (const baseVolume of baseVolumes) {
      if (operation?.type === 'edgePadding' && [
        baseVolume.ownerId,
        baseVolume.physicalConnectionId,
        baseVolume.logicalConnectionId,
      ].some((id) => id != null && replacedEdgeIds.has(String(id)))) {
        continue;
      }
      if (dungeonVolumesOverlap(volume, baseVolume)) {
        errors.push(diagnostic('supplement-overlaps-base-draft', `Supplement node ${volume.nodeId} overlaps ${baseVolume.id}.`, { nodeId: volume.nodeId, baseVolumeId: baseVolume.id }));
      }
    }
  }
  for (let first = 0; first < nodeVolumes.length; first += 1) {
    for (let second = first + 1; second < nodeVolumes.length; second += 1) {
      if (nodeVolumes[first].nodeId === nodeVolumes[second].nodeId) continue;
      if (dungeonVolumesOverlap(nodeVolumes[first], nodeVolumes[second])) {
        errors.push(diagnostic('supplement-nodes-overlap', `Supplement nodes ${nodeVolumes[first].nodeId} and ${nodeVolumes[second].nodeId} overlap.`, { firstNodeId: nodeVolumes[first].nodeId, secondNodeId: nodeVolumes[second].nodeId }));
      }
    }
  }
  const segmentVolumes = (plan?.segments ?? []).flatMap((segment) => (
    [
      ...(segment.occupiedVolumes ?? []).map((volume) => ({ ...volume, volumeClass: 'occupied' })),
      ...(segment.clearanceVolumes ?? []).map((volume) => ({ ...volume, volumeClass: 'clearance' })),
      ...(segment.landingVolumes ?? []).map((volume) => ({ ...volume, volumeClass: 'landing' })),
    ].map((volume) => ({ ...volume, segmentId: segment.id }))
  ));
  for (const volume of segmentVolumes) {
    const endpointNodeIds = new Set(volume.endpointParentNodeIds ?? []);
    const segment = segmentById.get(volume.segmentId);
    const operation = operationById.get(segment?.operationId);
    const replacedEdgeIds = new Set([
      operation?.originalEdgeId,
      operation?.originalLogicalEdge?.id,
      operation?.originalEdgeSnapshot?.id,
      operation?.originalEdgeSnapshot?.logicalEdgeId,
    ].filter(Boolean).map(String));
    for (const baseVolume of baseVolumes) {
      if (endpointNodeIds.has(baseVolume.ownerId)) continue;
      if (operation?.type === 'edgePadding' && [
        baseVolume.ownerId,
        baseVolume.physicalConnectionId,
        baseVolume.logicalConnectionId,
      ].some((id) => id != null && replacedEdgeIds.has(String(id)))) {
        continue;
      }
      if (dungeonVolumesOverlap(volume, baseVolume)) {
        errors.push(diagnostic('supplement-segment-overlaps-base-draft', `Supplement segment ${volume.segmentId} overlaps ${baseVolume.id}.`, {
          segmentId: volume.segmentId,
          baseVolumeId: baseVolume.id,
          volumePurpose: volume.purpose,
        }));
      }
    }
    for (const nodeVolume of nodeVolumes) {
      if (endpointNodeIds.has(nodeVolume.nodeId)) continue;
      if (dungeonVolumesOverlap(volume, nodeVolume)) {
        errors.push(diagnostic('supplement-segment-overlaps-node', `Supplement segment ${volume.segmentId} overlaps node ${nodeVolume.nodeId}.`, {
          segmentId: volume.segmentId,
          nodeId: nodeVolume.nodeId,
          volumePurpose: volume.purpose,
        }));
      }
    }
  }
  for (let first = 0; first < segmentVolumes.length; first += 1) {
    for (let second = first + 1; second < segmentVolumes.length; second += 1) {
      if (segmentVolumes[first].segmentId === segmentVolumes[second].segmentId) continue;
      const firstEndpoints = new Set(segmentVolumes[first].endpointParentNodeIds ?? []);
      const sharesEndpoint = (segmentVolumes[second].endpointParentNodeIds ?? [])
        .some((nodeId) => firstEndpoints.has(nodeId));
      if (!sharesEndpoint && dungeonVolumesOverlap(segmentVolumes[first], segmentVolumes[second])) {
        errors.push(diagnostic('supplement-segments-overlap', `Supplement segments ${segmentVolumes[first].segmentId} and ${segmentVolumes[second].segmentId} overlap.`, {
          firstSegmentId: segmentVolumes[first].segmentId,
          secondSegmentId: segmentVolumes[second].segmentId,
          firstVolumeClass: segmentVolumes[first].volumeClass,
          secondVolumeClass: segmentVolumes[second].volumeClass,
        }));
      }
    }
  }

  validateProgression(
    plan,
    profile,
    extensionRegions,
    nodeById,
    segmentById,
    operationById,
    errors,
  );
  const expectedHash = computeDungeonAugmentationPlanHash(plan);
  if (plan?.augmentationPlanHash !== expectedHash) {
    errors.push(diagnostic('augmentation-plan-hash-mismatch', 'The augmentation plan hash does not match its contents.', { expected: expectedHash, actual: plan?.augmentationPlanHash }));
  }
  const expectedEffectiveHash = computeEffectiveDungeonPlanHash(plan?.basePlanHash, plan?.augmentationPlanHash);
  if (plan?.effectivePlanHash !== expectedEffectiveHash) {
    errors.push(diagnostic('effective-plan-hash-mismatch', 'The effective plan hash does not match the base and overlay.', { expected: expectedEffectiveHash, actual: plan?.effectivePlanHash }));
  }
  const roomCount = plan?.nodes?.length ?? 0;
  if (profile && (roomCount < profile.operationBudget.minimumTotalRooms
    || roomCount > profile.operationBudget.maximumTotalRooms)) {
    errors.push(diagnostic('supplement-room-budget-violated', `The overlay contains ${roomCount} supplemental rooms.`, { roomCount, budget: profile.operationBudget }));
  }

  return deepFreezeDungeonAugmentationValue({
    accepted: errors.length === 0,
    errors,
    warnings,
    diagnostics: {
      operationCount: plan?.operations?.length ?? 0,
      nodeCount: plan?.nodes?.length ?? 0,
      segmentCount: plan?.segments?.length ?? 0,
      transitionBayCount: plan?.transitionBays?.length ?? 0,
      progressionAssignmentCount: plan?.progressionAssignments?.length ?? 0,
      baseVolumeCount: baseVolumes.length,
      segmentVolumeCount: segmentVolumes.length,
      planHash: plan?.augmentationPlanHash ?? null,
    },
  });
}
