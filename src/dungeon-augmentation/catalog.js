import {
  DUNGEON_AUGMENTATION_PROFILE_SCHEMA,
  DUNGEON_SUPPLEMENT_GRAMMAR_SCHEMA,
} from './contracts.js';
import { deepFreezeDungeonAugmentationValue } from './canonical.js';
import {
  INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST,
} from './IndustrialSupplementBlueprintCatalog.js';
import { rotateDungeonLocalPoint } from './geometry.js';

function socket(
  id,
  x,
  z,
  facingX,
  facingZ,
  kinds = ['player', 'enemy'],
  options = null,
) {
  return {
    id,
    localPosition: { x, y: Number(options?.elevation ?? options?.y ?? 0), z },
    localFacing: { x: facingX, y: 0, z: facingZ },
    kinds,
    widthMeters: Number(options?.widthMeters ?? 8.4),
    heightMeters: Number(options?.heightMeters ?? 5.6),
    connectorFamilies: [...(options?.connectorFamilies ?? ['service-gallery'])],
    ...(options?.blueprintSocketId ? {
      blueprintSocketId: String(options.blueprintSocketId),
    } : {}),
    ...(options?.connectivityGroupId ? {
      connectivityGroupId: String(options.connectivityGroupId),
    } : {}),
  };
}

function anchor(id, kind, x, z, extra = {}) {
  return { id, kind, localPosition: { x, y: 0, z }, ...extra };
}

function grammar({
  id,
  size,
  sockets,
  anchors,
  topology,
  weight = 1,
  structure = null,
  requiredThemeCapabilities = null,
  selectionConstraints = null,
  blueprintId = null,
  blueprintCanonicalRotationQuarterTurns = null,
  blueprintPersistentStateIds = null,
  socketConnectivityGroups = null,
  occupiedPurpose = 'supplement-room-occupied',
  clearancePurpose = 'walkable-player-clearance',
  occupiedVolumes = null,
  clearanceVolumes = null,
}) {
  const resolvedStructure = structure ?? {
    floors: [{ id: 'main-floor', role: 'primary-floor', elevation: 0, width: size.width, depth: size.depth }],
    walls: [{ id: 'perimeter-walls', role: 'wall', height: size.height }],
    ceilings: [{ id: 'main-ceiling', role: 'ceiling', elevation: size.height }],
    supports: [{ id: 'structural-supports', role: 'support', spacingMeters: 2.8 }],
    caps: [{ id: 'unused-socket-cap', role: 'cap' }],
    catwalks: [],
  };
  return deepFreezeDungeonAugmentationValue({
    schema: DUNGEON_SUPPLEMENT_GRAMMAR_SCHEMA,
    id,
    revision: 1,
    weight,
    sizeClass: size.width <= 8.4 ? 'narrow' : size.width <= 11.2 ? 'compact' : 'standard',
    allowedRotationQuarterTurns: [0, 1, 2, 3],
    topology,
    ...(blueprintId ? { blueprintId: String(blueprintId) } : {}),
    ...(Array.isArray(blueprintPersistentStateIds) ? {
      blueprintPersistentStateIds: [...blueprintPersistentStateIds].map(String),
    } : {}),
    ...(blueprintCanonicalRotationQuarterTurns == null ? {} : {
      blueprintCanonicalRotationQuarterTurns: Number(
        blueprintCanonicalRotationQuarterTurns,
      ),
    }),
    ...(Array.isArray(socketConnectivityGroups) ? {
      socketConnectivityGroups: [...socketConnectivityGroups],
    } : {}),
    size,
    structure: resolvedStructure,
    occupiedVolumes: occupiedVolumes ?? [{
      id: 'room-body',
      center: { x: 0, y: size.height * 0.5, z: 0 },
      size: { ...size },
      purpose: occupiedPurpose,
    }],
    clearanceVolumes: clearanceVolumes ?? [{
      id: 'player-clearance',
      center: { x: 0, y: 1.8, z: 0 },
      size: { x: Math.max(2.8, size.width - 1.4), y: 3.6, z: Math.max(2.8, size.depth - 1.4) },
      purpose: clearancePurpose,
    }],
    sockets,
    anchors,
    requiredThemeCapabilities: requiredThemeCapabilities ?? {
      materials: ['primary-floor', 'wall', 'ceiling', 'support', 'cap'],
      assets: ['light-fixture'],
      connectors: ['service-gallery'],
      transitions: [],
    },
    selectionConstraints: {
      maximumRepeatsPerOperation: 2,
      bossArenaEligible: false,
      ...(selectionConstraints ?? {}),
    },
  });
}

const COMPACT_SIZE = Object.freeze({ width: 11.2, height: 5.6, depth: 11.2 });
const GALLERY_SIZE = Object.freeze({ width: 8.4, height: 5.6, depth: 14 });
const JUNCTION_SIZE = Object.freeze({ width: 14, height: 5.6, depth: 14 });
// Thirteen grid cells make the guaranteed V3 junction read as a corridor with
// multiple door stations, rather than as one square room with four openings.
const HALL_CLUSTER_SIZE = Object.freeze({ width: 14, height: 8.4, depth: 36.4 });
const HALL_CLUSTER_SIDE_DOOR_OFFSET = 8.4;
const SIDE_ROOM_SIZE = Object.freeze({ width: 19.6, height: 8.4, depth: 19.6 });
const TERMINAL_ROOM_SIZE = Object.freeze({ width: 25.2, height: 11.2, depth: 25.2 });

const VERTICAL_CONNECTOR_FAMILIES = Object.freeze(['slope', 'ladder', 'lift']);

const BLUEPRINT_GRAMMAR_ID_BY_BLUEPRINT_ID = Object.freeze({
  'ind-junction-through-t-01': 'supplement-route-connector-through-t-v1',
  'ind-junction-through-t-branch-entry-01': 'supplement-route-connector-through-t-branch-entry-v1',
  'ind-junction-crossroads-01': 'supplement-route-connector-crossroads-v1',
  'ind-junction-staggered-cross-01': 'supplement-route-connector-staggered-cross-v1',
  'ind-loop-paired-t-h-01': 'supplement-route-connector-fork-merge-v1',
  'ind-interchange-stacked-01': 'supplement-route-connector-stacked-interchange-v1',
  'ind-crossover-over-under-01': 'supplement-route-connector-over-under-v1',
  'ind-room-compact-ramp-defense-rise-01': 'supplement-route-room-compact-ramp-defense-rise-v1',
});

const BLUEPRINT_JUNCTION_KIND_BY_ID = Object.freeze({
  'ind-junction-through-t-01': 'through-t',
  'ind-junction-through-t-branch-entry-01': 'through-t',
  'ind-junction-crossroads-01': 'crossroads',
  'ind-junction-staggered-cross-01': 'staggered-cross',
  'ind-loop-paired-t-h-01': 'fork-merge',
  'ind-interchange-stacked-01': 'stacked-interchange',
  'ind-crossover-over-under-01': 'over-under-crossover',
});

// These authored kits realize complete topology families rather than generic
// serial content. The planner consumes this contract directly so adding a kit
// to the catalog cannot leave it stranded behind the ordinary room/junction
// selectors.
const BLUEPRINT_TOPOLOGY_KIT_BY_ID = Object.freeze({
  'ind-loop-paired-t-h-01': Object.freeze({
    topologyTemplateId: 'fork-merge-h-loop',
    spineSocketIds: Object.freeze(['entry', 'exit']),
    topologySocketIds: Object.freeze([]),
    internalCycleRankDelta: 1,
  }),
  'ind-interchange-stacked-01': Object.freeze({
    topologyTemplateId: 'stacked-interchange',
    spineSocketIds: Object.freeze(['entry', 'exit']),
    topologySocketIds: Object.freeze(['left', 'right']),
    internalCycleRankDelta: 0,
  }),
  'ind-crossover-over-under-01': Object.freeze({
    topologyTemplateId: 'over-under-loop',
    spineSocketIds: Object.freeze(['entry', 'exit']),
    topologySocketIds: Object.freeze(['left', 'right']),
    internalCycleRankDelta: 0,
  }),
});

const BLUEPRINT_SOCKET_LOCAL_ID_BY_ID = Object.freeze({
  'ind-junction-through-t-01': Object.freeze({
    'tt-n': 'entry', 'tt-s': 'exit', 'tt-e': 'right',
  }),
  'ind-junction-through-t-branch-entry-01': Object.freeze({
    'ttb-e': 'entry', 'ttb-n': 'exit', 'ttb-s': 'right',
  }),
  'ind-junction-crossroads-01': Object.freeze({
    'xr-n': 'entry', 'xr-s': 'exit', 'xr-w': 'left', 'xr-e': 'right',
  }),
  'ind-junction-staggered-cross-01': Object.freeze({
    'sc-n': 'entry', 'sc-s': 'exit', 'sc-w': 'left', 'sc-e': 'right',
  }),
  'ind-loop-paired-t-h-01': Object.freeze({ 'hl-w': 'entry', 'hl-e': 'exit' }),
  'ind-interchange-stacked-01': Object.freeze({
    'si-n0': 'entry', 'si-s0': 'exit', 'si-w2': 'left', 'si-e2': 'right',
  }),
  'ind-crossover-over-under-01': Object.freeze({
    'ou-w0': 'entry', 'ou-e0': 'exit', 'ou-n2': 'left', 'ou-s2': 'right',
  }),
});

const BLUEPRINT_CONTENT_ROLES_BY_ID = Object.freeze({
  // The paired-T kit is a level traversal loop. It has no authored vertical
  // maintenance platform, so advertising the generic mechanism role makes
  // strict materialization request an anchor this blueprint cannot supply.
  'ind-loop-paired-t-h-01': ['challenge', 'reward', 'discovery'],
  'ind-room-reaverbot-foundry-01': ['challenge'],
  'ind-room-treatment-control-01': ['mechanism', 'trap'],
  'ind-room-ladder-defense-rise-01': ['elevation', 'challenge'],
  'ind-room-lift-defense-rise-01': ['elevation', 'challenge', 'mechanism'],
  'ind-room-compact-ramp-defense-rise-01': ['elevation', 'challenge'],
  'ind-room-maintenance-rise-01': ['elevation', 'mechanism'],
  'ind-room-dispatch-vault-01': ['reward', 'treasure'],
  'ind-room-observation-break-01': ['discovery', 'calm', 'reward'],
  'ind-rise-switchback-ramp-01': ['elevation'],
  'ind-rise-stair-cascade-01': ['elevation'],
  'ind-rise-freight-lift-dogleg-01': ['elevation', 'mechanism'],
  'ind-rise-ladder-bridge-01': ['elevation'],
  'ind-room-turbine-helix-01': ['elevation', 'challenge'],
  'ind-room-floodgate-descent-01': ['elevation', 'trap', 'mechanism'],
  'ind-room-crane-gantry-lift-01': ['elevation', 'mechanism', 'challenge'],
  'ind-room-pressure-lock-reward-rise-01': ['elevation', 'reward'],
  'ind-room-pressure-lock-reward-descent-01': ['elevation', 'reward', 'treasure'],
  'ind-room-switchgear-cache-descent-01': ['elevation', 'reward', 'treasure'],
  'ind-room-survey-relay-cache-01': ['reward', 'treasure', 'calm', 'discovery'],
  'ind-rise-long-freight-ramp-01': ['elevation'],
  'ind-room-inclined-sorter-01': ['elevation', 'challenge', 'trap', 'reward'],
});

function blueprintGrammarId(blueprintId) {
  return BLUEPRINT_GRAMMAR_ID_BY_BLUEPRINT_ID[blueprintId]
    ?? `supplement-blueprint-${blueprintId}-v1`;
}

function blueprintSocketLocalId(blueprint, blueprintSocket, ordinal) {
  const explicit = BLUEPRINT_SOCKET_LOCAL_ID_BY_ID[blueprint.id]?.[blueprintSocket.id];
  if (explicit) return explicit;
  if (String(blueprintSocket.role).includes('entry')) return 'entry';
  if (String(blueprintSocket.role).includes('reconnect')) return 'exit';
  return ['entry', 'exit', 'left', 'right'][ordinal] ?? `port-${ordinal}`;
}

function blueprintSocketConnectivityGroupId(blueprint, blueprintSocket) {
  if (blueprint.id === 'ind-crossover-over-under-01'
    || blueprint.id === 'ind-interchange-stacked-01') {
    return Number(blueprintSocket.y) > 0 ? 'upper-route' : 'lower-route';
  }
  return 'main-route';
}

function blueprintCanonicalRotationQuarterTurns(blueprint) {
  const entry = blueprint.sockets.find((blueprintSocket, ordinal) => (
    blueprintSocketLocalId(blueprint, blueprintSocket, ordinal) === 'entry'
  )) ?? blueprint.sockets.find(({ role }) => String(role).includes('entry'))
    ?? blueprint.sockets[0];
  if (entry?.side === 'N') return 0;
  if (entry?.side === 'E') return 1;
  if (entry?.side === 'S') return 2;
  if (entry?.side === 'W') return 3;
  return 0;
}

function blueprintSocketLocalPosition(blueprint, blueprintSocket) {
  const halfFloorWidth = (Number(blueprint.widthTiles) - 1) * blueprint.floorCellMeters * 0.5;
  const halfFloorDepth = (Number(blueprint.depthTiles) - 1) * blueprint.floorCellMeters * 0.5;
  const transverse = Number(blueprintSocket.center) * blueprint.floorCellMeters;
  if (blueprintSocket.side === 'N') return { x: transverse, z: -halfFloorDepth };
  if (blueprintSocket.side === 'S') return { x: transverse, z: halfFloorDepth };
  if (blueprintSocket.side === 'W') return { x: -halfFloorWidth, z: transverse };
  return { x: halfFloorWidth, z: transverse };
}

function blueprintSocketFacing(side) {
  if (side === 'N') return { x: 0, z: -1 };
  if (side === 'S') return { x: 0, z: 1 };
  if (side === 'W') return { x: -1, z: 0 };
  return { x: 1, z: 0 };
}

function blueprintAnchorKind(feature) {
  if (feature.type === 'reward') return 'reward';
  if (feature.type === 'control') return 'progression';
  if (feature.type === 'spawn') return 'spatial-role';
  if (feature.type === 'transfer') return 'platform';
  if (feature.type === 'cover') return 'cover';
  return 'prop';
}

function blueprintFeatureElevation(blueprint, feature) {
  return feature.tier === 'upper' ? Number(blueprint.upperY ?? 0) : 0;
}

function blueprintPlanningMaskRectangles(blueprint, canonicalRotationQuarterTurns) {
  const masks = blueprint.floorTiers.map(({ floorMask }) => floorMask);
  const depth = Number(blueprint.depthTiles);
  const width = Number(blueprint.widthTiles);
  const activeRectangles = new Map();
  const rectangles = [];
  const closeRectangle = (rectangle) => {
    const centerColumn = (rectangle.startColumn + rectangle.endColumn) * 0.5;
    const centerRow = (rectangle.startRow + rectangle.endRow) * 0.5;
    const localCenter = rotateDungeonLocalPoint({
      x: (centerColumn - (width - 1) * 0.5) * blueprint.floorCellMeters,
      z: (centerRow - (depth - 1) * 0.5) * blueprint.floorCellMeters,
    }, canonicalRotationQuarterTurns);
    const localWidth = (rectangle.endColumn - rectangle.startColumn + 1)
      * blueprint.floorCellMeters;
    const localDepth = (rectangle.endRow - rectangle.startRow + 1)
      * blueprint.floorCellMeters;
    const swapsAxes = canonicalRotationQuarterTurns % 2 === 1;
    rectangles.push({
      center: localCenter,
      size: {
        x: swapsAxes ? localDepth : localWidth,
        z: swapsAxes ? localWidth : localDepth,
      },
    });
  };

  for (let row = 0; row < depth; row += 1) {
    const occupied = Array.from({ length: width }, (_, column) => (
      masks.some((mask) => mask[row]?.[column] === '#')
    ));
    const rowRuns = [];
    for (let column = 0; column < width; column += 1) {
      if (!occupied[column]) continue;
      const startColumn = column;
      while (column + 1 < width && occupied[column + 1]) column += 1;
      rowRuns.push({ startColumn, endColumn: column });
    }
    const rowKeys = new Set(rowRuns.map(({ startColumn, endColumn }) => (
      `${startColumn}:${endColumn}`
    )));
    for (const [key, rectangle] of activeRectangles) {
      if (rowKeys.has(key)) continue;
      closeRectangle(rectangle);
      activeRectangles.delete(key);
    }
    for (const run of rowRuns) {
      const key = `${run.startColumn}:${run.endColumn}`;
      const existing = activeRectangles.get(key);
      if (existing) {
        existing.endRow = row;
      } else {
        activeRectangles.set(key, {
          ...run,
          startRow: row,
          endRow: row,
        });
      }
    }
  }
  for (const rectangle of activeRectangles.values()) closeRectangle(rectangle);
  return rectangles;
}

function blueprintStructuralWallClearanceVolumes({
  size,
  sockets,
  thickness,
  purpose,
}) {
  const epsilon = 1e-6;
  const sideRecords = [
    {
      id: 'north',
      length: size.width,
      normal: -size.depth * 0.5,
      socketMatches: ({ localFacing }) => Number(localFacing?.z) < -0.5,
      along: ({ localPosition }) => Number(localPosition?.x ?? 0),
      volume: (along, bottom, width, height) => ({
        center: { x: along, y: bottom + height * 0.5, z: -size.depth * 0.5 },
        size: { x: width, y: height, z: thickness },
      }),
    },
    {
      id: 'south',
      length: size.width,
      normal: size.depth * 0.5,
      socketMatches: ({ localFacing }) => Number(localFacing?.z) > 0.5,
      along: ({ localPosition }) => Number(localPosition?.x ?? 0),
      volume: (along, bottom, width, height) => ({
        center: { x: along, y: bottom + height * 0.5, z: size.depth * 0.5 },
        size: { x: width, y: height, z: thickness },
      }),
    },
    {
      id: 'west',
      length: size.depth,
      normal: -size.width * 0.5,
      socketMatches: ({ localFacing }) => Number(localFacing?.x) < -0.5,
      along: ({ localPosition }) => Number(localPosition?.z ?? 0),
      volume: (along, bottom, width, height) => ({
        center: { x: -size.width * 0.5, y: bottom + height * 0.5, z: along },
        size: { x: thickness, y: height, z: width },
      }),
    },
    {
      id: 'east',
      length: size.depth,
      normal: size.width * 0.5,
      socketMatches: ({ localFacing }) => Number(localFacing?.x) > 0.5,
      along: ({ localPosition }) => Number(localPosition?.z ?? 0),
      volume: (along, bottom, width, height) => ({
        center: { x: size.width * 0.5, y: bottom + height * 0.5, z: along },
        size: { x: thickness, y: height, z: width },
      }),
    },
  ];
  const volumes = [];
  for (const side of sideRecords) {
    const half = side.length * 0.5;
    const intervals = sockets
      .filter(side.socketMatches)
      .map((socketRecord) => ({
        start: Math.max(
          -half,
          side.along(socketRecord) - Number(socketRecord.widthMeters ?? 8.4) * 0.5,
        ),
        end: Math.min(
          half,
          side.along(socketRecord) + Number(socketRecord.widthMeters ?? 8.4) * 0.5,
        ),
        height: Number(socketRecord.heightMeters ?? 5.6),
      }))
      .filter(({ start, end }) => end - start > epsilon)
      .sort((first, second) => first.start - second.start || first.end - second.end)
      .reduce((merged, interval) => {
        const previous = merged.at(-1);
        if (previous && interval.start <= previous.end + epsilon) {
          previous.end = Math.max(previous.end, interval.end);
          previous.height = Math.max(previous.height, interval.height);
        } else {
          merged.push({ ...interval });
        }
        return merged;
      }, []);
    let cursor = -half;
    let panelOrdinal = 0;
    const addPanel = (kind, start, end, bottom, height) => {
      if (end - start <= epsilon || height <= epsilon) return;
      volumes.push({
        id: `blueprint-structural-shell-${side.id}-${kind}-${panelOrdinal}-clearance`,
        ...side.volume((start + end) * 0.5, bottom, end - start, height),
        purpose,
      });
      panelOrdinal += 1;
    };
    for (const interval of intervals) {
      addPanel('panel', cursor, interval.start, 0, size.height);
      addPanel(
        'header',
        interval.start,
        interval.end,
        interval.height,
        Math.max(0, size.height - interval.height),
      );
      cursor = Math.max(cursor, interval.end);
    }
    addPanel('panel', cursor, half, 0, size.height);
  }
  return volumes;
}

function blueprintGrammar(blueprint) {
  const junctionKind = BLUEPRINT_JUNCTION_KIND_BY_ID[blueprint.id] ?? null;
  const contentRoles = BLUEPRINT_CONTENT_ROLES_BY_ID[blueprint.id] ?? [];
  const topologyKit = BLUEPRINT_TOPOLOGY_KIT_BY_ID[blueprint.id] ?? null;
  const connectorOwned = Boolean(junctionKind) && blueprint.id !== 'ind-loop-paired-t-h-01';
  const canonicalRotationQuarterTurns = blueprintCanonicalRotationQuarterTurns(blueprint);
  const swapsAxes = canonicalRotationQuarterTurns % 2 === 1;
  const size = {
    width: Number(swapsAxes ? blueprint.depthMeters : blueprint.widthMeters),
    height: Math.max(8.4, ...blueprint.floorTiers.map(({ elevation }) => (
      Number(elevation) + 5.6
    ))),
    depth: Number(swapsAxes ? blueprint.widthMeters : blueprint.depthMeters),
  };
  const sockets = blueprint.sockets.map((blueprintSocket, ordinal) => {
    const position = rotateDungeonLocalPoint(
      blueprintSocketLocalPosition(blueprint, blueprintSocket),
      canonicalRotationQuarterTurns,
    );
    const facing = rotateDungeonLocalPoint(
      blueprintSocketFacing(blueprintSocket.side),
      canonicalRotationQuarterTurns,
    );
    return socket(
      blueprintSocketLocalId(blueprint, blueprintSocket, ordinal),
      position.x,
      position.z,
      facing.x,
      facing.z,
      ['player', 'enemy'],
      {
        elevation: blueprintSocket.y,
        widthMeters: 8.4,
        heightMeters: 5.6,
        connectorFamilies: ['service-gallery', ...VERTICAL_CONNECTOR_FAMILIES],
        blueprintSocketId: blueprintSocket.id,
        connectivityGroupId: blueprintSocketConnectivityGroupId(
          blueprint,
          blueprintSocket,
        ),
      },
    );
  });
  const doorwayAnchors = sockets.map((blueprintSocket) => doorwayFrame(
    `${blueprintSocket.id}-frame`,
    blueprintSocket.localPosition.x,
    blueprintSocket.localPosition.z,
    blueprintSocket.localFacing.x,
    blueprintSocket.localFacing.z,
  ));
  for (let index = 0; index < doorwayAnchors.length; index += 1) {
    doorwayAnchors[index].elevation = sockets[index].localPosition.y;
    doorwayAnchors[index].blueprintSocketId = sockets[index].blueprintSocketId;
  }
  const semanticAnchors = [
    ...blueprint.zones
      .filter(({ type }) => type === 'encounter' || type === 'hazard')
      .map((zone) => {
        const local = rotateDungeonLocalPoint({
          x: Number(zone.x) * blueprint.floorCellMeters,
          z: Number(zone.z) * blueprint.floorCellMeters,
        }, canonicalRotationQuarterTurns);
        return anchor(
          zone.id,
          zone.type === 'encounter' ? 'encounter' : 'trap',
          local.x,
          local.z,
          { blueprintFeatureId: zone.id },
        );
      }),
    ...blueprint.features.map((feature) => {
      const local = rotateDungeonLocalPoint({
        x: Number(feature.x) * blueprint.floorCellMeters,
        z: Number(feature.z) * blueprint.floorCellMeters,
      }, canonicalRotationQuarterTurns);
      return anchor(
        feature.id,
        blueprintAnchorKind(feature),
        local.x,
        local.z,
        {
        elevation: blueprintFeatureElevation(blueprint, feature),
        blueprintFeatureId: feature.id,
        blueprintFeatureType: feature.type,
        footprintTiles: {
          width: Number(feature.w ?? 1),
          depth: Number(feature.d ?? 1),
        },
        solid: feature.solid === true,
        ...(feature.type === 'spawn' ? {
          spatialRole: feature.label === 'F'
            ? 'frontline'
            : feature.label === 'P' ? 'perch' : 'flank',
        } : {}),
        },
      );
    }),
  ];
  const entryElevation = Number(sockets.find(({ id }) => id === 'entry')?.localPosition.y ?? 0);
  const exitElevation = Number(sockets.find(({ id }) => id === 'exit')?.localPosition.y ?? entryElevation);
  const connectivityGroups = [...new Set(sockets.map(({ connectivityGroupId }) => (
    connectivityGroupId
  )))].map((id) => ({
    id,
    localSocketIds: sockets
      .filter(({ connectivityGroupId }) => connectivityGroupId === id)
      .map(({ id: socketId }) => socketId),
  }));
  const hasJoinedTierGroups = blueprint.id === 'ind-interchange-stacked-01';
  const planningMaskRectangles = blueprintPlanningMaskRectangles(
    blueprint,
    canonicalRotationQuarterTurns,
  );
  const structuralWallThickness = Number(blueprint.wallThicknessMeters ?? 0.22);
  const structuralWallPurpose = connectorOwned
    ? 'supplement-connector-module-structural-shell-wall-clearance'
    : 'supplement-room-structural-shell-wall-clearance';
  const structuralWallClearanceVolumes = blueprintStructuralWallClearanceVolumes({
    size,
    sockets,
    thickness: structuralWallThickness,
    purpose: structuralWallPurpose,
  });
  const structure = {
    ownership: connectorOwned ? 'connector' : 'room',
    blueprintId: blueprint.id,
    blueprintCanonicalRotationQuarterTurns: canonicalRotationQuarterTurns,
    floors: blueprint.floorTiers.map((tier) => ({
      ...tier,
      role: Number(tier.elevation) === 0 ? 'primary-floor' : 'catwalk',
    })),
    walls: [{ id: 'authored-mask-boundary-walls', role: 'wall', height: size.height }],
    ceilings: [{ id: 'authored-mask-ceiling', role: 'ceiling', elevation: size.height }],
    supports: [{ id: 'authored-structural-supports', role: 'support', spacingMeters: 2.8 }],
    caps: [{ id: 'authored-unused-socket-cap', role: 'cap' }],
    catwalks: blueprint.floorTiers.filter(({ elevation }) => Number(elevation) > 0),
    platforms: [],
    ramps: [],
    rails: [],
    routes: blueprint.routes,
    zones: blueprint.zones,
    features: blueprint.features,
    voids: blueprint.voids,
    physicalTransfers: blueprint.physicalTransfers,
    elevationTransfers: blueprint.physicalTransfers,
    socketConnectivityGroups: connectivityGroups,
    socketConnectivityLinks: hasJoinedTierGroups
      ? [{ id: 'stacked-lift-link', fromGroupId: 'lower-route', toGroupId: 'upper-route' }]
      : [],
  };
  return grammar({
    id: blueprintGrammarId(blueprint.id),
    blueprintId: blueprint.id,
    blueprintCanonicalRotationQuarterTurns: canonicalRotationQuarterTurns,
    blueprintPersistentStateIds: blueprint.persistentStateIds,
    size,
    topology: junctionKind
      ? `authored-${junctionKind}`
      : 'authored-substantive-traversal-module',
    weight: 1,
    sockets,
    anchors: [
      ...doorwayAnchors,
      ...semanticAnchors,
      anchor('authored-light', 'light-fixture', 0, 0, {
        elevation: size.height - 1.2,
        assetRole: 'light-fixture',
      }),
    ],
    structure,
    socketConnectivityGroups: connectivityGroups,
    occupiedVolumes: planningMaskRectangles.map((rectangle, ordinal) => ({
      id: `blueprint-mask-body-${ordinal}`,
      center: {
        x: rectangle.center.x,
        y: size.height * 0.5,
        z: rectangle.center.z,
      },
      size: { ...rectangle.size, y: size.height },
      purpose: connectorOwned
        ? 'supplement-connector-module-occupied'
        : 'supplement-room-occupied',
    })),
    clearanceVolumes: [
      ...planningMaskRectangles.map((rectangle, ordinal) => ({
        id: `blueprint-mask-clearance-${ordinal}`,
        center: { x: rectangle.center.x, y: 1.8, z: rectangle.center.z },
        size: { ...rectangle.size, y: 3.6 },
        purpose: connectorOwned
          ? 'supplement-connector-module-player-clearance'
          : 'walkable-player-clearance',
      })),
      // DungeonSupplementAssembler encloses the authored floor mask with four
      // thin perimeter panels. Mirror those panels instead of reserving a
      // filled room box: the interior remains usable, while routes may cross a
      // panel only through their exact socket seam overlap grant.
      ...structuralWallClearanceVolumes,
    ],
    requiredThemeCapabilities: {
      materials: ['primary-floor', 'wall', 'ceiling', 'support', 'cap'],
      assets: ['frame', 'light-fixture'],
      connectors: ['service-gallery', ...VERTICAL_CONNECTOR_FAMILIES],
      transitions: [],
    },
    selectionConstraints: {
      blueprintId: blueprint.id,
      blueprintCanonicalRotationQuarterTurns: canonicalRotationQuarterTurns,
      routeNetworkJunctionKind: junctionKind,
      routeNetworkModuleKind: connectorOwned ? 'connector-module' : 'room',
      routeNetworkContentRoles: [...contentRoles],
      connectorOwned,
      substantiveRoom: !connectorOwned,
      meaningfulStation: !connectorOwned,
      supportsJunctionPromotion: connectorOwned
        && blueprint.id !== 'ind-crossover-over-under-01',
      ...(topologyKit ? {
        routeNetworkTopologyTemplateId: topologyKit.topologyTemplateId,
        routeNetworkSpineSocketIds: [...topologyKit.spineSocketIds],
        routeNetworkTopologySocketIds: [...topologyKit.topologySocketIds],
        routeNetworkInternalCycleRankDelta: topologyKit.internalCycleRankDelta,
      } : {}),
      routeNetworkEndpointModule: false,
      authoredExitElevationDeltaMeters: exitElevation - entryElevation,
      authoredTransferKinds: [...new Set(
        blueprint.physicalTransfers.map(({ form }) => String(form)),
      )],
      maximumRepeatsPerOperation: 1,
    },
    occupiedPurpose: connectorOwned
      ? 'supplement-connector-module-occupied'
      : 'supplement-room-occupied',
    clearancePurpose: connectorOwned
      ? 'supplement-connector-module-player-clearance'
      : 'walkable-player-clearance',
  });
}

export const INDUSTRIAL_SUPPLEMENT_BLUEPRINT_GRAMMARS =
  deepFreezeDungeonAugmentationValue(Object.fromEntries(
    INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST.map((blueprint) => {
      const resolved = blueprintGrammar(blueprint);
      return [resolved.id, resolved];
    }),
  ));

export const INDUSTRIAL_SUPPLEMENT_BLUEPRINT_GRAMMAR_POOL =
  deepFreezeDungeonAugmentationValue(INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST.map((blueprint) => ({
    id: blueprintGrammarId(blueprint.id),
    weight: 1,
  })));

function roomShellStructure(size, extra = {}) {
  return {
    floors: [{ id: 'main-floor', role: 'primary-floor', elevation: 0, width: size.width, depth: size.depth }],
    walls: [{ id: 'perimeter-walls', role: 'wall', height: size.height }],
    ceilings: [{ id: 'main-ceiling', role: 'ceiling', elevation: size.height }],
    supports: [{ id: 'structural-supports', role: 'support', spacingMeters: 2.8 }],
    caps: [{ id: 'unused-socket-cap', role: 'cap' }],
    catwalks: [],
    ...extra,
  };
}

function doorwayFrame(id, x, z, facingX, facingZ) {
  return anchor(id, 'doorway-frame', x, z, {
    localFacing: { x: facingX, y: 0, z: facingZ },
    assetRole: 'frame',
  });
}

function routeNetworkConnectorModuleGrammar({
  id,
  size,
  topology,
  junctionKind,
  vertical = false,
  endpoint = false,
}) {
  const halfWidth = size.width * 0.5;
  const halfDepth = size.depth * 0.5;
  const connectorFamilies = ['service-gallery', ...VERTICAL_CONNECTOR_FAMILIES];
  const structure = {
    ownership: 'connector',
    floors: [{
      id: 'connector-junction-floor',
      role: 'corridor-floor',
      elevation: 0,
      width: size.width,
      depth: size.depth,
    }],
    walls: [{ id: 'connector-junction-walls', role: 'wall', height: size.height }],
    ceilings: [{
      id: 'connector-junction-ceiling',
      role: 'ceiling',
      elevation: size.height,
    }],
    supports: [{
      id: 'connector-junction-supports',
      role: 'support',
      spacingMeters: 2.8,
    }],
    caps: [{ id: 'connector-junction-unused-socket-cap', role: 'cap' }],
    catwalks: [],
    platforms: vertical ? [{
      id: 'connector-junction-upper-platform',
      role: 'catwalk',
      localCenterGrid: { x: 0, z: 1 },
      widthTiles: 3,
      depthTiles: 3,
      elevation: 2.8,
      platformPurpose: 'route-network-elevation-decision',
    }] : [],
    ramps: vertical ? [{
      id: 'connector-junction-platform-ramp',
      role: 'ramp',
      localStartGrid: { x: -2, z: -2 },
      localEndGrid: { x: -2, z: 2 },
      fromElevation: 0,
      toElevation: 2.8,
    }] : [],
    rails: vertical ? [{
      id: 'connector-junction-platform-rails',
      role: 'rail',
      platformId: 'connector-junction-upper-platform',
    }] : [],
  };
  return grammar({
    id,
    size,
    topology,
    weight: 1,
    sockets: [
      socket('entry', 0, -halfDepth, 0, -1, ['player', 'enemy'], { connectorFamilies }),
      socket('exit', 0, halfDepth, 0, 1, ['player', 'enemy'], { connectorFamilies }),
      socket('left', -halfWidth, 0, -1, 0, ['player', 'enemy'], { connectorFamilies }),
      socket('right', halfWidth, 0, 1, 0, ['player', 'enemy'], { connectorFamilies }),
    ],
    structure,
    anchors: [
      doorwayFrame('entry-frame', 0, -halfDepth, 0, -1),
      doorwayFrame('exit-frame', 0, halfDepth, 0, 1),
      doorwayFrame('left-frame', -halfWidth, 0, -1, 0),
      doorwayFrame('right-frame', halfWidth, 0, 1, 0),
      anchor('light', 'light-fixture', 0, 0, {
        elevation: Math.max(4.8, size.height - 1.2),
        assetRole: 'light-fixture',
      }),
    ],
    requiredThemeCapabilities: {
      materials: [
        'corridor-floor', 'wall', 'ceiling', 'support', 'cap',
        ...(vertical ? ['catwalk', 'rail', 'ramp'] : []),
      ],
      assets: ['frame', 'light-fixture'],
      connectors: connectorFamilies,
      transitions: [],
    },
    selectionConstraints: {
      routeNetworkJunctionKind: junctionKind,
      // These compact connector-owned forms are promoted to meaningful
      // supplementConnectorJunction records only when at least three physical
      // approaches are committed. Degree-two instances remain infrastructure.
      routeNetworkModuleKind: 'connector-module',
      connectorOwned: true,
      substantiveRoom: false,
      meaningfulStation: false,
      supportsJunctionPromotion: true,
      routeNetworkEndpointModule: endpoint,
      maximumRepeatsPerOperation: 2,
    },
    occupiedPurpose: 'supplement-connector-module-occupied',
    clearancePurpose: 'supplement-connector-module-player-clearance',
  });
}

export const GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS = deepFreezeDungeonAugmentationValue({
  'supplement-chamber-compact-v1': grammar({
    id: 'supplement-chamber-compact-v1',
    size: COMPACT_SIZE,
    topology: 'through-room',
    weight: 4,
    sockets: [
      socket('entry', 0, -COMPACT_SIZE.depth * 0.5, 0, -1),
      socket('exit', 0, COMPACT_SIZE.depth * 0.5, 0, 1),
    ],
    anchors: [
      anchor('encounter', 'encounter', 0, 0),
      anchor('reward', 'reward', 2.8, 1.4),
      anchor('progression', 'progression', -2.8, 1.4),
      anchor('light', 'light-fixture', 0, 0, { elevation: 4.8 }),
    ],
  }),
  'supplement-gallery-bay-v1': grammar({
    id: 'supplement-gallery-bay-v1',
    size: GALLERY_SIZE,
    topology: 'through-gallery',
    weight: 3,
    sockets: [
      socket('entry', 0, -GALLERY_SIZE.depth * 0.5, 0, -1),
      socket('exit', 0, GALLERY_SIZE.depth * 0.5, 0, 1),
    ],
    anchors: [
      anchor('encounter', 'encounter', 0, 0),
      anchor('reward', 'reward', 0, 2.8),
      anchor('progression', 'progression', 0, -2.8),
      anchor('light', 'light-fixture', 0, 0, { elevation: 4.8 }),
    ],
  }),
  'supplement-junction-v1': grammar({
    id: 'supplement-junction-v1',
    size: JUNCTION_SIZE,
    topology: 'four-way-junction',
    weight: 1,
    sockets: [
      socket('entry', 0, -JUNCTION_SIZE.depth * 0.5, 0, -1),
      socket('exit', 0, JUNCTION_SIZE.depth * 0.5, 0, 1),
      socket('left', -JUNCTION_SIZE.width * 0.5, 0, -1, 0),
      socket('right', JUNCTION_SIZE.width * 0.5, 0, 1, 0),
    ],
    anchors: [
      anchor('encounter', 'encounter', 0, 0),
      anchor('reward', 'reward', 2.8, 2.8),
      anchor('progression', 'progression', -2.8, 2.8),
      anchor('light', 'light-fixture', 0, 0, { elevation: 4.8 }),
    ],
  }),
  'supplement-hall-cluster-junction-v1': grammar({
    id: 'supplement-hall-cluster-junction-v1',
    size: HALL_CLUSTER_SIZE,
    topology: 'hallway-cluster-junction',
    weight: 1,
    sockets: [
      socket('entry', 0, -HALL_CLUSTER_SIZE.depth * 0.5, 0, -1),
      socket('exit', 0, HALL_CLUSTER_SIZE.depth * 0.5, 0, 1, ['player', 'enemy'], {
        connectorFamilies: VERTICAL_CONNECTOR_FAMILIES,
      }),
      socket(
        'left',
        -HALL_CLUSTER_SIZE.width * 0.5,
        -HALL_CLUSTER_SIDE_DOOR_OFFSET,
        -1,
        0,
      ),
      socket(
        'right',
        HALL_CLUSTER_SIZE.width * 0.5,
        HALL_CLUSTER_SIDE_DOOR_OFFSET,
        1,
        0,
      ),
    ],
    structure: roomShellStructure(HALL_CLUSTER_SIZE, {
      floors: [{
        id: 'hallway-floor',
        role: 'corridor-floor',
        elevation: 0,
        width: HALL_CLUSTER_SIZE.width,
        depth: HALL_CLUSTER_SIZE.depth,
      }],
      hallwaySpines: [{
        id: 'main-hallway-spine',
        role: 'corridor-floor',
        localStart: { x: 0, y: 0, z: -HALL_CLUSTER_SIZE.depth * 0.5 },
        localEnd: { x: 0, y: 0, z: HALL_CLUSTER_SIZE.depth * 0.5 },
        widthMeters: 8.4,
        purpose: 'multi-door-hallway-spine',
      }],
      doorwayBays: [
        {
          id: 'encounter-door-bay',
          socketId: 'left',
          role: 'frame',
          localPosition: {
            x: -HALL_CLUSTER_SIZE.width * 0.5,
            y: 0,
            z: -HALL_CLUSTER_SIDE_DOOR_OFFSET,
          },
        },
        {
          id: 'reward-door-bay',
          socketId: 'right',
          role: 'frame',
          localPosition: {
            x: HALL_CLUSTER_SIZE.width * 0.5,
            y: 0,
            z: HALL_CLUSTER_SIDE_DOOR_OFFSET,
          },
        },
      ],
    }),
    anchors: [
      doorwayFrame('entry-frame', 0, -HALL_CLUSTER_SIZE.depth * 0.5, 0, -1),
      doorwayFrame('exit-frame', 0, HALL_CLUSTER_SIZE.depth * 0.5, 0, 1),
      doorwayFrame(
        'left-frame',
        -HALL_CLUSTER_SIZE.width * 0.5,
        -HALL_CLUSTER_SIDE_DOOR_OFFSET,
        -1,
        0,
      ),
      doorwayFrame(
        'right-frame',
        HALL_CLUSTER_SIZE.width * 0.5,
        HALL_CLUSTER_SIDE_DOOR_OFFSET,
        1,
        0,
      ),
      anchor('entry-light', 'light-fixture', 0, -11.2, {
        elevation: 7.2,
        assetRole: 'light-fixture',
      }),
      anchor('center-light', 'light-fixture', 0, 0, {
        elevation: 7.2,
        assetRole: 'light-fixture',
      }),
      anchor('exit-light', 'light-fixture', 0, 11.2, {
        elevation: 7.2,
        assetRole: 'light-fixture',
      }),
    ],
    requiredThemeCapabilities: {
      materials: ['corridor-floor', 'wall', 'ceiling', 'support', 'cap'],
      assets: ['frame', 'light-fixture'],
      connectors: ['service-gallery', ...VERTICAL_CONNECTOR_FAMILIES],
      transitions: [],
    },
    selectionConstraints: { hallwayClusterRole: 'junction', maximumRepeatsPerOperation: 1 },
  }),
  'supplement-hall-cluster-encounter-v1': grammar({
    id: 'supplement-hall-cluster-encounter-v1',
    size: SIDE_ROOM_SIZE,
    topology: 'lateral-encounter-room',
    weight: 1,
    sockets: [
      socket('entry', 0, -SIDE_ROOM_SIZE.depth * 0.5, 0, -1),
      socket('exit', 0, SIDE_ROOM_SIZE.depth * 0.5, 0, 1),
    ],
    structure: roomShellStructure(SIDE_ROOM_SIZE, {
      platforms: [{
        id: 'encounter-platform',
        role: 'catwalk',
        localCenterGrid: { x: 0, z: 2 },
        widthTiles: 3,
        depthTiles: 3,
        elevation: 1.35,
        platformPurpose: 'lateral_encounter_overlook',
      }],
      rails: [{ id: 'encounter-platform-rails', role: 'rail', platformId: 'encounter-platform' }],
    }),
    anchors: [
      doorwayFrame('entry-frame', 0, -SIDE_ROOM_SIZE.depth * 0.5, 0, -1),
      anchor('encounter', 'encounter', 0, 0, {
        encounterProfileId: 'supplement-lateral-defense',
      }),
      anchor('platform', 'platform', 0, 5.6, {
        elevation: 1.35,
        halfWidth: 4.2,
        halfDepth: 4.2,
        platformPurpose: 'lateral_encounter_overlook',
      }),
      anchor('light', 'light-fixture', 0, 0, { elevation: 7.2, assetRole: 'light-fixture' }),
    ],
    requiredThemeCapabilities: {
      materials: ['primary-floor', 'wall', 'ceiling', 'support', 'cap', 'catwalk', 'rail'],
      assets: ['frame', 'light-fixture'],
      connectors: ['service-gallery'],
      transitions: [],
    },
    selectionConstraints: { hallwayClusterRole: 'encounter', maximumRepeatsPerOperation: 1 },
  }),
  'supplement-hall-cluster-reward-v1': grammar({
    id: 'supplement-hall-cluster-reward-v1',
    size: SIDE_ROOM_SIZE,
    topology: 'lateral-reward-room',
    weight: 1,
    sockets: [
      socket('entry', 0, -SIDE_ROOM_SIZE.depth * 0.5, 0, -1),
      socket('exit', 0, SIDE_ROOM_SIZE.depth * 0.5, 0, 1),
    ],
    anchors: [
      doorwayFrame('entry-frame', 0, -SIDE_ROOM_SIZE.depth * 0.5, 0, -1),
      anchor('reward', 'reward', 0, 2.8, { rewardProfileId: 'supplement-treasure-cache' }),
      anchor('light', 'light-fixture', 0, 0, { elevation: 7.2, assetRole: 'light-fixture' }),
    ],
    requiredThemeCapabilities: {
      materials: ['primary-floor', 'wall', 'ceiling', 'support', 'cap'],
      assets: ['frame', 'light-fixture'],
      connectors: ['service-gallery'],
      transitions: [],
    },
    selectionConstraints: { hallwayClusterRole: 'reward', maximumRepeatsPerOperation: 1 },
  }),
  'supplement-hall-cluster-terminal-v1': grammar({
    id: 'supplement-hall-cluster-terminal-v1',
    size: TERMINAL_ROOM_SIZE,
    topology: 'elevated-terminal-trap-room',
    weight: 1,
    sockets: [
      socket('entry', 0, -TERMINAL_ROOM_SIZE.depth * 0.5, 0, -1, ['player', 'enemy'], {
        connectorFamilies: VERTICAL_CONNECTOR_FAMILIES,
      }),
      socket('exit', 0, TERMINAL_ROOM_SIZE.depth * 0.5, 0, 1),
    ],
    structure: roomShellStructure(TERMINAL_ROOM_SIZE, {
      platforms: [{
        id: 'terminal-overlook',
        role: 'catwalk',
        localCenterGrid: { x: 0, z: 2 },
        widthTiles: 3,
        depthTiles: 3,
        elevation: 2.8,
        platformPurpose: 'vertical_reward_overlook',
      }],
      ramps: [{
        id: 'terminal-overlook-ramp',
        role: 'ramp',
        localStartGrid: { x: -2, z: -3 },
        localEndGrid: { x: -2, z: 3 },
        fromElevation: 0,
        toElevation: 2.8,
      }],
      rails: [{ id: 'terminal-overlook-rails', role: 'rail', platformId: 'terminal-overlook' }],
    }),
    anchors: [
      doorwayFrame('entry-frame', 0, -TERMINAL_ROOM_SIZE.depth * 0.5, 0, -1),
      anchor('trap', 'trap', 0, 0, {
        assetRole: 'hazard',
        active: true,
        interactive: false,
        halfWidth: 3.2,
        halfDepth: 3.2,
        verticalHalfHeight: 1.4,
        damagePerSecond: 14,
        damagePerPulse: 4,
        hazardProfileId: 'supplement-terminal-pulse-field',
      }),
      anchor('platform', 'platform', 0, 5.6, {
        elevation: 2.8,
        halfWidth: 4.2,
        halfDepth: 4.2,
        platformPurpose: 'vertical_reward_overlook',
      }),
      anchor('light', 'light-fixture', 0, 0, { elevation: 10, assetRole: 'light-fixture' }),
    ],
    requiredThemeCapabilities: {
      materials: [
        'primary-floor', 'wall', 'ceiling', 'support', 'cap', 'catwalk', 'rail', 'ramp', 'warning',
      ],
      assets: ['frame', 'hazard', 'light-fixture'],
      connectors: [...VERTICAL_CONNECTOR_FAMILIES],
      transitions: [],
    },
    selectionConstraints: { hallwayClusterRole: 'terminal', maximumRepeatsPerOperation: 1 },
  }),
  'supplement-padding-through-chamber-v1': grammar({
    id: 'supplement-padding-through-chamber-v1',
    size: JUNCTION_SIZE,
    topology: 'padding-through-room',
    weight: 1,
    sockets: [
      socket('entry', 0, -JUNCTION_SIZE.depth * 0.5, 0, -1),
      socket('exit', 0, JUNCTION_SIZE.depth * 0.5, 0, 1),
    ],
    anchors: [
      doorwayFrame('entry-frame', 0, -JUNCTION_SIZE.depth * 0.5, 0, -1),
      doorwayFrame('exit-frame', 0, JUNCTION_SIZE.depth * 0.5, 0, 1),
      anchor('light', 'light-fixture', 0, 0, { elevation: 4.8, assetRole: 'light-fixture' }),
    ],
    requiredThemeCapabilities: {
      materials: ['primary-floor', 'wall', 'ceiling', 'support', 'cap'],
      assets: ['frame', 'light-fixture'],
      connectors: ['service-gallery'],
      transitions: [],
    },
    selectionConstraints: { paddingRole: 'through', maximumRepeatsPerOperation: 1 },
  }),
  // V4 keeps route decisions compact and connector-owned. Gameplay content
  // remains in the curated room-scale encounter, reward, and terminal forms.
  'supplement-route-connector-through-t-v1': routeNetworkConnectorModuleGrammar({
    id: 'supplement-route-connector-through-t-v1',
    size: { width: 14, height: 8.4, depth: 19.6 },
    topology: 'connector-through-t-junction',
    junctionKind: 'through-t',
  }),
  'supplement-route-connector-crossroads-v1': routeNetworkConnectorModuleGrammar({
    id: 'supplement-route-connector-crossroads-v1',
    size: { width: 19.6, height: 8.4, depth: 19.6 },
    topology: 'connector-crossroads-junction',
    junctionKind: 'crossroads',
  }),
  'supplement-route-connector-staggered-cross-v1': routeNetworkConnectorModuleGrammar({
    id: 'supplement-route-connector-staggered-cross-v1',
    size: { width: 14, height: 8.4, depth: 36.4 },
    topology: 'connector-staggered-cross-junction',
    junctionKind: 'staggered-cross',
  }),
  'supplement-route-connector-fork-merge-v1': routeNetworkConnectorModuleGrammar({
    id: 'supplement-route-connector-fork-merge-v1',
    size: { width: 14, height: 8.4, depth: 19.6 },
    topology: 'connector-fork-merge-junction',
    junctionKind: 'fork-merge',
  }),
  'supplement-route-connector-stacked-interchange-v1': routeNetworkConnectorModuleGrammar({
    id: 'supplement-route-connector-stacked-interchange-v1',
    size: { width: 19.6, height: 19.6, depth: 19.6 },
    topology: 'connector-stacked-interchange-junction',
    junctionKind: 'stacked-interchange',
    vertical: true,
  }),
  'supplement-route-connector-over-under-v1': routeNetworkConnectorModuleGrammar({
    id: 'supplement-route-connector-over-under-v1',
    size: { width: 19.6, height: 19.6, depth: 19.6 },
    topology: 'connector-over-under-crossover',
    junctionKind: 'over-under-crossover',
    vertical: true,
  }),
  // Legacy replay-only grammar. It is intentionally absent from the V4 pool,
  // whose planner and validator both reject endpoint vestibule nodes.
  'supplement-route-connector-endpoint-vestibule-v1': routeNetworkConnectorModuleGrammar({
    id: 'supplement-route-connector-endpoint-vestibule-v1',
    size: { width: 8.4, height: 8.4, depth: 8.4 },
    topology: 'connector-endpoint-vestibule',
    junctionKind: 'endpoint-vestibule',
    endpoint: true,
  }),
  // V4 resolves every corridor and room from the authored blueprint catalog.
  // This spread intentionally comes last so the six historical V4 placeholder
  // shells above retain their public grammar ids while gaining exact masks,
  // tiers, sockets, and transfer contracts. V1-V3 pools never reference these
  // records and therefore remain replay-stable.
  ...INDUSTRIAL_SUPPLEMENT_BLUEPRINT_GRAMMARS,
});

export function createDungeonAugmentationProfile(input = {}) {
  const profile = {
    schema: DUNGEON_AUGMENTATION_PROFILE_SCHEMA,
    id: String(input.id ?? ''),
    revision: Number(input.revision ?? 1),
    enabled: input.enabled !== false,
    operationBudget: {
      optionalBranchCount: Number(input.operationBudget?.optionalBranchCount ?? 1),
      optionalBranchRooms: [
        Number(input.operationBudget?.optionalBranchRooms?.[0] ?? 1),
        Number(input.operationBudget?.optionalBranchRooms?.[1] ?? 2),
      ],
      edgePaddingCount: Number(input.operationBudget?.edgePaddingCount ?? 1),
      edgePaddingRooms: [
        Number(input.operationBudget?.edgePaddingRooms?.[0] ?? 1),
        Number(input.operationBudget?.edgePaddingRooms?.[1] ?? 2),
      ],
      minimumTotalRooms: Number(input.operationBudget?.minimumTotalRooms ?? 2),
      maximumTotalRooms: Number(input.operationBudget?.maximumTotalRooms ?? 4),
    },
    requiredOperations: {
      optionalBranch: input.requiredOperations?.optionalBranch !== false,
      edgePadding: input.requiredOperations?.edgePadding !== false,
    },
    grammarPool: (input.grammarPool ?? [
      { id: 'supplement-chamber-compact-v1', weight: 4 },
      { id: 'supplement-gallery-bay-v1', weight: 3 },
      { id: 'supplement-junction-v1', weight: 1 },
    ]).map((entry) => ({ id: String(entry.id), weight: Number(entry.weight ?? 1) })),
    connectorFamilies: [...(input.connectorFamilies ?? ['service-gallery'])],
    connectorGapMeters: Number(input.connectorGapMeters ?? 2.8),
    branchTopology: String(input.branchTopology ?? 'out-and-back'),
    allowDelegatedProgression: input.allowDelegatedProgression === true,
    maximumPlanningAttempts: Math.max(1, Number(input.maximumPlanningAttempts ?? 12)),
  };
  if (Array.isArray(input.paddingGrammarPool)) {
    profile.paddingGrammarPool = input.paddingGrammarPool.map((entry) => ({
      id: String(entry.id),
      weight: Number(entry.weight ?? 1),
    }));
  }
  if (Array.isArray(input.verticalConnectorFamilies)) {
    profile.verticalConnectorFamilies = [...new Set(input.verticalConnectorFamilies.map(String))];
  }
  if (Number.isFinite(Number(input.verticalConnectorGapMeters))) {
    profile.verticalConnectorGapMeters = Number(input.verticalConnectorGapMeters);
  }
  if (input.verticalConnectorGapMetersByFamily && typeof input.verticalConnectorGapMetersByFamily === 'object') {
    profile.verticalConnectorGapMetersByFamily = Object.fromEntries(
      Object.entries(input.verticalConnectorGapMetersByFamily)
        .filter(([, value]) => Number.isFinite(Number(value)))
        .map(([family, value]) => [family, Number(value)]),
    );
  }
  if (input.requiredFeatures && typeof input.requiredFeatures === 'object') {
    profile.requiredFeatures = Object.fromEntries(Object.entries(input.requiredFeatures)
      .map(([key, value]) => [key, Math.max(0, Number(value) || 0)]));
  }
  if (input.allowEdgePaddingFallback === true) {
    profile.allowEdgePaddingFallback = true;
  }
  if (input.hallwayGuarantee && typeof input.hallwayGuarantee === 'object') {
    profile.hallwayGuarantee = {
      corridorOriented: input.hallwayGuarantee.corridorOriented !== false,
      minimumLengthMeters: Number(input.hallwayGuarantee.minimumLengthMeters ?? 0),
      minimumDoorwayCount: Number(input.hallwayGuarantee.minimumDoorwayCount ?? 0),
      minimumSideDoorSeparationMeters: Number(
        input.hallwayGuarantee.minimumSideDoorSeparationMeters ?? 0,
      ),
    };
  }
  if (input.routeNetworkPlanning && typeof input.routeNetworkPlanning === 'object') {
    profile.routeNetworkPlanning = {
      enabled: input.routeNetworkPlanning.enabled !== false,
      allowPartialRouteNetworkRealization:
        input.routeNetworkPlanning.allowPartialRouteNetworkRealization === true,
      partialUsefulRequiredNetworkCount: Math.min(
        8,
        Math.max(
          1,
          Math.floor(Number(
            input.routeNetworkPlanning.partialUsefulRequiredNetworkCount ?? 2,
          ) || 2),
        ),
      ),
      partialRequiredCandidateLimit: Math.max(
        1,
        Math.floor(Number(
          input.routeNetworkPlanning.partialRequiredCandidateLimit ?? 12,
        ) || 12),
      ),
      partialLandmarkCandidateLimit: Math.min(
        24,
        Math.max(
          1,
          Math.floor(Number(
            input.routeNetworkPlanning.partialLandmarkCandidateLimit ?? 24,
          ) || 24),
        ),
      ),
      maximumFeaturelessSpanMeters: Number(
        input.routeNetworkPlanning.maximumFeaturelessSpanMeters ?? 33.6,
      ),
      minimumModulesPerNetwork: Number(
        input.routeNetworkPlanning.minimumModulesPerNetwork ?? 3,
      ),
      maximumModulesPerNetwork: Number(
        input.routeNetworkPlanning.maximumModulesPerNetwork ?? 6,
      ),
      maximumNetworkCount: Number(input.routeNetworkPlanning.maximumNetworkCount ?? 8),
      maximumTotalModules: Number(input.routeNetworkPlanning.maximumTotalModules ?? 30),
      requiredPyramidLoopCount: Number(
        input.routeNetworkPlanning.requiredPyramidLoopCount ?? 1,
      ),
      topologyTemplates: [...(input.routeNetworkPlanning.topologyTemplates ?? [])].map(String),
      junctionKinds: [...(input.routeNetworkPlanning.junctionKinds ?? [])].map(String),
      elevationModes: [...(input.routeNetworkPlanning.elevationModes ?? [])].map(String),
      localProgressionArc: [...(input.routeNetworkPlanning.localProgressionArc ?? [
        'enter', 'challenge', 'mechanism', 'payoff', 'reconnect',
      ])].map(String),
    };
  }
  return deepFreezeDungeonAugmentationValue(profile);
}

export const INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE = createDungeonAugmentationProfile({
  id: 'industrial-supplement-preview-v1',
  revision: 1,
  operationBudget: {
    optionalBranchCount: 1,
    optionalBranchRooms: [1, 2],
    edgePaddingCount: 1,
    edgePaddingRooms: [1, 2],
    minimumTotalRooms: 2,
    maximumTotalRooms: 4,
  },
  requiredOperations: { optionalBranch: true, edgePadding: true },
  allowDelegatedProgression: false,
});

// Keep v1 immutable for committed expedition reconstruction. The current
// preview raises the visible delta without broadening the sidecar's authority:
// Industrial still owns every authored room and progression beat, while the
// supplement must realize a two-room exploration branch plus route padding.
export const INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE = createDungeonAugmentationProfile({
  id: 'industrial-supplement-preview-v2',
  revision: 2,
  operationBudget: {
    optionalBranchCount: 1,
    optionalBranchRooms: [2, 2],
    edgePaddingCount: 1,
    edgePaddingRooms: [1, 2],
    minimumTotalRooms: 3,
    maximumTotalRooms: 4,
  },
  requiredOperations: { optionalBranch: true, edgePadding: true },
  allowDelegatedProgression: false,
  // Three grid cells leave at least two truly exterior corridor cells between
  // room boundary sockets after Industrial's integer-grid materialization.
  // This guarantees the branch is a visible, measurable gallery instead of
  // two adjacent doorway cells with no place to validate or dress the route.
  connectorGapMeters: 8.4,
  maximumPlanningAttempts: 64,
});

export const INDUSTRIAL_SUPPLEMENT_PREVIEW_V3_PROFILE = createDungeonAugmentationProfile({
  id: 'industrial-supplement-preview-v3',
  revision: 3,
  operationBudget: {
    optionalBranchCount: 1,
    optionalBranchRooms: [4, 4],
    edgePaddingCount: 1,
    edgePaddingRooms: [1, 1],
    minimumTotalRooms: 4,
    maximumTotalRooms: 5,
  },
  requiredOperations: { optionalBranch: true, edgePadding: false },
  grammarPool: [
    { id: 'supplement-hall-cluster-junction-v1', weight: 1 },
    { id: 'supplement-hall-cluster-encounter-v1', weight: 1 },
    { id: 'supplement-hall-cluster-reward-v1', weight: 1 },
    { id: 'supplement-hall-cluster-terminal-v1', weight: 1 },
  ],
  paddingGrammarPool: [
    { id: 'supplement-padding-through-chamber-v1', weight: 1 },
  ],
  connectorFamilies: ['service-gallery'],
  verticalConnectorFamilies: VERTICAL_CONNECTOR_FAMILIES,
  // Two cells separate perimeter volumes because Industrial attachment
  // sockets sit at boundary-tile centers, while grammar volumes extend to
  // their geometric wall plane. A one-cell gap can make a side room overlap
  // the parent room by half a tile even when the doorway itself is valid.
  connectorGapMeters: 5.6,
  // Ladders and lifts retain the compact sixteen-cell gallery. Slopes receive
  // eighteen cells so thirteen remain usable after the authored contract
  // reserves two flat threshold cells at each end.
  verticalConnectorGapMeters: 44.8,
  verticalConnectorGapMetersByFamily: { slope: 50.4 },
  branchTopology: 'hallway-cluster-v1',
  hallwayGuarantee: {
    corridorOriented: true,
    minimumLengthMeters: 30.8,
    minimumDoorwayCount: 4,
    minimumSideDoorSeparationMeters: 16.8,
  },
  // The hallway cluster is the required exploration delta. Padding remains a
  // preferred fifth room, but some authored corridor networks have no
  // collision-safe insertion point; in that case retain the complete cluster
  // instead of discarding all four useful rooms.
  allowEdgePaddingFallback: true,
  requiredFeatures: {
    sideRoomCount: 2,
    elevationTransferCount: 1,
    encounterCount: 1,
    rewardCount: 1,
    trapCount: 1,
    platformRoomCount: 1,
  },
  allowDelegatedProgression: false,
  maximumPlanningAttempts: 96,
});

export const INDUSTRIAL_SUPPLEMENT_PREVIEW_V4_PROFILE = createDungeonAugmentationProfile({
  id: 'industrial-supplement-preview-v4',
  revision: 5,
  operationBudget: {
    optionalBranchCount: 0,
    optionalBranchRooms: [0, 0],
    edgePaddingCount: 0,
    edgePaddingRooms: [0, 0],
    minimumTotalRooms: 0,
    maximumTotalRooms: 30,
  },
  requiredOperations: { optionalBranch: false, edgePadding: false },
  grammarPool: INDUSTRIAL_SUPPLEMENT_BLUEPRINT_GRAMMAR_POOL,
  connectorFamilies: ['service-gallery'],
  verticalConnectorFamilies: VERTICAL_CONNECTOR_FAMILIES,
  connectorGapMeters: 5.6,
  allowDelegatedProgression: false,
  maximumPlanningAttempts: 1,
  routeNetworkPlanning: {
    enabled: true,
    // V4 is a sidecar supplement to the accepted authored dungeon. A route
    // network that cannot be realized is omitted with an explicit ledger
    // entry; independently valid networks remain applied.
    allowPartialRouteNetworkRealization: true,
    // Seed001 demonstrates that landmark + objective coverage completes well
    // inside the release budget, while forcing a third retained network does
    // not. Both semantic kinds remain mandatory for early partial acceptance.
    partialUsefulRequiredNetworkCount: 2,
    // Preserve the original bounded search domain for ordinary required
    // grants. Dense multi-station coverage remains capped at eight by the
    // planner; all other required grants may inspect at most twelve.
    partialRequiredCandidateLimit: 12,
    partialLandmarkCandidateLimit: 24,
    maximumFeaturelessSpanMeters: 33.6,
    minimumModulesPerNetwork: 3,
    maximumModulesPerNetwork: 6,
    maximumNetworkCount: 8,
    maximumTotalModules: 30,
    requiredPyramidLoopCount: 1,
    topologyTemplates: [
      'parallel-gallery-loop',
      'fork-merge-h-loop',
      'multi-door-room-chain',
      'split-level-ring',
      'stacked-interchange',
      'over-under-loop',
    ],
    junctionKinds: [
      'through-t',
      'crossroads',
      'staggered-cross',
      'fork-merge',
      'stacked-interchange',
      'over-under-crossover',
    ],
    elevationModes: [
      'slope',
      'ladder',
      'lift',
      'split-level-platform',
      'shortcut-lift',
      'drop-ladder',
    ],
    localProgressionArc: ['enter', 'challenge', 'mechanism', 'payoff', 'reconnect'],
  },
});

export const DUNGEON_AUGMENTATION_PROFILES = deepFreezeDungeonAugmentationValue({
  [INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE.id]: INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE,
  [INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE.id]: INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE,
  [INDUSTRIAL_SUPPLEMENT_PREVIEW_V3_PROFILE.id]: INDUSTRIAL_SUPPLEMENT_PREVIEW_V3_PROFILE,
  [INDUSTRIAL_SUPPLEMENT_PREVIEW_V4_PROFILE.id]: INDUSTRIAL_SUPPLEMENT_PREVIEW_V4_PROFILE,
});
