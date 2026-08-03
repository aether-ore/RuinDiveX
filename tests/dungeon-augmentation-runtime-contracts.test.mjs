import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES as ERROR_CODES,
  INDUSTRIAL_SUPPLEMENT_LIVE_STATE_PARTICIPANT_SCHEMA,
  INDUSTRIAL_SUPPLEMENT_RUNTIME_STATE_KINDS,
  INDUSTRIAL_SUPPLEMENT_V4_RUNTIME_CONTRACT_MODE as V4_MODE,
  buildIndustrialSupplementAnchorPlacementRequests,
  buildIndustrialSupplementLiveStateBindingInventory,
  buildIndustrialSupplementStateBindings,
  resolveIndustrialSupplementAnchorPlacementRequests,
  validateIndustrialSupplementStateBindings,
} from '../src/dungeon-augmentation/IndustrialSupplementRuntimeContracts.js';

function floorCell(id, x, z, {
  roomId = 'supplement-room',
  elevation = 0,
  tierId = 'base',
  tierRuntimeId = `${roomId}:tier:${tierId}`,
  ...extra
} = {}) {
  return {
    id,
    roomId,
    floorTierId: tierId,
    floorTierRuntimeId: tierRuntimeId,
    floorKey: `${x},${z}@y${elevation.toFixed(3)}`,
    position: { x, y: elevation, z },
    elevation,
    walkable: true,
    reachable: true,
    returnable: true,
    ...extra,
  };
}

function zone(id, cellIds, {
  roomId = 'supplement-room',
  localZoneId = id,
  zoneKind = 'encounter',
} = {}) {
  return {
    id: `${roomId}:zone:${id}`,
    runtimeId: `${roomId}:zone:${id}`,
    localZoneId,
    roomId,
    zoneKind,
    validFor: ['player', 'enemy'],
    worldCells: cellIds.map((floorCellId) => ({ floorCellId })),
  };
}

function authoredRoom({
  id = 'supplement-room',
  cells = [
    floorCell('floor-a', 0, 0),
    floorCell('floor-b', 2.8, 0),
    floorCell('floor-c', 5.6, 0),
  ],
  zones = null,
  anchors = [],
  clearRoutes = [],
  transfers = [],
} = {}) {
  const normalizedCells = cells.map((cell) => ({ ...cell, roomId: id }));
  const normalizedZones = zones ?? [zone('combat-floor', normalizedCells.map(({ id: cellId }) => cellId), {
    roomId: id,
    localZoneId: 'combat-floor',
  })];
  return {
    id,
    isDungeonSupplement: true,
    augmentationOperationId: `${id}:operation`,
    augmentationFloorTiers: [{
      id: 'base',
      runtimeId: `${id}:tier:base`,
      roomId: id,
      worldCells: normalizedCells,
    }],
    augmentationZones: normalizedZones,
    augmentationAnchors: anchors,
    augmentationClearRoutes: clearRoutes,
    augmentationCollisionRecords: [],
    augmentationCover: [],
    augmentationBlueprintFeatures: [],
    augmentationVoids: [],
    augmentationTransfers: transfers,
  };
}

function placementRequest(id, {
  exact = null,
  allowed = [],
  roomId = 'supplement-room',
  tierId = 'base',
  tierRuntimeId = `${roomId}:tier:${tierId}`,
  elevation = 0,
  position = { x: 0, y: elevation, z: 0 },
  radius = 0,
  farSide = false,
  forbiddenFootprints = [],
  reselect = true,
} = {}) {
  return {
    id,
    requestId: id,
    anchorId: `${id}:anchor`,
    ownerKind: 'supplemental-anchor',
    ownerId: `${id}:anchor`,
    roomId,
    placementKind: 'encounter-role',
    requestedPosition: position,
    exactSupportCellId: exact,
    allowedSupportCellIds: allowed,
    allowedZoneIds: [],
    requiredTierId: tierId,
    requiredTierRuntimeId: tierRuntimeId,
    requiredElevation: elevation,
    elevationToleranceMeters: 0.08,
    forbiddenFootprints,
    reservationRadiusMeters: radius,
    requiresFarSide: farSide,
    farSideRoomId: farSide ? roomId : null,
    reselectWithinDeclaredZoneAndTier: reselect,
  };
}

function liveComponentsForBindings(bindings) {
  const components = new Map();
  const add = (participant, property, runtimeStateId) => {
    const key = `${participant.kind}\u0000${participant.id}`;
    const component = components.get(key) ?? {
      id: participant.id,
      kind: participant.kind,
      ownedRuntimeStateIds: [],
      consumedRuntimeStateIds: [],
    };
    component[property].push(runtimeStateId);
    components.set(key, component);
  };
  for (const binding of bindings) {
    add(binding.owner, 'ownedRuntimeStateIds', binding.runtimeStateId);
    add(binding.consumer, 'consumedRuntimeStateIds', binding.runtimeStateId);
  }
  return [...components.values()];
}

test('runtime contracts are inert unless the exact V4 mode is explicitly supplied', () => {
  const malformed = [{ id: null }];
  assert.deepEqual(
    buildIndustrialSupplementAnchorPlacementRequests({ mode: 'v3', rooms: malformed }),
    { active: false, accepted: true, errors: [], requests: [], diagnosticRequests: [] },
  );
  assert.deepEqual(
    resolveIndustrialSupplementAnchorPlacementRequests({ mode: 'v3', requests: malformed }),
    {
      active: false,
      accepted: true,
      errors: [],
      placements: [],
      diagnosticPlacements: [],
      reservations: [],
    },
  );
  assert.deepEqual(
    buildIndustrialSupplementStateBindings({ mode: 'v3', rooms: malformed }),
    {
      active: false,
      accepted: true,
      errors: [],
      bindings: [],
      advertisedStateIds: [],
      sourceStateIdRemap: {},
    },
  );
  assert.deepEqual(
    buildIndustrialSupplementLiveStateBindingInventory({
      mode: 'v3',
      bindings: malformed,
      components: malformed,
    }),
    {
      active: false,
      accepted: true,
      errors: [],
      bindings: [],
      advertisedStateIds: [],
      components: [],
      diagnosticComponents: [],
      liveOwners: [],
      diagnosticLiveOwners: [],
      liveConsumers: [],
      diagnosticLiveConsumers: [],
    },
  );
});

test('request builder emits deterministic live-role and reward contracts from authored support', () => {
  const encounter = {
    id: 'room:encounter',
    localAnchorId: 'encounter-center',
    kind: 'encounter',
    runtimeStateId: 'old:encounter',
    encounterRecipe: {
      spatialRoles: [{
        id: 'frontline-1',
        anchorIds: ['encounter-frontline'],
        validFloorZoneIds: ['combat-floor'],
      }],
    },
  };
  const frontline = {
    id: 'room:frontline',
    localAnchorId: 'encounter-frontline',
    kind: 'spatial-role',
    supportCellId: 'floor-a',
    supportCellIds: ['floor-a'],
    floorTierId: 'base',
    floorTierRuntimeId: 'supplement-room:tier:base',
    blueprintZoneId: 'combat-floor',
    position: { x: 0, y: 0, z: 0 },
    authoritativeBlueprintPlacement: true,
  };
  const inactiveFlank = {
    id: 'room:inactive-flank',
    localAnchorId: 'encounter-flank',
    kind: 'spatial-role',
    supportCellId: 'floor-b',
    blueprintZoneId: 'combat-floor',
  };
  const reward = {
    id: 'room:reward',
    localAnchorId: 'reward-cache',
    kind: 'reward',
    runtimeStateId: 'old:reward',
    rewardRecipe: { id: 'reward-recipe' },
    supportCellId: 'floor-c',
    supportCellIds: ['floor-c'],
    floorTierId: 'base',
    floorTierRuntimeId: 'supplement-room:tier:base',
    blueprintZoneId: 'combat-floor',
    position: { x: 5.6, y: 0, z: 0 },
  };
  const first = buildIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    rooms: [authoredRoom({ anchors: [reward, inactiveFlank, encounter, frontline] })],
  });
  const second = buildIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    rooms: [authoredRoom({ anchors: [frontline, encounter, inactiveFlank, reward] })],
  });
  assert.equal(first.accepted, true);
  assert.deepEqual(first, second);
  assert.deepEqual(first.requests.map(({ anchorId }) => anchorId), [
    'room:frontline',
    'room:reward',
  ]);
  const role = first.requests[0];
  assert.equal(role.placementKind, 'encounter-role');
  assert.equal(role.exactSupportCellId, 'floor-a');
  assert.deepEqual(role.allowedSupportCellIds, ['floor-a', 'floor-b', 'floor-c']);
  assert.deepEqual(role.allowedZoneIds, ['supplement-room:zone:combat-floor']);
  assert.equal(role.requiredTierRuntimeId, 'supplement-room:tier:base');
  assert.equal(role.requiredElevation, 0);
  assert.equal(role.reservationRadiusMeters, 1.4);
  assert.equal(role.requiresFarSide, false);
});

test('unzoned blueprint anchors receive only a cardinal same-tier fallback domain', () => {
  const baseCells = [
    floorCell('floor-exact', 0, 0, {
      localTile: { x: 0, z: 0, elevation: 0 },
      authoritative: true,
    }),
    floorCell('floor-cardinal', 2.8, 0, {
      localTile: { x: 1, z: 0, elevation: 0 },
      authoritative: true,
    }),
    floorCell('floor-diagonal', 2.8, 2.8, {
      localTile: { x: 1, z: 1, elevation: 0 },
      authoritative: true,
    }),
    floorCell('floor-distant', 5.6, 0, {
      localTile: { x: 2, z: 0, elevation: 0 },
      authoritative: true,
    }),
  ];
  const anchor = {
    id: 'room:blueprint-reward',
    localAnchorId: 'blueprint-reward',
    kind: 'reward',
    rewardRecipe: { id: 'reward-recipe' },
    supportCellId: 'floor-exact',
    supportCellIds: ['floor-exact'],
    floorTierId: 'base',
    floorTierRuntimeId: 'supplement-room:tier:base',
    position: { x: 0, y: 0, z: 0 },
    authoritativeBlueprintPlacement: true,
  };
  const room = authoredRoom({ cells: baseCells, zones: [], anchors: [anchor] });
  room.augmentationFloorTiers.push({
    id: 'upper',
    runtimeId: 'supplement-room:tier:upper',
    roomId: room.id,
    worldCells: [floorCell('floor-cross-tier', 2.8, 0, {
      tierId: 'upper',
      tierRuntimeId: 'supplement-room:tier:upper',
      elevation: 0,
      localTile: { x: 1, z: 0, elevation: 0 },
      authoritative: true,
    })],
  });
  const built = buildIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    rooms: [room],
  });
  assert.equal(built.accepted, true);
  assert.equal(built.requests.length, 1);
  assert.deepEqual(
    built.requests[0].localFallbackSupportCellIds,
    ['floor-exact', 'floor-cardinal'],
  );
  assert.deepEqual(
    built.requests[0].allowedSupportCellIds,
    ['floor-cardinal', 'floor-exact'],
  );

  const resolution = resolveIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    requests: built.requests,
    floors: baseCells.map((cell) => ({
      ...cell,
      supportFloorCellId: cell.id,
      walkable: cell.id !== 'floor-exact',
      reachable: cell.id !== 'floor-exact',
      returnable: cell.id !== 'floor-exact',
    })),
  });
  assert.equal(resolution.accepted, true);
  assert.equal(resolution.placements[0].supportFloorCellId, 'floor-cardinal');
  assert.equal(resolution.placements[0].selectionSource, 'declared-zone-tier-reselection');

  const unresolvedDeclaredZoneAnchor = {
    ...anchor,
    id: 'room:declared-zone-reward',
    localAnchorId: 'declared-zone-reward',
    blueprintZoneId: 'missing-blueprint-zone',
  };
  const unresolvedZoneRequest = buildIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    rooms: [authoredRoom({
      cells: baseCells,
      zones: [],
      anchors: [unresolvedDeclaredZoneAnchor],
    })],
  });
  assert.equal(unresolvedZoneRequest.accepted, true);
  assert.deepEqual(unresolvedZoneRequest.requests[0].declaredZoneIds, [
    'missing-blueprint-zone',
  ]);
  assert.deepEqual(unresolvedZoneRequest.requests[0].allowedZoneIds, []);
  assert.deepEqual(unresolvedZoneRequest.requests[0].localFallbackSupportCellIds, []);
  assert.deepEqual(unresolvedZoneRequest.requests[0].allowedSupportCellIds, ['floor-exact']);
  const exactOnlyResolution = resolveIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    requests: unresolvedZoneRequest.requests,
    floors: baseCells.map((cell) => ({ ...cell, supportFloorCellId: cell.id })),
  });
  assert.equal(exactOnlyResolution.accepted, true);
  assert.equal(exactOnlyResolution.placements[0].supportFloorCellId, 'floor-exact');
  assert.equal(exactOnlyResolution.placements[0].selectionSource, 'exact-support-cell');
});

test('authoritative occupied support identity overrides forbidden AABB containment', () => {
  const broadSolid = {
    id: 'solid-cover',
    center: { x: 1.4, y: 0, z: 0 },
    size: { x: 5.6, y: 3.6, z: 5.6 },
    blocking: true,
    occupiedSupportCellIds: ['floor-a'],
  };
  const adjacent = resolveIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    requests: [placementRequest('adjacent', {
      exact: 'floor-b',
      allowed: ['floor-b'],
      position: { x: 2.8, y: 0, z: 0 },
    })],
    floors: [floorCell('floor-b', 2.8, 0)],
    solids: [broadSolid],
  });
  assert.equal(adjacent.accepted, true);
  assert.equal(adjacent.placements[0].supportFloorCellId, 'floor-b');

  const occupied = resolveIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    requests: [placementRequest('occupied', {
      exact: 'floor-a',
      allowed: ['floor-a'],
    })],
    floors: [floorCell('floor-a', 0, 0)],
    solids: [broadSolid],
  });
  assert.equal(occupied.accepted, false);
  assert.equal(occupied.errors[0].code, ERROR_CODES.FORBIDDEN_FOOTPRINT);

  const { occupiedSupportCellIds, ...legacySolid } = broadSolid;
  assert.deepEqual(occupiedSupportCellIds, ['floor-a']);
  const legacy = resolveIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    requests: [placementRequest('legacy', {
      exact: 'floor-b',
      allowed: ['floor-b'],
      position: { x: 2.8, y: 0, z: 0 },
    })],
    floors: [floorCell('floor-b', 2.8, 0)],
    solids: [legacySolid],
  });
  assert.equal(legacy.accepted, false);
  assert.equal(legacy.errors[0].code, ERROR_CODES.FORBIDDEN_FOOTPRINT);
});

test('authored room anchors may occupy an authored clear-route endpoint', () => {
  const anchor = {
    id: 'room:route-terminal-control',
    localAnchorId: 'route-terminal-control',
    kind: 'progression',
    mechanismRecipe: { id: 'control-recipe' },
    supportCellId: 'floor-a',
    supportCellIds: ['floor-a'],
    floorTierId: 'base',
    floorTierRuntimeId: 'supplement-room:tier:base',
    blueprintZoneId: 'combat-floor',
    position: { x: 0, y: 0, z: 0 },
  };
  const room = authoredRoom({
    anchors: [anchor],
    clearRoutes: [{ id: 'route-to-control', worldCellIds: ['floor-a'] }],
  });
  room.augmentationCollisionRecords = [{
    id: 'route-to-control:collision',
    sourceKind: 'clear-route',
    collisionKind: 'clear-route-reservation',
    mustRemainClear: true,
    supportCellIds: ['floor-a'],
  }];
  room.augmentationBlueprintFeatures = [{
    id: 'non-solid-anchor-dais',
    blueprintFeatureType: 'machine',
    blocking: false,
    supportCellIds: ['floor-a'],
  }];
  const requests = buildIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    rooms: [room],
  });
  assert.equal(requests.accepted, true);
  assert.equal(requests.requests.length, 1);
  assert.equal(
    requests.requests[0].forbiddenFootprints.some(({ id }) => (
      [
        'route-to-control',
        'route-to-control:collision',
        'non-solid-anchor-dais',
      ].includes(id)
    )),
    false,
  );
  const placement = resolveIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    requests: requests.requests,
    floors: room.augmentationFloorTiers,
    zones: room.augmentationZones,
  });
  assert.equal(placement.accepted, true);
  assert.equal(placement.placements[0].supportFloorCellId, 'floor-a');
});

test('shortcut request is confined to far-side authored floors outside seams and clear routes', () => {
  const room = authoredRoom({
    id: 'far-room',
    cells: [
      floorCell('far-seam', 0, 0, { roomId: 'far-room' }),
      floorCell('far-route', 2.8, 0, { roomId: 'far-room' }),
      floorCell('far-control', 5.6, 0, { roomId: 'far-room' }),
    ],
    zones: [zone('control-zone', ['far-seam', 'far-route', 'far-control'], {
      roomId: 'far-room',
      localZoneId: 'control-zone',
      zoneKind: 'control',
    })],
    clearRoutes: [{ id: 'route', worldCellIds: ['far-route'] }],
  });
  const result = buildIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    rooms: [room],
    connectionPlans: [{
      id: 'shortcut-connection',
      toRoomId: 'far-room',
      shortcutMode: 'drop-ladder',
      shortcutActivationSide: 'far-side',
      shortcutMechanismId: 'shortcut-control',
      toSocket: { position: { x: 0, y: 0, z: 0 } },
      endpointSeams: [{ orderedCells: [{ floorCellId: 'far-seam' }] }],
    }],
  });
  assert.equal(result.accepted, true);
  assert.equal(result.requests.length, 1);
  const request = result.requests[0];
  assert.equal(request.placementKind, 'shortcut-control');
  assert.equal(request.requiresFarSide, true);
  assert.equal(request.farSideRoomId, 'far-room');
  assert.deepEqual(request.allowedZoneIds, ['far-room:zone:control-zone']);
  const forbiddenIds = new Set(request.forbiddenFootprints.flatMap((entry) => (
    entry.supportCellIds
  )));
  assert.equal(forbiddenIds.has('far-seam'), true);
  assert.equal(forbiddenIds.has('far-route'), true);

  const placement = resolveIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    requests: result.requests,
    floors: room.augmentationFloorTiers,
    zones: room.augmentationZones,
  });
  assert.equal(placement.accepted, true);
  assert.equal(placement.placements[0].supportFloorCellId, 'far-control');
  assert.equal(placement.placements[0].requiresFarSide, true);
});

test('request builder rejects a shortcut without an exact far-side activation contract', () => {
  const result = buildIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    rooms: [authoredRoom({ id: 'far-room' })],
    connectionPlans: [{
      id: 'bad-shortcut',
      toRoomId: 'far-room',
      shortcutMode: 'shortcut-lift',
      shortcutActivationSide: 'source-side',
    }],
  });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.requests, []);
  assert.equal(result.errors[0].code, ERROR_CODES.FAR_SIDE_REQUIRED);
});

test('resolver prefers exact support and deterministically reselects only within declared support', () => {
  const floors = [
    floorCell('floor-a', 0, 0),
    floorCell('floor-b', 2.8, 0),
    floorCell('foreign', 0.1, 0, { roomId: 'another-room' }),
  ];
  const exact = resolveIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    requests: [placementRequest('request', {
      exact: 'floor-a',
      allowed: ['floor-b', 'foreign', 'floor-a'],
    })],
    floors,
  });
  assert.equal(exact.accepted, true);
  assert.equal(exact.placements[0].supportFloorCellId, 'floor-a');
  assert.equal(exact.placements[0].selectionSource, 'exact-support-cell');

  const reselected = resolveIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    requests: [placementRequest('request', {
      exact: 'floor-a',
      allowed: ['floor-b', 'foreign', 'floor-a'],
    })],
    floors,
    solids: [{ id: 'block-exact', blocking: true, supportCellIds: ['floor-a'] }],
  });
  assert.equal(reselected.accepted, true);
  assert.equal(reselected.placements[0].supportFloorCellId, 'floor-b');
  assert.equal(reselected.placements[0].selectionSource, 'declared-zone-tier-reselection');
});

test('resolver fails atomically for insufficient walkable or correctly tiered support', () => {
  const floors = [
    floorCell('blocked', 0, 0, { walkable: false }),
    floorCell('upper', 2.8, 0, {
      elevation: 2.8,
      tierId: 'upper',
      tierRuntimeId: 'supplement-room:tier:upper',
    }),
  ];
  const result = resolveIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    requests: [placementRequest('request', { allowed: ['blocked', 'upper'] })],
    floors,
  });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.placements, []);
  assert.deepEqual(result.diagnosticPlacements, []);
  assert.equal(result.errors[0].code, ERROR_CODES.NO_LEGAL_SUPPORT);
  assert.deepEqual(result.errors[0].details.rejectionCounts, {
    farSide: 0,
    tier: 1,
    elevation: 0,
    walkability: 1,
    forbidden: 0,
    reservation: 0,
  });
});

test('resolver handles reservation reselection and rejects an unavoidable conflict atomically', () => {
  const floors = [
    floorCell('floor-a', 0, 0),
    floorCell('floor-b', 2.8, 0),
  ];
  const successful = resolveIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    requests: [
      placementRequest('a-request', { exact: 'floor-a', allowed: ['floor-a'], radius: 0 }),
      placementRequest('b-request', {
        exact: 'floor-a',
        allowed: ['floor-a', 'floor-b'],
        radius: 0,
      }),
    ],
    floors,
  });
  assert.equal(successful.accepted, true);
  assert.deepEqual(successful.placements.map(({ supportFloorCellId }) => supportFloorCellId), [
    'floor-a',
    'floor-b',
  ]);

  const conflict = resolveIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    requests: [
      placementRequest('a-request', { exact: 'floor-a', allowed: ['floor-a'] }),
      placementRequest('b-request', { exact: 'floor-a', allowed: ['floor-a'] }),
    ],
    floors,
  });
  assert.equal(conflict.accepted, false);
  assert.deepEqual(conflict.placements, []);
  assert.equal(conflict.diagnosticPlacements.length, 1);
  assert.equal(conflict.errors[0].code, ERROR_CODES.RESERVATION_CONFLICT);
});

test('resolver rejects foreign far-side cells and duplicate authoritative floor identities', () => {
  const farSide = resolveIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    requests: [placementRequest('far-request', {
      allowed: ['source-floor'],
      roomId: 'far-room',
      farSide: true,
      tierRuntimeId: 'far-room:tier:base',
    })],
    floors: [floorCell('source-floor', 0, 0, {
      roomId: 'source-room',
      tierRuntimeId: 'source-room:tier:base',
    })],
  });
  assert.equal(farSide.accepted, false);
  assert.equal(farSide.errors[0].code, ERROR_CODES.FAR_SIDE_REQUIRED);

  const duplicate = resolveIndustrialSupplementAnchorPlacementRequests({
    mode: V4_MODE,
    requests: [placementRequest('duplicate-request', {
      allowed: ['duplicated-floor'],
    })],
    floors: [
      floorCell('duplicated-floor', 0, 0),
      floorCell('duplicated-floor', 2.8, 0),
    ],
  });
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.errors.some(({ code }) => code === ERROR_CODES.SUPPORT_ID_AMBIGUOUS), true);
});

test('state builder creates distinct per-anchor and per-transfer semantic IDs for all state kinds', () => {
  const room = authoredRoom({
    anchors: [
      {
        id: 'anchor:encounter',
        kind: 'encounter',
        runtimeStateId: 'old:shared:encounter',
        encounterRecipe: { recipeInstanceId: 'encounter:runtime' },
      },
      {
        id: 'anchor:mechanism',
        kind: 'mechanism',
        runtimeStateId: 'old:shared:mechanism',
        mechanismRecipe: { recipeInstanceId: 'mechanism:runtime' },
      },
      {
        id: 'anchor:reward',
        kind: 'reward',
        runtimeStateId: 'old:shared:reward',
        rewardRecipe: { recipeInstanceId: 'reward:runtime' },
      },
    ],
    transfers: [
      { id: 'transfer:lift', traversalKind: 'automatic-cargo-lift' },
      { id: 'transfer:ladder', traversalKind: 'deployable-ladder' },
    ],
  });
  const result = buildIndustrialSupplementStateBindings({ mode: V4_MODE, rooms: [room] });
  assert.equal(result.accepted, true);
  assert.equal(result.bindings.length, 6);
  assert.deepEqual(
    [...new Set(result.bindings.map(({ stateKind }) => stateKind))].sort(),
    [...INDUSTRIAL_SUPPLEMENT_RUNTIME_STATE_KINDS].sort(),
  );
  assert.equal(new Set(result.advertisedStateIds).size, 6);
  assert.notEqual(
    result.bindings.find(({ stateKind }) => stateKind === 'lift-enabled').runtimeStateId,
    result.bindings.find(({ stateKind }) => stateKind === 'lift-position').runtimeStateId,
  );
  assert.deepEqual(result.sourceStateIdRemap, {
    'old:shared:encounter': ['anchor:encounter:state:encounter-cleared'],
    'old:shared:mechanism': ['anchor:mechanism:state:mechanism-activated'],
    'old:shared:reward': ['anchor:reward:state:reward-claimed'],
  });
  for (const binding of result.bindings) {
    assert.ok(binding.owner.id);
    assert.ok(binding.consumer.id);
    assert.equal(binding.persistent, true);
    assert.equal(binding.namespaced, true);
  }
  assert.deepEqual(
    result.bindings.find(({ stateKind }) => stateKind === 'encounter-cleared').consumer,
    { kind: 'encounter-cleared-runtime', id: 'supplement-room:encounter' },
  );
  assert.deepEqual(
    result.bindings.find(({ stateKind }) => stateKind === 'mechanism-activated').consumer,
    { kind: 'mechanism-activated-runtime', id: 'anchor:mechanism' },
  );
  assert.deepEqual(
    result.bindings.find(({ stateKind }) => stateKind === 'reward-claimed').consumer,
    { kind: 'reward-claimed-runtime', id: 'anchor:reward' },
  );
});

test('encounter binding uses the exact authored runtime encounter identity when supplied', () => {
  const result = buildIndustrialSupplementStateBindings({
    mode: V4_MODE,
    rooms: [authoredRoom({
      id: 'encounter-identity-room',
      anchors: [{
        id: 'encounter-anchor',
        encounterId: 'encounter-runtime-record',
        kind: 'encounter',
        encounterRecipe: { recipeInstanceId: 'recipe-instance-is-not-the-runtime-record' },
      }],
    })],
  });
  assert.equal(result.accepted, true);
  assert.equal(result.bindings.length, 1);
  assert.deepEqual(result.bindings[0].consumer, {
    kind: 'encounter-cleared-runtime',
    id: 'encounter-runtime-record',
  });
  assert.notEqual(result.bindings[0].consumerId, 'recipe-instance-is-not-the-runtime-record');
});

test('shortcut state bindings keep mechanism, lift availability, lift position, and ladder deployment separate', () => {
  const lift = buildIndustrialSupplementStateBindings({
    mode: V4_MODE,
    connectionPlans: [{
      id: 'lift-shortcut',
      shortcutMode: 'shortcut-lift',
      shortcutActivationSide: 'far-side',
      shortcutMechanismId: 'lift-control',
      shortcutStateId: 'old:shortcut',
    }],
  });
  assert.equal(lift.accepted, true);
  assert.deepEqual(lift.bindings.map(({ stateKind }) => stateKind).sort(), [
    'lift-enabled',
    'lift-position',
    'mechanism-activated',
  ]);
  assert.equal(new Set(lift.advertisedStateIds).size, 3);

  const ladder = buildIndustrialSupplementStateBindings({
    mode: V4_MODE,
    connectionPlans: [{
      id: 'ladder-shortcut',
      shortcutMode: 'drop-ladder',
      shortcutActivationSide: 'far-side',
      shortcutMechanismId: 'ladder-control',
    }],
  });
  assert.equal(ladder.accepted, true);
  assert.deepEqual(ladder.bindings.map(({ stateKind }) => stateKind).sort(), [
    'ladder-deployed',
    'mechanism-activated',
  ]);
});

test('transfer bindings retain deterministic remaps from legacy blueprint state records', () => {
  const room = authoredRoom({
    transfers: [{
      id: 'transfer:legacy-lift',
      traversalKind: 'automatic-cargo-lift',
      stateRecords: [
        {
          id: 'legacy-enabled',
          runtimeStateId: 'legacy:lift-enabled',
          localStateId: 'lft-lift-enabled',
        },
        {
          id: 'legacy-position',
          runtimeStateId: 'legacy:lift-position',
          localStateId: 'lft-lift-position',
        },
      ],
    }],
  });
  const result = buildIndustrialSupplementStateBindings({ mode: V4_MODE, rooms: [room] });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.sourceStateIdRemap, {
    'legacy:lift-enabled': ['transfer:legacy-lift:state:lift-enabled'],
    'legacy:lift-position': ['transfer:legacy-lift:state:lift-position'],
  });
});

test('state validator rejects duplicate, unbound, multiply owned, and multiply consumed IDs', () => {
  const binding = {
    id: 'state:a:binding',
    runtimeStateId: 'state:a',
    stateKind: 'reward-claimed',
    owner: { kind: 'anchor', id: 'reward' },
    consumer: { kind: 'reward-runtime', id: 'reward-runtime' },
  };
  const result = validateIndustrialSupplementStateBindings({
    mode: V4_MODE,
    bindings: [
      binding,
      { ...binding, id: 'state:a:duplicate-binding' },
      {
        id: 'state:b:binding',
        runtimeStateId: 'state:b',
        stateKind: 'mechanism-activated',
        owners: [{ id: 'first' }, { id: 'second' }],
        consumers: [{ id: 'first-runtime' }, { id: 'second-runtime' }],
      },
    ],
    advertisedStateIds: ['state:a', 'state:b', 'state:unbound'],
  });
  assert.equal(result.accepted, false);
  const codes = new Set(result.errors.map(({ code }) => code));
  assert.equal(codes.has(ERROR_CODES.STATE_RUNTIME_ID_DUPLICATE), true);
  assert.equal(codes.has(ERROR_CODES.STATE_ID_UNBOUND), true);
  assert.equal(codes.has(ERROR_CODES.STATE_OWNER_AMBIGUOUS), true);
  assert.equal(codes.has(ERROR_CODES.STATE_CONSUMER_AMBIGUOUS), true);
});

test('state validator checks exactly one live owner/consumer and required state families', () => {
  const binding = {
    id: 'state:a:binding',
    runtimeStateId: 'state:a',
    stateKind: 'encounter-cleared',
    owner: { kind: 'anchor', id: 'encounter' },
    consumer: { kind: 'encounter-runtime', id: 'encounter-runtime' },
  };
  const result = validateIndustrialSupplementStateBindings({
    mode: V4_MODE,
    bindings: [binding],
    advertisedStateIds: ['state:a'],
    liveOwners: [
      { runtimeStateId: 'state:a', ownerId: 'encounter' },
      { runtimeStateId: 'state:a', ownerId: 'another-encounter' },
    ],
    liveConsumers: [],
    requiredStateKinds: ['encounter-cleared', 'reward-claimed'],
  });
  assert.equal(result.accepted, false);
  assert.equal(result.errors.some(({ code, details }) => (
    code === ERROR_CODES.STATE_OWNER_AMBIGUOUS && details?.source === 'live-owners'
  )), true);
  assert.equal(result.errors.some(({ code, details }) => (
    code === ERROR_CODES.STATE_CONSUMER_AMBIGUOUS && details?.source === 'live-consumers'
  )), true);
  assert.equal(result.errors.some(({ code, recordId }) => (
    code === ERROR_CODES.STATE_REQUIRED_KIND_MISSING && recordId === 'reward-claimed'
  )), true);
});

test('live state inventory realizes every semantic state family with one exact owner and consumer', () => {
  const bindingContract = buildIndustrialSupplementStateBindings({
    mode: V4_MODE,
    rooms: [authoredRoom({
      anchors: [
        {
          id: 'anchor:encounter',
          kind: 'encounter',
          encounterRecipe: { recipeInstanceId: 'runtime:encounter' },
        },
        {
          id: 'anchor:mechanism',
          kind: 'mechanism',
          mechanismRecipe: { recipeInstanceId: 'runtime:mechanism' },
        },
        {
          id: 'anchor:reward',
          kind: 'reward',
          rewardRecipe: { recipeInstanceId: 'runtime:reward' },
        },
      ],
      transfers: [
        { id: 'transfer:lift', traversalKind: 'automatic-cargo-lift' },
        { id: 'transfer:ladder', traversalKind: 'deployable-ladder' },
      ],
    })],
  });
  assert.equal(bindingContract.accepted, true);

  const result = buildIndustrialSupplementLiveStateBindingInventory({
    mode: V4_MODE,
    bindings: bindingContract.bindings,
    advertisedStateIds: bindingContract.advertisedStateIds,
    components: liveComponentsForBindings(bindingContract.bindings),
    requiredStateKinds: INDUSTRIAL_SUPPLEMENT_RUNTIME_STATE_KINDS,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.liveOwners.length, 6);
  assert.equal(result.liveConsumers.length, 6);
  assert.deepEqual(
    [...new Set(result.liveOwners.map(({ stateKind }) => stateKind))].sort(),
    [...INDUSTRIAL_SUPPLEMENT_RUNTIME_STATE_KINDS].sort(),
  );
  for (const binding of bindingContract.bindings) {
    const owner = result.liveOwners.find(({ runtimeStateId }) => (
      runtimeStateId === binding.runtimeStateId
    ));
    const consumer = result.liveConsumers.find(({ runtimeStateId }) => (
      runtimeStateId === binding.runtimeStateId
    ));
    assert.equal(owner.schema, INDUSTRIAL_SUPPLEMENT_LIVE_STATE_PARTICIPANT_SCHEMA);
    assert.equal(owner.ownerKind, binding.owner.kind);
    assert.equal(owner.ownerId, binding.owner.id);
    assert.equal(consumer.consumerKind, binding.consumer.kind);
    assert.equal(consumer.consumerId, binding.consumer.id);
    assert.equal(owner.rendererFree, true);
    assert.equal(consumer.rendererFree, true);
  }
});

test('live state inventory rejects identity mismatches and unadvertised component state IDs', () => {
  const binding = {
    id: 'state:reward:binding',
    runtimeStateId: 'state:reward',
    stateKind: 'reward-claimed',
    owner: { kind: 'supplemental-anchor', id: 'reward-anchor' },
    consumer: { kind: 'reward-claimed-runtime', id: 'reward-runtime' },
  };
  const result = buildIndustrialSupplementLiveStateBindingInventory({
    mode: V4_MODE,
    bindings: [binding],
    advertisedStateIds: ['state:reward'],
    components: [
      {
        id: 'wrong-reward-anchor',
        kind: 'supplemental-anchor',
        ownedRuntimeStateIds: ['state:reward', 'state:not-advertised'],
      },
      {
        id: 'reward-runtime',
        kind: 'wrong-reward-runtime-kind',
        consumedRuntimeStateIds: ['state:reward'],
      },
    ],
  });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.liveOwners, []);
  assert.deepEqual(result.liveConsumers, []);
  assert.equal(result.errors.some(({ code, runtimeStateId }) => (
    code === ERROR_CODES.STATE_OWNER_IDENTITY_MISMATCH
      && runtimeStateId === 'state:reward'
  )), true);
  assert.equal(result.errors.some(({ code, runtimeStateId }) => (
    code === ERROR_CODES.STATE_CONSUMER_IDENTITY_MISMATCH
      && runtimeStateId === 'state:reward'
  )), true);
  assert.equal(result.errors.some(({ code, runtimeStateId, details }) => (
    code === ERROR_CODES.STATE_ID_UNADVERTISED
      && runtimeStateId === 'state:not-advertised'
      && details?.source === 'live-owners'
  )), true);
});

test('live state inventory rejects duplicate components, duplicate owners, missing consumers, and unbound advertisements', () => {
  const binding = {
    id: 'state:encounter:binding',
    runtimeStateId: 'state:encounter',
    stateKind: 'encounter-cleared',
    owner: { kind: 'supplemental-anchor', id: 'encounter-anchor' },
    consumer: { kind: 'encounter-cleared-runtime', id: 'encounter-runtime' },
  };
  const duplicateOwner = {
    id: 'encounter-anchor',
    kind: 'supplemental-anchor',
    ownedRuntimeStateIds: ['state:encounter'],
  };
  const result = buildIndustrialSupplementLiveStateBindingInventory({
    mode: V4_MODE,
    bindings: [binding],
    advertisedStateIds: ['state:encounter', 'state:unbound'],
    components: [duplicateOwner, { ...duplicateOwner }],
  });
  assert.equal(result.accepted, false);
  const codes = new Set(result.errors.map(({ code }) => code));
  assert.equal(codes.has(ERROR_CODES.STATE_LIVE_COMPONENT_DUPLICATE), true);
  assert.equal(codes.has(ERROR_CODES.STATE_OWNER_AMBIGUOUS), true);
  assert.equal(codes.has(ERROR_CODES.STATE_CONSUMER_AMBIGUOUS), true);
  assert.equal(codes.has(ERROR_CODES.STATE_ID_UNBOUND), true);
});

test('live state inventory rejects descriptors that do not declare ownership or consumption', () => {
  const binding = {
    id: 'state:mechanism:binding',
    runtimeStateId: 'state:mechanism',
    stateKind: 'mechanism-activated',
    owner: { kind: 'supplemental-anchor', id: 'mechanism-anchor' },
    consumer: { kind: 'mechanism-activated-runtime', id: 'mechanism-runtime' },
  };
  const result = buildIndustrialSupplementLiveStateBindingInventory({
    mode: V4_MODE,
    bindings: [binding],
    components: [{
      id: 'mechanism-anchor',
      kind: 'supplemental-anchor',
      runtimeStateIds: ['state:mechanism'],
    }],
  });
  assert.equal(result.accepted, false);
  assert.equal(result.errors.some(({ code }) => (
    code === ERROR_CODES.STATE_LIVE_COMPONENT_MALFORMED
  )), true);
  assert.equal(result.errors.some(({ code, details }) => (
    code === ERROR_CODES.STATE_OWNER_AMBIGUOUS
      && details?.source === 'live-owners'
      && details?.count === 0
  )), true);
  assert.equal(result.errors.some(({ code, details }) => (
    code === ERROR_CODES.STATE_CONSUMER_AMBIGUOUS
      && details?.source === 'live-consumers'
      && details?.count === 0
  )), true);
});
