import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDungeonSelectionBagWitness,
  validateDungeonSelectionBagWitness,
  validateDungeonSelectionBagWitnessSequence,
} from '../src/dungeon-augmentation/selectionBagWitness.js';

const baseBag = Object.freeze({
  order: Object.freeze(['gamma', 'alpha', 'beta']),
  cycle: 0,
  consumedIds: Object.freeze(['gamma']),
});

function selection(id, consumedIds, { cycle = 0, refilled = false } = {}) {
  return {
    id,
    refilled,
    state: {
      order: [...baseBag.order],
      cycle,
      consumedIds,
    },
  };
}

test('selection witnesses preserve shuffled order and exact immutable transitions', () => {
  const witness = createDungeonSelectionBagWitness({
    family: 'topology',
    bag: baseBag,
    legalIds: ['alpha', 'gamma'],
    selection: selection('alpha', ['gamma', 'alpha']),
  });
  assert.deepEqual(witness.order, ['gamma', 'alpha', 'beta']);
  assert.deepEqual(witness.legalIds, ['gamma', 'alpha']);
  assert.equal(validateDungeonSelectionBagWitness(witness).accepted, true);
  assert.deepEqual(baseBag.consumedIds, ['gamma']);
});

test('selection witnesses reject illegal choices, premature refill, and state drift', () => {
  const witness = createDungeonSelectionBagWitness({
    family: 'elevation',
    bag: baseBag,
    legalIds: ['alpha', 'beta'],
    selection: selection('alpha', ['gamma', 'alpha']),
  });
  for (const mutate of [
    (value) => { value.selectedId = 'gamma'; },
    (value) => { value.refilled = true; value.after.cycle = 1; },
    (value) => { value.after.consumedIds = ['alpha']; },
  ]) {
    const invalid = structuredClone(witness);
    mutate(invalid);
    assert.equal(validateDungeonSelectionBagWitness(invalid).accepted, false);
  }
});

test('selection witnesses refill only the exhausted legal subset', () => {
  const domainKey = JSON.stringify(['alpha', 'gamma']);
  const exhausted = {
    order: ['gamma', 'alpha', 'beta'],
    cycle: 2,
    consumedIds: ['gamma', 'alpha'],
    domains: {
      [domainKey]: { cycle: 2, consumedIds: ['gamma', 'alpha'] },
    },
  };
  const witness = createDungeonSelectionBagWitness({
    family: 'roomLayout',
    bag: exhausted,
    legalIds: ['gamma', 'alpha'],
    selection: {
      id: 'gamma',
      refilled: true,
      state: {
        order: [...exhausted.order],
        cycle: 3,
        consumedIds: ['gamma'],
        domains: {
          [domainKey]: { cycle: 3, consumedIds: ['gamma'] },
        },
      },
    },
  });
  assert.equal(validateDungeonSelectionBagWitness(witness).accepted, true);
});

test('selection witness sequences reject committed-state discontinuities', () => {
  const first = createDungeonSelectionBagWitness({
    family: 'encounter',
    bag: { ...baseBag, consumedIds: [] },
    legalIds: baseBag.order,
    selection: selection('gamma', ['gamma']),
  });
  const second = createDungeonSelectionBagWitness({
    family: 'encounter',
    bag: { order: first.order, ...first.after },
    legalIds: baseBag.order,
    selection: selection('alpha', ['gamma', 'alpha']),
  });
  assert.equal(validateDungeonSelectionBagWitnessSequence(
    [first, second],
    { family: 'encounter' },
  ).accepted, true);
  second.before.consumedIds = [];
  assert.equal(validateDungeonSelectionBagWitnessSequence(
    [first, second],
    { family: 'encounter' },
  ).accepted, false);
});
