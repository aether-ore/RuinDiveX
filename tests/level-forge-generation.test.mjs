import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVEL_FORGE_GENERATOR_VERSION,
  LEVEL_FORGE_SPEC_SCHEMA,
  PROMPT_UNSATISFIABLE,
  generateLevelForgeProject,
  normalizeLevelForgeSpec,
  solveAuthoredProgression,
  validateGeneratedDungeon,
} from '../src/level-editor/automation/index.js';

test('default level forge generation is deterministic and fully editable', async () => {
  const first = await generateLevelForgeProject({ seed: 'deterministic-default' });
  const second = await generateLevelForgeProject({ seed: 'deterministic-default' });

  assert.equal(first.ok, true, first.errors.map(({ code }) => code).join(', '));
  assert.equal(second.ok, true, second.errors.map(({ code }) => code).join(', '));
  assert.deepEqual(second.project, first.project);
  assert.deepEqual(second.receipt, first.receipt);
  assert.equal(first.project.rooms.length, 5);
  assert.equal(first.project.roomModules.length, 5);
  assert.equal(first.project.connections.length, 4);
  assert.equal(first.project.assets.length, 0);
  assert.ok(first.project.roomModules.every((module) => module.primitives.length >= 5));
  assert.ok(first.project.rooms.every((room) => room.transform.position.y === 0));
  assert.ok(first.project.connections.every((connection) => connection.kind === 'service-gallery'));
  assert.equal(first.spec.features.lifts, false);
  assert.equal(first.spec.features.slopes, false);
  assert.equal(first.spec.features.gates, false);
  assert.equal(first.spec.features.puzzles, false);
  assert.equal(first.receipt.registryFallback, false);
  assert.equal(first.project.metadata.promptSpecHash, first.spec.specHash);
  assert.equal(first.project.metadata.generatorVersion, LEVEL_FORGE_GENERATOR_VERSION);
  assert.equal(first.receipt.promptSpecHash, first.spec.specHash);
  assert.equal(first.receipt.generatorVersion, LEVEL_FORGE_GENERATOR_VERSION);
  assert.ok(first.receipt.layoutVariantsTried <= 4);
  assert.ok(first.receipt.repairPasses <= 8);
});

test('default generated dungeon passes compile, strict assembly, progression, and traversal gates', async () => {
  const generated = await generateLevelForgeProject({ seed: 'validated-default' });
  assert.equal(generated.ok, true, generated.errors.map(({ message }) => message).join('\n'));

  const validation = await validateGeneratedDungeon(generated.project, { spec: generated.spec });
  assert.equal(validation.ok, true, validation.errors.map(({ message }) => message).join('\n'));
  assert.equal(validation.compiled.ok, true);
  assert.equal(validation.receipt.strictAssembly, true);
  assert.equal(validation.receipt.exactRegistry, true);
  assert.equal(validation.receipt.registryFallback, false);
  assert.equal(validation.receipt.promptSpecHash, generated.spec.specHash);
  assert.equal(validation.receipt.generatorVersion, LEVEL_FORGE_GENERATOR_VERSION);
  assert.equal(validation.progression.ok, true);
  assert.equal(validation.progression.receipt.unreachableRoomIds.length, 0);
  assert.equal(validation.traversal.ok, true);
  assert.equal(validation.traversal.receipt.connectorDiagnosticsAccepted, true);
});

test('generated validation requires deterministic prompt and generator metadata', async () => {
  const generated = await generateLevelForgeProject({ seed: 'receipt-metadata' });
  assert.equal(generated.ok, true);
  const legacyAliases = structuredClone(generated.project);
  delete legacyAliases.metadata.promptSpecHash;
  delete legacyAliases.metadata.generatorVersion;
  const legacyValidation = await validateGeneratedDungeon(legacyAliases, { spec: generated.spec });
  assert.equal(legacyValidation.ok, true, legacyValidation.errors.map(({ message }) => message).join('\n'));
  assert.equal(legacyValidation.receipt.promptSpecHash, generated.spec.specHash);
  assert.equal(legacyValidation.receipt.generatorVersion, LEVEL_FORGE_GENERATOR_VERSION);

  const incomplete = structuredClone(generated.project);
  delete incomplete.metadata.promptSpecHash;
  delete incomplete.metadata.sourceSpecHash;
  delete incomplete.metadata.generatorVersion;
  delete incomplete.metadata.generator;
  delete incomplete.settings.levelForgeSpecHash;

  const validation = await validateGeneratedDungeon(incomplete, { spec: generated.spec });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some(({ code }) => code === 'FORGE_PROMPT_SPEC_HASH_MISSING'));
  assert.ok(validation.errors.some(({ code }) => code === 'FORGE_GENERATOR_VERSION_MISSING'));
  assert.equal(validation.receipt.promptSpecHash, null);
  assert.equal(validation.receipt.generatorVersion, null);
});

test('branching credential prompt produces a solvable side-room gate', async () => {
  const generated = await generateLevelForgeProject({
    prompt: 'Create a six-room branching industrial keycard dungeon.',
    seed: 'branching-keycard',
  });
  assert.equal(generated.ok, true, generated.errors.map(({ message }) => message).join('\n'));
  assert.equal(generated.spec.layout, 'branching');
  assert.equal(generated.spec.features.gates, true);
  const degrees = new Map(generated.project.rooms.map(({ id }) => [id, 0]));
  for (const connection of generated.project.connections) {
    degrees.set(connection.from.roomId, degrees.get(connection.from.roomId) + 1);
    degrees.set(connection.to.roomId, degrees.get(connection.to.roomId) + 1);
  }
  assert.ok([...degrees.values()].some((degree) => degree >= 3), 'branch anchor should have at least three incident connections');

  const solved = solveAuthoredProgression(generated.dungeon, { requireAllRooms: true });
  assert.equal(solved.ok, true, solved.errors.map(({ message }) => message).join('\n'));
  assert.equal(solved.receipt.unreachableRoomIds.length, 0);
  assert.ok(solved.receipt.acquiredCredentialIds.some((id) => id.startsWith('credential-')));
  assert.equal(solved.receipt.extractionRoomIds.every((id) => solved.receipt.reachableRoomIds.includes(id)), true);
});

test('normalization reports contradictory hard requirements as PROMPT_UNSATISFIABLE', () => {
  const normalized = normalizeLevelForgeSpec({
    schema: LEVEL_FORGE_SPEC_SCHEMA,
    prompt: 'Build exactly five rooms with a lift.',
    roomCount: 6,
    grounded: true,
    requirements: { hard: ['No lifts are allowed.'], soft: [] },
  });
  assert.equal(normalized.ok, false);
  assert.equal(normalized.value, null);
  assert.equal(normalized.spec, null);
  assert.ok(normalized.errors.some(({ code }) => code === PROMPT_UNSATISFIABLE));
  const diagnostic = normalized.errors.find(({ code }) => code === PROMPT_UNSATISFIABLE);
  assert.ok(Array.isArray(diagnostic.details.reasons));
  assert.ok(diagnostic.details.reasons.length >= 2);
});
