const UINT32_RANGE = 0x100000000;

export function hashSeed(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? 'reaverbot');
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  hash += hash << 13;
  hash ^= hash >>> 7;
  hash += hash << 3;
  hash ^= hash >>> 17;
  hash += hash << 5;
  return hash >>> 0;
}

export class SeededRandom {
  constructor(seed = 'reaverbot') {
    this.seed = hashSeed(seed);
    this.state = this.seed || 0x6d2b79f5;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  }

  float(min = 0, max = 1) {
    return min + (max - min) * this.next();
  }

  int(min, max) {
    const lower = Math.ceil(Math.min(min, max));
    const upper = Math.floor(Math.max(min, max));
    return lower + Math.floor(this.next() * (upper - lower + 1));
  }

  chance(probability) {
    return this.next() < probability;
  }

  pick(values) {
    if (!values?.length) {
      return null;
    }

    return values[Math.floor(this.next() * values.length)];
  }

  weighted(entries, fallback = null) {
    const valid = entries.filter((entry) => Number(entry?.weight ?? entry?.[1]) > 0);
    const total = valid.reduce((sum, entry) => sum + Number(entry.weight ?? entry[1]), 0);

    if (total <= 0) {
      return fallback;
    }

    let roll = this.next() * total;
    for (const entry of valid) {
      roll -= Number(entry.weight ?? entry[1]);
      if (roll <= 0) {
        return entry.value ?? entry[0];
      }
    }

    const last = valid.at(-1);
    return last?.value ?? last?.[0] ?? fallback;
  }

  fork(label) {
    return new SeededRandom(`${this.seed}:${String(label)}`);
  }
}

export function createSeededRandom(seed) {
  const random = new SeededRandom(seed);
  return () => random.next();
}
