import {
  cloneDungeonAugmentationValue,
  deepFreezeDungeonAugmentationValue,
  hashCanonicalValue,
} from './canonical.js';

export const DUNGEON_EXTENSION_HOST_SCHEMA = 'ruindivex-dungeon-extension-host/v1';
export const DUNGEON_EXTENSION_HOST_V2_SCHEMA = 'ruindivex-dungeon-extension-host/v2';
export const DUNGEON_REGION_THEME_SCHEMA = 'ruindivex-dungeon-region-theme/v1';
export const DUNGEON_THEME_CAPABILITIES_SCHEMA = 'ruindivex-dungeon-theme-capabilities/v1';
export const DUNGEON_SUPPLEMENT_GRAMMAR_SCHEMA = 'ruindivex-dungeon-supplement-grammar/v1';
export const DUNGEON_AUGMENTATION_PROFILE_SCHEMA = 'ruindivex-dungeon-augmentation-profile/v1';
export const DUNGEON_AUGMENTATION_OVERLAY_SCHEMA = 'ruindivex-dungeon-augmentation-overlay/v1';
export const DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA = 'ruindivex-dungeon-augmentation-overlay/v2';
export const DUNGEON_AUGMENTATION_OPERATION_SCHEMA = 'ruindivex-dungeon-augmentation-operation/v1';
export const DUNGEON_PROGRESSION_SNAPSHOT_V2_SCHEMA = 'ruindivex-dungeon-progression-snapshot/v2';
export const DUNGEON_ROUTE_NETWORK_GRANT_V2_SCHEMA = 'ruindivex-dungeon-route-network-grant/v2';
export const DUNGEON_TRANSITION_BAY_SCHEMA = 'ruindivex-dungeon-transition-bay/v1';
export const DUNGEON_AUGMENTATION_RESULT_SCHEMA = 'ruindivex-dungeon-augmentation-result/v1';
export const DUNGEON_AUGMENTATION_DIAGNOSTICS_SCHEMA = 'ruindivex-dungeon-augmentation-diagnostics/v1';
export const DUNGEON_AUGMENTATION_EFFECTIVE_DRAFT_SCHEMA = 'ruindivex-dungeon-effective-draft-augmentation/v1';
export const DUNGEON_AUGMENTATION_SAVE_IDENTITY_SCHEMA = 'ruindivex-dungeon-augmentation-save-identity/v1';
export const DUNGEON_AUGMENTATION_SCHEMA_REVISION = 1;
export const DUNGEON_AUGMENTATION_V2_SCHEMA_REVISION = 2;

export const DUNGEON_EXTENSION_HOST_SCHEMAS = Object.freeze([
  DUNGEON_EXTENSION_HOST_SCHEMA,
  DUNGEON_EXTENSION_HOST_V2_SCHEMA,
]);

export const DUNGEON_AUGMENTATION_OVERLAY_SCHEMAS = Object.freeze([
  DUNGEON_AUGMENTATION_OVERLAY_SCHEMA,
  DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA,
]);

export const DUNGEON_AUGMENTATION_OPERATION_TYPES = Object.freeze([
  'optionalBranch',
  'edgePadding',
  'delegatedProgression',
  'routeNetwork',
]);

export const DUNGEON_AUGMENTATION_UNCHANGED_REASONS = Object.freeze([
  'augmentation-disabled',
  'invalid-input',
  'profile-not-found',
  'profile-not-allowed',
  'no-eligible-regions',
  'no-eligible-operations',
  'theme-capabilities-missing',
  'planning-failed',
  'validation-failed',
  'base-draft-mutated',
]);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function finitePoint(value) {
  return value && ['x', 'y', 'z'].every((axis) => Number.isFinite(Number(value[axis])));
}

function positiveSize(value) {
  return finitePoint(value)
    && ['x', 'y', 'z'].every((axis) => Number(value[axis]) > 0);
}

function nearlyEqual(first, second, tolerance = 1e-6) {
  return Math.abs(Number(first) - Number(second)) <= tolerance;
}

function sortedUniqueContractIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value)))]
    .sort();
}

function sameContractIdSet(first, second) {
  const firstIds = sortedUniqueContractIds(first);
  const secondIds = sortedUniqueContractIds(second);
  return firstIds.length === secondIds.length
    && firstIds.every((id, index) => id === secondIds[index]);
}

const ROUTE_NETWORK_PLANNING_WITNESS_TOLERANCE = 1e-4;
const ROUTE_NETWORK_ENDPOINT_MODULE_CENTER_OFFSET_METERS = 12.6;
const ROUTE_NETWORK_ENDPOINT_MODULE_HALF_DEPTH_METERS = 9.8;
const ROUTE_NETWORK_CONTINUATION_ROOM_HALF_SPAN_METERS = 9.8;
const ROUTE_NETWORK_MAXIMUM_PLANNING_CONTINUATION_METERS = 33.6;
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

function finiteHorizontalPoint(value) {
  if (!value || !['x', 'z'].every((axis) => Number.isFinite(Number(value[axis])))) {
    return false;
  }
  return value.y == null || Number.isFinite(Number(value.y));
}

function horizontalPointDistance(first, second) {
  return Math.hypot(
    Number(second?.x) - Number(first?.x),
    Number(second?.z) - Number(first?.z),
  );
}

function horizontalPointsMatch(first, second, tolerance = ROUTE_NETWORK_PLANNING_WITNESS_TOLERANCE) {
  return finiteHorizontalPoint(first)
    && finiteHorizontalPoint(second)
    && horizontalPointDistance(first, second) <= tolerance;
}

function planningWitnessModuleOverlapGrant(socket, overlaps = []) {
  const socketOverlaps = overlaps.filter(({ socketId }) => (
    String(socketId ?? '') === String(socket?.id ?? '')
  ));
  return socketOverlaps.find(({ center }) => (
    horizontalPointsMatch(center, socket?.planningModuleCenter)
  )) ?? socketOverlaps.find(({ moduleTemplateId }) => (
    moduleTemplateId === 'supplement-route-connector-through-t-v1'
  )) ?? socketOverlaps[0] ?? null;
}

function cardinalHorizontalFacing(value) {
  if (!finiteHorizontalPoint(value)) return false;
  const x = Number(value.x);
  const z = Number(value.z);
  return nearlyEqual(Number(value.y ?? 0), 0)
    && nearlyEqual(Math.abs(x) + Math.abs(z), 1)
    && (nearlyEqual(x, 0) || nearlyEqual(z, 0));
}

function routeLegAlignedWithFacing(start, end, facing) {
  const deltaX = Number(end.x) - Number(start.x);
  const deltaZ = Number(end.z) - Number(start.z);
  const projection = deltaX * Number(facing.x) + deltaZ * Number(facing.z);
  const lateral = Math.abs(
    deltaX * Number(facing.z) - deltaZ * Number(facing.x),
  );
  return projection > ROUTE_NETWORK_PLANNING_WITNESS_TOLERANCE
    && lateral <= ROUTE_NETWORK_PLANNING_WITNESS_TOLERANCE;
}

/**
 * Validates the optional, renderer-free placement witness carried by an exact
 * route-network endpoint. The witness is a single bundle: producers either
 * omit all three fields or provide one module center, one continuation-room
 * center, and the complete orthogonal route joining their exact apertures.
 */
export function validateDungeonRouteNetworkEndpointPlanningWitness(socket, {
  moduleOverlapGrant = null,
  maximumRouteLengthMeters = ROUTE_NETWORK_MAXIMUM_PLANNING_CONTINUATION_METERS,
} = {}) {
  const witnessFields = [
    'planningModuleCenter',
    'planningContinuationCenter',
    'planningContinuationRoute',
  ];
  const declaredFields = witnessFields.filter((field) => (
    Object.prototype.hasOwnProperty.call(socket ?? {}, field)
  ));
  if (declaredFields.length === 0) {
    return deepFreezeDungeonAugmentationValue({
      accepted: true,
      present: false,
      errors: [],
      routeLengthMeters: null,
    });
  }

  const errors = [];
  if (declaredFields.length !== witnessFields.length) {
    errors.push('route-network-endpoint-planning-witness-incomplete');
  }
  const moduleCenter = socket?.planningModuleCenter;
  const continuationCenter = socket?.planningContinuationCenter;
  const route = socket?.planningContinuationRoute;
  if (!finiteHorizontalPoint(moduleCenter)) {
    errors.push('route-network-endpoint-planning-module-center-invalid');
  }
  if (!finiteHorizontalPoint(continuationCenter)) {
    errors.push('route-network-endpoint-planning-continuation-center-invalid');
  }
  if (!Array.isArray(route)
    || route.length < 2
    || !route.every(finiteHorizontalPoint)) {
    errors.push('route-network-endpoint-planning-continuation-route-invalid');
  }
  if (!finiteHorizontalPoint(socket?.position) || !cardinalHorizontalFacing(socket?.facing)) {
    errors.push('route-network-endpoint-planning-socket-invalid');
  }

  let routeLengthMeters = null;
  if (Array.isArray(route) && route.length >= 2 && route.every(finiteHorizontalPoint)) {
    const legLengths = route.slice(1).map((point, index) => (
      horizontalPointDistance(route[index], point)
    ));
    routeLengthMeters = legLengths.reduce((sum, length) => sum + length, 0);
    const orthogonal = route.slice(1).every((point, index) => {
      const deltaX = Math.abs(Number(point.x) - Number(route[index].x));
      const deltaZ = Math.abs(Number(point.z) - Number(route[index].z));
      return (deltaX > ROUTE_NETWORK_PLANNING_WITNESS_TOLERANCE)
        !== (deltaZ > ROUTE_NETWORK_PLANNING_WITNESS_TOLERANCE);
    });
    if (!orthogonal) {
      errors.push('route-network-endpoint-planning-continuation-route-not-orthogonal');
    }
    const maximum = Number(maximumRouteLengthMeters);
    if (!Number.isFinite(maximum)
      || maximum <= 0
      || routeLengthMeters > Math.min(
        maximum,
        ROUTE_NETWORK_MAXIMUM_PLANNING_CONTINUATION_METERS,
      ) + ROUTE_NETWORK_PLANNING_WITNESS_TOLERANCE) {
      errors.push('route-network-endpoint-planning-continuation-route-too-long');
    }
  }

  if (finiteHorizontalPoint(socket?.position)
    && cardinalHorizontalFacing(socket?.facing)
    && finiteHorizontalPoint(moduleCenter)) {
    const expectedModuleCenter = {
      x: Number(socket.position.x)
        + Number(socket.facing.x) * ROUTE_NETWORK_ENDPOINT_MODULE_CENTER_OFFSET_METERS,
      z: Number(socket.position.z)
        + Number(socket.facing.z) * ROUTE_NETWORK_ENDPOINT_MODULE_CENTER_OFFSET_METERS,
    };
    if (!horizontalPointsMatch(moduleCenter, expectedModuleCenter)
      || (finiteHorizontalPoint(moduleOverlapGrant?.center)
        && !horizontalPointsMatch(moduleCenter, moduleOverlapGrant.center))) {
      errors.push('route-network-endpoint-planning-module-center-mismatch');
    }
  }

  if (Array.isArray(route)
    && route.length >= 2
    && route.every(finiteHorizontalPoint)
    && cardinalHorizontalFacing(socket?.facing)
    && finiteHorizontalPoint(moduleCenter)
    && finiteHorizontalPoint(continuationCenter)) {
    const expectedRouteStart = {
      x: Number(moduleCenter.x)
        + Number(socket.facing.x) * ROUTE_NETWORK_ENDPOINT_MODULE_HALF_DEPTH_METERS,
      z: Number(moduleCenter.z)
        + Number(socket.facing.z) * ROUTE_NETWORK_ENDPOINT_MODULE_HALF_DEPTH_METERS,
    };
    const expectedRouteEnd = {
      x: Number(continuationCenter.x)
        - Number(socket.facing.x) * ROUTE_NETWORK_CONTINUATION_ROOM_HALF_SPAN_METERS,
      z: Number(continuationCenter.z)
        - Number(socket.facing.z) * ROUTE_NETWORK_CONTINUATION_ROOM_HALF_SPAN_METERS,
    };
    if (!horizontalPointsMatch(route[0], expectedRouteStart)
      || !horizontalPointsMatch(route.at(-1), expectedRouteEnd)) {
      errors.push('route-network-endpoint-planning-continuation-route-endpoint-mismatch');
    }
    if (!routeLegAlignedWithFacing(route[0], route[1], socket.facing)
      || !routeLegAlignedWithFacing(route.at(-2), route.at(-1), socket.facing)) {
      errors.push('route-network-endpoint-planning-continuation-route-facing-mismatch');
    }
  }

  return deepFreezeDungeonAugmentationValue({
    accepted: errors.length === 0,
    present: true,
    errors: [...new Set(errors)],
    routeLengthMeters,
  });
}

function validateRouteNetworkEndpointModuleOverlapGrants(grant, grantPrefix, errors) {
  const endpointSockets = Array.isArray(grant?.endpointSockets) ? grant.endpointSockets : [];
  const requiredSockets = endpointSockets.filter((socket) => (
    socket?.endpointModuleOverlapRequired === true
  ));
  const overlaps = grant?.socketModuleOverlapGrants;
  if (requiredSockets.length === 0) {
    if (overlaps !== undefined && (!Array.isArray(overlaps) || overlaps.length > 0)) {
      errors.push(`${grantPrefix}:unexpected-route-network-endpoint-module-overlap-grants`);
    }
    return;
  }
  if (!Array.isArray(overlaps)) {
    errors.push(`${grantPrefix}:missing-route-network-endpoint-module-overlap-grants`);
    return;
  }
  const requiredById = new Map(requiredSockets.map((socket) => [String(socket.id ?? ''), socket]));
  const seenTemplatesBySocketId = new Map();
  for (const [overlapIndex, overlap] of overlaps.entries()) {
    const socketId = String(overlap?.socketId ?? '');
    const socket = requiredById.get(socketId);
    const overlapPrefix = `${grantPrefix}:${socketId || overlapIndex}`;
    const moduleTemplateId = String(overlap?.moduleTemplateId ?? '');
    const variant = ROUTE_NETWORK_ENDPOINT_MODULE_VARIANTS[moduleTemplateId];
    if (!socket) {
      errors.push(`${overlapPrefix}:invalid-route-network-endpoint-module-overlap-socket`);
      continue;
    }
    const seenTemplates = seenTemplatesBySocketId.get(socketId) ?? new Set();
    if (seenTemplates.has(moduleTemplateId)) {
      errors.push(`${overlapPrefix}:duplicate-route-network-endpoint-module-overlap-template`);
      continue;
    }
    seenTemplates.add(moduleTemplateId);
    seenTemplatesBySocketId.set(socketId, seenTemplates);

    const facingX = Number(socket?.facing?.x ?? socket?.facingX ?? 0);
    const facingZ = Number(socket?.facing?.z ?? socket?.facingZ ?? 0);
    const cardinalFacing = nearlyEqual(Math.abs(facingX) + Math.abs(facingZ), 1)
      && (nearlyEqual(facingX, 0) || nearlyEqual(facingZ, 0));
    const horizontal = Math.abs(facingX) > 0;
    const longitudinalSize = Number(overlap?.size?.[horizontal ? 'x' : 'z']);
    const transverseSize = Number(overlap?.size?.[horizontal ? 'z' : 'x']);
    const widthTiles = Number(variant?.widthTiles);
    const depthTiles = Number(variant?.depthTiles);
    const leadTiles = Number(overlap?.leadTiles);
    const tileSize = transverseSize / widthTiles;
    const expectedCenter = {
      x: Number(socket?.position?.x ?? 0)
        + facingX * tileSize * (leadTiles + depthTiles * 0.5),
      y: Number(socket?.position?.y ?? 0) + tileSize * 1.5,
      z: Number(socket?.position?.z ?? 0)
        + facingZ * tileSize * (leadTiles + depthTiles * 0.5),
    };
    const expectedParentOwnerId = String(
      socket?.parentRouteId ?? socket?.logicalEdgeId ?? '',
    );
    const exactContract = nonEmptyString(overlap?.id)
      && socket?.routeNetworkSocketKind === 'authored-corridor-station'
      && overlap?.purpose === 'route-network-endpoint-module-parent-merge'
      && overlap?.moduleKind === 'connector-module'
      && Boolean(variant)
      && Number(overlap?.footprintTiles?.width) === widthTiles
      && Number(overlap?.footprintTiles?.depth) === depthTiles
      && Number(overlap?.leadTiles) === 1
      && nonEmptyString(expectedParentOwnerId)
      && String(overlap?.parentOwnerId ?? '') === expectedParentOwnerId
      && cardinalFacing
      && finitePoint(overlap?.center)
      && positiveSize(overlap?.size)
      && Number.isFinite(tileSize)
      && tileSize > 0
      && nearlyEqual(longitudinalSize, tileSize * depthTiles)
      && nearlyEqual(Number(overlap.size.y), tileSize * 3)
      && ['x', 'y', 'z'].every((axis) => nearlyEqual(
        overlap.center[axis],
        expectedCenter[axis],
      ));
    if (!exactContract) {
      errors.push(`${overlapPrefix}:invalid-route-network-endpoint-module-overlap-grant`);
    }
  }
  for (const socketId of requiredById.keys()) {
    if ((seenTemplatesBySocketId.get(socketId)?.size ?? 0) === 0) {
      errors.push(`${grantPrefix}:${socketId}:missing-route-network-endpoint-module-overlap-grant`);
    }
  }
}

function normalizeStringArray(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter(nonEmptyString)
    .map((entry) => entry.trim()))]
    .sort();
}

export function createDungeonRegionThemeBinding(input = {}) {
  const themeRef = input.themeRef ?? {};
  const binding = {
    schema: DUNGEON_REGION_THEME_SCHEMA,
    parentMapId: String(input.parentMapId ?? ''),
    parentMapRevision: String(input.parentMapRevision ?? ''),
    parentRegionId: String(input.parentRegionId ?? ''),
    themeRef: {
      id: String(themeRef.id ?? ''),
      revision: String(themeRef.revision ?? ''),
      contentHash: String(themeRef.contentHash ?? ''),
    },
    presentationVariantId: String(input.presentationVariantId ?? ''),
    localLightingProfileId: String(input.localLightingProfileId ?? ''),
    soundscapeProfileId: String(input.soundscapeProfileId ?? ''),
  };
  return deepFreezeDungeonAugmentationValue(binding);
}

export function createDungeonThemeCapabilities(input = {}) {
  return deepFreezeDungeonAugmentationValue({
    schema: DUNGEON_THEME_CAPABILITIES_SCHEMA,
    materials: normalizeStringArray(input.materials),
    assets: normalizeStringArray(input.assets),
    connectors: normalizeStringArray(input.connectors),
    transitions: normalizeStringArray(input.transitions),
  });
}

export function validateDungeonRegionThemeBinding(binding) {
  const errors = [];
  if (binding?.schema !== DUNGEON_REGION_THEME_SCHEMA) errors.push('invalid-theme-binding-schema');
  for (const key of ['parentMapId', 'parentMapRevision', 'parentRegionId']) {
    if (!nonEmptyString(binding?.[key])) errors.push(`missing-theme-binding-${key}`);
  }
  for (const key of ['id', 'revision', 'contentHash']) {
    if (!nonEmptyString(binding?.themeRef?.[key])) errors.push(`missing-theme-ref-${key}`);
  }
  return deepFreezeDungeonAugmentationValue({
    accepted: errors.length === 0,
    errors,
    bindingHash: errors.length === 0
      ? hashCanonicalValue(binding, { namespace: 'ruindivex-dungeon-region-theme/v1' })
      : null,
  });
}

export function validateDungeonExtensionHost(host) {
  const errors = [];
  const warnings = [];
  if (!DUNGEON_EXTENSION_HOST_SCHEMAS.includes(host?.schema)) errors.push('invalid-extension-host-schema');
  if (!nonEmptyString(host?.basePlanHash)) errors.push('missing-base-plan-hash');
  if (!Array.isArray(host?.extensionRegions)) errors.push('missing-extension-regions');
  const ids = new Set();
  for (const [index, region] of (host?.extensionRegions ?? []).entries()) {
    if (!nonEmptyString(region?.id)) errors.push(`missing-extension-region-id:${index}`);
    else if (ids.has(region.id)) errors.push(`duplicate-extension-region-id:${region.id}`);
    else ids.add(region.id);
    const binding = validateDungeonRegionThemeBinding(region?.themeBinding);
    errors.push(...binding.errors.map((error) => `${region?.id ?? index}:${error}`));
    if (!Array.isArray(region?.attachmentSockets)) errors.push(`${region?.id ?? index}:missing-attachment-sockets`);
    if (!Array.isArray(region?.spliceEdges)) errors.push(`${region?.id ?? index}:missing-splice-edges`);
    if (!Array.isArray(region?.allowedProfileIds)) warnings.push(`${region?.id ?? index}:no-allowed-profile-ids`);
    if (!Array.isArray(region?.delegatedProgressionBeats)) {
      warnings.push(`${region?.id ?? index}:no-delegated-progression-beats`);
    }
    if (host?.schema === DUNGEON_EXTENSION_HOST_V2_SCHEMA) {
      if (region?.progressionSnapshot?.schema !== DUNGEON_PROGRESSION_SNAPSHOT_V2_SCHEMA) {
        errors.push(`${region?.id ?? index}:missing-v2-progression-snapshot`);
      }
      if (!Array.isArray(region?.routeNetworkGrants)) {
        errors.push(`${region?.id ?? index}:missing-v2-route-network-grants`);
      }
      const grantIds = new Set();
      for (const [grantIndex, grant] of (region?.routeNetworkGrants ?? []).entries()) {
        const grantLabel = grant?.id ?? grantIndex;
        const grantPrefix = `${region?.id ?? index}:${grantLabel}`;
        if (grant?.schema !== DUNGEON_ROUTE_NETWORK_GRANT_V2_SCHEMA) {
          errors.push(`${grantPrefix}:invalid-route-network-grant-schema`);
        }
        if (!nonEmptyString(grant?.id)) {
          errors.push(`${region?.id ?? index}:${grantIndex}:missing-route-network-grant-id`);
        } else if (grantIds.has(grant.id)) {
          errors.push(`${region?.id ?? index}:${grant.id}:duplicate-route-network-grant-id`);
        } else {
          grantIds.add(grant.id);
        }
        if (!Array.isArray(grant?.endpointSockets) || grant.endpointSockets.length < 2) {
          errors.push(`${region?.id ?? index}:${grantLabel}:route-network-endpoints-required`);
        }
        if (!nonEmptyString(grant?.accessDomainId)) {
          errors.push(`${grantPrefix}:route-network-access-domain-required`);
        }
        validateRouteNetworkEndpointModuleOverlapGrants(grant, grantPrefix, errors);
        const moduleOverlapGrants = grant?.socketModuleOverlapGrants ?? [];
        const endpointSocketIds = new Set();
        for (const [socketIndex, socket] of (grant?.endpointSockets ?? []).entries()) {
          const socketId = String(socket?.id ?? '');
          const socketPrefix = `${grantPrefix}:${socketId || socketIndex}`;
          if (!nonEmptyString(socket?.id)) {
            errors.push(`${socketPrefix}:missing-route-network-endpoint-socket-id`);
          } else if (endpointSocketIds.has(socketId)) {
            errors.push(`${socketPrefix}:duplicate-route-network-endpoint-socket-id`);
          } else {
            endpointSocketIds.add(socketId);
          }
          if (!finitePoint(socket?.position)) {
            errors.push(`${socketPrefix}:invalid-route-network-endpoint-position`);
          }
          const facingX = Number(socket?.facing?.x);
          const facingZ = Number(socket?.facing?.z);
          if (!finitePoint(socket?.facing)
            || !nearlyEqual(Number(socket?.facing?.y ?? 0), 0)
            || !nearlyEqual(Math.abs(facingX) + Math.abs(facingZ), 1)
            || (!nearlyEqual(facingX, 0) && !nearlyEqual(facingZ, 0))) {
            errors.push(`${socketPrefix}:invalid-route-network-endpoint-facing`);
          }
          const witness = validateDungeonRouteNetworkEndpointPlanningWitness(socket, {
            moduleOverlapGrant: planningWitnessModuleOverlapGrant(
              socket,
              moduleOverlapGrants,
            ),
            maximumRouteLengthMeters: grant?.coverage?.maximumFeaturelessSpanMeters
              ?? ROUTE_NETWORK_MAXIMUM_PLANNING_CONTINUATION_METERS,
          });
          errors.push(...witness.errors.map((error) => `${socketPrefix}:${error}`));
        }
        if (grant?.kind === 'cross-band-shortcut') {
          const endpointBands = [...new Set((grant.endpointSockets ?? []).map((socket) => (
            Number(socket?.progressionBandId)
          )))].sort((first, second) => first - second);
          const shallowBandId = endpointBands[0];
          const deepBandId = endpointBands.at(-1);
          const shallowSocketIds = (grant.endpointSockets ?? [])
            .filter((socket) => Number(socket?.progressionBandId) === shallowBandId)
            .map(({ id }) => String(id));
          const forbiddenEndpoint = (grant.endpointSockets ?? []).some((socket) => (
            ['bossRoom', 'shrineRoom'].includes(String(socket?.roomId ?? socket?.nodeId ?? ''))
              || Number(socket?.progressionBandId) >= 3
          ));
          if (endpointBands.length !== 2
            || deepBandId - shallowBandId !== 1
            || forbiddenEndpoint
            || Number(grant.shallowProgressionBandId) !== shallowBandId
            || Number(grant.deepProgressionBandId) !== deepBandId
            || Number(grant.progressionBandId) !== deepBandId) {
            errors.push(`${grantPrefix}:cross-band-shortcut-domain-invalid`);
          }
          if (shallowSocketIds.length === 0
            || !sameContractIdSet(grant.shallowEndpointSocketIds, shallowSocketIds)) {
            errors.push(`${grantPrefix}:cross-band-shortcut-shallow-arms-invalid`);
          }
          const boundaryBand = (region?.progressionSnapshot?.bands ?? []).find((band) => (
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
            || !sameContractIdSet(grant.crossedBoundaryIds, expectedBoundaryIds)
            || !sameContractIdSet(grant.requiredCredentialIds, expectedCredentialIds)) {
            errors.push(`${grantPrefix}:cross-band-shortcut-boundary-contract-invalid`);
          }
          const sourceGate = grant.sourceGate;
          if (!sourceGate
            || !nonEmptyString(sourceGate.gateId)
            || sourceGate.supplementalIdentity !== true
            || expectedBoundaryIds.includes(String(sourceGate.gateId ?? ''))
            || sourceGate.gatePlacementSide !== 'source'
            || !sameContractIdSet(sourceGate.shallowEndpointSocketIds, shallowSocketIds)
            || String(sourceGate.sourceGateSocketId ?? '') !== shallowSocketIds[0]
            || !sameContractIdSet(sourceGate.crossedBoundaryIds, expectedBoundaryIds)
            || !sameContractIdSet(sourceGate.requiredCredentialIds, expectedCredentialIds)
            || String(sourceGate.requiredKeycardId ?? '') !== String(expectedCredentialIds[0] ?? '')) {
            errors.push(`${grantPrefix}:cross-band-shortcut-source-gate-invalid`);
          }
          if (grant.shortcutActivationSide !== 'far-side'
            || !sameContractIdSet(
              grant.allowedElevationModes,
              ['shortcut-lift', 'drop-ladder'],
            )) {
            errors.push(`${grantPrefix}:cross-band-shortcut-activation-contract-invalid`);
          }
        }
      }
    }
  }
  return deepFreezeDungeonAugmentationValue({
    accepted: errors.length === 0,
    errors,
    warnings,
  });
}

export function cloneDungeonExtensionRegions(regions = []) {
  return cloneDungeonAugmentationValue(Array.isArray(regions) ? regions : []);
}
