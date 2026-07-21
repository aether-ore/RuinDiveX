import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAcceptanceFailure,
  assertActionContracts,
  assertEnvironmentStateContracts,
  assertGoldenContentContracts,
  assertGoldenPhysicalProgression,
  assertLandmarkCompoundSpaces,
  assertMechanismContracts,
  assertPlayableLowerAreas,
} from '../helpers/accepted-fixture.mjs';
import {
  createGoldenDungeonPlanV2,
  createTraversalLabPlanV2,
} from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { deepFreezePlan } from '../../../src/dungeon-v2/DungeonPlanV2Contract.js';

function mutatePlan(source, mutate) {
  const plan = structuredClone(source);
  mutate(plan);
  return deepFreezePlan(plan);
}

const golden = createGoldenDungeonPlanV2({
  seed: 'acceptance-content-negative-fixtures',
  undercroftType: 'magma',
});
const electricalGolden = createGoldenDungeonPlanV2({
  seed: 'acceptance-electrical-negative-fixtures',
  undercroftType: 'electrical',
});
const lab = createTraversalLabPlanV2({ seed: 'acceptance-mechanism-negative-fixtures' });

const mechanismLab = lab;

function withValidFallTrajectory(source) {
  const plan = structuredClone(source);
  for (const fall of plan.falls) {
    const catchment = plan.walkableSurfaces.find(({ id }) => id === fall.catchmentSurfaceId);
    const sourcePortal = plan.portals.find(({ id }) => id === fall.sourcePortalId);
    const sourceSurfaceId = fall.sourceSurfaceId
      ?? sourcePortal?.physicalRoute?.endpointSurfaceIds?.from;
    const sourceSurface = plan.walkableSurfaces.find(({ id }) => id === sourceSurfaceId);
    const catchmentCenter = {
      x: (catchment.bounds.min.x + catchment.bounds.max.x) * 0.5,
      y: catchment.bounds.max.y,
      z: (catchment.bounds.min.z + catchment.bounds.max.z) * 0.5,
    };
    const sourcePoint = sourcePortal?.from?.center ?? {
      x: (sourceSurface.bounds.min.x + sourceSurface.bounds.max.x) * 0.5,
      y: sourceSurface.bounds.max.y,
      z: (sourceSurface.bounds.min.z + sourceSurface.bounds.max.z) * 0.5,
    };
    fall.trajectoryBounds.min.x = Math.min(fall.trajectoryBounds.min.x, catchmentCenter.x, sourcePoint.x);
    fall.trajectoryBounds.min.y = Math.min(fall.trajectoryBounds.min.y, catchmentCenter.y, sourcePoint.y);
    fall.trajectoryBounds.min.z = Math.min(fall.trajectoryBounds.min.z, catchmentCenter.z, sourcePoint.z);
    fall.trajectoryBounds.max.x = Math.max(fall.trajectoryBounds.max.x, catchmentCenter.x, sourcePoint.x);
    fall.trajectoryBounds.max.y = Math.max(fall.trajectoryBounds.max.y, catchmentCenter.y, sourcePoint.y);
    fall.trajectoryBounds.max.z = Math.max(fall.trajectoryBounds.max.z, catchmentCenter.z, sourcePoint.z);
  }
  return deepFreezePlan(plan);
}

const fallLab = withValidFallTrajectory(lab);

function successfulFallJourney(plan = fallLab) {
  const fall = plan.falls[0];
  const catchment = plan.walkableSurfaces.find(({ id }) => id === fall.catchmentSurfaceId);
  return {
    falls: [{
      id: fall.id,
      publicInputOnly: true,
      stoodOnIntact: true,
      cracksVisible: true,
      collisionDisabled: true,
      rootDescendedBelowSource: true,
      landed: true,
      landingY: catchment.bounds.max.y,
      damageDelta: 0,
      physicallyReturned: true,
      automaticReset: true,
      safeguardActivations: 0,
      unauthorizedFallCorrections: 0,
      silentSafeCorrections: 0,
    }],
  };
}

test('golden content baseline owns all semantic progression, combat, reward, and objective contracts', () => {
  assertGoldenContentContracts(golden);
  assertEnvironmentStateContracts(golden, 'golden');
});

const contentNegatives = [
  ['golden-semantic-regions', (plan) => { plan.regions[0].id = 'generic-start-box'; }],
  ['golden-encounter-set', (plan) => { plan.encounters.pop(); }],
  ['golden-region-detail-missing', (plan) => {
    plan.structuralFixtures = plan.structuralFixtures.filter(({ id }) => id !== 'fixture.nest.authored-nest-core');
  }],
  ['golden-region-detail-source-missing', (plan) => {
    plan.structuralFixtures.find(({ id }) => id === 'fixture.freight.authored-freight-control-bank')
      .authoredSourceMaterial = null;
  }],
  ['golden-region-detail-collision-missing', (plan) => {
    plan.structuralFixtures.find(({ id }) => id === 'fixture.parts.authored-rack-east').collision = false;
  }],
  ['encounter-roster-unsupported', (plan) => { plan.encounters[0].roster = ['not-a-reaverbot']; }],
  ['encounter-spawn-points-missing', (plan) => { plan.encounters[0].spawnPoints = []; }],
  ['encounter-seed-missing', (plan) => { plan.encounters[0].seed = null; }],
  ['encounter-blocks-permanent-route', (plan) => { plan.encounters[0].blocksPermanentRoute = true; }],
  ['keycard-at-own-gate', (plan) => {
    plan.rewards.find(({ id }) => id === 'reward.keycard-alpha').regionId = 'security';
  }],
  ['shrine-key-premature', (plan) => {
    plan.rewards.find(({ id }) => id === 'reward.shrine-key').conditions = [];
  }],
  ['reward-placement-harmful', (plan) => {
    plan.rewards.find(({ id }) => id === 'reward.cache.undercroft').hazardTag = 'environmental:magma';
  }],
  ['cache-salvage-bundle-missing', (plan) => {
    delete plan.rewards.find(({ id }) => id === 'reward.cache.alpha').salvageBundle;
  }],
  ['cache-salvage-parts-empty', (plan) => {
    plan.rewards.find(({ id }) => id === 'reward.cache.water').salvageBundle.recoverableParts = [];
  }],
  ['cache-salvage-material-unknown', (plan) => {
    plan.rewards.find(({ id }) => id === 'reward.cache.nest')
      .salvageBundle.recoverableParts[0].materialId = 'perfectedCompressionGreave';
  }],
  ['cache-salvage-quantity-invalid', (plan) => {
    plan.rewards.find(({ id }) => id === 'reward.cache.alpha')
      .salvageBundle.recoverableParts[0].quantity = 0;
  }],
  ['major-cache-salvage-too-small', (plan) => {
    const bundle = plan.rewards.find(({ id }) => id === 'reward.cache.undercroft').salvageBundle;
    bundle.unidentifiedScrap = 1;
    bundle.recoverableParts.length = 1;
  }],
  ['objective-action-missing', (plan) => {
    plan.objectives.find(({ id }) => id === 'objective.extraction').actionId = 'action.missing';
  }],
];

test('cache salvage bundles are deterministic, isolated, and larger in the Undercroft', () => {
  const sameSeed = createGoldenDungeonPlanV2({
    seed: 'acceptance-content-negative-fixtures',
    undercroftType: 'magma',
  });
  const otherSeed = createGoldenDungeonPlanV2({
    seed: 'acceptance-content-negative-fixtures-other',
    undercroftType: 'magma',
  });
  const bundles = (plan) => plan.rewards
    .filter(({ type }) => type.includes('reaverbot-parts-cache'))
    .map(({ id, seed, salvageBundle }) => ({ id, seed, salvageBundle }));
  assert.deepEqual(bundles(golden), bundles(sameSeed));
  assert.notDeepEqual(bundles(golden), bundles(otherSeed));
  const ordinary = golden.rewards.filter(({ type }) => type === 'reaverbot-parts-cache');
  const major = golden.rewards.find(({ type }) => type === 'major-reaverbot-parts-cache');
  assert.ok(ordinary.every(({ salvageBundle }) => salvageBundle.recoverableParts.length === 2));
  assert.ok(major.salvageBundle.recoverableParts.length >= 3);
  assert.ok(major.salvageBundle.unidentifiedScrap
    > Math.max(...ordinary.map(({ salvageBundle }) => salvageBundle.unidentifiedScrap)));
});

for (const [code, mutate] of contentNegatives) {
  test(`golden content gate rejects ${code}`, () => {
    const plan = mutatePlan(golden, mutate);
    assertAcceptanceFailure(code, () => assertGoldenContentContracts(plan));
  });
}

const actionNegatives = [
  ['action-anchor-missing', (plan) => { plan.actions[0].anchorId = 'anchor.in-the-void'; }],
  ['action-anchor-surface-misaligned', (plan) => {
    plan.anchors.find(({ id }) => id === 'anchor.key.gamma').position.y += 0.5;
  }],
  ['action-anchor-surface-outside', (plan) => {
    plan.anchors.find(({ id }) => id === 'anchor.key.beta').position.x += 40;
  }],
  ['action-anchor-surface-region-mismatch', (plan) => {
    const anchor = plan.anchors.find(({ id }) => id === 'anchor.key.beta');
    anchor.regionId = 'security';
  }],
  ['action-approach-surface-missing', (plan) => {
    const anchor = plan.anchors.find(({ id }) => id === 'anchor.key.beta');
    const surface = plan.walkableSurfaces.find(({ id }) => id === anchor.surfaceId);
    const action = plan.actions.find(({ anchorId }) => anchorId === anchor.id);
    const previousZ = anchor.position.z;
    anchor.position.z = surface.bounds.max.z - 0.05;
    const deltaZ = anchor.position.z - previousZ;
    for (const fixtureId of new Set([
      ...(action.visualFixtureIds ?? []),
      ...(action.colliderIds ?? []),
    ])) {
      const fixture = plan.structuralFixtures.find(({ id }) => id === fixtureId);
      fixture.bounds.min.z += deltaZ;
      fixture.bounds.max.z += deltaZ;
      for (const colliderBounds of fixture.colliderBounds ?? []) {
        colliderBounds.min.z += deltaZ;
        colliderBounds.max.z += deltaZ;
      }
    }
  }],
  ['action-activation-side-missing', (plan) => { plan.actions[0].interaction.activationSide = 'wherever'; }],
  ['action-activation-side-inconsistent', (plan) => {
    plan.actions.find(({ id }) => id === 'action.water.reservoir').interaction.activationSide = 'back';
  }],
  ['prop-activation-contract-invalid', (plan) => {
    plan.actions.find(({ id }) => id === 'action.pickup.keycard-beta').interaction.activationSide = 'front';
  }],
  ['action-prompt-radius-unreachable', (plan) => {
    plan.actions.find(({ id }) => id === 'action.activate.key-seeker').interaction.radius = 0.1;
  }],
  ['action-fixture-anchor-misaligned', (plan) => {
    const action = plan.actions.find(({ id }) => id === 'action.pickup.keycard-beta');
    const fixture = plan.structuralFixtures.find(({ id }) => id === action.visualFixtureIds[0]);
    fixture.bounds.min.x += 4;
    fixture.bounds.max.x += 4;
  }],
  ['reward-fixture-parity-mismatch', (plan) => {
    const reward = plan.rewards.find(({ id }) => id === 'reward.cache.alpha');
    reward.visualFixtureIds = [...plan.rewards.find(({ id }) => id === 'reward.key-seeker').visualFixtureIds];
  }],
  ['action-effects-missing', (plan) => { plan.actions[0].effects = []; }],
  ['effect-operation-unsupported', (plan) => { plan.actions[0].effects[0].op = 'executeCallback'; }],
  ['action-barrier-reference-missing', (plan) => {
    plan.actions.find(({ id }) => id === 'action.open.door-alpha').barrierIds = ['Door_Unplanned'];
  }],
];

test('shared action baseline proves floor, fixture, prompt, side, and reward runtime parity', () => {
  assertActionContracts(golden);
  assertActionContracts(electricalGolden);
  assertActionContracts(lab);
});

for (const [code, mutate] of actionNegatives) {
  test(`shared action gate rejects ${code}`, () => {
    const plan = mutatePlan(golden, mutate);
    assertAcceptanceFailure(code, () => assertActionContracts(plan));
  });
}

const environmentNegatives = [
  ['water-volume-changed', (plan) => {
    plan.environmentStates.find(({ id }) => id === 'environment.water-unit').conservedVolume = 0.75;
  }],
  ['water-state-contract', (plan) => {
    plan.environmentStates.find(({ id }) => id === 'environment.water-unit').stableStates.pop();
  }],
  ['water-basin-contract', (plan) => {
    plan.environmentStates.find(({ id }) => id === 'environment.water-unit').basins[0].floorSurfaceId = 'surface.paint-only';
  }],
  ['water-basin-footprint-incomplete', (plan) => {
    const basin = plan.environmentStates.find(({ id }) => id === 'environment.water-unit').basins[0];
    basin.bounds.min.x += 5;
    basin.bounds.max.x -= 5;
  }],
  ['water-basin-level-volume-mismatch', (plan) => {
    plan.environmentStates.find(({ id }) => id === 'environment.water-unit').basins[0].exactFilledLevel += 0.25;
  }],
  ['water-exact-volume-mismatch', (plan) => {
    plan.environmentStates.find(({ id }) => id === 'environment.water-unit').stableStates[0].exactVolume += 10;
  }],
  ['flooded-movement-contract', (plan) => {
    plan.environmentStates.find(({ id }) => id === 'environment.water-unit').movementProfile.jumpHeight = 5;
  }],
  ['water-router-not-permanent-dry', (plan) => {
    const water = plan.environmentStates.find(({ id }) => id === 'environment.water-unit');
    const anchor = plan.anchors.find(({ id }) => id === water.permanentDryControlAnchorIds[0]);
    const basin = water.basins.find(({ regionId }) => regionId === anchor.regionId);
    const support = plan.walkableSurfaces.find(({ id }) => id === (anchor.surfaceId ?? anchor.safeSurfaceId));
    anchor.position.x = (basin.bounds.min.x + basin.bounds.max.x) * 0.5;
    anchor.position.z = (basin.bounds.min.z + basin.bounds.max.z) * 0.5;
    support.bounds.min.x = anchor.position.x - 1;
    support.bounds.max.x = anchor.position.x + 1;
    support.bounds.min.z = anchor.position.z - 1;
    support.bounds.max.z = anchor.position.z + 1;
    const floodedState = water.stableStates.find((state) => state.basinLevels[basin.id] > 0);
    const waterTopY = basin.bounds.min.y + floodedState.basinLevels[basin.id];
    // Moving a high catwalk into the larger authored footprint is no longer a
    // valid submerged-control negative by itself. Put the support and its
    // mounted anchor at the actual committed waterline so this fixture proves
    // the physical dry-clearance rule instead of depending on the retired 6m
    // central-square level.
    support.bounds.min.y = waterTopY - 0.25;
    support.bounds.max.y = waterTopY + 0.05;
    anchor.position.y = support.bounds.max.y;
  }],
  ['hazard-surface-contract', (plan) => {
    plan.environmentStates.find(({ id }) => id === 'environment.undercroft-hazard').surfaces = [];
  }],
  ['magma-timing-contract', (plan) => {
    plan.environmentStates.find(({ id }) => id === 'environment.undercroft-hazard').pulseSeconds = 0.5;
  }],
];

for (const [code, mutate] of environmentNegatives) {
  test(`environment gate rejects ${code}`, () => {
    const plan = mutatePlan(golden, mutate);
    assertAcceptanceFailure(code, () => assertEnvironmentStateContracts(plan, 'golden'));
  });
}

test('electrical golden environment baseline uses the exact safe/charging/energized cycle', () => {
  assertEnvironmentStateContracts(electricalGolden, 'golden');
});

test('environment gate rejects electrical-timing-contract', () => {
  const plan = mutatePlan(electricalGolden, (candidate) => {
    candidate.environmentStates.find(({ id }) => id === 'environment.undercroft-hazard')
      .phases.find(({ id }) => id === 'charging').durationSeconds = 1;
  });
  assertAcceptanceFailure('electrical-timing-contract', () => assertEnvironmentStateContracts(plan, 'golden'));
});

test('traversal-lab mechanism baseline has complete stable-state tables', () => {
  assertMechanismContracts(mechanismLab);
});

const mechanismNegatives = [
  ['mechanism-initial-state-missing', (plan) => {
    plan.mechanisms.find(({ id }) => id === 'mechanism.lab-gear').initialStateId = 'UnknownLanding';
  }],
  ['mechanism-transition-invalid', (plan) => {
    plan.mechanisms.find(({ id }) => id === 'mechanism.lab-gear').transitions[0].toStateId = 'PaintedBackdrop';
  }],
  ['lift-recall-automatic-contract', (plan) => {
    plan.mechanisms.find(({ id }) => id === 'mechanism.lab-lift').recallable = false;
  }],
  ['lift-automatic-departure-missing', (plan) => {
    plan.mechanisms.find(({ id }) => id === 'mechanism.lab-lift').transitions[0].trigger = 'player-boarded';
  }],
  ['lift-recall-action-missing', (plan) => {
    const recall = plan.mechanisms.find(({ id }) => id === 'mechanism.lab-lift')
      .transitions.find(({ actionId }) => actionId === 'action.lab-lift.recall-lower');
    delete recall.actionId;
  }],
  ['mechanism-route-support-state-missing', (plan) => {
    plan.structuralFixtures.find(({ id }) => id === 'fixture.mechanism.lab-lift.support')
      .supportedStateIds.pop();
  }],
  ['mechanism-route-support-pose-missing', (plan) => {
    plan.structuralFixtures.find(({ id }) => id === 'fixture.mechanism.lab-lift.support')
      .bounds.max.x -= 2;
  }],
  ['moving-cargo-automatic-contract', (plan) => {
    plan.mechanisms.find(({ id }) => id === 'mechanism.lab-auto-cargo').automaticTravel = false;
  }],
  ['moving-cargo-overhead-rail-missing', (plan) => {
    plan.structuralFixtures.find(({ id }) => id === 'fixture.mechanism.lab-auto-cargo.support')
      .overheadRailY -= 4;
  }],
  ['moving-cargo-not-elevated', (plan) => {
    plan.mechanisms.find(({ id }) => id === 'mechanism.lab-auto-cargo').runtimeProfile.elevated = false;
  }],
  ['crumble-manual-rearm', (plan) => {
    plan.mechanisms.find(({ id }) => id === 'mechanism.lab-crumble').runtimeProfile.noManualRearm = false;
  }],
  ['mechanism-state-unreachable', (plan) => {
    const mechanism = plan.mechanisms.find(({ id }) => id === 'mechanism.lab-gear');
    mechanism.transitions = mechanism.transitions.filter(({ toStateId }) => toStateId !== 'HighLanding');
  }],
];

for (const [code, mutate] of mechanismNegatives) {
  test(`mechanism gate rejects ${code}`, () => {
    const plan = mutatePlan(mechanismLab, mutate);
    assertAcceptanceFailure(code, () => assertMechanismContracts(plan));
  });
}

test('authored fall baseline spans the crumble aperture, exact catchment, and public physical return', () => {
  assertPlayableLowerAreas(fallLab, successfulFallJourney());
});

const fallContractNegatives = [
  ['fall-trajectory-misses-source', (plan) => {
    const fall = plan.falls[0];
    const portal = plan.portals.find(({ id }) => id === fall.sourcePortalId);
    fall.trajectoryBounds.max.y = portal.from.center.y - 0.1;
  }],
  ['fall-trajectory-misses-catchment', (plan) => {
    const fall = plan.falls[0];
    const catchment = plan.walkableSurfaces.find(({ id }) => id === fall.catchmentSurfaceId);
    fall.trajectoryBounds.min.y = catchment.bounds.max.y + 0.1;
  }],
  ['fall-catchment-surface-missing', (plan) => {
    const fall = plan.falls[0];
    plan.walkableSurfaces.find(({ id }) => id === fall.catchmentSurfaceId).collision = 'none';
  }],
  ['fall-safe-anchor-mismatch', (plan) => {
    const fall = plan.falls[0];
    plan.safeAnchors.find(({ id }) => id === fall.safeAnchorId).surfaceId = 'surface.lab-recovery.main';
  }],
  ['fall-return-link-missing', (plan) => {
    const fall = plan.falls[0];
    plan.traversalLinks = plan.traversalLinks.filter((link) => (
      link.fromSurfaceId !== fall.catchmentSurfaceId && link.toSurfaceId !== fall.catchmentSurfaceId
    ));
  }],
  ['fall-does-not-descend', (plan) => {
    const fall = plan.falls[0];
    const portal = plan.portals.find(({ id }) => id === fall.sourcePortalId);
    const sourceId = portal.physicalRoute.endpointSurfaceIds.from;
    const source = plan.walkableSurfaces.find(({ id }) => id === sourceId);
    const catchment = plan.walkableSurfaces.find(({ id }) => id === fall.catchmentSurfaceId);
    const height = catchment.bounds.max.y - catchment.bounds.min.y;
    catchment.bounds.min.y = source.bounds.max.y - height;
    catchment.bounds.max.y = source.bounds.max.y;
  }],
];

for (const [code, mutate] of fallContractNegatives) {
  test(`authored fall gate rejects ${code}`, () => {
    const plan = mutatePlan(fallLab, mutate);
    assertAcceptanceFailure(code, () => assertPlayableLowerAreas(plan));
  });
}

const fallJourneyNegatives = [
  ['fall-public-journey-missing', (proof) => { proof.publicInputOnly = false; }],
  ['crumble-warning-unobserved', (proof) => { proof.cracksVisible = false; }],
  ['crumble-collapse-not-physical', (proof) => {
    proof.rootDescendedBelowSource = false;
    proof.landingY = 0; // The legacy groundY=0 correction must not catch the player at the aperture.
  }],
  ['fall-catchment-landing-mismatch', (proof) => { proof.landingY = 0; }],
  ['fall-journey-damage', (proof) => { proof.damageDelta = -1; }],
  ['fall-physical-return-missing', (proof) => { proof.physicallyReturned = false; }],
  ['crumble-automatic-reset-unobserved', (proof) => { proof.automaticReset = false; }],
  ['fall-silent-recovery-used', (proof) => { proof.silentSafeCorrections = 1; }],
];

for (const [code, mutate] of fallJourneyNegatives) {
  test(`real crumble/drop journey gate rejects ${code}`, () => {
    const journey = successfulFallJourney();
    mutate(journey.falls[0]);
    assertAcceptanceFailure(code, () => assertPlayableLowerAreas(fallLab, journey));
  });
}

function compoundLandmarkPlan() {
  const cells = [0, 1, 2].map((index) => ({
    id: `cell.landmark.${index}`,
    regionId: 'landmark',
    playable: true,
    connector: false,
    bounds: { min: { x: index * 10, y: index * 3, z: 0 }, max: { x: index * 10 + 10, y: index * 3 + 8, z: 10 } },
  }));
  const walkableSurfaces = cells.map((cell, index) => ({
    id: `surface.landmark.${index}`,
    cellId: cell.id,
    regionId: 'landmark',
    bounds: { min: { x: index * 10, y: index * 3, z: 0 }, max: { x: index * 10 + 10, y: index * 3 + 0.2, z: 10 } },
  }));
  return {
    acceptanceProfile: 'golden',
    regions: [{ id: 'landmark', landmark: true, cellIds: cells.map(({ id }) => id) }],
    spatialCells: cells,
    walkableSurfaces,
    traversalLinks: [
      { id: 'route.stairs', fromSurfaceId: walkableSurfaces[0].id, toSurfaceId: walkableSurfaces[1].id, mode: 'walkable-stairs', bidirectional: true },
      { id: 'route.catwalk', fromSurfaceId: walkableSurfaces[1].id, toSurfaceId: walkableSurfaces[2].id, mode: 'catwalk', bidirectional: true },
    ],
    structuralFixtures: [
      { id: 'fixture.pump', regionId: 'landmark', cellId: cells[0].id, type: 'functional-machine', gameplayPurpose: 'working pump' },
      { id: 'fixture.pipe', regionId: 'landmark', cellId: cells[1].id, type: 'traversal-pipe', gameplayPurpose: 'pressure pipe route' },
    ],
  };
}

test('compound landmark baseline has authored subspaces, elevation, routes, and machinery', () => {
  assertLandmarkCompoundSpaces(compoundLandmarkPlan(), 'golden');
});

const landmarkNegatives = [
  ['landmark-not-compound', (plan) => { plan.spatialCells.splice(1); plan.regions[0].cellIds.splice(1); }],
  ['landmark-cells-disconnected', (plan) => { plan.traversalLinks.pop(); }],
  ['landmark-route-variety-missing', (plan) => { plan.traversalLinks[1].mode = 'walkable-stairs'; }],
  ['landmark-elevation-bands-missing', (plan) => {
    plan.walkableSurfaces.forEach((surface) => { surface.bounds.min.y = 0; surface.bounds.max.y = 0.2; });
  }],
  ['landmark-functional-machinery-missing', (plan) => { plan.structuralFixtures.pop(); }],
];

for (const [code, mutate] of landmarkNegatives) {
  test(`compound landmark gate rejects ${code}`, () => {
    const plan = compoundLandmarkPlan();
    mutate(plan);
    assertAcceptanceFailure(code, () => assertLandmarkCompoundSpaces(plan, 'golden'));
  });
}

function nativeSubRegionLandmarkPlan() {
  const cell = {
    id: 'cell.landmark.native',
    regionId: 'landmark',
    playable: true,
    connector: false,
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 30, y: 12, z: 20 } },
  };
  const walkableSurfaces = [
    {
      id: 'surface.landmark.native.floor',
      cellId: cell.id,
      regionId: 'landmark',
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 12, y: 0.2, z: 20 } },
    },
    {
      id: 'surface.landmark.native.pump-deck',
      cellId: cell.id,
      regionId: 'landmark',
      bounds: { min: { x: 12, y: 3.2, z: 0 }, max: { x: 21, y: 3.4, z: 10 } },
    },
    {
      id: 'surface.landmark.native.catwalk',
      cellId: cell.id,
      regionId: 'landmark',
      bounds: { min: { x: 21, y: 6.2, z: 10 }, max: { x: 30, y: 6.4, z: 20 } },
    },
  ];
  return {
    acceptanceProfile: 'golden',
    regions: [{
      id: 'landmark',
      landmark: true,
      cellIds: [cell.id],
      subRegions: [
        { id: 'subregion.native.floor', surfaceIds: [walkableSurfaces[0].id] },
        { id: 'subregion.native.pump-deck', surfaceIds: [walkableSurfaces[1].id] },
        { id: 'subregion.native.catwalk', surfaceIds: [walkableSurfaces[2].id] },
      ],
    }],
    spatialCells: [cell],
    walkableSurfaces,
    traversalLinks: [
      { id: 'route.native.stairs', fromSurfaceId: walkableSurfaces[0].id, toSurfaceId: walkableSurfaces[1].id, mode: 'walkable-stairs', bidirectional: true },
      { id: 'route.native.catwalk', fromSurfaceId: walkableSurfaces[1].id, toSurfaceId: walkableSurfaces[2].id, mode: 'catwalk', bidirectional: true },
    ],
    structuralFixtures: [
      { id: 'fixture.native.pump', regionId: 'landmark', cellId: cell.id, type: 'functional-machine', gameplayPurpose: 'working pump' },
      { id: 'fixture.native.pipe', regionId: 'landmark', cellId: cell.id, type: 'traversal-pipe', gameplayPurpose: 'pressure pipe route' },
    ],
  };
}

test('native one-cell landmark qualifies through explicit connected surface-owned subregions', () => {
  assertLandmarkCompoundSpaces(nativeSubRegionLandmarkPlan(), 'golden');
});

const nativeSubRegionNegatives = [
  ['landmark-subregion-surface-ids-missing', (plan) => {
    delete plan.regions[0].subRegions[0].surfaceIds;
  }],
  ['landmark-subregion-surface-missing', (plan) => {
    plan.regions[0].subRegions[0].surfaceIds[0] = 'surface.landmark.native.stale';
  }],
  ['landmark-subregion-surface-duplicate', (plan) => {
    plan.regions[0].subRegions[1].surfaceIds.push(
      plan.regions[0].subRegions[0].surfaceIds[0],
    );
  }],
  ['landmark-subregions-disconnected', (plan) => {
    plan.traversalLinks.pop();
  }],
  ['landmark-elevation-bands-missing', (plan) => {
    plan.walkableSurfaces.forEach((surface) => {
      surface.bounds.min.y = 0;
      surface.bounds.max.y = 0.2;
    });
  }],
];

for (const [code, mutate] of nativeSubRegionNegatives) {
  test(`native subregion landmark gate rejects ${code}`, () => {
    const plan = nativeSubRegionLandmarkPlan();
    mutate(plan);
    assertAcceptanceFailure(code, () => assertLandmarkCompoundSpaces(plan, 'golden'));
  });
}

function physicalProgressionPlan() {
  const surface = (id, regionId) => ({
    id,
    regionId,
    cellId: `cell.${regionId}`,
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 0.2, z: 8 } },
    collision: 'static',
  });
  const surfaces = [
    surface('surface.security.main', 'security'),
    surface('surface.assembly.main', 'assembly'),
    surface('surface.server.main', 'server'),
    surface('surface.freight.main', 'freight'),
    surface('surface.credential.main', 'credential'),
    surface('surface.parts.main', 'parts'),
    surface('surface.nest.main', 'nest'),
    surface('surface.corkscrew.main', 'corkscrew'),
  ];
  const link = (id, fromSurfaceId, toSurfaceId, options = {}) => ({
    id, fromSurfaceId, toSurfaceId, mode: 'walk', bidirectional: true, ...options,
  });
  return {
    walkableSurfaces: surfaces,
    anchors: [
      { id: 'anchor.start', regionId: 'security', surfaceId: 'surface.security.main', position: { x: 1, y: 0.2, z: 1 } },
      { id: 'anchor.alpha', regionId: 'freight', surfaceId: 'surface.freight.main', position: { x: 1, y: 0.2, z: 1 } },
      { id: 'anchor.return', regionId: 'corkscrew', surfaceId: 'surface.corkscrew.main', position: { x: 1, y: 0.2, z: 1 } },
    ],
    safeAnchors: [],
    rewards: [{ id: 'reward.keycard-alpha', anchorId: 'anchor.alpha' }],
    environmentStates: [],
    mechanisms: [],
    portals: [{
      id: 'portal.corkscrew-credential-loop',
      from: { regionId: 'corkscrew' },
      to: { regionId: 'credential' },
      barrierId: 'Gate_Corkscrew_Return',
      initiallyOpen: false,
    }],
    traversalLinks: [
      link('route.start-assembly', 'surface.security.main', 'surface.assembly.main'),
      link('route.assembly-server', 'surface.assembly.main', 'surface.server.main'),
      link('route.server-freight', 'surface.server.main', 'surface.freight.main'),
      link('route.credential-parts', 'surface.credential.main', 'surface.parts.main'),
      link('route.parts-corkscrew', 'surface.parts.main', 'surface.corkscrew.main'),
      link('route.parts-nest', 'surface.parts.main', 'surface.nest.main'),
      link('route.return-shortcut', 'surface.corkscrew.main', 'surface.credential.main', { portalId: 'portal.corkscrew-credential-loop' }),
    ],
    actions: [{
      id: 'action.open.corkscrew-return',
      anchorId: 'anchor.return',
      barrierIds: ['Gate_Corkscrew_Return'],
      effects: [{ op: 'openGate', gateId: 'Gate_Corkscrew_Return' }],
    }],
    progression: {
      gateContracts: [{
        id: 'Gate_Corkscrew_Return',
        portalId: 'portal.corkscrew-credential-loop',
        barrierId: 'Gate_Corkscrew_Return',
        classification: 'shortcut',
        actionId: 'action.open.corkscrew-return',
        anchorId: 'anchor.return',
      }],
    },
    compatibility: { playerStartAnchorId: 'anchor.start' },
  };
}

test('physical progression baseline requires Server and Parts while keeping Nest optional', () => {
  assertGoldenPhysicalProgression(physicalProgressionPlan());
});

const progressionNegatives = [
  ['alpha-before-server-bypass', (plan) => {
    plan.traversalLinks.push({ id: 'route.assembly-drop', fromSurfaceId: 'surface.assembly.main', toSurfaceId: 'surface.freight.main', mode: 'intentional-drop', bidirectional: false });
  }],
  ['corkscrew-return-not-physically-locked', (plan) => {
    plan.portals[0].initiallyOpen = true;
    plan.portals[0].barrierId = null;
  }],
  ['corkscrew-return-wrong-side-control', (plan) => {
    plan.anchors.find(({ id }) => id === 'anchor.return').regionId = 'credential';
  }],
  ['nest-is-not-optional', (plan) => {
    plan.traversalLinks = plan.traversalLinks.filter(({ id }) => id !== 'route.parts-corkscrew');
    plan.traversalLinks.push({ id: 'route.nest-corkscrew', fromSurfaceId: 'surface.nest.main', toSurfaceId: 'surface.corkscrew.main', mode: 'walk', bidirectional: true });
  }],
  ['parts-exploration-bypass', (plan) => {
    plan.traversalLinks.push({ id: 'route.credential-corkscrew-bypass', fromSurfaceId: 'surface.credential.main', toSurfaceId: 'surface.corkscrew.main', mode: 'walk', bidirectional: true });
  }],
  ['corkscrew-return-shortcut-missing', (plan) => {
    plan.traversalLinks = plan.traversalLinks.filter(({ id }) => id !== 'route.return-shortcut');
  }],
];

for (const [code, mutate] of progressionNegatives) {
  test(`physical progression gate rejects ${code}`, () => {
    const plan = physicalProgressionPlan();
    mutate(plan);
    assertAcceptanceFailure(code, () => assertGoldenPhysicalProgression(plan));
  });
}
