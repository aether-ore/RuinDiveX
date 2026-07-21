import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertAllJourneySourcesGuarded,
  assertJourneyRuntimeHelperGuarded,
  auditJourneySource,
  auditJourneyRuntimeHelperSource,
} from '../helpers/source-guardrails.mjs';

test('every V2 journey source passes anti-cheat guardrails', async () => {
  const files = await assertAllJourneySourcesGuarded();
  assert.ok(files.some((filename) => filename.endsWith('golden-complex.public.spec.js')));
});

test('shared public-input driver permits only audited read-only browser probes', async () => {
  const filename = await assertJourneyRuntimeHelperGuarded();
  assert.match(filename, /journey-runtime\.mjs$/);
});

test('shared public-input driver rejects browser evaluation outside its narrow allowlist', async () => {
  const source = await readFile(new URL('../helpers/journey-runtime.mjs', import.meta.url), 'utf8');
  const injected = `${source}\nasync function cheat(page) { return page.evaluate(() => window.game); }\n`;
  const violations = auditJourneyRuntimeHelperSource(injected);
  assert.ok(violations.some(({ code }) => code === 'journey-helper-unapproved-page-evaluate'));
  assert.ok(violations.some(({ code }) => code === 'journey-live-game-access'));
});

test('shared public-input driver rejects writes through diagnostics snapshots', async () => {
  const source = await readFile(new URL('../helpers/journey-runtime.mjs', import.meta.url), 'utf8');
  const injected = source.replace(
    'if (snapshot !== null) {',
    'snapshot.health = 999;\n  if (snapshot !== null) {',
  );
  assert.ok(auditJourneyRuntimeHelperSource(injected)
    .some(({ code }) => code === 'journey-helper-diagnostics-write'));
});

const forbiddenExamples = [
  ['journey-private-method', 'PUBLIC_INPUT_JOURNEY; runtime._collectKeycard();'],
  ['journey-position-write', 'PUBLIC_INPUT_JOURNEY; player.position.set(1, 2, 3);'],
  ['journey-position-assignment', 'PUBLIC_INPUT_JOURNEY; camera.position.y = 20;'],
  ['journey-state-injection', 'PUBLIC_INPUT_JOURNEY; activateExtraction();'],
  ['journey-preview-teleport', 'PUBLIC_INPUT_JOURNEY; const url = "?roomPreview=shrine";'],
  ['journey-live-game-access', 'PUBLIC_INPUT_JOURNEY; const game = window.__RUINDIVEX_GAME__;'],
  ['journey-page-evaluate', 'PUBLIC_INPUT_JOURNEY; await page.evaluate(() => 1);'],
  ['journey-direct-state-write', 'PUBLIC_INPUT_JOURNEY; ownedKeys.alpha = true;'],
  ['journey-storage-injection', 'PUBLIC_INPUT_JOURNEY; localStorage.setItem("keys", "all");'],
  ['journey-script-injection', 'PUBLIC_INPUT_JOURNEY; await page.addScriptTag({ content: "cheat()" });'],
  ['journey-direct-generator', 'PUBLIC_INPUT_JOURNEY; import DungeonGenerator from "../../../src/DungeonGenerator.js";'],
  ['journey-init-script', 'PUBLIC_INPUT_JOURNEY; await context.addInitScript(() => {});'],
];

for (const [code, source] of forbiddenExamples) {
  test(`journey audit catches ${code}`, () => {
    assert.ok(auditJourneySource(source).some((violation) => violation.code === code));
  });
}

test('journey audit requires an explicit public-input classification', () => {
  assert.ok(auditJourneySource('test("route", async () => {});').some((item) => item.code === 'journey-missing-public-input-marker'));
});

test('V2 startup does not expose the live Game object or mutation hooks', async () => {
  const source = await readFile(new URL('../../../src/main.js', import.meta.url), 'utf8');
  const legacyHookGuard = source.match(/if \(dungeonGenerationRequest\.mode !== DUNGEON_GENERATION_MODE\.V2\) \{([\s\S]*?)\n\}/);
  assert.ok(legacyHookGuard, 'legacy browser hooks require an explicit non-V2 guard');
  assert.match(legacyHookGuard[1], /window\.game = game/);
  assert.match(legacyHookGuard[1], /window\.spawnElite/);
  const outsideGuard = source.replace(legacyHookGuard[0], '');
  assert.doesNotMatch(outsideGuard, /window\.(?:game|spawnElite|spawnReaverbot|generateLoot|openInventory)\s*=/);
});
