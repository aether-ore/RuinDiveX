import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDungeonModuleDescriptorV2,
  createDungeonPlanV2,
  isSerializablePlanValue,
} from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';
import { createDungeonSeedStreams } from '../../../src/dungeon-v2/SeededSubstreams.js';
import {
  createPlanDiagnostic,
  hashPlanDiagnostics,
  sortPlanDiagnostics,
} from '../../../src/dungeon-v2/DungeonPlanDiagnostics.js';

test('plan and descriptor creation clone, serialize, and deeply freeze authored data', () => {
  const input = { id: 'module-a', revision: 3, sockets: [{ id: 'socket-a', center: { x: 1, y: 2, z: 3 } }] };
  const descriptor = createDungeonModuleDescriptorV2(input);
  input.sockets[0].center.x = 99;
  assert.equal(descriptor.sockets[0].center.x, 1);
  assert.ok(Object.isFrozen(descriptor));
  assert.ok(Object.isFrozen(descriptor.sockets));
  assert.ok(Object.isFrozen(descriptor.sockets[0].center));
  assert.equal(isSerializablePlanValue(descriptor), true);

  const plan = createDungeonPlanV2({ id: 'plan-a', nested: { values: [1, 2, 3] } });
  assert.ok(Object.isFrozen(plan.nested.values));
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
});

test('plan serialization rejects runtime and executable values', () => {
  assert.equal(isSerializablePlanValue({ predicate: () => true }), false);
  assert.equal(isSerializablePlanValue({ infinity: Number.POSITIVE_INFINITY }), false);
  assert.equal(isSerializablePlanValue(new Map([['room', 1]])), false);
  assert.throws(() => createDungeonPlanV2({ predicate: () => true }));
});

test('named random streams are deterministic and isolated', () => {
  const first = createDungeonSeedStreams('isolation-seed');
  const firstGraph = first.stream('graph');
  const graphBaseline = Array.from({ length: 5 }, () => firstGraph.next());

  const second = createDungeonSeedStreams('isolation-seed');
  const encounter = second.stream('encounter');
  for (let index = 0; index < 100; index += 1) encounter.next();
  const secondGraph = second.stream('graph');
  const graphAfterEncounterChanges = Array.from({ length: 5 }, () => secondGraph.next());
  assert.deepEqual(graphAfterEncounterChanges, graphBaseline);
  assert.notEqual(second.seedFor('graph'), second.seedFor('encounter'));
  assert.equal(second.encounter('assembly').next(), createDungeonSeedStreams('isolation-seed').encounter('assembly').next());
});

test('diagnostics have deterministic ordering and hashes', () => {
  const left = [
    createPlanDiagnostic('open-face', 'open', { cell: 'b' }),
    createPlanDiagnostic('open-face', 'open', { cell: 'a' }),
  ];
  const right = [...left].reverse();
  assert.deepEqual(sortPlanDiagnostics(left), sortPlanDiagnostics(right));
  assert.equal(hashPlanDiagnostics(left), hashPlanDiagnostics(right));
});
