export class RollSalvageStorage {
  constructor() {
    this.identifiedScrap = 0;
    this.parts = {};
  }

  identifyRecoveries({ total = 0, recoveries = [] } = {}) {
    const processed = Math.max(0, Math.trunc(total) || 0);
    let remaining = processed;
    let partCount = 0;
    const recoveredParts = new Map();

    for (const recovery of recoveries) {
      let recoveryRemaining = Math.min(
        remaining,
        Math.max(0, Math.trunc(recovery?.quantity) || 0),
      );

      for (const part of recovery?.recoverableParts ?? []) {
        if (recoveryRemaining <= 0 || remaining <= 0 || !part?.id) break;
        const quantity = Math.min(
          recoveryRemaining,
          remaining,
          Math.max(1, Math.trunc(part.quantity) || 1),
        );
        const stored = this.addPart(part, quantity, part.source ?? recovery.source);
        const summary = recoveredParts.get(part.id) ?? {
          id: part.id,
          name: stored.name,
          color: stored.color,
          quantity: 0,
        };
        summary.quantity += quantity;
        recoveredParts.set(part.id, summary);
        recoveryRemaining -= quantity;
        remaining -= quantity;
        partCount += quantity;
      }
    }

    const scrapStored = Math.max(0, processed - partCount);
    this.identifiedScrap += scrapStored;
    return {
      processed,
      scrapStored,
      partCount,
      recoveredParts: [...recoveredParts.values()],
      identifiedScrap: this.identifiedScrap,
      storedPartCount: this.getStoredPartCount(),
    };
  }

  addPart(part, amount = 1, source = null) {
    if (!part?.id) return null;
    const quantity = Math.max(0, Math.trunc(Number(amount)) || 0);
    if (quantity <= 0) return null;
    const existing = this.parts[part.id] ?? {
      id: part.id,
      name: part.name ?? part.id,
      family: part.family ?? 'Reaverbot Part',
      aspect: part.aspect ?? null,
      tier: part.tier ?? 'common',
      color: part.color ?? '#c7d0d6',
      description: part.description ?? '',
      craftingTags: [...(part.craftingTags ?? [])],
      exampleUses: [...(part.exampleUses ?? [])],
      quantity: 0,
      lastSource: null,
    };
    existing.quantity += quantity;
    existing.lastSource = source ? { ...source } : existing.lastSource;
    this.parts[part.id] = existing;
    return existing;
  }

  getPartCount(partId) {
    return this.parts[partId]?.quantity ?? 0;
  }

  getStoredPartCount() {
    return Object.values(this.parts).reduce((total, part) => total + part.quantity, 0);
  }

  getParts() {
    return Object.values(this.parts)
      .filter((entry) => entry.quantity > 0)
      .sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name));
  }

  hasParts(requirements = {}) {
    return Object.entries(requirements).every(([partId, amount]) => (
      this.getPartCount(partId) >= Math.max(0, Math.trunc(amount) || 0)
    ));
  }

  consumeParts(requirements = {}) {
    if (!this.hasParts(requirements)) return false;
    for (const [partId, amount] of Object.entries(requirements)) {
      const entry = this.parts[partId];
      entry.quantity -= Math.max(0, Math.trunc(amount) || 0);
      if (entry.quantity <= 0) delete this.parts[partId];
    }
    return true;
  }

  clear() {
    this.identifiedScrap = 0;
    this.parts = {};
  }
}
