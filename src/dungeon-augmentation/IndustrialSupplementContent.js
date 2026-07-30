import {
  cloneDungeonAugmentationValue,
  deepFreezeDungeonAugmentationValue,
} from './canonical.js';

/**
 * Renderer-free authored content for the Industrial V4 supplement rooms.
 *
 * The planner owns geometry and connectivity. This catalog only describes the
 * gameplay purpose of a room and deterministic recipes that a runtime may
 * materialize after the physical route has been accepted.
 */

export const INDUSTRIAL_SUPPLEMENT_CONTENT_SCHEMA =
  'ruindivex-industrial-supplement-content/v1';
export const INDUSTRIAL_SUPPLEMENT_MODULE_MANIFEST_SCHEMA =
  'ruindivex-industrial-supplement-module-manifest/v1';
export const INDUSTRIAL_SUPPLEMENT_ENCOUNTER_RECIPE_SCHEMA =
  'ruindivex-industrial-supplement-encounter-recipe/v1';
export const INDUSTRIAL_SUPPLEMENT_REWARD_RECIPE_SCHEMA =
  'ruindivex-industrial-supplement-reward-recipe/v1';
export const INDUSTRIAL_SUPPLEMENT_MECHANISM_RECIPE_SCHEMA =
  'ruindivex-industrial-supplement-mechanism-recipe/v1';
export const INDUSTRIAL_SUPPLEMENT_STRUCTURAL_QUALITY_SCHEMA =
  'ruindivex-industrial-supplement-structural-quality/v1';

const V4_PROFILE_ID = 'industrial-supplement-preview-v4';
const FLOOR_CELL_METERS = 2.8;

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function immutableClone(value) {
  return deepFreezeDungeonAugmentationValue(cloneDungeonAugmentationValue(value));
}

function resolveCatalogEntry(catalog, id) {
  if (typeof id !== 'string' || !own(catalog, id)) return null;
  return immutableClone(catalog[id]);
}

function localTile(x, z, elevation = 0) {
  return { x, z, elevation };
}

function moduleAnchor(id, kind, x, z, extra = {}) {
  return { id, kind, localTile: localTile(x, z, extra.elevation ?? 0), ...extra };
}

function moduleLight(id, kind, x, z, {
  elevation,
  color,
  intensity,
  rangeTiles,
  floorZoneIds,
  purpose,
  castsShadow = false,
}) {
  return {
    id,
    kind,
    localTile: localTile(x, z, elevation),
    color,
    intensity,
    rangeTiles,
    floorZoneIds: [...floorZoneIds],
    purpose,
    castsShadow,
  };
}

function moduleStructuralQuality({
  focalLandmarkId,
  requiredClearRouteIds,
  maximumDistanceToFeatureTiles,
}) {
  return {
    schema: INDUSTRIAL_SUPPLEMENT_STRUCTURAL_QUALITY_SCHEMA,
    requiredExitSocketIds: ['entry', 'exit'],
    minimumExitRouteWidthTiles: 2,
    presentationDistribution: {
      minimumCoverCount: 2,
      minimumLandmarkCount: 2,
      minimumDistinctTiles: 3,
      minimumCoverSpanTiles: 2,
      minimumLandmarkSpanTiles: 2,
      maximumColocatedRecordsPerTile: 2,
      requireNonBlockingCover: true,
    },
    emptyFloor: {
      maximumDistanceToFeatureTiles,
    },
    requiredSightlines: [
      {
        id: `entry-to-${focalLandmarkId}`,
        fromSocketId: 'entry',
        fromBoundary: 'south',
        targetLandmarkId: focalLandmarkId,
        requiredClearRouteIds: [...requiredClearRouteIds],
        minimumVisibleOrigins: 1,
      },
      {
        id: `exit-to-${focalLandmarkId}`,
        fromSocketId: 'exit',
        fromBoundary: 'north',
        targetLandmarkId: focalLandmarkId,
        requiredClearRouteIds: [...requiredClearRouteIds],
        minimumVisibleOrigins: 1,
      },
    ],
    enclosure: {
      mode: 'sealed-room-shell',
      aperturePolicy: 'active-sockets-only',
      inactiveSocketPolicy: 'capped',
      minimumCeilingHeightMeters: 5.6,
      requiredStructureCollections: ['floors', 'walls', 'ceilings', 'supports', 'caps'],
    },
    camera: {
      minimumClearanceHeightMeters: 3.6,
      protectedClearRouteIds: [...requiredClearRouteIds],
      occlusionPolicy: 'camera-owned-enclosure-fade',
    },
  };
}

const FLOOR_MASK_LEGEND = {
  '#': 'walkable-floor',
  '.': 'outside-module-floor',
};

const moduleManifests = {
  challenge: {
    schema: INDUSTRIAL_SUPPLEMENT_MODULE_MANIFEST_SCHEMA,
    id: 'challenge',
    moduleKind: 'challenge',
    profileId: V4_PROFILE_ID,
    compatibleGrammarIds: ['supplement-hall-cluster-encounter-v1'],
    compatibleModuleKinds: ['room'],
    contentRoles: ['challenge', 'encounter'],
    defaultContentRole: 'challenge',
    purpose: 'A readable combat station that turns a route decision into a short positional fight.',
    story: 'A dormant inspection line wakes as the intruder crosses the painted work cell.',
    layout: {
      topology: 'cross-lane-arena',
      defaultTopologyClass: 'junction',
      supportedTopologyClasses: ['through', 'junction', 'vertical'],
      dimensionsTiles: { width: 7, depth: 7 },
      circulation: 'Keep every active doorway connected by a broad central lane.',
    },
    structuralQuality: moduleStructuralQuality({
      focalLandmarkId: 'warning-cross',
      requiredClearRouteIds: ['challenge-entry-to-core'],
      maximumDistanceToFeatureTiles: 3,
    }),
    floorCellMeters: FLOOR_CELL_METERS,
    floorMaskLegend: FLOOR_MASK_LEGEND,
    floorMask: [
      '..###..',
      '.#####.',
      '#######',
      '#######',
      '#######',
      '.#####.',
      '..###..',
    ],
    floorTiers: [
      {
        id: 'challenge-base-floor',
        elevation: 0,
        floorMask: [
          '..###..',
          '.#####.',
          '#######',
          '#######',
          '#######',
          '.#####.',
          '..###..',
        ],
        maskOriginTile: { x: -3, z: -3 },
        zoneIds: ['combat-floor', 'flank-lanes'],
        accessRouteIds: ['challenge-entry-to-core', 'challenge-core-to-flanks'],
      },
      {
        id: 'challenge-perch-tier',
        elevation: 1.35,
        platformId: 'encounter-platform',
        floorMask: [
          '.......',
          '.......',
          '.......',
          '.......',
          '....##.',
          '....##.',
          '.......',
        ],
        maskOriginTile: { x: -3, z: -3 },
        zoneIds: ['perch-deck'],
        accessRouteIds: ['challenge-core-to-perch'],
      },
    ],
    clearRoutes: [
      {
        id: 'challenge-entry-to-core',
        fromSocketIds: ['entry', 'exit'],
        toZoneId: 'combat-floor',
        floorTierIds: ['challenge-base-floor'],
        traversal: 'walk',
        minimumClearWidthTiles: 2,
        required: true,
      },
      {
        id: 'challenge-core-to-flanks',
        fromZoneId: 'combat-floor',
        toZoneId: 'flank-lanes',
        floorTierIds: ['challenge-base-floor'],
        traversal: 'walk',
        minimumClearWidthTiles: 1,
        required: true,
      },
      {
        id: 'challenge-core-to-perch',
        fromZoneId: 'combat-floor',
        toZoneId: 'perch-deck',
        floorTierIds: ['challenge-base-floor', 'challenge-perch-tier'],
        traversal: 'ramp',
        minimumClearWidthTiles: 1,
        required: true,
      },
    ],
    zones: [
      {
        id: 'combat-floor',
        purpose: 'Primary circulation and frontline pressure.',
        tileBounds: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
        validFor: ['player', 'enemy'],
      },
      {
        id: 'flank-lanes',
        purpose: 'Side movement around the central cover pair.',
        tileBounds: { minX: -3, maxX: 3, minZ: -2, maxZ: 2 },
        excludesZoneIds: ['combat-floor'],
        expectedComponentCount: 2,
        validFor: ['player', 'enemy'],
      },
      {
        id: 'perch-deck',
        purpose: 'A low, reachable firing deck with a clean drop back to the arena.',
        tileBounds: { minX: 1, maxX: 2, minZ: 1, maxZ: 2 },
        elevation: 1.35,
        validFor: ['player', 'enemy'],
      },
    ],
    cover: [
      {
        id: 'press-column-west',
        kind: 'full-height-column',
        localTile: localTile(-1, 0),
        validFloorZoneIds: ['combat-floor'],
        blocksLineOfSight: true,
      },
      {
        id: 'press-column-east',
        kind: 'full-height-column',
        localTile: localTile(1, 0),
        validFloorZoneIds: ['combat-floor'],
        blocksLineOfSight: true,
      },
      {
        id: 'inspection-crate-bank',
        kind: 'waist-high-cover',
        localTile: localTile(0, 2),
        validFloorZoneIds: ['combat-floor', 'flank-lanes'],
        blocksLineOfSight: false,
      },
    ],
    landmarks: [
      {
        id: 'inspection-gantry',
        kind: 'industrial-gantry',
        localTile: localTile(2, 2, 1.35),
        purpose: 'Makes the ranged perch readable from every entrance.',
      },
      {
        id: 'warning-cross',
        kind: 'floor-marking',
        localTile: localTile(0, 0),
        purpose: 'Telegraphs the arena center before the encounter closes.',
      },
    ],
    lighting: [
      moduleLight('challenge-entry-worklight', 'overhead-work-light', 0, -2, {
        elevation: 5.6,
        color: '#b9d7e8',
        intensity: 1.15,
        rangeTiles: 4,
        floorZoneIds: ['combat-floor', 'flank-lanes'],
        purpose: 'Keeps both doorway lanes readable before the encounter engages.',
      }),
      moduleLight('challenge-perch-warning-light', 'warning-beacon', 2, 2, {
        elevation: 4.8,
        color: '#ff8a3d',
        intensity: 0.9,
        rangeTiles: 3,
        floorZoneIds: ['perch-deck'],
        purpose: 'Separates the raised firing deck from the arena floor at a glance.',
      }),
    ],
    anchors: [
      moduleAnchor('encounter-center', 'encounter', 0, 0, {
        encounterProfileId: 'supplement-route-network-defense',
        floorZoneId: 'combat-floor',
      }),
      moduleAnchor('encounter-frontline', 'spatial-role', 0, -2, {
        spatialRole: 'frontline',
        floorZoneId: 'combat-floor',
      }),
      moduleAnchor('encounter-flank-left', 'spatial-role', -2, 1, {
        spatialRole: 'flank',
        floorZoneId: 'flank-lanes',
      }),
      moduleAnchor('encounter-flank-right', 'spatial-role', 2, 1, {
        spatialRole: 'flank',
        floorZoneId: 'flank-lanes',
      }),
      moduleAnchor('encounter-perch', 'spatial-role', 2, 2, {
        elevation: 1.35,
        spatialRole: 'perch',
        floorZoneId: 'perch-deck',
      }),
    ],
  },

  'hazard-control': {
    schema: INDUSTRIAL_SUPPLEMENT_MODULE_MANIFEST_SCHEMA,
    id: 'hazard-control',
    moduleKind: 'hazard-control',
    profileId: V4_PROFILE_ID,
    compatibleGrammarIds: ['supplement-hall-cluster-terminal-v1'],
    compatibleModuleKinds: ['room'],
    contentRoles: ['hazard', 'trap', 'control', 'mechanism', 'terminal'],
    defaultContentRole: 'trap',
    purpose: 'Pairs a visible industrial hazard with a reachable control that changes the safe route.',
    story: 'A pressure-treatment bay is still cycling; its service console can isolate the failing line.',
    layout: {
      topology: 'split-safe-lane-control-bay',
      defaultTopologyClass: 'through',
      supportedTopologyClasses: ['through', 'junction', 'vertical'],
      dimensionsTiles: { width: 9, depth: 9 },
      circulation: 'The approach, bypass, and control deck remain valid before activation.',
    },
    structuralQuality: moduleStructuralQuality({
      focalLandmarkId: 'treatment-coil',
      requiredClearRouteIds: ['hazard-entry-to-safe', 'hazard-safe-to-bypass'],
      maximumDistanceToFeatureTiles: 5,
    }),
    floorCellMeters: FLOOR_CELL_METERS,
    floorMaskLegend: FLOOR_MASK_LEGEND,
    floorMask: [
      '..#####..',
      '.#######.',
      '#########',
      '#########',
      '#########',
      '#########',
      '#########',
      '.#######.',
      '..#####..',
    ],
    floorTiers: [
      {
        id: 'hazard-base-floor',
        elevation: 0,
        floorMask: [
          '..#####..',
          '.#######.',
          '#########',
          '#########',
          '#########',
          '#########',
          '#########',
          '.#######.',
          '..#####..',
        ],
        maskOriginTile: { x: -4, z: -4 },
        zoneIds: ['safe-approach', 'hazard-field', 'bypass-lane'],
        accessRouteIds: [
          'hazard-entry-to-safe',
          'hazard-safe-to-bypass',
          'hazard-isolated-crossing',
        ],
      },
      {
        id: 'hazard-control-tier',
        elevation: 2.8,
        platformId: 'terminal-overlook',
        floorMask: [
          '.........',
          '.........',
          '.........',
          '.........',
          '.........',
          '.........',
          '......##.',
          '......##.',
          '.........',
        ],
        maskOriginTile: { x: -4, z: -4 },
        zoneIds: ['control-deck'],
        accessRouteIds: ['hazard-bypass-to-control'],
      },
    ],
    clearRoutes: [
      {
        id: 'hazard-entry-to-safe',
        fromSocketIds: ['entry', 'exit'],
        toZoneId: 'safe-approach',
        floorTierIds: ['hazard-base-floor'],
        traversal: 'walk',
        minimumClearWidthTiles: 2,
        required: true,
      },
      {
        id: 'hazard-safe-to-bypass',
        fromZoneId: 'safe-approach',
        toZoneId: 'bypass-lane',
        excludedZoneIds: ['hazard-field'],
        floorTierIds: ['hazard-base-floor'],
        traversal: 'walk',
        minimumClearWidthTiles: 1,
        required: true,
      },
      {
        id: 'hazard-bypass-to-control',
        fromZoneId: 'bypass-lane',
        toZoneId: 'control-deck',
        floorTierIds: ['hazard-base-floor', 'hazard-control-tier'],
        traversal: 'ramp',
        minimumClearWidthTiles: 1,
        required: true,
      },
      {
        id: 'hazard-isolated-crossing',
        fromZoneId: 'safe-approach',
        toZoneId: 'bypass-lane',
        viaZoneIds: ['hazard-field'],
        floorTierIds: ['hazard-base-floor'],
        traversal: 'walk',
        requiredState: 'isolated',
        minimumClearWidthTiles: 1,
        required: false,
      },
    ],
    zones: [
      {
        id: 'safe-approach',
        purpose: 'Protected read of the hazard before commitment.',
        tileBounds: { minX: -3, maxX: 3, minZ: -4, maxZ: -2 },
        validFor: ['player', 'enemy'],
      },
      {
        id: 'hazard-field',
        purpose: 'Telegraphed active treatment floor; never a spawn-valid floor.',
        tileBounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
        validFor: [],
      },
      {
        id: 'bypass-lane',
        purpose: 'Narrow safe flank around the active machinery.',
        tileBounds: { minX: -4, maxX: 4, minZ: -1, maxZ: 2 },
        excludesZoneIds: ['hazard-field'],
        validFor: ['player', 'enemy'],
      },
      {
        id: 'control-deck',
        purpose: 'Defensible console platform outside the pulse volume.',
        tileBounds: { minX: 2, maxX: 3, minZ: 2, maxZ: 3 },
        elevation: 2.8,
        validFor: ['player', 'enemy'],
      },
    ],
    cover: [
      {
        id: 'isolation-bulkhead',
        kind: 'full-height-bulkhead',
        localTile: localTile(-3, 1),
        validFloorZoneIds: ['bypass-lane'],
        blocksLineOfSight: true,
      },
      {
        id: 'valve-bank',
        kind: 'waist-high-machinery',
        localTile: localTile(3, -2),
        validFloorZoneIds: ['safe-approach', 'bypass-lane'],
        blocksLineOfSight: false,
      },
    ],
    landmarks: [
      {
        id: 'treatment-coil',
        kind: 'hazard-emitter',
        localTile: localTile(0, 0),
        assemblyGroupId: 'treatment-coil-hazard',
        purpose: 'Provides an unambiguous source for every hazard pulse.',
      },
      {
        id: 'isolation-console',
        kind: 'control-terminal',
        localTile: localTile(3, 3, 2.8),
        assemblyGroupId: 'isolation-console-control',
        purpose: 'Turns the dangerous center into a safe shortcut after interaction.',
      },
    ],
    lighting: [
      moduleLight('hazard-safe-lane-worklight', 'overhead-work-light', 0, -3, {
        elevation: 5.8,
        color: '#b8dce8',
        intensity: 1.2,
        rangeTiles: 4,
        floorZoneIds: ['safe-approach', 'bypass-lane'],
        purpose: 'Establishes the protected approach and safe bypass before activation.',
      }),
      moduleLight('hazard-field-warning-beacon', 'hazard-warning-beacon', 0, 0, {
        elevation: 4.6,
        color: '#ff4e32',
        intensity: 1.1,
        rangeTiles: 3,
        floorZoneIds: ['hazard-field'],
        purpose: 'Pulses over the exact damaging floor zone without obscuring its boundary.',
      }),
      moduleLight('hazard-control-status-light', 'terminal-status-light', 3, 3, {
        elevation: 6.2,
        color: '#74e6c4',
        intensity: 0.85,
        rangeTiles: 2,
        floorZoneIds: ['control-deck'],
        purpose: 'Makes the isolation console visible from the safe approach.',
      }),
    ],
    anchors: [
      moduleAnchor('hazard-center', 'trap', 0, 0, {
        hazardProfileId: 'supplement-route-network-floor-trap',
        floorZoneId: 'hazard-field',
        assemblyGroupId: 'treatment-coil-hazard',
      }),
      moduleAnchor('control-console', 'progression', 3, 3, {
        elevation: 2.8,
        mechanismProfileId: 'supplement-route-network-control',
        floorZoneId: 'control-deck',
        assemblyGroupId: 'isolation-console-control',
      }),
      moduleAnchor('hazard-frontline', 'spatial-role', 0, -3, {
        spatialRole: 'frontline',
        floorZoneId: 'safe-approach',
      }),
      moduleAnchor('hazard-flank-left', 'spatial-role', -3, 1, {
        spatialRole: 'flank',
        floorZoneId: 'bypass-lane',
      }),
      moduleAnchor('hazard-flank-right', 'spatial-role', 3, 1, {
        spatialRole: 'flank',
        floorZoneId: 'bypass-lane',
      }),
      moduleAnchor('hazard-perch', 'spatial-role', 3, 3, {
        elevation: 2.8,
        spatialRole: 'perch',
        floorZoneId: 'control-deck',
      }),
    ],
  },

  'vertical-maintenance': {
    schema: INDUSTRIAL_SUPPLEMENT_MODULE_MANIFEST_SCHEMA,
    id: 'vertical-maintenance',
    moduleKind: 'vertical-maintenance',
    profileId: V4_PROFILE_ID,
    compatibleGrammarIds: ['supplement-hall-cluster-terminal-v1'],
    compatibleModuleKinds: ['room'],
    contentRoles: ['elevation', 'vertical-maintenance', 'mechanism'],
    defaultContentRole: 'elevation',
    purpose: 'Makes a V4 elevation change a staffed maintenance place instead of an empty connector.',
    story: 'A freight regulator has stopped between decks, leaving its inspection landings as the only route upward.',
    layout: {
      topology: 'stacked-service-well',
      defaultTopologyClass: 'vertical',
      supportedTopologyClasses: ['through', 'junction', 'vertical'],
      dimensionsTiles: { width: 9, depth: 9 },
      elevationBandsMeters: [0, 2.8],
      circulation: 'Every combat floor has a non-jump route to the next required landing.',
    },
    structuralQuality: moduleStructuralQuality({
      focalLandmarkId: 'freight-regulator',
      requiredClearRouteIds: [
        'maintenance-entry-to-lower',
        'maintenance-lower-to-platform',
      ],
      maximumDistanceToFeatureTiles: 5,
    }),
    floorCellMeters: FLOOR_CELL_METERS,
    floorMaskLegend: FLOOR_MASK_LEGEND,
    floorMask: [
      '...###...',
      '..#####..',
      '.#######.',
      '#########',
      '###...###',
      '###...###',
      '#########',
      '..#####..',
      '...###...',
    ],
    floorTiers: [
      {
        id: 'maintenance-base-floor',
        elevation: 0,
        floorMask: [
          '...###...',
          '..#####..',
          '.#######.',
          '#########',
          '###...###',
          '###...###',
          '#########',
          '..#####..',
          '...###...',
        ],
        maskOriginTile: { x: -4, z: -4 },
        zoneIds: ['lower-deck', 'maintenance-landings'],
        accessRouteIds: ['maintenance-entry-to-lower', 'maintenance-lower-to-platform'],
      },
      {
        id: 'maintenance-platform-tier',
        elevation: 2.8,
        platformId: 'terminal-overlook',
        floorMask: [
          '.........',
          '.........',
          '.........',
          '.........',
          '.........',
          '...###...',
          '...###...',
          '...###...',
          '.........',
        ],
        maskOriginTile: { x: -4, z: -4 },
        zoneIds: ['maintenance-landings', 'upper-catwalk'],
        accessRouteIds: [
          'maintenance-lower-to-platform',
          'maintenance-platform-to-catwalk',
        ],
      },
    ],
    clearRoutes: [
      {
        id: 'maintenance-entry-to-lower',
        fromSocketIds: ['entry', 'exit'],
        toZoneId: 'lower-deck',
        floorTierIds: ['maintenance-base-floor'],
        traversal: 'walk',
        minimumClearWidthTiles: 2,
        required: true,
      },
      {
        id: 'maintenance-lower-to-platform',
        fromZoneId: 'lower-deck',
        toZoneId: 'maintenance-landings',
        floorTierIds: ['maintenance-base-floor', 'maintenance-platform-tier'],
        traversal: 'ramp',
        minimumClearWidthTiles: 1,
        required: true,
      },
      {
        id: 'maintenance-platform-to-catwalk',
        fromZoneId: 'maintenance-landings',
        toZoneId: 'upper-catwalk',
        floorTierIds: ['maintenance-platform-tier'],
        traversal: 'walk',
        minimumClearWidthTiles: 1,
        required: true,
      },
    ],
    zones: [
      {
        id: 'lower-deck',
        purpose: 'Arrival floor and recovery space below the ascent.',
        tileBounds: { minX: -3, maxX: 3, minZ: -4, maxZ: -1 },
        elevation: 0,
        validFor: ['player', 'enemy'],
      },
      {
        id: 'maintenance-landings',
        purpose: 'Broad intermediate landings that reset the climb.',
        tileBounds: { minX: -3, maxX: 3, minZ: -1, maxZ: 2 },
        elevations: [0, 2.8],
        expectedComponentCount: 2,
        validFor: ['player', 'enemy'],
      },
      {
        id: 'upper-catwalk',
        purpose: 'Upper route and readable ranged position.',
        tileBounds: { minX: -1, maxX: 1, minZ: 1, maxZ: 3 },
        elevation: 2.8,
        validFor: ['player', 'enemy'],
      },
    ],
    cover: [
      {
        id: 'lift-counterweight',
        kind: 'full-height-machinery',
        localTile: localTile(0, 1, 2.8),
        assemblyGroupId: 'freight-regulator-counterweight',
        validFloorZoneIds: ['maintenance-landings'],
        blocksLineOfSight: true,
      },
      {
        id: 'upper-tool-lockers',
        kind: 'waist-high-cover',
        localTile: localTile(1, 3, 2.8),
        validFloorZoneIds: ['upper-catwalk'],
        blocksLineOfSight: false,
      },
    ],
    landmarks: [
      {
        id: 'freight-regulator',
        kind: 'vertical-machinery',
        localTile: localTile(0, 1, 2.8),
        assemblyGroupId: 'freight-regulator-counterweight',
        purpose: 'Visually joins all elevation bands without becoming traversal geometry.',
      },
      {
        id: 'maintenance-number-stack',
        kind: 'wayfinding-marking',
        localTile: localTile(-1, 2, 2.8),
        purpose: 'Lets the player read height and return direction at a glance.',
      },
      {
        id: 'maintenance-return-arrow',
        kind: 'wayfinding-marking',
        localTile: localTile(3, -1),
        purpose: 'Breaks the broad recovery deck and marks the lower return lane.',
      },
    ],
    lighting: [
      moduleLight('maintenance-lower-worklight', 'overhead-work-light', 0, -3, {
        elevation: 4.8,
        color: '#c2d8df',
        intensity: 1,
        rangeTiles: 4,
        floorZoneIds: ['lower-deck'],
        purpose: 'Marks the recovery floor and the beginning of the ascent.',
      }),
      moduleLight('maintenance-landing-guide-light', 'vertical-guide-light', -1, 1, {
        elevation: 5.8,
        color: '#f2bd63',
        intensity: 0.9,
        rangeTiles: 3,
        floorZoneIds: ['maintenance-landings'],
        purpose: 'Traces the non-jump transfer between the lower and upper decks.',
      }),
      moduleLight('maintenance-upper-worklight', 'catwalk-work-light', 0, 3, {
        elevation: 6.8,
        color: '#b9d7e8',
        intensity: 1.05,
        rangeTiles: 3,
        floorZoneIds: ['upper-catwalk'],
        purpose: 'Silhouettes the upper route and its return direction.',
      }),
    ],
    anchors: [
      moduleAnchor('maintenance-lower', 'platform', 0, -3, {
        floorZoneId: 'lower-deck',
      }),
      moduleAnchor('maintenance-mid', 'platform', -1, 1, {
        elevation: 2.8,
        floorZoneId: 'maintenance-landings',
      }),
      moduleAnchor('maintenance-upper', 'platform', 0, 3, {
        elevation: 2.8,
        floorZoneId: 'upper-catwalk',
      }),
      moduleAnchor('maintenance-frontline', 'spatial-role', 0, -3, {
        spatialRole: 'frontline',
        floorZoneId: 'lower-deck',
      }),
      moduleAnchor('maintenance-flank-left', 'spatial-role', -1, 2, {
        elevation: 2.8,
        spatialRole: 'flank',
        floorZoneId: 'maintenance-landings',
      }),
      moduleAnchor('maintenance-flank-right', 'spatial-role', 1, 2, {
        elevation: 2.8,
        spatialRole: 'flank',
        floorZoneId: 'maintenance-landings',
      }),
      moduleAnchor('maintenance-perch', 'spatial-role', 0, 3, {
        elevation: 2.8,
        spatialRole: 'perch',
        floorZoneId: 'upper-catwalk',
      }),
    ],
  },

  'reward-vault': {
    schema: INDUSTRIAL_SUPPLEMENT_MODULE_MANIFEST_SCHEMA,
    id: 'reward-vault',
    moduleKind: 'reward-vault',
    profileId: V4_PROFILE_ID,
    compatibleGrammarIds: ['supplement-hall-cluster-reward-v1'],
    compatibleModuleKinds: ['room'],
    contentRoles: ['reward', 'treasure', 'payoff'],
    defaultContentRole: 'reward',
    purpose: 'A compact, legible payoff room that terminates or decorates an optional route.',
    story: 'An inventory cage survived the shutdown with one sealed dispatch cache still registered inside.',
    layout: {
      topology: 'threshold-vault-dais',
      defaultTopologyClass: 'through',
      supportedTopologyClasses: ['through', 'junction', 'vertical'],
      dimensionsTiles: { width: 7, depth: 7 },
      circulation: 'The reward dais is visible from the threshold and has a clear return route.',
    },
    structuralQuality: moduleStructuralQuality({
      focalLandmarkId: 'reward-dais',
      requiredClearRouteIds: ['vault-entry-to-floor', 'vault-floor-to-dais'],
      maximumDistanceToFeatureTiles: 3,
    }),
    floorCellMeters: FLOOR_CELL_METERS,
    floorMaskLegend: FLOOR_MASK_LEGEND,
    floorMask: [
      '..###..',
      '..###..',
      '.#####.',
      '#######',
      '#######',
      '#######',
      '.#####.',
    ],
    floorTiers: [
      {
        id: 'vault-base-floor',
        elevation: 0,
        floorMask: [
          '..###..',
          '..###..',
          '.#####.',
          '#######',
          '#######',
          '#######',
          '.#####.',
        ],
        maskOriginTile: { x: -3, z: -3 },
        zoneIds: ['vault-threshold', 'vault-floor', 'keeper-perch'],
        accessRouteIds: [
          'vault-entry-to-floor',
          'vault-floor-to-dais',
          'vault-floor-to-keeper-position',
        ],
      },
    ],
    clearRoutes: [
      {
        id: 'vault-entry-to-floor',
        fromSocketIds: ['entry', 'exit'],
        toZoneId: 'vault-floor',
        floorTierIds: ['vault-base-floor'],
        traversal: 'walk',
        minimumClearWidthTiles: 2,
        required: true,
      },
      {
        id: 'vault-floor-to-dais',
        fromZoneId: 'vault-floor',
        toAnchorId: 'vault-reward',
        floorTierIds: ['vault-base-floor'],
        traversal: 'walk',
        minimumClearWidthTiles: 1,
        required: true,
      },
      {
        id: 'vault-floor-to-keeper-position',
        fromZoneId: 'vault-floor',
        toZoneId: 'keeper-perch',
        floorTierIds: ['vault-base-floor'],
        traversal: 'walk',
        minimumClearWidthTiles: 1,
        required: true,
      },
    ],
    zones: [
      {
        id: 'vault-threshold',
        purpose: 'Readable entrance and encounter release line.',
        tileBounds: { minX: -1, maxX: 1, minZ: -3, maxZ: -2 },
        validFor: ['player', 'enemy'],
      },
      {
        id: 'vault-floor',
        purpose: 'Open circulation around the reward dais.',
        tileBounds: { minX: -3, maxX: 3, minZ: -2, maxZ: 2 },
        validFor: ['player', 'enemy'],
      },
      {
        id: 'keeper-perch',
        purpose: 'Reachable oversight ledge above the dispatch cage.',
        tileBounds: { minX: 1, maxX: 2, minZ: 1, maxZ: 2 },
        validFor: ['player', 'enemy'],
      },
    ],
    cover: [
      {
        id: 'dispatch-cage-west',
        kind: 'open-mesh-partition',
        localTile: localTile(-2, 1),
        validFloorZoneIds: ['vault-floor'],
        blocksLineOfSight: false,
      },
      {
        id: 'dispatch-cage-east',
        kind: 'open-mesh-partition',
        localTile: localTile(2, 1),
        validFloorZoneIds: ['vault-floor', 'keeper-perch'],
        blocksLineOfSight: false,
      },
    ],
    landmarks: [
      {
        id: 'reward-dais',
        kind: 'sealed-cache-dais',
        localTile: localTile(0, 2),
        assemblyGroupId: 'vault-reward-dais',
        purpose: 'Provides the room focal point and exact reward placement.',
      },
      {
        id: 'dispatch-board',
        kind: 'inventory-board',
        localTile: localTile(-2, 2),
        purpose: 'Explains why this side route contains a cache.',
      },
    ],
    lighting: [
      moduleLight('vault-threshold-worklight', 'overhead-work-light', 0, -2, {
        elevation: 5.2,
        color: '#c2d8df',
        intensity: 0.95,
        rangeTiles: 3,
        floorZoneIds: ['vault-threshold', 'vault-floor'],
        purpose: 'Keeps the entrance and immediate return path readable.',
      }),
      moduleLight('vault-dais-spotlight', 'reward-spotlight', 0, 2, {
        elevation: 4.4,
        color: '#f2c86b',
        intensity: 1.25,
        rangeTiles: 3,
        floorZoneIds: ['vault-floor', 'keeper-perch'],
        purpose: 'Makes the sealed cache the room focal point from the threshold.',
      }),
    ],
    anchors: [
      moduleAnchor('vault-reward', 'reward', 0, 2, {
        rewardProfileId: 'supplement-treasure-cache',
        floorZoneId: 'vault-floor',
        assemblyGroupId: 'vault-reward-dais',
      }),
      moduleAnchor('vault-frontline', 'spatial-role', 0, -2, {
        spatialRole: 'frontline',
        floorZoneId: 'vault-threshold',
      }),
      moduleAnchor('vault-flank-left', 'spatial-role', -2, 1, {
        spatialRole: 'flank',
        floorZoneId: 'vault-floor',
      }),
      moduleAnchor('vault-flank-right', 'spatial-role', 2, 1, {
        spatialRole: 'flank',
        floorZoneId: 'vault-floor',
      }),
      moduleAnchor('vault-perch', 'spatial-role', 2, 2, {
        spatialRole: 'perch',
        floorZoneId: 'keeper-perch',
      }),
    ],
  },

  'calm-discovery': {
    schema: INDUSTRIAL_SUPPLEMENT_MODULE_MANIFEST_SCHEMA,
    id: 'calm-discovery',
    moduleKind: 'calm-discovery',
    profileId: V4_PROFILE_ID,
    compatibleGrammarIds: ['supplement-hall-cluster-reward-v1'],
    compatibleModuleKinds: ['room'],
    contentRoles: ['calm', 'discovery'],
    defaultContentRole: 'discovery',
    purpose: 'A low-pressure discovery beat that breaks up repeated combat and exposes factory history.',
    story: 'A sealed break station kept one shift log and a small abandoned salvage tray intact.',
    layout: {
      topology: 'quiet-loop-and-alcove',
      defaultTopologyClass: 'through',
      supportedTopologyClasses: ['through', 'junction', 'vertical'],
      dimensionsTiles: { width: 7, depth: 7 },
      circulation: 'The critical route passes the discovery landmark without forcing interaction.',
    },
    structuralQuality: moduleStructuralQuality({
      focalLandmarkId: 'factory-route-model',
      requiredClearRouteIds: [
        'discovery-entry-to-floor',
        'discovery-floor-to-observation',
      ],
      maximumDistanceToFeatureTiles: 4,
    }),
    floorCellMeters: FLOOR_CELL_METERS,
    floorMaskLegend: FLOOR_MASK_LEGEND,
    floorMask: [
      '..###..',
      '.#####.',
      '#######',
      '#######',
      '#######',
      '.#####.',
      '..###..',
    ],
    floorTiers: [
      {
        id: 'discovery-base-floor',
        elevation: 0,
        floorMask: [
          '..###..',
          '.#####.',
          '#######',
          '#######',
          '#######',
          '.#####.',
          '..###..',
        ],
        maskOriginTile: { x: -3, z: -3 },
        zoneIds: ['discovery-floor', 'archive-alcove'],
        accessRouteIds: ['discovery-entry-to-floor', 'discovery-floor-to-archive'],
      },
      {
        id: 'discovery-observation-tier',
        elevation: 0.7,
        platformId: 'observation-step',
        floorMask: [
          '.......',
          '.......',
          '.......',
          '.......',
          '....##.',
          '....##.',
          '.......',
        ],
        maskOriginTile: { x: -3, z: -3 },
        zoneIds: ['observation-step'],
        accessRouteIds: ['discovery-floor-to-observation'],
      },
    ],
    clearRoutes: [
      {
        id: 'discovery-entry-to-floor',
        fromSocketIds: ['entry', 'exit'],
        toZoneId: 'discovery-floor',
        floorTierIds: ['discovery-base-floor'],
        traversal: 'walk',
        minimumClearWidthTiles: 2,
        required: true,
      },
      {
        id: 'discovery-floor-to-archive',
        fromZoneId: 'discovery-floor',
        toZoneId: 'archive-alcove',
        floorTierIds: ['discovery-base-floor'],
        traversal: 'walk',
        minimumClearWidthTiles: 1,
        required: true,
      },
      {
        id: 'discovery-floor-to-observation',
        fromZoneId: 'discovery-floor',
        toZoneId: 'observation-step',
        floorTierIds: ['discovery-base-floor', 'discovery-observation-tier'],
        traversal: 'step',
        minimumClearWidthTiles: 1,
        required: true,
      },
    ],
    zones: [
      {
        id: 'discovery-floor',
        purpose: 'Unobstructed critical route through the room.',
        tileBounds: { minX: -2, maxX: 2, minZ: -3, maxZ: 3 },
        validFor: ['player', 'enemy'],
      },
      {
        id: 'archive-alcove',
        purpose: 'Optional sheltered log and salvage position.',
        tileBounds: { minX: -3, maxX: -1, minZ: 1, maxZ: 2 },
        validFor: ['player', 'enemy'],
      },
      {
        id: 'observation-step',
        purpose: 'Low step overlooking the critical route.',
        tileBounds: { minX: 1, maxX: 2, minZ: 1, maxZ: 2 },
        elevation: 0.7,
        validFor: ['player', 'enemy'],
      },
    ],
    cover: [
      {
        id: 'break-station-lockers',
        kind: 'full-height-lockers',
        localTile: localTile(-2, 2),
        assemblyGroupId: 'shift-log-station',
        validFloorZoneIds: ['archive-alcove'],
        blocksLineOfSight: true,
      },
      {
        id: 'shift-table',
        kind: 'waist-high-table',
        localTile: localTile(1, 1),
        validFloorZoneIds: ['discovery-floor'],
        blocksLineOfSight: false,
      },
    ],
    landmarks: [
      {
        id: 'shift-log-terminal',
        kind: 'lore-terminal',
        localTile: localTile(-2, 2),
        assemblyGroupId: 'shift-log-station',
        purpose: 'Delivers the discovery without blocking traversal.',
      },
      {
        id: 'factory-route-model',
        kind: 'maintenance-map',
        localTile: localTile(2, 2, 0.7),
        assemblyGroupId: 'route-model-observation',
        purpose: 'Foreshadows another route-network landmark.',
      },
    ],
    lighting: [
      moduleLight('discovery-route-worklight', 'overhead-work-light', 0, -2, {
        elevation: 5.2,
        color: '#bcd5dc',
        intensity: 0.8,
        rangeTiles: 4,
        floorZoneIds: ['discovery-floor'],
        purpose: 'Preserves a calm, unambiguous critical route through the room.',
      }),
      moduleLight('discovery-archive-lamp', 'archive-task-light', -2, 2, {
        elevation: 2.4,
        color: '#e6b96e',
        intensity: 0.65,
        rangeTiles: 2,
        floorZoneIds: ['archive-alcove'],
        purpose: 'Draws attention to the shift log without making it mandatory.',
      }),
      moduleLight('discovery-observation-light', 'low-step-guide-light', 2, 2, {
        elevation: 3.6,
        color: '#8fc7cf',
        intensity: 0.7,
        rangeTiles: 2,
        floorZoneIds: ['observation-step'],
        purpose: 'Separates the optional observation step from the route floor.',
      }),
    ],
    anchors: [
      moduleAnchor('discovery-log', 'discovery', -2, 2, {
        discoveryId: 'industrial-shift-route-log',
        floorZoneId: 'archive-alcove',
        assemblyGroupId: 'shift-log-station',
      }),
      moduleAnchor('discovery-cache', 'reward', -2, 1, {
        rewardProfileId: 'supplement-route-network-cache',
        floorZoneId: 'archive-alcove',
      }),
      moduleAnchor('discovery-frontline', 'spatial-role', 0, -2, {
        spatialRole: 'frontline',
        floorZoneId: 'discovery-floor',
      }),
      moduleAnchor('discovery-flank-left', 'spatial-role', -2, 2, {
        spatialRole: 'flank',
        floorZoneId: 'archive-alcove',
      }),
      moduleAnchor('discovery-flank-right', 'spatial-role', 2, 1, {
        spatialRole: 'flank',
        floorZoneId: 'discovery-floor',
      }),
      moduleAnchor('discovery-perch', 'spatial-role', 2, 2, {
        elevation: 0.7,
        spatialRole: 'perch',
        floorZoneId: 'observation-step',
        assemblyGroupId: 'route-model-observation',
      }),
    ],
  },
};

export const INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS =
  deepFreezeDungeonAugmentationValue(moduleManifests);
export const INDUSTRIAL_SUPPLEMENT_MODULE_CATALOG = INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS;
export const INDUSTRIAL_SUPPLEMENT_CONTENT_MODULES = INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS;
export const INDUSTRIAL_SUPPLEMENT_MODULE_IDS = Object.freeze(
  Object.keys(INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS),
);
export const INDUSTRIAL_SUPPLEMENT_MODULE_MANIFEST_LIST = Object.freeze(
  Object.values(INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS),
);

const MODULE_KIND_BY_CONTENT_ROLE = {
  challenge: 'challenge',
  encounter: 'challenge',
  hazard: 'hazard-control',
  trap: 'hazard-control',
  control: 'hazard-control',
  mechanism: 'hazard-control',
  terminal: 'hazard-control',
  elevation: 'vertical-maintenance',
  'vertical-maintenance': 'vertical-maintenance',
  reward: 'reward-vault',
  treasure: 'reward-vault',
  payoff: 'reward-vault',
  calm: 'calm-discovery',
  discovery: 'calm-discovery',
};

const DEFAULT_MODULE_KIND_BY_GRAMMAR_ID = {
  'supplement-hall-cluster-encounter-v1': 'challenge',
  'supplement-hall-cluster-reward-v1': 'reward-vault',
  'supplement-hall-cluster-terminal-v1': 'hazard-control',
};

function moduleManifestResolverContext(moduleIdOrContext, options) {
  let context;
  if (typeof moduleIdOrContext === 'string') {
    if (own(moduleManifests, moduleIdOrContext)) {
      context = { manifestId: moduleIdOrContext };
    } else if (own(DEFAULT_MODULE_KIND_BY_GRAMMAR_ID, moduleIdOrContext)) {
      context = { grammarId: moduleIdOrContext };
    } else {
      return null;
    }
  } else if (moduleIdOrContext
      && typeof moduleIdOrContext === 'object'
      && !Array.isArray(moduleIdOrContext)) {
    context = { ...moduleIdOrContext };
  } else {
    return null;
  }

  if (options !== undefined) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
    context = { ...context, ...options };
  }
  return context;
}

/**
 * Resolves a semantic manifest directly or from an accepted V4 room node.
 * Connector-owned infrastructure and incompatible grammar/role combinations
 * deliberately return null, so a compact junction cannot inherit room content.
 */
export function resolveIndustrialSupplementModuleManifest(moduleIdOrContext, options) {
  const context = moduleManifestResolverContext(moduleIdOrContext, options);
  if (!context) return null;

  const rawModuleKind = context.moduleKind;
  const semanticModuleKind = context.manifestId
    ?? context.moduleManifestId
    ?? context.semanticModuleKind
    ?? context.contentModuleKind
    ?? (typeof rawModuleKind === 'string' && own(moduleManifests, rawModuleKind)
      ? rawModuleKind
      : null);
  if (semanticModuleKind !== null
      && (typeof semanticModuleKind !== 'string' || !own(moduleManifests, semanticModuleKind))) {
    return null;
  }

  const physicalModuleKind = context.physicalModuleKind
    ?? (semanticModuleKind === rawModuleKind ? undefined : rawModuleKind);
  if (physicalModuleKind !== undefined && typeof physicalModuleKind !== 'string') return null;

  const grammarId = context.grammarId ?? context.grammar?.id;
  if (grammarId !== undefined
      && (typeof grammarId !== 'string' || !own(DEFAULT_MODULE_KIND_BY_GRAMMAR_ID, grammarId))) {
    return null;
  }

  const contentRole = context.contentRole;
  if (contentRole !== undefined
      && (typeof contentRole !== 'string' || !own(MODULE_KIND_BY_CONTENT_ROLE, contentRole))) {
    return null;
  }

  const moduleKind = semanticModuleKind
    ?? (contentRole === undefined ? null : MODULE_KIND_BY_CONTENT_ROLE[contentRole])
    ?? (grammarId === undefined ? null : DEFAULT_MODULE_KIND_BY_GRAMMAR_ID[grammarId]);
  if (!moduleKind || !own(moduleManifests, moduleKind)) return null;

  const manifest = moduleManifests[moduleKind];
  if (physicalModuleKind !== undefined
      && !manifest.compatibleModuleKinds.includes(physicalModuleKind)) {
    return null;
  }
  if (grammarId !== undefined && !manifest.compatibleGrammarIds.includes(grammarId)) return null;
  if (contentRole !== undefined && !manifest.contentRoles.includes(contentRole)) return null;
  return immutableClone(manifest);
}

export const getIndustrialSupplementModuleManifest =
  resolveIndustrialSupplementModuleManifest;
export const resolveIndustrialSupplementModuleManifestForNode =
  resolveIndustrialSupplementModuleManifest;

export const INDUSTRIAL_SUPPLEMENT_ENEMY_KEYS = Object.freeze([
  'basic',
  'fast',
  'ranged',
  'horokko',
]);

const ENEMY_THREAT_WEIGHTS = {
  basic: 1,
  fast: 2,
  ranged: 2,
  horokko: 3,
};

const TOPOLOGY_CLASS_BY_ID = {
  through: 'through',
  linear: 'through',
  'through-room': 'through',
  'through-gallery': 'through',
  'lateral-encounter-room': 'through',
  'lateral-reward-room': 'through',
  'parallel-gallery-loop': 'through',
  'multi-door-room-chain': 'through',

  junction: 'junction',
  'through-t': 'junction',
  'through-t-junction': 'junction',
  crossroads: 'junction',
  'crossroads-junction': 'junction',
  'staggered-cross': 'junction',
  'staggered-cross-junction': 'junction',
  'fork-merge': 'junction',
  'fork-merge-junction': 'junction',
  'fork-merge-h-loop': 'junction',
  'supplement-route-through-t-v1': 'junction',
  'supplement-route-crossroads-v1': 'junction',
  'supplement-route-staggered-cross-v1': 'junction',
  'supplement-route-fork-merge-v1': 'junction',
  'connector-through-t-junction': 'junction',
  'connector-crossroads-junction': 'junction',
  'connector-staggered-cross-junction': 'junction',
  'connector-fork-merge-junction': 'junction',

  vertical: 'vertical',
  'split-level-ring': 'vertical',
  'stacked-interchange': 'vertical',
  'stacked-interchange-junction': 'vertical',
  'over-under-crossover': 'vertical',
  'over-under-loop': 'vertical',
  'elevated-terminal-trap-room': 'vertical',
  'connector-stacked-interchange-junction': 'vertical',
  'connector-over-under-crossover': 'vertical',
  'supplement-route-stacked-interchange-v1': 'vertical',
  'supplement-route-over-under-v1': 'vertical',
};

export const INDUSTRIAL_SUPPLEMENT_TOPOLOGY_CLASSES = Object.freeze([
  'through',
  'junction',
  'vertical',
]);

export function resolveIndustrialSupplementTopologyClass(topologyId) {
  if (typeof topologyId !== 'string' || !own(TOPOLOGY_CLASS_BY_ID, topologyId)) return null;
  return TOPOLOGY_CLASS_BY_ID[topologyId];
}

const SPATIAL_BLUEPRINTS = {
  challenge: {
    through: [
      ['frontline', ['encounter-frontline'], ['combat-floor'], 'ground'],
      ['flank', ['encounter-flank-left', 'encounter-flank-right'], ['flank-lanes'], 'ground'],
      ['perch', ['encounter-perch'], ['perch-deck'], 'raised'],
    ],
    junction: [
      ['frontline', ['encounter-frontline'], ['combat-floor'], 'ground'],
      ['flank', ['encounter-flank-left'], ['flank-lanes'], 'ground'],
      ['flank', ['encounter-flank-right'], ['flank-lanes'], 'ground'],
      ['perch', ['encounter-perch'], ['perch-deck'], 'raised'],
    ],
    vertical: [
      ['frontline', ['encounter-frontline'], ['combat-floor'], 'ground'],
      ['perch', ['encounter-perch'], ['perch-deck'], 'raised'],
      ['flank', ['encounter-flank-left'], ['flank-lanes'], 'ground'],
      ['flank', ['encounter-flank-right'], ['flank-lanes'], 'ground'],
    ],
  },
  'hazard-control': {
    through: [
      ['frontline', ['hazard-frontline'], ['safe-approach'], 'ground'],
      ['flank', ['hazard-flank-left', 'hazard-flank-right'], ['bypass-lane'], 'safe-only'],
      ['perch', ['hazard-perch'], ['control-deck'], 'raised'],
    ],
    junction: [
      ['frontline', ['hazard-frontline'], ['safe-approach'], 'ground'],
      ['flank', ['hazard-flank-left'], ['bypass-lane'], 'safe-only'],
      ['flank', ['hazard-flank-right'], ['bypass-lane'], 'safe-only'],
      ['perch', ['hazard-perch'], ['control-deck'], 'raised'],
    ],
    vertical: [
      ['frontline', ['hazard-frontline'], ['safe-approach'], 'ground'],
      ['perch', ['hazard-perch'], ['control-deck'], 'raised'],
      ['flank', ['hazard-flank-left', 'hazard-flank-right'], ['bypass-lane'], 'safe-only'],
      ['perch', ['hazard-perch'], ['control-deck'], 'raised'],
    ],
  },
  'vertical-maintenance': {
    through: [
      ['frontline', ['maintenance-frontline'], ['lower-deck'], 'lower'],
      ['flank', ['maintenance-flank-left', 'maintenance-flank-right'], ['maintenance-landings'], 'middle'],
      ['perch', ['maintenance-perch'], ['upper-catwalk'], 'upper'],
    ],
    junction: [
      ['frontline', ['maintenance-frontline'], ['lower-deck'], 'lower'],
      ['flank', ['maintenance-flank-left'], ['maintenance-landings'], 'middle'],
      ['flank', ['maintenance-flank-right'], ['maintenance-landings'], 'middle'],
      ['perch', ['maintenance-perch'], ['upper-catwalk'], 'upper'],
    ],
    vertical: [
      ['frontline', ['maintenance-frontline'], ['lower-deck'], 'lower'],
      ['perch', ['maintenance-perch'], ['upper-catwalk'], 'upper'],
      ['flank', ['maintenance-flank-left'], ['maintenance-landings'], 'middle'],
      ['flank', ['maintenance-flank-right'], ['maintenance-landings'], 'middle'],
    ],
  },
  'reward-vault': {
    through: [
      ['frontline', ['vault-frontline'], ['vault-threshold'], 'ground'],
      ['flank', ['vault-flank-left', 'vault-flank-right'], ['vault-floor'], 'ground'],
      ['perch', ['vault-perch'], ['keeper-perch'], 'raised'],
    ],
    junction: [
      ['frontline', ['vault-frontline'], ['vault-threshold'], 'ground'],
      ['flank', ['vault-flank-left'], ['vault-floor'], 'ground'],
      ['flank', ['vault-flank-right'], ['vault-floor'], 'ground'],
      ['perch', ['vault-perch'], ['keeper-perch'], 'raised'],
    ],
    vertical: [
      ['frontline', ['vault-frontline'], ['vault-threshold'], 'ground'],
      ['perch', ['vault-perch'], ['keeper-perch'], 'raised'],
      ['flank', ['vault-flank-left'], ['vault-floor'], 'ground'],
      ['flank', ['vault-flank-right'], ['vault-floor'], 'ground'],
    ],
  },
  'calm-discovery': {
    through: [
      ['frontline', ['discovery-frontline'], ['discovery-floor'], 'ground'],
      ['flank', ['discovery-flank-left', 'discovery-flank-right'], ['archive-alcove', 'discovery-floor'], 'ground'],
      ['perch', ['discovery-perch'], ['observation-step'], 'raised'],
    ],
    junction: [
      ['frontline', ['discovery-frontline'], ['discovery-floor'], 'ground'],
      ['flank', ['discovery-flank-left'], ['archive-alcove'], 'ground'],
      ['flank', ['discovery-flank-right'], ['discovery-floor'], 'ground'],
      ['perch', ['discovery-perch'], ['observation-step'], 'raised'],
    ],
    vertical: [
      ['frontline', ['discovery-frontline'], ['discovery-floor'], 'ground'],
      ['perch', ['discovery-perch'], ['observation-step'], 'raised'],
      ['flank', ['discovery-flank-left'], ['archive-alcove'], 'ground'],
      ['flank', ['discovery-flank-right'], ['discovery-floor'], 'ground'],
    ],
  },
};

const ROUTE_NETWORK_COMPOSITIONS = {
  challenge: {
    through: ['basic', 'fast', 'ranged'],
    junction: ['basic', 'fast', 'ranged', 'basic'],
    vertical: ['basic', 'ranged', 'horokko', 'fast'],
  },
  'hazard-control': {
    through: ['basic', 'ranged', 'fast'],
    junction: ['basic', 'ranged', 'fast', 'ranged'],
    vertical: ['basic', 'ranged', 'horokko'],
  },
  'vertical-maintenance': {
    through: ['fast', 'basic', 'ranged'],
    junction: ['fast', 'basic', 'ranged', 'fast'],
    vertical: ['fast', 'ranged', 'horokko', 'basic'],
  },
  'reward-vault': {
    through: ['basic', 'basic', 'ranged'],
    junction: ['basic', 'fast', 'ranged', 'basic'],
    vertical: ['basic', 'ranged', 'horokko'],
  },
  'calm-discovery': {
    through: ['basic'],
    junction: ['basic', 'ranged'],
    vertical: ['basic', 'ranged'],
  },
};

const LATERAL_DEFENSE_COMPOSITIONS = {
  challenge: {
    through: ['basic', 'fast'],
    junction: ['basic', 'fast', 'ranged'],
    vertical: ['basic', 'ranged', 'horokko'],
  },
  'hazard-control': {
    through: ['basic', 'ranged'],
    junction: ['basic', 'fast', 'ranged'],
    vertical: ['basic', 'ranged', 'horokko'],
  },
  'vertical-maintenance': {
    through: ['fast', 'ranged'],
    junction: ['fast', 'basic', 'ranged'],
    vertical: ['fast', 'ranged', 'horokko'],
  },
  'reward-vault': {
    through: ['basic', 'ranged'],
    junction: ['basic', 'fast', 'ranged'],
    vertical: ['basic', 'ranged', 'horokko'],
  },
  'calm-discovery': {
    through: ['basic'],
    junction: ['basic'],
    vertical: ['basic', 'ranged'],
  },
};

function threatLabel(budget) {
  if (budget <= 2) return 'low';
  if (budget <= 5) return 'moderate';
  if (budget <= 7) return 'high';
  return 'severe';
}

function encounterHazardInteraction(moduleKind) {
  if (moduleKind === 'hazard-control') {
    return {
      mode: 'controlled-local-hazard',
      hazardProfileIds: [
        'supplement-route-network-floor-trap',
        'supplement-terminal-pulse-field',
      ],
      controlMechanismProfileId: 'supplement-route-network-control',
      excludedSpawnFloorZoneIds: ['hazard-field'],
      safeSpawnFloorZoneIds: ['safe-approach', 'bypass-lane', 'control-deck'],
      stateDuringEncounter: 'armed',
      stateAfterClear: 'isolated',
    };
  }
  return {
    mode: 'none',
    hazardProfileIds: [],
    controlMechanismProfileId: null,
    excludedSpawnFloorZoneIds: [],
    safeSpawnFloorZoneIds: [],
    stateDuringEncounter: 'unchanged',
    stateAfterClear: 'unchanged',
  };
}

function buildEncounterVariant(moduleKind, topologyClass, roster) {
  const blueprint = SPATIAL_BLUEPRINTS[moduleKind][topologyClass];
  const spatialRoles = roster.map((enemyKey, index) => {
    const [role, anchorIds, validFloorZoneIds, floorPolicy] =
      blueprint[index % blueprint.length];
    return {
      id: `${role}-${index + 1}`,
      enemyKey,
      role,
      anchorIds: [...anchorIds],
      validFloorZoneIds: [...validFloorZoneIds],
      validFloors: [...validFloorZoneIds],
      floorPolicy,
    };
  });
  const budget = roster.reduce((sum, enemyKey) => sum + ENEMY_THREAT_WEIGHTS[enemyKey], 0);
  const composition = Object.fromEntries(
    INDUSTRIAL_SUPPLEMENT_ENEMY_KEYS
      .map((enemyKey) => [enemyKey, roster.filter((entry) => entry === enemyKey).length])
      .filter(([, count]) => count > 0),
  );
  const difficultyScaling = {
    mode: 'deterministic-tier-curve',
    minimumDifficulty: 1,
    maximumDifficulty: 8,
    rosterPolicy: 'fixed-authored-roster',
    baseThreatBudget: budget,
    threatBudgetPerTier: 1,
    healthMultiplierPerTier: 0.08,
    damageMultiplierPerTier: 0.05,
  };
  const hazardInteraction = encounterHazardInteraction(moduleKind);
  const clearState = {
    initialState: 'engaged',
    completeState: 'cleared',
    completionRule: 'defeat-required-spawn-slots',
    requiredSpatialRoleIds: spatialRoles.map(({ id }) => id),
    unlockSocketIds: ['entry', 'exit'],
    persistsWithinOperation: true,
    resetPolicy: 'never-after-clear',
    onClear: moduleKind === 'hazard-control'
      ? [{ kind: 'set-local-hazard-state', state: 'isolated' }]
      : [],
  };
  return {
    topologyClass,
    roster: [...roster],
    threat: {
      budget,
      rating: threatLabel(budget),
      maxSimultaneous: roster.length,
      composition,
      enemyWeights: { ...ENEMY_THREAT_WEIGHTS },
    },
    spatialRoles,
    validFloorZoneIds: [...new Set(spatialRoles.flatMap(({ validFloorZoneIds }) => (
      validFloorZoneIds
    )))],
    difficultyScaling,
    hazardInteraction,
    clearState,
  };
}

function buildEncounterProfile(encounterProfileId, purpose, compositions) {
  const moduleRecipes = Object.fromEntries(
    Object.entries(compositions).map(([moduleKind, topologyCompositions]) => {
      const manifest = moduleManifests[moduleKind];
      const topologies = Object.fromEntries(
        Object.entries(topologyCompositions).map(([topologyClass, roster]) => [
          topologyClass,
          buildEncounterVariant(moduleKind, topologyClass, roster),
        ]),
      );
      return [moduleKind, {
        moduleKind,
        contentRoles: [...manifest.contentRoles],
        defaultContentRole: manifest.defaultContentRole,
        defaultTopologyClass: manifest.layout.defaultTopologyClass,
        topologies,
      }];
    }),
  );
  return {
    schema: INDUSTRIAL_SUPPLEMENT_ENCOUNTER_RECIPE_SCHEMA,
    id: encounterProfileId,
    encounterProfileId,
    profileId: V4_PROFILE_ID,
    purpose,
    deterministic: true,
    enemyKeys: [...INDUSTRIAL_SUPPLEMENT_ENEMY_KEYS],
    defaultModuleKind: 'challenge',
    moduleRecipes,
  };
}

export const INDUSTRIAL_SUPPLEMENT_ENCOUNTER_RECIPES =
  deepFreezeDungeonAugmentationValue({
    'supplement-route-network-defense': buildEncounterProfile(
      'supplement-route-network-defense',
      'Defend a meaningful V4 route station while preserving every active exit and safe floor.',
      ROUTE_NETWORK_COMPOSITIONS,
    ),
    'supplement-lateral-defense': buildEncounterProfile(
      'supplement-lateral-defense',
      'A shorter side-room defense with fewer simultaneous threats and an immediate return path.',
      LATERAL_DEFENSE_COMPOSITIONS,
    ),
  });

export const INDUSTRIAL_SUPPLEMENT_ENCOUNTER_RECIPE_CATALOG =
  INDUSTRIAL_SUPPLEMENT_ENCOUNTER_RECIPES;
export const INDUSTRIAL_SUPPLEMENT_ENCOUNTER_PROFILE_IDS = Object.freeze(
  Object.keys(INDUSTRIAL_SUPPLEMENT_ENCOUNTER_RECIPES),
);
export const INDUSTRIAL_SUPPLEMENT_ENCOUNTER_RECIPE_LIST = Object.freeze(
  Object.values(INDUSTRIAL_SUPPLEMENT_ENCOUNTER_RECIPES),
);

function encounterResolverOptions(options) {
  if (options === undefined || options === null) return {};
  if (typeof options === 'string') {
    return own(moduleManifests, options) ? { moduleKind: options } : { topology: options };
  }
  if (typeof options !== 'object' || Array.isArray(options)) return null;
  return options;
}

/**
 * Resolves one deterministic encounter composition for the physical context.
 * Explicit unknown profile, module, role, or topology identifiers return null.
 */
export function resolveIndustrialSupplementEncounterRecipe(
  encounterProfileId,
  options,
) {
  if (typeof encounterProfileId !== 'string'
      || !own(INDUSTRIAL_SUPPLEMENT_ENCOUNTER_RECIPES, encounterProfileId)) {
    return null;
  }
  const resolvedOptions = encounterResolverOptions(options);
  if (!resolvedOptions) return null;

  const requestedContentRole = resolvedOptions.contentRole;
  if (requestedContentRole !== undefined
      && (typeof requestedContentRole !== 'string'
        || !own(MODULE_KIND_BY_CONTENT_ROLE, requestedContentRole))) {
    return null;
  }

  const rawModuleKind = resolvedOptions.moduleKind;
  const requestedModuleKind = resolvedOptions.moduleManifestId
    ?? resolvedOptions.semanticModuleKind
    ?? resolvedOptions.contentModuleKind
    ?? (typeof rawModuleKind === 'string' && own(moduleManifests, rawModuleKind)
      ? rawModuleKind
      : null);
  if (requestedModuleKind !== null
      && (typeof requestedModuleKind !== 'string' || !own(moduleManifests, requestedModuleKind))) {
    return null;
  }
  const physicalModuleKind = resolvedOptions.physicalModuleKind
    ?? (requestedModuleKind === rawModuleKind ? undefined : rawModuleKind);
  if (physicalModuleKind !== undefined && typeof physicalModuleKind !== 'string') return null;

  const grammarId = resolvedOptions.grammarId ?? resolvedOptions.grammar?.id;
  if (grammarId !== undefined
      && (typeof grammarId !== 'string' || !own(DEFAULT_MODULE_KIND_BY_GRAMMAR_ID, grammarId))) {
    return null;
  }
  const inferredModuleKind = requestedContentRole === undefined
    ? null
    : MODULE_KIND_BY_CONTENT_ROLE[requestedContentRole];
  const moduleKind = requestedModuleKind
    ?? inferredModuleKind
    ?? (grammarId === undefined ? null : DEFAULT_MODULE_KIND_BY_GRAMMAR_ID[grammarId])
    ?? INDUSTRIAL_SUPPLEMENT_ENCOUNTER_RECIPES[encounterProfileId].defaultModuleKind;
  if (typeof moduleKind !== 'string' || !own(moduleManifests, moduleKind)) return null;

  const manifest = moduleManifests[moduleKind];
  const contentRole = requestedContentRole ?? manifest.defaultContentRole;
  if (!resolveIndustrialSupplementModuleManifest({
    manifestId: moduleKind,
    physicalModuleKind,
    grammarId,
    contentRole,
  })) return null;

  const topologyCandidate = resolvedOptions.topology
    ?? resolvedOptions.topologyId
    ?? resolvedOptions.topologyKind
    ?? resolvedOptions.junctionKind
    ?? resolvedOptions.topologyTemplateId;
  const topologyId = topologyCandidate ?? manifest.layout.defaultTopologyClass;
  const topologyClass = resolveIndustrialSupplementTopologyClass(topologyId);
  if (!topologyClass) return null;

  const profile = INDUSTRIAL_SUPPLEMENT_ENCOUNTER_RECIPES[encounterProfileId];
  const moduleRecipe = profile.moduleRecipes[moduleKind];
  const variant = moduleRecipe?.topologies?.[topologyClass];
  if (!variant) return null;

  const difficultyInput = resolvedOptions.difficulty
    ?? resolvedOptions.difficultyTier
    ?? resolvedOptions.threatTier
    ?? 1;
  const numericDifficulty = Number(difficultyInput);
  if (!Number.isFinite(numericDifficulty) || numericDifficulty < 1) return null;
  const resolvedDifficulty = Math.max(
    variant.difficultyScaling.minimumDifficulty,
    Math.min(
      variant.difficultyScaling.maximumDifficulty,
      Math.trunc(numericDifficulty),
    ),
  );
  const extraDifficultyTiers = resolvedDifficulty
    - variant.difficultyScaling.minimumDifficulty;
  const scaledThreatBudget = variant.difficultyScaling.baseThreatBudget
    + extraDifficultyTiers * variant.difficultyScaling.threatBudgetPerTier;
  const difficultyScaling = {
    ...variant.difficultyScaling,
    requestedDifficulty: numericDifficulty,
    resolvedDifficulty,
    scaledThreatBudget,
    healthMultiplier: Number((
      1 + extraDifficultyTiers * variant.difficultyScaling.healthMultiplierPerTier
    ).toFixed(3)),
    damageMultiplier: Number((
      1 + extraDifficultyTiers * variant.difficultyScaling.damageMultiplierPerTier
    ).toFixed(3)),
  };
  const recipeId = `${encounterProfileId}:${moduleKind}:${contentRole}:${topologyClass}`;

  return immutableClone({
    schema: INDUSTRIAL_SUPPLEMENT_ENCOUNTER_RECIPE_SCHEMA,
    id: recipeId,
    encounterProfileId,
    profileId: V4_PROFILE_ID,
    moduleKind,
    moduleManifestId: moduleKind,
    physicalModuleKind: physicalModuleKind ?? 'room',
    grammarId: grammarId ?? manifest.compatibleGrammarIds[0],
    contentRole,
    requestedTopologyId: topologyId,
    topologyClass,
    deterministic: true,
    roster: variant.roster,
    threat: {
      ...variant.threat,
      baseBudget: variant.threat.budget,
      scaledBudget: scaledThreatBudget,
      resolvedDifficulty,
    },
    spatialRoles: variant.spatialRoles,
    validFloorZoneIds: variant.validFloorZoneIds,
    difficultyScaling,
    hazardInteraction: variant.hazardInteraction,
    clearState: {
      ...variant.clearState,
      id: `${recipeId}:clear-state`,
    },
  });
}

export const getIndustrialSupplementEncounterRecipe =
  resolveIndustrialSupplementEncounterRecipe;

export const INDUSTRIAL_SUPPLEMENT_REWARD_RECIPES =
  deepFreezeDungeonAugmentationValue({
    'supplement-route-network-cache': {
      schema: INDUSTRIAL_SUPPLEMENT_REWARD_RECIPE_SCHEMA,
      id: 'supplement-route-network-cache',
      rewardProfileId: 'supplement-route-network-cache',
      profileId: V4_PROFILE_ID,
      purpose: 'A modest route cache that rewards observation without replacing a vault payoff.',
      progressionCritical: false,
      collectibleSafety: {
        requiresReachableFloor: true,
        requiresReturnPath: true,
        mayGrantCredential: false,
        mayUnlockAuthoredProgression: false,
      },
      moduleKinds: ['reward-vault', 'calm-discovery'],
      placement: {
        anchorKind: 'reward',
        requiredFloorZoneIds: ['vault-floor', 'archive-alcove'],
        visibleFromCriticalRoute: true,
      },
      delivery: {
        kind: 'industrial-chest',
        chestCount: 1,
        rareBoost: false,
        rewardTags: ['zenny-cache', 'reaverbot-salvage'],
      },
      pacing: 'optional-discovery',
    },
    'supplement-treasure-cache': {
      schema: INDUSTRIAL_SUPPLEMENT_REWARD_RECIPE_SCHEMA,
      id: 'supplement-treasure-cache',
      rewardProfileId: 'supplement-treasure-cache',
      profileId: V4_PROFILE_ID,
      purpose: 'The clear material payoff for completing a defended side route.',
      progressionCritical: false,
      collectibleSafety: {
        requiresReachableFloor: true,
        requiresReturnPath: true,
        mayGrantCredential: false,
        mayUnlockAuthoredProgression: false,
      },
      moduleKinds: ['reward-vault'],
      placement: {
        anchorKind: 'reward',
        requiredFloorZoneIds: ['vault-floor'],
        requiredLandmarkId: 'reward-dais',
        visibleFromCriticalRoute: true,
      },
      delivery: {
        kind: 'industrial-chest',
        chestCount: 1,
        rareBoost: true,
        rewardTags: ['zenny-cache', 'reaverbot-salvage', 'rare-parts'],
      },
      pacing: 'route-payoff',
    },
  });

export const INDUSTRIAL_SUPPLEMENT_REWARD_RECIPE_CATALOG =
  INDUSTRIAL_SUPPLEMENT_REWARD_RECIPES;
export const INDUSTRIAL_SUPPLEMENT_REWARD_PROFILE_IDS = Object.freeze(
  Object.keys(INDUSTRIAL_SUPPLEMENT_REWARD_RECIPES),
);
export const INDUSTRIAL_SUPPLEMENT_REWARD_RECIPE_LIST = Object.freeze(
  Object.values(INDUSTRIAL_SUPPLEMENT_REWARD_RECIPES),
);

export function resolveIndustrialSupplementRewardRecipe(rewardProfileId) {
  return resolveCatalogEntry(INDUSTRIAL_SUPPLEMENT_REWARD_RECIPES, rewardProfileId);
}

export const getIndustrialSupplementRewardRecipe =
  resolveIndustrialSupplementRewardRecipe;

export const INDUSTRIAL_SUPPLEMENT_MECHANISM_RECIPES =
  deepFreezeDungeonAugmentationValue({
    'supplement-route-network-control': {
      schema: INDUSTRIAL_SUPPLEMENT_MECHANISM_RECIPE_SCHEMA,
      id: 'supplement-route-network-control',
      mechanismProfileId: 'supplement-route-network-control',
      profileId: V4_PROFILE_ID,
      purpose: 'A local, reversible-to-plan control that changes only its owning supplement room.',
      moduleKinds: ['hazard-control', 'vertical-maintenance'],
      interaction: {
        anchorKind: 'progression',
        controlKind: 'industrial-terminal',
        repeatable: false,
        requiresReachableFloor: true,
      },
      stateMachine: {
        initialState: 'armed',
        states: ['armed', 'isolated'],
        transition: { from: 'armed', action: 'activate', to: 'isolated' },
      },
      effects: [
        {
          kind: 'disable-local-hazard',
          targetProfileIds: [
            'supplement-route-network-floor-trap',
            'supplement-terminal-pulse-field',
          ],
          scope: 'owning-module',
        },
        {
          kind: 'mark-safe-shortcut',
          targetFloorZoneIds: ['hazard-field'],
          scope: 'owning-module',
        },
      ],
    },
  });

export const INDUSTRIAL_SUPPLEMENT_MECHANISM_RECIPE_CATALOG =
  INDUSTRIAL_SUPPLEMENT_MECHANISM_RECIPES;
export const INDUSTRIAL_SUPPLEMENT_MECHANISM_PROFILE_IDS = Object.freeze(
  Object.keys(INDUSTRIAL_SUPPLEMENT_MECHANISM_RECIPES),
);
export const INDUSTRIAL_SUPPLEMENT_MECHANISM_RECIPE_LIST = Object.freeze(
  Object.values(INDUSTRIAL_SUPPLEMENT_MECHANISM_RECIPES),
);

export function resolveIndustrialSupplementMechanismRecipe(mechanismProfileId) {
  return resolveCatalogEntry(INDUSTRIAL_SUPPLEMENT_MECHANISM_RECIPES, mechanismProfileId);
}

export const getIndustrialSupplementMechanismRecipe =
  resolveIndustrialSupplementMechanismRecipe;

export const INDUSTRIAL_SUPPLEMENT_HAZARD_RECIPES =
  deepFreezeDungeonAugmentationValue({
    'supplement-route-network-floor-trap': {
      schema: INDUSTRIAL_SUPPLEMENT_MECHANISM_RECIPE_SCHEMA,
      id: 'supplement-route-network-floor-trap',
      hazardProfileId: 'supplement-route-network-floor-trap',
      profileId: V4_PROFILE_ID,
      moduleKinds: ['hazard-control'],
      behavior: 'telegraphed-floor-pulse',
      validFloorZoneIds: ['hazard-field'],
      safeFloorZoneIds: ['safe-approach', 'bypass-lane', 'control-deck'],
      controlledByMechanismProfileId: 'supplement-route-network-control',
      failSafe: 'Never activate outside the declared hazard floor zone.',
    },
    'supplement-terminal-pulse-field': {
      schema: INDUSTRIAL_SUPPLEMENT_MECHANISM_RECIPE_SCHEMA,
      id: 'supplement-terminal-pulse-field',
      hazardProfileId: 'supplement-terminal-pulse-field',
      profileId: V4_PROFILE_ID,
      moduleKinds: ['hazard-control'],
      behavior: 'interval-terminal-pulse',
      validFloorZoneIds: ['hazard-field'],
      safeFloorZoneIds: ['safe-approach', 'control-deck'],
      controlledByMechanismProfileId: 'supplement-route-network-control',
      failSafe: 'A complete telegraph must finish before each damaging pulse.',
    },
  });

export const INDUSTRIAL_SUPPLEMENT_HAZARD_RECIPE_CATALOG =
  INDUSTRIAL_SUPPLEMENT_HAZARD_RECIPES;
export const INDUSTRIAL_SUPPLEMENT_HAZARD_PROFILE_IDS = Object.freeze(
  Object.keys(INDUSTRIAL_SUPPLEMENT_HAZARD_RECIPES),
);

export function resolveIndustrialSupplementHazardRecipe(hazardProfileId) {
  return resolveCatalogEntry(INDUSTRIAL_SUPPLEMENT_HAZARD_RECIPES, hazardProfileId);
}

export const getIndustrialSupplementHazardRecipe =
  resolveIndustrialSupplementHazardRecipe;
