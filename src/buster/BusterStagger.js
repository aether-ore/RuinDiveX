function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function createBusterExecutionStaggerLedger(executionId = null) {
  const entriesByTarget = new Map();
  return {
    executionId: executionId == null ? null : String(executionId),
    entriesByTarget,
    // Compatibility alias retained for callers that inspect the original map.
    // Values are now exact cumulative entries rather than bare durations.
    largestByTarget: entriesByTarget,
  };
}

function getLedgerMap(ledger) {
  return ledger?.entriesByTarget?.get && ledger?.entriesByTarget?.set
    ? ledger.entriesByTarget
    : ledger?.largestByTarget?.get && ledger?.largestByTarget?.set
      ? ledger.largestByTarget
      : null;
}

function targetLedgerKey(target) {
  return target?.id == null ? target : `target:${String(target.id)}`;
}

export function consumeBusterExecutionStaggerContribution(
  ledger,
  target,
  nominalDuration,
  dealtDamage,
) {
  const duration = finiteNonNegative(nominalDuration);
  const map = getLedgerMap(ledger);
  if (!map) {
    return Object.freeze({
      previousLargestNominalDuration: 0,
      previousTotalGrantedDuration: 0,
      largestNominalDuration: duration,
      additionalDuration: duration,
      totalGrantedDuration: duration,
    });
  }

  const key = targetLedgerKey(target);
  const previous = key == null ? null : map.get(key);
  const previousLargestNominalDuration = finiteNonNegative(
    typeof previous === 'number' ? previous : previous?.largestNominalDuration,
  );
  const previousTotalGrantedDuration = finiteNonNegative(
    typeof previous === 'number' ? previous : previous?.totalGrantedDuration,
  );
  if (!target || duration <= 0 || finiteNonNegative(dealtDamage) <= 0) {
    return Object.freeze({
      previousLargestNominalDuration,
      previousTotalGrantedDuration,
      largestNominalDuration: previousLargestNominalDuration,
      additionalDuration: 0,
      totalGrantedDuration: previousTotalGrantedDuration,
    });
  }

  const largestNominalDuration = Math.max(previousLargestNominalDuration, duration);
  const additionalDuration = Math.max(0, largestNominalDuration - previousTotalGrantedDuration);
  // When a contribution is granted, assigning the exact largest value avoids
  // cumulative floating-point drift across many split/explosion packets.
  const totalGrantedDuration = additionalDuration > 0
    ? largestNominalDuration
    : previousTotalGrantedDuration;
  map.set(key, { largestNominalDuration, totalGrantedDuration });
  return Object.freeze({
    previousLargestNominalDuration,
    previousTotalGrantedDuration,
    largestNominalDuration,
    additionalDuration,
    totalGrantedDuration,
  });
}

export function consumeBusterExecutionStagger(ledger, target, nominalDuration, dealtDamage) {
  return consumeBusterExecutionStaggerContribution(
    ledger,
    target,
    nominalDuration,
    dealtDamage,
  ).additionalDuration;
}

export function resolveBusterStaggerDuration(meta, target, dealtDamage) {
  const nominalDuration = finiteNonNegative(meta?.stagger);
  if (!meta?.busterExecutionStaggerLedger) return nominalDuration;
  return consumeBusterExecutionStagger(
    meta.busterExecutionStaggerLedger,
    target,
    nominalDuration,
    dealtDamage,
  );
}
