import {
  clonePlanData,
  deepFreezePlan,
  isSerializablePlanValue,
} from './DungeonPlanV2Contract.js';
import {
  createPlanDiagnostic,
  hashPlanDiagnostics,
  sortPlanDiagnostics,
} from './DungeonPlanDiagnostics.js';

export const SEMANTIC_ROOM_PACK_STATE_BRIDGE_V2_REVISION = 1;

const FACTORY_ROOM_ID = 'rdx_factory_corkscrew_exchange';
const WATER_ROOM_ID = 'rdx_waterworks_freight_sump';
const UNDERCROFT_ROOM_IDS = Object.freeze({
  magma: 'rdx_magma_foundry_undercroft',
  electrical: 'rdx_electric_transformer_undercroft',
});
const CORKSCREW_STATE_IDS = Object.freeze([
  'south_entry',
  'east_mid',
  'north_high',
  'west_top',
]);
const WATER_STATE_BINDINGS = Object.freeze([
  Object.freeze({ stateId: 'FreightSumpFilled', levelKey: 'freightLevelWorldY' }),
  Object.freeze({ stateId: 'StoredInReservoir', levelKey: 'storedLevelWorldY' }),
  Object.freeze({ stateId: 'GantrySumpFilled', levelKey: 'gantryLevelWorldY' }),
]);
const GEAR_ACTION_BINDINGS = Object.freeze([
  Object.freeze({ stateId: 'south_entry', actionId: 'action.gear.align-low', anchorId: 'anchor.gear.low', previousStateId: 'LowLanding' }),
  Object.freeze({ stateId: 'east_mid', actionId: 'action.gear.align-bridge', anchorId: 'anchor.gear.bridge', previousStateId: 'BridgeAligned' }),
  Object.freeze({ stateId: 'north_high', actionId: 'action.gear.align-north-high', anchorId: 'anchor.gear.north-high', previousStateId: null }),
  Object.freeze({ stateId: 'west_top', actionId: 'action.gear.align-high', anchorId: 'anchor.gear.high', previousStateId: 'HighLanding' }),
]);
const LEGACY_GEAR_STATE_ALIASES = Object.freeze({
  LowLanding: 'south_entry',
  BridgeAligned: 'east_mid',
  HighLanding: 'west_top',
});

function round(value) {
  const result = Math.round(Number(value) * 1e9) / 1e9;
  return Object.is(result, -0) ? 0 : result;
}

function diagnostic(errors, code, message, details = {}) {
  errors.push(createPlanDiagnostic(code, message, details));
}

function resultFor(errors, plan = null, details = {}) {
  const sorted = sortPlanDiagnostics(errors);
  return Object.freeze({
    accepted: sorted.length === 0,
    valid: sorted.length === 0,
    plan,
    errors: Object.freeze(sorted),
    diagnosticHash: hashPlanDiagnostics(sorted),
    details: deepFreezePlan(clonePlanData(details)),
  });
}

function byId(collection) {
  return new Map((collection ?? []).map((entry) => [entry.id, entry]));
}

function finiteVector(value) {
  return value && ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]));
}

function finiteBounds(value) {
  return finiteVector(value?.min)
    && finiteVector(value?.max)
    && ['x', 'y', 'z'].every((axis) => value.min[axis] < value.max[axis]);
}

function findUnique(errors, collection, predicate, code, label) {
  const matches = (collection ?? []).filter(predicate);
  if (matches.length !== 1) {
    diagnostic(errors, code, `Semantic room-pack state bridge requires exactly one ${label}.`, {
      actualCount: matches.length,
    });
    return null;
  }
  return matches[0];
}

function markerByName(errors, placement, sourceNodeName) {
  const marker = (placement?.semanticMarkers ?? []).find((entry) => entry.sourceNodeName === sourceNodeName);
  if (!marker || !finiteVector(marker.worldPosition)) {
    diagnostic(errors, 'semantic-room-pack-state-anchor-missing', `${placement?.placementId ?? '<missing>'} lacks exact authored anchor ${sourceNodeName}.`, {
      placementId: placement?.placementId ?? null,
      sourceNodeName,
    });
    return null;
  }
  return marker;
}

function requireSurface(errors, surfaceById, surfaceId, purpose) {
  const surface = surfaceById.get(surfaceId);
  if (!surface || !finiteBounds(surface.bounds)) {
    diagnostic(errors, 'semantic-room-pack-state-surface-binding-missing', `Authored ${purpose} must reference a finite plan-owned surface.`, {
      surfaceId: surfaceId ?? null,
      purpose,
    });
    return null;
  }
  return surface;
}

function validateCollections(plan, errors) {
  for (const name of [
    'semanticRoomPackPlacements',
    'walkableSurfaces',
    'mechanisms',
    'environmentStates',
    'actions',
    'anchors',
    'portals',
    'traversalLinks',
    'rewards',
    'objectives',
  ]) {
    if (!Array.isArray(plan?.[name])) {
      diagnostic(errors, 'semantic-room-pack-state-collection-missing', `Mutable plan.${name} is required.`, { collection: name });
    }
  }
  if (plan && (Object.isFrozen(plan) || Object.isFrozen(plan.semanticRoomPackPlacements))) {
    diagnostic(errors, 'semantic-room-pack-state-plan-immutable', 'State reconciliation requires the mutable raw plan before DungeonPlanV2 is frozen.');
  }
}

function replaceOrAddById(collection, record) {
  const index = collection.findIndex(({ id }) => id === record.id);
  if (index < 0) collection.push(record);
  else collection[index] = record;
}

function exactMarkerAnchor(existing, id, marker, surfaceId, regionId, purpose) {
  return {
    ...(existing ?? {}),
    id,
    regionId,
    position: clonePlanData(marker.worldPosition),
    purpose: purpose ?? existing?.purpose ?? marker.sourceNodeName,
    surfaceId,
    safeSurfaceId: surfaceId,
    semanticRoomPackPlacementId: marker.id.split(':anchor:')[0] ?? null,
    sourceSemanticAnchorId: marker.id,
    sourceNodeName: marker.sourceNodeName,
    authoredWorldPosition: clonePlanData(marker.worldPosition),
  };
}

function rewritePackStateReferences(value, context = {}) {
  if (Array.isArray(value)) return value.map((entry) => rewritePackStateReferences(entry, context));
  if (!value || typeof value !== 'object') return value;
  const next = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewritePackStateReferences(entry, context)]));
  if (next.op === 'stateEquals') {
    if (next.variableId === 'mechanism.corkscrew-gear.state') {
      next.value = LEGACY_GEAR_STATE_ALIASES[next.value] ?? next.value;
    } else if (next.variableId === context.factoryStateVariableId) {
      next.variableId = 'mechanism.corkscrew-gear.state';
    } else if (next.variableId === context.waterStateVariableId) {
      next.variableId = 'water.unit.configuration';
    }
  }
  if (next.op === 'setMechanismState' && next.mechanismId === 'mechanism.corkscrew-gear') {
    next.stateId = LEGACY_GEAR_STATE_ALIASES[next.stateId] ?? next.stateId;
  }
  return next;
}

function validateFactory(errors, plan, placement, surfaceById) {
  const authored = findUnique(
    errors,
    placement?.mechanisms,
    ({ localId }) => localId === 'corkscrew_exchange',
    'semantic-room-pack-corkscrew-contract-missing',
    'authored corkscrew_exchange mechanism',
  );
  const stateIds = authored?.stableStates?.map(({ localId }) => localId) ?? [];
  if (JSON.stringify(stateIds) !== JSON.stringify(CORKSCREW_STATE_IDS)
    || authored?.stableStates?.some((state) => !Number.isFinite(state.worldHeight) || !Number.isFinite(state.worldYawDegrees))) {
    diagnostic(errors, 'semantic-room-pack-corkscrew-state-mismatch', 'Factory corkscrew must expose the four authored stable stops with finite world poses.', {
      actualStateIds: stateIds,
      expectedStateIds: CORKSCREW_STATE_IDS,
    });
  }
  const binding = placement?.runtimeContractBindings?.corkscrew;
  const dynamicSurface = requireSurface(errors, surfaceById, binding?.dynamicSurfaceId, 'corkscrew dynamic platform');
  const controlSurface = requireSurface(errors, surfaceById, binding?.controlSurfaceId, 'corkscrew control');
  if (dynamicSurface && (dynamicSurface.collision !== 'dynamic'
    || dynamicSurface.mechanismId !== 'mechanism.corkscrew-gear'
    || dynamicSurface.sourceNodeName !== 'MECH_GEAR_PLATFORM')) {
    diagnostic(errors, 'semantic-room-pack-corkscrew-dynamic-surface-invalid', 'Corkscrew motion must use the explicit MECH_GEAR_PLATFORM plan surface, never a render-mesh bound.', {
      surfaceId: dynamicSurface.id,
      collision: dynamicSurface.collision ?? null,
      mechanismId: dynamicSurface.mechanismId ?? null,
      sourceNodeName: dynamicSurface.sourceNodeName ?? null,
    });
  }
  return {
    authored,
    binding,
    dynamicSurface,
    controlSurface,
    consoleMarker: markerByName(errors, placement, 'ANCHOR_MECHANISM_CONSOLE'),
    platformMarker: markerByName(errors, placement, 'MECH_GEAR_PLATFORM'),
  };
}

function waterLevelByState(contract) {
  return Object.fromEntries((contract?.stableStates ?? []).map((entry) => [entry.id, entry.levels]));
}

function validateWater(errors, plan, placement, surfaceById) {
  const contract = findUnique(
    errors,
    placement?.environmentContracts,
    ({ kind }) => kind === 'conserved-fluid-network',
    'semantic-room-pack-water-contract-missing',
    'authored conserved Waterworks contract',
  );
  const bindings = placement?.runtimeContractBindings?.water;
  const basinBindings = bindings?.basins;
  if (!contract || contract.conservedVolumeUnits !== 1
    || !Number.isFinite(contract.basinBottomWorldY)) {
    diagnostic(errors, 'semantic-room-pack-water-contract-invalid', 'Waterworks must retain one conserved unit and its exact authored basin bottom.', {
      placementId: placement?.placementId ?? null,
    });
  }
  if (!Array.isArray(basinBindings) || basinBindings.length !== 3) {
    diagnostic(errors, 'semantic-room-pack-water-basin-bindings-missing', 'Golden integration must supply three explicit authored basin geometry bindings.', {
      actualCount: basinBindings?.length ?? null,
    });
  }
  const levelByState = waterLevelByState(contract);
  const basinRecords = [];
  const volumes = [];
  for (const expected of WATER_STATE_BINDINGS) {
    const binding = basinBindings?.find(({ stateId }) => stateId === expected.stateId);
    const levelY = levelByState[expected.stateId]?.[expected.levelKey];
    const floor = requireSurface(errors, surfaceById, binding?.floorSurfaceId, `${expected.stateId} basin floor`);
    if (!binding || binding.levelKey !== expected.levelKey || !finiteBounds(binding.bounds) || !Number.isFinite(levelY)) {
      diagnostic(errors, 'semantic-room-pack-water-basin-binding-invalid', `${expected.stateId} lacks exact bounds, floor, or authored level binding.`, {
        stateId: expected.stateId,
        levelKey: expected.levelKey,
      });
      continue;
    }
    if (expected.stateId === 'FreightSumpFilled'
      && Math.abs(binding.bounds.min.y - contract.basinBottomWorldY) > 0.01) {
      diagnostic(errors, 'semantic-room-pack-water-freight-bottom-mismatch', 'Freight basin bounds must begin at the manifest-authored basin bottom.', {
        expectedBottomWorldY: contract.basinBottomWorldY,
        actualBottomWorldY: binding.bounds.min.y,
      });
    }
    if (floor && (Math.abs(floor.bounds.min.x - binding.bounds.min.x) > 0.001
      || Math.abs(floor.bounds.max.x - binding.bounds.max.x) > 0.001
      || Math.abs(floor.bounds.min.z - binding.bounds.min.z) > 0.001
      || Math.abs(floor.bounds.max.z - binding.bounds.max.z) > 0.001
      || Math.abs(floor.bounds.max.y - binding.bounds.min.y) > 0.05)) {
      diagnostic(errors, 'semantic-room-pack-water-basin-floor-mismatch', `${expected.stateId} basin bounds do not match their complete plan-owned floor.`, {
        stateId: expected.stateId,
        floorSurfaceId: binding.floorSurfaceId,
      });
    }
    const depth = round(levelY - binding.bounds.min.y);
    const area = (binding.bounds.max.x - binding.bounds.min.x) * (binding.bounds.max.z - binding.bounds.min.z);
    const volume = round(area * depth);
    if (!(depth > 0) || binding.bounds.max.y < levelY) {
      diagnostic(errors, 'semantic-room-pack-water-level-outside-basin', `${expected.stateId} exact water level lies outside its authored basin.`, {
        stateId: expected.stateId,
        levelWorldY: levelY,
        bounds: binding.bounds,
      });
    }
    volumes.push(volume);
    basinRecords.push({ binding, floor, levelY, depth, volume });
  }
  if (volumes.length === 3 && volumes.some((value) => Math.abs(value - volumes[0]) > 0.001)) {
    diagnostic(errors, 'semantic-room-pack-water-geometric-volume-mismatch', 'The three authored basin bindings do not conserve one geometric water volume.', { volumes });
  }
  const controlSurface = requireSurface(errors, surfaceById, bindings?.controlSurfaceId, 'permanently dry master water console');
  const discoverySurfaceIds = bindings?.discoverySurfaceIds ?? {};
  const floodedSurface = requireSurface(errors, surfaceById, discoverySurfaceIds.submerged_salvage_cache, 'flooded discovery');
  const drainedSurface = requireSurface(errors, surfaceById, discoverySurfaceIds.drained_tunnel_cache, 'drained discovery');
  const freightFluid = markerByName(errors, placement, 'FLUID_FACTORY_WATER_LEVEL_FREIGHT');
  return {
    contract,
    bindings,
    basinRecords,
    controlSurface,
    floodedSurface,
    drainedSurface,
    consoleMarker: markerByName(errors, placement, 'ANCHOR_MASTER_CONSOLE'),
    floodedMarker: markerByName(errors, placement, 'ANCHOR_REWARD_SUBMERGED'),
    drainedMarker: markerByName(errors, placement, 'ANCHOR_REWARD_DRAINED'),
    freightFluid,
  };
}

function validateHazard(errors, plan, placement, surfaceById, undercroftType) {
  const contract = findUnique(
    errors,
    placement?.environmentContracts,
    ({ kind }) => kind === 'environmental-hazard',
    'semantic-room-pack-hazard-contract-missing',
    'selected authored Undercroft hazard contract',
  );
  const expectedProfile = undercroftType === 'magma' ? 'magma_floor_v1' : 'electric_floor_cycle_v1';
  if (contract?.profile !== expectedProfile || contract?.criticalRouteDamageFree !== true) {
    diagnostic(errors, 'semantic-room-pack-hazard-profile-mismatch', 'Selected Undercroft hazard profile or damage-free critical route changed.', {
      expectedProfile,
      actualProfile: contract?.profile ?? null,
    });
  }
  const binding = placement?.runtimeContractBindings?.hazard;
  if (!Array.isArray(binding?.surfaceIds) || binding.surfaceIds.length === 0) {
    diagnostic(errors, 'semantic-room-pack-hazard-surface-bindings-missing', 'Undercroft integration must bind explicit plan-owned hazard surfaces.');
  }
  const surfaces = (binding?.surfaceIds ?? []).map((id) => requireSurface(errors, surfaceById, id, 'Undercroft hazard'));
  const rewardSurface = requireSurface(errors, surfaceById, binding?.rewardSurfaceId, 'Undercroft reward');
  const rewardMarker = (placement?.semanticMarkers ?? []).find(({ semantic }) => semantic === 'rewardAnchor');
  if (!rewardMarker || !finiteVector(rewardMarker.worldPosition)) {
    diagnostic(errors, 'semantic-room-pack-undercroft-reward-anchor-missing', 'Selected Undercroft lacks its exact authored reward anchor.');
  }
  return { contract, binding, surfaces: surfaces.filter(Boolean), rewardSurface, rewardMarker, expectedProfile };
}

function createWaterEnvironment(previous, context) {
  const basins = context.basinRecords.map(({ binding, levelY, depth, volume }) => ({
    id: binding.basinId,
    regionId: binding.regionId,
    bounds: clonePlanData(binding.bounds),
    floorSurfaceId: binding.floorSurfaceId,
    walkableBottomY: binding.bounds.min.y,
    playerRootTolerance: 0.5,
    capacityUnits: 1,
    exactFilledVolume: volume,
    exactFilledLevel: depth,
    exactFilledWorldY: levelY,
    footprintPolicy: 'complete-main-walkable-basin',
    semanticRoomPackPlacementId: context.placement.placementId,
  }));
  const levelsFor = (filledId) => Object.fromEntries(basins.map(({ id, exactFilledLevel }) => [
    id,
    id === filledId ? exactFilledLevel : 0,
  ]));
  const absoluteFor = (filledId) => Object.fromEntries(basins.map(({ id, exactFilledWorldY }) => [
    id,
    id === filledId ? exactFilledWorldY : null,
  ]));
  return {
    ...previous,
    id: 'environment.water-unit',
    type: 'conserved-water-unit',
    variableId: 'water.unit.configuration',
    capacityUnits: 1,
    conservedVolume: 1,
    initialStateId: 'FreightSumpFilled',
    transferCommit: 'atomic-after-animation',
    basins,
    stableStates: WATER_STATE_BINDINGS.map(({ stateId }, index) => ({
      id: stateId,
      totalUnits: 1,
      exactVolume: basins[index].exactFilledVolume,
      basinLevels: levelsFor(basins[index].id),
      absoluteBasinLevels: absoluteFor(basins[index].id),
    })),
    movementProfile: {
      captureFloodedStateAtTakeoff: true,
      groundMovementMultiplier: 0.76,
      jumpHeight: 4.95,
      gravityScale: 0.28,
      mode: 'bottom-walking',
    },
    permanentDryControlAnchorIds: ['anchor.water-router.freight', 'anchor.water-router.reservoir', 'anchor.water-router.gantry'],
    permanentDryClearance: 0.2,
    sourceSemanticRoomPackPlacementId: context.placement.placementId,
    sourceEnvironmentContractId: context.contract.id,
  };
}

function createHazardEnvironment(previous, context) {
  const parameters = context.contract.parameters ?? {};
  const hazardTag = context.expectedProfile === 'magma_floor_v1'
    ? 'environmental:magma'
    : 'environmental:electrical';
  const common = {
    ...previous,
    id: 'environment.undercroft-hazard',
    type: context.expectedProfile.replaceAll('_', '-'),
    hazardTag,
    tags: context.expectedProfile === 'magma_floor_v1'
      ? ['environmental:magma', 'environmentalHeat', 'fireFloor']
      : ['environmental:electrical'],
    damagePerSecond: parameters.damagePerSecond,
    surfaces: context.surfaces.map((surface) => ({
      surfaceId: surface.id,
      regionId: surface.regionId,
      sourceSemanticRoomPackPlacementId: context.placement.placementId,
    })),
    safeRouteRequired: true,
    ordinaryEnemyAvoidance: true,
    sourceSemanticRoomPackPlacementId: context.placement.placementId,
    sourceEnvironmentContractId: context.contract.id,
  };
  if (context.expectedProfile === 'magma_floor_v1') {
    return {
      ...common,
      pulseSeconds: parameters.pulseSeconds,
      entryGraceSeconds: parameters.entryGraceSeconds,
      graceSeconds: parameters.entryGraceSeconds,
      activeSeconds: parameters.pulseSeconds,
      recoverySeconds: 0,
    };
  }
  return {
    ...common,
    phaseCycleSeconds: parameters.cycleSeconds,
    entryPhase: 'safe',
    phases: [
      { id: 'safe', durationSeconds: parameters.safeSeconds },
      { id: 'charging', durationSeconds: parameters.chargingSeconds },
      { id: 'energized', durationSeconds: parameters.energizedSeconds },
    ],
    timing: {
      safeSeconds: parameters.safeSeconds,
      chargingSeconds: parameters.chargingSeconds,
      activeSeconds: parameters.energizedSeconds,
      cycleSeconds: parameters.cycleSeconds,
    },
  };
}

function reconcileDraft(plan) {
  const errors = [];
  validateCollections(plan, errors);
  if (errors.length) return resultFor(errors);
  const placements = plan.semanticRoomPackPlacements;
  if (placements.length !== 3) {
    diagnostic(errors, 'semantic-room-pack-state-placement-count', 'State bridge requires Factory, Waterworks, and exactly one Undercroft placement.', {
      actualCount: placements.length,
    });
  }
  const factory = findUnique(errors, placements, ({ roomId }) => roomId === FACTORY_ROOM_ID,
    'semantic-room-pack-state-factory-placement-missing', 'Factory corkscrew placement');
  const water = findUnique(errors, placements, ({ roomId }) => roomId === WATER_ROOM_ID,
    'semantic-room-pack-state-water-placement-missing', 'Waterworks placement');
  const undercroftType = plan.undercroftType;
  const undercroftRoomId = UNDERCROFT_ROOM_IDS[undercroftType];
  if (!undercroftRoomId) {
    diagnostic(errors, 'semantic-room-pack-state-undercroft-type-invalid', 'Plan undercroftType must be magma or electrical.', {
      undercroftType: undercroftType ?? null,
    });
  }
  const undercroft = undercroftRoomId
    ? findUnique(errors, placements, ({ roomId }) => roomId === undercroftRoomId,
      'semantic-room-pack-state-undercroft-placement-missing', `${undercroftType} Undercroft placement`)
    : null;
  const surfaceById = byId(plan.walkableSurfaces);
  const factoryContext = factory ? validateFactory(errors, plan, factory, surfaceById) : null;
  const waterContext = water ? validateWater(errors, plan, water, surfaceById) : null;
  const hazardContext = undercroft ? validateHazard(errors, plan, undercroft, surfaceById, undercroftType) : null;
  if (errors.length) return resultFor(errors, null, { undercroftType, placementCount: placements.length });

  const draft = clonePlanData(plan);
  const draftSurfaceById = byId(draft.walkableSurfaces);
  const draftAnchorById = byId(draft.anchors);
  const factoryMechanism = draft.mechanisms.find(({ id }) => id === 'mechanism.corkscrew-gear');
  const waterEnvironmentIndex = draft.environmentStates.findIndex(({ id, type }) => id === 'environment.water-unit' || type === 'conserved-water-unit');
  const hazardEnvironmentIndex = draft.environmentStates.findIndex(({ id }) => id === 'environment.undercroft-hazard');
  const hazardMechanism = draft.mechanisms.find(({ id }) => id === 'mechanism.undercroft-hazard');
  const waterMechanism = draft.mechanisms.find(({ id }) => id === 'mechanism.water-router');
  if (!factoryMechanism || waterEnvironmentIndex < 0 || hazardEnvironmentIndex < 0 || !hazardMechanism || !waterMechanism) {
    diagnostic(errors, 'semantic-room-pack-state-global-contract-missing', 'Existing global corkscrew, water, hazard, and router contracts are required for deterministic migration.', {
      corkscrew: Boolean(factoryMechanism),
      waterEnvironment: waterEnvironmentIndex >= 0,
      hazardEnvironment: hazardEnvironmentIndex >= 0,
      hazardMechanism: Boolean(hazardMechanism),
      waterMechanism: Boolean(waterMechanism),
    });
    return resultFor(errors);
  }

  const factoryPlacement = draft.semanticRoomPackPlacements.find(({ roomId }) => roomId === FACTORY_ROOM_ID);
  const waterPlacement = draft.semanticRoomPackPlacements.find(({ roomId }) => roomId === WATER_ROOM_ID);
  const undercroftPlacement = draft.semanticRoomPackPlacements.find(({ roomId }) => roomId === undercroftRoomId);
  const factoryAuthored = factoryPlacement.mechanisms.find(({ localId }) => localId === 'corkscrew_exchange');
  const platformMarker = factoryPlacement.semanticMarkers.find(({ sourceNodeName }) => sourceNodeName === 'MECH_GEAR_PLATFORM');
  const consoleMarker = factoryPlacement.semanticMarkers.find(({ sourceNodeName }) => sourceNodeName === 'ANCHOR_MECHANISM_CONSOLE');
  const factoryBinding = factoryPlacement.runtimeContractBindings.corkscrew;
  factoryMechanism.initialStateId = 'south_entry';
  factoryMechanism.anchorId = 'anchor.gear.bridge';
  factoryMechanism.recallable = true;
  factoryMechanism.automaticTravel = false;
  factoryMechanism.states = factoryAuthored.stableStates.map((state) => ({
    id: state.localId,
    stable: true,
    elevation: state.worldHeight,
    position: { x: platformMarker.worldPosition.x, y: state.worldHeight, z: platformMarker.worldPosition.z },
    yawDegrees: state.worldYawDegrees,
    deployedBridge: state.deployedBridge,
    dynamicSurfaceId: factoryBinding.dynamicSurfaceId,
  }));
  factoryMechanism.transitions = GEAR_ACTION_BINDINGS.map(({ stateId, actionId }) => ({
    fromStateId: '*',
    toStateId: stateId,
    actionId,
    trigger: 'authored-console-command',
    automatic: false,
    legal: true,
  }));
  factoryMechanism.actionIds = GEAR_ACTION_BINDINGS.map(({ actionId }) => actionId);
  factoryMechanism.runtimeProfile = {
    ...(factoryMechanism.runtimeProfile ?? {}),
    dynamicSurfaceId: factoryBinding.dynamicSurfaceId,
    sourceNodeName: 'MECH_GEAR_PLATFORM',
    collisionAuthority: 'plan-owned-semantic-room-pack-surface',
    stableStateOrder: [...CORKSCREW_STATE_IDS],
    controlsAreAutomatic: false,
  };
  factoryMechanism.legacyStateAliases = clonePlanData(LEGACY_GEAR_STATE_ALIASES);
  for (const actionBinding of GEAR_ACTION_BINDINGS) {
    const anchor = exactMarkerAnchor(
      draftAnchorById.get(actionBinding.anchorId),
      actionBinding.anchorId,
      consoleMarker,
      factoryBinding.controlSurfaceId,
      factoryPlacement.goldenRegionId ?? 'corkscrew',
      `authored corkscrew command for ${actionBinding.stateId}`,
    );
    replaceOrAddById(draft.anchors, anchor);
    replaceOrAddById(draft.actions, {
      ...(draft.actions.find(({ id }) => id === actionBinding.actionId) ?? {}),
      id: actionBinding.actionId,
      type: 'mechanism-control',
      anchorId: actionBinding.anchorId,
      interaction: draft.actions.find(({ id }) => id === actionBinding.actionId)?.interaction
        ?? { radius: 2.2, activationSide: 'either' },
      conditions: [],
      effects: [{ op: 'setMechanismState', mechanismId: 'mechanism.corkscrew-gear', stateId: actionBinding.stateId }],
      barrierIds: [],
      controllerId: 'mechanism.corkscrew-gear',
      semanticRoomPackStateId: actionBinding.stateId,
      previousStateIdAlias: actionBinding.previousStateId,
    });
  }

  const waterDraftContext = {
    ...waterContext,
    placement: waterPlacement,
    basinRecords: waterContext.basinRecords.map((record) => clonePlanData(record)),
  };
  draft.environmentStates[waterEnvironmentIndex] = createWaterEnvironment(
    draft.environmentStates[waterEnvironmentIndex],
    waterDraftContext,
  );
  const waterConsoleMarker = waterPlacement.semanticMarkers.find(({ sourceNodeName }) => sourceNodeName === 'ANCHOR_MASTER_CONSOLE');
  const waterBinding = waterPlacement.runtimeContractBindings.water;
  for (const id of ['anchor.water-router.freight', 'anchor.water-router.reservoir', 'anchor.water-router.gantry']) {
    replaceOrAddById(draft.anchors, exactMarkerAnchor(
      byId(draft.anchors).get(id), id, waterConsoleMarker, waterBinding.controlSurfaceId,
      waterPlacement.goldenRegionId ?? 'freight-sump', 'permanently dry authored master water router',
    ));
  }
  waterMechanism.regionId = waterPlacement.goldenRegionId ?? waterMechanism.regionId;
  waterMechanism.anchorId = 'anchor.water-router.reservoir';
  waterMechanism.initialStateId = 'FreightSumpFilled';
  waterMechanism.states = WATER_STATE_BINDINGS.map(({ stateId }) => ({ id: stateId, stable: true }));
  waterMechanism.transitions = WATER_STATE_BINDINGS.flatMap(({ stateId }) => WATER_STATE_BINDINGS
    .filter(({ stateId: candidate }) => candidate !== stateId)
    .map(({ stateId: toStateId }) => ({
      fromStateId: stateId,
      toStateId,
      actionId: `action.water.${toStateId === 'FreightSumpFilled' ? 'freight-sump' : toStateId === 'StoredInReservoir' ? 'reservoir' : 'gantry-sump'}`,
      legal: true,
    })));
  waterMechanism.runtimeProfile = {
    ...(waterMechanism.runtimeProfile ?? {}),
    environmentStateId: 'environment.water-unit',
    sourceEnvironmentContractId: waterPlacement.environmentContracts.find(({ kind }) => kind === 'conserved-fluid-network').id,
  };
  const floodedMarker = waterPlacement.semanticMarkers.find(({ sourceNodeName }) => sourceNodeName === 'ANCHOR_REWARD_SUBMERGED');
  const drainedMarker = waterPlacement.semanticMarkers.find(({ sourceNodeName }) => sourceNodeName === 'ANCHOR_REWARD_DRAINED');
  replaceOrAddById(draft.anchors, exactMarkerAnchor(
    byId(draft.anchors).get('anchor.discovery.flooded'), 'anchor.discovery.flooded', floodedMarker,
    waterBinding.discoverySurfaceIds.submerged_salvage_cache,
    waterPlacement.goldenRegionId ?? 'freight-sump', 'authored flooded-only Waterworks discovery',
  ));
  replaceOrAddById(draft.anchors, exactMarkerAnchor(
    byId(draft.anchors).get('anchor.discovery.drained'), 'anchor.discovery.drained', drainedMarker,
    waterBinding.discoverySurfaceIds.drained_tunnel_cache,
    waterPlacement.goldenRegionId ?? 'freight-sump', 'authored drained-only Waterworks discovery',
  ));
  const waterPlacementIndex = draft.semanticRoomPackPlacements.findIndex(({ roomId }) => roomId === WATER_ROOM_ID);
  draft.semanticRoomPackPlacements[waterPlacementIndex] = {
    ...waterPlacement,
    runtimePresentationBindings: {
      ...(waterPlacement.runtimePresentationBindings ?? {}),
      globalEnvironmentId: 'environment.water-unit',
      waterBasins: [{
        basinId: waterBinding.basins.find(({ stateId }) => stateId === 'FreightSumpFilled').basinId,
        sourceNodeName: 'FLUID_FACTORY_WATER_LEVEL_FREIGHT',
        presentationMode: 'authored-fluid-volume',
        stateId: 'FreightSumpFilled',
        absoluteWorldY: waterPlacement.environmentContracts
          .find(({ kind }) => kind === 'conserved-fluid-network')
          .stableStates.find(({ id }) => id === 'FreightSumpFilled').levels.freightLevelWorldY,
      }],
    },
  };

  const hazardDraftContext = { ...hazardContext, placement: undercroftPlacement };
  draft.environmentStates[hazardEnvironmentIndex] = createHazardEnvironment(
    draft.environmentStates[hazardEnvironmentIndex],
    hazardDraftContext,
  );
  const hazardEnvironment = draft.environmentStates[hazardEnvironmentIndex];
  for (const surfaceId of undercroftPlacement.runtimeContractBindings.hazard.surfaceIds) {
    const surface = draftSurfaceById.get(surfaceId);
    surface.hazardTag = hazardEnvironment.hazardTag;
    surface.environmentStateId = hazardEnvironment.id;
    surface.semanticRoomPackPlacementId = undercroftPlacement.placementId;
  }
  hazardMechanism.type = hazardEnvironment.type;
  hazardMechanism.regionId = undercroftPlacement.goldenRegionId ?? hazardMechanism.regionId;
  hazardMechanism.initialStateId = undercroftType === 'magma' ? 'Active' : 'Safe';
  hazardMechanism.states = undercroftType === 'magma'
    ? [{ id: 'Active', stable: true }]
    : [{ id: 'Safe', stable: true }, { id: 'Charging', stable: false }, { id: 'Energized', stable: true }];
  hazardMechanism.transitions = undercroftType === 'magma' ? [] : [
    { fromStateId: 'Safe', toStateId: 'Charging', automatic: true, afterSeconds: hazardEnvironment.phases[0].durationSeconds },
    { fromStateId: 'Charging', toStateId: 'Energized', automatic: true, afterSeconds: hazardEnvironment.phases[1].durationSeconds },
    { fromStateId: 'Energized', toStateId: 'Safe', automatic: true, afterSeconds: hazardEnvironment.phases[2].durationSeconds },
  ];
  hazardMechanism.runtimeProfile = {
    ...(hazardMechanism.runtimeProfile ?? {}),
    environmentStateId: hazardEnvironment.id,
    sourceEnvironmentContractId: undercroftPlacement.environmentContracts.find(({ kind }) => kind === 'environmental-hazard').id,
  };
  const rewardMarker = undercroftPlacement.semanticMarkers.find(({ semantic }) => semantic === 'rewardAnchor');
  replaceOrAddById(draft.anchors, exactMarkerAnchor(
    byId(draft.anchors).get('anchor.cache.undercroft'), 'anchor.cache.undercroft', rewardMarker,
    undercroftPlacement.runtimeContractBindings.hazard.rewardSurfaceId,
    undercroftPlacement.goldenRegionId ?? 'hazard-core', 'authored Undercroft major cache',
  ));

  const referenceContext = {
    factoryStateVariableId: factoryAuthored.stateVariableId,
    waterStateVariableId: waterPlacement.environmentContracts.find(({ kind }) => kind === 'conserved-fluid-network').stateVariableId,
  };
  draft.portals = rewritePackStateReferences(draft.portals, referenceContext);
  draft.traversalLinks = rewritePackStateReferences(draft.traversalLinks, referenceContext);
  draft.actions = rewritePackStateReferences(draft.actions, referenceContext);
  draft.objectives = rewritePackStateReferences(draft.objectives, referenceContext);
  if (draft.stateModel) draft.stateModel = rewritePackStateReferences(draft.stateModel, referenceContext);

  draft.semanticRoomPackStateBridge = {
    revision: SEMANTIC_ROOM_PACK_STATE_BRIDGE_V2_REVISION,
    placementIds: [factoryPlacement.placementId, waterPlacement.placementId, undercroftPlacement.placementId],
    undercroftType,
    globalContracts: ['mechanism.corkscrew-gear', 'environment.water-unit', 'environment.undercroft-hazard'],
    legacyGearStateAliases: clonePlanData(LEGACY_GEAR_STATE_ALIASES),
    fullyReconciled: true,
    diagnostics: [],
  };
  if (!isSerializablePlanValue(draft)) {
    diagnostic(errors, 'semantic-room-pack-state-not-serializable', 'Reconciled room-pack plan data contains a non-serializable value.');
    return resultFor(errors);
  }
  return resultFor([], draft, {
    undercroftType,
    corkscrewStateIds: CORKSCREW_STATE_IDS,
    waterStateIds: WATER_STATE_BINDINGS.map(({ stateId }) => stateId),
    hazardProfile: hazardContext.expectedProfile,
  });
}

export function validateSemanticRoomPackStateBridgeV2(plan) {
  return reconcileDraft(plan);
}

export class SemanticRoomPackStateBridgeErrorV2 extends Error {
  constructor(result) {
    const first = result.errors?.[0];
    super(first
      ? `Semantic room-pack state bridge rejected: ${first.code}: ${first.message}`
      : 'Semantic room-pack state bridge rejected.');
    this.name = 'SemanticRoomPackStateBridgeErrorV2';
    this.code = 'SEMANTIC_ROOM_PACK_STATE_BRIDGE_INVALID';
    this.result = result;
  }
}

export function reconcileSemanticRoomPackStateBridgeV2(plan) {
  const result = reconcileDraft(plan);
  if (!result.accepted) throw new SemanticRoomPackStateBridgeErrorV2(result);
  const reconciled = result.plan;
  for (const key of [
    'semanticRoomPackPlacements',
    'walkableSurfaces',
    'mechanisms',
    'environmentStates',
    'actions',
    'anchors',
    'portals',
    'traversalLinks',
    'objectives',
    'stateModel',
    'semanticRoomPackStateBridge',
  ]) {
    if (Object.hasOwn(reconciled, key)) plan[key] = reconciled[key];
  }
  return plan;
}

export default reconcileSemanticRoomPackStateBridgeV2;
