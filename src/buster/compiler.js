import {
  BUSTER_CHASSIS_CAPACITY,
  BUSTER_CHILD_RANGE_MULTIPLIER,
  BUSTER_EFFECTIVE_POWER_CAP_MULTIPLIER,
  BUSTER_LEVEL_10_POWER_SCALAR,
  BUSTER_POWER_SOFT_CAP_ASYMPTOTE,
  BUSTER_POWER_SOFT_CAP_STEEPNESS,
  BUSTER_TUNING_MAX,
  BUSTER_TUNING_MIN,
  CUSTOM_BUSTER_RULESET,
  MEGA_BUSTER_BASE_PROFILE,
  applyBusterPowerSoftCap,
  getBusterCombatDepthLevel,
  getBusterCombatDepthScalar,
  getBusterMaxEnergy,
  getBusterModuleDefinition,
  getBusterTuningMultiplier,
} from './catalog.js';
import { deepFreezeBusterValue } from './model.js';
import { validateBusterProgram } from './validation.js';

const INTERNAL_RESOLVED_TUNING = Symbol('internalResolvedBusterTuning');
const BALANCE_OVERRIDE_WHITELIST = Object.freeze({
  mortarShell: Object.freeze({
    basePower: (value) => Number.isFinite(value) && value > 0,
  }),
  cluster5: Object.freeze({
    energyCost: (value) => Number.isInteger(value) && value >= 0,
  }),
});
const TUNING_KEYS = Object.freeze(['power', 'energy', 'range', 'rapid']);

export class BusterCompileError extends Error {
  constructor(errors, { warnings = [], diagnostic = null } = {}) {
    super(`Custom Buster compilation failed with ${errors.length} validation error${errors.length === 1 ? '' : 's'}.`);
    this.name = 'BusterCompileError';
    this.code = 'BUSTER_COMPILE_FAILED';
    this.errors = errors;
    this.warnings = warnings;
    if (diagnostic) this.diagnostic = diagnostic;
    Object.freeze(this);
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionError(code, path, moduleId, message) {
  return { code, path, moduleId: moduleId ?? null, message };
}

function readBalanceOverrides(options = {}) {
  const errors = [];
  const definitionOverrides = new Map();
  const metadata = [];
  let diagnosticRequested = false;
  const source = options.balanceOverrides;
  const hasAuthoredOverrides = source !== undefined && source !== null;

  if (hasAuthoredOverrides && !isRecord(source)) {
    errors.push(optionError(
      'INVALID_BALANCE_OVERRIDES',
      '/options/balanceOverrides',
      null,
      'balanceOverrides must be an object containing whitelisted diagnostic module fields.',
    ));
  } else if (isRecord(source)) {
    const moduleIds = Object.keys(source);
    if (moduleIds.length > 0 && options.diagnosticContext === true) {
      diagnosticRequested = true;
    }
    if (moduleIds.length > 0 && options.diagnosticContext !== true) {
      errors.push(optionError(
        'DIAGNOSTIC_CONTEXT_REQUIRED',
        '/options/diagnosticContext',
        null,
        'Balance overrides are diagnostic-only and require diagnosticContext: true.',
      ));
    }

    for (const moduleId of moduleIds) {
      const allowedFields = BALANCE_OVERRIDE_WHITELIST[moduleId];
      const modulePath = `/options/balanceOverrides/${moduleId}`;
      if (!allowedFields) {
        errors.push(optionError(
          'UNSUPPORTED_BALANCE_OVERRIDE',
          modulePath,
          moduleId,
          `Module "${moduleId}" has no diagnostic balance overrides.`,
        ));
        continue;
      }
      const authoredFields = source[moduleId];
      if (!isRecord(authoredFields)) {
        errors.push(optionError(
          'INVALID_BALANCE_OVERRIDE',
          modulePath,
          moduleId,
          `Diagnostic overrides for "${moduleId}" must be an object.`,
        ));
        continue;
      }

      const resolvedFields = {};
      for (const field of Object.keys(authoredFields)) {
        const validate = allowedFields[field];
        const fieldPath = `${modulePath}/${field}`;
        if (!validate) {
          errors.push(optionError(
            'UNSUPPORTED_BALANCE_OVERRIDE',
            fieldPath,
            moduleId,
            `Field "${moduleId}.${field}" cannot be overridden.`,
          ));
          continue;
        }
        const diagnosticValue = authoredFields[field];
        if (!validate(diagnosticValue)) {
          errors.push(optionError(
            'INVALID_BALANCE_OVERRIDE',
            fieldPath,
            moduleId,
            field === 'basePower'
              ? `${moduleId}.${field} must be a finite number greater than zero.`
              : `${moduleId}.${field} must be an integer greater than or equal to zero.`,
          ));
          continue;
        }
        const catalogValue = getBusterModuleDefinition(moduleId)[field];
        resolvedFields[field] = diagnosticValue;
        metadata.push({ moduleId, field, catalogValue, diagnosticValue });
      }
      if (Object.keys(resolvedFields).length > 0) definitionOverrides.set(moduleId, resolvedFields);
    }
  }

  if (Object.prototype.hasOwnProperty.call(options, 'level10PowerScalar')) {
    const diagnosticValue = options.level10PowerScalar;
    if (!Number.isFinite(diagnosticValue) || diagnosticValue <= 0) {
      diagnosticRequested = options.diagnosticContext === true;
      errors.push(optionError(
        'INVALID_BALANCE_OVERRIDE',
        '/options/level10PowerScalar',
        'ruleset',
        'level10PowerScalar must be a finite number greater than zero.',
      ));
    } else if (diagnosticValue !== BUSTER_LEVEL_10_POWER_SCALAR) {
      if (options.diagnosticContext !== true) {
        errors.push(optionError(
          'DIAGNOSTIC_CONTEXT_REQUIRED',
          '/options/diagnosticContext',
          'ruleset',
          'A noncatalog level10PowerScalar is diagnostic-only and requires diagnosticContext: true.',
        ));
      } else {
        diagnosticRequested = true;
        metadata.push({
          moduleId: 'ruleset',
          field: 'level10PowerScalar',
          catalogValue: BUSTER_LEVEL_10_POWER_SCALAR,
          diagnosticValue,
        });
      }
    }
  }

  const diagnostic = diagnosticRequested || metadata.length > 0
    ? { overrideOnly: true, overrides: metadata }
    : null;
  return { errors, definitionOverrides, diagnostic };
}

function compileFailure(errors, warnings, options, diagnostic = null) {
  const frozenErrors = deepFreezeBusterValue(errors);
  const frozenWarnings = deepFreezeBusterValue(warnings ?? []);
  const frozenDiagnostic = diagnostic ? deepFreezeBusterValue(diagnostic) : null;
  if (options?.throwOnError === false) {
    return deepFreezeBusterValue({
      ok: false,
      errors: frozenErrors,
      warnings: frozenWarnings,
      ...(frozenDiagnostic ? { diagnostic: frozenDiagnostic } : {}),
    });
  }
  throw new BusterCompileError(frozenErrors, {
    warnings: frozenWarnings,
    diagnostic: frozenDiagnostic,
  });
}

function buildGraph(build) {
  const nodeById = new Map(build.program.nodes.map((node) => [node.nodeId, node]));
  const edgeByPort = new Map();
  for (const edge of build.program.edges) {
    if (!edgeByPort.has(edge.from)) edgeByPort.set(edge.from, new Map());
    edgeByPort.get(edge.from).set(edge.port, edge.to);
  }
  return {
    nodeById,
    edgeByPort,
    next(nodeId, port = 'next') {
      const target = edgeByPort.get(nodeId)?.get(port);
      return target ? nodeById.get(target) ?? null : null;
    },
  };
}

function readSequences(build, resolveDefinition = getBusterModuleDefinition) {
  const graph = buildGraph(build);
  const root = [];
  const child = [];
  let current = graph.nodeById.get(build.program.rootNodeId);
  let triggerNode = null;

  while (current) {
    root.push(current);
    const definition = resolveDefinition(current.moduleId);
    if (definition.kind === 'trigger') {
      triggerNode = current;
      break;
    }
    current = graph.next(current.nodeId);
  }

  if (triggerNode) {
    current = graph.next(triggerNode.nodeId, 'child');
    while (current) {
      child.push(current);
      current = graph.next(current.nodeId);
    }
  }

  return { graph, root, child, triggerNode, ordered: [...root, ...child] };
}

function ledgerEntry({
  stage,
  moduleId = null,
  scope,
  inputPower,
  multiplier,
  outputPower,
  allocation = null,
  capClipped = 0,
}) {
  return {
    stage,
    moduleId,
    scope,
    inputPower,
    multiplier,
    outputPower,
    allocation,
    capClipped,
  };
}

function getPayloadConfiguration(explicitPayload, emitter) {
  if (explicitPayload) {
    return {
      moduleId: explicitPayload.id,
      type: explicitPayload.payload,
      radius: explicitPayload.radius ?? 0,
      replacesDirect: Boolean(explicitPayload.replacesDirect),
      implicit: false,
    };
  }
  return {
    moduleId: null,
    type: emitter.nativePayload,
    radius: 0,
    replacesDirect: false,
    implicit: true,
  };
}

function getSplitterConfiguration(splitter) {
  if (!splitter) return null;
  return {
    moduleId: splitter.id,
    count: splitter.count,
    pattern: splitter.pattern,
    angles: splitter.angleOffsets ? [...splitter.angleOffsets] : null,
    angleOffsets: splitter.angleOffsets ? [...splitter.angleOffsets] : null,
    radialCount: splitter.radialCount ?? null,
    totalMultiplier: splitter.totalPowerMultiplier,
    totalPowerMultiplier: splitter.totalPowerMultiplier,
  };
}

function getTriggerConfiguration(trigger) {
  if (!trigger) return null;
  return {
    moduleId: trigger.id,
    event: trigger.event,
    delay: trigger.delay,
    carrierAllocation: trigger.carrierAllocation,
    childTransfer: trigger.childTransfer,
    disposeCarrier: true,
    carrierTerminationBehavior: trigger.event === 'delay' || trigger.event === 'apex'
      ? 'deliver-child'
      : 'trigger-child',
  };
}

function getImpactStagger(payload, emitter, power) {
  if (payload.type === 'explosion') return Math.min(0.3, power * 0.015);
  if (payload.type === 'pulse') return Math.min(0.18, power * 0.01);
  if (emitter.nativePayload === 'ballistic') return Math.min(0.25, power * 0.015);
  return Math.min(0.18, power * 0.01);
}

function getNativeCarrierStagger(emitter, power) {
  if (emitter.nativePayload === 'ballistic') return Math.min(0.25, power * 0.015);
  return Math.min(0.18, power * 0.01);
}

function createDescription({
  emitter,
  rootGuidance,
  trigger,
  childGuidance,
  splitter,
  payload,
  stats,
  capClipped,
}) {
  const stages = [emitter.label];
  if (rootGuidance) stages.push(`${rootGuidance.label} (root)`);
  if (trigger) stages.push(trigger.label);
  if (childGuidance) stages.push(`${childGuidance.label} (child)`);
  if (splitter) stages.push(splitter.label);
  stages.push(payload.type === 'explosion' ? 'Explosion' : payload.type === 'pulse' ? 'Native Pulse' : 'Native Impact');
  const projectileWord = stats.projectileCount === 1 ? 'projectile' : 'projectiles';
  const capNote = capClipped > 0 ? ' Output is compressed by the chassis power soft cap.' : '';
  return `${stages.join(' -> ')}. ${stats.projectileCount} ${projectileWord} at ${stats.perChildPower} power each; ${stats.energyCost} energy per shot.${capNote}`;
}

function getRevision(build, options) {
  const candidate = options?.revision ?? build?.revision ?? build?.buildRevision ?? 0;
  return Number.isInteger(candidate) && candidate >= 0 ? candidate : 0;
}

/**
 * Compiles a valid source graph into a detached, deeply immutable execution
 * plan. Invalid builds throw BusterCompileError unless throwOnError is false.
 */
export function compileBusterBuild(build, options = {}) {
  const diagnostics = readBalanceOverrides(options);
  if (diagnostics.errors.length > 0) {
    return compileFailure(diagnostics.errors, [], options, diagnostics.diagnostic);
  }
  const validation = validateBusterProgram(build, options);
  if (!validation.valid) {
    return compileFailure(validation.errors, validation.warnings, options, diagnostics.diagnostic);
  }

  const sourceBuild = validation.normalizedBuild;
  const resolveDefinition = (moduleId) => {
    const definition = getBusterModuleDefinition(moduleId);
    const override = diagnostics.definitionOverrides.get(moduleId);
    return definition && override ? { ...definition, ...override } : definition;
  };
  const sequences = readSequences(sourceBuild, resolveDefinition);
  const emitterNode = sequences.root[0];
  const emitter = resolveDefinition(emitterNode.moduleId);
  const triggerNode = sequences.triggerNode;
  const trigger = triggerNode ? resolveDefinition(triggerNode.moduleId) : null;
  const rootGuidanceNode = sequences.root.find((node) => resolveDefinition(node.moduleId).kind === 'modifier') ?? null;
  const childGuidanceNode = sequences.child.find((node) => resolveDefinition(node.moduleId).kind === 'modifier') ?? null;
  const rootGuidance = rootGuidanceNode ? resolveDefinition(rootGuidanceNode.moduleId) : null;
  const childGuidance = childGuidanceNode ? resolveDefinition(childGuidanceNode.moduleId) : null;
  const splitterNode = sequences.ordered.find((node) => resolveDefinition(node.moduleId).kind === 'splitter') ?? null;
  const payloadNode = sequences.ordered.find((node) => resolveDefinition(node.moduleId).kind === 'payload') ?? null;
  const splitter = splitterNode ? resolveDefinition(splitterNode.moduleId) : null;
  const explicitPayload = payloadNode ? resolveDefinition(payloadNode.moduleId) : null;
  const splitterConfiguration = getSplitterConfiguration(splitter);
  const triggerConfiguration = getTriggerConfiguration(trigger);
  const payloadConfiguration = getPayloadConfiguration(explicitPayload, emitter);

  const resolvedTuning = options[INTERNAL_RESOLVED_TUNING] ?? sourceBuild.tuning;
  const powerMultiplier = getBusterTuningMultiplier(resolvedTuning.power);
  const rangeMultiplier = getBusterTuningMultiplier(resolvedTuning.range);
  const rapidMultiplier = getBusterTuningMultiplier(resolvedTuning.rapid);
  const combatDepthLevel = getBusterCombatDepthLevel(options?.combatDepthLevel ?? 1);
  const level10PowerScalar = Number.isFinite(Number(options?.level10PowerScalar))
    ? Number(options.level10PowerScalar)
    : BUSTER_LEVEL_10_POWER_SCALAR;
  const resolvedLevel10PowerScalar = getBusterCombatDepthScalar(10, level10PowerScalar);
  const combatDepthScalar = getBusterCombatDepthScalar(combatDepthLevel, resolvedLevel10PowerScalar);
  const tunedPower = emitter.basePower * powerMultiplier;
  const depthScaledPower = tunedPower * combatDepthScalar;
  const rootRange = emitter.baseRange * rangeMultiplier;
  const childRange = rootRange * BUSTER_CHILD_RANGE_MULTIPLIER;
  const baseRapid = emitter.baseRapid * rapidMultiplier;
  const baseCycleTime = 1 / baseRapid;
  const maxEnergy = getBusterMaxEnergy(resolvedTuning.energy);
  const energyCost = sequences.ordered.reduce(
    (sum, node) => sum + resolveDefinition(node.moduleId).energyCost,
    0,
  );
  const cycleDelay = sequences.ordered.reduce(
    (sum, node) => sum + resolveDefinition(node.moduleId).cycleDelay,
    0,
  );
  const cycleTime = baseCycleTime + cycleDelay;
  const finalRapid = 1 / cycleTime;
  const shotsPerCharge = Math.floor(maxEnergy / energyCost);

  const powerLedger = [];
  powerLedger.push(ledgerEntry({
    stage: 'tuning',
    moduleId: emitter.id,
    scope: 'root',
    inputPower: emitter.basePower,
    multiplier: powerMultiplier,
    outputPower: tunedPower,
    allocation: { root: tunedPower },
  }));
  powerLedger.push(ledgerEntry({
    stage: 'combat-depth',
    moduleId: null,
    scope: 'program',
    inputPower: tunedPower,
    multiplier: combatDepthScalar,
    outputPower: depthScaledPower,
    allocation: { root: depthScaledPower },
  }));

  let rootPacketPower = depthScaledPower;
  if (rootGuidance) {
    const inputPower = rootPacketPower;
    rootPacketPower *= rootGuidance.powerMultiplier;
    powerLedger.push(ledgerEntry({
      stage: 'modifier',
      moduleId: rootGuidance.id,
      scope: 'root',
      inputPower,
      multiplier: rootGuidance.powerMultiplier,
      outputPower: rootPacketPower,
      allocation: { root: rootPacketPower },
    }));
  }

  let carrierPowerRaw = 0;
  let terminalPowerRaw = rootPacketPower;
  if (trigger) {
    carrierPowerRaw = rootPacketPower * trigger.carrierAllocation;
    terminalPowerRaw = rootPacketPower * trigger.childTransfer;
    powerLedger.push(ledgerEntry({
      stage: 'trigger',
      moduleId: trigger.id,
      scope: 'root',
      inputPower: rootPacketPower,
      multiplier: trigger.carrierAllocation + trigger.childTransfer,
      outputPower: carrierPowerRaw + terminalPowerRaw,
      allocation: { carrier: carrierPowerRaw, child: terminalPowerRaw },
    }));
  }

  if (childGuidance) {
    const inputPower = carrierPowerRaw + terminalPowerRaw;
    terminalPowerRaw *= childGuidance.powerMultiplier;
    powerLedger.push(ledgerEntry({
      stage: 'modifier',
      moduleId: childGuidance.id,
      scope: 'child',
      inputPower,
      multiplier: childGuidance.powerMultiplier,
      outputPower: carrierPowerRaw + terminalPowerRaw,
      allocation: { carrier: carrierPowerRaw, child: terminalPowerRaw },
    }));
  }

  if (splitter) {
    const inputPower = carrierPowerRaw + terminalPowerRaw;
    terminalPowerRaw *= splitter.totalPowerMultiplier;
    powerLedger.push(ledgerEntry({
      stage: 'splitter',
      moduleId: splitter.id,
      scope: trigger ? 'child' : 'root',
      inputPower,
      multiplier: splitter.totalPowerMultiplier,
      outputPower: carrierPowerRaw + terminalPowerRaw,
      allocation: { carrier: carrierPowerRaw, terminalBatch: terminalPowerRaw },
    }));
  }

  const rawEffectivePower = carrierPowerRaw + terminalPowerRaw;
  const effectivePowerCap = depthScaledPower * BUSTER_EFFECTIVE_POWER_CAP_MULTIPLIER;
  const rawEffectiveMultiplier = depthScaledPower > 0 ? rawEffectivePower / depthScaledPower : 0;
  const softCappedMultiplier = applyBusterPowerSoftCap(rawEffectiveMultiplier);
  const capMultiplier = rawEffectiveMultiplier > 0
    ? softCappedMultiplier / rawEffectiveMultiplier
    : 1;
  const carrierPower = carrierPowerRaw * capMultiplier;
  const terminalTotalPower = terminalPowerRaw * capMultiplier;
  const effectivePower = carrierPower + terminalTotalPower;
  const capClipped = rawEffectivePower - effectivePower;
  const powerSoftCap = {
    active: rawEffectiveMultiplier > BUSTER_EFFECTIVE_POWER_CAP_MULTIPLIER,
    knee: BUSTER_EFFECTIVE_POWER_CAP_MULTIPLIER,
    asymptote: BUSTER_POWER_SOFT_CAP_ASYMPTOTE,
    steepness: BUSTER_POWER_SOFT_CAP_STEEPNESS,
    rawMultiplier: rawEffectiveMultiplier,
    effectiveMultiplier: softCappedMultiplier,
    compression: capClipped,
  };
  powerLedger.push(ledgerEntry({
    stage: 'power-soft-cap',
    moduleId: null,
    scope: trigger ? 'program' : 'root',
    inputPower: rawEffectivePower,
    multiplier: capMultiplier,
    outputPower: effectivePower,
    allocation: { carrier: carrierPower, terminalBatch: terminalTotalPower },
    capClipped,
  }));

  const projectileCount = splitter?.count ?? 1;
  const perChildPower = terminalTotalPower / projectileCount;
  powerLedger.push(ledgerEntry({
    stage: 'projectile-allocation',
    moduleId: splitter?.id ?? payloadConfiguration.moduleId,
    scope: trigger ? 'child' : 'root',
    inputPower: terminalTotalPower,
    multiplier: 1 / projectileCount,
    outputPower: perChildPower,
    allocation: { count: projectileCount, each: perChildPower, total: terminalTotalPower },
  }));

  const stagger = getImpactStagger(payloadConfiguration, emitter, perChildPower);
  const carrierStagger = getNativeCarrierStagger(emitter, carrierPower);
  const peakProjectileReservation = trigger ? Math.max(1, projectileCount) : Math.max(1, projectileCount);
  const nominalRootLifetime = rootRange / emitter.projectileSpeed;
  const nominalChildLifetime = childRange / emitter.projectileSpeed;
  const triggerActivation = trigger ? {
    event: trigger.event,
    nominalTime: trigger.event === 'delay'
      ? trigger.delay
      : trigger.event === 'apex'
        ? nominalRootLifetime * 0.5
        : nominalRootLifetime,
    nominalProgress: trigger.event === 'delay'
      ? trigger.delay / nominalRootLifetime
      : trigger.event === 'apex'
        ? 0.5
        : 1,
    aimDependent: trigger.event === 'apex' || trigger.event === 'impact',
    remainingNominalWindow: trigger.event === 'delay'
      ? nominalRootLifetime - trigger.delay
      : null,
  } : null;
  const nominalCarrierProjectileSeconds = trigger
    ? Math.min(nominalRootLifetime, Math.max(0, triggerActivation.nominalTime))
    : 0;
  const projectileSecondsPerExecution = trigger
    ? nominalCarrierProjectileSeconds + projectileCount * nominalChildLifetime
    : projectileCount * nominalRootLifetime;
  const occupancy = {
    peakMovingProjectiles: peakProjectileReservation,
    nominalRootLifetime,
    nominalChildLifetime,
    nominalCarrierProjectileSeconds,
    projectileSecondsPerExecution,
    estimatedSteadyMovingProjectiles: projectileSecondsPerExecution / cycleTime,
  };
  const trajectory = {
    type: emitter.trajectory,
    speed: emitter.projectileSpeed,
    rootRange,
    childRange,
    nominalRootLifetime,
    nominalChildLifetime,
    trigger: triggerActivation,
  };
  const stats = {
    basePower: emitter.basePower,
    tunedPower,
    depthScaledPower,
    combatDepthLevel,
    combatDepthScalar,
    level10PowerScalar: resolvedLevel10PowerScalar,
    effectivePower,
    rawEffectivePower,
    effectivePowerCap,
    rawEffectiveMultiplier,
    effectivePowerMultiplier: softCappedMultiplier,
    perChildPower,
    carrierPower,
    maxEnergy,
    energyCost,
    energyRemaining: maxEnergy - energyCost,
    baseRapid,
    nativeRapid: emitter.baseRapid,
    cycleTime,
    finalRapid,
    rootRange,
    childRange,
    projectileSpeed: emitter.projectileSpeed,
    projectileCount,
    shotsPerCharge,
    stagger,
    carrierStagger,
    peakProjectileReservation,
    programCapacityUsed: validation.semanticCapacityUsed,
    programCapacityMaximum: BUSTER_CHASSIS_CAPACITY,
    powerSoftCap,
    occupancy,
    tuningMultipliers: {
      power: powerMultiplier,
      range: rangeMultiplier,
      rapid: rapidMultiplier,
    },
  };

  const emitterConfiguration = {
    moduleId: emitter.id,
    speed: emitter.projectileSpeed,
    trajectory: emitter.trajectory,
    nativePayload: emitter.nativePayload,
    basePower: emitter.basePower,
    baseRange: emitter.baseRange,
    baseRapid: emitter.baseRapid,
  };
  const packets = {
    root: {
      count: trigger ? 1 : projectileCount,
      power: trigger ? rootPacketPower : perChildPower,
      totalPower: trigger ? rootPacketPower : terminalTotalPower,
      damagePower: trigger ? carrierPower : perChildPower,
      range: rootRange,
      speed: emitter.projectileSpeed,
    },
    carrier: trigger ? {
      count: 1,
      power: rootPacketPower,
      damagePower: carrierPower,
      range: rootRange,
      speed: emitter.projectileSpeed,
      stagger: carrierStagger,
    } : null,
    child: trigger ? {
      count: projectileCount,
      power: perChildPower,
      totalPower: terminalTotalPower,
      range: childRange,
      speed: emitter.projectileSpeed,
      stagger,
    } : null,
  };

  const actions = [];
  if (!trigger) {
    actions.push({
      actionId: 'emit-root',
      type: 'emit',
      scope: 'root',
      moduleId: emitter.id,
      count: projectileCount,
      power: perChildPower,
      totalPower: terminalTotalPower,
      range: rootRange,
      speed: emitter.projectileSpeed,
      trajectory: emitter.trajectory,
      guidance: Boolean(rootGuidance),
      splitter: splitterConfiguration,
      payload: payloadConfiguration,
      stagger,
    });
  } else {
    actions.push({
      actionId: 'emit-carrier',
      type: 'emit',
      scope: 'root',
      moduleId: emitter.id,
      count: 1,
      power: rootPacketPower,
      damagePower: carrierPower,
      range: rootRange,
      speed: emitter.projectileSpeed,
      trajectory: emitter.trajectory,
      guidance: Boolean(rootGuidance),
      payload: {
        moduleId: null,
        type: emitter.nativePayload,
        radius: 0,
        replacesDirect: false,
        implicit: true,
      },
      stagger: carrierStagger,
    });
    actions.push({
      actionId: 'trigger-child',
      type: 'trigger',
      scope: 'root',
      ...triggerConfiguration,
      carrierPower,
      childPower: terminalTotalPower,
      childActionId: 'emit-child',
    });
    actions.push({
      actionId: 'emit-child',
      type: 'emit',
      scope: 'child',
      moduleId: emitter.id,
      count: projectileCount,
      power: perChildPower,
      totalPower: terminalTotalPower,
      range: childRange,
      speed: emitter.projectileSpeed,
      trajectory: emitter.trajectory,
      guidance: Boolean(childGuidance),
      splitter: splitterConfiguration,
      payload: payloadConfiguration,
      stagger,
    });
  }

  const energyEntries = sequences.ordered.map((node) => {
    const definition = resolveDefinition(node.moduleId);
    return {
      nodeId: node.nodeId,
      moduleId: definition.id,
      moduleInstanceId: node.moduleInstanceId,
      energyCost: definition.energyCost,
      semanticCapacity: definition.semanticCapacity ?? 1,
    };
  });
  const cycleEntries = sequences.ordered
    .map((node) => ({
      nodeId: node.nodeId,
      moduleId: node.moduleId,
      delay: resolveDefinition(node.moduleId).cycleDelay,
    }))
    .filter((entry) => entry.delay > 0);
  const ledger = {
    energy: {
      maxEnergy,
      energyCost,
      remaining: maxEnergy - energyCost,
      entries: energyEntries,
    },
    cycle: {
      baseCycleTime,
      moduleDelay: cycleDelay,
      cycleTime,
      entries: cycleEntries,
    },
    power: {
      basePower: emitter.basePower,
      tunedPower,
      depthScaledPower,
      combatDepthLevel,
      combatDepthScalar,
      level10PowerScalar: resolvedLevel10PowerScalar,
      effectivePowerCap,
      rawEffectiveMultiplier,
      effectivePowerMultiplier: softCappedMultiplier,
      rawEffectivePower,
      effectivePower,
      capClipped,
      softCap: powerSoftCap,
      entries: powerLedger,
    },
    capacity: {
      used: validation.semanticCapacityUsed,
      maximum: BUSTER_CHASSIS_CAPACITY,
      entries: energyEntries.map(({ nodeId, moduleId, semanticCapacity }) => ({
        nodeId,
        moduleId,
        semanticCapacity,
      })),
    },
  };

  const preview = {
    title: `${emitter.label} Custom Buster`,
    emitter: emitterConfiguration,
    guidance: {
      root: rootGuidance ? { moduleId: rootGuidance.id, powerMultiplier: rootGuidance.powerMultiplier } : null,
      child: childGuidance ? { moduleId: childGuidance.id, powerMultiplier: childGuidance.powerMultiplier } : null,
    },
    rootGuidance: Boolean(rootGuidance),
    childGuidance: Boolean(childGuidance),
    trigger: triggerConfiguration,
    splitter: splitterConfiguration,
    payload: payloadConfiguration,
    packets,
    damage: {
      total: effectivePower,
      carrier: carrierPower,
      terminalBatch: terminalTotalPower,
      perProjectile: perChildPower,
      stagger,
      radius: payloadConfiguration.radius,
    },
    timing: {
      cycleTime,
      triggerDelay: trigger?.delay ?? 0,
    },
    trajectory,
    occupancy,
    powerSoftCap: powerSoftCap.active ? powerSoftCap : null,
  };
  const programOrder = {
    root: sequences.root.map((node) => node.nodeId),
    child: sequences.child.map((node) => node.nodeId),
  };
  const revision = getRevision(build, options);
  const description = createDescription({
    emitter,
    rootGuidance,
    trigger,
    childGuidance,
    splitter,
    payload: payloadConfiguration,
    stats,
    capClipped,
  });

  return deepFreezeBusterValue({
    ok: true,
    valid: true,
    schemaVersion: sourceBuild.schemaVersion,
    rulesetVersion: sourceBuild.rulesetVersion,
    buildId: sourceBuild.buildId,
    chassisId: sourceBuild.chassisId,
    weaponKey: sourceBuild.buildId,
    revision,
    buildRevision: revision,
    source: { build: sourceBuild, revision },
    sourceBuild,
    sourceRevision: revision,
    ...(diagnostics.diagnostic ? { diagnostic: diagnostics.diagnostic } : {}),
    warnings: validation.warnings,
    programOrder,
    emitter: emitterConfiguration,
    rootGuidance: Boolean(rootGuidance),
    trigger: triggerConfiguration,
    childGuidance: Boolean(childGuidance),
    splitter: splitterConfiguration,
    payload: payloadConfiguration,
    packets,
    rootPower: packets.root.power,
    carrierPower,
    childPower: terminalTotalPower,
    perChildPower,
    peakProjectileReservation,
    trajectory,
    occupancy,
    ledger,
    powerLedger,
    stats,
    actions,
    preview,
    description,
  });
}

/**
 * Compile the fixed Mega Buster pulse through the same immutable execution
 * pipeline as Custom Busters. `resolvedTuning` is supplied by the calibration
 * owner; this helper deliberately does not assume or install a starter part.
 */
export function compileMegaBusterPlan(configuration = {}, legacyOptions = {}) {
  const positionalTuning = isRecord(configuration)
    && !Object.prototype.hasOwnProperty.call(configuration, 'resolvedTuning')
    && TUNING_KEYS.every((key) => Object.prototype.hasOwnProperty.call(configuration, key));
  let resolvedTuning;
  let options;
  if (positionalTuning) {
    // Kept for callers from early v0.2 development; new integrations should
    // use the explicit object form below.
    resolvedTuning = configuration;
    options = legacyOptions;
  } else {
    const {
      resolvedTuning: authoredTuning = MEGA_BUSTER_BASE_PROFILE.tuning,
      calibrationRevision,
      ...compileOptions
    } = isRecord(configuration) ? configuration : {};
    resolvedTuning = authoredTuning;
    options = {
      ...compileOptions,
      ...(calibrationRevision === undefined ? {} : { revision: calibrationRevision }),
    };
  }
  const errors = [];
  if (!isRecord(resolvedTuning)) {
    errors.push(optionError(
      'INVALID_MEGA_TUNING',
      '/resolvedTuning',
      null,
      'Mega Buster tuning must contain four resolved ratings.',
    ));
  }
  const tuning = {};
  for (const key of TUNING_KEYS) {
    const value = resolvedTuning?.[key];
    if (!Number.isInteger(value) || value < BUSTER_TUNING_MIN || value > BUSTER_TUNING_MAX) {
      errors.push(optionError(
        'INVALID_MEGA_TUNING_RATING',
        `/resolvedTuning/${key}`,
        null,
        `${key} must be an integer from ${BUSTER_TUNING_MIN} through ${BUSTER_TUNING_MAX}.`,
      ));
    } else {
      tuning[key] = value;
    }
  }
  if (errors.length > 0) return compileFailure(errors, [], options);

  const source = {
    schemaVersion: CUSTOM_BUSTER_RULESET.schemaVersion,
    rulesetVersion: CUSTOM_BUSTER_RULESET.rulesetVersion,
    buildId: MEGA_BUSTER_BASE_PROFILE.buildId,
    chassisId: MEGA_BUSTER_BASE_PROFILE.chassisId,
    tuning: { ...MEGA_BUSTER_BASE_PROFILE.tuning },
    program: {
      rootNodeId: 'mega-pulse',
      nodes: [{
        nodeId: 'mega-pulse',
        moduleId: MEGA_BUSTER_BASE_PROFILE.emitterModuleId,
        moduleInstanceId: 'mega-pulse-core',
      }],
      edges: [],
    },
  };
  const compiled = compileBusterBuild(source, {
    ...options,
    [INTERNAL_RESOLVED_TUNING]: tuning,
  });
  if (!compiled?.ok) return compiled;

  const stats = compiled.stats;
  return deepFreezeBusterValue({
    ...compiled,
    weaponKey: MEGA_BUSTER_BASE_PROFILE.buildId,
    buildId: MEGA_BUSTER_BASE_PROFILE.buildId,
    isMegaBuster: true,
    resolvedTuning: tuning,
    preview: {
      ...compiled.preview,
      title: 'Mega Buster',
    },
    description: `Fixed Mega Buster Pulse. ${stats.shotsPerCharge} shots per battery; weapon-local PWR / ENG / RNG / RPD.`,
  });
}
