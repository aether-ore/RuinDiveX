import { BusterRuntime } from './BusterRuntime.js';
import {
  BUSTER_PROJECTILE_EVENT_EPSILON,
  BUSTER_PROJECTILE_GUIDANCE_STEP,
  BUSTER_PROJECTILE_MAX_EVENTS_PER_FRAME,
  chooseEarlierBusterProjectileEvent,
  chooseEarlierBusterProjectileImpact,
  chooseStableBusterGuidanceCandidate,
  createBusterSegmentPositionSampler,
  findSampledBusterCapsuleHitFraction,
  findStraightBusterCapsuleHitFraction,
  sphereIntersectsTargetCapsule,
  steerBusterDirection,
} from './BusterProjectileKernel.js';
import {
  getBallisticApexProgress,
  getClusterDirections,
  getSpreadDirections,
} from './BusterTrajectory.js';

const EPSILON = 1e-9;
const DEFAULT_STEP = 1 / 120;
const DEFAULT_DURATION = 30;
const EXTENSION_DURATION = 0.18;
const DEFAULT_SWAP_DURATION = 0.34;
const RECHARGE_DELAY = 0.65;
const RECHARGE_DURATION = 1.8;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value, digits = 9) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function vector(value = {}) {
  return { x: finite(value.x), y: finite(value.y), z: finite(value.z) };
}

function add(left, right) {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function subtract(left, right) {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function scale(value, multiplier) {
  return { x: value.x * multiplier, y: value.y * multiplier, z: value.z * multiplier };
}

function length(value) {
  return Math.hypot(value.x, value.y, value.z);
}

function normalize(value, fallback = { x: 0, y: 0, z: 1 }) {
  const magnitude = length(value);
  return magnitude > EPSILON ? scale(value, 1 / magnitude) : { ...fallback };
}

function lerp(left, right, alpha) {
  return {
    x: left.x + (right.x - left.x) * alpha,
    y: left.y + (right.y - left.y) * alpha,
    z: left.z + (right.z - left.z) * alpha,
  };
}

function distanceSquared(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return dx * dx + dy * dy + dz * dz;
}

export const BUSTER_BENCHMARK_FIXTURE = deepFreeze({
  fixedStep: DEFAULT_STEP,
  muzzle: { x: 0, y: 1.05, z: 0 },
  targetRadius: 0.58,
  targetHeight: 1.8,
  weakPointRadius: 0.24,
  weakPointHeight: 1.12,
  weakPointForwardOffset: 0.48,
  weakPointMultiplier: 2.4,
  bodyAimHeight: 1.05,
  guidanceAimHeight: 0.99,
  distances: { near: 3.2, mid: 4.8, far: 6 },
  chords: { compact: 1.2, separated: 2.5 },
  bodyAimOffsets: { center: 0, 'half-radius': 0.29, edge: 0.58 },
  weakPointAimOffsets: { center: 0, 'half-radius': 0.12, edge: 0.24 },
  lateralAmplitude: 2.2,
  lateralRate: 1.35,
  extensionDuration: EXTENSION_DURATION,
  swapDuration: DEFAULT_SWAP_DURATION,
});

const TARGET_PROFILE_DEFINITIONS = {
  ordinary: { id: 'ordinary', label: 'Ordinary Reaverbot', baseHealth: 24, healthPerLevel: 0.16, baseArmor: 0, armorPerLevel: 0 },
  armored: { id: 'armored', label: 'Armored Reaverbot', baseHealth: 58, healthPerLevel: 0.16, baseArmor: 12, armorPerLevel: 0.08 },
  elite: { id: 'elite', label: 'Elite Reaverbot', baseHealth: 43.2, healthPerLevel: 0.18, baseArmor: 10, armorPerLevel: 0.1 },
  medianProcedural: { id: 'medianProcedural', label: 'Median Procedural Reaverbot', baseHealth: 34, baseArmor: 8, procedural: true },
  weakPoint: { id: 'weakPoint', label: 'Weak-point Reaverbot', baseHealth: 34, baseArmor: 8, procedural: true, weakPointMultiplier: 2.4 },
};

export const BUSTER_BALANCE_TARGET_PROFILES = deepFreeze(TARGET_PROFILE_DEFINITIONS);

function resolveTargetProfile(profileId, level) {
  const profile = TARGET_PROFILE_DEFINITIONS[profileId] ?? TARGET_PROFILE_DEFINITIONS.ordinary;
  if (profile.procedural) {
    const tier = clamp(Math.round(level), 1, 8);
    return {
      ...profile,
      health: profile.baseHealth * (1 + (tier - 1) * 0.2) * 1.12,
      armor: profile.baseArmor * (1 + (tier - 1) * 0.12),
    };
  }
  return {
    ...profile,
    health: profile.baseHealth * (1 + Math.max(0, level - 1) * profile.healthPerLevel),
    armor: profile.baseArmor * (1 + Math.max(0, level - 1) * profile.armorPerLevel),
  };
}

function resolveProfileAndMotion(profile, motion) {
  if (profile === 'stationary') return { profileId: 'ordinary', motion: motion ?? 'stationary' };
  if (profile === 'moving') return { profileId: 'ordinary', motion: motion ?? 'lateral' };
  return { profileId: profile ?? 'ordinary', motion: motion ?? 'stationary' };
}

function targetAngles(targetCount, distance, chord) {
  if (targetCount <= 1) return [0];
  const delta = 2 * Math.asin(clamp(chord / (2 * distance), -1, 1));
  if (targetCount === 2) return [-delta / 2, delta / 2];
  return [-delta / 2, delta / 2, -3 * delta / 2, 3 * delta / 2].slice(0, targetCount);
}

function weakPointForTarget(target) {
  const root = target.root.position;
  const forward = normalize({ x: root.x, y: 0, z: root.z });
  return {
    x: root.x - forward.x * BUSTER_BENCHMARK_FIXTURE.weakPointForwardOffset,
    y: root.y + BUSTER_BENCHMARK_FIXTURE.weakPointHeight,
    z: root.z - forward.z * BUSTER_BENCHMARK_FIXTURE.weakPointForwardOffset,
  };
}

export function createBusterBenchmarkScenario(options = {}) {
  const level = clamp(Math.round(finite(options.level ?? options.depthLevel, 5)), 1, 10);
  const targetCount = [1, 2, 4].includes(Number(options.targetCount)) ? Number(options.targetCount) : 1;
  const distanceBand = Object.hasOwn(BUSTER_BENCHMARK_FIXTURE.distances, options.distanceBand)
    ? options.distanceBand
    : 'mid';
  const layout = options.layout === 'separated' ? 'separated' : 'compact';
  const distance = BUSTER_BENCHMARK_FIXTURE.distances[distanceBand];
  const chord = BUSTER_BENCHMARK_FIXTURE.chords[layout];
  const resolved = resolveProfileAndMotion(options.profile ?? options.targetProfileId, options.motion);
  const profile = resolveTargetProfile(resolved.profileId, level);
  const angles = targetAngles(targetCount, distance, chord);
  const nonlethal = options.nonlethal !== false;
  const targets = angles.map((angle, index) => {
    const home = {
      x: distance * Math.sin(angle),
      y: 0,
      z: distance * Math.cos(angle),
    };
    const forward = normalize({ x: home.x, y: 0, z: home.z });
    const right = { x: forward.z, y: 0, z: -forward.x };
    const targetMotion = resolved.motion === 'crossing'
      ? (index === 0 ? 'stationary' : 'lateral')
      : resolved.motion;
    return {
      id: `target-${String(index + 1).padStart(2, '0')}`,
      priority: index,
      radius: BUSTER_BENCHMARK_FIXTURE.targetRadius,
      collisionHeight: BUSTER_BENCHMARK_FIXTURE.targetHeight,
      root: { position: { ...home } },
      home,
      forward,
      right,
      motion: targetMotion,
      phase: resolved.motion === 'crossing' ? index * Math.PI : 0,
      maxHealth: nonlethal ? Number.POSITIVE_INFINITY : profile.health,
      health: nonlethal ? Number.POSITIVE_INFINITY : profile.health,
      armor: profile.armor,
      hasWeakPoint: resolved.profileId === 'weakPoint',
      weakPointMultiplier: resolved.profileId === 'weakPoint' ? 2.4 : 1,
      dead: false,
    };
  });
  return deepFreeze({
    id: options.id ?? [
      level,
      targetCount,
      resolved.profileId,
      distanceBand,
      layout,
      resolved.motion,
      options.aimOffset ?? 'center',
      options.aimOffset && options.aimOffset !== 'center' && options.aimSign === -1 ? 'negative' : 'positive',
    ].join(':'),
    level,
    combatDepthLevel: level,
    targetCount,
    targetProfileId: resolved.profileId,
    profile,
    distanceBand,
    distance,
    layout,
    motion: resolved.motion,
    aimOffset: options.aimOffset ?? 'center',
    aimSign: options.aimSign === -1 ? -1 : 1,
    aimAtWeakPoint: options.aimAtWeakPoint ?? resolved.profileId === 'weakPoint',
    nonlethal,
    duration: Math.max(0.01, finite(options.duration, DEFAULT_DURATION)),
    targets,
  });
}

export function createBusterBalanceScenarioMatrix() {
  const scenarios = [];
  for (const level of [1, 5, 10]) {
    for (const targetCount of [1, 2, 4]) {
      for (const profile of Object.keys(TARGET_PROFILE_DEFINITIONS)) {
        for (const distanceBand of ['near', 'mid', 'far']) {
          for (const layout of ['compact', 'separated']) {
            for (const motion of ['stationary', 'lateral']) {
              for (const aimOffset of ['center', 'half-radius', 'edge']) {
                for (const aimSign of aimOffset === 'center' ? [1] : [-1, 1]) {
                  scenarios.push(createBusterBenchmarkScenario({
                    level,
                    targetCount,
                    profile,
                    distanceBand,
                    layout,
                    motion,
                    aimOffset,
                    aimSign,
                    nonlethal: false,
                  }));
                }
              }
            }
          }
        }
      }
    }
  }
  return Object.freeze(scenarios);
}

function planKey(plan) {
  return String(plan?.weaponKey ?? plan?.buildId ?? 'buster');
}

export function createBusterBatterySchedule(plan, options = {}) {
  if (!plan?.ok || !plan?.stats) {
    return deepFreeze({
      status: plan?.diagnostic ? 'candidate-invalid' : 'invalid',
      wallClock: 0,
      combatClock: 0,
      clocks: { input: 0, release: 0, wall: 0, combat: 0 },
      releases: [],
      shotTimes: [],
      energyTimeline: [],
      timeline: [],
    });
  }
  const duration = Math.max(0, finite(options.duration ?? options.durationSeconds, DEFAULT_DURATION));
  const step = Math.max(1 / 1000, finite(options.timeStep ?? options.fixedStep, DEFAULT_STEP));
  const runtime = new BusterRuntime({ diagnosticContext: true, executeShot: () => true });
  runtime.equip(plan, { diagnosticContext: true });
  const key = planKey(plan);
  const releases = [];
  const energyTimeline = [];
  let time = 0;
  let nextTapIndex = 0;
  const tapTimes = Array.isArray(options.tapTimes) ? options.tapTimes.map(Number) : null;
  while (time <= duration + EPSILON) {
    const shouldRequest = tapTimes
      ? nextTapIndex < tapTimes.length && time + step * 0.5 >= tapTimes[nextTapIndex]
      : options.fireHeld !== false;
    if (shouldRequest) {
      const result = runtime.fire({ releaseTime: time }, key);
      if (result.ok) {
        releases.push(round(time));
        runtime.releaseReservation(result.execution.reservationToken);
      }
      if (tapTimes && time + step * 0.5 >= tapTimes[nextTapIndex]) nextTapIndex += 1;
    }
    const hud = runtime.getHudState(key);
    energyTimeline.push({
      time: round(time),
      energy: round(hud.energy),
      cycleRemaining: round(hud.cycleRemaining),
      rechargeDelayRemaining: round(hud.rechargeDelayRemaining),
      recoveryLocked: hud.recoveryLocked,
      state: hud.recoveryLocked ? 'RECOVERY' : hud.blockReason ?? 'READY',
    });
    if (time >= duration - EPSILON) break;
    const elapsed = Math.min(step, duration - time);
    runtime.update(elapsed, { activeWeaponKey: key, fireHeld: shouldRequest });
    time += elapsed;
  }
  const timeline = energyTimeline;
  const clocks = {
    release: round(duration),
    input: round(duration + EXTENSION_DURATION),
    combat: round(duration),
    wall: round(duration + EXTENSION_DURATION),
  };
  return deepFreeze({
    status: 'complete',
    wallClock: clocks.wall,
    combatClock: clocks.combat,
    clocks,
    releases,
    shotTimes: releases,
    energyTimeline: timeline,
    timeline,
    statuses: timeline,
    final: runtime.getHudState(key),
  });
}

function cloneScenarioTargets(scenario) {
  return scenario.targets.map((source) => ({
    ...source,
    root: { position: vector(source.root.position) },
    home: vector(source.home),
    forward: vector(source.forward),
    right: vector(source.right),
    damagedExecutions: new Set(),
    staggerByExecution: new Map(),
  }));
}

function updateTargetPositions(targets, time) {
  for (const target of targets) {
    const displacement = target.motion === 'lateral'
      ? Math.sin(time * BUSTER_BENCHMARK_FIXTURE.lateralRate + target.phase)
        * BUSTER_BENCHMARK_FIXTURE.lateralAmplitude
      : 0;
    target.root.position = add(target.home, scale(target.right, displacement));
  }
}

function aimPointForTarget(target, scenario, guidance = false) {
  const root = target.root.position;
  if (guidance) {
    // Production Guidance aims at the resolved combat target when that target
    // is itself a weak-point proxy. Benchmark targets are body owners, so their
    // free/locked homing point is the production body-height sample instead.
    if (target.isWeakPointTarget) return weakPointForTarget(target);
    return {
      x: root.x,
      y: root.y + BUSTER_BENCHMARK_FIXTURE.guidanceAimHeight,
      z: root.z,
    };
  }
  if (scenario.aimAtWeakPoint) {
    const point = weakPointForTarget(target);
    const offset = BUSTER_BENCHMARK_FIXTURE.weakPointAimOffsets[scenario.aimOffset] ?? 0;
    return add(point, scale(target.right, offset * scenario.aimSign));
  }
  const point = { x: root.x, y: root.y + BUSTER_BENCHMARK_FIXTURE.bodyAimHeight, z: root.z };
  const offset = BUSTER_BENCHMARK_FIXTURE.bodyAimOffsets[scenario.aimOffset] ?? 0;
  return add(point, scale(target.right, offset * scenario.aimSign));
}

function selectTarget(targets) {
  return targets
    .filter((target) => !target.dead)
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))[0] ?? null;
}

function findSphereHitFraction(positionAt, center, radius) {
  const inside = (fraction) => distanceSquared(positionAt(fraction), center) <= radius * radius;
  if (inside(0)) return 0;
  let previous = 0;
  for (let index = 1; index <= 64; index += 1) {
    const fraction = index / 64;
    if (!inside(fraction)) {
      previous = fraction;
      continue;
    }
    let low = previous;
    let high = fraction;
    for (let iteration = 0; iteration < 28; iteration += 1) {
      const middle = (low + high) * 0.5;
      if (inside(middle)) high = middle;
      else low = middle;
    }
    return high;
  }
  return null;
}

function invalidSimulation(plan, errors = []) {
  return deepFreeze({
    status: plan?.diagnostic ? 'candidate-invalid' : 'invalid',
    wallClock: 0,
    combatClock: 0,
    clocks: { input: 0, release: 0, wall: 0, combat: 0 },
    errors,
    metrics: {},
    transcript: [],
    energyTimeline: [],
    targets: [],
  });
}

export function simulateBusterBalanceScenario(plan, authoredScenario = {}, options = {}) {
  if (!plan?.ok || !plan?.stats || !Array.isArray(plan.actions)) {
    return invalidSimulation(plan, plan?.errors ?? [{ code: 'INVALID_PLAN', message: 'A compiled plan is required.' }]);
  }
  const scenario = authoredScenario?.targets
    ? authoredScenario
    : createBusterBenchmarkScenario(authoredScenario);
  const duration = Math.max(0.01, finite(
    options.duration ?? options.durationSeconds ?? scenario.duration,
    DEFAULT_DURATION,
  ));
  const step = Math.max(1 / 1000, finite(options.timeStep ?? options.fixedStep, DEFAULT_STEP));
  const targets = cloneScenarioTargets(scenario);
  const transcript = [];
  const energyTimeline = [];
  const projectiles = [];
  const deliveredEvents = [];
  const executionTargetSets = new Map();
  const executionProjectileCounts = new Map();
  const executionReservations = new Map();
  const rootAction = plan.actions.find((action) => action.type === 'emit' && action.scope === 'root');
  const childAction = plan.actions.find((action) => action.type === 'emit' && action.scope === 'child') ?? null;
  const trigger = plan.actions.find((action) => action.type === 'trigger') ?? null;
  if (!rootAction) return invalidSimulation(plan, [{ code: 'MISSING_ROOT_ACTION', message: 'The plan has no root emission.' }]);

  let simulationTime = 0;
  let firstRelease = null;
  let firstImpact = null;
  let roomClear = null;
  let weakPointHits = 0;
  let staggerGranted = 0;
  let mitigation = 0;
  let incomingPower = 0;
  let misses = 0;
  let peakOccupancy = 0;
  let explosions = 0;
  let explosionTargetHits = 0;
  let shotsReleased = 0;
  let preFanOutBudgetPower = 0;
  let preFanOutAllocatedPower = 0;
  let runtime = null;

  const record = (type, fields = {}, eventTime = simulationTime) => {
    transcript.push({
      type,
      releaseTime: round(eventTime),
      inputTime: round(eventTime + EXTENSION_DURATION),
      ...fields,
    });
  };

  const releaseExecution = (executionId) => {
    const next = Math.max(0, (executionProjectileCounts.get(executionId) ?? 1) - 1);
    executionProjectileCounts.set(executionId, next);
    if (next === 0) {
      const token = executionReservations.get(executionId);
      if (token) runtime.releaseReservation(token);
    }
  };

  const incrementExecution = (executionId, reservationToken) => {
    executionProjectileCounts.set(executionId, (executionProjectileCounts.get(executionId) ?? 0) + 1);
    executionReservations.set(executionId, reservationToken);
  };

  const applyStagger = (target, executionId, nominal, dealt) => {
    if (dealt <= 0 || nominal <= 0) return 0;
    const previous = target.staggerByExecution.get(executionId) ?? { largest: 0, granted: 0 };
    const largest = Math.max(previous.largest, nominal);
    const additional = Math.max(0, largest - previous.granted);
    target.staggerByExecution.set(executionId, { largest, granted: previous.granted + additional });
    staggerGranted += additional;
    return additional;
  };

  const applyPacket = (target, power, projectile, {
    weakPoint = false,
    explosion = false,
    eventTime = simulationTime,
  } = {}) => {
    const multiplier = weakPoint && !explosion ? target.weakPointMultiplier : 1;
    const incoming = Math.max(0, finite(power)) * multiplier;
    const mitigated = incoming * (100 / (100 + Math.max(0, target.armor)));
    if (mitigated <= 0) return 0;
    incomingPower += incoming;
    mitigation += Math.max(0, incoming - mitigated);
    target.health = scenario.nonlethal ? target.health : Math.max(0, target.health - mitigated);
    target.dead = !scenario.nonlethal && target.health <= EPSILON;
    target.damagedExecutions.add(projectile.executionId);
    if (!executionTargetSets.has(projectile.executionId)) executionTargetSets.set(projectile.executionId, new Set());
    executionTargetSets.get(projectile.executionId).add(target.id);
    if (weakPoint && !explosion) weakPointHits += 1;
    const stagger = applyStagger(target, projectile.executionId, projectile.action.stagger ?? 0, mitigated);
    deliveredEvents.push({ time: eventTime, targetId: target.id, power: mitigated });
    if (firstImpact == null) firstImpact = eventTime;
    record(explosion ? 'explosion-hit' : 'direct-hit', {
      executionId: projectile.executionId,
      actionId: projectile.action.actionId,
      targetId: target.id,
      power: round(mitigated),
      weakPoint: Boolean(weakPoint && !explosion),
      stagger: round(stagger),
    }, eventTime);
    if (!scenario.nonlethal && roomClear == null && targets.every((candidate) => candidate.dead)) {
      roomClear = eventTime;
    }
    return mitigated;
  };

  const detonate = (projectile, eventTime = simulationTime) => {
    explosions += 1;
    let hits = 0;
    for (const target of targets) {
      if (target.dead) continue;
      if (!sphereIntersectsTargetCapsule({
        center: projectile.position,
        radius: projectile.action.payload?.radius ?? 1.55,
        target,
      })) continue;
      if (applyPacket(target, projectile.action.power ?? projectile.action.damagePower, projectile, {
        explosion: true,
        eventTime,
      }) > 0) hits += 1;
    }
    explosionTargetHits += hits;
    if (hits === 0) misses += 1;
    record('explosion', { executionId: projectile.executionId, actionId: projectile.action.actionId, hits }, eventTime);
  };

  const spawnAction = (
    action,
    origin,
    baseDirection,
    execution,
    scope,
    aimPoint = null,
    eventTime = simulationTime,
    lockedTarget = null,
  ) => {
    const spawnedProjectiles = [];
    const direction = normalize(baseDirection);
    const directions = action.splitter?.pattern === 'spread'
      ? getSpreadDirections(direction, action.splitter.angles ?? action.splitter.angleOffsets ?? [])
      : action.splitter?.pattern === 'radial'
        ? getClusterDirections(direction, action.count ?? action.splitter.count ?? 5)
        : Array.from({ length: Math.max(1, action.count ?? 1) }, () => direction);
    for (let index = 0; index < directions.length; index += 1) {
      const ballistic = action.trajectory === 'ballistic';
      const authoredDirection = normalize({
        x: directions[index].x,
        y: ballistic ? 0 : directions[index].y,
        z: directions[index].z,
      }, eventTime);
      const projectile = {
        action,
        scope,
        executionId: execution.executionId,
        reservationToken: execution.reservationToken,
        position: vector(origin),
        start: vector(origin),
        direction: authoredDirection,
        speed: Math.max(0, finite(action.speed)),
        range: Math.max(0.001, finite(action.range)),
        radius: action.moduleId === 'mortarShell' ? 0.22 : 0.17,
        distance: 0,
        elapsed: 0,
        arcHeight: ballistic ? Math.max(1.15, finite(action.range) * 0.2) : 0,
        baseY: finite(origin.y),
        endY: finite(aimPoint?.y, finite(origin.y)),
        executionAimPoint: aimPoint ? vector(aimPoint) : vector(origin),
        lockedTargetId: scope === 'root' && action.guidance && lockedTarget
          ? lockedTarget.id
          : null,
        guidanceTargetId: null,
        alive: true,
      };
      projectiles.push(projectile);
      spawnedProjectiles.push(projectile);
      incrementExecution(execution.executionId, execution.reservationToken);
      record('projectile-spawn', {
        executionId: execution.executionId,
        actionId: action.actionId,
        scope,
        projectileIndex: index,
        position: vector(origin),
        direction: vector(authoredDirection),
        trajectoryEndY: projectile.endY,
      });
    }
    return spawnedProjectiles;
  };

  const spawnRoot = (execution) => {
    const target = selectTarget(targets);
    if (!target) return false;
    const aimPoint = aimPointForTarget(target, scenario, false);
    const direction = normalize(subtract(aimPoint, BUSTER_BENCHMARK_FIXTURE.muzzle));
    executionTargetSets.set(execution.executionId, new Set());
    executionProjectileCounts.set(execution.executionId, 0);
    if (firstRelease == null) firstRelease = simulationTime;
    shotsReleased += 1;
    preFanOutBudgetPower += Math.max(0, finite(plan.stats.effectivePower));
    const allocated = rootAction.actionId === 'emit-carrier'
      ? Math.max(0, finite(rootAction.damagePower))
        + Math.max(0, finite(childAction?.totalPower, finite(childAction?.power) * Math.max(1, finite(childAction?.count, 1))))
      : Math.max(0, finite(rootAction.totalPower, finite(rootAction.power) * Math.max(1, finite(rootAction.count, 1))));
    preFanOutAllocatedPower += allocated;
    record('shot-release', { executionId: execution.executionId, weaponKey: execution.weaponKey, targetId: target.id });
    const spawned = spawnAction(
      rootAction,
      BUSTER_BENCHMARK_FIXTURE.muzzle,
      direction,
      execution,
      'root',
      aimPoint,
      simulationTime,
      target,
    ).length > 0;
    peakOccupancy = Math.max(peakOccupancy, projectiles.filter((entry) => entry.alive).length);
    return spawned;
  };

  runtime = new BusterRuntime({ diagnosticContext: true, executeShot: spawnRoot });
  runtime.equip(plan, { diagnosticContext: true });
  const key = planKey(plan);

  const spawnChild = (projectile, reason, eventTime = simulationTime) => {
    if (!childAction) return [];
    const execution = {
      executionId: projectile.executionId,
      reservationToken: projectile.reservationToken,
    };
    const spawned = spawnAction(
      childAction,
      projectile.position,
      projectile.direction,
      execution,
      'child',
      projectile.executionAimPoint,
      eventTime,
    );
    record('child-trigger', {
      executionId: projectile.executionId,
      reason,
      position: vector(projectile.position),
    }, eventTime);
    return spawned;
  };

  const disposeProjectile = (projectile) => {
    if (!projectile.alive) return;
    projectile.alive = false;
    releaseExecution(projectile.executionId);
  };

  const steerProjectile = (projectile, dt, eventTime = simulationTime) => {
    if (!projectile.action.guidance) return;
    const lockedTarget = projectile.lockedTargetId == null
      ? null
      : targets.find((target) => (
        target.id === projectile.lockedTargetId
          && target.active !== false
          && !target.dead
      )) ?? null;
    let chosen = lockedTarget ? {
      target: lockedTarget,
      targetId: lockedTarget.id,
      stableId: lockedTarget.id,
      point: aimPointForTarget(lockedTarget, scenario, true),
      distanceSquared: 0,
    } : {
      target: null,
      stableId: '\uffff',
      distanceSquared: Math.max(1, projectile.range) ** 2,
    };
    if (!lockedTarget) {
      for (const target of targets) {
        if (target.active === false || target.dead) continue;
        const point = aimPointForTarget(target, scenario, true);
        chosen = chooseStableBusterGuidanceCandidate(chosen, {
          target,
          targetId: target.id,
          stableId: target.id,
          point,
          distanceSquared: distanceSquared(projectile.position, point),
        });
      }
    }
    if (!chosen?.target) return;
    if (projectile.guidanceTargetId !== chosen.target.id) {
      projectile.guidanceTargetId = chosen.target.id;
      record('guidance-target', {
        executionId: projectile.executionId,
        actionId: projectile.action.actionId,
        scope: projectile.scope,
        targetId: chosen.target.id,
        locked: Boolean(lockedTarget),
      }, eventTime);
    }
    projectile.direction = steerBusterDirection(
      projectile.direction,
      subtract(chosen.point, projectile.position),
      4.2,
      dt,
    );
  };

  const advanceProjectile = (projectile, dt, frameOffset = 0) => {
    steerProjectile(projectile, dt, simulationTime + frameOffset);
    const travel = projectile.speed * dt;
    const previousPosition = vector(projectile.position);
    const positionAt = createBusterSegmentPositionSampler({
      start: previousPosition,
      direction: projectile.direction,
      travel,
      previousDistance: projectile.distance,
      range: projectile.range,
      baseY: projectile.baseY,
      endY: projectile.endY,
      arcHeight: projectile.arcHeight,
    });
    let event = null;
    if (projectile.action.actionId === 'emit-carrier' && trigger) {
      if (trigger.event === 'delay') {
        const delay = finite(trigger.delay, 0.6);
        if (projectile.elapsed < delay - EPSILON && projectile.elapsed + dt >= delay - EPSILON) {
          const fraction = clamp((delay - projectile.elapsed) / dt, 0, 1);
          event = chooseEarlierBusterProjectileEvent(event, { type: 'trigger', reason: 'delay', fraction, time: fraction * dt, priority: 0 });
        }
      } else if (trigger.event === 'apex') {
        const apexProgress = getBallisticApexProgress({
          start: { x: 0, y: projectile.baseY, z: 0 },
          end: { x: 0, y: projectile.endY, z: 0 },
          arcHeight: projectile.arcHeight,
        });
        const apexDistance = projectile.range * apexProgress;
        if (projectile.distance < apexDistance - EPSILON && projectile.distance + travel >= apexDistance - EPSILON) {
          const fraction = clamp((apexDistance - projectile.distance) / Math.max(travel, EPSILON), 0, 1);
          event = chooseEarlierBusterProjectileEvent(event, { type: 'trigger', reason: 'apex', fraction, time: fraction * dt, priority: 0 });
        }
      }
    }

    let impact = null;
    for (const target of targets) {
      if (target.dead) continue;
      const bodyFraction = projectile.arcHeight > 0
        ? findSampledBusterCapsuleHitFraction(positionAt, target, projectile.radius)
        : findStraightBusterCapsuleHitFraction(previousPosition, positionAt(1), target, projectile.radius);
      const weakFraction = target.hasWeakPoint
        ? findSphereHitFraction(
          positionAt,
          weakPointForTarget(target),
          BUSTER_BENCHMARK_FIXTURE.weakPointRadius + projectile.radius,
        )
        : null;
      const fraction = weakFraction != null && (bodyFraction == null || weakFraction <= bodyFraction + BUSTER_PROJECTILE_EVENT_EPSILON)
        ? weakFraction
        : bodyFraction;
      if (fraction == null) continue;
      const candidate = {
        fraction,
        target,
        targetId: target.id,
        weakPoint: weakFraction != null && Math.abs(weakFraction - fraction) <= BUSTER_PROJECTILE_EVENT_EPSILON,
      };
      if (chooseEarlierBusterProjectileImpact(impact, candidate) === candidate) impact = candidate;
    }
    if (impact) {
      event = chooseEarlierBusterProjectileEvent(event, {
        type: 'impact',
        fraction: impact.fraction,
        time: impact.fraction * dt,
        priority: 1,
        targetId: impact.target.id,
        impact,
      });
    }
    if (projectile.distance + travel >= projectile.range - EPSILON) {
      const fraction = clamp((projectile.range - projectile.distance) / Math.max(travel, EPSILON), 0, 1);
      event = chooseEarlierBusterProjectileEvent(event, { type: 'range', fraction, time: fraction * dt, priority: 2 });
    }

    if (!event) {
      projectile.position = positionAt(1);
      projectile.distance += travel;
      projectile.elapsed += dt;
      return { consumedTime: dt, spawned: [] };
    }
    projectile.position = positionAt(event.fraction);
    projectile.distance += travel * event.fraction;
    projectile.elapsed += dt * event.fraction;
    const eventTime = simulationTime + frameOffset + event.time;
    if (event.type === 'trigger') {
      const spawned = spawnChild(projectile, `${event.reason}Trigger`, eventTime);
      disposeProjectile(projectile);
      return { consumedTime: event.time, spawned };
    }
    if (event.type === 'impact') {
      let spawned = [];
      if (projectile.action.actionId === 'emit-carrier' && trigger) {
        if (trigger.event === 'impact') {
          applyPacket(event.impact.target, projectile.action.damagePower ?? 0, projectile, {
            weakPoint: event.impact.weakPoint,
            eventTime,
          });
        }
        spawned = spawnChild(
          projectile,
          trigger.event === 'impact' ? 'terminalRelay' : 'earlyCarrierTermination',
          eventTime,
        );
      } else if (projectile.action.payload?.type === 'explosion') {
        detonate(projectile, eventTime);
      } else {
        applyPacket(event.impact.target, projectile.action.damagePower ?? projectile.action.power, projectile, {
          weakPoint: event.impact.weakPoint,
          eventTime,
        });
      }
      disposeProjectile(projectile);
      return { consumedTime: event.time, spawned };
    }
    let spawned = [];
    if (projectile.action.actionId === 'emit-carrier' && trigger) {
      spawned = spawnChild(
        projectile,
        trigger.event === 'impact' ? 'terminalRelay' : 'earlyCarrierTermination',
        eventTime,
      );
    } else if (projectile.action.payload?.type === 'explosion') {
      detonate(projectile, eventTime);
    } else {
      misses += 1;
    }
    disposeProjectile(projectile);
    return { consumedTime: event.time, spawned };
  };

  const advanceProjectileWindow = (projectile, window, frameOffset = 0) => {
    let remaining = Math.max(0, window);
    let offset = Math.max(0, frameOffset);
    let processed = 0;
    while (projectile.alive
      && remaining > BUSTER_PROJECTILE_EVENT_EPSILON
      && processed < BUSTER_PROJECTILE_MAX_EVENTS_PER_FRAME) {
      const slice = projectile.action.guidance
        ? Math.min(remaining, BUSTER_PROJECTILE_GUIDANCE_STEP)
        : remaining;
      const outcome = advanceProjectile(projectile, slice, offset)
        ?? { consumedTime: slice, spawned: [] };
      const consumed = clamp(finite(outcome.consumedTime, slice), 0, slice);
      const childWindow = Math.max(0, remaining - consumed);
      const childOffset = offset + consumed;
      for (const child of outcome.spawned ?? []) {
        advanceProjectileWindow(child, childWindow, childOffset);
      }
      remaining = childWindow;
      offset = childOffset;
      processed += 1;
      if (!projectile.alive || consumed <= BUSTER_PROJECTILE_EVENT_EPSILON) break;
    }
  };

  while (simulationTime <= duration + EPSILON) {
    updateTargetPositions(targets, simulationTime);
    if (targets.some((target) => !target.dead)) runtime.fire({ releaseTime: simulationTime }, key);
    const hud = runtime.getHudState(key);
    energyTimeline.push({
      time: round(simulationTime),
      energy: round(hud.energy),
      cycleRemaining: round(hud.cycleRemaining),
      recoveryLocked: hud.recoveryLocked,
      state: hud.recoveryLocked ? 'RECOVERY' : hud.blockReason ?? 'READY',
    });
    if (simulationTime >= duration - EPSILON) break;
    const elapsed = Math.min(step, duration - simulationTime);
    for (const projectile of [...projectiles]) {
      if (!projectile.alive) continue;
      advanceProjectileWindow(projectile, elapsed);
    }
    peakOccupancy = Math.max(peakOccupancy, projectiles.filter((entry) => entry.alive).length);
    runtime.update(elapsed, { activeWeaponKey: key, fireHeld: true });
    simulationTime += elapsed;
    if (!scenario.nonlethal && targets.every((target) => target.dead)) {
      roomClear ??= simulationTime;
      break;
    }
  }

  const sumAt = (horizon) => deliveredEvents
    .filter((entry) => entry.time <= horizon + EPSILON)
    .reduce((sum, entry) => sum + entry.power, 0);
  const targetIdsAt10 = new Set(deliveredEvents.filter((entry) => entry.time <= 10 + EPSILON).map((entry) => entry.targetId));
  const executionCounts = [...executionTargetSets.values()].map((set) => set.size);
  const spentEnergy = Math.min(plan.stats.maxEnergy, plan.stats.energyCost * plan.stats.shotsPerCharge);
  const recoveryTime = Math.max(RECHARGE_DELAY, plan.stats.cycleTime)
    + RECHARGE_DURATION * (spentEnergy / plan.stats.maxEnergy);
  const metrics = {
    output10s: round(sumAt(10)),
    output30s: round(sumAt(30)),
    deliveredPower: round(deliveredEvents.reduce((sum, entry) => sum + entry.power, 0)),
    deliveredEncounterPower: round(deliveredEvents.reduce((sum, entry) => sum + entry.power, 0)),
    incomingPower: round(incomingPower),
    mitigation: round(mitigation),
    mitigatedPower: round(mitigation),
    openingMagazinePower: round(plan.stats.effectivePower * plan.stats.shotsPerCharge),
    recoveryTime: round(recoveryTime),
    peakOccupancy,
    peakProjectileOccupancy: peakOccupancy,
    shotsReleased,
    explosions,
    explosionTargetHits,
    weakPointHits,
    staggerGranted: round(staggerGranted),
    misses,
    uniqueTargetsDamagedPerTrigger: executionCounts.length > 0
      ? round(executionCounts.reduce((sum, count) => sum + count, 0) / executionCounts.length)
      : 0,
    uniqueTargetsDamaged10s: targetIdsAt10.size,
    releaseToFirstImpact: firstImpact == null || firstRelease == null ? null : round(firstImpact - firstRelease),
    inputToFirstImpact: firstImpact == null ? null : round(firstImpact + EXTENSION_DURATION),
    releaseRoomClear: roomClear == null || firstRelease == null ? null : round(roomClear - firstRelease),
    inputRoomClear: roomClear == null ? null : round(roomClear + EXTENSION_DURATION),
    singleTargetTtk: !scenario.nonlethal && scenario.targetCount === 1 && roomClear != null
      ? round(roomClear - (firstRelease ?? 0))
      : null,
    roomClearTime: roomClear == null ? null : round(roomClear - (firstRelease ?? 0)),
    preFanOutBudgetPower: round(preFanOutBudgetPower),
    preFanOutAllocatedPower: round(preFanOutAllocatedPower),
    preFanOutConservationDelta: round(preFanOutAllocatedPower - preFanOutBudgetPower),
  };
  const releaseClock = round(roomClear ?? duration);
  const clocks = {
    release: releaseClock,
    input: round(releaseClock + EXTENSION_DURATION),
    combat: releaseClock,
    wall: round(releaseClock + EXTENSION_DURATION),
  };
  return deepFreeze({
    status: roomClear != null ? 'cleared' : 'unresolved',
    wallClock: clocks.wall,
    combatClock: clocks.combat,
    clocks,
    scenario,
    metrics,
    transcript,
    energyTimeline,
    targets: targets.map((target) => ({
      id: target.id,
      health: target.health,
      dead: target.dead,
      damagedExecutions: [...target.damagedExecutions],
    })),
  });
}

export const simulateBusterEncounter = simulateBusterBalanceScenario;

export function summarizeBusterSimulation(result) {
  if (!result || !result.metrics) {
    return deepFreeze({
      status: 'invalid',
      wallClock: 0,
      combatClock: 0,
      clocks: { input: 0, release: 0, wall: 0, combat: 0 },
      metrics: {},
    });
  }
  const metrics = { ...result.metrics };
  return deepFreeze({
    status: result.status,
    wallClock: result.wallClock,
    combatClock: result.combatClock,
    clocks: { ...result.clocks },
    ...metrics,
    metrics,
  });
}

function advanceRotationBattery(weapon, dt, active) {
  const cycleBefore = weapon.cycle;
  const delayBefore = weapon.delay;
  weapon.cycle = Math.max(0, cycleBefore - dt);
  weapon.delay = Math.max(0, delayBefore - dt);
  const eligible = Math.max(0, dt - Math.max(cycleBefore, delayBefore));
  if (eligible > 0 && weapon.energy < weapon.maxEnergy) {
    weapon.energy = Math.min(
      weapon.maxEnergy,
      weapon.energy + weapon.maxEnergy / RECHARGE_DURATION * eligible * (active ? 1 : 0.5),
    );
  }
  if (weapon.locked && weapon.energy + EPSILON >= weapon.maxEnergy) {
    weapon.energy = weapon.maxEnergy;
    weapon.locked = false;
  }
}

function cloneRotationWeapons(weapons) {
  return weapons.map((weapon) => ({ ...weapon }));
}

function advanceRotationWeapons(weapons, elapsed, activeIndex) {
  const next = cloneRotationWeapons(weapons);
  for (let index = 0; index < next.length; index += 1) {
    advanceRotationBattery(next[index], elapsed, index === activeIndex);
  }
  return next;
}

function timeUntilRotationFire(weapon, active = true) {
  if (!weapon) return Infinity;
  if (weapon.locked) {
    const gate = Math.max(weapon.cycle, weapon.delay);
    const rate = weapon.maxEnergy / RECHARGE_DURATION * (active ? 1 : 0.5);
    return gate + Math.max(0, weapon.maxEnergy - weapon.energy) / Math.max(EPSILON, rate);
  }
  if (weapon.energy + EPSILON >= weapon.cost) return Math.max(0, weapon.cycle);
  const gate = Math.max(weapon.cycle, weapon.delay);
  const rate = weapon.maxEnergy / RECHARGE_DURATION * (active ? 1 : 0.5);
  return gate + Math.max(0, weapon.cost - weapon.energy) / Math.max(EPSILON, rate);
}

function rotationPhysicalKey(state) {
  const weapons = state.weapons.map((weapon) => [
    round(weapon.energy, 6),
    round(weapon.cycle, 6),
    round(weapon.delay, 6),
    weapon.locked ? 1 : 0,
  ].join('/')).join('|');
  return `${round(state.time, 6)}:${state.active}:${state.swappedWithoutFire ? 1 : 0}:${weapons}`;
}

function readHistory(history) {
  const events = [];
  for (let cursor = history; cursor; cursor = cursor.previous) events.push(cursor.event);
  return events.reverse();
}

function compareRotationResults(left, right) {
  if (!right) return -1;
  if (left.output > right.output + EPSILON) return -1;
  if (right.output > left.output + EPSILON) return 1;
  if (left.swaps !== right.swaps) return left.swaps - right.swaps;
  return left.orderKey.localeCompare(right.orderKey);
}

function createRotationDeliveryProfile(plan, authoredScenario) {
  const scenario = createBusterBenchmarkScenario({
    ...authoredScenario,
    targetCount: 1,
    nonlethal: true,
    duration: Math.max(4, finite(authoredScenario?.duration, 4)),
  });
  const simulation = simulateBusterBalanceScenario(plan, scenario, { duration: scenario.duration });
  const release = simulation.transcript.find((event) => event.type === 'shot-release');
  const executionId = release?.executionId ?? null;
  const events = simulation.transcript
    .filter((event) => executionId
      && event.executionId === executionId
      && (event.type === 'direct-hit' || event.type === 'explosion-hit'))
    .map((event) => ({
      offset: Math.max(0, finite(event.releaseTime) - finite(release.releaseTime)),
      power: Math.max(0, finite(event.power)),
      targetId: event.targetId,
    }));
  return {
    key: planKey(plan),
    plan,
    events,
    deliveredPower: events.reduce((sum, event) => sum + event.power, 0),
  };
}

function deliveredRotationPower(profile, releaseTime, horizon) {
  return profile.events.reduce((sum, event) => (
    releaseTime + event.offset <= horizon + EPSILON ? sum + event.power : sum
  ), 0);
}

function optimizeRotationHorizon(profiles, horizon, {
  swapDuration,
  braceDuration,
  maxTransitions,
} = {}) {
  const initial = {
    time: braceDuration,
    active: 0,
    output: 0,
    swaps: 0,
    braceTime: braceDuration,
    swapTime: 0,
    transitionLockTime: braceDuration,
    orderKey: '',
    history: null,
    swappedWithoutFire: false,
    weapons: profiles.map((profile) => ({
      key: profile.key,
      maxEnergy: profile.plan.stats.maxEnergy,
      energy: profile.plan.stats.maxEnergy,
      cost: profile.plan.stats.energyCost,
      cycleTime: profile.plan.stats.cycleTime,
      cycle: 0,
      delay: 0,
      locked: false,
    })),
  };
  const queue = [initial];
  const seen = new Map([[rotationPhysicalKey(initial), initial]]);
  let transitions = 0;
  let searchExhausted = true;
  let termination = null;
  let best = null;

  const consider = (state) => {
    if (compareRotationResults(state, best) < 0) best = state;
  };
  const enqueue = (state) => {
    if (state.time >= horizon - EPSILON) {
      consider({ ...state, time: horizon });
      return;
    }
    const key = rotationPhysicalKey(state);
    const existing = seen.get(key);
    if (existing) {
      const existingDominates = existing.output > state.output + EPSILON
        || (Math.abs(existing.output - state.output) <= EPSILON
          && (existing.swaps < state.swaps
            || (existing.swaps === state.swaps && existing.orderKey.localeCompare(state.orderKey) <= 0)));
      if (existingDominates) return;
    }
    seen.set(key, state);
    queue.push(state);
  };
  const advance = (state, elapsed, nextActive, event) => {
    const bounded = Math.max(0, Math.min(elapsed, horizon - state.time));
    const history = event ? { previous: state.history, event } : state.history;
    return {
      ...state,
      time: state.time + bounded,
      active: nextActive,
      weapons: advanceRotationWeapons(state.weapons, bounded, nextActive),
      history,
    };
  };

  const optimisticUpperBound = (state) => {
    const remaining = Math.max(0, horizon - state.time);
    let bound = state.output;
    for (let index = 0; index < state.weapons.length; index += 1) {
      const weapon = state.weapons[index];
      const profile = profiles[index];
      const cycleShots = Math.ceil(remaining / Math.max(EPSILON, weapon.cycleTime)) + 1;
      const optimisticEnergy = weapon.energy + (weapon.maxEnergy / RECHARGE_DURATION) * remaining;
      const energyShots = Math.floor(optimisticEnergy / Math.max(EPSILON, weapon.cost)) + 1;
      bound += Math.min(cycleShots, energyShots) * profile.deliveredPower;
    }
    return bound;
  };

  while (queue.length > 0) {
    const source = queue.pop();
    if (seen.get(rotationPhysicalKey(source)) !== source) continue;
    transitions += 1;
    if (transitions > maxTransitions) {
      searchExhausted = false;
      termination = {
        reason: 'transition-limit',
        limit: maxTransitions,
        processed: transitions,
      };
      break;
    }
    if (source.time >= horizon - EPSILON) {
      consider(source);
      continue;
    }
    if (best && optimisticUpperBound(source) < best.output - EPSILON) continue;

    const activeWeapon = source.weapons[source.active];
    let base = source;
    if (!activeWeapon.locked
      && activeWeapon.cycle <= EPSILON
      && activeWeapon.energy + EPSILON >= activeWeapon.cost) {
      const weapons = cloneRotationWeapons(source.weapons);
      const fired = weapons[source.active];
      fired.energy = Math.max(0, fired.energy - fired.cost);
      fired.cycle = fired.cycleTime;
      fired.delay = RECHARGE_DELAY;
      const profile = profiles[source.active];
      const delivered = deliveredRotationPower(profile, source.time, horizon);
      const fireEvent = {
        type: 'fire',
        inputTime: round(source.time),
        releaseTime: round(source.time - braceDuration),
        weaponKey: profile.key,
        deliveredPower: round(delivered),
      };
      base = {
        ...source,
        output: source.output + delivered,
        orderKey: `${source.orderKey}|${profile.key}`,
        weapons,
        history: { previous: source.history, event: fireEvent },
        swappedWithoutFire: false,
      };
    }

    const activeAfter = base.weapons[base.active];
    const wait = timeUntilRotationFire(activeAfter, true);
    const successors = [];
    if (Number.isFinite(wait) && wait > EPSILON) {
      successors.push(advance(base, wait, base.active, {
        type: 'wait',
        inputTime: round(base.time),
        duration: round(Math.min(wait, horizon - base.time)),
        weaponKey: activeAfter.key,
      }));
    } else if (wait <= EPSILON && base === source) {
      // This can only occur for a malformed zero-cycle plan. Do not create a
      // zero-time state loop; let the caller see an incomplete optimizer.
      searchExhausted = false;
      termination = {
        reason: 'zero-time-state-loop',
        limit: maxTransitions,
        processed: transitions,
      };
      consider(base);
    }

    const swapTargets = profiles
      .map((profile, index) => ({ key: profile.key, index }))
      .filter((entry) => entry.index !== base.active)
      .sort((left, right) => left.key.localeCompare(right.key));
    for (const target of base.swappedWithoutFire ? [] : swapTargets) {
      const elapsed = swapDuration + braceDuration;
      const swapped = advance(base, elapsed, target.index, {
        type: 'swap',
        inputTime: round(base.time),
        duration: round(Math.min(elapsed, horizon - base.time)),
        weaponKey: target.key,
      });
      swapped.swaps += 1;
      swapped.braceTime += braceDuration;
      swapped.swapTime += swapDuration;
      swapped.transitionLockTime += elapsed;
      swapped.orderKey = `${base.orderKey}|>${target.key}`;
      swapped.swappedWithoutFire = true;
      successors.push(swapped);
    }
    successors.sort((left, right) => {
      const leftWeapon = profiles[left.active];
      const rightWeapon = profiles[right.active];
      const leftScore = left.output + leftWeapon.deliveredPower / Math.max(EPSILON, leftWeapon.plan.stats.cycleTime);
      const rightScore = right.output + rightWeapon.deliveredPower / Math.max(EPSILON, rightWeapon.plan.stats.cycleTime);
      return leftScore - rightScore || right.orderKey.localeCompare(left.orderKey);
    });
    for (const successor of successors) {
      enqueue(successor);
    }
  }

  if (!best) {
    consider(initial);
  }
  const winner = best ?? initial;
  return {
    // The current frontier deliberately omits consecutive no-fire swaps and
    // canonicalizes floating state to six decimals. Even an exhausted search
    // is therefore exact only within that reduced policy, never a proof over
    // every physically representable input schedule.
    status: 'bounded',
    exact: false,
    optimality: 'unproven',
    searchExhausted,
    termination: termination ?? {
      reason: 'reduced-policy-exhausted',
      limit: maxTransitions,
      processed: transitions,
    },
    horizon,
    output: winner.output,
    outputLowerBound: winner.output,
    swaps: winner.swaps,
    braceTime: winner.braceTime,
    swapTime: winner.swapTime,
    transitionLockTime: winner.transitionLockTime,
    orderKey: winner.orderKey,
    transcript: readHistory(winner.history),
    transitions,
  };
}

function simulateSingleRotationWeapon(profile, horizon, braceDuration) {
  const weapon = {
    key: profile.key,
    maxEnergy: profile.plan.stats.maxEnergy,
    energy: profile.plan.stats.maxEnergy,
    cost: profile.plan.stats.energyCost,
    cycleTime: profile.plan.stats.cycleTime,
    cycle: 0,
    delay: 0,
    locked: false,
  };
  let time = braceDuration;
  let output = 0;
  while (time < horizon - EPSILON) {
    if (weapon.cycle <= EPSILON && weapon.energy + EPSILON >= weapon.cost) {
      weapon.energy = Math.max(0, weapon.energy - weapon.cost);
      weapon.cycle = weapon.cycleTime;
      weapon.delay = RECHARGE_DELAY;
      output += deliveredRotationPower(profile, time, horizon);
    }
    const wait = timeUntilRotationFire(weapon, true);
    if (!Number.isFinite(wait) || wait <= EPSILON) break;
    const elapsed = Math.min(wait, horizon - time);
    advanceRotationBattery(weapon, elapsed, true);
    time += elapsed;
  }
  return output;
}

export function simulateBusterRotation(plansOrOptions, authoredScenario = {}, options = {}) {
  let plans = plansOrOptions;
  let scenario = authoredScenario;
  let settings = options;
  if (!Array.isArray(plansOrOptions) && plansOrOptions && typeof plansOrOptions === 'object') {
    settings = { ...plansOrOptions, ...options };
    plans = plansOrOptions.plans ?? plansOrOptions.livePlans ?? plansOrOptions.canonicalPlans;
    scenario = plansOrOptions.scenario ?? authoredScenario;
  }
  if (!Array.isArray(plans) || plans.length !== 3 || plans.some((plan) => !plan?.ok || !plan?.stats)) {
    return deepFreeze({
      status: 'unavailable',
      reason: 'three-valid-unified-plans-required',
      wallClock: 0,
      combatClock: 0,
      clocks: { input: 0, release: 0, wall: 0, combat: 0 },
    });
  }
  const horizons = (settings.horizons ?? settings.durations ?? [30, 60])
    .map((value) => Math.max(0.01, finite(value)))
    .sort((left, right) => left - right);
  const swapDuration = Math.max(0, finite(settings.swapDuration, DEFAULT_SWAP_DURATION));
  const braceDuration = Math.max(0, finite(settings.braceDuration, EXTENSION_DURATION));
  const maxTransitions = Math.max(1000, Math.trunc(finite(settings.maxTransitions, 120000)));
  const benchmarkScenario = createBusterBenchmarkScenario({
    ...scenario,
    targetCount: 1,
    nonlethal: true,
  });
  if (benchmarkScenario.motion !== 'stationary') {
    return deepFreeze({
      status: 'unavailable',
      reason: 'rotation-requires-stationary-scenario',
      exact: false,
      optimality: 'unproven',
      wallClock: 0,
      combatClock: 0,
      clocks: { input: 0, release: 0, wall: 0, combat: 0 },
    });
  }
  const profiles = plans.map((plan) => createRotationDeliveryProfile(plan, benchmarkScenario));
  const reports = new Map(horizons.map((horizon) => [
    horizon,
    optimizeRotationHorizon(profiles, horizon, {
      swapDuration,
      braceDuration,
      maxTransitions,
    }),
  ]));
  const longestHorizon = horizons.at(-1);
  const longest = reports.get(longestHorizon);
  const output30s = reports.get(30)?.output ?? reports.get(horizons.find((value) => value >= 30))?.output ?? longest.output;
  const output60s = reports.get(60)?.output ?? longest.output;
  const bestSingleOutput = Math.max(...profiles.map((profile) => (
    simulateSingleRotationWeapon(profile, longestHorizon, braceDuration)
  )));
  const clocks = {
    release: round(Math.max(0, longestHorizon - braceDuration)),
    input: round(longestHorizon),
    combat: round(Math.max(0, longestHorizon - braceDuration)),
    wall: round(longestHorizon),
  };
  const result = {
    status: 'bounded',
    exact: false,
    optimality: 'unproven',
    inputPolicy: 'precision-tap/no-insufficient-requests',
    searchPolicy: {
      consecutiveNoFireSwaps: 'omitted-unproven',
      statePrecisionDecimals: 6,
      movingScenarios: 'unsupported',
    },
    wallClock: clocks.wall,
    combatClock: clocks.combat,
    clocks,
    output30s: round(output30s),
    output60s: round(output60s),
    outputLowerBound30s: round(reports.get(30)?.outputLowerBound ?? output30s),
    outputLowerBound60s: round(reports.get(60)?.outputLowerBound ?? output60s),
    bestSingleOutput: round(bestSingleOutput),
    advantageRatio: bestSingleOutput > 0 ? round(longest.output / bestSingleOutput) : null,
    swaps: longest.swaps,
    braceTime: round(longest.braceTime),
    swapTime: round(longest.swapTime),
    transitionLockTime: round(longest.transitionLockTime),
    transcript: longest.transcript,
    weaponOrder: profiles.map((profile) => profile.key),
    planOrder: profiles.map((profile) => profile.key),
    transitions: Object.fromEntries([...reports].map(([horizon, report]) => [horizon, report.transitions])),
    termination: Object.fromEntries([...reports].map(([horizon, report]) => [horizon, report.termination])),
    searchExhausted: Object.fromEntries([...reports].map(([horizon, report]) => [horizon, report.searchExhausted])),
  };
  return deepFreeze({
    ...result,
    rotationOutput30s: result.output30s,
    rotationOutput60s: result.output60s,
    rotationAdvantageRatio: result.advantageRatio,
    rotationSwaps: result.swaps,
    rotationBraceTime: result.braceTime,
    rotationSwapTime: result.swapTime,
    rotationTransitionLockTime: result.transitionLockTime,
  });
}
