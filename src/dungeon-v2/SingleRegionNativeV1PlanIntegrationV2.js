import { deepFreezePlan, isSerializablePlanValue } from './DungeonPlanV2Contract.js';
import {
  LEGACY_FIXED_ROOM_GOLDEN_PLACEMENT_SPECS_V2,
} from './LegacyFixedRoomGoldenCompositionV2.js';
import { getLegacyFixedRoomModuleV2 } from './LegacyFixedRoomModuleCatalogV2.js';
import {
  compileLegacyFixedRoomPlacementV2,
  compileLegacyFixedRoomStructuralContractV2,
  compileLegacyFixedRoomSupportContractsV2,
  createLegacyFixedRoomPlanPlacementRecordV2,
} from './LegacyFixedRoomRuntimeAdapterV2.js';
import { transformPointQuarterTurns } from './DungeonSpatialMathV2.js';

const TARGETS = Object.freeze({
  sorting: 'v1-room.conveyor-gantry',
  credential: 'v1-room.credential-pyramid',
  parts: 'v1-room.parts-vault',
  nest: 'v1-room.enemy-nest',
});

function canonicalTransform(descriptorId) {
  const record = LEGACY_FIXED_ROOM_GOLDEN_PLACEMENT_SPECS_V2
    .find((candidate) => candidate.descriptorId === descriptorId);
  if (!record) throw new Error(`Canonical native V1 placement is missing for ${descriptorId}.`);
  return {
    translation: { ...record.translation },
    yawQuarterTurns: record.yawQuarterTurns,
  };
}

function spec(regionId, descriptorId, {
  portalBindings,
  anchorBindings = [],
  explicitApertures = [],
  cappedSocketIds = [],
}) {
  return {
    regionId,
    cellId: `cell.${regionId}.main`,
    placementId: `placement.${regionId}`,
    descriptorId,
    ...canonicalTransform(descriptorId),
    portalBindings,
    anchorBindings,
    explicitApertures,
    cappedSocketIds,
  };
}

export const SINGLE_REGION_NATIVE_V1_INTEGRATION_SPECS_V2 = deepFreezePlan([
  spec('sorting', TARGETS.sorting, {
    portalBindings: [
      { portalId: 'portal.security-sorting-alpha', endpoint: 'to', localSocketId: 'socket.v1-room.conveyor-gantry.ground.north-east-bucket' },
      { portalId: 'portal.sorting-freight-sump', endpoint: 'from', localSocketId: 'socket.v1-room.conveyor-gantry.pipe.east-north-bucket' },
      { portalId: 'portal.salvage-sorting-shortcut', endpoint: 'to', localSocketId: 'socket.v1-room.conveyor-gantry.catwalk.west-south-bucket' },
      { portalId: 'portal.sorting-credential-beta', endpoint: 'from', localSocketId: 'socket.v1-room.conveyor-gantry.lift.south-west-bucket' },
    ],
    anchorBindings: [
      { planAnchorId: 'anchor.encounter.sorting', descriptorAnchorId: 'anchor.encounter.sorting' },
      {
        planAnchorId: 'anchor.gate.beta',
        localSurfaceId: 'surface.v1-room.conveyor-gantry.-6.6.0',
        forward: { x: 1, y: 0, z: 0 },
        fixtureId: 'fixture.interaction.open.door-beta',
      },
      {
        planAnchorId: 'anchor.cargo-lift.upper-console',
        localSurfaceId: 'surface.v1-room.conveyor-gantry.-8.5.1',
        forward: { x: 0, y: 0, z: -1 },
        fixtureId: 'fixture.interaction.cargo-lift.recall-upper',
      },
    ],
  }),
  spec('credential', TARGETS.credential, {
    portalBindings: [
      { portalId: 'portal.sorting-credential-beta', endpoint: 'to', localSocketId: 'socket.v1-room.credential-pyramid.lift.east-north-bucket' },
      { portalId: 'portal.credential-parts', endpoint: 'from', localSocketId: 'socket.v1-room.credential-pyramid.ground.south-east-bucket' },
      { portalId: 'portal.corkscrew-credential-loop', endpoint: 'to', localSocketId: 'socket.v1-room.credential-pyramid.ground.north-west-bucket' },
    ],
    // Gamma's permanent return terminates in the Security hub.  The former
    // credential-floor aperture was a fourth, non-descriptor opening that
    // reused the same route and made a metadata-only hole in the pyramid.
    // Keep all three authored sockets singly owned and physically bounded.
  }),
  spec('parts', TARGETS.parts, {
    portalBindings: [
      { portalId: 'portal.credential-parts', endpoint: 'to', localSocketId: 'socket.v1-room.parts-vault.ground.south-east-bucket' },
      { portalId: 'portal.parts-corkscrew-service', endpoint: 'from', localSocketId: 'socket.v1-room.parts-vault.lift.east-south-bucket' },
      { portalId: 'portal.parts-nest', endpoint: 'from', localSocketId: 'socket.v1-room.parts-vault.ladder.ceiling-west-north' },
    ],
  }),
  spec('nest', TARGETS.nest, {
    portalBindings: [
      { portalId: 'portal.parts-nest', endpoint: 'to', localSocketId: 'socket.v1-room.enemy-nest.ladder.ceiling-rear' },
    ],
    // Nest is an optional dead-end treasure branch.  Backtracking through the
    // same service ladder is intentional; manufacturing a second required
    // exit made the optional room part of the critical progression chain.
    cappedSocketIds: [
      'socket.v1-room.enemy-nest.ground.west-center',
      'socket.v1-room.enemy-nest.catwalk.east-rear',
    ],
    anchorBindings: [
      { planAnchorId: 'anchor.encounter.nest', descriptorAnchorId: 'anchor.encounter.nest' },
      { planAnchorId: 'anchor.cache.nest', descriptorAnchorId: 'anchor.cache.nest', fixtureId: 'fixture.interaction.open.cache-nest' },
    ],
  }),
]);

const SPEC_BY_REGION_ID = new Map(
  SINGLE_REGION_NATIVE_V1_INTEGRATION_SPECS_V2.map((entry) => [entry.regionId, entry]),
);

function clone(value) {
  return structuredClone(value);
}

function unionBounds(records) {
  return records.reduce((result, record) => ({
    min: {
      x: Math.min(result.min.x, record.bounds.min.x),
      y: Math.min(result.min.y, record.bounds.min.y),
      z: Math.min(result.min.z, record.bounds.min.z),
    },
    max: {
      x: Math.max(result.max.x, record.bounds.max.x),
      y: Math.max(result.max.y, record.bounds.max.y),
      z: Math.max(result.max.z, record.bounds.max.z),
    },
  }), {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  });
}

function internalSurfaceLinks(surfaces, regionId, placementId) {
  const byTile = new Map();
  for (const surface of surfaces) {
    const tile = surface.localTile;
    if (!tile) continue;
    const key = `${tile.x}:${tile.z}`;
    const column = byTile.get(key) ?? [];
    column.push(surface);
    byTile.set(key, column);
  }
  const links = [];
  const pairs = new Set();
  for (const left of surfaces) {
    const tile = left.localTile;
    if (!tile) continue;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const right of byTile.get(`${tile.x + dx}:${tile.z + dz}`) ?? []) {
        if (left.id === right.id) continue;
        const pair = [left.id, right.id].sort();
        const key = pair.join('|');
        if (pairs.has(key)) continue;
        const sameRamp = left.ramp?.routeId && left.ramp.routeId === right.ramp?.routeId
          && Math.abs((left.traversalRoute?.sequenceIndex ?? 0)
            - (right.traversalRoute?.sequenceIndex ?? 0)) === 1;
        if (!sameRamp && Math.abs(left.bounds.max.y - right.bounds.max.y) > 0.31) continue;
        pairs.add(key);
        links.push({
          id: `traversal.native-${regionId}.${links.length + 1}`,
          regionId,
          fromSurfaceId: left.id,
          toSurfaceId: right.id,
          mode: left.shape === 'ramp-tile' || right.shape === 'ramp-tile'
            ? 'walkable-stairs' : 'walk',
          bidirectional: true,
          minimumWidth: 1.2,
          nativeFixedRoomPlacementId: placementId,
        });
      }
    }
  }
  return links;
}

function requiredArrays(plan) {
  for (const key of [
    'regions', 'modulePlacements', 'spatialCells', 'structuralBoundaries',
    'walkableSurfaces', 'structuralFixtures', 'traversalLinks', 'portals',
    'anchors', 'encounters', 'rewards', 'actions', 'mechanisms',
  ]) {
    if (!Array.isArray(plan?.[key])) throw new TypeError(`Native V1 integration requires plan.${key}.`);
  }
  if (!Array.isArray(plan?.minimap?.regions)) {
    throw new TypeError('Native V1 integration requires plan.minimap.regions.');
  }
}

function compileRegion(plan, integrationSpec) {
  const module = getLegacyFixedRoomModuleV2(integrationSpec.descriptorId);
  if (!module) throw new Error(`Missing native V1 descriptor ${integrationSpec.descriptorId}.`);
  const localOpenSocketIds = integrationSpec.portalBindings
    .map(({ localSocketId }) => localSocketId)
    .filter(Boolean);
  const structuralContract = compileLegacyFixedRoomStructuralContractV2(module, {
    openSocketIds: localOpenSocketIds,
  });
  const compiled = compileLegacyFixedRoomPlacementV2(module, {
    id: integrationSpec.placementId,
    translation: integrationSpec.translation,
    yawQuarterTurns: integrationSpec.yawQuarterTurns,
    structuralContract,
  });
  const placementRecord = {
    ...createLegacyFixedRoomPlanPlacementRecordV2(compiled, {
      semanticRegionIds: [integrationSpec.regionId],
    }),
    regionIds: [integrationSpec.regionId],
    occupiedCellIds: [integrationSpec.cellId],
    nativeIntegrationStatus: 'playable-plan-owned',
    cappedSocketIds: [...integrationSpec.cappedSocketIds],
    socketStateContracts: module.extensionSockets.map(({ id }) => ({
      socketId: id,
      state: localOpenSocketIds.includes(id) ? 'portal-bound' : 'opaque-capped',
    })),
  };

  const targetCellIds = new Set(plan.spatialCells
    .filter((cell) => cell.regionId === integrationSpec.regionId && cell.connector !== true)
    .map(({ id }) => id));
  if (!targetCellIds.has(integrationSpec.cellId)) {
    throw new Error(`${integrationSpec.regionId} has no primary cell ${integrationSpec.cellId}.`);
  }
  const removedSurfaceIds = new Set(plan.walkableSurfaces
    .filter(({ cellId }) => targetCellIds.has(cellId))
    .map(({ id }) => id));
  const dynamicSurfaces = plan.walkableSurfaces
    .filter(({ cellId, collision }) => targetCellIds.has(cellId) && collision === 'dynamic')
    .map(clone);
  for (const surface of dynamicSurfaces) removedSurfaceIds.delete(surface.id);

  const primaryCell = plan.spatialCells.find(({ id }) => id === integrationSpec.cellId);
  primaryCell.bounds = clone(compiled.worldBounds);
  primaryCell.nativeFixedRoomPlacementId = integrationSpec.placementId;
  primaryCell.descriptorId = integrationSpec.descriptorId;
  plan.spatialCells = plan.spatialCells.filter((cell) => (
    !targetCellIds.has(cell.id) || cell.id === integrationSpec.cellId
  ));

  const region = plan.regions.find(({ id }) => id === integrationSpec.regionId);
  const minimapRegion = plan.minimap.regions.find(({ id }) => id === integrationSpec.regionId);
  if (!region || !minimapRegion) throw new Error(`${integrationSpec.regionId} region/minimap ownership is incomplete.`);
  for (const record of [region, minimapRegion]) {
    record.bounds = clone(compiled.worldBounds);
    record.modulePlacementId = integrationSpec.placementId;
  }
  region.cellIds = [integrationSpec.cellId];

  plan.modulePlacements = [
    ...plan.modulePlacements.filter(({ regionIds = [] }) => !regionIds.includes(integrationSpec.regionId)),
    placementRecord,
  ];
  plan.structuralBoundaries = plan.structuralBoundaries
    .filter(({ cellId }) => !targetCellIds.has(cellId));
  const nativeBoundaries = compiled.structuralBoundaries.map((boundary) => ({
    ...clone(boundary),
    regionId: integrationSpec.regionId,
    cellId: integrationSpec.cellId,
    kind: boundary.openings?.length ? 'portal-frame' : 'solid',
    opaque: true,
    collider: true,
    collision: 'static',
  }));
  plan.structuralBoundaries.push(...nativeBoundaries);
  const floorBoundary = nativeBoundaries.find(({ side }) => side === 'floor');
  if (!floorBoundary) throw new Error(`${integrationSpec.descriptorId} has no native floor foundation.`);

  const groupedColliders = new Map();
  for (const collider of compiled.fixtureColliders) {
    const group = groupedColliders.get(collider.fixtureId) ?? [];
    group.push(collider);
    groupedColliders.set(collider.fixtureId, group);
  }
  const nativeFixtures = [...groupedColliders].map(([fixtureId, colliders]) => ({
    id: fixtureId,
    type: 'legacy-fixed-room-fixture',
    nativeFixtureType: 'legacy-fixed-room-fixture',
    regionId: integrationSpec.regionId,
    cellId: integrationSpec.cellId,
    bounds: unionBounds(colliders),
    gameplayPurpose: `exact native V1 ${module.displayName} fixture`,
    collision: 'blocking',
    supportBoundaryIds: [floorBoundary.id],
    visualId: `visual.${fixtureId}`,
    visualIds: [`visual.${fixtureId}`],
    colliderIds: colliders.map(({ id }) => id),
    colliderBounds: colliders.map(({ bounds }) => clone(bounds)),
    presentationOwnerId: integrationSpec.placementId,
    presentationContractId: compiled.presentation.contractId,
    descriptorReference: clone(colliders[0].descriptorReference),
  }));
  const retainedGameplayFixtures = plan.structuralFixtures.filter((fixture) => (
    targetCellIds.has(fixture.cellId)
    && (fixture.actionId || fixture.nativeRuntimeMechanismId || fixture.mechanismId)
  ));
  plan.structuralFixtures = [
    ...plan.structuralFixtures.filter(({ cellId }) => !targetCellIds.has(cellId)),
    ...nativeFixtures,
    ...retainedGameplayFixtures,
  ];

  const nativeSurfaces = compiled.walkableSurfaces.map((surface) => ({
    ...clone(surface),
    regionId: integrationSpec.regionId,
    cellId: integrationSpec.cellId,
    purpose: surface.purpose ?? `native V1 ${module.displayName} traversal surface`,
    supportBoundaryIds: [floorBoundary.id],
    supportFixtureIds: [],
    supportProfile: surface.support?.style ?? 'v1-authored-visible-support',
    visualProfile: surface.materialProfileId,
    collision: 'static',
    hazardTag: null,
    createsLedgeCandidates: false,
    ledgePolicy: 'native-internal-tile-seams-disabled',
  }));
  const supportContract = compileLegacyFixedRoomSupportContractsV2(compiled, {
    regionId: integrationSpec.regionId,
    cellId: integrationSpec.cellId,
    floorBoundaryId: floorBoundary.id,
  });
  for (const surface of nativeSurfaces) {
    surface.supportFixtureIds = [...(supportContract.surfaceSupportFixtureIds[surface.id] ?? [])];
  }
  plan.structuralFixtures.push(...clone(supportContract.fixtures));
  plan.walkableSurfaces = [
    ...plan.walkableSurfaces.filter(({ id }) => !removedSurfaceIds.has(id)),
    ...nativeSurfaces,
  ];
  for (const surface of dynamicSurfaces) {
    surface.cellId = integrationSpec.cellId;
    surface.supportBoundaryIds = [floorBoundary.id];
  }
  plan.traversalLinks = plan.traversalLinks.filter((link) => (
    !removedSurfaceIds.has(link.fromSurfaceId)
    && !removedSurfaceIds.has(link.toSurfaceId)
    && !removedSurfaceIds.has(link.viaSurfaceId)
  ));
  plan.traversalLinks.push(...internalSurfaceLinks(
    nativeSurfaces,
    integrationSpec.regionId,
    integrationSpec.placementId,
  ));

  const groundIds = nativeSurfaces.filter(({ bounds }) => (
    bounds.max.y <= compiled.worldBounds.min.y + 0.051
  )).map(({ id }) => id).sort();
  const raisedIds = nativeSurfaces.filter(({ bounds }) => (
    bounds.max.y > compiled.worldBounds.min.y + 0.051
  )).map(({ id }) => id).sort();
  region.subRegions = [
    { id: `${integrationSpec.regionId}.native-ground`, cellId: integrationSpec.cellId, purpose: `native V1 ${module.displayName} primary work floor`, surfaceIds: groundIds, nativeFixedRoomPlacementId: integrationSpec.placementId },
    ...(raisedIds.length ? [{ id: `${integrationSpec.regionId}.native-raised`, cellId: integrationSpec.cellId, purpose: `native V1 ${module.displayName} elevated exploration route`, surfaceIds: raisedIds, nativeFixedRoomPlacementId: integrationSpec.placementId }] : []),
  ];

  return {
    spec: integrationSpec,
    module,
    structuralContract,
    compiled,
    placementRecord,
    nativeBoundaries,
    nativeSurfaces,
    nativeSurfaceByLocalId: new Map(nativeSurfaces.map((surface) => [surface.localId, surface])),
    nativeFixtures,
    supportContract,
    retainedGameplayFixtures,
    removedSurfaceIds,
  };
}

function bindAnchor(plan, bundle, binding, hooks, diagnostics) {
  const planAnchor = plan.anchors.find(({ id }) => id === binding.planAnchorId);
  const descriptorAnchor = binding.descriptorAnchorId
    ? bundle.module.landmarkAnchors.find(({ id }) => id === binding.descriptorAnchorId)
    : null;
  const localSurfaceId = binding.localSurfaceId ?? descriptorAnchor?.surfaceId;
  const surface = bundle.nativeSurfaceByLocalId.get(localSurfaceId);
  if (!planAnchor || !surface || (binding.descriptorAnchorId && !descriptorAnchor)) {
    diagnostics.unresolved.push(`anchor:${binding.planAnchorId}`);
    return;
  }
  const transformed = descriptorAnchor
    ? transformPointQuarterTurns(descriptorAnchor.localPosition, bundle.placementRecord.transform)
    : surface.center;
  planAnchor.position = {
    x: transformed.x,
    y: surface.bounds.max.y,
    z: transformed.z,
  };
  if (binding.forward) {
    const forward = transformPointQuarterTurns(binding.forward, {
      translation: { x: 0, y: 0, z: 0 },
      yawQuarterTurns: bundle.placementRecord.transform.yawQuarterTurns,
    });
    planAnchor.forward = forward;
    planAnchor.forwardX = forward.x;
    planAnchor.forwardZ = forward.z;
  }
  planAnchor.surfaceId = surface.id;
  planAnchor.safeSurfaceId = surface.id;
  planAnchor.nativeDescriptorAnchorId = descriptorAnchor?.id ?? null;
  planAnchor.nativeDescriptorSurfaceId = localSurfaceId;
  planAnchor.nativeFixedRoomPlacementId = bundle.placementRecord.id;
  hooks.rebindAnchor?.(plan, binding.planAnchorId, bundle.placementRecord, {
    binding,
    descriptorAnchor,
    surface,
    bundle,
  });
  if (binding.fixtureId) {
    hooks.repositionFixture?.(plan, binding.fixtureId, binding.planAnchorId, bundle.placementRecord, {
      binding,
      surface,
      bundle,
    });
  }
  diagnostics.boundAnchorIds.push(binding.planAnchorId);
}

function rehomeContent(plan, bundle, diagnostics) {
  const anchorById = new Map(plan.anchors.map((entry) => [entry.id, entry]));
  const surfaces = bundle.nativeSurfaces;
  const nearestSurface = (point, excluded = new Set()) => surfaces
    .filter(({ id }) => !excluded.has(id))
    .sort((left, right) => (
      Math.hypot(left.center.x - point.x, left.center.z - point.z)
      - Math.hypot(right.center.x - point.x, right.center.z - point.z)
      || left.id.localeCompare(right.id)
    ))[0];
  for (const encounter of plan.encounters.filter(({ regionId }) => (
    regionId === bundle.spec.regionId
  ))) {
    const anchor = anchorById.get(encounter.anchorId);
    const first = bundle.nativeSurfaces.find(({ id }) => id === anchor?.surfaceId);
    const second = first ? nearestSurface(first.center, new Set([first.id])) : null;
    if (!first || !second) {
      diagnostics.unresolved.push(`encounter:${encounter.id}`);
      continue;
    }
    encounter.spawnSurfaceIds = [first.id, second.id];
    encounter.spawnPoints = [first, second].map((surface) => ({
      x: surface.center.x,
      y: surface.bounds.max.y,
      z: surface.center.z,
    }));
    encounter.spawnPattern.points = clone(encounter.spawnPoints);
    encounter.zoneBounds = {
      min: {
        x: bundle.compiled.worldBounds.min.x + 1.2,
        y: bundle.compiled.worldBounds.min.y,
        z: bundle.compiled.worldBounds.min.z + 1.2,
      },
      max: {
        x: bundle.compiled.worldBounds.max.x - 1.2,
        y: bundle.compiled.worldBounds.max.y,
        z: bundle.compiled.worldBounds.max.z - 1.2,
      },
    };
    encounter.triggerZoneBounds = clone(encounter.zoneBounds);
    encounter.nativeFixedRoomPlacementId = bundle.placementRecord.id;
    diagnostics.rehomedEncounterIds.push(encounter.id);
  }
  for (const reward of plan.rewards.filter(({ regionId }) => (
    regionId === bundle.spec.regionId
  ))) {
    const anchor = anchorById.get(reward.anchorId);
    if (!anchor?.surfaceId?.startsWith(`${bundle.placementRecord.id}:`)) {
      diagnostics.unresolved.push(`reward:${reward.id}`);
      continue;
    }
    reward.nativeFixedRoomPlacementId = bundle.placementRecord.id;
    reward.nativeSupportSurfaceId = anchor.surfaceId;
    diagnostics.rehomedRewardIds.push(reward.id);
  }
}

function rehomeSortingCargo(plan, bundle, diagnostics) {
  if (bundle.spec.regionId !== 'sorting') return;
  const mechanism = plan.mechanisms.find(({ id }) => id === 'mechanism.sorting-cargo');
  const dynamicSurface = plan.walkableSurfaces.find(({ id }) => id === 'surface.sorting.moving-cargo');
  const spawner = bundle.module.landmarkAnchors.find(({ id }) => id === 'anchor.cargo.spawner');
  const receiver = bundle.module.landmarkAnchors.find(({ id }) => id === 'anchor.cargo.receiver');
  const startSurface = bundle.nativeSurfaceByLocalId.get(spawner?.surfaceId);
  const endSurface = bundle.nativeSurfaceByLocalId.get(receiver?.surfaceId);
  if (!mechanism || !dynamicSurface || !spawner || !receiver || !startSurface || !endSurface) {
    diagnostics.unresolved.push('mechanism:mechanism.sorting-cargo');
    return;
  }
  const start = transformPointQuarterTurns(spawner.localPosition, bundle.placementRecord.transform);
  const end = transformPointQuarterTurns(receiver.localPosition, bundle.placementRecord.transform);
  const positions = [start, end].map((point, index) => ({
    x: point.x,
    y: [startSurface, endSurface][index].bounds.max.y,
    z: point.z,
  }));
  for (const [index, state] of mechanism.states.entries()) {
    state.position = clone(positions[Math.min(index, 1)]);
    state.landingSurfaceId = [startSurface.id, endSurface.id][Math.min(index, 1)];
  }
  const halfExtent = Number(mechanism.runtimeProfile?.platformHalfExtent ?? 2.2);
  dynamicSurface.regionId = 'sorting';
  dynamicSurface.cellId = bundle.spec.cellId;
  dynamicSurface.bounds = {
    min: { x: positions[0].x - halfExtent, y: positions[0].y, z: positions[0].z - halfExtent },
    max: { x: positions[0].x + halfExtent, y: positions[0].y + 0.35, z: positions[0].z + halfExtent },
  };
  dynamicSurface.geometry.routeBounds = {
    min: {
      x: Math.min(...positions.map(({ x }) => x)) - halfExtent,
      y: Math.min(...positions.map(({ y }) => y)),
      z: Math.min(...positions.map(({ z }) => z)) - halfExtent,
    },
    max: {
      x: Math.max(...positions.map(({ x }) => x)) + halfExtent,
      y: Math.max(...positions.map(({ y }) => y)) + 0.35,
      z: Math.max(...positions.map(({ z }) => z)) + halfExtent,
    },
  };
  dynamicSurface.supportBoundaryIds = bundle.nativeBoundaries
    .filter(({ side }) => side === 'ceiling')
    .slice(0, 1)
    .map(({ id }) => id);
  dynamicSurface.nativeFixedRoomPlacementId = bundle.placementRecord.id;
  diagnostics.rehomedMechanismIds.push(mechanism.id);
}

/**
 * Compile and install the four one-region Dungeon V1 room descriptors.
 *
 * Connector geometry is deliberately delegated to Golden's authoritative
 * connector compiler. `bindPortalEndpoint` must bind the exact compiled
 * socket/aperture and `rebuildPortalConnector` must replace its old route;
 * this helper will not claim success if either hook is absent or unresolved.
 */
export function integrateSingleRegionNativeV1ModulesV2(plan, hooks = {}) {
  requiredArrays(plan);
  if (Object.isFrozen(plan)) {
    throw new TypeError('Single-region native V1 integration requires the mutable in-progress plan.');
  }
  if (typeof hooks.bindPortalEndpoint !== 'function'
    || typeof hooks.rebuildPortalConnector !== 'function') {
    throw new TypeError('Native V1 integration requires bindPortalEndpoint and rebuildPortalConnector hooks.');
  }
  const diagnostics = {
    schemaVersion: 'single-region-native-v1-integration/1',
    placementIds: [],
    descriptorIds: [],
    boundPortalEndpoints: [],
    rebuiltPortalIds: [],
    boundAnchorIds: [],
    rehomedEncounterIds: [],
    rehomedRewardIds: [],
    rehomedMechanismIds: [],
    surfaceIds: [],
    fixtureIds: [],
    unresolved: [],
  };
  const bundles = new Map();
  for (const integrationSpec of SINGLE_REGION_NATIVE_V1_INTEGRATION_SPECS_V2) {
    const bundle = compileRegion(plan, integrationSpec);
    bundles.set(integrationSpec.regionId, bundle);
    diagnostics.placementIds.push(bundle.placementRecord.id);
    diagnostics.descriptorIds.push(bundle.module.id);
    diagnostics.surfaceIds.push(...bundle.nativeSurfaces.map(({ id }) => id));
    diagnostics.fixtureIds.push(
      ...bundle.nativeFixtures.map(({ id }) => id),
      ...bundle.supportContract.fixtures.map(({ id }) => id),
    );
  }

  const portalsToRebuild = new Set();
  for (const integrationSpec of SINGLE_REGION_NATIVE_V1_INTEGRATION_SPECS_V2) {
    const bundle = bundles.get(integrationSpec.regionId);
    for (const binding of integrationSpec.portalBindings) {
      const portal = plan.portals.find(({ id }) => id === binding.portalId);
      const socketRef = binding.localSocketId
        ? {
            type: 'descriptor-socket',
            localSocketId: binding.localSocketId,
            socket: bundle.compiled.portals.find(({ localId }) => localId === binding.localSocketId),
            bundle,
          }
        : {
            type: 'authored-extension-aperture',
            aperture: integrationSpec.explicitApertures
              .find(({ id }) => id === binding.explicitApertureId),
            bundle,
          };
      if (!portal || (socketRef.type === 'descriptor-socket' && !socketRef.socket)
        || (socketRef.type === 'authored-extension-aperture' && !socketRef.aperture)) {
        diagnostics.unresolved.push(`portal:${binding.portalId}:${binding.endpoint}`);
        continue;
      }
      const result = hooks.bindPortalEndpoint(
        plan,
        binding.portalId,
        binding.endpoint,
        bundle.placementRecord,
        socketRef,
      );
      if (!result) {
        diagnostics.unresolved.push(`portal:${binding.portalId}:${binding.endpoint}`);
        continue;
      }
      diagnostics.boundPortalEndpoints.push(`${binding.portalId}:${binding.endpoint}`);
      portalsToRebuild.add(binding.portalId);
    }
    for (const binding of integrationSpec.anchorBindings) {
      bindAnchor(plan, bundle, binding, hooks, diagnostics);
    }
    rehomeContent(plan, bundle, diagnostics);
    rehomeSortingCargo(plan, bundle, diagnostics);
  }

  for (const portalId of [...portalsToRebuild].sort()) {
    const result = hooks.rebuildPortalConnector(plan, portalId);
    if (!result) diagnostics.unresolved.push(`connector:${portalId}`);
    else diagnostics.rebuiltPortalIds.push(portalId);
  }

  const integration = plan.nativeFixedRoomIntegration ?? {
    requiredPlacementCount: 11,
    activePlacementIds: [],
    activeDescriptorIds: [],
    incompleteDescriptorIds: [],
    genericFallbackGeometry: false,
  };
  if (diagnostics.unresolved.length === 0) {
    integration.activePlacementIds = [...new Set([
      ...integration.activePlacementIds,
      ...diagnostics.placementIds,
    ])].sort();
    integration.activeDescriptorIds = [...new Set([
      ...integration.activeDescriptorIds,
      ...diagnostics.descriptorIds,
    ])].sort();
    integration.incompleteDescriptorIds = integration.incompleteDescriptorIds
      .filter((id) => !diagnostics.descriptorIds.includes(id));
  }
  integration.genericFallbackGeometry = false;
  plan.nativeFixedRoomIntegration = integration;

  diagnostics.placementIds.sort();
  diagnostics.descriptorIds.sort();
  diagnostics.boundPortalEndpoints.sort();
  diagnostics.boundAnchorIds.sort();
  diagnostics.rehomedEncounterIds.sort();
  diagnostics.rehomedRewardIds.sort();
  diagnostics.rehomedMechanismIds.sort();
  diagnostics.surfaceIds.sort();
  diagnostics.fixtureIds.sort();
  diagnostics.unresolved.sort();
  diagnostics.accepted = diagnostics.unresolved.length === 0;
  if (!isSerializablePlanValue(diagnostics)) {
    throw new Error('Single-region native V1 integration diagnostics must remain serializable.');
  }
  plan.singleRegionNativeV1IntegrationDiagnostics = clone(diagnostics);
  return deepFreezePlan(clone(diagnostics));
}

export function getSingleRegionNativeV1IntegrationSpecV2(regionId) {
  return SPEC_BY_REGION_ID.get(regionId) ?? null;
}

export default integrateSingleRegionNativeV1ModulesV2;
