import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DUNGEON_SELECTION_BAG_FAMILIES,
  createDungeonSelectionBagWitness,
  inspectDungeonRouteNetworkSelectionSequence,
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

function trackedSelectionSequence(family, selectedIds, {
  order: providedOrder = [...new Set(selectedIds.map(String))],
} = {}) {
  const order = [...new Set(providedOrder.map(String))];
  const domainKey = JSON.stringify([...order].sort((first, second) => (
    first.localeCompare(second)
  )));
  let bag = {
    order,
    cycle: 0,
    consumedIds: [],
    domains: {},
    globalConsumedIds: [],
  };
  return selectedIds.map(String).map((selectedId) => {
    let beforeGlobalConsumedIds = [...bag.globalConsumedIds];
    const globalRefilled = beforeGlobalConsumedIds.length >= order.length;
    if (globalRefilled) beforeGlobalConsumedIds = [];
    const before = bag.domains[domainKey] ?? { cycle: 0, consumedIds: [] };
    const refilled = order.every((id) => before.consumedIds.includes(id));
    const after = {
      cycle: before.cycle + (refilled ? 1 : 0),
      consumedIds: [
        ...(refilled ? [] : before.consumedIds),
        selectedId,
      ],
    };
    const state = {
      order: [...order],
      cycle: after.cycle,
      consumedIds: [...after.consumedIds],
      domains: {
        ...bag.domains,
        [domainKey]: after,
      },
      globalConsumedIds: [...new Set([...beforeGlobalConsumedIds, selectedId])],
    };
    const witness = createDungeonSelectionBagWitness({
      family,
      bag,
      legalIds: order,
      selection: {
        id: selectedId,
        refilled,
        beforeGlobalConsumedIds,
        globalRefilled,
        state,
      },
    });
    bag = state;
    return witness;
  });
}

function solveOrderedSelectionOperations() {
  const operations = ['operation-a', 'operation-b', 'operation-c'].map(
    (id, solveDecisionOrdinal) => ({
      id,
      type: 'routeNetwork',
      selectionManifest: {
        solveDecisionOrdinal,
        bagWitnesses: Object.fromEntries(
          DUNGEON_SELECTION_BAG_FAMILIES.map((family) => [family, []]),
        ),
      },
    }),
  );
  for (const family of DUNGEON_SELECTION_BAG_FAMILIES) {
    const witnesses = trackedSelectionSequence(family, [
      `${family}-alpha`,
      `${family}-beta`,
      `${family}-gamma`,
    ]);
    operations.forEach((operation, index) => {
      operation.selectionManifest.bagWitnesses[family] = [witnesses[index]];
    });
  }
  return operations;
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
    (value) => { delete value.globalRefilled; },
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

test('selection witness sequences allow only proven global exhaustion refills', () => {
  const witnesses = trackedSelectionSequence(
    'topology',
    ['topology-alpha', 'topology-beta', 'topology-alpha'],
    { order: ['topology-alpha', 'topology-beta'] },
  );
  assert.equal(witnesses[2].globalRefilled, true);
  const validation = validateDungeonSelectionBagWitnessSequence(
    witnesses,
    { family: 'topology' },
  );
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors));

  const isolatedRefillChunk = validateDungeonSelectionBagWitnessSequence(
    [witnesses[2]],
    { family: 'topology', allowLeadingGlobalRefill: true },
  );
  assert.equal(
    isolatedRefillChunk.accepted,
    true,
    JSON.stringify(isolatedRefillChunk.errors),
  );
  assert.ok(validateDungeonSelectionBagWitnessSequence(
    [witnesses[2]],
    { family: 'topology' },
  ).errors.some(({ code }) => (
    code === 'selection-bag-witness-sequence-global-refill-invalid'
  )));

  const unmarkedReset = structuredClone(witnesses);
  unmarkedReset[2].globalRefilled = false;
  const unmarkedValidation = validateDungeonSelectionBagWitnessSequence(
    unmarkedReset,
    { family: 'topology' },
  );
  assert.ok(unmarkedValidation.errors.some(({ code }) => (
    code === 'selection-bag-witness-sequence-global-state-drift'
  )));

  const prematureReset = structuredClone(witnesses);
  prematureReset[1].globalRefilled = true;
  prematureReset[1].globalConsumedIdsBefore = [];
  prematureReset[1].globalConsumedIdsAfter = [prematureReset[1].selectedId];
  const prematureValidation = validateDungeonSelectionBagWitnessSequence(
    prematureReset,
    { family: 'topology' },
  );
  assert.ok(prematureValidation.errors.some(({ code }) => (
    code === 'selection-bag-witness-sequence-global-refill-invalid'
  )));
});

test('route-network selection inspection accepts proven global refills across operations', () => {
  const witnesses = trackedSelectionSequence(
    'topology',
    ['topology-alpha', 'topology-beta', 'topology-alpha'],
    { order: ['topology-alpha', 'topology-beta'] },
  );
  const operations = witnesses.map((witness, solveDecisionOrdinal) => ({
    id: `operation-${solveDecisionOrdinal}`,
    selectionManifest: {
      solveDecisionOrdinal,
      bagWitnesses: {
        topology: [witness],
        junction: [],
        elevation: [],
        encounter: [],
        roomLayout: [],
      },
    },
  }));
  const inspection = inspectDungeonRouteNetworkSelectionSequence([
    operations[0],
    operations[2],
    operations[1],
  ]);
  assert.equal(inspection.accepted, true, JSON.stringify(inspection.errors));
  assert.deepEqual(inspection.solveOrderedOperationIds, [
    'operation-0',
    'operation-1',
    'operation-2',
  ]);
  assert.equal(inspection.witnessesByFamily.topology[2].globalRefilled, true);
});

test('route-network selection inspection restores solve order without mutating canonical order', () => {
  const [operationA, operationB, operationC] = solveOrderedSelectionOperations();
  const canonicalOperations = [operationA, operationC, operationB];
  const canonicalSnapshot = structuredClone(canonicalOperations);

  const inspection = inspectDungeonRouteNetworkSelectionSequence(canonicalOperations, {
    requireNonEmptyFamilies: true,
  });
  assert.equal(inspection.accepted, true, JSON.stringify(inspection.errors));
  assert.deepEqual(inspection.solveOrderedOperationIds, [
    'operation-a',
    'operation-b',
    'operation-c',
  ]);
  for (const family of DUNGEON_SELECTION_BAG_FAMILIES) {
    assert.deepEqual(
      inspection.witnessesByFamily[family].map(({ selectedId }) => selectedId),
      [`${family}-alpha`, `${family}-beta`, `${family}-gamma`],
    );
    const canonicalWitnesses = canonicalOperations.flatMap((operation) => (
      operation.selectionManifest.bagWitnesses[family]
    ));
    const canonicalValidation = validateDungeonSelectionBagWitnessSequence(
      canonicalWitnesses,
      { family },
    );
    assert.equal(canonicalValidation.accepted, false);
    assert.ok(canonicalValidation.errors.some(({ code }) => (
      code === 'selection-bag-witness-sequence-global-state-drift'
    )));
  }
  assert.deepEqual(canonicalOperations, canonicalSnapshot);
});

test('route-network selection inspection explicitly controls absent-manifest compatibility', () => {
  const absent = [{ id: 'operation-a' }, { id: 'operation-b' }];
  const required = inspectDungeonRouteNetworkSelectionSequence(absent);
  assert.equal(required.accepted, false);
  assert.equal(required.errors[0]?.code, 'route-network-selection-manifest-missing');

  const compatible = inspectDungeonRouteNetworkSelectionSequence(absent, {
    allowAllManifestsAbsent: true,
  });
  assert.equal(compatible.accepted, true, JSON.stringify(compatible.errors));
  assert.deepEqual(compatible.solveOrderedOperationIds, []);
  assert.deepEqual(
    Object.keys(compatible.witnessesByFamily),
    DUNGEON_SELECTION_BAG_FAMILIES,
  );

  const mixed = inspectDungeonRouteNetworkSelectionSequence([
    absent[0],
    solveOrderedSelectionOperations()[1],
  ], { allowAllManifestsAbsent: true });
  assert.equal(mixed.accepted, false);
  assert.equal(
    mixed.errors[0]?.code,
    'route-network-selection-manifest-presence-mixed',
  );
  assert.deepEqual(mixed.errors[0]?.operationIdsWithoutManifest, ['operation-a']);
});

test('route-network selection inspection rejects unsafe and non-contiguous solve ordinals', () => {
  const cases = [{
    label: 'negative',
    ordinals: [0, 1, -1],
    expectedCode: 'route-network-selection-manifest-solve-decision-ordinal-invalid',
  }, {
    label: 'fractional',
    ordinals: [0, 1, 1.5],
    expectedCode: 'route-network-selection-manifest-solve-decision-ordinal-invalid',
  }, {
    label: 'unsafe',
    ordinals: [0, 1, Number.MAX_SAFE_INTEGER + 1],
    expectedCode: 'route-network-selection-manifest-solve-decision-ordinal-invalid',
  }, {
    label: 'duplicate',
    ordinals: [0, 1, 1],
    expectedCode: 'route-network-selection-manifest-solve-decision-ordinal-duplicate',
  }, {
    label: 'gap',
    ordinals: [0, 1, 3],
    expectedCode: 'route-network-selection-manifest-solve-decision-order-invalid',
  }];

  for (const { label, ordinals, expectedCode } of cases) {
    const operations = solveOrderedSelectionOperations();
    operations.forEach((operation, index) => {
      operation.selectionManifest.solveDecisionOrdinal = ordinals[index];
    });
    const inspection = inspectDungeonRouteNetworkSelectionSequence(operations);
    assert.equal(inspection.accepted, false, label);
    assert.ok(
      inspection.errors.some(({ code }) => code === expectedCode),
      `${label}: ${JSON.stringify(inspection.errors)}`,
    );
    assert.deepEqual(inspection.solveOrderedOperationIds, []);
  }
});

test('route-network selection inspection preserves continuity across empty family chunks', () => {
  const operations = solveOrderedSelectionOperations();
  const encounterWitnesses = trackedSelectionSequence('encounter', [
    'encounter-alpha',
    'encounter-gamma',
  ]);
  operations[0].selectionManifest.bagWitnesses.encounter = [encounterWitnesses[0]];
  operations[1].selectionManifest.bagWitnesses.encounter = [];
  operations[2].selectionManifest.bagWitnesses.encounter = [encounterWitnesses[1]];

  const accepted = inspectDungeonRouteNetworkSelectionSequence([
    operations[0],
    operations[2],
    operations[1],
  ], { requireNonEmptyFamilies: true });
  assert.equal(accepted.accepted, true, JSON.stringify(accepted.errors));
  assert.deepEqual(
    accepted.witnessesByFamily.encounter.map(({ selectedId }) => selectedId),
    ['encounter-alpha', 'encounter-gamma'],
  );

  const drifted = structuredClone(operations);
  const finalWitness = drifted[2].selectionManifest.bagWitnesses.encounter[0];
  finalWitness.globalConsumedIdsBefore = [];
  finalWitness.globalConsumedIdsAfter = [finalWitness.selectedId];
  const rejected = inspectDungeonRouteNetworkSelectionSequence(drifted);
  assert.equal(rejected.accepted, false);
  const continuityError = rejected.errors.find(({ witnessError }) => (
    witnessError?.code === 'selection-bag-witness-sequence-global-state-drift'
  ));
  assert.equal(continuityError?.operationId, 'operation-c');
  assert.equal(continuityError?.solveDecisionOrdinal, 2);
  assert.equal(continuityError?.operationWitnessIndex, 0);
});
