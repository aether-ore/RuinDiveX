import {
  clonePlanData,
  deepFreezePlan,
  isSerializablePlanValue,
} from './DungeonPlanV2Contract.js';
import {
  createLegacyFixedRoomGoldenCompositionV2,
} from './LegacyFixedRoomGoldenCompositionV2.js';
import {
  compileLegacyFixedRoomPlacementV2,
  compileLegacyFixedRoomStructuralContractV2,
  compileLegacyFixedRoomSupportContractsV2,
  createLegacyFixedRoomPlanPlacementRecordV2,
  recompileAcceptedLegacyFixedRoomPlacementV2,
} from './LegacyFixedRoomRuntimeAdapterV2.js';
import { deriveDungeonTopologySignaturesV2 } from './DungeonTopologySignatureV2.js';
import {
  rotatePointQuarterTurns,
  transformPointQuarterTurns,
} from './DungeonSpatialMathV2.js';

export const CANONICAL_NATIVE_V1_GOLDEN_INTEGRATION_REVISION_V2 = 1;

const REQUIRED_PACK_PLACEMENT_IDS = Object.freeze([
  'placement.semantic-room-pack.factory-corkscrew',
  'placement.semantic-room-pack.waterworks-freight-sump',
  'placement.semantic-room-pack.undercroft',
]);

const PRIMARY_REGION_BY_PLACEMENT_ID = Object.freeze({
  'placement.security': 'security',
  'placement.machine': 'assembly',
  'placement.server': 'server',
  'placement.coolant': 'reservoir',
  'placement.conveyor': 'sorting',
  'placement.credential': 'credential',
  'placement.parts': 'parts',
  'placement.nest': 'nest',
  'placement.core': 'machine-core',
  'placement.shrine': 'extraction',
  'placement.hazard': 'hazard-intake',
});

// This set is deliberately derived from the stable Golden portal ledger, not
// from the older fourteen-edge composition graph. The descriptor graph proves
// that all eleven V1 rooms can coexist; the accepted Golden fixture physically
// routes twenty-one stable portals plus one auxiliary service return. Compiling
// only these socket apertures prevents an opaque cap from surviving across a
// live route and prevents unused apertures from exposing the exterior.
const CANONICAL_OPEN_SOCKET_SUFFIXES_BY_PLACEMENT_KEY = Object.freeze({
  security: Object.freeze([
    'ground.south-center',
    'ground.east-south-bucket',
    'lift.west-south-bucket',
    'ground.north-center',
  ]),
  machine: Object.freeze([
    'ground.south-east-bucket',
    'catwalk.north-center',
    'lower.freight-catchment',
  ]),
  server: Object.freeze([
    'ground.south-east-bucket',
    'catwalk.north-center',
    'ladder.ceiling-east-catwalk',
  ]),
  coolant: Object.freeze([
    'pipe.east-center',
    'catwalk.north-east-bucket',
    'ground.south-west-bucket',
    'lift.west-center',
  ]),
  conveyor: Object.freeze([
    'catwalk.west-south-bucket',
    'ground.north-east-bucket',
    'pipe.east-north-bucket',
    'lift.south-west-bucket',
  ]),
  credential: Object.freeze([
    'lift.east-north-bucket',
    'ground.south-east-bucket',
    'ground.north-west-bucket',
  ]),
  parts: Object.freeze([
    'ground.south-east-bucket',
    'lift.east-south-bucket',
    'ladder.ceiling-west-north',
  ]),
  nest: Object.freeze(['ladder.ceiling-rear']),
  core: Object.freeze(['ground.west-south-bucket', 'gear.north-upper']),
  shrine: Object.freeze(['catwalk.north-east-bucket']),
  hazard: Object.freeze([
    'ground.south-east-bucket',
    'lower.intentional-west',
    'lift.east-center',
    'pipe.west-south-bucket',
  ]),
});

const EPSILON = 1e-6;
const STABLE_GOLDEN_PORTAL_COUNT = 21;

function vector(x, y, z) {
  return { x: Number(x), y: Number(y), z: Number(z) };
}

function unionBounds(records) {
  const bounds = records.map((record) => record.bounds ?? record)
    .filter((record) => record?.min && record?.max);
  if (!bounds.length) return null;
  return {
    min: vector(
      Math.min(...bounds.map(({ min }) => min.x)),
      Math.min(...bounds.map(({ min }) => min.y)),
      Math.min(...bounds.map(({ min }) => min.z)),
    ),
    max: vector(
      Math.max(...bounds.map(({ max }) => max.x)),
      Math.max(...bounds.map(({ max }) => max.y)),
      Math.max(...bounds.map(({ max }) => max.z)),
    ),
  };
}

function assertMutableGolden(plan) {
  if (!plan || plan.fixtureKind !== 'golden-complex') {
    throw new TypeError('Canonical native V1 integration requires a mutable Golden DungeonPlanV2.');
  }
  for (const key of [
    'regions', 'modulePlacements', 'semanticRoomPackPlacements', 'spatialCells',
    'structuralBoundaries', 'walkableSurfaces', 'structuralFixtures',
    'traversalLinks', 'anchors', 'safeAnchors', 'actions', 'encounters', 'rewards',
  ]) {
    if (!Array.isArray(plan[key]) || Object.isFrozen(plan[key])) {
      throw new TypeError(`Canonical native V1 integration requires mutable plan.${key}.`);
    }
  }
  if (!Array.isArray(plan.minimap?.regions) || Object.isFrozen(plan.minimap.regions)) {
    throw new TypeError('Canonical native V1 integration requires mutable plan.minimap.regions.');
  }
  const placementIds = new Set(plan.semanticRoomPackPlacements.map(({ placementId, id }) => (
    placementId ?? id
  )));
  for (const placementId of REQUIRED_PACK_PLACEMENT_IDS) {
    if (!placementIds.has(placementId)) {
      throw new Error(`Canonical coexistence requires authored pack placement ${placementId} first.`);
    }
  }
}

function collectPackOwnership(plan) {
  const placementIds = new Set(REQUIRED_PACK_PLACEMENT_IDS);
  const cellIds = new Set();
  const boundaryIds = new Set();
  const surfaceIds = new Set();
  const fixtureIds = new Set();
  const colliderIds = new Set();
  for (const placement of plan.semanticRoomPackPlacements) {
    placementIds.add(placement.placementId ?? placement.id);
    const records = placement.placedRecordIds ?? {};
    for (const id of records.structuralBoundaryIds ?? []) boundaryIds.add(id);
    for (const id of records.walkableSurfaceIds ?? []) surfaceIds.add(id);
    for (const id of records.structuralFixtureIds ?? []) fixtureIds.add(id);
    for (const id of records.colliderIds ?? []) colliderIds.add(id);
  }
  for (const cell of plan.spatialCells) {
    if (placementIds.has(cell.semanticRoomPackPlacementId)) cellIds.add(cell.id);
  }
  for (const boundary of plan.structuralBoundaries) {
    if (placementIds.has(boundary.semanticRoomPackPlacementId)) boundaryIds.add(boundary.id);
  }
  for (const surface of plan.walkableSurfaces) {
    if (placementIds.has(surface.semanticRoomPackPlacementId)) surfaceIds.add(surface.id);
  }
  for (const fixture of plan.structuralFixtures) {
    if (placementIds.has(fixture.semanticRoomPackPlacementId)) fixtureIds.add(fixture.id);
  }
  return { placementIds, cellIds, boundaryIds, surfaceIds, fixtureIds, colliderIds };
}

function packOwned(record, ownership, idSetName) {
  return ownership.placementIds.has(record.semanticRoomPackPlacementId)
    || ownership[idSetName].has(record.id)
    || (record.cellId && ownership.cellIds.has(record.cellId));
}

function boundsSlice(bounds, index, count) {
  if (count <= 1) return clonePlanData(bounds);
  const span = bounds.max.x - bounds.min.x;
  const minX = bounds.min.x + span * (index / count);
  const maxX = bounds.min.x + span * ((index + 1) / count);
  return {
    min: vector(minX, bounds.min.y, bounds.min.z),
    max: vector(maxX, bounds.max.y, bounds.max.z),
  };
}

function selectorOwnsSurface(selector, surface, module) {
  if (!selector) return false;
  if (selector.kind === 'extension-zone') {
    const socket = module.extensionSockets.find(({ id }) => id === selector.extensionSocketId);
    // An outward branch may use the native landing deck as its semantic entry
    // zone. A paired fall catchment is different: its lower playable region is
    // installed by the connection coordinator and must not relabel the upper
    // source deck as the destination region.
    return socket?.aperture?.pairedCatchmentRequired !== true
      && (socket?.approachSurfaceIds ?? []).includes(surface.localId);
  }
  if (selector.kind === 'surface-and-fixture-zone') {
    return (selector.includeSourceSurfaces ?? []).includes(surface.sourceSurface);
  }
  if (selector.kind === 'surface-source-prefixes') {
    return (selector.prefixes ?? []).some((prefix) => (
      String(surface.sourceSurface ?? '').startsWith(prefix)
    ));
  }
  if (selector.kind !== 'local-tile-zone' || !surface.localTile) return false;
  const { x, z, level } = surface.localTile;
  const inside = x >= selector.minX && x <= selector.maxX
    && z >= selector.minZ && z <= selector.maxZ
    && (!(selector.includeLevels?.length)
      || selector.includeLevels.some((candidate) => Math.abs(candidate - level) <= EPSILON));
  const excluded = selector.excludeRect
    && x >= selector.excludeRect.minX && x <= selector.excludeRect.maxX
    && z >= selector.excludeRect.minZ && z <= selector.excludeRect.maxZ;
  return inside && !excluded;
}

function semanticRegionForSurface(surface, module, primaryRegionId) {
  for (const semanticRegion of module.semanticRegions) {
    if (selectorOwnsSurface(semanticRegion.surfaceSelector, surface, module)) return semanticRegion.id;
  }
  // Exact selectors intentionally omit ordinary circulation tiles and
  // extension-only regions. Keep those tiles in the chamber's primary authored
  // region instead of inventing an arbitrary axis slice that can put the room
  // entrance, encounter, or controls in the wrong semantic area.
  return primaryRegionId;
}

function fixtureGroups(compiled) {
  const groups = new Map();
  for (const collider of compiled.fixtureColliders) {
    const group = groups.get(collider.fixtureId) ?? [];
    group.push(collider);
    groups.set(collider.fixtureId, group);
  }
  return groups;
}

function socketIdBySuffix(module, suffix) {
  const matches = module.extensionSockets.filter(({ id }) => id.endsWith(`.${suffix}`));
  if (matches.length !== 1) {
    throw new Error(`${module.id} expected one canonical socket ending .${suffix}; received ${matches.length}.`);
  }
  return matches[0].id;
}

function createCanonicalAcceptedPlacement(acceptedPlacement) {
  // First prove that the immutable descriptor-composition placement is still
  // internally valid. Then issue a new accepted record for the final Golden
  // aperture set; mutating only localOpenSocketIds would intentionally fail the
  // runtime adapter's structural signature and placed-record parity checks.
  const { module } = recompileAcceptedLegacyFixedRoomPlacementV2(acceptedPlacement);
  const suffixes = CANONICAL_OPEN_SOCKET_SUFFIXES_BY_PLACEMENT_KEY[acceptedPlacement.key];
  if (!suffixes) throw new Error(`${acceptedPlacement.id} has no canonical Golden socket set.`);
  const localOpenSocketIds = suffixes.map((suffix) => socketIdBySuffix(module, suffix)).sort();
  const structuralContract = compileLegacyFixedRoomStructuralContractV2(module, {
    openSocketIds: localOpenSocketIds,
  });
  const compiled = compileLegacyFixedRoomPlacementV2(module, {
    id: acceptedPlacement.id,
    translation: acceptedPlacement.transform?.translation,
    yawQuarterTurns: acceptedPlacement.transform?.yawQuarterTurns,
    structuralContract,
  });
  return {
    ...clonePlanData(createLegacyFixedRoomPlanPlacementRecordV2(compiled, {
      semanticRegionIds: module.semanticRegions.map(({ id }) => id),
    })),
    key: acceptedPlacement.key,
    optional: acceptedPlacement.optional === true,
  };
}

function compilePlacementBundle(acceptedPlacement) {
  acceptedPlacement = createCanonicalAcceptedPlacement(acceptedPlacement);
  const { module, expectedPlacement: compiled } = recompileAcceptedLegacyFixedRoomPlacementV2(
    acceptedPlacement,
  );
  const semanticRegionIds = module.semanticRegions.map(({ id }) => id);
  const primaryRegionId = PRIMARY_REGION_BY_PLACEMENT_ID[acceptedPlacement.id];
  if (!primaryRegionId || !semanticRegionIds.includes(primaryRegionId)) {
    throw new Error(`${acceptedPlacement.id} has no canonical primary semantic region.`);
  }
  const physicalCellId = `cell.native-v1.${acceptedPlacement.key}.shell`;
  const floorBoundary = compiled.structuralBoundaries.find(({ side }) => side === 'floor');
  if (!floorBoundary) throw new Error(`${acceptedPlacement.id} has no native floor foundation.`);
  const supportContract = compileLegacyFixedRoomSupportContractsV2(compiled, {
    regionId: primaryRegionId,
    cellId: physicalCellId,
    floorBoundaryId: floorBoundary.id,
  });
  const surfaces = compiled.walkableSurfaces.map((surface) => {
    const regionId = semanticRegionForSurface(surface, module, primaryRegionId);
    return {
      ...clonePlanData(surface),
      regionId,
      cellId: physicalCellId,
      purpose: surface.purpose ?? `native V1 ${module.displayName} authored traversal`,
      supportBoundaryIds: [floorBoundary.id],
      supportFixtureIds: [...(supportContract.surfaceSupportFixtureIds[surface.id] ?? [])],
      supportProfile: surface.support?.style ?? 'v1-authored-visible-support',
      visualProfile: surface.materialProfileId,
      collision: 'static',
      createsLedgeCandidates: false,
      ledgePolicy: 'native-internal-tile-seams-disabled',
      nativeFixedRoomPlacementId: acceptedPlacement.id,
      presentationOwnerId: acceptedPlacement.id,
    };
  });
  const boundaries = compiled.structuralBoundaries.map((boundary) => ({
    ...clonePlanData(boundary),
    regionId: primaryRegionId,
    cellId: physicalCellId,
    kind: boundary.openings?.length ? 'portal-frame' : 'solid',
    opaque: true,
    collider: true,
    collision: 'static',
    nativeFixedRoomPlacementId: acceptedPlacement.id,
    presentationOwnerId: acceptedPlacement.id,
  }));
  const fixtures = [...fixtureGroups(compiled)].map(([fixtureId, colliders]) => ({
    id: fixtureId,
    type: 'legacy-fixed-room-fixture',
    nativeFixtureType: 'legacy-fixed-room-fixture',
    regionId: primaryRegionId,
    cellId: physicalCellId,
    bounds: unionBounds(colliders),
    gameplayPurpose: `exact native V1 ${module.displayName} authored fixture`,
    collision: 'blocking',
    supportBoundaryIds: [floorBoundary.id],
    visualId: `visual.${fixtureId}`,
    visualIds: [`visual.${fixtureId}`],
    colliderIds: colliders.map(({ id }) => id),
    colliderBounds: colliders.map(({ bounds }) => clonePlanData(bounds)),
    presentationOwnerId: acceptedPlacement.id,
    presentationContractId: compiled.presentation.contractId,
    nativeFixedRoomPlacementId: acceptedPlacement.id,
    descriptorReference: clonePlanData(colliders[0].descriptorReference),
  }));
  fixtures.push(...clonePlanData(supportContract.fixtures).map((fixture) => ({
    ...fixture,
    nativeFixedRoomPlacementId: acceptedPlacement.id,
    presentationOwnerId: acceptedPlacement.id,
  })));
  const physicalCell = {
    id: physicalCellId,
    regionId: primaryRegionId,
    semanticRegionIds: [...semanticRegionIds],
    bounds: clonePlanData(compiled.worldBounds),
    playable: true,
    interior: true,
    cameraContained: true,
    occupiedVolume: true,
    compoundId: `compound.native-v1.${acceptedPlacement.key}`,
    compoundShell: true,
    nativeFixedRoomPlacementId: acceptedPlacement.id,
    presentationOwnerId: acceptedPlacement.id,
  };
  // A multi-purpose V1 chamber is one physical enclosed volume. Its semantic
  // areas are region-owned surface zones, not duplicate acceptance cells. A
  // previous implementation inserted unbounded `occupiedVolume:false` slices
  // into spatialCells; the shared validator correctly treated all six faces of
  // every slice as exposed void. Keep those slices as data-only bounds below
  // and register only the exact authored shell as a spatial cell.
  const semanticZones = semanticRegionIds.map((regionId, index) => ({
    id: `zone.native-v1.${acceptedPlacement.key}.${regionId}`,
    regionId,
    bounds: (() => {
      const surfaceBounds = unionBounds(surfaces.filter((surface) => (
        surface.regionId === regionId
      )));
      if (!surfaceBounds) return boundsSlice(compiled.worldBounds, index, semanticRegionIds.length);
      return {
        min: vector(surfaceBounds.min.x, compiled.worldBounds.min.y, surfaceBounds.min.z),
        max: vector(surfaceBounds.max.x, compiled.worldBounds.max.y, surfaceBounds.max.z),
      };
    })(),
    sharedPhysicalCellId: physicalCell.id,
    nativeFixedRoomPlacementId: acceptedPlacement.id,
  }));
  const occupiedCellIds = [physicalCell.id];
  const placement = {
    ...clonePlanData(acceptedPlacement),
    regionIds: [...semanticRegionIds],
    semanticRegionIds: [...semanticRegionIds],
    occupiedCellIds,
    nativeIntegrationStatus: 'playable-plan-owned',
    bounds: clonePlanData(compiled.worldBounds),
    socketStateContracts: module.extensionSockets.map(({ id }) => ({
      socketId: id,
      state: acceptedPlacement.localOpenSocketIds.includes(id)
        ? 'portal-bound' : 'opaque-capped',
    })),
  };
  return {
    module,
    compiled,
    placement,
    primaryRegionId,
    semanticRegionIds,
    physicalCell,
    semanticZones,
    surfaces,
    boundaries,
    fixtures,
  };
}

function installRegionOwnership(plan, bundle) {
  for (const [index, regionId] of bundle.semanticRegionIds.entries()) {
    const region = plan.regions.find(({ id }) => id === regionId);
    const minimapRegion = plan.minimap?.regions?.find(({ id }) => id === regionId);
    if (!region || !minimapRegion) {
      throw new Error(`${bundle.placement.id} cannot resolve semantic region ${regionId}.`);
    }
    const semanticZone = bundle.semanticZones[index];
    const ownedSurfaces = bundle.surfaces.filter((surface) => surface.regionId === regionId);
    region.bounds = clonePlanData(semanticZone.bounds);
    minimapRegion.bounds = clonePlanData(semanticZone.bounds);
    region.modulePlacementId = bundle.placement.id;
    minimapRegion.modulePlacementId = bundle.placement.id;
    region.cellIds = [bundle.physicalCell.id];
    region.subRegions = [{
      id: `${regionId}.native-v1-authored-zone`,
      cellId: bundle.physicalCell.id,
      bounds: clonePlanData(semanticZone.bounds),
      purpose: `${bundle.module.displayName} authored ${regionId} exploration zone`,
      surfaceIds: ownedSurfaces.map(({ id }) => id),
      nativeFixedRoomPlacementId: bundle.placement.id,
      sharedPhysicalCellId: bundle.physicalCell.id,
    }];
  }
}

function descriptorAnchors(bundles) {
  const anchors = new Map();
  for (const bundle of bundles) {
    for (const anchor of bundle.module.landmarkAnchors ?? []) {
      anchors.set(anchor.id, { bundle, descriptorAnchor: anchor });
    }
  }
  return anchors;
}

function shiftBounds(bounds, delta) {
  if (!bounds?.min || !bounds?.max) return bounds;
  return {
    min: vector(bounds.min.x + delta.x, bounds.min.y + delta.y, bounds.min.z + delta.z),
    max: vector(bounds.max.x + delta.x, bounds.max.y + delta.y, bounds.max.z + delta.z),
  };
}

function transformPointBetweenPlacements(point, fromTransform, toTransform) {
  const fromTranslation = fromTransform?.translation ?? { x: 0, y: 0, z: 0 };
  const local = rotatePointQuarterTurns({
    x: point.x - fromTranslation.x,
    y: point.y - fromTranslation.y,
    z: point.z - fromTranslation.z,
  }, -(fromTransform?.yawQuarterTurns ?? 0));
  return transformPointQuarterTurns(local, toTransform);
}

function captureAssemblyTraversalContract(plan) {
  const link = plan.traversalLinks.find(({ id }) => id === 'traversal.assembly.landmark-stairs');
  const placement = plan.modulePlacements.find(({ id }) => id === 'placement.assembly');
  if (!link || !placement?.transform) return null;
  const surfaces = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
  return {
    link: clonePlanData(link),
    viaSurface: clonePlanData(surfaces.get(link.viaSurfaceId)),
    placementTransform: clonePlanData(placement.transform),
    localSurfaceIdByWorldId: new Map(plan.walkableSurfaces
      .filter(({ presentationOwnerId }) => presentationOwnerId === placement.id)
      .map((surface) => [surface.id, surface.localId])),
  };
}

function remapNestedNativeTraversalValue(value, surfaceIdMap, transformPoint) {
  if (typeof value === 'string') return surfaceIdMap.get(value) ?? value;
  if (Array.isArray(value)) {
    return value.map((entry) => remapNestedNativeTraversalValue(
      entry,
      surfaceIdMap,
      transformPoint,
    ));
  }
  if (!value || typeof value !== 'object') return value;
  const remapped = Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    remapNestedNativeTraversalValue(entry, surfaceIdMap, transformPoint),
  ]));
  if (['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]))) {
    Object.assign(remapped, transformPoint(value));
  }
  return remapped;
}

function installAssemblyTraversalContract(plan, snapshot, machineBundle) {
  if (!snapshot) return null;
  const newSurfaceByLocalId = new Map(machineBundle.surfaces.map((surface) => (
    [surface.localId, surface]
  )));
  const surfaceIdMap = new Map();
  for (const [oldId, localId] of snapshot.localSurfaceIdByWorldId) {
    const replacement = newSurfaceByLocalId.get(localId);
    if (replacement) surfaceIdMap.set(oldId, replacement.id);
  }
  const transformPoint = (point) => transformPointBetweenPlacements(
    point,
    snapshot.placementTransform,
    machineBundle.placement.transform,
  );
  const link = remapNestedNativeTraversalValue(
    snapshot.link,
    surfaceIdMap,
    transformPoint,
  );
  link.nativeFixedRoomPlacementId = machineBundle.placement.id;
  const stairSurface = plan.walkableSurfaces.find(({ id }) => id === link.viaSurfaceId);
  if (!stairSurface || !snapshot.viaSurface?.stairs) {
    throw new Error('Canonical Machine Factory lost its exact eleven-tile Assembly ramp contract.');
  }
  stairSurface.stairs = remapNestedNativeTraversalValue(
    snapshot.viaSurface.stairs,
    surfaceIdMap,
    transformPoint,
  );
  plan.traversalLinks.push(link);
  return { surfaceIdMap, transformPoint, link };
}

function rehomeInteractionFixtures(plan, anchor, oldPosition, surface) {
  const actionIds = new Set(plan.actions
    .filter(({ anchorId }) => anchorId === anchor.id)
    .map(({ id }) => id));
  const fixtureIds = new Set(plan.actions
    .filter(({ anchorId }) => anchorId === anchor.id)
    .flatMap(({ visualFixtureIds = [] }) => visualFixtureIds));
  const delta = {
    x: anchor.position.x - oldPosition.x,
    y: anchor.position.y - oldPosition.y,
    z: anchor.position.z - oldPosition.z,
  };
  for (const fixture of plan.structuralFixtures.filter((candidate) => (
    fixtureIds.has(candidate.id) || actionIds.has(candidate.actionId)
  ))) {
    fixture.bounds = shiftBounds(fixture.bounds, delta);
    fixture.colliderBounds = (fixture.colliderBounds ?? []).map((bounds) => shiftBounds(bounds, delta));
    fixture.regionId = anchor.regionId;
    fixture.cellId = surface.cellId;
    fixture.supportBoundaryIds = [...(surface.supportBoundaryIds ?? [])];
    fixture.nativeSupportSurfaceId = surface.id;
    fixture.nativeFixedRoomPlacementId = surface.nativeFixedRoomPlacementId
      ?? fixture.nativeFixedRoomPlacementId
      ?? null;
    fixture.gameplayPurpose ??= `plan-owned interaction fixture for ${[...actionIds].join(', ')}`;
    fixture.visualId ??= `visual.${fixture.id}`;
    fixture.visualIds ??= [fixture.visualId];
    fixture.colliderIds ??= fixture.colliderBounds.map((_, index) => `collider.${fixture.id}.${index}`);
  }
}

function rehomeAnchors(plan, bundles, ownership) {
  const byDescriptorAnchorId = descriptorAnchors(bundles);
  const surfacesByRegion = new Map();
  for (const bundle of bundles) {
    for (const surface of bundle.surfaces) {
      const list = surfacesByRegion.get(surface.regionId) ?? [];
      list.push(surface);
      surfacesByRegion.set(surface.regionId, list);
    }
  }
  for (const surfaces of surfacesByRegion.values()) {
    surfaces.sort((left, right) => left.id.localeCompare(right.id));
  }
  const fallbackCursor = new Map();
  for (const anchor of plan.anchors) {
    if (ownership.placementIds.has(anchor.semanticRoomPackPlacementId)
      || anchor.descriptorReference?.placementId
        && ownership.placementIds.has(anchor.descriptorReference.placementId)) {
      const packSurface = plan.walkableSurfaces.find(({ id }) => (
        id === (anchor.surfaceId ?? anchor.safeSurfaceId)
      ));
      if (packSurface) {
        rehomeInteractionFixtures(plan, anchor, anchor.position, packSurface);
      }
      continue;
    }
    const descriptorBinding = byDescriptorAnchorId.get(anchor.id);
    let surface = null;
    let position = null;
    let placementId = null;
    if (descriptorBinding) {
      const { bundle, descriptorAnchor } = descriptorBinding;
      surface = bundle.surfaces.find(({ localId }) => localId === descriptorAnchor.surfaceId);
      if (surface?.regionId === anchor.regionId) {
        position = clonePlanData(surface.center);
        placementId = bundle.placement.id;
      } else {
        surface = null;
      }
    }
    if (!surface) {
      const candidates = surfacesByRegion.get(anchor.regionId) ?? [];
      const cursor = fallbackCursor.get(anchor.regionId) ?? 0;
      surface = candidates[cursor % Math.max(1, candidates.length)] ?? null;
      fallbackCursor.set(anchor.regionId, cursor + 1);
      position = surface ? clonePlanData(surface.center) : null;
      placementId = surface?.nativeFixedRoomPlacementId ?? null;
    }
    if (!surface || !position) continue;
    const oldPosition = clonePlanData(anchor.position);
    anchor.position = vector(position.x, surface.bounds.max.y, position.z);
    anchor.surfaceId = surface.id;
    anchor.safeSurfaceId = surface.id;
    anchor.nativeFixedRoomPlacementId = placementId;
    anchor.nativeDescriptorAnchorId = descriptorBinding?.descriptorAnchor.id ?? null;
    const anchorActions = plan.actions.filter(({ anchorId }) => anchorId === anchor.id);
    if (anchorActions.some(({ type }) => (
      type === 'gate-control' || type === 'water-router' || type === 'mechanism-control'
    ))) {
      surface.interactionSurfaceRole = 'side-control-pad';
      surface.purpose = `${anchorActions.map(({ id }) => id).join(', ')} static authored side-console pad`;
    }
    rehomeInteractionFixtures(plan, anchor, oldPosition, surface);
  }
}

function rehomeEncountersAndRewards(plan, assemblyTraversalRemap = null) {
  const anchorById = new Map(plan.anchors.map((anchor) => [anchor.id, anchor]));
  const surfaceById = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
  for (const encounter of plan.encounters) {
    if (encounter.id === 'encounter.assembly' && assemblyTraversalRemap) {
      for (const key of [
        'spawnPoints', 'spawnSurfaceIds', 'spawnPattern', 'entryEngagementContracts',
      ]) {
        encounter[key] = remapNestedNativeTraversalValue(
          encounter[key],
          assemblyTraversalRemap.surfaceIdMap,
          assemblyTraversalRemap.transformPoint,
        );
      }
    }
    const anchor = anchorById.get(encounter.anchorId);
    const first = encounter.id === 'encounter.assembly' && assemblyTraversalRemap
      ? surfaceById.get(encounter.spawnSurfaceIds?.[0])
      : surfaceById.get(anchor?.surfaceId);
    if (!first) continue;
    const candidates = plan.walkableSurfaces.filter((surface) => (
      surface.regionId === encounter.regionId && surface.id !== first.id
    ));
    const firstCenter = surfaceCenter(first);
    const rankedCandidates = candidates.sort((left, right) => {
      const leftCenter = surfaceCenter(left);
      const rightCenter = surfaceCenter(right);
      return Math.hypot(rightCenter.x - firstCenter.x, rightCenter.z - firstCenter.z)
        - Math.hypot(leftCenter.x - firstCenter.x, leftCenter.z - firstCenter.z);
    });
    const remappedSecond = encounter.id === 'encounter.assembly' && assemblyTraversalRemap
      ? surfaceById.get(encounter.spawnSurfaceIds?.[1])
      : null;
    const second = remappedSecond ?? rankedCandidates[0] ?? first;
    encounter.spawnSurfaceIds = [first.id, second.id];
    encounter.spawnPoints = [first, second].map((surface) => {
      const center = surfaceCenter(surface);
      return vector(center.x, surface.bounds.max.y, center.z);
    });
    if (encounter.spawnPattern) encounter.spawnPattern.points = clonePlanData(encounter.spawnPoints);
    const region = plan.regions.find(({ id }) => id === encounter.regionId);
    if (region?.bounds) {
      encounter.zoneBounds = clonePlanData(region.bounds);
      encounter.triggerZoneBounds = clonePlanData(region.bounds);
    }
    encounter.blocksPermanentRoute = false;
    encounter.nativeFixedRoomPlacementId = first.nativeFixedRoomPlacementId;
  }
  for (const reward of plan.rewards) {
    const anchor = anchorById.get(reward.anchorId);
    if (!anchor?.surfaceId) continue;
    reward.nativeFixedRoomPlacementId = anchor.nativeFixedRoomPlacementId ?? null;
    reward.nativeSupportSurfaceId = anchor.surfaceId;
  }
}

function rehomeSafeAnchors(plan, ownership) {
  const surfaceById = new Map(plan.walkableSurfaces.map((surface) => [surface.id, surface]));
  const surfacesByRegion = new Map();
  for (const surface of plan.walkableSurfaces) {
    const list = surfacesByRegion.get(surface.regionId) ?? [];
    list.push(surface);
    surfacesByRegion.set(surface.regionId, list);
  }
  for (const surfaces of surfacesByRegion.values()) surfaces.sort((a, b) => a.id.localeCompare(b.id));
  for (const anchor of plan.safeAnchors ?? []) {
    const currentSurface = surfaceById.get(anchor.surfaceId ?? anchor.safeSurfaceId);
    if (currentSurface && ownership.placementIds.has(currentSurface.semanticRoomPackPlacementId)) continue;
    const surface = currentSurface ?? surfacesByRegion.get(anchor.regionId)?.[0];
    if (!surface) continue;
    const center = surface.center ?? {
      x: (surface.bounds.min.x + surface.bounds.max.x) * 0.5,
      z: (surface.bounds.min.z + surface.bounds.max.z) * 0.5,
    };
    anchor.position = vector(center.x, surface.bounds.max.y, center.z);
    anchor.surfaceId = surface.id;
    anchor.safeSurfaceId = surface.id;
    anchor.nativeFixedRoomPlacementId = surface.nativeFixedRoomPlacementId ?? null;
  }
}

function surfaceCenter(surface) {
  return vector(
    surface.center?.x ?? (surface.bounds.min.x + surface.bounds.max.x) * 0.5,
    surface.center?.y ?? surface.bounds.max.y,
    surface.center?.z ?? (surface.bounds.min.z + surface.bounds.max.z) * 0.5,
  );
}

function chooseMechanismLandings(plan, mechanism) {
  let candidates = plan.walkableSurfaces.filter((surface) => (
    surface.regionId === mechanism.regionId
      && surface.collision === 'static'
      && !surface.hazardTag
      && surface.bounds.max.x - surface.bounds.min.x >= 1.2
      && surface.bounds.max.z - surface.bounds.min.z >= 1.2
      && surface.shape !== 'ramp-tile'
  ));
  if (mechanism.id === 'mechanism.sorting-cargo') {
    candidates = candidates.filter(({ bounds }) => bounds.max.y >= 3.5);
  }
  candidates.sort((left, right) => (
    left.bounds.max.y - right.bounds.max.y || left.id.localeCompare(right.id)
  ));
  const first = candidates[0];
  const second = first && candidates.slice(1).sort((left, right) => {
    const firstCenter = surfaceCenter(first);
    const leftCenter = surfaceCenter(left);
    const rightCenter = surfaceCenter(right);
    return Math.hypot(rightCenter.x - firstCenter.x, rightCenter.z - firstCenter.z)
      - Math.hypot(leftCenter.x - firstCenter.x, leftCenter.z - firstCenter.z);
  })[0];
  if (!first || !second) {
    throw new Error(`${mechanism.id} has no two authored native/pack landing surfaces.`);
  }
  return [first, second];
}

function installMechanismSurfaces(plan) {
  const mechanisms = plan.mechanisms.filter(({ id }) => [
    'mechanism.cargo-lift',
    'mechanism.sorting-cargo',
    'mechanism.gamma-return-lift',
  ].includes(id));
  for (const mechanism of mechanisms) {
    const [first, second] = chooseMechanismLandings(plan, mechanism);
    const dynamicSurfaceId = mechanism.runtimeProfile.dynamicSurfaceId;
    const halfExtent = Number(mechanism.runtimeProfile.platformHalfExtent ?? 2.2);
    const firstCenter = surfaceCenter(first);
    const secondCenter = surfaceCenter(second);
    const platformBaseY = first.bounds.max.y;
    const supportFixtureId = `fixture.${mechanism.id}.canonical-support`;
    const supportBoundaryIds = [...(first.supportBoundaryIds ?? [])];
    plan.structuralFixtures.push({
      id: supportFixtureId,
      type: mechanism.type === 'moving-cargo'
        ? 'overhead-cargo-track'
        : 'telescoping-lift-guide',
      regionId: mechanism.regionId,
      cellId: first.cellId,
      bounds: {
        min: vector(
          Math.min(firstCenter.x, secondCenter.x) - 0.2,
          Math.max(first.bounds.max.y, second.bounds.max.y) + 3.4,
          Math.min(firstCenter.z, secondCenter.z) - 0.2,
        ),
        max: vector(
          Math.max(firstCenter.x, secondCenter.x) + 0.2,
          Math.max(first.bounds.max.y, second.bounds.max.y) + 3.8,
          Math.max(firstCenter.z, secondCenter.z) + 0.2,
        ),
      },
      gameplayPurpose: `visible authored support and guide for ${mechanism.id}`,
      materialProfileId: 'legacy-metal-support',
      visualProfile: 'legacy-metal-support:mechanism-guide',
      collision: false,
      accessibility: 'inaccessible',
      supportBoundaryIds,
      visualId: `visual.${supportFixtureId}`,
      visualIds: [`visual.${supportFixtureId}`],
      colliderIds: [],
      colliderBounds: [],
    });
    const routeBounds = {
      min: vector(
        Math.min(firstCenter.x, secondCenter.x) - halfExtent,
        Math.min(first.bounds.max.y, second.bounds.max.y),
        Math.min(firstCenter.z, secondCenter.z) - halfExtent,
      ),
      max: vector(
        Math.max(firstCenter.x, secondCenter.x) + halfExtent,
        Math.max(first.bounds.max.y, second.bounds.max.y) + 0.35,
        Math.max(firstCenter.z, secondCenter.z) + halfExtent,
      ),
    };
    plan.walkableSurfaces.push({
      id: dynamicSurfaceId,
      regionId: mechanism.regionId,
      cellId: first.cellId,
      bounds: {
        min: vector(firstCenter.x - halfExtent, platformBaseY, firstCenter.z - halfExtent),
        max: vector(firstCenter.x + halfExtent, platformBaseY + 0.35, firstCenter.z + halfExtent),
      },
      purpose: mechanism.runtimeProfile.purpose
        ?? `automatic recallable ${mechanism.type} between useful authored landings`,
      supportBoundaryIds,
      supportFixtureIds: [supportFixtureId],
      supportProfile: mechanism.type === 'moving-cargo'
        ? 'overhead-track-and-braces-v2'
        : 'telescoping-industrial-support-v2',
      visualProfile: `mechanism:${mechanism.type}:platform-v2`,
      collision: 'dynamic',
      hazardTag: null,
      mechanismId: mechanism.id,
      geometry: {
        type: mechanism.type,
        automatic: mechanism.automaticTravel === true,
        recallable: mechanism.recallable === true,
        elevated: mechanism.id === 'mechanism.sorting-cargo',
        stableStateIds: mechanism.states.filter(({ stable }) => stable !== false).map(({ id }) => id),
        routeBounds,
      },
      createsLedgeCandidates: false,
    });
    const stableStates = mechanism.states.filter(({ stable }) => stable !== false);
    for (const [index, state] of stableStates.entries()) {
      const landing = index === 0 ? first : second;
      const center = surfaceCenter(landing);
      state.position = vector(center.x, landing.bounds.max.y, center.z);
      state.surfaceY = landing.bounds.max.y;
      state.landingSurfaceId = landing.id;
      state.regionId ??= landing.regionId;
    }
  }
}

function bindCoordinatorOwnedFreightCatchment(plan) {
  const cell = plan.spatialCells.find(({ id }) => id === 'cell.canonical.freight-catchment');
  const surface = plan.walkableSurfaces.find(({ id }) => (
    id === 'surface.canonical.freight-catchment'
  ));
  const portal = plan.portals.find(({ id }) => id === 'portal.assembly-freight-drop');
  const fall = plan.falls.find(({ id }) => id === 'fall.assembly-freight-drop');
  const safeAnchor = plan.safeAnchors.find(({ id }) => id === 'safe.freight-catchment');
  if (!cell || !surface || !portal || !fall || !safeAnchor) {
    throw new Error('Canonical connection coordinator omitted the playable freight catchment contract.');
  }
  const center = surfaceCenter(surface);
  safeAnchor.regionId = 'freight';
  safeAnchor.position = vector(center.x, surface.bounds.max.y, center.z);
  safeAnchor.surfaceId = surface.id;
  safeAnchor.safeSurfaceId = surface.id;
  safeAnchor.nativeFixedRoomPlacementId = 'placement.machine';
  fall.sourceApertureBoundaryId = portal.from.boundaryId;
  fall.sourceSurfaceId = portal.physicalRoute?.endpointSurfaceIds?.from ?? fall.sourceSurfaceId;
  fall.targetCatchmentRegionId = 'freight';
  fall.catchmentSurfaceId = surface.id;
  fall.safeAnchorId = safeAnchor.id;
  fall.trajectoryBounds = {
    min: vector(
      Math.min(portal.from.center.x, surface.bounds.min.x),
      surface.bounds.max.y,
      Math.min(portal.from.center.z, surface.bounds.min.z),
    ),
    max: vector(
      Math.max(portal.from.center.x, surface.bounds.max.x),
      Math.max(portal.from.center.y, surface.bounds.max.y + 0.1),
      Math.max(portal.from.center.z, surface.bounds.max.z),
    ),
  };
  fall.landingDimensions = {
    width: surface.bounds.max.x - surface.bounds.min.x,
    depth: surface.bounds.max.z - surface.bounds.min.z,
    headroom: cell.bounds.max.y - surface.bounds.max.y,
  };
  const region = plan.regions.find(({ id }) => id === 'freight');
  const minimapRegion = plan.minimap?.regions?.find(({ id }) => id === 'freight');
  for (const record of [region, minimapRegion]) {
    if (!record) continue;
    record.bounds = clonePlanData(cell.bounds);
    record.cellIds = [cell.id];
    record.modulePlacementId = 'placement.machine';
  }
  region.subRegions = [{
    id: 'freight.native-v1-authored-catchment',
    cellId: cell.id,
    bounds: clonePlanData(cell.bounds),
    purpose: 'damage-free playable lower freight catchment and permanent return',
    surfaceIds: [surface.id],
    nativeFixedRoomPlacementId: 'placement.machine',
  }];
  for (const anchor of plan.anchors.filter(({ regionId }) => regionId === 'freight')) {
    const oldPosition = clonePlanData(anchor.position);
    anchor.position = vector(center.x, surface.bounds.max.y, center.z);
    anchor.surfaceId = surface.id;
    anchor.safeSurfaceId = surface.id;
    anchor.nativeFixedRoomPlacementId = 'placement.machine';
    if (plan.actions.some(({ anchorId, type }) => (
      anchorId === anchor.id && type === 'gate-control'
    ))) {
      surface.interactionSurfaceRole = 'side-control-pad';
      surface.purpose = 'freight catchment return and static side-console pad';
    }
    rehomeInteractionFixtures(plan, anchor, oldPosition, surface);
  }
}

/**
 * Atomically installs the validated non-overlapping eleven-room V1
 * composition after the three semantic room-pack passes. Pack-owned physical
 * records and state bindings survive unchanged; every remaining generic room
 * body is removed. Connection remapping is deliberately supplied by Golden's
 * progression coordinator because gate IDs and pack-annex route ownership are
 * whole-plan policy, not descriptor data.
 */
export function integrateCanonicalNativeV1GoldenPhysicalCompositionV2(plan, hooks = {}) {
  assertMutableGolden(plan);
  if (typeof hooks.rebuildCanonicalConnections !== 'function') {
    throw new TypeError('Canonical native V1 integration requires rebuildCanonicalConnections.');
  }
  const assemblyTraversalSnapshot = captureAssemblyTraversalContract(plan);
  const ownership = collectPackOwnership(plan);
  const composition = createLegacyFixedRoomGoldenCompositionV2();
  const bundles = composition.placements.map(compilePlacementBundle);

  const preservedModules = plan.modulePlacements.filter((record) => (
    ownership.placementIds.has(record.semanticRoomPackPlacementId)
      || ownership.placementIds.has(record.id)
  ));
  const preservedCells = plan.spatialCells.filter((record) => packOwned(record, ownership, 'cellIds'));
  const preservedBoundaries = plan.structuralBoundaries.filter((record) => (
    packOwned(record, ownership, 'boundaryIds')
  ));
  const preservedSurfaces = plan.walkableSurfaces.filter((record) => (
    packOwned(record, ownership, 'surfaceIds')
  ));
  const preservedFixtures = plan.structuralFixtures.filter((record) => (
    packOwned(record, ownership, 'fixtureIds')
    || record.id.startsWith('fixture.interaction.')
  ));
  const preservedLinks = plan.traversalLinks.filter((record) => (
    ownership.placementIds.has(record.semanticRoomPackPlacementId)
    || ownership.surfaceIds.has(record.fromSurfaceId)
    || ownership.surfaceIds.has(record.toSurfaceId)
    || ownership.surfaceIds.has(record.viaSurfaceId)
  ));

  plan.modulePlacements = [
    ...preservedModules,
    ...bundles.map(({ placement }) => placement),
  ];
  plan.spatialCells = [
    ...preservedCells,
    ...bundles.map(({ physicalCell }) => physicalCell),
  ];
  plan.structuralBoundaries = [
    ...preservedBoundaries,
    ...bundles.flatMap(({ boundaries }) => boundaries),
  ];
  plan.walkableSurfaces = [
    ...preservedSurfaces,
    ...bundles.flatMap(({ surfaces }) => surfaces),
  ];
  plan.structuralFixtures = [
    ...preservedFixtures,
    ...bundles.flatMap(({ fixtures }) => fixtures),
  ];
  plan.traversalLinks = [
    ...preservedLinks,
  ];
  const machineBundle = bundles.find(({ placement }) => placement.id === 'placement.machine');
  const assemblyTraversalRemap = installAssemblyTraversalContract(
    plan,
    assemblyTraversalSnapshot,
    machineBundle,
  );
  for (const bundle of bundles) installRegionOwnership(plan, bundle);
  rehomeAnchors(plan, bundles, ownership);
  installMechanismSurfaces(plan);
  rehomeEncountersAndRewards(plan, assemblyTraversalRemap);
  rehomeSafeAnchors(plan, ownership);

  const connectionDiagnostics = hooks.rebuildCanonicalConnections(plan, {
    composition,
    bundles,
    packOwnership: ownership,
  });
  bindCoordinatorOwnedFreightCatchment(plan);
  const expectedPortalIds = plan.portals.map(({ id }) => id).sort();
  const uniqueExpectedPortalIds = [...new Set(expectedPortalIds)];
  const routedPortalIds = [...(connectionDiagnostics?.routedPortalIds ?? [])].sort();
  if (!connectionDiagnostics?.accepted
    || expectedPortalIds.length !== STABLE_GOLDEN_PORTAL_COUNT
    || uniqueExpectedPortalIds.length !== STABLE_GOLDEN_PORTAL_COUNT
    || Number(connectionDiagnostics.physicalRouteCount) !== expectedPortalIds.length
    || JSON.stringify(routedPortalIds) !== JSON.stringify(expectedPortalIds)
    || (connectionDiagnostics.unresolved ?? []).length !== 0) {
    throw new Error('Canonical native V1 connection coordinator rejected the coexistence composition.');
  }

  const topologySignatures = deriveDungeonTopologySignaturesV2(plan);
  for (const region of plan.regions) {
    if (topologySignatures[region.id]) region.topologySignature = topologySignatures[region.id];
  }
  for (const placement of plan.modulePlacements) {
    const regionId = placement.regionIds?.[0] ?? placement.semanticRegionIds?.[0];
    if (regionId && topologySignatures[regionId]) {
      placement.topologySignature = topologySignatures[regionId];
    }
  }

  const nativePlacementIds = bundles.map(({ placement }) => placement.id).sort();
  const authoredPlacementIds = new Set(plan.modulePlacements.map(({ id }) => id));
  if (plan.modulePlacements.length !== 14 || authoredPlacementIds.size !== 14
    || nativePlacementIds.some((id) => !authoredPlacementIds.has(id))) {
    throw new Error('Canonical coexistence must own exactly eleven native and three semantic pack module placements.');
  }

  plan.nativeFixedRoomIntegration = {
    revision: CANONICAL_NATIVE_V1_GOLDEN_INTEGRATION_REVISION_V2,
    requiredPlacementCount: 11,
    activePlacementIds: nativePlacementIds,
    activeDescriptorIds: bundles.map(({ placement }) => placement.descriptorId).sort(),
    incompleteDescriptorIds: [],
    genericFallbackGeometry: false,
    canonicalCompositionId: composition.id,
    canonicalCompositionRevision: composition.revision,
    packCoexistencePlacementIds: [...ownership.placementIds].sort(),
    connectionDiagnosticHash: connectionDiagnostics.diagnosticHash ?? null,
  };
  plan.canonicalNativeV1Coexistence = {
    schemaVersion: 'canonical-native-v1-pack-coexistence/1',
    revision: CANONICAL_NATIVE_V1_GOLDEN_INTEGRATION_REVISION_V2,
    accepted: true,
    nativePlacementCount: 11,
    semanticPackPlacementCount: 3,
    totalAuthoredPlacementCount: 14,
    genericRoomBodyCount: 0,
    nativePlacementIds,
    semanticPackPlacementIds: REQUIRED_PACK_PLACEMENT_IDS.slice().sort(),
    semanticRegionIds: [...new Set(bundles.flatMap(({ semanticRegionIds }) => semanticRegionIds))].sort(),
    canonicalConnectionIds: expectedPortalIds,
    canonicalPortalIds: expectedPortalIds,
    descriptorCompositionConnectionIds: composition.connections.map(({ id }) => id).sort(),
  };
  if (!isSerializablePlanValue(plan.canonicalNativeV1Coexistence)
    || !isSerializablePlanValue(plan.nativeFixedRoomIntegration)) {
    throw new Error('Canonical native V1 coexistence diagnostics must be serializable.');
  }
  return deepFreezePlan(clonePlanData(plan.canonicalNativeV1Coexistence));
}

export default integrateCanonicalNativeV1GoldenPhysicalCompositionV2;
