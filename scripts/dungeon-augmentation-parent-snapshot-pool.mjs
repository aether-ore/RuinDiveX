import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

export const RELEASE_PARENT_SNAPSHOT_MAX_CONCURRENCY = 8;
export const RELEASE_PARENT_SNAPSHOT_WORKER_KIND =
  'dungeon-augmentation-disabled-parent-snapshot-v1';

export function resolveReleaseParentSnapshotConcurrency(
  requestedConcurrency = null,
  availableConcurrency = availableParallelism(),
) {
  const safeAvailableConcurrency = Number.isSafeInteger(availableConcurrency)
    && availableConcurrency > 0
    ? availableConcurrency
    : 1;
  const hardwareBound = Math.max(
    1,
    Math.min(RELEASE_PARENT_SNAPSHOT_MAX_CONCURRENCY, safeAvailableConcurrency - 1),
  );
  if (requestedConcurrency == null) return hardwareBound;
  if (!Number.isSafeInteger(requestedConcurrency)
    || requestedConcurrency <= 0
    || requestedConcurrency > RELEASE_PARENT_SNAPSHOT_MAX_CONCURRENCY) {
    throw new Error(
      `--parent-workers must be an integer from 1 through ${RELEASE_PARENT_SNAPSHOT_MAX_CONCURRENCY}.`,
    );
  }
  return Math.min(requestedConcurrency, hardwareBound);
}

function expectedParentIdentity(rawIndex) {
  const suffix = String(rawIndex).padStart(3, '0');
  const seed = `layout:augmentation-realized-v4-${suffix}`;
  return {
    seed,
    basePlanHash: `v1:${seed}:depth:1:revolvingFusillade`,
  };
}

function validateParentSnapshot(snapshot, rawIndex) {
  const expected = expectedParentIdentity(rawIndex);
  if (!snapshot
    || typeof snapshot !== 'object'
    || Array.isArray(snapshot)
    || snapshot.rawIndex !== rawIndex
    || snapshot.seed !== expected.seed
    || !['accepted', 'skipped'].includes(snapshot.status)
    || !Number.isSafeInteger(snapshot.sourceRandomCalls)
    || snapshot.sourceRandomCalls < 0) {
    throw new Error(`Parent snapshot worker returned malformed raw index ${rawIndex}.`);
  }
  if (snapshot.status === 'accepted') {
    if (snapshot.basePlanHash !== expected.basePlanHash
      || !snapshot.parentWitness
      || typeof snapshot.parentWitness !== 'object'
      || Array.isArray(snapshot.parentWitness)) {
      throw new Error(`Accepted parent snapshot ${snapshot.seed} lacks its exact witness identity.`);
    }
  } else if (typeof snapshot.errorName !== 'string'
    || !snapshot.errorName
    || typeof snapshot.reason !== 'string'
    || !snapshot.reason) {
    throw new Error(`Skipped parent snapshot ${snapshot.seed} lacks failure diagnostics.`);
  }
  return snapshot;
}

export async function collectOrderedAcceptedParentSnapshots({
  rawStartIndex,
  maximumRawAttempts,
  requestedAcceptedParentCount,
  concurrency,
  buildBatch,
  onCommittedSnapshot = () => {},
}) {
  if (!Number.isSafeInteger(rawStartIndex) || rawStartIndex < 0
    || !Number.isSafeInteger(maximumRawAttempts) || maximumRawAttempts <= 0
    || !Number.isSafeInteger(requestedAcceptedParentCount)
    || requestedAcceptedParentCount <= 0
    || maximumRawAttempts < requestedAcceptedParentCount
    || !Number.isSafeInteger(concurrency) || concurrency <= 0
    || concurrency > RELEASE_PARENT_SNAPSHOT_MAX_CONCURRENCY
    || typeof buildBatch !== 'function'
    || typeof onCommittedSnapshot !== 'function') {
    throw new Error('Ordered parent snapshot collection received an invalid bounded scan contract.');
  }

  const entries = [];
  const skippedParentSeeds = [];
  const rawLimitExclusive = rawStartIndex + maximumRawAttempts;
  let nextRawIndex = rawStartIndex;
  while (entries.length < requestedAcceptedParentCount) {
    if (nextRawIndex >= rawLimitExclusive) {
      throw new Error(
        `Accepted-parent scan exhausted ${maximumRawAttempts} raw seeds after finding ${entries.length}/${requestedAcceptedParentCount}.`,
      );
    }
    const batchEndExclusive = Math.min(
      rawLimitExclusive,
      nextRawIndex + concurrency,
    );
    const rawIndices = Array.from(
      { length: batchEndExclusive - nextRawIndex },
      (_, offset) => nextRawIndex + offset,
    );
    const snapshots = await buildBatch(rawIndices);
    if (!Array.isArray(snapshots) || snapshots.length !== rawIndices.length) {
      throw new Error(
        `Parent snapshot batch [${nextRawIndex}, ${batchEndExclusive}) returned incomplete evidence.`,
      );
    }

    for (let offset = 0; offset < rawIndices.length; offset += 1) {
      const rawIndex = rawIndices[offset];
      const snapshot = validateParentSnapshot(snapshots[offset], rawIndex);
      nextRawIndex = rawIndex + 1;
      if (snapshot.status === 'accepted') {
        const entry = {
          ordinal: entries.length,
          rawIndex,
          seed: snapshot.seed,
          basePlanHash: snapshot.basePlanHash,
          parentWitness: snapshot.parentWitness,
        };
        entries.push(entry);
        onCommittedSnapshot({
          status: snapshot.status,
          entry,
          acceptedParentCount: entries.length,
          skippedParentSeedCount: skippedParentSeeds.length,
        });
      } else {
        const skippedParentSeed = {
          rawIndex,
          seed: snapshot.seed,
          sourceRandomCalls: snapshot.sourceRandomCalls,
          errorName: snapshot.errorName,
          reason: snapshot.reason,
        };
        skippedParentSeeds.push(skippedParentSeed);
        onCommittedSnapshot({
          status: snapshot.status,
          skippedParentSeed,
          acceptedParentCount: entries.length,
          skippedParentSeedCount: skippedParentSeeds.length,
        });
      }
      if (entries.length === requestedAcceptedParentCount) break;
    }
  }

  return {
    entries,
    skippedParentSeeds,
    rawEndIndexExclusive: nextRawIndex,
  };
}

function serializedWorkerError(payload, laneIndex, rawIndex) {
  const error = new Error(
    payload?.message
      ?? `Parent snapshot worker lane ${laneIndex} failed raw index ${rawIndex}.`,
  );
  error.name = payload?.name ?? 'ParentSnapshotWorkerError';
  if (payload?.code != null) error.code = payload.code;
  if (payload?.stack) error.stack = payload.stack;
  return error;
}

function createWorkerLane(worker, laneIndex) {
  let sequence = 0;
  let pending = null;
  let terminalError = null;
  let closing = false;

  const fail = (error) => {
    terminalError = error instanceof Error ? error : new Error(String(error));
    if (pending) {
      const { reject } = pending;
      pending = null;
      reject(terminalError);
    }
  };
  worker.on('message', (message) => {
    if (!pending || message?.requestId !== pending.requestId) {
      fail(new Error(`Parent snapshot worker lane ${laneIndex} returned an unexpected response.`));
      return;
    }
    const { resolve, reject, rawIndex } = pending;
    pending = null;
    if (message.ok !== true) {
      reject(serializedWorkerError(message.error, laneIndex, rawIndex));
      return;
    }
    resolve(message.snapshot);
  });
  worker.on('error', fail);
  worker.on('exit', (code) => {
    if (!closing && (code !== 0 || pending)) {
      fail(new Error(
        `Parent snapshot worker lane ${laneIndex} exited unexpectedly with code ${code}.`,
      ));
    }
  });

  return Object.freeze({
    run(rawIndex) {
      if (closing) return Promise.reject(new Error(`Parent snapshot worker lane ${laneIndex} is closed.`));
      if (terminalError) return Promise.reject(terminalError);
      if (pending) {
        return Promise.reject(new Error(`Parent snapshot worker lane ${laneIndex} is already busy.`));
      }
      const requestId = `${laneIndex}:${sequence}`;
      sequence += 1;
      return new Promise((resolve, reject) => {
        pending = { requestId, rawIndex, resolve, reject };
        try {
          worker.postMessage({ requestId, rawIndex });
        } catch (error) {
          pending = null;
          reject(error);
        }
      });
    },
    async close() {
      if (closing) return;
      closing = true;
      if (pending) {
        const { reject } = pending;
        pending = null;
        reject(new Error(`Parent snapshot worker lane ${laneIndex} was terminated.`));
      }
      await worker.terminate();
    },
  });
}

export function createReleaseParentSnapshotWorkerPool({
  concurrency,
  WorkerImplementation = Worker,
  workerUrl = new URL('./dungeon-augmentation-parent-snapshot-worker.mjs', import.meta.url),
} = {}) {
  if (!Number.isSafeInteger(concurrency)
    || concurrency <= 0
    || concurrency > RELEASE_PARENT_SNAPSHOT_MAX_CONCURRENCY) {
    throw new Error('Parent snapshot worker pool requires bounded positive concurrency.');
  }
  const workers = [];
  try {
    for (let laneIndex = 0; laneIndex < concurrency; laneIndex += 1) {
      workers.push(new WorkerImplementation(workerUrl, {
        workerData: { kind: RELEASE_PARENT_SNAPSHOT_WORKER_KIND, laneIndex },
      }));
    }
  } catch (error) {
    for (const worker of workers) void worker.terminate();
    throw error;
  }
  const lanes = workers.map((worker, laneIndex) => createWorkerLane(worker, laneIndex));
  let closed = false;
  return Object.freeze({
    concurrency,
    runBatch(rawIndices) {
      if (closed) return Promise.reject(new Error('Parent snapshot worker pool is closed.'));
      if (!Array.isArray(rawIndices)
        || rawIndices.length === 0
        || rawIndices.length > concurrency
        || rawIndices.some((rawIndex) => !Number.isSafeInteger(rawIndex) || rawIndex < 0)) {
        return Promise.reject(new Error('Parent snapshot worker batch exceeds its bounded lanes.'));
      }
      return Promise.all(rawIndices.map((rawIndex, offset) => lanes[offset].run(rawIndex)));
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled(lanes.map((lane) => lane.close()));
    },
  });
}
