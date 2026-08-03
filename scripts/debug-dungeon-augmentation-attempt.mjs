import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';
import {
  createIndustrialAugmentationHost,
  createIndustrialBaseDraft,
} from '../src/dungeon-augmentation/IndustrialDraftAdapter.js';
import {
  createDungeonSelectionBag,
  dungeonSelectionBagCandidates,
  DUNGEON_AUGMENTATION_PROFILES,
  DungeonAugmentationRandom,
  GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  hashCanonicalValue,
  normalizeRouteNetworkGrant,
  planRouteNetwork,
} from '../src/dungeon-augmentation/index.js';

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

function createGeometryIntegritySummary(generator, dungeon) {
  const floorTiles = dungeon?.floorTiles ?? [];
  const structuralTiles = [...(dungeon?.tiles?.values?.() ?? [])];
  const rooms = dungeon?.rooms ?? [];
  const roomById = new Map(rooms.map((room) => [String(room.id), room]));
  const supplementalRoomIds = new Set(rooms
    .filter(({ isDungeonSupplement }) => isDungeonSupplement === true)
    .map(({ id }) => String(id)));
  const authoredFloorTiles = floorTiles.filter((floor) => (
    floor.roomId && !supplementalRoomIds.has(String(floor.roomId))
  ));
  const authoredStart = authoredFloorTiles[0] ?? null;
  const reachableFloorKeys = authoredStart
    ? generator._createReachableFloorTileKeySet(authoredStart, floorTiles)
    : new Set();
  const unreachableSupplementFloors = floorTiles.filter((floor) => (
    supplementalRoomIds.has(String(floor.roomId ?? ''))
      && !reachableFloorKeys.has(generator._getFloorTileGraphKey(floor))
  ));
  const unreachableNonSupplementFloors = floorTiles.filter((floor) => (
    !supplementalRoomIds.has(String(floor.roomId ?? ''))
      && !reachableFloorKeys.has(generator._getFloorTileGraphKey(floor))
  ));
  const authoredColumns = new Map();
  for (const floor of authoredFloorTiles) {
    const key = `${floor.x},${floor.z}`;
    const values = authoredColumns.get(key) ?? [];
    values.push(floor);
    authoredColumns.set(key, values);
  }
  const authoredVolumeIntrusions = floorTiles.filter((floor) => {
    if (!supplementalRoomIds.has(String(floor.roomId ?? ''))) return false;
    return (authoredColumns.get(`${floor.x},${floor.z}`) ?? []).some((authoredFloor) => {
      const authoredRoom = roomById.get(String(authoredFloor.roomId));
      const authoredY = Number(authoredFloor.elevation ?? 0);
      const ceilingY = Number(
        authoredRoom?.ceilingY
          ?? authoredRoom?.ceilingHeight
          ?? (authoredY + 8.4),
      );
      const supplementalY = Number(floor.elevation ?? 0);
      return supplementalY > authoredY + 0.05 && supplementalY < ceilingY - 0.05;
    });
  });
  const mixedAuthoredSupplementFloors = floorTiles.filter((floor) => {
    const ownerIds = floor.mergedFloorOwnerIds ?? [];
    return ownerIds.some((ownerId) => supplementalRoomIds.has(String(ownerId)))
      && ownerIds.some((ownerId) => (
        roomById.has(String(ownerId))
          && !supplementalRoomIds.has(String(ownerId))
      ));
  });
  const unownedFloorTiles = floorTiles.filter((floor) => (
    !floor.roomId
      && !floor.connectionId
      && !floor.connectorId
      && !floor.connectorJunctionOwnerId
      && !floor.augmentationOwnerId
  ));
  const floorColumns = new Set(floorTiles.map(({ x, z }) => `${x},${z}`));
  const structuralEnvelopeCells = structuralTiles.filter((tile) => (
    tile?.structuralEnvelopeOnly === true
      || tile?.surface === 'connectorStructuralEnvelope'
      || tile?.type === 'connectorEnvelope'
  ));
  const orphanStructuralEnvelopeCells = structuralEnvelopeCells.filter((tile) => {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        if (floorColumns.has(`${tile.x + dx},${tile.z + dz}`)) return false;
      }
    }
    return true;
  });
  const boundaryWallRuns = dungeon?.augmentationPhysicalShell?.boundaryWallRuns ?? [];
  const unownedBoundaryWallRuns = boundaryWallRuns.filter((run) => (
    !Array.isArray(run.ownerIds) || run.ownerIds.length === 0
  ));
  const unreachableByRoom = countBy(
    unreachableSupplementFloors,
    ({ roomId }) => roomId,
  );
  return {
    accepted: unreachableSupplementFloors.length === 0
      && unreachableNonSupplementFloors.length === 0
      && authoredVolumeIntrusions.length === 0
      && mixedAuthoredSupplementFloors.length === 0
      && unownedFloorTiles.length === 0
      && orphanStructuralEnvelopeCells.length === 0
      && unownedBoundaryWallRuns.length === 0,
    authoredStartFloorKey: authoredStart
      ? generator._getFloorTileGraphKey(authoredStart)
      : null,
    totalFloorTileCount: floorTiles.length,
    reachableFloorTileCount: reachableFloorKeys.size,
    unreachableSupplementFloorCount: unreachableSupplementFloors.length,
    unreachableSupplementRoomCount: Object.keys(unreachableByRoom).length,
    unreachableSupplementFloorsByRoom: unreachableByRoom,
    unreachableNonSupplementFloorCount: unreachableNonSupplementFloors.length,
    unreachableNonSupplementFloorsByRoom: countBy(
      unreachableNonSupplementFloors,
      ({ roomId, connectionId, connectorId }) => (
        roomId ?? connectionId ?? connectorId ?? 'unowned'
      ),
    ),
    unreachableNonSupplementFloorsBySurface: countBy(
      unreachableNonSupplementFloors,
      ({ surface, type }) => surface ?? type ?? 'unknown',
    ),
    unreachableNonSupplementFloorSamples: unreachableNonSupplementFloors
      .slice(0, 50)
      .map((floor) => ({
        floorKey: generator._getFloorTileGraphKey(floor),
        roomId: floor.roomId ?? null,
        connectionId: floor.connectionId ?? floor.connectorId ?? null,
        surface: floor.surface ?? floor.type ?? null,
        isPlatformingSurface: Boolean(floor.isPlatformingSurface),
        requiredTraversalAction: floor.requiredTraversalAction ?? null,
      })),
    authoredVolumeIntrusionCount: authoredVolumeIntrusions.length,
    authoredVolumeIntrusionSamples: authoredVolumeIntrusions.slice(0, 30).map((floor) => ({
      floorKey: generator._getFloorTileGraphKey(floor),
      roomId: floor.roomId ?? null,
      surface: floor.surface ?? floor.type ?? null,
    })),
    mixedAuthoredSupplementFloorCount: mixedAuthoredSupplementFloors.length,
    unownedFloorTileCount: unownedFloorTiles.length,
    unownedFloorSamples: unownedFloorTiles.slice(0, 30).map((floor) => ({
      floorKey: generator._getFloorTileGraphKey(floor),
      surface: floor.surface ?? floor.type ?? null,
    })),
    structuralEnvelopeCellCount: structuralEnvelopeCells.length,
    orphanStructuralEnvelopeCellCount: orphanStructuralEnvelopeCells.length,
    orphanStructuralEnvelopeSamples: orphanStructuralEnvelopeCells.slice(0, 30).map((tile) => ({
      x: tile.x,
      z: tile.z,
      connectionId: tile.connectionId ?? tile.connectorId ?? null,
      roomId: tile.roomId ?? null,
    })),
    boundaryWallRunCount: boundaryWallRuns.length,
    unownedBoundaryWallRunCount: unownedBoundaryWallRuns.length,
  };
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

const candidateSummaryRequested = process.argv.includes('--candidate-summary');
const candidateHistogramRequested = process.argv.includes('--candidate-histogram');
const candidateHistogramRecords = [];

function summarizeCandidateHistogram(records) {
  const byGrantId = new Map();
  for (const record of records) {
    const grantId = String(record.grantId ?? 'unknown');
    const summary = byGrantId.get(grantId) ?? {
      grantId,
      evaluations: 0,
      plannedCount: 0,
      failedCount: 0,
      errors: new Map(),
      planningTimesMs: [],
    };
    summary.evaluations += 1;
    if (record.error == null) {
      summary.plannedCount += 1;
    } else {
      summary.failedCount += 1;
      const error = String(record.error);
      summary.errors.set(error, (summary.errors.get(error) ?? 0) + 1);
    }
    const planningElapsedMs = Number(record.planningElapsedMs);
    if (Number.isFinite(planningElapsedMs)) {
      summary.planningTimesMs.push(planningElapsedMs);
    }
    byGrantId.set(grantId, summary);
  }
  return [...byGrantId.values()].map((summary) => {
    const sortedTimes = [...summary.planningTimesMs].sort((first, second) => first - second);
    const midpoint = Math.floor(sortedTimes.length * 0.5);
    const medianPlanningMs = sortedTimes.length === 0
      ? null
      : sortedTimes.length % 2 === 0
        ? (sortedTimes[midpoint - 1] + sortedTimes[midpoint]) * 0.5
        : sortedTimes[midpoint];
    return {
      grantId: summary.grantId,
      evaluations: summary.evaluations,
      plannedCount: summary.plannedCount,
      failedCount: summary.failedCount,
      errors: Object.fromEntries([...summary.errors].sort(([first], [second]) => (
        first.localeCompare(second)
      ))),
      totalPlanningMs: Number(
        sortedTimes.reduce((sum, value) => sum + value, 0).toFixed(3),
      ),
      medianPlanningMs: medianPlanningMs == null
        ? null
        : Number(medianPlanningMs.toFixed(3)),
      maxPlanningMs: sortedTimes.length === 0
        ? null
        : Number(sortedTimes.at(-1).toFixed(3)),
    };
  });
}

if (candidateSummaryRequested) {
  globalThis.__DUNGEON_AUGMENTATION_ROUTE_CANDIDATE_DEBUG__ = true;
  const candidateFilter = process.argv.find((argument) => argument.startsWith('--filter='))
    ?.slice('--filter='.length) ?? 'conveyorRoom_bossRoom';
  globalThis.__DUNGEON_AUGMENTATION_ROUTE_PLANNING_DEBUG_FILTER__ = candidateFilter;
  globalThis.__DUNGEON_AUGMENTATION_ROUTE_PLANNING_STAGE_FILTER__ = process.argv
    .find((argument) => argument.startsWith('--stage-filter='))
    ?.slice('--stage-filter='.length) ?? '';
  globalThis.__DUNGEON_AUGMENTATION_ROUTE_CANDIDATE_DEBUG_SKIPS__ = process.argv
    .find((argument) => argument.startsWith('--debug-skip-candidates='))
    ?.slice('--debug-skip-candidates='.length)
    .split(',')
    .map((token) => {
      const match = token.match(/^(.*)@(\d+)(?:-(\d+))?$/);
      if (!match) return null;
      const firstOrdinal = Number.parseInt(match[2], 10);
      const lastOrdinal = Number.parseInt(match[3] ?? match[2], 10);
      return {
        grantSuffix: match[1],
        firstOrdinal: Math.min(firstOrdinal, lastOrdinal),
        lastOrdinal: Math.max(firstOrdinal, lastOrdinal),
      };
    })
    .filter(Boolean) ?? [];
  globalThis.__DUNGEON_AUGMENTATION_ROUTE_CANDIDATE_DEBUG_PREFERRED_GRANT__ = process.argv
    .find((argument) => argument.startsWith('--debug-prefer-grant='))
    ?.slice('--debug-prefer-grant='.length) ?? '';
  const stopAfterCandidateArgument = process.argv.find((argument) => (
    argument.startsWith('--stop-after-candidate=')
  ));
  const stopAfterCandidateOrdinal = Number.parseInt(
    stopAfterCandidateArgument?.slice('--stop-after-candidate='.length) ?? '',
    10,
  );
  const includeStageDiagnostics = process.argv.includes('--stages');
  const stagesOnly = process.argv.includes('--stages-only');
  const briefCandidateSummary = process.argv.includes('--brief-candidate-summary');
  const stopAfterStage = process.argv.find((argument) => (
    argument.startsWith('--stop-after-stage=')
  ))?.slice('--stop-after-stage='.length) ?? null;
  const stopAfterStageCount = Math.max(1, Number.parseInt(
    process.argv.find((argument) => argument.startsWith('--stop-after-stage-count='))
      ?.slice('--stop-after-stage-count='.length) ?? '1',
    10,
  ) || 1);
  let matchingStageCount = 0;
  console.error = (value) => {
    try {
      const record = JSON.parse(String(value));
      if (record.stage) {
        if (includeStageDiagnostics
          && String(record.grantId ?? '').includes(candidateFilter)) {
          console.log(JSON.stringify(record));
        }
        if (stopAfterStage === String(record.stage)
          && String(record.grantId ?? '').includes(candidateFilter)) {
          matchingStageCount += 1;
          if (matchingStageCount >= stopAfterStageCount) process.exit(0);
        }
        return;
      }
      if (stagesOnly) return;
      if (!String(record.grantId ?? '').includes(candidateFilter)) return;
      console.log(JSON.stringify({
        grantId: record.grantId,
        candidateOrdinal: record.candidateOrdinal,
        searchVariant: record.searchVariant,
        moduleCount: record.moduleCount,
        elevationMode: record.elevationMode,
        topologyTemplateId: record.topologyTemplateId,
        junctionKind: record.junctionKind,
        remainingModulesBefore: record.remainingModulesBefore,
        futureRequiredMinimum: record.futureRequiredMinimum,
        minimumModules: record.minimumModules,
        maximumModules: record.maximumModules,
        error: record.error,
        planningElapsedMs: record.planningElapsedMs ?? null,
        planningPhaseTimings: record.planningPhaseTimings ?? null,
        plannedNodeCount: record.plannedNodeCount,
        substantiveModuleCount: record.substantiveModuleCount,
        placementSearchVisits: record.placementSearchVisits
          ?? record.context?.placementSearchVisits
          ?? null,
        physicalSpineAttempts: record.physicalSpineAttempts
          ?? record.context?.physicalSpineAttempts
          ?? null,
        constraintKind: record.constraintKind ?? record.context?.constraintKind ?? null,
        failedEdge: record.failedEdge ?? null,
        selectedGrammarIds: record.selectedGrammarIds
          ?? record.context?.selectedGrammarIds
          ?? null,
        initialCenters: briefCandidateSummary ? undefined : record.initialCenters
          ?? record.context?.initialPlacementCandidateCenters
          ?? null,
        spineEdges: record.spineEdges ?? null,
        pairEdges: record.pairEdges ?? null,
        closestRejectedPairs: briefCandidateSummary
          ? undefined
          : record.closestRejectedPairs ?? null,
        lastPhysicalPlacementCenters: record.lastPhysicalPlacementCenters
          ?? record.context?.lastPhysicalPlacementCenters
          ?? null,
        remainingPlacementCandidateCenters: briefCandidateSummary
          ? undefined
          : record.remainingPlacementCandidateCenters
          ?? record.context?.remainingPlacementCandidateCenters
          ?? null,
        contextKeys: Object.keys(record.context ?? {}),
        endpointOrdinal: record.context?.endpointOrdinal ?? null,
        nodeIndex: record.context?.nodeIndex ?? null,
        nodePlacementFailure: record.error === 'route-network-node-placement-collision'
          ? record.context
          : null,
        challengeBranchRoomIndex: record.context?.challengeBranchRoomIndex ?? null,
        mainPayoffRoomIndex: record.context?.mainPayoffRoomIndex ?? null,
        endpointNodeIndices: record.context?.endpointNodeIndices ?? null,
        stationSeparationMeters: record.context?.stationSeparationMeters ?? null,
        stationRouteLengthMeters: record.context?.stationRouteLengthMeters ?? null,
        connectorEndpointGapMeters: record.context?.connectorEndpointGapMeters ?? null,
        legalGrammarIds: record.context?.legalGrammarIds ?? null,
        selectedGrammarId: record.context?.selectedGrammarId ?? null,
        firstNodeIndex: record.context?.firstNodeIndex ?? null,
        secondNodeIndex: record.context?.secondNodeIndex ?? null,
        landmarkEndpointPlacements:
          record.context?.landmarkEndpointPlacements ?? null,
        firstCandidateCount: record.context?.firstCandidateCount ?? null,
        firstCandidateCenters: briefCandidateSummary
          ? undefined
          : record.context?.firstCandidateCenters ?? null,
        nearestRawFirstCandidates: briefCandidateSummary
          ? undefined
          : record.context?.nearestRawFirstCandidates ?? null,
        pairPlacementDiagnostics: briefCandidateSummary
          ? undefined
          : record.context?.pairPlacementDiagnostics ?? null,
        entryEligiblePairPlacementDiagnostics: briefCandidateSummary
          ? undefined
          : record.context?.entryEligiblePairPlacementDiagnostics ?? null,
        attemptedWingCandidates: briefCandidateSummary
          ? undefined
          : record.context?.attemptedWingCandidates ?? null,
        attemptedWingCandidateSummary:
          record.context?.attemptedWingCandidateSummary ?? null,
        placementCandidateCounts: (record.context?.placementCandidateCounts ?? [])
          .map(({ nodeIndex, count }) => ({ nodeIndex, count })),
        initialPlacementCandidateCounts:
          record.context?.initialPlacementCandidateCounts ?? null,
        arcConsistencyHistory: record.context?.arcConsistencyHistory ?? null,
        failedPairRejectionSummary:
          record.context?.failedPairRejectionSummary ?? null,
        physicalPairEdgeDiagnostics:
          record.context?.physicalPairEdgeDiagnostics ?? null,
        closestRejectedPairs: (record.context?.closestRejectedPairs ?? []).map((pair) => ({
          firstCenter: pair.firstCenter,
          secondCenter: pair.secondCenter,
          firstAvailableSockets: pair.firstAvailableSockets,
          secondAvailableSockets: pair.secondAvailableSockets,
          nodeCollisionScore: pair.nodeCollisionScore,
          minimumSpineDistanceMeters: pair.minimumSpineDistanceMeters,
          parentAttachmentClear: pair.parentAttachmentClear,
          physicalRouteClear: pair.physicalRouteClear,
        })),
        requiredSocketBindings: record.context?.requiredSocketBindings ?? null,
        objectiveExternalDiagnostics:
          record.context?.objectiveExternalDiagnostics ?? null,
        externalSpinePathCount:
          record.context?.externalSpinePathCount ?? null,
        externalSpinePathBindings:
          record.context?.externalSpinePathBindings ?? null,
        correlatedPlacementReservationDiagnostics:
          record.context?.correlatedPlacementReservationDiagnostics ?? null,
        placementCandidateDiagnostics: record.placementCandidateDiagnostics ?? null,
        placementFailureDiagnostics: record.placementFailureDiagnostics ?? null,
        parentAttachmentFailureDiagnostics: briefCandidateSummary ? undefined
          :
          record.context?.parentAttachmentFailureDiagnostics ?? null,
        inactiveSocketCapFailureDiagnostics: briefCandidateSummary ? undefined
          : record.context?.inactiveSocketCapFailureDiagnostics ?? null,
        segmentFailureDiagnostics: briefCandidateSummary ? undefined
          : record.context?.segmentFailureDiagnostics ?? null,
        lastPhysicalEdge: record.context?.physicalSpineEdgeDiagnostics?.at(-1) ?? null,
        physicalSpineEdges: briefCandidateSummary
          ? undefined
          : record.context?.physicalSpineEdgeDiagnostics ?? null,
      }));
      if (process.argv.includes('--stop-on-success') && record.error == null) {
        process.exit(0);
      }
      if (Number.isSafeInteger(stopAfterCandidateOrdinal)
        && Number(record.candidateOrdinal) === stopAfterCandidateOrdinal) {
        process.exit(0);
      }
    } catch {
      // Ignore unrelated diagnostic output in this temporary repro helper.
    }
  };
} else if (candidateHistogramRequested) {
  globalThis.__DUNGEON_AUGMENTATION_ROUTE_CANDIDATE_DEBUG__ = true;
  const originalConsoleError = console.error.bind(console);
  console.error = (value, ...remainingValues) => {
    try {
      const record = JSON.parse(String(value));
      if (!record.stage && record.grantId && Number.isSafeInteger(record.candidateOrdinal)) {
        candidateHistogramRecords.push(record);
      }
    } catch {
      originalConsoleError(value, ...remainingValues);
    }
  };
}

const seed = process.argv.find((argument) => argument.startsWith('--seed='))
  ?.slice('--seed='.length) ?? 'layout:augmentation-realized-v4-000';
const requestedConnectionFilter = process.argv
  .find((argument) => argument.startsWith('--connection='))
  ?.slice('--connection='.length) ?? null;
const requestedConnectionFilters = requestedConnectionFilter
  ? requestedConnectionFilter.split(',').map((value) => value.trim()).filter(Boolean)
  : [];
const seeded = new SeededRandom(hashSeed(seed));
const attemptLimitArgument = process.argv.find((argument) => argument.startsWith('--attempt-limit='));
const requestedAttemptLimit = Number.parseInt(attemptLimitArgument?.slice('--attempt-limit='.length) ?? '', 10);
const routeConflictExclusionsBase64Argument = process.argv.find((argument) => (
  argument.startsWith('--route-conflict-exclusions-base64=')
));
const injectedRouteNetworkConflictExclusions = routeConflictExclusionsBase64Argument
  ? JSON.parse(Buffer.from(
      routeConflictExclusionsBase64Argument.slice(
        '--route-conflict-exclusions-base64='.length,
      ),
      'base64',
    ).toString('utf8'))
  : null;
const generator = new DungeonGenerator({
  random: () => seeded.next(),
  difficulty: 1,
  augmentationProfileId: 'industrial-supplement-preview-v4',
  augmentationSeed: seed,
  basePlanHash: `v1:${seed}:depth:1:revolvingFusillade`,
  allowInvalidAugmentationPreview: process.argv.includes('--playable-alpha')
    || process.argv.includes('--failed-rooms-only'),
  augmentationRealizationAttemptLimit: Number.isFinite(requestedAttemptLimit)
    ? requestedAttemptLimit
    : undefined,
});
if (Array.isArray(injectedRouteNetworkConflictExclusions)) {
  generator.augmentationRouteNetworkConflictExclusions =
    injectedRouteNetworkConflictExclusions;
}
if (process.argv.includes('--stop-on-first-rejected-room-connectivity')) {
  const validatePlatformability = generator._validatePlatformability.bind(generator);
  generator._validatePlatformability = (input = {}) => {
    const validation = validatePlatformability(input);
    const failedRoomChecks = (
      validation?.details?.supplementRoomConnectivityChecks ?? []
    ).filter(({ accepted }) => accepted !== true);
    if (failedRoomChecks.length > 0) {
      const roomById = new Map((input.rooms ?? []).map((room) => [String(room.id), room]));
      const floorByKey = new Map((input.floorTiles ?? []).map((floor) => [
        generator._getFloorTileGraphKey(floor),
        floor,
      ]));
      const diagnosticBarrierZones = [
        ...(input.segmentBarrierZones ?? input.solidZones ?? []),
      ].filter((zone, index, zones) => (
        zone?.position
          && zones.findIndex((candidate) => candidate?.id === zone?.id) === index
      ));
      console.log(JSON.stringify({
        accepted: validation.accepted === true,
        errors: validation.errors ?? [],
        failedRoomChecks: failedRoomChecks.map((check) => {
          const room = roomById.get(String(check.roomId)) ?? null;
          const disconnectedFloorKeys = new Set([
            ...(check.locallyUnreachableRoomFloorKeys ?? []),
            ...(check.locallyNonReturnableRoomFloorKeys ?? []),
          ].map(String));
          const disconnectedFloors = [...disconnectedFloorKeys]
            .map((floorKey) => floorByKey.get(floorKey) ?? null)
            .filter(Boolean);
          const frontierEdges = disconnectedFloors.flatMap((floor) => (
            (input.floorTiles ?? [])
              .filter((candidate) => (
                String(candidate.roomId ?? '') === String(floor.roomId ?? '')
                  && Math.abs(Number(candidate.x) - Number(floor.x))
                    + Math.abs(Number(candidate.z) - Number(floor.z)) === 1
                  && !disconnectedFloorKeys.has(generator._getFloorTileGraphKey(candidate))
              ))
              .map((candidate) => ({
                fromFloorKey: generator._getFloorTileGraphKey(floor),
                toFloorKey: generator._getFloorTileGraphKey(candidate),
                forwardAction: generator._getTraversalActionBetweenFloorTiles(
                  floor,
                  candidate,
                ),
                reverseAction: generator._getTraversalActionBetweenFloorTiles(
                  candidate,
                  floor,
                ),
                forwardBlockingZoneIds: diagnosticBarrierZones
                  .filter((zone) => generator._doesFloorTraversalSegmentIntersectZone(
                    floor,
                    candidate,
                    zone,
                    0.42,
                  ))
                  .map(({ id }) => id),
                reverseBlockingZoneIds: diagnosticBarrierZones
                  .filter((zone) => generator._doesFloorTraversalSegmentIntersectZone(
                    candidate,
                    floor,
                    zone,
                    0.42,
                  ))
                  .map(({ id }) => id),
              }))
          ));
          return {
            ...check,
            outsideDeclaredRoomFloors: (check.outsideDeclaredRoomFloorKeys ?? [])
              .map((floorKey) => floorByKey.get(String(floorKey)) ?? null)
              .filter(Boolean),
            disconnectedFloors,
            frontierEdges,
            augmentationTransfers: room?.augmentationTransfers ?? [],
            blueprintId: room?.augmentationBlueprintId ?? null,
            moduleTemplateId: room?.augmentationModuleTemplateId ?? null,
            placement: room ? {
              x: room.x,
              y: room.baseElevation ?? 0,
              z: room.z,
              rotationQuarterTurns: room.augmentationRotationQuarterTurns ?? 0,
            } : null,
          };
        }),
      }, null, 2));
      process.exit(0);
    }
    return validation;
  };
}
if (process.argv.includes('--stop-on-first-rejected-drop-space')
  || process.argv.includes('--stop-on-first-drop-space-check')) {
  const validatePlatformability = generator._validatePlatformability.bind(generator);
  generator._validatePlatformability = (input = {}) => {
    const validation = validatePlatformability(input);
    const dropSpaceChecks = validation?.details?.dropSpaceChecks ?? [];
    const failedDropSpaceChecks = dropSpaceChecks.filter(({
      lowerReachable,
      canExit,
      everyLowerTileCanExit,
    }) => (
      lowerReachable !== true
        || canExit !== true
        || everyLowerTileCanExit !== true
    ));
    const barrierAwareDropSpaceChecks = dropSpaceChecks.filter((check) => (
      Object.hasOwn(check, 'egressBlockingEdges')
        || Object.hasOwn(check, 'egressBlockingZones')
        || Object.hasOwn(check, 'egressBlockingZoneIds')
    ));
    const reportedDropSpaceChecks = failedDropSpaceChecks.length > 0
      ? failedDropSpaceChecks
      : process.argv.includes('--stop-on-first-drop-space-check')
        ? barrierAwareDropSpaceChecks
        : [];
    if (reportedDropSpaceChecks.length > 0) {
      const barrierZoneById = new Map((input.segmentBarrierZones ?? []).map((zone) => [
        String(zone?.id ?? zone?.manifestCollisionRecordId ?? ''),
        zone,
      ]));
      console.log(JSON.stringify({
        accepted: validation.accepted === true,
        errors: validation.errors ?? [],
        failedDropSpaceChecks,
        reportedDropSpaceChecks,
        blockingBarrierZones: [...new Set(reportedDropSpaceChecks.flatMap((check) => (
          check.egressBlockingZoneIds ?? []
        )).map(String))].map((id) => {
          const zone = barrierZoneById.get(id) ?? null;
          return zone ? {
            id,
            position: zone.position ?? null,
            halfWidth: zone.halfWidth ?? null,
            halfDepth: zone.halfDepth ?? null,
            verticalHalfHeight: zone.verticalHalfHeight ?? null,
            wallHorizontal: zone.wallHorizontal ?? null,
            wallStart: zone.wallStart ?? null,
            wallEnd: zone.wallEnd ?? null,
            wallOwnerIds: zone.wallOwnerIds ?? null,
            wallOwnerIdsByAxis: zone.wallOwnerIdsByAxis ?? null,
          } : { id, missing: true };
        }),
      }, null, 2));
      process.exit(0);
    }
    return validation;
  };
}
const planningInputSummaryRequested = process.argv.includes('--planning-input-summary');
if (planningInputSummaryRequested) {
  const originalPlanIndustrialDungeonAugmentation =
    generator._planIndustrialDungeonAugmentation.bind(generator);
  let planningInvocation = 0;
  generator._planIndustrialDungeonAugmentation = (planningInput) => {
    const activeProfileId = generator.committedAugmentationIdentity?.profileId
      ?? generator.augmentationProfileId;
    if (!activeProfileId && !generator.committedAugmentationIdentity) {
      return originalPlanIndustrialDungeonAugmentation(planningInput);
    }
    planningInvocation += 1;
    const planningSnapshot = planningInput.planningSnapshotOverride
      ?? generator._createIndustrialDungeonAugmentationPlanningSnapshot(planningInput);
    const planningBaseDraft = createIndustrialBaseDraft({
      rooms: planningSnapshot.rooms,
      connectionPlans: planningSnapshot.connectionPlans,
      basePlanHash: generator.basePlanHash,
      tileSize: generator.tileSize,
      difficulty: generator.difficulty,
    });
    const planningHost = createIndustrialAugmentationHost({
      basePlanHash: planningBaseDraft.basePlanHash,
      baseDraft: planningBaseDraft,
      rooms: planningSnapshot.rooms,
      connectionPlans: planningSnapshot.connectionPlans,
      tileSize: generator.tileSize,
    });
    const regions = planningHost.extensionRegions ?? [];
    const grants = regions.flatMap((region) => region.routeNetworkGrants ?? []);
    const serializablePlanningSnapshot = JSON.parse(JSON.stringify(planningSnapshot));
    console.log(JSON.stringify({
      kind: 'planning-input-summary',
      invocation: planningInvocation,
      profileId: activeProfileId,
      augmentationSeed: generator.augmentationSeed ?? null,
      augmentationPlanSeedOverride: generator.committedAugmentationIdentity?.seed
        ?? generator.augmentationPlanSeedOverride
        ?? null,
      basePlanHash: planningBaseDraft.basePlanHash,
      planningSnapshotHash: hashCanonicalValue(serializablePlanningSnapshot, {
        namespace: 'debug-industrial-planning-snapshot/v1',
      }),
      baseDraftHash: hashCanonicalValue(planningBaseDraft, {
        namespace: 'debug-industrial-base-draft/v1',
      }),
      hostRegionHash: hashCanonicalValue(regions, {
        namespace: 'debug-industrial-host-regions/v1',
      }),
      grantHash: hashCanonicalValue(grants, {
        namespace: 'debug-industrial-route-grants/v1',
      }),
      reservationHash: hashCanonicalValue(regions.map((region) => ({
        id: region.id,
        protectedVolumes: region.routeNetworkPlacementProtectedVolumes
          ?? region.protectedVolumes
          ?? [],
      })), {
        namespace: 'debug-industrial-route-reservations/v1',
      }),
      roomCount: planningSnapshot.rooms.length,
      connectionPlanCount: planningSnapshot.connectionPlans.length,
      roomHashes: Object.fromEntries(serializablePlanningSnapshot.rooms.map((room) => [
        room.id,
        hashCanonicalValue(room, { namespace: 'debug-industrial-planning-room/v1' }),
      ])),
      connectionPlanHashes: Object.fromEntries(
        serializablePlanningSnapshot.connectionPlans.map((plan) => [
          plan.id,
          hashCanonicalValue(plan, {
            namespace: 'debug-industrial-planning-connection/v1',
          }),
        ]),
      ),
      ...(process.argv.includes('--planning-input-details') ? {
        rooms: planningSnapshot.rooms.map((room) => ({
          id: room.id,
          x: room.x,
          z: room.z,
          width: room.width,
          depth: room.depth,
          baseElevation: room.baseElevation,
          plannedBaseElevation: room.plannedBaseElevation,
          exitSockets: room.exitSockets,
        })),
        connectionPlans: planningSnapshot.connectionPlans.map((plan) => ({
          id: plan.id,
          logicalConnectionId: plan.logicalConnectionId,
          fromRoomId: plan.fromRoomId,
          toRoomId: plan.toRoomId,
          sourceElevation: plan.sourceElevation,
          destinationElevation: plan.destinationElevation,
          fromSocket: plan.fromSocket,
          toSocket: plan.toSocket,
          fullPath: plan.fullPath,
          bridgePath: plan.bridgePath,
          connectorFootprintTiles: plan.connectorFootprintTiles,
        })),
      } : {}),
      grants: grants.map((grant) => ({
        id: grant.id,
        required: grant.required,
        endpointIds: (grant.endpointSockets ?? []).map(({ id }) => id),
        endpointDistancesMeters: (grant.endpointSockets ?? [])
          .map(({ distanceMeters }) => Number(distanceMeters)),
      })),
    }));
    if (process.argv.includes('--stop-before-planning')) process.exit(0);
    return originalPlanIndustrialDungeonAugmentation(planningInput);
  };
}
const texture = new THREE.Texture();
generator.textureCache.set('debug-augmentation-attempt', texture);
generator._loadRuinTexture = () => texture;
let capturedPreSurfacePlans = [];
let capturedPostSurfaceFloorTiles = [];
let capturedBoundaryWallRuns = [];
let capturedWallRunBindingSummary = [];
let capturedEncounterPlacementSummary = [];
if (process.argv.includes('--wall-run-count')) {
  const collectBoundaryWallRuns = generator._collectBoundaryWallRuns.bind(generator);
  generator._collectBoundaryWallRuns = (...args) => {
    capturedBoundaryWallRuns = collectBoundaryWallRuns(...args);
    return capturedBoundaryWallRuns;
  };
}
if (process.argv.includes('--stop-on-drop-space-wall-runs')) {
  let capturedDropSpaceWallPlanningResult = null;
  const planIndustrialDungeonAugmentation =
    generator._planIndustrialDungeonAugmentation.bind(generator);
  generator._planIndustrialDungeonAugmentation = (...args) => {
    const result = planIndustrialDungeonAugmentation(...args);
    if (result?.result?.overlayPlan) capturedDropSpaceWallPlanningResult = result;
    return result;
  };
  const collectBoundaryWallRuns = generator._collectBoundaryWallRuns.bind(generator);
  const minimumConflictCount = Number.parseInt(
    process.argv.find((argument) => (
      argument.startsWith('--drop-space-wall-runs-min-conflicts=')
    ))?.slice('--drop-space-wall-runs-min-conflicts='.length) ?? '0',
    10,
  ) || 0;
  generator._collectBoundaryWallRuns = (...args) => {
    const runs = collectBoundaryWallRuns(...args);
    const rooms = args[2] ?? [];
    const authoritativeFloors = args[4];
    const dropSpace = rooms.find(({ dropSpace }) => dropSpace)?.dropSpace ?? null;
    if (dropSpace
      && Array.isArray(authoritativeFloors)
      && (generator.augmentationRouteNetworkConflictExclusions?.length ?? 0)
        >= minimumConflictCount) {
      const floorByKey = new Map(authoritativeFloors.map((floor) => [
        generator._getFloorTileGraphKey(floor),
        floor,
      ]));
      const floorsByKey = new Map();
      for (const floor of authoritativeFloors) {
        const floorKey = generator._getFloorTileGraphKey(floor);
        const matchingFloors = floorsByKey.get(floorKey) ?? [];
        matchingFloors.push(floor);
        floorsByKey.set(floorKey, matchingFloors);
      }
      const shelves = (dropSpace.returnShelfFloorKeys ?? [])
        .map((floorKey) => floorByKey.get(String(floorKey)))
        .filter(Boolean);
      const exits = (dropSpace.exitFloorKeys ?? [])
        .map((floorKey) => floorByKey.get(String(floorKey)))
        .filter(Boolean);
      const edges = shelves.flatMap((shelf) => exits.flatMap((exit) => {
        const dx = Number(exit.x) - Number(shelf.x);
        const dz = Number(exit.z) - Number(shelf.z);
        if (Math.abs(dx) + Math.abs(dz) !== 1) return [];
        const horizontal = dz !== 0;
        const line = horizontal
          ? Number(shelf.z) + Math.sign(dz) * 0.5
          : Number(shelf.x) + Math.sign(dx) * 0.5;
        const axis = horizontal ? Number(shelf.x) : Number(shelf.z);
        const outwardAction = generator._getTraversalActionBetweenFloorTiles(shelf, exit);
        const returnAction = generator._getTraversalActionBetweenFloorTiles(exit, shelf);
        const edgeKey = `${horizontal ? 'h' : 'v'}:${line.toFixed(3)}:${axis}`;
        return [{
          edgeKey,
          shelf,
          exit,
          outwardAction,
          returnAction,
          authoredTraversalWallOpeningAccepted:
            outwardAction === 'jump' && returnAction === 'drop',
          wallRuns: runs.filter((run) => (
            run.horizontal === horizontal
              && Math.abs(Number(run.line) - line) <= 0.001
              && Number(run.start) <= axis
              && Number(run.end) >= axis
          )),
        }];
      }));
      const summarizeFloor = (floor) => floor ? {
        floorKey: generator._getFloorTileGraphKey(floor),
        x: floor.x,
        z: floor.z,
        elevation: floor.elevation,
        roomId: floor.roomId ?? null,
        surface: floor.surface ?? null,
        ledgeEdges: floor.ledgeEdges ?? [],
        traversalLinks: floor.traversalLinks ?? [],
        augmentationOwnerId: floor.augmentationOwnerId ?? null,
        physicalFloorOwnerIds: floor.physicalFloorOwnerIds ?? [],
      } : null;
      const summarizeDeclaredFloorKeys = (floorKeys) => (floorKeys ?? []).map((floorKey) => {
        const matchingFloors = floorsByKey.get(String(floorKey)) ?? [];
        return {
          floorKey: String(floorKey),
          resolved: matchingFloors.length > 0,
          duplicateCount: matchingFloors.length,
          selectedByCollectorLastWrite: summarizeFloor(floorByKey.get(String(floorKey))),
          matchingFloors: matchingFloors.map(summarizeFloor),
        };
      });
      const overlayPlan = capturedDropSpaceWallPlanningResult?.result?.overlayPlan ?? null;
      const targetSegment = (overlayPlan?.segments ?? []).find(({ id }) => (
        String(id).includes('coverage-traproom_conveyorroom')
          && String(id).includes(':segment:4:')
      )) ?? null;
      const ownerIdsForFloor = (floor) => [...new Set([
        ...(floor?.physicalFloorOwnerIds ?? []),
        floor?.augmentationOwnerId,
        floor?.augmentationSegmentId,
        floor?.signedConnectorFloorOwnerId,
        floor?.connectionId,
        floor?.connectorId,
        floor?.roomId,
      ].filter(Boolean).map(String))];
      const targetSegmentId = String(targetSegment?.id ?? '');
      const targetSegmentShellFloors = targetSegmentId
        ? authoritativeFloors.filter((floor) => (
            Math.abs(Number(floor.elevation ?? 0) - 14) <= 0.001
              && ownerIdsForFloor(floor).includes(targetSegmentId)
          )).map((floor) => ({
            ...summarizeFloor(floor),
            ownerIds: ownerIdsForFloor(floor),
            walkabilityIntent: floor.walkabilityIntent ?? null,
            v4SupplementalOpenRetainingWallEdges:
              floor.v4SupplementalOpenRetainingWallEdges ?? [],
            openRetainingWallEdges: floor.openRetainingWallEdges ?? [],
          }))
        : [];
      const exactFacadeId = 'aerialBoundary_h:0:1:63.5:14:16:14.00:28.00';
      console.log(JSON.stringify({
        augmentationPlanHash: overlayPlan?.augmentationPlanHash ?? null,
        acceptedParentPlanningSnapshotOverride:
          generator._augmentationReplayPlanningSnapshotOverride != null,
        targetSegment: targetSegment ? {
          id: targetSegment.id,
          path: targetSegment.path,
          occupiedVolumes: targetSegment.occupiedVolumes,
        } : null,
        dropSpaceId: dropSpace.id,
        dropSpace,
        routeNetworkConflictExclusions:
          generator.augmentationRouteNetworkConflictExclusions ?? [],
        returnShelfFloorKeys: dropSpace.returnShelfFloorKeys,
        exitFloorKeys: dropSpace.exitFloorKeys,
        resolvedReturnShelfFloors:
          summarizeDeclaredFloorKeys(dropSpace.returnShelfFloorKeys),
        resolvedExitFloors: summarizeDeclaredFloorKeys(dropSpace.exitFloorKeys),
        authoritativeFloorCount: authoritativeFloors.length,
        authoredTraversalWallOpeningKeys: [...new Set(edges
          .filter(({ authoredTraversalWallOpeningAccepted }) => (
            authoredTraversalWallOpeningAccepted
          ))
          .map(({ edgeKey }) => edgeKey))].sort(),
        exactFacadeId,
        exactFacade: runs.find(({ facadeId }) => facadeId === exactFacadeId) ?? null,
        exactFacadeLineRuns: runs.filter((run) => (
          run.horizontal === true
            && Math.abs(Number(run.line) - 63.5) <= 0.001
            && Number(run.start) <= 16
            && Number(run.end) >= 15
        )),
        targetSegmentShellFloors,
        targetSegmentWallRuns: targetSegmentId
          ? runs.filter((run) => (run.ownerIds ?? []).map(String).includes(targetSegmentId))
          : [],
        edges,
      }, null, 2));
      process.exit(0);
    }
    return runs;
  };
}
if (process.argv.includes('--wall-run-binding-summary')) {
  const bindStructuralFrameRealizations =
    generator._bindDungeonSupplementStructuralFrameRealizations.bind(generator);
  generator._bindDungeonSupplementStructuralFrameRealizations = (
    connectionPlans,
    wallRuns,
    ...remainingArguments
  ) => {
    capturedWallRunBindingSummary = connectionPlans
      .filter((plan) => requestedConnectionFilters.length === 0
        || requestedConnectionFilters.some((filter) => String(plan.id).includes(filter)))
      .flatMap((plan) => (plan.structuralFrameRealizations ?? []).map((realization) => {
        const point = realization.boundarySocketGridPoint
          ?? realization.gridPoint
          ?? { x: 0, z: 0 };
        const direction = realization.direction ?? { x: 0, z: 1 };
        const pathRunsHorizontally = Math.abs(Number(direction.x ?? 0)) === 1;
        const axis = pathRunsHorizontally ? Number(point.x) : Number(point.z);
        const lateral = pathRunsHorizontally ? Number(point.z) : Number(point.x);
        const nearbyRuns = wallRuns
          .filter((run) => {
            const thresholdCandidate = Boolean(run.horizontal) === !pathRunsHorizontally
              && Math.abs(Number(run.line) - axis) <= 2.01
              && Number(run.end) >= lateral - 2.01
              && Number(run.start) <= lateral + 2.01;
            const galleryCandidate = Boolean(run.horizontal) === pathRunsHorizontally
              && Math.abs(Number(run.line) - lateral) <= 2.01
              && axis >= Number(run.start) - 0.51
              && axis <= Number(run.end) + 0.51;
            return thresholdCandidate || galleryCandidate;
          })
          .map((run) => ({
            facadeId: run.facadeId,
            ownerId: run.ownerId ?? null,
            ownerIds: run.ownerIds ?? [],
            ownerAtAxis: run.ownerByAxis?.[Math.round(
              Boolean(run.horizontal) === pathRunsHorizontally ? axis : lateral,
            )] ?? null,
            ownerByAxis: run.ownerByAxis ?? null,
            ownerIdsByAxis: run.ownerIdsByAxis ?? null,
            horizontal: run.horizontal,
            line: run.line,
            dx: run.dx,
            dz: run.dz,
            thresholdSignedDelta: Number(run.line) - axis,
            galleryLateralDelta: Number(run.line) - lateral,
            start: run.start,
            end: run.end,
            wallBottomY: run.wallBottomY,
            wallTopY: run.wallTopY,
          }));
        const frontierEdges = frontierEdgesFor(check.locallyUnreachableRoomFloorKeys);
        const returnFrontierEdges = frontierEdgesFor(
          check.locallyNonReturnableRoomFloorKeys,
          { reverse: true },
        );
        return {
          planId: plan.id,
          augmentationOperationId: plan.augmentationOperationId ?? null,
          routeNetworkGrantId: plan.routeNetworkGrantId ?? null,
          fromRoomId: plan.fromRoomId ?? null,
          toRoomId: plan.toRoomId ?? null,
          fromAttachmentSocketId: plan.fromSocket?.attachmentSocketId ?? null,
          toAttachmentSocketId: plan.toSocket?.attachmentSocketId ?? null,
          boundarySocket: Object.fromEntries(Object.entries(
            realization.boundaryEndpoint === 'to' ? plan.toSocket : plan.fromSocket,
          ).filter(([key]) => [
            'id',
            'x',
            'z',
            'elevation',
            'facingX',
            'facingZ',
            'roomId',
            'parentRouteId',
            'authoritativeSeamParentOwnerId',
            'authoritativeSeamNodeId',
            'progressionRoomId',
            'connectorJunctionProxyId',
          ].includes(key))),
          realizationId: realization.id,
          attachmentSocketId: realization.attachmentSocketId,
          boundaryEndpoint: realization.boundaryEndpoint,
          gridPoint: point,
          direction,
          floorElevation: realization.floorElevation,
          clearHeightMeters: realization.clearHeightMeters,
          frameHeightMeters: realization.frameHeightMeters,
          finalWidthMeters: realization.finalWidthMeters,
          nearbyRuns,
        };
      }));
    return bindStructuralFrameRealizations(
      connectionPlans,
      wallRuns,
      ...remainingArguments,
    );
  };
}
if (process.argv.includes('--encounter-placement-summary')) {
  const createEncounterDefinitions =
    generator._createDungeonSupplementEncounterDefinitions.bind(generator);
  generator._createDungeonSupplementEncounterDefinitions = (
    rooms,
    floorTiles,
    solidZones,
  ) => {
    const blockingPlatformTops = generator._createBlockingPlatformColumnMap(floorTiles);
    capturedEncounterPlacementSummary = rooms
      .filter((room) => (room.augmentationAnchors ?? []).some(({ kind }) => (
        kind === 'spatial-role'
      )))
      .map((room) => ({
        roomId: room.id,
        blueprintId: room.augmentationBlueprintId ?? null,
        grammarId: room.augmentationGrammarId ?? room.archetypeId ?? null,
        anchors: (room.augmentationAnchors ?? [])
          .filter(({ kind }) => kind === 'spatial-role')
          .map((anchor) => {
            const supportFloorCellId = anchor.authoritativePlacement?.supportFloorCellId ?? null;
            const floor = floorTiles.find((candidate) => (
              String(candidate.augmentationFloorCellId
                ?? candidate.augmentationTransferCellId
                ?? '') === String(supportFloorCellId ?? '')
            )) ?? null;
            return {
              id: anchor.id,
              localAnchorId: anchor.localAnchorId ?? null,
              sourceFeatureId: anchor.sourceFeatureId ?? null,
              supportFloorCellId,
              localTile: anchor.localTile ?? null,
              position: anchor.position ?? null,
              floor: floor ? {
                x: floor.x,
                z: floor.z,
                elevation: floor.elevation,
                roomId: floor.roomId ?? null,
                walkabilityIntent: floor.walkabilityIntent ?? null,
                noEnemySpawn: floor.noEnemySpawn === true,
                blockedBySolid: generator._isFloorTileBlockedBySolidZone(floor, solidZones),
                blockedByGeneratedPlatform:
                  generator._isFloorTileBlockedByGeneratedPlatform(
                    floor,
                    blockingPlatformTops,
                  ),
              } : null,
            };
          }),
      }))
      .filter((room) => room.anchors.some(({ floor }) => (
        !floor
          || floor.walkabilityIntent === 'support-only'
          || floor.noEnemySpawn
          || floor.blockedBySolid
          || floor.blockedByGeneratedPlatform
      )));
    return createEncounterDefinitions(rooms, floorTiles, solidZones);
  };
}
if (process.argv.includes('--failed-physical')) {
  const applyConnectorTraversalSurfaces =
    generator._applyConnectorTraversalSurfaces.bind(generator);
  generator._applyConnectorTraversalSurfaces = (tiles, connectionPlans, floorTiles) => {
    capturedPreSurfacePlans = connectionPlans;
    const result = applyConnectorTraversalSurfaces(tiles, connectionPlans, floorTiles);
    capturedPostSurfaceFloorTiles = result;
    return result;
  };
}

if (process.argv.includes('--playable-alpha')
  || process.argv.includes('--generate')
  || process.argv.includes('--failed-rooms-only')
  // This flag describes the concise output of the complete replay-aware
  // generator. Historically it was silently ignored unless callers also
  // supplied --generate, which made an apparent attempt-one probe fall
  // through to the direct _generateOnce() diagnostic below.
  || process.argv.includes('--release-errors-only')) {
  const dungeon = generator.generate();
  if (process.argv.includes('--failed-rooms-only')) {
    const floorByGraphKey = new Map((dungeon.floorTiles ?? []).map((floor) => [
      generator._getFloorTileGraphKey(floor),
      floor,
    ]));
    const supplementalRoomById = new Map((dungeon.rooms ?? [])
      .filter(({ isDungeonSupplement }) => isDungeonSupplement)
      .map((room) => [String(room.id), room]));
    const diagnosticBarrierZones = [
      ...(dungeon.solidZones ?? []),
      ...(dungeon.aerialBoundaryZones ?? []),
    ].filter((zone, index, zones) => (
      zone?.position && zones.findIndex((candidate) => candidate?.id === zone?.id) === index
    ));
    const frontierEdgesFor = (floorKeys, { reverse = false } = {}) => {
      const failedKeySet = new Set(floorKeys ?? []);
      return [...failedKeySet].flatMap((floorKey) => {
        const floor = floorByGraphKey.get(floorKey);
        if (!floor) return [];
        return (dungeon.floorTiles ?? [])
          .filter((candidate) => candidate.roomId === floor.roomId)
          .filter((candidate) => (
            Math.abs(candidate.x - floor.x) + Math.abs(candidate.z - floor.z) === 1
          ))
          .filter((candidate) => !failedKeySet.has(generator._getFloorTileGraphKey(candidate)))
          .map((candidate) => {
            const from = reverse ? floor : candidate;
            const to = reverse ? candidate : floor;
            return {
              from: generator._getFloorTileGraphKey(from),
              to: generator._getFloorTileGraphKey(to),
              action: generator._getTraversalActionBetweenFloorTiles(from, to),
              blockers: diagnosticBarrierZones
                .filter((zone) => generator._doesFloorTraversalSegmentIntersectZone(
                  from,
                  to,
                  zone,
                  0.42,
                ))
                .map(({ id, roomId, obstacleKind }) => ({ id, roomId, obstacleKind })),
            };
          });
      }).slice(0, 16);
    };
    const failedRooms = (dungeon.progression?.validation?.platformability
      ?.supplementRoomConnectivityChecks
      ?? dungeon.augmentationDiagnostics?.rejectedOverlay?.validation
      ?.platformability?.supplementRoomConnectivityChecks
      ?? dungeon.augmentationDiagnostics?.rejectedOverlay?.platformability
        ?.supplementRoomConnectivityChecks
      ?? []).filter(({ accepted }) => accepted !== true).map((check) => {
        const room = supplementalRoomById.get(String(check.roomId)) ?? null;
        const frontierEdges = frontierEdgesFor(
          check.locallyUnreachableRoomFloorKeys ?? [],
        );
        const returnFrontierEdges = frontierEdgesFor(
          check.locallyNonReturnableRoomFloorKeys ?? [],
          { reverse: true },
        );
        return {
          roomId: check.roomId,
          blueprintId: room?.augmentationBlueprintId ?? null,
          moduleTemplateId: room?.augmentationModuleTemplateId ?? null,
          center: room ? { x: room.x, z: room.z, y: room.baseElevation ?? 0 } : null,
          width: room?.width ?? null,
          depth: room?.depth ?? null,
          rotationQuarterTurns: room?.augmentationRotationQuarterTurns ?? null,
          localApproachChecks: check.localApproachChecks ?? [],
          locallyUnreachableRoomFloorKeys: check.locallyUnreachableRoomFloorKeys ?? [],
          locallyNonReturnableRoomFloorKeys: check.locallyNonReturnableRoomFloorKeys ?? [],
          orphanFloorKeys: check.orphanFloorKeys ?? [],
          blockingZoneIds: [...new Set([
            ...frontierEdges,
            ...returnFrontierEdges,
          ].flatMap(({ blockers }) => blockers.map(({ id }) => id)))].sort(),
          frontierEdges: frontierEdges.slice(0, 4),
          returnFrontierEdges: returnFrontierEdges.slice(0, 4),
        };
      });
    const platformability = dungeon.progression?.validation?.platformability ?? {};
    const failedConnectors = (platformability.supplementConnectivityChecks ?? [])
      .filter(({ accepted }) => accepted !== true)
      .map((check) => ({
        connectionId: check.connectionId,
        locallyUnreachableTraversalFloorKeys: check.locallyUnreachableTraversalFloorKeys ?? [],
        locallyNonReturnableTraversalFloorKeys:
          check.locallyNonReturnableTraversalFloorKeys ?? [],
        finalCollisionSpineCheck: check.finalCollisionSpineCheck ?? null,
        centerlineChecks: check.centerlineChecks ?? [],
        verticalContractChecks: check.verticalContractChecks ?? [],
      }));
    const encounterOverlaps = (dungeon.encounters ?? []).flatMap((encounter) => (
      (encounter.spawnPoints ?? []).flatMap((point, spawnIndex) => {
        const blockingZones = diagnosticBarrierZones.filter((zone) => (
          generator._isPositionInsideZone(point, zone)
        ));
        return blockingZones.length > 0 ? [{
          encounterId: encounter.id,
          roomId: encounter.roomId,
          spawnIndex,
          point: { x: point.x, y: point.y, z: point.z },
          localAnchorId: point.localAnchorId ?? point.anchorId ?? null,
          supportFloorCellId: point.supportFloorCellId ?? point.floorCellId ?? null,
          blockingZones: blockingZones.map((zone) => ({
            id: zone.id,
            roomId: zone.roomId,
            center: {
              x: zone.position.x,
              y: zone.position.y,
              z: zone.position.z,
            },
            size: {
              x: Number(zone.halfWidth ?? 0) * 2,
              y: Number(zone.verticalHalfHeight ?? 0) * 2,
              z: Number(zone.halfDepth ?? 0) * 2,
            },
          })),
        }] : [];
      })
    ));
    console.log(JSON.stringify({
      seed,
      status: dungeon.augmentationStatus,
      replayErrors: dungeon.augmentationReplayDiagnostics?.errors ?? [],
      validationErrors: dungeon.progression?.validation?.errors ?? [],
      failedRooms,
      failedConnectors,
      dropSpaceChecks: platformability.dropSpaceChecks ?? [],
      physicalProgression: dungeon.progression?.validation?.physicalProgression ?? null,
      encounterOverlaps,
    }, null, 2));
    generator._disposeGeneratedDungeonCandidate(dungeon);
    texture.dispose();
    process.exit(0);
  }
  if (process.argv.includes('--connector-entrance-failures')) {
    const attempts = dungeon.augmentationDiagnostics?.rejectedOverlay?.attempts ?? [];
    console.log(JSON.stringify({
      seed,
      status: dungeon.augmentationStatus,
      failures: attempts.flatMap((attempt) => (
        attempt.diagnostics?.connectorEntrances?.checks ?? []
      )).filter(({ accepted }) => accepted !== true),
    }, null, 2));
    generator._disposeGeneratedDungeonCandidate(dungeon);
    texture.dispose();
    process.exit(0);
  }
  if (process.argv.includes('--failed-physical')) {
    console.log(JSON.stringify({
      status: dungeon.augmentationStatus,
      rejectedErrors: dungeon.augmentationDiagnostics?.rejectedOverlay?.errors ?? [],
      plans: capturedPreSurfacePlans.filter(({ id }) => String(id).includes(
        ':routenetwork:1:segment:5:',
      )).map(({ id, fromRoomId, toRoomId, sourceElevation, destinationElevation,
        fromSocket, toSocket, fullPath, augmentationAuthoritativePath }) => ({
        id, fromRoomId, toRoomId, sourceElevation, destinationElevation,
        fromSocket, toSocket, fullPath, augmentationAuthoritativePath,
      })),
      keycardRoom: (dungeon.rooms ?? []).find(({ id }) => id === 'keycardRoom') ?? null,
    }, null, 2));
    generator._disposeGeneratedDungeonCandidate(dungeon);
    texture.dispose();
    process.exit(0);
  }
  if (process.argv.includes('--release-errors-only')) {
    const overlayPlan = dungeon.augmentationOverlayPlan ?? null;
    const overlayNodes = Array.isArray(overlayPlan?.nodes) ? overlayPlan.nodes : [];
    const overlaySegments = Array.isArray(overlayPlan?.segments) ? overlayPlan.segments : [];
    const routeNetworkOperations = (overlayPlan?.operations ?? [])
      .filter(({ type }) => type === 'routeNetwork');
    const routeNetworkOperationSummaries = routeNetworkOperations.map((operation) => {
      const operationId = String(operation.id ?? '');
      const operationNodes = overlayNodes.filter((node) => String(
        node.operationId ?? node.augmentationOperationId ?? '',
      ) === operationId);
      const operationSegments = overlaySegments.filter((segment) => String(
        segment.operationId ?? segment.augmentationOperationId ?? '',
      ) === operationId);
      const derivedModuleCount = operationNodes.filter(({ kind }) => (
        kind === 'supplementRoom' || kind === 'supplementConnectorJunction'
      )).length;
      const declaredModuleCount = Number(
        operation.substantiveModuleCount ?? operation.moduleCount ?? derivedModuleCount,
      );
      return {
        id: operation.id,
        grantId: operation.grantId ?? operation.routeNetworkGrantId ?? null,
        routeNetworkKind: operation.routeNetworkKind ?? null,
        topologyTemplateId: operation.topologyTemplateId ?? null,
        candidateOrdinal: operation.candidateOrdinal ?? null,
        searchVariant: operation.searchVariant ?? null,
        segmentIds: operationSegments.map(({ id }) => id).sort(),
        counts: {
          operations: 1,
          nodes: operationNodes.length,
          segments: operationSegments.length,
          modules: Number.isFinite(declaredModuleCount)
            ? declaredModuleCount
            : derivedModuleCount,
          derivedModules: derivedModuleCount,
        },
      };
    });
    const routeNetworkCounts = routeNetworkOperationSummaries.reduce((counts, operation) => ({
      operations: counts.operations + operation.counts.operations,
      nodes: counts.nodes + operation.counts.nodes,
      segments: counts.segments + operation.counts.segments,
      modules: counts.modules + operation.counts.modules,
      derivedModules: counts.derivedModules + operation.counts.derivedModules,
    }), {
      operations: 0,
      nodes: 0,
      segments: 0,
      modules: 0,
      derivedModules: 0,
    });
    const routeNetworkConflictExclusions = [
      ...(overlayPlan?.routeNetworkConflictExclusions ?? []),
    ].map((entry) => ({
      grantId: entry.grantId,
      entityKind: entry.entityKind,
      entityId: entry.entityId,
      signature: entry.signature,
      reason: entry.reason,
    })).sort((first, second) => (
      String(first.grantId ?? '').localeCompare(String(second.grantId ?? ''))
        || String(first.entityKind ?? '').localeCompare(String(second.entityKind ?? ''))
        || String(first.entityId ?? '').localeCompare(String(second.entityId ?? ''))
        || String(first.signature ?? '').localeCompare(String(second.signature ?? ''))
        || String(first.reason ?? '').localeCompare(String(second.reason ?? ''))
    ));
    const requestedFloor = process.argv.find((argument) => argument.startsWith('--floor='))
      ?.slice('--floor='.length)
      ?.split(',')
      ?.map(Number) ?? null;
    const requestedConnection = requestedConnectionFilter;
    const requestedEdge = process.argv.find((argument) => (
      argument.startsWith('--edge-blockers=')
    ))?.slice('--edge-blockers='.length).split(',').map(Number) ?? null;
    const requestedEdgeDiagnostics = requestedEdge?.length === 5
      && requestedEdge.every(Number.isFinite)
      ? (() => {
          const [fromX, fromZ, toX, toZ, elevation] = requestedEdge;
          const floors = dungeon.floorTiles ?? [];
          const floorAt = (x, z) => floors.find((floor) => (
            Number(floor.x) === x
              && Number(floor.z) === z
              && Math.abs(Number(floor.elevation ?? 0) - elevation) <= 0.05
          )) ?? null;
          const fromFloor = floorAt(fromX, fromZ);
          const toFloor = floorAt(toX, toZ);
          const zones = [
            ...(dungeon.solidZones ?? []),
            ...(dungeon.aerialBoundaryZones ?? []),
          ].filter((zone, index, allZones) => (
            zone?.position && allZones.findIndex((candidate) => candidate?.id === zone?.id) === index
          ));
          const blockers = (first, second) => !first || !second ? [] : zones
            .filter((zone) => generator._doesFloorTraversalSegmentIntersectZone(
              first,
              second,
              zone,
              0.42,
            ))
            .map((zone) => ({
              id: zone.id,
              roomId: zone.roomId ?? null,
              operationId: zone.operationId ?? null,
              obstacleKind: zone.obstacleKind ?? null,
              wallFacadeId: zone.wallFacadeId ?? null,
              position: zone.position,
              halfWidth: zone.halfWidth,
              halfDepth: zone.halfDepth,
              verticalHalfHeight: zone.verticalHalfHeight,
              rotationY: zone.rotationY ?? 0,
            }));
          const forwardBlockers = blockers(fromFloor, toFloor);
          const reverseBlockers = blockers(toFloor, fromFloor);
          const facadeIds = new Set([
            ...forwardBlockers,
            ...reverseBlockers,
          ].map(({ wallFacadeId }) => wallFacadeId).filter(Boolean));
          return {
            fromFloor,
            toFloor,
            forwardAction: fromFloor && toFloor
              ? generator._getTraversalActionBetweenFloorTiles(fromFloor, toFloor)
              : null,
            reverseAction: fromFloor && toFloor
              ? generator._getTraversalActionBetweenFloorTiles(toFloor, fromFloor)
              : null,
            forwardBlockers,
            reverseBlockers,
            boundaryWallRuns: (dungeon.augmentationPhysicalShell?.boundaryWallRuns ?? [])
              .filter(({ facadeId }) => facadeIds.has(facadeId)),
          };
        })()
      : null;
    console.log(JSON.stringify({
      seed,
      status: dungeon.augmentationStatus,
      augmentationPlanHash: dungeon.augmentationPlanHash ?? null,
      effectivePlanHash: dungeon.effectivePlanHash ?? null,
      completionMode: dungeon.augmentationOverlayPlan?.completionMode ?? 'complete',
      prunedRouteNetworkGrants:
        dungeon.augmentationOverlayPlan?.prunedRouteNetworkGrants ?? [],
      routeNetworkConflictExclusions,
      routeNetworkCounts,
      routeNetworkOperations: routeNetworkOperationSummaries,
      planningTimeMs: dungeon.augmentationDiagnostics?.planningTimeMs ?? null,
      generatorPhaseTimings:
        dungeon.augmentationDiagnostics?.generatorPhaseTimings ?? null,
      acceptedAsPlayableAlpha: dungeon.augmentationPlayableAlpha?.accepted === true,
      releaseValidationAccepted: dungeon.progression?.validation?.accepted === true,
      dropSpaceChecks: (
        dungeon.progression?.validation?.platformability?.dropSpaceChecks ?? []
      ).map((check) => ({
        id: check.id,
        lowerTileCount: check.lowerTileCount,
        lowerReachable: check.lowerReachable,
        canExit: check.canExit,
        everyLowerTileCanExit: check.everyLowerTileCanExit,
        nonExitLowerFloorKeys: check.nonExitLowerFloorKeys ?? [],
        egressBlockingEdgeCount: check.egressBlockingEdges?.length ?? 0,
        egressBlockingZoneIds: check.egressBlockingZoneIds ?? [],
      })),
      replay: dungeon.augmentationReplayDiagnostics ?? null,
      rejectedAttempts: (
        dungeon.augmentationDiagnostics?.rejectedOverlay?.attempts ?? []
      ).map((attempt) => ({
        realizationAttempt: attempt.realizationAttempt,
        augmentationPlanHash: attempt.augmentationPlanHash,
        status: attempt.status,
        reason: attempt.reason,
        failureCategory: attempt.failureCategory,
        failureCodes: attempt.failureCodes,
        failureCode: attempt.failureCode,
        consumedRandomCallCount: attempt.consumedRandomCallCount,
        expectedEarlyAugmentationRejection: attempt.expectedEarlyAugmentationRejection,
        diagnosticReason: attempt.diagnostics?.reason,
        diagnosticErrors: attempt.diagnostics?.errors,
        diagnostics: attempt.diagnostics,
      })),
      errorCount: dungeon.progression?.validation?.errors?.length ?? 0,
      errors: dungeon.progression?.validation?.errors ?? [],
      floorTileCount: dungeon.floorTiles?.length ?? 0,
      physicalSupplementPlanCount: (dungeon.connectionPlans ?? []).filter((plan) => (
        plan.isDungeonSupplement && !plan.isSupplementGraphConnection
      )).length,
      boundaryWallRunCount: capturedBoundaryWallRuns.length,
      ...(requestedEdgeDiagnostics ? { requestedEdgeDiagnostics } : {}),
      ...(process.argv.includes('--wall-run-binding-summary') ? {
        wallRunBindingSummary: capturedWallRunBindingSummary,
      } : {}),
      ...(process.argv.includes('--encounter-placement-summary') ? {
        encounterPlacementSummary: capturedEncounterPlacementSummary,
      } : {}),
      ...(requestedFloor?.length === 2 && requestedFloor.every(Number.isFinite) ? {
        requestedFloors: (dungeon.floorTiles ?? []).filter(({ x, z }) => (
          Number(x) === requestedFloor[0] && Number(z) === requestedFloor[1]
        )),
      } : {}),
      ...(requestedConnection ? {
        requestedOverlaySegments: (dungeon.augmentationOverlayPlan?.segments ?? [])
          .filter(({ id }) => requestedConnectionFilters.some((filter) => (
            String(id).includes(filter)
          ))),
        requestedConnections: (dungeon.connectionPlans ?? []).filter(({ id }) => (
          requestedConnectionFilters.some((filter) => String(id).includes(filter))
        )).map(({ id, fromRoomId, toRoomId, fromSocket, toSocket, fullPath, bridgePath,
          authoritativeSocketSeams }) => ({
          id,
          fromRoomId,
          toRoomId,
          fromSocket,
          toSocket,
          fullPath,
          bridgePath,
          authoritativeSocketSeams,
        })),
      } : {}),
    }, null, 2));
    generator._disposeGeneratedDungeonCandidate(dungeon);
    texture.dispose();
    process.exit(0);
  }
  const smoke = createPlayableAlphaSmokeSummary(dungeon);
  const geometryIntegrity = createGeometryIntegritySummary(generator, dungeon);
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
    affectedTransferPlacements: {
      treatmentControlRamp: (dungeon.floorTiles ?? [])
        .filter(({ augmentationTransferId }) => String(augmentationTransferId ?? '').includes('tc-ramp'))
        .sort((left, right) => (
          Number(left.elevation ?? 0) - Number(right.elevation ?? 0)
        ))
        .map((floor) => ({
          x: floor.x,
          z: floor.z,
          elevation: floor.elevation,
          rampStartElevation: floor.rampStartElevation,
          rampEndElevation: floor.rampEndElevation,
          rampDirectionX: floor.rampDirectionX,
          rampDirectionZ: floor.rampDirectionZ,
        })),
      supplementalLadders: (dungeon.ladders ?? [])
        .filter(({ augmentationTransfer }) => augmentationTransfer === true)
        .map((ladder) => {
          const owner = [...(dungeon.rooms ?? []), ...(dungeon.connectorJunctionProxies ?? [])]
            .find(({ id }) => String(id) === String(ladder.connectionId));
          const wallPoint = ladder.wallFaceGridPoint ?? ladder.apertureGridPoint;
          return {
            id: ladder.id,
            owner: owner ? {
              id: owner.id,
              blueprintId: owner.augmentationBlueprintId,
              baseElevation: owner.baseElevation,
              transfer: (owner.augmentationTransfers ?? []).find(({ id }) => id === ladder.id),
            } : null,
            planeCenter: ladder.planeCenter,
            planeNormal: ladder.planeNormal,
            bottomY: ladder.bottomY,
            topY: ladder.topY,
            bottomExit: ladder.bottomExit,
            topExit: ladder.topExit,
            wallFaceGridPoint: wallPoint,
            bottomApproachFloorKey: ladder.bottomApproachFloorKey,
            placementSource: ladder.placementSource,
            nearbyOwnedFloors: (dungeon.floorTiles ?? [])
              .filter(({ roomId, x, z }) => (
                String(roomId ?? '') === String(owner?.id ?? '')
                  && Math.abs(Number(x) - Number(wallPoint?.x)) <= 1
                  && Math.abs(Number(z) - Number(wallPoint?.z)) <= 1
              ))
              .map(({ x, z, elevation, floorKey, augmentationFloorCellId, surface }) => ({
                x, z, elevation, floorKey, augmentationFloorCellId, surface,
              })),
          };
        }),
    },
    geometryIntegrity,
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
const singleGrantPlanArgument = process.argv.find((argument) => (
  argument.startsWith('--single-grant-plan=')
));
if (singleGrantPlanArgument) {
  const suffix = singleGrantPlanArgument.slice('--single-grant-plan='.length);
  const region = host.extensionRegions[0];
  const grant = normalizeRouteNetworkGrant(
    region.routeNetworkGrants.find(({ id }) => id.endsWith(`coverage:${suffix}`)),
    region,
  );
  const profile = DUNGEON_AUGMENTATION_PROFILES['industrial-supplement-preview-v4'];
  const grammars = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS;
  const plannerRandom = new DungeonAugmentationRandom(seed).fork('single-grant-debug');
  const roomLayoutIds = profile.grammarPool
    .map(({ id }) => grammars[id])
    .filter((grammar) => (
      grammar
        && String(grammar.selectionConstraints?.routeNetworkModuleKind ?? 'room') === 'room'
    ))
    .map(({ id }) => id);
  const selectionBags = {
    topology: createDungeonSelectionBag(plannerRandom.fork('topology-bag'),
      profile.routeNetworkPlanning.topologyTemplates),
    junction: createDungeonSelectionBag(plannerRandom.fork('junction-bag'),
      profile.routeNetworkPlanning.junctionKinds),
    elevation: createDungeonSelectionBag(plannerRandom.fork('elevation-bag'),
      profile.routeNetworkPlanning.elevationModes),
    encounter: createDungeonSelectionBag(plannerRandom.fork('encounter-bag'), [
      'supplement-route-network-defense',
      'supplement-lateral-defense',
    ]),
    roomLayout: createDungeonSelectionBag(plannerRandom.fork('room-layout-bag'),
      roomLayoutIds),
  };
  const argumentValue = (name, fallback) => process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
  const topologyTemplateId = argumentValue(
    'topology',
    selectionBags.topology.order[0],
  );
  const junctionKind = argumentValue('junction', selectionBags.junction.order[0]);
  const elevationMode = argumentValue('elevation', 'split-level-platform');
  const moduleCount = Number(argumentValue('modules', '6'));
  const searchVariant = Number(argumentValue('variant', '0'));
  const topologySelection = dungeonSelectionBagCandidates(
    selectionBags.topology,
    [topologyTemplateId],
  )[0];
  const junctionSelection = dungeonSelectionBagCandidates(
    selectionBags.junction,
    [junctionKind],
  )[0];
  const elevationSelection = dungeonSelectionBagCandidates(
    selectionBags.elevation,
    [elevationMode],
  )[0];
  const singleGrantPlanningStartedAt = performance.now();
  const result = planRouteNetwork({
    region,
    grant,
    operationOrdinal: 5,
    moduleCount,
    topologyTemplateId,
    junctionBag: profile.routeNetworkPlanning.junctionKinds,
    elevationMode,
    selectionBags,
    topologySelection,
    topologyLegalIds: profile.routeNetworkPlanning.topologyTemplates,
    junctionSelection,
    elevationSelection,
    elevationLegalIds: profile.routeNetworkPlanning.elevationModes,
    random: plannerRandom.fork('candidate'),
    profile,
    grammars,
    progressionOrderStart: 0,
    planningAvoidanceVolumes: [
      ...(region.routeNetworkPlacementProtectedVolumes ?? region.protectedVolumes ?? []),
      ...(grant.protectedVolumes ?? []),
    ],
    moduleCapacity: 6,
    searchVariant,
  });
  const singleGrantPlanningElapsedMs = performance.now() - singleGrantPlanningStartedAt;
  const singleContext = process.argv.includes('--compact-failure-summary')
    ? {
      grantId: result.context?.grantId ?? null,
      selectedGrammarIds: result.context?.selectedGrammarIds ?? null,
      contentRoles: result.context?.contentRoles ?? null,
      endpointNodeIndices: result.context?.endpointNodeIndices ?? null,
      constraintKind: result.context?.constraintKind ?? null,
      firstNodeIndex: result.context?.firstNodeIndex ?? null,
      secondNodeIndex: result.context?.secondNodeIndex ?? null,
      placementSearchVisits: result.context?.placementSearchVisits ?? null,
      physicalSpineAttempts: result.context?.physicalSpineAttempts ?? null,
      planningPhaseTimings: result.context?.planningPhaseTimings
        ?? result.planningPhaseTimings
        ?? null,
      placementCandidateCounts: result.context?.placementCandidateCounts ?? null,
      initialPlacementCandidateCenters: (result.context?.initialPlacementCandidateCenters ?? [])
        .map((group) => ({
          nodeIndex: group.nodeIndex,
          baseCenterCandidate: group.baseCenterCandidate,
          candidateCount: group.centers?.length ?? 0,
          firstCenters: (group.centers ?? []).slice(0, 8),
        })),
      objectiveExternalDiagnostics: result.context?.objectiveExternalDiagnostics ?? null,
      externalSpinePathBindings: result.context?.externalSpinePathBindings ?? null,
      requiredSocketBindings: result.context?.requiredSocketBindings ?? null,
      placementCandidateCounts: result.context?.placementCandidateCounts ?? null,
      initialPlacementCandidateCounts: result.context?.initialPlacementCandidateCounts ?? null,
      closestRejectedPairs: (result.context?.closestRejectedPairs ?? []).slice(0, 3),
      arcConsistencyHistory: (result.context?.arcConsistencyHistory ?? []).map((entry) => ({
        iteration: entry.iteration,
        kind: entry.kind,
        status: entry.status,
        firstNodeIndex: entry.firstNodeIndex,
        secondNodeIndex: entry.secondNodeIndex,
        adjacent: entry.adjacent,
        parentAttachment: entry.parentAttachment,
        beforeFirstCount: entry.beforeFirstCount,
        afterFirstCount: entry.afterFirstCount,
        beforeSecondCount: entry.beforeSecondCount,
        afterSecondCount: entry.afterSecondCount,
        exactPairEvaluations: entry.exactPairEvaluations,
        cheapPairEvaluations: entry.cheapPairEvaluations,
        cheapPairCount: entry.cheapPairCount,
      })),
      failedPairRejectionSummary: result.context?.failedPairRejectionSummary ?? null,
      closestRejectedPairs: (result.context?.closestRejectedPairs ?? []).slice(0, 2),
      physicalPairEdges: (result.context?.physicalPairEdgeDiagnostics ?? []).map((edge) => ({
        edgeIndex: edge.edgeIndex,
        fromNodeIndex: edge.fromNodeIndex,
        toNodeIndex: edge.toNodeIndex,
        evaluatedPairCount: edge.evaluatedPairCount,
        compatiblePairCount: edge.compatiblePairCount,
        minimumCollisionScore: edge.minimumCollisionScore,
        minimumDistanceMeters: edge.minimumDistanceMeters,
        bestBlockedPath: edge.bestBlockedPath,
        bestBlockedCollisionIds: edge.bestBlockedCollisionIds,
        routeStageTotals: edge.routeStageTotals,
        socketPairCandidateCounts: edge.socketPairCandidateCounts,
        eligibleSocketPairCandidateCounts: edge.eligibleSocketPairCandidateCounts,
      })),
      physicalSpineEdges: (result.context?.physicalSpineEdgeDiagnostics ?? []).map((edge) => ({
        edgeIndex: edge.edgeIndex,
        fromNodeIndex: edge.fromNodeIndex,
        toNodeIndex: edge.toNodeIndex,
        visits: edge.visits,
        deadEnds: edge.deadEnds,
        maximumRawCandidateCount: edge.maximumRawCandidateCount,
        maximumCollisionFreeCandidateCount: edge.maximumCollisionFreeCandidateCount,
        maximumWithinSpanCandidateCount: edge.maximumWithinSpanCandidateCount,
        maximumFeasibleCandidateCount: edge.maximumFeasibleCandidateCount,
        minimumAccumulatedFeaturelessDistanceMeters:
          edge.minimumAccumulatedFeaturelessDistanceMeters,
        minimumCollisionScore: edge.minimumCollisionScore,
        minimumDistanceMeters: edge.minimumDistanceMeters,
        bestBlockedPath: edge.bestBlockedPath,
        bestBlockedCollisionIds: edge.bestBlockedCollisionIds,
        lastSocketPairDiagnostics: edge.lastSocketPairDiagnostics,
      })),
    }
    : result.context ?? null;
  console.log(JSON.stringify({
    suffix,
    topologyTemplateId,
    junctionKind,
    elevationMode,
    moduleCount,
    searchVariant,
    planningElapsedMs: Number(singleGrantPlanningElapsedMs.toFixed(3)),
    error: result.error ?? null,
    context: singleContext,
    operation: result.operation ? {
      nodeIds: result.operation.nodeIds,
      contentRoles: result.operation.contentRoles,
      moduleCount: result.operation.moduleCount,
      physicalNodeCount: result.operation.physicalNodeCount,
    } : null,
    selectedGrammarIds: result.nodes?.map(({ grammarId }) => grammarId) ?? null,
  }, null, 2));
  generator._disposeGeneratedDungeonCandidate(base.dungeon);
  texture.dispose();
  process.exit(0);
}
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
    planningStationSideDomainCounts: (grant.planningStationSideDiagnostics ?? [])
      .map((station) => ({
        candidateCount: station?.candidates?.length ?? 0,
        viableCount: (station?.candidates ?? []).filter((candidate) => (
          candidate?.stationEligible !== false
            && candidate?.stationBodyBlocked !== true
            && candidate?.fullRoomBodyBlocked !== true
            && candidate?.approachIntersectsOwnCenterline !== true
            && Number(candidate?.hardRouteOverlapArea ?? 0) <= 1e-6
            && Number(candidate?.roomOverlapArea ?? 0) <= 1e-6
            && Number(candidate?.ownRouteOverlapArea ?? 0) <= 1e-6
        )).length,
      })),
    planningReservationRectangles: (grant.planningReservationRectangles ?? [])
      .map(({ id, purpose, center, minX, maxX, minZ, maxZ }) => ({
        id,
        purpose,
        center,
        minX,
        maxX,
        minZ,
        maxZ,
      })),
    planningRoomReservationRectangles: (grant.planningRoomReservationRectangles ?? [])
      .map(({ id, purpose, center, minX, maxX, minZ, maxZ }) => ({
        id,
        purpose,
        center,
        minX,
        maxX,
        minZ,
        maxZ,
      })),
    planningRouteReservationRectangles: (grant.planningRouteReservationRectangles ?? [])
      .map(({ id, purpose, center, minX, maxX, minZ, maxZ }) => ({
        id,
        purpose,
        center,
        minX,
        maxX,
        minZ,
        maxZ,
      })),
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
    .filter(({ id }) => (
      process.argv.includes('--all-rooms')
        || [witnessGrant?.mustPreserveBeatIds ?? []].flat().includes(id)
        || id === 'keycardRoom'
    ))
    .map(({ id, x, z, width, depth, baseElevation, minY, maxY, ceilingHeight }) => ({
      id, x, z, width, depth, baseElevation, minY, maxY, ceilingHeight,
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
  matchingPlanningVolumes: host.extensionRegions[0].routeNetworkPlacementProtectedVolumes
    .filter(({ id, ownerId }) => (
      String(id ?? '').includes(requestedGrant)
        || String(ownerId ?? '').includes(requestedGrant)
    ))
    .map(({ id, ownerId, center, size, purpose }) => ({
      id, ownerId, center, size, purpose,
    })),
  baseRoomPlanningVolumes: host.extensionRegions[0].routeNetworkPlacementProtectedVolumes
    .filter(({ id }) => String(id).includes('room'))
    .map(({ id, ownerId, center, size, purpose }) => ({
      id, ownerId, center, size, purpose,
    })),
}, null, 2));
if (process.argv.includes('--host-only')) {
  generator._disposeGeneratedDungeonCandidate(base.dungeon);
  texture.dispose();
  process.exit(0);
}
generator.augmentationProfileId = profileId;
let cursor = 0;
generator.random = () => base.randomTape[cursor++];

// Focused parity probe for the outer replay wrapper: ordinary direct
// `_generateOnce()` diagnostics plan and materialize against their fresh live
// connection kit, while the wrapper plans against the already accepted
// parent's finalized connector snapshot. Opt in explicitly so normal debug
// output remains unchanged.
if (process.argv.includes('--accepted-parent-planning-snapshot-override')) {
  generator._augmentationReplayPlanningSnapshotOverride =
    generator._createIndustrialDungeonAugmentationPlanningSnapshot({
      rooms: base.dungeon.rooms,
      connectionPlans: base.dungeon.connectionPlans,
    });
}

if (process.argv.includes('--plan-only')) {
  const planned = generator._planIndustrialDungeonAugmentation({
    rooms: base.dungeon.rooms,
    connectionPlans: base.dungeon.connectionPlans,
  });
  if (process.argv.includes('--route-network-overlay-json')) {
    const requestedGrantSuffix = process.argv
      .find((argument) => argument.startsWith('--grant='))
      ?.slice('--grant='.length) ?? '';
    const overlayPlan = planned?.result?.overlayPlan ?? null;
    const operations = (overlayPlan?.operations ?? []).filter((operation) => (
      operation?.type === 'routeNetwork'
        && (!requestedGrantSuffix
          || String(operation.grantId ?? '').endsWith(requestedGrantSuffix))
    ));
    const operationIds = new Set(operations.map(({ id }) => String(id)));
    const compactRouteNetworkOverlay = process.argv.includes(
      '--compact-route-network-overlay',
    );
    const matchingNodes = (overlayPlan?.nodes ?? []).filter(({ operationId }) => (
      operationIds.has(String(operationId))
    ));
    const matchingSegments = (overlayPlan?.segments ?? []).filter(({ operationId }) => (
      operationIds.has(String(operationId))
    ));
    console.log(JSON.stringify({
      status: planned?.status ?? null,
      augmentationPlanHash: overlayPlan?.augmentationPlanHash ?? null,
      operations: compactRouteNetworkOverlay
        ? operations.map((operation) => ({
          id: operation.id,
          grantId: operation.grantId,
          topologyTemplateId: operation.topologyTemplateId,
          elevationModes: operation.elevationModes,
          nodeIds: operation.nodeIds,
          segmentIds: operation.segmentIds,
          featurelessSpans: operation.featurelessSpans,
          cycleRankDelta: operation.cycleRankDelta,
        }))
        : operations,
      nodes: compactRouteNetworkOverlay
        ? matchingNodes.map((node) => ({
          id: node.id,
          ordinal: node.ordinal,
          kind: node.kind,
          grammarId: node.grammarId,
          blueprintId: node.blueprintId,
          moduleTemplateId: node.moduleTemplateId,
          contentRole: node.contentRole,
          placement: node.placement,
          graphDegree: node.graphDegree,
          junction: node.junction,
          sockets: (node.sockets ?? []).map((socket) => ({
            id: socket.id,
            localSocketId: socket.localSocketId,
            state: socket.state,
            segmentId: socket.segmentId,
            position: socket.position,
            facing: socket.facing,
          })),
        }))
        : matchingNodes,
      segments: compactRouteNetworkOverlay
        ? matchingSegments.map((segment) => ({
          id: segment.id,
          physicalOrdinal: segment.physicalOrdinal,
          routeRole: segment.routeRole,
          connectorFamily: segment.connectorFamily,
          connectorVariantId: segment.connectorVariantId,
          from: segment.from,
          to: segment.to,
          path: segment.path,
          occupiedVolumes: segment.occupiedVolumes,
          clearanceVolumes: segment.clearanceVolumes,
          landingVolumes: segment.landingVolumes,
          verticalTransfer: segment.verticalTransfer,
          traversal: segment.traversal,
        }))
        : matchingSegments,
      ...(compactRouteNetworkOverlay ? {} : {
        diagnostics: planned?.diagnostics ?? null,
      }),
    }, null, 2));
    generator._disposeGeneratedDungeonCandidate(base.dungeon);
    texture.dispose();
    process.exit(0);
  }
  const edgeBlockerArgument = process.argv.find((argument) => (
    argument.startsWith('--edge-blockers=')
  ));
  if (edgeBlockerArgument) {
    const [fromX, fromZ, toX, toZ, elevation] = edgeBlockerArgument
      .slice('--edge-blockers='.length)
      .split(',')
      .map(Number);
    const fromFloor = { x: fromX, z: fromZ, elevation };
    const toFloor = { x: toX, z: toZ, elevation };
    const supplementalRooms = [
      ...(planned?.materialized?.rooms ?? []),
      ...(planned?.materialized?.connectorJunctionProxies ?? []),
    ];
    const zones = [
      ...generator._createSolidCollisionZones([
        ...base.dungeon.rooms,
        ...supplementalRooms,
      ]),
      ...generator._createDungeonSupplementManifestSolidZones(supplementalRooms),
    ];
    const connectionPlans = planned?.materialized?.connectionPlans ?? [];
    const nearbyPlans = connectionPlans.filter((plan) => (
      (plan.fullPath ?? plan.bridgePath ?? []).some((point) => (
        Math.abs(Number(point.x) - fromX) <= 3
          && Math.abs(Number(point.z) - fromZ) <= 3
      ))
    ));
    console.log(JSON.stringify({
      status: planned?.status ?? null,
      edge: { fromFloor, toFloor },
      nearbyPlans: nearbyPlans.map((plan) => ({
        id: plan.id,
        sourceElevation: plan.sourceElevation,
        destinationElevation: plan.destinationElevation,
        path: plan.fullPath ?? plan.bridgePath ?? [],
        authoritativeTraversalFloorKeys:
          plan.authoritativeTraversalSpine?.requiredFloorKeys ?? [],
        seamMatches: (plan.endpointSeams ?? []).flatMap((seam) => (seam?.orderedCells ?? [])
          .filter((cell) => [fromX, toX].includes(Number(cell.grid?.x))
            && [fromZ, toZ].includes(Number(cell.grid?.z)))
          .map((cell) => ({ role: seam.role, seamId: seam.id, cell }))),
      })),
      nearbyRoomFloors: supplementalRooms.flatMap((room) => (
        (room.augmentationFloorTiers ?? []).flatMap((tier) => (
          (tier.worldCells ?? [])
            .filter((cell) => [fromX, toX].includes(Number(cell.grid?.x))
              && [fromZ, toZ].includes(Number(cell.grid?.z)))
            .map((cell) => ({ roomId: room.id, tierId: tier.id, cell }))
        ))
      )),
      blockers: zones.filter((zone) => (
        generator._doesFloorTraversalSegmentIntersectZone(
          fromFloor,
          toFloor,
          zone,
          0.42,
        )
      )).map((zone) => ({
        id: zone.id,
        roomId: zone.roomId ?? null,
        operationId: zone.operationId ?? null,
        obstacleKind: zone.obstacleKind ?? null,
        position: zone.position,
        halfWidth: zone.halfWidth,
        halfDepth: zone.halfDepth,
        verticalHalfHeight: zone.verticalHalfHeight,
        rotationY: zone.rotationY ?? 0,
      })),
    }, null, 2));
    generator._disposeGeneratedDungeonCandidate(base.dungeon);
    texture.dispose();
    process.exit(0);
  }
  if (process.argv.includes('--diagnostics-only')) {
    console.log(JSON.stringify(planned?.diagnostics ?? null, null, 2));
    generator._disposeGeneratedDungeonCandidate(base.dungeon);
    texture.dispose();
    process.exit(0);
  }
  if (process.argv.includes('--compact-failure-summary')) {
    const error = planned?.diagnostics?.errors?.[0] ?? null;
    const context = error?.context ?? {};
    console.log(JSON.stringify({
      status: planned?.status ?? null,
      augmentationPlanHash: planned?.result?.overlayPlan?.augmentationPlanHash ?? null,
      effectivePlanHash: planned?.result?.overlayPlan?.effectivePlanHash ?? null,
      ...(candidateHistogramRequested ? {
        candidateHistogram: summarizeCandidateHistogram(candidateHistogramRecords),
      } : {}),
      error: error ? {
        code: error.code,
        operationId: context.operationId,
        segmentId: context.segmentId,
        role: context.role,
        seamId: context.seamId,
        endpointSeamCount: context.endpointSeamCount,
        mismatchedFields: context.mismatchedFields,
        expectedCellCount: context.expectedCellCount,
        actualCellCount: context.actualCellCount,
        expectedParentOwnerId: context.expectedParentOwnerId,
        actualParentOwnerId: context.actualParentOwnerId,
        family: context.family,
        witnessErrorCodes: context.witnessErrorCodes,
        witnessErrors: context.witnessErrors,
        grantId: context.grantId,
        constraintKind: context.constraintKind,
        firstNodeIndex: context.firstNodeIndex,
        secondNodeIndex: context.secondNodeIndex,
        nodeIndex: context.nodeIndex,
        topologyTemplateId: context.topologyTemplateId,
        elevationMode: context.elevationMode,
        reason: context.reason,
        intervals: context.intervals,
        intervalDeltas: context.intervalDeltas,
        balancedCoverageLayoutSignature: context.balancedCoverageLayoutSignature,
        refinedLayoutSignature: context.refinedLayoutSignature,
        riseIndex: context.riseIndex,
        descentIndex: context.descentIndex,
        selectedGrammarIds: context.selectedGrammarIds,
        contentRoles: context.contentRoles,
        endpointNodeIndices: context.endpointNodeIndices,
        challengeBranchRoomIndex: context.challengeBranchRoomIndex,
        mainPayoffRoomIndex: context.mainPayoffRoomIndex,
        stationSeparationMeters: context.stationSeparationMeters,
        stationRouteLengthMeters: context.stationRouteLengthMeters,
        connectorEndpointGapMeters: context.connectorEndpointGapMeters,
        legalGrammarIds: context.legalGrammarIds,
        selectedGrammarId: context.selectedGrammarId,
        requestedSubstantiveModuleCount: context.requestedSubstantiveModuleCount,
        routeNetworkSolver: context.routeNetworkSolver,
        blockingDiagnostics: context.blockingDiagnostics,
        reservedByNetworkDiagnostics: context.reservedByNetworkDiagnostics,
        placementSearchVisits: context.placementSearchVisits,
        physicalSpineAttempts: context.physicalSpineAttempts,
        planningPhaseTimings: context.planningPhaseTimings,
        initialPlacementCandidateCounts: context.initialPlacementCandidateCounts,
        arcConsistencyHistory: context.arcConsistencyHistory,
        failedPairRejectionSummary: context.failedPairRejectionSummary,
        placementCandidateCounts: (context.placementCandidateCounts ?? []).map((record) => ({
          nodeIndex: record.nodeIndex,
          count: record.count,
        })),
        physicalPairEdges: (context.physicalPairEdgeDiagnostics ?? []).map((edge) => ({
          edgeOrdinal: edge.edgeOrdinal,
          fromNodeIndex: edge.fromNodeIndex,
          toNodeIndex: edge.toNodeIndex,
          evaluatedPairCount: edge.evaluatedPairCount,
          compatiblePairCount: edge.compatiblePairCount,
          minimumCollisionScore: edge.minimumCollisionScore,
          minimumDistanceMeters: edge.minimumDistanceMeters,
          bestBlockedCollisionIds: edge.bestBlockedCollisionIds,
          routeStageTotals: edge.routeStageTotals,
        })),
        physicalSpineEdges: (context.physicalSpineEdgeDiagnostics ?? []).map((edge) => ({
          edgeIndex: edge.edgeIndex,
          fromNodeIndex: edge.fromNodeIndex,
          toNodeIndex: edge.toNodeIndex,
          visits: edge.visits,
          deadEnds: edge.deadEnds,
          maximumRawCandidateCount: edge.maximumRawCandidateCount,
          maximumCollisionFreeCandidateCount: edge.maximumCollisionFreeCandidateCount,
          maximumWithinSpanCandidateCount: edge.maximumWithinSpanCandidateCount,
          maximumFeasibleCandidateCount: edge.maximumFeasibleCandidateCount,
          forwardCheckFailures: edge.forwardCheckFailures,
          minimumEndpointPrefixMeters: edge.minimumEndpointPrefixMeters,
          minimumAccumulatedFeaturelessDistanceMeters:
            edge.minimumAccumulatedFeaturelessDistanceMeters,
          minimumCollisionScore: edge.minimumCollisionScore,
          minimumDistanceMeters: edge.minimumDistanceMeters,
          bestBlockedCollisionIds: edge.bestBlockedCollisionIds,
        })),
        parentAttachmentFailures: context.parentAttachmentFailureDiagnostics,
        lastPhysicalPlacementCenters: context.lastPhysicalPlacementCenters,
      } : null,
    }, null, 2));
    generator._disposeGeneratedDungeonCandidate(base.dungeon);
    texture.dispose();
    process.exit(0);
  }
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
        planningPhaseTimings: context.planningPhaseTimings,
        objectiveExternalDiagnostics: context.objectiveExternalDiagnostics,
        compoundDiagnostics: context.compoundDiagnostics,
        coveragePlacementShape: context.coveragePlacementShape,
        externalSpinePathCount: context.externalSpinePathCount,
        externalSpinePathBindings: context.externalSpinePathBindings,
        initialPlacementCandidateCounts: context.initialPlacementCandidateCounts,
        arcConsistencyHistory: context.arcConsistencyHistory,
        failedPairRejectionSummary: context.failedPairRejectionSummary,
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
        physicalPairEdges: (context.physicalPairEdgeDiagnostics ?? []).map((edge) => ({
          edgeOrdinal: edge.edgeOrdinal,
          fromNodeIndex: edge.fromNodeIndex,
          toNodeIndex: edge.toNodeIndex,
          evaluatedPairCount: edge.evaluatedPairCount,
          compatiblePairCount: edge.compatiblePairCount,
          minimumCollisionScore: edge.minimumCollisionScore,
          minimumDistanceMeters: edge.minimumDistanceMeters,
          bestBlockedCollisionIds: edge.bestBlockedCollisionIds,
          routeStageTotals: edge.routeStageTotals,
          socketPairCandidateCounts: (edge.socketPairCandidateCounts ?? [])
            .slice(0, 16)
            .map((pair) => ({
              fromLocalSocketId: pair.fromLocalSocketId,
              toLocalSocketId: pair.toLocalSocketId,
              connectorFamily: pair.connectorFamily,
              rawRouteCandidateCount: pair.rawRouteCandidateCount,
              routeOptionCount: pair.routeOptionCount,
              declaredExternalSpinePath: pair.declaredExternalSpinePath,
              externalSpineStartDeltaMeters: pair.externalSpineStartDeltaMeters,
              externalSpineEndDeltaMeters: pair.externalSpineEndDeltaMeters,
              fromPosition: pair.fromPosition,
              toPosition: pair.toPosition,
              minimumRawFeaturelessDistanceMeters:
                pair.minimumRawFeaturelessDistanceMeters,
              routeSelectionDiagnostics: pair.routeSelectionDiagnostics,
              endpointPrefixMeters: pair.endpointPrefixMeters,
              accumulatedFeaturelessDistancesMeters:
                pair.accumulatedFeaturelessDistancesMeters,
              exactRouteOptionStaticCollisionFreeCount:
                pair.exactRouteOptionStaticCollisionFreeCount,
              optionCollisionDiagnostics: pair.optionCollisionDiagnostics,
            })),
          eligibleSocketPairCandidateCounts: (edge.eligibleSocketPairCandidateCounts ?? [])
            .slice(0, 16)
            .map((pair) => ({
              fromLocalSocketId: pair.fromLocalSocketId,
              toLocalSocketId: pair.toLocalSocketId,
              connectorFamily: pair.connectorFamily,
              rawRouteCandidateCount: pair.rawRouteCandidateCount,
              routeOptionCount: pair.routeOptionCount,
              declaredExternalSpinePath: pair.declaredExternalSpinePath,
              fromPosition: pair.fromPosition,
              toPosition: pair.toPosition,
              minimumRawFeaturelessDistanceMeters:
                pair.minimumRawFeaturelessDistanceMeters,
              routeSelectionDiagnostics: pair.routeSelectionDiagnostics,
              endpointPrefixMeters: pair.endpointPrefixMeters,
              accumulatedFeaturelessDistancesMeters:
                pair.accumulatedFeaturelessDistancesMeters,
              exactRouteOptionStaticCollisionFreeCount:
                pair.exactRouteOptionStaticCollisionFreeCount,
              optionCollisionDiagnostics: pair.optionCollisionDiagnostics,
            })),
        })),
        spineEdges: context.physicalSpineEdgeDiagnostics,
        topologyTemplateId: context.topologyTemplateId,
        topologyKitModuleIndex: context.topologyKitModuleIndex,
        topologyReturnDiagnostics: context.topologyReturnDiagnostics,
        balancedCoverageLayoutSignature: context.balancedCoverageLayoutSignature,
        refinedLayoutSignature: context.refinedLayoutSignature,
      } : null,
    }, null, 2));
    generator._disposeGeneratedDungeonCandidate(base.dungeon);
    texture.dispose();
    process.exit(0);
  }
  const overlayPlan = planned?.result?.overlayPlan ?? null;
  if (process.argv.includes('--transfer-summary')) {
    console.log(JSON.stringify({
      status: planned?.status ?? null,
      rooms: (planned?.materialized?.rooms ?? [])
        .filter(({ augmentationTransfers }) => (augmentationTransfers?.length ?? 0) > 0)
        .map((room) => ({
          id: room.id,
          x: room.x,
          z: room.z,
          blueprintId: room.augmentationBlueprintId,
          rotationQuarterTurns: room.augmentationRotationQuarterTurns,
          transfers: room.augmentationTransfers.map((transfer) => ({
            id: transfer.id,
            form: transfer.form,
            localElevationRange: transfer.localElevationRange,
            worldElevationRange: transfer.worldElevationRange,
            worldEndpoints: transfer.worldEndpoints,
            localTraversalAxis: transfer.localTraversalAxis,
            localTraversalReversed: transfer.localTraversalReversed,
            localTraversalOrientationSource: transfer.localTraversalOrientationSource,
          })),
        })),
    }, null, 2));
    generator._disposeGeneratedDungeonCandidate(base.dungeon);
    texture.dispose();
    process.exit(0);
  }
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
      rooms: [
        ...(planned?.materialized?.rooms ?? []),
        ...(planned?.materialized?.connectorJunctionProxies ?? []),
      ]
        .filter(({ id }) => roomIds.has(String(id)))
        .map((room) => ({
          id: room.id,
          x: room.x,
          z: room.z,
          width: room.width,
          depth: room.depth,
          blueprintId: room.augmentationBlueprintId,
          moduleTemplateId: room.augmentationModuleTemplateId,
          placementRotationQuarterTurns: room.augmentationPlacementRotationQuarterTurns,
          physicalRotationQuarterTurns: room.augmentationPhysicalRotationQuarterTurns,
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
              id: cell.id,
              localTile: cell.localTile,
              position: cell.position,
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
  const floorByGraphKey = new Map((dungeon.floorTiles ?? []).map((floor) => [
    generator._getFloorTileGraphKey(floor),
    floor,
  ]));
  const playableAlphaSmoke = createPlayableAlphaSmokeSummary(dungeon);
  const rejectedEntranceChecks = (dungeon.progression?.validation?.connectorEntrances?.checks ?? [])
    .filter(({ accepted }) => accepted !== true);
  const missingApproachCoordinates = [...new Map(rejectedEntranceChecks.flatMap((check) => (
    (check.laneChecks ?? []).flatMap((lane) => lane.points
      .filter(({ floorKey }) => !floorKey)
      .map((point) => [`${point.x},${point.z}`, { x: point.x, z: point.z }]))
  ))).values()];
  const blockingPlatformTops = generator._createBlockingPlatformColumnMap(dungeon.floorTiles ?? []);
  const blockedApproachDiagnostics = missingApproachCoordinates.slice(0, 80).map(({ x, z }) => {
    const floors = (dungeon.floorTiles ?? []).filter((floor) => floor.x === x && floor.z === z);
    return {
      x,
      z,
      blockingPlatformTop: blockingPlatformTops.get(`${x},${z}`) ?? null,
      floors: floors.map((floor) => ({
        floorKey: generator._getFloorTileGraphKey(floor),
        roomId: floor.roomId ?? null,
        connectorId: floor.signedConnectorFloorOwnerId
          ?? floor.connectionId
          ?? floor.connectorId
          ?? null,
        sharedConnectorFloorOwnerIds: floor.sharedConnectorFloorOwnerIds ?? [],
        surface: floor.surface ?? null,
        walkabilityIntent: floor.walkabilityIntent ?? null,
        steepRamp: floor.steepRamp === true,
        blockingZoneIds: (dungeon.solidZones ?? [])
          .filter((zone) => generator._isPositionInsideZone(
            generator._floorTileToWorld(floor),
            zone,
          ))
          .map(({ id }) => id),
      })),
    };
  });
  const supplementalRoomById = new Map((dungeon.rooms ?? [])
    .filter(({ isDungeonSupplement }) => isDungeonSupplement === true)
    .map((room) => [String(room.id), room]));
  const unexpectedBlockedRoomFloorDiagnostics = (dungeon.floorTiles ?? [])
    .filter((floor) => supplementalRoomById.has(String(floor.roomId ?? '')))
    .map((floor) => {
      const room = supplementalRoomById.get(String(floor.roomId));
      const position = generator._floorTileToWorld(floor);
      const blockingZones = (dungeon.solidZones ?? []).filter((zone) => (
        generator._isPositionInsideZone(position, zone)
      ));
      const authoredZoneIds = new Set(generator
        ._createDungeonSupplementManifestSolidZones([room])
        .map(({ id }) => String(id)));
      return {
        floorKey: generator._getFloorTileGraphKey(floor),
        roomId: floor.roomId,
        surface: floor.surface ?? null,
        transferId: floor.augmentationTransferId ?? null,
        walkabilityIntent: floor.walkabilityIntent ?? null,
        blockingPlatformTop: blockingPlatformTops.get(`${floor.x},${floor.z}`) ?? null,
        blockingZones: blockingZones.map((zone) => ({
          id: zone.id,
          roomId: zone.roomId ?? null,
          obstacleKind: zone.obstacleKind ?? null,
          declaredByFloorOwner: authoredZoneIds.has(String(zone.id)),
        })),
      };
    })
    .filter(({ blockingZones, blockingPlatformTop, floorKey, walkabilityIntent }) => {
      if (walkabilityIntent === 'support-only') return false;
      const floorElevation = Number(floorKey.match(/@y(-?[0-9.]+)/)?.[1] ?? 0);
      return blockingZones.some(({ declaredByFloorOwner }) => !declaredByFloorOwner)
        || (Number.isFinite(blockingPlatformTop)
          && blockingPlatformTop > floorElevation + 0.05);
    })
    .slice(0, 180);
  if (process.argv.includes('--errors-only')) {
    const summarizeConnectorEntrance = (check) => ({
      connectionId: check.connectionId ?? null,
      accepted: check.accepted === true,
      source: check.sourceRoomId ?? check.fromRoomId ?? null,
      target: check.targetRoomId ?? check.toRoomId ?? null,
      missingApproachFloorKeys: check.missingApproachFloorKeys ?? [],
      blockedApproachFloorKeys: check.blockedApproachFloorKeys ?? [],
      unreachableApproachFloorKeys: check.unreachableApproachFloorKeys ?? [],
      nonReturnableApproachFloorKeys: check.nonReturnableApproachFloorKeys ?? [],
      errors: check.errors ?? [],
    });
    const summarizeConnectivity = (check) => ({
      id: check.connectionId ?? check.roomId ?? check.junctionId
        ?? check.operationId ?? check.id ?? null,
      accepted: check.accepted === true,
      routeStationProxy: check.routeStationProxy ?? null,
      connectorModuleProxy: check.connectorModuleProxy ?? null,
      attachedPhysicalConnectionIds: check.attachedPhysicalConnectionIds ?? [],
      requiredPhysicalArmCount: check.requiredPhysicalArmCount ?? null,
      requiredApproachCount: check.requiredApproachCount ?? null,
      attachedConnectorsTraversable: check.attachedConnectorsTraversable ?? null,
      approachCount: check.approachCount ?? null,
      approachChecks: check.approachChecks ?? [],
      coreFloorCount: check.coreFloorCount ?? null,
      navigableCoreFloorCount: check.navigableCoreFloorCount ?? null,
      expectedCoreFloorCount: check.expectedCoreFloorCount ?? null,
      coreFloorCoverageAccepted: check.coreFloorCoverageAccepted ?? null,
      foreignCoreFloorOwnerIds: check.foreignCoreFloorOwnerIds ?? [],
      unownedMergedCoreFloorSourceCount: check.unownedMergedCoreFloorSourceCount ?? null,
      locallyReachableFloorCount: check.locallyReachableFloorCount ?? null,
      locallyReturnableFloorCount: check.locallyReturnableFloorCount ?? null,
      missingFloorKeys: check.missingCenterlineFloorKeys ?? check.missingFloorKeys ?? [],
      unreachableFloorKeys: check.unreachableCenterlineFloorKeys
        ?? check.locallyUnreachableRoomFloorKeys ?? check.unreachableFloorKeys ?? [],
      nonReturnableFloorKeys: check.nonReturnableCenterlineFloorKeys
        ?? check.locallyNonReturnableRoomFloorKeys ?? check.nonReturnableFloorKeys ?? [],
      missingApproachFloorKeys: check.missingApproachFloorKeys ?? [],
      blockedApproachFloorKeys: check.blockedApproachFloorKeys ?? [],
      errors: check.errors ?? [],
    });
    console.log(JSON.stringify({
      status: dungeon.augmentationStatus,
      accepted: dungeon.progression?.validation?.accepted ?? null,
      errorCount: dungeon.progression?.validation?.errors?.length ?? 0,
      errors: dungeon.progression?.validation?.errors ?? [],
      rejectedConnectorEntrances: (dungeon.progression?.validation?.connectorEntrances
        ?.checks ?? []).filter(({ accepted }) => accepted !== true).map(summarizeConnectorEntrance),
      rejectedConnectorSpines: (dungeon.progression?.validation?.platformability
        ?.supplementConnectivityChecks ?? []).filter(({ accepted }) => accepted !== true)
        .map(summarizeConnectivity),
      rejectedLocalSockets: (dungeon.progression?.validation?.platformability
        ?.localSocketChecks ?? []).filter(({ accessibleFromOwnerRoom }) => (
        accessibleFromOwnerRoom !== true
      )).map((check) => ({
        ...check,
        socket: (dungeon.connectionPlans ?? []).flatMap((plan) => [
          { planId: plan.id, socket: plan.fromSocket },
          { planId: plan.id, socket: plan.toSocket },
        ]).find(({ socket }) => socket?.id === check.socketId) ?? null,
        floor: floorByGraphKey.get((dungeon.connectionPlans ?? []).flatMap((plan) => [
          plan.fromSocket,
          plan.toSocket,
        ]).find((socket) => socket?.id === check.socketId)?.floorKey) ?? null,
      })),
      rejectedJunctions: (dungeon.progression?.validation?.platformability
        ?.supplementJunctionConnectivityChecks ?? []).filter(({ accepted }) => accepted !== true)
        .map(summarizeConnectivity),
      rejectedOperations: (dungeon.progression?.validation?.platformability
        ?.supplementOperationConnectivityChecks ?? []).filter(({ accepted }) => accepted !== true)
        .map(summarizeConnectivity),
      blockedSupplementFloors: (dungeon.progression?.validation?.platformability
        ?.blockedSupplementFloorKeys ?? []).map((floorKey) => {
        const floor = floorByGraphKey.get(floorKey) ?? null;
        const position = floor ? generator._floorTileToWorld(floor) : null;
        return {
          floorKey,
          floor,
          blockingPlatformTop: floor
            ? blockingPlatformTops.get(`${floor.x},${floor.z}`) ?? null
            : null,
          blockingZones: position ? (dungeon.solidZones ?? [])
            .filter((zone) => generator._isPositionInsideZone(position, zone))
            .map(({ id, roomId, obstacleKind }) => ({ id, roomId, obstacleKind })) : [],
        };
      }),
    }, null, 2));
    generator._disposeGeneratedDungeonCandidate(dungeon, base.dungeon);
    texture.dispose();
    process.exit(0);
  }
  if (process.argv.includes('--failed-rooms-only')
    || process.argv.includes('--direct-failed-rooms-only')) {
    const diagnosticBarrierZones = [
      ...(dungeon.solidZones ?? []),
      ...(dungeon.aerialBoundaryZones ?? []),
    ].filter((zone, index, zones) => (
      zone?.position && zones.findIndex((candidate) => candidate?.id === zone?.id) === index
    ));
    const failedRooms = (dungeon.progression?.validation?.platformability
      ?.supplementRoomConnectivityChecks ?? [])
      .filter(({ accepted }) => accepted !== true)
      .map((check) => {
        const room = supplementalRoomById.get(String(check.roomId)) ?? null;
        const unreachableKeys = new Set(check.locallyUnreachableRoomFloorKeys ?? []);
        const nonReturnableKeys = new Set(check.locallyNonReturnableRoomFloorKeys ?? []);
        const frontierEdges = [...unreachableKeys].flatMap((floorKey) => {
          const floor = floorByGraphKey.get(floorKey);
          if (!floor) return [];
          return (dungeon.floorTiles ?? [])
            .filter((candidate) => candidate.roomId === floor.roomId)
            .filter((candidate) => (
              Math.abs(candidate.x - floor.x) + Math.abs(candidate.z - floor.z) === 1
            ))
            .filter((candidate) => !unreachableKeys.has(generator._getFloorTileGraphKey(candidate)))
            .map((candidate) => ({
              from: generator._getFloorTileGraphKey(candidate),
              to: floorKey,
              action: generator._getTraversalActionBetweenFloorTiles(candidate, floor),
              blockers: diagnosticBarrierZones
                .filter((zone) => generator._doesFloorTraversalSegmentIntersectZone(
                  candidate,
                  floor,
                  zone,
                  0.42,
                ))
                .map(({ id }) => String(id).split(':blueprint-feature:').at(-1)),
            }));
        }).slice(0, 12);
        const returnFrontierEdges = [...nonReturnableKeys].flatMap((floorKey) => {
          const floor = floorByGraphKey.get(floorKey);
          if (!floor) return [];
          return (dungeon.floorTiles ?? [])
            .filter((candidate) => candidate.roomId === floor.roomId)
            .filter((candidate) => (
              Math.abs(candidate.x - floor.x) + Math.abs(candidate.z - floor.z) === 1
            ))
            .filter((candidate) => !nonReturnableKeys.has(generator._getFloorTileGraphKey(candidate)))
            .map((candidate) => ({
              from: floorKey,
              to: generator._getFloorTileGraphKey(candidate),
              action: generator._getTraversalActionBetweenFloorTiles(floor, candidate),
              blockers: diagnosticBarrierZones
                .filter((zone) => generator._doesFloorTraversalSegmentIntersectZone(
                  floor,
                  candidate,
                  zone,
                  0.42,
                ))
                .map(({ id }) => String(id).split(':blueprint-feature:').at(-1)),
            }));
        }).slice(0, 12);
        return {
          roomId: check.roomId,
          blueprintId: room?.augmentationBlueprintId ?? null,
          center: room ? { x: room.x, z: room.z, y: room.baseElevation ?? 0 } : null,
          rotationQuarterTurns: room?.augmentationRotationQuarterTurns ?? null,
          transfers: (room?.augmentationTransfers ?? []).map((transfer) => ({
            id: transfer.localTransferId ?? transfer.id,
            form: transfer.form ?? transfer.traversalKind ?? transfer.kind,
            endpoints: Object.fromEntries(Object.entries(transfer.worldEndpoints ?? {}).map(([
              key,
              endpoint,
            ]) => [key, {
              floorCellId: endpoint.floorCellId,
              transferCellId: endpoint.transferCellId,
              grid: endpoint.grid,
              elevation: endpoint.elevation,
            }])),
            cells: (transfer.worldCells ?? []).map((cell) => ({
              grid: cell.grid,
              elevation: cell.elevation,
              id: cell.id,
            })),
          })),
          connectedApproaches: (check.localApproachChecks ?? []).map((approach) => ({
            floorKey: approach.floorKey,
            reachable: approach.reachableFromFirstApproach,
            returnable: approach.returnReachable,
          })),
          unreachableCount: check.locallyUnreachableRoomFloorKeys?.length ?? 0,
          unreachableSamples: (check.locallyUnreachableRoomFloorKeys ?? []).slice(0, 8),
          nonReturnableCount: check.locallyNonReturnableRoomFloorKeys?.length ?? 0,
          nonReturnableSamples: (check.locallyNonReturnableRoomFloorKeys ?? []).slice(0, 8),
          orphanCount: check.orphanFloorKeys?.length ?? 0,
          frontierEdges,
          returnFrontierEdges,
        };
      });
    console.log(JSON.stringify({
      status: dungeon.augmentationStatus,
      errorCount: dungeon.progression?.validation?.errors?.length ?? 0,
      failedRooms,
    }, null, 2));
    generator._disposeGeneratedDungeonCandidate(dungeon, base.dungeon);
    texture.dispose();
    process.exit(0);
  }
  console.log(JSON.stringify({
    status: dungeon.augmentationStatus,
    blockedApproachDiagnostics,
    unexpectedBlockedRoomFloorDiagnostics,
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
      errorKinds: countBy(dungeon.progression.validation.errors ?? [], (error) => {
        if (error.includes('decorative V1 arches')) return 'v1-arches';
        if (error.includes('theme-bound V4 structural frames')) return 'v4-frames';
        if (error.includes('clear two-tile bidirectional approach')) return 'socket-approach';
        if (error.includes('realized traversal floor')) return 'connector-floor';
        if (error.includes('orphaned realized centerline')) return 'connector-orphan';
        if (error.includes('declared base-floor footprint')) return 'room-footprint';
        if (error.includes('orphaned walkable floor')) return 'room-orphan';
        if (error.includes('locally clear, bidirectional component')) return 'room-local';
        if (error.includes('connector module is not one exact-elevation')) return 'junction-local';
        if (error.includes('Supplement assembly contains')) return 'assembly-aggregate';
        if (error.includes('realized operation graph')) return 'operation-graph';
        if (error.includes('encounter spawn')) return 'encounter-spawn';
        if (error.includes('cannot be reached locally')) return 'socket-local';
        return 'other';
      }),
      errors: dungeon.progression.validation.errors?.slice(0, 90) ?? [],
      failedRoomChecks: (dungeon.progression.validation.platformability
        ?.supplementRoomConnectivityChecks ?? [])
        .filter(({ accepted }) => accepted !== true)
        .map((check) => {
          const room = supplementalRoomById.get(String(check.roomId)) ?? null;
          const unreachableKeys = new Set(check.locallyUnreachableRoomFloorKeys ?? []);
          const frontierEdges = [...unreachableKeys]
            .flatMap((floorKey) => {
              const floor = floorByGraphKey.get(floorKey);
              if (!floor) return [];
              return (dungeon.floorTiles ?? [])
                .filter((candidate) => candidate.roomId === floor.roomId)
                .filter((candidate) => (
                  Math.abs(candidate.x - floor.x) + Math.abs(candidate.z - floor.z) === 1
                ))
                .filter((candidate) => !unreachableKeys.has(generator._getFloorTileGraphKey(candidate)))
                .map((candidate) => ({
                  fromFloorKey: generator._getFloorTileGraphKey(candidate),
                  toFloorKey: floorKey,
                  action: generator._getTraversalActionBetweenFloorTiles(candidate, floor),
                  blockingZoneIds: (dungeon.solidZones ?? [])
                    .filter((zone) => zone?.position)
                    .filter((zone) => generator._doesFloorTraversalSegmentIntersectZone(
                      candidate,
                      floor,
                      zone,
                      0.42,
                    ))
                    .map(({ id }) => id),
                }));
            })
            .slice(0, 16);
          return {
          roomId: check.roomId,
          blueprintId: room?.augmentationBlueprintId ?? null,
          center: room ? { x: room.x, z: room.z, y: room.baseElevation ?? 0 } : null,
          rotationQuarterTurns: room?.augmentationRotationQuarterTurns ?? null,
          transferForms: (room?.augmentationTransfers ?? []).map((transfer) => ({
            id: transfer.localTransferId ?? transfer.id,
            form: transfer.form ?? transfer.kind ?? transfer.traversalKind,
            worldElevationRange: transfer.worldElevationRange,
            endpointFloorKeys: Object.values(transfer.worldEndpoints ?? {}).map((endpoint) => (
              endpoint?.grid
                ? `${endpoint.grid.x},${endpoint.grid.z}@y${Number(endpoint.elevation).toFixed(3)}`
                : null
            )).filter(Boolean),
          })),
          connectedSocketIds: check.connectedSocketIds,
          localApproachChecks: (check.localApproachChecks ?? []).map((approach) => ({
            socketId: approach.socketId,
            floorKey: approach.floorKey,
            reachableFromFirstApproach: approach.reachableFromFirstApproach,
            returnReachable: approach.returnReachable,
          })),
          authoredBlockingRoomFloorCount: check.authoredBlockingRoomFloorCount,
          locallyUnreachableRoomFloorKeys: (check.locallyUnreachableRoomFloorKeys ?? []).slice(0, 12),
          locallyNonReturnableRoomFloorKeys: (check.locallyNonReturnableRoomFloorKeys ?? []).slice(0, 12),
          orphanFloorKeys: (check.orphanFloorKeys ?? []).slice(0, 12),
          frontierEdges: frontierEdges.slice(0, 8),
        };
        }),
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
  const failedPhysicalSegmentArgument = process.argv.find((argument) => (
    argument.startsWith('--segment=')
  ));
  const failedPhysicalSegment = failedPhysicalSegmentArgument
    ?.slice('--segment='.length) ?? null;
  const failedPhysicalGrant = process.argv.find((argument) => (
    argument.startsWith('--grant=')
  ))?.slice('--grant='.length) ?? null;
  const failedPhysicalPlans = process.argv.includes('--failed-physical')
    ? capturedPreSurfacePlans.filter((plan) => (
      (failedPhysicalGrant == null || String(plan.id).toLowerCase().includes(
        failedPhysicalGrant.toLowerCase(),
      ))
      && (failedPhysicalSegment == null || String(plan.id).includes(
        `:segment:${failedPhysicalSegment}:`,
      ))
    )).map((plan) => ({
      id: plan.id,
      fromRoomId: plan.fromRoomId,
      toRoomId: plan.toRoomId,
      sourceElevation: plan.sourceElevation,
      destinationElevation: plan.destinationElevation,
      fromSocket: plan.fromSocket,
      toSocket: plan.toSocket,
      bridgePath: plan.bridgePath,
      traversalFloorKeys: plan.traversalFloorKeys,
      centerlineFloors: (plan.bridgePath ?? []).map((point, pathIndex) => ({
        pathIndex,
        point,
        candidates: capturedPostSurfaceFloorTiles.filter((floor) => (
          Number(floor.x) === Number(point.x) && Number(floor.z) === Number(point.z)
        )).map((floor) => ({
          floorKey: generator._getFloorTileGraphKey(floor),
          elevation: floor.elevation,
          roomId: floor.roomId ?? null,
          signedConnectorFloorOwnerId: floor.signedConnectorFloorOwnerId ?? null,
          connectorId: floor.connectorId ?? null,
          connectionId: floor.connectionId ?? null,
          sharedConnectorFloorOwnerIds: floor.sharedConnectorFloorOwnerIds ?? [],
          authoritativeSocketSeamOwnerIds: floor.authoritativeSocketSeamOwnerIds ?? [],
          surface: floor.surface ?? null,
        })),
      })),
    }))
    : null;
  console.log(JSON.stringify({
    code: error.code,
    message: error.message,
    stack: error.stack?.split('\n').slice(0, 12) ?? null,
    diagnostics,
    ...(failedPhysicalPlans ? { failedPhysicalPlans } : {}),
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
