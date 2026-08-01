import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';
import {
  createDungeonAugmentationCompleteLayoutSignature,
} from '../src/dungeon-augmentation/varietySignature.js';
import {
  DUNGEON_SELECTION_BAG_FAMILIES,
} from '../src/dungeon-augmentation/selectionBagWitness.js';
import {
  inspectIndustrialSupplementRealizedStructuralQuality,
} from '../src/dungeon-augmentation/IndustrialSupplementStructuralQuality.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';
import {
  EXPECTED_ELEVATION_MODES,
  EXPECTED_ENCOUNTER_PROFILE_IDS,
  EXPECTED_JUNCTION_KINDS,
  EXPECTED_ROOM_LAYOUT_IDS,
  EXPECTED_TOPOLOGY_TEMPLATE_IDS,
  RELEASE_PERFORMANCE_BUDGET_MS,
  RELEASE_WARM_PROCESS_EVIDENCE_SCHEMA,
  RELEASE_WARM_PROCESS_MODE,
  assertMatchingReleaseProvenance,
  createAcceptedParentWitness,
  createReleaseProvenance,
  createSeedWorkerEvidence,
  readJson,
  selectCorpusEntries,
  validateReleaseSelectionBagWitnesses,
  validateCorpusManifest,
  writeImmutableJson,
  writeImmutableJsonSync,
} from './dungeon-augmentation-release-evidence.mjs';

const PROFILE_ID = 'industrial-supplement-preview-v4';
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const MAXIMUM_FEATURELESS_SPAN_METERS = 33.6;
const JUNCTION_FOOTPRINT_TILES = Object.freeze({
  'through-t': Object.freeze([5, 7]),
  crossroads: Object.freeze([7, 7]),
  'staggered-cross': Object.freeze([5, 13]),
  'stacked-interchange': Object.freeze([9, 13]),
  'over-under-crossover': Object.freeze([7, 7]),
});
const sortedHorizontalSpans = (width, depth) => [width, depth]
  .map((span) => Number(Number(span).toFixed(6)))
  .sort((left, right) => left - right);
const authoredFloorMaskRecord = (room) => {
  const mask = room?.augmentationFloorMask;
  assert.ok(Array.isArray(mask) && mask.length > 0, `${room?.id} has no authored floor mask.`);
  const sourceWidth = Math.max(...mask.map((row) => String(row ?? '').length));
  const sourceDepth = mask.length;
  assert.ok(sourceWidth > 0, `${room.id} has an empty authored floor mask.`);
  const turns = ((Math.trunc(Number(
    room.augmentationPhysicalRotationQuarterTurns
      ?? room.augmentationRotationQuarterTurns
      ?? 0,
  )) % 4) + 4) % 4;
  const columnKeys = [];
  for (let row = 0; row < sourceDepth; row += 1) {
    const values = String(mask[row] ?? '');
    for (let column = 0; column < sourceWidth; column += 1) {
      if (values[column] !== '#') continue;
      const localX = column - Math.floor(sourceWidth / 2);
      const localZ = row - Math.floor(sourceDepth / 2);
      let rotatedX = localX;
      let rotatedZ = localZ;
      if (turns === 1) {
        rotatedX = localZ;
        rotatedZ = -localX;
      } else if (turns === 2) {
        rotatedX = -localX;
        rotatedZ = -localZ;
      } else if (turns === 3) {
        rotatedX = -localZ;
        rotatedZ = localX;
      }
      columnKeys.push(`${Number(room.x) + rotatedX},${Number(room.z) + rotatedZ}`);
    }
  }
  return {
    columnKeys: [...new Set(columnKeys)].sort(),
    realizedWidth: turns % 2 === 1 ? sourceDepth : sourceWidth,
    realizedDepth: turns % 2 === 1 ? sourceWidth : sourceDepth,
  };
};
const assertConnectedTierCells = (tier, label) => {
  const cells = tier?.worldCells ?? [];
  const cellIds = new Set(cells.map(({ id }) => String(id)));
  assert.ok(cellIds.size > 0 && cellIds.size === cells.length, `${label} has invalid world cells.`);
  const adjacency = new Map([...cellIds].map((id) => [id, new Set()]));
  for (const edge of tier.worldConnectivityEdges ?? []) {
    const from = String(edge.fromCellId ?? '');
    const to = String(edge.toCellId ?? '');
    assert.ok(cellIds.has(from) && cellIds.has(to), `${label} has an edge outside its floor tier.`);
    adjacency.get(from).add(to);
    adjacency.get(to).add(from);
  }
  const reachable = new Set();
  const pending = [[...cellIds][0]];
  while (pending.length > 0) {
    const cellId = pending.pop();
    if (reachable.has(cellId)) continue;
    reachable.add(cellId);
    for (const adjacentId of adjacency.get(cellId) ?? []) {
      if (!reachable.has(adjacentId)) pending.push(adjacentId);
    }
  }
  assert.equal(reachable.size, cellIds.size, `${label} is not four-neighbor connected.`);
};
const isGraphOnlyConnection = (plan) => Boolean(
  plan?.isSupplementGraphConnection
  || plan?.graphOnly === true
  || plan?.connectorVariantConstraints?.graphOnly === true
);
const isPhysicalRouteNetworkConnection = (plan) => Boolean(
  (plan?.isDungeonSupplement || plan?.isPaddedByDungeonSupplement)
  && !isGraphOnlyConnection(plan)
  && (
    plan.augmentationOperationType === 'routeNetwork'
    || plan.isRouteNetworkConnection
    || plan.routeNetworkGrantId
  )
);
const realizedVarietyRoom = ({
  room,
  node,
  ordinal,
  encounters,
  chests,
}) => {
  const manifest = room.augmentationModuleManifest ?? {};
  const blueprint = room.augmentationBlueprint ?? null;
  const blueprintRoutes = blueprint
    ? [
      ...(blueprint.routes ?? []).map((route, routeOrdinal) => ({
        ...route,
        localRouteId: `blueprint-route-${routeOrdinal}`,
      })),
      ...((blueprint.sectionRoute ?? []).length >= 2 ? [{
        localRouteId: 'blueprint-section-route',
        floorTierIds: (blueprint.floorTiers ?? []).map(({ id }) => id),
        sectionRoute: blueprint.sectionRoute,
        traversal: 'authored-blueprint-elevation-section',
      }] : []),
    ]
    : null;
  const blueprintGeometry = blueprint ? {
    dimensionsTiles: blueprint.dimensionsTiles ?? null,
    rotationQuarterTurns: room.augmentationPhysicalRotationQuarterTurns
      ?? room.augmentationRotationQuarterTurns
      ?? 0,
    layout: {
      source: 'authored-blueprint',
      blueprintId: blueprint.id ?? null,
      blueprintSchema: blueprint.schema ?? null,
      family: blueprint.family ?? null,
      purpose: blueprint.purpose ?? null,
      dimensionsMeters: blueprint.dimensionsMeters ?? null,
      sectionRoute: blueprint.sectionRoute ?? [],
      physicalTransfers: blueprint.physicalTransfers ?? [],
      voids: blueprint.voids ?? [],
    },
    floorCellMeters: blueprint.floorCellMeters ?? blueprint.tileSizeMeters ?? null,
    floorMask: blueprint.baseMask ?? blueprint.mask ?? [],
    floorTiers: (blueprint.floorTiers ?? []).map((tier) => ({
      ...tier,
      localTierId: tier.id,
    })),
    clearRoutes: blueprintRoutes,
    zones: (blueprint.zones ?? []).map((zone) => ({
      ...zone,
      localZoneId: zone.id,
    })),
  } : null;
  const anchors = room.augmentationAnchors ?? [];
  const roomChests = chests.filter(({ roomId }) => roomId === room.id);
  const rewardSources = roomChests.length > 0
    ? roomChests
    : anchors.filter(({ kind }) => kind === 'reward');
  return {
    ordinal,
    contentRole: node?.contentRole ?? room.augmentationContentRole ?? null,
    moduleManifestId: manifest.id ?? null,
    moduleTemplateId: room.augmentationModuleTemplateId ?? null,
    moduleKind: room.augmentationModuleKind ?? null,
    physicalModuleKind: room.augmentationPhysicalModuleKind ?? null,
    geometry: blueprintGeometry ?? {
      dimensionsTiles: {
        width: Number(room.width),
        depth: Number(room.depth),
      },
      rotationQuarterTurns: room.augmentationRotationQuarterTurns ?? 0,
      layout: manifest.layout ?? null,
      floorCellMeters: manifest.floorCellMeters ?? null,
      floorMask: room.augmentationFloorMask ?? [],
      floorTiers: room.augmentationFloorTiers ?? [],
      clearRoutes: room.augmentationClearRoutes ?? [],
      zones: room.augmentationZones ?? [],
    },
    furnishing: anchors,
    cover: room.augmentationCover ?? [],
    landmarks: room.augmentationLandmarks ?? [],
    lighting: room.augmentationLighting ?? [],
    hazardRecipes: anchors
      .filter(({ kind }) => ['trap', 'hazard', 'environmentalHazard'].includes(kind))
      .map((anchor) => anchor.hazardRecipe ?? (
        anchor.hazardProfileId ? { hazardProfileId: anchor.hazardProfileId } : null
      ))
      .filter(Boolean),
    encounterChoices: encounters
      .filter(({ roomId }) => roomId === room.id)
      .map((encounter) => ({
        encounterProfileId: encounter.encounterProfileId ?? null,
        encounterRecipe: encounter.encounterRecipe ?? null,
        roster: encounter.roster ?? [],
        spatialRoles: encounter.spatialRoles ?? [],
      })),
    rewardRecipes: rewardSources
      .map((reward) => reward.rewardRecipe ?? (
        reward.rewardProfileId ? { rewardProfileId: reward.rewardProfileId } : null
      ))
      .filter(Boolean),
  };
};
const argumentValue = (name) => process.argv
  .find((argument) => argument.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const requestedCount = Number.parseInt(argumentValue('count') ?? '10', 10);
const requestedStart = Number.parseInt(argumentValue('start') ?? '0', 10);
const manifestArgument = argumentValue('manifest');
const corpusTierArgument = argumentValue('tier') ?? 'release';
const outputArgument = argumentValue('output');
const seedWorkerOutputArgument = argumentValue('seed-worker-output');
const ordinalStartArgument = argumentValue('ordinal-start');
const ordinalCountArgument = argumentValue('ordinal-count');
const shardIndexArgument = argumentValue('shard-index');
const shardCountArgument = argumentValue('shard-count');
const progressEnabled = process.argv.includes('--progress');
const summaryOnly = process.argv.includes('--summary');
if (outputArgument) {
  throw new Error(
    'Direct release-shard output is disabled; use run-dungeon-augmentation-release-shard.mjs so every ordinal receives its own watchdog.',
  );
}
if (seedWorkerOutputArgument && !manifestArgument) {
  throw new Error('Evidence output requires --manifest so it has an immutable seed boundary.');
}
if (manifestArgument && !seedWorkerOutputArgument) {
  throw new Error('--manifest evidence runs require the internal --seed-worker-output=<path> mode.');
}

let releaseManifest = null;
let releaseSelection = null;
let releaseProvenance = null;
if (manifestArgument) {
  releaseManifest = validateCorpusManifest(await readJson(path.resolve(projectRoot, manifestArgument)));
  releaseProvenance = await createReleaseProvenance({
    projectRoot,
    profile: DUNGEON_AUGMENTATION_PROFILES[PROFILE_ID],
  });
  assertMatchingReleaseProvenance(
    releaseProvenance,
    releaseManifest.provenance,
    'realized verifier',
  );
  releaseSelection = selectCorpusEntries(releaseManifest, {
    tier: corpusTierArgument,
    ordinalStart: ordinalStartArgument == null ? null : Number.parseInt(ordinalStartArgument, 10),
    ordinalCount: ordinalCountArgument == null ? null : Number.parseInt(ordinalCountArgument, 10),
    shardIndex: shardIndexArgument == null ? null : Number.parseInt(shardIndexArgument, 10),
    shardCount: shardCountArgument == null ? null : Number.parseInt(shardCountArgument, 10),
  });
  if (releaseSelection.entries.length !== 1) {
    throw new Error('--seed-worker-output requires exactly one manifest ordinal.');
  }
}

const seedCount = releaseSelection?.entries.length ?? (
  Number.isFinite(requestedCount) && requestedCount > 0 ? requestedCount : 10
);
const startIndex = releaseSelection?.entries[0]?.rawIndex ?? (
  Number.isFinite(requestedStart) && requestedStart >= 0 ? requestedStart : 0
);
if (!releaseManifest && seedCount >= 100) {
  console.error(
    'NOTICE: raw --start/--count realized sweeps are ad hoc regressions, not release evidence. Use the manifest-based release shard runner.',
  );
}

function runReleaseWorkerWarmup(manifest, targetEntry) {
  const warmupOrdinal = (targetEntry.ordinal + 1) % manifest.entries.length;
  const warmupEntry = manifest.entries[warmupOrdinal];
  const seededRandom = new SeededRandom(hashSeed(warmupEntry.seed));
  let sourceRandomCalls = 0;
  const generator = new DungeonGenerator({
    random: () => {
      sourceRandomCalls += 1;
      return seededRandom.next();
    },
    difficulty: 1,
    augmentationProfileId: PROFILE_ID,
    augmentationSeed: warmupEntry.seed,
    basePlanHash: warmupEntry.basePlanHash,
  });
  const inertTexture = new THREE.Texture();
  inertTexture.name = `releaseWorkerWarmup_${String(warmupOrdinal).padStart(4, '0')}`;
  generator.textureCache.set(inertTexture.name, inertTexture);
  generator._loadRuinTexture = () => inertTexture;
  const startedAt = performance.now();
  let dungeon = null;
  try {
    dungeon = generator.generate();
    const parentWitness = createAcceptedParentWitness(dungeon, sourceRandomCalls);
    assert.equal(parentWitness.hash, warmupEntry.parentWitness.hash);
    assert.equal(dungeon.basePlanHash, warmupEntry.basePlanHash);
    assert.equal(dungeon.augmentationStatus, 'applied');
    assert.equal(dungeon.augmentationReplayDiagnostics?.realizationAttempts, 1);
    // Release workers intentionally retain one timed target per process so a
    // wedged target remains killable by the 180-second watchdog. This real V4
    // preroll warms imports, JIT paths, catalog lookups, and generator caches
    // in that same process, but its diagnostic duration is excluded from the
    // target performance sample. The process watchdog conservatively covers
    // both warm-up and target rather than allowing an unbounded preroll.
    return {
      schema: RELEASE_WARM_PROCESS_EVIDENCE_SCHEMA,
      mode: RELEASE_WARM_PROCESS_MODE,
      completed: true,
      includedInTargetTiming: false,
      targetTimingStartedAfterWarmup: true,
      workerIsolation: 'one-timed-target-per-process',
      watchdogScope: 'warmup-and-target-process',
      watchdogTimeoutMs: RELEASE_PERFORMANCE_BUDGET_MS.ciTimeoutPerSeed,
      targetOrdinal: targetEntry.ordinal,
      warmupOrdinal,
      warmupRawIndex: warmupEntry.rawIndex,
      warmupSeed: warmupEntry.seed,
      warmupBasePlanHash: warmupEntry.basePlanHash,
      warmupParentWitnessHash: parentWitness.hash,
      warmupSourceRandomCalls: sourceRandomCalls,
      warmupAugmentationStatus: dungeon.augmentationStatus,
      warmupRealizationAttempts:
        dungeon.augmentationReplayDiagnostics?.realizationAttempts ?? 0,
      diagnosticElapsedMs: performance.now() - startedAt,
    };
  } finally {
    generator._disposeGeneratedDungeonCandidate(dungeon);
    inertTexture.dispose();
  }
}

const records = [];
const skippedParentSeeds = [];
let index = startIndex;
let currentManifestEntry = null;
let evidenceWritten = false;
const evidenceOutputArgument = seedWorkerOutputArgument;
const resolvedOutputPath = evidenceOutputArgument
  ? path.resolve(projectRoot, evidenceOutputArgument)
  : null;

const writeFailureEvidence = (error) => {
  if (!releaseManifest || !releaseSelection || !resolvedOutputPath || evidenceWritten) return;
  const artifact = createSeedWorkerEvidence({
    manifest: releaseManifest,
    selection: releaseSelection,
    provenance: releaseProvenance,
    records,
    result: 'failed',
    failure: {
      errorName: error?.name ?? 'Error',
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
      currentOrdinal: currentManifestEntry?.ordinal ?? null,
      currentSeed: currentManifestEntry?.seed ?? null,
    },
  });
  writeImmutableJsonSync(resolvedOutputPath, artifact);
  evidenceWritten = true;
};

if (releaseManifest) {
  process.once('uncaughtException', (error) => {
    try {
      writeFailureEvidence(error);
    } catch (evidenceError) {
      console.error(`Could not write failed release evidence: ${evidenceError.stack ?? evidenceError}`);
    }
    console.error(error?.stack ?? error);
    process.exit(1);
  });
}

let releaseWarmProcessEvidence = null;
if (releaseManifest) {
  currentManifestEntry = releaseSelection.entries[0];
  releaseWarmProcessEvidence = runReleaseWorkerWarmup(
    releaseManifest,
    currentManifestEntry,
  );
}

while (records.length < seedCount) {
  currentManifestEntry = releaseSelection?.entries[records.length] ?? null;
  const rawIndex = currentManifestEntry?.rawIndex ?? index;
  const suffix = String(rawIndex).padStart(3, '0');
  const seed = currentManifestEntry?.seed ?? `layout:augmentation-realized-v4-${suffix}`;
  const basePlanHash = currentManifestEntry?.basePlanHash
    ?? `v1:${seed}:depth:1:revolvingFusillade`;
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
  let generationCompletedAt = null;
  let dungeon = null;
  let acceptedParentWitness = null;
  let acceptedParentParity = currentManifestEntry == null;
  try {
    try {
      dungeon = generator.generate();
      generationCompletedAt = performance.now();
    } catch (candidateParentError) {
      if (currentManifestEntry) {
        throw new Error(
          `Accepted-parent manifest seed ${seed} failed during augmented realization: ${candidateParentError.message}`,
          { cause: candidateParentError },
        );
      }
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
    acceptedParentWitness = createAcceptedParentWitness(dungeon, sourceRandomCalls);
    if (currentManifestEntry) {
      assert.equal(
        acceptedParentWitness.hash,
        currentManifestEntry.parentWitness.hash,
        `Augmentation changed the accepted parent witness for corpus ordinal ${currentManifestEntry.ordinal}.`,
      );
      assert.equal(dungeon.basePlanHash, currentManifestEntry.basePlanHash);
      acceptedParentParity = true;
    }
    assert.equal(
      dungeon.progression?.validation?.accepted,
      true,
      dungeon.progression?.validation?.errors?.join('\n'),
    );
    assert.ok(['applied', 'unchanged'].includes(dungeon.augmentationStatus));
    const supplementalRooms = dungeon.rooms.filter((room) => room.isDungeonSupplement);
    const routeStationProxies = [...(dungeon.connectorJunctionProxies ?? [])];
    const leakedRouteStationProxies = dungeon.rooms.filter((room) => (
      room.isRouteStationProxy === true || room.isConnectorJunctionProxy === true
    ));
    const authoredRooms = dungeon.rooms.filter((room) => !room.isDungeonSupplement);
    assert.equal(
      dungeon.rooms.length,
      authoredRooms.length + supplementalRooms.length,
      'Every realized room record must be authored or a substantive supplement.',
    );
    assert.deepEqual(
      leakedRouteStationProxies.map(({ id }) => id),
      [],
      'Connector junction proxies must not leak into the realized room facade.',
    );
    assert.ok(routeStationProxies.every((room) => (
      room.isDungeonSupplement === false
        && room.suppressRoomGeometry === true
        && room.isConnectorJunctionProxy === true
        && (
          room.isRouteStationProxy === true
          || room.isSupplementConnectorModule === true
          || room.isSupplementConnectorJunction === true
        )
    )), 'Connector proxies must remain geometry-suppressed non-room identities.');
    assert.equal(
      new Set(routeStationProxies.map(({ id }) => id)).size,
      routeStationProxies.length,
      'Connector junction proxy identities must be unique.',
    );
    const routeStationProxyIds = new Set(routeStationProxies.map(({ id }) => id));
    let networkCount = 0;
    let moduleCount = 0;
    let physicalNodeCount = 0;
    let pyramidLoopCount = 0;
    let coverageNetworkCount = 0;
    let maximumFeaturelessSpanMeters = 0;
    let topologyTemplateIds = [];
    let junctionKinds = [];
    let elevationModes = [];
    let topologyTemplateSelections = [];
    let junctionKindSelections = [];
    let elevationModeSelections = [];
    let encounterProfileSelections = [];
    let roomLayoutSelections = [];
    let completeLayoutSignatures = [];
    let selectionBagWitnesses = Object.fromEntries(
      DUNGEON_SELECTION_BAG_FAMILIES.map((family) => [family, []]),
    );
    if (dungeon.augmentationStatus === 'applied') {
      assert.equal(
        dungeon.augmentationReplayDiagnostics?.realizationAttempts,
        1,
        'A release-corpus V4 layout must apply on its first derived augmentation seed.',
      );
      const overlay = dungeon.augmentationOverlayPlan;
      const routeNetworks = (overlay?.operations ?? []).filter(({ type }) => (
        type === 'routeNetwork'
      ));
      const overlayNodes = overlay?.nodes ?? [];
      const supplementRoomNodes = overlayNodes.filter(({ kind }) => kind === 'supplementRoom');
      const connectorModuleNodes = overlayNodes.filter(({ kind }) => (
        kind === 'supplementConnectorModule'
      ));
      const connectorJunctionNodes = overlayNodes.filter(({ kind }) => (
        kind === 'supplementConnectorJunction'
      ));
      const connectorNodes = [...connectorModuleNodes, ...connectorJunctionNodes];
      const meaningfulJunctionNodes = overlayNodes.filter((node) => (
        Number(node.graphDegree ?? node.junction?.graphDegree ?? 0) >= 3
          && node.junction?.countsAsMeaningfulStation === true
      ));
      const promotedJunctionNodes = connectorJunctionNodes.filter((node) => (
        Number(node.graphDegree ?? node.junction?.graphDegree ?? 0) >= 3
          && node.junction?.countsAsMeaningfulStation === true
      ));
      const supplementRoomNodeIds = new Set(supplementRoomNodes.map(({ id }) => id));
      const connectorNodeIds = new Set(connectorNodes.map(({ id }) => id));
      const nodeById = new Map(overlayNodes.map((node) => [node.id, node]));
      networkCount = routeNetworks.length;
      physicalNodeCount = overlayNodes.length;
      moduleCount = routeNetworks.reduce((count, operation) => (
        count + Number(operation.substantiveModuleCount ?? operation.moduleCount ?? 0)
      ), 0);
      pyramidLoopCount = routeNetworks.filter(({ routeNetworkKind }) => (
        routeNetworkKind === 'landmark-perimeter-loop'
      )).length;
      coverageNetworkCount = routeNetworks.filter(({ routeNetworkKind }) => (
        routeNetworkKind === 'objective-route-coverage'
      )).length;
      const featurelessSpans = routeNetworks.flatMap((operation) => (
        operation.featurelessSpans ?? []
      )).map(({ distanceMeters }) => Number(distanceMeters));
      maximumFeaturelessSpanMeters = Math.max(0, ...featurelessSpans);
      topologyTemplateSelections = routeNetworks
        .map(({ topologyTemplateId }) => topologyTemplateId)
        .filter(Boolean);
      junctionKindSelections = promotedJunctionNodes
        .map((node) => node.junction?.junctionKind ?? node.junctionKind)
        .filter(Boolean);
      elevationModeSelections = routeNetworks
        .flatMap((operation) => operation.elevationModes ?? [])
        .filter(Boolean);
      encounterProfileSelections = routeNetworks
        .flatMap((operation) => operation.selectionManifest?.encounters ?? [])
        .map(({ encounterProfileId }) => encounterProfileId)
        .filter(Boolean);
      roomLayoutSelections = routeNetworks
        .flatMap((operation) => operation.selectionManifest?.roomLayouts ?? [])
        .map(({ grammarId }) => grammarId)
        .filter(Boolean);
      selectionBagWitnesses = Object.fromEntries(
        DUNGEON_SELECTION_BAG_FAMILIES.map((family) => [
          family,
          routeNetworks.flatMap((operation) => {
            const operationWitnesses = operation.selectionManifest?.bagWitnesses;
            if (Array.isArray(operationWitnesses)) {
              return operationWitnesses.filter((witness) => witness?.family === family);
            }
            const familyWitnesses = operationWitnesses?.[family];
            return Array.isArray(familyWitnesses) ? familyWitnesses : [];
          }),
        ]),
      );
      validateReleaseSelectionBagWitnesses(selectionBagWitnesses);
      topologyTemplateIds = [...new Set(topologyTemplateSelections)];
      junctionKinds = [...new Set(junctionKindSelections)];
      elevationModes = [...new Set(elevationModeSelections)];
      const physicalSupplementConnections = dungeon.connectionPlans.filter(
        isPhysicalRouteNetworkConnection,
      );
      const graphOnlyConnections = dungeon.connectionPlans.filter(isGraphOnlyConnection);
      const graphOnlyConnectionIdSet = new Set(graphOnlyConnections.map(({ id }) => id));
      const progressionConnections = [
        ...(dungeon.progression?.roomConnections ?? []),
        ...(dungeon.progression?.supplementalRoomConnections ?? []),
      ];
      const progressionGraphOnlyConnectionIds = [...new Set(progressionConnections
        .map((connection) => connection.id ?? connection.connectorId)
        .filter((connectionId) => graphOnlyConnectionIdSet.has(connectionId)))].sort();
      assert.deepEqual(
        progressionGraphOnlyConnectionIds,
        [],
        'Graph-only connector records must not enter progression connection counts.',
      );
      const minimapRooms = dungeon.minimap?.rooms ?? [];
      const minimapHallways = dungeon.minimap?.hallways ?? dungeon.minimap?.connections ?? [];
      const minimapGraphOnlyConnectionIds = minimapHallways
        .map((hallway) => (
          hallway.hallwayId ?? hallway.connectionId ?? hallway.connectorId ?? hallway.id
        ))
        .filter((connectionId) => graphOnlyConnectionIdSet.has(connectionId))
        .sort();
      assert.deepEqual(
        minimapGraphOnlyConnectionIds,
        [],
        'Graph-only connector records must not enter minimap hallway counts.',
      );
      const minimapProxyRoomIds = minimapRooms
        .map((room) => room.roomId ?? room.id)
        .filter((roomId) => routeStationProxyIds.has(roomId));
      const minimapConnectedProxyRoomIds = minimapRooms
        .flatMap((room) => room.connectedRoomIds ?? [])
        .filter((roomId) => routeStationProxyIds.has(roomId));
      const minimapHallwayProxyRoomIds = minimapHallways
        .flatMap((hallway) => [
          hallway.fromRoomId ?? hallway.fromNodeId ?? hallway.from,
          hallway.toRoomId ?? hallway.toNodeId ?? hallway.to,
        ])
        .filter((roomId) => routeStationProxyIds.has(roomId));
      assert.deepEqual(
        [...new Set([
          ...minimapProxyRoomIds,
          ...minimapConnectedProxyRoomIds,
          ...minimapHallwayProxyRoomIds,
        ])].sort(),
        [],
        'Connector junction proxies must not enter minimap room connectivity.',
      );
      const progressionProxyRoomIds = [
        ...(dungeon.progression?.rooms ?? []).map((room) => room.roomId ?? room.id),
        ...(dungeon.progression?.bands ?? []).flatMap((band) => band.roomIds ?? []),
      ].filter((roomId) => routeStationProxyIds.has(roomId));
      assert.deepEqual(
        [...new Set(progressionProxyRoomIds)].sort(),
        [],
        'Connector junction proxies must not enter progression room counts.',
      );
      const progressionConnectionProxyIds = progressionConnections
        .flatMap((connection) => [
          connection.fromRoomId ?? connection.fromNodeId ?? connection.from,
          connection.toRoomId ?? connection.toNodeId ?? connection.to,
        ])
        .filter((roomId) => routeStationProxyIds.has(roomId));
      assert.deepEqual(
        [...new Set(progressionConnectionProxyIds)].sort(),
        [],
        'Connector proxies must not enter progression connection endpoints.',
      );
      const encounterOrRewardProxyIds = [
        ...(dungeon.encounters ?? []),
        ...(dungeon.rewards ?? []),
        ...(dungeon.chests ?? []),
      ].map((record) => record.roomId ?? record.nodeId ?? record.ownerRoomId)
        .filter((roomId) => routeStationProxyIds.has(roomId));
      assert.deepEqual(
        [...new Set(encounterOrRewardProxyIds)].sort(),
        [],
        'Connector proxies must not host encounters or rewards.',
      );
      const platformability = dungeon.progression.validation.platformability;
      assert.equal(overlay?.schema, 'ruindivex-dungeon-augmentation-overlay/v2');
      assert.equal(routeNetworks.length, overlay.operations.length);
      const routeNetworkGrantIds = routeNetworks.map(({ grantId }) => String(grantId ?? ''));
      assert.ok(
        routeNetworkGrantIds.every(Boolean)
          && new Set(routeNetworkGrantIds).size === routeNetworks.length,
        'Every realized route network must consume one distinct exact parent grant.',
      );
      assert.deepEqual(
        overlay.routeNetworkGrantIds,
        routeNetworks.map(({ grantId }) => grantId),
        'The overlay grant manifest must name every and only realized route network.',
      );
      assert.ok(networkCount >= 3 && networkCount <= 8);
      assert.equal(pyramidLoopCount, 1);
      assert.ok(coverageNetworkCount >= 1);
      assert.ok(moduleCount >= networkCount * 3 && moduleCount <= 30);
      assert.ok(routeNetworks.every((operation) => {
        const operationNodes = operation.nodeIds.map((nodeId) => nodeById.get(nodeId));
        const operationRooms = operationNodes.filter((node) => node?.kind === 'supplementRoom');
        const operationConnectorModules = operationNodes.filter((node) => (
          node?.kind === 'supplementConnectorModule'
        ));
        const operationJunctions = operationNodes.filter((node) => (
          node?.kind === 'supplementConnectorJunction'
        ));
        const derivedSubstantiveModuleCount = operationRooms.length + operationJunctions.length;
        return operationNodes.every(Boolean)
          && derivedSubstantiveModuleCount >= 3
          && derivedSubstantiveModuleCount <= 6
          && operation.substantiveModuleCount === derivedSubstantiveModuleCount
          && operation.moduleCount === derivedSubstantiveModuleCount
          && operation.physicalNodeCount === operation.nodeIds.length
          && operation.connectorModuleCount === operationConnectorModules.length
          && JSON.stringify([...(operation.connectorModuleNodeIds ?? [])].sort())
            === JSON.stringify(operationConnectorModules.map(({ id }) => id).sort())
          && JSON.stringify([...(operation.connectorJunctionNodeIds ?? [])].sort())
            === JSON.stringify(operationJunctions.map(({ id }) => id).sort())
          && operationJunctions.some((node) => (
            Number(node.graphDegree ?? node.junction?.graphDegree ?? 0) >= 3
              && node.junction?.countsAsMeaningfulStation === true
          ))
          && operation.endpointSocketIds.length >= 2
          && operation.returnRouteGuaranteed === true
          && operation.bidirectional === true
          && operation.localProgressionArc.join(':') === 'enter:challenge:mechanism:payoff:reconnect'
          && operation.contentRoles.includes('challenge')
          && operation.contentRoles.includes('reward');
      }), 'A route network violates the V4 3-6 substantive-module contract.');
      assert.ok(routeNetworks.every((operation) => (
        Array.isArray(operation.featurelessSpans)
          && operation.featurelessSpans.length > 0
          && operation.featurelessSpans.every(({ distanceMeters }) => (
            Number.isFinite(Number(distanceMeters))
              && Number(distanceMeters) >= 0
              && Number(distanceMeters) <= MAXIMUM_FEATURELESS_SPAN_METERS + 1e-6
          ))
      )), 'Every network must retain non-vacuous final-graph featureless-span witnesses.');
      const coverageNetworks = routeNetworks.filter(({ routeNetworkKind }) => (
        routeNetworkKind === 'objective-route-coverage'
      ));
      assert.ok(coverageNetworks.every(({ coverage }) => (
        coverage?.coverageComplete === true
          && String(coverage.logicalEdgeId ?? '').length > 0
          && Array.isArray(coverage.ordinaryTraversalSpans)
          && coverage.ordinaryTraversalSpans.length > 0
          && Array.isArray(coverage.stationDistancesMeters)
          && coverage.stationDistancesMeters.length >= 2
          && coverage.stationDistancesMeters.every((distanceMeters) => (
            Number.isFinite(Number(distanceMeters)) && Number(distanceMeters) >= 0
          ))
          && Array.isArray(coverage.featurelessSpansMeters)
          && coverage.featurelessSpansMeters.length > 0
          && coverage.featurelessSpansMeters.every((distanceMeters) => (
            Number.isFinite(Number(distanceMeters))
              && Number(distanceMeters) >= 0
              && Number(distanceMeters) <= MAXIMUM_FEATURELESS_SPAN_METERS + 1e-6
          ))
      )), 'An objective route has missing or vacuous authored-plus-supplement coverage witnesses.');
      assert.deepEqual(
        (overlay.featurelessCoverage ?? []).map(({ operationId }) => operationId).sort(),
        coverageNetworks.map(({ id }) => id).sort(),
        'Final coverage witnesses must exist once for every objective coverage network.',
      );
      assert.ok(maximumFeaturelessSpanMeters <= MAXIMUM_FEATURELESS_SPAN_METERS + 1e-6);
      // A single dungeon must realize real topology, junction, and elevation
      // families, but diversity quotas are corpus properties. Enforcing the
      // 100-seed thresholds here incorrectly rejects a valid compact layout
      // before the aggregate frequency checks below can evaluate variety.
      assert.ok(topologyTemplateIds.length >= 1);
      assert.ok(junctionKinds.length >= 1);
      assert.ok(elevationModes.length >= 1);
      const supplementRoomById = new Map(supplementalRooms.map((room) => [room.id, room]));
      const connectorProxyById = new Map(routeStationProxies.map((room) => [room.id, room]));
      const junctionMetadataRoomById = new Map([
        ...supplementalRooms,
        ...routeStationProxies,
      ].map((room) => [room.id, room]));
      assert.equal(supplementRoomById.size, supplementalRooms.length);
      assert.deepEqual(
        [...supplementRoomById.keys()].sort(),
        [...supplementRoomNodeIds].sort(),
        'Only true supplementRoom nodes may materialize in the room facade.',
      );
      assert.deepEqual(
        [...connectorNodeIds].filter((nodeId) => connectorProxyById.has(nodeId)).sort(),
        [...connectorNodeIds].sort(),
        'Every compact connector node must materialize in connectorJunctionProxies.',
      );
      assert.deepEqual(
        [...connectorNodeIds].filter((nodeId) => supplementRoomById.has(nodeId)).sort(),
        [],
        'Compact connector nodes must never materialize as dungeon rooms.',
      );
      assert.ok(
        supplementalRooms.every((room) => nodeById.has(room.id)),
        'Every substantive supplemental room must belong to the planned V4 module set.',
      );
      assert.equal(
        supplementalRooms.length,
        supplementRoomNodes.length,
        'The realized supplemental room count must exclude compact connector modules.',
      );
      assert.equal(physicalNodeCount, supplementRoomNodes.length + connectorNodes.length);
      assert.equal(
        moduleCount,
        supplementRoomNodes.length + connectorJunctionNodes.length,
        'Only curated rooms and active connector junctions count as substantive V4 modules.',
      );
      assert.equal(
        physicalNodeCount,
        moduleCount + connectorModuleNodes.length,
        'Degree-two connector infrastructure must remain physical without consuming module budget.',
      );
      assert.ok(supplementalRooms.every((room) => (
        room.augmentationModuleManifest
          && Array.isArray(room.augmentationFloorMask)
          && room.augmentationFloorMask.length > 0
      )), 'Every V4 content room must resolve a curated authored module manifest.');
      const floorTilesByColumn = new Map();
      for (const floor of dungeon.floorTiles) {
        const key = `${floor.x},${floor.z}`;
        const floors = floorTilesByColumn.get(key) ?? [];
        floors.push(floor);
        floorTilesByColumn.set(key, floors);
      }
      const authoredFloorMasksByRoomId = new Map();
      for (const room of supplementalRooms) {
        assert.equal(
          room.augmentationStructuralQualityReport?.accepted,
          true,
          `${room.id} did not retain its accepted structural-quality report.`,
        );
        const structuralQuality = inspectIndustrialSupplementRealizedStructuralQuality(room);
        assert.equal(
          structuralQuality.accepted,
          true,
          `${room.id} failed realized structural quality: ${structuralQuality.errors.join(', ')}`,
        );
        assert.deepEqual(
          structuralQuality.metrics.accessibleExitSocketIds,
          structuralQuality.metrics.requiredExitSocketIds,
          `${room.id} does not expose every required authored exit route.`,
        );
        assert.ok(
          structuralQuality.metrics.sightlines.every(({ accepted }) => accepted),
          `${room.id} has an obstructed authored sightline.`,
        );
        assert.deepEqual(
          room.augmentationFloorMask,
          room.augmentationBlueprint?.baseMask
            ?? room.augmentationBlueprint?.mask
            ?? room.augmentationModuleManifest?.floorMask,
          `${room.id} does not retain its authoritative ${
            room.augmentationBlueprint ? 'blueprint' : 'manifest'
          } floor mask.`,
        );
        const mask = authoredFloorMaskRecord(room);
        authoredFloorMasksByRoomId.set(room.id, mask);
        assert.equal(room.width, mask.realizedWidth, `${room.id} floor-mask width is inconsistent.`);
        assert.equal(room.depth, mask.realizedDepth, `${room.id} floor-mask depth is inconsistent.`);
        const roomBaseElevation = Number(room.plannedBaseElevation ?? room.baseElevation ?? 0);
        const authoredTiers = room.augmentationFloorTiers ?? [];
        assert.ok(authoredTiers.length > 0, `${room.id} has no authored floor tiers.`);
        for (const tier of authoredTiers) {
          assertConnectedTierCells(tier, `${room.id}:${tier.id}`);
          assert.ok(Number.isFinite(Number(tier.worldElevation)));
          assert.ok((tier.worldCells ?? []).every((cell) => (
            Number.isFinite(Number(cell.grid?.x))
              && Number.isFinite(Number(cell.grid?.z))
              && Math.abs(Number(cell.elevation) - Number(tier.worldElevation)) <= 0.05
          )), `${room.id}:${tier.id} has inconsistent transformed tier cells.`);
          assert.ok((tier.worldCells ?? []).every((cell) => (
            (floorTilesByColumn.get(`${cell.grid.x},${cell.grid.z}`) ?? []).some((floor) => (
              floor.roomId === room.id
              && (
                Math.abs(Number(floor.elevation ?? 0) - Number(cell.elevation)) <= 0.05
                || (
                  Math.abs(Number(tier.elevation ?? 0)) <= 0.05
                  && floor.rampBaseOriginal?.roomId === room.id
                  && Math.abs(
                    Number(floor.rampBaseOriginal?.elevation ?? 0)
                      - Number(cell.elevation),
                  ) <= 0.05
                )
              )
            ))
          )), `${room.id}:${tier.id} does not realize every authored tier cell.`);
        }
        const baseTier = authoredTiers.find(({ elevation }) => (
          Math.abs(Number(elevation ?? 0)) <= 0.05
        ));
        assert.ok(baseTier, `${room.id} has no authored base-floor tier.`);
        assert.ok(Math.abs(Number(baseTier.worldElevation) - roomBaseElevation) <= 0.05);
        assert.deepEqual(
          [...new Set(baseTier.worldCells.map(({ grid }) => `${grid.x},${grid.z}`))].sort(),
          mask.columnKeys,
          `${room.id} transformed base tier diverges from its floor mask.`,
        );
        const baseTierFloorCellIds = new Set((baseTier.worldCells ?? [])
          .map(({ id }) => String(id ?? ''))
          .filter(Boolean));
        const realizedBaseColumnKeys = [...new Set(dungeon.floorTiles
          .filter((floor) => (
            floor.roomId === room.id
              && (baseTierFloorCellIds.has(String(floor.augmentationFloorCellId ?? ''))
                || baseTierFloorCellIds.has(String(
                  floor.rampBaseOriginal?.augmentationFloorCellId ?? '',
                )))
          ))
          .map((floor) => `${floor.x},${floor.z}`))].sort();
        assert.deepEqual(
          realizedBaseColumnKeys,
          mask.columnKeys,
          `${room.id} was rectangle-stamped or lost authored floor-mask cells.`,
        );
        assert.ok(realizedBaseColumnKeys.every((columnKey) => (
          (floorTilesByColumn.get(columnKey) ?? []).some((floor) => (
            floor.roomId === room.id
              && floor.augmentationModuleTemplateId === room.augmentationModuleTemplateId
          ))
        )), `${room.id} floor-mask cells lost their authoritative module identity.`);
      }
      const overlayPhysicalArmIdsByNodeId = new Map(connectorNodes.map(({ id }) => (
        [id, new Set()]
      )));
      for (const segment of overlay?.segments ?? []) {
        for (const endpoint of [segment.from, segment.to]) {
          if (overlayPhysicalArmIdsByNodeId.has(endpoint?.nodeId)) {
            overlayPhysicalArmIdsByNodeId.get(endpoint.nodeId).add(String(segment.id));
          }
        }
      }
      for (const node of connectorJunctionNodes) {
        if (node.exactParentEndpoint !== true
          || node.parentEndpointSocketKind !== 'authored-corridor-station') continue;
        const contribution = Math.min(
          1,
          Math.max(0, Number(node.parentThroughRouteDegreeContribution ?? 0)),
        );
        for (let index = 0; index < contribution; index += 1) {
          overlayPhysicalArmIdsByNodeId.get(node.id)
            ?.add(String(
              node.parentThroughPhysicalArmId ?? `${node.id}:authored-through:${index}`,
            ));
        }
      }
      for (const node of connectorNodes) {
        const proxy = connectorProxyById.get(node.id);
        const expectedArmIds = [...(overlayPhysicalArmIdsByNodeId.get(node.id) ?? [])].sort();
        const activeDegree = Number(node.graphDegree ?? node.junction?.graphDegree ?? 0);
        const junctionKind = node.junction?.junctionKind ?? node.junctionCandidateKind;
        const expectedFootprint = JUNCTION_FOOTPRINT_TILES[junctionKind];
        assert.ok(proxy, `${node.id} has no realized connector proxy.`);
        assert.ok(expectedFootprint, `${node.id} declares unknown junction kit ${junctionKind}.`);
        assert.equal(proxy.kind, node.kind);
        assert.deepEqual([...(proxy.physicalArmIds ?? [])].sort(), expectedArmIds);
        assert.equal(Number(proxy.physicalArmCount ?? 0), expectedArmIds.length);
        assert.equal(activeDegree, expectedArmIds.length);
        assert.deepEqual(
          sortedHorizontalSpans(
            Number(node.size?.x ?? 0) / Number(dungeon.tileSize),
            Number(node.size?.z ?? 0) / Number(dungeon.tileSize),
          ),
          expectedFootprint,
          `${node.id} does not use the exact ${junctionKind} planning footprint.`,
        );
        assert.deepEqual(
          sortedHorizontalSpans(proxy.width, proxy.depth),
          expectedFootprint,
          `${node.id} does not realize the exact ${junctionKind} footprint.`,
        );
        if (node.kind === 'supplementConnectorJunction') {
          assert.ok(activeDegree >= 3, `${node.id} was promoted without three active arms.`);
          assert.equal(node.junction?.countsAsMeaningfulStation, true);
          assert.equal(proxy.countsAsMeaningfulStation, true);
        } else {
          assert.equal(activeDegree, 2, `${node.id} should be degree-two traversal infrastructure.`);
          assert.equal(node.junction?.countsAsMeaningfulStation, false);
          assert.equal(proxy.countsAsMeaningfulStation, false);
        }
        const coreFloors = dungeon.floorTiles.filter((floor) => (
          floor.connectorJunctionOwnerId === node.id
        ));
        const expectedCoreFloorKeys = (proxy.augmentationFloorTiers ?? [])
          .filter(({ authoritative, worldCells }) => (
            authoritative === true && Array.isArray(worldCells)
          ))
          .flatMap(({ worldCells, worldElevation }) => worldCells.map((cell) => (
            `${cell.grid.x},${cell.grid.z}@${Number(
              cell.elevation ?? worldElevation,
            ).toFixed(3)}`
          )))
          .sort();
        assert.ok(
          expectedCoreFloorKeys.length > 0,
          `${node.id} has no authoritative connector-core floor cells.`,
        );
        assert.deepEqual(
          coreFloors.map((floor) => (
            `${floor.x},${floor.z}@${Number(floor.elevation ?? 0).toFixed(3)}`
          )).sort(),
          expectedCoreFloorKeys,
          `${node.id} does not own its exact authored connector-core floor cells.`,
        );
      }
      const planOwnsFloor = (plan, floor) => Boolean(
        floor?.signedConnectorFloorOwnerId === plan.id
        || floor?.connectorId === plan.id
        || floor?.connectionId === plan.id
        || (floor?.sharedConnectorFloorOwnerIds ?? []).includes(plan.id)
        || (floor?.authoritativeSocketSeamOwnerIds ?? []).includes(plan.id)
      );
      const pointHasOwnedFloor = (plan, point, index, path, centerlineCheck) => (
        (floorTilesByColumn.get(`${point.x},${point.z}`) ?? []).some((floor) => {
          const expectedElevations = centerlineCheck?.expectedElevations ?? [];
          const hasExactExpectedElevation = expectedElevations.some((elevation) => (
            Math.abs(Number(floor.elevation ?? 0) - Number(elevation)) <= 0.05
          ));
          if (!hasExactExpectedElevation) return false;
          // V4 has no coordinate- or endpoint-room ownership fallback. A
          // centerline floor is legal only when the finalized physical record
          // names this connector directly, including exact seam ownership
          // stamped from the supplied 15-cell record. Vertical transfers are
          // handled independently by the explicit traversal contract below.
          return planOwnsFloor(plan, floor);
        })
      );
      const connectivityCheckByConnectionId = new Map(
        platformability.supplementConnectivityChecks.map((check) => [
          check.connectionId,
          check,
        ]),
      );
      for (const plan of physicalSupplementConnections) {
        const path = plan.fullPath ?? plan.augmentationAuthoritativePath ?? plan.bridgePath ?? [];
        const allCenterlineChecks = connectivityCheckByConnectionId.get(plan.id)
          ?.centerlineChecks ?? [];
        const centerlineChecks = path.map((point) => allCenterlineChecks.find((check) => (
          Number(check.x) === Number(point.x) && Number(check.z) === Number(point.z)
        )) ?? null);
        assert.ok(path.length > 0, `${plan.id} has no realized physical centerline.`);
        assert.ok(
          centerlineChecks.every(Boolean),
          `${plan.id} omits an ordered centerline point from physical validation.`,
        );
        const unownedCenterlinePoints = path.map((point, pointIndex) => ({
          point,
          pointIndex,
          check: centerlineChecks[pointIndex] ?? null,
        })).filter(({ point, pointIndex, check }) => (
          !pointHasOwnedFloor(plan, point, pointIndex, path, check)
            && check?.contractTraversal !== true
        ));
        assert.deepEqual(
          unownedCenterlinePoints,
          [],
          `${plan.id} uses an interior floor not owned by that physical connector: ${JSON.stringify(
            unownedCenterlinePoints.slice(0, 3).map(({ point, pointIndex, check }) => ({
              point,
              pointIndex,
              check,
              floors: floorTilesByColumn.get(`${point.x},${point.z}`) ?? [],
            })),
          )}`,
        );
        assert.ok(centerlineChecks.every((check) => (
          check.contractTraversal === true
          || (
            check.elevationMatchesExpected === true
            && check.expectedElevations.length > 0
          )
        )), `${plan.id} realizes a centerline at the wrong elevation.`);
      }
      assert.ok(supplementalRooms.every((room) => (
        (floorTilesByColumn.get(`${room.x},${room.z}`) ?? [])
          .some((floor) => floor.roomId === room.id)
      )), 'One or more V4 modules have no realized room-owned center floor.');

      const findFloorAtElevation = (x, z, elevation, predicate = () => true) => (
        (floorTilesByColumn.get(`${x},${z}`) ?? []).find((floor) => (
          Math.abs(Number(floor.elevation ?? 0) - Number(elevation ?? 0)) <= 0.56
          && predicate(floor)
        )) ?? null
      );

      const realizedApproachRoomIds = [...new Set([
        ...nodeById.keys(),
        ...routeStationProxies.map(({ id }) => id),
      ])].sort();
      const actualNetworkNodeApproaches = Object.fromEntries(realizedApproachRoomIds.map((nodeId) => {
        const room = junctionMetadataRoomById.get(nodeId);
        const approaches = new Set();
        for (const plan of physicalSupplementConnections.filter((candidate) => (
          candidate.fromRoomId === nodeId || candidate.toRoomId === nodeId
        ))) {
          const socket = plan.fromRoomId === nodeId ? plan.fromSocket : plan.toSocket;
          const facingX = Math.sign(Number(socket?.facingX ?? 0));
          const facingZ = Math.sign(Number(socket?.facingZ ?? 0));
          if (!socket || Math.abs(facingX) + Math.abs(facingZ) !== 1) continue;
          const thresholdFloor = findFloorAtElevation(
            socket.x,
            socket.z,
            socket.elevation,
            (floor) => floor.roomId === nodeId || planOwnsFloor(plan, floor),
          );
          const outsideFloor = findFloorAtElevation(
            socket.x + facingX,
            socket.z + facingZ,
            socket.elevation,
            (floor) => planOwnsFloor(plan, floor),
          );
          if (!thresholdFloor || !outsideFloor) continue;
          approaches.add(
            `socket:${socket.x},${socket.z},${Number(socket.elevation ?? 0).toFixed(3)}`
            + `:${facingX},${facingZ}`,
          );
        }
        if (room?.isRouteStationProxy) {
          const parentPlan = dungeon.connectionPlans.find((plan) => plan.id === room.parentRouteId);
          assert.ok(parentPlan && !isGraphOnlyConnection(parentPlan));
          const parentPath = parentPlan.bridgePath ?? parentPlan.fullPath ?? [];
          const stationPathIndexes = parentPath.flatMap((point, pointIndex) => (
            point.x === room.x && point.z === room.z
              ? [pointIndex]
              : []
          ));
          assert.equal(stationPathIndexes.length, 1);
          const stationPathIndex = stationPathIndexes[0];
          const stationFloor = findFloorAtElevation(
            room.x,
            room.z,
            room.baseElevation,
          );
          assert.ok(stationFloor, `${room.id} has no realized parent-route station floor.`);
          for (const point of [
            parentPath[stationPathIndex - 1],
            parentPath[stationPathIndex + 1],
          ]) {
            if (!point) continue;
            const directionX = Math.sign(point.x - room.x);
            const directionZ = Math.sign(point.z - room.z);
            const hasFloor = Boolean(findFloorAtElevation(
              point.x,
              point.z,
              room.baseElevation,
            ));
            if (Math.abs(directionX) + Math.abs(directionZ) === 1 && hasFloor) {
              approaches.add(`parent-route:${directionX},${directionZ}`);
            }
          }
        }
        return [nodeId, [...approaches].sort()];
      }));
      for (const node of connectorJunctionNodes) {
        const proxy = connectorProxyById.get(node.id);
        if (proxy?.isExactParentStationComposite !== true) continue;
        const attachment = physicalSupplementConnections.find((plan) => (
          plan.networkRole === 'parent-station-attachment'
            && (plan.fromRoomId === node.id || plan.toRoomId === node.id)
        ));
        const parentStationProxyId = attachment
          ? (attachment.fromRoomId === node.id ? attachment.toRoomId : attachment.fromRoomId)
          : null;
        const parentStationProxy = connectorProxyById.get(parentStationProxyId);
        const parentApproaches = actualNetworkNodeApproaches[parentStationProxyId] ?? [];
        const localApproaches = actualNetworkNodeApproaches[node.id] ?? [];
        const exactBindingAccepted = Boolean(
          attachment
            && parentStationProxy?.isRouteStationProxy === true
            && String(parentStationProxy.routeNetworkSocketId ?? '')
              === String(proxy.parentEndpointSocketId ?? '')
            && parentApproaches.filter((approach) => (
              approach.startsWith('parent-route:')
            )).length === 2
            && localApproaches.length >= 2
        );
        assert.equal(
          exactBindingAccepted,
          true,
          `${node.id} does not bind its local two-arm core to a realized authored through route.`,
        );
        actualNetworkNodeApproaches[node.id] = [...new Set([
          ...localApproaches,
          `parent-route:${parentStationProxy.parentRouteId}:authored-through`,
        ])].sort();
      }
      const actualNetworkNodeDegrees = Object.fromEntries(Object.entries(
        actualNetworkNodeApproaches,
      ).map(([nodeId, approaches]) => [nodeId, approaches.length]));
      for (const node of connectorNodes) {
        const expectedArmCount = overlayPhysicalArmIdsByNodeId.get(node.id)?.size ?? 0;
        assert.equal(
          Number(actualNetworkNodeDegrees[node.id] ?? 0),
          expectedArmCount,
          `${node.id} does not expose its exact physical connector approaches.`,
        );
      }
      assert.ok(routeNetworks.every((operation) => operation.nodeIds.some((nodeId) => {
        const node = nodeById.get(nodeId);
        const room = connectorProxyById.get(nodeId);
        return Number(actualNetworkNodeDegrees[nodeId] ?? 0) >= 3
          && node?.kind === 'supplementConnectorJunction'
          && node?.countsAsMeaningfulStation === true
          && room?.countsAsMeaningfulStation === true
          && Boolean(room?.junctionKind);
      })));
      completeLayoutSignatures = routeNetworks.map((operation) => (
        createDungeonAugmentationCompleteLayoutSignature({
          legacyFields: {
            topologyTemplateId: operation.topologyTemplateId,
            degreeSequence: operation.nodeIds
              .map((nodeId) => Number(actualNetworkNodeDegrees[nodeId] ?? 0))
              .sort((left, right) => left - right),
            elevationModes: [...(operation.elevationModes ?? [])].sort(),
            contentRoles: [...(operation.contentRoles ?? [])],
          },
          rooms: operation.nodeIds.map((nodeId, ordinal) => {
            const room = supplementRoomById.get(nodeId);
            if (!room) return null;
            return realizedVarietyRoom({
              room,
              node: nodeById.get(nodeId),
              ordinal,
              encounters: dungeon.encounters ?? [],
              chests: dungeon.chests ?? [],
            });
          }).filter(Boolean),
        })
      ));
      const pyramidLoop = routeNetworks.find(({ routeNetworkKind }) => (
        routeNetworkKind === 'landmark-perimeter-loop'
      ));
      assert.equal(pyramidLoop.cycleRankDelta, 1);
      assert.equal(pyramidLoop.landmarkRoomId, 'keycardRoom');
      assert.equal(pyramidLoop.openedWallSides.length, 2);
      assert.equal(new Set([
        ...pyramidLoop.occupiedCriticalWallSides,
        ...pyramidLoop.openedWallSides,
      ]).size, 4);
      assert.ok(physicalSupplementConnections.length >= networkCount * 2);
      assert.ok(
        dungeon.floorTiles.some((tile) => (
          supplementalRooms.some((room) => room.id === tile.roomId)
          && tile.isPlatformingSurface
          && Number(tile.elevation ?? 0) > Number(
            supplementalRooms.find((room) => room.id === tile.roomId)?.baseElevation ?? 0,
          )
        )),
        'V4 has no realized elevated platform surface.',
      );
      assert.ok(
        dungeon.encounters.some(({ roomId }) => supplementalRooms.some(({ id }) => id === roomId)),
        'V4 challenge anchors did not reach the runtime facade.',
      );
      assert.ok(
        dungeon.chests.some(({ roomId }) => supplementalRooms.some(({ id }) => id === roomId)),
        'V4 reward anchors did not reach the runtime facade.',
      );
      const connectorEntrances = dungeon.progression.validation.connectorEntrances;
      assert.ok(connectorEntrances.checkedSocketCount > 0);
      assert.equal(
        connectorEntrances.acceptedSocketCount,
        connectorEntrances.checkedSocketCount,
      );
      assert.ok(
        connectorEntrances.checks.filter((check) => check.strictApproachContract).length
          >= networkCount * 2,
      );
      assert.ok(connectorEntrances.checks.every((check) => (
        check.socketReachable
          && check.outsideReachable
          && check.traversableOutward
          && check.traversableReturn
          && check.blockingWallFacadeId === null
          && (
            !check.strictApproachContract
            || (
              check.requiredLaneCount >= 3
              && check.acceptedLaneCount === check.requiredLaneCount
              && check.requiredApproachDepthTiles === 2
              && check.authoritativeSeamCellCount === 15
              && check.laneChecks.every((lane) => (
                lane.accepted
                  && lane.points.length === 5
                  && lane.points.every((point) => point.exactSeamOwnership)
                  && JSON.stringify(
                    lane.points.map(({ signedDepthTiles }) => signedDepthTiles),
                  ) === JSON.stringify([-2, -1, 0, 1, 2])
              ))
            )
          )
      )));
      const graphOnlyConnectionIds = graphOnlyConnections.map(({ id }) => id).sort();
      assert.equal(
        connectorEntrances.skippedGraphConnectionCount,
        graphOnlyConnectionIds.length,
      );
      assert.deepEqual(
        [...connectorEntrances.skippedGraphConnectionIds].sort(),
        graphOnlyConnectionIds,
        'Connector entrance validation must skip exactly the graph-only plans.',
      );
      assert.ok(connectorEntrances.checks.every(({ connectionId }) => (
        !graphOnlyConnectionIds.includes(connectionId)
      )), 'A graph-only plan leaked into physical connector entrance validation.');
      const expectedStrictSocketIds = [...new Set(physicalSupplementConnections.flatMap((plan) => (
        [plan.fromSocket?.id, plan.toSocket?.id].filter(Boolean)
      )))].sort();
      const checkedStrictSocketIds = connectorEntrances.checks
        .filter(({ strictApproachContract }) => strictApproachContract)
        .map(({ socketId }) => socketId)
        .sort();
      assert.deepEqual(
        checkedStrictSocketIds,
        expectedStrictSocketIds,
        'Every physical V4 aperture, and only a physical V4 aperture, needs the strict approach audit.',
      );
      assert.equal(
        platformability?.segmentBarriersValidated,
        true,
      );
      assert.equal(platformability.orphanSupplementFloorCount, 0);
      assert.equal(platformability.blockedSupplementFloorCount, 0);
      assert.equal(platformability.nonReturnableSupplementFloorCount, 0);
      assert.equal(
        platformability.supplementConnectivityChecks.length,
        physicalSupplementConnections.length,
      );
      const physicalSupplementConnectionIds = physicalSupplementConnections
        .map(({ id }) => id)
        .sort();
      assert.deepEqual(
        platformability.supplementConnectivityChecks
          .map(({ connectionId }) => connectionId)
          .sort(),
        physicalSupplementConnectionIds,
        'Physical connectivity validation must cover the exact V4 plan set.',
      );
      assert.ok(platformability.supplementConnectivityChecks.every((check) => (
        check.accepted
          && check.centerlinePointCount > 0
          && check.centerlineChecks.every((point) => (
            (point.floorKey || point.contractTraversal)
            && point.reachable
            && (
              point.contractTraversal
              || (point.elevationMatchesExpected && point.expectedElevations.length > 0)
            )
          ))
          && check.verticalContractChecks.every((contract) => contract.accepted)
          && check.missingOwnedCenterlinePointCount === 0
          && check.unreachableCenterlinePointCount === 0
          && check.strictLocalComponentAccepted
          && check.locallyUnreachableTraversalFloorKeys.length === 0
          && check.locallyNonReturnableTraversalFloorKeys.length === 0
      )));
      assert.equal(
        platformability.supplementRoomConnectivityChecks.length,
        supplementalRooms.length,
      );
      assert.deepEqual(
        platformability.supplementRoomConnectivityChecks
          .map(({ roomId }) => roomId)
          .sort(),
        supplementalRooms.map(({ id }) => id).sort(),
        'Room connectivity validation must cover the exact realized V4 room set.',
      );
      assert.ok(platformability.supplementRoomConnectivityChecks.every((check) => {
        const authoredMask = authoredFloorMasksByRoomId.get(check.roomId);
        return Boolean(authoredMask)
          && check.accepted
          && check.attachedPhysicalConnectionIds.length > 0
          && check.attachedPhysicalConnectionIds.every((connectionId) => (
            physicalSupplementConnectionIds.includes(connectionId)
            && !graphOnlyConnectionIds.includes(connectionId)
          ))
          && check.totalNavigableFloorCount > 0
          && check.realizedRoomOwnedFloorCount
            === check.totalNavigableFloorCount + check.authoredBlockingRoomFloorCount
          && check.reachableFloorCount === check.totalNavigableFloorCount
          && check.expectedBaseFootprintFloorCount === authoredMask.columnKeys.length
          && check.realizedBaseFootprintFloorCount === check.expectedBaseFootprintFloorCount
          && check.baseFootprintCoverageAccepted
          && check.missingBaseFootprintColumnKeys.length === 0
          && check.nonNavigableBaseFootprintFloorKeys.length === 0
          && check.globallyUnreachableBaseFootprintFloorKeys.length === 0
          && check.locallyUnreachableBaseFootprintFloorKeys.length === 0
          && check.locallyNonReturnableBaseFootprintFloorKeys.length === 0
          && check.unexpectedNonNavigableRoomFloorKeys.length === 0
          && check.outsideDeclaredRoomFloorKeys.length === 0
          && check.foreignRoomFloorOwnership.length === 0
          && check.globallyNonReturnableRoomFloorKeys.length === 0
          && check.orphanFloorKeys.length === 0
          && check.localRoomConnectivityAccepted
          && check.locallyUnreachableRoomFloorKeys.length === 0
          && check.locallyNonReturnableRoomFloorKeys.length === 0
          && check.localApproachChecks.every((approach) => (
            approach.floorKey
            && approach.reachableFromFirstApproach
            && approach.returnReachable
          ));
      }));
      const realizedJunctionRoomIds = [...new Set([
        ...routeStationProxies.map(({ id }) => id),
        ...meaningfulJunctionNodes
          .filter(({ kind }) => kind === 'supplementRoom')
          .map(({ id }) => id),
      ])].sort();
      assert.deepEqual(
        platformability.supplementJunctionConnectivityChecks
          .map(({ roomId }) => roomId)
          .sort(),
        realizedJunctionRoomIds,
        'Connector validation must cover every and only realized connector proxy.',
      );
      assert.ok(platformability.supplementJunctionConnectivityChecks.every((check) => (
        (() => {
          const proxy = connectorProxyById.get(check.roomId);
          const overlayNode = nodeById.get(check.roomId);
          const plainConnectorModule = proxy?.isSupplementConnectorModule === true
            || overlayNode?.kind === 'supplementConnectorModule';
          const exactParentStationComposite = proxy?.isExactParentStationComposite === true;
          const expectedApproachCount = plainConnectorModule || exactParentStationComposite
            ? 2
            : Math.max(3, Number(
                proxy?.physicalArmCount
                  ?? overlayNode?.graphDegree
                  ?? overlayNode?.junction?.graphDegree
                  ?? 0
              ));
          const minimumRequiredApproachCount = plainConnectorModule
            || exactParentStationComposite
            ? 2
            : 3;
          const exactOverlayArmCount = check.approachCount === expectedApproachCount;
          const localPhysicalArmIds = [...(proxy?.physicalArmIds ?? [])].filter((armId) => (
            String(armId) !== String(overlayNode?.parentThroughPhysicalArmId ?? '')
            && !String(armId).includes(':authored-through:')
          ));
          const exactAttachedArmIds = !proxy || JSON.stringify(
            [...(check.attachedPhysicalConnectionIds ?? [])].sort(),
          ) === JSON.stringify(localPhysicalArmIds.sort());
          const exactCompositeBound = !exactParentStationComposite || (
            check.exactParentStationComposite === true
              && check.exactParentStationCompositeBound === true
              && Boolean(check.parentStationAttachmentId)
              && platformability.supplementJunctionConnectivityChecks.some((candidate) => (
                candidate.roomId === check.parentStationProxyId
                  && candidate.routeStationProxy === true
                  && candidate.accepted
                  && candidate.approachCount >= 3
              ))
          );
          return check.accepted
            && check.approachCount === expectedApproachCount
            && exactOverlayArmCount
            && exactAttachedArmIds
            && exactCompositeBound
            && check.requiredApproachCount === minimumRequiredApproachCount
            && check.coreFloorCoverageAccepted
            && check.foreignCoreFloorOwnerIds.length === 0
            && check.unownedMergedCoreFloorSourceCount === 0
            && check.coreFloorCount === check.expectedCoreFloorCount
            && check.navigableCoreFloorCount === check.expectedCoreFloorCount
            && check.approachChecks.length === expectedApproachCount
            && check.approachChecks.every((approach) => (
              approach.floorKey
              && approach.globallyReachable
              && approach.locallyReachable
              && approach.returnReachable
            ));
        })()
      )));
      assert.ok(routeNetworks.every((operation) => (
        platformability.supplementJunctionConnectivityChecks.some((check) => (
          check.operationId === operation.id
          && operation.nodeIds.includes(check.roomId)
          && meaningfulJunctionNodes.some(({ id }) => id === check.roomId)
          && check.accepted
          && (
            check.approachCount >= 3
              || (
                check.exactParentStationComposite === true
                  && check.exactParentStationCompositeBound === true
                  && platformability.supplementJunctionConnectivityChecks.some((candidate) => (
                    candidate.roomId === check.parentStationProxyId
                      && candidate.routeStationProxy === true
                      && candidate.accepted
                      && candidate.approachCount >= 3
                  ))
              )
          )
        ))
      )), 'Each route network needs an accepted realized degree-three junction.');
      const verticalCheckByOperationId = new Map(
        platformability.supplementVerticalConnectivityChecks.map((check) => (
          [String(check.operationId), check]
        )),
      );
      assert.deepEqual(
        [...verticalCheckByOperationId.keys()].sort(),
        routeNetworks.map(({ id }) => String(id)).sort(),
        'Complete vertical traversal must be validated once for every route network.',
      );
      for (const operation of routeNetworks) {
        const check = verticalCheckByOperationId.get(String(operation.id));
        const connectedNodeIds = new Set(check?.connectedOperationNodeIds ?? []);
        assert.ok(
          check?.accepted
            && check.allOperationRoomsConnected
            && check.hasRealVerticalTransfer
            && operation.nodeIds.every((nodeId) => connectedNodeIds.has(nodeId)),
          `${operation.id} lacks one complete, connected physical elevation traversal.`,
        );
      }
      const shortcutConnectionIds = physicalSupplementConnections
        .filter((plan) => plan.oneSideActivatedShortcut || plan.shortcutMode)
        .map(({ id }) => id)
        .sort();
      assert.deepEqual(
        platformability.supplementShortcutConnectivityChecks
          .map(({ connectionId }) => connectionId)
          .sort(),
        shortcutConnectionIds,
      );
      assert.ok(platformability.supplementShortcutConnectivityChecks.every((check) => (
        check.accepted
          && check.mechanismRecordAccepted
          && check.initiallyUnavailable
          && check.sourceReachableBeforeActivation
          && check.farSideReachableBeforeActivation
          && check.matchingTraversalLinkIds.length >= 2
          && check.postActivationBidirectional
      )));
      assert.equal(dungeon.progression.validation.effectiveGraph?.accepted, true);
      const lockedDoors = dungeon.doors.filter(({ locked }) => locked);
      assert.ok(lockedDoors.length > 0, 'The Industrial progression has no locked gates to audit.');
      assert.ok(lockedDoors.every((door) => {
        const plan = dungeon.connectionPlans.find((candidate) => (
          candidate.id === door.connectionPlanId
        ));
        const source = plan?.fromSocket;
        return Boolean(
          plan
          && !isGraphOnlyConnection(plan)
          && source
          && door.graphBlockingPosition
          && door.gatePlacementSide === 'source'
          && door.thresholdAnchored === true
          && door.thresholdOwnerRoomId === door.fromRoomId
          && plan.fromRoomId === door.fromRoomId
          && plan.doorId === door.id
          && door.fromPortal?.roomId === source.roomId
          && door.fromPortal?.x === source.x
          && door.fromPortal?.z === source.z
          && Math.hypot(
            door.graphBlockingPosition.x - source.x * dungeon.tileSize,
            door.graphBlockingPosition.y - Number(source.elevation ?? 0),
            door.graphBlockingPosition.z - source.z * dungeon.tileSize,
          ) <= 0.01
        );
      }), 'A locked gate is not anchored to the exact source entrance of its physical corridor.');
      assert.notEqual(dungeon.effectivePlanHash, dungeon.basePlanHash);
    } else {
      assert.equal(supplementalRooms.length, 0);
      assert.equal(routeStationProxies.length, 0);
      assert.equal(dungeon.effectivePlanHash, dungeon.basePlanHash);
      assert.equal(dungeon.augmentationReplayDiagnostics?.fallbackToAcceptedBase, true);
    }
    const verificationCompletedAt = performance.now();
    const generationMs = Math.max(
      0,
      (generationCompletedAt ?? verificationCompletedAt) - startedAt,
    );
    const strictValidationMs = Math.max(
      0,
      verificationCompletedAt - (generationCompletedAt ?? verificationCompletedAt),
    );
    const elapsedPhases = {
      generationMs,
      strictValidationMs,
      totalMs: generationMs + strictValidationMs,
    };
    records.push({
      ordinal: currentManifestEntry?.ordinal ?? null,
      rawIndex,
      seed,
      basePlanHash,
      parentWitnessHash: acceptedParentWitness?.hash ?? null,
      acceptedParentParity,
      releaseValidationAccepted: dungeon.progression?.validation?.accepted === true,
      releaseValidationErrorCount: dungeon.progression?.validation?.errors?.length ?? 0,
      acceptedAsPlayableAlpha:
        dungeon.augmentationReplayDiagnostics?.acceptedAsPlayableAlpha === true,
      strictRealizedAccepted: true,
      status: dungeon.augmentationStatus,
      totalRoomRecords: dungeon.rooms.length,
      authoredRooms: authoredRooms.length,
      supplementalRooms: supplementalRooms.length,
      routeStationProxies: routeStationProxies.length,
      networkCount,
      moduleCount,
      physicalNodeCount,
      pyramidLoopCount,
      coverageNetworkCount,
      maximumFeaturelessSpanMeters,
      topologyTemplateIds,
      junctionKinds,
      elevationModes,
      topologyTemplateSelections,
      junctionKindSelections,
      elevationModeSelections,
      encounterProfileSelections,
      roomLayoutSelections,
      completeLayoutSignatures,
      selectionBagWitnesses,
      generationAttempts: dungeon.generationAttempts,
      realizationAttempts: dungeon.augmentationReplayDiagnostics?.realizationAttempts ?? 0,
      sourceRandomCalls,
      warmProcessEvidence: releaseWarmProcessEvidence,
      elapsedPhases,
      elapsedMs: elapsedPhases.totalMs,
      ...(dungeon.augmentationStatus === 'unchanged' ? {
        rejectionAttempts: (
          dungeon.augmentationDiagnostics?.rejectedOverlay?.attempts ?? []
        ).map((attempt) => {
          const errors = Array.isArray(attempt.errors) ? attempt.errors : [];
          return {
            realizationAttempt: attempt.realizationAttempt,
            reason: attempt.reason ?? null,
            failureCodes: [...new Set([
              ...(Array.isArray(attempt.failureCodes) ? attempt.failureCodes : []),
              ...errors.map((error) => error?.code).filter(Boolean),
            ])].slice(0, 12),
            errorCount: errors.length,
            lastPlanningDecision: (() => {
              const decision = attempt.diagnostics?.decisions?.at(-1);
              if (!decision) return null;
              const context = decision.context ?? {};
              return {
                attempt: decision.attempt,
                rejection: decision.rejection,
                context: {
                  grantId: context.grantId ?? null,
                  nodeIndex: context.nodeIndex ?? null,
                  firstNodeIndex: context.firstNodeIndex ?? null,
                  secondNodeIndex: context.secondNodeIndex ?? null,
                  constraintKind: context.constraintKind ?? null,
                  placementSearchVisits: context.placementSearchVisits ?? null,
                  physicalSpineAttempts: context.physicalSpineAttempts ?? null,
                  physicalSpineEdgeDiagnostics: (
                    context.physicalSpineEdgeDiagnostics ?? []
                  ).map((edge) => ({
                    edgeIndex: edge.edgeIndex,
                    visits: edge.visits,
                    deadEnds: edge.deadEnds,
                    maximumCollisionFreeCandidateCount:
                      edge.maximumCollisionFreeCandidateCount,
                    maximumFeasibleCandidateCount: edge.maximumFeasibleCandidateCount,
                    minimumCollisionScore: edge.minimumCollisionScore,
                    minimumDistanceMeters: edge.minimumDistanceMeters,
                    bestBlockedCollisionIds: edge.bestBlockedCollisionIds,
                  })),
                  routeNetworkSolver: context.routeNetworkSolver ?? null,
                  errorCodes: context.errorCodes ?? null,
                },
              };
            })(),
          };
        }),
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
  index = currentManifestEntry ? rawIndex + 1 : index + 1;
}

const appliedCount = records.filter(({ status }) => status === 'applied').length;
const fallbackCount = records.length - appliedCount;
const minimumAppliedCount = seedCount;
const countSelections = (key) => {
  const selections = records.flatMap((record) => record[key] ?? []);
  const counts = {};
  for (const selection of selections) {
    counts[selection] = (counts[selection] ?? 0) + 1;
  }
  return {
    total: selections.length,
    counts: Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (
      left.localeCompare(right)
    ))),
  };
};
const topologyTemplateFrequency = countSelections('topologyTemplateSelections');
const junctionKindFrequency = countSelections('junctionKindSelections');
const elevationModeFrequency = countSelections('elevationModeSelections');
const encounterProfileFrequency = countSelections('encounterProfileSelections');
const roomLayoutFrequency = countSelections('roomLayoutSelections');
const completeLayoutSignatureFrequency = countSelections('completeLayoutSignatures');
const verifierSummary = {
  profileId: PROFILE_ID,
  evidenceMode: releaseManifest
    ? 'immutable-manifest-seed-worker'
    : 'ad-hoc-non-authoritative',
  manifestHash: releaseManifest?.evidenceHash ?? null,
  corpusTier: releaseSelection?.tier ?? null,
  ordinalStart: releaseSelection?.ordinalStart ?? null,
  ordinalEndExclusive: releaseSelection?.ordinalEndExclusive ?? null,
  startIndex,
  endIndexExclusive: index,
  seedCount,
  skippedParentSeedCount: skippedParentSeeds.length,
  skippedParentSeeds,
  appliedCount,
  fallbackCount,
  minimumAppliedCount,
  topologyTemplateFrequency,
  junctionKindFrequency,
  elevationModeFrequency,
  encounterProfileFrequency,
  roomLayoutFrequency,
  completeLayoutSignatureFrequency,
  ...(summaryOnly ? {} : { records }),
};
console.log(JSON.stringify(verifierSummary, null, 2));
assert.ok(
  appliedCount >= minimumAppliedCount,
  `Only ${appliedCount}/${seedCount} realized v4 seeds applied; expected ${minimumAppliedCount}.`,
);
if (!releaseManifest && startIndex === 0 && seedCount >= 100) {
  assert.deepEqual(
    Object.keys(topologyTemplateFrequency.counts),
    EXPECTED_TOPOLOGY_TEMPLATE_IDS,
    'The realized sweep did not exercise exactly the registered topology families.',
  );
  assert.deepEqual(
    Object.keys(junctionKindFrequency.counts),
    EXPECTED_JUNCTION_KINDS,
    'The realized sweep did not exercise exactly the registered junction families.',
  );
  assert.deepEqual(
    Object.keys(elevationModeFrequency.counts),
    EXPECTED_ELEVATION_MODES,
    'The realized sweep did not exercise exactly the registered elevation families.',
  );
  assert.deepEqual(
    Object.keys(encounterProfileFrequency.counts),
    EXPECTED_ENCOUNTER_PROFILE_IDS,
    'The realized sweep did not exercise exactly the registered encounter families.',
  );
  assert.deepEqual(
    Object.keys(roomLayoutFrequency.counts),
    EXPECTED_ROOM_LAYOUT_IDS,
    'The realized sweep did not exercise exactly the registered room-layout families.',
  );
  assert.ok(topologyTemplateFrequency.total > 0);
  assert.ok(junctionKindFrequency.total > 0);
  assert.ok(elevationModeFrequency.total > 0);
  assert.ok(encounterProfileFrequency.total > 0);
  assert.ok(roomLayoutFrequency.total > 0);
  assert.ok(completeLayoutSignatureFrequency.total > 0);
  for (const [topologyTemplateId, count] of Object.entries(
    topologyTemplateFrequency.counts,
  )) {
    assert.ok(
      count / topologyTemplateFrequency.total <= 0.35 + Number.EPSILON,
      `${topologyTemplateId} occupies more than 35% of realized topology selections.`,
    );
  }
  for (const [junctionKind, count] of Object.entries(junctionKindFrequency.counts)) {
    assert.ok(
      count / junctionKindFrequency.total <= 0.50 + Number.EPSILON,
      `${junctionKind} occupies more than 50% of realized junction selections.`,
    );
  }
  for (const [signature, count] of Object.entries(
    completeLayoutSignatureFrequency.counts,
  )) {
    assert.ok(
      count / completeLayoutSignatureFrequency.total <= 0.10 + Number.EPSILON,
      `Complete layout signature ${signature} occupies more than 10% of realized selections.`,
    );
  }
}

if (releaseManifest) {
  const artifact = createSeedWorkerEvidence({
    manifest: releaseManifest,
    selection: releaseSelection,
    provenance: releaseProvenance,
    records,
    result: 'passed',
  });
  await writeImmutableJson(resolvedOutputPath, artifact);
  evidenceWritten = true;
  console.error(`Wrote immutable seed-worker evidence to ${resolvedOutputPath}.`);
}
