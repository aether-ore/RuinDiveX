import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';
import {
  createAcceptedParentWitness,
} from './dungeon-augmentation-release-evidence.mjs';
import {
  RELEASE_PARENT_SNAPSHOT_WORKER_KIND,
} from './dungeon-augmentation-parent-snapshot-pool.mjs';

export function createReleaseParentSnapshot(rawIndex) {
  if (!Number.isSafeInteger(rawIndex) || rawIndex < 0) {
    throw new Error(`Invalid release parent raw index ${rawIndex}.`);
  }
  const suffix = String(rawIndex).padStart(3, '0');
  const seed = `layout:augmentation-realized-v4-${suffix}`;
  const basePlanHash = `v1:${seed}:depth:1:revolvingFusillade`;
  const seededRandom = new SeededRandom(hashSeed(seed));
  let sourceRandomCalls = 0;
  const generator = new DungeonGenerator({
    random: () => {
      sourceRandomCalls += 1;
      return seededRandom.next();
    },
    difficulty: 1,
    augmentationProfileId: null,
    augmentationSeed: seed,
    basePlanHash,
  });
  const inertTexture = new THREE.Texture();
  inertTexture.name = `releaseCorpusParent_${suffix}`;
  generator.textureCache.set(inertTexture.name, inertTexture);
  generator._loadRuinTexture = () => inertTexture;
  let dungeon = null;
  try {
    try {
      dungeon = generator.generate();
    } catch (error) {
      return {
        status: 'skipped',
        rawIndex,
        seed,
        sourceRandomCalls,
        errorName: error?.name ?? 'Error',
        reason: error?.message ?? String(error),
      };
    }
    if (dungeon.basePlanHash !== basePlanHash || dungeon.effectivePlanHash !== basePlanHash) {
      throw new Error(`Disabled parent ${seed} did not preserve its exact base plan hash.`);
    }
    return {
      status: 'accepted',
      rawIndex,
      seed,
      basePlanHash,
      sourceRandomCalls,
      parentWitness: createAcceptedParentWitness(dungeon, sourceRandomCalls),
    };
  } finally {
    generator._disposeGeneratedDungeonCandidate(dungeon);
    inertTexture.dispose();
  }
}

function serializedError(error) {
  return {
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
  };
}

if (!isMainThread) {
  if (workerData?.kind !== RELEASE_PARENT_SNAPSHOT_WORKER_KIND || !parentPort) {
    throw new Error('Parent snapshot worker started without its exact release contract.');
  }
  parentPort.on('message', ({ requestId, rawIndex } = {}) => {
    try {
      parentPort.postMessage({
        requestId,
        ok: true,
        snapshot: createReleaseParentSnapshot(rawIndex),
      });
    } catch (error) {
      parentPort.postMessage({
        requestId,
        ok: false,
        error: serializedError(error),
      });
    }
  });
}
