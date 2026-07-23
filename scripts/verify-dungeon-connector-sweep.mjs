import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
import {
  DUNGEON_CONNECTOR_ELEVATION_POLICY,
  DUNGEON_CONNECTOR_VARIANT_IDS,
} from '../src/DungeonConnectorVariants.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';

const EPSILON = 0.05;
const DEFAULT_SEED_COUNT = 100;
const ELEVATION_VARIANT_IDS = new Set([
  DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
  DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
  DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
]);

function isMainRoutePlan(plan) {
  return String(plan?.routeClassification ?? plan?.purpose ?? '').toLowerCase() !== 'optional_branch';
}

function readIntegerOption(name, fallback, { minimum = 0, maximum = 1000 } = {}) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${prefix}<integer> must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function closeEnough(first, second, epsilon = EPSILON) {
  return Number.isFinite(first)
    && Number.isFinite(second)
    && Math.abs(first - second) <= epsilon;
}

function absoluteFloorKey(tile) {
  return `${tile.x},${tile.z}@y${Number(tile.elevation ?? 0).toFixed(3)}`;
}

function getVolumeBounds(volume) {
  const center = volume?.center;
  const size = volume?.size;
  if (![center?.x, center?.y, center?.z, size?.x, size?.y, size?.z].every(Number.isFinite)) {
    return null;
  }
  return {
    minX: center.x - size.x * 0.5,
    maxX: center.x + size.x * 0.5,
    minY: center.y - size.y * 0.5,
    maxY: center.y + size.y * 0.5,
    minZ: center.z - size.z * 0.5,
    maxZ: center.z + size.z * 0.5,
  };
}

function volumesOverlap(first, second, epsilon = 0.001) {
  const a = getVolumeBounds(first);
  const b = getVolumeBounds(second);
  if (!a || !b) return false;
  return Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > epsilon
    && Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > epsilon
    && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > epsilon;
}

function seedContext(seed, message, details = null) {
  return [
    `[${seed}] ${message}`,
    details === null ? null : JSON.stringify(details, null, 2),
  ].filter(Boolean).join('\n');
}

function assertForSeed(seed, condition, message, details = null) {
  assert.ok(condition, seedContext(seed, message, details));
}

function disposeDungeon(dungeon) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  dungeon?.group?.traverse?.((object) => {
    if (object.geometry?.isBufferGeometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (!material?.isMaterial) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  dungeon?.group?.clear?.();
}

function makeDungeon(seed) {
  // Match Game.createDungeonRandom exactly so every witness printed by this
  // script can be reproduced with `?dungeonSeed=<seed>` in the browser.  The
  // URL seed is first namespaced as `layout:`, hashed, then passed through the
  // SeededRandom constructor's normal canonical hash.
  const browserRandom = new SeededRandom(hashSeed(`layout:${seed}`));
  const generator = new DungeonGenerator({
    random: () => browserRandom.next(),
    difficulty: 1,
  });
  // Node has no DOM-backed image loader. The sweep verifies the complete
  // structural assembly while supplying inert textures to the existing V1
  // material construction path.
  const inertTexture = new THREE.Texture();
  inertTexture.name = `connectorSweepTexture_${seed}`;
  generator._loadRuinTexture = () => inertTexture;
  return generator.generate();
}

function plansAreConsecutive(first, second) {
  if (Math.abs(first.connectionPlanIndex - second.connectionPlanIndex) <= 1) return true;
  const firstRooms = new Set([first.plan.fromRoomId, first.plan.toRoomId]);
  return [second.plan.fromRoomId, second.plan.toRoomId].some((roomId) => (
    firstRooms.has(roomId)
  ));
}

function countMaximumElevationTransfersOnRootPath(plans) {
  const groundPlans = plans.filter((plan) => (plan.level ?? 0) === 0);
  const incomingRoomIds = new Set(groundPlans.map((plan) => plan.toRoomId));
  const rootRoomIds = new Set(
    groundPlans.map((plan) => plan.fromRoomId).filter((roomId) => !incomingRoomIds.has(roomId)),
  );
  const transferCounts = new Map([...rootRoomIds].map((roomId) => [roomId, 0]));
  let maximum = 0;
  for (let pass = 0; pass < groundPlans.length; pass += 1) {
    let changed = false;
    for (const plan of groundPlans) {
      if (!transferCounts.has(plan.fromRoomId)) continue;
      const count = transferCounts.get(plan.fromRoomId)
        + Number(ELEVATION_VARIANT_IDS.has(plan.connectorVariantId));
      if (count > (transferCounts.get(plan.toRoomId) ?? -1)) {
        transferCounts.set(plan.toRoomId, count);
        maximum = Math.max(maximum, count);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return maximum;
}

function validateTrapSelection(seed, dungeon, elevationPlans, planById) {
  const diagnostics = dungeon.connectorTrackTrapPlanningDiagnostics;
  const alternates = dungeon.trappedConnectorAlternates ?? [];
  const traps = dungeon.connectorTrackTraps ?? [];
  const trappedPlanRecords = alternates.map((alternate) => ({
    ...alternate,
    plan: planById.get(alternate.connectionId),
  }));
  const selectionCap = Math.floor(elevationPlans.length * 0.4 + 1e-9);

  assertForSeed(seed, diagnostics?.accepted === true, 'track-trap planning was rejected', diagnostics);
  assertForSeed(
    seed,
    (diagnostics?.selectedTrapExclusionChecks ?? []).every((check) => check.accepted),
    'a selected trap intersects a global room, connector, or required-clearance exclusion',
    diagnostics?.selectedTrapExclusionChecks,
  );
  assertForSeed(
    seed,
    diagnostics.elevationConnectorCount === elevationPlans.length,
    'track-trap planner used the wrong elevation-connector domain',
    diagnostics,
  );
  assertForSeed(
    seed,
    diagnostics.selectionCap === selectionCap && alternates.length <= selectionCap,
    'trapped connectors exceed the 40% cap',
    { selectionCap, alternates, diagnostics },
  );
  if (diagnostics.legalConnectorCount > 0) {
    assertForSeed(
      seed,
      alternates.length >= 1,
      'a legal trap bay existed but no trapped alternate was assembled',
      diagnostics,
    );
  }

  assertForSeed(
    seed,
    trappedPlanRecords.every((record) => record.plan && ELEVATION_VARIANT_IDS.has(record.plan.connectorVariantId)),
    'a trap was assigned to a level or unknown connection',
    trappedPlanRecords,
  );
  for (let firstIndex = 0; firstIndex < trappedPlanRecords.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < trappedPlanRecords.length; secondIndex += 1) {
      assertForSeed(
        seed,
        !plansAreConsecutive(trappedPlanRecords[firstIndex], trappedPlanRecords[secondIndex]),
        'trapped alternates occupy consecutive graph edges',
        [trappedPlanRecords[firstIndex], trappedPlanRecords[secondIndex]],
      );
    }
  }

  const trapsByConnectionId = new Map();
  for (const trap of traps) {
    const entries = trapsByConnectionId.get(trap.connectionId) ?? [];
    entries.push(trap);
    trapsByConnectionId.set(trap.connectionId, entries);
  }
  assertForSeed(
    seed,
    trapsByConnectionId.size === alternates.length,
    'trap descriptors and trapped connector alternates disagree',
    { alternates, trapConnectionIds: [...trapsByConnectionId.keys()] },
  );
  for (const alternate of alternates) {
    const connectorTraps = trapsByConnectionId.get(alternate.connectionId) ?? [];
    assertForSeed(
      seed,
      connectorTraps.length >= 1 && connectorTraps.length <= 3,
      'a trapped connector does not contain one to three traps',
      { alternate, trapCount: connectorTraps.length },
    );
    assertForSeed(
      seed,
      alternate.trapIds.length === connectorTraps.length
        && alternate.trapIds.every((trapId) => connectorTraps.some((trap) => trap.id === trapId)),
      'trapped alternate trap IDs do not match assembled descriptors',
      { alternate, connectorTraps },
    );
  }
}

function validateDungeon(seed, dungeon) {
  const plans = dungeon.connectionPlans ?? [];
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const roomById = new Map((dungeon.rooms ?? []).map((room) => [room.id, room]));
  const validation = dungeon.progression?.validation;
  const planning = dungeon.connectorPlanningDiagnostics;
  const footprintReservation = dungeon.connectorFootprintReservationDiagnostics;
  const assembly = validation?.connectorAssembly;
  const platformability = validation?.platformability;

  assertForSeed(
    seed,
    footprintReservation?.accepted === true,
    'family-specific pass-one connector footprint reservation was rejected',
    footprintReservation,
  );

  const floorKeys = new Map();
  for (const floor of dungeon.floorTiles ?? []) {
    const expectedFloorKey = absoluteFloorKey(floor);
    assertForSeed(
      seed,
      floor.floorKey === expectedFloorKey,
      'a walkable floor retained a non-canonical or elevation-ambiguous identity',
      { floor, expectedFloorKey },
    );
    assertForSeed(
      seed,
      !floorKeys.has(expectedFloorKey),
      'two walkable surfaces overlap at the same X/Z and absolute elevation',
      { floorKey: expectedFloorKey, first: floorKeys.get(expectedFloorKey), second: floor },
    );
    floorKeys.set(expectedFloorKey, floor);
  }
  const danglingTraversalLinks = (dungeon.floorTiles ?? []).flatMap((floor) => (
    (floor.traversalLinks ?? [])
      .filter((link) => !floorKeys.has(link.toFloorKey))
      .map((link) => ({ fromFloorKey: floor.floorKey, ...link }))
  ));
  assertForSeed(
    seed,
    danglingTraversalLinks.length === 0,
    'a traversal link targets a missing absolute-elevation floor',
    danglingTraversalLinks,
  );

  assertForSeed(seed, validation?.accepted === true, 'assembled dungeon validation was rejected', {
    attempts: dungeon.generationAttempts,
    errors: validation?.errors,
  });
  assertForSeed(seed, (validation?.errors ?? []).length === 0, 'accepted dungeon retained validation errors', validation?.errors);
  assertForSeed(seed, planning?.accepted === true, 'signed connector planning was rejected', planning);
  assertForSeed(seed, assembly?.signedElevationContracts === true, 'assembly did not validate signed elevation contracts', assembly);
  assertForSeed(seed, assembly?.checks?.length === plans.length, 'assembly diagnostics omit connection plans', {
    planCount: plans.length,
    assemblyCheckCount: assembly?.checks?.length,
  });
  assertForSeed(seed, platformability?.matchedConnectionCount === plans.length, 'access diagnostics omit connection plans', platformability);
  assertForSeed(
    seed,
    platformability?.localSocketChecks?.length === plans.length * 2
      && platformability.localSocketChecks.every((check) => check.accessibleFromOwnerRoom),
    'at least one connector socket is inaccessible from its owning room',
    platformability?.localSocketChecks,
  );
  assertForSeed(
    seed,
    plans.every((plan) => (plan.connectorAssemblyErrors ?? []).length === 0),
    'a connector retained structural overlap or clearance assembly errors',
    plans.filter((plan) => (plan.connectorAssemblyErrors ?? []).length > 0)
      .map((plan) => ({ id: plan.id, errors: plan.connectorAssemblyErrors })),
  );
  for (const plan of plans) {
    const constraints = plan.connectorVariantConstraints;
    const assemblesExteriorGallery = (plan.galleryCrossSections?.length ?? 0) > 0;
    assertForSeed(
      seed,
      constraints?.reservedFootprintHalfWidthTiles >= 2
        && Number.isSafeInteger(constraints.reservedFootprintColumnCount)
        && (!assemblesExteriorGallery || constraints.reservedFootprintColumnCount > 0),
      'a connector did not reserve its complete three-lane gallery and support envelope',
      { id: plan.id, constraints },
    );
    assertForSeed(
      seed,
      constraints.footprintRoomCollisionCount === 0
        && constraints.footprintConnectorCollisionCount === 0,
      'a planned connector footprint crosses an unrelated room or connector reservation',
      { id: plan.id, constraints },
    );
    assertForSeed(
      seed,
      Number.isSafeInteger(constraints.familyReservation?.footprintColumnCount)
        && constraints.familyReservation.footprintColumnCount > 0
        && constraints.familyReservation.roomCollisionCount === 0
        && constraints.familyReservation.connectorCollisionCount === 0,
      'an assigned connector family has no collision-free pre-assembly reservation',
      { id: plan.id, familyReservation: constraints.familyReservation },
    );
    assertForSeed(
      seed,
      !assemblesExteriorGallery || (
        (plan.occupiedStructuralVolumes?.length ?? 0) > 0
        && (plan.clearanceVolumes?.length ?? 0) > 0
      ),
      'an exterior connector omitted its structural or player-clearance volumes',
      {
        id: plan.id,
        structuralCount: plan.occupiedStructuralVolumes?.length ?? 0,
        clearanceCount: plan.clearanceVolumes?.length ?? 0,
      },
    );
  }
  for (let firstIndex = 0; firstIndex < plans.length; firstIndex += 1) {
    const firstPlan = plans[firstIndex];
    const firstVolumes = [
      ...(firstPlan.occupiedStructuralVolumes ?? []),
      ...(firstPlan.clearanceVolumes ?? []),
    ];
    for (let secondIndex = firstIndex + 1; secondIndex < plans.length; secondIndex += 1) {
      const secondPlan = plans[secondIndex];
      const secondVolumes = [
        ...(secondPlan.occupiedStructuralVolumes ?? []),
        ...(secondPlan.clearanceVolumes ?? []),
      ];
      const overlap = firstVolumes.flatMap((firstVolume) => (
        secondVolumes
          .filter((secondVolume) => volumesOverlap(firstVolume, secondVolume))
          .map((secondVolume) => ({ firstVolume, secondVolume }))
      ))[0] ?? null;
      assertForSeed(
        seed,
        overlap === null,
        'independent sweep found overlapping structural or traversal-clearance volumes',
        {
          firstConnectionId: firstPlan.id,
          secondConnectionId: secondPlan.id,
          overlap,
        },
      );
    }
  }

  const elevationPlans = plans.filter((plan) => ELEVATION_VARIANT_IDS.has(plan.connectorVariantId));
  assertForSeed(
    seed,
    elevationPlans.length >= DUNGEON_CONNECTOR_ELEVATION_POLICY.minimumElevationConnectorCount
      && elevationPlans.length <= DUNGEON_CONNECTOR_ELEVATION_POLICY.maximumElevationConnectorCount,
    'dungeon does not contain three to five elevation connectors',
    elevationPlans.map((plan) => plan.id),
  );
  assertForSeed(
    seed,
    planning.selectedElevationConnectorCount === elevationPlans.length,
    'planner diagnostics disagree with assembled elevation connectors',
    { planning, assembledIds: elevationPlans.map((plan) => plan.id) },
  );
  const elevationVariants = new Set(elevationPlans.map((plan) => plan.connectorVariantId));
  for (const variantId of ELEVATION_VARIANT_IDS) {
    assertForSeed(seed, elevationVariants.has(variantId), `missing mandatory connector family ${variantId}`);
    assertForSeed(
      seed,
      elevationPlans.some((plan) => (
        plan.connectorVariantId === variantId && isMainRoutePlan(plan)
      )),
      `mandatory connector family ${variantId} was assigned only to an optional branch`,
      elevationPlans.map((plan) => ({
        id: plan.id,
        variantId: plan.connectorVariantId,
        routeClassification: plan.routeClassification,
      })),
    );
  }
  assertForSeed(
    seed,
    planning.mainRouteElevationConnectorIds?.length >= 3,
    'planner diagnostics do not retain all three mandatory main-route transfers',
    planning,
  );
  const elevationDirections = new Set(elevationPlans.map((plan) => plan.direction));
  assertForSeed(
    seed,
    elevationDirections.has('ascending') && elevationDirections.has('descending'),
    'dungeon lacks ascending or descending elevation progression',
    [...elevationDirections],
  );
  const maximumTransfersOnRootPath = countMaximumElevationTransfersOnRootPath(plans);
  assertForSeed(
    seed,
    maximumTransfersOnRootPath
      <= DUNGEON_CONNECTOR_ELEVATION_POLICY.maximumElevationTransfersPerRootPath,
    'a root-to-leaf route contains more than four elevation transfers',
    { maximumTransfersOnRootPath },
  );

  for (const plan of elevationPlans) {
    const expectedDelta = plan.direction === 'ascending'
      ? DUNGEON_CONNECTOR_ELEVATION_POLICY.transferElevationMeters
      : -DUNGEON_CONNECTOR_ELEVATION_POLICY.transferElevationMeters;
    const sourceRoom = roomById.get(plan.fromRoomId);
    const destinationRoom = roomById.get(plan.toRoomId);
    assertForSeed(seed, plan.level === 0 && plan.connectorType === 'ground_corridor', 'elevation transfer replaced a non-ground V1 connection', plan);
    assertForSeed(seed, closeEnough(plan.elevationDelta, expectedDelta, 0.001), 'elevation transfer is not exactly signed 14 m', plan);
    assertForSeed(seed, closeEnough(plan.destinationElevation - plan.sourceElevation, expectedDelta, 0.001), 'connector endpoints disagree with signed delta', plan);
    assertForSeed(seed, closeEnough(plan.fromSocket?.elevation, plan.sourceElevation), 'source socket is vertically misaligned', plan);
    assertForSeed(seed, closeEnough(plan.toSocket?.elevation, plan.destinationElevation), 'destination socket is vertically misaligned', plan);
    assertForSeed(seed, closeEnough(sourceRoom?.baseElevation, plan.sourceElevation), 'source room floor and connector landing are misaligned', {
      planId: plan.id,
      roomElevation: sourceRoom?.baseElevation,
      connectorElevation: plan.sourceElevation,
    });
    assertForSeed(seed, closeEnough(destinationRoom?.baseElevation, plan.destinationElevation), 'destination room floor and connector landing are misaligned', {
      planId: plan.id,
      roomElevation: destinationRoom?.baseElevation,
      connectorElevation: plan.destinationElevation,
    });
  }

  const classicGroundPlans = plans.filter((plan) => (
    (plan.level ?? 0) === 0
    && !ELEVATION_VARIANT_IDS.has(plan.connectorVariantId)
  ));
  assertForSeed(seed, classicGroundPlans.length > 0, 'dungeon did not retain any same-elevation classic V1 corridors');
  assertForSeed(
    seed,
    classicGroundPlans.every((plan) => (
      closeEnough(plan.elevationDelta, 0, 0.001)
      && closeEnough(plan.sourceElevation, plan.destinationElevation, 0.001)
      && closeEnough(plan.fromSocket?.elevation, plan.toSocket?.elevation, 0.001)
      && plan.direction === 'level'
      && plan.connectorPresentation?.baseFamily === 'v1_arch_corridor'
      && plan.connectorPresentation?.preservesV1Corridor === true
    )),
    'a classic V1 corridor changed elevation or lost its V1 presentation',
    classicGroundPlans,
  );
  assertForSeed(
    seed,
    classicGroundPlans.some((plan) => plan.connectorPresentation?.overlayFamily === 'v1_service_bay'),
    'dungeon did not retain a classic V1 service-gallery connection',
    classicGroundPlans.map((plan) => ({ id: plan.id, presentation: plan.connectorPresentation })),
  );

  const upperPlans = plans.filter((plan) => (plan.level ?? 0) > 0);
  assertForSeed(
    seed,
    upperPlans.every((plan) => (
      closeEnough(plan.elevationDelta, 0, 0.001)
      && closeEnough(plan.sourceElevation, plan.destinationElevation, 0.001)
      && plan.direction === 'level'
    )),
    'a retained V1 upper-catwalk pair was assigned an elevation transfer',
    upperPlans,
  );

  const roomElevations = [...roomById.values()].map((room) => Number(room.baseElevation));
  const minimumRoomElevation = Math.min(...roomElevations);
  const maximumRoomElevation = Math.max(...roomElevations);
  const verticalSpanMeters = maximumRoomElevation - minimumRoomElevation;
  assertForSeed(
    seed,
    verticalSpanMeters <= DUNGEON_CONNECTOR_ELEVATION_POLICY.maximumDungeonVerticalSpanMeters + 0.001,
    'assembled room elevations exceed the 56 m span limit',
    { minimumRoomElevation, maximumRoomElevation, verticalSpanMeters },
  );
  assertForSeed(seed, closeEnough(planning.minimumRoomElevation, minimumRoomElevation, 0.001), 'planner minimum room elevation differs from assembly', planning);
  assertForSeed(seed, closeEnough(planning.maximumRoomElevation, maximumRoomElevation, 0.001), 'planner maximum room elevation differs from assembly', planning);
  assertForSeed(seed, closeEnough(planning.verticalSpanMeters, verticalSpanMeters, 0.001), 'planner vertical span differs from assembly', planning);
  assertForSeed(
    seed,
    Object.entries(dungeon.roomElevationDiagnostics?.roomElevations ?? {}).every(([roomId, elevation]) => (
      closeEnough(roomById.get(roomId)?.baseElevation, elevation, 0.001)
    )),
    'room-local translation diagnostics differ from final room elevations',
    dungeon.roomElevationDiagnostics,
  );

  const assemblyCheckById = new Map(assembly.checks.map((check) => [check.connectionId, check]));
  assertForSeed(
    seed,
    plans.every((plan) => {
      const check = assemblyCheckById.get(plan.id);
      return check
        && closeEnough(check.sourceElevation, plan.sourceElevation, 0.001)
        && closeEnough(check.destinationElevation, plan.destinationElevation, 0.001)
        && closeEnough(check.elevationDelta, plan.elevationDelta, 0.001)
        && check.galleryCrossSectionCount > 0
        && check.minimumGalleryWidthTiles >= 3;
    }),
    'connector assembly diagnostics report an endpoint mismatch or narrow gallery',
    assembly.checks,
  );

  const physicalChecks = validation.physicalProgression?.checks ?? [];
  assertForSeed(
    seed,
    physicalChecks.every((check) => (
      check.sourceReachable
      && !check.destinationReachableWhileClosed
      && check.thresholdAnchored
      && check.thresholdWallWingCount >= 2
    )),
    'a progression gate has an inaccessible source or bypassable threshold',
    physicalChecks,
  );

  validateTrapSelection(seed, dungeon, elevationPlans, planById);
  return {
    seed,
    attempts: dungeon.generationAttempts,
    elevationConnectorCount: elevationPlans.length,
    minimumRoomElevation,
    maximumRoomElevation,
    verticalSpanMeters,
    maximumTransfersOnRootPath,
    trappedConnectorCount: dungeon.trappedConnectorAlternates?.length ?? 0,
    variants: [...elevationVariants].sort(),
    directions: [...elevationDirections].sort(),
    connectorWitnesses: elevationPlans.map((plan) => ({
      connectionId: plan.id,
      variantId: plan.connectorVariantId,
      direction: plan.direction,
      fromRoomId: plan.fromRoomId,
      toRoomId: plan.toRoomId,
    })),
  };
}

const count = readIntegerOption('count', DEFAULT_SEED_COUNT, { minimum: 1, maximum: 1000 });
const start = readIntegerOption('start', 0, { minimum: 0, maximum: 999999 });
const summaries = [];
const startedAt = performance.now();

for (let offset = 0; offset < count; offset += 1) {
  const seedIndex = start + offset;
  const seed = `v1-bidirectional-connector-sweep-${String(seedIndex).padStart(4, '0')}`;
  let dungeon = null;
  try {
    dungeon = makeDungeon(seed);
    summaries.push(validateDungeon(seed, dungeon));
  } catch (error) {
    console.error(seedContext(seed, 'connector sweep failed', {
      message: error?.message ?? String(error),
      validationErrors: dungeon?.progression?.validation?.errors ?? null,
    }));
    throw error;
  } finally {
    disposeDungeon(dungeon);
  }
  if ((offset + 1) % 10 === 0 || offset + 1 === count) {
    console.log(`Validated ${offset + 1}/${count} assembled V1 connector seeds.`);
  }
}

const elapsedMilliseconds = Math.round(performance.now() - startedAt);
const diagnosticHash = createHash('sha256')
  .update(JSON.stringify(summaries))
  .digest('hex');
const negativeElevationSeedCount = summaries.filter((summary) => summary.minimumRoomElevation < 0).length;
const positiveElevationSeedCount = summaries.filter((summary) => summary.maximumRoomElevation > 0).length;
const directionalFamilyWitnesses = {};
const entryConnectorWitnesses = {};
for (const summary of summaries) {
  for (const witness of summary.connectorWitnesses) {
    const key = `${witness.variantId}:${witness.direction}`;
    directionalFamilyWitnesses[key] ??= {
      seed: summary.seed,
      connectionId: witness.connectionId,
    };
    if (witness.fromRoomId === 'entrance' && witness.toRoomId === 'enemyNest') {
      entryConnectorWitnesses[key] ??= {
        seed: summary.seed,
        connectionId: witness.connectionId,
      };
    }
  }
}
if (count >= DEFAULT_SEED_COUNT) {
  assert.ok(
    negativeElevationSeedCount > 0,
    'The full sweep did not exercise any subterranean room elevations.',
  );
  for (const variantId of ELEVATION_VARIANT_IDS) {
    for (const direction of ['ascending', 'descending']) {
      const witnessKey = `${variantId}:${direction}`;
      assert.ok(
        directionalFamilyWitnesses[witnessKey],
        `The full sweep did not assemble ${witnessKey}.`,
      );
    }
  }
}

console.log(JSON.stringify({
  accepted: true,
  count,
  start,
  elapsedMilliseconds,
  diagnosticHash,
  maximumGenerationAttempts: Math.max(...summaries.map((summary) => summary.attempts)),
  negativeElevationSeedCount,
  positiveElevationSeedCount,
  directionalFamilyWitnesses,
  entryConnectorWitnesses,
  elevationConnectorCounts: Object.fromEntries(
    [...new Set(summaries.map((summary) => summary.elevationConnectorCount))]
      .sort((first, second) => first - second)
      .map((connectorCount) => [
        connectorCount,
        summaries.filter((summary) => summary.elevationConnectorCount === connectorCount).length,
      ]),
  ),
}, null, 2));
