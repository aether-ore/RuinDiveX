import { SeededRandom, hashSeed } from '../reaverbots/SeededRandom.js';

export const DUNGEON_SEED_STREAM_LABELS = Object.freeze([
  'graph',
  'district',
  'module',
  'encounter',
  'reward',
  'environment',
  'mechanism',
  'cosmetic',
]);

function normalizeSeed(seed) {
  if (typeof seed === 'string' && seed.length > 0) {
    return seed;
  }
  if (Number.isFinite(seed)) {
    return String(seed);
  }
  return 'ruindivex-dungeon-v2';
}

/**
 * Creates named, independently reproducible random streams. Calling one stream
 * never advances any other stream. `stream(label)` deliberately returns a new
 * generator each time so callers cannot accidentally share mutable state.
 */
export function createDungeonSeedStreams(seed = 'ruindivex-dungeon-v2') {
  const baseSeed = normalizeSeed(seed);
  const seedFor = (label) => hashSeed(`${baseSeed}::${String(label)}`);
  const stream = (label) => new SeededRandom(seedFor(label));
  const seeds = Object.freeze(Object.fromEntries(
    DUNGEON_SEED_STREAM_LABELS.map((label) => [label, seedFor(label)]),
  ));

  return Object.freeze({
    baseSeed,
    seeds,
    seedFor,
    stream,
    encounter: (id) => stream(`encounter:${id}`),
    reward: (id) => stream(`reward:${id}`),
    cosmetic: (id) => stream(`cosmetic:${id}`),
  });
}

export default createDungeonSeedStreams;
