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
import {
  assembleMagmaRefractorAssayLabRoom,
  createMagmaRefractorAssayLabPlan,
  MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
} from './MagmaRefractorAssayLabRoom.js';

export const MAGMA_REFINERY_OPENING_SEQUENCE_ID = 'magma-refinery-opening-sequence';

const TILE_SIZE = 2.8;
const LINEAR_OFFSET_TILES = Object.freeze({ x: 9, z: -29 });
const ASSAY_OFFSET_TILES = Object.freeze({ x: 5, z: -66 });
const ASSAY_BASE_ELEVATION = -14;
const OPENING_DEEPER_SOCKET_ID = 'opening-deeper-socket';
const LINEAR_ENTRY_SOCKET_ID = 'linear-excavation-entry-socket';
const LINEAR_ENTRY_FRAME_ID = `${LINEAR_ENTRY_SOCKET_ID}-frame`;
const LINEAR_ASSAY_SOCKET_ID = 'linear-excavation-assay-socket';
const LINEAR_ASSAY_FRAME_ID = `${LINEAR_ASSAY_SOCKET_ID}-frame`;
const ASSAY_ENTRY_SOCKET_ID = 'assay-lab-entry-socket';
const ASSAY_LAVA_INLET_SOCKET_ID = 'assay-lab-lava-inlet';
const LAVA_CONTINUITY_TAG = 'magma-refinery-lava-spine';
const LINEAR_ASSAY_RAMP_EXIT_WALL_OMISSIONS = Object.freeze([
  // Flight B ends against the standalone Linear room's west boundary. In the
  // combined sequence the Assay approach continues directly beyond this
  // three-wide landing, so retaining these panels creates a full-height wall
  // and matching collider across the otherwise continuous floor.
  '-8,-23:west',
  '-8,-22:west',
  '-8,-21:west',
]);
const ASSAY_LINEAR_RAMP_SEAM_WALL_OMISSIONS = Object.freeze([
  // The Assay lava inlet overlaps the still-descending middle of Linear
  // flight B in the combined layout. These three west faces used to become
  // one full-height invisible collider across all ramp lanes.
  '-1,14:west',
  '-1,15:west',
  '-1,16:west',
  '0,14:east',
  '0,15:east',
  '0,16:east',
  // The dry approach joins the Linear end landing farther east.
  '8,14:west',
  '8,15:west',
  '8,16:west',
]);

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

function transformAssayTileX(x) {
  return ASSAY_OFFSET_TILES.x + x;
}

function transformAssayTileZ(z) {
  return ASSAY_OFFSET_TILES.z + z;
}

function transformAssayVector(vector) {
  if (!vector) return vector;
  return new THREE.Vector3(
    ASSAY_OFFSET_TILES.x * TILE_SIZE + vector.x,
    vector.y,
    ASSAY_OFFSET_TILES.z * TILE_SIZE + vector.z,
  );
}

function transformAssayFloorTile(tile) {
  return {
    ...tile,
    x: transformAssayTileX(tile.x),
    z: transformAssayTileZ(tile.z),
  };
}

function transformAssayRampLanding(landing) {
  return {
    ...landing,
    minX: transformAssayTileX(landing.minX),
    maxX: transformAssayTileX(landing.maxX),
    minZ: transformAssayTileZ(landing.minZ),
    maxZ: transformAssayTileZ(landing.maxZ),
    clearWidthMeters: Number(landing.clearWidthMeters.toFixed(6)),
    clearDepthMeters: Number(landing.clearDepthMeters.toFixed(6)),
  };
}

function transformAssaySocketFrame(frame) {
  return {
    ...frame,
    x: transformAssayTileX(frame.x),
    z: transformAssayTileZ(frame.z),
  };
}

function transformAssayZone(zone, prefix = '') {
  return {
    ...zone,
    id: `${prefix}${zone.id}`,
    position: transformAssayVector(zone.position),
  };
}

function transformAssayPositionRecord(record) {
  return {
    ...record,
    position: transformAssayVector(record.position),
  };
}

function transformAssayEncounter(encounter) {
  return {
    ...encounter,
    zone: encounter.zone
      ? { ...encounter.zone, position: transformAssayVector(encounter.zone.position) }
      : encounter.zone,
    triggerZone: encounter.triggerZone
      ? { ...encounter.triggerZone, position: transformAssayVector(encounter.triggerZone.position) }
      : encounter.triggerZone,
    spawnPoints: encounter.spawnPoints.map(transformAssayVector),
    enemyIds: [...encounter.enemyIds],
  };
}

function transformAssayRoom(room) {
  const previewAnchors = room.previewAnchors
    ? Object.fromEntries(Object.entries(room.previewAnchors).map(([id, anchor]) => ([id, {
      ...anchor,
      x: transformAssayTileX(anchor.x),
      z: transformAssayTileZ(anchor.z),
    }])))
    : undefined;
  return {
    ...room,
    x: transformAssayTileX(room.x),
    z: transformAssayTileZ(room.z),
    previewPosition: room.previewPosition
      ? {
        ...room.previewPosition,
        x: transformAssayTileX(room.previewPosition.x),
        z: transformAssayTileZ(room.previewPosition.z),
      }
      : room.previewPosition,
    ...(previewAnchors ? { previewAnchors } : {}),
  };
}

function transformAssayMinimapRoom(room) {
  return {
    ...room,
    x: transformAssayTileX(room.x),
    z: transformAssayTileZ(room.z),
  };
}

function isDuplicateLinearSeamTile(tile) {
  if (tile.z !== 17) return false;
  return (tile.surface === 'deepMagma' && (tile.x === 6 || tile.x === 7))
    || (tile.surface !== 'deepMagma' && tile.x >= -1 && tile.x <= 1);
}

function hideDuplicateLinearSeamInstances(group, linearPlan) {
  const hidden = new THREE.Matrix4().makeTranslation(0, -100000, 0);
  const hideIndices = (meshName, tiles, predicate) => {
    const mesh = group.getObjectByName(meshName);
    if (!mesh?.isInstancedMesh) return;
    tiles.forEach((tile, index) => {
      if (predicate(tile)) mesh.setMatrixAt(index, hidden);
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

function localFloorTileKey(tile) {
  return `${tile.x},${tile.z}@${Number(tile.elevation).toFixed(6)}`;
}

function createDuplicateAssaySeamTileKeys(linearPlan, assayPlan) {
  const transformedLinearKeys = new Set(linearPlan.floorTiles.map((tile) => {
    const transformed = transformFloorTile(tile);
    return localFloorTileKey(transformed);
  }));
  return new Set(assayPlan.floorTiles
    .filter((tile) => transformedLinearKeys.has(localFloorTileKey(transformAssayFloorTile(tile))))
    .map(localFloorTileKey));
}

function isDuplicateAssaySeamTile(tile, duplicateTileKeys) {
  return duplicateTileKeys.has(localFloorTileKey(tile));
}

function hideDuplicateAssaySeamInstances(group, duplicateTileKeys) {
  const hidden = new THREE.Matrix4().makeTranslation(0, -100000, 0);
  const matrix = new THREE.Matrix4();
  const duplicateColumns = new Set([...duplicateTileKeys].map((key) => key.split('@')[0]));
  group.traverse((object) => {
    if (!object.isInstancedMesh
      || !/^(?:assayLabBoredFloors|assayLabLavaTiles)/.test(object.name)) {
      return;
    }
    for (let index = 0; index < object.count; index += 1) {
      object.getMatrixAt(index, matrix);
      const x = Math.round(matrix.elements[12] / TILE_SIZE);
      const z = Math.round(matrix.elements[14] / TILE_SIZE);
      if (duplicateColumns.has(`${x},${z}`)) object.setMatrixAt(index, hidden);
    }
    object.instanceMatrix.needsUpdate = true;
  });
}

function mergeSupportDiagnostics(opening, linear, assay) {
  return {
    structuralSupportCount:
      (opening.supportDiagnostics?.structuralSupportCount ?? 0)
      + (linear.supportDiagnostics?.structuralSupportCount ?? 0)
      + (assay.supportDiagnostics?.structuralSupportCount ?? 0),
    structuralFoundationCount:
      (opening.supportDiagnostics?.structuralFoundationCount ?? 0)
      + (linear.supportDiagnostics?.structuralFoundationCount ?? 0)
      + (assay.supportDiagnostics?.structuralFoundationCount ?? 0),
    undercroftFloorCount: opening.supportDiagnostics?.undercroftFloorCount ?? 0,
    supportDatumViolationCount:
      (opening.supportDiagnostics?.supportDatumViolationCount ?? 0)
      + (linear.supportDiagnostics?.supportDatumViolationCount ?? 0)
      + (assay.supportDiagnostics?.supportDatumViolationCount ?? 0),
    unresolvedElevatedFootprintCount:
      (opening.supportDiagnostics?.unresolvedElevatedFootprintCount ?? 0)
      + (linear.supportDiagnostics?.unresolvedElevatedFootprintCount ?? 0)
      + (assay.supportDiagnostics?.unresolvedElevatedFootprintCount ?? 0),
  };
}

function buildTiles(opening, linear, assay, duplicateAssaySeamTileKeys) {
  const tiles = new Map();
  for (const tile of opening.tiles.values()) tiles.set(`${tile.x},${tile.z}`, { ...tile });
  for (const tile of linear.tiles.values()) {
    if (isDuplicateLinearSeamTile(tile)) continue;
    const transformed = transformFloorTile(tile);
    tiles.set(`${transformed.x},${transformed.z}`, transformed);
  }
  for (const tile of assay.tiles.values()) {
    if (isDuplicateAssaySeamTile(tile, duplicateAssaySeamTileKeys)) continue;
    const transformed = transformAssayFloorTile(tile);
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
  const assayPlan = createMagmaRefractorAssayLabPlan({
    seed: `${seed}:assay`,
    random,
    tileSize,
    baseElevation: ASSAY_BASE_ELEVATION,
  });
  const opening = assembleMagmaRefineryOpeningRoom(openingPlan, {
    textureLoader,
    connectedSocketIds: [OPENING_DEEPER_SOCKET_ID],
  });
  const linear = assembleMagmaLinearDiggerExcavationRoom(linearPlan, {
    textureLoader,
    omittedSocketFrameIds: [LINEAR_ENTRY_FRAME_ID, LINEAR_ASSAY_FRAME_ID],
    omittedBoundaryWallKeys: LINEAR_ASSAY_RAMP_EXIT_WALL_OMISSIONS,
  });
  const assay = assembleMagmaRefractorAssayLabRoom(assayPlan, {
    textureLoader,
    // The Assay approach deliberately overlaps the Linear Digger's three-wide
    // final landing. Its standalone west wall must yield at that authored seam
    // or it becomes a full-height wall across the last ramp.
    omittedBoundaryWallKeys: ASSAY_LINEAR_RAMP_SEAM_WALL_OMISSIONS,
  });
  const duplicateAssaySeamTileKeys = createDuplicateAssaySeamTileKeys(linearPlan, assayPlan);

  hideDuplicateLinearSeamInstances(linear.group, linearPlan);
  hideDuplicateAssaySeamInstances(assay.group, duplicateAssaySeamTileKeys);
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
  assay.group.position.set(
    ASSAY_OFFSET_TILES.x * TILE_SIZE,
    0,
    ASSAY_OFFSET_TILES.z * TILE_SIZE,
  );
  assay.group.userData.sequenceTransform = {
    mirrorX: false,
    baseElevation: ASSAY_BASE_ELEVATION,
    offsetTiles: { ...ASSAY_OFFSET_TILES },
  };

  const group = new THREE.Group();
  group.name = 'magmaRefineryOpeningSequence';
  group.userData.roomModuleId = MAGMA_REFINERY_OPENING_SEQUENCE_ID;
  group.userData.themePackId = opening.themePackId;
  group.userData.proceduralRoom = true;
  group.userData.authoredOwnedMaterials = new Set([
    ...(opening.group.userData.authoredOwnedMaterials ?? []),
    ...(linear.group.userData.authoredOwnedMaterials ?? []),
    ...(assay.group.userData.authoredOwnedMaterials ?? []),
  ]);
  group.add(opening.group, linear.group, assay.group);

  const transformedLinearFloorTiles = linear.floorTiles
    .filter((tile) => !isDuplicateLinearSeamTile(tile))
    .map(transformFloorTile);
  const transformedAssayFloorTiles = assay.floorTiles
    .filter((tile) => !isDuplicateAssaySeamTile(tile, duplicateAssaySeamTileKeys))
    .map(transformAssayFloorTile);
  const floorTiles = [
    ...opening.floorTiles.map((tile) => ({ ...tile })),
    ...transformedLinearFloorTiles,
    ...transformedAssayFloorTiles,
  ];
  const transformedLinearRoomBase = transformRoom(linear.rooms[0]);
  const transformedLinearRoom = {
    ...transformedLinearRoomBase,
    previewAnchors: {
      ...(transformedLinearRoomBase.previewAnchors ?? {}),
      assayThreshold: { x: 17, y: ASSAY_BASE_ELEVATION, z: -44, facingX: 0, facingZ: -1 },
    },
  };
  const transformedAssayRoom = transformAssayRoom(assay.rooms[0]);
  const openingRoom = {
    ...opening.rooms[0],
    previewAnchors: {
      ...(opening.rooms[0].previewAnchors ?? {}),
      shellBoundaryCrossing: { x: 8, y: 0, z: -4, facingX: 0, facingZ: -1 },
      excavationThreshold: { x: 9, y: 0, z: -11, facingX: 0, facingZ: -1 },
      linearFlightBDescent: transformedLinearRoom.previewAnchors?.flightBDescent,
      linearFlightBEndLanding: transformedLinearRoom.previewAnchors?.flightBEndLanding,
      assayReveal: transformedAssayRoom.previewAnchors?.revealTerrace,
      assayEntryDescentStart: transformedAssayRoom.previewAnchors?.entryDescentStart,
      assayEastDaisRiseStart: transformedAssayRoom.previewAnchors?.eastDaisRiseStart,
      assayWestDaisReturnStart: transformedAssayRoom.previewAnchors?.westDaisReturnStart,
      assayRearRiseStart: transformedAssayRoom.previewAnchors?.rearRiseStart,
      assayGalleryRiseStart: transformedAssayRoom.previewAnchors?.galleryRiseStart,
      assayGalleryReturnStart: transformedAssayRoom.previewAnchors?.galleryReturnStart,
      assaySmelterSeal: transformedAssayRoom.previewAnchors?.smelterSeal,
      assayBulkhead: transformedAssayRoom.previewAnchors?.assayBulkhead,
    },
  };
  const transformedLinearFrames = linear.socketFrames
    .filter((frame) => ![LINEAR_ENTRY_FRAME_ID, LINEAR_ASSAY_FRAME_ID].includes(frame.id))
    .map(transformSocketFrame);
  const transformedAssayFrames = assay.socketFrames.map(transformAssaySocketFrame);
  const solidZones = [
    ...opening.solidZones,
    ...linear.solidZones.map((zone) => transformZone(zone, 'linear/')),
    ...assay.solidZones.map((zone) => transformAssayZone(zone, 'assay/')),
  ];
  const aerialBoundaryZones = [
    ...opening.aerialBoundaryZones,
    ...linear.aerialBoundaryZones.map((zone) => transformZone(zone, 'linear/')),
    ...assay.aerialBoundaryZones.map((zone) => transformAssayZone(zone, 'assay/')),
  ];
  const transformedLinearTraps = linear.traps
    .filter((trap) => !/_6_17$|_7_17$/.test(trap.id))
    .map(transformPositionRecord);
  const transformedLinearEncounters = linear.encounters.map(transformEncounter);
  const transformedAssayTraps = assay.traps
    .filter((trap) => {
      const localX = Math.round(trap.position.x / TILE_SIZE);
      const localZ = Math.round(trap.position.z / TILE_SIZE);
      const matchingTile = assayPlan.floorTiles.find((tile) => (
        tile.surface === 'deepMagma'
          && tile.x === localX
          && tile.z === localZ
          && Math.abs(tile.elevation - trap.position.y) < 0.01
      ));
      return !matchingTile || !isDuplicateAssaySeamTile(matchingTile, duplicateAssaySeamTileKeys);
    })
    .map(transformAssayPositionRecord);
  const transformedAssayEncounters = assay.encounters.map(transformAssayEncounter);
  const transformedLinearChests = linear.chests.map((chest) => ({
    ...chest,
    position: transformVector(chest.position),
  }));
  const transformedAssayChests = assay.chests.map((chest) => ({
    ...chest,
    position: transformAssayVector(chest.position),
  }));
  const transformedLinearMinimapRooms = linear.minimap.rooms.map(transformMinimapRoom);
  const transformedAssayMinimapRooms = assay.minimap.rooms.map(transformAssayMinimapRoom);
  const transformedAssayDoors = assay.doors.map((door) => ({
    ...door,
    position: transformAssayVector(door.position),
    graphBlockingPosition: transformAssayVector(door.graphBlockingPosition),
  }));
  const transformedAssayKeycards = assay.keycards.map((keycard) => ({
    ...keycard,
    position: transformAssayVector(keycard.position),
  }));
  const transformedAssayMechanisms = assay.mechanisms.map(transformAssayPositionRecord);
  const transformedAssaySafeInteractables = assay.safeInteractables.map(transformAssayPositionRecord);
  const transformedAssayProgressionDoors = (assay.progression?.doors ?? []).map((door) => ({
    ...door,
    position: transformAssayVector(door.position),
  }));
  const transformedAssayProgressionKeycards = (assay.progression?.keycards ?? []).map((keycard) => ({
    ...keycard,
    sourcePosition: transformAssayVector(keycard.sourcePosition),
  }));
  const supportDiagnostics = mergeSupportDiagnostics(opening, linear, assay);
  const openingConnectionPlan = {
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
  const assayConnectionPlan = {
    id: 'linear-excavation-to-assay-lab',
    connectorId: 'linear-excavation-to-assay-lab',
    connectorType: 'authored-socket-seam',
    fromRoomId: MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
    toRoomId: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
    sourceSocketId: LINEAR_ASSAY_SOCKET_ID,
    destinationSocketId: ASSAY_ENTRY_SOCKET_ID,
    direction: 'level',
    sourceElevation: ASSAY_BASE_ELEVATION,
    destinationElevation: ASSAY_BASE_ELEVATION,
    elevationDelta: 0,
    widthTiles: 3,
    clearWidthMeters: 8.4,
    routes: [{ sourceElevation: ASSAY_BASE_ELEVATION, destinationElevation: ASSAY_BASE_ELEVATION }],
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
  const assayPlayerSocketAlignment = {
    sourceSocketId: LINEAR_ASSAY_SOCKET_ID,
    destinationSocketId: ASSAY_ENTRY_SOCKET_ID,
    centerOffsetMeters: 0,
    elevationOffsetMeters: 0,
    widthOffsetMeters: 0,
    facingDot: -1,
    accepted: true,
  };
  const assayLavaSocketAlignment = {
    sourceSocketId: 'linear-excavation-lava-outlet',
    destinationSocketId: ASSAY_LAVA_INLET_SOCKET_ID,
    continuityTag: LAVA_CONTINUITY_TAG,
    centerOffsetMeters: 0,
    elevationOffsetMeters: 0,
    widthOffsetMeters: 0,
    facingDot: -1,
    accepted: true,
  };
  const minimap = {
    rooms: [
      ...opening.minimap.rooms,
      ...transformedLinearMinimapRooms,
      ...transformedAssayMinimapRooms,
    ],
    connections: [
      ...opening.minimap.connections,
      {
        id: openingConnectionPlan.id,
        from: MAGMA_REFINERY_OPENING_MODULE_ID,
        to: 'surveyMouth',
        elevationDelta: 0,
      },
      ...linear.minimap.connections,
      {
        id: assayConnectionPlan.id,
        from: 'assayApproach',
        to: 'diggerApproach',
        elevationDelta: 0,
      },
      ...assay.minimap.connections,
    ],
    environmentalSpines: [{
      id: LAVA_CONTINUITY_TAG,
      inletSocketId: 'opening-lava-continuity-socket',
      outletSocketId: 'assay-lab-lava-outlet',
      active: true,
    }],
  };
  const progression = {
    entranceRoomId: MAGMA_REFINERY_OPENING_MODULE_ID,
    bands: [
      { bandId: 'opening', roomIds: [MAGMA_REFINERY_OPENING_MODULE_ID] },
      { bandId: 'linear-excavation', roomIds: [MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID] },
      { bandId: 'assay-lab', roomIds: [MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID] },
    ],
    roomConnections: [
      {
        connectorId: openingConnectionPlan.id,
        fromRoomId: MAGMA_REFINERY_OPENING_MODULE_ID,
        toRoomId: MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
        doorId: null,
        shortcut: false,
      },
      {
        connectorId: assayConnectionPlan.id,
        fromRoomId: MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
        toRoomId: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
        doorId: null,
        shortcut: false,
      },
    ],
    doors: transformedAssayProgressionDoors,
    keycards: transformedAssayProgressionKeycards,
    shrineKey: null,
    validation: {
      accepted: true,
      errors: [],
      warnings: ['Three-module development sequence; the Ember Crown Shrine Concourse is not yet attached.'],
    },
  };
  const rooms = [openingRoom, transformedLinearRoom, transformedAssayRoom];
  const boundsRadius = Math.max(...floorTiles.map((tile) => (
    Math.hypot(tile.x * TILE_SIZE, tile.z * TILE_SIZE)
  ))) + 18;
  const elevationMin = Math.min(...rooms.map((room) => Number(room.minY ?? room.baseElevation ?? 0)));
  const elevationMax = Math.max(...rooms.map((room) => Number(room.maxY ?? room.baseElevation ?? 0)));
  const planHash = `${MAGMA_REFINERY_OPENING_SEQUENCE_ID}:${opening.planHash}:${linear.planHash}:${assay.planHash}`;

  return {
    group,
    dungeonKind: 'magmaRefineryOpeningSequenceDevelopmentFixture',
    dungeonFamilyId: 'industrial-v1',
    themePackId: opening.themePackId,
    developmentFixture: true,
    rooms,
    roomModuleIds: [
      MAGMA_REFINERY_OPENING_MODULE_ID,
      MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
      MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
    ],
    tiles: buildTiles(opening, linear, assay, duplicateAssaySeamTileKeys),
    floorTiles,
    rampLandings: [
      ...opening.rampLandings.map((landing) => ({ ...landing })),
      ...linear.rampLandings.map(transformRampLanding),
      ...assay.rampLandings.map(transformAssayRampLanding),
    ],
    socketFrames: [
      ...opening.socketFrames.map((frame) => ({ ...frame })),
      ...transformedLinearFrames,
      ...transformedAssayFrames,
    ],
    verticalConnectors: [
      ...opening.verticalConnectors,
      ...linear.verticalConnectors,
      ...assay.verticalConnectors,
    ],
    connectionPlans: [openingConnectionPlan, assayConnectionPlan],
    progression,
    minimap,
    doors: [
      ...opening.doors,
      ...linear.doors,
      ...transformedAssayDoors,
    ],
    keycards: [
      ...opening.keycards,
      ...linear.keycards,
      ...transformedAssayKeycards,
    ],
    keySeeker: null,
    chests: [...opening.chests, ...transformedLinearChests, ...transformedAssayChests],
    mechanisms: [
      ...opening.mechanisms,
      ...linear.mechanisms,
      ...transformedAssayMechanisms,
    ],
    ladders: [...opening.ladders, ...linear.ladders, ...assay.ladders],
    connectorLifts: [
      ...opening.connectorLifts,
      ...linear.connectorLifts,
      ...assay.connectorLifts,
    ],
    puzzleBlocks: [
      ...opening.puzzleBlocks,
      ...linear.puzzleBlocks,
      ...assay.puzzleBlocks.map(transformAssayPositionRecord),
    ],
    pressurePlates: [
      ...opening.pressurePlates,
      ...linear.pressurePlates,
      ...assay.pressurePlates.map(transformAssayPositionRecord),
    ],
    conveyorPuzzles: [
      ...opening.conveyorPuzzles,
      ...linear.conveyorPuzzles,
      ...assay.conveyorPuzzles,
    ],
    platforms: [
      ...opening.platforms,
      ...linear.platforms.map(transformPositionRecord),
      ...assay.platforms.map(transformAssayPositionRecord),
    ],
    npcAnimationMixers: [
      ...opening.npcAnimationMixers,
      ...linear.npcAnimationMixers,
      ...assay.npcAnimationMixers,
    ],
    npcAnimators: [
      ...opening.npcAnimators,
      ...linear.npcAnimators,
      ...assay.npcAnimators,
    ],
    safeInteractables: [
      ...opening.safeInteractables,
      ...linear.safeInteractables,
      ...transformedAssaySafeInteractables,
    ],
    safeZones: [
      ...opening.safeZones,
      ...linear.safeZones.map((zone) => transformZone(zone, 'linear/')),
      ...assay.safeZones.map((zone) => transformAssayZone(zone, 'assay/')),
    ],
    solidZones,
    aerialBoundaryZones,
    encounters: [
      ...opening.encounters,
      ...transformedLinearEncounters,
      ...transformedAssayEncounters,
    ],
    traps: [...opening.traps, ...transformedLinearTraps, ...transformedAssayTraps],
    conveyors: [
      ...opening.conveyors,
      ...linear.conveyors.map(transformPositionRecord),
      ...assay.conveyors.map(transformAssayPositionRecord),
    ],
    shrine: null,
    tileSize: TILE_SIZE,
    playerStart: opening.playerStart.clone(),
    playerStartFacing: opening.playerStartFacing.clone(),
    campReturnPosition: opening.campReturnPosition.clone(),
    ruinEntryPosition: opening.ruinEntryPosition.clone(),
    enemySpawnPoints: [
      ...transformedLinearEncounters,
      ...transformedAssayEncounters,
    ].flatMap((encounter) => encounter.spawnPoints.map((position) => position.clone())),
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
      heatResistantMovementMultiplier: 0.8,
      heatResistDamageMultiplier: 0.4,
      inletSocketId: 'opening-lava-continuity-socket',
      outletSocketId: 'assay-lab-lava-outlet',
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
        assayPlayer: assayPlayerSocketAlignment,
        assayLava: assayLavaSocketAlignment,
      },
      moduleDiagnostics: {
        opening: opening.moduleManifestDiagnostics,
        linearExcavation: linear.moduleManifestDiagnostics,
        assayLab: assay.moduleManifestDiagnostics,
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
      warnings: ['Three-module development sequence; dungeon-wide connector-family coverage is not evaluated.'],
      roomCount: 3,
      floorTileCount: floorTiles.length,
      signedConnectorCount: linear.verticalConnectors.length + assay.verticalConnectors.length,
      elevationRange: {
        min: elevationMin,
        max: elevationMax,
        span: Number((elevationMax - elevationMin).toFixed(6)),
      },
    },
    planHash,
  };
}
