import { test, expect } from '@playwright/test';
import {
  PUBLIC_INPUT_JOURNEY,
  operateActionPublicly,
  readV2Diagnostics,
  rideAutomaticSurfacePublicly,
  steerThroughPortalPublicly,
  steerToWorldPointPublicly,
  traverseAuthoredFallPublicly,
  traverseAuthoredLinkPublicly,
  waitForV2Runtime,
} from '../helpers/journey-runtime.mjs';

void PUBLIC_INPUT_JOURNEY;

const LAB_REGION_IDS = [
  'lab-entry',
  'lab-stairs',
  'lab-upper',
  'lab-water-freight',
  'lab-water-reservoir',
  'lab-water-gantry',
  'lab-hazards',
  'lab-gear',
  'lab-recovery',
];

function exactIds(actual, expected) {
  expect([...new Set(actual)].sort()).toEqual([...expected].sort());
}

function walkOnlyOptions(extra = {}) {
  return {
    forbidJump: true,
    forbidLedgeClimb: true,
    allowJumpRecovery: false,
    ...extra,
  };
}

async function waitForWaterConfiguration(page, configurationId) {
  await expect.poll(async () => {
    const diagnostics = await readV2Diagnostics(page, 'runtime');
    return diagnostics?.waterTransfer?.phase === 'idle'
      ? diagnostics.waterConfigurationId
      : `transferring:${diagnostics?.waterConfigurationId}`;
  }, {
    message: `Waterworks never atomically committed ${configurationId}`,
    timeout: 12_000,
  }).toBe(configurationId);
}

async function waitForMechanismState(page, mechanismId, stateId, timeout = 15_000) {
  await expect.poll(async () => (
    await readV2Diagnostics(page, 'runtime')
  )?.mechanisms?.find(({ id }) => id === mechanismId)?.stateId ?? null, {
    message: `${mechanismId} never reached ${stateId}`,
    timeout,
    intervals: [25, 50, 50, 100],
  }).toBe(stateId);
}

function createLadderAudit(label) {
  const audit = {
    label,
    sawMounted: false,
    minimumHeight: Infinity,
    maximumHeight: -Infinity,
    samples: 0,
    sample(diagnostics) {
      expect(diagnostics.ledgeCling, `${label} substituted ledge climbing for its ladder.`)
        .toBeNull();
      if (!diagnostics.ladderTraversal) return;
      audit.sawMounted = true;
      audit.samples += 1;
      audit.minimumHeight = Math.min(audit.minimumHeight, diagnostics.ladderTraversal.height);
      audit.maximumHeight = Math.max(audit.maximumHeight, diagnostics.ladderTraversal.height);
      expect(diagnostics.animationState).toBe('climbingLadder');
      expect(diagnostics.fbxAnimationLoadState?.clips,
        `${label} mounted before the authoritative ladder FBX loaded.`).toContain('climbingLadder');
      expect(diagnostics.activeFbxAnimationClip,
        `${label} did not render the authoritative ladder FBX clip.`).toBe('climbingLadder');
      const traversal = diagnostics.ladderTraversal;
      expect(Number.isFinite(traversal.signedPlaneClearance),
        `${label} did not expose a finite visual-plane clearance.`).toBe(true);
      expect(Math.abs(traversal.signedPlaneClearance - traversal.bodyClearance),
        `${label} player root left its authored line in front of the rungs.`).toBeLessThanOrEqual(0.01);
      expect(traversal.facingAlignment,
        `${label} character faced away from the visual rung plane.`).toBeGreaterThanOrEqual(0.999);
    },
    assertComplete(finalDiagnostics, minimumSpan = 1) {
      expect(audit.sawMounted, `${label} never mounted through public interaction input.`).toBe(true);
      expect(audit.samples, `${label} exposed no physical climbing frames.`).toBeGreaterThan(1);
      expect(
        audit.maximumHeight - audit.minimumHeight,
        `${label} mounted but did not climb a meaningful vertical span.`,
      ).toBeGreaterThan(minimumSpan);
      expect(finalDiagnostics.ladderTraversal, `${label} did not exit the ladder.`).toBeNull();
      expect(finalDiagnostics.ledgeCling, `${label} exited through a ledge climb.`).toBeNull();
    },
  };
  return audit;
}

function createStackedSlopeNoWarpAudit(label) {
  const audit = {
    label,
    samples: 0,
    minimumHeight: Infinity,
    maximumHeight: -Infinity,
    previousHeight: null,
    sample(diagnostics) {
      const height = diagnostics.playerPosition?.y;
      expect(Number.isFinite(height), `${label} exposed a non-finite player height.`).toBe(true);
      expect(diagnostics.currentRegionId,
        `${label} changed region ownership while walking the lower authored stair.`)
        .toBe('lab-recovery');
      expect(height,
        `${label} dropped below its supported lower landing.`).toBeGreaterThanOrEqual(-10.05);
      expect(height,
        `${label} was captured by the vertically overlapping upper gear-room stair.`)
        .toBeLessThanOrEqual(-6.25);
      if (audit.previousHeight !== null) {
        expect(Math.abs(height - audit.previousHeight),
          `${label} changed elevation discontinuously between public-input samples.`)
          .toBeLessThan(4);
      }
      audit.samples += 1;
      audit.minimumHeight = Math.min(audit.minimumHeight, height);
      audit.maximumHeight = Math.max(audit.maximumHeight, height);
      audit.previousHeight = height;
    },
    assertComplete(finalDiagnostics) {
      expect(audit.samples, `${label} exposed too few physical walking samples.`).toBeGreaterThan(2);
      expect(audit.maximumHeight - audit.minimumHeight,
        `${label} did not physically traverse the lower stair's three-metre elevation change.`)
        .toBeGreaterThan(2.4);
      expect(finalDiagnostics.currentRegionId).toBe('lab-recovery');
      expect(finalDiagnostics.playerPosition.y,
        `${label} did not step onto the supported lower landing.`).toBeLessThanOrEqual(-9.3);
      expect(finalDiagnostics.jumpState).toBe('Grounded');
      expect(finalDiagnostics.ledgeCling).toBeNull();
      expect(finalDiagnostics.safeguardActivations).toBe(0);
    },
  };
  return audit;
}

async function exerciseFloodedProfile(page) {
  const before = await readV2Diagnostics(page, 'runtime');
  expect(before.currentRegionId).toBe('lab-water-freight');
  expect(before.waterConfigurationId).toBe('FreightSumpFilled');
  expect(before.environmentalTraversal).toEqual({
    flooded: true,
    movementMultiplier: 0.76,
    jumpHeight: 4.95,
    gravityScale: 0.28,
    takeoffCaptured: false,
  });
  const healthBefore = before.health;
  const startY = before.playerPosition.y;
  const samples = [];

  await page.keyboard.press('Space');
  let sawRising = false;
  let sawFalling = false;
  let landed = null;
  const deadline = Date.now() + 9_000;
  while (Date.now() < deadline) {
    const diagnostics = await readV2Diagnostics(page, 'runtime');
    samples.push({
      heartbeat: diagnostics.frameHeartbeat,
      y: diagnostics.playerPosition.y,
      jumpState: diagnostics.jumpState,
      traversal: diagnostics.environmentalTraversal,
    });
    if (diagnostics.jumpState === 'Rising') sawRising = true;
    if (diagnostics.jumpState === 'Falling') sawFalling = true;
    if (['Rising', 'Falling'].includes(diagnostics.jumpState)) {
      expect(diagnostics.environmentalTraversal).toEqual({
        flooded: true,
        movementMultiplier: 0.76,
        jumpHeight: 4.95,
        gravityScale: 0.28,
        takeoffCaptured: true,
      });
    }
    if (sawRising && sawFalling && diagnostics.jumpState === 'Grounded') {
      landed = diagnostics;
      break;
    }
    await page.waitForTimeout(25);
  }

  expect(sawRising, `Flooded jump never rose: ${JSON.stringify(samples.slice(-12))}`).toBe(true);
  expect(sawFalling, `Flooded jump never fell: ${JSON.stringify(samples.slice(-12))}`).toBe(true);
  expect(landed, `Flooded jump never landed: ${JSON.stringify(samples.slice(-12))}`).toBeTruthy();
  const apex = Math.max(...samples.map(({ y }) => y));
  expect(apex - startY).toBeGreaterThanOrEqual(4.7);
  expect(apex - startY).toBeLessThanOrEqual(5.1);
  expect(landed.playerPosition.y).toBeCloseTo(startY, 1);
  expect(landed.health).toBe(healthBefore);
  expect(landed.safeguardActivations).toBe(0);
}

async function observeHazardsFromSafeRoute(page) {
  const before = await readV2Diagnostics(page, 'runtime');
  const healthBefore = before.health;
  const observed = new Map(before.hazardPhases.map(({ id, phase }) => [id, new Set([phase])]));
  const observe = (diagnostics) => {
    for (const hazard of diagnostics.hazardPhases ?? []) {
      if (!observed.has(hazard.id)) observed.set(hazard.id, new Set());
      observed.get(hazard.id).add(hazard.phase);
    }
  };

  // This four-metre service aisle runs between the two authored floor lanes.
  // It crosses their full east/west span while remaining outside both hazard
  // volumes, so damage-free traversal is demonstrated physically rather than
  // by waiting at the entrance.
  for (const point of [
    { x: 132, y: -9.65, z: 37 },
    { x: 158, y: -9.65, z: 37 },
    { x: 132, y: -9.65, z: 37 },
  ]) {
    await steerToWorldPointPublicly(page, point, walkOnlyOptions({
      horizontalTolerance: 0.45,
      verticalTolerance: 0.25,
      timeout: 25_000,
    }));
    observe(await readV2Diagnostics(page, 'runtime'));
  }

  const phaseDeadline = Date.now() + 5_500;
  while (Date.now() < phaseDeadline) {
    const diagnostics = await readV2Diagnostics(page, 'runtime');
    observe(diagnostics);
    const electrical = observed.get('environment.lab-electrical') ?? new Set();
    if (['safe', 'charging', 'energized'].every((phase) => electrical.has(phase))) break;
    await page.waitForTimeout(50);
  }

  const after = await readV2Diagnostics(page, 'runtime');
  expect(observed.get('environment.lab-magma')).toContain('active');
  expect(observed.get('environment.lab-electrical')).toEqual(
    new Set(['safe', 'charging', 'energized']),
  );
  expect(after.health).toBe(healthBefore);
  expect(after.hazardExposure.filter(({ key }) => key.endsWith(':player'))).toEqual([]);
  expect(after.safeguardActivations).toBe(0);
}

test('PUBLIC_INPUT_JOURNEY: traversal lab physically exercises every authored mechanism and region', async ({ page }) => {
  test.setTimeout(420_000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?dungeonGen=v2&v2Fixture=traversal-lab&seed=m1-traversal-lab-public');
  const initial = await waitForV2Runtime(page);
  expect(initial.fixtureId).toBe('traversal-lab-mechanisms');
  expect(initial.buildFingerprint).toBe(
    'dungeon-v2/restart-m1/schema-1/traversal-lab/mechanisms/layout:m1-traversal-lab-public',
  );

  // Floor one to floor three: every stair is traversed with W/A/D only. A
  // single jump, fall state, or ledge animation is a hard failure.
  await steerThroughPortalPublicly(page, 'portal.lab-entry-stairs', walkOnlyOptions({ timeout: 30_000 }));
  await traverseAuthoredLinkPublicly(page, 'traversal.lab-stairs.lab-stairs-upper',
    walkOnlyOptions({ timeout: 35_000 }));
  await steerThroughPortalPublicly(page, 'portal.lab-stairs-upper',
    walkOnlyOptions({ timeout: 35_000 }));

  // Board at a flush elevated landing, ride to a useful far landing, and ride
  // back. Direct steering to the far room would hide a disconnected platform.
  await rideAutomaticSurfacePublicly(page, {
    mechanismId: 'mechanism.lab-auto-cargo',
    surfaceId: 'surface.lab-upper.auto-cargo',
    boardingStateId: 'Near',
    boardingCenter: { x: 95.6, y: 10.125, z: 0 },
    boardingWaypoints: [{ x: 101, y: 10.3, z: 0 }],
    destinationStateId: 'Far',
    destinationCenter: { x: 121.4, y: 10.125, z: 0 },
    destinationLandingPoint: { x: 116.5, y: 10.3, z: 0 },
    timeout: 55_000,
  });
  expect((await readV2Diagnostics(page, 'movement')).currentRegionId).toBe('lab-gear');
  await rideAutomaticSurfacePublicly(page, {
    mechanismId: 'mechanism.lab-auto-cargo',
    surfaceId: 'surface.lab-upper.auto-cargo',
    boardingStateId: 'Far',
    boardingCenter: { x: 121.4, y: 10.125, z: 0 },
    boardingWaypoints: [{ x: 116.5, y: 10.3, z: 0 }],
    destinationStateId: 'Near',
    destinationCenter: { x: 95.6, y: 10.125, z: 0 },
    destinationLandingPoint: { x: 101, y: 10.3, z: 0 },
    timeout: 55_000,
  });

  // Return to the entrance and take the independent Waterworks branch.
  await steerThroughPortalPublicly(page, 'portal.lab-stairs-upper',
    walkOnlyOptions({ direction: 'reverse', timeout: 35_000 }));
  await traverseAuthoredLinkPublicly(page, 'traversal.lab-stairs.lab-stairs-upper',
    walkOnlyOptions({ direction: 'reverse', timeout: 35_000 }));
  await steerThroughPortalPublicly(page, 'portal.lab-entry-stairs',
    walkOnlyOptions({ direction: 'reverse', timeout: 30_000 }));
  await traverseAuthoredLinkPublicly(page, 'traversal.lab-entry.lab-entry-reservoir',
    walkOnlyOptions({ timeout: 35_000 }));
  await steerThroughPortalPublicly(page, 'portal.lab-entry-reservoir',
    walkOnlyOptions({ timeout: 40_000 }));
  await traverseAuthoredLinkPublicly(page, 'traversal.lab-water-reservoir.router',
    walkOnlyOptions({ timeout: 35_000 }));

  // The initial freight state is not counted as a commit: cycle away and back
  // through all three exact configurations via the permanently dry router.
  await operateActionPublicly(page, 'action.water.reservoir');
  await waitForWaterConfiguration(page, 'StoredInReservoir');
  await operateActionPublicly(page, 'action.water.gantry-sump');
  await waitForWaterConfiguration(page, 'GantrySumpFilled');
  await operateActionPublicly(page, 'action.water.freight-sump');
  await waitForWaterConfiguration(page, 'FreightSumpFilled');
  await traverseAuthoredLinkPublicly(page, 'traversal.lab-water-reservoir.router',
    walkOnlyOptions({ direction: 'reverse', timeout: 35_000 }));

  const connectorDescent = createLadderAudit('Reservoir connector ladder descent');
  await steerThroughPortalPublicly(page, 'portal.lab-reservoir-freight', {
    timeout: 45_000,
    forbidLedgeClimb: true,
    sampleObserver: (diagnostics) => connectorDescent.sample(diagnostics),
  });
  connectorDescent.assertComplete(await readV2Diagnostics(page, 'movement'));
  const basinDescent = createLadderAudit('Freight basin ladder descent');
  await traverseAuthoredLinkPublicly(page, 'traversal.lab-water-freight.lab-reservoir-freight', {
    direction: 'reverse',
    timeout: 35_000,
    forbidLedgeClimb: true,
    sampleObserver: (diagnostics) => basinDescent.sample(diagnostics),
  });
  basinDescent.assertComplete(await readV2Diagnostics(page, 'movement'));
  await exerciseFloodedProfile(page);

  await steerThroughPortalPublicly(page, 'portal.lab-freight-gantry',
    walkOnlyOptions({ timeout: 40_000 }));
  await steerThroughPortalPublicly(page, 'portal.lab-gantry-hazards',
    walkOnlyOptions({ timeout: 40_000 }));
  await observeHazardsFromSafeRoute(page);
  await steerThroughPortalPublicly(page, 'portal.lab-hazards-recovery',
    walkOnlyOptions({ timeout: 40_000 }));

  // Both side controls must be reachable while the lift is absent. Recall at
  // the lower landing, ride up, recall at the upper landing, then ride down.
  await operateActionPublicly(page, 'action.lab-lift.recall-lower', {
    timeout: 35_000,
    whenMechanism: { id: 'mechanism.lab-lift', stateId: 'UpperLanding' },
  });
  await waitForMechanismState(page, 'mechanism.lab-lift', 'LowerLanding');
  await rideAutomaticSurfacePublicly(page, {
    mechanismId: 'mechanism.lab-lift',
    surfaceId: 'surface.lab-recovery.lift',
    boardingStateId: 'LowerLanding',
    boardingCenter: { x: 141, y: -9.825, z: -4 },
    boardingWaypoints: [{ x: 146, y: -9.7, z: -4 }],
    destinationStateId: 'UpperLanding',
    destinationCenter: { x: 141, y: 0.175, z: -4 },
    destinationLandingPoint: { x: 146, y: 0.3, z: -4 },
    timeout: 55_000,
  });

  // Operate both stable gear states through their physical controls before
  // using the signalled fracture floor. The mechanism must expose exact poses.
  await operateActionPublicly(page, 'action.lab-gear.high');
  await waitForMechanismState(page, 'mechanism.lab-gear', 'HighLanding');
  await operateActionPublicly(page, 'action.lab-gear.low');
  await waitForMechanismState(page, 'mechanism.lab-gear', 'LowLanding');

  const beforeDrop = await readV2Diagnostics(page, 'runtime');
  await traverseAuthoredFallPublicly(page, 'fall.lab-gear-drop', { timeout: 30_000 });
  let afterDrop = await readV2Diagnostics(page, 'runtime');
  expect(afterDrop.currentRegionId).toBe('lab-recovery');
  expect(afterDrop.health).toBe(beforeDrop.health);
  expect(afterDrop.safeguardActivations).toBe(0);
  const catchmentReturnSlope = createStackedSlopeNoWarpAudit(
    'Recovery catchment return below the overlapping gear-room stair',
  );
  await traverseAuthoredLinkPublicly(page, 'traversal.lab-recovery.catchment-return',
    walkOnlyOptions({
      timeout: 35_000,
      sampleObserver: (diagnostics) => catchmentReturnSlope.sample(diagnostics),
    }));
  catchmentReturnSlope.assertComplete(await readV2Diagnostics(page, 'movement'));

  await operateActionPublicly(page, 'action.lab-lift.recall-lower', {
    timeout: 35_000,
    whenMechanism: { id: 'mechanism.lab-lift', stateId: 'UpperLanding' },
  });
  await waitForMechanismState(page, 'mechanism.lab-lift', 'LowerLanding');
  await rideAutomaticSurfacePublicly(page, {
    mechanismId: 'mechanism.lab-lift',
    surfaceId: 'surface.lab-recovery.lift',
    boardingStateId: 'LowerLanding',
    boardingCenter: { x: 141, y: -9.825, z: -4 },
    boardingWaypoints: [{ x: 146, y: -9.7, z: -4 }],
    destinationStateId: 'UpperLanding',
    destinationCenter: { x: 141, y: 0.175, z: -4 },
    destinationLandingPoint: { x: 146, y: 0.3, z: -4 },
    timeout: 55_000,
  });
  await operateActionPublicly(page, 'action.lab-lift.recall-upper', {
    timeout: 35_000,
    whenMechanism: { id: 'mechanism.lab-lift', stateId: 'LowerLanding' },
  });
  await waitForMechanismState(page, 'mechanism.lab-lift', 'UpperLanding');
  await rideAutomaticSurfacePublicly(page, {
    mechanismId: 'mechanism.lab-lift',
    surfaceId: 'surface.lab-recovery.lift',
    boardingStateId: 'UpperLanding',
    boardingCenter: { x: 141, y: 0.175, z: -4 },
    boardingWaypoints: [{ x: 146, y: 0.3, z: -4 }],
    destinationStateId: 'LowerLanding',
    destinationCenter: { x: 141, y: -9.825, z: -4 },
    destinationLandingPoint: { x: 146, y: -9.7, z: -4 },
    timeout: 55_000,
  });

  // Physically return through the lower circuit, climbing both ladders back
  // to the router rather than using the recovery safeguard or a teleport.
  await steerThroughPortalPublicly(page, 'portal.lab-hazards-recovery',
    walkOnlyOptions({ direction: 'reverse', timeout: 40_000 }));
  await steerThroughPortalPublicly(page, 'portal.lab-gantry-hazards',
    walkOnlyOptions({ direction: 'reverse', timeout: 40_000 }));
  await steerThroughPortalPublicly(page, 'portal.lab-freight-gantry',
    walkOnlyOptions({ direction: 'reverse', timeout: 40_000 }));
  const basinAscent = createLadderAudit('Freight basin ladder ascent');
  await traverseAuthoredLinkPublicly(page, 'traversal.lab-water-freight.lab-reservoir-freight', {
    timeout: 35_000,
    forbidLedgeClimb: true,
    sampleObserver: (diagnostics) => basinAscent.sample(diagnostics),
  });
  basinAscent.assertComplete(await readV2Diagnostics(page, 'movement'));
  const connectorAscent = createLadderAudit('Reservoir connector ladder ascent');
  await steerThroughPortalPublicly(page, 'portal.lab-reservoir-freight', {
    direction: 'reverse',
    timeout: 45_000,
    forbidLedgeClimb: true,
    sampleObserver: (diagnostics) => connectorAscent.sample(diagnostics),
  });
  connectorAscent.assertComplete(await readV2Diagnostics(page, 'movement'));
  await steerThroughPortalPublicly(page, 'portal.lab-entry-reservoir',
    walkOnlyOptions({ direction: 'reverse', timeout: 40_000 }));
  await traverseAuthoredLinkPublicly(page, 'traversal.lab-entry.lab-entry-reservoir',
    walkOnlyOptions({ direction: 'reverse', timeout: 35_000 }));
  await steerThroughPortalPublicly(page, 'portal.lab-entry-stairs',
    walkOnlyOptions({ timeout: 30_000 }));
  await traverseAuthoredLinkPublicly(page, 'traversal.lab-stairs.lab-stairs-upper',
    walkOnlyOptions({ timeout: 35_000 }));
  await steerThroughPortalPublicly(page, 'portal.lab-stairs-upper',
    walkOnlyOptions({ timeout: 35_000 }));
  await operateActionPublicly(page, 'action.lab-complete');

  const final = await readV2Diagnostics(page, 'full');
  expect(final.frameHeartbeat).toBeGreaterThan(initial.frameHeartbeat);
  exactIds(final.visitedRegionIds, LAB_REGION_IDS);
  expect(final.completedObjectiveIds).toEqual(['objective.lab-complete']);
  expect(final.operatedActionIds).toEqual(expect.arrayContaining([
    'action.water.reservoir',
    'action.water.gantry-sump',
    'action.water.freight-sump',
    'action.lab-lift.recall-lower',
    'action.lab-lift.recall-upper',
    'action.lab-gear.low',
    'action.lab-gear.high',
    'action.lab-complete',
  ]));
  expect(new Set(final.eventLog
    .filter(({ type }) => type === 'water-configuration-committed')
    .map(({ configurationId }) => configurationId)))
    .toEqual(new Set(['FreightSumpFilled', 'StoredInReservoir', 'GantrySumpFilled']));
  expect(final.eventLog.filter(({ mechanismId }) => mechanismId === 'mechanism.lab-crumble')
    .map(({ type }) => type)).toEqual(expect.arrayContaining([
    'crumble-cracking',
    'crumble-collapsed',
    'crumble-reset',
  ]));
  expect(final.safeguardActivations).toBe(0);
  expect(final.errors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
