import * as THREE from 'three';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../TraversalCapabilities.js';
import { applyWorldTiledUVs } from './MagmaRefineryOpeningRoom.js';

export const MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID = 'magma-refractor-assay-lab';
export const MAGMA_REFRACTOR_ASSAY_LAB_TOPOLOGY_REVISION = 1;
export const SMELTER_SEAL_ID = 'Smelter_Seal';
export const SMELTER_BULKHEAD_DOOR_ID = 'Door_Smelter_Bulkhead';

const TILE_SIZE = 2.8;
const ROOM_WIDTH_TILES = 37;
const ROOM_DEPTH_TILES = 41;
const MAIN_FLOOR_OFFSET = -5.6;
const DAIS_OFFSET = -2.8;
const GALLERY_OFFSET = 2.8;
const LAVA_BASIN_OFFSET = -8.4;
const CHAMBER_HEADROOM = 14;
const SOCKET_HEIGHT = 5.6;
const SOLID_FLOOR_THICKNESS = 0.4;
const LAVA_CONTINUITY_TAG = 'magma-refinery-lava-spine';
const TEXTURE_ROOT = '/assets/textures/magma-refinery/cells/seamless/';
const RAMP_WIDTH_TILES = 3;
const SUPPORT_COLLISION_TOP_INSET = 0.08;

const TEXTURE_SETS = Object.freeze({
  basalt: 'basalt',
  ashStone: 'ash-mineral-stone',
  blackMetal: 'blackened-metal',
  rails: 'rails',
  serviceGrate: 'service-grate',
  ceramic: 'ceramic',
  bronze: 'oxidized-bronze',
  chains: 'chains',
  magma: 'magma',
});

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value ?? '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed) {
  let state = hashString(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function stablePlanHash(plan) {
  return `magma-assay-lab:${hashString(JSON.stringify(plan)).toString(16).padStart(8, '0')}`;
}

function fixed(value) {
  return Number(Number(value).toFixed(6));
}

function cellKey(x, z) {
  return `${x},${z}`;
}

function floorKey(x, z, elevation) {
  return `${x},${z}@${fixed(elevation)}`;
}

function createFloorPlan(baseElevation) {
  const mainElevation = baseElevation + MAIN_FLOOR_OFFSET;
  const daisElevation = baseElevation + DAIS_OFFSET;
  const galleryElevation = baseElevation + GALLERY_OFFSET;
  const lavaBasinElevation = baseElevation + LAVA_BASIN_OFFSET;
  const floors = new Map();
  const landings = [];

  const setFloor = (x, z, elevation, overrides = {}) => {
    const key = floorKey(x, z, elevation);
    floors.set(key, {
      x,
      z,
      elevation: fixed(elevation),
      level: Math.round((elevation - baseElevation) / TILE_SIZE),
      roomId: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
      roomBaseElevation: baseElevation,
      surface: 'ancientCeramicFloor',
      surfaceRole: 'floor',
      ...overrides,
    });
  };
  const addRect = (minX, maxX, minZ, maxZ, elevation, overrides = {}) => {
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) setFloor(x, z, elevation, overrides);
    }
  };
  const addLanding = (id, routeId, minX, maxX, minZ, maxZ, elevation, overrides = {}) => {
    const landing = {
      id,
      routeId,
      elevation: fixed(elevation),
      minX,
      maxX,
      minZ,
      maxZ,
      widthTiles: maxX - minX + 1,
      depthTiles: maxZ - minZ + 1,
      clearWidthMeters: (maxX - minX + 1) * TILE_SIZE,
      clearDepthMeters: (maxZ - minZ + 1) * TILE_SIZE,
      propFree: true,
    };
    landings.push(landing);
    addRect(minX, maxX, minZ, maxZ, elevation, {
      surfaceRole: 'landing',
      landingId: id,
      routeId,
      ...overrides,
    });
  };
  const addRamp = ({
    id,
    startX,
    startZ,
    segments,
    directionX,
    directionZ,
    startElevation,
    endElevation,
    surface = 'ancientCeramicRamp',
  }) => {
    const delta = (endElevation - startElevation) / segments;
    const perpendicularX = directionZ;
    const perpendicularZ = -directionX;
    for (let segmentIndex = 0; segmentIndex < segments; segmentIndex += 1) {
      const centerX = startX + directionX * segmentIndex;
      const centerZ = startZ + directionZ * segmentIndex;
      const rampStartElevation = startElevation + delta * segmentIndex;
      const rampEndElevation = startElevation + delta * (segmentIndex + 1);
      for (let lane = -1; lane <= 1; lane += 1) {
        setFloor(
          centerX + perpendicularX * lane,
          centerZ + perpendicularZ * lane,
          (rampStartElevation + rampEndElevation) * 0.5,
          {
            surface,
            surfaceRole: 'ramp',
            rampRouteId: id,
            rampSegmentIndex: segmentIndex,
            rampStartElevation: fixed(rampStartElevation),
            rampEndElevation: fixed(rampEndElevation),
            rampDirectionX: directionX,
            rampDirectionZ: directionZ,
            supportedElevatedRoute: true,
            groundedStepTransitionHeight: PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile + 0.05,
          },
        );
      }
    }
  };

  // Recently bored approach, then the unearthed refinery reveal terrace.
  addRect(8, 16, 14, 20, baseElevation, {
    surface: 'boredBasaltFloor',
    chamberId: 'diggerApproach',
  });
  addRect(6, 17, 11, 13, baseElevation, {
    surface: 'boredBasaltFloor',
    chamberId: 'unearthedThreshold',
  });
  addRect(-15, 17, 8, 10, baseElevation, {
    surface: 'ancientCeramicFloor',
    chamberId: 'grandRevealTerrace',
  });
  addRect(-3, 2, 8, 10, baseElevation, {
    surface: 'serviceGrateCauseway',
    surfaceRole: 'bridge',
    bridgeId: 'revealCascadeCrossing',
    supportedElevatedRoute: true,
    chamberId: 'grandRevealTerrace',
  });

  // Broad main assay aprons flank the split stream.
  addRect(7, 17, -14, 6, mainElevation, { chamberId: 'eastAssayApron' });
  addRect(-17, -7, -12, 6, mainElevation, { chamberId: 'westAssayApron' });
  addRect(-17, 17, -14, -10, mainElevation, { chamberId: 'rearAssayFloor' });
  addRect(-17, -12, 0, 6, mainElevation, {
    chamberId: 'diggerSampleBay',
    surface: 'boredBasaltFloor',
  });

  // Monumental Seal island. Both side causeways are permanent and dry.
  addRect(-3, 3, -2, 4, daisElevation, {
    chamberId: 'smelterSealDais',
    surface: 'assayDaisFloor',
  });
  addRect(4, 7, 0, 2, daisElevation, {
    chamberId: 'eastSealCauseway',
    surface: 'serviceGrateCauseway',
    surfaceRole: 'bridge',
    bridgeId: 'eastSealCauseway',
    supportedElevatedRoute: true,
  });
  addRect(-7, -4, -4, -2, daisElevation, {
    chamberId: 'westSealCauseway',
    surface: 'serviceGrateCauseway',
    surfaceRole: 'bridge',
    bridgeId: 'westSealCauseway',
    supportedElevatedRoute: true,
  });

  // Entry descent: a continuous three-wide slope with full 3x3 buffers.
  addLanding('entryDescentStart', 'assay-entry-descent', 16, 18, 8, 10, baseElevation, {
    surface: 'ancientCeramicFloor',
  });
  addRamp({
    id: 'assay-entry-descent',
    startX: 17,
    startZ: 7,
    segments: 11,
    directionX: 0,
    directionZ: -1,
    startElevation: baseElevation,
    endElevation: mainElevation,
  });
  addLanding('entryDescentEnd', 'assay-entry-descent', 16, 18, -6, -4, mainElevation);

  // The right-hand ascent is the required approach; the left-hand route closes the loop.
  addLanding('eastDaisRiseStart', 'east-dais-rise', 13, 15, 0, 2, mainElevation);
  addRamp({
    id: 'east-dais-rise',
    startX: 12,
    startZ: 1,
    segments: 6,
    directionX: -1,
    directionZ: 0,
    startElevation: mainElevation,
    endElevation: daisElevation,
  });
  addLanding('eastDaisRiseEnd', 'east-dais-rise', 4, 6, 0, 2, daisElevation, {
    surface: 'serviceGrateCauseway',
    surfaceRole: 'bridge',
    bridgeId: 'eastSealCauseway',
    supportedElevatedRoute: true,
  });
  addLanding('westDaisRiseStart', 'west-dais-return', -7, -5, -4, -2, daisElevation, {
    surface: 'serviceGrateCauseway',
    surfaceRole: 'bridge',
    bridgeId: 'westSealCauseway',
    supportedElevatedRoute: true,
  });
  addRamp({
    id: 'west-dais-return',
    startX: -8,
    startZ: -3,
    segments: 6,
    directionX: -1,
    directionZ: 0,
    startElevation: daisElevation,
    endElevation: mainElevation,
  });
  addLanding('westDaisRiseEnd', 'west-dais-return', -16, -14, -4, -2, mainElevation);

  // Rear process stair rises from the assay floor to the contained bulkhead landing.
  addLanding('rearRiseStart', 'assay-rear-rise', 11, 13, -6, -4, mainElevation);
  addRamp({
    id: 'assay-rear-rise',
    startX: 12,
    startZ: -7,
    segments: 11,
    directionX: 0,
    directionZ: -1,
    startElevation: mainElevation,
    endElevation: baseElevation,
  });
  addLanding('rearRiseEnd', 'assay-rear-rise', 11, 13, -20, -18, baseElevation);

  // A genuine upper gallery branches from the reveal terrace and rejoins beside the gate.
  addLanding('galleryRiseStart', 'assayer-gallery-rise', -16, -14, 8, 10, baseElevation);
  addRamp({
    id: 'assayer-gallery-rise',
    startX: -15,
    startZ: 7,
    segments: 6,
    directionX: 0,
    directionZ: -1,
    startElevation: baseElevation,
    endElevation: galleryElevation,
    surface: 'serviceGrateRamp',
  });
  addLanding('galleryRiseEnd', 'assayer-gallery-rise', -16, -14, -1, 1, galleryElevation, {
    surface: 'serviceGrateFloor',
  });
  addRect(-17, -14, -10, 1, galleryElevation, {
    chamberId: 'assayersGallery',
    surface: 'serviceGrateFloor',
    supportedElevatedRoute: true,
  });
  addRect(-17, 10, -12, -10, galleryElevation, {
    chamberId: 'assayersGallery',
    surface: 'serviceGrateFloor',
    supportedElevatedRoute: true,
  });
  addLanding('galleryReturnStart', 'assayer-gallery-return', 5, 7, -10, -8, galleryElevation, {
    surface: 'serviceGrateFloor',
    supportedElevatedRoute: true,
  });
  addRamp({
    id: 'assayer-gallery-return',
    startX: 6,
    startZ: -11,
    segments: 6,
    directionX: 0,
    directionZ: -1,
    startElevation: galleryElevation,
    endElevation: baseElevation,
    surface: 'serviceGrateRamp',
  });
  // The gallery rejoins the required route on the approach side of the sealed
  // bulkhead. It must not furnish floor behind the closed door.
  addLanding('galleryReturnEnd', 'assayer-gallery-return', 5, 7, -19, -17, baseElevation, {
    surface: 'serviceGrateFloor',
  });
  addRect(8, 10, -19, -17, baseElevation, {
    chamberId: 'bulkheadCrossLanding',
    surface: 'serviceGrateFloor',
    supportedElevatedRoute: true,
  });

  const lavaTiles = [];
  const pushLava = (x, z, elevation, overrides = {}) => lavaTiles.push({
    x,
    z,
    elevation: fixed(elevation),
    level: Math.round((elevation - baseElevation) / TILE_SIZE),
    roomId: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
    roomBaseElevation: baseElevation,
    surface: 'deepMagma',
    surfaceRole: 'hazard-floor',
    allowsGroundedDropLanding: true,
    hazardPathCost: 18,
    heatCompatibleOnly: true,
    ...overrides,
  });
  for (let z = 15; z <= 20; z += 1) {
    for (const x of [-1, 0]) pushLava(x, z, baseElevation + DAIS_OFFSET, { lavaSection: 'inlet' });
  }
  for (let z = 12; z <= 14; z += 1) {
    const index = 14 - z;
    const start = baseElevation + DAIS_OFFSET - (index * 1.8666667);
    const end = start - 1.8666667;
    for (const x of [-1, 0]) pushLava(x, z, (start + end) * 0.5, {
      lavaSection: 'cascade',
      rampStartElevation: fixed(start),
      rampEndElevation: fixed(end),
      rampDirectionX: 0,
      rampDirectionZ: -1,
    });
  }
  for (let z = 8; z <= 11; z += 1) {
    for (const x of [-1, 0]) pushLava(x, z, lavaBasinElevation, { lavaSection: 'forebasin' });
  }
  const splitRows = [
    { z: 7, west: [-2, -1], east: [0, 1] },
    { z: 6, west: [-4, -3], east: [2, 3] },
  ];
  for (let z = -7; z <= 5; z += 1) {
    splitRows.push({ z, west: [-6, -5], east: [5, 6] });
  }
  for (const row of splitRows) {
    for (const x of [...row.west, ...row.east]) pushLava(x, row.z, lavaBasinElevation, {
      lavaSection: 'split-basin',
    });
  }
  const recombineRows = [
    { z: -8, xs: [-5, -4, 4, 5] },
    { z: -9, xs: [-4, -3, 3, 4] },
    { z: -10, xs: [-3, -2, -1, 0, 1, 2, 3] },
    { z: -11, xs: [-2, -1, 0, 1, 2] },
  ];
  for (const row of recombineRows) {
    for (const x of row.xs) pushLava(x, row.z, lavaBasinElevation, { lavaSection: 'recombine' });
  }
  for (let z = -20; z <= -12; z += 1) {
    for (const x of [-1, 0]) pushLava(x, z, lavaBasinElevation, { lavaSection: 'outlet' });
  }

  // A traversal slope owns its X/Z columns. Never leave a flat floor inside a
  // ramp volume; that creates the stacked ledge-correction failure which this
  // authored family explicitly forbids.
  const rampColumns = new Set(
    [...floors.values()]
      .filter((tile) => tile.surfaceRole === 'ramp')
      .map((tile) => cellKey(tile.x, tile.z)),
  );
  for (const [key, floor] of floors) {
    if (floor.surfaceRole !== 'ramp' && rampColumns.has(cellKey(floor.x, floor.z))) floors.delete(key);
  }

  // Lava removes ordinary floor, except for the two explicitly supported causeways.
  const causewayColumns = new Set(
    [...floors.values()]
      .filter((tile) => tile.surfaceRole === 'bridge')
      .map((tile) => cellKey(tile.x, tile.z)),
  );
  for (const [key, floor] of floors) {
    if (floor.surfaceRole !== 'bridge' && causewayColumns.has(cellKey(floor.x, floor.z))) floors.delete(key);
  }
  for (const lavaTile of lavaTiles) {
    if (causewayColumns.has(cellKey(lavaTile.x, lavaTile.z))) continue;
    for (const [key, floor] of floors) {
      if (floor.x === lavaTile.x
        && floor.z === lavaTile.z
        && floor.surfaceRole !== 'ramp'
        && floor.supportedElevatedRoute !== true) {
        floors.delete(key);
      }
    }
  }

  const walkableColumns = new Map();
  for (const tile of floors.values()) {
    const column = walkableColumns.get(cellKey(tile.x, tile.z)) ?? [];
    column.push(tile);
    walkableColumns.set(cellKey(tile.x, tile.z), column);
  }
  const stackedWalkableColumns = [...walkableColumns.entries()]
    .filter(([, column]) => new Set(column.map((tile) => fixed(tile.elevation))).size > 1)
    .map(([key, column]) => ({
      key,
      elevations: column.map((tile) => fixed(tile.elevation)).sort((left, right) => left - right),
      clearVerticalMeters: fixed(Math.max(...column.map((tile) => tile.elevation)) - Math.min(...column.map((tile) => tile.elevation))),
    }));

  return {
    floorTiles: [...floors.values(), ...lavaTiles].sort((left, right) => (
      left.elevation - right.elevation || left.z - right.z || left.x - right.x
    )),
    rampLandings: landings,
    stackedWalkableColumns,
  };
}

export function createMagmaRefractorAssayLabPlan({
  seed = 'magma-refractor-assay-lab-default',
  random = null,
  tileSize = TILE_SIZE,
  baseElevation = 0,
} = {}) {
  if (Math.abs(tileSize - TILE_SIZE) > 0.0001) {
    throw new Error(`Refractor Assay Lab requires the shared ${TILE_SIZE} m macro tile.`);
  }
  const rng = random ?? createSeededRandom(seed);
  const furnacePattern = rng() < 0.5 ? 'paired-prism' : 'alternating-crucible';
  const sampleBaySide = rng() < 0.5 ? 'west' : 'northwest';
  const floorPlan = createFloorPlan(baseElevation);
  const sockets = [
    {
      id: 'assay-lab-entry-socket',
      kind: 'player',
      x: 12,
      z: 20,
      elevation: baseElevation,
      facingX: 0,
      facingZ: 1,
      widthMeters: 8.4,
      heightMeters: SOCKET_HEIGHT,
      clearLandingMeters: { width: 8.4, depth: 8.4 },
    },
    {
      id: 'assay-lab-ember-crown-socket',
      kind: 'player',
      x: 12,
      z: -20,
      elevation: baseElevation,
      facingX: 0,
      facingZ: -1,
      widthMeters: 8.4,
      heightMeters: SOCKET_HEIGHT,
      clearLandingMeters: { width: 8.4, depth: 8.4 },
    },
    {
      id: 'assay-lab-lava-inlet',
      kind: 'environmental-spine',
      x: -0.5,
      z: 20,
      elevation: baseElevation + DAIS_OFFSET,
      facingX: 0,
      facingZ: 1,
      widthMeters: 4.2,
      continuityTag: LAVA_CONTINUITY_TAG,
    },
    {
      id: 'assay-lab-lava-outlet',
      kind: 'environmental-spine',
      x: -0.5,
      z: -20,
      elevation: baseElevation + LAVA_BASIN_OFFSET,
      facingX: 0,
      facingZ: -1,
      widthMeters: 4.2,
      continuityTag: LAVA_CONTINUITY_TAG,
    },
  ];
  const socketFrames = sockets.filter((socket) => socket.kind === 'player').map((socket) => ({
    id: `${socket.id}-frame`,
    socketId: socket.id,
    x: socket.x,
    z: socket.z,
    elevation: socket.elevation,
    facingX: socket.facingX,
    facingZ: socket.facingZ,
    openingWidthMeters: socket.widthMeters,
    openingHeightMeters: socket.heightMeters,
    thresholdAlignmentToleranceMeters: 0.05,
  }));
  const chambers = [
    { id: 'diggerApproach', label: 'Fresh Digger Cut', elevation: baseElevation, purpose: 'calm-navigation' },
    { id: 'grandRevealTerrace', label: 'Assay Lab Reveal', elevation: baseElevation, purpose: 'landmark-reveal' },
    { id: 'eastAssayApron', label: 'Prism Furnace Apron', elevation: baseElevation + MAIN_FLOOR_OFFSET, purpose: 'required-route' },
    { id: 'westAssayApron', label: 'Crucible Service Apron', elevation: baseElevation + MAIN_FLOOR_OFFSET, purpose: 'optional-encounter' },
    { id: 'smelterSealDais', label: 'Smelter Seal Dais', elevation: baseElevation + DAIS_OFFSET, purpose: 'required-credential' },
    { id: 'assayersGallery', label: "Assayer's Gallery", elevation: baseElevation + GALLERY_OFFSET, purpose: 'optional-traversal' },
    { id: 'diggerSampleBay', label: 'Digger Sample Bay', elevation: baseElevation + MAIN_FLOOR_OFFSET, purpose: 'optional-treasure' },
    { id: 'assayBulkheadLanding', label: 'Ember Crown Bulkhead', elevation: baseElevation, purpose: 'required-exit' },
  ];
  const plan = {
    schema: 'ruindivex-room-module/v1',
    moduleId: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
    topologyRevision: MAGMA_REFRACTOR_ASSAY_LAB_TOPOLOGY_REVISION,
    themePackId: 'magma-refinery-future',
    tileSize,
    baseElevation: fixed(baseElevation),
    dimensions: {
      widthTiles: ROOM_WIDTH_TILES,
      depthTiles: ROOM_DEPTH_TILES,
      authoredEnvelopeMeters: { width: ROOM_WIDTH_TILES * TILE_SIZE, depth: ROOM_DEPTH_TILES * TILE_SIZE },
      minY: baseElevation + LAVA_BASIN_OFFSET,
      maxY: baseElevation + CHAMBER_HEADROOM,
    },
    room: {
      id: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
      type: 'assay-lab',
      archetype: 'magma-refractor-assay-lab',
      x: 0,
      z: 0,
      width: ROOM_WIDTH_TILES,
      depth: ROOM_DEPTH_TILES,
      baseElevation: fixed(baseElevation),
      minY: fixed(baseElevation + LAVA_BASIN_OFFSET),
      maxY: fixed(baseElevation + GALLERY_OFFSET + 4.2),
      ceilingY: fixed(baseElevation + CHAMBER_HEADROOM),
      ceilingHeight: CHAMBER_HEADROOM,
      purpose: 'A grand ancient assay hall where the Smelter Seal is recovered above a split lava stream.',
      mood: 'Recent Digger excavation gives way abruptly to a monumental refinery interior still warm with ancient power.',
      environmentalStory: 'Fresh drill scoring and temporary braces stop at a ceremonial threshold; beyond it, prism furnaces and crucible arms frame the Seal dais.',
      previewPosition: { x: 12, y: fixed(baseElevation), z: 18 },
      previewFacing: { x: 0, z: -1 },
      previewAnchors: {
        revealTerrace: { x: 16, y: fixed(baseElevation), z: 9, facingX: 0, facingZ: -1 },
        entryDescentStart: { x: 17, y: fixed(baseElevation), z: 9, facingX: 0, facingZ: -1 },
        eastDaisRiseStart: { x: 14, y: fixed(baseElevation + MAIN_FLOOR_OFFSET), z: 1, facingX: -1, facingZ: 0 },
        westDaisReturnStart: { x: -6, y: fixed(baseElevation + DAIS_OFFSET), z: -3, facingX: -1, facingZ: 0 },
        rearRiseStart: { x: 12, y: fixed(baseElevation + MAIN_FLOOR_OFFSET), z: -5, facingX: 0, facingZ: -1 },
        galleryRiseStart: { x: -15, y: fixed(baseElevation), z: 9, facingX: 0, facingZ: -1 },
        galleryReturnStart: { x: 6, y: fixed(baseElevation + GALLERY_OFFSET), z: -10, facingX: 0, facingZ: -1 },
        smelterSeal: { x: 4, y: fixed(baseElevation + DAIS_OFFSET), z: 1, facingX: -1, facingZ: 0 },
        assayersGallery: { x: -15, y: fixed(baseElevation + GALLERY_OFFSET), z: -5, facingX: 0.8, facingZ: 0.6 },
        assayBulkhead: { x: 12, y: fixed(baseElevation), z: -18, facingX: 0, facingZ: -1 },
      },
      verticalPlan: {
        baseElevation: fixed(baseElevation),
        localWalkableTiers: [
          fixed(baseElevation + MAIN_FLOOR_OFFSET),
          fixed(baseElevation + DAIS_OFFSET),
          fixed(baseElevation),
          fixed(baseElevation + GALLERY_OFFSET),
        ],
        requiredRouteElevationSequence: [
          fixed(baseElevation),
          fixed(baseElevation + MAIN_FLOOR_OFFSET),
          fixed(baseElevation + DAIS_OFFSET),
          fixed(baseElevation + MAIN_FLOOR_OFFSET),
          fixed(baseElevation),
        ],
      },
    },
    chambers,
    sockets,
    socketFrames,
    floorTiles: floorPlan.floorTiles,
    rampLandings: floorPlan.rampLandings,
    stackedWalkableColumns: floorPlan.stackedWalkableColumns,
    furnacePattern,
    sampleBaySide,
    smelterSeal: {
      id: SMELTER_SEAL_ID,
      pickupId: 'smelter-seal-pickup',
      chamberId: 'smelterSealDais',
      pedestalPosition: { x: 0, y: fixed(baseElevation + DAIS_OFFSET), z: 1 },
      // The Seal rests at the east lip of the monumental plinth. Its pickup
      // radius is therefore reachable without walking through the pedestal.
      position: { x: 0.9, y: fixed(baseElevation + DAIS_OFFSET), z: 1 },
      pairedDoorId: SMELTER_BULKHEAD_DOOR_ID,
      encounterLocked: false,
    },
    bulkhead: {
      id: SMELTER_BULKHEAD_DOOR_ID,
      position: { x: 12, y: fixed(baseElevation), z: -19 },
      openingWidthMeters: 8.4,
      openingHeightMeters: 5.6,
      requiredCredentialId: SMELTER_SEAL_ID,
    },
    textureContract: {
      root: TEXTURE_ROOT,
      metersPerRepeat: TILE_SIZE,
      wrapS: 'RepeatWrapping',
      wrapT: 'RepeatWrapping',
      stretchedSurfacesAllowed: false,
      sets: { ...TEXTURE_SETS },
    },
    cameraOcclusion: {
      system: 'industrial-camera-to-player-segment',
      surfaceType: 'walls-only',
      ownerFlag: 'cameraOcclusionOwner',
      surfaceFlag: 'cameraOcclusionSurface',
      wallFlag: 'cameraOcclusionWall',
    },
    clearanceContract: {
      minimumRouteWidthTiles: 3,
      minimumHeadroomMeters: 8.4,
      minimumLandingTiles: 3,
      cameraOcclusionRequired: true,
      requiredRouteUsesMagma: false,
    },
  };
  plan.planHash = stablePlanHash(plan);
  return plan;
}

function configureTexture(texture, { srgb = false } = {}) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.anisotropy = 4;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.worldUvMetersPerRepeat = TILE_SIZE;
  return texture;
}

function createTextureMaterial(textureLoader, setName, options = {}) {
  const load = (suffix, srgb = false) => configureTexture(
    textureLoader.load(`${TEXTURE_ROOT}${setName}-${suffix}.png`),
    { srgb },
  );
  const material = new THREE.MeshStandardMaterial({
    name: `magmaAssayLab_${setName}`,
    color: options.color ?? 0xffffff,
    map: load('albedo', true),
    normalMap: load('normal'),
    roughnessMap: load('roughness'),
    emissiveMap: options.emissiveMap === false ? null : load('emission', true),
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    roughness: options.roughness ?? 0.86,
    metalness: options.metalness ?? 0.05,
  });
  material.userData.worldUvMetersPerRepeat = TILE_SIZE;
  material.userData.stretchedUvsAllowed = false;
  return material;
}

function createMaterials(textureLoader) {
  return {
    basalt: createTextureMaterial(textureLoader, TEXTURE_SETS.basalt, { roughness: 0.95 }),
    ashStone: createTextureMaterial(textureLoader, TEXTURE_SETS.ashStone, { roughness: 0.93 }),
    blackMetal: createTextureMaterial(textureLoader, TEXTURE_SETS.blackMetal, { roughness: 0.66, metalness: 0.72 }),
    rails: createTextureMaterial(textureLoader, TEXTURE_SETS.rails, { roughness: 0.58, metalness: 0.78 }),
    serviceGrate: createTextureMaterial(textureLoader, TEXTURE_SETS.serviceGrate, { roughness: 0.64, metalness: 0.68 }),
    ceramic: createTextureMaterial(textureLoader, TEXTURE_SETS.ceramic, { roughness: 0.78, metalness: 0.1 }),
    bronze: createTextureMaterial(textureLoader, TEXTURE_SETS.bronze, { roughness: 0.55, metalness: 0.76 }),
    chains: createTextureMaterial(textureLoader, TEXTURE_SETS.chains, { roughness: 0.62, metalness: 0.7 }),
    magma: createTextureMaterial(textureLoader, TEXTURE_SETS.magma, {
      emissive: 0xff5718,
      emissiveIntensity: 2.35,
      roughness: 0.3,
      metalness: 0,
    }),
    seal: new THREE.MeshStandardMaterial({
      name: 'magmaAssayLab_smelterSeal',
      color: 0xffd383,
      emissive: 0xff6a18,
      emissiveIntensity: 1.75,
      roughness: 0.28,
      metalness: 0.72,
    }),
    lamp: new THREE.MeshStandardMaterial({
      name: 'magmaAssayLab_diggerLamp',
      color: 0xffdfaa,
      emissive: 0xff7a22,
      emissiveIntensity: 2.5,
      roughness: 0.3,
      metalness: 0.12,
    }),
    gateLocked: new THREE.MeshStandardMaterial({
      name: 'magmaAssayLab_gateLocked',
      color: 0x55231c,
      emissive: 0xff3518,
      emissiveIntensity: 0.58,
      roughness: 0.62,
      metalness: 0.78,
    }),
    gateReady: new THREE.MeshStandardMaterial({
      name: 'magmaAssayLab_gateReady',
      color: 0x65ffd0,
      emissive: 0x22dba8,
      emissiveIntensity: 1.1,
      roughness: 0.32,
      metalness: 0.4,
    }),
  };
}

function createTiledBoxGeometry(width, height, depth, metersPerRepeat = TILE_SIZE) {
  return applyWorldTiledUVs(new THREE.BoxGeometry(width, height, depth), metersPerRepeat);
}

function addBox(parent, options) {
  const mesh = new THREE.Mesh(
    createTiledBoxGeometry(options.width, options.height, options.depth, options.metersPerRepeat),
    options.material,
  );
  mesh.name = options.name;
  mesh.position.set(options.x, options.y, options.z);
  mesh.rotation.set(options.pitch ?? 0, options.yaw ?? 0, options.roll ?? 0);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  mesh.userData.worldUvTiled = true;
  Object.assign(mesh.userData, options.userData ?? {});
  parent.add(mesh);
  return mesh;
}

function addCylinder(parent, options) {
  const geometry = applyWorldTiledUVs(new THREE.CylinderGeometry(
    options.radiusTop ?? options.radius,
    options.radiusBottom ?? options.radius,
    options.height,
    options.radialSegments ?? 16,
    1,
    false,
  ), options.metersPerRepeat ?? TILE_SIZE);
  const mesh = new THREE.Mesh(geometry, options.material);
  mesh.name = options.name;
  mesh.position.set(options.x, options.y, options.z);
  mesh.rotation.set(options.pitch ?? 0, options.yaw ?? 0, options.roll ?? 0);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  mesh.userData.worldUvTiled = true;
  Object.assign(mesh.userData, options.userData ?? {});
  parent.add(mesh);
  return mesh;
}

function addInstancedTiles(parent, { name, tiles, material, thickness, yForTile }) {
  if (tiles.length === 0) return null;
  const mesh = new THREE.InstancedMesh(
    createTiledBoxGeometry(TILE_SIZE, thickness, TILE_SIZE),
    material,
    tiles.length,
  );
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.worldUvTiled = true;
  mesh.userData.collisionBacked = true;
  const matrix = new THREE.Matrix4();
  tiles.forEach((tile, index) => {
    matrix.makeTranslation(tile.x * TILE_SIZE, yForTile(tile), tile.z * TILE_SIZE);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
  return mesh;
}

function addInstancedMatrices(parent, { name, geometry, material, matrices, userData = {} }) {
  if (matrices.length === 0) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.worldUvTiled = true;
  Object.assign(mesh.userData, userData);
  matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
  return mesh;
}

function collectContiguousXRuns(tiles, rowKeyForTile = (tile) => (
  `${tile.z}|${fixed(tile.elevation)}`
)) {
  const rows = new Map();
  for (const tile of tiles) {
    const key = rowKeyForTile(tile);
    const row = rows.get(key) ?? [];
    row.push(tile);
    rows.set(key, row);
  }
  const runs = [];
  for (const row of rows.values()) {
    row.sort((left, right) => left.x - right.x);
    let start = row[0];
    let previous = row[0];
    const flush = () => runs.push({
      startX: start.x,
      endX: previous.x,
      spanTiles: previous.x - start.x + 1,
      z: start.z,
      elevation: start.elevation,
      source: start,
    });
    for (const tile of row.slice(1)) {
      if (tile.x !== previous.x + 1) {
        flush();
        start = tile;
      }
      previous = tile;
    }
    flush();
  }
  return runs;
}

function addTiledRowRuns(parent, {
  name,
  tiles,
  material,
  thickness,
  yForRun,
  rowKeyForTile,
  userData = {},
}) {
  const bySpan = new Map();
  for (const run of collectContiguousXRuns(tiles, rowKeyForTile)) {
    const bucket = bySpan.get(run.spanTiles) ?? [];
    bucket.push(new THREE.Matrix4().makeTranslation(
      ((run.startX + run.endX) * 0.5) * TILE_SIZE,
      yForRun(run),
      run.z * TILE_SIZE,
    ));
    bySpan.set(run.spanTiles, bucket);
  }
  for (const [spanTiles, matrices] of bySpan) {
    addInstancedMatrices(parent, {
      name: `${name}Span${spanTiles}`,
      geometry: createTiledBoxGeometry(
        spanTiles * TILE_SIZE,
        thickness,
        TILE_SIZE,
      ),
      material,
      matrices,
      userData,
    });
  }
}

function createSolidZone(id, x, y, z, halfWidth, halfDepth, verticalHalfHeight, obstacleKind) {
  return {
    id,
    roomId: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
    position: new THREE.Vector3(x, y, z),
    halfWidth,
    halfDepth,
    verticalHalfHeight,
    obstacleKind,
    playerCollisionPadding: PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
  };
}

function createStructuralSupportZone(
  id,
  x,
  z,
  supportBaseY,
  supportTopY,
  halfWidth,
  halfDepth,
) {
  const collisionTopY = Math.max(
    supportBaseY,
    supportTopY - SUPPORT_COLLISION_TOP_INSET,
  );
  const collisionHeight = Math.max(0.02, collisionTopY - supportBaseY);
  const zone = createSolidZone(
    id,
    x,
    supportBaseY + collisionHeight * 0.5,
    z,
    halfWidth,
    halfDepth,
    collisionHeight * 0.5,
    'structuralSupport',
  );
  zone.supportBaseY = supportBaseY;
  zone.supportTopY = supportTopY;
  zone.collisionTopY = supportBaseY + collisionHeight;
  return zone;
}

function addFlatFloors(parent, plan, materials) {
  const flatTiles = plan.floorTiles.filter((tile) => (
    tile.surface !== 'deepMagma' && tile.surfaceRole !== 'ramp'
  ));
  const groups = [
    ['assayLabBoredFloors', flatTiles.filter((tile) => tile.surface === 'boredBasaltFloor'), materials.ashStone],
    ['assayLabCeramicFloors', flatTiles.filter((tile) => !['boredBasaltFloor', 'serviceGrateCauseway', 'serviceGrateFloor'].includes(tile.surface)), materials.ceramic],
    ['assayLabServiceFloors', flatTiles.filter((tile) => ['serviceGrateCauseway', 'serviceGrateFloor'].includes(tile.surface)), materials.serviceGrate],
  ];
  for (const [name, tiles, material] of groups) {
    const thickness = material === materials.serviceGrate
      ? 0.28
      : SOLID_FLOOR_THICKNESS;
    // The combined-map seam removes individual recently-bored cells. Preserve
    // one instance per bored tile so that operation never has to discard an
    // otherwise valid merged floor run.
    if (name === 'assayLabBoredFloors') {
      addInstancedTiles(parent, {
        name,
        tiles,
        material,
        thickness,
        yForTile: (tile) => tile.elevation - thickness * 0.5,
      });
      continue;
    }
    addTiledRowRuns(parent, {
      name,
      tiles,
      material,
      thickness,
      yForRun: (run) => run.elevation - thickness * 0.5,
      userData: { collisionBacked: true },
    });
  }
}

function addRampFloors(parent, plan, materials) {
  const rampTiles = plan.floorTiles.filter((tile) => tile.surfaceRole === 'ramp');
  const routeSegments = new Map();
  for (const tile of rampTiles) {
    const key = `${tile.rampRouteId}:${tile.rampSegmentIndex}`;
    const segment = routeSegments.get(key) ?? [];
    segment.push(tile);
    routeSegments.set(key, segment);
  }
  const batches = new Map();
  for (const segmentTiles of routeSegments.values()) {
    const center = segmentTiles[Math.floor(segmentTiles.length / 2)];
    const material = center.surface === 'serviceGrateRamp' ? materials.serviceGrate : materials.ceramic;
    const alongX = Math.abs(center.rampDirectionX) > 0.5;
    const rise = center.rampEndElevation - center.rampStartElevation;
    const slope = Math.atan2(rise, TILE_SIZE);
    const slopeLength = Math.hypot(TILE_SIZE, rise);
    const pitch = center.rampDirectionZ
      ? -slope * center.rampDirectionZ
      : 0;
    const roll = center.rampDirectionX
      ? slope * center.rampDirectionX
      : 0;
    const key = `${material.uuid}:${alongX ? 'x' : 'z'}:${fixed(slopeLength)}`;
    const batch = batches.get(key) ?? {
      material,
      alongX,
      slopeLength,
      matrices: [],
      rampSegments: [],
    };
    batch.matrices.push(new THREE.Matrix4().compose(
      new THREE.Vector3(center.x * TILE_SIZE, center.elevation - 0.18, center.z * TILE_SIZE),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, roll)),
      new THREE.Vector3(1, 1, 1),
    ));
    batch.rampSegments.push({
      routeId: center.rampRouteId,
      segmentIndex: center.rampSegmentIndex,
      directionX: center.rampDirectionX,
      directionZ: center.rampDirectionZ,
      startElevation: center.rampStartElevation,
      endElevation: center.rampEndElevation,
      centerX: center.x,
      centerZ: center.z,
    });
    batches.set(key, batch);
  }
  let index = 0;
  for (const {
    material,
    alongX,
    slopeLength,
    matrices,
    rampSegments,
  } of batches.values()) {
    index += 1;
    addInstancedMatrices(parent, {
      name: `assayLabRampDecks${index}`,
      geometry: createTiledBoxGeometry(
        alongX ? slopeLength : TILE_SIZE * RAMP_WIDTH_TILES,
        0.36,
        alongX ? TILE_SIZE * RAMP_WIDTH_TILES : slopeLength,
      ),
      material,
      matrices,
      userData: {
        collisionBacked: true,
        authoredTraversalSlope: true,
        rampSegments,
      },
    });
  }
}

function addFoundations(parent, plan, materials) {
  const datumY = plan.baseElevation + LAVA_BASIN_OFFSET - 0.45;
  const tiles = plan.floorTiles.filter((tile) => (
    tile.surface !== 'deepMagma'
      && tile.surfaceRole !== 'bridge'
      && !tile.surface.startsWith('serviceGrate')
      && tile.surfaceRole !== 'ramp'
  ));
  const renderTiles = tiles.map((tile) => ({
    ...tile,
    // The foundation supports the finish floor from below. Its previous top
    // was tile.elevation, exactly coplanar with the visible floor top and the
    // cause of room-wide texture flicker.
    foundationHeight: fixed(Math.max(
      0.02,
      tile.elevation - SOLID_FLOOR_THICKNESS - datumY,
    )),
  }));
  const batches = new Map();
  for (const run of collectContiguousXRuns(
    renderTiles,
    (tile) => `${tile.z}|${tile.foundationHeight}`,
  )) {
    const height = run.source.foundationHeight;
    const key = `${height}:${run.spanTiles}`;
    const batch = batches.get(key) ?? { height, spanTiles: run.spanTiles, matrices: [] };
    batch.matrices.push(new THREE.Matrix4().makeTranslation(
      ((run.startX + run.endX) * 0.5) * TILE_SIZE,
      datumY + height * 0.5,
      run.z * TILE_SIZE,
    ));
    batches.set(key, batch);
  }
  let batch = 0;
  for (const { height, spanTiles, matrices } of batches.values()) {
    batch += 1;
    addInstancedMatrices(parent, {
      name: `assayLabSupportedRockMass${batch}`,
      geometry: createTiledBoxGeometry(
        spanTiles * TILE_SIZE,
        height,
        TILE_SIZE,
      ),
      material: materials.basalt,
      matrices,
      userData: {
        structuralFoundation: true,
        supportBaseY: datumY,
        supportTopY: fixed(datumY + height),
        collisionBacked: true,
      },
    });
  }
}

function addLava(parent, plan, materials, traps) {
  const lavaTiles = plan.floorTiles.filter((tile) => tile.surface === 'deepMagma');
  const flat = lavaTiles.filter((tile) => !Number.isFinite(tile.rampStartElevation));
  addInstancedTiles(parent, {
    name: 'assayLabLavaTiles',
    tiles: flat,
    material: materials.magma,
    thickness: 0.22,
    yForTile: (tile) => tile.elevation - 0.11,
  });
  const cascadeMatrices = [];
  for (const tile of lavaTiles.filter((candidate) => Number.isFinite(candidate.rampStartElevation))) {
    const angle = -Math.atan2(
      tile.rampEndElevation - tile.rampStartElevation,
      TILE_SIZE,
    ) * tile.rampDirectionZ;
    cascadeMatrices.push(new THREE.Matrix4().compose(
      new THREE.Vector3(tile.x * TILE_SIZE, tile.elevation - 0.11, tile.z * TILE_SIZE),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(angle, 0, 0)),
      new THREE.Vector3(1, 1, 1),
    ));
  }
  addInstancedMatrices(parent, {
    name: 'assayLabLavaCascadeTiles',
    geometry: createTiledBoxGeometry(TILE_SIZE, 0.22, TILE_SIZE),
    material: materials.magma,
    matrices: cascadeMatrices,
    userData: { environmentalHazard: 'deepMagma' },
  });
  for (const tile of lavaTiles) {
    traps.push({
      id: `assayLava_${tile.x}_${tile.z}`,
      roomId: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
      label: 'Deep Magma',
      position: new THREE.Vector3(tile.x * TILE_SIZE, tile.elevation, tile.z * TILE_SIZE),
      halfWidth: TILE_SIZE * 0.5,
      halfDepth: TILE_SIZE * 0.5,
      verticalHalfHeight: 0.85,
      active: true,
      interactive: false,
      damagePerSecond: 24,
      movementMultiplier: 0.55,
      heatResistantMovementMultiplier: 0.8,
      hazardImmunityDamageMultiplier: 0.4,
      ambientHazardTags: ['environmentalHeat', 'fireFloor'],
      hazardPathCost: 18,
      heatCompatibleOnly: true,
    });
  }
}

function addCeiling(parent, plan, materials, aerialOnlyZones) {
  const occupied = new Map();
  for (const tile of plan.floorTiles) occupied.set(cellKey(tile.x, tile.z), tile);
  const ceilingY = plan.baseElevation + CHAMBER_HEADROOM;
  const tiles = [...occupied.values()];
  addTiledRowRuns(parent, {
    name: 'assayLabLocalCeilingBays',
    tiles,
    material: materials.basalt,
    thickness: 0.5,
    yForRun: () => ceilingY + 0.25,
    rowKeyForTile: (tile) => `${tile.z}`,
    userData: {
      localCeilingBays: true,
      cameraOcclusionSurface: false,
    },
  });
  const xsByZ = new Map();
  for (const tile of tiles) {
    const xs = xsByZ.get(tile.z) ?? [];
    xs.push(tile.x);
    xsByZ.set(tile.z, xs);
  }
  let runId = 0;
  for (const [z, xs] of xsByZ) {
    xs.sort((left, right) => left - right);
    let start = xs[0];
    let previous = xs[0];
    const flush = () => {
      runId += 1;
      const spanTiles = previous - start + 1;
      aerialOnlyZones.push(createSolidZone(
        `assayCeilingRun${runId}`,
        ((start + previous) * 0.5) * TILE_SIZE,
        ceilingY + 0.25,
        z * TILE_SIZE,
        spanTiles * TILE_SIZE * 0.5,
        TILE_SIZE * 0.51,
        0.25,
        'ceiling',
      ));
    };
    for (const x of xs.slice(1)) {
      if (x !== previous + 1) {
        flush();
        start = x;
      }
      previous = x;
    }
    flush();
  }
}

function addBoundaryWalls(
  parent,
  plan,
  materials,
  solidZones,
  aerialOnlyZones,
  omittedBoundaryWallKeys = new Set(),
) {
  const occupied = new Set(plan.floorTiles.map((tile) => cellKey(tile.x, tile.z)));
  const boundary = [];
  const directions = [
    { side: 'west', dx: -1, dz: 0 },
    { side: 'east', dx: 1, dz: 0 },
    { side: 'north', dx: 0, dz: -1 },
    { side: 'south', dx: 0, dz: 1 },
  ];
  const minY = plan.baseElevation + LAVA_BASIN_OFFSET - 0.4;
  const maxY = plan.baseElevation + CHAMBER_HEADROOM;
  const height = maxY - minY;
  const emittedBoundaryKeys = new Set();
  for (const tile of plan.floorTiles) {
    for (const direction of directions) {
      if (occupied.has(cellKey(tile.x + direction.dx, tile.z + direction.dz))) continue;
      if (omittedBoundaryWallKeys.has(`${tile.x},${tile.z}:${direction.side}`)) continue;
      // Stacked walkable tiers may legitimately share one X/Z column. The
      // Assay shell spans the complete signed room height, so that column owns
      // one wall panel/collider per side rather than one coincident copy per
      // elevation.
      const boundaryKey = `${tile.x},${tile.z}:${direction.side}`;
      if (emittedBoundaryKeys.has(boundaryKey)) continue;
      // The two physical sockets remain fully open. Their frames own the jambs.
      const isEntryOpening = direction.side === 'south'
        && tile.z === 20
        && tile.x >= 11
        && tile.x <= 13;
      const isExitOpening = direction.side === 'north'
        && tile.z === -20
        && tile.x >= 11
        && tile.x <= 13;
      const isLavaInlet = direction.side === 'south'
        && tile.z === 20
        && (tile.x === -1 || tile.x === 0);
      const isLavaOutlet = direction.side === 'north'
        && tile.z === -20
        && (tile.x === -1 || tile.x === 0);
      if (isEntryOpening || isExitOpening || isLavaInlet || isLavaOutlet) continue;
      emittedBoundaryKeys.add(boundaryKey);
      boundary.push({ tile, direction });
    }
  }
  const matricesByOrientation = new Map([['x', []], ['z', []]]);
  boundary.forEach(({ tile, direction }, index) => {
    const alongX = direction.side === 'north' || direction.side === 'south';
    const x = (tile.x + direction.dx * 0.5) * TILE_SIZE;
    const z = (tile.z + direction.dz * 0.5) * TILE_SIZE;
    matricesByOrientation.get(alongX ? 'x' : 'z').push(
      new THREE.Matrix4().makeTranslation(x, minY + height * 0.5, z),
    );
    const zone = createSolidZone(
      `assayBoundaryWall${index + 1}`,
      x,
      minY + height * 0.5,
      z,
      alongX ? TILE_SIZE * 0.52 : 0.22,
      alongX ? 0.22 : TILE_SIZE * 0.52,
      height * 0.5,
      'boundaryWall',
    );
    solidZones.push(zone);
    aerialOnlyZones.push(zone);
  });
  let batch = 0;
  for (const [orientation, matrices] of matricesByOrientation) {
    batch += 1;
    addInstancedMatrices(parent, {
      name: `assayLabCameraWallBatch${batch}`,
      geometry: createTiledBoxGeometry(
        orientation === 'x' ? TILE_SIZE : 0.44,
        height,
        orientation === 'x' ? 0.44 : TILE_SIZE,
      ),
      material: materials.basalt,
      matrices,
      userData: {
        cameraOcclusionSurface: true,
        cameraOcclusionWall: true,
        cameraOcclusionOwner: true,
        cameraOcclusionPerInstance: true,
        maximumBaySpan: 1,
        collisionBacked: true,
        literalWall: true,
      },
    });
  }
}

function addSocketFrame(parent, materials, solidZones, frame, isBulkhead = false) {
  const group = new THREE.Group();
  group.name = frame.id;
  group.position.set(frame.x * TILE_SIZE, frame.elevation, frame.z * TILE_SIZE);
  const openingWidth = frame.openingWidthMeters;
  const postOffset = openingWidth * 0.5 + 0.34;
  const alongZ = Math.abs(frame.facingZ) > 0.5;
  const postWidth = alongZ ? 0.68 : 0.48;
  const postDepth = alongZ ? 0.48 : 0.68;
  for (const sign of [-1, 1]) {
    const x = alongZ ? sign * postOffset : 0;
    const z = alongZ ? 0 : sign * postOffset;
    addBox(group, {
      name: `${frame.id}Post${sign < 0 ? 'Left' : 'Right'}`,
      width: postWidth,
      height: frame.openingHeightMeters + 1.2,
      depth: postDepth,
      x,
      y: (frame.openingHeightMeters + 1.2) * 0.5,
      z,
      material: isBulkhead ? materials.bronze : materials.blackMetal,
      userData: { socketFramePart: true, collisionBacked: true },
    });
    solidZones.push(createSolidZone(
      `${frame.id}PostCollision${sign}`,
      group.position.x + x,
      frame.elevation + (frame.openingHeightMeters + 1.2) * 0.5,
      group.position.z + z,
      postWidth * 0.5,
      postDepth * 0.5,
      (frame.openingHeightMeters + 1.2) * 0.5,
      'socketFramePost',
    ));
  }
  addBox(group, {
    name: `${frame.id}Lintel`,
    width: alongZ ? openingWidth + 1.5 : 0.48,
    height: 0.72,
    depth: alongZ ? 0.48 : openingWidth + 1.5,
    x: 0,
    y: frame.openingHeightMeters + 0.36,
    z: 0,
    material: isBulkhead ? materials.bronze : materials.blackMetal,
    userData: { socketFramePart: true, collisionBacked: true },
  });
  parent.add(group);
  return group;
}

function addRailRun(parent, materials, solidZones, {
  id,
  x,
  y,
  z,
  length,
  alongX,
  supportBaseY = null,
  supportExclusion = null,
}) {
  const rail = addBox(parent, {
    name: id,
    width: alongX ? length : 0.12,
    height: 0.12,
    depth: alongX ? 0.12 : length,
    x,
    y: y + 1.02,
    z,
    material: materials.rails,
    userData: { railing: true, collisionBacked: true },
  });
  solidZones.push(createSolidZone(
    `${id}Collision`, x, y + 0.62, z,
    alongX ? length * 0.5 : 0.1,
    alongX ? 0.1 : length * 0.5,
    0.62,
    'railing',
  ));
  const postCount = Math.max(2, Math.ceil(length / TILE_SIZE) + 1);
  const postMatrices = [];
  const supportMatrices = [];
  const supportHeight = Number.isFinite(supportBaseY)
    ? Math.max(0.2, y - supportBaseY)
    : 0;
  for (let index = 0; index < postCount; index += 1) {
    const offset = -length * 0.5 + (length * index) / (postCount - 1);
    const postX = x + (alongX ? offset : 0);
    const postZ = z + (alongX ? 0 : offset);
    postMatrices.push(new THREE.Matrix4().makeTranslation(postX, y + 0.525, postZ));
    const supportIsExcluded = supportExclusion?.({
      index,
      x: postX,
      z: postZ,
    }) === true;
    if (Number.isFinite(supportBaseY) && !supportIsExcluded) {
      supportMatrices.push(new THREE.Matrix4().makeTranslation(postX, 0, postZ));
      solidZones.push(createStructuralSupportZone(
        `${id}SupportCollision${index + 1}`,
        postX,
        postZ,
        supportBaseY,
        y,
        0.11,
        0.11,
      ));
    }
  }
  addInstancedMatrices(parent, {
    name: `${id}Posts`,
    geometry: createTiledBoxGeometry(0.11, 1.05, 0.11),
    material: materials.rails,
    matrices: postMatrices,
    userData: { railingPost: true },
  });
  if (supportMatrices.length > 0) {
    const supports = addInstancedMatrices(parent, {
      name: `${id}Supports`,
      geometry: createTiledBoxGeometry(0.22, supportHeight, 0.22),
      material: materials.blackMetal,
      matrices: supportMatrices,
      userData: {
        structuralSupport: true,
        supportBaseY,
        supportTopY: y,
        collisionBacked: true,
      },
    });
    supports.position.y = supportBaseY + supportHeight * 0.5;
  }
  return rail;
}

function addCausewayAndGallerySupports(parent, plan, materials, solidZones) {
  const datum = plan.baseElevation + LAVA_BASIN_OFFSET - 0.35;
  const bridgeTiles = plan.floorTiles.filter((tile) => tile.surfaceRole === 'bridge');
  const supportCells = bridgeTiles.filter((tile) => (
    ((tile.x === -6 && tile.z === -3) || (tile.x === 6 && tile.z === 1))
      || (tile.bridgeId === 'revealCascadeCrossing' && tile.z === 9 && (tile.x === -2 || tile.x === 1))
  ));
  for (const [index, tile] of supportCells.entries()) {
    const height = tile.elevation - datum;
    addBox(parent, {
      name: `assayBridgeSupport${index + 1}`,
      width: 0.7,
      height,
      depth: 0.7,
      x: tile.x * TILE_SIZE,
      y: datum + height * 0.5,
      z: tile.z * TILE_SIZE,
      material: materials.blackMetal,
      userData: {
        structuralSupport: true,
        supportBaseY: datum,
        supportTopY: tile.elevation,
        collisionBacked: true,
      },
    });
    solidZones.push(createStructuralSupportZone(
      `assayBridgeSupportCollision${index + 1}`,
      tile.x * TILE_SIZE,
      tile.z * TILE_SIZE,
      datum,
      tile.elevation,
      0.35,
      0.35,
    ));
  }
  const daisY = plan.baseElevation + DAIS_OFFSET;
  // Guard the exposed sides of both three-wide Seal causeway landings. These
  // runs sit outside the walkable Z edges; no rail or collision crosses the
  // X-aligned ramp-to-landing transition.
  for (const [id, x, z] of [
    ['sealCausewayWestNorthRail', -6 * TILE_SIZE, -4.55 * TILE_SIZE],
    ['sealCausewayWestSouthRail', -6 * TILE_SIZE, -1.45 * TILE_SIZE],
    ['sealCausewayEastNorthRail', 5 * TILE_SIZE, -0.55 * TILE_SIZE],
    ['sealCausewayEastSouthRail', 5 * TILE_SIZE, 2.55 * TILE_SIZE],
  ]) {
    addRailRun(parent, materials, solidZones, {
      id,
      x,
      y: daisY,
      z,
      length: TILE_SIZE * 3,
      alongX: true,
      supportBaseY: datum,
    });
  }
  for (const z of [7.55, 10.45]) {
    addRailRun(parent, materials, solidZones, {
      id: `revealCascadeCrossingRail${z < 9 ? 'North' : 'South'}`,
      x: -0.5 * TILE_SIZE,
      y: plan.baseElevation,
      z: z * TILE_SIZE,
      length: TILE_SIZE * 6,
      alongX: true,
      supportBaseY: datum,
    });
  }
  const galleryY = plan.baseElevation + GALLERY_OFFSET;
  for (const z of [-9, -5, -1]) {
    const supportHeight = galleryY - datum;
    for (const x of [-16.6, -14.2]) {
      if (x === -14.2 && z === -9) continue;
      addBox(parent, {
        name: `assayersGallerySupport_${x}_${z}`,
        width: 0.64,
        height: supportHeight,
        depth: 0.64,
        x: x * TILE_SIZE,
        y: datum + supportHeight * 0.5,
        z: z * TILE_SIZE,
        material: materials.blackMetal,
        userData: {
          structuralSupport: true,
          supportBaseY: datum,
          supportTopY: galleryY,
          collisionBacked: true,
        },
      });
      solidZones.push(createStructuralSupportZone(
        `assayersGallerySupportCollision_${x}_${z}`,
        x * TILE_SIZE,
        z * TILE_SIZE,
        datum,
        galleryY,
        0.32,
        0.32,
      ));
    }
  }
  addRailRun(parent, materials, solidZones, {
    id: 'assayersGalleryInnerRail',
    x: -13.55 * TILE_SIZE,
    y: galleryY,
    z: -5 * TILE_SIZE,
    length: TILE_SIZE * 10,
    alongX: false,
    supportBaseY: datum,
    // The elevated gallery crosses above the west Seal-return slope. Keep
    // the railing posts above the gallery, but do not extend their support
    // legs down through the three-wide ramp underneath.
    supportExclusion: ({ z }) => (
      z >= -4.1 * TILE_SIZE && z <= -1.9 * TILE_SIZE
    ),
  });
  const rearRailRuns = [
    { suffix: 'WestRun', startTiles: -17.5, endTiles: 4.2 },
    { suffix: 'EastRun', startTiles: 7.8, endTiles: 10.5 },
  ];
  for (const z of [-12.45, -9.55]) {
    for (const run of rearRailRuns) {
      addRailRun(parent, materials, solidZones, {
        id: `assayersRearCatwalkRail${z < -11 ? 'North' : 'South'}${run.suffix}`,
        x: (run.startTiles + run.endTiles) * 0.5 * TILE_SIZE,
        y: galleryY,
        z: z * TILE_SIZE,
        length: (run.endTiles - run.startTiles) * TILE_SIZE,
        alongX: true,
      });
    }
  }
  for (const x of [-16, -10, -4, 2]) {
    const supportHeight = galleryY - datum;
    addBox(parent, {
      name: `assayersRearCatwalkSupport${x}`,
      width: 0.68,
      height: supportHeight,
      depth: 0.68,
      x: x * TILE_SIZE,
      y: datum + supportHeight * 0.5,
      z: -11 * TILE_SIZE,
      material: materials.blackMetal,
      userData: {
        structuralSupport: true,
        supportBaseY: datum,
        supportTopY: galleryY,
        collisionBacked: true,
      },
    });
    solidZones.push(createStructuralSupportZone(
      `assayersRearCatwalkSupportCollision${x}`,
      x * TILE_SIZE,
      -11 * TILE_SIZE,
      datum,
      galleryY,
      0.34,
      0.34,
    ));
  }
}

function addDiggerExcavationDressing(parent, plan, materials, solidZones) {
  const baseY = plan.baseElevation;
  for (const [index, z] of [18, 15, 12].entries()) {
    const group = new THREE.Group();
    group.name = `assayDiggerBrace${index + 1}`;
    group.position.set(12 * TILE_SIZE, baseY, z * TILE_SIZE);
    for (const x of [-4.45, 4.45]) {
      addBox(group, {
        name: 'diggerBracePost',
        width: 0.34,
        height: 6.6,
        depth: 0.42,
        x,
        y: 3.3,
        z: 0,
        material: materials.blackMetal,
        userData: {
          structuralSupport: true,
          supportBaseY: baseY,
          supportTopY: baseY + 6.6,
          collisionBacked: true,
        },
      });
      solidZones.push(createSolidZone(
        `assayDiggerBrace${index + 1}Post${x < 0 ? 'Left' : 'Right'}Collision`,
        group.position.x + x,
        baseY + 3.3,
        group.position.z,
        0.17,
        0.21,
        3.3,
        'diggerBrace',
      ));
    }
    addBox(group, {
      name: 'diggerBraceHeader',
      width: 9.4,
      height: 0.42,
      depth: 0.46,
      x: 0,
      y: 6.4,
      z: 0,
      material: materials.blackMetal,
    });
    const lamp = addBox(group, {
      name: 'diggerWorkLamp',
      width: 0.62,
      height: 0.28,
      depth: 0.38,
      x: 2.6,
      y: 5.9,
      z: -0.28,
      material: materials.lamp,
      castShadow: false,
    });
    lamp.userData.recentExcavation = true;
    parent.add(group);
  }
  for (const [index, spec] of [
    { x: 8.7, z: 18.4, radius: 0.72, height: 0.62 },
    { x: 15.7, z: 15.2, radius: 0.84, height: 0.8 },
    { x: 7.1, z: 12.4, radius: 0.58, height: 0.5 },
    { x: -14.8, z: 4.8, radius: 0.76, height: 0.74 },
  ].entries()) {
    const rock = addCylinder(parent, {
      name: `diggerExcavationSpoil${index + 1}`,
      radius: spec.radius,
      height: spec.height,
      radialSegments: 6,
      x: spec.x * TILE_SIZE,
      y: baseY + (spec.z < 10 ? MAIN_FLOOR_OFFSET : 0) + spec.height * 0.5,
      z: spec.z * TILE_SIZE,
      yaw: index * 0.73,
      material: materials.basalt,
      userData: { hexagonalBasalt: true, collisionBacked: true },
    });
    solidZones.push(createSolidZone(
      `${rock.name}Collision`, rock.position.x, rock.position.y, rock.position.z,
      spec.radius, spec.radius, spec.height * 0.5, 'excavationDebris',
    ));
  }
  // Ceramic threshold makes the historical transition explicit without
  // closing the 8.4 m route.
  for (const x of [6.2, 17.8]) {
    addBox(parent, {
      name: `unearthedAncientThresholdColumn${x}`,
      width: 0.9,
      height: 8.4,
      depth: 1.0,
      x: x * TILE_SIZE,
      y: baseY + 4.2,
      z: 10.5 * TILE_SIZE,
      material: materials.ceramic,
      userData: { ancientThreshold: true, collisionBacked: true },
    });
    solidZones.push(createSolidZone(
      `unearthedAncientThresholdColumn${x}Collision`,
      x * TILE_SIZE,
      baseY + 4.2,
      10.5 * TILE_SIZE,
      0.45,
      0.5,
      4.2,
      'socketFramePost',
    ));
  }
  addBox(parent, {
    name: 'unearthedAncientThresholdLintel',
    width: 12.5 * TILE_SIZE,
    height: 0.9,
    depth: 1.0,
    x: 12 * TILE_SIZE,
    y: baseY + 8.1,
    z: 10.5 * TILE_SIZE,
    material: materials.ceramic,
    userData: { ancientThreshold: true },
  });
}

function addAssayMachinery(parent, plan, materials, solidZones, aerialOnlyZones) {
  const mainY = plan.baseElevation + MAIN_FLOOR_OFFSET;
  const furnaceSpecs = plan.furnacePattern === 'paired-prism'
    ? [
      { x: -14.5, z: -8.4, radius: 2.2, height: 7.2 },
      { x: -10.0, z: -8.4, radius: 2.2, height: 7.2 },
      { x: 8.3, z: -11.7, radius: 1.8, height: 6.2 },
    ]
    : [
      { x: -15.0, z: -8.5, radius: 2.0, height: 6.4 },
      { x: -10.7, z: -6.4, radius: 1.8, height: 7.4 },
      { x: 8.2, z: -11.8, radius: 2.1, height: 6.8 },
    ];
  for (const [index, spec] of furnaceSpecs.entries()) {
    const furnace = new THREE.Group();
    furnace.name = `assayPrismFurnace${index + 1}`;
    furnace.position.set(spec.x * TILE_SIZE, mainY, spec.z * TILE_SIZE);
    addCylinder(furnace, {
      name: 'prismFurnaceCeramicBody',
      radius: spec.radius,
      height: spec.height,
      radialSegments: 12,
      x: 0,
      y: spec.height * 0.5,
      z: 0,
      material: materials.ceramic,
      userData: { machinery: true, collisionBacked: true },
    });
    addCylinder(furnace, {
      name: 'prismFurnaceBronzeCollar',
      radius: spec.radius * 1.16,
      height: 0.55,
      radialSegments: 12,
      x: 0,
      y: spec.height * 0.66,
      z: 0,
      material: materials.bronze,
      userData: { machinery: true },
    });
    const lens = addCylinder(furnace, {
      name: 'prismFurnaceRefractorLens',
      radiusTop: 0.26,
      radiusBottom: 0.82,
      height: 1.25,
      radialSegments: 8,
      x: 0,
      y: spec.height + 0.62,
      z: 0,
      material: materials.seal,
      userData: { machinery: true, assayLens: true },
    });
    lens.rotation.z = index % 2 ? 0.22 : -0.22;
    parent.add(furnace);
    const zone = createSolidZone(
      `assayFurnaceCollision${index + 1}`,
      furnace.position.x,
      mainY + spec.height * 0.5,
      furnace.position.z,
      spec.radius * 1.15,
      spec.radius * 1.15,
      spec.height * 0.5,
      'assayMachinery',
    );
    solidZones.push(zone);
    aerialOnlyZones.push(zone);
  }
  // Monumental crucible arm and assay conduits remain behind the route.
  for (const [index, z] of [-6, 4].entries()) {
    const supportX = -16.4 * TILE_SIZE;
    addBox(parent, {
      name: `crucibleArmSupport${index + 1}`,
      width: 0.72,
      height: 8.8,
      depth: 0.72,
      x: supportX,
      y: mainY + 4.4,
      z: z * TILE_SIZE,
      material: materials.blackMetal,
      userData: {
        machinery: true,
        structuralSupport: true,
        supportBaseY: mainY,
        supportTopY: mainY + 8.8,
        collisionBacked: true,
      },
    });
    solidZones.push(createSolidZone(
      `crucibleArmSupportCollision${index + 1}`,
      supportX,
      mainY + 4.4,
      z * TILE_SIZE,
      0.36,
      0.36,
      4.4,
      'assayMachinery',
    ));
    addBox(parent, {
      name: `crucibleArmBeam${index + 1}`,
      width: 6.4,
      height: 0.55,
      depth: 0.62,
      x: supportX + 2.7,
      y: mainY + 8.2,
      z: z * TILE_SIZE,
      material: materials.blackMetal,
      userData: { machinery: true },
    });
    addCylinder(parent, {
      name: `crucibleArmChain${index + 1}`,
      radius: 0.12,
      height: 4.4,
      radialSegments: 8,
      x: supportX + 5.5,
      y: mainY + 5.8,
      z: z * TILE_SIZE,
      material: materials.chains,
      userData: { machinery: true },
    });
  }
  for (const [index, x] of [-12, -8, 8].entries()) {
    addCylinder(parent, {
      name: `assayFloorConduit${index + 1}`,
      radius: 0.32,
      height: 8.5,
      radialSegments: 12,
      x: x * TILE_SIZE,
      y: mainY + 0.32,
      z: -13.2 * TILE_SIZE,
      pitch: Math.PI / 2,
      material: materials.bronze,
      userData: { machinery: true, collisionBacked: true },
    });
    solidZones.push(createSolidZone(
      `assayFloorConduitCollision${index + 1}`,
      x * TILE_SIZE,
      mainY + 0.32,
      -13.2 * TILE_SIZE,
      0.34,
      4.25,
      0.34,
      'assayMachinery',
    ));
  }
}

function createSmelterSeal(parent, plan, materials, solidZones) {
  const position = new THREE.Vector3(
    plan.smelterSeal.position.x * TILE_SIZE,
    plan.smelterSeal.position.y,
    plan.smelterSeal.position.z * TILE_SIZE,
  );
  const pedestalPosition = new THREE.Vector3(
    plan.smelterSeal.pedestalPosition.x * TILE_SIZE,
    plan.smelterSeal.pedestalPosition.y,
    plan.smelterSeal.pedestalPosition.z * TILE_SIZE,
  );
  const pedestal = new THREE.Group();
  pedestal.name = 'smelterSealGrandPedestal';
  pedestal.position.copy(pedestalPosition);
  addCylinder(pedestal, {
    name: 'smelterSealPedestalPlinth',
    radius: 2.5,
    height: 0.8,
    radialSegments: 12,
    x: 0,
    y: 0.4,
    z: 0,
    material: materials.ceramic,
    userData: { permanentSealPedestal: true, collisionBacked: true },
  });
  addCylinder(pedestal, {
    name: 'smelterSealPedestalBronzeRing',
    radius: 1.72,
    height: 0.36,
    radialSegments: 12,
    x: 0,
    y: 0.92,
    z: 0,
    material: materials.bronze,
    userData: { permanentSealPedestal: true },
  });
  const cradle = addCylinder(pedestal, {
    name: 'smelterSealEmptyCradle',
    radiusTop: 0.68,
    radiusBottom: 1.1,
    height: 1.25,
    radialSegments: 8,
    x: 0,
    y: 1.48,
    z: 0,
    material: materials.blackMetal,
    userData: { permanentSealPedestal: true },
  });
  cradle.userData.remainsAfterSealPickup = true;
  parent.add(pedestal);
  solidZones.push(createSolidZone(
    'smelterSealPedestalCollision',
    pedestalPosition.x,
    pedestalPosition.y + 0.8,
    pedestalPosition.z,
    2.45,
    2.45,
    0.8,
    'credentialPedestal',
  ));

  const pickupRoot = new THREE.Group();
  pickupRoot.name = plan.smelterSeal.pickupId;
  pickupRoot.position.set(position.x, position.y + 0.42, position.z);
  pickupRoot.userData.credentialId = SMELTER_SEAL_ID;
  pickupRoot.userData.separateFromPedestal = true;
  const sealBody = addCylinder(pickupRoot, {
    name: 'smelterSealCollectibleBody',
    radiusTop: 0.68,
    radiusBottom: 0.68,
    height: 0.24,
    radialSegments: 12,
    x: 0,
    y: 1.72,
    z: 0,
    pitch: Math.PI / 2,
    material: materials.seal,
    castShadow: false,
    userData: { collectibleCredential: SMELTER_SEAL_ID },
  });
  const sealCore = addCylinder(pickupRoot, {
    name: 'smelterSealCollectibleCore',
    radiusTop: 0.18,
    radiusBottom: 0.44,
    height: 1.15,
    radialSegments: 8,
    x: 0,
    y: 1.72,
    z: 0,
    material: materials.seal,
    castShadow: false,
    userData: { collectibleCredential: SMELTER_SEAL_ID },
  });
  sealBody.userData.pulsesAssayMachinery = true;
  sealCore.userData.pulsesAssayMachinery = true;
  parent.add(pickupRoot);
  return { pedestal, pickupRoot, position };
}

function createBulkhead(parent, plan, materials, solidZones) {
  const { x, y, z, openingWidthMeters, openingHeightMeters } = plan.bulkhead.position
    ? { ...plan.bulkhead, ...plan.bulkhead.position }
    : plan.bulkhead;
  const group = new THREE.Group();
  group.name = SMELTER_BULKHEAD_DOOR_ID;
  group.position.set(x * TILE_SIZE, y, z * TILE_SIZE);
  const panelSpan = openingWidthMeters * 0.5;
  const panelGeometry = createTiledBoxGeometry(panelSpan, openingHeightMeters, 0.34);
  // The closure is a physical, tiled ancient-metal door. Lock state is carried
  // by the status light rather than an untextured full-panel emissive color.
  const leftPanel = new THREE.Mesh(panelGeometry, materials.blackMetal);
  const rightPanel = new THREE.Mesh(panelGeometry, materials.blackMetal);
  leftPanel.name = 'smelterBulkheadPanelLeft';
  rightPanel.name = 'smelterBulkheadPanelRight';
  leftPanel.position.set(-panelSpan * 0.5, openingHeightMeters * 0.5, 0);
  rightPanel.position.set(panelSpan * 0.5, openingHeightMeters * 0.5, 0);
  leftPanel.castShadow = true;
  rightPanel.castShadow = true;
  leftPanel.receiveShadow = true;
  rightPanel.receiveShadow = true;
  leftPanel.userData.worldUvTiled = true;
  rightPanel.userData.worldUvTiled = true;
  leftPanel.userData.doorPanel = true;
  rightPanel.userData.doorPanel = true;
  group.add(leftPanel, rightPanel);
  for (const [panel, side] of [[leftPanel, 'Left'], [rightPanel, 'Right']]) {
    for (const [index, localY] of [-1.65, 0, 1.65].entries()) {
      addBox(panel, {
        name: `smelterBulkhead${side}ReinforcingRib${index + 1}`,
        width: panelSpan * 0.82,
        height: 0.18,
        depth: 0.16,
        x: 0,
        y: localY,
        z: 0.24,
        material: materials.bronze,
        userData: { bulkheadPanelDetail: true },
      });
    }
  }
  for (const sign of [-1, 1]) {
    const postX = sign * (openingWidthMeters * 0.5 + 0.46);
    addBox(group, {
      name: `smelterBulkheadJamb${sign < 0 ? 'Left' : 'Right'}`,
      width: 0.72,
      height: openingHeightMeters + 1.3,
      depth: 0.78,
      x: postX,
      y: (openingHeightMeters + 1.3) * 0.5,
      z: 0,
      material: materials.bronze,
      userData: { bulkheadFrame: true, collisionBacked: true },
    });
    solidZones.push(createSolidZone(
      `smelterBulkheadJambCollision${sign}`,
      group.position.x + postX,
      y + (openingHeightMeters + 1.3) * 0.5,
      group.position.z,
      0.36,
      0.39,
      (openingHeightMeters + 1.3) * 0.5,
      'doorFrame',
    ));
  }
  addBox(group, {
    name: 'smelterBulkheadHeader',
    width: openingWidthMeters + 1.7,
    height: 0.85,
    depth: 0.82,
    x: 0,
    y: openingHeightMeters + 0.42,
    z: 0,
    material: materials.bronze,
    userData: { bulkheadFrame: true },
  });
  const light = addBox(group, {
    name: 'smelterBulkheadStatusLight',
    width: 1.4,
    height: 0.16,
    depth: 0.18,
    x: 0,
    y: openingHeightMeters + 0.5,
    z: -0.5,
    material: materials.gateReady,
    castShadow: false,
  });
  parent.add(group);
  return {
    id: SMELTER_BULKHEAD_DOOR_ID,
    label: 'Ember Crown Assay Bulkhead',
    object: group,
    frame: group,
    leftPanel,
    rightPanel,
    light,
    position: group.position.clone(),
    graphBlockingPosition: group.position.clone(),
    baseY: y,
    radius: 1.2,
    locked: true,
    closed: true,
    requiresKeycard: true,
    requiredKeycardId: SMELTER_SEAL_ID,
    progressionTier: 1,
    fromRoomId: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
    toRoomId: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
    opened: false,
    alongX: false,
    slidingAxis: 'x',
    leftPanelClosedOffset: -panelSpan * 0.5,
    rightPanelClosedOffset: panelSpan * 0.5,
    slidingOpenOffset: openingWidthMeters * 0.52,
    collisionHalfWidth: openingWidthMeters * 0.5,
    collisionHalfDepth: 0.2,
    collisionHeight: openingHeightMeters,
    interactionDisabled: false,
    thresholdAnchored: true,
  };
}

function createOrdinaryChest(parent, plan, materials, solidZones) {
  const y = plan.baseElevation + MAIN_FLOOR_OFFSET;
  const position = new THREE.Vector3(-14.5 * TILE_SIZE, y, 4.2 * TILE_SIZE);
  const object = new THREE.Group();
  object.name = 'assayDiggerSampleChest';
  object.position.copy(position);
  addBox(object, {
    name: 'assaySampleChestBase',
    width: 1.6,
    height: 0.7,
    depth: 1.18,
    x: 0,
    y: 0.35,
    z: 0,
    material: materials.blackMetal,
    userData: { collisionBacked: true },
  });
  addBox(object, {
    name: 'assaySampleChestLid',
    width: 1.68,
    height: 0.3,
    depth: 1.24,
    x: 0,
    y: 0.82,
    z: 0,
    material: materials.bronze,
    userData: { collisionBacked: true },
  });
  parent.add(object);
  solidZones.push(createSolidZone(
    'assayDiggerSampleChestCollision',
    position.x,
    y + 0.48,
    position.z,
    0.82,
    0.62,
    0.48,
    'rewardChest',
  ));
  return {
    id: 'assay-digger-sample-cache',
    object,
    position,
    opened: false,
    rareBoost: true,
    guaranteedKeycardId: null,
    containsKeycard: false,
    roomId: 'diggerSampleBay',
  };
}

function createEncounter(plan) {
  const y = plan.baseElevation + MAIN_FLOOR_OFFSET;
  const center = new THREE.Vector3(-11.5 * TILE_SIZE, y, -3.8 * TILE_SIZE);
  return {
    id: 'assaySideApronEncounter',
    label: 'Dormant Assay Custodians',
    roomId: 'westAssayApron',
    roster: ['basic', 'fast', 'ranged'],
    isBoss: false,
    zone: {
      id: 'assaySideApronEncounterZone',
      roomId: 'westAssayApron',
      position: center.clone(),
      halfWidth: 4.2 * TILE_SIZE,
      halfDepth: 2.8 * TILE_SIZE,
      active: true,
    },
    triggerZone: null,
    spawnPoints: [
      center.clone().add(new THREE.Vector3(-4.2, 0, -3.6)),
      center.clone().add(new THREE.Vector3(4.6, 0, 3.2)),
      center.clone().add(new THREE.Vector3(0, 0, -5.2)),
    ],
    spawned: false,
    cleared: false,
    enemyIds: [],
    requiredForTraversal: false,
    excludesCredentialId: SMELTER_SEAL_ID,
  };
}

function addRampRailings(parent, plan, materials, solidZones) {
  const rampTiles = plan.floorTiles.filter((tile) => tile.surfaceRole === 'ramp');
  const routeSegments = new Map();
  for (const tile of rampTiles) {
    const key = `${tile.rampRouteId}:${tile.rampSegmentIndex}`;
    const bucket = routeSegments.get(key) ?? [];
    bucket.push(tile);
    routeSegments.set(key, bucket);
  }
  let railIndex = 0;
  const handrailMatrices = { x: [], z: [] };
  const postMatrices = [];
  for (const segmentTiles of routeSegments.values()) {
    const center = segmentTiles.find((tile) => {
      if (tile.rampDirectionZ) return tile.x === Math.round(segmentTiles.reduce((sum, item) => sum + item.x, 0) / segmentTiles.length);
      return tile.z === Math.round(segmentTiles.reduce((sum, item) => sum + item.z, 0) / segmentTiles.length);
    }) ?? segmentTiles[Math.floor(segmentTiles.length / 2)];
    const directionX = center.rampDirectionX ?? 0;
    const directionZ = center.rampDirectionZ ?? 0;
    const sideX = directionZ;
    const sideZ = -directionX;
    const slope = Math.atan2(center.rampEndElevation - center.rampStartElevation, TILE_SIZE);
    for (const sign of [-1, 1]) {
      railIndex += 1;
      const x = (center.x + sideX * sign * 1.48) * TILE_SIZE;
      const z = (center.z + sideZ * sign * 1.48) * TILE_SIZE;
      const alongX = Math.abs(directionX) > 0.5;
      const railRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        directionZ ? -slope * directionZ : 0,
        0,
        directionX ? slope * directionX : 0,
      ));
      handrailMatrices[alongX ? 'x' : 'z'].push(new THREE.Matrix4().compose(
        new THREE.Vector3(x, center.elevation + 1.02, z),
        railRotation,
        new THREE.Vector3(1, 1, 1),
      ));
      postMatrices.push(new THREE.Matrix4().makeTranslation(
        x,
        center.elevation + 0.52,
        z,
      ));
      solidZones.push(createSolidZone(
        `assayRampRailCollision${railIndex}`,
        x,
        center.elevation + 0.56,
        z,
        alongX ? TILE_SIZE * 0.52 : 0.1,
        alongX ? 0.1 : TILE_SIZE * 0.52,
        0.56,
        'railing',
      ));
    }
  }
  addInstancedMatrices(parent, {
    name: 'assayRampHandrailsAlongX',
    geometry: createTiledBoxGeometry(TILE_SIZE * 1.04, 0.12, 0.12),
    material: materials.rails,
    matrices: handrailMatrices.x,
    userData: { railing: true, collisionBacked: true },
  });
  addInstancedMatrices(parent, {
    name: 'assayRampHandrailsAlongZ',
    geometry: createTiledBoxGeometry(0.12, 0.12, TILE_SIZE * 1.04),
    material: materials.rails,
    matrices: handrailMatrices.z,
    userData: { railing: true, collisionBacked: true },
  });
  addInstancedMatrices(parent, {
    name: 'assayRampRailPosts',
    geometry: createTiledBoxGeometry(0.11, 1.04, 0.11),
    material: materials.rails,
    matrices: postMatrices,
    userData: { railingPost: true, collisionBacked: true },
  });
}

function addRampSupports(parent, plan, materials, solidZones) {
  const datumY = plan.baseElevation + LAVA_BASIN_OFFSET - 0.35;
  const routeSegments = new Map();
  for (const tile of plan.floorTiles.filter((candidate) => candidate.surfaceRole === 'ramp')) {
    const key = `${tile.rampRouteId}:${tile.rampSegmentIndex}`;
    const segment = routeSegments.get(key) ?? [];
    segment.push(tile);
    routeSegments.set(key, segment);
  }
  const routeLastSegment = new Map();
  for (const segmentTiles of routeSegments.values()) {
    const center = segmentTiles[Math.floor(segmentTiles.length / 2)];
    routeLastSegment.set(
      center.rampRouteId,
      Math.max(routeLastSegment.get(center.rampRouteId) ?? 0, center.rampSegmentIndex),
    );
  }
  let supportIndex = 0;
  for (const segmentTiles of routeSegments.values()) {
    const center = segmentTiles[Math.floor(segmentTiles.length / 2)];
    const isSupportBay = center.rampSegmentIndex % 3 === 0
      || center.rampSegmentIndex === routeLastSegment.get(center.rampRouteId);
    if (!isSupportBay) continue;
    const directionX = center.rampDirectionX ?? 0;
    const directionZ = center.rampDirectionZ ?? 0;
    const sideX = directionZ;
    const sideZ = -directionX;
    const supportTopY = Math.min(
      center.rampStartElevation,
      center.rampEndElevation,
    ) - 0.3;
    if (supportTopY <= datumY + 0.2) continue;
    const supportHeight = supportTopY - datumY;
    for (const sign of [-1, 1]) {
      supportIndex += 1;
      const x = (center.x + sideX * sign * 1.22) * TILE_SIZE;
      const z = (center.z + sideZ * sign * 1.22) * TILE_SIZE;
      addBox(parent, {
        name: `assayRampSupport${supportIndex}`,
        width: 0.4,
        height: supportHeight,
        depth: 0.4,
        x,
        y: datumY + supportHeight * 0.5,
        z,
        material: materials.blackMetal,
        userData: {
          structuralSupport: true,
          supportBaseY: datumY,
          supportTopY,
          supportedRampRouteId: center.rampRouteId,
          collisionBacked: true,
        },
      });
      solidZones.push(createStructuralSupportZone(
        `assayRampSupport${supportIndex}Collision`,
        x,
        z,
        datumY,
        supportTopY,
        0.2,
        0.2,
      ));
    }
  }
}

function addLighting(parent, plan, materials) {
  const ambient = new THREE.HemisphereLight(0x978e82, 0x180805, 0.72);
  ambient.name = 'assayLabAmbientLight';
  parent.add(ambient);
  const approach = new THREE.DirectionalLight(0xffd2a6, 0.64);
  approach.name = 'assayLabDiggerApproachLight';
  approach.position.set(28, plan.baseElevation + 18, 52);
  approach.castShadow = false;
  parent.add(approach);
  for (const [index, spec] of [
    { x: -0.5, y: plan.baseElevation - 1.3, z: 16, color: 0xff5520, intensity: 2.5 },
    { x: -5.5, y: plan.baseElevation - 6.8, z: 2, color: 0xff4818, intensity: 3.0 },
    { x: 5.5, y: plan.baseElevation - 6.8, z: 2, color: 0xff4818, intensity: 3.0 },
    { x: 0, y: plan.baseElevation - 0.4, z: 1, color: 0xffb65d, intensity: 3.4 },
    { x: 12, y: plan.baseElevation + 3.5, z: -17, color: 0x67ffd4, intensity: 1.8 },
  ].entries()) {
    const light = new THREE.PointLight(spec.color, spec.intensity, 35, 1.8);
    light.name = `assayLabProcessLight${index + 1}`;
    light.position.set(spec.x * TILE_SIZE, spec.y, spec.z * TILE_SIZE);
    light.castShadow = false;
    parent.add(light);
  }
  // A restrained set of visible work lamps makes the recent dig legible.
  for (const [index, z] of [18, 15, 12].entries()) {
    const lamp = addBox(parent, {
      name: `assayLabWorkLightLens${index + 1}`,
      width: 0.55,
      height: 0.22,
      depth: 0.22,
      x: 15.4 * TILE_SIZE,
      y: plan.baseElevation + 4.8,
      z: z * TILE_SIZE,
      material: materials.lamp,
      castShadow: false,
      userData: { recentExcavation: true },
    });
    void lamp;
  }
}

export function assembleMagmaRefractorAssayLabRoom(plan, {
  textureLoader = new THREE.TextureLoader(),
  omittedSocketFrameIds = [],
  omittedBoundaryWallKeys = [],
} = {}) {
  if (plan?.moduleId !== MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID) {
    throw new Error(`Expected ${MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID} plan.`);
  }
  const group = new THREE.Group();
  group.name = 'magmaRefractorAssayLabRoom';
  group.userData.roomModuleId = plan.moduleId;
  group.userData.topologyRevision = plan.topologyRevision;
  group.userData.planHash = plan.planHash;
  group.userData.themePackId = plan.themePackId;
  group.userData.proceduralRoom = true;
  group.userData.shippingAuthoredAssetDependency = false;

  const materials = createMaterials(textureLoader);
  group.userData.authoredOwnedMaterials = new Set(Object.values(materials));
  const solidZones = [];
  const aerialOnlyZones = [];
  const traps = [];

  addFoundations(group, plan, materials);
  addFlatFloors(group, plan, materials);
  addRampFloors(group, plan, materials);
  addLava(group, plan, materials, traps);
  addBoundaryWalls(
    group,
    plan,
    materials,
    solidZones,
    aerialOnlyZones,
    new Set(omittedBoundaryWallKeys),
  );
  addCeiling(group, plan, materials, aerialOnlyZones);
  addRampRailings(group, plan, materials, solidZones);
  addRampSupports(group, plan, materials, solidZones);
  addCausewayAndGallerySupports(group, plan, materials, solidZones);
  addDiggerExcavationDressing(group, plan, materials, solidZones);
  addAssayMachinery(group, plan, materials, solidZones, aerialOnlyZones);

  const omitted = new Set(omittedSocketFrameIds);
  for (const frame of plan.socketFrames) {
    if (omitted.has(frame.id)) continue;
    addSocketFrame(group, materials, solidZones, frame, frame.socketId === 'assay-lab-ember-crown-socket');
  }

  const seal = createSmelterSeal(group, plan, materials, solidZones);
  const bulkhead = createBulkhead(group, plan, materials, solidZones);
  const sampleChest = createOrdinaryChest(group, plan, materials, solidZones);
  addLighting(group, plan, materials);

  const keycardDefinition = {
    keycardId: SMELTER_SEAL_ID,
    displayName: 'Smelter Seal',
    pairedDoorId: SMELTER_BULKHEAD_DOOR_ID,
    progressionTier: 1,
    spawnRoomId: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
    spawnMode: 'Pedestal',
    isRequiredForMainProgression: true,
    sourcePosition: seal.position.clone(),
    isCollected: false,
    credentialKind: 'facility-seal',
    opensDoorIdsOnCollect: [SMELTER_BULKHEAD_DOOR_ID],
  };
  const keycard = {
    id: plan.smelterSeal.pickupId,
    keycardId: SMELTER_SEAL_ID,
    displayName: 'Smelter Seal',
    pairedDoorId: SMELTER_BULKHEAD_DOOR_ID,
    progressionTier: 1,
    spawnRoomId: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
    spawnMode: 'Pedestal',
    isRequiredForMainProgression: true,
    object: seal.pickupRoot,
    position: seal.position.clone(),
    collected: false,
    protectedByEncounterId: null,
    credentialKind: 'facility-seal',
    opensDoorIdsOnCollect: [SMELTER_BULKHEAD_DOOR_ID],
  };
  const progressionDoor = {
    doorId: SMELTER_BULKHEAD_DOOR_ID,
    displayName: 'Ember Crown Assay Bulkhead',
    requiredKeycardId: SMELTER_SEAL_ID,
    progressionTier: 1,
    fromRoomId: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
    toRoomId: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
    position: bulkhead.position.clone(),
    isUnlocked: false,
    isCriticalPathDoor: true,
    isShrineDoor: false,
  };
  const progression = {
    entranceRoomId: MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
    bands: [{ bandId: 'assay-lab', roomIds: [MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID] }],
    roomConnections: [],
    doors: [progressionDoor],
    keycards: [keycardDefinition],
    shrineKey: null,
    validation: {
      accepted: true,
      errors: [],
      warnings: ['Development room fixture: the Ember Crown Shrine Concourse is not yet attached.'],
    },
  };

  const encounters = [createEncounter(plan)];
  const tiles = new Map();
  for (const tile of plan.floorTiles.filter((candidate) => candidate.surface !== 'deepMagma')) {
    const key = cellKey(tile.x, tile.z);
    const existing = tiles.get(key);
    if (!existing || tile.elevation < existing.elevation) tiles.set(key, { ...tile });
  }
  const minimap = {
    rooms: plan.chambers.map((chamber) => ({
      id: chamber.id,
      x: chamber.id === 'smelterSealDais' ? 0 : chamber.id === 'assayersGallery' ? -15.5 : chamber.id.includes('west') || chamber.id === 'diggerSampleBay' ? -12 : 11,
      z: chamber.id === 'diggerApproach' ? 17 : chamber.id === 'grandRevealTerrace' ? 9 : chamber.id === 'assayBulkheadLanding' ? -19 : chamber.id === 'smelterSealDais' ? 1 : -4,
      width: chamber.id === 'smelterSealDais' ? 7 : 9,
      depth: chamber.id === 'diggerApproach' ? 7 : 8,
      baseElevation: chamber.elevation,
      discovered: chamber.id === 'diggerApproach',
    })),
    connections: [
      { id: 'assay-entry-descent', from: 'grandRevealTerrace', to: 'eastAssayApron', elevationDelta: MAIN_FLOOR_OFFSET },
      { id: 'east-dais-rise', from: 'eastAssayApron', to: 'smelterSealDais', elevationDelta: -DAIS_OFFSET },
      { id: 'west-dais-return', from: 'smelterSealDais', to: 'westAssayApron', elevationDelta: DAIS_OFFSET - MAIN_FLOOR_OFFSET },
      { id: 'assay-rear-rise', from: 'eastAssayApron', to: 'assayBulkheadLanding', elevationDelta: -MAIN_FLOOR_OFFSET },
      { id: 'assayer-gallery-rise', from: 'grandRevealTerrace', to: 'assayersGallery', elevationDelta: GALLERY_OFFSET },
    ],
    environmentalSpines: [{
      id: LAVA_CONTINUITY_TAG,
      inletSocketId: 'assay-lab-lava-inlet',
      outletSocketId: 'assay-lab-lava-outlet',
      active: true,
    }],
  };

  const occlusionWalls = [];
  const invalidOcclusionObjects = [];
  const structuralSupports = [];
  const renderedMeshes = [];
  group.traverse((object) => {
    if (!object.isMesh && !object.isInstancedMesh) return;
    renderedMeshes.push(object);
    if (object.userData?.cameraOcclusionWall === true) occlusionWalls.push(object);
    if (object.userData?.cameraOcclusionSurface === true && object.userData?.cameraOcclusionWall !== true) {
      invalidOcclusionObjects.push(object);
    }
    if (object.userData?.structuralSupport === true) structuralSupports.push(object);
  });
  group.updateMatrixWorld(true);
  const supportWorldPosition = new THREE.Vector3();
  const supportInstanceMatrix = new THREE.Matrix4();
  const supportWorldMatrix = new THREE.Matrix4();
  const supportDatumViolations = [];
  for (const support of structuralSupports) {
    const height = support.geometry?.parameters?.height;
    if (!Number.isFinite(height) || !Number.isFinite(support.userData.supportBaseY)) continue;
    if (support.isInstancedMesh) {
      for (let index = 0; index < support.count; index += 1) {
        support.getMatrixAt(index, supportInstanceMatrix);
        supportWorldMatrix.multiplyMatrices(support.matrixWorld, supportInstanceMatrix);
        supportWorldPosition.setFromMatrixPosition(supportWorldMatrix);
        if (Math.abs(supportWorldPosition.y - height * 0.5 - support.userData.supportBaseY) > 0.001) {
          supportDatumViolations.push({ support, instanceId: index });
        }
      }
      continue;
    }
    support.getWorldPosition(supportWorldPosition);
    if (Math.abs(supportWorldPosition.y - height * 0.5 - support.userData.supportBaseY) > 0.001) {
      supportDatumViolations.push({ support, instanceId: null });
    }
  }
  const wallCollisionCount = solidZones.filter((zone) => zone.obstacleKind === 'boundaryWall').length;
  const stackedClearanceViolations = plan.stackedWalkableColumns.filter((column) => column.clearVerticalMeters < 8.4 - 0.001);
  const boundsRadius = Math.hypot(ROOM_WIDTH_TILES, ROOM_DEPTH_TILES) * TILE_SIZE * 0.55;
  const lavaInlet = plan.sockets.find((socket) => socket.id === 'assay-lab-lava-inlet');
  const lavaOutlet = plan.sockets.find((socket) => socket.id === 'assay-lab-lava-outlet');
  const aerialBoundaryZones = [...new Map([
    ...aerialOnlyZones,
    ...solidZones.filter((zone) => /wall|socket|doorFrame|assayMachinery|diggerBrace/i.test(zone.obstacleKind)),
  ].map((zone) => [zone.id, zone])).values()];

  return {
    group,
    dungeonKind: 'magmaRefractorAssayLabDevelopmentFixture',
    dungeonFamilyId: 'industrial-v1',
    themePackId: plan.themePackId,
    developmentFixture: true,
    rooms: [plan.room],
    roomModuleIds: [plan.moduleId],
    tiles,
    floorTiles: plan.floorTiles.map((tile) => ({ ...tile })),
    rampLandings: plan.rampLandings.map((landing) => ({ ...landing })),
    socketFrames: plan.socketFrames.map((frame) => ({ ...frame })),
    verticalConnectors: [],
    connectionPlans: [],
    progression,
    minimap,
    doors: [bulkhead],
    keycards: [keycard],
    keySeeker: null,
    chests: [sampleChest],
    mechanisms: [],
    ladders: [],
    connectorLifts: [],
    puzzleBlocks: [],
    pressurePlates: [],
    conveyorPuzzles: [],
    platforms: [],
    npcAnimationMixers: [],
    npcAnimators: [],
    safeInteractables: [],
    safeZones: [],
    solidZones,
    aerialBoundaryZones,
    encounters,
    traps,
    conveyors: [],
    shrine: null,
    tileSize: TILE_SIZE,
    playerStart: new THREE.Vector3(12 * TILE_SIZE, plan.baseElevation, 18 * TILE_SIZE),
    playerStartFacing: new THREE.Vector3(0, 0, -1),
    campReturnPosition: new THREE.Vector3(12 * TILE_SIZE, plan.baseElevation, 18 * TILE_SIZE),
    ruinEntryPosition: new THREE.Vector3(12 * TILE_SIZE, plan.baseElevation, 18 * TILE_SIZE),
    enemySpawnPoints: encounters.flatMap((encounter) => encounter.spawnPoints.map((position) => position.clone())),
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
      inletSocketId: lavaInlet.id,
      outletSocketId: lavaOutlet.id,
      continuityTag: LAVA_CONTINUITY_TAG,
    }],
    supportDiagnostics: {
      structuralSupportCount: structuralSupports.reduce((count, support) => (
        count + (support.isInstancedMesh ? support.count : 1)
      ), 0),
      structuralFoundationCount: renderedMeshes.filter((mesh) => mesh.userData?.structuralFoundation).length,
      supportDatumViolationCount: supportDatumViolations.length,
      unresolvedElevatedFootprintCount: 0,
    },
    moduleManifestDiagnostics: {
      accepted: supportDatumViolations.length === 0
        && wallCollisionCount >= occlusionWalls.length
        && invalidOcclusionObjects.length === 0
        && stackedClearanceViolations.length === 0,
      schema: plan.schema,
      moduleId: plan.moduleId,
      topologyRevision: plan.topologyRevision,
      planHash: plan.planHash,
      textureTiling: plan.textureContract,
      authoredRoomAssetDependency: false,
      safeRequiredRoute: true,
      criticalPathEncounterLocked: false,
      entryElevation: plan.baseElevation,
      mainFloorElevation: fixed(plan.baseElevation + MAIN_FLOOR_OFFSET),
      sealDaisElevation: fixed(plan.baseElevation + DAIS_OFFSET),
      galleryElevation: fixed(plan.baseElevation + GALLERY_OFFSET),
      exitElevation: plan.baseElevation,
      minimumRouteWidthTiles: 3,
      minimumHeadroomMeters: 8.4,
      rampLandingCount: plan.rampLandings.length,
      minimumRampLandingTiles: 3,
      stackedWalkableColumnCount: plan.stackedWalkableColumns.length,
      stackedClearanceViolationCount: stackedClearanceViolations.length,
      lavaContinuityAccepted: true,
      dryRequiredRoute: true,
      untexturedVoidCellCount: 0,
      exteriorVoidVisible: false,
      giantShellPresent: false,
      smelterSeal: { ...plan.smelterSeal },
      bulkhead: { ...plan.bulkhead },
      furnacePattern: plan.furnacePattern,
      sampleBaySide: plan.sampleBaySide,
      cameraOcclusion: {
        ...plan.cameraOcclusion,
        wallOwnerCount: occlusionWalls.length,
        nonWallOwnerCount: invalidOcclusionObjects.length,
      },
      collisionParity: {
        visibleWallCount: occlusionWalls.length,
        wallCollisionCount,
        accepted: wallCollisionCount >= occlusionWalls.length,
      },
    },
    spatialGenerationDiagnostics: {
      contractId: 'ruindivex-dungeon-generation/v2-authored-room',
      accepted: true,
      errors: [],
      warnings: ['Standalone development room; dungeon-wide connector-family coverage is not evaluated.'],
      roomCount: 1,
      floorTileCount: plan.floorTiles.length,
      signedConnectorCount: 0,
      elevationRange: {
        min: fixed(plan.baseElevation + LAVA_BASIN_OFFSET),
        max: fixed(plan.baseElevation + GALLERY_OFFSET),
        span: fixed(GALLERY_OFFSET - LAVA_BASIN_OFFSET),
      },
    },
    planHash: plan.planHash,
  };
}

export function generateMagmaRefractorAssayLabRoom(options = {}) {
  const plan = createMagmaRefractorAssayLabPlan(options);
  return assembleMagmaRefractorAssayLabRoom(plan, options);
}
