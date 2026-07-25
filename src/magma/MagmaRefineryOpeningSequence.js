import * as THREE from 'three';
import {
  assembleMagmaRefineryOpeningRoom,
  createMagmaRefineryOpeningPlan,
  MAGMA_REFINERY_OPENING_MODULE_ID,
} from './MagmaRefineryOpeningRoom.js';
import {
  assembleMagmaLinearDiggerExcavationRoom,
  createMagmaLinearDiggerExcavationPlan,
  MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
} from './MagmaLinearDiggerExcavationRoom.js';

export const MAGMA_REFINERY_OPENING_SEQUENCE_ID = 'magma-refinery-opening-sequence';

const TILE_SIZE = 2.8;
const LINEAR_OFFSET_TILES = Object.freeze({ x: 9, z: -29 });
const OPENING_DEEPER_SOCKET_ID = 'opening-deeper-socket';
const LINEAR_ENTRY_SOCKET_ID = 'linear-excavation-entry-socket';
const LINEAR_ENTRY_FRAME_ID = `${LINEAR_ENTRY_SOCKET_ID}-frame`;
const LAVA_CONTINUITY_TAG = 'magma-refinery-lava-spine';

function transformTileX(x) {
  return LINEAR_OFFSET_TILES.x - x;
}

function transformTileZ(z) {
  return LINEAR_OFFSET_TILES.z + z;
}

function transformVector(vector) {
  if (!vector) return vector;
  return new THREE.Vector3(
    LINEAR_OFFSET_TILES.x * TILE_SIZE - vector.x,
    vector.y,
    LINEAR_OFFSET_TILES.z * TILE_SIZE + vector.z,
  );
}

function transformFacing(facing) {
  if (!facing) return facing;
  return new THREE.Vector3(-facing.x, facing.y ?? 0, facing.z);
}

function transformFloorTile(tile) {
  return {
    ...tile,
    x: transformTileX(tile.x),
    z: transformTileZ(tile.z),
    ...(Number.isFinite(tile.rampDirectionX)
      ? { rampDirectionX: -tile.rampDirectionX }
      : {}),
  };
}

function transformRampLanding(landing) {
  return {
    ...landing,
    minX: transformTileX(landing.maxX),
    maxX: transformTileX(landing.minX),
    minZ: transformTileZ(landing.minZ),
    maxZ: transformTileZ(landing.maxZ),
    clearWidthMeters: Number(landing.clearWidthMeters.toFixed(6)),
    clearDepthMeters: Number(landing.clearDepthMeters.toFixed(6)),
  };
}

function transformSocketFrame(frame) {
  return {
    ...frame,
    x: transformTileX(frame.x),
    z: transformTileZ(frame.z),
    facingX: -frame.facingX,
  };
}

function transformZone(zone, prefix = '') {
  return {
    ...zone,
    id: `${prefix}${zone.id}`,
    position: transformVector(zone.position),
  };
}

function transformPositionRecord(record) {
  return {
    ...record,
    position: transformVector(record.position),
  };
}

function transformEncounter(encounter) {
  return {
    ...encounter,
    zone: encounter.zone
      ? { ...encounter.zone, position: transformVector(encounter.zone.position) }
      : encounter.zone,
    triggerZone: encounter.triggerZone
      ? { ...encounter.triggerZone, position: transformVector(encounter.triggerZone.position) }
      : encounter.triggerZone,
    spawnPoints: encounter.spawnPoints.map(transformVector),
    enemyIds: [...encounter.enemyIds],
  };
}

function transformRoom(room) {
  const previewAnchors = room.previewAnchors
    ? Object.fromEntries(Object.entries(room.previewAnchors).map(([id, anchor]) => ([id, {
      ...anchor,
      x: transformTileX(anchor.x),
      z: transformTileZ(anchor.z),
      facingX: -anchor.facingX,
    }])))
    : undefined;
  return {
    ...room,
    x: transformTileX(room.x),
    z: transformTileZ(room.z),
    previewPosition: room.previewPosition
      ? {
        ...room.previewPosition,
        x: transformTileX(room.previewPosition.x),
        z: transformTileZ(room.previewPosition.z),
      }
      : room.previewPosition,
    previewFacing: room.previewFacing
      ? { ...room.previewFacing, x: -room.previewFacing.x }
      : room.previewFacing,
    ...(previewAnchors ? { previewAnchors } : {}),
  };
}

function transformMinimapRoom(room) {
  return {
    ...room,
    x: transformTileX(room.x),
    z: transformTileZ(room.z),
  };
}

function isDuplicateLinearSeamTile(tile) {
  if (tile.z !== 17) return false;
  return (tile.surface === 'deepMagma' && (tile.x === 6 || tile.x === 7))
    || (tile.surface !== 'deepMagma' && tile.x >= -1 && tile.x <= 1);
}

function hideDuplicateLinearSeamInstances(group, linearPlan) {
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const hideIndices = (meshName, tiles, predicate) => {
    const mesh = group.getObjectByName(meshName);
    if (!mesh?.isInstancedMesh) return;
    tiles.forEach((tile, index) => {
      if (predicate(tile)) mesh.setMatrixAt(index, zero);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  const ordinaryFloors = linearPlan.floorTiles.filter((tile) => (
    tile.surfaceRole !== 'ramp'
      && tile.surface !== 'deepMagma'
      && tile.surfaceRole !== 'bridge'
      && tile.surface !== 'ancientCeramicFloor'
  ));
  hideIndices(
    'linearExcavationBoredBasaltFloors',
    ordinaryFloors,
    (tile) => tile.z === 17 && tile.x >= -1 && tile.x <= 1,
  );
  hideIndices(
    'linearExcavationLavaTiles',
    linearPlan.floorTiles.filter((tile) => tile.surface === 'deepMagma'),
    (tile) => tile.z === 17 && (tile.x === 6 || tile.x === 7),
  );
}

function mergeSupportDiagnostics(opening, linear) {
  return {
    structuralSupportCount:
      (opening.supportDiagnostics?.structuralSupportCount ?? 0)
      + (linear.supportDiagnostics?.structuralSupportCount ?? 0),
    structuralFoundationCount: opening.supportDiagnostics?.structuralFoundationCount ?? 0,
    undercroftFloorCount: opening.supportDiagnostics?.undercroftFloorCount ?? 0,
    supportDatumViolationCount:
      (opening.supportDiagnostics?.supportDatumViolationCount ?? 0)
      + (linear.supportDiagnostics?.supportDatumViolationCount ?? 0),
    unresolvedElevatedFootprintCount:
      (opening.supportDiagnostics?.unresolvedElevatedFootprintCount ?? 0)
      + (linear.supportDiagnostics?.unresolvedElevatedFootprintCount ?? 0),
  };
}

function buildTiles(opening, linear) {
  const tiles = new Map();
  for (const tile of opening.tiles.values()) tiles.set(`${tile.x},${tile.z}`, { ...tile });
  for (const tile of linear.tiles.values()) {
    if (isDuplicateLinearSeamTile(tile)) continue;
    const transformed = transformFloorTile(tile);
    tiles.set(`${transformed.x},${transformed.z}`, transformed);
  }
  return tiles;
}

export function generateMagmaRefineryOpeningSequence({
  seed = 'magma-refinery-opening-sequence-default',
  random = null,
  tileSize = TILE_SIZE,
  textureLoader = new THREE.TextureLoader(),
} = {}) {
  if (Math.abs(tileSize - TILE_SIZE) > 0.0001) {
    throw new Error(`Magma opening sequence requires the shared ${TILE_SIZE} m macro tile.`);
  }

  const openingPlan = createMagmaRefineryOpeningPlan({
    seed: `${seed}:opening`,
    random,
    tileSize,
  });
  const linearPlan = createMagmaLinearDiggerExcavationPlan({
    seed: `${seed}:linear`,
    random,
    tileSize,
  });
  const opening = assembleMagmaRefineryOpeningRoom(openingPlan, {
    textureLoader,
    connectedSocketIds: [OPENING_DEEPER_SOCKET_ID],
  });
  const linear = assembleMagmaLinearDiggerExcavationRoom(linearPlan, {
    textureLoader,
    omittedSocketFrameIds: [LINEAR_ENTRY_FRAME_ID],
  });

  hideDuplicateLinearSeamInstances(linear.group, linearPlan);
  linear.group.scale.x = -1;
  linear.group.position.set(
    LINEAR_OFFSET_TILES.x * TILE_SIZE,
    0,
    LINEAR_OFFSET_TILES.z * TILE_SIZE,
  );
  linear.group.userData.sequenceTransform = {
    mirrorX: true,
    offsetTiles: { ...LINEAR_OFFSET_TILES },
  };

  const group = new THREE.Group();
  group.name = 'magmaRefineryOpeningSequence';
  group.userData.roomModuleId = MAGMA_REFINERY_OPENING_SEQUENCE_ID;
  group.userData.themePackId = opening.themePackId;
  group.userData.proceduralRoom = true;
  group.userData.authoredOwnedMaterials = new Set([
    ...(opening.group.userData.authoredOwnedMaterials ?? []),
    ...(linear.group.userData.authoredOwnedMaterials ?? []),
  ]);
  group.add(opening.group, linear.group);

  const transformedLinearFloorTiles = linear.floorTiles
    .filter((tile) => !isDuplicateLinearSeamTile(tile))
    .map(transformFloorTile);
  const floorTiles = [
    ...opening.floorTiles.map((tile) => ({ ...tile })),
    ...transformedLinearFloorTiles,
  ];
  const transformedLinearRoom = transformRoom(linear.rooms[0]);
  const openingRoom = {
    ...opening.rooms[0],
    previewAnchors: {
      ...(opening.rooms[0].previewAnchors ?? {}),
      shellBoundaryCrossing: { x: 8, y: 0, z: -4, facingX: 0, facingZ: -1 },
      excavationThreshold: { x: 9, y: 0, z: -11, facingX: 0, facingZ: -1 },
    },
  };
  const transformedLinearFrames = linear.socketFrames
    .filter((frame) => frame.id !== LINEAR_ENTRY_FRAME_ID)
    .map(transformSocketFrame);
  const solidZones = [
    ...opening.solidZones,
    ...linear.solidZones.map((zone) => transformZone(zone, 'linear/')),
  ];
  const aerialBoundaryZones = [
    ...opening.aerialBoundaryZones,
    ...linear.aerialBoundaryZones.map((zone) => transformZone(zone, 'linear/')),
  ];
  const transformedLinearTraps = linear.traps
    .filter((trap) => !/_6_17$|_7_17$/.test(trap.id))
    .map(transformPositionRecord);
  const transformedLinearEncounters = linear.encounters.map(transformEncounter);
  const transformedLinearChests = linear.chests.map((chest) => ({
    ...chest,
    position: transformVector(chest.position),
  }));
  const transformedLinearMinimapRooms = linear.minimap.rooms.map(transformMinimapRoom);
  const supportDiagnostics = mergeSupportDiagnostics(opening, linear);
  const connectionPlan = {
    id: 'opening-to-linear-excavation',
    connectorId: 'opening-to-linear-excavation',
    connectorType: 'authored-socket-seam',
    fromRoomId: MAGMA_REFINERY_OPENING_MODULE_ID,
    toRoomId: MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
    sourceSocketId: OPENING_DEEPER_SOCKET_ID,
    destinationSocketId: LINEAR_ENTRY_SOCKET_ID,
    direction: 'level',
    sourceElevation: 0,
    destinationElevation: 0,
    elevationDelta: 0,
    widthTiles: 3,
    clearWidthMeters: 8.4,
    routes: [{ sourceElevation: 0, destinationElevation: 0 }],
  };
  const playerSocketAlignment = {
    sourceSocketId: OPENING_DEEPER_SOCKET_ID,
    destinationSocketId: LINEAR_ENTRY_SOCKET_ID,
    centerOffsetMeters: 0,
    elevationOffsetMeters: 0,
    widthOffsetMeters: 0,
    facingDot: -1,
    accepted: true,
  };
  const lavaSocketAlignment = {
    sourceSocketId: 'opening-lava-continuity-socket',
    destinationSocketId: 'linear-excavation-lava-inlet',
    continuityTag: LAVA_CONTINUITY_TAG,
    centerOffsetMeters: 0,
    elevationOffsetMeters: 0,
    widthOffsetMeters: 0,
    facingDot: -1,
    accepted: true,
  };
  const minimap = {
    rooms: [...opening.minimap.rooms, ...transformedLinearMinimapRooms],
    connections: [
      ...opening.minimap.connections,
      {
        id: connectionPlan.id,
        from: MAGMA_REFINERY_OPENING_MODULE_ID,
        to: 'surveyMouth',
        elevationDelta: 0,
      },
      ...linear.minimap.connections,
    ],
    environmentalSpines: [{
      id: LAVA_CONTINUITY_TAG,
      inletSocketId: 'opening-lava-continuity-socket',
      outletSocketId: 'linear-excavation-lava-outlet',
      active: true,
    }],
  };
  const progression = {
    entranceRoomId: MAGMA_REFINERY_OPENING_MODULE_ID,
    bands: [
      { bandId: 'opening', roomIds: [MAGMA_REFINERY_OPENING_MODULE_ID] },
      { bandId: 'linear-excavation', roomIds: [MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID] },
    ],
    roomConnections: [{
      connectorId: connectionPlan.id,
      fromRoomId: MAGMA_REFINERY_OPENING_MODULE_ID,
      toRoomId: MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
      doorId: null,
      shortcut: false,
    }],
    doors: [],
    keycards: [],
    shrineKey: null,
    validation: {
      accepted: true,
      errors: [],
      warnings: ['Two-module development sequence; later Magma modules are not yet attached.'],
    },
  };
  const boundsRadius = Math.max(...floorTiles.map((tile) => (
    Math.hypot(tile.x * TILE_SIZE, tile.z * TILE_SIZE)
  ))) + 18;
  const planHash = `${MAGMA_REFINERY_OPENING_SEQUENCE_ID}:${opening.planHash}:${linear.planHash}`;

  return {
    group,
    dungeonKind: 'magmaRefineryOpeningSequenceDevelopmentFixture',
    dungeonFamilyId: 'industrial-v1',
    themePackId: opening.themePackId,
    developmentFixture: true,
    rooms: [openingRoom, transformedLinearRoom],
    roomModuleIds: [MAGMA_REFINERY_OPENING_MODULE_ID, MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID],
    tiles: buildTiles(opening, linear),
    floorTiles,
    rampLandings: [
      ...opening.rampLandings.map((landing) => ({ ...landing })),
      ...linear.rampLandings.map(transformRampLanding),
    ],
    socketFrames: [
      ...opening.socketFrames.map((frame) => ({ ...frame })),
      ...transformedLinearFrames,
    ],
    verticalConnectors: [...opening.verticalConnectors, ...linear.verticalConnectors],
    connectionPlans: [connectionPlan],
    progression,
    minimap,
    doors: [],
    keycards: [],
    keySeeker: null,
    chests: [...opening.chests, ...transformedLinearChests],
    mechanisms: [],
    ladders: [],
    connectorLifts: [],
    puzzleBlocks: [],
    pressurePlates: [],
    conveyorPuzzles: [],
    platforms: [
      ...opening.platforms,
      ...linear.platforms.map(transformPositionRecord),
    ],
    npcAnimationMixers: [],
    npcAnimators: [],
    safeInteractables: [],
    safeZones: [],
    solidZones,
    aerialBoundaryZones,
    encounters: [...opening.encounters, ...transformedLinearEncounters],
    traps: [...opening.traps, ...transformedLinearTraps],
    conveyors: [],
    shrine: null,
    tileSize: TILE_SIZE,
    playerStart: opening.playerStart.clone(),
    playerStartFacing: opening.playerStartFacing.clone(),
    campReturnPosition: opening.campReturnPosition.clone(),
    ruinEntryPosition: opening.ruinEntryPosition.clone(),
    enemySpawnPoints: transformedLinearEncounters.flatMap((encounter) => (
      encounter.spawnPoints.map((position) => position.clone())
    )),
    shrinePosition: null,
    boundsRadius,
    renderCullGroups: [],
    specialEnvironment: null,
    specialEnvironmentId: null,
    environmentalHazards: [{
      id: LAVA_CONTINUITY_TAG,
      kind: 'deepMagma',
      damagePerSecond: 24,
      movementMultiplier: 0.55,
      inletSocketId: 'opening-lava-continuity-socket',
      outletSocketId: 'linear-excavation-lava-outlet',
      continuityTag: LAVA_CONTINUITY_TAG,
    }],
    supportDiagnostics,
    moduleManifestDiagnostics: {
      accepted: true,
      schema: 'ruindivex-authored-sequence/v1',
      moduleId: MAGMA_REFINERY_OPENING_SEQUENCE_ID,
      planHash,
      authoredRoomAssetDependency: false,
      textureTiling: opening.moduleManifestDiagnostics.textureTiling,
      safeRequiredRoute: true,
      criticalPathEncounterLocked: false,
      untexturedVoidCellCount: 0,
      exteriorVoidVisible: false,
      rockInfillCellCount: opening.moduleManifestDiagnostics.rockInfillCellCount,
      jumpAirGapMeters: opening.moduleManifestDiagnostics.jumpAirGapMeters,
      maximumPlayerJumpMeters: opening.moduleManifestDiagnostics.maximumPlayerJumpMeters,
      socketFrameAlignment: opening.moduleManifestDiagnostics.socketFrameAlignment,
      sequenceSocketAlignment: {
        accepted: true,
        player: playerSocketAlignment,
        lava: lavaSocketAlignment,
      },
      moduleDiagnostics: {
        opening: opening.moduleManifestDiagnostics,
        linearExcavation: linear.moduleManifestDiagnostics,
      },
      supportResolution: {
        accepted: supportDiagnostics.supportDatumViolationCount === 0,
        ...supportDiagnostics,
      },
    },
    spatialGenerationDiagnostics: {
      contractId: 'ruindivex-dungeon-generation/v2-authored-sequence',
      accepted: true,
      errors: [],
      warnings: ['Two-module development sequence; dungeon-wide connector-family coverage is not evaluated.'],
      roomCount: 2,
      floorTileCount: floorTiles.length,
      signedConnectorCount: linear.verticalConnectors.length,
      elevationRange: { min: -14, max: 5.6, span: 19.6 },
    },
    planHash,
  };
}
