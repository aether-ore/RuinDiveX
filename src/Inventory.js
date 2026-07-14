export class Inventory {
  constructor(capacity = 48) {
    this.capacity = capacity;
    this.items = [];
    this.gold = 0;
    this.unidentifiedScrap = 0;
    this.unidentifiedRecoveries = [];
  }

  addItem(item) {
    if (this.items.length >= this.capacity) {
      return false;
    }

    this.items.push(item);
    return true;
  }

  removeItem(itemId) {
    const index = this.items.findIndex((item) => item.id === itemId);

    if (index === -1) {
      return null;
    }

    return this.items.splice(index, 1)[0];
  }

  discardItem(itemId) {
    const item = this.removeItem(itemId);

    if (item) {
      this.gold += Math.max(1, Math.floor(item.value * 0.35));
    }

    return item;
  }

  findItem(itemId) {
    return this.items.find((item) => item.id === itemId) ?? null;
  }

  isFull() {
    return this.items.length >= this.capacity;
  }

  addUnidentifiedScrap(amount = 1, recovery = null) {
    const quantity = Math.max(0, Math.trunc(Number(amount)) || 0);
    if (quantity <= 0) return 0;
    this.unidentifiedScrap += quantity;
    this.unidentifiedRecoveries.push({
      quantity,
      source: recovery?.source ? { ...recovery.source } : null,
      recoverableParts: (recovery?.recoverableParts ?? []).map((part) => ({
        ...part,
        source: part.source ? { ...part.source } : null,
      })),
    });
    return quantity;
  }

  takeAllUnidentifiedScrap() {
    const total = Math.max(0, Math.trunc(this.unidentifiedScrap) || 0);
    const recoveries = this.unidentifiedRecoveries.map((recovery) => ({
      quantity: recovery.quantity,
      source: recovery.source ? { ...recovery.source } : null,
      recoverableParts: (recovery.recoverableParts ?? []).map((part) => ({
        ...part,
        source: part.source ? { ...part.source } : null,
      })),
    }));
    this.unidentifiedScrap = 0;
    this.unidentifiedRecoveries = [];
    return { total, recoveries };
  }

  clear() {
    this.items.length = 0;
    this.gold = 0;
    this.unidentifiedScrap = 0;
    this.unidentifiedRecoveries = [];
  }
}
