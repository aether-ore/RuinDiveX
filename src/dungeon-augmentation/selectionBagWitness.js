export const DUNGEON_SELECTION_BAG_WITNESS_SCHEMA =
  'ruindivex-dungeon-selection-bag-witness/v2';

export const DUNGEON_SELECTION_BAG_FAMILIES = Object.freeze([
  'topology',
  'junction',
  'elevation',
  'encounter',
  'roomLayout',
]);

const FAMILY_SET = new Set(DUNGEON_SELECTION_BAG_FAMILIES);

function stringsInOrder(values = []) {
  return (Array.isArray(values) ? values : []).map(String);
}

function uniqueStringsInOrder(values = []) {
  return [...new Set(stringsInOrder(values).filter(Boolean))];
}

function bagState(state = {}) {
  return {
    cycle: Math.max(0, Math.trunc(Number(state?.cycle ?? 0))),
    consumedIds: uniqueStringsInOrder(state?.consumedIds),
  };
}

function selectionDomainKey(legalIds = []) {
  return JSON.stringify([...new Set(stringsInOrder(legalIds).filter(Boolean))].sort(
    (first, second) => first.localeCompare(second),
  ));
}

function domainState(state, domainKey) {
  const domains = state?.domains && typeof state.domains === 'object'
    && !Array.isArray(state.domains)
    ? state.domains
    : null;
  if (domains?.[domainKey]) return bagState(domains[domainKey]);
  if (!domains || Object.keys(domains).length === 0) return bagState(state);
  return { cycle: 0, consumedIds: [] };
}

function normalizedDomains(state, domainKey, activeState) {
  const entries = Object.entries(
    state?.domains && typeof state.domains === 'object'
      && !Array.isArray(state.domains)
      ? state.domains
      : {},
  ).sort(([first], [second]) => first.localeCompare(second));
  const domains = Object.fromEntries(entries.map(([key, value]) => [key, bagState(value)]));
  if (domainKey && !domains[domainKey]) domains[domainKey] = bagState(activeState);
  return Object.fromEntries(Object.entries(domains).sort(
    ([first], [second]) => first.localeCompare(second),
  ));
}

function sameStrings(left, right) {
  const first = stringsInOrder(left);
  const second = stringsInOrder(right);
  return first.length === second.length
    && first.every((value, index) => value === second[index]);
}

function sameBagState(left, right) {
  return Number(left?.cycle) === Number(right?.cycle)
    && sameStrings(left?.consumedIds, right?.consumedIds);
}

function sameDomainStates(left, right) {
  const first = left && typeof left === 'object' ? left : {};
  const second = right && typeof right === 'object' ? right : {};
  const keys = [...new Set([...Object.keys(first), ...Object.keys(second)])];
  const empty = { cycle: 0, consumedIds: [] };
  return keys.every((key) => sameBagState(first[key] ?? empty, second[key] ?? empty));
}

function domainStatesExtendContinuously(previous, next) {
  const first = previous && typeof previous === 'object' ? previous : {};
  const second = next && typeof next === 'object' ? next : {};
  return Object.keys(first).every((key) => (
    Object.hasOwn(second, key) && sameBagState(first[key], second[key])
  ));
}

export function createDungeonSelectionBagWitness({
  family,
  bag,
  legalIds = [],
  selection,
} = {}) {
  const order = uniqueStringsInOrder(bag?.order);
  const legalSet = new Set(uniqueStringsInOrder(legalIds));
  const orderedLegalIds = order.filter((id) => legalSet.has(id));
  const domainKey = String(
    selection?.domainKey ?? selectionDomainKey(orderedLegalIds),
  );
  const before = selection?.beforeDomainState
    ? bagState(selection.beforeDomainState)
    : domainState(bag, domainKey);
  const after = domainState(selection?.state, domainKey);
  const globalTracking = Array.isArray(selection?.beforeGlobalConsumedIds)
    && Array.isArray(selection?.state?.globalConsumedIds);
  return {
    schema: DUNGEON_SELECTION_BAG_WITNESS_SCHEMA,
    family: String(family ?? ''),
    order,
    legalIds: orderedLegalIds,
    domainKey,
    domainWasPresent: Boolean(bag?.domains?.[domainKey]),
    before,
    selectedId: String(selection?.id ?? ''),
    refilled: selection?.refilled === true,
    after,
    domainsBefore: normalizedDomains(bag, domainKey, before),
    domainsAfter: normalizedDomains(selection?.state, domainKey, after),
    globalTracking,
    globalConsumedIdsBefore: globalTracking
      ? uniqueStringsInOrder(selection.beforeGlobalConsumedIds)
      : [],
    globalConsumedIdsAfter: globalTracking
      ? uniqueStringsInOrder(selection.state.globalConsumedIds)
      : [],
  };
}

export function validateDungeonSelectionBagWitness(witness) {
  const errors = [];
  const add = (code, details = {}) => errors.push({ code, ...details });
  if (!witness || typeof witness !== 'object') {
    return {
      accepted: false,
      errors: [{ code: 'selection-bag-witness-malformed' }],
    };
  }
  if (witness.schema !== DUNGEON_SELECTION_BAG_WITNESS_SCHEMA) {
    add('selection-bag-witness-schema-invalid', { schema: witness.schema ?? null });
  }
  const family = String(witness.family ?? '');
  if (!FAMILY_SET.has(family)) add('selection-bag-witness-family-invalid', { family });
  const order = stringsInOrder(witness.order).filter(Boolean);
  const legalIds = stringsInOrder(witness.legalIds).filter(Boolean);
  const beforeConsumedIds = stringsInOrder(witness.before?.consumedIds).filter(Boolean);
  const afterConsumedIds = stringsInOrder(witness.after?.consumedIds).filter(Boolean);
  const selectedId = String(witness.selectedId ?? '');
  const domainKey = String(witness.domainKey ?? '');
  const expectedDomainKey = selectionDomainKey(legalIds);
  const globalConsumedIdsBefore = uniqueStringsInOrder(
    witness.globalConsumedIdsBefore,
  );
  const globalConsumedIdsAfter = uniqueStringsInOrder(
    witness.globalConsumedIdsAfter,
  );
  for (const [label, values] of [
    ['order', order],
    ['legal', legalIds],
    ['before-consumed', beforeConsumedIds],
    ['after-consumed', afterConsumedIds],
  ]) {
    if (values.length !== new Set(values).size) {
      add('selection-bag-witness-ids-duplicated', { label });
    }
  }
  if (order.length === 0 || legalIds.length === 0 || !selectedId || !domainKey) {
    add('selection-bag-witness-malformed');
  }
  if (domainKey !== expectedDomainKey) {
    add('selection-bag-witness-domain-key-invalid', {
      expectedDomainKey,
      actualDomainKey: domainKey,
    });
  }
  const orderSet = new Set(order);
  if (legalIds.some((id) => !orderSet.has(id))) {
    add('selection-bag-witness-legal-id-unknown');
  }
  if (beforeConsumedIds.some((id) => !orderSet.has(id))
    || afterConsumedIds.some((id) => !orderSet.has(id))) {
    add('selection-bag-witness-consumed-id-unknown');
  }
  if (beforeConsumedIds.some((id) => !legalIds.includes(id))
    || afterConsumedIds.some((id) => !legalIds.includes(id))) {
    add('selection-bag-witness-domain-consumed-id-illegal');
  }
  if (witness.globalTracking === true) {
    if (globalConsumedIdsBefore.some((id) => !orderSet.has(id))
      || globalConsumedIdsAfter.some((id) => !orderSet.has(id))) {
      add('selection-bag-witness-global-consumed-id-unknown');
    }
    const expectedGlobalConsumedIdsAfter = uniqueStringsInOrder([
      ...globalConsumedIdsBefore,
      selectedId,
    ]);
    if (!sameStrings(globalConsumedIdsAfter, expectedGlobalConsumedIdsAfter)) {
      add('selection-bag-witness-global-state-drift', {
        expectedGlobalConsumedIdsAfter,
        actualGlobalConsumedIdsAfter: globalConsumedIdsAfter,
      });
    }
    if (witness.domainWasPresent !== true) {
      const expectedSeededConsumedIds = order.filter((id) => (
        legalIds.includes(id) && globalConsumedIdsBefore.includes(id)
      ));
      if (Number(witness.before?.cycle) !== 0
        || !sameStrings(beforeConsumedIds, expectedSeededConsumedIds)) {
        add('selection-bag-witness-domain-seed-drift', {
          expectedSeededConsumedIds,
          actualSeededConsumedIds: beforeConsumedIds,
        });
      }
    }
  }
  if (!legalIds.includes(selectedId)) {
    add('selection-bag-witness-selection-illegal', { selectedId });
  }
  const beforeCycle = Number(witness.before?.cycle);
  const afterCycle = Number(witness.after?.cycle);
  if (!Number.isSafeInteger(beforeCycle) || beforeCycle < 0
    || !Number.isSafeInteger(afterCycle) || afterCycle < 0) {
    add('selection-bag-witness-cycle-invalid');
  }
  const legalSet = new Set(legalIds);
  const beforeConsumedSet = new Set(beforeConsumedIds);
  const availableIds = order.filter((id) => (
    legalSet.has(id) && !beforeConsumedSet.has(id)
  ));
  const expectedRefilled = availableIds.length === 0;
  if (Boolean(witness.refilled) !== expectedRefilled) {
    add('selection-bag-witness-refill-invalid', {
      expectedRefilled,
      actualRefilled: Boolean(witness.refilled),
    });
  }
  if (!expectedRefilled && !availableIds.includes(selectedId)) {
    add('selection-bag-witness-selection-consumed', { selectedId });
  }
  const expectedAfterCycle = beforeCycle + (expectedRefilled ? 1 : 0);
  if (Number.isFinite(beforeCycle) && afterCycle !== expectedAfterCycle) {
    add('selection-bag-witness-cycle-drift', {
      expectedAfterCycle,
      actualAfterCycle: afterCycle,
    });
  }
  const expectedAfterConsumedIds = [
    ...(expectedRefilled ? [] : order.filter((id) => (
      legalSet.has(id) && beforeConsumedSet.has(id)
    ))),
    selectedId,
  ].filter(Boolean);
  if (!sameStrings(afterConsumedIds, expectedAfterConsumedIds)) {
    add('selection-bag-witness-consumed-state-drift', {
      expectedAfterConsumedIds,
      actualAfterConsumedIds: afterConsumedIds,
    });
  }
  const domainsBefore = witness.domainsBefore;
  const domainsAfter = witness.domainsAfter;
  if (!domainsBefore || typeof domainsBefore !== 'object' || Array.isArray(domainsBefore)
    || !domainsAfter || typeof domainsAfter !== 'object' || Array.isArray(domainsAfter)) {
    add('selection-bag-witness-domain-state-malformed');
  } else {
    if (!sameBagState(domainsBefore[domainKey], witness.before)) {
      add('selection-bag-witness-domain-before-drift');
    }
    if (!sameBagState(domainsAfter[domainKey], witness.after)) {
      add('selection-bag-witness-domain-after-drift');
    }
    const expectedDomainsAfter = {
      ...domainsBefore,
      [domainKey]: bagState(witness.after),
    };
    if (!sameDomainStates(domainsAfter, expectedDomainsAfter)) {
      add('selection-bag-witness-domain-state-drift');
    }
  }
  return { accepted: errors.length === 0, errors };
}

export function validateDungeonSelectionBagWitnessSequence(witnesses = [], {
  family = null,
  requireNonEmpty = true,
} = {}) {
  const ordered = Array.isArray(witnesses) ? witnesses : [];
  const errors = [];
  if (requireNonEmpty && ordered.length === 0) {
    errors.push({ code: 'selection-bag-witness-sequence-empty', family });
  }
  let previous = null;
  for (const [index, witness] of ordered.entries()) {
    const validation = validateDungeonSelectionBagWitness(witness);
    errors.push(...validation.errors.map((error) => ({ ...error, index })));
    if (family && String(witness?.family ?? '') !== String(family)) {
      errors.push({
        code: 'selection-bag-witness-sequence-family-mismatch',
        index,
        expectedFamily: family,
        actualFamily: witness?.family ?? null,
      });
    }
    const sequenceContinuous = previous && previous.domainsAfter && witness?.domainsBefore
      ? domainStatesExtendContinuously(previous.domainsAfter, witness.domainsBefore)
      : previous
        ? sameBagState(previous.after, witness?.before)
        : true;
    if (!sequenceContinuous) {
      errors.push({
        code: 'selection-bag-witness-sequence-state-drift',
        index,
        expectedBefore: previous.domainsAfter ?? previous.after,
        actualBefore: witness?.domainsBefore ?? witness?.before ?? null,
      });
    }
    if (previous?.globalTracking === true && witness?.globalTracking === true
      && !sameStrings(
        previous.globalConsumedIdsAfter,
        witness.globalConsumedIdsBefore,
      )) {
      errors.push({
        code: 'selection-bag-witness-sequence-global-state-drift',
        index,
        expectedBefore: previous.globalConsumedIdsAfter,
        actualBefore: witness.globalConsumedIdsBefore,
      });
    }
    previous = witness;
  }
  return { accepted: errors.length === 0, errors };
}
