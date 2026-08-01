import {
  DUNGEON_AUGMENTATION_OPERATION_SCHEMA,
  DUNGEON_AUGMENTATION_OVERLAY_SCHEMA,
  DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA,
  DUNGEON_AUGMENTATION_SCHEMA_REVISION,
  DUNGEON_AUGMENTATION_V2_SCHEMA_REVISION,
  DUNGEON_REGION_THEME_SCHEMA,
  DUNGEON_TRANSITION_BAY_SCHEMA,
  validateDungeonRouteNetworkEndpointPlanningWitness,
  validateDungeonRegionThemeBinding,
} from './contracts.js';
import {
  canonicalStringify,
  deepFreezeDungeonAugmentationValue,
  hashCanonicalValue,
} from './canonical.js';
import {
  collectBaseDraftVolumes,
  createDungeonRouteEndpointSeam,
  dungeonPointDistance,
  dungeonVolumeOverlapWithinGrants,
  dungeonVolumesOverlap,
  measureDungeonPolyline,
} from './geometry.js';
import { isDungeonSupplementIdForRegion } from './ids.js';
import {
  DUNGEON_ROUTE_ENDPOINT_SEAM_GRID_LATTICE_DIAGNOSTIC,
  inspectDungeonRouteEndpointSeamGridLattice,
} from './endpointSeamLattice.js';
import {
  DUNGEON_SELECTION_BAG_FAMILIES,
  validateDungeonSelectionBagWitnessSequence,
} from './selectionBagWitness.js';

function diagnostic(code, message, context = {}) {
  return { code, message, context };
}

function finitePoint(point) {
  return point && ['x', 'y', 'z'].every((axis) => Number.isFinite(Number(point[axis])));
}

function positiveSize(size) {
  return size && ['x', 'y', 'z'].every((axis) => Number(size[axis]) > 0 && Number.isFinite(Number(size[axis])));
}

const ROUTE_NETWORK_ENDPOINT_MODULE_VARIANTS = Object.freeze({
  'supplement-route-connector-through-t-v1': Object.freeze({
    widthTiles: 5,
    depthTiles: 7,
  }),
  'supplement-route-connector-through-t-branch-entry-v1': Object.freeze({
    widthTiles: 7,
    depthTiles: 5,
  }),
});

function overlapGrantForPlanningWitness(socket, overlaps = []) {
  const matches = overlaps.filter(({ socketId }) => (
    String(socketId ?? '') === String(socket?.id ?? '')
  ));
  const planningCenter = socket?.planningModuleCenter;
  return matches.find(({ center }) => (
    finitePoint(center)
      && finitePoint(planningCenter)
      && Math.hypot(
        Number(center.x) - Number(planningCenter.x),
        Number(center.z) - Number(planningCenter.z),
      ) <= 1e-4
  )) ?? matches.find(({ moduleTemplateId }) => (
    moduleTemplateId === 'supplement-route-connector-through-t-v1'
  )) ?? matches[0] ?? null;
}

function pointLiesOnPolyline(point, path, tolerance = 1e-4) {
  if (!finitePoint(point) || !Array.isArray(path) || path.length < 2) return false;
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const spanLength = dungeonPointDistance(start, end);
    const splitLength = dungeonPointDistance(start, point) + dungeonPointDistance(point, end);
    if (splitLength <= spanLength + tolerance) return true;
  }
  return false;
}

function validateVolumeArray(volumes, {
  ownerId,
  ownerKind,
  volumeKind,
  errors,
}) {
  if (!Array.isArray(volumes) || volumes.length === 0) {
    errors.push(diagnostic(
      `${ownerKind}-${volumeKind}-volumes-missing`,
      `${ownerKind} ${ownerId} has no ${volumeKind} volumes.`,
      { ownerId },
    ));
    return;
  }
  for (const [volumeIndex, volume] of volumes.entries()) {
    if (!finitePoint(volume?.center) || !positiveSize(volume?.size)) {
      errors.push(diagnostic(
        `${ownerKind}-${volumeKind}-volume-invalid`,
        `${ownerKind} ${ownerId} has an invalid ${volumeKind} volume.`,
        { ownerId, volumeId: volume?.id ?? null, volumeIndex },
      ));
    }
  }
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
  validateVolumeArray(node?.occupiedVolumes, {
    ownerId: node?.id,
    ownerKind: 'node',
    volumeKind: 'occupied',
    errors,
  });
  validateVolumeArray(node?.clearanceVolumes, {
    ownerId: node?.id,
    ownerKind: 'node',
    volumeKind: 'clearance',
    errors,
  });
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

function normalizedFeatureToken(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function recordFeatureToken(record) {
  if (typeof record === 'string') return normalizedFeatureToken(record);
  return normalizedFeatureToken(
    record?.kind
      ?? record?.type
      ?? record?.role
      ?? record?.family
      ?? record?.connectorFamily
      ?? record?.id,
  );
}

function recordsAt(source, keys) {
  return keys.flatMap((key) => (Array.isArray(source?.[key]) ? source[key] : []));
}

function tokenMatchesAny(token, candidates) {
  return candidates.some((candidate) => token === candidate || token.includes(candidate));
}

function canonicalConnectorFamily(value) {
  const token = normalizedFeatureToken(value);
  if (!token) return null;
  if (token.includes('servicegallery')) return 'service-gallery';
  if (token.includes('tracktrap')) return 'track-trap';
  if (token.includes('transitionbay')) return 'transition-bay';
  if (token.includes('ladder')) return 'ladder';
  if (token.includes('lift')) return 'lift';
  if (token.includes('slope') || token.includes('ramp')) return 'slope';
  return token;
}

function finiteElevation(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function endpointElevation(endpoint) {
  return finiteElevation(
    endpoint?.position?.y
      ?? endpoint?.position?.elevation
      ?? endpoint?.y
      ?? endpoint?.elevation,
  );
}

function segmentProvidesElevationTransfer(segment) {
  const fromElevation = endpointElevation(segment?.from);
  const toElevation = endpointElevation(segment?.to);
  const explicitDelta = finiteElevation(
    segment?.elevationDelta
      ?? segment?.traversal?.elevationDelta
      ?? segment?.connectorVariant?.elevationDelta,
  );
  return (fromElevation !== null
      && toElevation !== null
      && Math.abs(toElevation - fromElevation) > 1e-6)
    || (explicitDelta !== null && Math.abs(explicitDelta) > 1e-6)
    || segment?.traversal?.elevationChange === true
    || segment?.connectorVariant?.elevationChange === true;
}

function nodeHasSideRoomRole(node) {
  const values = [
    node?.kind,
    node?.role,
    node?.nodeRole,
    node?.routeRole,
    node?.routeClassification,
    node?.purpose,
    node?.topology,
    ...(Array.isArray(node?.tags) ? node.tags : []),
  ].map(normalizedFeatureToken).filter(Boolean);
  return values.some((token) => (
    tokenMatchesAny(token, [
      'sideroom',
      'hallwaysideroom',
      'corridorsideroom',
      'sidebranchroom',
    ])
    || (token.includes('lateral') && token.includes('room'))
  ));
}

function nodeHasPlatformStructure(node) {
  const structure = node?.structure ?? {};
  if (recordsAt(structure, ['platforms', 'catwalks']).length > 0) return true;
  if ((node?.anchors ?? []).some((anchor) => tokenMatchesAny(recordFeatureToken(anchor), [
    'platform',
    'catwalk',
  ]))) return true;
  return recordsAt(structure, ['floors']).some((floor) => tokenMatchesAny(
    recordFeatureToken(floor),
    ['platform', 'catwalk', 'raiseddeck', 'elevateddeck'],
  ));
}

function collectDungeonAugmentationFeatureCounts(plan) {
  const nodes = plan?.nodes ?? [];
  const segments = plan?.segments ?? [];
  const sideRoomNodeIds = new Set(
    nodes.filter(nodeHasSideRoomRole).map((node) => String(node.id)),
  );
  const connectorFamilies = new Set();
  let encounterCount = 0;
  let rewardCount = 0;
  let trapCount = 0;
  let structuralElevationTransferCount = 0;

  for (const node of nodes) {
    const anchors = node?.anchors ?? [];
    encounterCount += anchors.filter((anchor) => tokenMatchesAny(
      recordFeatureToken(anchor),
      ['encounter', 'enemyencounter', 'enemyspawn'],
    )).length;
    rewardCount += anchors.filter((anchor) => tokenMatchesAny(
      recordFeatureToken(anchor),
      ['reward', 'treasure', 'chest'],
    )).length;
    trapCount += anchors.filter((anchor) => tokenMatchesAny(
      recordFeatureToken(anchor),
      ['trap', 'hazard', 'environmentalhazard'],
    )).length;
    encounterCount += recordsAt(node, ['encounters', 'enemyEncounters']).length;
    rewardCount += recordsAt(node, ['rewards', 'chests', 'treasures']).length;
    trapCount += recordsAt(node, ['traps', 'hazards', 'environmentalHazards']).length;

    const structure = node?.structure ?? {};
    const structuralTransfers = recordsAt(structure, [
      'ramps',
      'ladders',
      'lifts',
      'elevationTransfers',
      'verticalConnectors',
    ]);
    structuralElevationTransferCount += structuralTransfers.length;
    trapCount += recordsAt(structure, ['traps', 'hazards', 'environmentalHazards']).length;
    for (const transfer of structuralTransfers) {
      const family = canonicalConnectorFamily(
        transfer?.connectorFamily ?? transfer?.family ?? transfer?.kind ?? transfer?.type,
      );
      if (family) connectorFamilies.add(family);
    }
  }

  for (const segment of segments) {
    const family = canonicalConnectorFamily(
      segment?.connectorFamily
        ?? segment?.connectorVariant?.traversalKind
        ?? segment?.connectorVariantId,
    );
    if (family) connectorFamilies.add(family);
    const routeToken = normalizedFeatureToken(
      segment?.routeRole ?? segment?.routeClassification ?? segment?.purpose,
    );
    if (tokenMatchesAny(routeToken, ['sideroom', 'sidebranch'])) {
      for (const endpoint of [segment?.from, segment?.to]) {
        if (nodes.some((node) => node.id === endpoint?.nodeId)) {
          sideRoomNodeIds.add(String(endpoint.nodeId));
        }
      }
    }
  }

  return {
    sideRoomCount: sideRoomNodeIds.size,
    elevationTransferCount: structuralElevationTransferCount
      + segments.filter(segmentProvidesElevationTransfer).length,
    encounterCount,
    rewardCount,
    trapCount,
    platformRoomCount: nodes.filter(nodeHasPlatformStructure).length,
    connectorFamilyCount: connectorFamilies.size,
    connectorFamilies: [...connectorFamilies].sort(),
  };
}

function requiredFeatureMinimum(value) {
  const candidate = value && typeof value === 'object'
    ? value.minimum ?? value.min ?? value.count
    : value;
  const number = Number(candidate);
  return Number.isFinite(number) && number > 0 ? Math.ceil(number) : 0;
}

function validateRequiredFeatureQuotas(profile, counts, errors) {
  const required = profile?.requiredFeatures;
  if (!required || typeof required !== 'object') return;
  const requirements = {
    sideRoomCount: requiredFeatureMinimum(required.sideRoomCount),
    elevationTransferCount: requiredFeatureMinimum(required.elevationTransferCount),
    encounterCount: requiredFeatureMinimum(required.encounterCount),
    rewardCount: requiredFeatureMinimum(required.rewardCount),
    trapCount: requiredFeatureMinimum(required.trapCount),
    platformRoomCount: requiredFeatureMinimum(required.platformRoomCount),
    connectorFamilyCount: requiredFeatureMinimum(
      required.connectorFamilyCount
        ?? required.connectorFamilyCoverageCount
        ?? required.connectorFamilyCoverage,
    ),
  };
  for (const [feature, minimum] of Object.entries(requirements)) {
    if (minimum > 0 && Number(counts[feature] ?? 0) < minimum) {
      errors.push(diagnostic(
        'required-feature-quota-not-met',
        `Profile ${profile.id} requires ${minimum} ${feature}, but the overlay provides ${counts[feature] ?? 0}.`,
        { profileId: profile.id, feature, required: minimum, actual: counts[feature] ?? 0 },
      ));
    }
  }
}

function validateOptionalBranchGraphs(plan, operationById, nodeById, segmentById, errors) {
  const checks = [];
  for (const operation of operationById.values()) {
    if (operation?.type !== 'optionalBranch') continue;
    const errorCountBefore = errors.length;
    const declaredNodeIds = new Set((operation.nodeIds ?? []).map(String));
    const operationNodeIds = new Set([
      ...declaredNodeIds,
      ...[...nodeById.values()]
        .filter((node) => node?.operationId === operation.id)
        .map((node) => String(node.id)),
    ]);
    for (const nodeId of declaredNodeIds) {
      if (!nodeById.has(nodeId)) {
        errors.push(diagnostic(
          'optional-branch-node-missing',
          `Branch ${operation.id} declares unknown node ${nodeId}.`,
          { operationId: operation.id, nodeId },
        ));
      }
    }

    const declaredSegmentIds = new Set((operation.segmentIds ?? []).map(String));
    const operationSegments = [...segmentById.values()].filter((segment) => (
      declaredSegmentIds.has(String(segment?.id)) || segment?.operationId === operation.id
    ));
    for (const segmentId of declaredSegmentIds) {
      if (!segmentById.has(segmentId)) {
        errors.push(diagnostic(
          'optional-branch-segment-missing',
          `Branch ${operation.id} declares unknown segment ${segmentId}.`,
          { operationId: operation.id, segmentId },
        ));
      }
    }

    const adjacency = new Map([...operationNodeIds].map((nodeId) => [nodeId, new Set()]));
    const parentConnectedNodeIds = new Set();
    let parentAttachmentCount = 0;
    const matchesParent = (endpoint) => {
      const attachmentNodeId = operation.attachmentNodeId == null
        ? null
        : String(operation.attachmentNodeId);
      const attachmentSocketId = operation.attachmentSocketId == null
        ? null
        : String(operation.attachmentSocketId);
      if (attachmentNodeId === null && attachmentSocketId === null) {
        return !operationNodeIds.has(String(endpoint?.nodeId ?? ''));
      }
      const nodeMatches = attachmentNodeId === null
        || String(endpoint?.nodeId ?? '') === attachmentNodeId;
      const socketMatches = attachmentSocketId === null || [
        endpoint?.id,
        endpoint?.socketId,
      ].some((id) => String(id ?? '') === attachmentSocketId);
      return nodeMatches && socketMatches;
    };

    for (const segment of operationSegments) {
      if (segment?.operationId !== operation.id) {
        errors.push(diagnostic(
          'optional-branch-segment-operation-mismatch',
          `Branch ${operation.id} includes segment ${segment?.id} owned by another operation.`,
          { operationId: operation.id, segmentId: segment?.id },
        ));
      }
      if (segment?.bidirectional !== true) {
        errors.push(diagnostic(
          'optional-branch-segment-not-bidirectional',
          `Branch ${operation.id} segment ${segment?.id} has no valid return traversal.`,
          { operationId: operation.id, segmentId: segment?.id },
        ));
      }
      const fromId = String(segment?.from?.nodeId ?? '');
      const toId = String(segment?.to?.nodeId ?? '');
      const fromIsNode = operationNodeIds.has(fromId);
      const toIsNode = operationNodeIds.has(toId);
      if (fromIsNode && toIsNode) {
        adjacency.get(fromId)?.add(toId);
        adjacency.get(toId)?.add(fromId);
        continue;
      }
      if (fromIsNode !== toIsNode) {
        const branchNodeId = fromIsNode ? fromId : toId;
        const externalEndpoint = fromIsNode ? segment?.to : segment?.from;
        if (matchesParent(externalEndpoint)) {
          parentAttachmentCount += 1;
          parentConnectedNodeIds.add(branchNodeId);
        } else {
          errors.push(diagnostic(
            'optional-branch-external-endpoint-invalid',
            `Branch ${operation.id} segment ${segment?.id} connects to an undeclared external endpoint.`,
            { operationId: operation.id, segmentId: segment?.id, externalNodeId: externalEndpoint?.nodeId ?? null },
          ));
        }
        continue;
      }
      errors.push(diagnostic(
        'optional-branch-segment-outside-graph',
        `Branch ${operation.id} segment ${segment?.id} connects no branch node.`,
        { operationId: operation.id, segmentId: segment?.id },
      ));
    }

    if (operationNodeIds.size === 0) {
      errors.push(diagnostic(
        'optional-branch-node-required',
        `Branch ${operation.id} contains no supplemental node.`,
        { operationId: operation.id },
      ));
    }
    if (parentAttachmentCount === 0) {
      errors.push(diagnostic(
        'optional-branch-parent-attachment-missing',
        `Branch ${operation.id} is not connected to its registered parent socket.`,
        { operationId: operation.id, attachmentNodeId: operation.attachmentNodeId ?? null, attachmentSocketId: operation.attachmentSocketId ?? null },
      ));
    }

    const reachableNodeIds = new Set(parentConnectedNodeIds);
    const queue = [...parentConnectedNodeIds];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const adjacent of adjacency.get(queue[cursor]) ?? []) {
        if (reachableNodeIds.has(adjacent)) continue;
        reachableNodeIds.add(adjacent);
        queue.push(adjacent);
      }
    }
    for (const nodeId of operationNodeIds) {
      if (!nodeById.has(nodeId)) continue;
      if (!reachableNodeIds.has(nodeId)) {
        errors.push(diagnostic(
          'optional-branch-node-unreachable',
          `Branch ${operation.id} strands node ${nodeId} outside its parent-connected component.`,
          { operationId: operation.id, nodeId },
        ));
      }
    }
    checks.push({
      operationId: operation.id,
      nodeCount: operationNodeIds.size,
      segmentCount: operationSegments.length,
      parentAttachmentCount,
      reachableNodeCount: reachableNodeIds.size,
      accepted: errors.length === errorCountBefore,
    });
  }
  return checks;
}

const ROUTE_NETWORK_GRANT_SCHEMA_V2 = 'ruindivex-dungeon-route-network-grant/v2';
const PROGRESSION_SNAPSHOT_SCHEMA_V2 = 'ruindivex-dungeon-progression-snapshot/v2';
const V4_MAXIMUM_FEATURELESS_SPAN_METERS = 33.6;
const V4_MAXIMUM_ROUTE_NETWORKS = 8;
const V4_MAXIMUM_SUPPLEMENT_MODULES = 30;
const V4_ROUTE_SOCKET_APPROACH_METERS = 5.6;
const V4_ROUTE_CORRIDOR_WIDTH_METERS = 8.4;
const V4_ROUTE_CLEARANCE_HEIGHT_METERS = 3.6;
const V4_JUNCTION_FOOTPRINTS_METERS = Object.freeze({
  'through-t': Object.freeze([5 * 2.8, 7 * 2.8]),
  crossroads: Object.freeze([7 * 2.8, 7 * 2.8]),
  'staggered-cross': Object.freeze([5 * 2.8, 13 * 2.8]),
  'fork-merge': Object.freeze([5 * 2.8, 7 * 2.8]),
  'stacked-interchange': Object.freeze([9 * 2.8, 13 * 2.8]),
  'over-under-crossover': Object.freeze([7 * 2.8, 7 * 2.8]),
});
const SUPPLEMENT_ROOM_NODE_KIND = 'supplementRoom';
const SUPPLEMENT_CONNECTOR_MODULE_NODE_KIND = 'supplementConnectorModule';
const SUPPLEMENT_CONNECTOR_JUNCTION_NODE_KIND = 'supplementConnectorJunction';
const V4_VERTICAL_CONNECTOR_MINIMUM_RUN_METERS = Object.freeze({
  slope: 44.8,
  ladder: 28,
  lift: 36.4,
});
const ROUTE_WITNESS_TOLERANCE = 1e-4;
const CARDINAL_WALL_SIDES = Object.freeze(['north', 'east', 'south', 'west']);
const ROUTE_NETWORK_SELECTION_MANIFEST_SCHEMA =
  'ruindivex-dungeon-route-network-selection-manifest/v1';

function stringArray(value) {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value])
    .filter((entry) => entry != null && String(entry).trim())
    .map((entry) => String(entry));
}

function sortedUniqueStrings(value) {
  return [...new Set(stringArray(value))].sort();
}

function rawStableRuntimeStateIds(operation) {
  const value = operation?.stableRuntimeStateIds;
  return value && !Array.isArray(value) && typeof value === 'object'
    ? Object.values(value).flatMap((entry) => stringArray(entry))
    : stringArray(value);
}

function operationOwnedRuntimeStateIds(operation) {
  const values = [
    operation?.stableRuntimeStateIds,
    operation?.runtimeStateIds,
    operation?.shortcutStateIds,
    operation?.runtimeStateId,
    operation?.stableRuntimeStateId,
    operation?.shortcutStateId,
    operation?.localProgressionStateId,
  ];
  const ids = new Set();
  const append = (value) => {
    if (Array.isArray(value)) {
      for (const entry of value) append(entry);
    } else if (value && typeof value === 'object') {
      for (const entry of Object.values(value)) append(entry);
    } else {
      for (const id of stringArray(value)) ids.add(id);
    }
  };
  for (const value of values) append(value);
  return [...ids].sort();
}

function sameStringSet(first, second) {
  const firstValues = sortedUniqueStrings(first);
  const secondValues = sortedUniqueStrings(second);
  return firstValues.length === secondValues.length
    && firstValues.every((value, index) => value === secondValues[index]);
}

function sameStringSequence(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second)) return false;
  return first.length === second.length
    && first.every((value, index) => String(value) === String(second[index]));
}

function routeNetworkSelectionManifestDeclarations(manifest) {
  const junctions = (Array.isArray(manifest?.junctions) ? manifest.junctions : []).map(({
    nodeOrdinal,
    junctionKind,
  } = {}) => ({
    nodeOrdinal: Number.isFinite(Number(nodeOrdinal)) ? Number(nodeOrdinal) : null,
    junctionKind: String(junctionKind ?? ''),
  }));
  const roomLayouts = (
    Array.isArray(manifest?.roomLayouts) ? manifest.roomLayouts : []
  ).map(({
    nodeOrdinal,
    grammarId,
    contentRole,
    topologyKit,
  } = {}) => ({
    nodeOrdinal: Number.isFinite(Number(nodeOrdinal)) ? Number(nodeOrdinal) : null,
    grammarId: String(grammarId ?? ''),
    contentRole: String(contentRole ?? ''),
    topologyKit: topologyKit === true,
  }));
  const encounters = (
    Array.isArray(manifest?.encounters) ? manifest.encounters : []
  ).map(({
    nodeOrdinal,
    encounterProfileId,
  } = {}) => ({
    nodeOrdinal: Number.isFinite(Number(nodeOrdinal)) ? Number(nodeOrdinal) : null,
    encounterProfileId: String(encounterProfileId ?? ''),
  }));
  const topologyTemplateId = String(manifest?.topology?.id ?? '');
  const elevationMode = String(manifest?.elevation?.id ?? '');
  return {
    topologyTemplateId,
    elevationMode,
    junctions,
    roomLayouts,
    encounters,
    selectedIdsByFamily: {
      topology: topologyTemplateId ? [topologyTemplateId] : [],
      elevation: elevationMode ? [elevationMode] : [],
      junction: junctions.map(({ junctionKind }) => junctionKind).filter(Boolean),
      roomLayout: roomLayouts.map(({ grammarId }) => grammarId).filter(Boolean),
      encounter: encounters
        .map(({ encounterProfileId }) => encounterProfileId)
        .filter(Boolean),
    },
  };
}

function validateV4RouteNetworkSelectionManifest(operation, nodeById, errors) {
  if (!Object.hasOwn(operation ?? {}, 'selectionManifest')) return;
  const operationId = operation?.id ?? null;
  const manifest = operation?.selectionManifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    errors.push(diagnostic(
      'route-network-selection-manifest-schema-invalid',
      `Route network ${operationId} has a malformed selection manifest.`,
      { operationId, actualSchema: manifest?.schema ?? null },
    ));
    return;
  }
  if (manifest.schema !== ROUTE_NETWORK_SELECTION_MANIFEST_SCHEMA) {
    errors.push(diagnostic(
      'route-network-selection-manifest-schema-invalid',
      `Route network ${operationId} uses an unsupported selection-manifest schema.`,
      {
        operationId,
        expectedSchema: ROUTE_NETWORK_SELECTION_MANIFEST_SCHEMA,
        actualSchema: manifest.schema ?? null,
      },
    ));
  }

  const declarations = routeNetworkSelectionManifestDeclarations(manifest);
  if (declarations.topologyTemplateId !== String(operation?.topologyTemplateId ?? '')) {
    errors.push(diagnostic(
      'route-network-selection-manifest-topology-identity-mismatch',
      `Route network ${operationId} changes its selected topology identity.`,
      {
        operationId,
        manifestTopologyTemplateId: declarations.topologyTemplateId || null,
        operationTopologyTemplateId: operation?.topologyTemplateId ?? null,
      },
    ));
  }
  const operationElevationModes = stringArray(operation?.elevationModes);
  if (operationElevationModes.length !== 1
    || declarations.elevationMode !== operationElevationModes[0]) {
    errors.push(diagnostic(
      'route-network-selection-manifest-elevation-identity-mismatch',
      `Route network ${operationId} changes its selected elevation identity.`,
      {
        operationId,
        manifestElevationMode: declarations.elevationMode || null,
        operationElevationModes,
      },
    ));
  }

  const operationNodes = [...new Set([
    ...stringArray(operation?.nodeIds),
    ...[...nodeById.values()]
      .filter((node) => String(node?.operationId ?? '') === String(operationId ?? ''))
      .map(({ id }) => String(id)),
  ])].map((nodeId) => nodeById.get(nodeId)).filter(Boolean)
    .sort((first, second) => Number(first.ordinal) - Number(second.ordinal));
  const declaredNodeOrdinalById = new Map(stringArray(operation?.nodeIds).map(
    (nodeId, ordinal) => [nodeId, ordinal],
  ));
  const manifestNodeOrdinal = (node) => (
    Number.isFinite(Number(node?.ordinal))
      ? Number(node.ordinal)
      : Number(declaredNodeOrdinalById.get(String(node?.id ?? '')) ?? -1)
  );
  const actualRoomLayouts = operationNodes
    .filter((node) => String(node?.kind ?? '') === 'supplementRoom')
    .map((node) => ({
      nodeOrdinal: manifestNodeOrdinal(node),
      grammarId: String(node.grammarId ?? ''),
      contentRole: String(node.contentRole ?? ''),
      topologyKit: String(
        node.selectionConstraints?.routeNetworkTopologyTemplateId ?? '',
      ) === declarations.topologyTemplateId,
    }));
  if (canonicalStringify(actualRoomLayouts) !== canonicalStringify(declarations.roomLayouts)) {
    errors.push(diagnostic(
      'route-network-selection-manifest-room-layout-mismatch',
      `Route network ${operationId} has room-layout declarations that differ from its accepted nodes.`,
      { operationId, expected: actualRoomLayouts, actual: declarations.roomLayouts },
    ));
  }
  const actualEncounters = operationNodes.flatMap((node) => {
    const profiles = [...new Set((node.anchors ?? [])
      .filter(({ kind }) => kind === 'encounter')
      .map(({ encounterProfileId }) => String(
        encounterProfileId ?? 'supplement-route-network-defense',
      ))
      .filter(Boolean))];
    return profiles.map((encounterProfileId) => ({
      nodeOrdinal: manifestNodeOrdinal(node),
      encounterProfileId,
    }));
  });
  if (canonicalStringify(actualEncounters) !== canonicalStringify(declarations.encounters)) {
    errors.push(diagnostic(
      'route-network-selection-manifest-encounter-mismatch',
      `Route network ${operationId} has encounter declarations that differ from its accepted nodes.`,
      { operationId, expected: actualEncounters, actual: declarations.encounters },
    ));
  }

  const normalizedSemanticSignature = canonicalStringify({
    topologyTemplateId: declarations.topologyTemplateId,
    elevationMode: declarations.elevationMode,
    junctions: declarations.junctions,
    roomLayouts: declarations.roomLayouts,
    encounters: declarations.encounters,
  });
  if (String(manifest.normalizedSemanticSignature ?? '') !== normalizedSemanticSignature
    || String(operation?.normalizedSemanticSignature ?? '') !== normalizedSemanticSignature) {
    errors.push(diagnostic(
      'route-network-selection-manifest-normalized-signature-mismatch',
      `Route network ${operationId} does not preserve its normalized semantic signature.`,
      {
        operationId,
        expectedNormalizedSemanticSignature: normalizedSemanticSignature,
        manifestNormalizedSemanticSignature: manifest.normalizedSemanticSignature ?? null,
        operationNormalizedSemanticSignature: operation?.normalizedSemanticSignature ?? null,
      },
    ));
  }

  const bagWitnesses = manifest.bagWitnesses;
  const witnessFamilies = bagWitnesses
    && typeof bagWitnesses === 'object'
    && !Array.isArray(bagWitnesses)
    ? Object.keys(bagWitnesses)
    : [];
  const unknownFamilies = witnessFamilies.filter((family) => (
    !DUNGEON_SELECTION_BAG_FAMILIES.includes(family)
  ));
  if (unknownFamilies.length > 0) {
    errors.push(diagnostic(
      'route-network-selection-manifest-bag-witness-family-invalid',
      `Route network ${operationId} declares unknown selection-bag witness families.`,
      { operationId, unknownFamilies: unknownFamilies.sort() },
    ));
  }
  for (const family of DUNGEON_SELECTION_BAG_FAMILIES) {
    const witnesses = bagWitnesses?.[family];
    const expectedSelectedIds = declarations.selectedIdsByFamily[family];
    const validation = validateDungeonSelectionBagWitnessSequence(witnesses, {
      family,
      // A family is explicit in every manifest, but some networks have no
      // compatible decision for it (for example, a mechanism-only challenge
      // has no encounter node).  Requiring a fabricated selection would
      // consume the global bag without an owning runtime record.  Non-empty
      // witnesses remain mandatory whenever the manifest actually declares
      // one or more selections.
      requireNonEmpty: expectedSelectedIds.length > 0,
    });
    if (!validation.accepted) {
      errors.push(diagnostic(
        'route-network-selection-manifest-bag-witness-invalid',
        `Route network ${operationId} has an invalid ${family} selection-bag witness sequence.`,
        {
          operationId,
          family,
          witnessErrorCodes: validation.errors.map(({ code }) => code),
          witnessErrors: validation.errors,
        },
      ));
    }
    const actualSelectedIds = (Array.isArray(witnesses) ? witnesses : [])
      .map(({ selectedId } = {}) => String(selectedId ?? ''));
    if (!sameStringSequence(actualSelectedIds, expectedSelectedIds)) {
      errors.push(diagnostic(
        'route-network-selection-manifest-witness-selection-mismatch',
        `Route network ${operationId} has ${family} witness selections that differ from its manifest.`,
        {
          operationId,
          family,
          expectedSelectedIds,
          actualSelectedIds,
        },
      ));
    }
  }
}

function isV4AugmentationPlan(plan, profile) {
  return Number(profile?.revision ?? 0) >= 4
    || /(?:^|-)v4$/i.test(String(profile?.id ?? plan?.profileId ?? ''));
}

function routeNetworkGrantsById(extensionRegions, errors) {
  const records = new Map();
  for (const region of extensionRegions) {
    for (const grant of region?.routeNetworkGrants ?? []) {
      if (!grant?.id) {
        errors.push(diagnostic(
          'route-network-grant-id-missing',
          `Extension region ${region?.id} contains a route-network grant without an ID.`,
          { parentRegionId: region?.id ?? null },
        ));
        continue;
      }
      if (records.has(String(grant.id))) {
        errors.push(diagnostic(
          'route-network-grant-id-duplicate',
          `Route-network grant ${grant.id} is duplicated.`,
          { grantId: grant.id },
        ));
        continue;
      }
      records.set(String(grant.id), { grant, region });
    }
  }
  return records;
}

function socketIdOf(endpoint) {
  return String(endpoint?.socketId ?? endpoint?.id ?? '');
}

function endpointMatchesGrantedSocket(endpoint, socket) {
  return socketIdOf(endpoint) === String(socket?.id ?? '')
    && String(endpoint?.nodeId ?? '') === String(socket?.nodeId ?? '')
    && finitePoint(endpoint?.position)
    && finitePoint(socket?.position)
    && dungeonPointDistance(endpoint.position, socket.position) <= 1e-4
    && (!finitePoint(endpoint?.facing)
      || !finitePoint(socket?.facing)
      || dungeonPointDistance(endpoint.facing, socket.facing) <= 1e-4);
}

function exactRouteNetworkEndpointSocket(
  operation,
  endpoint,
  nodeById,
  extensionRegions,
) {
  const node = nodeById.get(String(endpoint?.nodeId ?? ''));
  if (node?.operationId === operation?.id) {
    return (node.sockets ?? []).find((socket) => (
      String(socket?.id ?? '') === socketIdOf(endpoint)
    )) ?? null;
  }
  const region = extensionRegions.find(({ id }) => (
    String(id) === String(operation?.parentRegionId ?? '')
  ));
  const grant = (region?.routeNetworkGrants ?? []).find(({ id }) => (
    String(id) === String(operation?.grantId ?? '')
  ));
  return (grant?.endpointSockets ?? []).find((socket) => (
    String(socket?.id ?? '') === socketIdOf(endpoint)
      && String(socket?.nodeId ?? '') === String(endpoint?.nodeId ?? '')
  )) ?? null;
}

function normalizedHorizontalFacing(facing) {
  if (!finitePoint(facing)) return null;
  const x = Number(facing.x);
  const z = Number(facing.z);
  const length = Math.hypot(x, z);
  if (length <= ROUTE_WITNESS_TOLERANCE) return null;
  return { x: x / length, z: z / length };
}

function alignedHorizontalApproach(path, facing, reverse = false) {
  const direction = normalizedHorizontalFacing(facing);
  if (!direction || !Array.isArray(path) || path.length < 2) {
    return { accepted: false, lengthMeters: 0, reason: 'missing-facing-or-path' };
  }
  const points = reverse ? [...path].reverse() : path;
  let lengthMeters = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const deltaX = Number(end.x) - Number(start.x);
    const deltaY = Number(end.y) - Number(start.y);
    const deltaZ = Number(end.z) - Number(start.z);
    const horizontalLength = Math.hypot(deltaX, deltaZ);
    if (Math.abs(deltaY) > ROUTE_WITNESS_TOLERANCE
      || horizontalLength <= ROUTE_WITNESS_TOLERANCE) {
      return { accepted: false, lengthMeters, reason: 'approach-not-flat' };
    }
    const projection = deltaX * direction.x + deltaZ * direction.z;
    const lateral = Math.abs(deltaX * direction.z - deltaZ * direction.x);
    if (projection <= ROUTE_WITNESS_TOLERANCE
      || lateral > ROUTE_WITNESS_TOLERANCE * Math.max(1, horizontalLength)) {
      return { accepted: false, lengthMeters, reason: 'approach-facing-mismatch' };
    }
    lengthMeters += horizontalLength;
    if (lengthMeters >= V4_ROUTE_SOCKET_APPROACH_METERS - ROUTE_WITNESS_TOLERANCE) {
      return { accepted: true, lengthMeters, reason: null };
    }
  }
  return { accepted: false, lengthMeters, reason: 'approach-too-short' };
}

function nodeLocalSocketApproachWitness({
  segment,
  endpoint,
  endpointIndex,
  socket,
  nodeById,
}) {
  const witness = segment?.localApproachWitnesses?.[endpointIndex] ?? null;
  if (!witness) return { present: false, accepted: false, reason: 'missing' };
  const node = nodeById.get(String(endpoint?.nodeId ?? ''));
  const parentSocketWitness = !node && endpoint?.kind === 'parentSocket';
  const authoredSupplementNode = Boolean(node)
    && String(node.operationId ?? '') === String(segment?.operationId ?? '')
    && (Boolean(node.blueprintId) || node.connectorOwned === true);
  if (!parentSocketWitness && !authoredSupplementNode) {
    return { present: true, accepted: false, reason: 'approach-owner-invalid' };
  }
  const path = witness?.path;
  const expectedStart = finitePoint(socket?.position) && finitePoint(socket?.facing)
    ? {
      x: Number(socket.position.x)
        - Number(socket.facing.x) * V4_ROUTE_SOCKET_APPROACH_METERS,
      y: Number(socket.position.y),
      z: Number(socket.position.z)
        - Number(socket.facing.z) * V4_ROUTE_SOCKET_APPROACH_METERS,
    }
    : null;
  const identityMatches = String(witness?.nodeId ?? '') === String(
    node?.id ?? endpoint?.nodeId ?? '',
  )
    && String(witness?.socketId ?? '') === String(socket?.id ?? '')
    && String(witness?.localSocketId ?? '') === String(socket?.localSocketId ?? '');
  const pathMatches = expectedStart
    && Array.isArray(path)
    && path.length === 2
    && path.every(finitePoint)
    && dungeonPointDistance(path[0], expectedStart) <= ROUTE_WITNESS_TOLERANCE
    && dungeonPointDistance(path[1], socket.position) <= ROUTE_WITNESS_TOLERANCE
    && alignedHorizontalApproach(path, socket.facing).accepted;
  // Parent sockets are issued only after the host proves a clear authored
  // corridor approach. Supplemental sockets prove the same contract against
  // the exact occupied mask stamped from their blueprint.
  const containedByNode = parentSocketWitness || (pathMatches && path.every((point) => (
    (node.occupiedVolumes ?? []).some((volume) => pointWithinVolume(point, volume))
  )));
  return {
    present: true,
    accepted: Boolean(identityMatches && pathMatches && containedByNode),
    reason: !identityMatches
      ? 'identity-mismatch'
      : !pathMatches
        ? 'path-mismatch'
        : !containedByNode ? 'outside-node-core' : null,
  };
}

function routeNetworkGrantForOperation(operation, extensionRegions) {
  const region = (extensionRegions ?? []).find(({ id }) => (
    String(id ?? '') === String(operation?.parentRegionId ?? '')
  ));
  return (region?.routeNetworkGrants ?? []).find(({ id }) => (
    String(id ?? '') === String(operation?.grantId ?? '')
  )) ?? null;
}

function isSharedJunctionThresholdSegment(segment) {
  return segment?.sharedEndpointFootprint?.kind === 'shared-junction-threshold';
}

function validateSharedJunctionThresholdSegment({
  segment,
  operation,
  nodeById,
  extensionRegions,
  errors,
}) {
  const reject = (reason, context = {}) => {
    errors.push(diagnostic(
      'route-network-shared-threshold-invalid',
      `Route-network segment ${segment?.id} has an invalid shared-junction threshold.`,
      {
        operationId: operation?.id ?? null,
        segmentId: segment?.id ?? null,
        reason,
        ...context,
      },
    ));
    return false;
  };
  const footprint = segment?.sharedEndpointFootprint;
  const grant = routeNetworkGrantForOperation(operation, extensionRegions);
  if (operation?.type !== 'routeNetwork'
    || operation?.routeNetworkKind !== 'objective-route-coverage'
    || grant?.kind !== 'objective-route-coverage') {
    return reject('operation-kind-invalid');
  }
  if (!Array.isArray(segment?.path)
    || segment.path.length !== 2
    || !segment.path.every(finitePoint)
    || dungeonPointDistance(segment.path[0], segment.path[1]) > ROUTE_WITNESS_TOLERANCE
    || !finitePoint(segment?.from?.position)
    || !finitePoint(segment?.to?.position)
    || dungeonPointDistance(segment.from.position, segment.to.position)
      > ROUTE_WITNESS_TOLERANCE
    || dungeonPointDistance(segment.path[0], segment.from.position)
      > ROUTE_WITNESS_TOLERANCE
    || dungeonPointDistance(segment.path[1], segment.to.position)
      > ROUTE_WITNESS_TOLERANCE) {
    return reject('endpoints-not-coincident');
  }

  const endpointRecords = [segment.from, segment.to].map((endpoint) => {
    const node = nodeById.get(String(endpoint?.nodeId ?? ''));
    const socket = node?.sockets?.find((candidate) => (
      String(candidate?.id ?? '') === socketIdOf(endpoint)
    )) ?? null;
    return { endpoint, node, socket };
  });
  if (endpointRecords.some(({ endpoint, node }) => (
    endpoint?.kind !== 'supplementSocket'
      || !node
      || String(node.operationId ?? '') !== String(operation.id)
      || node.kind !== SUPPLEMENT_CONNECTOR_JUNCTION_NODE_KIND
      || node.connectorOwned !== true
      || node.exactParentEndpoint !== true
      || node.parentEndpointSocketKind !== 'authored-corridor-station'
      || Number(node.parentThroughRouteDegreeContribution ?? 0) !== 1
      || node?.junction?.junctionKind !== 'through-t'
  ))) {
    return reject('station-node-invalid');
  }
  if (endpointRecords.some(({ endpoint, socket }) => (
    !socket
      || socket.state !== 'connected'
      || String(socket.segmentId ?? '') !== String(segment.id ?? '')
      || String(socket.localSocketId ?? '') === 'entry'
      || String(endpoint.localSocketId ?? '') !== String(socket.localSocketId ?? '')
      || !finitePoint(socket.position)
      || dungeonPointDistance(endpoint.position, socket.position)
        > ROUTE_WITNESS_TOLERANCE
  ))) {
    return reject('socket-identity-mismatch');
  }
  if (String(endpointRecords[0].node.id) === String(endpointRecords[1].node.id)
    || String(endpointRecords[0].socket.id) === String(endpointRecords[1].socket.id)) {
    return reject('node-identity-mismatch');
  }

  const facings = endpointRecords.map(({ socket }) => normalizedHorizontalFacing(socket.facing));
  const cardinalFacing = (facing, rawFacing) => Boolean(
    facing
      && Math.abs(Number(rawFacing?.y ?? 0)) <= ROUTE_WITNESS_TOLERANCE
      && (
        (Math.abs(Math.abs(facing.x) - 1) <= ROUTE_WITNESS_TOLERANCE
          && Math.abs(facing.z) <= ROUTE_WITNESS_TOLERANCE)
        || (Math.abs(Math.abs(facing.z) - 1) <= ROUTE_WITNESS_TOLERANCE
          && Math.abs(facing.x) <= ROUTE_WITNESS_TOLERANCE)
      )
  );
  if (!cardinalFacing(facings[0], endpointRecords[0].socket.facing)
    || !cardinalFacing(facings[1], endpointRecords[1].socket.facing)
    || facings[0].x * facings[1].x + facings[0].z * facings[1].z
      > -1 + ROUTE_WITNESS_TOLERANCE) {
    return reject('facing-invalid');
  }

  if (!finitePoint(footprint?.center)
    || dungeonPointDistance(footprint.center, segment.from.position)
      > ROUTE_WITNESS_TOLERANCE) {
    return reject('center-mismatch');
  }
  const normalAlongX = Math.abs(facings[0].x) > 0.5;
  const expectedSize = {
    x: normalAlongX ? 2.8 : V4_ROUTE_CORRIDOR_WIDTH_METERS,
    y: 5.6,
    z: normalAlongX ? V4_ROUTE_CORRIDOR_WIDTH_METERS : 2.8,
  };
  if (!positiveSize(footprint?.size)
    || ['x', 'y', 'z'].some((axis) => (
      Math.abs(Number(footprint.size[axis]) - expectedSize[axis])
        > ROUTE_WITNESS_TOLERANCE
    ))) {
    return reject('size-invalid', { expectedSize });
  }
  if (!sameStringSequence(
    footprint?.nodeIds,
    endpointRecords.map(({ node }) => String(node.id)),
  )) {
    return reject('node-identity-mismatch');
  }
  if (!sameStringSequence(
    footprint?.socketIds,
    endpointRecords.map(({ socket }) => String(socket.id)),
  )) {
    return reject('socket-identity-mismatch');
  }

  if (!['occupiedVolumes', 'clearanceVolumes', 'landingVolumes'].every((field) => (
    Array.isArray(segment?.[field]) && segment[field].length === 0
  ))) {
    return reject('corridor-volume-present');
  }
  if (!Array.isArray(segment?.landings)
    || segment.landings.length !== 2
    || segment.landings.some(({ position }) => (
      !finitePoint(position)
        || dungeonPointDistance(position, footprint.center) > ROUTE_WITNESS_TOLERANCE
    ))) {
    return reject('landing-witness-invalid');
  }

  const witnesses = segment?.localApproachWitnesses;
  if (!Array.isArray(witnesses) || witnesses.length !== 2) {
    return reject('approach-witness-invalid');
  }
  for (let index = 0; index < endpointRecords.length; index += 1) {
    const { node, socket, endpoint } = endpointRecords[index];
    const localApproach = nodeLocalSocketApproachWitness({
      segment,
      endpoint,
      endpointIndex: index,
      socket,
      nodeById,
    });
    if (!localApproach.accepted) {
      return reject('approach-witness-invalid', {
        witnessIndex: index,
        nodeId: node.id,
        socketId: socket.id,
        witnessReason: localApproach.reason,
      });
    }
  }
  return true;
}

function routeWitnessLegVolume(start, end, legIndex) {
  const deltaX = Number(end.x) - Number(start.x);
  const deltaY = Number(end.y) - Number(start.y);
  const deltaZ = Number(end.z) - Number(start.z);
  const horizontalLength = Math.hypot(deltaX, deltaZ);
  const lengthMeters = Math.hypot(horizontalLength, deltaY);
  if (lengthMeters <= ROUTE_WITNESS_TOLERANCE) return null;
  const directionX = horizontalLength > ROUTE_WITNESS_TOLERANCE
    ? deltaX / horizontalLength
    : 0;
  const directionZ = horizontalLength > ROUTE_WITNESS_TOLERANCE
    ? deltaZ / horizontalLength
    : 0;
  const size = {
    x: horizontalLength > ROUTE_WITNESS_TOLERANCE
      ? Math.abs(deltaX) + V4_ROUTE_CORRIDOR_WIDTH_METERS * Math.abs(directionZ)
      : V4_ROUTE_CORRIDOR_WIDTH_METERS,
    y: V4_ROUTE_CLEARANCE_HEIGHT_METERS + Math.abs(deltaY),
    z: horizontalLength > ROUTE_WITNESS_TOLERANCE
      ? Math.abs(deltaZ) + V4_ROUTE_CORRIDOR_WIDTH_METERS * Math.abs(directionX)
      : V4_ROUTE_CORRIDOR_WIDTH_METERS,
  };
  return {
    id: `route-witness-leg:${legIndex}`,
    center: {
      x: (Number(start.x) + Number(end.x)) * 0.5,
      y: Math.min(Number(start.y), Number(end.y)) + size.y * 0.5,
      z: (Number(start.z) + Number(end.z)) * 0.5,
    },
    size,
    delta: { x: deltaX, y: deltaY, z: deltaZ },
    horizontalLength,
    legIndex,
  };
}

function routeWitnessSelfIntersection(path) {
  const legs = path.slice(1).map((end, index) => (
    routeWitnessLegVolume(path[index], end, index)
  )).filter(Boolean);
  for (let index = 1; index < legs.length; index += 1) {
    const previous = legs[index - 1];
    const current = legs[index];
    if (previous.horizontalLength <= ROUTE_WITNESS_TOLERANCE
      || current.horizontalLength <= ROUTE_WITNESS_TOLERANCE) continue;
    const dot = previous.delta.x * current.delta.x
      + previous.delta.z * current.delta.z;
    const cross = previous.delta.x * current.delta.z
      - previous.delta.z * current.delta.x;
    if (dot < -ROUTE_WITNESS_TOLERANCE
      && Math.abs(cross) <= ROUTE_WITNESS_TOLERANCE
        * Math.max(1, previous.horizontalLength * current.horizontalLength)) {
      return {
        reason: 'adjacent-backtracking',
        firstLegIndex: previous.legIndex,
        secondLegIndex: current.legIndex,
      };
    }
  }
  for (let first = 0; first < legs.length; first += 1) {
    for (let second = first + 2; second < legs.length; second += 1) {
      if (!dungeonVolumesOverlap(legs[first], legs[second])) continue;
      return {
        reason: 'non-adjacent-self-overlap',
        firstLegIndex: legs[first].legIndex,
        secondLegIndex: legs[second].legIndex,
      };
    }
  }
  return null;
}

function projectedHorizontalRoute(path) {
  const projected = [];
  for (const point of path) {
    const candidate = { x: Number(point.x), z: Number(point.z) };
    const previous = projected.at(-1);
    if (!previous || Math.hypot(
      candidate.x - previous.x,
      candidate.z - previous.z,
    ) > ROUTE_WITNESS_TOLERANCE) projected.push(candidate);
  }
  return projected;
}

function longestHorizontalRouteRun(path) {
  const projected = projectedHorizontalRoute(path);
  let maximumRunMeters = 0;
  let current = null;
  for (let index = 1; index < projected.length; index += 1) {
    const start = projected[index - 1];
    const end = projected[index];
    const deltaX = end.x - start.x;
    const deltaZ = end.z - start.z;
    const lengthMeters = Math.hypot(deltaX, deltaZ);
    if (lengthMeters <= ROUTE_WITNESS_TOLERANCE) continue;
    const direction = { x: deltaX / lengthMeters, z: deltaZ / lengthMeters };
    const continues = current
      && current.direction.x * direction.x + current.direction.z * direction.z
        >= 1 - ROUTE_WITNESS_TOLERANCE
      && Math.abs(
        current.direction.x * direction.z - current.direction.z * direction.x,
      ) <= ROUTE_WITNESS_TOLERANCE;
    current = continues
      ? { direction: current.direction, lengthMeters: current.lengthMeters + lengthMeters }
      : { direction, lengthMeters };
    maximumRunMeters = Math.max(maximumRunMeters, current.lengthMeters);
  }
  return {
    maximumRunMeters,
    footprint: projected.length >= 2 ? {
      x: Math.max(...projected.map(({ x }) => x))
        - Math.min(...projected.map(({ x }) => x))
        + V4_ROUTE_CORRIDOR_WIDTH_METERS,
      z: Math.max(...projected.map(({ z }) => z))
        - Math.min(...projected.map(({ z }) => z))
        + V4_ROUTE_CORRIDOR_WIDTH_METERS,
    } : null,
  };
}

function validateV4RouteEndpointSeams({
  segment,
  operation,
  nodeById,
  extensionRegions,
  errors,
}) {
  if (!Array.isArray(segment?.endpointSeams) || segment.endpointSeams.length !== 2) {
    errors.push(diagnostic(
      'route-network-endpoint-seam-record-invalid',
      `Route-network segment ${segment?.id} does not own exactly two endpoint seams.`,
      {
        operationId: operation?.id ?? null,
        segmentId: segment?.id ?? null,
        endpointSeamCount: Array.isArray(segment?.endpointSeams)
          ? segment.endpointSeams.length
          : null,
      },
    ));
    return;
  }
  const grant = routeNetworkGrantForOperation(operation, extensionRegions);
  const landingOverlapBySocketId = new Map(
    (grant?.socketLandingOverlapGrants ?? []).map((overlap) => (
      [String(overlap.socketId ?? ''), overlap]
    )),
  );
  for (const [endpointIndex, endpoint] of [segment.from, segment.to].entries()) {
    const role = endpointIndex === 0 ? 'from' : 'to';
    const exactSocket = exactRouteNetworkEndpointSocket(
      operation,
      endpoint,
      nodeById,
      extensionRegions,
    );
    if (!exactSocket) continue;
    const node = nodeById.get(String(endpoint?.nodeId ?? ''));
    // Exact connector stations inherit the host socket's physical owner even
    // though the segment terminates at a supplemental socket. Reconstruct the
    // same inherited owner used by planning; otherwise strict validation
    // mistakes the destination seam for a malformed record and then rejects
    // every legitimate base-floor intersection inside it.
    const inheritedStationOverlap = node?.exactParentEndpoint === true
      && node?.parentEndpointSocketKind === 'authored-corridor-station'
      ? landingOverlapBySocketId.get(String(node.parentEndpointSocketId ?? ''))
      : null;
    const parentOverlap = landingOverlapBySocketId.get(socketIdOf(endpoint))
      ?? inheritedStationOverlap;
    const expected = createDungeonRouteEndpointSeam(exactSocket, {
      id: `${segment.id}:${role}-endpoint-seam`,
      segmentId: segment.id,
      operationId: operation.id,
      networkId: operation.id,
      nodeId: endpoint?.nodeId ?? node?.id ?? null,
      socketId: socketIdOf(endpoint),
      localSocketId: exactSocket.localSocketId ?? endpoint?.localSocketId ?? null,
      role,
      elevationBand: node?.progressionBandId ?? operation?.progressionBandId ?? null,
      parentOwnerId: parentOverlap?.parentOwnerId ?? null,
    });
    const actual = segment.endpointSeams[endpointIndex];
    const identityMatches = actual?.schema === expected.schema
      && String(actual?.id ?? '') === expected.id
      && String(actual?.segmentId ?? '') === String(segment.id)
      && String(actual?.operationId ?? '') === String(operation.id)
      && String(actual?.networkId ?? '') === String(operation.id)
      && String(actual?.nodeId ?? '') === String(endpoint?.nodeId ?? '')
      && String(actual?.socketId ?? '') === socketIdOf(endpoint)
      && String(actual?.localSocketId ?? '') === String(
        exactSocket.localSocketId ?? endpoint?.localSocketId ?? '',
      )
      && actual?.role === role;
    if (!identityMatches) {
      errors.push(diagnostic(
        'route-network-endpoint-seam-identity-mismatch',
        `Route-network segment ${segment.id} changes its ${role} endpoint seam identity.`,
        {
          operationId: operation.id,
          segmentId: segment.id,
          role,
          expectedSeamId: expected.id,
          actualSeamId: actual?.id ?? null,
          expectedNodeId: expected.nodeId,
          actualNodeId: actual?.nodeId ?? null,
          expectedSocketId: expected.socketId,
          actualSocketId: actual?.socketId ?? null,
        },
      ));
      continue;
    }
    const latticeInspection = inspectDungeonRouteEndpointSeamGridLattice(actual);
    if (!latticeInspection.accepted) {
      errors.push(diagnostic(
        DUNGEON_ROUTE_ENDPOINT_SEAM_GRID_LATTICE_DIAGNOSTIC,
        `Route-network segment ${segment.id} has a non-cardinal ${role} endpoint seam grid lattice.`,
        {
          operationId: operation.id,
          segmentId: segment.id,
          role,
          seamId: actual.id,
          ...latticeInspection,
        },
      ));
    }
    if (canonicalStringify(actual) !== canonicalStringify(expected)) {
      const mismatchedFields = [...new Set([
        ...Object.keys(expected),
        ...Object.keys(actual ?? {}),
      ])].filter((field) => (
        canonicalStringify(actual?.[field]) !== canonicalStringify(expected[field])
      ));
      errors.push(diagnostic(
        'route-network-endpoint-seam-record-invalid',
        `Route-network segment ${segment.id} has a malformed ${role} 3x5 endpoint seam.`,
        {
          operationId: operation.id,
          segmentId: segment.id,
          role,
          seamId: actual.id,
          expectedCellCount: 15,
          actualCellCount: Array.isArray(actual.orderedCells)
            ? actual.orderedCells.length
            : null,
          mismatchedFields,
          expectedParentOwnerId: expected.overlapEnvelope?.parentOwnerId ?? null,
          actualParentOwnerId: actual?.overlapEnvelope?.parentOwnerId ?? null,
        },
      ));
    }
  }
}

function validateV4RouteSegmentPhysicalWitness({
  segment,
  operation,
  nodeById,
  extensionRegions,
  errors,
}) {
  const path = segment.path;
  validateV4RouteEndpointSeams({
    segment,
    operation,
    nodeById,
    extensionRegions,
    errors,
  });
  if (segment?.localApproachWitnesses != null
    && (!Array.isArray(segment.localApproachWitnesses)
      || segment.localApproachWitnesses.length !== 2)) {
    errors.push(diagnostic(
      'route-network-local-approach-witnesses-invalid',
      `Route-network segment ${segment.id} has an incomplete node-local approach contract.`,
      { operationId: operation.id, segmentId: segment.id },
    ));
  }
  for (const [side, endpoint, reverse, endpointIndex] of [
    ['source', segment.from, false, 0],
    ['destination', segment.to, true, 1],
  ]) {
    const exactSocket = exactRouteNetworkEndpointSocket(
      operation,
      endpoint,
      nodeById,
      extensionRegions,
    );
    if (!exactSocket || !finitePoint(exactSocket.position) || !finitePoint(exactSocket.facing)) {
      errors.push(diagnostic(
        'route-network-segment-endpoint-socket-unresolved',
        `Route-network segment ${segment.id} has no exact ${side} socket witness.`,
        { operationId: operation.id, segmentId: segment.id, side, socketId: socketIdOf(endpoint) },
      ));
      continue;
    }
    if (!finitePoint(endpoint?.position)
      || dungeonPointDistance(endpoint.position, exactSocket.position)
        > ROUTE_WITNESS_TOLERANCE
      || (finitePoint(endpoint?.facing)
        && dungeonPointDistance(endpoint.facing, exactSocket.facing)
          > ROUTE_WITNESS_TOLERANCE)) {
      errors.push(diagnostic(
        'route-network-segment-endpoint-socket-mismatch',
        `Route-network segment ${segment.id} changes its exact ${side} socket transform.`,
        { operationId: operation.id, segmentId: segment.id, side, socketId: socketIdOf(endpoint) },
      ));
    }
    const approach = alignedHorizontalApproach(path, exactSocket.facing, reverse);
    const localApproach = nodeLocalSocketApproachWitness({
      segment,
      endpoint,
      endpointIndex,
      socket: exactSocket,
      nodeById,
    });
    if (!localApproach.accepted) {
      errors.push(diagnostic(
        'route-network-local-approach-witness-invalid',
        `Route-network segment ${segment.id} lacks a valid two-tile node-local ${side} approach.`,
        {
          operationId: operation.id,
          segmentId: segment.id,
          side,
          socketId: socketIdOf(endpoint),
          reason: localApproach.reason,
        },
      ));
    }
    if (!approach.accepted) {
      errors.push(diagnostic(
        'route-network-socket-approach-invalid',
        `Route-network segment ${segment.id} lacks a clear two-tile exterior ${side} approach.`,
        {
          operationId: operation.id,
          segmentId: segment.id,
          side,
          socketId: socketIdOf(endpoint),
          reason: approach.reason,
          localApproachReason: localApproach.reason,
          approachLengthMeters: approach.lengthMeters,
          minimumApproachMeters: V4_ROUTE_SOCKET_APPROACH_METERS,
        },
      ));
    }
  }

  const selfIntersection = routeWitnessSelfIntersection(path);
  if (selfIntersection) {
    errors.push(diagnostic(
      'route-network-segment-path-self-overlap',
      `Route-network segment ${segment.id} backtracks or overlaps its own corridor footprint.`,
      { operationId: operation.id, segmentId: segment.id, ...selfIntersection },
    ));
  }

  const connectorFamily = canonicalConnectorFamily(segment.connectorFamily);
  const minimumRunMeters = V4_VERTICAL_CONNECTOR_MINIMUM_RUN_METERS[connectorFamily];
  if (!Number.isFinite(minimumRunMeters)) return;
  const horizontal = longestHorizontalRouteRun(path);
  if (!horizontal.footprint
    || horizontal.footprint.x <= ROUTE_WITNESS_TOLERANCE
    || horizontal.footprint.z <= ROUTE_WITNESS_TOLERANCE) {
    errors.push(diagnostic(
      'route-network-vertical-connector-footprint-invalid',
      `Vertical connector ${segment.id} has no usable horizontal footprint.`,
      { operationId: operation.id, segmentId: segment.id, connectorFamily },
    ));
  }
  if (horizontal.maximumRunMeters < minimumRunMeters - ROUTE_WITNESS_TOLERANCE) {
    errors.push(diagnostic(
      'route-network-vertical-connector-run-too-short',
      `Vertical connector ${segment.id} does not provide its family minimum run.`,
      {
        operationId: operation.id,
        segmentId: segment.id,
        connectorFamily,
        horizontalRunMeters: horizontal.maximumRunMeters,
        minimumHorizontalRunMeters: minimumRunMeters,
      },
    ));
  }
}

function operationOwnedNodes(operation, nodeById) {
  const declared = new Set(stringArray(operation?.nodeIds));
  for (const node of nodeById.values()) {
    if (node?.operationId === operation?.id) declared.add(String(node.id));
  }
  return declared;
}

function operationOwnedSegments(operation, segmentById) {
  const declared = new Set(stringArray(operation?.segmentIds));
  for (const segment of segmentById.values()) {
    if (segment?.operationId === operation?.id) declared.add(String(segment.id));
  }
  return declared;
}

function nodeContentTokens(node) {
  return [
    node?.contentRole,
    node?.role,
    node?.purpose,
    ...(node?.tags ?? []),
    ...(node?.anchors ?? []).map((anchor) => anchor?.kind ?? anchor?.role),
  ].map(normalizedFeatureToken).filter(Boolean);
}

function nodeProvidesChallenge(node) {
  return nodeContentTokens(node).some((token) => tokenMatchesAny(token, [
    'challenge', 'encounter', 'enemyspawn', 'trap', 'hazard', 'mechanism',
  ]));
}

function nodeProvidesReward(node) {
  return nodeContentTokens(node).some((token) => tokenMatchesAny(token, [
    'reward', 'treasure', 'chest', 'payoff',
  ]));
}

function nodeProvidesHostedGameplayContent(node) {
  return nodeProvidesChallenge(node)
    || nodeProvidesReward(node)
    || nodeContentTokens(node).some((token) => tokenMatchesAny(token, [
      'objective', 'progression', 'keycard', 'credential',
    ]));
}

function nodeProvidesElevation(node) {
  const tokens = nodeContentTokens(node);
  if (tokens.some((token) => tokenMatchesAny(token, [
    'elevation', 'platform', 'catwalk', 'split-level', 'lift', 'ladder', 'slope', 'ramp',
  ]))) return true;
  const structure = node?.structure ?? {};
  return recordsAt(structure, [
    'ramps', 'ladders', 'lifts', 'elevationTransfers', 'verticalConnectors',
    'platforms', 'catwalks',
  ]).length > 0;
}

function nodeProvidesCompleteElevation(node, incidentSegments = []) {
  const structure = node?.structure ?? {};
  const completeLocalTraversal = recordsAt(structure, [
    'ramps', 'ladders', 'lifts', 'elevationTransfers', 'verticalConnectors',
  ]).length > 0;
  const platformWithAccess = recordsAt(structure, ['platforms', 'catwalks']).length > 0
    && recordsAt(structure, ['ramps', 'ladders', 'lifts']).length > 0;
  const completeExternalTraversal = incidentSegments.some((segment) => (
    segment?.verticalTransfer === true
      && Array.isArray(segment?.path)
      && segment.path.length >= 2
      && Number.isFinite(Number(segment?.elevationDelta))
      && Math.abs(Number(segment.elevationDelta)) > 1e-6
  ));
  return completeLocalTraversal || platformWithAccess || completeExternalTraversal;
}

function nodeIsSupplementRoom(node) {
  return node?.kind === SUPPLEMENT_ROOM_NODE_KIND;
}

function nodeIsSupplementConnectorModule(node) {
  return node?.kind === SUPPLEMENT_CONNECTOR_MODULE_NODE_KIND;
}

function nodeIsSupplementConnectorJunction(node) {
  return node?.kind === SUPPLEMENT_CONNECTOR_JUNCTION_NODE_KIND;
}

function routeNetworkPhysicalGraphDegree(node, graphAdjacency, nodeId = node?.id) {
  const connectedOverlayArms = graphAdjacency.get(String(nodeId))?.length ?? 0;
  const parentThroughContribution = node?.exactParentEndpoint === true
    && node?.parentEndpointSocketKind === 'authored-corridor-station'
    ? Math.min(1, Math.max(0, Number(node?.parentThroughRouteDegreeContribution ?? 0)))
    : 0;
  return connectedOverlayArms + parentThroughContribution;
}

function nodeIsPlainConnector(node) {
  // Degree-two connector modules are useful physical traversal but never
  // count toward the 3-6 substantive-module budget or reset coverage.
  if (nodeIsSupplementConnectorModule(node)) return true;
  if (nodeIsSupplementRoom(node) || nodeIsSupplementConnectorJunction(node)) {
    return false;
  }
  if (node?.substantive === false) return true;
  const role = normalizedFeatureToken(node?.contentRole ?? node?.role ?? node?.purpose);
  return tokenMatchesAny(role, ['cap', 'plainconnector', 'corridorsegment', 'emptybay'])
    && !nodeProvidesChallenge(node)
    && !nodeProvidesReward(node)
    && !nodeProvidesElevation(node);
}

function nodeCountsAsSubstantiveRouteModule(node, degree) {
  if (nodeIsSupplementConnectorJunction(node)) {
    return degree >= 3 && node?.junction?.countsAsMeaningfulStation === true;
  }
  if (!nodeIsSupplementRoom(node)) return false;
  if (node?.substantive === false || nodeIsPlainConnector(node)) return false;
  return nodeProvidesChallenge(node)
    || nodeProvidesReward(node)
    || nodeProvidesElevation(node)
    || normalizedFeatureToken(node?.contentRole) === 'discovery'
    || normalizedFeatureToken(node?.contentRole) === 'calm';
}

function forbiddenV4CompactConnectorReasons(node) {
  const reasons = new Set();
  if (nodeIsSupplementConnectorModule(node)) reasons.add('supplement-connector-module-kind');
  if (node?.isSupplementConnectorModule === true) reasons.add('supplement-connector-module-flag');
  if (node?.connectorOwned === true) reasons.add('connector-owned');
  if (node?.connectorInfrastructure === true) reasons.add('connector-infrastructure');
  if (node?.substantive === false) reasons.add('non-substantive');
  if (normalizedFeatureToken(node?.moduleKind) === 'connectormodule') {
    reasons.add('connector-module-kind');
  }
  const descriptorTokens = [
    node?.kind,
    node?.nodeKind,
    node?.nodeRole,
    node?.layoutRole,
    node?.moduleKind,
    node?.role,
    node?.purpose,
    node?.contentRole,
    node?.grammarId,
    node?.junction?.junctionKind,
  ].map(normalizedFeatureToken).filter(Boolean);
  for (const token of descriptorTokens) {
    if (tokenMatchesAny(token, ['endpointvestibule', 'corridorvestibule'])) {
      reasons.add('endpoint-vestibule');
    }
    if (tokenMatchesAny(token, ['connectormodule', 'connectorowned', 'routeconnector'])) {
      reasons.add('connector-module-descriptor');
    }
    if (['cap', 'plainconnector', 'corridorsegment', 'emptybay'].includes(token)) {
      reasons.add('plain-connector');
    }
  }
  if (nodeIsPlainConnector(node)) reasons.add('plain-connector');
  return [...reasons].sort();
}

function pointWithinVolume(point, volume, tolerance = 1e-4) {
  if (!finitePoint(point) || !finitePoint(volume?.center) || !positiveSize(volume?.size)) {
    return false;
  }
  return ['x', 'y', 'z'].every((axis) => (
    Math.abs(Number(point[axis]) - Number(volume.center[axis]))
      <= Number(volume.size[axis]) * 0.5 + tolerance
  ));
}

function validateJunctionContract(node, degree, errors, operationId) {
  const junction = node?.junction;
  if (!junction || !junction.junctionKind) return false;
  if (degree < 3) {
    errors.push(diagnostic(
      'route-network-junction-not-active',
      `Junction ${node.id} declares ${junction.junctionKind} but has only ${degree} active routes.`,
      { operationId, nodeId: node.id, junctionKind: junction.junctionKind, activeDegree: degree },
    ));
    return false;
  }
  if (junction.countsAsMeaningfulStation !== true) {
    errors.push(diagnostic(
      'route-network-junction-not-meaningful',
      `Junction ${node.id} is not marked as a meaningful station.`,
      { operationId, nodeId: node.id },
    ));
  }
  if (!finitePoint(junction?.clearCoreVolume?.center)
    || !positiveSize(junction?.clearCoreVolume?.size)) {
    errors.push(diagnostic(
      'route-network-junction-clear-core-invalid',
      `Junction ${node.id} lacks a valid clear-core volume.`,
      { operationId, nodeId: node.id },
    ));
  }
  const connectedSocketIds = new Set((node?.sockets ?? [])
    .filter((socket) => socket?.state === 'connected')
    .map((socket) => String(socket.id)));
  if (node?.exactParentEndpoint === true
    && node?.parentEndpointSocketKind === 'authored-corridor-station'
    && Number(node?.parentThroughRouteDegreeContribution ?? 0) === 1
    && node?.parentThroughPhysicalArmId) {
    connectedSocketIds.add(String(node.parentThroughPhysicalArmId));
  }
  const decisionSocketIds = sortedUniqueStrings(junction?.decisionSocketIds);
  const throughSocketPairs = Array.isArray(junction?.throughSocketPairs)
    ? junction.throughSocketPairs
    : [];
  if (decisionSocketIds.length === 0
    || decisionSocketIds.some((socketId) => !connectedSocketIds.has(socketId))) {
    errors.push(diagnostic(
      'route-network-junction-decision-sockets-invalid',
      `Junction ${node.id} does not expose an active decision socket.`,
      { operationId, nodeId: node.id, decisionSocketIds },
    ));
  }
  if (throughSocketPairs.length === 0 || throughSocketPairs.some((pair) => (
    !Array.isArray(pair)
      || pair.length !== 2
      || pair.some((socketId) => !connectedSocketIds.has(String(socketId)))
  ))) {
    errors.push(diagnostic(
      'route-network-junction-through-pairs-invalid',
      `Junction ${node.id} has no valid active through-socket pair.`,
      { operationId, nodeId: node.id },
    ));
  }
  if (finitePoint(junction?.clearCoreVolume?.center)
    && positiveSize(junction?.clearCoreVolume?.size)) {
    for (const anchor of node?.anchors ?? []) {
      const token = normalizedFeatureToken(anchor?.kind ?? anchor?.role);
      if (tokenMatchesAny(token, ['hazard', 'trap', 'gate', 'prop', 'support'])
        && pointWithinVolume(anchor?.position ?? anchor?.worldPosition, junction.clearCoreVolume)) {
        errors.push(diagnostic(
          'route-network-junction-clear-core-obstructed',
          `Junction ${node.id} places ${anchor.id ?? token} inside its clear core.`,
          { operationId, nodeId: node.id, anchorId: anchor?.id ?? null },
        ));
      }
    }
  }
  return true;
}

function spanLengthMeters(span) {
  if (Array.isArray(span?.path) && span.path.length >= 2 && span.path.every(finitePoint)) {
    return measureDungeonPolyline(span.path);
  }
  const value = typeof span === 'number'
    ? span
    : span?.lengthMeters ?? span?.distanceMeters ?? span?.measuredLengthMeters;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateDeclaredFeaturelessSpans(operation, grant, maximum, errors) {
  const spans = Array.isArray(operation?.featurelessSpans)
    ? operation.featurelessSpans
    : [];
  if (spans.length === 0) {
    errors.push(diagnostic(
      'route-network-featureless-spans-missing',
      `Route network ${operation.id} does not declare its effective featureless spans.`,
      { operationId: operation.id, grantId: grant?.id ?? null },
    ));
  }
  for (const [spanIndex, span] of spans.entries()) {
    const lengthMeters = spanLengthMeters(span);
    if (!Number.isFinite(lengthMeters) || lengthMeters < 0) {
      errors.push(diagnostic(
        'route-network-featureless-span-invalid',
        `Route network ${operation.id} has an invalid featureless span.`,
        { operationId: operation.id, spanIndex },
      ));
    } else if (lengthMeters > maximum + 1e-4) {
      errors.push(diagnostic(
        'route-network-featureless-span-exceeded',
        `Route network ${operation.id} contains ${lengthMeters}m without a meaningful station.`,
        { operationId: operation.id, spanIndex, lengthMeters, maximumFeaturelessSpanMeters: maximum },
      ));
    }
  }

  const coverage = grant?.coverage;
  if (!coverage) return;
  const pathLengthMeters = Number(coverage.pathLengthMeters);
  const stationDistances = (coverage.stationDistancesMeters ?? []).map(Number);
  const validDistances = Number.isFinite(pathLengthMeters)
    && pathLengthMeters > 0
    && stationDistances.every(Number.isFinite)
    && stationDistances.every((distance, index) => (
      distance > 0
        && distance < pathLengthMeters
        && (index === 0 || distance > stationDistances[index - 1])
    ));
  if (!validDistances) {
    errors.push(diagnostic(
      'route-network-coverage-stations-invalid',
      `Coverage grant ${grant.id} has invalid station distances.`,
      { grantId: grant.id },
    ));
    return;
  }
  const declaredOrdinarySpans = Array.isArray(coverage.ordinaryTraversalSpans)
    && coverage.ordinaryTraversalSpans.length > 0
    ? coverage.ordinaryTraversalSpans.map((span) => ({
      startDistanceMeters: Number(span?.startDistanceMeters),
      endDistanceMeters: Number(span?.endDistanceMeters),
      lengthMeters: Number(span?.lengthMeters),
    }))
    : [{
      startDistanceMeters: 0,
      endDistanceMeters: pathLengthMeters,
      lengthMeters: pathLengthMeters,
    }];
  const ordinarySpansValid = declaredOrdinarySpans.every((span, index) => (
    Number.isFinite(span.startDistanceMeters)
      && Number.isFinite(span.endDistanceMeters)
      && Number.isFinite(span.lengthMeters)
      && span.startDistanceMeters >= -1e-4
      && span.endDistanceMeters <= pathLengthMeters + 1e-4
      && span.endDistanceMeters > span.startDistanceMeters
      && Math.abs(
        span.lengthMeters - (span.endDistanceMeters - span.startDistanceMeters)
      ) <= 1e-4
      && (index === 0
        || span.startDistanceMeters >= declaredOrdinarySpans[index - 1].endDistanceMeters - 1e-4)
  ));
  const everyStationBelongsToOrdinarySpan = stationDistances.every((distance) => (
    declaredOrdinarySpans.some((span) => (
      distance > span.startDistanceMeters + 1e-4
        && distance < span.endDistanceMeters - 1e-4
    ))
  ));
  if (!ordinarySpansValid || !everyStationBelongsToOrdinarySpan) {
    errors.push(diagnostic(
      'route-network-coverage-ordinary-spans-invalid',
      `Coverage grant ${grant.id} has invalid transfer-bounded traversal spans.`,
      { grantId: grant.id },
    ));
    return;
  }
  const recomputedSpans = declaredOrdinarySpans.flatMap((span) => {
    const localStations = stationDistances.filter((distance) => (
      distance > span.startDistanceMeters + 1e-4
        && distance < span.endDistanceMeters - 1e-4
    ));
    const boundaries = [
      span.startDistanceMeters,
      ...localStations,
      span.endDistanceMeters,
    ];
    return boundaries.slice(1).map((distance, index) => distance - boundaries[index]);
  });
  const declaredSpans = (coverage.featurelessSpansMeters ?? []).map(Number);
  if (!coverage.coverageComplete
    || declaredSpans.length !== recomputedSpans.length
    || declaredSpans.some((value, index) => (
      !Number.isFinite(value) || Math.abs(value - recomputedSpans[index]) > 1e-4
    ))) {
    errors.push(diagnostic(
      'route-network-coverage-spans-mismatch',
      `Coverage grant ${grant.id} does not exactly partition its authored route.`,
      { grantId: grant.id, recomputedSpans, declaredSpans },
    ));
  }
  for (const [spanIndex, lengthMeters] of recomputedSpans.entries()) {
    if (lengthMeters > maximum + 1e-4) {
      errors.push(diagnostic(
        'route-network-authored-featureless-span-exceeded',
        `Coverage grant ${grant.id} leaves ${lengthMeters}m of its authored route featureless.`,
        { grantId: grant.id, spanIndex, lengthMeters, maximumFeaturelessSpanMeters: maximum },
      ));
    }
  }
}

function validateLandingOverlapGrants(grant, errors) {
  const socketsById = new Map((grant?.endpointSockets ?? []).map((socket) => (
    [String(socket.id), socket]
  )));
  const overlaps = grant?.socketLandingOverlapGrants ?? [];
  if (overlaps.length !== socketsById.size) {
    errors.push(diagnostic(
      'route-network-landing-overlap-count-invalid',
      `Grant ${grant.id} must provide one bounded landing overlap per endpoint.`,
      { grantId: grant.id, endpointCount: socketsById.size, overlapCount: overlaps.length },
    ));
  }
  const seen = new Set();
  for (const overlap of overlaps) {
    const socketId = String(overlap?.socketId ?? '');
    const socket = socketsById.get(socketId);
    if (!socket || seen.has(socketId)) {
      errors.push(diagnostic(
        'route-network-landing-overlap-socket-invalid',
        `Grant ${grant.id} has an unknown or duplicate landing overlap socket.`,
        { grantId: grant.id, socketId },
      ));
      continue;
    }
    seen.add(socketId);
    if (!finitePoint(overlap?.center) || !positiveSize(overlap?.size)
      || Number(overlap?.maximumBoundaryDepthTiles) !== 2
      || Number(overlap?.widthTiles ?? 0) !== 3
      || Number(overlap?.insideDepthTiles ?? 0) !== 2
      || Number(overlap?.outsideDepthTiles ?? 0) !== 2) {
      errors.push(diagnostic(
        'route-network-landing-overlap-invalid',
        `Grant ${grant.id} has an invalid bounded landing overlap.`,
        { grantId: grant.id, socketId },
      ));
      continue;
    }
    const horizontal = Math.abs(Number(socket?.facing?.x ?? 0)) > 0;
    const width = Number(overlap.size[horizontal ? 'z' : 'x']);
    const boundaryDepth = Number(overlap.size[horizontal ? 'x' : 'z']);
    if (width > Number(socket?.widthMeters ?? 8.4) + 1e-4
      || boundaryDepth > 14 + 1e-4
      || Number(overlap.size.y) > Number(socket?.heightMeters ?? 3.6) + 1e-4
      || dungeonPointDistance(overlap.center, {
        ...socket.position,
        y: Number(socket.position?.y ?? 0) + Number(overlap.size.y) * 0.5,
      }) > 1e-4) {
      errors.push(diagnostic(
        'route-network-landing-overlap-out-of-bounds',
        `Grant ${grant.id} exceeds the doorway landing overlap contract.`,
        { grantId: grant.id, socketId, width, boundaryDepth },
      ));
    }
  }
}

function validateEndpointModuleOverlapGrants(grant, errors) {
  const requiredSockets = (grant?.endpointSockets ?? []).filter((socket) => (
    socket?.endpointModuleOverlapRequired === true
  ));
  if (requiredSockets.length === 0) return;
  const overlaps = grant?.socketModuleOverlapGrants ?? [];
  const grantsBySocketId = new Map();
  for (const overlap of overlaps) {
    const socketId = String(overlap?.socketId ?? '');
    const matches = grantsBySocketId.get(socketId) ?? [];
    matches.push(overlap);
    grantsBySocketId.set(socketId, matches);
  }
  if ([...grantsBySocketId.keys()].some((socketId) => (
    !requiredSockets.some((socket) => String(socket.id) === socketId)
  )) || requiredSockets.some((socket) => (
    (grantsBySocketId.get(String(socket.id))?.length ?? 0) === 0
  ))) {
    errors.push(diagnostic(
      'route-network-endpoint-module-overlap-count-invalid',
      `Grant ${grant.id} must provide at least one endpoint-module merge per required socket.`,
      {
        grantId: grant.id,
        requiredSocketCount: requiredSockets.length,
        overlapCount: overlaps.length,
      },
    ));
  }
  for (const socket of requiredSockets) {
    const facingX = Number(socket?.facing?.x ?? 0);
    const facingZ = Number(socket?.facing?.z ?? 0);
    const horizontal = Math.abs(facingX) > 0;
    const seenTemplates = new Set();
    for (const overlap of grantsBySocketId.get(String(socket.id)) ?? []) {
      const templateId = String(overlap?.moduleTemplateId ?? '');
      const variant = ROUTE_NETWORK_ENDPOINT_MODULE_VARIANTS[templateId];
      const widthTiles = Number(variant?.widthTiles);
      const depthTiles = Number(variant?.depthTiles);
      const leadTiles = Number(overlap?.leadTiles);
      const transverseSize = Number(overlap?.size?.[horizontal ? 'z' : 'x']);
      const tileSize = transverseSize / widthTiles;
      const expectedCenter = {
        x: Number(socket?.position?.x ?? 0)
          + facingX * tileSize * (leadTiles + depthTiles * 0.5),
        y: Number(socket?.position?.y ?? 0) + tileSize * 1.5,
        z: Number(socket?.position?.z ?? 0)
          + facingZ * tileSize * (leadTiles + depthTiles * 0.5),
      };
      const expectedSize = {
        x: horizontal ? tileSize * depthTiles : tileSize * widthTiles,
        y: tileSize * 3,
        z: horizontal ? tileSize * widthTiles : tileSize * depthTiles,
      };
      const invalid = seenTemplates.has(templateId)
        || !variant
        || overlap.purpose !== 'route-network-endpoint-module-parent-merge'
        || overlap.moduleKind !== 'connector-module'
        || Number(overlap?.footprintTiles?.width) !== widthTiles
        || Number(overlap?.footprintTiles?.depth) !== depthTiles
        || leadTiles !== 1
        || !finitePoint(overlap.center)
        || !positiveSize(overlap.size)
        || !Number.isFinite(tileSize)
        || tileSize <= 0
        || dungeonPointDistance(overlap.center, expectedCenter) > 1e-4
        || ['x', 'y', 'z'].some((axis) => (
          Math.abs(Number(overlap.size[axis]) - expectedSize[axis]) > 1e-4
        ));
      seenTemplates.add(templateId);
      if (invalid) {
        errors.push(diagnostic(
          'route-network-endpoint-module-overlap-invalid',
          `Grant ${grant.id} has an invalid authored endpoint-module merge.`,
          { grantId: grant.id, socketId: socket.id, moduleTemplateId: templateId },
        ));
      }
    }
  }
}

function validateEndpointPlanningWitnesses(grant, errors) {
  const moduleOverlapGrants = grant?.socketModuleOverlapGrants ?? [];
  for (const socket of grant?.endpointSockets ?? []) {
    const socketId = String(socket?.id ?? '');
    const witness = validateDungeonRouteNetworkEndpointPlanningWitness(socket, {
      moduleOverlapGrant: overlapGrantForPlanningWitness(socket, moduleOverlapGrants),
      maximumRouteLengthMeters: grant?.coverage?.maximumFeaturelessSpanMeters
        ?? V4_MAXIMUM_FEATURELESS_SPAN_METERS,
    });
    for (const code of witness.errors) {
      errors.push(diagnostic(
        code,
        `Route-network endpoint ${socketId} has an invalid continuation planning witness.`,
        {
          grantId: grant?.id ?? null,
          socketId,
          routeLengthMeters: witness.routeLengthMeters,
        },
      ));
    }
  }
}

function volumeIntersection(first, second) {
  if (!finitePoint(first?.center) || !positiveSize(first?.size)
    || !finitePoint(second?.center) || !positiveSize(second?.size)) return null;
  const minimum = {};
  const maximum = {};
  for (const axis of ['x', 'y', 'z']) {
    const firstMin = Number(first.center[axis]) - Number(first.size[axis]) * 0.5;
    const firstMax = Number(first.center[axis]) + Number(first.size[axis]) * 0.5;
    const secondMin = Number(second.center[axis]) - Number(second.size[axis]) * 0.5;
    const secondMax = Number(second.center[axis]) + Number(second.size[axis]) * 0.5;
    minimum[axis] = Math.max(firstMin, secondMin);
    maximum[axis] = Math.min(firstMax, secondMax);
    if (maximum[axis] <= minimum[axis] + 1e-6) return null;
  }
  return {
    center: Object.fromEntries(['x', 'y', 'z'].map((axis) => (
      [axis, (minimum[axis] + maximum[axis]) * 0.5]
    ))),
    size: Object.fromEntries(['x', 'y', 'z'].map((axis) => (
      [axis, maximum[axis] - minimum[axis]]
    ))),
  };
}

function volumeContainsVolume(container, inner, tolerance = 1e-4) {
  if (!finitePoint(container?.center) || !positiveSize(container?.size)
    || !finitePoint(inner?.center) || !positiveSize(inner?.size)) return false;
  return ['x', 'y', 'z'].every((axis) => (
    Number(inner.center[axis]) - Number(inner.size[axis]) * 0.5
        >= Number(container.center[axis]) - Number(container.size[axis]) * 0.5 - tolerance
      && Number(inner.center[axis]) + Number(inner.size[axis]) * 0.5
        <= Number(container.center[axis]) + Number(container.size[axis]) * 0.5 + tolerance
  ));
}

function segmentEndpointLandingRecords(segment) {
  return [segment?.from, segment?.to].map((endpoint, endpointIndex) => ({
    nodeId: endpoint?.nodeId == null ? null : String(endpoint.nodeId),
    socketId: socketIdOf(endpoint),
    landingVolume: segment?.landingVolumes?.[endpointIndex] ?? null,
  })).filter(({ nodeId, landingVolume }) => (
    nodeId !== null
      && finitePoint(landingVolume?.center)
      && positiveSize(landingVolume?.size)
  ));
}

function segmentEndpointSeamRecords(segment) {
  return (segment?.endpointSeams ?? []).map((seam, endpointIndex) => ({
    nodeId: seam?.nodeId == null ? null : String(seam.nodeId),
    socketId: seam?.socketId == null ? null : String(seam.socketId),
    role: endpointIndex === 0 ? 'from' : 'to',
    seam,
    volume: seam?.overlapEnvelope ?? null,
  })).filter(({ nodeId, volume }) => (
    nodeId !== null && finitePoint(volume?.center) && positiveSize(volume?.size)
  ));
}

function transitionBayEndpointFootprint(transition) {
  if (!finitePoint(transition?.placement?.center) || !positiveSize(transition?.size)) return null;
  const quarterTurns = ((Math.round(transition.placement.rotationQuarterTurns ?? 0) % 4) + 4) % 4;
  const swapsHorizontalAxes = quarterTurns % 2 === 1;
  return {
    id: `${transition.id}:endpoint-footprint`,
    center: {
      x: Number(transition.placement.center.x),
      y: Number(transition.placement.center.y) + Number(transition.size.y) * 0.5,
      z: Number(transition.placement.center.z),
    },
    size: {
      x: Number(swapsHorizontalAxes ? transition.size.z : transition.size.x),
      y: Number(transition.size.y),
      z: Number(swapsHorizontalAxes ? transition.size.x : transition.size.z),
    },
  };
}

function sharedSegmentEndpointOverlapFootprints(
  firstSegment,
  secondSegment,
  nodeById,
  transitionById,
  strictEndpointSeams = false,
) {
  const footprints = [];
  const seen = new Set();
  if (strictEndpointSeams) {
    for (const firstEndpoint of segmentEndpointSeamRecords(firstSegment)) {
      for (const secondEndpoint of segmentEndpointSeamRecords(secondSegment)) {
        if (firstEndpoint.nodeId !== secondEndpoint.nodeId) continue;
        const sharedSeam = volumeIntersection(firstEndpoint.volume, secondEndpoint.volume);
        if (!sharedSeam) continue;
        const id = `${firstEndpoint.seam.id}:${secondEndpoint.seam.id}:intersection`;
        if (seen.has(id)) continue;
        seen.add(id);
        footprints.push({
          id,
          nodeId: firstEndpoint.nodeId,
          volume: sharedSeam,
        });
      }
    }
    return footprints;
  }
  for (const firstEndpoint of segmentEndpointLandingRecords(firstSegment)) {
    for (const secondEndpoint of segmentEndpointLandingRecords(secondSegment)) {
      if (firstEndpoint.nodeId !== secondEndpoint.nodeId) continue;
      const node = nodeById.get(firstEndpoint.nodeId);
      const transition = transitionById.get(firstEndpoint.nodeId);
      const junctionCore = node?.junction?.clearCoreVolume;
      if (finitePoint(junctionCore?.center) && positiveSize(junctionCore?.size)) {
        const id = String(junctionCore.id ?? `${firstEndpoint.nodeId}:junction-clear-core`);
        if (!seen.has(id)) {
          seen.add(id);
          footprints.push({
            id,
            nodeId: firstEndpoint.nodeId,
            volume: junctionCore,
          });
        }
      }
      const transitionFootprint = transitionBayEndpointFootprint(transition);
      if (transitionFootprint && !seen.has(transitionFootprint.id)) {
        seen.add(transitionFootprint.id);
        footprints.push({
          id: transitionFootprint.id,
          nodeId: firstEndpoint.nodeId,
          volume: transitionFootprint,
        });
      }

      // Degree-two room connections do not expose a junction record. Their
      // only permitted shared footprint is the intersection of the two exact
      // endpoint landings. External parent endpoints additionally have to
      // name the same socket; merely sharing a parent room ID is insufficient.
      const sameExternalSocket = Boolean(
        firstEndpoint.socketId
          && secondEndpoint.socketId
          && String(firstEndpoint.socketId) === String(secondEndpoint.socketId),
      );
      if (!node && !transition && !sameExternalSocket) continue;
      const sharedLanding = volumeIntersection(
        firstEndpoint.landingVolume,
        secondEndpoint.landingVolume,
      );
      if (!sharedLanding) continue;
      const id = `${firstSegment.id}:${secondSegment.id}:${firstEndpoint.nodeId}:shared-endpoint-landing`;
      if (seen.has(id)) continue;
      seen.add(id);
      footprints.push({
        id,
        nodeId: firstEndpoint.nodeId,
        volume: sharedLanding,
      });
    }
  }
  return footprints;
}

function validateRouteNetworkProtectedVolumes(
  operation,
  grant,
  nodeById,
  segmentById,
  errors,
) {
  const protectedVolumes = grant?.protectedVolumes ?? [];
  if (protectedVolumes.length === 0) return;
  for (const nodeId of operationOwnedNodes(operation, nodeById)) {
    const node = nodeById.get(nodeId);
    for (const volume of [...(node?.occupiedVolumes ?? []), ...(node?.clearanceVolumes ?? [])]) {
      for (const protectedVolume of protectedVolumes) {
        if (!volumeIntersection(volume, protectedVolume)) continue;
        errors.push(diagnostic(
          'route-network-node-overlaps-protected-volume',
          `Route-network node ${nodeId} overlaps protected landmark geometry.`,
          { operationId: operation.id, nodeId, protectedVolumeId: protectedVolume.id ?? null },
        ));
      }
    }
  }
  for (const segmentId of operationOwnedSegments(operation, segmentById)) {
    const segment = segmentById.get(segmentId);
    if (!segment) continue;
    const allowedOverlaps = segmentEndpointSeamRecords(segment)
      .map(({ volume }) => volume);
    const volumes = [
      ...(segment.occupiedVolumes ?? []),
      ...(segment.clearanceVolumes ?? []),
      ...(segment.landingVolumes ?? []),
    ];
    for (const volume of volumes) {
      for (const protectedVolume of protectedVolumes) {
        const intersection = volumeIntersection(volume, protectedVolume);
        if (!intersection) continue;
        if (allowedOverlaps.some((allowance) => volumeContainsVolume(allowance, intersection))) {
          continue;
        }
        errors.push(diagnostic(
          'route-network-segment-protected-overlap-out-of-bounds',
          `Route-network segment ${segmentId} exceeds its bounded doorway overlap grant.`,
          { operationId: operation.id, segmentId, protectedVolumeId: protectedVolume.id ?? null },
        ));
      }
    }
  }
}

function exactRouteNetworkLandingOverlapsForSegment(
  operation,
  segment,
  extensionRegions,
  nodeById = new Map(),
) {
  if (operation?.type !== 'routeNetwork' || !segment) return [];
  const region = extensionRegions.find(({ id }) => (
    String(id) === String(operation.parentRegionId)
  ));
  const grant = (region?.routeNetworkGrants ?? []).find(({ id }) => (
    String(id) === String(operation.grantId)
  ));
  if (!grant) return [];
  const socketById = new Map((grant.endpointSockets ?? []).map((socket) => (
    [String(socket.id), socket]
  )));
  const matches = [];
  for (const [endpointIndex, endpoint] of [segment.from, segment.to].entries()) {
    const socket = socketById.get(socketIdOf(endpoint));
    const seam = segment.endpointSeams?.[endpointIndex];
    if (!seam?.overlapEnvelope) continue;
    if (socket && endpointMatchesGrantedSocket(endpoint, socket)) {
      matches.push(seam.overlapEnvelope);
      continue;
    }
    // A supplemental socket on an exact authored-corridor station may share
    // only the same physical parent owner already granted to that station.
    // This is still the endpoint seam—not socketModuleOverlapGrants—and keeps
    // plan-time collision pruning identical to final acceptance.
    const endpointNode = nodeById.get(String(endpoint?.nodeId ?? ''));
    if (endpointNode?.exactParentEndpoint !== true) continue;
    const parentSocketId = String(endpointNode.parentEndpointSocketId ?? '');
    const parentSocket = socketById.get(parentSocketId);
    const parentOverlap = (grant.socketLandingOverlapGrants ?? []).find(({ socketId }) => (
      String(socketId ?? '') === parentSocketId
    ));
    if (!parentSocket || !parentOverlap?.parentOwnerId) continue;
    if (String(seam.overlapEnvelope.parentOwnerId ?? '')
      !== String(parentOverlap.parentOwnerId)) continue;
    matches.push(seam.overlapEnvelope);
  }
  return matches;
}

function exactRouteNetworkModuleOverlapsForNode(
  operation,
  node,
  extensionRegions,
) {
  if (operation?.type !== 'routeNetwork' || !node?.exactParentEndpoint) return [];
  const region = extensionRegions.find(({ id }) => (
    String(id) === String(operation.parentRegionId)
  ));
  const grant = (region?.routeNetworkGrants ?? []).find(({ id }) => (
    String(id) === String(operation.grantId)
  ));
  return (grant?.socketModuleOverlapGrants ?? []).filter(({ socketId, moduleTemplateId }) => (
    String(socketId) === String(node.parentEndpointSocketId ?? '')
      && (!moduleTemplateId || String(moduleTemplateId) === String(node.grammarId))
  ));
}

function overlapGrantMatchesBaseVolume(overlap, baseVolume) {
  if (!overlap?.parentOwnerId) return true;
  const parentOwnerId = String(overlap.parentOwnerId);
  if ([
    baseVolume?.ownerId,
    baseVolume?.logicalConnectionId,
    baseVolume?.physicalConnectionId,
  ].some((ownerId) => String(ownerId ?? '') === parentOwnerId)) return true;
  // Base-draft normalization may preserve the exact physical connection only
  // in the immutable volume ID while retaining its logical edge as ownerId.
  // Match the same bounded physical-owner namespaces used by planning; the
  // subsequent overlap-within-seams predicate still rejects every square
  // millimetre outside the authoritative 3x5 endpoint envelope.
  const baseVolumeId = String(baseVolume?.id ?? '');
  return baseVolumeId === parentOwnerId
    || baseVolumeId.startsWith(`${parentOwnerId}:`)
    || baseVolumeId.startsWith(`base:connection:${parentOwnerId}:`)
    || baseVolumeId.startsWith(`industrial:gallery-footprint:${parentOwnerId}:`);
}

export function evaluateDungeonRouteNetworkFeaturelessGraph({
  operation,
  operationNodeIds,
  graphAdjacency,
  nodeById,
  externalKeys,
  realJunctionNodeIds,
  maximum,
}) {
  const meaningful = new Set(externalKeys);
  const overlongSpans = [];
  const featurelessCycles = [];
  for (const nodeId of operationNodeIds) {
    const node = nodeById.get(nodeId);
    if (nodeIsSupplementConnectorModule(node)) continue;
    if (realJunctionNodeIds.has(nodeId)
      || nodeCountsAsSubstantiveRouteModule(
        node,
        routeNetworkPhysicalGraphDegree(node, graphAdjacency, nodeId),
      )) {
      meaningful.add(nodeId);
    }
  }
  for (const start of meaningful) {
    const walk = (
      current,
      previous,
      accumulated,
      visitedEdges,
      arrivalPosition = null,
      trace = [],
    ) => {
      for (const edge of graphAdjacency.get(current) ?? []) {
        // Reversing the edge just used is backtracking, not a new route span.
        // The previous implementation stored directional edge keys but tested
        // the bare segment ID, so it doubled one connector and rejected valid
        // routes before they reached their meaningful endpoint.
        if (edge.to === previous && visitedEdges.has(edge.id)) continue;
        const currentNode = nodeById.get(current);
        // A degree-two connector module is physical traversal, but it is not a
        // meaningful station. Segment witnesses terminate at its boundary
        // sockets, so include the real socket-to-socket crossing through its
        // clear core instead of silently omitting that hallway distance.
        const connectorModuleTraversalMeters = nodeIsSupplementConnectorModule(currentNode)
          && arrivalPosition
          && edge.fromPosition
          ? dungeonPointDistance(arrivalPosition, edge.fromPosition)
          : 0;
        const nextDistance = accumulated
          + connectorModuleTraversalMeters
          + edge.lengthMeters;
        const nextNode = nodeById.get(edge.to);
        const nextTrace = [...trace, {
          segmentId: edge.id,
          fromNodeId: current,
          toNodeId: edge.to,
          fromNodeKind: currentNode?.kind ?? null,
          toNodeKind: nextNode?.kind ?? null,
          fromNodeGrammarId: currentNode?.grammarId ?? null,
          toNodeGrammarId: nextNode?.grammarId ?? null,
          fromNodeContentRole: currentNode?.contentRole ?? null,
          toNodeContentRole: nextNode?.contentRole ?? null,
          fromNodePosition: currentNode?.placement?.center ?? null,
          toNodePosition: nextNode?.placement?.center ?? null,
          fromNodeActiveSocketIds: (currentNode?.sockets ?? [])
            .filter(({ state }) => state === 'connected')
            .map(({ id }) => String(id)),
          toNodeActiveSocketIds: (nextNode?.sockets ?? [])
            .filter(({ state }) => state === 'connected')
            .map(({ id }) => String(id)),
          fromNodeGraphDegree: routeNetworkPhysicalGraphDegree(
            currentNode,
            graphAdjacency,
            current,
          ),
          toNodeGraphDegree: routeNetworkPhysicalGraphDegree(
            nextNode,
            graphAdjacency,
            edge.to,
          ),
          segmentLengthMeters: edge.lengthMeters,
          connectorModuleTraversalMeters,
          accumulatedDistanceMeters: nextDistance,
        }];
        if (nextDistance > maximum + 1e-4) {
          overlongSpans.push({
              operationId: operation.id,
              topologyTemplateId: operation.topologyTemplateId ?? null,
              fromStationId: start,
              lengthMeters: nextDistance,
              connectorModuleTraversalMeters,
              maximumFeaturelessSpanMeters: maximum,
              toNodeId: edge.to,
              segmentId: edge.id,
              traversedNodeIds: [start, ...nextTrace.map(({ toNodeId }) => toNodeId)],
              traversedSegmentIds: nextTrace.map(({ segmentId }) => segmentId),
              traversalTrace: nextTrace,
              networkNodeSummaries: [...operationNodeIds].map((nodeId) => {
                const node = nodeById.get(nodeId);
                return {
                  nodeId,
                  ordinal: node?.ordinal ?? null,
                  kind: node?.kind ?? null,
                  grammarId: node?.grammarId ?? null,
                  contentRole: node?.contentRole ?? null,
                  position: node?.placement?.center ?? null,
                  graphDegree: routeNetworkPhysicalGraphDegree(
                    node,
                    graphAdjacency,
                    nodeId,
                  ),
                  countsAsMeaningfulStation: meaningful.has(nodeId),
                  activeSockets: (node?.sockets ?? [])
                    .filter(({ state }) => state === 'connected')
                    .map(({ id, localSocketId, segmentId }) => ({
                      id: String(id),
                      localSocketId: localSocketId ?? null,
                      segmentId: segmentId ?? null,
                  })),
                };
              }),
            });
          continue;
        }
        if (meaningful.has(edge.to)) continue;
        if (visitedEdges.has(edge.id)) {
          featurelessCycles.push({ operationId: operation.id, nodeId: edge.to });
          continue;
        }
        walk(
          edge.to,
          current,
          nextDistance,
          new Set([...visitedEdges, edge.id]),
          edge.toPosition,
          nextTrace,
        );
      }
    };
    walk(start, null, 0, new Set());
  }
  return {
    meaningfulNodeIds: [...meaningful],
    overlongSpans,
    featurelessCycles,
  };
}

function validateFeaturelessGraphSpans(options) {
  const evaluation = evaluateDungeonRouteNetworkFeaturelessGraph(options);
  for (const context of evaluation.overlongSpans) {
    options.errors.push(diagnostic(
      'route-network-accumulated-featureless-span-exceeded',
      `Route network ${options.operation.id} exceeds ${options.maximum}m between meaningful stations.`,
      context,
    ));
  }
  for (const context of evaluation.featurelessCycles) {
    options.errors.push(diagnostic(
      'route-network-featureless-cycle-without-station',
      `Route network ${options.operation.id} has a cycle with no meaningful station.`,
      context,
    ));
  }
}

function maximumContinuousLevelPathDistance(path = []) {
  let current = 0;
  let maximum = 0;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const point = path[index];
    if (Math.abs(Number(point?.y) - Number(previous?.y)) > 1e-6) {
      maximum = Math.max(maximum, current);
      current = 0;
      continue;
    }
    current += Math.hypot(
      Number(point?.x) - Number(previous?.x),
      Number(point?.z) - Number(previous?.z),
    );
  }
  return Math.max(maximum, current);
}

function expectedRouteNetworkFeaturelessSpans(operation, grant, operationSegments) {
  const authoredSpans = (grant?.coverage?.featurelessSpansMeters ?? []).map(
    (distanceMeters, index) => ({
      id: `${operation.id}:featureless-span:${index}`,
      logicalEdgeId: grant.coverage.logicalEdgeId,
      ordinal: index,
      distanceMeters: Number(distanceMeters),
      spanKind: 'authored-route-coverage',
      boundedByMeaningfulStations: true,
    }),
  );
  const physicalSpans = operationSegments.map((segment, index) => {
    const verticalTransition = segment?.verticalTransfer === true;
    return {
      id: `${operation.id}:physical-featureless-span:${index}`,
      segmentId: segment.id,
      ordinal: authoredSpans.length + index,
      ...(verticalTransition
        ? {
          transitionPath: segment.path,
          meaningfulTransition: true,
        }
        : { path: segment.path }),
      distanceMeters: maximumContinuousLevelPathDistance(segment.path),
      spanKind: verticalTransition
        ? 'supplement-horizontal-approach-to-elevation-transition'
        : 'supplement-physical-route',
      boundedByMeaningfulStations: true,
    };
  });
  return [...authoredSpans, ...physicalSpans];
}

function validateRouteNetworkOperationGrantCopies(operation, grant, errors) {
  const copiedFields = [[
    'protectedVolumes', grant?.protectedVolumes ?? [],
  ], [
    'socketLandingOverlapGrants', grant?.socketLandingOverlapGrants ?? [],
  ], [
    'socketModuleOverlapGrants', grant?.socketModuleOverlapGrants ?? [],
  ], [
    'mustPreserveBeatIds', grant?.mustPreserveBeatIds ?? [],
  ], [
    'sourceGate', grant?.sourceGate ?? null,
  ], [
    'shallowEndpointSocketIds', grant?.shallowEndpointSocketIds ?? [],
  ], [
    'coverage', grant?.coverage ?? null,
  ]];
  for (const [field, expected] of copiedFields) {
    const actual = field === 'coverage'
      ? operation?.coverage ?? null
      : field === 'shallowEndpointSocketIds'
        ? operation?.[field] ?? []
        : operation?.[field];
    if (canonicalStringify(actual) === canonicalStringify(expected)) continue;
    errors.push(diagnostic(
      'route-network-grant-copy-mismatch',
      `Route network ${operation.id} changes its parent-granted ${field} record.`,
      {
        operationId: operation.id,
        grantId: grant?.id ?? null,
        field,
      },
    ));
  }
}

function validateRouteNetworkLocalDependencies(operation, profile, operationSegments, errors) {
  const expectedArc = profile?.routeNetworkPlanning?.localProgressionArc ?? [];
  if (canonicalStringify(operation?.localProgressionArc ?? [])
    !== canonicalStringify(expectedArc)) {
    errors.push(diagnostic(
      'route-network-local-progression-dependencies-mismatch',
      `Route network ${operation.id} changes its profile-owned local progression dependencies.`,
      { operationId: operation.id, expectedArc, actualArc: operation?.localProgressionArc ?? null },
    ));
  }
  const expectedStableRuntimeStateIds = Object.fromEntries([
    'encounter', 'mechanism', 'reward', 'shortcut',
  ].map((role) => [role, `${operation.id}:state:${role}`]));
  if (canonicalStringify(operation?.stableRuntimeStateIds ?? null)
      !== canonicalStringify(expectedStableRuntimeStateIds)
    || !sameStringSequence(
      operation?.runtimeStateIds,
      Object.values(expectedStableRuntimeStateIds),
    )) {
    errors.push(diagnostic(
      'route-network-local-runtime-dependencies-invalid',
      `Route network ${operation.id} lacks its exact operation-local runtime dependencies.`,
      {
        operationId: operation.id,
        expectedStableRuntimeStateIds,
        actualStableRuntimeStateIds: operation?.stableRuntimeStateIds ?? null,
        actualRuntimeStateIds: operation?.runtimeStateIds ?? null,
      },
    ));
  }
  for (const segment of operationSegments) {
    if (!segment?.shortcut) continue;
    if (String(segment.shortcut.stateId ?? '')
      !== expectedStableRuntimeStateIds.shortcut) {
      errors.push(diagnostic(
        'route-network-segment-local-runtime-dependency-invalid',
        `Route-network segment ${segment.id} references a non-local shortcut state.`,
        {
          operationId: operation.id,
          segmentId: segment.id,
          stateId: segment.shortcut.stateId ?? null,
          expectedStateId: expectedStableRuntimeStateIds.shortcut,
        },
      ));
    }
  }
}

function routeNetworkGraph(operation, grant, nodeById, segmentById, errors) {
  const operationNodeIds = operationOwnedNodes(operation, nodeById);
  const operationSegmentIds = operationOwnedSegments(operation, segmentById);
  const declaredNodeIds = new Set(stringArray(operation?.nodeIds));
  const declaredSegmentIds = new Set(stringArray(operation?.segmentIds));
  for (const nodeId of declaredNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) {
      errors.push(diagnostic('route-network-node-missing', `Route network ${operation.id} declares unknown node ${nodeId}.`, { operationId: operation.id, nodeId }));
    } else if (node.operationId !== operation.id) {
      errors.push(diagnostic('route-network-node-operation-mismatch', `Route network ${operation.id} declares a node owned by another operation.`, { operationId: operation.id, nodeId }));
    }
  }
  for (const segmentId of declaredSegmentIds) {
    const segment = segmentById.get(segmentId);
    if (!segment) {
      errors.push(diagnostic('route-network-segment-missing', `Route network ${operation.id} declares unknown segment ${segmentId}.`, { operationId: operation.id, segmentId }));
    } else if (segment.operationId !== operation.id) {
      errors.push(diagnostic('route-network-segment-operation-mismatch', `Route network ${operation.id} declares a segment owned by another operation.`, { operationId: operation.id, segmentId }));
    }
  }

  const grantedSockets = new Map((grant?.endpointSockets ?? []).map((socket) => (
    [String(socket.id), socket]
  )));
  const graphAdjacency = new Map([...operationNodeIds].map((nodeId) => [nodeId, []]));
  const externalKeys = new Set();
  const usedSocketIds = [];
  let edgeCount = 0;
  for (const segmentId of operationSegmentIds) {
    const segment = segmentById.get(segmentId);
    if (!segment || segment.operationId !== operation.id) continue;
    const fromId = String(segment?.from?.nodeId ?? '');
    const toId = String(segment?.to?.nodeId ?? '');
    const fromInternal = operationNodeIds.has(fromId);
    const toInternal = operationNodeIds.has(toId);
    let graphFrom = fromId;
    let graphTo = toId;
    if (fromInternal !== toInternal) {
      const externalEndpoint = fromInternal ? segment.to : segment.from;
      const socketId = socketIdOf(externalEndpoint);
      const grantedSocket = grantedSockets.get(socketId);
      if (!grantedSocket || !endpointMatchesGrantedSocket(externalEndpoint, grantedSocket)) {
        errors.push(diagnostic(
          'route-network-external-endpoint-not-granted',
          `Route network ${operation.id} uses an endpoint that is not its exact host grant.`,
          { operationId: operation.id, segmentId, socketId },
        ));
      } else {
        usedSocketIds.push(socketId);
      }
      const externalKey = `external:${socketId}`;
      externalKeys.add(externalKey);
      if (!graphAdjacency.has(externalKey)) graphAdjacency.set(externalKey, []);
      if (fromInternal) graphTo = externalKey;
      else graphFrom = externalKey;
    } else if (!fromInternal && !toInternal) {
      errors.push(diagnostic(
        'route-network-segment-outside-graph',
        `Route network ${operation.id} has a segment with no supplemental endpoint.`,
        { operationId: operation.id, segmentId },
      ));
      continue;
    }
    const lengthMeters = Array.isArray(segment?.path) && segment.path.length >= 2
      ? maximumContinuousLevelPathDistance(segment.path)
      : dungeonPointDistance(segment?.from?.position, segment?.to?.position);
    graphAdjacency.get(graphFrom)?.push({
      id: segmentId,
      to: graphTo,
      lengthMeters,
      fromPosition: segment?.from?.position ?? null,
      toPosition: segment?.to?.position ?? null,
    });
    graphAdjacency.get(graphTo)?.push({
      id: segmentId,
      to: graphFrom,
      lengthMeters,
      fromPosition: segment?.to?.position ?? null,
      toPosition: segment?.from?.position ?? null,
    });
    edgeCount += 1;
  }

  if (!sameStringSet(operation?.endpointSocketIds, [...grantedSockets.keys()])) {
    errors.push(diagnostic(
      'route-network-endpoint-grant-mismatch',
      `Route network ${operation.id} does not declare exactly its granted endpoints.`,
      { operationId: operation.id, declared: sortedUniqueStrings(operation?.endpointSocketIds), granted: [...grantedSockets.keys()].sort() },
    ));
  }
  if (!sameStringSet(usedSocketIds, [...grantedSockets.keys()])
    || usedSocketIds.length !== new Set(usedSocketIds).size) {
    errors.push(diagnostic(
      'route-network-endpoint-usage-invalid',
      `Route network ${operation.id} must connect every granted endpoint exactly once.`,
      { operationId: operation.id, usedSocketIds, grantedSocketIds: [...grantedSockets.keys()].sort() },
    ));
  }

  const start = [...externalKeys][0];
  const reachable = new Set(start ? [start] : []);
  const queue = start ? [start] : [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const edge of graphAdjacency.get(queue[cursor]) ?? []) {
      if (reachable.has(edge.to)) continue;
      reachable.add(edge.to);
      queue.push(edge.to);
    }
  }
  for (const nodeId of operationNodeIds) {
    if (nodeById.has(nodeId) && !reachable.has(nodeId)) {
      errors.push(diagnostic(
        'route-network-node-unreachable',
        `Route network ${operation.id} strands node ${nodeId}.`,
        { operationId: operation.id, nodeId },
      ));
    }
  }
  for (const externalKey of externalKeys) {
    if (!reachable.has(externalKey)) {
      errors.push(diagnostic(
        'route-network-return-route-missing',
        `Route network ${operation.id} does not reconnect all of its endpoints.`,
        { operationId: operation.id, socketId: externalKey.slice('external:'.length) },
      ));
    }
  }
  const realJunctionNodeIds = new Set();
  for (const nodeId of operationNodeIds) {
    const node = nodeById.get(nodeId);
    const degree = routeNetworkPhysicalGraphDegree(node, graphAdjacency, nodeId);
    // Degree-two endpoint/turn/transfer modules may carry through-route
    // metadata, but they can never reset featureless traversal or satisfy the
    // network's required real-junction invariant.
    if (!nodeIsSupplementConnectorModule(node)
      && node?.junction
      && validateJunctionContract(node, degree, errors, operation.id)) {
      realJunctionNodeIds.add(nodeId);
    }
  }
  return {
    operationNodeIds,
    operationSegmentIds,
    graphAdjacency,
    externalKeys,
    reachable,
    realJunctionNodeIds,
    edgeCount,
    vertexCount: graphAdjacency.size,
  };
}

function requiredIdsForGate(record) {
  return sortedUniqueStrings([
    ...(record?.requiredCredentialIds ?? []),
    ...(record?.requiredStateIds ?? []),
    ...(record?.requiredCredentialId ? [record.requiredCredentialId] : []),
    ...(record?.credentialRequirement ? [record.credentialRequirement] : []),
    ...(record?.encounterRequirementId ? [record.encounterRequirementId] : []),
  ]);
}

function progressionConnectionEndpoints(connection) {
  return [
    String(connection?.fromRoomId ?? connection?.fromNodeId ?? connection?.from?.nodeId ?? ''),
    String(connection?.toRoomId ?? connection?.toNodeId ?? connection?.to?.nodeId ?? ''),
  ];
}

function validateProgressionSnapshot(region, errors) {
  const snapshot = region?.progressionSnapshot;
  if (snapshot?.schema !== PROGRESSION_SNAPSHOT_SCHEMA_V2) {
    errors.push(diagnostic(
      'progression-snapshot-v2-required',
      `V4 extension region ${region?.id} lacks a progression snapshot V2.`,
      { parentRegionId: region?.id ?? null },
    ));
    return null;
  }
  const rooms = snapshot.rooms ?? [];
  const roomById = new Map();
  for (const room of rooms) {
    if (!room?.id || roomById.has(String(room.id))) {
      errors.push(diagnostic(
        'progression-snapshot-room-invalid',
        `Progression snapshot ${region.id} has a missing or duplicate room ID.`,
        { parentRegionId: region.id, roomId: room?.id ?? null },
      ));
      continue;
    }
    if (!Number.isInteger(Number(room.progressionBandId)) || !room?.accessDomainId) {
      errors.push(diagnostic(
        'progression-snapshot-room-domain-invalid',
        `Progression room ${room.id} lacks an exact band and access domain.`,
        { parentRegionId: region.id, roomId: room.id },
      ));
    }
    roomById.set(String(room.id), room);
  }
  if (!snapshot?.startRoomId || !roomById.has(String(snapshot.startRoomId))) {
    errors.push(diagnostic(
      'progression-snapshot-start-room-invalid',
      `Progression snapshot ${region.id} has no valid start room.`,
      { parentRegionId: region.id, startRoomId: snapshot?.startRoomId ?? null },
    ));
  }

  const credentialById = new Map((snapshot.keycards ?? []).map((keycard) => (
    [String(keycard.id), keycard]
  )));
  const doorById = new Map((snapshot.doors ?? []).map((door) => [String(door.id), door]));
  const knownRequirementIds = new Set([
    ...credentialById.keys(),
    ...(snapshot.doors ?? []).flatMap((door) => stringArray(door?.requiredCredentialIds)),
    ...rooms.map(({ id }) => String(id)),
    ...stringArray(snapshot.protectedBeatIds),
  ]);
  const progressionBands = [...(snapshot.bands ?? [])]
    .filter((band) => Number.isInteger(Number(band?.progressionBandId)))
    .sort((first, second) => Number(first.progressionBandId) - Number(second.progressionBandId));
  const requiredCredentialsAcrossBands = (fromBand, toBand) => {
    const shallow = Math.min(Number(fromBand), Number(toBand));
    const deep = Math.max(Number(fromBand), Number(toBand));
    return sortedUniqueStrings(progressionBands
      .filter((band) => Number(band.progressionBandId) >= shallow
        && Number(band.progressionBandId) < deep)
      .map((band) => band.requiredCredentialIdForExit)
      .filter(Boolean));
  };
  const connectionByLogicalId = new Map();
  for (const connection of snapshot.connections ?? []) {
    const [fromRoomId, toRoomId] = progressionConnectionEndpoints(connection);
    if (!connection?.id || !fromRoomId || !toRoomId
      || !roomById.has(fromRoomId) || !roomById.has(toRoomId)) {
      errors.push(diagnostic(
        'progression-snapshot-connection-invalid',
        `Progression snapshot ${region.id} has an invalid connection.`,
        { parentRegionId: region.id, connectionId: connection?.id ?? null, fromRoomId, toRoomId },
      ));
      continue;
    }
    if (!Array.isArray(connection.centerline)
      || connection.centerline.length < 2
      || !connection.centerline.every(finitePoint)) {
      errors.push(diagnostic(
        'progression-snapshot-centerline-invalid',
        `Progression connection ${connection.id} lacks a valid centerline.`,
        { connectionId: connection.id },
      ));
    } else {
      const declaredLengthMeters = Number(connection.pathLengthMeters);
      const measuredLengthMeters = measureDungeonPolyline(connection.centerline);
      if (!Number.isFinite(declaredLengthMeters) || declaredLengthMeters <= 0) {
        errors.push(diagnostic(
          'progression-snapshot-path-length-invalid',
          `Progression connection ${connection.id} has no finite positive route length.`,
          { connectionId: connection.id, declaredLengthMeters: connection.pathLengthMeters },
        ));
      } else if (Math.abs(declaredLengthMeters - measuredLengthMeters) > 1e-4) {
        errors.push(diagnostic(
          'progression-snapshot-path-length-mismatch',
          `Progression connection ${connection.id} does not use its measured centerline length.`,
          { connectionId: connection.id, declaredLengthMeters, measuredLengthMeters },
        ));
      }
    }
    const requirements = requiredIdsForGate(connection);
    const fromRoom = roomById.get(fromRoomId);
    const toRoom = roomById.get(toRoomId);
    const crossedBandCredentialIds = requiredCredentialsAcrossBands(
      fromRoom?.progressionBandId,
      toRoom?.progressionBandId,
    );
    const credentialRequirements = sortedUniqueStrings(connection.requiredCredentialIds);
    if (crossedBandCredentialIds.some((credentialId) => (
      !credentialRequirements.includes(credentialId)
    ))) {
      errors.push(diagnostic(
        'progression-boundary-credential-missing',
        `Connection ${connection.id} bypasses a keycard access boundary.`,
        { connectionId: connection.id, requiredCredentialIds: crossedBandCredentialIds, actualCredentialIds: credentialRequirements },
      ));
    }
    const crossesProgressionBand = crossedBandCredentialIds.length > 0;
    if (crossesProgressionBand && !String(connection.gateId ?? '').trim()) {
      errors.push(diagnostic(
        'progression-boundary-gate-missing',
        `Connection ${connection.id} crosses a keycard access boundary without a physical source gate.`,
        {
          connectionId: connection.id,
          requiredCredentialIds: crossedBandCredentialIds,
          gateId: connection.gateId ?? null,
        },
      ));
    }
    const isProgressionGate = Boolean(connection.gateId) && (
      connection.locked === true
        || requirements.length > 0
        || doorById.has(String(connection.gateId))
        || crossesProgressionBand
    );
    if (isProgressionGate) {
      if (connection.gatePlacementSide !== 'source') {
        errors.push(diagnostic(
          'locked-gate-not-at-source-entrance',
          `Locked gate ${connection.gateId} is not at its corridor source entrance.`,
          { connectionId: connection.id, gateId: connection.gateId, gatePlacementSide: connection.gatePlacementSide ?? null },
        ));
      }
      if (!doorById.has(String(connection.gateId))
        && !knownRequirementIds.has(String(connection.gateId))) {
        errors.push(diagnostic(
          'unknown-progression-gate',
          `Connection ${connection.id} references unknown gate ${connection.gateId}.`,
          { connectionId: connection.id, gateId: connection.gateId },
        ));
      }
      if (requirements.length === 0) {
        errors.push(diagnostic(
          'locked-gate-requirement-missing',
          `Locked gate ${connection.gateId} has no credential, encounter, or state requirement.`,
          { connectionId: connection.id, gateId: connection.gateId },
        ));
      }
    }
    for (const requirementId of requirements) {
      if (!knownRequirementIds.has(requirementId)) {
        errors.push(diagnostic(
          'unknown-gate-requirement',
          `Gate on ${connection.id} requires unknown progression state ${requirementId}.`,
          { connectionId: connection.id, requirementId },
        ));
      }
    }
    if (connection.logicalEdgeId) {
      connectionByLogicalId.set(String(connection.logicalEdgeId), connection);
    }
  }
  for (const keycard of credentialById.values()) {
    if (!keycard?.spawnRoomId || !roomById.has(String(keycard.spawnRoomId))) {
      errors.push(diagnostic(
        'progression-keycard-spawn-invalid',
        `Keycard ${keycard.id} has no valid authored spawn room.`,
        { keycardId: keycard.id, spawnRoomId: keycard?.spawnRoomId ?? null },
      ));
    }
    if (keycard?.pairedGateId && !doorById.has(String(keycard.pairedGateId))) {
      errors.push(diagnostic(
        'progression-keycard-paired-gate-unknown',
        `Keycard ${keycard.id} references unknown paired gate ${keycard.pairedGateId}.`,
        { keycardId: keycard.id, gateId: keycard.pairedGateId },
      ));
    }
  }
  return {
    snapshot,
    roomById,
    credentialById,
    doorById,
    knownRequirementIds,
    connectionByLogicalId,
  };
}

function validateRouteNetworkSourceGate(operation, grant, snapshotRecord, errors) {
  const sourceGate = operation?.sourceGate ?? null;
  const crossedBoundaryIds = sortedUniqueStrings(operation?.crossedBoundaryIds);
  const requiredCredentialIds = sortedUniqueStrings(operation?.requiredCredentialIds);
  if (!sameStringSet(crossedBoundaryIds, grant?.crossedBoundaryIds)
    || !sameStringSet(requiredCredentialIds, grant?.requiredCredentialIds)) {
    errors.push(diagnostic(
      'route-network-boundary-contract-mismatch',
      `Route network ${operation.id} changes its host boundary or credential contract.`,
      { operationId: operation.id, grantId: grant.id },
    ));
  }
  if (!grant?.sourceGate) {
    if (sourceGate) {
      errors.push(diagnostic(
        'route-network-ungranted-source-gate',
        `Route network ${operation.id} invents a source gate not granted by its parent.`,
        { operationId: operation.id, grantId: grant.id },
      ));
    }
    if ((crossedBoundaryIds.length > 0 || requiredCredentialIds.length > 0)
      && !String(sourceGate?.gateId ?? '').trim()) {
      errors.push(diagnostic(
        'route-network-cross-band-gate-missing',
        `Route network ${operation.id} crosses an access boundary without a physical source gate.`,
        { operationId: operation.id, grantId: grant.id, gateId: sourceGate?.gateId ?? null },
      ));
    }
    return;
  }
  if (!sourceGate
    || String(sourceGate.gateId ?? '') !== String(grant.sourceGate.gateId ?? '')
    || sourceGate.gatePlacementSide !== 'source'
    || !sameStringSet(sourceGate.requiredCredentialIds, grant.sourceGate.requiredCredentialIds)
    || String(sourceGate.encounterRequirementId ?? '')
      !== String(grant.sourceGate.encounterRequirementId ?? '')) {
    errors.push(diagnostic(
      'route-network-source-gate-mismatch',
      `Route network ${operation.id} does not preserve its exact source-gate contract.`,
      { operationId: operation.id, grantId: grant.id, gateId: grant.sourceGate.gateId ?? null },
    ));
  }
  if ((crossedBoundaryIds.length > 0 || requiredCredentialIds.length > 0)
    && !String(sourceGate?.gateId ?? '').trim()) {
    errors.push(diagnostic(
      'route-network-cross-band-gate-missing',
      `Route network ${operation.id} crosses an access boundary without a physical source gate.`,
      { operationId: operation.id, grantId: grant.id, gateId: sourceGate?.gateId ?? null },
    ));
  }
  if (sourceGate?.gatePlacementSide !== 'source') {
    errors.push(diagnostic(
      'locked-gate-not-at-source-entrance',
      `Locked gate ${sourceGate?.gateId} is not at its route source entrance.`,
      { operationId: operation.id, gateId: sourceGate?.gateId ?? null, gatePlacementSide: sourceGate?.gatePlacementSide ?? null },
    ));
  }
  const requirements = requiredIdsForGate(sourceGate);
  if (requirements.length === 0) {
    errors.push(diagnostic(
      'locked-gate-requirement-missing',
      `Locked gate ${sourceGate?.gateId} has no credential, encounter, or state requirement.`,
      { operationId: operation.id, gateId: sourceGate?.gateId ?? null },
    ));
  }
  for (const requirementId of requirements) {
    if (!snapshotRecord?.knownRequirementIds?.has(requirementId)) {
      errors.push(diagnostic(
        'unknown-gate-requirement',
        `Route network ${operation.id} requires unknown progression state ${requirementId}.`,
        { operationId: operation.id, requirementId },
      ));
    }
  }
}

function validateCrossBandShortcutPhysicalGates({
  operation,
  grant,
  snapshotRecord,
  operationSegments,
  errors,
}) {
  if (grant?.kind !== 'cross-band-shortcut') return;
  const endpoints = grant?.endpointSockets ?? [];
  const endpointBands = [...new Set(endpoints.map((socket) => (
    Number(socket?.progressionBandId)
  )))].sort((first, second) => first - second);
  const shallowBandId = endpointBands[0];
  const deepBandId = endpointBands.at(-1);
  const shallowSocketIds = endpoints
    .filter((socket) => Number(socket?.progressionBandId) === shallowBandId)
    .map(({ id }) => String(id));
  const deepSocketIds = endpoints
    .filter((socket) => Number(socket?.progressionBandId) === deepBandId)
    .map(({ id }) => String(id));
  const forbiddenEndpoint = endpoints.some((socket) => (
    ['bossRoom', 'shrineRoom'].includes(String(socket?.roomId ?? socket?.nodeId ?? ''))
      || Number(socket?.progressionBandId) >= 3
  ));
  if (endpoints.length !== 2
    || shallowSocketIds.length !== 1
    || deepSocketIds.length !== 1
    || endpointBands.length !== 2
    || deepBandId - shallowBandId !== 1
    || forbiddenEndpoint
    || Number(grant?.shallowProgressionBandId) !== shallowBandId
    || Number(grant?.deepProgressionBandId) !== deepBandId
    || Number(grant?.progressionBandId) !== deepBandId) {
    errors.push(diagnostic(
      'cross-band-shortcut-domain-invalid',
      `Cross-band shortcut ${operation.id} must join exactly one shallow arm to one adjacent non-boss, non-shrine band.`,
      {
        operationId: operation.id,
        endpointBands,
        shallowSocketIds,
        deepSocketIds,
      },
    ));
  }
  if (!sameStringSet(grant?.shallowEndpointSocketIds, shallowSocketIds)
    || !sameStringSet(operation?.shallowEndpointSocketIds, shallowSocketIds)) {
    errors.push(diagnostic(
      'cross-band-shortcut-shallow-arms-invalid',
      `Cross-band shortcut ${operation.id} does not identify every exact shallow parent socket.`,
      {
        operationId: operation.id,
        expectedShallowEndpointSocketIds: shallowSocketIds,
        grantShallowEndpointSocketIds: grant?.shallowEndpointSocketIds ?? null,
        operationShallowEndpointSocketIds: operation?.shallowEndpointSocketIds ?? null,
      },
    ));
  }
  const boundaryBand = (snapshotRecord?.snapshot?.bands ?? []).find((band) => (
    Number(band?.progressionBandId) === shallowBandId
  ));
  const expectedBoundaryIds = boundaryBand?.exitGateId
    ? [String(boundaryBand.exitGateId)]
    : [];
  const expectedCredentialIds = boundaryBand?.requiredCredentialIdForExit
    ? [String(boundaryBand.requiredCredentialIdForExit)]
    : [];
  if (expectedBoundaryIds.length !== 1
    || expectedBoundaryIds[0] === 'Door_Shrine'
    || !sameStringSet(grant?.crossedBoundaryIds, expectedBoundaryIds)
    || !sameStringSet(operation?.crossedBoundaryIds, expectedBoundaryIds)
    || !sameStringSet(grant?.requiredCredentialIds, expectedCredentialIds)
    || !sameStringSet(operation?.requiredCredentialIds, expectedCredentialIds)) {
    errors.push(diagnostic(
      'cross-band-shortcut-boundary-contract-invalid',
      `Cross-band shortcut ${operation.id} does not preserve its exact adjacent-band boundary and credential.`,
      {
        operationId: operation.id,
        expectedBoundaryIds,
        expectedCredentialIds,
      },
    ));
  }
  const sourceGate = grant?.sourceGate ?? null;
  const sourceGateId = String(sourceGate?.gateId ?? '');
  if (!sourceGateId
    || sourceGate?.supplementalIdentity !== true
    || snapshotRecord?.doorById?.has(sourceGateId)
    || expectedBoundaryIds.includes(sourceGateId)
    || sourceGate?.gatePlacementSide !== 'source'
    || String(sourceGate?.sourceGateSocketId ?? '') !== String(shallowSocketIds[0] ?? '')
    || !sameStringSet(sourceGate?.shallowEndpointSocketIds, shallowSocketIds)
    || !sameStringSet(sourceGate?.crossedBoundaryIds, expectedBoundaryIds)
    || !sameStringSet(sourceGate?.requiredCredentialIds, expectedCredentialIds)
    || String(sourceGate?.requiredKeycardId ?? '') !== String(expectedCredentialIds[0] ?? '')) {
    errors.push(diagnostic(
      'cross-band-shortcut-source-gate-contract-invalid',
      `Cross-band shortcut ${operation.id} lacks its supplemental source-threshold gate identity.`,
      { operationId: operation.id, gateId: sourceGateId || null },
    ));
  }

  const shallowGateSegmentsBySocketId = new Map(
    shallowSocketIds.map((socketId) => [socketId, []]),
  );
  for (const segment of operationSegments) {
    const matchedEndpoints = ['from', 'to'].flatMap((role) => {
      const endpoint = segment?.[role];
      const socketId = socketIdOf(endpoint);
      return endpoints.some((socket) => String(socket?.id) === socketId)
        ? [{ role, endpoint, socketId }]
        : [];
    });
    const projectedGate = segment?.sourceGate ?? null;
    const projectsThisSourceGate = String(projectedGate?.gateId ?? '') === sourceGateId
      || String(segment?.sourceGateSocketId ?? '').length > 0;
    if (matchedEndpoints.length === 0) {
      if (projectsThisSourceGate) {
        errors.push(diagnostic(
          'cross-band-shortcut-source-gate-late',
          `Cross-band shortcut ${operation.id} places its source gate inside the supplemental route.`,
          { operationId: operation.id, segmentId: segment.id },
        ));
      }
      continue;
    }
    for (const match of matchedEndpoints) {
      if (deepSocketIds.includes(match.socketId)) {
        if (projectsThisSourceGate) {
          errors.push(diagnostic(
            'cross-band-shortcut-deep-arm-gate-invalid',
            `Cross-band shortcut ${operation.id} incorrectly places its credential gate on a deep arm.`,
            { operationId: operation.id, segmentId: segment.id, socketId: match.socketId },
          ));
        }
        continue;
      }
      if (!shallowGateSegmentsBySocketId.has(match.socketId)) continue;
      const gateContractMatches = canonicalStringify(projectedGate)
          === canonicalStringify(sourceGate)
        && segment?.gatePlacementSide === 'source'
        && String(segment?.sourceGateSocketId ?? '') === match.socketId
        && segment?.gateEndpointRole === match.role
        && match.endpoint?.kind === 'parentSocket'
        && sameStringSet(segment?.requiredCredentialIds, expectedCredentialIds);
      if (!gateContractMatches) {
        errors.push(diagnostic(
          projectedGate
            ? 'cross-band-shortcut-shallow-arm-gate-mismatch'
            : 'cross-band-shortcut-shallow-arm-gate-missing',
          `Cross-band shortcut ${operation.id} does not gate shallow socket ${match.socketId} at its exact parent threshold.`,
          {
            operationId: operation.id,
            segmentId: segment.id,
            socketId: match.socketId,
            gateEndpointRole: segment?.gateEndpointRole ?? null,
          },
        ));
      } else {
        shallowGateSegmentsBySocketId.get(match.socketId).push(segment.id);
      }
    }
  }
  for (const [socketId, segmentIds] of shallowGateSegmentsBySocketId) {
    if (segmentIds.length === 1) continue;
    errors.push(diagnostic(
      segmentIds.length === 0
        ? 'cross-band-shortcut-shallow-arm-gate-missing'
        : 'cross-band-shortcut-shallow-arm-gate-ambiguous',
      `Cross-band shortcut ${operation.id} must realize exactly one source gate at shallow socket ${socketId}.`,
      { operationId: operation.id, socketId, segmentIds },
    ));
  }
  const elevationModes = sortedUniqueStrings(operation?.elevationModes);
  const shortcutSegments = operationSegments.filter((segment) => (
    ['shortcut-lift', 'drop-ladder'].includes(String(segment?.shortcut?.kind ?? ''))
  ));
  const expectedInitialState = elevationModes[0] === 'shortcut-lift'
    ? 'unavailable'
    : 'retracted';
  const expectedActivatedState = elevationModes[0] === 'shortcut-lift'
    ? 'available'
    : 'deployed';
  if (grant?.shortcutActivationSide !== 'far-side'
    || elevationModes.length !== 1
    || !['shortcut-lift', 'drop-ladder'].includes(elevationModes[0])
    || !stringArray(grant?.allowedElevationModes).includes(elevationModes[0])
    || shortcutSegments.length !== 1
    || shortcutSegments[0]?.shortcut?.activationSide !== 'far'
    || shortcutSegments[0]?.shortcut?.initialState !== expectedInitialState
    || shortcutSegments[0]?.shortcut?.activatedState !== expectedActivatedState) {
    errors.push(diagnostic(
      'cross-band-shortcut-far-side-activation-invalid',
      `Cross-band shortcut ${operation.id} is not unavailable until its far-side lift or ladder control is used.`,
      {
        operationId: operation.id,
        elevationModes,
        shortcutSegmentIds: shortcutSegments.map(({ id }) => id),
      },
    ));
  }
}

function validatePyramidLoop({
  operation,
  grant,
  graph,
  snapshotRecord,
  nodeById,
  segmentById,
  errors,
}) {
  const occupied = sortedUniqueStrings(grant?.occupiedCriticalWallSides);
  const opened = sortedUniqueStrings(grant?.openedWallSides);
  const allSides = sortedUniqueStrings([...occupied, ...opened]);
  const endpointSides = sortedUniqueStrings((grant?.endpointSockets ?? []).map((socket) => (
    socket?.wallSide
  )));
  if (grant?.landmarkRoomId !== 'keycardRoom'
    || occupied.length !== 2
    || opened.length !== 2
    || !sameStringSet(allSides, CARDINAL_WALL_SIDES)
    || occupied.some((side) => opened.includes(side))
    || !sameStringSet(endpointSides, opened)) {
    errors.push(diagnostic(
      'pyramid-loop-wall-complement-invalid',
      `Pyramid loop ${operation.id} does not open exactly the two non-critical keycard-room walls.`,
      { operationId: operation.id, occupiedCriticalWallSides: occupied, openedWallSides: opened, endpointSides },
    ));
  }
  if (grant?.endpointSockets?.length !== 2
    || grant.endpointSockets.some((socket) => (
      String(socket?.nodeId ?? socket?.roomId ?? '') !== 'keycardRoom'
        || Number(socket?.widthMeters) !== 8.4
        || Number(socket?.heightMeters) < 3.6
        || Number(socket?.landingWidthTiles) !== 3
        || Number(socket?.clearanceHeightMeters) < 3.6
    ))) {
    errors.push(diagnostic(
      'pyramid-loop-aperture-contract-invalid',
      `Pyramid loop ${operation.id} lacks two unobstructed three-tile keycard-room apertures.`,
      { operationId: operation.id, grantId: grant.id },
    ));
  }
  if (Number(grant?.progressionBandId) !== 0
    || Number(operation?.progressionBandId) !== 0
    || !grant?.dominanceRegionId
    || stringArray(operation?.crossedBoundaryIds).length > 0
    || stringArray(operation?.requiredCredentialIds).length > 0) {
    errors.push(diagnostic(
      'pyramid-loop-progression-domain-invalid',
      `Pyramid loop ${operation.id} must remain wholly inside keycard band 0.`,
      { operationId: operation.id, grantId: grant.id },
    ));
  }
  const parentElevation = Number(grant?.endpointSockets?.[0]?.position?.y ?? 0);
  const pyramidNodes = stringArray(operation?.nodeIds)
    .map((nodeId) => nodeById.get(nodeId))
    .filter(Boolean);
  const pyramidSegments = stringArray(operation?.segmentIds)
    .map((segmentId) => segmentById.get(segmentId))
    .filter(Boolean);
  const hasExternalElevation = pyramidNodes.some((node) => (
    Math.abs(Number(node?.placement?.center?.y ?? parentElevation) - parentElevation)
      > ROUTE_WITNESS_TOLERANCE
      || (node?.sockets ?? []).some((socket) => (
        Math.abs(Number(socket?.position?.y ?? parentElevation) - parentElevation)
          > ROUTE_WITNESS_TOLERANCE
      ))
  )) || pyramidSegments.some((segment) => (
    canonicalConnectorFamily(segment?.connectorFamily) !== 'service-gallery'
      || [segment?.from?.position, segment?.to?.position, ...(segment?.path ?? [])]
        .filter(Boolean)
        .some((point) => (
          Math.abs(Number(point?.y ?? parentElevation) - parentElevation)
            > ROUTE_WITNESS_TOLERANCE
        ))
  ));
  if (hasExternalElevation) {
    errors.push(diagnostic(
      'pyramid-loop-external-elevation-invalid',
      `Pyramid loop ${operation.id} must keep every external node, socket, and segment in parent band 0.`,
      {
        operationId: operation.id,
        grantId: grant.id,
        parentElevation,
      },
    ));
  }
  const protectedBeatIds = new Set(snapshotRecord?.snapshot?.protectedBeatIds ?? []);
  const mustPreserve = sortedUniqueStrings(grant?.mustPreserveBeatIds);
  const requiredPyramidBeats = [
    'enemyNestGate', 'keycardGuard', 'Keycard_Alpha', 'Door_Alpha',
  ];
  if (requiredPyramidBeats.some((beatId) => !mustPreserve.includes(beatId))
    || mustPreserve.some((beatId) => !protectedBeatIds.has(beatId))) {
    errors.push(diagnostic(
      'pyramid-loop-protected-beats-invalid',
      `Pyramid loop ${operation.id} does not preserve the parent landmark progression beats.`,
      { operationId: operation.id, mustPreserveBeatIds: mustPreserve },
    ));
  }
  for (const volume of grant?.protectedVolumes ?? []) {
    if (!finitePoint(volume?.center) || !positiveSize(volume?.size)) {
      errors.push(diagnostic(
        'pyramid-loop-protected-volume-invalid',
        `Pyramid loop ${operation.id} has an invalid protected landmark volume.`,
        { operationId: operation.id, volumeId: volume?.id ?? null },
      ));
    }
  }
  const implicitParentRoomEdgeCount = 1;
  const computedCycleRankDelta = graph.edgeCount + implicitParentRoomEdgeCount
    - graph.vertexCount + (graph.vertexCount > 0 ? 1 : 0);
  if (Number(grant?.requiredCycleRankDelta) !== 1
    || Number(operation?.cycleRankDelta) !== 1
    || computedCycleRankDelta !== 1) {
    errors.push(diagnostic(
      'pyramid-loop-cycle-rank-invalid',
      `Pyramid loop ${operation.id} must add exactly one effective graph cycle.`,
      { operationId: operation.id, declaredCycleRankDelta: operation?.cycleRankDelta ?? null, computedCycleRankDelta },
    ));
  }
}

function validateFinalProgressionReachability({
  snapshotRecord,
  routeOperations,
  nodeById,
  segmentById,
  grantsById,
  errors,
}) {
  if (!snapshotRecord) return { reachableNodeCount: 0, credentialCount: 0 };
  const { snapshot, roomById, credentialById } = snapshotRecord;
  const adjacency = new Map([...roomById.keys()].map((roomId) => [roomId, []]));
  const addEdge = (from, to, requirements, id) => {
    if (!from || !to) return;
    if (!adjacency.has(from)) adjacency.set(from, []);
    if (!adjacency.has(to)) adjacency.set(to, []);
    adjacency.get(from).push({ to, requirements, id });
    adjacency.get(to).push({ to: from, requirements, id });
  };
  for (const connection of snapshot.connections ?? []) {
    const [from, to] = progressionConnectionEndpoints(connection);
    addEdge(from, to, requiredIdsForGate(connection), connection.id);
  }
  for (const operation of routeOperations) {
    const grant = grantsById.get(String(operation.grantId))?.grant;
    const opNodeIds = operationOwnedNodes(operation, nodeById);
    for (const nodeId of opNodeIds) {
      if (!adjacency.has(nodeId)) adjacency.set(nodeId, []);
    }
    for (const segmentId of operationOwnedSegments(operation, segmentById)) {
      const segment = segmentById.get(segmentId);
      if (!segment || segment.operationId !== operation.id) continue;
      const from = String(segment?.from?.nodeId ?? '');
      const to = String(segment?.to?.nodeId ?? '');
      const requirements = (opNodeIds.has(from) && opNodeIds.has(to))
        || grant?.kind === 'cross-band-shortcut'
        ? requiredIdsForGate(segment)
        : requiredIdsForGate(operation?.sourceGate);
      addEdge(from, to, requirements, segment.id);
    }
    for (const socket of grant?.endpointSockets ?? []) {
      const stationNodeId = String(socket?.nodeId ?? '');
      if (!stationNodeId || roomById.has(stationNodeId)) continue;
      const parentConnection = snapshotRecord.connectionByLogicalId.get(String(
        socket?.logicalEdgeId ?? grant?.coverage?.logicalEdgeId ?? '',
      ));
      if (!parentConnection) continue;
      const [fromRoomId, toRoomId] = progressionConnectionEndpoints(parentConnection);
      const requirements = requiredIdsForGate(parentConnection);
      addEdge(stationNodeId, fromRoomId, requirements, `${operation.id}:station-source`);
      addEdge(stationNodeId, toRoomId, requirements, `${operation.id}:station-destination`);
    }
  }
  const credentialIdsByRoom = new Map();
  for (const keycard of credentialById.values()) {
    const roomId = String(keycard?.spawnRoomId ?? '');
    if (!credentialIdsByRoom.has(roomId)) credentialIdsByRoom.set(roomId, []);
    credentialIdsByRoom.get(roomId).push(String(keycard.id));
  }
  for (const band of snapshot.bands ?? []) {
    const credentialId = String(band?.requiredCredentialIdForExit ?? '');
    const roomIds = stringArray(band?.roomIds);
    if (!credentialId || credentialById.has(credentialId) || roomIds.length !== 1) continue;
    if (!credentialIdsByRoom.has(roomIds[0])) credentialIdsByRoom.set(roomIds[0], []);
    credentialIdsByRoom.get(roomIds[0]).push(credentialId);
  }
  const reachable = new Set([String(snapshot.startRoomId)]);
  const collected = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const nodeId of [...reachable]) {
      for (const credentialId of credentialIdsByRoom.get(nodeId) ?? []) {
        if (!collected.has(credentialId)) {
          collected.add(credentialId);
          changed = true;
        }
      }
      for (const edge of adjacency.get(nodeId) ?? []) {
        if (reachable.has(edge.to)) continue;
        if (edge.requirements.every((requirementId) => (
          collected.has(requirementId)
            || roomById.has(requirementId) && reachable.has(requirementId)
        ))) {
          reachable.add(edge.to);
          changed = true;
        }
      }
    }
  }
  for (const operation of routeOperations) {
    for (const nodeId of operationOwnedNodes(operation, nodeById)) {
      if (nodeById.has(nodeId) && !reachable.has(nodeId)) {
        errors.push(diagnostic(
          'effective-progression-node-unreachable',
          `Supplement node ${nodeId} is unreachable in the final progression graph.`,
          { operationId: operation.id, nodeId },
        ));
      }
    }
  }
  for (const roomId of roomById.keys()) {
    if (!reachable.has(roomId)) {
      errors.push(diagnostic(
        'effective-progression-authored-room-unreachable',
        `Authored room ${roomId} is unreachable after augmentation.`,
        { roomId },
      ));
    }
  }
  return { reachableNodeCount: reachable.size, credentialCount: collected.size };
}

function validateV4RouteNetworks({
  plan,
  profile,
  extensionRegions,
  operationById,
  nodeById,
  segmentById,
  errors,
}) {
  const v4 = isV4AugmentationPlan(plan, profile);
  const routeOperations = [...operationById.values()].filter(({ type }) => type === 'routeNetwork');
  if (!v4 && routeOperations.length === 0) {
    return {
      routeNetworkCount: 0,
      routeNetworkNodeCount: 0,
      routeNetworkSubstantiveModuleCount: 0,
      routeNetworkPhysicalNodeCount: 0,
      pyramidLoopCount: 0,
      graphChecks: [],
      progression: null,
    };
  }
  const grantsById = routeNetworkGrantsById(extensionRegions, errors);
  const snapshotsByRegionId = new Map();
  if (v4) {
    for (const region of extensionRegions) {
      snapshotsByRegionId.set(String(region.id), validateProgressionSnapshot(region, errors));
    }
    for (const region of extensionRegions) {
      const snapshotRecord = snapshotsByRegionId.get(String(region.id));
      const regionGrants = [...grantsById.values()]
        .filter((record) => record.region.id === region.id)
        .map(({ grant }) => grant);
      for (const routeId of snapshotRecord?.snapshot?.objectiveRouteIds ?? []) {
        const connection = snapshotRecord.connectionByLogicalId.get(String(routeId));
        if (!connection
          || Number(connection.pathLengthMeters) <= V4_MAXIMUM_FEATURELESS_SPAN_METERS + 1e-4) {
          continue;
        }
        const coverageGrant = regionGrants.find((grant) => (
          grant.kind === 'objective-route-coverage'
            && String(grant?.coverage?.logicalEdgeId ?? '') === String(routeId)
        ));
        if (!coverageGrant || coverageGrant.required !== true) {
          errors.push(diagnostic(
            'overlong-objective-route-coverage-missing',
            `Objective route ${routeId} exceeds 33.6m without a required augmentation grant.`,
            { parentRegionId: region.id, routeId, pathLengthMeters: connection.pathLengthMeters },
          ));
        } else if (Array.isArray(connection.ordinaryTraversalSpans)
          && connection.ordinaryTraversalSpans.length > 0) {
          const snapshotSpans = connection.ordinaryTraversalSpans.map((span) => [
            Number(span?.startDistanceMeters),
            Number(span?.endDistanceMeters),
            Number(span?.lengthMeters),
            Number(span?.elevation),
          ]);
          const coverageSpans = (coverageGrant.coverage?.ordinaryTraversalSpans ?? [])
            .map((span) => [
              Number(span?.startDistanceMeters),
              Number(span?.endDistanceMeters),
              Number(span?.lengthMeters),
              Number(span?.elevation),
            ]);
          const spansMatch = snapshotSpans.length === coverageSpans.length
            && snapshotSpans.every((snapshotSpan, spanIndex) => (
              snapshotSpan.every((value, valueIndex) => (
                Number.isFinite(value)
                  && Number.isFinite(coverageSpans[spanIndex]?.[valueIndex])
                  && Math.abs(value - coverageSpans[spanIndex][valueIndex]) <= 1e-4
              ))
            ));
          if (!spansMatch) {
            errors.push(diagnostic(
              'route-network-coverage-transfer-spans-mismatch',
              `Coverage grant ${coverageGrant.id} does not preserve the parent route's exact traversal resets.`,
              { parentRegionId: region.id, routeId, grantId: coverageGrant.id },
            ));
          }
        }
      }
    }
  }
  const consumedGrantIds = new Set();
  const graphChecks = [];
  let routeNetworkNodeCount = 0;
  let routeNetworkPhysicalNodeCount = 0;
  let pyramidLoopCount = 0;
  const topologyKinds = new Set();
  const junctionKinds = new Set();
  const elevationModes = new Set();

  for (const operation of routeOperations) {
    if (v4) validateV4RouteNetworkSelectionManifest(operation, nodeById, errors);
    const record = grantsById.get(String(operation?.grantId ?? ''));
    const grant = record?.grant;
    if (!grant || grant.schema !== ROUTE_NETWORK_GRANT_SCHEMA_V2
      || record.region.id !== operation.parentRegionId) {
      errors.push(diagnostic(
        'route-network-grant-missing',
        `Route network ${operation.id} has no exact parent-region grant.`,
        { operationId: operation.id, grantId: operation?.grantId ?? null },
      ));
      continue;
    }
    if (consumedGrantIds.has(String(grant.id))) {
      errors.push(diagnostic(
        'route-network-grant-reused',
        `Route-network grant ${grant.id} is consumed more than once.`,
        { operationId: operation.id, grantId: grant.id },
      ));
    }
    consumedGrantIds.add(String(grant.id));
    if (operation.routeNetworkKind !== grant.kind
      || Number(operation.progressionBandId) !== Number(grant.progressionBandId)
      || String(operation.accessDomainId ?? '') !== String(grant.accessDomainId ?? '')) {
      errors.push(diagnostic(
        'route-network-domain-contract-mismatch',
        `Route network ${operation.id} changes its granted kind, band, or access domain.`,
        { operationId: operation.id, grantId: grant.id },
      ));
    }
    const expectedEndpointSocketIds = [...(grant.endpointSockets ?? [])]
      .sort((first, second) => (
        Number(first?.distanceMeters ?? 0) - Number(second?.distanceMeters ?? 0)
          || String(first?.id ?? '').localeCompare(String(second?.id ?? ''))
      ))
      .map(({ id }) => String(id));
    if (!sameStringSequence(operation?.endpointSocketIds, expectedEndpointSocketIds)) {
      errors.push(diagnostic(
        'route-network-endpoint-order-contract-mismatch',
        `Route network ${operation.id} does not preserve its canonical exact-socket order.`,
        {
          operationId: operation.id,
          grantId: grant.id,
          expectedEndpointSocketIds,
          actualEndpointSocketIds: operation?.endpointSocketIds ?? null,
        },
      ));
    }
    const orderedOperationNodes = (plan?.nodes ?? []).filter((node) => (
      String(node?.operationId ?? '') === String(operation.id)
    ));
    const expectedNodeIds = orderedOperationNodes.map(({ id }) => String(id));
    if (!sameStringSequence(operation?.nodeIds, expectedNodeIds)) {
      errors.push(diagnostic(
        'route-network-node-order-contract-mismatch',
        `Route network ${operation.id} does not declare every physical module in overlay order.`,
        {
          operationId: operation.id,
          expectedNodeIds,
          actualNodeIds: operation?.nodeIds ?? null,
        },
      ));
    }
    const orderedOperationSegments = (plan?.segments ?? []).filter((segment) => (
      String(segment?.operationId ?? '') === String(operation.id)
    ));
    const expectedSegmentIds = orderedOperationSegments.map(({ id }) => String(id));
    if (!sameStringSequence(operation?.segmentIds, expectedSegmentIds)) {
      errors.push(diagnostic(
        'route-network-segment-order-contract-mismatch',
        `Route network ${operation.id} does not declare every physical segment in overlay order.`,
        {
          operationId: operation.id,
          expectedSegmentIds,
          actualSegmentIds: operation?.segmentIds ?? null,
        },
      ));
    }
    validateRouteNetworkOperationGrantCopies(operation, grant, errors);
    validateRouteNetworkSourceGate(
      operation,
      grant,
      snapshotsByRegionId.get(String(operation.parentRegionId)),
      errors,
    );
    validateLandingOverlapGrants(grant, errors);
    validateEndpointModuleOverlapGrants(grant, errors);
    validateEndpointPlanningWitnesses(grant, errors);
    validateRouteNetworkProtectedVolumes(operation, grant, nodeById, segmentById, errors);
    const graph = routeNetworkGraph(operation, grant, nodeById, segmentById, errors);
    const operationNodes = orderedOperationNodes;
    const operationSegments = orderedOperationSegments;
    validateCrossBandShortcutPhysicalGates({
      operation,
      grant,
      snapshotRecord: snapshotsByRegionId.get(String(operation.parentRegionId)),
      operationSegments,
      errors,
    });
    const substantiveNodes = operationNodes.filter((node) => nodeCountsAsSubstantiveRouteModule(
      node,
      routeNetworkPhysicalGraphDegree(node, graph.graphAdjacency),
    ));
    const roomNodes = operationNodes.filter(nodeIsSupplementRoom);
    const connectorModuleNodes = operationNodes.filter(nodeIsSupplementConnectorModule);
    const connectorJunctionNodes = operationNodes.filter(nodeIsSupplementConnectorJunction);
    const connectorInfrastructureNodes = operationNodes.filter(({ connectorOwned }) => (
      connectorOwned === true
    ));
    const substantiveModuleCount = substantiveNodes.length;
    const physicalNodeCount = operationNodes.length;
    routeNetworkNodeCount += substantiveModuleCount;
    routeNetworkPhysicalNodeCount += physicalNodeCount;
    for (const [field, derivedCount, code, label] of [[
      'substantiveModuleCount',
      substantiveModuleCount,
      'route-network-substantive-module-count-mismatch',
      'substantive module',
    ], [
      'physicalNodeCount',
      physicalNodeCount,
      'route-network-physical-node-count-mismatch',
      'physical node',
    ]]) {
      if (operation?.[field] == null) continue;
      const declaredCount = Number(operation[field]);
      if (!Number.isSafeInteger(declaredCount)
        || declaredCount < 0
        || declaredCount !== derivedCount) {
        errors.push(diagnostic(
          code,
          `Route network ${operation.id} declares ${declaredCount} ${label}s but realizes ${derivedCount}.`,
          {
            operationId: operation.id,
            grantId: grant.id,
            field,
            declaredCount,
            derivedCount,
          },
        ));
      }
    }
    if (v4) {
      const declaredNodeIdCount = Array.isArray(operation?.nodeIds)
        ? operation.nodeIds.length
        : -1;
      const declaredModuleCount = Number(operation?.moduleCount);
      const declaredPhysicalNodeCount = Number(operation?.physicalNodeCount);
      if (!Number.isSafeInteger(declaredModuleCount)
        || !Number.isSafeInteger(declaredPhysicalNodeCount)
        || declaredModuleCount !== substantiveModuleCount
        || declaredPhysicalNodeCount !== declaredNodeIdCount
        || declaredPhysicalNodeCount !== physicalNodeCount) {
        errors.push(diagnostic(
          'route-network-v4-node-count-contract-invalid',
          `V4 route network ${operation.id} misstates its substantive or physical module count.`,
          {
            operationId: operation.id,
            grantId: grant.id,
            moduleCount: operation?.moduleCount ?? null,
            physicalNodeCount: operation?.physicalNodeCount ?? null,
            declaredNodeIdCount,
            realizedPhysicalNodeCount: physicalNodeCount,
          },
        ));
      }
      const countContracts = [[
        'roomCount', roomNodes.length,
      ], [
        'connectorModuleCount', connectorModuleNodes.length,
      ], [
        'connectorJunctionCount', connectorJunctionNodes.length,
      ], [
        'connectorInfrastructureCount', connectorInfrastructureNodes.length,
      ]];
      for (const [field, expectedCount] of countContracts) {
        if (Number(operation?.[field]) === expectedCount) continue;
        errors.push(diagnostic(
          field === 'connectorModuleCount'
            ? 'route-network-v4-connector-module-count-mismatch'
            : 'route-network-v4-node-kind-count-mismatch',
          `V4 route network ${operation.id} misstates its ${field}.`,
          {
            operationId: operation.id,
            field,
            expectedCount,
            actualCount: operation?.[field] ?? null,
          },
        ));
      }
      const identityContracts = [[
        'roomNodeIds', roomNodes.map(({ id }) => String(id)),
      ], [
        'connectorModuleNodeIds', connectorModuleNodes.map(({ id }) => String(id)),
      ], [
        'connectorJunctionNodeIds', connectorJunctionNodes.map(({ id }) => String(id)),
      ], [
        'connectorInfrastructureNodeIds', connectorInfrastructureNodes
          .map(({ id }) => String(id)),
      ]];
      for (const [field, expectedIds] of identityContracts) {
        if (sameStringSequence(operation?.[field], expectedIds)) continue;
        errors.push(diagnostic(
          ['connectorModuleNodeIds', 'connectorInfrastructureNodeIds'].includes(field)
            ? 'route-network-v4-connector-module-identities-mismatch'
            : 'route-network-v4-ordered-module-identities-mismatch',
          `V4 route network ${operation.id} misstates its ordered ${field}.`,
          {
            operationId: operation.id,
            field,
            ids: operation?.[field] ?? null,
            expectedIds,
          },
        ));
      }
      const expectedContentRoles = operationNodes.map(({ contentRole }) => (
        String(contentRole ?? '')
      ));
      if (!sameStringSequence(operation?.contentRoles, expectedContentRoles)) {
        errors.push(diagnostic(
          'route-network-v4-content-role-order-mismatch',
          `V4 route network ${operation.id} does not align content roles with ordered modules.`,
          {
            operationId: operation.id,
            expectedContentRoles,
            actualContentRoles: operation?.contentRoles ?? null,
          },
        ));
      }
    }
    const minimumModules = Number(grant.minimumModules ?? 3);
    const maximumModules = Number(grant.maximumModules ?? 6);
    if (substantiveModuleCount < minimumModules || substantiveModuleCount > maximumModules) {
      errors.push(diagnostic(
        'route-network-module-budget-violated',
        `Route network ${operation.id} contains ${substantiveModuleCount} substantive modules.`,
        { operationId: operation.id, grantId: grant.id, moduleCount: substantiveModuleCount, minimumModules, maximumModules },
      ));
    }
    const isSameBandNetwork = stringArray(grant.crossedBoundaryIds).length === 0;
    for (const node of operationNodes) {
      const degree = routeNetworkPhysicalGraphDegree(node, graph.graphAdjacency);
      if (nodeIsSupplementRoom(node)) {
        if (!nodeCountsAsSubstantiveRouteModule(node, degree)) {
          errors.push(diagnostic(
            'route-network-room-not-substantive',
            `Room ${node.id} has no qualifying challenge, payoff, elevation, or discovery role.`,
            {
              operationId: operation.id,
              nodeId: node.id,
              contentRole: node?.contentRole ?? null,
            },
          ));
        }
      } else if (nodeIsSupplementConnectorJunction(node)) {
        const horizontalSpans = [Number(node?.size?.x ?? 0), Number(node?.size?.z ?? 0)]
          .sort((first, second) => first - second);
        const junctionKind = String(node?.junction?.junctionKind ?? '');
        const expectedSpans = [...(V4_JUNCTION_FOOTPRINTS_METERS[junctionKind] ?? [])]
          .sort((first, second) => first - second);
        if (expectedSpans.length !== 2
          || horizontalSpans.some((span, index) => (
            Math.abs(span - expectedSpans[index]) > 1e-4
          ))) {
          errors.push(diagnostic(
            'route-network-connector-junction-footprint-invalid',
            `Meaningful junction ${node.id} does not match its exact V4 kit footprint.`,
            {
              operationId: operation.id,
              nodeId: node.id,
              junctionKind,
              widthMeters: Number(node?.size?.x ?? 0),
              depthMeters: Number(node?.size?.z ?? 0),
              expectedSpansMeters: expectedSpans,
            },
          ));
        }
        if (!node?.junction?.junctionKind) {
          errors.push(diagnostic(
            'route-network-connector-junction-contract-required',
            `Compact connector ${node.id} has no junction contract.`,
            { operationId: operation.id, nodeId: node.id },
          ));
        }
        if (degree < 3) {
          errors.push(diagnostic(
            'route-network-connector-junction-degree-invalid',
            `Compact connector ${node.id} has only ${degree} committed physical routes.`,
            { operationId: operation.id, nodeId: node.id, activeDegree: degree },
          ));
        }
        if (node?.junction?.countsAsMeaningfulStation !== true) {
          errors.push(diagnostic(
            'route-network-connector-junction-not-meaningful',
            `Compact connector ${node.id} is not a meaningful station.`,
            { operationId: operation.id, nodeId: node.id },
          ));
        }
        if (nodeProvidesHostedGameplayContent(node)) {
          errors.push(diagnostic(
            'route-network-content-on-connector-junction',
            `Compact junction ${node.id} cannot host gameplay content.`,
            {
              operationId: operation.id,
              nodeId: node.id,
              providesChallenge: nodeProvidesChallenge(node),
              providesReward: nodeProvidesReward(node),
            },
          ));
        }
      } else if (nodeIsSupplementConnectorModule(node)) {
        if (degree >= 3 || node?.junction?.countsAsMeaningfulStation === true) {
          errors.push(diagnostic(
            'route-network-connector-module-promotion-missing',
            `Connector module ${node.id} has three active routes but was not promoted to a junction.`,
            { operationId: operation.id, nodeId: node.id, activeDegree: degree },
          ));
        }
        if (nodeProvidesHostedGameplayContent(node)) {
          errors.push(diagnostic(
            'route-network-content-on-plain-connector',
            `Connector module ${node.id} cannot host or count gameplay content.`,
            { operationId: operation.id, nodeId: node.id },
          ));
        }
      } else if (v4) {
        errors.push(diagnostic(
          'route-network-node-kind-invalid',
          `V4 route-network node ${node.id} is neither a supplemental room nor connector infrastructure.`,
          { operationId: operation.id, nodeId: node.id, kind: node?.kind ?? null },
        ));
      } else if (!nodeIsPlainConnector(node)) {
        errors.push(diagnostic(
          'route-network-substantive-node-kind-invalid',
          `Route-network module ${node.id} is neither a supplemental room nor a connector junction.`,
          { operationId: operation.id, nodeId: node.id, kind: node?.kind ?? null },
        ));
      }
      if (degree < 1) {
        errors.push(diagnostic(
          'route-network-room-connector-required',
          `Node ${node.id} has no committed physical corridor connector.`,
          { operationId: operation.id, nodeId: node.id },
        ));
      }
      if (isSameBandNetwork && ((node.progressionBandId != null
          && Number(node.progressionBandId) !== Number(grant.progressionBandId))
        || (node.accessDomainId != null
          && String(node.accessDomainId) !== String(grant.accessDomainId)))) {
        errors.push(diagnostic(
          'route-network-node-domain-mismatch',
          `Node ${node.id} escapes route network ${operation.id}'s access domain.`,
          { operationId: operation.id, nodeId: node.id },
        ));
      }
    }
    for (const socket of grant.endpointSockets ?? []) {
      if (isSameBandNetwork && ((socket.progressionBandId != null
          && Number(socket.progressionBandId) !== Number(grant.progressionBandId))
        || (socket.accessDomainId != null
          && String(socket.accessDomainId) !== String(grant.accessDomainId)))) {
        errors.push(diagnostic(
          'route-network-endpoint-domain-mismatch',
          `Endpoint ${socket.id} does not belong to grant ${grant.id}'s access domain.`,
          { operationId: operation.id, grantId: grant.id, socketId: socket.id },
        ));
      }
    }
    if (operation.bidirectional !== true || operation.returnRouteGuaranteed !== true
      || graph.externalKeys.size < 2) {
      errors.push(diagnostic(
        'route-network-return-route-required',
        `Route network ${operation.id} does not provide a validated return route.`,
        { operationId: operation.id, endpointCount: graph.externalKeys.size },
      ));
    }
    if (graph.realJunctionNodeIds.size === 0) {
      errors.push(diagnostic(
        'route-network-real-junction-required',
        `Route network ${operation.id} has no active degree-three junction.`,
        { operationId: operation.id },
      ));
    }
    const incidentSegmentsForNode = (node) => operationSegments.filter((segment) => (
      [segment?.from?.nodeId, segment?.to?.nodeId].some((nodeId) => (
        String(nodeId ?? '') === String(node.id)
      ))
    ));
    if (!roomNodes.some(nodeProvidesChallenge)
      || !roomNodes.some(nodeProvidesReward)
      || !operationNodes.some((node) => nodeProvidesCompleteElevation(
        node,
        incidentSegmentsForNode(node),
      ))) {
      errors.push(diagnostic(
        'route-network-content-arc-incomplete',
        `Route network ${operation.id} lacks a room-hosted challenge, room-hosted reward, or elevation decision.`,
        {
          operationId: operation.id,
          challengeRoomCount: roomNodes.filter(nodeProvidesChallenge).length,
          rewardRoomCount: roomNodes.filter(nodeProvidesReward).length,
        },
      ));
    }
    validateRouteNetworkLocalDependencies(operation, profile, operationSegments, errors);
    const arcTokens = stringArray(operation.localProgressionArc).map(normalizedFeatureToken);
    if (!arcTokens.some((token) => token.includes('enter'))
      || !arcTokens.some((token) => tokenMatchesAny(token, ['challenge', 'mechanism']))
      || !arcTokens.some((token) => tokenMatchesAny(token, ['payoff', 'reward', 'treasure']))
      || !arcTokens.some((token) => token.includes('reconnect'))) {
      errors.push(diagnostic(
        'route-network-local-progression-arc-invalid',
        `Route network ${operation.id} lacks enter/challenge/payoff/reconnect progression.`,
        { operationId: operation.id },
      ));
    }
    const rawRuntimeStateIds = rawStableRuntimeStateIds(operation);
    const stableRuntimeStateIds = sortedUniqueStrings(rawRuntimeStateIds);
    if (stableRuntimeStateIds.length === 0
      || stableRuntimeStateIds.length !== rawRuntimeStateIds.length) {
      errors.push(diagnostic(
        'route-network-runtime-state-ids-invalid',
        `Route network ${operation.id} lacks unique stable runtime-state IDs.`,
        { operationId: operation.id },
      ));
    }
    const maximum = Math.min(
      Number(profile?.routeNetworkPlanning?.maximumFeaturelessSpanMeters
        ?? profile?.maximumFeaturelessSpanMeters
        ?? V4_MAXIMUM_FEATURELESS_SPAN_METERS),
      Number(grant?.coverage?.maximumFeaturelessSpanMeters
        ?? operation?.maximumFeaturelessSpanMeters
        ?? V4_MAXIMUM_FEATURELESS_SPAN_METERS),
      V4_MAXIMUM_FEATURELESS_SPAN_METERS,
    );
    const profileMaximum = Number(
      profile?.routeNetworkPlanning?.maximumFeaturelessSpanMeters
        ?? profile?.maximumFeaturelessSpanMeters
        ?? V4_MAXIMUM_FEATURELESS_SPAN_METERS,
    );
    if (!Number.isFinite(Number(operation?.maximumFeaturelessSpanMeters))
      || Math.abs(Number(operation.maximumFeaturelessSpanMeters) - profileMaximum) > 1e-4
      || Number(operation.maximumFeaturelessSpanMeters)
        > V4_MAXIMUM_FEATURELESS_SPAN_METERS + 1e-4) {
      errors.push(diagnostic(
        'route-network-maximum-featureless-span-contract-mismatch',
        `Route network ${operation.id} changes its profile-owned featureless-span limit.`,
        {
          operationId: operation.id,
          expectedMaximumFeaturelessSpanMeters: profileMaximum,
          actualMaximumFeaturelessSpanMeters: operation?.maximumFeaturelessSpanMeters ?? null,
        },
      ));
    }
    const expectedFeaturelessSpans = expectedRouteNetworkFeaturelessSpans(
      operation,
      grant,
      operationSegments,
    );
    if (canonicalStringify(operation?.featurelessSpans ?? [])
      !== canonicalStringify(expectedFeaturelessSpans)) {
      errors.push(diagnostic(
        'route-network-featureless-witness-contract-mismatch',
        `Route network ${operation.id} does not preserve its recomputed authored and physical coverage witnesses.`,
        {
          operationId: operation.id,
          grantId: grant.id,
          expectedSpanCount: expectedFeaturelessSpans.length,
          actualSpanCount: Array.isArray(operation?.featurelessSpans)
            ? operation.featurelessSpans.length
            : null,
        },
      ));
    }
    validateDeclaredFeaturelessSpans(operation, grant, maximum, errors);
    validateFeaturelessGraphSpans({
      operation,
      operationNodeIds: graph.operationNodeIds,
      graphAdjacency: graph.graphAdjacency,
      nodeById,
      externalKeys: graph.externalKeys,
      realJunctionNodeIds: graph.realJunctionNodeIds,
      maximum,
      errors,
    });
    if (grant.kind === 'landmark-perimeter-loop') {
      pyramidLoopCount += 1;
      validatePyramidLoop({
        operation,
        grant,
        graph,
        snapshotRecord: snapshotsByRegionId.get(String(operation.parentRegionId)),
        nodeById,
        segmentById,
        errors,
      });
    }
    if (operation.topologyTemplateId) topologyKinds.add(String(operation.topologyTemplateId));
    for (const kind of operation.junctionKinds ?? []) junctionKinds.add(String(kind));
    for (const mode of operation.elevationModes ?? []) elevationModes.add(String(mode));
    graphChecks.push({
      operationId: operation.id,
      grantId: grant.id,
      nodeCount: graph.operationNodeIds.size,
      substantiveModuleCount,
      physicalNodeCount,
      connectorInfrastructureNodeCount: connectorModuleNodes.length,
      segmentCount: graph.operationSegmentIds.size,
      endpointCount: graph.externalKeys.size,
      reachableCount: graph.reachable.size,
      realJunctionCount: graph.realJunctionNodeIds.size,
    });
  }

  if (v4) {
    for (const { grant } of grantsById.values()) {
      if (grant.required === true && !consumedGrantIds.has(String(grant.id))) {
        errors.push(diagnostic(
          'required-route-network-grant-unfulfilled',
          `Required route-network grant ${grant.id} was not realized.`,
          { grantId: grant.id, kind: grant.kind },
        ));
      }
    }
    if (pyramidLoopCount !== 1) {
      errors.push(diagnostic(
        'required-pyramid-loop-count-invalid',
        `V4 requires exactly one keycard-pyramid perimeter loop.`,
        { pyramidLoopCount },
      ));
    }
    const maximumNetworks = Number(
      profile?.routeNetworkPlanning?.maximumNetworkCount
        ?? profile?.operationBudget?.maximumRouteNetworks
        ?? V4_MAXIMUM_ROUTE_NETWORKS,
    );
    const maximumModules = Number(
      profile?.routeNetworkPlanning?.maximumTotalModules
        ?? profile?.operationBudget?.maximumTotalRooms
        ?? V4_MAXIMUM_SUPPLEMENT_MODULES,
    );
    if (routeOperations.length > maximumNetworks || routeNetworkNodeCount > maximumModules) {
      errors.push(diagnostic(
        'route-network-global-budget-violated',
        `V4 route-network budgets were exceeded.`,
        {
          routeNetworkCount: routeOperations.length,
          maximumNetworks,
          moduleCount: routeNetworkNodeCount,
          substantiveModuleCount: routeNetworkNodeCount,
          physicalNodeCount: routeNetworkPhysicalNodeCount,
          maximumModules,
        },
      ));
    }
    // Variety is a release-corpus property, not a reason to reject an
    // otherwise complete physical dungeon. Keep the normalized per-seed
    // counts below so the 100-seed verifier can enforce the profile quotas;
    // deterministic exhaustion bags still prevent needless repetition inside
    // one plan. Requiring every individual seed to contain the whole corpus
    // quota made valid first-seed overlays fall back before materialization.
  }
  const progressionResults = [];
  for (const [regionId, snapshotRecord] of snapshotsByRegionId) {
    progressionResults.push({
      parentRegionId: regionId,
      ...validateFinalProgressionReachability({
        snapshotRecord,
        routeOperations: routeOperations.filter(({ parentRegionId }) => (
          String(parentRegionId) === regionId
        )),
        nodeById,
        segmentById,
        grantsById,
        errors,
      }),
    });
  }
  return {
    routeNetworkCount: routeOperations.length,
    routeNetworkNodeCount,
    routeNetworkSubstantiveModuleCount: routeNetworkNodeCount,
    routeNetworkPhysicalNodeCount,
    pyramidLoopCount,
    graphChecks,
    progression: progressionResults,
    variety: {
      topologyTemplateCount: topologyKinds.size,
      junctionKindCount: junctionKinds.size,
      elevationModeCount: elevationModes.size,
    },
  };
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
  if (![DUNGEON_AUGMENTATION_OVERLAY_SCHEMA, DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA]
    .includes(plan?.schema)) {
    errors.push(diagnostic('invalid-overlay-schema', 'The overlay schema is not supported.'));
  }
  const expectedRevision = plan?.schema === DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA
    ? DUNGEON_AUGMENTATION_V2_SCHEMA_REVISION
    : DUNGEON_AUGMENTATION_SCHEMA_REVISION;
  if (Number(plan?.revision) !== expectedRevision) {
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
  const transitionById = new Map();
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
    if (!['optionalBranch', 'edgePadding', 'delegatedProgression', 'routeNetwork'].includes(operation.type)) {
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
      const snapshot = operation.originalEdgeSnapshot;
      const path = Array.isArray(snapshot?.path) ? snapshot.path : [];
      const sourcePosition = snapshot?.source?.position;
      const destinationPosition = snapshot?.destination?.position;
      if (path.length < 2 || !path.every(finitePoint)) {
        errors.push(diagnostic(
          'edge-padding-usable-path-invalid',
          `Padding ${operation.id} has no valid boundary-to-boundary splice path.`,
          { operationId: operation.id },
        ));
      } else {
        const measuredPathLengthMeters = measureDungeonPolyline(path);
        if (!finitePoint(sourcePosition)
          || !finitePoint(destinationPosition)
          || dungeonPointDistance(path[0], sourcePosition) > 1e-4
          || dungeonPointDistance(path.at(-1), destinationPosition) > 1e-4) {
          errors.push(diagnostic(
            'edge-padding-path-endpoint-mismatch',
            `Padding ${operation.id} splice path does not terminate at its parent boundary sockets.`,
            { operationId: operation.id },
          ));
        }
        const availableLengthMeters = Number(
          snapshot?.availableLengthMeters ?? measuredPathLengthMeters,
        );
        if (!Number.isFinite(availableLengthMeters)
          || availableLengthMeters < 0
          || availableLengthMeters > measuredPathLengthMeters + 1e-4) {
          errors.push(diagnostic(
            'edge-padding-usable-length-invalid',
            `Padding ${operation.id} claims more usable length than its splice path provides.`,
            {
              operationId: operation.id,
              availableLengthMeters,
              measuredPathLengthMeters,
            },
          ));
        }
        const requiredLengthMeters = Number(operation.requiredLengthMeters);
        if (Number.isFinite(requiredLengthMeters)
          && Number.isFinite(availableLengthMeters)
          && requiredLengthMeters > availableLengthMeters + 1e-4) {
          errors.push(diagnostic(
            'edge-padding-does-not-fit-usable-path',
            `Padding ${operation.id} cannot fit between its parent boundary sockets.`,
            {
              operationId: operation.id,
              requiredLengthMeters,
              availableLengthMeters,
            },
          ));
        }
      }
    }
  }
  const runtimeStateOwnerById = new Map();
  for (const operation of plan?.operations ?? []) {
    for (const runtimeStateId of operationOwnedRuntimeStateIds(operation)) {
      const firstOperationId = runtimeStateOwnerById.get(runtimeStateId);
      if (firstOperationId) {
        errors.push(diagnostic(
          'augmentation-runtime-state-id-duplicated',
          `Stable runtime-state ID ${runtimeStateId} is shared by multiple augmentation operations.`,
          {
            runtimeStateId,
            firstOperationId,
            duplicateOperationId: operation.id,
          },
        ));
      } else {
        runtimeStateOwnerById.set(runtimeStateId, operation.id);
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
    const operation = operationById.get(segment?.operationId);
    if (!operation) {
      errors.push(diagnostic('segment-operation-missing', `Segment ${segment?.id} has no operation.`, { segmentId: segment?.id }));
    }
    if (!finitePoint(segment?.from?.position) || !finitePoint(segment?.to?.position)) {
      errors.push(diagnostic('segment-endpoint-invalid', `Segment ${segment?.id} has invalid endpoints.`, { segmentId: segment?.id }));
    }
    const validPathShape = Array.isArray(segment?.path)
      && segment.path.length >= 2
      && segment.path.every(finitePoint);
    const sharedJunctionThreshold = isSharedJunctionThresholdSegment(segment);
    let physicalWitnessValid = false;
    if (!validPathShape) {
      errors.push(diagnostic('segment-path-invalid', `Segment ${segment?.id} has no valid path.`, { segmentId: segment?.id }));
    } else if (sharedJunctionThreshold) {
      physicalWitnessValid = validateSharedJunctionThresholdSegment({
        segment,
        operation,
        nodeById,
        extensionRegions,
        errors,
      });
    } else {
      const legLengths = segment.path.slice(1).map((point, index) => (
        dungeonPointDistance(segment.path[index], point)
      ));
      const zeroLengthLegIndex = legLengths.findIndex((length) => (
        length <= ROUTE_WITNESS_TOLERANCE
      ));
      const pathLengthMeters = legLengths.reduce((sum, length) => sum + length, 0);
      if (pathLengthMeters <= ROUTE_WITNESS_TOLERANCE || zeroLengthLegIndex >= 0) {
        errors.push(diagnostic(
          'segment-path-degenerate',
          `Segment ${segment?.id} contains no usable physical route witness.`,
          {
            segmentId: segment?.id,
            pathLengthMeters,
            zeroLengthLegIndex: zeroLengthLegIndex >= 0 ? zeroLengthLegIndex : null,
          },
        ));
      } else {
        physicalWitnessValid = true;
      }
    }
    const pathMatchesEndpoints = validPathShape
      && finitePoint(segment?.from?.position)
      && finitePoint(segment?.to?.position)
      && dungeonPointDistance(segment.path[0], segment.from.position) <= 1e-4
      && dungeonPointDistance(segment.path.at(-1), segment.to.position) <= 1e-4;
    if (validPathShape && !pathMatchesEndpoints) {
      errors.push(diagnostic(
        'segment-path-endpoint-mismatch',
        `Segment ${segment?.id} path does not terminate at its declared endpoints.`,
        { segmentId: segment?.id },
      ));
    } else if (validPathShape) {
      const splicePath = operation?.originalEdgeSnapshot?.path;
      if (operation?.type === 'edgePadding'
        && (!Array.isArray(splicePath)
          || segment.path.some((point) => !pointLiesOnPolyline(point, splicePath)))) {
        errors.push(diagnostic(
          'edge-padding-segment-leaves-splice-path',
          `Padding segment ${segment?.id} leaves its parent splice path.`,
          { segmentId: segment?.id, operationId: operation?.id },
        ));
      }
    }
    if (physicalWitnessValid
      && pathMatchesEndpoints
      && operation?.type === 'routeNetwork'
      && isV4AugmentationPlan(plan, profile)
      && !sharedJunctionThreshold) {
      validateV4RouteSegmentPhysicalWitness({
        segment,
        operation,
        nodeById,
        extensionRegions,
        errors,
      });
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
    if (isV4AugmentationPlan(plan, profile)
      && !sharedJunctionThreshold && (!Array.isArray(segment?.landingVolumes)
      || segment.landingVolumes.length !== 2
      || !segment.landingVolumes.every((volume) => finitePoint(volume?.center) && positiveSize(volume?.size)))) {
      errors.push(diagnostic('segment-landing-volumes-invalid', `Segment ${segment?.id} lacks valid endpoint landing volumes.`, { segmentId: segment?.id }));
    }
    if (!sharedJunctionThreshold) {
      validateVolumeArray(segment?.occupiedVolumes, {
        ownerId: segment?.id,
        ownerKind: 'segment',
        volumeKind: 'occupied',
        errors,
      });
      validateVolumeArray(segment?.clearanceVolumes, {
        ownerId: segment?.id,
        ownerKind: 'segment',
        volumeKind: 'clearance',
        errors,
      });
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
    transitionById.set(transition.id, transition);
    validateTransition(transition, {
      operationById, regions: extensionRegions, themeCapabilitiesByRegionId, errors,
    });
  }

  const optionalBranchGraphChecks = validateOptionalBranchGraphs(
    plan,
    operationById,
    nodeById,
    segmentById,
    errors,
  );
  const routeNetworkValidation = validateV4RouteNetworks({
    plan,
    profile,
    extensionRegions,
    operationById,
    nodeById,
    segmentById,
    errors,
  });

  const baseVolumes = collectBaseDraftVolumes(baseDraft, extensionRegions);
  const nodeVolumes = (plan?.nodes ?? []).flatMap((node) => ([
    ...(node.occupiedVolumes ?? []).map((volume) => ({ ...volume, volumeClass: 'occupied' })),
    ...(node.clearanceVolumes ?? []).map((volume) => ({ ...volume, volumeClass: 'clearance' })),
  ].map((volume) => ({ ...volume, nodeId: node.id }))));
  for (const volume of nodeVolumes) {
    const node = nodeById.get(volume.nodeId);
    const operation = operationById.get(node?.operationId);
    const exactRouteNetworkModuleOverlaps = isV4AugmentationPlan(plan, profile)
      ? exactRouteNetworkModuleOverlapsForNode(
        operation,
        node,
        extensionRegions,
      )
      : [];
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
      if (!dungeonVolumesOverlap(volume, baseVolume)) continue;
      const matchingModuleOverlaps = exactRouteNetworkModuleOverlaps.filter((overlap) => (
        overlapGrantMatchesBaseVolume(overlap, baseVolume)
      ));
      if (dungeonVolumeOverlapWithinGrants(
        volume,
        baseVolume,
        matchingModuleOverlaps,
      )) continue;
      errors.push(diagnostic('supplement-overlaps-base-draft', `Supplement node ${volume.nodeId} overlaps ${baseVolume.id}.`, { nodeId: volume.nodeId, baseVolumeId: baseVolume.id }));
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
    const exactRouteNetworkLandingOverlaps = isV4AugmentationPlan(plan, profile)
      ? exactRouteNetworkLandingOverlapsForSegment(
        operation,
        segment,
        extensionRegions,
        nodeById,
      )
      : [];
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
      if (!dungeonVolumesOverlap(volume, baseVolume)) continue;
      if (operation?.type === 'routeNetwork' && isV4AugmentationPlan(plan, profile)) {
        const matchingLandingOverlaps = exactRouteNetworkLandingOverlaps.filter((overlap) => (
          overlapGrantMatchesBaseVolume(overlap, baseVolume)
        ));
        if (dungeonVolumeOverlapWithinGrants(
          volume,
          baseVolume,
          matchingLandingOverlaps,
        )) {
          continue;
        }
        errors.push(diagnostic(
          'route-network-segment-base-overlap-outside-landing-grant',
          `Route-network segment ${volume.segmentId} overlaps ${baseVolume.id} outside its exact endpoint landing grant.`,
          {
            segmentId: volume.segmentId,
            baseVolumeId: baseVolume.id,
            volumePurpose: volume.purpose,
            endpointLandingGrantIds: exactRouteNetworkLandingOverlaps.map(({ id }) => id),
          },
        ));
        continue;
      }
      if (endpointNodeIds.has(baseVolume.ownerId)) continue;
      errors.push(diagnostic('supplement-segment-overlaps-base-draft', `Supplement segment ${volume.segmentId} overlaps ${baseVolume.id}.`, {
          segmentId: volume.segmentId,
          baseVolumeId: baseVolume.id,
          volumePurpose: volume.purpose,
      }));
    }
    for (const nodeVolume of nodeVolumes) {
      if (!dungeonVolumesOverlap(volume, nodeVolume)) continue;
      if (endpointNodeIds.has(nodeVolume.nodeId)) {
        if (operation?.type !== 'routeNetwork' || !isV4AugmentationPlan(plan, profile)) {
          continue;
        }
        const overlap = volumeIntersection(volume, nodeVolume);
        const endpointSeams = segmentEndpointSeamRecords(segment).filter(({ nodeId }) => (
          nodeId === String(nodeVolume.nodeId)
        ));
        if (overlap && endpointSeams.some(({ volume: seamVolume }) => (
          volumeContainsVolume(seamVolume, overlap)
        ))) continue;
        errors.push(diagnostic(
          'route-network-segment-endpoint-overlap-outside-seam',
          `Route-network segment ${volume.segmentId} overlaps endpoint node ${nodeVolume.nodeId} outside its exact 3x5 seam.`,
          {
            segmentId: volume.segmentId,
            nodeId: nodeVolume.nodeId,
            volumePurpose: volume.purpose,
            endpointSeamIds: endpointSeams.map(({ seam }) => seam.id),
          },
        ));
        continue;
      }
      {
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
      if (!dungeonVolumesOverlap(segmentVolumes[first], segmentVolumes[second])) continue;
      const firstSegment = segmentById.get(segmentVolumes[first].segmentId);
      const secondSegment = segmentById.get(segmentVolumes[second].segmentId);
      const strictEndpointSeams = isV4AugmentationPlan(plan, profile)
        && operationById.get(firstSegment?.operationId)?.type === 'routeNetwork'
        && operationById.get(secondSegment?.operationId)?.type === 'routeNetwork';
      const overlap = volumeIntersection(segmentVolumes[first], segmentVolumes[second]);
      const allowedFootprints = sharedSegmentEndpointOverlapFootprints(
        firstSegment,
        secondSegment,
        nodeById,
        transitionById,
        strictEndpointSeams,
      );
      if (overlap && allowedFootprints.some(({ volume }) => (
        volumeContainsVolume(volume, overlap)
      ))) continue;
      errors.push(diagnostic(
        strictEndpointSeams
          ? 'route-network-segment-shared-overlap-outside-seams'
          : 'supplement-segments-overlap',
        `Supplement segments ${segmentVolumes[first].segmentId} and ${segmentVolumes[second].segmentId} overlap outside an exact shared endpoint footprint.`, {
        firstSegmentId: segmentVolumes[first].segmentId,
        secondSegmentId: segmentVolumes[second].segmentId,
        firstVolumeClass: segmentVolumes[first].volumeClass,
        secondVolumeClass: segmentVolumes[second].volumeClass,
        sharedEndpointNodeIds: [...new Set(allowedFootprints.map(({ nodeId }) => nodeId))],
        allowedEndpointFootprintIds: allowedFootprints.map(({ id }) => id),
      },
      ));
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
  const roomCount = isV4AugmentationPlan(plan, profile)
    ? (plan?.nodes ?? []).filter(nodeIsSupplementRoom).length
    : (plan?.nodes?.length ?? 0);
  if (profile && (roomCount < profile.operationBudget.minimumTotalRooms
    || roomCount > profile.operationBudget.maximumTotalRooms)) {
    errors.push(diagnostic('supplement-room-budget-violated', `The overlay contains ${roomCount} supplemental rooms.`, { roomCount, budget: profile.operationBudget }));
  }
  const featureCounts = collectDungeonAugmentationFeatureCounts(plan);
  validateRequiredFeatureQuotas(profile, featureCounts, errors);

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
      optionalBranchGraphChecks,
      routeNetworkValidation,
      featureCounts,
      planHash: plan?.augmentationPlanHash ?? null,
    },
  });
}
