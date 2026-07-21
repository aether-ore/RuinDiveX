function sorted(values) {
  return [...values].sort();
}

function cloneState(state) {
  return {
    regionId: state.regionId,
    keys: new Set(state.keys),
    gates: new Set(state.gates),
    encounters: new Set(state.encounters),
    rewards: new Set(state.rewards),
    objectives: new Set(state.objectives),
    visitedRegions: new Set(state.visitedRegions),
    visitedWaterStates: new Set(state.visitedWaterStates),
    variables: new Map(state.variables),
    mechanisms: new Map(state.mechanisms),
    extracted: state.extracted,
  };
}

function stateKey(state) {
  return JSON.stringify([
    state.regionId,
    sorted(state.keys),
    sorted(state.gates),
    sorted(state.encounters),
    sorted(state.rewards),
    sorted(state.objectives),
    sorted(state.visitedRegions),
    sorted(state.visitedWaterStates),
    [...state.variables].filter(([key]) => !key.startsWith('mechanism.')).sort(([left], [right]) => left.localeCompare(right)),
    state.extracted,
  ]);
}

function conditionMet(condition, state) {
  if (!condition) return true;
  if (condition.op === 'all') return condition.conditions.every((entry) => conditionMet(entry, state));
  if (condition.op === 'any') return condition.conditions.some((entry) => conditionMet(entry, state));
  if (condition.op === 'hasKey') return state.keys.has(condition.keyId);
  if (condition.op === 'gateOpen') return state.gates.has(condition.gateId);
  if (condition.op === 'encounterComplete') return state.encounters.has(condition.encounterId);
  if (condition.op === 'objectiveComplete') return state.objectives.has(condition.objectiveId);
  if (condition.op === 'rewardCollected') return state.rewards.has(condition.rewardId);
  if (condition.op === 'stateEquals') {
    if (condition.variableId === 'water.unit.configuration') return state.variables.get(condition.variableId) === condition.value;
    if (condition.variableId?.startsWith('mechanism.') && condition.variableId.endsWith('.state')) {
      return state.mechanisms.get(condition.variableId.slice(0, -6)) === condition.value;
    }
    return state.variables.get(condition.variableId) === condition.value;
  }
  return false;
}

function applyEffect(effect, state) {
  if (effect.op === 'grantKey') state.keys.add(effect.keyId);
  else if (effect.op === 'openGate') state.gates.add(effect.gateId);
  else if (effect.op === 'completeEncounter') state.encounters.add(effect.encounterId);
  else if (effect.op === 'completeObjective') state.objectives.add(effect.objectiveId);
  else if (effect.op === 'collectReward') state.rewards.add(effect.rewardId);
  else if (effect.op === 'setWaterState') {
    state.variables.set(effect.variableId, effect.value);
    state.visitedWaterStates.add(effect.value);
  } else if (effect.op === 'setMechanismState') {
    state.mechanisms.set(effect.mechanismId, effect.stateId);
    state.variables.set(`${effect.mechanismId}.state`, effect.stateId);
  } else if (effect.op === 'setState') state.variables.set(effect.variableId, effect.value);
  else if (effect.op === 'collectRefractor') state.variables.set(`refractor.${effect.refractorId}`, true);
  else if (effect.op === 'discoverRegion') state.visitedRegions.add(effect.regionId);
  else if (effect.op === 'extract') state.extracted = true;
}

function goalMet(plan, state) {
  return state.extracted
    && plan.regions.every((entry) => state.visitedRegions.has(entry.id))
    && plan.encounters.every((entry) => state.encounters.has(entry.id))
    && plan.rewards.every((entry) => state.rewards.has(entry.id))
    && plan.objectives.every((entry) => state.objectives.has(entry.id))
    && (plan.environmentStates.find((entry) => entry.type === 'conserved-water-unit')?.stableStates ?? [])
      .every((entry) => state.visitedWaterStates.has(entry.id));
}

function reconstructTrace(nodes, index) {
  const trace = [];
  let cursor = index;
  while (cursor !== null) {
    const node = nodes[cursor];
    if (node.transition) trace.push(...(Array.isArray(node.transition) ? [...node.transition].reverse() : [node.transition]));
    cursor = node.parent;
  }
  return trace.reverse();
}

function preExtractionGoalMet(plan, state) {
  return plan.regions.every((entry) => state.visitedRegions.has(entry.id))
    && plan.encounters.every((entry) => state.encounters.has(entry.id))
    && plan.rewards.every((entry) => state.rewards.has(entry.id))
    && plan.objectives.filter((entry) => entry.id !== 'objective.extraction').every((entry) => state.objectives.has(entry.id))
    && (plan.environmentStates.find((entry) => entry.type === 'conserved-water-unit')?.stableStates ?? [])
      .every((entry) => state.visitedWaterStates.has(entry.id));
}

function mechanismCoverageForState(plan, state, anchorById, actionById) {
  const trace = [];
  const coveredStateIds = {};
  const missingStateIds = {};
  for (const mechanism of plan.mechanisms) {
    const reachable = new Set([mechanism.initialStateId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const transition of mechanism.transitions ?? []) {
        if (transition.fromStateId !== '*' && !reachable.has(transition.fromStateId)) continue;
        const action = transition.actionId ? actionById.get(transition.actionId) : null;
        const anchor = action ? anchorById.get(action.anchorId) : null;
        const actionReachable = Boolean(
          action
          && anchor
          && state.visitedRegions.has(anchor.regionId)
          && (action.conditions ?? []).every((condition) => conditionMet(condition, state))
          && (action.effects ?? []).some((effect) => (
            effect.op === 'setMechanismState'
            && effect.mechanismId === mechanism.id
            && effect.stateId === transition.toStateId
          )),
        );
        const automaticReachable = transition.automatic === true && !transition.actionId;
        if (!actionReachable && !automaticReachable) continue;
        if (reachable.has(transition.toStateId)) continue;
        reachable.add(transition.toStateId);
        trace.push({
          type: automaticReachable ? 'mechanism-transition' : 'mechanism-action-coverage',
          id: mechanism.id,
          actionId: transition.actionId ?? null,
          fromStateId: transition.fromStateId,
          toStateId: transition.toStateId,
        });
        changed = true;
      }
    }
    const required = (mechanism.states ?? [])
      .filter((entry) => entry.stable !== false)
      .map((entry) => entry.id);
    coveredStateIds[mechanism.id] = sorted(reachable);
    const missing = required.filter((stateId) => !reachable.has(stateId));
    if (missing.length) missingStateIds[mechanism.id] = missing;
  }
  return {
    complete: Object.keys(missingStateIds).length === 0,
    coveredStateIds,
    missingStateIds,
    trace,
  };
}

function saturateMonotonicActions(plan, state, anchorById) {
  const trace = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const action of plan.actions) {
      const anchor = anchorById.get(action.anchorId);
      if (anchor?.regionId !== state.regionId || action.type === 'extraction') continue;
      if ((action.effects ?? []).some((effect) => effect.op === 'setWaterState' || effect.op === 'setMechanismState')) continue;
      if (!(action.conditions ?? []).every((entry) => conditionMet(entry, state))) continue;
      const before = stateKey(state);
      for (const effect of action.effects ?? []) applyEffect(effect, state);
      if (stateKey(state) !== before) {
        trace.push({ type: 'action', id: action.id, regionId: state.regionId });
        changed = true;
      }
    }
  }
  return trace;
}

export function solveDungeonPlanV2Symbolically(plan, options = {}) {
  const maximumVisitedStates = options.maximumVisitedStates ?? 250000;
  const maximumTransitions = options.maximumTransitions ?? 2500000;
  const anchorById = new Map(plan.anchors.map((entry) => [entry.id, entry]));
  const actionById = new Map(plan.actions.map((entry) => [entry.id, entry]));
  const startRegionId = plan.compatibility?.entranceRoomId;
  const water = plan.environmentStates.find((entry) => entry.type === 'conserved-water-unit');
  const initialWaterState = water?.initialStateId ?? null;
  const initial = {
    regionId: startRegionId,
    keys: new Set(),
    gates: new Set(),
    encounters: new Set(),
    rewards: new Set(),
    objectives: new Set(),
    visitedRegions: new Set([startRegionId]),
    visitedWaterStates: new Set(initialWaterState ? [initialWaterState] : []),
    variables: new Map(initialWaterState ? [['water.unit.configuration', initialWaterState]] : []),
    mechanisms: new Map(plan.mechanisms.map((entry) => [entry.id, entry.initialStateId])),
    extracted: false,
  };
  const initialTrace = saturateMonotonicActions(plan, initial, anchorById);
  const nodes = [{ state: initial, parent: null, transition: initialTrace }];
  const queue = [0];
  const visited = new Map([[stateKey(initial), 0]]);
  let transitions = 0;

  while (queue.length) {
    const nodeIndex = queue.shift();
    const state = nodes[nodeIndex].state;
    if (goalMet(plan, state)) {
      const mechanismCoverage = mechanismCoverageForState(plan, state, anchorById, actionById);
      if (mechanismCoverage.complete) {
        return Object.freeze({
          solvable: true,
          visitedStates: visited.size,
          evaluatedTransitions: transitions,
          trace: Object.freeze(reconstructTrace(nodes, nodeIndex)),
          mechanismCoverage: Object.freeze(mechanismCoverage),
        });
      }
    }
    if (visited.size >= maximumVisitedStates || transitions >= maximumTransitions) break;

    const candidates = [];
    for (const action of plan.actions) {
      const anchor = anchorById.get(action.anchorId);
      if (anchor?.regionId !== state.regionId || !(action.conditions ?? []).every((entry) => conditionMet(entry, state))) continue;
      const choiceAction = (action.effects ?? []).some((effect) => effect.op === 'setWaterState');
      const extractionAction = action.type === 'extraction'
        && preExtractionGoalMet(plan, state)
        && mechanismCoverageForState(plan, state, anchorById, actionById).complete;
      if (!choiceAction && !extractionAction) continue;
      const next = cloneState(state);
      for (const effect of action.effects ?? []) applyEffect(effect, next);
      const transition = [{ type: 'action', id: action.id, regionId: state.regionId }];
      transition.push(...saturateMonotonicActions(plan, next, anchorById));
      candidates.push({ state: next, transition });
    }
    for (const portal of plan.portals) {
      const directions = [{ endpoint: portal.from, target: portal.to, allowed: true }];
      if (portal.direction !== 'forward-only') directions.push({ endpoint: portal.to, target: portal.from, allowed: true });
      for (const direction of directions) {
        if (direction.endpoint.regionId !== state.regionId || !(portal.conditions ?? []).every((entry) => conditionMet(entry, state))) continue;
        const next = cloneState(state);
        next.regionId = direction.target.regionId;
        next.visitedRegions.add(direction.target.regionId);
        for (const effect of portal.traversalEffects ?? []) applyEffect(effect, next);
        const transition = [{ type: 'traverse', id: portal.id, fromRegionId: state.regionId, toRegionId: next.regionId }];
        transition.push(...saturateMonotonicActions(plan, next, anchorById));
        candidates.push({ state: next, transition });
      }
    }
    for (const candidate of candidates) {
      transitions += 1;
      const key = stateKey(candidate.state);
      if (key === stateKey(state) || visited.has(key)) continue;
      const nextIndex = nodes.length;
      nodes.push({ state: candidate.state, parent: nodeIndex, transition: candidate.transition });
      visited.set(key, nextIndex);
      queue.push(nextIndex);
      if (visited.size >= maximumVisitedStates || transitions >= maximumTransitions) break;
    }
  }

  return Object.freeze({
    solvable: false,
    visitedStates: visited.size,
    evaluatedTransitions: transitions,
    trace: Object.freeze([]),
    exhaustedBudget: visited.size >= maximumVisitedStates || transitions >= maximumTransitions,
    frontierSize: queue.length,
  });
}

export default solveDungeonPlanV2Symbolically;
