export class Inventory {
  constructor(capacity = 48) {
    this.capacity = capacity;
    this.items = [];
    this.gold = 0;
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

  clear() {
    this.items.length = 0;
    this.gold = 0;
  }
}
