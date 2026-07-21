import assert from 'node:assert/strict';
import { REAVERBOT_SALVAGE_SOURCE_MAPS } from '../../../src/reaverbots/ReaverbotSalvageCatalog.js';
import { deriveDungeonTopologySignaturesV2 } from '../../../src/dungeon-v2/DungeonTopologySignatureV2.js';
import { solveDungeonPlanV2Symbolically } from '../../../src/dungeon-v2/DungeonPlanV2Solver.js';
import { GOLDEN_REGION_AUTHORED_DETAILS_V2 } from '../../../src/dungeon-v2/GoldenRegionAuthoredDetailsV2.js';
import {
  LEGACY_FIXED_ROOM_MODULE_CATALOG_V2,
} from '../../../src/dungeon-v2/LegacyFixedRoomModuleCatalogV2.js';
import {
  SEMANTIC_ROOM_PACK_V1_ID,
} from '../../../src/dungeon-v2/SemanticRoomPackV1Catalog.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../../src/TraversalCapabilities.js';

export const ACCEPTANCE_LIMITS = Object.freeze({
  visualColliderSampleSpacing: 0.21,
  cameraProofRange: 120,
  minimumLandingWidth: 1.2,
  minimumHeadroom: 3.2,
  surfaceHeightTolerance: 0.05,
  minimumPortalElevationDelta: 3,
  maximumConnectorShare: 0.4,
});

const SIDES = Object.freeze(['west', 'east', 'floor', 'ceiling', 'north', 'south']);
const SIDE_ALIASES = Object.freeze({
  west: 'west', '-x': 'west',
  east: 'east', '+x': 'east',
  floor: 'floor', bottom: 'floor', '-y': 'floor',
  ceiling: 'ceiling', top: 'ceiling', '+y': 'ceiling',
  north: 'north', '-z': 'north',
  south: 'south', '+z': 'south',
});
const SIDE_NORMALS = Object.freeze({
  west: Object.freeze({ x: -1, y: 0, z: 0 }),
  east: Object.freeze({ x: 1, y: 0, z: 0 }),
  floor: Object.freeze({ x: 0, y: -1, z: 0 }),
  ceiling: Object.freeze({ x: 0, y: 1, z: 0 }),
  north: Object.freeze({ x: 0, y: 0, z: -1 }),
  south: Object.freeze({ x: 0, y: 0, z: 1 }),
});

const GOLDEN_REGION_IDS = Object.freeze([
  'security', 'assembly', 'server', 'freight', 'sorting', 'credential', 'parts',
  'nest', 'corkscrew', 'machine-core', 'extraction', 'freight-sump', 'reservoir',
  'gantry-sump', 'salvage-tunnel', 'hazard-intake', 'hazard-core',
]);
const GOLDEN_ENCOUNTERS = Object.freeze({
  'encounter.assembly': Object.freeze({ regionId: 'assembly', required: true, optional: false, elite: false }),
  'encounter.sorting': Object.freeze({ regionId: 'sorting', required: true, optional: false, elite: false }),
  'encounter.nest': Object.freeze({ regionId: 'nest', required: false, optional: true, elite: false }),
  'encounter.machine-core': Object.freeze({ regionId: 'machine-core', required: true, optional: false, elite: true }),
});
const GOLDEN_REWARD_IDS = Object.freeze([
  'reward.key-seeker', 'reward.keycard-alpha', 'reward.keycard-beta',
  'reward.keycard-gamma', 'reward.cache.alpha', 'reward.cache.water',
  'reward.cache.nest', 'reward.cache.undercroft', 'reward.shrine-key',
  'reward.large-refractor',
]);
const GOLDEN_OBJECTIVE_IDS = Object.freeze([
  'objective.alpha-expedition', 'objective.waterworks-expedition',
  'objective.undercroft-expedition', 'objective.final-elite',
  'objective.large-refractor', 'objective.extraction',
  'objective.discovery.flooded', 'objective.discovery.drained',
]);
const ORDINARY_KEY_CONTRACTS = Object.freeze({
  Keycard_Alpha: Object.freeze({ rewardId: 'reward.keycard-alpha', gateId: 'Door_Alpha' }),
  Keycard_Beta: Object.freeze({ rewardId: 'reward.keycard-beta', gateId: 'Door_Beta' }),
  Keycard_Gamma: Object.freeze({ rewardId: 'reward.keycard-gamma', gateId: 'Door_Gamma' }),
});
const WATER_STATE_IDS = Object.freeze([
  'FreightSumpFilled', 'StoredInReservoir', 'GantrySumpFilled',
]);
const GOLDEN_PHYSICAL_PORTAL_COUNT = 21;
const GOLDEN_PACK_COMMON_ROOM_IDS = Object.freeze([
  'rdx_factory_corkscrew_exchange',
  'rdx_waterworks_freight_sump',
]);
const GOLDEN_PACK_UNDERCROFT_ROOM_IDS = Object.freeze({
  magma: 'rdx_magma_foundry_undercroft',
  electrical: 'rdx_electric_transformer_undercroft',
});
const SUPPORTED_ENCOUNTER_ROSTER = new Set([
  'basic', 'fast', 'tank', 'ranged', 'horokko', 'gorubesshu',
  'sharukurusu', 'legacy:sharukurusu',
]);
const ORDINARY_REAVERBOT_SALVAGE_IDS = new Set(
  Object.values(REAVERBOT_SALVAGE_SOURCE_MAPS)
    .flatMap((sourceMap) => Object.values(sourceMap))
    .map((materialRecord) => materialRecord.id),
);
const CONDITION_OPERATIONS = new Set([
  'all', 'any', 'stateEquals', 'hasKey', 'gateOpen', 'encounterComplete',
  'objectiveComplete', 'rewardCollected',
]);
const EFFECT_OPERATIONS = new Set([
  'setState', 'setWaterState', 'setMechanismState', 'grantKey', 'openGate',
  'completeEncounter', 'completeObjective', 'collectReward', 'collectRefractor',
  'discoverRegion', 'extract',
]);
// These are the activation sides implemented by DungeonRuntimeV2. Keeping the
// acceptance vocabulary identical prevents a plan from declaring a side that
// runtime silently interprets as "front".
const ACTIVATION_SIDES = new Set(['front', 'back', 'either', 'system']);

export class DungeonAcceptanceError extends Error {
  constructor(code, message, details = undefined) {
    super(`[${code}] ${message}`);
    this.name = 'DungeonAcceptanceError';
    this.code = code;
    this.details = details;
  }
}

function invariant(condition, code, message, details) {
  if (!condition) throw new DungeonAcceptanceError(code, message, details);
}

function uniqueById(items, label) {
  invariant(Array.isArray(items), 'plan-collection-missing', `${label} must be an array`);
  const map = new Map();
  for (const item of items) {
    invariant(item && typeof item === 'object' && typeof item.id === 'string' && item.id.length > 0,
      'plan-id-missing', `${label} entries require stable string ids`);
    invariant(!map.has(item.id), 'plan-id-duplicate', `${label} repeats id ${item.id}`);
    map.set(item.id, item);
  }
  return map;
}

function canonicalSide(side) {
  return SIDE_ALIASES[String(side).toLowerCase()] ?? null;
}

function vector3(value, label) {
  const result = Array.isArray(value)
    ? { x: value[0], y: value[1], z: value[2] }
    : value;
  invariant(result && [result.x, result.y, result.z].every(Number.isFinite),
    'invalid-vector', `${label} must be a finite xyz vector`);
  return result;
}

function bounds3(bounds, label) {
  invariant(bounds && typeof bounds === 'object', 'bounds-missing', `${label} requires bounds`);
  const min = vector3(bounds.min, `${label}.min`);
  const max = vector3(bounds.max, `${label}.max`);
  invariant(max.x >= min.x && max.y >= min.y && max.z >= min.z,
    'bounds-inverted', `${label} has inverted bounds`);
  return { min, max };
}

function boundsTouchOrOverlap(leftBounds, rightBounds, tolerance = ACCEPTANCE_LIMITS.visualColliderSampleSpacing) {
  const left = bounds3(leftBounds, 'left route cell');
  const right = bounds3(rightBounds, 'right route cell');
  return left.min.x <= right.max.x + tolerance && left.max.x >= right.min.x - tolerance
    && left.min.y <= right.max.y + tolerance && left.max.y >= right.min.y - tolerance
    && left.min.z <= right.max.z + tolerance && left.max.z >= right.min.z - tolerance;
}

function colliderEnabled(value) {
  if (value === true) return true;
  if (typeof value === 'string') return value.length > 0 && value !== 'none' && value !== 'disabled';
  return Boolean(value && typeof value === 'object' && value.enabled !== false);
}

function assertSerializableFrozen(root) {
  const seen = new Set();
  const visit = (value, path) => {
    const type = typeof value;
    invariant(type !== 'function' && type !== 'symbol' && type !== 'bigint' && type !== 'undefined',
      'plan-not-serializable', `${path} contains ${type}`);
    if (type === 'number') {
      invariant(Number.isFinite(value), 'plan-not-serializable', `${path} contains a non-finite number`);
      return;
    }
    if (value === null || type !== 'object') return;
    invariant(!seen.has(value), 'plan-not-serializable', `${path} contains a cycle`);
    seen.add(value);
    const prototype = Object.getPrototypeOf(value);
    invariant(prototype === Object.prototype || prototype === Array.prototype || prototype === null,
      'plan-runtime-object', `${path} contains ${value.constructor?.name ?? 'a runtime object'}`);
    invariant(!value.isObject3D && !value.isVector3 && !value.isMaterial && !value.isBufferGeometry,
      'plan-three-object', `${path} contains a THREE runtime object`);
    invariant(Object.isFrozen(value), 'plan-mutable', `${path} is not frozen`);
    for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
    seen.delete(value);
  };
  visit(root, 'plan');
  try {
    JSON.stringify(root);
  } catch (error) {
    throw new DungeonAcceptanceError('plan-not-serializable', error.message);
  }
}

function assertPlanCollections(plan) {
  invariant(plan && typeof plan === 'object', 'plan-missing', 'fixture requires a plan');
  for (const name of [
    'districts', 'regions', 'modulePlacements', 'encounters', 'rewards', 'objectives',
    'mechanisms', 'spatialCells', 'structuralBoundaries', 'portals', 'walkableSurfaces',
    'structuralFixtures', 'traversalLinks', 'falls', 'safeAnchors', 'actions',
  ]) {
    invariant(Array.isArray(plan[name]), 'plan-collection-missing', `plan.${name} must be an array`);
  }
  for (const name of ['progression', 'environmentStates', 'minimap']) {
    invariant(plan[name] && typeof plan[name] === 'object', 'plan-collection-missing', `plan.${name} must be an object`);
  }
}

function assertExactIds(items, expectedIds, code, label) {
  const actualIds = items.map((item) => item.id).sort();
  const expected = [...expectedIds].sort();
  invariant(actualIds.length === expected.length
    && actualIds.every((id, index) => id === expected[index]),
  code, `${label} must be exactly ${expected.join(', ')}`, { actualIds, expectedIds: expected });
}

function operationChildren(operation) {
  return operation.conditions ?? operation.operands ?? operation.items ?? [];
}

function assertConditionOperation(operation, label) {
  invariant(operation && typeof operation === 'object' && CONDITION_OPERATIONS.has(operation.op),
    'condition-operation-unsupported', `${label} uses unsupported condition ${operation?.op ?? '<missing>'}`);
  if (operation.op === 'all' || operation.op === 'any') {
    const children = operationChildren(operation);
    invariant(Array.isArray(children) && children.length > 0,
      'condition-operation-malformed', `${label}.${operation.op} requires serializable child conditions`);
    children.forEach((child, index) => assertConditionOperation(child, `${label}.${operation.op}[${index}]`));
  }
}

function flattenConditions(conditions) {
  const flattened = [];
  const visit = (condition) => {
    flattened.push(condition);
    if (condition?.op === 'all' || condition?.op === 'any') operationChildren(condition).forEach(visit);
  };
  conditions.forEach(visit);
  return flattened;
}

function assertEffectOperation(effect, label) {
  invariant(effect && typeof effect === 'object' && EFFECT_OPERATIONS.has(effect.op),
    'effect-operation-unsupported', `${label} uses unsupported effect ${effect?.op ?? '<missing>'}`);
}

function effectMatches(action, op, field, value) {
  return action?.effects?.some((effect) => effect.op === op && effect[field] === value);
}

function conditionMatches(conditions, op, field, value) {
  return flattenConditions(conditions ?? []).some((condition) => condition.op === op && condition[field] === value);
}

function finiteSeed(value) {
  return (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length > 0);
}

export function assertActionContracts(plan) {
  const regions = uniqueById(plan.regions, 'regions');
  const surfaces = uniqueById(plan.walkableSurfaces, 'walkableSurfaces');
  const boundaries = uniqueById(plan.structuralBoundaries, 'structuralBoundaries');
  const fixtures = uniqueById(plan.structuralFixtures, 'structuralFixtures');
  const mechanisms = uniqueById(plan.mechanisms, 'mechanisms');
  const encounters = uniqueById(plan.encounters, 'encounters');
  const rewards = uniqueById(plan.rewards, 'rewards');
  const objectives = uniqueById(plan.objectives, 'objectives');
  const gates = uniqueById(plan.progression?.gateContracts ?? plan.progression?.gates ?? [], 'progression gates');
  const anchors = uniqueById([...(plan.anchors ?? []), ...plan.safeAnchors], 'anchors');

  for (const anchor of anchors.values()) {
    invariant(regions.has(anchor.regionId), 'action-anchor-region-missing', `${anchor.id} references missing region ${anchor.regionId}`);
    const position = vector3(anchor.position, `${anchor.id}.position`);
    if (anchor.forward) vector3(anchor.forward, `${anchor.id}.forward`);
    const supportingSurfaceId = anchor.surfaceId ?? anchor.safeSurfaceId;
    invariant(supportingSurfaceId && surfaces.has(supportingSurfaceId),
      'action-anchor-surface-missing', `${anchor.id} has no authored physical supporting surface`);
    const supportingSurface = surfaces.get(supportingSurfaceId);
    invariant(supportingSurface.regionId === anchor.regionId,
      'action-anchor-surface-region-mismatch', `${anchor.id} belongs to ${anchor.regionId} but its surface ${supportingSurfaceId} belongs to ${supportingSurface.regionId}`);
    invariant(colliderEnabled(supportingSurface.collision),
      'action-anchor-surface-nonwalkable', `${anchor.id} references non-colliding surface ${supportingSurfaceId}`);
    invariant(!anchor.hazardTag && !supportingSurface.hazardTag,
      'action-anchor-surface-harmful', `${anchor.id} is placed on harmful surface ${supportingSurfaceId}`);
    const supportBounds = bounds3(supportingSurface.bounds, `${supportingSurfaceId} bounds`);
    invariant(position.x >= supportBounds.min.x - ACCEPTANCE_LIMITS.surfaceHeightTolerance
      && position.x <= supportBounds.max.x + ACCEPTANCE_LIMITS.surfaceHeightTolerance
      && position.z >= supportBounds.min.z - ACCEPTANCE_LIMITS.surfaceHeightTolerance
      && position.z <= supportBounds.max.z + ACCEPTANCE_LIMITS.surfaceHeightTolerance,
    'action-anchor-surface-outside', `${anchor.id} lies outside the horizontal footprint of ${supportingSurfaceId}`);
    invariant(Math.abs(position.y - supportBounds.max.y) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
      'action-anchor-surface-misaligned', `${anchor.id} must lie on the physical top of ${supportingSurfaceId} within 0.05m`);
  }

  for (const action of uniqueById(plan.actions, 'actions').values()) {
    const anchor = anchors.get(action.anchorId);
    invariant(anchor, 'action-anchor-missing', `${action.id} references missing physical anchor ${action.anchorId}`);
    const interaction = action.interaction;
    invariant(interaction && Number.isFinite(interaction.radius) && interaction.radius >= 0,
      'action-interaction-missing', `${action.id} requires a finite prompt radius`);
    invariant(ACTIVATION_SIDES.has(interaction.activationSide),
      'action-activation-side-missing', `${action.id} requires an explicit supported activation side`);
    if (interaction.activationSide !== 'system') {
      invariant(interaction.radius > 0, 'action-prompt-radius-invalid', `${action.id} is player-operated but has no prompt radius`);
      invariant(typeof interaction.requiresLineOfSight === 'boolean',
        'action-line-of-sight-missing', `${action.id} must explicitly declare line-of-sight behavior`);
      const forward = vector3(anchor.forward, `${anchor.id}.forward`);
      const forwardLength = Math.hypot(forward.x, forward.z);
      invariant(forwardLength > 0.001,
        'action-activation-facing-missing', `${action.id} requires a non-zero horizontal anchor facing`);
      const directionSign = interaction.activationSide === 'back' ? -1 : 1;
      const direction = {
        x: forward.x / forwardLength * directionSign,
        z: forward.z / forwardLength * directionSign,
      };
      const approachDistance = Math.min(1.15, interaction.radius * 0.55);
      const approach = {
        x: anchor.position.x + direction.x * approachDistance,
        y: anchor.position.y,
        z: anchor.position.z + direction.z * approachDistance,
      };
      const supportingSurface = surfaces.get(anchor.surfaceId ?? anchor.safeSurfaceId);
      const supportBounds = bounds3(supportingSurface.bounds, `${supportingSurface.id} action approach bounds`);
      invariant(approach.x >= supportBounds.min.x - ACCEPTANCE_LIMITS.surfaceHeightTolerance
        && approach.x <= supportBounds.max.x + ACCEPTANCE_LIMITS.surfaceHeightTolerance
        && approach.z >= supportBounds.min.z - ACCEPTANCE_LIMITS.surfaceHeightTolerance
        && approach.z <= supportBounds.max.z + ACCEPTANCE_LIMITS.surfaceHeightTolerance,
      'action-approach-surface-missing', `${action.id} has no supported standing point on its declared activation side`);
    }
    invariant(Array.isArray(action.conditions), 'action-conditions-missing', `${action.id} requires serializable conditions`);
    action.conditions.forEach((condition, index) => assertConditionOperation(condition, `${action.id}.conditions[${index}]`));
    invariant(Array.isArray(action.effects) && action.effects.length > 0,
      'action-effects-missing', `${action.id} requires at least one serializable effect`);
    action.effects.forEach((effect, index) => assertEffectOperation(effect, `${action.id}.effects[${index}]`));
    invariant(Array.isArray(action.barrierIds) && action.barrierIds.every((id) => typeof id === 'string' && id.length > 0),
      'action-barriers-missing', `${action.id} requires an explicit barrier/collider reference array`);
    for (const barrierId of action.barrierIds) {
      const gate = gates.get(barrierId) ?? [...gates.values()].find((entry) => entry.barrierId === barrierId);
      invariant(gate || boundaries.has(barrierId), 'action-barrier-reference-missing', `${action.id} references unknown barrier ${barrierId}`);
    }
    if (action.controllerId) {
      invariant(mechanisms.has(action.controllerId), 'action-controller-missing', `${action.id} references missing controller ${action.controllerId}`);
    }
    for (const condition of flattenConditions(action.conditions)) {
      if (condition.op === 'encounterComplete') invariant(encounters.has(condition.encounterId), 'action-condition-reference-missing', `${action.id} references missing encounter ${condition.encounterId}`);
      if (condition.op === 'objectiveComplete') invariant(objectives.has(condition.objectiveId), 'action-condition-reference-missing', `${action.id} references missing objective ${condition.objectiveId}`);
      if (condition.op === 'rewardCollected') invariant(rewards.has(condition.rewardId), 'action-condition-reference-missing', `${action.id} references missing reward ${condition.rewardId}`);
    }
    for (const effect of action.effects) {
      if (effect.op === 'setMechanismState') invariant(mechanisms.has(effect.mechanismId), 'action-effect-reference-missing', `${action.id} references missing mechanism ${effect.mechanismId}`);
      if (effect.op === 'completeEncounter') invariant(encounters.has(effect.encounterId), 'action-effect-reference-missing', `${action.id} references missing encounter ${effect.encounterId}`);
      if (effect.op === 'completeObjective') invariant(objectives.has(effect.objectiveId), 'action-effect-reference-missing', `${action.id} references missing objective ${effect.objectiveId}`);
      if (effect.op === 'collectReward') invariant(rewards.has(effect.rewardId), 'action-effect-reference-missing', `${action.id} references missing reward ${effect.rewardId}`);
      if (effect.op === 'discoverRegion') invariant(regions.has(effect.regionId), 'action-effect-reference-missing', `${action.id} references missing region ${effect.regionId}`);
    }
  }

  const actionMap = uniqueById(plan.actions, 'actions');
  for (const encounter of encounters.values()) {
    invariant(anchors.has(encounter.anchorId), 'encounter-anchor-missing', `${encounter.id} has no physical authored anchor`);
    const completion = actionMap.get(encounter.completionActionId);
    invariant(completion && effectMatches(completion, 'completeEncounter', 'encounterId', encounter.id),
      'encounter-completion-action-missing', `${encounter.id} has no shared completion action`);
  }
  for (const reward of rewards.values()) {
    invariant(anchors.has(reward.anchorId), 'reward-placement-missing', `${reward.id} has no physical authored anchor`);
    const collection = actionMap.get(reward.actionId);
    invariant(collection && collection.anchorId === reward.anchorId
      && effectMatches(collection, 'collectReward', 'rewardId', reward.id),
    'reward-action-missing', `${reward.id} has no shared collection action`);
  }
  for (const objective of objectives.values()) {
    const completion = actionMap.get(objective.actionId);
    invariant(completion && effectMatches(completion, 'completeObjective', 'objectiveId', objective.id),
      'objective-action-missing', `${objective.id} has no shared completion action`);
  }
  for (const gate of gates.values()) {
    const gateAction = actionMap.get(gate.actionId);
    invariant(anchors.has(gate.anchorId) && gateAction
      && gateAction.anchorId === gate.anchorId
      && effectMatches(gateAction, 'openGate', 'gateId', gate.id),
    'progression-gate-action-missing', `${gate.id} has no shared anchored gate action`);
    invariant(gateAction.barrierIds.includes(gate.barrierId ?? gate.id),
      'progression-gate-barrier-missing', `${gate.id} action does not reference its physical barrier`);
  }

  const selectableActions = [...actionMap.values()].filter((action) => action.interaction?.activationSide !== 'system');
  const actionByAnchor = new Map();
  for (const action of selectableActions) {
    if (!actionByAnchor.has(action.anchorId)) actionByAnchor.set(action.anchorId, []);
    actionByAnchor.get(action.anchorId).push(action.id);
  }
  for (const [anchorId, actionIds] of actionByAnchor) {
    invariant(actionIds.length === 1, 'duplicate-selectable-action-anchor', `${anchorId} stacks multiple selectable actions/consoles`, actionIds);
  }
  const consoleActions = selectableActions.filter((action) => (
    ['gate-control', 'water-router', 'mechanism-control'].includes(action.type)
  ));
  for (let index = 0; index < consoleActions.length; index += 1) {
    const action = consoleActions[index];
    const anchor = anchors.get(action.anchorId);
    const supportingSurface = surfaces.get(anchor.surfaceId ?? anchor.safeSurfaceId);
    invariant(supportingSurface?.collision !== 'dynamic'
      && (supportingSurface.interactionSurfaceRole === 'side-control-pad'
        || Boolean(supportingSurface.terminalForMechanismId)),
    'console-side-pad-missing', `${action.id} must be on a static side-console pad, not a traversal walkway`);
    const isCredentialGate = action.type === 'gate-control'
      && (action.conditions ?? []).some(({ op }) => op === 'hasKey');
    invariant(isCredentialGate
      ? action.interaction.activationSide === 'either'
        && action.interaction.requiresLineOfSight === false
      : ['front', 'back'].includes(action.interaction.activationSide)
        && action.interaction.requiresLineOfSight === true,
    'console-activation-contract-invalid', isCredentialGate
      ? `${action.id} credential reader must accept either physically reachable side`
      : `${action.id} requires a physical front/back side and line of sight`);
    for (let otherIndex = index + 1; otherIndex < consoleActions.length; otherIndex += 1) {
      const other = consoleActions[otherIndex];
      const otherAnchor = anchors.get(other.anchorId);
      invariant(Math.hypot(anchor.position.x - otherAnchor.position.x, anchor.position.z - otherAnchor.position.z) >= 0.75
        || Math.abs(anchor.position.y - otherAnchor.position.y) >= 1.2,
      'stacked-action-consoles', `${action.id} and ${other.id} occupy the same console volume`);
    }
    const consoleClearanceVolumes = [
      {
        id: supportingSurface.id,
        bounds: supportingSurface.bounds,
        role: 'side-console pad',
      },
      ...[...new Set(action.colliderIds ?? [])].flatMap((fixtureId) => {
        const fixture = fixtures.get(fixtureId);
        if (!fixture) return [];
        const exactColliderBounds = Array.isArray(fixture.colliderBounds)
          && fixture.colliderBounds.length > 0
          ? fixture.colliderBounds
          : [fixture.bounds];
        return exactColliderBounds.map((candidateBounds, colliderIndex) => ({
          id: `${fixtureId}:${colliderIndex}`,
          bounds: candidateBounds,
          role: 'console collider',
        }));
      }),
    ];
    for (const mechanism of mechanisms.values()) {
      const dynamicSurface = surfaces.get(mechanism.runtimeProfile?.dynamicSurfaceId);
      if (!dynamicSurface) continue;
      // Horizontal coordinates are local to the accepted world, but enclosed
      // chambers in different regions may intentionally occupy the same X/Z
      // column at different elevations. Only compare a console against a
      // mechanism whose physical route occupies that console's region. Once
      // related, every stable footprint remains strict (including remote
      // recall consoles at the opposite landing of a cross-region lift).
      const mechanismRegionIds = new Set([
        mechanism.regionId,
        dynamicSurface.regionId,
        ...(mechanism.states ?? []).map((state) => (
          surfaces.get(state.landingSurfaceId)?.regionId
        )),
      ].filter(Boolean));
      if (!mechanismRegionIds.has(anchor.regionId)) continue;
      for (const state of mechanism.states ?? []) {
        if (!state.position) continue;
        const footprint = platformFootprintAtState(dynamicSurface.bounds, state);
        invariant(horizontalDistanceToFootprint(anchor.position, footprint) >= 0.45,
          'console-overlaps-dynamic-platform', `${action.id} overlaps ${mechanism.id}:${state.id} moving-platform footprint`);
        for (const volume of consoleClearanceVolumes) {
          invariant(horizontalBoundsDistanceToFootprint(volume.bounds, footprint)
            >= ACCEPTANCE_LIMITS.visualColliderSampleSpacing,
          'console-overlaps-dynamic-platform', `${action.id} ${volume.role} ${volume.id} does not clear ${mechanism.id}:${state.id} moving-platform footprint by 0.21m`);
        }
      }
    }
  }

  const assertFixtureReferences = (owner, rolePattern, anchor, action) => {
    invariant(Array.isArray(owner.visualFixtureIds) && owner.visualFixtureIds.length > 0
      && Array.isArray(owner.colliderIds) && owner.colliderIds.length > 0,
    'physical-prop-fixture-refs-missing', `${owner.id} lacks explicit plan-owned visualFixtureIds/colliderIds`);
    const referenced = [...new Set([...owner.visualFixtureIds, ...owner.colliderIds])];
    const supportingSurface = anchor
      ? surfaces.get(anchor.surfaceId ?? anchor.safeSurfaceId)
      : null;
    for (const fixtureId of referenced) {
      const fixture = fixtures.get(fixtureId);
      invariant(fixture, 'physical-prop-fixture-missing', `${owner.id} references missing prop fixture ${fixtureId}`);
      invariant(colliderEnabled(fixture.collision), 'physical-prop-collider-missing', `${owner.id}:${fixtureId} is not colliding`);
      const role = `${fixture.type ?? ''} ${fixture.gameplayPurpose ?? fixture.purpose ?? ''}`;
      invariant(rolePattern.test(role), 'physical-prop-role-mismatch', `${owner.id}:${fixtureId} is not an appropriate physical prop`);
      if (!anchor || !supportingSurface || !action) continue;
      invariant(fixture.regionId === anchor.regionId,
        'action-fixture-region-mismatch', `${owner.id}:${fixtureId} is outside anchor region ${anchor.regionId}`);
      const fixtureBounds = bounds3(fixture.bounds, `${fixtureId} bounds`);
      const surfaceBounds = bounds3(supportingSurface.bounds, `${supportingSurface.id} bounds`);
      invariant(fixtureBounds.min.y <= surfaceBounds.max.y + ACCEPTANCE_LIMITS.surfaceHeightTolerance
        && fixtureBounds.max.y >= surfaceBounds.max.y - ACCEPTANCE_LIMITS.surfaceHeightTolerance,
      'action-fixture-support-misaligned', `${owner.id}:${fixtureId} does not physically meet ${supportingSurface.id}`);
      invariant(anchor.position.x >= fixtureBounds.min.x - 0.16
        && anchor.position.x <= fixtureBounds.max.x + 0.16
        && anchor.position.z >= fixtureBounds.min.z - 0.16
        && anchor.position.z <= fixtureBounds.max.z + 0.16,
      'action-fixture-anchor-misaligned', `${owner.id}:${fixtureId} is not registered at its action anchor`);

      if (consoleActions.includes(action)
        && !['either', 'any'].includes(action.interaction.activationSide)) {
        const forward = vector3(anchor.forward, `${anchor.id}.forward`);
        const length = Math.hypot(forward.x, forward.z);
        const sign = action.interaction.activationSide === 'back' ? -1 : 1;
        const direction = { x: forward.x / length * sign, z: forward.z / length * sign };
        const center = {
          x: (fixtureBounds.min.x + fixtureBounds.max.x) * 0.5,
          z: (fixtureBounds.min.z + fixtureBounds.max.z) * 0.5,
        };
        const half = {
          x: (fixtureBounds.max.x - fixtureBounds.min.x) * 0.5,
          z: (fixtureBounds.max.z - fixtureBounds.min.z) * 0.5,
        };
        const anchorProjection = (anchor.position.x - center.x) * direction.x
          + (anchor.position.z - center.z) * direction.z;
        const fixtureExtent = Math.abs(direction.x) * half.x + Math.abs(direction.z) * half.z;
        invariant(anchorProjection >= fixtureExtent + 0.075,
          'action-activation-side-inconsistent', `${action.id} selectable face is not outside its collider on the declared activation side`);
      }

      if (fixture.type !== 'extraction-pad') {
        const insideX = anchor.position.x >= fixtureBounds.min.x && anchor.position.x <= fixtureBounds.max.x;
        const insideZ = anchor.position.z >= fixtureBounds.min.z && anchor.position.z <= fixtureBounds.max.z;
        const distanceToOutside = insideX && insideZ
          ? Math.min(
            anchor.position.x - fixtureBounds.min.x,
            fixtureBounds.max.x - anchor.position.x,
            anchor.position.z - fixtureBounds.min.z,
            fixtureBounds.max.z - anchor.position.z,
          )
          : 0;
        invariant(action.interaction.radius + ACCEPTANCE_LIMITS.surfaceHeightTolerance
          >= distanceToOutside + 0.45,
        'action-prompt-radius-unreachable', `${action.id} prompt radius cannot be reached outside its own collider`);
      }
    }
  };
  for (const action of selectableActions) {
    const anchor = anchors.get(action.anchorId);
    const rolePattern = consoleActions.includes(action)
      ? /console|terminal|control/i
      : action.type === 'extraction' ? /extraction|pad/i : /pedestal|pickup|cache|chest|shrine|refractor|station|prop/i;
    if (!consoleActions.includes(action)) {
      invariant(action.interaction.activationSide === 'either'
        && action.interaction.requiresLineOfSight === false,
      'prop-activation-contract-invalid', `${action.id} must be reachable around its own colliding prop without self-occluding line of sight`);
    }
    assertFixtureReferences(action, rolePattern, anchor, action);
  }
  for (const reward of rewards.values()) {
    const action = actionMap.get(reward.actionId);
    const anchor = anchors.get(reward.anchorId);
    const rolePattern = reward.type === 'keycard' ? /pedestal|keycard/i
      : /cache|chest/.test(reward.type) ? /cache|chest/i
        : reward.type === 'large-refractor' ? /shrine|refractor/i : /key-seeker|station|pedestal/i;
    invariant(reward.regionId === anchor?.regionId,
      'reward-anchor-region-mismatch', `${reward.id} region does not match ${reward.anchorId}`);
    invariant(JSON.stringify(reward.visualFixtureIds) === JSON.stringify(action?.visualFixtureIds)
      && JSON.stringify(reward.colliderIds) === JSON.stringify(action?.colliderIds),
    'reward-fixture-parity-mismatch', `${reward.id} runtime fixtures differ from ${action?.id ?? '<missing action>'}`);
    assertFixtureReferences(reward, rolePattern, anchor, action);
  }
  for (const objective of objectives.values()) {
    const action = actionMap.get(objective.actionId);
    if (action?.interaction?.activationSide === 'system') continue;
    assertFixtureReferences(
      objective,
      objective.type === 'extraction' ? /extraction|pad/i : /pedestal|pickup|cache|chest|shrine|refractor|discovery|prop/i,
      anchors.get(action.anchorId),
      action,
    );
  }
}

export function assertGoldenContentContracts(plan) {
  assertExactIds(plan.regions, GOLDEN_REGION_IDS, 'golden-semantic-regions', 'golden semantic regions');
  assertExactIds(plan.encounters, Object.keys(GOLDEN_ENCOUNTERS), 'golden-encounter-set', 'golden encounters');
  assertExactIds(plan.rewards, GOLDEN_REWARD_IDS, 'golden-reward-set', 'golden rewards');
  assertExactIds(plan.objectives, GOLDEN_OBJECTIVE_IDS, 'golden-objective-set', 'golden objectives');

  const regions = uniqueById(plan.regions, 'regions');
  const anchors = uniqueById([...(plan.anchors ?? []), ...plan.safeAnchors], 'anchors');
  const actions = uniqueById(plan.actions, 'actions');
  const encounters = uniqueById(plan.encounters, 'encounters');
  const rewards = uniqueById(plan.rewards, 'rewards');
  const objectives = uniqueById(plan.objectives, 'objectives');
  const portals = uniqueById(plan.portals, 'portals');
  const gateContracts = uniqueById(plan.progression?.gateContracts ?? [], 'gateContracts');

  for (const region of regions.values()) {
    const profile = GOLDEN_REGION_AUTHORED_DETAILS_V2[region.id];
    invariant(profile, 'golden-region-detail-profile-missing', `${region.id} has no authored functional detail profile`);
    const authoredFixtures = plan.structuralFixtures.filter((fixture) => (
      fixture.regionId === region.id && fixture.authoredDetailId
    ));
    invariant(authoredFixtures.length === profile.fixtures.length,
      'golden-region-detail-missing', `${region.id} does not assemble every authored functional fixture`);
    const byDetailId = new Map(authoredFixtures.map((fixture) => [fixture.authoredDetailId, fixture]));
    invariant(byDetailId.size === authoredFixtures.length,
      'golden-region-detail-duplicate', `${region.id} repeats an authored functional fixture ID`);
    for (const expected of profile.fixtures) {
      const fixture = byDetailId.get(expected.id);
      invariant(fixture?.type === expected.type && fixture.gameplayPurpose === expected.purpose,
        'golden-region-detail-contract', `${region.id}:${expected.id} drifted from its authored functional role`);
      invariant(fixture.authoredSourceMaterial === profile.sourceMaterial,
        'golden-region-detail-source-missing', `${region.id}:${expected.id} no longer records its V1/new source material`);
      invariant(fixture.collision === 'blocking' && Array.isArray(fixture.colliderIds) && fixture.colliderIds.length > 0,
        'golden-region-detail-collision-missing', `${region.id}:${expected.id} is reachable scenery without blocking collision`);
      const fixtureBounds = bounds3(fixture.bounds, `${region.id}:${expected.id}`);
      const regionBounds = bounds3(region.bounds, region.id);
      invariant(['x', 'y', 'z'].every((axis) => (
        fixtureBounds.min[axis] >= regionBounds.min[axis] - ACCEPTANCE_LIMITS.surfaceHeightTolerance
        && fixtureBounds.max[axis] <= regionBounds.max[axis] + ACCEPTANCE_LIMITS.surfaceHeightTolerance
      )), 'golden-region-detail-outside-shell', `${region.id}:${expected.id} protrudes outside its closed chamber`);
    }
  }

  for (const [encounterId, expected] of Object.entries(GOLDEN_ENCOUNTERS)) {
    const encounter = encounters.get(encounterId);
    invariant(encounter.regionId === expected.regionId
      && encounter.required === expected.required
      && encounter.optional === expected.optional
      && Boolean(encounter.elite) === expected.elite,
    'golden-encounter-contract', `${encounterId} has the wrong authored role`);
    invariant(encounter.blocksPermanentRoute === false,
      'encounter-blocks-permanent-route', `${encounterId} may not lock permanent controls or exits`);
    invariant(finiteSeed(encounter.seed), 'encounter-seed-missing', `${encounterId} has no deterministic seed`);
    invariant(Array.isArray(encounter.roster) && encounter.roster.length > 0
      && encounter.roster.every((type) => SUPPORTED_ENCOUNTER_ROSTER.has(type)),
    'encounter-roster-unsupported', `${encounterId} has an empty or unsupported roster`, encounter.roster);
    invariant(Array.isArray(encounter.spawnPoints) && encounter.spawnPoints.length > 0,
      'encounter-spawn-points-missing', `${encounterId} has no authored spawn points`);
    encounter.spawnPoints.forEach((point, index) => vector3(point, `${encounterId}.spawnPoints[${index}]`));
    invariant(typeof encounter.spawnPatternId === 'string' && encounter.spawnPatternId.length > 0
      && encounter.spawnPattern?.id === encounter.spawnPatternId
      && Array.isArray(encounter.spawnPattern.roster)
      && Array.isArray(encounter.spawnPattern.points)
      && encounter.spawnPattern.points.length > 0,
    'encounter-spawn-pattern-missing', `${encounterId} has no complete deterministic spawn pattern`);
    invariant(anchors.has(encounter.anchorId), 'encounter-anchor-missing', `${encounterId} has no physical activation anchor`);
    const completion = actions.get(encounter.completionActionId);
    invariant(completion && effectMatches(completion, 'completeEncounter', 'encounterId', encounterId),
      'encounter-completion-action-missing', `${encounterId} has no shared completion action`);
  }
  const finalElite = encounters.get('encounter.machine-core');
  invariant(finalElite.kind === 'final-elite' && finalElite.isBoss === true && finalElite.eliteSlot?.required === true,
    'final-elite-contract-missing', 'Machine Core must contain the final elite encounter');

  for (const reward of rewards.values()) {
    invariant(regions.has(reward.regionId) && anchors.has(reward.anchorId),
      'reward-placement-missing', `${reward.id} has no authored region/anchor placement`);
    invariant(reward.safePlacement === true && !reward.hazardTag,
      'reward-placement-harmful', `${reward.id} is placed on a harmful surface`);
    invariant(Array.isArray(reward.conditions), 'reward-conditions-missing', `${reward.id} requires serializable conditions`);
    reward.conditions.forEach((condition, index) => assertConditionOperation(condition, `${reward.id}.conditions[${index}]`));
    const action = actions.get(reward.actionId);
    invariant(action && action.anchorId === reward.anchorId && effectMatches(action, 'collectReward', 'rewardId', reward.id),
      'reward-action-missing', `${reward.id} has no shared anchored collection action`);
    if (['reaverbot-parts-cache', 'major-reaverbot-parts-cache'].includes(reward.type)) {
      const bundle = reward.salvageBundle;
      invariant(bundle && typeof bundle === 'object',
        'cache-salvage-bundle-missing', `${reward.id} has no deterministic Reaverbot salvage bundle`);
      invariant(Number.isInteger(bundle.unidentifiedScrap) && bundle.unidentifiedScrap > 0,
        'cache-salvage-scrap-invalid', `${reward.id} requires a positive integer unidentifiedScrap count`);
      invariant(Array.isArray(bundle.recoverableParts) && bundle.recoverableParts.length > 0,
        'cache-salvage-parts-empty', `${reward.id} has no recoverable Reaverbot parts`);
      const seenMaterialIds = new Set();
      for (const part of bundle.recoverableParts) {
        invariant(part && ORDINARY_REAVERBOT_SALVAGE_IDS.has(part.materialId),
          'cache-salvage-material-unknown', `${reward.id} references non-ordinary or unknown salvage ${part?.materialId ?? '<missing>'}`);
        invariant(!seenMaterialIds.has(part.materialId),
          'cache-salvage-material-duplicate', `${reward.id} repeats salvage material ${part.materialId}`);
        seenMaterialIds.add(part.materialId);
        invariant(Number.isInteger(part.quantity) && part.quantity > 0,
          'cache-salvage-quantity-invalid', `${reward.id}:${part.materialId} requires a positive integer quantity`);
      }
      if (reward.type === 'major-reaverbot-parts-cache') {
        invariant(bundle.unidentifiedScrap >= 6 && bundle.recoverableParts.length >= 3,
          'major-cache-salvage-too-small', `${reward.id} must exceed ordinary cache salvage`);
      }
    }
  }

  for (const objective of objectives.values()) {
    invariant(Array.isArray(objective.regionIds) && objective.regionIds.length > 0
      && objective.regionIds.every((id) => regions.has(id)),
    'objective-region-missing', `${objective.id} has invalid authored regions`);
    invariant(Array.isArray(objective.completionConditions),
      'objective-conditions-missing', `${objective.id} requires serializable completion conditions`);
    objective.completionConditions.forEach((condition, index) => assertConditionOperation(condition, `${objective.id}.completionConditions[${index}]`));
    const action = actions.get(objective.actionId);
    invariant(action && effectMatches(action, 'completeObjective', 'objectiveId', objective.id),
      'objective-action-missing', `${objective.id} has no shared completion action`);
  }

  const keyContracts = plan.progression?.keyContracts ?? [];
  invariant(keyContracts.length === 4, 'progression-key-contracts', 'Alpha, Beta, Gamma, and Shrine Key contracts are required');
  for (const [keyId, expected] of Object.entries(ORDINARY_KEY_CONTRACTS)) {
    const contract = keyContracts.find((entry) => entry.keyId === keyId);
    const reward = rewards.get(expected.rewardId);
    const gate = gateContracts.get(expected.gateId);
    const portal = portals.get(gate?.portalId);
    invariant(contract?.required === true && contract.rewardId === expected.rewardId && contract.gateId === expected.gateId,
      'progression-key-contracts', `${keyId} progression contract is incomplete`);
    invariant(gate && portal, 'progression-gate-contract', `${keyId} has no paired authored gate portal`);
    invariant(reward.regionId !== portal.from.regionId && reward.regionId !== portal.to.regionId,
      'keycard-at-own-gate', `${keyId} is placed in the same region where it is used`);
    const pickup = actions.get(reward.actionId);
    invariant(effectMatches(pickup, 'grantKey', 'keyId', keyId),
      'keycard-pickup-action-missing', `${keyId} reward does not grant its key through the shared action`);
    invariant(reward.conditions.length === 0 && (pickup.conditions ?? []).length === 0,
      'ordinary-keycard-hidden-prerequisite', `${keyId} must be collectable whenever its physical pedestal is reached`);
  }
  invariant([...gateContracts.values()].some((gate) => gate.classification === 'non-bypassable-progression'),
    'non-bypassable-gate-missing', 'at least one credential gate must be explicitly non-bypassable');

  const shrineContract = keyContracts.find((entry) => entry.keyId === 'Shrine_Key');
  const shrineReward = rewards.get('reward.shrine-key');
  const shrineAction = actions.get(shrineReward?.actionId);
  invariant(shrineContract?.sourceEncounterId === 'encounter.machine-core'
    && shrineContract.rewardId === 'reward.shrine-key'
    && shrineReward?.exclusiveSource === true
    && shrineReward.regionId === 'machine-core'
    && conditionMatches(shrineReward.conditions, 'encounterComplete', 'encounterId', 'encounter.machine-core')
    && conditionMatches(shrineAction?.conditions, 'encounterComplete', 'encounterId', 'encounter.machine-core'),
  'shrine-key-premature', 'Shrine Key must be the exclusive final-elite reward');
  const shrineGrantActions = plan.actions.filter((action) => effectMatches(action, 'grantKey', 'keyId', 'Shrine_Key'));
  invariant(shrineGrantActions.length === 1 && shrineGrantActions[0].id === shrineReward.actionId,
    'shrine-key-not-exclusive', 'only the final-elite reward action may grant Shrine Key');

  const graphNodeIds = (plan.progression?.graphNodes ?? []).map((node) => node.id);
  invariant(graphNodeIds.length === GOLDEN_REGION_IDS.length
    && new Set(graphNodeIds).size === GOLDEN_REGION_IDS.length
    && GOLDEN_REGION_IDS.every((id) => graphNodeIds.includes(id)),
  'progression-graph-incomplete', 'progression graph must own all 17 semantic regions');
  invariant(plan.progression?.extractionActionId === 'action.extract'
    && effectMatches(actions.get('action.extract'), 'extract', 'extractionId', 'extraction.main'),
  'extraction-action-missing', 'golden progression requires the shared extraction action');

  for (const action of plan.actions.filter((entry) => ['gate-control', 'water-router', 'mechanism-control'].includes(entry.type))) {
    invariant(!flattenConditions(action.conditions).some((condition) => condition.op === 'encounterComplete'),
      'unrelated-encounter-dependency', `${action.id} improperly depends on clearing an encounter`);
  }
}

/**
 * Production Golden acceptance is intentionally stricter than catalog/module
 * unit coverage.  It accepts only the authored coexistence inventory requested
 * for Milestone 1: every V1 fixed room exactly once, the two common room-pack
 * macros, and exactly one hazard-specific Undercroft macro.  Connector metadata
 * is not sufficient; all twenty-one stable portals must own a complete physical
 * route whose cells, boundaries, and surfaces resolve in the accepted plan.
 */
export function assertGoldenProductionComposition(plan) {
  const nativeDescriptorIds = LEGACY_FIXED_ROOM_MODULE_CATALOG_V2
    .map(({ id }) => id)
    .sort();
  const nativeDescriptorIdSet = new Set(nativeDescriptorIds);
  const nativePlacements = plan.modulePlacements.filter(({ descriptorId }) => (
    nativeDescriptorIdSet.has(descriptorId)
  ));
  const packPlacements = plan.semanticRoomPackPlacements ?? [];
  const selectedUndercroftRoomId = GOLDEN_PACK_UNDERCROFT_ROOM_IDS[plan.undercroftType];
  const expectedPackRoomIds = [
    ...GOLDEN_PACK_COMMON_ROOM_IDS,
    selectedUndercroftRoomId,
  ].sort();

  invariant(Boolean(selectedUndercroftRoomId), 'golden-undercroft-type-invalid',
    `golden production requires magma or electrical, received ${plan.undercroftType ?? '<missing>'}`);
  invariant(plan.modulePlacements.length === 14,
    'golden-authored-inventory-count', 'golden production must contain exactly eleven V1 rooms and three room-pack macros');
  invariant(nativePlacements.length === 11
    && new Set(nativePlacements.map(({ id }) => id)).size === 11,
  'golden-native-inventory-count', 'golden production must place eleven distinct native V1 rooms');
  const actualNativeDescriptorIds = nativePlacements.map(({ descriptorId }) => descriptorId).sort();
  invariant(JSON.stringify(actualNativeDescriptorIds) === JSON.stringify(nativeDescriptorIds),
    'golden-native-inventory-mismatch', 'golden production must place every V1 fixed-room descriptor exactly once', {
      actualDescriptorIds: actualNativeDescriptorIds,
      expectedDescriptorIds: nativeDescriptorIds,
    });

  invariant(packPlacements.length === 3
    && new Set(packPlacements.map(({ placementId, id }) => placementId ?? id)).size === 3,
  'golden-pack-inventory-count', 'golden production must place exactly three distinct authored room-pack macros');
  const actualPackRoomIds = packPlacements.map(({ roomId }) => roomId).sort();
  invariant(JSON.stringify(actualPackRoomIds) === JSON.stringify(expectedPackRoomIds),
    'golden-pack-inventory-mismatch', 'golden production selected the wrong authored room-pack macros', {
      actualRoomIds: actualPackRoomIds,
      expectedRoomIds: expectedPackRoomIds,
    });
  invariant(packPlacements.every(({ packId }) => packId === SEMANTIC_ROOM_PACK_V1_ID),
    'golden-pack-identity-mismatch', 'golden production contains a room outside the supplied V1 room pack');

  const moduleById = uniqueById(plan.modulePlacements, 'modulePlacements');
  for (const packPlacement of packPlacements) {
    const placementId = packPlacement.placementId ?? packPlacement.id;
    const modulePlacement = moduleById.get(placementId);
    invariant(modulePlacement
      && modulePlacement.roomId === packPlacement.roomId
      && modulePlacement.packId === SEMANTIC_ROOM_PACK_V1_ID,
    'golden-pack-metadata-only', `${placementId} is room-pack metadata without a matching live module placement`);
  }
  const nonNativeModules = plan.modulePlacements.filter(({ descriptorId }) => (
    !nativeDescriptorIdSet.has(descriptorId)
  ));
  invariant(nonNativeModules.length === 3
    && nonNativeModules.every(({ id }) => packPlacements.some((placement) => (
      (placement.placementId ?? placement.id) === id
    ))),
  'golden-generic-module-present', 'golden production contains a generic, fallback, or unselected module placement');

  invariant(plan.nativeFixedRoomIntegration?.requiredPlacementCount === 11
    && plan.nativeFixedRoomIntegration?.activePlacementIds?.length === 11
    && plan.nativeFixedRoomIntegration?.incompleteDescriptorIds?.length === 0
    && plan.nativeFixedRoomIntegration?.genericFallbackGeometry === false,
  'golden-native-integration-incomplete', 'native V1 integration ledger is incomplete or reports fallback geometry');
  invariant(plan.canonicalNativeV1Coexistence?.accepted === true
    && plan.canonicalNativeV1Coexistence?.nativePlacementCount === 11
    && plan.canonicalNativeV1Coexistence?.semanticPackPlacementCount === 3
    && plan.canonicalNativeV1Coexistence?.totalAuthoredPlacementCount === 14
    && plan.canonicalNativeV1Coexistence?.genericRoomBodyCount === 0,
  'golden-authored-coexistence-incomplete', 'authored coexistence ledger is incomplete or contains generic room bodies');

  invariant(plan.portals.length === GOLDEN_PHYSICAL_PORTAL_COUNT,
    'golden-portal-count', `golden production requires exactly ${GOLDEN_PHYSICAL_PORTAL_COUNT} physical portals`, {
      portalCount: plan.portals.length,
    });
  const cellIds = new Set(plan.spatialCells.map(({ id }) => id));
  const cellById = new Map(plan.spatialCells.map((cell) => [cell.id, cell]));
  const boundaryIds = new Set(plan.structuralBoundaries.map(({ id }) => id));
  const surfaceIds = new Set(plan.walkableSurfaces.map(({ id }) => id));
  const packMetadataByPlacementId = new Map(packPlacements.map((placement) => [
    placement.placementId ?? placement.id,
    placement,
  ]));
  const placementSemanticRegionIds = (placement) => new Set([
    placement?.regionId,
    ...(placement?.regionIds ?? []),
    ...(placement?.semanticRegionIds ?? []),
    ...(packMetadataByPlacementId.get(placement?.id)?.regionIds ?? []),
    ...(packMetadataByPlacementId.get(placement?.id)?.semanticRegionIds ?? []),
  ].filter(Boolean));
  const physicalPlacementOwners = (endpoint) => plan.modulePlacements.filter((placement) => {
    if ((placement.occupiedCellIds ?? []).includes(endpoint.cellId)) return true;
    const pack = packMetadataByPlacementId.get(placement.id);
    if (!pack) return false;
    return (pack.placedRecordIds?.structuralBoundaryIds ?? []).includes(endpoint.boundaryId)
      || (pack.connectorCellIds ?? []).includes(endpoint.cellId);
  });
  for (const portal of plan.portals) {
    const route = portal.physicalRoute;
    invariant(route?.continuous === true && route?.enclosed === true && route?.supported === true,
      'golden-portal-route-incomplete', `${portal.id} lacks a continuous, enclosed, supported physical route`, route);
    invariant(Array.isArray(route.cellIds) && route.cellIds.length > 0
      && route.cellIds.every((id) => cellIds.has(id)),
    'golden-portal-cell-missing', `${portal.id} cannot resolve every physical route cell`, route?.cellIds);
    invariant(Array.isArray(route.boundaryIds) && route.boundaryIds.length > 0
      && route.boundaryIds.every((id) => boundaryIds.has(id)),
    'golden-portal-boundary-missing', `${portal.id} cannot resolve every physical route boundary`, route?.boundaryIds);
    invariant(Array.isArray(route.surfaceIds) && route.surfaceIds.length > 0
      && route.surfaceIds.every((id) => surfaceIds.has(id)),
    'golden-portal-surface-missing', `${portal.id} cannot resolve every physical route surface`, route?.surfaceIds);
    invariant(surfaceIds.has(route.endpointSurfaceIds?.from)
      && surfaceIds.has(route.endpointSurfaceIds?.to),
    'golden-portal-endpoint-surface-missing', `${portal.id} lacks physical surfaces at both authored endpoints`, route?.endpointSurfaceIds);
    for (const endpointName of ['from', 'to']) {
      const endpoint = portal[endpointName];
      const cell = cellById.get(endpoint.cellId);
      const owners = physicalPlacementOwners(endpoint);
      const cellOwnsSemanticRegion = cell?.regionId === endpoint.regionId;
      const placementOwnsSemanticRegion = owners.some((placement) => (
        placementSemanticRegionIds(placement).has(endpoint.regionId)
      ));
      invariant(cellOwnsSemanticRegion || placementOwnsSemanticRegion,
        'golden-portal-endpoint-region-ownership',
        `${portal.id}:${endpointName} relabels physical cell ${endpoint.cellId} as unrelated region ${endpoint.regionId}`, {
          portalId: portal.id,
          endpointName,
          endpointRegionId: endpoint.regionId,
          cellRegionId: cell?.regionId ?? null,
          physicalPlacementIds: owners.map(({ id }) => id),
          placementSemanticRegionIds: owners.map((placement) => ({
            placementId: placement.id,
            regionIds: [...placementSemanticRegionIds(placement)].sort(),
          })),
        });
    }
  }
  const canonicalPortalIds = [...(plan.canonicalNativeV1Coexistence.canonicalPortalIds ?? [])].sort();
  const actualPortalIds = plan.portals.map(({ id }) => id).sort();
  invariant(canonicalPortalIds.length === GOLDEN_PHYSICAL_PORTAL_COUNT
    && JSON.stringify(canonicalPortalIds) === JSON.stringify(actualPortalIds),
  'golden-portal-ledger-mismatch', 'coexistence ledger does not own the exact twenty-one live physical portals');

  for (const { label, connections, setCode, endpointCode } of [
    {
      label: 'progression',
      connections: plan.progression?.connections,
      setCode: 'golden-progression-connection-set',
      endpointCode: 'golden-progression-connection-endpoint-mismatch',
    },
    {
      label: 'minimap',
      connections: plan.minimap?.connections,
      setCode: 'golden-minimap-connection-set',
      endpointCode: 'golden-minimap-connection-endpoint-mismatch',
    },
  ]) {
    const connectionMap = uniqueById(connections ?? [], `${label}.connections`);
    invariant(connectionMap.size === GOLDEN_PHYSICAL_PORTAL_COUNT
      && actualPortalIds.every((portalId) => connectionMap.has(portalId)),
    setCode, `${label} must derive one connection from every accepted physical portal`);
    for (const portal of plan.portals) {
      const connection = connectionMap.get(portal.id);
      invariant(connection.fromRegionId === portal.from.regionId
        && connection.toRegionId === portal.to.regionId,
      endpointCode,
      `${label} ${portal.id} endpoints drifted from its accepted physical portal`, {
        portalId: portal.id,
        portalFromRegionId: portal.from.regionId,
        portalToRegionId: portal.to.regionId,
        connectionFromRegionId: connection.fromRegionId,
        connectionToRegionId: connection.toRegionId,
      });
    }
  }
}

/** Re-run the production symbolic solver; validator metadata alone is not proof. */
export function assertGoldenProductionStateSolver(plan) {
  invariant(plan.accepted === true && plan.validation?.accepted === true,
    'golden-plan-not-validator-accepted', 'Golden solver acceptance requires the validator-produced frozen plan');
  const result = solveDungeonPlanV2Symbolically(plan, {
    maximumVisitedStates: 750000,
    maximumTransitions: 8000000,
  });
  invariant(result.solvable === true && result.exhaustedBudget !== true,
    'golden-state-solver-unsolved', 'independent symbolic exploration could not complete all content and extract', result);
  invariant(Array.isArray(result.trace) && result.trace.length > 0
    && result.trace.some(({ type, id }) => type === 'action' && id === 'action.extract'),
  'golden-state-solver-no-extraction', 'independent symbolic trace never executed the extraction action', result.trace);
  invariant(result.mechanismCoverage?.complete === true
    && Object.keys(result.mechanismCoverage.missingStateIds ?? {}).length === 0,
  'golden-state-solver-mechanism-coverage', 'independent symbolic trace missed a stable mechanism state', result.mechanismCoverage);
  return result;
}

function initialConditionValue(plan, condition, { blockedPortals = new Set() } = {}) {
  if (!condition || typeof condition !== 'object') return false;
  if (condition.op === 'all') return operationChildren(condition)
    .every((entry) => initialConditionValue(plan, entry, { blockedPortals }));
  if (condition.op === 'any') return operationChildren(condition)
    .some((entry) => initialConditionValue(plan, entry, { blockedPortals }));
  if (condition.op === 'stateEquals') {
    const water = plan.environmentStates.find((entry) => entry.variableId === condition.variableId);
    if (water) return water.initialStateId === condition.value;
    if (condition.variableId?.endsWith('.state')) {
      const mechanismId = condition.variableId.slice(0, -'.state'.length);
      return plan.mechanisms.find((entry) => entry.id === mechanismId)?.initialStateId === condition.value;
    }
    return false;
  }
  if (condition.op === 'gateOpen') {
    const gateId = condition.gateId ?? condition.id;
    const gate = (plan.progression?.gateContracts ?? []).find((entry) => (
      entry.id === gateId || entry.barrierId === gateId
    ));
    return Boolean(gate?.portalId) && !blockedPortals.has(gate.portalId);
  }
  return false;
}

function physicallyReachableSurfaces(plan, startSurfaceId, options = {}) {
  const surfaces = uniqueById(plan.walkableSurfaces, 'walkableSurfaces');
  const blockedRegions = new Set(options.blockedRegionIds ?? []);
  const blockedPortals = new Set(options.blockedPortalIds ?? []);
  const outgoing = new Map([...surfaces.keys()].map((id) => [id, []]));
  const surfaceAvailable = (id) => {
    const surface = surfaces.get(id);
    return surface && !blockedRegions.has(surface.regionId);
  };
  for (const link of plan.traversalLinks) {
    const owningPortalId = link.portalId ?? link.proofPortalId ?? null;
    if (owningPortalId && blockedPortals.has(owningPortalId)) continue;
    if ((link.conditions ?? []).some((condition) => (
      !initialConditionValue(plan, condition, { blockedPortals })
    ))) continue;
    const chain = [link.fromSurfaceId, link.viaSurfaceId, link.toSurfaceId].filter(Boolean);
    if (!chain.every(surfaceAvailable)) continue;
    for (let index = 1; index < chain.length; index += 1) outgoing.get(chain[index - 1]).push(chain[index]);
    if (link.bidirectional !== false && link.direction !== 'forward-only') {
      for (let index = chain.length - 1; index > 0; index -= 1) outgoing.get(chain[index]).push(chain[index - 1]);
    }
  }
  if (!surfaceAvailable(startSurfaceId)) return new Set();
  const reached = new Set([startSurfaceId]);
  const queue = [startSurfaceId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const next of outgoing.get(queue[cursor]) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  return reached;
}

export function assertGoldenPhysicalProgression(plan) {
  const surfaces = uniqueById(plan.walkableSurfaces, 'walkableSurfaces');
  const anchors = uniqueById([...(plan.anchors ?? []), ...plan.safeAnchors], 'anchors');
  const portals = uniqueById(plan.portals, 'portals');
  const actions = uniqueById(plan.actions, 'actions');
  const gateContracts = plan.progression?.gateContracts ?? [];
  const initiallyClosedPortals = new Set(gateContracts.map((gate) => gate.portalId));
  for (const portal of plan.portals) {
    if (portal.initiallyOpen === false) initiallyClosedPortals.add(portal.id);
  }

  const start = anchors.get(plan.compatibility?.playerStartAnchorId);
  const alphaReward = plan.rewards.find((reward) => reward.id === 'reward.keycard-alpha');
  const alphaAnchor = anchors.get(alphaReward?.anchorId);
  invariant(start && alphaAnchor, 'alpha-physical-proof-missing', 'Alpha reachability proof requires physical start and pickup anchors');
  const beforeServer = physicallyReachableSurfaces(plan, start.surfaceId ?? start.safeSurfaceId, {
    blockedPortalIds: initiallyClosedPortals,
    blockedRegionIds: ['server'],
  });
  invariant(!beforeServer.has(alphaAnchor.surfaceId ?? alphaAnchor.safeSurfaceId),
    'alpha-before-server-bypass', 'Alpha is physically reachable through Assembly/fall routes before Server is reached');
  const withServer = physicallyReachableSurfaces(plan, start.surfaceId ?? start.safeSurfaceId, {
    blockedPortalIds: initiallyClosedPortals,
  });
  invariant(withServer.has(alphaAnchor.surfaceId ?? alphaAnchor.safeSurfaceId),
    'alpha-physical-route-missing', 'Alpha is not physically reachable through its intended Server/Freight exploration route');

  // The canonical 11+3 composition retired Gate_Credential_Loop. Its stable
  // portal now provides the always-open Undercroft return. The actual gated
  // exploration shortcut is the Gamma-controlled Factory/Credential route.
  const retiredLoopPortal = portals.get('portal.corkscrew-credential-loop');
  invariant(retiredLoopPortal?.initiallyOpen === true && !retiredLoopPortal.barrierId
    && !gateContracts.some((gate) => gate.portalId === retiredLoopPortal.id),
  'retired-credential-loop-still-gated', 'the Undercroft return still carries the obsolete credential-loop gate');

  const returnPortal = portals.get('portal.hazard-core-credential-return');
  const returnGate = gateContracts.find((gate) => gate.portalId === returnPortal?.id);
  invariant(returnPortal && returnPortal.initiallyOpen === false && returnPortal.barrierId
    && returnGate?.classification === 'shortcut'
    && returnGate.barrierId === returnPortal.barrierId,
  'gamma-return-not-physically-locked', 'Gamma return must have an initially closed physical shortcut barrier; direction metadata is insufficient');
  const returnAction = actions.get(returnGate.actionId);
  const returnAnchor = anchors.get(returnGate.anchorId);
  invariant(returnAction && returnAnchor?.regionId === returnPortal.from.regionId
    && returnAction.anchorId === returnAnchor.id
    && returnAction.barrierIds.includes(returnGate.barrierId)
    && effectMatches(returnAction, 'openGate', 'gateId', returnGate.id),
  'gamma-return-wrong-side-control', 'Gamma shortcut must be opened from its physically authored exploration side');

  const credentialSurface = surfaces.get(returnPortal.physicalRoute?.endpointSurfaceIds?.to);
  const explorationSurface = surfaces.get(returnPortal.physicalRoute?.endpointSurfaceIds?.from);
  invariant(credentialSurface && explorationSurface,
    'gamma-return-physical-proof-missing', 'Gamma shortcut proof requires physical surfaces at both portal endpoints');
  const closedPortals = new Set(initiallyClosedPortals);
  closedPortals.add(returnPortal.id);
  const withoutNest = physicallyReachableSurfaces(plan, credentialSurface.id, {
    blockedPortalIds: closedPortals,
    blockedRegionIds: ['nest'],
  });
  invariant(withoutNest.has(explorationSurface.id),
    'nest-is-not-optional', 'Corkscrew must be physically reachable through Parts without entering optional Nest');
  const withoutParts = physicallyReachableSurfaces(plan, credentialSurface.id, {
    blockedPortalIds: closedPortals,
    blockedRegionIds: ['parts', 'nest'],
  });
  invariant(!withoutParts.has(explorationSurface.id),
    'parts-exploration-bypass', 'Corkscrew is physically reachable without the required Parts exploration route');
  invariant(!withoutParts.has(returnAnchor.surfaceId ?? returnAnchor.safeSurfaceId),
    'gamma-return-control-reverse-reachable', 'Gamma shortcut control is physically reachable from the Credential side before exploration');
  const openedReturn = new Set(closedPortals);
  openedReturn.delete(returnPortal.id);
  const shortcutReturn = physicallyReachableSurfaces(plan, credentialSurface.id, {
    blockedPortalIds: openedReturn,
    blockedRegionIds: ['parts', 'nest'],
  });
  invariant(shortcutReturn.has(explorationSurface.id),
    'gamma-return-shortcut-missing', 'opening the Gamma barrier does not produce a physical shortcut back to Credential');
}

export function assertEnvironmentStateContracts(plan, profile = plan.acceptanceProfile) {
  invariant(Array.isArray(plan.environmentStates), 'environment-collection-invalid', 'environmentStates must be an array');
  const environments = uniqueById(plan.environmentStates, 'environmentStates');
  const surfaces = uniqueById(plan.walkableSurfaces, 'walkableSurfaces');
  const regions = uniqueById(plan.regions, 'regions');
  const anchors = uniqueById([...(plan.anchors ?? []), ...plan.safeAnchors], 'anchors');
  const requiresMilestoneEnvironment = profile === 'golden' || profile === 'traversal-lab';
  const waterUnits = [...environments.values()].filter((entry) => entry.type === 'conserved-water-unit');
  if (!requiresMilestoneEnvironment && waterUnits.length === 0) return;
  invariant(waterUnits.length === 1, 'water-unit-count', 'fixture requires exactly one conserved water unit');
  const water = waterUnits[0];
  invariant(water.capacityUnits === 1 && water.conservedVolume === 1,
    'water-volume-changed', 'Waterworks must conserve exactly one water unit');
  invariant(water.initialStateId === 'FreightSumpFilled' && water.transferCommit === 'atomic-after-animation',
    'water-transfer-contract', 'water transfer must begin in FreightSumpFilled and commit atomically after animation');
  invariant(Array.isArray(water.basins) && water.basins.length === 3,
    'water-basin-contract', 'Waterworks requires exactly three authored basins');
  const basins = uniqueById(water.basins, 'water basins');
  for (const basin of basins.values()) {
    const floor = surfaces.get(basin.floorSurfaceId);
    invariant(regions.has(basin.regionId) && floor,
      'water-basin-contract', `${basin.id} has no playable region/floor surface`);
    invariant(basin.capacityUnits === 1, 'water-volume-changed', `${basin.id} changes conserved capacity`);
    const basinBounds = bounds3(basin.bounds, `basin ${basin.id}`);
    const floorBounds = bounds3(floor.bounds, `${basin.id} floor`);
    invariant(basin.footprintPolicy === 'complete-main-walkable-basin'
      && Math.abs(basinBounds.min.x - floorBounds.min.x) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance
      && Math.abs(basinBounds.max.x - floorBounds.max.x) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance
      && Math.abs(basinBounds.min.z - floorBounds.min.z) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance
      && Math.abs(basinBounds.max.z - floorBounds.max.z) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
    'water-basin-footprint-incomplete', `${basin.id} does not cover its complete authored basin floor`);
    const area = (basinBounds.max.x - basinBounds.min.x) * (basinBounds.max.z - basinBounds.min.z);
    invariant(Number.isFinite(basin.exactFilledLevel)
      && Number.isFinite(basin.exactFilledVolume)
      && Math.abs(area * basin.exactFilledLevel - basin.exactFilledVolume) <= 0.001,
    'water-basin-level-volume-mismatch', `${basin.id} filled level does not conserve its exact geometric volume`);
  }
  assertExactIds(water.stableStates ?? [], WATER_STATE_IDS, 'water-state-contract', 'water stable states');
  for (const state of water.stableStates) {
    invariant(state.totalUnits === 1, 'water-volume-changed', `${state.id} changes total water volume`);
    const levelIds = Object.keys(state.basinLevels ?? {}).sort();
    const basinIds = [...basins.keys()].sort();
    invariant(levelIds.length === basinIds.length && levelIds.every((id, index) => id === basinIds[index]),
      'water-state-contract', `${state.id} does not define every basin level`);
    const levels = Object.entries(state.basinLevels);
    invariant(levels.every(([, level]) => Number.isFinite(level) && level >= 0)
      && levels.filter(([, level]) => level > 0).length === 1,
    'water-state-contract', `${state.id} must commit the whole conserved unit to exactly one basin`);
    const positiveBasin = basins.get(levels.find(([, level]) => level > 0)?.[0]);
    const expectedRegionFragment = state.id === 'FreightSumpFilled' ? 'freight'
      : state.id === 'StoredInReservoir' ? 'reservoir' : 'gantry';
    invariant(positiveBasin?.regionId.includes(expectedRegionFragment),
      'water-state-contract', `${state.id} fills the wrong authored basin`);
    const renderedVolume = levels.reduce((total, [basinId, level]) => {
      const basinBounds = bounds3(basins.get(basinId).bounds, `${state.id}/${basinId}`);
      return total + (basinBounds.max.x - basinBounds.min.x)
        * (basinBounds.max.z - basinBounds.min.z) * level;
    }, 0);
    invariant(Number.isFinite(state.exactVolume)
      && Math.abs(renderedVolume - state.exactVolume) <= 0.001,
    'water-exact-volume-mismatch', `${state.id} rendered basin volume differs from exactVolume`,
    { stateId: state.id, renderedVolume, exactVolume: state.exactVolume });
  }
  const movement = water.movementProfile;
  invariant(movement?.captureFloodedStateAtTakeoff === true
    && movement.groundMovementMultiplier === 0.76
    && movement.jumpHeight === 4.95
    && movement.gravityScale === 0.28
    && movement.mode === 'bottom-walking',
  'flooded-movement-contract', 'flooded movement values do not match the Milestone 1 contract');
  invariant(Array.isArray(water.permanentDryControlAnchorIds) && water.permanentDryControlAnchorIds.length > 0
    && water.permanentDryControlAnchorIds.every((id) => anchors.has(id)),
  'water-router-not-permanent-dry', 'water router controls require permanent dry authored anchors');
  const dryClearance = Number.isFinite(water.permanentDryClearance)
    ? Math.max(0.05, water.permanentDryClearance)
    : 0.2;
  for (const anchorId of water.permanentDryControlAnchorIds) {
    const control = anchors.get(anchorId);
    const support = surfaces.get(control.surfaceId ?? control.safeSurfaceId);
    const supportBounds = bounds3(support?.bounds, `${anchorId} dry support`);
    invariant(Math.abs(control.position.y - supportBounds.max.y) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance + 1e-6,
      'water-router-not-permanent-dry', `${anchorId} is not physically mounted on its declared dry support surface`);
    for (const state of water.stableStates) {
      for (const basin of basins.values()) {
        const basinBounds = bounds3(basin.bounds, `${basin.id} dry-control audit`);
        const insideFootprint = control.position.x >= basinBounds.min.x
          && control.position.x <= basinBounds.max.x
          && control.position.z >= basinBounds.min.z
          && control.position.z <= basinBounds.max.z;
        if (!insideFootprint) continue;
        const waterSurfaceY = basinBounds.min.y + state.basinLevels[basin.id];
        invariant(supportBounds.max.y >= waterSurfaceY + dryClearance,
          'water-router-not-permanent-dry', `${anchorId} is submerged by ${state.id} in ${basin.id}`,
          { anchorId, stateId: state.id, basinId: basin.id, supportTopY: supportBounds.max.y, waterSurfaceY, dryClearance });
      }
    }
  }

  const hazards = [...environments.values()].filter((entry) => (
    entry.type === 'magma-floor-v1' || entry.type === 'electric-floor-cycle-v1'
  ));
  if (profile === 'golden') {
    invariant(hazards.length === 1, 'golden-hazard-count', 'golden complex requires exactly one seeded Undercroft hazard');
    const expectedType = plan.undercroftType === 'electrical' ? 'electric-floor-cycle-v1' : 'magma-floor-v1';
    invariant(hazards[0]?.type === expectedType, 'golden-hazard-type', 'Undercroft hazard does not match the golden fixture variant');
  }
  if (profile === 'traversal-lab') {
    invariant(hazards.length === 2 && new Set(hazards.map((entry) => entry.type)).size === 2,
      'lab-hazard-set', 'traversal lab must exercise both hazard types');
  }
  for (const hazard of hazards) {
    invariant(typeof hazard.hazardTag === 'string' && hazard.hazardTag.length > 0
      && Array.isArray(hazard.surfaces) && hazard.surfaces.length > 0,
    'hazard-surface-contract', `${hazard.id} has no explicit tagged hazard surfaces`);
    invariant(hazard.safeRouteRequired === true && hazard.ordinaryEnemyAvoidance === true,
      'hazard-safe-route-contract', `${hazard.id} lacks safe-route/enemy-avoidance requirements`);
    for (const contract of hazard.surfaces) {
      const surface = surfaces.get(contract.surfaceId);
      invariant(surface && regions.has(contract.regionId) && surface.regionId === contract.regionId
        && surface.hazardTag === hazard.hazardTag,
      'hazard-surface-contract', `${hazard.id} references an invalid or untagged surface ${contract.surfaceId}`);
    }
    if (hazard.type === 'magma-floor-v1') {
      invariant(hazard.damagePerSecond === 12 && hazard.pulseSeconds === 0.25 && hazard.entryGraceSeconds === 0.5,
        'magma-timing-contract', `${hazard.id} has incorrect magma damage/pulse/grace values`);
    } else {
      invariant(hazard.damagePerSecond === 9 && hazard.phaseCycleSeconds === 3.5,
        'electrical-timing-contract', `${hazard.id} has incorrect electrical cycle/damage values`);
      const phases = Object.fromEntries((hazard.phases ?? []).map((phase) => [phase.id, phase.durationSeconds]));
      invariant(phases.safe === 1.25 && phases.charging === 0.75 && phases.energized === 1.5,
        'electrical-timing-contract', `${hazard.id} has incorrect electrical phase timing`);
    }
  }
}

export function assertMinimapContracts(plan) {
  const regions = uniqueById(plan.regions, 'regions');
  const portals = uniqueById(plan.portals, 'portals');
  const anchors = uniqueById([...(plan.anchors ?? []), ...plan.safeAnchors], 'anchors');
  invariant(plan.minimap?.source === 'DungeonPlanV2',
    'minimap-not-plan-derived', 'V2 minimap must declare DungeonPlanV2 as its sole geometry source');
  const minimapRegions = uniqueById(plan.minimap.regions ?? [], 'minimap regions');
  invariant(minimapRegions.size === regions.size && [...regions.keys()].every((id) => minimapRegions.has(id)),
    'minimap-region-parity', 'minimap regions must exactly match the accepted plan regions');
  const minimapConnections = uniqueById(plan.minimap.connections ?? [], 'minimap connections');
  invariant(minimapConnections.size === portals.size && [...portals.keys()].every((id) => minimapConnections.has(id)),
    'minimap-connection-parity', 'minimap directed connections must exactly match plan portals');
  for (const connection of minimapConnections.values()) {
    const portal = portals.get(connection.id);
    if (!portal?.from || !portal?.to) continue; // The closed-cell gate reports malformed/unpaired portals.
    invariant(connection.fromRegionId === portal.from.regionId
      && connection.toRegionId === portal.to.regionId
      && connection.direction === (portal.direction ?? 'bidirectional'),
    'minimap-connection-parity', `${connection.id} direction/endpoints differ from its portal contract`);
  }
  for (const marker of uniqueById(plan.minimap.staticMarkers ?? [], 'minimap static markers').values()) {
    invariant(typeof marker.anchorId === 'string' && anchors.has(marker.anchorId),
      'minimap-marker-anchor-missing', `${marker.id} references missing exact plan anchor ${marker.anchorId}`);
  }
}

function reachableMechanismStates(mechanism) {
  const reached = new Set([mechanism.initialStateId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const transition of mechanism.transitions) {
      if ((transition.fromStateId === '*' || reached.has(transition.fromStateId)) && !reached.has(transition.toStateId)) {
        reached.add(transition.toStateId);
        changed = true;
      }
    }
  }
  return reached;
}

function platformFootprintAtState(dynamicBounds, state) {
  const bounds = bounds3(dynamicBounds, 'dynamic lift surface');
  const position = vector3(state.position, `lift state ${state.id}.position`);
  const halfX = (bounds.max.x - bounds.min.x) * 0.5;
  const halfZ = (bounds.max.z - bounds.min.z) * 0.5;
  return {
    min: { x: position.x - halfX, z: position.z - halfZ },
    max: { x: position.x + halfX, z: position.z + halfZ },
  };
}

function horizontalOverlap(minA, maxA, minB, maxB) {
  return Math.min(maxA, maxB) - Math.max(minA, minB);
}

function landingAbutsPlatform(landingBounds, footprint) {
  const landing = bounds3(landingBounds, 'lift landing');
  const xEdgeDistance = Math.min(
    Math.abs(footprint.min.x - landing.max.x),
    Math.abs(footprint.max.x - landing.min.x),
  );
  const zEdgeDistance = Math.min(
    Math.abs(footprint.min.z - landing.max.z),
    Math.abs(footprint.max.z - landing.min.z),
  );
  const xOverlap = horizontalOverlap(footprint.min.x, footprint.max.x, landing.min.x, landing.max.x);
  const zOverlap = horizontalOverlap(footprint.min.z, footprint.max.z, landing.min.z, landing.max.z);
  return (xEdgeDistance <= ACCEPTANCE_LIMITS.visualColliderSampleSpacing && zOverlap >= ACCEPTANCE_LIMITS.minimumLandingWidth)
    || (zEdgeDistance <= ACCEPTANCE_LIMITS.visualColliderSampleSpacing && xOverlap >= ACCEPTANCE_LIMITS.minimumLandingWidth);
}

function horizontalDistanceToFootprint(position, footprint) {
  const dx = Math.max(footprint.min.x - position.x, 0, position.x - footprint.max.x);
  const dz = Math.max(footprint.min.z - position.z, 0, position.z - footprint.max.z);
  return Math.hypot(dx, dz);
}

function horizontalBoundsDistanceToFootprint(candidateBounds, footprint) {
  const candidate = bounds3(candidateBounds, 'console clearance bounds');
  const dx = Math.max(
    footprint.min.x - candidate.max.x,
    candidate.min.x - footprint.max.x,
    0,
  );
  const dz = Math.max(
    footprint.min.z - candidate.max.z,
    candidate.min.z - footprint.max.z,
    0,
  );
  return Math.hypot(dx, dz);
}

export function assertMechanismContracts(plan) {
  const actions = uniqueById(plan.actions, 'actions');
  const anchors = uniqueById([...(plan.anchors ?? []), ...plan.safeAnchors], 'anchors');
  const surfaces = uniqueById(plan.walkableSurfaces, 'walkableSurfaces');
  const fixtures = uniqueById(plan.structuralFixtures ?? [], 'structuralFixtures');
  const environments = uniqueById(plan.environmentStates, 'environmentStates');
  for (const mechanism of uniqueById(plan.mechanisms, 'mechanisms').values()) {
    invariant(Array.isArray(mechanism.states) && mechanism.states.length > 0,
      'mechanism-states-missing', `${mechanism.id} has no stable-state table`);
    const states = uniqueById(mechanism.states, `${mechanism.id}.states`);
    invariant(states.has(mechanism.initialStateId), 'mechanism-initial-state-missing', `${mechanism.id} initial state is undefined`);
    invariant(Array.isArray(mechanism.transitions), 'mechanism-transitions-missing', `${mechanism.id} has no transition table`);
    for (const state of states.values()) {
      if (state.landingSurfaceId) invariant(surfaces.has(state.landingSurfaceId), 'mechanism-landing-surface-missing', `${mechanism.id}:${state.id} references missing landing ${state.landingSurfaceId}`);
      if (state.position) vector3(state.position, `${mechanism.id}:${state.id}.position`);
    }
    if (mechanism.runtimeProfile?.dynamicSurfaceId) {
      invariant(surfaces.has(mechanism.runtimeProfile.dynamicSurfaceId),
        'mechanism-dynamic-surface-missing', `${mechanism.id} references missing dynamic surface`);
      const dynamicSurface = surfaces.get(mechanism.runtimeProfile.dynamicSurfaceId);
      const stablePositions = [...states.values()]
        .filter((state) => state.stable !== false && state.position)
        .map((state) => ({
          id: state.id,
          position: vector3(state.position, `${mechanism.id}:${state.id}.position`),
          surfaceY: Number(state.surfaceY ?? state.elevation ?? state.position.y),
        }));
      invariant(stablePositions.length > 0,
        'mechanism-route-support-missing', `${mechanism.id} has no authored stable poses to support`);
      invariant(Array.isArray(dynamicSurface.supportFixtureIds) && dynamicSurface.supportFixtureIds.length > 0,
        'mechanism-route-support-missing', `${mechanism.id} dynamic route has no visible support fixture`);
      const dynamicBounds = bounds3(dynamicSurface.bounds, `${mechanism.id} dynamic surface`);
      const halfX = (dynamicBounds.max.x - dynamicBounds.min.x) * 0.5;
      const halfZ = (dynamicBounds.max.z - dynamicBounds.min.z) * 0.5;
      for (const fixtureId of dynamicSurface.supportFixtureIds) {
        const fixture = fixtures.get(fixtureId);
        invariant(fixture && fixture.mechanismId === mechanism.id,
          'mechanism-route-support-missing', `${mechanism.id} support ${fixtureId} is not explicitly bound to the mechanism`);
        const supportBounds = bounds3(fixture.bounds, `${mechanism.id} route support`);
        const supportedStateIds = new Set(fixture.supportedStateIds ?? []);
        invariant(stablePositions.every(({ id }) => supportedStateIds.has(id)),
          'mechanism-route-support-state-missing', `${mechanism.id} support does not cover every stable state`);
        const clearance = Number(fixture.supportClearance);
        invariant(Number.isFinite(clearance) && clearance >= 0.45,
          'mechanism-route-support-clearance', `${mechanism.id} supports intrude into the moving platform route`);
        for (const state of stablePositions) {
          invariant(Number.isFinite(state.surfaceY)
            && supportBounds.min.x <= state.position.x - halfX - clearance + ACCEPTANCE_LIMITS.surfaceHeightTolerance
            && supportBounds.max.x >= state.position.x + halfX + clearance - ACCEPTANCE_LIMITS.surfaceHeightTolerance
            && supportBounds.min.z <= state.position.z - halfZ - clearance + ACCEPTANCE_LIMITS.surfaceHeightTolerance
            && supportBounds.max.z >= state.position.z + halfZ + clearance - ACCEPTANCE_LIMITS.surfaceHeightTolerance
            && supportBounds.min.y <= state.surfaceY + ACCEPTANCE_LIMITS.surfaceHeightTolerance,
          'mechanism-route-support-pose-missing', `${mechanism.id}:${state.id} lies outside its visible support frame`);
        }
        const highestSurfaceY = Math.max(...stablePositions.map(({ surfaceY }) => surfaceY));
        invariant(supportBounds.max.y >= highestSurfaceY + 3.2,
          'mechanism-route-support-headroom', `${mechanism.id} support does not preserve 3.2m headroom over every stable pose`);
        if (mechanism.type === 'moving-cargo') {
          invariant(Number(fixture.overheadRailY) >= highestSurfaceY + 3.2
            && Math.abs(Number(fixture.overheadRailY) - supportBounds.max.y) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
          'moving-cargo-overhead-rail-missing', `${mechanism.id} has no full-route overhead rail above player headroom`);
        }
      }
    }
    for (const transition of mechanism.transitions) {
      invariant(transition.fromStateId === '*' || states.has(transition.fromStateId),
        'mechanism-transition-invalid', `${mechanism.id} transition has unknown source ${transition.fromStateId}`);
      invariant(states.has(transition.toStateId),
        'mechanism-transition-invalid', `${mechanism.id} transition has unknown target ${transition.toStateId}`);
      invariant(transition.actionId || transition.automatic === true,
        'mechanism-transition-trigger-missing', `${mechanism.id} transition has neither shared action nor automatic trigger`);
      if (transition.actionId) {
        const action = actions.get(transition.actionId);
        invariant(action, 'mechanism-transition-action-missing', `${mechanism.id} references missing action ${transition.actionId}`);
        invariant(effectMatches(action, 'setMechanismState', 'mechanismId', mechanism.id)
          && action.effects.some((effect) => effect.op === 'setMechanismState' && effect.stateId === transition.toStateId),
        'mechanism-transition-action-mismatch', `${transition.actionId} does not commit ${mechanism.id}:${transition.toStateId}`);
      }
    }
    const environmentDriven = mechanism.type === 'magma-floor-v1' || mechanism.type === 'electric-floor-cycle-v1';
    if (!environmentDriven) {
      invariant(mechanism.transitions.length > 0, 'mechanism-transitions-missing', `${mechanism.id} has no stable-state transitions`);
      const reachable = reachableMechanismStates(mechanism);
      const missing = [...states.values()].filter((state) => state.stable === true && !reachable.has(state.id));
      invariant(missing.length === 0, 'mechanism-state-unreachable', `${mechanism.id} has unreachable stable states`, missing.map((state) => state.id));
    } else {
      invariant(environments.has(mechanism.runtimeProfile?.environmentStateId),
        'hazard-mechanism-environment-missing', `${mechanism.id} has no matching environment contract`);
    }

    if (mechanism.type === 'water-router') {
      assertExactIds(mechanism.states, WATER_STATE_IDS, 'water-router-state-contract', `${mechanism.id} states`);
      invariant(WATER_STATE_IDS.every((stateId) => mechanism.transitions.some((transition) => (
        transition.toStateId === stateId && transition.actionId
      ))), 'water-router-transition-contract', `${mechanism.id} cannot explicitly select every stable water state`);
    }
    if (mechanism.type === 'cargo-lift') {
      invariant(mechanism.recallable === true && mechanism.automaticTravel === true,
        'lift-recall-automatic-contract', `${mechanism.id} must be recallable and travel automatically`);
      const stableLandings = [...states.values()].filter((state) => state.stable === true && state.landingSurfaceId);
      invariant(stableLandings.length >= 2, 'lift-landing-contract', `${mechanism.id} needs at least two useful authored landings`);
      const dynamicSurface = surfaces.get(mechanism.runtimeProfile?.dynamicSurfaceId);
      invariant(dynamicSurface, 'mechanism-dynamic-surface-missing', `${mechanism.id} has no registered moving platform`);
      const dynamicBounds = bounds3(dynamicSurface.bounds, `${mechanism.id} dynamic surface`);
      const platformThickness = dynamicBounds.max.y - dynamicBounds.min.y;
      const initialState = states.get(mechanism.initialStateId);
      const initialPosition = vector3(initialState.position, `${mechanism.id} initial position`);
      invariant(Math.abs((dynamicBounds.min.x + dynamicBounds.max.x) * 0.5 - initialPosition.x) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance
        && Math.abs((dynamicBounds.min.z + dynamicBounds.max.z) * 0.5 - initialPosition.z) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance
        && Math.abs(dynamicBounds.min.y - (initialState.surfaceY ?? initialPosition.y)) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
      'lift-initial-pose-mismatch', `${mechanism.id} dynamic surface does not match its initial stable-state pose`);

      for (const state of stableLandings) {
        const statePosition = vector3(state.position, `${mechanism.id}:${state.id}.position`);
        const surfaceY = state.surfaceY ?? statePosition.y;
        invariant(Number.isFinite(surfaceY) && Math.abs(surfaceY - statePosition.y) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
          'lift-state-pose-mismatch', `${mechanism.id}:${state.id} has inconsistent surfaceY and position`);
        const landing = surfaces.get(state.landingSurfaceId);
        const landingBounds = bounds3(landing.bounds, `${mechanism.id}:${state.id} landing`);
        invariant(landing.collision !== 'dynamic'
          && Math.abs(landingBounds.min.y - surfaceY) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance
          && Math.abs(landingBounds.max.y - (surfaceY + platformThickness)) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
        'lift-state-landing-height-mismatch', `${mechanism.id}:${state.id} landing does not match the platform surface within 0.05m`);
        const footprint = platformFootprintAtState(dynamicSurface.bounds, state);
        invariant(landingAbutsPlatform(landing.bounds, footprint),
          'lift-landing-seam-missing', `${mechanism.id}:${state.id} platform does not physically meet its authored landing`);
        const variableId = `${mechanism.id}.state`;
        const stateLinks = plan.traversalLinks.filter((link) => {
          const endpoints = new Set([link.fromSurfaceId, link.toSurfaceId]);
          return link.mechanismId === mechanism.id
            && endpoints.has(landing.id)
            && endpoints.has(dynamicSurface.id)
            && link.bidirectional !== false
            && link.direction !== 'forward-only'
            && flattenConditions(link.conditions ?? []).some((condition) => (
              condition.op === 'stateEquals'
              && condition.variableId === variableId
              && condition.value === state.id
            ));
        });
        invariant(stateLinks.length === 1,
          'lift-state-traversal-link-missing', `${mechanism.id}:${state.id} requires exactly one state-conditioned landing/platform traversal link`);
        const approachLinks = plan.traversalLinks.filter((link) => {
          if (link.bidirectional === false || link.direction === 'forward-only' || /lift/i.test(link.mode)) return false;
          const otherSurfaceId = link.fromSurfaceId === landing.id ? link.toSurfaceId
            : link.toSurfaceId === landing.id ? link.fromSurfaceId : null;
          const otherSurface = surfaces.get(otherSurfaceId);
          return otherSurface && otherSurface.id !== dynamicSurface.id && otherSurface.collision !== 'dynamic';
        });
        invariant(approachLinks.length > 0,
          'lift-landing-approach-missing', `${mechanism.id}:${state.id} landing has no static reachable landing/approach link`);

        const automaticDeparture = mechanism.transitions.find((transition) => (
          transition.fromStateId === state.id
          && transition.toStateId !== state.id
          && transition.trigger === 'automatic-dwell'
          && transition.automatic === true
        ));
        invariant(automaticDeparture,
          'lift-automatic-departure-missing', `${mechanism.id}:${state.id} does not cycle automatically after its stable dwell`);
        const recall = mechanism.transitions.find((transition) => (
          transition.toStateId === state.id
          && transition.fromStateId !== state.id
          && (transition.trigger === 'recall' || String(transition.actionId).includes('recall'))
        ));
        invariant(recall, 'lift-recall-transition-missing', `${mechanism.id}:${state.id} has no terminal recall transition`);
        const recallAction = actions.get(recall.actionId);
        invariant(recallAction, 'lift-recall-action-missing', `${mechanism.id}:${state.id} recall console has no shared action contract`);
        const consoleAnchor = anchors.get(recallAction.anchorId);
        const approachSurfaceIds = new Set([
          landing.id,
          ...approachLinks.map((link) => link.fromSurfaceId === landing.id ? link.toSurfaceId : link.fromSurfaceId),
        ]);
        invariant(consoleAnchor && approachSurfaceIds.has(consoleAnchor.surfaceId ?? consoleAnchor.safeSurfaceId),
          'lift-terminal-console-missing', `${mechanism.id}:${state.id} lacks a side-console anchor on its static landing/approach`);
        const consoleSurface = surfaces.get(consoleAnchor.surfaceId ?? consoleAnchor.safeSurfaceId);
        const consoleSurfaceBounds = bounds3(consoleSurface.bounds, `${consoleAnchor.id} supporting surface`);
        invariant(consoleAnchor.position.x >= consoleSurfaceBounds.min.x - ACCEPTANCE_LIMITS.surfaceHeightTolerance
          && consoleAnchor.position.x <= consoleSurfaceBounds.max.x + ACCEPTANCE_LIMITS.surfaceHeightTolerance
          && consoleAnchor.position.z >= consoleSurfaceBounds.min.z - ACCEPTANCE_LIMITS.surfaceHeightTolerance
          && consoleAnchor.position.z <= consoleSurfaceBounds.max.z + ACCEPTANCE_LIMITS.surfaceHeightTolerance
          && Math.abs(consoleAnchor.position.y - surfaceY) <= 2.25,
        'lift-terminal-console-misaligned', `${consoleAnchor.id} is not physically placed on the ${state.id} terminal`);
        const consoleDistance = horizontalDistanceToFootprint(consoleAnchor.position, footprint);
        invariant(consoleDistance >= 0.25 && consoleDistance <= 4.5,
          'lift-terminal-console-on-platform', `${consoleAnchor.id} must be beside, not inside or far from, the moving platform`);
      }
      invariant(Number(mechanism.runtimeProfile?.controlOffsetFromWalkway) >= 1.5,
        'lift-control-obstructs-walkway', `${mechanism.id} recall control is not placed beside the walkway`);
    }
    if (mechanism.type === 'moving-cargo') {
      invariant(mechanism.automaticTravel === true && mechanism.transitions.length >= 2
        && mechanism.transitions.every((transition) => transition.automatic === true
          && transition.trigger === 'automatic-dwell'),
      'moving-cargo-automatic-contract', `${mechanism.id} must cycle automatically`);
      invariant(mechanism.runtimeProfile?.elevated === true && mechanism.runtimeProfile.minimumElevation >= 3,
        'moving-cargo-not-elevated', `${mechanism.id} must connect useful elevated landings`);
      invariant(new Set([...states.values()].map((state) => state.landingSurfaceId).filter(Boolean)).size >= 2,
        'moving-cargo-landings-missing', `${mechanism.id} does not connect two distinct authored landings`);
      const dynamicSurface = surfaces.get(mechanism.runtimeProfile?.dynamicSurfaceId);
      invariant(dynamicSurface, 'mechanism-dynamic-surface-missing', `${mechanism.id} has no registered moving platform`);
      const dynamicBounds = bounds3(dynamicSurface.bounds, `${mechanism.id} dynamic surface`);
      const platformThickness = dynamicBounds.max.y - dynamicBounds.min.y;
      const stableLandings = [...states.values()].filter((state) => state.stable === true);
      for (const state of stableLandings) {
        const statePosition = vector3(state.position, `${mechanism.id}:${state.id}.position`);
        const landing = surfaces.get(state.landingSurfaceId);
        invariant(landing && landing.collision !== 'dynamic',
          'moving-cargo-state-landing-missing', `${mechanism.id}:${state.id} has no static authored landing`);
        const landingBounds = bounds3(landing.bounds, `${mechanism.id}:${state.id} landing`);
        const platformBaseY = Number(state.surfaceY ?? statePosition.y);
        const platformTopY = platformBaseY + platformThickness;
        invariant(Number.isFinite(platformTopY)
          && Math.abs(landingBounds.max.y - platformTopY) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
        'moving-cargo-state-landing-height-mismatch', `${mechanism.id}:${state.id} platform top and landing top differ by more than 0.05m`, {
          platformTopY,
          landingTopY: landingBounds.max.y,
        });
        const footprint = platformFootprintAtState(dynamicSurface.bounds, state);
        invariant(landingAbutsPlatform(landing.bounds, footprint),
          'moving-cargo-landing-seam-missing', `${mechanism.id}:${state.id} lacks a physical landing seam at least 1.2m wide`);
        const variableId = `${mechanism.id}.state`;
        const stateLinks = plan.traversalLinks.filter((link) => {
          const endpoints = new Set([link.fromSurfaceId, link.toSurfaceId]);
          return link.mechanismId === mechanism.id
            && endpoints.has(landing.id)
            && endpoints.has(dynamicSurface.id)
            && link.bidirectional !== false
            && link.direction !== 'forward-only'
            && conditionMatches(link.conditions, 'stateEquals', 'variableId', variableId)
            && flattenConditions(link.conditions ?? []).some((condition) => (
              condition.op === 'stateEquals'
              && condition.variableId === variableId
              && condition.value === state.id
            ));
        });
        invariant(stateLinks.length === 1,
          'moving-cargo-state-traversal-link-missing', `${mechanism.id}:${state.id} requires exactly one state-conditioned landing/platform traversal link`);
      }
    }
    if (mechanism.type === 'crumbling-floor') {
      assertExactIds(mechanism.states, ['Intact', 'Cracking', 'Collapsed', 'Resetting'],
        'crumble-state-contract', `${mechanism.id} states`);
      invariant(mechanism.automaticReset === true && mechanism.runtimeProfile?.noManualRearm === true,
        'crumble-manual-rearm', `${mechanism.id} must reset automatically and expose no rearm command`);
      const requiredEdges = [
        ['Intact', 'Cracking'], ['Cracking', 'Collapsed'],
        ['Collapsed', 'Resetting'], ['Resetting', 'Intact'],
      ];
      invariant(requiredEdges.every(([from, to]) => mechanism.transitions.some((transition) => (
        transition.fromStateId === from && transition.toStateId === to && transition.automatic === true
      ))), 'crumble-transition-contract', `${mechanism.id} lacks its complete automatic collapse/reset cycle`);
      invariant(![...actions.values()].some((action) => /rearm/i.test(`${action.id} ${action.type ?? ''}`)),
        'crumble-manual-rearm', 'a player-facing fracture-floor rearm action is forbidden');
    }
    if (mechanism.type === 'corkscrew-gear') {
      invariant(mechanism.recallable === true && mechanism.automaticTravel === true,
        'corkscrew-recall-automatic-contract', `${mechanism.id} must be recallable and travel automatically`);
      const stableLandings = [...states.values()].filter((state) => state.stable === true && state.landingSurfaceId);
      invariant(stableLandings.length >= 2,
        'corkscrew-landing-contract', `${mechanism.id} needs at least two useful authored landings`);
      const dynamicSurface = surfaces.get(mechanism.runtimeProfile?.dynamicSurfaceId);
      invariant(dynamicSurface, 'mechanism-dynamic-surface-missing', `${mechanism.id} has no registered gear platform`);
      const dynamicBounds = bounds3(dynamicSurface.bounds, `${mechanism.id} dynamic surface`);
      const platformThickness = dynamicBounds.max.y - dynamicBounds.min.y;
      for (const state of stableLandings) {
        const statePosition = vector3(state.position, `${mechanism.id}:${state.id}.position`);
        const platformBaseY = Number(state.surfaceY ?? state.elevation ?? statePosition.y);
        const platformTopY = platformBaseY + platformThickness;
        invariant(Number.isFinite(platformBaseY)
          && Math.abs(platformBaseY - statePosition.y) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
        'corkscrew-state-landing-height-mismatch', `${mechanism.id}:${state.id} has inconsistent elevation and position`);
        const landing = surfaces.get(state.landingSurfaceId);
        invariant(landing && landing.collision !== 'dynamic',
          'corkscrew-state-landing-missing', `${mechanism.id}:${state.id} has no static authored landing`);
        const landingBounds = bounds3(landing.bounds, `${mechanism.id}:${state.id} landing`);
        invariant(Number.isFinite(platformTopY)
          && Math.abs(landingBounds.max.y - platformTopY) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
        'corkscrew-state-landing-height-mismatch', `${mechanism.id}:${state.id} platform top and landing top differ by more than 0.05m`, {
          platformTopY,
          landingTopY: landingBounds.max.y,
        });
        const footprint = platformFootprintAtState(dynamicSurface.bounds, state);
        invariant(landingAbutsPlatform(landing.bounds, footprint),
          'corkscrew-landing-seam-missing', `${mechanism.id}:${state.id} lacks a physical landing seam at least 1.2m wide`);
        const variableId = `${mechanism.id}.state`;
        const stateLinks = plan.traversalLinks.filter((link) => {
          const endpoints = new Set([link.fromSurfaceId, link.toSurfaceId]);
          return link.mechanismId === mechanism.id
            && endpoints.has(landing.id)
            && endpoints.has(dynamicSurface.id)
            && link.bidirectional !== false
            && link.direction !== 'forward-only'
            && flattenConditions(link.conditions ?? []).some((condition) => (
              condition.op === 'stateEquals'
              && condition.variableId === variableId
              && condition.value === state.id
            ));
        });
        invariant(stateLinks.length === 1,
          'corkscrew-state-traversal-link-missing', `${mechanism.id}:${state.id} requires exactly one state-conditioned landing/platform traversal link`);
        invariant(mechanism.transitions.some((transition) => (
          transition.fromStateId === state.id
          && transition.toStateId !== state.id
          && transition.trigger === 'automatic-dwell'
          && transition.automatic === true
        )), 'corkscrew-automatic-departure-missing', `${mechanism.id}:${state.id} does not cycle automatically after its stable dwell`);
        const recall = mechanism.transitions.find((transition) => (
          transition.toStateId === state.id
          && transition.fromStateId !== state.id
          && (transition.trigger === 'recall' || String(transition.actionId).includes('recall'))
        ));
        invariant(recall && actions.has(recall.actionId),
          'corkscrew-recall-transition-missing', `${mechanism.id}:${state.id} has no shared-action terminal recall transition`);
      }
      if (plan.acceptanceProfile === 'golden') {
        const undercroftPortal = plan.portals.find(({ id }) => id === 'portal.corkscrew-hazard-intake');
        invariant(undercroftPortal
          && flattenConditions(undercroftPortal.conditions ?? []).some((condition) => (
            condition.op === 'stateEquals'
            && condition.variableId === 'mechanism.corkscrew-gear.state'
            && condition.value === 'LowLanding'
          )),
        'corkscrew-hazard-portal-state-condition-missing', 'portal.corkscrew-hazard-intake must require mechanism.corkscrew-gear.state == LowLanding');
      }
    }
  }
}

export function assertLandmarkCompoundSpaces(plan, profile = plan.acceptanceProfile) {
  if (profile !== 'golden' && profile !== 'traversal-lab') return;
  const surfaces = uniqueById(plan.walkableSurfaces, 'walkableSurfaces');
  for (const region of plan.regions.filter((entry) => entry.landmark === true)) {
    const cells = plan.spatialCells.filter((cell) => (
      cell.regionId === region.id && cell.playable === true && cell.connector !== true
    ));
    const cellIds = new Set(cells.map((cell) => cell.id));
    invariant(Array.isArray(region.cellIds) && cells.every((cell) => region.cellIds.includes(cell.id)),
      'landmark-cell-registry-incomplete', `${region.id} does not register every authored compound cell`);
    const usesPlayableCells = cells.length >= 3;
    const usesNativeSubRegions = cells.length === 1
      && Array.isArray(region.subRegions)
      && region.subRegions.length >= 3;
    invariant(usesPlayableCells || usesNativeSubRegions,
      'landmark-not-compound', `${region.id} requires either three authored playable non-connector cells or three explicit surface-owned native subregions`);

    let spaces;
    let surfacesBySpace;
    let spaceBySurface;
    let disconnectedCode;
    if (usesPlayableCells) {
      spaces = cells.map(({ id }) => id);
      surfacesBySpace = new Map(spaces.map((id) => [id, []]));
      for (const surface of surfaces.values()) {
        if (surfacesBySpace.has(surface.cellId)) surfacesBySpace.get(surface.cellId).push(surface);
      }
      invariant([...surfacesBySpace.values()].every((entries) => entries.length > 0),
        'landmark-cell-unwalkable', `${region.id} contains an authored cell with no walkable surface`);
      spaceBySurface = new Map([...surfacesBySpace].flatMap(([spaceId, entries]) => (
        entries.map((surface) => [surface.id, spaceId])
      )));
      disconnectedCode = 'landmark-cells-disconnected';
    } else {
      const liveCellId = cells[0].id;
      spaces = [];
      surfacesBySpace = new Map();
      spaceBySurface = new Map();
      for (const [index, subRegion] of region.subRegions.entries()) {
        const subRegionId = typeof subRegion?.id === 'string' && subRegion.id.length > 0
          ? subRegion.id
          : `${region.id}.subregion.${index}`;
        invariant(!surfacesBySpace.has(subRegionId),
          'landmark-subregion-id-duplicate', `${region.id} repeats native subregion id ${subRegionId}`);
        invariant(Array.isArray(subRegion?.surfaceIds) && subRegion.surfaceIds.length > 0,
          'landmark-subregion-surface-ids-missing', `${subRegionId} must own at least one explicit walkable surface id`);
        const ownedSurfaces = [];
        for (const surfaceId of subRegion.surfaceIds) {
          const surface = surfaces.get(surfaceId);
          invariant(surface,
            'landmark-subregion-surface-missing', `${subRegionId} references stale or missing surface ${surfaceId}`);
          invariant(surface.regionId === region.id && surface.cellId === liveCellId,
            'landmark-subregion-surface-scope-mismatch', `${subRegionId} surface ${surfaceId} must belong to ${region.id}/${liveCellId}`);
          invariant(!spaceBySurface.has(surfaceId),
            'landmark-subregion-surface-duplicate', `${surfaceId} is owned by both ${spaceBySurface.get(surfaceId)} and ${subRegionId}`);
          spaceBySurface.set(surfaceId, subRegionId);
          ownedSurfaces.push(surface);
        }
        spaces.push(subRegionId);
        surfacesBySpace.set(subRegionId, ownedSurfaces);
      }
      disconnectedCode = 'landmark-subregions-disconnected';
    }

    const adjacency = new Map(spaces.map((id) => [id, new Set()]));
    const internalLinks = [];
    for (const link of plan.traversalLinks) {
      const fromSpaceId = spaceBySurface.get(link.fromSurfaceId);
      const toSpaceId = spaceBySurface.get(link.toSurfaceId);
      if (!fromSpaceId || !toSpaceId) continue;
      internalLinks.push(link);
      if (fromSpaceId !== toSpaceId) {
        adjacency.get(fromSpaceId).add(toSpaceId);
        if (link.bidirectional !== false && link.direction !== 'forward-only') adjacency.get(toSpaceId).add(fromSpaceId);
      }
    }
    const reached = new Set([spaces[0]]);
    const queue = [spaces[0]];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const next of adjacency.get(queue[cursor]) ?? []) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
    invariant(reached.size === spaces.length,
      disconnectedCode, `${region.id} compound spaces are not internally connected by authored traversal`);
    invariant(internalLinks.length >= 2 && new Set(internalLinks.map((link) => link.mode)).size >= 2,
      'landmark-route-variety-missing', `${region.id} lacks multiple authored internal route forms`);
    const elevations = [...surfacesBySpace.values()].flatMap((entries) => (
      entries.map((surface) => bounds3(surface.bounds, surface.id).max.y)
    ));
    invariant(elevations.length >= 2 && Math.max(...elevations) - Math.min(...elevations) >= ACCEPTANCE_LIMITS.minimumPortalElevationDelta,
      'landmark-elevation-bands-missing', `${region.id} lacks two playable elevation bands separated by at least 3m`);
    const functionalFixtures = plan.structuralFixtures.filter((fixture) => {
      if (fixture.regionId !== region.id || !cellIds.has(fixture.cellId)) return false;
      const role = `${fixture.type ?? ''} ${fixture.purpose ?? fixture.gameplayPurpose ?? ''}`.toLowerCase();
      return !role.includes('structural-support') && !role.includes('decoration')
        && /(machine|pump|pipe|gear|cargo|conveyor|turbine|valve|router|lift|server|conduit|generator|reservoir|control)/.test(role);
    });
    invariant(functionalFixtures.length >= 2 && new Set(functionalFixtures.map((fixture) => fixture.type)).size >= 2,
      'landmark-functional-machinery-missing', `${region.id} needs multiple distinct functional machinery fixtures, not a token catwalk`);
  }
}

export function assertClosedCellContract(plan) {
  const regions = uniqueById(plan.regions, 'regions');
  const cells = uniqueById(plan.spatialCells, 'spatialCells');
  const boundaries = uniqueById(plan.structuralBoundaries, 'structuralBoundaries');
  const portals = uniqueById(plan.portals, 'portals');
  const surfaces = uniqueById(plan.walkableSurfaces, 'walkableSurfaces');
  const coverage = new Set();
  const referencedFrames = new Set();
  const referencedInternalFrames = new Set();
  const referencedInternalPortalIds = new Set();
  const routeCellIds = new Set(plan.portals.flatMap((portal) => portal.physicalRoute?.cellIds ?? portal.connectorCellIds ?? []));

  for (const cell of cells.values()) {
    invariant((cell.playable === true || routeCellIds.has(cell.id)) && cell.interior === true,
      'cell-not-playable-interior', `${cell.id} is not a playable interior or authored traversal cell`);
    invariant(regions.has(cell.regionId), 'cell-region-missing', `${cell.id} references missing region ${cell.regionId}`);
    bounds3(cell.bounds, `cell ${cell.id}`);
  }

  for (const boundary of boundaries.values()) {
    const cell = cells.get(boundary.cellId);
    const side = canonicalSide(boundary.side);
    invariant(cell, 'boundary-cell-missing', `${boundary.id} references missing cell ${boundary.cellId}`);
    invariant(side, 'boundary-side-invalid', `${boundary.id} has invalid side ${boundary.side}`);
    invariant(boundary.regionId === cell.regionId, 'boundary-region-mismatch', `${boundary.id} does not belong to its cell region`);
    invariant(['solid', 'portal-frame', 'movable-gate-barrier'].includes(boundary.kind),
      'boundary-not-structural', `${boundary.id} is decorative or not structural`);
    invariant(typeof boundary.materialProfileId === 'string' && boundary.materialProfileId.length > 0,
      'boundary-material-missing', `${boundary.id} has no structural material profile`);
    invariant(colliderEnabled(boundary.collider), 'boundary-collider-missing', `${boundary.id} has no enabled collider`);
    if (boundary.kind === 'movable-gate-barrier') {
      const blockedPortal = portals.get(boundary.blocksPortalId);
      const matchingEndpoint = blockedPortal && [blockedPortal.from, blockedPortal.to].some((endpoint) => (
        endpoint?.cellId === boundary.cellId
        && endpoint.regionId === boundary.regionId
        && canonicalSide(endpoint.side) === side
      ));
      invariant(boundary.opaque === true && matchingEndpoint,
        'gate-barrier-contract-invalid', `${boundary.id} is not an opaque collider tied to a portal endpoint`);
    }
    bounds3(boundary.bounds, `boundary ${boundary.id}`);
    coverage.add(`${boundary.cellId}:${side}`);
  }

  for (const boundary of boundaries.values()) {
    if (boundary.kind !== 'portal-frame') continue;
    const side = canonicalSide(boundary.side);
    const sourceCell = cells.get(boundary.cellId);
    for (const opening of boundary.openings ?? []) {
      if (!opening?.internalPortalId) continue;
      const internalPortalId = opening.internalPortalId;
      invariant(!referencedInternalPortalIds.has(internalPortalId),
        'internal-opening-id-duplicate', `${internalPortalId} is declared by more than one internal frame`);
      referencedInternalPortalIds.add(internalPortalId);
      invariant(opening.pairedWithinCompound === true
        && opening.sourceCellId === sourceCell.id
        && typeof opening.targetCellId === 'string',
      'internal-opening-contract-missing', `${boundary.id} lacks an explicit within-compound source/target contract`);
      invariant(!portals.has(opening.portalId) && !portals.has(internalPortalId),
        'internal-opening-top-level-portal', `${boundary.id} incorrectly promotes a compound opening to a dungeon portal`);

      const targetCell = cells.get(opening.targetCellId);
      invariant(targetCell, 'internal-opening-target-missing', `${boundary.id} targets missing cell ${opening.targetCellId}`);
      const sourceCompoundId = sourceCell.compoundSpaceId ?? sourceCell.compoundId;
      const targetCompoundId = targetCell.compoundSpaceId ?? targetCell.compoundId;
      invariant(sourceCompoundId && sourceCompoundId === targetCompoundId
        && sourceCell.regionId === targetCell.regionId
        && opening.targetRegionId === targetCell.regionId,
      'internal-opening-compound-mismatch', `${boundary.id} does not open into its containing compound shell`);

      const center = vector3(opening.center, `${opening.id ?? internalPortalId}.center`);
      const sourceBounds = bounds3(sourceCell.bounds, sourceCell.id);
      const expectedFaceCoordinate = side === 'west' ? sourceBounds.min.x
        : side === 'east' ? sourceBounds.max.x
          : side === 'floor' ? sourceBounds.min.y
            : side === 'ceiling' ? sourceBounds.max.y
              : side === 'north' ? sourceBounds.min.z : sourceBounds.max.z;
      const actualFaceCoordinate = side === 'west' || side === 'east' ? center.x
        : side === 'floor' || side === 'ceiling' ? center.y : center.z;
      invariant(Math.abs(expectedFaceCoordinate - actualFaceCoordinate) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
        'internal-opening-frame-misaligned', `${boundary.id} opening is not on the declared source-cell face`);

      const normal = SIDE_NORMALS[side];
      const outwardSample = {
        x: center.x + normal.x * ACCEPTANCE_LIMITS.visualColliderSampleSpacing,
        y: center.y + normal.y * ACCEPTANCE_LIMITS.visualColliderSampleSpacing,
        z: center.z + normal.z * ACCEPTANCE_LIMITS.visualColliderSampleSpacing,
      };
      const targetBounds = bounds3(targetCell.bounds, targetCell.id);
      invariant(outwardSample.x > targetBounds.min.x && outwardSample.x < targetBounds.max.x
        && outwardSample.y > targetBounds.min.y && outwardSample.y < targetBounds.max.y
        && outwardSample.z > targetBounds.min.z && outwardSample.z < targetBounds.max.z,
      'internal-opening-outside-target', `${boundary.id} opens into unowned space instead of ${targetCell.id}`);

      const matchingLinks = plan.traversalLinks.filter((link) => link.internalPortalId === internalPortalId);
      invariant(matchingLinks.length === 1,
        'internal-opening-traversal-missing', `${boundary.id} requires exactly one traversal link for ${internalPortalId}`);
      const link = matchingLinks[0];
      const fromCellId = surfaces.get(link.fromSurfaceId)?.cellId;
      const toCellId = surfaces.get(link.toSurfaceId)?.cellId;
      invariant(link.regionId === sourceCell.regionId
        && link.bidirectional !== false
        && ((fromCellId === sourceCell.id && toCellId === targetCell.id)
          || (fromCellId === targetCell.id && toCellId === sourceCell.id)),
      'internal-opening-traversal-mismatch', `${link.id} does not physically pair ${sourceCell.id} with ${targetCell.id}`);
      referencedInternalFrames.add(boundary.id);
    }
  }

  for (const cell of cells.values()) {
    for (const side of SIDES) {
      invariant(coverage.has(`${cell.id}:${side}`), 'cell-face-open', `${cell.id}.${side} is open to unowned space`);
    }
  }

  for (const portal of portals.values()) {
    invariant(portal.from && portal.to, 'portal-unpaired', `${portal.id} must have from and to endpoints`);
    for (const endpointName of ['from', 'to']) {
      const endpoint = portal[endpointName];
      const cell = cells.get(endpoint.cellId);
      const boundary = boundaries.get(endpoint.boundaryId);
      const side = canonicalSide(endpoint.side);
      invariant(cell && boundary, 'portal-endpoint-missing', `${portal.id}.${endpointName} references a missing cell or frame`);
      invariant(endpoint.regionId === cell.regionId, 'portal-region-mismatch', `${portal.id}.${endpointName} region does not match its cell`);
      invariant(boundary.kind === 'portal-frame', 'portal-frame-missing', `${portal.id}.${endpointName} is not attached to a portal frame`);
      invariant(boundary.cellId === cell.id && canonicalSide(boundary.side) === side,
        'portal-frame-seam', `${portal.id}.${endpointName} does not align with its frame`);
      vector3(endpoint.center, `${portal.id}.${endpointName}.center`);
      invariant(endpoint.dimensions && ['width', 'height', 'depth'].every((key) => Number.isFinite(endpoint.dimensions[key]) && endpoint.dimensions[key] > 0),
        'portal-dimensions-invalid', `${portal.id}.${endpointName} has invalid dimensions`);
      const openingId = endpoint.openingId ?? endpoint.apertureId ?? `${portal.id}:${endpoint.regionId}`;
      const opening = (boundary.openings ?? []).find((candidate) => candidate && typeof candidate === 'object' && (
        candidate.id === openingId || candidate.portalId === portal.id
      ));
      invariant(opening, 'portal-opening-missing', `${portal.id}.${endpointName} has no authored aperture in ${boundary.id}`);
      const openingCenter = vector3(opening.center, `${boundary.id}.${openingId}.center`);
      const endpointCenter = vector3(endpoint.center, `${portal.id}.${endpointName}.center`);
      invariant(Math.hypot(
        openingCenter.x - endpointCenter.x,
        openingCenter.y - endpointCenter.y,
        openingCenter.z - endpointCenter.z,
      ) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
      'portal-opening-misaligned', `${portal.id}.${endpointName} aperture center does not match its endpoint`);
      invariant(['width', 'height', 'depth'].every((key) => Math.abs(opening.dimensions?.[key] - endpoint.dimensions[key]) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance),
        'portal-opening-misaligned', `${portal.id}.${endpointName} aperture dimensions do not match its endpoint`);
      referencedFrames.add(boundary.id);
    }
    invariant(typeof portal.connectorForm === 'string' && portal.connectorForm.length > 0,
      'portal-form-missing', `${portal.id} has no connector form`);
    invariant(typeof portal.placementBucket === 'string' && portal.placementBucket.length > 0,
      'portal-placement-missing', `${portal.id} has no placement bucket`);
    invariant(portal.traversal && portal.traversal.enabled !== false,
      'portal-traversal-missing', `${portal.id} has no traversable contract`);
    invariant(regions.has(portal.visibleDestinationRegionId), 'portal-visible-destination-missing', `${portal.id} looks into an unowned destination`);

    const route = portal.physicalRoute ?? portal.traversal?.physicalRoute ?? null;
    const portalRouteCellIds = route?.cellIds ?? portal.connectorCellIds ?? [];
    const fromCell = cells.get(portal.from.cellId);
    const toCell = cells.get(portal.to.cellId);
    const directlyAdjacent = boundsTouchOrOverlap(fromCell.bounds, toCell.bounds);
    invariant(directlyAdjacent || portalRouteCellIds.length > 0,
      'portal-physical-route-missing', `${portal.id} has separated endpoints without authored connector cells`);
    const routeCells = portalRouteCellIds.map((cellId) => cells.get(cellId));
    invariant(routeCells.every(Boolean), 'portal-route-cell-missing', `${portal.id} references a missing connector cell`);
    const chain = [fromCell, ...routeCells, toCell];
    for (let index = 1; index < chain.length; index += 1) {
      invariant(boundsTouchOrOverlap(chain[index - 1].bounds, chain[index].bounds),
        'portal-route-cell-gap', `${portal.id} has a physical gap between ${chain[index - 1].id} and ${chain[index].id}`);
    }
    const routeSurfaceIds = new Set(route?.surfaceIds ?? []);
    for (const routeCell of routeCells) {
      invariant((routeCell.connectorForPortalId ?? routeCell.portalId) === portal.id,
        'portal-route-cell-owner', `${routeCell.id} is not exclusively owned by ${portal.id}`);
      if ((portal.traversal?.mode ?? portal.approachType) !== 'intentional-drop') {
        invariant(plan.walkableSurfaces.some((surface) => surface.cellId === routeCell.id && (!routeSurfaceIds.size || routeSurfaceIds.has(surface.id))),
          'portal-route-surface-missing', `${routeCell.id} has no authored traversable surface`);
      }
    }
    for (const boundaryId of route?.boundaryIds ?? []) {
      invariant(boundaries.has(boundaryId), 'portal-route-boundary-missing', `${portal.id} references missing connector boundary ${boundaryId}`);
    }
  }

  for (const boundary of boundaries.values()) {
    if (boundary.kind === 'portal-frame') {
      const connectorOpening = boundary.connector === true
        && (boundary.openings ?? []).every((opening) => opening && typeof opening === 'object' && portals.has(opening.portalId));
      invariant(referencedFrames.has(boundary.id) || referencedInternalFrames.has(boundary.id) || connectorOpening,
        'unused-portal-frame', `${boundary.id} exposes an unused opening`);
    }
  }

  for (const socket of plan.sockets ?? []) {
    invariant(socket.status === 'paired' || (socket.status === 'capped' && boundaries.has(socket.capBoundaryId)),
      'unused-socket', `${socket.id ?? '<socket>'} is neither paired nor structurally capped`);
  }

  const interiorCells = [...cells.values()];
  for (let index = 0; index < interiorCells.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < interiorCells.length; otherIndex += 1) {
      const a = interiorCells[index];
      const b = interiorCells[otherIndex];
      const aCompoundId = a.compoundSpaceId ?? a.compoundId;
      const bCompoundId = b.compoundSpaceId ?? b.compoundId;
      if (aCompoundId && aCompoundId === bCompoundId) continue;
      const ab = bounds3(a.bounds, a.id);
      const bb = bounds3(b.bounds, b.id);
      const overlaps = ab.min.x < bb.max.x && ab.max.x > bb.min.x
        && ab.min.y < bb.max.y && ab.max.y > bb.min.y
        && ab.min.z < bb.max.z && ab.max.z > bb.min.z;
      const connectorEndpointOverlap = (connectorCell, otherCell) => {
        if (!connectorCell.connector || !connectorCell.portalId) return false;
        const portal = portals.get(connectorCell.portalId);
        return portal && (portal.from.cellId === otherCell.id || portal.to.cellId === otherCell.id);
      };
      invariant(!overlaps || connectorEndpointOverlap(a, b) || connectorEndpointOverlap(b, a),
        'independent-cell-overlap', `${a.id} independently overlaps ${b.id}`);
    }
  }

  return Object.freeze({ cells: cells.size, boundaries: boundaries.size, portals: portals.size });
}

export function assertWalkableSurfaceContracts(plan) {
  const regions = uniqueById(plan.regions, 'regions');
  const cells = uniqueById(plan.spatialCells, 'spatialCells');
  const boundaries = uniqueById(plan.structuralBoundaries, 'structuralBoundaries');
  const fixtures = uniqueById(plan.structuralFixtures, 'structuralFixtures');
  const surfaces = uniqueById(plan.walkableSurfaces, 'walkableSurfaces');
  const samePoint = (left, right, tolerance = 0.001) => Math.hypot(
    Number(left?.x) - Number(right?.x),
    Number(left?.y) - Number(right?.y),
    Number(left?.z) - Number(right?.z),
  ) <= tolerance;
  const containsPointSequence = (route, sequence) => Array.isArray(route)
    && route.some((point, startIndex) => sequence.every((expected, offset) => (
      samePoint(route[startIndex + offset], expected)
    )));
  const horizontallyOverlaps = (left, right, tolerance = 0) => (
    left.min.x < right.max.x - tolerance
      && left.max.x > right.min.x + tolerance
      && left.min.z < right.max.z - tolerance
      && left.max.z > right.min.z + tolerance
  );
  const pointOnSurfaceTop = (point, candidate, tolerance = ACCEPTANCE_LIMITS.surfaceHeightTolerance) => {
    const bounds = bounds3(candidate.bounds, `${candidate.id} ladder landing bounds`);
    return point.x >= bounds.min.x - tolerance && point.x <= bounds.max.x + tolerance
      && point.z >= bounds.min.z - tolerance && point.z <= bounds.max.z + tolerance
      && Math.abs(point.y - bounds.max.y) <= tolerance;
  };
  const collisionBoundsForFixture = (candidate) => {
    const authoredPieces = Array.isArray(candidate.colliderBounds)
      ? candidate.colliderBounds.filter((piece) => piece?.min && piece?.max)
      : [];
    return authoredPieces.length ? authoredPieces : [candidate.bounds];
  };
  const stairStripIntrudes = (candidate, clearanceBounds) => {
    const type = candidate.stairs ? 'stairs' : candidate.geometry?.type;
    if (!['stairs', 'walkable-stairs'].includes(type)) return null;
    const geometry = candidate.stairs ?? candidate.geometry;
    const path = geometry?.path ?? (geometry?.start && geometry?.end
      ? [geometry.start, geometry.end] : null);
    if (!Array.isArray(path) || path.length < 2 || !(Number(geometry.width) > 0)) return true;
    const start = path[0];
    const end = path.at(-1);
    const runX = end.x - start.x;
    const runZ = end.z - start.z;
    const runLength = Math.hypot(runX, runZ);
    if (runLength <= 0.001) return true;
    const directionX = runX / runLength;
    const directionZ = runZ / runLength;
    const sampleSpacing = Math.min(0.18, ACCEPTANCE_LIMITS.visualColliderSampleSpacing);
    const xSamples = Math.max(1, Math.ceil((clearanceBounds.max.x - clearanceBounds.min.x) / sampleSpacing));
    const zSamples = Math.max(1, Math.ceil((clearanceBounds.max.z - clearanceBounds.min.z) / sampleSpacing));
    for (let xIndex = 0; xIndex <= xSamples; xIndex += 1) {
      const x = clearanceBounds.min.x
        + (clearanceBounds.max.x - clearanceBounds.min.x) * xIndex / xSamples;
      for (let zIndex = 0; zIndex <= zSamples; zIndex += 1) {
        const z = clearanceBounds.min.z
          + (clearanceBounds.max.z - clearanceBounds.min.z) * zIndex / zSamples;
        const along = (x - start.x) * directionX + (z - start.z) * directionZ;
        const lateral = Math.abs((x - start.x) * -directionZ + (z - start.z) * directionX);
        if (along < -sampleSpacing || along > runLength + sampleSpacing
          || lateral > geometry.width * 0.5 + sampleSpacing) continue;
        const ratio = Math.min(1, Math.max(0, along / runLength));
        const stairY = start.y + (end.y - start.y) * ratio;
        if (stairY > clearanceBounds.min.y + 0.01
          && stairY < clearanceBounds.max.y - 0.01) return true;
      }
    }
    return false;
  };
  const surfaceIntrudesClearance = (candidate, clearanceBounds) => {
    const stairIntrusion = stairStripIntrudes(candidate, clearanceBounds);
    // Exact stair strips are traversable support, not blocking volumes. Their
    // oriented collision and height continuity are proven independently and
    // the assembled ladder proof must physically walk across any shared seam.
    // A broad stair AABB must never reject a valid landing as overhead clutter.
    if (stairIntrusion !== null) return false;
    return candidate.bounds.min.y < clearanceBounds.max.y - 0.01
      && candidate.bounds.max.y > clearanceBounds.min.y + 0.01
      && horizontallyOverlaps(clearanceBounds, candidate.bounds, 0.001);
  };
  for (const surface of surfaces.values()) {
    const cell = cells.get(surface.cellId);
    invariant(regions.has(surface.regionId) && cell, 'surface-owner-missing', `${surface.id} has no playable owner`);
    invariant(typeof surface.purpose === 'string' && surface.purpose.length > 0 && surface.purpose !== 'decorative' && surface.purpose !== 'none',
      'surface-purpose-missing', `${surface.id} has no gameplay purpose`);
    invariant(colliderEnabled(surface.collision), 'surface-collider-missing', `${surface.id} has no collision`);
    invariant(Array.isArray(surface.supportBoundaryIds) && surface.supportBoundaryIds.length > 0,
      'surface-support-missing', `${surface.id} has no visible structural support`);
    for (const supportId of surface.supportBoundaryIds) {
      invariant(boundaries.has(supportId), 'surface-support-missing', `${surface.id} references missing support ${supportId}`);
    }
    const surfaceBounds = bounds3(surface.bounds, `surface ${surface.id}`);
    const cellBounds = bounds3(cell.bounds, `cell ${cell.id}`);
    const isStairOrLadder = ['stairs', 'walkable-stairs', 'ladder'].includes(surface.geometry?.type)
      || /(?:stair|ladder)/i.test(`${surface.id} ${surface.purpose}`);
    if (surface.geometry?.type === 'ladder') {
      const geometry = surface.geometry;
      invariant(Array.isArray(geometry.path) && geometry.path.length >= 2
        && Array.isArray(geometry.planePath)
        && geometry.planePath.length === geometry.path.length,
      'ladder-plane-contract-missing', `${surface.id} requires distinct ladder-plane and player-root paths`);
      const climbFacing = vector3(geometry.climbFacing, `${surface.id}.climbFacing`);
      const planeNormal = vector3(geometry.planeNormal, `${surface.id}.planeNormal`);
      const facingLength = Math.hypot(climbFacing.x, climbFacing.z);
      const normalLength = Math.hypot(planeNormal.x, planeNormal.z);
      invariant(Math.abs(facingLength - 1) <= 0.001
        && Math.abs(normalLength - 1) <= 0.001
        && Math.abs(climbFacing.y) <= 0.001
        && Math.abs(planeNormal.y) <= 0.001
        && climbFacing.x * planeNormal.x + climbFacing.z * planeNormal.z <= -0.999,
      'ladder-facing-contract-invalid', `${surface.id} plane normal must exactly oppose its climb facing`);
      invariant(Number.isFinite(geometry.bodyClearance)
        && geometry.bodyClearance >= 0.35
        && geometry.bodyClearance <= 0.65,
      'ladder-body-clearance-invalid', `${surface.id} requires an authored 0.35m-0.65m root-to-plane clearance`);
      for (let index = 0; index < geometry.path.length; index += 1) {
        const rootPoint = vector3(geometry.path[index], `${surface.id}.path[${index}]`);
        const planePoint = vector3(geometry.planePath[index], `${surface.id}.planePath[${index}]`);
        const deltaX = rootPoint.x - planePoint.x;
        const deltaZ = rootPoint.z - planePoint.z;
        const normalDistance = deltaX * planeNormal.x + deltaZ * planeNormal.z;
        const tangentDistance = Math.abs(deltaX * -planeNormal.z + deltaZ * planeNormal.x);
        invariant(Math.abs(rootPoint.y - planePoint.y) <= 0.001
          && Math.abs(normalDistance - geometry.bodyClearance) <= 0.01
          && tangentDistance <= 0.01,
        'ladder-root-plane-clearance-mismatch', `${surface.id} root path intersects or drifts from its visual ladder plane`);
      }
      const bottomPath = geometry.path[0].y <= geometry.path.at(-1).y
        ? geometry.path[0] : geometry.path.at(-1);
      const topPath = geometry.path[0].y > geometry.path.at(-1).y
        ? geometry.path[0] : geometry.path.at(-1);
      const opening = geometry.topOpening;
      invariant(opening?.kind && opening?.bounds
        && opening.minimumClearWidth >= 1.6
        && opening.minimumClearDepth >= 0.7
        && surfaces.has(opening.playableBelowSurfaceId),
      'ladder-top-opening-missing', `${surface.id} requires a real, playable top opening`);
      const openingBounds = bounds3(opening.bounds, `${surface.id}.topOpening.bounds`);
      invariant(topPath.x >= openingBounds.min.x && topPath.x <= openingBounds.max.x
        && topPath.z >= openingBounds.min.z && topPath.z <= openingBounds.max.z,
      'ladder-top-opening-misaligned', `${surface.id} top root does not pass through its opening`);
      const coveringSurfaces = [...surfaces.values()].filter((candidate) => (
        candidate.id !== surface.id
        && Math.abs(candidate.bounds.max.y - topPath.y) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance
        && horizontallyOverlaps(openingBounds, candidate.bounds, 0.001)
      ));
      invariant(coveringSurfaces.length === 0,
        'ladder-top-opening-covered', `${surface.id} is hidden beneath solid walkable flooring`, {
          coveringSurfaceIds: coveringSurfaces.map(({ id }) => id),
          openingBounds,
        });

      const landingEntries = [
        ['bottom', geometry.landings?.bottom, bottomPath, geometry.bottomExit, geometry.bottomExitFacing],
        ['top', geometry.landings?.top, topPath, geometry.topExit, geometry.topExitFacing],
      ];
      for (const [landingName, landing, pathPoint, exitPointValue, exitFacingValue] of landingEntries) {
        const landingSurface = surfaces.get(landing?.surfaceId);
        const exitPoint = vector3(exitPointValue, `${surface.id}.${landingName}Exit`);
        const exitFacing = vector3(exitFacingValue, `${surface.id}.${landingName}ExitFacing`);
        const egressDirection = vector3(landing?.egressDirection, `${surface.id}.${landingName}.egressDirection`);
        const facingLength = Math.hypot(exitFacing.x, exitFacing.z);
        const egressLength = Math.hypot(egressDirection.x, egressDirection.z);
        invariant(landingSurface
          && landing.minimumClearLength >= ACCEPTANCE_LIMITS.minimumLandingWidth
          && landing.minimumClearWidth >= ACCEPTANCE_LIMITS.minimumLandingWidth
          && landing.minimumHeadroom >= ACCEPTANCE_LIMITS.minimumHeadroom,
        'ladder-landing-contract-missing', `${surface.id} requires a full ${landingName} landing contract`);
        invariant(Math.abs(facingLength - 1) <= 0.001
          && Math.abs(egressLength - 1) <= 0.001
          && Math.abs(exitFacing.y) <= 0.001
          && Math.abs(egressDirection.y) <= 0.001
          && exitFacing.x * egressDirection.x + exitFacing.z * egressDirection.z >= 0.999,
        'ladder-exit-facing-invalid', `${surface.id} ${landingName} dismount must face its walk-away route`);
        invariant(pointOnSurfaceTop(exitPoint, landingSurface),
          'ladder-landing-unsupported', `${surface.id} ${landingName} exit is not on ${landingSurface?.id ?? 'a surface'}`);
        invariant(Math.abs(pathPoint.y - landingSurface.bounds.max.y) <= 0.001
          && Math.abs(exitPoint.y - landingSurface.bounds.max.y) <= 0.001,
        'ladder-landing-height-mismatch', `${surface.id} ${landingName} root and exit must exactly match ${landingSurface.id}'s physical floor height`);
        invariant(Math.hypot(
          exitPoint.x - landing.exit.x,
          exitPoint.y - landing.exit.y,
          exitPoint.z - landing.exit.z,
        ) <= 0.001, 'ladder-landing-exit-mismatch', `${surface.id} ${landingName} landing exit diverges from its runtime exit`);

        const corridorEnd = {
          x: exitPoint.x + egressDirection.x * landing.minimumClearLength,
          y: exitPoint.y,
          z: exitPoint.z + egressDirection.z * landing.minimumClearLength,
        };
        // Sweep the actual player capsule (plus a small construction margin),
        // while separately requiring the authored landing to declare the full
        // 1.2m usable width. Using the whole landing rectangle as a capsule
        // falsely collided with nearby diagonal stairs outside the player's
        // physical path.
        const halfWidth = Math.min(
          landing.minimumClearWidth * 0.5,
          PLAYER_TRAVERSAL_ENVELOPE.collisionRadius + 0.04,
        );
        const clearanceBounds = {
          min: {
            x: Math.min(pathPoint.x, corridorEnd.x) - halfWidth,
            y: exitPoint.y + 0.05,
            z: Math.min(pathPoint.z, corridorEnd.z) - halfWidth,
          },
          max: {
            x: Math.max(pathPoint.x, corridorEnd.x) + halfWidth,
            y: exitPoint.y + landing.minimumHeadroom,
            z: Math.max(pathPoint.z, corridorEnd.z) + halfWidth,
          },
        };
        const fixtureIntrusions = [...fixtures.values()].filter((candidate) => (
          collisionBoundsForFixture(candidate).some((piece) => (
            boundsTouchOrOverlap(clearanceBounds, piece, -0.01)
          ))
        ));
        const overheadSurfaceIntrusions = [...surfaces.values()].filter((candidate) => (
          candidate.id !== surface.id
          && candidate.id !== landingSurface.id
          && surfaceIntrudesClearance(candidate, clearanceBounds)
        ));
        const solidBoundaryIntrusions = [...boundaries.values()].filter((candidate) => (
          colliderEnabled(candidate.collision ?? candidate.collider)
          && (candidate.openings ?? []).length === 0
          && !landingSurface.supportBoundaryIds?.includes(candidate.id)
          && candidate.bounds.min.y < clearanceBounds.max.y - 0.01
          && candidate.bounds.max.y > clearanceBounds.min.y + 0.01
          && horizontallyOverlaps(clearanceBounds, candidate.bounds, 0.001)
        ));
        invariant(fixtureIntrusions.length === 0
          && overheadSurfaceIntrusions.length === 0
          && solidBoundaryIntrusions.length === 0,
          'ladder-landing-egress-blocked', `${surface.id} ${landingName} landing is not walk-away clear`, {
            fixtureIds: fixtureIntrusions.map(({ id }) => id),
            surfaceIds: overheadSurfaceIntrusions.map(({ id }) => id),
            boundaryIds: solidBoundaryIntrusions.map(({ id }) => id),
            clearanceBounds,
          });
      }

      const bottomRoot = geometry.path[0].y <= geometry.path.at(-1).y
        ? geometry.path[0] : geometry.path.at(-1);
      const topRoot = geometry.path[0].y > geometry.path.at(-1).y
        ? geometry.path[0] : geometry.path.at(-1);
      const ascendingRoute = [geometry.bottomExit, bottomRoot, topRoot, geometry.topExit];
      const descendingRoute = [...ascendingRoute].reverse();
      const internalRoutes = (plan.traversalLinks ?? [])
        .filter((link) => link.viaSurfaceId === surface.id)
        .map((link) => link.waypoints ?? link.routePoints)
        .filter(Array.isArray);
      const connectorRoutes = (plan.portals ?? [])
        .filter((portal) => portal.physicalRoute?.surfaceIds?.includes(surface.id))
        .map((portal) => portal.physicalRoute?.routePoints)
        .filter(Array.isArray);
      invariant([...internalRoutes, ...connectorRoutes].some((route) => (
        containsPointSequence(route, ascendingRoute)
          || containsPointSequence(route, descendingRoute)
      )), 'ladder-navigation-route-missing', `${surface.id} has no plan-owned exit/mount/root/exit navigation sequence`);
    }
    const needsPhysicalFixtureSupport = surface.collision === 'dynamic'
      || (!isStairOrLadder && surfaceBounds.min.y - cellBounds.min.y > 0.5);
    if (needsPhysicalFixtureSupport) {
      invariant(Array.isArray(surface.supportFixtureIds) && surface.supportFixtureIds.length > 0,
        'surface-physical-support-missing', `${surface.id} is dynamic/elevated but has no real colliding support fixture`);
      for (const fixtureId of surface.supportFixtureIds) {
        const fixture = fixtures.get(fixtureId);
        invariant(fixture && colliderEnabled(fixture.collision),
          'surface-physical-support-missing', `${surface.id} references missing or non-colliding support fixture ${fixtureId}`);
      }
    }
  }
}

export function assertSafeAnchorParity(plan) {
  const surfaces = uniqueById(plan.walkableSurfaces, 'walkableSurfaces');
  const authoredAnchors = uniqueById([...(plan.anchors ?? []), ...plan.safeAnchors], 'anchors');
  const required = new Map(plan.safeAnchors.map((anchor) => [anchor.id, anchor]));
  const playerStartId = plan.compatibility?.playerStartAnchorId;
  invariant(typeof playerStartId === 'string' && authoredAnchors.has(playerStartId),
    'player-start-anchor-missing', 'compatibility.playerStartAnchorId must reference an authored anchor');
  required.set(playerStartId, authoredAnchors.get(playerStartId));
  for (const anchor of required.values()) {
    const surfaceId = anchor.surfaceId ?? anchor.safeSurfaceId;
    const surface = surfaces.get(surfaceId);
    invariant(surface, 'safe-anchor-surface-missing', `${anchor.id} references missing walkable surface ${surfaceId}`);
    const position = vector3(anchor.position, `${anchor.id}.position`);
    const bounds = bounds3(surface.bounds, `${surface.id} bounds`);
    invariant(position.x >= bounds.min.x - ACCEPTANCE_LIMITS.surfaceHeightTolerance
      && position.x <= bounds.max.x + ACCEPTANCE_LIMITS.surfaceHeightTolerance
      && position.z >= bounds.min.z - ACCEPTANCE_LIMITS.surfaceHeightTolerance
      && position.z <= bounds.max.z + ACCEPTANCE_LIMITS.surfaceHeightTolerance
      && Math.abs(position.y - bounds.max.y) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
    'safe-anchor-surface-misaligned', `${anchor.id} must lie on the sampled top of ${surface.id} within 0.05m`);
  }
}

export function assertStructuralFixtureContracts(plan) {
  const regions = uniqueById(plan.regions, 'regions');
  const cells = uniqueById(plan.spatialCells, 'spatialCells');
  const boundaries = uniqueById(plan.structuralBoundaries, 'structuralBoundaries');
  for (const fixture of uniqueById(plan.structuralFixtures, 'structuralFixtures').values()) {
    invariant(regions.has(fixture.regionId) && cells.has(fixture.cellId),
      'fixture-owner-missing', `${fixture.id} has no authored region/cell owner`);
    invariant(typeof (fixture.purpose ?? fixture.gameplayPurpose) === 'string'
      && (fixture.purpose ?? fixture.gameplayPurpose).length > 0,
    'fixture-purpose-missing', `${fixture.id} has no functional purpose`);
    invariant(fixture.collision !== false || fixture.accessibility === 'inaccessible',
      'fixture-collider-missing', `${fixture.id} is reachable but has no collision`);
    invariant(Array.isArray(fixture.supportBoundaryIds) && fixture.supportBoundaryIds.length > 0,
      'fixture-support-missing', `${fixture.id} has no visible support contract`);
    for (const supportId of fixture.supportBoundaryIds) {
      invariant(boundaries.has(supportId), 'fixture-support-missing', `${fixture.id} references missing support ${supportId}`);
    }
    bounds3(fixture.bounds, `fixture ${fixture.id}`);
  }
}

export function assertTraversalLinkContracts(plan) {
  const surfaces = uniqueById(plan.walkableSurfaces, 'walkableSurfaces');
  const links = uniqueById(plan.traversalLinks, 'traversalLinks');
  const anchors = new Map([...(plan.anchors ?? []), ...plan.safeAnchors].map((anchor) => [anchor.id, anchor]));
  const startAnchor = anchors.get(plan.compatibility?.playerStartAnchorId)
    ?? plan.safeAnchors.find((anchor) => anchor.isPlayerStart || anchor.purpose === 'player-start');
  const startSurfaceId = startAnchor?.surfaceId ?? startAnchor?.safeSurfaceId;
  invariant(startSurfaceId && surfaces.has(startSurfaceId),
    'traversal-start-surface-missing', 'player start requires an authored supporting surface');
  const outgoing = new Map([...surfaces.keys()].map((id) => [id, []]));
  for (const link of links.values()) {
    invariant(surfaces.has(link.fromSurfaceId) && surfaces.has(link.toSurfaceId),
      'traversal-link-surface-missing', `${link.id} references a missing walkable surface`);
    invariant(typeof link.mode === 'string' && link.mode.length > 0,
      'traversal-link-mode-missing', `${link.id} has no physical traversal mode`);
    const chain = [link.fromSurfaceId, link.viaSurfaceId, link.toSurfaceId].filter(Boolean);
    if (link.viaSurfaceId) {
      invariant(surfaces.has(link.viaSurfaceId), 'traversal-link-surface-missing', `${link.id} references missing via surface ${link.viaSurfaceId}`);
    }
    for (let index = 1; index < chain.length; index += 1) outgoing.get(chain[index - 1]).push(chain[index]);
    if (link.bidirectional !== false && link.direction !== 'forward-only') {
      for (let index = chain.length - 1; index > 0; index -= 1) outgoing.get(chain[index]).push(chain[index - 1]);
    }
  }
  const visit = (start) => {
    const visited = new Set([start]);
    const queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const next of outgoing.get(queue[cursor]) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return visited;
  };
  const reachable = visit(startSurfaceId);
  const unreachable = [...surfaces.keys()].filter((id) => !reachable.has(id));
  invariant(unreachable.length === 0, 'traversal-surfaces-unreachable', `${unreachable.length} walkable surfaces lack a physical route from spawn`, unreachable);
  const stranded = [...surfaces.keys()].filter((id) => !visit(id).has(startSurfaceId));
  invariant(stranded.length === 0, 'traversal-surfaces-stranded', `${stranded.length} walkable surfaces lack a damage-free return`, stranded);
}

export function assertPlayableLowerAreas(plan, journeyProof = null) {
  const regions = uniqueById(plan.regions, 'regions');
  const portals = uniqueById(plan.portals, 'portals');
  const actions = uniqueById(plan.actions, 'actions');
  const surfaces = uniqueById(plan.walkableSurfaces, 'walkableSurfaces');
  const anchors = uniqueById([...(plan.anchors ?? []), ...plan.safeAnchors], 'anchors');
  for (const fall of uniqueById(plan.falls, 'falls').values()) {
    const targetRegionId = fall.targetRegionId ?? fall.targetCatchmentRegionId;
    const catchment = fall.catchment ?? fall.landingDimensions;
    const returnPortalIds = [fall.returnPortalId, ...(fall.returnPortalIds ?? [])].filter(Boolean);
    const sourcePortal = portals.get(fall.sourcePortalId);
    const sourceSurfaceId = fall.sourceSurfaceId
      ?? sourcePortal?.physicalRoute?.endpointSurfaceIds?.from;
    const sourceSurface = surfaces.get(sourceSurfaceId);
    const catchmentSurface = surfaces.get(fall.catchmentSurfaceId);
    const safeAnchor = anchors.get(fall.safeAnchorId);
    invariant(fall.bottomless !== true, 'bottomless-fall', `${fall.id} is bottomless`);
    invariant(fall.playableDestination !== false && regions.has(targetRegionId), 'fall-target-missing', `${fall.id} does not land in a playable region`);
    invariant(fall.damageFree === true, 'fall-damaging', `${fall.id} is not damage-free`);
    invariant(catchment && catchment.width >= ACCEPTANCE_LIMITS.minimumLandingWidth,
      'fall-catchment-narrow', `${fall.id} catchment is too narrow`);
    invariant(catchment.headroom >= ACCEPTANCE_LIMITS.minimumHeadroom,
      'fall-catchment-headroom', `${fall.id} catchment has insufficient headroom`);
    invariant(returnPortalIds.some((id) => portals.has(id)) || (fall.returnActionId && actions.has(fall.returnActionId)),
      'fall-return-missing', `${fall.id} has no physical return contract`);
    invariant(sourcePortal && sourceSurface,
      'fall-source-surface-missing', `${fall.id} does not resolve its source aperture to a walkable surface`);
    invariant(catchmentSurface && catchmentSurface.regionId === targetRegionId
      && catchmentSurface.collision !== false && catchmentSurface.collision !== 'none',
    'fall-catchment-surface-missing', `${fall.id} has no colliding authored catchment in ${targetRegionId}`);
    invariant(safeAnchor
      && (safeAnchor.surfaceId ?? safeAnchor.safeSurfaceId) === catchmentSurface?.id,
    'fall-safe-anchor-mismatch', `${fall.id} safe anchor is not owned by its catchment surface`);

    const trajectory = bounds3(fall.trajectoryBounds, `${fall.id} trajectory`);
    const sourceBounds = bounds3(sourceSurface.bounds, `${fall.id} source surface`);
    const catchmentBounds = bounds3(catchmentSurface.bounds, `${fall.id} catchment surface`);
    const sourcePoint = sourcePortal?.from?.center ?? {
      x: (sourceBounds.min.x + sourceBounds.max.x) * 0.5,
      y: sourceBounds.max.y,
      z: (sourceBounds.min.z + sourceBounds.max.z) * 0.5,
    };
    const landingPoint = {
      x: (catchmentBounds.min.x + catchmentBounds.max.x) * 0.5,
      y: catchmentBounds.max.y,
      z: (catchmentBounds.min.z + catchmentBounds.max.z) * 0.5,
    };
    const containsPoint = (bounds, point, tolerance = ACCEPTANCE_LIMITS.surfaceHeightTolerance) => (
      point.x >= bounds.min.x - tolerance && point.x <= bounds.max.x + tolerance
      && point.y >= bounds.min.y - tolerance && point.y <= bounds.max.y + tolerance
      && point.z >= bounds.min.z - tolerance && point.z <= bounds.max.z + tolerance
    );
    invariant(containsPoint(trajectory, sourcePoint),
      'fall-trajectory-misses-source', `${fall.id} trajectory does not begin at its authored aperture/source surface`);
    invariant(containsPoint(trajectory, landingPoint),
      'fall-trajectory-misses-catchment', `${fall.id} trajectory stops before or beside the exact catchment top`);
    invariant(sourceBounds.max.y - catchmentBounds.max.y >= 1,
      'fall-does-not-descend', `${fall.id} does not physically descend below its source`);
    invariant(plan.traversalLinks.some((link) => (
      (link.fromSurfaceId === catchmentSurface.id || link.toSurfaceId === catchmentSurface.id)
      && link.mode !== 'intentional-drop'
      && link.bidirectional !== false
      && link.damageFree === true
    )), 'fall-return-link-missing', `${fall.id} catchment has no damage-free physical return link`);

    if (journeyProof) {
      const proof = journeyProof.falls?.find((entry) => entry.id === fall.id);
      invariant(proof?.publicInputOnly === true,
        'fall-public-journey-missing', `${fall.id} was not exercised through keyboard/mouse traversal`);
      invariant(proof.stoodOnIntact === true && proof.cracksVisible === true,
        'crumble-warning-unobserved', `${fall.id} did not visibly crack under the player's weight`);
      invariant(proof.collisionDisabled === true && proof.rootDescendedBelowSource === true,
        'crumble-collapse-not-physical', `${fall.id} did not disable collision and physically lower the player root`);
      invariant(proof.landed === true
        && Math.abs(proof.landingY - catchmentBounds.max.y) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
      'fall-catchment-landing-mismatch', `${fall.id} did not land on the exact authored catchment top`);
      invariant(Math.abs(Number(proof.damageDelta)) <= 0.0001,
        'fall-journey-damage', `${fall.id} changed player health during its damage-free fall`);
      invariant(proof.physicallyReturned === true,
        'fall-physical-return-missing', `${fall.id} was not physically traversed back from`);
      invariant(proof.automaticReset === true,
        'crumble-automatic-reset-unobserved', `${fall.id} did not automatically restore visual and collision state`);
      invariant(Number(proof.safeguardActivations) === 0
        && Number(proof.unauthorizedFallCorrections) === 0
        && Number(proof.silentSafeCorrections) === 0,
      'fall-silent-recovery-used', `${fall.id} relied on safeguard or last-safe correction instead of its authored trajectory`);
    }
  }
  for (const view of plan.visibilityLinks ?? []) {
    if (!(Number(view.elevationDelta) < 0)) continue;
    invariant(regions.has(view.targetRegionId), 'visible-lower-area-unowned', `${view.id} looks into a non-playable lower area`);
    invariant(view.returnPortalId || view.returnActionId, 'visible-lower-return-missing', `${view.id} has no return route`);
    if (journeyProof) {
      const proof = journeyProof.downwardViews?.find((item) => item.id === view.id);
      invariant(proof?.visited === true && proof?.returned === true, 'visible-lower-journey-missing', `${view.id} was not physically visited and returned from`);
      invariant(proof.landingWidth >= ACCEPTANCE_LIMITS.minimumLandingWidth && proof.headroom >= ACCEPTANCE_LIMITS.minimumHeadroom,
        'visible-lower-clearance', `${view.id} failed landing clearance`);
      invariant(Math.abs(proof.renderCollisionHeightDelta) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
        'visible-lower-parity', `${view.id} render/collision height differs`);
    }
  }
}

export function assertContinuousPortalRoutes(plan, assembly, providedProofs = null) {
  const routeProofs = providedProofs ?? assembly?.connectorRouteProofs;
  invariant(Array.isArray(routeProofs), 'portal-route-proof-missing', 'assembled fixture requires connector route proofs');
  const proofByPortal = uniqueById(routeProofs.map((proof) => ({ ...proof, id: proof.portalId ?? proof.id })), 'connectorRouteProofs');
  invariant(proofByPortal.size === plan.portals.length, 'portal-route-proof-count', 'every portal requires exactly one route proof');
  for (const portal of plan.portals) {
    const proof = proofByPortal.get(portal.id);
    invariant(proof, 'portal-route-proof-missing', `${portal.id} has no continuous physical route proof`);
    invariant(proof.sampleSpacing <= ACCEPTANCE_LIMITS.visualColliderSampleSpacing,
      'portal-route-sampling-coarse', `${portal.id} route sampling exceeds 0.21m`);
    invariant(proof.continuous === true && proof.traversable === true,
      'portal-route-disconnected', `${portal.id} is not physically continuous and traversable`);
    invariant(proof.enclosed === true && proof.supported === true,
      'portal-route-unenclosed', `${portal.id} lacks enclosed, supported connector structure`);
    const mode = portal.traversal?.mode ?? portal.approachType;
    if (mode !== 'ladder' && mode !== 'intentional-drop') {
      invariant(proof.walkable === true, 'portal-route-not-walkable', `${portal.id} has no continuous walkable route`);
    }
    invariant(proof.minimumWidth >= (portal.traversal?.minimumWidth ?? 0),
      'portal-route-width', `${portal.id} route is narrower than its traversal contract`);
    invariant(proof.minimumHeadroom >= (portal.traversal?.minimumHeadroom ?? 0),
      'portal-route-headroom', `${portal.id} route lacks required headroom`);
    const approachProofs = uniqueById((proof.approachClearanceVolumes ?? []).map((entry) => ({
      ...entry,
      id: entry.endpoint,
    })), `${portal.id}.approachClearanceVolumes`);
    invariant(approachProofs.size === 2 && approachProofs.has('from') && approachProofs.has('to'),
      'portal-approach-proof-count', `${portal.id} requires clearance proofs on both sides of its opening`);
    for (const endpointName of ['from', 'to']) {
      const approach = approachProofs.get(endpointName);
      invariant(approach.declaredBy === 'portal-endpoint-traversal-contract'
        && approach.sampleSpacing <= ACCEPTANCE_LIMITS.visualColliderSampleSpacing
        && approach.bounds?.min && approach.bounds?.max
        && Number(approach.width) >= Number(portal.traversal?.minimumWidth ?? 0)
        && Number(approach.headroom) >= Number(portal.traversal?.minimumHeadroom ?? 0),
      'portal-approach-proof-invalid', `${portal.id}:${endpointName} lacks its declared production clearance volume`, approach);
      invariant(Array.isArray(approach.structuralFixtureIntrusions)
        && approach.structuralFixtureIntrusions.length === 0,
      'portal-approach-structural-fixture', `${portal.id}:${endpointName} has a structural fixture in its passage approach`, approach.structuralFixtureIntrusions);
      invariant(Array.isArray(approach.interactionIntrusions)
        && approach.interactionIntrusions.length === 0,
      'portal-approach-interaction', `${portal.id}:${endpointName} has an interaction console in its passage approach`, approach.interactionIntrusions);
      invariant(Array.isArray(approach.colliderIntrusions)
        && approach.colliderIntrusions.length === 0,
      'portal-approach-collider', `${portal.id}:${endpointName} has an active collider in clear space`, approach.colliderIntrusions);
      invariant(approach.accepted === true,
        'portal-approach-rejected', `${portal.id}:${endpointName} rejected its approach clearance volume`, approach);
    }
    invariant(proof.approachClearanceAccepted === true,
      'portal-approach-rejected', `${portal.id} does not have clear physical approaches on both sides`);
    for (const [field, code] of [
      ['uncoveredSamples', 'portal-route-uncovered'],
      ['blockedSamples', 'portal-route-blocked'],
      ['visualColliderMismatches', 'portal-route-parity'],
    ]) {
      invariant(Array.isArray(proof[field]) && proof[field].length === 0,
        code, `${portal.id} ${field} must be empty`, proof[field]);
    }
  }
}

function planRegistryEntry(registry, id) {
  if (registry instanceof Map) return registry.get(id);
  return registry?.[id];
}

function hasReference(entry, kind) {
  if (!entry) return false;
  const singular = entry[kind] ?? entry[`${kind}Id`];
  const plural = entry[`${kind}s`] ?? entry[`${kind}Ids`];
  return Boolean(singular) || (Array.isArray(plural) && plural.length > 0) || (plural instanceof Set && plural.size > 0);
}

function referenceIds(entry, kind) {
  if (!entry) return [];
  const singular = entry[kind] ?? entry[`${kind}Id`];
  const plural = entry[`${kind}s`] ?? entry[`${kind}Ids`];
  return [singular, ...(Array.isArray(plural) ? plural : plural instanceof Set ? [...plural] : [])].filter(Boolean);
}

export function assertStructuralRegistryParity(plan, assembly, proof) {
  invariant(assembly?.structuralRegistry?.byPlanId, 'structural-registry-missing', 'assembled fixture requires structuralRegistry.byPlanId');
  const expected = [...plan.structuralBoundaries, ...plan.walkableSurfaces, ...(plan.structuralFixtures ?? [])];
  for (const item of expected) {
    const entry = planRegistryEntry(assembly.structuralRegistry.byPlanId, item.id);
    invariant(hasReference(entry, 'visual'), 'structural-visual-missing', `${item.id} has no registered visual`);
    const requiresCollider = item.collision !== false || item.accessibility !== 'inaccessible';
    if (requiresCollider) {
      invariant(hasReference(entry, 'collider'), 'structural-collider-missing', `${item.id} has no registered collider`);
    }
    for (const visualId of referenceIds(entry, 'visual')) {
      invariant(planRegistryEntry(assembly.structuralRegistry.visuals, visualId), 'structural-visual-dangling', `${item.id} references missing visual ${visualId}`);
    }
    for (const colliderId of referenceIds(entry, 'collider')) {
      invariant(planRegistryEntry(assembly.structuralRegistry.colliders, colliderId), 'structural-collider-dangling', `${item.id} references missing collider ${colliderId}`);
    }
  }
  const diagnostics = Array.isArray(assembly.structuralDiagnostics) ? assembly.structuralDiagnostics : [];
  const errors = diagnostics.filter((item) => item?.severity === 'error' || item?.level === 'error');
  invariant(errors.length === 0, 'structural-runtime-diagnostic', `assembly reported ${errors.length} structural errors`, errors);
  invariant(proof && proof.sampleSpacing <= ACCEPTANCE_LIMITS.visualColliderSampleSpacing,
    'visual-collider-proof-missing', 'visual/collider parity must be sampled at 0.21m or finer');
  for (const [field, code] of [
    ['mismatches', 'visual-collider-mismatch'],
    ['transparentStructuralIds', 'transparent-structural-shell'],
    ['unregisteredVisualIds', 'unregistered-structural-visual'],
    ['unregisteredColliderIds', 'unregistered-structural-collider'],
  ]) {
    invariant(Array.isArray(proof[field]) && proof[field].length === 0, code, `${field} must be empty`, proof[field]);
  }
  const physical = proof.physicalClearance;
  const internalLinks = plan.traversalLinks.filter((link) => !link.portalId);
  const selectableActions = plan.actions.filter((action) => action.interaction?.activationSide !== 'system');
  invariant(physical?.proofId === 'assembled-player-capsule-v1'
    && physical.sampleSpacing <= ACCEPTANCE_LIMITS.visualColliderSampleSpacing
    && physical.capsuleRadius >= 0.42
    && physical.capsuleHeight >= ACCEPTANCE_LIMITS.minimumHeadroom,
  'internal-traversal-clearance-proof-missing', 'assembly requires an independent production-size player-capsule proof');
  const linkProofs = uniqueById((physical.linkProofs ?? []).map((entry) => ({
    ...entry,
    id: entry.linkId ?? entry.id,
  })), 'internalTraversalClearanceProofs');
  invariant(physical.internalLinkCount === internalLinks.length && linkProofs.size === internalLinks.length,
    'internal-traversal-clearance-proof-count', 'every and only non-portal traversal links require a capsule-clearance proof');
  for (const link of internalLinks) {
    const linkProof = linkProofs.get(link.id);
    invariant(linkProof
      && linkProof.sampleSpacing <= ACCEPTANCE_LIMITS.visualColliderSampleSpacing
      && linkProof.capsuleRadius >= 0.42
      && linkProof.capsuleHeight >= ACCEPTANCE_LIMITS.minimumHeadroom,
    'internal-traversal-clearance-proof-missing', `${link.id} lacks a production-size capsule proof`);
    invariant(linkProof.accepted === true
      && Array.isArray(linkProof.endpointMismatches) && linkProof.endpointMismatches.length === 0
      && Array.isArray(linkProof.uncoveredSamples) && linkProof.uncoveredSamples.length === 0
      && Array.isArray(linkProof.blockedSamples) && linkProof.blockedSamples.length === 0,
    'internal-traversal-physically-blocked', `${link.id} is not physically executable by the player capsule`, linkProof);
  }
  const actionProofs = uniqueById((physical.actionProofs ?? []).map((entry) => ({
    ...entry,
    id: entry.actionId ?? entry.id,
  })), 'actionApproachClearanceProofs');
  invariant(physical.selectableActionCount === selectableActions.length && actionProofs.size === selectableActions.length,
    'action-approach-clearance-proof-count', 'every and only player-selectable actions require a capsule-clearance proof');
  for (const action of selectableActions) {
    const actionProof = actionProofs.get(action.id);
    invariant(actionProof
      && actionProof.sampleSpacing <= ACCEPTANCE_LIMITS.visualColliderSampleSpacing
      && actionProof.capsuleRadius >= 0.42
      && actionProof.capsuleHeight >= ACCEPTANCE_LIMITS.minimumHeadroom,
    'action-approach-clearance-proof-missing', `${action.id} lacks a production-size capsule approach proof`);
    invariant(actionProof.accepted === true
      && actionProof.approach
      && actionProof.supportSurfaceId
      && Array.isArray(actionProof.blockedSamples) && actionProof.blockedSamples.length === 0,
    'action-approach-physically-blocked', `${action.id} has no physically clear supported activation approach`, actionProof);
  }
  invariant(physical.accepted === true
    && Array.isArray(physical.blockedLinks) && physical.blockedLinks.length === 0
    && Array.isArray(physical.blockedActions) && physical.blockedActions.length === 0,
  'physical-clearance-proof-rejected', 'assembled player-capsule proof rejected the fixture', physical);

  const ladderRuntime = proof.ladderRuntime;
  const runtimeLadders = assembly.ladders ?? [];
  invariant(ladderRuntime?.proofId === 'assembled-ladder-public-input-v1'
    && ladderRuntime.ladderCount === runtimeLadders.length
    && Array.isArray(ladderRuntime.ladderProofs)
    && ladderRuntime.ladderProofs.length === runtimeLadders.length,
  'ladder-runtime-proof-missing', 'every assembled ladder requires a public-controller runtime proof');
  const ladderProofById = uniqueById(ladderRuntime.ladderProofs.map((entry) => ({
    ...entry,
    id: entry.ladderId,
  })), 'ladderRuntimeProofs');
  for (const ladder of runtimeLadders) {
    const ladderProof = ladderProofById.get(ladder.id);
    invariant(ladderProof && Array.isArray(ladderProof.directions),
      'ladder-runtime-proof-missing', `${ladder.id} has no runtime traversal proof`);
    const directionProofs = uniqueById(ladderProof.directions.map((entry) => ({
      ...entry,
      id: entry.direction,
    })), `${ladder.id}.directionProofs`);
    invariant(directionProofs.size === 2 && directionProofs.has('up') && directionProofs.has('down'),
      'ladder-runtime-direction-proof-missing', `${ladder.id} requires ascent and descent proofs`);
    for (const [direction, exitName] of [['up', 'top'], ['down', 'bottom']]) {
      const directionProof = directionProofs.get(direction);
      invariant(directionProof.publicControllerInteraction === true
        && directionProof.publicPlayerUpdate === true
        && directionProof.inputCodes?.length === 1
        && directionProof.inputCodes[0] === (direction === 'up' ? 'KeyW' : 'KeyS')
        && directionProof.promptFound === true
        && directionProof.mounted === true,
      'ladder-runtime-mount-failed', `${ladder.id} could not mount from its ${direction === 'up' ? 'bottom' : 'top'} through public interaction`, directionProof);
      invariant(directionProof.finiteFrames === true
        && directionProof.climbingFrames > 1
        && directionProof.climbedSpan >= directionProof.authoredSpan - 0.1,
      'ladder-runtime-climb-failed', `${ladder.id} did not physically climb its authored span with ${directionProof.inputCodes[0]}`, directionProof);
      invariant(directionProof.planeAlignment?.accepted === true
        && directionProof.planeAlignment.sampleCount > 1
        && directionProof.planeAlignment.bodyClearance >= 0.35
        && directionProof.planeAlignment.maximumPlaneClearanceError <= 0.01
        && directionProof.planeAlignment.minimumFacingAlignment >= 0.999
        && directionProof.planeAlignment.visualPlaneMatchesRuntime === true,
      'ladder-runtime-plane-alignment-failed', `${ladder.id} intersects or faces away from its visual ladder plane`, directionProof.planeAlignment);
      invariant(directionProof.dismounted === true
        && directionProof.postDismountConstraintFrames >= 1
        && directionProof.exitDistance <= ACCEPTANCE_LIMITS.surfaceHeightTolerance + 0.001,
      `ladder-runtime-${exitName}-dismount-failed`, `${ladder.id} did not remain on its authored ${exitName} exit after collision resolution`, directionProof);
      const egress = directionProof.egress;
      invariant(egress?.publicPlayerUpdate === true
        && egress.publicControllerConstraint === true
        && egress.inputCodes?.length === 1
        && egress.inputCodes[0] === 'KeyW'
        && egress.jumpInputUsed === false
        && egress.exitName === exitName
        && egress.landingSurfaceId
        && Number.isFinite(egress.authoredClearLength)
        && egress.authoredClearLength >= ACCEPTANCE_LIMITS.minimumLandingWidth,
      `ladder-runtime-${exitName}-egress-proof-missing`, `${ladder.id} lacks an authored no-jump ${exitName} landing-egress proof`, egress);
      invariant(egress.accepted === true
        && egress.finiteFrames === true
        && egress.remainedGrounded === true
        && egress.supportLost === false
        && egress.snapBackDetected === false
        && egress.maximumHorizontalConstraintCorrection <= 0.025
        && egress.maximumProjectedDistance + 0.001 >= egress.authoredClearLength
        && egress.frameCount > 0
        && egress.frameCount < egress.maximumFrames
        && Number(egress.safeguardActivations) === 0,
      `ladder-runtime-${exitName}-egress-blocked`, `${ladder.id} cannot walk away from its ${exitName} landing without jumping or collision correction`, egress);
      invariant(Number(directionProof.safeguardActivations) === 0,
        'ladder-runtime-safeguard-used', `${ladder.id} relied on the recovery safeguard`, directionProof);
    }
    invariant(ladderProof.accepted === true,
      'ladder-runtime-proof-rejected', `${ladder.id} rejected its public-input ladder proof`, ladderProof);
  }
  invariant(ladderRuntime.accepted === true
    && Array.isArray(ladderRuntime.rejectedLadders)
    && ladderRuntime.rejectedLadders.length === 0,
  'ladder-runtime-proof-rejected', 'one or more assembled ladders are not physically usable', ladderRuntime.rejectedLadders);
}

function nearVector(left, right, tolerance = ACCEPTANCE_LIMITS.surfaceHeightTolerance) {
  return left && right && ['x', 'y', 'z'].every((axis) => (
    Number.isFinite(left[axis]) && Number.isFinite(right[axis])
    && Math.abs(left[axis] - right[axis]) <= tolerance
  ));
}

function stairPlanarGap(point, bounds) {
  const dx = point.x < bounds.min.x ? bounds.min.x - point.x
    : point.x > bounds.max.x ? point.x - bounds.max.x : 0;
  const dz = point.z < bounds.min.z ? bounds.min.z - point.z
    : point.z > bounds.max.z ? point.z - bounds.max.z : 0;
  return Math.hypot(dx, dz);
}

function stairPlanarInset(point, bounds) {
  return Math.min(
    point.x - bounds.min.x,
    bounds.max.x - point.x,
    point.z - bounds.min.z,
    bounds.max.z - point.z,
  );
}

function colliderTopCovers(collider, point, expectedTop) {
  const bounds = collider?.bounds ?? (collider?.position ? {
    min: {
      x: collider.position.x - collider.halfWidth,
      y: collider.position.y - collider.verticalHalfHeight,
      z: collider.position.z - collider.halfDepth,
    },
    max: {
      x: collider.position.x + collider.halfWidth,
      y: collider.position.y + collider.verticalHalfHeight,
      z: collider.position.z + collider.halfDepth,
    },
  } : null);
  return bounds
    && point.x >= bounds.min.x - 0.001 && point.x <= bounds.max.x + 0.001
    && point.z >= bounds.min.z - 0.001 && point.z <= bounds.max.z + 0.001
    && Math.abs(bounds.max.y - expectedTop) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance;
}

function nearBounds(left, right, tolerance = ACCEPTANCE_LIMITS.surfaceHeightTolerance) {
  return left && right
    && nearVector(left.min, right.min, tolerance)
    && nearVector(left.max, right.max, tolerance);
}

function exactRuntimeIds(actual, expected, code, label) {
  invariant(Array.isArray(actual), code, `${label} must be an array`);
  const actualIds = actual.map((entry) => entry?.id);
  invariant(actualIds.every((id) => typeof id === 'string' && id.length > 0)
    && new Set(actualIds).size === actualIds.length,
  code, `${label} requires unique stable IDs`, actualIds);
  const expectedIds = expected.map((entry) => entry.id);
  invariant(actualIds.length === expectedIds.length
    && expectedIds.every((id) => actualIds.includes(id)),
  code, `${label} IDs do not exactly match the accepted plan`, { actualIds, expectedIds });
  return new Map(actual.map((entry) => [entry.id, entry]));
}

function isStairSurface(surface) {
  return Boolean(
    surface.stairs
    || surface.form === 'stairs'
    || ['stairs', 'walkable-stairs'].includes(surface.geometry?.type)
    || surface.shape === 'ramp-tile',
  );
}

function isLadderSurface(surface) {
  return surface.geometry?.type === 'ladder';
}

/**
 * Independently reconstructs the navigable line for a serialized native V1
 * ramp tile. The acceptance oracle deliberately derives its centre and X/Z
 * dimensions from bounds instead of trusting the assembler-facing
 * `center`/`size` duplicates. A drift between those contracts must therefore
 * fail facade parity rather than being repeated by both producer and oracle.
 */
export function deriveExpectedNativeRampTileProfile(surface) {
  invariant(surface?.shape === 'ramp-tile' && surface.ramp,
    'facade-ramp-contract-missing', 'native ramp facade proof requires shape="ramp-tile" and ramp data');
  const bounds = bounds3(surface.bounds, `${surface.id ?? '<native-ramp>'} facade ramp bounds`);
  const directionX = Number(surface.ramp.direction?.x);
  const directionZ = Number(surface.ramp.direction?.z);
  const directionLength = Math.hypot(directionX, directionZ);
  invariant(Number.isFinite(directionLength) && directionLength > 1e-9,
    'facade-ramp-direction-invalid', `${surface.id ?? '<native-ramp>'} requires a finite non-zero X/Z direction`);
  const direction = {
    x: directionX / directionLength,
    z: directionZ / directionLength,
  };
  const startY = Number(surface.ramp.startY);
  const endY = Number(surface.ramp.endY);
  invariant(Number.isFinite(startY) && Number.isFinite(endY),
    'facade-ramp-level-invalid', `${surface.id ?? '<native-ramp>'} requires finite startY/endY`);
  const sizeX = bounds.max.x - bounds.min.x;
  const sizeZ = bounds.max.z - bounds.min.z;
  invariant(sizeX > 1e-9 && sizeZ > 1e-9,
    'facade-ramp-footprint-invalid', `${surface.id ?? '<native-ramp>'} requires a positive X/Z footprint`);
  const center = {
    x: (bounds.min.x + bounds.max.x) * 0.5,
    z: (bounds.min.z + bounds.max.z) * 0.5,
  };
  const runsAlongX = Math.abs(direction.x) >= Math.abs(direction.z);
  const length = runsAlongX ? sizeX : sizeZ;
  const width = runsAlongX ? sizeZ : sizeX;
  return {
    start: {
      x: center.x - direction.x * length * 0.5,
      y: startY,
      z: center.z - direction.z * length * 0.5,
    },
    end: {
      x: center.x + direction.x * length * 0.5,
      y: endY,
      z: center.z + direction.z * length * 0.5,
    },
    length,
    width,
    direction,
  };
}

function expectedFloorTileRecords(plan) {
  const tileSize = plan.tileSize ?? 1.4;
  const records = new Map();
  const ladderOpenings = plan.walkableSurfaces
    .filter((surface) => isLadderSurface(surface) && surface.geometry.topOpening?.bounds)
    .map((surface) => ({
      ladderSurfaceId: surface.id,
      bounds: bounds3(surface.geometry.topOpening.bounds, `${surface.id} ladder opening`),
    }));
  for (const surface of plan.walkableSurfaces) {
    if (surface.collision === 'dynamic' || isLadderSurface(surface)) continue;
    const bounds = bounds3(surface.bounds, `${surface.id} compatibility tile bounds`);
    const minTileX = Math.ceil((bounds.min.x - tileSize * 0.5) / tileSize);
    const maxTileX = Math.floor((bounds.max.x + tileSize * 0.5) / tileSize);
    const minTileZ = Math.ceil((bounds.min.z - tileSize * 0.5) / tileSize);
    const maxTileZ = Math.floor((bounds.max.z + tileSize * 0.5) / tileSize);
    let stairs = isStairSurface(surface)
      ? (surface.stairs ?? surface.geometry ?? surface)
      : null;
    if (surface.shape === 'ramp-tile') {
      const nativeRamp = deriveExpectedNativeRampTileProfile(surface);
      stairs = {
        path: [nativeRamp.start, nativeRamp.end],
        width: nativeRamp.width,
      };
    }
    const path = stairs?.path ?? (stairs?.start && stairs?.end ? [stairs.start, stairs.end] : null);
    let stairProfile = null;
    if (stairs && path?.length >= 2) {
      const start = path[0];
      const end = path[path.length - 1];
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      stairProfile = {
        start,
        end,
        length,
        direction: { x: (end.x - start.x) / length, z: (end.z - start.z) / length },
        width: stairs.width,
      };
    }
    for (let x = minTileX; x <= maxTileX; x += 1) {
      for (let z = minTileZ; z <= maxTileZ; z += 1) {
        const worldX = x * tileSize;
        const worldZ = z * tileSize;
        if (worldX < bounds.min.x - tileSize * 0.45
          || worldX > bounds.max.x + tileSize * 0.45
          || worldZ < bounds.min.z - tileSize * 0.45
          || worldZ > bounds.max.z + tileSize * 0.45) continue;
        if (stairProfile) {
          const offsetX = worldX - stairProfile.start.x;
          const offsetZ = worldZ - stairProfile.start.z;
          const along = offsetX * stairProfile.direction.x + offsetZ * stairProfile.direction.z;
          const lateral = Math.abs(offsetX * -stairProfile.direction.z + offsetZ * stairProfile.direction.x);
          if (along < -tileSize * 0.45
            || along > stairProfile.length + tileSize * 0.45
            || lateral > stairProfile.width * 0.5 + tileSize * 0.45) continue;
        }
        let elevation = bounds.max.y;
        if (stairProfile) {
          const distance = (worldX - stairProfile.start.x) * stairProfile.direction.x
            + (worldZ - stairProfile.start.z) * stairProfile.direction.z;
          const progress = Math.max(0, Math.min(1, distance / stairProfile.length));
          elevation = stairProfile.start.y
            + (stairProfile.end.y - stairProfile.start.y) * progress;
        }
        if (ladderOpenings.some((opening) => (
          elevation >= opening.bounds.min.y - ACCEPTANCE_LIMITS.surfaceHeightTolerance
          && elevation <= opening.bounds.max.y + ACCEPTANCE_LIMITS.surfaceHeightTolerance
          && worldX >= opening.bounds.min.x
          && worldX <= opening.bounds.max.x
          && worldZ >= opening.bounds.min.z
          && worldZ <= opening.bounds.max.z
        ))) continue;
        const id = `${surface.id}:tile:${x}:${z}`;
        records.set(id, { id, x, z, elevation, surface });
      }
    }
  }
  return records;
}

function plainContractMatches(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Proves that the legacy-shaped runtime facade is a projection of the accepted
 * plan.  This deliberately checks exact IDs and independently-derived spatial
 * values rather than accepting collection lengths or mesh names as parity.
 */
export function assertCompatibilityFacadeParity(plan, facade) {
  invariant(facade && typeof facade === 'object',
    'facade-missing', 'assembled fixtures require the Dungeon V2 compatibility facade');
  invariant(facade.plan === plan
    && facade.planId === (plan.planId ?? plan.id)
    && facade.seed === plan.seed,
  'facade-source-parity', 'runtime facade is not bound to the exact accepted plan/seed');
  const tileSize = plan.tileSize ?? 1.4;
  const regionById = uniqueById(plan.regions, 'regions');
  const surfaceById = uniqueById(plan.walkableSurfaces, 'walkableSurfaces');
  const anchorById = uniqueById([...(plan.anchors ?? []), ...plan.safeAnchors], 'anchors');

  const roomById = exactRuntimeIds(facade.rooms, plan.regions,
    'facade-room-parity', 'facade.rooms');
  for (const region of plan.regions) {
    const room = roomById.get(region.id);
    const bounds = region.bounds;
    invariant(bounds && nearBounds(room.bounds, bounds)
      && room.stableRegionId === region.id
      && room.districtId === region.districtId
      && room.type === (region.type ?? region.semanticBeat ?? 'dungeonV2Region')
      && room.archetype === (region.label ?? region.displayName ?? region.id)
      && room.archetypeId === (region.archetypeId ?? region.id)
      && room.purpose === (region.purpose ?? region.functionalPurpose ?? region.semanticBeat ?? null)
      && room.environmentalStory === (region.environmentalStory ?? null)
      && room.flavorId === (region.flavorId ?? null)
      && room.minY === bounds.min.y
      && room.maxY === bounds.max.y
      && room.x === Math.round(((bounds.min.x + bounds.max.x) * 0.5) / tileSize)
      && room.z === Math.round(((bounds.min.z + bounds.max.z) * 0.5) / tileSize)
      && room.width === Math.max(1, Math.ceil((bounds.max.x - bounds.min.x) / tileSize))
      && room.depth === Math.max(1, Math.ceil((bounds.max.z - bounds.min.z) / tileSize)),
    'facade-room-parity', `${region.id} room geometry/identity is not plan-derived`, room);
  }
  const archetypeById = exactRuntimeIds(facade.roomArchetypes, plan.regions,
    'facade-room-parity', 'facade.roomArchetypes');
  for (const region of plan.regions) {
    const room = roomById.get(region.id);
    const archetype = archetypeById.get(region.id);
    invariant(archetype.archetypeId === room.archetypeId
      && archetype.purpose === room.purpose
      && archetype.districtId === region.districtId
      && archetype.minY === region.bounds.min.y
      && archetype.maxY === region.bounds.max.y,
    'facade-room-parity', `${region.id} room archetype is not plan-derived`, archetype);
  }

  const expectedTiles = expectedFloorTileRecords(plan);
  const ladderOpenings = plan.walkableSurfaces
    .filter((surface) => isLadderSurface(surface) && surface.geometry.topOpening?.bounds)
    .map((surface) => ({
      ladderSurfaceId: surface.id,
      bounds: bounds3(surface.geometry.topOpening.bounds, `${surface.id} ladder opening`),
    }));
  const tilesInsideLadderOpenings = (facade.floorTiles ?? []).filter((tile) => {
    const worldX = Number(tile.x) * tileSize;
    const worldZ = Number(tile.z) * tileSize;
    return ladderOpenings.some((opening) => (
      Number(tile.elevation) >= opening.bounds.min.y - ACCEPTANCE_LIMITS.surfaceHeightTolerance
      && Number(tile.elevation) <= opening.bounds.max.y + ACCEPTANCE_LIMITS.surfaceHeightTolerance
      && worldX >= opening.bounds.min.x
      && worldX <= opening.bounds.max.x
      && worldZ >= opening.bounds.min.z
      && worldZ <= opening.bounds.max.z
    ));
  });
  invariant(tilesInsideLadderOpenings.length === 0,
    'facade-floor-tile-covers-ladder-opening', 'floor-tile navigation metadata covers a real ladder aperture', {
      tileIds: tilesInsideLadderOpenings.map(({ id }) => id),
    });
  const tileById = exactRuntimeIds(facade.floorTiles, [...expectedTiles.values()],
    'facade-floor-tile-parity', 'facade.floorTiles');
  for (const [id, expected] of expectedTiles) {
    const tile = tileById.get(id);
    invariant(tile.surfaceId === expected.surface.id
      && tile.regionId === expected.surface.regionId
      && tile.roomId === expected.surface.regionId
      && tile.x === expected.x && tile.z === expected.z
      && Math.abs(tile.elevation - expected.elevation) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance
      && tile.gameplayPurpose === expected.surface.purpose,
    'facade-floor-tile-parity', `${id} is not the exact plan surface projection`, tile);
  }
  const expectedColumns = new Map();
  for (const expected of expectedTiles.values()) {
    const key = `${expected.x},${expected.z}`;
    const existing = expectedColumns.get(key);
    if (!existing || expected.elevation < existing.elevation) expectedColumns.set(key, expected);
  }
  const tileColumnMismatches = [...expectedColumns].flatMap(([key, expected]) => {
    const tile = facade.tiles?.get?.(key);
    return tile?.id === expected.id && tileById.get(tile.id) === tile
      ? []
      : [{
        key,
        expectedId: expected.id,
        expectedElevation: expected.elevation,
        actualId: tile?.id ?? null,
        actualElevation: tile?.elevation ?? null,
      }];
  });
  invariant(facade.tiles instanceof Map
    && facade.tiles.size === expectedColumns.size
    && tileColumnMismatches.length === 0,
  'facade-floor-tile-parity', 'facade.tiles does not exactly project the lowest authored surface in every tile column', {
    expectedColumnCount: expectedColumns.size,
    actualColumnCount: facade.tiles?.size ?? null,
    mismatches: tileColumnMismatches.slice(0, 24),
  });

  const expectedPlatformSurfaces = plan.walkableSurfaces.filter((surface) => (
    !isStairSurface(surface) && !isLadderSurface(surface)
  ));
  const platformById = exactRuntimeIds(facade.platforms, expectedPlatformSurfaces,
    'facade-platform-parity', 'facade.platforms');
  for (const surface of expectedPlatformSurfaces) {
    const platform = platformById.get(surface.id);
    const bounds = bounds3(surface.bounds, `${surface.id} platform bounds`);
    const center = {
      x: (bounds.min.x + bounds.max.x) * 0.5,
      y: (bounds.min.y + bounds.max.y) * 0.5,
      z: (bounds.min.z + bounds.max.z) * 0.5,
    };
    invariant(nearVector(platform.position, center)
      && platform.regionId === surface.regionId
      && platform.gameplayPurpose === surface.purpose
      && platform.dynamic === (surface.collision === 'dynamic')
      && Math.abs(platform.halfWidth - (bounds.max.x - bounds.min.x) * 0.5) <= 1e-6
      && Math.abs(platform.halfDepth - (bounds.max.z - bounds.min.z) * 0.5) <= 1e-6
      && Math.abs(platform.topY - bounds.max.y) <= 1e-6
      && plainContractMatches(platform.supportBoundaryIds, surface.supportBoundaryIds),
    'facade-platform-parity', `${surface.id} platform is not plan-derived`, platform);
  }

  const gateContracts = plan.progression?.gateContracts ?? [];
  const doorById = exactRuntimeIds(facade.doors, gateContracts,
    'facade-door-parity', 'facade.doors');
  const portalById = new Map(plan.portals.map((portal) => [portal.id, portal]));
  for (const gate of gateContracts) {
    const door = doorById.get(gate.id);
    const portal = portalById.get(gate.portalId);
    const anchor = anchorById.get(gate.anchorId);
    invariant(portal && anchor
      && door.portalId === gate.portalId
      && door.fromRoomId === (gate.fromRegionId ?? gate.fromRoomId ?? portal.from.regionId)
      && door.toRoomId === (gate.toRegionId ?? gate.toRoomId ?? portal.to.regionId)
      && door.v2ActionId === gate.actionId
      && door.v2BarrierId === (gate.barrierBoundaryId ?? gate.barrierId)
      && nearVector(door.interactionPosition, anchor.position),
    'facade-door-parity', `${gate.id} door is not plan-derived`, door);
  }

  const encounterById = exactRuntimeIds(facade.encounters, plan.encounters,
    'facade-encounter-parity', 'facade.encounters');
  for (const encounter of plan.encounters) {
    const runtime = encounterById.get(encounter.id);
    const anchor = anchorById.get(encounter.anchorId);
    const expectedPoints = encounter.spawnPattern?.points ?? encounter.spawnPoints ?? [];
    invariant(anchor
      && runtime.roomId === (encounter.regionId ?? anchor.regionId)
      && plainContractMatches(runtime.roster, encounter.roster
        ?? (Array.isArray(encounter.spawnPattern) ? encounter.spawnPattern : encounter.spawnPattern?.roster)
        ?? [])
      && runtime.spawnPoints.length === expectedPoints.length
      && runtime.spawnPoints.every((point, index) => nearVector(point, expectedPoints[index]))
      && runtime.isBoss === (encounter.kind === 'final-elite' || encounter.isBoss === true),
    'facade-encounter-parity', `${encounter.id} encounter is not plan-derived`, runtime);
  }

  const objectiveById = exactRuntimeIds(facade.objectives, plan.objectives,
    'facade-objective-parity', 'facade.objectives');
  for (const objective of plan.objectives) {
    const runtime = objectiveById.get(objective.id);
    const { complete, ...projected } = runtime;
    invariant(complete === false && plainContractMatches(projected, objective),
      'facade-objective-parity', `${objective.id} objective is not an exact plan clone`, runtime);
  }
  const rewardById = exactRuntimeIds(facade.rewards, plan.rewards,
    'facade-reward-parity', 'facade.rewards');
  for (const reward of plan.rewards) {
    const runtime = rewardById.get(reward.id);
    const anchor = anchorById.get(reward.anchorId);
    invariant(anchor && nearVector(runtime.position, anchor.position),
      'facade-reward-parity', `${reward.id} reward position is not plan-derived`, runtime);
  }

  const progression = facade.progression;
  invariant(progression && ['graphNodes', 'connections', 'keyContracts', 'gateContracts', 'objectiveIds', 'extractionActionId']
    .every((field) => plainContractMatches(progression[field] ?? null, plan.progression?.[field] ?? null)),
  'facade-progression-parity', 'facade.progression changed a plan-owned progression contract');
  const connectionById = exactRuntimeIds(progression.roomConnections ?? [],
    plan.progression?.connections ?? plan.portals,
    'facade-progression-parity', 'facade.progression.roomConnections');
  for (const [id, connection] of connectionById) {
    const portal = portalById.get(id);
    invariant(portal
      && connection.fromRoomId === portal.from.regionId
      && connection.toRoomId === portal.to.regionId
      && connection.routes?.length === 1
      && connection.routes[0].connectorType === portal.connectorForm,
    'facade-progression-parity', `${id} room connection is not plan-derived`, connection);
  }
  invariant(progression.entranceRoomId === (plan.progression?.entranceRoomId ?? plan.compatibility?.entranceRoomId)
    && progression.shrineRoomId === (plan.progression?.shrineRoomId ?? plan.compatibility?.shrineRoomId)
    && progression.bossRoomId === (plan.progression?.bossRoomId ?? plan.compatibility?.bossRoomId)
    && progression.minimap === facade.minimap,
  'facade-progression-parity', 'facade progression compatibility IDs/minimap are not plan-owned');
  const verticalConnectorById = exactRuntimeIds(facade.verticalConnectors, plan.portals,
    'facade-progression-parity', 'facade.verticalConnectors');
  for (const portal of plan.portals) {
    invariant(plainContractMatches(verticalConnectorById.get(portal.id), portal),
      'facade-progression-parity', `${portal.id} vertical connector is not an exact plan clone`);
  }
  const connectionPlanById = exactRuntimeIds(facade.connectionPlans, plan.portals,
    'facade-progression-parity', 'facade.connectionPlans');
  for (const portal of plan.portals) {
    const runtime = connectionPlanById.get(portal.id);
    invariant(runtime.fromRoomId === portal.from.regionId
      && runtime.toRoomId === portal.to.regionId
      && runtime.connectorType === portal.connectorForm
      && runtime.direction === portal.direction
      && runtime.elevation === portal.from.center.y,
    'facade-progression-parity', `${portal.id} connection plan is not plan-derived`, runtime);
  }

  const minimapRoomById = exactRuntimeIds(facade.minimap?.rooms, plan.minimap?.regions ?? [],
    'facade-minimap-parity', 'facade.minimap.rooms');
  for (const region of plan.minimap?.regions ?? []) {
    const runtime = minimapRoomById.get(region.id);
    invariant(runtime.roomId === region.id
      && runtime.districtId === region.districtId
      && runtime.bounds && nearBounds(runtime.bounds, region.bounds)
      && runtime.roomBounds2D
      && Math.abs(runtime.roomBounds2D.x - region.bounds.min.x / tileSize) <= 1e-6
      && Math.abs(runtime.roomBounds2D.z - region.bounds.min.z / tileSize) <= 1e-6
      && Math.abs(runtime.roomBounds2D.width
        - (region.bounds.max.x - region.bounds.min.x) / tileSize) <= 1e-6
      && Math.abs(runtime.roomBounds2D.depth
        - (region.bounds.max.z - region.bounds.min.z) / tileSize) <= 1e-6,
    'facade-minimap-parity', `${region.id} minimap room is not plan-derived`, runtime);
  }
  const minimapConnectionById = exactRuntimeIds(facade.minimap?.hallways,
    plan.minimap?.connections ?? [], 'facade-minimap-parity', 'facade.minimap.hallways');
  for (const connection of plan.minimap?.connections ?? []) {
    const runtime = minimapConnectionById.get(connection.id);
    invariant(runtime.fromRoomId === connection.fromRegionId
      && runtime.toRoomId === connection.toRegionId
      && runtime.direction === connection.direction,
    'facade-minimap-parity', `${connection.id} minimap connection is not plan-derived`, runtime);
  }
  const markerById = exactRuntimeIds(facade.minimap?.markers,
    plan.minimap?.staticMarkers ?? [], 'facade-minimap-parity', 'facade.minimap.markers');
  for (const marker of plan.minimap?.staticMarkers ?? []) {
    const runtime = markerById.get(marker.id);
    const anchor = marker.anchorId ? anchorById.get(marker.anchorId) : null;
    invariant(runtime.markerId === marker.id
      && runtime.markerType === (marker.markerType ?? marker.type)
      && nearVector(runtime.position, anchor?.position ?? marker.position),
    'facade-minimap-parity', `${marker.id} minimap marker is not plan-derived`, runtime);
  }

  const gateBarrierIds = new Set(gateContracts.map((gate) => (
    gate.barrierBoundaryId ?? gate.barrierId
  )).filter(Boolean));
  const expectedSolid = new Set();
  const expectedAerial = new Set();
  const registerExpected = (item, { solid, aerial }) => {
    const record = facade.structuralRegistry?.byPlanId?.get(item.id);
    for (const colliderId of record?.colliderIds ?? []) {
      const collider = facade.structuralRegistry.colliders.get(colliderId);
      if (solid) expectedSolid.add(collider);
      if (aerial) expectedAerial.add(collider);
    }
  };
  for (const boundary of plan.structuralBoundaries) {
    if (gateBarrierIds.has(boundary.id) || boundary.collider === false) continue;
    registerExpected(boundary, {
      solid: !['floor', 'ceiling'].includes(boundary.side),
      aerial: boundary.side !== 'floor',
    });
  }
  for (const fixture of plan.structuralFixtures) {
    if (fixture.collision === false) continue;
    registerExpected(fixture, { solid: true, aerial: fixture.blocksAerialTraversal !== false });
  }
  invariant(Array.isArray(facade.solidZones)
    && facade.solidZones.length === expectedSolid.size
    && facade.solidZones.every((zone) => expectedSolid.has(zone))
    && Array.isArray(facade.aerialBoundaryZones)
    && facade.aerialBoundaryZones.length === expectedAerial.size
    && facade.aerialBoundaryZones.every((zone) => expectedAerial.has(zone)),
  'facade-collision-zone-parity', 'facade collision zones do not exactly match registered plan colliders');

  const playerAnchor = anchorById.get(plan.compatibility?.playerStartAnchorId);
  const campAnchor = anchorById.get(plan.compatibility?.campReturnAnchorId);
  invariant(playerAnchor
    && nearVector(facade.playerStart, playerAnchor.position)
    && nearVector(facade.ruinEntryPosition, playerAnchor.position)
    && nearVector(facade.playerStartFacing, playerAnchor.forward ?? { x: 0, y: 0, z: 1 })
    && campAnchor && nearVector(facade.campReturnPosition, campAnchor.position),
  'facade-player-start-parity', 'player/camp anchors are not exact plan projections');

  const extractionAnchorId = plan.compatibility?.extractionAnchorId;
  const extractionAnchor = extractionAnchorId ? anchorById.get(extractionAnchorId) : null;
  const extractionAction = plan.actions.find((action) => action.type === 'extraction');
  invariant((!extractionAnchorId && facade.extractionPosition == null)
    || (extractionAnchor
      && facade.extractionAnchorId === extractionAnchorId
      && nearVector(facade.extractionPosition, extractionAnchor.position)
      && nearVector(facade.extractionVisualPosition, extractionAnchor.position)
      && facade.extractionActionId === (extractionAction?.id ?? null)),
  'facade-extraction-parity', 'extraction facade anchors/actions are not plan-derived');
}

export function assertStairAssemblyProofs(plan, assembly) {
  const surfaceById = uniqueById(plan.walkableSurfaces, 'walkableSurfaces');
  const stairSurfaces = plan.walkableSurfaces.filter((surface) => (
    surface.form === 'stairs'
    || ['stairs', 'walkable-stairs'].includes(surface.geometry?.type)
    || surface.stairs
  ));
  const proofs = uniqueById((assembly?.stairProofs ?? []).map((proof) => ({
    ...proof,
    id: proof.surfaceId ?? proof.id,
  })), 'stairProofs');
  invariant(proofs.size === stairSurfaces.length,
    'stair-proof-count', 'every and only authored stair surfaces require exact assembly proofs');
  for (const surface of stairSurfaces) {
    const proof = proofs.get(surface.id);
    const geometry = surface.stairs ?? surface.geometry ?? surface;
    const path = geometry.path ?? [geometry.start, geometry.end];
    invariant(proof && proof.accepted === true,
      'stair-proof-missing', `${surface.id} has no accepted assembled stair proof`);
    invariant(Number(proof.actualMaximumRiser) <= 0.18 + 1e-6
      && Number(proof.maximumRiser) <= 0.18 + 1e-6,
    'stair-visual-riser-too-high', `${surface.id} exceeds the 0.18m maximum visual riser`);
    invariant(Number(proof.actualTread) >= 0.45 - 1e-6
      && Number(proof.minimumTread) >= 0.45 - 1e-6,
    'stair-visual-tread-too-short', `${surface.id} has visual treads shorter than 0.45m`);
    invariant(Number.isInteger(proof.stepCount) && proof.stepCount > 0
      && proof.visualSteps?.length === proof.stepCount
      && proof.visualSteps.every((step) => (
        Number(step.riser) <= 0.18 + 1e-6 && Number(step.tread) >= 0.45 - 1e-6
      )), 'stair-visual-step-proof-invalid', `${surface.id} visual step geometry does not match its declared profile`);
    invariant(proof.continuousCollision === true
      && proof.collision?.type === 'continuous-sampled-ramp'
      && nearVector(proof.collision.origin, path[0])
      && nearVector(proof.collision.end, path[path.length - 1])
      && Math.abs(proof.collision.width - geometry.width) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
    'stair-collision-path-mismatch', `${surface.id} smooth collision does not follow the exact authored diagonal path/width`);
    invariant(proof.ledgeClimbDisabled === true && proof.collision.ledgeClimbDisabled === true,
      'stair-ledge-climb-enabled', `${surface.id} permits repeated ledge climbing on ordinary stairs`);
    invariant(Number(proof.collisionSampleSpacing) <= ACCEPTANCE_LIMITS.visualColliderSampleSpacing
      && proof.collisionSampleSpacing > 0
      && Array.isArray(proof.collisionSamples) && proof.collisionSamples.length > 0,
    'stair-collision-sampling-coarse', `${surface.id} exact collision was not sampled at 0.21m or finer`);

    const endpointIds = geometry.endpointSurfaceIds;
    const startDeck = surfaceById.get(endpointIds?.start);
    const endDeck = surfaceById.get(endpointIds?.end);
    invariant(startDeck && endDeck && startDeck.id !== surface.id && endDeck.id !== surface.id,
      'stair-endpoint-surface-missing', `${surface.id} does not bind both ends to physical deck surfaces`);
    const minimumOverlap = Math.max(1.2, Number(geometry.minimumEndpointOverlap ?? 1.2));
    const maximumHeightDelta = Math.min(
      ACCEPTANCE_LIMITS.surfaceHeightTolerance,
      Number(geometry.maximumEndpointHeightDelta ?? ACCEPTANCE_LIMITS.surfaceHeightTolerance),
    );
    const endpointChecks = [
      { role: 'start', point: path[0], deck: startDeck, deckDirection: -1 },
      { role: 'end', point: path[path.length - 1], deck: endDeck, deckDirection: 1 },
    ];
    for (const endpoint of endpointChecks) {
      invariant(Math.abs(endpoint.point.y - endpoint.deck.bounds.max.y) <= maximumHeightDelta + 1e-6
        && stairPlanarGap(endpoint.point, endpoint.deck.bounds) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance + 1e-6,
      'stair-endpoint-seam-gap', `${surface.id} ${endpoint.role} is not flush with ${endpoint.deck.id}`);
      const outwardDeckPoint = {
        x: endpoint.point.x + proof.direction.x * endpoint.deckDirection * minimumOverlap,
        y: endpoint.deck.bounds.max.y,
        z: endpoint.point.z + proof.direction.z * endpoint.deckDirection * minimumOverlap,
      };
      invariant(stairPlanarGap(outwardDeckPoint, endpoint.deck.bounds)
        <= ACCEPTANCE_LIMITS.surfaceHeightTolerance + 1e-6,
      'stair-endpoint-overlap-short', `${surface.id} ${endpoint.role} deck does not continue ${minimumOverlap}m outward from the exact ramp seam`);
      invariant(Number(geometry.width) >= 1.2 && Number(geometry.minimumUsableSeamWidth) >= 1.2,
        'stair-endpoint-width-narrow', `${surface.id} ${endpoint.role} has less than 1.2m usable seam width`);

      const deckRecord = planRegistryEntry(assembly.structuralRegistry.byPlanId, endpoint.deck.id);
      const deckColliders = referenceIds(deckRecord, 'collider')
        .map((id) => assembly.structuralRegistry.colliders.get(id));
      const spacing = Math.min(0.21, Number(proof.collisionSampleSpacing));
      const sampleCount = Math.max(1, Math.ceil(minimumOverlap / spacing));
      for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
        const distance = minimumOverlap * sampleIndex / sampleCount;
        const deckPoint = {
          x: endpoint.point.x + proof.direction.x * endpoint.deckDirection * distance,
          y: endpoint.deck.bounds.max.y,
          z: endpoint.point.z + proof.direction.z * endpoint.deckDirection * distance,
        };
        invariant(deckColliders.some((collider) => colliderTopCovers(collider, deckPoint, endpoint.deck.bounds.max.y)),
          'stair-endpoint-collision-gap', `${surface.id} ${endpoint.role} deck collision is discontinuous at ${distance.toFixed(3)}m`);
        const stairPoint = {
          x: endpoint.point.x - proof.direction.x * endpoint.deckDirection * distance,
          y: endpoint.point.y,
          z: endpoint.point.z - proof.direction.z * endpoint.deckDirection * distance,
        };
        invariant(assembly.isPositionOnExactStairSurface?.(surface.id, stairPoint, 0.001) === true,
          'stair-endpoint-collision-gap', `${surface.id} ${endpoint.role} ramp collision is discontinuous at ${distance.toFixed(3)}m`);
      }
    }

    const registryEntry = planRegistryEntry(assembly.structuralRegistry.byPlanId, surface.id);
    const colliders = referenceIds(registryEntry, 'collider')
      .map((id) => assembly.structuralRegistry.colliders.get(id));
    invariant(colliders.length > 0 && colliders.every((collider) => (
      collider?.surfaceType === 'exact-oriented-ramp-strip'
      && collider.ledgeClimbDisabled === true
      && Math.abs(collider.rampWidth - geometry.width) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance
    )), 'stair-collider-not-exact-strip', `${surface.id} is backed by a broad/AABB or ledge-triggering collider`);
    for (const sample of proof.collisionSamples) {
      const classifiedInside = assembly.isPositionOnExactStairSurface?.(surface.id, sample.position, 0.001);
      invariant(classifiedInside === sample.expectedInside,
        sample.expectedInside ? 'stair-collision-inside-gap' : 'stair-collision-outside-width',
        `${surface.id} exact collision misclassifies ${sample.sampleId}`);
      if (sample.expectedInside) {
        const elevation = assembly.getExactStairSurfaceElevationAt?.(sample.position, {
          maxVerticalGap: ACCEPTANCE_LIMITS.surfaceHeightTolerance,
          tolerance: 0.001,
        });
        invariant(Number.isFinite(elevation)
          && Math.abs(elevation - sample.position.y) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
        'stair-collision-height-mismatch', `${surface.id} smooth collision departs from its authored incline`);
      }
    }
  }
}

function portalElevation(portal, regionIds) {
  const values = [];
  for (const endpoint of [portal.from, portal.to]) {
    if (regionIds.has(endpoint.regionId)) values.push(vector3(endpoint.center, `${portal.id}.center`).y);
  }
  return values;
}

export function assertTopologyAndConnectorRules(plan, profile = plan.acceptanceProfile) {
  const regions = [...uniqueById(plan.regions, 'regions').values()];
  const placements = [...uniqueById(plan.modulePlacements, 'modulePlacements').values()];
  const portals = [...uniqueById(plan.portals, 'portals').values()];
  const descriptorUses = new Set();
  for (const placement of placements) {
    const key = `${placement.descriptorId}@${placement.revision}`;
    invariant(!descriptorUses.has(key), 'module-descriptor-reused', `${key} is used more than once`);
    descriptorUses.add(key);
  }
  const canDeriveSignatures = regions.every((region) => region.bounds?.min && region.bounds?.max)
    && Array.isArray(plan.spatialCells)
    && Array.isArray(plan.walkableSurfaces)
    && Array.isArray(plan.structuralFixtures)
    && Array.isArray(plan.mechanisms)
    && Array.isArray(plan.environmentStates)
    && Array.isArray(plan.falls)
    && Array.isArray(plan.traversalLinks);
  const derivedSignatures = canDeriveSignatures ? deriveDungeonTopologySignaturesV2(plan) : null;
  const signatures = new Set();
  for (const region of regions) {
    invariant(typeof region.topologySignature === 'string' && region.topologySignature.length > 0,
      'topology-signature-missing', `${region.id} has no normalized topology signature`);
    if (derivedSignatures) {
      invariant(region.topologySignature === derivedSignatures[region.id],
        'topology-signature-not-derived', `${region.id} claims ${region.topologySignature}, but its physical topology derives as ${derivedSignatures[region.id]}`);
    }
    invariant(!signatures.has(region.topologySignature), 'topology-signature-reused', `${region.id} repeats D4 topology ${region.topologySignature}`);
    signatures.add(region.topologySignature);
  }
  if (profile !== 'golden') return;

  invariant(regions.length === 17, 'golden-region-count', `golden complex has ${regions.length} regions instead of 17`);
  invariant(plan.districts.length === 3, 'golden-district-count', 'golden complex requires exactly three districts');
  for (const region of regions.filter((item) => item.landmark === true)) {
    const { min, max } = bounds3(region.bounds, `landmark ${region.id}`);
    const horizontal = [max.x - min.x, max.z - min.z].sort((a, b) => b - a);
    invariant(horizontal[0] >= 30 && horizontal[1] >= 20 && max.y - min.y >= 10,
      'landmark-volume-small', `${region.id} is smaller than 30x20x10m`);
  }

  const scopes = [
    ...plan.districts.map((district) => ({ id: `district:${district.id}`, regionIds: regions.filter((region) => region.districtId === district.id).map((region) => region.id) })),
    ...(plan.keycardZones ?? []).map((zone) => ({ id: `keycard-zone:${zone.id}`, regionIds: zone.regionIds })),
  ];
  invariant((plan.keycardZones ?? []).length === 3, 'keycard-zones-missing', 'golden complex requires Alpha, Beta, and Gamma exploration zones');
  for (const scope of scopes) {
    const regionIds = new Set(scope.regionIds);
    const scopedPortals = portals.filter((portal) => regionIds.has(portal.from.regionId) || regionIds.has(portal.to.regionId));
    const elevations = scopedPortals.flatMap((portal) => portalElevation(portal, regionIds));
    const buckets = new Set(scopedPortals.map((portal) => portal.placementBucket));
    const forms = new Set(scopedPortals.map((portal) => portal.connectorForm));
    invariant(elevations.length >= 2 && Math.max(...elevations) - Math.min(...elevations) >= ACCEPTANCE_LIMITS.minimumPortalElevationDelta,
      'scope-exit-elevation-flat', `${scope.id} lacks 3m exit-height variation`);
    invariant(buckets.size >= 2, 'scope-exit-placement-uniform', `${scope.id} lacks off-centre/placement variation`);
    invariant(forms.size >= 2, 'scope-connector-form-uniform', `${scope.id} lacks connector-form variation`);
  }

  const byId = new Map(portals.map((portal) => [portal.id, portal]));
  invariant(Array.isArray(plan.connectionOrder) && plan.connectionOrder.length === portals.length,
    'connection-order-missing', 'golden complex requires deterministic order for every portal');
  const ordered = plan.connectionOrder.map((id) => byId.get(id));
  invariant(ordered.every(Boolean) && new Set(plan.connectionOrder).size === portals.length,
    'connection-order-invalid', 'connectionOrder must name every portal exactly once');
  for (let index = 1; index < ordered.length; index += 1) {
    invariant(ordered[index - 1].connectorForm !== ordered[index].connectorForm,
      'connector-form-consecutive', `${ordered[index].connectorForm} appears consecutively`);
  }
  const counts = new Map();
  for (const portal of ordered) counts.set(portal.connectorForm, (counts.get(portal.connectorForm) ?? 0) + 1);
  for (const [form, count] of counts) {
    invariant(count / ordered.length <= ACCEPTANCE_LIMITS.maximumConnectorShare,
      'connector-form-excessive', `${form} occupies ${(count / ordered.length * 100).toFixed(1)}% of connections`);
  }
}

function assertRuntimeProofs(fixture, stage) {
  if (stage === 'plan' || stage === 'module') return;
  const assembly = fixture.assembly ?? fixture.facade;
  assertStructuralRegistryParity(fixture.plan, assembly, fixture.proofs?.visualCollider);
  assertContinuousPortalRoutes(fixture.plan, assembly, fixture.proofs?.portalRoutes);
  assertStairAssemblyProofs(fixture.plan, assembly);
  const offscreen = fixture.proofs?.offscreenStructuralRender;
  invariant(offscreen?.rendererId === 'deterministic-cpu-triangle-rasterizer-v1'
    && offscreen.maxRange >= ACCEPTANCE_LIMITS.cameraProofRange,
  'offscreen-render-proof-missing', 'assembled fixture requires deterministic 120m offscreen structural rendering');
  invariant(offscreen.opaqueTriangleCount > 0
    && offscreen.frameCount > 0
    && Array.isArray(offscreen.frames)
    && offscreen.frames.length === offscreen.frameCount
    && offscreen.frames.every((frame) => Number.isInteger(frame.backgroundPixelCount)
      && Number.isInteger(frame.renderedPixelCount)
      && typeof frame.rasterHash === 'string'),
  'offscreen-render-empty', 'offscreen proof must rasterize actual assembled structural triangles');
  invariant(Array.isArray(offscreen.clearFrames) && offscreen.clearFrames.length === 0,
    'offscreen-render-sees-void', 'offscreen structural render exposed background pixels', offscreen?.clearFrames);
  invariant(Array.isArray(offscreen.transparentStructuralIds) && offscreen.transparentStructuralIds.length === 0,
    'offscreen-render-transparent-shell', 'transparent structural material cannot satisfy enclosure', offscreen?.transparentStructuralIds);
  invariant(Array.isArray(offscreen.unpairedBoundarySamples) && offscreen.unpairedBoundarySamples.length === 0,
    'camera-envelope-unpaired-boundary', 'third-person camera containment required a non-physical cell-union fallback', offscreen?.unpairedBoundarySamples);
  const downward = offscreen.downwardVisibility;
  invariant(downward?.proofId === 'assembled-downward-raycast-v1'
    && downward.raycastDerived === true
    && downward.maxRange >= ACCEPTANCE_LIMITS.cameraProofRange
    && Number.isInteger(downward.raysCast) && downward.raysCast > 0,
  'downward-raycast-proof-missing', 'assembled fixture requires actual structural raycasts for downward-visible space');
  invariant(Array.isArray(downward.unresolvedLowerHits) && downward.unresolvedLowerHits.length === 0,
    'downward-visible-area-unowned', 'a rendered lower surface does not resolve to a registered playable walkable surface', downward?.unresolvedLowerHits);
  invariant(Array.isArray(downward.invalidLowerHits),
    'downward-raycast-proof-missing', 'downward proof requires explicit invalid-hit diagnostics');
  for (const hit of downward.invalidLowerHits) {
    invariant(hit.registeredPlayable === true,
      'downward-visible-area-unowned', `${hit.id ?? hit.sampleId} does not belong to a registered playable cell`, hit);
    invariant(hit.colliderActive === true,
      'downward-visible-surface-inactive', `${hit.id ?? hit.sampleId} has no active walkable collider`, hit);
    invariant(hit.landingWidth >= ACCEPTANCE_LIMITS.minimumLandingWidth,
      'downward-visible-landing-narrow', `${hit.id ?? hit.sampleId} is narrower than 1.2m`, hit);
    invariant(hit.ceilingHit === true && hit.headroom >= ACCEPTANCE_LIMITS.minimumHeadroom,
      'downward-visible-headroom', `${hit.id ?? hit.sampleId} lacks an enclosed 3.2m landing volume`, hit);
    invariant(Math.abs(hit.renderCollisionHeightDelta) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
      'downward-visible-parity', `${hit.id ?? hit.sampleId} render/collision landing heights differ`, hit);
  }
  invariant(downward.accepted === true,
    'downward-raycast-proof-rejected', 'assembled downward-visible-space proof rejected the fixture', downward);
  invariant(offscreen.accepted === true,
    'offscreen-render-rejected', 'offscreen structural renderer did not accept the assembled fixture');
  const mechanismProofs = fixture.proofs?.mechanismStates;
  invariant(Array.isArray(mechanismProofs),
    'mechanism-state-proofs-missing', 'assembled fixture requires every stable mechanism-state proof');
  const requiredMechanismStates = fixture.plan.mechanisms.flatMap((mechanism) => (
    (mechanism.states ?? [])
      .filter((state) => state.stable !== false)
      .map((state) => `${mechanism.id}:${state.id}`)
  ));
  const mechanismProofByState = new Map(mechanismProofs.map((proof) => (
    [`${proof.mechanismId}:${proof.stateId}`, proof]
  )));
  invariant(mechanismProofByState.size === mechanismProofs.length
    && mechanismProofs.length === requiredMechanismStates.length,
  'mechanism-state-proof-count', 'every and only stable mechanism states require assembly proofs');
  for (const stateKey of requiredMechanismStates) {
    const mechanismProof = mechanismProofByState.get(stateKey);
    invariant(mechanismProof?.accepted === true,
      'mechanism-state-proof-missing', `${stateKey} has no accepted assembled-state proof`);
    invariant(Array.isArray(mechanismProof.clearSpaceRays) && mechanismProof.clearSpaceRays.length === 0,
      'mechanism-state-exposes-void', `${mechanismProof.mechanismId}:${mechanismProof.stateId} exposes clear space`);
    invariant(Array.isArray(mechanismProof.visualColliderMismatches)
      && mechanismProof.visualColliderMismatches.length === 0,
    'mechanism-state-parity', `${stateKey} changes visual/collision structure inconsistently`);
    invariant(mechanismProof.controlsReachable === true,
      'mechanism-state-control-unreachable', `${stateKey} strands a required control`);
  }
  assertCompatibilityFacadeParity(fixture.plan, assembly);
  if (stage !== 'journey') return;
  const camera = fixture.proofs?.camera;
  invariant(camera && camera.maxRange >= ACCEPTANCE_LIMITS.cameraProofRange,
    'camera-proof-range', 'journey camera proof must cover the actual 120m range');
  invariant(Array.isArray(camera.clearSpaceRays) && camera.clearSpaceRays.length === 0,
    'camera-sees-void', 'journey camera observed unowned clear space', camera?.clearSpaceRays);
  for (const hit of downward.lowerHits.filter((entry) => entry.externallyVisible === true)) {
    const proof = camera.downwardViews?.find((entry) => (
      entry.id === hit.id || entry.targetSurfaceId === hit.targetSurfaceId
    ));
    invariant(proof?.visited === true && proof?.returned === true,
      'downward-visible-journey-missing', `${hit.id} was visible but not physically visited and returned from`, hit);
    invariant(proof.landingWidth >= ACCEPTANCE_LIMITS.minimumLandingWidth
      && proof.headroom >= ACCEPTANCE_LIMITS.minimumHeadroom,
    'downward-visible-journey-clearance', `${hit.id} lacked verified journey landing clearance`, proof);
    invariant(Math.abs(proof.renderCollisionHeightDelta) <= ACCEPTANCE_LIMITS.surfaceHeightTolerance,
      'downward-visible-journey-parity', `${hit.id} journey render/collision height differs`, proof);
  }
  assertPlayableLowerAreas(fixture.plan, camera);
  invariant(fixture.journey?.safeguardActivations === 0, 'safeguard-activated', 'physics recovery safeguard activated during the journey');
}

export function assertAcceptedDungeonFixture(candidate, options = {}) {
  const fixture = candidate?.plan ? candidate : { plan: candidate };
  const stage = options.stage ?? fixture.stage ?? 'plan';
  const profile = options.profile ?? fixture.plan.acceptanceProfile;
  assertPlanCollections(fixture.plan);
  assertSerializableFrozen(fixture.plan);
  if (stage === 'assembly' || stage === 'journey') {
    invariant(fixture.plan.accepted === true && fixture.plan.validation?.accepted === true,
      'assembly-plan-not-accepted', `${stage} fixtures must use the validator-produced accepted plan`);
  }
  assertActionContracts(fixture.plan);
  if (profile === 'golden') {
    assertGoldenProductionComposition(fixture.plan);
    assertGoldenContentContracts(fixture.plan);
    assertGoldenPhysicalProgression(fixture.plan);
  }
  assertEnvironmentStateContracts(fixture.plan, profile);
  assertMinimapContracts(fixture.plan);
  assertMechanismContracts(fixture.plan);
  const closed = assertClosedCellContract(fixture.plan);
  assertWalkableSurfaceContracts(fixture.plan);
  assertSafeAnchorParity(fixture.plan);
  assertStructuralFixtureContracts(fixture.plan);
  assertTraversalLinkContracts(fixture.plan);
  assertPlayableLowerAreas(fixture.plan, stage === 'journey' ? fixture.proofs?.camera : null);
  assertTopologyAndConnectorRules(fixture.plan, profile);
  assertLandmarkCompoundSpaces(fixture.plan, profile);
  assertRuntimeProofs(fixture, stage);
  return Object.freeze({ accepted: true, stage, ...closed });
}

export function assertAcceptanceFailure(code, callback) {
  assert.throws(callback, (error) => error instanceof DungeonAcceptanceError && error.code === code,
    `expected DungeonAcceptanceError ${code}`);
}
