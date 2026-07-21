import test from 'node:test';
import {
  assertAcceptedDungeonFixture,
  assertAcceptanceFailure,
  assertMechanismContracts,
} from '../helpers/accepted-fixture.mjs';
import { createAcceptedSyntheticFixture } from '../helpers/synthetic-fixtures.mjs';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';

test('assertAcceptedDungeonFixture accepts a closed, paired, registered assembly', () => {
  const fixture = createAcceptedSyntheticFixture();
  const result = assertAcceptedDungeonFixture(fixture);
  assertAcceptedDungeonFixture(fixture.plan, { stage: 'module' });
  if (!result.accepted) throw new Error('synthetic fixture was not accepted');
});

test('assertAcceptedDungeonFixture requires complete 120m camera and lossless journey proofs', () => {
  const fixture = createAcceptedSyntheticFixture((candidate) => {
    candidate.stage = 'journey';
    candidate.proofs.camera = { maxRange: 120, clearSpaceRays: [], downwardViews: [] };
    candidate.journey = { safeguardActivations: 0 };
  });
  assertAcceptedDungeonFixture(fixture);
});

const negativeFixtures = [
  ['assembly-plan-not-accepted', (fixture) => { fixture.plan.accepted = false; }],
  ['cell-face-open', (fixture) => {
    fixture.plan.structuralBoundaries = fixture.plan.structuralBoundaries.filter((item) => item.id !== 'a-ceiling');
  }],
  ['portal-unpaired', (fixture) => { fixture.plan.portals[0].to = null; }],
  ['portal-frame-seam', (fixture) => { fixture.plan.portals[0].from.side = 'north'; }],
  ['boundary-not-structural', (fixture) => { fixture.plan.structuralBoundaries[0].kind = 'decorative'; }],
  ['boundary-collider-missing', (fixture) => { fixture.plan.structuralBoundaries[0].collider = false; }],
  ['unused-socket', (fixture) => { fixture.plan.sockets.push({ id: 'uncapped-opening', status: 'unused' }); }],
  ['independent-cell-overlap', (fixture) => { fixture.plan.spatialCells[1].bounds.min.x = 5; }],
  ['bottomless-fall', (fixture) => {
    fixture.plan.falls.push({ id: 'bad-drop', targetRegionId: 'region-b', bottomless: true });
  }],
  ['visible-lower-area-unowned', (fixture) => {
    fixture.plan.visibilityLinks.push({ id: 'fake-undercroft', elevationDelta: -10, targetRegionId: 'painted-backdrop', returnPortalId: 'portal-a-b' });
  }],
  ['structural-visual-missing', (fixture) => {
    fixture.assembly.structuralRegistry.byPlanId.get('a-west').visualIds = [];
  }],
  ['structural-collider-missing', (fixture) => {
    fixture.assembly.structuralRegistry.byPlanId.get('a-west').colliderIds = [];
  }],
  ['visual-collider-mismatch', (fixture) => {
    fixture.proofs.visualCollider.mismatches.push({ id: 'a-floor', distance: 0.4 });
  }],
  ['internal-traversal-physically-blocked', (fixture) => {
    const proof = fixture.proofs.visualCollider.physicalClearance.linkProofs[0];
    proof.accepted = false;
    proof.blockedSamples.push({ position: { x: 10, y: 0.2, z: 5 }, planId: 'fixture-a-pipe' });
    fixture.proofs.visualCollider.physicalClearance.blockedLinks.push(proof);
    fixture.proofs.visualCollider.physicalClearance.accepted = false;
  }],
  ['ladder-runtime-top-dismount-failed', (fixture) => {
    fixture.assembly.ladders = [{ id: 'ladder.synthetic' }];
    const direction = (id, accepted = true) => ({
      direction: id,
      publicControllerInteraction: true,
      publicPlayerUpdate: true,
      inputCodes: [id === 'up' ? 'KeyW' : 'KeyS'],
      promptFound: true,
      mounted: true,
      finiteFrames: true,
      climbingFrames: 90,
      authoredSpan: 4,
      climbedSpan: 4,
      planeAlignment: {
        sampleCount: 90,
        bodyClearance: 0.4,
        maximumPlaneClearanceError: 0,
        minimumFacingAlignment: 1,
        visualPlaneMatchesRuntime: true,
        accepted: true,
      },
      dismounted: true,
      postDismountConstraintFrames: 2,
      exitDistance: accepted ? 0 : 4,
      safeguardActivations: 0,
      accepted,
    });
    const ladderProof = {
      ladderId: 'ladder.synthetic',
      directions: [direction('up', false), direction('down')],
      accepted: false,
    };
    fixture.proofs.visualCollider.ladderRuntime = {
      proofId: 'assembled-ladder-public-input-v1',
      ladderCount: 1,
      ladderProofs: [ladderProof],
      rejectedLadders: [ladderProof],
      accepted: false,
    };
  }],
  ['ladder-runtime-bottom-egress-blocked', (fixture) => {
    fixture.assembly.ladders = [{ id: 'ladder.synthetic' }];
    const direction = (id, egressAccepted = true) => ({
      direction: id,
      publicControllerInteraction: true,
      publicPlayerUpdate: true,
      inputCodes: [id === 'up' ? 'KeyW' : 'KeyS'],
      promptFound: true,
      mounted: true,
      finiteFrames: true,
      climbingFrames: 90,
      authoredSpan: 4,
      climbedSpan: 4,
      planeAlignment: {
        sampleCount: 90,
        bodyClearance: 0.4,
        maximumPlaneClearanceError: 0,
        minimumFacingAlignment: 1,
        visualPlaneMatchesRuntime: true,
        accepted: true,
      },
      dismounted: true,
      postDismountConstraintFrames: 2,
      exitDistance: 0,
      egress: {
        publicPlayerUpdate: true,
        publicControllerConstraint: true,
        inputCodes: ['KeyW'],
        jumpInputUsed: false,
        exitName: id === 'up' ? 'top' : 'bottom',
        landingSurfaceId: id === 'up' ? 'surface.synthetic.top' : 'surface.synthetic.bottom',
        authoredClearLength: 1.2,
        maximumProjectedDistance: egressAccepted ? 1.2 : 0.2,
        maximumHorizontalConstraintCorrection: egressAccepted ? 0 : 0.18,
        finiteFrames: true,
        remainedGrounded: true,
        supportLost: false,
        snapBackDetected: !egressAccepted,
        frameCount: 18,
        maximumFrames: 180,
        safeguardActivations: 0,
        accepted: egressAccepted,
      },
      safeguardActivations: 0,
      accepted: egressAccepted,
    });
    const ladderProof = {
      ladderId: 'ladder.synthetic',
      directions: [direction('up'), direction('down', false)],
      accepted: false,
    };
    fixture.proofs.visualCollider.ladderRuntime = {
      proofId: 'assembled-ladder-public-input-v1',
      ladderCount: 1,
      ladderProofs: [ladderProof],
      rejectedLadders: [ladderProof],
      accepted: false,
    };
  }],
  ['transparent-structural-shell', (fixture) => {
    fixture.proofs.visualCollider.transparentStructuralIds.push('a-north');
  }],
  ['offscreen-render-sees-void', (fixture) => {
    fixture.proofs.offscreenStructuralRender.clearFrames.push({
      sampleId: 'safe-a:north', backgroundPixelCount: 1,
    });
    fixture.proofs.offscreenStructuralRender.accepted = false;
  }],
  ['offscreen-render-transparent-shell', (fixture) => {
    fixture.proofs.offscreenStructuralRender.transparentStructuralIds.push('a-ceiling');
    fixture.proofs.offscreenStructuralRender.accepted = false;
  }],
  ['camera-envelope-unpaired-boundary', (fixture) => {
    fixture.proofs.offscreenStructuralRender.unpairedBoundarySamples.push({
      anchorId: 'safe-a', facing: 'north', containmentPlanId: 'spatial-cell-union',
    });
    fixture.proofs.offscreenStructuralRender.accepted = false;
  }],
  ['downward-visible-area-unowned', (fixture) => {
    fixture.proofs.offscreenStructuralRender.downwardVisibility.unresolvedLowerHits.push({
      sampleId: 'safe-a:downward:0',
      hitPlanId: 'painted-lower-backdrop',
      reason: 'no-registered-playable-walkable-surface-at-render-hit',
    });
    fixture.proofs.offscreenStructuralRender.downwardVisibility.accepted = false;
    fixture.proofs.offscreenStructuralRender.accepted = false;
  }],
  ['mechanism-state-exposes-void', (fixture) => {
    fixture.plan.mechanisms.push({
      id: 'lift',
      type: 'synthetic-mechanism',
      initialStateId: 'raised',
      states: [{ id: 'raised', stable: true }],
      transitions: [{ fromStateId: 'raised', toStateId: 'raised', automatic: true }],
    });
    fixture.proofs.mechanismStates.push({
      mechanismId: 'lift',
      stateId: 'raised',
      accepted: true,
      clearSpaceRays: [{ face: 'ceiling', maxRange: 120 }],
      visualColliderMismatches: [],
      controlsReachable: true,
    });
  }],
  ['traversal-link-surface-missing', (fixture) => {
    fixture.plan.traversalLinks[0].toSurfaceId = 'surface-painted-only';
  }],
  ['surface-physical-support-missing', (fixture) => {
    fixture.plan.walkableSurfaces[1].bounds.min.y = 1;
    fixture.plan.walkableSurfaces[1].bounds.max.y = 1.2;
  }],
  ['action-anchor-surface-misaligned', (fixture) => {
    fixture.plan.safeAnchors[0].position.y = 0.8;
  }],
  ['minimap-marker-anchor-missing', (fixture) => {
    fixture.plan.minimap.staticMarkers.push({ id: 'marker-painted-shrine', type: 'shrine', anchorId: 'anchor.fixed-room-name' });
  }],
  ['portal-route-disconnected', (fixture) => {
    fixture.proofs.portalRoutes[0].continuous = false;
  }],
  ['portal-route-uncovered', (fixture) => {
    fixture.proofs.portalRoutes[0].uncoveredSamples.push({ distance: 4.2, position: { x: 14, y: 0, z: 5 } });
  }],
  ['portal-route-blocked', (fixture) => {
    fixture.proofs.portalRoutes[0].blockedSamples.push({ position: { x: 10, y: 1, z: 5 }, blocker: 'full-wall' });
  }],
  ['portal-approach-proof-count', (fixture) => {
    fixture.proofs.portalRoutes[0].approachClearanceVolumes.pop();
  }],
  ['portal-approach-structural-fixture', (fixture) => {
    fixture.proofs.portalRoutes[0].approachClearanceVolumes[0].structuralFixtureIntrusions.push({
      id: 'fixture.blocked-from-approach', regionId: 'region-a',
    });
  }],
  ['portal-approach-interaction', (fixture) => {
    fixture.proofs.portalRoutes[0].approachClearanceVolumes[1].interactionIntrusions.push({
      actionId: 'action.console-in-to-approach', anchorId: 'anchor.console-in-to-approach', regionId: 'region-b',
    });
  }],
  ['portal-approach-collider', (fixture) => {
    fixture.proofs.portalRoutes[0].approachClearanceVolumes[1].colliderIntrusions.push({
      colliderId: 'collider.stray-in-to-approach', planId: null,
    });
  }],
  ['camera-sees-void', (fixture) => {
    fixture.stage = 'journey';
    fixture.proofs.camera = { maxRange: 120, clearSpaceRays: [{ origin: 'safe-a', direction: 'up' }], downwardViews: [] };
    fixture.journey = { safeguardActivations: 0 };
  }],
  ['safeguard-activated', (fixture) => {
    fixture.stage = 'journey';
    fixture.proofs.camera = { maxRange: 120, clearSpaceRays: [], downwardViews: [] };
    fixture.journey = { safeguardActivations: 1 };
  }],
];

for (const [code, mutate] of negativeFixtures) {
  test(`assertAcceptedDungeonFixture rejects ${code}`, () => {
    const fixture = createAcceptedSyntheticFixture(mutate);
    assertAcceptanceFailure(code, () => assertAcceptedDungeonFixture(fixture));
  });
}

function mutableGoldenPlan() {
  return structuredClone(createGoldenDungeonPlanV2({
    seed: 'mechanism-contract-negative-fixture',
    undercroftType: 'magma',
  }));
}

test('moving cargo rejects a stable platform top that misses its landing top', () => {
  const plan = mutableGoldenPlan();
  const mechanism = plan.mechanisms.find(({ type }) => type === 'moving-cargo');
  mechanism.states[0].position.y += 0.2;
  assertAcceptanceFailure('moving-cargo-state-landing-height-mismatch', () => assertMechanismContracts(plan));
});

test('moving cargo rejects a stable landing with no 1.2m physical abutment seam', () => {
  const plan = mutableGoldenPlan();
  const mechanism = plan.mechanisms.find(({ type }) => type === 'moving-cargo');
  const landing = plan.walkableSurfaces.find(({ id }) => id === mechanism.states[0].landingSurfaceId);
  landing.bounds.min.x += 0.3;
  landing.bounds.max.x += 0.3;
  assertAcceptanceFailure('moving-cargo-landing-seam-missing', () => assertMechanismContracts(plan));
});

test('moving cargo rejects a landing/platform link without its exact stable-state condition', () => {
  const plan = mutableGoldenPlan();
  const mechanism = plan.mechanisms.find(({ type }) => type === 'moving-cargo');
  const state = mechanism.states[0];
  const link = plan.traversalLinks.find((candidate) => (
    candidate.mechanismId === mechanism.id
    && [candidate.fromSurfaceId, candidate.toSurfaceId].includes(state.landingSurfaceId)
  ));
  link.conditions[0].value = 'WrongStableState';
  assertAcceptanceFailure('moving-cargo-state-traversal-link-missing', () => assertMechanismContracts(plan));
});

test('golden corkscrew descent rejects traversal without LowLanding state ownership', () => {
  const plan = mutableGoldenPlan();
  plan.portals.find(({ id }) => id === 'portal.corkscrew-hazard-intake').conditions = [];
  assertAcceptanceFailure('corkscrew-hazard-portal-state-condition-missing', () => assertMechanismContracts(plan));
});

test('cargo lift rejects a landing/platform link without its exact stable-state condition', () => {
  const plan = mutableGoldenPlan();
  const mechanism = plan.mechanisms.find(({ type }) => type === 'cargo-lift');
  const state = mechanism.states[0];
  const link = plan.traversalLinks.find((candidate) => (
    candidate.mechanismId === mechanism.id
    && [candidate.fromSurfaceId, candidate.toSurfaceId].includes(state.landingSurfaceId)
  ));
  link.conditions[0].value = 'WrongStableState';
  assertAcceptanceFailure('lift-state-traversal-link-missing', () => assertMechanismContracts(plan));
});

test('corkscrew rejects a stable platform top that misses its landing top', () => {
  const plan = mutableGoldenPlan();
  const mechanism = plan.mechanisms.find(({ type }) => type === 'corkscrew-gear');
  mechanism.states[0].position.y += 0.2;
  assertAcceptanceFailure('corkscrew-state-landing-height-mismatch', () => assertMechanismContracts(plan));
});

test('corkscrew rejects a landing/platform link without its exact stable-state condition', () => {
  const plan = mutableGoldenPlan();
  const mechanism = plan.mechanisms.find(({ type }) => type === 'corkscrew-gear');
  const state = mechanism.states[0];
  const link = plan.traversalLinks.find((candidate) => (
    candidate.mechanismId === mechanism.id
    && [candidate.fromSurfaceId, candidate.toSurfaceId].includes(state.landingSurfaceId)
  ));
  link.conditions[0].value = 'WrongStableState';
  assertAcceptanceFailure('corkscrew-state-traversal-link-missing', () => assertMechanismContracts(plan));
});

test('corkscrew rejects a stable pose with no automatic departure', () => {
  const plan = mutableGoldenPlan();
  const mechanism = plan.mechanisms.find(({ type }) => type === 'corkscrew-gear');
  mechanism.transitions = mechanism.transitions.filter((transition) => (
    transition.fromStateId !== mechanism.states[0].id || transition.trigger !== 'automatic-dwell'
  ));
  assertAcceptanceFailure('corkscrew-automatic-departure-missing', () => assertMechanismContracts(plan));
});
