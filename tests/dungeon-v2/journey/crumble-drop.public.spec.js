import { test, expect } from '@playwright/test';
import {
  PUBLIC_INPUT_JOURNEY,
  readV2Diagnostics,
  steerThroughPortalPublicly,
  steerToWorldPointPublicly,
  waitForV2Runtime,
} from '../helpers/journey-runtime.mjs';

void PUBLIC_INPUT_JOURNEY;

const CRUMBLE_ID = 'mechanism.freight-crumble';

function crumbleSnapshot(diagnostics) {
  return diagnostics?.mechanisms?.find(({ id }) => id === CRUMBLE_ID) ?? null;
}

function crumbleSurface(diagnostics) {
  return diagnostics?.dynamicSurfaces?.find((surface) => (
    surface.mechanismId === CRUMBLE_ID
    || surface.controllerId === CRUMBLE_ID
    || surface.surfaceId === 'surface.assembly.crumble'
  )) ?? null;
}

test('PUBLIC_INPUT_JOURNEY: crumble floor physically drops to its authored catchment and walks back', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?dungeonGen=v2&undercroft=magma&seed=m1-crumble-public');
  const ready = await waitForV2Runtime(page);
  expect(ready.fixtureId).toBe('golden-magma');
  expect(ready.safeguardActivations).toBe(0);
  const initial = await readV2Diagnostics(page, 'runtime');
  expect(Number.isFinite(initial.health)).toBe(true);

  // Reach Assembly entirely through the public entrance and its authored hall.
  await steerThroughPortalPublicly(page, 'portal.security-assembly', {
    horizontalTolerance: 0.8,
    timeout: 30_000,
  });

  let diagnostics = await readV2Diagnostics(page);
  const fall = diagnostics.falls?.find(({ id }) => id === 'fall.assembly-freight-drop');
  expect(fall).toBeTruthy();
  expect(fall.catchmentY).toBeCloseTo(fall.catchmentBounds.max.y, 6);
  expect(fall.catchmentY).not.toBe(0);
  const target = {
    x: (fall.trajectoryBounds.min.x + fall.trajectoryBounds.max.x) * 0.5,
    z: (fall.trajectoryBounds.min.z + fall.trajectoryBounds.max.z) * 0.5,
  };
  await steerToWorldPointPublicly(page, target, {
    horizontalTolerance: 0.45,
    timeout: 20_000,
  });

  await expect.poll(async () => crumbleSnapshot(await readV2Diagnostics(page))?.phase, {
    message: 'Standing on the intact panel never produced visible cracking',
  }).toBe('cracking');
  diagnostics = await readV2Diagnostics(page);
  expect(crumbleSurface(diagnostics)?.enabled).toBe(true);
  const healthBeforeFall = diagnostics.health;

  await expect.poll(async () => crumbleSurface(await readV2Diagnostics(page))?.enabled, {
    message: 'The cracked panel never disabled its physical collision',
  }).toBe(false);

  const verticalTrace = [];
  const fallStartedAt = Date.now();
  let landed = null;
  while (Date.now() - fallStartedAt < 8_000) {
    diagnostics = await readV2Diagnostics(page);
    verticalTrace.push({
      y: diagnostics.playerPosition?.y,
      authorized: diagnostics.playerFallState?.authorized,
      groundY: diagnostics.playerFallState?.catchmentGroundY,
      safeguardActivations: diagnostics.safeguardActivations,
    });
    if (Math.abs((diagnostics.playerPosition?.y ?? Infinity) - fall.catchmentY) <= 0.05) {
      landed = diagnostics;
      break;
    }
    await page.waitForTimeout(45);
  }

  expect(landed, 'Player never landed on the authored catchment').toBeTruthy();
  expect(Math.min(...verticalTrace.map(({ y }) => y))).toBeLessThan(fall.sourceSurfaceTopY - 1);
  expect(landed.playerPosition.y).toBeCloseTo(fall.catchmentY, 1);
  expect(landed.health).toBe(healthBeforeFall);
  expect(landed.safeguardActivations).toBe(0);
  const airborne = verticalTrace.filter(({ y }) => (
    y < fall.sourceSurfaceTopY - 0.25 && y > fall.catchmentY + 0.1
  ));
  expect(airborne.length).toBeGreaterThan(0);
  expect(airborne.every(({ authorized, groundY }) => (
    authorized === true && Math.abs(groundY - fall.catchmentY) <= 0.05
  ))).toBe(true);
  for (let index = 1; index < airborne.length; index += 1) {
    expect(airborne[index].y - airborne[index - 1].y,
      'A silent last-safe correction moved the player upward during the authored drop').toBeLessThanOrEqual(0.35);
  }

  expect(Array.isArray(fall.returnWaypoints) && fall.returnWaypoints.length > 0,
    'Fall diagnostics must expose the authored damage-free return route').toBe(true);
  for (const waypoint of fall.returnWaypoints) {
    await steerToWorldPointPublicly(page, waypoint, {
      horizontalTolerance: 0.65,
      timeout: 20_000,
      allowJumpRecovery: false,
    });
  }
  const returned = await readV2Diagnostics(page);
  const withinCatchment = returned.playerPosition.x >= fall.catchmentBounds.min.x
    && returned.playerPosition.x <= fall.catchmentBounds.max.x
    && returned.playerPosition.z >= fall.catchmentBounds.min.z
    && returned.playerPosition.z <= fall.catchmentBounds.max.z;
  expect(withinCatchment, 'Player did not physically walk out of the catchment sub-zone').toBe(false);

  await expect.poll(async () => {
    const snapshot = await readV2Diagnostics(page);
    return {
      phase: crumbleSnapshot(snapshot)?.phase,
      enabled: crumbleSurface(snapshot)?.enabled,
    };
  }, { message: 'Crumble floor did not automatically restore visual/collision state' })
    .toEqual({ phase: 'stable', enabled: true });

  const final = await readV2Diagnostics(page, 'full');
  const relevantEvents = final.eventLog.filter(({ mechanismId }) => mechanismId === CRUMBLE_ID);
  expect(relevantEvents.map(({ type }) => type)).toEqual(expect.arrayContaining([
    'crumble-cracking', 'crumble-collapsed', 'crumble-reset',
  ]));
  expect(final.errors.filter(({ code }) => (
    code === 'unauthorized-fall-correction'
    || code === 'physics-recovery-safeguard-activated'
  ))).toEqual([]);
  expect(final.safeguardActivations).toBe(0);
  expect(final.health).toBe(healthBeforeFall);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
