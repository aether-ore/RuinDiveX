import {
  cloneDungeonAugmentationValue,
  deepFreezeDungeonAugmentationValue,
} from './canonical.js';

/**
 * Renderer-free, implementation-grade Industrial supplement blueprints.
 *
 * Coordinates use the local planning grid: +x is east, +z is south, and each
 * floor cell is exactly 2.8 metres. Masks are ordered north-to-south.
 */

export const INDUSTRIAL_SUPPLEMENT_BLUEPRINT_SCHEMA =
  'ruindivex-industrial-supplement-blueprint/v1';

const FLOOR_CELL_METERS = 2.8;
const SOCKET_WIDTH_METERS = 8.4;
const CARDINAL_SIDES = new Set(['N', 'E', 'S', 'W']);

function fail(id, message) {
  throw new Error(`Invalid Industrial supplement blueprint ${id}: ${message}`);
}

function validateMask(id, field, mask, { allowEmpty = false } = {}) {
  if (!Array.isArray(mask) || (!allowEmpty && mask.length === 0)) {
    fail(id, `${field} must be ${allowEmpty ? 'an array' : 'a non-empty array'}`);
  }
  if (mask.length === 0) return { width: 0, depth: 0 };
  const width = mask[0]?.length ?? 0;
  if (width === 0) fail(id, `${field} rows must not be empty`);
  for (const row of mask) {
    if (typeof row !== 'string' || row.length !== width) {
      fail(id, `${field} must be rectangular`);
    }
    if (!/^[.#]+$/.test(row)) fail(id, `${field} may contain only "." and "#"`);
  }
  return { width, depth: mask.length };
}

function socketCellIndices(center, span) {
  const centerIndex = center + (span - 1) / 2;
  if (!Number.isInteger(centerIndex)) return null;
  return [centerIndex - 1, centerIndex, centerIndex + 1];
}

function validateSocket(id, socket, baseMask, upperMask, upperY) {
  if (!socket || typeof socket !== 'object' || typeof socket.id !== 'string') {
    fail(id, 'every socket must have a stable id');
  }
  if (!CARDINAL_SIDES.has(socket.side)) fail(id, `socket ${socket.id} has an invalid side`);
  if (socket.width !== 3) fail(id, `socket ${socket.id} must be exactly 3 tiles wide`);
  if (!Number.isFinite(socket.center) || !Number.isFinite(socket.y)) {
    fail(id, `socket ${socket.id} must have finite center and elevation values`);
  }
  const tierMask = socket.y === 0
    ? baseMask
    : socket.y === upperY
      ? upperMask
      : null;
  if (!tierMask?.length) fail(id, `socket ${socket.id} does not reference a floor tier`);
  const depth = tierMask.length;
  const width = tierMask[0].length;
  const span = socket.side === 'N' || socket.side === 'S' ? width : depth;
  const indices = socketCellIndices(socket.center, span);
  if (!indices || indices.some(index => index < 0 || index >= span)) {
    fail(id, `socket ${socket.id} aperture falls outside its mask`);
  }
  const apertureIsFloor = indices.every(index => {
    if (socket.side === 'N') return tierMask[0][index] === '#';
    if (socket.side === 'S') return tierMask[depth - 1][index] === '#';
    if (socket.side === 'W') return tierMask[index][0] === '#';
    return tierMask[index][width - 1] === '#';
  });
  if (!apertureIsFloor) fail(id, `socket ${socket.id} is not backed by three boundary floor cells`);
}

function persistentStateIds(state) {
  if (typeof state !== 'string') return [];
  return state
    .split(';')
    .map(part => part.trim().replace(/\.$/, ''))
    .filter(part => /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(part));
}

function inferTransferForm(feature) {
  if (feature.form) return feature.form;
  if (feature.id.includes('lift')) return 'lift';
  if (feature.id.includes('ladder')) return 'ladder';
  if (feature.id.includes('stair')) return 'stairs';
  if (feature.id.includes('step')) return 'step';
  if (feature.id.includes('landing')) return 'landing';
  return 'ramp';
}

function floorCellSupport(floorTierId, x, z) {
  return { kind: 'floor-cell', floorTierId, localTile: { x, z } };
}

function transferCellSupport(transferId, x, z) {
  return { kind: 'transfer-cell', transferId, localTile: { x, z } };
}

function transferEndpoint(localElevation, x, z, localSupportRef) {
  return {
    localElevation,
    localTransferCell: { x, z },
    localSupportRef,
  };
}

/*
 * V4 transfer endpoints are authored identities, not proximity hints. Each
 * endpoint names one cell in its own transfer footprint and the exact floor
 * or neighboring transfer cell that supports traversal beyond that endpoint.
 * Half-grid devices deliberately name a concrete footprint cell even when
 * their visual/device center lies between floor cells.
 */
const TRANSFER_ENDPOINT_LOCAL_REFS = {
  'si-lift-01': {
    from: transferEndpoint(0, 2, 0, floorCellSupport('base', 2, 0)),
    to: transferEndpoint(5.6, 2, 0, floorCellSupport('upper', 2, 0)),
  },
  'rf-ramp': {
    from: transferEndpoint(0, 4, 4, floorCellSupport('base', 4, 2)),
    to: transferEndpoint(2.8, 4, -2, floorCellSupport('upper', 4, -2)),
  },
  'tc-ramp': {
    from: transferEndpoint(0, 4, -3, floorCellSupport('base', 4, -2)),
    to: transferEndpoint(2.8, 4, 3, floorCellSupport('upper', 4, 3)),
  },
  'ldr-ladder': {
    from: transferEndpoint(0, 2, 0, floorCellSupport('base', 2, 0)),
    to: transferEndpoint(2.8, 2, 0, floorCellSupport('upper', 2, 0)),
  },
  'lft-cargo-lift': {
    from: transferEndpoint(0, -2.5, -0.5, floorCellSupport('base', -2, 0)),
    to: transferEndpoint(2.8, -2.5, -0.5, floorCellSupport('upper', -2, 0)),
  },
  'crd-service-ramp': {
    from: transferEndpoint(0, 0, 3, floorCellSupport('base', 0, 3)),
    to: transferEndpoint(2.8, 0, -3, floorCellSupport('upper', 0, -3)),
  },
  'mr-switchback-ramp': {
    from: transferEndpoint(0, -2, -2, floorCellSupport('base', -2, -2)),
    to: transferEndpoint(2.8, -2, 4, floorCellSupport('upper', -2, 4)),
  },
  'mr-lift-platform': {
    from: transferEndpoint(0, 0, 0, floorCellSupport('base', -2, 0)),
    to: transferEndpoint(2.8, 0, 0, floorCellSupport('upper', 0, 2)),
  },
  'ob-step': {
    from: transferEndpoint(0, 2, 0, floorCellSupport('base', 2, 0)),
    to: transferEndpoint(0.7, 2, 0, floorCellSupport('upper', 2, 1)),
  },
  'sr-flight-lower': {
    from: transferEndpoint(0, -2.5, 4, floorCellSupport('base', -2, 4)),
    to: transferEndpoint(1.4, -2.5, 0, transferCellSupport('sr-mid-landing', -2, -0.5)),
  },
  'sr-mid-landing': {
    from: transferEndpoint(1.4, -2, -0.5, transferCellSupport('sr-flight-lower', -2.5, 0)),
    to: transferEndpoint(1.4, 2, -0.5, transferCellSupport('sr-flight-upper', 1.5, 0)),
  },
  'sr-flight-upper': {
    from: transferEndpoint(1.4, 1.5, 0, transferCellSupport('sr-mid-landing', 2, -0.5)),
    to: transferEndpoint(2.8, 1.5, -4, floorCellSupport('upper', 2, -4)),
  },
  'scd-flight-01': {
    from: transferEndpoint(0, -6, 0, floorCellSupport('base', -6, 0)),
    to: transferEndpoint(2.8, 0, 0, transferCellSupport('scd-rest', 0, 0)),
  },
  'scd-rest': {
    from: transferEndpoint(2.8, -1, 0, transferCellSupport('scd-flight-01', 0, 0)),
    to: transferEndpoint(2.8, 1, 0, transferCellSupport('scd-flight-02', 0, 0)),
  },
  'scd-flight-02': {
    from: transferEndpoint(2.8, 0, 0, transferCellSupport('scd-rest', 0, 0)),
    to: transferEndpoint(5.6, 6, 0, floorCellSupport('upper', 6, 0)),
  },
  'fl-cab': {
    from: transferEndpoint(0, 1.5, -0.5, floorCellSupport('base', 2, 0)),
    to: transferEndpoint(5.6, 1.5, -0.5, floorCellSupport('upper', 2, 0)),
  },
  'lb-ladder': {
    from: transferEndpoint(0, 0, 2, floorCellSupport('base', 0, 2)),
    to: transferEndpoint(2.8, 0, 2, floorCellSupport('upper', 0, 2)),
  },
  'ta-ramp-west': {
    from: transferEndpoint(0, -4, 3, floorCellSupport('base', -4, 3)),
    to: transferEndpoint(1.4, -4, -3, transferCellSupport('ta-turn-landing', -4, -3)),
  },
  'ta-turn-landing': {
    from: transferEndpoint(1.4, -4, -3, transferCellSupport('ta-ramp-west', -4, -3)),
    to: transferEndpoint(1.4, -4, -5, transferCellSupport('ta-ramp-north', -4, -4)),
  },
  'ta-ramp-north': {
    from: transferEndpoint(1.4, -4, -4, transferCellSupport('ta-turn-landing', -4, -4)),
    to: transferEndpoint(2.8, 4, -4, floorCellSupport('upper', 4, -4)),
  },
  'fd-stair': {
    from: transferEndpoint(2.8, -3, -2, floorCellSupport('upper', -3, -2)),
    to: transferEndpoint(0, 3, -2, floorCellSupport('base', 3, -2)),
  },
  'cg-lift': {
    from: transferEndpoint(0, 3.5, -0.5, floorCellSupport('base', 4, 0)),
    to: transferEndpoint(5.6, 3.5, -0.5, floorCellSupport('upper', 4, 0)),
  },
  'pr-stair': {
    from: transferEndpoint(0, 2.5, -3, floorCellSupport('base', 2, -3)),
    to: transferEndpoint(2.8, 2.5, 3, floorCellSupport('upper', 3, 3)),
  },
  'pd-stair': {
    from: transferEndpoint(2.8, -2.5, -3, floorCellSupport('upper', -2, -3)),
    to: transferEndpoint(0, -3.5, 3, floorCellSupport('base', -3, 3)),
  },
  'sgd-stair': {
    from: transferEndpoint(2.8, 0, -3, floorCellSupport('upper', 0, -3)),
    to: transferEndpoint(0, 0, 3, floorCellSupport('base', 0, 3)),
  },
  'lfr-slope': {
    from: transferEndpoint(0, 0, 4, floorCellSupport('base', 0, 4)),
    to: transferEndpoint(2.8, 0, -4, floorCellSupport('upper', 0, -4)),
  },
  'isg-incline': {
    from: transferEndpoint(0, 0, 4, floorCellSupport('base', 0, 4)),
    to: transferEndpoint(2.8, 0, -4, floorCellSupport('upper', 0, -4)),
  },
};

function exactLocalTile(point) {
  return point
    && Number.isFinite(Number(point.x))
    && Number.isFinite(Number(point.z));
}

function footprintContainsExactCell(feature, localTile) {
  const width = Number(feature.w ?? 1);
  const depth = Number(feature.d ?? 1);
  const minimumX = Number(feature.x) - (width - 1) * 0.5;
  const minimumZ = Number(feature.z) - (depth - 1) * 0.5;
  const xOrdinal = Number(localTile.x) - minimumX;
  const zOrdinal = Number(localTile.z) - minimumZ;
  return Number.isInteger(width)
    && width > 0
    && Number.isInteger(depth)
    && depth > 0
    && Number.isInteger(xOrdinal)
    && xOrdinal >= 0
    && xOrdinal < width
    && Number.isInteger(zOrdinal)
    && zOrdinal >= 0
    && zOrdinal < depth;
}

function tierContainsExactFloorCell(tier, localTile) {
  const column = Number(localTile.x) - Number(tier.maskOriginTile?.x);
  const row = Number(localTile.z) - Number(tier.maskOriginTile?.z);
  return Number.isInteger(column)
    && Number.isInteger(row)
    && tier.floorMask?.[row]?.[column] === '#';
}

function createBlueprint(definition) {
  const value = cloneDungeonAugmentationValue(definition);
  const baseDimensions = validateMask(value.id, 'mask', value.mask);
  const upperDimensions = validateMask(value.id, 'upper', value.upper, { allowEmpty: true });
  if (value.upper.length > 0
    && (upperDimensions.width !== baseDimensions.width
      || upperDimensions.depth !== baseDimensions.depth)) {
    fail(value.id, 'upper must have the same rectangular dimensions as mask');
  }
  if ((value.upper.length > 0) !== Number.isFinite(value.upperY)) {
    fail(value.id, 'upper and upperY must either both be present or both be absent');
  }
  const socketIds = new Set();
  for (const socket of value.sockets) {
    if (socketIds.has(socket.id)) fail(value.id, `duplicate socket id ${socket.id}`);
    socketIds.add(socket.id);
    validateSocket(value.id, socket, value.mask, value.upper, value.upperY);
  }

  const width = baseDimensions.width;
  const depth = baseDimensions.depth;
  const widthMeters = Number((width * FLOOR_CELL_METERS).toFixed(6));
  const depthMeters = Number((depth * FLOOR_CELL_METERS).toFixed(6));
  const maskOriginTile = { x: -(width - 1) / 2, z: -(depth - 1) / 2 };
  const stateIds = persistentStateIds(value.state);
  const sockets = value.sockets.map(socket => ({
    ...socket,
    widthMeters: SOCKET_WIDTH_METERS,
  }));
  const floorTiers = [{
    id: 'base',
    elevation: 0,
    floorMask: value.mask,
    maskOriginTile,
  }];
  if (value.upper.length > 0) {
    floorTiers.push({
      id: 'upper',
      elevation: value.upperY,
      floorMask: value.upper,
      maskOriginTile,
    });
  }

  const transferFeatures = value.features.filter(feature => feature.type === 'transfer');
  const transferFeatureById = new Map(transferFeatures.map(feature => [feature.id, feature]));
  if (transferFeatureById.size !== transferFeatures.length) {
    fail(value.id, 'transfer feature ids must be unique');
  }
  for (const feature of transferFeatures) {
    const endpointRefs = TRANSFER_ENDPOINT_LOCAL_REFS[feature.id];
    if (!endpointRefs) {
      fail(value.id, `transfer ${feature.id} has no authored endpoint cell identities`);
    }
    for (const role of ['from', 'to']) {
      const endpoint = endpointRefs[role];
      if (!endpoint
        || !Number.isFinite(Number(endpoint.localElevation))
        || !exactLocalTile(endpoint.localTransferCell)
        || !footprintContainsExactCell(feature, endpoint.localTransferCell)) {
        fail(value.id, `transfer ${feature.id} ${role} endpoint is not an exact local transfer cell`);
      }
      const support = endpoint.localSupportRef;
      if (!support || !exactLocalTile(support.localTile)) {
        fail(value.id, `transfer ${feature.id} ${role} endpoint has no exact local support cell`);
      }
      if (support.kind === 'floor-cell') {
        const tier = floorTiers.find(candidate => candidate.id === support.floorTierId);
        if (!tier
          || Math.abs(Number(tier.elevation) - Number(endpoint.localElevation)) > 0.000001
          || !tierContainsExactFloorCell(tier, support.localTile)) {
          fail(value.id, `transfer ${feature.id} ${role} floor support is not an exact tier cell`);
        }
      } else if (support.kind === 'transfer-cell') {
        const supportingTransfer = transferFeatureById.get(support.transferId);
        if (!supportingTransfer
          || supportingTransfer === feature
          || !footprintContainsExactCell(supportingTransfer, support.localTile)) {
          fail(value.id, `transfer ${feature.id} ${role} transfer support is not an exact neighbor cell`);
        }
      } else {
        fail(value.id, `transfer ${feature.id} ${role} uses an unknown support kind`);
      }
    }
  }

  const sectionElevations = value.sectionRoute?.map(point => point[1]) ?? [];
  const socketElevations = value.sockets.map(socket => socket.y);
  const elevations = sectionElevations.length > 0 ? [...sectionElevations] : [...socketElevations];
  if (Number.isFinite(value.upperY)) elevations.push(value.upperY);
  const minElevation = Math.min(...elevations);
  const maxElevation = Math.max(...elevations);
  const entrySocket = value.sockets.find(socket => socket.role.includes('entry')) ?? value.sockets[0];
  const exitSocket = value.sockets.find(socket => socket.role.includes('reconnect'))
    ?? value.sockets[value.sockets.length - 1];
  const physicalTransfers = transferFeatures.map(feature => {
    const endpointRefs = TRANSFER_ENDPOINT_LOCAL_REFS[feature.id];
    return {
      id: feature.id,
      form: inferTransferForm(feature),
      tier: feature.tier ?? 'base',
      footprintTiles: {
        x: feature.x,
        z: feature.z,
        width: feature.w ?? 1,
        depth: feature.d ?? 1,
      },
      widthTiles: feature.w ?? 1,
      depthTiles: feature.d ?? 1,
      solid: feature.solid === true,
      elevationRangeMeters: { min: minElevation, max: maxElevation },
      endpoints: {
        from: {
          socketId: entrySocket?.id ?? null,
          elevation: endpointRefs.from.localElevation,
          ...cloneDungeonAugmentationValue(endpointRefs.from),
        },
        to: {
          socketId: exitSocket?.id ?? null,
          elevation: endpointRefs.to.localElevation,
          ...cloneDungeonAugmentationValue(endpointRefs.to),
        },
      },
    };
  });

  return deepFreezeDungeonAugmentationValue({
    schema: INDUSTRIAL_SUPPLEMENT_BLUEPRINT_SCHEMA,
    ...value,
    sockets,
    floorCellMeters: FLOOR_CELL_METERS,
    tileSizeMeters: FLOOR_CELL_METERS,
    dimensionsTiles: { width, depth },
    dimensionsMeters: {
      width: widthMeters,
      depth: depthMeters,
    },
    widthTiles: width,
    depthTiles: depth,
    widthMeters,
    depthMeters,
    baseMask: value.mask,
    floorTiers,
    physicalTransfers,
    stateIds,
    persistentStateIds: stateIds,
    voids: value.voids ?? [],
    sectionRoute: value.sectionRoute ?? [],
  });
}

const BLUEPRINT_DEFINITIONS = [
  {
    id: 'ind-junction-through-t-01',
    name: 'Through-T routing station',
    family: 'Corridor / 3-arm junction',
    purpose: 'A compact decision point with a protected 3×3 clear core and three genuinely traversable arms.',
    mask: ['.###.', '.###.', '.####', '.####', '.####', '.###.', '.###.'],
    upper: [], upperY: null,
    sockets: [
      { id: 'tt-n', side: 'N', center: 0, width: 3, y: 0, role: 'through' },
      { id: 'tt-s', side: 'S', center: 0, width: 3, y: 0, role: 'through' },
      { id: 'tt-e', side: 'E', center: 0, width: 3, y: 0, role: 'decision' },
    ],
    routes: [
      { tier: 'base', points: [[0, -3], [0, 0], [0, 3]] },
      { tier: 'base', points: [[0, 0], [2, 0]] },
    ],
    zones: [{ type: 'clear', id: 'tt-clear-core', x: 0, z: 0, w: 3, d: 3, label: 'CLEAR 3×3' }],
    features: [],
    traversal: 'N↔S is the through pair; E is the decision arm. All three approaches overlap the 3×3 clear core by one full tile.',
    gameplay: 'Qualifies as one active junction; no cap, prop, or ordinary bend can substitute for an arm.',
    state: 'None; topology is always active.',
  },
  {
    id: 'ind-junction-through-t-branch-entry-01',
    name: 'Through-T branch-entry routing station',
    family: 'Corridor / 3-arm junction',
    purpose: 'A branch-entry orientation of the compact Through-T, preserving the protected 3×3 clear core while dedicating the east arm to its authored-parent attachment.',
    mask: ['.###.', '.###.', '.####', '.####', '.####', '.###.', '.###.'],
    upper: [], upperY: null,
    sockets: [
      { id: 'ttb-n', side: 'N', center: 0, width: 3, y: 0, role: 'supplemental through' },
      { id: 'ttb-s', side: 'S', center: 0, width: 3, y: 0, role: 'supplemental through' },
      { id: 'ttb-e', side: 'E', center: 0, width: 3, y: 0, role: 'parent entry' },
    ],
    routes: [
      { tier: 'base', points: [[0, -3], [0, 0], [0, 3]] },
      { tier: 'base', points: [[0, 0], [2, 0]] },
    ],
    zones: [{ type: 'clear', id: 'ttb-clear-core', x: 0, z: 0, w: 3, d: 3, label: 'CLEAR 3×3' }],
    features: [],
    traversal: 'E is the parent-entry branch; N↔S is the supplemental through pair. All three approaches overlap the 3×3 clear core by one full tile.',
    gameplay: 'Qualifies as one active junction; its branch-entry orientation is authored rather than inferred by remapping the ordinary Through-T.',
    state: 'None; topology is always active.',
  },
  {
    id: 'ind-junction-crossroads-01',
    name: 'Crossroads routing station',
    family: 'Corridor / 4-arm junction',
    purpose: 'A symmetric four-way junction with an unobstructed 8.4 m square decision core and full-width approaches.',
    mask: ['..###..', '..###..', '#######', '#######', '#######', '..###..', '..###..'],
    upper: [], upperY: null,
    sockets: [
      { id: 'xr-n', side: 'N', center: 0, width: 3, y: 0, role: 'arm' },
      { id: 'xr-e', side: 'E', center: 0, width: 3, y: 0, role: 'arm' },
      { id: 'xr-s', side: 'S', center: 0, width: 3, y: 0, role: 'arm' },
      { id: 'xr-w', side: 'W', center: 0, width: 3, y: 0, role: 'arm' },
    ],
    routes: [
      { tier: 'base', points: [[0, -3], [0, 3]] },
      { tier: 'base', points: [[-3, 0], [3, 0]] },
    ],
    zones: [{ type: 'clear', id: 'xr-clear-core', x: 0, z: 0, w: 3, d: 3, label: 'CLEAR 3×3' }],
    features: [],
    traversal: 'Every approach pair is directly collision-walkable through the centered 3×3 core.',
    gameplay: 'Qualifies as one active four-arm station; the clear core rejects cover, spawns, hazards, supports, and gates.',
    state: 'None; topology is always active.',
  },
  {
    id: 'ind-junction-staggered-cross-01',
    name: 'Staggered cross',
    family: 'Corridor / offset 4-arm junction',
    purpose: 'A long-form junction that breaks sightlines while preserving four active arms and exact route continuity.',
    mask: ['.###.', '.###.', '####.', '####.', '####.', '.###.', '.###.', '.###.', '.####', '.####', '.####', '.###.', '.###.'],
    upper: [], upperY: null,
    sockets: [
      { id: 'sc-n', side: 'N', center: 0, width: 3, y: 0, role: 'through' },
      { id: 'sc-w', side: 'W', center: -3, width: 3, y: 0, role: 'decision' },
      { id: 'sc-e', side: 'E', center: 3, width: 3, y: 0, role: 'decision' },
      { id: 'sc-s', side: 'S', center: 0, width: 3, y: 0, role: 'through' },
    ],
    routes: [
      { tier: 'base', points: [[0, -6], [0, 6]] },
      { tier: 'base', points: [[-2, -3], [0, -3], [0, 3], [2, 3]] },
    ],
    zones: [
      { type: 'clear', id: 'sc-n-core', x: 0, z: -3, w: 3, d: 3, label: 'N CORE' },
      { type: 'clear', id: 'sc-s-core', x: 0, z: 3, w: 3, d: 3, label: 'S CORE' },
    ],
    features: [],
    traversal: 'N↔S remains continuous; W and E branch at z −3 and +3. Lateral exit centers are exactly 6 tiles / 16.8 m apart.',
    gameplay: 'Counts as one offset junction module, not two cosmetic bends; both branch cores remain clear.',
    state: 'None; topology is always active.',
  },
  {
    id: 'ind-loop-paired-t-h-01',
    name: 'Paired-T H loop',
    family: 'Corridor / local cycle module',
    purpose: 'Two physical T junctions split and rejoin around a central void, creating two playable loop directions.',
    mask: ['..###.....###..', '..###.....###..', '..###########..', '..###########..', '#####.....#####', '#####.....#####', '#####.....#####', '..###########..', '..###########..', '..###.....###..', '..###.....###..'],
    upper: [], upperY: null,
    sockets: [
      { id: 'hl-w', side: 'W', center: 0, width: 3, y: 0, role: 'entry' },
      { id: 'hl-e', side: 'E', center: 0, width: 3, y: 0, role: 'reconnect' },
    ],
    routes: [
      { tier: 'base', points: [[-7, 0], [-5, 0], [-5, -3], [5, -3], [5, 0], [7, 0]] },
      { tier: 'base', points: [[-5, 0], [-5, 3], [5, 3], [5, 0]] },
    ],
    zones: [
      { type: 'encounter', id: 'hl-challenge-zone', x: 0, z: -3, w: 5, d: 2, label: 'CHALLENGE' },
      { type: 'clear', id: 'hl-return-route', x: 0, z: 3, w: 5, d: 2, label: 'RETURN' },
    ],
    features: [
      { id: 'hl-control', type: 'control', x: 0, z: -3, w: 1, d: 1, label: 'C' },
      { id: 'hl-payoff', type: 'reward', x: 0, z: 3, w: 1, d: 1, label: 'R' },
    ],
    traversal: 'W entry splits at x −5; upper and lower arms reconnect at x +5 before E. Both directions are valid and cycle rank increases by exactly one.',
    gameplay: 'Upper arm hosts the challenge/control; lower arm hosts the payoff and return route. The center remains true non-floor void.',
    state: 'hl-encounter-cleared; hl-mechanism-activated; hl-reward-claimed.',
  },
  {
    id: 'ind-interchange-stacked-01',
    name: 'Stacked interchange',
    family: 'Corridor / vertical 4-socket transfer',
    purpose: 'A lower north–south route and upper east–west route connected by one explicit, reversible industrial lift.',
    mask: ['...###...', '...###...', '...###...', '...###...', '...###...', '...####..', '...####..', '...####..', '...###...', '...###...', '...###...', '...###...', '...###...'],
    upper: ['.........', '.........', '.........', '.........', '.........', '#########', '#########', '#########', '.........', '.........', '.........', '.........', '.........'],
    upperY: 5.6,
    sockets: [
      { id: 'si-n0', side: 'N', center: 0, width: 3, y: 0, role: 'lower through' },
      { id: 'si-s0', side: 'S', center: 0, width: 3, y: 0, role: 'lower through' },
      { id: 'si-w2', side: 'W', center: 0, width: 3, y: 5.6, role: 'upper through' },
      { id: 'si-e2', side: 'E', center: 0, width: 3, y: 5.6, role: 'upper through' },
    ],
    routes: [
      { tier: 'base', points: [[0, -6], [0, 0], [2, 0]] },
      { tier: 'base', points: [[0, 0], [0, 6]] },
      { tier: 'upper', points: [[-4, 0], [2, 0], [4, 0]] },
    ],
    zones: [{ type: 'clear', id: 'si-lift-landings', x: 2, z: 0, w: 1, d: 3, label: 'LANDINGS' }],
    features: [{ id: 'si-lift-01', type: 'transfer', x: 2, z: 0, w: 1, d: 1, label: 'L', solid: true }],
    traversal: 'N↔S at y 0.00 m; W↔E at y +5.60 m. The lift at (2,0) is the only adjacency and has 5.6 m clear landings on both tiers.',
    gameplay: 'Initial lift call is local-only. Both tiers retain return paths after activation; upper structure leaves at least 3.6 m lower headroom.',
    state: 'si-lift-enabled; si-lift-position; si-call-lower; si-call-upper.',
  },
  {
    id: 'ind-crossover-over-under-01',
    name: 'Over-under crossover',
    family: 'Corridor / grade-separated crossover',
    purpose: 'Two routes cross in plan without graph adjacency, preventing accidental shortcuts between progression domains.',
    mask: ['.......', '.......', '#######', '#######', '#######', '.......', '.......'],
    upper: ['..###..', '..###..', '..###..', '..###..', '..###..', '..###..', '..###..'],
    upperY: 5.6,
    sockets: [
      { id: 'ou-w0', side: 'W', center: 0, width: 3, y: 0, role: 'lower through' },
      { id: 'ou-e0', side: 'E', center: 0, width: 3, y: 0, role: 'lower through' },
      { id: 'ou-n2', side: 'N', center: 0, width: 3, y: 5.6, role: 'upper through' },
      { id: 'ou-s2', side: 'S', center: 0, width: 3, y: 5.6, role: 'upper through' },
    ],
    routes: [
      { tier: 'base', points: [[-3, 0], [3, 0]] },
      { tier: 'upper', points: [[0, -3], [0, 3]] },
    ],
    zones: [],
    features: [
      { id: 'ou-support-nw', type: 'machine', x: -2, z: -2, w: 1, d: 1, label: 'S', solid: true },
      { id: 'ou-support-se', type: 'machine', x: 2, z: 2, w: 1, d: 1, label: 'S', solid: true },
    ],
    traversal: 'W↔E at y 0.00 m; N↔S at y +5.60 m. No lift, ladder, ramp, gate, or nav edge joins them.',
    gameplay: 'This is a crossover, never a junction. Support collisions sit outside both three-tile route footprints.',
    state: 'None; the two routes remain permanently disconnected.',
  },
  {
    id: 'ind-room-reaverbot-foundry-01',
    name: 'Reaverbot foundry challenge',
    family: 'Room / combat challenge',
    purpose: 'An authored press hall with a readable central landmark, two flank lanes, role-specific cover, and a reachable ranged perch.',
    mask: ['....###....', '...#####...', '..#######..', '.#########.', '###########', '###########', '###########', '.#########.', '..#######..', '...#####...', '....###....'],
    upper: ['...........', '...........', '.......###.', '.......###.', '.......###.', '...........', '...........', '...........', '...........', '...........', '...........'],
    upperY: 2.8,
    sockets: [
      { id: 'rf-s', side: 'S', center: 0, width: 3, y: 0, role: 'entry' },
      { id: 'rf-n', side: 'N', center: 0, width: 3, y: 0, role: 'reconnect' },
    ],
    routes: [
      { tier: 'base', points: [[0, 5], [-3, 2], [-3, -2], [0, -5]] },
      { tier: 'base', points: [[0, 5], [3, 2], [3, -2], [0, -5]] },
      { tier: 'upper', points: [[4, 1], [4, -1], [3, -2]] },
    ],
    zones: [
      { type: 'encounter', id: 'rf-encounter-zone', x: 0, z: 0, w: 9, d: 7, label: 'REAVERBOT ZONE' },
      { type: 'clear', id: 'rf-entry-read', x: 0, z: 4, w: 3, d: 2, label: 'SAFE READ' },
    ],
    features: [
      { id: 'rf-press-column-w', type: 'machine', x: -2, z: 0, w: 1, d: 1, label: 'P', solid: true },
      { id: 'rf-press-column-e', type: 'machine', x: 2, z: 0, w: 1, d: 1, label: 'P', solid: true },
      { id: 'rf-crates-w', type: 'cover', x: -3, z: 2, w: 1, d: 2, label: '½', solid: true },
      { id: 'rf-crates-e', type: 'cover', x: 3, z: 2, w: 1, d: 2, label: '½', solid: true },
      // A 2.8 m tier change needs at least six movement intervals under the
      // shared 0.55 m-per-tile envelope. Seven authored cells provide both
      // endpoint samples and keep the physical slope deterministic.
      { id: 'rf-ramp', type: 'transfer', x: 4, z: 1, w: 1, d: 7, label: '↗' },
      { id: 'rf-frontline', type: 'spawn', x: 0, z: -3, w: 1, d: 1, label: 'F' },
      { id: 'rf-flank-w', type: 'spawn', x: -4, z: 1, w: 1, d: 1, label: 'L' },
      // This cell is also part of the ramp/upper-perch projection. Pin the
      // flank spawn to the base arena so physical realization never has to
      // infer between two valid authored elevations.
      { id: 'rf-flank-e', type: 'spawn', x: 4, z: 1, w: 1, d: 1, label: 'L', tier: 'base' },
      { id: 'rf-perch', type: 'spawn', x: 3, z: -2, w: 1, d: 1, label: 'P', tier: 'upper' },
    ],
    traversal: 'A 3-tile through lane and two 2-tile flank lanes connect S entry to N reconnect. The seven-cell east ramp reaches the +2.80 m perch within the shared movement envelope without blocking return travel.',
    gameplay: 'Recipe supplement-route-network-defense: basic frontline, fast flank pair, ranged perch; high difficulty may replace the perch unit with Horokko. Only this network exit clears.',
    state: 'rf-encounter-cleared; no global hazard action.',
  },
  {
    id: 'ind-room-treatment-control-01',
    name: 'Treatment control chamber',
    family: 'Room / hazard + mechanism',
    purpose: 'A central hazard forces a visible bypass to an elevated local control without sacrificing a safe approach or return lane.',
    mask: ['....###....', '...#####...', '..#######..', '.#########.', '###########', '###########', '###########', '.#########.', '..#######..', '...#####...', '....###....'],
    upper: ['...........', '...........', '...........', '...........', '...........', '...........', '...........', '........##.', '........##.', '...........', '...........'],
    upperY: 2.8,
    sockets: [
      { id: 'tc-s', side: 'S', center: 0, width: 3, y: 0, role: 'entry' },
      { id: 'tc-n', side: 'N', center: 0, width: 3, y: 0, role: 'reconnect' },
    ],
    routes: [
      { tier: 'base', points: [[0, 5], [-3, 2], [-3, -2], [0, -5]] },
      { tier: 'base', points: [[0, 5], [3, 2], [3, -2], [0, -5]] },
      { tier: 'upper', points: [[4, 1], [4, 2], [3, 3]] },
    ],
    zones: [
      { type: 'hazard', id: 'tc-treatment-field', x: 0, z: 0, w: 3, d: 3, label: 'HAZARD' },
      { type: 'clear', id: 'tc-safe-approach', x: 0, z: 4, w: 3, d: 2, label: 'SAFE READ' },
    ],
    features: [
      { id: 'tc-emitter', type: 'machine', x: 0, z: 0, w: 1, d: 1, label: 'E', solid: true },
      { id: 'tc-bulkhead', type: 'cover', x: -3, z: 1, w: 1, d: 2, label: 'F', solid: true },
      { id: 'tc-valve-bank', type: 'cover', x: 3, z: -2, w: 1, d: 2, label: '½', solid: true },
      { id: 'tc-ramp', type: 'transfer', x: 4, z: 0, w: 1, d: 7, label: '↗' },
      { id: 'tc-control', type: 'control', x: 3, z: 3, w: 1, d: 1, label: 'C', tier: 'upper' },
    ],
    traversal: 'S safe approach splits into two 2-tile bypasses around the 3×3 armed field; both reconnect at N. The seven-cell east ramp reaches the +2.80 m control deck within the shared movement envelope.',
    gameplay: 'The console changes only tc-treatment-field from armed to isolated, adding a 3-tile center crossing. Enemy anchors are restricted to safe floor and the deck.',
    state: 'tc-mechanism-activated; tc-hazard-disabled; tc-encounter-cleared.',
  },
  {
    id: 'ind-room-ladder-defense-rise-01',
    name: 'Ladder relay defense',
    family: 'Elevation room / ladder challenge',
    purpose: 'A compact defense floor feeds a permanently deployed ladder and an upper relay bridge exactly one 2.8 m tier above the entry.',
    mask: ['.........', '.........', '.........', '.........', '.........', '....#####', '..#######', '..#######', '.########', '.#######.', '...###...'],
    upper: ['...###...', '.#######.', '#########', '#########', '#########', '....#####', '.........', '.........', '.........', '.........', '.........'],
    upperY: 2.8,
    sockets: [
      { id: 'ldr-s0', side: 'S', center: 0, width: 3, y: 0, role: 'entry lower' },
      { id: 'ldr-n1', side: 'N', center: 0, width: 3, y: 2.8, role: 'reconnect upper' },
    ],
    routes: [
      { tier: 'base', points: [[0, 5], [0, 3], [-1, 2], [2, 1], [2, 0]] },
      { tier: 'upper', points: [[2, 0], [2, -1], [0, -3], [0, -5]] },
    ],
    zones: [
      { type: 'encounter', id: 'ldr-defense-zone', x: 0, z: 2, w: 5, d: 3, label: 'DEFENSE' },
      { type: 'clear', id: 'ldr-lower-mount-clear', x: 2, z: 1, w: 3, d: 3, label: 'LOWER 3x3' },
      { type: 'clear', id: 'ldr-upper-landing-clear', x: 2, z: -1, w: 3, d: 3, label: 'UPPER 3x3' },
    ],
    features: [
      {
        id: 'ldr-ladder',
        type: 'transfer',
        x: 2,
        z: 0,
        w: 1,
        d: 1,
        label: 'L',
        form: 'ladder',
        persistentStateId: 'ldr-ladder-deployed',
      },
      { id: 'ldr-relay-stack', type: 'machine', x: -3, z: 3, w: 1, d: 1, label: 'R', solid: true },
      { id: 'ldr-cover-west', type: 'cover', x: -2, z: 1, w: 1, d: 2, label: 'M', solid: true },
      { id: 'ldr-cover-east', type: 'cover', x: 1, z: 3, w: 1, d: 1, label: '1/2', solid: true },
      { id: 'ldr-frontline', type: 'spawn', x: 0, z: 3, w: 1, d: 1, label: 'F', tier: 'base' },
      { id: 'ldr-flank', type: 'spawn', x: -2, z: 2, w: 1, d: 1, label: 'L', tier: 'base' },
      { id: 'ldr-perch', type: 'spawn', x: -2, z: -3, w: 1, d: 1, label: 'P', tier: 'upper' },
    ],
    sectionRoute: [[0, 0], [0.48, 0], [0.48, 2.8], [1, 2.8]],
    traversal: 'S y 0.00 m crosses the defense floor to a clear 3x3 lower mount, climbs the deployed ladder, and leaves through a clear 3x3 upper landing to N y +2.80 m. Reverse travel is always available.',
    gameplay: 'Frontline and flank roles pressure the lower arena while the ranged perch reads from the upper bridge. Clearing the encounter never deploys, retracts, or disables the ladder.',
    state: 'ldr-encounter-cleared; ldr-ladder-deployed.',
  },
  {
    id: 'ind-room-lift-defense-rise-01',
    name: 'Cargo lift defense',
    family: 'Elevation room / lift challenge',
    purpose: 'A compact loading-floor defense wraps a permanently enabled two-stop lift and reconnects on an upper dispatch gallery 2.8 m higher.',
    mask: ['.........', '.........', '.........', '.........', '.........', '#####....', '#########', '#########', '#########', '.#######.', '...###...'],
    upper: ['...###...', '.#######.', '#########', '#########', '#########', '#####....', '.........', '.........', '.........', '.........', '.........'],
    upperY: 2.8,
    sockets: [
      { id: 'lft-s0', side: 'S', center: 0, width: 3, y: 0, role: 'entry lower' },
      { id: 'lft-n1', side: 'N', center: 0, width: 3, y: 2.8, role: 'reconnect upper' },
    ],
    routes: [
      { tier: 'base', points: [[0, 5], [0, 3], [1, 2], [-2, 1], [-2, 0]] },
      { tier: 'upper', points: [[-2, 0], [-2, -1], [0, -3], [0, -5]] },
    ],
    zones: [
      { type: 'encounter', id: 'lft-loading-defense-zone', x: 1, z: 2, w: 5, d: 3, label: 'DEFENSE' },
      { type: 'clear', id: 'lft-lower-board-clear', x: -2, z: 1, w: 3, d: 3, label: 'LOWER 3x3' },
      { type: 'clear', id: 'lft-upper-land-clear', x: -2, z: -1, w: 3, d: 3, label: 'UPPER 3x3' },
    ],
    features: [
      {
        id: 'lft-cargo-lift',
        type: 'transfer',
        x: -2,
        z: 0,
        w: 2,
        d: 2,
        label: 'L',
        solid: true,
        form: 'lift',
        persistentStateIds: ['lft-lift-enabled', 'lft-lift-position'],
      },
      { id: 'lft-call-lower', type: 'control', x: -4, z: 2, w: 1, d: 1, label: 'C', tier: 'base', persistentStateId: 'lft-call-lower' },
      { id: 'lft-call-upper', type: 'control', x: -4, z: -2, w: 1, d: 1, label: 'C', tier: 'upper', persistentStateId: 'lft-call-upper' },
      { id: 'lft-hoist-motor', type: 'machine', x: 4, z: 1, w: 1, d: 1, label: 'H', solid: true },
      { id: 'lft-cover-center', type: 'cover', x: 1, z: 1, w: 1, d: 2, label: 'M', solid: true },
      { id: 'lft-cover-east', type: 'cover', x: 3, z: 3, w: 1, d: 1, label: '1/2', solid: true },
      { id: 'lft-frontline', type: 'spawn', x: 0, z: 3, w: 1, d: 1, label: 'F', tier: 'base' },
      { id: 'lft-flank', type: 'spawn', x: 3, z: 2, w: 1, d: 1, label: 'L', tier: 'base' },
      { id: 'lft-perch', type: 'spawn', x: 2, z: -3, w: 1, d: 1, label: 'P', tier: 'upper' },
    ],
    sectionRoute: [[0, 0], [0.42, 0], [0.42, 2.8], [1, 2.8]],
    traversal: 'S y 0.00 m reaches a clear 3x3 lower boarding pad, rides the enabled lift, and exits through a clear 3x3 upper landing to N y +2.80 m. Both calls work from the initial state and after encounter clear.',
    gameplay: 'Frontline and flank roles occupy the loading floor while the ranged perch overlooks the upper gallery. The encounter cannot lock, disable, or globally repurpose the lift.',
    state: 'lft-encounter-cleared; lft-lift-enabled; lft-lift-position; lft-call-lower; lft-call-upper.',
  },
  {
    id: 'ind-room-compact-ramp-defense-rise-01',
    name: 'Compact ramp defense rise',
    family: 'Compact elevation room / ramp challenge',
    purpose: 'A dense objective-coverage challenge built around one broad, permanently bidirectional industrial ramp that rises exactly one 2.8 m tier.',
    mask: [
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
      '#######',
      '#######',
      '#######',
      '..###..',
    ],
    upper: [
      '..###..',
      '#######',
      '#######',
      '#######',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
    ],
    upperY: 2.8,
    sockets: [
      { id: 'crd-s0', side: 'S', center: 0, width: 3, y: 0, role: 'entry lower' },
      { id: 'crd-n1', side: 'N', center: 0, width: 3, y: 2.8, role: 'reconnect upper' },
    ],
    routes: [
      { tier: 'base', points: [[0, 5], [0, 4], [0, 3], [0, 2]] },
      { tier: 'upper', points: [[0, -2], [0, -3], [0, -4], [0, -5]] },
    ],
    zones: [
      { type: 'encounter', id: 'crd-defense-zone', x: 0, z: 3, w: 7, d: 3, label: 'RAMP DEFENSE' },
      { type: 'clear', id: 'crd-lower-landing-clear', x: 0, z: 3, w: 3, d: 3, label: 'LOWER 3x3' },
      { type: 'clear', id: 'crd-upper-landing-clear', x: 0, z: -3, w: 3, d: 3, label: 'UPPER 3x3' },
    ],
    features: [
      {
        id: 'crd-service-ramp',
        type: 'transfer',
        x: 0,
        z: 0,
        w: 3,
        d: 7,
        label: '14.3%',
        form: 'ramp',
      },
      { id: 'crd-drive-housing', type: 'machine', x: 3, z: 2, w: 1, d: 1, label: 'D', solid: true },
      { id: 'crd-cover-west', type: 'cover', x: -2, z: 2, w: 1, d: 1, label: 'M', solid: true, tier: 'base' },
      { id: 'crd-cover-east', type: 'cover', x: 2, z: 4, w: 1, d: 1, label: '1/2', solid: true, tier: 'base' },
      { id: 'crd-frontline', type: 'spawn', x: 0, z: 3, w: 1, d: 1, label: 'F', tier: 'base' },
      { id: 'crd-flank', type: 'spawn', x: -2, z: 4, w: 1, d: 1, label: 'L', tier: 'base' },
      { id: 'crd-perch', type: 'spawn', x: 2, z: -3, w: 1, d: 1, label: 'P', tier: 'upper' },
    ],
    sectionRoute: [[0, 0], [0.18, 0], [0.82, 2.8], [1, 2.8]],
    traversal: 'S y 0.00 m crosses a clear 3x3 lower landing, climbs the 3-tile-wide 19.6 m service ramp at a 14.3% grade, crosses a clear 3x3 upper landing, and reconnects at N y +2.80 m. The transfer and both landings are permanently bidirectional.',
    gameplay: 'Recipe supplement-route-network-defense uses a lower frontline, a side-lane flanker, and an upper ranged perch. Cover and the drive housing remain outside the centered three-tile traversal lane, and encounter clear never gates the ramp.',
    state: 'crd-encounter-cleared.',
  },
  {
    id: 'ind-room-maintenance-rise-01',
    name: 'Maintenance rise',
    family: 'Room / vertical mechanism',
    purpose: 'A split-level maintenance chamber built around a real shaft, with an upper regulator required before reconnection.',
    mask: ['...###...', '..#####..', '.#######.', '#########', '###...###', '###...###', '###...###', '#########', '.#######.', '..#####..', '...###...'],
    upper: ['.........', '.........', '.........', '.........', '##.....##', '##.....##', '##.....##', '#########', '.#######.', '..#####..', '...###...'],
    upperY: 2.8,
    sockets: [
      { id: 'mr-n0', side: 'N', center: 0, width: 3, y: 0, role: 'entry' },
      { id: 'mr-s1', side: 'S', center: 0, width: 3, y: 2.8, role: 'upper reconnect' },
    ],
    routes: [
      { tier: 'base', points: [[0, -5], [0, -3], [-2.5, -2], [-2.5, 3]] },
      { tier: 'upper', points: [[-2.5, 3], [0, 3], [0, 5]] },
    ],
    zones: [{ type: 'clear', id: 'mr-shaft-keepout', x: 0, z: 0, w: 3, d: 3, label: 'SHAFT VOID' }],
    voids: [{ id: 'mr-open-shaft', x: 0, z: 0, w: 3, d: 3, label: 'OPEN SHAFT' }],
    features: [
      {
        id: 'mr-switchback-ramp',
        type: 'transfer',
        x: -2.5,
        z: 1,
        w: 2,
        d: 7,
        label: '16.7%',
        form: 'ramp',
      },
      { id: 'mr-counterweight', type: 'machine', x: 0, z: 0, w: 1, d: 3, label: 'W', solid: true },
      { id: 'mr-lift-platform', type: 'transfer', x: 0, z: 0, w: 3, d: 3, label: 'L', solid: true },
      { id: 'mr-regulator', type: 'control', x: 3, z: 2, w: 1, d: 1, label: 'C', tier: 'upper' },
      { id: 'mr-lockers', type: 'cover', x: 2, z: 3, w: 1, d: 2, label: '½', solid: true, tier: 'upper' },
    ],
    sectionRoute: [[0, 0], [0.18, 0], [0.82, 2.8], [1, 2.8]],
    traversal: 'N entry reaches the lower deck; the seven-cell west switchback provides six playable rise intervals to y +2.80 m and the upper route reaches S. A complete bidirectional return exists before lift activation.',
    gameplay: 'The 3×3 shaft is true base-tier void. The optional freight lift becomes available only from the upper regulator and never replaces the required ramp.',
    state: 'mr-lift-enabled; mr-lift-position; mr-mechanism-activated.',
  },
  {
    id: 'ind-room-dispatch-vault-01',
    name: 'Dispatch reward vault',
    family: 'Room / distinct payoff',
    purpose: 'A compact reward room with a safely collectible dais, two circulation lanes, and no progression-critical loot.',
    mask: ['...###...', '..#####..', '.#######.', '#########', '#########', '#########', '#########', '..#####..', '...###...'],
    upper: [], upperY: null,
    sockets: [
      { id: 'dv-s', side: 'S', center: 0, width: 3, y: 0, role: 'entry' },
      { id: 'dv-n', side: 'N', center: 0, width: 3, y: 0, role: 'reconnect' },
    ],
    routes: [
      { tier: 'base', points: [[0, 4], [-3, 2], [-2, 0], [0, -4]] },
      { tier: 'base', points: [[0, 4], [3, 2], [2, 0], [0, -4]] },
      { tier: 'base', points: [[0, 4], [0, 2]] },
    ],
    zones: [{ type: 'clear', id: 'dv-collect-clearance', x: 0, z: 2, w: 4, d: 4, label: 'COLLECT' }],
    features: [
      { id: 'dv-partition-w', type: 'cover', x: -2, z: 1.5, w: 1, d: 3, label: 'M', solid: true },
      { id: 'dv-partition-e', type: 'cover', x: 2, z: 1.5, w: 1, d: 3, label: 'M', solid: true },
      { id: 'dv-dispatch-board', type: 'machine', x: -3, z: 2, w: 1, d: 1, label: 'D', solid: true },
      { id: 'dv-dais', type: 'machine', x: 0, z: 2, w: 2, d: 2, label: 'D' },
      { id: 'dv-reward', type: 'reward', x: 0, z: 2, w: 1, d: 1, label: 'R' },
    ],
    traversal: 'Two 2-tile lanes wrap the mesh partitions and low dais; S↔N and the return route remain passable before and after collection.',
    gameplay: 'Reward profile supplement-treasure-cache has one tile of pickup clearance on every side, is idempotent, and is never progression-critical.',
    state: 'dv-reward-claimed.',
  },
  {
    id: 'ind-room-observation-break-01',
    name: 'Observation break room',
    family: 'Room / calm discovery',
    purpose: 'A low-pressure discovery beat with a readable maintenance story, optional cache, and direct through route.',
    mask: ['...###...', '..#####..', '.#######.', '#########', '#########', '#########', '#########', '..#####..', '...###...'],
    upper: ['.........', '.........', '.........', '.........', '.........', '......##.', '......##.', '.........', '.........'],
    upperY: 0.7,
    sockets: [
      { id: 'ob-s', side: 'S', center: 0, width: 3, y: 0, role: 'entry' },
      { id: 'ob-n', side: 'N', center: 0, width: 3, y: 0, role: 'reconnect' },
    ],
    routes: [
      { tier: 'base', points: [[0, 4], [0, -4]] },
      { tier: 'base', points: [[0, 1], [-3, 2]] },
      { tier: 'upper', points: [[2, 0], [2, 2]] },
    ],
    zones: [{ type: 'clear', id: 'ob-through-route', x: 0, z: 0, w: 3, d: 9, label: 'DIRECT ROUTE' }],
    features: [
      { id: 'ob-lockers', type: 'cover', x: -3, z: 2, w: 1, d: 2, label: 'M', solid: true },
      { id: 'ob-lore', type: 'control', x: -3, z: 2, w: 1, d: 1, label: 'i' },
      { id: 'ob-table', type: 'cover', x: 2, z: 0, w: 2, d: 1, label: '½', solid: true },
      { id: 'ob-step', type: 'transfer', x: 2, z: 0, w: 1, d: 1, label: '↗' },
      { id: 'ob-cache', type: 'reward', x: -2, z: 2, w: 1, d: 1, label: 'R' },
      { id: 'ob-map', type: 'control', x: 2.5, z: 1.5, w: 1, d: 1, label: 'i', tier: 'upper' },
    ],
    traversal: 'A centered 3-tile lane runs S↔N. The west archive and +0.70 m observation tier are optional one-tile spurs and never block reconnection.',
    gameplay: 'No mandatory encounter. Lore and optional cache are separate interactions; this room is pacing content and cannot replace an independent challenge or payoff.',
    state: 'ob-discovery-read; ob-cache-claimed.',
  },
  {
    id: 'ind-rise-switchback-ramp-01',
    name: 'Twin-flight switchback rise',
    family: 'Elevation corridor / ramp',
    purpose: 'A two-flight industrial ramp that turns 180 degrees at a protected intermediate landing and gains one full 2.8 m tier.',
    mask: ['.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '..#####..', '..#####..', '...###...'],
    upper: ['...###...', '..#####..', '..#####..', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'],
    upperY: 2.8,
    sockets: [
      { id: 'sr-s0', side: 'S', center: 0, width: 3, y: 0, role: 'entry lower' },
      { id: 'sr-n1', side: 'N', center: 0, width: 3, y: 2.8, role: 'reconnect upper' },
    ],
    routes: [
      { tier: 'base', points: [[0, 6], [0, 5], [-2, 4], [-2, 2]] },
      { tier: 'upper', points: [[2, -2], [2, -4], [0, -5], [0, -6]] },
    ],
    zones: [
      { type: 'clear', id: 'sr-lower-landing', x: 0, z: 5, w: 3, d: 2, label: 'LOWER' },
      { type: 'clear', id: 'sr-upper-landing', x: 0, z: -5, w: 3, d: 2, label: 'UPPER' },
    ],
    features: [
      { id: 'sr-flight-lower', type: 'transfer', x: -2, z: 2, w: 2, d: 5, label: 'R1', form: 'ramp' },
      { id: 'sr-mid-landing', type: 'transfer', x: 0, z: 0, w: 5, d: 2, label: '+1.4', form: 'landing' },
      { id: 'sr-flight-upper', type: 'transfer', x: 2, z: -2, w: 2, d: 5, label: 'R2', form: 'ramp' },
    ],
    sectionRoute: [[0, 0], [0.42, 1.4], [0.58, 1.4], [1, 2.8]],
    traversal: 'S socket y 0.00 m → lower flight → y +1.40 m turn landing → upper flight → N socket y +2.80 m. Both ramps are 2 tiles wide with 2-tile level landings.',
    gameplay: 'Continuous slope collision, edge guards, and bidirectional nav are mandatory; no flat path bypasses the elevation gain.',
    state: 'None; the transfer is permanently bidirectional.',
  },
  {
    id: 'ind-rise-stair-cascade-01',
    name: 'Three-landing stair cascade',
    family: 'Elevation corridor / stairs',
    purpose: 'A broad transverse stair sequence with a central rest landing and a two-tier, 5.6 m exit difference.',
    mask: ['.............', '.............', '#####........', '#####........', '#####........', '.............', '.............'],
    upper: ['.............', '.............', '........#####', '........#####', '........#####', '.............', '.............'],
    upperY: 5.6,
    sockets: [
      { id: 'scd-w0', side: 'W', center: 0, width: 3, y: 0, role: 'entry lower' },
      { id: 'scd-e2', side: 'E', center: 0, width: 3, y: 5.6, role: 'reconnect upper' },
    ],
    routes: [
      { tier: 'base', points: [[-6, 0], [-4, 0], [-2, 0]] },
      { tier: 'upper', points: [[2, 0], [4, 0], [6, 0]] },
    ],
    zones: [
      { type: 'clear', id: 'scd-west-landing', x: -4, z: 0, w: 2, d: 3, label: 'y 0' },
      { type: 'clear', id: 'scd-east-landing', x: 4, z: 0, w: 2, d: 3, label: 'y 5.6' },
    ],
    features: [
      { id: 'scd-flight-01', type: 'transfer', x: -3, z: 0, w: 7, d: 3, label: 'S1', form: 'stairs' },
      { id: 'scd-rest', type: 'transfer', x: 0, z: 0, w: 3, d: 3, label: '+2.8', form: 'landing' },
      { id: 'scd-flight-02', type: 'transfer', x: 3, z: 0, w: 7, d: 3, label: 'S2', form: 'stairs' },
    ],
    sectionRoute: [[0, 0], [0.42, 2.8], [0.58, 2.8], [1, 5.6]],
    traversal: 'W socket y 0.00 m → first stair → y +2.80 m rest landing → second stair → E socket y +5.60 m. Full-width top and bottom landings remain clear.',
    gameplay: 'Stepped collision and nav use the same rise/run record; railings never intrude into the 3-tile stair footprint.',
    state: 'None; the transfer is permanently bidirectional.',
  },
  {
    id: 'ind-rise-freight-lift-dogleg-01',
    name: 'Freight-lift dogleg',
    family: 'Elevation corridor / lift',
    purpose: 'A right-angle connector whose two exits differ by 5.6 m and are joined by a two-stop freight lift with clear calls on both tiers.',
    mask: ['.........', '.........', '.........', '.........', '.........', '...####..', '...####..', '...####..', '...###...', '...###...', '...###...'],
    upper: ['.........', '.........', '.....####', '.....####', '.....####', '.....##..', '.........', '.........', '.........', '.........', '.........'],
    upperY: 5.6,
    sockets: [
      { id: 'fl-s0', side: 'S', center: 0, width: 3, y: 0, role: 'entry lower' },
      { id: 'fl-e2', side: 'E', center: -2, width: 3, y: 5.6, role: 'reconnect upper' },
    ],
    routes: [
      { tier: 'base', points: [[0, 5], [0, 2], [2, 0]] },
      { tier: 'upper', points: [[2, 0], [2, -2], [4, -2]] },
    ],
    zones: [{ type: 'clear', id: 'fl-boarding-clearance', x: 2, z: 0, w: 3, d: 3, label: 'BOARD' }],
    features: [
      { id: 'fl-cab', type: 'transfer', x: 2, z: 0, w: 2, d: 2, label: 'L', solid: true, form: 'lift' },
      { id: 'fl-call-lower', type: 'control', x: 1, z: 1, w: 1, d: 1, label: 'C' },
      { id: 'fl-call-upper', type: 'control', x: 3, z: -1, w: 1, d: 1, label: 'C', tier: 'upper' },
    ],
    sectionRoute: [[0, 0], [0.46, 0], [0.46, 5.6], [1, 5.6]],
    traversal: 'S socket y 0.00 m reaches the lower call and cab; the cab rises exactly 5.60 m; the upper dogleg reaches E with a 3×2 clear exit landing.',
    gameplay: 'The mandatory lift is available from both stops, restores its position on load, and can never be disabled by an encounter or global hazard action.',
    state: 'fl-lift-position; fl-call-lower; fl-call-upper.',
  },
  {
    id: 'ind-rise-ladder-bridge-01',
    name: 'Ladder-to-bridge elbow',
    family: 'Elevation corridor / ladder',
    purpose: 'A compact elbow that climbs from a lower west service trench to an upper north bridge without implying adjacency at the crossing.',
    mask: ['.........', '.........', '.........', '.........', '.........', '#####....', '#####....', '#####....', '.........'],
    upper: ['...###...', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...', '.........', '.........'],
    upperY: 2.8,
    sockets: [
      { id: 'lb-w0', side: 'W', center: 2, width: 3, y: 0, role: 'entry lower' },
      { id: 'lb-n1', side: 'N', center: 0, width: 3, y: 2.8, role: 'reconnect upper' },
    ],
    routes: [
      { tier: 'base', points: [[-4, 2], [-2, 2], [0, 2]] },
      { tier: 'upper', points: [[0, 2], [0, 0], [0, -4]] },
    ],
    zones: [{ type: 'clear', id: 'lb-dismounts', x: 0, z: 2, w: 3, d: 3, label: 'MOUNT' }],
    features: [
      { id: 'lb-ladder', type: 'transfer', x: 0, z: 2, w: 1, d: 1, label: 'L', form: 'ladder' },
      { id: 'lb-guardrail', type: 'cover', x: 1, z: 1, w: 1, d: 3, label: 'G', solid: true, tier: 'upper' },
    ],
    sectionRoute: [[0, 0], [0.52, 0], [0.52, 2.8], [1, 2.8]],
    traversal: 'W socket y 0.00 m → lower mount → enclosed ladder → upper dismount y +2.80 m → N bridge. Both mount tiles and the upper opening remain unobstructed.',
    gameplay: 'The ladder is bidirectional; the upper guardrail protects the edge while leaving the dismount and return turn clear.',
    state: 'None; the ladder is permanently deployed.',
  },
  {
    id: 'ind-room-turbine-helix-01',
    name: 'Turbine helix exchange',
    family: 'Elevation room / combat helix',
    purpose: 'Two long ramp flights wrap a protected turbine volume, turn at a northwest landing, and reconnect on a perpendicular upper exit.',
    mask: ['.............', '.............', '.............', '.............', '.............', '.............', '.............', '.............', '.............', '.###########.', '.###########.', '#############', '.....###.....'],
    upper: ['.............', '.........###.', '.........###.', '.........###.', '.........###.', '.........####', '.........####', '.........####', '.........###.', '.........###.', '.............', '.............', '.............'],
    upperY: 2.8,
    sockets: [
      { id: 'ta-s0', side: 'S', center: 0, width: 3, y: 0, role: 'entry lower' },
      { id: 'ta-e1', side: 'E', center: 0, width: 3, y: 2.8, role: 'reconnect upper' },
    ],
    routes: [
      { tier: 'base', points: [[0, 6], [0, 4], [-4, 3], [-4, 1]] },
      { tier: 'upper', points: [[1, -4], [4, -4], [4, 0], [6, 0]] },
    ],
    zones: [
      { type: 'encounter', id: 'ta-lower-encounter', x: 0, z: 4, w: 9, d: 3, label: 'LOWER FIGHT' },
      { type: 'encounter', id: 'ta-upper-encounter', x: 4, z: -1, w: 3, d: 7, label: 'UPPER FIGHT' },
    ],
    voids: [{ id: 'ta-turbine-void', x: 0, z: 0, w: 5, d: 5, label: 'TURBINE VOID' }],
    features: [
      { id: 'ta-turbine', type: 'machine', x: 0, z: 0, w: 5, d: 5, label: 'T', solid: true },
      { id: 'ta-ramp-west', type: 'transfer', x: -4, z: 0, w: 3, d: 7, label: 'R1', form: 'ramp' },
      { id: 'ta-turn-landing', type: 'transfer', x: -4, z: -4, w: 3, d: 3, label: '+1.4', form: 'landing' },
      { id: 'ta-ramp-north', type: 'transfer', x: 0, z: -4, w: 9, d: 3, label: 'R2', form: 'ramp' },
      { id: 'ta-frontline', type: 'spawn', x: 0, z: 3, w: 1, d: 1, label: 'F' },
      { id: 'ta-flank-west', type: 'spawn', x: -4, z: 0, w: 1, d: 1, label: 'L' },
      { id: 'ta-flank-north', type: 'spawn', x: 0, z: -4, w: 1, d: 1, label: 'L' },
      { id: 'ta-perch', type: 'spawn', x: 4, z: -2, w: 1, d: 1, label: 'P', tier: 'upper' },
      { id: 'ta-coolant-valve', type: 'control', x: -4, z: -4, w: 1, d: 1, label: 'C' },
    ],
    sectionRoute: [[0, 0], [0.18, 0], [0.46, 1.4], [0.54, 1.4], [0.84, 2.8], [1, 2.8]],
    traversal: 'S y 0.00 m → 7-tile west ramp → y +1.40 m turn landing → 9-tile north ramp → E y +2.80 m. Both three-tile ramps are bidirectional and rail-protected.',
    gameplay: 'Reaverbot roles occupy lower frontline, both ramp flanks, and the upper perch. Coolant diversion affects only this module’s steam jets.',
    state: 'ta-encounter-cleared; ta-coolant-diverted.',
  },
  {
    id: 'ind-room-floodgate-descent-01',
    name: 'Floodgate descent chamber',
    family: 'Elevation room / hazard stairs',
    purpose: 'A lateral chamber that descends one tier past an isolation gate while preserving a dry, bidirectional bypass.',
    mask: ['...........', '...........', '...........', '......#####', '......#####', '......#####', '......#####', '......#####', '......#####', '...........', '...........'],
    upper: ['...........', '...........', '#####......', '#####......', '#####......', '#####......', '#####......', '#####......', '#####......', '...........', '...........'],
    upperY: 2.8,
    sockets: [
      { id: 'fd-w1', side: 'W', center: 0, width: 3, y: 2.8, role: 'entry upper' },
      { id: 'fd-e0', side: 'E', center: 0, width: 3, y: 0, role: 'reconnect lower' },
    ],
    routes: [
      { tier: 'upper', points: [[-5, 0], [-3, 0], [-2, -2]] },
      { tier: 'base', points: [[2, -2], [3, 0], [5, 0]] },
    ],
    zones: [
      { type: 'hazard', id: 'fd-flooded-sump', x: 3, z: 1, w: 3, d: 3, label: 'FLOOD' },
      { type: 'clear', id: 'fd-dry-bypass', x: 0, z: -2, w: 5, d: 3, label: 'DRY STAIR' },
    ],
    features: [
      { id: 'fd-stair', type: 'transfer', x: 0, z: -2, w: 7, d: 3, label: 'DOWN', form: 'stairs' },
      { id: 'fd-gate', type: 'machine', x: 3, z: 0, w: 1, d: 3, label: 'G', solid: true },
      { id: 'fd-console', type: 'control', x: -3, z: 1, w: 1, d: 1, label: 'C', tier: 'upper' },
    ],
    sectionRoute: [[0, 2.8], [0.28, 2.8], [0.72, 0], [1, 0]],
    traversal: 'W socket y +2.80 m → upper read landing → dry stair → lower landing → E socket y 0.00 m. The flooded sump never occupies the mandatory route.',
    gameplay: 'The local console isolates only fd-flooded-sump and gate timing; the dry stair and return route remain usable in every state.',
    state: 'fd-mechanism-activated; fd-floodgate-isolated.',
  },
  {
    id: 'ind-room-crane-gantry-lift-01',
    name: 'Crane gantry lift bay',
    family: 'Elevation room / mechanism lift',
    purpose: 'A large crane bay whose lower work floor connects to a high side gantry through a mandatory two-stop cargo lift.',
    mask: ['.............', '.............', '.............', '.............', '..#########..', '..#########..', '..#########..', '..#########..', '.###########.', '....#####....', '.....###.....'],
    upper: ['.............', '.............', '......#######', '......#######', '......#######', '..........#..', '.............', '.............', '.............', '.............', '.............'],
    upperY: 5.6,
    sockets: [
      { id: 'cg-s0', side: 'S', center: 0, width: 3, y: 0, role: 'entry lower' },
      { id: 'cg-e2', side: 'E', center: -2, width: 3, y: 5.6, role: 'reconnect upper' },
    ],
    routes: [
      { tier: 'base', points: [[0, 5], [0, 3], [4, 0]] },
      { tier: 'upper', points: [[4, 0], [4, -2], [6, -2]] },
    ],
    zones: [
      { type: 'hazard', id: 'cg-load-swing-zone', x: 0, z: 0, w: 5, d: 3, label: 'CRANE SWING' },
      { type: 'clear', id: 'cg-lift-board', x: 4, z: 0, w: 3, d: 3, label: 'LIFT CLEAR' },
    ],
    features: [
      { id: 'cg-crane-column', type: 'machine', x: 0, z: 0, w: 2, d: 2, label: 'K', solid: true },
      { id: 'cg-lift', type: 'transfer', x: 4, z: 0, w: 2, d: 2, label: 'L', solid: true, form: 'lift' },
      { id: 'cg-control', type: 'control', x: 2, z: 2, w: 1, d: 1, label: 'C' },
      { id: 'cg-upper-call', type: 'control', x: 5, z: -1, w: 1, d: 1, label: 'C', tier: 'upper' },
      { id: 'cg-flank-w', type: 'spawn', x: -4, z: 1, w: 1, d: 1, label: 'L' },
      { id: 'cg-frontline', type: 'spawn', x: 0, z: 3, w: 1, d: 1, label: 'F' },
    ],
    sectionRoute: [[0, 0], [0.52, 0], [0.52, 5.6], [1, 5.6]],
    traversal: 'S socket y 0.00 m crosses the marked crane floor to the cargo lift; the lift rises 5.60 m and the gantry reaches E. Both call landings are 3×3 clear.',
    gameplay: 'The crane control scopes the swing hazard to this room. The lift cannot become unavailable after the player reaches either tier.',
    state: 'cg-crane-parked; cg-lift-position; cg-encounter-cleared.',
  },
  {
    id: 'ind-room-pressure-lock-reward-rise-01',
    name: 'Pressure-lock reward stair',
    family: 'Elevation room / reward stairs',
    purpose: 'A shaft-wrapped ascent that places its payoff on the upper route before the elevated reconnect socket.',
    mask: ['...###...', '..#####..', '..#####..', '#########', '###...###', '###...###', '###...###', '.........', '.........', '.........', '.........'],
    upper: ['.........', '.........', '.........', '.........', '##.....##', '##.....##', '##.....##', '#########', '.#######.', '..#####..', '...###...'],
    upperY: 2.8,
    sockets: [
      { id: 'pr-n0', side: 'N', center: 0, width: 3, y: 0, role: 'entry lower' },
      { id: 'pr-s1', side: 'S', center: 0, width: 3, y: 2.8, role: 'reconnect upper' },
    ],
    routes: [
      { tier: 'base', points: [[0, -5], [0, -3], [3, -2], [3, 0]] },
      { tier: 'upper', points: [[3, 0], [3, 2], [0, 3], [0, 5]] },
    ],
    zones: [
      { type: 'clear', id: 'pr-shaft-clear', x: 0, z: 0, w: 3, d: 3, label: 'SHAFT' },
      { type: 'clear', id: 'pr-reward-clearance', x: 0, z: 3, w: 3, d: 3, label: 'PAYOFF' },
    ],
    voids: [{ id: 'pr-pressure-shaft', x: 0, z: 0, w: 3, d: 3, label: 'OPEN SHAFT' }],
    features: [
      { id: 'pr-stair', type: 'transfer', x: 3, z: 0, w: 2, d: 7, label: 'UP', form: 'stairs' },
      { id: 'pr-valve-stack', type: 'machine', x: 0, z: 0, w: 1, d: 3, label: 'V', solid: true },
      { id: 'pr-reward', type: 'reward', x: 0, z: 3, w: 1, d: 1, label: 'R', tier: 'upper' },
      { id: 'pr-mesh-cover', type: 'cover', x: -2, z: 3, w: 1, d: 2, label: 'M', solid: true, tier: 'upper' },
    ],
    sectionRoute: [[0, 0], [0.32, 0], [0.74, 2.8], [1, 2.8]],
    traversal: 'N socket y 0.00 m skirts the open shaft, climbs the east stair, reaches the upper payoff, and reconnects at S y +2.80 m. Return travel never depends on claiming the reward.',
    gameplay: 'The safely collectible cache is non-progression-critical and has a full-tile interaction ring outside the through route.',
    state: 'pr-reward-claimed.',
  },
  {
    id: 'ind-room-pressure-lock-reward-descent-01',
    name: 'Pressure-lock reward descent',
    family: 'Elevation room / reward descent',
    purpose: 'An upper arrival gallery descends one 2.8 m tier around a pressure shaft, presents an optional lower payoff, and reconnects at base elevation.',
    mask: ['.........', '.........', '.........', '.........', '##.....##', '##.....##', '##.....##', '#########', '.#######.', '..#####..', '...###...'],
    upper: ['...###...', '..#####..', '..#####..', '#########', '###...###', '###...###', '###...###', '.........', '.........', '.........', '.........'],
    upperY: 2.8,
    sockets: [
      { id: 'pd-n1', side: 'N', center: 0, width: 3, y: 2.8, role: 'entry upper' },
      { id: 'pd-s0', side: 'S', center: 0, width: 3, y: 0, role: 'reconnect base' },
    ],
    routes: [
      { tier: 'upper', points: [[0, -5], [0, -3], [-3, -2], [-3, 0]] },
      { tier: 'base', points: [[-3, 0], [-3, 2], [0, 3], [0, 5]] },
      { tier: 'base', points: [[-3, 2], [0, 3]] },
    ],
    zones: [
      { type: 'clear', id: 'pd-shaft-clear', x: 0, z: 0, w: 3, d: 3, label: 'SHAFT' },
      { type: 'clear', id: 'pd-reward-clearance', x: 0, z: 3, w: 3, d: 3, label: 'PAYOFF' },
    ],
    voids: [{ id: 'pd-pressure-shaft', x: 0, z: 0, w: 3, d: 3, label: 'OPEN SHAFT' }],
    features: [
      { id: 'pd-stair', type: 'transfer', x: -3, z: 0, w: 2, d: 7, label: 'DOWN', form: 'stairs' },
      { id: 'pd-counterweight', type: 'machine', x: 0, z: 0, w: 1, d: 3, label: 'W', solid: true },
      {
        id: 'pd-reward',
        type: 'reward',
        x: 0,
        z: 3,
        w: 1,
        d: 1,
        label: 'R',
        tier: 'base',
        rewardProfileId: 'supplement-treasure-cache',
        progressionCritical: false,
        persistentStateId: 'pd-reward-claimed',
      },
      { id: 'pd-mesh-cover', type: 'cover', x: 2, z: 3, w: 1, d: 2, label: 'M', solid: true, tier: 'base' },
    ],
    sectionRoute: [[0, 2.8], [0.32, 2.8], [0.74, 0], [1, 0]],
    traversal: 'N socket y +2.80 m follows the upper shaft gallery, descends the permanent west stair, reaches the lower payoff, and reconnects at S y 0.00 m. Both directions remain usable before and after collection.',
    gameplay: 'Reward profile supplement-treasure-cache is safely collectible inside a full one-tile clearance ring, idempotent, and explicitly non-progression-critical.',
    state: 'pd-reward-claimed.',
  },
  {
    id: 'ind-room-switchgear-cache-descent-01',
    name: 'Switchgear cache descent',
    family: 'Compact elevation room / reward stair',
    purpose: 'A compact upper inspection landing descends exactly one 2.8 m tier past failed switchgear to a safely offset maintenance cache and a base-level reconnect.',
    mask: ['.......', '.......', '.......', '.......', '#######', '#######', '.######'],
    upper: ['..###..', '#######', '#######', '.......', '.......', '.......', '.......'],
    upperY: 2.8,
    sockets: [
      { id: 'sgd-n1', side: 'N', center: 0, width: 3, y: 2.8, role: 'entry upper' },
      { id: 'sgd-s0', side: 'S', center: 0, width: 3, y: 0, role: 'reconnect base' },
    ],
    routes: [
      { tier: 'upper', points: [[0, -3], [0, -2], [0, -1]] },
      { tier: 'base', points: [[0, 1], [0, 2], [0, 3]] },
      { tier: 'base', points: [[0, 2], [2, 2]] },
    ],
    zones: [
      { type: 'clear', id: 'sgd-upper-landing', x: 0, z: -2, w: 3, d: 2, label: 'UPPER LANDING' },
      { type: 'clear', id: 'sgd-lower-landing', x: 0, z: 2, w: 3, d: 2, label: 'LOWER LANDING' },
      { type: 'clear', id: 'sgd-cache-clearance', x: 2, z: 2, w: 3, d: 3, label: 'CACHE CLEAR' },
    ],
    features: [
      { id: 'sgd-stair', type: 'transfer', x: 0, z: 0, w: 3, d: 7, label: 'DOWN', form: 'stairs' },
      { id: 'sgd-pressure-accumulator', type: 'machine', x: 3, z: -1, w: 1, d: 1, label: 'A', solid: true, tier: 'upper' },
      { id: 'sgd-failed-switchgear', type: 'machine', x: -3, z: 1, w: 1, d: 2, label: 'S', solid: true, tier: 'base' },
      { id: 'sgd-cable-spool-cover', type: 'cover', x: -2, z: 2, w: 1, d: 2, label: '½', solid: true, tier: 'base' },
      { id: 'sgd-outage-tags', type: 'story', x: -3, z: 3, w: 1, d: 1, label: 'i', tier: 'base' },
      {
        id: 'sgd-reward',
        type: 'reward',
        x: 2,
        z: 2,
        w: 1,
        d: 1,
        label: 'R',
        tier: 'base',
        rewardProfileId: 'supplement-treasure-cache',
        progressionCritical: false,
        persistentStateId: 'sgd-reward-claimed',
      },
    ],
    sectionRoute: [[0, 2.8], [0.28, 2.8], [0.72, 0], [1, 0]],
    traversal: 'N socket y +2.80 m crosses a clear upper landing, descends the permanent centered stair, reaches a clear lower landing, and reconnects through S at y 0.00 m. The stair remains bidirectional in every state.',
    gameplay: 'Amber service lighting frames outage tags beside the failed switchgear, while the offset cache retains a full one-tile pickup ring and never gates traversal or progression.',
    state: 'sgd-reward-claimed.',
  },
  {
    id: 'ind-room-survey-relay-cache-01',
    name: 'Survey relay cache',
    family: 'Compact room / calm reward discovery',
    purpose: 'A chamfered survey relay offers a quiet inspection beat, a protected three-tile through lane, and an optional cache beside the decommissioned plotting equipment.',
    mask: ['..###..', '.#####.', '#######', '#######', '.######', '.#####.', '..###..'],
    upper: [], upperY: null,
    sockets: [
      { id: 'src-n', side: 'N', center: 0, width: 3, y: 0, role: 'entry' },
      { id: 'src-s', side: 'S', center: 0, width: 3, y: 0, role: 'reconnect' },
    ],
    routes: [
      { tier: 'base', points: [[0, -3], [0, 0], [0, 3]] },
      { tier: 'base', points: [[0, 0], [2, 0]] },
    ],
    zones: [
      { type: 'clear', id: 'src-through-route', x: 0, z: 0, w: 3, d: 7, label: 'CLEAR THROUGH' },
      { type: 'clear', id: 'src-entry-landing', x: 0, z: -2, w: 3, d: 3, label: 'ENTRY CLEAR' },
      { type: 'clear', id: 'src-exit-landing', x: 0, z: 2, w: 3, d: 3, label: 'EXIT CLEAR' },
      { type: 'clear', id: 'src-cache-clearance', x: 2, z: 0, w: 3, d: 3, label: 'CACHE CLEAR' },
    ],
    features: [
      { id: 'src-plotter-bank', type: 'machine', x: -3, z: 0, w: 1, d: 2, label: 'P', solid: true },
      { id: 'src-pallet-cover', type: 'cover', x: -2, z: 2, w: 1, d: 1, label: '½', solid: true },
      { id: 'src-survey-notes', type: 'story', x: -2, z: -2, w: 1, d: 1, label: 'i' },
      {
        id: 'src-reward',
        type: 'reward',
        x: 2,
        z: 0,
        w: 1,
        d: 1,
        label: 'R',
        rewardProfileId: 'supplement-treasure-cache',
        progressionCritical: false,
        persistentStateId: 'src-reward-claimed',
      },
    ],
    traversal: 'N↔S stays level on a continuously clear three-tile lane with 3×3 arrival and departure landings. The east cache spur is optional and leaves the return route unchanged.',
    gameplay: 'Soft inspection lighting reveals abandoned survey notes and a dormant plotting bank. The recessed cache has a full one-tile pickup ring, is idempotent, and is never progression-critical.',
    state: 'src-reward-claimed.',
  },
  {
    id: 'ind-rise-long-freight-ramp-01',
    name: 'Long freight ramp',
    family: 'Elevation corridor / continuous ramp',
    purpose: 'A straight, vehicle-width incline with an explicit 22.4 m run and 12.5% grade between different-height corridor sockets.',
    mask: ['.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '..###..', '..###..', '..###..', '..###..'],
    upper: ['..###..', '..###..', '..###..', '..###..', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......'],
    upperY: 2.8,
    sockets: [
      { id: 'lfr-s0', side: 'S', center: 0, width: 3, y: 0, role: 'entry lower' },
      { id: 'lfr-n1', side: 'N', center: 0, width: 3, y: 2.8, role: 'reconnect upper' },
    ],
    routes: [
      { tier: 'base', points: [[0, 7], [0, 4]] },
      { tier: 'upper', points: [[0, -4], [0, -7]] },
    ],
    zones: [
      { type: 'clear', id: 'lfr-lower-landing', x: 0, z: 5.5, w: 3, d: 3, label: 'LOWER' },
      { type: 'clear', id: 'lfr-upper-landing', x: 0, z: -5.5, w: 3, d: 3, label: 'UPPER' },
    ],
    features: [
      { id: 'lfr-slope', type: 'transfer', x: 0, z: 0, w: 3, d: 9, label: '12.5%', form: 'ramp' },
      { id: 'lfr-guard-west', type: 'cover', x: -2, z: 0, w: 1, d: 9, label: 'G', solid: true },
      { id: 'lfr-guard-east', type: 'cover', x: 2, z: 0, w: 1, d: 9, label: 'G', solid: true },
    ],
    sectionRoute: [[0, 0], [0.18, 0], [0.82, 2.8], [1, 2.8]],
    traversal: 'S y 0.00 m → 3×3 lower landing → 8-tile / 22.4 m continuous ramp → 3×3 upper landing → N y +2.80 m. Grade is exactly 12.5%.',
    gameplay: 'The full-width slope collider, nav surface, edge guards, and both landings come from one authoritative transfer record.',
    state: 'None; the ramp is permanently bidirectional.',
  },
  {
    id: 'ind-room-inclined-sorter-01',
    name: 'Inclined sorter gauntlet',
    family: 'Elevation room / hazard incline',
    purpose: 'A broad industrial incline combines a moving center belt with two permanent safe catwalks and an elevated reconnect.',
    mask: ['.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.#######.', '#########', '#########', '...###...'],
    upper: ['...###...', '#########', '#########', '.#######.', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'],
    upperY: 2.8,
    sockets: [
      { id: 'isg-s0', side: 'S', center: 0, width: 3, y: 0, role: 'entry lower' },
      { id: 'isg-n1', side: 'N', center: 0, width: 3, y: 2.8, role: 'reconnect upper' },
    ],
    routes: [
      { tier: 'base', points: [[0, 7], [0, 5], [-2.5, 4]] },
      { tier: 'upper', points: [[-2.5, -4], [0, -6], [0, -7]] },
      { tier: 'base', points: [[0, 5], [2.5, 4]] },
      { tier: 'upper', points: [[2.5, -4], [0, -6]] },
    ],
    zones: [
      { type: 'hazard', id: 'isg-moving-belt', x: 0, z: 0, w: 3, d: 9, label: 'MOVING BELT' },
      { type: 'clear', id: 'isg-safe-catwalks', x: 0, z: 0, w: 7, d: 9, label: 'SAFE EDGES' },
    ],
    features: [
      { id: 'isg-incline', type: 'transfer', x: 0, z: 0, w: 7, d: 9, label: '12.5%', form: 'ramp' },
      { id: 'isg-divider-west', type: 'cover', x: -1.5, z: 0, w: 1, d: 7, label: 'D', solid: true },
      { id: 'isg-divider-east', type: 'cover', x: 1.5, z: 0, w: 1, d: 7, label: 'D', solid: true },
      { id: 'isg-belt-stop', type: 'control', x: 2.5, z: 0, w: 1, d: 1, label: 'C' },
      { id: 'isg-frontline', type: 'spawn', x: 0, z: 2, w: 1, d: 1, label: 'F' },
      { id: 'isg-flank-west', type: 'spawn', x: -2.5, z: 0, w: 1, d: 1, label: 'L' },
      { id: 'isg-flank-east', type: 'spawn', x: 2.5, z: -1, w: 1, d: 1, label: 'L' },
      { id: 'isg-reward', type: 'reward', x: -3, z: -5, w: 1, d: 1, label: 'R', tier: 'upper' },
    ],
    sectionRoute: [[0, 0], [0.18, 0], [0.82, 2.8], [1, 2.8]],
    traversal: 'S y 0.00 m → lower crossover → either 2-tile safe catwalk on a 12.5% incline → upper crossover → N y +2.80 m. Reverse travel is always legal.',
    gameplay: 'Stopping the center belt removes only its local impulse hazard; both safe catwalks remain valid before and after the mechanism.',
    state: 'isg-encounter-cleared; isg-conveyor-stopped; isg-reward-claimed.',
  },
];

const blueprintList = BLUEPRINT_DEFINITIONS.map(createBlueprint);
const blueprintIds = blueprintList.map(blueprint => blueprint.id);

if (new Set(blueprintIds).size !== blueprintIds.length) {
  throw new Error('Industrial supplement blueprint ids must be unique');
}

export const INDUSTRIAL_SUPPLEMENT_BLUEPRINT_IDS = Object.freeze(blueprintIds);

export const INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST = Object.freeze(blueprintList);

export const INDUSTRIAL_SUPPLEMENT_BLUEPRINTS = deepFreezeDungeonAugmentationValue(
  Object.fromEntries(blueprintList.map(blueprint => [blueprint.id, blueprint])),
);

export function resolveIndustrialSupplementBlueprint(id) {
  if (typeof id !== 'string'
    || !Object.prototype.hasOwnProperty.call(INDUSTRIAL_SUPPLEMENT_BLUEPRINTS, id)) {
    return null;
  }
  return deepFreezeDungeonAugmentationValue(
    cloneDungeonAugmentationValue(INDUSTRIAL_SUPPLEMENT_BLUEPRINTS[id]),
  );
}
