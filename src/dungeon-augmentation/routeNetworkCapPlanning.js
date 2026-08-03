const DEFAULT_TILE_SIZE_METERS = 2.8;
const DEFAULT_ROOM_HEIGHT_METERS = 8.4;
const DEFAULT_WALL_THICKNESS_METERS = 0.22;
const CAP_THICKNESS_MULTIPLIER = 1.18;
const OVERLAP_TOLERANCE_METERS = 1e-6;

export const ROUTE_NETWORK_CAP_PLANNING_CONSTANTS = Object.freeze({
  defaultTileSizeMeters: DEFAULT_TILE_SIZE_METERS,
  defaultRoomHeightMeters: DEFAULT_ROOM_HEIGHT_METERS,
  defaultWallThicknessMeters: DEFAULT_WALL_THICKNESS_METERS,
  capThicknessMultiplier: CAP_THICKNESS_MULTIPLIER,
  overlapToleranceMeters: OVERLAP_TOLERANCE_METERS,
});

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function point(value = {}) {
  return {
    x: finite(value.x),
    y: finite(value.y ?? value.elevation ?? value.baseElevation),
    z: finite(value.z),
  };
}

function nodeCenter(node) {
  return point(node?.placement?.center ?? node?.position ?? node);
}

function nodeQuarterTurns(node) {
  const placement = node?.placement ?? node ?? {};
  const explicitTurns = placement.rotationQuarterTurns
    ?? placement.quarterTurns
    ?? node?.rotationQuarterTurns;
  if (Number.isFinite(Number(explicitTurns))) {
    return ((Math.round(Number(explicitTurns)) % 4) + 4) % 4;
  }
  const yaw = placement.rotationY ?? placement.yaw;
  if (Number.isFinite(Number(yaw))) {
    // The assembler maps planner-positive quarter turns to negative Three.js
    // yaw, so invert the angle when reconstructing the cardinal footprint.
    return ((Math.round(-Number(yaw) / (Math.PI * 0.5)) % 4) + 4) % 4;
  }
  return 0;
}

function nodeLocalSize(node, tileSizeMeters) {
  const source = node?.placement?.size
    ?? node?.size
    ?? node?.dimensions
    ?? node?.occupiedVolume?.size
    ?? node?.occupiedVolumes?.[0]?.size
    ?? {};
  const grid = node?.coordinateSpace === 'grid'
    || node?.placement?.coordinateSpace === 'grid';
  const horizontal = (meters, tiles, value, fallback) => {
    if (Number.isFinite(Number(meters)) && Number(meters) > 0) return Number(meters);
    if (Number.isFinite(Number(tiles)) && Number(tiles) > 0) {
      return Number(tiles) * tileSizeMeters;
    }
    if (Number.isFinite(Number(value)) && Number(value) > 0) {
      return Number(value) * (grid ? tileSizeMeters : 1);
    }
    return fallback;
  };
  const vertical = (meters, tiles, value, fallback) => {
    if (Number.isFinite(Number(meters)) && Number(meters) > 0) return Number(meters);
    if (Number.isFinite(Number(tiles)) && Number(tiles) > 0) {
      return Number(tiles) * tileSizeMeters;
    }
    if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
    return fallback;
  };
  return {
    x: horizontal(
      node?.widthMeters ?? source.widthMeters,
      node?.widthTiles ?? source.widthTiles,
      source.x ?? source.width ?? node?.width,
      tileSizeMeters * 5,
    ),
    y: vertical(
      node?.heightMeters ?? source.heightMeters,
      node?.heightTiles ?? source.heightTiles,
      source.y ?? source.height ?? node?.height,
      DEFAULT_ROOM_HEIGHT_METERS,
    ),
    z: horizontal(
      node?.depthMeters ?? source.depthMeters,
      node?.depthTiles ?? source.depthTiles,
      source.z ?? source.depth ?? node?.depth,
      tileSizeMeters * 5,
    ),
  };
}

function cardinalFacing(value = {}) {
  const x = finite(value.x);
  const z = finite(value.z);
  if (Math.abs(x) >= Math.abs(z)) {
    return { x: Math.sign(x) || 1, y: 0, z: 0 };
  }
  return { x: 0, y: 0, z: Math.sign(z) || 1 };
}

function socketIsCapped(socket, claimed) {
  if (!socket || claimed === true || socket.segmentId != null) return false;
  const state = String(socket.state ?? socket.status ?? '').toLowerCase();
  const explicitlyConnected = ['connected', 'paired', 'used', 'open'].includes(state)
    || Boolean(socket.connectedTo ?? socket.connectionId);
  if (explicitlyConnected) return false;
  const explicitlyCapped = ['capped', 'unused', 'closed'].includes(state)
    || socket.capped === true;
  // This matches the assembler: an unreferenced socket with no explicit
  // active state receives a cap even when older data omitted `state`.
  return explicitlyCapped || state.length === 0;
}

function claimedSocketIdsForNode(claimedSocketIdsByNodeId, node) {
  if (!claimedSocketIdsByNodeId) return new Set();
  const nodeId = String(node?.id ?? '');
  const claimed = claimedSocketIdsByNodeId instanceof Map
    ? claimedSocketIdsByNodeId.get(nodeId) ?? claimedSocketIdsByNodeId.get(node?.id)
    : claimedSocketIdsByNodeId[nodeId];
  return claimed instanceof Set ? claimed : new Set(claimed ?? []);
}

/**
 * Derives the exact axis-aligned planning volume of the cap emitted by
 * DungeonSupplementAssembler.addRoomWalls for one inactive cardinal socket.
 * The socket transform is intentionally not used as the wall-normal center:
 * blueprint sockets sit on inset boundary cells, while the assembler places
 * caps on the room's outer wall plane.
 */
export function routeNetworkInactiveSocketCapPlanningVolume(
  node,
  socket,
  {
    tileSizeMeters = DEFAULT_TILE_SIZE_METERS,
    claimed = false,
  } = {},
) {
  if (!socketIsCapped(socket, claimed)) return null;
  const resolvedTileSize = positive(tileSizeMeters, DEFAULT_TILE_SIZE_METERS);
  const center = nodeCenter(node);
  const localSize = nodeLocalSize(node, resolvedTileSize);
  const turns = nodeQuarterTurns(node);
  const worldSize = turns % 2 === 0
    ? { x: localSize.x, z: localSize.z }
    : { x: localSize.z, z: localSize.x };
  const facing = cardinalFacing(socket.facing ?? socket.localFacing);
  const socketPosition = point(socket.position ?? socket);
  const widthMeters = positive(
    socket.widthMeters ?? socket.width,
    resolvedTileSize * 3,
  );
  const heightMeters = positive(
    socket.heightMeters ?? socket.height,
    Math.min(4.2, localSize.y - 0.4),
  );
  const wallThicknessMeters = positive(
    node?.wallThicknessMeters,
    DEFAULT_WALL_THICKNESS_METERS,
  );
  const thicknessMeters = wallThicknessMeters * CAP_THICKNESS_MULTIPLIER;
  const normalHalfExtent = Math.abs(facing.x) > 0.5
    ? worldSize.x * 0.5
    : worldSize.z * 0.5;
  const capCenter = {
    x: Math.abs(facing.x) > 0.5
      ? center.x + facing.x * normalHalfExtent
      : socketPosition.x,
    // addRoomWalls anchors every cap to the room base even when an authored
    // socket record carries a raised traversal elevation.
    y: center.y + heightMeters * 0.5,
    z: Math.abs(facing.z) > 0.5
      ? center.z + facing.z * normalHalfExtent
      : socketPosition.z,
  };
  const nodeId = String(node?.id ?? socket.nodeId ?? 'route-network-node');
  const socketId = String(socket.id ?? socket.socketId ?? socket.localSocketId ?? 'socket');
  return {
    id: `${nodeId}:inactive-socket-cap:${socketId}`,
    ownerId: nodeId,
    nodeId,
    socketId,
    localSocketId: socket.localSocketId == null
      ? null
      : String(socket.localSocketId),
    center: capCenter,
    size: {
      x: Math.abs(facing.x) > 0.5 ? thicknessMeters : widthMeters,
      y: heightMeters,
      z: Math.abs(facing.z) > 0.5 ? thicknessMeters : widthMeters,
    },
    facing,
    purpose: 'route-network-inactive-socket-cap-planning-reservation',
    planningOnly: true,
  };
}

export function routeNetworkInactiveSocketCapPlanningVolumes(
  nodes = [],
  {
    tileSizeMeters = DEFAULT_TILE_SIZE_METERS,
    claimedSocketIdsByNodeId = null,
  } = {},
) {
  return [...nodes]
    .sort((first, second) => String(first?.id ?? '').localeCompare(String(second?.id ?? '')))
    .flatMap((node) => {
      const claimedSocketIds = claimedSocketIdsForNode(claimedSocketIdsByNodeId, node);
      return [...(node?.sockets ?? [])]
        .sort((first, second) => String(first?.id ?? '').localeCompare(String(second?.id ?? '')))
        .flatMap((socket) => {
          const claimed = claimedSocketIds.has(String(socket.id ?? ''))
            || claimedSocketIds.has(String(socket.localSocketId ?? ''));
          const volume = routeNetworkInactiveSocketCapPlanningVolume(node, socket, {
            tileSizeMeters,
            claimed,
          });
          return volume ? [volume] : [];
        });
    });
}

function volumesOverlap(first, second) {
  if (!first?.center || !first?.size || !second?.center || !second?.size) return false;
  if (Math.abs(Number(first.center.x) - Number(second.center.x))
    >= (Number(first.size.x) + Number(second.size.x)) * 0.5
      - OVERLAP_TOLERANCE_METERS) return false;
  if (Math.abs(Number(first.center.z) - Number(second.center.z))
    >= (Number(first.size.z) + Number(second.size.z)) * 0.5
      - OVERLAP_TOLERANCE_METERS) return false;
  return Math.abs(Number(first.center.y) - Number(second.center.y))
    < (Number(first.size.y) + Number(second.size.y)) * 0.5
      - OVERLAP_TOLERANCE_METERS;
}

function volumeOwnedByNode(volume, nodeId) {
  const expected = String(nodeId ?? '');
  const ownerId = String(volume?.ownerId ?? '');
  const volumeId = String(volume?.id ?? '');
  return Boolean(expected && (
    ownerId === expected
      || ownerId.startsWith(`${expected}:`)
      || volumeId === expected
      || volumeId.startsWith(`${expected}:`)
  ));
}

function volumeSortKey(volume) {
  return [
    String(volume?.id ?? ''),
    String(volume?.ownerId ?? ''),
    Number(volume?.center?.x ?? 0).toFixed(6),
    Number(volume?.center?.y ?? 0).toFixed(6),
    Number(volume?.center?.z ?? 0).toFixed(6),
    Number(volume?.size?.x ?? 0).toFixed(6),
    Number(volume?.size?.y ?? 0).toFixed(6),
    Number(volume?.size?.z ?? 0).toFixed(6),
  ].join('|');
}

function conflictEvidence(capVolume, obstacleVolume) {
  return {
    nodeId: capVolume.nodeId ?? capVolume.ownerId ?? null,
    socketId: capVolume.socketId ?? null,
    capVolumeId: capVolume.id ?? null,
    capVolume: {
      center: { ...capVolume.center },
      size: { ...capVolume.size },
    },
    obstacleId: obstacleVolume.id ?? null,
    obstacleOwnerId: obstacleVolume.ownerId ?? null,
    obstaclePurpose: obstacleVolume.purpose ?? null,
    obstacleVolume: {
      center: { ...obstacleVolume.center },
      size: { ...obstacleVolume.size },
    },
  };
}

/**
 * Deterministically validates cap reservations against immutable/node/route
 * volumes and against one another. Owning-node volumes are ignored because a
 * cap intentionally closes an aperture in that node's own structural shell.
 */
export function validateRouteNetworkInactiveSocketCapPlanningVolumes(
  capVolumes = [],
  obstacleVolumes = [],
  { ignoreOwningNodeVolumes = true } = {},
) {
  const caps = [...capVolumes].filter(Boolean).sort((first, second) => (
    volumeSortKey(first).localeCompare(volumeSortKey(second))
  ));
  const obstacles = [...obstacleVolumes].filter(Boolean).sort((first, second) => (
    volumeSortKey(first).localeCompare(volumeSortKey(second))
  ));
  const conflicts = [];
  const conflictKeys = new Set();
  const register = (cap, obstacle, key) => {
    if (conflictKeys.has(key)) return;
    conflictKeys.add(key);
    conflicts.push(conflictEvidence(cap, obstacle));
  };
  for (const cap of caps) {
    for (const obstacle of obstacles) {
      if (String(cap.id ?? '') && String(cap.id) === String(obstacle.id ?? '')) continue;
      if (ignoreOwningNodeVolumes && volumeOwnedByNode(obstacle, cap.nodeId ?? cap.ownerId)) {
        continue;
      }
      if (!volumesOverlap(cap, obstacle)) continue;
      register(cap, obstacle, `${volumeSortKey(cap)}>${volumeSortKey(obstacle)}`);
    }
  }
  for (let firstIndex = 0; firstIndex < caps.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < caps.length; secondIndex += 1) {
      const first = caps[firstIndex];
      const second = caps[secondIndex];
      if (!volumesOverlap(first, second)) continue;
      register(first, second, `cap-pair:${volumeSortKey(first)}>${volumeSortKey(second)}`);
    }
  }
  return {
    accepted: conflicts.length === 0,
    code: conflicts.length > 0
      ? 'route-network-inactive-socket-cap-overlap'
      : null,
    capVolumeCount: caps.length,
    obstacleVolumeCount: obstacles.length,
    conflictCount: conflicts.length,
    conflicts,
  };
}
