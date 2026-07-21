import {
  clonePlanData,
  createDungeonModuleDescriptorV2,
  deepFreezePlan,
} from './DungeonPlanV2Contract.js';
import { normalizeYawQuarterTurns } from './DungeonSpatialMathV2.js';

// This catalog is an extraction boundary, not a second runtime generator.
// It records the useful authored language from DungeonGenerator.js as plain
// data so a V2 plan can own placement, collision, traversal, and enclosure.
// In particular, no entry imports THREE, scans mesh names for behavior, or
// reaches back into the legacy generator at runtime.

export const LEGACY_AUTHORED_MODULE_KIT_REVISION_V2 = 1;

export const LEGACY_AUTHORED_ASSET_FAMILY_IDS_V2 = Object.freeze([
  'v1.security-checkpoint',
  'v1.factory-assembly',
  'v1.server-crypt',
  'v1.freight-recovery',
  'v1.factory-conveyor',
  'v1.credential-pyramid',
  'v1.parts-warehouse',
  'v1.nest-warehouse',
  'v1.machine-platforms',
  'v1.machine-core',
  'v1.refractor-shrine',
  'v1.coolant-relay',
  'v1.coolant-control',
  'v1.coolant-conveyor',
  'v1.salvage-service',
  'v1.reactor-supports',
  'v1.reactor-machine',
]);

const RUIN_TEXTURE_ROOT = '/assets/textures/ruins/';
const RUIN_ROOM_MODEL_ROOT = '/assets/models/rooms/';

const textureAsset = (id, fileName) => ({
  id,
  kind: 'texture-2d',
  url: `${RUIN_TEXTURE_ROOT}${fileName}`,
  colorSpace: 'srgb',
  wrap: 'repeat',
});

const roomAsset = (id, fileName, footprint, sourceFunctions, presentationNodePolicy = {}) => ({
  id,
  kind: 'gltf',
  url: `${RUIN_ROOM_MODEL_ROOT}${fileName}`,
  footprint,
  sourceStatus: 'present-but-disabled-in-v1',
  sourceFunctions,
  collisionAuthority: 'descriptor-fixture-bounds',
  presentationNodePolicy: {
    hideLegacyRoomShell: true,
    ...presentationNodePolicy,
  },
  mergePolicy: {
    strategy: 'merge-static-geometry-by-compatible-vertex-layout',
    preserveVertexColors: true,
    targetDrawCalls: 3,
    rawMeshDrawsForbidden: true,
  },
});

export const LEGACY_AUTHORED_ASSET_CATALOG_V2 = deepFreezePlan({
  textures: {
    floorPlain: textureAsset('ruin-floor-plain', 'floor_plain.png'),
    floorPanel: textureAsset('ruin-floor-panel', 'floor_panel.png'),
    floorCircuit: textureAsset('ruin-floor-circuit', 'floor_circuit.png'),
    floorCrossPanel: textureAsset('ruin-floor-cross-panel', 'floor_cross_panel.png'),
    floorOctagon: textureAsset('ruin-floor-octagon', 'floor_octagon.png'),
    floorShrine: textureAsset('ruin-floor-shrine', 'floor_shrine.png'),
    floorCracked: textureAsset('ruin-floor-cracked', 'floor_cracked.png'),
    conveyor: textureAsset('ruin-special-conveyor', 'special_conveyor.png'),
    terminal: textureAsset('ruin-terminal-mechanism', 'terminal_mechanism.png'),
    ceiling: textureAsset('ruin-ceiling-panel', 'ceiling_panel.png'),
    doorFrame: textureAsset('ruin-door-frame', 'door_frame.png'),
    doorKeycard: textureAsset('ruin-door-keycard', 'door_keycard.png'),
    doorSealed: textureAsset('ruin-door-sealed', 'door_sealed.png'),
    wallIndustrialAtlas: textureAsset('ruin-wall-industrial-atlas', 'wall_macro_industrial.png'),
    accentConduit: textureAsset('ruin-accent-conduit', 'accent_conduit.png'),
    accentGlyph: textureAsset('ruin-accent-glyph', 'accent_glyph.png'),
    accentHatch: textureAsset('ruin-accent-hatch', 'accent_hatch.png'),
    accentRecessed: textureAsset('ruin-accent-recessed', 'accent_recessed.png'),
    accentSensor: textureAsset('ruin-accent-sensor', 'accent_sensor.png'),
    accentSlate: textureAsset('ruin-accent-slate', 'accent_slate.png'),
    accentShrine: textureAsset('ruin-accent-small-shrine', 'accent_small_shrine.png'),
    accentVent: textureAsset('ruin-accent-vent', 'accent_vent.png'),
    accentWiring: textureAsset('ruin-accent-wiring', 'accent_wiring.png'),
  },
  rooms: {
    alienServer: roomAsset(
      'legacy-alien-server-room',
      'alien_server_room_example.glb',
      { width: 24, depth: 18 },
      ['_loadAlienServerRoomModel', '_stripImportedRoomShell'],
    ),
    machineFactory: roomAsset(
      'legacy-machine-factory-room',
      'industrial_machine_factory_room.glb',
      { width: 30, depth: 22 },
      ['_loadMachineFactoryRoomModel', '_stripImportedRoomShell'],
    ),
    coolantRelay: roomAsset(
      'legacy-coolant-relay-room',
      'industrial_coolant_relay_puzzle_room.glb',
      { width: 30, depth: 24 },
      ['_loadCoolantRelayRoomModel', '_stripImportedRoomShell', '_stripCoolantImportedLooseDecor'],
      {
        hideLooseDetailTokens: ['cable', 'pipe', 'conduit', 'rail', 'grate', 'arrow', 'mote'],
      },
    ),
  },
  contracts: {
    coolantPuzzle: {
      id: 'legacy-coolant-relay-puzzle-config',
      kind: 'json',
      url: `${RUIN_ROOM_MODEL_ROOT}coolant_relay_puzzle_config.json`,
    },
    coolantManifest: {
      id: 'legacy-coolant-relay-room-manifest',
      kind: 'json',
      url: `${RUIN_ROOM_MODEL_ROOT}industrial_coolant_relay_puzzle_room_manifest.json`,
    },
  },
});

const materialProfile = (id, textureAssetId, properties = {}) => ({
  id,
  textureAssetId,
  ...properties,
});

export const LEGACY_RUIN_MATERIAL_PROFILES_V2 = deepFreezePlan({
  wallIndustrial: materialProfile('legacy-wall-industrial', 'ruin-wall-industrial-atlas', {
    roughness: 0.78,
    metalness: 0.06,
    textureSelectionPolicy: 'atlas-only',
  }),
  ceiling: materialProfile('legacy-ceiling', 'ruin-ceiling-panel', { roughness: 0.84, metalness: 0.04 }),
  floor: materialProfile('legacy-floor', 'ruin-floor-plain', { roughness: 0.86, metalness: 0.04 }),
  crackedFloor: materialProfile('legacy-floor-cracked', 'ruin-floor-cracked', {
    color: 0x7d838b,
    emissive: 0x05080c,
    emissiveIntensity: 0.08,
    roughness: 0.88,
    metalness: 0.06,
  }),
  octagonFloor: materialProfile('legacy-floor-octagon', 'ruin-floor-octagon', {
    color: 0xf4ebd6,
    emissive: 0x052326,
    emissiveIntensity: 0.1,
    roughness: 0.7,
    metalness: 0.1,
  }),
  catwalk: materialProfile('legacy-catwalk', 'ruin-floor-panel', {
    color: 0xd9dde6,
    emissive: 0x051f28,
    emissiveIntensity: 0.12,
    roughness: 0.66,
    metalness: 0.18,
  }),
  raisedDeck: materialProfile('legacy-raised-deck', 'ruin-floor-cross-panel', {
    color: 0xd6dbe4,
    emissive: 0x062326,
    emissiveIntensity: 0.1,
    roughness: 0.68,
    metalness: 0.14,
  }),
  serverFloor: materialProfile('legacy-server-floor', 'ruin-floor-circuit', {
    color: 0xbad2d7,
    emissive: 0x04464d,
    emissiveIntensity: 0.22,
    roughness: 0.58,
    metalness: 0.24,
  }),
  machineFloor: materialProfile('legacy-machine-floor', 'ruin-floor-panel', {
    color: 0xc2c8d0,
    emissive: 0x05232c,
    emissiveIntensity: 0.16,
    roughness: 0.58,
    metalness: 0.28,
  }),
  coolantFloor: materialProfile('legacy-coolant-floor', 'ruin-floor-circuit', {
    color: 0xb9c8ce,
    emissive: 0x073440,
    emissiveIntensity: 0.22,
    roughness: 0.54,
    metalness: 0.24,
  }),
  conveyor: materialProfile('legacy-conveyor', 'ruin-special-conveyor', {
    emissive: 0x052d32,
    emissiveIntensity: 0.16,
    roughness: 0.6,
    metalness: 0.22,
  }),
  shrine: materialProfile('legacy-shrine', 'ruin-floor-shrine', {
    color: 0xf1ead9,
    emissive: 0x052326,
    emissiveIntensity: 0.14,
    roughness: 0.68,
    metalness: 0.12,
  }),
  keycard: materialProfile('legacy-keycard', 'ruin-door-keycard', {
    color: 0xf1ead9,
    emissive: 0x241500,
    emissiveIntensity: 0.12,
    roughness: 0.72,
    metalness: 0.08,
  }),
  terminal: materialProfile('legacy-terminal', 'ruin-terminal-mechanism', {
    color: 0xf1ead8,
    emissive: 0x04282c,
    emissiveIntensity: 0.12,
    roughness: 0.5,
    metalness: 0.16,
  }),
  support: materialProfile('legacy-support', null, {
    color: 0x33404a,
    emissive: 0x061016,
    emissiveIntensity: 0.16,
    roughness: 0.54,
    metalness: 0.32,
  }),
  rail: materialProfile('legacy-rail', null, {
    color: 0x5a6872,
    emissive: 0x08212a,
    emissiveIntensity: 0.18,
    roughness: 0.48,
    metalness: 0.28,
  }),
  hazardStripe: materialProfile('legacy-hazard-stripe', null, {
    color: 0xffc44f,
    emissive: 0x432000,
    emissiveIntensity: 0.28,
    roughness: 0.44,
    metalness: 0.14,
  }),
  glowBlue: materialProfile('legacy-glow-blue', null, {
    color: 0x6bdcff,
    emissive: 0x2fbfff,
    emissiveIntensity: 1.1,
    roughness: 0.28,
    metalness: 0.08,
  }),
  glowYellow: materialProfile('legacy-glow-yellow', null, {
    color: 0xffd66b,
    emissive: 0xffa51f,
    emissiveIntensity: 0.85,
    roughness: 0.34,
    metalness: 0.08,
  }),
  glowRed: materialProfile('legacy-glow-red', null, {
    color: 0xff645d,
    emissive: 0xff1f1f,
    emissiveIntensity: 0.78,
    roughness: 0.36,
    metalness: 0.04,
  }),
  glowGreen: materialProfile('legacy-glow-green', null, {
    color: 0x5ee77b,
    emissive: 0x22d65a,
    emissiveIntensity: 0.92,
    roughness: 0.34,
    metalness: 0.06,
  }),
  glowViolet: materialProfile('legacy-glow-violet', null, {
    color: 0xa06cff,
    emissive: 0x7d43ff,
    emissiveIntensity: 0.92,
    roughness: 0.34,
    metalness: 0.06,
  }),
  refractor: materialProfile('legacy-large-refractor', null, {
    color: 0x7df8ff,
    emissive: 0x28e8ff,
    emissiveIntensity: 1.35,
    roughness: 0.18,
    metalness: 0.04,
    transparent: true,
    opacity: 0.86,
  }),
});

const prefabPrimitive = (id, shape, center, dimensions, materialProfileId, options = {}) => ({
  id,
  shape,
  center,
  dimensions,
  materialProfileId,
  static: true,
  castShadow: options.castShadow ?? true,
  receiveShadow: options.receiveShadow ?? true,
  ...options,
});

// Small code-native recipes retain V1's geometry language while permitting
// the V2 assembler to instance or merge by (shape, materialProfileId). They do
// not define collision; each module instance carries an explicit fixture box.
export const LEGACY_CODE_NATIVE_PREFABS_V2 = deepFreezePlan({
  serverMonolith: {
    id: 'legacy-server-monolith',
    sourceFunction: '_addIndustrialRoomSetpieces',
    primitives: [
      prefabPrimitive('base', 'box', { x: 0, y: 0.18, z: 0 }, { x: 1.4, y: 0.36, z: 1.3 }, 'legacy-support'),
      prefabPrimitive('body', 'cylinder', { x: 0, y: 2.7, z: 0 }, { radiusTop: 0.82, radiusBottom: 1.34, height: 5.4, radialSegments: 4 }, 'legacy-server-floor', { yaw: Math.PI / 4 }),
      prefabPrimitive('data-window', 'box', { x: 0, y: 2.8, z: 0.94 }, { x: 0.72, y: 1.55, z: 0.08 }, 'legacy-glow-blue', { collision: 'none-mounted' }),
      prefabPrimitive('sensor-eye', 'octahedron', { x: 0, y: 4.45, z: 0.98 }, { radius: 0.18 }, 'legacy-glow-red', { collision: 'none-mounted' }),
    ],
  },
  conveyorDrive: {
    id: 'legacy-conveyor-drive',
    sourceFunction: '_addIndustrialRoomSetpieces',
    primitives: [
      prefabPrimitive('belt-base', 'box', { x: 0, y: 0.18, z: 0 }, { x: 3.4, y: 0.36, z: 10 }, 'legacy-support'),
      prefabPrimitive('belt', 'box', { x: 0, y: 0.42, z: 0 }, { x: 3, y: 0.16, z: 9.8 }, 'legacy-conveyor'),
      prefabPrimitive('left-rail', 'box', { x: -1.62, y: 0.68, z: 0 }, { x: 0.12, y: 0.72, z: 10 }, 'legacy-rail'),
      prefabPrimitive('right-rail', 'box', { x: 1.62, y: 0.68, z: 0 }, { x: 0.12, y: 0.72, z: 10 }, 'legacy-rail'),
    ],
  },
  waterTank: {
    id: 'legacy-water-tank',
    sourceFunction: '_addVolumetricIndustrialPrefabs',
    primitives: [
      prefabPrimitive('foot', 'cylinder', { x: 0, y: 0.12, z: 0 }, { radiusTop: 1.22, radiusBottom: 1.22, height: 0.24, radialSegments: 24 }, 'legacy-support'),
      prefabPrimitive('body', 'cylinder', { x: 0, y: 1.85, z: 0 }, { radiusTop: 1.05, radiusBottom: 1.15, height: 3.25, radialSegments: 24 }, 'legacy-raised-deck'),
      prefabPrimitive('top', 'cylinder', { x: 0, y: 3.83, z: 0 }, { radiusTop: 0.2, radiusBottom: 1.05, height: 0.72, radialSegments: 24 }, 'legacy-support'),
      prefabPrimitive('gauge', 'cylinder', { x: 0, y: 2.15, z: 1.16 }, { radiusTop: 0.22, radiusBottom: 0.22, height: 0.12, radialSegments: 18 }, 'legacy-glow-blue', { rotation: { x: Math.PI / 2, y: 0, z: 0 }, collision: 'none-mounted' }),
    ],
  },
  circulationPump: {
    id: 'legacy-circulation-pump',
    sourceFunction: '_addVolumetricIndustrialPrefabs',
    primitives: [
      prefabPrimitive('skid', 'box', { x: 0, y: 0.17, z: 0 }, { x: 3.4, y: 0.34, z: 2.15 }, 'legacy-support'),
      prefabPrimitive('housing', 'cylinder', { x: 0, y: 1.18, z: 0 }, { radiusTop: 0.72, radiusBottom: 0.82, height: 2.25, radialSegments: 24 }, 'legacy-raised-deck', { rotation: { x: 0, y: 0, z: Math.PI / 2 } }),
      prefabPrimitive('motor', 'box', { x: -0.2, y: 0.68, z: -0.82 }, { x: 1.28, y: 1.02, z: 1.26 }, 'legacy-machine-floor'),
      prefabPrimitive('status', 'octahedron', { x: 0.35, y: 1.82, z: -0.72 }, { radius: 0.2 }, 'legacy-glow-green', { collision: 'none-mounted' }),
    ],
  },
  processingVat: {
    id: 'legacy-processing-vat',
    sourceFunction: '_addVolumetricIndustrialPrefabs',
    primitives: [
      prefabPrimitive('foot', 'cylinder', { x: 0, y: 0.13, z: 0 }, { radiusTop: 1.85, radiusBottom: 1.85, height: 0.26, radialSegments: 28 }, 'legacy-support'),
      prefabPrimitive('wall', 'open-cylinder', { x: 0, y: 1.12, z: 0 }, { radiusTop: 1.62, radiusBottom: 1.78, height: 2.25, radialSegments: 28 }, 'legacy-raised-deck'),
      prefabPrimitive('liquid', 'cylinder', { x: 0, y: 1.92, z: 0 }, { radiusTop: 1.5, radiusBottom: 1.5, height: 0.12, radialSegments: 28 }, 'legacy-glow-violet', { collision: 'none-contained' }),
    ],
  },
  girderFrame: {
    id: 'legacy-girder-frame',
    sourceFunction: '_addVolumetricIndustrialPrefabs',
    primitives: [
      prefabPrimitive('left-column', 'i-beam', { x: -3.5, y: 2.7, z: 0 }, { length: 5.4, web: 0.18, flange: 0.56 }, 'legacy-support'),
      prefabPrimitive('right-column', 'i-beam', { x: 3.5, y: 2.7, z: 0 }, { length: 5.4, web: 0.18, flange: 0.56 }, 'legacy-support'),
      prefabPrimitive('header', 'i-beam-horizontal', { x: 0, y: 5.4, z: 0 }, { length: 7, web: 0.18, flange: 0.56 }, 'legacy-support'),
    ],
  },
  storageRack: {
    id: 'legacy-storage-rack',
    sourceFunction: '_addIndustrialRoomSetpieces',
    primitives: [
      prefabPrimitive('frame', 'box', { x: 0, y: 2.4, z: 0 }, { x: 3.2, y: 4.8, z: 1.1 }, 'legacy-support'),
      prefabPrimitive('lower-shelf', 'box', { x: 0, y: 1.1, z: 0 }, { x: 3, y: 0.16, z: 1.3 }, 'legacy-raised-deck'),
      prefabPrimitive('upper-shelf', 'box', { x: 0, y: 3.15, z: 0 }, { x: 3, y: 0.16, z: 1.3 }, 'legacy-raised-deck'),
      prefabPrimitive('locker-light', 'octahedron', { x: 1.18, y: 4.1, z: 0.64 }, { radius: 0.12 }, 'legacy-glow-yellow', { collision: 'none-mounted' }),
    ],
  },
  shrineMonolith: {
    id: 'legacy-shrine-monolith',
    sourceFunction: '_addVolumetricIndustrialPrefabs',
    primitives: [
      prefabPrimitive('body', 'cylinder', { x: 0, y: 2.1, z: 0 }, { radiusTop: 0.64, radiusBottom: 1.05, height: 4.2, radialSegments: 4 }, 'legacy-shrine', { yaw: Math.PI / 4 }),
      prefabPrimitive('recess', 'box', { x: 0, y: 2.2, z: 0.74 }, { x: 0.58, y: 1.25, z: 0.08 }, 'legacy-large-refractor', { collision: 'none-mounted' }),
      prefabPrimitive('crown', 'torus', { x: 0, y: 4.35, z: 0 }, { radius: 0.82, tube: 0.1, radialSegments: 10, tubularSegments: 24 }, 'legacy-large-refractor', { rotation: { x: Math.PI / 2, y: 0, z: 0 }, collision: 'none-overhead' }),
    ],
  },
});

const point = (x, y, z) => ({ x, y, z });
const size = (x, y, z) => ({ x, y, z });

function boundsFor(width, height, depth) {
  return {
    min: point(-width / 2, 0, -depth / 2),
    max: point(width / 2, height, depth / 2),
  };
}

function createShell(moduleId, width, height, depth, portalIds = []) {
  const thickness = { wall: 0.22, ceiling: 0.12, floor: 0.18 };
  const dimensions = {
    north: size(width, height, thickness.wall),
    south: size(width, height, thickness.wall),
    east: size(thickness.wall, height, depth),
    west: size(thickness.wall, height, depth),
    floor: size(width, thickness.floor, depth),
    ceiling: size(width, thickness.ceiling, depth),
  };
  const centers = {
    north: point(0, height / 2, -depth / 2),
    south: point(0, height / 2, depth / 2),
    east: point(width / 2, height / 2, 0),
    west: point(-width / 2, height / 2, 0),
    floor: point(0, -thickness.floor / 2, 0),
    ceiling: point(0, height + thickness.ceiling / 2, 0),
  };
  return ['north', 'south', 'east', 'west', 'floor', 'ceiling'].map((side) => ({
    id: `${moduleId}-shell-${side}`,
    side,
    center: centers[side],
    dimensions: dimensions[side],
    materialProfileId: side === 'floor'
      ? 'legacy-floor'
      : side === 'ceiling'
        ? 'legacy-ceiling'
        : 'legacy-wall-industrial',
    coverage: 'opaque-visual-and-collider',
    portalCutoutIds: portalIds.filter((portalId) => portalId.includes(`-${side}-`)),
    groundedCollision: true,
    aerialCollision: true,
    cameraCollision: true,
    powerKnockbackCollision: true,
  }));
}

function createSocket(moduleId, id, side, center, connectorForm, placementBucket, purpose) {
  const facing = {
    north: point(0, 0, -1),
    south: point(0, 0, 1),
    east: point(1, 0, 0),
    west: point(-1, 0, 0),
  }[side];
  return {
    id: `${moduleId}-${side}-${id}`,
    side,
    center,
    facing,
    connectorForm,
    placementBucket,
    elevationBand: center.y >= 6 ? 'high' : center.y >= 3 ? 'upper' : 'ground',
    aperture: { width: connectorForm === 'service-ladder' ? 2.2 : 4.4, height: 4.8 },
    clearance: { playerWidth: 1.2, playerHeight: 3.2, cameraRadius: 0.55 },
    purpose,
  };
}

function createSurface(moduleId, id, center, dimensions, purpose, supportIds, options = {}) {
  return {
    id: `${moduleId}-${id}`,
    center,
    dimensions,
    topY: center.y + dimensions.y / 2,
    walkable: true,
    collision: 'visual-and-walkable',
    materialProfileId: options.materialProfileId ?? 'legacy-raised-deck',
    purpose,
    supportIds,
    ...options,
  };
}

function createAlignedStair(moduleId, id, start, end, width, purpose, supportIds) {
  const rise = end.y - start.y;
  const runX = end.x - start.x;
  const runZ = end.z - start.z;
  const run = Math.hypot(runX, runZ);
  const stepCount = Math.max(1, Math.ceil(Math.abs(rise) / 0.55));
  return {
    id: `${moduleId}-${id}`,
    kind: 'aligned-stair-run',
    start,
    end,
    width,
    rise,
    run,
    stepCount,
    stepRise: rise / stepCount,
    treadDepth: run / stepCount,
    collisionProfile: 'continuous-walkable-stair-ramp',
    ledgeClimbAllowed: false,
    endAlignmentTolerance: 0.01,
    purpose,
    supportIds,
    materialProfileId: 'legacy-raised-deck',
  };
}

function fixture(moduleId, id, prefabId, center, dimensions, fixtureType, purpose, options = {}) {
  return {
    id: `${moduleId}-${id}`,
    fixtureType,
    prefabId,
    center,
    dimensions,
    yawQuarterTurns: options.yawQuarterTurns ?? 0,
    purpose,
    collision: {
      authority: 'plan-fixture-bounds',
      shape: options.collisionShape ?? 'oriented-box',
      center,
      dimensions,
      grounded: options.groundedCollision ?? true,
      aerial: options.aerialCollision ?? true,
      camera: options.cameraCollision ?? true,
      powerKnockback: options.powerKnockbackCollision ?? true,
    },
    ...options,
  };
}

function createDescriptor(spec) {
  const portalIds = spec.sockets.map(({ id }) => id);
  const descriptor = {
    id: spec.id,
    familyId: spec.familyId,
    assetFamilyId: spec.familyId,
    relatedAssetFamilyIds: spec.relatedAssetFamilyIds ?? [],
    displayName: spec.displayName,
    revision: LEGACY_AUTHORED_MODULE_KIT_REVISION_V2,
    topologySignature: spec.topologySignature,
    sourceContract: {
      generator: 'src/DungeonGenerator.js',
      runtimeReuse: 'none',
      functions: [
        '_createMaterials',
        '_getFloorMaterialForTile',
        '_addSolidTraversalVolumes',
        '_addIndustrialRoomSetpieces',
        '_addVolumetricIndustrialPrefabs',
        '_addCeilings',
        '_addWalls',
        '_createSolidCollisionZones',
        ...spec.sourceFunctions,
      ].filter((entry, index, list) => list.indexOf(entry) === index),
      constants: {
        tileSize: 2.8,
        wallHeight: 15.6,
        wallThickness: 0.22,
        ceilingThickness: 0.12,
        secondFloorElevation: 4.05,
        thirdFloorElevation: 7.25,
        railHeight: 0.68,
        railThickness: 0.07,
        maximumWalkableStepRise: 0.55,
      },
      discardedPatterns: [
        'fixed-room-chain',
        'generic-ramp-repair',
        'trap-basement-divot',
        'legacy-void-underlay',
        'mesh-name-derived-collision',
      ],
    },
    bounds: boundsFor(spec.width, spec.height, spec.depth),
    occupiedVolumes: [{
      id: `${spec.id}-occupied-volume`,
      bounds: boundsFor(spec.width, spec.height, spec.depth),
      kind: 'enclosed-playable-volume',
    }],
    regions: spec.regions,
    spatialCells: [{
      id: `${spec.id}-cell`,
      bounds: boundsFor(spec.width, spec.height, spec.depth),
      playable: true,
      enclosed: true,
    }],
    sockets: spec.sockets,
    portals: spec.sockets.map((socket) => ({
      id: socket.id,
      boundarySide: socket.side,
      center: socket.center,
      facing: socket.facing,
      aperture: socket.aperture,
      connectorForm: socket.connectorForm,
      sealPolicy: 'paired-portal-or-opaque-cap',
    })),
    structuralBoundaries: createShell(spec.id, spec.width, spec.height, spec.depth, portalIds),
    walkableSurfaces: spec.surfaces,
    stairs: spec.stairs,
    traversalNodes: spec.traversalNodes,
    traversalEdges: spec.traversalEdges,
    structuralFixtures: spec.fixtures,
    presentation: {
      materialProfileIds: spec.materialProfileIds,
      codeNativePrefabIds: [...new Set(spec.fixtures.map(({ prefabId }) => prefabId).filter(Boolean))],
      optionalMergedAssetId: spec.optionalMergedAssetId ?? null,
      noPrimitiveFallbackRooms: true,
    },
    performanceBudget: {
      maximumStaticDrawCalls: spec.maximumStaticDrawCalls ?? 18,
      maximumMergedAssetSlices: spec.optionalMergedAssetId ? 3 : 0,
      maximumUniqueMaterialProfiles: spec.materialProfileIds.length,
      batchCodeNativePrimitivesByShapeAndMaterial: true,
      instantiateRepeatedStructuralKit: true,
      collisionPrimitiveSource: 'structuralFixtures-and-walkableSurfaces',
    },
    platformRules: {
      everyWalkableSurfaceHasPurpose: true,
      everyElevatedSurfaceHasVisibleSupport: true,
      decorativeGeometryIsNonCollidingAndOutsidePlayerVolume: true,
      stairLandingsMustBeGapless: true,
    },
  };
  return createDungeonModuleDescriptorV2(descriptor);
}

const MODULE_SPECS = [
  (() => {
    const id = 'legacy-credential-pyramid-v2';
    const sockets = [
      createSocket(id, 'processional-entry', 'south', point(-7, 0, 15), 'arched-bulkhead', 'left', 'primary processional entry'),
      createSocket(id, 'archive-return', 'east', point(17, 4.05, 5), 'stair-gallery', 'right', 'raised shortcut return'),
      createSocket(id, 'service-branch', 'west', point(-17, 0, -7), 'pipe-tunnel', 'left', 'optional maintenance treasure branch'),
    ];
    const surfaces = [
      createSurface(id, 'floor', point(0, -0.09, 0), size(34, 0.18, 30), 'explore the credential archive floor', ['shell-floor'], { materialProfileId: 'legacy-keycard' }),
      ...Array.from({ length: 8 }, (_, index) => {
        const span = 23.6 - index * 2.4;
        return createSurface(id, `terrace-${index + 1}`, point(0, 0.25 + index * 0.5, 0), size(span, 0.5, span), index === 7 ? 'remote keycard summit above the complete archive route' : 'walkable mechanical pyramid terrace', [`pyramid-solid-tier-${index + 1}`], { materialProfileId: index % 2 ? 'legacy-raised-deck' : 'legacy-keycard' });
      }),
      createSurface(id, 'archive-balcony', point(10.5, 3.9, 5), size(13, 0.3, 5), 'raised shortcut landing behind the pyramid', ['archive-balcony-columns']),
    ];
    const stairs = [
      createAlignedStair(id, 'processional-stair', point(0, 0, 11.5), point(0, 4, 2.5), 7.6, 'walkable central ascent without ledge climbing', ['pyramid-solid-tiers']),
      createAlignedStair(id, 'shortcut-stair', point(8, 0, 8), point(10.5, 4.05, 5), 3.4, 'gapless return to the raised archive portal', ['shortcut-stringers']),
    ];
    return {
      id,
      familyId: 'v1.credential-pyramid',
      displayName: 'Credential Pyramid Archive',
      topologySignature: 'pyramid:ring8+summit|south-left@0>east-right@4.05|west-left@0|dual-ascent',
      width: 34,
      height: 15.6,
      depth: 30,
      sockets,
      surfaces,
      stairs,
      regions: [
        { id: `${id}-processional-floor`, purpose: 'enemy-lined processional approach', elevationBand: 'ground' },
        { id: `${id}-terraces`, purpose: 'multi-route credential ascent', elevationBand: 'middle' },
        { id: `${id}-archive-return`, purpose: 'keycard shortcut back to an earlier gate', elevationBand: 'upper' },
      ],
      traversalNodes: [
        { id: `${id}-entry-node`, position: point(-7, 0, 12) },
        { id: `${id}-summit-node`, position: point(0, 4, 0) },
        { id: `${id}-return-node`, position: point(12, 4.05, 5) },
        { id: `${id}-service-node`, position: point(-13, 0, -7) },
      ],
      traversalEdges: [
        { id: `${id}-entry-to-summit`, from: `${id}-entry-node`, to: `${id}-summit-node`, mode: 'walkable-stairs', bidirectional: true },
        { id: `${id}-summit-to-return`, from: `${id}-summit-node`, to: `${id}-return-node`, mode: 'walkable-balcony', bidirectional: true },
        { id: `${id}-entry-to-service`, from: `${id}-entry-node`, to: `${id}-service-node`, mode: 'floor-route', bidirectional: true },
      ],
      fixtures: [
        fixture(id, 'west-override-crank', 'legacy-circulation-pump', point(-12, 1.2, -8), size(2.2, 2.4, 2.2), 'control-bank', 'west archive machinery framing the optional route'),
        fixture(id, 'east-override-crank', 'legacy-circulation-pump', point(12, 1.2, -8), size(2.2, 2.4, 2.2), 'control-bank', 'east archive machinery framing the shortcut'),
        fixture(id, 'processional-girder', 'legacy-girder-frame', point(0, 2.7, 10), size(7, 5.4, 0.8), 'functional-machine', 'load-bearing processional arch'),
      ],
      sourceFunctions: ['_addVolumetricIndustrialPrefabs', '_addKeycardMarker'],
      materialProfileIds: ['legacy-wall-industrial', 'legacy-ceiling', 'legacy-keycard', 'legacy-raised-deck', 'legacy-support', 'legacy-glow-blue', 'legacy-glow-yellow'],
    };
  })(),
  (() => {
    const id = 'legacy-server-crypt-v2';
    const sockets = [
      createSocket(id, 'crypt-entry', 'south', point(7, 0, 14), 'security-bulkhead', 'right', 'lower data-crypt entry'),
      createSocket(id, 'catwalk-exit', 'east', point(17, 4.05, -6), 'service-ladder', 'left', 'raised inspection route'),
      createSocket(id, 'coolant-breach', 'north', point(-8, 0, -14), 'pipe-tunnel', 'left', 'pipe route toward Waterworks'),
    ];
    const surfaces = [
      createSurface(id, 'floor', point(0, -0.09, 0), size(34, 0.18, 28), 'explore server aisles and remote cache recesses', ['shell-floor'], { materialProfileId: 'legacy-server-floor' }),
      createSurface(id, 'north-catwalk', point(1, 3.9, -10.5), size(25, 0.3, 3.2), 'inspect upper server banks and reach the east exit', ['north-catwalk-columns'], { materialProfileId: 'legacy-server-floor' }),
      createSurface(id, 'east-catwalk', point(14.2, 3.9, -2), size(3.2, 0.3, 14), 'raised return overlooking the crypt core', ['east-catwalk-columns'], { materialProfileId: 'legacy-server-floor' }),
    ];
    const stairs = [createAlignedStair(id, 'outer-stair', point(13, 0, 9), point(13, 4.05, 2), 3.2, 'gapless outer-wall access to the catwalk', ['outer-stair-stringers'])];
    const fixtures = [];
    for (const x of [-10.5, -5.5, 5.5, 10.5]) {
      for (const z of [-7.8, -2.6, 2.6, 7.8]) {
        fixtures.push(fixture(id, `monolith-${x}-${z}`, 'legacy-server-monolith', point(x, 2.7, z), size(1.4, 5.4, 1.3), 'server-bank', 'data monolith defining a navigable crypt aisle'));
      }
    }
    fixtures.push(fixture(id, 'memory-core', 'legacy-server-monolith', point(0, 3, 0), size(2.36, 6, 2.36), 'generator', 'central memory core and crypt landmark'));
    return {
      id,
      familyId: 'v1.server-crypt',
      displayName: 'Ancient Server Crypt',
      topologySignature: 'server:4x4-aisles+L-catwalk|south-right@0>east-left@4.05|north-left@0',
      width: 34,
      height: 15.6,
      depth: 28,
      sockets,
      surfaces,
      stairs,
      regions: [
        { id: `${id}-west-aisles`, purpose: 'dense data-monolith maze', elevationBand: 'ground' },
        { id: `${id}-memory-core`, purpose: 'central landmark and encounter flank', elevationBand: 'ground' },
        { id: `${id}-inspection-catwalk`, purpose: 'upper cache and alternate exit route', elevationBand: 'upper' },
      ],
      traversalNodes: [
        { id: `${id}-entry-node`, position: point(7, 0, 11) },
        { id: `${id}-core-node`, position: point(0, 0, 0) },
        { id: `${id}-catwalk-node`, position: point(13, 4.05, -6) },
        { id: `${id}-breach-node`, position: point(-8, 0, -11) },
      ],
      traversalEdges: [
        { id: `${id}-entry-core`, from: `${id}-entry-node`, to: `${id}-core-node`, mode: 'aisle-route', bidirectional: true },
        { id: `${id}-core-catwalk`, from: `${id}-core-node`, to: `${id}-catwalk-node`, mode: 'walkable-stairs', bidirectional: true },
        { id: `${id}-core-breach`, from: `${id}-core-node`, to: `${id}-breach-node`, mode: 'aisle-route', bidirectional: true },
      ],
      fixtures,
      optionalMergedAssetId: 'legacy-alien-server-room',
      sourceFunctions: ['_loadAlienServerRoomModel', '_addImportedModelCollisionZones'],
      materialProfileIds: ['legacy-wall-industrial', 'legacy-ceiling', 'legacy-server-floor', 'legacy-support', 'legacy-rail', 'legacy-glow-blue', 'legacy-glow-red'],
      maximumStaticDrawCalls: 20,
    };
  })(),
  (() => {
    const id = 'legacy-conveyor-factory-v2';
    const sockets = [
      createSocket(id, 'receiving', 'west', point(-21, 0, 7), 'freight-elevator', 'right', 'lower receiving dock'),
      createSocket(id, 'gantry-dispatch', 'north', point(6, 7.25, -16), 'conveyor-bridge', 'right', 'third-floor dispatch gantry'),
      createSocket(id, 'service-exit', 'east', point(21, 4.05, -8), 'cargo-lift', 'left', 'raised cargo-lift shortcut'),
    ];
    const surfaces = [
      createSurface(id, 'floor', point(0, -0.09, 0), size(42, 0.18, 32), 'explore the factory floor around working press lines', ['shell-floor'], { materialProfileId: 'legacy-machine-floor' }),
      createSurface(id, 'west-deck', point(-16.5, 3.9, 0), size(7, 0.3, 27), 'side structural deck and alternate route', ['west-deck-solid-mass'], { materialProfileId: 'legacy-machine-floor' }),
      createSurface(id, 'cross-bridge', point(-7, 3.9, 0), size(12, 0.3, 3.5), 'cross the active conveyor above cargo', ['cross-bridge-columns'], { materialProfileId: 'legacy-machine-floor' }),
      createSurface(id, 'dispatch-gantry', point(4, 7.1, -12), size(15, 0.3, 5), 'reach the high dispatch portal and cache crane', ['dispatch-girders'], { materialProfileId: 'legacy-raised-deck' }),
    ];
    const stairs = [
      createAlignedStair(id, 'west-deck-stair', point(-18, 0, 12), point(-16.5, 4.05, 8), 3.8, 'gapless access to the structural side deck', ['west-deck-stringers']),
      createAlignedStair(id, 'dispatch-stair', point(-4, 4.05, -1), point(1, 7.25, -9.5), 3.8, 'gapless rise from cross bridge to dispatch gantry', ['dispatch-stringers']),
    ];
    const fixtures = [
      fixture(id, 'central-conveyor', 'legacy-conveyor-drive', point(0, 0.6, 1), size(3.4, 1.2, 24), 'conveyor', 'active assembly conveyor and traversal landmark'),
      fixture(id, 'scrap-return', 'legacy-conveyor-drive', point(-9, 0.6, 4), size(3.4, 1.2, 17), 'conveyor', 'scrap return line hiding a salvage branch'),
      fixture(id, 'parts-feed', 'legacy-conveyor-drive', point(9, 0.6, -4), size(3.4, 1.2, 17), 'conveyor', 'parts feed below the cargo shortcut'),
      fixture(id, 'prime-mover', 'legacy-circulation-pump', point(-12, 2.35, -10), size(6.7, 4.7, 4.3), 'generator', 'factory prime mover and functional chamber purpose'),
      fixture(id, 'load-girder', 'legacy-girder-frame', point(0, 3.2, -11), size(15, 6.4, 0.8), 'functional-machine', 'visible load-bearing support for the high gantry'),
    ];
    for (const z of [-7, 0, 7]) {
      for (const x of [-1.15, 1.15]) {
        fixtures.push(fixture(id, `press-leg-${x}-${z}`, null, point(x, 0.725, z), size(0.28, 1.45, 0.42), 'functional-machine', 'visible machine-press support leg; overhead housing remains passable'));
      }
    }
    return {
      id,
      familyId: 'v1.factory-conveyor',
      displayName: 'Conveyor Assembly Works',
      topologySignature: 'factory:three-belts+west-deck+cross+high-gantry|west-right@0>north-right@7.25|east-left@4.05',
      width: 42,
      height: 18,
      depth: 32,
      sockets,
      surfaces,
      stairs,
      regions: [
        { id: `${id}-receiving-floor`, purpose: 'receiving, scrap, and parts routing', elevationBand: 'ground' },
        { id: `${id}-press-crossing`, purpose: 'working press line platforming route', elevationBand: 'upper' },
        { id: `${id}-dispatch-gantry`, purpose: 'high dispatch and shortcut route', elevationBand: 'high' },
      ],
      traversalNodes: [
        { id: `${id}-receiving-node`, position: point(-18, 0, 7) },
        { id: `${id}-press-node`, position: point(0, 0, 4) },
        { id: `${id}-cross-node`, position: point(-7, 4.05, 0) },
        { id: `${id}-dispatch-node`, position: point(6, 7.25, -13) },
        { id: `${id}-lift-node`, position: point(18, 4.05, -8) },
      ],
      traversalEdges: [
        { id: `${id}-receiving-press`, from: `${id}-receiving-node`, to: `${id}-press-node`, mode: 'factory-floor-route', bidirectional: true },
        { id: `${id}-press-cross`, from: `${id}-press-node`, to: `${id}-cross-node`, mode: 'walkable-stairs', bidirectional: true },
        { id: `${id}-cross-dispatch`, from: `${id}-cross-node`, to: `${id}-dispatch-node`, mode: 'walkable-stairs', bidirectional: true },
        { id: `${id}-cross-lift`, from: `${id}-cross-node`, to: `${id}-lift-node`, mode: 'catwalk-route', bidirectional: true },
      ],
      fixtures,
      optionalMergedAssetId: 'legacy-machine-factory-room',
      sourceFunctions: ['_loadMachineFactoryRoomModel', '_createConveyorTileZones'],
      materialProfileIds: ['legacy-wall-industrial', 'legacy-ceiling', 'legacy-machine-floor', 'legacy-conveyor', 'legacy-raised-deck', 'legacy-support', 'legacy-rail', 'legacy-hazard-stripe'],
      maximumStaticDrawCalls: 22,
    };
  })(),
  (() => {
    const id = 'legacy-coolant-relay-v2';
    const sockets = [
      createSocket(id, 'water-breach', 'west', point(-19, 0, -6), 'water-breach', 'left', 'lower flooded basin connection'),
      createSocket(id, 'router-catwalk', 'north', point(8, 4.05, -15), 'pump-catwalk', 'right', 'permanent-dry master router approach'),
      createSocket(id, 'drain-return', 'south', point(-10, -1.35, 15), 'drainage-stair', 'left', 'service-pit salvage return'),
    ];
    const surfaces = [
      createSurface(id, 'valve-deck', point(0, -0.09, 0), size(38, 0.18, 30), 'operate separated coolant valve stations', ['shell-floor'], { materialProfileId: 'legacy-coolant-floor' }),
      createSurface(id, 'service-pit', point(0, -1.44, 2), size(10, 0.18, 10), 'enter a playable lowered maintenance sub-zone', ['service-pit-solid-base'], { materialProfileId: 'legacy-floor-cracked' }),
      createSurface(id, 'control-balcony', point(0, 3.9, -11.5), size(21, 0.3, 4), 'operate the permanent-dry master router', ['control-balcony-columns'], { materialProfileId: 'legacy-coolant-floor' }),
    ];
    const stairs = [
      createAlignedStair(id, 'balcony-stair', point(13, 0, -3), point(8, 4.05, -10.5), 3.8, 'gapless access to the permanent-dry control balcony', ['balcony-stair-stringers']),
      createAlignedStair(id, 'pit-return-stair', point(-4, -1.35, 4), point(-9, 0, 10), 4.2, 'walkable damage-free return from the service pit', ['pit-return-solid-stringers']),
    ];
    const fixtures = [
      fixture(id, 'central-base', 'legacy-circulation-pump', point(0, 1.45, 0), size(5.7, 2.9, 4.5), 'pump-array', 'central circulation machinery base'),
      fixture(id, 'pressure-core', 'legacy-water-tank', point(0, 3.25, 0), size(3.5, 6.5, 3.5), 'reservoir', 'central conserved-water pressure core'),
      fixture(id, 'source-tank-a', 'legacy-water-tank', point(-13, 2.25, -9), size(2.36, 4.5, 2.36), 'pressure-vessel', 'west source tank feeding the conserved-water relay'),
      fixture(id, 'source-tank-b', 'legacy-water-tank', point(13, 2.25, -9), size(2.36, 4.5, 2.36), 'pressure-vessel', 'east source tank feeding the conserved-water relay'),
      fixture(id, 'source-tank-c', 'legacy-water-tank', point(-13, 2.25, 9), size(2.36, 4.5, 2.36), 'pressure-vessel', 'south source tank feeding the conserved-water relay'),
      fixture(id, 'overflow-tank', 'legacy-water-tank', point(13, 2.05, 9), size(2.24, 4.1, 2.24), 'pressure-vessel', 'overflow vessel and optional route landmark'),
      fixture(id, 'valve-a', 'legacy-circulation-pump', point(-6, 1.7, -1), size(1.48, 3.4, 1.48), 'control-bank', 'west coolant valve pylon'),
      fixture(id, 'valve-b', 'legacy-circulation-pump', point(6, 1.7, -1), size(1.48, 3.4, 1.48), 'control-bank', 'east coolant valve pylon'),
      fixture(id, 'valve-c', 'legacy-circulation-pump', point(0, 1.7, 7), size(1.48, 3.4, 1.48), 'control-bank', 'south coolant valve pylon'),
      fixture(id, 'master-console', null, point(0, 5.05, -12), size(1.9, 2, 1.04), 'control-bank', 'permanent-dry master pressure console'),
    ];
    return {
      id,
      familyId: 'v1.coolant-relay',
      displayName: 'Coolant Relay Pump Gallery',
      topologySignature: 'coolant:three-valves+pit+dry-balcony|west-left@0>north-right@4.05|south-left@-1.35',
      width: 38,
      height: 17,
      depth: 30,
      sockets,
      surfaces,
      stairs,
      regions: [
        { id: `${id}-valve-floor`, purpose: 'three separated coolant-routing controls', elevationBand: 'ground' },
        { id: `${id}-service-pit`, purpose: 'lower playable salvage and return route', elevationBand: 'lower' },
        { id: `${id}-router-balcony`, purpose: 'permanent-dry route commit control', elevationBand: 'upper' },
      ],
      traversalNodes: [
        { id: `${id}-breach-node`, position: point(-16, 0, -6) },
        { id: `${id}-valve-node`, position: point(0, 0, 5) },
        { id: `${id}-pit-node`, position: point(-2, -1.35, 3) },
        { id: `${id}-router-node`, position: point(8, 4.05, -12) },
        { id: `${id}-drain-node`, position: point(-10, -1.35, 12) },
      ],
      traversalEdges: [
        { id: `${id}-breach-valves`, from: `${id}-breach-node`, to: `${id}-valve-node`, mode: 'dry-or-bottom-walk-route', bidirectional: true },
        { id: `${id}-valves-pit`, from: `${id}-valve-node`, to: `${id}-pit-node`, mode: 'walkable-stairs', bidirectional: true },
        { id: `${id}-valves-router`, from: `${id}-valve-node`, to: `${id}-router-node`, mode: 'walkable-stairs', bidirectional: true },
        { id: `${id}-pit-drain`, from: `${id}-pit-node`, to: `${id}-drain-node`, mode: 'lower-floor-route', bidirectional: true },
      ],
      fixtures,
      optionalMergedAssetId: 'legacy-coolant-relay-room',
      sourceFunctions: ['_getCoolantFixtureSpecs', '_loadCoolantRelayRoomModel'],
      materialProfileIds: ['legacy-wall-industrial', 'legacy-ceiling', 'legacy-coolant-floor', 'legacy-raised-deck', 'legacy-support', 'legacy-terminal', 'legacy-glow-blue', 'legacy-glow-green', 'legacy-glow-violet'],
      maximumStaticDrawCalls: 22,
    };
  })(),
  (() => {
    const id = 'legacy-warehouse-nest-v2';
    const sockets = [
      createSocket(id, 'receiving-door', 'south', point(9, 0, 15), 'arched-bulkhead', 'right', 'warehouse receiving entry'),
      createSocket(id, 'rack-ladder', 'east', point(18, 6, -7), 'service-ladder', 'left', 'upper rack service route'),
      createSocket(id, 'cargo-return', 'west', point(-18, 3.5, 6), 'cargo-lift', 'right', 'elevated automatic cargo return'),
    ];
    const surfaces = [
      createSurface(id, 'floor', point(0, -0.09, 0), size(36, 0.18, 30), 'search warehouse aisles for salvage and nest danger', ['shell-floor'], { materialProfileId: 'legacy-floor-octagon' }),
      createSurface(id, 'west-rack-walk', point(-13, 3.35, -3), size(4.5, 0.3, 17), 'optional upper salvage route above west racks', ['west-rack-columns']),
      createSurface(id, 'east-rack-walk', point(13, 5.85, -5), size(4.5, 0.3, 13), 'high service-ladder route and nest flank', ['east-rack-columns']),
      createSurface(id, 'cargo-landing', point(-14, 3.35, 7), size(7, 0.3, 5), 'useful elevated moving-cargo landing', ['cargo-landing-girders']),
    ];
    const stairs = [createAlignedStair(id, 'west-rack-stair', point(-8, 0, 11), point(-13, 3.5, 7), 3.8, 'gapless access to the west rack walk', ['rack-stair-stringers'])];
    const fixtures = [
      fixture(id, 'rack-west-north', 'legacy-storage-rack', point(-10, 3, -8), size(4, 6, 9), 'server-bank', 'northwest salvage rack and aisle wall'),
      fixture(id, 'rack-west-south', 'legacy-storage-rack', point(-10, 3.75, 2), size(4, 7.5, 9), 'server-bank', 'southwest rack supporting the upper treasure route'),
      fixture(id, 'rack-east', 'legacy-storage-rack', point(10, 3.5, -2), size(4, 7, 14), 'server-bank', 'east rack separating the nest cache from the return'),
      fixture(id, 'nest-monolith-west', 'legacy-server-monolith', point(-4, 3.05, -3), size(3.1, 6.1, 3.1), 'processing-tank', 'dormant Reaverbot occupation vessel'),
      fixture(id, 'nest-monolith-east', 'legacy-server-monolith', point(4, 3.05, 3), size(3.1, 6.1, 3.1), 'processing-tank', 'second occupation vessel framing a combat flank'),
    ];
    return {
      id,
      familyId: 'v1.nest-warehouse',
      relatedAssetFamilyIds: ['v1.parts-warehouse'],
      displayName: 'Parts and Nest Warehouse',
      topologySignature: 'warehouse:offset-aisles+split-rackwalks|south-right@0>east-left@6|west-right@3.5',
      width: 36,
      height: 16,
      depth: 30,
      sockets,
      surfaces,
      stairs,
      regions: [
        { id: `${id}-salvage-aisles`, purpose: 'interconnected treasure-search aisles', elevationBand: 'ground' },
        { id: `${id}-nest-floor`, purpose: 'optional Reaverbot danger and cache', elevationBand: 'ground' },
        { id: `${id}-rackwalks`, purpose: 'upper alternate route and cargo shortcut', elevationBand: 'upper' },
      ],
      traversalNodes: [
        { id: `${id}-entry-node`, position: point(9, 0, 12) },
        { id: `${id}-aisle-node`, position: point(0, 0, 7) },
        { id: `${id}-nest-node`, position: point(0, 0, -3) },
        { id: `${id}-rack-node`, position: point(14, 6, -7) },
        { id: `${id}-cargo-node`, position: point(-15, 3.5, 6) },
      ],
      traversalEdges: [
        { id: `${id}-entry-aisle`, from: `${id}-entry-node`, to: `${id}-aisle-node`, mode: 'warehouse-aisle', bidirectional: true },
        { id: `${id}-aisle-nest`, from: `${id}-aisle-node`, to: `${id}-nest-node`, mode: 'warehouse-aisle', bidirectional: true },
        { id: `${id}-nest-rack`, from: `${id}-nest-node`, to: `${id}-rack-node`, mode: 'service-ladder', bidirectional: true },
        { id: `${id}-aisle-cargo`, from: `${id}-aisle-node`, to: `${id}-cargo-node`, mode: 'walkable-stairs', bidirectional: true },
      ],
      fixtures,
      sourceFunctions: ['_addIndustrialRoomSetpieces', '_addVolumetricIndustrialPrefabs'],
      materialProfileIds: ['legacy-wall-industrial', 'legacy-ceiling', 'legacy-floor-octagon', 'legacy-raised-deck', 'legacy-support', 'legacy-glow-red', 'legacy-glow-yellow'],
    };
  })(),
  (() => {
    const id = 'legacy-refractor-shrine-v2';
    const sockets = [
      createSocket(id, 'sanctum-gate', 'west', point(-18, 4.05, -6), 'shrine-bulkhead', 'left', 'raised Shrine Key gate'),
      createSocket(id, 'maintenance-return', 'south', point(7, 0, 15), 'maintenance-pipe', 'right', 'lower permanent return route'),
      createSocket(id, 'extraction-exit', 'north', point(-8, 7.25, -15), 'arched-bulkhead', 'left', 'high extraction overlook'),
    ];
    const surfaces = [
      createSurface(id, 'sanctum-floor', point(0, -0.09, 0), size(36, 0.18, 30), 'explore the machine chapel and unlock the sanctum', ['shell-floor'], { materialProfileId: 'legacy-shrine' }),
      createSurface(id, 'revered-mezzanine', point(0, 3.9, 0), size(31, 0.3, 25), 'ring route overlooking the Refractor sanctum', ['mezzanine-pillars'], { materialProfileId: 'legacy-shrine', cutout: { x: 15, z: 12 } }),
      createSurface(id, 'refractor-dais', point(0, 7.1, 0), size(8, 0.3, 8), 'collect the Large Refractor from a supported focal dais', ['dais-solid-mass'], { materialProfileId: 'legacy-large-refractor' }),
    ];
    const stairs = [
      createAlignedStair(id, 'mezzanine-stair', point(-14, 0, 10), point(-14, 4.05, 4), 4, 'gapless walkable ascent to the revered mezzanine', ['mezzanine-stair-stringers']),
      createAlignedStair(id, 'dais-stair', point(11, 4.05, 4), point(4, 7.25, 0), 4, 'gapless walkable ascent to the Refractor dais', ['dais-stair-stringers']),
    ];
    const fixtures = [
      fixture(id, 'focal-pillar-west', 'legacy-shrine-monolith', point(-3.15, 9.35, 1.525), size(1.72, 4.2, 1.72), 'server-bank', 'west refractor-focusing pillar'),
      fixture(id, 'focal-pillar-east', 'legacy-shrine-monolith', point(3.15, 9.35, 1.525), size(1.72, 4.2, 1.72), 'server-bank', 'east refractor-focusing pillar'),
      fixture(id, 'focal-pillar-south', 'legacy-shrine-monolith', point(0, 9.35, -3.05), size(1.72, 4.2, 1.72), 'server-bank', 'south refractor-focusing pillar'),
      fixture(id, 'reverent-monolith-west', 'legacy-shrine-monolith', point(-12, 3.6, 0), size(3.64, 7.2, 3.64), 'server-bank', 'west chapel machine monolith'),
      fixture(id, 'reverent-monolith-east', 'legacy-shrine-monolith', point(12, 3.6, 0), size(3.64, 7.2, 3.64), 'server-bank', 'east chapel machine monolith'),
      fixture(id, 'sanctum-girder', 'legacy-girder-frame', point(0, 3.1, 10), size(7.4, 6.2, 0.8), 'functional-machine', 'load-bearing cylinder arch framing the sanctum'),
    ];
    return {
      id,
      familyId: 'v1.refractor-shrine',
      displayName: 'Large Refractor Machine Chapel',
      topologySignature: 'shrine:ring-mezzanine+central-high-dais|west-left@4.05>north-left@7.25|south-right@0',
      width: 36,
      height: 18,
      depth: 30,
      sockets,
      surfaces,
      stairs,
      regions: [
        { id: `${id}-chapel-floor`, purpose: 'Shrine Key gate and machine-chapel approach', elevationBand: 'ground' },
        { id: `${id}-mezzanine-ring`, purpose: 'reverent alternate route around the sanctum', elevationBand: 'upper' },
        { id: `${id}-refractor-dais`, purpose: 'Large Refractor collection and extraction view', elevationBand: 'high' },
      ],
      traversalNodes: [
        { id: `${id}-maintenance-node`, position: point(7, 0, 12) },
        { id: `${id}-chapel-node`, position: point(0, 0, 7) },
        { id: `${id}-mezzanine-node`, position: point(-14, 4.05, -6) },
        { id: `${id}-dais-node`, position: point(0, 7.25, 0) },
        { id: `${id}-extraction-node`, position: point(-8, 7.25, -12) },
      ],
      traversalEdges: [
        { id: `${id}-maintenance-chapel`, from: `${id}-maintenance-node`, to: `${id}-chapel-node`, mode: 'chapel-floor-route', bidirectional: true },
        { id: `${id}-chapel-mezzanine`, from: `${id}-chapel-node`, to: `${id}-mezzanine-node`, mode: 'walkable-stairs', bidirectional: true },
        { id: `${id}-mezzanine-dais`, from: `${id}-mezzanine-node`, to: `${id}-dais-node`, mode: 'walkable-stairs', bidirectional: true },
        { id: `${id}-dais-extraction`, from: `${id}-dais-node`, to: `${id}-extraction-node`, mode: 'high-sanctum-route', bidirectional: true },
      ],
      fixtures,
      sourceFunctions: ['_addLargeRefractorShrine', '_addVolumetricIndustrialPrefabs'],
      materialProfileIds: ['legacy-wall-industrial', 'legacy-ceiling', 'legacy-shrine', 'legacy-raised-deck', 'legacy-large-refractor', 'legacy-support', 'legacy-glow-blue'],
      maximumStaticDrawCalls: 18,
    };
  })(),
];

export const LEGACY_AUTHORED_MODULE_DESCRIPTORS_V2 = deepFreezePlan(
  MODULE_SPECS.map((spec) => createDescriptor(spec)),
);

export const LEGACY_AUTHORED_MODULE_BY_ID_V2 = deepFreezePlan(Object.fromEntries(
  LEGACY_AUTHORED_MODULE_DESCRIPTORS_V2.map((descriptor) => [descriptor.id, descriptor]),
));

export function getLegacyAuthoredModuleDescriptorV2(moduleId) {
  const descriptor = LEGACY_AUTHORED_MODULE_BY_ID_V2[moduleId];
  if (!descriptor) {
    throw new RangeError(`Unknown legacy-authored V2 module: ${moduleId}`);
  }
  return descriptor;
}

export function createLegacyAuthoredModulePlacementV2(moduleId, {
  id = `${moduleId}-placement`,
  translation = point(0, 0, 0),
  yawQuarterTurns = 0,
} = {}) {
  const descriptor = getLegacyAuthoredModuleDescriptorV2(moduleId);
  if (!['x', 'y', 'z'].every((axis) => Number.isFinite(translation?.[axis]))) {
    throw new TypeError('translation must contain finite x, y, and z values.');
  }
  return deepFreezePlan({
    id,
    descriptorId: descriptor.id,
    descriptorRevision: descriptor.revision,
    translation: clonePlanData(translation),
    yawQuarterTurns: normalizeYawQuarterTurns(yawQuarterTurns),
  });
}

export default LEGACY_AUTHORED_MODULE_DESCRIPTORS_V2;
