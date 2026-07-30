import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';
import {
  createIndustrialAugmentationHost,
  createIndustrialBaseDraft,
} from '../src/dungeon-augmentation/IndustrialDraftAdapter.js';

function isGraphOnlySupplementConnection(plan) {
  return Boolean(
    plan?.isSupplementGraphConnection
      || plan?.graphOnly === true
      || plan?.connectorVariantConstraints?.graphOnly === true
  );
}

function isPhysicalRouteNetworkConnection(plan) {
  return Boolean(
    (plan?.isDungeonSupplement || plan?.isPaddedByDungeonSupplement)
      && !isGraphOnlySupplementConnection(plan)
      && (
        plan.augmentationOperationType === 'routeNetwork'
          || plan.isRouteNetworkConnection
          || plan.routeNetworkGrantId
      )
  );
}

function normalizedTransferForm(transfer = {}) {
  const value = String(
    transfer.form
      ?? transfer.traversalKind
      ?? transfer.kind
      ?? transfer.type
      ?? '',
  ).trim().toLowerCase().replaceAll('_', '-');
  if (value.includes('ladder')) return 'ladder';
  if (value.includes('lift')) return 'lift';
  if (value.includes('stair') || value.includes('step')) return 'stairs';
  if (value.includes('ramp') || value.includes('slope') || value.includes('incline')) {
    return 'ramp';
  }
  if (value.includes('landing')) return 'landing';
  return value || 'transfer';
}

function countBy(values, keyFor) {
  return Object.fromEntries([...values.reduce((counts, value) => {
    const key = String(keyFor(value) ?? 'unknown');
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)));
}

// Facade-level alpha probe only: these checks prove that accepted generated
// geometry reached the records consumed by gameplay. The exhaustive geometry,
// reachability, variety, and corpus gates remain in the dedicated verifiers.
function createPlayableAlphaSmokeSummary(dungeon) {
  const rooms = Array.isArray(dungeon?.rooms) ? dungeon.rooms : [];
  const supplementalRooms = rooms.filter(({ isDungeonSupplement }) => (
    isDungeonSupplement === true
  ));
  const roomById = new Map(rooms.map((room) => [String(room.id), room]));
  const supplementalRoomIds = new Set(supplementalRooms.map(({ id }) => String(id)));
  const connectorProxies = Array.isArray(dungeon?.connectorJunctionProxies)
    ? dungeon.connectorJunctionProxies
    : [];
  const physicalOwners = [...supplementalRooms, ...connectorProxies];
  const routeNetworks = (dungeon?.augmentationOverlayPlan?.operations ?? [])
    .filter(({ type }) => type === 'routeNetwork');
  const physicalRoutes = (dungeon?.connectionPlans ?? [])
    .filter(isPhysicalRouteNetworkConnection);
  const verticalPhysicalRoutes = physicalRoutes.filter((route) => (
    Math.abs(
      Number(route.toSocket?.elevation ?? route.destinationElevation ?? 0)
        - Number(route.fromSocket?.elevation ?? route.sourceElevation ?? 0),
    ) > 0.01
      || (route.ladderContracts?.length ?? 0) > 0
      || (route.liftContracts?.length ?? 0) > 0
  ));
  const physicalRouteIds = new Set(physicalRoutes.map(({ id }) => String(id)));
  const progressionRoutes = dungeon?.progression?.supplementalRoomConnections ?? [];
  const encounters = (dungeon?.encounters ?? []).filter((encounter) => (
    encounter.isDungeonSupplement === true
      || supplementalRoomIds.has(String(encounter.roomId ?? ''))
  ));
  const rewards = (dungeon?.chests ?? []).filter((reward) => (
    reward.isDungeonSupplement === true
      || reward.dungeonSupplement === true
      || supplementalRoomIds.has(String(reward.roomId ?? ''))
  ));
  const mechanisms = (dungeon?.mechanisms ?? []).filter((mechanism) => (
    mechanism.isDungeonSupplement === true || mechanism.dungeonSupplement === true
  ));
  const localControls = mechanisms.filter((mechanism) => (
    mechanism.type === 'dungeonSupplementLocalControl'
      || mechanism.scopedAction === 'controlLocalHazards'
  ));
  const shortcutControls = mechanisms.filter((mechanism) => (
    mechanism.type === 'dungeonSupplementShortcut'
      || mechanism.scopedAction === 'unlockShortcut'
  ));
  const transferRecords = [...new Map(physicalOwners
    .flatMap((owner) => owner?.augmentationTransfers ?? [])
    .filter((transfer) => transfer?.id)
    .map((transfer) => [String(transfer.id), transfer])).values()];
  const elevationTransfers = transferRecords.filter((transfer) => {
    const range = transfer.worldElevationRange ?? transfer.localElevationRange ?? {};
    const from = Number(range.from ?? transfer.fromElevation);
    const to = Number(range.to ?? transfer.toElevation);
    return Number.isFinite(from) && Number.isFinite(to) && Math.abs(to - from) > 0.01;
  });
  const supplementalLadders = (dungeon?.ladders ?? []).filter((ladder) => (
    ladder.augmentationTransfer === true
      || physicalRouteIds.has(String(ladder.connectionId ?? ''))
  ));
  const supplementalLifts = (dungeon?.connectorLifts ?? []).filter((lift) => (
    lift.augmentationTransfer === true
      || physicalRouteIds.has(String(lift.connectionId ?? ''))
  ));
  const transferFloorTiles = (dungeon?.floorTiles ?? []).filter((floor) => (
    floor.augmentationTransferId
      || (floor.augmentationTransferIds ?? []).length > 0
  ));
  const realizedVerticalTransferIds = new Set([
    ...transferFloorTiles.flatMap((floor) => [
      floor.augmentationTransferId,
      ...(floor.augmentationTransferIds ?? []),
    ]),
    ...supplementalLadders.map(({ id }) => id),
    ...supplementalLifts.map(({ id }) => id),
  ].filter(Boolean).map(String));
  const runtimeStateIds = (record) => [
    record?.stateId,
    record?.runtimeStateId,
    ...(record?.runtimeStateIds ?? []),
  ].filter(Boolean);
  const recordOperationId = (record) => String(
    record?.operationId
      ?? record?.augmentationOperationId
      ?? roomById.get(String(record?.roomId ?? ''))?.augmentationOperationId
      ?? '',
  );
  const networkSummaries = routeNetworks.map((operation) => {
    const operationId = String(operation.id);
    const operationRooms = supplementalRooms.filter((room) => (
      recordOperationId(room) === operationId
    ));
    const operationTransfers = elevationTransfers.filter((transfer) => (
      recordOperationId(transfer) === operationId
    ));
    const operationVerticalRoutes = verticalPhysicalRoutes.filter((route) => (
      recordOperationId(route) === operationId
    ));
    return {
      id: operation.id,
      kind: operation.routeNetworkKind ?? null,
      roomCount: operationRooms.length,
      physicalRouteCount: physicalRoutes.filter((route) => (
        recordOperationId(route) === operationId
      )).length,
      encounterCount: encounters.filter((encounter) => (
        recordOperationId(encounter) === operationId
      )).length,
      rewardCount: rewards.filter((reward) => (
        recordOperationId(reward) === operationId
      )).length,
      mechanismCount: mechanisms.filter((mechanism) => (
        recordOperationId(mechanism) === operationId
      )).length,
      elevationTransferCount: operationTransfers.length + operationVerticalRoutes.length,
      elevationModes: [...(operation.elevationModes ?? [])],
    };
  });
  const assertions = {
    augmentationApplied: dungeon?.augmentationStatus === 'applied',
    augmentationIdentityPresent: Boolean(dungeon?.augmentationIdentity),
    effectiveHashChanged: Boolean(
      dungeon?.basePlanHash
        && dungeon?.effectivePlanHash
        && dungeon.effectivePlanHash !== dungeon.basePlanHash
    ),
    supplementRootPresent: Boolean(
      dungeon?.dungeonSupplementRoot ?? dungeon?.supplementRoot
    ),
    progressionAccepted: dungeon?.progression?.validation?.accepted === true
      || dungeon?.augmentationPlayableAlpha?.accepted === true,
    supplementalRoomsPresent: supplementalRooms.length > 0,
    supplementalRoomsAuthored: supplementalRooms.length > 0
      && supplementalRooms.every((room) => (
        Array.isArray(room.augmentationFloorMask)
          && room.augmentationFloorMask.length > 0
          && Boolean(room.augmentationBlueprint ?? room.augmentationModuleManifest)
      )),
    routeNetworksPresent: routeNetworks.length > 0,
    physicalSupplementRoutesPresent: physicalRoutes.length > 0,
    progressionRoutesPresent: progressionRoutes.length > 0,
    everyNetworkHasPhysicalRoute: networkSummaries.length > 0
      && networkSummaries.every(({ physicalRouteCount }) => physicalRouteCount > 0),
    everyNetworkHasChallengeAndPayoff: networkSummaries.length > 0
      && networkSummaries.every(({ encounterCount, rewardCount }) => (
        encounterCount > 0 && rewardCount > 0
      )),
    everyNetworkHasVerticalTraversal: networkSummaries.length > 0
      && networkSummaries.every(({ elevationTransferCount }) => elevationTransferCount > 0),
    supplementalEncountersPlayable: encounters.length > 0
      && encounters.every((encounter) => (
        Array.isArray(encounter.roster)
          && encounter.roster.length > 0
          && Array.isArray(encounter.spawnPoints)
          && encounter.spawnPoints.length > 0
          && encounter.spawnPoints.every(Boolean)
          && runtimeStateIds(encounter).length > 0
      )),
    supplementalRewardsPlayable: rewards.length > 0
      && rewards.every((reward) => (
        Boolean(reward.position)
          && reward.isProgressionCritical !== true
          && runtimeStateIds(reward).length > 0
      )),
    supplementalMechanismsPlayable: mechanisms.length > 0
      && mechanisms.every((mechanism) => (
        Boolean(mechanism.position)
          && runtimeStateIds(mechanism).length > 0
          && (
            mechanism.type === 'dungeonSupplementLocalControl'
              || mechanism.scopedAction === 'controlLocalHazards'
              || mechanism.type === 'dungeonSupplementShortcut'
              || mechanism.scopedAction === 'unlockShortcut'
          )
      )),
    elevationTransfersPresent: elevationTransfers.length + verticalPhysicalRoutes.length > 0,
    elevationTransfersRealized: elevationTransfers.length > 0
      && elevationTransfers.every(({ id }) => realizedVerticalTransferIds.has(String(id))),
  };
  const failedAssertions = Object.entries(assertions)
    .filter(([, accepted]) => !accepted)
    .map(([name]) => name);
  return {
    ready: failedAssertions.length === 0,
    failedAssertions,
    assertions,
    counts: {
      totalRoomCount: rooms.length,
      supplementalRoomCount: supplementalRooms.length,
      connectorProxyCount: connectorProxies.length,
      routeNetworkCount: routeNetworks.length,
      physicalSupplementRouteCount: physicalRoutes.length,
      verticalPhysicalRouteCount: verticalPhysicalRoutes.length,
      supplementalProgressionRouteCount: progressionRoutes.length,
      supplementalEncounterCount: encounters.length,
      supplementalEncounterSpawnPointCount: encounters.reduce((sum, encounter) => (
        sum + (encounter.spawnPoints?.length ?? 0)
      ), 0),
      supplementalRewardCount: rewards.length,
      supplementalMechanismCount: mechanisms.length,
      localControlCount: localControls.length,
      shortcutControlCount: shortcutControls.length,
      authoredTransferCount: transferRecords.length,
      elevationChangingTransferCount: elevationTransfers.length,
      realizedTransferFloorCount: transferFloorTiles.length,
      supplementalLadderCount: supplementalLadders.length,
      supplementalLiftCount: supplementalLifts.length,
    },
    transferForms: countBy(transferRecords, normalizedTransferForm),
    operationKinds: countBy(routeNetworks, ({ routeNetworkKind }) => routeNetworkKind),
    networks: networkSummaries,
    ids: {
      supplementalRooms: supplementalRooms.map(({ id }) => id).sort(),
      routeNetworks: routeNetworks.map(({ id }) => id).sort(),
      physicalRoutes: physicalRoutes.map(({ id }) => id).sort(),
      verticalPhysicalRoutes: verticalPhysicalRoutes.map(({ id }) => id).sort(),
      encounters: encounters.map(({ id }) => id).sort(),
      rewards: rewards.map(({ id }) => id).sort(),
      mechanisms: mechanisms.map(({ id }) => id).sort(),
      elevationTransfers: elevationTransfers.map(({ id }) => id).sort(),
    },
  };
}

if (process.argv.includes('--candidate-summary')) {
  process.env.ROUTE_CANDIDATE_DEBUG = '1';
  const candidateFilter = process.argv.find((argument) => argument.startsWith('--filter='))
    ?.slice('--filter='.length) ?? 'conveyorRoom_bossRoom';
  const includeStageDiagnostics = process.argv.includes('--stages');
  console.error = (value) => {
    try {
      const record = JSON.parse(String(value));
      if (record.stage) {
        if (includeStageDiagnostics) console.log(JSON.stringify(record));
        return;
      }
      if (!String(record.grantId ?? '').includes(candidateFilter)) return;
      console.log(JSON.stringify({
        grantId: record.grantId,
        candidateOrdinal: record.candidateOrdinal,
        searchVariant: record.searchVariant,
        moduleCount: record.moduleCount,
        elevationMode: record.elevationMode,
        remainingModulesBefore: record.remainingModulesBefore,
        futureRequiredMinimum: record.futureRequiredMinimum,
        minimumModules: record.minimumModules,
        maximumModules: record.maximumModules,
        error: record.error,
        plannedNodeCount: record.plannedNodeCount,
        substantiveModuleCount: record.substantiveModuleCount,
        constraintKind: record.constraintKind ?? record.context?.constraintKind ?? null,
        failedEdge: record.failedEdge ?? null,
        selectedGrammarIds: record.selectedGrammarIds ?? null,
        initialCenters: record.initialCenters ?? null,
        spineEdges: record.spineEdges ?? null,
        pairEdges: record.pairEdges ?? null,
        closestRejectedPairs: record.closestRejectedPairs ?? null,
        lastPhysicalPlacementCenters: record.lastPhysicalPlacementCenters ?? null,
        remainingPlacementCandidateCenters: record.remainingPlacementCandidateCenters ?? null,
        contextKeys: Object.keys(record.context ?? {}),
        endpointOrdinal: record.context?.endpointOrdinal ?? null,
        nodeIndex: record.context?.nodeIndex ?? null,
        firstNodeIndex: record.context?.firstNodeIndex ?? null,
        secondNodeIndex: record.context?.secondNodeIndex ?? null,
        placementCandidateCounts: (record.context?.placementCandidateCounts ?? [])
          .map(({ nodeIndex, count }) => ({ nodeIndex, count })),
        placementCandidateDiagnostics: record.placementCandidateDiagnostics ?? null,
        placementFailureDiagnostics: record.placementFailureDiagnostics ?? null,
        parentAttachmentFailureDiagnostics:
          record.context?.parentAttachmentFailureDiagnostics ?? null,
        lastPhysicalEdge: record.context?.physicalSpineEdgeDiagnostics?.at(-1) ?? null,
      }));
      if (process.argv.includes('--stop-on-success') && record.error == null) {
        process.exit(0);
      }
    } catch {
      // Ignore unrelated diagnostic output in this temporary repro helper.
    }
  };
}

const seed = 'layout:augmentation-realized-v4-000';
const seeded = new SeededRandom(hashSeed(seed));
const generator = new DungeonGenerator({
  random: () => seeded.next(),
  difficulty: 1,
  augmentationProfileId: 'industrial-supplement-preview-v4',
  augmentationSeed: seed,
  basePlanHash: `v1:${seed}:depth:1:revolvingFusillade`,
});
const texture = new THREE.Texture();
generator.textureCache.set('debug-augmentation-attempt', texture);
generator._loadRuinTexture = () => texture;

if (process.argv.includes('--playable-alpha')) {
  const dungeon = generator.generate();
  const smoke = createPlayableAlphaSmokeSummary(dungeon);
  const upperPlatforms = (dungeon.platforms ?? []).filter(({ platformGroupId }) => (
    platformGroupId === 'upper'
  ));
  console.log(JSON.stringify({
    status: dungeon.augmentationStatus,
    playableAlpha: dungeon.augmentationPlayableAlpha ?? null,
    replay: dungeon.augmentationReplayDiagnostics ?? null,
    smoke: {
      ready: smoke.ready,
      failedAssertions: smoke.failedAssertions,
      counts: smoke.counts,
      transferForms: smoke.transferForms,
      networks: smoke.networks,
    },
    releaseValidation: {
      accepted: dungeon.progression?.validation?.accepted ?? null,
      errorCount: dungeon.progression?.validation?.errors?.length ?? 0,
    },
    platformAssembly: {
      legacyGlobalUpperPlatformPresent: (dungeon.platforms ?? [])
        .some(({ id }) => id === 'generatedSolidPlatform_upper'),
      upperPlatformSegmentCount: upperPlatforms.length,
      maximumUpperPlatformSpanMeters: upperPlatforms.reduce((maximum, platform) => (
        Math.max(maximum, platform.halfWidth * 2, platform.halfDepth * 2)
      ), 0),
      upperPlatformOwnerCount: new Set(upperPlatforms.map(({ roomId }) => roomId)).size,
    },
  }, null, 2));
  generator._disposeGeneratedDungeonCandidate(dungeon);
  texture.dispose();
  process.exit(0);
}

const profileId = generator.augmentationProfileId;
generator.augmentationProfileId = null;
const base = generator._generateAcceptedIndustrialDungeon({
  captureAcceptedRandomTape: true,
});
const baseDraft = createIndustrialBaseDraft({
  rooms: base.dungeon.rooms,
  connectionPlans: base.dungeon.connectionPlans,
  basePlanHash: generator.basePlanHash,
  tileSize: generator.tileSize,
  difficulty: generator.difficulty,
});
const host = createIndustrialAugmentationHost({
  baseDraft,
  rooms: base.dungeon.rooms,
  connectionPlans: base.dungeon.connectionPlans,
  tileSize: generator.tileSize,
});
const requestedGrant = process.argv.find((argument) => argument.startsWith('--grant='))
  ?.slice('--grant='.length) ?? 'enemyNest_keycardRoom';
const witnessGrant = host.extensionRegions[0].routeNetworkGrants.find(({ id }) => (
  id.endsWith(`coverage:${requestedGrant}`)
));
if (process.argv.includes('--grants-only')) console.log(JSON.stringify(
  host.extensionRegions[0].routeNetworkGrants.map((grant) => ({
    id: grant.id,
    kind: grant.kind,
    required: grant.required,
    minimumModules: grant.minimumModules,
    maximumModules: grant.maximumModules,
    endpointCount: grant.endpointSockets?.length ?? 0,
    endpoints: (grant.endpointSockets ?? []).map((socket) => ({
      id: socket.id,
      position: socket.position,
      facing: socket.facing,
      distanceMeters: socket.distanceMeters,
      planningModuleCenter: socket.planningModuleCenter,
      planningContinuationCenter: socket.planningContinuationCenter,
    })),
  })),
  null,
  2,
));
if (process.argv.includes('--grants-only')) {
  generator._disposeGeneratedDungeonCandidate(base.dungeon);
  texture.dispose();
  process.exit(0);
}
if (process.argv.includes('--host-only')) console.log(JSON.stringify({
  rooms: base.dungeon.rooms
    .filter(({ id }) => [witnessGrant?.mustPreserveBeatIds ?? []].flat().includes(id))
    .map(({ id, x, z, width, depth, baseElevation }) => ({
      id, x, z, width, depth, baseElevation,
    })),
  connection: base.dungeon.connectionPlans
    .filter(({ logicalConnectionId }) => logicalConnectionId === requestedGrant)
    .map(({ id, fromRoomId, toRoomId, fullPath, connectorFootprintTiles }) => ({
      id,
      fromRoomId,
      toRoomId,
      fullPath,
      connectorFootprintTiles,
    })),
  endpoints: witnessGrant?.endpointSockets,
  stationDiagnostics: witnessGrant?.planningStationSideDiagnostics,
  grantProtectedVolumes: host.extensionRegions[0].routeNetworkPlacementProtectedVolumes
    .filter(({ ownerId }) => String(ownerId) === requestedGrant),
}, null, 2));
if (process.argv.includes('--host-only')) {
  generator._disposeGeneratedDungeonCandidate(base.dungeon);
  texture.dispose();
  process.exit(0);
}
generator.augmentationProfileId = profileId;
let cursor = 0;
generator.random = () => base.randomTape[cursor++];

if (process.argv.includes('--plan-only')) {
  const planned = generator._planIndustrialDungeonAugmentation({
    rooms: base.dungeon.rooms,
    connectionPlans: base.dungeon.connectionPlans,
  });
  if (process.argv.includes('--failure-summary')) {
    const error = planned?.diagnostics?.errors?.[0] ?? null;
    const context = error?.context ?? {};
    console.log(JSON.stringify({
      status: planned?.status ?? null,
      error: error ? {
        code: error.code,
        grantId: context.grantId,
        selectedGrammarIds: context.selectedGrammarIds,
        contentRoles: context.contentRoles,
        endpointNodeIndices: context.endpointNodeIndices,
        constraintKind: context.constraintKind,
        firstNodeIndex: context.firstNodeIndex,
        secondNodeIndex: context.secondNodeIndex,
        nodeIndex: context.nodeIndex,
        placementFailureDiagnostics: context.placementFailureDiagnostics,
        closestRejectedPairs: context.closestRejectedPairs,
        placementSearchVisits: context.placementSearchVisits,
        physicalSpineAttempts: context.physicalSpineAttempts,
        objectiveExternalDiagnostics: context.objectiveExternalDiagnostics,
        lastPhysicalPlacementCenters: context.lastPhysicalPlacementCenters,
        parentAttachmentFailures: context.parentAttachmentFailureDiagnostics,
        placementCandidates: (context.placementCandidateCounts ?? []).map((record) => ({
          nodeIndex: record.nodeIndex,
          count: record.count,
          rawCandidateCount: record.diagnostics?.rawCandidateCount,
          collisionFreeCount: record.diagnostics?.collisionFreeCount,
          withinParentDistanceCount: record.diagnostics?.withinParentDistanceCount,
          parentAttachmentCompatibleCount:
            record.diagnostics?.parentAttachmentCompatibleCount,
        })),
        physicalPairEdges: context.physicalPairEdgeDiagnostics,
        spineEdges: context.physicalSpineEdgeDiagnostics,
      } : null,
    }, null, 2));
    generator._disposeGeneratedDungeonCandidate(base.dungeon);
    texture.dispose();
    process.exit(0);
  }
  const overlayPlan = planned?.result?.overlayPlan ?? null;
  if (process.argv.includes('--physical-summary')) {
    const requestedSegment = process.argv.find((argument) => argument.startsWith('--segment='))
      ?.slice('--segment='.length) ?? null;
    const physicalPlans = (planned?.materialized?.connectionPlans ?? []).filter((plan) => (
      String(plan.routeNetworkGrantId ?? plan.logicalConnectionId ?? '')
        .includes(requestedGrant)
        && (requestedSegment == null
          || String(plan.id).includes(`:segment:${requestedSegment}:`))
    ));
    const roomIds = new Set(physicalPlans.flatMap(({ fromRoomId, toRoomId }) => (
      [fromRoomId, toRoomId].filter(Boolean).map(String)
    )));
    console.log(JSON.stringify({
      status: planned?.status ?? null,
      overlaySegments: (overlayPlan?.segments ?? [])
        .filter(({ id }) => physicalPlans.some((plan) => String(plan.id) === String(id)))
        .map(({ id, from, to, path }) => ({ id, from, to, path })),
      plans: physicalPlans.map((plan) => ({
        id: plan.id,
        fromRoomId: plan.fromRoomId,
        toRoomId: plan.toRoomId,
        sourceElevation: plan.sourceElevation,
        destinationElevation: plan.destinationElevation,
        fromSocket: plan.fromSocket,
        toSocket: plan.toSocket,
        fullPath: plan.fullPath,
      })),
      rooms: (planned?.materialized?.rooms ?? [])
        .filter(({ id }) => roomIds.has(String(id)))
        .map((room) => ({
          id: room.id,
          x: room.x,
          z: room.z,
          width: room.width,
          depth: room.depth,
          blueprintId: room.augmentationBlueprintId,
          moduleTemplateId: room.augmentationModuleTemplateId,
          transfers: (room.augmentationTransfers ?? []).map((transfer) => ({
            id: transfer.id,
            form: transfer.form,
            worldElevationRange: transfer.worldElevationRange,
            worldCells: (transfer.worldCells ?? []).map((cell) => ({
              x: cell.grid?.x,
              z: cell.grid?.z,
              elevation: cell.elevation,
            })),
          })),
          floorCells: (room.augmentationFloorTiers ?? []).flatMap((tier) => (
            (tier.worldCells ?? []).map((cell) => ({
              x: cell.grid?.x,
              z: cell.grid?.z,
              y: cell.elevation,
              tier: tier.localTierId,
            }))
          )),
        })),
    }, null, 2));
    generator._disposeGeneratedDungeonCandidate(base.dungeon);
    texture.dispose();
    process.exit(0);
  }
  const elevationSummary = process.argv.includes('--elevation-summary') && overlayPlan
    ? (overlayPlan.operations ?? []).map((operation) => {
        const operationNodes = (overlayPlan.nodes ?? []).filter((node) => (
          String(node.operationId) === String(operation.id)
        ));
        const operationSegments = (overlayPlan.segments ?? []).filter((segment) => (
          String(segment.operationId ?? segment.augmentationOperationId) === String(operation.id)
        ));
        return {
          id: operation.id,
          grantId: operation.grantId,
          elevationModes: operation.elevationModes,
          nodes: operationNodes.map((node) => ({
            ordinal: node.ordinal,
            contentRole: node.contentRole,
            blueprintId: node.blueprintId,
            centerY: node.placement?.center?.y,
            authoredExitDelta: node.selectionConstraints?.authoredExitElevationDeltaMeters,
            sockets: (node.sockets ?? []).map((socket) => ({
              localSocketId: socket.localSocketId,
              y: socket.position?.y,
              segmentId: socket.segmentId,
            })),
          })),
          verticalSegments: operationSegments
            .filter((segment) => Math.abs(
              Number(segment.to?.position?.y) - Number(segment.from?.position?.y),
            ) > 0.000001)
            .map((segment) => ({
              id: segment.id,
              routeRole: segment.routeRole,
              connectorFamily: segment.connectorFamily,
              fromY: segment.from?.position?.y,
              toY: segment.to?.position?.y,
              fromNodeId: segment.from?.nodeId,
              toNodeId: segment.to?.nodeId,
              fromLocalSocketId: segment.from?.localSocketId,
              toLocalSocketId: segment.to?.localSocketId,
            })),
        };
      })
    : null;
  const elevationDebug = process.argv.includes('--elevation-debug') && overlayPlan
    ? {
        segments: (overlayPlan.segments ?? [])
          .filter(({ connectorFamily, family }) => ![
            undefined,
            null,
            'service-gallery',
            'service_gallery',
          ].includes(connectorFamily ?? family))
          .map((segment) => ({
            id: segment.id,
            operationId: segment.operationId ?? segment.augmentationOperationId,
            connectorFamily: segment.connectorFamily ?? segment.family,
            from: segment.from,
            to: segment.to,
            path: segment.path ?? segment.physicalPath ?? segment.gridPath,
          })),
        nodes: (overlayPlan.nodes ?? [])
          .filter((node) => node.structure?.physicalTransfers?.length
            || node.physicalDefinition?.transfers?.length
            || node.physicalRealization?.transfers?.length
            || node.contentRole === 'elevation')
          .map((node) => ({
            id: node.id,
            operationId: node.operationId,
            contentRole: node.contentRole,
            grammarId: node.grammarId,
            moduleKind: node.moduleKind,
            moduleTemplateId: node.moduleTemplateId,
            blueprintId: node.blueprintId ?? node.physicalDefinition?.blueprintId,
            position: node.position ?? node.placement?.center,
            sockets: (node.sockets ?? []).map((socket) => ({
              id: socket.id,
              localSocketId: socket.localSocketId,
              position: socket.position,
              state: socket.state,
              segmentId: socket.segmentId,
            })),
            authoredExitElevationDeltaMeters:
              node.selectionConstraints?.authoredExitElevationDeltaMeters,
            transfers: node.structure?.physicalTransfers
              ?? node.physicalDefinition?.transfers
              ?? node.physicalRealization?.transfers,
          })),
      }
    : null;
  console.log(JSON.stringify({
    status: planned?.status ?? null,
    diagnostics: planned?.diagnostics ?? null,
    ...(elevationSummary ? { elevationSummary } : {}),
    ...(elevationDebug ? { elevationDebug } : {}),
  }, null, 2));
  generator._disposeGeneratedDungeonCandidate(base.dungeon);
  texture.dispose();
  process.exit(0);
}

try {
  const dungeon = generator._generateOnce();
  const rawDiagnostics = dungeon.augmentationDiagnostics ?? null;
  const playableAlphaSmoke = createPlayableAlphaSmokeSummary(dungeon);
  console.log(JSON.stringify({
    status: dungeon.augmentationStatus,
    playableAlphaSmoke: {
      ready: playableAlphaSmoke.ready,
      failedAssertions: playableAlphaSmoke.failedAssertions,
      assertions: playableAlphaSmoke.assertions,
      counts: playableAlphaSmoke.counts,
      transferForms: playableAlphaSmoke.transferForms,
      operationKinds: playableAlphaSmoke.operationKinds,
      networks: playableAlphaSmoke.networks,
    },
    progressionValidation: dungeon.progression?.validation ? {
      accepted: dungeon.progression.validation.accepted,
      errorCount: dungeon.progression.validation.errors?.length ?? 0,
      errors: dungeon.progression.validation.errors?.slice(0, 220) ?? [],
      effectiveGraphAccepted: dungeon.progression.validation.effectiveGraph?.accepted ?? null,
      rejectedConnectorEntrances: (
        dungeon.progression.validation.connectorEntrances?.checks ?? []
      ).filter(({ accepted }) => accepted !== true).slice(0, 80).map((check) => ({
        socketId: check.socketId,
        connectionId: check.connectionId,
        socketReachable: check.socketReachable,
        outsideReachable: check.outsideReachable,
        blockingWallFacadeId: check.blockingWallFacadeId,
        failedLanes: (check.laneChecks ?? [])
          .filter(({ accepted }) => accepted !== true)
          .map((lane) => ({
            offset: lane.offset,
            missingFloorKeys: lane.points.filter(({ floorKey }) => !floorKey)
              .map(({ x, z }) => `${x},${z}`),
            unreachableFloorKeys: lane.points.filter(({ floorKey, reachable }) => (
              floorKey && !reachable
            )).map(({ floorKey }) => floorKey),
            blockingZoneIds: [...new Set((lane.edgeChecks ?? [])
              .flatMap(({ blockingZoneIds = [] }) => blockingZoneIds))],
          })),
      })),
    } : null,
    steepRamps: (dungeon.floorTiles ?? [])
      .filter(({ surface, steepRamp }) => surface === 'industrialRamp' && steepRamp)
      .map((floor) => ({
        x: floor.x,
        z: floor.z,
        elevation: floor.elevation,
        roomId: floor.roomId,
        transferId: floor.augmentationTransferId,
        transferIds: floor.augmentationTransferIds,
        rampStartElevation: floor.rampStartElevation,
        rampEndElevation: floor.rampEndElevation,
        rampDirectionX: floor.rampDirectionX,
        rampDirectionZ: floor.rampDirectionZ,
      })),
    decorativeArchPlans: (dungeon.connectionPlans ?? [])
      .filter(({ decorativeArchBeats }) => (decorativeArchBeats?.length ?? 0) > 0)
      .map((plan) => ({
        id: plan.id,
        isDungeonSupplement: plan.isDungeonSupplement,
        isPaddedByDungeonSupplement: plan.isPaddedByDungeonSupplement,
        hasDungeonSupplementRouteStation: plan.hasDungeonSupplementRouteStation,
        augmentationOperationType: plan.augmentationOperationType,
        routeNetworkGrantId: plan.routeNetworkGrantId,
        widths: [...new Set(plan.decorativeArchBeats.map(({ widthMeters }) => widthMeters))],
      })),
    diagnostics: rawDiagnostics ? {
      status: rawDiagnostics.status ?? null,
      accepted: rawDiagnostics.accepted ?? null,
      reason: rawDiagnostics.reason ?? null,
      errorCount: rawDiagnostics.errors?.length ?? 0,
      errors: rawDiagnostics.errors?.slice(0, 20) ?? [],
    } : null,
  }, null, 2));
  generator._disposeGeneratedDungeonCandidate(dungeon, base.dungeon);
} catch (error) {
  const decision = error.augmentationDiagnostics?.decisions?.at(-1);
  const context = decision?.context ?? {};
  const rawDiagnostics = error.augmentationDiagnostics ?? null;
  const diagnostics = rawDiagnostics?.reason === 'foreign-floor-ownership'
    ? rawDiagnostics
    : rawDiagnostics ? {
        status: rawDiagnostics.status ?? null,
        reason: rawDiagnostics.reason ?? null,
        errorCount: rawDiagnostics.errors?.length ?? 0,
        errors: rawDiagnostics.errors?.slice(0, 40) ?? [],
        failedConnectorChecks: (rawDiagnostics.connectorEntrances?.checks ?? [])
          .filter(({ accepted }) => accepted !== true)
          .slice(0, 8),
      } : null;
  const blockedVolumeIds = new Set((context.physicalPairEdgeDiagnostics ?? [])
    .flatMap(({ bestBlockedCollisionIds = [] }) => bestBlockedCollisionIds));
  console.log(JSON.stringify({
    code: error.code,
    message: error.message,
    stack: error.stack?.split('\n').slice(0, 12) ?? null,
    diagnostics,
    playableAlphaSmoke: {
      ready: false,
      failedAssertions: ['generationCompleted'],
      assertions: { generationCompleted: false },
    },
    decision: decision ? {
      ...decision,
      context: {
        grantId: context.grantId,
        requestedSubstantiveModuleCount: context.requestedSubstantiveModuleCount,
        constraintKind: context.constraintKind,
        firstNodeIndex: context.firstNodeIndex,
        secondNodeIndex: context.secondNodeIndex,
        placementSearchVisits: context.placementSearchVisits,
        physicalSpineAttempts: context.physicalSpineAttempts,
        placementCandidateCounts: (context.placementCandidateCounts ?? []).map((record) => ({
          nodeIndex: record.nodeIndex,
          count: record.count,
          baseCenterCandidate: record.diagnostics?.baseCenterCandidate,
          selectedCandidateCenters: record.diagnostics?.selectedCandidateCenters,
        })),
        closestRejectedPairs: context.closestRejectedPairs,
        initialPlacementCandidateCenters: context.initialPlacementCandidateCenters,
        physicalPairEdgeDiagnostics: context.physicalPairEdgeDiagnostics,
        blockedVolumes: host.extensionRegions[0].routeNetworkPlacementProtectedVolumes
          .filter(({ id }) => blockedVolumeIds.has(String(id))),
        physicalSpineEdgeDiagnostics: context.physicalSpineEdgeDiagnostics,
        fromNodeIndex: context.fromNodeIndex,
        toNodeIndex: context.toNodeIndex,
        fromSocket: context.fromSocket,
        toSocket: context.toSocket,
        routeCandidates: context.routeCandidates,
        routeNetworkSolver: context.routeNetworkSolver,
      },
    } : null,
  }, null, 2));
} finally {
  generator._disposeGeneratedDungeonCandidate(base.dungeon);
  texture.dispose();
}
