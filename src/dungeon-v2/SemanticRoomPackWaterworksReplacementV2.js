import {
  clonePlanData,
  deepFreezePlan,
  isSerializablePlanValue,
} from './DungeonPlanV2Contract.js';
import {
  createPlanDiagnostic,
  hashPlanDiagnostics,
  sortPlanDiagnostics,
} from './DungeonPlanDiagnostics.js';
import { deriveDungeonTopologySignaturesV2 } from './DungeonTopologySignatureV2.js';
import { validateDungeonPlanV2 } from './DungeonPlanV2Validator.js';
import {
  compileSemanticRoomPackPlacementV2,
  validateSemanticRoomPackPlacementV2,
} from './SemanticRoomPackPlanAdapterV2.js';
import { getSemanticRoomPackV1Descriptor } from './SemanticRoomPackV1Catalog.js';

export const SEMANTIC_ROOM_PACK_WATERWORKS_REPLACEMENT_V2_REVISION = 1;

const ROOM_ID = 'rdx_waterworks_freight_sump';
const PLACEMENT_ID = 'placement.semantic-room-pack.waterworks-freight-sump';
const WATER_REGION_IDS = Object.freeze([
  'freight-sump',
  'reservoir',
  'gantry-sump',
  'salvage-tunnel',
]);
const ABSORBED_MODULE_IDS = Object.freeze(WATER_REGION_IDS.map((id) => `placement.${id}`));
const REPLACED_FREIGHT_CELL_IDS = Object.freeze([
  'cell.freight-sump.main',
  'cell.freight-sump.process-alcove',
  'cell.freight-sump.inspection-vault',
]);
const PACK_CELL_ID = 'cell.semantic-room-pack.waterworks.main';
const EPSILON = 1e-6;

const SOCKET_ROUTE_BINDINGS = deepFreezePlan({
  entry_south: {
    portalId: 'portal.sorting-freight-sump',
    endpointName: 'to',
    regionId: 'freight-sump',
    surfaceNodeName: 'WALK_ENTRY_CATWALK',
    purpose: 'Alpha-gated Waterworks expedition entrance from Sorting',
  },
  exit_north: {
    portalId: 'portal.gantry-sump-salvage',
    endpointName: 'from',
    regionId: 'gantry-sump',
    surfaceNodeName: 'WALK_NORTH_PUMP_DECK',
    purpose: 'permanent high route from Gantry Sump into the Beta salvage branch',
  },
  gantry_exit_west: {
    portalId: 'portal.reservoir-gantry-sump',
    endpointName: 'from',
    regionId: 'reservoir',
    surfaceNodeName: 'WALK_WEST_GANTRY',
    purpose: 'upper water-state route from the pump gallery to Gantry Sump',
  },
  drain_tunnel_east: {
    portalId: 'portal.freight-sump-reservoir',
    endpointName: 'from',
    regionId: 'freight-sump',
    surfaceNodeName: 'WALK_DRAIN_TUNNEL',
    purpose: 'short drained route from the sump into the dry pump gallery',
  },
});

const SURFACE_REGION_BY_SOURCE = deepFreezePlan({
  WALK_ENTRY_CATWALK: 'freight-sump',
  WALK_SUMP_BOTTOM: 'freight-sump',
  WALK_NORTH_PUMP_DECK: 'reservoir',
  WALK_WEST_GANTRY: 'gantry-sump',
  WALK_EAST_SERVICE_DECK: 'salvage-tunnel',
  WALK_DRAIN_TUNNEL: 'salvage-tunnel',
});

function round(value) {
  const result = Math.round(Number(value) * 1e9) / 1e9;
  return Object.is(result, -0) ? 0 : result;
}

function vector(x, y, z) {
  return { x: round(x), y: round(y), z: round(z) };
}

function addDiagnostic(target, code, message, details = {}) {
  target.push(createPlanDiagnostic(code, message, details));
}

function boundsForCollider(record) {
  const center = record.worldCenter;
  if (record.shape === 'cylinder') {
    return {
      min: vector(center.x - record.worldRadius, center.y - record.worldHeight * 0.5, center.z - record.worldRadius),
      max: vector(center.x + record.worldRadius, center.y + record.worldHeight * 0.5, center.z + record.worldRadius),
    };
  }
  if (record.shape !== 'box') throw new TypeError(`Unsupported authored collision shape ${record.shape}.`);
  const halfX = record.worldSize.x * 0.5;
  const halfY = record.worldSize.y * 0.5;
  const halfZ = record.worldSize.z * 0.5;
  const cosine = Math.abs(Math.cos(record.worldYawRadians));
  const sine = Math.abs(Math.sin(record.worldYawRadians));
  const extentX = halfX * cosine + halfZ * sine;
  const extentZ = halfX * sine + halfZ * cosine;
  return {
    min: vector(center.x - extentX, center.y - halfY, center.z - extentZ),
    max: vector(center.x + extentX, center.y + halfY, center.z + extentZ),
  };
}

function unionBounds(records) {
  const bounds = records.map((record) => record.bounds ?? record).filter((entry) => entry?.min && entry?.max);
  if (!bounds.length) throw new Error('Cannot derive bounds from an empty authored record collection.');
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

function sideFromShellNode(sourceNodeName, yawQuarterTurns) {
  if (/^SHELL_FLOOR(?:_|$)/u.test(sourceNodeName)) return 'floor';
  if (/^SHELL_CEILING(?:_|$)/u.test(sourceNodeName)) return 'ceiling';
  const match = sourceNodeName.match(/_(NORTH|WEST|SOUTH|EAST)(?:_|$)/u);
  if (!match) throw new Error(`Authored shell collider ${sourceNodeName} has no cardinal side.`);
  const sides = ['north', 'west', 'south', 'east'];
  return sides[(sides.indexOf(match[1].toLowerCase()) + yawQuarterTurns) % 4];
}

function sourceRegionId(sourceNodeName) {
  if (/DRAIN/u.test(sourceNodeName) || /EAST_SERVICE/u.test(sourceNodeName)) return 'salvage-tunnel';
  if (/GANTRY/u.test(sourceNodeName)) return 'gantry-sump';
  if (/RESERVOIR|PUMP|NORTH_PUMP|CONSOLE/u.test(sourceNodeName)) return 'reservoir';
  return 'freight-sump';
}

function surfaceRegionId(sourceNodeName) {
  if (SURFACE_REGION_BY_SOURCE[sourceNodeName]) return SURFACE_REGION_BY_SOURCE[sourceNodeName];
  if (/^WALK_GANTRY_ASCENT_STEP_/u.test(sourceNodeName)) return 'gantry-sump';
  if (/^WALK_BASIN_RETURN_STEP_|^WALK_SUMP_ISLAND_/u.test(sourceNodeName)) return 'freight-sump';
  throw new Error(`Waterworks manifest surface ${sourceNodeName} has no explicit logical-region binding.`);
}

function descriptorReference(placement, record, extras = {}) {
  return {
    packId: placement.packId,
    packRevision: placement.packRevision,
    roomId: placement.roomId,
    placementId: placement.placementId,
    sourceNodeName: record.sourceNodeName,
    colliderId: record.colliderId,
    collisionSourcePolicy: placement.collisionSourcePolicy,
    ...extras,
  };
}

function visualFields(placement, record) {
  return {
    visualId: `visual.${record.id}`,
    visualIds: [`visual.${record.id}`],
    presentationOwnerId: placement.placementId,
    descriptorReference: descriptorReference(placement, record),
  };
}

function cellIdForRegion(regionId) {
  // All authored sub-regions occupy one closed manifest shell. Logical region
  // ownership lives on surfaces/anchors; inventing one independently enclosed
  // spatial cell per semantic marker would create false walls and void gaps.
  void regionId;
  return PACK_CELL_ID;
}

function enrichBoundary(placement, record) {
  const bounds = boundsForCollider(record);
  const regionId = sourceRegionId(record.sourceNodeName);
  const side = sideFromShellNode(record.sourceNodeName, placement.placementTransform.yawQuarterTurns);
  return {
    ...clonePlanData(record),
    regionId,
    cellId: cellIdForRegion(regionId),
    bounds,
    side,
    kind: 'solid',
    openings: [],
    materialProfileId: 'semantic-room-pack-v1.waterworks.shell',
    visualProfile: `semantic-room-pack-v1:${ROOM_ID}:${side}`,
    collider: true,
    collision: 'static',
    opaque: true,
    colliderIds: [record.colliderId],
    colliderBounds: [bounds],
    gameplayPurpose: `authored enclosed Waterworks ${side} shell`,
    ...visualFields(placement, record),
  };
}

function enrichFixture(placement, record, supportBoundaryIds) {
  const bounds = boundsForCollider(record);
  const regionId = sourceRegionId(record.sourceNodeName);
  return {
    ...clonePlanData(record),
    type: `semantic-room-pack-${record.semantic}`,
    regionId,
    cellId: cellIdForRegion(regionId),
    bounds,
    gameplayPurpose: `authored ${record.semantic} Waterworks structure`,
    collision: 'blocking',
    accessibility: 'reachable',
    supportBoundaryIds: [...supportBoundaryIds],
    colliderIds: [record.colliderId],
    colliderBounds: [bounds],
    blocksAerialTraversal: true,
    ...visualFields(placement, record),
  };
}

function enrichSurface(placement, record, descriptor, supportBoundaryIds, fixtures) {
  const bounds = boundsForCollider(record);
  const regionId = surfaceRegionId(record.sourceNodeName);
  const supportFixtureIds = fixtures
    .filter(({ sourceNodeName }) => sourceNodeName.startsWith(`SUPPORT_${record.sourceNodeName}_`))
    .map(({ id }) => id);
  return {
    ...clonePlanData(record),
    regionId,
    cellId: cellIdForRegion(regionId),
    bounds,
    purpose: descriptor.platformPurposes?.[record.sourceNodeName]
      ?? `authored Waterworks traversal surface ${record.sourceNodeName}`,
    supportBoundaryIds: [...supportBoundaryIds],
    supportFixtureIds,
    supportProfile: 'semantic-room-pack-v1-authored-support',
    visualProfile: `semantic-room-pack-v1:${ROOM_ID}:walkable`,
    collision: 'static',
    mechanismId: null,
    hazardTag: null,
    colliderIds: [record.colliderId],
    colliderBounds: [bounds],
    createsLedgeCandidates: false,
    ledgePolicy: 'authored-semantic-surface-seams-disabled',
    ...visualFields(placement, record),
  };
}

function findBySource(records, sourceNodeName) {
  const record = records.find((entry) => entry.sourceNodeName === sourceNodeName);
  if (!record) throw new Error(`Authored Waterworks record ${sourceNodeName} is missing.`);
  return record;
}

function findSocket(placement, socketId) {
  const socket = placement.sockets.find(({ id }) => id === socketId);
  if (!socket) throw new Error(`Authored Waterworks socket ${socketId} is missing.`);
  return socket;
}

function shellHeaderForSocket(boundaries, socket) {
  const side = socket.worldForward.x < -EPSILON ? 'west'
    : socket.worldForward.x > EPSILON ? 'east'
      : socket.worldForward.z < -EPSILON ? 'north' : 'south';
  const candidates = boundaries.filter((boundary) => (
    boundary.side === side && boundary.sourceNodeName.includes('SHELL_DOOR_HEADER_')
  ));
  if (candidates.length !== 1) {
    throw new Error(`Authored Waterworks socket ${socket.id} has ${candidates.length} matching shell headers.`);
  }
  return candidates[0];
}

function endpointForSocket(previous, socket, binding, boundary) {
  return {
    ...clonePlanData(previous),
    regionId: binding.regionId,
    cellId: boundary.cellId,
    boundaryId: boundary.id,
    side: boundary.side,
    center: vector(
      socket.worldPosition.x,
      socket.worldPosition.y + socket.aperture.height * 0.5,
      socket.worldPosition.z,
    ),
    elevation: socket.worldElevation,
    dimensions: {
      width: socket.aperture.width,
      height: socket.aperture.height,
      depth: previous?.dimensions?.depth ?? 1.2,
    },
    semanticRoomPackPlacementId: PLACEMENT_ID,
    semanticRoomPackSocketId: socket.id,
  };
}

function socketStripBounds(socket, boundary, minY, maxY) {
  if (maxY - minY <= EPSILON) return null;
  const halfWidth = socket.aperture.width * 0.5;
  if (boundary.side === 'north' || boundary.side === 'south') {
    return {
      min: vector(socket.worldPosition.x - halfWidth, minY, boundary.bounds.min.z),
      max: vector(socket.worldPosition.x + halfWidth, maxY, boundary.bounds.max.z),
    };
  }
  return {
    min: vector(boundary.bounds.min.x, minY, socket.worldPosition.z - halfWidth),
    max: vector(boundary.bounds.max.x, maxY, socket.worldPosition.z + halfWidth),
  };
}

function addSocketFrameInfills(boundaries, placement, socket, header) {
  const socketBottomY = socket.worldPosition.y;
  const socketTopY = socketBottomY + socket.aperture.height;
  const strips = [
    ['lower', placement.worldBounds.min.y, socketBottomY],
    ['upper', socketTopY, header.bounds.min.y],
  ];
  const records = [];
  for (const [suffix, minY, maxY] of strips) {
    const bounds = socketStripBounds(socket, header, minY, maxY);
    if (!bounds) continue;
    const id = `boundary.semantic-room-pack.waterworks.socket-infill.${socket.id}.${suffix}`;
    records.push({
      id,
      regionId: header.regionId,
      cellId: PACK_CELL_ID,
      side: header.side,
      kind: 'solid',
      bounds,
      openings: [],
      materialProfileId: 'semantic-room-pack-v1.waterworks.socket-frame',
      visualProfile: `semantic-room-pack-v1:${ROOM_ID}:socket-frame`,
      collider: true,
      collision: 'static',
      opaque: true,
      colliderIds: [id],
      colliderBounds: [bounds],
      gameplayPurpose: `opaque structural infill around authored socket ${socket.id}`,
      sourcePolicy: 'explicit-plan-owned-socket-frame',
      derivedFromVisibleMeshBounds: false,
      presentationOwnerId: placement.placementId,
      visualId: `visual.${id}`,
      visualIds: [`visual.${id}`],
      semanticRoomPackPlacementId: placement.placementId,
    });
  }
  boundaries.push(...records);
  return records;
}

function bindSockets(plan, placement, boundaries, surfaces) {
  const portalById = new Map(plan.portals.map((portal) => [portal.id, portal]));
  const bindings = [];
  for (const [socketId, route] of Object.entries(SOCKET_ROUTE_BINDINGS)) {
    const socket = findSocket(placement, socketId);
    const portal = portalById.get(route.portalId);
    if (!portal) throw new Error(`Golden Waterworks route ${route.portalId} is missing.`);
    const boundary = shellHeaderForSocket(boundaries, socket);
    const surface = findBySource(surfaces, route.surfaceNodeName);
    const priorEndpoint = portal[route.endpointName];
    portal[route.endpointName] = endpointForSocket(priorEndpoint, socket, route, boundary);
    portal.elevationBands = [portal.from.elevation, portal.to.elevation];
    portal.elevationBand = Math.min(...portal.elevationBands);
    portal.traversal.minimumWidth = Math.min(
      Number(portal.traversal.minimumWidth),
      Number(socket.aperture.width),
    );
    portal.physicalRoute ??= {};
    portal.physicalRoute.endpointSurfaceIds ??= {};
    portal.physicalRoute.endpointSurfaceIds[route.endpointName] = surface.id;
    const opening = {
      id: `opening.semantic-room-pack.waterworks.${socket.id}`,
      portalId: portal.id,
      center: clonePlanData(portal[route.endpointName].center),
      dimensions: clonePlanData(portal[route.endpointName].dimensions),
      semanticRoomPackSocketId: socket.id,
    };
    boundary.kind = 'portal-frame';
    boundary.openings.push(opening);
    const infills = addSocketFrameInfills(boundaries, placement, socket, boundary);
    bindings.push({
      socketId: socket.id,
      socketWorldId: socket.worldId,
      sourceNodeName: socket.sourceNodeName,
      status: 'bound',
      portalId: portal.id,
      endpointName: route.endpointName,
      routePurpose: route.purpose,
      regionId: route.regionId,
      boundaryId: boundary.id,
      surfaceId: surface.id,
      socketFrameBoundaryIds: infills.map(({ id }) => id),
      connectorCellsAdded: 0,
    });
  }
  return bindings;
}

function createLogicalCells(placement, boundaries) {
  const sides = new Set(boundaries.map(({ side }) => side));
  if (['west', 'east', 'north', 'south', 'floor', 'ceiling'].some((side) => !sides.has(side))) {
    throw new Error('Authored Waterworks shell cannot derive a closed interior cell.');
  }
  return [{
    id: PACK_CELL_ID,
    regionId: 'freight-sump',
    bounds: clonePlanData(placement.worldBounds),
    playable: true,
    interior: true,
    cameraContained: true,
    occupiedVolume: true,
    compoundId: 'compound.semantic-room-pack.waterworks',
    compoundShell: true,
    compoundSubRegion: false,
    semanticRoomPackPlacementId: placement.placementId,
  }];
}

function basinContractSurface(placement, shellFloor, id, bounds) {
  return {
    id,
    regionId: 'freight-sump',
    cellId: PACK_CELL_ID,
    bounds,
    purpose: 'plan-owned conserved-water footprint partition of the manifest shell-floor collision',
    supportBoundaryIds: [shellFloor.id],
    supportFixtureIds: [],
    supportProfile: 'manifest-shell-floor-logical-partition',
    visualProfile: 'semantic-room-pack-v1:waterworks:non-rendered-basin-contract',
    collision: 'static',
    hazardTag: null,
    colliderId: shellFloor.colliderId,
    colliderIds: [shellFloor.colliderId],
    colliderBounds: [bounds],
    sourceNodeName: shellFloor.sourceNodeName,
    presentationOwnerId: placement.placementId,
    semanticRoomPackPlacementId: placement.placementId,
    runtimeContractOnly: true,
    derivedFromVisibleMeshBounds: false,
    derivedFromManifestCollisionPartition: true,
    descriptorReference: descriptorReference(placement, shellFloor, {
      logicalPartitionId: id,
    }),
  };
}

function createWaterBindings(placement, boundaries, surfaces) {
  const contract = placement.waterContracts[0];
  if (!contract) throw new Error('Authored Waterworks conserved-fluid contract is missing.');
  const stateLevels = Object.fromEntries(contract.stableStates.map(({ id, levels }) => [id, levels]));
  const shellFloor = findBySource(boundaries, 'SHELL_FLOOR_BOTTOM');
  const bottom = contract.basinBottomWorldY;
  const freightLevel = stateLevels.FreightSumpFilled.freightLevelWorldY;
  const storedLevel = stateLevels.StoredInReservoir.storedLevelWorldY;
  const gantryLevel = stateLevels.GantrySumpFilled.gantryLevelWorldY;
  const shellWidth = shellFloor.bounds.max.x - shellFloor.bounds.min.x;
  const shellDepth = shellFloor.bounds.max.z - shellFloor.bounds.min.z;
  const conservedVolume = round(shellWidth * shellDepth * (freightLevel - bottom));
  const makeBounds = (levelY) => {
    const requiredArea = conservedVolume / (levelY - bottom);
    const width = requiredArea / shellDepth;
    if (!(width > 0) || width > shellWidth + EPSILON) {
      throw new Error(`Authored Waterworks ${levelY} level cannot conserve water inside the manifest shell footprint.`);
    }
    const centerX = (shellFloor.bounds.min.x + shellFloor.bounds.max.x) * 0.5;
    return {
      min: vector(centerX - width * 0.5, bottom, shellFloor.bounds.min.z),
      max: vector(centerX + width * 0.5, placement.worldBounds.max.y, shellFloor.bounds.max.z),
    };
  };
  const definitions = [
    ['FreightSumpFilled', 'freightLevelWorldY', 'basin.freight-sump', freightLevel],
    ['StoredInReservoir', 'storedLevelWorldY', 'basin.reservoir', storedLevel],
    ['GantrySumpFilled', 'gantryLevelWorldY', 'basin.gantry-sump', gantryLevel],
  ];
  const contractSurfaces = [];
  const basins = definitions.map(([stateId, levelKey, basinId, levelY]) => {
    const bounds = makeBounds(levelY);
    const floorBounds = {
      min: vector(bounds.min.x, bottom - 0.05, bounds.min.z),
      max: vector(bounds.max.x, bottom, bounds.max.z),
    };
    const floor = basinContractSurface(
      placement,
      shellFloor,
      `surface.semantic-room-pack.waterworks.basin-contract.${stateId}`,
      floorBounds,
    );
    contractSurfaces.push(floor);
    return {
      stateId,
      levelKey,
      basinId,
      regionId: stateId === 'StoredInReservoir' ? 'reservoir'
        : stateId === 'GantrySumpFilled' ? 'gantry-sump' : 'freight-sump',
      bounds,
      floorSurfaceId: floor.id,
      exactLevelWorldY: levelY,
      exactVolume: conservedVolume,
      geometryAuthority: 'manifest-shell-floor-logical-partition',
    };
  });
  const control = findBySource(surfaces, 'WALK_NORTH_PUMP_DECK');
  const flooded = findBySource(surfaces, 'WALK_SUMP_ISLAND_0');
  const drained = findBySource(surfaces, 'WALK_DRAIN_TUNNEL');
  const gantry = findBySource(surfaces, 'WALK_WEST_GANTRY');
  return {
    contractSurfaces,
    runtimeContractBindings: {
      water: {
        environmentStateId: 'environment.water-unit',
        controllerId: 'mechanism.water-router',
        conservedVolumeUnits: 1,
        exactGeometricVolume: conservedVolume,
        basins,
        controlSurfaceId: control.id,
        discoverySurfaceIds: {
          submerged_salvage_cache: flooded.id,
          drained_tunnel_cache: drained.id,
          gantry_high_route: gantry.id,
        },
      },
    },
    runtimePresentationBindings: {
      globalEnvironmentId: 'environment.water-unit',
      waterBasins: [{
        basinId: 'basin.freight-sump',
        sourceNodeName: 'FLUID_FACTORY_WATER_LEVEL_FREIGHT',
        presentationMode: 'authored-fluid-volume',
        stateId: 'FreightSumpFilled',
        absoluteWorldY: freightLevel,
      }],
    },
  };
}

function reconcileGlobalWaterContract(plan, placement, waterBindings) {
  const environment = plan.environmentStates.find(({ id }) => id === 'environment.water-unit');
  if (!environment) throw new Error('Global Waterworks environment is missing during authored reconciliation.');
  const bindings = waterBindings.runtimeContractBindings.water;
  const basins = bindings.basins.map((binding) => {
    const depth = round(binding.exactLevelWorldY - binding.bounds.min.y);
    return {
      id: binding.basinId,
      regionId: binding.regionId,
      bounds: clonePlanData(binding.bounds),
      floorSurfaceId: binding.floorSurfaceId,
      walkableBottomY: binding.bounds.min.y,
      playerRootTolerance: 0.5,
      capacityUnits: 1,
      exactFilledVolume: binding.exactVolume,
      exactFilledLevel: depth,
      exactFilledWorldY: binding.exactLevelWorldY,
      footprintPolicy: 'complete-main-walkable-basin',
      semanticRoomPackPlacementId: placement.placementId,
      geometryAuthority: binding.geometryAuthority,
    };
  });
  const levelsFor = (filledId) => Object.fromEntries(basins.map(({ id, exactFilledLevel }) => [
    id,
    id === filledId ? exactFilledLevel : 0,
  ]));
  const absoluteFor = (filledId) => Object.fromEntries(basins.map(({ id, exactFilledWorldY }) => [
    id,
    id === filledId ? exactFilledWorldY : null,
  ]));
  environment.type = 'conserved-water-unit';
  environment.variableId = 'water.unit.configuration';
  environment.capacityUnits = 1;
  environment.conservedVolume = 1;
  environment.initialStateId = 'FreightSumpFilled';
  environment.transferCommit = 'atomic-after-animation';
  environment.basins = basins;
  environment.stableStates = bindings.basins.map((binding, index) => ({
    id: binding.stateId,
    totalUnits: 1,
    exactVolume: basins[index].exactFilledVolume,
    basinLevels: levelsFor(binding.basinId),
    absoluteBasinLevels: absoluteFor(binding.basinId),
  }));
  environment.movementProfile = {
    captureFloodedStateAtTakeoff: true,
    groundMovementMultiplier: 0.76,
    jumpHeight: 4.95,
    gravityScale: 0.28,
    mode: 'bottom-walking',
  };
  environment.permanentDryControlAnchorIds = [
    'anchor.water-router.freight',
    'anchor.water-router.reservoir',
    'anchor.water-router.gantry',
  ];
  environment.permanentDryClearance = 0.2;
  environment.sourceSemanticRoomPackPlacementId = placement.placementId;
  environment.sourceEnvironmentContractId = placement.waterContracts[0].id;
}

function authoredTraversalLinks(placement, surfaces) {
  const source = (name) => findBySource(surfaces, name).id;
  const condition = (value) => ({
    op: 'stateEquals',
    variableId: 'water.unit.configuration',
    value,
  });
  return [
    {
      id: 'traversal.semantic-room-pack.waterworks.entry-drop',
      regionId: 'freight-sump',
      fromSurfaceId: source('WALK_ENTRY_CATWALK'),
      toSurfaceId: source('WALK_SUMP_BOTTOM'),
      mode: 'authored-drop',
      bidirectional: false,
      minimumWidth: 1.2,
      damageFree: true,
      semanticRoomPackPlacementId: placement.placementId,
    },
    {
      id: 'traversal.semantic-room-pack.waterworks.permanent-return',
      regionId: 'freight-sump',
      fromSurfaceId: source('WALK_SUMP_BOTTOM'),
      toSurfaceId: source('WALK_ENTRY_CATWALK'),
      viaSurfaceIds: surfaces.filter(({ sourceNodeName }) => /^WALK_BASIN_RETURN_STEP_/u.test(sourceNodeName)).map(({ id }) => id),
      mode: 'walkable-stairs',
      bidirectional: true,
      minimumWidth: 1.2,
      maximumRiser: 0.18,
      minimumTread: 0.45,
      semanticRoomPackPlacementId: placement.placementId,
    },
    {
      id: 'traversal.semantic-room-pack.waterworks.drained-branch',
      regionId: 'salvage-tunnel',
      fromSurfaceId: source('WALK_SUMP_BOTTOM'),
      toSurfaceId: source('WALK_DRAIN_TUNNEL'),
      mode: 'bottom-walk',
      bidirectional: true,
      minimumWidth: 1.2,
      conditions: [condition('StoredInReservoir')],
      semanticRoomPackPlacementId: placement.placementId,
    },
    {
      id: 'traversal.semantic-room-pack.waterworks.gantry-route',
      regionId: 'gantry-sump',
      fromSurfaceId: source('WALK_SUMP_BOTTOM'),
      toSurfaceId: source('WALK_WEST_GANTRY'),
      viaSurfaceIds: surfaces.filter(({ sourceNodeName }) => /^WALK_GANTRY_ASCENT_STEP_/u.test(sourceNodeName)).map(({ id }) => id),
      mode: 'flooded',
      bidirectional: true,
      minimumWidth: 1.2,
      conditions: [condition('GantrySumpFilled')],
      semanticRoomPackPlacementId: placement.placementId,
    },
    {
      id: 'traversal.semantic-room-pack.waterworks.flooded-cache',
      regionId: 'freight-sump',
      fromSurfaceId: source('WALK_SUMP_BOTTOM'),
      toSurfaceId: source('WALK_SUMP_ISLAND_0'),
      mode: 'bottom-walk',
      bidirectional: true,
      minimumWidth: 1.2,
      conditions: [condition('FreightSumpFilled')],
      semanticRoomPackPlacementId: placement.placementId,
    },
  ];
}

function assertCollectionShape(plan, errors) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    addDiagnostic(errors, 'semantic-room-pack-waterworks-plan-invalid', 'Waterworks replacement requires a raw mutable dungeon plan.');
    return;
  }
  for (const name of [
    'regions', 'modulePlacements', 'spatialCells', 'structuralBoundaries',
    'walkableSurfaces', 'structuralFixtures', 'portals', 'traversalLinks',
    'semanticRoomPackPlacements', 'environmentStates', 'mechanisms',
  ]) {
    if (!Array.isArray(plan[name])) {
      addDiagnostic(errors, 'semantic-room-pack-waterworks-collection-missing', `Waterworks replacement requires plan.${name}.`, { collectionName: name });
    }
  }
}

function preflight(plan) {
  const errors = [];
  assertCollectionShape(plan, errors);
  if (errors.length) return errors;
  if (plan.fixtureKind !== 'golden-complex') {
    addDiagnostic(errors, 'semantic-room-pack-waterworks-fixture-invalid', 'Waterworks macro replacement only applies to the golden complex.', { fixtureKind: plan.fixtureKind ?? null });
  }
  for (const regionId of WATER_REGION_IDS) {
    if (plan.regions.filter(({ id }) => id === regionId).length !== 1) {
      addDiagnostic(errors, 'semantic-room-pack-waterworks-region-missing', `Golden Waterworks region ${regionId} must exist exactly once.`, { regionId });
    }
  }
  for (const moduleId of ABSORBED_MODULE_IDS) {
    if (plan.modulePlacements.filter(({ id }) => id === moduleId).length !== 1) {
      addDiagnostic(errors, 'semantic-room-pack-waterworks-module-missing', `Golden Waterworks module ${moduleId} must exist exactly once.`, { moduleId });
    }
  }
  for (const { portalId } of Object.values(SOCKET_ROUTE_BINDINGS)) {
    if (plan.portals.filter(({ id }) => id === portalId).length !== 1) {
      addDiagnostic(errors, 'semantic-room-pack-waterworks-portal-missing', `Useful Waterworks route ${portalId} must exist exactly once.`, { portalId });
    }
  }
  if (plan.semanticRoomPackPlacements.some(({ roomId }) => roomId === ROOM_ID)) {
    addDiagnostic(errors, 'semantic-room-pack-waterworks-duplicate', 'The authored Waterworks macro is already present.', { roomId: ROOM_ID });
  }
  const water = plan.environmentStates.find(({ id }) => id === 'environment.water-unit');
  if (!water || water.capacityUnits !== 1 || water.stableStates?.length !== 3) {
    addDiagnostic(errors, 'semantic-room-pack-waterworks-water-contract-missing', 'The exact one-unit, three-state global Waterworks contract is required.');
  }
  if (!plan.mechanisms.some(({ id }) => id === 'mechanism.water-router')) {
    addDiagnostic(errors, 'semantic-room-pack-waterworks-router-missing', 'The global water-router mechanism is required.');
  }
  return errors;
}

function mutateDraft(plan) {
  const entryPortal = plan.portals.find(({ id }) => id === 'portal.sorting-freight-sump');
  const entry = entryPortal.to;
  if (entry.side !== 'east') {
    throw new Error(`Waterworks entry endpoint must remain the east-facing Freight Sump boundary; received ${entry.side}.`);
  }
  const placementBase = compileSemanticRoomPackPlacementV2(ROOM_ID, {
    placementId: PLACEMENT_ID,
    entrySocketId: 'entry_south',
    targetPortal: {
      id: entryPortal.id,
      position: { x: entry.center.x, y: entry.elevation, z: entry.center.z },
      forward: { x: 1, y: 0, z: 0 },
      connectorType: entryPortal.connectorForm,
      aperture: [entry.dimensions.width, entry.dimensions.height],
    },
    yawQuarterTurns: 1,
  });
  const descriptor = getSemanticRoomPackV1Descriptor(ROOM_ID);
  const boundaries = placementBase.structuralBoundaries.map((record) => enrichBoundary(placementBase, record));
  const supportBoundaryIds = boundaries.map(({ id }) => id);
  const fixtures = placementBase.structuralFixtures.map((record) => enrichFixture(placementBase, record, supportBoundaryIds));
  const surfaces = placementBase.walkableSurfaces.map((record) => (
    enrichSurface(placementBase, record, descriptor, supportBoundaryIds, fixtures)
  ));
  const authoredControlDeck = findBySource(surfaces, 'WALK_NORTH_PUMP_DECK');
  authoredControlDeck.purpose = 'permanently dry authored master water control console pad';
  const logicalCells = createLogicalCells(placementBase, boundaries);

  const removedCellIds = new Set(REPLACED_FREIGHT_CELL_IDS);
  const floodedFixtureTemplate = clonePlanData(plan.structuralFixtures.find(({ id }) => (
    id === 'fixture.interaction.discover.flooded'
  )));
  if (!floodedFixtureTemplate) throw new Error('Flooded discovery physical fixture is missing before Waterworks replacement.');
  const removedSurfaceIds = new Set(plan.walkableSurfaces.filter(({ cellId }) => removedCellIds.has(cellId)).map(({ id }) => id));
  plan.spatialCells = plan.spatialCells.filter(({ id }) => !removedCellIds.has(id));
  plan.structuralBoundaries = plan.structuralBoundaries.filter(({ cellId }) => !removedCellIds.has(cellId));
  plan.walkableSurfaces = plan.walkableSurfaces.filter(({ cellId }) => !removedCellIds.has(cellId));
  plan.structuralFixtures = plan.structuralFixtures.filter(({ cellId }) => !removedCellIds.has(cellId));
  plan.traversalLinks = plan.traversalLinks.filter((link) => (
    !removedSurfaceIds.has(link.fromSurfaceId)
    && !removedSurfaceIds.has(link.toSurfaceId)
    && !(link.viaSurfaceIds ?? []).some((id) => removedSurfaceIds.has(id))
  ));
  plan.modulePlacements = plan.modulePlacements.filter(({ id }) => !ABSORBED_MODULE_IDS.includes(id));

  const socketBindings = bindSockets(plan, placementBase, boundaries, surfaces);
  plan.spatialCells.push(...logicalCells);
  plan.structuralBoundaries.push(...boundaries);
  plan.walkableSurfaces.push(...surfaces);
  plan.structuralFixtures.push(...fixtures);
  const water = createWaterBindings(placementBase, boundaries, surfaces);
  plan.walkableSurfaces.push(...water.contractSurfaces);
  reconcileGlobalWaterContract(plan, placementBase, water);
  plan.traversalLinks.push(...authoredTraversalLinks(placementBase, surfaces));

  const floodedMarker = placementBase.semanticMarkers.find(({ sourceNodeName }) => (
    sourceNodeName === 'ANCHOR_REWARD_SUBMERGED'
  ));
  const floodedSupport = findBySource(surfaces, 'WALK_SUMP_ISLAND_0');
  if (!floodedMarker) throw new Error('Authored flooded discovery marker is missing.');
  const floodedFixtureBounds = {
    min: vector(floodedMarker.worldPosition.x - 0.7, floodedSupport.bounds.max.y, floodedMarker.worldPosition.z - 0.7),
    max: vector(floodedMarker.worldPosition.x + 0.7, floodedSupport.bounds.max.y + 1.15, floodedMarker.worldPosition.z + 0.7),
  };
  plan.structuralFixtures.push({
    ...floodedFixtureTemplate,
    regionId: 'freight-sump',
    cellId: PACK_CELL_ID,
    bounds: floodedFixtureBounds,
    supportBoundaryIds: [...floodedSupport.supportBoundaryIds],
    colliderBounds: [clonePlanData(floodedFixtureBounds)],
    semanticRoomPackPlacementId: placementBase.placementId,
  });

  for (const cell of plan.spatialCells.filter(({ portalId }) => portalId === 'portal.freight-sump-reservoir')) {
    cell.compoundId = 'compound.semantic-room-pack.waterworks';
    cell.semanticRoomPackPlacementId = placementBase.placementId;
  }
  const replacementStartSurfaceId = findBySource(surfaces, 'WALK_DRAIN_TUNNEL').id;
  for (const surface of plan.walkableSurfaces.filter(({ cellId }) => (
    String(cellId).startsWith('cell.connector.freight-sump-reservoir.')
  ))) {
    if (!surface.geometry?.endpointSurfaceIds) continue;
    for (const endpointName of Object.keys(surface.geometry.endpointSurfaceIds)) {
      if (removedSurfaceIds.has(surface.geometry.endpointSurfaceIds[endpointName])) {
        surface.geometry.endpointSurfaceIds[endpointName] = replacementStartSurfaceId;
      }
    }
  }
  const formerStair = plan.walkableSurfaces.find(({ id }) => id === 'surface.connector.freight-sump-reservoir.0');
  const upperConnectorDeck = plan.walkableSurfaces.find(({ id }) => id === 'surface.connector.freight-sump-reservoir.1');
  const drainDeck = findBySource(surfaces, 'WALK_DRAIN_TUNNEL');
  if (!formerStair || !upperConnectorDeck) {
    throw new Error('Freight Sump to Reservoir vertical transfer surfaces are missing.');
  }
  const ladderRootX = -40.75;
  const ladderPlaneX = -40.35;
  const ladderZ = -21.55;
  const bottomY = drainDeck.bounds.max.y;
  const topY = upperConnectorDeck.bounds.max.y;
  formerStair.cellId = PACK_CELL_ID;
  formerStair.bounds = {
    min: vector(ladderRootX - 0.9, bottomY, ladderZ - 0.9),
    max: vector(ladderPlaneX + 0.55, topY, ladderZ + 0.9),
  };
  formerStair.purpose = 'enclosed authored drain-tunnel ladder into the dry Reservoir pump gallery';
  formerStair.supportBoundaryIds = [...drainDeck.supportBoundaryIds];
  formerStair.supportProfile = 'semantic-room-pack-waterworks-ladder-frame';
  formerStair.visualProfile = 'industrial-ladder-v2';
  formerStair.geometry = {
    type: 'ladder',
    path: [
      vector(ladderRootX, bottomY, ladderZ),
      vector(ladderRootX, topY, ladderZ),
    ],
    planePath: [
      vector(ladderPlaneX, bottomY, ladderZ),
      vector(ladderPlaneX, topY, ladderZ),
    ],
    width: 1.6,
    mountClearance: 1.4,
    climbFacing: vector(1, 0, 0),
    facing: vector(1, 0, 0),
    planeNormal: vector(-1, 0, 0),
    bodyClearance: 0.4,
    bottomExit: vector(ladderRootX - 1.25, bottomY, ladderZ),
    topExit: vector(ladderPlaneX + 1.25, topY, ladderZ),
    height: round(topY - bottomY),
    bottomExitFacing: vector(-1, 0, 0),
    topExitFacing: vector(1, 0, 0),
    topOpening: {
      kind: 'open-landing-edge',
      bounds: {
        min: vector(ladderRootX - 0.65, topY - 0.35, ladderZ - 1.3),
        max: vector(ladderPlaneX + 0.55, topY + 0.05, ladderZ + 1.3),
      },
      playableBelowSurfaceId: drainDeck.id,
      minimumClearWidth: 1.6,
      minimumClearDepth: 0.78,
    },
    landings: {
      bottom: {
        surfaceId: drainDeck.id,
        exit: vector(ladderRootX - 1.25, bottomY, ladderZ),
        egressDirection: vector(-1, 0, 0),
        minimumClearLength: 1.2,
        minimumClearWidth: 1.2,
        minimumHeadroom: 3.2,
      },
      top: {
        surfaceId: upperConnectorDeck.id,
        exit: vector(ladderPlaneX + 1.25, topY, ladderZ),
        egressDirection: vector(1, 0, 0),
        minimumClearLength: 1.2,
        minimumClearWidth: 1.2,
        minimumHeadroom: 3.2,
      },
    },
    semanticRoomPackSocketId: 'drain_tunnel_east',
  };

  const annexBounds = WATER_REGION_IDS.slice(1).map((regionId) => (
    plan.regions.find(({ id }) => id === regionId).bounds
  ));
  const compositionBounds = unionBounds([placementBase.worldBounds, ...annexBounds]);
  const modulePlacement = {
    id: PLACEMENT_ID,
    placementId: PLACEMENT_ID,
    descriptorId: `module.semantic-room-pack.${ROOM_ID}.macro-composition-v2`,
    descriptorRevision: 1,
    roomId: ROOM_ID,
    packId: placementBase.packId,
    packRevision: placementBase.packRevision,
    regionIds: [...WATER_REGION_IDS],
    bounds: compositionBounds,
    occupiedVolumes: [{ id: `${PLACEMENT_ID}.authored-volume`, bounds: clonePlanData(placementBase.worldBounds) }],
    yawQuarterTurns: placementBase.placementTransform.yawQuarterTurns,
    translation: clonePlanData(placementBase.placementTransform.translation),
    topologySignature: 'pending-derived-signature',
    presentationAssetFamilyId: 'semantic-room-pack-v1.waterworks-freight-sump',
    presentationAssetSource: 'authored-semantic-room-pack-v1',
    gameplayPurpose: placementBase.gameplayPurpose,
    platformPurposes: clonePlanData(descriptor.platformPurposes),
    collisionSourcePolicy: 'authored-room uses manifest collision volumes only; retained annexes remain accepted plan-owned structural kit',
    semanticRoomPackPlacementId: placementBase.placementId,
    absorbedModulePlacementIds: [...ABSORBED_MODULE_IDS],
    retainedPlanOwnedAnnexRegionIds: ['reservoir', 'gantry-sump', 'salvage-tunnel'],
  };
  plan.modulePlacements.push(modulePlacement);

  const placement = deepFreezePlan({
    ...clonePlanData(placementBase),
    goldenRegionId: 'freight-sump',
    goldenRegionIds: [...WATER_REGION_IDS],
    socketBindings,
    absorbedModulePlacementIds: [...ABSORBED_MODULE_IDS],
    retainedPlanOwnedAnnexRegionIds: ['reservoir', 'gantry-sump', 'salvage-tunnel'],
    connectorCellIds: [],
    connectorBoundaryIds: [],
    connectorSurfaceIds: [],
    integratedPlanRecordIds: {
      structuralBoundaryIds: boundaries.map(({ id }) => id),
      walkableSurfaceIds: [...surfaces, ...water.contractSurfaces].map(({ id }) => id),
      structuralFixtureIds: fixtures.map(({ id }) => id),
      colliderIds: placementBase.transformedCollisionVolumes.map(({ id }) => id),
    },
    runtimeContractBindings: water.runtimeContractBindings,
    runtimePresentationBindings: water.runtimePresentationBindings,
    physicalReplacement: {
      authoredCellId: PACK_CELL_ID,
      authoredBounds: clonePlanData(placementBase.worldBounds),
      compositionBounds,
      removedLegacyCellIds: [...REPLACED_FREIGHT_CELL_IDS],
      addedConnectorCellCount: 0,
      collisionAuthority: 'manifest-collision-volumes-only',
      derivedLogicalBasinPartitionsUseManifestCollider: true,
    },
  });
  const placementValidation = validateSemanticRoomPackPlacementV2(placement);
  if (!placementValidation.accepted) {
    throw new Error(`Compiled Waterworks replacement placement is invalid: ${placementValidation.diagnosticHash}.`);
  }
  plan.semanticRoomPackPlacements.push(placement);

  for (const region of plan.regions.filter(({ id }) => WATER_REGION_IDS.includes(id))) {
    region.modulePlacementId = PLACEMENT_ID;
    if (region.id === 'freight-sump') region.bounds = clonePlanData(placementBase.worldBounds);
    region.cellIds = plan.spatialCells.filter(({ regionId }) => regionId === region.id).map(({ id }) => id);
    region.subRegions = [
      ...(region.subRegions ?? []).filter(({ cellId }) => !removedCellIds.has(cellId)),
      ...logicalCells.filter(({ regionId }) => regionId === region.id).map((cell) => ({
        id: `${region.id}.semantic-room-pack`,
        cellId: cell.id,
        purpose: 'authored semantic room-pack Waterworks macro region',
      })),
    ];
  }

  const floodedAnchorMarker = placement.semanticMarkers.find(({ sourceNodeName }) => sourceNodeName === 'ANCHOR_REWARD_SUBMERGED');
  const drainedMarker = placement.semanticMarkers.find(({ sourceNodeName }) => sourceNodeName === 'ANCHOR_REWARD_DRAINED');
  const consoleMarker = placement.semanticMarkers.find(({ sourceNodeName }) => sourceNodeName === 'ANCHOR_MASTER_CONSOLE');
  for (const [anchorId, marker, regionId, surfaceId, purpose] of [
    ['anchor.discovery.flooded', floodedAnchorMarker, 'freight-sump', water.runtimeContractBindings.water.discoverySurfaceIds.submerged_salvage_cache, 'authored flooded-only Waterworks discovery'],
    ['anchor.discovery.drained', drainedMarker, 'salvage-tunnel', water.runtimeContractBindings.water.discoverySurfaceIds.drained_tunnel_cache, 'authored drained-only Waterworks discovery'],
  ]) {
    const anchor = plan.anchors.find(({ id }) => id === anchorId);
    if (anchor && marker) Object.assign(anchor, {
      regionId,
      position: clonePlanData(marker.worldPosition),
      purpose,
      surfaceId,
      safeSurfaceId: surfaceId,
      semanticRoomPackPlacementId: placement.placementId,
    });
  }
  for (const anchorId of ['anchor.water-router.freight', 'anchor.water-router.reservoir', 'anchor.water-router.gantry']) {
    const anchor = plan.anchors.find(({ id }) => id === anchorId);
    if (anchor && consoleMarker) Object.assign(anchor, {
      regionId: 'reservoir',
      position: clonePlanData(consoleMarker.worldPosition),
      purpose: 'permanently dry authored master Waterworks router',
      surfaceId: water.runtimeContractBindings.water.controlSurfaceId,
      safeSurfaceId: water.runtimeContractBindings.water.controlSurfaceId,
      semanticRoomPackPlacementId: placement.placementId,
    });
  }

  const signatures = deriveDungeonTopologySignaturesV2(plan);
  for (const region of plan.regions) region.topologySignature = signatures[region.id];
  modulePlacement.topologySignature = WATER_REGION_IDS.map((id) => signatures[id]).join('+');

  plan.semanticRoomPackWaterworksReplacement = {
    revision: SEMANTIC_ROOM_PACK_WATERWORKS_REPLACEMENT_V2_REVISION,
    placementId: placement.placementId,
    roomId: placement.roomId,
    absorbedModulePlacementIds: [...ABSORBED_MODULE_IDS],
    authoredCellId: PACK_CELL_ID,
    retainedPlanOwnedAnnexRegionIds: ['reservoir', 'gantry-sump', 'salvage-tunnel'],
    socketBindings: clonePlanData(socketBindings),
    addedConnectorCellCount: 0,
    collisionAuthority: 'manifest-collision-volumes-only',
    waterStateIds: water.runtimeContractBindings.water.basins.map(({ stateId }) => stateId),
    discoveryIds: ['submerged_salvage_cache', 'drained_tunnel_cache', 'gantry_high_route'],
    fullyPhysicalized: false,
    productionEligible: false,
    pendingSharedValidation: true,
  };
  if (!isSerializablePlanValue(plan)) throw new Error('Waterworks replacement produced non-serializable plan data.');
  return plan;
}

function resultFor(errors, draft = null, sharedValidation = null) {
  const sorted = sortPlanDiagnostics(errors);
  return deepFreezePlan({
    accepted: sorted.length === 0,
    errors: sorted,
    diagnosticHash: hashPlanDiagnostics(sorted),
    plan: draft,
    sharedValidation: sharedValidation ? {
      accepted: sharedValidation.accepted,
      diagnosticHash: sharedValidation.diagnosticHash,
      errors: clonePlanData(sharedValidation.errors),
      warnings: clonePlanData(sharedValidation.warnings),
      diagnostics: clonePlanData(sharedValidation.diagnostics),
    } : null,
  });
}

export function validateGoldenWaterworksSemanticRoomPackReplacementV2(plan, options = {}) {
  const errors = preflight(plan);
  if (errors.length) return resultFor(errors);
  let draft;
  try {
    draft = mutateDraft(clonePlanData(plan));
  } catch (error) {
    addDiagnostic(errors, 'semantic-room-pack-waterworks-compile-failed', 'Authored Waterworks replacement could not be compiled.', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return resultFor(errors);
  }
  const sharedValidation = options.validateDungeon === false
    ? null
    : validateDungeonPlanV2(draft, { allowIncompleteGoldenComposition: true });
  draft.semanticRoomPackWaterworksReplacement.sharedValidation = sharedValidation ? {
    accepted: sharedValidation.accepted,
    diagnosticHash: sharedValidation.diagnosticHash,
    errorCodes: [...new Set(sharedValidation.errors.map(({ code }) => code))].sort(),
  } : null;
  draft.semanticRoomPackWaterworksReplacement.fullyPhysicalized = sharedValidation?.accepted === true;
  draft.semanticRoomPackWaterworksReplacement.productionEligible = sharedValidation?.accepted === true;
  draft.semanticRoomPackWaterworksReplacement.pendingSharedValidation = sharedValidation?.accepted !== true;
  return resultFor([], draft, sharedValidation);
}

export class SemanticRoomPackWaterworksReplacementErrorV2 extends Error {
  constructor(result) {
    const first = result.errors?.[0];
    super(first
      ? `Waterworks replacement rejected: ${first.code}: ${first.message}`
      : 'Waterworks replacement rejected.');
    this.name = 'SemanticRoomPackWaterworksReplacementErrorV2';
    this.code = 'SEMANTIC_ROOM_PACK_WATERWORKS_REPLACEMENT_INVALID';
    this.result = result;
  }
}

export function replaceGoldenWaterworksWithSemanticRoomPackV2(plan, options = {}) {
  const result = validateGoldenWaterworksSemanticRoomPackReplacementV2(plan, options);
  if (!result.accepted) throw new SemanticRoomPackWaterworksReplacementErrorV2(result);
  const replacement = clonePlanData(result.plan);
  replacement.semanticRoomPackPlacements = replacement.semanticRoomPackPlacements
    .map((placement) => deepFreezePlan(placement));
  for (const key of Object.keys(replacement)) plan[key] = replacement[key];
  return plan;
}

export default replaceGoldenWaterworksWithSemanticRoomPackV2;
