import { expect } from '@playwright/test';

const PLAYER_RADIUS = 0.42;
const PLAYER_BODY_HEIGHT = 2.85;
const PLAYER_FOOT_CLEARANCE = 0.08;
const MAXIMUM_GROUNDED_RISE = 0.67;
const MAXIMUM_DIRECTED_JUMP_RISE = 1.617;
const MAXIMUM_LEDGE_CLIMB_RISE = 3.564;
const MAXIMUM_SAFE_DROP = 6;
const FLOOR_SAMPLE_SPACING = 0.18;
const MEGA_BUSTER_MAXIMUM_RANGE = 6.9;
// Leave a small tolerance inside the authored 6.9 m maximum; the public
// driver should fire from a clear catwalk rather than forcing an unnecessary
// close approach through railings and service gaps.
const MEGA_BUSTER_APPROACH_RADIUS = 6.15;
const MEGA_BUSTER_REPOSITION_DISTANCE = 6.3;
const MEGA_BUSTER_RETREAT_DISTANCE = 2.35;
const MEGA_BUSTER_BURST_MILLISECONDS = 5_250;
const BEAM_BLADE_APPROACH_RADIUS = 1.65;
const BEAM_BLADE_REPOSITION_DISTANCE = 2.35;
const BEAM_BLADE_RETREAT_DISTANCE = 0.45;
const COMBAT_DAMAGE_WATCHDOG_MILLISECONDS = 6_500;
// Tank steering advances in frame-sized angular increments. Use one shared
// dead zone for explicit facing and locomotion so a heading accepted by the
// walker cannot make orientToward oscillate forever just outside 0.11 radians.
// A single tank-turn frame can be roughly 0.18 radians under a loaded WebGL
// browser. A narrower dead zone makes short A/D pulses bounce forever across
// the desired heading without ever permitting W movement.
const ROUTE_FACING_TOLERANCE = 0.22;
const ROUTE_WALK_FACING_TOLERANCE = 0.42;
const CARDINAL_NEIGHBORS = Object.freeze([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]);

/**
 * Decide whether combat must seek a new authored firing lane. A retained lock
 * on an aerial target already inside the real three-dimensional Buster range
 * is immediately attackable even after the damage watchdog expires; routing
 * again at that point only walks away from a valid shot. Grounded stalled
 * targets retain the existing Beam Blade/reposition policy.
 */
export const shouldRepositionPublicCombatTarget = ({
  hasLockedEnemy,
  movementLocked,
  targetDistance,
  targetHeight,
  useBeamBlade,
  hasDamageStalled,
  forceBeamBladeFallback,
}) => {
  const retainedAerialBusterTarget = hasLockedEnemy
    && movementLocked
    && Math.abs(targetHeight) > 1.8
    && Math.hypot(targetDistance, targetHeight) <= MEGA_BUSTER_MAXIMUM_RANGE;
  const preferredDistance = useBeamBlade
    ? BEAM_BLADE_REPOSITION_DISTANCE
    : MEGA_BUSTER_REPOSITION_DISTANCE;
  return !hasLockedEnemy
    || !movementLocked
    || (targetDistance > preferredDistance && !retainedAerialBusterTarget)
    || (hasDamageStalled
      && !forceBeamBladeFallback
      && !retainedAerialBusterTarget);
};

const distance2d = (left, right) => Math.hypot(left.x - right.x, left.z - right.z);

/**
 * The journey can inspect this detached public contract, but every mutation is
 * still performed through keyboard and mouse input. It never reads or retains
 * a live THREE object.
 */
export const readPublicV1JourneyState = (page, { includeGeometry = true } = {}) => (
  page.evaluate((options) => {
    const getter = window.game?.getPublicDungeonJourneyDiagnostics;
    if (typeof getter !== 'function') {
      throw new Error('Game did not publish V1 journey diagnostics.');
    }
    const state = getter.call(window.game, options);
    if (!state) throw new Error('The public V1 journey requires an attached dungeon.');
    return state;
  }, { includeGeometry })
);

/**
 * Read only the detached player/lock state needed for real-input locomotion.
 * Large combined rooms can contain thousands of floor and collision records;
 * steering must not rebuild those arrays every animation pulse.
 */
export const readPublicDungeonPlayerJourneyState = (page) => (
  page.evaluate(() => {
    const getter = window.game?.getPublicDungeonPlayerJourneyDiagnostics;
    const legacyGetter = window.game?.getPublicDungeonJourneyDiagnostics;
    const state = typeof getter === 'function'
      ? getter.call(window.game)
      : typeof legacyGetter === 'function'
        ? legacyGetter.call(window.game, { includeGeometry: false })
        : null;
    if (!state) throw new Error('The public player journey requires an attached dungeon.');
    return state;
  })
);

const zoneContains = (point, zone, radius = PLAYER_RADIUS) => {
  if (!zone?.position || zone.active === false) return false;
  const dx = point.x - zone.position.x;
  const dz = point.z - zone.position.z;
  const cos = Math.cos(zone.rotationY ?? 0);
  const sin = Math.sin(zone.rotationY ?? 0);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  if (Math.abs(localX) > zone.halfWidth + radius
    || Math.abs(localZ) > zone.halfDepth + radius) return false;
  if (zone.verticalHalfHeight == null) return true;
  const playerBottom = point.y + PLAYER_FOOT_CLEARANCE;
  const playerTop = point.y + PLAYER_BODY_HEIGHT;
  const zoneBottom = zone.position.y - zone.verticalHalfHeight;
  const zoneTop = zone.position.y + zone.verticalHalfHeight;
  return zoneTop > playerBottom && zoneBottom < playerTop;
};

const doorContains = (point, door, radius = PLAYER_RADIUS) => {
  if (!door.closed) return false;
  const position = door.graphBlockingPosition ?? door.position;
  if (!position) return false;
  return Math.abs(point.x - position.x) <= door.collisionHalfWidth + radius
    && Math.abs(point.z - position.z) <= door.collisionHalfDepth + radius
    && point.y >= position.y - 0.2
    && point.y <= position.y + door.collisionHeight + 0.2;
};

const platformContains = (point, platform, radius = PLAYER_RADIUS) => (
  platform?.center
  && platform.blocksBelow
  && Math.abs(point.x - platform.center.x) <= platform.halfWidth + radius
  && Math.abs(point.z - platform.center.z) <= platform.halfDepth + radius
  && point.y < platform.topY - 0.05
);

const connectionElevation = (tile, dx, dz) => {
  if (!(tile.surfaceRole === 'ramp' || tile.surface === 'industrialRamp')
    || tile.rampStartElevation == null
    || tile.rampEndElevation == null) return tile.elevation;
  const along = dx * Math.sign(tile.rampDirectionX)
    + dz * Math.sign(tile.rampDirectionZ);
  if (along > 0) return tile.rampEndElevation;
  if (along < 0) return tile.rampStartElevation;
  return tile.elevation;
};

const resolveTraversalAction = (from, to) => {
  const dx = Math.sign(to.x - from.x);
  const dz = Math.sign(to.z - from.z);
  const fromElevation = connectionElevation(from, dx, dz);
  const toElevation = connectionElevation(to, -dx, -dz);
  const rise = toElevation - fromElevation;
  const groundedAllowance = Math.max(
    MAXIMUM_GROUNDED_RISE,
    Number(from.groundedStepTransitionHeight) || 0,
    Number(to.groundedStepTransitionHeight) || 0,
  );
  const connectionId = from.connectionId ?? to.connectionId ?? null;

  if (Math.abs(rise) <= groundedAllowance) {
    const rampRouteId = from.rampRouteId ?? to.rampRouteId ?? null;
    return {
      action: from.surfaceRole === 'ramp'
        || to.surfaceRole === 'ramp'
        || from.surface === 'industrialRamp'
        || to.surface === 'industrialRamp'
        ? 'ramp'
        : 'walk',
      rise,
      cost: 1 + Math.abs(rise) * 0.18,
      connectionId,
      rampRouteId,
    };
  }

  if (rise > 0 && rise <= MAXIMUM_DIRECTED_JUMP_RISE) {
    return { action: 'jump', rise, cost: 2.4 + rise, connectionId };
  }

  if (rise > 0
    && rise <= MAXIMUM_LEDGE_CLIMB_RISE
    && (to.isPlatformingSurface || to.isLedgeSurface)) {
    return { action: 'ledge_climb', rise, cost: 4.2 + rise, connectionId };
  }

  if (rise < 0
    && Math.abs(rise) <= MAXIMUM_SAFE_DROP
    && to.allowsGroundedDropLanding === true) {
    return { action: 'drop', rise, cost: 2.8 + Math.abs(rise) * 0.35, connectionId };
  }

  return null;
};

const isAcceptedLandingPlatform = (point, platform, target) => (
  Math.abs(platform.topY - target.point.y) <= 0.16
  && Math.abs(target.point.x - platform.center.x) <= platform.halfWidth + PLAYER_RADIUS
  && Math.abs(target.point.z - platform.center.z) <= platform.halfDepth + PLAYER_RADIUS
  && distance2d(point, target.point) <= target.stateTileSize * 0.7
);

const edgeIsClear = (from, to, state, traversal) => {
  const distance = distance2d(from.point, to.point);
  const samples = Math.max(2, Math.ceil(distance / FLOOR_SAMPLE_SPACING));
  const airborne = traversal.action === 'jump' || traversal.action === 'ledge_climb';
  const arcHeight = traversal.action === 'ledge_climb' ? 1.25 : airborne ? 1.05 : 0;
  for (let index = 1; index < samples; index += 1) {
    const progress = index / samples;
    const point = {
      x: from.point.x + (to.point.x - from.point.x) * progress,
      y: from.point.y
        + (to.point.y - from.point.y) * progress
        + Math.sin(Math.PI * progress) * arcHeight,
      z: from.point.z + (to.point.z - from.point.z) * progress,
    };
    if (state.solidZones.some((zone) => zoneContains(point, zone))) return false;
    if (state.doors.some((door) => doorContains(point, door))) return false;
    if (state.platforms.some((platform) => (
      platformContains(point, platform)
      && !isAcceptedLandingPlatform(point, platform, to)
    ))) return false;
  }
  return true;
};

const buildFloorGraph = (state) => {
  const nodes = [];
  const columns = new Map();
  const nodesByFloorKey = new Map();
  for (const tile of state.floorTiles) {
    // Mandatory public journeys must never silently substitute damaging magma
    // for an authored jump, bridge, or dry route. Dedicated hazard tests can
    // drive into magma explicitly with keyboard input instead.
    if (tile.surface === 'deepMagma' || tile.surfaceRole === 'hazard-floor') continue;
    const point = {
      x: tile.x * state.tileSize,
      y: tile.elevation,
      z: tile.z * state.tileSize,
    };
    if (state.solidZones.some((zone) => zoneContains(point, zone))) continue;
    if (state.doors.some((door) => doorContains(point, door))) continue;
    if (state.platforms.some((platform) => platformContains(point, platform))) continue;
    const node = {
      ...tile,
      point,
      nodeIndex: nodes.length,
      stateTileSize: state.tileSize,
    };
    nodes.push(node);
    const key = `${tile.x},${tile.z}`;
    const column = columns.get(key) ?? [];
    column.push(node);
    columns.set(key, column);
    if (tile.floorKey) nodesByFloorKey.set(tile.floorKey, node);
  }
  return { nodes, columns, nodesByFloorKey };
};

const nearestPhysicallyReachableNode = (nodes, point, state, maximumDistance) => {
  const candidates = nodes
    .map((node) => ({
      node,
      score: distance2d(node.point, point)
        + Math.abs(node.point.y - (point.y ?? node.point.y)) * 1.8,
    }))
    .filter(({ node }) => distance2d(node.point, point) <= maximumDistance)
    .sort((left, right) => left.score - right.score);
  const virtualStart = { point };
  for (const { node } of candidates) {
    const distance = distance2d(point, node.point);
    const samples = Math.max(2, Math.ceil(distance / FLOOR_SAMPLE_SPACING));
    let hasContinuousSupport = true;
    for (let index = 0; index <= samples; index += 1) {
      const progress = index / samples;
      const sample = {
        x: point.x + (node.point.x - point.x) * progress,
        y: point.y + (node.point.y - point.y) * progress,
        z: point.z + (node.point.z - point.z) * progress,
      };
      const supportedByTile = state.floorTiles.some((tile) => (
        Math.abs(sample.x - tile.x * state.tileSize) <= state.tileSize * 0.5 + 0.04
        && Math.abs(sample.z - tile.z * state.tileSize) <= state.tileSize * 0.5 + 0.04
        && Math.abs(sample.y - tile.elevation) <= MAXIMUM_GROUNDED_RISE + 0.08
      ));
      const supportedByPlatform = state.platforms.some((platform) => (
        Math.abs(sample.x - platform.center.x) <= platform.halfWidth + 0.04
        && Math.abs(sample.z - platform.center.z) <= platform.halfDepth + 0.04
        && Math.abs(sample.y - platform.topY) <= MAXIMUM_GROUNDED_RISE + 0.08
      ));
      if (!supportedByTile && !supportedByPlatform) {
        hasContinuousSupport = false;
        break;
      }
    }
    if (hasContinuousSupport && edgeIsClear(virtualStart, node, state, { action: 'walk' })) {
      return node;
    }
  }
  // Broad below-platform volumes can conservatively reject a player who is
  // already standing on the adjacent authored catwalk. A same-cell center is
  // safe as a graph origin; unlike the old nearest-node fallback this cannot
  // begin across a missing tile, pedestal, wall, or connector gap.
  const sameCell = candidates.find(({ score }) => score <= state.tileSize * 0.55)?.node;
  if (sameCell) return sameCell;

  // Combat knockback can leave the player standing on the clear edge of an
  // authored machinery deck whose broad below-platform volume masks every
  // nearby tile centre from the conservative support sampler. Permit a short,
  // same-elevation, collision-clear approach to a real floor node. The route
  // executor still has to walk this segment with normal input; this only gives
  // A* an anchor and cannot move the player across a wall, closed door, or a
  // multi-tile gap.
  return candidates.find(({ node }) => (
    distance2d(point, node.point) <= state.tileSize * 1.65
    && Math.abs((point.y ?? node.point.y) - node.point.y)
      <= MAXIMUM_GROUNDED_RISE + 0.08
    && segmentIsClear(point, node.point, state)
  ))?.node ?? null;
};

const pointInsideGoalZone = (point, zone) => (
  zone?.position
  && Math.abs(point.x - zone.position.x) <= Math.max(0.2, zone.halfWidth - PLAYER_RADIUS)
  && Math.abs(point.z - zone.position.z) <= Math.max(0.2, zone.halfDepth - PLAYER_RADIUS)
  && Math.abs(point.y - zone.position.y) <= (zone.verticalHalfHeight ?? 4) + 1.2
);

const segmentIsClear = (from, to, state) => {
  const distance = distance2d(from, to);
  const samples = Math.max(2, Math.ceil(distance / FLOOR_SAMPLE_SPACING));
  for (let index = 1; index < samples; index += 1) {
    const progress = index / samples;
    const point = {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + 1.05 + ((to.y ?? from.y) - from.y) * progress,
      z: from.z + (to.z - from.z) * progress,
    };
    if (state.solidZones.some((zone) => zoneContains(point, zone, 0.08))) return false;
    if (state.doors.some((door) => doorContains(point, door, 0.08))) return false;
  }
  return true;
};

const routeHeuristic = (node, target) => (
  distance2d(node.point, target) / Math.max(1, node.stateTileSize)
  + Math.abs(node.point.y - (target.y ?? node.point.y)) * 0.12
);

/**
 * A directed A* graph over cloned authored floors. Unlike the retired helper,
 * this graph represents real upward jumps, declared ledge climbs and bounded
 * drops instead of pretending that the V1 dungeon is entirely walkable.
 */
export const planPublicFloorRoute = (state, target, {
  targetRadius = 1.5,
  targetMinimumRadius = 0,
  maximumTargetVerticalDifference = 1.35,
  goalZone = null,
  requireClearSight = false,
  goalPredicate = null,
} = {}) => {
  if (!state.floorTiles?.length) throw new Error('Floor geometry was omitted from journey state.');
  const graph = buildFloorGraph(state);
  // A nearest tile center can sit on the opposite side of a pedestal, railing,
  // arch foot, or door frame. Only use a start node that the live player can
  // physically reach; otherwise A* would silently begin across that obstacle
  // and the public-input follower would push against it forever.
  const start = nearestPhysicallyReachableNode(
    graph.nodes,
    state.player.position,
    state,
    // Knockback can leave the player at the outside edge of a broad authored
    // platform column, more than one tile centre from the nearest unoccluded
    // floor node. The resolver still requires continuous floor support and a
    // collision-clear segment, so widening this search cannot begin across a
    // wall, gap, closed gate, or platform block.
    state.tileSize * 3.2,
  );
  if (!start) {
    throw new Error(`No public floor node near player ${JSON.stringify(state.player.position)}`);
  }

  const isGoal = (node) => {
    if (goalPredicate && !goalPredicate(node)) return false;
    if (goalZone && !pointInsideGoalZone(node.point, goalZone)) return false;
    const horizontal = distance2d(node.point, target);
    if (!goalZone && (horizontal > targetRadius || horizontal < targetMinimumRadius)) return false;
    if (Number.isFinite(maximumTargetVerticalDifference)
      && Math.abs(node.point.y - (target.y ?? node.point.y)) > maximumTargetVerticalDifference) {
      return false;
    }
    return !requireClearSight || segmentIsClear(node.point, target, state);
  };

  const open = [{ node: start, score: routeHeuristic(start, target) }];
  const cameFrom = new Map();
  const costByNode = new Map([[start.nodeIndex, 0]]);
  const closed = new Set();
  let goal = null;

  while (open.length) {
    open.sort((left, right) => left.score - right.score);
    const current = open.shift().node;
    if (closed.has(current.nodeIndex)) continue;
    if (isGoal(current)) {
      goal = current;
      break;
    }
    closed.add(current.nodeIndex);

    for (const [dx, dz] of CARDINAL_NEIGHBORS) {
      for (const next of graph.columns.get(`${current.x + dx},${current.z + dz}`) ?? []) {
        if (closed.has(next.nodeIndex)) continue;
        const traversal = resolveTraversalAction(current, next);
        if (!traversal || !edgeIsClear(current, next, state, traversal)) continue;
        const nextCost = costByNode.get(current.nodeIndex) + traversal.cost;
        if (nextCost >= (costByNode.get(next.nodeIndex) ?? Infinity)) continue;
        costByNode.set(next.nodeIndex, nextCost);
        cameFrom.set(next.nodeIndex, {
          nodeIndex: current.nodeIndex,
          traversal,
        });
        open.push({
          node: next,
          score: nextCost + routeHeuristic(next, target),
        });
      }
    }

    for (const link of current.traversalLinks ?? []) {
      const next = graph.nodesByFloorKey.get(link.toFloorKey);
      if (!next || closed.has(next.nodeIndex)) continue;
      const rise = next.point.y - current.point.y;
      const traversal = {
        action: link.action,
        rise,
        cost: link.action === 'ladder' ? 8 : 10,
        connectionId: link.connectionId
          ?? current.connectionId
          ?? next.connectionId
          ?? null,
        linkId: link.id,
        targetId: link.targetId,
        explicitMechanism: true,
      };
      const nextCost = costByNode.get(current.nodeIndex) + traversal.cost;
      if (nextCost >= (costByNode.get(next.nodeIndex) ?? Infinity)) continue;
      costByNode.set(next.nodeIndex, nextCost);
      cameFrom.set(next.nodeIndex, {
        nodeIndex: current.nodeIndex,
        traversal,
      });
      open.push({
        node: next,
        score: nextCost + routeHeuristic(next, target),
      });
    }
  }

  if (!goal) {
    throw new Error(`No cloned authored route from ${JSON.stringify(state.player.position)} to ${JSON.stringify(target)}`);
  }

  const reversed = [];
  let cursor = goal.nodeIndex;
  while (cursor !== start.nodeIndex) {
    const node = graph.nodes[cursor];
    const edge = cameFrom.get(cursor);
    if (!edge) throw new Error(`Broken cloned A* predecessor at floor node ${cursor}.`);
    reversed.push({
      point: node.point,
      action: edge.traversal.action,
      rise: edge.traversal.rise,
      connectionId: edge.traversal.connectionId ?? null,
      linkId: edge.traversal.linkId ?? null,
      targetId: edge.traversal.targetId ?? null,
      explicitMechanism: edge.traversal.explicitMechanism === true,
      rampRouteId: edge.traversal.rampRouteId ?? node.rampRouteId ?? null,
      tile: {
        index: node.index,
        roomId: node.roomId,
        surface: node.surface,
        connectionId: node.connectionId ?? null,
        requiredTraversalAction: node.requiredTraversalAction,
        surfaceRole: node.surfaceRole ?? null,
        rampRouteId: edge.traversal.rampRouteId ?? node.rampRouteId ?? null,
        rampSegmentIndex: node.rampSegmentIndex ?? null,
      },
    });
    cursor = edge.nodeIndex;
  }
  reversed.push({
    point: start.point,
    action: 'start',
    rise: 0,
    connectionId: start.connectionId ?? null,
    tile: {
      index: start.index,
      roomId: start.roomId,
      surface: start.surface,
      surfaceRole: start.surfaceRole ?? null,
      rampRouteId: start.rampRouteId ?? null,
      rampSegmentIndex: start.rampSegmentIndex ?? null,
      connectionId: start.connectionId ?? null,
    },
  });
  const route = reversed.reverse();
  const liveStartDistance = distance2d(state.player.position, start.point);
  const liveStartRise = start.point.y - state.player.position.y;
  if (liveStartDistance > 0.35 || Math.abs(liveStartRise) > 0.18) {
    // The graph origin is only a collision-checked reachable floor centre; it
    // is not permission to pretend the live player is already standing there.
    // Keeping both points in the route makes the public-input driver physically
    // walk onto that support before following any subsequent graph edge.
    route[0].action = 'walk';
    route[0].rise = liveStartRise;
    route.unshift({
      point: { ...state.player.position },
      action: 'start',
      rise: 0,
      connectionId: null,
      tile: {
        index: null,
        roomId: null,
        surface: 'live_player_origin',
        connectionId: null,
      },
    });
  }
  return route;
};

const simplifyRoute = (route) => {
  if (route.length <= 2) return route;
  const output = [route[0]];
  for (let index = 1; index < route.length - 1; index += 1) {
    const previous = route[index - 1];
    const current = route[index];
    const next = route[index + 1];
    const previousDirection = [
      Math.sign(current.point.x - previous.point.x),
      Math.sign(current.point.z - previous.point.z),
    ];
    const nextDirection = [
      Math.sign(next.point.x - current.point.x),
      Math.sign(next.point.z - current.point.z),
    ];
    const actionBoundary = current.action !== 'walk' && current.action !== 'ramp';
    const nextActionBoundary = next.action !== 'walk' && next.action !== 'ramp';
    const turn = previousDirection[0] !== nextDirection[0]
      || previousDirection[1] !== nextDirection[1];
    const elevationChange = Math.abs(current.point.y - previous.point.y) > 0.03
      || Math.abs(next.point.y - current.point.y) > 0.03;
    const lastKept = output.at(-1);
    const maximumStraightRun = distance2d(lastKept.point, current.point) >= 7.8;
    if (actionBoundary || nextActionBoundary || turn || elevationChange || maximumStraightRun) {
      output.push(current);
    }
  }
  output.push(route.at(-1));
  return output;
};

const steeringFor = (state, target) => {
  const deltaX = target.x - state.player.position.x;
  const deltaZ = target.z - state.player.position.z;
  const desiredYaw = Math.atan2(deltaX, deltaZ);
  const forward = state.player.movementBasis?.forward ?? { x: 0, z: 1 };
  const right = state.player.movementBasis?.right ?? { x: -1, z: 0 };
  return {
    distance: Math.hypot(deltaX, deltaZ),
    turnError: Math.atan2(
      Math.sin(desiredYaw - state.player.rotationY),
      Math.cos(desiredYaw - state.player.rotationY),
    ),
    forwardDot: deltaX * forward.x + deltaZ * forward.z,
    rightDot: deltaX * right.x + deltaZ * right.z,
    player: state.player.position,
  };
};

const holdKeys = async (page, keys, duration) => {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(duration);
  for (const key of keys) await page.keyboard.up(key);
  return keys;
};

const holdKeysForAnimationFrames = async (page, keys, frameCount = 1) => {
  for (const key of keys) await page.keyboard.down(key);
  try {
    await page.evaluate((count) => new Promise((resolve) => {
      if (typeof requestAnimationFrame !== 'function') {
        resolve();
        return;
      }
      const step = () => {
        count -= 1;
        if (count <= 0) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }), Math.max(1, Math.floor(frameCount)));
  } finally {
    for (const key of keys) await page.keyboard.up(key).catch(() => {});
  }
  return keys;
};

const turnKeyFor = (steering) => (steering.turnError > 0 ? 'KeyA' : 'KeyD');

const releaseKeys = async (page, keys = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space']) => {
  for (const key of keys) await page.keyboard.up(key).catch(() => {});
};

const finishPublicLedgeClimbIfNeeded = async (page, state) => {
  if (!state?.player?.ledgeClinging) return state;
  // V1's lower recovery bays intentionally catch a falling player on a ledge.
  // Holding forward is the ordinary input that advances hangingIdle through
  // the authored hang-to-crouch climb. The journey must finish that physical
  // return before asking the floor graph for a grounded start node.
  if (state.lock?.movementLocked) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(280);
  }
  await holdKeys(page, ['KeyW'], 3_600);
  await page.waitForTimeout(240);
  return readPublicV1JourneyState(page);
};

const orientToward = async (page, target, {
  timeout = 30_000,
  tolerance = ROUTE_FACING_TOLERANCE,
} = {}) => {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    const state = await readPublicDungeonPlayerJourneyState(page);
    last = steeringFor(state, target);
    if (Math.abs(last.turnError) <= tolerance) return last;
    await holdKeys(
      page,
      [turnKeyFor(last)],
      Math.min(650, Math.max(120, Math.abs(last.turnError) * 600)),
    );
  }
  throw new Error(`Could not face public route waypoint: ${JSON.stringify({ target, last })}`);
};

export const walkToWaypoint = async (page, target, {
  stopDistance = 0.72,
  timeout = 8_000,
} = {}) => {
  const started = Date.now();
  let bestDistance = Infinity;
  let bestTurnError = Infinity;
  let lastProgressAt = Date.now();
  let detourCount = 0;
  let detourTurnKey = 'KeyA';
  let stepJumpCount = 0;
  let last = null;
  while (Date.now() - started < timeout) {
    const state = await readPublicDungeonPlayerJourneyState(page);
    if (state.player.ledgeClinging || state.player.jumpState !== 'Grounded') {
      await page.waitForTimeout(220);
      continue;
    }
    last = steeringFor(state, target);
    if (last.distance <= stopDistance) return last;
    if (state.lock?.movementLocked) {
      // Tab lock changes A/D from tank turning to strafing. A route step must
      // explicitly release it and confirm the public state changed before it
      // can use rotation progress as evidence of locomotion.
      await page.keyboard.press('Tab');
      await page.waitForTimeout(280);
      continue;
    }
    if (last.distance + 0.05 < bestDistance) {
      bestDistance = last.distance;
      bestTurnError = Infinity;
      lastProgressAt = Date.now();
    }
    if (Math.abs(last.turnError) > ROUTE_WALK_FACING_TOLERANCE) {
      const angularError = Math.abs(last.turnError);
      if (angularError + 0.02 < bestTurnError) {
        bestTurnError = angularError;
        lastProgressAt = Date.now();
      }
      if (angularError <= 0.65) {
        // One rendered tank-turn frame is approximately 0.135--0.18 rad. A
        // frame-sized correction near the locomotion gate avoids oscillating
        // across a narrow ramp while still guaranteeing a real input frame.
        await holdKeysForAnimationFrames(page, [turnKeyFor(last)], 1);
      } else {
        await holdKeys(
          page,
          [turnKeyFor(last)],
          Math.min(650, Math.max(120, angularError * 600)),
        );
      }
      continue;
    }
    const waypointRise = (target.y ?? state.player.position.y) - state.player.position.y;
    if (Date.now() - lastProgressAt > 2_400
      && waypointRise >= 0.32
      && waypointRise <= MAXIMUM_DIRECTED_JUMP_RISE
      && stepJumpCount < 2) {
      // Some V1 processional-step meshes present a physical lip even though
      // their declared 0.5 m transition is within grounded traversal. Use the
      // player's normal forward jump only after walking demonstrably stalls.
      await orientToward(page, target);
      await page.keyboard.down('KeyW');
      try {
        await page.keyboard.press('Space');
        await page.waitForTimeout(1_180);
      } finally {
        await page.keyboard.up('KeyW').catch(() => {});
      }
      stepJumpCount += 1;
      bestDistance = Infinity;
      bestTurnError = Infinity;
      lastProgressAt = Date.now();
      continue;
    }
    if (Date.now() - lastProgressAt > 2_400
      && Math.abs((target.y ?? state.player.position.y) - state.player.position.y) < 0.65
      && detourCount < 3) {
      // V1's authored pyramid supports and arch feet are not all represented
      // by the high-level route grid. Take one short tank-control dogleg,
      // alternating sides on retries, then reorient to the same verified floor
      // waypoint. This is ordinary walking and remains fully collision bound.
      await holdKeys(page, [detourTurnKey], 220);
      await holdKeys(page, ['KeyW'], 300);
      detourTurnKey = detourTurnKey === 'KeyA' ? 'KeyD' : 'KeyA';
      detourCount += 1;
      bestDistance = Infinity;
      bestTurnError = Infinity;
      lastProgressAt = Date.now();
      continue;
    }
    if (Date.now() - lastProgressAt > 8_000) {
      throw new Error(`Public-input walk stalled: ${JSON.stringify({ target, last })}`);
    }
    const angularError = Math.abs(last.turnError);
    const remainingDistance = Math.max(0, last.distance - stopDistance);
    const forwardMilliseconds = angularError > 0.18
      ? 120
      : angularError > 0.08
        ? 220
        : Math.min(620, Math.max(180, remainingDistance * 105));
    await holdKeys(page, ['KeyW'], forwardMilliseconds);
  }
  throw new Error(`Public-input walk timed out: ${JSON.stringify({ target, last })}`);
};

/**
 * Perform one ordinary forward jump after tank-steering toward a world-space
 * landing. This is intentionally input-only; the returned detached public
 * state is evidence of where the authored controller actually landed.
 */
export const performPublicDirectedJump = async (page, target, {
  preRunMilliseconds = 0,
  forwardHoldMilliseconds = 720,
  settleTimeout = 5_000,
} = {}) => {
  // Heavy authored rooms can render slowly enough that each detached public
  // state sample spans several frames. Give the real tank-turn input time to
  // settle instead of treating browser load as a failed jump setup.
  await orientToward(page, target, { timeout: 90_000, tolerance: 0.32 });
  await page.keyboard.down('KeyW');
  try {
    if (preRunMilliseconds > 0) {
      await page.waitForTimeout(preRunMilliseconds);
    }
    await page.keyboard.down('Space');
    await page.waitForTimeout(100);
    await page.keyboard.up('Space');
    await page.waitForTimeout(forwardHoldMilliseconds);
  } finally {
    await page.keyboard.up('Space').catch(() => {});
    await page.keyboard.up('KeyW').catch(() => {});
  }
  await expect.poll(async () => {
    const state = await readPublicDungeonPlayerJourneyState(page);
    return state.player.jumpState === 'Grounded' && !state.player.ledgeClinging;
  }, { timeout: settleTimeout }).toBe(true);
  return readPublicDungeonPlayerJourneyState(page);
};

const performTraversalAction = async (page, step) => {
  if (step.action === 'ladder') {
    let state = await readPublicV1JourneyState(page, { includeGeometry: false });
    const ladder = state.connectorLadders.find(({ id }) => id === step.targetId);
    if (!ladder) throw new Error(`Missing public ladder contract ${step.targetId}.`);
    const ascending = step.rise > 0;
    const mountPosition = ascending ? ladder.bottomMountPosition : ladder.topMountPosition;
    if (!mountPosition) throw new Error(`Ladder ${ladder.id} has no public mount anchor.`);
    await walkToWaypoint(page, mountPosition, { stopDistance: 0.68, timeout: 30_000 });

    const mountStarted = Date.now();
    while (Date.now() - mountStarted < 8_000) {
      state = await readPublicV1JourneyState(page, { includeGeometry: false });
      if (state.player.ladderTraversal?.ladderId === ladder.id) break;
      if (state.nearestInteractable?.kind === 'ladder'
        && state.nearestInteractable.targetId === ladder.id) {
        await page.keyboard.press('KeyE');
        await page.waitForTimeout(160);
        continue;
      }
      await orientToward(page, mountPosition);
      await holdKeys(page, ['KeyW'], 90);
    }
    state = await readPublicDungeonPlayerJourneyState(page);
    if (state.player.ladderTraversal?.ladderId !== ladder.id) {
      throw new Error(`Could not mount public ladder ${ladder.id}.`);
    }

    const climbKey = ascending ? 'KeyW' : 'KeyS';
    await page.keyboard.down(climbKey);
    try {
      await expect.poll(async () => {
        const current = await readPublicDungeonPlayerJourneyState(page);
        return current.player.ladderTraversal === null
          && Math.abs(current.player.position.y - step.point.y) <= 0.45;
      // The 14 m climb is frame-driven. Under WebGL combat-test load the
      // nominal 4.5 s traversal can take materially longer in wall-clock time;
      // abandoning it after nine seconds leaves the player suspended between
      // authored floors, where a legitimate route cannot be replanned. Keep
      // holding the normal climb input until a generous mechanism-local guard
      // expires; the enclosing route/test deadlines remain authoritative.
      }, { timeout: 30_000 }).toBe(true);
    } finally {
      await page.keyboard.up(climbKey).catch(() => {});
    }
    await page.waitForTimeout(180);
    return;
  }

  if (step.action === 'automatic_lift') {
    let state = await readPublicV1JourneyState(page, { includeGeometry: false });
    let lift = state.connectorLifts.find(({ id }) => id === step.targetId);
    if (!lift?.center) throw new Error(`Missing public lift contract ${step.targetId}.`);
    const sourceElevation = step.point.y - step.rise;
    const destinationElevation = step.point.y;
    const approachX = state.player.position.x - lift.center.x;
    const approachZ = state.player.position.z - lift.center.z;
    const approachLength = Math.hypot(approachX, approachZ);
    if (approachLength <= 0.001) {
      throw new Error(`Lift ${lift.id} source landing has no approach vector.`);
    }
    const directionX = approachX / approachLength;
    const directionZ = approachZ / approachLength;
    const edgeDistance = Math.min(
      Math.abs(directionX) > 0.001 ? lift.halfWidth / Math.abs(directionX) : Infinity,
      Math.abs(directionZ) > 0.001 ? lift.halfDepth / Math.abs(directionZ) : Infinity,
    );
    const boardPoint = {
      x: lift.center.x + directionX * Math.max(0.4, edgeDistance - 0.72),
      y: sourceElevation,
      z: lift.center.z + directionZ * Math.max(0.4, edgeDistance - 0.72),
    };
    await orientToward(page, boardPoint);
    await expect.poll(async () => {
      state = await readPublicV1JourneyState(page, { includeGeometry: false });
      lift = state.connectorLifts.find(({ id }) => id === step.targetId);
      return Boolean(
        lift
        && Math.abs(lift.currentElevation - sourceElevation) <= 0.08
        && lift.phase === 'dwelling',
      );
    }, { timeout: 30_000 }).toBe(true);

    await walkToWaypoint(page, boardPoint, { stopDistance: 0.58, timeout: 4_000 });
    await expect.poll(async () => {
      state = await readPublicV1JourneyState(page, { includeGeometry: false });
      lift = state.connectorLifts.find(({ id }) => id === step.targetId);
      return Boolean(
        lift
        && Math.abs(state.player.position.x - lift.center.x) <= lift.halfWidth - 0.2
        && Math.abs(state.player.position.z - lift.center.z) <= lift.halfDepth - 0.2
        && Math.abs(state.player.position.y - lift.currentElevation) <= 0.32,
      );
    }, { timeout: 3_000 }).toBe(true);
    await expect.poll(async () => {
      state = await readPublicV1JourneyState(page, { includeGeometry: false });
      lift = state.connectorLifts.find(({ id }) => id === step.targetId);
      return Boolean(
        lift
        && Math.abs(lift.currentElevation - destinationElevation) <= 0.08
        && Math.abs(state.player.position.y - destinationElevation) <= 0.42,
      );
    }, { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(180);
    return;
  }

  await orientToward(page, step.point);
  const movementKeys = ['KeyW'];
  if (step.action === 'drop') {
    for (const key of movementKeys) await page.keyboard.down(key);
    await page.waitForTimeout(340);
    for (const key of movementKeys) await page.keyboard.up(key);
    await page.waitForTimeout(900);
    return;
  }

  const ledgeClimb = step.action === 'ledge_climb';
  for (const key of movementKeys) await page.keyboard.down(key);
  try {
    await page.keyboard.down('Space');
    await page.waitForTimeout(90);
    await page.keyboard.up('Space');
    await page.waitForTimeout(ledgeClimb ? 1_650 : 920);
  } finally {
    await page.keyboard.up('Space').catch(() => {});
    for (const key of movementKeys) await page.keyboard.up(key).catch(() => {});
  }
  if (ledgeClimb) {
    // Keep climbing input alive through the authored hang-to-crouch transition.
    for (const key of movementKeys) await page.keyboard.down(key);
    await page.waitForTimeout(720);
    for (const key of movementKeys) await page.keyboard.up(key);
  }
  await page.waitForTimeout(260);
};

export const followPublicFloorRoute = async (page, target, {
  targetRadius = 1.5,
  targetMinimumRadius = 0,
  maximumTargetVerticalDifference = 1.35,
  goalZone = null,
  requireClearSight = false,
  goalPredicate = null,
  stopDistance = 0.78,
  timeout = 150_000,
  maximumReplans = 5,
  onRampMilestone = null,
} = {}) => {
  const started = Date.now();
  let lastFailure = null;
  let lastRoute = null;
  let traversedActions = [];
  const traversedConnectorIds = new Set();

  try {
    for (let attempt = 0; attempt <= maximumReplans && Date.now() - started < timeout; attempt += 1) {
      let state = await readPublicV1JourneyState(page);
      state = await finishPublicLedgeClimbIfNeeded(page, state);
      let route;
      try {
        route = simplifyRoute(planPublicFloorRoute(state, target, {
          targetRadius,
          targetMinimumRadius,
          maximumTargetVerticalDifference,
          goalZone,
          requireClearSight,
          goalPredicate,
        }));
      } catch (error) {
        lastFailure = error;
        if (attempt >= maximumReplans) throw error;
        await page.waitForTimeout(300);
        continue;
      }
      lastRoute = route;

      try {
        // nearestPhysicallyReachableNode deliberately permits a clear,
        // continuously supported start several metres from the live player
        // (for example after knockback at a catwalk edge). A* is anchored at
        // that node, so the public executor must actually walk onto it before
        // consuming route.slice(1); silently skipping it makes every later
        // waypoint originate from a position the player never occupied.
        const liveBeforeStart = await readPublicDungeonPlayerJourneyState(page);
        if (distance2d(liveBeforeStart.player.position, route[0].point) > 0.78) {
          await walkToWaypoint(page, route[0].point, {
            stopDistance: 0.72,
            timeout: 90_000,
          });
        }
        const routeSteps = route.slice(1);
        const rampGroups = [];
        for (let routeIndex = 0; routeIndex < routeSteps.length; routeIndex += 1) {
          const routeStep = routeSteps[routeIndex];
          if (routeStep.action !== 'ramp' || !routeStep.rampRouteId) continue;
          const previousGroup = rampGroups.at(-1);
          if (previousGroup
            && previousGroup.rampRouteId === routeStep.rampRouteId
            && previousGroup.lastIndex === routeIndex - 1) {
            previousGroup.lastIndex = routeIndex;
            previousGroup.stepIndexes.push(routeIndex);
          } else {
            rampGroups.push({
              rampRouteId: routeStep.rampRouteId,
              firstIndex: routeIndex,
              lastIndex: routeIndex,
              stepIndexes: [routeIndex],
            });
          }
        }
        const rampGroupByStepIndex = new Map();
        for (const group of rampGroups) {
          group.middleIndex = group.stepIndexes[Math.floor((group.stepIndexes.length - 1) * 0.5)];
          for (const routeIndex of group.stepIndexes) rampGroupByStepIndex.set(routeIndex, group);
        }
        for (let stepIndex = 0; stepIndex < routeSteps.length; stepIndex += 1) {
          const step = routeSteps[stepIndex];
          const previousStep = route[stepIndex];
          const nextStep = routeSteps[stepIndex + 1] ?? null;
          const rampGroup = rampGroupByStepIndex.get(stepIndex) ?? null;
          if (Date.now() - started >= timeout) throw new Error('Overall public route timeout.');
          if (rampGroup?.firstIndex === stepIndex && onRampMilestone) {
            await onRampMilestone({
              stage: 'entrance',
              rampRouteId: rampGroup.rampRouteId,
              point: { ...previousStep.point },
              roomId: previousStep.tile?.roomId ?? step.tile?.roomId ?? null,
              direction: step.point.y >= previousStep.point.y ? 'ascending' : 'descending',
            });
          }
          if (['jump', 'ledge_climb', 'drop', 'ladder', 'automatic_lift', 'ramp'].includes(step.action)) {
            traversedActions.push(step.action);
          }
          if (['jump', 'ledge_climb', 'drop', 'ladder', 'automatic_lift'].includes(step.action)) {
            await performTraversalAction(page, step);
          }
          const ordinaryIntermediateWalk = nextStep !== null
            && step.action === 'walk'
            && nextStep.action === 'walk'
            && (previousStep.action === 'walk' || previousStep.action === 'start');
          await walkToWaypoint(page, step.point, {
            // V1 floor nodes are 2.8m apart, but pillars, arch feet, pedestals,
            // and rail posts can make an otherwise connected tile center
            // physically unoccupiable. Crossing within 2.05m of an
            // intermediate center still advances into the same cardinal cell
            // without skipping the next traversal edge.
            // A 2.8m floor cell may have an unoccupiable machinery/rail centre.
            // Permit 2.55m only across a plain walk chain; final goals and every
            // point adjacent to a jump, ramp, drop, ladder, or lift stay strict
            // so an action can never start before its physical source endpoint.
            stopDistance: stepIndex === routeSteps.length - 1
              ? stopDistance
              : ordinaryIntermediateWalk ? 2.55 : 0.78,
            timeout: step.action === 'ledge_climb' ? 60_000 : 90_000,
          });
          if (rampGroup && onRampMilestone) {
            if (rampGroup.middleIndex === stepIndex) {
              await onRampMilestone({
                stage: 'middle',
                rampRouteId: rampGroup.rampRouteId,
                point: { ...step.point },
                roomId: step.tile?.roomId ?? null,
                direction: step.point.y >= previousStep.point.y ? 'ascending' : 'descending',
              });
            }
            if (rampGroup.lastIndex === stepIndex) {
              await onRampMilestone({
                stage: 'end',
                rampRouteId: rampGroup.rampRouteId,
                point: { ...step.point },
                roomId: step.tile?.roomId ?? null,
                direction: step.point.y >= previousStep.point.y ? 'ascending' : 'descending',
              });
            }
          }
          if (step.connectionId) traversedConnectorIds.add(step.connectionId);
        }
        return {
          route,
          traversedActions,
          traversedConnectorIds: [...traversedConnectorIds],
          replans: attempt,
        };
      } catch (error) {
        lastFailure = error;
        await releaseKeys(page);
        await page.waitForTimeout(350);
      }
    }
  } finally {
    await releaseKeys(page);
  }

  throw new Error(`Public floor route failed: ${JSON.stringify({
    target,
    traversedActions,
    traversedConnectorIds: [...traversedConnectorIds],
    lastRoute,
    reason: lastFailure?.message ?? String(lastFailure),
  })}`);
};

const publicFloorAnchor = (state, floorKey) => {
  if (!floorKey) return null;
  const floor = state.floorTiles?.find((candidate) => candidate.floorKey === floorKey);
  return floor ? {
    x: floor.x * state.tileSize,
    y: floor.elevation,
    z: floor.z * state.tileSize,
  } : null;
};

const publicSocketAnchor = (state, socket, elevation) => {
  if (!socket) return null;
  return publicFloorAnchor(state, socket.floorKey) ?? {
    x: Number(socket.x) * state.tileSize,
    y: Number.isFinite(elevation) ? elevation : Number(socket.elevation ?? socket.y ?? 0),
    z: Number(socket.z) * state.tileSize,
  };
};

const publicLinkedMechanismAnchors = (state, targetId, action, sourceElevation, destinationElevation) => {
  const floorsByKey = new Map(
    (state.floorTiles ?? []).map((floor) => [floor.floorKey, floor]),
  );
  const linkedFloors = [];
  for (const floor of state.floorTiles ?? []) {
    for (const link of floor.traversalLinks ?? []) {
      if (link.targetId !== targetId || link.action !== action) continue;
      linkedFloors.push(floor);
      const destination = floorsByKey.get(link.toFloorKey);
      if (destination) linkedFloors.push(destination);
    }
  }
  const unique = [...new Map(linkedFloors.map((floor) => [floor.floorKey, floor])).values()];
  const closestTo = (elevation) => unique
    .map((floor) => ({ floor, delta: Math.abs(floor.elevation - elevation) }))
    .sort((left, right) => left.delta - right.delta || left.floor.index - right.floor.index)[0]
    ?.floor ?? null;
  const sourceFloor = closestTo(sourceElevation);
  const destinationFloor = closestTo(destinationElevation);
  if (!sourceFloor || !destinationFloor || sourceFloor.floorKey === destinationFloor.floorKey) return null;
  return {
    source: publicFloorAnchor(state, sourceFloor.floorKey),
    destination: publicFloorAnchor(state, destinationFloor.floorKey),
  };
};

const resolvePublicConnectorAnchors = (state, connectorRoute) => {
  const connectionId = connectorRoute.connectionId;
  const sourceElevation = Number(connectorRoute.sourceElevation ?? 0);
  const destinationElevation = Number(connectorRoute.destinationElevation ?? sourceElevation);
  const traversalKind = connectorRoute.traversalKind;

  if (traversalKind === 'slope') {
    return {
      expectedAction: 'ramp',
      source: publicSocketAnchor(state, connectorRoute.sourceSocket, sourceElevation),
      destination: publicSocketAnchor(
        state,
        connectorRoute.destinationSocket,
        destinationElevation,
      ),
    };
  }

  if (traversalKind === 'ladder') {
    const ladder = state.connectorLadders?.find((candidate) => (
      candidate.connectionId === connectionId
    ));
    if (!ladder) throw new Error(`Connector ${connectionId} has no public ladder contract.`);
    const sourceIsBottom = Math.abs(sourceElevation - ladder.bottomY)
      <= Math.abs(sourceElevation - ladder.topY);
    return {
      expectedAction: 'ladder',
      source: sourceIsBottom ? ladder.bottomExit : ladder.topExit,
      destination: sourceIsBottom ? ladder.topExit : ladder.bottomExit,
    };
  }

  if (traversalKind === 'automatic_lift') {
    const lift = state.connectorLifts?.find((candidate) => (
      candidate.connectionId === connectionId
    ));
    if (!lift) throw new Error(`Connector ${connectionId} has no public lift contract.`);
    const anchors = publicLinkedMechanismAnchors(
      state,
      lift.id,
      'automatic_lift',
      sourceElevation,
      destinationElevation,
    );
    if (!anchors) {
      throw new Error(`Connector ${connectionId} has no linked public lift landing anchors.`);
    }
    return { expectedAction: 'automatic_lift', ...anchors };
  }

  throw new Error(
    `Connector ${connectionId} traversal kind ${String(traversalKind)} is not elevation-changing.`,
  );
};

const assertPublicConnectorLeg = (result, connectionId, expectedAction, label) => {
  if (!result?.traversedConnectorIds?.includes(connectionId)) {
    throw new Error(`${label} did not physically traverse connector ${connectionId}.`);
  }
  if (!result?.traversedActions?.includes(expectedAction)) {
    throw new Error(`${label} did not perform ${expectedAction} on connector ${connectionId}.`);
  }
};

/**
 * Physically reaches one accepted connector endpoint, traverses the mechanism
 * in its planned direction, and traverses it again in reverse. The default
 * executor is the same public keyboard/mouse route follower used by full V1
 * journeys; the optional executor hook exists only for deterministic unit
 * harnesses around this orchestration contract.
 */
export const traversePublicConnectorBothWays = async (page, connectorRoute, {
  targetRadius = 0.9,
  maximumTargetVerticalDifference = 0.55,
  stopDistance = 0.72,
  approachTimeout = 150_000,
  legTimeout = 180_000,
  maximumReplans = 5,
  routeFollower = followPublicFloorRoute,
} = {}) => {
  if (!connectorRoute?.connectionId) {
    throw new TypeError('A public connector route with a stable connectionId is required.');
  }
  const state = await readPublicV1JourneyState(page);
  const acceptedRoute = state.connectorRoutes?.find((candidate) => (
    candidate.connectionId === connectorRoute.connectionId
  ));
  if (!acceptedRoute) {
    throw new Error(`Connector ${connectorRoute.connectionId} is absent from public diagnostics.`);
  }
  const { source, destination, expectedAction } = resolvePublicConnectorAnchors(
    state,
    acceptedRoute,
  );
  if (!source || !destination) {
    throw new Error(`Connector ${acceptedRoute.connectionId} has incomplete public anchors.`);
  }
  const routeOptions = {
    targetRadius,
    maximumTargetVerticalDifference,
    stopDistance,
    maximumReplans,
  };
  const approach = await routeFollower(page, source, {
    ...routeOptions,
    timeout: approachTimeout,
  });
  const forward = await routeFollower(page, destination, {
    ...routeOptions,
    timeout: legTimeout,
  });
  assertPublicConnectorLeg(
    forward,
    acceptedRoute.connectionId,
    expectedAction,
    'Forward connector leg',
  );
  const reverse = await routeFollower(page, source, {
    ...routeOptions,
    timeout: legTimeout,
  });
  assertPublicConnectorLeg(
    reverse,
    acceptedRoute.connectionId,
    expectedAction,
    'Reverse connector leg',
  );

  const returnedState = await readPublicDungeonPlayerJourneyState(page);
  const horizontalError = distance2d(returnedState.player.position, source);
  const verticalError = Math.abs(returnedState.player.position.y - source.y);
  if (horizontalError > targetRadius || verticalError > maximumTargetVerticalDifference) {
    throw new Error(`Connector ${acceptedRoute.connectionId} did not return to its source endpoint.`);
  }

  return {
    connectionId: acceptedRoute.connectionId,
    traversalKind: acceptedRoute.traversalKind,
    expectedAction,
    sourceAnchor: { ...source },
    destinationAnchor: { ...destination },
    approach,
    forward,
    reverse,
    returnedPosition: { ...returnedState.player.position },
  };
};

const creepUntilInteractable = async (page, targetId, targetPosition, {
  timeout = 45_000,
} = {}) => {
  const started = Date.now();
  let last = null;
  try {
    while (Date.now() - started < timeout) {
      const state = await readPublicV1JourneyState(page, { includeGeometry: false });
      if (state.nearestInteractable?.targetId === targetId) return state;
      last = {
        nearest: state.nearestInteractable,
        steering: steeringFor(state, targetPosition),
      };
      if (Math.abs(last.steering.turnError) > 0.14) {
        await holdKeys(page, [turnKeyFor(last.steering)], 55);
      } else {
        await holdKeys(page, ['KeyW'], 75);
      }
    }
  } finally {
    await releaseKeys(page);
  }
  throw new Error(`Could not physically reach interaction ${targetId}: ${JSON.stringify(last)}`);
};

export const activatePublicInteractable = async (page, targetId, {
  targetPosition,
  targetRadius = 2.1,
  expectedState,
  timeout = 150_000,
} = {}) => {
  const state = await readPublicV1JourneyState(page);
  const door = state.doors.find(({ id }) => id === targetId && targetPosition);
  if (door?.closed) {
    const blockerRadius = Math.max(door.collisionHalfWidth, door.collisionHalfDepth) + PLAYER_RADIUS;
    // Never ask A* to stand in the collider center. It chooses whichever
    // activation-side tile is physically reachable from the current side.
    await followPublicFloorRoute(page, targetPosition, {
      targetRadius: Math.max(state.tileSize * 1.4, targetRadius + 0.8),
      targetMinimumRadius: blockerRadius + 0.08,
      maximumTargetVerticalDifference: 1.4,
      stopDistance: 0.7,
      timeout,
    });
  } else {
    await followPublicFloorRoute(page, targetPosition, {
      targetRadius: Math.max(state.tileSize * 1.15, targetRadius),
      maximumTargetVerticalDifference: 1.5,
      stopDistance: 0.7,
      timeout,
    });
  }

  await creepUntilInteractable(page, targetId, targetPosition);
  await page.keyboard.press('KeyE');
  if (expectedState) {
    await expect.poll(async () => expectedState(
      await readPublicV1JourneyState(page, { includeGeometry: false }),
    ), { timeout: 20_000 }).toBe(true);
  }
};

export const collectPublicKeycard = async (page, keycardId, targetPosition, {
  timeout = 150_000,
} = {}) => {
  const state = await readPublicV1JourneyState(page);
  if (state.ownedKeys.includes(keycardId)) return state;
  await followPublicFloorRoute(page, targetPosition, {
    targetRadius: state.tileSize * 1.2,
    maximumTargetVerticalDifference: 1.5,
    stopDistance: 0.7,
    timeout,
  });

  const started = Date.now();
  let last = null;
  try {
    while (Date.now() - started < 45_000) {
      const current = await readPublicV1JourneyState(page, { includeGeometry: false });
      if (current.ownedKeys.includes(keycardId)) return current;
      last = steeringFor(current, targetPosition);
      if (Math.abs(last.turnError) > 0.14) {
        await holdKeys(page, [turnKeyFor(last)], 55);
      } else {
        await holdKeys(page, ['KeyW'], 75);
      }
    }
  } finally {
    await releaseKeys(page);
  }
  throw new Error(`Could not physically collect ${keycardId}: ${JSON.stringify(last)}`);
};

const encounterGoalZone = (encounter) => encounter.triggerZone ?? encounter.zone;

const triggerPublicEncounter = async (page, encounterId, timeout, onRampMilestone = null) => {
  let state = await readPublicV1JourneyState(page);
  let encounter = findById(state.encounters, encounterId);
  if (encounter.cleared || encounter.spawned) return encounter;
  const zone = encounterGoalZone(encounter);
  await followPublicFloorRoute(page, zone.position, {
    targetRadius: Math.max(zone.halfWidth, zone.halfDepth),
    maximumTargetVerticalDifference: (zone.verticalHalfHeight ?? 2) + 1.2,
    goalZone: zone,
    stopDistance: 0.8,
    // The caller owns the encounter-stage deadline. Capping a physical
    // approach here made a still-solvable journey fail before its declared
    // budget, especially when a vertical connector preceded the trigger.
    timeout,
    onRampMilestone,
  });
  await expect.poll(async () => {
    state = await readPublicV1JourneyState(page, { includeGeometry: false });
    encounter = findById(state.encounters, encounterId);
    return encounter.spawned || encounter.cleared;
  }, { timeout: 20_000 }).toBe(true);
  return encounter;
};

const liveEncounterEnemies = (state, encounterId) => {
  const encounter = findById(state.encounters, encounterId);
  const ids = new Set(encounter.enemyIds);
  return state.enemies.filter((enemy) => (
    !enemy.dead
    && enemy.health > 0
    && (ids.has(enemy.id) || enemy.encounterId === encounterId)
  ));
};

/**
 * Plan a collision-bound firing-lane route when exactly one encounter enemy
 * remains. The target can be airborne above the authored floor (the Enemy Nest
 * flyer idles roughly 1.65 m high), so the route ends on a clear floor node in
 * weapon range instead of trying to occupy the enemy's live position.
 *
 * The returned route is diagnostic data only. Its executor still has to walk
 * every edge with normal keyboard input and can never cross a wall or gate.
 */
export const planPublicFinalEnemyPursuitRoute = (state, encounterId) => {
  const encounter = findById(state.encounters, encounterId);
  const enemies = liveEncounterEnemies(state, encounterId);
  if (enemies.length !== 1) return null;

  const enemy = enemies[0];
  const maximumTargetVerticalDifference = Math.max(
    2.1,
    Math.abs(enemy.position.y - state.player.position.y) + 0.35,
  );
  const route = planPublicFloorRoute(state, enemy.position, {
    targetRadius: MEGA_BUSTER_APPROACH_RADIUS,
    maximumTargetVerticalDifference,
    requireClearSight: true,
    goalPredicate: (node) => node.roomId === encounter.roomId,
  });
  return {
    encounterId,
    enemyId: enemy.id,
    targetPosition: { ...enemy.position },
    maximumTargetVerticalDifference,
    route,
  };
};

const lockedEncounterEnemy = (state, encounterId) => {
  const enemies = liveEncounterEnemies(state, encounterId);
  const ownerEnemyId = state.lock?.ownerEnemyId;
  const targetId = String(state.lock?.targetId ?? '');
  return enemies.find(({ id }) => id === ownerEnemyId)
    ?? enemies.find(({ id }) => targetId === id || targetId.startsWith(`${id}:`))
    ?? null;
};

const buildEncounterPatrolPoints = (state, encounterId) => {
  const encounter = findById(state.encounters, encounterId);
  // Trigger zones can be a single pedestal-sized volume. Patrol the authored
  // encounter arena instead so every clear floor/elevation remains available
  // after the one-time trigger has fired.
  const zone = encounter.zone ?? encounterGoalZone(encounter);
  const graph = buildFloorGraph(state);
  const bucketSize = state.tileSize * 2;
  const buckets = new Map();

  for (const node of graph.nodes) {
    if (node.roomId !== encounter.roomId) continue;
    if (!pointInsideGoalZone(node.point, {
      ...zone,
      verticalHalfHeight: Math.max(zone.verticalHalfHeight ?? 0, 32),
    })) continue;
    const bucketX = Math.round((node.point.x - zone.position.x) / bucketSize);
    const bucketZ = Math.round((node.point.z - zone.position.z) / bucketSize);
    const elevationBand = Math.round(node.point.y / Math.max(0.5, state.tileSize * 0.5));
    const key = `${bucketX}:${bucketZ}:${elevationBand}`;
    const bucketCenter = {
      x: zone.position.x + bucketX * bucketSize,
      y: node.point.y,
      z: zone.position.z + bucketZ * bucketSize,
    };
    const score = distance2d(node.point, bucketCenter);
    const current = buckets.get(key);
    if (!current || score < current.score || (score === current.score && node.index < current.node.index)) {
      buckets.set(key, { node, score });
    }
  }

  return [...buckets.values()]
    .map(({ node }) => Object.freeze({
      id: `patrol:${encounterId}:${node.index}`,
      point: Object.freeze({ ...node.point }),
      elevation: node.point.y,
      tileIndex: node.index,
    }))
    .sort((left, right) => (
      left.elevation - right.elevation
      || left.point.z - right.point.z
      || left.point.x - right.point.x
      || left.tileIndex - right.tileIndex
    ));
};

const buildEnemyAdjacentPatrolPoints = (state, encounterId, targetRadius) => {
  const encounter = findById(state.encounters, encounterId);
  const graph = buildFloorGraph(state);
  const enemies = liveEncounterEnemies(state, encounterId);
  const maximumDistance = Math.max(2, targetRadius - 0.25);
  const selected = new Map();

  for (const enemy of enemies) {
    const nearest = graph.nodes
      .filter((node) => node.roomId === encounter.roomId)
      .map((node) => ({
        node,
        horizontalDistance: distance2d(node.point, enemy.position),
        verticalDistance: Math.abs(node.point.y - enemy.position.y),
      }))
      .filter(({ horizontalDistance, verticalDistance }) => (
        horizontalDistance <= maximumDistance && verticalDistance <= 3.2
      ))
      .sort((left, right) => (
        left.horizontalDistance + left.verticalDistance * 1.4
        - (right.horizontalDistance + right.verticalDistance * 1.4)
        || left.node.index - right.node.index
      ))
      .slice(0, 4);
    for (const { node } of nearest) {
      selected.set(node.index, Object.freeze({
        id: `enemy-adjacent:${encounterId}:${enemy.id}:${node.index}`,
        point: Object.freeze({ ...node.point }),
        elevation: node.point.y,
        tileIndex: node.index,
        liveEnemyId: enemy.id,
      }));
    }
  }

  return [...selected.values()];
};

const chaseUnlockedEncounterTarget = async (
  page,
  encounterId,
  preferredEnemyId,
  {
    stopDistance = 2.15,
    timeout = 45_000,
  } = {},
) => {
  const started = Date.now();
  let bestDistance = Infinity;
  let lastProgressAt = Date.now();
  let jumpCount = 0;
  let doglegKey = 'KeyA';

  while (Date.now() - started < timeout) {
    const state = await readPublicV1JourneyState(page, { includeGeometry: false });
    if (findById(state.encounters, encounterId).cleared) return true;
    const enemies = liveEncounterEnemies(state, encounterId);
    const target = enemies.find(({ id }) => id === preferredEnemyId)
      ?? [...enemies].sort((left, right) => (
        distance2d(left.position, state.player.position)
        - distance2d(right.position, state.player.position)
      ))[0];
    if (!target?.position) return true;
    if (state.lock.movementLocked) return true;
    if (state.player.ledgeClinging || state.player.jumpState !== 'Grounded') {
      await page.waitForTimeout(240);
      continue;
    }

    const steering = steeringFor(state, target.position);
    const verticalDifference = Math.abs(target.position.y - state.player.position.y);
    if (steering.distance <= stopDistance && verticalDifference <= 1.8) {
      await orientToward(page, target.position, { timeout: 3_000 }).catch(() => {});
      return true;
    }
    if (steering.distance + 0.08 < bestDistance) {
      bestDistance = steering.distance;
      lastProgressAt = Date.now();
    }
    if (Math.abs(steering.turnError) > 0.14) {
      await holdKeys(
        page,
        [turnKeyFor(steering)],
        Math.min(130, Math.max(35, Math.abs(steering.turnError) * 250)),
      );
      continue;
    }
    if (Date.now() - lastProgressAt > 2_200 && jumpCount < 3) {
      // The V1 credential pyramid uses authored half-height tier lips that are
      // obvious to a player but are not all represented as floor-graph edges.
      // A forward jump is the normal way to clear one after walking stalls.
      await page.keyboard.down('KeyW');
      try {
        await page.keyboard.press('Space');
        await page.waitForTimeout(1_100);
      } finally {
        await page.keyboard.up('KeyW').catch(() => {});
      }
      jumpCount += 1;
      bestDistance = Infinity;
      lastProgressAt = Date.now();
      continue;
    }
    if (Date.now() - lastProgressAt > 2_200) {
      // Walk a short alternating dogleg around a pyramid support, then resume
      // direct pursuit. This remains collision-bound public locomotion.
      await holdKeys(page, [doglegKey], 360);
      await holdKeys(page, ['KeyW'], 520);
      doglegKey = doglegKey === 'KeyA' ? 'KeyD' : 'KeyA';
      bestDistance = Infinity;
      lastProgressAt = Date.now();
      continue;
    }
    await holdKeys(page, ['KeyW'], Math.min(300, Math.max(110, steering.distance * 42)));
  }
  return false;
};

const pursueFinalLiveEncounterEnemy = async (page, encounterId, timeout) => {
  const started = Date.now();
  const pursuitWindow = Math.min(timeout, 60_000);

  while (Date.now() - started < pursuitWindow) {
    const geometryState = await readPublicV1JourneyState(page);
    let pursuit = null;
    try {
      pursuit = planPublicFinalEnemyPursuitRoute(geometryState, encounterId);
    } catch {
      // A flyer may cross behind machinery between snapshots, temporarily
      // leaving no clear static firing lane. Keep pursuing its live position
      // through ordinary input and try the authored graph again next cycle.
      const liveTarget = liveEncounterEnemies(geometryState, encounterId)[0];
      if (liveTarget?.position) {
        await chaseUnlockedEncounterTarget(page, encounterId, liveTarget.id, {
          stopDistance: MEGA_BUSTER_APPROACH_RADIUS,
          timeout: Math.min(12_000, pursuitWindow - (Date.now() - started)),
        });
      }
      continue;
    }
    if (!pursuit) return false;

    const firingLane = pursuit.route.at(-1)?.point;
    if (!firingLane) return false;
    const routeBudget = Math.min(35_000, pursuitWindow - (Date.now() - started));
    if (routeBudget <= 0) break;
    try {
      // Follow the static, collision-checked authored floor lane selected from
      // the latest snapshot. The enemy may continue moving, so failure or an
      // obsolete lane simply causes another live replan below.
      await followPublicFloorRoute(page, firingLane, {
        targetRadius: 0.85,
        maximumTargetVerticalDifference: 0.6,
        stopDistance: 0.78,
        timeout: routeBudget,
        maximumReplans: 3,
      });
    } catch {
      // A moving target can invalidate a firing lane while it is being walked.
      // Continue with a short direct public-input chase, then rebuild the lane
      // from a fresh geometry snapshot rather than treating this as fatal.
    }

    let state = await readPublicV1JourneyState(page, { includeGeometry: false });
    if (findById(state.encounters, encounterId).cleared) return true;
    const liveTargets = liveEncounterEnemies(state, encounterId);
    if (liveTargets.length !== 1) return false;
    if (lockedEncounterEnemy(state, encounterId)) return true;

    const remaining = pursuitWindow - (Date.now() - started);
    if (remaining <= 0) break;
    await chaseUnlockedEncounterTarget(page, encounterId, liveTargets[0].id, {
      stopDistance: MEGA_BUSTER_APPROACH_RADIUS,
      timeout: Math.min(12_000, remaining),
    });

    // Tab can be consumed by hit recovery. Keep facing the sole live target and
    // retry ordinary lock-on while the outer caller's held Buster fire continues
    // to use that same aim. If lock still does not acquire, loop and route to a
    // newly computed firing lane instead of falling back to a finite patrol.
    const acquireStarted = Date.now();
    const acquireWindow = Math.min(
      12_000,
      pursuitWindow - (Date.now() - started),
    );
    while (Date.now() - acquireStarted < acquireWindow) {
      state = await readPublicV1JourneyState(page, { includeGeometry: false });
      if (findById(state.encounters, encounterId).cleared) return true;
      const target = liveEncounterEnemies(state, encounterId)[0];
      if (!target?.position) return true;
      if (lockedEncounterEnemy(state, encounterId)) return true;
      if (state.player.ledgeClinging || state.player.jumpState !== 'Grounded') {
        await page.waitForTimeout(260);
        continue;
      }
      const horizontalDistance = distance2d(state.player.position, target.position);
      const verticalDifference = Math.abs(target.position.y - state.player.position.y);
      if (horizontalDistance > MEGA_BUSTER_MAXIMUM_RANGE + 0.35
        || verticalDifference > 2.25) break;
      await orientToward(page, target.position, { timeout: 3_000 }).catch(() => {});
      await page.keyboard.press('Tab');
      await page.waitForTimeout(420);
    }
  }

  return false;
};

const approachRetainedLockTarget = async (
  page,
  encounterId,
  targetRadius,
  timeout,
) => {
  const started = Date.now();
  // The approach radius is the preferred firing position, not permission to
  // overlap an enemy body or authored railing. A retained grounded Blade
  // target inside the weapon's real reposition window is already actionable;
  // hand it back to the outer attack loop instead of walking forever toward
  // an unoccupiable 1.65 m center-to-center point.
  const actionableRadius = targetRadius <= BEAM_BLADE_APPROACH_RADIUS + 0.01
    ? BEAM_BLADE_REPOSITION_DISTANCE
    : targetRadius;
  let bestDistance = Infinity;
  let lastProgressAt = Date.now();
  let strafeKey = 'KeyD';
  let last = null;

  while (Date.now() - started < Math.min(timeout, 12_000)) {
    const state = await readPublicV1JourneyState(page, { includeGeometry: false });
    const encounter = findById(state.encounters, encounterId);
    if (encounter.cleared) return true;
    const target = lockedEncounterEnemy(state, encounterId);
    if (!state.lock.movementLocked || !target?.position) return false;

    const distance = distance2d(state.player.position, target.position);
    last = {
      targetId: target.id,
      distance,
      player: state.player.position,
      target: target.position,
    };
    const verticalDifference = Math.abs(target.position.y - state.player.position.y);
    if (distance <= actionableRadius && verticalDifference <= 1.8) return true;
    if (distance + 0.08 < bestDistance) {
      bestDistance = distance;
      lastProgressAt = Date.now();
    }

    if (Date.now() - lastProgressAt > 1_450) {
      // In movement-lock mode A/D orbit the retained enemy. Combining an
      // authored lateral dodge with forward input is the same obstacle escape
      // a player uses when a Nest pod, railing, or another Reaverbot blocks a
      // straight approach; it does not bypass collision or move the player.
      await dodgeWithPublicInput(page, strafeKey);
      await holdKeys(page, [strafeKey, 'KeyW'], 520);
      strafeKey = strafeKey === 'KeyD' ? 'KeyA' : 'KeyD';
      bestDistance = Infinity;
      lastProgressAt = Date.now();
      continue;
    }

    // Movement lock continuously updates its forward basis from the moving
    // enemy. This is more faithful than releasing the lock and asking a cloned
    // static floor route to predict where that enemy will be several seconds
    // later.
    await holdKeys(page, ['KeyW'], Math.min(360, Math.max(140, distance * 58)));
  }

  return false;
};

const routeIntoWeaponRange = async (
  page,
  encounterId,
  enemy,
  timeout,
  targetRadius = MEGA_BUSTER_APPROACH_RADIUS,
  patrolPoints = [],
  patrolVisits = new Map(),
) => {
  const started = Date.now();
  const canUseUnlockedGuardBlade = (currentState) => {
    if (encounterId !== 'keycardGuard') return false;
    return liveEncounterEnemies(currentState, encounterId).some((candidate) => (
      distance2d(candidate.position, currentState.player.position)
        <= BEAM_BLADE_REPOSITION_DISTANCE
      && Math.abs(candidate.position.y - currentState.player.position.y) <= 1.8
    ));
  };
  let state = await readPublicV1JourneyState(page);
  // Floor geometry is immutable for this combat approach, while enemy and
  // player positions continue to move. Retain one cloned authored geometry
  // snapshot so later enemy-adjacent patrol selection does not accidentally
  // run against the metadata-only snapshots (whose floorTiles are empty).
  const routeGeometryState = state;
  const initialEnemies = liveEncounterEnemies(state, encounterId);
  if (encounterId === 'enemyNest'
    && initialEnemies.length === 1
    && !state.lock.movementLocked) {
    // Once only one target remains, never abandon it for a finite generic room
    // patrol. Repeatedly route to a collision-clear authored firing lane and
    // reacquire through normal Tab input. Returning here yields to the outer
    // real-combat loop, which attacks or invokes this live pursuit again until
    // the encounter's authoritative deadline/death/clear condition resolves.
    await pursueFinalLiveEncounterEnemy(page, encounterId, timeout);
    return;
  }
  if (encounterId === 'keycardGuard') {
    const directTarget = liveEncounterEnemies(state, encounterId)
      .find(({ id }) => id === enemy?.id)
      ?? liveEncounterEnemies(state, encounterId)[0];
    if (directTarget?.position) {
      try {
        // The credential pyramid is a traversal arena: two guards occupy its
        // authored raised tiers, outside reliable starter-Buster line of
        // sight from the surrounding floor. Walk the real floor graph to the
        // target's current tier before spending time on repeated Tab presses.
        // This uses ordinary public movement and cannot cross a gate, wall,
        // missing support, or unmodelled vertical transition.
        await followPublicFloorRoute(page, directTarget.position, {
          targetRadius: 2.45,
          maximumTargetVerticalDifference: 1.8,
          stopDistance: 0.82,
          // Do not spend a full minute pathing while every pyramid guard is
          // free to attack. A human abandons a stale pursuit quickly, dodges,
          // and takes a nearer firing lane.
          timeout: Math.min(18_000, timeout),
          maximumReplans: 3,
          goalPredicate: (node) => node.roomId === 'keycardRoom',
        });
        state = await readPublicV1JourneyState(page, { includeGeometry: false });
        const reachedTarget = liveEncounterEnemies(state, encounterId)
          .sort((left, right) => (
            distance2d(left.position, state.player.position)
            - distance2d(right.position, state.player.position)
          ))[0];
        if (reachedTarget?.position
          && distance2d(reachedTarget.position, state.player.position) <= 3.1
          && Math.abs(reachedTarget.position.y - state.player.position.y) <= 1.8) {
          await orientToward(page, reachedTarget.position, { timeout: 4_000 }).catch(() => {});
          return;
        }
      } catch {
        // Fall through to the ordinary lock-on/patrol strategy. A moving
        // enemy can invalidate a perfectly legal route while it is followed.
      }
    }
    state = await readPublicV1JourneyState(page, { includeGeometry: false });
    const chaseTarget = liveEncounterEnemies(state, encounterId)
      .find(({ id }) => id === enemy?.id)
      ?? liveEncounterEnemies(state, encounterId)[0];
    if (chaseTarget?.position && await chaseUnlockedEncounterTarget(
      page,
      encounterId,
      chaseTarget.id,
      { timeout: Math.min(14_000, timeout) },
    )) {
      return;
    }
  }
  if (encounterId === 'enemyNest' && !state.lock.movementLocked) {
    const directTarget = liveEncounterEnemies(state, encounterId)
      .find(({ id }) => id === enemy?.id)
      ?? liveEncounterEnemies(state, encounterId)[0];
    const sameLevel = directTarget?.position
      && Math.abs(directTarget.position.y - state.player.position.y) <= 1.8;
    if (sameLevel && await chaseUnlockedEncounterTarget(
      page,
      encounterId,
      directTarget.id,
      {
        stopDistance: targetRadius <= BEAM_BLADE_APPROACH_RADIUS + 0.01
          ? BEAM_BLADE_REPOSITION_DISTANCE
          : targetRadius,
        timeout: Math.min(8_000, timeout),
      },
    )) return;
    state = await readPublicV1JourneyState(page, { includeGeometry: false });
  }
  const retainedEnemy = lockedEncounterEnemy(state, encounterId);
  if (state.lock.movementLocked && retainedEnemy) {
    if (await approachRetainedLockTarget(page, encounterId, targetRadius, timeout)) return;
  }

  // Always try the player's ordinary Tab acquisition from the current floor
  // before walking to a patrol point. Reaverbots frequently advance into the
  // Buster's real lock range while the preceding attack recovers; routing away
  // from those visible enemies wastes time and can select an unnecessary
  // upper catwalk node.
  if (!state.lock.movementLocked) {
    // Hit recovery and a dodge can briefly consume Tab. Give the normal lock
    // input a bounded grounded window before deciding that locomotion is
    // necessary; otherwise the driver walks away from enemies already visible
    // and inside Buster range merely because its first press landed in stun.
    const acquireInPlaceStarted = Date.now();
    // A moving Reaverbot can remain hidden behind one of the Nest's authored
    // machines indefinitely.  Keep the ordinary in-place Tab attempt short so
    // the public-input driver still has time to walk to a different firing
    // lane instead of treating one obstructed viewpoint as a combat timeout.
    const acquireInPlaceWindow = encounterId === 'enemyNest'
      ? 2_500
      : encounterId === 'keycardGuard' ? 12_000 : 5_500;
    const visibleTarget = liveEncounterEnemies(state, encounterId)
      .find(({ id }) => id === enemy?.id)
      ?? liveEncounterEnemies(state, encounterId)[0];
    if (visibleTarget?.position) {
      await orientToward(page, visibleTarget.position, { timeout: 4_000 }).catch(() => {});
    }
    while (Date.now() - acquireInPlaceStarted < acquireInPlaceWindow) {
      state = await readPublicV1JourneyState(page, { includeGeometry: false });
      const acquiredHere = lockedEncounterEnemy(state, encounterId);
      if (state.lock.movementLocked && acquiredHere) {
        if (await approachRetainedLockTarget(page, encounterId, targetRadius, timeout)) return;
        break;
      }
      if (state.player.ledgeClinging || state.player.jumpState !== 'Grounded') {
        await page.waitForTimeout(320);
        continue;
      }
      await page.keyboard.press('Tab');
      await page.waitForTimeout(460);
    }
    if (!state.lock.movementLocked && canUseUnlockedGuardBlade(state)) return;
  }

  // Static patrol routes use tank controls, so try to release a retained
  // target before selecting another authored floor node. Hit recovery can
  // consume Tab for this whole short window; in that case yield to the outer
  // combat loop instead of manufacturing a premature fatal condition. The
  // authoritative encounter deadline and death checks still bound failure.
  const lockReleaseStarted = Date.now();
  while (state.lock.movementLocked && Date.now() - lockReleaseStarted < 6_000) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(360);
    state = await readPublicV1JourneyState(page, { includeGeometry: false });
  }
  if (state.lock.movementLocked) return;

  if (!patrolPoints.length) throw new Error(`No static authored patrol points for ${encounterId}.`);
  const attempted = new Set();
  let patrolSweep = 0;
  let lastFailure = null;
  const patrolBudget = encounterId === 'keycardGuard' ? 45_000 : 75_000;
  while (Date.now() - started < Math.min(timeout, patrolBudget)) {
    state = await readPublicV1JourneyState(page, { includeGeometry: false });
    const enemies = liveEncounterEnemies(state, encounterId);
    if (!enemies.length || findById(state.encounters, encounterId).cleared) return;
    const preferred = enemies.find(({ id }) => id === enemy?.id) ?? enemies[0];
    const currentPatrolPoints = [
      ...buildEnemyAdjacentPatrolPoints({
        ...routeGeometryState,
        player: state.player,
        enemies: state.enemies,
        encounters: state.encounters,
        doors: state.doors,
      }, encounterId, targetRadius),
      ...patrolPoints,
    ].filter((patrol, index, entries) => (
      index === entries.findIndex((candidate) => candidate.id === patrol.id)
    ));
    const candidates = currentPatrolPoints
      .filter(({ id }) => !attempted.has(id))
      .map((patrol) => {
        const enemyProximity = Math.min(...enemies.map((candidate) => (
          distance2d(patrol.point, candidate.position)
          + Math.abs(patrol.point.y - candidate.position.y) * 1.6
        )));
        const playerDistance = distance2d(patrol.point, state.player.position);
        const playerElevationDelta = Math.abs(patrol.point.y - state.player.position.y);
        const visitPenalty = (patrolVisits.get(patrol.id) ?? 0) * state.tileSize;
        const preferredPenalty = preferred?.position
          ? distance2d(patrol.point, preferred.position) * 0.18
          : 0;
        return {
          patrol,
          score: encounterId === 'keycardGuard'
            // Traverse the V1 credential pyramid one nearby authored point at
            // a time. Enemy-first scoring otherwise selects the summit while
            // the player is still at its base and under active knockback.
            ? playerDistance * 1.8
              + playerElevationDelta * 10
              + enemyProximity * 0.22
              + visitPenalty
            : enemyProximity
              + visitPenalty
              + preferredPenalty
              // Prefer reachable same-level cover before committing the public
              // driver to a jump/ramp transition. Elevated patrols remain valid
              // fallbacks for enemies that actually occupy upper structures.
              + playerDistance * 0.32
              + playerElevationDelta * 4.2,
        };
      })
      .sort((left, right) => left.score - right.score || left.patrol.id.localeCompare(right.patrol.id));
    let next = candidates[0]?.patrol;
    if (!next && patrolSweep < 2) {
      // Patrol points are authored floor destinations, not one-shot state.
      // Enemies continue moving while the player visits them, so repeat a
      // bounded sweep using the accumulated visit penalty and current enemy
      // positions.  This remains real locomotion through room collision.
      attempted.clear();
      patrolSweep += 1;
      continue;
    }
    if (!next) break;
    attempted.add(next.id);
    patrolVisits.set(next.id, (patrolVisits.get(next.id) ?? 0) + 1);

    try {
      await followPublicFloorRoute(page, next.point, {
        targetRadius: state.tileSize * 0.42,
        maximumTargetVerticalDifference: 0.55,
        // Enemy-adjacent patrol nodes are firing-lane hints, not interaction
        // anchors. V1 machinery and rail feet can make their exact tile centre
        // unoccupiable while the player is already on the same adjacent floor
        // cell. Stop within one bounded tile-width, then let the real Tab lock
        // and weapon-distance checks below decide whether the lane is useful.
        stopDistance: state.tileSize * 1.12,
        timeout: Math.min(40_000, timeout - (Date.now() - started)),
        maximumReplans: 2,
      });
    } catch (error) {
      lastFailure = `${next.id}: ${error.message}`;
      continue;
    }

    state = await readPublicV1JourneyState(page, { includeGeometry: false });
    const patrolFaceTarget = liveEncounterEnemies(state, encounterId)
      .find(({ id }) => id === preferred?.id)
      ?? liveEncounterEnemies(state, encounterId)[0];
    if (patrolFaceTarget?.position) {
      await orientToward(page, patrolFaceTarget.position, { timeout: 4_000 }).catch(() => {});
    }
    const patrolAcquireStarted = Date.now();
    let patrolAcquired = false;
    while (Date.now() - patrolAcquireStarted < 5_500) {
      state = await readPublicV1JourneyState(page, { includeGeometry: false });
      patrolAcquired = Boolean(lockedEncounterEnemy(state, encounterId));
      if (state.lock.movementLocked && patrolAcquired) break;
      if (state.player.ledgeClinging || state.player.jumpState !== 'Grounded') {
        await page.waitForTimeout(320);
        continue;
      }
      await page.keyboard.press('Tab');
      await page.waitForTimeout(460);
    }
    if (!state.lock.movementLocked && patrolFaceTarget?.id) {
      // The enemy can move several metres while the player follows its cloned
      // adjacent-floor hint. If the hint itself was valid but Tab is now just
      // outside lock range, continue toward that same live target through the
      // normal collision-bound chase before abandoning this firing lane.
      const chaseBudget = Math.min(
        8_000,
        timeout - (Date.now() - started),
        Math.max(0, Math.min(timeout, patrolBudget) - (Date.now() - started)),
      );
      const chaseRadius = targetRadius <= BEAM_BLADE_APPROACH_RADIUS + 0.01
        ? BEAM_BLADE_REPOSITION_DISTANCE
        : targetRadius;
      if (chaseBudget > 0 && await chaseUnlockedEncounterTarget(
        page,
        encounterId,
        patrolFaceTarget.id,
        { stopDistance: chaseRadius, timeout: chaseBudget },
      )) return;
      state = await readPublicV1JourneyState(page, { includeGeometry: false });
    }
    if (state.lock.movementLocked && patrolAcquired
      && await approachRetainedLockTarget(
        page,
        encounterId,
        targetRadius,
        timeout - (Date.now() - started),
      )) return;

    if (!state.lock.movementLocked && canUseUnlockedGuardBlade(state)) {
      if (patrolFaceTarget?.position) {
        await orientToward(page, patrolFaceTarget.position, { timeout: 4_000 }).catch(() => {});
      }
      return;
    }

    if (state.lock.movementLocked) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(360);
    }
  }

  if (encounterId === 'keycardGuard' || encounterId === 'enemyNest') {
    // Knockback and moving enemies can invalidate every cloned pyramid/Nest
    // patrol route before its target is reacquired. Return to the authoritative
    // outer combat loop for a fresh live snapshot; its real damage, timeout,
    // death, and encounter-clear checks remain the acceptance authority.
    return;
  }
  throw new Error(`Static authored patrol could not acquire ${encounterId}: ${lastFailure ?? 'no reachable patrol point'}`);
};

const selectMegaBuster = async (page) => {
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (
    (await readPublicV1JourneyState(page, { includeGeometry: false })).activeWeapon
  ), { timeout: 5_000 }).toMatchObject({ slotIndex: 0, type: 'busterArm' });
};

const selectBeamBlade = async (page) => {
  await page.keyboard.press('Digit2');
  await expect.poll(async () => (
    (await readPublicV1JourneyState(page, { includeGeometry: false })).activeWeapon
  ), { timeout: 5_000 }).toMatchObject({ slotIndex: 1, type: 'swordArm' });
};

const dodgeWithPublicInput = async (page, directionKey) => {
  await page.keyboard.down(directionKey);
  try {
    await page.keyboard.press('KeyQ');
    // The deterministic dodge action lasts 0.86 seconds and is invulnerable
    // for that full authored interval. Waiting for it prevents the next fire
    // press from being swallowed by its movement/control lock.
    await page.waitForTimeout(940);
  } finally {
    await page.keyboard.up(directionKey).catch(() => {});
  }
};

const clearPublicKeycardGuard = async (page, {
  timeout,
  combatPointer,
}) => {
  const started = Date.now();
  let lastDamageAt = started;
  let lastTotalHealth = Infinity;
  let bestTargetDistance = Infinity;
  let lastApproachProgressAt = started;
  let strafeKey = 'KeyD';
  let lastDodgeAt = 0;
  let approachSteps = 0;
  let lastState = null;

  await selectMegaBuster(page);
  while (Date.now() - started < timeout) {
    lastState = await readPublicV1JourneyState(page, { includeGeometry: false });
    const encounter = findById(lastState.encounters, 'keycardGuard');
    if (encounter.cleared) return lastState;
    if (lastState.player.dead || lastState.player.health <= 0) {
      throw new Error('Player died during public combat in keycardGuard.');
    }

    const enemies = liveEncounterEnemies(lastState, 'keycardGuard');
    if (!enemies.length) {
      await page.waitForTimeout(250);
      continue;
    }
    const totalHealth = enemies.reduce((sum, enemy) => sum + enemy.health, 0);
    if (totalHealth + 0.01 < lastTotalHealth) lastDamageAt = Date.now();
    lastTotalHealth = totalHealth;

    const lockedTarget = lockedEncounterEnemy(lastState, 'keycardGuard');
    const target = lockedTarget ?? [...enemies].sort((left, right) => (
      distance2d(left.position, lastState.player.position)
        + Math.abs(left.position.y - lastState.player.position.y) * 1.3
      - (distance2d(right.position, lastState.player.position)
        + Math.abs(right.position.y - lastState.player.position.y) * 1.3)
    ))[0];
    const targetDistance = distance2d(target.position, lastState.player.position);
    const targetHeight = target.position.y - lastState.player.position.y;
    if (targetDistance + 0.08 < bestTargetDistance) {
      bestTargetDistance = targetDistance;
      lastApproachProgressAt = Date.now();
    }

    const healthRatio = lastState.player.health / Math.max(1, lastState.player.maxHealth);
    if (healthRatio < 0.8 && Date.now() - lastDodgeAt > 3_600) {
      await dodgeWithPublicInput(page, strafeKey);
      strafeKey = strafeKey === 'KeyD' ? 'KeyA' : 'KeyD';
      lastDodgeAt = Date.now();
      continue;
    }

    if (!lockedTarget) {
      await orientToward(page, target.position, { timeout: 2_600 }).catch(() => {});
      // Tab remains the authoritative acquisition input. A short retry after
      // physically facing the nearest guard handles hit recovery consuming a
      // press without turning this into a private lock-on probe.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(300);
        const acquisition = await readPublicV1JourneyState(page, { includeGeometry: false });
        if (acquisition.lock.movementLocked
          && lockedEncounterEnemy(acquisition, 'keycardGuard')) break;
      }
    }

    const acquired = await readPublicV1JourneyState(page, { includeGeometry: false });
    const acquiredTarget = lockedEncounterEnemy(acquired, 'keycardGuard');
    const activeTarget = acquiredTarget ?? target;
    const activeDistance = distance2d(activeTarget.position, acquired.player.position);
    const activeHeight = activeTarget.position.y - acquired.player.position.y;
    const bladeRange = activeDistance <= 2.55 && Math.abs(activeHeight) <= 1.9;

    if (bladeRange) {
      await selectBeamBlade(page);
      await orientToward(page, activeTarget.position, { timeout: 2_000 }).catch(() => {});
      for (let strike = 0; strike < 3; strike += 1) {
        await page.mouse.click(combatPointer.x, combatPointer.y);
        await page.waitForTimeout(strike === 0 ? 930 : 980);
      }
      lastDamageAt = Date.now();
      bestTargetDistance = Infinity;
      continue;
    }

    await selectMegaBuster(page);
    await page.mouse.down({ button: 'left' });
    try {
      // Keep the normal Buster active while climbing the credential pyramid.
      // If a tier lip stops forward progress, the next step is a standard
      // forward jump—not a graph teleport or injected ledge state.
      const stalled = Date.now() - lastApproachProgressAt > 1_700
        || Date.now() - lastDamageAt > COMBAT_DAMAGE_WATCHDOG_MILLISECONDS;
      await page.keyboard.down('KeyW');
      try {
        if (stalled || Math.abs(activeHeight) > 1.9 || approachSteps % 4 === 3) {
          await page.keyboard.press('Space');
          await page.waitForTimeout(1_060);
        } else {
          await page.waitForTimeout(Math.min(620, Math.max(280, activeDistance * 52)));
        }
      } finally {
        await page.keyboard.up('KeyW').catch(() => {});
      }
    } finally {
      await page.mouse.up({ button: 'left' }).catch(() => {});
    }
    approachSteps += 1;
    if (targetDistance > MEGA_BUSTER_MAXIMUM_RANGE || Math.abs(targetHeight) > 2.6) {
      bestTargetDistance = Infinity;
      lastApproachProgressAt = Date.now();
    }
    await page.waitForTimeout(140);
  }

  throw new Error(`Public combat timed out in keycardGuard: ${JSON.stringify(lastState)}`);
};

export const clearPublicEncounter = async (page, encounterId, {
  timeout = 210_000,
  onRampMilestone = null,
} = {}) => {
  if (encounterId === 'keycardGuard') timeout = Math.max(timeout, 420_000);
  await triggerPublicEncounter(page, encounterId, timeout, onRampMilestone);
  const patrolState = await readPublicV1JourneyState(page);
  const patrolPoints = buildEncounterPatrolPoints(patrolState, encounterId);
  const patrolVisits = new Map();
  if (!patrolPoints.length) {
    throw new Error(`Encounter ${encounterId} has no clear authored floor patrol points.`);
  }
  const canvas = page.locator('canvas');
  const canvasBounds = await canvas.boundingBox();
  if (!canvasBounds) throw new Error('Public combat canvas has no visible bounds.');
  const combatPointer = {
    x: canvasBounds.x + canvasBounds.width * 0.5,
    y: canvasBounds.y + canvasBounds.height * 0.5,
  };
  await page.mouse.click(combatPointer.x, combatPointer.y);
  if (encounterId === 'keycardGuard') {
    try {
      return await clearPublicKeycardGuard(page, { timeout, combatPointer });
    } finally {
      await page.mouse.up({ button: 'left' }).catch(() => {});
      await releaseKeys(page, ['KeyW', 'KeyS', 'KeyA', 'KeyD']);
      const finalState = await readPublicDungeonPlayerJourneyState(page)
        .catch(() => null);
      if (finalState?.lock?.movementLocked) await page.keyboard.press('Tab').catch(() => {});
    }
  }
  await selectMegaBuster(page);

  const started = Date.now();
  let lastDamageAt = Date.now();
  let previousHealth = Infinity;
  let strafeKey = 'KeyD';
  let lastDefensiveDodgeAt = 0;
  let lastState = null;

  try {
    while (Date.now() - started < timeout) {
      lastState = await readPublicV1JourneyState(page, { includeGeometry: false });
      const encounter = findById(lastState.encounters, encounterId);
      if (encounter.cleared) return lastState;
      if (lastState.player.dead || lastState.player.health <= 0) {
        throw new Error(`Player died during public combat in ${encounterId}.`);
      }

      const enemies = liveEncounterEnemies(lastState, encounterId);
      if (!enemies.length) {
        await page.waitForTimeout(350);
        continue;
      }
      const totalHealth = enemies.reduce((sum, enemy) => sum + enemy.health, 0);
      if (totalHealth + 0.01 < previousHealth) lastDamageAt = Date.now();
      previousHealth = totalHealth;

      const lockedEnemy = lockedEncounterEnemy(lastState, encounterId);
      const target = lockedEnemy
        ?? [...enemies].sort((left, right) => (
          distance2d(left.position, lastState.player.position)
            + Math.abs(left.position.y - lastState.player.position.y) * 2
          - (distance2d(right.position, lastState.player.position)
            + Math.abs(right.position.y - lastState.player.position.y) * 2)
        ))[0];
      const targetDistance = target?.position
        ? distance2d(target.position, lastState.player.position)
        : Infinity;
      const targetHeight = target?.position
        ? target.position.y - lastState.player.position.y
        : Infinity;
      const healthRatio = lastState.player.health / Math.max(1, lastState.player.maxHealth);
      if (encounterId === 'keycardGuard'
        && healthRatio < 0.72
        && Date.now() - lastDefensiveDodgeAt > 4_200) {
        // The pyramid roster can attack throughout route replanning. Use the
        // player's normal invulnerable lateral dodge before committing to the
        // next pursuit or firing window instead of standing still until 35% HP.
        await dodgeWithPublicInput(page, strafeKey);
        strafeKey = strafeKey === 'KeyD' ? 'KeyA' : 'KeyD';
        lastDefensiveDodgeAt = Date.now();
        continue;
      }
      // A grounded enemy is not automatically a safe melee target. In the
      // Nest, railings and large bodies can block the final metre even while
      // the same enemy is plainly inside the starter Buster's authored range.
      // Only draw the blade when ordinary movement has already put the player
      // at contact distance; otherwise retain the ranged difficulty-one arm.
      const hasDamageStalled = Date.now() - lastDamageAt
        > COMBAT_DAMAGE_WATCHDOG_MILLISECONDS;
      const groundedTarget = Math.abs(targetHeight) <= 1.8;
      // A stalled grounded target is exactly when the ordinary Beam Blade is
      // useful: route into its real range and perform its public-input combo.
      // The previous negated watchdog could never select the blade after an
      // armored Nest target stopped taking reliable Buster damage.
      // The Nest's large pods and armored targets can defeat a stationary
      // Buster lane. After the real damage watchdog expires, close through
      // ordinary movement and use the starter Beam Blade rather than resetting
      // the watchdog without dealing damage. keycardGuard has its own combat
      // traversal routine above and remains excluded from this generic path.
      const forceBeamBladeFallback = hasDamageStalled
        && groundedTarget
        && encounterId !== 'keycardGuard';
      const useBeamBlade = groundedTarget
        && (forceBeamBladeFallback || targetDistance <= BEAM_BLADE_REPOSITION_DISTANCE);
      const needsReposition = shouldRepositionPublicCombatTarget({
        hasLockedEnemy: Boolean(lockedEnemy),
        movementLocked: lastState.lock.movementLocked,
        targetDistance,
        targetHeight,
        useBeamBlade,
        hasDamageStalled,
        forceBeamBladeFallback,
      });

      if (needsReposition) {
        // Acquire every new target with the starter Buster's authored 6.9 m
        // range, retain that real lock while closing distance, and only then
        // swap to the blade for a grounded strike. Acquiring grounded targets
        // with the 2.8 m blade profile spent most of the journey walking to a
        // moving enemy before Tab was even allowed to select it.
        await selectMegaBuster(page);
        // Both authored traversal arenas expect ordinary run-and-gun play.
        // Keep the selected Buster firing while collision-bound movement seeks
        // a better lane instead of granting every Nest target a long idle
        // patrol window; try/finally below always releases the mouse button.
        const attackWhileRepositioning = encounterId === 'keycardGuard'
          || encounterId === 'enemyNest';
        if (attackWhileRepositioning) await page.mouse.down({ button: 'left' });
        try {
          // The credential pyramid is an active combat traversal space. Keep
          // firing the ordinary Buster while walking its real floors instead
          // of granting every guard a long uncontested route-planning window.
          await routeIntoWeaponRange(
            page,
            encounterId,
            target,
            timeout - (Date.now() - started),
            hasDamageStalled
              ? Math.min(3.55, useBeamBlade
                ? BEAM_BLADE_APPROACH_RADIUS
                : MEGA_BUSTER_APPROACH_RADIUS)
              : useBeamBlade ? BEAM_BLADE_APPROACH_RADIUS : MEGA_BUSTER_APPROACH_RADIUS,
            patrolPoints,
            patrolVisits,
          );
        } finally {
          if (attackWhileRepositioning) await page.mouse.up({ button: 'left' }).catch(() => {});
        }
        const positioned = await readPublicV1JourneyState(page, { includeGeometry: false });
        if (!positioned.lock.movementLocked) {
          const unlockedTargets = liveEncounterEnemies(positioned, encounterId);
          const unlockedBladeTarget = (encounterId === 'keycardGuard'
            || (encounterId === 'enemyNest' && unlockedTargets.length === 1))
            ? unlockedTargets
              .filter((candidate) => (
                Math.abs(candidate.position.y - positioned.player.position.y) <= 1.8
              ))
              .sort((left, right) => (
                distance2d(left.position, positioned.player.position)
                - distance2d(right.position, positioned.player.position)
              ))[0]
            : null;
          const unlockedBladeDistance = unlockedBladeTarget?.position
            ? distance2d(unlockedBladeTarget.position, positioned.player.position)
            : Infinity;
          if (unlockedBladeDistance <= BEAM_BLADE_REPOSITION_DISTANCE) {
            let closeState = positioned;
            for (let attempt = 0; attempt < 6 && !closeState.lock.movementLocked; attempt += 1) {
              // At contact distance, acquire the guard before swinging so the
              // normal combat controller—not a stale diagnostic position—owns
              // aim while knockback and enemy sidesteps occur.
              await page.keyboard.press('Tab');
              await page.waitForTimeout(320);
              closeState = await readPublicV1JourneyState(page, { includeGeometry: false });
            }
            await selectBeamBlade(page);
            // Once real locomotion has reached the credential-pyramid melee
            // lane, finish a short ordinary blade sequence instead of
            // restarting the entire patrol search after every two swings.
            // Enemies remain free to move and retaliate; every strike is still
            // issued through the normal mouse input and authored recovery.
            for (let combo = 0; combo < 5; combo += 1) {
              const bladeState = await readPublicV1JourneyState(page, { includeGeometry: false });
              if (findById(bladeState.encounters, encounterId).cleared) return bladeState;
              const liveBladeTargets = liveEncounterEnemies(bladeState, encounterId);
              const nearbyTarget = lockedEncounterEnemy(bladeState, encounterId)
                ?? liveBladeTargets
                .filter((candidate) => (
                  Math.abs(candidate.position.y - bladeState.player.position.y) <= 1.8
                ))
                .sort((left, right) => (
                  distance2d(left.position, bladeState.player.position)
                  - distance2d(right.position, bladeState.player.position)
                ))[0];
              if (!nearbyTarget?.position
                || distance2d(nearbyTarget.position, bladeState.player.position) > 3.1) break;
              await orientToward(page, nearbyTarget.position, { timeout: 3_000 }).catch(() => {});
              await page.mouse.click(combatPointer.x, combatPointer.y);
              await page.waitForTimeout(930);
              await page.mouse.click(combatPointer.x, combatPointer.y);
              await page.waitForTimeout(980);
            }
            lastDamageAt = Date.now();
            continue;
          }
          await page.keyboard.press('Tab');
          await page.waitForTimeout(420);
        }
        // Do not reset the damage watchdog merely because a route/lock cycle
        // completed. Only a real enemy-health decrease above advances it; this
        // keeps a healthy final target in active pursuit rather than repeatedly
        // granting failed movement cycles a fresh no-damage window.
        continue;
      }

      if (!useBeamBlade && targetDistance > MEGA_BUSTER_MAXIMUM_RANGE) {
        throw new Error(`Movement lock retained an out-of-range ${encounterId} target.`);
      }

      if (targetDistance < (useBeamBlade
        ? BEAM_BLADE_RETREAT_DISTANCE
        : MEGA_BUSTER_RETREAT_DISTANCE)) {
        const healthRatio = lastState.player.health / Math.max(1, lastState.player.maxHealth);
        if (healthRatio < 0.35) {
          // Reserve a lateral dodge for actual danger. Routine rolls near an
          // open arena arch can eject the player onto exterior trim even when
          // health and barrier are full.
          await dodgeWithPublicInput(page, strafeKey);
          strafeKey = strafeKey === 'KeyD' ? 'KeyA' : 'KeyD';
          continue;
        }
      }

      if (useBeamBlade) {
        await selectBeamBlade(page);
        // Grounded V1 enemies move laterally enough to evade slow pulse travel.
        // The starter blade is ordinary difficulty-one equipment and its
        // authored 0.86 s opener/follow-up can resolve them at contact range.
        // Repeating after the real recovery window avoids the former 6.5 s
        // idle gap while still driving only normal attack clicks.
        await page.mouse.click(combatPointer.x, combatPointer.y);
        // The authored opener locks controls for 0.826 s. A click at 0.62 s
        // was explicitly cleared by CombatSystem's control-lock path and never
        // became the intended follow-up; 0.93 s is inside its combo grace.
        await page.waitForTimeout(930);
        await page.mouse.click(combatPointer.x, combatPointer.y);
        await page.waitForTimeout(980);
      } else {
        await selectMegaBuster(page);
        const defensiveStrafe = encounterId === 'keycardGuard' ? strafeKey : null;
        if (defensiveStrafe) await page.keyboard.down(defensiveStrafe);
        await page.mouse.down({ button: 'left' });
        try {
          // A longer stationary burst gives the non-homing starter pulses time
          // to intercept aerial enemies instead of moving their origin around
          // the target between every shot.
          await page.waitForTimeout(
            encounterId === 'keycardGuard' ? 3_200 : MEGA_BUSTER_BURST_MILLISECONDS,
          );
        } finally {
          await page.mouse.up({ button: 'left' }).catch(() => {});
          if (defensiveStrafe) await page.keyboard.up(defensiveStrafe).catch(() => {});
        }
        if (defensiveStrafe) strafeKey = strafeKey === 'KeyD' ? 'KeyA' : 'KeyD';
      }

      // Keep a valid firing position. Defensive movement is health-triggered
      // above rather than periodic, so a successful attack cannot roll the
      // player out through the encounter entrance.
      await page.waitForTimeout(120);
    }
  } finally {
    await page.mouse.up({ button: 'left' }).catch(() => {});
    await releaseKeys(page, ['KeyW', 'KeyS', 'KeyA', 'KeyD']);
    const finalState = await readPublicDungeonPlayerJourneyState(page).catch(() => null);
    if (finalState?.lock?.movementLocked) await page.keyboard.press('Tab').catch(() => {});
  }
  throw new Error(`Public combat timed out in ${encounterId}: ${JSON.stringify(lastState)}`);
};

export const findById = (entries, id) => {
  const match = entries.find((entry) => entry.id === id || entry.keycardId === id);
  if (!match) throw new Error(`Missing authored journey entity: ${id}`);
  return match;
};
