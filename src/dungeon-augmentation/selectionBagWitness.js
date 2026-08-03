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
    globalRefilled: globalTracking && selection?.globalRefilled === true,
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
  if (typeof witness.globalRefilled !== 'boolean') {
    add('selection-bag-witness-global-refill-flag-invalid', {
      globalRefilled: witness.globalRefilled ?? null,
    });
  }
  if (witness.globalRefilled === true && witness.globalTracking !== true) {
    add('selection-bag-witness-global-refill-tracking-invalid');
  }
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
    if (witness.globalRefilled === true && globalConsumedIdsBefore.length !== 0) {
      add('selection-bag-witness-global-refill-before-invalid', {
        actualGlobalConsumedIdsBefore: globalConsumedIdsBefore,
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
  allowLeadingGlobalRefill = false,
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
    if (witness?.globalRefilled === true
      && !(allowLeadingGlobalRefill && index === 0)) {
      const previousOrder = uniqueStringsInOrder(previous?.order);
      const previousGlobalConsumedIdsAfter = uniqueStringsInOrder(
        previous?.globalConsumedIdsAfter,
      );
      const previousBagExhausted = previous?.globalTracking === true
        && previousOrder.length > 0
        && previousGlobalConsumedIdsAfter.length === previousOrder.length
        && previousOrder.every((id) => previousGlobalConsumedIdsAfter.includes(id));
      const validGlobalRefill = previousBagExhausted
        && witness?.globalTracking === true
        && sameStrings(previousOrder, witness?.order)
        && uniqueStringsInOrder(witness?.globalConsumedIdsBefore).length === 0;
      if (!validGlobalRefill) {
        errors.push({
          code: 'selection-bag-witness-sequence-global-refill-invalid',
          index,
          previousOrder,
          previousGlobalConsumedIdsAfter,
          actualBefore: witness?.globalConsumedIdsBefore ?? null,
        });
      }
    } else if (previous?.globalTracking === true && witness?.globalTracking === true
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

function emptySelectionBagWitnessFamilies() {
  return Object.fromEntries(DUNGEON_SELECTION_BAG_FAMILIES.map((family) => [family, []]));
}

function operationSelectionManifestRecord(operation, inputIndex) {
  return {
    operation,
    inputIndex,
    operationId: String(operation?.id ?? ''),
    hasManifest: Object.hasOwn(operation ?? {}, 'selectionManifest'),
    manifest: operation?.selectionManifest,
  };
}

/**
 * Reconstructs the committed selection-bag sequence without changing the
 * canonical serialization order of route-network operations.
 *
 * `solveDecisionOrdinal` is the order in which the winning solver branch
 * committed each operation. It is intentionally independent of the public
 * operation/progression order.
 */
export function inspectDungeonRouteNetworkSelectionSequence(routeOperations = [], {
  allowAllManifestsAbsent = false,
  requireNonEmptyFamilies = false,
} = {}) {
  const witnessesByFamily = emptySelectionBagWitnessFamilies();
  const errors = [];
  const result = (solveOrderedRecords = []) => ({
    accepted: errors.length === 0,
    errors,
    solveOrderedOperationIds: solveOrderedRecords.map(({ operationId }) => operationId),
    witnessesByFamily,
  });

  if (!Array.isArray(routeOperations)) {
    errors.push({
      code: 'route-network-selection-sequence-operations-invalid',
      actualType: routeOperations === null ? 'null' : typeof routeOperations,
    });
    return result();
  }

  const records = routeOperations.map(operationSelectionManifestRecord);
  if (records.length === 0) {
    if (requireNonEmptyFamilies) {
      for (const family of DUNGEON_SELECTION_BAG_FAMILIES) {
        const validation = validateDungeonSelectionBagWitnessSequence([], {
          family,
          requireNonEmpty: true,
        });
        errors.push(...validation.errors.map((witnessError) => ({
          code: 'route-network-selection-manifest-bag-witness-global-sequence-invalid',
          family,
          operationId: null,
          solveDecisionOrdinal: null,
          witnessIndex: witnessError.index ?? null,
          witnessError,
        })));
      }
    }
    return result();
  }

  const recordsWithManifest = records.filter(({ hasManifest }) => hasManifest);
  if (recordsWithManifest.length === 0) {
    if (!allowAllManifestsAbsent) {
      errors.push({
        code: 'route-network-selection-manifest-missing',
        operationIds: records.map(({ operationId }) => operationId),
      });
    }
    return result();
  }
  if (recordsWithManifest.length !== records.length) {
    errors.push({
      code: 'route-network-selection-manifest-presence-mixed',
      operationIdsWithManifest: recordsWithManifest.map(({ operationId }) => operationId),
      operationIdsWithoutManifest: records
        .filter(({ hasManifest }) => !hasManifest)
        .map(({ operationId }) => operationId),
    });
    return result();
  }

  let decisionOrderValid = true;
  const recordsByOrdinal = new Map();
  for (const record of records) {
    const { manifest, operationId } = record;
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      errors.push({
        code: 'route-network-selection-manifest-malformed',
        operationId,
      });
      decisionOrderValid = false;
      continue;
    }
    const solveDecisionOrdinal = manifest.solveDecisionOrdinal;
    if (!Number.isSafeInteger(solveDecisionOrdinal) || solveDecisionOrdinal < 0) {
      errors.push({
        code: 'route-network-selection-manifest-solve-decision-ordinal-invalid',
        operationId,
        solveDecisionOrdinal: solveDecisionOrdinal ?? null,
      });
      decisionOrderValid = false;
      continue;
    }
    record.solveDecisionOrdinal = solveDecisionOrdinal;
    if (!recordsByOrdinal.has(solveDecisionOrdinal)) {
      recordsByOrdinal.set(solveDecisionOrdinal, []);
    }
    recordsByOrdinal.get(solveDecisionOrdinal).push(record);
  }

  for (const [solveDecisionOrdinal, duplicateRecords] of recordsByOrdinal) {
    if (duplicateRecords.length <= 1) continue;
    errors.push({
      code: 'route-network-selection-manifest-solve-decision-ordinal-duplicate',
      solveDecisionOrdinal,
      operationIds: duplicateRecords.map(({ operationId }) => operationId),
    });
    decisionOrderValid = false;
  }

  const expectedOrdinals = records.map((_, index) => index);
  const actualOrdinals = [...recordsByOrdinal.keys()].sort((first, second) => first - second);
  if (actualOrdinals.length !== expectedOrdinals.length
    || actualOrdinals.some((ordinal, index) => ordinal !== expectedOrdinals[index])) {
    errors.push({
      code: 'route-network-selection-manifest-solve-decision-order-invalid',
      expectedOrdinals,
      actualOrdinals,
    });
    decisionOrderValid = false;
  }
  if (!decisionOrderValid) return result();

  const solveOrderedRecords = [...records].sort((first, second) => (
    first.solveDecisionOrdinal - second.solveDecisionOrdinal
      || first.inputIndex - second.inputIndex
  ));
  const witnessOriginsByFamily = emptySelectionBagWitnessFamilies();
  for (const record of solveOrderedRecords) {
    const { manifest, operationId, solveDecisionOrdinal } = record;
    const bagWitnesses = manifest.bagWitnesses;
    if (!bagWitnesses || typeof bagWitnesses !== 'object') {
      errors.push({
        code: 'route-network-selection-manifest-bag-witnesses-malformed',
        operationId,
        solveDecisionOrdinal,
      });
      continue;
    }

    if (Array.isArray(bagWitnesses)) {
      const unknownFamilies = [...new Set(bagWitnesses
        .map((witness) => String(witness?.family ?? ''))
        .filter((family) => !FAMILY_SET.has(family)))];
      if (unknownFamilies.length > 0) {
        errors.push({
          code: 'route-network-selection-manifest-bag-witness-family-invalid',
          operationId,
          solveDecisionOrdinal,
          unknownFamilies,
        });
      }
      for (const family of DUNGEON_SELECTION_BAG_FAMILIES) {
        const familyWitnesses = bagWitnesses.filter((witness) => (
          String(witness?.family ?? '') === family
        ));
        witnessesByFamily[family].push(...familyWitnesses);
        witnessOriginsByFamily[family].push(...familyWitnesses.map((_, operationWitnessIndex) => ({
          operationId,
          solveDecisionOrdinal,
          operationWitnessIndex,
        })));
      }
      continue;
    }

    const unknownFamilies = Object.keys(bagWitnesses).filter((family) => (
      !FAMILY_SET.has(family)
    ));
    if (unknownFamilies.length > 0) {
      errors.push({
        code: 'route-network-selection-manifest-bag-witness-family-invalid',
        operationId,
        solveDecisionOrdinal,
        unknownFamilies: unknownFamilies.sort(),
      });
    }
    for (const family of DUNGEON_SELECTION_BAG_FAMILIES) {
      const familyWitnesses = bagWitnesses[family];
      if (familyWitnesses !== undefined && !Array.isArray(familyWitnesses)) {
        errors.push({
          code: 'route-network-selection-manifest-bag-witness-family-sequence-invalid',
          operationId,
          solveDecisionOrdinal,
          family,
        });
        continue;
      }
      const orderedWitnesses = familyWitnesses ?? [];
      witnessesByFamily[family].push(...orderedWitnesses);
      witnessOriginsByFamily[family].push(...orderedWitnesses.map(
        (_, operationWitnessIndex) => ({
          operationId,
          solveDecisionOrdinal,
          operationWitnessIndex,
        }),
      ));
    }
  }

  for (const family of DUNGEON_SELECTION_BAG_FAMILIES) {
    const validation = validateDungeonSelectionBagWitnessSequence(
      witnessesByFamily[family],
      { family, requireNonEmpty: requireNonEmptyFamilies },
    );
    errors.push(...validation.errors.map((witnessError) => {
      const origin = witnessOriginsByFamily[family][witnessError.index] ?? null;
      return {
        code: 'route-network-selection-manifest-bag-witness-global-sequence-invalid',
        family,
        operationId: origin?.operationId ?? null,
        solveDecisionOrdinal: origin?.solveDecisionOrdinal ?? null,
        operationWitnessIndex: origin?.operationWitnessIndex ?? null,
        witnessIndex: witnessError.index ?? null,
        witnessError,
      };
    }));
  }
  return result(solveOrderedRecords);
}
