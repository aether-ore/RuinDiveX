import { test, expect } from '@playwright/test';
import {
  PUBLIC_INPUT_JOURNEY,
  readV2Diagnostics,
  startV2PerformanceFrameProbe,
  stopV2PerformanceFrameProbe,
  waitForV2Runtime,
} from '../helpers/journey-runtime.mjs';

void PUBLIC_INPUT_JOURNEY;

// Video encoding and trace snapshots materially distort a software-rendered
// workload measurement. Failure screenshots, console capture, and the frozen
// workload attachment remain enabled for diagnosis.
test.use({ trace: 'off', video: 'off' });

test('PUBLIC_INPUT_JOURNEY: V2 keyboard movement keeps the real RAF loop responsive within bounded workload', async ({ page }, testInfo) => {
  test.setTimeout(30_000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  // Performance acceptance must exercise the same complete seeded artifact as
  // the end-to-end journey. The small traversal lab cannot stand in for the
  // native-room workload or its compatibility collision facade.
  await page.goto('/?dungeonGen=v2&undercroft=magma&seed=m1-golden-magma');
  const ready = await waitForV2Runtime(page);
  const startPosition = ready.playerPosition;
  const firstGameHeartbeat = ready.performance.gameFrameHeartbeat;
  await startV2PerformanceFrameProbe(page);

  await page.keyboard.down('KeyW');
  try {
    await page.waitForTimeout(2_600);
  } finally {
    await page.keyboard.up('KeyW');
  }
  const frameProbe = await stopV2PerformanceFrameProbe(page);
  const last = await readV2Diagnostics(page, 'movement');
  expect(last?.performance).toBeTruthy();
  const lastGameHeartbeat = last.performance.gameFrameHeartbeat;
  expect(lastGameHeartbeat - firstGameHeartbeat,
    'The real Game RAF heartbeat did not progress during unthrottled keyboard movement.')
    .toBeGreaterThan(0);
  expect(frameProbe?.frameCount,
    'The independent requestAnimationFrame probe did not observe successive frames.')
    .toBeGreaterThan(1);
  expect(frameProbe.maximumGapMs,
    `The real requestAnimationFrame heartbeat stopped for ${frameProbe.maximumGapMs.toFixed(1)}ms.`)
    .toBeLessThan(750);

  const endPosition = last.playerPosition;
  expect(Math.hypot(
    endPosition.x - startPosition.x,
    endPosition.z - startPosition.z,
  ), 'Public KeyW input did not physically move the player during the performance sample.')
    .toBeGreaterThan(0.5);

  const performance = last.performance;
  expect(performance.platformSurfaceCount,
    'The workload sample must include the complete golden compatibility facade, not a small lab.')
    .toBeGreaterThan(800);
  expect(performance.frame?.phases?.browserDiagnostics?.maximumDurationMs,
    'V2 render frames expanded the full runtime diagnostics graph into the legacy DOM telemetry mirror.')
    .toBeLessThan(10);
  expect(performance.platformQueries?.maximumDurationMs,
    'A single player-platform query exceeded its fixed-frame budget.')
    .toBeLessThan(5);
  await testInfo.attach('v2-runtime-workload.json', {
    body: Buffer.from(JSON.stringify({
      fixtureId: last.fixtureId,
      gameHeartbeatDelta: lastGameHeartbeat - firstGameHeartbeat,
      frameProbe,
      renderer: performance.renderer,
      frustumShadowCasterCount: performance.frustumShadowCasterCount,
      frustumShadowTriangleCount: performance.frustumShadowTriangleCount,
      assembly: performance.assembly,
      cameraContainmentQueryStats: last.cameraContainmentQueryStats,
      collisionSpatialQueryStats: last.collisionSpatialQueryStats,
      frame: performance.frame,
      platformQueries: performance.platformQueries,
      platformSurfaceCount: performance.platformSurfaceCount,
      platformLedgeCandidateCount: performance.platformLedgeCandidateCount,
    }, null, 2)),
    contentType: 'application/json',
  });
  expect(performance.renderer.calls).toBeGreaterThan(0);
  expect(performance.renderer.calls,
    'V2 exceeded its renderer draw-call workload ceiling after static-kit shadow remediation.')
    .toBeLessThanOrEqual(400);
  expect(performance.renderer.triangles).toBeGreaterThan(0);
  expect(performance.renderer.triangles,
    'V2 exceeded its rendered-triangle workload ceiling.')
    .toBeLessThanOrEqual(100_000);
  expect(performance.frustumShadowCasterCount,
    'Too many current-frustum meshes still submit to the shadow map.')
    .toBeLessThanOrEqual(80);
  expect(performance.assembly.visibleShadowCasterCount,
    'The assembled V2 fixture retained too many global shadow casters.')
    .toBeLessThanOrEqual(80);

  const cameraQueries = last.cameraContainmentQueryStats;
  expect(cameraQueries.queryCount).toBeGreaterThan(0);
  expect(cameraQueries.candidateTests).toBeLessThan(cameraQueries.bruteForceEquivalentTests * 0.4);
  const collisionQueries = last.collisionSpatialQueryStats;
  expect(collisionQueries.queryCount).toBeGreaterThan(0);
  expect(collisionQueries.candidateTests).toBeLessThan(collisionQueries.bruteForceEquivalentTests * 0.4);

  expect(last.structuralRayAuditStats).toMatchObject({
    enabled: false,
    raycastCount: 0,
  });
  expect(performance.renderCulling).toMatchObject({
    maximumCameraProofDistance: 120,
    minimumV2HideDistance: 128,
  });
  expect(last.errors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
