import { test, expect } from '@playwright/test';
import {
  PUBLIC_INPUT_JOURNEY,
  readV2Diagnostics,
  steerThroughPortalPublicly,
  traverseAuthoredLinkPublicly,
  waitForV2Runtime,
} from '../helpers/journey-runtime.mjs';

void PUBLIC_INPUT_JOURNEY;

function walkOnly(extra = {}) {
  return {
    forbidJump: true,
    forbidLedgeClimb: true,
    allowJumpRecovery: false,
    ...extra,
  };
}

function ladderAlignmentAudit(label) {
  const state = {
    mountedSamples: 0,
    minimumHeight: Infinity,
    maximumHeight: -Infinity,
    lastMountedPosition: null,
    postDismountStartPosition: null,
    maximumPostDismountWalkDistance: 0,
    recentSamples: [],
  };
  return {
    sample(diagnostics) {
      state.recentSamples.push({
        position: diagnostics.playerPosition ? { ...diagnostics.playerPosition } : null,
        jumpState: diagnostics.jumpState,
        prompt: diagnostics.currentPrompt ? { ...diagnostics.currentPrompt } : null,
        ladderId: diagnostics.ladderTraversal?.ladderId ?? null,
      });
      if (state.recentSamples.length > 12) state.recentSamples.shift();
      expect(diagnostics.ledgeCling, `${label} substituted ledge climbing.`).toBeNull();
      const traversal = diagnostics.ladderTraversal;
      if (!traversal) {
        if (state.lastMountedPosition && diagnostics.playerPosition) {
          state.postDismountStartPosition ??= { ...diagnostics.playerPosition };
          state.maximumPostDismountWalkDistance = Math.max(
            state.maximumPostDismountWalkDistance,
            Math.hypot(
              diagnostics.playerPosition.x - state.postDismountStartPosition.x,
              diagnostics.playerPosition.z - state.postDismountStartPosition.z,
            ),
          );
          expect(diagnostics.jumpState,
            `${label} required a jump to leave its landing: ${JSON.stringify({
              position: diagnostics.playerPosition,
              prompt: diagnostics.currentPrompt,
              lastMountedPosition: state.lastMountedPosition,
              postDismountStartPosition: state.postDismountStartPosition,
            })}`).toBe('Grounded');
        }
        return;
      }
      state.mountedSamples += 1;
      state.minimumHeight = Math.min(state.minimumHeight, traversal.height);
      state.maximumHeight = Math.max(state.maximumHeight, traversal.height);
      state.lastMountedPosition = { ...diagnostics.playerPosition };
      expect(diagnostics.animationState).toBe('climbingLadder');
      expect(diagnostics.fbxAnimationLoadState?.clips,
        `${label} mounted without the authoritative FBX.`).toContain('climbingLadder');
      expect(diagnostics.activeFbxAnimationClip,
        `${label} displayed a different FBX clip.`).toBe('climbingLadder');
      expect(Math.abs(traversal.signedPlaneClearance - traversal.bodyClearance),
        `${label} root was not on its authored line in front of the rungs.`).toBeLessThanOrEqual(0.01);
      expect(traversal.facingAlignment,
        `${label} character faced away from the rung plane.`).toBeGreaterThanOrEqual(0.999);
    },
    assertCompleted(diagnostics) {
      expect(state.mountedSamples,
        `${label} never mounted through keyboard input: ${JSON.stringify({
          finalPosition: diagnostics.playerPosition,
          finalPrompt: diagnostics.currentPrompt,
          recentSamples: state.recentSamples,
        })}`).toBeGreaterThan(1);
      expect(state.maximumHeight - state.minimumHeight,
        `${label} did not climb a meaningful span.`).toBeGreaterThan(1);
      expect(diagnostics.ladderTraversal, `${label} did not dismount.`).toBeNull();
      expect(diagnostics.ledgeCling, `${label} dismounted through ledge climbing.`).toBeNull();
      expect(state.maximumPostDismountWalkDistance,
        `${label} did not provide 1.2m of ordinary grounded walk-away space.`)
        .toBeGreaterThanOrEqual(1.2);
    },
  };
}

test('PUBLIC_INPUT_JOURNEY: both Waterworks ladders mount on the rung plane and return to dry ground', async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?dungeonGen=v2&v2Fixture=traversal-lab&seed=m1-ladder-alignment-public');
  await waitForV2Runtime(page);

  await traverseAuthoredLinkPublicly(page, 'traversal.lab-entry.lab-entry-reservoir',
    walkOnly({ timeout: 35_000 }));
  await steerThroughPortalPublicly(page, 'portal.lab-entry-reservoir',
    walkOnly({ timeout: 40_000 }));

  const connectorDescent = ladderAlignmentAudit('Reservoir connector descent');
  await steerThroughPortalPublicly(page, 'portal.lab-reservoir-freight', {
    timeout: 45_000,
    forbidLedgeClimb: true,
    sampleObserver: connectorDescent.sample,
  });
  connectorDescent.assertCompleted(await readV2Diagnostics(page, 'movement'));

  const basinDescent = ladderAlignmentAudit('Freight basin descent');
  await traverseAuthoredLinkPublicly(page, 'traversal.lab-water-freight.lab-reservoir-freight', {
    direction: 'reverse',
    timeout: 40_000,
    forbidLedgeClimb: true,
    sampleObserver: basinDescent.sample,
  });
  basinDescent.assertCompleted(await readV2Diagnostics(page, 'movement'));

  const basinAscent = ladderAlignmentAudit('Freight basin ascent');
  await traverseAuthoredLinkPublicly(page, 'traversal.lab-water-freight.lab-reservoir-freight', {
    timeout: 40_000,
    forbidLedgeClimb: true,
    sampleObserver: basinAscent.sample,
  });
  basinAscent.assertCompleted(await readV2Diagnostics(page, 'movement'));

  const connectorAscent = ladderAlignmentAudit('Reservoir connector ascent');
  await steerThroughPortalPublicly(page, 'portal.lab-reservoir-freight', {
    direction: 'reverse',
    timeout: 45_000,
    forbidLedgeClimb: true,
    sampleObserver: connectorAscent.sample,
  });
  const final = await readV2Diagnostics(page, 'runtime');
  connectorAscent.assertCompleted(final);
  expect(final.currentRegionId).toBe('lab-water-reservoir');
  expect(final.safeguardActivations).toBe(0);
  expect(final.errors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
