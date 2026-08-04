export const DUNGEON_AUGMENTATION_BROWSER_PLANNER_REQUEST_SCHEMA =
  'dungeon-augmentation-browser-planner-request/v2';
export const DUNGEON_AUGMENTATION_BROWSER_PLANNER_RESPONSE_SCHEMA =
  'dungeon-augmentation-browser-planner-response/v2';

const DYNAMIC_PLANNER_INPUT_KEYS = Object.freeze([
  'augmentationSeed',
  'prePrunedRouteNetworkGrants',
  'routeNetworkConflictExclusions',
]);
const DYNAMIC_PLANNER_INPUT_KEY_SET = new Set(DYNAMIC_PLANNER_INPUT_KEYS);

let browserPlannerRequestSequence = 0;

function browserPlannerError(message, cause = null) {
  const error = new Error(message);
  error.name = 'DungeonAugmentationBrowserPlannerError';
  if (cause) error.cause = cause;
  return error;
}

function browserPlannerAbortError(signal = null) {
  const error = browserPlannerError(
    'Dungeon augmentation planning was cancelled.',
    signal?.reason instanceof Error ? signal.reason : null,
  );
  error.name = 'AbortError';
  return error;
}

function splitPlannerInput(plannerInput) {
  const source = plannerInput && typeof plannerInput === 'object'
    ? plannerInput
    : {};
  const invariantInput = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'routeNetworkPlanResultCache'
      || DYNAMIC_PLANNER_INPUT_KEY_SET.has(key)) continue;
    invariantInput[key] = value;
  }
  const dynamicPatch = {};
  for (const key of DYNAMIC_PLANNER_INPUT_KEYS) {
    // Include undefined explicitly so each pass has the same default-parameter
    // behavior as a fresh augmentDungeonDraft call rather than inheriting a
    // value from the preceding repair or realization attempt.
    dynamicPatch[key] = source[key];
  }
  return { invariantInput, dynamicPatch };
}

function plannerInvariantIdentity(invariantInput) {
  const baseDraft = invariantInput?.baseDraft;
  const extensionRegions = Array.isArray(invariantInput?.extensionRegions)
    ? invariantInput.extensionRegions
    : [];
  return JSON.stringify({
    basePlanHash: String(baseDraft?.basePlanHash ?? baseDraft?.planHash ?? ''),
    profileId: invariantInput?.profileId ?? null,
    layoutSeed: invariantInput?.layoutSeed ?? '',
    difficulty: Number(invariantInput?.difficulty ?? 1),
    extensionRegionIds: extensionRegions.map((region) => String(region?.id ?? '')),
  });
}

/**
 * Owns one request-scoped worker for a complete dungeon generation. The first
 * planner pass clones the renderer-free invariant input into that worker. All
 * bounded repair and realization passes send only their seed/pruning/conflict
 * patch, so the accepted parent draft crosses the worker boundary exactly once.
 */
export function createDungeonAugmentationBrowserPlannerSession({
  WorkerImplementation = globalThis.Worker,
  workerUrl = new URL('./BrowserPlannerWorker.js', import.meta.url),
  timeoutMs = 45_000,
  signal = null,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  setTimeoutImplementation = globalThis.setTimeout,
  clearTimeoutImplementation = globalThis.clearTimeout,
} = {}) {
  if (typeof WorkerImplementation !== 'function') {
    throw browserPlannerError(
      'This browser cannot start the dungeon augmentation planning worker.',
    );
  }

  let disposed = Boolean(signal?.aborted);
  let terminalError = disposed ? browserPlannerAbortError(signal) : null;
  let initialized = false;
  let invariantIdentity = null;
  let activeRequest = null;
  let abortListener = null;
  let worker = null;
  const normalizedTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
  const transactionStartedAt = Number(now());
  const transactionDeadline = transactionStartedAt + normalizedTimeoutMs;

  const detachAbortListener = () => {
    if (!abortListener) return;
    signal?.removeEventListener?.('abort', abortListener);
    abortListener = null;
  };
  const releaseWorker = () => {
    if (!worker) return;
    worker.removeEventListener?.('message', handleMessage);
    worker.removeEventListener?.('error', handleError);
    worker.removeEventListener?.('messageerror', handleMessageError);
    worker.terminate?.();
    worker = null;
  };
  const settleActiveRequest = (callback, value) => {
    if (!activeRequest) return;
    const request = activeRequest;
    activeRequest = null;
    if (request.timeoutHandle != null) clearTimeoutImplementation(request.timeoutHandle);
    callback.call(null, value);
  };
  const terminateSession = (error = null) => {
    if (disposed && !worker && !activeRequest) return;
    disposed = true;
    terminalError ??= error;
    detachAbortListener();
    const pendingRequest = activeRequest;
    if (pendingRequest?.timeoutHandle != null) {
      clearTimeoutImplementation(pendingRequest.timeoutHandle);
    }
    activeRequest = null;
    releaseWorker();
    if (pendingRequest && error) pendingRequest.reject(error);
  };
  const handleMessage = (event) => {
    const payload = event?.data;
    if (!activeRequest
      || payload?.schema !== DUNGEON_AUGMENTATION_BROWSER_PLANNER_RESPONSE_SCHEMA
      || payload?.requestId !== activeRequest.requestId) return;
    if (payload.ok !== true) {
      const workerFailure = browserPlannerError(
        payload?.error?.message
          ?? 'Dungeon augmentation planning failed in its worker.',
      );
      workerFailure.workerErrorName = payload?.error?.name ?? null;
      workerFailure.workerErrorStack = payload?.error?.stack ?? null;
      terminateSession(workerFailure);
      return;
    }
    const request = activeRequest;
    const totalRoundTripTimeMs = Math.max(
      0,
      Number(now()) - Number(request.startedAt),
    );
    const workerExecutionTimeMs = Math.max(
      0,
      Number(payload?.diagnostics?.workerExecutionTimeMs) || 0,
    );
    const inputCloneDispatchTimeMs = Math.max(
      0,
      Number(request.inputCloneDispatchTimeMs) || 0,
    );
    settleActiveRequest(request.resolve, {
      result: payload.result,
      elapsedMs: totalRoundTripTimeMs,
      workerDiagnostics: {
        totalRoundTripTimeMs,
        inputCloneDispatchTimeMs,
        workerExecutionTimeMs,
        outputCloneAndDeliveryTimeMs: Math.max(
          0,
          totalRoundTripTimeMs - inputCloneDispatchTimeMs - workerExecutionTimeMs,
        ),
      },
    });
  };
  const handleError = (event) => terminateSession(browserPlannerError(
    event?.message ?? 'The dungeon augmentation planning worker crashed.',
    event?.error ?? null,
  ));
  const handleMessageError = () => terminateSession(browserPlannerError(
    'The dungeon augmentation planning worker returned unreadable data.',
  ));
  const dispose = (reason = null) => {
    if (disposed && !worker && !activeRequest) return;
    const cancellation = activeRequest
      ? (reason instanceof Error
          ? reason
          : browserPlannerError('Dungeon augmentation planning was cancelled.'))
      : null;
    terminateSession(cancellation);
  };

  if (!disposed) {
    try {
      worker = new WorkerImplementation(workerUrl, {
        type: 'module',
        name: 'dungeon-augmentation-planner',
      });
      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);
      worker.addEventListener('messageerror', handleMessageError);
    } catch (error) {
      disposed = true;
      releaseWorker();
      throw browserPlannerError(
        'The dungeon augmentation planning worker could not be started.',
        error,
      );
    }
  }

  if (!disposed && signal?.addEventListener) {
    abortListener = () => {
      terminateSession(browserPlannerAbortError(signal));
    };
    signal.addEventListener('abort', abortListener, { once: true });
  }

  const plan = (plannerInput, { realizationAttempt = 0 } = {}) => {
    if (disposed || !worker) {
      return Promise.reject(
        terminalError?.name === 'AbortError'
          ? terminalError
          : browserPlannerError(
            'The dungeon augmentation planning worker is no longer available.',
          ),
      );
    }
    if (activeRequest) {
      return Promise.reject(browserPlannerError(
        'The dungeon augmentation planning worker already has an active request.',
      ));
    }

    const requestStartedAt = Number(now());
    const remainingTransactionMs = Math.max(0, transactionDeadline - requestStartedAt);
    if (remainingTransactionMs <= 0) {
      const failure = browserPlannerError(
        `Dungeon augmentation planning exceeded ${normalizedTimeoutMs} ms.`,
      );
      terminateSession();
      return Promise.reject(failure);
    }

    const { invariantInput, dynamicPatch } = splitPlannerInput(plannerInput);
    const nextInvariantIdentity = plannerInvariantIdentity(invariantInput);
    if (initialized && nextInvariantIdentity !== invariantIdentity) {
      const failure = browserPlannerError(
        'The dungeon augmentation planning worker received a different dungeon invariant.',
      );
      terminateSession();
      return Promise.reject(failure);
    }

    const requestId = `dungeon-augmentation-planner:${browserPlannerRequestSequence}`;
    browserPlannerRequestSequence += 1;
    const normalizedRealizationAttempt = Math.max(
      0,
      Math.trunc(Number(realizationAttempt) || 0),
    );
    const isInitializationRequest = !initialized;
    if (isInitializationRequest) {
      initialized = true;
      invariantIdentity = nextInvariantIdentity;
    }

    return new Promise((resolve, reject) => {
      const request = {
        requestId,
        resolve,
        reject,
        startedAt: requestStartedAt,
        inputCloneDispatchTimeMs: 0,
        timeoutHandle: null,
      };
      activeRequest = request;
      request.timeoutHandle = setTimeoutImplementation(() => {
        if (activeRequest !== request) return;
        terminateSession(browserPlannerError(
          `Dungeon augmentation planning exceeded ${normalizedTimeoutMs} ms.`,
        ));
      }, remainingTransactionMs);
      const message = {
        schema: DUNGEON_AUGMENTATION_BROWSER_PLANNER_REQUEST_SCHEMA,
        requestId,
        realizationAttempt: normalizedRealizationAttempt,
        plannerInputPatch: dynamicPatch,
      };
      if (isInitializationRequest) message.plannerInvariantInput = invariantInput;
      try {
        const cloneDispatchStartedAt = Number(now());
        worker.postMessage(message);
        request.inputCloneDispatchTimeMs = Math.max(
          0,
          Number(now()) - cloneDispatchStartedAt,
        );
      } catch (error) {
        terminateSession(browserPlannerError(
          'The dungeon augmentation planning request could not be serialized.',
          error,
        ));
      }
    });
  };

  return Object.freeze({ plan, dispose });
}

/** Runs one standalone planner request and releases its worker afterward. */
export async function planDungeonAugmentationInBrowserWorker(plannerInput, options = {}) {
  const session = createDungeonAugmentationBrowserPlannerSession(options);
  try {
    return await session.plan(plannerInput);
  } finally {
    session.dispose();
  }
}
