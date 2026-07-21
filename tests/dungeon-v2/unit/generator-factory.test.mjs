import test from 'node:test';
import assert from 'node:assert/strict';
import { DungeonGenerator } from '../../../src/DungeonGenerator.js';
import {
  DUNGEON_GENERATION_MODE,
  DUNGEON_V2_FIXTURE,
  DUNGEON_WORLD_KIND,
  createDungeonGenerator,
  readDungeonGenerationRequest,
  resolveDungeonGenerationMode,
} from '../../../src/DungeonGeneratorFactory.js';
import { DungeonGeneratorV2 } from '../../../src/dungeon-v2/DungeonGeneratorV2.js';
import { ASCENSION_ENGINE_PROFILE_ID } from '../../../src/reaverbots/bosses/AscensionEngineContract.js';

test('legacy generation remains the production default', () => {
  assert.deepEqual(readDungeonGenerationRequest(''), {
    mode: DUNGEON_GENERATION_MODE.Legacy,
    fixture: DUNGEON_V2_FIXTURE.Golden,
    undercroftType: null,
  });
  assert.ok(createDungeonGenerator() instanceof DungeonGenerator);
});

test('only the explicit dungeonGen=v2 flag selects the restart generator', () => {
  assert.equal(readDungeonGenerationRequest('?dungeonGen=V2').mode, DUNGEON_GENERATION_MODE.V2);
  assert.equal(readDungeonGenerationRequest('?dungeonGen=v3').mode, DUNGEON_GENERATION_MODE.Legacy);
  assert.ok(createDungeonGenerator({ mode: DUNGEON_GENERATION_MODE.V2 }) instanceof DungeonGeneratorV2);
});

test('specialized boss worlds retain their dedicated legacy generator path under the V2 flag', () => {
  const dedicatedBossGenerator = createDungeonGenerator({
    mode: DUNGEON_GENERATION_MODE.V2,
    bossProfileId: ASCENSION_ENGINE_PROFILE_ID,
  });
  assert.ok(dedicatedBossGenerator instanceof DungeonGenerator);
  assert.equal(dedicatedBossGenerator.bossProfileId, ASCENSION_ENGINE_PROFILE_ID);

  const ordinaryBossGenerator = createDungeonGenerator({
    mode: DUNGEON_GENERATION_MODE.V2,
    bossProfileId: 'revolvingFusillade',
  });
  assert.ok(ordinaryBossGenerator instanceof DungeonGeneratorV2);
  assert.equal(ordinaryBossGenerator.bossProfileId, 'revolvingFusillade');
});

test('disposable sandbox worlds remain legacy even when the page requests V2', () => {
  const sandboxGenerator = createDungeonGenerator({
    mode: DUNGEON_GENERATION_MODE.V2,
    worldKind: DUNGEON_WORLD_KIND.Sandbox,
    bossProfileId: ASCENSION_ENGINE_PROFILE_ID,
  });
  assert.ok(sandboxGenerator instanceof DungeonGenerator);
  assert.equal(sandboxGenerator.bossProfileId, ASCENSION_ENGINE_PROFILE_ID);
});

test('effective scene generation mode keeps legacy-only worlds out of V2 setup', () => {
  assert.equal(resolveDungeonGenerationMode({
    mode: DUNGEON_GENERATION_MODE.V2,
    bossProfileId: ASCENSION_ENGINE_PROFILE_ID,
  }), DUNGEON_GENERATION_MODE.Legacy);
  assert.equal(resolveDungeonGenerationMode({
    mode: DUNGEON_GENERATION_MODE.V2,
    worldKind: DUNGEON_WORLD_KIND.Sandbox,
  }), DUNGEON_GENERATION_MODE.Legacy);
  assert.equal(resolveDungeonGenerationMode({
    mode: DUNGEON_GENERATION_MODE.V2,
    bossProfileId: 'revolvingFusillade',
  }), DUNGEON_GENERATION_MODE.V2);
});

test('V2 fixture and undercroft URL contracts are narrow and deterministic', () => {
  assert.deepEqual(
    readDungeonGenerationRequest('?dungeonGen=v2&v2Fixture=traversal-lab&undercroft=electrical'),
    {
      mode: 'v2',
      fixture: 'traversal-lab',
      undercroftType: 'electrical',
    },
  );
  assert.deepEqual(
    readDungeonGenerationRequest('?dungeonGen=v2&v2Fixture=room-preview&undercroft=nothing'),
    {
      mode: 'v2',
      fixture: 'golden',
      undercroftType: null,
    },
  );
});

test('an invalid V2 request fails explicitly instead of constructing V1', () => {
  const generator = createDungeonGenerator({
    mode: DUNGEON_GENERATION_MODE.V2,
    fixture: DUNGEON_V2_FIXTURE.Golden,
    undercroftType: 'invalid-hazard',
  });
  assert.ok(generator instanceof DungeonGeneratorV2);
  assert.throws(() => generator.generate(), (error) => {
    assert.equal(error.code, 'DUNGEON_V2_PLANNING_FAILED');
    assert.equal(error.result?.accepted, false);
    assert.equal(error.result?.phase, 'planning');
    assert.match(error.result?.errors?.[0]?.message ?? '', /Unsupported V2 Undercroft type/);
    assert.match(error.result?.diagnosticHash ?? '', /^[0-9a-f]{8}$/);
    return true;
  });
});
