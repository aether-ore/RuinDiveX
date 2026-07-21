import { DungeonGenerator } from '../DungeonGenerator.js';

export const LEGACY_CAMP_ASSET_ADAPTER_ID = 'dungeon-v1-camp-assets-v1';

const LEGACY_METHODS = Object.freeze({
  createSupportCarFallback: '_createSupportCarFallback',
  createRollWorkshopWorkbench: '_createRollWorkshopWorkbench',
  loadSupportCar: '_loadSupportCar',
  loadRollWorkbenchTextures: '_loadRollWorkbenchTextures',
  loadRollNpc: '_loadRollNpc',
});

function requireLegacyMethod(generator, operation) {
  const methodName = LEGACY_METHODS[operation];
  const method = generator?.[methodName];
  if (typeof method !== 'function') {
    throw new TypeError(
      `Dungeon V1 camp adapter cannot perform ${operation}; ${methodName} is unavailable.`,
    );
  }
  return method.bind(generator);
}

/**
 * Public compatibility boundary for the stable Dungeon V1 camp constructors.
 *
 * DungeonGenerator predates the streamed-world architecture and exposes its
 * camp builders only as implementation methods. Keeping the legacy calls in
 * this one adapter lets overworld code consume a small public API without
 * modifying, copying, or importing implementation details from the frozen V1
 * generator. Removal of this adapter is deliberately independent from the V1
 * room-generation contract.
 */
export class LegacyCampAssetAdapter {
  constructor({ legacyGenerator = new DungeonGenerator() } = {}) {
    this.id = LEGACY_CAMP_ASSET_ADAPTER_ID;
    this._operations = Object.freeze(Object.fromEntries(
      Object.keys(LEGACY_METHODS).map((operation) => [
        operation,
        requireLegacyMethod(legacyGenerator, operation),
      ]),
    ));
  }

  createSupportCarFallback() {
    return this._operations.createSupportCarFallback();
  }

  createRollWorkshopWorkbench() {
    return this._operations.createRollWorkshopWorkbench();
  }

  loadSupportCar(anchor) {
    return this._operations.loadSupportCar(anchor);
  }

  loadRollWorkshopTextures(workbench) {
    return this._operations.loadRollWorkbenchTextures(workbench);
  }

  loadRollNpc(anchor, npcAnimationMixers, npcAnimators) {
    return this._operations.loadRollNpc(anchor, npcAnimationMixers, npcAnimators);
  }
}

export function createLegacyCampAssetAdapter(options) {
  return new LegacyCampAssetAdapter(options);
}

export function validateLegacyCampAssetAdapter(adapter) {
  const errors = [];
  if (adapter?.id !== LEGACY_CAMP_ASSET_ADAPTER_ID) errors.push('invalid-adapter-id');
  for (const operation of Object.keys(LEGACY_METHODS)) {
    const publicOperation = operation === 'loadRollWorkbenchTextures'
      ? 'loadRollWorkshopTextures'
      : operation;
    if (typeof adapter?.[publicOperation] !== 'function') {
      errors.push(`missing-operation:${publicOperation}`);
    }
  }
  return Object.freeze({
    accepted: errors.length === 0,
    errors: Object.freeze(errors),
  });
}
