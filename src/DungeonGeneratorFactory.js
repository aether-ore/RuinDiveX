import { DungeonGenerator } from './DungeonGenerator.js';
import { DungeonGeneratorV2 } from './dungeon-v2/DungeonGeneratorV2.js';
import { ASCENSION_ENGINE_PROFILE_ID } from './reaverbots/bosses/AscensionEngineContract.js';

export const DUNGEON_GENERATION_MODE = Object.freeze({
  Legacy: 'legacy',
  V2: 'v2',
});

export const DUNGEON_V2_FIXTURE = Object.freeze({
  Golden: 'golden',
  TraversalLab: 'traversal-lab',
});

export const DUNGEON_V2_UNDERCROFT = Object.freeze({
  Magma: 'magma',
  Electrical: 'electrical',
});

export const DUNGEON_WORLD_KIND = Object.freeze({
  Standard: 'standard',
  Sandbox: 'sandbox',
});

export function resolveDungeonGenerationMode({
  mode = DUNGEON_GENERATION_MODE.Legacy,
  worldKind = DUNGEON_WORLD_KIND.Standard,
  bossProfileId = null,
} = {}) {
  const requiresLegacyGenerator = worldKind === DUNGEON_WORLD_KIND.Sandbox
    || bossProfileId === ASCENSION_ENGINE_PROFILE_ID;
  return mode === DUNGEON_GENERATION_MODE.V2 && !requiresLegacyGenerator
    ? DUNGEON_GENERATION_MODE.V2
    : DUNGEON_GENERATION_MODE.Legacy;
}

export function readDungeonGenerationRequest(search = globalThis.location?.search ?? '') {
  let params;
  try {
    params = new URLSearchParams(search);
  } catch {
    params = new URLSearchParams();
  }

  const requestedMode = String(params.get('dungeonGen') ?? '').trim().toLowerCase();
  const requestedFixture = String(params.get('v2Fixture') ?? '').trim().toLowerCase();
  const requestedUndercroft = String(
    params.get('undercroftType') ?? params.get('undercroft') ?? '',
  ).trim().toLowerCase();
  return Object.freeze({
    mode: requestedMode === DUNGEON_GENERATION_MODE.V2
      ? DUNGEON_GENERATION_MODE.V2
      : DUNGEON_GENERATION_MODE.Legacy,
    fixture: requestedFixture === DUNGEON_V2_FIXTURE.TraversalLab
      ? DUNGEON_V2_FIXTURE.TraversalLab
      : DUNGEON_V2_FIXTURE.Golden,
    undercroftType: requestedUndercroft === DUNGEON_V2_UNDERCROFT.Magma
      || requestedUndercroft === DUNGEON_V2_UNDERCROFT.Electrical
      ? requestedUndercroft
      : null,
  });
}

export function createDungeonGenerator({
  mode = DUNGEON_GENERATION_MODE.Legacy,
  fixture = DUNGEON_V2_FIXTURE.Golden,
  seed = 'dungeon-v2-golden',
  worldKind = DUNGEON_WORLD_KIND.Standard,
  bossProfileId = null,
  ...options
} = {}) {
  const resolvedMode = resolveDungeonGenerationMode({ mode, worldKind, bossProfileId });
  if (resolvedMode === DUNGEON_GENERATION_MODE.V2) {
    return new DungeonGeneratorV2({
      ...options,
      fixture,
      seed,
      bossProfileId,
    });
  }

  return new DungeonGenerator({
    ...options,
    bossProfileId,
  });
}

export default createDungeonGenerator;
