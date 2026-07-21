import {
  clonePlanData,
  deepFreezePlan,
} from './DungeonPlanV2Contract.js';
import { compileSemanticRoomPackPlacementV2 } from './SemanticRoomPackPlanAdapterV2.js';
import { getSemanticRoomPackV1Descriptor } from './SemanticRoomPackV1Catalog.js';
import { deriveDungeonTopologySignaturesV2 } from './DungeonTopologySignatureV2.js';

export const SEMANTIC_ROOM_PACK_GOLDEN_INTEGRATION_V2_REVISION = 3;

const FACTORY_ROOM_ID = 'rdx_factory_corkscrew_exchange';
const WATERWORKS_ROOM_ID = 'rdx_waterworks_freight_sump';
const UNDERCROFT_ROOM_IDS = Object.freeze({
  magma: 'rdx_magma_foundry_undercroft',
  electrical: 'rdx_electric_transformer_undercroft',
});
const BOUNDARY_SIDES = Object.freeze(['north', 'south', 'east', 'west', 'floor', 'ceiling']);
const WALL_THICKNESS = 0.4;
const SOCKET_WALL_THICKNESS = 0.45;
const CONNECTOR_MARGIN_XZ = 0.8;
const CONNECTOR_MARGIN_Y = 1;
const EPSILON = 1e-7;

const SIDE_FORWARD = Object.freeze({
  north: Object.freeze({ x: 0, y: 0, z: -1 }),
  south: Object.freeze({ x: 0, y: 0, z: 1 }),
  east: Object.freeze({ x: 1, y: 0, z: 0 }),
  west: Object.freeze({ x: -1, y: 0, z: 0 }),
});
const OPPOSITE_SIDE = Object.freeze({
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
  floor: 'ceiling',
  ceiling: 'floor',
});

const GOLDEN_BRANCH_SPECS = deepFreezePlan([
  {
    key: 'factory-corkscrew',
    placementId: 'placement.semantic-room-pack.factory-corkscrew',
    roomId: FACTORY_ROOM_ID,
    regionId: 'corkscrew',
    hostCellId: 'cell.corkscrew.main',
    hostSide: 'south',
    transverseOffset: 82,
    connectorGap: 8,
    yawQuarterTurns: 2,
    mechanismId: 'mechanism.corkscrew-gear',
    connectorForm: 'maintenance-pipe',
    routes: [
      {
        socketId: 'entry_south', key: 'parts-entry', hostCellId: 'cell.parts.main', hostSide: 'east',
        hostAnchor: { x: 67, y: 6.35, z: -43 }, hostSurfaceId: 'surface.parts.main',
        routePoints: [{ x: 67, y: 6.35, z: -43 }, { x: 72, y: 6.35, z: -43 }, { x: 72, y: 10, z: 20 }, { x: 82, y: 10, z: 20 }, { x: 82, y: 10, z: 25 }],
        connectorForm: 'supported-factory-service',
      },
      {
        socketId: 'exit_east_mid', key: 'hazard-intake-mid', hostCellId: 'cell.hazard-intake.main', hostSide: 'west',
        hostAnchor: { x: 77, y: -7.65, z: 0 }, hostSurfaceId: 'surface.hazard-intake.main',
        routePoints: [{ x: 77, y: -7.65, z: 0 }, { x: 71, y: -7.65, z: 0 }, { x: 71, y: -7.65, z: -24 }, { x: 20, y: -7.65, z: -24 }, { x: 20, y: 13.2, z: 42 }, { x: 64, y: 13.2, z: 42 }],
        connectorForm: 'enclosed-hazard-access-stair',
      },
      {
        socketId: 'exit_north_high', key: 'machine-core-gamma', hostCellId: 'cell.machine-core.main', hostSide: 'west',
        hostAnchor: { x: 127, y: 16.35, z: 0 }, hostSurfaceId: 'surface.machine-core.main',
        routePoints: [{ x: 127, y: 16.35, z: 0 }, { x: 121, y: 16.4, z: 0 }, { x: 121, y: 16.4, z: 65 }, { x: 82, y: 16.4, z: 65 }, { x: 82, y: 16.4, z: 59 }],
        connectorForm: 'gamma-secured-upper-catwalk', barrierId: 'Door_Gamma',
        conditions: [{ op: 'hasKey', keyId: 'Keycard_Gamma' }], initiallyOpen: false,
      },
      {
        socketId: 'exit_west_top', key: 'credential-return', hostCellId: 'cell.credential.main', hostSide: 'south',
        hostAnchor: { x: 48, y: 6.35, z: 16 }, hostSurfaceId: 'surface.credential.main',
        routePoints: [{ x: 48, y: 6.35, z: 16 }, { x: 48, y: 6.35, z: 22 }, { x: 106, y: 6.35, z: 22 }, { x: 158, y: 19.6, z: 22 }, { x: 158, y: 19.6, z: 42 }, { x: 106, y: 19.6, z: 42 }, { x: 100, y: 19.6, z: 42 }],
        connectorForm: 'credential-return-gallery', barrierId: 'Gate_Credential_Loop',
        conditions: [{ op: 'gateOpen', gateId: 'Gate_Credential_Loop' }], initiallyOpen: false,
      },
    ],
  },
  {
    key: 'waterworks-freight-sump',
    placementId: 'placement.semantic-room-pack.waterworks-freight-sump',
    roomId: WATERWORKS_ROOM_ID,
    regionId: 'freight-sump',
    hostCellId: 'cell.freight-sump.main',
    hostSide: 'west',
    transverseOffset: -8,
    connectorGap: 8,
    yawQuarterTurns: 1,
    mechanismId: null,
    connectorForm: 'pump-catwalk',
    routes: [
      {
        socketId: 'entry_south', key: 'freight-entry', hostCellId: 'cell.freight-sump.main', hostSide: 'west',
        hostAnchor: { x: -66, y: -13.65, z: -8 }, hostSurfaceId: 'surface.freight-sump.main',
        routePoints: [{ x: -66, y: -13.65, z: -8 }, { x: -74, y: -14, z: -8 }], connectorForm: 'pressure-door-catwalk',
      },
      {
        socketId: 'exit_north', key: 'reservoir-return', hostCellId: 'cell.reservoir.main', hostSide: 'west',
        hostAnchor: { x: -62, y: -7.65, z: -41 }, hostSurfaceId: 'surface.reservoir.main',
        routePoints: [{ x: -62, y: -7.65, z: -41 }, { x: -68, y: -7.65, z: -41 }, { x: -102, y: -14, z: -41 }, { x: -122, y: -14, z: -41 }, { x: -122, y: -14, z: -8 }, { x: -116, y: -14, z: -8 }], connectorForm: 'reservoir-service-stair',
      },
      {
        socketId: 'drain_tunnel_east', key: 'drained-salvage', hostCellId: 'cell.salvage-tunnel.main', hostSide: 'west',
        hostAnchor: { x: -17, y: -17.65, z: 0 }, hostSurfaceId: 'surface.salvage-tunnel.main',
        routePoints: [{ x: -17, y: -17.65, z: 0 }, { x: -23, y: -17.65, z: 0 }, { x: -23, y: -17.65, z: -33 }, { x: -29, y: -18.8, z: -33 }, { x: -88, y: -18.8, z: -33 }, { x: -88, y: -18.8, z: -27 }], connectorForm: 'drain-tunnel',
      },
      {
        socketId: 'gantry_exit_west', key: 'gantry-sump', hostCellId: 'cell.gantry-sump.main', hostSide: 'east',
        hostAnchor: { x: 18, y: -11.65, z: -41 }, hostSurfaceId: 'surface.gantry-sump.main',
        routePoints: [{ x: 18, y: -11.65, z: -41 }, { x: 26, y: -9.05, z: -41 }, { x: 26, y: -9.05, z: 17 }, { x: -102, y: -9.05, z: 17 }, { x: -102, y: -9.05, z: 11 }], connectorForm: 'upper-pump-catwalk',
      },
    ],
  },
  {
    key: 'undercroft',
    placementId: 'placement.semantic-room-pack.undercroft',
    roomId: null,
    regionId: 'hazard-core',
    hostCellId: 'cell.hazard-core.main',
    hostSide: 'south',
    transverseOffset: 48,
    connectorGap: 8,
    yawQuarterTurns: 2,
    mechanismId: 'mechanism.undercroft-hazard',
    connectorForm: 'hazard-catwalk',
    routes: [
      {
        socketId: 'entry_south', key: 'hazard-intake-entry', hostCellId: 'cell.hazard-intake.main', hostSide: 'south',
        hostAnchor: { x: 96, y: -7.65, z: 14 }, hostSurfaceId: 'surface.hazard-intake.main',
        routePoints: [{ x: 96, y: -7.65, z: 14 }, { x: 96, y: -7.65, z: 20 }, { x: 60, y: -14, z: 20 }, { x: 48, y: -14, z: 20 }, { x: 48, y: -14, z: 25 }], connectorForm: 'hazard-intake-descent',
      },
      {
        socketId: 'exit_north', key: 'gamma-permanent-return', hostCellId: 'cell.hazard-core.main', hostSide: 'east',
        hostAnchor: { x: 70, y: -13.65, z: -12 }, hostSurfaceId: 'surface.mechanism.gamma-return-lift.landing.lower',
        routePoints: [{ x: 70, y: -13.65, z: -12 }, { x: 74, y: -14, z: -12 }, { x: 74, y: -14, z: 67 }, { x: 48, y: -14, z: 67 }, { x: 48, y: -14, z: 61 }], connectorForm: 'gamma-return-service',
        barrierId: 'Gate_Shortcut_Gamma', conditions: [{ op: 'gateOpen', gateId: 'Gate_Shortcut_Gamma' }], initiallyOpen: false,
      },
    ],
    optionalCapSocketIds: ['service_west', 'upper_east'],
  },
]);

const REGION_SURFACE_HINTS = deepFreezePlan({
  [FACTORY_ROOM_ID]: {
    entry_apron: 'WALK_ENTRY_APRON',
    corkscrew_platform: 'MECH_BRIDGE_SOUTH',
    recovery_floor: 'WALK_LOWER_CATCHMENT',
    east_mid_ledge: 'WALK_EAST_MID_LEDGE',
    north_high_ledge: 'WALK_NORTH_HIGH_LEDGE',
    west_top_ledge: 'WALK_WEST_TOP_LEDGE',
  },
  [WATERWORKS_ROOM_ID]: {
    entry_catwalk: 'WALK_ENTRY_CATWALK',
    freight_sump: 'WALK_SUMP_BOTTOM',
    drain_tunnel: 'WALK_DRAIN_TUNNEL',
    upper_gantry: 'WALK_WEST_GANTRY',
    submerged_salvage_cache: 'WALK_SUMP_ISLAND_0',
    pump_deck: 'WALK_NORTH_PUMP_DECK',
  },
  rdx_magma_foundry_undercroft: {
    entry_deck: 'WALK_ENTRY_FOUNDRY_DECK',
    control_deck: 'WALK_NORTH_CONTROL_DECK',
    heat_reward_branch: 'WALK_WEST_SAFE_SERVICE',
  },
  rdx_electric_transformer_undercroft: {
    entry_deck: 'WALK_ENTRY_INSULATED_DECK',
    switch_deck: 'WALK_NORTH_SWITCH_DECK',
    upper_gallery: 'WALK_UPPER_EAST_GALLERY',
    timing_reward_branch: 'WALK_TIMING_REWARD_PAD_00',
  },
});

function markerByNodeName(placement, sourceNodeName) {
  const marker = placement.semanticMarkers.find((entry) => entry.sourceNodeName === sourceNodeName);
  if (!marker) throw new Error(`${placement.placementId} has no authored semantic marker ${sourceNodeName}.`);
  return marker;
}

function structuralRuntimeSurface({ id, spec, bounds, purpose, supportBoundaryIds, visualProfile, collision = 'static', mechanismId = null, hazardTag = null, environmentStateId = null, sourceNodeName = null }) {
  return {
    id,
    regionId: spec.regionId,
    cellId: spec.packCellId,
    bounds,
    purpose,
    supportBoundaryIds: [...supportBoundaryIds],
    supportFixtureIds: [],
    supportProfile: 'semantic-room-pack-v1-explicit-structural-contract',
    visualProfile,
    collision,
    mechanismId,
    hazardTag,
    environmentStateId,
    sourceNodeName,
    createsLedgeCandidates: false,
    ledgePolicy: 'authored-semantic-runtime-surface',
  };
}

function addExplicitRuntimeSurfaces(plan, compiled, spec, surfaces, supportBoundaryIds) {
  const bindings = {};
  const auxiliarySurfaceIds = [];
  if (compiled.roomId === FACTORY_ROOM_ID) {
    const gear = markerByNodeName(compiled, 'MECH_GEAR_PLATFORM');
    const dynamicSurface = structuralRuntimeSurface({
      id: `surface.semantic-room-pack.${spec.key}.gear-platform`,
      spec,
      bounds: {
        min: vector(gear.worldPosition.x - 2.2, gear.worldPosition.y - 0.15, gear.worldPosition.z - 2.2),
        max: vector(gear.worldPosition.x + 2.2, gear.worldPosition.y + 0.15, gear.worldPosition.z + 2.2),
      },
      purpose: 'explicit code-native corkscrew gear traversal platform at the authored mechanism marker',
      supportBoundaryIds,
      visualProfile: 'semantic-room-pack-v1:factory:corkscrew-gear-platform',
      collision: 'dynamic',
      mechanismId: 'mechanism.corkscrew-gear',
      sourceNodeName: 'MECH_GEAR_PLATFORM',
    });
    const controlSurface = structuralRuntimeSurface({
      id: `surface.semantic-room-pack.${spec.key}.control-deck`,
      spec,
      bounds: {
        min: vector(gear.worldPosition.x - 2.1, gear.worldPosition.y - 0.3, gear.worldPosition.z - 6.2),
        max: vector(gear.worldPosition.x + 2.1, gear.worldPosition.y, gear.worldPosition.z - 3.2),
      },
      purpose: 'permanent stable side control deck for the authored corkscrew exchange',
      supportBoundaryIds,
      visualProfile: 'semantic-room-pack-v1:factory:corkscrew-control-deck',
      sourceNodeName: 'ANCHOR_MECHANISM_CONSOLE',
    });
    surfaces.push(dynamicSurface, controlSurface);
    auxiliarySurfaceIds.push(dynamicSurface.id, controlSurface.id);
    bindings.corkscrew = {
      mechanismId: 'mechanism.corkscrew-gear',
      dynamicSurfaceId: dynamicSurface.id,
      controlSurfaceId: controlSurface.id,
      sourceNodeName: 'MECH_GEAR_PLATFORM',
      controlSourceNodeName: 'ANCHOR_MECHANISM_CONSOLE',
    };
  }
  if (compiled.roomId === WATERWORKS_ROOM_ID) {
    const environment = plan.environmentStates.find(({ id }) => id === 'environment.water-unit');
    const authoredFloor = surfaces.find(({ sourceNodeName }) => sourceNodeName === 'WALK_SUMP_BOTTOM');
    const controlSurface = surfaces.find(({ sourceNodeName }) => sourceNodeName === 'WALK_NORTH_PUMP_DECK');
    const waterContract = compiled.waterContracts[0];
    if (!environment || !authoredFloor || !controlSurface || !waterContract) {
      throw new Error(`${compiled.placementId} cannot bind its conserved water geometry.`);
    }
    const stateToBasin = {
      FreightSumpFilled: environment.basins.find(({ id }) => id === 'basin.freight-sump'),
      StoredInReservoir: environment.basins.find(({ id }) => id === 'basin.reservoir'),
      GantrySumpFilled: environment.basins.find(({ id }) => id === 'basin.gantry-sump'),
    };
    const waterBasins = Object.entries(stateToBasin).map(([stateId, basin]) => {
      if (!basin) throw new Error(`${compiled.placementId} cannot resolve global basin for ${stateId}.`);
      const freight = stateId === 'FreightSumpFilled';
      return {
        stateId,
        basinId: basin.id,
        regionId: freight ? spec.regionId : basin.regionId,
        bounds: freight ? {
          min: vector(authoredFloor.bounds.min.x, waterContract.basinBottomWorldY, authoredFloor.bounds.min.z),
          max: vector(authoredFloor.bounds.max.x, compiled.worldBounds.max.y, authoredFloor.bounds.max.z),
        } : clonePlanData(basin.bounds),
        floorSurfaceId: freight ? authoredFloor.id : basin.floorSurfaceId,
        levelKey: stateId === 'FreightSumpFilled' ? 'freightLevelWorldY'
          : stateId === 'StoredInReservoir' ? 'storedLevelWorldY' : 'gantryLevelWorldY',
        sourceBasinBottomWorldY: freight ? waterContract.basinBottomWorldY : null,
      };
    });
    const discoverySurfaceIds = {
      submerged_salvage_cache: surfaces.find(({ sourceNodeName }) => sourceNodeName === 'WALK_SUMP_ISLAND_0')?.id ?? null,
      drained_tunnel_cache: surfaces.find(({ sourceNodeName }) => sourceNodeName === 'WALK_DRAIN_TUNNEL')?.id ?? null,
    };
    if (Object.values(discoverySurfaceIds).some((id) => !id)) {
      throw new Error(`${compiled.placementId} cannot bind its authored Waterworks discoveries.`);
    }
    bindings.water = {
      environmentStateId: 'environment.water-unit',
      controllerId: 'mechanism.water-router',
      basins: waterBasins,
      controlSurfaceId: controlSurface.id,
      discoverySurfaceIds,
    };
    // Transitional aliases keep diagnostics readable while the plan/state
    // bridge migrates exclusively to the nested water contract above.
    bindings.waterBasins = clonePlanData(waterBasins);
    bindings.controlSurfaceId = controlSurface.id;
  }
  if (compiled.hazardContracts.length) {
    const globalEnvironment = plan.environmentStates.find(({ id }) => id === 'environment.undercroft-hazard');
    const hazardMarkers = compiled.semanticMarkers.filter(({ semantic }) => semantic === 'hazardSurface');
    const hazardTag = globalEnvironment?.hazardTag ?? (compiled.roomId.includes('electric') ? 'environmental:electrical' : 'environmental:magma');
    const hazardSurfaces = hazardMarkers.map((marker, index) => {
      const half = compiled.roomId.includes('electric') ? 2 : 10;
      return structuralRuntimeSurface({
        id: `surface.semantic-room-pack.${spec.key}.hazard.${String(index).padStart(2, '0')}`,
        spec,
        bounds: {
          min: vector(marker.worldPosition.x - half, marker.worldPosition.y - 0.12, marker.worldPosition.z - half),
          max: vector(marker.worldPosition.x + half, marker.worldPosition.y, marker.worldPosition.z + half),
        },
        purpose: `authored ${compiled.hazardContracts[0].profile} environmental floor`,
        supportBoundaryIds,
        visualProfile: `semantic-room-pack-v1:hazard:${compiled.hazardContracts[0].profile}`,
        hazardTag,
        environmentStateId: 'environment.undercroft-hazard',
        sourceNodeName: marker.sourceNodeName,
      });
    });
    const rewardMarker = compiled.semanticMarkers.find(({ sourceNodeName }) => sourceNodeName.startsWith('ANCHOR_REWARD_'));
    if (!rewardMarker) throw new Error(`${compiled.placementId} has no authored Undercroft reward anchor.`);
    const rewardSurface = structuralRuntimeSurface({
      id: `surface.semantic-room-pack.${spec.key}.major-cache-pad`,
      spec,
      bounds: {
        min: vector(rewardMarker.worldPosition.x - 1.4, rewardMarker.worldPosition.y - 0.2, rewardMarker.worldPosition.z - 1.4),
        max: vector(rewardMarker.worldPosition.x + 1.4, rewardMarker.worldPosition.y, rewardMarker.worldPosition.z + 1.4),
      },
      purpose: 'safe authored Undercroft major-cache support pad',
      supportBoundaryIds,
      visualProfile: 'semantic-room-pack-v1:undercroft:major-cache-pad',
      sourceNodeName: rewardMarker.sourceNodeName,
    });
    surfaces.push(...hazardSurfaces, rewardSurface);
    auxiliarySurfaceIds.push(...hazardSurfaces.map(({ id }) => id), rewardSurface.id);
    bindings.hazard = {
      environmentStateId: 'environment.undercroft-hazard',
      mechanismId: 'mechanism.undercroft-hazard',
      profile: compiled.hazardContracts[0].profile,
      surfaceIds: hazardSurfaces.map(({ id }) => id),
      rewardSurfaceId: rewardSurface.id,
      rewardSourceNodeName: rewardMarker.sourceNodeName,
    };
  }
  return { bindings, auxiliarySurfaceIds };
}

function round(value) {
  const result = Math.round(Number(value) * 1e9) / 1e9;
  return Object.is(result, -0) ? 0 : result;
}

function vector(x, y, z) {
  return { x: round(x), y: round(y), z: round(z) };
}

function unionBounds(left, right) {
  return {
    min: vector(
      Math.min(left.min.x, right.min.x),
      Math.min(left.min.y, right.min.y),
      Math.min(left.min.z, right.min.z),
    ),
    max: vector(
      Math.max(left.max.x, right.max.x),
      Math.max(left.max.y, right.max.y),
      Math.max(left.max.z, right.max.z),
    ),
  };
}

function assertMutableGoldenPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('Semantic room-pack golden integration requires a mutable raw dungeon plan object.');
  }
  for (const collection of [
    'regions',
    'modulePlacements',
    'spatialCells',
    'structuralBoundaries',
    'walkableSurfaces',
    'structuralFixtures',
    'portals',
    'traversalLinks',
  ]) {
    if (!Array.isArray(plan[collection])) {
      throw new TypeError(`Semantic room-pack golden integration requires plan.${collection}.`);
    }
    if (Object.isFrozen(plan[collection])) {
      throw new TypeError(`Semantic room-pack golden integration requires mutable plan.${collection}.`);
    }
  }
  if (plan.semanticRoomPackPlacements?.length) {
    throw new Error('Semantic room-pack placements are already integrated into this plan.');
  }
}

function normalizeUndercroftType(plan, requested) {
  const value = requested ?? plan.undercroftType;
  if (!Object.hasOwn(UNDERCROFT_ROOM_IDS, value)) {
    throw new RangeError(`Golden semantic room-pack undercroft must be magma or electrical; received ${value ?? '<missing>'}.`);
  }
  if (plan.undercroftType != null && plan.undercroftType !== value) {
    throw new RangeError(`Semantic room-pack undercroft ${value} does not match plan undercroft ${plan.undercroftType}.`);
  }
  return value;
}

function rotatedSide(localSide, yawQuarterTurns) {
  if (localSide === 'floor' || localSide === 'ceiling') return localSide;
  const order = ['north', 'west', 'south', 'east'];
  const index = order.indexOf(localSide);
  if (index < 0) throw new Error(`Unsupported authored shell side ${localSide}.`);
  return order[(index + yawQuarterTurns) % order.length];
}

function sourceShellSide(sourceNodeName, yawQuarterTurns) {
  if (/^SHELL_FLOOR(?:_|$)/u.test(sourceNodeName)) return 'floor';
  if (/^SHELL_CEILING(?:_|$)/u.test(sourceNodeName)) return 'ceiling';
  const match = sourceNodeName.match(/_(NORTH|SOUTH|EAST|WEST)(?:_|$)/u);
  if (!match) throw new Error(`Authored shell collider ${sourceNodeName} has no explicit boundary side.`);
  return rotatedSide(match[1].toLowerCase(), yawQuarterTurns);
}

function sideFromForward(forward) {
  for (const [side, candidate] of Object.entries(SIDE_FORWARD)) {
    if (Math.abs(forward.x - candidate.x) <= EPSILON
      && Math.abs(forward.y - candidate.y) <= EPSILON
      && Math.abs(forward.z - candidate.z) <= EPSILON) return side;
  }
  throw new Error(`Socket forward ${JSON.stringify(forward)} is not cardinal.`);
}

/**
 * The current collision runtime consumes AABBs. This broad-phase bound is
 * derived solely from the adapter's transformed manifest collision volume.
 * No visible mesh or aggregate authored room bound participates.
 */
function boundsForTransformedCollider(collider) {
  const center = collider.worldCenter;
  if (collider.shape === 'cylinder') {
    return {
      min: vector(center.x - collider.worldRadius, center.y - collider.worldHeight * 0.5, center.z - collider.worldRadius),
      max: vector(center.x + collider.worldRadius, center.y + collider.worldHeight * 0.5, center.z + collider.worldRadius),
    };
  }
  if (collider.shape !== 'box') throw new TypeError(`Unsupported authored collision shape ${collider.shape}.`);
  const halfX = collider.worldSize.x * 0.5;
  const halfY = collider.worldSize.y * 0.5;
  const halfZ = collider.worldSize.z * 0.5;
  const cosine = Math.abs(Math.cos(collider.worldYawRadians));
  const sine = Math.abs(Math.sin(collider.worldYawRadians));
  const extentX = halfX * cosine + halfZ * sine;
  const extentZ = halfX * sine + halfZ * cosine;
  return {
    min: vector(center.x - extentX, center.y - halfY, center.z - extentZ),
    max: vector(center.x + extentX, center.y + halfY, center.z + extentZ),
  };
}

function descriptorReference(placement, record) {
  return {
    packId: placement.packId,
    packRevision: placement.packRevision,
    roomId: placement.roomId,
    placementId: placement.placementId,
    sourceNodeName: record.sourceNodeName,
    colliderId: record.colliderId,
    collisionSourcePolicy: placement.collisionSourcePolicy,
  };
}

function runtimeVisualFields(placement, record) {
  return {
    visualId: `visual.${record.id}`,
    visualIds: [`visual.${record.id}`],
    presentationOwnerId: placement.placementId,
    descriptorReference: descriptorReference(placement, record),
  };
}

function enrichBoundary(placement, record, spec) {
  const bounds = boundsForTransformedCollider(record);
  const side = sourceShellSide(record.sourceNodeName, placement.placementTransform.yawQuarterTurns);
  return {
    ...clonePlanData(record),
    regionId: spec.regionId,
    cellId: spec.packCellId,
    bounds,
    side,
    kind: 'solid',
    openings: [],
    materialProfileId: `semantic-room-pack-v1.${placement.archetype}.shell`,
    visualProfile: `semantic-room-pack-v1:${placement.roomId}:${side}`,
    collider: true,
    collision: 'static',
    opaque: true,
    colliderIds: [record.colliderId],
    colliderBounds: [bounds],
    gameplayPurpose: `authored enclosed ${side} shell for ${placement.gameplayPurpose}`,
    ...runtimeVisualFields(placement, record),
  };
}

function fixturePurpose(record, placement) {
  const label = {
    support: 'visible structural support',
    rail: 'fall-prevention railing',
    console: 'reachable authored control console',
    mechanismSupport: 'mechanism support structure',
    tank: 'water storage machinery',
    pump: 'water routing machinery',
    furnace: 'foundry machinery',
    transformer: 'electrical machinery',
  }[record.semantic] ?? `authored ${record.semantic} fixture`;
  return `${label} in ${placement.gameplayPurpose}`;
}

function enrichFixture(placement, record, spec, supportBoundaryIds) {
  const bounds = boundsForTransformedCollider(record);
  return {
    ...clonePlanData(record),
    type: `semantic-room-pack-${record.semantic}`,
    regionId: spec.regionId,
    cellId: spec.packCellId,
    bounds,
    gameplayPurpose: fixturePurpose(record, placement),
    collision: 'blocking',
    accessibility: 'reachable',
    supportBoundaryIds: [...supportBoundaryIds],
    colliderIds: [record.colliderId],
    colliderBounds: [bounds],
    blocksAerialTraversal: true,
    ...runtimeVisualFields(placement, record),
  };
}

function surfacePurpose(descriptor, record, placement) {
  const declared = descriptor.platformPurposes?.[record.sourceNodeName];
  if (declared) return `${declared} authored platform in ${placement.gameplayPurpose}`;
  if (record.semantic === 'recoveryCatchment') return 'authored damage-free playable recovery catchment';
  if (record.semantic === 'movingSurface') return 'authored mechanism-driven traversal platform';
  return `authored walkable traversal surface in ${placement.gameplayPurpose}`;
}

function supportingFixtureIds(record, fixtures) {
  const direct = fixtures
    .filter((fixture) => fixture.sourceNodeName.startsWith(`SUPPORT_${record.sourceNodeName}_`))
    .map(({ id }) => id);
  if (direct.length) return direct;
  if (record.semantic === 'movingSurface') {
    return fixtures.filter(({ semantic }) => semantic === 'mechanismSupport').map(({ id }) => id);
  }
  return [];
}

function enrichSurface(placement, record, spec, descriptor, supportBoundaryIds, fixtures) {
  const bounds = boundsForTransformedCollider(record);
  const dynamic = record.semantic === 'movingSurface';
  if (dynamic && !spec.mechanismId) {
    throw new Error(`${placement.placementId} moving surface ${record.sourceNodeName} has no golden mechanism binding.`);
  }
  return {
    ...clonePlanData(record),
    regionId: spec.regionId,
    cellId: spec.packCellId,
    bounds,
    purpose: surfacePurpose(descriptor, record, placement),
    supportBoundaryIds: [...supportBoundaryIds],
    supportFixtureIds: supportingFixtureIds(record, fixtures),
    supportProfile: 'semantic-room-pack-v1-authored-support',
    visualProfile: `semantic-room-pack-v1:${placement.roomId}:walkable`,
    collision: dynamic ? 'dynamic' : 'static',
    mechanismId: dynamic ? spec.mechanismId : null,
    hazardTag: null,
    colliderIds: [record.colliderId],
    colliderBounds: [bounds],
    createsLedgeCandidates: false,
    ledgePolicy: 'authored-semantic-surface-seams-disabled',
    ...runtimeVisualFields(placement, record),
  };
}

function boundaryBounds(bounds, side, thickness = WALL_THICKNESS) {
  if (side === 'north') return { min: vector(bounds.min.x, bounds.min.y, bounds.min.z - thickness), max: vector(bounds.max.x, bounds.max.y, bounds.min.z) };
  if (side === 'south') return { min: vector(bounds.min.x, bounds.min.y, bounds.max.z), max: vector(bounds.max.x, bounds.max.y, bounds.max.z + thickness) };
  if (side === 'west') return { min: vector(bounds.min.x - thickness, bounds.min.y, bounds.min.z), max: vector(bounds.min.x, bounds.max.y, bounds.max.z) };
  if (side === 'east') return { min: vector(bounds.max.x, bounds.min.y, bounds.min.z), max: vector(bounds.max.x + thickness, bounds.max.y, bounds.max.z) };
  if (side === 'floor') return { min: vector(bounds.min.x, bounds.min.y - thickness, bounds.min.z), max: vector(bounds.max.x, bounds.min.y, bounds.max.z) };
  if (side === 'ceiling') return { min: vector(bounds.min.x, bounds.max.y, bounds.min.z), max: vector(bounds.max.x, bounds.max.y + thickness, bounds.max.z) };
  throw new Error(`Cannot build boundary for unsupported side ${side}.`);
}

function socketStripBounds(socket, side, minY, maxY, referenceBoundary) {
  if (maxY - minY <= EPSILON) return null;
  const halfWidth = socket.aperture.width * 0.5;
  if (side === 'north' || side === 'south') {
    return {
      min: vector(socket.worldPosition.x - halfWidth, minY, referenceBoundary.bounds.min.z),
      max: vector(socket.worldPosition.x + halfWidth, maxY, referenceBoundary.bounds.max.z),
    };
  }
  return {
    min: vector(referenceBoundary.bounds.min.x, minY, socket.worldPosition.z - halfWidth),
    max: vector(referenceBoundary.bounds.max.x, maxY, socket.worldPosition.z + halfWidth),
  };
}

function structuralKitBoundary({ id, placement, spec, side, bounds, purpose, kind = 'solid', openings = [] }) {
  return {
    id,
    regionId: spec.regionId,
    cellId: spec.packCellId,
    side,
    kind,
    bounds,
    openings,
    materialProfileId: `semantic-room-pack-v1.${placement.archetype}.socket-frame`,
    visualProfile: `semantic-room-pack-v1:${placement.roomId}:socket-frame`,
    collider: true,
    collision: 'static',
    opaque: true,
    gameplayPurpose: purpose,
    structuralKitProfileId: 'semantic-room-pack-v1-opaque-socket-frame',
    presentationOwnerId: placement.placementId,
    visualId: `visual.${id}`,
    visualIds: [`visual.${id}`],
  };
}

function socketFrameContracts(placement, spec, manifestBoundaries, portalIdsBySocket) {
  const kitBoundaries = [];
  const bindings = [];
  let entryBoundary = null;
  for (const socket of placement.sockets) {
    const side = sideFromForward(socket.worldForward);
    const header = manifestBoundaries.find((boundary) => (
      boundary.side === side && boundary.sourceNodeName.includes('SHELL_DOOR_HEADER_')
    ));
    if (!header) throw new Error(`${placement.placementId} socket ${socket.id} has no authored header collision.`);
    const headerBottomY = header.bounds.min.y;
    const socketBottomY = socket.worldPosition.y;
    const socketTopY = socketBottomY + socket.aperture.height;
    const portalId = portalIdsBySocket[socket.id] ?? null;
    if (portalId) {
      const opening = {
          id: `opening.${spec.key}.${socket.id}`,
        portalId,
        center: vector(
          socket.worldPosition.x,
          socketBottomY + socket.aperture.height * 0.5,
          socket.worldPosition.z,
        ),
        dimensions: {
          width: socket.aperture.width,
          height: socket.aperture.height,
          depth: 1.2,
        },
      };
      header.kind = 'portal-frame';
      header.openings.push(opening);
      entryBoundary = header;
      const lowerBounds = socketStripBounds(socket, side, placement.worldBounds.min.y, socketBottomY, header);
      const upperBounds = socketStripBounds(socket, side, socketTopY, headerBottomY, header);
      for (const [suffix, bounds] of [['lower', lowerBounds], ['upper', upperBounds]]) {
        if (!bounds) continue;
        kitBoundaries.push(structuralKitBoundary({
          id: `${socket.worldId}:bound-${suffix}-infill`,
          placement,
          spec,
          side,
          bounds,
          purpose: `opaque structural infill around bound authored socket ${socket.id}`,
        }));
      }
      bindings.push({
        socketId: socket.id,
        sourceNodeName: socket.sourceNodeName,
        status: 'bound',
        portalId,
        capId: null,
      });
      continue;
    }
    if (!(spec.optionalCapSocketIds ?? []).includes(socket.id)) {
      throw new Error(`${placement.placementId} functional socket ${socket.id} has no physical route binding.`);
    }
    const capId = `${socket.worldId}:structural-cap`;
    const capBounds = socketStripBounds(socket, side, placement.worldBounds.min.y, headerBottomY, header);
    if (!capBounds) throw new Error(`${placement.placementId} socket ${socket.id} has no finite cap aperture.`);
    kitBoundaries.push(structuralKitBoundary({
      id: capId,
      placement,
      spec,
      side,
      bounds: capBounds,
      purpose: `opaque colliding structural cap for unused authored socket ${socket.id}`,
    }));
    bindings.push({
      socketId: socket.id,
      sourceNodeName: socket.sourceNodeName,
      status: 'capped',
      portalId: null,
      capId,
    });
  }
  if (!entryBoundary) throw new Error(`${placement.placementId} has no bound socket boundary.`);
  return { kitBoundaries, bindings };
}

function branchEntryTransform(hostCell, spec, portalId, aperture) {
  const outward = SIDE_FORWARD[spec.hostSide];
  if (!outward) throw new Error(`${spec.key} host side must be cardinal.`);
  const floorY = hostCell.bounds.min.y;
  let hostAnchor;
  if (spec.hostSide === 'north' || spec.hostSide === 'south') {
    hostAnchor = vector(
      spec.transverseOffset,
      floorY,
      spec.hostSide === 'north' ? hostCell.bounds.min.z : hostCell.bounds.max.z,
    );
  } else {
    hostAnchor = vector(
      spec.hostSide === 'west' ? hostCell.bounds.min.x : hostCell.bounds.max.x,
      floorY,
      spec.transverseOffset,
    );
  }
  const entryAnchor = vector(
    hostAnchor.x + outward.x * spec.connectorGap,
    floorY,
    hostAnchor.z + outward.z * spec.connectorGap,
  );
  return {
    hostAnchor,
    entryAnchor,
    targetPortal: {
      id: portalId,
      position: entryAnchor,
      forward: vector(-outward.x, 0, -outward.z),
      connectorType: spec.connectorForm,
      aperture: [...aperture],
    },
  };
}

function projectedOpeningFits(boundary, side, opening) {
  const halfWidth = opening.dimensions.width * 0.5;
  const halfHeight = opening.dimensions.height * 0.5;
  if (opening.center.y - halfHeight < boundary.bounds.min.y - EPSILON
    || opening.center.y + halfHeight > boundary.bounds.max.y + EPSILON) return false;
  if (side === 'north' || side === 'south') {
    return opening.center.x - halfWidth >= boundary.bounds.min.x - EPSILON
      && opening.center.x + halfWidth <= boundary.bounds.max.x + EPSILON;
  }
  return opening.center.z - halfWidth >= boundary.bounds.min.z - EPSILON
    && opening.center.z + halfWidth <= boundary.bounds.max.z + EPSILON;
}

function openingsOverlap(left, right, side) {
  const leftHalfWidth = left.dimensions.width * 0.5;
  const rightHalfWidth = right.dimensions.width * 0.5;
  const leftHalfHeight = left.dimensions.height * 0.5;
  const rightHalfHeight = right.dimensions.height * 0.5;
  const tangent = side === 'north' || side === 'south' ? 'x' : 'z';
  return Math.abs(left.center[tangent] - right.center[tangent])
      < leftHalfWidth + rightHalfWidth - EPSILON
    && Math.abs(left.center.y - right.center.y)
      < leftHalfHeight + rightHalfHeight - EPSILON;
}

function carveHostOpening(plan, spec, hostCell, hostAnchor, portalId, aperture) {
  const opening = {
    id: `opening.${spec.key}.host`,
    portalId,
    center: vector(hostAnchor.x, hostAnchor.y + aperture.height * 0.5, hostAnchor.z),
    dimensions: { width: aperture.width, height: aperture.height, depth: 1.2 },
  };
  const candidates = plan.structuralBoundaries.filter((boundary) => (
    boundary.cellId === hostCell.id
    && boundary.side === spec.hostSide
    && projectedOpeningFits(boundary, spec.hostSide, opening)
  ));
  if (candidates.length !== 1) {
    throw new Error(`${spec.key} requires exactly one host boundary that can physically accept its aperture; found ${candidates.length}.`);
  }
  const boundary = candidates[0];
  if (boundary.presentationOwnerId) {
    throw new Error(`${spec.key} cannot carve runtime geometry into presentation-owned host boundary ${boundary.id}.`);
  }
  if ((boundary.openings ?? []).some((existing) => openingsOverlap(existing, opening, spec.hostSide))) {
    throw new Error(`${spec.key} host aperture overlaps an existing portal opening on ${boundary.id}.`);
  }
  boundary.openings ??= [];
  boundary.openings.push(opening);
  boundary.kind = 'portal-frame';
  return { boundary, opening };
}

function connectorCellBounds(spec, hostAnchor, entryAnchor, aperture) {
  const halfCross = (aperture.width + CONNECTOR_MARGIN_XZ) * 0.5;
  const maxY = hostAnchor.y + aperture.height + CONNECTOR_MARGIN_Y;
  if (spec.hostSide === 'north' || spec.hostSide === 'south') {
    return {
      min: vector(hostAnchor.x - halfCross, hostAnchor.y, Math.min(hostAnchor.z, entryAnchor.z)),
      max: vector(hostAnchor.x + halfCross, maxY, Math.max(hostAnchor.z, entryAnchor.z)),
    };
  }
  return {
    min: vector(Math.min(hostAnchor.x, entryAnchor.x), hostAnchor.y, hostAnchor.z - halfCross),
    max: vector(Math.max(hostAnchor.x, entryAnchor.x), maxY, hostAnchor.z + halfCross),
  };
}

function connectorOpeningCenter(bounds, side, floorY, aperture) {
  return vector(
    side === 'west' ? bounds.min.x : side === 'east' ? bounds.max.x : (bounds.min.x + bounds.max.x) * 0.5,
    floorY + aperture.height * 0.5,
    side === 'north' ? bounds.min.z : side === 'south' ? bounds.max.z : (bounds.min.z + bounds.max.z) * 0.5,
  );
}

function createConnectorContract(spec, hostAnchor, entryAnchor, portalId, aperture) {
  const cellId = `cell.connector.semantic-room-pack.${spec.key}.0`;
  const bounds = connectorCellBounds(spec, hostAnchor, entryAnchor, aperture);
  const nearSide = OPPOSITE_SIDE[spec.hostSide];
  const farSide = spec.hostSide;
  const boundaries = BOUNDARY_SIDES.map((side) => {
    const endFrame = side === nearSide || side === farSide;
    const id = `boundary.connector.semantic-room-pack.${spec.key}.${side}`;
    return {
      id,
      regionId: spec.regionId,
      cellId,
      side,
      kind: endFrame ? 'portal-frame' : 'solid',
      bounds: boundaryBounds(bounds, side),
      openings: endFrame ? [{
        id: `opening.connector.semantic-room-pack.${spec.key}.${side}`,
        portalId,
        center: connectorOpeningCenter(bounds, side, hostAnchor.y, aperture),
        dimensions: { width: aperture.width, height: aperture.height, depth: 1.2 },
      }] : [],
      materialProfileId: `semantic-room-pack-v1.${spec.key}.connector`,
      visualProfile: `semantic-room-pack-v1:${spec.key}:connector-${side}`,
      collider: true,
      collision: 'static',
      opaque: true,
      gameplayPurpose: `fully enclosed supported macro-branch connector ${side}`,
      presentationOwnerId: `connector.semantic-room-pack.${spec.key}`,
    };
  });
  const floorBoundary = boundaries.find(({ side }) => side === 'floor');
  const surface = {
    id: `surface.connector.semantic-room-pack.${spec.key}.0`,
    regionId: spec.regionId,
    cellId,
    bounds: {
      min: vector(bounds.min.x, hostAnchor.y, bounds.min.z),
      max: vector(bounds.max.x, hostAnchor.y + 0.3, bounds.max.z),
    },
    purpose: `continuous walkable floor through ${spec.key} optional macro branch`,
    supportBoundaryIds: [floorBoundary.id],
    supportFixtureIds: [],
    supportProfile: 'enclosed-structural-tunnel-foundation-v2',
    visualProfile: `semantic-room-pack-v1:${spec.key}:connector-floor`,
    collision: 'static',
    hazardTag: null,
    createsLedgeCandidates: false,
    ledgePolicy: 'continuous-connector-floor',
  };
  const cell = {
    id: cellId,
    regionId: spec.regionId,
    bounds,
    playable: true,
    interior: true,
    cameraContained: true,
    occupiedVolume: true,
    connector: true,
    portalId,
  };
  return { cell, boundaries, surface, nearSide, farSide };
}

function connectorTravelSide(from, to) {
  const dx = round(to.x - from.x);
  const dz = round(to.z - from.z);
  if (Math.abs(dx) > EPSILON && Math.abs(dz) > EPSILON) {
    throw new Error(`Connector segment ${JSON.stringify(from)} -> ${JSON.stringify(to)} is not axis aligned.`);
  }
  if (Math.abs(dx) <= EPSILON && Math.abs(dz) <= EPSILON) {
    throw new Error(`Connector segment ${JSON.stringify(from)} -> ${JSON.stringify(to)} has no horizontal run.`);
  }
  if (Math.abs(dx) > EPSILON) return dx > 0 ? 'east' : 'west';
  return dz > 0 ? 'south' : 'north';
}

function createConnectorRouteContract(spec, route, portalId, aperture) {
  const points = route.routePoints.map((point) => vector(point.x, point.y, point.z));
  const compoundId = `compound.connector.semantic-room-pack.${spec.key}.${route.key}`;
  const segments = points.slice(0, -1).map((from, index) => {
    const to = points[index + 1];
    const travelSide = connectorTravelSide(from, to);
    const startSide = OPPOSITE_SIDE[travelSide];
    const endSide = travelSide;
    const halfCross = (aperture.width + CONNECTOR_MARGIN_XZ) * 0.5;
    const bounds = travelSide === 'east' || travelSide === 'west'
      ? {
          min: vector(Math.min(from.x, to.x), Math.min(from.y, to.y), from.z - halfCross),
          max: vector(Math.max(from.x, to.x), Math.max(from.y, to.y) + aperture.height + CONNECTOR_MARGIN_Y, from.z + halfCross),
        }
      : {
          min: vector(from.x - halfCross, Math.min(from.y, to.y), Math.min(from.z, to.z)),
          max: vector(from.x + halfCross, Math.max(from.y, to.y) + aperture.height + CONNECTOR_MARGIN_Y, Math.max(from.z, to.z)),
        };
    const cellId = `cell.connector.semantic-room-pack.${spec.key}.${route.key}.${index}`;
    const surfaceId = `surface.connector.semantic-room-pack.${spec.key}.${route.key}.${index}`;
    const boundaries = BOUNDARY_SIDES.map((side) => {
      const isStart = side === startSide;
      const isEnd = side === endSide;
      const endpoint = isStart ? from : to;
      const endFrame = isStart || isEnd;
      return {
        id: `boundary.connector.semantic-room-pack.${spec.key}.${route.key}.${index}.${side}`,
        regionId: spec.regionId,
        cellId,
        side,
        kind: endFrame ? 'portal-frame' : 'solid',
        bounds: boundaryBounds(bounds, side),
        openings: endFrame ? [{
          id: `opening.connector.semantic-room-pack.${spec.key}.${route.key}.${index}.${side}`,
          portalId,
          center: connectorOpeningCenter(bounds, side, endpoint.y, aperture),
          dimensions: { width: aperture.width, height: aperture.height, depth: 1.2 },
        }] : [],
        connector: true,
        materialProfileId: `semantic-room-pack-v1.${route.connectorForm}.connector`,
        visualProfile: `semantic-room-pack-v1:${route.connectorForm}:${side}`,
        collider: true,
        collision: 'static',
        opaque: true,
        gameplayPurpose: `enclosed supported ${route.connectorForm} route segment`,
        presentationOwnerId: `connector.semantic-room-pack.${spec.key}.${route.key}`,
      };
    });
    const floorBoundary = boundaries.find(({ side }) => side === 'floor');
    const stair = Math.abs(from.y - to.y) > EPSILON;
    const surface = {
      id: surfaceId,
      regionId: spec.regionId,
      cellId,
      bounds: {
        min: vector(bounds.min.x, Math.min(from.y, to.y), bounds.min.z),
        max: vector(bounds.max.x, Math.max(from.y, to.y) + 0.3, bounds.max.z),
      },
      purpose: `${stair ? 'smooth walkable stair' : 'continuous walkable floor'} through ${route.connectorForm}`,
      supportBoundaryIds: [floorBoundary.id],
      supportFixtureIds: [],
      supportProfile: stair ? 'continuous-stair-stringers-v2' : 'enclosed-structural-tunnel-foundation-v2',
      visualProfile: `semantic-room-pack-v1:${route.connectorForm}:${stair ? 'walkable-stairs' : 'floor'}`,
      collision: 'static',
      hazardTag: null,
      createsLedgeCandidates: false,
      ledgePolicy: 'continuous-connector-floor',
      ...(stair ? {
        geometry: {
          type: 'stairs',
          path: [clonePlanData(from), clonePlanData(to)],
          maxRiser: 0.18,
          minimumTread: 0.45,
          width: aperture.width,
          ledgeClimbDisabled: true,
        },
      } : {}),
    };
    const cell = {
      id: cellId,
      regionId: spec.regionId,
      bounds,
      playable: true,
      interior: true,
      cameraContained: true,
      occupiedVolume: true,
      connector: true,
      portalId,
      connectorForPortalId: portalId,
      compoundId,
    };
    return { cell, boundaries, surface, from, to, startSide, endSide };
  });
  return {
    segments,
    cells: segments.map(({ cell }) => cell),
    boundaries: segments.flatMap(({ boundaries }) => boundaries),
    surfaces: segments.map(({ surface }) => surface),
    routePoints: points,
  };
}

function planarDistanceToBounds(point, bounds) {
  const dx = Math.max(bounds.min.x - point.x, 0, point.x - bounds.max.x);
  const dz = Math.max(bounds.min.z - point.z, 0, point.z - bounds.max.z);
  return Math.hypot(dx, dz);
}

function nearestSurface(surfaces, point, preferredCellId = null) {
  const candidates = preferredCellId
    ? surfaces.filter(({ cellId }) => cellId === preferredCellId)
    : surfaces;
  return [...candidates].sort((left, right) => (
    planarDistanceToBounds(point, left.bounds) - planarDistanceToBounds(point, right.bounds)
    || Math.abs(left.bounds.max.y - point.y) - Math.abs(right.bounds.max.y - point.y)
    || left.id.localeCompare(right.id)
  ))[0] ?? null;
}

function resolvePackSurface(placement, surfaces, reference) {
  const hintedNodeName = REGION_SURFACE_HINTS[placement.roomId]?.[reference] ?? reference;
  const exact = surfaces.find(({ sourceNodeName }) => sourceNodeName === hintedNodeName);
  if (exact) return exact;
  const region = placement.regions.find(({ localId }) => localId === reference);
  if (region?.worldAnchor) return nearestSurface(surfaces, region.worldAnchor);
  const semantic = placement.semanticMarkers.find(({ extras }) => (
    extras?.anchorId === reference || extras?.discoveryId === reference
  ));
  if (semantic?.worldPosition) return nearestSurface(surfaces, semantic.worldPosition);
  return null;
}

function createInternalTraversalLinks(placement, surfaces, spec) {
  const links = [];
  const pairs = new Set();
  for (const authored of placement.traversalLinks) {
    const references = [authored.localFrom, ...(authored.localVia ?? []), authored.localTo];
    const resolved = references.map((reference) => resolvePackSurface(placement, surfaces, reference));
    if (resolved.some((surface) => !surface)) {
      throw new Error(`${placement.placementId} cannot resolve authored traversal ${authored.id} to manifest surfaces.`);
    }
    for (let index = 0; index < resolved.length - 1; index += 1) {
      const from = resolved[index];
      const to = resolved[index + 1];
      if (from.id === to.id) continue;
      const key = `${authored.id}:${from.id}:${to.id}`;
      if (pairs.has(key)) continue;
      pairs.add(key);
      links.push({
        id: `traversal.semantic-room-pack.${spec.key}.${links.length}`,
        regionId: spec.regionId,
        fromSurfaceId: from.id,
        toSurfaceId: to.id,
        mode: 'authored-traversal',
        bidirectional: !['authoredDrop', 'fallCatchment'].includes(authored.kind),
        minimumWidth: 1.2,
        condition: clonePlanData(authored.condition),
        sourceTraversalId: authored.id,
        sourceTraversalKind: authored.kind,
        sourcePredicate: authored.sourcePredicate,
        damageFree: authored.damageFree === true,
        optional: authored.optional === true,
        semanticRoomPackPlacementId: placement.placementId,
      });
    }
  }
  return links;
}

function createPortalAndLinks(plan, placement, spec, hostCell, hostBoundary, entryBoundary, connector, hostAnchor, entrySocket) {
  const aperture = entrySocket.aperture;
  const portalId = `portal.semantic-room-pack.${spec.key}-branch`;
  const hostSurface = nearestSurface(plan.walkableSurfaces, hostAnchor, hostCell.id);
  const entrySurface = placement.walkableSurfaces
    .filter(({ sourceNodeName }) => /^WALK_ENTRY_/u.test(sourceNodeName))
    .sort((left, right) => planarDistanceToBounds(entrySocket.worldPosition, left.bounds)
      - planarDistanceToBounds(entrySocket.worldPosition, right.bounds))[0];
  if (!hostSurface || !entrySurface) {
    throw new Error(`${spec.key} cannot resolve host and authored entry walkable surfaces.`);
  }
  const centerY = hostAnchor.y + aperture.height * 0.5;
  const portal = {
    id: portalId,
    order: plan.portals.length,
    from: {
      regionId: spec.regionId,
      cellId: hostCell.id,
      boundaryId: hostBoundary.id,
      side: spec.hostSide,
      center: vector(hostAnchor.x, centerY, hostAnchor.z),
      elevation: hostAnchor.y,
      placementBucket: 'optional-macro-branch',
      dimensions: { width: aperture.width, height: aperture.height, depth: 1.2 },
    },
    to: {
      regionId: spec.regionId,
      cellId: spec.packCellId,
      boundaryId: entryBoundary.id,
      side: sideFromForward(entrySocket.worldForward),
      center: vector(entrySocket.worldPosition.x, entrySocket.worldPosition.y + aperture.height * 0.5, entrySocket.worldPosition.z),
      elevation: entrySocket.worldPosition.y,
      placementBucket: 'authored-entry-socket',
      dimensions: { width: aperture.width, height: aperture.height, depth: 1.2 },
    },
    connectorForm: spec.connectorForm,
    placementBucket: 'optional-macro-branch',
    elevationBand: hostAnchor.y,
    elevationBands: [hostAnchor.y, entrySocket.worldPosition.y],
    approachType: 'walk',
    direction: 'bidirectional',
    barrierId: null,
    initiallyOpen: true,
    mechanismId: null,
    conditions: [],
    traversalEffects: [],
    traversal: {
      mode: 'walk',
      minimumWidth: aperture.width,
      minimumHeadroom: Math.min(3.2, aperture.height),
      cameraClearance: 1.8,
      interiorIngressDepth: 1.2,
    },
    connectorProfile: {
      enclosed: true,
      framed: true,
      supported: true,
      wallProfile: `${spec.connectorForm}-walls-v2`,
      ceilingProfile: `${spec.connectorForm}-ceiling-v2`,
      supportProfile: `${spec.connectorForm}-supports-v2`,
    },
    authoredRoute: { mode: 'straight-authored-macro-branch', detour: null },
    visibleDestinationRegionId: spec.regionId,
    physicalRoute: {
      authored: true,
      enclosed: true,
      continuous: true,
      supported: true,
      cellIds: [connector.cell.id],
      boundaryIds: connector.boundaries.map(({ id }) => id),
      surfaceIds: [connector.surface.id],
      endpointSurfaceIds: { from: hostSurface.id, to: entrySurface.id },
      routePoints: [
        vector(hostAnchor.x, hostSurface.bounds.max.y, hostAnchor.z),
        vector(entrySocket.worldPosition.x, connector.surface.bounds.max.y, entrySocket.worldPosition.z),
        vector(entrySocket.worldPosition.x, entrySurface.bounds.max.y, entrySocket.worldPosition.z),
      ],
    },
  };
  const links = [
    {
      id: `traversal.semantic-room-pack.${spec.key}.host-connector`,
      regionId: spec.regionId,
      fromSurfaceId: hostSurface.id,
      toSurfaceId: connector.surface.id,
      mode: 'walk',
      bidirectional: true,
      minimumWidth: aperture.width,
      portalId,
    },
    {
      id: `traversal.semantic-room-pack.${spec.key}.connector-entry`,
      regionId: spec.regionId,
      fromSurfaceId: connector.surface.id,
      toSurfaceId: entrySurface.id,
      mode: 'walk',
      bidirectional: true,
      minimumWidth: aperture.width,
      portalId,
    },
  ];
  return { portal, links, hostSurface, entrySurface };
}

function createRoutedPortalAndLinks(plan, placement, spec, routeSpec, manifestBoundaries, packSurfaces) {
  const socket = placement.sockets.find(({ id }) => id === routeSpec.socketId);
  if (!socket) throw new Error(`${placement.placementId} route ${routeSpec.key} references missing socket ${routeSpec.socketId}.`);
  const lastPoint = routeSpec.routePoints.at(-1);
  if (Math.hypot(
    lastPoint.x - socket.worldPosition.x,
    lastPoint.y - socket.worldPosition.y,
    lastPoint.z - socket.worldPosition.z,
  ) > EPSILON) throw new Error(`${placement.placementId} route ${routeSpec.key} does not terminate at ${socket.id}.`);
  const hostCell = plan.spatialCells.find(({ id }) => id === routeSpec.hostCellId);
  if (!hostCell) throw new Error(`${placement.placementId} route ${routeSpec.key} has no host cell ${routeSpec.hostCellId}.`);
  const hostRegion = plan.regions.find(({ id }) => id === hostCell.regionId);
  if (!hostRegion) throw new Error(`${routeSpec.key} host cell ${hostCell.id} has no region.`);
  const hostAnchor = vector(routeSpec.hostAnchor.x, routeSpec.hostAnchor.y, routeSpec.hostAnchor.z);
  const portalId = `portal.semantic-room-pack.${spec.key}.${routeSpec.key}`;
  const routeIdentity = { ...spec, ...routeSpec, key: `${spec.key}.${routeSpec.key}` };
  const hostOpening = carveHostOpening(plan, routeIdentity, hostCell, hostAnchor, portalId, socket.aperture);
  const packSide = sideFromForward(socket.worldForward);
  const packBoundary = manifestBoundaries.find((boundary) => (
    boundary.side === packSide
      && boundary.kind === 'portal-frame'
      && boundary.openings.some((opening) => opening.portalId === portalId)
  ));
  if (!packBoundary) throw new Error(`${placement.placementId} route ${routeSpec.key} has no authored socket frame.`);
  const connector = createConnectorRouteContract(spec, routeSpec, portalId, socket.aperture);
  const hostSurface = plan.walkableSurfaces.find(({ id }) => id === routeSpec.hostSurfaceId);
  const entrySurface = packSurfaces
    .filter((surface) => planarDistanceToBounds(socket.worldPosition, surface.bounds) <= socket.aperture.width)
    .sort((left, right) => (
      Math.abs(left.bounds.max.y - socket.worldPosition.y) - Math.abs(right.bounds.max.y - socket.worldPosition.y)
      || planarDistanceToBounds(socket.worldPosition, left.bounds) - planarDistanceToBounds(socket.worldPosition, right.bounds)
    ))[0];
  if (!hostSurface || !entrySurface) throw new Error(`${routeSpec.key} cannot resolve its physical endpoint surfaces.`);
  for (let index = 0; index < connector.surfaces.length; index += 1) {
    const surface = connector.surfaces[index];
    if (surface.geometry?.type !== 'stairs') continue;
    surface.geometry.endpointSurfaceIds = {
      start: index > 0 ? connector.surfaces[index - 1].id : hostSurface.id,
      end: index + 1 < connector.surfaces.length ? connector.surfaces[index + 1].id : entrySurface.id,
    };
    surface.geometry.minimumEndpointOverlap = 1.2;
    surface.geometry.maximumEndpointHeightDelta = 0.05;
  }
  const portal = {
    id: portalId,
    order: plan.portals.length,
    from: {
      regionId: hostRegion.id,
      cellId: hostCell.id,
      boundaryId: hostOpening.boundary.id,
      side: routeSpec.hostSide,
      center: vector(hostAnchor.x, hostAnchor.y + socket.aperture.height * 0.5, hostAnchor.z),
      elevation: hostAnchor.y,
      placementBucket: 'authored-macro-route-host',
      dimensions: { width: socket.aperture.width, height: socket.aperture.height, depth: 1.2 },
    },
    to: {
      regionId: spec.regionId,
      cellId: spec.packCellId,
      boundaryId: packBoundary.id,
      side: packSide,
      center: vector(socket.worldPosition.x, socket.worldPosition.y + socket.aperture.height * 0.5, socket.worldPosition.z),
      elevation: socket.worldPosition.y,
      placementBucket: 'authored-room-socket',
      dimensions: { width: socket.aperture.width, height: socket.aperture.height, depth: 1.2 },
    },
    connectorForm: routeSpec.connectorForm,
    placementBucket: 'authored-macro-route',
    elevationBand: hostAnchor.y,
    elevationBands: [...new Set(connector.routePoints.map(({ y }) => y))],
    approachType: connector.surfaces.some(({ geometry }) => geometry?.type === 'stairs') ? 'walkable-stairs' : 'walk',
    direction: 'bidirectional',
    barrierId: routeSpec.barrierId ?? null,
    initiallyOpen: routeSpec.initiallyOpen !== false,
    mechanismId: null,
    conditions: clonePlanData(routeSpec.conditions ?? []),
    traversalEffects: [],
    traversal: {
      mode: connector.surfaces.some(({ geometry }) => geometry?.type === 'stairs') ? 'walkable-stairs' : 'walk',
      enabled: true,
      minimumWidth: socket.aperture.width,
      minimumHeadroom: Math.min(3.2, socket.aperture.height),
      cameraClearance: 1.8,
      interiorIngressDepth: 1.2,
    },
    connectorProfile: {
      enclosed: true,
      framed: true,
      supported: true,
      wallProfile: `${routeSpec.connectorForm}-walls-v2`,
      ceilingProfile: `${routeSpec.connectorForm}-ceiling-v2`,
      supportProfile: `${routeSpec.connectorForm}-supports-v2`,
    },
    authoredRoute: { mode: 'multi-cell-authored-macro-route', detour: routeSpec.key },
    visibleDestinationRegionId: spec.regionId,
    physicalRoute: {
      authored: true,
      enclosed: true,
      continuous: true,
      supported: true,
      cellIds: connector.cells.map(({ id }) => id),
      boundaryIds: connector.boundaries.map(({ id }) => id),
      surfaceIds: connector.surfaces.map(({ id }) => id),
      endpointSurfaceIds: { from: hostSurface.id, to: entrySurface.id },
      routePoints: clonePlanData(connector.routePoints),
    },
  };
  const sequence = [hostSurface, ...connector.surfaces, entrySurface];
  const links = sequence.slice(0, -1).map((from, index) => ({
    id: `traversal.semantic-room-pack.${spec.key}.${routeSpec.key}.${index}`,
    regionId: spec.regionId,
    fromSurfaceId: from.id,
    toSurfaceId: sequence[index + 1].id,
    mode: connector.surfaces.some(({ geometry }) => geometry?.type === 'stairs') ? 'walkable-stairs' : 'walk',
    bidirectional: true,
    minimumWidth: socket.aperture.width,
    maximumRiser: 0.18,
    minimumTread: 0.45,
    portalId,
    conditions: clonePlanData(routeSpec.conditions ?? []),
  }));
  return { routeSpec, socket, portal, connector, links, hostOpening, hostSurface, entrySurface };
}

function makePackCell(placement, spec) {
  return {
    id: spec.packCellId,
    regionId: spec.regionId,
    bounds: clonePlanData(placement.worldBounds),
    playable: true,
    interior: true,
    cameraContained: true,
    occupiedVolume: true,
    semanticRoomPackPlacementId: placement.placementId,
  };
}

function compileBranch(plan, rawSpec) {
  const spec = clonePlanData(rawSpec);
  spec.packCellId = `cell.semantic-room-pack.${spec.key}`;
  const hostCell = plan.spatialCells.find(({ id }) => id === spec.hostCellId);
  const region = plan.regions.find(({ id }) => id === spec.regionId);
  if (!hostCell || !region || hostCell.regionId !== region.id) {
    throw new Error(`${spec.placementId} cannot resolve host ownership ${spec.regionId}/${spec.hostCellId}.`);
  }
  const descriptor = getSemanticRoomPackV1Descriptor(spec.roomId);
  const entryDescriptor = descriptor.sockets.find(({ id }) => id === 'entry_south');
  if (!entryDescriptor) throw new Error(`${spec.roomId} has no entry_south socket.`);
  const placementPortalId = `portal.semantic-room-pack.${spec.key}.${spec.routes[0].key}`;
  const branchTransform = branchEntryTransform(hostCell, spec, placementPortalId, entryDescriptor.aperture);
  const compiled = compileSemanticRoomPackPlacementV2(spec.roomId, {
    placementId: spec.placementId,
    entrySocketId: entryDescriptor.id,
    targetPortal: branchTransform.targetPortal,
    yawQuarterTurns: spec.yawQuarterTurns,
  });
  const manifestBoundaries = compiled.structuralBoundaries.map((record) => enrichBoundary(compiled, record, spec));
  const supportBoundaryIds = manifestBoundaries.filter(({ side }) => side === 'floor').map(({ id }) => id);
  if (!supportBoundaryIds.length) throw new Error(`${compiled.placementId} has no manifest-derived floor foundation.`);
  const fixtures = compiled.structuralFixtures.map((record) => enrichFixture(compiled, record, spec, supportBoundaryIds));
  const surfaces = compiled.walkableSurfaces.map((record) => (
    enrichSurface(compiled, record, spec, descriptor, supportBoundaryIds, fixtures)
  ));
  const explicitRuntime = addExplicitRuntimeSurfaces(plan, compiled, spec, surfaces, supportBoundaryIds);
  const entrySocket = compiled.sockets.find(({ id }) => id === compiled.entrySocketId);
  const portalIdsBySocket = Object.fromEntries(spec.routes.map((route) => [
    route.socketId,
    `portal.semantic-room-pack.${spec.key}.${route.key}`,
  ]));
  const socketFrames = socketFrameContracts(compiled, spec, manifestBoundaries, portalIdsBySocket);

  const provisionalPlacement = {
    ...compiled,
    structuralBoundaries: manifestBoundaries,
    walkableSurfaces: surfaces,
    structuralFixtures: fixtures,
  };
  const routes = spec.routes.map((routeSpec) => createRoutedPortalAndLinks(
    plan,
    provisionalPlacement,
    spec,
    routeSpec,
    manifestBoundaries,
    surfaces,
  ));
  const internalLinks = createInternalTraversalLinks(compiled, surfaces, spec);
  const capBoundaryIds = socketFrames.bindings.filter(({ status }) => status === 'capped').map(({ capId }) => capId);
  const additionalBoundaryIds = socketFrames.kitBoundaries.map(({ id }) => id);
  const placement = deepFreezePlan({
    ...compiled,
    goldenIntegrationRevision: SEMANTIC_ROOM_PACK_GOLDEN_INTEGRATION_V2_REVISION,
    goldenRegionId: spec.regionId,
    goldenCellId: spec.packCellId,
    hostCellId: hostCell.id,
    macroBranchPortalId: routes[0].portal.id,
    connectorCellIds: routes.flatMap(({ connector }) => connector.cells.map(({ id }) => id)),
    connectorBoundaryIds: routes.flatMap(({ connector }) => connector.boundaries.map(({ id }) => id)),
    connectorSurfaceIds: routes.flatMap(({ connector }) => connector.surfaces.map(({ id }) => id)),
    socketBindings: socketFrames.bindings,
    boundPortalIds: routes.map(({ portal }) => portal.id),
    socketCapBoundaryIds: capBoundaryIds,
    structuralKitBoundaryIds: additionalBoundaryIds,
    runtimeContractBindings: clonePlanData(explicitRuntime.bindings),
    runtimePresentationBindings: compiled.roomId === WATERWORKS_ROOM_ID ? {
      waterBasins: [{
        basinId: 'basin.freight-sump',
        sourceNodeName: 'FLUID_FACTORY_WATER_LEVEL_FREIGHT',
        presentationMode: 'authored-fluid-volume',
      }],
    } : {},
    auxiliaryRuntimeSurfaceIds: explicitRuntime.auxiliarySurfaceIds,
    fullyIntegrated: false,
    structuralBoundaries: manifestBoundaries,
    walkableSurfaces: surfaces,
    structuralFixtures: fixtures,
  });
  const modulePlacement = {
    id: placement.placementId,
    placementId: placement.placementId,
    descriptorId: `semantic-room-pack-v1.${placement.roomId}`,
    descriptorRevision: placement.packRevision,
    roomId: placement.roomId,
    packId: placement.packId,
    packRevision: placement.packRevision,
    semanticRoomPackPlacementId: placement.placementId,
    regionIds: [spec.regionId],
    translation: clonePlanData(placement.placementTransform.translation),
    yawQuarterTurns: placement.placementTransform.yawQuarterTurns,
    bounds: clonePlanData(placement.worldBounds),
    topologySignature: `semantic-room-pack-v1:${placement.roomId}:${placement.topologyVariant}`,
    occupiedCellIds: [spec.packCellId, ...routes.flatMap(({ connector }) => connector.cells.map(({ id }) => id))],
    collisionSourcePolicy: placement.collisionSourcePolicy,
    socketBindings: clonePlanData(placement.socketBindings),
    boundPortalIds: routes.map(({ portal }) => portal.id),
    socketCapBoundaryIds: capBoundaryIds,
    connectorCellIds: routes.flatMap(({ connector }) => connector.cells.map(({ id }) => id)),
    runtimeContractBindings: clonePlanData(explicitRuntime.bindings),
    fullyIntegrated: false,
    placedRecordIds: clonePlanData(placement.placedRecordIds),
    nativeIntegrationStatus: 'diagnostic-multi-route-candidate-not-for-production',
  };
  return {
    spec,
    placement,
    modulePlacement,
    packCell: makePackCell(placement, spec),
    manifestBoundaries,
    kitBoundaries: socketFrames.kitBoundaries,
    fixtures,
    surfaces,
    routes,
    traversalLinks: [...routes.flatMap(({ links }) => links), ...internalLinks],
  };
}

function assertUniqueCollectionIds(plan) {
  for (const collectionName of [
    'modulePlacements',
    'spatialCells',
    'structuralBoundaries',
    'walkableSurfaces',
    'structuralFixtures',
    'portals',
    'traversalLinks',
  ]) {
    const ids = plan[collectionName].map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
      throw new Error(`Semantic room-pack integration duplicated ${collectionName} ID ${duplicate}.`);
    }
  }
}

function refreshRegionBoundsAndSignatures(plan, branches) {
  for (const branch of branches) {
    const region = plan.regions.find(({ id }) => id === branch.spec.regionId);
    region.bounds = unionBounds(region.bounds, branch.packCell.bounds);
    const minimapRegion = plan.minimap?.regions?.find(({ id }) => id === region.id);
    if (minimapRegion) minimapRegion.bounds = clonePlanData(region.bounds);
  }
  const signatures = deriveDungeonTopologySignaturesV2(plan);
  for (const region of plan.regions) region.topologySignature = signatures[region.id];
  for (const placement of plan.modulePlacements) {
    const regionId = placement.regionIds?.[0];
    if (regionId && signatures[regionId]) placement.topologySignature = signatures[regionId];
  }
}

function auditFullyIntegratedPlan(plan, placements) {
  const portalIds = new Set(plan.portals.map(({ id }) => id));
  const cellIds = new Set(plan.spatialCells.map(({ id }) => id));
  const boundaryIds = new Set(plan.structuralBoundaries.map(({ id }) => id));
  const surfaceIds = new Set(plan.walkableSurfaces.map(({ id }) => id));
  const fixtureIds = new Set(plan.structuralFixtures.map(({ id }) => id));
  const failures = [];
  for (const placement of placements) {
    if (placement.socketBindings.length !== placement.sockets.length
      || new Set(placement.socketBindings.map(({ socketId }) => socketId)).size !== placement.sockets.length) {
      failures.push(`${placement.placementId}:socket-bindings-incomplete`);
    }
    for (const binding of placement.socketBindings) {
      if (binding.status === 'bound' && !portalIds.has(binding.portalId)) failures.push(`${placement.placementId}:${binding.socketId}:portal-missing`);
      if (binding.status === 'capped' && !boundaryIds.has(binding.capId)) failures.push(`${placement.placementId}:${binding.socketId}:cap-missing`);
      if (!['bound', 'capped'].includes(binding.status)) failures.push(`${placement.placementId}:${binding.socketId}:status-${binding.status}`);
    }
    for (const id of placement.connectorCellIds) if (!cellIds.has(id)) failures.push(`${placement.placementId}:connector-cell:${id}`);
    for (const id of placement.connectorBoundaryIds) if (!boundaryIds.has(id)) failures.push(`${placement.placementId}:connector-boundary:${id}`);
    for (const id of placement.connectorSurfaceIds) if (!surfaceIds.has(id)) failures.push(`${placement.placementId}:connector-surface:${id}`);
    for (const id of placement.placedRecordIds.structuralBoundaryIds) if (!boundaryIds.has(id)) failures.push(`${placement.placementId}:boundary:${id}`);
    for (const id of placement.placedRecordIds.walkableSurfaceIds) if (!surfaceIds.has(id)) failures.push(`${placement.placementId}:surface:${id}`);
    for (const id of placement.placedRecordIds.structuralFixtureIds) if (!fixtureIds.has(id)) failures.push(`${placement.placementId}:fixture:${id}`);
  }
  if (failures.length) throw new Error(`Semantic room-pack physical integration audit failed: ${failures.join(', ')}`);
}

/**
 * Build the explicit diagnostic candidate used to audit how the authored room
 * pack would bind into the current golden complex. This function deliberately
 * remains acceptance-blocking: its long connector routes prove every socket,
 * state, and content binding, but are not the production solution. Production
 * integration must replace/absorb the corresponding macro cells and rebind
 * their existing portals rather than shipping these diagnostic corridors.
 */
export function integrateSemanticRoomPackGoldenPlanV2(plan, options = {}) {
  assertMutableGoldenPlan(plan);
  const undercroftType = normalizeUndercroftType(plan, options.undercroftType);
  const specs = GOLDEN_BRANCH_SPECS.map((entry) => ({
    ...clonePlanData(entry),
    roomId: entry.roomId ?? UNDERCROFT_ROOM_IDS[undercroftType],
  }));
  const branches = specs.map((spec) => compileBranch(plan, spec));
  const placements = branches.map(({ placement }) => placement);

  plan.semanticRoomPackPlacements = placements;
  for (const branch of branches) {
    plan.modulePlacements.push(branch.modulePlacement);
    plan.spatialCells.push(branch.packCell, ...branch.routes.flatMap(({ connector }) => connector.cells));
    plan.structuralBoundaries.push(
      ...branch.manifestBoundaries.map(clonePlanData),
      ...branch.kitBoundaries.map(clonePlanData),
      ...branch.routes.flatMap(({ connector }) => connector.boundaries).map(clonePlanData),
    );
    plan.walkableSurfaces.push(
      ...branch.surfaces.map(clonePlanData),
      ...branch.routes.flatMap(({ connector }) => connector.surfaces).map(clonePlanData),
    );
    plan.structuralFixtures.push(...branch.fixtures.map(clonePlanData));
    plan.portals.push(...branch.routes.map(({ portal }) => clonePlanData(portal)));
    plan.connectionOrder ??= [];
    plan.connectionOrder.push(...branch.routes.map(({ portal }) => portal.id));
    plan.traversalLinks.push(...branch.traversalLinks.map(clonePlanData));
  }
  assertUniqueCollectionIds(plan);
  refreshRegionBoundsAndSignatures(plan, branches);
  auditFullyIntegratedPlan(plan, placements);

  plan.semanticRoomPackIntegration = {
    revision: SEMANTIC_ROOM_PACK_GOLDEN_INTEGRATION_V2_REVISION,
    undercroftType,
    placementIds: placements.map(({ placementId }) => placementId),
    roomIds: placements.map(({ roomId }) => roomId),
    portalIds: branches.flatMap(({ routes }) => routes.map(({ portal }) => portal.id)),
    connectorCellIds: branches.flatMap(({ routes }) => routes.flatMap(({ connector }) => connector.cells.map(({ id }) => id))),
    socketCapBoundaryIds: placements.flatMap(({ socketCapBoundaryIds }) => socketCapBoundaryIds),
    collisionSourcePolicy: 'manifest-collision-volumes-only-plus-explicit-enclosed-connector-kit-and-optional-socket-caps',
    fullyIntegrated: false,
    acceptanceBlocking: true,
    productionEligible: false,
    pendingRoutes: branches.flatMap(({ spec, routes }) => routes.map(({ portal, connector }) => ({
      placementId: spec.placementId,
      portalId: portal.id,
      connectorCellCount: connector.cells.length,
      reason: 'diagnostic-long-route-candidate-must-be-replaced-by-existing-macro-cell-absorption',
    }))),
    diagnostics: [{
      code: 'semantic-room-pack-macro-replacement-required',
      message: 'The authored pack requires macro-cell replacement/rebinding; the diagnostic long-route candidate is intentionally acceptance-blocking.',
      details: {
        routeCount: branches.reduce((total, { routes }) => total + routes.length, 0),
        connectorCellCount: branches.reduce((total, { routes }) => total + routes.reduce((subtotal, { connector }) => subtotal + connector.cells.length, 0), 0),
      },
    }],
  };
  return plan;
}

export default integrateSemanticRoomPackGoldenPlanV2;
