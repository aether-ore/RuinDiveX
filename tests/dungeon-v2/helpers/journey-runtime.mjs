import { expect } from '@playwright/test';

export const PUBLIC_INPUT_JOURNEY = true;
export const DIAGNOSTICS_BRIDGE = '__RUINDIVEX_V2_DIAGNOSTICS__';
const PERFORMANCE_RAF_PROBE = '__RUINDIVEX_V2_PERFORMANCE_RAF_PROBE__';

export async function readV2Diagnostics(page, profile = 'runtime') {
  expect(['movement', 'navigation', 'runtime', 'full']).toContain(profile);
  const snapshot = await page.evaluate(({ bridgeName, profile: requestedProfile }) => {
    const bridge = window[bridgeName];
    if (!bridge || typeof bridge.snapshot !== 'function') return null;
    return bridge.snapshot({ profile: requestedProfile });
  }, { bridgeName: DIAGNOSTICS_BRIDGE, profile });
  if (snapshot !== null) {
    expect(Object.isFrozen(snapshot)).toBe(false);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  }
  return snapshot;
}

export async function armV2PublicInputHeartbeat(page, codes, {
  timeout = 1_000,
} = {}) {
  return page.evaluateHandle(({ bridgeName, expectedCodes, timeoutMs }) => {
    const result = new Promise((resolve, reject) => {
      const expected = new Set(expectedCodes);
      const observed = new Set();
      let initial = null;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        window.removeEventListener('keydown', observeKeydown, true);
        callback(value);
      };
      const observe = () => {
        if (settled || initial === null) return;
        const bridge = window[bridgeName];
        const heartbeat = Number(bridge?.heartbeat?.());
        if (!Number.isFinite(heartbeat)) {
          finish(reject, new Error('V2 frame heartbeat disappeared during public input.'));
          return;
        }
        if (heartbeat === initial + 1) {
          finish(resolve, heartbeat);
          return;
        }
        if (heartbeat > initial + 1) {
          finish(reject, new Error(`V2 frame heartbeat skipped from ${initial} to ${heartbeat} during public input.`));
          return;
        }
        if (heartbeat < initial) {
          finish(reject, new Error(`V2 frame heartbeat regressed from ${initial} to ${heartbeat} during public input.`));
          return;
        }
        requestAnimationFrame(observe);
      };
      const observeKeydown = (event) => {
        if (!expected.has(event.code)) return;
        observed.add(event.code);
        if (initial !== null || observed.size !== expected.size) return;
        const bridge = window[bridgeName];
        initial = Number(bridge?.heartbeat?.());
        if (!Number.isFinite(initial)) {
          finish(reject, new Error('V2 diagnostics bridge does not expose a finite read-only heartbeat.'));
          return;
        }
        requestAnimationFrame(observe);
      };
      const timeoutId = setTimeout(() => {
        const detail = initial === null
          ? `public keydown was not observed for ${[...expected].join('+')}`
          : `V2 frame heartbeat stalled at ${initial} during public input`;
        finish(reject, new Error(`${detail}.`));
      }, timeoutMs);
      window.addEventListener('keydown', observeKeydown, true);
    });
    return Object.freeze({ result });
  }, {
    bridgeName: DIAGNOSTICS_BRIDGE,
    expectedCodes: [...new Set(codes ?? [])],
    timeoutMs: timeout,
  });
}

export async function waitForV2HeartbeatIncrement(observer) {
  return observer.evaluate((state) => state.result);
}

export async function startV2PerformanceFrameProbe(page) {
  await page.evaluate((probeName) => {
    const state = {
      active: true,
      frameCount: 0,
      firstFrameAt: null,
      lastFrameAt: null,
      maximumGapMs: 0,
    };
    Object.defineProperty(window, probeName, {
      configurable: true,
      enumerable: false,
      value: state,
    });
    const observeFrame = (timestamp) => {
      if (!state.active) return;
      if (state.lastFrameAt !== null) {
        state.maximumGapMs = Math.max(state.maximumGapMs, timestamp - state.lastFrameAt);
      } else {
        state.firstFrameAt = timestamp;
      }
      state.lastFrameAt = timestamp;
      state.frameCount += 1;
      requestAnimationFrame(observeFrame);
    };
    requestAnimationFrame(observeFrame);
  }, PERFORMANCE_RAF_PROBE);
}

export async function stopV2PerformanceFrameProbe(page) {
  return page.evaluate((probeName) => {
    const state = window[probeName];
    if (!state) return null;
    state.active = false;
    return {
      frameCount: state.frameCount,
      elapsedMs: state.firstFrameAt === null || state.lastFrameAt === null
        ? 0
        : state.lastFrameAt - state.firstFrameAt,
      maximumGapMs: state.maximumGapMs,
    };
  }, PERFORMANCE_RAF_PROBE);
}

async function readV2StartupFailure(page) {
  const panel = page.locator('#dungeon-v2-generation-error');
  if (await panel.count() === 0) return null;
  const text = await panel.textContent();
  const serialized = text?.replace(/^Dungeon Generation V2 rejected\s*/, '') ?? '';
  try {
    const diagnostic = JSON.parse(serialized);
    return {
      code: diagnostic.code ?? 'DUNGEON_V2_CONSTRUCTION_FAILED',
      message: diagnostic.message ?? 'Dungeon V2 construction failed.',
    };
  } catch {
    return {
      code: await page.locator('body').getAttribute('data-dungeon-v2-failure')
        ?? 'DUNGEON_V2_CONSTRUCTION_FAILED',
      message: 'Dungeon V2 construction failed without serializable diagnostics.',
    };
  }
}

export async function waitForV2Runtime(page) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const failure = await readV2StartupFailure(page);
    if (failure) {
      throw new Error(`Dungeon V2 startup rejected [${failure.code}]: ${failure.message}`);
    }
    const diagnostics = await readV2Diagnostics(page, 'movement');
    if ((diagnostics?.frameHeartbeat ?? 0) > 2) return diagnostics;
    await page.waitForTimeout(50);
  }
  throw new Error('V2 frame heartbeat did not advance within 20000ms.');
}

export async function holdPublicInput(page, code, milliseconds) {
  await page.keyboard.down(code);
  await page.waitForTimeout(milliseconds);
  await page.keyboard.up(code);
}

async function holdPublicInputs(page, codes, milliseconds) {
  for (const code of codes) await page.keyboard.down(code);
  try {
    await page.waitForTimeout(milliseconds);
  } finally {
    for (const code of [...codes].reverse()) await page.keyboard.up(code);
  }
}

export async function holdPublicInputsForOneHeartbeat(page, codes, {
  timeout = 1_000,
  armHeartbeat = armV2PublicInputHeartbeat,
  waitForIncrement = waitForV2HeartbeatIncrement,
} = {}) {
  const uniqueCodes = [...new Set(codes ?? [])];
  if (uniqueCodes.length === 0) throw new Error('A frame-synchronized public input requires a key.');
  const observer = await armHeartbeat(page, uniqueCodes, { timeout });
  try {
    for (const code of uniqueCodes) await page.keyboard.down(code);
    return await waitForIncrement(observer);
  } catch (error) {
    let diagnostics = null;
    try {
      diagnostics = await readV2Diagnostics(page, 'movement');
    } catch {
      // Preserve the original heartbeat failure when the page itself no longer
      // responds. A responsive page supplies the last completed-frame profile.
    }
    if (diagnostics?.performance) {
      const evidence = {
        gameFrameHeartbeat: diagnostics.performance.gameFrameHeartbeat,
        frame: diagnostics.performance.frame,
        platformQueries: diagnostics.performance.platformQueries,
        platformSurfaceCount: diagnostics.performance.platformSurfaceCount,
        platformLedgeCandidateCount: diagnostics.performance.platformLedgeCandidateCount,
        renderer: diagnostics.performance.renderer,
      };
      error.message = `${error.message} Last completed-frame evidence: ${JSON.stringify(evidence)}`;
    }
    throw error;
  } finally {
    for (const code of [...uniqueCodes].reverse()) await page.keyboard.up(code);
    await observer.dispose?.();
  }
}

export async function tapPublicInputBurst(page, codes, {
  delay = 160,
} = {}) {
  const uniqueCodes = [...new Set(codes ?? [])];
  if (uniqueCodes.length === 0) throw new Error('A bounded public input burst requires a key.');
  if (!Number.isFinite(delay) || delay < 0 || delay > 200) {
    throw new Error(`A bounded public input burst delay must be between 0 and 200ms; received ${delay}.`);
  }
  // keyboard.press owns keydown and keyup inside one Playwright operation.
  // That keeps the physical key lifetime bounded by `delay`, even if the
  // renderer or the diagnostics round trip is heavily loaded. Sending the
  // keys sequentially also prevents a turn correction from dragging forward
  // along the previous heading for several metres.
  for (const code of uniqueCodes) {
    await page.keyboard.press(code, { delay });
  }
  return Object.freeze({ codes: uniqueCodes, delay });
}

async function fireWhileHoldingPublicInputs(page, codes, milliseconds) {
  for (const code of codes) await page.keyboard.down(code);
  await page.mouse.down({ button: 'left' });
  try {
    await page.waitForTimeout(milliseconds);
  } finally {
    await page.mouse.up({ button: 'left' });
    for (const code of [...codes].reverse()) await page.keyboard.up(code);
  }
}

export async function interact(page) {
  await page.keyboard.press('KeyE');
}

export async function attack(page) {
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(90);
  await page.mouse.up({ button: 'left' });
}

export function getPublicActionApproachPoints(action, playerPosition) {
  if (!action?.position) throw new Error('A public action approach requires a physical action anchor.');
  const radius = Math.max(0.8, Number(action.radius) || 2);
  const activationSide = action.activationSide;
  const forward = typeof activationSide === 'object' && activationSide !== null
    ? activationSide
    : action.forward ?? { x: 0, y: 0, z: 1 };
  const eitherSide = action.activationSide === 'either' || action.activationSide === 'any';
  const playerSideX = Number(playerPosition?.x) - Number(action.position.x);
  const playerSideZ = Number(playerPosition?.z) - Number(action.position.z);
  const playerSideLength = Math.hypot(playerSideX, playerSideZ);
  const sideMultiplier = activationSide === 'back' ? -1 : 1;
  const direction = eitherSide && playerSideLength > 0.05
    ? { x: playerSideX / playerSideLength, z: playerSideZ / playerSideLength }
    : {
        x: (Number(forward.x) || 0) * sideMultiplier,
        z: (Number(forward.z) || 0) * sideMultiplier,
      };
  const approachDistance = Math.min(1.15, radius * 0.55);
  const stagingDistance = Math.min(1.8, Math.max(1.35, radius * 0.82));
  return {
    eitherSide,
    approach: {
      x: action.position.x + direction.x * approachDistance,
      y: action.position.y,
      z: action.position.z + direction.z * approachDistance,
    },
    staging: {
      x: action.position.x + direction.x * stagingDistance,
      y: action.position.y,
      z: action.position.z + direction.z * stagingDistance,
    },
  };
}

function signedYawDelta(currentYaw, desiredYaw) {
  let delta = desiredYaw - currentYaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function selectEncounterCombatTarget(
  diagnostics,
  encounterId,
  preferredEnemyId = null,
  { preferGroundBeforeRaisedTraversal = false } = {},
) {
  const enemies = (diagnostics?.activeEnemies ?? []).filter((enemy) => (
    enemy.encounterId === encounterId
  ));
  const playerPosition = diagnostics?.playerPosition;
  if (!playerPosition) return { enemies, target: null, totalEnemyHealth: Infinity };
  const positionedEnemies = enemies
    .filter((enemy) => enemy.position)
    .map((enemy) => ({
      enemy,
      horizontalDistance: Math.hypot(
        enemy.position.x - playerPosition.x,
        enemy.position.z - playerPosition.z,
      ),
      verticalDistance: Math.abs(enemy.position.y - playerPosition.y),
    }))
    .sort((a, b) => a.horizontalDistance - b.horizontalDistance);
  const locked = positionedEnemies.find(({ enemy }) => (
    diagnostics.lockOnTargetId === enemy.id
    || diagnostics.lockOnTargetId?.startsWith(`${enemy.id}:`)
  ));
  const preferred = positionedEnemies.find(({ enemy }) => enemy.id === preferredEnemyId);
  const groundClearanceTarget = preferGroundBeforeRaisedTraversal
    ? positionedEnemies.find(({ verticalDistance }) => verticalDistance <= 1.35)
    : null;
  return {
    enemies,
    target: locked ?? preferred ?? groundClearanceTarget ?? positionedEnemies[0] ?? null,
    totalEnemyHealth: enemies.reduce((sum, enemy) => sum + Math.max(0, enemy.health ?? 0), 0),
  };
}

export function publicCombatLaneNeedsClearance(
  target,
  secondsWithoutDamage,
  secondsSinceClearance = Infinity,
) {
  if (!target) return false;
  const clearanceReady = secondsSinceClearance > 1.5;
  return clearanceReady && (
    target.horizontalDistance < 3.4
    || (target.verticalDistance > 1.35 && target.horizontalDistance < 5.2)
    || (secondsWithoutDamage > 4.5 && secondsSinceClearance > 3)
  );
}

export function getPreRaisedGroundClearanceAction(diagnostics, target, enemies) {
  const playerY = diagnostics?.playerPosition?.y;
  if (!target || !Number.isFinite(playerY)
    || target.verticalDistance > 1.35
    || !(enemies ?? []).some((enemy) => (
      Number.isFinite(enemy.position?.y) && enemy.position.y - playerY > 1.35
    ))) return null;
  // A retained lock is player-owned and intentionally survives range loss.
  // It is therefore not evidence that a starter-Buster shot can still reach
  // the enemy. Hand an out-of-range retained target back to the ordinary
  // combat movement policy so the public player can close the distance.
  if (diagnostics.lockOnTargetId) {
    return target.horizontalDistance <= 6.7 ? 'fire' : null;
  }
  return target.horizontalDistance <= 6.7 ? 'lock' : 'wait';
}

export function selectPlanOwnedGroundEngagementAdvance({
  navigation,
  encounterId,
  target,
  playerPosition,
  lockRangeMargin = 0.25,
} = {}) {
  const enemy = target?.enemy;
  if (!navigation || typeof encounterId !== 'string' || !encounterId
    || !enemy?.position || enemy.encounterId !== encounterId
    || !Number.isInteger(enemy.planOwnedSpawnPointIndex)
    || !playerPosition || target.verticalDistance > 1.35) {
    return null;
  }
  const encounter = navigation.encounters?.find((entry) => entry.encounterId === encounterId);
  const matchingEngagements = (encounter?.entryEngagementContracts ?? []).filter((entry) => (
    entry.spawnPointIndex === enemy.planOwnedSpawnPointIndex
  ));
  if (matchingEngagements.length !== 1) return null;
  const engagement = matchingEngagements[0];
  if (typeof engagement.id !== 'string' || !engagement.id
    || typeof engagement.sourceTraversalLinkId !== 'string'
    || typeof engagement.surfaceId !== 'string'
    || engagement.sameLevel !== true
    || engagement.unobstructed !== true) {
    return null;
  }
  const link = navigation.traversalLinks?.find(({ id }) => (
    id === engagement.sourceTraversalLinkId
  ));
  const rejoin = link?.approachContract?.combatRejoin;
  if (!link || link.regionId !== encounter.regionId
    || !rejoin || typeof rejoin.id !== 'string' || !rejoin.id
    || rejoin.encounterId !== encounterId
    || rejoin.engagementId !== engagement.id
    || rejoin.surfaceId !== engagement.surfaceId
    || (rejoin.surfaceIds ?? [rejoin.surfaceId]).length
      !== (engagement.surfaceIds ?? [engagement.surfaceId]).length
    || !(rejoin.surfaceIds ?? [rejoin.surfaceId]).every((surfaceId, index) => (
      surfaceId === (engagement.surfaceIds ?? [engagement.surfaceId])[index]
    ))) {
    return null;
  }
  const start = rejoin.segmentStart;
  const end = rejoin.segmentEnd;
  const capsuleRadius = Number(rejoin.capsuleRadius);
  const capsuleHeight = Number(rejoin.capsuleHeight);
  const sampleSpacing = Number(rejoin.sampleSpacing);
  const maximumLateralOffset = Number(rejoin.maximumLateralOffset);
  const minimumProgress = Number(rejoin.minimumProgress);
  const maximumProgress = Number(rejoin.maximumProgress);
  const maximumEngagementRange = Number(engagement.maximumEngagementRange);
  const engagementCapsuleRadius = Number(engagement.capsuleRadius);
  const engagementCapsuleHeight = Number(engagement.capsuleHeight);
  const engagementSampleSpacing = Number(engagement.sampleSpacing);
  if (![capsuleRadius, capsuleHeight, sampleSpacing, maximumLateralOffset,
    minimumProgress, maximumProgress, maximumEngagementRange, lockRangeMargin,
    engagementCapsuleRadius, engagementCapsuleHeight, engagementSampleSpacing]
    .every(Number.isFinite)
    || !start || !end
    || capsuleRadius <= 0 || capsuleHeight < 3.2 || sampleSpacing <= 0
    || maximumLateralOffset < 0 || minimumProgress < 0 || maximumProgress > 1
    || maximumProgress <= minimumProgress || maximumEngagementRange <= lockRangeMargin) {
    return null;
  }
  if (Math.abs(engagementCapsuleRadius - capsuleRadius) > 0.001
    || Math.abs(engagementCapsuleHeight - capsuleHeight) > 0.001
    || engagementSampleSpacing + 0.001 < sampleSpacing) {
    return null;
  }
  const surfaces = (rejoin.surfaceIds ?? [rejoin.surfaceId]).map((surfaceId) => (
    link.approachSurfaces?.find(({ id }) => id === surfaceId)
  ));
  const boundsList = surfaces.map((surface) => surface?.bounds);
  if (surfaces.some((surface) => !surface)
    || boundsList.some((bounds) => !bounds?.min || !bounds?.max)) return null;
  const waypoints = Array.isArray(rejoin.waypoints) && rejoin.waypoints.length >= 2
    ? rejoin.waypoints
    : [start, end];
  const segments = [];
  let totalLength = 0;
  for (let index = 1; index < waypoints.length; index += 1) {
    const segmentStart = waypoints[index - 1];
    const segmentEnd = waypoints[index];
    const deltaX = segmentEnd.x - segmentStart.x;
    const deltaZ = segmentEnd.z - segmentStart.z;
    const length = Math.hypot(deltaX, deltaZ);
    if (!Number.isFinite(length) || length <= 0.05) return null;
    segments.push({ segmentStart, segmentEnd, deltaX, deltaZ, length, startDistance: totalLength });
    totalLength += length;
  }
  const supportSamples = [];
  for (const [segmentIndex, segment] of segments.entries()) {
    const sampleCount = Math.max(1, Math.ceil(segment.length / sampleSpacing));
    for (let index = segmentIndex === 0 ? 0 : 1; index <= sampleCount; index += 1) {
      const segmentProgress = index / sampleCount;
      const position = {
        x: segment.segmentStart.x + segment.deltaX * segmentProgress,
        y: segment.segmentStart.y
          + (segment.segmentEnd.y - segment.segmentStart.y) * segmentProgress,
        z: segment.segmentStart.z + segment.deltaZ * segmentProgress,
      };
      if (!capsuleFootprintWithinBoundsUnion(position, boundsList, capsuleRadius)) return null;
      supportSamples.push({
        progress: (segment.startDistance + segment.length * segmentProgress) / totalLength,
        position,
      });
    }
  }
  let playerProgress = null;
  let bestLateralOffset = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const lengthSquared = segment.length * segment.length;
    const localProgress = (
      (playerPosition.x - segment.segmentStart.x) * segment.deltaX
        + (playerPosition.z - segment.segmentStart.z) * segment.deltaZ
    ) / lengthSquared;
    if (localProgress < -0.001 || localProgress > 1.001) continue;
    const projected = {
      x: segment.segmentStart.x + segment.deltaX * localProgress,
      z: segment.segmentStart.z + segment.deltaZ * localProgress,
    };
    const lateralOffset = Math.hypot(
      playerPosition.x - projected.x,
      playerPosition.z - projected.z,
    );
    if (lateralOffset < bestLateralOffset) {
      bestLateralOffset = lateralOffset;
      playerProgress = (
        segment.startDistance + segment.length * Math.max(0, Math.min(1, localProgress))
      ) / totalLength;
    }
  }
  if (Math.abs(playerPosition.y - start.y) > 0.2
    || !Number.isFinite(playerProgress)
    || playerProgress < minimumProgress - 0.001
    || playerProgress > maximumProgress + 0.001
    || bestLateralOffset > maximumLateralOffset + 0.001
    || !capsuleFootprintWithinBoundsUnion(playerPosition, boundsList, capsuleRadius)) return null;
  const requiredRange = maximumEngagementRange - lockRangeMargin;
  const destination = supportSamples.find(({ progress, position }) => (
    progress > playerProgress + 0.001
    && progress >= minimumProgress
    && progress <= maximumProgress
    && Math.hypot(
      enemy.position.x - position.x,
      enemy.position.z - position.z,
    ) <= requiredRange
  ));
  if (!destination) return null;
  return {
    encounterId,
    engagementId: engagement.id,
    traversalLinkId: link.id,
    combatRejoinId: rejoin.id,
    surfaceId: rejoin.surfaceId,
    surfaceIds: rejoin.surfaceIds ?? [rejoin.surfaceId],
    position: { ...destination.position },
    sampleSpacing,
    capsuleRadius,
    capsuleHeight,
    maximumEngagementRange,
    supportSamples,
  };
}

const RAISED_COMBAT_TRAVERSAL_MODES = new Set([
  'walkable-stairs',
  'stairs',
  'ladder',
]);
const RAISED_COMBAT_PURPOSE_PATTERN = /(?:exploration|catwalk|arena|inspection|combat|machinery)/i;
const NON_COMBAT_PERCH_PURPOSE_PATTERN = /(?:connector|exit|landing\s+for\s+portal|portal\.)/i;

function navigationSurfaceCenter(surface) {
  const bounds = surface?.bounds;
  if (!bounds?.min || !bounds?.max) return null;
  return {
    x: (bounds.min.x + bounds.max.x) * 0.5,
    y: Number.isFinite(surface.topY) ? surface.topY : bounds.max.y,
    z: (bounds.min.z + bounds.max.z) * 0.5,
  };
}

/**
 * Selects an authored, currently unconditional route to a firing surface near
 * an elevated retained target. This is deliberately plan-owned: combat tests
 * may walk stairs or a ladder a player can see, but may not invent a perch or
 * move the player to one through diagnostics.
 */
export function selectRaisedCombatTraversalLink(diagnostics, target) {
  const playerPosition = diagnostics?.playerPosition;
  const targetPosition = target?.enemy?.position;
  if (!playerPosition || !targetPosition
    || targetPosition.y - playerPosition.y <= 1.35) {
    return null;
  }
  const candidates = [];
  for (const link of diagnostics?.navigation?.traversalLinks ?? []) {
    if (link.regionId !== diagnostics.currentRegionId
      || !RAISED_COMBAT_TRAVERSAL_MODES.has(link.mode)
      || link.mechanismId
      || (link.conditions?.length ?? 0) > 0) {
      continue;
    }
    const from = navigationSurfaceCenter(link.fromSurface);
    const to = navigationSurfaceCenter(link.toSurface);
    if (!from || !to) continue;
    const fromIsLower = from.y <= to.y;
    const lower = fromIsLower ? from : to;
    const upper = fromIsLower ? to : from;
    const upperSurface = fromIsLower ? link.toSurface : link.fromSurface;
    const upperPurpose = String(upperSurface?.purpose ?? '');
    const direction = fromIsLower ? 'forward' : 'reverse';
    if (direction === 'reverse' && link.bidirectional === false) continue;
    const rise = upper.y - lower.y;
    const lowerHeightError = Math.abs(lower.y - playerPosition.y);
    const targetHeightError = Math.abs(upper.y - targetPosition.y);
    if (rise < 1.5
      || lowerHeightError > 1.2
      || targetHeightError > 1.5
      || NON_COMBAT_PERCH_PURPOSE_PATTERN.test(upperPurpose)
      || !RAISED_COMBAT_PURPOSE_PATTERN.test(upperPurpose)) {
      continue;
    }
    candidates.push({
      linkId: link.id,
      direction,
      returnDirection: direction === 'forward' ? 'reverse' : 'forward',
      surfaceId: fromIsLower ? link.toSurfaceId : link.fromSurfaceId,
      surfaceY: upper.y,
      targetEnemyId: target.enemy.id,
      score: targetHeightError
        + Math.hypot(lower.x - playerPosition.x, lower.z - playerPosition.z) * 0.04
        + Math.hypot(upper.x - targetPosition.x, upper.z - targetPosition.z) * 0.08,
    });
  }
  candidates.sort((left, right) => left.score - right.score
    || left.linkId.localeCompare(right.linkId));
  return candidates[0] ?? null;
}

export function getRaisedCombatLaneAction(
  raisedLane,
  target,
  playerPosition,
  secondsWithoutDamage,
) {
  if (!raisedLane || !playerPosition) return 'none';
  if (Math.abs(playerPosition.y - raisedLane.surfaceY) > 1.25) return 'lost';
  if (!target) return 'hold';
  if (target.enemy.id !== raisedLane.targetEnemyId) return 'leave';
  if (Math.abs(target.enemy.position.y - playerPosition.y) > 1.35
    && secondsWithoutDamage > 3.5) {
    return 'leave';
  }
  return 'hold';
}

export function publicCombatShouldTakeRaisedRoute(
  diagnostics,
  target,
  secondsWithoutDamage,
) {
  const playerPosition = diagnostics?.playerPosition;
  const targetPosition = target?.enemy?.position;
  if (!playerPosition || !targetPosition
    || targetPosition.y - playerPosition.y <= 1.35) {
    return false;
  }
  return diagnostics.lockOnTargetId
    ? secondsWithoutDamage > 3.5
    : target.horizontalDistance > 6.7;
}

export function publicCombatTraversalRequiresLockRelease(diagnostics, raisedRoute) {
  return Boolean(raisedRoute?.linkId && diagnostics?.lockOnTargetId);
}

export function getPublicCombatAimAction(playerYaw, playerPosition, targetPosition) {
  if (!Number.isFinite(playerYaw) || !playerPosition || !targetPosition) return null;
  const desiredYaw = Math.atan2(
    targetPosition.x - playerPosition.x,
    targetPosition.z - playerPosition.z,
  );
  const yawDelta = signedYawDelta(playerYaw, desiredYaw);
  if (Math.abs(yawDelta) <= 0.3) return { kind: 'fire', yawDelta };
  return {
    kind: 'turn',
    key: yawDelta > 0 ? 'KeyA' : 'KeyD',
    duration: Math.min(180, Math.max(35, Math.abs(yawDelta) * 110)),
    yawDelta,
  };
}

export function requiresHorizontalPortalIngressProof(portal) {
  return ['walk', 'catwalk', 'bottom-walk', 'stairs'].includes(portal?.traversalMode);
}

function capsuleFootprintWithinBoundsUnion(position, boundsList, capsuleRadius) {
  if (!position || !Array.isArray(boundsList) || boundsList.length === 0
    || boundsList.some((bounds) => !bounds?.min || !bounds?.max)
    || !Number.isFinite(capsuleRadius) || capsuleRadius <= 0) return false;
  return [
    { x: 0, z: 0 },
    ...Array.from({ length: 16 }, (_, index) => {
      const angle = index / 16 * Math.PI * 2;
      return { x: Math.cos(angle) * capsuleRadius, z: Math.sin(angle) * capsuleRadius };
    }),
  ].every((offset) => boundsList.some((bounds) => (
    position.x + offset.x >= bounds.min.x - 0.001
      && position.x + offset.x <= bounds.max.x + 0.001
      && position.z + offset.z >= bounds.min.z - 0.001
      && position.z + offset.z <= bounds.max.z + 0.001
  )));
}

export function hasClearedAuthoredPortalIngress(diagnostics, contract) {
  const position = diagnostics?.playerPosition;
  if (!position || !contract?.boundaryPoint || !contract?.interiorPoint
    || diagnostics.currentRegionId !== contract.regionId
    || diagnostics.jumpState !== 'Grounded') return false;
  const minimumDepth = Number(contract.minimumDepth);
  const halfWidth = Number(contract.halfWidth);
  const capsuleRadius = Number(contract.capsuleRadius);
  const surfaceTopY = Number(contract.surfaceTopY);
  const surfaceBounds = contract.surfaceBounds;
  const surfaceBoundsList = contract.surfaceBoundsList ?? [surfaceBounds];
  if (![minimumDepth, halfWidth, capsuleRadius, surfaceTopY].every(Number.isFinite)
    || minimumDepth <= 0 || halfWidth <= capsuleRadius || capsuleRadius <= 0
    || typeof contract.destinationSurfaceId !== 'string' || !contract.destinationSurfaceId
    || !surfaceBounds?.min || !surfaceBounds?.max
    || surfaceBoundsList.some((bounds) => !bounds?.min || !bounds?.max)) return false;
  const directionX = contract.interiorPoint.x - contract.boundaryPoint.x;
  const directionZ = contract.interiorPoint.z - contract.boundaryPoint.z;
  const directionLength = Math.hypot(directionX, directionZ);
  if (directionLength <= 0.05) return false;
  const normalX = directionX / directionLength;
  const normalZ = directionZ / directionLength;
  const offsetX = position.x - contract.boundaryPoint.x;
  const offsetZ = position.z - contract.boundaryPoint.z;
  const interiorDepth = offsetX * normalX + offsetZ * normalZ;
  const lateralOffset = Math.abs(offsetX * -normalZ + offsetZ * normalX);
  const usableHalfWidth = halfWidth - capsuleRadius;
  const capsuleContained = capsuleFootprintWithinBoundsUnion(
    position,
    surfaceBoundsList,
    capsuleRadius,
  );
  return interiorDepth >= minimumDepth
    && lateralOffset <= usableHalfWidth
    && Math.abs(position.y - surfaceTopY) <= 0.05
    && capsuleContained;
}

export function hasClearedAuthoredApproachIngress(diagnostics, contract) {
  const position = diagnostics?.playerPosition;
  const targetPoint = contract?.targetPoint;
  const nextPoint = contract?.nextPoint;
  const surfaceBounds = contract?.surfaceBounds;
  const capsuleRadius = Number(contract?.capsuleRadius);
  const halfWidth = Number(contract?.halfWidth);
  const surfaceTopY = Number(contract?.surfaceTopY);
  const verticalTolerance = Number(contract?.verticalTolerance);
  const maximumForwardProgress = Number(contract?.maximumForwardProgress);
  if (!position || !targetPoint || !nextPoint || !surfaceBounds?.min || !surfaceBounds?.max
    || typeof contract.surfaceId !== 'string' || !contract.surfaceId
    || diagnostics.jumpState !== 'Grounded'
    || diagnostics.ledgeCling
    || String(diagnostics.animationState ?? '').toLowerCase().includes('ledge')
    || (diagnostics.errors?.length ?? 0) > 0
    || Number(diagnostics.safeguardActivations ?? 0) > 0
    || ![capsuleRadius, halfWidth, surfaceTopY, verticalTolerance, maximumForwardProgress]
      .every(Number.isFinite)
    || capsuleRadius <= 0 || halfWidth <= capsuleRadius
    || verticalTolerance < 0 || maximumForwardProgress <= 0) return false;
  const directionX = nextPoint.x - targetPoint.x;
  const directionZ = nextPoint.z - targetPoint.z;
  const directionLength = Math.hypot(directionX, directionZ);
  if (directionLength <= 0.05) return false;
  const forwardX = directionX / directionLength;
  const forwardZ = directionZ / directionLength;
  const offsetX = position.x - targetPoint.x;
  const offsetZ = position.z - targetPoint.z;
  const forwardProgress = offsetX * forwardX + offsetZ * forwardZ;
  const lateralOffset = Math.abs(offsetX * -forwardZ + offsetZ * forwardX);
  const capsuleContained = position.x >= surfaceBounds.min.x + capsuleRadius
    && position.x <= surfaceBounds.max.x - capsuleRadius
    && position.z >= surfaceBounds.min.z + capsuleRadius
    && position.z <= surfaceBounds.max.z - capsuleRadius;
  return forwardProgress >= -0.001
    && forwardProgress <= maximumForwardProgress + 0.001
    && lateralOffset <= halfWidth - capsuleRadius + 0.001
    && Math.abs(position.y - surfaceTopY) <= verticalTolerance + 0.001
    && capsuleContained;
}

export function isPositionWithinPlanOwnedCombatRejoin(position, contract) {
  const start = contract?.segmentStart;
  const end = contract?.segmentEnd;
  const bounds = contract?.surfaceBounds;
  const boundsList = contract?.surfaceBoundsList ?? [bounds];
  const capsuleRadius = Number(contract?.capsuleRadius);
  const minimumProgress = Number(contract?.minimumProgress);
  const maximumProgress = Number(contract?.maximumProgress);
  const maximumLateralOffset = Number(contract?.maximumLateralOffset);
  if (!position || !start || !end || !bounds?.min || !bounds?.max
    || boundsList.some((entry) => !entry?.min || !entry?.max)
    || ![capsuleRadius, minimumProgress, maximumProgress, maximumLateralOffset]
      .every(Number.isFinite)) return false;
  const waypoints = Array.isArray(contract?.waypoints) && contract.waypoints.length >= 2
    ? contract.waypoints
    : [start, end];
  if (waypoints.some((point) => !point)) return false;
  if (waypoints.length > 2) {
    return waypoints.slice(1).some((segmentEnd, index) => {
      const segmentStart = waypoints[index];
      const deltaX = segmentEnd.x - segmentStart.x;
      const deltaZ = segmentEnd.z - segmentStart.z;
      const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
      if (lengthSquared <= 0.0025) return false;
      const progress = (
        (position.x - segmentStart.x) * deltaX
          + (position.z - segmentStart.z) * deltaZ
      ) / lengthSquared;
      const projectedX = segmentStart.x + deltaX * progress;
      const projectedZ = segmentStart.z + deltaZ * progress;
      return progress >= -0.001 && progress <= 1.001
        && Math.hypot(position.x - projectedX, position.z - projectedZ)
          <= maximumLateralOffset + 0.001
        && Math.abs(position.y - segmentStart.y) <= 0.05
        && capsuleFootprintWithinBoundsUnion(position, boundsList, capsuleRadius);
    });
  }
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (lengthSquared <= 0.0025) return false;
  const progress = (
    (position.x - start.x) * deltaX
    + (position.z - start.z) * deltaZ
  ) / lengthSquared;
  const projectedX = start.x + deltaX * progress;
  const projectedZ = start.z + deltaZ * progress;
  return progress >= minimumProgress - 0.001
    && progress <= maximumProgress + 0.001
    && Math.hypot(position.x - projectedX, position.z - projectedZ)
      <= maximumLateralOffset + 0.001
    && Math.abs(position.y - start.y) <= 0.05
    && capsuleFootprintWithinBoundsUnion(position, boundsList, capsuleRadius);
}

export function selectPlanOwnedPortalIngressSettleTarget({
  navigation,
  portalId,
  minimumIngressPoint,
  destinationSurfaceId,
  forwardDistance = 0.8,
} = {}) {
  if (!navigation || typeof portalId !== 'string' || !portalId
    || !minimumIngressPoint || typeof destinationSurfaceId !== 'string'
    || !destinationSurfaceId || !Number.isFinite(forwardDistance)
    || forwardDistance <= 0) return null;
  const matchingLinks = (navigation.traversalLinks ?? []).filter((link) => (
    link.approachContract?.ingressPortalId === portalId
  ));
  if (matchingLinks.length !== 1) return null;
  const link = matchingLinks[0];
  const rejoin = link.approachContract?.combatRejoin;
  const rejoinSurfaceIds = rejoin?.surfaceIds ?? [rejoin?.surfaceId];
  if (!rejoin || !rejoinSurfaceIds.includes(destinationSurfaceId)
    || Math.hypot(
      rejoin.segmentStart?.x - minimumIngressPoint.x,
      rejoin.segmentStart?.z - minimumIngressPoint.z,
    ) > 0.01
    || Math.abs(rejoin.segmentStart?.y - minimumIngressPoint.y) > 0.01) return null;
  const encounter = navigation.encounters?.find(({ encounterId }) => (
    encounterId === rejoin.encounterId
  ));
  const engagement = encounter?.entryEngagementContracts?.find(({ id }) => (
    id === rejoin.engagementId
  ));
  if (!encounter || encounter.regionId !== link.regionId
    || !engagement
    || engagement.sourceTraversalLinkId !== link.id
    || engagement.surfaceId !== rejoin.surfaceId
    || (engagement.surfaceIds ?? [engagement.surfaceId]).length !== rejoinSurfaceIds.length
    || !(engagement.surfaceIds ?? [engagement.surfaceId]).every((surfaceId, index) => (
      surfaceId === rejoinSurfaceIds[index]
    ))
    || engagement.unobstructed !== true
    || engagement.sameLevel !== true) return null;
  const surface = link.approachSurfaces?.find(({ id }) => id === rejoin.surfaceId);
  const bounds = surface?.bounds;
  const rejoinSurfaces = rejoinSurfaceIds.map((surfaceId) => (
    link.approachSurfaces?.find(({ id }) => id === surfaceId)
  ));
  const surfaceBoundsList = rejoinSurfaces.map((entry) => entry?.bounds);
  const capsuleRadius = Number(rejoin.capsuleRadius);
  const capsuleHeight = Number(rejoin.capsuleHeight);
  const sampleSpacing = Number(rejoin.sampleSpacing);
  const minimumProgress = Number(rejoin.minimumProgress);
  const maximumProgress = Number(rejoin.maximumProgress);
  const maximumLateralOffset = Number(rejoin.maximumLateralOffset);
  const start = rejoin.segmentStart;
  const end = rejoin.segmentEnd;
  if (!bounds?.min || !bounds?.max || rejoinSurfaces.some((entry) => !entry)
    || surfaceBoundsList.some((entry) => !entry?.min || !entry?.max) || !start || !end
    || ![capsuleRadius, capsuleHeight, sampleSpacing, minimumProgress,
      maximumProgress, maximumLateralOffset].every(Number.isFinite)
    || capsuleRadius <= 0 || capsuleHeight < 3.2 || sampleSpacing <= 0
    || Math.abs(Number(engagement.capsuleRadius) - capsuleRadius) > 0.001
    || Math.abs(Number(engagement.capsuleHeight) - capsuleHeight) > 0.001
    || Number(engagement.sampleSpacing) + 0.001 < sampleSpacing) return null;
  const contract = {
    segmentStart: start,
    segmentEnd: end,
    waypoints: rejoin.waypoints ?? [start, end],
    surfaceBounds: bounds,
    surfaceBoundsList,
    capsuleRadius,
    minimumProgress,
    maximumProgress,
    maximumLateralOffset,
  };
  const doorwayEgress = link.approachContract?.doorwayEgress;
  if (doorwayEgress) {
    const portal = navigation.portals?.find(({ id }) => id === portalId);
    const boundaryPoint = portal?.to?.surfaceId === destinationSurfaceId
      ? portal.to.center
      : portal?.from?.surfaceId === destinationSurfaceId
        ? portal.from.center
        : null;
    const directionX = minimumIngressPoint.x - Number(boundaryPoint?.x);
    const directionZ = minimumIngressPoint.z - Number(boundaryPoint?.z);
    const directionLength = Math.hypot(directionX, directionZ);
    const forward = directionLength > 0.05
      ? { x: directionX / directionLength, z: directionZ / directionLength }
      : null;
    const tangent = forward ? { x: -forward.z, z: forward.x } : null;
    const exteriorStagingDepth = Number(doorwayEgress.exteriorStagingDepth);
    const straightClearanceDepth = Number(doorwayEgress.straightClearanceDepth);
    const maximumLaneOffset = Number(doorwayEgress.maximumLaneOffset);
    const doorwayRadius = Number(doorwayEgress.capsuleRadius);
    const doorwayHeight = Number(doorwayEgress.capsuleHeight);
    const doorwaySpacing = Number(doorwayEgress.sampleSpacing);
    const doorwaySurfaceIds = [
      doorwayEgress.connectorSurfaceId,
      ...(doorwayEgress.destinationSurfaceIds ?? []),
    ];
    const doorwaySurfaces = doorwaySurfaceIds.map((surfaceId) => (
      link.doorwayEgressSurfaces?.find(({ id }) => id === surfaceId)
    ));
    if (doorwayEgress.mode !== 'lane-preserving-then-recenter'
      || doorwayEgress.portalId !== portalId || !boundaryPoint || !forward
      || doorwayEgress.destinationSurfaceIds?.[0] !== destinationSurfaceId
      || doorwaySurfaces.some((entry) => !entry?.bounds?.min || !entry?.bounds?.max)
      || ![exteriorStagingDepth, straightClearanceDepth, maximumLaneOffset,
        doorwayRadius, doorwayHeight, doorwaySpacing].every(Number.isFinite)
      || exteriorStagingDepth < doorwayRadius || straightClearanceDepth <= directionLength
      || maximumLaneOffset < doorwayRadius || doorwayRadius !== capsuleRadius
      || doorwayHeight < capsuleHeight || doorwaySpacing <= 0
      || !isPositionWithinPlanOwnedCombatRejoin(doorwayEgress.recenterPoint, contract)) {
      return null;
    }
    const exteriorStagingPoint = {
      x: boundaryPoint.x - forward.x * exteriorStagingDepth,
      y: minimumIngressPoint.y,
      z: boundaryPoint.z - forward.z * exteriorStagingDepth,
    };
    const straightClearancePoint = {
      x: boundaryPoint.x + forward.x * straightClearanceDepth,
      y: minimumIngressPoint.y,
      z: boundaryPoint.z + forward.z * straightClearanceDepth,
    };
    return {
      position: { ...doorwayEgress.recenterPoint },
      traversalLinkId: link.id,
      combatRejoinId: rejoin.id,
      engagementId: engagement.id,
      encounterId: encounter.encounterId,
      surfaceId: rejoin.surfaceId,
      supportSamples: [],
      destinationSurfaceBounds: doorwayEgress.destinationSurfaceIds.map((surfaceId) => (
        doorwaySurfaces.find(({ id }) => id === surfaceId).bounds
      )),
      contract,
      doorwayEgress: {
        id: doorwayEgress.id,
        exteriorStagingPoint,
        straightClearancePoint,
        recenterPoint: { ...doorwayEgress.recenterPoint },
        boundaryPoint: { ...boundaryPoint },
        forward,
        tangent,
        maximumLaneOffset,
        capsuleRadius: doorwayRadius,
        capsuleHeight: doorwayHeight,
        sampleSpacing: doorwaySpacing,
        surfaceBoundsList: doorwaySurfaces.map(({ bounds: entryBounds }) => entryBounds),
      },
    };
  }
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const length = Math.hypot(deltaX, deltaZ);
  if (length <= forwardDistance + 0.05) return null;
  const progress = forwardDistance / length;
  if (progress < minimumProgress || progress > maximumProgress) return null;
  const position = {
    x: start.x + (deltaX / length) * forwardDistance,
    y: start.y,
    z: start.z + (deltaZ / length) * forwardDistance,
  };
  const sampleCount = Math.max(1, Math.ceil(forwardDistance / sampleSpacing));
  const supportSamples = Array.from({ length: sampleCount + 1 }, (_, index) => ({
    x: start.x + (position.x - start.x) * (index / sampleCount),
    y: start.y,
    z: start.z + (position.z - start.z) * (index / sampleCount),
  }));
  if (supportSamples.some((point) => !isPositionWithinPlanOwnedCombatRejoin(point, contract))) {
    return null;
  }
  return {
    position,
    traversalLinkId: link.id,
    combatRejoinId: rejoin.id,
    engagementId: engagement.id,
    encounterId: encounter.encounterId,
    surfaceId: rejoin.surfaceId,
    supportSamples,
    contract,
  };
}

export function publicPortalSettlingIsAccepted({
  provenDiagnostics,
  settledDiagnostics,
  portalIngressContract,
  combatRejoinContract,
  maximumSettlingDistance = 0.35,
} = {}) {
  const provenPosition = provenDiagnostics?.playerPosition;
  const settledPosition = settledDiagnostics?.playerPosition;
  if (!provenPosition || !settledPosition || !Number.isFinite(maximumSettlingDistance)
    || maximumSettlingDistance < 0) return false;
  const settlingDistance = Math.hypot(
    settledPosition.x - provenPosition.x,
    settledPosition.y - provenPosition.y,
    settledPosition.z - provenPosition.z,
  );
  return (settledDiagnostics?.errors?.length ?? 0) === 0
    && Number(settledDiagnostics?.safeguardActivations ?? 0) === 0
    && settlingDistance <= maximumSettlingDistance
    && hasClearedAuthoredPortalIngress(settledDiagnostics, portalIngressContract)
    && isPositionWithinPlanOwnedCombatRejoin(settledPosition, combatRejoinContract);
}

export function buildPlanOwnedDoorwayEgressTargets(currentPosition, doorwayEgress) {
  const exterior = doorwayEgress?.exteriorStagingPoint;
  const straight = doorwayEgress?.straightClearancePoint;
  const recenter = doorwayEgress?.recenterPoint;
  const tangent = doorwayEgress?.tangent;
  const maximumLaneOffset = Number(doorwayEgress?.maximumLaneOffset);
  const capsuleRadius = Number(doorwayEgress?.capsuleRadius);
  const sampleSpacing = Number(doorwayEgress?.sampleSpacing);
  const boundsList = doorwayEgress?.surfaceBoundsList;
  if (!currentPosition || !exterior || !straight || !recenter || !tangent
    || ![maximumLaneOffset, capsuleRadius, sampleSpacing].every(Number.isFinite)
    || maximumLaneOffset < capsuleRadius || capsuleRadius <= 0 || sampleSpacing <= 0
    || !Array.isArray(boundsList) || boundsList.length < 3) return null;
  const rawLaneOffset = (
    (currentPosition.x - doorwayEgress.boundaryPoint.x) * tangent.x
      + (currentPosition.z - doorwayEgress.boundaryPoint.z) * tangent.z
  );
  const laneOffset = Math.max(-maximumLaneOffset, Math.min(maximumLaneOffset, rawLaneOffset));
  const straightTarget = {
    x: straight.x + tangent.x * laneOffset,
    y: straight.y,
    z: straight.z + tangent.z * laneOffset,
  };
  const route = [currentPosition, straightTarget, recenter];
  const supportSamples = [];
  for (let segmentIndex = 1; segmentIndex < route.length; segmentIndex += 1) {
    const start = route[segmentIndex - 1];
    const end = route[segmentIndex];
    const distance = Math.hypot(end.x - start.x, end.z - start.z);
    const sampleCount = Math.max(1, Math.ceil(distance / sampleSpacing));
    for (let sampleIndex = segmentIndex === 1 ? 0 : 1;
      sampleIndex <= sampleCount; sampleIndex += 1) {
      const progress = sampleIndex / sampleCount;
      const point = {
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
        z: start.z + (end.z - start.z) * progress,
      };
      if (!capsuleFootprintWithinBoundsUnion(point, boundsList, capsuleRadius)) return null;
      supportSamples.push(point);
    }
  }
  return {
    laneOffset,
    rawLaneOffset,
    straightTarget,
    recenterTarget: { ...recenter },
    supportSamples,
  };
}

export function getPublicSteeringForwardBurst(distance, horizontalTolerance) {
  if (distance > 12) return 900;
  if (distance > 6) return 650;
  if (distance > 3) return 380;
  if (distance > 1.4) return 130;
  // Near an exact plan waypoint, the old fixed 50ms pulse advanced roughly
  // 0.6m in a loaded headless frame and made the driver orbit around a 0.35m
  // acceptance radius forever. Preserve that radius and instead bound input
  // time by the remaining clearance at the measured worst-case rate.
  const remainingClearance = Math.max(0, distance - horizontalTolerance);
  return Math.max(1, Math.min(20, Math.floor(remainingClearance / 0.012)));
}

export function getPublicSteeringTurnAction(
  currentYaw,
  desiredYaw,
  {
    yawTolerance = 0.36,
    constrainedGroundRoute = false,
  } = {},
) {
  if (![currentYaw, desiredYaw, yawTolerance].every(Number.isFinite)
    || yawTolerance < 0) return null;
  const yawDelta = signedYawDelta(currentYaw, desiredYaw);
  if (Math.abs(yawDelta) <= yawTolerance) return null;
  const duration = constrainedGroundRoute
    ? null
    : Math.min(240, Math.max(40, Math.abs(yawDelta) * 145));
  return {
    key: yawDelta > 0 ? 'KeyA' : 'KeyD',
    duration,
    yawDelta,
    frameSynchronized: constrainedGroundRoute,
  };
}

/**
 * Detects a loaded-browser tank-turn oscillation without treating it as
 * successful alignment. Playwright can observe the first authoritative game
 * heartbeat before its trusted key-up reaches the page, so one nominally
 * bounded turn pulse can span several real frames. If two stationary samples
 * land just outside opposite sides of the unchanged heading tolerance, a
 * human player would keep walking while correcting instead of alternating in
 * place forever. The caller may therefore add forward input to the next
 * public turn pulse; no position, yaw, or acceptance tolerance is mutated.
 */
export function publicSteeringNeedsQuantizedTurnAdvance(
  previousObservation,
  currentObservation,
  {
    yawTolerance = 0.36,
    maximumToleranceExcess = 0.12,
    maximumStationaryDistance = 0.08,
  } = {},
) {
  const previousDelta = Number(previousObservation?.yawDelta);
  const currentDelta = Number(currentObservation?.yawDelta);
  const previousPosition = previousObservation?.position;
  const currentPosition = currentObservation?.position;
  if (![previousDelta, currentDelta, yawTolerance, maximumToleranceExcess,
    maximumStationaryDistance].every(Number.isFinite)
    || !previousPosition || !currentPosition
    || !['x', 'y', 'z'].every((axis) => (
      Number.isFinite(previousPosition[axis]) && Number.isFinite(currentPosition[axis])
    ))
    || yawTolerance < 0 || maximumToleranceExcess < 0 || maximumStationaryDistance < 0) {
    return false;
  }
  const signFlipped = previousDelta * currentDelta < 0;
  const bothOutsideTolerance = Math.abs(previousDelta) > yawTolerance
    && Math.abs(currentDelta) > yawTolerance;
  const boundedOvershoot = Math.max(Math.abs(previousDelta), Math.abs(currentDelta))
    <= yawTolerance + maximumToleranceExcess;
  const stationaryDistance = Math.hypot(
    currentPosition.x - previousPosition.x,
    currentPosition.y - previousPosition.y,
    currentPosition.z - previousPosition.z,
  );
  return signFlipped
    && bothOutsideTolerance
    && boundedOvershoot
    && stationaryDistance <= maximumStationaryDistance;
}

/**
 * Applies one already-selected public steering turn. A constrained route
 * normally owns only the turn key, but a loaded renderer can quantize two
 * successive heartbeats onto opposite sides of the same yaw dead-zone. Once
 * that stationary sign flip has been proven, advance and correct for exactly
 * one authoritative game heartbeat. This is ordinary keyboard input; it does
 * not mutate position, yaw, timing, or the route's acceptance tolerance.
 */
export async function applyPublicSteeringTurn(page, turnAction, {
  quantizedTurnAdvance = false,
  heartbeatInput = holdPublicInputsForOneHeartbeat,
  tapInput = tapPublicInputBurst,
  timedInput = holdPublicInput,
} = {}) {
  if (!turnAction?.key) {
    throw new Error('A public steering turn requires a selected turn action.');
  }
  if (turnAction.frameSynchronized) {
    if (quantizedTurnAdvance) {
      await heartbeatInput(page, ['KeyW', turnAction.key]);
      return Object.freeze({
        mode: 'forward-turn-heartbeat',
        codes: Object.freeze(['KeyW', turnAction.key]),
      });
    }
    await tapInput(page, [turnAction.key], { delay: 80 });
    return Object.freeze({
      mode: 'turn-tap',
      codes: Object.freeze([turnAction.key]),
    });
  }
  await timedInput(page, turnAction.key, turnAction.duration);
  return Object.freeze({
    mode: 'timed-turn',
    codes: Object.freeze([turnAction.key]),
  });
}

/**
 * Advances one frame along a strict, plan-owned grounded route. Wall-clock
 * keyboard.press delays are not authoritative when the renderer is loaded:
 * the trusted key-up can be delivered only after several game frames have
 * already consumed KeyW. Bind the key lifetime to the same read-only game
 * heartbeat used by strict turns so one intended step cannot become a
 * multi-metre overshoot past a narrow catwalk waypoint.
 */
export async function applyPublicStrictGroundForward(page, {
  heartbeatInput = holdPublicInputsForOneHeartbeat,
} = {}) {
  await heartbeatInput(page, ['KeyW']);
  return Object.freeze({
    mode: 'forward-heartbeat',
    codes: Object.freeze(['KeyW']),
  });
}

export function publicSteeringSweepReachedTarget(
  previousPosition,
  currentPosition,
  target,
  horizontalTolerance,
  verticalTolerance,
  {
    maximumSweepLength = 2.5,
    requireGrounded = false,
    forbidLedgeClimb = false,
    diagnostics = null,
  } = {},
) {
  if ((diagnostics?.errors?.length ?? 0) > 0
    || Number(diagnostics?.safeguardActivations ?? 0) > 0
    || (requireGrounded && diagnostics?.jumpState !== 'Grounded')
    || (forbidLedgeClimb && (
      diagnostics?.ledgeCling
      || String(diagnostics?.animationState ?? '').toLowerCase().includes('ledge')
    ))) return false;
  if (![previousPosition, currentPosition, target].every((point) => (
    point && ['x', 'y', 'z'].every((axis) => Number.isFinite(point[axis]))
  ))) return false;
  const deltaX = currentPosition.x - previousPosition.x;
  const deltaY = currentPosition.y - previousPosition.y;
  const deltaZ = currentPosition.z - previousPosition.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  const sweepLength = Math.hypot(deltaX, deltaY, deltaZ);
  if (lengthSquared <= 1e-6 || sweepLength > maximumSweepLength) return false;
  const progress = Math.max(0, Math.min(1, (
    (target.x - previousPosition.x) * deltaX
    + (target.z - previousPosition.z) * deltaZ
  ) / lengthSquared));
  const closest = {
    x: previousPosition.x + deltaX * progress,
    y: previousPosition.y + deltaY * progress,
    z: previousPosition.z + deltaZ * progress,
  };
  return Math.hypot(target.x - closest.x, target.z - closest.z) <= horizontalTolerance
    && Math.abs(target.y - closest.y) <= verticalTolerance;
}

export function publicSteeringEndpointReached(
  positionalReached,
  {
    portalIngressContract = null,
    approachIngressContract = null,
    diagnostics = null,
  } = {},
) {
  // A portal's waypoint is only an aiming target. Its endpoint contract owns
  // success: ordinary distance tolerance (or a sweep past the point) must not
  // substitute for placing the grounded capsule the full authored distance
  // inside the destination surface.
  if (portalIngressContract) {
    return (diagnostics?.errors?.length ?? 0) === 0
      && Number(diagnostics?.safeguardActivations ?? 0) === 0
      && Boolean(positionalReached)
      && hasClearedAuthoredPortalIngress(diagnostics, portalIngressContract);
  }
  if (approachIngressContract) {
    // Preserve the original exact point/sweep proof. Loaded-browser movement
    // may also prove the same threshold by physically crossing the authored
    // approach plane with its full grounded capsule inside the declared deck
    // and usable stair aperture. Nearness to a room or waypoint is never
    // sufficient on its own.
    const traversalStateValid = diagnostics?.jumpState === 'Grounded'
      && !diagnostics?.ledgeCling
      && !String(diagnostics?.animationState ?? '').toLowerCase().includes('ledge')
      && (diagnostics?.errors?.length ?? 0) === 0
      && Number(diagnostics?.safeguardActivations ?? 0) === 0;
    return traversalStateValid && (
      Boolean(positionalReached)
      || hasClearedAuthoredApproachIngress(diagnostics, approachIngressContract)
    );
  }
  return Boolean(positionalReached);
}

/**
 * Drives ordinary tank-style movement using only keyboard input. Diagnostics
 * are read-only and provide the same position/facing information a journey
 * observer records; this helper never accesses the live game object.
 */
export async function steerToWorldPointPublicly(page, target, {
  horizontalTolerance = 0.75,
  verticalTolerance = 0.8,
  timeout = 20_000,
  allowJumpRecovery = false,
  stopWhenRegionId = null,
  stopWhenPromptActionId = null,
  stopWhenPromptTargetId = null,
  stopWhenEncounterId = null,
  portalIngressContract = null,
  approachIngressContract = null,
  forbidJump = false,
  forbidLedgeClimb = false,
  turnWhileAdvancing = false,
  sampleObserver = null,
} = {}) {
  const started = Date.now();
  let lastPosition = null;
  let previousTurnObservation = null;
  let stalledSince = Date.now();
  while (Date.now() - started < timeout) {
    const diagnostics = await readV2Diagnostics(
      page,
      stopWhenEncounterId ? 'runtime' : 'movement',
    );
    const position = diagnostics?.playerPosition;
    if (!position || !Number.isFinite(diagnostics?.playerYaw)) {
      await page.waitForTimeout(50);
      continue;
    }
    if (forbidJump) {
      expect(diagnostics.jumpState, `A walk-only route entered ${diagnostics.jumpState}: ${JSON.stringify({
        position,
        target,
        lastPosition,
        regionId: diagnostics.currentRegionId,
      })}`)
        .toBe('Grounded');
    }
    if (forbidLedgeClimb) {
      expect(diagnostics.ledgeCling, 'A walk-only route invoked ledge traversal.').toBeNull();
      expect(String(diagnostics.animationState ?? '').toLowerCase())
        .not.toContain('ledge');
    }
    if (sampleObserver) await sampleObserver(diagnostics);
    if (stopWhenRegionId && diagnostics.currentRegionId === stopWhenRegionId) {
      return diagnostics;
    }
    if (stopWhenPromptActionId
      && diagnostics.currentPrompt?.actionId === stopWhenPromptActionId) {
      return diagnostics;
    }
    if (stopWhenPromptTargetId
      && diagnostics.currentPrompt?.targetId === stopWhenPromptTargetId) {
      return diagnostics;
    }
    if (stopWhenEncounterId && diagnostics.activeEnemies?.some((enemy) => (
      enemy.encounterId === stopWhenEncounterId
    ))) {
      return diagnostics;
    }
    const deltaX = target.x - position.x;
    const deltaZ = target.z - position.z;
    const distance = Math.hypot(deltaX, deltaZ);
    const hasVerticalTarget = Number.isFinite(target.y);
    const verticalDelta = hasVerticalTarget ? target.y - position.y : 0;
    const sweptTarget = lastPosition && publicSteeringSweepReachedTarget(
      lastPosition,
      position,
      { ...target, y: hasVerticalTarget ? target.y : position.y },
      horizontalTolerance,
      verticalTolerance,
      {
        requireGrounded: forbidJump,
        forbidLedgeClimb,
        diagnostics,
      },
    );
    if (publicSteeringEndpointReached(sweptTarget, {
      portalIngressContract,
      approachIngressContract,
      diagnostics,
    })) {
      return diagnostics;
    }
    // Once mounted, remain on the public climb controls until Player performs
    // its authored top/bottom dismount. A waypoint can be within the ordinary
    // 0.8m vertical tolerance while the root is still attached to the ladder;
    // treating that as arrival makes the next horizontal waypoint feed KeyW
    // into the ladder and climb away from the requested bottom exit.
    if (diagnostics.ladderTraversal && hasVerticalTarget) {
      const traversal = diagnostics.ladderTraversal;
      const targetIsTop = Math.abs(target.y - traversal.topY)
        <= Math.abs(target.y - traversal.bottomY);
      await holdPublicInput(page, targetIsTop ? 'KeyW' : 'KeyS', 140);
      continue;
    }
    if (publicSteeringEndpointReached(
      distance <= horizontalTolerance && Math.abs(verticalDelta) <= verticalTolerance,
      { portalIngressContract, approachIngressContract, diagnostics },
    )) {
      return diagnostics;
    }

    if (distance <= Math.max(horizontalTolerance, 1.4) && hasVerticalTarget
      && Math.abs(verticalDelta) > verticalTolerance) {
      if (!diagnostics.ladderTraversal && diagnostics.currentPrompt?.kind === 'ladder') {
        await interact(page);
        await page.waitForTimeout(80);
        continue;
      }
    }

    // A nearby vertical target is not necessarily a lift. Ordinary stairs
    // still need forward input until the final horizontal metre is crossed;
    // waiting here made the real public-input ladder journey stall on the
    // upper stair tread before it ever reached the ladder. Dynamic rides have
    // their own explicit wait loop in rideAutomaticSurfacePublicly().
    const desiredYaw = Math.atan2(deltaX, deltaZ);
    // Fixed-frame tank turns advance in coarse yaw quanta. Requiring a
    // tighter heading near a waypoint can bounce forever on opposite sides
    // of the dead-zone (the player is already close enough for a short,
    // harmless forward correction). Keep the near tolerance within the
    // ordinary route tolerance while shortening only the forward pulse.
    const yawTolerance = distance <= 2 ? 0.34 : 0.36;
    // Browser-driven fixed frames rotate in coarse quanta. A narrow
    // dead-zone can oscillate forever around a valid heading without ever
    // applying forward input. Near a waypoint, use a short forward pulse so
    // the player does not orbit around the target.
    const turnAction = getPublicSteeringTurnAction(
      diagnostics.playerYaw,
      desiredYaw,
      {
        yawTolerance,
        constrainedGroundRoute: forbidJump && forbidLedgeClimb && hasVerticalTarget,
      },
    );
    if (turnAction) {
      const turnObservation = {
        yawDelta: turnAction.yawDelta,
        position: { x: position.x, y: position.y, z: position.z },
      };
      const quantizedTurnAdvance = publicSteeringNeedsQuantizedTurnAdvance(
        previousTurnObservation,
        turnObservation,
        { yawTolerance },
      );
      // Pure turn corrections stay bounded to a short key press. Only a
      // proven stationary sign flip combines forward and turn, and that
      // recovery is bounded by one authoritative game heartbeat so loaded
      // browser IPC cannot turn it into an uncontrolled run.
      await applyPublicSteeringTurn(page, turnAction, { quantizedTurnAdvance });
      previousTurnObservation = turnObservation;
    } else {
      previousTurnObservation = null;
      const forwardBurst = getPublicSteeringForwardBurst(distance, horizontalTolerance);
      const strictGroundRoute = forbidJump && forbidLedgeClimb && hasVerticalTarget;
      if (strictGroundRoute) {
        // A wall-clock press is not frame-bounded under renderer load. Own
        // exactly one authoritative heartbeat so a strict waypoint can never
        // be skipped by a delayed trusted key-up.
        await applyPublicStrictGroundForward(page);
      } else {
        await holdPublicInput(
          page,
          'KeyW',
          stopWhenEncounterId ? Math.min(forwardBurst, 120) : forwardBurst,
        );
      }
    }

    if (lastPosition && Math.hypot(
      position.x - lastPosition.x,
      position.y - lastPosition.y,
      position.z - lastPosition.z,
    ) > 0.08) {
      stalledSince = Date.now();
    } else if (allowJumpRecovery && Date.now() - stalledSince > 900) {
      await page.keyboard.down('KeyW');
      await page.keyboard.press('Space');
      await page.waitForTimeout(160);
      await page.keyboard.up('KeyW');
      stalledSince = Date.now();
    }
    lastPosition = { x: position.x, y: position.y, z: position.z };
  }
  const final = await readV2Diagnostics(
    page,
    stopWhenEncounterId ? 'runtime' : 'movement',
  );
  const finalPosition = final?.playerPosition;
  const finalReachedNamedStop = Boolean(
    (stopWhenRegionId && final?.currentRegionId === stopWhenRegionId)
    || (stopWhenPromptActionId && final?.currentPrompt?.actionId === stopWhenPromptActionId)
    || (stopWhenPromptTargetId && final?.currentPrompt?.targetId === stopWhenPromptTargetId)
    || (stopWhenEncounterId && final?.activeEnemies?.some((enemy) => (
      enemy.encounterId === stopWhenEncounterId
    )))
  );
  const finalPositionWithinTolerance = Boolean(
    finalPosition
    && ((Math.hypot(target.x - finalPosition.x, target.z - finalPosition.z) <= horizontalTolerance
      && (!Number.isFinite(target.y) || Math.abs(target.y - finalPosition.y) <= verticalTolerance))
      || (lastPosition && publicSteeringSweepReachedTarget(
        lastPosition,
        finalPosition,
        { ...target, y: Number.isFinite(target.y) ? target.y : finalPosition.y },
        horizontalTolerance,
        verticalTolerance,
        {
          requireGrounded: forbidJump,
          forbidLedgeClimb,
          diagnostics: final,
        },
      )))
  );
  const finalReachedPosition = publicSteeringEndpointReached(finalPositionWithinTolerance, {
    portalIngressContract,
    approachIngressContract,
    diagnostics: final,
  });
  const finalTraversalStateAllowed = (!forbidJump || final?.jumpState === 'Grounded')
    && (!forbidLedgeClimb || (
      !final?.ledgeCling
      && !String(final?.animationState ?? '').toLowerCase().includes('ledge')
    ));
  // The last public movement burst can land inside tolerance just as the wall
  // clock expires. Re-evaluate that resulting frame before reporting failure;
  // otherwise an already-successful physical step becomes a timeout solely
  // because there was no next loop iteration to observe it.
  if ((finalReachedNamedStop || finalReachedPosition) && finalTraversalStateAllowed) {
    return final;
  }
  throw new Error(`Public-input steering timed out at ${JSON.stringify({
    position: final?.playerPosition,
    yaw: final?.playerYaw,
    regionId: final?.currentRegionId,
    prompt: final?.currentPrompt,
    errors: final?.errors,
  })} en route to ${JSON.stringify(target)}.`);
}

function surfaceCenter(surface) {
  const bounds = surface?.bounds;
  if (!bounds?.min || !bounds?.max) return null;
  return {
    x: (bounds.min.x + bounds.max.x) * 0.5,
    y: Number.isFinite(surface.topY) ? surface.topY : bounds.max.y,
    z: (bounds.min.z + bounds.max.z) * 0.5,
  };
}

/**
 * Resolves the room-side route to a closed gate from immutable navigation
 * diagnostics. Connector links also touch the portal endpoint, so they are
 * deliberately ranked behind an internal authored stair/ladder/mechanism
 * approach. An ambiguous best match fails closed instead of reviving a stale
 * room-specific link ID.
 */
export function resolvePublicGateApproachLink(navigation, portal, sourceRegionId) {
  const endpointSurfaceId = portal?.from?.surfaceId;
  if (!navigation || !endpointSurfaceId || portal.from.regionId !== sourceRegionId) return null;
  const candidates = (navigation.traversalLinks ?? []).filter((link) => (
    link.regionId === sourceRegionId
      && (link.fromSurfaceId === endpointSurfaceId || link.toSurfaceId === endpointSurfaceId)
  )).map((link) => {
    const direction = link.toSurfaceId === endpointSurfaceId ? 'forward' : 'reverse';
    if (direction === 'reverse' && link.bidirectional === false) return null;
    const connectorOwned = link.portalId === portal.id
      || link.proofPortalId === portal.id
      || /^traversal\.(?:canonical|connector)\./u.test(link.id);
    const authoredInternalMode = [
      'walkable-stairs', 'ladder', 'lift', 'moving-platform', 'gear-platform',
    ].includes(link.mode);
    return {
      linkId: link.id,
      direction,
      endpointSurfaceId,
      score: (connectorOwned ? 100 : 0) + (authoredInternalMode ? 0 : 10),
    };
  }).filter(Boolean).sort((left, right) => (
    left.score - right.score || left.linkId.localeCompare(right.linkId)
  ));
  if (candidates.length === 0) return null;
  const best = candidates.filter(({ score }) => score === candidates[0].score);
  return best.length === 1 ? best[0] : null;
}

/**
 * Finds both useful static landings for an automatic dynamic surface using
 * only plan-derived traversal summaries. This is intentionally stricter than
 * accepting caller-supplied coordinates: one generated boarding link cannot
 * masquerade as a useful two-ended moving platform.
 */
export function resolveAutomaticSurfaceLandingContracts(
  navigation,
  mechanismId,
  dynamicSurfaceId,
  playerPosition,
) {
  if (!navigation || !mechanismId || !dynamicSurfaceId || !playerPosition) return null;
  const landingBySurfaceId = new Map();
  for (const link of navigation.traversalLinks ?? []) {
    if (link.mechanismId !== mechanismId) continue;
    const surfaces = [link.fromSurface, link.toSurface, link.viaSurface].filter(Boolean);
    if (!surfaces.some(({ id }) => id === dynamicSurfaceId)) continue;
    for (const surface of surfaces) {
      if (surface.id === dynamicSurfaceId || !surface.bounds?.min || !surface.bounds?.max) continue;
      const center = surfaceCenter(surface);
      if (!center) continue;
      landingBySurfaceId.set(surface.id, {
        linkId: link.id,
        surfaceId: surface.id,
        regionId: surface.regionId,
        center,
        bounds: surface.bounds,
      });
    }
  }
  const landings = [...landingBySurfaceId.values()].sort((left, right) => {
    const distance = (landing) => Math.hypot(
      landing.center.x - playerPosition.x,
      landing.center.y - playerPosition.y,
      landing.center.z - playerPosition.z,
    );
    return distance(left) - distance(right) || left.surfaceId.localeCompare(right.surfaceId);
  });
  if (landings.length < 2) return null;
  return {
    boarding: landings[0],
    destinations: landings.slice(1),
    landingSurfaceIds: landings.map(({ surfaceId }) => surfaceId),
  };
}

function pointDistance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

export function getTraversalLinkApproachWaypoints(link, direction = 'forward', currentPosition = null) {
  if (direction === 'reverse') return [];
  const route = (link?.approachWaypoints ?? []).map((point) => ({ ...point }));
  if (!currentPosition || route.length < 2) return route;
  const combatRejoin = link?.approachContract?.combatRejoin;
  if (combatRejoin?.nextWaypointIndex > 0
    && combatRejoin.nextWaypointIndex < route.length
    && Math.abs(currentPosition.y - combatRejoin.segmentStart?.y) <= 0.2) {
    const start = combatRejoin.segmentStart;
    const end = combatRejoin.segmentEnd;
    const deltaX = end.x - start.x;
    const deltaZ = end.z - start.z;
    const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
    if (lengthSquared > 0.0025) {
      const progress = ((currentPosition.x - start.x) * deltaX
        + (currentPosition.z - start.z) * deltaZ) / lengthSquared;
      const projectedX = start.x + deltaX * progress;
      const projectedZ = start.z + deltaZ * progress;
      const lateralOffset = Math.hypot(
        currentPosition.x - projectedX,
        currentPosition.z - projectedZ,
      );
      if (progress >= combatRejoin.minimumProgress
        && progress <= combatRejoin.maximumProgress
        && lateralOffset <= combatRejoin.maximumLateralOffset) {
        return route.slice(combatRejoin.nextWaypointIndex);
      }
    }
  }
  const maximumCorridorOffset = Number(link?.approachContract?.capsuleRadius ?? 0.46) + 0.3;
  for (let index = route.length - 2; index >= 0; index -= 1) {
    const start = route[index];
    const end = route[index + 1];
    if (Math.abs(currentPosition.y - start.y) > 0.2
      || Math.abs(currentPosition.y - end.y) > 0.2) continue;
    const deltaX = end.x - start.x;
    const deltaZ = end.z - start.z;
    const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
    if (lengthSquared <= 0.0025) continue;
    const progress = ((currentPosition.x - start.x) * deltaX
      + (currentPosition.z - start.z) * deltaZ) / lengthSquared;
    if (progress < 0.05 || progress > 1.05) continue;
    const clampedProgress = Math.max(0, Math.min(1, progress));
    const projectedX = start.x + deltaX * clampedProgress;
    const projectedZ = start.z + deltaZ * clampedProgress;
    if (Math.hypot(
      currentPosition.x - projectedX,
      currentPosition.z - projectedZ,
    ) <= maximumCorridorOffset) {
      return route.slice(index + 1);
    }
  }
  return route;
}

/**
 * Walks a plan-owned internal traversal link using only ordinary movement.
 * The route geometry is read through the deep-cloned diagnostics bridge; it
 * is never applied to the live player. Walk-only audits make an unexpected
 * jump, fall, or ledge animation an immediate acceptance failure.
 */
export async function traverseAuthoredLinkPublicly(page, linkId, {
  direction = 'forward',
  timeout = 30_000,
  horizontalTolerance = 0.42,
  verticalTolerance = 0.24,
  forbidJump = false,
  forbidLedgeClimb = false,
  sampleObserver = null,
} = {}) {
  const diagnostics = await readV2Diagnostics(page, 'navigation');
  const link = diagnostics?.navigation?.traversalLinks?.find(({ id }) => id === linkId);
  if (!link) throw new Error(`Diagnostics do not expose authored traversal link ${linkId}.`);
  if (direction === 'reverse' && link.bidirectional === false) {
    throw new Error(`${linkId} is not authored as a bidirectional traversal link.`);
  }

  const fromCenter = surfaceCenter(link.fromSurface);
  const toCenter = surfaceCenter(link.toSurface);
  let route = (link.waypoints ?? []).map((point) => ({ ...point }));
  if (route.length === 0) {
    throw new Error(`${linkId} exposes no physical route waypoints; graph reachability is insufficient.`);
  }
  if (fromCenter && toCenter && route.length > 1) {
    const first = route[0];
    const last = route.at(-1);
    const forwardCost = pointDistance(first, fromCenter) + pointDistance(last, toCenter);
    const reverseCost = pointDistance(last, fromCenter) + pointDistance(first, toCenter);
    if (reverseCost < forwardCost) route.reverse();
  }
  if (direction === 'reverse') {
    route.reverse();
    route.push(...(link.reverseEgressWaypoints ?? []).map((point) => ({ ...point })));
  }

  const movementOptions = {
    timeout,
    horizontalTolerance,
    verticalTolerance,
    forbidJump: link.approachContract?.jumpAllowed === false ? true : forbidJump,
    forbidLedgeClimb: link.approachContract?.ledgeClimbAllowed === false
      ? true
      : forbidLedgeClimb,
    turnWhileAdvancing: link.mode === 'walkable-stairs',
    sampleObserver,
  };
  const approachRoute = getTraversalLinkApproachWaypoints(
    link,
    direction,
    diagnostics.playerPosition,
  );
  for (const [approachIndex, point] of approachRoute.entries()) {
    const sourceSurfaceId = link.approachSurfaceIds?.[approachIndex] ?? null;
    const sourceSurface = link.approachSurfaces?.find(({ id }) => id === sourceSurfaceId);
    const laterApproachPoint = approachRoute.slice(approachIndex + 1)
      .find((candidate) => pointDistance(candidate, point) > 0.05);
    const matchingRouteIndex = route.findIndex((candidate) => pointDistance(candidate, point) <= 0.05);
    const laterRoutePoint = route.slice(Math.max(0, matchingRouteIndex + 1))
      .find((candidate) => pointDistance(candidate, point) > 0.05);
    const nextPoint = laterApproachPoint ?? laterRoutePoint ?? null;
    const capsuleRadius = Number(link.approachContract?.capsuleRadius ?? 0.46);
    const minimumWidth = Number(link.minimumWidth);
    const maximumRiser = Number(link.maximumRiser);
    const approachIngressContract = sourceSurface && nextPoint
      && Number.isFinite(minimumWidth) && minimumWidth > capsuleRadius * 2
      ? {
          targetPoint: point,
          nextPoint,
          surfaceId: sourceSurface.id,
          surfaceBounds: sourceSurface.bounds,
          surfaceTopY: sourceSurface.topY,
          capsuleRadius,
          halfWidth: minimumWidth * 0.5,
          verticalTolerance: Number.isFinite(maximumRiser)
            ? Math.min(0.2, maximumRiser + 0.02)
            : 0.05,
          maximumForwardProgress: capsuleRadius * 2,
        }
      : null;
    await steerToWorldPointPublicly(page, point, {
      ...movementOptions,
      // Plan-owned stair staging exists to align the whole player capsule
      // before the first tread. A broad combat waypoint tolerance would let
      // the driver skip both the staging point and the foot while still under
      // the ramp, recreating the exact false route that this contract closes.
      horizontalTolerance: 0.35,
      verticalTolerance: Math.min(verticalTolerance, 0.2),
      allowJumpRecovery: false,
      turnWhileAdvancing: false,
      forbidJump: link.approachContract?.jumpAllowed === false ? true : forbidJump,
      forbidLedgeClimb: link.approachContract?.ledgeClimbAllowed === false
        ? true
        : forbidLedgeClimb,
      approachIngressContract,
    });
  }
  if (link.mode === 'ladder' && link.viaSurfaceId && route.length >= 4) {
    const ladderId = `${link.viaSurfaceId}:ladder`;
    // A ladder route starts on safe landing space, mounts at the adjacent
    // root, traverses under ladder control, and finishes at the opposite safe
    // exit. Do not feed ordinary walking toward a vertical root: at a top
    // landing that would walk the player into the aperture before pressing E.
    await steerToWorldPointPublicly(page, route[0], movementOptions);
    await steerToWorldPointPublicly(page, route[1], {
      ...movementOptions,
      stopWhenPromptTargetId: ladderId,
    });
    await expect.poll(async () => (
      await readV2Diagnostics(page, 'movement')
    )?.currentPrompt?.targetId, {
      message: `${linkId} never exposed its plan-owned ladder mount`,
      timeout: Math.min(timeout, 5_000),
    }).toBe(ladderId);
    await interact(page);
    await expect.poll(async () => (
      await readV2Diagnostics(page, 'movement')
    )?.ladderTraversal?.ladderId, {
      message: `${linkId} did not mount ${ladderId} through public interaction`,
      timeout: Math.min(timeout, 5_000),
    }).toBe(ladderId);
    await steerToWorldPointPublicly(page, route.at(-1), movementOptions);
  } else {
    for (const point of route) {
      await steerToWorldPointPublicly(page, point, movementOptions);
    }
  }
  const destination = direction === 'reverse' ? fromCenter : toCenter;
  if (destination) {
    const destinationHorizontalTolerance = Number(link.destinationHorizontalTolerance);
    const destinationVerticalTolerance = Number(link.destinationVerticalTolerance);
    await steerToWorldPointPublicly(page, destination, {
      timeout,
      horizontalTolerance: Number.isFinite(destinationHorizontalTolerance)
        ? Math.min(horizontalTolerance, destinationHorizontalTolerance)
        : horizontalTolerance,
      verticalTolerance: Number.isFinite(destinationVerticalTolerance)
        ? Math.min(verticalTolerance, destinationVerticalTolerance)
        : verticalTolerance,
      forbidJump,
      forbidLedgeClimb,
      turnWhileAdvancing: false,
      sampleObserver,
    });
  }
  return readV2Diagnostics(page, 'runtime');
}

export async function steerThroughPortalPublicly(page, portalId, options = {}) {
  const diagnostics = await readV2Diagnostics(page, 'navigation');
  const portal = diagnostics?.navigation?.portals?.find(({ id }) => id === portalId);
  if (!portal) throw new Error(`Diagnostics do not expose authored portal ${portalId}.`);
  const direction = options.direction
    ?? (diagnostics.currentRegionId === portal.to.regionId ? 'reverse' : 'forward');
  const forwards = direction !== 'reverse';
  const fromPoint = { ...portal.from.center, y: portal.from.groundY ?? portal.from.center.y };
  const toPoint = { ...portal.to.center, y: portal.to.groundY ?? portal.to.center.y };
  const rawPoints = forwards
    ? [fromPoint, ...(portal.routePoints ?? []), toPoint]
    : [toPoint, ...(portal.routePoints ?? []).slice().reverse(), fromPoint];
  const points = [];
  for (const point of rawPoints) {
    const previous = points.at(-1);
    if (previous
      && Math.hypot(point.x - previous.x, point.z - previous.z) <= 0.05
      && Math.abs(point.y - previous.y) <= 0.6) {
      continue;
    }
    points.push({ ...point });
  }
  const expectedRegionId = forwards ? portal.to.regionId : portal.from.regionId;
  const destinationEndpoint = forwards ? portal.to : portal.from;
  const originPoint = forwards ? fromPoint : toPoint;
  const destinationPoint = forwards ? toPoint : fromPoint;
  const requiresHorizontalIngress = requiresHorizontalPortalIngressProof(portal);
  const extendsIntoRoom = !['intentional-drop', 'lift', 'gear-platform']
    .includes(portal.traversalMode);
  points[0] = { ...originPoint };
  points[points.length - 1] = { ...destinationPoint };
  const departurePoint = points.find((point, index) => (
    index > 0
    && Math.hypot(point.x - originPoint.x, point.z - originPoint.z) > 0.05
  ));
  const approachPoint = [...points].reverse().find((point, reverseIndex) => (
    reverseIndex > 0
    && Math.hypot(point.x - destinationPoint.x, point.z - destinationPoint.z) > 0.05
  ));
  let ingressPoint = null;
  const interiorIngressDepth = Number.isFinite(portal.interiorIngressDepth)
    ? portal.interiorIngressDepth
    : 1.2;
  if (departurePoint && extendsIntoRoom) {
    const deltaX = departurePoint.x - originPoint.x;
    const deltaZ = departurePoint.z - originPoint.z;
    const horizontalLength = Math.hypot(deltaX, deltaZ);
    // Align with the opening from inside the source room. A capsule cannot
    // occupy a waypoint placed exactly on a blocking wall plane, but walking
    // from this staging point to the first connector point must still cross
    // the authored opening using ordinary controls.
    points[0] = {
      x: originPoint.x - ((deltaX / horizontalLength) * interiorIngressDepth),
      y: originPoint.y,
      z: originPoint.z - ((deltaZ / horizontalLength) * interiorIngressDepth),
    };
  }
  if (approachPoint && extendsIntoRoom) {
    const deltaX = destinationPoint.x - approachPoint.x;
    const deltaZ = destinationPoint.z - approachPoint.z;
    const horizontalLength = Math.hypot(deltaX, deltaZ);
    if (horizontalLength > 0.05) {
      // Portal endpoints lie on the room boundary. Stopping within the normal
      // steering tolerance can leave the player's centre in the connector,
      // even though it visually reached the opening. Continue one body-width
      // into the destination so region entry is proven by physical movement.
      ingressPoint = {
        x: destinationPoint.x + ((deltaX / horizontalLength) * interiorIngressDepth),
        y: destinationPoint.y,
        z: destinationPoint.z + ((deltaZ / horizontalLength) * interiorIngressDepth),
      };
      points[points.length - 1] = ingressPoint;
    }
  }
  const portalIngressContract = requiresHorizontalIngress && ingressPoint ? {
    boundaryPoint: destinationPoint,
    interiorPoint: ingressPoint,
    minimumDepth: interiorIngressDepth,
    halfWidth: Number(destinationEndpoint?.dimensions?.width) * 0.5,
    capsuleRadius: 0.46,
    regionId: expectedRegionId,
    destinationSurfaceId: destinationEndpoint?.surfaceId ?? null,
    surfaceBounds: destinationEndpoint?.surfaceBounds ?? null,
    surfaceTopY: destinationEndpoint?.groundY ?? null,
  } : null;
  const ingressSettleTarget = portalIngressContract
    ? selectPlanOwnedPortalIngressSettleTarget({
      navigation: diagnostics.navigation,
      portalId,
      minimumIngressPoint: ingressPoint,
      destinationSurfaceId: portalIngressContract.destinationSurfaceId,
    })
    : null;
  if (ingressSettleTarget?.doorwayEgress) {
    // Stop on the enclosed connector deck before entering the frame. The
    // next target is derived from the player's physically reached lateral
    // lane, so correction cannot turn diagonally into either jamb.
    points[points.length - 1] = {
      ...ingressSettleTarget.doorwayEgress.exteriorStagingPoint,
    };
    portalIngressContract.surfaceBoundsList = ingressSettleTarget.destinationSurfaceBounds;
  } else if (ingressSettleTarget) {
    // Continue forward on the already validated combat-rejoin surface. This
    // leaves ordinary ground deceleration room after the exact 1.2m ingress
    // proof without reversing toward the doorway or inventing a new route.
    points[points.length - 1] = { ...ingressSettleTarget.position };
  }
  let finalDiagnostics = diagnostics;
  for (const [index, point] of points.entries()) {
    const isIngressPoint = index === points.length - 1 && point === ingressPoint;
    finalDiagnostics = await steerToWorldPointPublicly(page, point, isIngressPoint ? {
      ...options,
      horizontalTolerance: Math.min(options.horizontalTolerance ?? 0.75, 0.2),
      // Region ownership changes at the room boundary, before the player's
      // capsule has cleared the portal frame. Never use that metadata change
      // as a substitute for walking to the authored interior ingress anchor;
      // this must prove the complete 1.2m landing for every connector form.
      stopWhenRegionId: null,
      portalIngressContract,
    } : options);
  }
  if (ingressSettleTarget?.doorwayEgress) {
    const egressTargets = buildPlanOwnedDoorwayEgressTargets(
      finalDiagnostics?.playerPosition,
      ingressSettleTarget.doorwayEgress,
    );
    if (!egressTargets) {
      throw new Error(`Public-input traversal could not derive a supported lane-preserving doorway egress through ${portalId}.`);
    }
    finalDiagnostics = await steerToWorldPointPublicly(page, egressTargets.straightTarget, {
      ...options,
      horizontalTolerance: Math.min(options.horizontalTolerance ?? 0.75, 0.2),
      stopWhenRegionId: null,
      portalIngressContract,
    });
    if (!hasClearedAuthoredPortalIngress(finalDiagnostics, portalIngressContract)) {
      throw new Error(`Public-input traversal did not clear the complete doorway frame through ${portalId}; ${JSON.stringify({
        position: finalDiagnostics?.playerPosition,
        straightTarget: egressTargets.straightTarget,
        laneOffset: egressTargets.laneOffset,
        errors: finalDiagnostics?.errors,
      })}`);
    }
    finalDiagnostics = await steerToWorldPointPublicly(page, egressTargets.recenterTarget, {
      ...options,
      horizontalTolerance: Math.min(options.horizontalTolerance ?? 0.75, 0.2),
      stopWhenRegionId: null,
      portalIngressContract: null,
    });
    if (!hasClearedAuthoredPortalIngress(finalDiagnostics, portalIngressContract)
      || !isPositionWithinPlanOwnedCombatRejoin(
        finalDiagnostics?.playerPosition,
        ingressSettleTarget.contract,
      )) {
      throw new Error(`Public-input traversal did not reach the plan-owned post-frame landing through ${portalId}; ${JSON.stringify({
        position: finalDiagnostics?.playerPosition,
        recenterTarget: egressTargets.recenterTarget,
        combatRejoinId: ingressSettleTarget.combatRejoinId,
        errors: finalDiagnostics?.errors,
      })}`);
    }
  }
  if (requiresHorizontalIngress) {
    if (hasClearedAuthoredPortalIngress(finalDiagnostics, portalIngressContract)) {
      if (!ingressSettleTarget) return finalDiagnostics;
      const provenPosition = { ...finalDiagnostics.playerPosition };
      await page.waitForTimeout(150);
      const settledDiagnostics = await readV2Diagnostics(page, 'movement');
      const settledPosition = settledDiagnostics?.playerPosition;
      const settlingDistance = settledPosition ? Math.hypot(
        settledPosition.x - provenPosition.x,
        settledPosition.y - provenPosition.y,
        settledPosition.z - provenPosition.z,
      ) : Infinity;
      const cleanSettling = publicPortalSettlingIsAccepted({
        provenDiagnostics: finalDiagnostics,
        settledDiagnostics,
        portalIngressContract,
        combatRejoinContract: ingressSettleTarget.contract,
      });
      if (!cleanSettling) {
        throw new Error(`Public-input traversal produced an unsafe post-ingress correction through ${portalId}; ${JSON.stringify({
          provenPosition,
          settledPosition,
          settlingDistance,
          combatRejoinId: ingressSettleTarget.combatRejoinId,
          safeguardActivations: settledDiagnostics?.safeguardActivations,
          errors: settledDiagnostics?.errors,
        })}`);
      }
      finalDiagnostics = settledDiagnostics;
      return finalDiagnostics;
    }
    throw new Error(`Public-input traversal did not prove grounded destination-surface ingress through ${portalId}; ${JSON.stringify({
      position: finalDiagnostics?.playerPosition,
      jumpState: finalDiagnostics?.jumpState,
      regionId: finalDiagnostics?.currentRegionId,
      destinationSurfaceId: portalIngressContract?.destinationSurfaceId,
      destinationPoint,
      ingressPoint,
      errors: finalDiagnostics?.errors,
    })}`);
  }
  const regionDeadline = Date.now() + (options.regionTimeout ?? 5_000);
  while (Date.now() < regionDeadline) {
    finalDiagnostics = await readV2Diagnostics(page, 'movement');
    if (finalDiagnostics?.currentRegionId === expectedRegionId) return finalDiagnostics;
    await page.waitForTimeout(50);
  }
  throw new Error(`Public-input traversal did not physically enter ${expectedRegionId} through ${portalId}; ${JSON.stringify({
    position: finalDiagnostics?.playerPosition,
    yaw: finalDiagnostics?.playerYaw,
    regionId: finalDiagnostics?.currentRegionId,
    destinationPoint,
    ingressPoint: points.at(-1),
    errors: finalDiagnostics?.errors,
  })}`);
}

/**
 * Boards an authored automatic platform with ordinary movement input, remains
 * physically supported for the full transit, and steps onto its useful far
 * landing. This deliberately does not call a mechanism controller or mutate
 * the player: the read-only snapshots are only an observer for the journey.
 */
export async function rideAutomaticSurfacePublicly(page, {
  mechanismId,
  surfaceId,
  boardingWaypoints = [],
  boardingCenter = null,
  boardingStateId,
  destinationCenter = null,
  destinationStateId,
  destinationLandingPoint = null,
  timeout = 50_000,
}) {
  let derivedLandings = null;
  if (!boardingCenter || !destinationCenter || !destinationLandingPoint) {
    const navigationDiagnostics = await readV2Diagnostics(page, 'navigation');
    derivedLandings = resolveAutomaticSurfaceLandingContracts(
      navigationDiagnostics.navigation,
      mechanismId,
      surfaceId,
      navigationDiagnostics.playerPosition,
    );
    if (!derivedLandings) {
      throw new Error(`${mechanismId}/${surfaceId} does not expose two plan-owned useful landing contracts.`);
    }
    await steerToWorldPointPublicly(page, derivedLandings.boarding.center, {
      horizontalTolerance: 0.48,
      verticalTolerance: 0.34,
      timeout: Math.min(timeout, 20_000),
      allowJumpRecovery: false,
      forbidJump: true,
      forbidLedgeClimb: true,
    });
  }
  for (const waypoint of boardingWaypoints) {
    await steerToWorldPointPublicly(page, waypoint, {
      horizontalTolerance: 0.48,
      verticalTolerance: 0.34,
      timeout: Math.min(timeout, 20_000),
      allowJumpRecovery: false,
      forbidJump: true,
      forbidLedgeClimb: true,
    });
  }

  const started = Date.now();
  let boardedSnapshot = null;
  while (Date.now() - started < timeout) {
    const diagnostics = await readV2Diagnostics(page, 'runtime');
    const mechanism = diagnostics?.mechanisms?.find(({ id }) => id === mechanismId);
    const surface = diagnostics?.dynamicSurfaces?.find((entry) => entry.surfaceId === surfaceId);
    if (!mechanism || !surface?.center) {
      throw new Error(`Runtime diagnostics do not expose automatic surface ${mechanismId}/${surfaceId}.`);
    }
    const expectedBoardingCenter = boardingCenter ?? derivedLandings.boarding.center;
    const atBoardingPose = mechanism.stateId === boardingStateId
      && Math.hypot(
        surface.center.x - expectedBoardingCenter.x,
        surface.center.y - expectedBoardingCenter.y,
        surface.center.z - expectedBoardingCenter.z,
      ) <= (boardingCenter ? 0.18 : Math.max(surface.halfWidth, surface.halfDepth) + 0.8);
    if (!atBoardingPose) {
      await page.waitForTimeout(50);
      continue;
    }

    try {
      await steerToWorldPointPublicly(page, {
        x: surface.center.x,
        y: surface.topY,
        z: surface.center.z,
      }, {
        horizontalTolerance: 0.42,
        verticalTolerance: 0.24,
        timeout: 2_200,
        allowJumpRecovery: false,
        forbidJump: true,
        forbidLedgeClimb: true,
      });
    } catch {
      // The automatic dwell can expire while the player is stepping aboard.
      // Wait for the next authored cycle and try again through public input.
      continue;
    }
    const candidate = await readV2Diagnostics(page, 'runtime');
    const candidateSurface = candidate.dynamicSurfaces.find((entry) => entry.surfaceId === surfaceId);
    const player = candidate.playerPosition;
    if (candidateSurface?.center && player
      && Math.abs(player.x - candidateSurface.center.x) <= candidateSurface.halfWidth - 0.12
      && Math.abs(player.z - candidateSurface.center.z) <= candidateSurface.halfDepth - 0.12
      && Math.abs(player.y - candidateSurface.topY) <= 0.24) {
      boardedSnapshot = candidate;
      break;
    }
  }
  if (!boardedSnapshot) {
    throw new Error(`Public-input journey could not board ${mechanismId} at its authored landing.`);
  }

  const boardedPosition = { ...boardedSnapshot.playerPosition };
  const observedBoardingCenter = { ...boardedSnapshot.dynamicSurfaces
    .find((entry) => entry.surfaceId === surfaceId).center };
  let sawUsefulMotion = false;
  let arrivedSnapshot = null;
  while (Date.now() - started < timeout) {
    const diagnostics = await readV2Diagnostics(page, 'runtime');
    const mechanism = diagnostics.mechanisms.find(({ id }) => id === mechanismId);
    const surface = diagnostics.dynamicSurfaces.find((entry) => entry.surfaceId === surfaceId);
    const player = diagnostics.playerPosition;
    const routeDisplacement = Math.hypot(
      surface.center.x - observedBoardingCenter.x,
      surface.center.y - observedBoardingCenter.y,
      surface.center.z - observedBoardingCenter.z,
    );
    if (routeDisplacement > 0.75) {
      sawUsefulMotion = true;
      expect(Math.abs(player.x - surface.center.x)).toBeLessThanOrEqual(surface.halfWidth + 0.1);
      expect(Math.abs(player.z - surface.center.z)).toBeLessThanOrEqual(surface.halfDepth + 0.1);
      expect(Math.abs(player.y - surface.topY)).toBeLessThanOrEqual(0.28);
    }
    const arrived = mechanism.stateId === destinationStateId
      && (destinationCenter ? Math.hypot(
        surface.center.x - destinationCenter.x,
        surface.center.y - destinationCenter.y,
        surface.center.z - destinationCenter.z,
      ) <= 0.18 : routeDisplacement > 3);
    if (arrived) {
      arrivedSnapshot = diagnostics;
      break;
    }
    await page.waitForTimeout(50);
  }
  if (!arrivedSnapshot || !sawUsefulMotion) {
    throw new Error(`${mechanismId} did not carry the player to its useful far landing.`);
  }
  expect(Math.hypot(
    arrivedSnapshot.playerPosition.x - boardedPosition.x,
    arrivedSnapshot.playerPosition.y - boardedPosition.y,
    arrivedSnapshot.playerPosition.z - boardedPosition.z,
  )).toBeGreaterThan(3);

  if (!destinationLandingPoint) {
    const arrivedSurface = arrivedSnapshot.dynamicSurfaces
      .find((entry) => entry.surfaceId === surfaceId);
    const candidates = [...derivedLandings.destinations].sort((left, right) => {
      const distance = (landing) => Math.hypot(
        landing.center.x - arrivedSurface.center.x,
        landing.center.y - arrivedSurface.topY,
        landing.center.z - arrivedSurface.center.z,
      );
      return distance(left) - distance(right) || left.surfaceId.localeCompare(right.surfaceId);
    });
    destinationLandingPoint = candidates[0]?.center ?? null;
    if (!destinationLandingPoint) {
      throw new Error(`${mechanismId} arrived without a distinct plan-owned destination landing.`);
    }
  }

  await steerToWorldPointPublicly(page, destinationLandingPoint, {
    horizontalTolerance: 0.52,
    verticalTolerance: 0.3,
    timeout: 8_000,
    allowJumpRecovery: false,
    forbidJump: true,
    forbidLedgeClimb: true,
  });
  return readV2Diagnostics(page, 'runtime');
}

export async function operateActionPublicly(page, actionId, {
  timeout = 20_000,
  horizontalTolerance = 0.55,
  whenMechanism = null,
  stageEitherSide = false,
  beforeInteract = null,
} = {}) {
  // Runtime snapshots expose the authoritative operation counter without the
  // multi-megabyte structural registry included by the `full` profile. On the
  // native V1-backed golden complex, serializing that registry can take longer
  // than this interaction assertion's entire timeout even though the public E
  // input has already succeeded.
  const before = await readV2Diagnostics(page, 'runtime');
  const priorOperationCount = before?.actionOperationCounts?.[actionId] ?? 0;
  const diagnostics = await readV2Diagnostics(page, 'navigation');
  const action = diagnostics?.navigation?.actionAnchors?.find((entry) => entry.actionId === actionId);
  if (!action?.position) throw new Error(`Diagnostics do not expose a physical anchor for ${actionId}.`);
  // Stay on the authored side pad. A long generic staging offset can walk off
  // a narrow console landing before the actual interaction is attempted.
  const { eitherSide, approach, staging } = getPublicActionApproachPoints(
    action,
    diagnostics.playerPosition,
  );
  if (!eitherSide || stageEitherSide) {
    await steerToWorldPointPublicly(page, staging, {
      horizontalTolerance: 0.7,
      verticalTolerance: 0.9,
      timeout,
    });
  }
  await steerToWorldPointPublicly(page, approach, {
    horizontalTolerance,
    verticalTolerance: 0.9,
    timeout,
    stopWhenPromptActionId: actionId,
  });
  await expect.poll(async () => (
    await readV2Diagnostics(page, 'movement')
  )?.currentPrompt?.actionId, {
    message: `${actionId} never became the nearest public interaction`,
    timeout: Math.min(timeout, 5_000),
  }).toBe(actionId);
  if (whenMechanism) {
    await expect.poll(async () => {
      const runtime = await readV2Diagnostics(page, 'runtime');
      return runtime?.mechanisms?.find(({ id }) => id === whenMechanism.id)?.stateId ?? null;
    }, {
      message: `${actionId} never became legal in ${whenMechanism.id}:${whenMechanism.stateId}`,
      timeout: Math.min(timeout, 12_000),
      intervals: [25, 25, 50, 50],
    }).toBe(whenMechanism.stateId);
    await expect.poll(async () => (
      await readV2Diagnostics(page, 'movement')
    )?.currentPrompt?.actionId, {
      message: `${actionId} ceased to be the nearest interaction while awaiting its legal mechanism state`,
      timeout: 1_000,
    }).toBe(actionId);
  }
  if (beforeInteract !== null) {
    if (typeof beforeInteract !== 'function') {
      throw new Error(`${actionId} beforeInteract must be a read-only journey callback.`);
    }
    const interactionDiagnostics = await readV2Diagnostics(page, 'full');
    await beforeInteract(Object.freeze({
      action,
      approach: Object.freeze({ ...approach }),
      staging: Object.freeze({ ...staging }),
      diagnostics: interactionDiagnostics,
    }));
  }
  await interact(page);
  await expect.poll(async () => (
    await readV2Diagnostics(page, 'runtime')
  )?.actionOperationCounts?.[actionId] ?? 0, {
    message: `${actionId} did not apply through public interaction input`,
    timeout: Math.min(timeout, 5_000),
  }).toBeGreaterThan(priorOperationCount);
  if (!eitherSide || stageEitherSide) {
    await steerToWorldPointPublicly(page, staging, {
      horizontalTolerance: 0.7,
      verticalTolerance: 0.9,
      timeout: Math.min(timeout, 8_000),
    });
  }
  return readV2Diagnostics(page, 'runtime');
}

export async function defeatEncounterPublicly(page, encounterId, {
  timeout = 90_000,
} = {}) {
  let diagnostics = await readV2Diagnostics(page, 'full');
  const combatNavigation = diagnostics?.navigation ?? null;
  const encounter = diagnostics?.navigation?.encounters?.find((entry) => (
    entry.encounterId === encounterId
  ));
  if (!encounter?.position) throw new Error(`Diagnostics do not expose ${encounterId}'s authored arena anchor.`);
  if (diagnostics.completedEncounterIds?.includes(encounterId)) return diagnostics;
  let encounterAlreadyActive = diagnostics.activeEnemies?.some((enemy) => (
    enemy.encounterId === encounterId
  ));
  if (!encounterAlreadyActive) {
    // Enter only as far as necessary to trigger the authored encounter. The
    // former helper always walked to the mathematical arena centre, which put
    // the player beneath Assembly's catwalk before combat had even started.
    // A human approaching an occupied chamber stops at a visible firing lane;
    // these successively closer public-input waypoints do the same while still
    // proving that the actual seeded trigger volume spawns the encounter.
    const approachOrigin = diagnostics.playerPosition;
    const awayX = approachOrigin.x - encounter.position.x;
    const awayZ = approachOrigin.z - encounter.position.z;
    const awayLength = Math.hypot(awayX, awayZ);
    const direction = awayLength > 0.05
      ? { x: awayX / awayLength, z: awayZ / awayLength }
      : { x: Math.sin(diagnostics.playerYaw ?? 0), z: Math.cos(diagnostics.playerYaw ?? 0) };
    for (const standoffDistance of [8, 6, 4, 2, 0]) {
      await steerToWorldPointPublicly(page, {
        x: encounter.position.x + direction.x * standoffDistance,
        y: encounter.position.y,
        z: encounter.position.z + direction.z * standoffDistance,
      }, {
        horizontalTolerance: 0.9,
        verticalTolerance: 1.2,
        timeout: Math.min(timeout, 12_000),
        allowJumpRecovery: true,
        stopWhenEncounterId: encounterId,
      });
      diagnostics = await readV2Diagnostics(page, 'runtime');
      encounterAlreadyActive = diagnostics.activeEnemies?.some((enemy) => (
        enemy.encounterId === encounterId
      ));
      if (encounterAlreadyActive) break;
    }
    if (!encounterAlreadyActive) {
      throw new Error(`${encounterId} did not activate through its seeded physical trigger volume.`);
    }
  }

  // The acceptance journey uses the invariant starter Mega Buster and swaps
  // to it through the same public hotbar input available to the player.
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(380);

  let started = Date.now();
  let attackCycle = 0;
  let lastTotalEnemyHealth = Infinity;
  let lastDamageAt = Date.now();
  let lastClearanceAt = -Infinity;
  let raisedCombatLane = null;
  const attemptedRaisedLinks = new Set();
  while (Date.now() - started < timeout) {
    diagnostics = await readV2Diagnostics(page, 'runtime');
    if (diagnostics.completedEncounterIds?.includes(encounterId)) return diagnostics;
    if (Number.isFinite(diagnostics.health) && diagnostics.health <= 0) {
      throw new Error(`Player was defeated during the real-combat ${encounterId} journey.`);
    }
    const preLockRaisedEnemyId = raisedCombatLane && !diagnostics.lockOnTargetId
      ? raisedCombatLane.targetEnemyId
      : null;
    const combatSelection = selectEncounterCombatTarget(
      diagnostics,
      encounterId,
      preLockRaisedEnemyId,
      { preferGroundBeforeRaisedTraversal: !raisedCombatLane },
    );
    const { enemies, target, totalEnemyHealth } = combatSelection;
    if (enemies.length === 0) {
      await page.waitForTimeout(120);
      continue;
    }
    const playerPosition = diagnostics.playerPosition;
    // Movement and shots must reason about the enemy the game actually locked.
    // The old helper chased the nearest ground enemy while every shot remained
    // aimed at a different elevated weak point behind solid catwalk geometry.
    if (!target) {
      await page.waitForTimeout(120);
      continue;
    }
    if (totalEnemyHealth < lastTotalEnemyHealth - 0.01) lastDamageAt = Date.now();
    lastTotalEnemyHealth = Math.min(lastTotalEnemyHealth, totalEnemyHealth);
    const secondsWithoutDamage = (Date.now() - lastDamageAt) / 1000;
    const secondsSinceClearance = (Date.now() - lastClearanceAt) / 1000;

    const groundClearanceAction = !raisedCombatLane
      ? getPreRaisedGroundClearanceAction(diagnostics, target, enemies)
      : null;
    if (groundClearanceAction === 'wait') {
      const engagementAdvance = selectPlanOwnedGroundEngagementAdvance({
        navigation: combatNavigation,
        encounterId,
        target,
        playerPosition,
      });
      if (engagementAdvance) {
        // Some generated ground enemies legitimately hold just outside the
        // starter Buster's lock range. Advance only along the encounter's
        // exact, sampled-clear combat rejoin segment; never chase an arbitrary
        // live position or leave the authored stair approach.
        await steerToWorldPointPublicly(page, engagementAdvance.position, {
          horizontalTolerance: Math.min(0.2, engagementAdvance.sampleSpacing),
          verticalTolerance: 0.08,
          timeout: Math.min(timeout, 8_000),
          allowJumpRecovery: false,
          forbidJump: true,
          forbidLedgeClimb: true,
        });
      } else {
        await page.waitForTimeout(180);
      }
      continue;
    }
    if (groundClearanceAction === 'lock') {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(160);
      continue;
    }
    if (groundClearanceAction === 'fire') {
      await fireWhileHoldingPublicInputs(page, [], 900);
      attackCycle += 1;
      continue;
    }

    const raisedLaneAction = getRaisedCombatLaneAction(
      raisedCombatLane,
      target,
      playerPosition,
      secondsWithoutDamage,
    );
    if (raisedLaneAction === 'lost') {
      raisedCombatLane = null;
    } else if (raisedLaneAction === 'leave') {
      await traverseAuthoredLinkPublicly(page, raisedCombatLane.linkId, {
        direction: raisedCombatLane.returnDirection,
        timeout: 45_000,
        horizontalTolerance: 0.8,
        verticalTolerance: 0.35,
      });
      raisedCombatLane = null;
      lastDamageAt = Date.now();
      lastClearanceAt = -Infinity;
      started = Date.now();
      continue;
    } else if (raisedLaneAction === 'hold') {
      // An authored high route is useful only if the journey actually holds
      // it. Strafing here can walk straight off a catwalk and recreate the
      // obstructed ground shot that prompted the reposition in the first
      // place. Fire from the stable deck until the target transfers or the
      // lane is conclusively stale, then leave through the same route.
      if (!diagnostics.lockOnTargetId) {
        // Tab selects the nearest enemy, not the retained elevated enemy. In
        // Assembly that locked the ground Reaverbot beneath this catwalk and
        // immediately forced a hazardous reverse traversal through both
        // bodies. Aim the ordinary reticle with tank turns and fire from the
        // authored lane; any lock acquired by the game remains authoritative.
        const aimAction = getPublicCombatAimAction(
          diagnostics.playerYaw,
          playerPosition,
          target.enemy.position,
        );
        if (aimAction?.kind === 'turn') {
          await holdPublicInput(page, aimAction.key, aimAction.duration);
        } else {
          await fireWhileHoldingPublicInputs(page, [], 900);
        }
        continue;
      }
      await fireWhileHoldingPublicInputs(page, [], 1_100);
      attackCycle += 1;
      continue;
    }

    if (!diagnostics.lockOnTargetId && target.horizontalDistance <= 6.7) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(160);
      continue;
    }

    // A visible enemy already occupying a high authored lane should not be
    // approached by running underneath it merely to acquire Tab lock. A
    // player can read that elevation and take the room's stairs first.
    const shouldTakeRaisedRoute = publicCombatShouldTakeRaisedRoute(
      diagnostics,
      target,
      secondsWithoutDamage,
    );
    if (shouldTakeRaisedRoute) {
      const raisedRoute = selectRaisedCombatTraversalLink({
        ...diagnostics,
        navigation: combatNavigation,
      }, target);
      if (raisedRoute && !attemptedRaisedLinks.has(raisedRoute.linkId)) {
        attemptedRaisedLinks.add(raisedRoute.linkId);
        if (publicCombatTraversalRequiresLockRelease(diagnostics, raisedRoute)) {
          // Tab lock changes A/D from tank turns into strafing. Release it
          // through the public control before following an authored stair or
          // ladder; otherwise the helper can arrive underneath the route's
          // upper X/Z endpoint without ever aligning to the slope.
          await page.keyboard.press('Tab');
          await expect.poll(async () => (
            await readV2Diagnostics(page, 'runtime')
          )?.lockOnTargetId ?? null, {
            message: `Public lock remained active before ${raisedRoute.linkId} traversal`,
            timeout: 2_000,
            intervals: [25, 50, 100],
          }).toBeNull();
        }
        await traverseAuthoredLinkPublicly(page, raisedRoute.linkId, {
          direction: raisedRoute.direction,
          timeout: 45_000,
          horizontalTolerance: 0.8,
          verticalTolerance: 0.35,
        });
        diagnostics = await readV2Diagnostics(page, 'runtime');
        raisedCombatLane = {
          ...raisedRoute,
          targetEnemyId: target.enemy.id,
          surfaceY: diagnostics.playerPosition?.y ?? raisedRoute.surfaceY,
        };
        lastDamageAt = Date.now();
        lastClearanceAt = -Infinity;
        started = Date.now();
        continue;
      }
    }

    if (target.horizontalDistance > 6.45) {
      const desiredYaw = Math.atan2(
        target.enemy.position.x - playerPosition.x,
        target.enemy.position.z - playerPosition.z,
      );
      const yawDelta = signedYawDelta(diagnostics.playerYaw, desiredYaw);
      if (diagnostics.lockOnTargetId) {
        // Give the activated enemy time to enter the player's clear firing
        // lane. Only take a bounded step forward after a genuine lull; blindly
        // pursuing every moving snapshot recreated the obstruction failure.
        if (secondsWithoutDamage > 3.5) {
          await holdPublicInput(page, 'KeyW', 180);
        } else {
          await page.waitForTimeout(180);
        }
      } else if (Math.abs(yawDelta) > 0.36) {
        await holdPublicInput(
          page,
          yawDelta > 0 ? 'KeyA' : 'KeyD',
          Math.min(180, Math.max(45, Math.abs(yawDelta) * 110)),
        );
      } else {
        await holdPublicInput(page, 'KeyW', target.horizontalDistance > 11 ? 280 : 160);
      }
      attackCycle += 1;
      continue;
    }

    // Back away from body overlap and from the underside of an elevated
    // target. This creates an honest line of sight instead of allowing the
    // helper to spend its entire timeout firing into a ramp or catwalk.
    const needsClearance = publicCombatLaneNeedsClearance(
      target,
      secondsWithoutDamage,
      secondsSinceClearance,
    );
    if (needsClearance && diagnostics.lockOnTargetId) {
      const strafeKey = Math.floor(attackCycle / 2) % 2 === 0 ? 'KeyA' : 'KeyD';
      await holdPublicInputs(page, ['KeyS', strafeKey], target.verticalDistance > 1.35 ? 520 : 360);
      lastClearanceAt = Date.now();
      attackCycle += 1;
      continue;
    }

    // One sustained public-input burst covers the fixed pulse's brace and
    // normal firing cycle. Strafing during the burst mirrors ordinary play and
    // avoids a stationary collision pile-up without changing any game state.
    const strafeKey = Math.floor(attackCycle / 3) % 2 === 0 ? 'KeyA' : 'KeyD';
    await fireWhileHoldingPublicInputs(
      page,
      target.verticalDistance <= 1.35 ? [] : [strafeKey],
      900,
    );
    attackCycle += 1;
  }
  diagnostics = await readV2Diagnostics(page, 'runtime');
  throw new Error(`Real combat did not clear ${encounterId} within ${timeout}ms; ${JSON.stringify({
    playerPosition: diagnostics.playerPosition,
    health: diagnostics.health,
    lockOnTargetId: diagnostics.lockOnTargetId,
    activeEnemies: diagnostics.activeEnemies,
    currentRegionId: diagnostics.currentRegionId,
    cameraContainmentAdjustments: diagnostics.cameraContainmentAdjustments,
    lastCameraContainment: diagnostics.lastCameraContainment,
    safeguardActivations: diagnostics.safeguardActivations,
    errors: diagnostics.errors,
  })}`);
}

export async function traverseAuthoredFallPublicly(page, fallId, {
  timeout = 20_000,
  walkReturnRoute = false,
} = {}) {
  let diagnostics = await readV2Diagnostics(page, 'runtime');
  const fall = diagnostics.falls?.find((entry) => entry.id === fallId);
  if (!fall) throw new Error(`Diagnostics do not expose authored fall ${fallId}.`);
  const target = {
    x: (fall.trajectoryBounds.min.x + fall.trajectoryBounds.max.x) * 0.5,
    y: fall.sourceSurfaceTopY,
    z: (fall.trajectoryBounds.min.z + fall.trajectoryBounds.max.z) * 0.5,
  };
  await steerToWorldPointPublicly(page, target, {
    horizontalTolerance: 0.45,
    verticalTolerance: 0.8,
    timeout,
  });
  await expect.poll(async () => {
    diagnostics = await readV2Diagnostics(page, 'runtime');
    return Math.abs((diagnostics.playerPosition?.y ?? Infinity) - fall.catchmentY);
  }, {
    message: `${fallId} did not physically land in its authored playable catchment`,
    timeout: Math.min(timeout, 12_000),
  }).toBeLessThanOrEqual(0.08);
  if (walkReturnRoute) {
    for (const waypoint of fall.returnWaypoints ?? []) {
      await steerToWorldPointPublicly(page, waypoint, {
        horizontalTolerance: 0.65,
        verticalTolerance: 0.8,
        timeout,
      });
    }
  }
  diagnostics = await readV2Diagnostics(page, 'runtime');
  if (diagnostics.safeguardActivations !== 0) {
    throw new Error(`${fallId} activated the physics recovery safeguard.`);
  }
  return diagnostics;
}
