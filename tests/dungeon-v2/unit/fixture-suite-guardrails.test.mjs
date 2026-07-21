import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dungeonV2Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const nativeCoverage = Object.freeze([
  {
    relativePath: 'unit/legacy-fixed-room-module-catalog.test.mjs',
    requiredPatterns: [
      /LegacyFixedRoomModuleCatalogV2\.js/,
      /validateLegacyFixedRoomModuleCatalogV2\s*\(/,
      /exactly eleven unique V1 rooms/i,
      /collision parity/i,
    ],
  },
  {
    relativePath: 'unit/legacy-fixed-room-runtime-adapter.test.mjs',
    requiredPatterns: [
      /LegacyFixedRoomRuntimeAdapterV2\.js/,
      /generic-room-box/,
      /all eleven rooms render capped and all-open at every yaw/i,
    ],
  },
  {
    relativePath: 'unit/legacy-fixed-room-golden-composition.test.mjs',
    requiredPatterns: [
      /LegacyFixedRoomGoldenCompositionV2\.js/,
      /all eleven V1 rooms are placed once/i,
      /socket ownership is exhaustive/i,
      /graph is connected, looped, non-linear/i,
    ],
  },
  {
    relativePath: 'fixtures/legacy-fixed-room-assembler-integration.test.mjs',
    requiredPatterns: [
      /LegacyFixedRoomModuleCatalogV2\.js/,
      /assembleDungeonPlanV2\s*\(/,
      /genericFallbackGeometry/,
      /buildLadderRuntimeProofs\s*\(/,
    ],
  },
]);

test('native fixed-room catalog, composition, adapter, and assembler coverage remains mandatory', async () => {
  for (const coverage of nativeCoverage) {
    const filename = path.join(dungeonV2Root, coverage.relativePath);
    const source = await readFile(filename, 'utf8');
    for (const pattern of coverage.requiredPatterns) {
      assert.match(source, pattern, `${coverage.relativePath} lost required native coverage: ${pattern}`);
    }
    assert.doesNotMatch(source, /LegacyAuthoredModuleKitV2\.js/,
      `${coverage.relativePath} reverted to the rejected generic prefab presentation`);
  }
});

test('assembled ladder runtime proof cannot bypass the public Player update path', async () => {
  const relativePath = 'helpers/assembly-proofs.mjs';
  const source = await readFile(path.join(dungeonV2Root, relativePath), 'utf8');
  const ladderProofStart = source.indexOf('function exerciseLadderRuntime');
  const ladderProofEnd = source.indexOf('export function buildLadderRuntimeProofs', ladderProofStart);
  assert.ok(ladderProofStart >= 0 && ladderProofEnd > ladderProofStart,
    `${relativePath} lost its assembled ladder runtime proof`);
  const ladderProofSource = source.slice(ladderProofStart, ladderProofEnd);
  assert.match(ladderProofSource, /controller\.activateNearest\(\)/,
    'ladder mounting must use the public DungeonController interaction');
  assert.match(ladderProofSource, /player\.update\(\s*1\s*\/\s*60/,
    'ladder climbing and automatic dismount must use the public Player update loop');
  assert.doesNotMatch(ladderProofSource, /player\._updateLadderTraversal\s*\(/,
    'the acceptance proof cannot call Player private ladder traversal directly');
  assert.match(ladderProofSource, /postDismountConstraintFrames/,
    'ladder acceptance must survive ordinary collision frames after its handoff expires');

  const journeyPath = 'journey/traversal-lab.public.spec.js';
  const journeySource = await readFile(path.join(dungeonV2Root, journeyPath), 'utf8');
  assert.match(journeySource, /activeFbxAnimationClip[\s\S]*climbingLadder/,
    'browser ladder coverage must prove the authoritative FBX clip is active');
  assert.match(journeySource, /signedPlaneClearance[\s\S]*bodyClearance/,
    'browser ladder coverage must compare the player root with the visual rung plane');
  assert.match(journeySource, /facingAlignment/,
    'browser ladder coverage must reject a character facing away from the rungs');
});

test('full-complex native acceptance is either real or explicitly red', async () => {
  const relativePath = 'native-acceptance/full-complex-native-acceptance.test.mjs';
  const source = await readFile(path.join(dungeonV2Root, relativePath), 'utf8');
  assert.match(source, /FULL_COMPLEX_NATIVE_ACCEPTANCE_SENTINEL/,
    `${relativePath} must remain the named native cutover sentinel`);
  assert.doesNotMatch(source, /LegacyAuthoredModuleKitV2|GoldenRegionAuthoredDetailsV2/,
    `${relativePath} cannot accept the retired generic presentation`);

  const usesUniversalGate = /\bassertAcceptedDungeonFixture\s*\(/.test(source);
  const remainsExplicitlyRed = /assert\.fail\s*\([\s\S]*DUNGEON_V2_NATIVE_FULL_COMPLEX_NOT_IMPLEMENTED/.test(source);
  assert.equal(usesUniversalGate || remainsExplicitlyRed, true,
    `${relativePath} must run universal native acceptance or fail explicitly`);

  if (usesUniversalGate) {
    assert.match(source, /LegacyFixedRoomModuleCatalogV2|compileLegacyFixedRoomPlacementV2/,
      'full-complex acceptance must compose native V1 fixed-room descriptors');
    assert.match(source, /magma/i, 'full-complex acceptance must cover the Magma variant');
    assert.match(source, /electrical/i, 'full-complex acceptance must cover the Electrical variant');
    assert.match(source, /placementCount[\s\S]*11|11[\s\S]*placementCount/,
      'full-complex acceptance must prove all eleven native fixed-room placements');
    assert.match(source, /modulePlacements\.length[\s\S]*14|14[\s\S]*modulePlacements\.length/,
      'full-complex acceptance must prove exactly fourteen authored module placements');
    assert.match(source, /semanticRoomPackPlacements[\s\S]*(?:length|placementCount)[\s\S]*3/,
      'full-complex acceptance must independently prove all three room-pack macros');
    assert.match(source, /genericFallbackGeometry[\s\S]*(?:false|equal)/,
      'full-complex acceptance must reject generic fallback geometry');
    assert.match(source, /createGoldenDungeonPlanV2\s*\(/,
      'full-complex acceptance must construct the actual production Golden plan');
    assert.match(source, /validateDungeonPlanV2\s*\(/,
      'full-complex acceptance must run the production validator');
    assert.match(source, /createRealRoomPackRuntime\s*\(/,
      'full-complex acceptance must load the selected supplied GLBs');
    assert.match(source, /getRealRoomPackRuntimeDiagnostics\s*\(/,
      'full-complex acceptance must prove the real GLTF loader parsed those GLBs');
    assert.match(source, /assertGoldenProductionStateSolver\s*\(/,
      'full-complex acceptance must independently solve the complete state graph');
    for (const proofBuilder of [
      'buildStructuralAssemblyProof',
      'buildIndependentPortalRouteProofs',
      'buildMechanismStateProofs',
      'buildOffscreenStructuralRenderProof',
    ]) {
      assert.match(source, new RegExp(`${proofBuilder}\\s*\\(`),
        `full-complex acceptance lost physical proof builder ${proofBuilder}`);
    }
    assert.doesNotMatch(source,
      /rebuildCanonicalConnections\s*:|addConnectorSpatialContracts\s*:|\b(?:mock|fake|stub)(?:Loader|Coordinator|Route|Plan)/i,
      'full-complex acceptance cannot inject a fake connector, loader, route, or plan');
  }
});

test('universal Golden gate owns exact inventory, endpoint ownership, graph parity, and 21 physical portals', async () => {
  const relativePath = 'helpers/accepted-fixture.mjs';
  const source = await readFile(path.join(dungeonV2Root, relativePath), 'utf8');
  for (const required of [
    /assertGoldenProductionComposition\s*\(/,
    /GOLDEN_PHYSICAL_PORTAL_COUNT\s*=\s*21/,
    /golden-portal-endpoint-region-ownership/,
    /golden-progression-connection-endpoint-mismatch/,
    /golden-minimap-connection-endpoint-mismatch/,
    /genericRoomBodyCount\s*===\s*0/,
    /assertGoldenProductionStateSolver\s*\(/,
    /maximumVisitedStates:\s*750000/,
    /maximumTransitions:\s*8000000/,
  ]) {
    assert.match(source, required, `${relativePath} lost required production gate ${required}`);
  }
});

test('Node acceptance loader delegates actual GLB bytes to Three GLTFLoader.parseAsync', async () => {
  const relativePath = 'helpers/real-room-pack-runtime.mjs';
  const source = await readFile(path.join(dungeonV2Root, relativePath), 'utf8');
  assert.match(source, /class NodeFileGLTFLoader extends GLTFLoader/);
  assert.match(source, /await this\.parseAsync\(arrayBuffer, ['"]['"]\)/,
    'Node acceptance must parse supplied GLB bytes with the real Three loader');
  assert.doesNotMatch(source, /scene:\s*new THREE\.(?:Group|Scene)|synthetic|mock/i,
    'real room-pack acceptance loader cannot synthesize a stand-in scene');
});

test('golden public journey remains an actual-seed, public-input, 11-plus-3 extraction gate', async () => {
  const relativePath = 'journey/golden-complex.public.spec.js';
  const helperRelativePath = 'helpers/journey-runtime.mjs';
  const source = await readFile(path.join(dungeonV2Root, relativePath), 'utf8');
  const helperSource = await readFile(path.join(dungeonV2Root, helperRelativePath), 'utf8');

  assert.match(source, /const variants\s*=\s*\[\s*['"]magma['"]\s*,\s*['"]electrical['"]\s*\]/,
    'the Golden public journey must run both authored hazard variants');
  assert.match(source,
    /page\.goto\(`\/\?dungeonGen=v2&undercroft=\$\{undercroftType\}&seed=m1-golden-\$\{undercroftType\}`\)/,
    'the Golden public journey must launch the actual seeded dungeon URL');
  assert.doesNotMatch(source, /v2Fixture=/,
    'a traversal-lab or named fixture URL cannot satisfy the Golden end-to-end gate');
  assert.match(source, /requiredPlacementCount\)\.toBe\(11\)/,
    'the live journey must prove all eleven native V1 rooms');
  assert.match(source, /semanticRoomPackPresentation/,
    'the live journey must prove the assembled room-pack presentation');
  assert.match(source, /placementCount\)\.toBe\(3\)/,
    'the live journey must prove exactly three room-pack macros');
  for (const roomId of [
    'rdx_factory_corkscrew_exchange',
    'rdx_waterworks_freight_sump',
    'rdx_magma_foundry_undercroft',
    'rdx_electric_transformer_undercroft',
  ]) {
    assert.match(source, new RegExp(roomId),
      `the public journey lost authored macro identity ${roomId}`);
  }
  for (const requiredId of [
    'encounter.assembly',
    'encounter.sorting',
    'encounter.nest',
    'encounter.machine-core',
    'action.pickup.keycard-alpha',
    'action.pickup.keycard-beta',
    'action.pickup.keycard-gamma',
    'action.open.door-alpha',
    'action.open.door-beta',
    'action.open.door-gamma',
    'action.open.door-shrine',
    'action.collect.large-refractor',
    'action.extract',
  ]) {
    assert.match(source, new RegExp(requiredId.replaceAll('.', '\\.')),
      `the public journey lost required progression/content step ${requiredId}`);
  }
  assert.match(source, /expect\(final\.extracted\)\.toBe\(true\)/,
    'the public journey must finish by extracting');
  assert.match(source, /expect\(final\.safeguardActivations\)\.toBe\(0\)/,
    'the public journey must reject every safeguard activation');

  assert.doesNotMatch(source, /page\.evaluate(?:Handle)?\s*\(/,
    'the journey spec cannot reach into the page instead of using its public driver');
  assert.doesNotMatch(source, /(?:player|camera)(?:\.root)?\.position\.(?:set|copy)\s*\(/,
    'the journey cannot write player or camera position');
  assert.doesNotMatch(source, /\._[A-Za-z][A-Za-z0-9_]*\s*\(/,
    'the journey cannot call private runtime methods');
  assert.doesNotMatch(source,
    /(?:grantKey|collectReward|completeEncounter|completeObjective|openGate|clearEnemies)\s*\(/,
    'the journey cannot inject progression, rewards, encounters, or gates');
  assert.match(source, /expectedPortalEndpoints/,
    'the journey must reject physical connector bindings that rewrite the semantic graph');

  assert.match(helperSource, /bridge\.snapshot\(\{\s*profile:\s*requestedProfile\s*\}\)/,
    'the public driver may only observe the deep-cloned diagnostics bridge');
  assert.match(helperSource, /page\.keyboard\./,
    'the public journey helper must drive traversal through keyboard input');
  assert.match(helperSource, /page\.mouse\./,
    'the public journey helper must drive combat through mouse input');
  assert.doesNotMatch(helperSource, /window\.(?:game|ruinDiveX)|window\[['"](?:game|ruinDiveX)['"]\]/i,
    'the public journey helper cannot access a live game singleton');
  assert.doesNotMatch(helperSource, /(?:player|camera)(?:\.root)?\.position\.(?:set|copy)\s*\(/,
    'the public journey helper cannot write player or camera position');
  assert.doesNotMatch(helperSource, /\._[A-Za-z][A-Za-z0-9_]*\s*\(/,
    'the public journey helper cannot call private runtime methods');

  const packageJson = JSON.parse(await readFile(
    path.resolve(dungeonV2Root, '..', '..', 'package.json'),
    'utf8',
  ));
  const journeyCommand = packageJson.scripts?.['test:dungeon-v2:journey'] ?? '';
  assert.match(journeyCommand, /golden-complex\.public\.spec\.js/,
    'test:dungeon-v2:journey must execute the actual-seed Golden expedition');
  assert.doesNotMatch(journeyCommand, /traversal-lab|v2Fixture/,
    'fixture or traversal-lab coverage cannot satisfy test:dungeon-v2:journey');
});
