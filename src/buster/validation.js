import {
  BUSTER_CHASSIS_CAPACITY,
  BUSTER_MODULE_CATALOG,
  BUSTER_RULESET_VERSION,
  BUSTER_SCHEMA_VERSION,
  BUSTER_TUNING_MAX,
  BUSTER_TUNING_MIN,
  BUSTER_TUNING_TOTAL,
  BUSTER_TRIGGER_TIME_EPSILON,
  BUSTER_TRIGGER_WINDOW_WARNING_SECONDS,
  getBusterMaxEnergy,
  getBusterModuleDefinition,
  getBusterTuningMultiplier,
} from './catalog.js';
import { deepFreezeBusterValue, normalizeBusterBuild } from './model.js';

const TUNING_KEYS = Object.freeze(['power', 'energy', 'range', 'rapid']);
const EDGE_PORTS = Object.freeze(['next', 'child']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function makeError(code, path, moduleId, message) {
  return { code, path, moduleId: moduleId ?? null, message };
}

function addError(errors, seenErrors, code, path, moduleId, message) {
  const key = `${code}\u0000${path}\u0000${moduleId ?? ''}`;
  if (seenErrors.has(key)) return;
  seenErrors.add(key);
  errors.push(makeError(code, path, moduleId, message));
}

function addWarning(warnings, seenWarnings, code, path, moduleId, message) {
  const key = `${code}\u0000${path}\u0000${moduleId ?? ''}`;
  if (seenWarnings.has(key)) return;
  seenWarnings.add(key);
  warnings.push(makeError(code, path, moduleId, message));
}

function readContext(options) {
  if (!isRecord(options)) return null;
  const candidate = isRecord(options.context) ? options.context : options;
  const hasOwned = Object.prototype.hasOwnProperty.call(candidate, 'ownedModuleInstanceIds');
  const hasClaimed = Object.prototype.hasOwnProperty.call(candidate, 'claimedModuleInstanceIds');
  return hasOwned || hasClaimed ? { candidate, hasOwned, hasClaimed } : null;
}

function idsToSet(value) {
  if (value instanceof Set) return new Set(value);
  if (value instanceof Map) return new Set(value.keys());
  if (Array.isArray(value)) {
    return new Set(value.map((entry) => (
      isRecord(entry) ? entry.moduleInstanceId ?? entry.instanceId ?? entry.id : entry
    )).filter((entry) => entry !== null && entry !== undefined));
  }
  if (value && typeof value !== 'string' && typeof value[Symbol.iterator] === 'function') {
    return new Set(value);
  }
  if (isRecord(value)) {
    return new Set(Object.entries(value).filter(([, present]) => Boolean(present)).map(([id]) => id));
  }
  return new Set();
}

function modulePath(index, suffix = '') {
  return `/program/nodes/${index}${suffix}`;
}

function edgePath(index, suffix = '') {
  return `/program/edges/${index}${suffix}`;
}

function getOutgoing(outgoing, nodeId, port) {
  return outgoing.get(nodeId)?.get(port) ?? [];
}

function hasCompatibleEmitterTag(definition, emitterDefinition) {
  if (!definition || !emitterDefinition || definition.kind === 'emitter') return true;
  const compatible = definition.compatibleEmitterTags ?? [];
  const tags = new Set(emitterDefinition.emitterTags ?? []);
  return compatible.length === 0 || compatible.some((tag) => tags.has(tag));
}

/**
 * Validates a source graph without mutating it. Error paths always refer to the
 * caller's original array order, while `normalizedBuild` is deterministic.
 */
function validateBusterSource(build, options = {}, { validatePhysical = true } = {}) {
  const errors = [];
  const warnings = [];
  const seenErrors = new Set();
  const seenWarnings = new Set();
  const fail = (code, path, moduleId, message) => (
    addError(errors, seenErrors, code, path, moduleId, message)
  );
  const warn = (code, path, moduleId, message) => (
    addWarning(warnings, seenWarnings, code, path, moduleId, message)
  );

  if (!isRecord(build)) {
    fail('INVALID_BUILD', '', null, 'A Custom Buster build must be an object.');
    return deepFreezeBusterValue({
      valid: false,
      ok: false,
      errors,
      warnings,
      normalizedBuild: normalizeBusterBuild(build),
    });
  }

  if (build.schemaVersion !== BUSTER_SCHEMA_VERSION) {
    fail(
      'UNSUPPORTED_SCHEMA_VERSION',
      '/schemaVersion',
      null,
      `Schema version must be ${BUSTER_SCHEMA_VERSION}.`,
    );
  }
  if (build.rulesetVersion !== BUSTER_RULESET_VERSION) {
    fail(
      'UNSUPPORTED_RULESET_VERSION',
      '/rulesetVersion',
      null,
      `Ruleset version must be "${BUSTER_RULESET_VERSION}".`,
    );
  }
  if (!isNonEmptyString(build.buildId)) {
    fail('INVALID_BUILD_ID', '/buildId', null, 'buildId must be a non-empty string.');
  }
  if (!isNonEmptyString(build.chassisId)) {
    fail('INVALID_CHASSIS_ID', '/chassisId', null, 'chassisId must be a non-empty string.');
  }

  const tuning = isRecord(build.tuning) ? build.tuning : {};
  if (!isRecord(build.tuning)) {
    fail('INVALID_TUNING', '/tuning', null, 'tuning must contain four chassis ratings.');
  }
  let allTuningRatingsValid = true;
  for (const key of TUNING_KEYS) {
    const rating = tuning[key];
    if (!Number.isInteger(rating) || rating < BUSTER_TUNING_MIN || rating > BUSTER_TUNING_MAX) {
      allTuningRatingsValid = false;
      fail(
        'INVALID_TUNING_RATING',
        `/tuning/${key}`,
        null,
        `${key} must be an integer from ${BUSTER_TUNING_MIN} through ${BUSTER_TUNING_MAX}.`,
      );
    }
  }
  if (allTuningRatingsValid) {
    const total = TUNING_KEYS.reduce((sum, key) => sum + tuning[key], 0);
    if (total !== BUSTER_TUNING_TOTAL) {
      fail(
        'INVALID_TUNING_TOTAL',
        '/tuning',
        null,
        `Chassis ratings must total exactly ${BUSTER_TUNING_TOTAL}; received ${total}.`,
      );
    }
  }

  const program = isRecord(build.program) ? build.program : {};
  if (!isRecord(build.program)) {
    fail('INVALID_PROGRAM', '/program', null, 'program must be an object.');
  }
  const nodes = Array.isArray(program.nodes) ? program.nodes : [];
  const edges = Array.isArray(program.edges) ? program.edges : [];
  if (!Array.isArray(program.nodes)) {
    fail('INVALID_NODES', '/program/nodes', null, 'program.nodes must be an array.');
  }
  if (!Array.isArray(program.edges)) {
    fail('INVALID_EDGES', '/program/edges', null, 'program.edges must be an array.');
  }
  if (!isNonEmptyString(program.rootNodeId)) {
    fail('INVALID_ROOT_NODE', '/program/rootNodeId', null, 'rootNodeId must be a non-empty string.');
  }

  const nodeById = new Map();
  const nodeIndexById = new Map();
  const moduleByNodeId = new Map();
  const instanceIdOwners = new Map();
  let hasUnknownModule = false;

  nodes.forEach((node, index) => {
    if (!isRecord(node)) {
      fail('INVALID_NODE', modulePath(index), null, 'Every program node must be an object.');
      return;
    }
    const moduleId = node.moduleId ?? null;
    if (!isNonEmptyString(node.nodeId)) {
      fail('INVALID_NODE_ID', modulePath(index, '/nodeId'), moduleId, 'nodeId must be a non-empty string.');
    } else if (nodeById.has(node.nodeId)) {
      fail('DUPLICATE_NODE_ID', modulePath(index, '/nodeId'), moduleId, `Duplicate nodeId "${node.nodeId}".`);
    } else {
      nodeById.set(node.nodeId, node);
      nodeIndexById.set(node.nodeId, index);
    }

    if (!isNonEmptyString(moduleId)) {
      fail('INVALID_MODULE_ID', modulePath(index, '/moduleId'), moduleId, 'moduleId must be a non-empty string.');
    } else {
      const definition = getBusterModuleDefinition(moduleId);
      if (!definition) {
        hasUnknownModule = true;
        fail('UNKNOWN_MODULE', modulePath(index, '/moduleId'), moduleId, `Unknown Custom Buster module "${moduleId}".`);
      } else if (isNonEmptyString(node.nodeId) && !moduleByNodeId.has(node.nodeId)) {
        moduleByNodeId.set(node.nodeId, definition);
      }
    }

    const instanceId = node.moduleInstanceId;
    if (instanceId !== null && instanceId !== undefined && !isNonEmptyString(instanceId)) {
      fail(
        'INVALID_MODULE_INSTANCE_ID',
        modulePath(index, '/moduleInstanceId'),
        moduleId,
        'moduleInstanceId must be a non-empty string when supplied.',
      );
    } else if (isNonEmptyString(instanceId)) {
      if (instanceIdOwners.has(instanceId)) {
        fail(
          'DUPLICATE_MODULE_INSTANCE',
          modulePath(index, '/moduleInstanceId'),
          moduleId,
          `Module instance "${instanceId}" is mounted more than once.`,
        );
      } else {
        instanceIdOwners.set(instanceId, index);
      }
    }
  });

  if (isNonEmptyString(program.rootNodeId) && !nodeById.has(program.rootNodeId)) {
    fail('ROOT_NODE_MISSING', '/program/rootNodeId', null, `Root node "${program.rootNodeId}" does not exist.`);
  }

  const outgoing = new Map();
  const incoming = new Map();
  const usableEdges = [];
  const exactEdges = new Set();
  edges.forEach((edge, index) => {
    if (!isRecord(edge)) {
      fail('INVALID_EDGE', edgePath(index), null, 'Every program edge must be an object.');
      return;
    }
    if (!isNonEmptyString(edge.from)) {
      fail('INVALID_EDGE_NODE', edgePath(index, '/from'), null, 'Edge from must be a non-empty node id.');
    } else if (!nodeById.has(edge.from)) {
      fail('EDGE_NODE_MISSING', edgePath(index, '/from'), null, `Edge source "${edge.from}" does not exist.`);
    }
    if (!isNonEmptyString(edge.to)) {
      fail('INVALID_EDGE_NODE', edgePath(index, '/to'), null, 'Edge to must be a non-empty node id.');
    } else if (!nodeById.has(edge.to)) {
      fail('EDGE_NODE_MISSING', edgePath(index, '/to'), null, `Edge target "${edge.to}" does not exist.`);
    }
    if (!EDGE_PORTS.includes(edge.port)) {
      fail('INVALID_EDGE_PORT', edgePath(index, '/port'), null, 'Edge port must be either "next" or "child".');
    }
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to) || !EDGE_PORTS.includes(edge.port)) return;

    const exactKey = `${edge.from}\u0000${edge.port}\u0000${edge.to}`;
    if (exactEdges.has(exactKey)) {
      fail('DUPLICATE_EDGE', edgePath(index), moduleByNodeId.get(edge.from)?.id, 'The same graph edge appears more than once.');
    }
    exactEdges.add(exactKey);

    if (!outgoing.has(edge.from)) outgoing.set(edge.from, new Map());
    const portEdges = outgoing.get(edge.from);
    if (!portEdges.has(edge.port)) portEdges.set(edge.port, []);
    portEdges.get(edge.port).push({ ...edge, index });
    if (portEdges.get(edge.port).length > 1) {
      fail(
        'MULTIPLE_PORT_EDGES',
        edgePath(index, '/port'),
        moduleByNodeId.get(edge.from)?.id,
        `Node "${edge.from}" has more than one ${edge.port} edge.`,
      );
    }

    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push({ ...edge, index });
    if (incoming.get(edge.to).length > 1) {
      fail(
        'MULTIPLE_INCOMING_EDGES',
        edgePath(index, '/to'),
        moduleByNodeId.get(edge.to)?.id,
        `Node "${edge.to}" has more than one incoming edge.`,
      );
    }
    usableEdges.push({ ...edge, index });
  });

  if (isNonEmptyString(program.rootNodeId) && (incoming.get(program.rootNodeId)?.length ?? 0) > 0) {
    fail('ROOT_HAS_INCOMING_EDGE', '/program/rootNodeId', moduleByNodeId.get(program.rootNodeId)?.id, 'The root node cannot have an incoming edge.');
  }

  const visitState = new Map();
  let cycleFound = false;
  const visitForCycle = (nodeId) => {
    if (visitState.get(nodeId) === 1) {
      cycleFound = true;
      return;
    }
    if (visitState.get(nodeId) === 2) return;
    visitState.set(nodeId, 1);
    const ports = outgoing.get(nodeId);
    if (ports) {
      for (const portEdges of ports.values()) {
        for (const edge of portEdges) visitForCycle(edge.to);
      }
    }
    visitState.set(nodeId, 2);
  };
  for (const nodeId of nodeById.keys()) visitForCycle(nodeId);
  if (cycleFound) fail('CYCLE', '/program/edges', null, 'The Custom Buster program must be acyclic.');

  const reachable = new Set();
  const visitReachable = (nodeId) => {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    const ports = outgoing.get(nodeId);
    if (!ports) return;
    for (const portEdges of ports.values()) {
      for (const edge of portEdges) visitReachable(edge.to);
    }
  };
  if (nodeById.has(program.rootNodeId)) visitReachable(program.rootNodeId);
  nodes.forEach((node, index) => {
    if (isRecord(node) && isNonEmptyString(node.nodeId) && nodeById.get(node.nodeId) === node && !reachable.has(node.nodeId)) {
      fail('DISCONNECTED', modulePath(index), node.moduleId, `Node "${node.nodeId}" is not reachable from the root.`);
    }
  });

  const knownNodes = nodes
    .map((node, index) => ({ node, index, definition: isRecord(node) ? getBusterModuleDefinition(node.moduleId) : null }))
    .filter(({ definition }) => Boolean(definition));
  const semanticCapacityUsed = knownNodes.reduce(
    (sum, { definition }) => sum + (definition.semanticCapacity ?? 1),
    0,
  );
  if (semanticCapacityUsed > BUSTER_CHASSIS_CAPACITY) {
    fail(
      'CAPACITY_EXCEEDED',
      '/program/nodes',
      null,
      `Program modules use ${semanticCapacityUsed} of ${BUSTER_CHASSIS_CAPACITY} semantic capacity points.`,
    );
  }
  for (const { node, index, definition } of knownNodes) {
    if (validatePhysical && definition.physical && !isNonEmptyString(node.moduleInstanceId)) {
      fail(
        'MODULE_INSTANCE_REQUIRED',
        modulePath(index, '/moduleInstanceId'),
        definition.id,
        `${definition.label} requires a physical module instance.`,
      );
    }
  }
  const emitterNodes = knownNodes.filter(({ definition }) => definition.kind === 'emitter');
  if (emitterNodes.length !== 1) {
    fail('ONE_EMITTER_REQUIRED', '/program/nodes', null, `A program must contain exactly one emitter; found ${emitterNodes.length}.`);
  }
  const rootDefinition = moduleByNodeId.get(program.rootNodeId) ?? null;
  if (nodeById.has(program.rootNodeId) && rootDefinition && rootDefinition.kind !== 'emitter') {
    fail(
      'ROOT_MUST_BE_EMITTER',
      '/program/rootNodeId',
      rootDefinition.id,
      'The program root must be its emitter.',
    );
  }
  for (const { node, index, definition } of emitterNodes) {
    if (node.nodeId !== program.rootNodeId) {
      fail('EMITTER_NOT_ROOT', modulePath(index), definition.id, 'An emitter may only appear at the program root.');
    }
  }

  const triggerNodes = knownNodes.filter(({ definition }) => definition.kind === 'trigger');
  const splitterNodes = knownNodes.filter(({ definition }) => definition.kind === 'splitter');
  if (triggerNodes.length > 1) {
    const second = triggerNodes[1];
    fail('TOO_MANY_TRIGGERS', modulePath(second.index), second.definition.id, 'A v0.2 program can contain at most one trigger.');
  }
  if (splitterNodes.length > 1) {
    const second = splitterNodes[1];
    fail('TOO_MANY_SPLITTERS', modulePath(second.index), second.definition.id, 'A v0.2 program can contain at most one splitter.');
  }

  for (const { node, index, definition } of knownNodes) {
    const nextEdges = getOutgoing(outgoing, node.nodeId, 'next');
    const childEdges = getOutgoing(outgoing, node.nodeId, 'child');
    if (definition.kind === 'payload' && nextEdges.length + childEdges.length > 0) {
      fail('PAYLOAD_NOT_TERMINAL', modulePath(index), definition.id, 'Payload modules must be terminal.');
    }
    if (definition.kind === 'trigger') {
      if (childEdges.length !== 1) {
        fail('TRIGGER_CHILD_REQUIRED', modulePath(index), definition.id, 'A trigger must have exactly one child edge.');
      }
      if (nextEdges.length > 0) {
        fail('TRIGGER_NEXT_NOT_ALLOWED', modulePath(index), definition.id, 'A trigger cannot have a next edge; carrier behavior is intrinsic.');
      }
    } else if (childEdges.length > 0) {
      fail('CHILD_EDGE_REQUIRES_TRIGGER', modulePath(index), definition.id, 'Only a trigger may own a child edge.');
    }
  }

  const scopeByNodeId = new Map();
  const triggerDepthByNodeId = new Map();
  const walkScopes = (nodeId, scope, triggerDepth, ancestry = new Set()) => {
    if (ancestry.has(nodeId)) return;
    if (!scopeByNodeId.has(nodeId)) scopeByNodeId.set(nodeId, scope);
    const previousDepth = triggerDepthByNodeId.get(nodeId);
    if (previousDepth === undefined || triggerDepth < previousDepth) triggerDepthByNodeId.set(nodeId, triggerDepth);
    const definition = moduleByNodeId.get(nodeId);
    if (definition?.kind === 'trigger' && triggerDepth >= 1) {
      const index = nodeIndexById.get(nodeId);
      fail('NESTED_TRIGGER', modulePath(index), definition.id, 'A child scope cannot contain another trigger.');
    }
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(nodeId);
    for (const edge of getOutgoing(outgoing, nodeId, 'next')) {
      walkScopes(edge.to, scope, triggerDepth + (definition?.kind === 'trigger' ? 1 : 0), nextAncestry);
    }
    for (const edge of getOutgoing(outgoing, nodeId, 'child')) {
      const childScope = definition?.kind === 'trigger' ? `child:${nodeId}` : scope;
      walkScopes(edge.to, childScope, triggerDepth + (definition?.kind === 'trigger' ? 1 : 0), nextAncestry);
    }
  };
  if (nodeById.has(program.rootNodeId)) walkScopes(program.rootNodeId, 'root', 0);

  const modifiersByScope = new Map();
  for (const entry of knownNodes.filter(({ definition }) => definition.kind === 'modifier')) {
    const scope = scopeByNodeId.get(entry.node.nodeId) ?? `disconnected:${entry.node.nodeId}`;
    if (modifiersByScope.has(scope)) {
      fail(
        'TOO_MANY_MODIFIERS_IN_SCOPE',
        modulePath(entry.index),
        entry.definition.id,
        'A scope can contain at most one modifier.',
      );
    } else {
      modifiersByScope.set(scope, entry);
    }
  }

  if (triggerNodes.length > 0) {
    const rootSplitter = splitterNodes.find(({ node }) => scopeByNodeId.get(node.nodeId) === 'root');
    if (rootSplitter) {
      fail(
        'INVALID_MODULE_ORDER',
        modulePath(rootSplitter.index),
        rootSplitter.definition.id,
        'A triggered program may split only the terminal child batch.',
      );
    }
  }

  for (const entry of splitterNodes) {
    const scope = scopeByNodeId.get(entry.node.nodeId) ?? 'disconnected';
    if (entry.definition.childOnly && scope === 'root') {
      fail(
        'CHILD_ONLY_MODULE',
        modulePath(entry.index),
        entry.definition.id,
        `${entry.definition.label} may only appear in a trigger child branch.`,
      );
    }
  }

  const readChain = (startNode, stopAtTrigger = false) => {
    const sequence = [];
    const visited = new Set();
    let current = startNode;
    while (current && !visited.has(current.nodeId)) {
      visited.add(current.nodeId);
      sequence.push(current);
      const definition = moduleByNodeId.get(current.nodeId);
      if (stopAtTrigger && definition?.kind === 'trigger') break;
      const nextEdge = getOutgoing(outgoing, current.nodeId, 'next')[0];
      current = nextEdge ? nodeById.get(nextEdge.to) ?? null : null;
    }
    return sequence;
  };
  const rootStart = nodeById.get(program.rootNodeId) ?? null;
  const rootSequence = readChain(rootStart, true);
  const pathTrigger = rootSequence.find((node) => moduleByNodeId.get(node.nodeId)?.kind === 'trigger') ?? null;
  const childStartEdge = pathTrigger ? getOutgoing(outgoing, pathTrigger.nodeId, 'child')[0] : null;
  const childSequence = readChain(childStartEdge ? nodeById.get(childStartEdge.to) ?? null : null);

  const enforceGrammar = (sequence, allowedKinds, scopeName) => {
    let grammarIndex = 0;
    for (const node of sequence) {
      const definition = moduleByNodeId.get(node.nodeId);
      if (!definition) continue;
      let foundIndex = -1;
      for (let index = grammarIndex; index < allowedKinds.length; index += 1) {
        if (allowedKinds[index] === definition.kind) {
          foundIndex = index;
          break;
        }
      }
      if (foundIndex < 0) {
        fail(
          'INVALID_MODULE_ORDER',
          modulePath(nodeIndexById.get(node.nodeId)),
          definition.id,
          `${definition.label} cannot appear at this position in the ${scopeName} program strip.`,
        );
      } else {
        grammarIndex = foundIndex + 1;
      }
    }
  };

  if (pathTrigger) {
    enforceGrammar(rootSequence, ['emitter', 'modifier', 'trigger'], 'root');
    enforceGrammar(childSequence, ['modifier', 'splitter', 'payload'], 'child');
  } else {
    enforceGrammar(rootSequence, ['emitter', 'modifier', 'splitter', 'payload'], 'root');
  }

  const emitterDefinition = rootDefinition?.kind === 'emitter' ? rootDefinition : emitterNodes[0]?.definition ?? null;
  if (emitterDefinition) {
    for (const { index, definition } of knownNodes) {
      if (!hasCompatibleEmitterTag(definition, emitterDefinition)) {
        fail(
          'INCOMPATIBLE_MODULE',
          modulePath(index, '/moduleId'),
          definition.id,
          `${definition.label} is not compatible with ${emitterDefinition.label}.`,
        );
      }
    }
  }

  const physicalContext = validatePhysical ? readContext(options) : null;
  if (physicalContext) {
    const owned = physicalContext.hasOwned
      ? idsToSet(physicalContext.candidate.ownedModuleInstanceIds)
      : null;
    const claimed = physicalContext.hasClaimed
      ? idsToSet(physicalContext.candidate.claimedModuleInstanceIds)
      : null;
    for (const { node, index, definition } of knownNodes) {
      if (!definition.physical) continue;
      if (!isNonEmptyString(node.moduleInstanceId)) {
        continue;
      }
      if (owned && !owned.has(node.moduleInstanceId)) {
        fail(
          'INSTANCE_NOT_OWNED',
          modulePath(index, '/moduleInstanceId'),
          definition.id,
          `Module instance "${node.moduleInstanceId}" is not owned.`,
        );
      }
      if (claimed && claimed.has(node.moduleInstanceId)) {
        fail(
          'INSTANCE_ALREADY_CLAIMED',
          modulePath(index, '/moduleInstanceId'),
          definition.id,
          `Module instance "${node.moduleInstanceId}" is already claimed by another build.`,
        );
      }
    }
  }

  if (!hasUnknownModule && allTuningRatingsValid) {
    const energyCost = knownNodes.reduce((sum, { definition }) => sum + definition.energyCost, 0);
    const maxEnergy = getBusterMaxEnergy(tuning.energy);
    if (energyCost > maxEnergy) {
      fail(
        'INSUFFICIENT_ENERGY',
        '/program/nodes',
        null,
        `Program energy cost ${energyCost} exceeds chassis capacity ${maxEnergy}.`,
      );
    }
  }


  if (emitterDefinition && allTuningRatingsValid) {
    const delayEntry = triggerNodes.find(({ definition }) => definition.event === 'delay');
    if (delayEntry) {
      const rootRange = emitterDefinition.baseRange * getBusterTuningMultiplier(tuning.range);
      const nominalLifetime = rootRange / emitterDefinition.projectileSpeed;
      const remainingWindow = nominalLifetime - delayEntry.definition.delay;
      if (delayEntry.definition.delay > nominalLifetime + BUSTER_TRIGGER_TIME_EPSILON) {
        fail(
          'TRIGGER_UNREACHABLE',
          modulePath(delayEntry.index),
          delayEntry.definition.id,
          `${delayEntry.definition.label} fires at ${delayEntry.definition.delay.toFixed(2)}s, after the carrier's nominal ${nominalLifetime.toFixed(3)}s lifetime.`,
        );
      } else if (remainingWindow < BUSTER_TRIGGER_WINDOW_WARNING_SECONDS + BUSTER_TRIGGER_TIME_EPSILON) {
        warn(
          'TRIGGER_WINDOW_NARROW',
          modulePath(delayEntry.index),
          delayEntry.definition.id,
          `${delayEntry.definition.label} has only ${Math.max(0, remainingWindow).toFixed(3)}s before nominal carrier expiry.`,
        );
      }
    }
  }

  return deepFreezeBusterValue({
    valid: errors.length === 0,
    ok: errors.length === 0,
    errors,
    warnings,
    semanticCapacityUsed,
    normalizedBuild: normalizeBusterBuild(build),
  });
}

/**
 * Structural validation for source graphs and ownership-free blueprints.
 */
export function validateBusterProgram(build, options = {}) {
  return validateBusterSource(build, options, { validatePhysical: false });
}

/**
 * Compatibility entry point for physical builds. Existing callers retain
 * module-instance checks while compilation may use validateBusterProgram.
 */
export function validateBusterBuild(build, options = {}) {
  return validateBusterSource(build, options, { validatePhysical: true });
}

/**
 * Validates physical ownership independently from source-program legality.
 * Collections accept arrays, maps, or id-keyed records so storage and editor
 * layers do not need to expose their internal container type to this module.
 */
export function validateBusterAssignments({
  builds = [],
  chassisInventory,
  moduleInventory,
  assignments = {},
} = {}) {
  const errors = [];
  const warnings = [];
  const seenErrors = new Set();
  const fail = (code, path, moduleId, message) => (
    addError(errors, seenErrors, code, path, moduleId, message)
  );
  const collectionEntries = (value) => {
    if (value instanceof Map) return [...value.entries()];
    if (value instanceof Set) return [...value].map((entry) => [String(entry), entry]);
    if (Array.isArray(value)) return value.map((entry, index) => [String(index), entry]);
    if (isRecord(value)) return Object.entries(value);
    return [];
  };
  const buildEntries = collectionEntries(builds);
  const normalizedBuilds = [];
  const buildById = new Map();
  const chassisOwner = new Map();
  const instanceOwner = new Map();

  const chassisIds = chassisInventory === undefined
    ? null
    : new Set(collectionEntries(chassisInventory).map(([key, entry]) => (
      isRecord(entry)
        ? entry.chassisId ?? entry.id ?? key
        : typeof entry === 'string'
          ? entry
          : key
    )));
  const moduleInstances = moduleInventory === undefined
    ? null
    : new Map(collectionEntries(moduleInventory).map(([key, entry]) => {
      const instance = isRecord(entry)
        ? entry
        : { moduleInstanceId: typeof entry === 'string' ? entry : key };
      return [instance.moduleInstanceId ?? instance.instanceId ?? instance.id ?? key, instance];
    }));

  for (const [entryKey, sourceBuild] of buildEntries) {
    const path = `/builds/${entryKey}`;
    const validation = validateBusterProgram(sourceBuild);
    normalizedBuilds.push(validation.normalizedBuild);
    for (const error of validation.errors) {
      fail(error.code, `${path}${error.path}`, error.moduleId, error.message);
    }
    warnings.push(...validation.warnings.map((warning) => ({
      ...warning,
      path: `${path}${warning.path}`,
    })));
    const buildId = sourceBuild?.buildId;
    if (isNonEmptyString(buildId)) {
      if (buildById.has(buildId)) {
        fail('DUPLICATE_BUILD_ID', `${path}/buildId`, null, `Build id "${buildId}" appears more than once.`);
      } else {
        buildById.set(buildId, sourceBuild);
      }
    }

    const chassisId = sourceBuild?.chassisId;
    if (isNonEmptyString(chassisId)) {
      if (chassisIds && !chassisIds.has(chassisId)) {
        fail('CHASSIS_NOT_OWNED', `${path}/chassisId`, null, `Chassis "${chassisId}" is not owned.`);
      }
      if (chassisOwner.has(chassisId)) {
        fail('CHASSIS_ALREADY_CLAIMED', `${path}/chassisId`, null, `Chassis "${chassisId}" is already used by another build.`);
      } else {
        chassisOwner.set(chassisId, buildId ?? entryKey);
      }
    }

    const nodes = Array.isArray(sourceBuild?.program?.nodes) ? sourceBuild.program.nodes : [];
    nodes.forEach((node, nodeIndex) => {
      const definition = getBusterModuleDefinition(node?.moduleId);
      if (!definition?.physical) return;
      const instanceId = node?.moduleInstanceId;
      const instancePath = `${path}/program/nodes/${nodeIndex}/moduleInstanceId`;
      if (!isNonEmptyString(instanceId)) {
        fail(
          'MODULE_INSTANCE_REQUIRED',
          instancePath,
          definition.id,
          `${definition.label} requires a physical module instance.`,
        );
        return;
      }
      if (instanceOwner.has(instanceId)) {
        fail(
          'INSTANCE_ALREADY_CLAIMED',
          instancePath,
          definition.id,
          `Module instance "${instanceId}" is already claimed by another build.`,
        );
      } else {
        instanceOwner.set(instanceId, buildId ?? entryKey);
      }
      if (moduleInstances && !moduleInstances.has(instanceId)) {
        fail(
          'INSTANCE_NOT_OWNED',
          instancePath,
          definition.id,
          `Module instance "${instanceId}" is not owned.`,
        );
      } else if (moduleInstances) {
        const instance = moduleInstances.get(instanceId);
        if (isNonEmptyString(instance.moduleId) && instance.moduleId !== definition.id) {
          fail(
            'INSTANCE_MODULE_MISMATCH',
            instancePath,
            definition.id,
            `Module instance "${instanceId}" is ${instance.moduleId}, not ${definition.id}.`,
          );
        }
      }
    });
  }

  const assignedBuilds = new Map();
  for (const [slot, assignment] of collectionEntries(assignments)) {
    const buildId = isRecord(assignment) ? assignment.buildId : assignment;
    if (!isNonEmptyString(buildId)) continue;
    const path = `/assignments/${slot}`;
    if (!buildById.has(buildId)) {
      fail('ASSIGNED_BUILD_MISSING', path, null, `Assigned build "${buildId}" does not exist.`);
    }
    if (assignedBuilds.has(buildId)) {
      fail('BUILD_ASSIGNED_MORE_THAN_ONCE', path, null, `Build "${buildId}" is already assigned to another slot.`);
    } else {
      assignedBuilds.set(buildId, slot);
    }
  }

  return deepFreezeBusterValue({
    valid: errors.length === 0,
    ok: errors.length === 0,
    errors,
    warnings,
    normalizedBuilds,
  });
}

export function isKnownBusterModuleId(moduleId) {
  return Object.prototype.hasOwnProperty.call(BUSTER_MODULE_CATALOG, moduleId);
}
