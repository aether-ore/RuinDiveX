import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageUrl = new URL('../../../package.json', import.meta.url);
const journeyRoot = new URL('../journey/', import.meta.url);
const goldenJourneyUrl = new URL('golden-complex.public.spec.js', journeyRoot);
const journeyConfigUrl = new URL('playwright.config.js', journeyRoot);
const journeyTeardownUrl = new URL('global-teardown.mjs', journeyRoot);
const devServerUrl = new URL('../../../scripts/dev-server.mjs', import.meta.url);

function listedJourneySpecs(command = '') {
  return [...command.matchAll(/tests\/dungeon-v2\/journey\/([^\s]+\.spec\.js)/g)]
    .map(([, filename]) => filename);
}

function findObjectInvocation(source, helperName, marker) {
  const callPrefix = `await ${helperName}(page, {`;
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(callPrefix, cursor);
    if (start < 0) return -1;
    const end = source.indexOf('\n  });', start);
    assert.ok(end > start, `${helperName} invocation is not a closed object call`);
    if (source.slice(start, end).includes(marker)) return start;
    cursor = end + 1;
  }
  return -1;
}

test('V2 end-to-end and fixture journeys remain separate test classes', async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, 'utf8'));
  const journeyCommand = packageJson.scripts?.['test:dungeon-v2:journey'] ?? '';
  const fixtureCommand = packageJson.scripts?.['test:dungeon-v2:fixture-journey'] ?? '';
  const verifyCommand = packageJson.scripts?.['verify:dungeon-v2'] ?? '';
  const journeySpecs = listedJourneySpecs(journeyCommand);
  const fixtureSpecs = listedJourneySpecs(fixtureCommand);

  assert.ok(journeySpecs.includes('golden-complex.public.spec.js'),
    'the V2 end-to-end command must execute the seeded golden-complex journey');
  assert.ok(fixtureSpecs.includes('traversal-lab.public.spec.js'),
    'the traversal lab must remain an explicitly classified fixture journey');
  assert.deepEqual(journeySpecs.filter((filename) => fixtureSpecs.includes(filename)), [],
    'no fixture-journey spec may also count as a V2 end-to-end journey');
  assert.doesNotMatch(journeyCommand,
    /traversal-lab|entry-portal|jump-heartbeat|ladder-alignment|performance-smoke/i,
    'component and traversal-lab specs cannot satisfy the end-to-end command');
  assert.doesNotMatch(journeyCommand, /--grep(?:-invert)?\b|--shard\b/i,
    'the mandatory end-to-end command may not filter or shard away a golden variant');
  assert.match(verifyCommand, /npm run test:dungeon-v2:journey\b/,
    'the full V2 verifier must require the seeded golden end-to-end journey');
  assert.match(verifyCommand, /npm run test:dungeon-v2:fixture-journey\b/,
    'fixture journeys remain useful but must execute under their separate classification');
  assert.ok(
    verifyCommand.indexOf('test:dungeon-v2:journey')
      < verifyCommand.indexOf('test:dungeon-v2:fixture-journey'),
    'the seeded golden journey must run before supplemental fixture journeys',
  );
});

test('isolated journey server has an owned bounded teardown without reuse', async () => {
  const [configSource, teardownSource, serverSource] = await Promise.all([
    readFile(journeyConfigUrl, 'utf8'),
    readFile(journeyTeardownUrl, 'utf8'),
    readFile(devServerUrl, 'utf8'),
  ]);
  assert.match(configSource, /reuseExistingServer:\s*false/,
    'V2 journeys must reject an already-running server on their isolated port');
  assert.match(configSource, /globalTeardown:\s*['"]\.\/global-teardown\.mjs['"]/,
    'V2 journeys must close their owned server before Playwright Windows process-tree teardown');
  assert.match(configSource, /DUNGEON_V2_SERVER_SHUTDOWN_TOKEN:\s*shutdownToken/,
    'the isolated server must receive a per-run shutdown token');
  assert.match(teardownSource, /method:\s*['"]POST['"]/);
  assert.match(teardownSource, /X-Dungeon-V2-Shutdown-Token/);
  assert.match(teardownSource, /waitForPortToClose\(port\)/,
    'teardown must prove that the isolated listener actually closed');
  assert.match(serverSource, /if \(!testShutdownToken\) \{[\s\S]*?response\.writeHead\(404\)/,
    'ordinary development servers must not expose the test-only shutdown endpoint');
  assert.match(serverSource, /request\.method !== ['"]POST['"] \|\| suppliedToken !== testShutdownToken/,
    'the test-only shutdown endpoint must reject unowned requests');
});

test('seeded golden journey proves every closed credential gate before extraction', async () => {
  const source = await readFile(goldenJourneyUrl, 'utf8');

  assert.match(source, /page\.goto\(\s*`\/\?dungeonGen=v2[^`]*[?&]seed=[^`]+`\s*\)/,
    'golden E2E must load an explicit deterministic seed through the public URL');
  assert.doesNotMatch(source, /v2Fixture=/,
    'golden E2E must exercise the default seeded V2 level, not a fixture route');
  assert.match(source, /const variants = \['magma', 'electrical'\]/,
    'both seeded Undercroft variants remain mandatory');
  assert.doesNotMatch(source, /\btest\.(?:skip|fixme)\b|\b(?:describe|test)\.skip\b/,
    'the mandatory golden journey may never be skipped or marked fixme');
  assert.ok(source.includes('await completeGoldenExpedition(page);'),
    'each golden variant must execute the complete spawn-to-extraction expedition');
  const starterLoadoutCheck = source.indexOf('await selectAndVerifyStarterLoadoutPublicly(page);');
  const completeExpedition = source.indexOf('await completeGoldenExpedition(page);');
  assert.ok(starterLoadoutCheck >= 0,
    'each golden variant must verify difficulty-one starter equipment before traversal');
  assert.ok(starterLoadoutCheck < completeExpedition,
    'difficulty and starter equipment must be proven before dungeon traversal begins');
  assert.match(source, /page\.keyboard\.press\(['"]Digit1['"]\)/,
    'the mandatory journey must select the starter Mega Buster through public hotbar input');
  for (const marker of [
    'difficulty: 1',
    "id: 'megaBuster'",
    "kind: 'megaBuster'",
    "ownedArmIds: ['laserBeamBlade', 'liftArm']",
    "unlockedGearIds: ['reinforcedArmorFrame']",
    'sandboxActive: false',
    'testRangeActive: false',
  ]) {
    assert.ok(source.includes(marker),
      `golden E2E must explicitly retain its starter-loadout assertion: ${marker}`);
  }

  const gateFlows = [
    {
      name: 'Alpha',
      proofName: 'alphaGateProof',
      challengeMarker: "actionId: 'action.open.door-alpha'",
      collectMarker: "actionId: 'action.pickup.keycard-alpha'",
      keycardMarker: "keycardId: 'Keycard_Alpha'",
      openMarker: "actionId: 'action.open.door-alpha'",
    },
    {
      name: 'Beta',
      proofName: 'betaGateProof',
      challengeMarker: "actionId: 'action.open.door-beta'",
      collectMarker: "actionId: 'action.pickup.keycard-beta'",
      keycardMarker: "keycardId: 'Keycard_Beta'",
      openMarker: "actionId: 'action.open.door-beta'",
    },
    {
      name: 'Gamma',
      proofName: 'gammaGateProof',
      challengeMarker: "actionId: 'action.open.door-gamma'",
      collectMarker: "actionId: 'action.pickup.keycard-gamma'",
      keycardMarker: "keycardId: 'Keycard_Gamma'",
      openMarker: "actionId: 'action.open.door-gamma'",
    },
    {
      name: 'Shrine',
      proofName: 'shrineGateProof',
      challengeMarker: "actionId: 'action.open.door-shrine'",
      collectMarker: "actionId: 'action.collect.shrine-key'",
      openMarker: "actionId: 'action.open.door-shrine'",
    },
  ];

  const extraction = source.indexOf("await operateActionPublicly(page, 'action.extract')");
  assert.ok(extraction >= 0, 'golden E2E must finish through the public extraction action');

  for (const flow of gateFlows) {
    const challenge = findObjectInvocation(
      source,
      'expectClosedGateRejectsPublicBypass',
      flow.challengeMarker,
    );
    const collect = findObjectInvocation(source, 'collectCredentialPublicly', flow.collectMarker);
    const openAndCross = findObjectInvocation(
      source,
      'openGateFromValidSideAndCrossPublicly',
      flow.openMarker,
    );

    assert.ok(challenge >= 0, `${flow.name} must be challenged with public movement while closed`);
    assert.ok(source.slice(Math.max(0, challenge - 80), challenge)
      .includes(`const ${flow.proofName} = `),
    `${flow.name} must retain the runtime proof returned by its physical closed-gate challenge`);
    assert.ok(collect > challenge, `${flow.name} key must be collected only after the closed-gate challenge`);
    const collectEnd = source.indexOf('\n  });', collect);
    assert.ok(source.slice(collect, collectEnd).includes(`priorGateProof: ${flow.proofName}`),
      `${flow.name} pickup must prove its corresponding earlier gate is still physically closed`);
    if (flow.keycardMarker) {
      assert.equal(
        findObjectInvocation(source, 'collectCredentialPublicly', flow.keycardMarker),
        collect,
        `${flow.name} public pickup must assert its exact inventory key contract`,
      );
    }
    assert.ok(openAndCross > collect, `${flow.name} gate must be opened and physically crossed after collection`);
    const openEnd = source.indexOf('\n  });', openAndCross);
    assert.ok(source.slice(openAndCross, openEnd).includes(`closedGateProof: ${flow.proofName}`),
      `${flow.name} open/cross step must consume the same physical closed-gate proof`);
    assert.ok(extraction > openAndCross, `${flow.name} gate proof must complete before extraction`);
  }

  const credentialHelperStart = source.indexOf('async function collectCredentialPublicly');
  const credentialHelperEnd = source.indexOf(
    '\n}\n\nasync function openGateFromValidSideAndCrossPublicly',
    credentialHelperStart,
  );
  assert.ok(credentialHelperStart >= 0 && credentialHelperEnd > credentialHelperStart,
    'golden E2E must retain its public physical-keycard helper');
  const credentialHelper = source.slice(credentialHelperStart, credentialHelperEnd);
  for (const assertion of [
    'expectVisibleKeycardPickup(before, {',
    'expectVisibleKeycardPickup(observed, {',
    'expect(newlyOwned).toEqual([keycardId])',
    'renderVisible: false',
    'getPublicActionApproachPoints(action, before.playerPosition)',
    'steerToWorldPointPublicly(page, staging, {',
    'steerToWorldPointPublicly(page, approach, {',
    'did not auto-collect after physically reaching its pedestal',
    'requirePhysicalApproach: true',
    'physicallyObservedBeforePickup',
    'expectPhysicalGateState(before, priorGateProof.barrierId, { open: false })',
  ]) {
    assert.ok(credentialHelper.includes(assertion),
      `golden E2E must retain its physical/inventory keycard assertion: ${assertion}`);
  }
  const visibilityHelperStart = source.indexOf('function expectVisibleKeycardPickup');
  const visibilityHelperEnd = source.indexOf('\n}\n\n/**', visibilityHelperStart);
  assert.ok(visibilityHelperStart >= 0 && visibilityHelperEnd > visibilityHelperStart,
    'golden E2E must retain its physical keycard visibility helper');
  const visibilityHelper = source.slice(visibilityHelperStart, visibilityHelperEnd);
  for (const assertion of [
    'const pickup = diagnostics.keycardPickups?.find',
    'expect(pickup).toMatchObject({',
    'renderAttached: true',
    'renderVisible: true',
    'pedestalAttached: true',
    'expect(diagnostics.ownedKeycardIds).not.toContain(keycardId)',
    'diagnostics.currentPrompt?.actionId',
    'horizontalDistance',
    'visualDistanceFromCamera',
    'facingDot',
  ]) {
    assert.ok(visibilityHelper.includes(assertion),
      `golden E2E must retain its at-pedestal visibility assertion: ${assertion}`);
  }

  for (const encounterId of [
    'encounter.assembly',
    'encounter.sorting',
    'encounter.nest',
    'encounter.machine-core',
  ]) {
    assert.ok(source.includes(`await defeatEncounterPublicly(page, '${encounterId}'`),
      `${encounterId} must be defeated through the public combat driver`);
  }
  for (const assertion of [
    'expect(final.extracted).toBe(true)',
    'expectExactIds(final.visitedRegionIds, expectedRegionIds)',
    'expectExactIds(final.completedEncounterIds, expectedEncounterIds)',
    'expectExactIds(final.collectedRewardIds, expectedRewardIds)',
    'expectExactIds(final.completedObjectiveIds, expectedObjectiveIds)',
    'expect(final.safeguardActivations).toBe(0)',
    'expect(final.errors).toEqual([])',
  ]) {
    assert.ok(source.includes(assertion),
      `golden E2E must retain its final acceptance assertion: ${assertion}`);
  }

  const gateHelperStart = source.indexOf('async function openGateFromValidSideAndCrossPublicly');
  const gateHelperEnd = source.indexOf('\n}\n\nasync function completeGoldenExpedition', gateHelperStart);
  assert.ok(gateHelperStart >= 0 && gateHelperEnd > gateHelperStart,
    'golden E2E must retain its public gate-open-and-cross helper');
  const gateHelper = source.slice(gateHelperStart, gateHelperEnd);
  const publicOpen = gateHelper.indexOf('await operateActionPublicly(page, actionId');
  const physicalCross = gateHelper.indexOf('await steerThroughPortalPublicly(page, portalId');
  assert.ok(publicOpen >= 0 && physicalCross > publicOpen,
    'the gate helper must operate the action, then physically cross its portal with public input');
  assert.ok(gateHelper.includes('expectPhysicalGateState(before, barrierId, { open: false })'),
    'the gate helper must observe an active physical barrier before public interaction');
  assert.ok(gateHelper.includes('expectPhysicalGateState(opened, barrierId, { open: true })'),
    'the gate helper must observe disabled barrier colliders after public interaction');
  assert.ok(gateHelper.includes('expectPhysicalGateState(crossed, barrierId, { open: true })'),
    'the gate helper must prove the physical barrier stays open after crossing');
});
