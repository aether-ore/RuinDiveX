import {
  BUSTER_CHASSIS_CAPACITY,
  BUSTER_CHILD_RANGE_MULTIPLIER,
  BUSTER_EFFECTIVE_POWER_CAP_MULTIPLIER,
  BUSTER_LEVEL_10_POWER_SCALAR,
  BUSTER_POWER_SOFT_CAP_ASYMPTOTE,
  BUSTER_POWER_SOFT_CAP_STEEPNESS,
  applyBusterPowerSoftCap,
  getBusterCombatDepthLevel,
  getBusterCombatDepthScalar,
  getBusterMaxEnergy,
  getBusterModuleDefinition,
  getBusterTuningMultiplier,
} from './catalog.js';
import { deepFreezeBusterValue } from './model.js';
import { validateBusterProgram } from './validation.js';

export class BusterCompileError extends Error {
  constructor(errors) {
    super(`Custom Buster compilation failed with ${errors.length} validation error${errors.length === 1 ? '' : 's'}.`);
    this.name = 'BusterCompileError';
    this.code = 'BUSTER_COMPILE_FAILED';
    this.errors = errors;
    Object.freeze(this);
  }
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

function readSequences(build) {
  const graph = buildGraph(build);
  const root = [];
  const child = [];
  let current = graph.nodeById.get(build.program.rootNodeId);
  let triggerNode = null;

  while (current) {
    root.push(current);
    const definition = getBusterModuleDefinition(current.moduleId);
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
  const validation = validateBusterProgram(build, options);
  if (!validation.valid) {
    if (options?.throwOnError === false) {
      return deepFreezeBusterValue({
        ok: false,
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }
    throw new BusterCompileError(validation.errors);
  }

  const sourceBuild = validation.normalizedBuild;
  const sequences = readSequences(sourceBuild);
  const emitterNode = sequences.root[0];
  const emitter = getBusterModuleDefinition(emitterNode.moduleId);
  const triggerNode = sequences.triggerNode;
  const trigger = triggerNode ? getBusterModuleDefinition(triggerNode.moduleId) : null;
  const rootGuidanceNode = sequences.root.find((node) => getBusterModuleDefinition(node.moduleId).kind === 'modifier') ?? null;
  const childGuidanceNode = sequences.child.find((node) => getBusterModuleDefinition(node.moduleId).kind === 'modifier') ?? null;
  const rootGuidance = rootGuidanceNode ? getBusterModuleDefinition(rootGuidanceNode.moduleId) : null;
  const childGuidance = childGuidanceNode ? getBusterModuleDefinition(childGuidanceNode.moduleId) : null;
  const splitterNode = sequences.ordered.find((node) => getBusterModuleDefinition(node.moduleId).kind === 'splitter') ?? null;
  const payloadNode = sequences.ordered.find((node) => getBusterModuleDefinition(node.moduleId).kind === 'payload') ?? null;
  const splitter = splitterNode ? getBusterModuleDefinition(splitterNode.moduleId) : null;
  const explicitPayload = payloadNode ? getBusterModuleDefinition(payloadNode.moduleId) : null;
  const splitterConfiguration = getSplitterConfiguration(splitter);
  const triggerConfiguration = getTriggerConfiguration(trigger);
  const payloadConfiguration = getPayloadConfiguration(explicitPayload, emitter);

  const powerMultiplier = getBusterTuningMultiplier(sourceBuild.tuning.power);
  const rangeMultiplier = getBusterTuningMultiplier(sourceBuild.tuning.range);
  const rapidMultiplier = getBusterTuningMultiplier(sourceBuild.tuning.rapid);
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
  const maxEnergy = getBusterMaxEnergy(sourceBuild.tuning.energy);
  const energyCost = sequences.ordered.reduce(
    (sum, node) => sum + getBusterModuleDefinition(node.moduleId).energyCost,
    0,
  );
  const cycleDelay = sequences.ordered.reduce(
    (sum, node) => sum + getBusterModuleDefinition(node.moduleId).cycleDelay,
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
    const definition = getBusterModuleDefinition(node.moduleId);
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
      delay: getBusterModuleDefinition(node.moduleId).cycleDelay,
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
