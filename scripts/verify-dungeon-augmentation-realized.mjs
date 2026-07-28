import assert from 'node:assert/strict';
import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';

const PROFILE_ID = 'industrial-supplement-preview-v2';
const countArgument = process.argv.find((argument) => argument.startsWith('--count='));
const startArgument = process.argv.find((argument) => argument.startsWith('--start='));
const requestedCount = Number.parseInt(countArgument?.slice('--count='.length) ?? '10', 10);
const requestedStart = Number.parseInt(startArgument?.slice('--start='.length) ?? '0', 10);
const progressEnabled = process.argv.includes('--progress');
const summaryOnly = process.argv.includes('--summary');
const seedCount = Number.isFinite(requestedCount) && requestedCount > 0
  ? requestedCount
  : 10;
const startIndex = Number.isFinite(requestedStart) && requestedStart >= 0
  ? requestedStart
  : 0;

const records = [];
const skippedParentSeeds = [];
let index = startIndex;
while (records.length < seedCount) {
  const suffix = String(index).padStart(3, '0');
  const seed = `layout:augmentation-realized-v2-${suffix}`;
  const basePlanHash = `v1:${seed}:depth:1:revolvingFusillade`;
  const seededRandom = new SeededRandom(hashSeed(seed));
  let sourceRandomCalls = 0;
  const generator = new DungeonGenerator({
    random: () => {
      sourceRandomCalls += 1;
      return seededRandom.next();
    },
    difficulty: 1,
    augmentationProfileId: PROFILE_ID,
    augmentationSeed: seed,
    basePlanHash,
  });
  const inertTexture = new THREE.Texture();
  inertTexture.name = `realizedAugmentationAudit_${suffix}`;
  generator.textureCache.set(inertTexture.name, inertTexture);
  generator._loadRuinTexture = () => inertTexture;
  const startedAt = performance.now();
  let dungeon = null;
  try {
    try {
      dungeon = generator.generate();
    } catch (candidateParentError) {
      // The sidecar cannot repair or redefine a parent layout that Industrial
      // V1 itself cannot accept. Prove the exact augmentation-disabled run
      // fails with the same error and RNG consumption before classifying the
      // raw seed as a parent failure, then continue until the requested number
      // of accepted parent layouts has received the complete realized audit.
      const disabledRandom = new SeededRandom(hashSeed(seed));
      let disabledSourceRandomCalls = 0;
      const disabledGenerator = new DungeonGenerator({
        random: () => {
          disabledSourceRandomCalls += 1;
          return disabledRandom.next();
        },
        difficulty: 1,
        augmentationProfileId: null,
        augmentationSeed: seed,
        basePlanHash,
      });
      const disabledTexture = new THREE.Texture();
      disabledTexture.name = `realizedParentFailureAudit_${suffix}`;
      disabledGenerator.textureCache.set(disabledTexture.name, disabledTexture);
      disabledGenerator._loadRuinTexture = () => disabledTexture;
      let disabledDungeon = null;
      let disabledError = null;
      try {
        disabledDungeon = disabledGenerator.generate();
      } catch (error) {
        disabledError = error;
      } finally {
        disabledGenerator._disposeGeneratedDungeonCandidate(disabledDungeon);
        disabledTexture.dispose();
      }
      assert.ok(
        disabledError,
        `Augmented seed ${seed} threw even though its disabled parent generation succeeded.`,
      );
      assert.equal(disabledError.message, candidateParentError.message);
      assert.equal(disabledSourceRandomCalls, sourceRandomCalls);
      skippedParentSeeds.push({
        seed,
        sourceRandomCalls,
        reason: candidateParentError.message,
      });
      if (progressEnabled) {
        console.error(`[parent-skip ${skippedParentSeeds.length}] ${seed}: ${candidateParentError.message}`);
      }
      index += 1;
      continue;
    }
    assert.equal(
      dungeon.progression?.validation?.accepted,
      true,
      dungeon.progression?.validation?.errors?.join('\n'),
    );
    assert.ok(['applied', 'unchanged'].includes(dungeon.augmentationStatus));
    const supplementalRooms = dungeon.rooms.filter((room) => room.isDungeonSupplement);
    if (dungeon.augmentationStatus === 'applied') {
      const overlay = dungeon.augmentationOverlayPlan;
      const operationTypeById = new Map((overlay?.operations ?? []).map((operation) => [
        operation.id,
        operation.type ?? operation.operationType ?? operation.kind,
      ]));
      const branchRoomCount = supplementalRooms.filter((room) => (
        operationTypeById.get(room.augmentationOperationId) === 'optionalBranch'
      )).length;
      const paddingRoomCount = supplementalRooms.filter((room) => (
        operationTypeById.get(room.augmentationOperationId) === 'edgePadding'
      )).length;
      const physicalSupplementConnections = dungeon.connectionPlans.filter((plan) => (
        plan.isDungeonSupplement && !plan.isSupplementGraphConnection
      ));
      const longestExteriorCorridorRunTiles = Math.max(0, ...physicalSupplementConnections
        .map((plan) => {
          let longest = 0;
          let current = 0;
          for (const point of plan.bridgePath ?? plan.fullPath ?? []) {
            const hasExteriorFloor = dungeon.floorTiles.some((tile) => (
              tile.x === point.x
              && tile.z === point.z
              && !tile.roomId
              && (tile.connectionId === plan.id || tile.connectorId === plan.id)
            ));
            current = hasExteriorFloor ? current + 1 : 0;
            longest = Math.max(longest, current);
          }
          return longest;
        }));
      assert.ok(supplementalRooms.length >= 3 && supplementalRooms.length <= 4);
      assert.equal(branchRoomCount, 2);
      assert.ok(paddingRoomCount >= 1 && paddingRoomCount <= 2);
      assert.equal(branchRoomCount + paddingRoomCount, supplementalRooms.length);
      assert.ok(
        longestExteriorCorridorRunTiles >= 2,
        `V2 has no measurable exterior gallery run (${longestExteriorCorridorRunTiles} tiles).`,
      );
      const connectorEntrances = dungeon.progression.validation.connectorEntrances;
      assert.ok(connectorEntrances.checkedSocketCount > 0);
      assert.equal(
        connectorEntrances.acceptedSocketCount,
        connectorEntrances.checkedSocketCount,
      );
      assert.ok(connectorEntrances.checks.every((check) => (
        check.socketReachable
          && check.outsideReachable
          && check.traversableOutward
          && check.traversableReturn
          && check.blockingWallFacadeId === null
      )));
      assert.equal(
        dungeon.progression.validation.platformability?.segmentBarriersValidated,
        true,
      );
      assert.notEqual(dungeon.effectivePlanHash, dungeon.basePlanHash);
    } else {
      assert.equal(supplementalRooms.length, 0);
      assert.equal(dungeon.effectivePlanHash, dungeon.basePlanHash);
      assert.equal(dungeon.augmentationReplayDiagnostics?.fallbackToAcceptedBase, true);
    }
    records.push({
      seed,
      status: dungeon.augmentationStatus,
      supplementalRooms: supplementalRooms.length,
      branchRooms: dungeon.augmentationStatus === 'applied'
        ? supplementalRooms.filter((room) => (
            dungeon.augmentationOverlayPlan?.operations?.find(
              (operation) => operation.id === room.augmentationOperationId,
            )?.type === 'optionalBranch'
          )).length
        : 0,
      generationAttempts: dungeon.generationAttempts,
      realizationAttempts: dungeon.augmentationReplayDiagnostics?.realizationAttempts ?? 0,
      sourceRandomCalls,
      elapsedMs: Math.round(performance.now() - startedAt),
      ...(dungeon.augmentationStatus === 'unchanged' ? {
        rejectionAttempts: (
          dungeon.augmentationDiagnostics?.rejectedOverlay?.attempts ?? []
        ).map((attempt) => ({
          realizationAttempt: attempt.realizationAttempt,
          errors: attempt.errors,
        })),
      } : {}),
    });
    if (progressEnabled) {
      console.error(
        `[${records.length}/${seedCount}] ${seed}: ${dungeon.augmentationStatus}`,
      );
    }
  } finally {
    generator._disposeGeneratedDungeonCandidate(dungeon);
    inertTexture.dispose();
  }
  index += 1;
}

const appliedCount = records.filter(({ status }) => status === 'applied').length;
const fallbackCount = records.length - appliedCount;
const minimumAppliedCount = Math.max(1, Math.ceil(seedCount * 0.95));
console.log(JSON.stringify({
  profileId: PROFILE_ID,
  startIndex,
  endIndexExclusive: index,
  seedCount,
  skippedParentSeedCount: skippedParentSeeds.length,
  skippedParentSeeds,
  appliedCount,
  fallbackCount,
  minimumAppliedCount,
  ...(summaryOnly ? {} : { records }),
}, null, 2));
assert.ok(
  appliedCount >= minimumAppliedCount,
  `Only ${appliedCount}/${seedCount} realized v2 seeds applied; expected at least ${minimumAppliedCount}.`,
);
