function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function createBusterExecutionStaggerLedger(executionId = null) {
  return {
    executionId: executionId == null ? null : String(executionId),
    largestByTarget: new Map(),
  };
}

export function consumeBusterExecutionStagger(ledger, target, nominalDuration, dealtDamage) {
  const duration = finiteNonNegative(nominalDuration);
  if (!ledger?.largestByTarget?.get || !ledger?.largestByTarget?.set) return duration;
  if (!target || duration <= 0 || finiteNonNegative(dealtDamage) <= 0) return 0;

  const key = target.id == null ? target : `target:${String(target.id)}`;
  const previousLargest = finiteNonNegative(ledger.largestByTarget.get(key));
  const additionalDuration = Math.max(0, duration - previousLargest);
  ledger.largestByTarget.set(key, Math.max(previousLargest, duration));
  return additionalDuration;
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
