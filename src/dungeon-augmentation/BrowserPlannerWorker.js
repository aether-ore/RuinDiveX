import { augmentDungeonDraft } from './planner.js';
import {
  DUNGEON_AUGMENTATION_BROWSER_PLANNER_REQUEST_SCHEMA,
  DUNGEON_AUGMENTATION_BROWSER_PLANNER_RESPONSE_SCHEMA,
} from './BrowserPlannerWorkerClient.js';

function serializeWorkerError(error) {
  return {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
  };
}

function normalizeRealizationAttempt(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function normalizeSalvageWitnessCacheEntries(entries) {
  return (Array.isArray(entries) ? entries : []).flatMap((entry) => (
    Array.isArray(entry)
      && typeof entry[0] === 'string'
      && Array.isArray(entry[1])
      ? [[entry[0], entry[1]]]
      : []
  ));
}

function cloneCompactEntries(entries) {
  const normalized = normalizeSalvageWitnessCacheEntries(entries);
  // A structured clone preserves the old fresh-worker boundary between repair
  // passes and ensures a returned plan cannot keep the retained witness state
  // alive through shared references. Workers that can run this module always
  // provide structuredClone; the fallback is only for focused test doubles.
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(normalized);
  }
  return normalized.map(([key, value]) => [key, value]);
}

/**
 * Stateful request coordinator used by the browser worker and focused tests.
 * It retains the immutable planner invariant plus compact array-valued salvage
 * witnesses. Completed-plan cache values and each pass's result graph remain
 * local to plan() and become collectible immediately after the response clone.
 */
export function createDungeonAugmentationBrowserPlannerWorkerState({
  planner = augmentDungeonDraft,
} = {}) {
  let plannerInvariantInput = null;
  const salvageWitnessCacheEntriesByRealizationAttempt = new Map();

  const plan = (payload) => {
    if (plannerInvariantInput == null) {
      const initialInvariant = payload?.plannerInvariantInput;
      if (!initialInvariant
        || typeof initialInvariant !== 'object'
        || Array.isArray(initialInvariant)) {
        throw new Error(
          'The dungeon augmentation planning worker requires an initial invariant input.',
        );
      }
      plannerInvariantInput = initialInvariant;
    } else if (Object.hasOwn(payload ?? {}, 'plannerInvariantInput')) {
      throw new Error(
        'The dungeon augmentation planning worker invariant may only be initialized once.',
      );
    }

    const plannerInputPatch = payload?.plannerInputPatch;
    if (!plannerInputPatch
      || typeof plannerInputPatch !== 'object'
      || Array.isArray(plannerInputPatch)) {
      throw new Error('The dungeon augmentation planning worker requires a dynamic patch.');
    }

    const realizationAttempt = normalizeRealizationAttempt(payload?.realizationAttempt);
    const routeNetworkPlanResultCache = new Map(cloneCompactEntries(
      salvageWitnessCacheEntriesByRealizationAttempt.get(realizationAttempt) ?? [],
    ));
    const result = planner({
      ...plannerInvariantInput,
      ...plannerInputPatch,
      routeNetworkPlanResultCache,
    });

    // Preserve only exact-salvage witness arrays. Completed plans can contain
    // full candidate graphs and must never survive into the next repair pass.
    salvageWitnessCacheEntriesByRealizationAttempt.set(
      realizationAttempt,
      cloneCompactEntries([...routeNetworkPlanResultCache]),
    );
    return result;
  };

  return Object.freeze({ plan });
}

const workerState = createDungeonAugmentationBrowserPlannerWorkerState();

if (typeof globalThis.addEventListener === 'function'
  && typeof globalThis.postMessage === 'function') {
  globalThis.addEventListener('message', (event) => {
    const payload = event?.data;
    if (payload?.schema !== DUNGEON_AUGMENTATION_BROWSER_PLANNER_REQUEST_SCHEMA
      || typeof payload?.requestId !== 'string') return;
    try {
      const workerStartedAt = globalThis.performance?.now?.() ?? Date.now();
      const result = workerState.plan(payload);
      const workerExecutionTimeMs = Math.max(
        0,
        (globalThis.performance?.now?.() ?? Date.now()) - workerStartedAt,
      );
      globalThis.postMessage({
        schema: DUNGEON_AUGMENTATION_BROWSER_PLANNER_RESPONSE_SCHEMA,
        requestId: payload.requestId,
        ok: true,
        result,
        diagnostics: { workerExecutionTimeMs },
      });
    } catch (error) {
      globalThis.postMessage({
        schema: DUNGEON_AUGMENTATION_BROWSER_PLANNER_RESPONSE_SCHEMA,
        requestId: payload.requestId,
        ok: false,
        error: serializeWorkerError(error),
      });
      // A failed request invalidates the transaction state. The client also
      // terminates this worker when it receives the error response.
      globalThis.close?.();
    }
  });
}
