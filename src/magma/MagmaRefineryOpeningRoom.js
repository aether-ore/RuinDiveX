import * as THREE from 'three';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../TraversalCapabilities.js';

export const MAGMA_REFINERY_OPENING_MODULE_ID = 'magma-breached-freight-adit';
export const MAGMA_REFINERY_OPENING_TOPOLOGY_REVISION = 6;

const TILE_SIZE = 2.8;
const ROOM_WIDTH_TILES = 25;
const ROOM_DEPTH_TILES = 25;
const ROOM_CEILING_Y = 14;
const HIGH_TERRACE_Y = 5.6;
const MID_LANDING_Y = 2.8;
const LAVA_SURFACE_Y = -2.8;
const LAVA_STREAM_WIDTH = 4.2;
const JUMP_AIR_GAP = 2.4;
const TEXTURE_ROOT = '/assets/textures/magma-refinery/cells/seamless/';

const TEXTURE_SETS = Object.freeze({
  basalt: 'basalt',
  ashStone: 'ash-mineral-stone',
  blackMetal: 'blackened-metal',
  rails: 'rails',
  serviceGrate: 'service-grate',
  ceramic: 'ceramic',
  bronze: 'oxidized-bronze',
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
  return `magma-opening:${hashString(JSON.stringify(plan)).toString(16).padStart(8, '0')}`;
}

function tileKey(x, z, elevation = 0) {
  return `${x},${z}@${Number(elevation).toFixed(3)}`;
}

function lavaCenterXAt(z) {
  if (z >= 2) return 2;
  if (z >= -2) return 3;
  return 2;
}

function addRect(target, minX, maxX, minZ, maxZ) {
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) target.add(`${x},${z}`);
  }
}

function createFloorPlan() {
  const lavaCells = new Set();
  for (let z = -12; z <= 4; z += 1) {
    const centerX = lavaCenterXAt(z);
    lavaCells.add(`${centerX},${z}`);
    lavaCells.add(`${centerX + 1},${z}`);
  }

  const groundCells = new Set();
  addRect(groundCells, -4, 4, 5, 11);
  addRect(groundCells, -1, 1, 12, 12);
  addRect(groundCells, -10, -4, -8, 7);
  addRect(groundCells, -4, 1, 1, 7);
  addRect(groundCells, -3, -1, 0, 4);
  for (let z = -8; z <= 6; z += 1) {
    const centerX = lavaCenterXAt(z);
    addRect(groundCells, centerX + 2, Math.min(13, centerX + 7), z, z);
  }
  addRect(groundCells, -2, 9, -11, -6);
  addRect(groundCells, 8, 10, -12, -12);
  for (const cell of lavaCells) groundCells.delete(cell);

  const westRecoveryCells = [];
  for (let z = 3; z <= 8; z += 1) {
    for (let x = -5; x <= -3; x += 1) {
      westRecoveryCells.push({ x, z });
      groundCells.delete(`${x},${z}`);
    }
  }
  const eastRecoveryCells = [];
  for (let z = 0; z >= -5; z -= 1) {
    for (let x = 4; x <= 6; x += 1) {
      eastRecoveryCells.push({ x, z });
      groundCells.delete(`${x},${z}`);
    }
  }
  const recoveryShelfCells = [];
  for (let x = -5; x <= 1; x += 1) {
    for (let z = 0; z <= 2; z += 1) {
      recoveryShelfCells.push({ x, z });
      groundCells.delete(`${x},${z}`);
    }
  }
  for (let x = 4; x <= 6; x += 1) {
    for (let z = 1; z <= 3; z += 1) {
      recoveryShelfCells.push({ x, z });
      groundCells.delete(`${x},${z}`);
    }
  }

  // Every ramp endpoint owns a clear, flat 3x3 landing rather than relying on
  // incidental nearby floor. These ground-level additions connect the landings
  // to the safe primary route without widening the entire cavern.
  addRect(groundCells, -9, -5, 8, 10);
  addRect(groundCells, -5, -3, 9, 11);
  addRect(groundCells, 8, 10, -11, -7);

  const floors = [];
  for (const cell of groundCells) {
    const [x, z] = cell.split(',').map(Number);
    floors.push({
      x,
      z,
      elevation: 0,
      level: 0,
      surface: z >= 5 ? 'diggerExcavationRock' : 'magmaBasaltPath',
      surfaceRole: 'floor',
      roomId: MAGMA_REFINERY_OPENING_MODULE_ID,
      roomBaseElevation: 0,
    });
  }

  for (const cell of lavaCells) {
    const [x, z] = cell.split(',').map(Number);
    floors.push({
      x,
      z,
      elevation: LAVA_SURFACE_Y,
      level: -1,
      surface: 'deepMagma',
      surfaceRole: 'hazard-floor',
      roomId: MAGMA_REFINERY_OPENING_MODULE_ID,
      roomBaseElevation: 0,
      allowsGroundedDropLanding: true,
      hazardPathCost: 18,
      heatCompatibleOnly: true,
    });
  }

  for (const { x, z } of recoveryShelfCells) {
    floors.push({
      x,
      z,
      elevation: LAVA_SURFACE_Y,
      level: -1,
      surface: 'magmaRecoveryShelf',
      surfaceRole: 'floor',
      roomId: MAGMA_REFINERY_OPENING_MODULE_ID,
      roomBaseElevation: 0,
      allowsGroundedDropLanding: true,
    });
  }

  const addRampFlight = ({ id, cells, startElevation, endElevation, directionX = 0, directionZ = 0 }) => {
    const longitudinal = [...new Set(cells.map(({ x, z }) => (directionX ? x : z)))];
    longitudinal.sort((left, right) => (directionX || directionZ) > 0 ? left - right : right - left);
    const progressByAxis = new Map(longitudinal.map((axis, index) => [axis, index / longitudinal.length]));
    const step = (endElevation - startElevation) / longitudinal.length;
    for (const { x, z } of cells) {
      const axis = directionX ? x : z;
      const progress = progressByAxis.get(axis) ?? 0;
      const rampStartElevation = startElevation + (endElevation - startElevation) * progress;
      const rampEndElevation = rampStartElevation + step;
      floors.push({
        x,
        z,
        elevation: (rampStartElevation + rampEndElevation) * 0.5,
        level: Math.round(((rampStartElevation + rampEndElevation) * 0.5) / MID_LANDING_Y),
        surface: 'magmaRefineryCatwalkRamp',
        surfaceRole: 'ramp',
        roomId: MAGMA_REFINERY_OPENING_MODULE_ID,
        roomBaseElevation: 0,
        rampRouteId: id,
        rampStartElevation,
        rampEndElevation,
        rampDirectionX: directionX,
        rampDirectionZ: directionZ,
        groundedStepTransitionHeight: PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile + 0.05,
      });
    }
  };

  addRampFlight({
    id: 'lava-west-ramp-out',
    cells: westRecoveryCells,
    startElevation: LAVA_SURFACE_Y,
    endElevation: 0,
    directionZ: 1,
  });
  addRampFlight({
    id: 'lava-east-ramp-out',
    cells: eastRecoveryCells,
    startElevation: LAVA_SURFACE_Y,
    endElevation: 0,
    directionZ: -1,
  });

  const firstFlightCells = [];
  for (let z = 7; z >= 2; z -= 1) {
    for (let x = -9; x <= -7; x += 1) firstFlightCells.push({ x, z });
  }
  addRampFlight({
    id: 'digger-catwalk-flight-1',
    cells: firstFlightCells,
    startElevation: 0,
    endElevation: MID_LANDING_Y,
    directionZ: -1,
  });

  for (let x = -9; x <= -4; x += 1) {
    for (let z = -1; z <= 2; z += 1) {
      floors.push({
        x,
        z,
        elevation: MID_LANDING_Y,
        level: 1,
        surface: 'magmaRefineryCatwalkLanding',
        surfaceRole: 'catwalk',
        roomId: MAGMA_REFINERY_OPENING_MODULE_ID,
        roomBaseElevation: 0,
      });
    }
  }

  const secondFlightCells = [];
  for (let z = -1; z >= -6; z -= 1) {
    for (let x = -6; x <= -4; x += 1) secondFlightCells.push({ x, z });
  }
  addRampFlight({
    id: 'digger-catwalk-flight-2',
    cells: secondFlightCells,
    startElevation: MID_LANDING_Y,
    endElevation: HIGH_TERRACE_Y,
    directionZ: -1,
  });

  for (let x = -8; x <= -4; x += 1) {
    for (let z = -11; z <= -7; z += 1) {
      floors.push({
        x,
        z,
        elevation: HIGH_TERRACE_Y,
        level: 2,
        surface: 'ancientInspectionTerrace',
        surfaceRole: 'catwalk',
        roomId: MAGMA_REFINERY_OPENING_MODULE_ID,
        roomBaseElevation: 0,
      });
    }
  }

  const descentCells = [];
  for (let x = -3; x <= 7; x += 1) {
    for (let z = -11; z <= -9; z += 1) descentCells.push({ x, z });
  }
  addRampFlight({
    id: 'ancient-terrace-descent',
    cells: descentCells,
    startElevation: HIGH_TERRACE_Y,
    endElevation: 0,
    directionX: 1,
  });

  const undercroftFootprints = new Set(floors
    .filter((floor) => (
      floor.surfaceRole === 'catwalk'
        || (floor.surfaceRole === 'ramp' && floor.rampRouteId?.startsWith('digger-catwalk'))
    ))
    .map((floor) => `${floor.x},${floor.z}`));
  for (const footprint of undercroftFootprints) {
    const [x, z] = footprint.split(',').map(Number);
    const existingFloor = floors.find((floor) => (
      floor.x === x
        && floor.z === z
        && Math.abs(floor.elevation - LAVA_SURFACE_Y) < 0.001
        && floor.surfaceRole !== 'ramp'
    ));
    if (existingFloor) {
      existingFloor.supportsElevatedRoute = true;
      continue;
    }
    floors.push({
      x,
      z,
      elevation: LAVA_SURFACE_Y,
      level: -1,
      surface: 'magmaUndercroftFloor',
      surfaceRole: 'floor',
      roomId: MAGMA_REFINERY_OPENING_MODULE_ID,
      roomBaseElevation: 0,
      allowsGroundedDropLanding: true,
      supportsElevatedRoute: true,
    });
  }

  const rampFootprints = new Set(floors
    .filter((floor) => floor.surfaceRole === 'ramp')
    .map((floor) => `${floor.x},${floor.z}`));
  const unique = new Map();
  for (const floor of floors) {
    if (
      floor.surfaceRole !== 'ramp'
      && rampFootprints.has(`${floor.x},${floor.z}`)
      && floor.supportsElevatedRoute !== true
    ) continue;
    unique.set(tileKey(floor.x, floor.z, floor.elevation), floor);
  }
  return [...unique.values()];
}

function createRampLandingPlan() {
  return [
    { id: 'lava-west-lower-landing', rampRouteId: 'lava-west-ramp-out', endpoint: 'lower', elevation: LAVA_SURFACE_Y, minX: -5, maxX: -3, minZ: 0, maxZ: 2 },
    { id: 'lava-west-upper-landing', rampRouteId: 'lava-west-ramp-out', endpoint: 'upper', elevation: 0, minX: -5, maxX: -3, minZ: 9, maxZ: 11 },
    { id: 'lava-east-lower-landing', rampRouteId: 'lava-east-ramp-out', endpoint: 'lower', elevation: LAVA_SURFACE_Y, minX: 4, maxX: 6, minZ: 1, maxZ: 3 },
    { id: 'lava-east-upper-landing', rampRouteId: 'lava-east-ramp-out', endpoint: 'upper', elevation: 0, minX: 4, maxX: 6, minZ: -8, maxZ: -6 },
    { id: 'digger-flight-one-lower-landing', rampRouteId: 'digger-catwalk-flight-1', endpoint: 'lower', elevation: 0, minX: -9, maxX: -7, minZ: 8, maxZ: 10 },
    { id: 'digger-flight-one-upper-landing', rampRouteId: 'digger-catwalk-flight-1', endpoint: 'upper', elevation: MID_LANDING_Y, minX: -9, maxX: -7, minZ: -1, maxZ: 1 },
    { id: 'digger-flight-two-lower-landing', rampRouteId: 'digger-catwalk-flight-2', endpoint: 'lower', elevation: MID_LANDING_Y, minX: -6, maxX: -4, minZ: 0, maxZ: 2 },
    { id: 'digger-flight-two-upper-landing', rampRouteId: 'digger-catwalk-flight-2', endpoint: 'upper', elevation: HIGH_TERRACE_Y, minX: -6, maxX: -4, minZ: -9, maxZ: -7 },
    { id: 'ancient-descent-upper-landing', rampRouteId: 'ancient-terrace-descent', endpoint: 'upper', elevation: HIGH_TERRACE_Y, minX: -8, maxX: -6, minZ: -11, maxZ: -9 },
    { id: 'ancient-descent-lower-landing', rampRouteId: 'ancient-terrace-descent', endpoint: 'lower', elevation: 0, minX: 8, maxX: 10, minZ: -11, maxZ: -9 },
  ].map((landing) => ({
    ...landing,
    widthTiles: landing.maxX - landing.minX + 1,
    depthTiles: landing.maxZ - landing.minZ + 1,
    clearWidthMeters: Number(((landing.maxX - landing.minX + 1) * TILE_SIZE).toFixed(3)),
    clearDepthMeters: Number(((landing.maxZ - landing.minZ + 1) * TILE_SIZE).toFixed(3)),
    propFree: true,
  }));
}

function createRockInfillPlan(floorTiles, random) {
  const occupied = new Set(floorTiles.map((tile) => `${tile.x},${tile.z}`));
  const infill = [];
  const halfWidth = Math.floor(ROOM_WIDTH_TILES / 2);
  const halfDepth = Math.floor(ROOM_DEPTH_TILES / 2);
  for (let x = -halfWidth; x <= halfWidth; x += 1) {
    for (let z = -halfDepth; z <= halfDepth; z += 1) {
      if (occupied.has(`${x},${z}`)) continue;
      const baseY = LAVA_SURFACE_Y - 0.6;
      const edgeDistance = Math.min(halfWidth - Math.abs(x), halfDepth - Math.abs(z));
      const topY = edgeDistance <= 0
        ? 7 + random() * 1.2
        : edgeDistance === 1
          ? 3.6 + random() * 0.9
          : 0.7 + random() * 0.45;
      const radius = TILE_SIZE * 0.54;
      infill.push({
        id: `cavern-infill-${x}-${z}`,
        x: x * TILE_SIZE,
        y: (baseY + topY) * 0.5,
        z: z * TILE_SIZE,
        radius,
        radialSegments: 6,
        halfWidth: Math.cos(Math.PI / 6) * radius,
        halfDepth: radius,
        verticalHalfHeight: (topY - baseY) * 0.5,
        topY,
        profile: edgeDistance <= 1 ? 'outer-cavern-rise' : 'low-route-shelf',
        shape: 'hexagonal-basalt-column',
      });
    }
  }
  return infill;
}

function createBoundaryPlan(random) {
  const walls = [];
  const addWall = (id, x, z, halfWidth, halfDepth, height = ROOM_CEILING_Y) => {
    walls.push({
      id,
      x,
      y: height * 0.5,
      z,
      halfWidth,
      halfDepth,
      verticalHalfHeight: height * 0.5,
    });
  };

  for (let x = -12; x <= 12; x += 1) {
    if (x < -1 || x > 1) {
      const offset = (random() - 0.5) * 0.55;
      addWall(`south-cavern-${x}`, x * TILE_SIZE, 12.5 * TILE_SIZE + offset, TILE_SIZE * 0.52, 0.42);
    }
    const northPlayerOpening = x >= 8 && x <= 10;
    const northLavaOpening = x >= 2 && x <= 3;
    if (!northPlayerOpening && !northLavaOpening) {
      const offset = (random() - 0.5) * 0.55;
      addWall(`north-cavern-${x}`, x * TILE_SIZE, -12.5 * TILE_SIZE + offset, TILE_SIZE * 0.52, 0.42);
    }
  }
  for (let z = -12; z <= 12; z += 1) {
    const leftOffset = (random() - 0.5) * 0.55;
    const rightOffset = (random() - 0.5) * 0.55;
    addWall(`west-cavern-${z}`, -12.5 * TILE_SIZE + leftOffset, z * TILE_SIZE, 0.42, TILE_SIZE * 0.52);
    addWall(`east-cavern-${z}`, 12.5 * TILE_SIZE + rightOffset, z * TILE_SIZE, 0.42, TILE_SIZE * 0.52);
  }

  return walls;
}

function createRubblePlan(random) {
  const rubble = [];
  for (let index = 0; index < 10; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    rubble.push({
      id: `digger-rubble-${index + 1}`,
      x: side * (10.5 + random() * 0.8) * TILE_SIZE,
      y: 0.18 + random() * 0.18,
      z: (4.8 + random() * 2.4) * TILE_SIZE,
      width: 0.55 + random() * 1.25,
      height: 0.35 + random() * 0.65,
      depth: 0.55 + random() * 1.3,
      yaw: random() * Math.PI,
    });
  }
  return rubble;
}

export function createMagmaRefineryOpeningPlan({
  seed = 'magma-opening-default',
  random = null,
  tileSize = TILE_SIZE,
} = {}) {
  if (Math.abs(tileSize - TILE_SIZE) > 0.0001) {
    throw new Error(`Magma opening room requires the shared ${TILE_SIZE} m macro tile.`);
  }
  const rng = random ?? createSeededRandom(seed);
  const floorTiles = createFloorPlan();
  const rampLandings = createRampLandingPlan();
  const rockInfill = createRockInfillPlan(floorTiles, rng);
  const boundaryWalls = createBoundaryPlan(rng);
  const rubble = createRubblePlan(rng);
  const plan = {
    schema: 'ruindivex-room-module/v1',
    moduleId: MAGMA_REFINERY_OPENING_MODULE_ID,
    topologyRevision: MAGMA_REFINERY_OPENING_TOPOLOGY_REVISION,
    themePackId: 'magma-refinery-future',
    tileSize,
    dimensions: {
      widthTiles: ROOM_WIDTH_TILES,
      depthTiles: ROOM_DEPTH_TILES,
      authoredEnvelopeMeters: { width: ROOM_WIDTH_TILES * TILE_SIZE, depth: ROOM_DEPTH_TILES * TILE_SIZE },
      ceilingY: ROOM_CEILING_Y,
    },
    room: {
      id: MAGMA_REFINERY_OPENING_MODULE_ID,
      type: 'entrance',
      archetype: 'magma-refinery-opening',
      x: 0,
      z: 0,
      width: ROOM_WIDTH_TILES,
      depth: ROOM_DEPTH_TILES,
      baseElevation: 0,
      minY: LAVA_SURFACE_Y,
      maxY: HIGH_TERRACE_Y,
      ceilingY: ROOM_CEILING_Y,
      ceilingHeight: ROOM_CEILING_Y,
      purpose: 'Recently excavated freight breach exposing an ancient magma refinery receiver.',
      mood: 'Fresh work lights against dormant monumental refinery architecture.',
      environmentalStory: 'Modern Digger braces and bore marks stop at a newly uncovered ancient ore receiver and freight gate.',
      previewPosition: { x: 0, y: 0, z: 8 },
      previewFacing: { x: 0, z: -1 },
      verticalPlan: {
        baseElevation: 0,
        localWalkableTiers: [LAVA_SURFACE_Y, 0, MID_LANDING_Y, HIGH_TERRACE_Y],
        highestTierReachableWithoutJump: true,
      },
    },
    sockets: [
      {
        id: 'opening-entry-socket',
        kind: 'player',
        x: 0,
        z: 11,
        elevation: 0,
        facingX: 0,
        facingZ: 1,
        widthMeters: 8.4,
        heightMeters: 5.6,
        clearLandingMeters: { width: 8.4, depth: 8.4 },
      },
      {
        id: 'opening-deeper-socket',
        kind: 'player',
        x: 9,
        z: -12,
        elevation: 0,
        facingX: 0,
        facingZ: -1,
        widthMeters: 8.4,
        heightMeters: 5.6,
        clearLandingMeters: { width: 8.4, depth: 8.4 },
      },
      {
        id: 'opening-lava-continuity-socket',
        kind: 'environmental-spine',
        x: 2.5,
        z: -12,
        elevation: LAVA_SURFACE_Y,
        facingX: 0,
        facingZ: -1,
        widthMeters: LAVA_STREAM_WIDTH,
        continuityTag: 'magma-refinery-lava-spine',
      },
    ],
    floorTiles,
    rampLandings,
    rockInfill,
    boundaryWalls,
    rubble,
    jump: {
      id: 'opening-lava-crossing',
      streamWidthMeters: LAVA_STREAM_WIDTH,
      airGapMeters: JUMP_AIR_GAP,
      maximumPlayerJumpMeters: PLAYER_TRAVERSAL_ENVELOPE.maximumHorizontalJumpDistance,
      launch: { x: 1.55, z: 2, width: 5.8, depth: 8.4, elevation: 0 },
      landing: { x: 3.95, z: 2, width: 5.8, depth: 8.4, elevation: 0 },
      fallDestinationY: LAVA_SURFACE_Y,
      recoveryRouteIds: ['lava-west-ramp-out', 'lava-east-ramp-out'],
    },
    textureContract: {
      root: TEXTURE_ROOT,
      metersPerRepeat: TILE_SIZE,
      wrapS: 'RepeatWrapping',
      wrapT: 'RepeatWrapping',
      stretchedSurfacesAllowed: false,
      sets: { ...TEXTURE_SETS },
    },
  };
  const deeperSocket = plan.sockets.find((socket) => socket.id === 'opening-deeper-socket');
  plan.socketFrames = [{
    id: 'ancient-freight-gate-frame',
    socketId: deeperSocket.id,
    x: deeperSocket.x,
    z: deeperSocket.z,
    elevation: deeperSocket.elevation,
    facingX: deeperSocket.facingX,
    facingZ: deeperSocket.facingZ,
    openingWidthMeters: deeperSocket.widthMeters,
    openingHeightMeters: deeperSocket.heightMeters,
    thresholdAlignmentToleranceMeters: 0.05,
  }];
  plan.planHash = stablePlanHash(plan);
  return plan;
}

export function applyWorldTiledUVs(geometry, metersPerRepeat = TILE_SIZE) {
  const position = geometry?.attributes?.position;
  const normal = geometry?.attributes?.normal;
  const uv = geometry?.attributes?.uv;
  if (!position || !normal || !uv) return geometry;
  const scale = 1 / Math.max(0.001, metersPerRepeat);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const nx = Math.abs(normal.getX(index));
    const ny = Math.abs(normal.getY(index));
    const nz = Math.abs(normal.getZ(index));
    if (ny >= nx && ny >= nz) uv.setXY(index, x * scale, z * scale);
    else if (nx >= nz) uv.setXY(index, z * scale, y * scale);
    else uv.setXY(index, x * scale, y * scale);
  }
  uv.needsUpdate = true;
  geometry.userData.worldUvMetersPerRepeat = metersPerRepeat;
  geometry.userData.worldUvTiled = true;
  return geometry;
}

function createTiledBoxGeometry(width, height, depth, metersPerRepeat = TILE_SIZE) {
  return applyWorldTiledUVs(new THREE.BoxGeometry(width, height, depth), metersPerRepeat);
}

function createTiledHexColumnGeometry(radius, height, metersPerRepeat = TILE_SIZE) {
  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    height,
    6,
    1,
    false,
    Math.PI / 6,
  );
  applyWorldTiledUVs(geometry, metersPerRepeat);
  geometry.userData.proceduralShape = 'hexagonal-basalt-column';
  geometry.userData.radialSegments = 6;
  return geometry;
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
    name: `magmaOpening_${setName}`,
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
    basalt: createTextureMaterial(textureLoader, TEXTURE_SETS.basalt, { roughness: 0.94 }),
    ashStone: createTextureMaterial(textureLoader, TEXTURE_SETS.ashStone, { roughness: 0.92 }),
    blackMetal: createTextureMaterial(textureLoader, TEXTURE_SETS.blackMetal, { roughness: 0.66, metalness: 0.72 }),
    rails: createTextureMaterial(textureLoader, TEXTURE_SETS.rails, { roughness: 0.58, metalness: 0.78 }),
    serviceGrate: createTextureMaterial(textureLoader, TEXTURE_SETS.serviceGrate, { roughness: 0.64, metalness: 0.68 }),
    ceramic: createTextureMaterial(textureLoader, TEXTURE_SETS.ceramic, { roughness: 0.78, metalness: 0.1 }),
    bronze: createTextureMaterial(textureLoader, TEXTURE_SETS.bronze, { roughness: 0.55, metalness: 0.76 }),
    magma: createTextureMaterial(textureLoader, TEXTURE_SETS.magma, {
      emissive: 0xff5b18,
      emissiveIntensity: 2.2,
      roughness: 0.34,
      metalness: 0,
    }),
    lamp: new THREE.MeshStandardMaterial({
      name: 'magmaOpening_diggerLamp',
      color: 0xffd5a0,
      emissive: 0xff7a22,
      emissiveIntensity: 2.4,
      roughness: 0.3,
      metalness: 0.1,
    }),
  };
}

function addBox(parent, {
  name,
  width,
  height,
  depth,
  x,
  y,
  z,
  material,
  yaw = 0,
  pitch = 0,
  roll = 0,
  metersPerRepeat = TILE_SIZE,
}) {
  const mesh = new THREE.Mesh(
    createTiledBoxGeometry(width, height, depth, metersPerRepeat),
    material,
  );
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.rotation.set(pitch, yaw, roll);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.worldUvTiled = true;
  parent.add(mesh);
  return mesh;
}

function addHexColumn(parent, {
  name,
  radius,
  height,
  x,
  y,
  z,
  material,
  metersPerRepeat = TILE_SIZE,
}) {
  const mesh = new THREE.Mesh(
    createTiledHexColumnGeometry(radius, height, metersPerRepeat),
    material,
  );
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.worldUvTiled = true;
  mesh.userData.proceduralShape = 'hexagonal-basalt-column';
  mesh.userData.radialSegments = 6;
  parent.add(mesh);
  return mesh;
}

function createSolidZone(spec, overrides = {}) {
  return {
    id: spec.id,
    roomId: MAGMA_REFINERY_OPENING_MODULE_ID,
    position: new THREE.Vector3(spec.x, spec.y, spec.z),
    halfWidth: spec.halfWidth,
    halfDepth: spec.halfDepth,
    verticalHalfHeight: spec.verticalHalfHeight,
    obstacleKind: spec.obstacleKind ?? 'magmaOpeningSolid',
    ...overrides,
  };
}

function addRailingRun({ parent, materials, solidZones, id, center, length, alongX, floorY }) {
  const railHeight = 1.05;
  const railThickness = 0.1;
  addBox(parent, {
    name: `${id}UpperRail`,
    width: alongX ? length : railThickness,
    height: railThickness,
    depth: alongX ? railThickness : length,
    x: center.x,
    y: floorY + railHeight,
    z: center.z,
    material: materials.rails,
  });
  const postCount = Math.max(2, Math.ceil(length / TILE_SIZE) + 1);
  for (let index = 0; index < postCount; index += 1) {
    const offset = -length * 0.5 + (length * index) / (postCount - 1);
    addBox(parent, {
      name: `${id}Post${index + 1}`,
      width: railThickness,
      height: railHeight,
      depth: railThickness,
      x: center.x + (alongX ? offset : 0),
      y: floorY + railHeight * 0.5,
      z: center.z + (alongX ? 0 : offset),
      material: materials.rails,
    });
  }
  solidZones.push(createSolidZone({
    id: `${id}Collision`,
    x: center.x,
    y: floorY + railHeight * 0.5,
    z: center.z,
    halfWidth: alongX ? length * 0.5 : railThickness * 0.75,
    halfDepth: alongX ? railThickness * 0.75 : length * 0.5,
    verticalHalfHeight: railHeight * 0.5,
    obstacleKind: 'magmaOpeningRailing',
  }));
}

function addRampTileMesh(parent, tile, materials) {
  const start = tile.rampStartElevation;
  const end = tile.rampEndElevation;
  const rise = end - start;
  const slope = Math.atan2(Math.abs(rise), TILE_SIZE);
  const length = Math.hypot(TILE_SIZE, rise);
  const alongX = Math.abs(tile.rampDirectionX ?? 0) > 0;
  const pitch = alongX ? 0 : -Math.sign(tile.rampDirectionZ) * slope * Math.sign(rise || 1);
  const roll = alongX ? Math.sign(tile.rampDirectionX) * slope * Math.sign(rise || 1) : 0;
  const mesh = addBox(parent, {
    name: `${tile.rampRouteId}_${tile.x}_${tile.z}`,
    width: alongX ? length : TILE_SIZE * 1.01,
    height: 0.22,
    depth: alongX ? TILE_SIZE * 1.01 : length,
    x: tile.x * TILE_SIZE,
    y: (start + end) * 0.5 - 0.12,
    z: tile.z * TILE_SIZE,
    material: tile.rampRouteId === 'ancient-terrace-descent'
      || tile.rampRouteId?.startsWith('lava-')
      ? materials.ashStone
      : materials.serviceGrate,
    pitch,
    roll,
  });
  mesh.userData.surfaceRole = 'ramp';
  mesh.userData.rampRouteId = tile.rampRouteId;

  if (tile.rampRouteId?.startsWith('digger-catwalk')) {
    for (const offset of [-0.7, 0, 0.7]) {
      const progress = offset / TILE_SIZE + 0.5;
      const elevation = THREE.MathUtils.lerp(start, end, progress) + 0.07;
      addBox(parent, {
        name: `${mesh.name}Tread`,
        width: alongX ? 0.08 : TILE_SIZE * 0.96,
        height: 0.06,
        depth: alongX ? TILE_SIZE * 0.96 : 0.08,
        x: tile.x * TILE_SIZE + (alongX ? offset : 0),
        y: elevation,
        z: tile.z * TILE_SIZE + (alongX ? 0 : offset),
        material: materials.rails,
      });
    }
  }
}

function supportingFloorElevation(plan, tile) {
  const rampBottom = tile.surfaceRole === 'ramp'
    ? Math.min(tile.rampStartElevation, tile.rampEndElevation)
    : tile.elevation;
  const candidates = plan.floorTiles.filter((candidate) => (
    candidate.x === tile.x
      && candidate.z === tile.z
      && candidate.surfaceRole !== 'ramp'
      && candidate.elevation < rampBottom - 0.05
  ));
  if (candidates.length === 0) return LAVA_SURFACE_Y;
  return Math.max(...candidates.map((candidate) => candidate.elevation));
}

function addCatwalkStructure(group, plan, materials, solidZones) {
  const rampTiles = plan.floorTiles.filter((tile) => tile.surfaceRole === 'ramp');
  for (const tile of rampTiles) addRampTileMesh(group, tile, materials);

  for (const tile of rampTiles.filter((candidate) => !candidate.rampRouteId?.startsWith('digger-catwalk'))) {
    const foundationBaseY = LAVA_SURFACE_Y - 0.4;
    const foundationTopY = Math.min(tile.rampStartElevation, tile.rampEndElevation) - 0.22;
    if (foundationTopY <= foundationBaseY + 0.05) continue;
    const foundation = addBox(group, {
      name: `${tile.rampRouteId}Foundation_${tile.x}_${tile.z}`,
      width: TILE_SIZE * 1.01,
      height: foundationTopY - foundationBaseY,
      depth: TILE_SIZE * 1.01,
      x: tile.x * TILE_SIZE,
      y: (foundationTopY + foundationBaseY) * 0.5,
      z: tile.z * TILE_SIZE,
      material: materials.ashStone,
    });
    foundation.userData.structuralFoundation = true;
    foundation.userData.supportBaseY = foundationBaseY;
    foundation.userData.supportTopY = foundationTopY;
    solidZones.push(createSolidZone({
      id: `${foundation.name}Collision`,
      x: foundation.position.x,
      y: foundation.position.y,
      z: foundation.position.z,
      halfWidth: TILE_SIZE * 0.505,
      halfDepth: TILE_SIZE * 0.505,
      verticalHalfHeight: (foundationTopY - foundationBaseY) * 0.5,
      obstacleKind: 'magmaOpeningRampFoundation',
    }));
  }

  const addFlightRails = (id, tiles, axis) => {
    const byLongitudinal = new Map();
    for (const tile of tiles) {
      const key = axis === 'z' ? tile.z : tile.x;
      const bucket = byLongitudinal.get(key) ?? [];
      bucket.push(tile);
      byLongitudinal.set(key, bucket);
    }
    for (const [key, bucket] of byLongitudinal) {
      const floorY = bucket.reduce((sum, tile) => sum + tile.elevation, 0) / bucket.length;
      if (axis === 'z') {
        const minX = Math.min(...bucket.map((tile) => tile.x));
        const maxX = Math.max(...bucket.map((tile) => tile.x));
        for (const edgeX of [minX - 0.5, maxX + 0.5]) {
          addRailingRun({
            parent: group,
            materials,
            solidZones,
            id: `${id}_${key}_${edgeX}`,
            center: new THREE.Vector3(edgeX * TILE_SIZE, 0, key * TILE_SIZE),
            length: TILE_SIZE,
            alongX: false,
            floorY,
          });
        }
      } else {
        const minZ = Math.min(...bucket.map((tile) => tile.z));
        const maxZ = Math.max(...bucket.map((tile) => tile.z));
        for (const edgeZ of [minZ - 0.5, maxZ + 0.5]) {
          addRailingRun({
            parent: group,
            materials,
            solidZones,
            id: `${id}_${key}_${edgeZ}`,
            center: new THREE.Vector3(key * TILE_SIZE, 0, edgeZ * TILE_SIZE),
            length: TILE_SIZE,
            alongX: true,
            floorY,
          });
        }
      }
    }
  };

  addFlightRails(
    'diggerFlightOneRail',
    rampTiles.filter((tile) => tile.rampRouteId === 'digger-catwalk-flight-1'),
    'z',
  );
  addFlightRails(
    'diggerFlightTwoRail',
    rampTiles.filter((tile) => tile.rampRouteId === 'digger-catwalk-flight-2'),
    'z',
  );
  addFlightRails(
    'ancientDescentRail',
    rampTiles.filter((tile) => tile.rampRouteId === 'ancient-terrace-descent'),
    'x',
  );

  const supportedTiles = plan.floorTiles.filter((tile) => (
    tile.surfaceRole === 'catwalk'
      || (tile.surfaceRole === 'ramp' && tile.rampRouteId?.startsWith('digger-catwalk'))
  ));
  for (const [index, tile] of supportedTiles.entries()) {
    if (index % 3 !== 0) continue;
    const baseY = supportingFloorElevation(plan, tile);
    const topY = tile.surfaceRole === 'ramp'
      ? Math.min(tile.rampStartElevation, tile.rampEndElevation) - 0.22
      : tile.elevation - 0.18;
    if (topY <= baseY + 0.2) continue;
    const support = addBox(group, {
      name: `catwalkSupport_${tile.x}_${tile.z}`,
      width: 0.24,
      height: topY - baseY,
      depth: 0.24,
      x: tile.x * TILE_SIZE,
      y: (topY + baseY) * 0.5,
      z: tile.z * TILE_SIZE,
      material: tile.surface === 'ancientInspectionTerrace' ? materials.ceramic : materials.blackMetal,
    });
    support.userData.structuralSupport = true;
    support.userData.supportBaseY = baseY;
    support.userData.supportTopY = topY;
    support.userData.supportedTile = { x: tile.x, z: tile.z, elevation: tile.elevation };
    solidZones.push(createSolidZone({
      id: `${support.name}Collision`,
      x: support.position.x,
      y: support.position.y,
      z: support.position.z,
      halfWidth: 0.12,
      halfDepth: 0.12,
      verticalHalfHeight: (topY - baseY) * 0.5,
      obstacleKind: 'magmaOpeningCatwalkSupport',
    }));
  }
}

function addLavaChannel(group, plan, materials, traps) {
  const lavaTiles = plan.floorTiles.filter((tile) => tile.surface === 'deepMagma');
  for (const tile of lavaTiles) {
    addBox(group, {
      name: `magmaStream_${tile.x}_${tile.z}`,
      width: TILE_SIZE * 1.02,
      height: 0.18,
      depth: TILE_SIZE * 1.02,
      x: tile.x * TILE_SIZE,
      y: LAVA_SURFACE_Y - 0.09,
      z: tile.z * TILE_SIZE,
      material: materials.magma,
      metersPerRepeat: 1.4,
    });
    traps.push({
      id: `magmaHazard_${tile.x}_${tile.z}`,
      label: 'Deep magma',
      active: true,
      interactive: false,
      position: new THREE.Vector3(tile.x * TILE_SIZE, LAVA_SURFACE_Y, tile.z * TILE_SIZE),
      halfWidth: TILE_SIZE * 0.51,
      halfDepth: TILE_SIZE * 0.51,
      verticalHalfHeight: 0.8,
      damagePerSecond: 24,
      damagePerPulse: 0,
      pulseInterval: 0.5,
      activeDuration: 0.5,
      telegraphDuration: 0.08,
      ambientHazardTags: ['environmentalHeat', 'fireFloor'],
      navigationPathCost: 18,
    });
  }
}

function addJumpLedges(group, plan, materials, platforms) {
  const streamCenterWorldX = 2.5 * TILE_SIZE;
  const streamLeft = streamCenterWorldX - LAVA_STREAM_WIDTH * 0.5;
  const streamRight = streamCenterWorldX + LAVA_STREAM_WIDTH * 0.5;
  const launchRight = streamCenterWorldX - JUMP_AIR_GAP * 0.5;
  const landingLeft = streamCenterWorldX + JUMP_AIR_GAP * 0.5;
  const launchLeft = streamLeft - 4.2;
  const landingRight = streamRight + 4.2;
  const depth = plan.jump.launch.depth;
  const centerZ = plan.jump.launch.z * TILE_SIZE;
  const specs = [
    { id: 'lavaJumpLaunch', left: launchLeft, right: launchRight },
    { id: 'lavaJumpLanding', left: landingLeft, right: landingRight },
  ];
  for (const spec of specs) {
    const width = spec.right - spec.left;
    const centerX = (spec.left + spec.right) * 0.5;
    addBox(group, {
      name: spec.id,
      width,
      height: Math.abs(LAVA_SURFACE_Y) + 0.4,
      depth,
      x: centerX,
      y: (LAVA_SURFACE_Y - 0.4) * 0.5,
      z: centerZ,
      material: materials.basalt,
    });
    platforms.push({
      id: spec.id,
      roomId: MAGMA_REFINERY_OPENING_MODULE_ID,
      center: new THREE.Vector3(centerX, 0, centerZ),
      halfWidth: width * 0.5,
      halfDepth: depth * 0.5,
      topY: 0,
      baseY: LAVA_SURFACE_Y,
      blocksBelow: true,
      solidVolume: true,
      generated: true,
      purpose: spec.id === 'lavaJumpLaunch' ? 'lava_jump_launch' : 'lava_jump_landing',
      requiredTraversalAction: 'jump',
    });
  }
}

function addRockInfill(group, plan, materials, solidZones) {
  for (const rock of plan.rockInfill) {
    const column = addHexColumn(group, {
      name: rock.id,
      radius: rock.radius,
      height: rock.verticalHalfHeight * 2,
      x: rock.x,
      y: rock.y,
      z: rock.z,
      material: materials.basalt,
    });
    column.userData.cameraOcclusionSurface = true;
    column.userData.cameraOcclusionWall = true;
    column.userData.cameraOcclusionOwner = true;
    column.userData.maximumBaySpan = 1;
    column.userData.collisionBacked = true;
    column.userData.architectureRole = 'cavern wall infill';
    solidZones.push(createSolidZone({
      ...rock,
      obstacleKind: 'magmaOpeningCavernMass',
    }));
  }
}

function addCavernShell(group, plan, materials, solidZones) {
  for (const wall of plan.boundaryWalls) {
    const wallMesh = addBox(group, {
      name: wall.id,
      width: wall.halfWidth * 2,
      height: wall.verticalHalfHeight * 2,
      depth: wall.halfDepth * 2,
      x: wall.x,
      y: wall.y,
      z: wall.z,
      material: materials.basalt,
    });
    wallMesh.userData.cameraOcclusionSurface = true;
    wallMesh.userData.cameraOcclusionWall = true;
    wallMesh.userData.cameraOcclusionOwner = true;
    wallMesh.userData.maximumBaySpan = 1;
    wallMesh.userData.collisionBacked = true;
    wallMesh.userData.architectureRole = 'cavern boundary wall';
    solidZones.push(createSolidZone(wall));
  }
  const ceiling = addBox(group, {
    name: 'magmaOpeningCavernCeiling',
    width: ROOM_WIDTH_TILES * TILE_SIZE,
    height: 0.6,
    depth: ROOM_DEPTH_TILES * TILE_SIZE,
    x: 0,
    y: ROOM_CEILING_Y + 0.3,
    z: 0,
    material: materials.basalt,
  });
  ceiling.userData.cameraOcclusionSurface = true;
  ceiling.userData.architectureRole = 'cavern ceiling';
}

function addSocketTunnels(group, plan, materials, solidZones, connectedSocketIds = new Set()) {
  const addTunnel = ({ id, socket, material }) => {
    const width = socket.widthMeters;
    const depth = 5.6;
    const wallThickness = 0.32;
    const tunnelHeight = socket.heightMeters + 0.6;
    const centerWorldX = socket.x * TILE_SIZE;
    const centerWorldZ = socket.z * TILE_SIZE + socket.facingZ * depth * 0.5;
    for (const side of [-1, 1]) {
      const x = centerWorldX + side * (width * 0.5 + wallThickness * 0.5);
      const wallMesh = addBox(group, {
        name: `${id}SideWall${side}`,
        width: wallThickness,
        height: tunnelHeight,
        depth,
        x,
        y: socket.elevation + tunnelHeight * 0.5,
        z: centerWorldZ,
        material,
      });
      wallMesh.userData.cameraOcclusionSurface = true;
      wallMesh.userData.cameraOcclusionWall = true;
      wallMesh.userData.cameraOcclusionOwner = true;
      wallMesh.userData.maximumBaySpan = 2;
      wallMesh.userData.collisionBacked = true;
      wallMesh.userData.architectureRole = 'tunnel side wall';
      solidZones.push(createSolidZone({
        id: `${id}SideWall${side}Collision`,
        x,
        y: socket.elevation + tunnelHeight * 0.5,
        z: centerWorldZ,
        halfWidth: wallThickness * 0.5,
        halfDepth: depth * 0.5,
        verticalHalfHeight: tunnelHeight * 0.5,
      }));
    }
    const ceiling = addBox(group, {
      name: `${id}Ceiling`,
      width: width + wallThickness * 2,
      height: 0.35,
      depth,
      x: centerWorldX,
      y: socket.elevation + tunnelHeight,
      z: centerWorldZ,
      material,
    });
    ceiling.userData.cameraOcclusionSurface = true;
    ceiling.userData.architectureRole = 'tunnel ceiling';
    if (!connectedSocketIds.has(socket.id)) {
      const capZ = centerWorldZ + socket.facingZ * depth * 0.5;
      const cap = addBox(group, {
        name: `${id}PreviewCap`,
        width,
        height: tunnelHeight,
        depth: 0.28,
        x: centerWorldX,
        y: socket.elevation + tunnelHeight * 0.5,
        z: capZ,
        material,
      });
      cap.userData.cameraOcclusionSurface = true;
      cap.userData.cameraOcclusionWall = true;
      cap.userData.cameraOcclusionOwner = true;
      cap.userData.maximumBaySpan = 3;
      cap.userData.collisionBacked = true;
      cap.userData.architectureRole = 'tunnel preview cap wall';
      solidZones.push(createSolidZone({
        id: `${id}PreviewCapCollision`,
        x: centerWorldX,
        y: socket.elevation + tunnelHeight * 0.5,
        z: capZ,
        halfWidth: width * 0.5,
        halfDepth: 0.14,
        verticalHalfHeight: tunnelHeight * 0.5,
      }));
    }
  };

  addTunnel({
    id: 'diggerEntryTunnel',
    socket: plan.sockets.find((socket) => socket.id === 'opening-entry-socket'),
    material: materials.blackMetal,
  });
  addTunnel({
    id: 'ancientFreightTunnel',
    socket: plan.sockets.find((socket) => socket.id === 'opening-deeper-socket'),
    material: materials.ceramic,
  });
}

function addDiggerExcavation(group, plan, materials, solidZones) {
  for (const [index, z] of [8.7, 7.1, 5.5].entries()) {
    const worldZ = z * TILE_SIZE;
    for (const side of [-1, 1]) {
      addBox(group, {
        name: `diggerBrace${index + 1}Side${side}`,
        width: 0.32,
        height: 5.8,
        depth: 0.42,
        x: side * 5.0,
        y: 2.9,
        z: worldZ,
        material: materials.blackMetal,
      });
    }
    addBox(group, {
      name: `diggerBrace${index + 1}Crossbeam`,
      width: 10.3,
      height: 0.34,
      depth: 0.42,
      x: 0,
      y: 5.75,
      z: worldZ,
      material: materials.blackMetal,
    });
    const lamp = addBox(group, {
      name: `diggerBrace${index + 1}Lamp`,
      width: 0.55,
      height: 0.18,
      depth: 0.32,
      x: index % 2 === 0 ? -2.2 : 2.2,
      y: 5.42,
      z: worldZ - 0.22,
      material: materials.lamp,
    });
    const light = new THREE.PointLight(0xff9b55, 1.6, 17, 1.8);
    light.name = `${lamp.name}Light`;
    light.position.copy(lamp.position).add(new THREE.Vector3(0, -0.35, -0.25));
    light.castShadow = false;
    group.add(light);
  }

  for (const rubble of plan.rubble) {
    addBox(group, {
      name: rubble.id,
      width: rubble.width,
      height: rubble.height,
      depth: rubble.depth,
      x: rubble.x,
      y: rubble.y,
      z: rubble.z,
      yaw: rubble.yaw,
      material: materials.ashStone,
      metersPerRepeat: 1.4,
    });
  }

  const rigX = -11.5 * TILE_SIZE;
  const rigZ = 6.4 * TILE_SIZE;
  addBox(group, {
    name: 'diggerBoreRigBase',
    width: 3.4,
    height: 0.8,
    depth: 4.8,
    x: rigX,
    y: 0.4,
    z: rigZ,
    material: materials.blackMetal,
  });
  addBox(group, {
    name: 'diggerBoreRigMast',
    width: 0.7,
    height: 5.4,
    depth: 0.7,
    x: rigX,
    y: 3.1,
    z: rigZ - 1.2,
    material: materials.rails,
  });
  solidZones.push(createSolidZone({
    id: 'diggerBoreRigCollision',
    x: rigX,
    y: 2.7,
    z: rigZ,
    halfWidth: 1.7,
    halfDepth: 2.4,
    verticalHalfHeight: 2.7,
    obstacleKind: 'diggerMachinery',
  }));
}

function addAncientRefineryLandmarks(group, plan, materials, solidZones) {
  const frame = plan.socketFrames.find((candidate) => candidate.id === 'ancient-freight-gate-frame');
  const gateCenterX = frame.x * TILE_SIZE;
  const gateZ = frame.z * TILE_SIZE;
  const columnWidth = 0.7;
  const lintelHeight = 0.8;
  const frameDepth = 1.2;
  const columnOffset = frame.openingWidthMeters * 0.5 + columnWidth * 0.5;
  for (const side of [-1, 1]) {
    const x = gateCenterX + side * columnOffset;
    const column = addBox(group, {
      name: `ancientFreightGateColumn${side}`,
      width: columnWidth,
      height: frame.openingHeightMeters,
      depth: frameDepth,
      x,
      y: frame.elevation + frame.openingHeightMeters * 0.5,
      z: gateZ,
      material: materials.ceramic,
    });
    column.userData.socketId = frame.socketId;
    addBox(group, {
      name: `ancientFreightGateBronzeRib${side}`,
      width: 0.16,
      height: frame.openingHeightMeters - 0.3,
      depth: frameDepth + 0.08,
      x: x - side * (columnWidth * 0.5 - 0.08),
      y: frame.elevation + (frame.openingHeightMeters - 0.3) * 0.5,
      z: gateZ,
      material: materials.bronze,
    });
    solidZones.push(createSolidZone({
      id: `ancientFreightGateColumn${side}Collision`,
      x,
      y: frame.elevation + frame.openingHeightMeters * 0.5,
      z: gateZ,
      halfWidth: columnWidth * 0.5,
      halfDepth: frameDepth * 0.5,
      verticalHalfHeight: frame.openingHeightMeters * 0.5,
      obstacleKind: 'ancientSocketFrame',
    }));
  }
  const lintel = addBox(group, {
    name: 'ancientFreightGateLintel',
    width: frame.openingWidthMeters + columnWidth * 2,
    height: lintelHeight,
    depth: frameDepth,
    x: gateCenterX,
    y: frame.elevation + frame.openingHeightMeters + lintelHeight * 0.5,
    z: gateZ,
    material: materials.ceramic,
  });
  lintel.userData.socketId = frame.socketId;
  lintel.userData.socketOpeningWidthMeters = frame.openingWidthMeters;
  lintel.userData.socketOpeningHeightMeters = frame.openingHeightMeters;
  solidZones.push(createSolidZone({
    id: 'ancientFreightGateLintelCollision',
    x: gateCenterX,
    y: frame.elevation + frame.openingHeightMeters + lintelHeight * 0.5,
    z: gateZ,
    halfWidth: (frame.openingWidthMeters + columnWidth * 2) * 0.5,
    halfDepth: frameDepth * 0.5,
    verticalHalfHeight: lintelHeight * 0.5,
    obstacleKind: 'ancientSocketFrame',
  }));

  for (const [index, x] of [-7, -5].entries()) {
    const supportedTile = plan.floorTiles.find((tile) => (
      tile.x === x
        && tile.z === -7
        && tile.surface === 'ancientInspectionTerrace'
    ));
    const supportBaseY = supportingFloorElevation(plan, supportedTile);
    const supportTopY = HIGH_TERRACE_Y - 0.18;
    const support = addBox(group, {
      name: `ancientTerraceSupport${index + 1}`,
      width: 0.9,
      height: supportTopY - supportBaseY,
      depth: 0.9,
      x: x * TILE_SIZE,
      y: (supportTopY + supportBaseY) * 0.5,
      z: -7 * TILE_SIZE,
      material: materials.ceramic,
    });
    support.userData.structuralSupport = true;
    support.userData.supportBaseY = supportBaseY;
    support.userData.supportTopY = supportTopY;
    solidZones.push(createSolidZone({
      id: `${support.name}Collision`,
      x: support.position.x,
      y: support.position.y,
      z: support.position.z,
      halfWidth: 0.45,
      halfDepth: 0.45,
      verticalHalfHeight: (supportTopY - supportBaseY) * 0.5,
      obstacleKind: 'ancientTerraceSupport',
    }));
  }
}

export function assembleMagmaRefineryOpeningRoom(plan, {
  textureLoader = new THREE.TextureLoader(),
  connectedSocketIds = [],
} = {}) {
  if (plan?.moduleId !== MAGMA_REFINERY_OPENING_MODULE_ID) {
    throw new Error(`Expected ${MAGMA_REFINERY_OPENING_MODULE_ID} plan.`);
  }

  const group = new THREE.Group();
  group.name = 'magmaRefineryOpeningRoom';
  group.userData.roomModuleId = plan.moduleId;
  group.userData.topologyRevision = plan.topologyRevision;
  group.userData.planHash = plan.planHash;
  group.userData.themePackId = plan.themePackId;
  group.userData.proceduralRoom = true;

  const materials = createMaterials(textureLoader);
  group.userData.authoredOwnedMaterials = new Set(Object.values(materials));
  const solidZones = [];
  const traps = [];
  const platforms = [];

  for (const tile of plan.floorTiles) {
    if (tile.surfaceRole === 'ramp') continue;
    if (tile.surface === 'deepMagma') continue;
    const material = tile.surfaceRole === 'catwalk'
      ? tile.surface === 'ancientInspectionTerrace' ? materials.ceramic : materials.serviceGrate
      : tile.surface === 'diggerExcavationRock' ? materials.ashStone : materials.basalt;
    const thickness = tile.surfaceRole === 'catwalk'
      ? 0.24
      : tile.elevation > LAVA_SURFACE_Y + 0.01
        ? Math.abs(LAVA_SURFACE_Y) + 0.4
        : 0.38;
    const floorMesh = addBox(group, {
      name: `magmaOpeningFloor_${tile.x}_${tile.z}_${tile.level}`,
      width: TILE_SIZE * 1.012,
      height: thickness,
      depth: TILE_SIZE * 1.012,
      x: tile.x * TILE_SIZE,
      y: tile.elevation - thickness * 0.5,
      z: tile.z * TILE_SIZE,
      material,
    });
    floorMesh.userData.cameraOcclusionSurface = true;
    floorMesh.userData.cameraOcclusionOwner = true;
    floorMesh.userData.cameraOcclusionSupportedFloorMass = thickness >= 1.2;
    floorMesh.userData.architectureRole = thickness >= 1.2
      ? 'supported walkable floor mass'
      : 'walkable floor';
    floorMesh.userData.surfaceRole = tile.surfaceRole;
  }

  addLavaChannel(group, plan, materials, traps);
  addJumpLedges(group, plan, materials, platforms);
  addCatwalkStructure(group, plan, materials, solidZones);
  addRockInfill(group, plan, materials, solidZones);
  addCavernShell(group, plan, materials, solidZones);
  addSocketTunnels(group, plan, materials, solidZones, new Set(connectedSocketIds));
  addDiggerExcavation(group, plan, materials, solidZones);
  addAncientRefineryLandmarks(group, plan, materials, solidZones);

  const ambient = new THREE.HemisphereLight(0xb9c2c6, 0x241008, 1.05);
  ambient.name = 'magmaOpeningAmbientLight';
  group.add(ambient);
  const excavationFill = new THREE.DirectionalLight(0xffd5ad, 1.15);
  excavationFill.name = 'magmaOpeningExcavationFill';
  excavationFill.position.set(-18, 22, 20);
  excavationFill.castShadow = false;
  group.add(excavationFill);
  const lavaLight = new THREE.PointLight(0xff4e19, 3.1, 38, 1.6);
  lavaLight.name = 'magmaOpeningLavaLight';
  lavaLight.position.set(2.5 * TILE_SIZE, 1.2, -2 * TILE_SIZE);
  lavaLight.castShadow = false;
  group.add(lavaLight);

  const structuralSupportMeshes = [];
  const structuralFoundationMeshes = [];
  group.traverse((object) => {
    if (object.userData?.structuralSupport === true) structuralSupportMeshes.push(object);
    if (object.userData?.structuralFoundation === true) structuralFoundationMeshes.push(object);
  });
  const supportDatumViolations = structuralSupportMeshes.filter((support) => {
    const renderedBottom = support.position.y - support.geometry.parameters.height * 0.5;
    return Math.abs(renderedBottom - support.userData.supportBaseY) > 0.001;
  });
  const undercroftFloorCount = plan.floorTiles.filter((tile) => tile.supportsElevatedRoute === true).length;

  const tiles = new Map();
  for (const tile of plan.floorTiles.filter((candidate) => candidate.elevation === 0)) {
    tiles.set(`${tile.x},${tile.z}`, tile);
  }
  const progression = {
    entranceRoomId: MAGMA_REFINERY_OPENING_MODULE_ID,
    bands: [{ bandId: 'opening', roomIds: [MAGMA_REFINERY_OPENING_MODULE_ID] }],
    roomConnections: [],
    doors: [],
    keycards: [],
    shrineKey: null,
    validation: {
      accepted: true,
      errors: [],
      warnings: ['Development room fixture: not part of a loadable Magma dungeon family.'],
    },
  };
  const minimap = {
    rooms: [{
      id: MAGMA_REFINERY_OPENING_MODULE_ID,
      x: 0,
      z: 0,
      width: ROOM_WIDTH_TILES,
      depth: ROOM_DEPTH_TILES,
      baseElevation: 0,
      discovered: true,
    }],
    connections: [],
    environmentalSpines: [{
      id: 'magma-refinery-lava-spine',
      socketId: 'opening-lava-continuity-socket',
      active: true,
    }],
  };

  return {
    group,
    dungeonKind: 'magmaRefineryOpeningDevelopmentFixture',
    dungeonFamilyId: 'industrial-v1',
    themePackId: plan.themePackId,
    developmentFixture: true,
    rooms: [plan.room],
    roomModuleIds: [plan.moduleId],
    tiles,
    floorTiles: plan.floorTiles.map((tile) => ({ ...tile })),
    rampLandings: plan.rampLandings.map((landing) => ({ ...landing })),
    socketFrames: plan.socketFrames.map((frame) => ({ ...frame })),
    supportDiagnostics: {
      structuralSupportCount: structuralSupportMeshes.length,
      structuralFoundationCount: structuralFoundationMeshes.length,
      undercroftFloorCount,
      supportDatumViolationCount: supportDatumViolations.length,
      unresolvedElevatedFootprintCount: 0,
    },
    verticalConnectors: [],
    connectionPlans: [],
    progression,
    minimap,
    doors: [],
    keycards: [],
    keySeeker: null,
    chests: [],
    mechanisms: [],
    ladders: [],
    connectorLifts: [],
    puzzleBlocks: [],
    pressurePlates: [],
    conveyorPuzzles: [],
    platforms,
    npcAnimationMixers: [],
    npcAnimators: [],
    safeInteractables: [],
    safeZones: [],
    solidZones,
    aerialBoundaryZones: solidZones.filter((zone) => /cavern|Tunnel|Cap/i.test(zone.id)),
    encounters: [],
    traps,
    conveyors: [],
    shrine: null,
    tileSize: TILE_SIZE,
    playerStart: new THREE.Vector3(0, 0, 8 * TILE_SIZE),
    playerStartFacing: new THREE.Vector3(0, 0, -1),
    campReturnPosition: new THREE.Vector3(0, 0, 8 * TILE_SIZE),
    ruinEntryPosition: new THREE.Vector3(0, 0, 8 * TILE_SIZE),
    enemySpawnPoints: [],
    shrinePosition: null,
    boundsRadius: Math.hypot(ROOM_WIDTH_TILES, ROOM_DEPTH_TILES) * TILE_SIZE * 0.55,
    renderCullGroups: [],
    specialEnvironment: null,
    specialEnvironmentId: null,
    environmentalHazards: [{
      id: 'magma-refinery-lava-spine',
      kind: 'deepMagma',
      damagePerSecond: 24,
      floorElevation: LAVA_SURFACE_Y,
      continuitySocketId: 'opening-lava-continuity-socket',
    }],
    moduleManifestDiagnostics: {
      accepted: true,
      schema: plan.schema,
      moduleId: plan.moduleId,
      topologyRevision: plan.topologyRevision,
      planHash: plan.planHash,
      textureTiling: plan.textureContract,
      authoredRoomAssetDependency: false,
      safeRequiredRoute: true,
      highestTierReachableFromGround: true,
      rampLandingCount: plan.rampLandings.length,
      minimumRampLandingTiles: 3,
      rockInfillCellCount: plan.rockInfill.length,
      untexturedVoidCellCount: 0,
      supportResolution: {
        accepted: supportDatumViolations.length === 0,
        structuralSupportCount: structuralSupportMeshes.length,
        structuralFoundationCount: structuralFoundationMeshes.length,
        undercroftFloorCount,
        supportDatumViolationCount: supportDatumViolations.length,
        unresolvedElevatedFootprintCount: 0,
      },
      socketFrameAlignment: {
        accepted: true,
        frameId: plan.socketFrames[0].id,
        socketId: plan.socketFrames[0].socketId,
        centerOffsetMeters: 0,
        widthOffsetMeters: 0,
        heightOffsetMeters: 0,
        toleranceMeters: plan.socketFrames[0].thresholdAlignmentToleranceMeters,
      },
      jumpAirGapMeters: JUMP_AIR_GAP,
      maximumPlayerJumpMeters: PLAYER_TRAVERSAL_ENVELOPE.maximumHorizontalJumpDistance,
    },
    spatialGenerationDiagnostics: {
      contractId: 'ruindivex-dungeon-generation/v2-room-fixture',
      accepted: true,
      errors: [],
      warnings: ['Single-room development fixture; dungeon-wide connector coverage is not evaluated.'],
      roomCount: 1,
      floorTileCount: plan.floorTiles.length,
      signedConnectorCount: 0,
    },
    planHash: plan.planHash,
  };
}

export function generateMagmaRefineryOpeningRoom(options = {}) {
  const plan = createMagmaRefineryOpeningPlan(options);
  return assembleMagmaRefineryOpeningRoom(plan, options);
}
