function nonNegativeInteger(value, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function cloneValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizePartEntry(partId, part) {
  if (!partId || !part || typeof part !== 'object') return null;
  const quantity = nonNegativeInteger(part.quantity);
  if (quantity <= 0) return null;
  return {
    id: partId,
    name: typeof part.name === 'string' ? part.name : partId,
    family: typeof part.family === 'string' ? part.family : 'Reaverbot Part',
    aspect: typeof part.aspect === 'string' ? part.aspect : null,
    tier: typeof part.tier === 'string' ? part.tier : 'common',
    color: typeof part.color === 'string' ? part.color : '#c7d0d6',
    description: typeof part.description === 'string' ? part.description : '',
    craftingTags: Array.isArray(part.craftingTags) ? [...part.craftingTags] : [],
    exampleUses: Array.isArray(part.exampleUses) ? [...part.exampleUses] : [],
    quantity,
    lastSource: part.lastSource && typeof part.lastSource === 'object'
      ? cloneValue(part.lastSource)
      : null,
  };
}

function recipeRequirements(recipe, quantity = 1) {
  const count = Math.max(1, nonNegativeInteger(quantity, 1));
  const source = recipe?.requirements ?? recipe ?? {};
  const sourceParts = source.parts ?? recipe?.partRequirements ?? recipe?.parts ?? {};
  const parts = {};
  for (const [partId, amount] of Object.entries(sourceParts)) {
    const required = nonNegativeInteger(amount) * count;
    if (partId && required > 0) parts[partId] = required;
  }
  const perRecipeScrap = nonNegativeInteger(
    source.identifiedScrap
      ?? source.scrap
      ?? recipe?.identifiedScrapCost
      ?? recipe?.scrapCost,
  );
  return { identifiedScrap: perRecipeScrap * count, parts, quantity: count };
}

/**
 * Roll-owned salvage stockpile.
 *
 * The constructor remains compatible with `new RollSalvageStorage()` while
 * also accepting a serialized initial state and persistence/discovery hooks:
 *
 *   new RollSalvageStorage(initialState, onChange)
 *   new RollSalvageStorage({ ...initialState, onChange, onDiscovery })
 */
export class RollSalvageStorage {
  constructor(initialState = {}, onChange = null) {
    if (typeof initialState === 'function') {
      onChange = initialState;
      initialState = {};
    }
    const root = initialState && typeof initialState === 'object' ? initialState : {};
    const source = root.rollSalvage && typeof root.rollSalvage === 'object'
      ? root.rollSalvage
      : root;

    this.identifiedScrap = nonNegativeInteger(source.identifiedScrap);
    this.parts = {};
    for (const [partId, part] of Object.entries(source.parts ?? {})) {
      const normalized = normalizePartEntry(partId, part);
      if (normalized) this.parts[partId] = normalized;
    }

    const history = Array.isArray(root.discoveryHistory)
      ? root.discoveryHistory
      : Array.isArray(source.discoveryHistory)
        ? source.discoveryHistory
        : [];
    this.discoveryHistory = history
      .filter((entry) => entry && typeof entry.partId === 'string' && entry.partId)
      .map((entry, index) => ({
        partId: entry.partId,
        name: typeof entry.name === 'string' ? entry.name : entry.partId,
        sequence: nonNegativeInteger(entry.sequence, index + 1),
        source: entry.source && typeof entry.source === 'object' ? cloneValue(entry.source) : null,
      }));

    const discovered = root.discoveredSalvageTypes
      ?? source.discoveredSalvageTypes
      ?? root.discovery?.salvageTypes
      ?? [];
    this.discoveredSalvageTypes = [];
    const discoveredIds = discovered instanceof Set
      ? [...discovered]
      : Array.isArray(discovered)
        ? discovered
        : Object.entries(discovered ?? {}).filter(([, found]) => Boolean(found)).map(([partId]) => partId);
    for (const partId of discoveredIds) {
      if (typeof partId === 'string' && partId && !this.discoveredSalvageTypes.includes(partId)) {
        this.discoveredSalvageTypes.push(partId);
      }
    }
    for (const entry of this.discoveryHistory) {
      if (!this.discoveredSalvageTypes.includes(entry.partId)) {
        this.discoveredSalvageTypes.push(entry.partId);
      }
    }
    // Older stockpiles did not record discovery separately. Any part still on
    // hand proves that Roll found its type, so migration can infer it safely.
    for (const part of Object.values(this.parts)) {
      if (!this.discoveredSalvageTypes.includes(part.id)) {
        this.discoveredSalvageTypes.push(part.id);
        this.discoveryHistory.push({
          partId: part.id,
          name: part.name,
          sequence: this.discoveryHistory.length + 1,
          source: part.lastSource ? cloneValue(part.lastSource) : null,
        });
      }
    }

    this.onChange = typeof onChange === 'function'
      ? onChange
      : typeof root.onChange === 'function'
        ? root.onChange
        : null;
    this.onDiscovery = typeof root.onDiscovery === 'function'
      ? root.onDiscovery
      : typeof root.onPartDiscovered === 'function'
        ? root.onPartDiscovered
        : null;
    this._changeListeners = new Set();
    this._discoveryListeners = new Set();
  }

  identifyRecoveries({ total = 0, recoveries = [] } = {}) {
    const snapshot = this.serialize();
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
        let stored;
        try {
          stored = this.addPart(part, quantity, part.source ?? recovery.source, { notify: false });
        } catch (error) {
          this._restoreSnapshot(snapshot);
          throw error;
        }
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
    if (processed > 0) this._notifyChangeWithRollback('identifyRecoveries', snapshot);
    return {
      processed,
      scrapStored,
      partCount,
      recoveredParts: [...recoveredParts.values()],
      identifiedScrap: this.identifiedScrap,
      storedPartCount: this.getStoredPartCount(),
    };
  }

  addIdentifiedScrap(amount = 0) {
    const quantity = nonNegativeInteger(amount);
    if (quantity <= 0) return this.identifiedScrap;
    const snapshot = this.serialize();
    this.identifiedScrap += quantity;
    this._notifyChangeWithRollback('addIdentifiedScrap', snapshot);
    return this.identifiedScrap;
  }

  addPart(part, amount = 1, source = null, { notify = true } = {}) {
    if (!part?.id) return null;
    const quantity = Math.max(0, Math.trunc(Number(amount)) || 0);
    if (quantity <= 0) return null;
    const snapshot = this.serialize();
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
    try {
      this.markPartDiscovered(part, source, { notify: false });
      if (notify) this._notifyChange('addPart');
    } catch (error) {
      this._restoreSnapshot(snapshot);
      throw error;
    }
    return existing;
  }

  markPartDiscovered(partOrId, source = null, { notify = true } = {}) {
    const partId = typeof partOrId === 'string' ? partOrId : partOrId?.id;
    if (!partId || this.discoveredSalvageTypes.includes(partId)) return false;
    const name = typeof partOrId === 'object' && typeof partOrId.name === 'string'
      ? partOrId.name
      : this.parts[partId]?.name ?? partId;
    const snapshot = this.serialize();
    this.discoveredSalvageTypes.push(partId);
    const discovery = {
      partId,
      name,
      sequence: this.discoveryHistory.length + 1,
      source: source && typeof source === 'object' ? cloneValue(source) : null,
    };
    this.discoveryHistory.push(discovery);
    try {
      this.onDiscovery?.(cloneValue(discovery), this);
      for (const listener of this._discoveryListeners) listener(cloneValue(discovery), this);
      if (notify) this._notifyChange('discoverPart');
    } catch (error) {
      this._restoreSnapshot(snapshot);
      throw error;
    }
    return true;
  }

  hasDiscoveredPart(partId) {
    return this.discoveredSalvageTypes.includes(partId);
  }

  getDiscoveredPartIds() {
    return [...this.discoveredSalvageTypes];
  }

  getDiscoveryHistory() {
    return cloneValue(this.discoveryHistory);
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this._changeListeners.add(listener);
    return () => this._changeListeners.delete(listener);
  }

  subscribeDiscovery(listener) {
    if (typeof listener !== 'function') return () => {};
    this._discoveryListeners.add(listener);
    return () => this._discoveryListeners.delete(listener);
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
    const snapshot = this.serialize();
    for (const [partId, amount] of Object.entries(requirements)) {
      const quantity = Math.max(0, Math.trunc(amount) || 0);
      if (quantity <= 0) continue;
      const entry = this.parts[partId];
      entry.quantity -= quantity;
      if (entry.quantity <= 0) delete this.parts[partId];
    }
    this._notifyChangeWithRollback('consumeParts', snapshot);
    return true;
  }

  canTransactRecipe(recipe, options = {}) {
    const requirements = recipeRequirements(recipe, options.quantity);
    const missingParts = {};
    for (const [partId, amount] of Object.entries(requirements.parts)) {
      const missing = Math.max(0, amount - this.getPartCount(partId));
      if (missing > 0) missingParts[partId] = missing;
    }
    const missingScrap = Math.max(0, requirements.identifiedScrap - this.identifiedScrap);
    return {
      ok: missingScrap === 0 && Object.keys(missingParts).length === 0,
      requirements,
      missing: { identifiedScrap: missingScrap, scrap: missingScrap, parts: missingParts },
    };
  }

  /**
   * Atomically consumes one recipe's named parts and identified scrap.
   * Result factories run before resources move. Commit hooks and persistence
   * listeners are guarded by a snapshot; an exception restores the stockpile.
   */
  transactRecipe(recipe, options = {}) {
    const check = this.canTransactRecipe(recipe, options);
    if (!check.ok) {
      return {
        ok: false,
        reason: 'insufficient-resources',
        recipeId: recipe?.id ?? recipe?.recipeId ?? null,
        ...check,
      };
    }

    const snapshot = this.serialize();
    const factory = options.createResult ?? options.resultFactory;
    let result = options.result ?? null;
    try {
      if (typeof factory === 'function') {
        result = factory({
          recipe,
          quantity: check.requirements.quantity,
          spent: cloneValue(check.requirements),
          storage: this,
        });
      }

      this.identifiedScrap -= check.requirements.identifiedScrap;
      for (const [partId, amount] of Object.entries(check.requirements.parts)) {
        const entry = this.parts[partId];
        entry.quantity -= amount;
        if (entry.quantity <= 0) delete this.parts[partId];
      }

      const commit = options.commit ?? options.onCommit;
      if (typeof commit === 'function') {
        const committedResult = commit(result, {
          recipe,
          quantity: check.requirements.quantity,
          spent: cloneValue(check.requirements),
          storage: this,
        });
        if (committedResult !== undefined) result = committedResult;
      }
      this._notifyChange('transactRecipe');
    } catch (error) {
      this._restoreSnapshot(snapshot);
      return {
        ok: false,
        reason: 'transaction-failed',
        recipeId: recipe?.id ?? recipe?.recipeId ?? null,
        error,
      };
    }

    return {
      ok: true,
      recipeId: recipe?.id ?? recipe?.recipeId ?? null,
      quantity: check.requirements.quantity,
      spent: {
        identifiedScrap: check.requirements.identifiedScrap,
        scrap: check.requirements.identifiedScrap,
        parts: { ...check.requirements.parts },
      },
      identifiedScrap: this.identifiedScrap,
      result,
    };
  }

  serialize() {
    return {
      identifiedScrap: this.identifiedScrap,
      parts: cloneValue(this.parts),
      discoveredSalvageTypes: [...this.discoveredSalvageTypes],
      discoveryHistory: cloneValue(this.discoveryHistory),
    };
  }

  toJSON() {
    return this.serialize();
  }

  clear({ preserveDiscovery = false } = {}) {
    const snapshot = this.serialize();
    this.identifiedScrap = 0;
    this.parts = {};
    if (!preserveDiscovery) {
      this.discoveredSalvageTypes = [];
      this.discoveryHistory = [];
    }
    this._notifyChangeWithRollback('clear', snapshot);
  }

  _restoreSnapshot(snapshot) {
    this.identifiedScrap = snapshot.identifiedScrap;
    this.parts = cloneValue(snapshot.parts);
    this.discoveredSalvageTypes = [...snapshot.discoveredSalvageTypes];
    this.discoveryHistory = cloneValue(snapshot.discoveryHistory);
  }

  _notifyChange(reason) {
    const snapshot = this.serialize();
    this.onChange?.(snapshot, reason, this);
    for (const listener of this._changeListeners) listener(snapshot, reason, this);
  }

  _notifyChangeWithRollback(reason, snapshot) {
    try {
      this._notifyChange(reason);
    } catch (error) {
      this._restoreSnapshot(snapshot);
      throw error;
    }
  }
}
