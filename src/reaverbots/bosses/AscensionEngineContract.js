import {
  PLAYER_TRAVERSAL_CAPABILITIES,
  PLAYER_TRAVERSAL_ENVELOPE,
} from '../../TraversalCapabilities.js';
import { SeededRandom } from '../SeededRandom.js';

export const ASCENSION_ENGINE_PROFILE_ID = 'ascensionEngine';
export const ASCENSION_ENGINE_ENCOUNTER_REVISION = 2;
export const ASCENSION_ENGINE_SEAL_COUNT = 4;

/**
 * The Reliquary is a complete authored dungeon, not a prop inside a normal
 * boss room. These dimensions deliberately match the 42-70 unit footprint of
 * ordinary generated ruin rooms while preserving a single readable tower.
 */
export const ASCENSION_RELIQUARY_SCALE = Object.freeze({
  playableRadius: 32,
  voidRadius: 31.6,
  architectureRadius: 34,
  shellHeight: 82,
  floorDepth: -12,
  chamberDiameter: 64,
  summitRadius: 27,
  summitCombatRadius: 23,
  wallReboundRadius: 28,
  initialCheckpoint: Object.freeze({
    offset: Object.freeze([0, 0.12, 23]),
    size: Object.freeze([18, 0.5, 12]),
  }),
  checkpointSize: Object.freeze([18, 0.5, 12]),
  checkpointOffsetZ: 23,
  preparationCampCenter: Object.freeze([0, 0, 48]),
  preparationCampSize: Object.freeze([18, 0.5, 12]),
  minimumChamberPathLength: 36.4,
});

export const ASCENSION_ENGINE_MODES = Object.freeze({
  TRAVERSAL: 'traversal',
  PUNISH: 'punish',
  ESCAPE: 'escape',
  SUMMIT: 'summit',
  FINAL_CHARGE: 'finalCharge',
  DEFEATED: 'defeated',
});

export const ASCENSION_ENGINE_TUNING = Object.freeze({
  sealIntegrityHealthScale: 0.055,
  segmentHealthRatio: 1 / ASCENSION_ENGINE_SEAL_COUNT,
  checkpointHealFloorRatio: 0.5,
  punishWindowSeconds: 7,
  escapeObservationSeconds: 1.2,
  finalChargeSeconds: 5,
  finalChargeThresholdRatio: 0.42,
  failedMeteorHealthScale: 0.75,
  fallResetDepth: 4.5,
  shockwaveDamageScale: 0.72,
  shockwaveRadius: 7.2,
  launchVelocity: 18,
  summitLaunchVelocity: 18,
  launchHorizontalSpeed: 10,
  launchActivationRadius: 1.55,
  routeLeadEdgeClearance: 4.5,
  routeLeadHoverHeight: 3.5,
  routeLeadMinimumHoldSeconds: 0.35,
  routeImpactRecoverySeconds: 0.32,
  liftRiderReleaseGraceSeconds: 0.3,
  liftRiderAirborneHeight: 4.5,
  masteryShortcutRise: 3.82,
  masteryJumpReachMultiplier: 1.3,
});

function freezeRoute(route) {
  return Object.freeze(route.map((entry) => Object.freeze({
    ...entry,
    offset: Object.freeze([...entry.offset]),
    size: Object.freeze([...entry.size]),
  })));
}

/**
 * Authored, seed-independent encounter topology. Seeds choose attack cadence
 * and platform order, never the route's critical landing volumes.
 */
export const ASCENSION_RELIQUARY_SEGMENTS = Object.freeze([
  Object.freeze({
    index: 0,
    id: 'compressionFoundry',
    title: 'The Compression Foundry',
    startHeight: 0,
    checkpointHeight: 18,
    checkpointOffset: Object.freeze([0, 18, -23]),
    attackId: 'foundryPounce',
    route: freezeRoute([
      { id: 'foundryVentLower', role: 'launchVent', offset: [-4, 0.2, 16], size: [10, 0.5, 10], targetHeight: 3.2, sequence: 0 },
      { id: 'foundryLandingMiddle', role: 'landing', offset: [-15, 3.2, 10], size: [10, 0.5, 10], targetHeight: 3.2, sequence: 1 },
      { id: 'foundryCompressionLift', role: 'momentum', offset: [-20, 3.2, 0], size: [10, 0.55, 10], targetHeight: 8, sequence: 2 },
      { id: 'foundryLandingUpper', role: 'landing', offset: [-17, 8, -11], size: [10, 0.5, 10], targetHeight: 8, sequence: 3 },
      { id: 'foundryPistonLift', role: 'momentum', offset: [-9, 8, -20], size: [10, 0.55, 10], targetHeight: 13, sequence: 4 },
      { id: 'foundryVentUpper', role: 'launchVent', offset: [2, 13, -23], size: [10, 0.5, 10], targetHeight: 18, sequence: 5 },
    ]),
  }),
  Object.freeze({
    index: 1,
    id: 'brokenElevatorSpine',
    title: 'The Broken Elevator Spine',
    startHeight: 18,
    checkpointHeight: 40,
    checkpointOffset: Object.freeze([0, 40, 23]),
    attackId: 'wallRebound',
    route: freezeRoute([
      { id: 'elevatorCounterweightA', role: 'counterweight', offset: [-9, 18.2, -19], size: [10, 0.55, 10], targetHeight: 23, sequence: 0 },
      { id: 'elevatorLandingLower', role: 'landing', offset: [-18, 23, -11], size: [10, 0.5, 10], targetHeight: 23, sequence: 1 },
      { id: 'elevatorBridge', role: 'rotatingBridge', offset: [-20, 23, 0], size: [14, 0.5, 10], targetHeight: 23, sequence: 2 },
      { id: 'elevatorCounterweightMiddle', role: 'counterweight', offset: [-17, 23, 11], size: [10, 0.55, 10], targetHeight: 29, sequence: 3 },
      { id: 'elevatorLandingUpper', role: 'landing', offset: [-9, 29, 20], size: [10, 0.5, 10], targetHeight: 29, sequence: 4 },
      { id: 'elevatorBridgeUpper', role: 'rotatingBridge', offset: [2, 29, 23], size: [14, 0.5, 7], targetHeight: 29, sequence: 5 },
      { id: 'elevatorCounterweightB', role: 'counterweight', offset: [12, 29, 18], size: [10, 0.55, 10], targetHeight: 35, sequence: 6 },
      { id: 'elevatorCounterweightFinal', role: 'counterweight', offset: [5, 35, 23], size: [10, 0.55, 10], targetHeight: 40, sequence: 7 },
    ]),
  }),
  Object.freeze({
    index: 2,
    id: 'suspendedMachinerySea',
    title: 'The Suspended Machinery Sea',
    startHeight: 40,
    checkpointHeight: 64,
    checkpointOffset: Object.freeze([0, 64, -23]),
    attackId: 'launchChain',
    route: freezeRoute([
      { id: 'momentumPlatformOne', role: 'momentum', offset: [-9, 40.2, 19], size: [10, 0.55, 10], targetHeight: 46, sequence: 0 },
      { id: 'machineryLandingLower', role: 'landing', offset: [-18, 46, 11], size: [10, 0.5, 10], targetHeight: 46, sequence: 1 },
      { id: 'momentumPlatformTwo', role: 'momentum', offset: [-20, 46, 0], size: [10, 0.55, 10], targetHeight: 52, sequence: 2 },
      { id: 'machineryLandingMiddle', role: 'landing', offset: [-17, 52, -11], size: [10, 0.5, 10], targetHeight: 52, sequence: 3 },
      { id: 'momentumPlatformThree', role: 'momentum', offset: [-9, 52, -20], size: [10, 0.55, 10], targetHeight: 58, sequence: 4 },
      { id: 'machineryLandingUpper', role: 'landing', offset: [2, 58, -23], size: [10, 0.5, 10], targetHeight: 58, sequence: 5 },
      { id: 'momentumPlatformFour', role: 'momentum', offset: [12, 58, -18], size: [10, 0.55, 10], targetHeight: 64, sequence: 6 },
      { id: 'machinerySealApproach', role: 'landing', offset: [5, 64, -23], size: [10, 0.5, 10], targetHeight: 64, sequence: 7 },
    ]),
  }),
  Object.freeze({
    index: 3,
    id: 'summitTrial',
    title: 'The Summit Trial',
    startHeight: 64,
    checkpointHeight: 68.5,
    checkpointOffset: Object.freeze([0, 68.5, 0]),
    attackId: 'summitPounce',
    route: freezeRoute([
      { id: 'summitLaunchVent', role: 'launchVent', offset: [0, 64.2, -22], size: [10, 0.5, 10], targetHeight: 68.5, sequence: 0 },
    ]),
  }),
]);

export const ASCENSION_RELIQUARY_CHECKPOINTS = Object.freeze([
  Object.freeze({ id: 'ascensionCheckpoint:initialFloor', index: 0, segmentId: 'initialFloor' }),
  Object.freeze({ id: 'ascensionCheckpoint:compressionFoundry', index: 1, segmentId: 'compressionFoundry' }),
  Object.freeze({ id: 'ascensionCheckpoint:brokenElevatorSpine', index: 2, segmentId: 'brokenElevatorSpine' }),
  Object.freeze({ id: 'ascensionCheckpoint:suspendedMachinerySea', index: 3, segmentId: 'suspendedMachinerySea' }),
]);

export const ASCENSION_ENGINE_ATTACK_DECKS = Object.freeze({
  compressionFoundry: Object.freeze(['targetedPounce', 'targetedPounce', 'foundryVentImpact']),
  brokenElevatorSpine: Object.freeze(['wallRebound', 'counterweightImpact', 'wallRebound']),
  suspendedMachinerySea: Object.freeze(['launchChain', 'boosterWash', 'launchChain']),
  summitTrial: Object.freeze([
    'targetedPounce',
    'doubleRebound',
    'compressionSweep',
    'skyfallBreaker',
    'emergencyPogo',
  ]),
});

export function normalizeAscensionCheckpoint(value) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(ASCENSION_ENGINE_SEAL_COUNT - 1, parsed))
    : 0;
}

export function getAscensionCheckpoint(value = 0) {
  if (typeof value === 'string') {
    return ASCENSION_RELIQUARY_CHECKPOINTS.find((checkpoint) => checkpoint.id === value) ?? null;
  }
  return ASCENSION_RELIQUARY_CHECKPOINTS[normalizeAscensionCheckpoint(value)] ?? ASCENSION_RELIQUARY_CHECKPOINTS[0];
}

export function createAscensionEngineState({ checkpointIndex = 0 } = {}) {
  const securedCheckpoint = normalizeAscensionCheckpoint(checkpointIndex);
  const checkpoint = getAscensionCheckpoint(securedCheckpoint);
  return {
    revision: ASCENSION_ENGINE_ENCOUNTER_REVISION,
    mode: securedCheckpoint >= 3
      ? ASCENSION_ENGINE_MODES.ESCAPE
      : ASCENSION_ENGINE_MODES.TRAVERSAL,
    segmentIndex: securedCheckpoint,
    securedCheckpoint,
    securedCheckpointId: checkpoint.id,
    brokenSeals: Array.from({ length: ASCENSION_ENGINE_SEAL_COUNT }, (_, index) => index < securedCheckpoint),
    activeSealIndex: null,
    punishRemaining: 0,
    finalChargeRemaining: 0,
    finalChargeFailures: 0,
  };
}

export function breakAscensionSeal(state, sealIndex) {
  if (!state || state.mode === ASCENSION_ENGINE_MODES.DEFEATED) {
    return { ok: false, reason: 'inactive', state };
  }
  const index = Math.trunc(Number(sealIndex));
  if (index !== state.segmentIndex || index !== state.activeSealIndex) {
    return { ok: false, reason: 'wrong-seal', state };
  }
  if (state.brokenSeals[index]) return { ok: true, unchanged: true, state };

  const brokenSeals = [...state.brokenSeals];
  brokenSeals[index] = true;
  if (index === ASCENSION_ENGINE_SEAL_COUNT - 1) {
    return {
      ok: true,
      completed: true,
      checkpointIndex: state.securedCheckpoint,
      state: {
        ...state,
        brokenSeals,
        activeSealIndex: null,
        mode: ASCENSION_ENGINE_MODES.DEFEATED,
      },
    };
  }

  const nextIndex = index + 1;
  const nextCheckpoint = getAscensionCheckpoint(nextIndex);
  return {
    ok: true,
    completed: false,
    checkpointIndex: nextIndex,
    checkpointId: nextCheckpoint.id,
    state: {
      ...state,
      brokenSeals,
      activeSealIndex: null,
      segmentIndex: nextIndex,
      securedCheckpoint: nextIndex,
      securedCheckpointId: nextCheckpoint.id,
      mode: ASCENSION_ENGINE_MODES.ESCAPE,
      punishRemaining: 0,
      finalChargeRemaining: 0,
    },
  };
}

export function createAscensionAttackSequence({ seed = 'ascension-engine', segmentIndex = 0, cycle = 0 } = {}) {
  const segment = ASCENSION_RELIQUARY_SEGMENTS[normalizeAscensionCheckpoint(segmentIndex)];
  const authored = ASCENSION_ENGINE_ATTACK_DECKS[segment.id] ?? ASCENSION_ENGINE_ATTACK_DECKS.summitTrial;
  const rng = new SeededRandom(`${seed}:${segment.id}:cycle:${Math.max(0, Math.trunc(Number(cycle) || 0))}`);
  const remaining = [...authored];
  const result = [];
  while (remaining.length > 0) {
    const selected = rng.pick(remaining);
    result.push(selected);
    remaining.splice(remaining.indexOf(selected), 1);
  }
  return Object.freeze(result);
}

export function getAscensionTraversalDiagnostics() {
  const maximumNormalRise = PLAYER_TRAVERSAL_ENVELOPE.maximumNormalJumpRise;
  const maximumLedgeRise = PLAYER_TRAVERSAL_ENVELOPE.maximumLedgeClimbRise;
  const maximumGap = PLAYER_TRAVERSAL_ENVELOPE.maximumHorizontalJumpDistance;
  const maximumMasteryLedgeRise = maximumLedgeRise
    * ASCENSION_ENGINE_TUNING.masteryJumpReachMultiplier;
  const jumpGravity = (2 * PLAYER_TRAVERSAL_CAPABILITIES.jumpHeight)
    / (PLAYER_TRAVERSAL_CAPABILITIES.jumpTimeToApex ** 2);
  const summitSegment = ASCENSION_RELIQUARY_SEGMENTS[3];
  const summitVent = summitSegment.route[0];
  const summitRequiredRise = summitSegment.checkpointHeight - summitVent.offset[1];
  const summitApexRise = (ASCENSION_ENGINE_TUNING.summitLaunchVelocity ** 2) / (2 * jumpGravity);
  const summitAscentSeconds = ASCENSION_ENGINE_TUNING.summitLaunchVelocity / jumpGravity;
  const summitDescentSeconds = Math.sqrt(
    Math.max(0, 2 * (summitApexRise - summitRequiredRise))
      / (jumpGravity * PLAYER_TRAVERSAL_CAPABILITIES.fallGravityMultiplier),
  );
  const summitMaximumHorizontalDrift = ASCENSION_ENGINE_TUNING.launchHorizontalSpeed
    * (summitAscentSeconds + summitDescentSeconds);
  const landingSafetyInset = 0.3;
  const routes = [];
  const segments = [];
  const projectedHalfExtent = (size, dx, dz) => {
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.0001) return Math.min(size[0], size[2]) * 0.5;
    return (Math.abs(dx / distance) * size[0] + Math.abs(dz / distance) * size[2]) * 0.5;
  };
  const axisAlignedEdgeGap = (from, to, dx, dz) => Math.hypot(
    Math.max(0, Math.abs(dx) - (from.size[0] + to.size[0]) * 0.5),
    Math.max(0, Math.abs(dz) - (from.size[2] + to.size[2]) * 0.5),
  );
  const getLaunchFlight = (requiredRise, velocity = ASCENSION_ENGINE_TUNING.launchVelocity) => {
    const apexRise = (velocity ** 2) / (2 * jumpGravity);
    if (requiredRise > apexRise) {
      return { apexRise, seconds: 0, horizontalTravel: 0, reachable: false };
    }
    const ascentSeconds = velocity / jumpGravity;
    const descentSeconds = Math.sqrt(
      Math.max(0, 2 * (apexRise - Math.max(0, requiredRise)))
        / (jumpGravity * PLAYER_TRAVERSAL_CAPABILITIES.fallGravityMultiplier),
    );
    const seconds = ascentSeconds + descentSeconds;
    return {
      apexRise,
      seconds,
      horizontalTravel: ASCENSION_ENGINE_TUNING.launchHorizontalSpeed * seconds,
      reachable: true,
    };
  };
  for (const segment of ASCENSION_RELIQUARY_SEGMENTS) {
    const start = segment.index === 0
      ? {
        id: 'ascensionCheckpoint:initialFloor',
        role: 'checkpoint',
        offset: ASCENSION_RELIQUARY_SCALE.initialCheckpoint.offset,
        size: ASCENSION_RELIQUARY_SCALE.initialCheckpoint.size,
        targetHeight: ASCENSION_RELIQUARY_SCALE.initialCheckpoint.offset[1],
      }
      : {
        id: `ascensionCheckpoint:${ASCENSION_RELIQUARY_SEGMENTS[segment.index - 1].id}`,
        role: 'checkpoint',
        offset: ASCENSION_RELIQUARY_SEGMENTS[segment.index - 1].checkpointOffset,
        size: ASCENSION_RELIQUARY_SCALE.checkpointSize,
        targetHeight: segment.startHeight,
      };
    let previous = start;
    let criticalPathLength = 0;
    const segmentRoutes = [];
    for (const step of segment.route) {
      const dx = step.offset[0] - previous.offset[0];
      const dz = step.offset[2] - previous.offset[2];
      const centerGap = Math.hypot(dx, dz);
      const edgeGap = axisAlignedEdgeGap(previous, step, dx, dz);
      const previousTop = Number(previous.targetHeight ?? previous.offset[1]);
      const rise = Math.max(0, step.offset[1] - previousTop);
      const assisted = previous.role === 'launchVent'
        || previous.role === 'momentum'
        || previous.role === 'counterweight';
      const mechanismRise = Math.max(0, step.targetHeight - step.offset[1]);
      const mechanismReachable = step.role !== 'launchVent'
        || getLaunchFlight(mechanismRise).reachable;
      const launchFlight = previous.role === 'launchVent'
        ? getLaunchFlight(step.offset[1] - previous.offset[1])
        : null;
      const launchLandingHalfExtent = launchFlight
        ? Math.max(0, projectedHalfExtent(step.size, dx, dz) - landingSafetyInset)
        : 0;
      const launchLandingError = launchFlight
        ? Math.max(
          Math.abs(centerGap - ASCENSION_ENGINE_TUNING.launchActivationRadius - launchFlight.horizontalTravel),
          Math.abs(centerGap + ASCENSION_ENGINE_TUNING.launchActivationRadius - launchFlight.horizontalTravel),
        )
        : 0;
      const launchReachable = !launchFlight || (
        launchFlight.reachable && launchLandingError <= launchLandingHalfExtent
      );
      const diagnostic = Object.freeze({
        segmentId: segment.id,
        stepId: step.id,
        role: step.role,
        sequence: step.sequence,
        centerGap,
        edgeGap,
        rise,
        mechanismRise,
        mechanismReachable,
        launchReachable,
        launchHorizontalTravel: launchFlight?.horizontalTravel ?? 0,
        launchLandingError,
        launchLandingHalfExtent,
        assisted,
        impactGated: true,
        requiresPriorImpact: step.sequence > 0,
        reachable: edgeGap + landingSafetyInset * 2 <= maximumGap
          && rise <= maximumLedgeRise + 0.1
          && mechanismReachable
          && launchReachable,
        normallyJumpable: edgeGap + landingSafetyInset * 2 <= maximumGap
          && rise <= maximumNormalRise,
      });
      routes.push(diagnostic);
      segmentRoutes.push(diagnostic);
      criticalPathLength += centerGap;
      previous = step;
    }

    const checkpointOffset = segment.checkpointOffset;
    const terminalSize = segment.index === ASCENSION_RELIQUARY_SEGMENTS.length - 1
      ? [ASCENSION_RELIQUARY_SCALE.summitRadius * 2, 0.5, ASCENSION_RELIQUARY_SCALE.summitRadius * 2]
      : ASCENSION_RELIQUARY_SCALE.checkpointSize;
    const terminalDx = checkpointOffset[0] - previous.offset[0];
    const terminalDz = checkpointOffset[2] - previous.offset[2];
    const terminalCenterGap = Math.hypot(terminalDx, terminalDz);
    const terminalTarget = { size: terminalSize };
    const terminalEdgeGap = axisAlignedEdgeGap(
      previous,
      terminalTarget,
      terminalDx,
      terminalDz,
    );
    const terminalRise = Math.max(
      0,
      checkpointOffset[1] - Number(previous.targetHeight ?? previous.offset[1]),
    );
    const terminalLaunch = previous.role === 'launchVent'
      ? getLaunchFlight(
        checkpointOffset[1] - previous.offset[1],
        segment.index === 3
          ? ASCENSION_ENGINE_TUNING.summitLaunchVelocity
          : ASCENSION_ENGINE_TUNING.launchVelocity,
      )
      : null;
    const terminalLaunchHalfExtent = terminalLaunch
      ? Math.max(
        0,
        (segment.index === 3
          ? ASCENSION_RELIQUARY_SCALE.summitRadius
          : projectedHalfExtent(terminalSize, terminalDx, terminalDz)) - landingSafetyInset,
      )
      : 0;
    const terminalLaunchError = terminalLaunch
      ? Math.max(
        Math.abs(terminalCenterGap - ASCENSION_ENGINE_TUNING.launchActivationRadius - terminalLaunch.horizontalTravel),
        Math.abs(terminalCenterGap + ASCENSION_ENGINE_TUNING.launchActivationRadius - terminalLaunch.horizontalTravel),
      )
      : 0;
    const terminalLaunchReachable = !terminalLaunch || (
      terminalLaunch.reachable && terminalLaunchError <= terminalLaunchHalfExtent
    );
    const terminal = Object.freeze({
      segmentId: segment.id,
      stepId: `${segment.id}:sealStation`,
      role: 'sealStation',
      sequence: segment.route.length,
      centerGap: terminalCenterGap,
      edgeGap: terminalEdgeGap,
      rise: terminalRise,
      mechanismRise: 0,
      mechanismReachable: true,
      launchReachable: terminalLaunchReachable,
      launchHorizontalTravel: terminalLaunch?.horizontalTravel ?? 0,
      launchLandingError: terminalLaunchError,
      launchLandingHalfExtent: terminalLaunchHalfExtent,
      assisted: previous.role === 'launchVent',
      impactGated: false,
      requiresPriorImpact: true,
      reachable: terminalEdgeGap + landingSafetyInset * 2 <= maximumGap
        && terminalRise <= maximumLedgeRise + 0.1
        && terminalLaunchReachable,
      normallyJumpable: terminalEdgeGap + landingSafetyInset * 2 <= maximumGap
        && terminalRise <= maximumNormalRise,
    });
    routes.push(terminal);
    segmentRoutes.push(terminal);
    criticalPathLength += terminalCenterGap;
    segments.push(Object.freeze({
      segmentId: segment.id,
      startHeight: segment.startHeight,
      checkpointHeight: segment.checkpointHeight,
      rise: segment.checkpointHeight - segment.startHeight,
      playableDiameter: ASCENSION_RELIQUARY_SCALE.chamberDiameter,
      criticalPathLength,
      routeStepCount: segment.route.length,
      complete: segmentRoutes.every((route) => route.reachable),
    }));
  }
  const masteryShortcuts = ASCENSION_RELIQUARY_SEGMENTS.map((segment) => Object.freeze({
    segmentId: segment.id,
    rise: ASCENSION_ENGINE_TUNING.masteryShortcutRise,
    normallyReachable: ASCENSION_ENGINE_TUNING.masteryShortcutRise <= maximumLedgeRise,
    jumpSpringsReachable: ASCENSION_ENGINE_TUNING.masteryShortcutRise <= maximumMasteryLedgeRise,
  }));
  return Object.freeze({
    maximumNormalRise,
    maximumLedgeRise,
    maximumGap,
    minimumLandingWidth: PLAYER_TRAVERSAL_ENVELOPE.minimumLandingWidth,
    landingSafetyInset,
    maximumMasteryLedgeRise,
    routes: Object.freeze(routes),
    segments: Object.freeze(segments),
    totalCriticalPathLength: segments.reduce((total, segment) => total + segment.criticalPathLength, 0),
    totalRise: ASCENSION_RELIQUARY_SEGMENTS.at(-1).checkpointHeight
      - ASCENSION_RELIQUARY_SEGMENTS[0].startHeight,
    playableDiameter: ASCENSION_RELIQUARY_SCALE.chamberDiameter,
    summitDiameter: ASCENSION_RELIQUARY_SCALE.summitRadius * 2,
    masteryShortcuts: Object.freeze(masteryShortcuts),
    reachable: routes.every((route) => route.reachable),
    requiresBossMechanics: ASCENSION_RELIQUARY_SEGMENTS.every((segment) => (
      routes.some((route) => route.segmentId === segment.id && route.impactGated)
    )),
    masteryRouteReachable: masteryShortcuts.every((route) => route.jumpSpringsReachable),
    masteryRouteRequiresJumpSprings: masteryShortcuts.every((route) => (
      !route.normallyReachable && route.jumpSpringsReachable
    )),
    summitLaunch: Object.freeze({
      requiredRise: summitRequiredRise,
      apexRise: summitApexRise,
      maximumHorizontalDrift: summitMaximumHorizontalDrift,
      centerGap: Math.hypot(
        summitSegment.checkpointOffset[0] - summitVent.offset[0],
        summitSegment.checkpointOffset[2] - summitVent.offset[2],
      ),
      landingRadius: ASCENSION_RELIQUARY_SCALE.summitRadius,
      reachable: summitApexRise >= summitRequiredRise
        && Math.abs(
          Math.hypot(
            summitSegment.checkpointOffset[0] - summitVent.offset[0],
            summitSegment.checkpointOffset[2] - summitVent.offset[2],
          ) - summitMaximumHorizontalDrift,
        ) <= ASCENSION_RELIQUARY_SCALE.summitRadius
          - PLAYER_TRAVERSAL_CAPABILITIES.collisionRadius,
    }),
  });
}
