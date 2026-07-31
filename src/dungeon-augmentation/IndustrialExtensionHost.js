import {
  PROGRESSION_BANDS,
  PROGRESSION_DOORS,
  PROGRESSION_KEYCARDS,
  PROGRESSION_ROOM_BANDS,
} from '../DungeonProgression.js';
import { resolveDungeonConnectorApproachElevationAt } from '../DungeonConnectorVariants.js';
import { collectBaseDraftVolumes } from './geometry.js';

export const INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID = 'industrial-supplement-preview-v1';
export const INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID = 'industrial-supplement-preview-v2';
export const INDUSTRIAL_SUPPLEMENT_PREVIEW_V3_PROFILE_ID = 'industrial-supplement-preview-v3';
export const INDUSTRIAL_SUPPLEMENT_PREVIEW_V4_PROFILE_ID = 'industrial-supplement-preview-v4';
export const INDUSTRIAL_EXTENSION_REGION_ID = 'industrial-v1:main-region';
export const INDUSTRIAL_THEME_REVISION = 'industrial-v1-presentation-r1';
export const INDUSTRIAL_THEME_CONTENT_HASH = 'industrial-v1-assets-2026-07-28';

const HOST_SCHEMA = 'ruindivex-dungeon-extension-host/v2';
const REGION_THEME_SCHEMA = 'ruindivex-dungeon-region-theme/v1';
const PROGRESSION_SNAPSHOT_SCHEMA = 'ruindivex-dungeon-progression-snapshot/v2';
const ROUTE_NETWORK_GRANT_SCHEMA = 'ruindivex-dungeon-route-network-grant/v2';
const MAXIMUM_FEATURELESS_SPAN_METERS = 33.6;
const MAXIMUM_COVERAGE_STATIONS = 4;
const V4_MINIMUM_SUBSTANTIVE_MODULES_PER_NETWORK = 3;
const V4_MAXIMUM_SUBSTANTIVE_MODULES_PER_NETWORK = 6;
// Exact authored-corridor sockets host the compact 5x7 Through-T station, not
// a universal 7x7 content room. Substantive rooms are placed by the global
// solver beyond these endpoint modules.
const ROUTE_NETWORK_ENDPOINT_MODULE_WIDTH_METERS = 5 * 2.8;
const ROUTE_NETWORK_ENDPOINT_MODULE_DEPTH_METERS = 7 * 2.8;
const ROUTE_NETWORK_ENDPOINT_CONTENT_SPAN_METERS = 7 * 2.8;
const ROUTE_NETWORK_MODULE_GAP_METERS = 2 * 2.8;
const ROUTE_NETWORK_PLANNING_MODULE_SPAN_METERS = 7 * 2.8;
const BRANCH_ROOM_IDS = Object.freeze([
  'enemyNest',
  'keycardRoom',
  'trapRoom',
  'bonusVault',
]);
const OBJECTIVE_ROUTE_EDGE_IDS = new Set([
  'enemyNest_keycardRoom',
  'keycardRoom_trapRoom',
  'trapRoom_conveyorRoom',
  'conveyorRoom_bossRoom',
  'bossRoom_shrineRoom',
]);
const KEYCARD_CRITICAL_EDGE_IDS = new Set([
  'enemyNest_keycardRoom',
  'keycardRoom_trapRoom',
]);
const CARDINAL_WALL_SIDES = Object.freeze(['north', 'east', 'south', 'west']);
const REQUIRED_CREDENTIAL_BY_DOOR_ID = new Map(
  PROGRESSION_DOORS.map(({ doorId, requiredKeycardId }) => [doorId, requiredKeycardId]),
);

const PADDED_EDGE_IDS = new Set([
  'entrance_enemyNest',
  'enemyNest_keycardRoom',
  'keycardRoom_trapRoom',
  'trapRoom_coolantRelayRoom',
  'trapRoom_conveyorRoom',
  'conveyorRoom_bonusVault',
]);
const EDGE_PADDING_INCOMPATIBLE_ROOM_IDS = new Set([
  // Industrial's conveyor module owns a raised bridge surface along its
  // adjoining route. Its renderer elevation is intentionally offset from the
  // logical connection elevation, so a generic room threshold cannot splice
  // into that surface without a conveyor-specific transition contract.
  'conveyorRoom',
]);
const INDUSTRIAL_GALLERY_PROTECTED_COLUMN_HEIGHT_METERS = 2048;

function clonePoint(point = {}) {
  return {
    x: Number(point.x ?? 0),
    z: Number(point.z ?? 0),
  };
}

function sameGridPoint(first, second) {
  return first && second
    && Number(first.x) === Number(second.x)
    && Number(first.z) === Number(second.z);
}

function createUsableSpliceGridPath(plan) {
  const rawPath = (plan.fullPath ?? plan.bridgePath ?? []).map(clonePoint);
  const fromSocket = plan.fromSocket ? clonePoint(plan.fromSocket) : rawPath[0] ?? null;
  const toSocket = plan.toSocket ? clonePoint(plan.toSocket) : rawPath.at(-1) ?? null;
  const fromIndex = rawPath.findIndex((point) => sameGridPoint(point, fromSocket));
  const toIndex = rawPath.findIndex((point) => sameGridPoint(point, toSocket));
  if (fromIndex >= 0 && toIndex >= 0) {
    return fromIndex <= toIndex
      ? rawPath.slice(fromIndex, toIndex + 1)
      : rawPath.slice(toIndex, fromIndex + 1).reverse();
  }
  return fromSocket && toSocket ? [fromSocket, toSocket] : rawPath;
}

function measureGridPathMeters(path, tileSize) {
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    length += Math.hypot(
      Number(path[index].x) - Number(path[index - 1].x),
      Number(path[index].z) - Number(path[index - 1].z),
    ) * tileSize;
  }
  return length;
}

function measureWorldPathMeters(path) {
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    length += Math.hypot(
      Number(path[index].x) - Number(path[index - 1].x),
      Number(path[index].y) - Number(path[index - 1].y),
      Number(path[index].z) - Number(path[index - 1].z),
    );
  }
  return length;
}

function countPlanarPathDirectionChanges(path = []) {
  let previousDirection = null;
  let directionChanges = 0;
  for (let index = 1; index < path.length; index += 1) {
    const deltaX = Number(path[index].x) - Number(path[index - 1].x);
    const deltaZ = Number(path[index].z) - Number(path[index - 1].z);
    if (Math.abs(deltaX) <= 1e-9 && Math.abs(deltaZ) <= 1e-9) continue;
    const direction = Math.abs(deltaX) >= Math.abs(deltaZ)
      ? `${Math.sign(deltaX)},0`
      : `0,${Math.sign(deltaZ)}`;
    if (previousDirection && direction !== previousDirection) directionChanges += 1;
    previousDirection = direction;
  }
  return directionChanges;
}

function createOrdinaryTraversalSpans(centerline = []) {
  const cumulativeDistances = [0];
  for (let index = 1; index < centerline.length; index += 1) {
    cumulativeDistances[index] = cumulativeDistances[index - 1] + Math.hypot(
      Number(centerline[index].x) - Number(centerline[index - 1].x),
      Number(centerline[index].z) - Number(centerline[index - 1].z),
    );
  }
  const spans = [];
  let startIndex = null;
  const closeSpan = (endIndex) => {
    if (startIndex == null || endIndex <= startIndex) {
      startIndex = null;
      return;
    }
    const points = centerline.slice(startIndex, endIndex + 1);
    const startDistanceMeters = cumulativeDistances[startIndex];
    const endDistanceMeters = cumulativeDistances[endIndex];
    spans.push({
      startIndex,
      endIndex,
      startDistanceMeters,
      endDistanceMeters,
      lengthMeters: endDistanceMeters - startDistanceMeters,
      elevation: Number(centerline[startIndex].y),
      directionChangeCount: countPlanarPathDirectionChanges(points),
    });
    startIndex = null;
  };
  for (let index = 0; index < centerline.length; index += 1) {
    const point = centerline[index];
    const previous = centerline[index - 1];
    const startsNewElevation = startIndex != null
      && previous?.stationEligible !== false
      && Math.abs(Number(point.y) - Number(previous.y)) > 1e-6;
    if (point.stationEligible === false || startsNewElevation) {
      closeSpan(index - 1);
      if (point.stationEligible === false) continue;
    }
    if (startIndex == null) startIndex = index;
  }
  closeSpan(centerline.length - 1);
  return spans.filter(({ lengthMeters }) => lengthMeters > 1e-6);
}

function featurelessSpansWithinOrdinaryTraversal(ordinarySpans, stationDistances) {
  return ordinarySpans.flatMap((span) => {
    const stations = stationDistances.filter((distance) => (
      distance > span.startDistanceMeters + 1e-6
        && distance < span.endDistanceMeters - 1e-6
    ));
    const boundaries = [span.startDistanceMeters, ...stations, span.endDistanceMeters];
    return boundaries.slice(1).map((distance, index) => (
      Number((distance - boundaries[index]).toFixed(6))
    ));
  });
}

function logicalConnectionId(plan = {}) {
  return String(plan.logicalConnectionId ?? `${plan.fromRoomId}_${plan.toRoomId}`);
}

function progressionBandForRoom(roomId) {
  return Number(PROGRESSION_ROOM_BANDS[String(roomId ?? '')] ?? 0);
}

function accessDomainId(progressionBandId) {
  return `${INDUSTRIAL_EXTENSION_REGION_ID}:access-domain:band-${Number(progressionBandId)}`;
}

function requiredCredentialIdsForDoor(doorId) {
  const credentialId = REQUIRED_CREDENTIAL_BY_DOOR_ID.get(String(doorId ?? ''));
  return credentialId ? [credentialId] : [];
}

function deterministicOptionalRouteKind(basePlanHash) {
  let hash = 2166136261;
  for (const character of String(basePlanHash ?? '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash & 1) === 0
    ? 'same-band-micro-progression'
    : 'cross-band-shortcut';
}

function wallSideForFacing(facing = {}) {
  const x = Number(facing.facingX ?? facing.x ?? 0);
  const z = Number(facing.facingZ ?? facing.z ?? 0);
  if (Math.abs(x) >= Math.abs(z) && x !== 0) return x > 0 ? 'east' : 'west';
  if (z !== 0) return z > 0 ? 'south' : 'north';
  return null;
}

function createSocketLandingOverlapGrant(socket, tileSize, suffix = '') {
  const horizontal = Math.abs(Number(socket.facing?.x ?? socket.facingX ?? 0)) > 0;
  return {
    id: `${socket.id}:landing-overlap${suffix}`,
    socketId: socket.id,
    center: {
      x: Number(socket.position?.x ?? socket.x * tileSize ?? 0),
      y: Number(socket.position?.y ?? socket.elevation ?? 0) + 1.8,
      z: Number(socket.position?.z ?? socket.z * tileSize ?? 0),
    },
    size: {
      x: horizontal ? tileSize * 5 : tileSize * 3,
      y: 3.6,
      z: horizontal ? tileSize * 3 : tileSize * 5,
    },
    purpose: 'route-network-doorway-landing-overlap',
    widthTiles: 3,
    insideDepthTiles: 2,
    outsideDepthTiles: 2,
    maximumBoundaryDepthTiles: 2,
    parentOwnerId: String(socket.logicalEdgeId ?? socket.parentRouteId ?? ''),
  };
}

function createSocketModuleOverlapGrant(socket, tileSize, {
  idSuffix = '',
  moduleTemplateId = 'supplement-route-connector-through-t-v1',
  widthTiles = 5,
  depthTiles = 7,
} = {}) {
  const facingX = Number(socket.facing?.x ?? socket.facingX ?? 0);
  const facingZ = Number(socket.facing?.z ?? socket.facingZ ?? 0);
  const horizontal = Math.abs(facingX) > 0;
  const moduleWidth = tileSize * widthTiles;
  const moduleDepth = tileSize * depthTiles;
  const lead = tileSize;
  const centerOffset = lead + moduleDepth * 0.5;
  return {
    id: `${socket.id}:endpoint-module-overlap${idSuffix}`,
    socketId: socket.id,
    center: {
      x: Number(socket.position?.x ?? socket.x * tileSize ?? 0)
        + facingX * centerOffset,
      y: Number(socket.position?.y ?? socket.elevation ?? 0) + 4.2,
      z: Number(socket.position?.z ?? socket.z * tileSize ?? 0)
        + facingZ * centerOffset,
    },
    size: {
      x: horizontal ? moduleDepth : moduleWidth,
      y: 8.4,
      z: horizontal ? moduleWidth : moduleDepth,
    },
    purpose: 'route-network-endpoint-module-parent-merge',
    moduleKind: 'connector-module',
    moduleTemplateId,
    footprintTiles: { width: widthTiles, depth: depthTiles },
    leadTiles: 1,
    parentOwnerId: String(socket.logicalEdgeId ?? socket.parentRouteId ?? ''),
  };
}

function worldPathFromPlan(plan, tileSize) {
  const gridPath = createUsableSpliceGridPath(plan);
  const contractPath = plan.bridgePath ?? gridPath;
  const sourceElevation = Number(
    plan.sourceElevation
      ?? plan.fromSocket?.elevation
      ?? plan.elevation
      ?? 0,
  );
  const destinationElevation = Number(
    plan.destinationElevation
      ?? plan.toSocket?.elevation
      ?? sourceElevation,
  );
  return gridPath.map((point, index) => {
    const contractIndex = contractPath.findIndex((candidate) => sameGridPoint(candidate, point));
    const approachElevation = resolveDungeonConnectorApproachElevationAt(
      plan,
      contractIndex >= 0 ? contractIndex : index,
    );
    const fallbackRatio = gridPath.length <= 1 ? 0 : index / (gridPath.length - 1);
    return {
      x: Number(point.x) * tileSize,
      // Transfer-aperture points remain useful for measuring the immutable
      // centerline, but are explicitly ineligible as ordinary wall stations.
      y: Number.isFinite(approachElevation)
        ? approachElevation
        : sourceElevation + (destinationElevation - sourceElevation) * fallbackRatio,
      stationEligible: Number.isFinite(approachElevation),
      z: Number(point.z) * tileSize,
    };
  });
}

function sampleWorldPathAtDistance(path, requestedDistance) {
  const distance = Math.max(0, Number(requestedDistance) || 0);
  let traversed = 0;
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    const segmentLength = Math.hypot(to.x - from.x, to.z - from.z);
    if (segmentLength <= 1e-9) continue;
    if (traversed + segmentLength >= distance || index === path.length - 1) {
      const localDistance = Math.max(0, Math.min(segmentLength, distance - traversed));
      const ratio = localDistance / segmentLength;
      return {
        position: {
          x: from.x + (to.x - from.x) * ratio,
          y: from.y + (to.y - from.y) * ratio,
          z: from.z + (to.z - from.z) * ratio,
        },
        stationEligible: ratio <= 1e-6
          ? from.stationEligible !== false
          : ratio >= 1 - 1e-6
            ? to.stationEligible !== false
            : from.stationEligible !== false && to.stationEligible !== false,
        tangent: {
          x: (to.x - from.x) / segmentLength,
          y: 0,
          z: (to.z - from.z) / segmentLength,
        },
      };
    }
    traversed += segmentLength;
  }
  const fallback = path.at(-1) ?? { x: 0, y: 0, z: 0 };
  return {
    position: { x: fallback.x, y: fallback.y, z: fallback.z },
    stationEligible: fallback.stationEligible !== false,
    tangent: { x: 0, y: 0, z: 1 },
  };
}

function deterministicSideSign(id) {
  return [...String(id)].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 2 === 0
    ? 1
    : -1;
}

function rectangleIntersectionArea(first, second) {
  const overlapX = Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX);
  const overlapZ = Math.min(first.maxZ, second.maxZ) - Math.max(first.minZ, second.minZ);
  return overlapX > 0 && overlapZ > 0 ? overlapX * overlapZ : 0;
}

function roomPlanningRectangle(room, tileSize) {
  const halfWidth = Number(room.width ?? 1) * tileSize * 0.5 + tileSize;
  const halfDepth = Number(room.depth ?? 1) * tileSize * 0.5 + tileSize;
  const centerX = Number(room.x ?? 0) * tileSize;
  const centerZ = Number(room.z ?? 0) * tileSize;
  return {
    id: `room:${room.id}`,
    minX: centerX - halfWidth,
    maxX: centerX + halfWidth,
    minZ: centerZ - halfDepth,
    maxZ: centerZ + halfDepth,
  };
}

function roomBodyPlanningRectangle(room, tileSize) {
  // Keep a small numerical/assembly seam without consuming an entire tile of
  // otherwise valid station space. Exact body-edge contact is not a usable
  // wall seam, while the planner's full proxy remains the final authority.
  const seam = tileSize * 0.05;
  const halfWidth = Number(room.width ?? 1) * tileSize * 0.5 + seam;
  const halfDepth = Number(room.depth ?? 1) * tileSize * 0.5 + seam;
  const centerX = Number(room.x ?? 0) * tileSize;
  const centerZ = Number(room.z ?? 0) * tileSize;
  return {
    id: `room-body:${room.id}`,
    minX: centerX - halfWidth,
    maxX: centerX + halfWidth,
    minZ: centerZ - halfDepth,
    maxZ: centerZ + halfDepth,
  };
}

function galleryPlanningRectangles(plan, tileSize) {
  const hasRealizedFootprint = (plan.galleryFootprintTiles ?? []).length > 0;
  const hasReservedFamilyFootprint = (plan.familyReservedFootprintColumns ?? []).length > 0;
  const exactFootprintSource = hasRealizedFootprint
    ? plan.galleryFootprintTiles
    : hasReservedFamilyFootprint
      ? plan.familyReservedFootprintColumns
      : null;
  const points = exactFootprintSource
    ? [...new Map(exactFootprintSource
      .filter((point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.z)))
      .map((point) => [
        `${Number(point.x)},${Number(point.z)}`,
        { x: Number(point.x) * tileSize, z: Number(point.z) * tileSize },
      ])).values()]
    : worldPathFromPlan(plan, tileSize);
  // A realized footprint already contains every widened gallery/turn cell, so
  // score the actual one-tile body. Pre-assembly plans only expose a centerline
  // and retain the conservative four-tile planning width used historically.
  const halfWidth = tileSize * (exactFootprintSource ? 0.5 : 2);
  return points.map((point, index) => ({
    id: `gallery:${plan.id ?? logicalConnectionId(plan)}:${index}`,
    center: { x: point.x, z: point.z },
    minX: point.x - halfWidth,
    maxX: point.x + halfWidth,
    minZ: point.z - halfWidth,
    maxZ: point.z + halfWidth,
  }));
}

function coverageStationPlanningRectangle(sample, facing, tileSize) {
  // A corridor-wall aperture owns only its three-tile-wide, two-tile-deep flat
  // lead. The exact planner continues from that lead to a substantive room or
  // traversal module; a decorative endpoint vestibule never satisfies it.
  const tangentialHalfSpan = tileSize * 1.5;
  const normalHalfSpan = tileSize * 0.5;
  const center = {
    x: sample.position.x + facing.x * (
      tileSize * 1.5 + normalHalfSpan
    ),
    z: sample.position.z + facing.z * (
      tileSize * 1.5 + normalHalfSpan
    ),
  };
  const normalRunsAlongX = Math.abs(facing.x) > Math.abs(facing.z);
  const halfX = normalRunsAlongX ? normalHalfSpan : tangentialHalfSpan;
  const halfZ = normalRunsAlongX ? tangentialHalfSpan : normalHalfSpan;
  return {
    center,
    minX: center.x - halfX,
    maxX: center.x + halfX,
    minZ: center.z - halfZ,
    maxZ: center.z + halfZ,
  };
}

function coverageStationApproachPlanningRectangle(sample, facing, tileSize) {
  // The socket sits on the outer edge of the three-tile authored gallery
  // (1.5 tiles from its centerline) and must retain two flat approach tiles
  // beyond that threshold. At a ninety-degree bend this footprint exposes the
  // otherwise-hidden case where the proposed doorway points directly down the
  // next leg of the parent corridor instead of out through a real wall.
  const thresholdOffset = tileSize * 1.5;
  const approachDepth = tileSize;
  const center = {
    x: sample.position.x + facing.x * (thresholdOffset + approachDepth * 0.5),
    z: sample.position.z + facing.z * (thresholdOffset + approachDepth * 0.5),
  };
  const runsAlongX = Math.abs(facing.x) > Math.abs(facing.z);
  const halfX = runsAlongX ? approachDepth * 0.5 : tileSize * 1.5;
  const halfZ = runsAlongX ? tileSize * 1.5 : approachDepth * 0.5;
  return {
    center,
    minX: center.x - halfX,
    maxX: center.x + halfX,
    minZ: center.z - halfZ,
    maxZ: center.z + halfZ,
  };
}

function corridorSegmentPlanningRectangle(from, to, halfWidth = 1.8) {
  const deltaX = Math.abs(Number(to.x) - Number(from.x));
  const deltaZ = Math.abs(Number(to.z) - Number(from.z));
  if (deltaX <= 1e-6 && deltaZ <= 1e-6) return null;
  const runsAlongX = deltaX >= deltaZ;
  return {
    minX: Math.min(Number(from.x), Number(to.x)) - (runsAlongX ? 0 : halfWidth),
    maxX: Math.max(Number(from.x), Number(to.x)) + (runsAlongX ? 0 : halfWidth),
    minZ: Math.min(Number(from.z), Number(to.z)) - (runsAlongX ? halfWidth : 0),
    maxZ: Math.max(Number(from.z), Number(to.z)) + (runsAlongX ? halfWidth : 0),
  };
}

function normalizedCoverageRoute(points) {
  return points.filter((point, index) => (
    index === 0
      || Math.hypot(
        Number(point.x) - Number(points[index - 1].x),
        Number(point.z) - Number(points[index - 1].z),
      ) > 1e-6
  ));
}

function coverageRouteBacktracks(path) {
  const legs = path.slice(1).map((point, index) => ({
    x: Number(point.x) - Number(path[index].x),
    z: Number(point.z) - Number(path[index].z),
  })).filter((delta) => Math.hypot(delta.x, delta.z) > 1e-6);
  return legs.slice(1).some((delta, index) => {
    const previous = legs[index];
    const sameAxis = (Math.abs(previous.x) > 1e-6 && Math.abs(delta.x) > 1e-6)
      || (Math.abs(previous.z) > 1e-6 && Math.abs(delta.z) > 1e-6);
    return sameAxis && previous.x * delta.x + previous.z * delta.z < -1e-6;
  });
}

function coverageRouteLengthMeters(path) {
  return path.slice(1).reduce((sum, point, index) => (
    sum + Math.hypot(
      Number(point.x) - Number(path[index].x),
      Number(point.z) - Number(path[index].z),
    )
  ), 0);
}

function coverageRouteIsClear(path, obstacles) {
  if (coverageRouteBacktracks(path)) return false;
  return path.slice(1).every((point, index) => {
    const rectangle = corridorSegmentPlanningRectangle(path[index], point);
    return !rectangle || obstacles.every((obstacle) => (
      rectangleIntersectionArea(rectangle, obstacle) <= 1e-6
    ));
  });
}

function findCoverageContentContinuationWitnesses({
  moduleCenter,
  facing,
  tileSize,
  obstacles,
}) {
  const tangent = { x: -facing.z, z: facing.x };
  const moduleHalfDepth = ROUTE_NETWORK_ENDPOINT_MODULE_DEPTH_METERS * 0.5;
  const contentHalfSpan = ROUTE_NETWORK_ENDPOINT_CONTENT_SPAN_METERS * 0.5;
  const moduleExit = {
    x: moduleCenter.x + facing.x * moduleHalfDepth,
    z: moduleCenter.z + facing.z * moduleHalfDepth,
  };
  const configurations = [
    { outwardOffset: 0, tangentOffset: 0 },
    ...[5.6, 11.2, 16.8].flatMap((tangentMagnitude) => [
      { outwardOffset: 5.6, tangentOffset: -tangentMagnitude },
      { outwardOffset: 5.6, tangentOffset: tangentMagnitude },
    ]),
    ...[-11.2, 11.2].flatMap((tangentOffset) => [
      { outwardOffset: 11.2, tangentOffset },
    ]),
  ];
  const candidates = [];
  for (const { outwardOffset, tangentOffset } of configurations) {
    const continuationCenterDistance = moduleHalfDepth
      + ROUTE_NETWORK_MODULE_GAP_METERS
      + outwardOffset
      + contentHalfSpan;
    const continuationCenter = {
      x: moduleCenter.x + facing.x * continuationCenterDistance
        + tangent.x * tangentOffset,
      z: moduleCenter.z + facing.z * continuationCenterDistance
        + tangent.z * tangentOffset,
    };
    const continuationRectangle = {
      id: 'coverage-content-continuation-witness',
      center: continuationCenter,
      minX: continuationCenter.x - contentHalfSpan,
      maxX: continuationCenter.x + contentHalfSpan,
      minZ: continuationCenter.z - contentHalfSpan,
      maxZ: continuationCenter.z + contentHalfSpan,
    };
    if (obstacles.some((obstacle) => (
      rectangleIntersectionArea(continuationRectangle, obstacle) > 1e-6
    ))) continue;
    const continuationEntry = {
      x: continuationCenter.x - facing.x * contentHalfSpan,
      z: continuationCenter.z - facing.z * contentHalfSpan,
    };
    const collinear = Math.abs(moduleExit.x - continuationEntry.x) <= 1e-6
      || Math.abs(moduleExit.z - continuationEntry.z) <= 1e-6;
    const sourceLead = {
      x: moduleExit.x + facing.x * ROUTE_NETWORK_MODULE_GAP_METERS,
      z: moduleExit.z + facing.z * ROUTE_NETWORK_MODULE_GAP_METERS,
    };
    const destinationLead = {
      x: continuationEntry.x - facing.x * ROUTE_NETWORK_MODULE_GAP_METERS,
      z: continuationEntry.z - facing.z * ROUTE_NETWORK_MODULE_GAP_METERS,
    };
    const routeOptions = collinear
      ? [[moduleExit, continuationEntry]]
      : [
        [
          moduleExit,
          sourceLead,
          { x: destinationLead.x, z: sourceLead.z },
          destinationLead,
          continuationEntry,
        ],
        [
          moduleExit,
          sourceLead,
          { x: sourceLead.x, z: destinationLead.z },
          destinationLead,
          continuationEntry,
        ],
      ].map(normalizedCoverageRoute);
    const route = routeOptions.find((candidate) => (
      coverageRouteLengthMeters(candidate) <= MAXIMUM_FEATURELESS_SPAN_METERS + 1e-6
        && coverageRouteIsClear(candidate, obstacles)
    ));
    if (!route) continue;
    candidates.push({
      continuationCenter,
      continuationRectangle,
      continuationRoute: route,
      continuationPathLengthMeters: coverageRouteLengthMeters(route),
      continuationOutwardOffset: outwardOffset,
      continuationTangentOffset: tangentOffset,
    });
  }
  return candidates.sort((first, second) => (
    first.continuationPathLengthMeters - second.continuationPathLengthMeters
      || Math.abs(first.continuationTangentOffset)
        - Math.abs(second.continuationTangentOffset)
      || first.continuationOutwardOffset - second.continuationOutwardOffset
      || first.continuationTangentOffset - second.continuationTangentOffset
  ));
}

function findCoverageFullRoomWitnesses({
  sample,
  facing,
  tileSize,
  obstacles,
}) {
  const tangent = { x: -facing.z, z: facing.x };
  const socket = {
    x: Number(sample.position.x) + facing.x * tileSize * 1.5,
    z: Number(sample.position.z) + facing.z * tileSize * 1.5,
  };
  const approachLength = tileSize;
  const roomHalfDepth = ROUTE_NETWORK_ENDPOINT_MODULE_DEPTH_METERS * 0.5;
  const roomHalfWidth = ROUTE_NETWORK_ENDPOINT_MODULE_WIDTH_METERS * 0.5;
  // The public endpoint-overlap grant is an exact one-tile lead into a 5x7
  // Through-T. Do not advertise shifted witnesses which that grant cannot
  // legally realize; station displacement already searches the parent route.
  const outwardOffsets = [0];
  const tangentOffsets = [0];
  const candidates = [];

  for (const outwardOffset of outwardOffsets) {
    for (const tangentOffset of tangentOffsets) {
      const entry = {
        x: socket.x
          + facing.x * (approachLength + outwardOffset)
          + tangent.x * tangentOffset,
        z: socket.z
          + facing.z * (approachLength + outwardOffset)
          + tangent.z * tangentOffset,
      };
      const center = {
        x: entry.x + facing.x * roomHalfDepth,
        z: entry.z + facing.z * roomHalfDepth,
      };
      const normalRunsAlongX = Math.abs(facing.x) > Math.abs(facing.z);
      const roomRectangle = {
        id: 'coverage-full-room-witness',
        center,
        minX: center.x - (normalRunsAlongX ? roomHalfDepth : roomHalfWidth),
        maxX: center.x + (normalRunsAlongX ? roomHalfDepth : roomHalfWidth),
        minZ: center.z - (normalRunsAlongX ? roomHalfWidth : roomHalfDepth),
        maxZ: center.z + (normalRunsAlongX ? roomHalfWidth : roomHalfDepth),
      };
      const roomBlocked = obstacles.some((obstacle) => (
        rectangleIntersectionArea(roomRectangle, obstacle) > 1e-6
      ));
      if (roomBlocked) continue;

      // A Through-T which fits but terminates against an authored room is not
      // a usable network endpoint. Reserve a real adjacent 7x7 content room
      // and its connector. Nearby stations may stagger that continuation on
      // the 2.8 m planning grid; the endpoint module itself stays pinned to its
      // exact one-tile parent lead.
      const continuationWitnesses = findCoverageContentContinuationWitnesses({
        moduleCenter: center,
        facing,
        tileSize,
        obstacles,
      });
      if (continuationWitnesses.length === 0) continue;

      const fromLead = {
        x: socket.x + facing.x * approachLength,
        z: socket.z + facing.z * approachLength,
      };
      const toLead = {
        x: entry.x - facing.x * approachLength,
        z: entry.z - facing.z * approachLength,
      };
      const collinear = Math.abs(socket.x - entry.x) <= 1e-6
        || Math.abs(socket.z - entry.z) <= 1e-6;
      const routeOptions = collinear
        ? [[socket, entry]]
        : [
          [
            socket,
            fromLead,
            { x: toLead.x, z: fromLead.z },
            toLead,
            entry,
          ],
          [
            socket,
            fromLead,
            { x: fromLead.x, z: toLead.z },
            toLead,
            entry,
          ],
        ].map(normalizedCoverageRoute);
      const route = routeOptions.find((path) => {
        const pathLengthMeters = coverageRouteLengthMeters(path);
        if (pathLengthMeters > MAXIMUM_FEATURELESS_SPAN_METERS + 1e-6
          || !coverageRouteIsClear(path, obstacles)) return false;
        return true;
      });
      if (!route) continue;
      const pathLengthMeters = coverageRouteLengthMeters(route);
      for (const continuationWitness of continuationWitnesses) {
        candidates.push({
          center,
          roomRectangle,
          ...continuationWitness,
          route,
          pathLengthMeters,
          outwardOffset,
          tangentOffset,
        });
      }
    }
  }

  return candidates.sort((first, second) => (
    first.pathLengthMeters - second.pathLengthMeters
      || first.continuationPathLengthMeters - second.continuationPathLengthMeters
      || Math.abs(first.tangentOffset) - Math.abs(second.tangentOffset)
      || first.outwardOffset - second.outwardOffset
      || first.tangentOffset - second.tangentOffset
  )).slice(0, 16);
}

function coverageApproachIntersectsOwnCenterline(
  sample,
  facing,
  centerline,
  tileSize,
) {
  const tangent = { x: -facing.z, z: facing.x };
  return centerline.some((point) => {
    const deltaX = Number(point.x) - Number(sample.position.x);
    const deltaZ = Number(point.z) - Number(sample.position.z);
    const outwardDistance = deltaX * facing.x + deltaZ * facing.z;
    const lateralDistance = Math.abs(deltaX * tangent.x + deltaZ * tangent.z);
    return outwardDistance > tileSize * 0.25
      && outwardDistance < tileSize * 4 + 1e-6
      && lateralDistance < tileSize * 1.5 - 1e-6;
  });
}

function coverageRoutePlanningRectangles({
  edgeId,
  samples,
  stationRectangles,
  tileSize,
}) {
  const halfWidth = tileSize * 1.5;
  const rectangles = [];
  const appendSegmentRectangle = (from, to, pairIndex, segmentIndex) => {
    const deltaX = Math.abs(Number(to.x) - Number(from.x));
    const deltaZ = Math.abs(Number(to.z) - Number(from.z));
    if (deltaX <= 1e-6 && deltaZ <= 1e-6) return;
    const runsAlongX = deltaX >= deltaZ;
    const minimumX = Math.min(Number(from.x), Number(to.x));
    const maximumX = Math.max(Number(from.x), Number(to.x));
    const minimumZ = Math.min(Number(from.z), Number(to.z));
    const maximumZ = Math.max(Number(from.z), Number(to.z));
    const minX = runsAlongX ? minimumX : minimumX - halfWidth;
    const maxX = runsAlongX ? maximumX : maximumX + halfWidth;
    const minZ = runsAlongX ? minimumZ - halfWidth : minimumZ;
    const maxZ = runsAlongX ? maximumZ + halfWidth : maximumZ;
    rectangles.push({
      id: `coverage-route:${edgeId}:${pairIndex}:${segmentIndex}`,
      center: {
        x: (minX + maxX) * 0.5,
        z: (minZ + maxZ) * 0.5,
      },
      minX,
      maxX,
      minZ,
      maxZ,
      purpose: 'industrial-supplement-coverage-route-reservation',
    });
  };
  for (let index = 1; index < stationRectangles.length; index += 1) {
    const from = stationRectangles[index - 1].center;
    const to = stationRectangles[index].center;
    const tangent = samples[index - 1]?.tangent ?? { x: 0, z: 1 };
    // Leave each station in the direction of its authored centerline. This
    // produces the deterministic orthogonal elbow which follows a winding
    // gallery instead of cutting diagonally across the intervening plan.
    const authoredRouteRunsAlongX = Math.abs(Number(tangent.x))
      >= Math.abs(Number(tangent.z));
    const elbow = authoredRouteRunsAlongX
      ? { x: Number(to.x), z: Number(from.z) }
      : { x: Number(from.x), z: Number(to.z) };
    appendSegmentRectangle(from, elbow, index - 1, 0);
    appendSegmentRectangle(elbow, to, index - 1, 1);
  }
  return rectangles;
}

function expandCoverageStationForDecisionEgress(rectangle, edgeId, endpointOrdinal, tileSize) {
  // Reserve enough space for the direct three-tile gallery to turn toward a
  // substantive module, so a later grant cannot consume every possible egress lane
  // before the exact planner selects that room's socket.
  const expansion = tileSize * 3.5;
  const minX = Number(rectangle.minX) - expansion;
  const maxX = Number(rectangle.maxX) + expansion;
  const minZ = Number(rectangle.minZ) - expansion;
  const maxZ = Number(rectangle.maxZ) + expansion;
  return {
    id: `coverage-decision-egress:${edgeId}:${endpointOrdinal}`,
    center: {
      x: (minX + maxX) * 0.5,
      z: (minZ + maxZ) * 0.5,
    },
    minX,
    maxX,
    minZ,
    maxZ,
    purpose: 'industrial-supplement-coverage-decision-egress-reservation',
  };
}

function chooseCoverageSideSign({
  edgeId,
  samples,
  rooms,
  connectionPlans,
  plan,
  tileSize,
  reservedRectangles,
  fullRoomWitnessCache = null,
}) {
  const authoredRoomObstacles = rooms.map((room) => roomPlanningRectangle(room, tileSize));
  const authoredRoomBodyObstacles = rooms.map((room) => roomBodyPlanningRectangle(room, tileSize));
  const authoredForeignGalleryObstacles = connectionPlans
    .filter((candidate) => candidate !== plan)
    .flatMap((candidate) => galleryPlanningRectangles(candidate, tileSize));
  const authoredRouteObstacles = [
    ...authoredForeignGalleryObstacles,
    ...reservedRectangles,
  ];
  const ownRouteObstacles = galleryPlanningRectangles(plan, tileSize);
  const ownRouteCenterline = worldPathFromPlan(plan, tileSize);
  const preferredSign = deterministicSideSign(edgeId);
  const candidatesBySample = samples.map((sample) => {
    const scoreSign = (sideSign) => {
      const facing = {
        x: -sample.tangent.z * sideSign,
        y: 0,
        z: sample.tangent.x * sideSign,
      };
      const rectangle = coverageStationPlanningRectangle(sample, facing, tileSize);
      const approachRectangle = coverageStationApproachPlanningRectangle(
        sample,
        facing,
        tileSize,
      );
      const overlapRecords = (obstacles) => obstacles.map((obstacle) => ({
        id: obstacle.id,
        purpose: obstacle.purpose ?? null,
        area: rectangleIntersectionArea(rectangle, obstacle),
      })).filter(({ area }) => area > 0)
        .sort((first, second) => second.area - first.area || first.id.localeCompare(second.id));
      const roomOverlaps = overlapRecords(authoredRoomObstacles);
      const routeOverlaps = overlapRecords(authoredRouteObstacles);
      const ownRouteObstacleBlocksAperture = (obstacle) => {
        const deltaX = Number(obstacle.center.x) - Number(sample.position.x);
        const deltaZ = Number(obstacle.center.z) - Number(sample.position.z);
        const outwardProjection = deltaX * Number(facing.x)
          + deltaZ * Number(facing.z);
        const manhattanDistance = Math.abs(deltaX) + Math.abs(deltaZ);
        // Ignore only the local three-tile gallery cross-section behind the
        // threshold. A widened turn cell just beyond the proposed wall is a
        // real blocker even when it lies within the old four-tile proximity
        // exemption; otherwise the host advertises a socket whose mandatory
        // straight lead immediately re-enters its own authored corridor.
        return outwardProjection > tileSize * 1.5 + 1e-6
          || manhattanDistance > tileSize * 4 + 1e-6;
      };
      const ownRouteOverlaps = overlapRecords(ownRouteObstacles
        // The doorway landing intentionally meets the local authored gallery;
        // another leg of the same winding route remains a hard placement
        // obstacle. Ignoring the whole source plan allowed stations at bends
        // whose rooms sat directly over the incoming corridor.
        .filter(ownRouteObstacleBlocksAperture));
      const remoteOwnRouteObstacles = ownRouteObstacles.filter(
        ownRouteObstacleBlocksAperture,
      );
      const witnessKey = [
        Number(sample.position.x).toFixed(3),
        Number(sample.position.z).toFixed(3),
        Number(sample.tangent.x).toFixed(3),
        Number(sample.tangent.z).toFixed(3),
        sideSign,
      ].join(':');
      let fullRoomWitnesses = fullRoomWitnessCache?.get(witnessKey);
      if (fullRoomWitnesses === undefined) {
        fullRoomWitnesses = findCoverageFullRoomWitnesses({
          sample,
          facing,
          tileSize,
          obstacles: [
            ...authoredRoomBodyObstacles,
            ...authoredForeignGalleryObstacles,
            ...remoteOwnRouteObstacles,
          ],
        });
        fullRoomWitnessCache?.set(witnessKey, fullRoomWitnesses);
      }
      const fullRoomWitness = fullRoomWitnesses[0] ?? null;
      const roomOverlapArea = roomOverlaps.reduce((sum, { area }) => sum + area, 0);
      const softReservationPurposes = new Set([
        'industrial-supplement-coverage-decision-egress-reservation',
        'industrial-supplement-coverage-route-reservation',
      ]);
      const hardRouteOverlapArea = routeOverlaps
        .filter(({ purpose }) => !softReservationPurposes.has(purpose))
        .reduce((sum, { area }) => sum + area, 0);
      const softReservationOverlapArea = routeOverlaps
        .filter(({ purpose }) => softReservationPurposes.has(purpose))
        .reduce((sum, { area }) => sum + area, 0);
      const ownRouteOverlapArea = ownRouteOverlaps.reduce((sum, { area }) => sum + area, 0);
      const approachIntersectsOwnCenterline = coverageApproachIntersectsOwnCenterline(
        sample,
        facing,
        ownRouteCenterline,
        tileSize,
      );
      const authoredScore = roomOverlapArea * 1e9
        + ownRouteOverlapArea * 1e8
        + hardRouteOverlapArea * 1000
        + softReservationOverlapArea * 1e6
        + (sideSign === preferredSign ? 0 : 1);
      return {
        sideSign,
        rectangle,
        approachRectangle,
        fullRoomWitnesses,
        fullRoomWitness,
        apertureBlocked: sample.stationEligible === false
          || approachIntersectsOwnCenterline,
        stationBodyBlocked: ownRouteOverlapArea > 1e-6,
        fullRoomBodyBlocked: !fullRoomWitness,
        hardOverlapArea: roomOverlapArea + hardRouteOverlapArea + ownRouteOverlapArea,
        // A station footprint intersecting an authored room is not recoverable
        // by later connector routing, while a route/reservation overlap may be
        // avoided by the planner's bounded local displacement. Keep room
        // preservation dominant over connectivity and soft route spacing.
        authoredScore,
        diagnostics: {
          sideSign,
          facing,
          rectangle,
          approachRectangle,
          authoredScore,
          roomOverlapArea,
          routeOverlapArea: hardRouteOverlapArea + softReservationOverlapArea,
          hardRouteOverlapArea,
          softReservationOverlapArea,
          ownRouteOverlapArea,
          stationBodyBlocked: ownRouteOverlapArea > 1e-6,
          fullRoomBodyBlocked: !fullRoomWitness,
          fullRoomWitness: fullRoomWitness ? {
            center: fullRoomWitness.center,
            roomRectangle: fullRoomWitness.roomRectangle,
            continuationCenter: fullRoomWitness.continuationCenter,
            continuationRectangle: fullRoomWitness.continuationRectangle,
            continuationRoute: fullRoomWitness.continuationRoute,
            continuationPathLengthMeters:
              fullRoomWitness.continuationPathLengthMeters,
            continuationOutwardOffset:
              fullRoomWitness.continuationOutwardOffset,
            continuationTangentOffset:
              fullRoomWitness.continuationTangentOffset,
            pathLengthMeters: fullRoomWitness.pathLengthMeters,
            outwardOffset: fullRoomWitness.outwardOffset,
            tangentOffset: fullRoomWitness.tangentOffset,
          } : null,
          approachIntersectsOwnCenterline,
          stationEligible: sample.stationEligible !== false,
          roomOverlaps: roomOverlaps.slice(0, 12),
          routeOverlaps: routeOverlaps.slice(0, 12),
          ownRouteOverlaps: ownRouteOverlaps.slice(0, 12),
        },
      };
    };
    return [scoreSign(1), scoreSign(-1)];
  });
  // Select all station sides as one layout.  Independent per-station choices
  // can put two otherwise-valid modules on top of one another at a bend (for
  // example, a south-facing station followed by an east-facing station).  At
  // most five V4 stations exist, so exhaustively scoring the 2^N side layouts
  // is both deterministic and cheap compared with the surrounding geometry
  // validation.
  let best = null;
  const visit = (sampleIndex, selected, score, sideReversalCount) => {
    if (sampleIndex >= candidatesBySample.length) {
      const signature = selected.map(({ sideSign }) => sideSign).join(',');
      if (!best || sideReversalCount < best.sideReversalCount
        || (sideReversalCount === best.sideReversalCount
          && score < best.score - 1e-6)
        || (sideReversalCount === best.sideReversalCount
          && Math.abs(score - best.score) <= 1e-6
          && signature < best.signature)) {
        best = { selected: [...selected], score, sideReversalCount, signature };
      }
      return;
    }
    for (const candidate of candidatesBySample[sampleIndex]) {
      if (candidate.apertureBlocked) continue;
      if (candidate.stationBodyBlocked) continue;
      if (candidate.fullRoomBodyBlocked) continue;
      // A required grant is not useful if its minimum substantive station body
      // already overlaps an authored room or another hard route obstacle.
      // Reject that sample/side and continue the bounded distance search;
      // never hand the exact planner a socket that can only be realized as an
      // buried module or a disconnected floor fragment.
      if (candidate.hardOverlapArea > 1e-6) continue;
      const stationOverlapArea = selected.reduce((sum, existing) => (
        sum + rectangleIntersectionArea(candidate.rectangle, existing.rectangle)
      ), 0);
      if (stationOverlapArea > 1e-6) continue;
      const previous = selected.at(-1);
      const consecutiveCenterDistance = previous
        ? Math.abs(candidate.rectangle.center.x - previous.rectangle.center.x)
          + Math.abs(candidate.rectangle.center.z - previous.rectangle.center.z)
        : 0;
      // Centers may be farther apart than their eventual doorway sockets by
      // one direct lead allowance. Beyond it, choosing opposite sides of a
      // bend creates a connector which can never satisfy the 12-tile
      // featureless-span limit. Make that infeasibility dominate ordinary
      // footprint-overlap scoring; the planner can stagger nearby rooms within
      // each aperture's bounded attachment reach.
      const maximumConnectableCenterDistance = MAXIMUM_FEATURELESS_SPAN_METERS
        + tileSize * 7;
      const connectivityExcess = Math.max(
        0,
        consecutiveCenterDistance - maximumConnectableCenterDistance,
      );
      for (const fullRoomWitness of candidate.fullRoomWitnesses) {
        const fullRoomOverlapArea = selected.reduce((sum, existing) => (
          sum + [
            fullRoomWitness.roomRectangle,
            fullRoomWitness.continuationRectangle,
          ].reduce((pairSum, rectangle) => (
            pairSum + [
              existing.fullRoomWitness.roomRectangle,
              existing.fullRoomWitness.continuationRectangle,
            ].reduce((rectangleSum, existingRectangle) => (
              rectangleSum + rectangleIntersectionArea(rectangle, existingRectangle)
            ), 0)
          ), 0)
        ), 0);
        if (fullRoomOverlapArea > 1e-6) continue;
        visit(
          sampleIndex + 1,
          [...selected, { ...candidate, fullRoomWitness }],
          score
            + candidate.authoredScore
            + stationOverlapArea * 1e9
            + connectivityExcess * connectivityExcess * 100000
            + consecutiveCenterDistance * 0.001
            + fullRoomWitness.pathLengthMeters * 0.0001,
          sideReversalCount + Number(Boolean(previous)
            && previous.sideSign !== candidate.sideSign),
        );
      }
    }
  };
  visit(0, [], 0, 0);
  const choices = best?.selected ?? [];
  return {
    sideSigns: choices.map(({ sideSign }) => sideSign),
    rectangles: choices.map(({ rectangle }) => rectangle),
    moduleWitnessRectangles: choices.map(({ fullRoomWitness }) => (
      fullRoomWitness.roomRectangle
    )),
    contentContinuationRectangles: choices.map(({ fullRoomWitness }) => (
      fullRoomWitness.continuationRectangle
    )),
    selectedWitnesses: choices.map(({ fullRoomWitness }) => fullRoomWitness),
    score: best?.score ?? Number.POSITIVE_INFINITY,
    sideReversalCount: best?.sideReversalCount ?? Number.POSITIVE_INFINITY,
    feasible: Boolean(best),
    diagnostics: candidatesBySample.map((candidates, sampleIndex) => ({
      sampleIndex,
      selectedSideSign: choices[sampleIndex]?.sideSign ?? null,
      candidates: candidates.map(({ diagnostics }) => diagnostics),
    })),
  };
}

function chooseCoverageStationLayout({
  edgeId,
  nominalDistancesMeters,
  pathLengthMeters,
  centerline,
  rooms,
  connectionPlans,
  plan,
  tileSize,
  reservedRectangles,
  ordinaryTraversalSpans,
  nominalStationSpans,
}) {
  const fullRoomWitnessCache = new Map();
  const candidateOffsetsTiles = [
    0,
    -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6,
    -7, 7, -8, 8, -9, 9, -10, 10, -11, 11, -12, 12,
  ];
  const candidatesByStation = nominalDistancesMeters.map((nominalDistance, stationIndex) => (
    [...new Set(candidateOffsetsTiles.map((offsetTiles) => (
      Number((nominalDistance + offsetTiles * tileSize).toFixed(6))
    )))].filter((distance) => {
      const span = nominalStationSpans[stationIndex];
      return distance > Number(span?.startDistanceMeters ?? 0) + 1e-6
        && distance < Number(span?.endDistanceMeters ?? pathLengthMeters) - 1e-6;
    })
  ));
  // Keep the search deterministic and bounded. Exhausting 25^N offset
  // combinations became pathological once invalid corner apertures were
  // correctly filtered. A displacement-ordered beam retains thousands of
  // alternatives while letting the exact planner remain the final authority.
  const maximumLayoutCandidates = 8192;
  let layoutStates = [{ distances: [], displacement: 0 }];
  for (let stationIndex = 0; stationIndex < candidatesByStation.length; stationIndex += 1) {
    layoutStates = layoutStates.flatMap((state) => candidatesByStation[stationIndex]
      .filter((distance) => {
        const previousBoundary = state.distances.at(-1) ?? 0;
        // The aperture is three tiles wide, but an interior branch-entry T is
        // seven tiles along the parent corridor while a neighboring terminal
        // T is five. Their half-footprints therefore need six tiles between
        // centers. Reserving only the aperture width produced exact stations
        // whose authored module bodies overlapped before the supplement even
        // left the host corridor.
        return distance >= previousBoundary + tileSize * 6 - 1e-6;
      })
      .map((distance) => ({
        distances: [...state.distances, distance],
        displacement: state.displacement
          + Math.abs(distance - nominalDistancesMeters[stationIndex]),
      })))
      .sort((first, second) => (
        first.displacement - second.displacement
          || first.distances.join(',').localeCompare(second.distances.join(','))
      ))
      .slice(0, maximumLayoutCandidates);
    if (layoutStates.length === 0) return null;
  }
  let bestLayout = null;
  for (const { distances, displacement } of layoutStates) {
    const featurelessSpans = featurelessSpansWithinOrdinaryTraversal(
      ordinaryTraversalSpans,
      distances,
    );
    if (featurelessSpans.some((distance) => (
      distance > MAXIMUM_FEATURELESS_SPAN_METERS + 1e-6
    ))) continue;
    const samples = distances.map((distanceMeters) => ({
      distanceMeters,
      ...sampleWorldPathAtDistance(centerline, distanceMeters),
    }));
    const sideChoice = chooseCoverageSideSign({
      edgeId,
      samples,
      rooms,
      connectionPlans,
      plan,
      tileSize,
      reservedRectangles,
      fullRoomWitnessCache,
    });
    if (!sideChoice.feasible) continue;
    const score = sideChoice.score + displacement * 0.001;
    const candidateLayout = { score, distances, samples, sideChoice };
    if (!bestLayout
      || sideChoice.sideReversalCount < bestLayout.sideChoice.sideReversalCount
      || (sideChoice.sideReversalCount === bestLayout.sideChoice.sideReversalCount
        && score < bestLayout.score - 1e-6)) {
      bestLayout = candidateLayout;
    }
    // Layout states are displacement ordered. Once every station uses one
    // side, later layouts cannot improve the primary facing-reversal cost and
    // only add displacement.
    if (sideChoice.sideReversalCount === 0) return candidateLayout;
  }
  return bestLayout;
}

function createCoverageRouteGrant(
  plan,
  tileSize,
  themeBinding,
  { rooms = [], connectionPlans = [], reservedRectangles = [] } = {},
) {
  const edgeId = logicalConnectionId(plan);
  if (!OBJECTIVE_ROUTE_EDGE_IDS.has(edgeId) || Number(plan.level ?? 0) !== 0) return null;
  const centerline = worldPathFromPlan(plan, tileSize);
  const pathLengthMeters = measureGridPathMeters(createUsableSpliceGridPath(plan), tileSize);
  if (centerline.length < 2 || pathLengthMeters <= MAXIMUM_FEATURELESS_SPAN_METERS) return null;
  const ordinaryTraversalSpans = createOrdinaryTraversalSpans(centerline);
  if (ordinaryTraversalSpans.length === 0) return null;
  const stationAllocations = ordinaryTraversalSpans.map((span) => {
    const lengthTiles = Math.max(1, Math.round(span.lengthMeters / tileSize));
    const stationCapacity = Math.max(0, lengthTiles - 1);
    const coverageCount = Math.max(
      0,
      Math.ceil(span.lengthMeters / MAXIMUM_FEATURELESS_SPAN_METERS - 1e-9) - 1,
    );
    return {
      span,
      stationCapacity,
      count: Math.min(
        stationCapacity,
        // Coverage is measured over the complete ordinary traversal, through
        // bends and degree-two chains. A bend is not a meaningful reset and
        // therefore must not manufacture an extra station beyond the count
        // required by path distance.
        coverageCount,
      ),
    };
  });
  // Even when a real slope/ladder/lift already resets the authored traversal,
  // the coverage operation remains a substantive loop rather than a cosmetic
  // door. Allocate at least two exact apertures on the longest eligible level
  // approaches without ever placing one inside the transfer aperture itself.
  while (stationAllocations.reduce((sum, allocation) => sum + allocation.count, 0) < 2) {
    const allocation = [...stationAllocations]
      .filter(({ count, stationCapacity }) => count < stationCapacity)
      .sort((first, second) => (
        second.span.lengthMeters / (second.count + 1)
          - first.span.lengthMeters / (first.count + 1)
          || first.span.startDistanceMeters - second.span.startDistanceMeters
      ))[0];
    if (!allocation) return null;
    allocation.count += 1;
  }
  const stationCount = stationAllocations.reduce(
    (sum, allocation) => sum + allocation.count,
    0,
  );
  // Each exact authored aperture needs one connector module and every network
  // needs at least two true large rooms. The V4 six-module ceiling therefore
  // permits no more than four coverage apertures in one network.
  if (stationCount > MAXIMUM_COVERAGE_STATIONS) return null;
  const nominalStations = stationAllocations.flatMap(({ span, count }) => {
    const lengthTiles = Math.round(span.lengthMeters / tileSize);
    return Array.from({ length: count }, (_, index) => ({
      distanceMeters: Number((
        span.startDistanceMeters
          + Math.round(lengthTiles * (index + 1) / (count + 1)) * tileSize
      ).toFixed(6)),
      span,
    }));
  }).sort((first, second) => first.distanceMeters - second.distanceMeters);
  const nominalStationDistancesMeters = nominalStations.map(({ distanceMeters }) => (
    distanceMeters
  ));
  const nominalStationSpans = nominalStations.map(({ span }) => span);
  const stationLayout = chooseCoverageStationLayout({
    edgeId,
    nominalDistancesMeters: nominalStationDistancesMeters,
    pathLengthMeters,
    centerline,
    rooms,
    connectionPlans,
    plan,
    tileSize,
    reservedRectangles,
    ordinaryTraversalSpans,
    nominalStationSpans,
  });
  if (!stationLayout) return null;
  const stationDistancesMeters = stationLayout.distances;
  const samples = stationLayout.samples;
  const sideChoice = stationLayout.sideChoice;
  const planningRouteReservationRectangles = coverageRoutePlanningRectangles({
    edgeId,
    samples,
    stationRectangles: sideChoice.rectangles,
    tileSize,
  });
  const planningDecisionEgressReservationRectangles = sideChoice.rectangles.map(
    (rectangle, endpointOrdinal) => expandCoverageStationForDecisionEgress(
      rectangle,
      edgeId,
      endpointOrdinal,
      tileSize,
    ),
  );
  const progressionBandId = Math.max(
    progressionBandForRoom(plan.fromRoomId),
    progressionBandForRoom(plan.toRoomId),
  );
  const endpointSockets = Array.from({ length: stationCount }, (_, index) => {
    const distanceMeters = stationDistancesMeters[index];
    const sample = samples[index];
    const facing = {
      x: -sample.tangent.z * sideChoice.sideSigns[index],
      y: 0,
      z: sample.tangent.x * sideChoice.sideSigns[index],
    };
    const position = {
      x: sample.position.x + facing.x * tileSize * 1.5,
      y: sample.position.y,
      z: sample.position.z + facing.z * tileSize * 1.5,
    };
    return {
      id: `${INDUSTRIAL_EXTENSION_REGION_ID}:route-socket:${edgeId}:${index}`,
      // The parent source threshold owns every gate on this route, so all
      // corridor-wall stations resolve to the already-gated deeper room.
      // Runtime can therefore attach exact sockets without inventing a room
      // through proximity inference.
      nodeId: String(plan.toRoomId),
      roomId: String(plan.toRoomId),
      parentRouteId: String(plan.id ?? edgeId),
      logicalEdgeId: edgeId,
      routeNetworkSocketKind: 'authored-corridor-station',
      endpointModuleOverlapRequired: true,
      position,
      sourceCenterlinePosition: sample.position,
      facing,
      widthMeters: Number((tileSize * 3).toFixed(6)),
      heightMeters: 3.6,
      landingWidthTiles: 3,
      clearanceHeightMeters: 3.6,
      connectorFamily: 'service-gallery',
      connectorFamilies: ['service-gallery'],
      coordinateSpace: 'parent-plan',
      distanceMeters,
      progressionBandId,
      accessDomainId: accessDomainId(progressionBandId),
      themeBinding,
      planningModuleCenter: sideChoice.selectedWitnesses[index]?.center,
      planningContinuationCenter:
        sideChoice.selectedWitnesses[index]?.continuationCenter,
      planningContinuationRoute:
        sideChoice.selectedWitnesses[index]?.continuationRoute,
    };
  });
  const stationDirectionChangeCount = samples.slice(1).filter((sample, index) => {
    const previous = samples[index];
    return Math.abs(
      sample.tangent.x * previous.tangent.x + sample.tangent.z * previous.tangent.z
    ) < 0.5;
  }).length;
  const gateId = plan.doorId ?? null;
  const requiredCredentialIds = requiredCredentialIdsForDoor(gateId);
  const featurelessSpansMeters = featurelessSpansWithinOrdinaryTraversal(
    ordinaryTraversalSpans,
    stationDistancesMeters,
  );
  return {
    schema: ROUTE_NETWORK_GRANT_SCHEMA,
    id: `${INDUSTRIAL_EXTENSION_REGION_ID}:route-network-grant:coverage:${edgeId}`,
    required: true,
    kind: 'objective-route-coverage',
    endpointSockets,
    progressionBandId,
    accessDomainId: accessDomainId(progressionBandId),
    crossedBoundaryIds: gateId ? [`${edgeId}:gate:${gateId}`] : [],
    requiredCredentialIds,
    sourceGate: gateId ? {
      gateId,
      gatePlacementSide: 'source',
      requiredCredentialIds,
      encounterRequirementId: gateId === 'enemyNestGate' ? 'enemyNest' : null,
    } : null,
    protectedVolumes: [],
    socketLandingOverlapGrants: endpointSockets.map((socket) => (
      createSocketLandingOverlapGrant(socket, tileSize)
    )),
    socketModuleOverlapGrants: endpointSockets.flatMap((socket) => ([
      createSocketModuleOverlapGrant(socket, tileSize),
      // Interior coverage stations attach the authored corridor through the
      // side arm of a real Through-T. Its canonical 7x5 footprint is wider
      // across the parent threshold than the terminal station's 5x7 body, so
      // grant that exact alternative independently. Both grants remain bound
      // to this socket and parent connection; they cannot excuse collisions
      // with another authored room or route.
      createSocketModuleOverlapGrant(socket, tileSize, {
        idSuffix: ':branch-entry',
        moduleTemplateId: 'supplement-route-connector-through-t-branch-entry-v1',
        widthTiles: 7,
        depthTiles: 5,
      }),
    ])),
    mustPreserveBeatIds: [
      String(plan.fromRoomId),
      String(plan.toRoomId),
      ...(gateId ? [String(gateId)] : []),
    ],
    // Exact corridor stations are parent-owned apertures. The global solver
    // may attach either a curated room or a compact junction module here.
    minimumModules: V4_MINIMUM_SUBSTANTIVE_MODULES_PER_NETWORK,
    maximumModules: V4_MAXIMUM_SUBSTANTIVE_MODULES_PER_NETWORK,
    coverage: {
      logicalEdgeId: edgeId,
      physicalConnectionId: String(plan.id ?? edgeId),
      pathLengthMeters,
      stationDistancesMeters: endpointSockets.map(({ distanceMeters }) => distanceMeters),
      featurelessSpansMeters,
      ordinaryTraversalSpans: ordinaryTraversalSpans.map((span) => ({
        startDistanceMeters: span.startDistanceMeters,
        endDistanceMeters: span.endDistanceMeters,
        lengthMeters: span.lengthMeters,
        elevation: span.elevation,
      })),
      directionChangeCount: stationDirectionChangeCount,
      maximumFeaturelessSpanMeters: MAXIMUM_FEATURELESS_SPAN_METERS,
      coverageComplete: Math.max(...featurelessSpansMeters)
        <= MAXIMUM_FEATURELESS_SPAN_METERS + 1e-6,
    },
    // Host-only deterministic placement diagnostics. These are renderer-free
    // and permit later coverage grants to avoid already-reserved supplement
    // footprints without changing any legacy Industrial planning state.
    planningReservationRectangles: sideChoice.rectangles,
    planningRoomReservationRectangles: [
      ...sideChoice.moduleWitnessRectangles,
      ...sideChoice.contentContinuationRectangles,
    ],
    planningDecisionEgressReservationRectangles,
    planningRouteReservationRectangles,
    planningStationSideDiagnostics: sideChoice.diagnostics,
  };
}

function createThemeBinding() {
  return {
    schema: REGION_THEME_SCHEMA,
    parentMapId: 'industrial-v1',
    parentMapRevision: 'industrial-v1-layout-r1',
    parentRegionId: INDUSTRIAL_EXTENSION_REGION_ID,
    themeRef: {
      id: 'industrial-v1',
      revision: INDUSTRIAL_THEME_REVISION,
      contentHash: INDUSTRIAL_THEME_CONTENT_HASH,
    },
    presentationVariantId: 'inherit-parent-room-variant',
    localLightingProfileId: 'industrial-v1-local-fixtures',
    soundscapeProfileId: 'industrial-v1-ambient',
  };
}

function roomSocketCandidates(room, tileSize) {
  const halfWidth = Math.floor(Number(room.width ?? 1) / 2);
  const halfDepth = Math.floor(Number(room.depth ?? 1) / 2);
  const elevation = Number(room.plannedBaseElevation ?? room.baseElevation ?? 0);
  return [
    { side: 'east', x: room.x + halfWidth, z: room.z, facingX: 1, facingZ: 0 },
    { side: 'west', x: room.x - halfWidth, z: room.z, facingX: -1, facingZ: 0 },
    { side: 'south', x: room.x, z: room.z + halfDepth, facingX: 0, facingZ: 1 },
    { side: 'north', x: room.x, z: room.z - halfDepth, facingX: 0, facingZ: -1 },
  ].map((candidate) => {
    const id = `${INDUSTRIAL_EXTENSION_REGION_ID}:socket:${room.id}:${candidate.side}`;
    return {
      id,
      nodeId: room.id,
      roomId: room.id,
      level: 0,
      elevation,
      position: {
        x: candidate.x * tileSize,
        y: elevation,
        z: candidate.z * tileSize,
      },
      facing: {
        x: candidate.facingX,
        y: 0,
        z: candidate.facingZ,
      },
      widthMeters: Number((tileSize * 3).toFixed(6)),
      heightMeters: 3.6,
      // V3's hallway cluster reserves a worst-case thirteen-segment slope,
      // two flat endpoint buffers, and a full-size terminal beyond it. Older
      // profiles use only a subset of this renderer-free clearance grant.
      availableDepthMeters: tileSize * 48,
      connectorFamily: 'service-gallery',
      connectorFamilies: ['service-gallery'],
      landingWidthTiles: 3,
      clearanceHeightMeters: 3.6,
      ...candidate,
    };
  });
}

function occupiedRoomWallSides(connectionPlans) {
  const occupiedByRoomId = new Map();
  const occupy = (roomId, socket) => {
    if (roomId == null) return;
    const wallSide = wallSideForFacing(socket);
    if (!wallSide) return;
    const key = String(roomId);
    if (!occupiedByRoomId.has(key)) occupiedByRoomId.set(key, new Set());
    occupiedByRoomId.get(key).add(wallSide);
  };
  for (const plan of connectionPlans) {
    if (Number(plan?.level ?? 0) !== 0) continue;
    occupy(plan.fromRoomId, plan.fromSocket);
    occupy(plan.toRoomId, plan.toSocket);
  }
  return occupiedByRoomId;
}

function exactRoomWallApertureSocket(socket, tileSize, themeBinding) {
  const progressionBandId = progressionBandForRoom(socket.roomId);
  return {
    ...socket,
    position: {
      x: Number(socket.position.x) + Number(socket.facing.x) * tileSize * 0.5,
      y: Number(socket.position.y),
      z: Number(socket.position.z) + Number(socket.facing.z) * tileSize * 0.5,
    },
    wallSide: socket.side,
    routeNetworkSocketKind: 'parent-room-wall',
    progressionBandId,
    accessDomainId: accessDomainId(progressionBandId),
    coordinateSpace: 'parent-plan',
    themeBinding,
  };
}

function rectangleFromBounds(id, minX, maxX, minZ, maxZ, purpose) {
  return {
    id,
    center: { x: (minX + maxX) * 0.5, z: (minZ + maxZ) * 0.5 },
    minX,
    maxX,
    minZ,
    maxZ,
    purpose,
  };
}

function squareReservation(id, center, halfSpan, purpose) {
  return rectangleFromBounds(
    id,
    Number(center.x) - halfSpan,
    Number(center.x) + halfSpan,
    Number(center.z) - halfSpan,
    Number(center.z) + halfSpan,
    purpose,
  );
}

function corridorReservation(id, from, to, halfWidth, purpose) {
  const runsAlongX = Math.abs(Number(to.x) - Number(from.x))
    >= Math.abs(Number(to.z) - Number(from.z));
  return rectangleFromBounds(
    id,
    Math.min(Number(from.x), Number(to.x)) - (runsAlongX ? 0 : halfWidth),
    Math.max(Number(from.x), Number(to.x)) + (runsAlongX ? 0 : halfWidth),
    Math.min(Number(from.z), Number(to.z)) - (runsAlongX ? halfWidth : 0),
    Math.max(Number(from.z), Number(to.z)) + (runsAlongX ? halfWidth : 0),
    purpose,
  );
}

function orthogonalPathBetween(first, second, xFirst) {
  const elbow = xFirst
    ? { x: Number(second.x), z: Number(first.z) }
    : { x: Number(first.x), z: Number(second.z) };
  const points = [first, elbow, second].map(({ x, z }) => ({ x: Number(x), z: Number(z) }));
  return points.filter((point, index) => index === 0
    || Math.abs(point.x - points[index - 1].x) > 1e-6
    || Math.abs(point.z - points[index - 1].z) > 1e-6);
}

function sampleOrthogonalPath(path, fraction) {
  const lengths = path.slice(1).map((point, index) => (
    Math.abs(Number(point.x) - Number(path[index].x))
      + Math.abs(Number(point.z) - Number(path[index].z))
  ));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 1e-6) return { ...path[0] };
  let remaining = total * fraction;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    if (remaining > length && index < lengths.length - 1) {
      remaining -= length;
      continue;
    }
    const start = path[index];
    const end = path[index + 1];
    const ratio = length <= 1e-6 ? 0 : Math.min(1, remaining / length);
    return {
      x: Number(start.x) + (Number(end.x) - Number(start.x)) * ratio,
      z: Number(start.z) + (Number(end.z) - Number(start.z)) * ratio,
    };
  }
  return { ...path.at(-1) };
}

function createMicroProgressionReservation({
  firstSocket,
  secondSocket,
  tileSize,
  obstacles,
  xFirst,
}) {
  const flatApproachMeters = tileSize * 2;
  const roomHalfSpan = ROUTE_NETWORK_PLANNING_MODULE_SPAN_METERS * 0.5 + tileSize;
  const roomCenterOffset = flatApproachMeters
    + ROUTE_NETWORK_PLANNING_MODULE_SPAN_METERS * 0.5;
  const outerCenter = (socket) => ({
    x: Number(socket.position.x) + Number(socket.facing.x) * roomCenterOffset,
    z: Number(socket.position.z) + Number(socket.facing.z) * roomCenterOffset,
  });
  const firstCenter = outerCenter(firstSocket);
  const secondCenter = outerCenter(secondSocket);
  const path = orthogonalPathBetween(firstCenter, secondCenter, xFirst);
  const pathLength = path.slice(1).reduce((sum, point, index) => (
    sum + Math.abs(point.x - path[index].x) + Math.abs(point.z - path[index].z)
  ), 0);
  // Three substantive modules need two connector-separated intervals. Reject
  // a pair whose nominal perimeter cannot physically distinguish them.
  if (pathLength < roomHalfSpan * 4 - 1e-6) return null;
  const roomCenters = [0, 0.5, 1].map((fraction) => sampleOrthogonalPath(path, fraction));
  const roomRectangles = roomCenters.map((center, index) => squareReservation(
    `micro-progression-room:${index}`,
    center,
    roomHalfSpan,
    'industrial-supplement-micro-progression-room-reservation',
  ));
  for (let first = 0; first < roomRectangles.length; first += 1) {
    for (let second = first + 1; second < roomRectangles.length; second += 1) {
      if (rectangleIntersectionArea(roomRectangles[first], roomRectangles[second]) > 1e-6) {
        return null;
      }
    }
  }
  const approachStart = (socket) => ({
    x: Number(socket.position.x) + Number(socket.facing.x) * tileSize,
    z: Number(socket.position.z) + Number(socket.facing.z) * tileSize,
  });
  const routeRectangles = [
    corridorReservation(
      'micro-progression-route:first-approach',
      approachStart(firstSocket),
      firstCenter,
      tileSize * 1.5,
      'industrial-supplement-micro-progression-route-reservation',
    ),
    ...path.slice(1).map((point, index) => corridorReservation(
      `micro-progression-route:spine:${index}`,
      path[index],
      point,
      tileSize * 1.5,
      'industrial-supplement-micro-progression-route-reservation',
    )),
    corridorReservation(
      'micro-progression-route:second-approach',
      approachStart(secondSocket),
      secondCenter,
      tileSize * 1.5,
      'industrial-supplement-micro-progression-route-reservation',
    ),
  ];
  const reservations = [...roomRectangles, ...routeRectangles];
  if (reservations.some((reservation) => obstacles.some((obstacle) => (
    rectangleIntersectionArea(reservation, obstacle) > 1e-6
  )))) return null;
  return { path, pathLength, roomCenters, reservations };
}

function createSameBandMicroProgressionGrant({
  rooms,
  connectionPlans,
  tileSize,
  themeBinding,
  reservedRectangles,
  reservedSocketIds,
}) {
  const forbiddenRoomIds = new Set(['bossRoom', 'shrineRoom']);
  const occupiedSides = occupiedRoomWallSides(connectionPlans);
  const candidates = rooms
    .filter((room) => !forbiddenRoomIds.has(String(room.id)))
    .flatMap((room) => roomSocketCandidates(room, tileSize)
      .filter((socket) => !occupiedSides.get(String(room.id))?.has(socket.side))
      .map((socket) => exactRoomWallApertureSocket(socket, tileSize, themeBinding)))
    .filter((socket) => !reservedSocketIds.has(String(socket.id)))
    .sort((first, second) => (
      Number(first.progressionBandId) - Number(second.progressionBandId)
        || String(first.roomId).localeCompare(String(second.roomId))
        || String(first.wallSide).localeCompare(String(second.wallSide))
    ));
  const authoredRoomObstacles = rooms.map((room) => roomPlanningRectangle(room, tileSize));
  const authoredGalleryObstacles = connectionPlans.flatMap((plan) => (
    galleryPlanningRectangles(plan, tileSize)
  ));
  const obstacles = [
    ...authoredRoomObstacles,
    ...authoredGalleryObstacles,
    ...reservedRectangles,
  ];
  const feasiblePairs = [];
  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const firstSocket = candidates[firstIndex];
      const secondSocket = candidates[secondIndex];
      if (Number(firstSocket.progressionBandId) !== Number(secondSocket.progressionBandId)
        || String(firstSocket.accessDomainId) !== String(secondSocket.accessDomainId)) continue;
      for (const xFirst of [true, false]) {
        const reservation = createMicroProgressionReservation({
          firstSocket,
          secondSocket,
          tileSize,
          obstacles,
          xFirst,
        });
        if (!reservation) continue;
        feasiblePairs.push({
          firstSocket,
          secondSocket,
          reservation,
          distinctRoomPenalty: firstSocket.roomId === secondSocket.roomId ? 1 : 0,
          xFirst,
        });
      }
    }
  }
  feasiblePairs.sort((first, second) => (
    first.distinctRoomPenalty - second.distinctRoomPenalty
      || first.reservation.pathLength - second.reservation.pathLength
      || String(first.firstSocket.id).localeCompare(String(second.firstSocket.id))
      || String(first.secondSocket.id).localeCompare(String(second.secondSocket.id))
      || Number(first.xFirst) - Number(second.xFirst)
  ));
  const selected = feasiblePairs[0];
  if (!selected) return null;
  const endpointSockets = [selected.firstSocket, selected.secondSocket];
  const progressionBandId = Number(endpointSockets[0].progressionBandId);
  return {
    schema: ROUTE_NETWORK_GRANT_SCHEMA,
    id: `${INDUSTRIAL_EXTENSION_REGION_ID}:route-network-grant:same-band-micro-progression`,
    required: false,
    kind: 'same-band-micro-progression',
    endpointSockets,
    progressionBandId,
    accessDomainId: accessDomainId(progressionBandId),
    crossedBoundaryIds: [],
    requiredCredentialIds: [],
    sourceGate: null,
    protectedVolumes: [],
    socketLandingOverlapGrants: endpointSockets.map((socket) => (
      createSocketLandingOverlapGrant(socket, tileSize, ':same-band-micro-progression')
    )),
    mustPreserveBeatIds: [...new Set(endpointSockets.map(({ roomId }) => String(roomId)))],
    minimumModules: V4_MINIMUM_SUBSTANTIVE_MODULES_PER_NETWORK,
    maximumModules: V4_MAXIMUM_SUBSTANTIVE_MODULES_PER_NETWORK,
    requiredSemanticRoomRoles: ['challenge', 'elevation-or-mechanism', 'reward'],
    localProgressionArc: ['enter', 'challenge', 'elevation-or-mechanism', 'reward', 'reconnect'],
    requiredCycleRankDelta: 1,
    planningReservationRectangles: selected.reservation.reservations,
    planningRouteReservationRectangles: selected.reservation.reservations.filter(({ purpose }) => (
      purpose === 'industrial-supplement-micro-progression-route-reservation'
    )),
    planningRoomReservationRectangles: selected.reservation.reservations.filter(({ purpose }) => (
      purpose === 'industrial-supplement-micro-progression-room-reservation'
    )),
  };
}

function createCrossBandShortcutGrant({
  rooms,
  connectionPlans,
  tileSize,
  themeBinding,
  reservedRectangles,
  reservedSocketIds,
}) {
  const forbiddenRoomIds = new Set(['bossRoom', 'shrineRoom']);
  const forbiddenBandIds = new Set([3, 4]);
  const occupiedSides = occupiedRoomWallSides(connectionPlans);
  const candidates = rooms
    .filter((room) => !forbiddenRoomIds.has(String(room.id)))
    .flatMap((room) => roomSocketCandidates(room, tileSize)
      .filter((socket) => !occupiedSides.get(String(room.id))?.has(socket.side))
      .map((socket) => exactRoomWallApertureSocket(socket, tileSize, themeBinding)))
    .filter((socket) => !reservedSocketIds.has(String(socket.id)))
    .filter((socket) => !forbiddenBandIds.has(Number(socket.progressionBandId)))
    .sort((first, second) => (
      Number(first.progressionBandId) - Number(second.progressionBandId)
        || String(first.roomId).localeCompare(String(second.roomId))
        || String(first.wallSide).localeCompare(String(second.wallSide))
    ));
  const obstacles = [
    ...rooms.map((room) => roomPlanningRectangle(room, tileSize)),
    ...connectionPlans.flatMap((plan) => galleryPlanningRectangles(plan, tileSize)),
    ...reservedRectangles,
  ];
  const feasiblePairs = [];
  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const firstSocket = candidates[firstIndex];
      const secondSocket = candidates[secondIndex];
      const firstBand = Number(firstSocket.progressionBandId);
      const secondBand = Number(secondSocket.progressionBandId);
      if (Math.abs(firstBand - secondBand) !== 1) continue;
      const shallowSocket = firstBand < secondBand ? firstSocket : secondSocket;
      const deepSocket = shallowSocket === firstSocket ? secondSocket : firstSocket;
      const boundary = PROGRESSION_BANDS.find(({ bandId }) => (
        Number(bandId) === Number(shallowSocket.progressionBandId)
      ));
      if (!boundary?.exitDoorId
        || boundary.exitDoorId === 'Door_Shrine'
        || !boundary.requiredKeycardIdForExit) continue;
      for (const xFirst of [true, false]) {
        const reservation = createMicroProgressionReservation({
          firstSocket: shallowSocket,
          secondSocket: deepSocket,
          tileSize,
          obstacles,
          xFirst,
        });
        if (!reservation) continue;
        feasiblePairs.push({
          shallowSocket,
          deepSocket,
          boundary,
          reservation,
          xFirst,
        });
      }
    }
  }
  feasiblePairs.sort((first, second) => (
    Number(first.shallowSocket.progressionBandId)
      - Number(second.shallowSocket.progressionBandId)
      || first.reservation.pathLength - second.reservation.pathLength
      || String(first.shallowSocket.id).localeCompare(String(second.shallowSocket.id))
      || String(first.deepSocket.id).localeCompare(String(second.deepSocket.id))
      || Number(first.xFirst) - Number(second.xFirst)
  ));
  const selected = feasiblePairs[0];
  if (!selected) return null;

  const grantId = `${INDUSTRIAL_EXTENSION_REGION_ID}:route-network-grant:cross-band-shortcut`;
  const endpointSockets = [selected.shallowSocket, selected.deepSocket];
  const shallowEndpointSocketIds = [String(selected.shallowSocket.id)];
  const crossedBoundaryIds = [String(selected.boundary.exitDoorId)];
  const requiredCredentialIds = [String(selected.boundary.requiredKeycardIdForExit)];
  const gateId = `${grantId}:source-gate:${selected.shallowSocket.id}`;
  const planningReservationRectangles = selected.reservation.reservations.map(
    (rectangle, index) => {
      const roomReservation = String(rectangle.purpose).includes('room-reservation');
      return {
        ...rectangle,
        id: `${grantId}:planning-reservation:${index}`,
        purpose: roomReservation
          ? 'industrial-supplement-cross-band-shortcut-room-reservation'
          : 'industrial-supplement-cross-band-shortcut-route-reservation',
      };
    },
  );
  const deepProgressionBandId = Number(selected.deepSocket.progressionBandId);
  return {
    schema: ROUTE_NETWORK_GRANT_SCHEMA,
    id: grantId,
    required: false,
    kind: 'cross-band-shortcut',
    endpointSockets,
    shallowEndpointSocketIds,
    shallowProgressionBandId: Number(selected.shallowSocket.progressionBandId),
    deepProgressionBandId,
    progressionBandId: deepProgressionBandId,
    accessDomainId: accessDomainId(deepProgressionBandId),
    crossedBoundaryIds,
    requiredCredentialIds,
    sourceGate: {
      gateId,
      gatePlacementSide: 'source',
      sourceGateSocketId: shallowEndpointSocketIds[0],
      shallowEndpointSocketIds,
      crossedBoundaryIds,
      requiredCredentialIds,
      requiredKeycardId: requiredCredentialIds[0],
      encounterRequirementId: null,
      supplementalIdentity: true,
    },
    protectedVolumes: [],
    socketLandingOverlapGrants: endpointSockets.map((socket) => (
      createSocketLandingOverlapGrant(socket, tileSize, ':cross-band-shortcut')
    )),
    mustPreserveBeatIds: [...new Set([
      ...endpointSockets.map(({ roomId }) => String(roomId)),
      ...crossedBoundaryIds,
      ...requiredCredentialIds,
    ])],
    minimumModules: V4_MINIMUM_SUBSTANTIVE_MODULES_PER_NETWORK,
    maximumModules: V4_MAXIMUM_SUBSTANTIVE_MODULES_PER_NETWORK,
    requiredSemanticRoomRoles: ['challenge', 'elevation-or-mechanism', 'reward'],
    localProgressionArc: ['enter', 'challenge', 'elevation-or-mechanism', 'reward', 'reconnect'],
    requiredCycleRankDelta: 1,
    shortcutActivationSide: 'far-side',
    allowedElevationModes: ['shortcut-lift', 'drop-ladder'],
    planningReservationRectangles,
    planningRouteReservationRectangles: planningReservationRectangles.filter(({ purpose }) => (
      purpose === 'industrial-supplement-cross-band-shortcut-route-reservation'
    )),
    planningRoomReservationRectangles: planningReservationRectangles.filter(({ purpose }) => (
      purpose === 'industrial-supplement-cross-band-shortcut-room-reservation'
    )),
  };
}

function createPyramidLoopGrant({ roomById, connectionPlans, tileSize, themeBinding }) {
  const keycardRoom = roomById.get('keycardRoom');
  if (!keycardRoom) return null;
  const criticalPlans = connectionPlans.filter((plan) => (
    Number(plan.level ?? 0) === 0
      && KEYCARD_CRITICAL_EDGE_IDS.has(logicalConnectionId(plan))
      && (plan.fromRoomId === 'keycardRoom' || plan.toRoomId === 'keycardRoom')
  ));
  const occupiedCriticalWallSides = [...new Set(criticalPlans.map((plan) => {
    const socket = plan.fromRoomId === 'keycardRoom' ? plan.fromSocket : plan.toSocket;
    return wallSideForFacing(socket);
  }).filter(Boolean))];
  if (criticalPlans.length !== 2 || occupiedCriticalWallSides.length !== 2) return null;
  const openedWallSides = CARDINAL_WALL_SIDES.filter((side) => (
    !occupiedCriticalWallSides.includes(side)
  ));
  if (openedWallSides.length !== 2) return null;
  const candidateBySide = new Map(
    roomSocketCandidates(keycardRoom, tileSize).map((socket) => [socket.side, socket]),
  );
  const progressionBandId = progressionBandForRoom('keycardRoom');
  const endpointSockets = openedWallSides.map((side) => ({
    ...candidateBySide.get(side),
    position: {
      x: candidateBySide.get(side).position.x
        + candidateBySide.get(side).facing.x * tileSize * 0.5,
      y: candidateBySide.get(side).position.y,
      z: candidateBySide.get(side).position.z
        + candidateBySide.get(side).facing.z * tileSize * 0.5,
    },
    wallSide: side,
    routeNetworkSocketKind: 'landmark-wall-aperture',
    progressionBandId,
    accessDomainId: accessDomainId(progressionBandId),
    coordinateSpace: 'parent-plan',
    themeBinding,
  }));
  if (endpointSockets.some((socket) => !socket?.id)) return null;
  const elevation = Number(keycardRoom.plannedBaseElevation ?? keycardRoom.baseElevation ?? 0);
  const center = {
    x: Number(keycardRoom.x ?? 0) * tileSize,
    y: elevation,
    z: Number(keycardRoom.z ?? 0) * tileSize,
  };
  const widthMeters = Number(keycardRoom.width ?? 23) * tileSize;
  const depthMeters = Number(keycardRoom.depth ?? 21) * tileSize;
  const protectedVolumes = [
    {
      id: `${INDUSTRIAL_EXTENSION_REGION_ID}:protected:keycard-room-expanded-envelope`,
      ownerId: 'keycardRoom',
      center: { x: center.x, y: elevation + 8.4, z: center.z },
      size: { x: widthMeters + tileSize * 2, y: 16.8, z: depthMeters + tileSize * 2 },
      purpose: 'landmark-room-expanded-exclusion',
      protectedReason: 'pyramid-loop-must-remain-outside-keycard-room',
    },
    {
      id: `${INDUSTRIAL_EXTENSION_REGION_ID}:protected:keycard-pyramid-core`,
      ownerId: 'keycardRoom',
      center: { x: center.x, y: elevation + 4.2, z: center.z },
      size: { x: tileSize * 17, y: 8.4, z: tileSize * 17 },
      purpose: 'keycard-pyramid-and-summit-protected',
      protectedReason: 'preserve-alpha-keycard-landmark-and-guard',
    },
  ];
  return {
    schema: ROUTE_NETWORK_GRANT_SCHEMA,
    id: `${INDUSTRIAL_EXTENSION_REGION_ID}:route-network-grant:keycard-pyramid-loop`,
    required: true,
    kind: 'landmark-perimeter-loop',
    landmarkRoomId: 'keycardRoom',
    endpointSockets,
    occupiedCriticalWallSides: [...occupiedCriticalWallSides].sort(),
    openedWallSides: [...openedWallSides].sort(),
    progressionBandId,
    accessDomainId: accessDomainId(progressionBandId),
    dominanceRegionId: 'industrial-v1:dominance:post-enemyNestGate:pre-Door_Alpha',
    crossedBoundaryIds: [],
    requiredCredentialIds: [],
    sourceGate: null,
    protectedVolumes,
    socketLandingOverlapGrants: endpointSockets.map((socket) => (
      createSocketLandingOverlapGrant(socket, tileSize, ':keycard-room')
    )),
    mustPreserveBeatIds: [
      'enemyNestGate',
      'keycardGuard',
      'Keycard_Alpha',
      'Door_Alpha',
      'keycardRoom:grandMechanicalPyramid',
    ],
    // The loop combines an active compact junction with curated challenge and
    // reward modules while preserving both exact pyramid apertures.
    minimumModules: V4_MINIMUM_SUBSTANTIVE_MODULES_PER_NETWORK,
    maximumModules: 5,
    requiredCycleRankDelta: 1,
    landmarkBounds: {
      center,
      widthMeters,
      depthMeters,
      boundaryPlaneContract: 'actual-room-wall-plane',
    },
  };
}

function createProgressionSnapshot({ rooms, connectionPlans, tileSize }) {
  const roomRecords = rooms.map((room) => {
    const progressionBandId = progressionBandForRoom(room.id);
    return {
      id: String(room.id),
      progressionBandId,
      accessDomainId: accessDomainId(progressionBandId),
    };
  });
  const connections = connectionPlans
    .filter((plan) => Number(plan.level ?? 0) === 0)
    .map((plan) => {
      const edgeId = logicalConnectionId(plan);
      const progressionBandId = Math.max(
        progressionBandForRoom(plan.fromRoomId),
        progressionBandForRoom(plan.toRoomId),
      );
      const gateId = plan.doorId ?? null;
      const centerline = worldPathFromPlan(plan, tileSize);
      const ordinaryTraversalSpans = createOrdinaryTraversalSpans(centerline);
      const requiredCredentialIds = requiredCredentialIdsForDoor(gateId);
      const requiredStateIds = gateId && requiredCredentialIds.length === 0
        && gateId !== 'enemyNestGate'
        ? [String(plan.fromRoomId)]
        : [];
      return {
        id: String(plan.id ?? edgeId),
        logicalEdgeId: edgeId,
        fromRoomId: String(plan.fromRoomId ?? ''),
        toRoomId: String(plan.toRoomId ?? ''),
        progressionBandId,
        accessDomainId: accessDomainId(progressionBandId),
        gateId,
        gatePlacementSide: gateId ? 'source' : null,
        requiredCredentialIds,
        requiredStateIds,
        encounterRequirementId: gateId === 'enemyNestGate' ? 'enemyNest' : null,
        dominanceBoundary: gateId ? `${edgeId}:gate:${gateId}` : `${edgeId}:ungated`,
        centerline,
        pathLengthMeters: measureWorldPathMeters(centerline),
        ordinaryTraversalSpans: ordinaryTraversalSpans.map((span) => ({
          startDistanceMeters: span.startDistanceMeters,
          endDistanceMeters: span.endDistanceMeters,
          lengthMeters: span.lengthMeters,
          elevation: span.elevation,
        })),
      };
    });
  const supplementalDoorRecords = [...new Map(connectionPlans
    .filter(({ doorId }) => Boolean(doorId))
    .map((plan) => [String(plan.doorId), plan])).entries()]
    .filter(([doorId]) => !PROGRESSION_DOORS.some((door) => door.doorId === doorId))
    .map(([doorId, plan]) => ({
      id: doorId,
      requiredCredentialIds: [],
      requiredStateIds: doorId === 'enemyNestGate' ? [] : [String(plan.fromRoomId)],
      encounterRequirementId: doorId === 'enemyNestGate' ? 'enemyNest' : null,
      progressionTier: Math.max(
        progressionBandForRoom(plan.fromRoomId),
        progressionBandForRoom(plan.toRoomId),
      ),
      leadsToDepthBand: progressionBandForRoom(plan.toRoomId),
      critical: OBJECTIVE_ROUTE_EDGE_IDS.has(logicalConnectionId(plan)),
      shrineBoundary: false,
    }));
  return {
    schema: PROGRESSION_SNAPSHOT_SCHEMA,
    startRoomId: rooms.some(({ id }) => id === 'hubTown')
      ? 'hubTown'
      : rooms.some(({ id }) => id === 'entrance')
        ? 'entrance'
        : String(rooms[0]?.id ?? ''),
    rooms: roomRecords,
    connections,
    bands: PROGRESSION_BANDS.map((band) => ({
      progressionBandId: Number(band.bandId),
      accessDomainId: accessDomainId(band.bandId),
      roomIds: [...band.roomIds],
      entryGateId: band.entryDoorId ?? null,
      exitGateId: band.exitDoorId ?? null,
      requiredCredentialIdForExit: band.requiredKeycardIdForExit ?? null,
    })),
    keycards: PROGRESSION_KEYCARDS.map((keycard) => ({
      id: keycard.keycardId,
      spawnRoomId: keycard.spawnRoomId,
      pairedGateId: keycard.pairedDoorId,
      progressionTier: keycard.progressionTier,
    })).concat([{
      id: 'Shrine_Key',
      spawnRoomId: 'bossRoom',
      pairedGateId: 'Door_Shrine',
      progressionTier: 4,
    }]),
    doors: PROGRESSION_DOORS.map((door) => ({
      id: door.doorId,
      requiredCredentialIds: door.requiredKeycardId ? [door.requiredKeycardId] : [],
      progressionTier: door.progressionTier,
      leadsToDepthBand: door.leadsToDepthBand,
      critical: door.isCriticalPathDoor === true,
      shrineBoundary: door.isShrineDoor === true,
    })).concat(supplementalDoorRecords),
    objectiveRouteIds: connections
      .filter(({ logicalEdgeId }) => OBJECTIVE_ROUTE_EDGE_IDS.has(logicalEdgeId))
      .map(({ logicalEdgeId }) => logicalEdgeId),
    protectedBeatIds: [
      'enemyNestGate', 'keycardGuard', 'Keycard_Alpha', 'Door_Alpha',
      'keycardRoom:grandMechanicalPyramid',
      'Keycard_Beta', 'Door_Beta', 'Keycard_Gamma', 'Door_Gamma',
      'bossRoom', 'Door_Shrine', 'shrineRoom',
    ],
  };
}

function createSpliceEdge(plan, tileSize, themeBinding) {
  const logicalEdgeId = String(
    plan.logicalConnectionId
      ?? `${plan.fromRoomId}_${plan.toRoomId}`,
  );
  const progressionTier = Math.max(
    Number(PROGRESSION_ROOM_BANDS[plan.fromRoomId] ?? 0),
    Number(PROGRESSION_ROOM_BANDS[plan.toRoomId] ?? 0),
  );
  const fromPosition = {
    x: Number(plan.fromSocket?.x ?? plan.fullPath?.[0]?.x ?? 0) * tileSize,
    y: Number(plan.fromSocket?.elevation ?? plan.elevation ?? 0),
    z: Number(plan.fromSocket?.z ?? plan.fullPath?.[0]?.z ?? 0) * tileSize,
  };
  const toPosition = {
    x: Number(plan.toSocket?.x ?? plan.fullPath?.at?.(-1)?.x ?? 0) * tileSize,
    y: Number(plan.toSocket?.elevation ?? plan.elevation ?? 0),
    z: Number(plan.toSocket?.z ?? plan.fullPath?.at?.(-1)?.z ?? 0) * tileSize,
  };
  // `fullPath` is center-to-center and includes both parent-room interiors.
  // Padding only owns the route between the two boundary sockets. Advertising
  // the larger length can fit a room on paper that materializes across the
  // entire exterior corridor, leaving no traversable gallery on either side.
  const usableGridPath = createUsableSpliceGridPath(plan);
  const usablePath = usableGridPath.map((point, index) => ({
    x: Number(point.x ?? 0) * tileSize,
    y: index === 0
      ? fromPosition.y
      : index === usableGridPath.length - 1
        ? toPosition.y
        : Number(plan.elevation ?? 0),
    z: Number(point.z ?? 0) * tileSize,
  }));
  const availableLengthMeters = measureGridPathMeters(usableGridPath, tileSize);
  return {
    id: `${INDUSTRIAL_EXTENSION_REGION_ID}:splice:${logicalEdgeId}`,
    edgeId: logicalEdgeId,
    logicalEdgeId,
    physicalConnectionId: plan.id,
    fromRoomId: plan.fromRoomId,
    toRoomId: plan.toRoomId,
    doorId: plan.doorId ?? null,
    gateId: plan.doorId ?? null,
    gatePlacementSide: plan.doorId ? 'source' : null,
    credentialRequirement: plan.doorId ?? null,
    progressionTier,
    dominanceBoundary: plan.doorId
      ? `${logicalEdgeId}:gate:${plan.doorId}`
      : `${logicalEdgeId}:ungated`,
    connectorFamily: 'service-gallery',
    level: Number(plan.level ?? 0),
    elevation: Number(plan.elevation ?? 0),
    availableLengthMeters,
    measuredPathLengthMeters: availableLengthMeters,
    path: usablePath,
    fullPath: usableGridPath,
    pathContract: 'boundary-socket-to-boundary-socket',
    from: {
      nodeId: plan.fromRoomId,
      socketId: plan.fromSocket?.id ?? `${plan.id}:from`,
      position: fromPosition,
      facing: {
        x: Number(plan.fromSocket?.facingX ?? 0),
        y: 0,
        z: Number(plan.fromSocket?.facingZ ?? 0),
      },
    },
    to: {
      nodeId: plan.toRoomId,
      socketId: plan.toSocket?.id ?? `${plan.id}:to`,
      position: toPosition,
      facing: {
        x: Number(plan.toSocket?.facingX ?? 0),
        y: 0,
        z: Number(plan.toSocket?.facingZ ?? 0),
      },
    },
    sourceThemeBinding: themeBinding,
    destinationThemeBinding: themeBinding,
    fromSocket: plan.fromSocket ? { ...plan.fromSocket } : null,
    toSocket: plan.toSocket ? { ...plan.toSocket } : null,
  };
}

function supportsGenericEdgePadding(plan) {
  if (plan?.supplementSpliceCompatibility?.edgePadding === false
    || plan?.edgePaddingCompatible === false) {
    return false;
  }
  return ![plan?.fromRoomId, plan?.toRoomId]
    .some((roomId) => EDGE_PADDING_INCOMPATIBLE_ROOM_IDS.has(String(roomId)));
}

function createGalleryProtectedVolumes(connectionPlans, tileSize) {
  return connectionPlans.flatMap((plan) => {
    const logicalConnectionId = String(
      plan.logicalConnectionId ?? `${plan.fromRoomId}_${plan.toRoomId}`,
    );
    // Family reservations carry the connector renderer's exact widened X/Z
    // footprint and its traversal/clearance Y interval. Preserve disjoint
    // intervals at the same X/Z coordinate so genuinely separated stacked
    // routes remain possible. Older realized footprints and centerlines lack
    // those intervals and intentionally retain the fail-closed full-height
    // projection used before connector-family reservations were introduced.
    const hasRealizedFootprint = (plan.galleryFootprintTiles ?? []).length > 0;
    const hasReservedFamilyFootprint = (plan.familyReservedFootprintColumns ?? []).length > 0;
    const hasExactHorizontalFootprint = hasRealizedFootprint || hasReservedFamilyFootprint;
    const footprintSource = hasReservedFamilyFootprint
      ? plan.familyReservedFootprintColumns
      : hasRealizedFootprint
        ? plan.galleryFootprintTiles
        : (plan.fullPath ?? []);
    const uniqueFootprint = [...new Map(footprintSource
      .filter((point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.z)))
      .map((point) => {
        const minY = Number(point?.minY);
        const maxY = Number(point?.maxY);
        const hasExactVerticalExtent = hasReservedFamilyFootprint
          && Number.isFinite(minY)
          && Number.isFinite(maxY)
          && maxY > minY;
        const verticalExtent = hasExactVerticalExtent ? { minY, maxY } : null;
        const key = verticalExtent
          ? `${Number(point.x)},${Number(point.z)}@${minY}:${maxY}`
          : `${Number(point.x)},${Number(point.z)}@fail-closed`;
        return [key, { point, verticalExtent }];
      })).values()];
    return uniqueFootprint.map(({ point, verticalExtent }, index) => ({
      id: `industrial:gallery-footprint:${plan.id}:${index}`,
      ownerId: logicalConnectionId,
      physicalConnectionId: String(plan.id ?? logicalConnectionId),
      logicalConnectionId,
      center: {
        x: Number(point.x) * tileSize,
        y: verticalExtent
          ? (verticalExtent.minY + verticalExtent.maxY) * 0.5
          : 0,
        z: Number(point.z) * tileSize,
      },
      size: {
        // Keep this proxy in parity with IndustrialDraftAdapter's projected
        // base-connection camera-clearance column.  The supplement's own
        // occupied and clearance volumes are much wider than this centerline
        // proxy, so any real room/gallery intrusion is still rejected without
        // needlessly consuming three extra lanes on both sides of a route.
        x: tileSize * (hasExactHorizontalFootprint ? 1 : 1.18),
        y: verticalExtent
          ? verticalExtent.maxY - verticalExtent.minY
          : INDUSTRIAL_GALLERY_PROTECTED_COLUMN_HEIGHT_METERS,
        z: tileSize * (hasExactHorizontalFootprint ? 1 : 1.18),
      },
      purpose: 'industrial-authored-gallery-footprint-column',
      protectedReason: verticalExtent
        ? 'industrial-renderer-authored-gallery-reserved-vertical-interval'
        : 'industrial-renderer-authored-gallery-single-owner-xz',
    }));
  });
}

function createRoomPlanningProtectedVolumes(rooms, tileSize) {
  return rooms.map((room) => ({
    id: `industrial:room-footprint:${room.id}`,
    ownerId: String(room.id),
    center: {
      x: Number(room.x ?? 0) * tileSize,
      y: 0,
      z: Number(room.z ?? 0) * tileSize,
    },
    size: {
      x: Number(room.width ?? 1) * tileSize,
      y: INDUSTRIAL_GALLERY_PROTECTED_COLUMN_HEIGHT_METERS,
      z: Number(room.depth ?? 1) * tileSize,
    },
    purpose: 'industrial-authored-room-planning-footprint',
    protectedReason: 'v4-route-network-placement-must-remain-outside-authored-rooms',
  }));
}

/**
 * Builds Industrial V1's opt-in host description from a renderer-free base
 * draft. The returned object owns no Three.js values and grants no progression
 * authority to the supplement preview.
 */
export function createIndustrialExtensionHost({
  basePlanHash,
  baseDraft = null,
  rooms = [],
  connectionPlans = [],
  tileSize = 2.8,
} = {}) {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const themeBinding = createThemeBinding();
  const attachmentSockets = BRANCH_ROOM_IDS
    .map((roomId) => roomById.get(roomId))
    .filter(Boolean)
    .flatMap((room) => roomSocketCandidates(room, tileSize));
  const spliceEdges = connectionPlans
    .filter((plan) => Number(plan.level ?? 0) === 0)
    // Padding is initially limited to a flat service gallery with no authored
    // parallel upper route. This prevents an untouched alternate from becoming
    // a physical bypass around the padded edge.
    .filter((plan) => !plan.connectorVariant
      || plan.connectorVariant.traversalKind === 'walk')
    .filter(supportsGenericEdgePadding)
    .filter((plan) => PADDED_EDGE_IDS.has(String(
      plan.logicalConnectionId ?? `${plan.fromRoomId}_${plan.toRoomId}`,
    )))
    .map((plan) => createSpliceEdge(plan, tileSize, themeBinding));
  const protectedVolumes = createGalleryProtectedVolumes(connectionPlans, tileSize);
  // Planning and final validation must reason over the same physical base
  // volumes.  The older host-side proxy was one tile wide while the base-draft
  // adapter exposes 1.18-tile camera clearances and 1.5-tile endpoint
  // landings.  That small disagreement admitted routes which were guaranteed
  // to fail the authoritative overlap check after the global solve completed.
  // Use the canonical base-draft projection when it is available; retain the
  // renderer-host fallback for isolated/pure host fixtures.
  const authoritativeBaseVolumes = baseDraft
    ? [...new Map(collectBaseDraftVolumes(baseDraft).map((volume) => [
      String(volume.id),
      volume,
    ])).values()]
    : [];
  const routeNetworkPlacementProtectedVolumes = authoritativeBaseVolumes.length > 0
    ? authoritativeBaseVolumes
    : [
      ...protectedVolumes,
      ...createRoomPlanningProtectedVolumes(rooms, tileSize),
    ];
  const progressionSnapshot = createProgressionSnapshot({ rooms, connectionPlans, tileSize });
  const pyramidLoopGrant = createPyramidLoopGrant({
    roomById,
    connectionPlans,
    tileSize,
    themeBinding,
  });
  const coveragePlanByLogicalEdgeId = new Map();
  for (const plan of connectionPlans) {
    const edgeId = logicalConnectionId(plan);
    if (!coveragePlanByLogicalEdgeId.has(edgeId)
      && Number(plan.level ?? 0) === 0
      && OBJECTIVE_ROUTE_EDGE_IDS.has(edgeId)) {
      coveragePlanByLogicalEdgeId.set(edgeId, plan);
    }
  }
  const coverageRouteGrants = [];
  const reservedCoverageRectangles = [];
  for (const plan of coveragePlanByLogicalEdgeId.values()) {
    const grant = createCoverageRouteGrant(plan, tileSize, themeBinding, {
      rooms,
      connectionPlans,
      reservedRectangles: reservedCoverageRectangles,
    });
    if (!grant) continue;
    coverageRouteGrants.push(grant);
    reservedCoverageRectangles.push(
      ...grant.planningReservationRectangles,
      ...(grant.planningRoomReservationRectangles ?? []),
      ...grant.planningDecisionEgressReservationRectangles,
      ...grant.planningRouteReservationRectangles,
    );
  }
  const reservedRouteNetworkSocketIds = new Set([
    ...(pyramidLoopGrant?.endpointSockets ?? []),
    ...coverageRouteGrants.flatMap(({ endpointSockets = [] }) => endpointSockets),
  ].map(({ id }) => String(id)));
  const sameBandMicroProgressionGrant = createSameBandMicroProgressionGrant({
    rooms,
    connectionPlans,
    tileSize,
    themeBinding,
    reservedRectangles: reservedCoverageRectangles,
    reservedSocketIds: reservedRouteNetworkSocketIds,
  });
  const crossBandShortcutGrant = createCrossBandShortcutGrant({
    rooms,
    connectionPlans,
    tileSize,
    themeBinding,
    reservedRectangles: reservedCoverageRectangles,
    reservedSocketIds: reservedRouteNetworkSocketIds,
  });
  const optionalGrantPreference = deterministicOptionalRouteKind(
    basePlanHash ?? baseDraft?.basePlanHash,
  );
  const optionalRouteNetworkGrant = optionalGrantPreference === 'cross-band-shortcut'
    ? crossBandShortcutGrant ?? sameBandMicroProgressionGrant
    : sameBandMicroProgressionGrant ?? crossBandShortcutGrant;
  const routeNetworkGrants = [
    pyramidLoopGrant,
    ...coverageRouteGrants,
    optionalRouteNetworkGrant,
  ].filter(Boolean);

  return {
    schema: HOST_SCHEMA,
    basePlanHash: String(basePlanHash ?? baseDraft?.basePlanHash ?? ''),
    extensionRegions: [{
      id: INDUSTRIAL_EXTENSION_REGION_ID,
      themeBinding,
      attachmentSockets,
      spliceEdges,
      protectedVolumes,
      routeNetworkPlacementProtectedVolumes,
      progressionSnapshot,
      routeNetworkGrants,
      allowedProfileIds: [
        INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
        INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID,
        INDUSTRIAL_SUPPLEMENT_PREVIEW_V3_PROFILE_ID,
        INDUSTRIAL_SUPPLEMENT_PREVIEW_V4_PROFILE_ID,
      ],
      delegatedProgressionBeats: [],
      themeCapabilities: {
        materials: [
          'primaryFloor', 'corridorFloor', 'wall', 'ceiling', 'ramp', 'catwalk',
          'support', 'rail', 'door', 'lockedDoor', 'cap', 'terminal', 'warning',
          'emissiveAccent',
          // Canonical grammar spellings remain renderer-neutral; the adapter
          // maps them onto the parent session's camel-case role identifiers.
          'primary-floor', 'corridor-floor', 'locked-door', 'emissive-accent',
        ],
        assets: [
          'support', 'arch', 'frame', 'prop', 'decal', 'control',
          'lightFixture', 'light-fixture', 'hazard', 'cap',
          'transitionFrame', 'transition-frame',
        ],
        connectors: [
          'service-gallery', 'slope', 'ladder', 'lift', 'track-trap',
          'transitionBay', 'transition-bay',
        ],
        transitions: ['levelTransitionBay', 'level-transition-bay'],
      },
    }],
  };
}

export function createIndustrialRegionThemeBinding() {
  return createThemeBinding();
}
