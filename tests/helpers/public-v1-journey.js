import { expect } from '@playwright/test';

const PLAYER_RADIUS = 0.42;
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
const CARDINAL_NEIGHBORS = Object.freeze([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]);

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
  return Math.abs(point.y - zone.position.y) <= zone.verticalHalfHeight + 1.43;
};

const doorContains = (point, door, radius = PLAYER_RADIUS) => {
  if (!door.closed) return false;
  const position = door.graphBlockingPosition ?? door.position;
  if (!position) return false;
  return Math.abs(point.x - position.x) <= door.collisionHalfWidth + radius
    && Math.abs(point.z - position.z) <= door.collisionHalfDepth + radius
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
  if (tile.surface !== 'industrialRamp'
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

  if (Math.abs(rise) <= groundedAllowance) {
    return {
      action: from.surface === 'industrialRamp' || to.surface === 'industrialRamp'
        ? 'ramp'
        : 'walk',
      rise,
      cost: 1 + Math.abs(rise) * 0.18,
    };
  }

  if (rise > 0 && rise <= MAXIMUM_DIRECTED_JUMP_RISE) {
    return { action: 'jump', rise, cost: 2.4 + rise };
  }

  if (rise > 0
    && rise <= MAXIMUM_LEDGE_CLIMB_RISE
    && (to.isPlatformingSurface || to.isLedgeSurface)) {
    return { action: 'ledge_climb', rise, cost: 4.2 + rise };
  }

  if (rise < 0 && Math.abs(rise) <= MAXIMUM_SAFE_DROP) {
    return { action: 'drop', rise, cost: 2.8 + Math.abs(rise) * 0.35 };
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
  for (const tile of state.floorTiles) {
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
  }
  return { nodes, columns };
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
  return candidates.find(({ score }) => score <= state.tileSize * 0.55)?.node ?? null;
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
      tile: {
        index: node.index,
        roomId: node.roomId,
        surface: node.surface,
        requiredTraversalAction: node.requiredTraversalAction,
      },
    });
    cursor = edge.nodeIndex;
  }
  reversed.push({
    point: start.point,
    action: 'start',
    rise: 0,
    tile: { index: start.index, roomId: start.roomId, surface: start.surface },
  });
  return reversed.reverse();
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

const orientToward = async (page, target, { timeout = 4_000 } = {}) => {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    const state = await readPublicV1JourneyState(page, { includeGeometry: false });
    last = steeringFor(state, target);
    if (Math.abs(last.turnError) <= 0.11) return last;
    await holdKeys(
      page,
      [turnKeyFor(last)],
      Math.min(145, Math.max(35, Math.abs(last.turnError) * 290)),
    );
  }
  throw new Error(`Could not face public route waypoint: ${JSON.stringify({ target, last })}`);
};

const walkToWaypoint = async (page, target, {
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
    const state = await readPublicV1JourneyState(page, { includeGeometry: false });
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
    if (Math.abs(last.turnError) > 0.14) {
      const angularError = Math.abs(last.turnError);
      if (angularError + 0.02 < bestTurnError) {
        bestTurnError = angularError;
        lastProgressAt = Date.now();
      }
      await holdKeys(
        page,
        [turnKeyFor(last)],
        Math.min(135, Math.max(32, Math.abs(last.turnError) * 260)),
      );
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
      && state.player.position.y < 0.65
      && (target.y ?? 0) < 0.65
      && detourCount < 3) {
      // V1's authored pyramid supports and arch feet are not all represented
      // by the high-level route grid. Take one short tank-control dogleg,
      // alternating sides on retries, then reorient to the same verified floor
      // waypoint. This is ordinary walking and remains fully collision bound.
      await holdKeys(page, [detourTurnKey], 420);
      await holdKeys(page, ['KeyW'], 620);
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
    await holdKeys(page, ['KeyW'], Math.min(260, Math.max(80, last.distance * 48)));
  }
  throw new Error(`Public-input walk timed out: ${JSON.stringify({ target, last })}`);
};

const performTraversalAction = async (page, step) => {
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
} = {}) => {
  const started = Date.now();
  let lastFailure = null;
  let lastRoute = null;
  let traversedActions = [];

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
        const liveBeforeStart = await readPublicV1JourneyState(page, { includeGeometry: false });
        if (distance2d(liveBeforeStart.player.position, route[0].point) > 0.78) {
          await walkToWaypoint(page, route[0].point, {
            stopDistance: 0.72,
            timeout: 90_000,
          });
        }
        for (const step of route.slice(1)) {
          if (Date.now() - started >= timeout) throw new Error('Overall public route timeout.');
          if (step.action === 'jump' || step.action === 'ledge_climb' || step.action === 'drop') {
            traversedActions.push(step.action);
            await performTraversalAction(page, step);
          }
          await walkToWaypoint(page, step.point, {
            // V1 floor nodes are 2.8m apart, but pillars, arch feet, pedestals,
            // and rail posts can make an otherwise connected tile center
            // physically unoccupiable. Crossing within 2.05m of an
            // intermediate center still advances into the same cardinal cell
            // without skipping the next traversal edge.
            stopDistance: step === route.at(-1) ? stopDistance : 2.05,
            timeout: step.action === 'ledge_climb' ? 60_000 : 90_000,
          });
        }
        return { route, traversedActions, replans: attempt };
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
    lastRoute,
    reason: lastFailure?.message ?? String(lastFailure),
  })}`);
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

const triggerPublicEncounter = async (page, encounterId, timeout) => {
  let state = await readPublicV1JourneyState(page);
  let encounter = findById(state.encounters, encounterId);
  if (encounter.cleared || encounter.spawned) return encounter;
  const zone = encounterGoalZone(encounter);
  await followPublicFloorRoute(page, zone.position, {
    targetRadius: Math.max(zone.halfWidth, zone.halfDepth),
    maximumTargetVerticalDifference: (zone.verticalHalfHeight ?? 2) + 1.2,
    goalZone: zone,
    stopDistance: 0.8,
    timeout: Math.min(timeout, 150_000),
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

const approachRetainedLockTarget = async (
  page,
  encounterId,
  targetRadius,
  timeout,
) => {
  const started = Date.now();
  let bestDistance = Infinity;
  let lastProgressAt = Date.now();
  let strafeKey = 'KeyD';
  let last = null;

  while (Date.now() - started < Math.min(timeout, 12_000)) {
    const state = await readPublicV1JourneyState(page, { includeGeometry: false });
    const encounter = findById(state.encounters, encounterId);
    if (encounter.cleared) return true;
    const enemies = liveEncounterEnemies(state, encounterId);
    const target = enemies.find(({ id }) => id === state.lock.ownerEnemyId);
    if (!state.lock.movementLocked || !target?.position) return false;

    const distance = distance2d(state.player.position, target.position);
    last = {
      targetId: target.id,
      distance,
      player: state.player.position,
      target: target.position,
    };
    if (distance <= targetRadius) return true;
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
  let state = await readPublicV1JourneyState(page, { includeGeometry: false });
  const retainedEnemy = liveEncounterEnemies(state, encounterId)
    .find(({ id }) => id === state.lock.ownerEnemyId);
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
    const acquireInPlaceWindow = encounterId === 'enemyNest'
      ? 45_000
      : encounterId === 'keycardGuard' ? 20_000 : 5_500;
    const visibleTarget = liveEncounterEnemies(state, encounterId)
      .find(({ id }) => id === enemy?.id)
      ?? liveEncounterEnemies(state, encounterId)[0];
    if (visibleTarget?.position) {
      await orientToward(page, visibleTarget.position, { timeout: 4_000 }).catch(() => {});
    }
    while (Date.now() - acquireInPlaceStarted < acquireInPlaceWindow) {
      state = await readPublicV1JourneyState(page, { includeGeometry: false });
      const acquiredHere = liveEncounterEnemies(state, encounterId)
        .find(({ id }) => id === state.lock.ownerEnemyId);
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
  }

  // Static patrol routes use tank controls, so release a retained target that
  // could not be approached through the room's real collision in twelve
  // seconds. The next destination is an authored floor node, never a moving
  // enemy coordinate.
  const lockReleaseStarted = Date.now();
  while (state.lock.movementLocked && Date.now() - lockReleaseStarted < 6_000) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(360);
    state = await readPublicV1JourneyState(page, { includeGeometry: false });
  }
  if (state.lock.movementLocked) throw new Error(`Could not release stale movement lock for ${encounterId}.`);

  if (!patrolPoints.length) throw new Error(`No static authored patrol points for ${encounterId}.`);
  const attempted = new Set();
  let lastFailure = null;
  while (Date.now() - started < Math.min(timeout, 75_000)) {
    state = await readPublicV1JourneyState(page, { includeGeometry: false });
    const enemies = liveEncounterEnemies(state, encounterId);
    if (!enemies.length || findById(state.encounters, encounterId).cleared) return;
    const preferred = enemies.find(({ id }) => id === enemy?.id) ?? enemies[0];
    const candidates = patrolPoints
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
    const next = candidates[0]?.patrol;
    if (!next) break;
    attempted.add(next.id);
    patrolVisits.set(next.id, (patrolVisits.get(next.id) ?? 0) + 1);

    try {
      await followPublicFloorRoute(page, next.point, {
        targetRadius: state.tileSize * 0.42,
        maximumTargetVerticalDifference: 0.55,
        stopDistance: 0.72,
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
      patrolAcquired = liveEncounterEnemies(state, encounterId)
        .some(({ id }) => id === state.lock.ownerEnemyId);
      if (state.lock.movementLocked && patrolAcquired) break;
      if (state.player.ledgeClinging || state.player.jumpState !== 'Grounded') {
        await page.waitForTimeout(320);
        continue;
      }
      await page.keyboard.press('Tab');
      await page.waitForTimeout(460);
    }
    if (state.lock.movementLocked && patrolAcquired
      && await approachRetainedLockTarget(
        page,
        encounterId,
        targetRadius,
        timeout - (Date.now() - started),
      )) return;

    if (state.lock.movementLocked) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(360);
    }
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

export const clearPublicEncounter = async (page, encounterId, {
  timeout = 210_000,
} = {}) => {
  await triggerPublicEncounter(page, encounterId, timeout);
  const patrolState = await readPublicV1JourneyState(page);
  const patrolPoints = buildEncounterPatrolPoints(patrolState, encounterId);
  const patrolVisits = new Map();
  if (!patrolPoints.length) {
    throw new Error(`Encounter ${encounterId} has no clear authored floor patrol points.`);
  }
  const canvas = page.locator('canvas');
  await canvas.click({ position: { x: 520, y: 340 } });
  await selectMegaBuster(page);

  const started = Date.now();
  let lastDamageAt = Date.now();
  let previousHealth = Infinity;
  let strafeKey = 'KeyD';
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

      const lockedEnemy = enemies.find(({ id }) => id === lastState.lock.ownerEnemyId);
      const target = lockedEnemy
        ?? [...enemies].sort((left, right) => (
          distance2d(left.position, lastState.player.position)
          - distance2d(right.position, lastState.player.position)
        ))[0];
      const targetDistance = target?.position
        ? distance2d(target.position, lastState.player.position)
        : Infinity;
      const targetHeight = target?.position
        ? target.position.y - lastState.player.position.y
        : Infinity;
      // A grounded enemy is not automatically a safe melee target. In the
      // Nest, railings and large bodies can block the final metre even while
      // the same enemy is plainly inside the starter Buster's authored range.
      // Only draw the blade when ordinary movement has already put the player
      // at contact distance; otherwise retain the ranged difficulty-one arm.
      const hasDamageStalled = Date.now() - lastDamageAt
        > COMBAT_DAMAGE_WATCHDOG_MILLISECONDS;
      const useBeamBlade = !hasDamageStalled
        && Math.abs(targetHeight) <= 1.8
        && targetDistance <= BEAM_BLADE_REPOSITION_DISTANCE;
      const needsReposition = !lockedEnemy
        || !lastState.lock.movementLocked
        || targetDistance > (useBeamBlade
          ? BEAM_BLADE_REPOSITION_DISTANCE
          : MEGA_BUSTER_REPOSITION_DISTANCE)
        || hasDamageStalled;

      if (needsReposition) {
        // Acquire every new target with the starter Buster's authored 6.9 m
        // range, retain that real lock while closing distance, and only then
        // swap to the blade for a grounded strike. Acquiring grounded targets
        // with the 2.8 m blade profile spent most of the journey walking to a
        // moving enemy before Tab was even allowed to select it.
        await selectMegaBuster(page);
        await routeIntoWeaponRange(
          page,
          encounterId,
          target,
          timeout - (Date.now() - started),
          hasDamageStalled && encounterId !== 'enemyNest'
            ? Math.min(3.55, useBeamBlade
              ? BEAM_BLADE_APPROACH_RADIUS
              : MEGA_BUSTER_APPROACH_RADIUS)
            : useBeamBlade ? BEAM_BLADE_APPROACH_RADIUS : MEGA_BUSTER_APPROACH_RADIUS,
          patrolPoints,
          patrolVisits,
        );
        const positioned = await readPublicV1JourneyState(page, { includeGeometry: false });
        if (!positioned.lock.movementLocked) {
          await page.keyboard.press('Tab');
          await page.waitForTimeout(420);
        }
        // A route/lock cycle gets one real firing window before the damage
        // watchdog decides that a wall or moving target invalidated the shot.
        lastDamageAt = Date.now();
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
        await page.mouse.click(520, 340);
        // The authored opener locks controls for 0.826 s. A click at 0.62 s
        // was explicitly cleared by CombatSystem's control-lock path and never
        // became the intended follow-up; 0.93 s is inside its combo grace.
        await page.waitForTimeout(930);
        await page.mouse.click(520, 340);
        await page.waitForTimeout(980);
      } else {
        await selectMegaBuster(page);
        await page.mouse.down({ button: 'left' });
        try {
          // A longer stationary burst gives the non-homing starter pulses time
          // to intercept aerial enemies instead of moving their origin around
          // the target between every shot.
          await page.waitForTimeout(MEGA_BUSTER_BURST_MILLISECONDS);
        } finally {
          await page.mouse.up({ button: 'left' }).catch(() => {});
        }
      }

      // Keep a valid firing position. Defensive movement is health-triggered
      // above rather than periodic, so a successful attack cannot roll the
      // player out through the encounter entrance.
      await page.waitForTimeout(120);
    }
  } finally {
    await page.mouse.up({ button: 'left' }).catch(() => {});
    await releaseKeys(page, ['KeyW', 'KeyS', 'KeyA', 'KeyD']);
    const finalState = await readPublicV1JourneyState(page, { includeGeometry: false }).catch(() => null);
    if (finalState?.lock?.movementLocked) await page.keyboard.press('Tab').catch(() => {});
  }
  throw new Error(`Public combat timed out in ${encounterId}: ${JSON.stringify(lastState)}`);
};

export const findById = (entries, id) => {
  const match = entries.find((entry) => entry.id === id || entry.keycardId === id);
  if (!match) throw new Error(`Missing authored journey entity: ${id}`);
  return match;
};
