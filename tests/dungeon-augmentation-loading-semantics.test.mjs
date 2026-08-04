import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gameSource = readFileSync(
  new URL('../src/Game.js', import.meta.url),
  'utf8',
);
const uiCssSource = readFileSync(
  new URL('../src/ui.css', import.meta.url),
  'utf8',
);

function sourceBetween(startMarker, endMarker) {
  const start = gameSource.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = gameSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return gameSource.slice(start, end);
}

test('direct dungeon startup prepares the exact committed expedition before Game construction', () => {
  const createSource = sourceBetween(
    '  static async create(options = {}) {',
    '\n  constructor({',
  );
  const normalizationSource = sourceBetween(
    'function normalizeInitialDungeonGenerationSpec(generationSpec = {}) {',
    '\nfunction shouldPrepareInitialDungeonAugmentation',
  );
  const buildWorldSource = sourceBetween(
    '  _buildWorld() {',
    '\n  _rebuildDebugLedgeTester(',
  );

  assert.match(createSource, /getActiveBossExpedition\?\.\(\) \?\? null/);
  assert.match(
    createSource,
    /const initialDungeonGenerationSpec = resolveCommittedDungeonGenerationSpec\([\s\S]*?committedExpedition,[\s\S]*?dungeonAugmentation: undefined,[\s\S]*?\);/,
  );
  assert.match(
    createSource,
    /shouldPrepareInitialDungeonAugmentation\(initialDungeonGenerationSpec\)[\s\S]*?prepareInitialDungeonAugmentation\(\{[\s\S]*?generationSpec: initialDungeonGenerationSpec,/,
  );
  assert.match(
    normalizationSource,
    /committedAugmentationIdentity: sanitizeDungeonAugmentationSaveIdentity\([\s\S]*?augmentationRequest\.committedAugmentationIdentity,/,
  );
  assert.match(normalizationSource, /basePlanHash,[\s\S]*?isCommittedRun:/);
  assert.match(
    buildWorldSource,
    /const dungeonGenerationSpec = resolveCommittedDungeonGenerationSpec\([\s\S]*?const bundle = useOverworld[\s\S]*?: this\._createLegacyDungeonWorldCandidate\(dungeonGenerationSpec\);/,
  );
});

test('fail-closed loading presents explicit retry and cancel controls', () => {
  const loadingStateSource = sourceBetween(
    'function createDungeonAugmentationLoadingState(container) {',
    '\nfunction normalizeInitialDungeonGenerationSpec(',
  );

  assert.match(loadingStateSource, /retry\.textContent = 'Retry';/);
  assert.match(loadingStateSource, /cancel\.textContent = 'Cancel';/);
  assert.match(
    loadingStateSource,
    /retry\.addEventListener\?\.\('click',[\s\S]*?globalThis\.location\.reload\(\);/,
  );
  assert.match(
    loadingStateSource,
    /cancel\.addEventListener\?\.\('click', complete\);/,
  );
  assert.match(
    loadingStateSource,
    /fail\(error\) \{[\s\S]*?actions\.hidden = false;/,
  );
  assert.match(uiCssSource, /\.dungeon-augmentation-loading-actions\s*\{/);
  assert.match(uiCssSource, /\.dungeon-augmentation-loading-actions\[hidden\]\s*\{/);
  assert.match(uiCssSource, /\.dungeon-augmentation-loading-actions button\s*\{/);
});

test('prepared startup dungeons are consumed only after canonical request identity matches', () => {
  const candidateSource = sourceBetween(
    '  _createLegacyDungeonWorldCandidate({',
    '\n  _assignMountedWorldBundle(',
  );

  assert.match(
    candidateSource,
    /const preparedRequestKey = normalizeInitialDungeonGenerationSpec\(\{[\s\S]*?\}\)\.requestKey;/,
  );
  for (const contract of [
    'preparedInitialDungeon.requestKey === preparedRequestKey',
    'preparedInitialDungeon.layoutSeed === layoutSeed',
    'Number(preparedInitialDungeon.difficulty) === Number(difficulty)',
    'preparedInitialDungeon.bossProfileId === bossProfileId',
    'preparedInitialDungeon.dungeonFamilyId === resolvedDungeonFamilyId',
    'preparedInitialDungeon.basePlanHash === basePlanHash',
  ]) {
    assert.ok(candidateSource.includes(contract), `missing prepared-build match: ${contract}`);
  }
  assert.match(
    candidateSource,
    /preparedInitialDungeon\.augmentationProfileId\s*=== augmentationRequest\.augmentationProfileId/,
  );
  assert.match(
    candidateSource,
    /if \(preparedInitialDungeon && !preparedMatches\) \{[\s\S]*?throw new Error\(/,
  );
  assert.match(
    candidateSource,
    /if \(!preparedDungeon[\s\S]*?augmentationRequest\.augmentationProfileId[\s\S]*?augmentationRequest\.committedAugmentationIdentity[\s\S]*?DUNGEON_AUGMENTATION_ASYNC_PIPELINE_REQUIRED/,
    'production augmented generation must not fall through to the synchronous generator',
  );
});

test('planner cancellation is rethrown before fallback and candidate creation never mutates the mounted world', () => {
  const asyncCandidateSource = sourceBetween(
    '  async _createLegacyDungeonWorldCandidateAsync({',
    '\n  _createLegacyDungeonWorldCandidate({',
  );
  const abortIndex = asyncCandidateSource.indexOf("if (error?.name === 'AbortError')");
  const committedIndex = asyncCandidateSource.indexOf(
    'if (augmentationRequest.committedAugmentationIdentity || strictDisposableRun)',
  );
  const fallbackIndex = asyncCandidateSource.indexOf('const fallbackStartedAt');

  assert.ok(abortIndex >= 0, 'missing explicit cancellation branch');
  assert.ok(committedIndex > abortIndex, 'committed rejection must follow cancellation');
  assert.ok(fallbackIndex > committedIndex, 'authored fallback must follow fail-closed checks');
  assert.match(
    asyncCandidateSource.slice(abortIndex, committedIndex),
    /loadingState\?\.complete\(\);\s*throw error;/,
  );
  assert.match(
    asyncCandidateSource,
    /if \(candidate\) \{\s*this\._disposeUncommittedWorldCandidate\(candidate\);\s*candidate = null;\s*\}[\s\S]*?if \(error\?\.name === 'AbortError'\)/,
  );
  assert.match(
    asyncCandidateSource,
    /const dungeon = await generator\.generateAsync\([\s\S]*?generatedDungeon = dungeon;\s*throwIfDungeonBuildAborted\(signal\);/,
  );
  assert.match(
    asyncCandidateSource,
    /candidate = this\._createLegacyDungeonWorldCandidate\([\s\S]*?generatedDungeon = null;\s*throwIfDungeonBuildAborted\(signal\);[\s\S]*?Object\.defineProperty\(candidate, 'dungeonBuildActivationProgress',[\s\S]*?return candidate;/,
  );
  assert.doesNotMatch(asyncCandidateSource, /_assignMountedWorldBundle\(/);
  assert.doesNotMatch(asyncCandidateSource, /activeWorldBundle\??\.root\??\.removeFromParent/);
});

test('committed builds fail closed while eligible uncommitted failures build an authored parent', () => {
  const initialPrepareSource = sourceBetween(
    'async function prepareInitialDungeonAugmentation({',
    '\nfunction getBusterMagazineRecoveryTime(',
  );
  const asyncCandidateSource = sourceBetween(
    '  async _createLegacyDungeonWorldCandidateAsync({',
    '\n  _createLegacyDungeonWorldCandidate({',
  );

  assert.match(
    initialPrepareSource,
    /augmentationRequest\.committedAugmentationIdentity[\s\S]*?throw error;[\s\S]*?new DungeonGenerator\(\{[\s\S]*?dungeonFamilyId,[\s\S]*?\}\)\.generate\(\)/,
  );
  assert.match(
    asyncCandidateSource,
    /if \(augmentationRequest\.committedAugmentationIdentity \|\| strictDisposableRun\) \{[\s\S]*?loadingState\?\.fail\(error\);[\s\S]*?throw error;[\s\S]*?const fallbackGenerator = new DungeonGenerator\(\{[\s\S]*?\}\);[\s\S]*?const dungeon = fallbackGenerator\.generate\(\);/,
  );
  assert.match(
    asyncCandidateSource,
    /fallback: 'authored-parent',[\s\S]*?preparedDungeon: dungeon,/,
  );

  for (const source of [initialPrepareSource, asyncCandidateSource]) {
    const tryIndex = source.indexOf('try {');
    const workerStartIndex = source.indexOf(
      'plannerSession = createDungeonAugmentationBrowserPlannerSession({ signal });',
    );
    const catchIndex = source.indexOf('} catch (error) {');
    assert.ok(tryIndex >= 0, 'missing planner transaction try boundary');
    assert.ok(workerStartIndex > tryIndex, 'worker construction must be fallback-protected');
    assert.ok(catchIndex > workerStartIndex, 'worker construction must occur before catch');
  }
});

test('prepared-build diagnostics retain cumulative planner and per-repair evidence', () => {
  const initialPrepareSource = sourceBetween(
    'async function prepareInitialDungeonAugmentation({',
    '\nfunction getBusterMagazineRecoveryTime(',
  );
  const asyncCandidateSource = sourceBetween(
    '  async _createLegacyDungeonWorldCandidateAsync({',
    '\n  _createLegacyDungeonWorldCandidate({',
  );
  const transitionDiagnosticsSource = sourceBetween(
    '  getWorldTransitionDiagnostics() {',
    '\n  /**\n   * Returns the small detached state needed by public-input locomotion.',
  );
  const loopSource = sourceBetween(
    '  _loop() {',
    '\n  _getPlayerGroundY() {',
  );
  const mountSource = sourceBetween(
    '  _assignMountedWorldBundle(bundle, { incrementGeneration = true } = {}) {',
    '\n  _buildWorld() {',
  );

  for (const source of [initialPrepareSource, asyncCandidateSource]) {
    for (const field of [
      'totalTimeMs',
      'workerBacked',
      'repairCount',
      'planningPasses',
      'cumulativePlanningTimeMs',
      'authoredGenerationTimeMs',
      'replayTransactionTimeMs',
      'assemblyCount',
      'requestStartedAtMs',
    ]) {
      assert.match(source, new RegExp(`\\b${field}:`), `missing ${field}`);
    }
    assert.match(source, /planningPasses:[\s\S]*?\.map\(\(pass\) => \(\{ \.\.\.pass \}\)\)/);
  }
  assert.match(
    mountSource,
    /buildDiagnostics\.activatedAtMs = activatedAtMs;[\s\S]*?buildDiagnostics\.activationTimeMs = Math\.max\(/,
  );
  assert.match(
    mountSource,
    /const activationProgress = bundle\.dungeonBuildActivationProgress;[\s\S]*?activationProgress\(\{\s*phase: 'activation'/,
    'activation progress must be emitted only after the bundle is mounted',
  );
  assert.match(
    loopSource,
    /renderer\.render\(this\.scene, this\.camera\);[\s\S]*?buildDiagnostics\.firstPlayableFrameAtMs = firstPlayableFrameAtMs;[\s\S]*?buildDiagnostics\.gpuWarmupAndFirstRenderTimeMs = Math\.max\([\s\S]*?buildDiagnostics\.totalTimeMs = Math\.max\(/,
  );
  assert.match(
    transitionDiagnosticsSource,
    /buildDiagnostics: this\.dungeon\?\.preparedBuildDiagnostics \?\? null/,
  );
});
