export class Inventory {
  constructor(capacity = 48) {
    this.capacity = capacity;
    this.items = [];
    this.gold = 0;
    this.scraps = 0;
    this.researchData = 0;
    this.materials = {};
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

  addMaterial(material, amount = 1, source = null) {
    if (!material?.id) return null;
    const quantity = Math.max(1, Math.trunc(amount) || 1);
    const existing = this.materials[material.id] ?? {
      id: material.id,
      name: material.name ?? material.id,
      family: material.family ?? 'Reaverbot Material',
      aspect: material.aspect ?? null,
      tier: material.tier ?? 'common',
      color: material.color ?? '#c7d0d6',
      description: material.description ?? '',
      craftingTags: [...(material.craftingTags ?? [])],
      exampleUses: [...(material.exampleUses ?? [])],
      quantity: 0,
      lastSource: null,
    };
    existing.quantity += quantity;
    existing.lastSource = source ? { ...source } : existing.lastSource;
    this.materials[material.id] = existing;
    return existing;
  }

  getMaterialCount(materialId) {
    return this.materials[materialId]?.quantity ?? 0;
  }

  getMaterials() {
    return Object.values(this.materials)
      .filter((entry) => entry.quantity > 0)
      .sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name));
  }

  hasMaterials(requirements = {}) {
    return Object.entries(requirements).every(([materialId, amount]) => (
      this.getMaterialCount(materialId) >= Math.max(0, Math.trunc(amount) || 0)
    ));
  }

  consumeMaterials(requirements = {}) {
    if (!this.hasMaterials(requirements)) return false;
    for (const [materialId, amount] of Object.entries(requirements)) {
      const entry = this.materials[materialId];
      entry.quantity -= Math.max(0, Math.trunc(amount) || 0);
      if (entry.quantity <= 0) delete this.materials[materialId];
    }
    return true;
  }

  clear() {
    this.items.length = 0;
    this.gold = 0;
    this.scraps = 0;
    this.researchData = 0;
    this.materials = {};
  }
}
