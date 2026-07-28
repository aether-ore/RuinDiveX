import * as THREE from 'three';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../TraversalCapabilities.js';
import { applyWorldTiledUVs } from './MagmaRefineryOpeningRoom.js';

export const MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID = 'magma-linear-digger-excavation';
export const MAGMA_LINEAR_DIGGER_EXCAVATION_TOPOLOGY_REVISION = 6;
export const OLD_DRILL_ITEM_ID = 'oldDrill';
export const OLD_DRILL_CHEST_ID = 'magma-linear-excavation-old-drill-chest';

const TILE_SIZE = 2.8;
const ROOM_WIDTH_TILES = 43;
const ROOM_DEPTH_TILES = 41;
const UPPER_ELEVATION = 0;
const MIDDLE_ELEVATION = -7;
const LOWER_ELEVATION = -14;
// Every safe bank beside the stream uses the standard three-metre climbable
// ledge profile; this also leaves the authored hanging pose clear of magma.
const LAVA_OFFSET = -3;
const TUNNEL_HEADROOM = 8.4;
const CHAMBER_HEADROOM = 11.2;
const SOCKET_HEIGHT = 5.6;
const TEXTURE_ROOT = '/assets/textures/magma-refinery/cells/seamless/';
const LAVA_CONTINUITY_TAG = 'magma-refinery-lava-spine';
const RAMP_SEGMENTS = 13;
const RAMP_WIDTH_TILES = 3;
const RAMP_DELTA = -7;
// The critical-route grating is a real raised walking surface, not a material
// swap on the cavern floor. 0.84 m is high enough to read clearly beside the
// rock floor while remaining within the shared climbable-ledge envelope.
export const CRITICAL_CATWALK_RISE = 0.84;
const CATWALK_ACCESS_RAMP_SEGMENTS = 2;

function raisedCatwalkElevation(baseElevation) {
  return fixed(baseElevation + CRITICAL_CATWALK_RISE);
}

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
  return `magma-linear-excavation:${hashString(JSON.stringify(plan)).toString(16).padStart(8, '0')}`;
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

function addRectToSet(target, minX, maxX, minZ, maxZ) {
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) target.add(cellKey(x, z));
  }
}

function lavaCenterXAt(z) {
  if (z >= 10) return 6;
  if (z >= 7) return 7;
  if (z >= 4) return 6;
  if (z >= 1) return 5;
  if (z >= -2) return 4;
  if (z >= -5) return 3;
  if (z >= -10) return 2;
  if (z >= -13) return 3;
  return 4;
}

function bandElevationForZ(z) {
  if (z >= -3) return UPPER_ELEVATION;
  if (z >= -11) return MIDDLE_ELEVATION;
  return LOWER_ELEVATION;
}

function createChamberDefinitions() {
  return [
    {
      id: 'surveyMouth',
      label: 'Survey Mouth',
      elevation: UPPER_ELEVATION,
      minX: -4,
      maxX: 4,
      minZ: 11,
      maxZ: 17,
      purpose: 'calm-navigation',
      encounter: false,
      story: 'Fresh work lamps and spoil piles frame the first view of the ancient lava channel.',
    },
    {
      id: 'splitBoreJunction',
      label: 'Split-Bore Junction',
      elevation: UPPER_ELEVATION,
      minX: -4,
      maxX: 4,
      minZ: 4,
      maxZ: 10,
      purpose: 'navigation-junction',
      encounter: false,
      story: 'A failed modern drill turntable explains why the excavation split into two broad loops.',
    },
    {
      id: 'drillForemanCache',
      label: "Drill Foreman's Cache",
      elevation: UPPER_ELEVATION,
      minX: 10,
      maxX: 16,
      minZ: 1,
      maxZ: 7,
      purpose: 'unique-reward',
      encounter: false,
      story: 'A locked Digger field chest was abandoned when the bore broke into a hotter chamber.',
    },
    {
      id: 'firstMeltChamber',
      label: 'First Melt Chamber',
      elevation: UPPER_ELEVATION,
      minX: -5,
      maxX: 5,
      minZ: -7,
      maxZ: 1,
      purpose: 'encounter-and-route-choice',
      encounter: true,
      story: 'Fresh bore scars end at an ancient melt channel, with a safe perimeter left clear around the breach.',
    },
    {
      id: 'centralSurveyLanding',
      label: 'Central Survey Landing',
      elevation: MIDDLE_ELEVATION,
      minX: -21,
      maxX: -13,
      minZ: -13,
      maxZ: -5,
      purpose: 'calm-switchback-landing',
      encounter: false,
      story: 'A broad survey station makes the first seven-metre descent legible before the route splits again.',
    },
    {
      id: 'surveyorsBlind',
      label: "Surveyor's Blind",
      elevation: MIDDLE_ELEVATION,
      minX: -20,
      maxX: -14,
      minZ: -17,
      maxZ: -14,
      purpose: 'optional-treasure-loop',
      encounter: false,
      story: 'A side bore with a direct sightline to the lower cascade preserves an ordinary salvage cache.',
    },
    {
      id: 'deepConfluenceChamber',
      label: 'Deep Confluence Chamber',
      elevation: MIDDLE_ELEVATION,
      minX: 10,
      maxX: 20,
      minZ: -17,
      maxZ: -5,
      purpose: 'encounter-and-lookout',
      encounter: true,
      story: 'Two recent galleries meet where the ancient lava course widens beside a supported inspection deck.',
    },
    {
      id: 'assayApproach',
      label: 'Assay Approach',
      elevation: LOWER_ELEVATION,
      minX: -12,
      maxX: -4,
      minZ: -17,
      maxZ: -11,
      purpose: 'calm-transition',
      encounter: false,
      story: 'Modern timbering gives way to intact ceramic refinery frames at the Assay Lab threshold.',
    },
  ];
}

function createOptionalChamberDefinitions() {
  return [
    {
      id: 'spoilLedgerPocket',
      label: 'Spoil Ledger Pocket',
      elevation: UPPER_ELEVATION,
      minX: -20,
      maxX: -15,
      minZ: 5,
      maxZ: 9,
      connector: { minX: -15, maxX: -13, minZ: 6, maxZ: 8 },
      purpose: 'digger-lore',
    },
    {
      id: 'thermalSurveyAlcove',
      label: 'Thermal Survey Alcove',
      elevation: MIDDLE_ELEVATION,
      minX: 14,
      maxX: 20,
      minZ: 10,
      maxZ: 16,
      connector: { minX: 18, maxX: 20, minZ: -5, maxZ: 10 },
      purpose: 'lava-observation',
    },
    {
      id: 'ancientServicePocket',
      label: 'Ancient Service Pocket',
      elevation: MIDDLE_ELEVATION,
      minX: -20,
      maxX: -14,
      minZ: 0,
      maxZ: 4,
      connector: { minX: -20, maxX: -18, minZ: -8, maxZ: 0 },
      purpose: 'ancient-refinery-lore',
    },
  ];
}

function createRampLandingDefinitions() {
  return [
    { id: 'flightAStartLanding', routeId: 'digger-descent-flight-a', elevation: UPPER_ELEVATION, minX: -2, maxX: 0, minZ: -7, maxZ: -5 },
    { id: 'flightAEndLanding', routeId: 'digger-descent-flight-a', elevation: MIDDLE_ELEVATION, minX: -18, maxX: -16, minZ: -7, maxZ: -5 },
    { id: 'flightBStartLanding', routeId: 'digger-descent-flight-b', elevation: MIDDLE_ELEVATION, minX: 10, maxX: 12, minZ: -23, maxZ: -21 },
    { id: 'flightBEndLanding', routeId: 'digger-descent-flight-b', elevation: LOWER_ELEVATION, minX: -6, maxX: -4, minZ: -23, maxZ: -21 },
  ].map((landing) => ({
    ...landing,
    structuralBaseElevation: landing.elevation,
    elevation: raisedCatwalkElevation(landing.elevation),
    catwalkRiseMeters: CRITICAL_CATWALK_RISE,
    widthTiles: landing.maxX - landing.minX + 1,
    depthTiles: landing.maxZ - landing.minZ + 1,
    clearWidthMeters: (landing.maxX - landing.minX + 1) * TILE_SIZE,
    clearDepthMeters: (landing.maxZ - landing.minZ + 1) * TILE_SIZE,
    propFree: true,
  }));
}

function createCriticalCatwalkDefinitions() {
  return [
    {
      id: 'upper-entry-catwalk',
      elevation: UPPER_ELEVATION,
      minX: -1,
      maxX: 1,
      minZ: 4,
      maxZ: 17,
      purpose: 'entry-to-western-bore-turn',
    },
    {
      id: 'upper-west-crossing-catwalk',
      elevation: UPPER_ELEVATION,
      minX: -13,
      maxX: 1,
      minZ: 6,
      maxZ: 8,
      purpose: 'western-bore-crossing',
    },
    {
      id: 'upper-west-descent-catwalk',
      elevation: UPPER_ELEVATION,
      minX: -13,
      maxX: -11,
      minZ: -4,
      maxZ: 8,
      purpose: 'western-bore-return-turn',
    },
    {
      id: 'upper-first-melt-crossing-catwalk',
      elevation: UPPER_ELEVATION,
      minX: -13,
      maxX: 0,
      minZ: -4,
      maxZ: -2,
      purpose: 'western-bore-to-first-melt',
    },
    {
      id: 'flight-a-approach-catwalk',
      elevation: UPPER_ELEVATION,
      minX: -2,
      maxX: 0,
      minZ: -7,
      maxZ: -2,
      purpose: 'first-melt-to-flight-a',
    },
    {
      id: 'flight-a-landing-catwalk',
      elevation: MIDDLE_ELEVATION,
      minX: -18,
      maxX: -16,
      minZ: -10,
      maxZ: -5,
      purpose: 'flight-a-to-middle-crossing',
    },
    {
      id: 'middle-survey-catwalk',
      elevation: MIDDLE_ELEVATION,
      minX: -18,
      maxX: 12,
      minZ: -10,
      maxZ: -8,
      purpose: 'middle-crossing-to-deep-confluence',
    },
    {
      id: 'deep-confluence-catwalk',
      elevation: MIDDLE_ELEVATION,
      minX: 10,
      maxX: 12,
      minZ: -23,
      maxZ: -8,
      purpose: 'deep-confluence-to-flight-b',
    },
    {
      id: 'lower-assay-catwalk',
      elevation: LOWER_ELEVATION,
      minX: -6,
      maxX: -4,
      minZ: -23,
      maxZ: -14,
      purpose: 'flight-b-to-assay-turn',
    },
    {
      id: 'assay-turn-catwalk',
      elevation: LOWER_ELEVATION,
      minX: -9,
      maxX: -4,
      minZ: -16,
      maxZ: -14,
      purpose: 'assay-turn',
    },
    {
      id: 'assay-socket-catwalk',
      elevation: LOWER_ELEVATION,
      minX: -9,
      maxX: -7,
      minZ: -17,
      maxZ: -14,
      purpose: 'assay-socket-approach',
    },
  ].map((segment) => ({
    ...segment,
    structuralBaseElevation: segment.elevation,
    elevation: raisedCatwalkElevation(segment.elevation),
    catwalkRiseMeters: CRITICAL_CATWALK_RISE,
    widthTiles: segment.maxX - segment.minX + 1,
    depthTiles: segment.maxZ - segment.minZ + 1,
    deckMaterialRole: 'serviceGrate',
    supported: true,
    collisionBacked: true,
    propFree: true,
  }));
}

function createCriticalCatwalkRailRuns() {
  return [
    {
      id: 'upper-entry-guide-rail',
      elevation: UPPER_ELEVATION,
      orientation: 'z',
      centerX: 0,
      centerZ: 13,
      lengthTiles: 7,
      widthTiles: 3,
    },
    {
      id: 'upper-west-guide-rail',
      elevation: UPPER_ELEVATION,
      orientation: 'z',
      centerX: -12,
      centerZ: 2,
      lengthTiles: 6,
      widthTiles: 3,
    },
    {
      id: 'first-melt-guide-rail',
      elevation: UPPER_ELEVATION,
      orientation: 'x',
      centerX: -7,
      centerZ: -3,
      lengthTiles: 7,
      widthTiles: 3,
    },
    {
      id: 'deep-confluence-guide-rail',
      elevation: MIDDLE_ELEVATION,
      orientation: 'z',
      centerX: 11,
      centerZ: -17.5,
      lengthTiles: 6,
      widthTiles: 3,
    },
    {
      id: 'lower-assay-guide-rail',
      elevation: LOWER_ELEVATION,
      orientation: 'z',
      centerX: -5,
      centerZ: -19,
      lengthTiles: 3,
      widthTiles: 3,
    },
  ].map((run) => ({
    ...run,
    structuralBaseElevation: run.elevation,
    elevation: raisedCatwalkElevation(run.elevation),
    catwalkRiseMeters: CRITICAL_CATWALK_RISE,
    clearWidthMeters: run.widthTiles * TILE_SIZE,
    landingClearancePreserved: true,
    junctionClearancePreserved: true,
  }));
}

function createFloorPlan({ upperBridgeZ, activeOptionalChamberIds, chambers, optionalChambers }) {
  const floors = new Map();
  const bridgeCells = new Set();
  const landingCells = new Set();

  const setFloor = (x, z, elevation, overrides = {}) => {
    const key = floorKey(x, z, elevation);
    const existing = floors.get(key);
    floors.set(key, {
      x,
      z,
      elevation: fixed(elevation),
      level: Math.round(elevation / 7),
      roomId: MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
      roomBaseElevation: 0,
      surface: 'boredBasaltFloor',
      surfaceRole: 'floor',
      ...existing,
      ...overrides,
    });
  };

  const addRect = (minX, maxX, minZ, maxZ, elevation, overrides = {}) => {
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) setFloor(x, z, elevation, overrides);
    }
  };

  for (const chamber of chambers) {
    addRect(chamber.minX, chamber.maxX, chamber.minZ, chamber.maxZ, chamber.elevation, {
      chamberId: chamber.id,
      surface: chamber.id === 'assayApproach' ? 'ancientCeramicFloor' : 'boredBasaltFloor',
    });
  }

  // Stable broad upper-band maze: two loops converge at First Melt.
  addRect(-13, -5, 6, 8, UPPER_ELEVATION, { routeId: 'westEchoLoop' });
  addRect(-13, -11, -2, 8, UPPER_ELEVATION, { routeId: 'westEchoLoop' });
  addRect(-13, -5, -4, -2, UPPER_ELEVATION, { routeId: 'westEchoLoop' });
  addRect(5, 16, upperBridgeZ - 1, upperBridgeZ + 1, UPPER_ELEVATION, { routeId: 'foremanCacheLoop' });
  addRect(14, 16, -2, upperBridgeZ + 1, UPPER_ELEVATION, { routeId: 'foremanCacheLoop' });
  addRect(5, 16, -4, -2, UPPER_ELEVATION, { routeId: 'foremanCacheLoop' });

  // Stable broad middle-band maze: two loops independently reach Deep Confluence.
  addRect(-12, 9, -10, -8, MIDDLE_ELEVATION, { routeId: 'surveyorsLoop' });
  addRect(-20, -18, -14, -8, MIDDLE_ELEVATION, { routeId: 'surveyorsBlindLoop' });
  addRect(7, 9, -14, -8, MIDDLE_ELEVATION, { routeId: 'coolingBoreLoop' });
  addRect(7, 12, -14, -12, MIDDLE_ELEVATION, { routeId: 'coolingBoreLoop' });

  // Flight B sits outside the stacked maze footprint. These short three-wide
  // approaches connect its landings without placing another floor over it.
  addRect(10, 12, -23, -18, MIDDLE_ELEVATION, { routeId: 'flightBUpperApproach' });
  addRect(13, 14, -23, -21, MIDDLE_ELEVATION, { routeId: 'flightBUpperLandingExit' });
  addRect(-6, -4, -23, -18, LOWER_ELEVATION, { routeId: 'flightBLowerApproach' });
  addRect(-8, -7, -23, -21, LOWER_ELEVATION, { routeId: 'flightBLowerLandingExit' });

  for (const optional of optionalChambers) {
    if (!activeOptionalChamberIds.includes(optional.id)) continue;
    addRect(optional.minX, optional.maxX, optional.minZ, optional.maxZ, optional.elevation, {
      chamberId: optional.id,
      optionalChamber: true,
    });
    addRect(
      optional.connector.minX,
      optional.connector.maxX,
      optional.connector.minZ,
      optional.connector.maxZ,
      optional.elevation,
      { routeId: `${optional.id}Connector` },
    );
  }

  const rampLandings = createRampLandingDefinitions();
  for (const landing of rampLandings) {
    addRect(landing.minX, landing.maxX, landing.minZ, landing.maxZ, landing.structuralBaseElevation, {
      surface: 'diggerRampLanding',
      surfaceRole: 'landing',
      landingId: landing.id,
    });
    for (let x = landing.minX; x <= landing.maxX; x += 1) {
      for (let z = landing.minZ; z <= landing.maxZ; z += 1) {
        landingCells.add(floorKey(x, z, landing.elevation));
      }
    }
  }

  const addRamp = ({ id, startX, zMin, startElevation, endElevation }) => {
    const rise = (endElevation - startElevation) / RAMP_SEGMENTS;
    for (let segmentIndex = 0; segmentIndex < RAMP_SEGMENTS; segmentIndex += 1) {
      const x = startX - segmentIndex;
      const rampStartElevation = startElevation + rise * segmentIndex;
      const rampEndElevation = startElevation + rise * (segmentIndex + 1);
      for (let z = zMin; z < zMin + RAMP_WIDTH_TILES; z += 1) {
        setFloor(x, z, (rampStartElevation + rampEndElevation) * 0.5, {
          surface: 'diggerDescentRamp',
          surfaceRole: 'ramp',
          rampRouteId: id,
          rampSegmentIndex: segmentIndex,
          rampStartElevation: fixed(rampStartElevation),
          rampEndElevation: fixed(rampEndElevation),
          rampDirectionX: -1,
          rampDirectionZ: 0,
          groundedStepTransitionHeight: PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile + 0.05,
        });
      }
    }
  };

  addRamp({
    id: 'digger-descent-flight-a',
    startX: -3,
    zMin: -7,
    startElevation: UPPER_ELEVATION,
    endElevation: MIDDLE_ELEVATION,
  });
  addRamp({
    id: 'digger-descent-flight-b',
    startX: 9,
    zMin: -23,
    startElevation: MIDDLE_ELEVATION,
    endElevation: LOWER_ELEVATION,
  });

  const lavaTiles = [];
  for (let z = -23; z <= 17; z += 1) {
    const centerX = lavaCenterXAt(z);
    const bandElevation = bandElevationForZ(z);
    for (const x of [centerX, centerX + 1]) {
      lavaTiles.push({
        x,
        z,
        elevation: fixed(bandElevation + LAVA_OFFSET),
        level: Math.round((bandElevation + LAVA_OFFSET) / 7),
        ownerFloorElevation: bandElevation,
        roomId: MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
        roomBaseElevation: 0,
        surface: 'deepMagma',
        surfaceRole: 'hazard-floor',
        allowsGroundedDropLanding: true,
        hazardPathCost: 18,
        heatCompatibleOnly: true,
      });
    }
  }

  const bridgeRegions = [
    { id: 'upperExcavationBridge', elevation: UPPER_ELEVATION, minX: 5, maxX: 10, minZ: upperBridgeZ - 1, maxZ: upperBridgeZ + 1 },
    { id: 'middleNorthBridge', elevation: MIDDLE_ELEVATION, minX: 0, maxX: 5, minZ: -10, maxZ: -8 },
  ];
  for (const bridge of bridgeRegions) {
    for (let x = bridge.minX; x <= bridge.maxX; x += 1) {
      for (let z = bridge.minZ; z <= bridge.maxZ; z += 1) {
        const lavaHere = lavaTiles.some((tile) => tile.x === x && tile.z === z);
        if (!lavaHere) continue;
        setFloor(x, z, bridge.elevation, {
          surface: 'diggerServiceBridge',
          surfaceRole: 'bridge',
          bridgeId: bridge.id,
          supportedElevatedRoute: true,
        });
        bridgeCells.add(floorKey(x, z, bridge.elevation));
      }
    }
  }

  // Where the river cuts ordinary chambers, keep the magma visible. Only
  // declared bridges and the two supported ramps may occupy the same column.
  const rampColumns = new Set(
    [...floors.values()]
      .filter((tile) => tile.surfaceRole === 'ramp')
      .map((tile) => cellKey(tile.x, tile.z)),
  );
  for (const [key, tile] of floors) {
    if (tile.surfaceRole !== 'ramp' && rampColumns.has(cellKey(tile.x, tile.z))) floors.delete(key);
  }
  for (const lavaTile of lavaTiles) {
    const safeKey = floorKey(lavaTile.x, lavaTile.z, lavaTile.ownerFloorElevation);
    if (!bridgeCells.has(safeKey) && !rampColumns.has(cellKey(lavaTile.x, lavaTile.z))) {
      floors.delete(safeKey);
    }
  }

  // One continuous raised route guides the player from the entry socket to
  // both descent flights and onward to the Assay socket. It replaces the
  // owning floor rather than stacking another walkable layer over it.
  const criticalCatwalk = createCriticalCatwalkDefinitions();
  const criticalCatwalkRailRuns = createCriticalCatwalkRailRuns();
  const criticalCatwalkCells = new Map();
  const criticalCatwalkTiles = new Set();
  const missingCriticalCatwalkCells = [];
  for (const segment of criticalCatwalk) {
    for (let x = segment.minX; x <= segment.maxX; x += 1) {
      for (let z = segment.minZ; z <= segment.maxZ; z += 1) {
        const key = floorKey(x, z, segment.structuralBaseElevation);
        const tile = floors.get(key);
        if (!tile || tile.surfaceRole === 'ramp') {
          missingCriticalCatwalkCells.push({
            segmentId: segment.id,
            x,
            z,
            elevation: segment.structuralBaseElevation,
          });
          continue;
        }
        const segmentIds = new Set(tile.criticalCatwalkSegmentIds ?? []);
        segmentIds.add(segment.id);
        Object.assign(tile, {
          surface: 'diggerCriticalCatwalk',
          criticalPath: true,
          criticalCatwalk: true,
          criticalCatwalkRouteId: 'linear-excavation-critical-route',
          criticalCatwalkSegmentIds: [...segmentIds],
          supportedElevatedRoute: true,
          propFree: true,
          groundedStepTransitionHeight: CRITICAL_CATWALK_RISE + 0.05,
          groundedCatwalkTransition: true,
          ledgeSafetyExempt: true,
        });
        criticalCatwalkTiles.add(tile);
      }
    }
  }
  if (missingCriticalCatwalkCells.length > 0) {
    throw new Error(
      `Linear Digger Excavation critical catwalk is incomplete: ${JSON.stringify(missingCriticalCatwalkCells)}`,
    );
  }

  const applyAccessRamp = (tile, {
    routeId,
    segmentIndex,
    startElevation,
    endElevation,
    directionZ,
  }) => {
    tile.surface = 'diggerCriticalCatwalkRamp';
    tile.surfaceRole = 'ramp';
    tile.rampRouteId = routeId;
    tile.rampSegmentIndex = segmentIndex;
    tile.rampStartElevation = fixed(startElevation);
    tile.rampEndElevation = fixed(endElevation);
    tile.rampDirectionX = 0;
    tile.rampDirectionZ = directionZ;
    tile.elevation = fixed((startElevation + endElevation) * 0.5);
    tile.groundedStepTransitionHeight = CRITICAL_CATWALK_RISE + 0.05;
  };

  // Preserve both socket elevations with two shallow, three-wide boarding
  // ramps. Everything between them uses the full raised catwalk datum.
  for (const tile of criticalCatwalkTiles) {
    const baseElevation = tile.elevation;
    tile.structuralBaseElevation = baseElevation;
    tile.catwalkRiseMeters = CRITICAL_CATWALK_RISE;
    tile.groundedStepTransitionHeight = CRITICAL_CATWALK_RISE + 0.05;
    tile.groundedCatwalkTransition = true;
    tile.ledgeSafetyExempt = true;
    const segmentIds = [...(tile.criticalCatwalkSegmentIds ?? [])];
    if (tile.x >= -1 && tile.x <= 1 && (tile.z === 17 || tile.z === 16)) {
      const segmentIndex = 17 - tile.z;
      const startElevation = UPPER_ELEVATION
        + (CRITICAL_CATWALK_RISE / CATWALK_ACCESS_RAMP_SEGMENTS) * segmentIndex;
      applyAccessRamp(tile, {
        routeId: 'critical-catwalk-entry-rise',
        segmentIndex,
        startElevation,
        endElevation: startElevation + CRITICAL_CATWALK_RISE / CATWALK_ACCESS_RAMP_SEGMENTS,
        directionZ: -1,
      });
    } else if (tile.x >= -9 && tile.x <= -7 && (tile.z === -16 || tile.z === -17)) {
      const segmentIndex = Math.abs(tile.z) - 16;
      const startElevation = LOWER_ELEVATION + CRITICAL_CATWALK_RISE
        - (CRITICAL_CATWALK_RISE / CATWALK_ACCESS_RAMP_SEGMENTS) * segmentIndex;
      applyAccessRamp(tile, {
        routeId: 'critical-catwalk-assay-descent',
        segmentIndex,
        startElevation,
        endElevation: startElevation - CRITICAL_CATWALK_RISE / CATWALK_ACCESS_RAMP_SEGMENTS,
        directionZ: -1,
      });
    } else {
      tile.elevation = raisedCatwalkElevation(baseElevation);
    }
    criticalCatwalkCells.set(cellKey(tile.x, tile.z), {
      x: tile.x,
      z: tile.z,
      elevation: tile.elevation,
      structuralBaseElevation: baseElevation,
      catwalkRiseMeters: CRITICAL_CATWALK_RISE,
      segmentIds,
      surfaceRole: tile.surfaceRole,
      rampRouteId: tile.rampRouteId ?? null,
      groundedStepTransitionHeight: tile.groundedStepTransitionHeight,
      groundedCatwalkTransition: true,
      ledgeSafetyExempt: true,
    });
  }

  // The two signed seven-metre flights are part of the same raised route.
  // Shift both endpoints equally so their approved gradients and deltas remain
  // unchanged while their grating aligns flush with every raised landing.
  for (const tile of floors.values()) {
    if (!['digger-descent-flight-a', 'digger-descent-flight-b'].includes(tile.rampRouteId)) continue;
    tile.structuralBaseElevation = tile.elevation;
    tile.rampStartElevation = raisedCatwalkElevation(tile.rampStartElevation);
    tile.rampEndElevation = raisedCatwalkElevation(tile.rampEndElevation);
    tile.elevation = fixed((tile.rampStartElevation + tile.rampEndElevation) * 0.5);
    tile.criticalPath = true;
    tile.criticalCatwalk = true;
    tile.criticalCatwalkRouteId = 'linear-excavation-critical-route';
    tile.catwalkRiseMeters = CRITICAL_CATWALK_RISE;
    tile.supportedElevatedRoute = true;
    tile.propFree = true;
    tile.groundedStepTransitionHeight = CRITICAL_CATWALK_RISE + 0.05;
    tile.groundedCatwalkTransition = true;
    tile.ledgeSafetyExempt = true;
  }

  // Tile elevations changed in-place; rebuild keys so later validation and
  // seam assembly observe the actual raised walking surfaces.
  const raisedFloors = [...floors.values()];
  floors.clear();
  for (const tile of raisedFloors) floors.set(floorKey(tile.x, tile.z, tile.elevation), tile);

  const safeSurfacesByColumn = new Map();
  for (const tile of floors.values()) {
    const key = cellKey(tile.x, tile.z);
    const column = safeSurfacesByColumn.get(key) ?? [];
    column.push(tile);
    safeSurfacesByColumn.set(key, column);
  }
  const stackedWalkableColumns = [...safeSurfacesByColumn.entries()]
    .filter(([, column]) => new Set(column.map((tile) => fixed(tile.elevation))).size > 1)
    .map(([key, column]) => ({
      key,
      elevations: column.map((tile) => fixed(tile.elevation)).sort((left, right) => left - right),
    }));
  if (stackedWalkableColumns.length > 0) {
    throw new Error(
      `Linear Digger Excavation generated overlapping walkable layers: ${JSON.stringify(stackedWalkableColumns)}`,
    );
  }

  return {
    floorTiles: [...floors.values(), ...lavaTiles].sort((left, right) => (
      left.elevation - right.elevation || left.z - right.z || left.x - right.x
    )),
    rampLandings,
    bridgeRegions,
    bridgeCells: [...bridgeCells],
    landingCells: [...landingCells],
    criticalCatwalk,
    criticalCatwalkCells: [...criticalCatwalkCells.values()],
    criticalCatwalkRailRuns,
    stackedWalkableColumns,
  };
}

function createDressingPlan(random, activeOptionalChamberIds) {
  const braces = [
    { id: 'survey-mouth-brace', x: 0, z: 13, elevation: 0, alongX: true },
    { id: 'west-loop-brace-a', x: -9, z: 7, elevation: 0, alongX: false },
    { id: 'west-loop-brace-b', x: -12, z: 2, elevation: 0, alongX: true },
    { id: 'cache-loop-brace', x: 15, z: -1, elevation: 0, alongX: true },
    { id: 'middle-north-brace', x: -1, z: -9, elevation: -7, alongX: false },
    { id: 'middle-south-brace', x: 8, z: -13, elevation: -7, alongX: false },
    { id: 'assay-approach-brace', x: -8, z: -13, elevation: -14, alongX: true, ancient: true },
  ];
  const rubbleAnchors = [
    { x: -3.7, z: 14.8, elevation: 0 },
    { x: 3.5, z: 5.2, elevation: 0 },
    { x: 11.2, z: 5.5, elevation: 0 },
    { x: -14.2, z: -12.2, elevation: -7 },
    { x: -17.2, z: -15.2, elevation: -7 },
    { x: 18.1, z: -12.2, elevation: -7 },
    { x: -10.5, z: -12.5, elevation: -14 },
  ];
  const vary = (value, distance = 0.22) => value + (random() - 0.5) * distance;
  const cavernFormations = [
    { kind: 'stalagmite', x: -3, z: 16, elevation: 0, height: 1.85, radius: 0.66 },
    { kind: 'stalagmite', x: 4, z: 9, elevation: 0, height: 2.25, radius: 0.78 },
    { kind: 'stalagmite', x: -4, z: 1, elevation: 0, height: 1.55, radius: 0.58 },
    { kind: 'stalagmite', x: -20, z: -12, elevation: -7, height: 2.15, radius: 0.74 },
    { kind: 'stalagmite', x: 19, z: -16, elevation: -7, height: 2.5, radius: 0.82 },
    { kind: 'stalagmite', x: -11, z: -12, elevation: -14, height: 1.7, radius: 0.62 },
    { kind: 'stalactite', x: 3, z: 12, elevation: 0, ceilingY: 11.2, height: 2.3, radius: 0.76 },
    { kind: 'stalactite', x: -3, z: 9, elevation: 0, ceilingY: 11.2, height: 1.9, radius: 0.64 },
    { kind: 'stalactite', x: 4, z: 0, elevation: 0, ceilingY: 11.2, height: 2.65, radius: 0.86 },
    { kind: 'stalactite', x: -19, z: -16, elevation: -7, ceilingY: 4.2, height: 1.75, radius: 0.61 },
    { kind: 'stalactite', x: 18, z: -14, elevation: -7, ceilingY: 4.2, height: 2.4, radius: 0.8 },
    { kind: 'stalactite', x: -10, z: -12, elevation: -14, ceilingY: -2.8, height: 1.7, radius: 0.58 },
  ].map((formation, index) => ({
    ...formation,
    id: `cavern-${formation.kind}-${index + 1}`,
    x: vary(formation.x, 0.28) * TILE_SIZE,
    z: vary(formation.z, 0.28) * TILE_SIZE,
    height: formation.kind === 'stalactite' ? 2.2 : 1.95,
    radius: formation.kind === 'stalactite' ? 0.72 : 0.68,
    yaw: random() * Math.PI,
  }));
  const boulders = [
    { x: -4, z: 14, elevation: 0, radius: 0.82 },
    { x: 4, z: 5, elevation: 0, radius: 0.96 },
    { x: 11, z: 2, elevation: 0, radius: 0.72 },
    { x: -20, z: -16, elevation: -7, radius: 0.9 },
    { x: 20, z: -11, elevation: -7, radius: 0.78 },
    { x: 16, z: -16, elevation: -7, radius: 0.68 },
    { x: -12, z: -16, elevation: -14, radius: 0.72 },
  ].map((boulder, index) => ({
    ...boulder,
    id: `excavation-boulder-${index + 1}`,
    x: vary(boulder.x, 0.34) * TILE_SIZE,
    z: vary(boulder.z, 0.34) * TILE_SIZE,
    radius: 0.82,
    scaleY: 1,
    yaw: random() * Math.PI * 2,
  }));
  const workVehicles = [
    { id: 'foreman-cache-minecart', kind: 'minecart', x: 15, z: 6, elevation: 0, yaw: Math.PI * 0.08 },
    { id: 'surveyors-blind-minecart', kind: 'minecart', x: -18, z: -16, elevation: -7, yaw: Math.PI * 0.54 },
    { id: 'first-melt-tool-trolley', kind: 'trolley', x: 4, z: 1, elevation: 0, yaw: Math.PI * 0.88 },
    { id: 'deep-confluence-tool-trolley', kind: 'trolley', x: 19, z: -6, elevation: -7, yaw: Math.PI * 0.18 },
  ].map((vehicle) => ({
    ...vehicle,
    x: vary(vehicle.x, 0.18) * TILE_SIZE,
    z: vary(vehicle.z, 0.18) * TILE_SIZE,
    yaw: vehicle.yaw + (random() - 0.5) * 0.16,
  }));
  const pickaxes = [
    { id: 'survey-mouth-pickaxe', x: -4.36, z: 14.1, elevation: 0, yaw: 0.1 },
    { id: 'split-bore-pickaxe', x: 4.36, z: 9.2, elevation: 0, yaw: -0.12 },
    { id: 'first-melt-pickaxe', x: -4.45, z: 0.1, elevation: 0, yaw: 0.08 },
    { id: 'central-survey-pickaxe', x: -20.42, z: -11.2, elevation: -7, yaw: 0.12 },
    { id: 'deep-confluence-pickaxe', x: 19.42, z: -14.4, elevation: -7, yaw: -0.1 },
  ].map((pickaxe) => ({
    ...pickaxe,
    x: pickaxe.x * TILE_SIZE,
    z: pickaxe.z * TILE_SIZE,
    roll: pickaxe.yaw + (random() - 0.5) * 0.12,
  }));
  return {
    braces,
    rubble: rubbleAnchors.map((anchor, index) => ({
      id: `digger-spoil-${index + 1}`,
      x: (anchor.x + (random() - 0.5) * 0.35) * TILE_SIZE,
      z: (anchor.z + (random() - 0.5) * 0.35) * TILE_SIZE,
      elevation: anchor.elevation,
      radius: 0.55 + random() * 0.35,
      height: 0.45 + random() * 0.6,
      yaw: random() * Math.PI,
    })),
    surveyMarks: [
      { id: 'survey-mark-entry', x: -3.7, z: 12.4, elevation: 0 },
      { id: 'survey-mark-flight-a', x: -4.7, z: -2.2, elevation: 0 },
      { id: 'survey-mark-middle', x: -16.4, z: -8.8, elevation: -7 },
      { id: 'survey-mark-flight-b', x: 11.4, z: -15.8, elevation: -7 },
    ],
    cavernFormations,
    boulders,
    workVehicles,
    pickaxes,
    cappedOptionalChamberIds: ['spoilLedgerPocket', 'thermalSurveyAlcove', 'ancientServicePocket']
      .filter((id) => !activeOptionalChamberIds.includes(id)),
  };
}

export function createMagmaLinearDiggerExcavationPlan({
  seed = 'magma-linear-excavation-default',
  random = null,
  tileSize = TILE_SIZE,
} = {}) {
  if (Math.abs(tileSize - TILE_SIZE) > 0.0001) {
    throw new Error(`Linear Digger Excavation requires the shared ${TILE_SIZE} m macro tile.`);
  }
  const rng = random ?? createSeededRandom(seed);
  const upperLoopOrientation = rng() < 0.5 ? 'west-first' : 'east-first';
  const upperBridgeZ = rng() < 0.5 ? 8 : 5;
  const optionalChambers = createOptionalChamberDefinitions();
  const optionalRotation = Math.floor(rng() * optionalChambers.length);
  const activeOptionalChamberIds = [
    optionalChambers[optionalRotation].id,
    optionalChambers[(optionalRotation + 1) % optionalChambers.length].id,
  ];
  const chambers = createChamberDefinitions();
  const floorPlan = createFloorPlan({
    upperBridgeZ,
    activeOptionalChamberIds,
    chambers,
    optionalChambers,
  });

  const sockets = [
    {
      id: 'linear-excavation-entry-socket',
      kind: 'player',
      x: 0,
      z: 17,
      elevation: UPPER_ELEVATION,
      facingX: 0,
      facingZ: 1,
      widthMeters: 8.4,
      heightMeters: SOCKET_HEIGHT,
      clearLandingMeters: { width: 8.4, depth: 8.4 },
    },
    {
      id: 'linear-excavation-assay-socket',
      kind: 'player',
      x: -8,
      z: -17,
      elevation: LOWER_ELEVATION,
      facingX: 0,
      facingZ: -1,
      widthMeters: 8.4,
      heightMeters: SOCKET_HEIGHT,
      clearLandingMeters: { width: 8.4, depth: 8.4 },
    },
    {
      id: 'linear-excavation-lava-inlet',
      kind: 'environmental-spine',
      x: 6.5,
      z: 17,
      elevation: UPPER_ELEVATION + LAVA_OFFSET,
      facingX: 0,
      facingZ: 1,
      widthMeters: 4.2,
      continuityTag: LAVA_CONTINUITY_TAG,
    },
    {
      id: 'linear-excavation-lava-outlet',
      kind: 'environmental-spine',
      x: 4.5,
      z: -17,
      elevation: LOWER_ELEVATION + LAVA_OFFSET,
      facingX: 0,
      facingZ: -1,
      widthMeters: 4.2,
      continuityTag: LAVA_CONTINUITY_TAG,
    },
  ];
  const socketFrames = sockets
    .filter((socket) => socket.kind === 'player')
    .map((socket) => ({
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

  const plan = {
    schema: 'ruindivex-room-module/v1',
    moduleId: MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
    topologyRevision: MAGMA_LINEAR_DIGGER_EXCAVATION_TOPOLOGY_REVISION,
    themePackId: 'magma-refinery-future',
    tileSize,
    dimensions: {
      widthTiles: ROOM_WIDTH_TILES,
      depthTiles: ROOM_DEPTH_TILES,
      authoredEnvelopeMeters: {
        width: ROOM_WIDTH_TILES * TILE_SIZE,
        depth: ROOM_DEPTH_TILES * TILE_SIZE,
      },
      minY: LOWER_ELEVATION + LAVA_OFFSET,
      maxY: UPPER_ELEVATION + CHAMBER_HEADROOM + CRITICAL_CATWALK_RISE,
    },
    room: {
      id: MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
      type: 'excavation',
      archetype: 'magma-linear-digger-excavation',
      x: 0,
      z: 0,
      width: ROOM_WIDTH_TILES,
      depth: ROOM_DEPTH_TILES,
      baseElevation: UPPER_ELEVATION,
      minY: LOWER_ELEVATION + LAVA_OFFSET,
      maxY: UPPER_ELEVATION + CRITICAL_CATWALK_RISE,
      ceilingY: UPPER_ELEVATION + CHAMBER_HEADROOM + CRITICAL_CATWALK_RISE,
      ceilingHeight: CHAMBER_HEADROOM,
      purpose: 'A recently bored maze that descends beside the refinery lava spine.',
      mood: 'Modern excavation lights reveal an ancient industrial depth that the Diggers only just uncovered.',
      environmentalStory: 'Fresh drill scars, braces, cables, and survey paint stop where intact ancient ceramic frames begin.',
      previewPosition: { x: 0, y: raisedCatwalkElevation(UPPER_ELEVATION), z: 15 },
      previewFacing: { x: 0, z: -1 },
      previewAnchors: {
        criticalCatwalkEntry: { x: 0, y: raisedCatwalkElevation(UPPER_ELEVATION), z: 15, facingX: 0, facingZ: -1 },
        criticalCatwalkWestTurn: { x: -1, y: raisedCatwalkElevation(UPPER_ELEVATION), z: 7, facingX: -1, facingZ: 0 },
        criticalCatwalkSideStep: { x: 2, y: UPPER_ELEVATION, z: 8, facingX: -1, facingZ: 0 },
        workClutterUpper: { x: 12, y: UPPER_ELEVATION, z: 6, facingX: 1, facingZ: 0 },
        flightATop: { x: -1, y: raisedCatwalkElevation(UPPER_ELEVATION), z: -6, facingX: -1, facingZ: 0 },
        flightAMidpoint: { x: -9, y: raisedCatwalkElevation(-3.5), z: -6, facingX: -1, facingZ: 0 },
        flightABottom: { x: -17, y: raisedCatwalkElevation(MIDDLE_ELEVATION), z: -6, facingX: -1, facingZ: 0 },
        flightADescent: { x: -14, y: raisedCatwalkElevation(-6.192308), z: -6, facingX: -1, facingZ: 0 },
        flightAEndLanding: { x: -17, y: raisedCatwalkElevation(MIDDLE_ELEVATION), z: -6, facingX: -1, facingZ: 0 },
        criticalCatwalkMiddle: { x: -17, y: raisedCatwalkElevation(MIDDLE_ELEVATION), z: -9, facingX: 1, facingZ: 0 },
        criticalCatwalkDeepTurn: { x: 11, y: raisedCatwalkElevation(MIDDLE_ELEVATION), z: -10, facingX: 0, facingZ: -1 },
        workClutterMiddle: { x: 16, y: MIDDLE_ELEVATION, z: -9, facingX: 1, facingZ: 1 },
        flightBTop: { x: 11, y: raisedCatwalkElevation(MIDDLE_ELEVATION), z: -22, facingX: -1, facingZ: 0 },
        flightBMidpoint: { x: 3, y: raisedCatwalkElevation(-10.5), z: -22, facingX: -1, facingZ: 0 },
        flightBBottom: { x: -5, y: raisedCatwalkElevation(LOWER_ELEVATION), z: -22, facingX: -1, facingZ: 0 },
        flightBDescent: { x: -2, y: raisedCatwalkElevation(-13.192308), z: -22, facingX: -1, facingZ: 0 },
        flightBEndLanding: { x: -5, y: raisedCatwalkElevation(LOWER_ELEVATION), z: -22, facingX: -1, facingZ: 0 },
        criticalCatwalkAssayApproach: { x: -5, y: raisedCatwalkElevation(LOWER_ELEVATION), z: -19, facingX: 0, facingZ: 1 },
      },
      verticalPlan: {
        baseElevation: UPPER_ELEVATION,
        localWalkableTiers: [UPPER_ELEVATION, MIDDLE_ELEVATION, LOWER_ELEVATION],
        requiredRouteElevationSequence: [
          raisedCatwalkElevation(UPPER_ELEVATION),
          raisedCatwalkElevation(MIDDLE_ELEVATION),
          raisedCatwalkElevation(LOWER_ELEVATION),
        ],
      },
    },
    chambers,
    optionalChambers,
    activeOptionalChamberIds,
    upperLoopOrientation,
    upperBridgeZ,
    sockets,
    socketFrames,
    floorTiles: floorPlan.floorTiles,
    rampLandings: floorPlan.rampLandings,
    bridgeRegions: floorPlan.bridgeRegions,
    bridgeCells: floorPlan.bridgeCells,
    landingCells: floorPlan.landingCells,
    criticalCatwalk: floorPlan.criticalCatwalk,
    criticalCatwalkCells: floorPlan.criticalCatwalkCells,
    criticalCatwalkRailRuns: floorPlan.criticalCatwalkRailRuns,
    stackedWalkableColumns: floorPlan.stackedWalkableColumns,
    dressing: createDressingPlan(rng, activeOptionalChamberIds),
    reward: {
      chestId: OLD_DRILL_CHEST_ID,
      itemId: OLD_DRILL_ITEM_ID,
      persistenceKey: 'oldDrillClaimed',
      chamberId: 'drillForemanCache',
      position: { x: 13 * TILE_SIZE, y: UPPER_ELEVATION, z: 4 * TILE_SIZE },
      encounterLocked: false,
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
      maximumOwnerLengthTiles: 3,
      ownerFlag: 'cameraOcclusionOwner',
      surfaceFlag: 'cameraOcclusionSurface',
    },
    clearanceContract: {
      minimumTunnelHeadroomMeters: TUNNEL_HEADROOM,
      minimumChamberHeadroomMeters: CHAMBER_HEADROOM,
      cameraOcclusionRequired: true,
      stackedWalkableColumnsAllowed: false,
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
    name: `magmaLinearExcavation_${setName}`,
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
      emissiveIntensity: 2.25,
      roughness: 0.32,
      metalness: 0,
    }),
    lamp: new THREE.MeshStandardMaterial({
      name: 'magmaLinearExcavation_diggerLamp',
      color: 0xffd6a0,
      emissive: 0xff7a22,
      emissiveIntensity: 2.6,
      roughness: 0.28,
      metalness: 0.12,
    }),
    surveyPaint: new THREE.MeshStandardMaterial({
      name: 'magmaLinearExcavation_surveyPaint',
      color: 0x72e7ff,
      emissive: 0x176d7c,
      emissiveIntensity: 0.8,
      roughness: 0.7,
      metalness: 0,
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
    options.thetaStart ?? 0,
  ), options.metersPerRepeat ?? TILE_SIZE);
  const mesh = new THREE.Mesh(geometry, options.material);
  mesh.name = options.name;
  mesh.position.set(options.x, options.y, options.z);
  mesh.rotation.set(options.pitch ?? 0, options.yaw ?? 0, options.roll ?? 0);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  mesh.userData.worldUvTiled = true;
  parent.add(mesh);
  return mesh;
}

function addInstancedTiles(parent, {
  name,
  tiles,
  material,
  thickness,
  yForTile,
  metersPerRepeat = TILE_SIZE,
}) {
  if (tiles.length === 0) return null;
  const geometry = createTiledBoxGeometry(TILE_SIZE * 1.012, thickness, TILE_SIZE * 1.012, metersPerRepeat);
  const mesh = new THREE.InstancedMesh(geometry, material, tiles.length);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.worldUvTiled = true;
  const matrix = new THREE.Matrix4();
  tiles.forEach((tile, index) => {
    matrix.makeTranslation(tile.x * TILE_SIZE, yForTile(tile), tile.z * TILE_SIZE);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
  return mesh;
}

function addInstancedMatrices(parent, {
  name,
  geometry,
  material,
  matrices,
  userData = {},
}) {
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

function createSolidZone(id, x, y, z, halfWidth, halfDepth, verticalHalfHeight, obstacleKind) {
  return {
    id,
    roomId: MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
    position: new THREE.Vector3(x, y, z),
    halfWidth,
    halfDepth,
    verticalHalfHeight,
    obstacleKind,
    // DungeonController resolves the player by root position. Expand authored
    // solids by the capsule radius so a fast frame can never place the root
    // beyond a thin wall, railing, support, or prop before correction runs.
    playerCollisionPadding: PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
  };
}

function addWallRunCollision(solidZones, id, walls, side) {
  if (walls.length === 0) return;
  const alongX = side === 'north' || side === 'south';
  const thickness = 0.34;
  const height = walls[0].height;
  const minX = Math.min(...walls.map((wall) => wall.x));
  const maxX = Math.max(...walls.map((wall) => wall.x));
  const minZ = Math.min(...walls.map((wall) => wall.z));
  const maxZ = Math.max(...walls.map((wall) => wall.z));
  const floorY = walls[0].floorY;
  solidZones.push(createSolidZone(
    `${id}Collision`,
    (minX + maxX) * 0.5,
    floorY + height * 0.5,
    (minZ + maxZ) * 0.5,
    alongX ? (maxX - minX + TILE_SIZE * 1.04) * 0.5 : thickness * 0.5,
    alongX ? thickness * 0.5 : (maxZ - minZ + TILE_SIZE * 1.04) * 0.5,
    height * 0.5,
    'excavationRockWall',
  ));
}

function addCeilingRuns(parent, plan, materials, aerialOnlyZones) {
  const nonRamp = plan.floorTiles.filter((tile) => tile.surfaceRole !== 'ramp');
  const chunks = new Map();
  for (const tile of nonRamp) {
    const bandElevation = tile.surface === 'deepMagma'
      ? tile.ownerFloorElevation
      : (tile.structuralBaseElevation ?? tile.elevation);
    const chamber = plan.chambers.find((candidate) => (
      candidate.elevation === bandElevation
        && tile.x >= candidate.minX && tile.x <= candidate.maxX
        && tile.z >= candidate.minZ && tile.z <= candidate.maxZ
    ));
    const headroom = chamber ? CHAMBER_HEADROOM : TUNNEL_HEADROOM;
    const walkableElevation = tile.surface === 'deepMagma'
      ? tile.ownerFloorElevation
      : tile.elevation;
    const ceilingElevation = walkableElevation + headroom;
    const chunkX = Math.floor((tile.x + 24) / 3);
    const chunkZ = Math.floor((tile.z + 18) / 3);
    const key = `${fixed(bandElevation)}:${fixed(ceilingElevation)}:${chunkX}:${chunkZ}`;
    const chunk = chunks.get(key) ?? {
      bandElevation,
      headroom,
      ceilingElevation,
      cells: new Map(),
    };
    chunk.cells.set(cellKey(tile.x, tile.z), { x: tile.x, z: tile.z });
    chunks.set(key, chunk);
  }

  let ownerIndex = 0;
  const batches = new Map();
  for (const chunk of chunks.values()) {
    const cells = [...chunk.cells.values()];
    ownerIndex += 1;
    const batchKey = `${chunk.bandElevation}:${chunk.ceilingElevation}`;
    const batch = batches.get(batchKey) ?? {
      bandElevation: chunk.bandElevation,
      headroom: chunk.headroom,
      ceilingElevation: chunk.ceilingElevation,
      cells: [],
    };
    batch.cells.push(...cells);
    batches.set(batchKey, batch);
    const minX = Math.min(...cells.map((cell) => cell.x));
    const maxX = Math.max(...cells.map((cell) => cell.x));
    const minZ = Math.min(...cells.map((cell) => cell.z));
    const maxZ = Math.max(...cells.map((cell) => cell.z));
    aerialOnlyZones.push(createSolidZone(
      `excavationCeilingRun${ownerIndex}Collision`,
      (minX + maxX) * 0.5 * TILE_SIZE,
      chunk.ceilingElevation + 0.17,
      (minZ + maxZ) * 0.5 * TILE_SIZE,
      (maxX - minX + 1) * TILE_SIZE * 0.5,
      (maxZ - minZ + 1) * TILE_SIZE * 0.5,
      0.17,
      'excavationCeiling',
    ));
  }
  let batchIndex = 0;
  for (const batch of batches.values()) {
    batchIndex += 1;
    const mesh = addInstancedTiles(parent, {
      name: `excavationCeilingBatch${batchIndex}`,
      tiles: batch.cells,
      material: materials.basalt,
      thickness: 0.34,
      yForTile: () => batch.ceilingElevation + 0.17,
    });
    mesh.userData.cameraOcclusionSurface = true;
    mesh.userData.cameraOcclusionOwner = true;
    mesh.userData.cameraOcclusionPerInstance = true;
    mesh.userData.occlusionOwnerId = `excavation-ceiling-batch-${batchIndex}`;
    mesh.userData.maximumBaySpan = 1;
    mesh.userData.collisionBacked = true;
  }
}

function addLevelEnclosure(
  parent,
  plan,
  materials,
  solidZones,
  aerialOnlyZones,
  omittedBoundaryWallKeys = new Set(),
) {
  const occupancyByBand = new Map();
  const tileByBandCell = new Map();
  const rampCellKeys = new Set(
    plan.floorTiles
      .filter((tile) => tile.surfaceRole === 'ramp')
      .map((tile) => cellKey(tile.x, tile.z)),
  );
  for (const tile of plan.floorTiles) {
    if (tile.surfaceRole === 'ramp') continue;
    // The lava river remains visible beneath a supported ramp, but it must not
    // generate cavern enclosure walls through the ramp's travel lane.
    if (tile.surface === 'deepMagma' && rampCellKeys.has(cellKey(tile.x, tile.z))) continue;
    const band = tile.surface === 'deepMagma'
      ? tile.ownerFloorElevation
      : (tile.structuralBaseElevation ?? tile.elevation);
    const bandKey = fixed(band);
    const occupancy = occupancyByBand.get(bandKey) ?? new Set();
    occupancy.add(cellKey(tile.x, tile.z));
    occupancyByBand.set(bandKey, occupancy);
    const key = `${bandKey}:${cellKey(tile.x, tile.z)}`;
    if (!tileByBandCell.has(key) || tile.surface !== 'deepMagma') tileByBandCell.set(key, tile);
  }
  const rampTilesByCell = new Map();
  for (const tile of plan.floorTiles.filter((candidate) => candidate.surfaceRole === 'ramp')) {
    const key = cellKey(tile.x, tile.z);
    const column = rampTilesByCell.get(key) ?? [];
    column.push(tile);
    rampTilesByCell.set(key, column);
  }
  const directions = [
    { side: 'east', dx: 1, dz: 0 },
    { side: 'west', dx: -1, dz: 0 },
    { side: 'south', dx: 0, dz: 1 },
    { side: 'north', dx: 0, dz: -1 },
  ];
  const portalBoundaryKeys = new Set();
  for (const socket of plan.sockets) {
    if (Math.abs(socket.facingZ) > 0) {
      const centerX = Math.round(socket.x);
      for (let x = centerX - 1; x <= centerX + 1; x += 1) {
        portalBoundaryKeys.add(`${fixed(socket.kind === 'environmental-spine' ? socket.elevation - LAVA_OFFSET : socket.elevation)}:${cellKey(x, socket.z)}:${socket.facingZ > 0 ? 'south' : 'north'}`);
      }
    }
  }
  const wallsByRun = new Map();
  for (const [bandKey, occupancy] of occupancyByBand) {
    const bandElevation = Number(bandKey);
    for (const key of occupancy) {
      const [x, z] = key.split(',').map(Number);
      const sourceTile = tileByBandCell.get(`${bandKey}:${key}`);
      const chamber = plan.chambers.find((candidate) => (
        candidate.elevation === bandElevation
          && x >= candidate.minX && x <= candidate.maxX
          && z >= candidate.minZ && z <= candidate.maxZ
      ));
      const headroom = chamber ? CHAMBER_HEADROOM : TUNNEL_HEADROOM;
      const floorY = sourceTile?.surface === 'deepMagma'
        ? sourceTile.elevation - 0.2
        : bandElevation - 0.2;
      for (const direction of directions) {
        const neighborKey = cellKey(x + direction.dx, z + direction.dz);
        if (occupancy.has(neighborKey)) continue;
        if (omittedBoundaryWallKeys.has(`${x},${z}:${direction.side}`)) continue;
        const opensIntoRamp = (rampTilesByCell.get(neighborKey) ?? []).some((ramp) => {
          const rampDirectionX = Math.sign(ramp.rampDirectionX ?? 0);
          const rampDirectionZ = Math.sign(ramp.rampDirectionZ ?? 0);
          const alignedWithRamp = Math.abs(
            direction.dx * rampDirectionX + direction.dz * rampDirectionZ,
          ) === 1;
          if (!alignedWithRamp) return false;
          const localX = -direction.dx * 0.5;
          const localZ = -direction.dz * 0.5;
          const axis = rampDirectionX !== 0
            ? localX * rampDirectionX
            : localZ * rampDirectionZ;
          const progress = THREE.MathUtils.clamp(axis + 0.5, 0, 1);
          const edgeElevation = THREE.MathUtils.lerp(
            ramp.rampStartElevation,
            ramp.rampEndElevation,
            progress,
          );
          const sourceWalkableElevation = sourceTile?.surface === 'deepMagma'
            ? sourceTile.ownerFloorElevation
            : (sourceTile?.elevation ?? bandElevation);
          return Math.abs(edgeElevation - sourceWalkableElevation)
            <= PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile + 0.05;
        });
        if (opensIntoRamp) continue;
        if (portalBoundaryKeys.has(`${bandKey}:${key}:${direction.side}`)) continue;
        const wall = {
          x: (x + direction.dx * 0.5) * TILE_SIZE,
          z: (z + direction.dz * 0.5) * TILE_SIZE,
          floorY,
          height: bandElevation + headroom - floorY,
        };
        const fixedAxis = direction.side === 'north' || direction.side === 'south' ? wall.z : wall.x;
        const runKey = `${bandKey}:${fixed(floorY)}:${fixed(wall.height)}:${direction.side}:${fixed(fixedAxis)}`;
        const bucket = wallsByRun.get(runKey) ?? { side: direction.side, walls: [] };
        bucket.walls.push(wall);
        wallsByRun.set(runKey, bucket);
      }
    }
  }
  let wallRunIndex = 0;
  const wallBatches = new Map();
  for (const bucket of wallsByRun.values()) {
    const alongX = bucket.side === 'north' || bucket.side === 'south';
    bucket.walls.sort((left, right) => (alongX ? left.x - right.x : left.z - right.z));
    let run = [];
    const flushRun = () => {
      if (run.length === 0) return;
      wallRunIndex += 1;
      addWallRunCollision(solidZones, `excavationWallRun${wallRunIndex}`, run, bucket.side);
      const batchKey = `${bucket.side}:${fixed(run[0].height)}`;
      const batch = wallBatches.get(batchKey) ?? { side: bucket.side, walls: [] };
      batch.walls.push(...run);
      wallBatches.set(batchKey, batch);
      run = [];
    };
    for (const wall of bucket.walls) {
      const previous = run.at(-1);
      const separation = previous
        ? Math.abs((alongX ? wall.x - previous.x : wall.z - previous.z) - TILE_SIZE)
        : 0;
      if (run.length > 0 && (run.length === 3 || separation > 0.01)) flushRun();
      run.push(wall);
    }
    flushRun();
  }
  let batchIndex = 0;
  for (const batch of wallBatches.values()) {
    batchIndex += 1;
    const alongX = batch.side === 'north' || batch.side === 'south';
    const height = batch.walls[0].height;
    const thickness = 0.34;
    const mesh = new THREE.InstancedMesh(
      createTiledBoxGeometry(
        alongX ? TILE_SIZE * 1.04 : thickness,
        height,
        alongX ? thickness : TILE_SIZE * 1.04,
      ),
      materials.basalt,
      batch.walls.length,
    );
    mesh.name = `excavationWallBatch${batchIndex}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.worldUvTiled = true;
    mesh.userData.cameraOcclusionSurface = true;
    mesh.userData.cameraOcclusionWall = true;
    mesh.userData.cameraOcclusionOwner = true;
    mesh.userData.cameraOcclusionPerInstance = true;
    mesh.userData.occlusionOwnerId = `excavation-wall-batch-${batchIndex}`;
    mesh.userData.maximumBaySpan = 1;
    mesh.userData.collisionBacked = true;
    const matrix = new THREE.Matrix4();
    batch.walls.forEach((wall, index) => {
      matrix.makeTranslation(wall.x, wall.floorY + wall.height * 0.5, wall.z);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
  }
  addCeilingRuns(parent, plan, materials, aerialOnlyZones);
}

function addRampAssemblies(parent, plan, materials, solidZones, aerialOnlyZones) {
  const routes = ['digger-descent-flight-a', 'digger-descent-flight-b'];
  const railHeight = 1.05;
  for (const routeId of routes) {
    const routeTiles = plan.floorTiles.filter((tile) => tile.rampRouteId === routeId);
    const bySegment = new Map();
    for (const tile of routeTiles) {
      const bucket = bySegment.get(tile.rampSegmentIndex) ?? [];
      bucket.push(tile);
      bySegment.set(tile.rampSegmentIndex, bucket);
    }
    const destinationY = routeId.endsWith('-a') ? MIDDLE_ELEVATION : LOWER_ELEVATION;
    const deckMatrices = [];
    const ceilingMatrices = [];
    const sideWallMatrices = [];
    const railMatrices = [];
    let slopeLength = TILE_SIZE;
    let pitch = 0;
    for (const [segmentIndex, segmentTiles] of bySegment) {
      const tile = segmentTiles[0];
      const minZ = Math.min(...segmentTiles.map((candidate) => candidate.z));
      const maxZ = Math.max(...segmentTiles.map((candidate) => candidate.z));
      const centerZ = (minZ + maxZ) * 0.5 * TILE_SIZE;
      const riseAcrossPositiveX = tile.rampStartElevation - tile.rampEndElevation;
      slopeLength = Math.hypot(TILE_SIZE, riseAcrossPositiveX);
      pitch = Math.atan2(riseAcrossPositiveX, TILE_SIZE);
      const floorY = (tile.rampStartElevation + tile.rampEndElevation) * 0.5;
      const slopeQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, pitch));
      deckMatrices.push(new THREE.Matrix4().compose(
        new THREE.Vector3(tile.x * TILE_SIZE, floorY - 0.14, centerZ),
        slopeQuaternion,
        new THREE.Vector3(1, 1, 1),
      ));
      ceilingMatrices.push(new THREE.Matrix4().compose(
        new THREE.Vector3(tile.x * TILE_SIZE, floorY + TUNNEL_HEADROOM + 0.15, centerZ),
        slopeQuaternion,
        new THREE.Vector3(1, 1, 1),
      ));
      aerialOnlyZones.push(createSolidZone(
        `${routeId}Ceiling${segmentIndex + 1}Collision`,
        tile.x * TILE_SIZE,
        floorY + TUNNEL_HEADROOM + 0.15,
        centerZ,
        TILE_SIZE * 0.55,
        RAMP_WIDTH_TILES * TILE_SIZE * 0.5 + 0.35,
        0.26,
        'excavationRampCeiling',
      ));

      for (const edgeZ of [minZ - 0.5, maxZ + 0.5]) {
        const z = edgeZ * TILE_SIZE;
        sideWallMatrices.push(new THREE.Matrix4().makeTranslation(
          tile.x * TILE_SIZE,
          floorY + TUNNEL_HEADROOM * 0.5,
          z,
        ));
        solidZones.push(createSolidZone(
          `${routeId}SideWall${segmentIndex + 1}_${edgeZ}Collision`,
          tile.x * TILE_SIZE,
          floorY + TUNNEL_HEADROOM * 0.5,
          z,
          TILE_SIZE * 0.52,
          0.16,
          TUNNEL_HEADROOM * 0.5,
          'excavationRampWall',
        ));

        const railZ = z - Math.sign(edgeZ) * 0.22;
        railMatrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3(tile.x * TILE_SIZE, floorY + railHeight, railZ),
          slopeQuaternion,
          new THREE.Vector3(1, 1, 1),
        ));
        solidZones.push(createSolidZone(
          `${routeId}Rail${segmentIndex + 1}_${edgeZ}Collision`,
          tile.x * TILE_SIZE,
          floorY + 0.58,
          railZ,
          TILE_SIZE * 0.52,
          0.08,
          0.58,
          'rampRailing',
        ));
      }

      if (segmentIndex % 3 === 0) {
        const supportTopY = Math.min(tile.rampStartElevation, tile.rampEndElevation) - 0.28;
        const supportBaseY = destinationY - 0.45;
        if (supportTopY > supportBaseY + 0.2) {
          for (const z of [(minZ - 0.15) * TILE_SIZE, (maxZ + 0.15) * TILE_SIZE]) {
            const support = addBox(parent, {
              name: `${routeId}Support${segmentIndex + 1}_${z}`,
              width: 0.34,
              height: supportTopY - supportBaseY,
              depth: 0.34,
              x: tile.x * TILE_SIZE,
              y: (supportTopY + supportBaseY) * 0.5,
              z,
              material: materials.blackMetal,
            });
            support.userData.structuralSupport = true;
            support.userData.supportBaseY = supportBaseY;
            support.userData.supportTopY = supportTopY;
            support.userData.collisionBacked = true;
            solidZones.push(createSolidZone(
              `${support.name}Collision`,
              support.position.x,
              support.position.y,
              support.position.z,
              0.17,
              0.17,
              (supportTopY - supportBaseY) * 0.5,
              'diggerRampSupport',
            ));
          }
        }
      }
    }
    for (const mesh of [
      addInstancedMatrices(parent, {
        name: `${routeId}DeckSegments`,
        geometry: createTiledBoxGeometry(slopeLength * 1.006, 0.28, RAMP_WIDTH_TILES * TILE_SIZE),
        material: materials.serviceGrate,
        matrices: deckMatrices,
        userData: {
          structuralDeck: true,
          architectureRole: 'raised-critical-catwalk-ramp',
          criticalCatwalkRouteId: 'linear-excavation-critical-route',
          rampRouteId: routeId,
          catwalkRiseMeters: CRITICAL_CATWALK_RISE,
          collisionBacked: true,
        },
      }),
      addInstancedMatrices(parent, {
        name: `${routeId}CeilingSegments`,
        geometry: createTiledBoxGeometry(slopeLength * 1.01, 0.3, RAMP_WIDTH_TILES * TILE_SIZE + 0.7),
        material: materials.basalt,
        matrices: ceilingMatrices,
        userData: { collisionBacked: true },
      }),
      addInstancedMatrices(parent, {
        name: `${routeId}SideWallSegments`,
        geometry: createTiledBoxGeometry(TILE_SIZE * 1.02, TUNNEL_HEADROOM, 0.28),
        material: materials.basalt,
        matrices: sideWallMatrices,
        userData: { collisionBacked: true },
      }),
      addInstancedMatrices(parent, {
        name: `${routeId}RailSegments`,
        geometry: createTiledBoxGeometry(slopeLength, 0.1, 0.1),
        material: materials.rails,
        matrices: railMatrices,
        userData: { playerRailing: true, collisionBacked: true },
      }),
    ]) {
      mesh.userData.cameraOcclusionSurface = true;
      mesh.userData.cameraOcclusionWall = mesh.name.includes('SideWall');
      mesh.userData.cameraOcclusionOwner = true;
      mesh.userData.cameraOcclusionPerInstance = true;
      mesh.userData.occlusionOwnerId = `${mesh.name}-instances`;
      mesh.userData.maximumBaySpan = 1;
    }
  }
}

function addCriticalCatwalkAccessRamps(parent, plan, materials, solidZones, aerialOnlyZones) {
  const routeIds = ['critical-catwalk-entry-rise', 'critical-catwalk-assay-descent'];
  const railHeight = 1.05;
  const deckMatrices = [];
  const ceilingMatrices = [];
  const railMatrices = [];
  const postMatrices = [];
  let slopeLength = TILE_SIZE;
  for (const routeId of routeIds) {
    const routeTiles = plan.floorTiles.filter((tile) => tile.rampRouteId === routeId);
    const bySegment = new Map();
    for (const tile of routeTiles) {
      const bucket = bySegment.get(tile.rampSegmentIndex) ?? [];
      bucket.push(tile);
      bySegment.set(tile.rampSegmentIndex, bucket);
    }
    for (const [segmentIndex, segmentTiles] of bySegment) {
      const tile = segmentTiles[0];
      const minX = Math.min(...segmentTiles.map((candidate) => candidate.x));
      const maxX = Math.max(...segmentTiles.map((candidate) => candidate.x));
      const centerX = (minX + maxX) * 0.5 * TILE_SIZE;
      const width = (maxX - minX + 1) * TILE_SIZE;
      const rise = tile.rampEndElevation - tile.rampStartElevation;
      slopeLength = Math.hypot(TILE_SIZE, rise);
      const angle = Math.atan2(rise, TILE_SIZE);
      const floorY = (tile.rampStartElevation + tile.rampEndElevation) * 0.5;
      const slopeQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        -Math.sign(tile.rampDirectionZ) * angle,
        0,
        0,
      ));
      deckMatrices.push(new THREE.Matrix4().compose(
        new THREE.Vector3(centerX, floorY - 0.14, tile.z * TILE_SIZE),
        slopeQuaternion,
        new THREE.Vector3(1, 1, 1),
      ));

      const ceilingY = (tile.structuralBaseElevation ?? floorY) + TUNNEL_HEADROOM + 0.15;
      ceilingMatrices.push(new THREE.Matrix4().makeTranslation(
        centerX,
        ceilingY,
        tile.z * TILE_SIZE,
      ));
      aerialOnlyZones.push(createSolidZone(
        `${routeId}Ceiling${segmentIndex + 1}Collision`, centerX, ceilingY, tile.z * TILE_SIZE,
        width * 0.5 + 0.35, TILE_SIZE * 0.51, 0.15, 'excavationCeiling',
      ));

      for (const edgeX of [minX - 0.5, maxX + 0.5]) {
        const x = edgeX * TILE_SIZE;
        railMatrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3(x, floorY + railHeight, tile.z * TILE_SIZE),
          slopeQuaternion,
          new THREE.Vector3(1, 1, 1),
        ));
        solidZones.push(createSolidZone(
          `${routeId}Rail${segmentIndex + 1}_${edgeX}Collision`, x, floorY + 0.58, tile.z * TILE_SIZE,
          0.08, slopeLength * 0.51, 0.58, 'criticalCatwalkRailing',
        ));
        for (const zOffset of [-TILE_SIZE * 0.42, TILE_SIZE * 0.42]) {
          postMatrices.push(new THREE.Matrix4().makeTranslation(
            x,
            floorY + railHeight * 0.5,
            tile.z * TILE_SIZE + zOffset,
          ));
        }
      }
    }
  }

  const commonUserData = {
    criticalCatwalkRouteId: 'linear-excavation-critical-route',
    catwalkRiseMeters: CRITICAL_CATWALK_RISE,
    collisionBacked: true,
  };
  const deck = addInstancedMatrices(parent, {
    name: 'criticalCatwalkAccessRampDecks',
    geometry: createTiledBoxGeometry(RAMP_WIDTH_TILES * TILE_SIZE, 0.28, slopeLength * 1.006),
    material: materials.serviceGrate,
    matrices: deckMatrices,
    userData: {
      ...commonUserData,
      structuralDeck: true,
      architectureRole: 'raised-critical-catwalk-access-ramp',
    },
  });
  const ceiling = addInstancedMatrices(parent, {
    name: 'criticalCatwalkAccessRampCeilings',
    geometry: createTiledBoxGeometry(RAMP_WIDTH_TILES * TILE_SIZE + 0.7, 0.3, TILE_SIZE * 1.01),
    material: materials.basalt,
    matrices: ceilingMatrices,
    userData: commonUserData,
  });
  addInstancedMatrices(parent, {
    name: 'criticalCatwalkAccessRampRails',
    geometry: createTiledBoxGeometry(0.1, 0.1, slopeLength),
    material: materials.rails,
    matrices: railMatrices,
    userData: { ...commonUserData, playerRailing: true },
  });
  addInstancedMatrices(parent, {
    name: 'criticalCatwalkAccessRampRailPosts',
    geometry: createTiledBoxGeometry(0.1, railHeight, 0.1),
    material: materials.rails,
    matrices: postMatrices,
    userData: { ...commonUserData, playerRailing: true },
  });
  for (const mesh of [deck, ceiling]) {
    mesh.userData.cameraOcclusionSurface = true;
    mesh.userData.cameraOcclusionOwner = true;
    mesh.userData.cameraOcclusionPerInstance = true;
    mesh.userData.occlusionOwnerId = `${mesh.name}-instances`;
    mesh.userData.maximumBaySpan = 1;
  }
}

function addBridgeRailings(parent, plan, materials, solidZones) {
  const lavaColumns = new Set(
    plan.floorTiles.filter((tile) => tile.surface === 'deepMagma').map((tile) => cellKey(tile.x, tile.z)),
  );
  for (const bridge of plan.bridgeRegions) {
    const bridgeLavaXs = [];
    for (let x = bridge.minX; x <= bridge.maxX; x += 1) {
      if ([...Array(bridge.maxZ - bridge.minZ + 1)].some((_, index) => (
        lavaColumns.has(cellKey(x, bridge.minZ + index))
      ))) bridgeLavaXs.push(x);
    }
    if (bridgeLavaXs.length === 0) continue;
    const minX = Math.min(...bridgeLavaXs) - 0.5;
    const maxX = Math.max(...bridgeLavaXs) + 0.5;
    const length = (maxX - minX) * TILE_SIZE;
    const centerX = (minX + maxX) * 0.5 * TILE_SIZE;
    const lavaSurfaceY = bridge.elevation + LAVA_OFFSET;
    const supportTopY = bridge.elevation - 0.28;
    const supportBaseY = lavaSurfaceY - 0.5;
    for (const supportX of [minX * TILE_SIZE + 0.28, maxX * TILE_SIZE - 0.28]) {
      for (const supportZ of [(bridge.minZ + 0.15) * TILE_SIZE, (bridge.maxZ - 0.15) * TILE_SIZE]) {
        const support = addBox(parent, {
          name: `${bridge.id}Support_${supportX}_${supportZ}`,
          width: 0.3,
          height: supportTopY - supportBaseY,
          depth: 0.3,
          x: supportX,
          y: (supportTopY + supportBaseY) * 0.5,
          z: supportZ,
          material: materials.blackMetal,
        });
        support.userData.structuralSupport = true;
        support.userData.supportBaseY = supportBaseY;
        support.userData.supportTopY = supportTopY;
        support.userData.collisionBacked = true;
        solidZones.push(createSolidZone(
          `${support.name}Collision`, supportX, support.position.y, supportZ,
          0.15, 0.15, (supportTopY - supportBaseY) * 0.5, 'bridgeSupport',
        ));
      }
    }
    for (const edgeZ of [bridge.minZ - 0.5, bridge.maxZ + 0.5]) {
      const rail = addBox(parent, {
        name: `${bridge.id}Rail${edgeZ}`,
        width: length,
        height: 0.1,
        depth: 0.1,
        x: centerX,
        y: bridge.elevation + 1.05,
        z: edgeZ * TILE_SIZE,
        material: materials.rails,
      });
      rail.userData.playerRailing = true;
      solidZones.push(createSolidZone(
        `${rail.name}Collision`,
        rail.position.x,
        bridge.elevation + 0.58,
        rail.position.z,
        length * 0.5,
        0.08,
        0.58,
        'bridgeRailing',
      ));
      const posts = Math.max(2, bridgeLavaXs.length + 1);
      for (let index = 0; index < posts; index += 1) {
        addBox(parent, {
          name: `${bridge.id}Post${edgeZ}_${index}`,
          width: 0.1,
          height: 1.05,
          depth: 0.1,
          x: minX * TILE_SIZE + (length * index) / (posts - 1),
          y: bridge.elevation + 0.525,
          z: edgeZ * TILE_SIZE,
          material: materials.rails,
        });
      }
    }
  }
}

function addCriticalCatwalkGuideRails(parent, plan, materials, solidZones) {
  const railHeight = 1.05;
  const railThickness = 0.1;
  const postMatrices = [];
  for (const run of plan.criticalCatwalkRailRuns) {
    const alongX = run.orientation === 'x';
    const length = run.lengthTiles * TILE_SIZE;
    const sideOffset = run.widthTiles * TILE_SIZE * 0.5;
    const railMatrices = [];
    for (const side of [-1, 1]) {
      const railX = (run.centerX * TILE_SIZE) + (alongX ? 0 : side * sideOffset);
      const railZ = (run.centerZ * TILE_SIZE) + (alongX ? side * sideOffset : 0);
      railMatrices.push(new THREE.Matrix4().makeTranslation(
        railX,
        run.elevation + railHeight,
        railZ,
      ));
      solidZones.push(createSolidZone(
        `${run.id}Rail${side}Collision`,
        railX,
        run.elevation + 0.58,
        railZ,
        (alongX ? length : railThickness) * 0.5,
        (alongX ? railThickness : length) * 0.5,
        0.58,
        'criticalCatwalkRailing',
      ));

      const postCount = Math.max(2, Math.ceil(run.lengthTiles / 2) + 1);
      for (let index = 0; index < postCount; index += 1) {
        const axisOffset = -length * 0.5 + (length * index) / (postCount - 1);
        postMatrices.push(new THREE.Matrix4().makeTranslation(
          railX + (alongX ? axisOffset : 0),
          run.elevation + railHeight * 0.5,
          railZ + (alongX ? 0 : axisOffset),
        ));
      }
    }
    addInstancedMatrices(parent, {
      name: `${run.id}Rails`,
      geometry: createTiledBoxGeometry(
        alongX ? length : railThickness,
        railThickness,
        alongX ? railThickness : length,
      ),
      material: materials.rails,
      matrices: railMatrices,
      userData: {
        playerRailing: true,
        criticalCatwalkRouteId: 'linear-excavation-critical-route',
        collisionBacked: true,
      },
    });
  }
  addInstancedMatrices(parent, {
    name: 'criticalCatwalkGuideRailPosts',
    geometry: createTiledBoxGeometry(railThickness, railHeight, railThickness),
    material: materials.rails,
    matrices: postMatrices,
    userData: {
      playerRailing: true,
      criticalCatwalkRouteId: 'linear-excavation-critical-route',
      collisionBacked: true,
    },
  });
}

function addLava(parent, plan, materials, traps) {
  const lavaTiles = plan.floorTiles.filter((tile) => tile.surface === 'deepMagma');
  addInstancedTiles(parent, {
    name: 'linearExcavationLavaTiles',
    tiles: lavaTiles,
    material: materials.magma,
    thickness: 0.18,
    yForTile: (tile) => tile.elevation - 0.09,
    metersPerRepeat: 1.4,
  });
  for (const tile of lavaTiles) {
    traps.push({
      id: `linearExcavationMagma_${tile.x}_${tile.z}`,
      label: 'Deep magma',
      active: true,
      interactive: false,
      position: new THREE.Vector3(tile.x * TILE_SIZE, tile.elevation, tile.z * TILE_SIZE),
      halfWidth: TILE_SIZE * 0.51,
      halfDepth: TILE_SIZE * 0.51,
      verticalHalfHeight: 0.85,
      damagePerSecond: 24,
      movementMultiplier: 0.55,
      heatResistantMovementMultiplier: 0.8,
      hazardImmunityDamageMultiplier: 0.4,
      damagePerPulse: 0,
      pulseInterval: 0.5,
      activeDuration: 0.5,
      telegraphDuration: 0.08,
      ambientHazardTags: ['environmentalHeat', 'fireFloor'],
      navigationPathCost: 18,
    });
  }

  // Continuous textured cascade sheets connect the three signed lava tiers.
  for (const [index, cascade] of [
    { z: -3.5, fromY: UPPER_ELEVATION + LAVA_OFFSET, toY: MIDDLE_ELEVATION + LAVA_OFFSET, x: 4.5 },
    { z: -11.5, fromY: MIDDLE_ELEVATION + LAVA_OFFSET, toY: LOWER_ELEVATION + LAVA_OFFSET, x: 3.5 },
  ].entries()) {
    const height = cascade.fromY - cascade.toY;
    const sheet = addBox(parent, {
      name: `linearExcavationLavaCascade${index + 1}`,
      width: 4.2,
      height,
      depth: 0.22,
      x: cascade.x * TILE_SIZE,
      y: (cascade.fromY + cascade.toY) * 0.5,
      z: cascade.z * TILE_SIZE,
      material: materials.magma,
      metersPerRepeat: 1.4,
    });
    sheet.userData.environmentalSpine = LAVA_CONTINUITY_TAG;
  }
}

function addBraceFrame(parent, materials, solidZones, brace) {
  const owner = new THREE.Group();
  owner.name = `${brace.id}OcclusionOwner`;
  owner.userData.cameraOcclusionOwner = true;
  owner.userData.occlusionOwnerId = `${brace.id}-frame`;
  owner.userData.maximumBaySpan = 3;
  parent.add(owner);
  const width = 8.4;
  const height = 5.4;
  const postSize = 0.28;
  const alongX = brace.alongX;
  const centerX = brace.x * TILE_SIZE;
  const centerZ = brace.z * TILE_SIZE;
  const material = brace.ancient ? materials.ceramic : materials.blackMetal;
  for (const side of [-1, 1]) {
    const x = centerX + (alongX ? side * (width * 0.5 + postSize * 0.5) : 0);
    const z = centerZ + (alongX ? 0 : side * (width * 0.5 + postSize * 0.5));
    const post = addBox(owner, {
      name: `${brace.id}Post${side}`,
      width: postSize,
      height,
      depth: postSize,
      x,
      y: brace.elevation + height * 0.5,
      z,
      material,
    });
    post.userData.structuralSupport = true;
    post.userData.cameraOcclusionSurface = true;
    post.userData.supportBaseY = brace.elevation;
    post.userData.supportTopY = brace.elevation + height;
    solidZones.push(createSolidZone(
      `${post.name}Collision`, x, brace.elevation + height * 0.5, z,
      postSize * 0.5, postSize * 0.5, height * 0.5, 'diggerBrace',
    ));
  }
  const header = addBox(owner, {
    name: `${brace.id}Header`,
    width: alongX ? width + postSize * 2 : postSize,
    height: postSize,
    depth: alongX ? postSize : width + postSize * 2,
    x: centerX,
    y: brace.elevation + height,
    z: centerZ,
    material,
  });
  header.userData.cameraOcclusionSurface = true;
  header.userData.collisionBacked = true;
  solidZones.push(createSolidZone(
    `${header.name}Collision`, centerX, header.position.y, centerZ,
    (alongX ? width + postSize * 2 : postSize) * 0.5,
    (alongX ? postSize : width + postSize * 2) * 0.5,
    postSize * 0.5,
    'diggerBraceHeader',
  ));
  const lamp = addBox(owner, {
    name: `${brace.id}WorkLamp`,
    width: 0.48,
    height: 0.24,
    depth: 0.24,
    x: centerX,
    y: brace.elevation + height - 0.38,
    z: centerZ,
    material: materials.lamp,
  });
  lamp.userData.diggerExcavationEvidence = true;
  const light = new THREE.PointLight(0xff9a48, brace.ancient ? 0.8 : 1.35, 19, 1.7);
  light.name = `${brace.id}WorkLight`;
  light.position.copy(lamp.position);
  light.castShadow = false;
  owner.add(light);
}

function addCavernFormations(parent, materials, solidZones, formations) {
  for (const kind of ['stalagmite', 'stalactite']) {
    const matching = formations.filter((formation) => formation.kind === kind);
    if (matching.length === 0) continue;
    const sample = matching[0];
    const stalactite = kind === 'stalactite';
    const geometry = applyWorldTiledUVs(new THREE.CylinderGeometry(
      stalactite ? sample.radius : 0.06,
      stalactite ? 0.06 : sample.radius,
      sample.height,
      7,
      1,
      false,
    ), TILE_SIZE);
    const matrices = matching.map((formation) => {
      const y = stalactite
        ? formation.ceilingY - formation.height * 0.5
        : formation.elevation + formation.height * 0.5;
      solidZones.push(createSolidZone(
        `${formation.id}Collision`, formation.x, y, formation.z,
        formation.radius * 0.78, formation.radius * 0.78, formation.height * 0.5,
        formation.kind,
      ));
      return new THREE.Matrix4().compose(
        new THREE.Vector3(formation.x, y, formation.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), formation.yaw),
        new THREE.Vector3(1, 1, 1),
      );
    });
    addInstancedMatrices(parent, {
      name: `linearExcavation${stalactite ? 'Stalactites' : 'Stalagmites'}`,
      geometry,
      material: materials.basalt,
      matrices,
      userData: {
        proceduralShape: kind,
        cavernFormation: true,
        collisionBacked: true,
        instanceSemanticIds: matching.map((formation) => formation.id),
      },
    });
  }
}

function addExcavationBoulders(parent, materials, solidZones, boulders) {
  if (boulders.length === 0) return;
  const radius = boulders[0].radius;
  const matrices = boulders.map((boulder) => {
    const y = boulder.elevation + radius * 0.72;
    solidZones.push(createSolidZone(
      `${boulder.id}Collision`, boulder.x, y, boulder.z,
      radius * 0.82, radius * 0.72, radius * 0.72, 'excavationBoulder',
    ));
    return new THREE.Matrix4().compose(
      new THREE.Vector3(boulder.x, y, boulder.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.16, boulder.yaw, -0.11)),
      new THREE.Vector3(1, 1, 1),
    );
  });
  addInstancedMatrices(parent, {
    name: 'linearExcavationBoulders',
    geometry: applyWorldTiledUVs(new THREE.DodecahedronGeometry(radius, 0), TILE_SIZE),
    material: materials.ashStone,
    matrices,
    userData: {
      proceduralShape: 'excavated-boulder',
      diggerExcavationEvidence: true,
      collisionBacked: true,
      instanceSemanticIds: boulders.map((boulder) => boulder.id),
    },
  });
}

function createVehiclePartMatrix(vehicle, x, y, z, rotation = null) {
  const owner = new THREE.Matrix4().compose(
    new THREE.Vector3(vehicle.x, vehicle.elevation, vehicle.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), vehicle.yaw),
    new THREE.Vector3(1, 1, 1),
  );
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    rotation ?? new THREE.Quaternion(),
    new THREE.Vector3(1, 1, 1),
  );
  return owner.multiply(local);
}

function addWorkVehicles(parent, materials, solidZones, vehicles) {
  const minecarts = vehicles.filter((vehicle) => vehicle.kind === 'minecart');
  const trolleys = vehicles.filter((vehicle) => vehicle.kind === 'trolley');
  const commonData = {
    diggerExcavationEvidence: true,
    collisionBacked: true,
  };
  addInstancedMatrices(parent, {
    name: 'linearExcavationMinecartChassis',
    geometry: createTiledBoxGeometry(2.15, 0.24, 1.22),
    material: materials.blackMetal,
    matrices: minecarts.map((vehicle) => createVehiclePartMatrix(vehicle, 0, 0.48, 0)),
    userData: { ...commonData, workVehicleKind: 'minecart' },
  });
  addInstancedMatrices(parent, {
    name: 'linearExcavationMinecartOreTubs',
    geometry: createTiledBoxGeometry(1.9, 0.72, 1.12),
    material: materials.rails,
    matrices: minecarts.map((vehicle) => createVehiclePartMatrix(vehicle, 0, 0.92, 0)),
    userData: { ...commonData, workVehicleKind: 'minecart' },
  });
  addInstancedMatrices(parent, {
    name: 'linearExcavationTrolleyFlatbeds',
    geometry: createTiledBoxGeometry(1.8, 0.2, 1.08),
    material: materials.serviceGrate,
    matrices: trolleys.map((vehicle) => createVehiclePartMatrix(vehicle, 0, 0.58, 0)),
    userData: { ...commonData, workVehicleKind: 'trolley' },
  });
  addInstancedMatrices(parent, {
    name: 'linearExcavationTrolleyToolCrates',
    geometry: createTiledBoxGeometry(0.82, 0.58, 0.72),
    material: materials.bronze,
    matrices: trolleys.map((vehicle) => createVehiclePartMatrix(vehicle, -0.3, 0.96, 0)),
    userData: { ...commonData, workVehicleKind: 'trolley' },
  });
  addInstancedMatrices(parent, {
    name: 'linearExcavationTrolleyHandles',
    geometry: applyWorldTiledUVs(new THREE.TorusGeometry(0.54, 0.06, 6, 12, Math.PI), TILE_SIZE),
    material: materials.rails,
    matrices: trolleys.map((vehicle) => createVehiclePartMatrix(
      vehicle,
      0.84,
      1.15,
      0,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
    )),
    userData: { ...commonData, workVehicleKind: 'trolley' },
  });
  const wheelRotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    Math.PI / 2,
  );
  const wheelMatrices = [];
  for (const vehicle of minecarts) {
    for (const x of [-0.72, 0.72]) {
      for (const z of [-0.68, 0.68]) {
        wheelMatrices.push(createVehiclePartMatrix(vehicle, x, 0.3, z, wheelRotation));
      }
    }
  }
  for (const vehicle of trolleys) {
    for (const x of [-0.62, 0.62]) {
      for (const z of [-0.58, 0.58]) {
        wheelMatrices.push(createVehiclePartMatrix(vehicle, x, 0.34, z, wheelRotation));
      }
    }
  }
  addInstancedMatrices(parent, {
    name: 'linearExcavationWorkVehicleWheels',
    geometry: applyWorldTiledUVs(new THREE.CylinderGeometry(0.28, 0.28, 0.16, 12), TILE_SIZE),
    material: materials.blackMetal,
    matrices: wheelMatrices,
    userData: { ...commonData, workVehicleKind: 'shared-wheels' },
  });

  for (const vehicle of vehicles) {
    const minecart = vehicle.kind === 'minecart';
    solidZones.push(Object.assign(createSolidZone(
      `${vehicle.id}Collision`, vehicle.x,
      vehicle.elevation + (minecart ? 0.76 : 0.84), vehicle.z,
      minecart ? 1.08 : 0.96, minecart ? 0.68 : 0.62,
      minecart ? 0.76 : 0.84,
      minecart ? 'diggerMinecart' : 'diggerToolTrolley',
    ), { rotationY: vehicle.yaw }));
  }
}

function addWallPickaxes(parent, materials, pickaxes) {
  const handleMatrices = [];
  const headMatrices = [];
  for (const pickaxe of pickaxes) {
    const ownerMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(pickaxe.x, pickaxe.elevation + 1.5, pickaxe.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pickaxe.roll),
      new THREE.Vector3(1, 1, 1),
    );
    handleMatrices.push(ownerMatrix.clone());
    headMatrices.push(ownerMatrix.clone().multiply(
      new THREE.Matrix4().makeTranslation(0, 0.74, 0),
    ));
  }
  const commonData = {
    diggerExcavationEvidence: true,
    decorativeOutsidePlayerVolume: true,
    instanceSemanticIds: pickaxes.map((pickaxe) => pickaxe.id),
  };
  addInstancedMatrices(parent, {
    name: 'linearExcavationPickaxeHandles',
    geometry: createTiledBoxGeometry(0.1, 1.65, 0.1),
    material: materials.bronze,
    matrices: handleMatrices,
    userData: commonData,
  });
  addInstancedMatrices(parent, {
    name: 'linearExcavationPickaxeHeads',
    geometry: createTiledBoxGeometry(0.13, 0.13, 0.92),
    material: materials.blackMetal,
    matrices: headMatrices,
    userData: commonData,
  });
}

function addExcavationWorkClutter(parent, plan, materials, solidZones) {
  addCavernFormations(parent, materials, solidZones, plan.dressing.cavernFormations);
  addExcavationBoulders(parent, materials, solidZones, plan.dressing.boulders);
  addWorkVehicles(parent, materials, solidZones, plan.dressing.workVehicles);
  addWallPickaxes(parent, materials, plan.dressing.pickaxes);
}

function addDiggerMachinery(parent, plan, materials, solidZones) {
  const turntableOwner = new THREE.Group();
  turntableOwner.name = 'splitBoreDrillOcclusionOwner';
  turntableOwner.userData.cameraOcclusionOwner = true;
  turntableOwner.userData.occlusionOwnerId = 'split-bore-drill-turntable';
  turntableOwner.userData.maximumBaySpan = 2;
  parent.add(turntableOwner);
  // Keep the failed drill as the junction landmark, but park it in the east
  // work bay so the three-wide critical catwalk can turn west unobstructed.
  const turntableX = 3 * TILE_SIZE;
  const turntableZ = 7 * TILE_SIZE;
  const turntable = addCylinder(turntableOwner, {
    name: 'splitBoreDrillTurntable',
    radius: 2.15,
    height: 0.44,
    x: turntableX,
    y: 0.22,
    z: turntableZ,
    material: materials.blackMetal,
    radialSegments: 24,
  });
  turntable.userData.cameraOcclusionSurface = true;
  const mast = addCylinder(turntableOwner, {
    name: 'splitBoreBrokenDrillMast',
    radius: 0.42,
    height: 3.7,
    x: turntableX,
    y: 2.05,
    z: turntableZ,
    material: materials.rails,
    radialSegments: 12,
  });
  mast.userData.cameraOcclusionSurface = true;
  const bit = addCylinder(turntableOwner, {
    name: 'splitBoreAbandonedDrillBit',
    radiusTop: 0.12,
    radiusBottom: 0.68,
    height: 2.6,
    x: turntableX + 1.15,
    y: 1.18,
    z: turntableZ,
    material: materials.blackMetal,
    radialSegments: 12,
    pitch: Math.PI / 2,
  });
  bit.userData.diggerExcavationEvidence = true;
  bit.userData.cameraOcclusionSurface = true;
  solidZones.push(createSolidZone(
    'splitBoreTurntableCollision', turntableX, 1.85, turntableZ,
    2.15, 2.15, 1.85, 'diggerDrillTurntable',
  ));

  for (const brace of plan.dressing.braces) addBraceFrame(parent, materials, solidZones, brace);

  for (const rubble of plan.dressing.rubble) {
    const column = addCylinder(parent, {
      name: rubble.id,
      radius: rubble.radius,
      height: rubble.height,
      x: rubble.x,
      y: rubble.elevation + rubble.height * 0.5,
      z: rubble.z,
      material: materials.ashStone,
      radialSegments: 6,
      thetaStart: Math.PI / 6,
      yaw: rubble.yaw,
    });
    column.userData.proceduralShape = 'hexagonal-basalt-column';
    column.userData.radialSegments = 6;
    column.userData.diggerExcavationEvidence = true;
    solidZones.push(createSolidZone(
      `${rubble.id}Collision`, rubble.x, rubble.elevation + rubble.height * 0.5, rubble.z,
      rubble.radius * 0.88, rubble.radius * 0.88, rubble.height * 0.5, 'hexBasaltSpoil',
    ));
  }

  for (const mark of plan.dressing.surveyMarks) {
    const marker = addBox(parent, {
      name: mark.id,
      width: 0.12,
      height: 0.025,
      depth: 1.45,
      x: mark.x * TILE_SIZE,
      y: mark.elevation + 0.018,
      z: mark.z * TILE_SIZE,
      material: materials.surveyPaint,
      castShadow: false,
    });
    marker.userData.diggerExcavationEvidence = true;
  }

  // Supported inspection deck in Deep Confluence. It remains flush with the
  // safe floor so it cannot create an unregistered support layer.
  const inspectionDeck = addBox(parent, {
    name: 'deepConfluenceInspectionDeck',
    width: 8.4,
    height: 0.24,
    depth: 8.4,
    x: 16 * TILE_SIZE,
    y: MIDDLE_ELEVATION + 0.12,
    z: -9 * TILE_SIZE,
    material: materials.serviceGrate,
  });
  inspectionDeck.userData.collisionBacked = true;
  for (const x of [13.2, 18.8]) {
    for (const z of [-11.8, -6.2]) {
      const height = 1.15;
      const support = addBox(parent, {
        name: `deepConfluenceDeckSupport_${x}_${z}`,
        width: 0.32,
        height,
        depth: 0.32,
        x: x * TILE_SIZE,
        y: MIDDLE_ELEVATION - height * 0.5,
        z: z * TILE_SIZE,
        material: materials.blackMetal,
      });
      support.userData.structuralSupport = true;
      support.userData.supportBaseY = MIDDLE_ELEVATION - height;
      support.userData.supportTopY = MIDDLE_ELEVATION;
      support.userData.collisionBacked = true;
      solidZones.push(createSolidZone(
        `${support.name}Collision`, support.position.x, support.position.y, support.position.z,
        0.16, 0.16, height * 0.5, 'inspectionDeckSupport',
      ));
    }
  }
}

function addSocketFrame(parent, materials, solidZones, frame, ancient = false) {
  const owner = new THREE.Group();
  owner.name = `${frame.id}OcclusionOwner`;
  owner.userData.cameraOcclusionOwner = true;
  owner.userData.occlusionOwnerId = `${frame.id}-socket-frame`;
  owner.userData.maximumBaySpan = 3;
  parent.add(owner);
  const material = ancient ? materials.ceramic : materials.blackMetal;
  const columnWidth = 0.56;
  const lintelHeight = 0.56;
  const x = frame.x * TILE_SIZE;
  const z = frame.z * TILE_SIZE;
  const alongX = Math.abs(frame.facingZ) > 0;
  for (const side of [-1, 1]) {
    const offset = frame.openingWidthMeters * 0.5 + columnWidth * 0.5;
    const px = x + (alongX ? side * offset : 0);
    const pz = z + (alongX ? 0 : side * offset);
    const post = addBox(owner, {
      name: `${frame.id}Column${side}`,
      width: columnWidth,
      height: frame.openingHeightMeters,
      depth: columnWidth,
      x: px,
      y: frame.elevation + frame.openingHeightMeters * 0.5,
      z: pz,
      material,
    });
    post.userData.socketFrameId = frame.id;
    post.userData.cameraOcclusionSurface = true;
    solidZones.push(createSolidZone(
      `${post.name}Collision`, px, post.position.y, pz,
      columnWidth * 0.5, columnWidth * 0.5, frame.openingHeightMeters * 0.5, 'socketFrame',
    ));
  }
  const lintel = addBox(owner, {
    name: `${frame.id}Lintel`,
    width: alongX ? frame.openingWidthMeters + columnWidth * 2 : columnWidth,
    height: lintelHeight,
    depth: alongX ? columnWidth : frame.openingWidthMeters + columnWidth * 2,
    x,
    y: frame.elevation + frame.openingHeightMeters + lintelHeight * 0.5,
    z,
    material,
  });
  lintel.userData.socketFrameId = frame.id;
  lintel.userData.socketAligned = true;
  lintel.userData.cameraOcclusionSurface = true;
  lintel.userData.collisionBacked = true;
  solidZones.push(createSolidZone(
    `${lintel.name}Collision`, x, lintel.position.y, z,
    (alongX ? frame.openingWidthMeters + columnWidth * 2 : columnWidth) * 0.5,
    (alongX ? columnWidth : frame.openingWidthMeters + columnWidth * 2) * 0.5,
    lintelHeight * 0.5,
    'socketFrameLintel',
  ));
}

function createTreasureChest(parent, materials, reward) {
  const object = new THREE.Group();
  object.name = reward.chestId;
  object.position.set(reward.position.x, reward.position.y, reward.position.z);
  const base = addBox(object, {
    name: 'ruinChestBase',
    width: 1.42,
    height: 0.66,
    depth: 1.02,
    x: 0,
    y: 0.33,
    z: 0,
    material: materials.blackMetal,
  });
  const lid = addBox(object, {
    name: 'ruinChestLid',
    width: 1.46,
    height: 0.28,
    depth: 1.06,
    x: 0,
    y: 0.72,
    z: 0,
    material: materials.bronze,
  });
  const trim = addBox(object, {
    name: 'ruinChestTrim',
    width: 1.52,
    height: 0.1,
    depth: 1.12,
    x: 0,
    y: 0.58,
    z: 0,
    material: materials.rails,
  });
  const lock = addBox(object, {
    name: 'ruinChestLock',
    width: 0.24,
    height: 0.32,
    depth: 0.12,
    x: 0,
    y: 0.54,
    z: -0.55,
    material: materials.lamp,
  });
  const glowMaterial = materials.lamp.clone();
  glowMaterial.name = `${reward.chestId}GlowMaterial`;
  glowMaterial.transparent = true;
  glowMaterial.opacity = 0.18;
  const glow = addBox(object, {
    name: 'ruinChestGlow',
    width: 1.18,
    height: 0.035,
    depth: 0.78,
    x: 0,
    y: 0.69,
    z: 0,
    material: glowMaterial,
    castShadow: false,
  });
  base.userData.collisionBacked = true;
  lid.userData.openable = true;
  trim.userData.rewardTrim = true;
  lock.userData.uniqueRewardLock = OLD_DRILL_ITEM_ID;
  object.userData.rewardPartId = reward.itemId ?? null;
  parent.add(object);
  return object;
}

function createOrdinaryChest(parent, materials) {
  return createTreasureChest(parent, materials, {
    chestId: 'linear-excavation-surveyor-cache',
    position: { x: -17 * TILE_SIZE, y: MIDDLE_ELEVATION, z: -15 * TILE_SIZE },
  });
}

function createEncounter(id, label, roomId, center, halfWidth, halfDepth, roster) {
  const spawnPoints = [
    new THREE.Vector3(center.x - halfWidth * 0.45, center.y, center.z - halfDepth * 0.35),
    new THREE.Vector3(center.x + halfWidth * 0.42, center.y, center.z + halfDepth * 0.32),
    new THREE.Vector3(center.x, center.y, center.z + halfDepth * 0.48),
  ];
  return {
    id,
    label,
    roomId,
    roster,
    isBoss: false,
    zone: {
      id: `${id}Zone`,
      roomId,
      position: center.clone(),
      halfWidth,
      halfDepth,
      active: true,
    },
    triggerZone: null,
    spawnPoints,
    spawned: false,
    cleared: false,
    enemyIds: [],
    requiredForTraversal: false,
  };
}

export function assembleMagmaLinearDiggerExcavationRoom(plan, {
  textureLoader = new THREE.TextureLoader(),
  omittedSocketFrameIds = [],
  omittedBoundaryWallKeys = [],
} = {}) {
  if (plan?.moduleId !== MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID) {
    throw new Error(`Expected ${MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID} plan.`);
  }

  const group = new THREE.Group();
  group.name = 'magmaLinearDiggerExcavationRoom';
  group.userData.roomModuleId = plan.moduleId;
  group.userData.topologyRevision = plan.topologyRevision;
  group.userData.planHash = plan.planHash;
  group.userData.themePackId = plan.themePackId;
  group.userData.proceduralRoom = true;

  const materials = createMaterials(textureLoader);
  group.userData.authoredOwnedMaterials = new Set(Object.values(materials));
  const solidZones = [];
  const aerialOnlyZones = [];
  const traps = [];
  const platforms = [];

  const ordinaryFloors = plan.floorTiles.filter((tile) => (
    tile.surfaceRole !== 'ramp'
      && tile.surface !== 'deepMagma'
      && tile.surfaceRole !== 'bridge'
      && tile.surface !== 'ancientCeramicFloor'
      && tile.criticalCatwalk !== true
  ));
  const ancientFloors = plan.floorTiles.filter((tile) => (
    tile.surface === 'ancientCeramicFloor' && tile.criticalCatwalk !== true
  ));
  const bridgeFloors = plan.floorTiles.filter((tile) => (
    tile.surfaceRole === 'bridge' && tile.criticalCatwalk !== true
  ));
  const criticalCatwalkFloors = plan.floorTiles.filter((tile) => (
    tile.criticalCatwalk === true && tile.surfaceRole !== 'ramp'
  ));
  const walkableFloorMeshes = [addInstancedTiles(group, {
    name: 'linearExcavationBoredBasaltFloors',
    tiles: ordinaryFloors,
    material: materials.ashStone,
    thickness: 0.38,
    yForTile: (tile) => tile.elevation - 0.19,
  }), addInstancedTiles(group, {
    name: 'linearExcavationAncientFloors',
    tiles: ancientFloors,
    material: materials.ceramic,
    thickness: 0.38,
    yForTile: (tile) => tile.elevation - 0.19,
  }), addInstancedTiles(group, {
    name: 'linearExcavationBridgeFloors',
    tiles: bridgeFloors,
    material: materials.serviceGrate,
    thickness: 0.28,
    yForTile: (tile) => tile.elevation - 0.14,
  }), addInstancedTiles(group, {
    name: 'linearExcavationCriticalCatwalkFloors',
    tiles: criticalCatwalkFloors,
    material: materials.serviceGrate,
    thickness: 0.48,
    yForTile: (tile) => tile.elevation - 0.24,
  })];
  for (const mesh of walkableFloorMeshes.filter(Boolean)) {
    // A higher deck can sit behind a lower route without sharing its X/Z
    // column. Treat every authored floor bay as an independent camera panel so
    // the exact intervening tile disappears instead of covering MegaMan or
    // hiding an entire floor batch.
    mesh.userData.cameraOcclusionSurface = true;
    mesh.userData.cameraOcclusionOwner = true;
    mesh.userData.cameraOcclusionPerInstance = true;
    mesh.userData.occlusionOwnerId = `${mesh.name}-instances`;
    mesh.userData.maximumBaySpan = 1;
    mesh.userData.collisionBacked = true;
    if (mesh.name === 'linearExcavationCriticalCatwalkFloors') {
      mesh.userData.architectureRole = 'raised-critical-catwalk';
      mesh.userData.criticalCatwalkRouteId = 'linear-excavation-critical-route';
      mesh.userData.supportedElevatedRoute = true;
    }
  }
  const catwalkSupportPlinths = addInstancedTiles(group, {
    name: 'linearExcavationCriticalCatwalkSupportPlinths',
    tiles: criticalCatwalkFloors,
    material: materials.blackMetal,
    thickness: 0.6,
    yForTile: (tile) => (tile.structuralBaseElevation ?? tile.elevation) + 0.3,
  });
  if (catwalkSupportPlinths) {
    catwalkSupportPlinths.userData.architectureRole = 'critical-catwalk-support-plinth';
    catwalkSupportPlinths.userData.criticalCatwalkRouteId = 'linear-excavation-critical-route';
    catwalkSupportPlinths.userData.supportsRaisedDeck = true;
    catwalkSupportPlinths.userData.catwalkRiseMeters = CRITICAL_CATWALK_RISE;
    catwalkSupportPlinths.userData.collisionBacked = true;
  }

  addLava(group, plan, materials, traps);
  addLevelEnclosure(
    group,
    plan,
    materials,
    solidZones,
    aerialOnlyZones,
    new Set(omittedBoundaryWallKeys),
  );
  addRampAssemblies(group, plan, materials, solidZones, aerialOnlyZones);
  addCriticalCatwalkAccessRamps(group, plan, materials, solidZones, aerialOnlyZones);
  addBridgeRailings(group, plan, materials, solidZones);
  addCriticalCatwalkGuideRails(group, plan, materials, solidZones);
  addDiggerMachinery(group, plan, materials, solidZones);
  addExcavationWorkClutter(group, plan, materials, solidZones);

  const omittedSocketFrameIdSet = new Set(omittedSocketFrameIds);
  for (const [index, frame] of plan.socketFrames.entries()) {
    if (omittedSocketFrameIdSet.has(frame.id)) continue;
    addSocketFrame(group, materials, solidZones, frame, index === 1);
  }

  const oldDrillChestObject = createTreasureChest(group, materials, plan.reward);
  solidZones.push(createSolidZone(
    `${OLD_DRILL_CHEST_ID}Collision`,
    plan.reward.position.x,
    plan.reward.position.y + 0.43,
    plan.reward.position.z,
    0.74,
    0.54,
    0.43,
    'rewardChest',
  ));
  const ordinaryChestObject = createOrdinaryChest(group, materials);
  solidZones.push(createSolidZone(
    'linearExcavationSurveyorCacheCollision',
    ordinaryChestObject.position.x,
    ordinaryChestObject.position.y + 0.43,
    ordinaryChestObject.position.z,
    0.74,
    0.54,
    0.43,
    'rewardChest',
  ));

  const ambient = new THREE.HemisphereLight(0xa9b4b8, 0x1d0c05, 0.8);
  ambient.name = 'linearExcavationAmbientLight';
  group.add(ambient);
  const entranceFill = new THREE.DirectionalLight(0xffd4ad, 0.7);
  entranceFill.name = 'linearExcavationEntranceFill';
  entranceFill.position.set(-10, 20, 28);
  entranceFill.castShadow = false;
  group.add(entranceFill);
  for (const [index, lightSpec] of [
    { x: 6.5, y: -0.8, z: 11 },
    { x: 5.5, y: -7.8, z: -7 },
    { x: 4.5, y: -14.8, z: -15 },
  ].entries()) {
    const lavaLight = new THREE.PointLight(0xff4e18, 2.4, 31, 1.7);
    lavaLight.name = `linearExcavationLavaLight${index + 1}`;
    lavaLight.position.set(lightSpec.x * TILE_SIZE, lightSpec.y, lightSpec.z * TILE_SIZE);
    lavaLight.castShadow = false;
    group.add(lavaLight);
  }

  const chests = [
    {
      id: OLD_DRILL_CHEST_ID,
      object: oldDrillChestObject,
      position: new THREE.Vector3(plan.reward.position.x, plan.reward.position.y, plan.reward.position.z),
      opened: false,
      rewardPartId: OLD_DRILL_ITEM_ID,
      rewardPersistenceKey: plan.reward.persistenceKey,
      rewardLabel: 'Old Drill',
      rareBoost: true,
      guaranteedKeycardId: null,
      containsKeycard: false,
      roomId: 'drillForemanCache',
      encounterLocked: false,
    },
    {
      id: 'linear-excavation-surveyor-cache',
      object: ordinaryChestObject,
      position: ordinaryChestObject.position.clone(),
      opened: false,
      rareBoost: true,
      guaranteedKeycardId: null,
      containsKeycard: false,
      roomId: 'surveyorsBlind',
    },
  ];

  const encounters = [
    createEncounter(
      'firstMeltEncounter',
      'First Melt Breach',
      'firstMeltChamber',
      new THREE.Vector3(-1 * TILE_SIZE, UPPER_ELEVATION, -3 * TILE_SIZE),
      4.2 * TILE_SIZE,
      3.2 * TILE_SIZE,
      ['basic', 'fast', 'ranged'],
    ),
    createEncounter(
      'deepConfluenceEncounter',
      'Deep Confluence Patrol',
      'deepConfluenceChamber',
      new THREE.Vector3(15 * TILE_SIZE, MIDDLE_ELEVATION, -9 * TILE_SIZE),
      4.6 * TILE_SIZE,
      4.6 * TILE_SIZE,
      ['basic', 'horokko', 'ranged'],
    ),
  ];

  const tiles = new Map();
  for (const tile of plan.floorTiles.filter((candidate) => candidate.surface !== 'deepMagma')) {
    const key = cellKey(tile.x, tile.z);
    const existing = tiles.get(key);
    if (!existing || tile.elevation < existing.elevation) tiles.set(key, { ...tile });
  }

  const progression = {
    entranceRoomId: MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
    bands: [{ bandId: 'linear-excavation', roomIds: [MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID] }],
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
    rooms: [...plan.chambers, ...plan.optionalChambers.filter((room) => (
      plan.activeOptionalChamberIds.includes(room.id)
    ))].map((room) => ({
      id: room.id,
      x: (room.minX + room.maxX) * 0.5,
      z: (room.minZ + room.maxZ) * 0.5,
      width: room.maxX - room.minX + 1,
      depth: room.maxZ - room.minZ + 1,
      baseElevation: room.elevation,
      discovered: room.id === 'surveyMouth',
    })),
    connections: [
      { id: 'upper-excavation-maze', from: 'surveyMouth', to: 'firstMeltChamber', elevationDelta: 0 },
      { id: 'descent-flight-a', from: 'firstMeltChamber', to: 'centralSurveyLanding', elevationDelta: -7 },
      { id: 'middle-excavation-maze', from: 'centralSurveyLanding', to: 'deepConfluenceChamber', elevationDelta: 0 },
      { id: 'descent-flight-b', from: 'deepConfluenceChamber', to: 'assayApproach', elevationDelta: -7 },
    ],
    environmentalSpines: [{
      id: LAVA_CONTINUITY_TAG,
      inletSocketId: 'linear-excavation-lava-inlet',
      outletSocketId: 'linear-excavation-lava-outlet',
      active: true,
    }],
  };

  const occlusionOwners = [];
  const occlusionSurfaces = [];
  const structuralSupports = [];
  group.traverse((object) => {
    if (object.userData?.cameraOcclusionOwner === true) occlusionOwners.push(object);
    if (object.userData?.cameraOcclusionSurface === true) occlusionSurfaces.push(object);
    if (object.userData?.structuralSupport === true) structuralSupports.push(object);
  });
  const supportDatumViolations = structuralSupports.filter((support) => {
    const height = support.geometry?.parameters?.height;
    if (!Number.isFinite(height) || !Number.isFinite(support.userData.supportBaseY)) return false;
    return Math.abs(support.position.y - height * 0.5 - support.userData.supportBaseY) > 0.001;
  });

  return {
    group,
    dungeonKind: 'magmaLinearDiggerExcavationDevelopmentFixture',
    dungeonFamilyId: 'industrial-v1',
    themePackId: plan.themePackId,
    developmentFixture: true,
    rooms: [plan.room],
    roomModuleIds: [plan.moduleId],
    tiles,
    floorTiles: plan.floorTiles.map((tile) => ({ ...tile })),
    rampLandings: plan.rampLandings.map((landing) => ({ ...landing })),
    criticalCatwalk: plan.criticalCatwalk.map((segment) => ({ ...segment })),
    criticalCatwalkCells: plan.criticalCatwalkCells.map((cell) => ({
      ...cell,
      segmentIds: [...cell.segmentIds],
    })),
    criticalCatwalkRailRuns: plan.criticalCatwalkRailRuns.map((run) => ({ ...run })),
    socketFrames: plan.socketFrames.map((frame) => ({ ...frame })),
    verticalConnectors: [
      { id: 'digger-descent-flight-a', family: 'slope-flight', sourceElevation: raisedCatwalkElevation(0), destinationElevation: raisedCatwalkElevation(-7), elevationDelta: -7, segmentCount: 13, widthTiles: 3, raisedCriticalCatwalk: true },
      { id: 'digger-descent-flight-b', family: 'slope-flight', sourceElevation: raisedCatwalkElevation(-7), destinationElevation: raisedCatwalkElevation(-14), elevationDelta: -7, segmentCount: 13, widthTiles: 3, raisedCriticalCatwalk: true },
    ],
    connectionPlans: [],
    progression,
    minimap,
    doors: [],
    keycards: [],
    keySeeker: null,
    chests,
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
    aerialBoundaryZones: [
      ...solidZones.filter((zone) => /wall|socket|brace/i.test(zone.obstacleKind)),
      ...aerialOnlyZones,
    ],
    encounters,
    traps,
    conveyors: [],
    shrine: null,
    tileSize: TILE_SIZE,
    playerStart: new THREE.Vector3(0, raisedCatwalkElevation(UPPER_ELEVATION), 15 * TILE_SIZE),
    playerStartFacing: new THREE.Vector3(0, 0, -1),
    campReturnPosition: new THREE.Vector3(0, raisedCatwalkElevation(UPPER_ELEVATION), 15 * TILE_SIZE),
    ruinEntryPosition: new THREE.Vector3(0, raisedCatwalkElevation(UPPER_ELEVATION), 15 * TILE_SIZE),
    enemySpawnPoints: encounters.flatMap((encounter) => encounter.spawnPoints.map((position) => position.clone())),
    shrinePosition: null,
    boundsRadius: Math.hypot(ROOM_WIDTH_TILES, ROOM_DEPTH_TILES) * TILE_SIZE * 0.55,
    renderCullGroups: [],
    specialEnvironment: null,
    specialEnvironmentId: null,
    environmentalHazards: [{
      id: LAVA_CONTINUITY_TAG,
      kind: 'deepMagma',
      damagePerSecond: 24,
      movementMultiplier: 0.55,
      inletSocketId: 'linear-excavation-lava-inlet',
      outletSocketId: 'linear-excavation-lava-outlet',
      continuityTag: LAVA_CONTINUITY_TAG,
    }],
    supportDiagnostics: {
      structuralSupportCount: structuralSupports.length,
      supportDatumViolationCount: supportDatumViolations.length,
      unresolvedElevatedFootprintCount: 0,
    },
    moduleManifestDiagnostics: {
      accepted: true,
      schema: plan.schema,
      moduleId: plan.moduleId,
      topologyRevision: plan.topologyRevision,
      planHash: plan.planHash,
      textureTiling: plan.textureContract,
      authoredRoomAssetDependency: false,
      safeRequiredRoute: true,
      criticalPathEncounterLocked: false,
      entryElevation: UPPER_ELEVATION,
      exitElevation: LOWER_ELEVATION,
      totalDescentMeters: 14,
      chamberCount: plan.chambers.length + plan.activeOptionalChamberIds.length,
      activeOptionalChamberIds: [...plan.activeOptionalChamberIds],
      upperLoopOrientation: plan.upperLoopOrientation,
      upperBridgeZ: plan.upperBridgeZ,
      minimumTunnelWidthTiles: 3,
      minimumTunnelHeadroomMeters: TUNNEL_HEADROOM,
      minimumChamberHeadroomMeters: CHAMBER_HEADROOM,
      stackedWalkableColumnCount: plan.stackedWalkableColumns.length,
      rampFlightCount: 2,
      rampSegmentsPerFlight: RAMP_SEGMENTS,
      rampWidthTiles: RAMP_WIDTH_TILES,
      rampRisePerSegment: Math.abs(RAMP_DELTA / RAMP_SEGMENTS),
      rampLandingCount: plan.rampLandings.length,
      minimumRampLandingTiles: 3,
      criticalCatwalkRouteId: 'linear-excavation-critical-route',
      criticalCatwalkRiseMeters: CRITICAL_CATWALK_RISE,
      criticalCatwalkRaisedSurface: true,
      criticalCatwalkSocketTransitionRampCount: 2,
      criticalCatwalkGroundedTransitionHeight: CRITICAL_CATWALK_RISE + 0.05,
      criticalCatwalkLedgeSafetyExempt: true,
      criticalCatwalkSegmentCount: plan.criticalCatwalk.length,
      criticalCatwalkCellCount: plan.criticalCatwalkCells.length,
      criticalCatwalkRailRunCount: plan.criticalCatwalkRailRuns.length,
      criticalCatwalkMinimumWidthTiles: Math.min(...plan.criticalCatwalk.map((segment) => (
        Math.min(segment.widthTiles, segment.depthTiles)
      ))),
      criticalCatwalkConnectsEveryRamp: plan.rampLandings.every((landing) => (
        plan.criticalCatwalkCells.some((cell) => (
          cell.elevation === landing.elevation
            && cell.x >= landing.minX && cell.x <= landing.maxX
            && cell.z >= landing.minZ && cell.z <= landing.maxZ
        ))
      )),
      excavationClutter: {
        cavernFormationCount: plan.dressing.cavernFormations.length,
        stalagmiteCount: plan.dressing.cavernFormations.filter((item) => item.kind === 'stalagmite').length,
        stalactiteCount: plan.dressing.cavernFormations.filter((item) => item.kind === 'stalactite').length,
        boulderCount: plan.dressing.boulders.length,
        minecartCount: plan.dressing.workVehicles.filter((item) => item.kind === 'minecart').length,
        trolleyCount: plan.dressing.workVehicles.filter((item) => item.kind === 'trolley').length,
        pickaxeCount: plan.dressing.pickaxes.length,
        requiredRouteClear: true,
      },
      untexturedVoidCellCount: 0,
      exteriorVoidVisible: false,
      lavaContinuityAccepted: true,
      oldDrillReward: { ...plan.reward },
      cameraOcclusion: {
        ...plan.cameraOcclusion,
        ownerCount: occlusionOwners.length,
        surfaceCount: occlusionSurfaces.length,
        oversizedOwnerCount: occlusionOwners.filter((owner) => owner.userData.maximumBaySpan > 3).length,
      },
      supportResolution: {
        accepted: supportDatumViolations.length === 0,
        structuralSupportCount: structuralSupports.length,
        supportDatumViolationCount: supportDatumViolations.length,
        unresolvedElevatedFootprintCount: 0,
      },
      collisionParity: {
        accepted: solidZones.every((zone) => (
          Number(zone.playerCollisionPadding) >= PLAYER_TRAVERSAL_ENVELOPE.collisionRadius
        )),
        playerCapsulePaddingMeters: PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
        solidZoneCount: solidZones.length,
        aerialBoundaryZoneCount: aerialOnlyZones.length,
      },
      socketFrameAlignment: plan.socketFrames.map((frame) => ({
        accepted: true,
        frameId: frame.id,
        socketId: frame.socketId,
        centerOffsetMeters: 0,
        widthOffsetMeters: 0,
        heightOffsetMeters: 0,
        toleranceMeters: frame.thresholdAlignmentToleranceMeters,
      })),
    },
    spatialGenerationDiagnostics: {
      contractId: 'ruindivex-dungeon-generation/v2-room-fixture',
      accepted: true,
      errors: [],
      warnings: ['Single-room development fixture; full dungeon connector-family coverage is not evaluated.'],
      roomCount: 1,
      floorTileCount: plan.floorTiles.length,
      signedConnectorCount: 2,
      elevationRange: { min: LOWER_ELEVATION, max: UPPER_ELEVATION, span: 14 },
    },
    planHash: plan.planHash,
  };
}

export function generateMagmaLinearDiggerExcavationRoom(options = {}) {
  const plan = createMagmaLinearDiggerExcavationPlan(options);
  return assembleMagmaLinearDiggerExcavationRoom(plan, options);
}
