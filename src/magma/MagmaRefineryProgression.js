import { validateMagmaModuleSelection } from './MagmaRefineryCatalog.js';

export const SMELTER_SEAL_ID = 'Smelter_Seal';

export const MAGMA_INITIAL_FACILITY_STATE = Object.freeze({
  smelterSealOwned: false,
  slagFlowDiverted: false,
  slagShortcutOnline: false,
  furnaceDraftRestored: false,
  furnacePressureStabilized: false,
  furnaceShortcutOnline: false,
  crucibleBossGateOpen: false,
  crucibleWardenDefeated: false,
  shrineBarrierReleased: false,
  largeRefractorSecured: false,
});

export function createMagmaFacilityState(saved = null) {
  return Object.seal({
    ...MAGMA_INITIAL_FACILITY_STATE,
    ...(saved && typeof saved === 'object' ? saved : null),
  });
}

export function recomputeMagmaDerivedState(state) {
  state.crucibleBossGateOpen = Boolean(
    state.slagFlowDiverted && state.furnacePressureStabilized,
  );
  return state;
}

export function evaluateMagmaGatePredicate(predicate, context = {}) {
  if (!predicate) return { accepted: true, reason: 'unconditional' };
  const state = context.facilityState ?? {};
  const credentials = context.credentials ?? new Set();
  const encounters = context.encounters ?? [];
  switch (predicate.kind) {
    case 'credential': {
      const accepted = credentials.has(predicate.credentialId)
        || (predicate.credentialId === SMELTER_SEAL_ID && state.smelterSealOwned === true);
      return { accepted, reason: accepted ? 'credential-owned' : `requires:${predicate.credentialId}` };
    }
    case 'facilityState': {
      const expected = predicate.equals ?? true;
      const accepted = state[predicate.field] === expected;
      return { accepted, reason: accepted ? 'facility-state-satisfied' : `requires-state:${predicate.field}` };
    }
    case 'encounterCompletion': {
      const accepted = encounters.some((entry) => entry.id === predicate.encounterId && entry.cleared);
      return { accepted, reason: accepted ? 'encounter-cleared' : `requires-encounter:${predicate.encounterId}` };
    }
    case 'mechanism': {
      const accepted = (context.mechanisms ?? []).some((entry) => entry.id === predicate.mechanismId && entry.activated);
      return { accepted, reason: accepted ? 'mechanism-active' : `requires-mechanism:${predicate.mechanismId}` };
    }
    case 'all': {
      const results = (predicate.predicates ?? []).map((item) => evaluateMagmaGatePredicate(item, context));
      return { accepted: results.every((result) => result.accepted), reason: results.find((result) => !result.accepted)?.reason ?? 'all-satisfied' };
    }
    case 'any': {
      const results = (predicate.predicates ?? []).map((item) => evaluateMagmaGatePredicate(item, context));
      return { accepted: results.some((result) => result.accepted), reason: results.some((result) => result.accepted) ? 'one-satisfied' : results[0]?.reason ?? 'none-satisfied' };
    }
    default:
      return { accepted: false, reason: `unknown-predicate:${predicate.kind}` };
  }
}

function connection(id, fromRoomId, toRoomId, options = {}) {
  return {
    id,
    fromRoomId,
    toRoomId,
    doorId: options.doorId ?? null,
    connectorId: options.connectorId ?? 'basalt-bore-gallery',
    shortcut: Boolean(options.shortcut),
    postBossReturn: Boolean(options.postBossReturn),
    gatePredicate: options.gatePredicate ?? null,
    routes: [{
      id: `${id}:route`,
      connectorType: options.connectorId ?? 'basalt-bore-gallery',
      connectorVariantId: options.connectorId ?? 'basalt-bore-gallery',
      purpose: options.shortcut ? 'progression-shortcut' : options.postBossReturn ? 'post-boss-return' : 'main-route',
      routeClassification: options.shortcut ? 'shortcut' : 'main_route',
      requiredForProgression: !options.shortcut,
      sourceElevation: 0,
      destinationElevation: 0,
      elevationDelta: 0,
      direction: 'level',
    }],
  };
}

export function createMagmaProgressionData({ selection, roomByModuleId, doors, encounters, facilityState }) {
  const selected = validateMagmaModuleSelection(selection);
  if (!selected.accepted) throw new Error(`Invalid Magma module selection: ${selected.errors.join(', ')}`);
  const roomId = (moduleId) => roomByModuleId.get(moduleId)?.id ?? moduleId;
  const linear = [selection.entrance, ...selection.upper, selection.hub];
  const connections = [];
  for (let index = 0; index < linear.length - 1; index += 1) {
    connections.push(connection(
      `${linear[index]}_${linear[index + 1]}`,
      roomId(linear[index]),
      roomId(linear[index + 1]),
      { connectorId: index === 0 ? 'excavation-cage-descent' : index % 2 ? 'basalt-bore-gallery' : 'broken-ore-tram-span' },
    ));
  }
  const addWing = (wing, gateDoorId, connectorId) => {
    const modules = selection[wing];
    connections.push(connection(`${selection.hub}_${modules[0]}`, roomId(selection.hub), roomId(modules[0]), {
      doorId: gateDoorId,
      connectorId,
      gatePredicate: { kind: 'credential', credentialId: SMELTER_SEAL_ID },
    }));
    for (let index = 0; index < modules.length - 1; index += 1) {
      connections.push(connection(`${modules[index]}_${modules[index + 1]}`, roomId(modules[index]), roomId(modules[index + 1]), {
        connectorId: wing === 'slag' ? 'slag-trough-service-walk' : index === 0 ? 'furnace-draft-stair' : 'collapsed-conduit-gallery',
      }));
    }
  };
  addWing('slag', 'slagworksBulkhead', 'slag-trough-service-walk');
  addWing('furnace', 'furnaceworksBulkhead', 'furnace-draft-stair');
  connections.push(connection('slagworksShortcut', roomId(selection.slag.at(-1)), roomId(selection.hub), {
    doorId: 'slagworksShortcutGate', connectorId: 'chain-hoist-lift-shaft', shortcut: true,
    gatePredicate: { kind: 'facilityState', field: 'slagShortcutOnline' },
  }));
  connections.push(connection('furnaceworksShortcut', roomId(selection.furnace.at(-1)), roomId(selection.hub), {
    doorId: 'furnaceworksShortcutGate', connectorId: 'chain-hoist-lift-shaft', shortcut: true,
    gatePredicate: { kind: 'facilityState', field: 'furnaceShortcutOnline' },
  }));
  for (const [wing, terminus] of [['slag', selection.slag.at(-1)], ['furnace', selection.furnace.at(-1)]]) {
    connections.push(connection(`${wing}BossConvergence`, roomId(terminus), roomId(selection.boss), {
      doorId: `crucibleBossGate:${wing}`,
      connectorId: 'collapsed-conduit-gallery',
      gatePredicate: { kind: 'facilityState', field: 'crucibleBossGateOpen' },
    }));
  }
  connections.push(connection('postBossReturnLift', roomId(selection.boss), roomId(selection.hub), {
    doorId: 'postBossReturnGate', connectorId: 'chain-hoist-lift-shaft', postBossReturn: true,
    gatePredicate: { kind: 'facilityState', field: 'shrineBarrierReleased' },
  }));

  return {
    dungeonFamilyId: 'magma-refinery-v1',
    entranceRoomId: roomId(selection.entrance),
    ruinEntranceRoomId: roomId(selection.entrance),
    assayRoomId: roomId('refractor-assay-lab'),
    shrineConcourseRoomId: roomId(selection.hub),
    shrineRoomId: roomId(selection.hub),
    slagTerminusRoomId: roomId(selection.slag.at(-1)),
    furnaceDraftRoomId: roomId('furnace-draft-stack'),
    furnaceTerminusRoomId: roomId(selection.furnace.at(-1)),
    bossRoomId: roomId(selection.boss),
    barrierMechanismRoomId: roomId(selection.boss),
    facilityState,
    credentials: [{
      credentialId: SMELTER_SEAL_ID,
      keycardId: SMELTER_SEAL_ID,
      displayName: 'Smelter Seal',
      pairedDoorIds: ['slagworksBulkhead', 'furnaceworksBulkhead'],
      spawnRoomId: roomId('refractor-assay-lab'),
      spawnMode: 'Pedestal',
      isRequiredForMainProgression: true,
      isCollected: Boolean(facilityState.smelterSealOwned),
    }],
    keycards: [],
    shrineKey: null,
    doors: doors.map((door) => ({
      doorId: door.id,
      displayName: door.label,
      fromRoomId: door.fromRoomId,
      toRoomId: door.toRoomId,
      gatePredicate: door.gatePredicate,
      isUnlocked: !door.closed,
      isCriticalPathDoor: !door.shortcut,
      isShrineDoor: door.id === 'shrineBarrier',
    })),
    roomConnections: connections,
    boss: {
      encounterId: encounters.find((entry) => entry.isBoss)?.id ?? 'crucibleWardenEncounter',
      roomId: roomId(selection.boss),
      rewardKeycardId: null,
      mustDropShrineKey: false,
    },
    validation: {
      accepted: selected.accepted,
      errors: [...selected.errors],
      warnings: ['Magma facility-state progression graph validated.'],
    },
  };
}

export function getMagmaObjectiveText(state) {
  if (!state.smelterSealOwned) return 'Recover the Smelter Seal in the Assay Lab';
  if (!state.slagFlowDiverted && !state.furnacePressureStabilized) return 'Explore Slagworks or Furnaceworks';
  if (!state.slagFlowDiverted) return 'Divert the Slagworks flow';
  if (!state.furnacePressureStabilized) return 'Restore Draft and Quenchworks pressure';
  if (!state.crucibleWardenDefeated) return 'Defeat the Crucible Warden';
  if (!state.shrineBarrierReleased) return 'Use the post-boss barrier release mechanism';
  if (!state.largeRefractorSecured) return 'Return to the Ember Crown and secure the Large Refractor';
  return 'Extract to the highland';
}
