import { canonicalStringify, stableHashText } from './canonical.js';

const UINT32_RANGE = 0x100000000;

function seedToUint32(seed) {
  const digest = stableHashText(seed, 'ruindivex-dungeon-augmentation-rng/v1');
  return Number.parseInt(digest.slice(3, 11), 16) >>> 0;
}

function normalizeLabel(label) {
  const value = String(label ?? '').trim();
  if (!value) throw new TypeError('Dungeon augmentation RNG fork labels must be non-empty.');
  return value.replaceAll('\\', '/');
}

/**
 * Deterministic random stream whose labeled forks depend only on the root seed
 * and label path, never on how many values another stream consumed.
 */
export class DungeonAugmentationRandom {
  constructor(seed, labelPath = []) {
    this.rootSeed = String(seed ?? 'dungeon-augmentation');
    this.labelPath = Object.freeze([...labelPath]);
    this.streamSeed = stableHashText(
      canonicalStringify({ rootSeed: this.rootSeed, labelPath: this.labelPath }),
      'ruindivex-dungeon-augmentation-rng-stream/v1',
    );
    this.state = seedToUint32(this.streamSeed) || 0x6d2b79f5;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  }

  float(minimum = 0, maximum = 1) {
    const low = Math.min(Number(minimum), Number(maximum));
    const high = Math.max(Number(minimum), Number(maximum));
    return low + (high - low) * this.next();
  }

  int(minimum, maximum) {
    const low = Math.ceil(Math.min(Number(minimum), Number(maximum)));
    const high = Math.floor(Math.max(Number(minimum), Number(maximum)));
    if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) {
      throw new RangeError('Dungeon augmentation RNG integer bounds must be finite.');
    }
    return low + Math.floor(this.next() * (high - low + 1));
  }

  chance(probability) {
    return this.next() < Math.max(0, Math.min(1, Number(probability) || 0));
  }

  pick(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    return values[Math.floor(this.next() * values.length)];
  }

  weightedPick(entries, fallback = null) {
    const valid = (Array.isArray(entries) ? entries : [])
      .map((entry) => ({
        value: entry?.value ?? entry?.[0],
        weight: Number(entry?.weight ?? entry?.[1]),
      }))
      .filter(({ weight }) => Number.isFinite(weight) && weight > 0);
    const total = valid.reduce((sum, { weight }) => sum + weight, 0);
    if (total <= 0) return fallback;
    let roll = this.next() * total;
    for (const entry of valid) {
      roll -= entry.weight;
      if (roll <= 0) return entry.value;
    }
    return valid.at(-1)?.value ?? fallback;
  }

  shuffle(values) {
    const copy = Array.isArray(values) ? [...values] : [];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = this.int(0, index);
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
  }

  fork(label) {
    return new DungeonAugmentationRandom(this.rootSeed, [
      ...this.labelPath,
      normalizeLabel(label),
    ]);
  }
}

export function deriveDungeonAugmentationSeed({
  layoutSeed,
  baseDraftFingerprint,
  parentRegionId,
  profileId,
} = {}) {
  return stableHashText(canonicalStringify({
    layoutSeed: String(layoutSeed ?? ''),
    baseDraftFingerprint: String(baseDraftFingerprint ?? ''),
    parentRegionId: String(parentRegionId ?? ''),
    profileId: String(profileId ?? ''),
  }), 'ruindivex-dungeon-augmentation-derived-seed/v1');
}

export function createDungeonAugmentationRandom(seed) {
  return new DungeonAugmentationRandom(seed);
}

