const EPSILON = 1e-12;

function nonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a finite non-negative number.`);
  return Number(value);
}

export function normalizeHazardPhases(definition = {}) {
  if (Array.isArray(definition.phases) && definition.phases.length > 0) {
    return definition.phases.map((phase, index) => ({
      id: String(phase.id ?? `phase-${index}`),
      durationSeconds: nonNegative(phase.durationSeconds, `phases[${index}].durationSeconds`),
      active: phase.active === true || phase.id === 'active' || phase.id === 'energized',
    }));
  }
  const grace = nonNegative(definition.graceSeconds ?? definition.entryGraceSeconds ?? 0, 'graceSeconds');
  const active = nonNegative(definition.activeSeconds ?? 0, 'activeSeconds');
  const recovery = nonNegative(definition.recoverySeconds ?? 0, 'recoverySeconds');
  return [
    ...(grace > 0 ? [{ id: 'grace', durationSeconds: grace, active: false }] : []),
    { id: 'active', durationSeconds: active, active: true },
    ...(recovery > 0 ? [{ id: 'recovery', durationSeconds: recovery, active: false }] : []),
  ];
}

export function getCyclicHazardPhaseAt(definition, elapsedSeconds) {
  const phases = normalizeHazardPhases(definition);
  const cycleSeconds = phases.reduce((sum, phase) => sum + phase.durationSeconds, 0);
  if (cycleSeconds <= EPSILON) throw new RangeError('Hazard phase cycle must have positive duration.');
  const elapsed = nonNegative(elapsedSeconds, 'elapsedSeconds');
  const local = ((elapsed % cycleSeconds) + cycleSeconds) % cycleSeconds;
  let cursor = 0;
  for (const phase of phases) {
    cursor += phase.durationSeconds;
    if (local < cursor - EPSILON) return { ...phase, localSeconds: local, cycleSeconds };
  }
  return { ...phases.at(-1), localSeconds: local, cycleSeconds };
}

export function integrateCyclicHazardActiveSeconds(definition, startSeconds, durationSeconds) {
  const start = nonNegative(startSeconds, 'startSeconds');
  let remaining = nonNegative(durationSeconds, 'durationSeconds');
  if (remaining <= EPSILON) return 0;
  const phases = normalizeHazardPhases(definition);
  const cycleSeconds = phases.reduce((sum, phase) => sum + phase.durationSeconds, 0);
  if (cycleSeconds <= EPSILON) throw new RangeError('Hazard phase cycle must have positive duration.');
  const activePerCycle = phases.reduce((sum, phase) => sum + (phase.active ? phase.durationSeconds : 0), 0);
  let activeSeconds = 0;
  let cursor = start;

  if (remaining >= cycleSeconds) {
    const completeCycles = Math.floor(remaining / cycleSeconds);
    activeSeconds += completeCycles * activePerCycle;
    cursor += completeCycles * cycleSeconds;
    remaining -= completeCycles * cycleSeconds;
  }
  while (remaining > EPSILON) {
    const phase = getCyclicHazardPhaseAt({ phases }, cursor);
    let phaseStart = 0;
    for (const entry of phases) {
      if (entry.id === phase.id) break;
      phaseStart += entry.durationSeconds;
    }
    const phaseElapsed = phase.localSeconds - phaseStart;
    const slice = Math.min(remaining, Math.max(EPSILON, phase.durationSeconds - phaseElapsed));
    if (phase.active) activeSeconds += slice;
    cursor += slice;
    remaining -= slice;
  }
  return activeSeconds;
}

export function integrateHazardExposureV2(definition, previous = {}, {
  durationSeconds,
  globalStartSeconds = 0,
  inside = true,
} = {}) {
  const dt = nonNegative(durationSeconds, 'durationSeconds');
  const wasInside = previous.inside === true;
  if (!inside) {
    return Object.freeze({
      inside: false,
      exposureSeconds: 0,
      activeExposureSeconds: 0,
      pulseRemainderSeconds: 0,
      damage: 0,
      pulses: 0,
    });
  }

  const exposureBefore = wasInside ? nonNegative(previous.exposureSeconds ?? 0, 'previous.exposureSeconds') : 0;
  const activeBefore = wasInside ? nonNegative(previous.activeExposureSeconds ?? 0, 'previous.activeExposureSeconds') : 0;
  const entryGrace = nonNegative(definition.entryGraceSeconds ?? 0, 'entryGraceSeconds');
  const graceOverlap = Math.min(dt, Math.max(0, entryGrace - exposureBefore));
  const eligibleDuration = Math.max(0, dt - graceOverlap);
  const eligibleStart = nonNegative(globalStartSeconds, 'globalStartSeconds') + graceOverlap;
  const cyclic = Array.isArray(definition.phases) && definition.phases.length > 0;
  const activeThisFrame = cyclic
    ? integrateCyclicHazardActiveSeconds(definition, eligibleStart, eligibleDuration)
    : eligibleDuration;
  const activeExposureSeconds = activeBefore + activeThisFrame;
  const pulseSeconds = Number.isFinite(definition.pulseSeconds ?? definition.pulseInterval)
    ? Math.max(EPSILON, definition.pulseSeconds ?? definition.pulseInterval)
    : null;
  const pulseCountBefore = pulseSeconds ? Math.floor((activeBefore + EPSILON) / pulseSeconds) : 0;
  const pulseCountAfter = pulseSeconds ? Math.floor((activeExposureSeconds + EPSILON) / pulseSeconds) : 0;
  return Object.freeze({
    inside: true,
    exposureSeconds: exposureBefore + dt,
    activeExposureSeconds,
    pulseRemainderSeconds: pulseSeconds ? activeExposureSeconds % pulseSeconds : 0,
    damage: activeThisFrame * nonNegative(definition.damagePerSecond ?? 0, 'damagePerSecond'),
    pulses: Math.max(0, pulseCountAfter - pulseCountBefore),
  });
}

